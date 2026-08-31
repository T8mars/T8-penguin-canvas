const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANVAS_PATCH_CONTRACT,
} = require('../backend/src/services/canvasPatch');
const {
  ProjectDatabase,
} = require('../backend/src/services/projectDatabase');

const PROJECT_ID = 'project-snapshot-retention-b2';
const CANVAS_ID = 'canvas-snapshot-retention-b2';

function seed(database) {
  return database.ensureCanvas(CANVAS_ID, {
    nodes: [{
      id: 'node-a',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { prompt: 'before-retention' },
    }],
    edges: [],
  }, PROJECT_ID);
}

function move(database, document, sequence) {
  return database.applyOperations(CANVAS_ID, [{
    opId: `snapshot-retention-move-${sequence}`,
    projectId: PROJECT_ID,
    canvasId: CANVAS_ID,
    actorId: 'snapshot-retention-writer',
    sessionId: 'snapshot-retention-session',
    clientSeq: sequence,
    baseRevision: document.revision,
    timestamp: 1_800_000_000_000 + sequence,
    type: 'node.move',
    payload: { nodeId: 'node-a', position: { x: sequence, y: sequence } },
  }], {
    expectedRevision: document.revision,
  }).document;
}

function revisions(database) {
  return database.db.prepare(`
    SELECT revision FROM canvas_snapshots
    WHERE canvas_id = ? ORDER BY revision ASC
  `).all(CANVAS_ID).map((row) => Number(row.revision));
}

function snapshotPins(database) {
  return database.db.prepare(`
    SELECT snapshot_revision AS revision, pin_kind AS kind,
           owner_id AS ownerId, slot, retention_class AS retentionClass
    FROM canvas_snapshot_pins
    WHERE project_id = ? AND canvas_id = ?
    ORDER BY snapshot_revision ASC, pin_kind ASC, owner_id ASC, slot ASC
  `).all(PROJECT_ID, CANVAS_ID).map((row) => ({
    ...row,
    revision: Number(row.revision),
  }));
}

function mutationState(database) {
  const count = (table) => Number(database.db.prepare(`
    SELECT COUNT(*) AS count FROM ${table} WHERE canvas_id = ?
  `).get(CANVAS_ID).count);
  return {
    document: database.getCanvas(CANVAS_ID),
    revisions: revisions(database),
    operations: count('canvas_operations'),
    idempotency: count('canvas_operation_idempotency'),
    patches: count('canvas_patch_applications'),
    provenance: count('canvas_mutation_provenance'),
    audits: count('audit_events'),
  };
}

