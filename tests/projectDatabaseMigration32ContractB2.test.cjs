const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BetterSqlite3 = require('better-sqlite3');
const {
  PROJECT_DATABASE_MIGRATION_32,
  PROJECT_DATABASE_MIGRATION_32_DOWN_SQL,
  PROJECT_DATABASE_MIGRATION_32_HARD_EXIT_CHECKPOINTS,
  PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS,
  PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON,
  PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON_CONTRACT,
  PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256,
  PROJECT_DATABASE_SCHEMA_32_EXTENSION_FINGERPRINT,
  PROJECT_DATABASE_SCHEMA_32_FINGERPRINT_MAPPINGS,
  PROJECT_DATABASE_SCHEMA_32_LINEAGE,
  PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR,
  PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
  PROJECT_DATABASE_SCHEMA_32_LOGICAL_CONTENT_DIGEST_CONTRACT,
  PROJECT_DATABASE_SCHEMA_32_LOGICAL_CONTENT_DIGEST_SCOPE,
  PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
  PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS,
} = require('../backend/src/services/projectDatabaseMigration32');
const {
  PROJECT_DATABASE_MIGRATION_31,
  PROJECT_DATABASE_SCHEMA_31_EXTENSION_FINGERPRINT,
} = require('../backend/src/services/projectDatabaseMigration31');

const EXPECTED_SCHEMA_32_CHECKSUM =
  'a667e75b6d6ba425146a773d2a037ec55e09dbf38bc5fff62f02702996e4c999';

const DATABASE_UUID = '11111111-1111-4111-8111-111111111111';
const RECOVERY_GENERATION = '22222222-2222-4222-8222-222222222222';
const RECEIPT_UUID_0 = '33333333-3333-4333-8333-333333333330';
const RECEIPT_UUID_1 = '33333333-3333-4333-8333-333333333331';

const EXPECTED_OWNED_OBJECTS = Object.freeze({
  tables: Object.freeze([
    'project_database_storage_policy',
    'project_database_identity',
    'project_database_backup_receipts',
    'project_database_canonical_backup_head',
  ]),
  indexes: Object.freeze([
    'idx_project_database_backup_receipts_identity_sequence',
  ]),
  views: Object.freeze([]),
  triggers: Object.freeze([
    'trg_project_database_storage_policy_insert_guard',
    'trg_project_database_storage_policy_update_guard',
    'trg_project_database_storage_policy_delete_guard',
    'trg_project_database_identity_insert_guard',
    'trg_project_database_identity_immutable',
    'trg_project_database_identity_sequence_guard',
    'trg_project_database_identity_delete_guard',
    'trg_project_database_backup_receipts_insert_collision_guard',
    'trg_project_database_backup_receipts_current_identity_insert',
    'trg_project_database_backup_receipts_update_guard',
    'trg_project_database_backup_receipts_delete_guard',
    'trg_project_database_canonical_backup_head_insert_collision_guard',
    'trg_project_database_canonical_backup_head_insert_guard',
    'trg_project_database_canonical_backup_head_update_guard',
    'trg_project_database_canonical_backup_head_delete_guard',
  ]),
});

const EXPECTED_CANONICAL_JSON_CONTRACT = Object.freeze({
  format: 't8-canonical-json-utf8-v1',
  objectKeyOrder: 'ecmascript-utf16-code-unit-ascending-recursive',
  arrayOrder: 'preserved',
  whitespace: 'none',
  textEncoding: 'utf8',
  numberEncoding: 'ecmascript-json-finite-number-serialization',
  objectPolicy: 'plain-or-null-prototype-only',
  unsupportedValues:
    'reject-undefined-function-symbol-bigint-nonfinite-sparse-array-cycle-and-nonplain-object',
});

