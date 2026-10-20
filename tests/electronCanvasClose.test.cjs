const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const main = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8');
const gateSource = main.slice(main.indexOf('function createCanvasCloseGate(window) {'), main.indexOf('\nlet vibeXRhLoginWindow'));

function fixture() {
  const ipc = new EventEmitter();
  const win = new EventEmitter();
  const sent = [];
  const warnings = [];
  const timers = new Set();
  let destroyed = false;
  let requests = 0;
  win.isDestroyed = () => destroyed;
  win.webContents = { mainFrame: {}, send: (...args) => sent.push(args) };
  win.close = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    win.emit('close', event);
    if (!event.prevented) { destroyed = true; win.emit('closed'); }
  };
  const create = vm.runInNewContext(`(${gateSource.trim()})`, {
    ipcMain: ipc, crypto: { randomUUID: () => `request-${++requests}` },
    dialog: { showMessageBox: (_win, options) => { warnings.push(options); return Promise.resolve({}); } },
    electronT: (key) => key,
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
  });
  const gate = create(win);
  const respond = (overrides = {}, event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }) => {
    const requestId = sent.findLast(([channel]) => channel === 't8pc:canvas-close-request')[1];
    ipc.emit('t8pc:canvas-close-result', event, { requestId, ok: true, ...overrides });
  };
  return { gate, win, ipc, sent, warnings, timers, respond };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('failed migration preparation revokes close approval and allows a new save receipt', async () => {
  const f = fixture();
  const first = f.gate.request(); f.respond(); assert.equal(await first, true);
  f.gate.cancelApproval();
  assert.ok(f.sent.some(([channel, id]) => channel === 't8pc:canvas-close-cancel' && id === 'request-1'));
  const second = f.gate.request(); f.respond(); assert.equal(await second, true);
  assert.equal(f.sent.filter(([channel]) => channel === 't8pc:canvas-close-request').length, 2);
});

test('exit phases are sent only for the approved receipt and never unlock editing', async () => {
  const f = fixture();
  f.gate.notifyPhase('waiting'); assert.equal(f.sent.length, 0);
  const receipt = f.gate.request(); f.respond(); await receipt;
  f.gate.notifyPhase('waiting');
  assert.deepEqual(f.sent.at(-1), ['t8pc:canvas-close-phase', 'request-1', 'waiting']);
  f.gate.cancelApproval();
  const count = f.sent.length; f.gate.notifyPhase('installing'); assert.equal(f.sent.length, count);
});

