'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const creativeModelCatalog = require('../backend/src/shared/creativeModelCatalog.json');
const {
  CreatorActionExecutor,
  CreatorActionExecutorError,
  preflightActionReferences,
} = require('../backend/src/services/creatorActionExecutor.js');
const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository.js');

function pngBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

function mp4Bytes(marker = 1) {
  return Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, marker]);
}

test('Creator action executor records one real Run lineage and every returned image asset', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-action-'));
  const repository = new CreatorConversationRepository();
  const updates = { attempts: [], runs: [], nodeRuns: [], finished: [], createdNodeRun: null, createdAttempt: null };
  let sequence = 0;
  const database = {
    getCanvas: (canvasId) => canvasId === 'canvas-executor' ? { projectId: 'project-executor', canvasId, revision: 3 } : null,
    getAsset: () => null,
    createRunIntent: (input) => ({ ...input, id: 'intent-executor', queueRevision: 1 }),
    leaseRunIntentForDispatch: () => ({ intent: { id: 'intent-executor', queueRevision: 1 }, leaseToken: 'lease-executor' }),
    createRun: (input) => ({ ...input, id: 'run-executor' }),
    claimRunIntent: () => {},
    createNodeRun: (input) => {
      updates.createdNodeRun = input;
      return { ...input, id: 'node-run-executor' };
    },
    createAttempt: (input) => {
      updates.createdAttempt = input;
      return { ...input, id: 'attempt-executor' };
    },
    updateAttempt: (id, patch) => updates.attempts.push({ id, patch }),
    updateNodeRun: (id, patch) => updates.nodeRuns.push({ id, patch }),
    updateRun: (id, patch) => updates.runs.push({ id, patch }),
    finishRunIntentForRun: (id, status) => updates.finished.push({ id, status }),
  };
  const provider = {
    submitImageTask: async (input) => {
      assert.equal(input.model, 'zhenzhen-image-gk-v2');
      assert.equal(input.n, 2);
      return { taskId: 'upstream-executor', taskType: 'image' };
    },
    queryImageTask: async () => ({
      status: 'succeeded',
      imageUrl: 'https://assets.example.test/result-1.png',
      imageUrls: [
        'https://assets.example.test/result-1.png',
        'https://assets.example.test/result-2.png',
      ],
    }),
    fetchRemote: async () => new Response(pngBytes(), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(pngBytes().length) },
    }),
  };
  const assetIndexer = {
    recordRunOutputAssets: async ({ outputs }) => {
      sequence += 1;
      assert.equal(outputs.length, 2);
      assert.equal(outputs[0].metadata.workBinding.sceneId, 'scene-executor');
      outputs.forEach((output) => assert.ok(fs.existsSync(path.join(tempRoot, output.filename))));
      return {
        assets: outputs.map((output, index) => ({
          id: `asset-executor-${sequence}-${index + 1}`,
          projectId: 'project-executor',
          kind: 'image',
          filename: output.filename,
          contentHash: String(index + 1).repeat(64),
        })),
      };
    },
  };

  try {
    const conversation = repository.createConversation({ id: 'session-executor', projectId: 'project-executor', canvasId: 'canvas-executor' });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-executor' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '可以开始生成。',
      suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-executor',
        type: 'image',
        prompt: '雨夜车站电影海报',
        parameters: { ratio: '16:9', count: 2 },
        modelSnapshot: {
          kind: 'image',
          providerId: 'seedance-nz',
          modelId: 'zhenzhen-image-gk-v2',
          catalogDigest: creativeModelCatalog.sourceDigest,
        },
        workBinding: {
          schema: 't8-creator-scene-action-binding-v1', workId: 'work-executor',
          workRevision: 4, workDigest: 'a'.repeat(64), sceneId: 'scene-executor',
          scenePartId: null, sceneRevision: 2, contextDigest: 'b'.repeat(64),
        },
      },
    });
    repository.getLongScriptContextState = () => ({
      snapshot: { workId: 'work-executor', revision: 4 },
      work: {
        activeScenes: [{
          sceneId: 'scene-executor', recordRevision: 2, sourcePartCount: 0,
          sourceText: '雨夜车站。', sourceRef: { span: { start: 0, end: 5 } },
        }],
      },
    });
    const executor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: tempRoot },
      database,
      repository,
      provider,
      remoteMediaDownload: async (_url, target) => {
        const bytes = Buffer.concat([pngBytes(), Buffer.from([_url.includes('result-2') ? 2 : 1])]);
        fs.writeFileSync(target, bytes, { flag: 'wx' });
        return { contentType: 'image/png', finalUrl: _url, status: 200, byteSize: bytes.length };
      },
      assetIndexer,
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key-never-returned' }),
      pollIntervalMs: 100,
      timeoutMs: 30_000,
    });
    executor.start(conversation.id, 'action-executor', { projectId: 'project-executor', canvasId: 'canvas-executor' });
    await executor.wait('action-executor');
    const completed = repository.getAction('action-executor', conversation.id, { projectId: 'project-executor', canvasId: 'canvas-executor' });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.runIntentId, 'intent-executor');
    assert.equal(completed.runId, 'run-executor');
    assert.equal(completed.resultAssets.length, 2);
    assert.deepEqual(completed.resultAssets.map((asset) => asset.assetId), ['asset-executor-1-1', 'asset-executor-1-2']);
    assert.equal(completed.resultAssets[0].previewUrl, '/api/project-assets/asset-executor-1-1/media');
    assert.equal(JSON.stringify(completed).includes('upstream-executor'), false);
    assert.equal(repository.getConversation(conversation.id).conversation.phase, 'candidates');
    assert.equal(updates.finished.at(-1).status, 'succeeded');
    assert.equal(updates.createdNodeRun.inputSnapshot.workBinding.sceneId, 'scene-executor');
    assert.equal(updates.createdAttempt.metadata.workBinding.sceneId, 'scene-executor');
    assert.equal(updates.attempts.at(-1).patch.status, 'succeeded');
    assert.equal(updates.attempts.find((entry) => entry.patch.metadata?.recovery)?.patch.metadata.recovery.taskId, 'upstream-executor');
  } finally {
    repository.close();
    if (path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Creator five-shot batch preserves four videos and retry submits only the failed shot', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-five-shot-'));
  const repository = new CreatorConversationRepository();
  const state = {
    intentSequence: 0, runSequence: 0, nodeSequence: 0, attemptSequence: 0, assetSequence: 0,
    runs: new Map(), nodeRuns: new Map(), attempts: new Map(), assets: new Map(), finished: [],
  };
  const database = {
    getCanvas: () => ({ projectId: 'project-five-shot', canvasId: 'canvas-five-shot', revision: 7 }),
    getAsset: (assetId) => state.assets.get(assetId) || null,
    createRunIntent: (input) => ({ ...input, id: `intent-five-${++state.intentSequence}`, queueRevision: 1 }),
    leaseRunIntentForDispatch: ({ expectedIntentId }) => ({
      intent: { id: expectedIntentId, queueRevision: 1 }, leaseToken: `lease-${expectedIntentId}`,
    }),
    createRun: (input) => {
      const run = { ...input, id: `run-five-${++state.runSequence}` };
      state.runs.set(run.id, run);
      return run;
    },
    getRun: (runId) => state.runs.get(runId) || null,
    claimRunIntent: () => {},
    createNodeRun: (input) => {
      const nodeRun = { ...input, id: `node-five-${++state.nodeSequence}`, outputRefs: [] };
      state.nodeRuns.set(nodeRun.id, nodeRun);
      return nodeRun;
    },
    listNodeRuns: (runId) => [...state.nodeRuns.values()].filter((nodeRun) => nodeRun.runId === runId),
    createAttempt: (input) => {
      const attempt = { ...input, id: `attempt-five-${++state.attemptSequence}`, pollCount: 0 };
      state.attempts.set(attempt.id, attempt);
      return attempt;
    },
    listAttempts: (nodeRunId) => [...state.attempts.values()].filter((attempt) => attempt.nodeRunId === nodeRunId),
    updateAttempt: (attemptId, patch) => {
      const next = { ...state.attempts.get(attemptId), ...patch };
      state.attempts.set(attemptId, next);
      return next;
    },
    updateNodeRun: (nodeRunId, patch) => {
      const next = { ...state.nodeRuns.get(nodeRunId), ...patch };
      state.nodeRuns.set(nodeRunId, next);
      return next;
    },
    updateRun: (runId, patch) => {
      const next = { ...state.runs.get(runId), ...patch };
      state.runs.set(runId, next);
      return next;
    },
    finishRunIntentForRun: (runId, status) => state.finished.push({ runId, status }),
  };
  const submittedPrompts = [];
  let thirdShotFailedOnce = false;
  let secondShotInterruptedOnce = false;
  const provider = {
    submitHailuoTask: async (input) => {
      submittedPrompts.push(input.prompt);
      return { taskId: `task-${submittedPrompts.length}`, taskType: 'video' };
    },
    queryTask: async (taskId) => {
      const prompt = submittedPrompts[Number(taskId.slice('task-'.length)) - 1];
      if (prompt.includes('第 3 镜') && !thirdShotFailedOnce) {
        thirdShotFailedOnce = true;
        return { status: 'failed', failReason: '第三镜模拟失败' };
      }
      return { status: 'succeeded', videoUrl: `https://assets.example.test/${taskId}.mp4` };
    },
  };
  const assetIndexer = {
    recordRunOutputAssets: async ({ runId, nodeRunId, attemptId, outputs }) => ({
      assets: outputs.map((output) => {
        assert.ok(output.metadata.shotId);
        assert.ok(output.metadata.shotOrdinal >= 1 && output.metadata.shotOrdinal <= 5);
        const id = `asset-five-${++state.assetSequence}`;
        const asset = {
          id, projectId: 'project-five-shot', kind: 'video', filename: output.filename,
          contentHash: String(state.assetSequence % 10).repeat(64),
          runId, nodeRunId, attemptId,
        };
        state.assets.set(id, asset);
        return asset;
      }),
    }),
  };
  const scope = { projectId: 'project-five-shot', canvasId: 'canvas-five-shot' };
  try {
    const conversation = repository.createConversation({ id: 'session-five-shot', ...scope });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-five-shot' });
    const shots = Array.from({ length: 5 }, (_, index) => ({
      shotId: `shot_five_${index + 1}`,
      ordinal: index + 1,
      title: `镜头 ${index + 1}`,
      prompt: `雨夜站台第 ${index + 1} 镜。`,
      parameters: { ratio: '16:9', duration: 6, resolution: '768p' },
      inputAssetIds: [], status: 'pending', resultAssets: [],
    }));
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '按五个镜头生成。', suggestions: ['生成五镜', '换个视角', '锁定继续'],
      action: {
        id: 'action-five-shot', type: 'video', prompt: '雨夜站台五镜段落',
        parameters: { ratio: '16:9', duration: 6, resolution: '768p' },
        modelSnapshot: {
          kind: 'video', providerId: 'seedance-nz', modelId: 'hailuo-2.3-t2v-standard',
          catalogDigest: creativeModelCatalog.sourceDigest,
        },
        shots,
      },
    });
    const executor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: tempRoot }, database, repository, provider, assetIndexer,
      remoteMediaDownload: async (url, target) => {
        const bytes = mp4Bytes(Number(url.match(/task-(\d+)/)?.[1] || 1));
        fs.writeFileSync(target, bytes, { flag: 'wx' });
        return { contentType: 'video/mp4', finalUrl: url, status: 200, byteSize: bytes.length };
      },
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
      pollIntervalMs: 100,
      timeoutMs: 30_000,
      continuationRetryDelaysMs: [],
      faultInjector: (point, context) => {
        if (point === 'media-downloaded' && context.shotId === 'shot_five_2' && !secondShotInterruptedOnce) {
          secondShotInterruptedOnce = true;
          throw new Error('simulated process loss before Asset indexing');
        }
      },
    });

    executor.start(conversation.id, 'action-five-shot', scope);
    await executor.wait('action-five-shot');
    const interrupted = repository.getAction('action-five-shot', conversation.id, scope);
    assert.equal(interrupted.status, 'ambiguous');
    assert.equal(interrupted.errorCode, 'CREATOR_ACTION_PROCESS_INTERRUPTED');
    assert.deepEqual(interrupted.shots.map((shot) => shot.status), [
      'completed', 'ambiguous', 'pending', 'pending', 'pending',
    ]);
    assert.equal(submittedPrompts.length, 2);

    const restartedExecutor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: tempRoot }, database, repository, provider, assetIndexer,
      remoteMediaDownload: async (url, target) => {
        const bytes = mp4Bytes(Number(url.match(/task-(\d+)/)?.[1] || 1));
        fs.writeFileSync(target, bytes, { flag: 'wx' });
        return { contentType: 'video/mp4', finalUrl: url, status: 200, byteSize: bytes.length };
      },
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
      pollIntervalMs: 100,
      timeoutMs: 30_000,
      continuationRetryDelaysMs: [],
    });
    restartedExecutor.start(conversation.id, 'action-five-shot', scope);
    await restartedExecutor.wait('action-five-shot');
    const partial = repository.getAction('action-five-shot', conversation.id, scope);
    assert.equal(partial.status, 'failed');
    assert.equal(partial.errorCode, 'CREATOR_SHOT_BATCH_PARTIAL_FAILURE');
    assert.equal(partial.resultAssets.length, 4);
    assert.deepEqual(partial.shots.map((shot) => shot.status), [
      'completed', 'completed', 'failed', 'completed', 'completed',
    ]);
    assert.equal(submittedPrompts.length, 5);
    assert.equal(submittedPrompts.filter((prompt) => prompt.includes('第 2 镜')).length, 1,
      'restart after media download must continue the saved upstream task without resubmitting shot 2');
    assert.equal(state.nodeRuns.size, 5);
    assert.equal(state.attempts.size, 5);

    const retried = repository.retryFailedAction('action-five-shot', conversation.id, {
      clientRequestId: 'retry-third-shot-only',
    }, scope);
    assert.deepEqual(retried.shots.map((shot) => shot.status), [
      'completed', 'completed', 'pending', 'completed', 'completed',
    ]);
    restartedExecutor.start(conversation.id, retried.id, scope);
    await restartedExecutor.wait(retried.id);
    const completed = repository.getAction(retried.id, conversation.id, scope);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.resultAssets.length, 5);
    assert.ok(completed.shots.every((shot) => shot.status === 'completed'));
    assert.deepEqual(completed.shots.map((shot) => shot.shotId), shots.map((shot) => shot.shotId));
    assert.equal(submittedPrompts.length, 6, 'retry must submit only the one failed shot');
    assert.equal(submittedPrompts.at(-1), '雨夜站台第 3 镜。');
    assert.equal(state.nodeRuns.size, 6);
    assert.equal(state.attempts.size, 6);
    assert.equal(repository.getConversation(conversation.id).messages.at(-1).media.length, 5);
  } finally {
    repository.close();
    if (path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('Creator multi-image download interruption removes partial files after bounded quick retries', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-download-interrupt-'));
  const attempts = new Map();
  const executor = new CreatorActionExecutor({
    config: { OUTPUT_DIR: tempRoot },
    remoteMediaDownload: async (url, target) => {
      attempts.set(url, (attempts.get(url) || 0) + 1);
      if (url.endsWith('/second.png')) throw new Error('simulated interrupted transfer');
      fs.writeFileSync(target, Buffer.concat([pngBytes(), Buffer.from([1])]), { flag: 'wx' });
      return { contentType: 'image/png', finalUrl: url, status: 200, byteSize: pngBytes().length + 1 };
    },
  });
  try {
    await assert.rejects(
      executor.downloadResults([
        'https://assets.example.test/first.png',
        'https://assets.example.test/second.png',
      ], 'image', 'action-interrupted'),
      (error) => error?.code === 'CREATOR_RESULT_DOWNLOAD_FAILED',
    );
    assert.equal(attempts.get('https://assets.example.test/first.png'), 1);
    assert.equal(attempts.get('https://assets.example.test/second.png'), 3);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    if (path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Creator timeout stays recoverable and never resubmits or closes the original Run', async () => {
  const repository = new CreatorConversationRepository();
  const updates = { attempts: [], runs: [], nodeRuns: [], finished: [] };
  const database = {
    getCanvas: () => ({ projectId: 'project-timeout', canvasId: 'canvas-timeout', revision: 1 }),
    getAsset: () => null,
    createRunIntent: (input) => ({ ...input, id: 'intent-timeout', queueRevision: 1 }),
    leaseRunIntentForDispatch: () => ({ intent: { id: 'intent-timeout', queueRevision: 1 }, leaseToken: 'lease-timeout' }),
    createRun: (input) => ({ ...input, id: 'run-timeout' }),
    claimRunIntent: () => {},
    createNodeRun: (input) => ({ ...input, id: 'node-run-timeout' }),
    createAttempt: (input) => ({ ...input, id: 'attempt-timeout' }),
    updateAttempt: (id, patch) => { updates.attempts.push({ id, patch }); },
    updateNodeRun: (id, patch) => updates.nodeRuns.push({ id, patch }),
    updateRun: (id, patch) => updates.runs.push({ id, patch }),
    finishRunIntentForRun: (id, status) => updates.finished.push({ id, status }),
  };
  try {
    const conversation = repository.createConversation({ id: 'session-timeout', projectId: 'project-timeout', canvasId: 'canvas-timeout' });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-timeout' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '可以生成。',
      suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: { id: 'action-timeout', type: 'image', prompt: '雨夜车站', modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: creativeModelCatalog.sourceDigest } },
    });
    let submits = 0;
    const executor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: os.tmpdir() }, database, repository,
      provider: { submitImageTask: async () => { submits += 1; return { taskId: 'upstream-timeout', taskType: 'image' }; } },
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
    });
    executor.poll = async () => { throw new CreatorActionExecutorError('CREATOR_PROVIDER_TIMEOUT', '仍在生成', 504); };
    executor.start(conversation.id, 'action-timeout', { projectId: 'project-timeout', canvasId: 'canvas-timeout' });
    await executor.wait('action-timeout');
    assert.equal(submits, 1);
    assert.equal(repository.getAction('action-timeout', conversation.id).status, 'ambiguous');
    assert.equal(updates.attempts.at(-1).patch.status, 'polling');
    assert.equal(updates.nodeRuns.length, 0);
    assert.equal(updates.runs.length, 0);
    assert.equal(updates.finished.length, 0);
  } finally { repository.close(); }
});

