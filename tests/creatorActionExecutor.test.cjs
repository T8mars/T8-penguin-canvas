'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const creativeModelCatalog = require('../backend/src/shared/creativeModelCatalog.json');
const { CreatorActionExecutor, CreatorActionExecutorError } = require('../backend/src/services/creatorActionExecutor.js');
const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository.js');

function pngBytes() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

test('Creator action executor records one real Run lineage and every returned image asset', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-action-'));
  const repository = new CreatorConversationRepository();
  const updates = { attempts: [], runs: [], nodeRuns: [], finished: [] };
  let sequence = 0;
  const database = {
    getCanvas: (canvasId) => canvasId === 'canvas-executor' ? { projectId: 'project-executor', canvasId, revision: 3 } : null,
    getAsset: () => null,
    createRunIntent: (input) => ({ ...input, id: 'intent-executor', queueRevision: 1 }),
    leaseRunIntentForDispatch: () => ({ intent: { id: 'intent-executor', queueRevision: 1 }, leaseToken: 'lease-executor' }),
    createRun: (input) => ({ ...input, id: 'run-executor' }),
    claimRunIntent: () => {},
    createNodeRun: (input) => ({ ...input, id: 'node-run-executor' }),
    createAttempt: (input) => ({ ...input, id: 'attempt-executor' }),
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
    assert.equal(updates.attempts.at(-1).patch.status, 'succeeded');
    assert.equal(updates.attempts.find((entry) => entry.patch.metadata?.recovery)?.patch.metadata.recovery.taskId, 'upstream-executor');
  } finally {
    repository.close();
    if (path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) fs.rmSync(tempRoot, { recursive: true, force: true });
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
