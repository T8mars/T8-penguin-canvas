const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');

const {
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectDatabase,
  ProjectDatabaseSchemaInvalidError,
} = require('../backend/src/services/projectDatabase');
const {
  PROJECT_DATABASE_MIGRATION_29_DOWN_SQL,
  PROJECT_DATABASE_SCHEMA_29_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration29');
const {
  PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration23');
const {
  PROJECT_DATABASE_MIGRATION_30_DOWN_SQL,
  PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration30');
const {
  PROJECT_DATABASE_MIGRATION_31,
  PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES,
} = require('../backend/src/services/projectDatabaseMigration31');
const {
  PROJECT_DATABASE_MIGRATION_31_LEGACY_GAPS_DOWN_SQL,
} = require('../backend/src/services/projectDatabaseMigration31LegacyGaps');
const {
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS,
} = require('../backend/src/services/projectDatabaseMigration31DurableLedgers');
const {
  PROJECT_DATABASE_MIGRATION_32_UP_SQL,
  PROJECT_DATABASE_SCHEMA_32_EXTENSION_FINGERPRINT,
  PROJECT_DATABASE_SCHEMA_32_FINGERPRINT_MAPPINGS,
  PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
  composeProjectDatabaseSchema32TargetManifest,
} = require('../backend/src/services/projectDatabaseMigration32');
const { normalizeCanvasDocument } = require('../backend/src/collaboration/protocol');
const {
  inspectProjectDatabaseSchemaManifest,
} = require('./helpers/projectDatabaseSchemaManifest.cjs');
const {
  stripSchema32ForSyntheticSchema31,
} = require('./helpers/projectDatabaseVersion.cjs');

const SCHEMA_DRIFTS = [
  {
    label: 'missing-table',
    mutate(database) {
      database.exec('DROP TABLE project_review_visibility_policies');
    },
    remains(database) {
      return database.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'project_review_visibility_policies'
      `).get().count === 0;
    },
  },
  {
    label: 'missing-schema29-extension-index',
    mutate(database) {
      database.exec('DROP INDEX idx_common_graph_operation_evidence_scope_created');
    },
    remains(database) {
      return database.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_common_graph_operation_evidence_scope_created'
      `).get().count === 0;
    },
  },
  {
    label: 'missing-schema30-extension-trigger',
    mutate(database) {
      database.exec('DROP TRIGGER trg_permanent_ledger_text_noop_immutable_update');
    },
    remains(database) {
      return database.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND name = 'trg_permanent_ledger_text_noop_immutable_update'
      `).get().count === 0;
    },
  },
  {
    label: 'wrong-index',
    mutate(database) {
      database.exec(`
        DROP INDEX idx_run_intents_status;
        CREATE INDEX idx_run_intents_status ON run_intents(status);
      `);
    },
    remains(database) {
      return database.pragma("index_info('idx_run_intents_status')")
        .map((column) => column.name).join(',') === 'status';
    },
  },
  {
    label: 'wrong-trigger',
    mutate(database) {
      database.exec(`
        DROP TRIGGER trg_audit_events_append_only_delete;
        CREATE TRIGGER trg_audit_events_append_only_delete
        BEFORE DELETE ON audit_events BEGIN
          SELECT 1;
        END;
      `);
    },
    remains(database) {
      const sql = database.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'trigger' AND name = 'trg_audit_events_append_only_delete'
      `).get()?.sql;
      return /SELECT\s+1/i.test(String(sql || ''));
    },
  },
  {
    label: 'schema-migrations-on-conflict',
    rebuildsMigrationLedger: true,
    mutate(database) {
      database.exec(`
        ALTER TABLE schema_migrations RENAME TO schema_migrations_original;
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY ON CONFLICT REPLACE,
          applied_at INTEGER NOT NULL
        );
        INSERT INTO schema_migrations(version, applied_at)
          SELECT version, applied_at FROM schema_migrations_original;
        DROP TABLE schema_migrations_original;
      `);
    },
    remains(database) {
      const sql = database.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()?.sql;
      return /ON\s+CONFLICT\s+REPLACE/i.test(String(sql || ''));
    },
  },
  {
    label: 'column-order',
    mutate(database) {
      database.exec(`
        ALTER TABLE run_retention_policies RENAME TO run_retention_policies_original;
        CREATE TABLE run_retention_policies (
          project_id TEXT PRIMARY KEY,
          max_asset_refs INTEGER NOT NULL DEFAULT 100000,
          max_days INTEGER NOT NULL DEFAULT 30,
          max_runs INTEGER NOT NULL DEFAULT 5000,
          max_db_bytes INTEGER NOT NULL DEFAULT 2147483648,
          keep_referenced INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO run_retention_policies(
          project_id, max_days, max_runs, max_asset_refs,
          max_db_bytes, keep_referenced, updated_at
        )
        SELECT project_id, max_days, max_runs, max_asset_refs,
               max_db_bytes, keep_referenced, updated_at
        FROM run_retention_policies_original;
        DROP TABLE run_retention_policies_original;
      `);
    },
    remains(database) {
      return database.pragma("table_xinfo('run_retention_policies')")
        .map((column) => column.name).slice(0, 3).join(',')
        === 'project_id,max_asset_refs,max_days';
    },
  },
  {
    label: 'collation',
    rebuildsMigrationLedger: true,
    mutate(database) {
      database.exec(`
        ALTER TABLE schema_migrations RENAME TO schema_migrations_original;
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL COLLATE NOCASE
        );
        INSERT INTO schema_migrations(version, applied_at)
          SELECT version, applied_at FROM schema_migrations_original;
        DROP TABLE schema_migrations_original;
      `);
    },
    remains(database) {
      const sql = database.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()?.sql;
      return /applied_at\s+INTEGER\s+NOT\s+NULL\s+COLLATE\s+NOCASE/i.test(String(sql || ''));
    },
  },
];

function temporaryProject(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const filename = path.join(directory, 'projects.sqlite3');
  return { directory, filename, generationFilename: `${filename}.recovery-generation.json` };
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function fileSha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function fileIntegrityState(filename) {
  const stat = fs.statSync(filename, { bigint: true });
  return {
    sha256: fileSha256(filename),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
  };
}

async function createLatestDatabase(filename) {
  const database = new ProjectDatabase(filename, { autoBackup: false });
  await database.close();
}

function readSchema29OwnedObjects(database) {
  const placeholders = PROJECT_DATABASE_SCHEMA_29_OWNED_OBJECT_NAMES.map(() => '?').join(', ');
  return database.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE name IN (${placeholders})
    ORDER BY type, name
  `).all(...PROJECT_DATABASE_SCHEMA_29_OWNED_OBJECT_NAMES);
}

function readSchema30OwnedObjects(database) {
  const placeholders = PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES.map(() => '?').join(', ');
  return database.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE name IN (${placeholders})
    ORDER BY type, name
  `).all(...PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES);
}

// Production schema31 DOWN remains backup-only. Synthetic historical fixtures
// remove only schema31-owned objects and its exact receipt/checkpoint.
function stripSchema31ForSchema30Test(database) {
  stripSchema32ForSyntheticSchema31(database);
  database.exec(PROJECT_DATABASE_MIGRATION_31_LEGACY_GAPS_DOWN_SQL);
  const drop = (type, name) => database.exec(`DROP ${type} IF EXISTS "${name}"`);
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.triggers.forEach((name) => drop('TRIGGER', name));
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.views.forEach((name) => drop('VIEW', name));
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.indexes.forEach((name) => drop('INDEX', name));
  [...PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.tables]
    .reverse()
    .forEach((name) => drop('TABLE', name));
  database.prepare('DELETE FROM schema_migration_receipts WHERE version = ?')
    .run(PROJECT_DATABASE_MIGRATION_31.version);
  database.prepare('DELETE FROM schema_migrations WHERE version = ?')
    .run(PROJECT_DATABASE_MIGRATION_31.version);
  const filename = String(database?.name || '');
  if (filename && filename !== ':memory:') {
    fs.rmSync(`${filename}.pre-migration-v30.sqlite3`, { force: true });
  }
}

function removeSchema29ExtensionForSyntheticLegacy(database) {
  const schema31Present = database.prepare(`
    SELECT 1 AS present FROM schema_migrations WHERE version = ?
  `).get(PROJECT_DATABASE_MIGRATION_31.version);
  if (schema31Present) stripSchema31ForSchema30Test(database);
  const schema30Present = database.prepare(`
    SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = 'canvas_permanent_ledger_policies'
  `).get();
  if (schema30Present) {
    database.prepare('DELETE FROM schema_migration_receipts WHERE version = 30').run();
    database.prepare('DELETE FROM schema_migrations WHERE version = 30').run();
    database.exec(PROJECT_DATABASE_MIGRATION_30_DOWN_SQL);
    const placeholders = PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES.map(() => '?').join(', ');
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN (${placeholders})
    `).get(...PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES).count, 0);
  }
  database.exec(PROJECT_DATABASE_MIGRATION_29_DOWN_SQL);
  assert.deepEqual(readSchema29OwnedObjects(database), []);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
}

function loadHistoricalProjectDatabase(ref) {
  const root = path.resolve(__dirname, '..');
  const filename = path.join(root, 'backend', 'src', 'services', 'projectDatabase.js');
  const source = childProcess.execFileSync(
    'git',
    ['show', `${ref}:backend/src/services/projectDatabase.js`],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  const historicalModule = new Module(`${filename}#${ref}`, module);
  historicalModule.filename = filename;
  historicalModule.paths = Module._nodeModulePaths(path.dirname(filename));
  historicalModule._compile(source, filename);
  return historicalModule.exports;
}

function loadProjectDatabaseSourceFile(sourceFilename) {
  const source = fs.readFileSync(sourceFilename, 'utf8');
  const filename = path.join(
    path.resolve(__dirname, '..'),
    'backend',
    'src',
    'services',
    'projectDatabase.js',
  );
  const loaded = new Module(`${filename}#schema-lineage-source`, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

async function closeDatabase(database) {
  const result = database?.close();
  if (result && typeof result.then === 'function') await result;
}

function applySchemaDrift(filename, drift) {
  const database = new BetterSqlite3(filename);
  const foreignKeys = Number(database.pragma('foreign_keys', { simple: true }));
  const legacyAlterTable = Number(database.pragma('legacy_alter_table', { simple: true }));
  try {
    if (drift.rebuildsMigrationLedger) {
      database.pragma('foreign_keys = OFF');
      database.pragma('legacy_alter_table = ON');
    }
    drift.mutate(database);
    if (drift.rebuildsMigrationLedger) {
      database.pragma(`legacy_alter_table = ${legacyAlterTable ? 'ON' : 'OFF'}`);
      database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally {
    try { database.pragma(`legacy_alter_table = ${legacyAlterTable ? 'ON' : 'OFF'}`); } catch (_) {}
    try { database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`); } catch (_) {}
    database.close();
  }
}

function seedSanitizedCoreSchema22(filename, options = {}) {
  const summaryColumnSql = options.summaryColumnSql || 'summary TEXT NOT NULL';
  const database = new BetterSqlite3(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE canvas_documents (
        canvas_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE canvas_patch_applications (
        project_id TEXT NOT NULL,
        canvas_id TEXT NOT NULL,
        patch_id TEXT NOT NULL,
        schema TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        preview_digest TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        applied_revision INTEGER NOT NULL,
        reverted_revision INTEGER,
        actor_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        ${summaryColumnSql},
        diagnostics_json TEXT NOT NULL DEFAULT '[]',
        operation_count INTEGER NOT NULL,
        affected_node_ids_json TEXT NOT NULL DEFAULT '[]',
        affected_edge_ids_json TEXT NOT NULL DEFAULT '[]',
        changes_json TEXT NOT NULL DEFAULT '[]',
        forward_ops_json TEXT NOT NULL,
        inverse_ops_json TEXT NOT NULL,
        postconditions_json TEXT NOT NULL,
        acknowledgements_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'applied',
        created_at INTEGER NOT NULL,
        reverted_at INTEGER,
        updated_at INTEGER NOT NULL,
        guard_version INTEGER NOT NULL DEFAULT 0 CHECK(guard_version IN (0, 1)),
        provenance_guards_json TEXT NOT NULL DEFAULT '[]',
        provenance_guards_digest TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(project_id, canvas_id, patch_id),
        FOREIGN KEY(canvas_id) REFERENCES canvas_documents(canvas_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_canvas_patch_applications_actor_created
        ON canvas_patch_applications(project_id, canvas_id, actor_id, created_at DESC, patch_id DESC);
      CREATE INDEX idx_canvas_patch_applications_canvas_revision
        ON canvas_patch_applications(canvas_id, applied_revision DESC);
      CREATE TRIGGER trg_canvas_patch_applications_project_insert
      BEFORE INSERT ON canvas_patch_applications BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM canvas_documents d
          WHERE d.canvas_id = NEW.canvas_id AND d.project_id = NEW.project_id
        ) THEN RAISE(ABORT, 'canvas_patch_applications project mismatch') END;
      END;
      CREATE TRIGGER trg_canvas_patch_applications_project_update
      BEFORE UPDATE OF project_id, canvas_id ON canvas_patch_applications BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM canvas_documents d
          WHERE d.canvas_id = NEW.canvas_id AND d.project_id = NEW.project_id
        ) THEN RAISE(ABORT, 'canvas_patch_applications project mismatch') END;
      END;
      CREATE TABLE asset_semantic_models (
        model_key TEXT NOT NULL,
        model_version TEXT NOT NULL,
        capability TEXT NOT NULL CHECK(capability IN ('caption', 'ocr', 'embedding')),
        status TEXT NOT NULL CHECK(status IN ('not-installed', 'downloading', 'verifying', 'installed', 'failed', 'disabled', 'deleting')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
        artifact_digest TEXT,
        byte_size INTEGER,
        downloaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(downloaded_bytes >= 0),
        total_bytes INTEGER CHECK(total_bytes IS NULL OR total_bytes >= 0),
        install_path TEXT,
        error_code TEXT,
        error_message TEXT,
        installed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        download_idempotency_key TEXT,
        download_request_revision INTEGER,
        PRIMARY KEY(model_key, model_version)
      );
      CREATE INDEX idx_asset_semantic_models_capability_status
        ON asset_semantic_models(capability, status, model_key, model_version);
      CREATE TRIGGER trg_asset_semantic_models_identity_immutable
      BEFORE UPDATE OF model_key, model_version, capability ON asset_semantic_models
      WHEN NEW.model_key <> OLD.model_key OR NEW.model_version <> OLD.model_version OR NEW.capability <> OLD.capability
      BEGIN SELECT RAISE(ABORT, 'asset_semantic_models identity is immutable'); END;
      CREATE TABLE asset_semantic_profiles (
        project_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        caption_enabled INTEGER NOT NULL DEFAULT 0 CHECK(caption_enabled IN (0, 1)),
        caption_model_key TEXT,
        caption_model_version TEXT,
        ocr_enabled INTEGER NOT NULL DEFAULT 0 CHECK(ocr_enabled IN (0, 1)),
        ocr_model_key TEXT,
        ocr_model_version TEXT,
        embedding_enabled INTEGER NOT NULL DEFAULT 0 CHECK(embedding_enabled IN (0, 1)),
        embedding_model_key TEXT,
        embedding_model_version TEXT,
        active_generation INTEGER,
        building_generation INTEGER,
        updated_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(caption_model_key, caption_model_version)
          REFERENCES asset_semantic_models(model_key, model_version) ON DELETE RESTRICT,
        FOREIGN KEY(ocr_model_key, ocr_model_version)
          REFERENCES asset_semantic_models(model_key, model_version) ON DELETE RESTRICT,
        FOREIGN KEY(embedding_model_key, embedding_model_version)
          REFERENCES asset_semantic_models(model_key, model_version) ON DELETE RESTRICT
      );
    `);

    const insertMigration = database.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    );
    const document = normalizeCanvasDocument('sanitized-core-canvas', {
      nodes: [{ id: 'preserved-node', type: 'text', data: { prompt: 'preserve schema22' } }],
      edges: [],
    }, {
      projectId: 'sanitized-core-project',
      revision: 22,
      updatedAt: 1_720_000_000_022,
    });
    database.transaction(() => {
      for (let version = 1; version <= 22; version += 1) {
        insertMigration.run(version, 1_720_000_000_000 + version);
      }
      database.prepare(`
        INSERT INTO canvas_documents(
          canvas_id, project_id, schema_version, revision, snapshot_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        document.canvasId,
        document.projectId,
        document.schemaVersion,
        document.revision,
        JSON.stringify(document),
        1_720_000_000_000,
        document.updatedAt,
      );
      database.prepare(`
        INSERT INTO canvas_patch_applications(
          project_id, canvas_id, patch_id, schema, request_digest, preview_digest,
          base_revision, applied_revision, reverted_revision, actor_id, session_id,
          summary, diagnostics_json, operation_count, affected_node_ids_json,
          affected_edge_ids_json, changes_json, forward_ops_json, inverse_ops_json,
          postconditions_json, acknowledgements_json, status, created_at, reverted_at,
          updated_at, guard_version, provenance_guards_json, provenance_guards_digest
        ) VALUES (
          ?, ?, ?, 't8-canvas-patch-v1', ?, ?, 21, 22, NULL, ?, ?, ?, '[]', 1,
          '["preserved-node"]', '[]', '[]', '[]', '[]', '[]', '[]', 'applied',
          ?, NULL, ?, 0, '[]', ''
        )
      `).run(
        document.projectId,
        document.canvasId,
        'sanitized-schema22-patch',
        'a'.repeat(64),
        'b'.repeat(64),
        'sanitized-actor',
        'sanitized-session',
        'preserved schema22 patch',
        1_720_000_000_100,
        1_720_000_000_100,
      );
      database.prepare(`
        INSERT INTO asset_semantic_models(
          model_key, model_version, capability, status, revision, artifact_digest,
          byte_size, downloaded_bytes, total_bytes, install_path, error_code,
          error_message, installed_at, created_at, updated_at,
          download_idempotency_key, download_request_revision
        ) VALUES (?, ?, 'caption', 'downloading', 3, NULL, 4096, 1024, 4096, NULL,
          NULL, NULL, NULL, ?, ?, ?, 3)
      `).run(
        'sanitized-caption-model',
        'v22',
        1_720_000_000_200,
        1_720_000_000_201,
        'sanitized-download-request',
      );
      database.prepare(`
        INSERT INTO asset_semantic_profiles(
          project_id, revision, enabled, caption_enabled, caption_model_key,
          caption_model_version, ocr_enabled, embedding_enabled, updated_by,
          created_at, updated_at
        ) VALUES (?, 1, 1, 1, ?, ?, 0, 0, ?, ?, ?)
      `).run(
        document.projectId,
        'sanitized-caption-model',
        'v22',
        'sanitized-actor',
        1_720_000_000_202,
        1_720_000_000_202,
      );
    })();
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
}

function seedSchema15AssetFingerprintLayout(filename) {
  const database = new BetterSqlite3(filename);
  try {
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        entity_uid TEXT,
        content_hash TEXT,
        perceptual_hash TEXT,
        kind TEXT NOT NULL,
        mime_type TEXT,
        filename TEXT NOT NULL,
        managed_path TEXT,
        source_url TEXT,
        storage_mode TEXT NOT NULL DEFAULT 'linked',
        availability TEXT NOT NULL DEFAULT 'available',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const insert = database.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    );
    for (let version = 1; version <= 15; version += 1) {
      insert.run(version, 1_700_000_000_000 + version);
    }
  } finally {
    database.close();
  }
}

async function seedSchema16SemanticUpgradeLayout(filename) {
  await createLatestDatabase(filename);
  const database = new BetterSqlite3(filename);
  try {
    database.pragma('foreign_keys = OFF');
    removeSchema29ExtensionForSyntheticLegacy(database);
    database.exec(`
      DROP TABLE run_output_commits;
      DROP TABLE asset_upload_chunks;
      DROP TABLE asset_upload_sessions;
      DROP INDEX idx_asset_blobs_storage_state;
      DROP INDEX idx_assets_project_created_id;
      DROP TABLE asset_semantic_fts;
      DROP TABLE asset_semantic_embeddings;
      DROP TABLE asset_semantic_documents;
      DROP TABLE asset_semantic_jobs;
      DROP TABLE asset_semantic_generations;
      DROP TABLE asset_semantic_profiles;
      DROP TABLE asset_semantic_models;
      ALTER TABLE asset_blobs DROP COLUMN pending_delete_at;
      ALTER TABLE asset_blobs DROP COLUMN verified_at;
      ALTER TABLE asset_blobs DROP COLUMN storage_state;
      ALTER TABLE asset_blobs DROP COLUMN storage_key;
      DELETE FROM schema_migrations WHERE version >= 17;
    `);
  } finally {
    database.close();
  }
}

function seedPreLedgerCanvasAndAssetsLayout(filename) {
  const database = new BetterSqlite3(filename);
  try {
    database.exec(`
      CREATE TABLE canvas_documents (
        canvas_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        content_hash TEXT,
        kind TEXT NOT NULL,
        mime_type TEXT,
        filename TEXT NOT NULL,
        managed_path TEXT,
        source_url TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  } finally {
    database.close();
  }
}

async function seedSchema25OutputDescriptorAddColumnLayout(filename) {
  await createLatestDatabase(filename);
  const database = new BetterSqlite3(filename);
  try {
    removeSchema29ExtensionForSyntheticLegacy(database);
    database.exec(`
      ALTER TABLE run_output_commits DROP COLUMN source_descriptor_digest;
      ALTER TABLE run_output_slot_reservations DROP COLUMN source_descriptor_digest;
      DELETE FROM schema_migrations WHERE version >= 26;
    `);
  } finally {
    database.close();
  }
}

async function seedSchema27ExecutionQueueAddColumnLayout(filename) {
  await createLatestDatabase(filename);
  const database = new BetterSqlite3(filename);
  try {
    removeSchema29ExtensionForSyntheticLegacy(database);
    database.exec(`
      DROP TRIGGER IF EXISTS trg_audit_events_mutation_uid_insert;
      DROP TRIGGER IF EXISTS trg_audit_events_append_only_update;
      DROP TRIGGER IF EXISTS trg_audit_events_append_only_delete;
      DROP INDEX IF EXISTS idx_audit_events_mutation_uid;
      DROP TRIGGER IF EXISTS trg_room_execution_policies_scope_insert;
      DROP TRIGGER IF EXISTS trg_room_execution_policies_scope_immutable;
      DROP TABLE IF EXISTS room_execution_policies;
      DROP INDEX IF EXISTS idx_run_intents_dispatch_queue;
      DROP INDEX IF EXISTS idx_run_intents_dispatch_lease;
      DROP INDEX IF EXISTS idx_run_intents_requester_created;
      ALTER TABLE run_intents DROP COLUMN last_error_message;
      ALTER TABLE run_intents DROP COLUMN last_error_code;
      ALTER TABLE run_intents DROP COLUMN cancelled_at;
      ALTER TABLE run_intents DROP COLUMN cancel_requested_at;
      ALTER TABLE run_intents DROP COLUMN last_heartbeat_at;
      ALTER TABLE run_intents DROP COLUMN lease_expires_at;
      ALTER TABLE run_intents DROP COLUMN lease_token;
      ALTER TABLE run_intents DROP COLUMN lease_owner;
      ALTER TABLE run_intents DROP COLUMN next_attempt_at;
      ALTER TABLE run_intents DROP COLUMN dispatch_attempts;
      ALTER TABLE run_intents DROP COLUMN confirmed_by;
      ALTER TABLE run_intents DROP COLUMN confirmed_at;
      ALTER TABLE run_intents DROP COLUMN confirmation_required;
      ALTER TABLE run_intents DROP COLUMN queue_revision;
      ALTER TABLE audit_events DROP COLUMN mutation_uid;
      DELETE FROM schema_migrations WHERE version >= 28;
    `);
  } finally {
    database.close();
  }
}

async function seedSchema25And27AddColumnLayout(filename) {
  await seedSchema25OutputDescriptorAddColumnLayout(filename);
  const database = new BetterSqlite3(filename);
  try {
    database.exec(`
      DROP TRIGGER IF EXISTS trg_audit_events_mutation_uid_insert;
      DROP TRIGGER IF EXISTS trg_audit_events_append_only_update;
      DROP TRIGGER IF EXISTS trg_audit_events_append_only_delete;
      DROP INDEX IF EXISTS idx_audit_events_mutation_uid;
      DROP TRIGGER IF EXISTS trg_room_execution_policies_scope_insert;
      DROP TRIGGER IF EXISTS trg_room_execution_policies_scope_immutable;
      DROP TABLE IF EXISTS room_execution_policies;
      DROP INDEX IF EXISTS idx_run_intents_dispatch_queue;
      DROP INDEX IF EXISTS idx_run_intents_dispatch_lease;
      DROP INDEX IF EXISTS idx_run_intents_requester_created;
      ALTER TABLE run_intents DROP COLUMN last_error_message;
      ALTER TABLE run_intents DROP COLUMN last_error_code;
      ALTER TABLE run_intents DROP COLUMN cancelled_at;
      ALTER TABLE run_intents DROP COLUMN cancel_requested_at;
      ALTER TABLE run_intents DROP COLUMN last_heartbeat_at;
      ALTER TABLE run_intents DROP COLUMN lease_expires_at;
      ALTER TABLE run_intents DROP COLUMN lease_token;
      ALTER TABLE run_intents DROP COLUMN lease_owner;
      ALTER TABLE run_intents DROP COLUMN next_attempt_at;
      ALTER TABLE run_intents DROP COLUMN dispatch_attempts;
      ALTER TABLE run_intents DROP COLUMN confirmed_by;
      ALTER TABLE run_intents DROP COLUMN confirmed_at;
      ALTER TABLE run_intents DROP COLUMN confirmation_required;
      ALTER TABLE run_intents DROP COLUMN queue_revision;
      ALTER TABLE audit_events DROP COLUMN mutation_uid;
      DELETE FROM schema_migrations WHERE version >= 26;
    `);
  } finally {
    database.close();
  }
}

function assertSchemaDriftFailure(error, contextPattern) {
  if (!(error instanceof ProjectDatabaseSchemaInvalidError)
    || error.code !== 'project_database_schema_invalid') return false;
  const context = String(error.details?.context || '');
  const rootContext = context.replace(/(?::base-v(?:28|29|30|31))+$/, '');
  const currentBase = PROJECT_DATABASE_SCHEMA_VERSION >= 32 ? ':base-v31' : '';
  if (!contextPattern.test(rootContext)) return false;
  if (/schema 结构指纹不匹配/.test(error.message)) {
    return context === `${rootContext}${currentBase}:base-v30:base-v29:base-v28`
      && error.details?.schemaVersion === 28
      && error.details?.expectedFingerprintCount === 10
      && /^[a-f0-9]{64}$/.test(String(error.details?.expectedFingerprint || ''))
      && /^[a-f0-9]{64}$/.test(String(error.details?.actualFingerprint || ''))
      && error.details.expectedFingerprint !== error.details.actualFingerprint;
  }
  if (/schema 29 扩展对象集合不完整/.test(error.message)) {
    return context === `${rootContext}${currentBase}:base-v30:base-v29`
      && error.details?.expectedObjectCount === PROJECT_DATABASE_SCHEMA_29_OWNED_OBJECT_NAMES.length
      && Number.isInteger(error.details?.actualObjectCount)
      && error.details.actualObjectCount < error.details.expectedObjectCount
      && /^[a-f0-9]{64}$/.test(String(error.details?.actualObjectsDigest || ''));
  }
  if (/schema 30 扩展对象集合不完整/.test(error.message)) {
    return context === `${rootContext}${currentBase}:base-v30`
      && error.details?.expectedObjectCount === PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES.length
      && Number.isInteger(error.details?.actualObjectCount)
      && error.details.actualObjectCount < error.details.expectedObjectCount
      && /^[a-f0-9]{64}$/.test(String(error.details?.actualObjectsDigest || ''));
  }
  if (/schema 31 扩展对象集合不完整/.test(error.message)) {
    return context === `${rootContext}${currentBase}`
      && error.details?.expectedObjectCount === PROJECT_DATABASE_SCHEMA_31_OWNED_OBJECT_NAMES.length
      && Number.isInteger(error.details?.actualObjectCount)
      && error.details.actualObjectCount < error.details.expectedObjectCount
      && /^[a-f0-9]{64}$/.test(String(error.details?.actualObjectsDigest || ''));
  }
  return false;
}

test('B2 validated latest schema takes a true zero-write migrate fast path', async () => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const canvas = database.ensureCanvas('b2-noop-canvas', { nodes: [], edges: [] });
    database.upsertAsset({
      id: 'b2-noop-asset',
      projectId: canvas.projectId,
      kind: 'image',
      mimeType: 'image/png',
      filename: 'b2-noop.png',
      contentHash: 'a'.repeat(64),
      contentHashVerification: 'verified',
      storageMode: 'managed',
      availability: 'available',
    });
    const before = Number(database.db.prepare('SELECT total_changes() AS changes').get().changes);

    database.migrate();
    database.migrate();

    const after = Number(database.db.prepare('SELECT total_changes() AS changes').get().changes);
    assert.equal(after - before, 0);
    assert.deepEqual(
      database.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
      Array.from({ length: PROJECT_DATABASE_SCHEMA_VERSION }, (_, index) => index + 1),
    );
  } finally {
    await database.close();
  }
});

test('B2 malformed migration-ledger diagnostics expose only bounded schema summaries', () => {
  const fixture = temporaryProject('t8-b2-ledger-diagnostic-redaction-');
  const sentinel = 'api_key=SUPERSECRET_123456789';
  try {
    const raw = new BetterSqlite3(fixture.filename);
    try {
      raw.exec(`
        CREATE TABLE schema_migrations(
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL,
          "${sentinel}" TEXT
        )
      `);
      raw.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (1, 1)').run();
    } finally {
      raw.close();
    }
    const before = fileIntegrityState(fixture.filename);

    assert.throws(
      () => new ProjectDatabase(fixture.filename, { autoBackup: false }),
      (error) => error instanceof ProjectDatabaseSchemaInvalidError
        && /migration ledger|schema_migrations|迁移台账/i.test(error.message)
        && Number(error.details?.actualColumnCount) === 3
        && /^[a-f0-9]{64}$/.test(String(error.details?.actualColumnsDigest || ''))
        && !JSON.stringify(error.details).includes(sentinel),
    );
    assert.equal(fs.existsSync(fixture.generationFilename), false);
    assert.deepEqual(fileIntegrityState(fixture.filename), before);
  } finally {
    cleanup(fixture.directory);
  }
});

test('B2 complete manifest accepts only deterministic pre-ledger and schema10/15/16/17/19/22/23/25/27/28 histories', async () => {
  const historicalSchema22 = loadHistoricalProjectDatabase('v2.5.6');
  const historicalSchema23 = loadHistoricalProjectDatabase('v2.5.8');
  // Frozen F2 source creates only a new disposable fixture. Never depend on a
  // historical checkout path or open a retained user database.
  const retainedF2Schema23 = loadHistoricalProjectDatabase('9b6f6a43bc407a3c47a32dd9c0536afa879f256b');
  assert.equal(historicalSchema22.PROJECT_DATABASE_SCHEMA_VERSION, 22);
  assert.equal(historicalSchema23.PROJECT_DATABASE_SCHEMA_VERSION, 23);
  const matrix = [
    { label: 'fresh', target: null, implementation: { ProjectDatabase } },
    { label: 'pre-ledger', target: null, seed: seedPreLedgerCanvasAndAssetsLayout },
    { label: 'schema15', target: 15, seed: seedSchema15AssetFingerprintLayout },
    { label: 'schema16', target: 16, seed: seedSchema16SemanticUpgradeLayout },
    { label: 'schema22-sanitized-core', target: 22, seed: seedSanitizedCoreSchema22 },
    ...[10, 17, 19, 22].map((target) => ({
      label: `schema${target}`,
      target,
      implementation: historicalSchema22,
    })),
    { label: 'retained-f2-schema23-source', target: 23, implementation: retainedF2Schema23 },
    { label: 'schema23', target: 23, implementation: historicalSchema23 },
    { label: 'schema25', target: 25, implementation: { ProjectDatabase } },
    {
      label: 'schema25-output-descriptor-add-column',
      target: 25,
      seed: seedSchema25OutputDescriptorAddColumnLayout,
    },
    {
      label: 'schema27-execution-queue-add-column',
      target: 27,
      seed: seedSchema27ExecutionQueueAddColumnLayout,
    },
    { label: 'schema28', target: 28, implementation: { ProjectDatabase } },
  ];
  const schema32Mappings = new Map();
  const schema32ExtensionFingerprints = new Set();

  for (const entry of matrix) {
    const fixture = temporaryProject(`t8-b2-manifest-matrix-${entry.label}-`);
    let seed = null;
    let upgraded = null;
    try {
      if (entry.seed) {
        await entry.seed(fixture.filename);
      } else {
        seed = new entry.implementation.ProjectDatabase(fixture.filename, { autoBackup: false });
        await closeDatabase(seed);
        seed = null;
      }
      if (entry.target != null && !entry.seed) {
        const raw = new BetterSqlite3(fixture.filename);
        try {
          if (entry.implementation.ProjectDatabase === ProjectDatabase) {
            removeSchema29ExtensionForSyntheticLegacy(raw);
          }
          const receiptTablePresent = Boolean(raw.prepare(`
            SELECT 1 AS present FROM sqlite_master
            WHERE type = 'table' AND name = 'schema_migration_receipts'
          `).get());
          if (receiptTablePresent) {
            raw.prepare('DELETE FROM schema_migration_receipts WHERE version > ?').run(entry.target);
          }
          raw.prepare('DELETE FROM schema_migrations WHERE version > ?').run(entry.target);
          assert.equal(
            raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
            entry.target,
          );
        } finally {
          raw.close();
        }
      } else if (entry.target != null) {
        const raw = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
        try {
          assert.equal(
            raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
            entry.target,
          );
        } finally {
          raw.close();
        }
      }

      try {
        upgraded = new ProjectDatabase(fixture.filename, { autoBackup: false });
      } catch (error) {
        error.message = `${entry.label}: ${error.message}`;
        throw error;
      }
      assert.equal(
        upgraded.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
        PROJECT_DATABASE_SCHEMA_VERSION,
      );
      assert.equal(upgraded.db.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(upgraded.db.pragma('foreign_key_check'), []);
      await upgraded.close();
      upgraded = null;

      const reopened = new ProjectDatabase(fixture.filename, { autoBackup: false });
      try {
        assert.equal(reopened.db.pragma('quick_check', { simple: true }), 'ok');
      } finally {
        await reopened.close();
      }

      const schema31Filename = `${fixture.filename}.pre-migration-v31.sqlite3`;
      assert.equal(fs.existsSync(schema31Filename), true);
      const rawSchema31 = new BetterSqlite3(schema31Filename);
      try {
        const sourceManifest = inspectProjectDatabaseSchemaManifest(rawSchema31, {
          descriptorVersion: 31,
          excludedObjectNames: PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
        });
        const receipt = rawSchema31.prepare(`
          SELECT to_fingerprint FROM schema_migration_receipts WHERE version = 31
        `).get();
        assert.equal(sourceManifest.fingerprint, receipt.to_fingerprint);

        rawSchema31.exec(PROJECT_DATABASE_MIGRATION_32_UP_SQL);
        const targetManifest = inspectProjectDatabaseSchemaManifest(rawSchema31, {
          descriptorVersion: 32,
          excludedObjectNames: PROJECT_DATABASE_SCHEMA_23_OWNED_OBJECT_NAMES,
        });
        const extensionManifest = inspectProjectDatabaseSchemaManifest(rawSchema31, {
          descriptorVersion: 32,
          includedObjectNames: PROJECT_DATABASE_SCHEMA_32_OWNED_OBJECT_NAMES,
        });
        const composedTarget = composeProjectDatabaseSchema32TargetManifest(
          sourceManifest,
          extensionManifest,
        );
        assert.equal(composedTarget.fingerprint, targetManifest.fingerprint);
        const previous = schema32Mappings.get(sourceManifest.fingerprint);
        if (previous) assert.equal(previous, targetManifest.fingerprint);
        schema32Mappings.set(sourceManifest.fingerprint, targetManifest.fingerprint);
        schema32ExtensionFingerprints.add(extensionManifest.fingerprint);
      } finally {
        rawSchema31.close();
      }
    } finally {
      await closeDatabase(seed);
      await closeDatabase(upgraded);
      cleanup(fixture.directory);
    }
  }
  const mappings = [...schema32Mappings.entries()]
    .map(([fromFingerprint, toFingerprint]) => ({ fromFingerprint, toFingerprint }))
    .sort((left, right) => left.fromFingerprint.localeCompare(right.fromFingerprint));
  assert.equal(mappings.length, 8);
  for (const mapping of mappings) {
    assert.deepEqual(
      PROJECT_DATABASE_SCHEMA_32_FINGERPRINT_MAPPINGS.find(
        (entry) => entry.fromFingerprint === mapping.fromFingerprint,
      ),
      mapping,
    );
  }
  assert.deepEqual(
    [...schema32ExtensionFingerprints].sort(),
    [PROJECT_DATABASE_SCHEMA_32_EXTENSION_FINGERPRINT],
  );
});

test('B2 current-version table, index, and trigger drift fail closed without silent repair', async () => {
  for (const drift of SCHEMA_DRIFTS) {
    const fixture = temporaryProject(`t8-b2-current-schema-${drift.label}-`);
    try {
      await createLatestDatabase(fixture.filename);
      fs.rmSync(fixture.generationFilename, { force: true });
      applySchemaDrift(fixture.filename, drift);
      const primaryBefore = fileSha256(fixture.filename);

      assert.throws(
        () => new ProjectDatabase(fixture.filename, { autoBackup: false }),
        (error) => assertSchemaDriftFailure(error, /^(?:preflight-|active-initialize$)/),
      );

      assert.equal(fs.existsSync(fixture.generationFilename), false);
      assert.equal(fileSha256(fixture.filename), primaryBefore);
      const verify = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
      try {
        assert.equal(drift.remains(verify), true, `${drift.label} was silently repaired`);
      } finally {
        verify.close();
      }
    } finally {
      cleanup(fixture.directory);
    }
  }
});

test('B2 current-schema stable identity corruption fails in read-only preflight without changing hash or mtime', async () => {
  const drifts = [
    { label: 'entity-uid', table: 'assets', column: 'entity_uid' },
    { label: 'mutation-uid', table: 'audit_events', column: 'mutation_uid' },
  ];
  for (const drift of drifts) {
    const fixture = temporaryProject(`t8-b2-current-identity-${drift.label}-`);
    const sentinel = `not-a-uuid-sensitive-${drift.label}`;
    try {
      const database = new ProjectDatabase(fixture.filename, { autoBackup: false });
      try {
        const canvas = database.ensureCanvas('b2-identity-canvas', { nodes: [], edges: [] }, 'b2-identity-project');
        database.upsertAsset({
          id: 'b2-identity-asset',
          projectId: canvas.projectId,
          kind: 'image',
          mimeType: 'image/png',
          filename: 'b2-identity.png',
          contentHash: 'c'.repeat(64),
          contentHashVerification: 'verified',
          storageMode: 'managed',
          availability: 'available',
        });
        database.appendAuditEvent({
          projectId: canvas.projectId,
          canvasId: canvas.canvasId,
          actorId: 'b2-identity-actor',
          sessionId: 'b2-identity-session',
          action: 'b2.identity.seed',
        });
      } finally {
        await database.close();
      }
      fs.rmSync(fixture.generationFilename, { force: true });

      const raw = new BetterSqlite3(fixture.filename);
      try {
        if (drift.table === 'assets') {
          raw.prepare('UPDATE assets SET entity_uid = ? WHERE id = ?')
            .run(sentinel, 'b2-identity-asset');
        } else {
          const immutableUpdateTriggers = raw.prepare(`
            SELECT name, sql FROM sqlite_master
            WHERE type = 'trigger' AND tbl_name = 'audit_events'
              AND (name = 'trg_audit_events_append_only_update'
                   OR name LIKE '%immutable_update')
            ORDER BY name ASC
          `).all();
          assert.ok(immutableUpdateTriggers.length >= 2);
          immutableUpdateTriggers.forEach((trigger) => raw.exec(`DROP TRIGGER "${trigger.name}"`));
          raw.prepare('UPDATE audit_events SET mutation_uid = ? WHERE action = ?')
            .run(sentinel, 'b2.identity.seed');
          immutableUpdateTriggers.forEach((trigger) => raw.exec(`${trigger.sql};`));
        }
      } finally {
        raw.close();
      }
      const before = fileIntegrityState(fixture.filename);

      let unexpectedOpen = null;
      try {
        assert.throws(
          () => {
            unexpectedOpen = new ProjectDatabase(fixture.filename, { autoBackup: false });
          },
          (error) => {
            const violations = error?.details?.identityViolations;
            return error instanceof ProjectDatabaseSchemaInvalidError
              && error.code === 'project_database_schema_invalid'
              && /稳定身份不变量校验失败/.test(error.message)
              && Array.isArray(violations)
              && violations.length === 1
              && violations[0].table === drift.table
              && violations[0].column === drift.column
              && violations[0].missingCount === 0
              && violations[0].invalidCount === 1
              && !JSON.stringify(error.details).includes(sentinel);
          },
        );
      } finally {
        await unexpectedOpen?.close();
      }

      assert.equal(fs.existsSync(fixture.generationFilename), false);
      assert.deepEqual(fileIntegrityState(fixture.filename), before);
      const verify = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
      try {
        const value = drift.table === 'assets'
          ? verify.prepare('SELECT entity_uid AS value FROM assets WHERE id = ?').get('b2-identity-asset').value
          : verify.prepare('SELECT mutation_uid AS value FROM audit_events WHERE action = ?').get('b2.identity.seed').value;
        assert.equal(value, sentinel);
        assert.equal(verify.pragma('quick_check', { simple: true }), 'ok');
      } finally {
        verify.close();
      }
    } finally {
      cleanup(fixture.directory);
    }
  }
});

test('B2 current-schema valid UUIDs cannot silently rebind an explicit asset ID to another entity', async () => {
  const fixture = temporaryProject('t8-b2-current-identity-binding-');
  const identities = {
    canvas: '28000000-0000-4000-8000-000000000001',
    actor: '28000000-0000-4000-8000-000000000002',
    firstAsset: '28000000-0000-4000-8000-000000000003',
    secondAsset: '28000000-0000-4000-8000-000000000004',
    thread: '28000000-0000-4000-8000-000000000005',
    comment: '28000000-0000-4000-8000-000000000006',
  };
  let database = null;
  let unexpectedOpen = null;
  try {
    database = new ProjectDatabase(fixture.filename, { autoBackup: false });
    database.ensureCanvas('b2-binding-canvas', {
      projectId: 'b2-binding-project',
      entityUid: identities.canvas,
      nodes: [],
      edges: [],
    }, 'b2-binding-project');
    const now = Date.now();
    database.db.prepare(`
      INSERT INTO collaboration_members(
        id, project_id, canvas_id, display_name, role, capabilities_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'reviewer', '["comment","approve"]', ?, ?)
    `).run(
      identities.actor,
      'b2-binding-project',
      'b2-binding-canvas',
      'B2 binding actor',
      now,
      now,
    );
    const firstAsset = database.upsertAsset({
      id: 'b2-binding-asset-a',
      entityUid: identities.firstAsset,
      projectId: 'b2-binding-project',
      contentHash: 'a'.repeat(64),
      kind: 'image',
      filename: 'binding-a.png',
      createdBy: identities.actor,
    });
    database.upsertAsset({
      id: 'b2-binding-asset-b',
      entityUid: identities.secondAsset,
      projectId: 'b2-binding-project',
      contentHash: 'b'.repeat(64),
      kind: 'image',
      filename: 'binding-b.png',
      createdBy: identities.actor,
    });
    database.createReviewThreadWithComment({
      id: identities.thread,
      entityUid: identities.thread,
      projectId: 'b2-binding-project',
      canvasId: 'b2-binding-canvas',
      canvasRevision: 1,
      anchor: { kind: 'canvas', targetEntityUid: identities.canvas },
      createdBy: identities.actor,
    }, {
      commentId: identities.comment,
      commentEntityUid: identities.comment,
      body: 'B2 identity binding pin',
      attachments: [{
        assetId: firstAsset.id,
        assetUid: firstAsset.entityUid,
        assetContentRevision: firstAsset.contentRevision,
        contentHash: firstAsset.contentHash,
      }],
      actorId: identities.actor,
      sessionId: 'b2-binding-session',
      sourceOperationId: 'b2-binding-create',
    });
    await database.close();
    database = null;
    fs.rmSync(fixture.generationFilename, { force: true });

    const raw = new BetterSqlite3(fixture.filename);
    try {
      const immutableTrigger = raw.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'trigger' AND name = 'trg_review_comment_attachments_immutable'
      `).get()?.sql;
      assert.ok(immutableTrigger);
      raw.exec('DROP TRIGGER trg_review_comment_attachments_immutable');
      raw.prepare(`
        UPDATE review_comment_attachments
        SET asset_entity_uid = ?
        WHERE comment_id = ?
      `).run(identities.secondAsset, identities.comment);
      raw.exec(`${immutableTrigger};`);
    } finally {
      raw.close();
    }
    const before = fileIntegrityState(fixture.filename);

    assert.throws(
      () => {
        unexpectedOpen = new ProjectDatabase(fixture.filename, { autoBackup: false });
      },
      (error) => {
        const violations = error?.details?.identityViolations;
        return error instanceof ProjectDatabaseSchemaInvalidError
          && /稳定身份不变量校验失败/.test(error.message)
          && Array.isArray(violations)
          && violations.some((violation) => (
            violation.table === 'review_comment_attachments'
            && violation.column === 'asset_id/asset_entity_uid'
            && violation.invalidCount === 1
          ))
          && !JSON.stringify(error.details).includes(identities.secondAsset);
      },
    );
    assert.equal(fs.existsSync(fixture.generationFilename), false);
    assert.deepEqual(fileIntegrityState(fixture.filename), before);
    const verify = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(verify.prepare(`
        SELECT asset_id, asset_entity_uid
        FROM review_comment_attachments
        WHERE comment_id = ?
      `).get(identities.comment), {
        asset_id: firstAsset.id,
        asset_entity_uid: identities.secondAsset,
      });
    } finally {
      verify.close();
    }

    const rawPin = new BetterSqlite3(fixture.filename);
    try {
      const immutableTrigger = rawPin.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'trigger' AND name = 'trg_review_comment_attachments_immutable'
      `).get()?.sql;
      assert.ok(immutableTrigger);
      rawPin.exec('DROP TRIGGER trg_review_comment_attachments_immutable');
      rawPin.prepare(`
        UPDATE review_comment_attachments
        SET asset_entity_uid = ?, asset_content_revision = ?, content_hash = ?
        WHERE comment_id = ?
      `).run(
        identities.firstAsset,
        firstAsset.contentRevision + 1,
        'b'.repeat(64),
        identities.comment,
      );
      rawPin.exec(`${immutableTrigger};`);
    } finally {
      rawPin.close();
    }
    const pinBefore = fileIntegrityState(fixture.filename);
    assert.throws(
      () => {
        unexpectedOpen = new ProjectDatabase(fixture.filename, { autoBackup: false });
      },
      (error) => Array.isArray(error?.details?.identityViolations)
        && error.details.identityViolations.some((violation) => (
          violation.table === 'review_comment_attachments'
          && violation.column === 'asset_content_revision/content_hash'
          && violation.invalidCount === 1
        )),
    );
    assert.equal(fs.existsSync(fixture.generationFilename), false);
    assert.deepEqual(fileIntegrityState(fixture.filename), pinBefore);
  } finally {
    await database?.close();
    await unexpectedOpen?.close();
    cleanup(fixture.directory);
  }
});

test('B2 current typed canonical canvas and subflow corruption fails read-only, including internal UID bindings', async () => {
  const wrongUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const drifts = [
    {
      label: 'subflow-root-invalid-uid',
      sentinel: 'sensitive-invalid-subflow-root-uid',
      expectedColumn: 'definition_json.entityUid',
      mutate(database, sentinel) {
        database.prepare(`
          UPDATE subflow_definitions
          SET definition_json = json_set(definition_json, '$.entityUid', ?)
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).run(sentinel);
      },
      read(database) {
        return JSON.parse(database.prepare(`
          SELECT definition_json FROM subflow_definitions
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).get().definition_json).entityUid;
      },
    },
    {
      label: 'subflow-root-wrong-valid-uid',
      sentinel: wrongUuid,
      expectedColumn: 'definition_json.entityUid',
      mutate(database, sentinel) {
        database.prepare(`
          UPDATE subflow_definitions
          SET definition_json = json_set(definition_json, '$.entityUid', ?)
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).run(sentinel);
      },
      read(database) {
        return JSON.parse(database.prepare(`
          SELECT definition_json FROM subflow_definitions
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).get().definition_json).entityUid;
      },
    },
    {
      label: 'subflow-internal-invalid-uid',
      sentinel: 'sensitive-invalid-internal-node-uid',
      expectedColumn: 'definition_json',
      mutate(database, sentinel) {
        database.prepare(`
          UPDATE subflow_definitions
          SET definition_json = json_set(definition_json, '$.nodes[0].entityUid', ?)
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).run(sentinel);
      },
      read(database) {
        return JSON.parse(database.prepare(`
          SELECT definition_json FROM subflow_definitions
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).get().definition_json).nodes[0].entityUid;
      },
    },
    {
      label: 'subflow-internal-wrong-valid-binding',
      sentinel: wrongUuid,
      expectedColumn: 'definition_json',
      mutate(database, sentinel) {
        database.prepare(`
          UPDATE subflow_definitions
          SET definition_json = json_set(definition_json, '$.inputs[0].internalNodeEntityUid', ?)
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).run(sentinel);
      },
      read(database) {
        return JSON.parse(database.prepare(`
          SELECT definition_json FROM subflow_definitions
          WHERE id = 'b2-typed-subflow' AND version = 1
        `).get().definition_json).inputs[0].internalNodeEntityUid;
      },
    },
    {
      label: 'canvas-root-invalid-uid',
      sentinel: 'sensitive-invalid-canvas-root-uid',
      expectedColumn: 'snapshot_json',
      mutate(database, sentinel) {
        database.prepare(`
          UPDATE canvas_documents
          SET snapshot_json = json_set(snapshot_json, '$.entityUid', ?)
          WHERE canvas_id = 'b2-typed-canvas'
        `).run(sentinel);
      },
      read(database) {
        return JSON.parse(database.prepare(`
          SELECT snapshot_json FROM canvas_documents WHERE canvas_id = 'b2-typed-canvas'
        `).get().snapshot_json).entityUid;
      },
    },
  ];

  for (const drift of drifts) {
    const fixture = temporaryProject(`t8-b2-current-typed-${drift.label}-`);
    try {
      const database = new ProjectDatabase(fixture.filename, { autoBackup: false });
      try {
        database.ensureCanvas('b2-typed-canvas', {
          nodes: [{
            id: 'b2-typed-canvas-node',
            type: 'text',
            position: { x: 0, y: 0 },
            data: { prompt: 'typed canonical seed' },
          }],
          edges: [],
        }, 'b2-typed-project');
        database.saveSubflowDefinition({
          id: 'b2-typed-subflow',
          projectId: 'b2-typed-project',
          name: 'B2 typed subflow',
          nodes: [{
            id: 'b2-typed-definition-node',
            type: 'text',
            position: { x: 0, y: 0 },
            data: { prompt: 'preserved business payload' },
          }],
          edges: [],
          inputs: [{
            id: 'b2-typed-input',
            name: 'Prompt',
            kind: 'text',
            internalNodeId: 'b2-typed-definition-node',
            internalHandle: 'prompt',
          }],
          outputs: [],
          exposedParameters: [],
        });
      } finally {
        await database.close();
      }
      fs.rmSync(fixture.generationFilename, { force: true });
      const raw = new BetterSqlite3(fixture.filename);
      try {
        drift.mutate(raw, drift.sentinel);
      } finally {
        raw.close();
      }
      const before = fileIntegrityState(fixture.filename);
      let unexpectedOpen = null;
      try {
        assert.throws(
          () => {
            unexpectedOpen = new ProjectDatabase(fixture.filename, { autoBackup: false });
          },
          (error) => {
            const violations = error?.details?.typedCanonicalViolations;
            return error instanceof ProjectDatabaseSchemaInvalidError
              && /typed canonical JSON 不变量校验失败/.test(error.message)
              && Array.isArray(violations)
              && violations.length === 1
              && violations[0].table === (drift.label.startsWith('canvas-')
                ? 'canvas_documents'
                : 'subflow_definitions')
              && violations[0].column === drift.expectedColumn
              && violations[0].invalidCount === 1
              && !JSON.stringify(error.details).includes(drift.sentinel);
          },
        );
      } finally {
        await unexpectedOpen?.close();
      }
      assert.equal(fs.existsSync(fixture.generationFilename), false);
      assert.deepEqual(fileIntegrityState(fixture.filename), before);
      const verify = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
      try {
        assert.equal(drift.read(verify), drift.sentinel);
        assert.equal(verify.pragma('quick_check', { simple: true }), 'ok');
      } finally {
        verify.close();
      }
    } finally {
      cleanup(fixture.directory);
    }
  }
});

test('B2 typed canonical preflight does not recursively interpret arbitrary node.data entityUid metadata', async () => {
  const fixture = temporaryProject('t8-b2-current-typed-metadata-negative-control-');
  const sentinel = 'business-metadata-not-an-identity';
  try {
    const database = new ProjectDatabase(fixture.filename, { autoBackup: false });
    try {
      database.ensureCanvas('b2-typed-metadata-canvas', {
        nodes: [{
          id: 'b2-typed-metadata-node',
          type: 'text',
          position: { x: 0, y: 0 },
          data: { entityUid: sentinel, nested: { entityUid: sentinel } },
        }],
        edges: [],
      }, 'b2-typed-metadata-project');
    } finally {
      await database.close();
    }
    const reopened = new ProjectDatabase(fixture.filename, { autoBackup: false });
    try {
      const data = reopened.getCanvas('b2-typed-metadata-canvas').nodes[0].data;
      assert.equal(data.entityUid, sentinel);
      assert.equal(data.nested.entityUid, sentinel);
      const identity = reopened.db.prepare(`
        SELECT database_uuid, recovery_generation, write_sequence
        FROM project_database_identity
        WHERE singleton_id = 1
      `).get();
      assert.equal(reopened.recoveryGenerationState.version, 3);
      assert.equal(reopened.recoveryGenerationState.databaseUuid, identity.database_uuid);
      assert.equal(reopened.recoveryGenerationState.generation, identity.recovery_generation);
      assert.equal(
        reopened.recoveryGenerationState.acknowledgedWriteSequence,
        Number(identity.write_sequence),
      );
      assert.equal(reopened.db.pragma('quick_check', { simple: true }), 'ok');
    } finally {
      await reopened.close();
    }
  } finally {
    cleanup(fixture.directory);
  }
});

test('B2 recovery candidates with table, index, or trigger drift are rejected by the same fingerprint', async () => {
  const primary = new ProjectDatabase(':memory:', { autoBackup: false });
  const directories = [];
  try {
    for (const drift of SCHEMA_DRIFTS) {
      const fixture = temporaryProject(`t8-b2-bad-backup-${drift.label}-`);
      directories.push(fixture.directory);
      await createLatestDatabase(fixture.filename);
      applySchemaDrift(fixture.filename, drift);
      const candidateBefore = fileSha256(fixture.filename);

      assert.throws(
        () => primary.validateRecoveryCandidate(fixture.filename),
        (error) => assertSchemaDriftFailure(error, /^recovery-candidate$/),
      );

      assert.equal(fileSha256(fixture.filename), candidateBefore);
      const verify = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
      try {
        assert.equal(drift.remains(verify), true, `${drift.label} backup was modified during validation`);
      } finally {
        verify.close();
      }
    }
  } finally {
    await primary.close();
    for (const directory of directories) cleanup(directory);
  }
});

test('B2 legacy constraint rebuild rejects unknown non-CHECK column semantics', async () => {
  const fixture = temporaryProject('t8-b2-legacy-unknown-column-semantics-');
  let unexpectedOpen = null;
  try {
    seedSanitizedCoreSchema22(fixture.filename, {
      summaryColumnSql: 'summary TEXT COLLATE NOCASE NOT NULL',
    });
    let migrationReached = false;
    assert.throws(
      () => {
        unexpectedOpen = new ProjectDatabase(fixture.filename, {
          autoBackup: false,
          beforeMigrationTransaction: () => { migrationReached = true; },
        });
      },
      (error) => error instanceof ProjectDatabaseSchemaInvalidError
        && /未知的非 CHECK 语义/.test(error.message)
        && !JSON.stringify(error.details).includes('NOCASE'),
    );
    assert.equal(migrationReached, false);
    const verify = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
    try {
      assert.equal(
        verify.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
        22,
      );
      const tableSql = verify.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'canvas_patch_applications'
      `).get()?.sql;
      assert.match(String(tableSql || ''), /summary\s+TEXT\s+COLLATE\s+NOCASE/i);
    } finally {
      verify.close();
    }
  } finally {
    await unexpectedOpen?.close();
    cleanup(fixture.directory);
  }
});

test('B2 sanitized core schema22 weak constraints rebuild atomically with rows, foreign keys, indexes, and triggers intact', async () => {
  const fixture = temporaryProject('t8-b2-sanitized-core-schema22-');
  try {
    seedSanitizedCoreSchema22(fixture.filename);

    let unexpectedOpen = null;
    try {
      assert.throws(() => {
        unexpectedOpen = new ProjectDatabase(fixture.filename, {
          autoBackup: false,
          beforeMigrationCommit: (_database, version) => {
            if (version === PROJECT_DATABASE_SCHEMA_VERSION) {
              throw new Error('sanitized-schema22-injected-failure');
            }
          },
        });
      }, /sanitized-schema22-injected-failure/);
    } finally {
      await unexpectedOpen?.close();
    }

    const rolledBack = new BetterSqlite3(fixture.filename, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(
        rolledBack.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
          .map((row) => row.version),
        Array.from({ length: PROJECT_DATABASE_SCHEMA_VERSION - 1 }, (_, index) => index + 1),
      );
      assert.equal(
        rolledBack.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
          .get(PROJECT_DATABASE_SCHEMA_VERSION).count,
        0,
      );
      assert.equal(
        readSchema29OwnedObjects(rolledBack).length,
        PROJECT_DATABASE_SCHEMA_29_OWNED_OBJECT_NAMES.length,
      );
      assert.equal(
        readSchema30OwnedObjects(rolledBack).length,
        PROJECT_DATABASE_SCHEMA_30_OWNED_OBJECT_NAMES.length,
      );
      assert.equal(rolledBack.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migration_receipts'
      `).get().count, 1);
      assert.equal(rolledBack.prepare(`
        SELECT COUNT(*) AS count FROM schema_migration_receipts WHERE version = 29
      `).get().count, 1);
      assert.equal(rolledBack.prepare('SELECT COUNT(*) AS count FROM canvas_patch_applications').get().count, 1);
      assert.equal(rolledBack.prepare('SELECT COUNT(*) AS count FROM asset_semantic_models').get().count, 1);
      assert.equal(rolledBack.prepare('SELECT caption_model_key FROM asset_semantic_profiles').get().caption_model_key, 'sanitized-caption-model');
      const patchSql = rolledBack.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'canvas_patch_applications'").get().sql;
      const modelSql = rolledBack.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asset_semantic_models'").get().sql;
      assert.match(patchSql, /CHECK\s*\(\s*length\s*\(\s*request_digest/i);
      assert.match(modelSql, /CHECK\s*\(\s*download_idempotency_key\s+IS\s+NULL/i);
      assert.deepEqual(rolledBack.pragma('foreign_key_check'), []);
      assert.equal(rolledBack.pragma('quick_check', { simple: true }), 'ok');
    } finally {
      rolledBack.close();
    }

    const migrated = new ProjectDatabase(fixture.filename, { autoBackup: false });
    try {
      assert.equal(
        migrated.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
        PROJECT_DATABASE_SCHEMA_VERSION,
      );
      assert.deepEqual(migrated.db.prepare(`
        SELECT patch_id, request_digest, operation_count, guard_version, status
        FROM canvas_patch_applications
      `).get(), {
        patch_id: 'sanitized-schema22-patch',
        request_digest: 'a'.repeat(64),
        operation_count: 1,
        guard_version: 0,
        status: 'applied',
      });
      assert.deepEqual(migrated.db.prepare(`
        SELECT model_key, model_version, capability, status, revision,
               download_idempotency_key, download_request_revision
        FROM asset_semantic_models
      `).get(), {
        model_key: 'sanitized-caption-model',
        model_version: 'v22',
        capability: 'caption',
        status: 'downloading',
        revision: 3,
        download_idempotency_key: 'sanitized-download-request',
        download_request_revision: 3,
      });
      assert.equal(
        migrated.db.prepare('SELECT caption_model_key FROM asset_semantic_profiles').get().caption_model_key,
        'sanitized-caption-model',
      );
      assert.throws(
        () => migrated.db.prepare('UPDATE canvas_patch_applications SET operation_count = 0').run(),
        /CHECK constraint failed/,
      );
      assert.throws(
        () => migrated.db.prepare('UPDATE asset_semantic_models SET download_request_revision = NULL').run(),
        /CHECK constraint failed/,
      );
      assert.throws(
        () => migrated.db.prepare("UPDATE asset_semantic_models SET model_key = 'changed'").run(),
        /asset_semantic_models identity is immutable/,
      );
      assert.throws(
        () => migrated.db.prepare("UPDATE canvas_patch_applications SET project_id = 'wrong-project'").run(),
        /canvas_patch_applications project mismatch/,
      );
      assert.deepEqual(migrated.db.pragma('foreign_key_check'), []);
      assert.equal(migrated.db.pragma('quick_check', { simple: true }), 'ok');
    } finally {
      await migrated.close();
    }

    const reopened = new ProjectDatabase(fixture.filename, { autoBackup: false });
    try {
      assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM canvas_patch_applications').get().count, 1);
      assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM asset_semantic_models').get().count, 1);
      assert.deepEqual(reopened.db.pragma('foreign_key_check'), []);
    } finally {
      await reopened.close();
    }
  } finally {
    cleanup(fixture.directory);
  }
});

test('B2 legacy constraint migration takes an IMMEDIATE lock, revalidates under lock, and restores pragmas', () => {
  for (const mode of ['success', 'concurrent-column']) {
    const fixture = temporaryProject(`t8-b2-constraint-lock-${mode}-`);
    const sentinelColumn = 'sensitive_toctou_column';
    const sentinelDefault = 'sensitive_toctou_default';
    let primary = null;
    let concurrent = null;
    try {
      seedSanitizedCoreSchema22(fixture.filename);
      primary = new BetterSqlite3(fixture.filename);
      primary.pragma('foreign_keys = ON');
      primary.pragma('legacy_alter_table = OFF');
      const harness = Object.create(ProjectDatabase.prototype);
      harness.db = primary;
      harness.filename = fixture.filename;
      harness.backupFilename = null;
      harness.preMigration23BackupFilename = null;
      harness.preMigrationBackupFilename = null;
      harness.preMigration30BackupFilename = null;
      harness.preMigration31BackupFilename = path.join(
        fixture.directory,
        `schema30-before-schema31-${mode}.sqlite3`,
      );
      harness.recoveryGenerationFilename = null;
      harness.options = mode === 'concurrent-column'
        ? {
          beforeMigrationTransaction(database, context) {
            assert.equal(database.pragma('foreign_keys', { simple: true }), 0);
            assert.equal(database.pragma('legacy_alter_table', { simple: true }), 1);
            assert.equal(context.schemaVersion, 22);
            assert.equal(context.legacyConstraintRebuildCount, 2);
            concurrent = new BetterSqlite3(fixture.filename);
            try {
              concurrent.exec(`
                ALTER TABLE canvas_patch_applications
                ADD COLUMN ${sentinelColumn} TEXT DEFAULT '${sentinelDefault}'
              `);
            } finally {
              concurrent.close();
              concurrent = null;
            }
          },
        }
        : {};

      if (mode === 'success') {
        ProjectDatabase.prototype._migrateLegacyBridgeTo28.call(harness);
        assert.equal(
          primary.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
          28,
        );
        assert.equal(
          primary.pragma("table_xinfo('canvas_patch_applications')")
            .some((column) => column.name === sentinelColumn),
          false,
        );
        assert.throws(
          () => primary.prepare('UPDATE canvas_patch_applications SET operation_count = 0').run(),
          /CHECK constraint failed/,
        );
      } else {
        assert.throws(
          () => ProjectDatabase.prototype._migrateLegacyBridgeTo28.call(harness),
          (error) => error instanceof ProjectDatabaseSchemaInvalidError
            && /约束表列结构无法安全重建/.test(error.message)
            && !JSON.stringify(error.details).includes(sentinelColumn)
            && !JSON.stringify(error.details).includes(sentinelDefault),
        );
        assert.equal(
          primary.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
          22,
        );
        assert.equal(
          primary.pragma("table_xinfo('canvas_patch_applications')")
            .some((column) => column.name === sentinelColumn),
          true,
          'the concurrently committed sentinel must survive the failed migration',
        );
        const tableSql = primary.prepare(`
          SELECT sql FROM sqlite_master
          WHERE type = 'table' AND name = 'canvas_patch_applications'
        `).get().sql;
        assert.match(tableSql, new RegExp(sentinelDefault));
        assert.doesNotMatch(tableSql, /CHECK\s*\(\s*length\s*\(\s*request_digest/i);
      }
      assert.equal(primary.pragma('foreign_keys', { simple: true }), 1);
      assert.equal(primary.pragma('legacy_alter_table', { simple: true }), 0);
      assert.equal(primary.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(primary.pragma('foreign_key_check'), []);
    } finally {
      try { concurrent?.close(); } catch (_) {}
      try { primary?.close(); } catch (_) {}
      cleanup(fixture.directory);
    }
  }
});
