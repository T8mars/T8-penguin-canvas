const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ProjectDatabase,
  ProjectDatabaseSchemaInvalidError,
} = require('../backend/src/services/projectDatabase');
const fixtureOptions = { autoBackup: false, projectDatabaseStoragePolicy32: require('./helpers/startupStoragePolicy32.cjs') };

function temporaryProject(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    directory,
    filename: path.join(directory, 'project.sqlite3'),
  };
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function waitForLaterTimestamp(value) {
  let now = Date.now();
  while (now <= value) now = Date.now();
  return now;
}

function seedCanvas(database, canvasId) {
  database.ensureCanvas(canvasId, {
    name: 'Before Rename',
    nodes: [{
      id: `${canvasId}-node`,
      type: 'text',
      position: { x: 0, y: 0 },
      data: { prompt: 'catalog metadata canonical recovery' },
    }],
    edges: [],
  }, 'catalog-metadata-project');
}

function writeLegacyCatalogMetadataDrift(database, canvasId, options = {}) {
  return database.withProjectDatabaseWrite('canvas.catalog-metadata.update', () => {
    const row = database.db.prepare(`
      SELECT canvas_id, project_id, revision, snapshot_json, updated_at
      FROM canvas_documents WHERE canvas_id = ?
    `).get(canvasId);
    const snapshot = JSON.parse(row.snapshot_json);
    const updatedAt = waitForLaterTimestamp(Number(row.updated_at));
    const nextSnapshot = {
      ...snapshot,
      name: 'Legacy Renamed Canvas',
      nodeCount: options.invalidNodeCount === true
        ? snapshot.nodes.length + 1
        : snapshot.nodes.length,
      // Deliberately preserve the old JSON updatedAt to reproduce the
      // v2.9.2-v2.9.6 catalog metadata writer defect.
    };
    database.db.prepare(`
      UPDATE canvas_documents
      SET snapshot_json = ?, updated_at = ?
      WHERE canvas_id = ? AND project_id = ? AND revision = ?
    `).run(
      JSON.stringify(nextSnapshot),
      updatedAt,
      row.canvas_id,
      row.project_id,
      row.revision,
    );
    return { previousUpdatedAt: snapshot.updatedAt, updatedAt };
  });
}

test('canvas catalog rename persists canonical updatedAt and survives a cold reopen', async () => {
  const fixture = temporaryProject('t8-canvas-catalog-canonical-write-');
  let database = null;
  let reopened = null;
  try {
    database = new ProjectDatabase(fixture.filename, fixtureOptions);
    seedCanvas(database, 'catalog-canonical-write');
    const before = database.getCanvas('catalog-canonical-write');
    waitForLaterTimestamp(before.updatedAt);

    const renamed = database.updateCanvasCatalogMetadata('catalog-canonical-write', {
      name: 'Canonical Rename',
    });
    const row = database.db.prepare(`
      SELECT snapshot_json, updated_at
      FROM canvas_documents WHERE canvas_id = ?
    `).get('catalog-canonical-write');
    const snapshot = JSON.parse(row.snapshot_json);
    assert.equal(snapshot.name, 'Canonical Rename');
    assert.equal(snapshot.nodeCount, snapshot.nodes.length);
    assert.equal(snapshot.updatedAt, row.updated_at);
    assert.equal(renamed.updatedAt, row.updated_at);

    await database.close();
    database = null;
    reopened = new ProjectDatabase(fixture.filename, fixtureOptions);
    const persisted = reopened.getCanvas('catalog-canonical-write');
    assert.equal(persisted.name, 'Canonical Rename');
    assert.equal(persisted.updatedAt, row.updated_at);
  } finally {
    await database?.close();
    await reopened?.close();
    cleanup(fixture.directory);
  }
});

test('known v2.9.2-v2.9.6 catalog timestamp drift reopens read-only without rewriting stored JSON', async () => {
  const fixture = temporaryProject('t8-canvas-catalog-legacy-recovery-');
  let database = null;
  let reopened = null;
  try {
    database = new ProjectDatabase(fixture.filename, fixtureOptions);
    seedCanvas(database, 'catalog-legacy-recovery');
    const drift = writeLegacyCatalogMetadataDrift(database, 'catalog-legacy-recovery');
    await database.close();
    database = null;

    reopened = new ProjectDatabase(fixture.filename, fixtureOptions);
    const recovered = reopened.getCanvas('catalog-legacy-recovery');
    assert.equal(recovered.name, 'Legacy Renamed Canvas');
    assert.equal(recovered.updatedAt, drift.updatedAt);
    const persisted = JSON.parse(reopened.db.prepare(`
      SELECT snapshot_json FROM canvas_documents WHERE canvas_id = ?
    `).get('catalog-legacy-recovery').snapshot_json);
    assert.equal(
      persisted.updatedAt,
      drift.previousUpdatedAt,
      'startup compatibility must not silently rewrite the user database',
    );
  } finally {
    await database?.close();
    await reopened?.close();
    cleanup(fixture.directory);
  }
});

test('non-matching catalog timestamp corruption still fails closed', async () => {
  const fixture = temporaryProject('t8-canvas-catalog-invalid-drift-');
  let database = null;
  let unexpectedOpen = null;
  try {
    database = new ProjectDatabase(fixture.filename, fixtureOptions);
    seedCanvas(database, 'catalog-invalid-drift');
    writeLegacyCatalogMetadataDrift(database, 'catalog-invalid-drift', {
      invalidNodeCount: true,
    });
    await database.close();
    database = null;

    assert.throws(
      () => {
        unexpectedOpen = new ProjectDatabase(fixture.filename, fixtureOptions);
      },
      (error) => error instanceof ProjectDatabaseSchemaInvalidError
        && error.code === 'project_database_schema_invalid'
        && Array.isArray(error.details?.typedCanonicalViolations)
        && error.details.typedCanonicalViolations.some((violation) => (
          violation.table === 'canvas_documents'
          && violation.column === 'snapshot_json.updatedAt'
          && violation.invalidCount === 1
        )),
    );
  } finally {
    await database?.close();
    await unexpectedOpen?.close();
    cleanup(fixture.directory);
  }
});
