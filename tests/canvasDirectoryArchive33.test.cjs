const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const BetterSqlite3 = require('better-sqlite3');
const { ProjectDatabase, PROJECT_DATABASE_SCHEMA_VERSION } = require('../backend/src/services/projectDatabase');
const { projectDatabaseLogicalContentDigest32 } = require('../backend/src/services/projectDatabaseLogicalDigest32');
const { mapCanvasMutationError } = require('../backend/src/services/canvasPatch');
const { createDataStorage } = require('../electron/dataStorage.cjs');
function seed(database, id = 'archive-test') {
  database.ensureCanvas(id, { name: `Canvas ${id}`, nodes: [{ id: 'text-a', type: 'text', data: { text: 'keep me' }, position: { x: 0, y: 0 } }], edges: [] });
  return database.getCanvasDirectoryEntry(id);
}
function request(item) { return { projectId: item.projectId, catalogRevision: item.catalogRevision, baseRevision: item.revision, operationId: crypto.randomUUID() }; }
function code(expected) { return (error) => error.code === expected; }
function memory(t) { const database = new ProjectDatabase(':memory:', { autoBackup: false }); t.after(() => database.close()); return database; }
test('schema33 is a formal additive migration without changing the frozen schema32 identity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-archive33-'));
  let database;
  try {
    const filename = path.join(directory, 'project.sqlite3');
    database = new ProjectDatabase(filename, { autoBackup: false });
    assert.equal(PROJECT_DATABASE_SCHEMA_VERSION, 33);
    assert.equal(database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 33);
    assert.equal(database.db.prepare('SELECT schema_version FROM project_database_identity').get().schema_version, 32);
    database.ensureCanvas('archive-canvas', { name: 'Archive', nodes: [], edges: [] });
    const catalog = database.db.prepare('SELECT * FROM canvas_directory WHERE canvas_id=?').get('archive-canvas');
    assert.equal(catalog.status, 'active');
    assert.equal(catalog.catalog_revision, 1);
    const backup = await database.createBackup();
    assert.equal(backup.schemaVersion, 33);
    assert.equal(backup.canonicalVerification.verified, true);
    await database.close(); database = null;
    database = new ProjectDatabase(filename, { autoBackup: false });
    assert.equal(database.db.prepare('SELECT status FROM canvas_directory WHERE canvas_id=?').get('archive-canvas').status, 'active');
  } finally {
    if (database) await database.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('archive/restore only change canonical directory metadata, preserving content, IDs and history', (t) => {
  const database = memory(t), item = seed(database), before = database.getCanvas(item.id);
  const history = database.listCanvasSnapshots(item.id);
  const first = database.transitionCanvasArchive(item.id, 'archive', request(item));
  assert.equal(first.item.status, 'archived'); assert.equal(first.item.catalogRevision, 2);
  assert.deepEqual(database.getCanvas(item.id), before);
  assert.deepEqual(database.listCanvasSnapshots(item.id), history);
  assert.equal(database.listCanvasDirectoryPage().items.length, 0);
  assert.equal(database.listCanvasDirectoryPage(undefined, { status: 'archived' }).items[0].id, item.id);
  const restored = database.transitionCanvasArchive(item.id, 'restore', request(first.item));
  assert.equal(restored.item.catalogRevision, 3); assert.equal(restored.item.status, 'active'); assert.equal(restored.item.archivedAt, null);
  assert.deepEqual(database.getCanvas(item.id), before);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM runs').get().n, 0);
});

test('archive CAS, operation replay and project ownership fail closed without changing content', (t) => {
  const database = memory(t), item = seed(database), input = request(item);
  assert.throws(() => database.transitionCanvasArchive(item.id, 'archive', { ...input, projectId: 'another-project' }), code('canvas_project_mismatch'));
  assert.throws(() => database.transitionCanvasArchive(item.id, 'archive', { ...input, baseRevision: item.revision + 1 }), code('canvas_revision_conflict'));
  const first = database.transitionCanvasArchive(item.id, 'archive', input);
  const document = database.getCanvas(item.id);
  const replay = database.transitionCanvasArchive(item.id, 'archive', input);
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.item, first.item);
  assert.throws(() => database.transitionCanvasArchive(item.id, 'restore', input), code('canvas_archive_operation_conflict'));
  assert.throws(() => database.transitionCanvasArchive(item.id, 'restore', request(item)), code('canvas_catalog_revision_conflict'));
  assert.equal(database.getCanvasDirectoryEntry(item.id).status, 'archived');
  assert.deepEqual(database.getCanvas(item.id), document);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM canvas_directory_operations').get().n, 1);
  database.deleteCanvas(item.id);
  assert.throws(() => database.transitionCanvasArchive(item.id, 'archive', input), code('canvas_not_found'));
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM canvas_directory_operations').get().n, 1);
});