const EXPECTED_LOGICAL_CONTENT_DIGEST_CONTRACT = Object.freeze({
  format: 't8-project-database-logical-content-digest-v2',
  algorithm: 'sha256',
  scope: 'sqlite-logical-snapshot-excluding-schema32-backup-receipt-objects-v2',
  streamHeader: 't8-project-database-logical-content-digest-v2\0',
  lengthEncoding: 'unsigned-64-bit-big-endian',
  excludedObjectNames: Object.freeze([
    'project_database_backup_receipts',
    'project_database_canonical_backup_head',
  ]),
  tableOrder: 'main-table-name-utf8-buffer-compare-ascending',
  columnOrder: 'pragma-table-xinfo-cid-ascending-hidden-nonzero-excluded',
  rowOrder: Object.freeze({
    withPrimaryKey:
      'canonical-primary-key-tuple-buffer-compare-ascending-then-canonical-full-row-tuple-buffer-compare-ascending',
    withoutPrimaryKey:
      'canonical-full-row-tuple-buffer-compare-ascending',
    implicitRowidPolicy: 'never-read-or-order-by-rowid',
  }),
  frames: Object.freeze({
    table: Object.freeze({
      typeByte: 'T',
      bytes: 'ascii-T-plus-u64be-utf8-name-byte-length-plus-utf8-name',
    }),
    column: Object.freeze({
      typeByte: 'C',
      bytes: 'ascii-C-plus-u64be-utf8-name-byte-length-plus-utf8-name',
    }),
    row: Object.freeze({
      typeByte: 'R',
      bytes: 'ascii-R-plus-u64be-canonical-tuple-byte-length-plus-canonical-tuple',
    }),
    tableEnd: Object.freeze({
      typeByte: 'E',
      bytes: 'ascii-E-plus-u64be-row-count',
    }),
  }),
  valueEncoding: Object.freeze({
    framing: 'ascii-type-byte-plus-u64be-payload-byte-length-plus-payload',
    null: 'ascii-n-plus-u64be-zero',
    integer: 'ascii-i-plus-u64be-payload-length-plus-canonical-base10-ascii',
    real: 'ascii-r-plus-u64be-eight-plus-ieee754-binary64-big-endian',
    text: 'ascii-t-plus-u64be-utf8-byte-length-plus-utf8',
    blob: 'ascii-b-plus-u64be-raw-byte-length-plus-raw-bytes',
  }),
});

function normalizeSql(sql) {
  return String(sql).replace(/\r\n?/g, '\n').trim();
}