test('B2 snapshot retention keeps active Run/Intent and durable Review/Patch consumers across cold reopen', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-b2-snapshot-retention-'));
  const filename = path.join(directory, 'projects.sqlite3');
  let database = null;
  try {
    database = new ProjectDatabase(filename, {
      autoBackup: false,
      canvasSnapshotRetentionLimit: 5,
    });
    let document = seed(database);

    document = move(database, document, 1);
    const run = database.createRun({
      id: 'snapshot-retention-run',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      canvasRevision: document.revision,
      initiatorId: 'snapshot-retention-writer',
    });
    const nodeRun = database.createNodeRun({
      id: 'snapshot-retention-node-run',
      runId: run.id,
      nodeId: 'node-a',
    });
    assert.equal(run.canvasRevision, 2);

    document = move(database, document, 2);
    const intent = database.createRunIntent({
      id: 'snapshot-retention-intent',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      canvasRevision: document.revision,
      nodeIds: ['node-a'],
      idempotencyKey: 'snapshot-retention-intent-key',
      requestedBy: 'snapshot-retention-writer',
    });
    assert.equal(intent.canvasRevision, 3);
    assert.deepEqual(database.db.prepare(`
      SELECT revision, reason FROM canvas_snapshots
      WHERE canvas_id = ? AND revision = ?
    `).get(CANVAS_ID, intent.canvasRevision), {
      revision: 3,
      reason: 'run-intent-bind',
    });

    document = move(database, document, 3);
    const thread = database.createReviewThread({
      id: 'snapshot-retention-thread',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      canvasRevision: document.revision,
      anchor: { kind: 'canvas', x: 0, y: 0 },
      createdBy: 'snapshot-retention-writer',
    });
    assert.equal(thread.canvasRevision, 4);

    document = move(database, document, 4);
    const decidedThread = database.updateReviewThread(thread.id, {
      expectedRevision: thread.revision,
      status: 'approved',
      decisionCanvasRevision: document.revision,
    });
    assert.equal(decidedThread.decisionCanvasRevision, 5);

    document = move(database, document, 5);
    const patch = {
      schema: CANVAS_PATCH_CONTRACT,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      baseRevision: document.revision,
      summary: 'snapshot retention patch',
      diagnosticsResolved: ['snapshot.retention'],
      requiresConfirmation: true,
      operations: [{
        opId: 'ignored-client-patch-operation',
        type: 'node.patch',
        payload: { nodeId: 'node-a', dataPatch: { prompt: 'after-retention-patch' } },
      }],
    };
    const preview = database.previewCanvasPatch(CANVAS_ID, patch, {
      actorId: 'snapshot-retention-writer',
    });
    const applied = database.applyCanvasPatch(CANVAS_ID, patch, {
      previewDigest: preview.previewDigest,
      confirmed: true,
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
    });
    document = applied.document;
    assert.equal(document.revision, 7);
    assert.deepEqual(database.db.prepare(`
      SELECT revision, reason FROM canvas_snapshots
      WHERE canvas_id = ? AND revision IN (?, ?)
      ORDER BY revision ASC
    `).all(CANVAS_ID, patch.baseRevision, applied.revision), [
      { revision: 6, reason: `patch-base:${patch.id}` },
      { revision: 7, reason: `patch:${patch.id}` },
    ]);

    for (let sequence = 6; sequence <= 14; sequence += 1) {
      document = move(database, document, sequence);
      database.recordCanvasSnapshot(document, 'retention-window');
    }
    assert.equal(document.revision, 16);
    assert.deepEqual(snapshotPins(database), [
      {
        revision: 1,
        kind: 'recovery_anchor',
        ownerId: CANVAS_ID,
        slot: 'anchor',
        retentionClass: 'recovery',
      },
      {
        revision: 2,
        kind: 'run',
        ownerId: run.id,
        slot: 'canvas',
        retentionClass: 'operational',
      },
      {
        revision: 3,
        kind: 'run_intent',
        ownerId: intent.id,
        slot: 'canvas',
        retentionClass: 'operational',
      },
      {
        revision: 4,
        kind: 'review_source',
        ownerId: thread.id,
        slot: 'source',
        retentionClass: 'evidence',
      },
      {
        revision: 5,
        kind: 'review_decision',
        ownerId: thread.id,
        slot: 'decision',
        retentionClass: 'evidence',
      },
      {
        revision: 7,
        kind: 'patch_applied',
        ownerId: patch.id,
        slot: 'applied',
        retentionClass: 'evidence',
      },
    ]);
    assert.deepEqual(revisions(database), [1, 2, 3, 4, 5, 7, 12, 13, 14, 15, 16]);
    assert.equal(
      database.db.prepare(`
        SELECT 1 FROM canvas_snapshots WHERE canvas_id = ? AND revision = ?
      `).get(CANVAS_ID, patch.baseRevision),
      undefined,
      'Patch base is a scalar, not a durable snapshot consumer',
    );
    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_idempotency
      WHERE canvas_id = ?
    `).get(CANVAS_ID).count, 15);
    assert.equal(database.resolveNodeRunSourceEntityUid(run.id, nodeRun.nodeId), nodeRun.nodeEntityUid);
    assert.equal(database.getCanvasSnapshotDocument(CANVAS_ID, thread.canvasRevision).revision, 4);
    assert.equal(
      database.getCanvasSnapshotDocument(CANVAS_ID, decidedThread.decisionCanvasRevision).revision,
      5,
    );

    const duplicatePatch = database.applyCanvasPatch(CANVAS_ID, patch, {
      previewDigest: preview.previewDigest,
      confirmed: true,
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
    });
    assert.equal(duplicatePatch.duplicate, true);
    assert.equal(duplicatePatch.revision, 7);
    assert.equal(
      duplicatePatch.document.nodes.find((node) => node.id === 'node-a').data.prompt,
      'after-retention-patch',
    );
    const currentRevision = document.revision;
    const replayedOldOperation = {
      opId: 'snapshot-retention-move-6',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
      clientSeq: 6,
      baseRevision: 7,
      timestamp: 1_800_000_000_006,
      type: 'node.move',
      payload: { nodeId: 'node-a', position: { x: 6, y: 6 } },
    };
    const oldReplay = database.applyOperations(CANVAS_ID, [replayedOldOperation], {
      expectedRevision: currentRevision,
    });
    assert.equal(oldReplay.acknowledgements[0].duplicate, true);
    assert.equal(oldReplay.document.revision, currentRevision);

    await database.close();
    database = null;
    database = new ProjectDatabase(filename, {
      autoBackup: false,
      canvasSnapshotRetentionLimit: 5,
    });
    assert.deepEqual(revisions(database), [1, 2, 3, 4, 5, 7, 12, 13, 14, 15, 16]);
    assert.equal(database.getCanvas(CANVAS_ID).revision, 16);
    assert.equal(snapshotPins(database).length, 5);
    assert.equal(database.getRun(run.id).status, 'interrupted');
    assert.equal(database.getNodeRun(nodeRun.id).nodeEntityUid, nodeRun.nodeEntityUid);
    const reopenedDuplicatePatch = database.applyCanvasPatch(CANVAS_ID, patch, {
      previewDigest: preview.previewDigest,
      confirmed: true,
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
    });
    assert.equal(reopenedDuplicatePatch.duplicate, true);
    assert.equal(reopenedDuplicatePatch.revision, 7);
    assert.equal(
      reopenedDuplicatePatch.document.nodes.find((node) => node.id === 'node-a').data.prompt,
      'after-retention-patch',
    );
    const reopenedOldReplay = database.applyOperations(CANVAS_ID, [replayedOldOperation], {
      expectedRevision: currentRevision,
    });
    assert.equal(reopenedOldReplay.acknowledgements[0].duplicate, true);
    assert.equal(reopenedOldReplay.document.revision, currentRevision);

    const reverted = database.revertCanvasPatch(CANVAS_ID, patch.id, {
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
      expectedRevision: currentRevision,
    });
    assert.equal(reverted.status, 'reverted');
    assert.equal(reverted.revision, 17);
    document = reverted.document;
    for (let sequence = 15; sequence <= 20; sequence += 1) {
      document = move(database, document, sequence);
      database.recordCanvasSnapshot(document, 'post-revert-compaction');
    }
    assert.equal(document.revision, 23);
    assert.equal(
      snapshotPins(database).some((pin) => pin.kind === 'patch_applied'),
      false,
      'a reverted Patch no longer owns its applied snapshot',
    );
    assert.deepEqual(revisions(database), [1, 3, 4, 5, 19, 20, 21, 22, 23]);
    assert.equal(
      database.db.prepare(`
        SELECT 1 FROM canvas_snapshots
        WHERE canvas_id = ? AND revision IN (?, ?, ?)
      `).get(CANVAS_ID, patch.baseRevision, applied.revision, reverted.revision),
      undefined,
      'Patch base/applied/reverted revisions are compactable once outside the latest window',
    );
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.db.pragma('foreign_key_check'), []);
  } finally {
    try { await database?.close(); } catch (_) {}
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('B2 snapshot insertion and retention delete roll back together when pruning fails', () => {
  const database = new ProjectDatabase(':memory:', {
    autoBackup: false,
    canvasSnapshotRetentionLimit: 2,
  });
  try {
    let document = seed(database);
    document = move(database, document, 1);
    database.recordCanvasSnapshot(document, 'retention-failure');
    const replayedOperation = {
      opId: 'snapshot-retention-move-1',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
      clientSeq: 1,
      baseRevision: 1,
      timestamp: 1_800_000_000_001,
      type: 'node.move',
      payload: { nodeId: 'node-a', position: { x: 1, y: 1 } },
    };
    document = move(database, document, 2);
    database.recordCanvasSnapshot(document, 'retention-failure');
    assert.deepEqual(revisions(database), [1, 2, 3]);

    database.db.exec(`
      CREATE TRIGGER b2_snapshot_retention_delete_failure
      BEFORE DELETE ON canvas_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'B2 forced snapshot retention failure');
      END;
    `);
    document = move(database, document, 3);
    assert.throws(
      () => database.recordCanvasSnapshot(document, 'retention-failure'),
      /B2 forced snapshot retention failure/,
    );
    assert.deepEqual(revisions(database), [1, 2, 3]);
    assert.equal(database.getCanvas(CANVAS_ID).revision, 4);
    assert.equal(database.db.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_idempotency
      WHERE canvas_id = ?
    `).get(CANVAS_ID).count, 3);

    database.db.exec('DROP TRIGGER b2_snapshot_retention_delete_failure');
    database.recordCanvasSnapshot(document, 'retention-failure-retry');
    assert.deepEqual(revisions(database), [1, 3, 4]);
    const replay = database.applyOperations(CANVAS_ID, [replayedOperation], {
      expectedRevision: document.revision,
    });
    assert.equal(replay.acknowledgements[0].duplicate, true);
    assert.equal(replay.document.revision, document.revision);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    database.close();
  }
});

