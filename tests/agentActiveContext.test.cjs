'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const express = require('express');
const { createActiveContextProvider } = require('../electron/agentContext.cjs');
const { createAgentControlContextService } = require('../backend/src/services/agentControlContext');
const { createAgentControlAuthService } = require('../backend/src/services/agentControlAuth');
const { createAgentControlRouter } = require('../backend/src/routes/agentControl');
const native = require('../tools/zcanvas-cli/src/secureStore.cjs');
const { readManifest } = require('../tools/zcanvas-cli/src/manifest.cjs');
const { compatibilitySnapshot } = require('../backend/src/services/agentControlCompatibility');
const vm = require('node:vm');
const ts = require('typescript');
const RESULT = 't8pc:agent-control:context-result';
const metadata = (canvasId = 'EXAMPLE_CANVAS') => ({ ready: true, projectId: 'project-local', canvasId, revision: 7,
  prompt: 'EXAMPLE_MUST_NOT_LEAK', thumbnail: 'EXAMPLE_MUST_NOT_LEAK' });

function harness() {
  const ipcMain = new EventEmitter();
  let windows = [];
  function window(id, context = metadata()) {
    const win = new EventEmitter(), wc = new EventEmitter();
    Object.assign(win, { id, webContents: wc, destroyed: false, focused: false, minimized: false,
      isDestroyed: () => win.destroyed, isFocused: () => win.focused, isMinimized: () => win.minimized });
    Object.assign(wc, { mainFrame: {}, loading: false, url: 'http://127.0.0.1:19032/', destroyed: false,
      isDestroyed: () => wc.destroyed, isLoadingMainFrame: () => wc.loading, getURL: () => wc.url });
    win.reply = (requestId, value = context, event = { sender: wc, senderFrame: wc.mainFrame }) =>
      ipcMain.emit(RESULT, event, { requestId, context: value });
    wc.send = (_channel, requestId) => { win.lastRequest = requestId; queueMicrotask(() => win.reply(requestId)); };
    windows.push(win); return win;
  }
  const provider = createActiveContextProvider({ ipcMain, getWindows: () => windows,
    isTrustedUrl: value => value === 'http://127.0.0.1:19032/', timeoutMs: 25 });
  return { ipcMain, provider, window, setWindows: value => { windows = value; } };
}

test('active context resolves a unique unfocused window, strips content, and never caches completed replies', async () => {
  const h = harness(), win = h.window(1);
  const first = await h.provider();
  assert.equal(first.status, 'resolved'); assert.equal(first.resolution, 'single-window');
  assert.equal(first.candidates[0].canvasId, 'EXAMPLE_CANVAS'); assert.equal(first.candidates[0].focused, false);
  assert.equal(JSON.stringify(first).includes('MUST_NOT_LEAK'), false);
  win.webContents.send = () => {};
  const next = await h.provider(); assert.equal(next.status, 'not-ready');
  assert.equal(next.candidates[0].reason, 'renderer-timeout'); assert.equal(next.activeWindowId, null);
  assert.equal(h.ipcMain.listenerCount(RESULT), 0);
});

test('multiple windows without native focus are ambiguous; focused loading window cannot select another canvas', async () => {
  const h = harness(), a = h.window(1), b = h.window(2, metadata('EXAMPLE_OTHER'));
  assert.equal((await h.provider()).status, 'ambiguous');
  b.focused = true;
  assert.equal((await h.provider()).activeWindowId, '2');
  b.webContents.loading = true;
  const loading = await h.provider();
  assert.equal(loading.activeWindowId, null);
  assert.equal(loading.status, 'not-ready'); assert.equal(loading.candidates[1].focused, true);
  a.focused = true; b.webContents.loading = false;
  assert.equal((await h.provider()).status, 'ambiguous');
});

test('foreign senders, subframes and wrong nonces cannot claim a canvas', async () => {
  for (const kind of ['sender', 'frame', 'nonce']) {
    const h = harness(), win = h.window(1);
    win.webContents.send = (_channel, id) => {
      win.reply(kind === 'nonce' ? 'EXAMPLE_WRONG' : id, metadata(), {
        sender: kind === 'sender' ? {} : win.webContents,
        senderFrame: kind === 'frame' ? {} : win.webContents.mainFrame,
      });
    };
    const data = await h.provider(); assert.equal(data.activeWindowId, null);
    assert.equal(data.candidates[0].canvasId, null);
    assert.equal(h.ipcMain.listenerCount(RESULT), 0);
  }
});

test('navigation or renderer crash invalidates even an already received candidate while another window is pending', async () => {
  for (const kind of ['reload', 'crash', 'close']) {
    const h = harness(), a = h.window(1), b = h.window(2);
    a.focused = true;
    b.webContents.send = () => {
      queueMicrotask(() => {
        if (kind === 'reload') a.webContents.emit('did-start-navigation', {}, a.webContents.url, false, true);
        if (kind === 'crash') a.webContents.emit('render-process-gone');
        if (kind === 'close') { a.destroyed = true; a.emit('closed'); }
      });
    };
    const data = await h.provider();
    assert.equal(data.activeWindowId, null); assert.equal(data.candidates[0].canvasId, null);
    assert.equal(a.webContents.listenerCount('did-start-navigation'), 0);
    assert.equal(a.listenerCount('closed'), 0);
  }
});

