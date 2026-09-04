'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const express = require('express');

const ROOT = path.resolve(__dirname, '..');
const SETTINGS_FILE = path.join(ROOT, 'data', 'settings.json');
const MODEL = 'zhenzhen/gk-4.6';

async function secretLineFromStdin() {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    return new Promise((resolve, reject) => {
      let value = '';
      const cleanup = () => {
        process.stdin.off('data', onData);
        try { process.stdin.setRawMode(Boolean(wasRaw)); } catch {}
        process.stdin.pause();
      };
      const onData = (chunk) => {
        for (const byte of Buffer.from(chunk)) {
          if (byte === 3) {
            cleanup();
            reject(new Error('credential input cancelled'));
            return;
          }
          if (byte === 10 || byte === 13) {
            cleanup();
            resolve(value.trim());
            return;
          }
          value += String.fromCharCode(byte);
        }
      };
      process.stdin.on('data', onData);
    });
  }
  return new Promise((resolve) => {
    const reader = readline.createInterface({ input: process.stdin, terminal: false });
    reader.once('line', (line) => {
      reader.close();
      resolve(String(line || '').trim());
    });
  });
}

async function credentialSettings() {
  const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  const inMemoryApiKey = String(process.env.T8_CREATOR_IN_MEMORY_KEY || '').trim();
  let apiKey = inMemoryApiKey || String(parsed?.zhenzhenSd2ApiKey || '').trim();
  delete process.env.T8_CREATOR_IN_MEMORY_KEY;
  if (!inMemoryApiKey && process.env.T8_CREATOR_KEY_FROM_STDIN === '1') {
    process.stdout.write('[creator-long-script-live] waiting for one in-memory credential line\n');
    apiKey = await secretLineFromStdin();
  }
  assert.match(apiKey, /^sk-[A-Za-z0-9_-]{20,}$/u, '缺少已配置的贞贞平价AI小屋 API Key');
  return Object.freeze({
    zhenzhenSd2ApiKey: apiKey,
    zhenzhenSd2BaseUrl: String(parsed?.zhenzhenSd2BaseUrl || 'https://api.seedance.nz').trim(),
  });
}

