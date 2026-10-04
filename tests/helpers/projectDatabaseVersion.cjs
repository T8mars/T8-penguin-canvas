const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PROJECT_DATABASE_MIGRATION_32,
  PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS,
} = require('../../backend/src/services/projectDatabaseMigration32');
const {
  PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECTS,
} = require('../../backend/src/services/projectDatabaseMigration31');
const { PROJECT_DATABASE_SCHEMA_33_OWNED_OBJECT_NAMES } = require('../../backend/src/services/projectDatabaseMigration33');

function quoteSqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertCurrentProjectDatabaseRegistry(currentVersion, migrations) {
  assert.ok(Array.isArray(migrations));
  assert.ok(migrations.length > 0);
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    Array.from({ length: migrations.length }, (_, index) => index + 1),
  );
  assert.equal(currentVersion, migrations.length);
  assert.equal(migrations.at(-1).version, currentVersion);
}

function assertTemporaryFixturePath(filename) {
  const resolved = path.resolve(filename);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  assert.equal(
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    true,
    `refusing to alter non-temporary schema fixture artifacts: ${resolved}`,
  );
  return resolved;
}

function removeSchema32SyntheticFixtureArtifacts(filename) {
  if (!filename || filename === ':memory:') return;
  const primary = assertTemporaryFixturePath(filename);
  const directory = path.dirname(primary);
  const exactBases = [
    `${primary}.recovery-generation.json`,
    `${primary}.pre-migration-v31.sqlite3`,
    path.join(directory, '.t8-project-database-owner.sqlite3'),
  ];
  for (const base of exactBases) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try {
        fs.rmSync(`${base}${suffix}`, { force: true });
      } catch (error) {
        const ownerGuard = base === exactBases.at(-1);
        if (!ownerGuard || !['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
        // A few in-process corruption tests intentionally keep ProjectDatabase
        // open after raw fixture teardown. Their lifetime guard remains locked
        // until close and they never cold-open the synthetic historical file.
      }
    }
  }
  const removablePrefixes = [
    `${path.basename(primary)}.recovery-generation.json.tmp-`,
    `${path.basename(primary)}.recovery-generation.json.corrupt-`,
    `.${path.basename(primary)}.pre-migration-v31.sqlite3.owned-`,
  ];
  for (const name of fs.readdirSync(directory)) {
    if (!removablePrefixes.some((prefix) => name.startsWith(prefix))) continue;
    fs.rmSync(path.join(directory, name), { recursive: true, force: true });
  }
}

// TEST-ONLY fixture teardown. Schema 32 is backup-only in production; this
// removes only its source-controlled extension and ledger rows from a
// disposable database before an older exact historical fixture is rebuilt.
function stripSchema32ForSyntheticSchema31(database) {
  // Only disposable fixtures can shed the newer additive extension. Production
  // continues to reject a schema33 primary in every older-schema executable.
  if (database.name !== ':memory:') assertTemporaryFixturePath(database.name);
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='canvas_directory'").get()) {
    const objects = database.prepare('SELECT type,name FROM sqlite_master').all()
      .filter((row) => PROJECT_DATABASE_SCHEMA_33_OWNED_OBJECT_NAMES.includes(row.name));
    const order = { trigger: 0, index: 1, view: 2, table: 3 };
    objects.sort((a,b) => order[a.type] - order[b.type]);
    database.transaction(() => {
      for (const row of objects) database.exec(`DROP ${row.type.toUpperCase()} ${quoteSqlIdentifier(row.name)}`);
      database.prepare('DELETE FROM schema_migration_receipts WHERE version=33').run();
      database.prepare('DELETE FROM schema_migrations WHERE version=33').run();
    }).immediate();
  }
  const migrationTablePresent = Boolean(database.prepare(`
    SELECT 1 AS found FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get());
  const schema32Recorded = migrationTablePresent && Boolean(database.prepare(`
    SELECT 1 AS found FROM schema_migrations WHERE version = ?
  `).get(PROJECT_DATABASE_MIGRATION_32.version));
  const ownedObjectPresent = Boolean(database.prepare(`
    SELECT 1 AS found FROM sqlite_master
    WHERE name IN (${PROJECT_DATABASE_MIGRATION_32.ownedObjectNames.map(() => '?').join(', ')})
    LIMIT 1
  `).get(...PROJECT_DATABASE_MIGRATION_32.ownedObjectNames));
  if (!schema32Recorded && !ownedObjectPresent) return false;

  const strip = () => {
    for (const name of [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS.triggers].reverse()) {
      database.exec(`DROP TRIGGER IF EXISTS ${quoteSqlIdentifier(name)}`);
    }
    for (const name of [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS.views].reverse()) {
      database.exec(`DROP VIEW IF EXISTS ${quoteSqlIdentifier(name)}`);
    }
    for (const name of [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS.indexes].reverse()) {
      database.exec(`DROP INDEX IF EXISTS ${quoteSqlIdentifier(name)}`);
    }
    for (const name of [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS.tables].reverse()) {
      database.exec(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(name)}`);
    }
    const receiptTablePresent = Boolean(database.prepare(`
      SELECT 1 AS found FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migration_receipts'
    `).get());
    if (receiptTablePresent) {
      database.prepare('DELETE FROM schema_migration_receipts WHERE version = ?')
        .run(PROJECT_DATABASE_MIGRATION_32.version);
    }
    database.prepare('DELETE FROM schema_migrations WHERE version = ?')
      .run(PROJECT_DATABASE_MIGRATION_32.version);
  };
  if (database.inTransaction) strip();
  else database.transaction(strip).immediate();

  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE name IN (${PROJECT_DATABASE_MIGRATION_32.ownedObjectNames.map(() => '?').join(', ')})
  `).get(...PROJECT_DATABASE_MIGRATION_32.ownedObjectNames).count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?
  `).get(PROJECT_DATABASE_MIGRATION_32.version).count, 0);
  removeSchema32SyntheticFixtureArtifacts(String(database.name || ''));
  return true;
}

// TEST-ONLY fixture teardown. Production schema 31 remains backup-only; this
// helper exists solely to rebuild exact disposable schema 30 fixtures after a
// test has first exercised the current schema.
function removeSchema31ExtensionForSyntheticSchema30(database) {
  stripSchema32ForSyntheticSchema31(database);
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      for (const name of [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECTS.triggers].reverse()) {
        database.exec(`DROP TRIGGER IF EXISTS ${quoteSqlIdentifier(name)}`);
      }
      for (const name of [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECTS.views].reverse()) {
        database.exec(`DROP VIEW IF EXISTS ${quoteSqlIdentifier(name)}`);
      }
      for (const name of [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECTS.indexes].reverse()) {
        database.exec(`DROP INDEX IF EXISTS ${quoteSqlIdentifier(name)}`);
      }
      for (const name of [...PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECTS.tables].reverse()) {
        database.exec(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(name)}`);
      }
      database.prepare('DELETE FROM schema_migration_receipts WHERE version = 31').run();
      database.prepare('DELETE FROM schema_migrations WHERE version = 31').run();
    }).immediate();
  } finally {
    database.pragma('foreign_keys = ON');
  }
  assert.equal(database.prepare(
    'SELECT MAX(version) AS version FROM schema_migrations',
  ).get().version, 30);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
}

module.exports = Object.freeze({
  assertCurrentProjectDatabaseRegistry,
  removeSchema31ExtensionForSyntheticSchema30,
  removeSchema32SyntheticFixtureArtifacts,
  stripSchema32ForSyntheticSchema31,
});
