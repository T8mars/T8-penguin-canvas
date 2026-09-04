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
const { CreatorLlmRuntimeError, createCreatorLlmRuntimeV2 } = require('../backend/src/services/creatorLlmRuntimeV2.js');
const { canvasPatchRequestDigest } = require('../backend/src/services/canvasPatch.js');
const { readLongScriptWork } = require('../backend/src/services/creatorLongScriptWork.js');
const { readSceneProduction } = require('../backend/src/services/creatorSceneProduction.js');

async function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-route-media-'));
  const managedImage = path.join(directory, 'result.png');
  fs.writeFileSync(managedImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const managedScript = path.join(directory, 'long-script.txt');
  if (options.longScriptText) fs.writeFileSync(managedScript, options.longScriptText, 'utf8');
  const repository = new CreatorConversationRepository();
  const llmInputs = [];
  const document = { projectId: 'project-local', canvasId: 'canvas-local', revision: 1, nodes: [], edges: [] };
  const patchApplications = new Map();
  const database = {
    getCanvas: (canvasId) => canvasId === document.canvasId ? document : null,
    getAsset: (assetId) => {
      if (assetId === 'asset-long-script' && options.longScriptText) return {
        id: assetId, projectId: 'project-local', kind: 'file', filename: 'long-script.txt',
        contentRevision: 1, mimeType: 'text/plain', sizeBytes: Buffer.byteLength(options.longScriptText),
        managedPath: managedScript, storageMode: 'managed',
      };
      return ['asset-result-001', 'asset-result-002'].includes(assetId)
        ? { id: assetId, projectId: 'project-local', kind: 'image', filename: `${assetId}.png`, contentHash: (assetId.endsWith('2') ? 'b' : 'a').repeat(64), contentRevision: 1, mimeType: 'image/png', sizeBytes: 10, managedPath: managedImage, storageMode: 'managed' }
        : null;
    },
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
    faultInjector: options.faultInjector,
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

test('Creator v2 explicit scene mode drafts one short idea atomically, restores it, and keeps retries idempotent', async () => {
  let calls = 0;
  const draftText = '外景·末班车站·雨夜\n\n林夏攥着单程票，等手机上的来电自行熄灭。末班车灯穿过雨幕，她关机，跨过黄线。';
  const llmRuntime = {
    modelSnapshot: () => ({
      kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
      catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
    }),
    respond: async (input) => {
      calls += 1;
      assert.equal(input.sceneContext.mode, 'scene-draft');
      assert.deepEqual(input.sceneContext.requiredPaths, ['draftText']);
      return {
        replyMarkdown: draftText,
        workingBrief: { goal: '写成可拍摄的雨夜离乡场景', style: '克制现实主义' },
        phaseDecision: { phase: 'script', transition: 'stay', reason: '当前场已形成初稿' },
        suggestions: [
          { label: '细化离站动作', sendText: '继续细化林夏跨过黄线前的动作。', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
          { label: '改成车内视角', sendText: '把这场改成从末班车内看林夏上车。', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
          { label: '锁定雨夜场稿', sendText: '锁定这版雨夜场稿。', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
        ],
        proposedAction: null,
        scenePatch: {
          schema: 't8-creator-scene-patch-v1',
          sceneId: input.sceneContext.sceneId,
          scenePartId: input.sceneContext.scenePartId,
          baseWorkRevision: input.sceneContext.baseWorkRevision,
          baseSceneRevision: input.sceneContext.baseSceneRevision,
          contextDigest: input.sceneContext.contextDigest,
          patch: { draftText, purpose: '把离开变成不可逆的动作', status: 'draft' },
          entityProposals: [], relationshipProposals: [], conflicts: [],
        },
        evidence: {
          providerCalls: 1, providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
          catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
          responseDigest: digest({ draftText }),
          sceneContextDigest: input.sceneContext.contextDigest,
        },
      };
    },
  };
  const f = await fixture({ llmRuntime });
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-short-scene', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const body = {
      projectId: 'project-local', canvasId: 'canvas-local',
      clientRequestId: 'request-route-short-scene-001',
      creationMode: 'scene',
      text: '一个女孩在雨夜末班车站，终于决定离开家乡。',
    };
    const turn = await request(f.baseUrl, '/sessions/creator-route-short-scene/messages', {
      method: 'POST', body: JSON.stringify(body),
    });
    assert.equal(turn.status, 201);
    assert.equal(calls, 1);
    assert.equal(turn.body.data.assistant.body, draftText);
    assert.equal(turn.body.data.work.snapshot.revision, 1);

    const navigation = await request(
      f.baseUrl,
      '/sessions/creator-route-short-scene/scenes?projectId=project-local&canvasId=canvas-local',
    );
    assert.equal(navigation.status, 200);
    assert.equal(navigation.body.data.total, 1);
    assert.equal(navigation.body.data.currentScene.sourceText, body.text);
    assert.equal(navigation.body.data.currentScene.draftText, draftText);
    assert.equal(navigation.body.data.currentScene.sourcePartHasDraft, true);

    const replay = await request(f.baseUrl, '/sessions/creator-route-short-scene/messages', {
      method: 'POST', body: JSON.stringify(body),
    });
    assert.equal(replay.status, 200);
    assert.equal(calls, 1);

    const conflict = await request(f.baseUrl, '/sessions/creator-route-short-scene/messages', {
      method: 'POST', body: JSON.stringify({ ...body, creationMode: 'auto' }),
    });
    assert.equal(conflict.status, 409);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('Creator v2 imports an explicit long script once, navigates one scene at a time, and isolates LLM context', async () => {
  const calls = [];
  const llmRuntime = {
    modelSnapshot: () => ({
      kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
      catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
    }),
    respond: async (input) => {
      calls.push(input);
      return {
        replyMarkdown: input.sceneContext
          ? `我们只推进《${input.sceneContext.scene.title}》，不会改动其他场次。`
          : '剧本已经收到。',
        workingBrief: { goal: '逐场完成长剧本', style: '延续已锁定风格' },
        phaseDecision: { phase: 'script', transition: 'advance', reason: '已导入分场剧本' },
        suggestions: [
          { label: '细化当前场', sendText: '只细化当前场的目标和转折。', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
          { label: '换个场内视角', sendText: '只把当前场改成主角视角。', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
          { label: '锁定当前场', sendText: '锁定当前场并准备下一场。', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
        ],
        proposedAction: null,
        scenePatch: input.prompt.startsWith('只推进当前场') ? {
          schema: 't8-creator-scene-patch-v1',
          sceneId: input.sceneContext.sceneId,
          scenePartId: input.sceneContext.scenePartId,
          baseWorkRevision: input.sceneContext.baseWorkRevision,
          baseSceneRevision: input.sceneContext.baseSceneRevision,
          contextDigest: input.sceneContext.contextDigest,
          patch: {
            purpose: '让林溪主动交出旧车票',
            objective: '在日出前完成告别',
            activeEntityIds: ['new-linxi'],
            exitState: { 'new-linxi': { wardrobe: '黑色风衣', knowledge: '决定离开' } },
            status: 'draft',
          },
          entityProposals: [{
            tempId: 'new-linxi', kind: 'character', name: '林溪',
            description: '故事主角', baseline: { identity: '林溪' },
          }],
          conflicts: [],
        } : null,
        evidence: {
          providerCalls: 1, providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
          catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
          responseDigest: digest({ calls: calls.length }),
          sceneContextDigest: input.sceneContext?.contextDigest || null,
        },
      };
    },
  };
  const f = await fixture({ llmRuntime });
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-long-script', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const script = [
      '第一场：雨夜车站',
      '林溪在站台等最后一班列车，手里握着旧车票。',
      '第二场：清晨天台',
      '林溪在日出前把旧车票交给周野。',
    ].join('\n');
    const imported = await request(f.baseUrl, '/sessions/creator-route-long-script/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local',
        clientRequestId: 'request-long-script-import', text: script,
      }),
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.data.work.snapshot.revision, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sceneContext.mode, 'import-preview');
    assert.match(calls[0].sceneContext.scene.sourceText, /雨夜车站/u);
    assert.doesNotMatch(calls[0].sceneContext.scene.sourceText, /清晨天台/u);
    const importedWork = f.repository.getWorkState('creator-route-long-script', {
      projectId: 'project-local', canvasId: 'canvas-local', includeCurrentVersions: true,
    });
    const persistedBrief = importedWork.currentVersions.find((version) => (
      version.kind === 'ProductionBrief' && (!version.scopeKey || version.scopeKey === 'root')
    ));
    assert.equal(persistedBrief.fields.style, '延续已锁定风格');

    const scenes = await request(f.baseUrl, '/sessions/creator-route-long-script/scenes?projectId=project-local&canvasId=canvas-local');
    assert.equal(scenes.status, 200);
    assert.equal(scenes.body.data.total, 2);
    assert.equal(scenes.body.data.currentSceneId, scenes.body.data.scenes[0].sceneId);
    assert.equal(imported.body.data.conversation.currentSceneId, scenes.body.data.currentSceneId);

    const secondSceneId = scenes.body.data.scenes[1].sceneId;
    const switched = await request(f.baseUrl, '/sessions/creator-route-long-script/current-scene', {
      method: 'PUT',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', sceneId: secondSceneId,
      }),
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.data.navigation.currentSceneId, secondSceneId);

    const continued = await request(f.baseUrl, '/sessions/creator-route-long-script/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local',
        clientRequestId: 'request-long-script-scene-two', text: '只推进当前场，延续原有人设和风格。',
      }),
    });
    assert.equal(continued.status, 201);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].sceneContext.mode, 'scene-edit');
    assert.equal(calls[1].sceneContext.sceneId, secondSceneId);
    assert.equal(calls[1].sceneContext.styleCanon.style, '延续已锁定风格');
    assert.match(calls[1].sceneContext.scene.sourceText, /清晨天台/u);
    assert.doesNotMatch(calls[1].sceneContext.scene.sourceText, /雨夜车站/u);
    assert.equal(continued.body.data.work.snapshot.revision, 2);
    const afterPatch = await request(f.baseUrl, '/sessions/creator-route-long-script/scenes?projectId=project-local&canvasId=canvas-local');
    assert.equal(afterPatch.body.data.currentScene.purpose, '让林溪主动交出旧车票');
    assert.equal(afterPatch.body.data.currentScene.activeEntityIds.length, 1);
    assert.equal(afterPatch.body.data.currentScene.recordRevision, 2);

    const retried = await request(f.baseUrl, '/sessions/creator-route-long-script/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local',
        clientRequestId: 'request-long-script-scene-two', text: '只推进当前场，延续原有人设和风格。',
      }),
    });
    assert.equal(retried.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(retried.body.data.work.snapshot.revision, 2);

    const firstSceneId = scenes.body.data.scenes[0].sceneId;
    const confirmed = await request(f.baseUrl, '/sessions/creator-route-long-script/current-scene/confirm', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', sceneId: firstSceneId,
        scenePartId: scenes.body.data.currentScene.sourcePartId,
        clientRequestId: 'confirm-first-scene',
      }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.navigation.currentSceneId, secondSceneId);
    assert.equal(confirmed.body.data.navigation.scenes[0].status, 'confirmed');
    assert.equal(confirmed.body.data.navigation.work.revision, 3);
    const confirmRetry = await request(f.baseUrl, '/sessions/creator-route-long-script/current-scene/confirm', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', sceneId: firstSceneId,
        scenePartId: scenes.body.data.currentScene.sourcePartId,
        clientRequestId: 'confirm-first-scene',
      }),
    });
    assert.equal(confirmRetry.status, 200);
    assert.equal(confirmRetry.body.data.navigation.work.revision, 3);
  } finally { await f.close(); }
});

