const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { MAX_EVENTS, MAX_FILE_BYTES, sanitizeEvent, parseStartupLine, createStartupDiagnostics, installStartupConsoleCapture, registerStartupDiagnosticsIpc } = require('../electron/startupDiagnostics.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-startup-log-test-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function readJsonLines(text) { return text.trim().split('\n').map((line) => JSON.parse(line)); }
function compile(source, context = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, ...context });
  return exports;
}

test('only fixed startup phases and finite timings survive privacy filtering', () => {
  const entry = sanitizeEvent({ component: 'renderer', phase: 'catalog', elapsedMs: 25.7, phaseMs: NaN, delayMs: -1, apiKey: 'secret', prompt: 'private', canvasId: 'private', url: 'https://private?token=secret' });
  assert.deepEqual(entry, { component: 'renderer', phase: 'catalog', elapsedMs: 26 });
  for (const input of [null, 'raw', { component: 'provider', phase: 'ready' }, { component: 'renderer', phase: 'sk-secret' }, { component: 'constructor', phase: 'ready' }]) assert.equal(sanitizeEvent(input), null);
});

test('existing Electron/backend/database startup lines are captured without details or console payloads', () => {
  assert.deepEqual(parseStartupLine('[12:13:14] [startup] component=electron phase=startup-failed elapsedMs=512 details=sk-secret C:\\private\\file'), { component: 'electron', phase: 'startup-failed', elapsedMs: 512 });
  assert.deepEqual(parseStartupLine('[startup] component=project-db phase=active-initialized phaseMs=345 totalMs=678'), { component: 'project-db', phase: 'active-initialized', phaseMs: 345, totalMs: 678 });
  assert.equal(parseStartupLine('[provider] sk-secret'), null);
  assert.equal(parseStartupLine('[startup] component=backend phase=sk-secret elapsedMs=1'), null);
  assert.equal(parseStartupLine('x'.repeat(4097)), null);
  const calls = [], records = [];
  const log = (...args) => { calls.push(args); return 'original-return'; };
  const target = { log };
  const restore = installStartupConsoleCapture({ record: (entry) => records.push(entry) }, target);
  assert.equal(target.log('[startup] component=backend phase=routes-mounted elapsedMs=10', { secret: 'not inspected' }), 'original-return');
  target.log('ordinary output', { apiKey: 'not inspected' });
  assert.equal(calls.length, 2); assert.equal(records.length, 1);
  restore(); assert.equal(target.log, log);
  const undo = installStartupConsoleCapture({ record() { throw new Error('disk failed'); } }, target);
  assert.equal(target.log('[startup] component=backend phase=routes-mounted elapsedMs=10'), 'original-return'); undo();
});

test('startup logs persist asynchronously and export both current and previous sessions', async (t) => {
  const directory = fixture(t);
  const first = createStartupDiagnostics({ directory, version: '3.2.6' });
  first.record({ component: 'project-db', phase: 'active-initialized', phaseMs: 1234, totalMs: 1500 });
  await first.flush();
  const current = path.join(directory, 'startup-current.jsonl');
  assert.match(fs.readFileSync(current, 'utf8'), /active-initialized/);
  const second = createStartupDiagnostics({ directory, version: '3.2.6' });
  second.record({ component: 'renderer', phase: 'ready', elapsedMs: 2100, secret: 'must-not-save' });
  const exported = await second.exportText();
  const lines = readJsonLines(exported);
  assert.ok(lines.some((entry) => entry.session === 'previous'));
  assert.ok(lines.some((entry) => entry.session === 'current' && entry.persistence === 'saved'));
  assert.ok(lines.some((entry) => entry.totalMs === 1500));
  assert.ok(lines.some((entry) => entry.phase === 'ready'));
  assert.doesNotMatch(exported, /must-not-save|apiKey|canvasId/);
  assert.equal(fs.readdirSync(directory).length, 2);
});