test('archived snapshots, ordinary operations, new Runs and new intents are rejected by production writers', (t) => {
  const database = memory(t), item = seed(database), before = database.getCanvas(item.id);
  database.transitionCanvasArchive(item.id, 'archive', request(item));
  assert.throws(() => database.saveCanvasSnapshot(item.id, { ...before, name: 'overwritten' }), code('canvas_archived_read_only'));
  assert.throws(() => database.applyOperations(item.id, [{ opId: crypto.randomUUID(), type: 'node.move', payload: { nodeId: 'text-a', position: { x: 12, y: 34 } } }]), /canvas_archived_read_only/);
  assert.throws(() => database.createRun({ id: 'new-run', projectId: item.projectId, canvasId: item.id, canvasRevision: item.revision, status: 'running' }), code('canvas_archived_read_only'));
  assert.throws(() => database.createRunIntent({ projectId: item.projectId, canvasId: item.id, canvasRevision: item.revision, nodeIds: ['text-a'], idempotencyKey: 'new-intent', requestedBy: 'local-owner' }), code('canvas_archived_read_only'));
  assert.deepEqual(database.getCanvas(item.id), before);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM runs').get().n, 0);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM run_intents').get().n, 0);
  assert.equal(mapCanvasMutationError(new Error('canvas_archived_read_only')).status, 409);
  assert.throws(() => database._transitionCanvasArchive(item.id, 'restore', request(database.getCanvasDirectoryEntry(item.id))), code('project_database_mutation_transaction_required'));
});

test('queued/running/ambiguous Run or pending confirmation blocks archive, terminal stopped Run does not', (t) => {
  const database = memory(t), item = seed(database);
  const run = database.createRun({ id: 'busy-run', projectId: item.projectId, canvasId: item.id, canvasRevision: item.revision, status: 'running' });
  for (const status of ['running','queued','submission_unknown']) {
    database.updateRun(run.id, { status });
    assert.throws(() => database.transitionCanvasArchive(item.id, 'archive', request(item)), code('canvas_archive_busy'));
  }
  database.updateRun(run.id, { status: 'stopped' });
  const intent = database.createRunIntent({ projectId: item.projectId, canvasId: item.id, canvasRevision: item.revision, nodeIds: ['text-a'], idempotencyKey: 'pending-intent', requestedBy: 'local-owner', confirmationRequired: true });
  assert.throws(() => database.transitionCanvasArchive(item.id, 'archive', request(item)), code('canvas_archive_busy'));
  database.updateRunIntent(intent.id, { status: 'cancelled' });
  assert.equal(database.transitionCanvasArchive(item.id, 'archive', request(item)).item.status, 'archived');
  assert.equal(database.getRun(run.id).status, 'stopped');
});

test('pin/opened preferences do not dirty shared content or modification time', (t) => {
  const database = memory(t), item = seed(database), before = database.getCanvas(item.id);
  const updated = database.updateCanvasDirectoryProfile(item.id, { pinned: true, opened: true });
  assert.equal(updated.pinned, true); assert.ok(updated.openedAt > 0);
  assert.equal(updated.updatedAt, item.updatedAt); assert.equal(updated.catalogRevision, item.catalogRevision);
  assert.deepEqual(database.getCanvas(item.id), before);
  assert.throws(() => database.updateCanvasDirectoryProfile(item.id, { pinned: 'true' }), code('canvas_profile_invalid'));
  assert.throws(() => database.updateCanvasDirectoryProfile(item.id, { opened: 'true' }), code('canvas_profile_invalid'));
  assert.throws(() => database.updateCanvasDirectoryProfile(item.id, { status: 'archived' }), code('canvas_profile_invalid'));
});