test('Creator freezes an uncertain remote submission across restart instead of submitting twice', async () => {
  const repository = new CreatorConversationRepository();
  const state = { attempt: null };
  const database = {
    getCanvas: () => ({ projectId: 'project-submit-unknown', canvasId: 'canvas-submit-unknown', revision: 1 }),
    getAsset: () => null,
    createRunIntent: (input) => ({ ...input, id: 'intent-submit-unknown', queueRevision: 1 }),
    leaseRunIntentForDispatch: () => ({ intent: { id: 'intent-submit-unknown', queueRevision: 1 }, leaseToken: 'lease-submit-unknown' }),
    createRun: (input) => ({ ...input, id: 'run-submit-unknown' }),
    claimRunIntent: () => {},
    createNodeRun: (input) => ({ ...input, id: 'node-run-submit-unknown' }),
    createAttempt: (input) => {
      state.attempt = { ...input, id: 'attempt-submit-unknown' };
      return state.attempt;
    },
    updateAttempt: (_id, patch) => {
      state.attempt = { ...state.attempt, ...patch };
      return state.attempt;
    },
    updateNodeRun: () => { throw new Error('an uncertain submission must not close the NodeRun'); },
    updateRun: () => { throw new Error('an uncertain submission must not close the Run'); },
    finishRunIntentForRun: () => { throw new Error('an uncertain submission must not close the RunIntent'); },
  };
  let submits = 0;
  const provider = {
    submitImageTask: async () => {
      submits += 1;
      return { taskId: 'upstream-submit-unknown', taskType: 'image' };
    },
  };
  const scope = { projectId: 'project-submit-unknown', canvasId: 'canvas-submit-unknown' };
  try {
    const conversation = repository.createConversation({ id: 'session-submit-unknown', ...scope });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-submit-unknown' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '可以生成。', suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-submit-unknown', type: 'image', prompt: '雨夜车站',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: creativeModelCatalog.sourceDigest },
      },
    });
    const firstExecutor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: os.tmpdir() },
      database,
      repository,
      provider,
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
      faultInjector: (point) => {
        if (point === 'provider-submitted') throw new Error('simulated process loss after remote acceptance');
      },
    });
    firstExecutor.start(conversation.id, 'action-submit-unknown', scope);
    await firstExecutor.wait('action-submit-unknown');

    const uncertain = repository.getAction('action-submit-unknown', conversation.id, scope);
    assert.equal(uncertain.status, 'ambiguous');
    assert.equal(uncertain.errorCode, 'CREATOR_SUBMISSION_STATUS_UNKNOWN');
    assert.equal(submits, 1);
    assert.equal(state.attempt.status, 'polling');
    assert.equal(state.attempt.error.retryable, false);

    const restartedExecutor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: os.tmpdir() }, database, repository, provider,
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
    });
    const recovered = await restartedExecutor.start(conversation.id, 'action-submit-unknown', scope);
    assert.equal(recovered.status, 'ambiguous');
    assert.equal(recovered.errorCode, 'CREATOR_SUBMISSION_STATUS_UNKNOWN');
    assert.equal(submits, 1, 'restart must never turn an uncertain remote acceptance into a second billable submission');
  } finally {
    repository.close();
  }
});