test('Creator v2 commits a five-shot action and its scoped ShotList/PromptPack together', async () => {
  let calls = 0;
  const llmRuntime = {
    modelSnapshot: () => ({
      kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
      catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
    }),
    respond: async (input) => {
      calls += 1;
      const action = input.prompt.startsWith('生成当前场五个镜头') ? {
        id: 'action-route-five-shots',
        type: 'video',
        prompt: '雨夜站台五镜连续段落',
        parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
        inputAssetIds: [],
        modelSnapshot: {
          kind: 'video', providerId: 'seedance-nz',
          modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
          catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
        },
        shots: Array.from({ length: 5 }, (_, index) => ({
          shotId: null,
          sourceKey: `beat-${index + 1}`,
          title: `镜头 ${index + 1}`,
          purpose: `推进节拍 ${index + 1}`,
          prompt: `雨夜站台第 ${index + 1} 镜，人物和列车动作连续。`,
          parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
          inputAssetIds: [],
        })),
        workBinding: {
          schema: 't8-creator-scene-action-binding-v1',
          workId: input.sceneContext.workId,
          workRevision: input.sceneContext.baseWorkRevision,
          workDigest: input.sceneContext.baseWorkDigest,
          sceneId: input.sceneContext.sceneId,
          scenePartId: input.sceneContext.scenePartId,
          sceneRevision: input.sceneContext.baseSceneRevision,
          contextDigest: input.sceneContext.contextDigest,
        },
      } : null;
      return {
        replyMarkdown: action ? '这场按五个连续镜头生成。' : '先从雨夜站台开始。',
        workingBrief: { goal: '逐场完成长剧本', style: '冷蓝雨夜现实主义' },
        phaseDecision: { phase: 'script', transition: 'stay', reason: '逐场制作' },
        suggestions: [
          { label: '细化列车进站', sendText: '细化列车进站的动作。', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
          { label: '换成车内视角', sendText: '把当前场改成车内视角。', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
          { label: '锁定五镜继续', sendText: '锁定五镜并进入下一步。', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
        ],
        proposedAction: action,
        scenePatch: null,
        evidence: {
          providerCalls: 1, providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
          catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
          responseDigest: digest({ calls }), sceneContextDigest: input.sceneContext?.contextDigest || null,
        },
      };
    },
  };
  const f = await fixture({ llmRuntime });
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-five-shots', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const imported = await request(f.baseUrl, '/sessions/creator-route-five-shots/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'import-five-shot-script',
        text: '第一场：雨夜站台\n林溪看见最后一班列车进站。\n第二场：清晨天台\n林溪独自等待日出。',
      }),
    });
    assert.equal(imported.status, 201);
    const generated = await request(f.baseUrl, '/sessions/creator-route-five-shots/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'generate-five-shots',
        text: '生成当前场五个镜头。',
      }),
    });
    assert.equal(generated.status, 201);
    const pendingAction = generated.body.data.pendingAction;
    assert.equal(pendingAction.shots.length, 5);
    assert.equal(new Set(pendingAction.shots.map((shot) => shot.shotId)).size, 5);
    assert.deepEqual(pendingAction.workBinding.shotIds, pendingAction.shots.map((shot) => shot.shotId));
    assert.match(pendingAction.workBinding.shotPlanDigest, /^[a-f0-9]{64}$/u);

    const workState = f.repository.getWorkState('creator-route-five-shots', {
      projectId: 'project-local', canvasId: 'canvas-local', includeCurrentVersions: true,
    });
    const production = readSceneProduction(workState.currentVersions, pendingAction.workBinding.sceneId);
    assert.equal(production.planDigest, pendingAction.workBinding.shotPlanDigest);
    assert.deepEqual(production.shots.map((shot) => shot.shotId), pendingAction.workBinding.shotIds);
    assert.equal(workState.currentVersions.filter((version) => ['ShotList', 'PromptPack'].includes(version.kind)).length, 2);
  } finally {
    await f.close();
  }
});

