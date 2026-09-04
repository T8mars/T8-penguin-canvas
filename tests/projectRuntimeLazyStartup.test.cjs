const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtimeModule = require('../backend/src/services/projectRuntime');

test('project routes can be required without opening the shared project database', () => {
  assert.equal(runtimeModule.getProjectStorageRuntimeStatus().status, 'idle');
  const runsRouter = require('../backend/src/routes/projectRuns');
  const assetsRouter = require('../backend/src/routes/projectAssets');
  assert.equal(runsRouter.peekRuntime(), null);
  assert.equal(assetsRouter.peekRuntime(), null);
  assert.equal(runtimeModule.getProjectStorageRuntimeStatus().status, 'idle');
});

test('lazy runtime is a singleflight singleton and exposes retryable non-empty failures', async () => {
  let calls = 0;
  const singleton = runtimeModule.createLazyRuntime(() => {
    calls += 1;
    return { marker: Symbol('runtime') };
  });
  assert.equal(singleton.status().status, 'idle');
  const values = await Promise.all(Array.from({ length: 32 }, () => Promise.resolve().then(() => singleton.get())));
  assert.equal(calls, 1);
  assert.ok(values.every((value) => value === values[0]));
  assert.equal(singleton.status().status, 'ready');

  let now = 100;
  let failingCalls = 0;
  const retrying = runtimeModule.createLazyRuntime(() => {
    failingCalls += 1;
    if (failingCalls === 1) {
      const error = new Error('private database path must never reach clients');
      error.code = 'database_busy';
      throw error;
    }
    return { recovered: true };
  }, { now: () => now, retryDelayMs: 1_000 });
  let unavailable;
  assert.throws(() => retrying.get(), (error) => {
    unavailable = error;
    return error instanceof runtimeModule.ProjectRuntimeUnavailableError;
  });
  assert.equal(retrying.status().status, 'failed');
  assert.equal(retrying.status().errorCode, 'database_busy');
  assert.throws(() => retrying.get(), runtimeModule.ProjectRuntimeUnavailableError);
  assert.equal(failingCalls, 1, 'cooldown requests must not reopen the database');

  const response = { headers: {}, statusCode: 0, body: null };
  const res = {
    setHeader(name, value) { response.headers[name] = value; },
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; },
  };
  runtimeModule.sendProjectRuntimeUnavailable(res, unavailable);
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['Retry-After'], '1');
  assert.equal(response.body.success, false);
  assert.equal(response.body.retryable, true);
  assert.ok(response.body.error.length > 0);
  assert.doesNotMatch(response.body.error, /private database path/);

  now = 1_101;
  assert.deepEqual(retrying.get(), { recovered: true });
  assert.equal(failingCalls, 2);
});

test('lazy runtime can adopt the already-open authoritative singleton without a second factory call', () => {
  let calls = 0;
  const singleton = runtimeModule.createLazyRuntime(() => {
    calls += 1;
    return { source: 'factory' };
  });
  const adopted = { source: 'legacy-route' };
  assert.equal(singleton.adopt(adopted), adopted);
  assert.equal(singleton.get(), adopted);
  assert.equal(singleton.status().status, 'ready');
  assert.equal(singleton.status().attempts, 0);
  assert.equal(calls, 0, 'adopting the shared singleton must not open a second database');
});

test('server readiness and maintenance preserve lazy storage and startup backup intent', () => {
  const server = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  const helper = fs.readFileSync(path.join(root, 'backend/src/services/projectRuntime.js'), 'utf8');
  const runs = fs.readFileSync(path.join(root, 'backend/src/routes/projectRuns.js'), 'utf8');
  const assets = fs.readFileSync(path.join(root, 'backend/src/routes/projectAssets.js'), 'utf8');
  assert.doesNotMatch(runs, /const database = getProjectDatabase\(config\)/);
  assert.doesNotMatch(assets, /const database = getProjectDatabase\(config\)/);
  assert.match(server, /const storageRuntime = getProjectStorageRuntimeStatus\(\)/);
  assert.match(server, /requestProjectStorageStartupBackup\(\)/);
  assert.match(server, /scheduleStorageDependentMaintenance\(\)/);
  assert.match(server, /projectAssetsRouter\.peekRuntime\(\)\?\.semanticPipeline/);
  assert.doesNotMatch(server, /startupProjectRuntimePromise|getProjectStorageRuntime\(config\)/);
  assert.doesNotMatch(server, /getRunRecoveryManager\(\{\}\)/);
  assert.match(helper, /function onProjectStorageReady/);
  assert.match(helper, /onProjectDatabaseReady\(\(database\) =>/);
  assert.match(helper, /projectStorageRuntime\.adopt\(\{ database \}\)/);
  assert.match(helper, /setImmediate/);
  assert.match(helper, /startupBackupRequested/);
});
