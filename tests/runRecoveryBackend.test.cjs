const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
const { AssetIndexer } = require('../backend/src/services/assetIndexer');
const { stableEntityUuid } = require('../backend/src/collaboration/protocol');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const {
  RunRecoveryManager,
  normalizeRunRecoveryDescriptor,
  recoveryRequest,
} = require('../backend/src/services/runRecovery');

function createActiveRecovery(db, options = {}) {
  const nodeId = options.nodeId || 'async-node';
  const node = {
    id: nodeId,
    entityUid: stableEntityUuid('t8-run-recovery-test-node-v1', nodeId),
    entityRevision: 1,
    type: 'image',
    position: { x: 0, y: 0 },
    data: { seed: 1 },
  };
  let document = db.ensureCanvas('recovery-canvas', { nodes: [node], edges: [] }, 'recovery-project');
  if (!document.nodes.some((item) => item.id === nodeId)) {
    document = db.saveCanvasSnapshot('recovery-canvas', {
      ...document,
      nodes: [...document.nodes, node],
    }, { expectedRevision: document.revision });
  }
  const run = db.createRun({
    projectId: 'recovery-project',
    canvasId: 'recovery-canvas',
    canvasRevision: document.revision,
    status: 'running',
  });
  const nodeRun = db.createNodeRun({ runId: run.id, nodeId, status: 'polling' });
  const attempt = db.createAttempt({
    nodeRunId: nodeRun.id,
    provider: options.provider || 'seedance-nz',
    model: options.model || 'wan-2.7-spicy-i2v',
    upstreamTaskId: options.taskId || 'task-recovery-1',
    status: 'polling',
    pollCount: 2,
    metadata: options.metadata || {
      recovery: {
        kind: 'wan', taskId: options.taskId || 'task-recovery-1', model: 'wan-2.7-spicy-i2v',
        pollIntervalMs: 250, maxPolls: 4,
      },
    },
  });
  return { run, nodeRun, attempt };
}

function linkRunningIntent(db, run, suffix) {
  const intent = db.createRunIntent({
    projectId: run.projectId,
    canvasId: run.canvasId,
    canvasRevision: run.canvasRevision,
    idempotencyKey: `recovery-intent-${suffix}`,
    requestedBy: 'remote-editor',
    provider: 'seedance-nz',
    model: 'wan-2.7-spicy-i2v',
    estimatedCostKnown: false,
  });
  db.updateRunIntent(intent.id, { status: 'running', runId: run.id });
  return db.getRunIntent(intent.id);
}

test('recovery descriptors map only allowlisted kinds to fixed loopback routes', () => {
  const descriptor = normalizeRunRecoveryDescriptor({ kind: 'runninghub', taskId: 'task/a', site: 'intl', pollIntervalMs: 1, maxPolls: 99999 });
  assert.deepEqual(descriptor, {
    version: 1, kind: 'runninghub', taskId: 'task/a', taskIds: [], requestId: null,
    responseUrl: null, statusUrl: null, endpoint: null, model: null, site: 'intl', taskProvider: null,
    speed: null, pollIntervalMs: 250, maxPolls: 7200,
  });
  assert.deepEqual(recoveryRequest('http://127.0.0.1:18766', descriptor), {
    url: 'http://127.0.0.1:18766/api/proxy/runninghub/query?taskId=task%2Fa&site=intl',
    options: { method: 'GET' },
  });
  const hailuo = normalizeRunRecoveryDescriptor({ kind: 'hailuo', taskId: 'hailuo/task', model: 'hailuo-2.3-t2v-standard' });
  assert.deepEqual(recoveryRequest('http://127.0.0.1:18766', hailuo), {
    url: 'http://127.0.0.1:18766/api/proxy/video/hailuo/status/hailuo%2Ftask',
    options: { method: 'GET' },
  });
  const flux3 = normalizeRunRecoveryDescriptor({ kind: 'flux3', taskId: 'flux/task', model: 'flux-3-video-global-t2v' });
  assert.deepEqual(recoveryRequest('http://127.0.0.1:18766', flux3), {
    url: 'http://127.0.0.1:18766/api/proxy/video/flux3/status/flux%2Ftask',
    options: { method: 'GET' },
  });
  const kling = normalizeRunRecoveryDescriptor({ kind: 'kling', taskId: 'kling/task', model: 'kling-o3-pro-edit' });
  assert.deepEqual(recoveryRequest('http://127.0.0.1:18766', kling), {
    url: 'http://127.0.0.1:18766/api/proxy/video/kling/status/kling%2Ftask',
    options: { method: 'GET' },
  });
  const upscaler = normalizeRunRecoveryDescriptor({ kind: 'upscaler', taskId: 'upscaler/task', model: 'zhenzhen-upscaler' });
  assert.deepEqual(recoveryRequest('http://127.0.0.1:18766', upscaler), {
    url: 'http://127.0.0.1:18766/api/proxy/video/upscaler/status/upscaler%2Ftask',
    options: { method: 'GET' },
  });
  const vidu = normalizeRunRecoveryDescriptor({ kind: 'vidu', taskId: 'vidu/task', model: 'vidu-q3-turbo-t2v' });
  assert.deepEqual(recoveryRequest('http://127.0.0.1:18766', vidu), {
    url: 'http://127.0.0.1:18766/api/proxy/video/vidu/status/vidu%2Ftask',
    options: { method: 'GET' },
  });
  assert.equal(normalizeRunRecoveryDescriptor({ kind: 'http', taskId: 'x', url: 'https://evil.example' }), null);
  assert.equal(normalizeRunRecoveryDescriptor({ kind: 'video-fal', requestId: 'req-only' }), null);
});

