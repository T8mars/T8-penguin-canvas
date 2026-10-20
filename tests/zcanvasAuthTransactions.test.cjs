'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const native = require('../tools/zcanvas-cli/src/secureStore.cjs');
const { readManifest } = require('../tools/zcanvas-cli/src/manifest.cjs');
const { createAgentControlAuthService } = require('../backend/src/services/agentControlAuth.js');
const cli = path.resolve(__dirname, '../tools/zcanvas-cli/bin/zcanvas.cjs');

async function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zcanvas-auth-transaction-'))), registry = path.join(root, 'instances'); fs.mkdirSync(registry);
  const options = { env: { ZCANVAS_AUTH_STORE: path.join(root, 'credentials.json'), ZCANVAS_ALLOW_FILE_CREDENTIALS: '1' } };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|systemroot|windir|comspec|temp|tmp|home|userprofile|localappdata|electron_run_as_node)$/i.test(key)));
  Object.assign(env, options.env, { ZCANVAS_INSTANCE_DIR: registry });
  const auth = createAgentControlAuthService(), state = { created: [], posts: 0, onPoll: undefined, onRead: undefined };
  const instance = { instanceId: 'E'.repeat(43), origin: '' };
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; assert.ok(raw.length < 8192); }
      if (req.url === '/api/status') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, service: 't8-penguin-canvas-backend', instanceId: instance.instanceId, port: server.address().port, version: '3.3.6' })); return; }
      let data; const body = raw ? JSON.parse(raw) : {};
      if (req.method === 'POST' && req.url === '/api/agent-control/v1/pairings') { state.posts++; data = auth.createPairing(body); state.created.push(data); }
      else if (req.method === 'POST' && /^\/api\/agent-control\/v1\/pairings\/[0-9a-f-]+\/poll$/.test(req.url)) { data = auth.pollPairing({ pairingId: req.url.split('/')[5], pollSecret: body.pollSecret }); state.onPoll?.(); }
      else if (req.method === 'GET' && ['/api/agent-control/v1/session', '/api/agent-control/v1/workspaces'].includes(req.url)) {
        state.onRead?.(); data = auth.authenticate(String(req.headers.authorization || '').replace(/^Bearer /, ''), []);
      } else throw Object.assign(Error('EXAMPLE_ROUTE_REFUSED'), { code: 'EXAMPLE_ROUTE_REFUSED', status: 400 });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ schema: 't8-agent-control-http-v1', ok: true, data }));
    } catch (error) { res.writeHead(error.status || 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ schema: 't8-agent-control-http-v1', ok: false, code: error.code || 'EXAMPLE_FAILED', message: 'EXAMPLE safe error' })); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); instance.origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = readManifest();
  const fields = ['skillVersion', 'cliVersion', 'controlProtocol', 'canvasPatchProtocol', 'nodeSchemaDigest', 'providerCatalogDigest', 'creativeCapabilityManifestDigest', 'creativeCapabilityGraphDigest', 'manifestDigest'];
  const descriptor = { ...Object.fromEntries(fields.map(field => [field, manifest[field]])), ...instance, schema: 't8-agent-control-instance-v1', appVersion: '3.3.6', heartbeatAt: new Date().toISOString(), staleAfterMs: 120000, pid: process.pid };
  fs.writeFileSync(path.join(registry, instance.instanceId + '.json'), JSON.stringify(descriptor));
  t.after(async () => { await new Promise(done => server.close(done)); const rel = path.relative(fs.realpathSync.native(os.tmpdir()), root); assert.ok(rel && !path.isAbsolute(rel) && !rel.startsWith('..')); fs.rmSync(root, { recursive: true, force: true }); });
  async function command(...args) {
    const child = spawn(process.execPath, ['--max-old-space-size=256', cli, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { code, json: JSON.parse(output) };
  }
  function approve(record = state.created.at(-1)) { return auth.approvePairing({ pairingId: record.pairingId, userCode: record.userCode, approvedBy: 'EXAMPLE_WINDOW_OWNER' }); }
  function replacePending() {
    const snapshot = native.readStore(options); snapshot.pending[instance.instanceId].expiresAt = new Date(Date.now() - 1).toISOString(); native.writeStore(snapshot, options);
    const pairing = auth.createPairing({ clientName: 'EXAMPLE_OTHER_AGENT' }); native.storePending(instance, pairing, options); return pairing;
  }
  function replaceSession() {
    const previous = native.loadSession(instance.instanceId, options); auth.revoke(previous.accessToken);
    const pairing = auth.createPairing({ clientName: 'EXAMPLE_OTHER_AGENT' }); native.storePending(instance, pairing, options); approve(pairing);
    const claimed = auth.pollPairing({ pairingId: pairing.pairingId, pollSecret: pairing.pollSecret }); native.storeSession(instance, claimed, options); return claimed;
  }
  return { root, options, instance, auth, state, command, approve, replacePending, replaceSession };
}

test('production CLI refuses a duplicate pairing before creating another window request', async t => {
  const f = await fixture(t); assert.equal((await f.command('auth', 'pair')).json.code, 'PAIRING_CONFIRMATION_REQUIRED');
  assert.equal((await f.command('auth', 'pair')).json.code, 'PAIRING_ALREADY_PENDING'); assert.equal(f.state.posts, 1);
});
test('production CLI denial cleanup preserves another client pending request', async t => {
  const f = await fixture(t); await f.command('auth', 'pair'); f.auth.denyPairing(f.state.created[0].pairingId);
  let replacement; f.state.onPoll = () => { f.state.onPoll = undefined; replacement = f.replacePending(); };
  assert.equal((await f.command('auth', 'complete')).json.code, 'PAIRING_PROGRESS_CHANGED');
  assert.equal(native.loadPending(f.instance.instanceId, f.options).pairingId, replacement.pairingId);
});
for (const [label, args] of [['auth status', ['auth', 'status']], ['workspace request', ['workspace', 'list']]]) {
  test(`production CLI ${label} cleanup preserves a newly saved session`, async t => {
    const f = await fixture(t); await f.command('auth', 'pair'); f.approve(); const completed = await f.command('auth', 'complete'); assert.equal(completed.json.ok, true);
    let replacement; f.state.onRead = () => { f.state.onRead = undefined; replacement = f.replaceSession(); };
    assert.equal((await f.command(...args)).json.code, 'PAIRING_PROGRESS_CHANGED');
    const saved = native.loadSession(f.instance.instanceId, f.options); assert.equal(saved.sessionId, replacement.sessionId); assert.ok(f.auth.authenticate(saved.accessToken, []).sessionId);
  });
}