async function rerunWithElectron(settings) {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  assert.equal(fs.existsSync(electron), true, '缺少项目 Electron 运行时');
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(electron, [__filename], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        T8_CREATOR_KEY_FROM_STDIN: '0',
        T8_CREATOR_IN_MEMORY_KEY: settings.zhenzhenSd2ApiKey,
      },
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron live verifier exited with ${code ?? signal ?? 'unknown'}`));
    });
  });
}

async function request(baseUrl, endpoint, init = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(`${endpoint} HTTP ${response.status}: ${body?.code || ''} ${body?.message || ''}`);
  }
  return body.data;
}

async function main() {
  const settings = await credentialSettings();
  if (!process.versions.electron) {
    await rerunWithElectron(settings);
    return;
  }
  const { createCreatorAgentV2Router } = require('../backend/src/routes/creatorAgentV2.js');
  const { CreatorConversationRepository } = require('../backend/src/services/creatorConversationRepository.js');
  const { createCreatorLlmRuntimeV2 } = require('../backend/src/services/creatorLlmRuntimeV2.js');
  const { readLongScriptWork } = require('../backend/src/services/creatorLongScriptWork.js');
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-long-script-live-'));
  const repositoryFile = path.join(runRoot, 'creator.sqlite3');
  let repository = new CreatorConversationRepository({ filename: repositoryFile });
  const database = {
    getCanvas: (canvasId) => canvasId === 'canvas-long-live'
      ? { projectId: 'project-long-live', canvasId, revision: 1, nodes: [], edges: [] }
      : null,
    getAsset: () => null,
  };
  const baseLlmRuntime = createCreatorLlmRuntimeV2({
    settingsProvider: () => settings,
    timeoutMs: 300_000,
    stream: process.env.T8_CREATOR_LIVE_STREAM !== '0',
  });
  const llmRuntime = {
    modelSnapshot: baseLlmRuntime.modelSnapshot,
    respond: async (...args) => {
      const response = await baseLlmRuntime.respond(...args);
      if (process.env.T8_CREATOR_LIVE_DEBUG === '1' && response.scenePatch) {
        const patch = response.scenePatch.patch || {};
        const summary = {
          baseWorkRevision: response.scenePatch.baseWorkRevision,
          patchKeys: Object.keys(patch),
          activeEntityIds: patch.activeEntityIds || [],
          entityProposals: (response.scenePatch.entityProposals || []).map((item) => ({
            tempId: item.tempId, kind: item.kind, name: item.name,
          })),
          exitState: patch.exitState || {},
        };
        process.stdout.write(`[creator-long-script-live] DEBUG ${JSON.stringify(summary)}\n`);
      }
      return response;
    },
  };
  const actionExecutor = { start: () => { throw new Error('本验收禁止媒体生成动作'); } };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/creator-agent/v2', createCreatorAgentV2Router({
    config: { SETTINGS_FILE: path.join(runRoot, 'settings-never-written.json'), DATA_DIR: runRoot },
    database,
    repository,
    llmRuntime,
    actionExecutor,
    settingsProvider: () => settings,
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/creator-agent/v2`;
  const projectId = 'project-long-live';
  const canvasId = 'canvas-long-live';
  let logicalLlmTurns = 0;
  let providerCalls = 0;
  try {
    await request(baseUrl, '/settings', {
      method: 'PUT',
      body: JSON.stringify({
        projectId, canvasId,
        preferences: {
          providerId: 'seedance-nz',
          llm: { providerId: 'seedance-nz', modelId: MODEL },
          image: null, video: null, catalogDigest: null,
        },
      }),
    });
    const created = await request(baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, canvasId, title: '三场连续性验收' }),
    });
    const sessionId = created.conversation.id;
    const script = [
      '第一场：雨夜车站',
      '林溪穿黑色风衣，左手缠着绷带，握着旧车票等待末班车。',
      '第二场：清晨天台',
      '林溪在日出前见到第一次出现的周野。',
      '第三场：午后旧屋',
      '林溪再次检查左手绷带，把旧车票收进口袋。',
    ].join('\n');
    const imported = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, clientRequestId: 'long-live-import',
        text: `${script}\n\n全剧风格固定为潮湿冷蓝现实主义。请只完成导入和逐场创作准备，不要生成图片或视频，不要讨论其他场。`,
      }),
    });
    logicalLlmTurns += 1;
    providerCalls += imported.evidence.providerCalls;
    assert.equal(imported.evidence.providerId, 'seedance-nz');
    assert.equal(imported.evidence.modelId, MODEL);
    assert.ok(imported.evidence.providerCalls >= 1 && imported.evidence.providerCalls <= 2);
    assert.equal(imported.work.snapshot.revision, 1);
    const navigation = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/scenes?projectId=${projectId}&canvasId=${canvasId}`);
    assert.equal(navigation.total, 3);
    const importedWorkState = repository.getWorkState(sessionId, {
      projectId, canvasId, includeCurrentVersions: true,
    });
    const importedStyle = importedWorkState.currentVersions.find((version) => (
      version.kind === 'ProductionBrief' && (!version.scopeKey || version.scopeKey === 'root')
    ))?.fields?.style;
    assert.match(String(importedStyle || ''), /潮湿|冷蓝|现实/u, '导入后没有保存全剧风格基线');

    const refined = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, currentSceneId: navigation.scenes[0].sceneId,
        clientRequestId: 'long-live-refine-first',
        text: '只修改当前第一场，不要生成图片或视频：新增人物林溪，长期设定为“离家多年的女儿”，把她加入本场出场人物；本场结束时她仍穿黑色风衣、左手缠着绷带并持有旧车票。把本场目的保存为“建立林溪是否离开的选择”，目标保存为“等到末班车”，其余场次保持不变。',
      }),
    });
    logicalLlmTurns += 1;
    providerCalls += refined.evidence.providerCalls;
    assert.equal(refined.work.snapshot.revision, 2, '真实 LLM 没有形成版本绑定的当前场补丁');
    const firstRefined = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/scenes?projectId=${projectId}&canvasId=${canvasId}`);
    assert.match(firstRefined.currentScene.purpose, /离开|选择/u);
    assert.match(firstRefined.currentScene.objective, /末班车/u);
    let liveWorkState = repository.getWorkState(sessionId, { projectId, canvasId, includeCurrentVersions: true });
    let liveWork = readLongScriptWork(liveWorkState.currentVersions, liveWorkState.snapshot);
    const linxi = liveWork.entities.find((entity) => entity.name === '林溪');
    assert.ok(linxi, '第一场没有创建林溪的稳定实体');
    assert.equal(liveWork.activeScenes[0].activeEntityIds.includes(linxi.entityId), true,
      '第一场创建了林溪但没有把她加入当前场出场人物');
    assert.match(JSON.stringify(liveWork.activeScenes[0].exitState[linxi.entityId]), /黑色风衣/u,
      '第一场没有保存林溪的离场服装状态');

    const confirmedFirst = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/current-scene/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, sceneId: firstRefined.scenes[0].sceneId,
        scenePartId: firstRefined.currentScene?.sourcePartId,
        clientRequestId: 'long-live-confirm-first',
      }),
    });
    assert.equal(confirmedFirst.navigation.scenes[0].status, 'confirmed');
    assert.equal(confirmedFirst.navigation.work.revision, 3);

    const secondId = firstRefined.scenes[1].sceneId;
    await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/current-scene`, {
      method: 'PUT', body: JSON.stringify({ projectId, canvasId, sceneId: secondId }),
    });
    const introduced = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, currentSceneId: secondId,
        clientRequestId: 'long-live-introduce-entity',
        text: '只修改当前第二场，不要生成图片或视频：新增人物周野，设定为林溪的旧友，把他加入本场出场人物；不要改第一场和第三场。',
      }),
    });
    logicalLlmTurns += 1;
    providerCalls += introduced.evidence.providerCalls;
    assert.equal(introduced.work.snapshot.revision, 4, '真实 LLM 没有保存当前场新人设');
    liveWorkState = repository.getWorkState(sessionId, { projectId, canvasId, includeCurrentVersions: true });
    liveWork = readLongScriptWork(liveWorkState.currentVersions, liveWorkState.snapshot);
    assert.ok(liveWork.entities.some((entity) => entity.name === '周野'), '新人设没有分配后端稳定 ID');
    assert.equal(liveWork.activeScenes[0].activeEntityIds.includes(
      liveWork.entities.find((entity) => entity.name === '周野').entityId,
    ), false, '新人设被错误反写到前场');

    const thirdId = firstRefined.scenes[2].sceneId;
    await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/current-scene`, {
      method: 'PUT', body: JSON.stringify({ projectId, canvasId, sceneId: thirdId }),
    });
    const reappeared = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId, currentSceneId: thirdId,
        clientRequestId: 'long-live-reappear-existing-entity',
        text: '只修改当前第三场，不要生成图片或视频：沿用已有的林溪，不要新建同名人物；把她加入本场出场人物，并延续第一场确认的黑色风衣、左手绷带和旧车票状态。不要改前两场。',
      }),
    });
    logicalLlmTurns += 1;
    providerCalls += reappeared.evidence.providerCalls;
    assert.equal(reappeared.work.snapshot.revision, 5, '真实 LLM 没有保存隔场重现');
    liveWorkState = repository.getWorkState(sessionId, { projectId, canvasId, includeCurrentVersions: true });
    liveWork = readLongScriptWork(liveWorkState.currentVersions, liveWorkState.snapshot);
    assert.equal(liveWork.entities.filter((entity) => entity.name === '林溪').length, 1, '隔场重现错误创建了同名人物');
    const thirdScene = liveWork.activeScenes.find((scene) => scene.sceneId === thirdId);
    assert.equal(thirdScene.activeEntityIds.includes(linxi.entityId), true, '第三场没有复用林溪的稳定实体');
    assert.equal(thirdScene.entryRefs.find((entry) => entry.entityId === linxi.entityId)?.fromSceneId,
      firstRefined.scenes[0].sceneId, '第三场没有引用第一场的最近确认状态');
    const finalStyle = liveWorkState.currentVersions.find((version) => (
      version.kind === 'ProductionBrief' && (!version.scopeKey || version.scopeKey === 'root')
    ))?.fields?.style;
    assert.equal(finalStyle, importedStyle, '逐场推进意外改写了已经建立的全剧风格基线');

    await new Promise((resolve) => server.close(resolve));
    repository.close();
    repository = new CreatorConversationRepository({ filename: repositoryFile });
    const restored = repository.getLongScriptState(sessionId, { projectId, canvasId });
    assert.equal(restored.total, 3);
    assert.equal(restored.currentSceneId, thirdId);
    assert.equal(restored.work.revision, 5);
    process.stdout.write(`[creator-long-script-live] PASS provider=seedance-nz model=zhenzhen/gk-4.6 logicalTurns=${logicalLlmTurns} providerCalls=${providerCalls} persisted=true keyStored=false\n`);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    try { repository?.close(); } catch {}
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const safe = String(error?.message || error || 'unknown')
    .replace(/sk-[A-Za-z0-9_-]+/giu, '[redacted-key]')
    .replace(/https?:\/\/\S+/giu, '[redacted-url]');
  process.stderr.write(`[creator-long-script-live] FAIL ${safe}\n`);
  process.exitCode = 1;
});
