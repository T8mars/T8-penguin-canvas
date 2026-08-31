const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');

const {
  COMMON_OPERATION_BATCH_CONTRACT,
} = require('../backend/src/collaboration/commonOperationProtocol');
const {
  stableEntityUuid,
} = require('../backend/src/collaboration/protocol');
const {
  CollaborationTextPersistence,
} = require('../backend/src/services/collaborationTextPersistence');
const {
  CANVAS_PATCH_CONTRACT,
} = require('../backend/src/services/canvasPatch');
const {
  PROJECT_DATABASE_MIGRATION_29_DOWN_SQL,
} = require('../backend/src/services/projectDatabaseMigration29');
const {
  PROJECT_DATABASE_MIGRATION_30_DOWN_SQL,
} = require('../backend/src/services/projectDatabaseMigration30');
const {
  PROJECT_DATABASE_MIGRATION_31,
} = require('../backend/src/services/projectDatabaseMigration31');
const {
  PROJECT_DATABASE_MIGRATION_31_LEGACY_GAPS_DOWN_SQL,
} = require('../backend/src/services/projectDatabaseMigration31LegacyGaps');
const {
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS,
} = require('../backend/src/services/projectDatabaseMigration31DurableLedgers');
const {
  PROJECT_DATABASE_MIGRATIONS,
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectDatabase,
  ProjectDatabaseHistoryCapacityError,
} = require('../backend/src/services/projectDatabase');
const {
  assertCurrentProjectDatabaseRegistry,
  stripSchema32ForSyntheticSchema31,
} = require('./helpers/projectDatabaseVersion.cjs');

const PROJECT_ID = 'project-snapshot-pins-capacity-b2';
const CANVAS_ID = 'canvas-snapshot-pins-capacity-b2';
const NODE_ID = 'node-snapshot-pins-capacity-b2';
const NODE_UID = '71000000-0000-4000-8000-000000000001';
const PATCH_ID = '72000000-0000-4000-8000-000000000001';
const HOST_IDENTITY = Object.freeze({
  actorId: 'host-executor',
  sessionId: 'host-authority',
});
const GENEROUS_HISTORY_POLICY = Object.freeze({
  maxSnapshotRows: 100,
  maxSnapshotBytes: 64 * 1024 * 1024,
  maxCommonEvidenceRows: 1_000,
  maxCommonEvidenceBytes: 64 * 1024 * 1024,
  maxRawOperationRows: 1_000,
  maxRawOperationBytes: 64 * 1024 * 1024,
  maxPinRows: 100,
});

function databaseOptions(overrides = {}) {
  const { canvasHistoryPolicy = {}, ...rest } = overrides;
  return {
    autoBackup: false,
    canvasSnapshotRetentionLimit: 50,
    canvasHistoryPolicy: {
      ...GENEROUS_HISTORY_POLICY,
      ...canvasHistoryPolicy,
    },
    ...rest,
  };
}