test('event count and automatic file size are bounded without ever inspecting canvas data', async (t) => {
  const directory = fixture(t), recorder = createStartupDiagnostics({ directory, version: '3.2.6' });
  for (let index = 0; index < MAX_EVENTS + 100; index++) recorder.record({ component: 'renderer', phase: 'event-loop-delay', delayMs: index });
  const text = await recorder.exportText();
  assert.equal(readJsonLines(text).filter((entry) => entry.component).length, MAX_EVENTS);
  assert.ok(readJsonLines(text).some((entry) => entry.truncated === true));
  assert.ok(fs.statSync(path.join(directory, 'startup-current.jsonl')).size < MAX_FILE_BYTES);
});

test('disk errors retain an exportable in-memory startup log and do not reject flush', async (t) => {
  const root = fixture(t), file = path.join(root, 'not-a-directory'); fs.writeFileSync(file, 'sentinel');
  const recorder = createStartupDiagnostics({ directory: file, version: '3.2.6' });
  recorder.record({ component: 'backend', phase: 'transport-listening', elapsedMs: 500 });
  await recorder.flush();
  const text = await recorder.exportText();
  assert.match(text, /memory-only/); assert.match(text, /transport-listening/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'sentinel');
});

test('previous log export filters unexpected fields and ignores oversized/unparseable input', async (t) => {
  const root = fixture(t), recorder = createStartupDiagnostics({ directory: root, version: '3.2.6' });
  await recorder.flush();
  const previous = path.join(root, 'startup-previous.jsonl');
  fs.writeFileSync(previous, JSON.stringify({ schema: 't8-startup-diagnostics-v1', appVersion: '3.2.5', apiKey: 'header-secret' }) + '\n' + JSON.stringify({ component: 'renderer', phase: 'catalog-error', elapsedMs: 20, prompt: 'payload-secret' }) + '\n{"truncated');
  let text = await recorder.exportText();
  assert.match(text, /catalog-error/); assert.doesNotMatch(text, /header-secret|payload-secret/);
  fs.writeFileSync(previous, 'x'.repeat(MAX_FILE_BYTES + 1));
  text = await recorder.exportText(); assert.ok(!readJsonLines(text).some((entry) => entry.session === 'previous'));
  fs.writeFileSync(previous, 'broken'); assert.ok(await recorder.exportText());
});

function ipcHarness(t, picked = {}) {
  const root = fixture(t), handlers = new Map(), listeners = new Map(), records = [];
  const mainFrame = {}, webContents = { mainFrame }, window = { webContents, isDestroyed: () => false };
  let dialogCalls = 0, exports = 0;
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) };
  registerStartupDiagnosticsIpc({ ipcMain, getWindow: () => window,
    assertTrusted: (event) => { if (event.sender !== webContents) throw new Error('foreign renderer'); },
    diagnostics: { record: (input) => records.push(input), exportText: async () => { exports++; return 'safe-startup-log'; } },
    dialog: { showSaveDialog: async () => { dialogCalls++; return typeof picked === 'function' ? picked() : picked; } }, title: () => 'Save startup log' });
  return { root, save: handlers.get('t8pc:startup-diagnostics:save'), record: listeners.get('t8pc:startup-diagnostics:record'), trusted: { sender: webContents, senderFrame: mainFrame }, records, stats: () => ({ dialogCalls, exports }) };
}

test('production IPC exports only to the native user-selected path, independent of backend/database', async (t) => {
  const harness = ipcHarness(t);
  // Replace the fake picker before dispatch by registering with its known new temp path.
  const destination = path.join(harness.root, 'user-export.log');
  const selected = ipcHarness(t, { filePath: destination });
  assert.deepEqual(await selected.save(selected.trusted), { success: true });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'safe-startup-log');
  assert.deepEqual(selected.stats(), { dialogCalls: 1, exports: 1 });
});

test('production IPC cancellation/failure never claims success or writes a default file', async (t) => {
  const canceled = ipcHarness(t, { canceled: true });
  assert.deepEqual(await canceled.save(canceled.trusted), { success: false, canceled: true });
  assert.equal(canceled.stats().exports, 0); assert.equal(fs.readdirSync(canceled.root).length, 0);
  const failed = ipcHarness(t, { filePath: path.join(canceled.root, 'missing', 'file.log') });
  assert.deepEqual(await failed.save(failed.trusted), { success: false, code: 'STARTUP_LOG_SAVE_FAILED' });
});