test('B2 snapshot evidence is immutable, idempotent, and bound to the authoritative canvas head', () => {
  const database = new ProjectDatabase(':memory:', { autoBackup: false });
  try {
    const document = seed(database);
    const before = database.db.prepare(`
      SELECT project_id, reason, snapshot_json, created_at
      FROM canvas_snapshots WHERE canvas_id = ? AND revision = ?
    `).get(CANVAS_ID, document.revision);
    database.recordCanvasSnapshot(document, 'must-not-replace-existing-evidence');
    assert.deepEqual(database.db.prepare(`
      SELECT project_id, reason, snapshot_json, created_at
      FROM canvas_snapshots WHERE canvas_id = ? AND revision = ?
    `).get(CANVAS_ID, document.revision), before);

    assert.throws(
      () => database.recordCanvasSnapshot({ ...document, projectId: 'project-snapshot-forged' }, 'forged-project'),
      (error) => error?.code === 'canvas_snapshot_integrity_conflict',
    );
    assert.throws(
      () => database.recordCanvasSnapshot({ ...document, revision: document.revision + 1 }, 'future-revision'),
      (error) => error?.code === 'canvas_snapshot_integrity_conflict',
    );
    assert.deepEqual(database.db.prepare(`
      SELECT project_id, reason, snapshot_json, created_at
      FROM canvas_snapshots WHERE canvas_id = ? AND revision = ?
    `).get(CANVAS_ID, document.revision), before);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    database.close();
  }
});

