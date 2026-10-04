'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BetterSqlite3 = require('better-sqlite3');
const {
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectDatabase,
  ProjectDatabaseSchemaInvalidError,
  ProjectDatabaseStorageCapacityError,
} = require('../backend/src/services/projectDatabase');
const {
  PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration23');
const {
  PROJECT_DATABASE_MIGRATION_31,
  PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration31');
const {
  PROJECT_DATABASE_MIGRATION_32,
  PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS,
  PROJECT_DATABASE_SCHEMA_32_LINEAGE,
  PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
  PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration32');
const {
  DEFAULT_PROJECT_DATABASE_STORAGE_POLICY_32,
  projectDatabaseStoragePolicy32Row,
} = require('../backend/src/services/projectDatabasePhysicalCapacity32');
const {
  inspectProjectDatabaseSchemaManifest,
} = require('./helpers/projectDatabaseSchemaManifest.cjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTemporaryDirectory(directory) {
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  const resolved = path.resolve(directory);
  assert.equal(
    `${resolved}${path.sep}`.startsWith(temporaryRoot),
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

function databaseOptions(preMigration32BackupFilename, extra = {}) {
  const evidencePrefix = path.resolve(preMigration32BackupFilename);
  return {
    autoBackup: false,
    preMigrationBackup: false,
    preMigration30Backup: false,
    preMigration32BackupFilename,
    ownerGuardFilename: `${evidencePrefix}.owner.sqlite3`,
    recoveryGenerationFilename: `${evidencePrefix}.generation.json`,
    ...extra,
  };
}

function migrationVersions(database) {
  return database.prepare(`
    SELECT version FROM schema_migrations ORDER BY version ASC
  `).all().map((row) => Number(row.version));
}

function migrationReceipt(database, version) {
  return database.prepare(`
    SELECT version, name, checksum, from_fingerprint, to_fingerprint,
           down_policy, applied_at
    FROM schema_migration_receipts
    WHERE version = ?
  `).get(Number(version)) || null;
}

function schemaObjects(database) {
  return database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type ASC, name ASC
  `).all();
}

function ownedObjectNames(database, expectedNames) {
  const expected = new Set(expectedNames);
  return database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all()
    .map((row) => String(row.name))
    .filter((name) => expected.has(name));
}

function normalizeSqlValue(value) {
  if (Buffer.isBuffer(value)) return { blobHex: value.toString('hex') };
  return value;
}

function logicalDatabaseSnapshot(database) {
  const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all().map((row) => String(row.name));
  return {
    userVersion: Number(database.pragma('user_version', { simple: true })),
    applicationId: Number(database.pragma('application_id', { simple: true })),
    tables: tables.map((tableName) => {
      const quotedName = `"${tableName.replaceAll('"', '""')}"`;
      const rows = database.prepare(`SELECT * FROM ${quotedName}`).all()
        .map((row) => Object.fromEntries(Object.entries(row).map(
          ([key, value]) => [key, normalizeSqlValue(value)],
        )))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      return { tableName, rows };
    }),
  };
}

function assertIntegrity(database) {
  assert.equal(database.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(database.pragma('foreign_key_check'), []);
}

function schema31Manifest(database) {
  return inspectProjectDatabaseSchemaManifest(database, {
    descriptorVersion: PROJECT_DATABASE_MIGRATION_31.version,
    excludedObjectNames: PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
  });
}

function schema32Manifest(database) {
  return inspectProjectDatabaseSchemaManifest(database, {
    descriptorVersion: PROJECT_DATABASE_MIGRATION_32.version,
    excludedObjectNames: PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
  });
}

function captureExactSchema31(database) {
  assert.deepEqual(
    migrationVersions(database),
    Array.from({ length: PROJECT_DATABASE_MIGRATION_31.version }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ownedObjectNames(database, PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES),
    [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES].sort(),
  );
  assert.deepEqual(ownedObjectNames(database, PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES), []);
  const receipt = migrationReceipt(database, PROJECT_DATABASE_MIGRATION_31.version);
  const manifest = schema31Manifest(database);
  assert.ok(receipt);
  assert.equal(receipt.name, PROJECT_DATABASE_MIGRATION_31.name);
  assert.equal(receipt.checksum, PROJECT_DATABASE_MIGRATION_31.checksum);
  assert.equal(receipt.to_fingerprint, manifest.fingerprint);
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS.includes(manifest.fingerprint),
    true,
  );
  assertIntegrity(database);
  return Object.freeze({
    receipt,
    manifest,
    schemaObjects: schemaObjects(database),
    logicalSnapshot: logicalDatabaseSnapshot(database),
  });
}

function assertExactSchema31(database, expected) {
  assert.deepEqual(
    migrationVersions(database),
    Array.from({ length: PROJECT_DATABASE_MIGRATION_31.version }, (_, index) => index + 1),
  );
  assert.deepEqual(
    migrationReceipt(database, PROJECT_DATABASE_MIGRATION_31.version),
    expected.receipt,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count FROM schema_migration_receipts WHERE version = ?
    `).get(PROJECT_DATABASE_MIGRATION_32.version).count,
    0,
  );
  assert.deepEqual(
    ownedObjectNames(database, PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES),
    [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES].sort(),
  );
  assert.deepEqual(ownedObjectNames(database, PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES), []);
  assert.equal(schema31Manifest(database).fingerprint, expected.manifest.fingerprint);
  assert.deepEqual(schemaObjects(database), expected.schemaObjects);
  assert.deepEqual(logicalDatabaseSnapshot(database), expected.logicalSnapshot);
  assertIntegrity(database);
}

function readSchema32Policy(database) {
  return database.prepare(`
    SELECT singleton_id, policy_revision, active_storage_budget_bytes,
           main_max_bytes, wal_checkpoint_target_bytes,
           maximum_single_transaction_wal_bytes, wal_pressure_bytes,
           wal_reserve_bytes, wal_residual_limit_bytes, shm_reserve_bytes,
           hot_journal_reserve_bytes, sqlite_temp_reserve_bytes,
           minimum_filesystem_free_bytes, backup_candidate_reserve_bytes,
           recovery_evidence_reserve_bytes, synchronous_mode, updated_at
    FROM project_database_storage_policy
  `).all();
}

function readSchema32Identity(database) {
  return database.prepare(`
    SELECT singleton_id, database_uuid, recovery_generation, write_sequence,
           schema_version, schema_lineage, schema_lineage_digest,
           created_at, updated_at
    FROM project_database_identity
  `).all();
}

function assertCompleteSchema32(database, exactSchema31) {
  assert.deepEqual(
    migrationVersions(database),
    Array.from({ length: PROJECT_DATABASE_SCHEMA_VERSION }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ownedObjectNames(database, PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES),
    [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES].sort(),
  );
  assert.deepEqual(
    ownedObjectNames(database, PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES),
    [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES].sort(),
  );

  const receipt = migrationReceipt(database, PROJECT_DATABASE_MIGRATION_32.version);
  const targetManifest = schema32Manifest(database);
  assert.ok(receipt);
  assert.deepEqual(receipt, {
    version: PROJECT_DATABASE_MIGRATION_32.version,
    name: PROJECT_DATABASE_MIGRATION_32.name,
    checksum: PROJECT_DATABASE_MIGRATION_32.checksum,
    from_fingerprint: exactSchema31.manifest.fingerprint,
    to_fingerprint: targetManifest.fingerprint,
    down_policy: PROJECT_DATABASE_MIGRATION_32.downPolicy,
    applied_at: receipt.applied_at,
  });
  assert.equal(Number.isSafeInteger(Number(receipt.applied_at)), true);
  assert.equal(Number(receipt.applied_at) >= 1, true);
  assert.equal(
    Number(database.prepare(`
      SELECT applied_at FROM schema_migrations WHERE version = ?
    `).get(PROJECT_DATABASE_MIGRATION_32.version).applied_at),
    Number(receipt.applied_at),
  );

  const policyRows = readSchema32Policy(database);
  assert.equal(policyRows.length, 1);
  assert.deepEqual(
    policyRows[0],
    projectDatabaseStoragePolicy32Row(DEFAULT_PROJECT_DATABASE_STORAGE_POLICY_32, {
      updatedAt: Number(policyRows[0].updated_at),
    }),
  );

  const identityRows = readSchema32Identity(database);
  assert.equal(identityRows.length, 1);
  const identity = identityRows[0];
  assert.equal(identity.singleton_id, 1);
  assert.match(identity.database_uuid, UUID_PATTERN);
  assert.match(identity.recovery_generation, UUID_PATTERN);
  assert.equal(Number.isSafeInteger(Number(identity.write_sequence)), true);
  assert.equal(Number(identity.write_sequence) >= 0, true);
  assert.equal(identity.schema_version, PROJECT_DATABASE_MIGRATION_32.version);
  assert.equal(identity.schema_lineage, PROJECT_DATABASE_SCHEMA_32_LINEAGE);
  assert.equal(identity.schema_lineage_digest, PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST);
  assert.equal(Number.isSafeInteger(Number(identity.created_at)), true);
  assert.equal(Number(identity.created_at) >= 1, true);
  assert.equal(Number(identity.updated_at) >= Number(identity.created_at), true);

  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM project_database_backup_receipts').get().count,
    0,
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM project_database_canonical_backup_head').get().count,
    0,
  );
  assertIntegrity(database);
  return Object.freeze({ receipt, identity, policy: policyRows[0], targetManifest });
}

async function createExactSchema31RecoveryPoint(directory) {
  const seedFilename = path.join(directory, 'seed-current.sqlite3');
  const schema31Filename = path.join(directory, 'seed-exact-v31.sqlite3');
  let seed = null;
  try {
    seed = new ProjectDatabase(seedFilename, databaseOptions(schema31Filename));
    assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
    assert.equal(migrationVersions(seed.db).at(-1), PROJECT_DATABASE_SCHEMA_VERSION);
    await seed.close();
    seed = null;
    assert.equal(fs.existsSync(schema31Filename), true);
    const source = new BetterSqlite3(schema31Filename, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      return Object.freeze({
        filename: schema31Filename,
        exact: captureExactSchema31(source),
      });
    } finally {
      source.close();
    }
  } finally {
    await closeQuietly(seed);
  }
}

test('B2 exact schema31 disk database upgrades atomically to schema32 with singleton state and a mandatory recovery point', {
  timeout: 180_000,
}, async () => {
  assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
  const directory = temporaryDirectory('t8-b2-schema32-integration-');
  const upgradeFilename = path.join(directory, 'upgrade-from-v31.sqlite3');
  const backupFilename = `${upgradeFilename}.pre-migration-v31.sqlite3`;
  let upgraded = null;
  try {
    const source = await createExactSchema31RecoveryPoint(directory);
    fs.copyFileSync(source.filename, upgradeFilename, fs.constants.COPYFILE_EXCL);

    upgraded = new ProjectDatabase(upgradeFilename, databaseOptions(backupFilename));
    const first = assertCompleteSchema32(upgraded.db, source.exact);
    assert.equal(upgraded.getRecoveryGeneration(), first.identity.recovery_generation);
    assert.equal(fs.existsSync(backupFilename), true);

    const recoveryPoint = new BetterSqlite3(backupFilename, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertExactSchema31(recoveryPoint, source.exact);
    } finally {
      recoveryPoint.close();
    }

    await upgraded.close();
    upgraded = null;
    upgraded = new ProjectDatabase(upgradeFilename, databaseOptions(backupFilename));
    const cold = assertCompleteSchema32(upgraded.db, source.exact);
    assert.equal(cold.identity.database_uuid, first.identity.database_uuid);
    assert.equal(cold.identity.recovery_generation, first.identity.recovery_generation);
    assert.equal(upgraded.getRecoveryGeneration(), cold.identity.recovery_generation);
  } finally {
    await closeQuietly(upgraded);
    removeTemporaryDirectory(directory);
  }
});

test('B2 schema32 late real SQLITE_FULL rolls the exact v31 migration back and retries from the mandatory recovery point', {
  timeout: 180_000,
}, async () => {
  assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
  const directory = temporaryDirectory('t8-b2-schema32-real-full-');
  const primaryFilename = path.join(directory, 'projects.sqlite3');
  const backupFilename = `${primaryFilename}.pre-migration-v31.sqlite3`;
  let database = null;
  let beforeCommitReached = false;
  try {
    const source = await createExactSchema31RecoveryPoint(directory);
    fs.copyFileSync(source.filename, primaryFilename, fs.constants.COPYFILE_EXCL);

    assert.throws(
      () => {
        database = new ProjectDatabase(primaryFilename, databaseOptions(backupFilename, {
          beforeMigrationCommit(sqlite, version) {
            if (Number(version) !== PROJECT_DATABASE_MIGRATION_32.version) return;
            beforeCommitReached = true;
            const pageCount = Number(sqlite.pragma('page_count', { simple: true }));
            assert.equal(Number.isSafeInteger(pageCount) && pageCount > 0, true);
            assert.equal(
              Number(sqlite.pragma(`max_page_count = ${pageCount}`, { simple: true })),
              pageCount,
            );
            sqlite.exec(`
              CREATE TABLE schema32_real_full_fault_probe (
                id INTEGER PRIMARY KEY,
                payload BLOB NOT NULL
              ) STRICT;
            `);
          },
        }));
      },
      (error) => error instanceof ProjectDatabaseStorageCapacityError
        && error.code === 'project_database_storage_capacity_exceeded'
        && error.reason === 'sqlite-full'
        && error.details?.operation === 'migration-32',
    );
    database = null;
    assert.equal(beforeCommitReached, true, 'fault must occur after schema32 DDL, ledger and receipt writes');
    assert.equal(fs.existsSync(backupFilename), true);

    const primaryAfterFull = new BetterSqlite3(primaryFilename);
    const backupAfterFull = new BetterSqlite3(backupFilename, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertExactSchema31(primaryAfterFull, source.exact);
      assertExactSchema31(backupAfterFull, source.exact);
      assert.equal(primaryAfterFull.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE name = 'schema32_real_full_fault_probe'
      `).get().count, 0);
      primaryAfterFull.pragma('max_page_count = 1073741823');
    } finally {
      primaryAfterFull.close();
      backupAfterFull.close();
    }

    database = new ProjectDatabase(primaryFilename, databaseOptions(backupFilename));
    const retried = assertCompleteSchema32(database.db, source.exact);
    assert.equal(database.getRecoveryGeneration(), retried.identity.recovery_generation);
    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name = 'schema32_real_full_fault_probe'
    `).get().count, 0);

    const preservedRecoveryPoint = new BetterSqlite3(backupFilename, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertExactSchema31(preservedRecoveryPoint, source.exact);
    } finally {
      preservedRecoveryPoint.close();
    }
  } finally {
    await closeQuietly(database);
    removeTemporaryDirectory(directory);
  }
});

test('B2 schema32 migration fails closed when the primary data_version changes after exact v31 backup reuse', {
  timeout: 180_000,
}, async () => {
  assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
  const directory = temporaryDirectory('t8-b2-schema32-data-version-');
  const primaryFilename = path.join(directory, 'projects.sqlite3');
  const backupFilename = `${primaryFilename}.pre-migration-v31.sqlite3`;
  let database = null;
  let hookReached = false;
  try {
    const source = await createExactSchema31RecoveryPoint(directory);
    fs.copyFileSync(source.filename, primaryFilename, fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(source.filename, backupFilename, fs.constants.COPYFILE_EXCL);

    assert.throws(
      () => {
        database = new ProjectDatabase(primaryFilename, databaseOptions(backupFilename, {
          beforePreMigrationBackupReuse(event) {
            if (Number(event?.fromVersion) !== PROJECT_DATABASE_MIGRATION_31.version) return;
            hookReached = true;
            const concurrent = new BetterSqlite3(primaryFilename);
            try {
              const update = concurrent.prepare(`
                UPDATE schema_migrations
                SET applied_at = applied_at + 1
                WHERE version = 1
              `).run();
              assert.equal(update.changes, 1);
            } finally {
              concurrent.close();
            }
          },
        }));
      },
      (error) => error instanceof ProjectDatabaseSchemaInvalidError
        && error.code === 'project_database_schema_invalid'
        && /并发|data.?version/i.test(String(error.message)),
    );
    database = null;
    assert.equal(hookReached, true);

    const primary = new BetterSqlite3(primaryFilename);
    const recoveryPoint = new BetterSqlite3(backupFilename, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assert.deepEqual(
        migrationVersions(primary),
        Array.from({ length: PROJECT_DATABASE_MIGRATION_31.version }, (_, index) => index + 1),
      );
      assert.equal(
        databaseVersion32ReceiptCount(primary),
        0,
      );
      assert.deepEqual(ownedObjectNames(primary, PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES), []);
      assert.equal(schema31Manifest(primary).fingerprint, source.exact.manifest.fingerprint);
      assert.equal(
        Number(primary.prepare('SELECT applied_at FROM schema_migrations WHERE version = 1').get().applied_at),
        Number(recoveryPoint.prepare('SELECT applied_at FROM schema_migrations WHERE version = 1').get().applied_at) + 1,
      );
      assertIntegrity(primary);
      assertExactSchema31(recoveryPoint, source.exact);
    } finally {
      primary.close();
      recoveryPoint.close();
    }
  } finally {
    await closeQuietly(database);
    removeTemporaryDirectory(directory);
  }
});

function databaseVersion32ReceiptCount(database) {
  return Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM schema_migration_receipts
    WHERE version = ?
  `).get(PROJECT_DATABASE_MIGRATION_32.version).count);
}

