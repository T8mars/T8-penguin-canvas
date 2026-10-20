'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const store = require('../tools/zcanvas-cli/src/secureStore.cjs');
const modulePath = require.resolve('../tools/zcanvas-cli/src/secureStore.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const worker = String.raw`
const fs=require('node:fs'),path=require('node:path');
const [modulePath,root,mode,id,pairingId]=process.argv.slice(1), store=require(modulePath), file=path.join(root,'credentials.json');
const wait=new Int32Array(new SharedArrayBuffer(4));
function barrier(label){fs.writeFileSync(path.join(root,label+'-'+id),'ready');const end=Date.now()+8000;while(!fs.existsSync(path.join(root,'release'))){if(Date.now()>end)throw Error('EXAMPLE_BARRIER_TIMEOUT');Atomics.wait(wait,0,0,10);}}
const options={env:{ZCANVAS_AUTH_STORE:file},platform:'test',protect(value){if(mode==='session-hold'||mode==='recipe')barrier('ready');return Buffer.from(String(value)).toString('base64');},unprotect(value){return Buffer.from(value,'base64').toString();}};
if(mode==='crash'){const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to===file)barrier('ready');return rename(from,to);};}
try{
 if(mode==='recipe'){const result=store.getRecipeSigningSecret(options);console.log(JSON.stringify({keyId:result.keyId}));}
 else{const instance={instanceId:id,origin:'http://127.0.0.1:18766'};store.storeSession(instance,{sessionId:'EXAMPLE_SESSION_'+id,accessToken:'EXAMPLE_ONLY_SESSION_TOKEN',expiresAt:new Date(Date.now()+3600000).toISOString(),...(pairingId?{pairingId}:{})},options);console.log(JSON.stringify({saved:true}));}
}catch(error){console.log(JSON.stringify({code:error.code||'EXAMPLE_FAILED'}));process.exitCode=2;}
`;
async function setup(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'zcanvas-store-transaction-'))), file = path.join(root, 'credentials.json'), children = [];
  const options = { env: { ZCANVAS_AUTH_STORE: file }, platform: 'test', protect: value => Buffer.from(String(value)).toString('base64'), unprotect: value => Buffer.from(value, 'base64').toString() };
  t.after(async () => {
    for (const child of children) { if (child.process.exitCode == null && child.process.signalCode == null) child.process.kill(); await child.done; }
    const rel = path.relative(fs.realpathSync.native(os.tmpdir()), root); assert.ok(rel && !path.isAbsolute(rel) && !rel.startsWith('..'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  function start(mode, id, pairingId = '') {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|systemroot|windir|temp|tmp|home|userprofile|localappdata|electron_run_as_node)$/i.test(name)));
    const processHandle = spawn(process.execPath, ['--max-old-space-size=128', '-e', worker, modulePath, root, mode, id, pairingId], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', diagnostic = ''; processHandle.stdout.on('data', chunk => { text += chunk; }); processHandle.stderr.on('data', chunk => { diagnostic += chunk; });
    const done = new Promise((resolve, reject) => { processHandle.once('error', reject); processHandle.once('close', code => resolve({ code, value: text.trim() ? JSON.parse(text.trim()) : null, diagnostic })); });
    const child = { process: processHandle, done }; children.push(child); return child;
  }
  async function ready(id) { const end = Date.now() + 7000; while (!fs.existsSync(path.join(root, 'ready-' + id))) { if (Date.now() > end) throw Error('EXAMPLE_WORKER_NOT_READY'); await pause(15); } }
  const release = () => fs.writeFileSync(path.join(root, 'release'), 'continue');
  const instance = id => ({ instanceId: id, origin: 'http://127.0.0.1:18766' });
  const pairing = (id, expiresAt = Date.now() + 60000) => ({ pairingId: id, userCode: 'ABCD2345', pollSecret: 'EXAMPLE_ONLY_POLL_SECRET', expiresAt: new Date(expiresAt).toISOString() });
  return { root, file, options, start, ready, release, instance, pairing };
}

test('native secureStore preserves another process context while session protection is paused', async t => {
  const f = await setup(t), a = f.start('session-hold', 'EXAMPLE_A'); await f.ready('EXAMPLE_A');
  store.setWorkspaceContext('EXAMPLE_B', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  f.release(); assert.equal((await a.done).code, 0);
  const data = store.readStore(f.options); assert.ok(data.sessions.EXAMPLE_A); assert.ok(data.contexts.EXAMPLE_B);
});
test('concurrent native recipe signing initialization returns one shared key identity', async t => {
  const f = await setup(t), children = ['EXAMPLE_A', 'EXAMPLE_B', 'EXAMPLE_C'].map(id => f.start('recipe', id));
  await Promise.all(['EXAMPLE_A', 'EXAMPLE_B', 'EXAMPLE_C'].map(id => f.ready(id))); f.release();
  const results = await Promise.all(children.map(child => child.done)); assert.ok(results.every(result => result.code === 0), JSON.stringify(results.map(result => ({ code: result.code, error: result.value?.code }))));
  assert.equal(new Set(results.map(result => result.value.keyId)).size, 1);
  assert.equal(store.getRecipeSigningSecret(f.options).keyId, results[0].value.keyId);
});
test('public native snapshot writes refuse a stale read without dropping current records', async t => {
  const f = await setup(t), stale = store.readStore(f.options);
  store.setWorkspaceContext('EXAMPLE_B', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  assert.throws(() => store.writeStore(stale, f.options), error => error.code === 'CREDENTIAL_STORE_CHANGED');
  assert.ok(store.readStore(f.options).contexts.EXAMPLE_B);
});
test('native pending writes refuse another unexpired request for the same instance', async t => {
  const f = await setup(t), instance = f.instance('EXAMPLE_A');
  store.storePending(instance, f.pairing('EXAMPLE_PAIR_A'), f.options);
  assert.throws(() => store.storePending(instance, f.pairing('EXAMPLE_PAIR_B'), f.options), error => error.code === 'PAIRING_ALREADY_PENDING');
  assert.equal(store.loadPending(instance.instanceId, f.options).pairingId, 'EXAMPLE_PAIR_A');
});
test('native session commit checks its pairing again after slow protection', async t => {
  const f = await setup(t), instance = f.instance('EXAMPLE_A'), expires = Date.now() + 100;
  store.storePending(instance, f.pairing('EXAMPLE_PAIR_A', expires), f.options);
  const a = f.start('session-hold', instance.instanceId, 'EXAMPLE_PAIR_A'); await f.ready(instance.instanceId);
  while (Date.now() <= expires) await pause(10);
  store.storePending(instance, f.pairing('EXAMPLE_PAIR_B'), f.options); f.release();
  const result = await a.done; assert.equal(result.value.code, 'PAIRING_PROGRESS_CHANGED');
  assert.equal(store.loadPending(instance.instanceId, f.options).pairingId, 'EXAMPLE_PAIR_B'); assert.equal(store.loadSession(instance.instanceId, f.options), null);
});
test('conditional native deletion cannot remove a newer pairing or session', async t => {
  const f = await setup(t), instance = f.instance('EXAMPLE_A');
  store.storePending(instance, f.pairing('EXAMPLE_NEW_PAIR'), f.options);
  assert.throws(() => store.deletePending(instance.instanceId, { ...f.options, expectedPairingId: 'EXAMPLE_OLD_PAIR' }), error => error.code === 'PAIRING_PROGRESS_CHANGED');
  store.storeSession(f.instance('EXAMPLE_B'), { sessionId: 'EXAMPLE_NEW_SESSION', accessToken: 'EXAMPLE_ONLY_TOKEN', expiresAt: new Date(Date.now() + 60000).toISOString() }, f.options);
  assert.throws(() => store.deleteSession('EXAMPLE_B', { ...f.options, expectedSessionId: 'EXAMPLE_OLD_SESSION' }), error => error.code === 'PAIRING_PROGRESS_CHANGED');
  assert.equal(store.loadPending(instance.instanceId, f.options).pairingId, 'EXAMPLE_NEW_PAIR'); assert.equal(store.loadSession('EXAMPLE_B', f.options).sessionId, 'EXAMPLE_NEW_SESSION');
});
test('a live native writer causes bounded busy failure and a killed writer recovers without replacing the checkpoint', async t => {
  const f = await setup(t); store.setWorkspaceContext('EXAMPLE_BASE', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  const a = f.start('crash', 'EXAMPLE_CRASH'); await f.ready('EXAMPLE_CRASH');
  assert.throws(() => store.setWorkspaceContext('EXAMPLE_BLOCKED', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options), error => error.code === 'CREDENTIAL_STORE_BUSY');
  a.process.kill(); await a.done;
  store.setWorkspaceContext('EXAMPLE_AFTER', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  const data = store.readStore(f.options); assert.ok(data.contexts.EXAMPLE_BASE); assert.ok(data.contexts.EXAMPLE_AFTER); assert.equal(data.contexts.EXAMPLE_BLOCKED, undefined); assert.equal(data.sessions.EXAMPLE_CRASH, undefined);
  assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')).length, 0);
});

test('multiple native processes reclaim a dead writer and preserve every new session', async t => {
  const f = await setup(t), dead = f.start('crash', 'EXAMPLE_DEAD'); await f.ready('EXAMPLE_DEAD'); dead.process.kill(); await dead.done;
  const ids = ['EXAMPLE_A', 'EXAMPLE_B', 'EXAMPLE_C', 'EXAMPLE_D'];
  const outcomes = await Promise.all(ids.map(id => f.start('session', id).done));
  assert.ok(outcomes.every(result => result.code === 0), JSON.stringify(outcomes.map(result => ({ code: result.code, error: result.value?.code }))));
  const data = store.readStore(f.options); assert.ok(ids.every(id => Boolean(data.sessions[id]))); assert.equal(data.sessions.EXAMPLE_DEAD, undefined);
  assert.equal(fs.readdirSync(f.file + '.lock-state').length, 0); assert.equal(fs.existsSync(f.file + '.lock'), false);
});

test('native snapshot writes preserve version-1 layout and permit a refreshed same-object update', async t => {
  const f = await setup(t), initial = store.readStore(f.options);
  initial.contexts.EXAMPLE_A = { instanceId: 'EXAMPLE_A', projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS', selectedAt: new Date().toISOString() };
  store.writeStore(initial, f.options); initial.contexts.EXAMPLE_B = { ...initial.contexts.EXAMPLE_A, instanceId: 'EXAMPLE_B' }; store.writeStore(initial, f.options);
  const data = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.deepEqual(Object.keys(data).sort(), ['approvals', 'contexts', 'pending', 'recipeSigning', 'schema', 'sessions']);
  assert.equal(data.schema, 't8-zcanvas-secure-store-v1'); assert.ok(data.contexts.EXAMPLE_A && data.contexts.EXAMPLE_B);
  assert.equal('revision' in data, false); assert.equal('lock' in data, false);
});

test('corrupt lock metadata fails closed and protection failure leaves the existing checkpoint untouched', async t => {
  const f = await setup(t); store.setWorkspaceContext('EXAMPLE_BASE', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  const before = fs.readFileSync(f.file);
  fs.writeFileSync(f.file + '.lock', 'EXAMPLE_UNRECOGNIZED_LOCK');
  assert.throws(() => store.setWorkspaceContext('EXAMPLE_BLOCKED', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options), error => error.code === 'CREDENTIAL_STORE_LOCK_INVALID');
  assert.deepEqual(fs.readFileSync(f.file), before); fs.unlinkSync(f.file + '.lock');
  assert.throws(() => store.storeSession(f.instance('EXAMPLE_A'), { sessionId: 'EXAMPLE_SESSION', accessToken: 'EXAMPLE_ONLY_TOKEN', expiresAt: new Date(Date.now() + 60000).toISOString() }, { ...f.options, protect() { throw Error('EXAMPLE_PROTECTION_FAILED'); } }), /EXAMPLE_PROTECTION_FAILED/);
  assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(f.file + '.lock'), false);
});

test('native approvals and a selected workspace survive a concurrent session update', async t => {
  const f = await setup(t), a = f.start('session-hold', 'EXAMPLE_A'); await f.ready('EXAMPLE_A');
  store.storeApproval(f.instance('EXAMPLE_A'), { approvalRequestId: 'EXAMPLE_APPROVAL_A', action: 'creative.apply', pollSecret: 'EXAMPLE_ONLY_POLL', expiresAt: new Date(Date.now() + 60000).toISOString() }, f.options);
  store.storeApproval(f.instance('EXAMPLE_A'), { approvalRequestId: 'EXAMPLE_APPROVAL_B', action: 'creative.apply', pollSecret: 'EXAMPLE_ONLY_POLL', expiresAt: new Date(Date.now() + 60000).toISOString() }, f.options);
  store.setWorkspaceContext('EXAMPLE_A', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  f.release(); assert.equal((await a.done).code, 0);
  assert.ok(store.loadApproval('EXAMPLE_A', 'EXAMPLE_APPROVAL_A', f.options)); assert.ok(store.loadApproval('EXAMPLE_A', 'EXAMPLE_APPROVAL_B', f.options)); assert.ok(store.getWorkspaceContext('EXAMPLE_A', f.options));
  store.deleteApproval('EXAMPLE_A', 'EXAMPLE_APPROVAL_A', f.options);
  assert.equal(store.loadApproval('EXAMPLE_A', 'EXAMPLE_APPROVAL_A', f.options), null); assert.ok(store.loadApproval('EXAMPLE_A', 'EXAMPLE_APPROVAL_B', f.options));
});

test('same pending identity is immutable and a sidecar directory link is refused', async t => {
  const f = await setup(t), instance = f.instance('EXAMPLE_A'), pending = f.pairing('EXAMPLE_PAIR_A');
  store.storePending(instance, pending, f.options); const before = fs.readFileSync(f.file);
  store.storePending(instance, pending, f.options); assert.deepEqual(fs.readFileSync(f.file), before);
  assert.throws(() => store.storePending({ ...instance, origin: 'http://127.0.0.1:18767' }, pending, f.options), error => error.code === 'PAIRING_PROGRESS_CHANGED');
  const state = f.file + '.lock-state', external = path.join(f.root, 'EXAMPLE_OTHER_DIRECTORY');
  fs.rmdirSync(state); fs.mkdirSync(external); fs.symlinkSync(external, state, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store.setWorkspaceContext('EXAMPLE_BLOCKED', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options), error => error.code === 'CREDENTIAL_STORE_LOCK_INVALID');
  assert.equal(fs.readdirSync(external).length, 0); assert.deepEqual(fs.readFileSync(f.file), before);
});

test('failed fsync leaves the native checkpoint unchanged and removes its own lease and temporary file', async t => {
  const f = await setup(t); store.setWorkspaceContext('EXAMPLE_BASE', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options);
  const before = fs.readFileSync(f.file), original = fs.fsyncSync;
  try { fs.fsyncSync = () => { throw Object.assign(Error('EXAMPLE_DISK_FAILURE'), { code: 'EIO' }); };
    assert.throws(() => store.setWorkspaceContext('EXAMPLE_BLOCKED', { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' }, f.options), error => error.code === 'CREDENTIAL_STORE_LOCK_UNAVAILABLE');
  } finally { fs.fsyncSync = original; }
  assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(f.file + '.lock'), false);
  assert.equal(fs.readdirSync(f.file + '.lock-state').length, 0); assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0);
});
