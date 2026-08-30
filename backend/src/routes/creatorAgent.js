const express = require('express');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('path');
const config = require('../config');
const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const { getProjectDatabase } = require('../services/projectDatabase');
const {
  AgentControlCreativeError,
  createAgentControlCreativeService,
} = require('../services/agentControlCreative');
const {
  AgentControlAssetError,
  createAgentControlAssetService,
  resolveAppliedAssetPlacement,
} = require('../services/agentControlAssets');
const {
  AgentControlApprovalError,
  agentControlApprovalService,
} = require('../services/agentControlApprovals');
const {
  AgentControlDeliveryError,
  createAgentControlDeliveryService,
} = require('../services/agentControlDelivery');
const {
  verifyCompletionEvidence,
} = require('../services/agentControlRuns');
const {
  publicCreativeCapabilities,
  publicCreativeCapabilityGraph,
} = require('../services/agentControlCapabilities');
const {
  CreatorAgentSessionError,
  createCreatorAgentSessionStore,
  creatorSuggestions,
  creatorAttachmentOnlyPrompt,
  creatorSuggestionSet,
  inferCreatorKind,
  inferCreatorRecipe,
  normalizeAttachments,
  normalizeContext,
  resolveCreatorSuggestionSelection,
} = require('../services/creatorAgentSessions');
const {
  createCreatorModelDecision,
  modelPreferenceNeedsDynamicCatalog,
  runtimeDecisionModels,
} = require('../services/creatorAgentModelDecision');
const {
  canonicalCreatorCanvasLifecycle,
  creatorAssistantEventPlan,
  replayCreatorCanvasPlanStates,
} = require('../services/creatorAgentProductionEvidence');
const {
  monotonicNowMs,
  createCreatorAgentLocalReadinessReceipt,
} = require('../services/creatorAgentReadiness');
const {
  createCreatorAgentLlmRuntime,
} = require('../services/creatorAgentLlmRuntime');
const {
  groundCreatorAudioAttachments,
} = require('../services/creatorAgentMediaGrounding');
const seedanceNz = require('../providers/seedanceNz');
const {
  prepareCreatorDecisionTurn,
} = require('../services/creatorAgentDecisions');
const {
  CREATOR_TOOL_PROPOSAL_RECEIPT_SCHEMA,
  CreatorAgentToolProposalError,
  compileCreatorToolProposal,
  rejectionReceipt,
} = require('../services/creatorAgentToolProposals');
const {
  AgentControlCapabilityToolError,
  prepareVersionedCapabilityToolRequest,
} = require('../services/agentControlCapabilityTools');

const CREATOR_AGENT_HTTP_SCHEMA = 't8-creator-agent-http-v1';
const CREATOR_AGENT_REQUEST_LIMIT = 1024 * 1024;
const CREATOR_DELIVERY_DRAFT_TTL_MS = 10 * 60 * 1000;
const CREATOR_REFERENCE_PRODUCTION_MAX_SHOTS = 240;
const CREATOR_PRODUCTION_PHASE_LABELS = Object.freeze({
  idea: '创意简报',
  script: '完整剧本',
  assets: '资产设定',
  shots: '镜头与分镜',
  candidates: '候选与采用',
  delivery: '成片交付',
});

function creatorDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function creatorStableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(creatorStableString).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${creatorStableString(value[key])}`)
    .join(',')}}`;
}

const creatorStableDigest = (value) => crypto.createHash('sha256')
  .update(creatorStableString(value)).digest('hex');

function creatorContextForDocument(value, document) {
  return normalizeContext({
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    canvasRevision: Number(document?.revision) || 0,
  });
}

function creatorReferenceText(value, maximum = 240) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function referenceBreakdownProductionSource(plan = null) {
  const document = (Array.isArray(plan?.productionDocuments) ? plan.productionDocuments : [])
    .find((item) => item?.kind === 'reference-breakdown');
  const content = document?.content && typeof document.content === 'object'
    && !Array.isArray(document.content) ? document.content : {};
  const contentDigest = String(document?.contentDigest || '').trim().toLowerCase();
  if (!document
    || document.schema !== 't8-creator-production-document-v1'
    || !/^[a-f0-9]{64}$/.test(contentDigest)
    || creatorStableDigest({ kind: 'reference-breakdown', content }) !== contentDigest) {
    throw new CreatorAgentSessionError(
      'CREATOR_REFERENCE_BREAKDOWN_DOCUMENT_INVALID',
      '当前拉片作品文档无法验证，请刷新会话后重新核对结果',
      409,
    );
  }
  const evidence = content.resultEvidence && typeof content.resultEvidence === 'object'
    && !Array.isArray(content.resultEvidence) ? content.resultEvidence : {};
  if (content.status !== 'analysis-result-ready'
    || evidence.schema !== 't8-reference-video-breakdown-evidence-v1'
    || evidence.runBindingStatus !== 'verified') {
    throw new CreatorAgentSessionError(
      'CREATOR_REFERENCE_BREAKDOWN_EVIDENCE_REQUIRED',
      creatorReferenceText(evidence.runEvidenceReason, 300)
        || creatorReferenceText(content.analysisError, 300)
        || '拉片结果尚未完成 Run / NodeRun / Attempt 核验，暂不能进入生产',
      409,
    );
  }
  const source = content.sourceBinding && typeof content.sourceBinding === 'object'
    && !Array.isArray(content.sourceBinding) ? content.sourceBinding : {};
  const sourceHash = String(source.contentHash || '').trim().toLowerCase().replace(/^sha256:/, '');
  const sourceAssetId = creatorReferenceText(source.assetId, 160);
  const sourceRevision = Math.max(0, Math.trunc(Number(source.contentRevision) || 0));
  if (!sourceAssetId || sourceRevision < 1 || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new CreatorAgentSessionError(
      'CREATOR_REFERENCE_BREAKDOWN_SOURCE_INVALID',
      '拉片结果缺少可验证的来源素材版本或 SHA-256，暂不能进入生产',
      409,
    );
  }
  const shots = Array.isArray(content.shots) ? content.shots : [];
  if (shots.length < 1 || shots.length > CREATOR_REFERENCE_PRODUCTION_MAX_SHOTS) {
    throw new CreatorAgentSessionError(
      'CREATOR_REFERENCE_BREAKDOWN_SHOT_LIMIT',
      shots.length < 1
        ? '拉片结果没有可用镜头，暂不能进入关键帧与视频规划'
        : `当前拉片包含 ${shots.length} 镜，超过单次生产规划上限 ${CREATOR_REFERENCE_PRODUCTION_MAX_SHOTS} 镜；请先拆分参考片段`,
      409,
    );
  }
  const summary = content.summary && typeof content.summary === 'object'
    && !Array.isArray(content.summary) ? content.summary : {};
  const lines = [
    'Scene: 参考视频镜头语法的原创改编',
    '创作任务：根据已核验拉片结果规划可编辑关键帧与视频链。只借鉴节奏、剪辑密度、景别、运镜与构图规则；不得复刻受保护角色、品牌、台词或独特内容，不立即生成任何媒体。',
    `来源证据：assetId=${sourceAssetId}；contentRevision=${sourceRevision}；sha256=${sourceHash}。`,
    `结构摘要：${creatorReferenceText(summary.rhythmPattern, 400) || '节奏未知'}；${creatorReferenceText(summary.cameraLanguage, 500) || '镜头语言未知'}。`,
    '',
  ];
  for (const [index, shotValue] of shots.entries()) {
    const shot = shotValue && typeof shotValue === 'object' && !Array.isArray(shotValue)
      ? shotValue : {};
    const ordinal = Math.max(1, Math.trunc(Number(shot.ordinal) || index + 1));
    const start = creatorReferenceText(shot.startTimecode, 32) || '未知';
    const end = creatorReferenceText(shot.endTimecode, 32) || '未知';
    const sound = [
      `对白=${creatorReferenceText(shot.dialogue, 80) || '未知'}`,
      `旁白=${creatorReferenceText(shot.narration, 80) || '未知'}`,
      `音乐=${creatorReferenceText(shot.music, 80) || '未知'}`,
      `环境=${creatorReferenceText(shot.ambience, 80) || '未知'}`,
      `音效=${creatorReferenceText(shot.sfx, 80) || '未知'}`,
    ].join('；');
    const unknowns = (Array.isArray(shot.unknowns) ? shot.unknowns : [])
      .map((item) => creatorReferenceText(item, 100))
      .filter(Boolean)
      .slice(0, 8)
      .join('；');
    lines.push(
      `【镜头${ordinal}｜${start} - ${end}】`,
      `镜头语法：景别=${creatorReferenceText(shot.shotSize, 60) || '未知'}；运镜=${creatorReferenceText(shot.cameraMovement, 120) || '未知'}；构图=${creatorReferenceText(shot.composition, 180) || '未知'}。`,
      `动作结构：${creatorReferenceText(shot.action, 240) || '未知'}。`,
      `声音证据：${sound}。`,
      `版权安全可编辑提示：${creatorReferenceText(shot.editablePrompt, 320) || '待创作者补充'}。`,
      `未知与限制：${unknowns || '无新增推断；继续以原始证据为准'}。`,
      '',
    );
  }
  const prompt = lines.join('\n').trim();
  if (Buffer.byteLength(prompt, 'utf8') > 900_000) {
    throw new CreatorAgentSessionError(
      'CREATOR_REFERENCE_BREAKDOWN_SOURCE_TOO_LARGE',
      '拉片结果过大，无法安全写入单次 Story 计划；请先拆分参考片段',
      409,
    );
  }
  return {
    prompt,
    assetIds: [sourceAssetId],
    title: `${creatorReferenceText(plan?.brief?.title, 120) || '参考视频'} · 原创分镜规划`,
  };
}

function creatorDeliveryPackageName(value, canvasTitle = '') {
  const fallbackDate = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const fallback = `${String(canvasTitle || '贞贞作品').trim() || '贞贞作品'}-${fallbackDate}`;
  const normalized = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  if (!normalized || normalized === '.' || normalized === '..'
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) {
    throw new CreatorAgentSessionError(
      'CREATOR_DELIVERY_PACKAGE_NAME_INVALID',
      '交付包名称无效，请换一个简短名称',
    );
  }
  return normalized;
}

function createDeliveryIntentPlan(session, document, prompt = '') {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CREATOR_DELIVERY_DRAFT_TTL_MS).toISOString();
  const planId = crypto.randomUUID();
  const plan = {
    schema: 't8-creator-delivery-plan-v1',
    planId,
    projectId: session.projectId,
    canvasId: session.canvasId,
    canvasRevision: Number(document?.revision) || 0,
    action: 'delivery.package',
    kind: 'delivery',
    profile: 'verified',
    profileLabel: '已验证素材',
    brief: {
      goal: String(prompt || '把当前作品整理成可核验交付包').slice(0, 2_000),
      title: session.context?.canvasTitle || session.title || '贞贞作品',
      summary: '等待选择本机交付位置',
    },
    questions: [{
      id: 'delivery-folder',
      question: '请选择一个本机文件夹作为交付位置。',
      reason: '路径只在本次桌面操作中使用，不写入创作会话；选择后才会核对精确素材清单。',
    }],
    ready: false,
    candidateCount: 0,
    strategy: {
      previewFirst: true,
      preserveAcceptedVersions: true,
      generateScope: 'verified-persisted-assets-only',
      autoRunGeneration: false,
    },
    impact: { writesNow: 0, providerCallsNow: 0, fileWritesNow: 0, patchOperationCount: 0 },
    delivery: {
      status: 'needs-target',
      scope: 'canvas',
      itemCount: 0,
      totalBytes: 0,
      licenseSummary: { known: 0, unknown: 0 },
      assets: [],
      warnings: [],
    },
    createdAt,
    expiresAt,
  };
  plan.planDigest = creatorDigest({
    schema: plan.schema,
    planId,
    projectId: plan.projectId,
    canvasId: plan.canvasId,
    canvasRevision: plan.canvasRevision,
    action: plan.action,
    ready: false,
  });
  return plan;
}