test('Creator v2 imports a managed long-script attachment beyond its bounded LLM observation', async () => {
  const longScriptText = [
    '第一场：长夜',
    '林溪沿着站台前进。'.repeat(3_500),
    '第二场：黎明',
    '周野在出口等她，最后一句必须保留。',
  ].join('\n');
  const f = await fixture({ longScriptText });
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'creator-route-long-attachment',
        projectId: 'project-local', canvasId: 'canvas-local',
      }),
    });
    const imported = await request(f.baseUrl, '/sessions/creator-route-long-attachment/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local',
        clientRequestId: 'request-long-attachment', text: '导入后逐场推进。',
        attachments: [{ assetId: 'asset-long-script' }],
      }),
    });
    assert.equal(imported.status, 201);
    const userMessage = imported.body.data.messages.find((message) => message.role === 'user');
    assert.equal(userMessage.media[0].documentObservation.truncated, true);
    assert.ok(userMessage.media[0].documentObservation.text.length <= 30_000);
    const state = f.repository.getWorkState('creator-route-long-attachment', {
      projectId: 'project-local', canvasId: 'canvas-local', includeCurrentVersions: true,
    });
    const work = readLongScriptWork(state.currentVersions, state.snapshot);
    assert.equal(work.activeScenes.length, 2);
    assert.equal(work.sourceDocumentIntegrity, true);
    assert.equal(work.activeScenes.map((scene) => work.sourceTextBySceneId.get(scene.sceneId)).join(''), longScriptText);
    assert.match(work.sourceTextBySceneId.get(work.activeScenes[1].sceneId), /最后一句必须保留/u);
  } finally { await f.close(); }
});

