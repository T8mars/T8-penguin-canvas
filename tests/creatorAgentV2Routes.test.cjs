'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { createCreatorAgentV2Router } = require('../backend/src/routes/creatorAgentV2.js');
const { CreatorConversationRepository, digest } = require('../backend/src/services/creatorConversationRepository.js');
const { CreatorLlmRuntimeError } = require('../backend/src/services/creatorLlmRuntimeV2.js');
const { canvasPatchRequestDigest } = require('../backend/src/services/canvasPatch.js');

async function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-route-media-'));
  const managedImage = path.join(directory, 'result.png');
  fs.writeFileSync(managedImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const repository = new CreatorConversationRepository();
  const llmInputs = [];
  const document = { projectId: 'project-local', canvasId: 'canvas-local', revision: 1, nodes: [], edges: [] };
  const patchApplications = new Map();
  const database = {
    getCanvas: (canvasId) => canvasId === document.canvasId ? document : null,
    getAsset: (assetId) => ['asset-result-001', 'asset-result-002'].includes(assetId)
      ? { id: assetId, projectId: 'project-local', kind: 'image', filename: `${assetId}.png`, contentHash: (assetId.endsWith('2') ? 'b' : 'a').repeat(64), contentRevision: 1, mimeType: 'image/png', sizeBytes: 10, managedPath: managedImage, storageMode: 'managed' }
      : null,
    getCanvasPatchApplication: (_canvasId, patchId) => patchApplications.get(patchId) || null,
    previewCanvasPatch: (_canvasId, patch) => ({ patchId: patch.id, previewDigest: 'preview-digest' }),
    applyCanvasPatch: (_canvasId, patch) => {
      const baseRevision = document.revision;
      document.revision += 1;
      document.nodes.push(patch.operations[0].payload.node);
      patchApplications.set(patch.id, {
        patchId: patch.id,
        actorId: 'local-owner',
        baseRevision,
        appliedRevision: document.revision,
        status: 'applied',
        requestDigest: canvasPatchRequestDigest(patch),
        patchJson: patch,
      });
      return { revision: document.revision, status: 'applied' };
    },
  };
  const llmRuntime = options.llmRuntime || {
    modelSnapshot: () => ({ kind: 'llm', providerId: 'seedance-nz', modelId: 'bytedance/doubao-seed-2.1-pro', catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2' }),
    respond: async (input) => {
      llmInputs.push(input);
      return ({
      replyMarkdown: '我会把它做成冷蓝雨夜、暖灯列车入站的电影海报。',
      suggestions: ['直接生成', '再暗一点', '换成清晨'],
      proposedAction: {
        id: 'action-route-001',
        type: 'image',
        prompt: '雨夜车站电影海报，冷蓝环境，暖色列车灯，纵深构图',
        parameters: { ratio: '16:9', count: 1 },
        inputAssetIds: [],
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2' },
      },
      evidence: { providerCalls: 1, providerId: 'seedance-nz', modelId: 'bytedance/doubao-seed-2.1-pro', catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2', responseDigest: digest({ ok: true }) },
      });
    },
  };
  const actionExecutor = {
    start: (sessionId, actionId, scope) => repository.updateAction(actionId, sessionId, { status: 'running', runIntentId: 'intent-route-001', runId: 'run-route-001' }, scope),
  };
  const assetService = {
    inspectPlace: async (assetId) => {
      const suffix = assetId.endsWith('2') ? '002' : '001';
      return ({
      asset: { id: assetId, kind: 'image', filename: `${assetId}.png`, contentHash: (suffix === '002' ? 'b' : 'a').repeat(64), contentRevision: 1, mimeType: 'image/png', size: 10 },
      placement: { nodeId: `asset-place-route-${suffix}` },
      patch: {
        schema: 't8-canvas-patch-v1',
        id: `asset-place-route-patch-${suffix}`,
        baseRevision: document.revision,
        summary: '发送素材到画布',
        diagnosticsResolved: [],
        requiresConfirmation: true,
        operations: [{ type: 'node.add', payload: { node: { id: `asset-place-route-${suffix}`, type: 'upload', position: { x: 0, y: 0 }, data: {} } } }],
      },
    }); },
  };
  const router = createCreatorAgentV2Router({
    config: { SETTINGS_FILE: 'unused', DATA_DIR: 'unused' },
    database,
    repository,
    llmRuntime,
    actionExecutor,
    assetService,
    settingsProvider: () => ({ zhenzhenSd2ApiKey: 'configured-but-never-returned' }),
  });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/creator-agent/v2', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/creator-agent/v2`;
  return {
    repository,
    document,
    llmInputs,
    managedImage,
    baseUrl,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      repository.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function request(baseUrl, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

async function readSseFrame(response, timeoutMs = 2_000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = '';
  try {
    while (!source.includes('\n\n')) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SSE frame timeout')), timeoutMs)),
      ]);
      if (chunk.done) break;
      source += decoder.decode(chunk.value, { stream: true });
    }
    return source;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

test('Creator v2 thin route completes one natural LLM turn with one pending decision', async () => {
  const f = await fixture();
  try {
    const created = await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-session', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(created.status, 201);
    const turn = await request(f.baseUrl, '/sessions/creator-route-session/messages', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-route-001', text: '帮我生成一张雨夜车站电影海报' }),
    });
    assert.equal(turn.status, 201);
    assert.equal(turn.body.data.assistant.suggestions.length, 3);
    assert.equal(turn.body.data.pendingAction.id, 'action-route-001');
    assert.equal(turn.body.data.evidence.providerCalls, 1);
    assert.equal(JSON.stringify(turn.body).includes('configured-but-never-returned'), false);
    assert.equal(/价格|费用|余额|额度|账单/u.test(JSON.stringify(turn.body)), false);
  } finally { await f.close(); }
});

test('Creator v2 transport retry while a reply is running does not call the LLM twice', async () => {
  let enteredResolve;
  let releaseResolve;
  let calls = 0;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { releaseResolve = resolve; });
  const llmRuntime = {
    modelSnapshot: () => ({
      kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
      catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
    }),
    respond: async () => {
      calls += 1;
      enteredResolve();
      await gate;
      return {
        replyMarkdown: '我会让纸企鹅朝着唯一的暖色灯塔前进。',
        suggestions: ['继续完善', '换成清晨', '确认这个方向'],
        proposedAction: null,
        workingBrief: { goal: '完成纸企鹅夜航短片' },
        phaseDecision: { phase: 'script', transition: 'advance', reason: '方向明确' },
        evidence: { providerCalls: 1 },
      };
    },
  };
  const f = await fixture({ llmRuntime });
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-transport-retry', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const body = JSON.stringify({
      projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-transport-retry',
      text: '做一支纸企鹅夜航短片',
    });
    const firstPromise = request(f.baseUrl, '/sessions/creator-route-transport-retry/messages', {
      method: 'POST', body,
    });
    await entered;
    const retry = await request(f.baseUrl, '/sessions/creator-route-transport-retry/messages', {
      method: 'POST', body,
    });
    assert.equal(retry.status, 200);
    assert.equal(calls, 1);
    releaseResolve();
    const first = await firstPromise;
    assert.equal(first.status, 201);
    assert.equal(calls, 1);
    const snapshot = f.repository.getConversation('creator-route-transport-retry');
    assert.equal(snapshot.messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(snapshot.messages.filter((message) => message.role === 'assistant').length, 1);
  } finally {
    releaseResolve?.();
    await f.close();
  }
});

test('Creator v2 resolves an explicitly attached managed asset to the real local file for LLM vision', async () => {
  const f = await fixture();
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-media', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-media/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-route-media',
        text: '看这张图并给我下一步建议', attachments: [{ assetId: 'asset-result-001', kind: 'image' }],
      }),
    });
    assert.equal(turn.status, 201);
    assert.equal(f.llmInputs.length, 1);
    assert.equal(f.llmInputs[0].attachments.length, 1);
    assert.equal(f.llmInputs[0].attachments[0].assetId, 'asset-result-001');
    assert.equal(f.llmInputs[0].attachments[0].mediaUrl, fs.realpathSync.native(f.managedImage));
    assert.equal(JSON.stringify(turn.body).includes(f.managedImage), false, '内部绝对路径不能返回前端');
  } finally { await f.close(); }
});