test('restart keeps allowlisted provider polling recoverable and manager finishes the authoritative Run', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-run-recovery-host-artifact-'));
  const db = new ProjectDatabase(':memory:');
  try {
    const active = createActiveRecovery(db);
    const intent = linkRunningIntent(db, active.run, 'success');
    const prepared = db.recoverInterruptedRuns();
    assert.deepEqual(prepared, { runs: 0, nodeRuns: 0, attempts: 0, recoverableRuns: 1, recoverableNodeRuns: 1, recoverableAttempts: 1 });
    assert.equal(db.getRun(active.run.id).status, 'running');
    assert.equal(db.listPendingRunRecoveries().length, 1);
    const probes = [
      { state: 'pending', outputs: [], usage: { credits: 1 }, error: null, providerStatus: 'running' },
      { state: 'succeeded', outputs: [{ kind: 'text', sourceUrl: 'https://provider.example/recovered.txt', filename: 'recovered.txt' }], usage: { costUsd: 0.5, credits: 1 }, error: null, providerStatus: 'succeeded' },
    ];
    const committedOutputInputs = [];
    const broadcasts = { runs: [], nodes: [], outputs: [], intents: [] };
    const config = {
      INPUT_DIR: path.join(directory, 'input'),
      OUTPUT_DIR: path.join(directory, 'output'),
      ASSET_BLOB_DIR: path.join(directory, 'cas'),
      ASSET_INDEX_STABILITY_ATTEMPTS: 1,
    };
    fs.mkdirSync(config.INPUT_DIR, { recursive: true });
    fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
    const indexer = new AssetIndexer(config, db, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
      remoteMediaDownload: async (url, targetPath) => {
        const buffer = Buffer.from('recovered provider output');
        fs.writeFileSync(targetPath, buffer, { flag: 'wx', mode: 0o600 });
        return {
          contentType: 'text/plain',
          finalUrl: url,
          status: 200,
          byteSize: buffer.length,
        };
      },
    });
    const manager = new RunRecoveryManager({
      database: db,
      baseUrl: 'http://127.0.0.1:1',
      wait: async () => undefined,
      queryRecovery: async () => probes.shift(),
      commitRunOutputArtifacts: async (input) => {
        committedOutputInputs.push(input);
        return indexer.commitHostRunOutputAssets(input);
      },
      broadcast: {
        run: (run) => broadcasts.runs.push(run),
        node: (_run, nodeRun) => broadcasts.nodes.push(nodeRun),
        output: (_run, _nodeRun, assets) => broadcasts.outputs.push(...assets),
        intent: (value) => broadcasts.intents.push(value),
      },
    });
    const result = await manager.recoverPendingRuns();
    assert.equal(result.recovered, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.interrupted, 0);
    assert.equal(db.getRun(active.run.id).status, 'succeeded');
    assert.equal(db.getRun(active.run.id).summary.recoveredAfterRestart, true);
    assert.equal(db.getNodeRun(active.nodeRun.id).status, 'succeeded');
    assert.equal(db.getNodeRun(active.nodeRun.id).outputRefs.length, 1);
    assert.equal(db.getAttempt(active.attempt.id).status, 'succeeded');
    assert.equal(db.getAttempt(active.attempt.id).pollCount, 4);
    assert.equal(db.getAttempt(active.attempt.id).usage.costUsd, 0.5);
    assert.equal(db.getRunIntent(intent.id).status, 'completed');
    assert.equal(db.getRunIntent(intent.id).actualCost, 0.5);
    assert.equal(broadcasts.outputs.length, 1);
    assert.equal(committedOutputInputs.length, 1);
    assert.equal(committedOutputInputs[0].outputs[0].sourceUrl, 'https://provider.example/recovered.txt');
    assert.equal(committedOutputInputs[0].recoveryTerminal.runEntityUid, active.run.entityUid);
    assert.equal(committedOutputInputs[0].recoveryTerminal.nodeRunEntityUid, active.nodeRun.entityUid);
    assert.equal(committedOutputInputs[0].recoveryTerminal.attemptEntityUid, active.attempt.entityUid);
    assert.equal(broadcasts.runs.at(-1).status, 'succeeded');
    assert.equal(broadcasts.intents.at(-1).status, 'completed');
    const eventTypes = db.getRunEvents(active.run.id).map((event) => event.type);
    assert.equal(eventTypes.includes('provider.polling'), true);
    assert.equal(eventTypes.includes('node.output'), true);
    assert.equal(eventTypes.includes('node.succeeded'), true);
    assert.equal(eventTypes.includes('run.succeeded'), true);
    assert.equal(eventTypes.filter((type) => type === 'node.output').length, 1);
    assert.equal(eventTypes.filter((type) => type === 'provider.response').length, 1);
    assert.equal(eventTypes.filter((type) => type === 'node.succeeded').length, 1);
    assert.equal(eventTypes.filter((type) => type === 'run.succeeded').length, 1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM run_output_commits').get().count, 1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM collaboration_common_operation_batches').get().count, 1);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM collaboration_domain_operation_idempotency').get().count, 1);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='host.artifact.commit'").get().count, 1);
    assert.equal(fs.readdirSync(path.join(config.OUTPUT_DIR, '.host-artifact-staging')).length, 0);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('host artifact recovery and every terminal write share one rollback boundary and exact retry does not duplicate evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-run-recovery-artifact-atomic-'));
  let failBeforeComplete = true;
  const db = new ProjectDatabase(':memory:', {
    beforeRunRecoveryTerminalStep: ({ step }) => {
      if (failBeforeComplete && step === 'before-complete') throw new Error('forced-artifact-terminal-failure');
    },
  });
  try {
    const active = createActiveRecovery(db, { nodeId: 'artifact-terminal-atomic' });
    const intent = linkRunningIntent(db, active.run, 'artifact-terminal-atomic');
    const config = {
      INPUT_DIR: path.join(directory, 'input'),
      OUTPUT_DIR: path.join(directory, 'output'),
      ASSET_BLOB_DIR: path.join(directory, 'cas'),
      ASSET_INDEX_STABILITY_ATTEMPTS: 1,
    };
    fs.mkdirSync(config.INPUT_DIR, { recursive: true });
    fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(config.OUTPUT_DIR, 'atomic-recovered.txt'), 'atomic recovered artifact');
    const indexer = new AssetIndexer(config, db, {
      blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR),
    });
    const broadcasts = { runs: 0, nodes: 0, outputs: 0, intents: 0 };
    const manager = new RunRecoveryManager({
      database: db,
      baseUrl: 'http://127.0.0.1:1',
      commitRunOutputArtifacts: (input) => indexer.commitHostRunOutputAssets(input),
      broadcast: {
        run: () => { broadcasts.runs += 1; },
        node: () => { broadcasts.nodes += 1; },
        output: () => { broadcasts.outputs += 1; },
        intent: () => { broadcasts.intents += 1; },
      },
    });
    const outputs = [{
      kind: 'text',
      sourceUrl: '/files/output/atomic-recovered.txt',
      filename: 'atomic-recovered.txt',
    }];

    await assert.rejects(
      manager.succeedTicket(active, outputs, { costUsd: 0.25 }),
      /forced-artifact-terminal-failure/,
    );
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM run_output_commits').get().count, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM run_output_slot_reservations').get().count, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM collaboration_common_operation_batches').get().count, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM assets').get().count, 0);
    assert.equal(db.getRun(active.run.id).status, 'running');
    assert.equal(db.getNodeRun(active.nodeRun.id).status, 'polling');
    assert.equal(db.getNodeRun(active.nodeRun.id).outputRefs.length, 0);
    assert.equal(db.getAttempt(active.attempt.id).status, 'polling');
    assert.equal(db.getRunIntent(intent.id).status, 'running');
    assert.equal(db.getRunEvents(active.run.id).some((event) => event.type === 'node.output'), false);
    assert.deepEqual(broadcasts, { runs: 0, nodes: 0, outputs: 0, intents: 0 });

    failBeforeComplete = false;
    assert.equal(await manager.succeedTicket(active, outputs, { costUsd: 0.25 }), 'recovered');
    assert.equal(db.getRun(active.run.id).status, 'succeeded');
    assert.equal(db.getNodeRun(active.nodeRun.id).outputRefs.length, 1);
    assert.equal(db.getRunIntent(intent.id).actualCost, 0.25);
    const revisions = {
      run: db.getRun(active.run.id).revision,
      nodeRun: db.getNodeRun(active.nodeRun.id).revision,
      attempt: db.getAttempt(active.attempt.id).revision,
    };
    assert.equal(await manager.succeedTicket(active, outputs, { costUsd: 0.25 }), 'recovered');
    assert.deepEqual({
      run: db.getRun(active.run.id).revision,
      nodeRun: db.getNodeRun(active.nodeRun.id).revision,
      attempt: db.getAttempt(active.attempt.id).revision,
    }, revisions);
    const eventTypes = db.getRunEvents(active.run.id).map((event) => event.type);
    for (const type of ['node.output', 'provider.response', 'node.succeeded', 'run.succeeded']) {
      assert.equal(eventTypes.filter((item) => item === type).length, 1, `${type} must remain unique`);
    }
    assert.deepEqual(broadcasts, { runs: 1, nodes: 1, outputs: 1, intents: 1 });
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('startup interruption finishes the linked RunIntent in the same immediate transaction and rolls every write back on failure', () => {
  const db = new ProjectDatabase(':memory:');
  try {
    const active = createActiveRecovery(db, {
      nodeId: 'startup-unrecoverable',
      metadata: { lastProviderEvent: 'provider.polling' },
    });
    const intent = linkRunningIntent(db, active.run, 'startup-rollback');
    const finishRunIntentForRun = db.finishRunIntentForRun.bind(db);
    db.finishRunIntentForRun = (runId, ...args) => {
      if (runId === active.run.id) throw new Error('forced startup intent finish failure');
      return finishRunIntentForRun(runId, ...args);
    };

    assert.throws(() => db.recoverInterruptedRuns(), /forced startup intent finish failure/);
    assert.equal(db.getRun(active.run.id).status, 'running');
    assert.equal(db.getRun(active.run.id).finishedAt, null);
    assert.equal(db.getNodeRun(active.nodeRun.id).status, 'polling');
    assert.equal(db.getAttempt(active.attempt.id).status, 'polling');
    assert.equal(db.getRunIntent(intent.id).status, 'running');
    assert.equal(db.getRunEvents(active.run.id).some((event) => event.type === 'run.interrupted'), false);

    db.finishRunIntentForRun = finishRunIntentForRun;
    const recovered = db.recoverInterruptedRuns();
    assert.equal(recovered.runs, 1);
    assert.equal(db.getRun(active.run.id).status, 'interrupted');
    assert.equal(db.getNodeRun(active.nodeRun.id).status, 'interrupted');
    assert.equal(db.getAttempt(active.attempt.id).status, 'interrupted');
    assert.equal(db.getRunIntent(intent.id).status, 'failed');
    assert.equal(db.getExecutionUsage(active.run.projectId).activeCount, 0);
    assert.equal(
      db.getRunEvents(active.run.id).filter((event) => event.type === 'run.interrupted').length,
      1,
    );
  } finally {
    db.close();
  }
});

