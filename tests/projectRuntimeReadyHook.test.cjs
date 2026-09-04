const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const runtimePath = require.resolve('../backend/src/services/projectRuntime.js');

function afterImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('storage-ready maintenance and requested backup run exactly once after first real storage use', async () => {
  const originalLoad = Module._load;
  const previousRuntime = require.cache[runtimePath];
  let databaseCalls = 0;
  let backupCalls = 0;
  let finishBackup;
  const database = { marker: Symbol('database') };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './projectDatabase' && parent?.filename === runtimePath) {
      return {
        getProjectDatabase() {
          databaseCalls += 1;
          return database;
        },
        startProjectDatabaseStartupBackup() {
          backupCalls += 1;
          return new Promise((resolve) => { finishBackup = resolve; });
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[runtimePath];
  try {
    const runtime = require(runtimePath);
    let readyCalls = 0;
    let finishReadyWork;
    runtime.onProjectStorageReady((value) => {
      readyCalls += 1;
      assert.equal(value.database, database);
      return new Promise((resolve) => { finishReadyWork = resolve; });
    });

    let backupIntentSettled = false;
    const backupIntent = runtime.requestProjectStorageStartupBackup().then((result) => {
      backupIntentSettled = true;
      return result;
    });
    await afterImmediate();
    assert.equal(backupIntentSettled, false, 'backup intent stays pending until the real backup finishes');
    assert.equal(databaseCalls, 0, 'registering maintenance must not cold-open SQLite');
    assert.equal(backupCalls, 0, 'backup waits for the first real storage use');

    const first = runtime.getProjectStorageRuntime({ DATA_DIR: 'unused' });
    const second = runtime.getProjectStorageRuntime({ DATA_DIR: 'unused' });
    assert.equal(first, second);
    assert.equal(databaseCalls, 1, 'storage runtime is a singleton');

    await afterImmediate();
    await afterImmediate();
    assert.equal(readyCalls, 1, 'storage-ready hook dispatches once');
    assert.equal(backupCalls, 1, 'startup backup dispatches once');
    assert.equal(runtime.getProjectStorageRuntimeStatus().startupBackupStarted, true);
    assert.equal(runtime.getProjectStorageRuntimeStatus().pendingReadyWork, 1);

    let deferredWorkDrained = false;
    const drain = runtime.waitForProjectStorageDeferredWork().then(() => { deferredWorkDrained = true; });
    await afterImmediate();
    assert.equal(deferredWorkDrained, false, 'shutdown wait must include active ready-hook work');
    finishReadyWork();
    runtime.cancelProjectStorageDeferredWork();
    await afterImmediate();
    assert.equal(deferredWorkDrained, false, 'an already-started backup cannot be cancelled out from under storage');
    assert.equal(backupIntentSettled, false);
    finishBackup({ ok: true });
    assert.deepEqual(await backupIntent, { ok: true });
    await drain;
    assert.equal(deferredWorkDrained, true);
    assert.equal(runtime.getProjectStorageRuntimeStatus().pendingReadyWork, 0);

    let cancelledCalls = 0;
    const unsubscribe = runtime.onProjectStorageReady(() => { cancelledCalls += 1; });
    unsubscribe();
    await afterImmediate();
    assert.equal(cancelledCalls, 0, 'unsubscribed maintenance must not cross shutdown');
  } finally {
    Module._load = originalLoad;
    delete require.cache[runtimePath];
    if (previousRuntime) require.cache[runtimePath] = previousRuntime;
  }
});

test('a database opened through a legacy route is adopted and releases deferred startup work', async () => {
  const originalLoad = Module._load;
  const previousRuntime = require.cache[runtimePath];
  let readyListener = null;
  let backupCalls = 0;
  const database = { marker: Symbol('legacy-route-database') };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './projectDatabase' && parent?.filename === runtimePath) {
      return {
        getProjectDatabase() {
          throw new Error('the runtime factory must not run after legacy singleton adoption');
        },
        onProjectDatabaseReady(listener) {
          readyListener = listener;
          return () => { readyListener = null; };
        },
        startProjectDatabaseStartupBackup() {
          backupCalls += 1;
          return Promise.resolve({ ok: true });
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[runtimePath];
  try {
    const runtime = require(runtimePath);
    let hookCalls = 0;
    runtime.onProjectStorageReady((value) => {
      hookCalls += 1;
      assert.equal(value.database, database);
    });
    const backupIntent = runtime.requestProjectStorageStartupBackup();
    assert.equal(runtime.getProjectStorageRuntimeStatus().status, 'idle');
    assert.equal(typeof readyListener, 'function');

    readyListener(database);
    await afterImmediate();
    await afterImmediate();

    assert.equal(runtime.getProjectStorageRuntimeStatus().status, 'ready');
    assert.equal(runtime.peekProjectStorageRuntime().database, database);
    assert.equal(hookCalls, 1);
    assert.equal(backupCalls, 1);
    assert.equal(runtime.getProjectStorageRuntimeStatus().startupBackupStarted, true);
    assert.deepEqual(await backupIntent, { ok: true });
  } finally {
    Module._load = originalLoad;
    delete require.cache[runtimePath];
    if (previousRuntime) require.cache[runtimePath] = previousRuntime;
  }
});