test('Creator freezes one uncertain shot without submitting it or later shots twice after restart', async () => {
  const repository = new CreatorConversationRepository();
  const state = { run: null, nodeRun: null, attempt: null };
  const database = {
    getCanvas: () => ({ projectId: 'project-shot-unknown', canvasId: 'canvas-shot-unknown', revision: 1 }),
    getAsset: () => null,
    createRunIntent: (input) => ({ ...input, id: 'intent-shot-unknown', queueRevision: 1 }),
    leaseRunIntentForDispatch: () => ({ intent: { id: 'intent-shot-unknown', queueRevision: 1 }, leaseToken: 'lease-shot-unknown' }),
    createRun: (input) => { state.run = { ...input, id: 'run-shot-unknown' }; return state.run; },
    getRun: () => state.run,
    claimRunIntent: () => {},
    createNodeRun: (input) => { state.nodeRun = { ...input, id: 'node-shot-unknown' }; return state.nodeRun; },
    listNodeRuns: () => state.nodeRun ? [state.nodeRun] : [],
    createAttempt: (input) => { state.attempt = { ...input, id: 'attempt-shot-unknown', pollCount: 0 }; return state.attempt; },
    listAttempts: () => state.attempt ? [state.attempt] : [],
    updateAttempt: (_id, patch) => { state.attempt = { ...state.attempt, ...patch }; return state.attempt; },
    updateNodeRun: () => { throw new Error('unknown submission must not close its NodeRun'); },
    updateRun: () => { throw new Error('unknown submission must not close its Run'); },
    finishRunIntentForRun: () => { throw new Error('unknown submission must not finish its RunIntent'); },
  };
  let submits = 0;
  const provider = {
    submitImageTask: async () => {
      submits += 1;
      return { taskId: 'upstream-shot-unknown', taskType: 'image' };
    },
  };
  const scope = { projectId: 'project-shot-unknown', canvasId: 'canvas-shot-unknown' };
  try {
    const conversation = repository.createConversation({ id: 'session-shot-unknown', ...scope });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-shot-unknown' });
    const shots = [1, 2].map((ordinal) => ({
      shotId: `shot_unknown_${ordinal}`, ordinal, title: `镜头 ${ordinal}`,
      prompt: `雨夜站台第 ${ordinal} 镜。`, parameters: { ratio: '16:9', count: 1 },
      inputAssetIds: [], status: 'pending', resultAssets: [],
    }));
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '准备两镜。', suggestions: ['生成两镜', '换个构图', '锁定继续'],
      action: {
        id: 'action-shot-unknown', type: 'image', prompt: '雨夜站台两镜',
        parameters: { ratio: '16:9', count: 1 }, shots,
        modelSnapshot: {
          kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2',
          catalogDigest: creativeModelCatalog.sourceDigest,
        },
      },
    });
    const firstExecutor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: os.tmpdir() }, database, repository, provider,
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
      faultInjector: (point) => {
        if (point === 'provider-submitted') throw new Error('simulated process loss after remote acceptance');
      },
    });
    firstExecutor.start(conversation.id, 'action-shot-unknown', scope);
    await firstExecutor.wait('action-shot-unknown');
    const uncertain = repository.getAction('action-shot-unknown', conversation.id, scope);
    assert.equal(uncertain.status, 'ambiguous');
    assert.equal(uncertain.errorCode, 'CREATOR_SUBMISSION_STATUS_UNKNOWN');
    assert.deepEqual(uncertain.shots.map((shot) => shot.status), ['ambiguous', 'pending']);
    assert.equal(state.attempt.error.retryable, false);
    assert.equal(submits, 1);

    const restartedExecutor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: os.tmpdir() }, database, repository, provider,
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
    });
    const restarted = restartedExecutor.start(conversation.id, 'action-shot-unknown', scope);
    assert.equal(restarted.status, 'ambiguous');
    assert.equal(restarted.errorCode, 'CREATOR_SUBMISSION_STATUS_UNKNOWN');
    assert.equal(submits, 1);
  } finally {
    repository.close();
  }
});