test('Creator v2 advances a long scene part exactly once and cannot skip on a replayed confirm', async () => {
  const llmRuntime = {
    modelSnapshot: () => ({
      kind: 'llm', providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
      catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
    }),
    respond: async () => ({
      replyMarkdown: '先从漫长站台这一场开始，一段一段推进，不会跳过原文。',
      workingBrief: { goal: '逐场完成长剧本' },
      phaseDecision: { phase: 'script', transition: 'advance', reason: '已识别分场剧本' },
      suggestions: [
        { label: '细化当前段', sendText: '只细化当前段的动作。', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
        { label: '换个场内视角', sendText: '把当前段换成主角视角。', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
        { label: '锁定当前段', sendText: '锁定当前段并继续本场。', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
      ],
      proposedAction: null,
      scenePatch: null,
      evidence: {
        providerCalls: 1, providerId: 'seedance-nz', modelId: 'zhenzhen/gk-4.6',
        catalogDigest: '9ef6b59cec91b32595b0215c78f801d8c231de81062f64f68e06d772fb59d9c2',
        responseDigest: digest({ longScene: true }), sceneContextDigest: null,
      },
    }),
  };
  const f = await fixture({ llmRuntime });
  try {
    const sessionId = 'creator-route-long-scene-parts';
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId, projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const body = Array.from({ length: 620 }, (_, index) => (
      `动作 ${String(index + 1).padStart(3, '0')}：林溪沿站台前进，保留精确顺序。`
    )).join('\n');
    const imported = await request(f.baseUrl, `/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'long-parts-import',
        text: `第 1 场：漫长站台\n${body}\n\n第 2 场：出口\n林溪离开车站。`,
      }),
    });
    assert.equal(imported.status, 201);
    let state = (await request(
      f.baseUrl,
      `/sessions/${sessionId}/scenes?projectId=project-local&canvasId=canvas-local`,
    )).body.data;
    const firstSceneId = state.currentSceneId;
    assert.ok(state.currentScene.sourcePartCount >= 4);
    const firstPartId = state.currentScene.sourcePartId;
    const firstAdvance = await request(f.baseUrl, `/sessions/${sessionId}/current-scene/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', sceneId: firstSceneId,
        scenePartId: firstPartId, clientRequestId: 'confirm-long-part-0',
      }),
    });
    assert.equal(firstAdvance.status, 200);
    state = firstAdvance.body.data.navigation;
    assert.equal(state.currentScene.sourcePartIndex, 1);
    const revisionAfterFirstAdvance = state.work.revision;
    const replay = await request(f.baseUrl, `/sessions/${sessionId}/current-scene/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', sceneId: firstSceneId,
        scenePartId: firstPartId, clientRequestId: 'confirm-long-part-0',
      }),
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.navigation.currentScene.sourcePartIndex, 1);
    assert.equal(replay.body.data.navigation.work.revision, revisionAfterFirstAdvance);

    const seen = [firstPartId];
    state = replay.body.data.navigation;
    while (state.currentSceneId === firstSceneId) {
      const part = state.currentScene;
      seen.push(part.sourcePartId);
      const confirmed = await request(f.baseUrl, `/sessions/${sessionId}/current-scene/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-local', canvasId: 'canvas-local', sceneId: firstSceneId,
          scenePartId: part.sourcePartId, clientRequestId: `confirm-long-part-${part.sourcePartIndex}`,
        }),
      });
      assert.equal(confirmed.status, 200);
      state = confirmed.body.data.navigation;
    }
    assert.equal(new Set(seen).size, seen.length);
    assert.equal(state.scenes[0].status, 'confirmed');
    assert.equal(state.currentSceneId, state.scenes[1].sceneId);
  } finally { await f.close(); }
});