// Production schema31 DOWN remains backup-only. This helper strips only the
// schema31-owned fixture objects so historical schema30/28 migration tests can
// reconstruct their exact starting endpoint without weakening production DOWN.
function stripSchema31ForSchema30Test(database) {
  stripSchema32ForSyntheticSchema31(database);
  database.exec(PROJECT_DATABASE_MIGRATION_31_LEGACY_GAPS_DOWN_SQL);
  const drop = (type, name) => database.exec(`DROP ${type} IF EXISTS "${name}"`);
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.triggers
    .forEach((name) => drop('TRIGGER', name));
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.views
    .forEach((name) => drop('VIEW', name));
  PROJECT_DATABASE_MIGRATION_31_DURABLE_LEDGER_OWNED_OBJECTS.indexes
    .forEach((name) => drop('INDEX', name));
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

function seed(database, suffix = '', prompt = '企鹅🐧快照容量：中文必须按 UTF-8 字节计费') {
  return database.ensureCanvas(`${CANVAS_ID}${suffix}`, {
    name: 'B2 explicit snapshot pins and capacity',
    nodes: [{
      id: NODE_ID,
      entityUid: NODE_UID,
      entityRevision: 1,
      type: 'text',
      position: { x: 0, y: 0 },
      data: { prompt },
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }, `${PROJECT_ID}${suffix}`);
}

function move(database, document, sequence, suffix = '') {
  return database.applyOperations(document.canvasId, [{
    opId: `snapshot-pin-capacity-${suffix || 'main'}-move-${sequence}`,
    projectId: document.projectId,
    canvasId: document.canvasId,
    actorId: 'snapshot-pin-capacity-writer',
    sessionId: 'snapshot-pin-capacity-session',
    clientSeq: sequence,
    baseRevision: document.revision,
    timestamp: 1_900_000_000_000 + sequence,
    type: 'node.move',
    payload: {
      nodeId: NODE_ID,
      position: { x: sequence * 11, y: sequence * 13 },
    },
  }], {
    expectedRevision: document.revision,
  }).document;
}

function snapshotRows(database, canvasId = CANVAS_ID) {
  return database.db.prepare(`
    SELECT revision, project_id, reason, snapshot_json,
           length(CAST(snapshot_json AS BLOB)) AS logical_bytes
    FROM canvas_snapshots
    WHERE canvas_id = ?
    ORDER BY revision ASC
  `).all(canvasId).map((row) => ({
    revision: Number(row.revision),
    projectId: row.project_id,
    reason: row.reason,
    snapshotJson: row.snapshot_json,
    logicalBytes: Number(row.logical_bytes),
  }));
}

function pinRows(database, canvasId = CANVAS_ID) {
  return database.db.prepare(`
    SELECT project_id, canvas_id, snapshot_revision, pin_kind, owner_id, slot,
           retention_class, expires_at, owner_state_digest
    FROM canvas_snapshot_pins
    WHERE canvas_id = ?
    ORDER BY snapshot_revision ASC, pin_kind ASC, owner_id ASC, slot ASC
  `).all(canvasId).map((row) => ({
    projectId: row.project_id,
    canvasId: row.canvas_id,
    snapshotRevision: Number(row.snapshot_revision),
    pinKind: row.pin_kind,
    ownerId: row.owner_id,
    slot: row.slot,
    retentionClass: row.retention_class,
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    ownerStateDigest: row.owner_state_digest,
  }));
}

function historyUsage(database, projectId = PROJECT_ID, canvasId = CANVAS_ID) {
  const row = database.db.prepare(`
    SELECT snapshot_rows, snapshot_bytes, common_evidence_rows,
           common_evidence_bytes, raw_operation_rows, raw_operation_bytes,
           pin_rows, pin_bytes
    FROM canvas_history_usage
    WHERE project_id = ? AND canvas_id = ?
  `).get(projectId, canvasId);
  assert.ok(row, 'canvas_history_usage must exist for every canvas');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

function assertHistoryAccounting(database, projectId = PROJECT_ID, canvasId = CANVAS_ID) {
  const usage = historyUsage(database, projectId, canvasId);
  const authoritative = database.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM canvas_snapshots WHERE canvas_id = ?) AS snapshot_rows,
      COALESCE((
        SELECT SUM(length(CAST(snapshot_json AS BLOB)))
        FROM canvas_snapshots WHERE canvas_id = ?
      ), 0) AS snapshot_bytes,
      (SELECT COUNT(*) FROM collaboration_common_graph_operation_evidence WHERE canvas_id = ?) AS common_evidence_rows,
      COALESCE((
        SELECT SUM(logical_bytes)
        FROM collaboration_common_graph_operation_evidence WHERE canvas_id = ?
      ), 0) AS common_evidence_bytes,
      (SELECT COUNT(*) FROM canvas_operations WHERE canvas_id = ?) AS raw_operation_rows,
      COALESCE((
        SELECT SUM(length(CAST(payload_json AS BLOB)))
        FROM canvas_operations WHERE canvas_id = ?
      ), 0) AS raw_operation_bytes,
      (SELECT COUNT(*) FROM canvas_snapshot_pins WHERE canvas_id = ?) AS pin_rows
  `).get(canvasId, canvasId, canvasId, canvasId, canvasId, canvasId, canvasId);
  for (const field of [
    'snapshot_rows',
    'snapshot_bytes',
    'common_evidence_rows',
    'common_evidence_bytes',
    'raw_operation_rows',
    'raw_operation_bytes',
    'pin_rows',
  ]) {
    assert.equal(usage[field], Number(authoritative[field]), `${field} must match authoritative rows`);
  }
  assert.ok(usage.pin_bytes >= 0);
  return usage;
}

function assertPin(database, expected, canvasId = CANVAS_ID) {
  const row = pinRows(database, canvasId).find((pin) => (
    pin.pinKind === expected.pinKind
    && pin.ownerId === expected.ownerId
    && pin.slot === expected.slot
  ));
  assert.ok(row, `missing ${expected.pinKind}/${expected.ownerId}/${expected.slot} snapshot pin`);
  assert.equal(row.snapshotRevision, expected.snapshotRevision);
  assert.equal(row.retentionClass, expected.retentionClass);
  assert.equal(row.expiresAt, null);
  assert.match(row.ownerStateDigest, /^[a-f0-9]{64}$/);
  return row;
}

function compactToTwo(database, canvasId = CANVAS_ID) {
  database.options.canvasSnapshotRetentionLimit = 2;
  database._refreshCanvasSnapshotPins(canvasId);
  return database.compactCanvasSnapshotHistory(canvasId);
}

function createRunIntent(database, document, id) {
  return database.createRunIntent({
    id,
    projectId: document.projectId,
    canvasId: document.canvasId,
    canvasRevision: document.revision,
    nodeIds: [NODE_ID],
    idempotencyKey: `${id}-key`,
    requestedBy: 'snapshot-pin-capacity-writer',
  });
}

function createActiveRun(database, document, id) {
  return database.createRun({
    id,
    projectId: document.projectId,
    canvasId: document.canvasId,
    canvasRevision: document.revision,
    initiatorId: 'snapshot-pin-capacity-writer',
    status: 'running',
  });
}

function makeHostArtifactFixture(database, document, run) {
  const nodeRun = database.createNodeRun({
    id: 'snapshot-pin-output-node-run',
    runId: run.id,
    nodeId: NODE_ID,
    originalNodeId: NODE_ID,
    status: 'running',
    inputSnapshot: {
      node: {
        id: NODE_ID,
        entityUid: NODE_UID,
        type: 'text',
        data: { prompt: 'host output snapshot' },
      },
      upstreamNodes: [],
      incomingEdges: [],
    },
  });
  const attempt = database.createAttempt({
    id: 'snapshot-pin-output-attempt',
    nodeRunId: nodeRun.id,
    provider: 'host-local',
    model: 'host-model',
    status: 'running',
  });
  const contentHash = 'a'.repeat(64);
  const artifact = {
    opId: stableEntityUuid('snapshot-pin-output-op', attempt.entityUid, 0),
    artifactUid: stableEntityUuid('snapshot-pin-output-artifact', attempt.entityUid, 0),
    blobUid: stableEntityUuid('t8-asset-blob-v1', 'sha256', contentHash),
    contentHash,
    byteSize: 17,
    kind: 'image',
    filename: 'snapshot-pin-output.png',
    mimeType: 'image/png',
    storageKey: `sha256/aa/aa/${contentHash}`,
    managedPath: path.join(os.tmpdir(), 'snapshot-pin-output.png'),
    sourceUrl: '/api/project-assets/snapshot-pin-output/media',
    metadata: { size: 17, health: 'ok' },
    outputOrdinal: 0,
  };
  const batch = {
    contractVersion: COMMON_OPERATION_BATCH_CONTRACT,
    projectId: document.projectId,
    canvasId: document.canvasId,
    baseRevision: document.revision,
    batchId: stableEntityUuid('snapshot-pin-output-batch', run.entityUid, attempt.entityUid),
    clientId: stableEntityUuid('snapshot-pin-output-client', run.entityUid, attempt.entityUid),
    clientSeq: 0,
    operations: [{
      opId: artifact.opId,
      type: 'host.artifact.commit',
      payload: {
        artifactUid: artifact.artifactUid,
        blobUid: artifact.blobUid,
        runUid: run.entityUid,
        nodeRunUid: nodeRun.entityUid,
        attemptUid: attempt.entityUid,
        nodeUid: NODE_UID,
        expectedCanvasRevision: document.revision,
        expectedRunRevision: run.revision,
        expectedNodeRunRevision: nodeRun.revision,
        expectedAttemptRevision: attempt.revision,
        outputOrdinal: 0,
        kind: artifact.kind,
        contentHash: artifact.contentHash,
        byteSize: artifact.byteSize,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
      },
    }],
  };
  database.applyCommonHostArtifactBatch(batch, {
    hostIdentity: HOST_IDENTITY,
    verifiedArtifacts: [artifact],
  });
  return { nodeRun, attempt, artifact, batch };
}

function createTextBinding(database, document) {
  const persistence = new CollaborationTextPersistence(database);
  return persistence.getBindingSnapshot({
    projectId: document.projectId,
    canvasId: document.canvasId,
    targetType: 'node',
    targetEntityUid: NODE_UID,
    field: 'prompt',
  }, {
    memberId: 'snapshot-pin-capacity-writer',
    actorId: 'snapshot-pin-capacity-writer',
    sessionId: 'snapshot-pin-capacity-session',
    role: 'editor',
    capabilities: ['editGraph', 'comment'],
    projectId: document.projectId,
    canvasId: document.canvasId,
  });
}

function createPatch(database, document) {
  const patch = {
    schema: CANVAS_PATCH_CONTRACT,
    id: PATCH_ID,
    baseRevision: document.revision,
    summary: 'B2 explicit applied snapshot pin',
    diagnosticsResolved: ['snapshot.explicit-pin'],
    requiresConfirmation: true,
    operations: [{
      opId: 'ignored-snapshot-pin-patch-operation',
      type: 'node.patch',
      payload: {
        nodeId: NODE_ID,
        dataPatch: { snapshotPinMarker: 'applied' },
      },
    }],
  };
  const preview = database.previewCanvasPatch(document.canvasId, patch, {
    actorId: 'snapshot-pin-capacity-writer',
  });
  const applied = database.applyCanvasPatch(document.canvasId, patch, {
    previewDigest: preview.previewDigest,
    confirmed: true,
    actorId: 'snapshot-pin-capacity-writer',
    sessionId: 'snapshot-pin-capacity-session',
  });
  return { patch, preview, applied };
}

function assertCapacityError(error, code) {
  assert.equal(typeof ProjectDatabaseHistoryCapacityError, 'function', 'capacity error class must be exported');
  assert.ok(error instanceof ProjectDatabaseHistoryCapacityError);
  assert.equal(error.name, 'ProjectDatabaseHistoryCapacityError');
  assert.equal(error.code, code);
  assert.equal(error.status, 507);
  assert.equal(error.statusCode, 507);
  return true;
}

test('B2 current schema preserves schema-29 recovery anchors with exact usage accounting', async () => {
  assertCurrentProjectDatabaseRegistry(PROJECT_DATABASE_SCHEMA_VERSION, PROJECT_DATABASE_MIGRATIONS);
  const fresh = new ProjectDatabase(':memory:', databaseOptions());
  try {
    const document = seed(fresh);
    assert.deepEqual(pinRows(fresh), [{
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      snapshotRevision: 1,
      pinKind: 'recovery_anchor',
      ownerId: CANVAS_ID,
      slot: 'anchor',
      retentionClass: 'recovery',
      expiresAt: null,
      ownerStateDigest: pinRows(fresh)[0].ownerStateDigest,
    }]);
    assert.match(pinRows(fresh)[0].ownerStateDigest, /^[a-f0-9]{64}$/);
    assert.equal(document.revision, 1);
    const usage = assertHistoryAccounting(fresh);
    assert.equal(usage.snapshot_rows, 1);
    assert.equal(usage.snapshot_bytes, Buffer.byteLength(snapshotRows(fresh)[0].snapshotJson, 'utf8'));
    assert.equal(usage.pin_rows, 1);
  } finally {
    await fresh.close();
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-b2-snapshot-pin-migration-'));
  const filename = path.join(directory, 'projects.sqlite3');
  let database = null;
  try {
    database = new ProjectDatabase(filename, databaseOptions());
    let document = seed(database, '-migration');
    document = move(database, document, 1, 'migration');
    database.recordCanvasSnapshot(document, 'migration-anchor-candidate');
    document = move(database, document, 2, 'migration');
    database.recordCanvasSnapshot(document, 'migration-anchor-candidate');
    await database.close();
    database = null;

    const legacy = new BetterSqlite3(filename);
    try {
      legacy.pragma('foreign_keys = OFF');
      legacy.transaction(() => {
        stripSchema31ForSchema30Test(legacy);
        legacy.exec(PROJECT_DATABASE_MIGRATION_30_DOWN_SQL);
        legacy.exec(PROJECT_DATABASE_MIGRATION_29_DOWN_SQL);
        legacy.prepare('DELETE FROM schema_migrations WHERE version = 30').run();
        legacy.prepare('DELETE FROM schema_migrations WHERE version = 29').run();
      }).immediate();
      assert.equal(legacy.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 28);
      assert.equal(legacy.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'canvas_snapshot_pins'
      `).get().count, 0);
    } finally {
      legacy.close();
    }

    database = new ProjectDatabase(filename, databaseOptions());
    const migratedCanvasId = `${CANVAS_ID}-migration`;
    const migratedProjectId = `${PROJECT_ID}-migration`;
    assert.deepEqual(pinRows(database, migratedCanvasId).map((row) => ({
      snapshotRevision: row.snapshotRevision,
      pinKind: row.pinKind,
      ownerId: row.ownerId,
      slot: row.slot,
      retentionClass: row.retentionClass,
    })), [{
      snapshotRevision: 1,
      pinKind: 'recovery_anchor',
      ownerId: migratedCanvasId,
      slot: 'anchor',
      retentionClass: 'recovery',
    }]);
    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migration_receipts WHERE version = 29
    `).get().count, 1);
    const usage = assertHistoryAccounting(database, migratedProjectId, migratedCanvasId);
    assert.equal(usage.snapshot_rows, 3);
    assert.equal(usage.pin_rows, 1);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    try { await database?.close(); } catch (_) {}
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('B2 explicit owner pins exclude Text/output/grant/Patch base/reverted and compaction keeps only pins plus latest window', () => {
  const database = new ProjectDatabase(':memory:', databaseOptions());
  try {
    let document = seed(database);

    document = move(database, document, 1);
    const intent = createRunIntent(database, document, 'snapshot-pin-active-intent');
    assertPin(database, {
      pinKind: 'run_intent', ownerId: intent.id, slot: 'canvas',
      snapshotRevision: 2, retentionClass: 'operational',
    });

    document = move(database, document, 2);
    const run = createActiveRun(database, document, 'snapshot-pin-active-run');
    assertPin(database, {
      pinKind: 'run', ownerId: run.id, slot: 'canvas',
      snapshotRevision: 3, retentionClass: 'operational',
    });

    document = move(database, document, 3);
    const thread = database.createReviewThread({
      id: 'snapshot-pin-review-thread',
      projectId: document.projectId,
      canvasId: document.canvasId,
      canvasRevision: document.revision,
      anchor: { kind: 'canvas', x: 10, y: 20 },
      createdBy: 'snapshot-pin-capacity-writer',
    });
    assertPin(database, {
      pinKind: 'review_source', ownerId: thread.id, slot: 'source',
      snapshotRevision: 4, retentionClass: 'evidence',
    });

    document = move(database, document, 4);
    const decided = database.updateReviewThread(thread.id, {
      expectedRevision: thread.revision,
      status: 'approved',
      decisionCanvasRevision: document.revision,
    });
    assert.equal(decided.decisionCanvasRevision, 5);
    assertPin(database, {
      pinKind: 'review_decision', ownerId: thread.id, slot: 'decision',
      snapshotRevision: 5, retentionClass: 'evidence',
    });

    document = move(database, document, 5);
    database.recordCanvasSnapshot(document, 'run-output-scalar-only');
    makeHostArtifactFixture(database, document, run);
    assert.equal(database.db.prepare(`
      SELECT canvas_revision FROM run_output_commits WHERE canvas_id = ?
    `).get(CANVAS_ID).canvas_revision, 6);

    document = move(database, document, 6);
    database.recordCanvasSnapshot(document, 'text-and-grant-scalars-only');
    const binding = createTextBinding(database, document);
    assert.ok(binding.binding);
    assert.deepEqual(database.db.prepare(`
      SELECT created_revision, revision FROM collaboration_text_documents
      WHERE project_id = ? AND canvas_id = ? AND target_entity_uid = ? AND field_name = 'prompt'
    `).get(PROJECT_ID, CANVAS_ID, NODE_UID), {
      created_revision: 7,
      revision: 7,
    });

    document = move(database, document, 7);
    const { patch, applied } = createPatch(database, document);
    document = applied.document;
    assert.equal(patch.baseRevision, 8);
    assert.equal(applied.revision, 9);
    assertPin(database, {
      pinKind: 'patch_applied', ownerId: patch.id, slot: 'applied',
      snapshotRevision: 9, retentionClass: 'evidence',
    });
    assert.equal(pinRows(database).some((row) => row.snapshotRevision === 8 && row.pinKind.startsWith('patch_')), false);

    const reverted = database.revertCanvasPatch(document.canvasId, patch.id, {
      actorId: 'snapshot-pin-capacity-writer',
      sessionId: 'snapshot-pin-capacity-session',
      expectedRevision: document.revision,
    });
    document = reverted.document;
    assert.equal(reverted.revision, 10);
    database._refreshCanvasSnapshotPins(CANVAS_ID);
    assert.equal(pinRows(database).some((row) => row.pinKind === 'patch_applied'), false);
    assert.equal(pinRows(database).some((row) => [8, 9, 10].includes(row.snapshotRevision)), false);

    document = move(database, document, 8);
    database.recordCanvasSnapshot(document, 'latest-window');
    document = move(database, document, 9);
    database.recordCanvasSnapshot(document, 'latest-window');
    document = move(database, document, 10);
    database.recordCanvasSnapshot(document, 'latest-window');
    assert.equal(document.revision, 13);

    database.db.prepare(`
      UPDATE canvas_resource_grant_state SET trusted_revision = 7
      WHERE project_id = ? AND canvas_id = ?
    `).run(PROJECT_ID, CANVAS_ID);
    assert.equal(database.db.prepare(`
      SELECT trusted_revision FROM canvas_resource_grant_state
      WHERE project_id = ? AND canvas_id = ?
    `).get(PROJECT_ID, CANVAS_ID).trusted_revision, 7);

    const patchRow = database.db.prepare(`
      SELECT base_revision, applied_revision, reverted_revision, status
      FROM canvas_patch_applications WHERE project_id = ? AND canvas_id = ? AND patch_id = ?
    `).get(PROJECT_ID, CANVAS_ID, PATCH_ID);
    assert.deepEqual(patchRow, {
      base_revision: 8,
      applied_revision: 9,
      reverted_revision: 10,
      status: 'reverted',
    });

    const compacted = compactToTwo(database);
    assert.equal(compacted.retentionLimit, 2);
    assert.deepEqual(pinRows(database).map((row) => ({
      revision: row.snapshotRevision,
      kind: row.pinKind,
      ownerId: row.ownerId,
      slot: row.slot,
      retentionClass: row.retentionClass,
    })), [
      { revision: 1, kind: 'recovery_anchor', ownerId: CANVAS_ID, slot: 'anchor', retentionClass: 'recovery' },
      { revision: 2, kind: 'run_intent', ownerId: intent.id, slot: 'canvas', retentionClass: 'operational' },
      { revision: 3, kind: 'run', ownerId: run.id, slot: 'canvas', retentionClass: 'operational' },
      { revision: 4, kind: 'review_source', ownerId: thread.id, slot: 'source', retentionClass: 'evidence' },
      { revision: 5, kind: 'review_decision', ownerId: thread.id, slot: 'decision', retentionClass: 'evidence' },
    ]);
    assert.deepEqual(snapshotRows(database).map((row) => row.revision), [1, 2, 3, 4, 5, 12, 13]);
    assert.deepEqual(
      snapshotRows(database).filter((row) => row.revision >= 6 && row.revision <= 11),
      [],
      'output/Text/grant/Patch base-applied-reverted scalars must not retain snapshots',
    );
    assertHistoryAccounting(database);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});

test('B2 terminal Runs retain execution history while releasing full-canvas snapshot pins', () => {
  const database = new ProjectDatabase(':memory:', databaseOptions({
    canvasSnapshotRetentionLimit: 2,
    canvasHistoryPolicy: { maxSnapshotRows: 4 },
  }));
  try {
    let document = seed(database, '-terminal-run-release');
    document = move(database, document, 1, 'terminal-run-release');
    const run = createActiveRun(database, document, 'snapshot-pin-terminal-run');
    const nodeRun = database.createNodeRun({
      runId: run.id,
      nodeId: NODE_ID,
      status: 'running',
      inputSnapshot: { prompt: '保留 Run 自身输入证据', upstreamNodes: [], incomingEdges: [] },
    });
    assert.equal(pinRows(database, document.canvasId).some((pin) => pin.pinKind === 'run' && pin.ownerId === run.id), true);

    database.updateNodeRun(nodeRun.id, { status: 'succeeded' });
    database.updateRun(run.id, { status: 'succeeded' });

    assert.equal(pinRows(database, document.canvasId).some((pin) => pin.pinKind === 'run' && pin.ownerId === run.id), false);
    assert.equal(database.getRun(run.id).status, 'succeeded');
    assert.deepEqual(database.getNodeRun(nodeRun.id).inputSnapshot, {
      prompt: '保留 Run 自身输入证据', upstreamNodes: [], incomingEdges: [],
    });

    for (let sequence = 2; sequence <= 8; sequence += 1) {
      document = move(database, document, sequence, 'terminal-run-release');
      database.recordCanvasSnapshot(document, 'terminal-run-release');
    }
    assert.ok(snapshotRows(database, document.canvasId).length <= 4);
    assert.equal(database.getRun(run.id).status, 'succeeded');
    assert.ok(database.getNodeRun(nodeRun.id));
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});

test('B2 many terminal Runs survive a small snapshot window without lowering Run retention', () => {
  const database = new ProjectDatabase(':memory:', databaseOptions({
    canvasSnapshotRetentionLimit: 2,
    canvasHistoryPolicy: { maxSnapshotRows: 4, maxPinRows: 100 },
  }));
  try {
    let document = seed(database, '-many-terminal-runs');
    const runIds = [];
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      document = move(database, document, sequence, 'many-terminal-runs');
      const run = createActiveRun(database, document, `snapshot-pin-terminal-run-${sequence}`);
      runIds.push(run.id);
      const nodeRun = database.createNodeRun({
        runId: run.id,
        nodeId: NODE_ID,
        status: 'succeeded',
        inputSnapshot: { sequence, upstreamNodes: [], incomingEdges: [] },
      });
      database.updateRun(run.id, { status: 'succeeded' });
      assert.equal(database.getNodeRun(nodeRun.id).inputSnapshot.sequence, sequence);
    }

    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count FROM runs WHERE project_id = ? AND canvas_id = ?
    `).get(document.projectId, document.canvasId).count, 12);
    assert.deepEqual(database.db.prepare(`
      SELECT id FROM runs WHERE project_id = ? AND canvas_id = ? ORDER BY created_at ASC, id ASC
    `).all(document.projectId, document.canvasId).map((row) => row.id).sort(), [...runIds].sort());
    assert.equal(pinRows(database, document.canvasId).some((pin) => pin.pinKind === 'run'), false);
    assert.ok(snapshotRows(database, document.canvasId).length <= 4);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});

