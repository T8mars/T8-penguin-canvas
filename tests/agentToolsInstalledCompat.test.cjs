'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createAgentToolsManager, registerAgentToolsIpc, COMPATIBILITY_FIELDS } = require('../electron/agentTools.cjs');
const installer = require('../tools/zcanvas-cli/src/installer.cjs');
const { readManifest } = require('../tools/zcanvas-cli/src/manifest.cjs');
const { compatibilitySnapshot } = require('../backend/src/services/agentControlCompatibility');
const { selectInstance, assertCompatibleInstance, requestAgentControl } = require('../tools/zcanvas-cli/src/agentClient.cjs');
const { createAgentControlAuthService } = require('../backend/src/services/agentControlAuth');
const { createAgentControlRouter } = require('../backend/src/routes/agentControl');
const project = path.resolve(__dirname, '..');

function fixture(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 't8-installed-cli-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), sandbox);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
  const resources = path.join(sandbox, '安装资源 & 目录');
  fs.cpSync(path.join(project, 'tools/zcanvas-cli'), path.join(resources, 'tools/zcanvas-cli'), { recursive: true });
  fs.cpSync(path.join(project, '.agents/skills/zhenzhen-canvas'), path.join(resources, 'agent/skills/zhenzhen-canvas'), { recursive: true });
  const provider = path.join(resources, 'backend-enc/shared/creativeModelCatalog.json');
  fs.mkdirSync(path.dirname(provider), { recursive: true });
  fs.copyFileSync(path.join(project, 'backend/src/shared/creativeModelCatalog.json'), provider);
  const installRoot = path.join(sandbox, '用户受管 Agent');
  const live = () => compatibilitySnapshot({ resourcesPath: resources });
  const manager = createAgentToolsManager({ sourceRoot: resources, packaged: true, getCompatibility: live, installOptions: { installRoot } });
  return { sandbox, resources, installRoot, live, manager };
}

test('desktop export installs only on explicit repair, compares all nine live fields, and preserves rollback on a no-op', t => {
  const f = fixture(t);
  assert.equal(f.manager.status().state, 'missing');
  assert.equal(fs.existsSync(f.installRoot), false);
  const first = f.manager.repair();
  assert.equal(first.changed, true); assert.equal(first.state, 'current');
  assert.equal(first.source, 'electron-resources');
  assert.deepEqual(first.compatibility, f.live());
  assert.equal(COMPATIBILITY_FIELDS.length, 9);
  assert.deepEqual(installer.readInstallManifest(f.installRoot).discoveryRoots, []);
  const receipt = fs.readFileSync(path.join(f.installRoot, installer.INSTALL_MANIFEST));
  assert.equal(f.manager.repair().changed, false);
  assert.deepEqual(fs.readFileSync(path.join(f.installRoot, installer.INSTALL_MANIFEST)), receipt);
  assert.equal(fs.existsSync(`${f.installRoot}.last-known-good`), false);
});

