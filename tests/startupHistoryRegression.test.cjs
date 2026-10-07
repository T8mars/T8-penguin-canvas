'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const Module = require('node:module');
const { Worker } = require('node:worker_threads');
const parser = require('@babel/parser');
const { spawn } = require('node:child_process');
const BetterSqlite3 = require('better-sqlite3');
const { ProjectDatabase, ProjectDatabaseSchemaInvalidError } = require('../backend/src/services/projectDatabase');
const storagePolicy = require('./helpers/startupStoragePolicy32.cjs');
const options = { autoBackup: false, projectDatabaseStoragePolicy32: storagePolicy };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-startup-history-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    // Electron virtualizes .asar as a directory; cleanup the actual temporary
    // archive via native fs instead of descending into its virtual contents.
    const nativeFs = process.versions.electron ? require('original-fs') : fs;
    nativeFs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return path.join(root, 'project.sqlite3');
}
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function encryptedWorkerFixture(directory) {
  const file = path.join(directory, 'project.sqlite3');
  const resources = path.join(directory, 'resources');
  const loaderDirectory = path.join(directory, 'app-staging', 'electron');
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(loaderDirectory, { recursive: true });
  const root = path.resolve(__dirname, '..');
  fs.copyFileSync(path.join(root, 'electron/loader.cjs'), path.join(loaderDirectory, 'loader.cjs'));
  await require('@electron/asar').createPackage(path.dirname(loaderDirectory), path.join(resources, 'app.asar'));
  const source = fs.readFileSync(path.join(root, 'backend/src/services/projectDatabase.js'), 'utf8');
  const node = parser.parse(source, { sourceType: 'script' }).program.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'runProjectDatabaseBackupCandidateTask');
  const encryptedFile = path.join(directory, 'fixture.t8c');
  const bytenode = require('bytenode');
  const loader = require('../electron/loader.cjs');
  const stub = `module.exports.processProjectDatabaseBackupCandidate = (task, filename) => {
    const Sqlite = require('better-sqlite3');
    const db = new Sqlite(filename, { readonly: true, fileMustExist: true });
    try { return { task, value: db.prepare('SELECT value FROM fixture').get().value }; }
    finally { db.close(); }
  };`;
  fs.writeFileSync(encryptedFile, loader.encryptBuffer(bytenode.compileCode(Module.wrap(stub))));
  const raw = new BetterSqlite3(file);
  raw.exec('CREATE TABLE fixture(value INTEGER); INSERT INTO fixture VALUES(42)'); raw.close();
  const run = vm.runInNewContext(`(${source.slice(node.start, node.end)})`, {
    Worker, path, __filename: encryptedFile, process: { resourcesPath: resources }, ProjectDatabaseSchemaInvalidError,
  });
  return run('validate', file);
}

// Electron's native ASAR cache holds the archive for the process lifetime on
// Windows. Verify in an owned child, await its exit, then clean in the parent.
if (process.argv[2] === '--encrypted-worker-fixture') {
  encryptedWorkerFixture(process.argv[3]).then(
    (result) => { console.log(JSON.stringify(result)); },
    (error) => { console.error(error); process.exitCode = 1; },
  );
  return;
}
test('production worker bootstrap loads encrypted T8 bytecode and native SQLite, then waits for worker exit', async (t) => {
  const directory = path.dirname(fixture(t));
  const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.resolve(__dirname, '../node_modules') };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--encrypted-worker-fixture', directory], { env: childEnv, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout = `${stdout}${data}`.slice(-4096); });
    child.stderr.on('data', (data) => { stderr = `${stderr}${data}`.slice(-4096); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`Encrypted worker fixture failed (${code}): ${stderr}`));
      try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
    });
  });
  assert.equal(result.task, 'validate'); assert.equal(result.value, 42);
});