test('Creator v2 persists an explicitly locked whole-work style even when the scene LLM omits style', async () => {
  const runtime = createCreatorLlmRuntimeV2({
    settingsProvider: () => ({
      zhenzhenSd2ApiKey: 'test-only-not-persisted',
      zhenzhenSd2BaseUrl: 'https://api.seedance.nz',
    }),
    generateChat: async () => ({
      ok: true,
      text: JSON.stringify({
        schema: 't8-creator-llm-response-v2',
        replyMarkdown: '三场已经按原顺序放好，先从雨夜车站建立人物离开的选择。',
        workingBrief: {
          goal: '', format: '', audience: '', style: '', story: '', assets: '',
          constraints: '', decisions: '', openQuestion: '',
        },
        phaseDecision: { phase: 'script', transition: 'stay', reason: '逐场处理' },
        scenePatch: null,
        suggestions: [
          { label: '细化等车选择', sendText: '继续细化当前场里林溪等车时的选择。', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
          { label: '换成车内视角', sendText: '把当前场改成从列车内观察林溪的视角。', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
          { label: '锁定这场继续', sendText: '锁定当前场并进入下一场。', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
        ],
        proposedAction: null,
      }),
    }),
  });
  const f = await fixture({ llmRuntime: runtime });
  try {
    await request(f.baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'creator-route-style-lock', projectId: 'project-local', canvasId: 'canvas-local' }),
    });
    const imported = await request(f.baseUrl, '/sessions/creator-route-style-lock/messages', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', clientRequestId: 'request-style-lock',
        text: '第一场：雨夜车站\n林溪等车。\n第二场：清晨天台\n林溪看见日出。\n全剧风格固定为潮湿冷蓝现实主义。不要生成图片或视频。',
      }),
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.data.conversation.workingBrief.style, '潮湿冷蓝现实主义');
    const state = f.repository.getWorkState('creator-route-style-lock', {
      projectId: 'project-local', canvasId: 'canvas-local', includeCurrentVersions: true,
    });
    const brief = state.currentVersions.find((version) => version.kind === 'ProductionBrief');
    assert.equal(brief?.fields?.style, '潮湿冷蓝现实主义');
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
      conversationPhase: 'candidates',
      resultAssets: [
        { assetId: 'asset-result-001', kind: 'image', contentHash: 'a'.repeat(64), previewUrl: '/api/project-assets/asset-result-001/media', title: 'result-1.png' },
        { assetId: 'asset-result-002', kind: 'image', contentHash: 'b'.repeat(64), previewUrl: '/api/project-assets/asset-result-002/media', title: 'result-2.png' },
      ],
    });
    const unreviewed = await request(f.baseUrl, '/sessions/creator-route-session/media/asset-result-001/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-001' }),
    });
    assert.equal(unreviewed.status, 409, 'an unseen candidate must not be silently adopted');
    for (const assetId of ['asset-result-001', 'asset-result-002']) {
      const reviewed = await request(f.baseUrl, `/sessions/creator-route-session/media/${assetId}/reviewed`, {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-001',
          clientRequestId: `review-${assetId}`, evidenceKind: 'image-visible',
        }),
      });
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.body.data.action.resultAssets.find((item) => item.assetId === assetId).reviewStatus, 'reviewed');
    }
    const sent = await request(f.baseUrl, '/sessions/creator-route-session/media/asset-result-001/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-001' }),
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.data.nodeId, 'asset-place-route-001');
    assert.equal(sent.body.data.duplicate, false);
    assert.equal(f.repository.getConversation('creator-route-session').conversation.phase, 'candidates');
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
    assert.equal(f.repository.getConversation('creator-route-session').conversation.phase, 'candidates');
    assert.equal(second.status, 200);
    assert.equal(second.body.data.duplicate, false);
    assert.equal(second.body.data.nodeId, 'asset-place-route-002');
    assert.equal(f.document.nodes.length, 2);
    const restored = f.repository.getAction('action-route-001', 'creator-route-session');
    assert.equal(restored.resultAssets[0].adoptionStatus, 'adopted');
    assert.equal(restored.resultAssets[0].sentToCanvas, true);
    assert.equal(restored.resultAssets[1].sentToCanvas, true);
  } finally { await f.close(); }
});