test('window restart never inherits a prior canvas; newly opened or truncated window lists never auto-resolve', async () => {
  const h = harness(); h.window(1);
  assert.equal((await h.provider()).activeWindowId, '1');
  h.setWindows([]); assert.equal((await h.provider()).status, 'unavailable');
  const restarted = h.window(2, { ready: false });
  assert.equal((await h.provider()).status, 'not-ready');
  restarted.webContents.send = (_channel, id) => { h.window(3); restarted.reply(id); };
  assert.equal((await h.provider()).status, 'ambiguous');
  h.setWindows([]); for (let i = 0; i < 9; i++) h.window(i + 1);
  const many = await h.provider(); assert.equal(many.status, 'ambiguous'); assert.equal(many.truncated, true);
  assert.equal(many.candidates.length, 8); assert.equal(h.ipcMain.listenerCount(RESULT), 0);
});

test('invalid metadata, non-app pages and minimized windows cannot masquerade as a focused ready target', async () => {
  for (const context of [metadata('a/b'), { ...metadata(), revision: 0 }, { ...metadata(), revision: Infinity }, { ready: false }]) {
    const h = harness(); h.window(1, context); assert.equal((await h.provider()).activeWindowId, null);
  }
  const h = harness(), win = h.window(1); win.webContents.url = 'https://example.invalid/';
  assert.equal((await h.provider()).status, 'not-ready');
  win.webContents.url = 'http://127.0.0.1:19032/'; win.focused = true; win.minimized = true;
  assert.equal((await h.provider()).candidates[0].focused, false);
});

test('concurrent polling shares only the in-flight native query and cleans all listeners', async () => {
  const h = harness(), win = h.window(1); let sends = 0;
  win.webContents.send = (_channel, id) => { sends++; setImmediate(() => win.reply(id)); };
  const replies = await Promise.all(Array.from({ length: 30 }, () => h.provider()));
  assert.equal(sends, 1); assert.ok(replies.every(row => row.activeWindowId === '1'));
  await h.provider(); assert.equal(sends, 2); assert.equal(h.ipcMain.listenerCount(RESULT), 0);
});

test('production Canvas reporter checks current, loaded and initialized identities and reads the latest acknowledged revision', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/agentActiveContext.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  let handler, removed = false;
  const source = { loaded: true, canvasId: 'EXAMPLE_A', currentCanvasId: 'EXAMPLE_A', loadedCanvasId: 'EXAMPLE_A',
    initializedCanvasId: 'EXAMPLE_A', projectId: 'project-local', revision: 3 };
  const dispose = exports.registerCanvasActiveContext({ onActiveContextRequest(callback) { handler = callback; return () => { removed = true; }; } }, () => source);
  assert.equal(handler().revision, 3); source.revision = 4; assert.equal(handler().revision, 4);
  for (const key of ['currentCanvasId', 'loadedCanvasId', 'initializedCanvasId']) {
    source[key] = 'EXAMPLE_B'; assert.equal(handler().ready, false); source[key] = 'EXAMPLE_A';
  }
  source.loaded = false; assert.equal(handler().ready, false); dispose(); assert.equal(removed, true);
  Object.assign(source, { loaded: true, canvasId: null, currentCanvasId: null, loadedCanvasId: null, initializedCanvasId: null });
  assert.equal(handler().ready, false);
  assert.equal(exports.registerCanvasActiveContext(undefined, () => { throw Error('Must not inspect browser state'); }), undefined);
  const canvas = fs.readFileSync(path.join(__dirname, '../src/components/Canvas.tsx'), 'utf8');
  assert.match(canvas, /useEffect\(\(\) => registerCanvasActiveContext/);
  assert.match(canvas, /currentCanvasId: useCanvasStore.getState\(\).activeId/);
  assert.match(canvas, /revision: activeId \? canvasRevisionsRef.current.get\(activeId\) : undefined/);
});

