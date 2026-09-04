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
const CREATOR_MODEL = String(process.env.T8_CREATOR_LIVE_MODEL || 'qwen/qwen3.7-max').trim();
const JUDGE_MODEL = String(process.env.T8_CREATOR_LIVE_JUDGE || 'qwen/qwen3.8-max').trim();
const CREATOR_STREAM = process.env.T8_CREATOR_LIVE_STREAM !== '0';

async function secretLineFromStdin() {
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
    process.stdout.write('[creator-scene-mode-live] waiting for one in-memory credential line\n');
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
  await new Promise((resolve, reject) => {
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
    child.once('exit', (code, signal) => code === 0
      ? resolve() : reject(new Error(`Electron live verifier exited with ${code ?? signal ?? 'unknown'}`)));
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

function parseJsonObject(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  assert.ok(start >= 0 && end > start, '质量评审没有返回 JSON');
  return JSON.parse(source.slice(start, end + 1));
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
  const { generateChatWithProvider } = require('../backend/src/providers/adapters.js');
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-scene-mode-live-'));
  const repositoryFile = path.join(runRoot, 'creator.sqlite3');
  const repository = new CreatorConversationRepository({ filename: repositoryFile });
  const database = {
    getCanvas: (canvasId) => canvasId === 'canvas-scene-live'
      ? { projectId: 'project-scene-live', canvasId, revision: 1, nodes: [], edges: [] }
      : null,
    getAsset: () => null,
  };
  let creatorProviderCall = 0;
  const creatorDebugOutputs = [];
  const llmRuntime = createCreatorLlmRuntimeV2({
    settingsProvider: () => settings,
    timeoutMs: 300_000,
    stream: CREATOR_STREAM,
    generateChat: async (provider, input, options) => {
      const result = await generateChatWithProvider(provider, input, options);
      creatorProviderCall += 1;
      if (result?.ok) {
        try {
          const parsed = parseJsonObject(result.text);
          creatorDebugOutputs.push({
            call: creatorProviderCall,
            replyMarkdown: String(parsed?.replyMarkdown || ''),
            scenePatch: parsed?.scenePatch || null,
          });
          const patch = parsed?.scenePatch?.patch;
          const summary = {
            call: creatorProviderCall,
            replyCharacters: String(parsed?.replyMarkdown || '').length,
            patchKeys: patch && typeof patch === 'object' ? Object.keys(patch) : [],
            entityKinds: (Array.isArray(parsed?.scenePatch?.entityProposals)
              ? parsed.scenePatch.entityProposals : []).map((item) => item?.kind || null),
            entityTempIds: (Array.isArray(parsed?.scenePatch?.entityProposals)
              ? parsed.scenePatch.entityProposals : []).map((item) => item?.tempId || null),
            activeEntityIds: Array.isArray(patch?.activeEntityIds) ? patch.activeEntityIds : [],
            hasDraftText: Boolean(String(patch?.draftText || '').trim()),
            draftMatchesReply: String(patch?.draftText || '').trim() === String(parsed?.replyMarkdown || '').trim(),
          };
          process.stdout.write(`[creator-scene-mode-live] structure=${JSON.stringify(summary)}\n`);
        } catch {
          process.stdout.write(`[creator-scene-mode-live] structure={"call":${creatorProviderCall},"json":false}\n`);
        }
      }
      return result;
    },
  });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/creator-agent/v2', createCreatorAgentV2Router({
    config: { SETTINGS_FILE: path.join(runRoot, 'settings-never-written.json'), DATA_DIR: runRoot },
    database,
    repository,
    llmRuntime,
    actionExecutor: { start: () => { throw new Error('本验收禁止媒体生成动作'); } },
    settingsProvider: () => settings,
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/creator-agent/v2`;
  const projectId = 'project-scene-live';
  const canvasId = 'canvas-scene-live';
  const idea = '一名夜班护士在凌晨便利店偶遇多年没见的弟弟。两个人都没有说破家里的旧事，只用一杯热豆浆把关系往前推一步。不要生成图片或视频。';
  const creatorStartedAt = Date.now();
  try {
    await request(baseUrl, '/settings', {
      method: 'PUT',
      body: JSON.stringify({
        projectId, canvasId,
        preferences: {
          providerId: 'seedance-nz',
          llm: { providerId: 'seedance-nz', modelId: CREATOR_MODEL },
          image: null, video: null, catalogDigest: null,
        },
      }),
    });
    const created = await request(baseUrl, '/sessions', {
      method: 'POST', body: JSON.stringify({ projectId, canvasId, title: '短想法逐场创作真实验收' }),
    });
    const sessionId = created.conversation.id;
    const first = await request(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        projectId, canvasId,
        clientRequestId: 'scene-mode-live-001',
        creationMode: 'scene',
        text: idea,
      }),
    });
    const navigation = await request(
      baseUrl,
      `/sessions/${encodeURIComponent(sessionId)}/scenes?projectId=${projectId}&canvasId=${canvasId}`,
    );
    const draftText = String(navigation.currentScene?.draftText || '');
    const creatorDurationMs = Date.now() - creatorStartedAt;
    assert.equal(first.evidence.providerId, 'seedance-nz');
    assert.equal(first.evidence.modelId, CREATOR_MODEL);
    assert.ok(first.evidence.providerCalls >= 1 && first.evidence.providerCalls <= 2);
    assert.equal(navigation.total, 1);
    assert.equal(navigation.currentScene.sourceText, idea);
    assert.equal(navigation.currentScene.sourcePartHasDraft, true);
    assert.equal(draftText, first.assistant.body);
    assert.ok(draftText.length >= 100, `场稿过短：${draftText.length}`);
    assert.equal(first.pendingAction, null);
    assert.equal(first.assistant.suggestions.length, 3);
    assert.doesNotMatch(draftText, /^(?:好的|收到|明白|没问题)/u);
    assert.doesNotMatch(draftText, /(?:Provider|Run|task[_ ]?id|assetId|价格|费用|余额|额度|账单|cost|price|billing|quota)/iu);
    assert.match(draftText, /豆浆/u);
    assert.doesNotMatch(draftText, /(?:第[二两](?:杯|盒|瓶|罐|碗|壶|盏)|另(?:一)?(?:杯|盒|瓶|罐|碗|壶|盏)|两(?:杯|盒|瓶|罐|碗|壶|盏)|再(?:拿|取|买|点|要|递|放|添|开)[^。！？!?\n]{0,10}一(?:杯|盒|瓶|罐|碗|壶|盏))/u);

    const judgeProvider = {
      id: 'seedance-nz',
      label: '贞贞的平价AI小屋',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey: settings.zhenzhenSd2ApiKey,
      baseUrl: settings.zhenzhenSd2BaseUrl,
      chatModels: [JUDGE_MODEL],
      defaults: { chatModel: JUDGE_MODEL, chatEndpoint: '/v1/chat/completions' },
    };
    const judgeRequest = {
      model: JUDGE_MODEL,
      messages: [{
        role: 'system',
        content: '你是严格的影视剧本编辑。只输出 JSON：{"overall":0到10,"intentFidelity":0到10,"sceneCraft":0到10,"shootability":0到10,"naturalness":0到10,"beginnerUsability":0到10,"verdict":"一句话","issues":["最多三条具体问题"]}。按短想法是否被发展成完整、自然、可拍、无机械说明的单场正文评分；逐字核对用户明确的人物关系、数量、否定和结果方向。本例只能有一杯豆浆，并且结尾必须让姐弟关系发生可见的正向推进；若新增第二杯/盒或最终仍完全疏离，intentFidelity 与 overall 都不得高于 7。不要因篇幅短而放宽标准。',
      }, {
        role: 'user',
        content: `用户想法：${idea}\n\nCreator 场稿：\n${draftText}`,
      }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 800,
      stream: false,
    };
    let judged = await generateChatWithProvider(judgeProvider, judgeRequest, { timeoutMs: 300_000 });
    if (!judged?.ok && /HTTP (?:429|500|502|503)\b/iu.test(String(judged?.error || ''))) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      judged = await generateChatWithProvider(judgeProvider, judgeRequest, { timeoutMs: 300_000 });
    }
    assert.equal(judged.ok, true, judged.error || '质量评审调用失败');
    const score = parseJsonObject(judged.text);
    for (const field of ['overall', 'intentFidelity', 'sceneCraft', 'shootability', 'naturalness', 'beginnerUsability']) {
      assert.ok(Number(score[field]) >= 0 && Number(score[field]) <= 10, `${field} 评分无效`);
    }
    const evidence = {
      schema: 't8-creator-scene-mode-live-evidence-v1',
      createdAt: new Date().toISOString(),
      providerId: first.evidence.providerId,
      creatorModel: first.evidence.modelId,
      judgeModel: JUDGE_MODEL,
      providerCalls: first.evidence.providerCalls,
      creatorTransport: CREATOR_STREAM ? 'stream' : 'json',
      creatorDurationMs,
      sourcePreserved: navigation.currentScene.sourceText === idea,
      persistedDraftMatchesReply: draftText === first.assistant.body,
      sceneCount: navigation.total,
      draftCharacters: draftText.length,
      suggestions: first.assistant.suggestions.map((item) => item.label),
      score,
      idea,
      draftText,
    };
    const evidenceDirectory = path.join(ROOT, 'artifacts', 'creator-agent-scene-mode-live');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    const evidenceFile = path.join(evidenceDirectory, `${Date.now()}.json`);
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`[creator-scene-mode-live] evidence=${path.relative(ROOT, evidenceFile).replace(/\\/gu, '/')}\n`);
    assert.ok(Number(score.overall) >= 8.5, `真实场稿质量未达标：${score.overall}`);
    process.stdout.write(`[creator-scene-mode-live] PASS overall=${Number(score.overall).toFixed(1)} providerCalls=${first.evidence.providerCalls} creatorDurationMs=${creatorDurationMs} draftCharacters=${draftText.length}\n`);
  } catch (error) {
    if (creatorDebugOutputs.length) {
      const evidenceDirectory = path.join(ROOT, 'artifacts', 'creator-agent-scene-mode-live');
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      const debugFile = path.join(evidenceDirectory, `${Date.now()}-rejected.json`);
      fs.writeFileSync(debugFile, `${JSON.stringify({
        schema: 't8-creator-scene-mode-live-rejected-v1',
        createdAt: new Date().toISOString(),
        creatorModel: CREATOR_MODEL,
        idea,
        outputs: creatorDebugOutputs,
        failure: String(error?.message || error),
      }, null, 2)}\n`, 'utf8');
      process.stderr.write(`[creator-scene-mode-live] rejected=${path.relative(ROOT, debugFile).replace(/\\/gu, '/')}\n`);
    }
    throw error;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repository.close();
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[creator-scene-mode-live] FAIL ${error?.stack || error}\n`);
  process.exitCode = 1;
});