test('lightweight keyset pages are bounded, deduplicated, ordered and bound to filter scope', (t) => {
  const database = memory(t);
  for (let index = 0; index < 115; index++) seed(database, `catalog-${String(index).padStart(3,'0')}`);
  database.updateCanvasDirectoryProfile('catalog-001', { pinned: true });
  const first = database.listCanvasDirectoryPage();
  assert.equal(first.items.length, 50); assert.equal(first.items[0].id, 'catalog-001'); assert.equal(first.total, 115);
  const second = database.listCanvasDirectoryPage(undefined, { cursor: first.nextCursor });
  const third = database.listCanvasDirectoryPage(undefined, { cursor: second.nextCursor });
  assert.equal(new Set([...first.items,...second.items,...third.items].map((item) => item.id)).size, 115);
  assert.equal(third.hasMore, false); assert.equal(third.items.length, 15);
  assert.throws(() => database.listCanvasDirectoryPage(undefined, { cursor: first.nextCursor, status: 'archived' }), code('canvas_list_cursor_invalid'));
  assert.throws(() => database.listCanvasDirectoryPage(undefined, { cursor: first.nextCursor, sort: 'opened' }), code('canvas_list_cursor_invalid'));
  assert.throws(() => database.listCanvasDirectoryPage(undefined, { cursor: first.nextCursor, query: 'last' }), code('canvas_list_cursor_invalid'));
  assert.throws(() => database.listCanvasDirectoryPage(undefined, { limit: 201 }), code('canvas_list_query_invalid'));
  assert.equal(database.listCanvasDirectoryPage(undefined, { query: 'CATALOG-114' }).items[0].id, 'catalog-114');
  assert.equal(database.listCanvasDirectoryPage(undefined, { query: 'nonmatching' }).items.length, 0);
  assert.equal(Object.hasOwn(first.items[0], 'nodes'), false);
});

for (const phase of ['after-ddl','after-backfill']) test(`schema33 ${phase} failure rolls back to verified schema32 and can resume`, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-archive33-fault-'));
  const filename = path.join(directory,'project.sqlite3'); let database;
  try {
    assert.throws(() => new ProjectDatabase(filename, { autoBackup: false, beforeExecutableMigrationPhase(sqlite, checkpoint) {
      if (checkpoint.version === 33 && checkpoint.phase === phase) throw new Error(`controlled-${phase}`);
    } }), new RegExp(`controlled-${phase}`));
    const probe = new BetterSqlite3(filename, { readonly: true });
    try {
      assert.equal(probe.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, 32);
      assert.equal(probe.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='canvas_directory'").get().n, 0);
      assert.equal(probe.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(probe.pragma('foreign_key_check'), []);
    } finally { probe.close(); }
    assert.ok(fs.readdirSync(directory).some((name) => name.startsWith('.schema32-before33-')));
    database = new ProjectDatabase(filename, { autoBackup: false });
    assert.equal(database.db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, 33);
    assert.equal(seed(database).status, 'active');
  } finally { if (database) await database.close(); assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('schema33 canonical backup seals archive, profile and operation receipts and detects alteration', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'t8-archive33-backup-')); let database;
  try {
    const filename = path.join(directory,'project.sqlite3'); database = new ProjectDatabase(filename, { autoBackup: false });
    const item = seed(database), archived = database.transitionCanvasArchive(item.id,'archive',request(item));
    database.updateCanvasDirectoryProfile(item.id,{ pinned: true, opened: true });
    const backup = await database.createBackup();
    assert.equal(backup.canonicalVerification.verified,true);
    const candidate = database.backupFilename;
    assert.equal(database.validateRecoveryCandidate(candidate).canonicalVerification.verified,true);
    await database.close(); database = new ProjectDatabase(filename, { autoBackup: false });
    const reopened = database.getCanvasDirectoryEntry(item.id);
    assert.equal(reopened.status,'archived'); assert.equal(reopened.pinned,true); assert.equal(reopened.catalogRevision,archived.item.catalogRevision);
    const tampered = new BetterSqlite3(candidate);
    try { tampered.prepare("UPDATE canvas_directory SET status='active',archived_at=NULL,catalog_revision=catalog_revision+1 WHERE canvas_id=?").run(item.id); } finally { tampered.close(); }
    assert.throws(() => database.validateRecoveryCandidate(candidate));
  } finally { if (database) await database.close(); assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)); fs.rmSync(directory,{ recursive:true,force:true }); }
});