function independentlyCalculateMigrationChecksum(definition) {
  const input = JSON.stringify({
    format: definition.checksumCanonicalization,
    version: definition.version,
    fromVersion: definition.fromVersion,
    name: definition.name,
    downPolicy: definition.downPolicy,
    UP_SQL: normalizeSql(definition.UP_SQL),
    DOWN_SQL: normalizeSql(definition.DOWN_SQL),
    ownedObjectNames: definition.ownedObjectNames,
    imperativeContract: definition.imperativeContract,
  });
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function policy(overrides = {}) {
  return {
    singleton_id: 1,
    policy_revision: 1,
    active_storage_budget_bytes: 1520,
    main_max_bytes: 1000,
    wal_checkpoint_target_bytes: 100,
    maximum_single_transaction_wal_bytes: 50,
    wal_pressure_bytes: 200,
    wal_reserve_bytes: 300,
    wal_residual_limit_bytes: 80,
    shm_reserve_bytes: 40,
    hot_journal_reserve_bytes: 50,
    sqlite_temp_reserve_bytes: 60,
    minimum_filesystem_free_bytes: 70,
    backup_candidate_reserve_bytes: 1170,
    recovery_evidence_reserve_bytes: 100,
    synchronous_mode: 'FULL',
    updated_at: 1000,
    ...overrides,
  };
}

function insertPolicy(database, values, insertClause = 'INSERT', conflictClause = '') {
  database.prepare(`
    ${insertClause} INTO project_database_storage_policy (
      singleton_id,
      policy_revision,
      active_storage_budget_bytes,
      main_max_bytes,
      wal_checkpoint_target_bytes,
      maximum_single_transaction_wal_bytes,
      wal_pressure_bytes,
      wal_reserve_bytes,
      wal_residual_limit_bytes,
      shm_reserve_bytes,
      hot_journal_reserve_bytes,
      sqlite_temp_reserve_bytes,
      minimum_filesystem_free_bytes,
      backup_candidate_reserve_bytes,
      recovery_evidence_reserve_bytes,
      synchronous_mode,
      updated_at
    ) VALUES (
      @singleton_id,
      @policy_revision,
      @active_storage_budget_bytes,
      @main_max_bytes,
      @wal_checkpoint_target_bytes,
      @maximum_single_transaction_wal_bytes,
      @wal_pressure_bytes,
      @wal_reserve_bytes,
      @wal_residual_limit_bytes,
      @shm_reserve_bytes,
      @hot_journal_reserve_bytes,
      @sqlite_temp_reserve_bytes,
      @minimum_filesystem_free_bytes,
      @backup_candidate_reserve_bytes,
      @recovery_evidence_reserve_bytes,
      @synchronous_mode,
      @updated_at
    )
    ${conflictClause}
  `).run(values);
}

function identity(overrides = {}) {
  return {
    singleton_id: 1,
    database_uuid: DATABASE_UUID,
    recovery_generation: RECOVERY_GENERATION,
    write_sequence: 0,
    schema_version: PROJECT_DATABASE_MIGRATION_32.version,
    schema_lineage: PROJECT_DATABASE_SCHEMA_32_LINEAGE,
    schema_lineage_digest: PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

function insertIdentity(database, values, insertClause = 'INSERT', conflictClause = '') {
  database.prepare(`
    ${insertClause} INTO project_database_identity (
      singleton_id,
      database_uuid,
      recovery_generation,
      write_sequence,
      schema_version,
      schema_lineage,
      schema_lineage_digest,
      created_at,
      updated_at
    ) VALUES (
      @singleton_id,
      @database_uuid,
      @recovery_generation,
      @write_sequence,
      @schema_version,
      @schema_lineage,
      @schema_lineage_digest,
      @created_at,
      @updated_at
    )
    ${conflictClause}
  `).run(values);
}

function receipt({ receiptUuid, writeSequence, policyRevision = 2, overrides = {} }) {
  const fromSchemaFingerprint =
    PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS[0];
  const schemaFingerprint = 'e'.repeat(64);
  const migrationAppliedAt = 1500;
  const identityDigest = PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256({
    databaseUuid: DATABASE_UUID,
    recoveryGeneration: RECOVERY_GENERATION,
    capturedWriteSequence: writeSequence,
    storagePolicyRevision: policyRevision,
    schemaLineageDigest: PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
  });
  const migrationReceiptDigest = PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256({
    schemaVersion: PROJECT_DATABASE_MIGRATION_32.version,
    migrationName: PROJECT_DATABASE_MIGRATION_32.name,
    migrationChecksum: PROJECT_DATABASE_MIGRATION_32.checksum,
    fromSchemaFingerprint,
    schemaFingerprint,
    downPolicy: PROJECT_DATABASE_MIGRATION_32.downPolicy,
    appliedAt: migrationAppliedAt,
  });
  return {
    receipt_uuid: receiptUuid,
    receipt_format_version: 1,
    backup_kind: 'canonical',
    database_uuid: DATABASE_UUID,
    recovery_generation: RECOVERY_GENERATION,
    captured_write_sequence: writeSequence,
    storage_policy_revision: policyRevision,
    schema_version: PROJECT_DATABASE_MIGRATION_32.version,
    schema_lineage: PROJECT_DATABASE_SCHEMA_32_LINEAGE,
    schema_lineage_digest: PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
    from_schema_fingerprint: fromSchemaFingerprint,
    schema_fingerprint: schemaFingerprint,
    migration_name: PROJECT_DATABASE_MIGRATION_32.name,
    migration_checksum: PROJECT_DATABASE_MIGRATION_32.checksum,
    migration_down_policy: PROJECT_DATABASE_MIGRATION_32.downPolicy,
    migration_applied_at: migrationAppliedAt,
    migration_receipt_digest: migrationReceiptDigest,
    identity_digest: identityDigest,
    logical_content_digest_algorithm: 'sha256',
    logical_content_digest_scope:
      PROJECT_DATABASE_SCHEMA_32_LOGICAL_CONTENT_DIGEST_SCOPE,
    logical_content_digest: 'd'.repeat(64),
    created_at: 2000 + writeSequence,
    sealed_at: 2100 + writeSequence,
    ...overrides,
  };
}

function insertReceipt(database, values, insertClause = 'INSERT', conflictClause = '') {
  database.prepare(`
    ${insertClause} INTO project_database_backup_receipts (
      receipt_uuid,
      receipt_format_version,
      backup_kind,
      database_uuid,
      recovery_generation,
      captured_write_sequence,
      storage_policy_revision,
      schema_version,
      schema_lineage,
      schema_lineage_digest,
      from_schema_fingerprint,
      schema_fingerprint,
      migration_name,
      migration_checksum,
      migration_down_policy,
      migration_applied_at,
      migration_receipt_digest,
      identity_digest,
      logical_content_digest_algorithm,
      logical_content_digest_scope,
      logical_content_digest,
      created_at,
      sealed_at
    ) VALUES (
      @receipt_uuid,
      @receipt_format_version,
      @backup_kind,
      @database_uuid,
      @recovery_generation,
      @captured_write_sequence,
      @storage_policy_revision,
      @schema_version,
      @schema_lineage,
      @schema_lineage_digest,
      @from_schema_fingerprint,
      @schema_fingerprint,
      @migration_name,
      @migration_checksum,
      @migration_down_policy,
      @migration_applied_at,
      @migration_receipt_digest,
      @identity_digest,
      @logical_content_digest_algorithm,
      @logical_content_digest_scope,
      @logical_content_digest,
      @created_at,
      @sealed_at
    )
    ${conflictClause}
  `).run(values);
}

function sqliteObjectNames(database) {
  return database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all().map((row) => String(row.name));
}

function removeTemporaryDirectory(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  assert.equal(
    `${resolved}${path.sep}`.startsWith(tempRoot),
    true,
    `refusing to remove non-temporary directory: ${resolved}`,
  );
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('B2 schema32 canonical JSON freezes recursive UTF-16 ordering and strict values', () => {
  assert.deepEqual(
    PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON_CONTRACT,
    EXPECTED_CANONICAL_JSON_CONTRACT,
  );
  assert.equal(Object.isFrozen(PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON_CONTRACT), true);

  const astralKey = '\u{1f600}';
  const privateUseKey = '\ue000';
  const value = {
    [privateUseKey]: 'private-use',
    z: -0,
    nested: { b: 2, a: 1 },
    [astralKey]: 'astral',
    array: [{ y: true, x: null }, 3.5],
  };
  const expected = `{"array":[{"x":null,"y":true},3.5],"nested":{"a":1,"b":2},"z":0,"${astralKey}":"astral","${privateUseKey}":"private-use"}`;
  assert.equal(PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON(value), expected);
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON({ b: 2, a: 1 }),
    PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON({ a: 1, b: 2 }),
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256(value),
    createHash('sha256').update(expected, 'utf8').digest('hex'),
  );

  const sparse = [];
  sparse.length = 1;
  const cyclic = {};
  cyclic.self = cyclic;
  const symbolKeyed = { visible: true };
  symbolKeyed[Symbol('hidden')] = 'must-not-be-silently-omitted';
  for (const invalid of [
    undefined,
    () => undefined,
    Symbol('invalid'),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    sparse,
    cyclic,
    symbolKeyed,
    new Date(0),
    { invalid: undefined },
  ]) {
    assert.throws(
      () => PROJECT_DATABASE_SCHEMA_32_CANONICAL_JSON(invalid),
      /canonical JSON rejects/,
    );
  }
});

test('B2 schema32 literal contract is deterministic, backup-only, and production-wired', () => {
  assert.equal(PROJECT_DATABASE_MIGRATION_32.version, 32);
  assert.equal(PROJECT_DATABASE_MIGRATION_32.fromVersion, 31);
  assert.equal(
    PROJECT_DATABASE_MIGRATION_32.name,
    'physical-capacity-and-canonical-backup-contract',
  );
  assert.equal(PROJECT_DATABASE_MIGRATION_32.downPolicy, 'backup-only');
  assert.equal(PROJECT_DATABASE_MIGRATION_32_DOWN_SQL, '');
  assert.doesNotMatch(PROJECT_DATABASE_MIGRATION_32.DOWN_SQL, /DROP|DELETE|UPDATE/i);
  assert.equal(PROJECT_DATABASE_MIGRATION_32.checksum, EXPECTED_SCHEMA_32_CHECKSUM);
  assert.equal(
    independentlyCalculateMigrationChecksum(PROJECT_DATABASE_MIGRATION_32),
    EXPECTED_SCHEMA_32_CHECKSUM,
  );

  assert.equal(Object.isFrozen(PROJECT_DATABASE_MIGRATION_32), true);
  assert.equal(Object.isFrozen(PROJECT_DATABASE_MIGRATION_32.imperativeContract), true);
  assert.deepEqual(PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECTS, EXPECTED_OWNED_OBJECTS);
  assert.deepEqual(
    PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
    [
      ...EXPECTED_OWNED_OBJECTS.tables,
      ...EXPECTED_OWNED_OBJECTS.indexes,
      ...EXPECTED_OWNED_OBJECTS.views,
      ...EXPECTED_OWNED_OBJECTS.triggers,
    ],
  );
  assert.equal(
    new Set(PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES).size,
    PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES.length,
  );

  const contract = PROJECT_DATABASE_MIGRATION_32.imperativeContract;
  assert.equal(contract.integrationStatus, 'production-wired');
  assert.equal(
    contract.freshnessClaim,
    'canonical-backup-receipts-and-write-sequence-freshness-enforced-fail-closed',
  );
  assert.equal(
    contract.storagePolicy.unknownMeasurementPolicy,
    'deny-never-substitute-zero',
  );
  assert.equal(
    contract.canonicalBackupReceipt.storage,
    'inside-candidate-sqlite-transaction-never-loose-json',
  );
  assert.equal(
    contract.canonicalBackupReceipt.freshnessVerificationStatus,
    'production-wired-fail-closed',
  );
  assert.deepEqual(contract.canonicalBackupReceipt.identityDigestFields, [
    'databaseUuid',
    'recoveryGeneration',
    'capturedWriteSequence',
    'storagePolicyRevision',
    'schemaLineageDigest',
  ]);
  assert.deepEqual(contract.canonicalBackupReceipt.migrationReceiptDigestFields, [
    'schemaVersion',
    'migrationName',
    'migrationChecksum',
    'fromSchemaFingerprint',
    'schemaFingerprint',
    'downPolicy',
    'appliedAt',
  ]);
  assert.deepEqual(
    contract.canonicalBackupReceipt.canonicalJson,
    EXPECTED_CANONICAL_JSON_CONTRACT,
  );
  assert.deepEqual(
    contract.canonicalBackupReceipt.logicalContentDigest,
    EXPECTED_LOGICAL_CONTENT_DIGEST_CONTRACT,
  );
  assert.deepEqual(
    PROJECT_DATABASE_SCHEMA_32_LOGICAL_CONTENT_DIGEST_CONTRACT,
    EXPECTED_LOGICAL_CONTENT_DIGEST_CONTRACT,
  );

  assert.deepEqual(
    contract.phases.map((phase) => phase.id),
    [
      'locked-schema31-gate',
      'physical-capacity-admission-before-ddl',
      'create-schema32-contract-state',
      'initialize-storage-policy-and-database-identity',
      'install-schema32-runtime-guards',
      'verify-schema32-contract-state',
      'lineage-and-receipt-commit',
    ],
  );
  assert.equal(contract.phases.length, 7);
  assert.deepEqual(PROJECT_DATABASE_MIGRATION_32_HARD_EXIT_CHECKPOINTS, [
    'after-from-verify',
    'after-ddl',
    'after-backfill',
    'after-to-verify',
    'after-ledger',
    'after-receipt',
    'before-commit',
  ]);
  assert.equal(contract.crashContract.afterCommitControl, 'after-commit-control');

  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.embeddedLineageSeed
      .sourceMigrationChecksum,
    PROJECT_DATABASE_MIGRATION_31.checksum,
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.embeddedLineageSeed
      .sourceExtensionFingerprint,
    PROJECT_DATABASE_SCHEMA_31_EXTENSION_FINGERPRINT,
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.exactMappingContract.status,
    'production-wired-descriptor-composed-exact',
  );
  assert.equal(PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS.length, 10);
  assert.deepEqual(
    [...PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS].sort(),
    PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS,
  );
  for (const fingerprint of PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS) {
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.embeddedLineageSeed
      .acceptedSourceFingerprints,
    PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS,
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.exactMappingContract.mappingCount,
    PROJECT_DATABASE_SCHEMA_32_ACCEPTED_SCHEMA_31_FINGERPRINTS.length,
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.exactMappingContract.knownVectorCount,
    PROJECT_DATABASE_SCHEMA_32_FINGERPRINT_MAPPINGS.length,
  );
  assert.equal(PROJECT_DATABASE_SCHEMA_32_FINGERPRINT_MAPPINGS.length, 9);
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.exactMappingContract.extensionFingerprint,
    PROJECT_DATABASE_SCHEMA_32_EXTENSION_FINGERPRINT,
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256(
      PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.embeddedLineageSeed,
    ),
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
  );
  assert.equal(
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DESCRIPTOR.embeddedLineageDigest,
    PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST,
  );

  const projectDatabaseSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'src', 'services', 'projectDatabase.js'),
    'utf8',
  );
  assert.match(projectDatabaseSource, /projectDatabaseMigration32/);
  const { PROJECT_DATABASE_SCHEMA_VERSION, PROJECT_DATABASE_MIGRATIONS } = require('../backend/src/services/projectDatabase');
  require('./helpers/projectDatabaseVersion.cjs').assertCurrentProjectDatabaseRegistry(PROJECT_DATABASE_SCHEMA_VERSION, PROJECT_DATABASE_MIGRATIONS);
  assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
  assert.equal(PROJECT_DATABASE_MIGRATIONS[31].checksum, EXPECTED_SCHEMA_32_CHECKSUM);
});

