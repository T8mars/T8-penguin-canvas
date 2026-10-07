'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.T8_FIGMA_BRIDGE_AUTOSTART = '0';
process.env.T8_COLLAB_MANAGEMENT_TOKEN = 'B'.repeat(43);
process.env.T8PC_STARTUP_MAINTENANCE_FALLBACK_MS = '300000';
process.env.T8PC_STARTUP_MAINTENANCE_INTERACTIVE_DELAY_MS = '0';

function afterImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('background readiness waits for the real deferred startup backup', { timeout: 20_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-backup-readiness-'));
  const config = require('../backend/src/config');
  Object.assign(config, {
    HOST: '127.0.0.1',
    PORT: 0,
    DATA_DIR: path.join(root, 'data'),
    INPUT_DIR: path.join(root, 'input'),
    OUTPUT_DIR: path.join(root, 'output'),
    THUMBNAILS_DIR: path.join(root, 'thumbnails'),
    ASSET_PREVIEWS_DIR: path.join(root, 'thumbnails', 'asset-previews'),
    ASSET_BLOB_DIR: path.join(root, 'data', 'asset-blobs'),
    COLLAB_UPLOAD_TEMP_DIR: path.join(root, 'data', 'collaboration-uploads'),
    PROJECT_DB_FILE: path.join(root, 'data', 'projects.sqlite3'),
    PROJECT_DB_BACKUP_FILE: path.join(root, 'data', 'projects.sqlite3.backup'),
    PROJECT_DB_STORAGE_POLICY_32: require('./helpers/startupStoragePolicy32.cjs'),
  });
  for (const directory of [config.DATA_DIR, config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const projectDatabase = require('../backend/src/services/projectDatabase');
  const originalBackup = projectDatabase.startProjectDatabaseStartupBackup;
  let backupCalls = 0;
  let resolveBackup;
  const backupGate = new Promise((resolve) => { resolveBackup = resolve; });
  projectDatabase.startProjectDatabaseStartupBackup = () => {
    backupCalls += 1;
    return backupGate;
  };

  let backend = null;
  try {
    backend = require('../backend/src/server');
    const start = await backend.serverStartPromise;
    assert.equal(start.state, 'listening');

    const maintenance = backend.scheduleStartupMaintenance('backup-readiness-test', 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(backend.startupReadinessSnapshot().backgroundReady, false);

    const runtime = require('../backend/src/services/projectRuntime');
    runtime.getProjectStorageRuntime(config);
    for (let attempt = 0; attempt < 30 && backupCalls === 0; attempt += 1) {
      await afterImmediate();
    }
    assert.equal(backupCalls, 1);
    assert.equal(
      backend.startupReadinessSnapshot().backgroundReady,
      false,
      'the backend must stay deferred while the real backup is unresolved',
    );

    resolveBackup({ ok: true });
    await maintenance;
    await runtime.waitForProjectStorageDeferredWork();
    for (let attempt = 0; attempt < 30 && !backend.startupReadinessSnapshot().backgroundReady; attempt += 1) {
      await afterImmediate();
    }
    assert.equal(backend.startupReadinessSnapshot().backgroundReady, true);
  } finally {
    resolveBackup?.({ ok: true });
    if (backend) {
      await backend.gracefulShutdown();
      await backend.waitForRuntimeStorageCloseLifecycle();
    }
    projectDatabase.startProjectDatabaseStartupBackup = originalBackup;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