function createDeliveryReadyPlan(session, snapshot) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CREATOR_DELIVERY_DRAFT_TTL_MS).toISOString();
  const planId = crypto.randomUUID();
  const safeDelivery = {
    status: 'ready',
    packageName: snapshot.target.basename,
    destination: snapshot.preview.destination,
    scope: snapshot.collection.scope,
    itemCount: snapshot.collection.items.length,
    totalBytes: snapshot.collection.totalBytes,
    selectionDigest: snapshot.collection.selectionDigest,
    licenseSummary: snapshot.collection.licenseSummary,
    assets: snapshot.preview.package.assets,
    warnings: snapshot.preview.warnings,
  };
  const plan = {
    schema: 't8-creator-delivery-plan-v1',
    planId,
    projectId: session.projectId,
    canvasId: session.canvasId,
    canvasRevision: snapshot.collection.canvasRevision,
    action: 'delivery.package',
    kind: 'delivery',
    profile: 'verified',
    profileLabel: '已验证素材',
    brief: {
      goal: `创建“${snapshot.target.basename}”交付包`,
      title: snapshot.target.basename,
      summary: snapshot.preview.summary,
    },
    questions: [],
    ready: true,
    candidateCount: 0,
    strategy: {
      previewFirst: true,
      preserveAcceptedVersions: true,
      generateScope: 'verified-persisted-assets-only',
      autoRunGeneration: false,
    },
    impact: { writesNow: 0, providerCallsNow: 0, fileWritesNow: 0, patchOperationCount: 0 },
    delivery: safeDelivery,
    createdAt,
    expiresAt,
  };
  plan.planDigest = creatorDigest({
    schema: plan.schema,
    planId,
    projectId: plan.projectId,
    canvasId: plan.canvasId,
    canvasRevision: plan.canvasRevision,
    action: plan.action,
    delivery: safeDelivery,
  });
  return plan;
}

function createAssetPlaceReadyPlan(session, snapshot) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CREATOR_DELIVERY_DRAFT_TTL_MS).toISOString();
  const patch = snapshot.patch;
  const placement = snapshot.placement;
  const asset = snapshot.asset || placement.asset;
  if (!asset?.id) {
    throw new CreatorAgentSessionError(
      'CREATOR_ASSET_PLACE_SNAPSHOT_INVALID',
      '素材放置计划缺少已核验的素材版本，请刷新后重试',
      409,
    );
  }
  const assetPlacement = {
    ...placement,
    asset,
  };
  const plan = {
    schema: 't8-creator-asset-place-plan-v1',
    planId: `creator-${patch.id}`.slice(0, 160),
    projectId: session.projectId,
    canvasId: session.canvasId,
    canvasRevision: Number(patch.baseRevision) || 0,
    action: 'asset.place',
    kind: 'asset',
    profile: 'verified',
    profileLabel: '已验证素材',
    brief: {
      goal: `把“${asset.filename || asset.id}”放到画布`,
      title: asset.filename || '项目素材',
      summary: patch.summary,
    },
    questions: [],
    ready: true,
    candidateCount: 1,
    strategy: {
      previewFirst: true,
      preserveAcceptedVersions: true,
      generateScope: 'verified-persisted-asset-only',
      autoRunGeneration: false,
    },
    impact: {
      writesNow: 0,
      providerCallsNow: 0,
      fileWritesNow: 0,
      patchOperationCount: patch.operations.length,
    },
    patchId: patch.id,
    targets: {
      primaryNodeId: placement.nodeId,
      proposedNodes: [{ id: placement.nodeId, type: placement.nodeType }],
    },
    assetPlacement,
    createdAt,
    expiresAt,
  };
  plan.planDigest = creatorDigest({
    schema: plan.schema,
    planId: plan.planId,
    projectId: plan.projectId,
    canvasId: plan.canvasId,
    canvasRevision: plan.canvasRevision,
    action: plan.action,
    patchId: patch.id,
    assetId: asset.id,
    contentHash: asset.contentHash,
  });
  return plan;
}

function response(data = {}) {
  return {
    schema: CREATOR_AGENT_HTTP_SCHEMA,
    ok: true,
    ...data,
  };
}

function ensureSessionScope(session, input = {}) {
  const projectId = String(input.projectId || session.projectId || '');
  const canvasId = String(input.canvasId || session.canvasId || '');
  if (projectId !== String(session.projectId || '') || canvasId !== String(session.canvasId || '')) {
    throw new CreatorAgentSessionError(
      'CREATOR_SESSION_SCOPE_MISMATCH',
      '这个创作会话不属于当前项目或画布，请新建会话后再继续',
      409,
    );
  }
  return {
    projectId,
    canvasId,
    actorId: 'local-owner',
    sessionId: `creator-agent:${session.id}`,
  };
}