test('production evidence cache rejects uncommitted/rolled-back state, external commits and schema changes', (t) => {
  const file = fixture(t), database = new BetterSqlite3(file), other = new BetterSqlite3(file);
  const source = fs.readFileSync(path.resolve(__dirname, '../backend/src/services/projectDatabase.js'), 'utf8');
  const declarations = parser.parse(source, { sourceType: 'script' }).program.body.filter((node) => (
    node.type === 'VariableDeclaration' && node.declarations.some((entry) => entry.id.name === 'projectDatabaseValidationScopes')
  ) || (node.type === 'FunctionDeclaration' && ['withProjectDatabaseValidationScope', 'projectDatabaseValidationEvidence'].includes(node.id.name)));
  const helpers = vm.runInNewContext(`${declarations.map((node) => source.slice(node.start, node.end)).join('\n')}
    ({ scope: withProjectDatabaseValidationScope, evidence: projectDatabaseValidationEvidence });`);
  let inspections = 0;
  const inspect = () => { inspections++; return database.prepare('SELECT value FROM fixture').get().value; };
  const read = () => helpers.evidence(database, 'fixture', inspect);
  try {
    database.exec('CREATE TABLE fixture(value INTEGER); INSERT INTO fixture VALUES(1)');
    helpers.scope(database, () => {
      assert.equal(read(), 1); assert.equal(read(), 1); assert.equal(inspections, 1);
      database.exec('BEGIN; UPDATE fixture SET value=2');
      assert.equal(read(), 2); assert.equal(read(), 2); assert.equal(inspections, 3, 'transaction evidence is never cached');
      database.exec('ROLLBACK; BEGIN');
      assert.equal(read(), 1); assert.equal(inspections, 4, 'same total_changes/transaction flag cannot resurrect rollback evidence');
      database.exec('COMMIT');
      assert.equal(read(), 1); assert.equal(inspections, 5);
      other.exec('UPDATE fixture SET value=3');
      assert.equal(read(), 3); assert.equal(inspections, 6);
      database.exec('CREATE TABLE extra(value INTEGER)');
      assert.equal(read(), 3); assert.equal(inspections, 7);
    });
    helpers.scope(database, () => { assert.equal(read(), 3); assert.equal(inspections, 8, 'scope evidence does not persist'); });
  } finally { database.close(); other.close(); }
});

test('clean cold startup reads the typed history once, while all integrity checks remain active', async (t) => {
  const file = fixture(t);
  const seed = new ProjectDatabase(file, options);
  seed.ensureCanvas('history-a', { nodes: [], edges: [] });
  await seed.close();
  let reads = 0;
  const original = BetterSqlite3.prototype.prepare;
  BetterSqlite3.prototype.prepare = function (sql) {
    if (/SELECT canvas_id, project_id, schema_version, revision, snapshot_json, updated_at\s+FROM canvas_documents/.test(sql)) reads++;
    return original.call(this, sql);
  };
  let database;
  try { database = new ProjectDatabase(file, options); }
  finally { BetterSqlite3.prototype.prepare = original; }
  try {
    assert.equal(database.startupUsedCleanActiveFastPath, true);
    assert.equal(reads, 1, 'repeated schema layers must not reparse the same full history');
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
    assert.equal(database.getCanvas('history-a').revision, 1);
  } finally { await database?.close(); }
});

test('verification evidence expires on writes and never survives a reopen', async (t) => {
  const file = fixture(t);
  const seed = new ProjectDatabase(file, options);
  seed.ensureCanvas('history-a', { nodes: [], edges: [] });
  await seed.close();
  const database = new ProjectDatabase(file, options);
  const configure = database.configure;
  try {
    const document = database.getCanvas('history-a');
    database.configure = function () {
      configure.call(this);
      // Change data between active-initialize and migrate-fast-path in the
      // SAME production verification scope, not merely between cold opens.
      this.db.prepare('UPDATE canvas_documents SET snapshot_json=? WHERE canvas_id=?')
        .run(JSON.stringify({ ...document, canvasId: 'wrong-identity' }), 'history-a');
    };
    assert.throws(() => database.initializeDatabase(), (error) => error instanceof ProjectDatabaseSchemaInvalidError
      && error.details.typedCanonicalViolations.some((row) => row.column === 'snapshot_json.canvasId'));
  } finally { database.configure = configure; await database.close(); }
  assert.throws(() => new ProjectDatabase(file, options), (error) => error instanceof ProjectDatabaseSchemaInvalidError);
});

test('private backup seal and verification run off-thread, leave the event loop responsive and retain the canonical receipt', async (t) => {
  const file = fixture(t), database = new ProjectDatabase(file, options);
  const original = ProjectDatabase.prototype.validateRecoveryCandidate;
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    database.ensureCanvas('history-a', { name: 'Kept', nodes: [], edges: [] });
    // The real production backup must not call the heavy validator on main.
    ProjectDatabase.prototype.validateRecoveryCandidate = () => { throw new Error('main-thread backup validator called'); };
    const backup = database.createBackup();
    const closing = database.close();
    assert.equal(database.db.open, true, 'close must wait for the queued backup and both workers');
    const result = await backup;
    await closing;
    assert.equal(database.db.open, false);
    assert.equal(database.projectDatabaseOwner, null);
    assert.ok(ticks >= 5, 'main timers must run while workers load, seal and verify');
    assert.equal(result.canonicalSeal.sealed, true);
    assert.equal(result.canonicalVerification.verified, true);
    assert.equal(result.canonicalSeal.logicalContentDigest, result.canonicalVerification.logicalContentDigest);
    const checked = original.call(database, `${file}.backup`);
    assert.equal(checked.schemaVersion, 33);
    assert.equal(checked.canonicalVerification.verified, true);
  } finally {
    clearInterval(timer);
    ProjectDatabase.prototype.validateRecoveryCandidate = original;
    await database.close();
  }
});