test('Creator v2 accepts an attachment-only turn and gives the real LLM a natural localized intent', async () => {
  const f = await fixture();
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-attachment-only', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-attachment-only/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-attachment-only',
        text: '', locale: 'en', attachments: [{ assetId: 'asset-result-001', kind: 'image' }],
      }),
    });
    assert.equal(turn.status, 201);
    assert.equal(f.llmInputs.length, 1);
    assert.equal(f.llmInputs[0].prompt, 'Please review these materials, then suggest the strongest creative direction.');
    assert.equal(f.llmInputs[0].attachments[0].assetId, 'asset-result-001');
    const snapshot = f.repository.getConversation('creator-route-attachment-only');
    assert.equal(snapshot.messages[0].body, f.llmInputs[0].prompt);
  } finally { await f.close(); }
});

test('Creator v2 accepts a selected-node-only turn without forcing the user to type filler text', async () => {
  const f = await fixture();
  try {
    f.document.nodes.push({
      id: 'node-text-only',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { label: '文本', text: '一只纸企鹅在雨夜里追着灯塔前进。' },
    });
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-selection-only', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-selection-only/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-selection-only',
        text: '', locale: 'zh-CN', selectedNodeIds: ['node-text-only'],
      }),
    });
    assert.equal(turn.status, 201);
    assert.equal(f.llmInputs.length, 1);
    assert.equal(f.llmInputs[0].prompt, '请先看看我选中的画布节点，帮我判断最合适的创作方向。');
    assert.equal(f.llmInputs[0].selectedNodes[0].nodeId, 'node-text-only');
    assert.equal(f.llmInputs[0].selectedNodes[0].content.includes('纸企鹅'), true);
  } finally { await f.close(); }
});

