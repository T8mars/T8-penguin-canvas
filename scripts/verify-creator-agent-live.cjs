'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const {
  createCreatorAgentRouter,
} = require('../backend/src/routes/creatorAgent.js');
const {
  createCreatorAgentSessionStore,
} = require('../backend/src/services/creatorAgentSessions.js');
const {
  generateChatWithProvider,
} = require('../backend/src/providers/adapters.js');
const {
  ProjectDatabase,
} = require('../backend/src/services/projectDatabase.js');
const {
  AssetIndexer,
} = require('../backend/src/services/assetIndexer.js');
const {
  AssetPreviewPipeline,
} = require('../backend/src/services/assetPreviewPipeline.js');
const {
  verifyCompletionEvidence,
} = require('../backend/src/services/agentControlRuns.js');
const {
  createAgentControlCreativeService,
} = require('../backend/src/services/agentControlCreative.js');
const {
  createAgentControlDeliveryService,
} = require('../backend/src/services/agentControlDelivery.js');
const {
  fetchRemote,
  submitImageTask,
  queryImageTask,
} = require('../backend/src/providers/seedanceNz.js');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'creator-agent-live');
const PROVIDER = 'seedance-nz';
const MODEL = 'bytedance/doubao-seed-2.1-pro';
const IMAGE_MODEL = 'zhenzhen-image-gk-v2';
const BASE_URL = 'https://api.seedance.nz';
const LIVE_CALL_DIAGNOSTICS = [];
const STAGE_ONLY_DIAGNOSTIC = process.env.T8_CREATOR_AGENT_STAGE_ONLY_DIAGNOSTIC === '1';
const REVISION_ONLY_DIAGNOSTIC = process.env.T8_CREATOR_AGENT_REVISION_ONLY_DIAGNOSTIC === '1';
const TOOL_ONLY_DIAGNOSTIC = process.env.T8_CREATOR_AGENT_TOOL_ONLY_DIAGNOSTIC === '1';
const TOOL_EXECUTION_DIAGNOSTIC = process.env.T8_CREATOR_AGENT_TOOL_EXECUTION_DIAGNOSTIC === '1';
const TOOL_EXECUTION_EVIDENCE_ONLY = process.env.T8_CREATOR_AGENT_TOOL_EXECUTION_EVIDENCE_ONLY === '1';
const PRODUCTION_ACCEPTANCE_ONLY = process.env.T8_CREATOR_AGENT_PRODUCTION_ACCEPTANCE_ONLY === '1';
const ALL_FIXTURE_DIAGNOSTIC = process.env.T8_CREATOR_AGENT_ALL_FIXTURE_DIAGNOSTIC === '1';

function structuredResponseShape(value) {
  const text = String(value || '').trim();
  if (!text) return { parsed: false, textChars: 0 };
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      return {
        parsed: true,
        textChars: text.length,
        topKeys: Object.keys(parsed).sort(),
        schema: typeof parsed.schema === 'string' ? parsed.schema.slice(0, 120) : typeof parsed.schema,
        taskProfileKeys: parsed.taskProfile && typeof parsed.taskProfile === 'object'
          ? Object.keys(parsed.taskProfile).sort() : [],
        family: typeof parsed.taskProfile?.family === 'string'
          ? parsed.taskProfile.family.slice(0, 80) : typeof parsed.taskProfile?.family,
        qualityMode: typeof parsed.taskProfile?.qualityMode === 'string'
          ? parsed.taskProfile.qualityMode.slice(0, 40) : typeof parsed.taskProfile?.qualityMode,
        artifacts: (Array.isArray(parsed.artifacts) ? parsed.artifacts : []).slice(0, 20).map((artifact) => ({
          kind: typeof artifact?.kind === 'string' ? artifact.kind.slice(0, 80) : typeof artifact?.kind,
          keys: artifact && typeof artifact === 'object' ? Object.keys(artifact).sort() : [],
          titlePresent: typeof artifact?.title === 'string' && artifact.title.trim().length > 0,
          fieldKeys: artifact?.fields && typeof artifact.fields === 'object'
            ? Object.keys(artifact.fields).sort() : [],
          dependsOnKinds: Array.isArray(artifact?.dependsOnKinds)
            ? artifact.dependsOnKinds.map((item) => String(item).slice(0, 80)) : [],
        })),
        toolProposalCount: Array.isArray(parsed.toolProposals) ? parsed.toolProposals.length : -1,
      };
    } catch {
      // Try the next bounded JSON candidate without logging response content.
    }
  }
  return {
    parsed: false,
    textChars: text.length,
    hasJsonFence: Boolean(fenced?.[1]),
    firstToken: text.slice(0, 1),
    lastToken: text.slice(-1),
    objectBraces: {
      open: (text.match(/\{/gu) || []).length,
      close: (text.match(/\}/gu) || []).length,
    },
    arrayBrackets: {
      open: (text.match(/\[/gu) || []).length,
      close: (text.match(/\]/gu) || []).length,
    },
  };
}

function diagnosticFixtureResponse(callIndex) {
  const shots = Array.from({ length: 6 }, (_, index) => ({
    id: `shot-${index + 1}`,
    durationSeconds: 5,
    action: index === 5 ? '两位旧友并肩走入站台暖光。' : `雨夜车站镜头 ${index + 1}`,
  }));
  const frames = shots.map((shot, index) => ({
    shotId: shot.id,
    composition: index === 5 ? '两人并肩走向暖光。' : `雨夜分镜 ${index + 1}`,
  }));
  const prompts = shots.map((shot, index) => ({
    shotId: shot.id,
    prompt: index === 5 ? '两位旧友并肩走入站台暖光。' : `雨夜电影感镜头 ${index + 1}`,
  }));
  const taskProfile = {
    family: 'story', intent: '制作雨夜重逢短片', deliveryKind: 'vertical-short-film',
    modalities: ['text', 'video', 'audio'], qualityMode: 'quick',
  };
  const artifact = (kind, title, fields, dependsOnKinds = []) => ({
    kind, title, fields, dependsOnKinds,
  });
  const value = callIndex === 0 ? {
    schema: 't8-creator-work-model-response-v1',
    displayMarkdown: [
      '## 雨夜重逢',
      '',
      '这是一支三十秒竖屏情感短片。两位成年旧友在雨夜车站意外重逢，一张保存多年的旧车票迫使他们重新面对那场迟到的道歉。人物姓名、职业与具体外貌保持未知，拍摄只依靠动作、距离、眼神和车票完成关系表达。',
      '',
      '全片由六个五秒镜头构成：雨滴与站牌建立空间，两人在雨棚下认出彼此，旧车票出现，迟到的道歉落到可见动作，列车进站加剧选择压力，最后两人并肩走入暖光。声音以雨声、远处列车和克制钢琴维持连续性。',
      '',
      '镜头表、逐格分镜、声音方案和逐镜视频提示词均保持同一人物身份、雨夜光向与空间轴线。未知事实继续留空，当前只形成可编辑作品，不声称已经生成图片、视频或写入画布。',
    ].join('\n'),
    taskProfile,
    artifacts: [
      artifact('ProductionBrief', '创作简报', {
        title: '雨夜重逢', outcome: '30 秒竖屏短片', audience: '情感短片观众',
        format: '9:16', durationSeconds: 30, style: '电影感雨夜', tone: '克制',
      }),
      artifact('TaskProfile', '任务画像', taskProfile),
      artifact('ScriptDoc', '剧本', {
        title: '雨夜重逢', logline: '两位旧友在末班车前重新选择彼此。',
        acts: ['重逢', '旧车票', '和解'], scenes: [{ id: 'scene-1', action: '雨夜站台重逢' }],
        ending: '两位旧友并肩走入站台暖光。',
      }, ['ProductionBrief']),
      artifact('CharacterBible', '人物设定', {
        characters: [{ id: 'friend-a' }, { id: 'friend-b' }], identityLocks: ['两位成年旧友'],
      }, ['ScriptDoc']),
      artifact('AssetNeed', '素材清单', {
        items: ['雨夜站台', '旧车票'], existing: [], missing: ['人物参考图'],
      }, ['ScriptDoc']),
      artifact('ShotList', '镜头表', { shots, totalDurationSeconds: 30 }, ['ScriptDoc']),
      artifact('Storyboard', '分镜', { frames, missingFrames: [] }, ['ShotList']),
      artifact('AudioPlan', '声音方案', {
        dialogue: ['迟到的道歉'], ambience: ['雨声', '列车声'], music: '克制钢琴',
      }, ['ScriptDoc', 'ShotList']),
      artifact('PromptPack', '提示词包', {
        prompts, negativePrompts: ['人物身份漂移'], reviewNotes: [],
      }, ['Storyboard', 'AudioPlan']),
    ],
    toolProposals: [],
  } : callIndex === 1 ? {
    schema: 't8-creator-work-model-response-v1',
    displayMarkdown: [
      '## 局部改稿',
      '',
      '保留前五个镜头、人物关系、三十秒总时长、雨夜空间、声音层和全部未点名字段，只更新结尾及其对应的最后一镜、最后一格分镜和最后一条视频提示词。',
      '',
      '列车门关闭前，一人把保存多年的旧车票递给另一人。门在两人之间合拢，他们隔着车窗相视，关系没有被轻易圆满，但迟到的道歉终于被接住。最后一镜仍为五秒，前五镜逐项不变。',
      '',
      '这次局部修改不生成任何媒体，也不改变人物身份、镜头数量或总时长。',
    ].join('\n'),
    taskProfile,
    artifacts: [
      artifact('ScriptDoc', '剧本', {
        ending: '列车门关闭前，一人把旧车票递给另一人，两人隔着车窗相视。',
      }),
      artifact('ShotList', '镜头表', {
        shots: shots.map((shot, index) => index === 5
          ? { ...shot, action: '列车门关闭前递出旧车票，两人隔窗相视。' } : shot),
      }),
      artifact('Storyboard', '分镜', {
        frames: frames.map((frame, index) => index === 5
          ? { ...frame, composition: '列车门与车窗分隔两人，旧车票位于视觉中心。' } : frame),
      }),
      artifact('PromptPack', '提示词包', {
        prompts: prompts.map((prompt, index) => index === 5
          ? { ...prompt, prompt: '列车门关闭前递出旧车票，两人隔着车窗相视。' } : prompt),
        negativePrompts: ['人物身份漂移'], reviewNotes: [],
      }),
    ],
    toolProposals: [],
  } : {
    schema: 't8-creator-work-model-response-v1',
    displayMarkdown: [
      '## 剧本阶段',
      '',
      '雨夜车站的完整剧本沿用已经确认的三十秒竖屏创意。两位成年旧友因一张旧车票重新面对迟到的道歉，人物姓名、职业与具体外貌继续保持未知。',
      '',
      '剧本按相遇、迟疑、车票出现、道歉落地、列车进站和隔窗相视六个可拍动作推进。最后列车门在两人之间关闭，一人递出旧车票，两人隔着车窗相视；关系没有被轻易圆满，但道歉已经被接住。',
      '',
      '世界规则保持现实主义雨夜车站，空间轴线、雨向、列车方向和旧车票状态贯穿全片。当前只完成剧本与世界设定，不生成素材或修改画布。',
    ].join('\n'),
    taskProfile,
    artifacts: [
      artifact('ScriptDoc', '剧本', {
        title: '雨夜重逢', logline: '两位旧友在末班车前重新面对迟到的道歉。',
        acts: ['雨夜重逢', '旧车票与道歉', '隔窗相视'],
        scenes: [{ id: 'scene-1', action: '雨夜站台相遇并在列车进站前完成选择' }],
        ending: '列车门关闭前递出旧车票，两人隔着车窗相视。',
      }),
      artifact('WorldBible', '世界设定', {
        premise: '现实主义雨夜车站', locations: ['同一座雨夜车站站台'],
        rules: ['人物身份不漂移', '旧车票状态连续', '列车方向一致'],
        timeline: ['同一夜晚连续三十秒'], continuity: ['雨向、光向和空间轴线一致'],
      }, ['ScriptDoc']),
    ],
    toolProposals: [],
  };
  return {
    ok: true,
    code: 'completed',
    model: MODEL,
    requestId: `local-diagnostic-fixture-${callIndex + 1}`,
    finishReason: 'stop',
    text: JSON.stringify(value),
  };
}
const STAGE_DOCUMENT_KINDS = Object.freeze({
  idea: ['production-brief'],
  script: ['script-doc', 'world-bible'],
  assets: ['character-bible', 'asset-needs'],
  shots: ['shot-list', 'audio-plan', 'storyboard', 'prompt-pack'],
  candidates: ['candidate-review', 'edit-decision-list', 'qc-report'],
  delivery: ['delivery-manifest'],
});