test('candidate corruption after sealing fails closed without replacing the previous backup', async (t) => {
  const file = fixture(t), database = new ProjectDatabase(file, options);
  try {
    database.ensureCanvas('history-a', { name: 'Kept', nodes: [], edges: [] });
    await database.createBackup();
    const before = hash(`${file}.backup`);
    database.options.beforeDatabaseBackupValidation = ({ candidateFilename }) => {
      const raw = new BetterSqlite3(candidateFilename);
      try { raw.prepare("UPDATE canvas_documents SET snapshot_json=json_set(snapshot_json,'$.canvasId','damaged')").run(); }
      finally { raw.close(); }
    };
    await assert.rejects(database.createBackup(), (error) => error instanceof ProjectDatabaseSchemaInvalidError);
    await assert.rejects(database.waitForBackup(), (error) => error instanceof ProjectDatabaseSchemaInvalidError);
    assert.equal(hash(`${file}.backup`), before);
    assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.includes('.owned-')), false);
    database.options.beforeDatabaseBackupValidation = ({ candidateFilename }) => {
      const raw = new BetterSqlite3(candidateFilename);
      try { raw.prepare("UPDATE canvas_documents SET snapshot_json=json_set(snapshot_json,'$.name','tampered')").run(); }
      finally { raw.close(); }
    };
    await assert.rejects(database.createBackup(), (error) => error.code === 'project_database_canonical_backup_32_invalid'
      && error.details.reason === 'receipt-digest-mismatch');
    assert.equal(hash(`${file}.backup`), before);
  } finally {
    delete database.options.beforeDatabaseBackupValidation;
    await database.close();
  }
});

test('legacy-name recovery fills only absent metadata and preserves revision, content, timestamps and archives', async () => {
  const database = new ProjectDatabase(':memory:', options);
  try {
    const original = database.ensureCanvas('missing-name', { nodes: [], edges: [] });
    const before = database.getCanvasDirectoryEntry(original.canvasId);
    const archived = database.transitionCanvasArchive(original.canvasId, 'archive', {
      catalogRevision: before.catalogRevision, baseRevision: original.revision, operationId: crypto.randomUUID(),
    }).item;
    assert.equal(database.updateCanvasCatalogMetadata(original.canvasId, { name: '旧目录的中文名称', recoverMissingLegacyName: true }), null);
    assert.deepEqual(database.getCanvasDirectoryEntry(original.canvasId), archived);
    const restored = database.transitionCanvasArchive(original.canvasId, 'restore', {
      catalogRevision: archived.catalogRevision, operationId: crypto.randomUUID(),
    }).item;
    database.updateCanvasCatalogMetadata(original.canvasId, { name: '旧目录的中文名称', recoverMissingLegacyName: true });
    const repaired = database.getCanvas(original.canvasId), directory = database.getCanvasDirectoryEntry(original.canvasId);
    assert.equal(repaired.name, '旧目录的中文名称');
    assert.equal(repaired.updatedAt, original.updatedAt);
    assert.equal(repaired.revision, original.revision);
    assert.deepEqual(repaired.nodes, original.nodes);
    assert.equal(directory.status, 'active');
    assert.equal(directory.catalogRevision, restored.catalogRevision);
    assert.equal(database.listCanvasDirectoryPage(undefined, { query: '中文名称' }).items.length, 1);
    database.updateCanvasCatalogMetadata(original.canvasId, { name: 'stale name', recoverMissingLegacyName: true });
    assert.equal(database.getCanvas(original.canvasId).name, repaired.name);
    for (const input of [{ name: 'named' }, { title: 'title kept' }, { name: 'deliberate-id' }]) {
      const id = input.name === 'deliberate-id' ? 'deliberate-id' : crypto.randomUUID();
      database.ensureCanvas(id, { ...input, nodes: [], edges: [] });
      assert.equal(database.updateCanvasCatalogMetadata(id, { name: 'stale', recoverMissingLegacyName: true }), null);
      assert.equal(database.getCanvasDirectoryEntry(id).name, input.name || input.title);
    }
  } finally { await database.close(); }
});