test('Creator v2 recovers a canvas placement receipt after the patch was durably applied', async () => {
  let interrupted = false;
  const f = await fixture({
    faultInjector: (point) => {
      if (point === 'canvas-patch-applied' && !interrupted) {
        interrupted = true;
        throw new Error('simulated process loss before placement receipt');
      }
    },
  });
  try {
    f.repository.createConversation({ id: 'creator-route-placement-recovery', projectId: 'project-local', canvasId: 'canvas-local' });
    const response = f.repository.startAssistantResponse('creator-route-placement-recovery', { responseId: 'response-route-placement-recovery' });
    f.repository.completeAssistantResponse('creator-route-placement-recovery', response.responseId, {
      body: '结果准备好了。',
      suggestions: ['查看结果', '调整画面', '继续创作'],
      action: {
        id: 'action-route-placement-recovery', type: 'image', prompt: '雨夜车站',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    f.repository.updateAction('action-route-placement-recovery', 'creator-route-placement-recovery', {
      status: 'completed', conversationPhase: 'candidates',
      resultAssets: [{
        assetId: 'asset-result-001', kind: 'image', contentHash: 'a'.repeat(64),
        previewUrl: '/api/project-assets/asset-result-001/media', title: 'result-1.png',
      }],
    });
    await request(f.baseUrl, '/sessions/creator-route-placement-recovery/media/asset-result-001/reviewed', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-placement-recovery',
        clientRequestId: 'review-placement-recovery', evidenceKind: 'image-visible',
      }),
    });
    const first = await request(f.baseUrl, '/sessions/creator-route-placement-recovery/media/asset-result-001/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-placement-recovery',
        clientRequestId: 'send-placement-recovery',
      }),
    });
    assert.equal(first.status, 500);
    assert.equal(f.document.nodes.length, 1, 'the canvas write completed before the simulated process loss');

    const recovered = await request(f.baseUrl, '/sessions/creator-route-placement-recovery/media/asset-result-001/send-to-canvas', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project-local', canvasId: 'canvas-local', actionId: 'action-route-placement-recovery',
        clientRequestId: 'send-placement-recovery',
      }),
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.data.duplicate, true);
    assert.equal(recovered.body.data.nodeId, 'asset-place-route-001');
    assert.equal(f.document.nodes.length, 1, 'recovery must not create a duplicate canvas node');
    const restored = f.repository.getAction('action-route-placement-recovery', 'creator-route-placement-recovery');
    assert.equal(restored.resultAssets[0].sentToCanvas, true);
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