function createCreatorAgentRouter(options = {}) {
  const router = express.Router();
  const runtimeConfig = options.config || config;
  const database = () => options.database || getProjectDatabase(runtimeConfig);
  let lazyCreativeService = options.creativeService || null;
  const creative = () => {
    if (!lazyCreativeService) {
      lazyCreativeService = createAgentControlCreativeService({
        database: database(),
        settingsFile: runtimeConfig.SETTINGS_FILE,
        settingsProvider: options.settingsProvider,
      });
    }
    return lazyCreativeService;
  };
  let lazyAssetService = options.assetService || null;
  const assets = () => {
    if (!lazyAssetService) {
      lazyAssetService = createAgentControlAssetService({
        config: runtimeConfig,
        database: database(),
      });
    }
    return lazyAssetService;
  };
  let lazyDeliveryService = options.deliveryService || null;
  const delivery = () => {
    if (!lazyDeliveryService) {
      lazyDeliveryService = createAgentControlDeliveryService({ database: database() });
    }
    return lazyDeliveryService;
  };
  const approvals = options.approvals || agentControlApprovalService;
  const deliveryDrafts = options.deliveryDrafts || new Map();
  const deliveryApprovals = options.deliveryApprovals || new Map();
  const activeMessageStreams = options.activeMessageStreams || new Map();
  const readinessNow = typeof options.readinessNow === 'function'
    ? options.readinessNow
    : monotonicNowMs;
  const environmentResponseDeltaDelayMs = Number(
    process.env.T8_CREATOR_AGENT_RESPONSE_DELTA_DELAY_MS,
  );
  const responseDeltaDelayMs = Object.prototype.hasOwnProperty.call(options, 'responseDeltaDelayMs')
    ? Math.max(0, Math.min(250, Math.trunc(Number(options.responseDeltaDelayMs) || 0)))
    : Number.isFinite(environmentResponseDeltaDelayMs)
      ? Math.max(0, Math.min(250, Math.trunc(environmentResponseDeltaDelayMs)))
      : 75;
  const waitForResponseDelta = () => responseDeltaDelayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, responseDeltaDelayMs)) : Promise.resolve();
  let lazyCreatorLlmRuntime = options.llmRuntime || null;
  const creatorLlm = () => {
    if (!lazyCreatorLlmRuntime) {
      lazyCreatorLlmRuntime = createCreatorAgentLlmRuntime({
        config: runtimeConfig,
        settingsFile: runtimeConfig.SETTINGS_FILE,
        settingsProvider: options.creatorLlmSettingsProvider,
        generateChat: options.creatorLlmGenerateChat,
        fetchImpl: options.creatorLlmFetchImpl,
        timeoutMs: options.creatorLlmTimeoutMs,
      });
    }
    return lazyCreatorLlmRuntime;
  };
  const creatorSettings = () => {
    if (typeof options.creatorLlmSettingsProvider === 'function') {
      return options.creatorLlmSettingsProvider() || {};
    }
    try {
      return JSON.parse(fs.readFileSync(runtimeConfig.SETTINGS_FILE, 'utf8')) || {};
    } catch {
      return {};
    }
  };
  const transcribeCreatorAudio = typeof options.creatorAudioTranscriber === 'function'
    ? options.creatorAudioTranscriber
    : async (attachment) => {
      const settings = creatorSettings();
      const apiKey = String(settings.zhenzhenSd2ApiKey || '').trim();
      if (!apiKey) {
        const error = new Error('需要先配置贞贞的平价AI小屋，才能读取音频内容');
        error.code = 'CREATOR_AUDIO_TRANSCRIBER_CREDENTIAL_REQUIRED';
        throw error;
      }
      return seedanceNz.transcribeAudio({
        audioUrl: attachment.ref,
        model: 'whisper-1',
        response_format: 'verbose_json',
      }, apiKey, {
        baseUrl: String(settings.zhenzhenSd2BaseUrl || '').trim() || undefined,
      });
    };
  const cleanupDeliveryState = () => {
    const now = Date.now();
    for (const [id, draft] of deliveryDrafts) {
      if (Number(draft?.expiresAt || 0) <= now) deliveryDrafts.delete(id);
    }
    for (const [id, pending] of deliveryApprovals) {
      if (!pending?.completedEvidence && Number(pending?.expiresAt || 0) <= now) {
        deliveryApprovals.delete(id);
      }
    }
  };
  const sessions = options.sessions || createCreatorAgentSessionStore({
    rootDir: path.join(runtimeConfig.DATA_DIR, 'creator-agent'),
  });
  const persistCreatorToolProposals = (sessionId, assistantEvent, rawProposals) => {
    const proposals = Array.isArray(rawProposals) ? rawProposals.slice(0, 12) : [];
    const accepted = [];
    const receipts = [];
    proposals.forEach((rawProposal, index) => {
      try {
        const compiled = compileCreatorToolProposal({
          proposal: rawProposal,
          session: sessions.read(sessionId),
          assistantEvent,
        });
        const stored = sessions.recordToolProposal(sessionId, { proposal: compiled });
        accepted.push(stored.proposal);
        receipts.push({
          schema: CREATOR_TOOL_PROPOSAL_RECEIPT_SCHEMA,
          status: 'accepted',
          index,
          proposalId: stored.proposal.proposalId,
          proposalDigest: stored.proposal.proposalDigest,
          duplicate: stored.duplicate,
          gate: stored.proposal.gate,
          sideEffects: {
            canvasWrites: 0,
            providerCalls: 0,
            fileWrites: 0,
          },
        });
      } catch (error) {
        const proposalFailure = error instanceof CreatorAgentToolProposalError
          || String(error?.code || '').startsWith('CAPABILITY_TOOL_')
          || String(error?.code || '').startsWith('CREATOR_TOOL_PROPOSAL_');
        if (!proposalFailure) throw error;
        receipts.push(rejectionReceipt(error, index));
      }
    });
    return {
      session: sessions.read(sessionId),
      proposals: accepted,
      receipts,
    };
  };
  const syncCreatorRunEvents = (sessionId) => {
    let snapshot = sessions.read(sessionId);
    const db = database();
    if (typeof db.getRunEvents !== 'function' || typeof sessions.appendRunEvents !== 'function') {
      return snapshot;
    }
    const links = (Array.isArray(snapshot.runLinks) ? snapshot.runLinks : []).slice(-12);
    for (const link of links) {
      const runId = String(link?.runId || '').trim();
      if (!runId) continue;
      const run = db.getRun?.(runId);
      if (!run
        || String(run.projectId || '') !== String(snapshot.projectId || '')
        || String(run.canvasId || '') !== String(snapshot.canvasId || '')) continue;
      const afterId = Math.max(0, Number(snapshot.runEventCursors?.[runId]) || 0);
      const events = db.getRunEvents(runId, afterId);
      if (!Array.isArray(events) || events.length === 0) continue;
      snapshot = sessions.appendRunEvents(sessionId, events.slice(0, 200)).session;
    }
    return snapshot;
  };

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return next();
  });

  router.get('/capabilities', (req, res, next) => {
    try {
      return res.json(response({
        message: '创作 Agent、zcanvas 与 Codex Skill 使用同一份能力清单',
        data: publicCreativeCapabilities({
          category: req.query?.category,
          query: req.query?.query,
          settingsFile: runtimeConfig.SETTINGS_FILE,
          credentialSettingsProvider: options.credentialSettingsProvider,
          runtimeStatusProvider: options.runtimeStatusProvider,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/capability-graph', (req, res, next) => {
    try {
      return res.json(response({
        message: '已返回由真实节点、handler 与运行时模型目录生成的统一能力图谱',
        data: publicCreativeCapabilityGraph({
          category: req.query?.category,
          settingsFile: runtimeConfig.SETTINGS_FILE,
          credentialSettingsProvider: options.credentialSettingsProvider,
          runtimeStatusProvider: options.runtimeStatusProvider,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });


  router.get('/catalog', (req, res, next) => {
    try {
      const projectId = String(req.query?.projectId || '').trim();
      const canvasId = String(req.query?.canvasId || '').trim();
      const document = database().getCanvas(canvasId);
      if (!projectId || !canvasId || !document || String(document.projectId || '') !== projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前项目或画布不存在，无法读取创作模型目录',
          404,
        );
      }
      const requestedKind = String(req.query?.kind || '').trim().toLowerCase();
      const query = String(req.query?.query || '').trim().toLowerCase();
      const scope = { projectId, canvasId };
      const capabilityGraph = publicCreativeCapabilityGraph({
        settingsFile: runtimeConfig.SETTINGS_FILE,
        credentialSettingsProvider: options.credentialSettingsProvider,
        runtimeStatusProvider: options.runtimeStatusProvider,
      });
      const runtimeById = new Map(capabilityGraph.runtime.entries.map((item) => [item.id, item]));

      const dynamic = creative().models({}, scope);
      const models = new Map();
      for (const kind of ['llm', 'image', 'video', 'audio']) {
        for (const item of creativeModelCatalog[kind] || []) {
          models.set(item.id || `${kind}:${item.provider}:${item.model}`, { kind, ...item, source: 'runtime-registry' });
        }
      }
      for (const item of dynamic.items || []) {
        const existing = models.get(item.id) || {};
        models.set(item.id, { ...existing, ...item });
      }
      const filteredModels = [...models.values()]
        .map((item) => {
          const runtime = runtimeById.get(item.id);
          if (!runtime?.readiness) return item;
          return {
            ...item,
            available: runtime.readiness.available,
            configured: runtime.readiness.credentialReady === true,
            readiness: runtime.readiness,
          };
        })
        .filter((item) => !requestedKind || item.kind === requestedKind)
        .filter((item) => !query || `${item.label || ''} ${item.model} ${item.provider} ${item.platformLabel || ''}`.toLowerCase().includes(query))
        .sort((left, right) => left.kind.localeCompare(right.kind)
          || String(left.platformLabel || left.provider).localeCompare(String(right.platformLabel || right.provider))
          || String(left.label || left.model).localeCompare(String(right.label || right.model)));
      const actions = (creativeModelCatalog.actions || [])
        .map((item) => { const readiness = runtimeById.get(item.id)?.readiness; return readiness ? { ...item, available: readiness.available, readiness } : item; })
        .filter((item) => !requestedKind || item.kind === requestedKind)
        .filter((item) => !query || `${item.label} ${item.action} ${item.family} ${item.platformLabel}`.toLowerCase().includes(query));
      return res.json(response({
        message: '目录来自当前真实节点、模型与动作注册表；Agent、zcanvas 与 Skill 共用同一摘要',
        data: {
          schema: 't8-creator-agent-runtime-catalog-v1',
          sourceDigest: creativeModelCatalog.sourceDigest,
          generatedFrom: creativeModelCatalog.generatedFrom,
          platforms: creativeModelCatalog.platforms || [],
          models: filteredModels,
          actions,
          counts: {
            models: filteredModels.length,
            actions: actions.length,
            executableModels: filteredModels.filter((item) => item.readiness ? item.readiness.executable : item.configured !== false).length,
            blockedModels: filteredModels.filter((item) => item.readiness ? !item.readiness.executable : item.configured === false).length,
            executableActions: actions.filter((item) => item.readiness?.executable === true).length,
            blockedActions: actions.filter((item) => item.readiness?.executable !== true).length,
          },
          warning: '目录存在只表示“已知”。只有组件、Key 与地区状态都就绪的项目才能执行；界面只返回白话原因，绝不返回 Key。',
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/suggestions', (req, res) => {
    const context = normalizeContext({
      nodeCount: req.query?.nodeCount,
      edgeCount: req.query?.edgeCount,
      selectedNodeTypes: String(req.query?.selectedNodeTypes || '').split(',').filter(Boolean),
      phase: req.query?.phase,
    });
    return res.json(response({
      data: {
        suggestions: creatorSuggestions(context),
        suggestionSet: creatorSuggestionSet(context),
        deterministic: true,
        providerCalls: 0,
      },
    }));
  });

  router.get('/sessions', (req, res, next) => {
    try {
      const projectId = String(req.query?.projectId || '').trim();
      const canvasId = String(req.query?.canvasId || '').trim();
      const document = database().getCanvas(canvasId);
      if (!projectId || !canvasId || !document || String(document.projectId || '') !== projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前项目或画布不存在，无法恢复创作会话',
          404,
        );
      }
      const results = sessions.list({
        projectId,
        canvasId,
        limit: req.query?.limit,
      });
      return res.json(response({
        message: results.length
          ? '已找到当前画布最近的创作会话'
          : '当前画布还没有可恢复的创作会话',
        data: {
          sessions: results,
          latest: results[0] || null,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions', (req, res, next) => {
    try {
      const projectId = String(req.body?.projectId || '').trim();
      const canvasId = String(req.body?.canvasId || '').trim();
      const document = database().getCanvas(canvasId);
      if (!projectId || !canvasId || !document || String(document.projectId || '') !== projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前项目或画布不存在，无法开始创作会话',
          404,
        );
      }
      const session = sessions.create({
        sessionId: req.body?.sessionId,
        projectId,
        canvasId,
        title: req.body?.title,
        context: creatorContextForDocument(req.body?.context, document),
      });
      return res.status(201).json(response({
        message: '创作会话已保存；空白状态没有调用任何 Provider',
        data: session,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/sessions/:sessionId', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      ensureSessionScope(session, req.query || {});
      return res.json(response({ data: session }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/production-documents/confirm', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const currentCanvasDocument = database().getCanvas(scope.canvasId);
      if (!currentCanvasDocument
        || String(currentCanvasDocument.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前画布不存在，无法确认阶段成果',
          404,
        );
      }
      const currentContext = creatorContextForDocument(
        req.body?.context,
        currentCanvasDocument,
      );
      const requestedSuggestion = req.body?.suggestion
        && typeof req.body.suggestion === 'object'
        ? req.body.suggestion
        : null;
      const selectedSuggestion = requestedSuggestion
        ? resolveCreatorSuggestionSelection(session, {
            suggestionId: requestedSuggestion.id,
            suggestionSetDigest: requestedSuggestion.setDigest,
            context: currentContext,
            bindingScope: 'production-stage-confirmation',
          })
        : null;
      if (!selectedSuggestion?.arguments?.confirmCurrentStage) {
        throw new CreatorAgentSessionError(
          'CREATOR_STAGE_CONFIRMATION_SUGGESTION_REQUIRED',
          '请使用当前回复下方的“确认并进入下一阶段”选项，避免确认过期版本',
          409,
        );
      }
      const result = sessions.confirmProductionDocuments(session.id, {
        planId: req.body?.planId,
        planDigest: req.body?.planDigest,
        documents: req.body?.documents,
        actor: 'canvas-ui',
        decisionSelection: {
          decisionDocumentId: selectedSuggestion.arguments.decisionDocumentId,
          decisionDocumentVersionId:
            selectedSuggestion.arguments.decisionDocumentVersionId,
          decisionDocumentDigest:
            selectedSuggestion.arguments.decisionDocumentDigest,
          decisionId: selectedSuggestion.arguments.decisionId,
          decisionOptionId: selectedSuggestion.arguments.decisionOptionId,
        },
      });
      let canvasRetention = null;
      if (result.phaseTransition) {
        const document = currentCanvasDocument;
        const phase = String(result.phaseTransition.completedPhase || 'idea');
        const label = CREATOR_PRODUCTION_PHASE_LABELS[phase] || '阶段成果';
        const artifactVersion = result.stageResponse?.artifactVersion;
        const authoritativeBody = String(
          artifactVersion?.content?.bodyMarkdown || '',
        ).trim();
        if (!artifactVersion?.versionId
          || !artifactVersion?.content?.contentDigest
          || !authoritativeBody) {
          throw new CreatorAgentSessionError(
            'CREATOR_STAGE_ARTIFACT_REQUIRED',
            '当前阶段成果没有可验证的非空版本，已停止发送到画布',
            409,
          );
        }
        const nodes = Array.isArray(document.nodes) ? document.nodes : [];
        const rightEdge = nodes.reduce((maximum, node) => (
          Math.max(maximum, Number(node?.position?.x) || 0)
        ), 0);
        const phaseIndex = Math.max(0, Object.keys(CREATOR_PRODUCTION_PHASE_LABELS).indexOf(phase));
        const retainedBody = authoritativeBody.length > 1_700
          ? `${authoritativeBody.slice(0, 1_700).trim()}\n\n[正文较长；完整权威版本：${artifactVersion.versionId}]`
          : authoritativeBody;
        const prompt = [
          `# 已确认 · ${label}`,
          `版本：${artifactVersion.versionId}`,
          '',
          retainedBody,
        ].join('\n').slice(0, 2_000);
        if (!prompt.replace(/^# 已确认[^\n]*\n*/u, '').trim()) {
          throw new CreatorAgentSessionError(
            'CREATOR_STAGE_CANVAS_TEXT_EMPTY',
            '当前阶段成果正文为空，未创建画布文本节点',
            409,
          );
        }
        const retentionPlan = creative().actionPlan('graph.node-add', {
          type: 'text',
          prompt,
          x: rightEdge + 420,
          y: 80 + phaseIndex * 240,
        }, scope);
        const retentionPatch = creative().requirePlan(retentionPlan.planId, scope).patch;
        const retentionTurn = sessions.appendActionPlan(session.id, {
          action: 'graph.node-add',
          label: `将已确认${label}留存在画布`,
          context: currentContext,
          plan: retentionPlan,
          patch: retentionPatch,
          source: 'creator-stage-retention',
          silent: true,
          preserveSuggestions: true,
        });
        result.session = retentionTurn.session;
        canvasRetention = {
          schema: 't8-creator-canvas-retention-preview-v1',
          phase,
          label,
          plan: retentionPlan,
          patch: retentionPatch,
          requiresExplicitApply: true,
        };
      }
      return res.status(result.duplicate ? 200 : 201).json(response({
        message: result.duplicate
          ? '这些前期文档版本已经确认，无需重复操作'
          : canvasRetention
            ? `已确认${canvasRetention.label}并进入下一阶段；已准备画布留存预览，确认后才会写入`
            : '已确认当前文档版本；后续修改会生成新草稿，不会覆盖这次确认',
        data: {
          ...result,
          canvasRetention,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/work-artifacts/:artifactId/revise', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      ensureSessionScope(session, req.body || {});
      const action = String(req.body?.action || '').trim().toLowerCase();
      if (!['edit', 'lock', 'unlock', 'accept', 'reject'].includes(action)) {
        throw new CreatorAgentSessionError(
          'CREATOR_WORK_ACTION_INVALID',
          '不支持这个作品操作',
          400,
        );
      }
      const result = sessions.reviseWorkArtifactVersion(session.id, {
        artifactId: req.params.artifactId,
        baseVersionId: req.body?.baseVersionId,
        action,
        field: req.body?.field,
        value: req.body?.value,
        actor: 'canvas-ui',
      });
      return res.status(result.duplicate ? 200 : 201).json(response({
        message: result.duplicate
          ? '当前作品字段已经处于这个状态'
          : action === 'edit'
            ? '已保存字段修改并创建新版本；没有调用模型或改动画布'
            : action === 'lock'
              ? '已锁定字段；后续模型修改将被服务端阻止'
              : action === 'unlock'
                ? '已解锁字段；没有自动触发模型修改'
                : action === 'accept'
                  ? '已接受当前作品版本；没有启动生成'
                  : '已驳回当前作品版本；旧版本仍然保留',
        data: result,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/tool-proposals/:proposalId/prepare', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const document = database().getCanvas(scope.canvasId);
      if (!document || String(document.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前项目或画布不存在，无法准备这条工具提议',
          404,
        );
      }
      const proposal = (Array.isArray(session.toolProposals) ? session.toolProposals : [])
        .find((candidate) => candidate?.proposalId === req.params.proposalId);
      if (!proposal) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_NOT_FOUND',
          '这条工具提议不存在或已经被清理，请基于当前作品重新提议',
          404,
        );
      }
      if (String(req.body?.proposalDigest || '').trim().toLowerCase()
        !== String(proposal.proposalDigest || '').toLowerCase()) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_STALE',
          '工具提议摘要已经变化，未生成预览；请刷新当前作品后重试',
          409,
        );
      }
      let prepared;
      try {
        prepared = prepareVersionedCapabilityToolRequest(proposal.request);
      } catch (error) {
        if (error instanceof AgentControlCapabilityToolError) {
          throw new CreatorAgentSessionError(
            error.code,
            error.message,
            error.status,
            error.details || {},
          );
        }
        throw error;
      }
      if (prepared.surfaceDigest !== proposal.tool.capabilityManifestDigest
        || prepared.capabilityGraphDigest !== proposal.tool.capabilityGraphDigest
        || prepared.capabilityId !== proposal.tool.capabilityId) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_CAPABILITY_STALE',
          '创作能力清单已经更新，旧提议不会继续执行；请基于当前能力重新提议',
          409,
        );
      }
      if (prepared.surface?.agentTool?.service !== 'agentControlCreative'
        || prepared.surface?.agentTool?.method !== 'createPlan') {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_PREVIEW_UNAVAILABLE',
          '这条高层能力还没有接入 Creator Agent 的安全预览链，当前不会执行',
          409,
        );
      }
      const responseEvent = (Array.isArray(session.events) ? session.events : [])
        .find((event) => (
          event?.type === 'assistant.response.completed'
          && event?.payload?.responseId === proposal.binding.responseId
          && event?.payload?.responseDigest === proposal.binding.responseDigest
        ));
      const plan = responseEvent?.payload?.plan;
      const expectedKind = String(prepared.surface.agentTool.bindingOperation || '').trim();
      const actualKind = String(plan?.kind || '').replace(/^edit-/, '');
      if (!plan?.ready
        || plan.planId !== proposal.binding.planId
        || plan.planDigest !== proposal.binding.planDigest
        || expectedKind !== actualKind) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_PLAN_STALE',
          '工具提议与当前创作计划不再一致，未生成预览',
          409,
        );
      }
      let patch = null;
      const durablePlan = session.latestPlan?.planId === plan.planId
        && session.latestPlan?.planDigest === plan.planDigest
        && session.latestPatch
        ? { ...session.latestPlan, patch: session.latestPatch }
        : creative().requirePlan(plan.planId, scope);
      if (String(durablePlan.planDigest || '') !== String(plan.planDigest || '')) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_PLAN_STALE',
          '创作计划摘要不匹配，未生成预览',
          409,
        );
      }
      patch = durablePlan.patch;
      if (!patch || !Array.isArray(patch.operations) || patch.operations.length === 0) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_PREVIEW_EMPTY',
          '这条工具提议没有可预览的画布变更，当前不会执行',
          409,
        );
      }
      const preparedRecord = sessions.prepareToolProposal(session.id, {
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        plan,
      });
      return res.status(preparedRecord.duplicate ? 200 : 201).json(response({
        message: preparedRecord.duplicate
          ? '已恢复同一条工具提议的安全预览，不会重复执行'
          : '已准备与当前作品版本绑定的安全预览；确认前不会写画布或调用 Provider',
        data: {
          session: preparedRecord.session,
          proposal: preparedRecord.proposal,
          event: preparedRecord.event,
          plan,
          patch,
          duplicate: preparedRecord.duplicate,
          execution: {
            status: 'prepared',
            requestedOperation: proposal.tool.operation,
            nextBoundary: proposal.gate.approvalRequired ? 'preview-and-approval' : 'preview',
            sideEffects: { canvasWrites: 0, providerCalls: 0, fileWrites: 0 },
          },
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/assets/:assetId/place-plan', async (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const document = database().getCanvas(scope.canvasId);
      if (!document || String(document.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前项目或画布不存在，无法放置素材',
          404,
        );
      }
      const inspected = await assets().inspectPlace(req.params.assetId, document, {
        projectId: scope.projectId,
        position: req.body?.position,
        targetNodeId: req.body?.targetNodeId,
        sourceHandle: req.body?.sourceHandle,
        targetHandle: req.body?.targetHandle,
      });
      const recovery = resolveAppliedAssetPlacement(database(), scope.canvasId, inspected);
      const snapshot = {
        ...inspected,
        patch: recovery.patch,
      };
      const plan = createAssetPlaceReadyPlan(session, snapshot);
      const turn = sessions.appendActionPlan(session.id, {
        action: 'asset.place.plan',
        label: `预览把“${snapshot.asset.filename || snapshot.asset.id}”发送到画布`,
        context: creatorContextForDocument(req.body?.context, document),
        plan,
        patch: snapshot.patch,
        source: 'canvas-ui',
      });
      return res.status(recovery.status === 'applied' ? 200 : 201).json(response({
        message: recovery.status === 'applied'
          ? '同一素材、版本、位置和连线已经写入画布；已恢复原完成回执，不会重复添加节点'
          : '已核验素材原件、版本和放置位置；确认前不会写入画布，也不会调用模型',
        data: {
          ...turn,
          plan,
          patch: snapshot.patch,
          placement: plan.assetPlacement,
          alreadyApplied: recovery.status === 'applied'
            ? {
                patchId: recovery.application.patchId,
                baseRevision: recovery.application.baseRevision,
                appliedRevision: recovery.application.appliedRevision,
                previewDigest: recovery.application.previewDigest,
                affectedNodeIds: recovery.application.affectedNodeIds || [],
                affectedEdgeIds: recovery.application.affectedEdgeIds || [],
              }
            : null,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/sessions/:sessionId/comparison', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.query || {});
      const comparison = creative().readAction('compare', {
        nodeId: req.query?.nodeId,
        groupId: req.query?.groupId,
      }, scope);
      return res.json(response({
        message: comparison.requiresVisualReview
          ? '已读取真实候选；采用前仍需完成实际媒体检查'
          : '已读取候选、评审证据与连续性锁',
        data: comparison,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/iterate', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const action = String(req.body?.action || '').trim().toLowerCase();
      const allowed = new Set(['review', 'accept', 'lock', 'unlock', 'branch', 'rollback']);
      if (!allowed.has(action)) {
        throw new CreatorAgentSessionError(
          'CREATOR_ITERATE_ACTION_INVALID',
          '当前 Agent 不支持这个候选操作',
        );
      }
      const capabilityId = `iterate.${action}`;
      const registered = publicCreativeCapabilities().capabilities
        .some((capability) => capability.id === capabilityId);
      if (!registered) {
        throw new CreatorAgentSessionError(
          'CREATOR_CAPABILITY_NOT_REGISTERED',
          '当前候选操作尚未注册到统一能力清单，已停止以保护画布',
          409,
        );
      }
      const input = {
        nodeId: req.body?.nodeId,
        lock: req.body?.lock,
        label: req.body?.label,
        version: req.body?.version,
      };
      if (action === 'review') input.review = req.body?.review;
      const document = database().getCanvas(scope.canvasId);
      if (!document || String(document.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError('CREATOR_SCOPE_NOT_FOUND', '当前画布不存在，无法准备候选操作', 404);
      }
      const plan = creative().actionPlan(action, input, scope);
      const labels = {
        review: '保存真实作品检查',
        accept: '采用这个候选',
        lock: '锁定这个候选的一致性',
        unlock: '解锁这个候选的一致性',
        branch: '从这个候选创建探索分支',
        rollback: '恢复这个候选的上一版本',
      };
      const turn = sessions.appendActionPlan(session.id, {
        action,
        label: labels[action],
        nodeId: input.nodeId,
        context: creatorContextForDocument(req.body?.context, document),
        plan,
      });
      return res.status(201).json(response({
        message: '已形成受控候选操作计划；当前没有修改画布，也没有调用 Provider',
        data: turn,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/messages', async (req, res, next) => {
    let streamingSessionId = '';
    let streamingResponseId = '';
    let streamingControl = null;
    const localPlanningStartedAtMs = readinessNow();
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const document = database().getCanvas(scope.canvasId);
      if (!document || String(document.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError('CREATOR_SCOPE_NOT_FOUND', '当前画布不存在，无法继续这条建议', 404);
      }
      const currentContext = creatorContextForDocument(req.body?.context, document);
      const attachments = normalizeAttachments(req.body?.attachments);
      const requestedSuggestion = req.body?.suggestion && typeof req.body.suggestion === 'object'
        ? req.body.suggestion
        : null;
      const clientRequestId = String(req.body?.clientRequestId || crypto.randomUUID()).trim();
      if (!/^[A-Za-z0-9_-]{16,120}$/.test(clientRequestId)) {
        throw new CreatorAgentSessionError(
          'CREATOR_MESSAGE_REQUEST_ID_INVALID',
          '这条创作要求的恢复编号无效，请重新发送',
        );
      }
      const requestDigest = creatorStableDigest({
        schema: 't8-creator-message-request-v1',
        sessionId: session.id,
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        text: String(req.body?.text || '').trim(),
        attachments,
        context: normalizeContext(req.body?.context),
        suggestion: requestedSuggestion
          ? {
              id: String(requestedSuggestion.id || '').trim(),
              setDigest: String(requestedSuggestion.setDigest || '').trim().toLowerCase(),
            }
          : null,
        kind: String(req.body?.kind || '').trim().toLowerCase(),
        profile: String(req.body?.profile || 'balanced').trim(),
        qualityMode: String(req.body?.qualityMode || '').trim().toLowerCase(),
        ratio: String(req.body?.ratio || '').trim(),
        duration: Number(req.body?.duration) || 0,
        candidates: Number(req.body?.candidates) || 0,
        recipe: Object.prototype.hasOwnProperty.call(req.body || {}, 'recipe')
          ? String(req.body?.recipe || 'general').trim().toLowerCase() : '',
        modelPreferences: req.body?.modelPreferences
          && typeof req.body.modelPreferences === 'object' ? req.body.modelPreferences : {},
        stageContinuation: req.body?.stageContinuation === true,
      });
      const existingRequest = sessions.messageRequest(session.id, {
        clientRequestId,
        requestDigest,
      });
      if (existingRequest) {
        if (existingRequest.status === 'failed') {
          throw new CreatorAgentSessionError(
            'CREATOR_MESSAGE_PREVIOUSLY_FAILED',
            '这条创作要求之前已明确失败；原要求和证据仍保留，请检查原因后作为新要求重试',
            409,
          );
        }
        const inProgress = existingRequest.status === 'in-progress';
        return res.status(inProgress ? 202 : 200).json(response({
          message: existingRequest.status === 'stopped'
            ? '已恢复这条被你停止的回复；原要求和部分文字仍然保留，没有取消任何远端任务'
            : inProgress
            ? '已恢复同一条创作要求，正在继续原回复，不会重复提交'
            : '已恢复同一条创作要求的完整结果，没有重复创建计划',
          data: {
            session: existingRequest.session,
            userEvent: existingRequest.userEvent,
            assistantEvent: existingRequest.assistantEvent,
            request: {
              schema: existingRequest.schema,
              clientRequestId,
              status: existingRequest.status,
              duplicate: true,
            },
            ...(existingRequest.responseId ? {
              stream: {
                responseId: existingRequest.responseId,
                chunkCount: existingRequest.chunkCount,
                durable: true,
                recovering: inProgress,
              },
            } : {}),
          },
        }));
      }
      const activeMessage = activeMessageStreams.get(session.id);
      if (activeMessage) {
        if (activeMessage.clientRequestId === clientRequestId) {
          return res.status(202).json(response({
            message: '同一条创作要求仍在生成中，不会重复调用模型或重复扣费',
            data: {
              session: sessions.read(session.id),
              request: {
                schema: 't8-creator-message-request-v1',
                clientRequestId,
                status: 'in-progress',
                duplicate: true,
              },
              ...(activeMessage.responseId ? {
                stream: {
                  responseId: activeMessage.responseId,
                  durable: true,
                  recovering: true,
                },
              } : {}),
            },
          }));
        }
        throw new CreatorAgentSessionError(
          'CREATOR_RESPONSE_IN_PROGRESS',
          '当前创作会话正在回复，请等待完成后再发送下一条',
          409,
        );
      }
      streamingSessionId = session.id;
      streamingControl = {
        sessionId: session.id,
        responseId: '',
        clientRequestId,
        stopRequested: false,
        phase: 'planning',
      };
      activeMessageStreams.set(session.id, streamingControl);
      let groundedAttachments = attachments;
      try {
        const grounding = await groundCreatorAudioAttachments(attachments, {
          transcribeAudio: transcribeCreatorAudio,
          provider: 'seedance-nz',
        });
        groundedAttachments = grounding.attachments;
      } catch (error) {
        throw new CreatorAgentSessionError(
          String(error?.code || 'CREATOR_AUDIO_GROUNDING_FAILED'),
          String(error?.message || '音频内容无法完成可核验观察，已停止基于音频创作'),
          409,
          { providerCalls: String(error?.code || '').includes('CREDENTIAL') ? 0 : 1 },
        );
      }
      const selectedSuggestion = requestedSuggestion
        ? resolveCreatorSuggestionSelection(session, {
            suggestionId: requestedSuggestion.id,
            suggestionSetDigest: requestedSuggestion.setDigest,
            context: currentContext,
          })
        : null;
      const visiblePrompt = selectedSuggestion?.label
        || String(req.body?.text || '').trim()
        || creatorAttachmentOnlyPrompt(attachments);
      if (!visiblePrompt) throw new CreatorAgentSessionError(
        'CREATOR_MESSAGE_EMPTY', '请先输入创作要求，或添加一个已上传附件',
      );
      const suggestionPrompt = String(
        selectedSuggestion?.arguments?.creatorPrompt || '',
      ).trim();
      const refiningShotBreakdown = Boolean(
        ['reference-breakdown.rhythm', 'reference-breakdown.camera-language']
          .includes(selectedSuggestion?.intent)
        && session.latestPlan?.kind === 'story'
        && session.latestPlan?.brief?.recipe === 'shot-breakdown',
      );
      const continuingReferenceProduction = Boolean(
        selectedSuggestion?.intent === 'reference-breakdown.continue-production'
        && session.latestPlan?.kind === 'story'
        && session.latestPlan?.brief?.recipe === 'shot-breakdown',
      );
      const referenceProduction = continuingReferenceProduction
        ? referenceBreakdownProductionSource(session.latestPlan)
        : null;
      const planningPrompt = referenceProduction?.prompt || suggestionPrompt || visiblePrompt;
      const assetIds = [...new Set([
        ...(Array.isArray(req.body?.assetIds) ? req.body.assetIds : []),
        ...groundedAttachments.map((attachment) => attachment.assetId).filter(Boolean),
        ...((refiningShotBreakdown || continuingReferenceProduction)
          && Array.isArray(session.latestPlan?.brief?.reuseAssetIds)
          ? session.latestPlan.brief.reuseAssetIds
          : []),
        ...(referenceProduction?.assetIds || []),
      ].map((assetId) => String(assetId || '').trim()).filter(Boolean))];
      const modelDecisionAttachments = refiningShotBreakdown || continuingReferenceProduction
        ? assetIds.map((assetId) => {
            const asset = database.getAsset?.(assetId);
            return asset && String(asset.projectId || '') === String(scope.projectId || '')
              ? {
                  assetId,
                  kind: String(asset.kind || ''),
                  mimeType: String(asset.mimeType || ''),
                  contentRevision: Math.max(1, Number(asset.contentRevision || asset.revision) || 1),
                }
              : null;
          }).filter(Boolean)
        : groundedAttachments;
      const suggestionKind = String(
        selectedSuggestion?.arguments?.creatorKind || '',
      ).trim().toLowerCase();
      const allowedSuggestionKinds = new Set([
        'story',
        'script',
        'image',
        'edit-image',
        'video',
        'edit-video',
        'audio',
        'delivery',
      ]);
      const kind = refiningShotBreakdown || continuingReferenceProduction
        ? 'story'
        : allowedSuggestionKinds.has(suggestionKind)
          ? suggestionKind
          : String(req.body?.kind || '').trim().toLowerCase()
            || inferCreatorKind(planningPrompt, groundedAttachments);
      const recipe = refiningShotBreakdown
        ? 'shot-breakdown'
        : continuingReferenceProduction
          ? 'storyboard'
        : Object.prototype.hasOwnProperty.call(req.body || {}, 'recipe')
        ? String(req.body?.recipe || 'general').trim().toLowerCase()
        : inferCreatorRecipe(planningPrompt, kind, groundedAttachments);
      let decisionTurn = null;
      if (recipe !== 'shot-breakdown') {
        try {
          const decisionSelection = selectedSuggestion?.arguments?.decisionOptionId
            ? {
                decisionDocumentId: selectedSuggestion.arguments.decisionDocumentId,
                decisionDocumentVersionId:
                  selectedSuggestion.arguments.decisionDocumentVersionId,
                decisionDocumentDigest:
                  selectedSuggestion.arguments.decisionDocumentDigest,
                decisionId: selectedSuggestion.arguments.decisionId,
                decisionOptionId: selectedSuggestion.arguments.decisionOptionId,
              }
            : null;
          decisionTurn = prepareCreatorDecisionTurn({
            sessionId: session.id,
            document: session.decisionDocument,
            family: session.decisionDocument?.family,
            phase: session.production?.currentPhase,
            kind,
            prompt: planningPrompt,
            selection: decisionSelection,
            customValue: selectedSuggestion
              ? ''
              : String(req.body?.text || '').trim(),
            skipAnswer: req.body?.stageContinuation === true,
          });
        } catch (error) {
          throw new CreatorAgentSessionError(
            'CREATOR_DECISION_SELECTION_STALE',
            '当前选择已经不是本阶段正在完善的内容，请使用最新回复下方的三个选项',
            409,
            { cause: String(error?.message || error) },
          );
        }
      }
      const requestedModelPreferences = req.body?.modelPreferences && typeof req.body.modelPreferences === 'object'
        ? req.body.modelPreferences
        : {};
      const readinessGraph = publicCreativeCapabilityGraph({
        settingsFile: runtimeConfig.SETTINGS_FILE,
        credentialSettingsProvider: options.credentialSettingsProvider,
        runtimeStatusProvider: options.runtimeStatusProvider,
      });
      const dynamicItems = modelPreferenceNeedsDynamicCatalog(
        creativeModelCatalog,
        requestedModelPreferences,
      )
        ? creative().models({}, scope).items || []
        : [];
      const decisionModels = runtimeDecisionModels({
        catalog: creativeModelCatalog,
        capabilityGraph: readinessGraph,
        dynamicItems,
      });
      const modelDecision = createCreatorModelDecision({
        kind,
        recipe,
        attachments: modelDecisionAttachments,
        preferences: requestedModelPreferences,
        models: decisionModels,
        catalogDigest: creativeModelCatalog.sourceDigest,
        ratio: req.body?.ratio,
        duration: req.body?.duration,
        profile: req.body?.profile || 'balanced',
      });
      if (modelDecision.errors.length > 0) {
        const first = modelDecision.errors[0];
        throw new CreatorAgentSessionError(first.code, first.message, 409, {
          modelKind: first.kind,
          silentFallback: false,
        });
      }
      const modelFields = modelDecision.modelFields;
      const plan = kind === 'delivery'
        ? createDeliveryIntentPlan(session, document, planningPrompt)
        : creative().createPlan({
            kind,
            prompt: planningPrompt,
            ...(referenceProduction ? { title: referenceProduction.title } : {}),
            profile: req.body?.profile || 'balanced',
            candidates: req.body?.candidates,
            ratio: req.body?.ratio,
            duration: req.body?.duration,
            language: req.body?.language || '中文',
            template: req.body?.template || recipe,
            recipe,
            assetIds,
            artifactVerifications: session.artifactVerifications,
            deliveryEvidence: session.deliveryEvidence,
             modelDecisionReceipt: modelDecision.receipt,
             previousProductionDocuments: sessions.productionDocumentsForNextPlan(session.id),
             stagedProduction: recipe !== 'shot-breakdown',
             ...modelFields,
          }, scope);
      const readinessReceipt = createCreatorAgentLocalReadinessReceipt({
        startedAtMs: localPlanningStartedAtMs,
        readyAtMs: readinessNow(),
      });
      const requestHost = String(req.get('host') || '').replace(/[^A-Za-z0-9.:[\]-]/g, '');
      const responseInput = {
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        prompt: planningPrompt,
        kind,
        recipe,
        attachments: groundedAttachments,
        session,
        plan,
        modelDecisionReceipt: modelDecision.receipt,
        decisionTurn,
        qualityMode: String(req.body?.qualityMode || '').trim().toLowerCase(),
        // Current Canvas clients always send an explicit quality mode and use
        // the strict Creator Work contract. Older API clients that predate the
        // work-object UI keep their legacy prose response path until migrated.
        requireStructuredWork: ['quick', 'standard', 'quality'].includes(
          String(req.body?.qualityMode || '').trim().toLowerCase(),
        ),
        stageContinuation: req.body?.stageContinuation === true,
        logicalRequestId: clientRequestId,
        requestBaseUrl: requestHost ? `${req.protocol}://${requestHost}` : undefined,
      };
      const llmRuntime = creatorLlm();
      const wantsStream = req.body?.stream === true;
      const controlledPatch = plan.ready
        && kind !== 'delivery'
        && Number(plan?.impact?.patchOperationCount || 0) > 0
        ? creative().requirePlan(plan.planId, scope).patch
        : null;
      const baseTurnInput = {
        text: selectedSuggestion
          ? suggestionPrompt || visiblePrompt
          : String(req.body?.text || '').trim(),
        attachments: groundedAttachments,
        context: currentContext,
        plan,
        patch: controlledPatch,
        suggestionSelection: selectedSuggestion
          ? {
              id: selectedSuggestion.id,
              intent: selectedSuggestion.intent,
              label: selectedSuggestion.label,
              setDigest: requestedSuggestion.setDigest,
            }
          : null,
        clientRequestId,
        requestDigest,
        readinessReceipt,
        decisionTurn,
        qualityMode: String(req.body?.qualityMode || '').trim().toLowerCase(),
      };
      const preparedResponse = wantsStream && typeof llmRuntime.prepareResponse === 'function'
        ? llmRuntime.prepareResponse(responseInput)
        : null;
      if (preparedResponse?.mode === 'online-model') {
        const begun = sessions.beginStreamingTurn(session.id, {
          ...baseTurnInput,
          live: true,
          responseEvidence: preparedResponse.startedEvidence,
        });
        streamingResponseId = begun.responseId;
        streamingControl.responseId = begun.responseId;
        streamingControl.phase = 'streaming';
        const durableDeltaTargetChars = 320;
        let durableDeltaCount = 0;
        let durableDeltaBuffer = '';
        let firstDurableDeltaPersisted = false;
        const persistDurableDelta = (delta) => {
          for (let offset = 0; offset < delta.length; offset += 2_000) {
            const part = delta.slice(offset, offset + 2_000);
            if (!part) continue;
            sessions.appendResponseDelta(session.id, {
              responseId: begun.responseId,
              index: durableDeltaCount,
              delta: part,
            });
            durableDeltaCount += 1;
          }
        };
        const appendDurableDelta = async (incomingDelta) => {
          const delta = String(incomingDelta == null ? '' : incomingDelta);
          if (!delta || streamingControl.stopRequested) return;
          if (!firstDurableDeltaPersisted) {
            persistDurableDelta(delta);
            firstDurableDeltaPersisted = true;
            return;
          }
          durableDeltaBuffer += delta;
          while (durableDeltaBuffer.length >= durableDeltaTargetChars) {
            persistDurableDelta(durableDeltaBuffer.slice(0, durableDeltaTargetChars));
            durableDeltaBuffer = durableDeltaBuffer.slice(durableDeltaTargetChars);
          }
        };
        const flushDurableDelta = () => {
          if (!durableDeltaBuffer) return;
          persistDurableDelta(durableDeltaBuffer);
          durableDeltaBuffer = '';
        };
        const creativeResponse = await llmRuntime.createResponse(responseInput, {
          prepared: preparedResponse,
          onDelta: appendDurableDelta,
          shouldStop: () => Boolean(streamingControl.stopRequested),
        });
        const responseMessage = creativeResponse.evidence?.mode === 'online-model'
          ? '已生成本轮可编辑创作 V0；当前没有修改画布或启动素材生成'
          : creativeResponse.evidence?.mode === 'offline-fallback'
            ? '在线模型没有返回可用正文，已保留要求并给出离线结构 V0；当前没有修改画布'
            : '当前 LLM 未就绪，已明确给出离线结构 V0；当前没有修改画布或启动生成';
        flushDurableDelta();
        if (streamingControl.stopRequested || creativeResponse.stopped) {
          const stopped = sessions.stopStreamingTurn(session.id, {
            responseId: begun.responseId,
          });
          return res.status(200).json(response({
            message: '已停止本轮文字回复；画布里的远端生成任务没有被取消',
            data: {
              session: stopped.session,
              userEvent: begun.userEvent,
              assistantEvent: stopped.assistantEvent,
              request: {
                schema: 't8-creator-message-request-v1',
                clientRequestId,
                status: stopped.status,
                duplicate: stopped.duplicate,
              },
              stream: {
                responseId: begun.responseId,
                chunkCount: durableDeltaCount,
                durable: true,
                transport: 'upstream-sse',
                stopped: true,
                remoteTasksAffected: 0,
              },
            },
          }));
        }
        const completed = sessions.completeStreamingTurn(session.id, {
          ...baseTurnInput,
          responseId: begun.responseId,
          assistantText: creativeResponse.text,
          responseEvidence: creativeResponse.evidence,
          artifactProposal: creativeResponse.artifactProposal,
          workProposal: creativeResponse.workProposal,
        });
        const toolProposalResult = persistCreatorToolProposals(
          session.id,
          completed.assistantEvent,
          creativeResponse.toolProposals,
        );
        return res.status(201).json(response({
          message: responseMessage,
          data: {
            session: toolProposalResult.session,
            userEvent: begun.userEvent,
            assistantEvent: completed.assistantEvent,
            toolProposals: toolProposalResult.proposals,
            toolProposalReceipts: toolProposalResult.receipts,
            readinessReceipt,
            request: {
              schema: 't8-creator-message-request-v1',
              clientRequestId,
              status: 'completed',
              duplicate: false,
            },
            stream: {
              responseId: begun.responseId,
              chunkCount: durableDeltaCount,
              durable: true,
              transport: 'upstream-sse',
            },
          },
        }));
      }
      const creativeResponse = await llmRuntime.createResponse(
        responseInput,
        preparedResponse ? { prepared: preparedResponse } : {},
      );
      const responseMessage = creativeResponse.evidence?.mode === 'online-model'
        ? '已生成本轮可编辑创作 V0；当前没有修改画布或启动素材生成'
        : creativeResponse.evidence?.mode === 'offline-fallback'
          ? '在线模型没有返回可用正文，已保留要求并给出离线结构 V0；当前没有修改画布'
          : '当前 LLM 未就绪，已明确给出离线结构 V0；当前没有修改画布或启动生成';
      const turnInput = {
        ...baseTurnInput,
        assistantText: creativeResponse.text,
        responseEvidence: creativeResponse.evidence,
        artifactProposal: creativeResponse.artifactProposal,
        workProposal: creativeResponse.workProposal,
      };
      if (!wantsStream) {
        const turn = sessions.appendTurn(session.id, turnInput);
        const toolProposalResult = persistCreatorToolProposals(
          session.id,
          turn.assistantEvent,
          creativeResponse.toolProposals,
        );
        return res.status(201).json(response({
          message: responseMessage,
          data: {
            ...turn,
            session: toolProposalResult.session,
            toolProposals: toolProposalResult.proposals,
            toolProposalReceipts: toolProposalResult.receipts,
            readinessReceipt,
            request: {
              schema: 't8-creator-message-request-v1',
              clientRequestId,
              status: 'completed',
              duplicate: false,
            },
          },
        }));
      }
      const begun = sessions.beginStreamingTurn(session.id, turnInput);
      streamingResponseId = begun.responseId;
      streamingControl.responseId = begun.responseId;
      streamingControl.phase = 'streaming';
      for (let index = 0; index < begun.chunks.length; index += 1) {
        await waitForResponseDelta();
        if (streamingControl.stopRequested) break;
        sessions.appendResponseDelta(session.id, {
          responseId: begun.responseId,
          index,
          delta: begun.chunks[index],
        });
      }
      if (streamingControl.stopRequested) {
        const stopped = sessions.stopStreamingTurn(session.id, {
          responseId: begun.responseId,
        });
        return res.status(200).json(response({
          message: '已停止本轮文字回复；画布里的远端生成任务没有被取消',
          data: {
            session: stopped.session,
            userEvent: begun.userEvent,
            assistantEvent: stopped.assistantEvent,
            request: {
              schema: 't8-creator-message-request-v1',
              clientRequestId,
              status: stopped.status,
              duplicate: stopped.duplicate,
            },
            stream: {
              responseId: begun.responseId,
              chunkCount: begun.chunks.length,
              durable: true,
              stopped: true,
              remoteTasksAffected: 0,
            },
          },
        }));
      }
      const completed = sessions.completeStreamingTurn(session.id, {
        ...turnInput,
        responseId: begun.responseId,
      });
      const toolProposalResult = persistCreatorToolProposals(
        session.id,
        completed.assistantEvent,
        creativeResponse.toolProposals,
      );
      return res.status(201).json(response({
        message: responseMessage,
        data: {
          session: toolProposalResult.session,
          userEvent: begun.userEvent,
          assistantEvent: completed.assistantEvent,
          toolProposals: toolProposalResult.proposals,
          toolProposalReceipts: toolProposalResult.receipts,
          readinessReceipt,
          request: {
            schema: 't8-creator-message-request-v1',
            clientRequestId,
            status: 'completed',
            duplicate: false,
          },
          stream: {
            responseId: begun.responseId,
            chunkCount: begun.chunks.length,
            durable: true,
          },
        },
      }));
    } catch (error) {
      if (streamingSessionId && streamingResponseId) {
        try {
          sessions.failStreamingTurn(streamingSessionId, {
            responseId: streamingResponseId,
            message: error?.message,
          });
        } catch {
          // Preserve the original error and fail closed.
        }
      }
      return next(error);
    } finally {
      if (streamingSessionId
        && activeMessageStreams.get(streamingSessionId) === streamingControl) {
        activeMessageStreams.delete(streamingSessionId);
      }
    }
  });

  router.post('/sessions/:sessionId/responses/:responseId/stop', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      ensureSessionScope(session, req.body || {});
      const responseId = String(req.params.responseId || '').trim();
      const active = activeMessageStreams.get(session.id);
      if (active?.responseId === responseId) active.stopRequested = true;
      const stopped = sessions.stopStreamingTurn(session.id, { responseId });
      const messages = {
        stopped: stopped.duplicate
          ? '本轮文字回复已经停止；画布里的远端生成任务没有被取消'
          : '已停止本轮文字回复；画布里的远端生成任务没有被取消',
        completed: '本轮文字回复已经完成，不需要停止；画布里的远端生成任务没有受到影响',
        failed: '本轮文字回复此前已经中断；画布里的远端生成任务没有受到影响',
      };
      return res.json(response({
        message: messages[stopped.status] || messages.stopped,
        data: {
          schema: 't8-creator-response-stop-v1',
          responseId,
          status: stopped.status,
          duplicate: stopped.duplicate,
          remoteTasksAffected: 0,
          session: stopped.session,
          assistantEvent: stopped.assistantEvent,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/sessions/:sessionId/messages/:clientRequestId', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      ensureSessionScope(session, req.query || {});
      const requestState = sessions.messageRequest(session.id, {
        clientRequestId: req.params.clientRequestId,
      });
      if (!requestState) {
        throw new CreatorAgentSessionError(
          'CREATOR_MESSAGE_REQUEST_NOT_FOUND',
          '当前会话没有找到这条创作要求，可能尚未到达本机',
          404,
        );
      }
      return res.json(response({
        message: requestState.status === 'completed'
          ? '已恢复这条创作要求的完整结果'
          : requestState.status === 'stopped'
            ? '已恢复这条被你停止的回复；原要求和部分文字仍然保留'
          : requestState.status === 'failed'
            ? '已恢复这条创作要求的失败证据'
            : '已找到这条创作要求，原回复仍在继续',
        data: requestState,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/delivery/plan', async (req, res, next) => {
    try {
      cleanupDeliveryState();
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const capability = publicCreativeCapabilities().capabilities
        .find((item) => item.id === 'delivery.package');
      if (!capability) {
        throw new CreatorAgentSessionError(
          'CREATOR_CAPABILITY_NOT_REGISTERED',
          '交付能力尚未注册到统一能力清单，已停止以保护作品',
          409,
        );
      }
      const parentPath = String(req.body?.parentPath || '').trim();
      if (!parentPath || !path.isAbsolute(parentPath)) {
        throw new CreatorAgentSessionError(
          'CREATOR_DELIVERY_DIRECTORY_REQUIRED',
          '请在桌面版选择一个本机交付文件夹',
        );
      }
      const packageName = creatorDeliveryPackageName(
        req.body?.packageName,
        session.context?.canvasTitle || session.title,
      );
      const parentAbsolute = path.resolve(parentPath);
      const targetPath = path.resolve(parentAbsolute, packageName);
      if (path.dirname(targetPath) !== parentAbsolute) {
        throw new CreatorAgentSessionError(
          'CREATOR_DELIVERY_PACKAGE_NAME_INVALID',
          '交付包必须创建在你刚选择的文件夹内',
        );
      }
      const document = database().getCanvas(scope.canvasId);
      if (!document || String(document.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError('CREATOR_SCOPE_NOT_FOUND', '当前画布不存在，无法准备交付', 404);
      }
      const snapshot = await delivery().inspectPackage(document, {
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        scope: req.body?.scope === 'project' ? 'project' : 'canvas',
        assetIds: req.body?.assetIds,
        targetPath,
      });
      const plan = createDeliveryReadyPlan(session, snapshot);
      deliveryDrafts.set(plan.planId, {
        sessionId: session.id,
        planDigest: plan.planDigest,
        snapshot,
        expiresAt: Date.now() + CREATOR_DELIVERY_DRAFT_TTL_MS,
      });
      const turn = sessions.appendActionPlan(session.id, {
        action: 'delivery.package.plan',
        label: `核对 ${snapshot.collection.items.length} 个交付素材`,
        context: creatorContextForDocument(req.body?.context, document),
        plan,
      });
      return res.status(201).json(response({
        message: '已核对精确素材、哈希、许可状态和目标目录；尚未创建任何文件',
        data: turn,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/delivery/:planId/request-approval', (req, res, next) => {
    try {
      cleanupDeliveryState();
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const planId = String(req.params.planId || '');
      const draft = deliveryDrafts.get(planId);
      if (!draft
        || draft.sessionId !== session.id
        || draft.planDigest !== session.latestPlan?.planDigest
        || session.latestPlan?.planId !== planId
        || session.latestPlan?.kind !== 'delivery'
        || !session.latestPlan?.ready) {
        throw new CreatorAgentSessionError(
          'CREATOR_DELIVERY_PLAN_STALE',
          '交付清单已过期或不是当前计划，请重新选择交付位置并核对',
          409,
        );
      }
      const existing = [...deliveryApprovals.values()].find((item) => (
        item.sessionId === session.id
        && item.planId === planId
        && !item.completedEvidence
        && item.expiresAt > Date.now()
      ));
      if (existing) {
        return res.status(202).json(response({
          message: '交付确认仍在等待桌面端处理',
          data: {
            approvalRequestId: existing.approvalRequestId,
            planId,
            status: 'pending',
            expiresAt: new Date(existing.expiresAt).toISOString(),
            preview: existing.preview,
            session,
          },
        }));
      }
      const created = approvals.create({
        action: 'delivery.package',
        operationId: `creator-delivery-${draft.snapshot.collection.selectionDigest.slice(0, 24)}`,
        sessionId: scope.sessionId,
        actorId: scope.actorId,
        clientName: '贞贞创作 Agent',
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        payload: draft.snapshot,
        preview: draft.snapshot.preview,
      });
      const expiresAt = Date.parse(created.expiresAt) || (Date.now() + CREATOR_DELIVERY_DRAFT_TTL_MS);
      deliveryApprovals.set(created.approvalRequestId, {
        approvalRequestId: created.approvalRequestId,
        sessionId: session.id,
        planId,
        pollSecret: created.pollSecret,
        preview: created.preview,
        expiresAt,
        completedEvidence: null,
      });
      const updated = sessions.appendLifecycle(session.id, 'delivery.approval-requested', {
        approvalRequestId: created.approvalRequestId,
        planId,
        packageName: draft.snapshot.target.basename,
        itemCount: draft.snapshot.collection.items.length,
        totalBytes: draft.snapshot.collection.totalBytes,
        licenseSummary: draft.snapshot.collection.licenseSummary,
        expiresAt: created.expiresAt,
      });
      return res.status(202).json(response({
        message: '交付包已进入桌面确认；核对并批准前不会创建文件',
        data: {
          approvalRequestId: created.approvalRequestId,
          planId,
          status: 'pending',
          expiresAt: created.expiresAt,
          preview: created.preview,
          session: updated,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/delivery/approvals/:approvalRequestId/complete', async (req, res, next) => {
    let completion = null;
    let binding = null;
    try {
      cleanupDeliveryState();
      let session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const approvalRequestId = String(req.params.approvalRequestId || '');
      const existingEvidence = (Array.isArray(session.deliveryEvidence) ? session.deliveryEvidence : [])
        .find((item) => item?.approvalRequestId === approvalRequestId);
      if (existingEvidence) {
        return res.json(response({
          message: '交付包已经创建并通过固定摘要复核',
          data: { status: 'completed', evidence: existingEvidence, session },
        }));
      }
      binding = deliveryApprovals.get(approvalRequestId);
      if (!binding || binding.sessionId !== session.id) {
        throw new CreatorAgentSessionError(
          'CREATOR_DELIVERY_APPROVAL_NOT_FOUND',
          '交付确认不存在、已过期或不属于当前创作会话',
          404,
        );
      }
      if (binding.completedEvidence) {
        session = sessions.appendLifecycle(session.id, 'delivery.completed', binding.completedEvidence);
        deliveryApprovals.delete(approvalRequestId);
        return res.json(response({
          message: '交付包已经创建并通过固定摘要复核',
          data: { status: 'completed', evidence: binding.completedEvidence, session },
        }));
      }
      completion = approvals.beginCompletion({
        approvalRequestId,
        pollSecret: binding.pollSecret,
        sessionId: scope.sessionId,
      });
      if (completion.status === 'pending') {
        return res.json(response({
          message: '仍在等待桌面端确认',
          data: { status: 'pending', approvalRequestId, session },
        }));
      }
      if (completion.status === 'denied') {
        session = sessions.appendLifecycle(session.id, 'delivery.denied', {
          approvalRequestId,
          planId: binding.planId,
        });
        deliveryApprovals.delete(approvalRequestId);
        return res.json(response({
          message: '你已取消本次交付；没有创建文件',
          data: { status: 'denied', approvalRequestId, session },
        }));
      }
      const record = completion.record;
      if (!record
        || record.action !== 'delivery.package'
        || record.projectId !== scope.projectId
        || record.canvasId !== scope.canvasId) {
        throw new CreatorAgentSessionError(
          'CREATOR_DELIVERY_APPROVAL_SCOPE_MISMATCH',
          '交付确认与当前项目或画布不一致',
          409,
        );
      }
      const document = database().getCanvas(scope.canvasId);
      if (!document || String(document.projectId || '') !== scope.projectId) {
        throw new CreatorAgentSessionError('CREATOR_SCOPE_NOT_FOUND', '当前画布不存在，无法创建交付包', 404);
      }
      const result = await delivery().packageDelivery(document, record.payload);
      const verification = await delivery().verifyPackage(record.payload.target.absolute, {
        expectedPackageDigest: result.packageDigest,
      });
      if (!verification.valid
        || verification.verifiedItems !== result.itemCount
        || verification.verifiedBytes !== result.totalBytes) {
        throw new AgentControlDeliveryError(
          'DELIVERY_POST_VERIFY_FAILED',
          '交付包已停止：创建后的完整文件与固定摘要复核未通过',
          409,
          { failures: verification.failures },
        );
      }
      const evidence = {
        approvalRequestId,
        planId: binding.planId,
        packageName: result.packageName,
        itemCount: result.itemCount,
        totalBytes: result.totalBytes,
        packageDigest: result.packageDigest,
        verifiedItems: verification.verifiedItems,
        verifiedBytes: verification.verifiedBytes,
        valid: verification.valid,
        scope: record.payload.collection.scope,
        canvasRevision: record.payload.collection.canvasRevision,
        catalogRevision: record.payload.collection.catalogRevision,
        selectionDigest: record.payload.collection.selectionDigest,
        files: result.files.map((item) => ({
          assetId: item.assetId,
          size: item.size,
          sha256: item.sha256,
        })),
        licenseSummary: result.licenseSummary,
      };
      binding.completedEvidence = evidence;
      approvals.finishCompletion(record, true);
      completion = null;
      session = sessions.appendLifecycle(session.id, 'delivery.completed', evidence);
      deliveryApprovals.delete(approvalRequestId);
      deliveryDrafts.delete(binding.planId);
      return res.json(response({
        message: '交付包已原子创建，并用固定 SHA-256 摘要完成独立复核',
        data: { status: 'completed', evidence, session },
      }));
    } catch (error) {
      if (completion?.record && !binding?.completedEvidence) {
        approvals.finishCompletion(completion.record, false);
      }
      if (binding && !binding.completedEvidence) {
        try {
          sessions.appendLifecycle(binding.sessionId, 'delivery.failed', {
            approvalRequestId: binding.approvalRequestId,
            planId: binding.planId,
            error: error?.message || '交付包创建失败',
          });
        } catch (_) {}
        deliveryApprovals.delete(binding.approvalRequestId);
      }
      return next(error);
    }
  });

  router.get('/sessions/:sessionId/plans/:planId/patch', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.query || {});
      const latestPlan = session.latestPlan;
      const matchesStoredPlan = latestPlan?.planId === req.params.planId
        && latestPlan.projectId === session.projectId
        && latestPlan.canvasId === session.canvasId
        && session.latestPatch;
      if (matchesStoredPlan) {
        return res.json(response({
          message: '已返回共享创作会话中的受控画布变更；尚未写入画布',
          data: {
            planId: latestPlan.planId,
            planDigest: latestPlan.planDigest,
            patch: session.latestPatch,
            summary: session.latestPatch?.summary || latestPlan.brief?.goal || '',
          },
        }));
      }
      const plan = creative().requirePlan(req.params.planId, scope);
      return res.json(response({
        message: '已返回待预览的受控画布变更；尚未写入画布',
        data: {
          planId: plan.id,
          planDigest: plan.planDigest,
          patch: plan.patch,
          summary: plan.patch?.summary || plan.brief?.goal || '',
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/sessions/:sessionId/events', (req, res, next) => {
    let timer = null;
    let heartbeat = null;
    let lastRunSyncAt = 0;
    let lastRunSyncErrorAt = 0;
    try {
      const session = sessions.read(req.params.sessionId);
      ensureSessionScope(session, req.query || {});
      let cursor = Math.max(
        0,
        Math.trunc(Number(req.query?.after) || 0),
        Math.trunc(Number(req.get('last-event-id')) || 0),
      );
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      const writeEvent = (eventName, id, value) => {
        if (res.writableEnded) return;
        if (id) res.write(`id: ${id}\n`);
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        if (heartbeat) clearInterval(heartbeat);
        timer = null;
        heartbeat = null;
      };
      const pump = () => {
        try {
          const currentTime = Date.now();
          if (currentTime - lastRunSyncAt >= 500) {
            lastRunSyncAt = currentTime;
            try {
              syncCreatorRunEvents(session.id);
            } catch {
              if (currentTime - lastRunSyncErrorAt >= 5_000) {
                lastRunSyncErrorAt = currentTime;
                writeEvent('run.sync.error', '', {
                  sessionId: session.id,
                  message: '真实任务进度暂时无法同步；回复与已有创作记录仍然安全，可以稍后重试',
                });
              }
            }
          }
          const batch = sessions.eventsAfter(session.id, cursor, 200);
          if (batch.cursorReset) {
            writeEvent('cursor.reset', '', {
              sessionId: session.id,
              after: cursor,
              reason: 'event-tail-rotated',
            });
          }
          for (const event of batch.events) {
            cursor = Math.max(cursor, Number(event.sequence) || cursor);
            writeEvent('creator.event', String(event.sequence), event);
          }
        } catch {
          writeEvent('stream.error', '', {
            sessionId: session.id,
            message: '创作会话事件暂时无法继续读取，请重新打开面板恢复',
          });
          stop();
          res.end();
        }
      };
      pump();
      timer = setInterval(pump, 200);
      timer.unref?.();
      heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n');
      }, 15_000);
      heartbeat.unref?.();
      req.on('close', () => {
        stop();
      });
      return undefined;
    } catch (error) {
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (res.headersSent) {
        res.end();
        return undefined;
      }
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/run-links/reconcile', (req, res, next) => {
    try {
      let session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const requestedRunIds = [...new Set((Array.isArray(req.body?.runIds) ? req.body.runIds : [])
        .map((runId) => String(runId || '').trim())
        .filter(Boolean))].slice(0, 12);
      const appliedByPlanId = new Map([...replayCreatorCanvasPlanStates(session).entries()]
        .filter(([, state]) => state.status === 'applied')
        .map(([planId, state]) => [planId, state.payload]));
      const plansById = new Map((session.events || [])
        .map((event) => creatorAssistantEventPlan(event))
        .filter((plan) => plan?.planId)
        .map((plan) => [String(plan.planId), plan]));
      if (session.latestPlan?.planId) {
        plansById.set(String(session.latestPlan.planId), session.latestPlan);
      }

      const linked = [];
      for (const runId of requestedRunIds) {
        const run = database().getRun?.(runId);
        if (!run) continue;
        if (String(run.projectId || '') !== scope.projectId || String(run.canvasId || '') !== scope.canvasId) {
          throw new CreatorAgentSessionError(
            'CREATOR_RUN_SCOPE_MISMATCH',
            '这个真实任务不属于当前创作会话的项目或画布',
            409,
          );
        }
        const nodeIds = new Set((database().listNodeRuns?.(run.id) || [])
          .map((nodeRun) => String(nodeRun.originalNodeId || nodeRun.nodeId || ''))
          .filter(Boolean));
        for (const [planId, applied] of appliedByPlanId.entries()) {
          const plan = plansById.get(planId);
          if (!plan || String(plan.projectId || '') !== scope.projectId
            || String(plan.canvasId || '') !== scope.canvasId) continue;
          const proposedNodeIds = (Array.isArray(plan.targets?.proposedNodes) ? plan.targets.proposedNodes : [])
            .map((node) => String(node?.id || ''))
            .filter(Boolean);
          const matchedNodeIds = proposedNodeIds.filter((nodeId) => nodeIds.has(nodeId));
          if (!matchedNodeIds.length) continue;

          const runIntentId = typeof run.summary?.runIntentId === 'string'
            ? String(run.summary.runIntentId).trim()
            : '';
          if (runIntentId) {
            const intent = database().getRunIntent?.(runIntentId);
            if (!intent
              || String(intent.projectId || '') !== scope.projectId
              || String(intent.canvasId || '') !== scope.canvasId
              || (intent.runId && String(intent.runId) !== String(run.id))) {
              throw new CreatorAgentSessionError(
                'CREATOR_RUN_INTENT_EVIDENCE_INVALID',
                '真实任务中的 RunIntent 证据与当前项目、画布或 Run 不一致',
                409,
              );
            }
          }
          session = sessions.appendLifecycle(session.id, 'run.linked', {
            planId,
            planDigest: String(plan.planDigest || applied.planDigest || ''),
            patchId: String(applied.patchId || plan.patchId || ''),
            runId: String(run.id),
            runIntentId,
            matchedNodeIds,
          });
          const evidence = session.runLinks.find((link) => (
            link.planId === planId && link.runId === String(run.id)
          ));
          if (evidence) linked.push(evidence);
        }
      }
      return res.json(response({
        message: linked.length ? '已核对并关联真实运行证据' : '没有发现新的已验证运行关联',
        data: { session, linked },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/runs/:runId/verify-artifacts', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const runId = String(req.params.runId || '').trim();
      const link = session.runLinks.find((item) => item?.runId === runId);
      if (!link) {
        throw new CreatorAgentSessionError(
          'CREATOR_RUN_NOT_LINKED',
          '这个任务尚未通过当前创作会话的计划和节点关联核对',
          409,
        );
      }
      const db = database();
      const run = db.getRun?.(runId);
      if (!run
        || String(run.projectId || '') !== scope.projectId
        || String(run.canvasId || '') !== scope.canvasId) {
        throw new CreatorAgentSessionError(
          'CREATOR_RUN_SCOPE_MISMATCH',
          '这个真实任务不属于当前创作会话的项目或画布',
          409,
        );
      }
      if (!['succeeded', 'completed'].includes(String(run.status || ''))) {
        throw new CreatorAgentSessionError(
          'CREATOR_RUN_NOT_READY_FOR_ARTIFACT_VERIFICATION',
          '任务完成后才能核验本地产物；当前不会读取文件或调用模型',
          409,
        );
      }
      const verification = verifyCompletionEvidence(db, {
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        runId,
        canvasRevision: run.canvasRevision,
        nodeIds: [],
      });
      const updated = sessions.appendLifecycle(session.id, 'run.artifacts-verified', {
        runId,
        verification,
      });
      return res.json(response({
        message: verification.verified
          ? `已核验 ${verification.assets.length} 个本地产物的文件、SHA-256、格式与运行关联`
          : '产物核验未通过；已保留真实失败原因供排查',
        data: {
          session: updated,
          verification: updated.artifactVerifications.find((item) => item.runId === runId) || null,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/sessions/:sessionId/events', (req, res, next) => {
    try {
      const session = sessions.read(req.params.sessionId);
      const scope = ensureSessionScope(session, req.body || {});
      const type = String(req.body?.type || '');
      if (!['plan.previewed', 'plan.applied', 'plan.reverted', 'plan.failed', 'artifact.sent-to-canvas'].includes(type)) {
        throw new CreatorAgentSessionError('CREATOR_EVENT_TYPE_INVALID', '创作事件类型无效');
      }
      let payload = req.body?.payload && typeof req.body?.payload === 'object' ? req.body.payload : {};
      if (type === 'artifact.sent-to-canvas') {
        const planId = String(payload?.planId || '').trim();
        const patchId = String(payload?.patchId || '').trim();
        const state = replayCreatorCanvasPlanStates(session).get(planId);
        const plan = session.latestPlan?.planId === planId ? session.latestPlan : null;
        if (!plan
          || plan.action !== 'asset.place'
          || String(plan.patchId || '') !== patchId
          || state?.status !== 'applied'
          || String(state?.payload?.patchId || '') !== patchId) {
          throw new CreatorAgentSessionError(
            'CREATOR_ASSET_PLACE_EVIDENCE_INVALID',
            '没有找到这项素材已经写入当前画布的权威 Patch 证据',
            409,
          );
        }
        if (String(plan.assetPlacement?.asset?.id || '') !== String(payload?.assetId || '')) {
          throw new CreatorAgentSessionError(
            'CREATOR_ASSET_PLACE_ASSET_MISMATCH',
            '素材与已应用的画布计划不一致，已停止记录',
            409,
          );
        }
      }
      if (type === 'plan.applied' || type === 'plan.reverted') {
        if (type === 'plan.reverted') {
          const planId = String(payload?.planId || '').trim();
          const state = replayCreatorCanvasPlanStates(session).get(planId);
          const samePatch = String(state?.payload?.patchId || '') === String(payload?.patchId || '');
          const alreadyRecorded = state?.status === 'reverted' && samePatch;
          if (!alreadyRecorded && (!state || state.status !== 'applied' || !samePatch)) {
            throw new CreatorAgentSessionError(
              'CREATOR_PLAN_NOT_APPLIED',
              '这条计划当前没有可撤回的画布变更',
              409,
            );
          }
          if (!alreadyRecorded && (session.runLinks || []).some((link) => String(link?.planId || '') === planId)) {
            throw new CreatorAgentSessionError(
              'CREATOR_PLAN_ALREADY_RAN',
              '这条计划已经关联真实任务，不能再撤回结构；请创建探索分支或使用版本回退',
              409,
            );
          }
        }
        payload = canonicalCreatorCanvasLifecycle(database(), session, scope, type, payload);
      }
      const updated = sessions.appendLifecycle(session.id, type, payload);
      return res.status(201).json(response({ data: updated }));
    } catch (error) {
      return next(error);
    }
  });

  router.use((error, _req, res, _next) => {
    const known = error instanceof CreatorAgentSessionError
      || error instanceof AgentControlCreativeError
      || error instanceof AgentControlAssetError
      || error instanceof AgentControlApprovalError
      || error instanceof AgentControlDeliveryError;
    const status = known
      ? Math.max(400, Math.min(599, Number(error.status || error.statusCode) || 400))
      : 500;
    return res.status(status).json({
      schema: CREATOR_AGENT_HTTP_SCHEMA,
      ok: false,
      code: known ? error.code : 'CREATOR_AGENT_FAILED',
      message: known ? error.message : '创作 Agent 暂时无法完成此操作，请稍后重试',
      ...(known && error.details && Object.keys(error.details).length ? { details: error.details } : {}),
    });
  });

  return router;
}

const router = createCreatorAgentRouter();
module.exports = router;
module.exports.CREATOR_AGENT_HTTP_SCHEMA = CREATOR_AGENT_HTTP_SCHEMA;
module.exports.CREATOR_AGENT_REQUEST_LIMIT = CREATOR_AGENT_REQUEST_LIMIT;
module.exports.createCreatorAgentRouter = createCreatorAgentRouter;
module.exports.createDeliveryIntentPlan = createDeliveryIntentPlan;
module.exports.createDeliveryReadyPlan = createDeliveryReadyPlan;
module.exports.creatorDeliveryPackageName = creatorDeliveryPackageName;
module.exports.createAssetPlaceReadyPlan = createAssetPlaceReadyPlan;