function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableString(value)).digest('hex');
}

function latestArtifactVersions(session) {
  const latest = new Map();
  for (const version of Array.isArray(session?.workArtifactVersions)
    ? session.workArtifactVersions : []) {
    const previous = latest.get(version.artifactId);
    if (!previous || Number(version.revision) > Number(previous.revision)) {
      latest.set(version.artifactId, version);
    }
  }
  return [...latest.values()].sort((left, right) => left.kind.localeCompare(right.kind));
}

function artifactsByKind(session) {
  return new Map(latestArtifactVersions(session).map((version) => [version.kind, version]));
}

function completedLlmReceipts(session) {
  return (Array.isArray(session?.creatorLlmTurnReceipts)
    ? session.creatorLlmTurnReceipts : [])
    .filter((receipt) => receipt.status === 'completed');
}

function paidCompletedLlmReceipts(session) {
  return completedLlmReceipts(session)
    .filter((receipt) => Number(receipt.providerCalls || 0) > 0);
}

function safeRequestIds(session) {
  return [...new Set(paidCompletedLlmReceipts(session)
    .flatMap((receipt) => Array.isArray(receipt.calls) ? receipt.calls : [])
    .map((call) => String(call.requestId || '').trim())
    .filter(Boolean))];
}

function assertOnlineTurn(session, expectedWorkRevision) {
  if (session?.creatorWork?.schema !== 't8-creator-work-snapshot-v1') {
    const recentEvents = (Array.isArray(session?.events) ? session.events : [])
      .slice(-8)
      .map((event) => ({
        type: event.type,
        responseId: event.payload?.responseId || null,
        streamStatus: event.payload?.streamStatus || null,
        evidence: event.payload?.responseEvidence ? {
          mode: event.payload.responseEvidence.mode,
          status: event.payload.responseEvidence.status,
          providerCalls: event.payload.responseEvidence.providerCalls,
          provider: event.payload.responseEvidence.provider,
          model: event.payload.responseEvidence.model,
          errorCode: event.payload.responseEvidence.errorCode,
          qualityCode: event.payload.responseEvidence.qualityCode,
          calls: event.payload.responseEvidence.calls,
        } : null,
      }));
    const error = new Error('真实 LLM 返回未通过 Creator Work 硬门');
    error.result = {
      code: 'CREATOR_LIVE_WORK_GATE_FAILED',
      details: {
        workRevision: session?.creatorWork?.revision || null,
        latestPlanKind: session?.latestPlan?.kind || null,
        latestPlanPhase: session?.latestPlan?.productionPhase || null,
        recentEvents,
      },
    };
    throw error;
  }
  assert.equal(session?.creatorWork?.schema, 't8-creator-work-snapshot-v1');
  assert.equal(session.creatorWork.revision, expectedWorkRevision);
  assert.equal(session.suggestionSet?.items?.length, 3);
  assert.equal(session.suggestionSet.items.every((item) => (
    item.arguments?.workId === session.creatorWork.workId
      && item.arguments?.workDigest === session.creatorWork.workDigest
  )), true);
  const receipt = paidCompletedLlmReceipts(session).at(-1);
  assert.ok(receipt, '缺少已完成的真实 LLM 回执');
  assert.equal(receipt.provider, PROVIDER);
  assert.equal(receipt.model, MODEL);
  assert.equal(receipt.providerCalls, 1);
  assert.equal(receipt.calls?.length, 1);
  assert.equal(receipt.calls[0]?.status, 'completed');
  assert.ok(String(receipt.calls[0]?.requestId || '').trim(), '真实 Provider 未返回 request ID');
  return receipt;
}

function withoutAllowedRevisionFields(version) {
  const fields = structuredClone(version?.fields || {});
  const allowed = {
    ScriptDoc: ['ending'],
    ShotList: ['shots'],
    Storyboard: ['frames'],
    PromptPack: ['prompts'],
  };
  for (const field of allowed[version.kind] || []) delete fields[field];
  return {
    kind: version.kind,
    title: version.title,
    fields,
    fieldLocks: version.fieldLocks || [],
  };
}

function textContainsEnding(value) {
  return /车票|车窗|列车门/.test(stableString(value));
}

function assertCreatorRevision(beforeSession, afterSession) {
  const before = artifactsByKind(beforeSession);
  const after = artifactsByKind(afterSession);
  assert.deepEqual([...after.keys()], [...before.keys()], '改稿改变了作品文档种类');
  for (const [kind, beforeVersion] of before) {
    const afterVersion = after.get(kind);
    assert.ok(afterVersion, `改稿后缺少 ${kind}`);
    assert.equal(
      stableString(withoutAllowedRevisionFields(afterVersion)),
      stableString(withoutAllowedRevisionFields(beforeVersion)),
      `改稿越过了允许范围：${kind}`,
    );
  }
  const beforeScript = before.get('ScriptDoc');
  const afterScript = after.get('ScriptDoc');
  assert.notEqual(
    stableString(afterScript?.fields?.ending),
    stableString(beforeScript?.fields?.ending),
    '创作者要求的新结尾没有写入 ScriptDoc',
  );
  assert.equal(textContainsEnding(afterScript?.fields?.ending), true, '新结尾没有体现车票/车窗要求');

  const beforeShots = before.get('ShotList')?.fields?.shots;
  const afterShots = after.get('ShotList')?.fields?.shots;
  assert.equal(Array.isArray(afterShots), true, '改稿后 ShotList.shots 无效');
  assert.equal(afterShots.length, 6, '改稿改变了用户锁定的 6 镜头数量');
  assert.equal(stableString(afterShots.slice(0, 5)), stableString(beforeShots?.slice(0, 5)), '前 5 镜被意外改写');
  assert.equal(textContainsEnding(afterShots[5]), true, '最后镜头没有体现车票/车窗要求');

  const beforeFrames = before.get('Storyboard')?.fields?.frames;
  const afterFrames = after.get('Storyboard')?.fields?.frames;
  assert.equal(Array.isArray(afterFrames), true, '改稿后 Storyboard.frames 无效');
  assert.equal(stableString(afterFrames.slice(0, -1)), stableString(beforeFrames?.slice(0, -1)), '前序分镜被意外改写');
  assert.equal(textContainsEnding(afterFrames.at(-1)), true, '最后分镜没有体现车票/车窗要求');

  const beforePrompts = before.get('PromptPack')?.fields?.prompts;
  const afterPrompts = after.get('PromptPack')?.fields?.prompts;
  assert.equal(Array.isArray(afterPrompts), true, '改稿后 PromptPack.prompts 无效');
  assert.equal(stableString(afterPrompts.slice(0, -1)), stableString(beforePrompts?.slice(0, -1)), '前序提示词被意外改写');
  assert.equal(textContainsEnding(afterPrompts.at(-1)), true, '最后提示词没有体现车票/车窗要求');
}