test('same-version old contents refresh from the running bundle, not cached metadata or development sources', async t => {
  const f = fixture(t), old = path.join(f.sandbox, 'old-resources');
  fs.cpSync(f.resources, old, { recursive: true });
  const manifestPath = path.join(old, 'tools/zcanvas-cli/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.minimumDesktopVersion = '2.6.3';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const discovery = path.join(f.sandbox, 'owned-discovery');
  installer.install({ projectRoot: old, installRoot: f.installRoot, discoveryRoots: [discovery] });
  const oldReceipt = installer.readInstallManifest(f.installRoot);
  const runtime = path.join(f.installRoot, 'runtime', manifest.cliVersion);
  const before = readManifest({ rootDirectory: runtime });
  assert.equal(f.manager.status().state, 'outdated');
  const instance = { ...f.live(), appVersion: '3.3.8', instanceId: 'x'.repeat(43) };
  await assert.rejects(selectInstance('', { manifest: before, discoverInstances: async () => [instance] }), { code: 'AGENT_MANIFEST_DIGEST_MISMATCH' });
  const credentials = path.join(f.sandbox, 'credentials-v1.json');
  fs.writeFileSync(credentials, 'EXAMPLE_UNCHANGED_CREDENTIALS');
  const result = f.manager.repair();
  assert.equal(result.state, 'current'); assert.equal(result.changed, true);
  assert.equal(result.cliVersion, manifest.cliVersion);
  assert.equal(result.cliRoot, runtime);
  assert.notEqual(result.sourceDigest, oldReceipt.sourceDigest);
  assert.equal(installer.readInstallManifest(`${f.installRoot}.last-known-good`).sourceDigest, oldReceipt.sourceDigest);
  assert.equal(installer.verifyInstallation({ installRoot: f.installRoot }).verified, true);
  const fresh = readManifest({ rootDirectory: runtime });
  for (const field of COMPATIBILITY_FIELDS) assert.equal(fresh[field], instance[field], field);
  assert.equal(await selectInstance('', { manifest: fresh, discoverInstances: async () => [instance] }), instance);
  const sourceModule = require(path.join(result.cliRoot, 'src/manifest.cjs')).readManifest();
  for (const field of COMPATIBILITY_FIELDS) assert.equal(sourceModule[field], instance[field], field);
  assert.equal(fs.readFileSync(credentials, 'utf8'), 'EXAMPLE_UNCHANGED_CREDENTIALS');
  assert.deepEqual(installer.readInstallManifest(f.installRoot).discoveryRoots, [discovery]);
  const rollbackDigest = installer.readInstallManifest(`${f.installRoot}.last-known-good`).sourceDigest;
  assert.equal(f.manager.repair().changed, false);
  assert.equal(installer.readInstallManifest(`${f.installRoot}.last-known-good`).sourceDigest, rollbackDigest);
});

test('same version and same compatibility are insufficient when executable source bytes differ', t => {
  const f = fixture(t); f.manager.repair();
  fs.appendFileSync(path.join(f.resources, 'tools/zcanvas-cli/src/discovery.cjs'), '\n// EXAMPLE_NEW_BUNDLED_BYTES\n');
  assert.equal(f.manager.status().state, 'outdated');
  assert.equal(f.manager.repair().state, 'current');
  assert.match(fs.readFileSync(path.join(f.installRoot, 'runtime/0.1.0-dev/src/discovery.cjs'), 'utf8'), /EXAMPLE_NEW_BUNDLED_BYTES/);
});

test('each mismatching live field stops export before any installation or pairing', t => {
  const f = fixture(t);
  for (const field of COMPATIBILITY_FIELDS) {
    const manager = createAgentToolsManager({ sourceRoot: f.resources, packaged: true, installOptions: { installRoot: f.installRoot }, getCompatibility: () => ({ ...f.live(), [field]: 'EXAMPLE_MISMATCH' }) });
    assert.throws(() => manager.repair(), e => e.code === 'AGENT_TOOLS_SOURCE_MISMATCH' && e.fields.includes(field));
    assert.equal(fs.existsSync(f.installRoot), false);
  }
  const manager = createAgentToolsManager({ sourceRoot: f.resources, packaged: true, installOptions: { installRoot: f.installRoot }, getCompatibility: () => null });
  assert.throws(() => manager.repair(), { code: 'AGENT_CONTROL_NOT_READY' });
  assert.equal(fs.existsSync(f.installRoot), false);
});

test('unowned destinations are preserved and damaged owned files can be repaired', t => {
  const f = fixture(t); fs.mkdirSync(f.installRoot);
  const sentinel = path.join(f.installRoot, 'EXAMPLE_USER_FILE'); fs.writeFileSync(sentinel, 'keep');
  assert.equal(f.manager.status().state, 'unmanaged');
  assert.throws(() => f.manager.repair(), { code: 'AGENT_TOOLS_TARGET_UNMANAGED' });
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  const separate = path.join(f.sandbox, 'separate-owned');
  const manager = createAgentToolsManager({ sourceRoot: f.resources, packaged: true, getCompatibility: f.live, installOptions: { installRoot: separate } });
  manager.repair();
  fs.appendFileSync(path.join(separate, 'runtime/0.1.0-dev/src/discovery.cjs'), '\n// tampered');
  assert.equal(manager.status().state, 'damaged');
  assert.equal(manager.repair().state, 'current');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});

test('a source change while copying cannot replace the existing same-version export', t => {
  const f = fixture(t); f.manager.repair();
  const oldReceipt = fs.readFileSync(path.join(f.installRoot, installer.INSTALL_MANIFEST));
  fs.appendFileSync(path.join(f.resources, 'tools/zcanvas-cli/src/discovery.cjs'), '\n// EXAMPLE_UPDATE\n');
  const copy = fs.copyFileSync; let injected = false;
  fs.copyFileSync = function (source, destination, ...args) {
    const result = copy.call(fs, source, destination, ...args);
    if (!injected && source === path.join(f.resources, 'tools/zcanvas-cli/src/discovery.cjs')) {
      injected = true; fs.appendFileSync(destination, '\n// EXAMPLE_COPY_RACE\n');
    }
    return result;
  };
  try { assert.throws(() => f.manager.repair(), { code: 'INSTALL_SOURCE_CHANGED' }); }
  finally { fs.copyFileSync = copy; }
  assert.equal(injected, true);
  assert.deepEqual(fs.readFileSync(path.join(f.installRoot, installer.INSTALL_MANIFEST)), oldReceipt);
  assert.equal(installer.verifyInstallation({ installRoot: f.installRoot }).verified, true);
  assert.equal(fs.existsSync(`${f.installRoot}.last-known-good`), false);
});

test('native IPC is main-frame-only, has no renderer-controlled paths, and sanitizes errors', t => {
  fixture(t);
  const handlers = new Map(), frame = {}, window = { webContents: { id: 11, mainFrame: frame }, isDestroyed: () => false };
  let calls = 0;
  registerAgentToolsIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getWindow: () => window,
    assertTrusted: e => { if (e.sender !== window.webContents) throw Error('EXAMPLE_PRIVATE_PATH'); },
    getManager: () => ({ status: () => ({ state: 'missing' }), repair: (...args) => { assert.equal(args.length, 0); calls++; return { state: 'current' }; } }),
  });
  const repair = handlers.get('t8pc:agent-tools:repair'), event = { sender: window.webContents, senderFrame: frame };
  assert.equal(repair({ ...event, sender: {} }).success, false);
  assert.equal(repair({ ...event, senderFrame: {} }).success, false);
  assert.equal(calls, 0);
  assert.equal(repair(event, { sourceRoot: 'EXAMPLE_ATTACKER_PATH', installRoot: 'EXAMPLE_ROOT' }).success, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(repair({ sender: {} })), /EXAMPLE_PRIVATE_PATH/);
});

