'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual Canvas effect with controlled DOM/IPC/save observation;
// this tests hold ownership, not native UI rendering or CAS durability.
function fixture({ initiallyInert = false, wait = async () => ({ ok: true }), install = async () => {}, saveLog = async () => {} } = {}) {
  const source = fs.readFileSync(require.resolve('../src/components/CanvasCloseGuard.tsx'), 'utf8');
  const normalized = source.replace(/\r\n/g, '\n');
  const begin = normalized.indexOf('  useEffect(() => {\n    const subscribe = window.t8pc?.onCanvasCloseRequest;');
  const end = normalized.indexOf('  }, [runtime, t]);', begin);
  assert.ok(begin >= 0 && end > begin);
  const code = ts.transpileModule(normalized.slice(begin, end + '  }, [runtime, t]);'.length), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const root = { inert: initiallyInert };
  const runtime = { closeObserver: { prepare() {}, read: () => ({ dirty: false, queued: false }), flush() {} } };
  const notices = new Set(), timers = new Map();
  let handler, cleanup, timerId = 0, unsubscribed = false;
  vm.runInNewContext(code, {
    useEffect: callback => { cleanup = callback(); },
    runtime, t: key => key,
    waitForCanvasCloseSave: wait,
    document: {
      getElementById: () => root, activeElement: { blur() {} },
      createElement: () => {
        const notice = { style: {}, children: [], attributes: new Map(), setAttribute(key, value) { this.attributes.set(key, value); }, appendChild(child) { this.children.push(child); }, remove: () => notices.delete(notice) };
        return notice;
      },
      body: { appendChild: notice => notices.add(notice) },
    },
    window: {
      t8pc: {
        onCanvasCloseRequest: callback => { handler = callback; return () => { unsubscribed = true; }; },
        updater: { install }, startupDiagnostics: { save: saveLog },
      },
      setInterval: callback => { timers.set(++timerId, callback); return timerId; },
      clearInterval: id => timers.delete(id),
    },
  });
  return { root, notices, timers, runtime, close: (cancelled, phase) => handler(cancelled, phase), cleanup: () => cleanup(),
    get unsubscribed() { return unsubscribed; } };
}

test('cancel then immediate retry owns a fresh hold; late old cleanup cannot unlock it', async () => {
  const f = fixture();
  let aCancelled = false, bCancelled = false;
  assert.equal((await f.close(() => aCancelled)).ok, true);
  const oldWatch = [...f.timers.values()][0];
  aCancelled = true;
  assert.equal((await f.close(() => bCancelled)).ok, true);
  assert.equal(f.notices.size, 1); assert.equal(f.timers.size, 1); assert.equal(f.root.inert, true);
  oldWatch();
  assert.equal(f.notices.size, 1); assert.equal(f.root.inert, true);
  bCancelled = true;
  [...f.timers.values()][0]();
  assert.equal(f.notices.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.root.inert, false);
  f.cleanup();
});

for (const initiallyInert of [false, true]) test(`unmount releases successful hold and preserves prior inert=${initiallyInert}`, async () => {
  const f = fixture({ initiallyInert });
  await f.close(() => false);
  f.cleanup(); f.cleanup();
  assert.equal(f.root.inert, initiallyInert); assert.equal(f.notices.size, 0);
  assert.equal(f.timers.size, 0); assert.equal(f.unsubscribed, true);
});

test('save refusal and thrown observer both release input and notice', async () => {
  for (const throws of [false, true]) {
    const f = fixture({ wait: async () => { if (throws) throw new Error('observer failed'); return { ok: false, reason: 'save' }; } });
    if (throws) await assert.rejects(f.close(() => false), /observer failed/);
    else assert.equal((await f.close(() => false)).ok, false);
    assert.equal(f.root.inert, false); assert.equal(f.notices.size, 0); assert.equal(f.timers.size, 0);
    f.cleanup();
  }
});

test('editor replacement keeps the same close hold and reads the successor, never a false clean gap', async () => {
  let resume, options;
  const f = fixture({ wait: async current => {
    options = current;
    await new Promise(resolve => { resume = resolve; });
    return current.read().dirty ? { ok: false, reason: 'save' } : { ok: true };
  } });
  const pending = f.close(() => false);
  f.runtime.closeObserver = null;
  assert.equal(options.cancelled(), false);
  assert.equal(options.read().dirty, true);
  assert.equal(options.read().queued, true);
  let flushes = 0;
  f.runtime.closeObserver = { prepare() {}, read: () => ({ dirty: false, queued: false }), flush() { flushes++; } };
  options.flush(); assert.equal(flushes, 1);
  resume(); assert.equal((await pending).ok, true);
  assert.equal(f.root.inert, true); assert.equal(f.notices.size, 1);
  f.cleanup();
});

test('stable close guard is outside the keyed ReactFlow editor', () => {
  const source = fs.readFileSync(require.resolve('../src/components/Canvas.tsx'), 'utf8');
  assert.match(source, /<CanvasCloseGuard runtime=\{persistenceRuntime\} \/>\s*<ReactFlowProvider key=/);
  assert.match(source, /useRef\(persistenceRuntime\.recoveryFlights\)/);
  assert.match(source, /return persistenceRuntime\.recoveryCommit\(canvasId, document, baseline\)/);
});

test('transport stays open during save and stays fenced after ACK without native phase events', async () => {
  let finish;
  const f = fixture({ wait: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.close(() => false);
  const notice = [...f.notices][0];
  assert.equal(notice.attributes.get('data-canvas-close-phase'), 'saving');
  finish({ ok: true }); await pending;
  assert.equal(notice.attributes.get('data-canvas-close-phase'), 'closing');
  [...f.timers.values()][0]();
  assert.equal(notice.attributes.get('data-canvas-close-phase'), 'closing');
  assert.equal(f.root.inert, true); f.cleanup();
});

test('the retained hold shows actual exit phases and exposes failure actions without unlocking the canvas', async () => {
  const f = fixture(); let phase = 'saving';
  await f.close(() => false, () => phase);
  const notice = [...f.notices][0], [message, actions] = notice.children;
  assert.equal(message.textContent, 'generationHistory.savedBeforeClose');
  assert.equal(notice.attributes.get('data-canvas-close-phase'), 'closing');
  for (const [next, expected] of [
    ['closing', 'generationHistory.savedBeforeClose'],
    ['waiting', 'generationHistory.waitingBeforeClose'],
    ['installing', 'generationHistory.installingAfterClose'],
    ['update-error', 'generationHistory.closeUpdateFailed'],
  ]) {
    phase = next; [...f.timers.values()][0]();
    assert.equal(message.textContent, expected);
    assert.equal(actions.hidden, next !== 'update-error');
    assert.equal(f.root.inert, true);
    assert.equal(notice.attributes.get('data-canvas-close-phase'), next);
  }
  assert.equal(actions.children.length, 2);
  f.cleanup();
});

test('failure actions use native diagnostics and the original updater with single-click ownership', async () => {
  let installations = 0, logs = 0, finish;
  const f = fixture({ install: () => { installations++; return new Promise(resolve => { finish = resolve; }); }, saveLog: async () => { logs++; } });
  await f.close(() => false, () => 'update-error'); [...f.timers.values()][0]();
  const [, actions] = [...f.notices][0].children;
  const [retry, save] = actions.children;
  const first = retry.onclick(); await retry.onclick();
  assert.equal(installations, 1); assert.equal(retry.disabled, true);
  save.onclick(); assert.equal(logs, 1);
  finish(); await first;
  assert.equal(retry.disabled, false); assert.equal(f.root.inert, true);
  f.cleanup();
});