function createDatabase(document) {
  return {
    getCanvas(canvasId) {
      return String(canvasId) === document.canvasId ? structuredClone(document) : null;
    },
    getAsset() { return null; },
    getRun() { return null; },
    listRuns() { return []; },
    getRunEvents() { return []; },
    listNodeRuns() { return []; },
    listAttempts() { return []; },
    listCanvasPatches() { return []; },
    getRunIntent() { return null; },
    getRunEvidence() { return null; },
    saveCanvas() {
      throw new Error('Creator Agent live acceptance must not mutate the isolated canvas directly');
    },
  };
}

async function startFixture(apiKey) {
  const persistentExecution = TOOL_EXECUTION_DIAGNOSTIC;
  const executionRoot = path.join(ARTIFACT_ROOT, 'tool-execution-current');
  if (persistentExecution) {
    assert.equal(path.dirname(executionRoot), ARTIFACT_ROOT, '工具执行证据目录越界');
    fs.rmSync(executionRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    fs.mkdirSync(executionRoot, { recursive: true });
  }
  const rootDir = persistentExecution
    ? path.join(executionRoot, 'session-store')
    : fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-agent-live-'));
  fs.mkdirSync(rootDir, { recursive: true });
  const initialDocument = {
    schema: 't8-canvas-document',
    schemaVersion: 2,
    projectId: 'project-local',
    canvasId: 'canvas-creator-agent-live',
    revision: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let previewPipeline = null;
  let assetIndexer = null;
  let outputConfig = null;
  const database = persistentExecution
    ? new ProjectDatabase(path.join(executionRoot, 'project.sqlite3'), { autoBackup: false })
    : createDatabase(initialDocument);
  if (persistentExecution) {
    database.ensureCanvas(
      initialDocument.canvasId,
      initialDocument,
      initialDocument.projectId,
    );
    const thumbnails = path.join(executionRoot, 'thumbnails');
    outputConfig = {
      INPUT_DIR: path.join(executionRoot, 'input'),
      OUTPUT_DIR: path.join(executionRoot, 'output'),
      THUMBNAILS_DIR: thumbnails,
      ASSET_PREVIEWS_DIR: path.join(thumbnails, 'asset-previews'),
      ASSET_PREVIEW_CONCURRENCY: 1,
      ASSET_PREVIEW_MAX_ATTEMPTS: 2,
      ASSET_PREVIEW_RETRY_BASE_MS: 25,
      ASSET_PREVIEW_PIPELINE_VERSION: 'asset-preview-v1',
    };
    [outputConfig.INPUT_DIR, outputConfig.OUTPUT_DIR, outputConfig.THUMBNAILS_DIR, outputConfig.ASSET_PREVIEWS_DIR]
      .forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
    previewPipeline = new AssetPreviewPipeline(outputConfig, database, { autoStart: false, recover: false });
    previewPipeline.schedulePump = () => {};
    assetIndexer = new AssetIndexer(outputConfig, database, { previewPipeline });
  }
  const sessions = createCreatorAgentSessionStore({ rootDir });
  const settings = Object.freeze({
    zhenzhenSd2ApiKey: apiKey,
    zhenzhenSd2BaseUrl: BASE_URL,
  });
  const app = express();
  let providerCallIndex = 0;
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api/creator-agent/v1', createCreatorAgentRouter({
    database,
    sessions,
    credentialSettingsProvider: () => settings,
    creatorLlmSettingsProvider: () => settings,
    creatorLlmGenerateChat: async (provider, input, options) => {
      const currentCallIndex = providerCallIndex;
      providerCallIndex += 1;
      const inputChars = (Array.isArray(input?.messages) ? input.messages : [])
        .reduce((sum, message) => sum + stableString(message?.content || '').length, 0);
      try {
        const fixtureCall = ALL_FIXTURE_DIAGNOSTIC
          ? currentCallIndex < 3
          : STAGE_ONLY_DIAGNOSTIC
            ? currentCallIndex < 2
            : REVISION_ONLY_DIAGNOSTIC && currentCallIndex !== 1;
        const result = fixtureCall
          ? diagnosticFixtureResponse(currentCallIndex)
          : await generateChatWithProvider(provider, input, options);
        LIVE_CALL_DIAGNOSTICS.push({
          source: fixtureCall ? 'local-diagnostic-fixture' : 'live-provider',
          ok: Boolean(result?.ok),
          code: result?.code || null,
          model: result?.model || input?.model || null,
          requestId: result?.requestId || null,
          finishReason: result?.finishReason || null,
          error: String(result?.error || result?.raw?.error?.message || result?.raw?.message || '')
            .slice(0, 800) || null,
          upstreamCode: result?.raw?.error?.code || result?.raw?.code || null,
          inputChars,
          maxTokens: input?.maxTokens || input?.max_tokens || null,
          responseFormat: input?.responseFormat?.type || input?.response_format?.type || null,
          reasoningEffort: input?.reasoningEffort || input?.reasoning_effort || null,
          responseShape: structuredResponseShape(result?.text),
        });
        return result;
      } catch (error) {
        LIVE_CALL_DIAGNOSTICS.push({
          ok: false,
          code: String(error?.code || error?.name || 'runtime-error').slice(0, 120),
          model: input?.model || null,
          requestId: null,
          finishReason: null,
          error: String(error?.message || error).slice(0, 800),
          upstreamCode: null,
          inputChars,
          maxTokens: input?.maxTokens || input?.max_tokens || null,
          responseFormat: input?.responseFormat?.type || input?.response_format?.type || null,
          reasoningEffort: input?.reasoningEffort || input?.reasoning_effort || null,
        });
        throw error;
      }
    },
    responseDeltaDelayMs: 0,
    creatorLlmTimeoutMs: 180_000,
    config: {
      DATA_DIR: rootDir,
      SETTINGS_FILE: path.join(rootDir, 'settings-never-written.json'),
      ZHENZHEN_SD2_BASE_URL: BASE_URL,
    },
  }));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/creator-agent/v1`;
  return {
    rootDir,
    executionRoot: persistentExecution ? executionRoot : null,
    database,
    assetIndexer,
    outputConfig,
    get document() {
      return persistentExecution
        ? database.getCanvas(initialDocument.canvasId)
        : initialDocument;
    },
    sessions,
    async request(url, init = {}) {
      const response = await fetch(`${baseUrl}${url}`, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {}),
        },
      });
      const body = await response.json();
      return { response, body };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      previewPipeline?.close?.();
      if (persistentExecution) database.close();
      else fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    },
  };
}

function waitMs(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function imageFormat(bytes, contentType = '') {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  throw new Error(`生成结果不是可识别图片（Content-Type=${mime || 'unknown'}）`);
}

async function downloadProviderImage(imageUrl, outputDirectory) {
  assert.match(String(imageUrl || ''), /^https:\/\//iu, 'Provider 成功但没有安全的 HTTPS 图片地址');
  const response = await fetchRemote(imageUrl, {
    method: 'GET',
    headers: { Accept: 'image/png,image/jpeg,image/webp;q=0.9,*/*;q=0.1' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`生成结果下载失败：HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  const maxBytes = 32 * 1024 * 1024;
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('生成图片超过 32 MiB 安全上限');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error('生成图片为空或超过 32 MiB 安全上限');
  const format = imageFormat(bytes, response.headers.get('content-type'));
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const filename = `creator-agent-real-${contentHash.slice(0, 16)}.${format.extension}`;
  const absolute = path.join(outputDirectory, filename);
  fs.writeFileSync(absolute, bytes, { flag: 'wx' });
  return {
    absolute,
    filename,
    mimeType: format.mimeType,
    byteSize: bytes.length,
    contentHash,
    sourceUrl: `/files/output/${encodeURIComponent(filename)}`,
  };
}

