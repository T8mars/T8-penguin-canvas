'use strict';
const { createHash } = require('node:crypto');

// Additive extension: the frozen v32 identity/freshness/receipt protocol is not
// rewritten. v33 has its own exact DDL manifest and migration receipt; the v32
// canonical logical digest includes these tables and therefore seals archives.
const CREATE_SQL = `
CREATE TABLE canvas_directory (
  canvas_id TEXT PRIMARY KEY NOT NULL REFERENCES canvas_documents(canvas_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  archived_at INTEGER,
  catalog_revision INTEGER NOT NULL DEFAULT 1 CHECK(catalog_revision >= 1),
  name TEXT NOT NULL,
  node_count INTEGER NOT NULL CHECK(node_count >= 0),
  content_revision INTEGER NOT NULL CHECK(content_revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at > 0))
) STRICT;
CREATE INDEX idx_canvas_directory_page ON canvas_directory(project_id, status, updated_at DESC, canvas_id ASC);
CREATE TABLE canvas_directory_profile (
  profile_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL REFERENCES canvas_directory(canvas_id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  opened_at INTEGER NOT NULL DEFAULT 0 CHECK(opened_at >= 0),
  PRIMARY KEY(profile_id,canvas_id)
) STRICT;
CREATE INDEX idx_canvas_directory_profile_opened ON canvas_directory_profile(profile_id, opened_at DESC, canvas_id ASC);
CREATE TABLE canvas_directory_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE canvas_directory_hydration_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK(singleton_id=1),
  status TEXT NOT NULL CHECK(status IN ('pending','ready')),
  completed_at INTEGER
) STRICT;
INSERT INTO canvas_directory_hydration_state(singleton_id,status) VALUES(1,'pending');
CREATE TRIGGER trg_canvas_directory_insert AFTER INSERT ON canvas_documents BEGIN
  INSERT INTO canvas_directory(canvas_id,project_id,name,node_count,content_revision,created_at,updated_at)
  VALUES(NEW.canvas_id,NEW.project_id,COALESCE(NULLIF(json_extract(NEW.snapshot_json,'$.name'),''),NULLIF(json_extract(NEW.snapshot_json,'$.title'),''),NEW.canvas_id),
    COALESCE(json_array_length(NEW.snapshot_json,'$.nodes'),0),NEW.revision,NEW.created_at,NEW.updated_at);
END;
CREATE TRIGGER trg_canvas_directory_sync AFTER UPDATE ON canvas_documents BEGIN
  UPDATE canvas_directory SET name=COALESCE(NULLIF(json_extract(NEW.snapshot_json,'$.name'),''),NULLIF(json_extract(NEW.snapshot_json,'$.title'),''),NEW.canvas_id),
    node_count=COALESCE(json_array_length(NEW.snapshot_json,'$.nodes'),0),content_revision=NEW.revision,updated_at=NEW.updated_at
  WHERE canvas_id=NEW.canvas_id;
END;
CREATE TRIGGER trg_canvas_directory_document_write_guard BEFORE UPDATE ON canvas_documents
WHEN EXISTS(SELECT 1 FROM canvas_directory WHERE canvas_id=OLD.canvas_id AND status='archived')
BEGIN SELECT RAISE(ABORT,'canvas_archived_read_only'); END;
CREATE TRIGGER trg_canvas_directory_run_guard BEFORE INSERT ON runs
WHEN EXISTS(SELECT 1 FROM canvas_directory WHERE canvas_id=NEW.canvas_id AND status='archived')
BEGIN SELECT RAISE(ABORT,'canvas_archived_read_only'); END;
CREATE TRIGGER trg_canvas_directory_intent_guard BEFORE INSERT ON run_intents
WHEN EXISTS(SELECT 1 FROM canvas_directory WHERE canvas_id=NEW.canvas_id AND status='archived')
BEGIN SELECT RAISE(ABORT,'canvas_archived_read_only'); END;
CREATE TRIGGER trg_canvas_directory_identity_guard BEFORE UPDATE ON canvas_directory
WHEN NEW.canvas_id != OLD.canvas_id OR NEW.project_id != OLD.project_id
  OR (NEW.status = OLD.status AND NEW.catalog_revision != OLD.catalog_revision)
  OR (NEW.status != OLD.status AND NEW.catalog_revision != OLD.catalog_revision + 1)
BEGIN SELECT RAISE(ABORT,'canvas_directory_identity_invalid'); END;
CREATE TRIGGER trg_canvas_directory_operation_update_guard BEFORE UPDATE ON canvas_directory_operations
BEGIN SELECT RAISE(ABORT,'canvas_directory_operation_immutable'); END;
CREATE TRIGGER trg_canvas_directory_operation_delete_guard BEFORE DELETE ON canvas_directory_operations
BEGIN SELECT RAISE(ABORT,'canvas_directory_operation_immutable'); END;
`;
const OWNED_NAMES = Object.freeze([
  'canvas_directory','idx_canvas_directory_page','canvas_directory_profile','idx_canvas_directory_profile_opened','canvas_directory_operations','canvas_directory_hydration_state',
  'trg_canvas_directory_insert','trg_canvas_directory_sync','trg_canvas_directory_document_write_guard','trg_canvas_directory_run_guard',
  'trg_canvas_directory_intent_guard','trg_canvas_directory_identity_guard','trg_canvas_directory_operation_update_guard','trg_canvas_directory_operation_delete_guard',
]);
const definition = Object.freeze({ version: 33, fromVersion: 32, name: 'canonical-canvas-directory-and-archive', mode: 'executable',
  downPolicy: 'backup-only', checksum: createHash('sha256').update(JSON.stringify({ version: 33, fromVersion: 32, CREATE_SQL, OWNED_NAMES,
    backfill: 'all-canonical-documents-active-v1', protocol: 'retain-frozen-v32-identity-and-canonical-logical-seal-v1' })).digest('hex') });
module.exports = { PROJECT_DATABASE_MIGRATION_33: definition, PROJECT_DATABASE_MIGRATION_33_CREATE_SQL: CREATE_SQL, PROJECT_DATABASE_SCHEMA_33_OWNED_OBJECT_NAMES: OWNED_NAMES };
