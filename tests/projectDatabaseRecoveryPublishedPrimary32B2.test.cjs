'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectDatabase,
  ProjectDatabaseRecoveryError,
} = require('../backend/src/services/projectDatabase');
const {
  PROJECT_DATABASE_MIGRATION_32,
} = require('../backend/src/services/projectDatabaseMigration32');

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTemporaryDirectory(directory) {
  const resolved = path.resolve(directory);
  assert.equal(
    `${resolved}${path.sep}`.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`),
    true,
    `refusing to remove non-temporary directory: ${resolved}`,
  );
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

async function closeQuietly(database) {
  if (!database) return;
  try { await database.close(); } catch (_) {}
}

async function createRecoverableSchema32Fixture(prefix) {
  const directory = temporaryDirectory(prefix);
  const filename = path.join(directory, 'project.sqlite3');
  const backupFilename = `${filename}.backup`;
  let database = null;
  try {
    database = new ProjectDatabase(filename, { autoBackup: false });
    assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
    await database.createBackup();
    await database.close();
    database = null;
    assert.equal(fs.existsSync(backupFilename), true);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${filename}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    fs.writeFileSync(
      filename,
      Buffer.from('not-a-sqlite-database-but-not-an-empty-file', 'utf8'),
      { flag: 'w' },
    );
    return { directory, filename, backupFilename };
  } catch (error) {
    await closeQuietly(database);
    removeTemporaryDirectory(directory);
    throw error;
  }
}

async function assertColdOpenRepairsPublishedTransition(fixture) {
  let reopened = null;
  try {
    reopened = new ProjectDatabase(fixture.filename, { autoBackup: false });
    assert.match(reopened.getRecoveryGeneration(), /^[0-9a-f-]{36}$/);
  } finally {
    await closeQuietly(reopened);
  }
}

test('B2 a post-publish primary-open failure is marked committed and remains cold-repairable', {
  skip: PROJECT_DATABASE_SCHEMA_VERSION >= PROJECT_DATABASE_MIGRATION_32.version
    ? false
    : 'production schema remains 31 until the exact schema32 lineage is wired',
  timeout: 180_000,
}, async () => {
  const fixture = await createRecoverableSchema32Fixture(
    't8-b2-schema32-recovery-published-open-',
  );
  try {
    assert.throws(
      () => new ProjectDatabase(fixture.filename, {
        autoBackup: false,
        beforeProjectDatabaseRecoveryPublishedPrimaryOpen32() {
          throw Object.assign(new Error('controlled published-primary open failure'), {
            code: 'EACCES',
          });
        },
      }),
      (error) => error instanceof ProjectDatabaseRecoveryError
        && error.details?.phase === 'backup_recovery_published_open_failed'
        && error.details?.recoveryPublished === true
        && error.details?.errorCode === 'EACCES',
    );
    await assertColdOpenRepairsPublishedTransition(fixture);
  } finally {
    removeTemporaryDirectory(fixture.directory);
  }
});

test('B2 a post-publish identity-read failure closes the restored handle and remains cold-repairable', {
  skip: PROJECT_DATABASE_SCHEMA_VERSION >= PROJECT_DATABASE_MIGRATION_32.version
    ? false
    : 'production schema remains 31 until the exact schema32 lineage is wired',
  timeout: 180_000,
}, async () => {
  const fixture = await createRecoverableSchema32Fixture(
    't8-b2-schema32-recovery-published-identity-',
  );
  let restoredHandle = null;
  try {
    assert.throws(
      () => new ProjectDatabase(fixture.filename, {
        autoBackup: false,
        afterProjectDatabaseRecoveryPublishedPrimaryOpenBeforeIdentity32(database) {
          restoredHandle = database;
          throw Object.assign(new Error('controlled published-primary identity failure'), {
            code: 'EIO',
          });
        },
      }),
      (error) => error instanceof ProjectDatabaseRecoveryError
        && error.details?.phase === 'backup_recovery_published_identity_read_failed'
        && error.details?.recoveryPublished === true
        && error.details?.errorCode === 'EIO',
    );
    assert.ok(restoredHandle);
    assert.equal(restoredHandle.open, false);
    await assertColdOpenRepairsPublishedTransition(fixture);
  } finally {
    try { if (restoredHandle?.open) restoredHandle.close(); } catch (_) {}
    removeTemporaryDirectory(fixture.directory);
  }
});