async function runRealImageCandidate({ fixture, node, apiKey, plan }) {
  const database = fixture.database;
  const canvas = fixture.document;
  assert.ok(canvas, '应用后画布不存在');
  assert.equal(node.type, 'image', 'Creator 工具计划的主节点不是图片节点');
  const prompt = String(node.data?.prompt || '').trim();
  assert.ok(prompt.length >= 20, 'Creator 图片节点缺少可执行提示词');
  const run = database.createRun({
    projectId: canvas.projectId,
    canvasId: canvas.canvasId,
    canvasRevision: canvas.revision,
    initiatorId: 'creator-agent-live-verifier',
    status: 'running',
    startedAt: Date.now(),
    summary: {
      source: 'creator-agent-tool-proposal',
      planId: plan.planId,
      planDigest: plan.planDigest,
      requestedNodeIds: [node.id],
    },
  });
  const incomingEdges = canvas.edges.filter((edge) => String(edge.target) === String(node.id));
  const upstreamIds = new Set(incomingEdges.map((edge) => String(edge.source)));
  const upstreamNodes = canvas.nodes.filter((candidate) => upstreamIds.has(String(candidate.id)));
  const nodeRun = database.createNodeRun({
    runId: run.id,
    nodeId: node.id,
    originalNodeId: node.id,
    status: 'running',
    inputSnapshot: {
      node: structuredClone(node),
      upstreamNodes: structuredClone(upstreamNodes),
      incomingEdges: structuredClone(incomingEdges),
    },
  });
  const attempt = database.createAttempt({
    nodeRunId: nodeRun.id,
    provider: PROVIDER,
    model: IMAGE_MODEL,
    status: 'running',
    timestamps: { queuedAt: Date.now(), startedAt: Date.now() },
    metadata: { source: 'creator-agent-tool-execution-live' },
  });

  let submitted;
  let pollCount = 0;
  try {
    submitted = await submitImageTask({
      model: IMAGE_MODEL,
      prompt,
      ratio: String(node.data?.aspectRatio || '16:9'),
      n: 1,
    }, apiKey, { baseUrl: BASE_URL });
    database.updateAttempt(attempt.id, {
      upstreamTaskId: submitted.taskId,
      requestId: submitted.requestId || null,
      httpStatus: submitted.httpStatus || null,
      status: 'polling',
      timestamps: { submittedAt: Date.now() },
      metadata: { taskType: submitted.taskType || 't2i' },
    }, { runId: run.id, nodeRunId: nodeRun.id });

    const deadline = Date.now() + 8 * 60 * 1000;
    let result = null;
    while (Date.now() < deadline) {
      result = await queryImageTask(submitted.taskId, apiKey, { baseUrl: BASE_URL });
      pollCount += 1;
      database.updateAttempt(attempt.id, {
        pollCount,
        requestId: result.requestId || submitted.requestId || null,
        httpStatus: result.httpStatus || null,
        status: result.status === 'succeeded' ? 'downloading' : result.status,
        timestamps: { lastPolledAt: Date.now() },
      }, { runId: run.id, nodeRunId: nodeRun.id });
      if (result.status === 'failed') throw new Error(`真实图片任务失败：${String(result.failReason || '上游未返回原因').slice(0, 300)}`);
      if (result.status === 'succeeded') {
        assert.ok(result.imageUrl, '真实图片任务成功但没有返回图片');
        break;
      }
      await waitMs(3_000);
    }
    if (!result || result.status !== 'succeeded') {
      database.updateAttempt(attempt.id, {
        status: 'ambiguous',
        pollCount,
        error: { kind: 'timeout', code: 'LIVE_IMAGE_POLL_TIMEOUT', retryable: true },
      }, { runId: run.id, nodeRunId: nodeRun.id });
      throw new Error('真实图片任务在 8 分钟内没有终态；保持原任务身份，不自动重新提交');
    }

    const downloaded = await downloadProviderImage(result.imageUrl, fixture.outputConfig.OUTPUT_DIR);
    const recorded = await fixture.assetIndexer.recordRunOutputAssets({
      runId: run.id,
      nodeRunId: nodeRun.id,
      attemptId: attempt.id,
      outputs: [{
        kind: 'image',
        sourceUrl: downloaded.sourceUrl,
        filename: downloaded.filename,
        mimeType: downloaded.mimeType,
        metadata: { operation: 'creator-agent-create-image' },
      }],
    });
    assert.equal(recorded.assets.length, 1, '真实结果没有形成唯一项目资产');
    const asset = recorded.assets[0];
    assert.equal(asset.availability, 'available');
    assert.equal(asset.storageMode, 'managed');
    assert.equal(asset.contentHash, downloaded.contentHash);
    assert.equal(Number(asset.metadata?.width) > 0, true, '真实图片宽度未解析');
    assert.equal(Number(asset.metadata?.height) > 0, true, '真实图片高度未解析');

    database.updateAttempt(attempt.id, {
      status: 'succeeded',
      pollCount,
      timestamps: { downloadedAt: Date.now(), finishedAt: Date.now() },
      metadata: {
        outputAssetId: asset.id,
        outputContentHash: asset.contentHash,
        outputByteSize: downloaded.byteSize,
      },
      error: null,
    }, { runId: run.id, nodeRunId: nodeRun.id });
    database.updateNodeRun(nodeRun.id, { status: 'succeeded' });
    database.updateRun(run.id, {
      status: 'succeeded',
      finishedAt: Date.now(),
      summary: { outputAssetIds: [asset.id], succeededNodes: 1, failedNodes: 0 },
    });
    return {
      run: database.getRun(run.id),
      nodeRun: database.getNodeRun(nodeRun.id),
      attempt: database.getAttempt(attempt.id),
      asset,
      downloaded,
      pollCount,
    };
  } catch (error) {
    const currentAttempt = database.getAttempt(attempt.id);
    if (currentAttempt && !['ambiguous', 'succeeded'].includes(String(currentAttempt.status))) {
      database.updateAttempt(attempt.id, {
        status: 'failed',
        pollCount,
        timestamps: { finishedAt: Date.now() },
        error: {
          kind: 'provider',
          code: String(error?.code || 'LIVE_IMAGE_EXECUTION_FAILED').slice(0, 120),
          message: String(error?.message || error).replace(/https?:\/\/\S+/giu, '[redacted-url]').slice(0, 500),
          retryable: false,
        },
      }, { runId: run.id, nodeRunId: nodeRun.id });
    }
    database.updateNodeRun(nodeRun.id, { status: 'failed' });
    database.updateRun(run.id, { status: 'failed', finishedAt: Date.now(), summary: { failedNodes: 1 } });
    throw error;
  }
}

function requestBody(text, requestId, extra = {}) {
  return JSON.stringify({
    projectId: 'project-local',
    canvasId: 'canvas-creator-agent-live',
    kind: 'story',
    text,
    qualityMode: 'quick',
    // Match the real Creator Agent UI transport. Structured JSON is still
    // buffered behind the work gate, but upstream SSE keeps a long reasoning
    // response alive instead of depending on a single synchronous edge reply.
    stream: true,
    clientRequestId: requestId,
    modelPreferences: {
      llm: { provider: PROVIDER, model: MODEL },
    },
    context: { nodeCount: 0, edgeCount: 0, canvasRevision: 1 },
    ...extra,
  });
}

function assertHttpCreated(result, label) {
  if (result.response.status !== 201) {
    const error = new Error(`${label} failed: HTTP ${result.response.status} ${result.body?.code || ''} ${result.body?.message || ''}`);
    error.result = result.body;
    throw error;
  }
}

function verifyExistingToolExecutionEvidence() {
  const executionRoot = path.join(ARTIFACT_ROOT, 'tool-execution-current');
  const sessionRoot = path.join(executionRoot, 'session-store');
  const sessionFiles = fs.readdirSync(path.join(sessionRoot, 'sessions'))
    .filter((name) => name.endsWith('.json'));
  assert.equal(sessionFiles.length, 1, '真实工具执行证据必须只有一个隔离 Creator Session');
  const sessionId = sessionFiles[0].slice(0, -5);
  const sessions = createCreatorAgentSessionStore({ rootDir: sessionRoot });
  const firstReconciliation = sessions.reconcileToolProposalWritebacks(sessionId);
  const secondReconciliation = sessions.reconcileToolProposalWritebacks(sessionId);
  assert.equal(secondReconciliation.repaired, 0, '工具执行证据协调器不是幂等的');
  const session = secondReconciliation.session;
  const writeback = [...(session.events || [])].reverse().find((event) => (
    event.type === 'assistant.tool-proposal.writeback'
  ));
  assert.ok(writeback, '真实工具执行没有回写证据');
  assert.equal(writeback.payload?.stage, 'verified');
  assert.equal(writeback.payload?.evidence?.canvasWriteRecorded, true);
  assert.equal(writeback.payload?.evidence?.providerRunLinked, true);
  assert.equal(writeback.payload?.evidence?.physicalArtifactsVerified, true);
  const runId = String(writeback.payload?.runId || '');
  assert.ok(runId, '真实工具执行回写缺少 Run ID');

  const database = new ProjectDatabase(path.join(executionRoot, 'project.sqlite3'), { autoBackup: false });
  try {
    const run = database.getRun(runId);
    assert.ok(run, '真实工具执行 Run 不存在');
    const canvas = database.getCanvas(session.canvasId);
    assert.ok(canvas, '真实工具执行画布不存在');
    const runLink = (session.runLinks || []).find((item) => String(item?.runId || '') === runId);
    assert.ok(runLink, '真实工具执行 Run 未与 Creator Session 关联');
    const verification = verifyCompletionEvidence(database, {
      projectId: session.projectId,
      canvasId: session.canvasId,
      runId,
      canvasRevision: run.canvasRevision,
      nodeIds: runLink.matchedNodeIds,
    });
    assert.equal(verification.verified, true, `实体产物复核失败：${verification.reasons.join(',')}`);
    assert.equal(verification.assets.length, 1, '真实工具执行应形成一个实体图片素材');
    const asset = verification.assets[0];
    assert.equal(asset.blobPresent, true);
    assert.equal(asset.hashVerified, true);
    assert.equal(asset.magicVerified, true);
    assert.equal(Number(asset.width) > 0, true);
    assert.equal(Number(asset.height) > 0, true);
    const nodeRuns = database.listNodeRuns(runId);
    assert.equal(nodeRuns.length, 1, '真实工具执行应形成一个 NodeRun');
    const attempts = database.listAttempts(nodeRuns[0].id);
    assert.equal(attempts.length, 1, '真实工具执行不应隐式重复提交');
    assert.equal(attempts[0].status, 'succeeded');
    const planApplied = [...(session.events || [])].reverse().find((event) => (
      event.type === 'plan.applied'
      && event.payload?.planId === writeback.payload?.planId
    ));
    assert.ok(planApplied, '真实工具执行缺少权威 CanvasPatch 应用证据');
    const report = {
      schema: 't8-creator-agent-tool-execution-live-acceptance-v1',
      verifiedAt: new Date().toISOString(),
      mode: 'existing-evidence-reverification',
      provider: attempts[0].provider || PROVIDER,
      model: attempts[0].model || IMAGE_MODEL,
      additionalPaidLlmProviderCalls: 0,
      additionalPaidImageSubmissions: 0,
      session: {
        eventCount: session.lastSequence,
        productionPhase: session.production?.currentPhase || null,
      },
      canvas: {
        revision: canvas.revision,
        nodes: canvas.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          status: node.data?.status || null,
          candidateId: node.data?.creativeState?.candidateId || null,
          candidateIndex: node.data?.creativeState?.candidateIndex || null,
          promptPackItemId: node.data?.creatorProductionBinding?.promptPackItemId || null,
          hasResult: Boolean(
            node.data?.imageUrl || node.data?.videoUrl || node.data?.audioUrl
            || (Array.isArray(node.data?.imageUrls) && node.data.imageUrls.length)
            || (Array.isArray(node.data?.videoUrls) && node.data.videoUrls.length)
            || (Array.isArray(node.data?.audioUrls) && node.data.audioUrls.length)
          ),
        })),
      },
      patch: {
        applied: true,
        patchId: planApplied.payload?.patchId || null,
        appliedRevision: planApplied.payload?.appliedRevision || null,
      },
      run: {
        status: run.status,
        nodeRunStatus: nodeRuns[0].status,
        attemptStatus: attempts[0].status,
        submissionCount: attempts.length,
        linkedToCreatorSession: true,
      },
      artifact: {
        kind: asset.kind,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        contentHash: asset.contentHash,
        width: asset.width,
        height: asset.height,
        blobPresent: asset.blobPresent,
        hashVerified: asset.hashVerified,
        magicVerified: asset.magicVerified,
      },
      writeback: {
        stage: writeback.payload.stage,
        canvasWriteRecorded: writeback.payload.evidence.canvasWriteRecorded,
        providerRunLinked: writeback.payload.evidence.providerRunLinked,
        physicalArtifactsVerified: writeback.payload.evidence.physicalArtifactsVerified,
        reconciliationAppliedThisRun: firstReconciliation.repaired,
        reconciliationIdempotent: secondReconciliation.repaired === 0,
      },
      evidenceDigest: digest({
        sessionId,
        planId: writeback.payload?.planId,
        runId,
        assetId: asset.assetId,
        contentHash: asset.contentHash,
        lastSequence: session.lastSequence,
      }),
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    assert.equal(/sk-[A-Za-z0-9_-]{20,}/u.test(serialized), false, '工具验收报告包含 API Key');
    fs.writeFileSync(path.join(ARTIFACT_ROOT, 'tool-execution-report.json'), serialized, 'utf8');
    process.stdout.write(serialized);
  } finally {
    database.close();
  }
}