test('no-output recovery terminal rolls back every hierarchy write, survives reopen, and exact retry is event-idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-run-recovery-terminal-'));
  const filename = path.join(directory, 'projects.sqlite3');
  let failBeforeComplete = true;
  const db = new ProjectDatabase(filename, {
    autoBackup: false,
    beforeRunRecoveryTerminalStep: ({ step }) => {
      if (failBeforeComplete && step === 'before-complete') {
        throw new Error('forced recovery intent finish failure');
      }
    },
  });
  try {
    const active = createActiveRecovery(db, { nodeId: 'finalize-atomic' });
    const intent = linkRunningIntent(db, active.run, 'finalize-atomic');
    const terminal = {
      runId: active.run.id,
      runEntityUid: active.run.entityUid,
      nodeRunId: active.nodeRun.id,
      nodeRunEntityUid: active.nodeRun.entityUid,
      attemptId: active.attempt.id,
      attemptEntityUid: active.attempt.entityUid,
      status: 'succeeded',
      usage: { costUsd: 0.75 },
      finishedAt: 1234,
      recoveredAt: 1234,
    };

    assert.throws(() => db.completeRecoveredRunAttempt(terminal), /forced recovery intent finish failure/);
    assert.equal(db.getRun(active.run.id).status, 'running');
    assert.equal(db.getRun(active.run.id).finishedAt, null);
    assert.equal(db.getNodeRun(active.nodeRun.id).status, 'polling');
    assert.equal(db.getAttempt(active.attempt.id).status, 'polling');
    assert.equal(db.getRunIntent(intent.id).status, 'running');
    assert.equal(db.getRunEvents(active.run.id).some((event) => event.type === 'provider.response'), false);
    assert.equal(db.getRunEvents(active.run.id).some((event) => event.type === 'node.succeeded'), false);
    assert.equal(db.getRunEvents(active.run.id).some((event) => event.type === 'run.succeeded'), false);
    failBeforeComplete = false;
    db.close();

    const reopened = new ProjectDatabase(filename, { autoBackup: false });
    try {
      const completed = reopened.completeRecoveredRunAttempt(terminal);
      assert.equal(completed.duplicate, false);
      assert.equal(completed.finalized, true);
      assert.equal(completed.run.status, 'succeeded');
      assert.equal(completed.nodeRun.status, 'succeeded');
      assert.equal(completed.attempt.status, 'succeeded');
      assert.equal(completed.intent.status, 'completed');
      assert.equal(completed.intent.actualCost, 0.75);
      const revisions = {
        run: completed.run.revision,
        nodeRun: completed.nodeRun.revision,
        attempt: completed.attempt.revision,
      };
      const firstEvents = reopened.getRunEvents(active.run.id);
      assert.equal(firstEvents.filter((event) => event.type === 'provider.response').length, 1);
      assert.equal(firstEvents.filter((event) => event.type === 'node.succeeded').length, 1);
      assert.equal(firstEvents.filter((event) => event.type === 'run.succeeded').length, 1);

      const replay = reopened.completeRecoveredRunAttempt({
        ...terminal,
        finishedAt: 9999,
        recoveredAt: 9999,
      });
      assert.equal(replay.duplicate, true);
      assert.deepEqual({
        run: replay.run.revision,
        nodeRun: replay.nodeRun.revision,
        attempt: replay.attempt.revision,
      }, revisions);
      const replayEvents = reopened.getRunEvents(active.run.id);
      assert.equal(replayEvents.filter((event) => event.type === 'provider.response').length, 1);
      assert.equal(replayEvents.filter((event) => event.type === 'node.succeeded').length, 1);
      assert.equal(replayEvents.filter((event) => event.type === 'run.succeeded').length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    if (db.db?.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('restart archives unsupported or non-queryable tasks as interrupted instead of pretending to resume', async () => {
  const db = new ProjectDatabase(':memory:');
  try {
    const unsupported = createActiveRecovery(db, { nodeId: 'local-only', metadata: { lastProviderEvent: 'provider.polling' } });
    const prepared = db.recoverInterruptedRuns();
    assert.equal(prepared.runs, 1);
    assert.equal(db.getRun(unsupported.run.id).status, 'interrupted');
    assert.equal(db.getAttempt(unsupported.attempt.id).error.code, 'RUN_RECOVERY_UNAVAILABLE');

    const retryable = createActiveRecovery(db, { nodeId: 'expired-remote', taskId: 'expired-task' });
    db.recoverInterruptedRuns();
    const manager = new RunRecoveryManager({
      database: db,
      baseUrl: 'http://127.0.0.1:1',
      wait: async () => undefined,
      queryRecovery: async () => Object.assign(new Error('task not found'), { httpStatus: 404, retryable: false }),
    });
    manager.queryRecovery = async () => { throw Object.assign(new Error('task not found'), { httpStatus: 404, retryable: false }); };
    const result = await manager.recoverPendingRuns();
    assert.equal(result.interrupted, 1);
    assert.equal(db.getRun(retryable.run.id).status, 'interrupted');
    assert.equal(db.getAttempt(retryable.attempt.id).error.code, 'RUN_RECOVERY_UNAVAILABLE');
  } finally {
    db.close();
  }
});

test('startup defers Creator Agent tickets to the conversation-owned lazy recovery path', async () => {
  const db = new ProjectDatabase(':memory:');
  try {
    const active = createActiveRecovery(db, {
      nodeId: 'creator-agent-detached-action',
      taskId: 'creator-upstream-task-1',
      metadata: {
        creatorAgentV2: { version: 1, actionId: 'creator-action-1' },
        recovery: {
          kind: 'seedance',
          taskId: 'creator-upstream-task-1',
          taskProvider: 'seedance-nz',
          model: 'seedream-4.5',
        },
      },
    });
    const prepared = db.recoverInterruptedRuns();
    assert.equal(prepared.recoverableRuns, 1);
    assert.equal(db.listPendingRunRecoveries().length, 1);
    let probes = 0;
    const manager = new RunRecoveryManager({
      database: db,
      baseUrl: 'http://127.0.0.1:1',
      queryRecovery: async () => {
        probes += 1;
        throw new Error('Creator ticket must not enter generic provider recovery');
      },
    });
    const result = await manager.recoverPendingRuns();
    assert.equal(result.recovered, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.interrupted, 0);
    assert.equal(result.deferred, 1);
    assert.equal(probes, 0);
    assert.equal(db.getRun(active.run.id).status, 'running');
    assert.equal(db.getNodeRun(active.nodeRun.id).status, 'polling');
    assert.equal(db.getAttempt(active.attempt.id).status, 'polling');
    assert.equal(db.getAttempt(active.attempt.id).upstreamTaskId, 'creator-upstream-task-1');
  } finally {
    db.close();
  }
});

test('shutdown fences a signal-ignoring recovery probe before ProjectDatabase close', async () => {
  const db = new ProjectDatabase(':memory:');
  let releaseProbe;
  let markProbeStarted;
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
  const probeStarted = new Promise((resolve) => { markProbeStarted = resolve; });
  const broadcasts = [];
  try {
    createActiveRecovery(db, { taskId: 'shutdown-ignored-signal' });
    db.recoverInterruptedRuns();
    let receivedSignal = null;
    const manager = new RunRecoveryManager({
      database: db,
      baseUrl: 'http://127.0.0.1:1',
      queryRecovery: async (_descriptor, _ticket, _index, context) => {
        receivedSignal = context.signal;
        markProbeStarted();
        await probeGate; // Intentionally ignores AbortSignal.
        return { state: 'succeeded', outputs: [], usage: {}, providerStatus: 'succeeded' };
      },
      broadcast: {
        run: (value) => broadcasts.push(value),
        node: (value) => broadcasts.push(value),
        output: (value) => broadcasts.push(value),
        intent: (value) => broadcasts.push(value),
      },
    });
    const recovery = manager.recoverPendingRuns();
    await probeStarted;
    const shutdown = await manager.shutdown({ timeoutMs: 100 });
    assert.deepEqual(shutdown, { drained: false, forced: true });
    assert.equal(receivedSignal.aborted, true);

    await db.close();
    releaseProbe();
    const result = await recovery;
    assert.equal(result.status, 'stopped');
    assert.equal(result.deferred, 1);
    assert.equal(broadcasts.length, 1, 'only the pre-query polling broadcast may occur');
  } finally {
    releaseProbe();
    try { await db.close(); } catch (_) {}
  }
});

test('restart interrupts historical MV child recovery instead of terminalizing its parent Run', () => {
  const db = new ProjectDatabase(':memory:');
  try {
    const child = createActiveRecovery(db, {
      nodeId: 'mv-music-master-history',
      metadata: {
        mvChildAttempt: true,
        recovery: { kind: 'seedance', taskId: 'mv-child-task', taskProvider: 'seedance-nz' },
      },
    });
    const primary = db.createAttempt({
      nodeRunId: child.nodeRun.id,
      provider: 'mv-orchestrator',
      model: 'mv-music-master',
      status: 'running',
      metadata: { providerSubmission: { version: 1, slot: 'primary', state: 'prepared' } },
    });
    const prepared = db.recoverInterruptedRuns();
    assert.equal(prepared.recoverableRuns, 0);
    assert.equal(prepared.runs, 1);
    assert.equal(db.listPendingRunRecoveries().length, 0);
    assert.equal(db.getRun(child.run.id).status, 'interrupted');
    assert.equal(db.getNodeRun(child.nodeRun.id).status, 'interrupted');
    assert.equal(db.getAttempt(child.attempt.id).status, 'interrupted');
    assert.equal(db.getAttempt(primary.id).status, 'interrupted');
    const terminalTypes = db.getRunEvents(child.run.id).map((event) => event.type);
    assert.equal(terminalTypes.includes('run.succeeded'), false);
    assert.equal(terminalTypes.includes('node.succeeded'), false);
  } finally {
    db.close();
  }
});

test('recovery terminal write rejects an active sibling Attempt atomically', () => {
  const db = new ProjectDatabase(':memory:');
  try {
    const child = createActiveRecovery(db, { nodeId: 'mv-music-master-sibling', taskId: 'mv-child-task-2' });
    const primary = db.createAttempt({
      nodeRunId: child.nodeRun.id,
      provider: 'mv-orchestrator',
      model: 'mv-music-master',
      status: 'running',
    });
    assert.throws(() => db.completeRecoveredRunAttempt({
      runId: child.run.id,
      runEntityUid: child.run.entityUid,
      nodeRunId: child.nodeRun.id,
      nodeRunEntityUid: child.nodeRun.entityUid,
      attemptId: child.attempt.id,
      attemptEntityUid: child.attempt.entityUid,
      status: 'succeeded',
      usage: {},
      finishedAt: 1234,
      recoveredAt: 1234,
    }), (error) => error?.code === 'run_recovery_terminal_scope_invalid');
    assert.equal(db.getRun(child.run.id).status, 'running');
    assert.equal(db.getNodeRun(child.nodeRun.id).status, 'polling');
    assert.equal(db.getAttempt(child.attempt.id).status, 'polling');
    assert.equal(db.getAttempt(primary.id).status, 'running');
    const terminalTypes = db.getRunEvents(child.run.id).map((event) => event.type);
    assert.equal(terminalTypes.includes('provider.response'), false);
    assert.equal(terminalTypes.includes('node.succeeded'), false);
    assert.equal(terminalTypes.includes('run.succeeded'), false);
  } finally {
    db.close();
  }
});