test('Creator retries a completed task download from the original upstream task without resubmitting generation', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-download-resume-'));
  const repository = new CreatorConversationRepository();
  const state = { run: null, nodeRun: null, attempt: null };
  const database = {
    getCanvas: () => ({ projectId: 'project-download-resume', canvasId: 'canvas-download-resume', revision: 1 }),
    getAsset: () => null,
    createRunIntent: (input) => ({ ...input, id: 'intent-download-resume', queueRevision: 1 }),
    leaseRunIntentForDispatch: () => ({ intent: { id: 'intent-download-resume', queueRevision: 1 }, leaseToken: 'lease-download-resume' }),
    createRun: (input) => { state.run = { ...input, id: 'run-download-resume' }; return state.run; },
    getRun: () => state.run,
    claimRunIntent: () => {},
    createNodeRun: (input) => { state.nodeRun = { ...input, id: 'node-run-download-resume', outputRefs: [] }; return state.nodeRun; },
    listNodeRuns: () => state.nodeRun ? [state.nodeRun] : [],
    createAttempt: (input) => { state.attempt = { ...input, id: 'attempt-download-resume', pollCount: 0 }; return state.attempt; },
    listAttempts: () => state.attempt ? [state.attempt] : [],
    updateAttempt: (_id, patch) => { state.attempt = { ...state.attempt, ...patch }; return state.attempt; },
    updateNodeRun: (_id, patch) => { state.nodeRun = { ...state.nodeRun, ...patch }; return state.nodeRun; },
    updateRun: (_id, patch) => { state.run = { ...state.run, ...patch }; return state.run; },
    finishRunIntentForRun: () => {},
  };
  let submits = 0;
  const queriedTaskIds = [];
  let downloadAttempts = 0;
  try {
    const conversation = repository.createConversation({
      id: 'session-download-resume', projectId: 'project-download-resume', canvasId: 'canvas-download-resume',
    });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-download-resume' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '可以生成。', suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-download-resume', type: 'image', prompt: '雨夜车站',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: creativeModelCatalog.sourceDigest },
      },
    });
    const executor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: tempRoot },
      database,
      repository,
      provider: {
        submitImageTask: async () => { submits += 1; return { taskId: 'upstream-download-resume', taskType: 'image' }; },
        queryImageTask: async (taskId) => {
          queriedTaskIds.push(taskId);
          return { status: 'succeeded', imageUrl: 'https://assets.example.test/download-resume.png' };
        },
      },
      remoteMediaDownload: async (_url, target) => {
        downloadAttempts += 1;
        if (downloadAttempts <= 3) throw new Error('simulated temporary download outage');
        fs.writeFileSync(target, pngBytes(), { flag: 'wx' });
        return { contentType: 'image/png', byteSize: pngBytes().length, finalUrl: _url, status: 200 };
      },
      assetIndexer: {
        recordRunOutputAssets: async ({ outputs }) => ({
          assets: [{ id: 'asset-download-resume', kind: 'image', filename: outputs[0].filename, contentHash: 'c'.repeat(64) }],
        }),
      },
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
      pollIntervalMs: 100,
      continuationRetryDelaysMs: [100],
    });

    executor.start(conversation.id, 'action-download-resume', {
      projectId: 'project-download-resume', canvasId: 'canvas-download-resume',
    });
    await executor.wait('action-download-resume');
    assert.equal(repository.getAction('action-download-resume', conversation.id).status, 'ambiguous');
    assert.equal(state.run.status, 'running');
    assert.equal(state.nodeRun.status, 'running');
    assert.equal(state.attempt.status, 'polling');
    assert.equal(submits, 1);

    const deadline = Date.now() + 2_000;
    while (repository.getAction('action-download-resume', conversation.id).status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(submits, 1, 'download recovery must not create a second billable generation');
    assert.deepEqual(queriedTaskIds, ['upstream-download-resume', 'upstream-download-resume']);
    assert.equal(repository.getAction('action-download-resume', conversation.id).status, 'completed');
    assert.equal(repository.getConversation(conversation.id).conversation.phase, 'candidates');
    assert.equal(state.run.status, 'succeeded');
    assert.equal(state.run.summary.recoveredWithoutResubmit, true);
  } finally {
    repository.close();
    if (path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Creator ambiguous action resumes the original upstream task without another submit', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-resume-'));
  const repository = new CreatorConversationRepository();
  const state = {
    run: { id: 'run-resume', status: 'running', summary: {} },
    nodeRun: { id: 'node-run-resume', runId: 'run-resume', status: 'running', inputSnapshot: { actionId: 'action-resume' }, outputRefs: [] },
    attempt: { id: 'attempt-resume', nodeRunId: 'node-run-resume', status: 'polling', upstreamTaskId: 'upstream-resume', pollCount: 4 },
  };
  const database = {
    getRun: () => state.run,
    listNodeRuns: () => [state.nodeRun],
    listAttempts: () => [state.attempt],
    getAsset: () => null,
    updateAttempt: (_id, patch) => { state.attempt = { ...state.attempt, ...patch }; return state.attempt; },
    updateNodeRun: (_id, patch) => { state.nodeRun = { ...state.nodeRun, ...patch }; return state.nodeRun; },
    updateRun: (_id, patch) => { state.run = { ...state.run, ...patch }; return state.run; },
    finishRunIntentForRun: () => {},
  };
  let queriedTaskId = '';
  let submitted = 0;
  try {
    const conversation = repository.createConversation({ id: 'session-resume', projectId: 'project-resume', canvasId: 'canvas-resume' });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-resume' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '继续原任务。', suggestions: ['继续', '调整', '完成'],
      action: { id: 'action-resume', type: 'image', prompt: '雨夜车站', modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: creativeModelCatalog.sourceDigest } },
    });
    repository.updateAction('action-resume', conversation.id, { status: 'ambiguous', runIntentId: 'intent-resume', runId: 'run-resume' });
    const executor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: tempRoot }, database, repository,
      provider: {
        submitImageTask: async () => { submitted += 1; throw new Error('must not submit'); },
        queryImageTask: async (taskId) => { queriedTaskId = taskId; return { status: 'succeeded', imageUrl: 'https://assets.example.test/resume.png' }; },
      },
      remoteMediaDownload: async (_url, target) => { fs.writeFileSync(target, pngBytes(), { flag: 'wx' }); return { contentType: 'image/png', byteSize: pngBytes().length, finalUrl: _url, status: 200 }; },
      assetIndexer: { recordRunOutputAssets: async ({ outputs }) => ({ assets: [{ id: 'asset-resume', kind: 'image', filename: outputs[0].filename, contentHash: 'b'.repeat(64) }] }) },
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
      pollIntervalMs: 100,
    });
    executor.start(conversation.id, 'action-resume', { projectId: 'project-resume', canvasId: 'canvas-resume' });
    await executor.wait('action-resume');
    assert.equal(submitted, 0);
    assert.equal(queriedTaskId, 'upstream-resume');
    assert.equal(repository.getAction('action-resume', conversation.id).status, 'completed');
    assert.equal(state.run.summary.recoveredWithoutResubmit, true);
  } finally {
    repository.close();
    if (path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Creator compiles every Seedance 2.5 multimodal reference without truncating images, video, or audio', async () => {
  let submitted = null;
  const executor = new CreatorActionExecutor({
    provider: {
      submitTask: async (request) => {
        submitted = request;
        return { taskId: 'seedance25-multi-task', taskType: 'multi' };
      },
    },
  });
  const action = {
    type: 'video',
    prompt: '保持人物与声音连续，推进当前镜头。',
    parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
    modelSnapshot: {
      kind: 'video', providerId: 'seedance-nz', modelId: 'seedance-2.5-standard-multi',
      catalogDigest: creativeModelCatalog.sourceDigest,
    },
  };
  const modelEntry = creativeModelCatalog.video.find((item) => item.model === action.modelSnapshot.modelId);
  const inputPaths = [
    { kind: 'image', source: 'C:\\refs\\character.png' },
    { kind: 'image', source: 'C:\\refs\\location.png' },
    { kind: 'video', source: 'C:\\refs\\movement.mp4' },
    { kind: 'audio', source: 'C:\\refs\\voice.wav' },
  ];

  await executor.submit(action, 'test-key', {}, inputPaths, modelEntry);
  assert.deepEqual(submitted.refImages, inputPaths.slice(0, 2).map((item) => item.source));
  assert.deepEqual(submitted.videos, [inputPaths[2].source]);
  assert.deepEqual(submitted.audios, [inputPaths[3].source]);
  assert.equal(Object.hasOwn(submitted, 'firstFrame'), false);
});