test('B2 schema32 TEMP SQLite contract enforces strict singleton policy and immutable identity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-b2-schema32-contract-'));
  const filename = path.join(directory, 'contract.sqlite3');
  const database = new BetterSqlite3(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.exec(PROJECT_DATABASE_MIGRATION_32.UP_SQL);

    assert.deepEqual(
      sqliteObjectNames(database),
      [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES].sort(),
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM project_database_storage_policy').get().count,
      0,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM project_database_identity').get().count,
      0,
    );

    assert.throws(() => insertPolicy(database, policy({ singleton_id: 2 })), /CHECK constraint/);
    assert.throws(() => insertPolicy(database, policy({ wal_pressure_bytes: 140 })), /CHECK constraint/);
    assert.throws(
      () => insertPolicy(database, policy({ active_storage_budget_bytes: 1519 })),
      /CHECK constraint/,
    );
    assert.throws(() => insertPolicy(database, policy({ synchronous_mode: 'NORMAL' })), /CHECK constraint/);
    assert.throws(
      () => insertPolicy(database, policy({ backup_candidate_reserve_bytes: 1169 })),
      /CHECK constraint/,
    );
    insertPolicy(database, policy());
    assert.throws(
      () => insertPolicy(database, policy()),
      /storage policy replacement or duplicate insert is forbidden/,
    );
    assert.throws(
      () => insertPolicy(database, policy({ policy_revision: 2, updated_at: 1001 }),
        'INSERT OR REPLACE'),
      /storage policy replacement or duplicate insert is forbidden/,
    );
    assert.throws(
      () => insertPolicy(
        database,
        policy({ policy_revision: 2, updated_at: 1001 }),
        'INSERT',
        'ON CONFLICT(singleton_id) DO UPDATE SET policy_revision = excluded.policy_revision',
      ),
      /storage policy replacement or duplicate insert is forbidden/,
    );
    assert.deepEqual(
      database.prepare('SELECT policy_revision, updated_at FROM project_database_storage_policy')
        .get(),
      { policy_revision: 1, updated_at: 1000 },
    );

    assert.throws(
      () => insertIdentity(database, identity({ database_uuid: 'not-a-uuid' })),
      /CHECK constraint/,
    );
    assert.throws(() => insertIdentity(database, identity({ singleton_id: 2 })), /CHECK constraint/);
    assert.throws(
      () => insertIdentity(database, identity({ schema_lineage: 'unfrozen-lineage' })),
      /CHECK constraint/,
    );
    insertIdentity(database, identity());
    assert.throws(
      () => insertIdentity(database, identity()),
      /database identity replacement or duplicate insert is forbidden/,
    );
    assert.throws(
      () => insertIdentity(database, identity({ write_sequence: 1, updated_at: 1001 }),
        'INSERT OR REPLACE'),
      /database identity replacement or duplicate insert is forbidden/,
    );
    assert.throws(
      () => insertIdentity(
        database,
        identity({ write_sequence: 1, updated_at: 1001 }),
        'INSERT',
        'ON CONFLICT(singleton_id) DO UPDATE SET write_sequence = excluded.write_sequence',
      ),
      /database identity replacement or duplicate insert is forbidden/,
    );
    assert.deepEqual(
      database.prepare('SELECT write_sequence, updated_at FROM project_database_identity').get(),
      { write_sequence: 0, updated_at: 1000 },
    );

    assert.throws(
      () => database.prepare(`
        UPDATE project_database_storage_policy
        SET main_max_bytes = main_max_bytes + 1
        WHERE singleton_id = 1
      `).run(),
      /identity\/revision\/timestamp is immutable or non-monotonic/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE project_database_storage_policy
        SET policy_revision = 2, updated_at = 999
        WHERE singleton_id = 1
      `).run(),
      /identity\/revision\/timestamp is immutable or non-monotonic/,
    );
    database.prepare(`
      UPDATE project_database_storage_policy
      SET policy_revision = 2, updated_at = 1001
      WHERE singleton_id = 1
    `).run();
    assert.equal(
      database.prepare(`
        SELECT policy_revision FROM project_database_storage_policy WHERE singleton_id = 1
      `).get().policy_revision,
      2,
    );
    assert.throws(
      () => database.prepare('DELETE FROM project_database_storage_policy').run(),
      /singleton cannot be deleted/,
    );

    assert.throws(
      () => database.prepare(`
        UPDATE project_database_identity
        SET database_uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            write_sequence = 1,
            updated_at = 1001
        WHERE singleton_id = 1
      `).run(),
      /permanent database identity or lineage is immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE project_database_identity
        SET write_sequence = 2, updated_at = 1001
        WHERE singleton_id = 1
      `).run(),
      /write sequence must advance exactly once/,
    );
    database.prepare(`
      UPDATE project_database_identity
      SET write_sequence = 1, updated_at = 1001
      WHERE singleton_id = 1
    `).run();
    assert.equal(
      database.prepare(`
        SELECT write_sequence FROM project_database_identity WHERE singleton_id = 1
      `).get().write_sequence,
      1,
    );
    assert.throws(
      () => database.prepare('DELETE FROM project_database_identity').run(),
      /identity singleton cannot be deleted/,
    );

    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('quick_check', { simple: true }), 'ok');

    // DOWN is intentionally backup-only and therefore cannot mutate this DB.
    database.exec(PROJECT_DATABASE_MIGRATION_32_DOWN_SQL);
    assert.deepEqual(
      sqliteObjectNames(database),
      [...PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES].sort(),
    );
  } finally {
    database.close();
    removeTemporaryDirectory(directory);
  }
});