test('Creator v2 still rejects a truly empty turn with no text, material, or selected node', async () => {
  const f = await fixture();
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-empty-turn', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-empty-turn/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-empty-turn', text: '', locale: 'zh-CN',
      }),
    });
    assert.equal(turn.status, 400);
    assert.equal(turn.body.code, 'CREATOR_MESSAGE_EMPTY');
    assert.equal(f.llmInputs.length, 0);
  } finally { await f.close(); }
});

test('Creator v2 rejects a stale selected node instead of silently dropping its context', async () => {
  const f = await fixture();
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-stale-selection', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-stale-selection/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-stale-selection',
        text: '按我选中的节点继续', selectedNodeIds: ['node-that-no-longer-exists'],
      }),
    });
    assert.equal(turn.status, 409);
    assert.equal(turn.body.code, 'CREATOR_SELECTED_NODE_STALE');
    assert.equal(f.llmInputs.length, 0);
    assert.equal(f.repository.getConversation('creator-route-stale-selection').messages.length, 0);
  } finally { await f.close(); }
});

test('Creator v2 grounds and persists the actual text of an explicitly selected canvas node', async () => {
  const f = await fixture();
  try {
    f.document.nodes.push({
      id: 'selected-text-node', type: 'text',
      data: {
        title: '结尾备注',
        text: '列车驶过，但她没有上车，远处开始天亮。',
        apiKey: 'must-never-be-grounded',
      },
    });
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-selected-text', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-selected-text/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-selected-text',
        text: '只调整我选中的结尾，其他内容不变', selectedNodeIds: ['selected-text-node'],
      }),
    });
    assert.equal(turn.status, 201);
    assert.equal(f.llmInputs.length, 1);
    assert.deepEqual(f.llmInputs[0].selectedNodes, [{
      nodeId: 'selected-text-node', type: 'text', label: '结尾备注', assetId: null,
      content: '列车驶过，但她没有上车，远处开始天亮。',
    }]);
    const user = f.repository.getConversation('creator-route-selected-text').messages.find((message) => message.role === 'user');
    assert.deepEqual(user.selectedNodes, f.llmInputs[0].selectedNodes);
    assert.equal(JSON.stringify(f.llmInputs[0]).includes('must-never-be-grounded'), false);
    assert.equal(JSON.stringify(turn.body).includes('must-never-be-grounded'), false);
  } finally { await f.close(); }
});

