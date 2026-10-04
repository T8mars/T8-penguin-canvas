'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SOURCE_FINGERPRINT = String(process.env.T8_SCHEMA32_GUARD_SOURCE_FINGERPRINT ||
  '632f46888c88c6fb572404984b6125ca218c3a9ca734e6730eb96be6b001466d');
const TARGET_FINGERPRINT = String(process.env.T8_SCHEMA32_GUARD_TARGET_FINGERPRINT ||
  '2f8d6ea2d730680d99ab32800aabb0ec4aabbe86509443e70f68ac2ac501248b');
const EXTENSION_FINGERPRINT = String(process.env.T8_SCHEMA32_GUARD_EXTENSION_FINGERPRINT ||
  'bae4f62ab94effb8bafe3027c7bd037ab51e7c13f28bbdda5dcf80f8dce85276');
const helperRole = String(process.env.T8_SCHEMA32_GUARD_HELPER_ROLE || '');

function loadSchema32ProjectDatabaseModule() {
  const projectDatabaseFilename = path.resolve(
    __dirname,
    '../backend/src/services/projectDatabase.js',
  );
  const production = require(projectDatabaseFilename);
  // Exercise the real migration guard, including completion into newer
  // additive schemas. Never disable the production registry/manifest gate.
  assert.ok(production.PROJECT_DATABASE_SCHEMA_VERSION >= 32);
  return production;
}