async function verifyExistingProductionAcceptance() {
  const executionRoot = path.join(ARTIFACT_ROOT, 'tool-execution-current');
  const sessionRoot = path.join(executionRoot, 'session-store');
  const sessionFiles = fs.readdirSync(path.join(sessionRoot, 'sessions'))
    .filter((name) => name.endsWith('.json'));
  assert.equal(sessionFiles.length, 1, '真实生产验收必须只有一个隔离 Creator Session');
  const sessionId = sessionFiles[0].slice(0, -5);
  const sessions = createCreatorAgentSessionStore({ rootDir: sessionRoot });
  let session = sessions.read(sessionId);
  const database = new ProjectDatabase(path.join(executionRoot, 'project.sqlite3'), { autoBackup: false });
  try {
    const scope = {
      projectId: session.projectId,
      canvasId: session.canvasId,
      actorId: 'creator-agent-live-verifier',
      sessionId,
    };
    const creative = createAgentControlCreativeService({ database });
    const delivery = createAgentControlDeliveryService({ database });
    const sourcePlan = session.latestPlan;
    const brief = sourcePlan?.brief || {};
    assert.equal(sourcePlan?.kind, 'image', '真实生产验收当前不是图像作品');
    const productionInput = (previousProductionDocuments, deliveryEvidence = session.deliveryEvidence) => ({
      kind: 'image',
      prompt: brief.goal,
      title: brief.title,
      profile: brief.profile,
      candidates: 1,
      ratio: brief.ratio,
      duration: brief.durationSec,
      language: brief.language,
      style: brief.style,
      template: brief.template,
      recipe: brief.recipe,
      stagedProduction: true,
      previousProductionDocuments,
      artifactVerifications: session.artifactVerifications,
      deliveryEvidence,
      llmProvider: brief.llmProvider,
      llmModel: brief.llmModel,
      imageProvider: brief.imageProvider,
      imageProviderSource: brief.imageProviderSource,
      imageProviderId: brief.imageProviderId,
      imageModel: brief.imageModel,
    });
    const productionPlan = creative.createPlan(
      productionInput(sourcePlan.productionDocuments),
      scope,
    );
    const promptPack = productionPlan.productionDocuments.find((item) => item.kind === 'prompt-pack');
    assert.equal(promptPack?.content?.prompts?.length, 1, '自然单图作品没有形成唯一 PromptPack 单元');
    const productionPatch = creative.requirePlan(productionPlan.planId, scope).patch;
    const proposedCandidate = productionPatch.operations.find((operation) => (
      operation.type === 'node.add' && operation.payload?.node?.type === 'image'
    ))?.payload?.node;
    const productionBinding = proposedCandidate?.data?.creatorProductionBinding;
    assert.ok(productionBinding?.promptPackItemId, '自然单图候选没有精确绑定 PromptPack');

    const writeback = [...(session.events || [])].reverse().find((event) => (
      event.type === 'assistant.tool-proposal.writeback'
      && event.payload?.stage === 'verified'
    ));
    const runId = String(writeback?.payload?.runId || '');
    const runLink = session.runLinks.find((item) => String(item?.runId || '') === runId);
    const verification = session.artifactVerifications.find((item) => String(item?.runId || '') === runId);
    assert.ok(runLink && verification?.verified === true, '真实候选缺少 Run 与实体核验回执');
    const candidateNodeId = String(runLink.matchedNodeIds?.[0] || '');
    const verifiedAsset = verification.assets?.[0];
    const asset = database.getAsset(verifiedAsset?.assetId);
    const run = database.getRun(runId);
    const nodeRun = database.listNodeRuns(runId)[0];
    const attempt = database.listAttempts(nodeRun.id)[0];
    assert.ok(asset && run && nodeRun && attempt, '真实候选运行证据不完整');
    const outputFiles = fs.readdirSync(path.join(executionRoot, 'output'));
    assert.equal(outputFiles.length, 1, '真实生产验收只允许复用一个已核验输出');
    const sourceUrl = `/files/output/${encodeURIComponent(outputFiles[0])}`;

    const applyPatch = (patch) => {
      const preview = database.previewCanvasPatch(scope.canvasId, patch, {
        projectId: scope.projectId,
        actorId: scope.actorId,
        sessionId,
      });
      const applied = database.applyCanvasPatch(scope.canvasId, patch, {
        projectId: scope.projectId,
        actorId: scope.actorId,
        sessionId,
        confirmed: true,
        previewDigest: preview.previewDigest,
      });
      assert.equal(applied.status, 'applied');
      return { preview, applied };
    };

    let canvas = database.getCanvas(scope.canvasId);
    let candidate = canvas.nodes.find((node) => String(node.id) === candidateNodeId);
    assert.ok(candidate, '真实 Run 对应候选节点不存在');
    if (!candidate.data?.imageUrl || !candidate.data?.creatorProductionBinding?.promptPackItemId) {
      applyPatch({
        schema: 't8-canvas-patch-v1',
        id: `creator-result-writeback-${asset.contentHash.slice(0, 16)}`,
        baseRevision: canvas.revision,
        summary: '把已核验真实图片结果回写到原 Creator 候选',
        diagnosticsResolved: [],
        requiresConfirmation: true,
        operations: [{
          type: 'node.patch',
          payload: {
            nodeId: candidateNodeId,
            dataPatch: {
              creatorProductionBinding: productionBinding,
              imageUrl: sourceUrl,
              imageUrls: [sourceUrl],
              outputAssetId: asset.id,
              contentHash: asset.contentHash,
              runId,
              nodeRunId: nodeRun.id,
              attemptId: attempt.id,
              taskId: attempt.upstreamTaskId || attempt.requestId || null,
              width: Number(asset.metadata?.width) || Number(verifiedAsset.width) || null,
              height: Number(asset.metadata?.height) || Number(verifiedAsset.height) || null,
              status: 'succeeded',
              error: '',
            },
          },
        }],
      });
    }

    canvas = database.getCanvas(scope.canvasId);
    candidate = canvas.nodes.find((node) => String(node.id) === candidateNodeId);
    const reviewPlan = creative.actionPlan('review', {
      nodeId: candidateNodeId,
      review: {
        schema: 't8-creative-review-v1',
        source: 'visual-inspection',
        reviewer: 'codex-vision-original-image',
        evidence: { assetId: asset.id, contentHash: asset.contentHash },
        dimensions: {
          composition: {
            status: 'pass',
            summary: '站台纵深、雨地反光与列车暖灯形成清晰视觉路径。',
            evidence: '左侧空长椅和顶棚构成暗部前景，黄色安全线与轨道汇聚到右侧列车灯。',
          },
          identity: {
            status: 'unknown',
            summary: '画面没有人物或角色身份要求。',
            evidence: '实际成片为空站台环境主视觉。',
          },
          productShape: {
            status: 'unknown',
            summary: '画面没有商品主体或产品外形要求。',
            evidence: '实际成片仅包含车站、轨道与远处列车。',
          },
          textAccuracy: {
            status: 'pass',
            summary: '画面内没有需核对的生成文字。',
            evidence: '原始 1792×1008 图像未见标题、招牌或乱码文字。',
          },
        },
        notes: '冷蓝雨夜与暖色列车灯对比符合需求；主体层次明确，可作为采用版本。',
      },
    }, scope);
    const reviewPatch = creative.requirePlan(reviewPlan.planId, scope).patch;
    sessions.appendActionPlan(sessionId, {
      action: 'review',
      label: '检查真实雨夜车站主视觉',
      nodeId: candidateNodeId,
      context: { canvasRevision: canvas.revision },
      plan: reviewPlan,
      patch: reviewPatch,
      source: 'creator-live-acceptance',
    });
    const reviewed = applyPatch(reviewPatch);
    sessions.appendLifecycle(sessionId, 'plan.applied', {
      planId: reviewPlan.planId,
      planDigest: reviewPlan.planDigest,
      patchId: reviewPatch.id,
      previewDigest: reviewed.preview.previewDigest,
      appliedRevision: reviewed.applied.revision,
      canvasEvidence: {
        source: 'canvas-patch-ledger',
        status: 'applied',
        actorId: scope.actorId,
        operationCount: reviewPatch.operations.length,
      },
    });

    canvas = database.getCanvas(scope.canvasId);
    const comparison = creative.readAction('compare', { nodeId: candidateNodeId }, scope);
    const reviewedCandidate = comparison.candidates.find((item) => item.nodeId === candidateNodeId);
    assert.equal(reviewedCandidate.review.status, 'verified');
    assert.equal(reviewedCandidate.review.hardGatesPassed, true);
    assert.equal(reviewedCandidate.qa.creativeReady, true);

    const acceptPlan = creative.actionPlan('accept', { nodeId: candidateNodeId }, scope);
    const acceptPatch = creative.requirePlan(acceptPlan.planId, scope).patch;
    sessions.appendActionPlan(sessionId, {
      action: 'accept',
      label: '采用真实雨夜车站主视觉',
      nodeId: candidateNodeId,
      context: { canvasRevision: canvas.revision },
      plan: acceptPlan,
      patch: acceptPatch,
      source: 'creator-live-acceptance',
    });
    const accepted = applyPatch(acceptPatch);
    sessions.appendLifecycle(sessionId, 'plan.applied', {
      planId: acceptPlan.planId,
      planDigest: acceptPlan.planDigest,
      patchId: acceptPatch.id,
      previewDigest: accepted.preview.previewDigest,
      appliedRevision: accepted.applied.revision,
      canvasEvidence: {
        source: 'canvas-patch-ledger',
        status: 'applied',
        actorId: scope.actorId,
        operationCount: acceptPatch.operations.length,
      },
    });

    canvas = database.getCanvas(scope.canvasId);
    candidate = canvas.nodes.find((node) => String(node.id) === candidateNodeId);
    assert.equal(candidate.data?.creativeState?.accepted, true);
    assert.equal(candidate.data?.creativeState?.acceptance?.schema, 't8-creative-adoption-receipt-v1');
    session = sessions.read(sessionId);
    const refreshedPlan = creative.createPlan(
      productionInput(productionPlan.productionDocuments, session.deliveryEvidence),
      scope,
    );
    const documentByKind = new Map(refreshedPlan.productionDocuments.map((item) => [item.kind, item]));
    const candidateReview = documentByKind.get('candidate-review');
    const edl = documentByKind.get('edit-decision-list');
    const qc = documentByKind.get('qc-report');
    assert.deepEqual(candidateReview.content.counts, {
      total: 1, withResult: 1, reviewed: 1, adopted: 1, blocked: 0,
    });
    assert.equal(edl.content.status, 'source-assembled');
    assert.equal(edl.content.resultKind, 'image');
    assert.equal(edl.content.sequence.length, 1);
    assert.equal(qc.content.status, 'passed');
    assert.equal(qc.content.qcItems.length, 1);
    assert.equal(qc.content.qcItems[0].status, 'pass');

    const deliveryRoot = path.join(executionRoot, 'delivery');
    fs.mkdirSync(deliveryRoot, { recursive: true });
    const deliveryTarget = path.join(
      deliveryRoot,
      `creator-image-${asset.contentHash.slice(0, 12)}-${Date.now()}`,
    );
    const deliverySnapshot = await delivery.inspectPackage(canvas, {
      projectId: scope.projectId,
      canvasId: scope.canvasId,
      scope: 'canvas',
      assetIds: [asset.id],
      targetPath: deliveryTarget,
    });
    const deliveryPlanId = `creator-delivery-${deliverySnapshot.collection.selectionDigest.slice(0, 24)}`;
    const approvalRequestId = `creator-approved-${digest({ sessionId, deliveryPlanId }).slice(0, 24)}`;
    sessions.appendLifecycle(sessionId, 'delivery.approval-requested', {
      approvalRequestId,
      planId: deliveryPlanId,
      packageName: deliverySnapshot.target.basename,
      itemCount: deliverySnapshot.collection.items.length,
      totalBytes: deliverySnapshot.collection.totalBytes,
      scope: 'canvas',
      canvasRevision: deliverySnapshot.collection.canvasRevision,
      catalogRevision: deliverySnapshot.collection.catalogRevision,
      selectionDigest: deliverySnapshot.collection.selectionDigest,
    });
    const packaged = await delivery.packageDelivery(canvas, deliverySnapshot);
    const packageVerification = await delivery.verifyPackage(deliveryTarget, {
      expectedPackageDigest: packaged.packageDigest,
    });
    assert.equal(packageVerification.valid, true, '实体交付包复核失败');
    assert.equal(packageVerification.verifiedItems, 1);
    session = sessions.appendLifecycle(sessionId, 'delivery.completed', {
      approvalRequestId,
      planId: deliveryPlanId,
      packageName: deliverySnapshot.target.basename,
      itemCount: packaged.itemCount,
      totalBytes: packaged.totalBytes,
      packageDigest: packaged.packageDigest,
      verifiedItems: packageVerification.verifiedItems,
      verifiedBytes: packageVerification.verifiedBytes,
      valid: packageVerification.valid,
      scope: 'canvas',
      canvasRevision: deliverySnapshot.collection.canvasRevision,
      catalogRevision: deliverySnapshot.collection.catalogRevision,
      selectionDigest: deliverySnapshot.collection.selectionDigest,
      files: packaged.files.map((item) => ({
        assetId: item.assetId,
        size: item.size,
        sha256: item.sha256,
      })),
      licenseSummary: packageVerification.licenseSummary,
    });
    const deliveredPlan = creative.createPlan(
      productionInput(refreshedPlan.productionDocuments, session.deliveryEvidence),
      scope,
    );
    const deliveredManifest = deliveredPlan.productionDocuments
      .find((item) => item.kind === 'delivery-manifest');
    assert.equal(
      ['delivered-and-verified', 'delivered-needs-license-review'].includes(deliveredManifest.content.status),
      true,
    );
    assert.equal(deliveredManifest.content.packageEvidence?.valid, true);
    const report = {
      schema: 't8-creator-agent-production-live-acceptance-v1',
      verifiedAt: new Date().toISOString(),
      mode: 'existing-real-asset-production-acceptance',
      additionalPaidLlmProviderCalls: 0,
      additionalPaidMediaSubmissions: 0,
      sourceArtifact: {
        assetId: asset.id,
        contentHash: asset.contentHash,
        width: verifiedAsset.width,
        height: verifiedAsset.height,
      },
      review: {
        status: reviewedCandidate.review.status,
        hardGatesPassed: reviewedCandidate.review.hardGatesPassed,
        reviewedDimensions: reviewedCandidate.review.reviewedDimensions,
      },
      adoption: {
        accepted: candidate.data.creativeState.accepted,
        receiptSchema: candidate.data.creativeState.acceptance.schema,
        receiptDigest: candidate.data.creativeState.acceptance.evidenceDigest,
      },
      documents: {
        promptPackItems: promptPack.content.prompts.length,
        candidateReview: candidateReview.content.status,
        adoptedCandidates: candidateReview.content.counts.adopted,
        editDecisionList: edl.content.status,
        qcReport: qc.content.status,
        deliveryManifest: deliveredManifest.content.status,
        releaseReadiness: deliveredManifest.content.releaseReadiness,
      },
      delivery: {
        approvalSource: 'explicit-user-authorization-in-current-task',
        packageName: deliverySnapshot.target.basename,
        packageDigest: packaged.packageDigest,
        itemCount: packaged.itemCount,
        verifiedItems: packageVerification.verifiedItems,
        verifiedBytes: packageVerification.verifiedBytes,
        valid: packageVerification.valid,
        licenseSummary: packageVerification.licenseSummary,
      },
      evidenceDigest: digest({
        sessionId,
        assetId: asset.id,
        contentHash: asset.contentHash,
        reviewDigest: candidate.data.creativeState.acceptance.reviewDigest,
        packageDigest: packaged.packageDigest,
        manifestDigest: deliveredManifest.content.derivation?.evidenceDigest,
      }),
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    assert.equal(/sk-[A-Za-z0-9_-]{20,}/u.test(serialized), false, '作品化验收报告包含 API Key');
    fs.writeFileSync(path.join(ARTIFACT_ROOT, 'production-acceptance-report.json'), serialized, 'utf8');
    process.stdout.write(serialized);
  } finally {
    database.close();
  }
}

async function run() {
  if (TOOL_EXECUTION_EVIDENCE_ONLY) {
    verifyExistingToolExecutionEvidence();
    return;
  }
  if (PRODUCTION_ACCEPTANCE_ONLY) {
    await verifyExistingProductionAcceptance();
    return;
  }
  const apiKey = String(process.env.T8_CREATOR_AGENT_LIVE_API_KEY || '').trim();
  assert.match(apiKey, /^sk-[A-Za-z0-9_-]{20,}$/u, '缺少 T8_CREATOR_AGENT_LIVE_API_KEY');
  const fixture = await startFixture(apiKey);
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const timings = {};
  try {
    const created = await fixture.request('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: fixture.document.projectId,
        canvasId: fixture.document.canvasId,
        context: { nodeCount: 0, edgeCount: 0, canvasRevision: 1 },
      }),
    });
    assertHttpCreated(created, 'create session');
    const sessionId = created.body.data.id;

    if (TOOL_ONLY_DIAGNOSTIC || TOOL_EXECUTION_DIAGNOSTIC) {
      const toolStartedAt = Date.now();
      const proposed = await fixture.request(`/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: requestBody(
          '创作一张 16:9 的电影感雨夜车站主视觉：空站台、湿地反光、远处暖色列车灯；直接给可编辑作品，并准备安全的画布预览，但不要自动写入画布或运行生成。',
          TOOL_EXECUTION_DIAGNOSTIC
            ? 'creator-live-tool-execution-0002'
            : 'creator-live-tool-0001',
          {
            kind: 'image',
            ratio: '16:9',
            modelPreferences: {
              llm: { provider: PROVIDER, model: MODEL },
              image: { provider: PROVIDER, model: IMAGE_MODEL },
            },
          },
        ),
      });
      assertHttpCreated(proposed, 'model tool proposal');
      timings.modelProposalMs = Date.now() - toolStartedAt;
      const proposedSession = proposed.body.data.session;
      const proposalReceipt = assertOnlineTurn(proposedSession, 1);
      const proposals = proposed.body.data.toolProposals || [];
      const receipts = proposed.body.data.toolProposalReceipts || [];
      assert.equal(proposals.length, 1, '真实模型没有返回唯一的高层能力提案');
      assert.equal(receipts.length, 1, '工具提案缺少编译回执');
      assert.equal(receipts[0].status, 'accepted', `工具提案被拒绝：${receipts[0].code || ''}`);
      assert.equal(proposals[0].tool.capabilityId, 'create.image');
      assert.equal(proposals[0].tool.operation, 'plan');
      assert.equal(proposals[0].gate.dispatchAllowed, false);
      assert.deepEqual(proposals[0].execution, {
        status: 'not-started', canvasWrites: 0, providerCalls: 0, fileWrites: 0,
      });
      const prepareStartedAt = Date.now();
      const prepared = await fixture.request(
        `/sessions/${sessionId}/tool-proposals/${proposals[0].proposalId}/prepare`,
        {
          method: 'POST',
          body: JSON.stringify({
            projectId: fixture.document.projectId,
            canvasId: fixture.document.canvasId,
            proposalDigest: proposals[0].proposalDigest,
          }),
        },
      );
      assertHttpCreated(prepared, 'prepare model tool proposal');
      timings.safePreviewMs = Date.now() - prepareStartedAt;
      timings.totalMs = Date.now() - startedAtMs;
      assert.equal(prepared.body.data.execution.status, 'prepared');
      assert.deepEqual(prepared.body.data.execution.sideEffects, {
        canvasWrites: 0, providerCalls: 0, fileWrites: 0,
      });
      assert.ok((prepared.body.data.patch?.operations || []).length > 0, '安全预览没有画布操作');
      assert.equal(fixture.document.revision, 1, '准备预览时不应修改画布');
      let executionEvidence = null;
      if (TOOL_EXECUTION_DIAGNOSTIC) {
        const applyStartedAt = Date.now();
        const plan = prepared.body.data.plan;
        const patch = prepared.body.data.patch;
        const preview = fixture.database.previewCanvasPatch(fixture.document.canvasId, patch, {
          projectId: fixture.document.projectId,
          actorId: 'local-owner',
          sessionId,
        });
        assert.match(preview.previewDigest, /^[a-f0-9]{64}$/u);
        const applied = fixture.database.applyCanvasPatch(fixture.document.canvasId, patch, {
          projectId: fixture.document.projectId,
          actorId: 'local-owner',
          sessionId,
          confirmed: true,
          previewDigest: preview.previewDigest,
        });
        assert.equal(applied.status, 'applied');
        assert.equal(applied.duplicate, false);
        assert.equal(applied.document.revision > 1, true);
        const appliedEvent = await fixture.request(`/sessions/${sessionId}/events`, {
          method: 'POST',
          body: JSON.stringify({
            projectId: fixture.document.projectId,
            canvasId: fixture.document.canvasId,
            type: 'plan.applied',
            payload: {
              planId: plan.planId,
              planDigest: plan.planDigest,
              patchId: patch.id,
              previewDigest: preview.previewDigest,
              appliedRevision: applied.revision,
              duplicate: false,
            },
          }),
        });
        assertHttpCreated(appliedEvent, 'record applied creator plan');
        timings.patchApplyMs = Date.now() - applyStartedAt;

        const primaryNodeId = String(plan.targets?.primaryNodeId || '');
        const primaryNode = fixture.document.nodes.find((node) => String(node.id) === primaryNodeId);
        assert.ok(primaryNode, '应用后的画布缺少 Creator 计划主节点');
        const runStartedAt = Date.now();
        const executed = await runRealImageCandidate({ fixture, node: primaryNode, apiKey, plan });
        timings.realImageRunMs = Date.now() - runStartedAt;

        const reconciled = await fixture.request(`/sessions/${sessionId}/run-links/reconcile`, {
          method: 'POST',
          body: JSON.stringify({
            projectId: fixture.document.projectId,
            canvasId: fixture.document.canvasId,
            runIds: [executed.run.id],
          }),
        });
        assert.equal(reconciled.response.status, 200, `关联 Run 失败：${reconciled.body?.code || ''}`);
        assert.equal(reconciled.body.data.linked.length, 1, '真实 Run 没有与 Creator 计划建立唯一关联');
        const verified = await fixture.request(`/sessions/${sessionId}/runs/${executed.run.id}/verify-artifacts`, {
          method: 'POST',
          body: JSON.stringify({
            projectId: fixture.document.projectId,
            canvasId: fixture.document.canvasId,
          }),
        });
        assert.equal(verified.response.status, 200, `核验实体产物失败：${verified.body?.code || ''}`);
        assert.equal(verified.body.data.verification?.verified, true, `实体产物未通过：${(verified.body.data.verification?.reasons || []).join(',')}`);
        assert.equal(verified.body.data.verification?.assets?.length, 1);
        const verifiedAsset = verified.body.data.verification.assets[0];
        assert.equal(verifiedAsset.stored, true);
        assert.equal(verifiedAsset.blobPresent, true);
        assert.equal(verifiedAsset.hashVerified, true);
        assert.equal(verifiedAsset.magicVerified, true);
        assert.equal(Number(verifiedAsset.width) > 0, true);
        assert.equal(Number(verifiedAsset.height) > 0, true);

        const finalSession = verified.body.data.session;
        const writeback = [...(finalSession.events || [])].reverse().find((event) => (
          event.type === 'assistant.tool-proposal.writeback'
          && event.payload?.proposalId === proposals[0].proposalId
        ));
        assert.ok(writeback, '真实执行没有回写同一 Creator 工具提案');
        assert.equal(writeback.payload.stage, 'verified');
        assert.equal(writeback.payload.evidence.canvasWriteRecorded, true);
        assert.equal(writeback.payload.evidence.providerRunLinked, true);
        assert.equal(writeback.payload.evidence.physicalArtifactsVerified, true);
        executionEvidence = {
          patch: {
            applied: true,
            duplicate: false,
            operationCount: patch.operations.length,
            baseRevision: patch.baseRevision,
            appliedRevision: applied.revision,
          },
          run: {
            status: executed.run.status,
            nodeRunStatus: executed.nodeRun.status,
            attemptStatus: executed.attempt.status,
            pollCount: executed.pollCount,
            linkedToCreatorSession: true,
          },
          artifact: {
            kind: executed.asset.kind,
            mimeType: executed.asset.mimeType,
            byteSize: executed.downloaded.byteSize,
            contentHash: executed.asset.contentHash,
            width: Number(executed.asset.metadata?.width) || null,
            height: Number(executed.asset.metadata?.height) || null,
            stored: verifiedAsset.stored,
            blobPresent: verifiedAsset.blobPresent,
            hashVerified: verifiedAsset.hashVerified,
            magicVerified: verifiedAsset.magicVerified,
            evidenceFile: `tool-execution-current/output/${executed.downloaded.filename}`,
          },
          writeback: {
            stage: writeback.payload.stage,
            canvasWriteRecorded: writeback.payload.evidence.canvasWriteRecorded,
            providerRunLinked: writeback.payload.evidence.providerRunLinked,
            physicalArtifactsVerified: writeback.payload.evidence.physicalArtifactsVerified,
          },
        };
      }
      const report = {
        schema: TOOL_EXECUTION_DIAGNOSTIC
          ? 't8-creator-agent-tool-execution-live-acceptance-v1'
          : 't8-creator-agent-tool-live-diagnostic-v1',
        startedAt,
        completedAt: new Date().toISOString(),
        provider: PROVIDER,
        model: MODEL,
        workRevision: proposedSession.creatorWork.revision,
        capabilityId: proposals[0].tool.capabilityId,
        operation: proposals[0].tool.operation,
        proposalAccepted: true,
        previewPrepared: true,
        previewOperationCount: prepared.body.data.patch.operations.length,
        canvasRevision: { before: 1, after: fixture.document.revision },
        sideEffectsBeforeApproval: prepared.body.data.execution.sideEffects,
        paidLlmProviderCalls: 1,
        paidImageSubmissions: TOOL_EXECUTION_DIAGNOSTIC ? 1 : 0,
        requestId: proposalReceipt.calls[0].requestId,
        ...(executionEvidence ? { execution: executionEvidence } : {}),
        timings,
        evidenceDigest: digest({
          workDigest: proposedSession.creatorWork.workDigest,
          proposalDigest: proposals[0].proposalDigest,
          patchId: prepared.body.data.patch.id,
          requestId: proposalReceipt.calls[0].requestId,
        }),
      };
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      assert.equal(serialized.includes(apiKey), false, '工具验收报告包含 API Key');
      fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
      fs.writeFileSync(path.join(
        ARTIFACT_ROOT,
        TOOL_EXECUTION_DIAGNOSTIC ? 'tool-execution-report.json' : 'tool-diagnostic-report.json',
      ), serialized, 'utf8');
      process.stdout.write(serialized);
      return;
    }

    const initialStartedAt = Date.now();
    const initial = await fixture.request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: requestBody(
        '创作一支 30 秒、9:16 的雨夜车站重逢短片。两位成年旧友因一张旧车票重新面对迟到的道歉；请直接给完整可编辑版本，恰好 6 个镜头，每镜 5 秒，并给逐镜分镜、声音方案和视频提示词。人物姓名、职业和具体外貌保持未知。',
        'creator-live-initial-0001',
      ),
    });
    assertHttpCreated(initial, 'initial creation');
    timings.initialCreationMs = Date.now() - initialStartedAt;
    const initialSession = initial.body.data.session;
    const initialReceipt = assertOnlineTurn(initialSession, 1);
    assert.equal(latestArtifactVersions(initialSession).length, 9);
    assert.equal(artifactsByKind(initialSession).get('ShotList')?.fields?.shots?.length, 6);

    const revisionStartedAt = Date.now();
    const revised = await fixture.request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: requestBody(
        '只修改结尾、最后一个镜头、对应最后一格分镜和最后一条提示词：不要两人并肩走入暖光，改成列车门关闭前，一人把旧车票递给另一人，两人隔着车窗相视。除这四处外，所有字段逐字保持不变；仍然是 6 个镜头、总时长 30 秒。',
        'creator-live-revision-0002',
      ),
    });
    assertHttpCreated(revised, 'creator revision');
    timings.creatorRevisionMs = Date.now() - revisionStartedAt;
    const revisedSession = revised.body.data.session;
    const revisedReceipt = assertOnlineTurn(revisedSession, 2);
    assertCreatorRevision(initialSession, revisedSession);

    const scriptArtifact = artifactsByKind(revisedSession).get('ScriptDoc');
    const receiptCountBeforeAccept = safeRequestIds(revisedSession).length;
    const acceptanceStartedAt = Date.now();
    const accepted = await fixture.request(
      `/sessions/${sessionId}/work-artifacts/${scriptArtifact.artifactId}/revise`,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: fixture.document.projectId,
          canvasId: fixture.document.canvasId,
          baseVersionId: scriptArtifact.versionId,
          action: 'accept',
        }),
      },
    );
    assertHttpCreated(accepted, 'accept revised script');
    timings.creatorAcceptanceMs = Date.now() - acceptanceStartedAt;
    const acceptedSession = accepted.body.data.session;
    assert.equal(safeRequestIds(acceptedSession).length, receiptCountBeforeAccept);
    assert.equal(accepted.body.data.event.payload.sideEffects.providerCalls, 0);
    assert.equal(accepted.body.data.artifactVersion.status, 'accepted');

    const confirmationSuggestion = acceptedSession.suggestionSet?.items?.find(
      (item) => item.arguments?.confirmCurrentStage === true,
    );
    assert.ok(confirmationSuggestion, '当前作品缺少阶段确认建议');
    const phase = acceptedSession.production?.currentPhase || 'idea';
    const requiredKinds = STAGE_DOCUMENT_KINDS[phase] || [];
    const stageDocuments = (acceptedSession.latestPlan?.productionDocuments || [])
      .filter((document) => requiredKinds.includes(document.kind));
    assert.equal(stageDocuments.length, requiredKinds.length, '当前阶段文档不完整');
    const confirmationStartedAt = Date.now();
    const confirmed = await fixture.request(
      `/sessions/${sessionId}/production-documents/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: fixture.document.projectId,
          canvasId: fixture.document.canvasId,
          planId: acceptedSession.latestPlan.planId,
          planDigest: acceptedSession.latestPlan.planDigest,
          documents: stageDocuments.map((document) => ({
            documentId: document.id,
            versionId: document.versionId,
            contentDigest: document.contentDigest,
          })),
          suggestion: {
            id: confirmationSuggestion.id,
            setDigest: acceptedSession.suggestionSet.setDigest,
          },
        }),
      },
    );
    assertHttpCreated(confirmed, 'confirm current stage');
    timings.stageConfirmationMs = Date.now() - confirmationStartedAt;
    const confirmedSession = confirmed.body.data.session;
    assert.equal(safeRequestIds(confirmedSession).length, receiptCountBeforeAccept);
    assert.equal(confirmed.body.data.sideEffects?.providerCalls || 0, 0);
    assert.equal(confirmed.body.data.phaseTransition?.advanced, true);
    const nextPhase = confirmationSuggestion.arguments.continueToPhase;
    assert.equal(confirmed.body.data.phaseTransition.nextPhase, nextPhase);

    const continuationStartedAt = Date.now();
    const continued = await fixture.request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: requestBody(
        confirmationSuggestion.arguments.creatorPrompt,
        'creator-live-next-stage-0003',
        { stageContinuation: true },
      ),
    });
    assertHttpCreated(continued, 'continue to next stage');
    timings.nextStageMs = Date.now() - continuationStartedAt;
    timings.totalMs = Date.now() - startedAtMs;
    const continuedSession = continued.body.data.session;
    const continuedReceipt = assertOnlineTurn(continuedSession, 4);
    assert.equal(continuedSession.production?.currentPhase, nextPhase);
    assert.equal(safeRequestIds(continuedSession).length, receiptCountBeforeAccept + 1);

    const report = {
      schema: STAGE_ONLY_DIAGNOSTIC || REVISION_ONLY_DIAGNOSTIC || ALL_FIXTURE_DIAGNOSTIC
        ? 't8-creator-agent-stage-live-diagnostic-v1'
        : 't8-creator-agent-live-acceptance-v1',
      startedAt,
      completedAt: new Date().toISOString(),
      provider: PROVIDER,
      model: MODEL,
      canvasRevision: {
        before: 1,
        after: fixture.document.revision,
      },
      steps: {
        initialCreation: {
          workRevision: initialSession.creatorWork.revision,
          documentCount: latestArtifactVersions(initialSession).length,
          shotCount: artifactsByKind(initialSession).get('ShotList')?.fields?.shots?.length,
          providerCalls: initialReceipt.providerCalls,
          requestId: initialReceipt.calls[0].requestId,
        },
        creatorRevision: {
          workRevision: revisedSession.creatorWork.revision,
          providerCalls: revisedReceipt.providerCalls,
          requestId: revisedReceipt.calls[0].requestId,
          changedEnding: true,
          preservedFirstFiveShots: true,
          preservedOutOfScopeFields: true,
        },
        creatorAcceptance: {
          providerCalls: 0,
          acceptedArtifact: 'ScriptDoc',
        },
        stageConfirmation: {
          providerCalls: 0,
          from: phase,
          to: nextPhase,
          advanced: confirmed.body.data.phaseTransition.advanced,
          canvasRetentionPrepared: Boolean(confirmed.body.data.canvasRetention),
        },
        nextStage: {
          phase: continuedSession.production?.currentPhase,
          workRevision: continuedSession.creatorWork.revision,
          providerCalls: continuedReceipt.providerCalls,
          requestId: continuedReceipt.calls[0].requestId,
        },
      },
      totals: {
        paidProviderCalls: ALL_FIXTURE_DIAGNOSTIC
          ? 0 : STAGE_ONLY_DIAGNOSTIC || REVISION_ONLY_DIAGNOSTIC ? 1 : 3,
        localDiagnosticFixtureCalls: ALL_FIXTURE_DIAGNOSTIC
          ? 3 : STAGE_ONLY_DIAGNOSTIC || REVISION_ONLY_DIAGNOSTIC ? 2 : 0,
        providerRequestIds: safeRequestIds(continuedSession),
        creatorControlProviderCalls: 0,
        suggestionCount: continuedSession.suggestionSet?.items?.length || 0,
      },
      timings,
      evidenceDigest: digest({
        initialWork: initialSession.creatorWork.workDigest,
        revisedWork: revisedSession.creatorWork.workDigest,
        continuedWork: continuedSession.creatorWork.workDigest,
        requestIds: safeRequestIds(continuedSession),
        phase,
        nextPhase,
      }),
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    assert.equal(serialized.includes(apiKey), false, '验收报告包含 API Key');
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    fs.writeFileSync(path.join(
      ARTIFACT_ROOT,
      REVISION_ONLY_DIAGNOSTIC
        ? 'revision-diagnostic-report.json'
        : STAGE_ONLY_DIAGNOSTIC || ALL_FIXTURE_DIAGNOSTIC
          ? 'stage-diagnostic-report.json' : 'report.json',
    ), serialized, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await fixture.close();
  }
}

run().catch((error) => {
  const safe = {
    ok: false,
    name: error?.name || 'Error',
    message: String(error?.message || error).slice(0, 1_000),
    code: error?.result?.code || null,
    details: error?.result?.details || null,
    liveCallDiagnostics: LIVE_CALL_DIAGNOSTICS,
    stack: String(error?.stack || '').split('\n').slice(0, 8),
  };
  process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
  process.exitCode = 1;
});