test('Creator dispatches H3 multimodal inputs to the Hailuo compiler and preserves every reference', async () => {
  let submitted = null;
  let genericCalls = 0;
  const executor = new CreatorActionExecutor({
    provider: {
      submitHailuoTask: async (request) => {
        submitted = request;
        return { taskId: 'hailuo-multi-task', taskType: 'multi' };
      },
      submitTask: async () => { genericCalls += 1; throw new Error('wrong compiler'); },
    },
  });
  const action = {
    type: 'video',
    prompt: '维持人物、动作与对白连续。',
    parameters: { ratio: '16:9', duration: 5, resolution: '768P' },
    modelSnapshot: {
      kind: 'video', providerId: 'seedance-nz', modelId: 'hailuo-h3-multi',
      catalogDigest: creativeModelCatalog.sourceDigest,
    },
  };
  const modelEntry = creativeModelCatalog.video.find((item) => item.model === action.modelSnapshot.modelId);
  const inputPaths = [
    { kind: 'image', source: 'C:\\refs\\face.png' },
    { kind: 'image', source: 'C:\\refs\\coat.png' },
    { kind: 'video', source: 'C:\\refs\\motion.mp4' },
    { kind: 'audio', source: 'C:\\refs\\dialogue.wav' },
  ];

  await executor.submit(action, 'test-key', {}, inputPaths, modelEntry);
  assert.equal(genericCalls, 0);
  assert.deepEqual(submitted.images, inputPaths.slice(0, 2).map((item) => item.source));
  assert.deepEqual(submitted.videos, [inputPaths[2].source]);
  assert.deepEqual(submitted.audios, [inputPaths[3].source]);
});