test('B2 terminal Run history never pins a full canvas snapshot while Run pruning remains independent', () => {
  const database = new ProjectDatabase(':memory:', {
    autoBackup: false,
    canvasSnapshotRetentionLimit: 2,
  });
  try {
    let document = seed(database);
    document = move(database, document, 1);
    const run = database.createRun({
      id: 'snapshot-retention-pruned-run',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      canvasRevision: document.revision,
      initiatorId: 'snapshot-retention-writer',
      status: 'succeeded',
    });
    document = move(database, document, 2);
    database.recordCanvasSnapshot(document, 'run-prune-release');
    document = move(database, document, 3);
    database.recordCanvasSnapshot(document, 'run-prune-release');
    assert.deepEqual(revisions(database), [1, 3, 4]);

    database.db.prepare('UPDATE runs SET created_at = ? WHERE id = ?')
      .run(Date.now() - 3 * 24 * 60 * 60 * 1000, run.id);
    database.setRunRetentionPolicy(PROJECT_ID, {
      maxDays: 1,
      maxRuns: 100,
      keepReferenced: false,
    });
    const pruned = database.pruneRuns(PROJECT_ID);
    assert.equal(pruned.deletedRuns, 1);
    assert.equal(database.getRun(run.id), null);
    assert.deepEqual(revisions(database), [1, 3, 4]);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    database.close();
  }
});

test('B2 RunIntent snapshot and retention pruning commit atomically and terminal intents release their pin', () => {
  const database = new ProjectDatabase(':memory:', {
    autoBackup: false,
    canvasSnapshotRetentionLimit: 2,
  });
  try {
    let document = seed(database);
    document = move(database, document, 1);
    database.recordCanvasSnapshot(document, 'intent-atomicity');
    document = move(database, document, 2);
    database.recordCanvasSnapshot(document, 'intent-atomicity');
    document = move(database, document, 3);
    assert.deepEqual(revisions(database), [1, 2, 3]);

    database.db.exec(`
      CREATE TRIGGER b2_run_intent_snapshot_delete_failure
      BEFORE DELETE ON canvas_snapshots
      WHEN OLD.canvas_id = '${CANVAS_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'B2 forced RunIntent snapshot retention failure');
      END;
    `);
    const input = {
      id: 'snapshot-retention-atomic-intent',
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      canvasRevision: document.revision,
      nodeIds: ['node-a'],
      idempotencyKey: 'snapshot-retention-atomic-intent-key',
      requestedBy: 'snapshot-retention-writer',
    };
    assert.throws(
      () => database.createRunIntent(input),
      /B2 forced RunIntent snapshot retention failure/,
    );
    assert.equal(database.getRunIntent(input.id), null);
    assert.deepEqual(revisions(database), [1, 2, 3]);
    assert.equal(database.getCanvas(CANVAS_ID).revision, 4);

    database.db.exec('DROP TRIGGER b2_run_intent_snapshot_delete_failure');
    const intent = database.createRunIntent(input);
    assert.equal(intent.canvasRevision, 4);
    assert.deepEqual(revisions(database), [1, 3, 4]);
    database.updateRunIntent(intent.id, { status: 'completed' });
    document = move(database, document, 4);
    database.recordCanvasSnapshot(document, 'terminal-intent-release');
    document = move(database, document, 5);
    database.recordCanvasSnapshot(document, 'terminal-intent-release');
    assert.deepEqual(revisions(database), [1, 5, 6]);
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    database.close();
  }
});

