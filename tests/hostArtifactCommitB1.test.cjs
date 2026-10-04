const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
const { AssetIndexer } = require('../backend/src/services/assetIndexer');
const {
  COMMON_OPERATION_BATCH_CONTRACT,
} = require('../backend/src/collaboration/commonOperationProtocol');
const {
  stableEntityUuid,
} = require('../backend/src/collaboration/protocol');
const {
  OperationBatchConflictError,
  ProjectDatabase,
  PROJECT_DATABASE_MIGRATIONS,
  PROJECT_DATABASE_SCHEMA_VERSION,
  RevisionConflictError,
} = require('../backend/src/services/projectDatabase');
const {
  assertCurrentProjectDatabaseRegistry,
  removeSchema31ExtensionForSyntheticSchema30,
  removeSchema32SyntheticFixtureArtifacts,
} = require('./helpers/projectDatabaseVersion.cjs');
const {
  PROJECT_DATABASE_MIGRATION_29_DOWN_SQL,
} = require('../backend/src/services/projectDatabaseMigration29');
const {
  PROJECT_DATABASE_MIGRATION_30_DOWN_SQL,
} = require('../backend/src/services/projectDatabaseMigration30');

const PROJECT_ID = 'project-host-artifact-b1';
const CANVAS_ID = 'canvas-host-artifact-b1';
const NODE_DISPLAY_ID = 'generator-display-id';
const NODE_UID = 'a1000000-0000-4000-8000-000000000001';
const HOST_IDENTITY = Object.freeze({ actorId: 'host-executor', sessionId: 'host-authority' });