function writeMarker(value) {
  const filename = process.env.T8_SCHEMA32_GUARD_MARKER;
  if (!filename) return;
  const descriptor = fs.openSync(filename, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value), 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

async function runHelperRole() {
  const { ProjectDatabase } = loadSchema32ProjectDatabaseModule();
  const filename = process.env.T8_SCHEMA32_GUARD_DATABASE;
  const backupFilename = process.env.T8_SCHEMA32_GUARD_BACKUP;
  let database = null;
  const hardExit = (status, event) => {
    writeMarker({ role: helperRole, ...event });
    process.exit(status);
  };
  try {
    database = new ProjectDatabase(filename, {
      autoBackup: false,
      preMigrationBackup: false,
      preMigration30Backup: false,
      preMigration32BackupFilename: backupFilename,
      afterProjectDatabaseSchema32MigrationCommitBeforeAcknowledgement32(_database, event) {
        if (helperRole === 'commit-before-ack') hardExit(81, event);
      },
      afterProjectDatabaseSchema32MigrationAcknowledgementBeforeGuardCompletion32(
        _database,
        event,
      ) {
        if (helperRole === 'ack-before-completed') hardExit(82, event);
      },
      afterProjectDatabaseSchema32MigrationGuardCompletion32(_database, event) {
        if (helperRole === 'completed-before-bootstrap') hardExit(83, event);
      },
    });
    if (helperRole === 'create-backup') await database.createBackup();
    const rotatedGeneration = helperRole === 'rotate-and-close'
      ? database.rotateRecoveryGeneration('schema32-guard-completed-live-rotation')
      : null;
    await database.close();
    database = null;
    process.stdout.write(`${JSON.stringify({
      type: 'opened-and-closed',
      rotatedGeneration,
    })}\n`);
  } catch (error) {
    try { await database?.close(); } catch (_) {}
    process.stdout.write(`${JSON.stringify({
      type: 'error',
      code: String(error?.code || ''),
      phase: String(error?.details?.phase || ''),
      errorCode: String(error?.details?.errorCode || ''),
      name: String(error?.name || ''),
      message: String(error?.message || ''),
    })}\n`);
    process.exitCode = 70;
  }
}

if (helperRole) {
  void runHelperRole().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 71;
  });
} else {
  const test = require('node:test');
  const BetterSqlite3 = require('better-sqlite3');
  const {
    PROJECT_DATABASE_OWNER_GUARD_BASENAME,
    PROJECT_DATABASE_SCHEMA_VERSION,
    ProjectDatabase,
  } = require('../backend/src/services/projectDatabase');
  const {
    PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
  } = require('../backend/src/services/projectDatabaseMigration23');
  const {
    PROJECT_DATABASE_MIGRATION_31,
  } = require('../backend/src/services/projectDatabaseMigration31');
  const {
    PROJECT_DATABASE_MIGRATION_32,
    PROJECT_DATABASE_MIGRATION_32_CREATE_SQL,
    PROJECT_DATABASE_MIGRATION_32_RUNTIME_GUARDS_SQL,
    PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
  } = require('../backend/src/services/projectDatabaseMigration32');
  const {
    PROJECT_DATABASE_FRESHNESS_FENCE_32_VERSION,
  } = require('../backend/src/services/projectDatabaseFreshnessFence32');
  const {
    readProjectDatabaseWriteAcknowledgement32,
  } = require('../backend/src/services/projectDatabaseWriteSequence32');
  const {
    inspectProjectDatabaseSchemaManifest,
  } = require('./helpers/projectDatabaseSchemaManifest.cjs');

  function removeTemporaryDirectory(directory) {
    const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    const resolved = path.resolve(directory);
    assert.equal(`${resolved}${path.sep}`.startsWith(temporaryRoot), true);
    fs.rmSync(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }

  function helperProcess(role, fixture, lineage) {
    return spawnSync(process.execPath, [__filename], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        T8_SCHEMA32_GUARD_HELPER_ROLE: role,
        T8_SCHEMA32_GUARD_DATABASE: fixture.filename,
        T8_SCHEMA32_GUARD_BACKUP: fixture.backupFilename,
        T8_SCHEMA32_GUARD_MARKER: fixture.markerFilename,
        T8_SCHEMA32_GUARD_SOURCE_FINGERPRINT: lineage.sourceFingerprint,
        T8_SCHEMA32_GUARD_TARGET_FINGERPRINT: lineage.targetFingerprint,
        T8_SCHEMA32_GUARD_EXTENSION_FINGERPRINT: lineage.extensionFingerprint,
      },
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  }

  function helperMessage(result) {
    return String(result.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .find(Boolean) || null;
  }

  function helperFailure(result, boundary) {
    return `${boundary}: ${result.error?.message || result.stderr || result.stdout || result.status}`;
  }

  function guardRow(fixture) {
    const database = new BetterSqlite3(
      path.join(fixture.directory, PROJECT_DATABASE_OWNER_GUARD_BASENAME),
      { readonly: true, fileMustExist: true },
    );
    try {
      return database.prepare(`
        SELECT state, intent_json, intent_digest, prepared_at, completed_at
        FROM project_database_schema32_migration_guard
        WHERE singleton = 1
      `).get() || null;
    } finally {
      database.close();
    }
  }

  function primaryVersionAndSequence(filename) {
    const database = new BetterSqlite3(filename, { readonly: true, fileMustExist: true });
    try {
      return {
        version: Number(database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version),
        writeSequence: Number(database.prepare(`
          SELECT write_sequence FROM project_database_identity WHERE singleton_id = 1
        `).get()?.write_sequence),
      };
    } finally {
      database.close();
    }
  }

  function fixture(root, name, schema31Filename) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    const filename = path.join(directory, 'projects.sqlite3');
    fs.copyFileSync(schema31Filename, filename, fs.constants.COPYFILE_EXCL);
    return {
      directory,
      filename,
      acknowledgementFilename: `${filename}.recovery-generation.json`,
      canonicalBackupFilename: `${filename}.backup`,
      backupFilename: `${filename}.pre-migration-v31.sqlite3`,
      markerFilename: path.join(directory, 'marker.json'),
    };
  }

  test('B2 schema32 owner migration guard closes commit-to-ACK and ACK-to-completed hard-exit windows', {
    timeout: 600_000,
  }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-schema32-migration-guard-'));
    const seedFilename = path.join(root, 'seed-current.sqlite3');
    const seedSchema31Filename = path.join(root, 'seed-schema31.sqlite3');
    let seed = null;
    try {
      seed = new ProjectDatabase(seedFilename, {
        autoBackup: false,
        preMigrationBackup: false,
        preMigration30Backup: false,
        preMigration32BackupFilename: seedSchema31Filename,
      });
      await seed.close();
      seed = null;
      if (PROJECT_DATABASE_SCHEMA_VERSION === PROJECT_DATABASE_MIGRATION_31.version) {
        fs.copyFileSync(seedFilename, seedSchema31Filename, fs.constants.COPYFILE_EXCL);
      }
      assert.equal(fs.existsSync(seedSchema31Filename), true);
      let lineage = null;
      const source = new BetterSqlite3(seedSchema31Filename, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        const sourceManifest = inspectProjectDatabaseSchemaManifest(source, {
          descriptorVersion: PROJECT_DATABASE_MIGRATION_31.version,
          excludedObjectNames: PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
        });
        const probeFilename = path.join(root, 'schema32-manifest-probe.sqlite3');
        source.close();
        fs.copyFileSync(seedSchema31Filename, probeFilename, fs.constants.COPYFILE_EXCL);
        const probe = new BetterSqlite3(probeFilename);
        try {
          probe.exec(PROJECT_DATABASE_MIGRATION_32_CREATE_SQL);
          probe.exec(PROJECT_DATABASE_MIGRATION_32_RUNTIME_GUARDS_SQL);
          const targetManifest = inspectProjectDatabaseSchemaManifest(probe, {
            descriptorVersion: PROJECT_DATABASE_MIGRATION_32.version,
            excludedObjectNames: PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
          });
          const extensionManifest = inspectProjectDatabaseSchemaManifest(probe, {
            descriptorVersion: PROJECT_DATABASE_MIGRATION_32.version,
            includedObjectNames: PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
          });
          lineage = Object.freeze({
            sourceFingerprint: sourceManifest.fingerprint,
            targetFingerprint: targetManifest.fingerprint,
            extensionFingerprint: extensionManifest.fingerprint,
          });
        } finally {
          probe.close();
        }
      } finally {
        try { if (source.open) source.close(); } catch (_) {}
      }
      assert.ok(lineage);

      const commitCrash = fixture(root, 'commit-before-ack', seedSchema31Filename);
      let result = helperProcess('commit-before-ack', commitCrash, lineage);
      assert.equal(result.status, 81, helperFailure(result, 'commit-before-ack'));
      assert.deepEqual(primaryVersionAndSequence(commitCrash.filename), {
        version: PROJECT_DATABASE_MIGRATION_32.version,
        writeSequence: 0,
      });
      assert.equal(fs.existsSync(commitCrash.acknowledgementFilename), false);
      assert.equal(guardRow(commitCrash).state, 'prepared');

      result = helperProcess('success', commitCrash, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'commit cold repair'));
      assert.equal(helperMessage(result)?.type, 'opened-and-closed');
      assert.equal(guardRow(commitCrash).state, 'completed');
      assert.equal(
        readProjectDatabaseWriteAcknowledgement32(commitCrash.acknowledgementFilename)
          .value.version,
        PROJECT_DATABASE_FRESHNESS_FENCE_32_VERSION,
      );

      const acknowledgementCrash = fixture(root, 'ack-before-completed', seedSchema31Filename);
      result = helperProcess('ack-before-completed', acknowledgementCrash, lineage);
      assert.equal(result.status, 82, helperFailure(result, 'ack-before-completed'));
      assert.deepEqual(primaryVersionAndSequence(acknowledgementCrash.filename), {
        version: PROJECT_DATABASE_MIGRATION_32.version,
        writeSequence: 0,
      });
      assert.equal(
        readProjectDatabaseWriteAcknowledgement32(
          acknowledgementCrash.acknowledgementFilename,
        ).value.version,
        PROJECT_DATABASE_FRESHNESS_FENCE_32_VERSION,
      );
      assert.equal(guardRow(acknowledgementCrash).state, 'prepared');

      result = helperProcess('success', acknowledgementCrash, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'ACK cold completion'));
      assert.equal(guardRow(acknowledgementCrash).state, 'completed');

      result = helperProcess('rotate-and-close', acknowledgementCrash, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'completed guard live rotation'));
      assert.match(helperMessage(result)?.rotatedGeneration || '', /^[0-9a-f-]{36}$/);
      assert.equal(guardRow(acknowledgementCrash).state, 'completed');
      result = helperProcess('success', acknowledgementCrash, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'completed guard rotated cold open'));

      const completed = fixture(root, 'completed-tamper', seedSchema31Filename);
      result = helperProcess('completed-before-bootstrap', completed, lineage);
      assert.equal(result.status, 83, helperFailure(result, 'completed-before-bootstrap'));
      const completedGuard = guardRow(completed);
      assert.equal(completedGuard.state, 'completed');
      assert.ok(Number.isSafeInteger(Number(completedGuard.completed_at)));
      const exactInitialAcknowledgement = fs.readFileSync(completed.acknowledgementFilename);

      fs.rmSync(completed.acknowledgementFilename);
      result = helperProcess('expect-failure', completed, lineage);
      assert.equal(result.status, 70, helperFailure(result, 'completed ACK deletion'));
      assert.equal(helperMessage(result)?.phase, 'schema32-freshness-fence-unproven');
      assert.equal(fs.existsSync(completed.acknowledgementFilename), false);
      assert.equal(guardRow(completed).state, 'completed');

      const guardedPrimary = fixture(root, 'foreign-backup-primary', seedSchema31Filename);
      const foreignBackup = fixture(root, 'foreign-backup-source', seedSchema31Filename);
      result = helperProcess('success', guardedPrimary, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'guarded primary migration'));
      result = helperProcess('success', foreignBackup, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'foreign source migration'));
      result = helperProcess('create-backup', foreignBackup, lineage);
      assert.equal(result.status, 0, helperFailure(result, 'foreign canonical backup'));
      assert.equal(fs.existsSync(foreignBackup.canonicalBackupFilename), true);
      const guardedIntent = JSON.parse(guardRow(guardedPrimary).intent_json);
      const foreignIntent = JSON.parse(guardRow(foreignBackup).intent_json);
      assert.notEqual(guardedIntent.databaseUuid, foreignIntent.databaseUuid);

      fs.copyFileSync(
        foreignBackup.canonicalBackupFilename,
        guardedPrimary.canonicalBackupFilename,
      );
      fs.copyFileSync(
        foreignBackup.acknowledgementFilename,
        guardedPrimary.acknowledgementFilename,
      );
      for (const suffix of ['-wal', '-shm', '-journal']) {
        fs.rmSync(`${guardedPrimary.filename}${suffix}`, { force: true });
      }
      const corruptPrimary = Buffer.from(
        'schema32-foreign-backup-guard-regression-corrupt-primary',
        'utf8',
      );
      fs.writeFileSync(guardedPrimary.filename, corruptPrimary, { flag: 'w' });
      result = helperProcess('expect-failure', guardedPrimary, lineage);
      assert.equal(result.status, 70, helperFailure(result, 'foreign guarded recovery'));
      assert.equal(
        helperMessage(result)?.phase,
        'backup_recovery_migration_guard_unproven',
      );
      assert.deepEqual(fs.readFileSync(guardedPrimary.filename), corruptPrimary);
      assert.equal(guardRow(guardedPrimary).state, 'completed');
      assert.equal(
        JSON.parse(guardRow(guardedPrimary).intent_json).databaseUuid,
        guardedIntent.databaseUuid,
      );

      fs.writeFileSync(completed.acknowledgementFilename, exactInitialAcknowledgement, {
        flag: 'wx',
        mode: 0o600,
      });
      fs.copyFileSync(seedSchema31Filename, completed.filename);
      fs.rmSync(completed.acknowledgementFilename);
      result = helperProcess('expect-failure', completed, lineage);
      assert.equal(result.status, 70, helperFailure(result, 'completed primary rollback'));
      assert.equal(
        helperMessage(result)?.phase,
        'schema32-migration-guard-completed-primary-rollback',
      );
      assert.equal(fs.existsSync(completed.acknowledgementFilename), false);
      assert.equal(guardRow(completed).state, 'completed');
    } finally {
      try { await seed?.close(); } catch (_) {}
      removeTemporaryDirectory(root);
    }
  });
}