test('foreign renderers and embedded frames cannot record logs or trigger native save', async (t) => {
  const harness = ipcHarness(t);
  for (const event of [{ sender: {}, senderFrame: {} }, { ...harness.trusted, senderFrame: {} }]) {
    await assert.rejects(harness.save(event));
    assert.doesNotThrow(() => harness.record(event, { component: 'renderer', phase: 'ready' }));
  }
  harness.record(harness.trusted, { component: 'backend', phase: 'routes-mounted' });
  assert.equal(harness.records.length, 0); assert.equal(harness.stats().dialogCalls, 0);
});

test('production IPC prevents overlapping native save dialogs', async (t) => {
  let finish;
  const picker = new Promise((resolve) => { finish = resolve; });
  const harness = ipcHarness(t, () => picker);
  const first = harness.save(harness.trusted);
  assert.deepEqual(await harness.save(harness.trusted), { success: false, code: 'STARTUP_LOG_BUSY' });
  finish({ canceled: true }); await first;
  assert.equal(harness.stats().dialogCalls, 1);
});

test('actual renderer stage recorder sends timings only and does not change readiness or API requests', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/startupDiagnostics.ts'), 'utf8');
  let now = 1000;
  class Clock extends Date { static now() { return now; } }
  const calls = [];
  const helper = compile(source, { Date: Clock, window: { t8pc: { startupDiagnostics: { record: (entry) => calls.push(JSON.parse(JSON.stringify(entry))) } } } });
  helper.recordRendererStartupStage('catalog'); now = 3500;
  helper.recordRendererStartupStage('catalog'); helper.recordRendererStartupStage('document');
  assert.deepEqual(calls, [{ component: 'renderer', phase: 'catalog', elapsedMs: 0, phaseMs: 0 }, { component: 'renderer', phase: 'document', elapsedMs: 2500, phaseMs: 2500 }]);
  assert.doesNotMatch(source, /fetch\(|localStorage|setActiveId|apiKey|canvasId/);
});

test('actual renderer observer reports event-loop delay without capturing error text and cleans listeners', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/startupDiagnostics.ts'), 'utf8');
  let now = 0, tick; const calls = [], listeners = new Map(), cleared = [];
  class Clock extends Date { static now() { return now; } }
  const window = { t8pc: { startupDiagnostics: { record: (entry) => calls.push(JSON.parse(JSON.stringify(entry))) } },
    setInterval: (fn) => { tick = fn; return 1; }, setTimeout: () => 2, clearInterval: (id) => cleared.push(id), clearTimeout: (id) => cleared.push(id),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const helper = compile(source, { Date: Clock, window, document });
  const stop = helper.observeRendererStartup(); now = 4000; tick();
  listeners.get('error')({ message: 'sk-secret', filename: 'private' });
  assert.equal(calls[0].delayMs, 3000); assert.equal(calls[1].phase, 'renderer-error');
  assert.doesNotMatch(JSON.stringify(calls), /sk-secret|private/);
  stop(); assert.deepEqual(cleared, [1, 2]); assert.equal(listeners.size, 0);
});

test('actual browser export is marked renderer-only and revokes its download URL', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/startupDiagnostics.ts'), 'utf8');
  const calls = []; let blob;
  const anchor = { click: () => calls.push('click'), remove: () => calls.push('remove') };
  const helper = compile(source, { Blob, __APP_VERSION__: '3.2.6', window: { setTimeout: (fn) => fn() },
    document: { createElement: () => anchor, body: { appendChild: () => calls.push('append') } },
    URL: { createObjectURL: (value) => { blob = value; return 'blob:fixture'; }, revokeObjectURL: () => calls.push('revoke') } });
  helper.recordRendererStartupStage('catalog');
  assert.equal((await helper.saveStartupDiagnostics()).success, true);
  assert.deepEqual(calls, ['append', 'click', 'remove', 'revoke']);
  assert.match(await blob.text(), /renderer-only/); assert.match(anchor.download, /^t8-startup-.*\.log$/);
});