function createFixture(database, suffix = '') {
  const document = database.ensureCanvas(CANVAS_ID + suffix, {
    projectId: PROJECT_ID + suffix,
    nodes: [{
      id: NODE_DISPLAY_ID,
      entityUid: NODE_UID,
      entityRevision: 1,
      type: 'text',
      position: { x: 0, y: 0 },
      data: { prompt: 'authoritative output' },
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }, PROJECT_ID + suffix);
  const run = database.createRun({
    id: `run-display${suffix}`,
    projectId: PROJECT_ID + suffix,
    canvasId: CANVAS_ID + suffix,
    canvasRevision: document.revision,
    initiatorId: 'owner-a',
    status: 'running',
  });
  const nodeRun = database.createNodeRun({
    id: `node-run-display${suffix}`,
    runId: run.id,
    nodeId: NODE_DISPLAY_ID,
    originalNodeId: NODE_DISPLAY_ID,
    status: 'running',
    inputSnapshot: {
      node: {
        id: NODE_DISPLAY_ID,
        entityUid: NODE_UID,
        type: 'text',
        data: { prompt: 'authoritative output' },
      },
      upstreamNodes: [],
      incomingEdges: [],
    },
  });
  const attempt = database.createAttempt({
    id: `attempt-display${suffix}`,
    nodeRunId: nodeRun.id,
    provider: 'host-local',
    model: 'host-model',
    status: 'running',
  });
  return { document, run, nodeRun, attempt };
}

function artifactIdentity(attempt, ordinal) {
  return stableEntityUuid('t8-host-artifact-v1', attempt.entityUid, ordinal);
}

function blobIdentity(contentHash) {
  return stableEntityUuid('t8-asset-blob-v1', 'sha256', contentHash);
}

function operationIdentity(attempt, ordinal) {
  return stableEntityUuid('t8-host-artifact-operation-v1', attempt.entityUid, ordinal);
}

function clientIdentity(fixture) {
  return stableEntityUuid(
    't8-host-artifact-client-v1',
    fixture.run.entityUid,
    fixture.nodeRun.entityUid,
    fixture.attempt.entityUid,
  );
}

function batchIdentity(fixture, ordinals) {
  return stableEntityUuid(
    't8-host-artifact-batch-v1',
    fixture.run.entityUid,
    fixture.nodeRun.entityUid,
    fixture.attempt.entityUid,
    ordinals.join(','),
  );
}

function makeArtifact(fixture, ordinal, overrides = {}) {
  const contentHash = overrides.contentHash || String(ordinal + 1).repeat(64);
  const artifactUid = artifactIdentity(fixture.attempt, ordinal);
  return {
    opId: operationIdentity(fixture.attempt, ordinal),
    artifactUid,
    blobUid: blobIdentity(contentHash),
    contentHash,
    byteSize: overrides.byteSize ?? (ordinal + 1) * 12,
    kind: overrides.kind || 'image',
    filename: overrides.filename || `result-${ordinal}.png`,
    mimeType: overrides.mimeType || 'image/png',
    storageKey: overrides.storageKey || `sha256/${contentHash.slice(0, 2)}/${contentHash.slice(2, 4)}/${contentHash}`,
    managedPath: overrides.managedPath || path.join('C:\\host-private-cas', contentHash),
    sourceUrl: overrides.sourceUrl || `/api/project-assets/run-output-${artifactUid}/media`,
    metadata: overrides.metadata || { size: overrides.byteSize ?? (ordinal + 1) * 12, health: 'ok' },
    outputOrdinal: ordinal,
  };
}

function makeBatch(fixture, artifacts, overrides = {}) {
  const ordinals = artifacts.map((artifact) => artifact.outputOrdinal);
  return {
    contractVersion: COMMON_OPERATION_BATCH_CONTRACT,
    projectId: fixture.run.projectId,
    canvasId: fixture.run.canvasId,
    baseRevision: fixture.document.revision,
    batchId: batchIdentity(fixture, ordinals),
    clientId: clientIdentity(fixture),
    clientSeq: Math.min(...ordinals),
    operations: artifacts.map((artifact, index) => ({
      opId: artifact.opId,
      type: 'host.artifact.commit',
      payload: {
        artifactUid: artifact.artifactUid,
        blobUid: artifact.blobUid,
        runUid: fixture.run.entityUid,
        nodeRunUid: fixture.nodeRun.entityUid,
        attemptUid: fixture.attempt.entityUid,
        nodeUid: NODE_UID,
        expectedCanvasRevision: fixture.document.revision,
        expectedRunRevision: fixture.run.revision + index,
        expectedNodeRunRevision: fixture.nodeRun.revision + index,
        expectedAttemptRevision: fixture.attempt.revision + index,
        outputOrdinal: artifact.outputOrdinal,
        kind: artifact.kind,
        contentHash: artifact.contentHash,
        byteSize: artifact.byteSize,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
      },
    })),
    ...overrides,
  };
}

function applyArtifacts(database, fixture, artifacts, batchOverrides = {}, optionOverrides = {}) {
  const batch = makeBatch(fixture, artifacts, batchOverrides);
  return database.applyCommonHostArtifactBatch(batch, {
    hostIdentity: HOST_IDENTITY,
    verifiedArtifacts: artifacts,
    ...optionOverrides,
  });
}

test('archived canvas accepts only original verified host results and remains read-only after late commit', (t) => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  t.after(() => database.close());
  const fixture = createFixture(database, '-archived');
  fixture.run = database.updateRun(fixture.run.id, { status: 'succeeded' });
  fixture.nodeRun = database.updateNodeRun(fixture.nodeRun.id, { status: 'succeeded' });
  fixture.attempt = database.updateAttempt(fixture.attempt.id, { status: 'succeeded' });
  const item = database.getCanvasDirectoryEntry(fixture.document.canvasId);
  const archived = database.transitionCanvasArchive(item.id, 'archive', {
    catalogRevision: item.catalogRevision, baseRevision: item.revision, operationId: crypto.randomUUID(), projectId: item.projectId,
  });
  const artifact = makeArtifact(fixture, 0);
  assert.throws(() => applyArtifacts(database, fixture, [artifact], {}, { hostIdentity: { actorId: 'client', sessionId: 'forged' } }), /权威身份/);
  const wrong = makeBatch(fixture, [artifact]); wrong.operations[0].payload.nodeUid = crypto.randomUUID();
  assert.throws(() => database.applyCommonHostArtifactBatch(wrong, { hostIdentity: HOST_IDENTITY, verifiedArtifacts: [artifact] }));
  const committed = applyArtifacts(database, fixture, [artifact]);
  assert.ok(committed);
  assert.equal(database.getCanvasDirectoryEntry(item.id).status, 'archived');
  assert.equal(database.getCanvasDirectoryEntry(item.id).catalogRevision, archived.item.catalogRevision);
  // Results belong to the immutable Run ledger, not an ordinary canvas edit.
  assert.equal(database.getCanvas(item.id).revision, fixture.document.revision);
  assert.equal(database.getNodeRun(fixture.nodeRun.id).outputRefs.length, 1);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM run_output_commits').get().n, 1);
  assert.throws(() => database.saveCanvasSnapshot(item.id, database.getCanvas(item.id)), /归档|canvas_archived_read_only/);
  const replay = applyArtifacts(database, fixture, [artifact]);
  assert.equal(replay.duplicate, true);
});

function tableCount(database, table) {
  return Number(database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function listCasFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.cas-'))
    .map((entry) => entry.name)
    .sort();
}

async function waitForCondition(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('NodeRun source UID is bound to the exact Run canvas snapshot and migration never guesses across display-id ABA', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-node-identity-'));
  const filename = path.join(directory, 'projects.sqlite3');
  const replacementUid = 'b1000000-0000-4000-8000-000000000001';
  try {
    const first = new ProjectDatabase(filename, { autoBackup: false });
    let run;
    let nodeRun;
    try {
      const document = first.ensureCanvas(CANVAS_ID, {
        projectId: PROJECT_ID,
        nodes: [{
          id: NODE_DISPLAY_ID,
          entityUid: NODE_UID,
          entityRevision: 1,
          type: 'text',
          position: { x: 0, y: 0 },
          data: { prompt: 'original entity' },
        }],
        edges: [],
      }, PROJECT_ID);
      run = first.createRun({
        id: 'run-node-identity',
        projectId: PROJECT_ID,
        canvasId: CANVAS_ID,
        canvasRevision: document.revision,
        status: 'succeeded',
      });
      first.saveCanvasSnapshot(CANVAS_ID, {
        ...document,
        nodes: [{
          id: NODE_DISPLAY_ID,
          entityUid: replacementUid,
          entityRevision: 2,
          type: 'text',
          position: { x: 0, y: 0 },
          data: { prompt: 'replacement entity' },
        }],
      }, { expectedRevision: document.revision });
      nodeRun = first.createNodeRun({
        id: 'node-run-node-identity',
        runId: run.id,
        nodeId: NODE_DISPLAY_ID,
        status: 'succeeded',
      });
      assert.equal(first.getCanvas(CANVAS_ID).nodes[0].entityUid, replacementUid);
      assert.equal(nodeRun.nodeEntityUid, NODE_UID);
      first.db.prepare('UPDATE node_runs SET node_entity_uid = NULL WHERE id = ?').run(nodeRun.id);
      removeSchema31ExtensionForSyntheticSchema30(first.db);
      first.db.prepare('DELETE FROM schema_migration_receipts WHERE version = 30').run();
      first.db.prepare('DELETE FROM schema_migrations WHERE version = 30').run();
      first.db.exec(PROJECT_DATABASE_MIGRATION_30_DOWN_SQL);
      first.db.exec(PROJECT_DATABASE_MIGRATION_29_DOWN_SQL);
      first.db.prepare('DELETE FROM schema_migrations WHERE version = 29').run();
      assert.deepEqual(first.db.pragma('foreign_key_check'), []);
      first.db.prepare('DELETE FROM schema_migrations WHERE version >= 26').run();
    } finally {
      await first.close();
    }

    removeSchema32SyntheticFixtureArtifacts(filename);
    const migrated = new ProjectDatabase(filename, {
      autoBackup: false,
      preMigrationBackupFilename: path.join(directory, 'reopen-pre-migration-v28.sqlite3'),
      preMigration30BackupFilename: path.join(directory, 'reopen-pre-migration-v29.sqlite3'),
      preMigration31BackupFilename: path.join(directory, 'reopen-pre-migration-v30.sqlite3'),
      preMigration32BackupFilename: path.join(directory, 'reopen-pre-migration-v31.sqlite3'),
    });
    try {
      assert.equal(migrated.getNodeRun(nodeRun.id).nodeEntityUid, NODE_UID);
      assert.notEqual(migrated.getNodeRun(nodeRun.id).nodeEntityUid, replacementUid);
      assert.equal(
        migrated.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
        PROJECT_DATABASE_SCHEMA_VERSION,
      );
      assert.equal(migrated.db.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(migrated.db.pragma('foreign_key_check'), []);
    } finally {
      await migrated.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('latest schema preserves schema 26 stable run/blob/lineage identities, revisions, exact output slots, and zero-byte CAS', () => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    assertCurrentProjectDatabaseRegistry(PROJECT_DATABASE_SCHEMA_VERSION, PROJECT_DATABASE_MIGRATIONS);
    const fixture = createFixture(database);
    assert.equal(fixture.run.revision, 1);
    assert.equal(fixture.nodeRun.revision, 1);
    assert.equal(fixture.nodeRun.nodeEntityUid, NODE_UID);
    assert.equal(fixture.attempt.revision, 1);
    assert.equal(database.getRunByEntityUid(fixture.run.entityUid).id, fixture.run.id);
    assert.equal(database.getNodeRunByEntityUid(fixture.nodeRun.entityUid).id, fixture.nodeRun.id);
    assert.equal(database.getAttemptByEntityUid(fixture.attempt.entityUid).id, fixture.attempt.id);

    const emptyHash = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const blob = database.markAssetBlobStored({
      contentHash: emptyHash,
      byteSize: 0,
      mimeType: 'text/plain',
      storageKey: `sha256/${emptyHash.slice(0, 2)}/${emptyHash.slice(2, 4)}/${emptyHash}`,
      verifiedAt: 123,
    });
    assert.equal(blob.entityUid, blobIdentity(emptyHash));
    assert.equal(blob.byteSize, 0);
    assert.equal(database.getAssetBlobByEntityUid(blob.entityUid).contentHash, emptyHash);

    const commitColumns = new Set(database.db.pragma('table_info(run_output_commits)').map((row) => row.name));
    for (const column of [
      'op_id', 'batch_id', 'run_entity_uid', 'node_run_entity_uid', 'attempt_entity_uid',
      'node_entity_uid', 'output_ordinal', 'asset_entity_uid', 'blob_entity_uid',
      'run_revision_before', 'run_revision_after', 'content_hash', 'source_descriptor_digest',
    ]) assert.equal(commitColumns.has(column), true, column);
    const reservationColumns = new Set(database.db.pragma('table_info(run_output_slot_reservations)').map((row) => row.name));
    assert.equal(reservationColumns.has('source_descriptor_digest'), true);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});

test('two host artifacts commit in one IMMEDIATE transaction and exact replay survives restart without advancing canvas', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-db-'));
  const filename = path.join(directory, 'projects.sqlite3');
  try {
    const first = new ProjectDatabase(filename, { autoBackup: false });
    let fixture;
    let artifacts;
    let batch;
    try {
      fixture = createFixture(first);
      artifacts = [makeArtifact(fixture, 0), makeArtifact(fixture, 1)];
      batch = makeBatch(fixture, artifacts);
      const applied = first.applyCommonHostArtifactBatch(batch, {
        hostIdentity: HOST_IDENTITY,
        verifiedArtifacts: artifacts,
      });
      assert.equal(applied.duplicate, false);
      assert.equal(applied.document.revision, 1);
      assert.deepEqual(applied.results.map((result) => result.outputOrdinal), [0, 1]);
      assert.deepEqual(applied.results.map((result) => result.runRevision), [2, 3]);
      assert.equal(first.getRun(fixture.run.id).revision, 3);
      assert.equal(first.getNodeRun(fixture.nodeRun.id).revision, 3);
      assert.equal(first.getAttempt(fixture.attempt.id).revision, 3);
      assert.deepEqual(first.getNodeRun(fixture.nodeRun.id).outputRefs, applied.results.map((result) => result.assetId));
      assert.equal(tableCount(first, 'run_output_commits'), 2);
      assert.equal(first.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE type='node.output'").get().count, 2);
      assert.equal(tableCount(first, 'asset_lineage_events'), 2);
      assert.equal(tableCount(first, 'collaboration_common_operation_batches'), 1);
      assert.equal(tableCount(first, 'collaboration_domain_operation_idempotency'), 2);
      assert.equal(first.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='host.artifact.commit'").get().count, 2);
      const audits = first.db.prepare(`
        SELECT actor_id, session_id, metadata_json
        FROM audit_events WHERE action='host.artifact.commit' ORDER BY id
      `).all();
      assert.equal(audits.every((row) => row.actor_id === 'host-executor' && row.session_id === 'host-authority'), true);
      assert.equal(audits.some((row) => /host-private-cas|[A-Z]:\\/i.test(row.metadata_json)), false);
      const publicRows = first.db.prepare(`
        SELECT * FROM run_output_commits ORDER BY output_ordinal
      `).all();
      assert.equal(publicRows.some((row) => /host-private-cas|[A-Z]:\\/i.test(JSON.stringify(row))), false);
      const retainedAssetId = applied.results[0].assetId;
      assert.throws(
        () => first.removeAssetIndex(retainedAssetId),
        (error) => error?.code === 'asset_delete_retained_run_output',
      );
      assert.ok(first.getAsset(retainedAssetId));
    } finally {
      first.close();
    }

    const reopened = new ProjectDatabase(filename, { autoBackup: false });
    try {
      const replay = reopened.applyCommonHostArtifactBatch(batch, {
        hostIdentity: HOST_IDENTITY,
        verifiedArtifacts: artifacts,
      });
      assert.equal(replay.duplicate, true);
      assert.equal(replay.document.revision, 1);
      assert.equal(tableCount(reopened, 'run_output_commits'), 2);
      assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE type='node.output'").get().count, 2);
      assert.equal(tableCount(reopened, 'asset_lineage_events'), 2);
      assert.equal(tableCount(reopened, 'audit_events'), 2);
      assert.equal(reopened.db.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(reopened.db.pragma('foreign_key_check'), []);
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fresh host commit uses the live canvas revision while exact replay preserves the Run snapshot boundary', () => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const fixture = createFixture(database, '-revision-boundary');
    assert.equal(fixture.document.revision, 1);
    assert.equal(fixture.run.canvasRevision, 1);

    const revision2 = database.saveCanvasSnapshot(fixture.document.canvasId, {
      ...fixture.document,
      viewport: { x: 10, y: 20, zoom: 1 },
    }, {
      expectedRevision: 1,
      actorId: 'owner-a',
      sessionId: 'revision-boundary-r2',
    });
    assert.equal(revision2.revision, 2);
    fixture.document = revision2;

    const artifact = makeArtifact(fixture, 0);
    const batch = makeBatch(fixture, [artifact]);
    const fresh = database.applyCommonHostArtifactBatch(batch, {
      hostIdentity: HOST_IDENTITY,
      verifiedArtifacts: [artifact],
    });
    assert.equal(fresh.duplicate, false);
    assert.equal(fresh.document.revision, 2);
    const commit = database.getRunOutputCommitBySlot(fixture.attempt.entityUid, 0);
    assert.equal(commit.canvasRevision, 2);
    assert.equal(database.getRun(fixture.run.id).canvasRevision, 1);

    const revision3 = database.saveCanvasSnapshot(fixture.document.canvasId, {
      ...revision2,
      viewport: { x: 30, y: 40, zoom: 1 },
    }, {
      expectedRevision: 2,
      actorId: 'owner-a',
      sessionId: 'revision-boundary-r3',
    });
    assert.equal(revision3.revision, 3);

    const beforeReplay = {
      commits: tableCount(database, 'run_output_commits'),
      events: tableCount(database, 'run_events'),
      audits: tableCount(database, 'audit_events'),
      idempotency: tableCount(database, 'collaboration_domain_operation_idempotency'),
      commonBatches: tableCount(database, 'collaboration_common_operation_batches'),
      runRevision: database.getRun(fixture.run.id).revision,
      nodeRunRevision: database.getNodeRun(fixture.nodeRun.id).revision,
      attemptRevision: database.getAttempt(fixture.attempt.id).revision,
      outputRefs: database.getNodeRun(fixture.nodeRun.id).outputRefs,
    };
    const replay = database.applyCommonHostArtifactBatch(batch, {
      hostIdentity: HOST_IDENTITY,
      verifiedArtifacts: [artifact],
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.document.revision, 3);
    assert.deepEqual({
      commits: tableCount(database, 'run_output_commits'),
      events: tableCount(database, 'run_events'),
      audits: tableCount(database, 'audit_events'),
      idempotency: tableCount(database, 'collaboration_domain_operation_idempotency'),
      commonBatches: tableCount(database, 'collaboration_common_operation_batches'),
      runRevision: database.getRun(fixture.run.id).revision,
      nodeRunRevision: database.getNodeRun(fixture.nodeRun.id).revision,
      attemptRevision: database.getAttempt(fixture.attempt.id).revision,
      outputRefs: database.getNodeRun(fixture.nodeRun.id).outputRefs,
    }, beforeReplay);
    assert.equal(database.getRunOutputCommitBySlot(fixture.attempt.entityUid, 0).canvasRevision, 2);
    assert.equal(database.getRun(fixture.run.id).canvasRevision, 1);

    const tampered = database.db.prepare('UPDATE runs SET canvas_revision = ? WHERE id = ?').run(
      3,
      fixture.run.id,
    );
    assert.equal(tampered.changes, 1);
    assert.throws(() => database.applyCommonHostArtifactBatch(batch, {
      hostIdentity: HOST_IDENTITY,
      verifiedArtifacts: [artifact],
    }), (error) => error?.code === 'host_artifact_replay_inconsistent' && error?.status === 409);
    assert.equal(tableCount(database, 'run_output_commits'), beforeReplay.commits);
    assert.equal(tableCount(database, 'run_events'), beforeReplay.events);
    assert.equal(tableCount(database, 'audit_events'), beforeReplay.audits);
  } finally {
    database.close();
  }
});

test('host artifact collisions, stale revisions, cross-scope identities, slot ABA, and second-item faults fail closed', () => {
  const faulted = new ProjectDatabase(':memory:', {
    autoBackup: false,
    beforeHostArtifactOperation: ({ operationIndex }) => {
      if (operationIndex === 1) throw new Error('host-artifact-second-item-fault');
    },
  });
  try {
    const fixture = createFixture(faulted, '-fault');
    const artifacts = [makeArtifact(fixture, 0), makeArtifact(fixture, 1)];
    assert.throws(() => applyArtifacts(faulted, fixture, artifacts), /second-item-fault/);
    for (const table of [
      'assets', 'asset_blob_refs', 'run_output_commits', 'run_output_slot_reservations', 'run_events',
      'asset_lineage_events', 'collaboration_common_operation_batches',
      'collaboration_domain_operation_idempotency', 'collaboration_operation_identities',
      'audit_events',
    ]) assert.equal(tableCount(faulted, table), 0, table);
    assert.equal(faulted.getRun(fixture.run.id).revision, 1);
    assert.equal(faulted.getNodeRun(fixture.nodeRun.id).revision, 1);
    assert.equal(faulted.getAttempt(fixture.attempt.id).revision, 1);
  } finally {
    faulted.close();
  }

  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const fixture = createFixture(database);
    const original = makeArtifact(fixture, 0);
    assert.throws(() => database.applyCommonHostArtifactBatch(makeBatch(fixture, [original]), {
      hostIdentity: { actorId: 'forged-member', sessionId: 'forged-session' },
      verifiedArtifacts: [original],
    }), (error) => error?.code === 'host_artifact_identity_invalid' && error?.status === 403);
    assert.equal(tableCount(database, 'run_output_commits'), 0);
    const stale = makeBatch(fixture, [original], { baseRevision: 2 });
    stale.operations[0].payload.expectedCanvasRevision = 2;
    assert.throws(() => database.applyCommonHostArtifactBatch(stale, {
      hostIdentity: HOST_IDENTITY,
      verifiedArtifacts: [original],
    }), (error) => error instanceof RevisionConflictError || error instanceof OperationBatchConflictError);
    assert.equal(tableCount(database, 'run_output_commits'), 0);

    const applied = applyArtifacts(database, fixture, [original]);
    assert.equal(applied.duplicate, false);
    const mutated = makeArtifact(fixture, 0, {
      contentHash: 'f'.repeat(64),
      filename: 'replacement.png',
    });
    assert.throws(() => applyArtifacts(database, fixture, [mutated]), (error) => error instanceof OperationBatchConflictError);
    assert.equal(tableCount(database, 'run_output_commits'), 1);

    const abaBatch = makeBatch(fixture, [mutated], {
      batchId: stableEntityUuid('different-host-batch', fixture.attempt.entityUid, 0),
      clientId: stableEntityUuid('different-host-client', fixture.attempt.entityUid),
      clientSeq: 77,
    });
    abaBatch.operations[0].opId = stableEntityUuid('different-host-op', fixture.attempt.entityUid, 0);
    abaBatch.operations[0].payload.expectedRunRevision = 2;
    abaBatch.operations[0].payload.expectedNodeRunRevision = 2;
    abaBatch.operations[0].payload.expectedAttemptRevision = 2;
    const abaArtifact = { ...mutated, opId: abaBatch.operations[0].opId };
    assert.throws(() => database.applyCommonHostArtifactBatch(abaBatch, {
      hostIdentity: HOST_IDENTITY,
      verifiedArtifacts: [abaArtifact],
    }), /slot|槽位|conflict/i);
    assert.equal(tableCount(database, 'run_output_commits'), 1);

    const foreign = createFixture(database, '-foreign');
    const cross = makeBatch(fixture, [makeArtifact(fixture, 1)]);
    cross.operations[0].payload.runUid = foreign.run.entityUid;
    assert.throws(() => database.applyCommonHostArtifactBatch(cross, {
      hostIdentity: HOST_IDENTITY,
      verifiedArtifacts: [makeArtifact(fixture, 1)],
    }), /scope|作用域|artifact|target/i);
    assert.equal(tableCount(database, 'run_output_commits'), 1);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});

test('private host ingestion verifies controlled bytes, ignores forged fields, supports empty text, and replays after restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-cas-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 2,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const textPath = path.join(config.OUTPUT_DIR, 'actual-result.txt');
  const emptyPath = path.join(config.OUTPUT_DIR, 'empty.txt');
  fs.writeFileSync(textPath, 'real host output');
  fs.writeFileSync(emptyPath, Buffer.alloc(0));
  const filename = path.join(directory, 'projects.sqlite3');
  try {
    let request;
    const first = new ProjectDatabase(filename, { autoBackup: false });
    try {
      const fixture = createFixture(first);
      request = {
        runId: fixture.run.id,
        nodeRunId: fixture.nodeRun.id,
        attemptId: fixture.attempt.id,
        outputs: [
          {
            sourceUrl: '/files/output/actual-result.txt',
            outputOrdinal: 0,
            actorId: 'forged-member',
            sessionId: 'forged-session',
            filename: '../forged.png',
            kind: 'image',
            mimeType: 'image/png',
            contentHash: 'f'.repeat(64),
            managedPath: 'C:\\Users\\victim\\secret.txt',
            storageKey: '../../secret',
          },
          { sourceUrl: '/files/output/empty.txt', outputOrdinal: 1 },
        ],
      };
      const indexer = new AssetIndexer(config, first, {
        blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      });
      const committed = await indexer.commitHostRunOutputAssets(request);
      assert.equal(committed.duplicate, false);
      assert.equal(committed.assets.length, 2);
      assert.deepEqual(committed.assets.map((asset) => asset.filename), ['actual-result.txt', 'empty.txt']);
      assert.deepEqual(committed.assets.map((asset) => asset.kind), ['text', 'text']);
      assert.equal(committed.assets[0].contentHash, crypto.createHash('sha256').update('real host output').digest('hex'));
      assert.equal(committed.assets[1].contentHash, crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
      assert.equal(committed.assets[1].metadata.size, 0);
      assert.equal(committed.assets.every((asset) => asset.storageMode === 'managed' && asset.availability === 'available'), true);
      const realBlobRoot = fs.realpathSync.native(config.ASSET_BLOB_DIR);
      assert.equal(committed.assets.every((asset) => asset.managedPath.startsWith(realBlobRoot)), true);
      assert.equal(committed.assets.some((asset) => /victim|secret\.txt|forged/i.test(JSON.stringify(asset))), false);
      assert.equal(fs.existsSync(textPath), true);
      assert.equal(fs.existsSync(emptyPath), true);
      assert.equal(listCasFiles(config.ASSET_BLOB_DIR).length, 2);
    } finally {
      first.close();
    }

    const reopened = new ProjectDatabase(filename, { autoBackup: false });
    try {
      const indexer = new AssetIndexer(config, reopened, {
        blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      });
      const replay = await indexer.commitHostRunOutputAssets(request);
      assert.equal(replay.duplicate, true);
      assert.equal(tableCount(reopened, 'run_output_commits'), 2);
      assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE type='node.output'").get().count, 2);
      assert.equal(tableCount(reopened, 'audit_events'), 2);
      assert.equal(listCasFiles(config.ASSET_BLOB_DIR).length, 2);
      assert.equal(reopened.db.pragma('quick_check', { simple: true }), 'ok');
      assert.deepEqual(reopened.db.pragma('foreign_key_check'), []);
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('inline text and public provider media are privately materialized before the same CAS transaction', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-materialize-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const remoteCalls = [];
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const fixture = createFixture(database, '-materialize');
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async (url, targetPath, options) => {
        remoteCalls.push({ url, targetPath, options });
        fs.writeFileSync(targetPath, png, { flag: 'wx', mode: 0o600 });
        return {
          byteSize: png.length,
          contentType: 'image/png; charset=binary',
          finalUrl: url,
          status: 200,
        };
      },
    });
    const request = {
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [
        { kind: 'text', text: 'authoritative inline answer', filename: '../answer.txt', outputOrdinal: 0 },
        {
          kind: 'image',
          sourceUrl: 'https://provider.example/generated?id=secret-token',
          filename: 'generated.png',
          mimeType: 'application/x-forged',
          outputOrdinal: 1,
        },
      ],
    };
    const committed = await indexer.commitHostRunOutputAssets(request);
    assert.equal(committed.duplicate, false);
    assert.deepEqual(committed.assets.map((asset) => asset.kind), ['text', 'image']);
    assert.deepEqual(committed.assets.map((asset) => asset.filename), ['run-output-0.txt', 'run-output-1.png']);
    assert.deepEqual(committed.assets.map((asset) => asset.contentHash), [
      crypto.createHash('sha256').update('authoritative inline answer').digest('hex'),
      crypto.createHash('sha256').update(png).digest('hex'),
    ]);
    assert.equal(remoteCalls.length, 1);
    assert.equal(remoteCalls[0].url, 'https://provider.example/generated?id=secret-token');
    assert.equal(remoteCalls[0].options.maxBytes, 256 * 1024 * 1024);
    assert.equal(remoteCalls[0].options.trustedProviderOutput, true);
    assert.equal(tableCount(database, 'run_output_commits'), 2);
    assert.equal(tableCount(database, 'collaboration_common_operation_batches'), 1);
    assert.equal(tableCount(database, 'collaboration_domain_operation_idempotency'), 2);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE type='node.output'").get().count, 2);
    assert.doesNotMatch(JSON.stringify(committed.assets), /provider\.example|secret-token|application\/x-forged/i);
    const stagingRoot = path.join(config.OUTPUT_DIR, '.host-artifact-staging');
    assert.deepEqual(fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [], []);

    const replay = await indexer.commitHostRunOutputAssets(request);
    assert.equal(replay.duplicate, true);
    assert.equal(remoteCalls.length, 1);
    assert.equal(tableCount(database, 'run_output_commits'), 2);
    assert.deepEqual(fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [], []);

    await assert.rejects(indexer.commitHostRunOutputAssets({
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [{ sourceUrl: 'https://provider.example/ambiguous.txt', text: 'ambiguous', outputOrdinal: 2 }],
    }), (error) => error?.code === 'host_artifact_source_ambiguous');
    assert.equal(tableCount(database, 'run_output_commits'), 2);
    assert.deepEqual(fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [], []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('new CAS blobs are compensated when the atomic database callback fails, while reused blobs remain', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-compensation-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  const reusedSource = path.join(config.OUTPUT_DIR, 'reused.txt');
  const newSource = path.join(config.OUTPUT_DIR, 'new.txt');
  fs.writeFileSync(reusedSource, 'already present');
  fs.writeFileSync(newSource, 'must roll back');
  const reusedHash = crypto.createHash('sha256').update('already present').digest('hex');
  const store = new AssetBlobStore(config.ASSET_BLOB_DIR);
  await store.installVerifiedFile(reusedSource, {
    expectedHash: reusedHash,
    expectedSize: fs.statSync(reusedSource).size,
  });

  const database = new ProjectDatabase(':memory:', {
    autoBackup: false,
    beforeHostArtifactOperation: ({ operationIndex }) => {
      if (operationIndex === 1) throw new Error('forced-host-db-failure');
    },
  });
  try {
    const fixture = createFixture(database);
    const indexer = new AssetIndexer(config, database, { blobStore: store });
    await assert.rejects(indexer.commitHostRunOutputAssets({
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [
        { sourceUrl: '/files/output/reused.txt', outputOrdinal: 0 },
        { sourceUrl: '/files/output/new.txt', outputOrdinal: 1 },
      ],
    }), /forced-host-db-failure/);
    assert.equal(tableCount(database, 'run_output_commits'), 0);
    assert.ok(await store.resolveVerifiedBlob(reusedHash, fs.statSync(reusedSource).size));
    const newHash = crypto.createHash('sha256').update('must roll back').digest('hex');
    assert.equal(await store.resolveVerifiedBlob(newHash, fs.statSync(newSource).size), null);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('remote JSON is canonically typed, persisted without URL secrets, and replay is descriptor/CAS exact', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-json-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const json = Buffer.from(JSON.stringify({ ok: true, result: ['canonical', 'json'] }), 'utf8');
  const sourceUrl = 'https://provider-json.example/result?token=s3cr3t-remote-token';
  const remoteCalls = [];
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const fixture = createFixture(database, '-remote-json');
    const store = new AssetBlobStore(config.ASSET_BLOB_DIR);
    const indexer = new AssetIndexer(config, database, {
      blobStore: store,
      remoteMediaDownload: async (url, targetPath) => {
        remoteCalls.push(url);
        fs.writeFileSync(targetPath, json, { flag: 'wx', mode: 0o600 });
        return {
          byteSize: json.length,
          contentType: 'image/png; forged=true',
          finalUrl: url,
          status: 200,
        };
      },
    });
    const request = {
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [{
        sourceUrl,
        filename: '../s3cr3t-remote-token.png',
        mimeType: 'image/png',
        kind: 'image',
        outputOrdinal: 7,
      }],
    };

    const committed = await indexer.commitHostRunOutputAssets(request);
    assert.equal(committed.duplicate, false);
    assert.equal(remoteCalls.length, 1);
    assert.equal(committed.assets.length, 1);
    assert.equal(committed.assets[0].kind, 'text');
    assert.equal(committed.assets[0].mimeType, 'application/json');
    assert.equal(committed.assets[0].filename, 'run-output-7.json');
    assert.match(committed.assets[0].metadata.sourceDescriptorDigest, /^[a-f0-9]{64}$/);
    const commit = database.getRunOutputCommitBySlot(fixture.attempt.entityUid, 7);
    assert.match(commit.sourceDescriptorDigest, /^[a-f0-9]{64}$/);
    assert.equal(commit.kind, 'text');
    assert.equal(commit.mimeType, 'application/json');
    assert.equal(commit.filename, 'run-output-7.json');

    const persistedEvidence = JSON.stringify({
      assets: database.db.prepare('SELECT * FROM assets').all(),
      commits: database.db.prepare('SELECT * FROM run_output_commits').all(),
      events: database.db.prepare('SELECT * FROM run_events').all(),
      lineage: database.db.prepare('SELECT * FROM asset_lineage_events').all(),
      audits: database.db.prepare('SELECT * FROM audit_events').all(),
      commonBatches: database.db.prepare('SELECT * FROM collaboration_common_operation_batches').all(),
      idempotency: database.db.prepare('SELECT * FROM collaboration_domain_operation_idempotency').all(),
    });
    assert.doesNotMatch(persistedEvidence, /provider-json\.example|s3cr3t-remote-token/i);
    assert.doesNotMatch(JSON.stringify(committed.assets), /provider-json\.example|s3cr3t-remote-token|image\/png/i);

    const replay = await indexer.commitHostRunOutputAssets(request);
    assert.equal(replay.duplicate, true);
    assert.equal(remoteCalls.length, 1);
    assert.equal(tableCount(database, 'run_output_commits'), 1);

    await assert.rejects(indexer.commitHostRunOutputAssets({
      ...request,
      outputs: [{
        ...request.outputs[0],
        sourceUrl: 'https://provider-json.example/result?token=changed-but-same-bytes',
      }],
    }), (error) => error?.code === 'host_artifact_output_slot_conflict' && error?.status === 409);
    assert.equal(remoteCalls.length, 1);

    const casPath = committed.assets[0].managedPath;
    fs.rmSync(casPath, { force: true });
    await assert.rejects(indexer.commitHostRunOutputAssets(request), (error) => (
      error?.code === 'host_artifact_cas_missing' && error?.status === 409
    ));
    assert.equal(remoteCalls.length, 1);
    fs.writeFileSync(casPath, Buffer.alloc(json.length, 0x78), { flag: 'wx', mode: 0o600 });
    await assert.rejects(indexer.commitHostRunOutputAssets(request), (error) => (
      error?.code === 'host_artifact_cas_corrupt' && error?.status === 409
    ));
    assert.equal(remoteCalls.length, 1);
    assert.equal(tableCount(database, 'run_output_commits'), 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE type='node.output'").get().count, 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('damaged PNG magic is rejected before CAS or database commit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-corrupt-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const damagedPng = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const fixture = createFixture(database, '-damaged-png');
    let remoteCalls = 0;
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async (url, targetPath) => {
        remoteCalls += 1;
        fs.writeFileSync(targetPath, damagedPng, { flag: 'wx', mode: 0o600 });
        return { byteSize: damagedPng.length, contentType: 'image/png', finalUrl: url, status: 200 };
      },
    });
    await assert.rejects(indexer.commitHostRunOutputAssets({
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [{ sourceUrl: 'https://provider.example/damaged.png', outputOrdinal: 0 }],
    }), (error) => error?.code === 'host_artifact_media_corrupt' && error?.status === 415);
    assert.equal(remoteCalls, 1);
    assert.equal(tableCount(database, 'assets'), 0);
    assert.equal(tableCount(database, 'asset_blobs'), 0);
    assert.equal(tableCount(database, 'run_output_commits'), 0);
    assert.equal(tableCount(database, 'run_events'), 0);
    assert.deepEqual(listCasFiles(config.ASSET_BLOB_DIR), []);
    const stagingRoot = path.join(config.OUTPUT_DIR, '.host-artifact-staging');
    assert.deepEqual(fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [], []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('HTTP provider sources fail before download and aggregate limits roll back the whole batch', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-limits-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    HOST_ARTIFACT_TOTAL_MAX_BYTES: 10,
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.OUTPUT_DIR, 'first.txt'), '123456');
  fs.writeFileSync(path.join(config.OUTPUT_DIR, 'second.txt'), 'abcdef');
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const httpFixture = createFixture(database, '-http-source');
    const aggregateFixture = createFixture(database, '-aggregate-limit');
    let remoteCalls = 0;
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async () => {
        remoteCalls += 1;
        throw new Error('must not download insecure HTTP');
      },
    });
    await assert.rejects(indexer.commitHostRunOutputAssets({
      runId: httpFixture.run.id,
      nodeRunId: httpFixture.nodeRun.id,
      attemptId: httpFixture.attempt.id,
      outputs: [{ sourceUrl: 'http://provider.example/result.png', outputOrdinal: 0 }],
    }), (error) => error?.code === 'host_artifact_source_forbidden' && error?.status === 403);
    assert.equal(remoteCalls, 0);

    await assert.rejects(indexer.commitHostRunOutputAssets({
      runId: aggregateFixture.run.id,
      nodeRunId: aggregateFixture.nodeRun.id,
      attemptId: aggregateFixture.attempt.id,
      outputs: [
        { sourceUrl: '/files/output/first.txt', outputOrdinal: 0 },
        { sourceUrl: '/files/output/second.txt', outputOrdinal: 1 },
      ],
    }), (error) => error?.code === 'host_artifact_total_too_large' && error?.status === 413);
    assert.equal(tableCount(database, 'assets'), 0);
    assert.equal(tableCount(database, 'asset_blobs'), 0);
    assert.equal(tableCount(database, 'run_output_commits'), 0);
    assert.equal(tableCount(database, 'run_events'), 0);
    assert.deepEqual(listCasFiles(config.ASSET_BLOB_DIR), []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('startup staging cleanup removes only stale UUIDv4 host parts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-staging-cleanup-'));
  const output = path.join(directory, 'output');
  const staging = path.join(output, '.host-artifact-staging');
  fs.mkdirSync(staging, { recursive: true });
  const staleMatching = path.join(staging, 'host-artifact-11111111-1111-4111-8111-111111111111.part');
  const freshMatching = path.join(staging, 'host-artifact-22222222-2222-4222-9222-222222222222.part');
  const staleWrongVersion = path.join(staging, 'host-artifact-33333333-3333-3333-8333-333333333333.part');
  const staleUnrelated = path.join(staging, 'notes.part');
  const matchingDirectory = path.join(staging, 'host-artifact-44444444-4444-4444-a444-444444444444.part');
  for (const filename of [staleMatching, freshMatching, staleWrongVersion, staleUnrelated]) {
    fs.writeFileSync(filename, filename);
  }
  fs.mkdirSync(matchingDirectory);
  const old = new Date(Date.now() - 60_000);
  for (const filename of [staleMatching, staleWrongVersion, staleUnrelated, matchingDirectory]) {
    fs.utimesSync(filename, old, old);
  }
  try {
    new AssetIndexer({
      INPUT_DIR: path.join(directory, 'input'),
      OUTPUT_DIR: output,
      ASSET_BLOB_DIR: path.join(directory, 'cas'),
      HOST_ARTIFACT_STAGING_MAX_AGE_MS: 1_000,
    }, null);
    assert.equal(fs.existsSync(staleMatching), false);
    assert.equal(fs.existsSync(freshMatching), true);
    assert.equal(fs.existsSync(staleWrongVersion), true);
    assert.equal(fs.existsSync(staleUnrelated), true);
    assert.equal(fs.existsSync(matchingDirectory), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('mixed controlled and remote exact replay revalidates local bytes without downloading remote twice', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-mixed-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.OUTPUT_DIR, 'local-result.txt'), 'controlled bytes');
  const remoteJson = Buffer.from('{"remote":true}', 'utf8');
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const fixture = createFixture(database, '-mixed-source');
    let remoteCalls = 0;
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async (url, targetPath) => {
        remoteCalls += 1;
        fs.writeFileSync(targetPath, remoteJson, { flag: 'wx', mode: 0o600 });
        return { byteSize: remoteJson.length, contentType: 'application/json', finalUrl: url, status: 200 };
      },
    });
    const request = {
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [
        { sourceUrl: '/files/output/local-result.txt', outputOrdinal: 0 },
        { sourceUrl: 'https://provider.example/mixed.json?token=private', outputOrdinal: 1 },
      ],
    };
    const fresh = await indexer.commitHostRunOutputAssets(request);
    assert.equal(fresh.duplicate, false);
    assert.deepEqual(fresh.assets.map((asset) => asset.filename), ['local-result.txt', 'run-output-1.json']);
    assert.equal(remoteCalls, 1);
    const replay = await indexer.commitHostRunOutputAssets(request);
    assert.equal(replay.duplicate, true);
    assert.equal(remoteCalls, 1);
    assert.equal(tableCount(database, 'run_output_commits'), 2);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE type='node.output'").get().count, 2);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('host artifact concurrency rejects the third request and drains active/queued permits', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-concurrency-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    HOST_ARTIFACT_CONCURRENCY: 1,
    HOST_ARTIFACT_QUEUE_LIMIT: 1,
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  const pendingDownloads = [];
  const remoteCalls = [];
  try {
    const fixtures = [
      createFixture(database, '-concurrency-a'),
      createFixture(database, '-concurrency-b'),
      createFixture(database, '-concurrency-c'),
    ];
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async (url, targetPath) => {
        remoteCalls.push(url);
        await new Promise((resolve) => pendingDownloads.push(resolve));
        const bytes = Buffer.from('{"queued":true}', 'utf8');
        fs.writeFileSync(targetPath, bytes, { flag: 'wx', mode: 0o600 });
        return { byteSize: bytes.length, contentType: 'application/json', finalUrl: url, status: 200 };
      },
    });
    const requestFor = (fixture, suffix) => ({
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [{ sourceUrl: `https://provider.example/queue-${suffix}.json`, outputOrdinal: 0 }],
    });

    const first = indexer.commitHostRunOutputAssets(requestFor(fixtures[0], 'a'));
    await waitForCondition(() => pendingDownloads.length === 1, 'first host artifact download');
    const second = indexer.commitHostRunOutputAssets(requestFor(fixtures[1], 'b'));
    await waitForCondition(() => indexer.hostArtifactWaiters.length === 1, 'host artifact queue');
    await assert.rejects(
      indexer.commitHostRunOutputAssets(requestFor(fixtures[2], 'c')),
      (error) => error?.code === 'host_artifact_busy' && error?.status === 429,
    );
    assert.equal(indexer.hostArtifactActive, 1);
    assert.equal(indexer.hostArtifactWaiters.length, 1);
    assert.equal(remoteCalls.length, 1);

    pendingDownloads.shift()();
    const firstResult = await first;
    assert.equal(firstResult.duplicate, false);
    await waitForCondition(() => pendingDownloads.length === 1 && remoteCalls.length === 2, 'second host artifact download');
    pendingDownloads.shift()();
    const secondResult = await second;
    assert.equal(secondResult.duplicate, false);
    await waitForCondition(
      () => indexer.hostArtifactActive === 0 && indexer.hostArtifactWaiters.length === 0,
      'host artifact permit drain',
    );
    assert.equal(remoteCalls.length, 2);
    assert.equal(tableCount(database, 'run_output_commits'), 2);
  } finally {
    for (const release of pendingDownloads.splice(0)) release();
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('host artifact commit rebases onto the live canvas revision after slow media materialization', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-live-revision-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    ASSET_INDEX_STABILITY_ATTEMPTS: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  let releaseDownload;
  const downloadStarted = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  let finishDownload;
  const downloadMayFinish = new Promise((resolve) => {
    finishDownload = resolve;
  });
  try {
    const fixture = createFixture(database, '-live-revision');
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async (_url, targetPath) => {
        releaseDownload();
        await downloadMayFinish;
        const bytes = Buffer.from('{"story":"final-video"}', 'utf8');
        fs.writeFileSync(targetPath, bytes, { flag: 'wx', mode: 0o600 });
        return { byteSize: bytes.length, contentType: 'application/json', status: 200 };
      },
    });
    const committing = indexer.commitHostRunOutputAssets({
      runId: fixture.run.id,
      nodeRunId: fixture.nodeRun.id,
      attemptId: fixture.attempt.id,
      outputs: [{
        sourceUrl: 'https://provider.example/story-final.json',
        outputOrdinal: 0,
      }],
    });
    await downloadStarted;
    const live = database.saveCanvasSnapshot(fixture.document.canvasId, {
      ...fixture.document,
      viewport: { x: 24, y: 12, zoom: 1 },
    }, {
      expectedRevision: fixture.document.revision,
      actorId: 'owner-a',
      sessionId: 'autosave-during-host-materialization',
    });
    assert.equal(live.revision, fixture.document.revision + 1);
    finishDownload();

    const committed = await committing;
    assert.equal(committed.duplicate, false);
    assert.equal(committed.document.revision, live.revision);
    assert.equal(
      database.getRunOutputCommitBySlot(fixture.attempt.entityUid, 0).canvasRevision,
      live.revision,
    );
  } finally {
    finishDownload?.();
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('aborting a queued host artifact permit removes the waiter without leaking the active slot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-host-artifact-abort-permit-'));
  const config = {
    INPUT_DIR: path.join(directory, 'input'),
    OUTPUT_DIR: path.join(directory, 'output'),
    ASSET_BLOB_DIR: path.join(directory, 'cas'),
    HOST_ARTIFACT_CONCURRENCY: 1,
    HOST_ARTIFACT_QUEUE_LIMIT: 1,
  };
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const indexer = new AssetIndexer(config, database, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
    });
    const releaseFirst = await indexer.acquireHostArtifactPermit();
    const controller = new AbortController();
    const queued = indexer.acquireHostArtifactPermit(controller.signal);
    await waitForCondition(() => indexer.hostArtifactWaiters.length === 1, 'abortable host artifact waiter');
    controller.abort();
    await assert.rejects(queued, (error) => error?.code === 'host_artifact_aborted' && error?.name === 'AbortError');
    assert.equal(indexer.hostArtifactActive, 1);
    assert.equal(indexer.hostArtifactWaiters.length, 0);
    releaseFirst();
    assert.equal(indexer.hostArtifactActive, 0);

    const releaseAfterAbort = await indexer.acquireHostArtifactPermit();
    releaseAfterAbort();
    assert.equal(indexer.hostArtifactActive, 0);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