test('native close remains open until exact current main-frame save receipt', async () => {
  const f = fixture();
  f.win.close();
  assert.equal(f.win.isDestroyed(), false);
  f.respond({}, { sender: {}, senderFrame: f.win.webContents.mainFrame });
  f.respond({}, { sender: f.win.webContents, senderFrame: {} });
  f.respond({ requestId: 'old-request' });
  await turn();
  assert.equal(f.win.isDestroyed(), false);
  f.respond();
  await turn();
  assert.equal(f.win.isDestroyed(), true);
  assert.equal(f.ipc.listenerCount('t8pc:canvas-close-result'), 0);
});
test('repeated close/app-quit requests share one pending receipt', async () => {
  const f = fixture();
  const a = f.gate.request();
  assert.equal(f.gate.request(), a);
  f.win.close(); f.win.close();
  assert.equal(f.sent.length, 1);
  f.respond();
  assert.equal(await a, true);
  await turn();
  assert.equal(f.win.isDestroyed(), true);
});
for (const reason of ['save', 'conflict', 'running']) {
  test(`${reason} keeps window open and permits a fresh retry`, async () => {
    const f = fixture();
    f.win.close(); f.respond({ ok: false, reason });
    await turn();
    assert.equal(f.win.isDestroyed(), false);
    assert.equal(f.warnings[0].message, `close.${reason}`);
    const old = f.sent[0][1];
    f.win.close();
    f.respond({ requestId: old });
    await turn();
    assert.equal(f.win.isDestroyed(), false);
    f.respond(); await turn();
    assert.equal(f.win.isDestroyed(), true);
  });
}
test('timeout cancels renderer hold, rejects late ACK and does not close', async () => {
  const f = fixture();
  const pending = f.gate.request();
  [...f.timers][0]();
  assert.equal(await pending, false);
  f.respond();
  assert.equal(f.win.isDestroyed(), false);
  assert.equal(f.sent[1][0], 't8pc:canvas-close-cancel');
});
test('backend quit remains ordered after renderer approval and refusal resets quit intent', () => {
  const quit = main.slice(main.indexOf("app.on('before-quit', (event) => {"));
  assert.ok(quit.indexOf('await mainWindowCloseGate.request()') < quit.indexOf("await shutdownBackendForElectron('ELECTRON_QUIT')"));
  assert.match(quit, /if \(mainWindowCloseGate && !\(await mainWindowCloseGate.request\(\)\)\) \{\s*electronQuitRequested = false;\s*return;/);
  assert.match(main, /mainWindowCloseGate = createCanvasCloseGate\(pendingMainWindow\)/);
});

function preloadFixture() {
  const ipc = new EventEmitter();
  const sent = [];
  let api;
  ipc.send = (...args) => sent.push(args);
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/preload.cjs'), 'utf8'), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }),
  });
  return { ipc, sent, api };
}
test('production preload waits for registered Canvas, passes cancellation and suppresses late success', async () => {
  const f = preloadFixture();
  let complete, cancelled;
  f.api.onCanvasCloseRequest(callback => {
    cancelled = callback;
    return new Promise(resolve => { complete = resolve; });
  });
  f.ipc.emit('t8pc:canvas-close-request', {}, 'one');
  assert.equal(f.sent.length, 0);
  f.ipc.emit('t8pc:canvas-close-cancel', {}, 'old');
  assert.equal(cancelled(), false);
  f.ipc.emit('t8pc:canvas-close-cancel', {}, 'one');
  assert.equal(cancelled(), true);
  complete({ ok: true }); await turn();
  assert.equal(f.sent.length, 0);
});
test('production preload does not turn an unmounted Canvas into clean startup', async () => {
  const f = preloadFixture();
  const remove = f.api.onCanvasCloseRequest(async () => ({ ok: true }));
  remove();
  f.ipc.emit('t8pc:canvas-close-request', {}, 'unmounted'); await turn();
  assert.equal(f.sent[0][1].ok, false);
});
test('production preload allows untouched startup but rejects non-boolean approval', async () => {
  const f = preloadFixture();
  f.ipc.emit('t8pc:canvas-close-request', {}, 'startup'); await turn();
  assert.equal(f.sent[0][1].ok, true);
  f.ipc.emit('t8pc:canvas-close-cancel', {}, 'startup');
  f.api.onCanvasCloseRequest(async () => ({ ok: 'true' }));
  f.ipc.emit('t8pc:canvas-close-request', {}, 'bad'); await turn();
  assert.equal(f.sent[1][1].ok, false);
});

test('main timeout can still cancel the renderer hold after a successful ACK was sent', async () => {
  const f = preloadFixture();
  let cancelled;
  f.api.onCanvasCloseRequest(async check => { cancelled = check; return { ok: true }; });
  f.ipc.emit('t8pc:canvas-close-request', {}, 'receipt'); await turn();
  assert.equal(f.sent[0][1].ok, true);
  assert.equal(cancelled(), false);
  f.ipc.emit('t8pc:canvas-close-cancel', {}, 'receipt');
  assert.equal(cancelled(), true);
  f.api.onCanvasCloseRequest(async () => ({ ok: false }));
  f.ipc.emit('t8pc:canvas-close-request', {}, 'retry'); await turn();
  assert.equal(f.sent[1][1].requestId, 'retry');
});

test('preload scopes exit progress to the exact approved request and a fixed phase allowlist', async () => {
  const f = preloadFixture(); let phase;
  f.api.onCanvasCloseRequest(async (_cancelled, readPhase) => { phase = readPhase; return { ok: true }; });
  f.ipc.emit('t8pc:canvas-close-request', {}, 'approved'); await turn();
  assert.equal(phase(), 'saving');
  f.ipc.emit('t8pc:canvas-close-phase', {}, 'old', 'waiting'); assert.equal(phase(), 'saving');
  f.ipc.emit('t8pc:canvas-close-phase', {}, 'approved', 'arbitrary message'); assert.equal(phase(), 'saving');
  f.ipc.emit('t8pc:canvas-close-phase', {}, 'approved', 'waiting'); assert.equal(phase(), 'waiting');
  f.ipc.emit('t8pc:canvas-close-cancel', {}, 'approved');
  f.ipc.emit('t8pc:canvas-close-phase', {}, 'approved', 'installing'); assert.equal(phase(), 'waiting');
});