test('actual desktop export uses only native save IPC and preserves cancellation', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/startupDiagnostics.ts'), 'utf8');
  let called = 0;
  const helper = compile(source, { window: { t8pc: { startupDiagnostics: { save: async () => { called++; return { success: false, canceled: true }; } } } } });
  const result = await helper.saveStartupDiagnostics();
  assert.equal(result.canceled, true); assert.equal(called, 1);
});

function productionSaveHandler(context) {
  const filename = path.resolve(__dirname, '../src/components/StartupDiagnosticsSettings.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'save') expression = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(expression);
  return compile(`exports.save = (${expression});`, context).save;
}

test('actual settings save handler handles cancel/error and guards repeated clicks', async () => {
  for (const [response, expected] of [[{ success: true }, 'saved'], [{ success: false, canceled: true }, 'canceled'], [{ success: false }, 'failed']]) {
    const messages = [], busy = []; let resolve, calls = 0;
    const pending = new Promise((done) => { resolve = done; });
    const context = { inFlight: { current: false }, setBusy: (value) => busy.push(value), setMessage: (value) => messages.push(value), saveStartupDiagnostics: () => { calls++; return pending; } };
    const save = productionSaveHandler(context), flight = save(); await save();
    assert.equal(calls, 1); assert.equal(context.inFlight.current, true);
    resolve(response); await flight;
    assert.deepEqual(messages, [null, expected]); assert.deepEqual(busy, [true, false]); assert.equal(context.inFlight.current, false);
  }
  const messages = [];
  const save = productionSaveHandler({ inFlight: { current: false }, setBusy() {}, setMessage: (value) => messages.push(value), saveStartupDiagnostics: async () => { throw new Error('private stack'); } });
  await save(); assert.deepEqual(messages, [null, 'failed']);
});

test('settings, bilingual copy, preload and packaging wire the feature without DB migrations', () => {
  const root = path.resolve(__dirname, '..'), read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('src/components/ApiSettings.tsx'), /<StartupDiagnosticsSettings isPixel=\{isPixel\} \/>/);
  assert.match(read('src/components/StartupDiagnosticsSettings.tsx'), /type="button" disabled=\{busy\}/);
  assert.match(read('src/App.tsx'), /recordRendererStartupStage\(canvasStartupReadiness.stage\)/);
  assert.match(read('electron/preload.cjs'), /t8pc:startup-diagnostics:save/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, require('../package-lock.json').version); assert.ok(pkg.build.files.includes('electron/startupDiagnostics.cjs'));
  const contract = require('../scripts/electron-asar-contract.cjs');
  assert.ok(contract.REQUIRED_ELECTRON_ASAR_ENTRIES.includes('electron/startupDiagnostics.cjs'));
  const tree = ts.createSourceFile('resources.ts', read('src/i18n/resources.ts'), ts.ScriptTarget.Latest, true);
  const copies = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'startupDiagnostics') copies.push(compile(`exports.copy = (${node.initializer.getText(tree)});`).copy);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(copies.length, 2);
  assert.equal(copies[0].save, '保存启动日志');
  assert.equal(copies[1].save, 'Save startup log');
});

test('new renderer modules pass scoped semantic type-check against the actual IPC declaration', () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src/vite-env.d.ts'), 'utf8');
  const tree = ts.createSourceFile('vite-env.d.ts', source, ts.ScriptTarget.Latest, true);
  let bridge;
  function visit(node) {
    if (ts.isPropertySignature(node) && node.name.getText(tree) === 'startupDiagnostics') bridge = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(bridge);
  const virtual = path.join(root, 'src/startup-diagnostics-test-only.d.ts');
  const virtualSource = `interface Window { t8pc?: { ${bridge} } }`;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root).options;
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, language, ...args) => path.resolve(filename) === virtual ? ts.createSourceFile(filename, virtualSource, language, true) : original(filename, language, ...args);
  const program = ts.createProgram([path.join(root, 'src/utils/startupDiagnostics.ts'), path.join(root, 'src/components/StartupDiagnosticsSettings.tsx'), virtual], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
});