test('B2 cold reopen upgrades terminal Run pins left by an older build without losing Run evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-b2-terminal-run-pin-upgrade-'));
  const filename = path.join(directory, 'projects.sqlite3');
  let database = null;
  try {
    database = new ProjectDatabase(filename, databaseOptions());
    let document = seed(database, '-terminal-pin-upgrade');
    document = move(database, document, 1, 'terminal-pin-upgrade');
    const run = createActiveRun(database, document, 'snapshot-pin-old-terminal-run');
    const nodeRun = database.createNodeRun({
      runId: run.id,
      nodeId: NODE_ID,
      status: 'succeeded',
      inputSnapshot: { prompt: '旧版本 Run 证据', upstreamNodes: [], incomingEdges: [] },
    });
    assert.equal(pinRows(database, document.canvasId).some((pin) => pin.ownerId === run.id), true);

    // Reproduce the exact durable state an older build could leave behind:
    // the Run is terminal, while its derived full-canvas pin still exists.
    database.db.prepare(`
      UPDATE runs SET status = 'succeeded', revision = revision + 1, finished_at = ? WHERE id = ?
    `).run(Date.now(), run.id);
    await database.close();
    database = null;

    database = new ProjectDatabase(filename, databaseOptions());
    assert.equal(database.getRun(run.id).status, 'succeeded');
    assert.equal(database.getNodeRun(nodeRun.id).inputSnapshot.prompt, '旧版本 Run 证据');
    assert.equal(pinRows(database, document.canvasId).some((pin) => pin.pinKind === 'run' && pin.ownerId === run.id), false);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    try { await database?.close(); } catch (_) {}
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('B2 maxPinRows boundary rejects an owner atomically with the stable 507 pin-capacity contract', () => {
  const database = new ProjectDatabase(':memory:', databaseOptions({
    canvasHistoryPolicy: { maxPinRows: 1 },
  }));
  const intentId = 'snapshot-pin-capacity-overflow-intent';
  try {
    let document = seed(database, '-pin-limit');
    document = move(database, document, 1, 'pin-limit');
    const canvasId = document.canvasId;
    const projectId = document.projectId;
    const before = {
      intentRows: Number(database.db.prepare('SELECT COUNT(*) AS count FROM run_intents WHERE id = ?').get(intentId).count),
      snapshots: snapshotRows(database, canvasId).map((row) => [row.revision, row.logicalBytes]),
      pins: pinRows(database, canvasId),
      usage: historyUsage(database, projectId, canvasId),
    };
    assert.equal(before.pins.length, 1, 'the recovery anchor consumes the exact pin-row boundary');

    assert.throws(
      () => createRunIntent(database, document, intentId),
      (error) => assertCapacityError(error, 'canvas_snapshot_pin_capacity_exceeded'),
    );
    assert.deepEqual({
      intentRows: Number(database.db.prepare('SELECT COUNT(*) AS count FROM run_intents WHERE id = ?').get(intentId).count),
      snapshots: snapshotRows(database, canvasId).map((row) => [row.revision, row.logicalBytes]),
      pins: pinRows(database, canvasId),
      usage: historyUsage(database, projectId, canvasId),
    }, before);
    assertHistoryAccounting(database, projectId, canvasId);
  } finally {
    database.close();
  }
});

test('B2 maxSnapshotRows accepts the exact boundary and rejects the next owner transaction atomically', () => {
  const database = new ProjectDatabase(':memory:', databaseOptions({
    canvasHistoryPolicy: {
      maxSnapshotRows: 2,
      maxSnapshotBytes: 64 * 1024 * 1024,
      maxPinRows: 3,
    },
  }));
  const runId = 'snapshot-row-capacity-overflow-run';
  try {
    let document = seed(database, '-row-limit');
    document = move(database, document, 1, 'row-limit');
    const intent = createRunIntent(database, document, 'snapshot-row-capacity-boundary-intent');
    const canvasId = document.canvasId;
    const projectId = document.projectId;
    assert.equal(intent.canvasRevision, 2);
    assert.deepEqual(snapshotRows(database, canvasId).map((row) => row.revision), [1, 2]);
    assert.equal(historyUsage(database, projectId, canvasId).snapshot_rows, 2);

    document = move(database, document, 2, 'row-limit');
    const before = {
      runRows: Number(database.db.prepare('SELECT COUNT(*) AS count FROM runs WHERE id = ?').get(runId).count),
      snapshots: snapshotRows(database, canvasId).map((row) => [row.revision, row.logicalBytes]),
      pins: pinRows(database, canvasId),
      usage: historyUsage(database, projectId, canvasId),
    };
    assert.throws(
      () => createActiveRun(database, document, runId),
      (error) => assertCapacityError(error, 'canvas_snapshot_capacity_exceeded'),
    );
    assert.deepEqual({
      runRows: Number(database.db.prepare('SELECT COUNT(*) AS count FROM runs WHERE id = ?').get(runId).count),
      snapshots: snapshotRows(database, canvasId).map((row) => [row.revision, row.logicalBytes]),
      pins: pinRows(database, canvasId),
      usage: historyUsage(database, projectId, canvasId),
    }, before);
    assert.equal(database.getRun(runId), null);
    assert.equal(database.getCanvas(canvasId).revision, 3, 'the earlier canvas mutation is outside the failed owner transaction');
    assertHistoryAccounting(database, projectId, canvasId);
  } finally {
    database.close();
  }
});

test('B2 snapshot bytes use exact UTF-8 accounting at limit and fail one byte over without partial owner state', () => {
  const probe = new ProjectDatabase(':memory:', databaseOptions());
  let exactBytes;
  try {
    let document = seed(probe, '-byte-limit');
    document = move(probe, document, 1, 'byte-limit');
    const firstSnapshotBytes = snapshotRows(probe, document.canvasId)[0].logicalBytes;
    const candidate = probe.db.prepare(`
      SELECT snapshot_json, length(CAST(snapshot_json AS BLOB)) AS logical_bytes
      FROM canvas_documents WHERE canvas_id = ?
    `).get(document.canvasId);
    exactBytes = firstSnapshotBytes + Number(candidate.logical_bytes);
    assert.equal(Number(candidate.logical_bytes), Buffer.byteLength(candidate.snapshot_json, 'utf8'));
    assert.ok(Number(candidate.logical_bytes) > candidate.snapshot_json.length, 'Unicode JSON must cost more UTF-8 bytes than JS code units');
  } finally {
    probe.close();
  }

  const exact = new ProjectDatabase(':memory:', databaseOptions({
    canvasHistoryPolicy: {
      maxSnapshotRows: 2,
      maxSnapshotBytes: exactBytes,
      maxPinRows: 2,
    },
  }));
  try {
    let document = seed(exact, '-byte-limit');
    document = move(exact, document, 1, 'byte-limit');
    const beforeInsertBytes = snapshotRows(exact, document.canvasId)[0].logicalBytes
      + Number(exact.db.prepare(`
        SELECT length(CAST(snapshot_json AS BLOB)) AS logical_bytes
        FROM canvas_documents WHERE canvas_id = ?
      `).get(document.canvasId).logical_bytes);
    assert.equal(beforeInsertBytes, exactBytes, 'deterministic fixture must hit the byte boundary exactly');
    createRunIntent(exact, document, 'snapshot-byte-capacity-exact-intent');
    const usage = assertHistoryAccounting(exact, document.projectId, document.canvasId);
    assert.equal(usage.snapshot_rows, 2);
    assert.equal(usage.snapshot_bytes, exactBytes);
    assert.equal(usage.pin_rows, 2);
    const stored = snapshotRows(exact, document.canvasId);
    assert.equal(
      stored.reduce((sum, row) => sum + Buffer.byteLength(row.snapshotJson, 'utf8'), 0),
      exactBytes,
    );
  } finally {
    exact.close();
  }

  const overflow = new ProjectDatabase(':memory:', databaseOptions({
    canvasHistoryPolicy: {
      maxSnapshotRows: 2,
      maxSnapshotBytes: exactBytes - 1,
      maxPinRows: 2,
    },
  }));
  const intentId = 'snapshot-byte-capacity-overflow-intent';
  try {
    let document = seed(overflow, '-byte-limit');
    document = move(overflow, document, 1, 'byte-limit');
    const canvasId = document.canvasId;
    const projectId = document.projectId;
    const candidateTotal = snapshotRows(overflow, canvasId)[0].logicalBytes
      + Number(overflow.db.prepare(`
        SELECT length(CAST(snapshot_json AS BLOB)) AS logical_bytes
        FROM canvas_documents WHERE canvas_id = ?
      `).get(canvasId).logical_bytes);
    assert.equal(candidateTotal, exactBytes);
    const before = {
      intentRows: Number(overflow.db.prepare('SELECT COUNT(*) AS count FROM run_intents WHERE id = ?').get(intentId).count),
      snapshots: snapshotRows(overflow, canvasId).map((row) => [row.revision, row.logicalBytes]),
      pins: pinRows(overflow, canvasId),
      usage: historyUsage(overflow, projectId, canvasId),
    };
    assert.throws(
      () => createRunIntent(overflow, document, intentId),
      (error) => assertCapacityError(error, 'canvas_snapshot_capacity_exceeded'),
    );
    assert.deepEqual({
      intentRows: Number(overflow.db.prepare('SELECT COUNT(*) AS count FROM run_intents WHERE id = ?').get(intentId).count),
      snapshots: snapshotRows(overflow, canvasId).map((row) => [row.revision, row.logicalBytes]),
      pins: pinRows(overflow, canvasId),
      usage: historyUsage(overflow, projectId, canvasId),
    }, before);
    assertHistoryAccounting(overflow, projectId, canvasId);
  } finally {
    overflow.close();
  }
});

test('B2 deleteCanvas removes explicit pins before cascading snapshot history', () => {
  const database = new ProjectDatabase(':memory:', databaseOptions());
  const suffix = '-delete';
  try {
    let document = seed(database, suffix);
    document = move(database, document, 1, 'delete');
    createRunIntent(database, document, 'snapshot-pin-delete-intent');
    const canvasId = document.canvasId;
    assert.ok(pinRows(database, canvasId).length >= 2);
    assert.ok(snapshotRows(database, canvasId).length >= 2);

    database.deleteCanvas(canvasId);

    assert.equal(database.getCanvas(canvasId), null);
    for (const tableName of [
      'canvas_snapshot_pins',
      'canvas_snapshots',
      'canvas_history_policies',
      'canvas_history_usage',
    ]) {
      assert.equal(database.db.prepare(`
        SELECT COUNT(*) AS count FROM ${tableName} WHERE canvas_id = ?
      `).get(canvasId).count, 0, `${tableName} must be removed with the canvas`);
    }
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    database.close();
  }
});

test('B2 migration preserves legacy owner pins above a new hard limit and enters over-capacity pressure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-b2-pin-over-capacity-migration-'));
  const filename = path.join(directory, 'projects.sqlite3');
  const suffix = '-migration-over-capacity';
  let database = null;
  try {
    database = new ProjectDatabase(filename, databaseOptions());
    let document = seed(database, suffix);
    document = move(database, document, 1, 'migration-over-capacity');
    const intent = createRunIntent(database, document, 'snapshot-pin-migration-over-capacity-intent');
    assert.equal(pinRows(database, document.canvasId).length, 2);
    await database.close();
    database = null;

    const legacy = new BetterSqlite3(filename);
    try {
      stripSchema31ForSchema30Test(legacy);
      legacy.exec(PROJECT_DATABASE_MIGRATION_30_DOWN_SQL);
      legacy.exec(PROJECT_DATABASE_MIGRATION_29_DOWN_SQL);
      legacy.prepare('DELETE FROM schema_migrations WHERE version = 30').run();
      legacy.prepare('DELETE FROM schema_migrations WHERE version = 29').run();
      assert.equal(legacy.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 28);
      assert.deepEqual(legacy.pragma('foreign_key_check'), []);
    } finally {
      legacy.close();
    }

    const constrainedOptions = databaseOptions({
      canvasHistoryPolicy: { maxPinRows: 1 },
    });
    database = new ProjectDatabase(filename, constrainedOptions);
    assert.equal(pinRows(database, document.canvasId).length, 2);
    assert.equal(historyUsage(database, document.projectId, document.canvasId).pin_rows, 2);
    assert.equal(database.db.prepare(`
      SELECT pressure_state FROM canvas_history_policies
      WHERE project_id = ? AND canvas_id = ?
    `).get(document.projectId, document.canvasId).pressure_state, 'over-capacity');
    assert.ok(database.getRunIntent(intent.id));
    await database.close();
    database = null;

    database = new ProjectDatabase(filename, constrainedOptions);
    assert.equal(pinRows(database, document.canvasId).length, 2);
    assert.equal(database.db.prepare(`
      SELECT pressure_state FROM canvas_history_policies
      WHERE project_id = ? AND canvas_id = ?
    `).get(document.projectId, document.canvasId).pressure_state, 'over-capacity');
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    try { await database?.close(); } catch (_) {}
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