test('Creator v2 resumes an orphaned selected-node turn from durable context after the node disappears', async () => {
  const f = await fixture();
  try {
    f.repository.createConversation({
      id: 'creator-route-selected-recovery', projectId: 'project-local', canvasId: 'canvas-local',
    });
    f.repository.appendUserMessage('creator-route-selected-recovery', {
      body: '按我选中的文字继续', clientRequestId: 'request-selected-recovery',
      selectedNodes: [{
        nodeId: 'removed-text-node', type: 'text', label: '旧结尾', assetId: null,
        content: '她没有上车，远处天亮了。',
      }],
    });
    const turn = await request(f.baseUrl, '/sessions/creator-route-selected-recovery/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-selected-recovery',
        text: '按我选中的文字继续', selectedNodeIds: ['removed-text-node'],
      }),
    });
    assert.equal(turn.status, 201);
    assert.equal(f.llmInputs.length, 1);
    assert.equal(f.llmInputs[0].selectedNodes[0].content, '她没有上车，远处天亮了。');
    const snapshot = f.repository.getConversation('creator-route-selected-recovery');
    assert.equal(snapshot.messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(snapshot.messages.at(-1).replyToMessageId, snapshot.messages[0].id);
  } finally { await f.close(); }
});

test('Creator v2 keeps an immediate stop sticky until provider abort is installed and scopes it to the session', async () => {
  let enteredResolve;
  let releaseAbortRegistration;
  let abortInstalled = false;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { releaseAbortRegistration = resolve; });
  const llmRuntime = {
    modelSnapshot: () => ({ kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6', catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2' }),
    respond: async (_input, hooks) => {
      enteredResolve();
      await gate;
      return new Promise((_resolve, reject) => {
        hooks.registerAbort(() => {
          abortInstalled = true;
          reject(new CreatorLlmRuntimeError('CREATOR_LLM_STOPPED', '已停止这次回复。', 409));
        });
      });
    },
  };
  const f = await fixture({ llmRuntime });
  try {
    for (const sessionId of ['creator-route-stop-race', 'creator-route-stop-other']) {
      await request(f.baseUrl, '/sessions', {
        method: 'POST',
        body: JSON.stringify({ sessionId, projectId: 'project-local', canvasId: 'canvas-local' }),
      });
    }
    const turnPromise = request(f.baseUrl, '/sessions/creator-route-stop-race/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local',
        clientRequestId: 'request-stop-race', text: '先给我一个创作方向',
      }),
    });
    await entered;
    const wrongSession = await request(f.baseUrl, '/sessions/creator-route-stop-other/responses/response-request-stop-race/stop', {
      method: 'POST', body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(wrongSession.status, 200);
    assert.equal(wrongSession.body.data.stopped, false);
    assert.equal(abortInstalled, false);
    const stopped = await request(f.baseUrl, '/sessions/creator-route-stop-race/responses/response-request-stop-race/stop', {
      method: 'POST', body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.data.stopped, true);
    assert.equal(abortInstalled, false, 'provider has not installed its abort handler yet');
    releaseAbortRegistration();
    const turn = await turnPromise;
    assert.equal(turn.status, 409);
    assert.equal(abortInstalled, true);
    const snapshot = f.repository.getConversation('creator-route-stop-race');
    assert.equal(snapshot.messages.at(-1).status, 'stopped');
  } finally {
    releaseAbortRegistration?.();
    await f.close();
  }
});