test('Creator blocks a lossy model switch before Provider submission instead of dropping references', () => {
  const action = {
    type: 'video',
    modelSnapshot: {
      kind: 'video', providerId: 'seedance-nz', modelId: 'hailuo-h3-i2v',
      catalogDigest: creativeModelCatalog.sourceDigest,
    },
  };
  const modelEntry = creativeModelCatalog.video.find((item) => item.model === action.modelSnapshot.modelId);
  assert.throws(
    () => preflightActionReferences(action, modelEntry, [
      { kind: 'image', source: 'C:\\refs\\start.png' },
      { kind: 'image', source: 'C:\\refs\\end.png' },
      { kind: 'video', source: 'C:\\refs\\motion.mp4' },
      { kind: 'audio', source: 'C:\\refs\\dialogue.wav' },
    ]),
    (error) => error?.code === 'CREATOR_MODEL_REFERENCE_LOSS'
      && /1 个视频/u.test(error.message)
      && /1 段音频/u.test(error.message),
  );
});

test('Creator blocks a stale scene-bound generation before creating a Run or calling the Provider', async () => {
  const repository = new CreatorConversationRepository();
  let runIntents = 0;
  let submits = 0;
  const scope = { projectId: 'project-scene-stale', canvasId: 'canvas-scene-stale' };
  try {
    const conversation = repository.createConversation({ id: 'session-scene-stale', ...scope });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-scene-stale' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '可以生成。', suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-scene-stale', type: 'image', prompt: '雨夜车站',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: creativeModelCatalog.sourceDigest },
        workBinding: {
          schema: 't8-creator-scene-action-binding-v1', workId: 'work-scene-stale',
          workRevision: 5, workDigest: 'a'.repeat(64), sceneId: 'scene-stale',
          scenePartId: null, sceneRevision: 2, contextDigest: 'b'.repeat(64),
        },
      },
    });
    repository.getLongScriptContextState = () => ({
      snapshot: { workId: 'work-scene-stale', revision: 6 },
      work: {
        activeScenes: [{
          sceneId: 'scene-stale', recordRevision: 3, sourcePartCount: 0,
          sourceText: '这场已被修改。', sourceRef: { span: { start: 0, end: 8 } },
        }],
      },
    });
    const executor = new CreatorActionExecutor({
      config: { OUTPUT_DIR: os.tmpdir() },
      repository,
      database: {
        getCanvas: () => ({ ...scope, revision: 1 }),
        getAsset: () => null,
        createRunIntent: () => { runIntents += 1; throw new Error('must not create a RunIntent'); },
      },
      provider: { submitImageTask: async () => { submits += 1; throw new Error('must not submit'); } },
      settingsProvider: () => ({ zhenzhenSd2ApiKey: 'test-key' }),
    });
    executor.start(conversation.id, 'action-scene-stale', scope);
    await executor.wait('action-scene-stale');
    const failed = repository.getAction('action-scene-stale', conversation.id, scope);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'CREATOR_ACTION_SCENE_STALE');
    assert.equal(runIntents, 0);
    assert.equal(submits, 0);
  } finally {
    repository.close();
  }
});