test('B2 schema32 TEMP SQLite receipt is self-contained, append-only, and head-selected exactly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-b2-schema32-receipt-'));
  const filename = path.join(directory, 'receipt.sqlite3');
  const database = new BetterSqlite3(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.exec(PROJECT_DATABASE_MIGRATION_32.UP_SQL);
    insertPolicy(database, policy({ policy_revision: 2 }));
    insertIdentity(database, identity());

    assert.throws(
      () => insertReceipt(database, receipt({
        receiptUuid: RECEIPT_UUID_0,
        writeSequence: 1,
      })),
      /must match current identity and storage policy/,
    );
    assert.throws(
      () => insertReceipt(database, receipt({
        receiptUuid: RECEIPT_UUID_0,
        writeSequence: 0,
        overrides: { storage_policy_revision: 1 },
      })),
      /must match current identity and storage policy/,
    );

    const firstReceipt = receipt({ receiptUuid: RECEIPT_UUID_0, writeSequence: 0 });
    insertReceipt(database, firstReceipt);
    assert.throws(
      () => insertReceipt(database, {
        ...firstReceipt,
        logical_content_digest: 'f'.repeat(64),
      }, 'INSERT OR REPLACE'),
      /backup receipt replacement or duplicate insert is forbidden/,
    );
    assert.throws(
      () => insertReceipt(
        database,
        { ...firstReceipt, logical_content_digest: 'f'.repeat(64) },
        'INSERT',
        'ON CONFLICT(receipt_uuid) DO UPDATE SET logical_content_digest = excluded.logical_content_digest',
      ),
      /backup receipt replacement or duplicate insert is forbidden/,
    );
    const storedReceipt = database.prepare(`
      SELECT * FROM project_database_backup_receipts WHERE receipt_uuid = ?
    `).get(RECEIPT_UUID_0);
    assert.equal(storedReceipt.database_uuid, DATABASE_UUID);
    assert.equal(storedReceipt.recovery_generation, RECOVERY_GENERATION);
    assert.equal(storedReceipt.captured_write_sequence, 0);
    assert.equal(storedReceipt.schema_lineage_digest, PROJECT_DATABASE_SCHEMA_32_LINEAGE_DIGEST);
    assert.equal(storedReceipt.migration_checksum, PROJECT_DATABASE_MIGRATION_32.checksum);
    assert.equal(storedReceipt.migration_down_policy, PROJECT_DATABASE_MIGRATION_32.downPolicy);
    assert.equal(storedReceipt.migration_applied_at, 1500);
    assert.equal(
      storedReceipt.migration_receipt_digest,
      PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256({
        schemaVersion: PROJECT_DATABASE_MIGRATION_32.version,
        migrationName: PROJECT_DATABASE_MIGRATION_32.name,
        migrationChecksum: PROJECT_DATABASE_MIGRATION_32.checksum,
        fromSchemaFingerprint: storedReceipt.from_schema_fingerprint,
        schemaFingerprint: storedReceipt.schema_fingerprint,
        downPolicy: PROJECT_DATABASE_MIGRATION_32.downPolicy,
        appliedAt: 1500,
      }),
    );
    assert.notEqual(
      storedReceipt.migration_receipt_digest,
      PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256({
        schemaVersion: PROJECT_DATABASE_MIGRATION_32.version,
        migrationName: PROJECT_DATABASE_MIGRATION_32.name,
        migrationChecksum: PROJECT_DATABASE_MIGRATION_32.checksum,
        fromSchemaFingerprint: storedReceipt.from_schema_fingerprint,
        schemaFingerprint: storedReceipt.schema_fingerprint,
        downPolicy: PROJECT_DATABASE_MIGRATION_32.downPolicy,
        appliedAt: 1501,
      }),
    );
    assert.notEqual(
      storedReceipt.migration_receipt_digest,
      PROJECT_DATABASE_SCHEMA_32_CANONICAL_SHA256({
        schemaVersion: PROJECT_DATABASE_MIGRATION_32.version,
        migrationName: PROJECT_DATABASE_MIGRATION_32.name,
        migrationChecksum: PROJECT_DATABASE_MIGRATION_32.checksum,
        fromSchemaFingerprint: storedReceipt.from_schema_fingerprint,
        schemaFingerprint: storedReceipt.schema_fingerprint,
        downPolicy: 'empty-only',
        appliedAt: 1500,
      }),
    );
    assert.equal(storedReceipt.logical_content_digest_scope,
      PROJECT_DATABASE_SCHEMA_32_LOGICAL_CONTENT_DIGEST_SCOPE);
    assert.equal(storedReceipt.logical_content_digest.length, 64);

    assert.throws(
      () => database.prepare(`
        INSERT INTO project_database_canonical_backup_head (
          singleton_id, receipt_uuid, database_uuid, recovery_generation,
          captured_write_sequence, selected_at
        ) VALUES (1, ?, ?, ?, 0, 2000)
      `).run(RECEIPT_UUID_0, DATABASE_UUID, RECOVERY_GENERATION),
      /must select a sealed receipt for the current identity/,
    );
    database.prepare(`
      INSERT INTO project_database_canonical_backup_head (
        singleton_id, receipt_uuid, database_uuid, recovery_generation,
        captured_write_sequence, selected_at
      ) VALUES (1, ?, ?, ?, 0, 2200)
    `).run(RECEIPT_UUID_0, DATABASE_UUID, RECOVERY_GENERATION);
    assert.throws(
      () => database.prepare(`
        INSERT OR REPLACE INTO project_database_canonical_backup_head (
          singleton_id, receipt_uuid, database_uuid, recovery_generation,
          captured_write_sequence, selected_at
        ) VALUES (1, ?, ?, ?, 0, 2201)
      `).run(RECEIPT_UUID_0, DATABASE_UUID, RECOVERY_GENERATION),
      /canonical backup head replacement or duplicate insert is forbidden/,
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO project_database_canonical_backup_head (
          singleton_id, receipt_uuid, database_uuid, recovery_generation,
          captured_write_sequence, selected_at
        ) VALUES (1, ?, ?, ?, 0, 2201)
        ON CONFLICT(singleton_id) DO UPDATE SET selected_at = excluded.selected_at
      `).run(RECEIPT_UUID_0, DATABASE_UUID, RECOVERY_GENERATION),
      /canonical backup head replacement or duplicate insert is forbidden/,
    );

    assert.throws(
      () => database.prepare(`
        UPDATE project_database_backup_receipts
        SET logical_content_digest = ?
        WHERE receipt_uuid = ?
      `).run('f'.repeat(64), RECEIPT_UUID_0),
      /backup receipts are immutable/,
    );
    assert.throws(
      () => database.prepare(`
        DELETE FROM project_database_backup_receipts WHERE receipt_uuid = ?
      `).run(RECEIPT_UUID_0),
      /backup receipts are immutable/,
    );

    database.prepare(`
      UPDATE project_database_identity
      SET write_sequence = 1, updated_at = 1001
      WHERE singleton_id = 1
    `).run();
    const secondReceipt = receipt({ receiptUuid: RECEIPT_UUID_1, writeSequence: 1 });
    insertReceipt(database, secondReceipt);
    database.prepare(`
      UPDATE project_database_canonical_backup_head
      SET receipt_uuid = ?,
          captured_write_sequence = 1,
          selected_at = 2201
      WHERE singleton_id = 1
    `).run(RECEIPT_UUID_1);

    const exactHead = database.prepare(`
      SELECT
        head.receipt_uuid,
        head.database_uuid,
        head.recovery_generation,
        head.captured_write_sequence,
        identity.write_sequence AS current_write_sequence,
        receipt.identity_digest,
        receipt.migration_receipt_digest,
        receipt.logical_content_digest
      FROM project_database_canonical_backup_head AS head
      JOIN project_database_identity AS identity ON identity.singleton_id = head.singleton_id
      JOIN project_database_backup_receipts AS receipt
        ON receipt.receipt_uuid = head.receipt_uuid
       AND receipt.database_uuid = head.database_uuid
       AND receipt.recovery_generation = head.recovery_generation
       AND receipt.captured_write_sequence = head.captured_write_sequence
      WHERE head.singleton_id = 1
    `).get();
    assert.deepEqual(exactHead, {
      receipt_uuid: RECEIPT_UUID_1,
      database_uuid: DATABASE_UUID,
      recovery_generation: RECOVERY_GENERATION,
      captured_write_sequence: 1,
      current_write_sequence: 1,
      identity_digest: secondReceipt.identity_digest,
      migration_receipt_digest: secondReceipt.migration_receipt_digest,
      logical_content_digest: secondReceipt.logical_content_digest,
    });

    assert.throws(
      () => database.prepare(`
        UPDATE project_database_canonical_backup_head
        SET receipt_uuid = ?, captured_write_sequence = 0, selected_at = 2300
        WHERE singleton_id = 1
      `).run(RECEIPT_UUID_0),
      /must advance to a sealed current-identity receipt/,
    );
    assert.throws(
      () => database.prepare('DELETE FROM project_database_canonical_backup_head').run(),
      /canonical backup head cannot be deleted/,
    );

    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(database.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    database.close();
    removeTemporaryDirectory(directory);
  }
});