test('B2 Patch application, applied pin and pruning share one atomic transaction and missing evidence fails closed', () => {
  const database = new ProjectDatabase(':memory:', {
    autoBackup: false,
    canvasSnapshotRetentionLimit: 2,
  });
  try {
    let document = seed(database);
    document = move(database, document, 1);
    database.recordCanvasSnapshot(document, 'patch-atomicity');
    document = move(database, document, 2);
    database.recordCanvasSnapshot(document, 'patch-atomicity');
    assert.deepEqual(revisions(database), [1, 2, 3]);

    const patch = {
      schema: CANVAS_PATCH_CONTRACT,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      baseRevision: document.revision,
      summary: 'snapshot retention atomic patch',
      diagnosticsResolved: ['snapshot.retention.atomicity'],
      requiresConfirmation: true,
      operations: [{
        opId: 'ignored-atomic-patch-operation',
        type: 'node.patch',
        payload: { nodeId: 'node-a', dataPatch: { prompt: 'atomic-patch-applied' } },
      }],
    };
    const preview = database.previewCanvasPatch(CANVAS_ID, patch, {
      actorId: 'snapshot-retention-writer',
    });
    const beforeFailure = mutationState(database);
    database.db.exec(`
      CREATE TRIGGER b2_patch_snapshot_delete_failure
      BEFORE DELETE ON canvas_snapshots
      WHEN OLD.canvas_id = '${CANVAS_ID}' AND OLD.revision = 2
      BEGIN
        SELECT RAISE(ABORT, 'B2 forced Patch snapshot retention failure');
      END;
    `);
    const apply = () => database.applyCanvasPatch(CANVAS_ID, patch, {
      previewDigest: preview.previewDigest,
      confirmed: true,
      actorId: 'snapshot-retention-writer',
      sessionId: 'snapshot-retention-session',
    });
    assert.throws(apply, /B2 forced Patch snapshot retention failure/);
    assert.deepEqual(mutationState(database), beforeFailure);
    assert.equal(database.db.prepare(`
      SELECT 1 FROM canvas_snapshots WHERE canvas_id = ? AND revision = 4
    `).get(CANVAS_ID), undefined);

    database.db.exec('DROP TRIGGER b2_patch_snapshot_delete_failure');
    const applied = apply();
    assert.equal(applied.revision, 4);
    assert.deepEqual(revisions(database), [1, 3, 4]);
    assert.deepEqual(database.db.prepare(`
      SELECT base_revision, applied_revision, status
      FROM canvas_patch_applications
      WHERE canvas_id = ? AND patch_id = ?
    `).get(CANVAS_ID, patch.id), {
      base_revision: 3,
      applied_revision: 4,
      status: 'applied',
    });
    const duplicate = apply();
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.revision, 4);

    assert.throws(
      () => database.db.prepare(`
        DELETE FROM canvas_snapshots WHERE canvas_id = ? AND revision = ?
      `).run(CANVAS_ID, applied.revision),
      (error) => error?.code === 'SQLITE_CONSTRAINT_TRIGGER',
      'the applied owner pin must reject direct evidence deletion',
    );
    assert.equal(database.db.prepare(`
      DELETE FROM canvas_snapshot_pins
      WHERE project_id = ? AND canvas_id = ?
        AND pin_kind = 'patch_applied' AND owner_id = ? AND slot = 'applied'
    `).run(PROJECT_ID, CANVAS_ID, patch.id).changes, 1);
    assert.equal(database.db.prepare(`
      DELETE FROM canvas_snapshots WHERE canvas_id = ? AND revision = ?
    `).run(CANVAS_ID, applied.revision).changes, 1);
    assert.throws(
      apply,
      (error) => error?.code === 'canvas_patch_snapshot_unavailable',
    );
    assert.equal(database.db.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    database.close();
  }
});