test('B2 schema32 migration rejects a structurally valid v31 database outside the exact ten-lineage allowlist before DDL', {
  timeout: 180_000,
}, async () => {
  assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
  const directory = temporaryDirectory('t8-b2-schema32-lineage-reject-');
  const primaryFilename = path.join(directory, 'projects.sqlite3');
  const backupFilename = `${primaryFilename}.pre-migration-v31.sqlite3`;
  let database = null;
  try {
    const source = await createExactSchema31RecoveryPoint(directory);
    fs.copyFileSync(source.filename, primaryFilename, fs.constants.COPYFILE_EXCL);
    const mutated = new BetterSqlite3(primaryFilename);
    try {
      mutated.exec(`
        CREATE TABLE schema32_unaccepted_lineage_probe (
          probe_id INTEGER PRIMARY KEY NOT NULL,
          note TEXT NOT NULL
        ) STRICT;
      `);
      assertIntegrity(mutated);
      assert.equal(
        PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS.includes(
          schema31Manifest(mutated).fingerprint,
        ),
        false,
      );
    } finally {
      mutated.close();
    }

    assert.throws(
      () => {
        database = new ProjectDatabase(primaryFilename, databaseOptions(backupFilename));
      },
      (error) => error instanceof ProjectDatabaseSchemaInvalidError
        && error.code === 'project_database_schema_invalid',
    );
    database = null;
    assert.equal(fs.existsSync(backupFilename), false);

    const after = new BetterSqlite3(primaryFilename);
    try {
      assert.deepEqual(
        migrationVersions(after),
        Array.from({ length: PROJECT_DATABASE_MIGRATION_31.version }, (_, index) => index + 1),
      );
      assert.equal(databaseVersion32ReceiptCount(after), 0);
      assert.deepEqual(ownedObjectNames(after, PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES), []);
      assert.equal(
        after.prepare(`
          SELECT COUNT(*) AS count
          FROM sqlite_master
          WHERE type = 'table' AND name = 'schema32_unaccepted_lineage_probe'
        `).get().count,
        1,
      );
      assertIntegrity(after);
    } finally {
      after.close();
    }
  } finally {
    await closeQuietly(database);
    removeTemporaryDirectory(directory);
  }
});