test('offline data-path migration preserves canonical archive, local profile and operation receipts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-archive33-storage-'));
  const source = path.join(directory, 'source'), parent = path.join(directory, 'target');
  fs.mkdirSync(path.join(source, 'data'), { recursive: true }); fs.mkdirSync(parent);
  let database;
  try {
    const filename = path.join(source, 'data', 'project.sqlite3');
    database = new ProjectDatabase(filename, { autoBackup: false });
    const item = seed(database), input = request(item);
    const archived = database.transitionCanvasArchive(item.id, 'archive', input);
    const original = database.getCanvas(item.id);
    database.updateCanvasDirectoryProfile(item.id, { pinned: true, opened: true });
    await database.createBackup(); await database.close(); database = null;
    const bytes = fs.readFileSync(filename), ack = fs.readFileSync(`${filename}.recovery-generation.json`);
    const storage = createDataStorage(source), destination = storage.schedule(parent);
    await storage.migrate(); storage.assertAvailable();
    assert.equal(storage.root(), destination);
    const migrated = path.join(destination, 'data', 'project.sqlite3');
    assert.deepEqual(fs.readFileSync(migrated), bytes);
    assert.deepEqual(fs.readFileSync(`${migrated}.recovery-generation.json`), ack);
    assert.deepEqual(fs.readFileSync(filename), bytes); // Source retained.
    database = new ProjectDatabase(migrated, { autoBackup: false });
    const restoredEntry = database.getCanvasDirectoryEntry(item.id);
    assert.equal(restoredEntry.status, 'archived'); assert.equal(restoredEntry.pinned, true);
    assert.equal(restoredEntry.catalogRevision, archived.item.catalogRevision);
    assert.deepEqual(database.getCanvas(item.id), original);
    assert.equal(database.transitionCanvasArchive(item.id, 'archive', input).duplicate, true);
    assert.equal(database.validateRecoveryCandidate(database.backupFilename).canonicalVerification.verified, true);
  } finally {
    if (database) await database.close();
    assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the frozen v3.2.4 program rejects a schema33 archive database without modifying the primary or acknowledged watermark', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-archive33-downgrade-'));
  const filename = path.join(directory, 'project.sqlite3');
  let database;
  try {
    database = new ProjectDatabase(filename, { autoBackup: false });
    const item = seed(database);
    database.transitionCanvasArchive(item.id, 'archive', request(item));
    await database.close(); database = null;
    const protectedFiles = [filename, `${filename}.recovery-generation.json`];
    const before = protectedFiles.map((file) => ({ file, bytes: fs.readFileSync(file), modified: fs.statSync(file).mtimeMs }));
    const sourceFilename = path.resolve(__dirname, '../backend/src/services/projectDatabase.js');
    const source = execFileSync('git', ['show', 'ecbb4312a55c1bf386f8850c0170117a3b037012:backend/src/services/projectDatabase.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const old = new Module(`${sourceFilename}#frozen-v3.2.4`, module);
    old.filename = sourceFilename; old.paths = Module._nodeModulePaths(path.dirname(sourceFilename)); old._compile(source, sourceFilename);
    assert.equal(old.exports.PROJECT_DATABASE_SCHEMA_VERSION, 32);
    assert.throws(() => new old.exports.ProjectDatabase(filename, { autoBackup: false }), (error) => error.code === 'project_database_schema_too_new' && error.foundVersion === 33 && error.supportedVersion === 32);
    for (const prior of before) {
      assert.deepEqual(fs.readFileSync(prior.file), prior.bytes);
      assert.equal(fs.statSync(prior.file).mtimeMs, prior.modified);
    }
  } finally {
    if (database) await database.close();
    assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