test('Creator v2 keeps identical client response ids isolated across simultaneous sessions', async () => {
  const controls = new Map();
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const llmRuntime = {
    modelSnapshot: () => ({ kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6', catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2' }),
    respond: async (input, hooks) => new Promise((_resolve, reject) => {
      hooks.registerAbort(() => reject(new CreatorLlmRuntimeError('CREATOR_LLM_STOPPED', '已停止这次回复。', 409)));
      controls.set(input.prompt, true);
      if (controls.size === 2) enteredResolve();
    }),
  };
  const f = await fixture({ llmRuntime });
  try {
    for (const sessionId of ['creator-route-collision-a', 'creator-route-collision-b']) {
      await request(f.baseUrl, '/sessions', {
        method: 'POST', body: JSON.stringify({ sessionId, projectId: 'project-local', canvasId: 'canvas-local' }),
      });
    }
    const sharedRequest = 'request-shared-response-id';
    const turnA = request(f.baseUrl, '/sessions/creator-route-collision-a/messages', {
      method: 'POST', body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: sharedRequest, text: '会话 A' }),
    });
    const turnB = request(f.baseUrl, '/sessions/creator-route-collision-b/messages', {
      method: 'POST', body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: sharedRequest, text: '会话 B' }),
    });
    await entered;
    const stopA = await request(f.baseUrl, `/sessions/creator-route-collision-a/responses/response-${sharedRequest}/stop`, {
      method: 'POST', body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(stopA.body.data.stopped, true);
    const resultA = await turnA;
    assert.equal(resultA.status, 409);
    assert.equal(f.repository.getConversation('creator-route-collision-b').messages.at(-1).status, 'streaming');
    const stopB = await request(f.baseUrl, `/sessions/creator-route-collision-b/responses/response-${sharedRequest}/stop`, {
      method: 'POST', body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(stopB.body.data.stopped, true);
    assert.equal((await turnB).status, 409);
  } finally { await f.close(); }
});

test('Creator v2 settings expose four choices only and catalog never returns credentials or cost data', async () => {
  const f = await fixture();
  try {
    const saved = await request(f.baseUrl, '/settings', {
      method: 'PUT',
      body: JSON.stringify({
        projectId: 'project-local',
        canvasId: 'canvas-local',
        preferences: {
          providerId: 'seedance-nz',
          llm: { providerId: 'seedance-nz', modelId: 'bytedance/doubao-seed-2.1-pro' },
          image: { providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2' },
          video: { providerId: 'seedance-nz', modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice' },
          catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
        },
      }),
    });
    assert.equal(saved.status, 200);
    const catalog = await request(f.baseUrl, '/settings/catalog?projectId=project-local&canvasId=canvas-local');
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.data.llm.length > 0);
    assert.ok(catalog.body.data.image.length > 0);
    assert.ok(catalog.body.data.video.length > 0);
    assert.deepEqual([...new Set(catalog.body.data.image.map((item) => item.providerId))], ['seedance-nz']);
    assert.deepEqual([...new Set(catalog.body.data.video.map((item) => item.providerId))], ['seedance-nz']);
    assert.deepEqual(catalog.body.data.providers.map((item) => item.id), ['seedance-nz']);
    const serialized = JSON.stringify(catalog.body);
    assert.equal(/api.?key|secret|token|password/iu.test(serialized), false);
    assert.equal(Object.keys(catalog.body.data).some((key) => /price|cost|balance|quota|billing/iu.test(key)), false);
    assert.equal([...catalog.body.data.llm, ...catalog.body.data.image, ...catalog.body.data.video]
      .some((item) => Object.keys(item).some((key) => /price|cost|balance|quota|billing/iu.test(key))), false);
  } finally { await f.close(); }
});

test('Creator v2 sends multi-image results independently and suppresses duplicate placement', async () => {
  const f = await fixture();
  try {
    f.repository.createConversation({ id: 'creator-route-session', projectId: 'project-local', canvasId: 'canvas-local' });
    f.repository.appendUserMessage('creator-route-session', { body: '生成图片', clientRequestId: 'request-route-action' });
    const response = f.repository.startAssistantResponse('creator-route-session', { responseId: 'response-route-action' });
    f.repository.completeAssistantResponse('creator-route-session', response.responseId, {
      body: '准备生成。',
      suggestions: ['直接生成', '再暗一点', '换成清晨'],
      action: {
        id: 'action-route-001',
        type: 'image',
        prompt: '雨夜车站电影海报，冷蓝环境，暖色列车灯，纵深构图',
        parameters: { ratio: '16:9', count: 1 },
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2' },
      },
    });
    const confirmed = await request(f.baseUrl, '/sessions/creator-route-session/actions/action-route-001/confirm', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(confirmed.status, 202);
    f.repository.updateAction('action-route-001', 'creator-route-session', {
      status: 'completed',
      resultAssets: [
        { assetId: 'asset-result-001', kind: 'image', contentHash: 'a'.repeat(64), previewUrl: '/api/project-assets/asset-result-001/media', title: 'result-1.png' },
        { assetId: 'asset-result-002', kind: 'image', contentHash: 'b'.repeat(64), previewUrl: '/api/project-assets/asset-result-002/media', title: 'result-2.png' },
      ],
    });
    const sent = await request(f.baseUrl, '/sessions/creator-route-session/media/asset-result-001/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-001' }),
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.data.nodeId, 'asset-place-route-001');
    assert.equal(sent.body.data.duplicate, false);
    assert.equal(f.repository.getConversation('creator-route-session').conversation.phase, 'delivery');
    f.repository.db.prepare("UPDATE creator_conversations SET phase = 'candidates' WHERE id = ?")
      .run('creator-route-session');
    const duplicate = await request(f.baseUrl, '/sessions/creator-route-session/media/asset-result-001/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-001' }),
    });
    const second = await request(f.baseUrl, '/sessions/creator-route-session/media/asset-result-002/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-001' }),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.data.duplicate, true);
    assert.equal(duplicate.body.data.nodeId, 'asset-place-route-001');
    assert.equal(f.repository.getConversation('creator-route-session').conversation.phase, 'delivery');
    assert.equal(second.status, 200);
    assert.equal(second.body.data.duplicate, false);
    assert.equal(second.body.data.nodeId, 'asset-place-route-002');
    assert.equal(f.document.nodes.length, 2);
  } finally { await f.close(); }
});