test('exported CLI matches actual public HTTP status and pairing stays pending without native approval', async t => {
  const f = fixture(t), result = f.manager.repair();
  const auth = createAgentControlAuthService(), app = express();
  const config = { PORT: 0, APP_VERSION: '3.3.8', BACKEND_INSTANCE_ID: 'z'.repeat(43) };
  app.use(express.json());
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.PORT = server.address().port;
  app.use('/api/agent-control/v1', createAgentControlRouter({ auth, config, database: new Proxy({}, { get() { throw Error('Database access forbidden'); } }) }));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const instance = { origin: `http://127.0.0.1:${config.PORT}` };
  const status = await requestAgentControl(instance, '/api/agent-control/v1/status');
  const exported = readManifest({ rootDirectory: result.cliRoot });
  for (const field of COMPATIBILITY_FIELDS) assert.equal(exported[field], status.data[field], field);
  assertCompatibleInstance(status.data, { manifest: exported });
  assert.equal(auth.listPendingPairings().length, 0);
  const pairing = await requestAgentControl(instance, '/api/agent-control/v1/pairings', { method: 'POST', body: { clientName: 'EXAMPLE_TEMP_READ_ONLY', agentKind: 'test', requestedScopes: ['canvas:read'] } });
  assert.equal(pairing.data.status, 'pending');
  assert.deepEqual(auth.listPendingPairings()[0].requestedScopes, ['canvas:read']);
  await assert.rejects(requestAgentControl(instance, '/api/agent-control/v1/session'), { code: 'PAIRING_REQUIRED' });
  assert.equal(auth.connectionSummary().activeSessionCount, 0);
});