async function fixture(t) {
  const auth = createAgentControlAuthService(), contextService = createAgentControlContextService();
  const h = harness(); h.window(1); contextService.setProvider(h.provider);
  const app = express(), server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { PORT: server.address().port, APP_VERSION: '3.3.9', BACKEND_INSTANCE_ID: 'E'.repeat(43) };
  app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ ok: true, service: 't8-penguin-canvas-backend',
    instanceId: config.BACKEND_INSTANCE_ID, port: config.PORT, version: config.APP_VERSION }));
  app.use('/api/agent-control/v1', createAgentControlRouter({ auth, contextService, config,
    database: new Proxy({}, { get() { throw Error('No user database may be read'); } }) }));
  function session(scopes) {
    const pairing = auth.createPairing({ clientName: 'EXAMPLE_TEMP', requestedScopes: scopes });
    auth.approvePairing({ pairingId: pairing.pairingId, userCode: pairing.userCode, approvedScopes: scopes });
    return auth.pollPairing({ pairingId: pairing.pairingId, pollSecret: pairing.pollSecret });
  }
  async function request(suffix, token, extra = {}) {
    const response = await fetch(`http://127.0.0.1:${config.PORT}/api/agent-control/v1${suffix}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    });
    return { status: response.status, body: await response.json() };
  }
  return { config, contextService, h, auth, session, request };
}

test('real HTTP requires existing canvas:read pairing, rejects browser origins, exposes no context publicly and does not touch DB', async t => {
  const f = await fixture(t);
  const publicStatus = await f.request('/status');
  assert.equal(publicStatus.body.data.activeContext.schema, 't8-agent-active-context-v1');
  assert.equal(JSON.stringify(publicStatus.body).includes('EXAMPLE_CANVAS'), false);
  assert.equal((await f.request('/active-context')).status, 401);
  assert.equal((await f.request('/active-context', f.session(['run:read']).accessToken)).status, 403);
  const reader = f.session(['canvas:read']);
  assert.equal((await f.request('/active-context', reader.accessToken, { Origin: 'http://example.invalid' })).status, 403);
  const result = await f.request('/active-context', reader.accessToken);
  assert.equal(result.status, 200); assert.equal(result.body.data.instanceId, f.config.BACKEND_INSTANCE_ID);
  assert.equal(result.body.data.status, 'resolved');
  f.contextService.setProvider(() => { throw Error('EXAMPLE_PRIVATE_PATH'); });
  const failed = await f.request('/active-context', reader.accessToken);
  assert.equal(failed.body.data.status, 'unavailable'); assert.equal(JSON.stringify(failed).includes('PRIVATE_PATH'), false);
  f.auth.revoke(reader.accessToken); assert.equal((await f.request('/active-context', reader.accessToken)).status, 401);
});

test('production CLI active reads the native API without changing Agent workspace, credentials or approvals', async t => {
  const f = await fixture(t);
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 't8-active-cli-')));
  t.after(() => { const rel = path.relative(fs.realpathSync.native(os.tmpdir()), temp);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel)); fs.rmSync(temp, { recursive: true, force: true }); });
  const registry = path.join(temp, 'instances'); fs.mkdirSync(registry);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|systemroot|windir|comspec|temp|tmp|home|userprofile|localappdata|electron_run_as_node)$/i.test(key)));
  Object.assign(env, { ZCANVAS_AUTH_STORE: path.join(temp, 'credentials.json'), ZCANVAS_ALLOW_FILE_CREDENTIALS: '1', ZCANVAS_INSTANCE_DIR: registry });
  const instance = { instanceId: f.config.BACKEND_INSTANCE_ID, origin: `http://127.0.0.1:${f.config.PORT}` };
  const manifest = readManifest(); assert.equal(manifest.manifestDigest, compatibilitySnapshot().manifestDigest);
  const fields = ['skillVersion', 'cliVersion', 'controlProtocol', 'canvasPatchProtocol', 'nodeSchemaDigest', 'providerCatalogDigest', 'creativeCapabilityManifestDigest', 'creativeCapabilityGraphDigest', 'manifestDigest'];
  fs.writeFileSync(path.join(registry, instance.instanceId + '.json'), JSON.stringify({
    ...Object.fromEntries(fields.map(key => [key, manifest[key]])), ...instance, schema: 't8-agent-control-instance-v1',
    appVersion: '3.3.9', heartbeatAt: new Date().toISOString(), staleAfterMs: 120000, pid: process.pid }));
  const pairing = f.auth.createPairing({ clientName: 'EXAMPLE_CLI', requestedScopes: ['canvas:read'] });
  native.storePending(instance, pairing, { env });
  f.auth.approvePairing({ pairingId: pairing.pairingId, userCode: pairing.userCode, approvedScopes: ['canvas:read'] });
  native.storeSession(instance, f.auth.pollPairing({ pairingId: pairing.pairingId, pollSecret: pairing.pollSecret }), { env });
  native.setWorkspaceContext(instance.instanceId, { projectId: 'project-local', canvasId: 'EXAMPLE_AGENT_CHOSEN' }, { env });
  const before = fs.readFileSync(env.ZCANVAS_AUTH_STORE);
  const child = spawn(process.execPath, ['--max-old-space-size=256', path.resolve(__dirname, '../tools/zcanvas-cli/bin/zcanvas.cjs'),
    'workspace', 'active', '--instance', instance.instanceId], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, error); const data = JSON.parse(output).data;
  assert.equal(data.schema, 't8-agent-active-context-v1'); assert.equal(data.candidates[0].canvasId, 'EXAMPLE_CANVAS');
  assert.ok(before.equals(fs.readFileSync(env.ZCANVAS_AUTH_STORE)), 'Read-only command must not write the credential/workspace store');
  assert.equal(f.auth.listPendingPairings().length, 0);
});