test('Creator v2 decline route durably clears a pending generation decision', async () => {
  const f = await fixture();
  try {
    f.repository.createConversation({ id: 'creator-route-cancel', projectId: 'project-local', canvasId: 'canvas-local' });
    const response = f.repository.startAssistantResponse('creator-route-cancel', { responseId: 'response-route-cancel' });
    f.repository.completeAssistantResponse('creator-route-cancel', response.responseId, {
      body: '准备生成。',
      suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-route-cancel',
        type: 'image',
        prompt: '雨夜车站',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    const cancelled = await request(f.baseUrl, '/sessions/creator-route-cancel/actions/action-route-cancel/cancel', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.action.status, 'cancelled');
    assert.equal(f.repository.getConversation('creator-route-cancel').pendingAction, null);
  } finally { await f.close(); }
});

test('Creator v2 resumes an orphaned durable user turn without duplicating the user message', async () => {
  const f = await fixture();
  try {
    const conversation = f.repository.createConversation({
      id: 'creator-route-orphan', projectId: 'project-local', canvasId: 'canvas-local',
    });
    const orphan = f.repository.appendUserMessage(conversation.id, {
      body: '把雨夜车站做成电影海报', clientRequestId: 'request-route-orphan',
    });
    assert.equal(f.repository.findAssistantResponseForUserMessage(conversation.id, orphan.message.id), null);

    const resumed = await request(f.baseUrl, `/sessions/${conversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local',
        text: '把雨夜车站做成电影海报', clientRequestId: 'request-route-orphan',
      }),
    });
    assert.equal(resumed.status, 201);
    assert.equal(f.llmInputs.length, 1);
    const snapshot = f.repository.getConversation(conversation.id);
    assert.equal(snapshot.messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(snapshot.messages.filter((message) => message.role === 'assistant').length, 1);
    assert.equal(snapshot.messages.at(-1).status, 'completed');
    assert.equal(f.repository.findAssistantResponseForUserMessage(conversation.id, orphan.message.id)?.status, 'completed');
  } finally { await f.close(); }
});

test('Creator v2 SSE lets Last-Event-ID override a stale launch query on reconnect', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const conversation = f.repository.createConversation({
      id: 'creator-route-sse', projectId: 'project-local', canvasId: 'canvas-local',
    });
    f.repository.appendUserMessage(conversation.id, { body: '继续创作', clientRequestId: 'request-route-sse' });
    const response = f.repository.startAssistantResponse(conversation.id, { responseId: 'response-route-sse' });
    const streamingCursor = f.repository.getConversation(conversation.id).conversation.sequence;
    f.repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '这一轮已经完成。',
      suggestions: ['继续细化', '换个方向', '直接执行'],
    });
    const stream = await fetch(`${f.baseUrl}/sessions/${conversation.id}/events?projectId=project-local&canvasId=canvas-local&after=0`, {
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(streamingCursor) },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    const frame = await readSseFrame(stream);
    assert.match(frame, new RegExp(`id: ${streamingCursor + 1}\\n`, 'u'));
    assert.match(frame, /"status":"completed"/u);
    assert.doesNotMatch(frame, new RegExp(`id: ${streamingCursor}\\n`, 'u'));
  } finally {
    controller.abort();
    await f.close();
  }
});
