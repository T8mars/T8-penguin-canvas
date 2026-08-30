const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  CREATOR_AGENT_READINESS_SCHEMA,
  CREATOR_AGENT_LOCAL_PLAN_TARGET_MS,
} = require('./creatorAgentReadiness');
const {
  readCreativeCapabilityGraph,
  readCreativeCapabilityManifest,
} = require('./agentControlCapabilities');
const {
  compileCreatorArtifactVersion,
  creatorArtifactSummaries,
  latestCreatorArtifactVersions,
  normalizeCreatorArtifactVersion,
  normalizeCreatorArtifactVersions,
} = require('./creatorAgentArtifacts');
const {
  compileCreatorWorkProposal,
  creatorWorkMutationScope,
  createCreatorLlmTurnReceipt,
  latestWorkArtifactVersions,
  normalizeCreatorLlmTurnReceipt,
  normalizeCreatorWorkSnapshot,
  normalizeWorkArtifactVersions,
  reviseWorkArtifact,
  workArtifactSummaries,
} = require('./creatorAgentWorkArtifacts');
const {
  normalizeCreatorAudioObservation,
} = require('./creatorAgentMediaGrounding');
const {
  CreatorAgentToolProposalError,
  assertCreatorToolProposalCurrent,
  validateStoredCreatorToolProposal,
} = require('./creatorAgentToolProposals');
const {
  advanceCreatorDecisionDocument,
  createCreatorDecisionDocument,
  creatorDecisionSuggestionChoices,
  currentCreatorDecision,
  normalizeCreatorDecisionDocument,
  normalizeCreatorDecisionDocumentVersions,
} = require('./creatorAgentDecisions');

const CREATOR_AGENT_SESSION_SCHEMA = 't8-creator-agent-session-v1';
const CREATOR_AGENT_EVENT_SCHEMA = 't8-creator-agent-event-v1';
const CREATOR_AGENT_MAX_EVENTS = 1_000;
const CREATOR_AGENT_EVENT_TAIL_BYTES = 4 * 1024 * 1024;
const CREATOR_AGENT_MAX_ATTACHMENTS = 16;
const CREATOR_AGENT_MAX_PATCH_BYTES = 2 * 1024 * 1024;
const CREATOR_AGENT_REPLAY_RESPONSE_CHUNKS = 8;
const CREATOR_AGENT_MAX_RESPONSE_CHUNKS = 256;
const CREATOR_REFERENCE_PRODUCTION_MAX_SHOTS = 240;

const CREATOR_PRODUCTION_STATE_SCHEMA = 't8-creator-production-state-v1';
const CREATOR_PRODUCTION_PHASES = ['idea', 'script', 'assets', 'shots', 'candidates', 'delivery'];
const CREATOR_PRODUCTION_MAX_HISTORY = 80;
const CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_SCHEMA = 't8-creator-production-document-confirmation-v1';
const CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_LIMIT = 200;

class CreatorAgentSessionError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'CreatorAgentSessionError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

function boundedText(value, maximum = 8_000) {
  return String(value == null ? '' : value).trim().slice(0, maximum);
}

function boundedResponseText(value, maximum = 80_000) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .slice(0, maximum);
}

function creatorStableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(creatorStableString).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${creatorStableString(value[key])}`
  )).join(',')}}`;
}

function creatorDigest(value) {
  return crypto.createHash('sha256').update(creatorStableString(value)).digest('hex');
}

function creatorDecisionSummary(value) {
  const document = normalizeCreatorDecisionDocument(value);
  if (!document) return null;
  return {
    schema: 't8-creator-decision-summary-v1',
    documentId: document.documentId,
    versionId: document.versionId,
    contentDigest: document.contentDigest,
    family: document.family,
    phase: document.phase,
    revision: document.revision,
    status: document.status,
    currentDecisionId: document.currentDecisionId,
  };
}

function storeCreatorDecisionDocument(session, value) {
  const document = normalizeCreatorDecisionDocument(value);
  if (!document || document.sessionId !== session.id) {
    throw new CreatorAgentSessionError(
      'CREATOR_DECISION_DOCUMENT_INVALID',
      '当前创作决策版本无法验证，已停止推进以保护创作记录',
      409,
    );
  }
  session.decisionDocument = document;
  session.decisionDocumentVersions = normalizeCreatorDecisionDocumentVersions([
    ...(Array.isArray(session.decisionDocumentVersions)
      ? session.decisionDocumentVersions
      : []),
    document,
  ]);
  return document;
}

function acceptCreatorWorkAsCurrentDecisionDefaults(session, artifactVersion) {
  let document = normalizeCreatorDecisionDocument(session.decisionDocument);
  const phase = normalizeCreativePhase(session.production?.currentPhase, 'idea');
  if (!document || document.phase !== phase || document.status !== 'collecting') return document;
  let current = currentCreatorDecision(document);
  while (current?.kind === 'choice') {
    const acceptedLabel = boundedText(artifactVersion?.title, 120) || '当前结构化作品';
    document = advanceCreatorDecisionDocument(document, {
      customValue: `创作者已接受“${acceptedLabel}”当前版本；沿用该作品中已经明确呈现的${current.topic}，不增加任何新事实。`,
    }).document;
    current = currentCreatorDecision(document);
  }
  return storeCreatorDecisionDocument(session, document);
}
function normalizeProductionDocumentConfirmations(value) {
  return (Array.isArray(value) ? value : []).slice(-CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_LIMIT)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const contentDigest = boundedText(item.contentDigest, 64).toLowerCase();
      const confirmationDigest = boundedText(item.confirmationDigest, 64).toLowerCase();
      const confirmationId = boundedText(item.confirmationId, 80);
      const documentId = boundedText(item.documentId, 160);
      const versionId = boundedText(item.versionId, 160);
      const kind = boundedText(item.kind, 80);
      const revision = Math.max(1, Math.trunc(Number(item.revision) || 0));
      if (item.schema !== CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_SCHEMA
        || !confirmationId || !documentId || !versionId || !kind
        || !/^[a-f0-9]{64}$/.test(contentDigest)
        || !/^[a-f0-9]{64}$/.test(confirmationDigest)) return null;
      const normalized = {
        schema: CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_SCHEMA,
        confirmationId,
        documentId,
        kind,
        revision,
        versionId,
        contentDigest,
        sourcePlanId: boundedText(item.sourcePlanId, 160),
        sourcePlanDigest: boundedText(item.sourcePlanDigest, 64).toLowerCase(),
        actor: boundedText(item.actor, 40) || 'canvas-ui',
        confirmedAt: boundedText(item.confirmedAt, 80),
      };
      if (creatorDigest(normalized) !== confirmationDigest) return null;
      return { ...normalized, confirmationDigest };
    })
    .filter(Boolean);
}

function productionDocumentConfirmationFor(session, document) {
  return (session.productionDocumentConfirmations || []).find((item) => (
    item.documentId === String(document?.id || '')
    && item.versionId === String(document?.versionId || '')
    && item.contentDigest === String(document?.contentDigest || '')
  )) || null;
}


function creatorRunEventText(value, maximum = 500) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value.message || value.error || value.reason || value.code || ''
    : value;
  return boundedText(source, maximum)
    .replace(/https?:\/\/\S+/gi, '[远程地址已隐藏]')
    .replace(/\b(?:bearer|token|api[_-]?key|sk-)[=: _-]*[A-Za-z0-9._-]{8,}\b/gi, '[凭据已隐藏]');
}

function normalizeCreatorRunEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sourceEventId = Number(value.id);
  const runId = boundedText(value.runId, 160);
  const eventType = boundedText(value.type, 80);
  if (!Number.isSafeInteger(sourceEventId) || sourceEventId < 1 || !runId || !eventType) return null;
  const raw = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload
    : {};
  const videoOperation = raw.videoOperation && typeof raw.videoOperation === 'object'
    && !Array.isArray(raw.videoOperation) ? raw.videoOperation : {};
  const progressValue = raw.progress ?? raw.percent ?? videoOperation.progress;
  const progress = Number.isFinite(Number(progressValue))
    ? Math.max(0, Math.min(100, Math.round(Number(progressValue))))
    : null;
  const phase = boundedText(raw.phase || videoOperation.phase, 80);
  const status = boundedText(raw.status || videoOperation.status, 40);
  const message = creatorRunEventText(raw.message || videoOperation.message, 500);
  const error = creatorRunEventText(raw.error || videoOperation.error, 500);
  const terminalSignal = /(?:completed|succeeded|failed|stopped|interrupted|terminal|error)/i
    .test(`${eventType} ${phase} ${status}`);
  const visible = /^(?:run|node)\./.test(eventType)
    || progress != null
    || terminalSignal;
  return {
    visible,
    progressBucket: progress == null ? null : Math.floor(progress / 10) * 10,
    payload: {
      schema: 't8-creator-run-event-v1',
      sourceEventId,
      sourceEntityUid: boundedText(value.entityUid, 160) || null,
      runId,
      nodeRunId: boundedText(value.nodeRunId, 160) || null,
      eventType,
      phase: phase || null,
      status: status || null,
      progress,
      message: message || null,
      error: error || null,
      code: boundedText(raw.code || videoOperation.errorCode, 80) || null,
      attemptId: boundedText(raw.attemptId || videoOperation.attemptId, 160) || null,
      nodeId: boundedText(raw.nodeId, 160) || null,
      outputCount: Array.isArray(raw.outputRefs)
        ? Math.min(10_000, raw.outputRefs.length)
        : Math.max(0, Math.min(10_000, Number(raw.outputCount) || 0)),
      recoverable: raw.recoverable === true,
      sourceCreatedAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : null,
    },
  };
}

function creatorAttachmentKind(value) {
  const normalized = boundedText(value, 24).toLowerCase();
  return ['image', 'video', 'audio', 'text', 'file'].includes(normalized) ? normalized : 'file';
}

function creatorAttachmentKindForEntry(entry = {}) {
  const explicit = creatorAttachmentKind(entry.kind);
  if (explicit !== 'file') return explicit;
  const mimeType = boundedText(entry.mimeType, 120).toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/')) return 'text';
  const name = boundedText(entry.name, 240).toLowerCase();
  if (/\.(?:png|jpe?g|webp|gif|bmp|avif|heic)$/u.test(name)) return 'image';
  if (/\.(?:mp4|mov|webm|mkv|avi|m4v)$/u.test(name)) return 'video';
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)$/u.test(name)) return 'audio';
  if (/\.(?:txt|md|markdown|csv|json)$/u.test(name)) return 'text';
  return 'file';
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CREATOR_AGENT_MAX_ATTACHMENTS).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CreatorAgentSessionError('CREATOR_ATTACHMENT_INVALID', `第 ${index + 1} 个附件无效`);
    }
    const ref = boundedText(entry.ref || entry.url, 2_000);
    if (!ref || /^data:/i.test(ref)) {
      throw new CreatorAgentSessionError(
        'CREATOR_ATTACHMENT_REF_REQUIRED',
        '附件必须先持久化为文件引用，不能把 base64 正文写入会话',
      );
    }
    const assetId = boundedText(entry.assetId, 160);
    const normalized = {
      id: boundedText(entry.id, 120) || crypto.randomUUID(),
      ...(assetId ? { assetId } : {}),
      kind: creatorAttachmentKindForEntry(entry),
      name: boundedText(entry.name, 240) || `附件 ${index + 1}`,
      ref,
      mimeType: boundedText(entry.mimeType, 120),
      size: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(entry.size) || 0)),
      ...(boundedText(entry.contentHash, 128)
        ? { contentHash: boundedText(entry.contentHash, 128).toLowerCase().replace(/^sha256:/, '') }
        : {}),
      ...(Number(entry.contentRevision) > 0
        ? { contentRevision: Math.max(1, Math.trunc(Number(entry.contentRevision))) }
        : {}),
      ...(Number(entry.width) > 0 ? { width: Math.max(1, Math.trunc(Number(entry.width))) } : {}),
      ...(Number(entry.height) > 0 ? { height: Math.max(1, Math.trunc(Number(entry.height))) } : {}),
      ...(Number(entry.duration) > 0
        ? { duration: Math.max(0, Math.min(86_400, Number(entry.duration))) }
        : {}),
    };
    if (normalized.kind === 'audio' && entry.audioObservation) {
      const audioObservation = normalizeCreatorAudioObservation(entry.audioObservation, normalized);
      if (!audioObservation) {
        throw new CreatorAgentSessionError(
          'CREATOR_AUDIO_OBSERVATION_INVALID',
          '音频观察与当前素材版本不一致，已停止继续创作',
        );
      }
      normalized.audioObservation = audioObservation;
      normalized.observationDigest = audioObservation.observationDigest;
    }
    return normalized;
  });
}

function creatorAttachmentSummary(attachments = []) {
  const counts = {
    image: 0,
    video: 0,
    audio: 0,
    text: 0,
    file: 0,
  };
  (Array.isArray(attachments) ? attachments : []).forEach((attachment) => {
    counts[creatorAttachmentKind(attachment?.kind)] += 1;
  });
  const labels = [
    counts.image ? `${counts.image} 张图片` : '',
    counts.video ? `${counts.video} 个视频` : '',
    counts.audio ? `${counts.audio} 段音频` : '',
    counts.text ? `${counts.text} 份文本` : '',
    counts.file ? `${counts.file} 个文件` : '',
  ].filter(Boolean);
  return labels.join('、');
}

function creatorAttachmentOnlyPrompt(attachments = []) {
  const summary = creatorAttachmentSummary(attachments);
  return summary
    ? `请分析我上传的${summary}，先说明可直接使用的内容和缺失信息，再给出 3 个可执行的创作下一步；不要自动生成或修改画布。`
    : '';
}

function normalizeStoredPatch(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 't8-canvas-patch-v1'
    || !Array.isArray(value.operations)) {
    throw new CreatorAgentSessionError('CREATOR_PATCH_INVALID', '创作会话中的画布变更无效');
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new CreatorAgentSessionError('CREATOR_PATCH_INVALID', '创作会话中的画布变更无法保存');
  }
  if (Buffer.byteLength(serialized, 'utf8') > CREATOR_AGENT_MAX_PATCH_BYTES) {
    throw new CreatorAgentSessionError('CREATOR_PATCH_TOO_LARGE', '创作计划超过会话安全上限，请缩小本次变更范围', 413);
  }
  return JSON.parse(serialized);
}

function normalizeContext(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawNodeTypeCounts = input.nodeTypeCounts
    && typeof input.nodeTypeCounts === 'object'
    && !Array.isArray(input.nodeTypeCounts)
    ? input.nodeTypeCounts
    : {};
  const viewport = input.viewport
    && typeof input.viewport === 'object'
    && [input.viewport.x, input.viewport.y, input.viewport.zoom].every((item) => Number.isFinite(Number(item)))
    ? {
        x: Math.round(Number(input.viewport.x) * 100) / 100,
        y: Math.round(Number(input.viewport.y) * 100) / 100,
        zoom: Math.max(0.01, Math.min(8, Math.round(Number(input.viewport.zoom) * 1_000) / 1_000)),
      }
    : null;
  return {
    nodeCount: Math.max(0, Math.min(100_000, Number(input.nodeCount) || 0)),
    edgeCount: Math.max(0, Math.min(200_000, Number(input.edgeCount) || 0)),
    nodeTypeCounts: Object.fromEntries(Object.entries(rawNodeTypeCounts)
      .map(([type, count]) => [boundedText(type, 80), Math.max(0, Math.min(100_000, Number(count) || 0))])
      .filter(([type, count]) => type && count > 0)
      .slice(0, 64)),
    selectedNodeIds: Array.isArray(input.selectedNodeIds)
      ? [...new Set(input.selectedNodeIds.map((id) => boundedText(id, 160)).filter(Boolean))].slice(0, 32)
      : [],
    selectedNodeTypes: Array.isArray(input.selectedNodeTypes)
      ? [...new Set(input.selectedNodeTypes.map((type) => boundedText(type, 80)).filter(Boolean))].slice(0, 32)
      : [],
    referencedNodeIds: Array.isArray(input.referencedNodeIds)
      ? [...new Set(input.referencedNodeIds.map((id) => boundedText(id, 160)).filter(Boolean))].slice(0, 8)
      : [],
    referencedNodeTypes: Array.isArray(input.referencedNodeTypes)
      ? [...new Set(input.referencedNodeTypes.map((type) => boundedText(type, 80)).filter(Boolean))].slice(0, 8)
      : [],
    canvasTitle: boundedText(input.canvasTitle, 160),
    canvasRevision: input.canvasRevision != null
      && Number.isSafeInteger(Number(input.canvasRevision))
      && Number(input.canvasRevision) >= 0
      ? Number(input.canvasRevision)
      : null,
    phase: boundedText(input.phase, 80),
    viewport,
    failedRunCount: Math.max(0, Math.min(100, Number(input.failedRunCount) || 0)),
    outputAssetCount: Math.max(0, Math.min(10_000, Number(input.outputAssetCount) || 0)),
    canvasObjects: (Array.isArray(input.canvasObjects) ? input.canvasObjects : [])
      .slice(0, 24)
      .map((item) => ({
        nodeId: boundedText(item?.nodeId, 160),
        nodeType: boundedText(item?.nodeType, 80) || 'unknown',
        label: boundedText(item?.label, 120) || boundedText(item?.nodeType, 80) || '画布对象',
        status: ['idle', 'running', 'completed', 'failed'].includes(boundedText(item?.status, 32))
          ? boundedText(item?.status, 32)
          : 'idle',
        selected: item?.selected === true,
        inViewport: item?.inViewport !== false,
        mediaKinds: [...new Set((Array.isArray(item?.mediaKinds) ? item.mediaKinds : [])
          .map((kind) => boundedText(kind, 24))
          .filter((kind) => ['image', 'video', 'audio', 'text', 'model3d'].includes(kind)))]
          .slice(0, 5),
        resultCount: Math.max(0, Math.min(10_000, Number(item?.resultCount) || 0)),
        accepted: item?.accepted === true,
        lockKeys: [...new Set((Array.isArray(item?.lockKeys) ? item.lockKeys : [])
          .map((key) => boundedText(key, 48))
          .filter(Boolean))]
          .slice(0, 8),
        upstreamCount: Math.max(0, Math.min(10_000, Number(item?.upstreamCount) || 0)),
        downstreamCount: Math.max(0, Math.min(10_000, Number(item?.downstreamCount) || 0)),
      }))
      .filter((item) => item.nodeId),
    offscreenSummary: input.offscreenSummary
      && typeof input.offscreenSummary === 'object'
      && !Array.isArray(input.offscreenSummary)
      ? {
          nodeCount: Math.max(0, Math.min(100_000, Number(input.offscreenSummary.nodeCount) || 0)),
          failedCount: Math.max(0, Math.min(100_000, Number(input.offscreenSummary.failedCount) || 0)),
          outputCount: Math.max(0, Math.min(100_000, Number(input.offscreenSummary.outputCount) || 0)),
          lockedCount: Math.max(0, Math.min(100_000, Number(input.offscreenSummary.lockedCount) || 0)),
        }
      : {
          nodeCount: 0,
          failedCount: 0,
          outputCount: 0,
          lockedCount: 0,
        },
    recentActions: (Array.isArray(input.recentActions) ? input.recentActions : [])
      .slice(0, 8)
      .map((item) => ({
        eventType: boundedText(item?.eventType, 80),
        label: boundedText(item?.label, 120),
        createdAt: boundedText(item?.createdAt, 80),
      }))
      .filter((item) => item.eventType && item.label),
    assetLineage: (Array.isArray(input.assetLineage) ? input.assetLineage : [])
      .slice(0, 6)
      .map((item) => ({
        assetId: boundedText(item?.assetId, 160),
        kind: ['image', 'video', 'audio', 'text', 'model3d', 'other'].includes(boundedText(item?.kind, 24))
          ? boundedText(item?.kind, 24)
          : 'other',
        label: boundedText(item?.label, 120) || '持久素材',
        eventCount: Math.max(0, Math.min(10_000, Number(item?.eventCount) || 0)),
        relations: [...new Set((Array.isArray(item?.relations) ? item.relations : [])
          .map((value) => boundedText(value, 64))
          .filter(Boolean))]
          .slice(0, 8),
        parentAssetIds: [...new Set((Array.isArray(item?.parentAssetIds) ? item.parentAssetIds : [])
          .map((value) => boundedText(value, 160))
          .filter(Boolean))]
          .slice(0, 8),
        sourceNodeIds: [...new Set((Array.isArray(item?.sourceNodeIds) ? item.sourceNodeIds : [])
          .map((value) => boundedText(value, 160))
          .filter(Boolean))]
          .slice(0, 8),
        runIds: [...new Set((Array.isArray(item?.runIds) ? item.runIds : [])
          .map((value) => boundedText(value, 160))
          .filter(Boolean))]
          .slice(0, 8),
        nodeRunIds: [...new Set((Array.isArray(item?.nodeRunIds) ? item.nodeRunIds : [])
          .map((value) => boundedText(value, 160))
          .filter(Boolean))]
          .slice(0, 8),
        derivedOperations: [...new Set((Array.isArray(item?.derivedOperations) ? item.derivedOperations : [])
          .map((value) => boundedText(value, 80))
          .filter(Boolean))]
          .slice(0, 8),
        truncated: item?.truncated === true,
      }))
      .filter((item) => item.assetId),
    recentRuns: (Array.isArray(input.recentRuns) ? input.recentRuns : [])
      .slice(0, 8)
      .map((run) => ({
        runId: boundedText(run?.runId, 160),
        status: boundedText(run?.status, 40),
        nodeRunCount: Math.max(0, Math.min(10_000, Number(run?.nodeRunCount) || 0)),
        failedNodeCount: Math.max(0, Math.min(10_000, Number(run?.failedNodeCount) || 0)),
        outputAssetCount: Math.max(0, Math.min(10_000, Number(run?.outputAssetCount) || 0)),
      }))
      .filter((run) => run.runId && run.status),
  };
}

function creatorContextFocus(normalized) {
  const referencedObject = normalized.referencedNodeIds
    .map((nodeId) => normalized.canvasObjects.find((item) => item.nodeId === nodeId))
    .find(Boolean);
  const referencedFallback = normalized.referencedNodeIds[0]
    ? {
        label: normalized.referencedNodeTypes[0] || normalized.referencedNodeIds[0],
        nodeId: normalized.referencedNodeIds[0],
        nodeType: normalized.referencedNodeTypes[0] || 'unknown',
        accepted: false,
        lockKeys: [],
      }
    : null;
  if (referencedObject || referencedFallback) {
    return {
      source: 'reference',
      object: referencedObject || referencedFallback,
    };
  }
  const selectedObject = normalized.canvasObjects.find((item) => item.selected);
  if (selectedObject) {
    return {
      source: 'selection',
      object: selectedObject,
    };
  }
  const viewportObject = normalized.canvasObjects.find((item) => item.inViewport);
  if (viewportObject) {
    return {
      source: 'viewport',
      object: viewportObject,
    };
  }
  return null;
}

function creatorChoice(label, description, creatorPrompt, creatorKind = '') {
  return {
    label: boundedText(label, 120),
    description: boundedText(description, 280),
    creatorPrompt: boundedText(creatorPrompt, 2_000),
    creatorKind: boundedText(creatorKind, 40),
  };
}

function creatorPlanKind(plan, fallback = 'story') {
  const value = boundedText(plan?.kind, 40).toLowerCase();
  return [
    'story',
    'script',
    'image',
    'edit-image',
    'video',
    'edit-video',
    'audio',
    'asset',
    'delivery',
  ].includes(value) ? value : fallback;
}

function creatorPlanGoal(plan) {
  return boundedText(plan?.brief?.goal || plan?.brief?.summary, 200_000);
}

function creatorPlanRequestsRecovery(plan) {
  const goal = creatorPlanGoal(plan).replace(/\s+/g, ' ').trim();
  if (!goal) return false;
  return /(?:哪里|为什么|原因|排查|诊断|解释).{0,24}(?:失败|报错|错误|异常|中断)|(?:失败|报错|错误|异常|中断).{0,24}(?:哪里|为什么|原因|排查|诊断|解释)|(?:只|重新|再次)?重试|恢复(?:任务|生成|运行)|继续(?:已完成|现有成果)|跳过失败|失败范围|失败项|异常对象/iu.test(goal);
}

function creatorGoalExcerpt(plan, maximum = 64) {
  const value = creatorPlanGoal(plan)
    .replace(/\s+/g, ' ')
    .replace(/^(?:请|帮我|我想|我要|请帮我)\s*/u, '')
    .trim();
  if (!value) return '';
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function creatorFocusKind(focus, plan = null) {
  const object = focus?.object || {};
  const nodeType = boundedText(object.nodeType, 80).toLowerCase();
  const label = boundedText(object.label, 120).toLowerCase();
  const mediaKinds = Array.isArray(object.mediaKinds)
    ? object.mediaKinds.map((value) => boundedText(value, 40).toLowerCase())
    : [];
  if (/(?:loop|循环|batch|批量)/i.test(`${nodeType} ${label}`)) return 'loop';
  if (mediaKinds.includes('image') || /(?:image|图片|图像|照片|海报)/i.test(`${nodeType} ${label}`)) {
    return 'image';
  }
  if (mediaKinds.includes('video') || /(?:video|视频|影片|镜头)/i.test(`${nodeType} ${label}`)) {
    return 'video';
  }
  if (mediaKinds.includes('audio') || /(?:audio|音频|音乐|声音|旁白)/i.test(`${nodeType} ${label}`)) {
    return 'audio';
  }
  return creatorPlanKind(plan, 'canvas');
}

function creatorContextFocusForPlan(normalized, plan = null) {
  const focus = creatorContextFocus(normalized);
  if (!focus || !plan) return focus;

  // A node merely being visible is ambient canvas context, not the user's request.
  // It must never redirect a fresh creative turn into an unrelated node workflow.
  if (focus.source === 'viewport') return null;

  const focusKind = creatorFocusKind(focus, plan);
  const planKind = creatorPlanKind(plan, '');
  const goal = creatorPlanGoal(plan);
  if (focusKind === 'loop') {
    return /(?:loop|循环|批量|并发|逐条|每条|配对|同一素材|试\s*\d+\s*条)/iu.test(goal)
      ? focus
      : null;
  }
  if (focusKind === 'image') {
    return (focus.source === 'reference' || focus.source === 'selection')
      && (planKind === 'image' || planKind === 'edit-image')
      ? focus
      : null;
  }
  if (focusKind === 'video') {
    return (focus.source === 'reference' || focus.source === 'selection')
      && (planKind === 'video' || planKind === 'edit-video')
      ? focus
      : null;
  }
  if (focusKind === 'audio') {
    return (focus.source === 'reference' || focus.source === 'selection')
      && planKind === 'audio'
      ? focus
      : null;
  }
  return null;
}

function creatorStoryChoices(plan) {
  const goal = creatorPlanGoal(plan);
  const lower = goal.toLowerCase();
  const kind = creatorPlanKind(plan, 'story');
  if (/故事收束确定为|无法挽回的代价|带着裂痕继续|真正的背叛者/u.test(goal)) {
    return [
      creatorChoice(
        '整理成完整短片提纲',
        '把已确认的关系、爆点、升级和结局串成开端—转折—收束，仍可逐段修改。',
        '制作下一步确定为：整理完整短片提纲。请保留已经确认的关系、爆点、升级和结局，输出可编辑的开端、转折与收束，不立即生成素材。',
        kind,
      ),
      creatorChoice(
        '先细化两位角色',
        '补齐双方的欲望、秘密、外形锚点和关系变化，再进入镜头。',
        '制作下一步确定为：细化两位核心角色。请保留已经确认的故事方向，分别补齐欲望、秘密、外形锚点和关系变化，不立即生成素材。',
        kind,
      ),
      creatorChoice(
        '直接拆成可编辑分镜',
        '按故事节点拆镜头、动作、景别和声音，生成前仍可逐镜头修改。',
        '制作下一步确定为：拆成可编辑分镜。请保留已经确认的故事方向，先形成镜头、动作、景别、声音和时长草案，不立即调用模型。',
        kind,
      ),
    ];
  }
  if (/故事推进方式确定为|当众决裂|私下交易|被迫再次合作/u.test(goal)) {
    return [
      creatorChoice(
        '付出无法挽回的代价',
        '目标达成，但两人的关系、身份或重要之物永久失去。',
        '故事收束确定为：付出无法挽回的代价。让人物达成部分目标，却永久失去关系、身份或重要之物，并继续推进下一项创作决定。',
        kind,
      ),
      creatorChoice(
        '带着裂痕继续同行',
        '问题没有被轻易治愈，但两人选择在不确定中继续面对。',
        '故事收束确定为：带着裂痕继续同行。不要轻易和解，让两人在保留矛盾的情况下做出继续同行的选择，并继续推进下一项创作决定。',
        kind,
      ),
      creatorChoice(
        '反转：真正的背叛者另有其人',
        '旧关系被重新解释，同时留下一个能回看前文的真相钩子。',
        '故事收束确定为：真正的背叛者另有其人。让反转能够被前文细节验证，并重新改变两位核心人物的选择。',
        kind,
      ),
    ];
  }
  if (/关系爆点确定为|共同秘密被揭开|现实目标突然对立|必须做出背叛/u.test(goal)) {
    return [
      creatorChoice(
        '当众决裂',
        '两人必须公开选择立场，关系与外部目标同时失控。',
        '故事推进方式确定为：当众决裂。让两位核心人物在所有人面前被迫选择立场，并继续推进下一项最关键的创作决定。',
        kind,
      ),
      creatorChoice(
        '私下交易',
        '一方用共同秘密换取生路，信任从内部开始崩塌。',
        '故事推进方式确定为：私下交易。一方用共同秘密换取生路，另一方随后发现代价，并继续推进下一项最关键的创作决定。',
        kind,
      ),
      creatorChoice(
        '被迫再次合作',
        '更大的威胁出现，他们只能带着裂痕暂时并肩。',
        '故事推进方式确定为：被迫再次合作。更大的威胁让双方带着裂痕暂时并肩，并继续推进下一项最关键的创作决定。',
        kind,
      ),
    ];
  }
  if (
    !/故事核心关系确定为|爱着，却|最亲的人|必须并肩/u.test(goal)
    && /从人物关系开始|人物关系作为起点|角色或关系|两个人的关系|人物之间的关系|确定.{0,8}关系/u.test(goal)
  ) {
    return [
      creatorChoice(
        '亲密关系：爱着，却无法站在同一边',
        '恋人、伴侣或暧昧对象被现实、秘密或立场推开，情感张力最直接。',
        '从人物关系开始。故事核心关系确定为：亲密关系——爱着，却无法站在同一边。请围绕这段关系继续推进，只提出下一项最关键的创作决定。',
        kind,
      ),
      creatorChoice(
        '家庭关系：最亲的人，最不了解彼此',
        '父母子女、手足或师徒积压着长期误解，适合把私人情绪拍得扎实。',
        '从人物关系开始。故事核心关系确定为：家庭关系——最亲的人，却最不了解彼此。请围绕这段关系继续推进，只提出下一项最关键的创作决定。',
        kind,
      ),
      creatorChoice(
        '搭档 / 对手：必须并肩，却不能信任',
        '共同目标和隐藏动机同时存在，适合动作、悬疑、职场或科幻故事。',
        '从人物关系开始。故事核心关系确定为：搭档或对手——必须并肩，却不能信任。请围绕这段关系继续推进，只提出下一项最关键的创作决定。',
        kind,
      ),
    ];
  }
  if (/故事核心关系确定为|爱着，却|最亲的人|必须并肩/u.test(goal)) {
    return [
      creatorChoice(
        '共同秘密被揭开',
        '过去的真相突然公开，双方必须先处理彼此的隐瞒。',
        '关系爆点确定为：共同秘密被揭开。请让这个秘密直接改变双方立场，并继续推进下一项最关键的创作决定。',
        kind,
      ),
      creatorChoice(
        '现实目标突然对立',
        '两人仍在乎彼此，但这一刻只能有一方达成目标。',
        '关系爆点确定为：现实目标突然对立。请让双方目标在同一时刻发生不可兼得的冲突，并继续推进下一项最关键的创作决定。',
        kind,
      ),
      creatorChoice(
        '一方必须做出背叛',
        '背叛是为了保护、求生或兑现承诺，选择越合理越痛。',
        '关系爆点确定为：一方必须做出背叛。让背叛具有能理解的理由和无法撤销的后果，并继续推进下一项最关键的创作决定。',
        kind,
      ),
    ];
  }
  if (/从一个画面开始|画面或氛围|画面氛围/u.test(goal)) {
    return [
      creatorChoice(
        '雨夜追逐 · 霓虹倒影',
        '湿地反光、远处警笛和逼近的脚步，把危险藏进空间。',
        '从画面开始。核心画面确定为：雨夜追逐，霓虹倒映在积水里，远处警笛与逼近脚步制造危险。请继续推进这个画面背后的故事。',
        kind,
      ),
      creatorChoice(
        '正午静室 · 不该出现的物品',
        '明亮、安静、几乎没有阴影，却有一件东西彻底破坏秩序。',
        '从画面开始。核心画面确定为：正午的安静房间里，出现一件绝不该在这里的物品。请继续推进这个画面背后的故事。',
        kind,
      ),
      creatorChoice(
        '喧闹庆典 · 主角逆向而行',
        '所有人都在庆祝，只有主角穿过人群朝相反方向走。',
        '从画面开始。核心画面确定为：喧闹庆典中，主角独自逆着人群前进。请继续推进这个画面背后的故事。',
        kind,
      ),
    ];
  }
  if (/从故事设定开始|世界设定|故事设定/u.test(goal)) {
    return [
      creatorChoice(
        '记忆可以交易',
        '每卖掉一段记忆，就会在现实关系里留下无法解释的空白。',
        '从故事设定开始。世界规则确定为：记忆可以买卖，但每次交易都会在现实关系中留下无法弥补的空白。请继续推进主角与核心冲突。',
        kind,
      ),
      creatorChoice(
        '城市每天重置',
        '所有人每天醒来都回到原点，只有主角保留昨天的记忆。',
        '从故事设定开始。世界规则确定为：城市每天重置，只有主角记得前一天。请继续推进主角与核心冲突。',
        kind,
      ),
      creatorChoice(
        '谎言会留下痕迹',
        '说谎会在皮肤上留下可见印记，秘密因此变成公共风险。',
        '从故事设定开始。世界规则确定为：每个谎言都会在皮肤上留下可见痕迹。请继续推进主角与核心冲突。',
        kind,
      ),
    ];
  }
  const genericIdea = !goal
    || goal.length < 36
    || /(?:一个)?创意(?:想法)?|还没想好|不知道做什么/u.test(lower);
  if (genericIdea) {
    return [
      creatorChoice(
        '我有一个故事设定',
        '从世界规则、异常事件或“如果……会怎样”开始。',
        '我想从故事设定开始。请先帮我确定一个有冲突潜力的世界规则，再一轮只推进一个创作决定。',
        kind,
      ),
      creatorChoice(
        '我脑中有一个画面',
        '从强烈的视觉、场景或情绪倒推出人物和故事。',
        '我想从一个画面或氛围开始。请先给我三个具体且差异明显的画面方向，再一轮只推进一个创作决定。',
        kind,
      ),
      creatorChoice(
        '我有角色或关系',
        '从人物欲望、秘密和关系张力出发，让角色推动剧情。',
        '我想从人物关系开始。请先给我三种具体且差异明显的核心关系，再一轮只推进一个创作决定。',
        kind,
      ),
    ];
  }
  return [
    creatorChoice(
      '关系驱动：同一目标，不同立场',
      '先让人物关系产生拉扯，故事会更有人味和连续张力。',
      `围绕当前创意“${creatorGoalExcerpt(plan)}”，采用关系驱动：核心人物追求同一目标，但立场与代价不同。请继续推进下一项最关键的创作决定。`,
      kind,
    ),
    creatorChoice(
      '秘密驱动：真相越近，代价越大',
      '用秘密和揭露节奏制造悬念，每一步都让选择更困难。',
      `围绕当前创意“${creatorGoalExcerpt(plan)}”，采用秘密驱动：真相越接近，人物付出的代价越大。请继续推进下一项最关键的创作决定。`,
      kind,
    ),
    creatorChoice(
      '事件驱动：一次选择引发连锁失控',
      '用清晰事件推动节奏，适合短片、广告和强情节视频。',
      `围绕当前创意“${creatorGoalExcerpt(plan)}”，采用事件驱动：主角的一次选择引发连续升级的后果。请继续推进下一项最关键的创作决定。`,
      kind,
    ),
  ];
}

function creatorImageNextChoices(plan, suffix = '') {
  const goal = creatorPlanGoal(plan);
  const kind = creatorPlanKind(plan, 'image');
  if (/叙事构图方向|重整构图与视觉重点/u.test(goal)) {
    return [
      creatorChoice(
        '情绪近景：人物状态最重要',
        '收紧画面，把表情、姿态或产品核心细节放到第一视觉层级。',
        `构图选择为：情绪近景。收紧画面，让人物状态或产品核心细节成为第一视觉层级，同时保留必要环境信息。${suffix}`,
        kind,
      ),
      creatorChoice(
        '环境叙事：让场景一起讲故事',
        '保留更多空间线索，用前后景、遮挡和环境物件补充故事。',
        `构图选择为：环境叙事。保留空间线索，用前后景、遮挡和环境物件说明人物处境或产品使用场景。${suffix}`,
        kind,
      ),
      creatorChoice(
        '设计留白：重点更干净有力',
        '减少无关元素，用留白、方向线和色块把视线引到关键内容。',
        `构图选择为：设计留白。减少无关元素，用留白、方向线和色块把视线引向关键内容。${suffix}`,
        kind,
      ),
    ];
  }
  if (/人景自然融合方向|统一人景透视|让人景和光影自然融合/u.test(goal)) {
    return [
      creatorChoice(
        '自然光：像真实拍摄',
        '光比克制、阴影柔和，优先消除人物与背景的拼贴感。',
        `融合光影选择为：自然光。统一人物与环境的曝光、色温、接触阴影和反射，效果像真实拍摄。${suffix}`,
        kind,
      ),
      creatorChoice(
        '电影光：层次与氛围更强',
        '用明确主光、轮廓光和环境色塑造空间，但保持主体可信。',
        `融合光影选择为：电影光。用明确主光、轮廓光和环境色建立空间层次，同时保持主体可信。${suffix}`,
        kind,
      ),
      creatorChoice(
        '商业光：干净、明亮、可控',
        '主体清楚，材质准确，背景光线服务于产品或人物识别。',
        `融合光影选择为：商业光。主体干净明亮、材质准确，背景光线只服务于人物或产品识别。${suffix}`,
        kind,
      ),
    ];
  }
  if (/质感精修方向|只精修皮肤|精修皮肤、材质/u.test(goal)) {
    return [
      creatorChoice(
        '自然肤质：保留毛孔与真实起伏',
        '清理脏点和异常纹理，但不磨皮、不塑料化。',
        `质感优先为：自然肤质。清理异常纹理和脏点，保留毛孔、细小起伏与真实明暗，不做塑料磨皮。${suffix}`,
        kind,
      ),
      creatorChoice(
        '真实材质：布料、金属和皮革分明',
        '让不同材质拥有正确的粗糙度、反光和边缘细节。',
        `质感优先为：真实材质。分别校正布料、金属、皮革等材质的粗糙度、反光和边缘细节。${suffix}`,
        kind,
      ),
      creatorChoice(
        '清晰细节：锐而不脆',
        '改善焦点、边缘和微对比，避免光晕、锯齿和过度锐化。',
        `质感优先为：清晰细节。改善焦点、边缘和微对比，避免光晕、锯齿、噪点和过度锐化。${suffix}`,
        kind,
      ),
    ];
  }
  if (/构图选择为|融合光影选择为|质感优先为/u.test(goal)) {
    return [
      creatorChoice(
        '轻改：只修明显问题',
        '最大限度保留现状，适合主体和风格已经基本满意。',
        `修改强度确定为：轻改。保留当前主体、构图和风格，只修复与已选方向直接相关的明显问题。${suffix}`,
        kind,
      ),
      creatorChoice(
        '中改：整体优化但保留识别',
        '允许调整局部布局和光影，同时守住人物、产品与核心风格。',
        `修改强度确定为：中改。允许调整局部布局、光影和细节，但保留人物身份、产品结构与核心风格。${suffix}`,
        kind,
      ),
      creatorChoice(
        '重做：保留核心，重新设计画面',
        '适合方向正确但现有画面基础较差，需要明显变化。',
        `修改强度确定为：重做。保留人物身份、产品结构和核心信息，按已选方向重新设计画面。${suffix}`,
        kind,
      ),
    ];
  }
  if (/修改强度确定为/u.test(goal)) {
    return [
      creatorChoice(
        '先看 3 个可比较预览',
        '按同一目标做三个有差异的候选，再选择最好的继续。',
        `按照已经确认的方向和修改强度，先准备 3 个差异明确、可以并排比较的预览候选；保留当前结果，不自动采用。${suffix}`,
        kind,
      ),
      creatorChoice(
        '先列出具体修改清单',
        '把即将改变和保持不动的部分逐条写清，再决定是否生成。',
        `根据已经确认的方向和修改强度，先列出具体修改清单，分别说明保持不动与将要改变的内容。${suffix}`,
        kind,
      ),
      creatorChoice(
        '只做一个最稳妥版本',
        '减少试错，优先得到符合当前要求的单一候选。',
        `按照已经确认的方向和修改强度，只准备一个最稳妥的候选方案，保留当前结果作为对照。${suffix}`,
        kind,
      ),
    ];
  }
  return null;
}

function creatorVideoNextChoices(plan, suffix = '') {
  const goal = creatorPlanGoal(plan);
  const kind = creatorPlanKind(plan, 'video');
  if (/表演优先|表演、动作节点|让表演和动作更清楚/u.test(goal)) {
    return [
      creatorChoice('克制真实', '动作幅度小，依靠视线、停顿和细节传达情绪。', `表演风格确定为：克制真实。用视线、停顿和细微动作传达情绪，避免多余表演。${suffix}`, kind),
      creatorChoice('清晰戏剧化', '动作节点明确、情绪变化可见，适合短片和广告。', `表演风格确定为：清晰戏剧化。让动作节点和情绪转折明确可见，但保持自然连贯。${suffix}`, kind),
      creatorChoice('强动作节奏', '动作爆发和反应更快，适合追逐、战斗或高能片段。', `表演风格确定为：强动作节奏。强化动作爆发、反应和节奏，同时保持身体与空间连续。${suffix}`, kind),
    ];
  }
  if (/镜头优先|景别、机位|镜头运动更有层次/u.test(goal)) {
    return [
      creatorChoice('稳定跟随', '镜头保持主体可读，适合人物行动与产品展示。', `镜头语言确定为：稳定跟随。保持主体清楚，用平稳移动建立空间关系。${suffix}`, kind),
      creatorChoice('缓慢推进', '逐渐靠近主体，把注意力收束到情绪或关键细节。', `镜头语言确定为：缓慢推进。逐渐靠近主体，把注意力收束到情绪或关键细节。${suffix}`, kind),
      creatorChoice('动势切换', '用景别变化和方向性运动制造速度与冲击。', `镜头语言确定为：动势切换。用有目的的景别变化和方向性运动制造速度与冲击。${suffix}`, kind),
    ];
  }
  if (/节奏优先|停顿、加速点|节奏与情绪更有张力/u.test(goal)) {
    return [
      creatorChoice('慢热悬念', '前段留白，信息逐步释放，结尾集中爆发。', `节奏方向确定为：慢热悬念。前段保留停顿和信息差，结尾集中释放关键变化。${suffix}`, kind),
      creatorChoice('均衡叙事', '每个镜头都有清楚任务，观看顺畅、信息稳定。', `节奏方向确定为：均衡叙事。每个镜头承担一个清楚任务，信息与情绪稳定推进。${suffix}`, kind),
      creatorChoice('高能推进', '减少停顿，连续升级动作和视觉变化。', `节奏方向确定为：高能推进。减少无效停顿，让动作、镜头和情绪连续升级。${suffix}`, kind),
    ];
  }
  if (/表演风格确定为|镜头语言确定为|节奏方向确定为/u.test(goal)) {
    return [
      creatorChoice('先拆成可编辑镜头表', '逐镜头明确动作、景别、运镜、时长和声音。', `把已确认的视频方向拆成可编辑镜头表，逐镜头写清动作、景别、运镜、时长和声音。${suffix}`, kind),
      creatorChoice('先做 3 个关键帧方向', '先看角色、场景和视觉连续性，再决定如何生成视频。', `基于已确认的视频方向，先准备 3 个差异明确的关键帧方向，用于核对角色、场景和视觉连续性。${suffix}`, kind),
      creatorChoice('直接细化当前这一镜', '只把当前镜头写到可以生成，不展开整条片子。', `只细化当前这一镜，把主体动作、镜头运动、环境变化和声音写到可以直接生成的程度。${suffix}`, kind),
    ];
  }
  return null;
}

function creatorImageQuestion(plan) {
  const goal = creatorPlanGoal(plan);
  if (/叙事构图方向|重整构图与视觉重点/u.test(goal)) {
    return '构图是这轮的重点。下一步只决定画面更靠近人物情绪、环境叙事，还是干净留白？也可以直接描述你想要的构图。';
  }
  if (/人景自然融合方向|统一人景透视|让人景和光影自然融合/u.test(goal)) {
    return '人景融合是这轮的重点。下一步只决定光线更接近自然拍摄、电影氛围，还是干净商业质感？';
  }
  if (/质感精修方向|只精修皮肤|精修皮肤、材质/u.test(goal)) {
    return '质感精修是这轮的重点。下一步只决定优先处理肤质、真实材质，还是清晰细节？';
  }
  if (/构图选择为|融合光影选择为|质感优先为/u.test(goal)) {
    return '方向已经明确。现在只决定修改幅度：轻改、中改，还是保留核心后重新设计？';
  }
  if (/修改强度确定为/u.test(goal)) {
    return '方向和修改幅度都定好了。你想先看三个候选、先核对修改清单，还是只做一个最稳妥版本？';
  }
  return '';
}

function creatorVideoQuestion(plan) {
  const goal = creatorPlanGoal(plan);
  if (/表演优先|表演、动作节点|让表演和动作更清楚/u.test(goal)) {
    return '表演是这轮的重点。下一步只决定表演风格：克制真实、清晰戏剧化，还是强动作节奏？';
  }
  if (/镜头优先|景别、机位|镜头运动更有层次/u.test(goal)) {
    return '镜头语言是这轮的重点。下一步只决定主要运动方式：稳定跟随、缓慢推进，还是动势切换？';
  }
  if (/节奏优先|停顿、加速点|节奏与情绪更有张力/u.test(goal)) {
    return '节奏是这轮的重点。下一步只决定整体走向：慢热悬念、均衡叙事，还是高能推进？';
  }
  if (/表演风格确定为|镜头语言确定为|节奏方向确定为/u.test(goal)) {
    return '视频方向已经明确。接下来选一种最方便继续制作的形式：镜头表、关键帧，或只细化当前这一镜。';
  }
  return '';
}

function creatorFocusedSuggestionChoices(focus, normalized, plan = null) {
  const focusKind = creatorFocusKind(focus, plan);
  const protectedInstruction = focus.object?.accepted || focus.object?.lockKeys?.length > 0
    ? '保留已经采用和锁定的部分。'
    : '';
  const lineageInstruction = normalized.assetLineage.length > 0
    ? `沿用 ${normalized.assetLineage.length} 项已有素材来源。`
    : '';
  if (focusKind === 'loop') {
    return [
      creatorChoice(
        '逐条对应：每条内容各生成一次',
        '第 1 条配第 1 份素材，第 2 条配第 2 份素材；数量不足时停下提示。',
        `把当前批量流程设为逐条对应：每条上游内容单独执行一次，并与同序号素材配对，不要把所有提示词合并到一次生成。${protectedInstruction}${lineageInstruction}`,
        creatorPlanKind(plan, 'story'),
      ),
      creatorChoice(
        '统一参考：所有内容共用同一素材',
        '每条内容仍独立生成，只复用同一张图、同一视频或同一段音频。',
        `把当前批量流程设为统一参考：每条内容仍单独执行，但全部复用第 1 份参考素材，不要把多条提示词拼在一起。${protectedInstruction}${lineageInstruction}`,
        creatorPlanKind(plan, 'story'),
      ),
      creatorChoice(
        '先试 3 条，确认后再跑全部',
        '先用前三条验证提示词和素材配对，满意后再展开完整批次。',
        `先只规划当前批量流程的前 3 条试跑，逐条生成并分别保留结果；确认效果后再继续全部内容。${protectedInstruction}${lineageInstruction}`,
        creatorPlanKind(plan, 'story'),
      ),
    ];
  }
  if (focusKind === 'image') {
    const nextChoices = creatorImageNextChoices(plan, `${protectedInstruction}${lineageInstruction}`);
    if (nextChoices) return nextChoices;
    return [
      creatorChoice(
        '重整构图与视觉重点',
        '保留主体身份和产品结构，只调整主体关系、留白和视觉动线。',
        `修改当前图像：保留主体身份、产品结构和已锁定内容，只重整构图、留白与视觉重点。${lineageInstruction}`,
        'edit-image',
      ),
      creatorChoice(
        '让人景和光影自然融合',
        '统一透视、光源方向、色温、接触阴影和环境反射。',
        `修改当前图像：保留主体内容，只统一人景透视、光源方向、色温、接触阴影和环境反射，让融合更自然。${protectedInstruction}${lineageInstruction}`,
        'edit-image',
      ),
      creatorChoice(
        '只精修皮肤、材质与细节',
        '构图不动，改善肤质、纹理、边缘和清晰度，避免过度锐化。',
        `修改当前图像：构图和主体不动，只精修皮肤、材质、纹理、边缘和清晰度，避免塑料感和过度锐化。${protectedInstruction}${lineageInstruction}`,
        'edit-image',
      ),
    ];
  }
  if (focusKind === 'video') {
    const nextChoices = creatorVideoNextChoices(plan, `${protectedInstruction}${lineageInstruction}`);
    if (nextChoices) return nextChoices;
    return [
      creatorChoice(
        '让表演和动作更清楚',
        '强化动作起承转合、视线和人物调度，减少无意义的小动作。',
        `优化当前视频：保留人物身份与故事内容，优先让表演、动作节点和人物调度更清楚。${protectedInstruction}${lineageInstruction}`,
        'edit-video',
      ),
      creatorChoice(
        '让镜头运动更有层次',
        '调整景别、机位和运镜路径，保持主体可读与空间连续。',
        `优化当前视频：保留主体与连续性，优先改善景别、机位、运镜路径和空间层次。${protectedInstruction}${lineageInstruction}`,
        'edit-video',
      ),
      creatorChoice(
        '让节奏与情绪更有张力',
        '重排停顿、加速点和情绪变化，保留已完成的有效镜头。',
        `优化当前视频：保留已完成的有效镜头，只调整停顿、加速点和情绪节奏，让成片更有张力。${protectedInstruction}${lineageInstruction}`,
        'edit-video',
      ),
    ];
  }
  if (focusKind === 'audio') {
    return [
      creatorChoice(
        '对白更清楚、更自然',
        '先处理说话节奏、停顿和可懂度，不改变原意。',
        `优化当前声音：保留原意，优先改善对白节奏、停顿和清晰度。${protectedInstruction}${lineageInstruction}`,
        'audio',
      ),
      creatorChoice(
        '环境与音效更有空间感',
        '补出前后景和距离层次，让声音与画面位置一致。',
        `优化当前声音：建立前后景、距离和环境层次，让音效与画面空间一致。${protectedInstruction}${lineageInstruction}`,
        'audio',
      ),
      creatorChoice(
        '音乐更贴合情绪转折',
        '按剧情节点安排进入、抬升、停顿和收束。',
        `优化当前声音：按剧情节点重排音乐进入、抬升、停顿和收束，突出情绪转折。${protectedInstruction}${lineageInstruction}`,
        'audio',
      ),
    ];
  }
  return [
    creatorChoice(
      '先把现有内容串成一条故事线',
      '明确开端、变化和结果，让当前素材有可理解的顺序。',
      `围绕当前选区，把现有内容整理成开端、变化和结果清楚的一条故事线。${protectedInstruction}${lineageInstruction}`,
      creatorPlanKind(plan, 'story'),
    ),
    creatorChoice(
      '先统一角色与视觉风格',
      '核对人物、服装、场景、色彩和光线，找出最明显的不一致。',
      `围绕当前选区，先统一角色身份、服装、场景、色彩和光线，只提出需要修改的具体位置。${protectedInstruction}${lineageInstruction}`,
      creatorPlanKind(plan, 'story'),
    ),
    creatorChoice(
      '先补最影响成片的一处缺口',
      '不展开全部流程，只找当前最关键的缺失镜头或素材。',
      `围绕当前选区，只找出最影响成片的一处缺失镜头或素材，并给出可直接执行的补齐方案。${protectedInstruction}${lineageInstruction}`,
      creatorPlanKind(plan, 'story'),
    ),
  ];
}

function creatorSuggestionArtifactDigest(plan = null) {
  const documents = (Array.isArray(plan?.productionDocuments) ? plan.productionDocuments : [])
    .map((item) => ({
      documentId: boundedText(item?.documentId, 160),
      versionId: boundedText(item?.versionId, 160),
      kind: boundedText(item?.kind, 80),
      revision: Math.max(0, Math.trunc(Number(item?.revision) || 0)),
      contentDigest: boundedText(item?.contentDigest, 64).toLowerCase(),
    }))
    .filter((item) => item.documentId || item.contentDigest);
  return {
    digest: creatorDigest({ documents }),
    documentCount: documents.length,
  };
}
function creatorResponseSuggestionSource(
  plan = null,
  responseText = '',
  responseEvidence = null,
  artifactVersion = null,
) {
  const body = boundedText(responseText, 80_000);
  if (!body) return null;
  const headings = [];
  const addHeading = (value) => {
    const heading = boundedText(value, 80)
      .replace(/^[\s#>*\-\d.、]+/u, '')
      .replace(/[*_`]/g, '')
      .replace(/\s+V0$/i, '')
      .trim();
    if (!heading
      || /^(?:离线结构|我理解的目标|当前建议值与待确认)$/u.test(heading)
      || headings.includes(heading)) return;
    headings.push(heading);
  };
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*#{1,4}\s+(.+)$/u);
    if (match) addHeading(match[1]);
    if (headings.length >= 6) break;
  }
  if (headings.length < 2) {
    for (const match of body.matchAll(/\*\*([^*\n]{2,60})\*\*/gu)) {
      addHeading(match[1]);
      if (headings.length >= 6) break;
    }
  }
  const kind = creatorPlanKind(plan, 'story');
  const classifier = `${creatorPlanGoal(plan)}\n${body}`.toLowerCase();
  const inferredTaskFamily = ['image', 'edit-image'].includes(kind)
    ? 'image'
    : ['video', 'edit-video'].includes(kind)
      ? 'video'
      : kind === 'audio'
        ? 'audio'
        : /电商|商品|主图|详情页|卖点|品牌|海报|广告|tvc|投放/u.test(classifier)
          ? 'commerce'
          : ['story', 'script'].includes(kind)
            ? 'story'
            : 'mixed';
  const taskFamily = boundedText(artifactVersion?.taskFamily, 40) || inferredTaskFamily;
  const fallbackArtifact = creatorSuggestionArtifactDigest(plan);
  const artifactContentDigest = boundedText(
    artifactVersion?.content?.contentDigest,
    64,
  ).toLowerCase();
  const artifactDigest = /^[a-f0-9]{64}$/.test(artifactContentDigest)
    ? artifactContentDigest
    : fallbackArtifact.digest;
  const responseDigest = creatorDigest({
    schema: 't8-creator-response-body-v1',
    text: body,
  });
  const primaryFocus = boundedText(
    headings[0] || creatorGoalExcerpt(plan, 72) || '本轮创作 V0',
    46,
  );
  return {
    schema: 't8-creator-suggestion-source-v1',
    taskFamily,
    responseDigest,
    artifactDigest,
    ...(artifactVersion?.artifactId ? {
      artifactId: boundedText(artifactVersion.artifactId, 80),
      artifactVersionId: boundedText(artifactVersion.versionId, 80),
      artifactRevision: Math.max(1, Math.trunc(Number(artifactVersion.revision) || 1)),
      artifactKind: boundedText(artifactVersion.kind, 80),
    } : {}),
    evidenceMode: boundedText(responseEvidence?.mode, 40) || null,
    evidenceErrorCode: boundedText(responseEvidence?.errorCode, 120) || null,
    mediaGroundingStatus: boundedText(
      responseEvidence?.mediaGrounding?.status,
      40,
    ) || null,
    primaryFocus,
    headings,
    documentCount: artifactVersion?.artifactId ? 1 : fallbackArtifact.documentCount,
  };
}

function creatorResponseDrivenChoices(plan = null, source = null) {
  if (!source?.responseDigest) return null;
  if (source.mediaGroundingStatus
    && source.mediaGroundingStatus !== 'confirmed'
    && source.mediaGroundingStatus !== 'not-required') {
    const kind = creatorPlanKind(plan, 'mixed');
    return [
      creatorChoice(
        '保持附件，换视觉模型重试',
        '不重新上传、不改需求，改用明确支持视觉输入的语言模型重新读取。',
        '保留本轮全部附件和文字要求，选择目录明确标记支持视觉输入的语言模型后重试；必须先给出可核验素材观察，再继续创作。',
        kind,
      ),
      creatorChoice(
        '保持附件，重新读取一次',
        '模型已经支持视觉时，按同一素材重新读取，不沿用失败回复。',
        '保留本轮附件，丢弃未通过素材核验的回复，重新读取一次；只在素材观察包含具体可见事实后继续。',
        kind,
      ),
      creatorChoice(
        '忽略附件，只按文字创作',
        '明确不使用当前素材，避免系统假装参考图片、视频或音频。',
        '本轮明确忽略全部附件，只按用户文字要求给出可编辑创作 V0；不得声称参考了附件内容。',
        kind,
      ),
    ];
  }
  const focus = source.primaryFocus || '本轮创作 V0';
  const nextSection = source.headings?.[1] || focus;
  const receipt = source.responseDigest.slice(0, 10);
  const kind = creatorPlanKind(plan, source.taskFamily === 'audio' ? 'audio' : 'story');
  const choices = {
    commerce: [
      creatorChoice(`把「${focus}」写成逐屏成稿`, `沿用本轮结构，把“${nextSection}”展开为可直接修改的标题、正文和画面任务。`, `沿用本轮回复 ${receipt} 的事实边界，把“${focus}”展开成逐屏成稿：每屏写清标题、正文、画面任务和所需真实素材；不得虚构参数、功效或认证。`, kind),
      creatorChoice('用当前卖点做 3 个首屏方向', '保留同一产品事实，分别强调利益点、使用场景和强视觉钩子。', `基于本轮回复 ${receipt} 已整理的卖点，给出利益点优先、场景优先、强视觉优先三个首屏方案；每个方案都写出主标题、构图和适用渠道。`, kind),
      creatorChoice('核对事实、合规与素材缺口', '列出哪些内容已确认、哪些仍是建议值，以及真正缺少的商品素材。', `核对本轮回复 ${receipt}：分开列出用户已提供事实、Agent 建议值、合规风险和缺失素材，并给出不覆盖现有素材的补齐顺序。`, kind),
    ],
    image: [
      creatorChoice(`把「${focus}」做成 3 个视觉方向`, '同一目标下形成稳妥、风格化和强视觉三个可比较版本。', `沿用本轮回复 ${receipt} 的保留区和修改区，把“${focus}”发展成稳妥、风格化、强视觉三个图像方向，分别写清构图、光影、色彩和取舍。`, kind),
      creatorChoice('锁定主体，只细化融合与质感', '保护身份、产品结构和已满意区域，只处理光影、边缘与材质。', `沿用本轮回复 ${receipt}，锁定主体身份、产品结构和已满意区域，只细化透视、光源、接触阴影、边缘、皮肤与材质，不改构图。`, kind),
      creatorChoice('整理成可直接生成的图像提示词', '把本轮方案编译为正向约束、保留项和禁止项，仍不立即生成。', `把本轮回复 ${receipt} 编译成一份可编辑图像提示词：包含主体、构图、环境、光影、材质、保留项和禁止项；不要启动模型或修改画布。`, kind),
    ],
    video: [
      creatorChoice(`把「${focus}」拆成逐镜头表`, '逐镜头写清时长、画面动作、景别运镜、声音和转场。', `沿用本轮回复 ${receipt}，把“${focus}”拆成逐镜头表；每镜写时长、画面动作、景别与运镜、对白/声音、转场和连续性要求。`, kind),
      creatorChoice('先写强开头与明确收尾', '优先完成前 3 秒钩子和结尾落点，再反推中段节奏。', `基于本轮回复 ${receipt}，先给出三个可比较的前 3 秒钩子和两个结尾落点，并说明如何连接当前中段内容。`, kind),
      creatorChoice('检查人物、场景与镜头连续性', '逐项核对身份、服装、道具、空间、光向和动作衔接。', `检查本轮回复 ${receipt} 对应的视频方案，列出人物身份、服装、道具、空间、光向和动作连续性规则，并标出最容易穿帮的镜头。`, kind),
    ],
    story: [
      creatorChoice(`把「${focus}」展开成完整场景`, `沿用“${nextSection}”等现有内容，补出可拍动作、对白和场景变化。`, `沿用本轮回复 ${receipt} 的人物事实与冲突，把“${focus}”写成完整可编辑场景；使用可拍动作、必要对白和明确场景变化，不用解释性空话。`, kind),
      creatorChoice('补实角色目标、阻力与关系', '直接给出角色小传、当场目标、隐瞒信息和关系张力。', `基于本轮回复 ${receipt}，补全主要角色的可编辑小传、当场目标、外部阻力、内在缺陷、隐瞒信息和相互关系，并说明这些信息如何推动场景。`, kind),
      creatorChoice('把关键场景拆成可拍分镜', '形成镜号、时长、动作、景别运镜、声音和连续性要求。', `选择本轮回复 ${receipt} 中最关键的场景，拆成可拍分镜表：镜号、时长、画面动作、景别运镜、对白/声音、必须出现和严格禁止。`, kind),
    ],
    audio: [
      creatorChoice(`把「${focus}」写成完整声音脚本`, '按时间写出对白、旁白、环境、音效和音乐的进入退出。', `沿用本轮回复 ${receipt}，把“${focus}”展开成时间轴声音脚本，逐段写清对白/旁白、环境、音效、音乐和动态变化。`, 'audio'),
      creatorChoice('先做对白清晰版与情绪版', '同一文本给出自然清晰和情绪强化两个可比较方向。', `基于本轮回复 ${receipt}，给同一内容设计“自然清晰”和“情绪强化”两个声音方向，写清语速、停连、重音、音色和适用场景。`, 'audio'),
      creatorChoice('整理成可执行的声音分层表', '列出每层来源、时间位置、响度职责和仍缺少的素材。', `把本轮回复 ${receipt} 整理成对白、环境、动作音效、氛围、音乐五层执行表，标出时间位置、响度职责、已有素材和缺口。`, 'audio'),
    ],
    mixed: [
      creatorChoice(`继续完成「${focus}」`, '沿用已经明确的内容，直接补成一个可编辑交付版本。', `沿用本轮回复 ${receipt}，继续完成“${focus}”，直接给出可编辑正文、结构和执行顺序；不要退回成一串问题。`, kind),
      creatorChoice('形成 3 个有明确取舍的方向', '每个方向都写清适合场景、优势、风险和下一步产物。', `围绕本轮回复 ${receipt} 给出三个差异明确的创作方向，并写清各自适合场景、优势、风险和下一步产物。`, kind),
      creatorChoice('把当前方案转成画布执行清单', '只规划节点、素材、顺序和确认边界，不立即写画布。', `把本轮回复 ${receipt} 转成画布执行清单：需要的节点、输入素材、连接顺序、候选数量和确认边界；当前不修改画布或启动 Provider。`, kind),
    ],
  };
  return choices[source.taskFamily] || choices.mixed;
}

function creatorProductionDocumentKindsForPhase(value) {
  const phase = normalizeCreativePhase(value, 'idea');
  const kinds = {
    idea: ['production-brief'],
    script: ['script-doc', 'world-bible'],
    assets: ['character-bible', 'asset-needs'],
    shots: ['shot-list', 'audio-plan', 'storyboard', 'prompt-pack'],
    candidates: ['candidate-review', 'edit-decision-list', 'qc-report'],
    delivery: ['delivery-manifest'],
  };
  return [...(kinds[phase] || kinds.idea)];
}

function nextCreatorProductionPhase(value) {
  const phase = normalizeCreativePhase(value, 'idea');
  const index = CREATOR_PRODUCTION_PHASES.indexOf(phase);
  return index >= 0 && index < CREATOR_PRODUCTION_PHASES.length - 1
    ? CREATOR_PRODUCTION_PHASES[index + 1]
    : phase;
}

function creatorStageSuggestionChoices(
  plan = null,
  source = null,
  production = null,
  stageReadyForConfirmation = false,
) {
  if (!['story', 'script'].includes(String(plan?.kind || ''))) return null;
  const phase = normalizeCreativePhase(production?.currentPhase, 'idea');
  const kind = creatorPlanKind(plan, 'story');
  const receipt = source?.responseDigest?.slice(0, 10) || '当前阶段';
  const focus = source?.primaryFocus || creatorGoalExcerpt(plan, 54) || '当前作品';
  const choices = {
    idea: [
      stageReadyForConfirmation ? creatorChoice(
        '确认创意，继续写完整剧本',
        `保留“${focus}”和已核验参考素材；确认当前创意后，进入剧本阶段并交付完整可编辑稿。`,
        `当前创意版本已经由我确认。以已确认制作简报和参考素材事实为唯一上游，继续写完整可编辑剧本：标题、一句话梗概、角色、分场、可拍动作、必要对白、情绪节奏和结尾；总时长、画幅、受众与视觉方向服从已确认制作简报，不提前生成资产或分镜。`,
        kind,
      ) : creatorChoice(
        '先完成可确认的创意与制作目标',
        `围绕“${focus}”交付主题、受众、时长、画幅、情绪和视觉方向，不退回成空问卷。`,
        `围绕“${focus}”完成当前创意简报：明确一句话目标、受众与用途、推荐时长和画幅、核心情绪、视觉方向与必须保留的参考素材事实；直接交付可编辑版本，不进入剧本或分镜。`,
        kind,
      ),
      creatorChoice(
        '比较 3 个真正不同的创意方向',
        '同一素材与目标下比较温馨、幽默或电影感等差异，并推荐最合适的一案。',
        `基于回复 ${receipt} 和已核验素材事实，给出三个差异明确、都能实际制作的创意方向；每个写清核心事件、情绪、适合时长、视觉特点和取舍，最后推荐一案，但不写完整剧本。`,
        kind,
      ),
      creatorChoice(
        '补齐时长、受众与风格约束',
        '保留当前创意，只把会影响后续制作的规格和边界一次补清。',
        `保留回复 ${receipt} 的创意内容，只补齐目标受众、发布用途、推荐时长、画幅、语言、节奏、视觉风格、参考素材使用方式和禁止项；合理默认直接标注为建议值，不退回成问卷。`,
        kind,
      ),
    ],
    script: [
      stageReadyForConfirmation ? creatorChoice(
        '确认剧本，继续整理所需资产',
        '保留已确认剧情、角色关系与结尾，进入资产阶段整理角色、场景、服装、道具和声音。',
        `当前完整剧本和世界设定已经由我确认。以已确认剧本为唯一上游，继续整理可编辑资产表：角色、服装、场景、道具和声音；每项写清出现镜头、连续性锁、已有素材、缺失内容和可直接修改的生成提示词。保护上传、采用和锁定素材，不自动生成。`,
        kind,
      ) : creatorChoice(
        '开始写完整可编辑剧本',
        '使用已确认创意，按时长写出场景、动作、必要对白、情绪转折和可拍结尾。',
        '以已确认创意版本为唯一上游，写出完整可编辑剧本：标题、一句话梗概、角色、分场、可拍动作、必要对白、情绪节奏和结尾；总时长服从已确认制作简报，不跳到资产或分镜。',
        kind,
      ),
      creatorChoice(
        '深化角色目标、关系与弧光',
        '保留故事主线，补实角色为什么行动、彼此关系如何变化。',
        `沿用已确认创意与回复 ${receipt}，完善主要角色的外在目标、内在需要、阻力、关系张力和可见变化，并把这些内容写回具体场景与动作；交付修订后的完整剧本，不只写角色小传。`,
        kind,
      ),
      creatorChoice(
        '检查场景推进与结尾',
        '逐场修正重复、跳跃和无效对白，让开头、升级、高潮和收束完整。',
        `审阅回复 ${receipt} 的剧本版本，逐场检查目标、冲突、信息、动作与转折；删除重复和解释性空话，强化开头钩子、过程升级、高潮选择和画面化结尾，并交付完整修订稿。`,
        kind,
      ),
    ],
    assets: [
      stageReadyForConfirmation ? creatorChoice(
        '确认资产，继续拆成可拍分镜',
        '保留全部上传、采用和锁定素材，把剧本和资产逐镜带入镜头表。',
        '当前资产表已经由我确认。以已确认剧本和资产为唯一上游，继续拆成完整可编辑镜头表与分镜：镜号、时长、画面动作、景别、机位、运镜、对白/声音、引用资产、必须出现、严格禁止和前后连续性；不调用图像或视频模型。',
        kind,
      ) : creatorChoice(
        '开始整理角色、场景与道具资产',
        '从已确认剧本提取真实需要的资产、连续性约束和可编辑提示词。',
        '只以已确认剧本为来源，整理角色、服装、场景、道具和声音资产表；每项写清出现镜头、连续性锁、已有素材、缺失内容和可编辑生成提示词，不生成素材。',
        kind,
      ),
      creatorChoice(
        '只补真正缺失的资产',
        '保护已上传、已采用和已锁定内容，只列需要新做的部分。',
        '核对当前画布与已确认剧本，只输出真正缺失的角色、场景、道具、服装和声音资产；保留全部已上传、已采用和已锁定素材，标注每项的用途与优先级，不启动生成。',
        kind,
      ),
      creatorChoice(
        '检查角色与视觉一致性',
        '统一身份、服装、比例、色彩、光向和世界规则，避免后续镜头污染。',
        '检查当前资产方案的角色身份、服装、体态、场景时代与地理、道具、色彩和光向连续性；给出可直接写回资产表的修订版本与锁定规则，不进入分镜。',
        kind,
      ),
    ],
    shots: [
      stageReadyForConfirmation ? creatorChoice(
        '确认分镜，继续准备生成候选',
        '锁定镜头职责、资产引用和连续性，进入候选阶段整理逐镜生成方案。',
        '当前镜头表、分镜和提示词包已经由我确认。以这些已确认版本为唯一上游，继续准备逐镜关键帧和视频候选计划：输入资产、模型来源、比例、时长、候选数量、锁定项、验收标准和失败重试范围；只交付计划，不自动调用 Provider。',
        kind,
      ) : creatorChoice(
        '开始拆成可拍镜头表与分镜',
        '逐镜写清时长、画面、动作、景别、运镜、声音、资产和连续性。',
        '以已确认剧本和资产为唯一上游，拆成完整可编辑镜头表与分镜：镜号、时长、画面动作、景别、机位、运镜、对白/声音、引用资产、必须出现、严格禁止和前后连续性。',
        kind,
      ),
      creatorChoice(
        '优化景别、运镜与节奏',
        '保持剧情与资产不变，让每个镜头都有明确叙事职责。',
        `审阅回复 ${receipt} 的镜头方案，保持已确认剧情和资产不变，优化镜头时长、景别变化、机位、运镜、切点和声音节奏；交付完整修订镜头表。`,
        kind,
      ),
      creatorChoice(
        '检查动作与连续性',
        '逐镜核对视线、轴线、位置、服装、道具、光向和动作衔接。',
        `逐镜检查回复 ${receipt} 中的人物身份、视线、轴线、空间位置、服装、道具、光向、动作起止和声音衔接；标出问题并交付修复后的完整分镜版本。`,
        kind,
      ),
    ],
    candidates: [
      stageReadyForConfirmation ? creatorChoice(
        '确认采用结果，继续准备成片',
        '只使用真实已采用候选，进入成片阶段整理剪辑、声音、字幕和交付检查。',
        '当前真实候选、采用结果和质量检查已经由我确认。只使用已采用且来源可验证的片段，继续整理成片顺序、入出点、时长、转场、对白、音乐、音效、字幕和交付检查；缺失素材保持阻断，不冒充成片或自动渲染。',
        kind,
      ) : creatorChoice(
        '开始准备关键帧与视频候选',
        '根据已确认分镜列出候选、模型、规格和比较标准，仍不自动运行。',
        '以已确认分镜与 PromptPack 为上游，准备逐镜关键帧和视频候选计划：输入资产、模型来源、比例、时长、候选数量、锁定项、验收标准和失败重试范围；不自动调用 Provider。',
        kind,
      ),
      creatorChoice(
        '比较真实候选并给出采用建议',
        '只引用已有真实结果，按角色、构图、动作、连续性和声音逐项比较。',
        '读取当前作品真实候选及来源证据，按角色一致性、构图、动作、连续性、画质和声音逐项比较；说明推荐采用项和理由，未实际存在的候选保持未知，不自动采用。',
        kind,
      ),
      creatorChoice(
        '只重做失败或不满意镜头',
        '保留成功素材与采用结果，只规划被点名镜头的重做范围。',
        '保留所有成功、已采用和已锁定结果，只整理失败或明确不满意镜头的重做计划；逐项写清原因、保留内容、允许变化、模型与候选数量，不自动提交任务。',
        kind,
      ),
    ],
    delivery: [
      creatorChoice(
        '整理成片顺序与剪辑清单',
        '用真实已采用片段形成 EDL、声音层和转场草案。',
        '只用真实已采用并通过来源核验的片段，整理成片顺序、入出点、时长、硬切/转场、对白、音乐、音效和字幕清单；缺素材保持阻断，不冒充成片。',
        kind,
      ),
      creatorChoice(
        '检查声音、字幕和画质',
        '逐段核对可播放性、连续性、响度、字幕和输出规格。',
        '对当前真实成片候选逐段检查解码、尺寸、帧率、连续性、画质、对白、响度、音乐、字幕和黑帧/花屏风险；输出可执行 QC 清单和修复建议，不重新渲染。',
        kind,
      ),
      creatorChoice(
        '准备最终交付清单',
        '核对成片、封面、字幕、源素材、许可和文件摘要。',
        '根据已通过 QC 的真实文件准备最终交付清单：成片、封面、字幕、工程/源素材、格式、尺寸、时长、文件大小、SHA-256 与许可状态；缺证据保持未知，不创建文件。',
        kind,
      ),
    ],
  };
  return choices[phase] || choices.idea;
}

function creatorSuggestionChoices(context = {}, plan = null, options = {}) {
  const normalized = normalizeContext(context);
  if (plan?.kind === 'story' && plan?.brief?.recipe === 'shot-breakdown') {
    return [
      creatorChoice('学习节奏和剪辑密度', '只看镜头长短、切点和情绪起伏，不照搬内容。', '只学习当前参考视频的节奏、镜头长短和剪辑密度，并整理成可应用的规则。', 'story'),
      creatorChoice('学习景别和运镜语言', '提取机位、构图、景别变化和运镜路径。', '只提取当前参考视频的景别、机位、构图和运镜规则，并整理成可应用的规则。', 'story'),
      creatorChoice('用拉片结果继续做分镜', '先核对真实拉片结果，再规划关键帧与视频。', '核对当前参考视频的真实拉片结果后，继续规划关键帧和视频镜头，不立即生成。', 'story'),
    ];
  }
  const stageChoices = options.production
    ? creatorStageSuggestionChoices(
        plan,
        options.responseSource,
        options.production,
        options.stageReadyForConfirmation === true,
      )
    : null;
  if (stageChoices) return stageChoices;
  const responseChoices = plan?.kind === 'delivery'
    ? null
    : creatorResponseDrivenChoices(plan, options.responseSource);
  if (responseChoices) return responseChoices;
  const focus = creatorContextFocusForPlan(normalized, plan);
  if (focus) return creatorFocusedSuggestionChoices(focus, normalized, plan);
  const recoveryRequested = creatorPlanRequestsRecovery(plan);
  if (recoveryRequested && normalized.failedRunCount > 0) {
    return [
      creatorChoice('告诉我哪里失败了', '用创作者能看懂的话说明原因，并列出已经保留的成果。', '说明当前失败发生在哪一步、可能原因是什么，以及哪些成果已经安全保留；不要启动重试。', creatorPlanKind(plan)),
      creatorChoice('只重试失败的部分', '成功素材和任务保持不动，只处理明确失败项。', '只规划当前失败范围的重试，保留所有已成功任务、素材和锁定内容。', creatorPlanKind(plan)),
      creatorChoice('用已完成素材继续', '跳过失败项，先看看现有成果还能推进到哪一步。', '沿用所有已完成并持久化的素材继续下一步，同时列出仍缺失的内容。', creatorPlanKind(plan)),
    ];
  }
  const planPhase = phaseForPlan(plan, normalized.phase || 'idea');
  if ((plan?.kind === 'story' || plan?.kind === 'script') && planPhase === 'assets') {
    return [
      creatorChoice('先核对现有角色与场景', '逐项检查角色、场景、道具和声音，已上传内容保持不动。', '核对现有角色、场景、道具和声音资产，保留所有已上传、已采用和锁定内容。', creatorPlanKind(plan)),
      creatorChoice('只补缺失资产', '只列出真正缺少的素材，不覆盖已经满意的内容。', '只规划当前缺失的角色、场景、道具和声音资产，不覆盖任何已有素材。', creatorPlanKind(plan)),
      creatorChoice('资产齐了，开始拆分镜', '把已确认资产带入镜头表，逐镜头继续修改。', '确认现有资产已经齐备，下一步进入可编辑分镜；保留全部资产，不立即生成视频。', creatorPlanKind(plan)),
    ];
  }
  if ((plan?.kind === 'story' || plan?.kind === 'script') && planPhase === 'shots') {
    return [
      creatorChoice('先修人物动作与连续性', '逐镜头核对动作、视线、位置和前后衔接。', '逐镜头检查人物动作、视线、位置、时长和前后连续性，只标出需要修改的镜头。', creatorPlanKind(plan)),
      creatorChoice('优化景别、运镜与节奏', '让镜头变化有目的，避免重复机位和无意义运动。', '逐镜头优化景别、机位、运镜和节奏，保持已确认剧情和资产不变。', creatorPlanKind(plan)),
      creatorChoice('镜头确认，编译生成提示词', '把确认镜头转成仍可编辑的提示词，不立即生成。', '把已经确认的镜头编译成可编辑图像和视频提示词，不立即调用模型。', creatorPlanKind(plan)),
    ];
  }
  if ((plan?.kind === 'story' || plan?.kind === 'script') && planPhase === 'candidates') {
    return [
      creatorChoice('并排比较候选差异', '按角色、构图、动作和连续性比较，不自动采用。', '对照分镜并排比较所有真实候选，说明各自优缺点，先不自动采用。', creatorPlanKind(plan)),
      creatorChoice('采用当前最佳并锁定', '采用前再次确认，并锁住角色、风格和连续性。', '采用当前最佳候选，并锁定角色身份、视觉风格和镜头连续性；采用前仍需明确确认。', creatorPlanKind(plan)),
      creatorChoice('只重做失败或不满意镜头', '保留满意成片和素材，只处理明确点名的镜头。', '只规划失败或明确不满意镜头的重做，保留所有已完成视频和素材。', creatorPlanKind(plan)),
    ];
  }
  if (recoveryRequested && normalized.offscreenSummary.failedCount > 0) {
    return [
      creatorChoice('找到画布外的异常内容', `当前有 ${normalized.offscreenSummary.failedCount} 个异常对象，先说明位置和原因。`, '定位所有画布外异常对象，用创作者能看懂的话说明原因，不修改画布。', creatorPlanKind(plan)),
      creatorChoice('只修异常，不碰已完成画面', '把修复范围限制在异常对象，保护全部已完成成果。', '只规划画布外异常对象的修复，保留所有已完成画面、素材和锁定内容。', creatorPlanKind(plan)),
      creatorChoice('移到眼前，逐个确认', '把待处理对象集中到当前视野，再由我逐个决定。', '规划把需要处理的异常对象移动到当前视野，逐个等待我确认，不立即写画布。', creatorPlanKind(plan)),
    ];
  }
  if (plan?.kind === 'story' || plan?.kind === 'script') {
    return creatorStoryChoices(plan);
  }
  if (plan?.kind === 'image' || plan?.kind === 'edit-image') {
    const nextChoices = creatorImageNextChoices(plan);
    if (nextChoices) return nextChoices;
    return [
      creatorChoice('叙事构图：画面一眼看懂', '重排主体关系、留白和视觉动线，让重点更明确。', `围绕“${creatorGoalExcerpt(plan)}”，做叙事构图方向：主体关系、留白和视觉动线清楚，保留身份和关键内容。`, creatorPlanKind(plan, 'image')),
      creatorChoice('自然融合：人、景和光线统一', '统一透视、色温、光源方向、阴影和环境反射。', `围绕“${creatorGoalExcerpt(plan)}”，做人景自然融合方向：统一透视、色温、光源、接触阴影和环境反射。`, creatorPlanKind(plan, 'image')),
      creatorChoice('质感精修：皮肤、材质和纹理', '构图不动，只改善微观细节、边缘和清晰度。', `围绕“${creatorGoalExcerpt(plan)}”，做质感精修方向：构图不动，只改善皮肤、材质、纹理、边缘和清晰度。`, creatorPlanKind(plan, 'image')),
    ];
  }
  if (plan?.kind === 'video' || plan?.kind === 'edit-video') {
    const nextChoices = creatorVideoNextChoices(plan);
    if (nextChoices) return nextChoices;
    return [
      creatorChoice('表演优先：动作清楚可信', '先定关键动作、视线和人物调度，让镜头容易看懂。', `围绕“${creatorGoalExcerpt(plan)}”，采用表演优先的视频方向：动作、视线和人物调度清楚可信。`, creatorPlanKind(plan, 'video')),
      creatorChoice('镜头优先：空间更有层次', '用景别、机位和运镜建立空间，不牺牲主体可读性。', `围绕“${creatorGoalExcerpt(plan)}”，采用镜头优先的视频方向：用景别、机位和运镜建立空间层次。`, creatorPlanKind(plan, 'video')),
      creatorChoice('节奏优先：情绪逐步升级', '安排停顿、加速点和情绪转折，让结尾有落点。', `围绕“${creatorGoalExcerpt(plan)}”，采用节奏优先的视频方向：安排停顿、加速点和情绪转折。`, creatorPlanKind(plan, 'video')),
    ];
  }
  if (plan?.kind === 'audio') {
    return [
      creatorChoice('对白与旁白优先', '先保证信息、情绪和说话节奏清楚，再补环境。', `围绕“${creatorGoalExcerpt(plan)}”，采用对白与旁白优先的声音方向，先保证信息和情绪清楚。`, 'audio'),
      creatorChoice('环境与音效优先', '用空间、距离和关键音效建立沉浸感。', `围绕“${creatorGoalExcerpt(plan)}”，采用环境与音效优先的声音方向，突出空间、距离和关键动作。`, 'audio'),
      creatorChoice('音乐与节奏优先', '按情绪节点安排音乐进入、抬升、停顿和收束。', `围绕“${creatorGoalExcerpt(plan)}”，采用音乐与节奏优先的声音方向，按情绪节点安排变化。`, 'audio'),
    ];
  }
  if (plan?.kind === 'delivery') {
    return [
      creatorChoice('先核对要交付的内容', '确认成片、源素材、工程文件和许可范围。', '先核对本次交付需要包含的成片、源素材、工程文件和许可状态。', 'delivery'),
      creatorChoice('只打包验证通过的素材', '排除未落盘、损坏或来源不清的文件。', '只打包已经持久化且通过文件校验的素材，排除损坏和来源不明内容。', 'delivery'),
      creatorChoice('创建后再次校验交付包', '核对数量、大小和哈希，确保下载后的包可用。', '创建交付包后立即重新核对文件数量、大小和哈希，确保交付包完整可用。', 'delivery'),
    ];
  }
  if (normalized.selectedNodeTypes.length > 0) {
    return creatorFocusedSuggestionChoices({
      source: 'selection',
      object: {
        nodeType: normalized.selectedNodeTypes[0],
        label: normalized.selectedNodeTypes[0],
        mediaKinds: [],
        accepted: false,
        lockKeys: [],
      },
    }, normalized, plan);
  }
  if (normalized.nodeCount > 0) {
    return [
      creatorChoice('把现有素材串成一个故事', '先找开端、变化和结果，不新增无关素材。', '分析当前画布，把现有素材串成开端、变化和结果清楚的一条故事线，并只问下一项关键决定。', 'story'),
      creatorChoice('先做一张能定调的主视觉', '从现有内容提炼角色、场景和视觉风格。', '分析当前画布，先规划一张能够确定角色、场景和视觉风格的主视觉，并给出三个明确方向。', 'image'),
      creatorChoice('先找最影响成片的缺口', '只指出一个最关键的缺失镜头、角色或声音。', '分析当前画布，只找出最影响成片的一处缺失镜头、角色或声音，并给出可直接执行的补齐方案。', 'story'),
    ];
  }
  return [
    creatorChoice('从一句创意开始', '先找到核心冲突，再逐轮确定人物、分镜和视觉。', '我有一个创意想法，请先帮我找到最有力的核心冲突，一轮只推进一个创作决定。', 'story'),
    creatorChoice('从一段剧本开始', '先整理人物和场景，再逐镜头推进到视频。', '我有一段剧本，请先帮我整理人物、场景和关键事件，再一轮只推进一个创作决定。', 'script'),
    creatorChoice('从一个产品广告开始', '先定受众、卖点和视觉钩子，再拆成镜头。', '我要做一个产品广告，请先帮我确定受众、核心卖点和一个强视觉钩子，再一轮只推进一个创作决定。', 'story'),
  ];
}

function referenceBreakdownContinuationState(plan = null) {
  const document = (Array.isArray(plan?.productionDocuments) ? plan.productionDocuments : [])
    .find((item) => item?.kind === 'reference-breakdown');
  if (!document) {
    return {
      ready: false,
      code: 'reference-breakdown-result-missing',
      message: '还没有可继续生产的拉片结果；请先完成当前参考视频拉片',
    };
  }
  const content = document?.content && typeof document.content === 'object'
    && !Array.isArray(document.content) ? document.content : {};
  const contentDigest = boundedText(document?.contentDigest, 64).toLowerCase();
  if (document.schema !== 't8-creator-production-document-v1'
    || !/^[a-f0-9]{64}$/.test(contentDigest)
    || creatorDigest({ kind: 'reference-breakdown', content }) !== contentDigest) {
    return {
      ready: false,
      code: 'reference-breakdown-document-invalid',
      message: '当前拉片作品文档无法验证；请刷新会话后重新核对结果',
    };
  }
  if (content.status !== 'analysis-result-ready') {
    return {
      ready: false,
      code: 'reference-breakdown-result-pending',
      message: content.analysisError
        ? `拉片结果还不能继续生产：${boundedText(content.analysisError, 240)}`
        : '拉片结果尚未完成；请先运行并核对当前拉片节点',
    };
  }
  const evidence = content.resultEvidence && typeof content.resultEvidence === 'object'
    && !Array.isArray(content.resultEvidence) ? content.resultEvidence : {};
  if (evidence.runBindingStatus !== 'verified') {
    return {
      ready: false,
      code: 'reference-breakdown-run-evidence-required',
      message: boundedText(evidence.runEvidenceReason, 240)
        || '拉片结果尚未完成 Run / NodeRun / Attempt 核验，暂不能进入生产',
    };
  }
  const shots = Array.isArray(content.shots) ? content.shots : [];
  if (shots.length === 0 || shots.length > CREATOR_REFERENCE_PRODUCTION_MAX_SHOTS) {
    return {
      ready: false,
      code: shots.length === 0
        ? 'reference-breakdown-shots-missing'
        : 'reference-breakdown-shot-limit',
      message: shots.length === 0
        ? '拉片结果没有可用镜头，暂不能进入关键帧与视频规划'
        : `当前拉片包含 ${shots.length} 镜，超过单次生产规划上限 ${CREATOR_REFERENCE_PRODUCTION_MAX_SHOTS} 镜；请先拆分参考片段`,
    };
  }
  return { ready: true, code: '', message: '', document, content, evidence, shots };
}

function creatorCapabilityIds(options = {}) {
  if (Array.isArray(options.availableCapabilityIds)) {
    return new Set(options.availableCapabilityIds.map((value) => boundedText(value, 120)).filter(Boolean));
  }
  return new Set(readCreativeCapabilityManifest().capabilities.map((capability) => capability.id));
}

function creatorSuggestionExecution(item, capabilityById) {
  const operationPriority = ['plan', 'inspect', 'preview', 'verify'];
  const operationContracts = [];
  const blockers = [];
  for (const capabilityId of item.requiredCapabilityIds || []) {
    const capability = capabilityById.get(capabilityId);
    if (!capability) {
      blockers.push({
        code: 'capability-not-found',
        message: `当前版本没有找到“${capabilityId}”能力，请更新应用后重试`,
      });
      continue;
    }
    const safeOperations = (capability.operations || [])
      .filter((operation) => operation.riskLevel === 'L0' && operation.approvalRequired === false);
    const operation = operationPriority
      .map((name) => safeOperations.find((candidate) => candidate.operation === name))
      .find(Boolean) || safeOperations[0];
    if (!operation) {
      blockers.push({
        code: 'safe-operation-missing',
        message: `“${capability.creatorLabel || capabilityId}”目前没有可验证的只读操作，请先更新能力清单`,
      });
      continue;
    }
    operationContracts.push({
      capabilityId,
      operation: operation.operation,
      riskLevel: operation.riskLevel,
      approvalRequired: operation.approvalRequired,
      boundary: operation.boundary,
      requiredScopes: [...(operation.requiredScopes || [])],
    });
  }
  const executable = blockers.length === 0
    && operationContracts.length === (item.requiredCapabilityIds || []).length;
  return {
    ...item,
    executable,
    operationContracts,
    blockers,
    unblockActions: blockers.map((blocker) => blocker.message),
    disabledReason: executable ? '' : blockers[0]?.message || '当前建议暂时不能执行',
  };
}

function creatorSuggestionDigestPayload(suggestionSet = {}) {
  return {
    schema: suggestionSet.schema,
    binding: suggestionSet.binding,
    ...(suggestionSet.source ? { source: suggestionSet.source } : {}),
    items: Array.isArray(suggestionSet.items) ? suggestionSet.items : [],
  };
}
function creatorSuggestionInvariantReceipt(suggestionSet) {
  const capabilityById = new Map(
    readCreativeCapabilityGraph().capabilities.map((capability) => [capability.id, capability]),
  );
  const graphCapabilityIds = new Set(capabilityById.keys());
  const items = Array.isArray(suggestionSet?.items) ? suggestionSet.items : [];
  const ids = items.map((item) => boundedText(item?.id, 160));
  const intents = items.map((item) => boundedText(item?.intent, 160));
  const requiredCapabilityIds = [...new Set(items.flatMap((item) => (
    Array.isArray(item?.requiredCapabilityIds) ? item.requiredCapabilityIds : []
  )).map((value) => boundedText(value, 160)).filter(Boolean))].sort();
  const invalidCapabilityIds = requiredCapabilityIds
    .filter((capabilityId) => !graphCapabilityIds.has(capabilityId));
  let invalidContractCount = 0;
  let fakeEnabledActionCount = 0;
  let unexplainedDisabledActionCount = 0;
  for (const item of items) {
    const rawRequired = (Array.isArray(item?.requiredCapabilityIds)
      ? item.requiredCapabilityIds : [])
      .map((value) => boundedText(value, 160))
      .filter(Boolean);
    const required = [...new Set(rawRequired)].sort();
    const contracts = Array.isArray(item?.operationContracts) ? item.operationContracts : [];
    const contractIds = contracts
      .map((contract) => boundedText(contract?.capabilityId, 160))
      .filter(Boolean)
      .sort();
    const contractInvalid = rawRequired.length !== required.length
      || required.length === 0
      || contracts.length !== required.length
      || required.some((capabilityId, index) => contractIds[index] !== capabilityId)
      || contracts.some((contract) => {
        const capabilityId = boundedText(contract?.capabilityId, 160);
        const operationName = boundedText(contract?.operation, 80);
        const authoritative = capabilityById.get(capabilityId)?.operations
          ?.find((operation) => operation.operation === operationName);
        const scopes = (Array.isArray(contract?.requiredScopes) ? contract.requiredScopes : [])
          .map((scope) => boundedText(scope, 160))
          .filter(Boolean);
        const authoritativeScopes = (Array.isArray(authoritative?.requiredScopes)
          ? authoritative.requiredScopes : [])
          .map((scope) => boundedText(scope, 160))
          .filter(Boolean);
        return !authoritative
          || contract?.riskLevel !== authoritative.riskLevel
          || contract?.approvalRequired !== authoritative.approvalRequired
          || boundedText(contract?.boundary, 160) !== boundedText(authoritative.boundary, 160)
          || scopes.length !== new Set(scopes).size
          || scopes.slice().sort().join('\u0000') !== authoritativeScopes.slice().sort().join('\u0000');
      });
    if (contractInvalid) invalidContractCount += 1;
    const blockers = Array.isArray(item?.blockers) ? item.blockers : [];
    const blockerMessages = blockers
      .map((blocker) => boundedText(blocker?.message, 1_000))
      .filter(Boolean);
    const unblockActions = (Array.isArray(item?.unblockActions) ? item.unblockActions : [])
      .map((action) => boundedText(action, 1_000))
      .filter(Boolean);
    const disabledReason = boundedText(item?.disabledReason, 1_000);
    if (item?.executable === true && (
      contractInvalid
      || blockers.length > 0
      || Boolean(disabledReason)
      || (Array.isArray(item?.unblockActions) && item.unblockActions.length > 0)
      || required.some((capabilityId) => !graphCapabilityIds.has(capabilityId))
    )) fakeEnabledActionCount += 1;
    if (item?.executable !== true
      && blockerMessages.length === 0
      && !disabledReason
      && unblockActions.length === 0) {
      unexplainedDisabledActionCount += 1;
    }
  }
  const digestValid = suggestionSet?.schema === 't8-creator-suggestion-set-v1'
    && /^[a-f0-9]{64}$/.test(boundedText(suggestionSet?.setDigest, 64).toLowerCase())
    && suggestionSet.setDigest === creatorDigest(creatorSuggestionDigestPayload({
      ...suggestionSet,
      items,
    }));
  const problems = [
    ...(items.length === 3 ? [] : ['item-count']),
    ...(ids.every(Boolean) && new Set(ids).size === 3 ? [] : ['unique-id']),
    ...(intents.every(Boolean) && new Set(intents).size === 3 ? [] : ['unique-intent']),
    ...(invalidCapabilityIds.length === 0 ? [] : ['capability-id']),
    ...(invalidContractCount === 0 ? [] : ['operation-contract']),
    ...(fakeEnabledActionCount === 0 ? [] : ['fake-enabled-action']),
    ...(unexplainedDisabledActionCount === 0 ? [] : ['unexplained-disabled-action']),
    ...(digestValid ? [] : ['set-digest']),
  ];
  if (problems.length > 0) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_INVARIANT_FAILED',
      '当前回复无法提供 3 条可核对建议，已停止展示不完整操作，请刷新会话后重试',
      503,
      {
        problems,
        itemCount: items.length,
        invalidCapabilityIds,
        invalidContractCount,
        fakeEnabledActionCount,
        unexplainedDisabledActionCount,
      },
    );
  }
  return {
    schema: 't8-creator-suggestion-invariant-receipt-v1',
    suggestionSetCount: 1,
    itemCount: 3,
    uniqueIdCount: 3,
    uniqueIntentCount: 3,
    capabilityIdCount: requiredCapabilityIds.length,
    invalidCapabilityIds: [],
    invalidContractCount: 0,
    fakeEnabledActionCount: 0,
    unexplainedDisabledActionCount: 0,
    setDigest: suggestionSet.setDigest,
  };
}

function validateCreatorSuggestionPersistence(session, events = session?.events) {
  const corrupt = (reason) => {
    throw new CreatorAgentSessionError(
      'CREATOR_SESSION_CORRUPT',
      '创作会话的建议回执损坏，已停止展示和执行建议；请新建会话后重试',
      500,
      { reason },
    );
  };
  const validateSet = (set, receipt, reasonPrefix) => {
    let expected;
    try {
      expected = creatorSuggestionInvariantReceipt(set);
    } catch {
      corrupt(`${reasonPrefix}-set-invalid`);
    }
    if (!set?.invariantReceipt
      || creatorStableString(set.invariantReceipt) !== creatorStableString(expected)
      || creatorStableString(receipt) !== creatorStableString(expected)) {
      corrupt(`${reasonPrefix}-receipt-mismatch`);
    }
  };
  if (session?.suggestionSet?.invariantReceipt?.schema
    === 't8-creator-suggestion-invariant-receipt-v1') {
    validateSet(session.suggestionSet, session.suggestionSet.invariantReceipt, 'session');
  }
  const completedByResponseId = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant.response.completed') continue;
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const isVersioned = payload.suggestionInvariantReceipt?.schema
      === 't8-creator-suggestion-invariant-receipt-v1'
      || payload.suggestionSet?.invariantReceipt?.schema
        === 't8-creator-suggestion-invariant-receipt-v1';
    if (!isVersioned) continue;
    const responseId = boundedText(payload.responseId, 160);
    if (!responseId || completedByResponseId.has(responseId)) {
      corrupt('completed-event-not-unique');
    }
    completedByResponseId.add(responseId);
    validateSet(payload.suggestionSet, payload.suggestionInvariantReceipt, 'completed-event');
  }
  return session;
}

function creatorSuggestionBinding(context = {}, plan = null, options = {}) {
  const normalized = normalizeContext(context);
  const decisionDocument = normalizeCreatorDecisionDocument(options.decisionDocument);
  const canvasObjects = [...normalized.canvasObjects]
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const assetLineage = [...normalized.assetLineage]
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const recentRuns = [...normalized.recentRuns]
    .sort((left, right) => left.runId.localeCompare(right.runId));
  const contextDigest = creatorDigest({
    nodeCount: normalized.nodeCount,
    edgeCount: normalized.edgeCount,
    nodeTypeCounts: normalized.nodeTypeCounts,
    selectedNodeIds: [...normalized.selectedNodeIds].sort(),
    selectedNodeTypes: [...normalized.selectedNodeTypes].sort(),
    referencedNodeIds: [...normalized.referencedNodeIds].sort(),
    referencedNodeTypes: [...normalized.referencedNodeTypes].sort(),
    canvasTitle: normalized.canvasTitle,
    viewport: normalized.viewport,
    failedRunCount: normalized.failedRunCount,
    offscreenSummary: normalized.offscreenSummary,
    canvasObjects: canvasObjects.map((item) => ({
      nodeId: item.nodeId,
      nodeType: item.nodeType,
      label: item.label,
      status: item.status,
      selected: item.selected,
      inViewport: item.inViewport,
      upstreamCount: item.upstreamCount,
      downstreamCount: item.downstreamCount,
    })),
    recentRuns,
  });
  const assetVersion = creatorDigest({
    outputAssetCount: normalized.outputAssetCount,
    canvasObjects: canvasObjects.map((item) => ({
      nodeId: item.nodeId,
      mediaKinds: [...item.mediaKinds].sort(),
      resultCount: item.resultCount,
      accepted: item.accepted,
      lockKeys: [...item.lockKeys].sort(),
    })),
    assetLineage: assetLineage.map((item) => ({
      ...item,
      relations: [...item.relations].sort(),
      parentAssetIds: [...item.parentAssetIds].sort(),
      sourceNodeIds: [...item.sourceNodeIds].sort(),
      runIds: [...item.runIds].sort(),
      nodeRunIds: [...item.nodeRunIds].sort(),
      derivedOperations: [...item.derivedOperations].sort(),
    })),
  });
  return {
    schema: 't8-creator-suggestion-binding-v1',
    canvasRevision: normalized.canvasRevision,
    contextDigest,
    assetVersion,
    planDigest: boundedText(plan?.planDigest, 160) || null,
    ...(boundedText(options.responseDigest, 64) ? {
      responseDigest: boundedText(options.responseDigest, 64).toLowerCase(),
    } : {}),
    ...(boundedText(options.artifactDigest, 64) ? {
      artifactDigest: boundedText(options.artifactDigest, 64).toLowerCase(),
    } : {}),
    ...(boundedText(options.artifactId, 80) ? {
      artifactId: boundedText(options.artifactId, 80),
    } : {}),
    ...(boundedText(options.artifactVersionId, 80) ? {
      artifactVersionId: boundedText(options.artifactVersionId, 80),
    } : {}),
    ...(boundedText(options.workId, 80) ? {
      workId: boundedText(options.workId, 80),
      workRevision: Math.max(1, Math.trunc(Number(options.workRevision) || 1)),
      workDigest: boundedText(options.workDigest, 64).toLowerCase(),
    } : {}),
    ...(decisionDocument ? {
      decisionDocumentId: decisionDocument.documentId,
      decisionDocumentVersionId: decisionDocument.versionId,
      decisionDocumentDigest: decisionDocument.contentDigest,
      currentDecisionId: decisionDocument.currentDecisionId,
    } : {}),
  };
}

function creatorSuggestionSet(context = {}, plan = null, options = {}) {
  const normalized = normalizeContext(context);
  const availableCapabilityIds = creatorCapabilityIds(options);
  const capabilityById = new Map(
    readCreativeCapabilityGraph().capabilities.map((capability) => [capability.id, capability]),
  );
  const responseSource = creatorResponseSuggestionSource(
    plan,
    options.responseText,
    options.responseEvidence,
    options.artifactVersion,
  );
  const decisionDocument = normalizeCreatorDecisionDocument(options.decisionDocument);
  const decisionChoices = decisionDocument
    ? creatorDecisionSuggestionChoices(decisionDocument)
    : [];
  const decisionDriven = decisionChoices.length === 3;
  const choices = decisionDriven
    ? decisionChoices
    : creatorSuggestionChoices(context, plan, {
        responseSource,
        production: options.production,
        stageReadyForConfirmation: options.stageReadyForConfirmation === true,
      });
  const isStagedProduction = Boolean(
    options.production
    && plan?.brief?.recipe !== 'shot-breakdown'
    && (
      ['story', 'script'].includes(String(plan?.kind || ''))
      || (
        Array.isArray(plan?.productionDocuments)
        && plan.productionDocuments.some((document) => (
          document?.kind === 'delivery-manifest'
        ))
      )
    ),
  );
  const planPhase = isStagedProduction
    ? normalizeCreativePhase(options.production?.currentPhase, normalized.phase || 'idea')
    : phaseForPlan(plan, normalized.phase || 'idea');
  const storyGroup = `story-${planPhase}`;
  const focus = creatorContextFocusForPlan(normalized, plan);
  const recoveryRequested = creatorPlanRequestsRecovery(plan);
  const responseGroup = responseSource && plan?.kind !== 'delivery'
    ? responseSource.mediaGroundingStatus
      && responseSource.mediaGroundingStatus !== 'confirmed'
      && responseSource.mediaGroundingStatus !== 'not-required'
      ? 'media-grounding'
      : plan?.kind === 'story' && plan?.brief?.recipe === 'shot-breakdown'
        ? 'story-breakdown'
        : ['commerce', 'image', 'video', 'story', 'audio']
          .includes(responseSource.taskFamily)
          ? responseSource.taskFamily
          : 'canvas'
    : '';
  const group = (isStagedProduction ? storyGroup : responseGroup) || (focus
    ? 'selection'
    : recoveryRequested
      && (normalized.failedRunCount > 0 || normalized.offscreenSummary.failedCount > 0)
    ? 'recovery'
    : plan?.kind === 'story' && plan?.brief?.recipe === 'shot-breakdown'
      ? 'story-breakdown'
      : plan?.kind === 'story' || plan?.kind === 'script'
      ? boundedText(context?.phase, 40) || boundedText(plan?.analysis?.stage, 40)
        ? storyGroup
        : 'story'
      : plan?.kind === 'image' || plan?.kind === 'edit-image'
          ? 'image'
          : plan?.kind === 'video' || plan?.kind === 'edit-video'
            ? 'video'
            : plan?.kind === 'audio'
              ? 'audio'
              : plan?.kind === 'delivery'
                ? 'delivery'
                : normalized.nodeCount > 0
                  ? 'canvas'
                  : 'blank');
  const specs = {
    'media-grounding': [
      ['media-grounding-switch', 'creator.media.switch-vision-model', '保持附件与需求不变，改用已验证视觉模型重新读取', ['story.analyze']],
      ['media-grounding-retry', 'creator.media.retry-reading', '丢弃未核验回复，仅重新读取同一份附件', ['story.analyze']],
      ['media-grounding-ignore', 'creator.media.continue-text-only', '明确忽略附件，只按文字要求继续，不声称参考素材', ['create.story']],
    ],
    recovery: [
      ['recovery-explain', 'run.explain-failure', '只读核对真实 Run/NodeRun/Attempt，不启动重试', ['run.start', 'iterate.compare']],
      ['recovery-retry-scope', 'run.plan-failed-only', '只形成失败范围重试计划，保持成功任务与素材不变', ['run.start']],
      ['recovery-continue', 'run.continue-with-results', '盘点已持久化素材并规划安全的下一步', ['run.start', 'story.analyze']],
    ],
    commerce: [
      ['commerce-pages', 'commerce.expand-pages', '把当前产品事实与方案展开为逐屏可编辑成稿', ['create.story']],
      ['commerce-directions', 'commerce.compare-hero-directions', '基于同一商品真值形成三个可比较首屏方向', ['create.image', 'iterate.compare']],
      ['commerce-audit', 'commerce.audit-facts', '区分已确认事实、建议值、合规风险与缺失素材', ['story.analyze']],
    ],
    story: [
      ['story-style', 'story.define-style', '补齐可编辑的角色与视觉约束，不启动生成', ['create.story', 'story.analyze']],
      ['story-shots', 'story.plan-shots', '形成可编辑镜头表和分镜预览计划', ['story.analyze', 'story.plan-previews']],
      ['story-missing-assets', 'story.plan-missing-assets', '列出缺失项并保护上传、采用和锁定素材', ['story.analyze', 'story.bind-asset']],
    ],
    'story-idea': [
      ['story-idea-refine', 'story.refine-brief', '只完善当前创意与制作目标，不提前进入剧本', ['create.story']],
      ['story-idea-compare', 'story.compare-directions', '形成三个差异明确的创意方向，不启动生成', ['create.story', 'iterate.compare']],
      ['story-idea-constraints', 'story.complete-constraints', '补齐受众、用途、时长、画幅、风格和边界', ['create.story']],
    ],
    'story-script': [
      ['story-script-draft', 'story.write-script', '使用已确认创意交付完整可编辑剧本', ['create.story', 'create.script']],
      ['story-script-characters', 'story.deepen-characters', '把角色目标、关系与弧光写回具体场景', ['create.story']],
      ['story-script-review', 'story.review-script', '检查场景推进、对白与结尾并交付完整修订稿', ['create.story', 'story.analyze']],
    ],
    'story-assets': [
      ['story-assets-review', 'story.review-assets', '只读核对角色、场景、道具和声音资产，不启动生成', ['story.analyze', 'story.bind-asset']],
      ['story-assets-missing', 'story.plan-missing-assets', '只列出缺失资产，明确保护上传、采用和锁定素材', ['story.analyze', 'story.bind-asset']],
      ['story-assets-to-shots', 'story.prepare-shots', '形成下一阶段的可编辑分镜计划，Provider 调用为 0', ['story.plan-previews']],
    ],
    'story-shots': [
      ['story-shots-review', 'story.review-shots', '逐镜头核对动作、运镜、时长、声音和连续性', ['story.plan-previews']],
      ['story-shots-compile', 'story.compile-prompts', '只编译已确认镜头，不调用图像或视频 Provider', ['story.compile']],
      ['story-shots-continuity', 'story.repair-continuity', '只规划资产和身份冲突的修正范围', ['story.analyze', 'story.bind-asset']],
    ],
    'story-breakdown': [
      ['reference-breakdown-rhythm', 'reference-breakdown.rhythm', '保留同一参考视频，只收窄节奏和剪辑密度分析，不启动媒体生成', ['video.extract-frames', 'story.analyze']],
      ['reference-breakdown-camera', 'reference-breakdown.camera-language', '保留同一参考视频，只收窄景别、运镜和构图规则分析', ['video.extract-frames', 'story.analyze']],
      ['reference-breakdown-continue', 'reference-breakdown.continue-production', '核对真实拉片结果后再规划关键帧与视频链，当前 Provider 调用为 0', ['create.story', 'story.analyze']],
    ],
    'story-candidates': [
      ['story-candidates-compare', 'story.compare-candidates', '只比较真实候选及其来源，不自动采用', ['iterate.compare']],
      ['story-candidates-accept', 'story.accept-and-lock', '采用前仍需明确确认，并锁定连续性约束', ['iterate.accept', 'iterate.lock']],
      ['story-candidates-retry', 'story.retry-failed-only', '只规划失败镜头重试，保留成功产物', ['run.start']],
    ],
    'story-delivery': [
      ['story-delivery-edit', 'story.prepare-edit', '只用已采用片段整理成片顺序、声音层和转场', ['delivery.package']],
      ['story-delivery-qc', 'story.review-qc', '核对真实文件的画质、声音、字幕与可播放性', ['delivery.package']],
      ['story-delivery-package', 'story.prepare-delivery', '准备最终交付清单并保留缺失证据', ['delivery.package']],
    ],
    image: [
      ['image-directions', 'image.compare-directions', '建立三个可比较方向，不覆盖当前采用结果', ['create.image', 'iterate.compare']],
      ['image-refine', 'image.refine-unlocked', '只修改未锁定的画面质量维度', ['edit.image']],
      ['image-to-canvas', 'image.preview-canvas', '先展示 CanvasPatch，再等待明确确认', ['create.image', 'asset.place']],
    ],
    video: [
      ['video-rhythm', 'video.plan-rhythm', '形成镜头和节奏草案，Provider 调用为 0', ['create.video', 'story.plan-previews']],
      ['video-missing', 'video.plan-missing', '保护成功素材，只规划缺失或失败镜头', ['create.video', 'story.plan-previews']],
      ['video-to-canvas', 'video.preview-canvas', '先展示完整变更范围，再等待确认', ['create.video', 'asset.place']],
    ],
    audio: [
      ['audio-layers', 'audio.plan-layers', '生成可编辑声音分层计划', ['create.audio']],
      ['audio-directions', 'audio.compare-directions', '建立三个可比较声音方向', ['create.audio', 'iterate.compare']],
      ['audio-to-canvas', 'audio.preview-canvas', '先预览音频工作流变更', ['create.audio', 'asset.place']],
    ],
    delivery: [
      ['delivery-review', 'delivery.review-manifest', '只读核对精确素材、哈希、大小和许可状态', ['delivery.package']],
      ['delivery-verified-only', 'delivery.package-verified', '只打包通过本地文件与 SHA-256 校验的素材', ['delivery.package']],
      ['delivery-verify', 'delivery.verify-package', '创建后用固定摘要独立复核完整交付包', ['delivery.package']],
    ],
    selection: [
      ['selection-refine', 'selection.refine', '只围绕当前选区形成修改计划', ['edit.image', 'edit.video']],
      ['selection-review', 'selection.review-continuity', '只读检查连续性和锁定项', ['iterate.compare']],
      ['selection-missing', 'selection.plan-missing', '只规划缺失和失败范围', ['story.analyze']],
    ],
    canvas: [
      ['canvas-next', 'canvas.recommend-next', '只读分析当前生产状态', ['story.analyze']],
      ['canvas-organize', 'canvas.organize-production', '形成不覆盖现有素材的工作流计划', ['create.story']],
      ['canvas-gaps', 'canvas.inspect-gaps', '列出缺失项和受保护成果', ['story.analyze']],
    ],
    blank: [
      ['blank-story', 'create.story', '创建本地可编辑计划，当前不写画布', ['create.story']],
      ['blank-script', 'create.script-to-video', '先形成剧本和阶段计划', ['create.script', 'create.story']],
      ['blank-ad', 'create.product-ad', '建立产品广告的可编辑生产计划', ['create.story']],
    ],
  };
  const stageDraftSpecs = {
    idea: ['story-idea-draft', 'story.write-brief', '交付当前阶段可编辑创意简报，不启动生成', ['create.story']],
    script: ['story-script-draft', 'story.write-script', '使用已确认创意交付完整可编辑剧本', ['create.story', 'create.script']],
    assets: ['story-assets-draft', 'story.prepare-assets', '从已确认剧本整理资产与连续性，不启动生成', ['story.analyze', 'story.bind-asset']],
    shots: ['story-shots-draft', 'story.prepare-shots', '从已确认剧本和资产形成镜头表与分镜，不启动生成', ['story.plan-previews']],
    candidates: ['story-candidates-draft', 'story.prepare-candidates', '从已确认分镜形成候选计划，不自动调用 Provider', ['iterate.compare']],
  };
  const stageContinueSpecs = {
    idea: ['story-idea-continue', 'story.confirm-brief-and-continue', '确认当前创意版本，准备画布留存预览，并在写入确认后继续剧本', ['create.story']],
    script: ['story-script-continue', 'story.confirm-script-and-continue', '确认当前剧本版本，准备画布留存预览，并在写入确认后继续资产', ['create.story', 'create.script']],
    assets: ['story-assets-continue', 'story.confirm-assets-and-continue', '确认当前资产版本，准备画布留存预览，并在写入确认后继续分镜', ['story.analyze', 'story.bind-asset']],
    shots: ['story-shots-continue', 'story.confirm-shots-and-continue', '确认当前分镜版本，准备画布留存预览，并在写入确认后继续候选计划', ['story.plan-previews']],
    candidates: ['story-candidates-continue', 'story.confirm-candidates-and-continue', '确认真实采用结果，准备画布留存预览，并在写入确认后继续成片', ['iterate.compare']],
  };
  const preferred = choices.map((choice, index) => {
    if (decisionDriven) {
      const confirmCurrentStage = choice.decision?.decisionAction === 'confirm-stage';
      return {
        id: choice.id,
        label: choice.label,
        description: choice.description,
        intent: choice.intent,
        arguments: {
          preserveAccepted: true,
          planOnly: true,
          creatorPrompt: choice.creatorPrompt,
          creatorKind: choice.creatorKind || creatorPlanKind(plan),
          ...choice.decision,
          ...(confirmCurrentStage ? {
            confirmCurrentStage: true,
            continueToPhase: nextCreatorProductionPhase(decisionDocument.phase),
            requiresCanvasRetentionApply: true,
          } : {}),
        },
        expectedEffect: choice.expectedEffect,
        riskLevel: 'L0-intent',
        requiredCapabilityIds: choice.requiredCapabilityIds,
        disabledReason: '',
      };
    }
    const stageDraftSpec = isStagedProduction
      && index === 0
      && options.stageReadyForConfirmation !== true
      ? stageDraftSpecs[planPhase]
      : null;
    const stageContinueSpec = isStagedProduction
      && index === 0
      && options.stageReadyForConfirmation === true
      ? stageContinueSpecs[planPhase]
      : null;
    const [id, intent, expectedEffect, requiredCapabilityIds] =
      stageContinueSpec || stageDraftSpec || specs[group][index];
    const stageContinuation = isStagedProduction
      && index === 0
      && planPhase !== 'delivery'
      && options.stageReadyForConfirmation === true
      ? {
          confirmCurrentStage: true,
          continueToPhase: nextCreatorProductionPhase(planPhase),
          requiresCanvasRetentionApply: true,
        }
      : {};
    return {
      id,
      label: choice.label,
      description: choice.description,
      intent,
      arguments: {
        preserveAccepted: true,
        planOnly: true,
        creatorPrompt: choice.creatorPrompt,
        creatorKind: choice.creatorKind || creatorPlanKind(plan),
        ...stageContinuation,
      },
      expectedEffect,
      riskLevel: 'L0-intent',
      requiredCapabilityIds,
      disabledReason: '',
    };
  });
  const safeBackfills = [
    {
      id: 'safe-clarify-story',
      label: '先把一句想法整理成可编辑创作目标',
      description: '从一句话里找出人物、冲突和观众最想继续看的问题。',
      creatorPrompt: '把我当前的一句话想法整理成人物、核心冲突和观众悬念，然后只问我下一项最关键的创作决定。',
      creatorKind: 'story',
      intent: 'safe.clarify-story',
      expectedEffect: '只整理目标、受众和限制，不写画布或调用模型',
      requiredCapabilityIds: ['create.story'],
    },
    {
      id: 'safe-review-canvas',
      label: '先检查当前画布，再告诉我最值得做的下一步',
      description: '只找一个最影响作品完整度的问题，避免同时展开太多任务。',
      creatorPrompt: '检查当前画布，只指出最影响作品完整度的一处问题，并给出三个具体可选方向。',
      creatorKind: 'story',
      intent: 'safe.review-canvas',
      expectedEffect: '只读分析画布状态、缺失项和已保护成果',
      requiredCapabilityIds: ['story.analyze'],
    },
    {
      id: 'safe-compare-options',
      label: '先给我 3 个可比较方向，不立即生成',
      description: '三个方向必须有明显差异，并说明各自适合什么效果。',
      creatorPrompt: '围绕当前目标给出三个差异明显、可以直接选择的创作方向，并说明各自的效果与取舍。',
      creatorKind: creatorPlanKind(plan),
      intent: 'safe.compare-options',
      expectedEffect: '只形成候选方向与取舍标准，不启动 Provider',
      requiredCapabilityIds: ['iterate.compare'],
    },
    {
      id: 'safe-script-outline',
      label: '先把需求整理成可修改的剧本提纲',
      description: '先明确开端、转折和结尾，再逐轮补人物与镜头。',
      creatorPrompt: '把当前需求整理成开端、转折和结尾清楚的可修改剧本提纲，然后只问我下一项最关键的创作决定。',
      creatorKind: 'script',
      intent: 'safe.script-outline',
      expectedEffect: '只形成剧本结构和待确认问题',
      requiredCapabilityIds: ['create.script'],
    },
  ].map(({ creatorPrompt, creatorKind, ...item }) => ({
    ...item,
    arguments: {
      preserveAccepted: true,
      planOnly: true,
      creatorPrompt,
      creatorKind,
    },
    riskLevel: 'L0-intent',
    disabledReason: '',
  }));
  const items = (decisionDriven ? preferred : [...preferred, ...safeBackfills])
    .filter((item) => item.requiredCapabilityIds.every((id) => availableCapabilityIds.has(id)))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 3);
  if (items.length !== 3) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_CAPABILITY_GAP',
      '当前创作能力清单不足以提供 3 个可靠建议，已停止展示不可执行入口，请更新应用后重试',
      503,
      { availableCapabilityIds: [...availableCapabilityIds].sort() },
    );
  }
  const referenceContinuation = referenceBreakdownContinuationState(plan);
  const executableItems = items.map((item) => {
    const execution = creatorSuggestionExecution(item, capabilityById);
    const artifactArguments = responseSource?.artifactId ? {
      artifactId: responseSource.artifactId,
      artifactVersionId: responseSource.artifactVersionId,
      artifactDigest: responseSource.artifactDigest,
      expectedDiff: {
        schema: 't8-creator-suggestion-expected-diff-v1',
        baseArtifactId: responseSource.artifactId,
        baseVersionId: responseSource.artifactVersionId,
        baseRevision: responseSource.artifactRevision,
        intent: item.intent,
      },
    } : {};
    const artifactBoundExecution = {
      ...execution,
      arguments: {
        ...execution.arguments,
        ...artifactArguments,
        ...(options.workSnapshot?.workId ? {
          workId: boundedText(options.workSnapshot.workId, 80),
          workRevision: Math.max(1, Math.trunc(Number(options.workSnapshot.revision) || 1)),
          workDigest: boundedText(options.workSnapshot.workDigest, 64).toLowerCase(),
          expectedWorkDiff: {
            schema: 't8-creator-suggestion-work-diff-v1',
            baseWorkId: boundedText(options.workSnapshot.workId, 80),
            baseWorkRevision: Math.max(
              1,
              Math.trunc(Number(options.workSnapshot.revision) || 1),
            ),
            baseWorkDigest: boundedText(options.workSnapshot.workDigest, 64).toLowerCase(),
            intent: item.intent,
          },
        } : {}),
      },
    };
    if (item.intent !== 'reference-breakdown.continue-production'
      || referenceContinuation.ready) return artifactBoundExecution;
    const blocker = {
      code: referenceContinuation.code,
      message: referenceContinuation.message,
    };
    return {
      ...artifactBoundExecution,
      executable: false,
      blockers: [...artifactBoundExecution.blockers, blocker],
      unblockActions: [...artifactBoundExecution.unblockActions, blocker.message],
      disabledReason: blocker.message,
    };
  });
  const binding = creatorSuggestionBinding(context, plan, {
    responseDigest: responseSource?.responseDigest,
    artifactDigest: responseSource?.artifactDigest,
    artifactId: responseSource?.artifactId,
    artifactVersionId: responseSource?.artifactVersionId,
    workId: options.workSnapshot?.workId,
    workRevision: options.workSnapshot?.revision,
    workDigest: options.workSnapshot?.workDigest,
    decisionDocument,
  });
  const suggestionSet = {
    schema: 't8-creator-suggestion-set-v1',
    deterministic: true,
    providerCalls: 0,
    binding,
    ...(responseSource ? { source: responseSource } : {}),
    items: executableItems,
  };
  suggestionSet.setDigest = creatorDigest(creatorSuggestionDigestPayload(suggestionSet));
  suggestionSet.invariantReceipt = creatorSuggestionInvariantReceipt(suggestionSet);
  return suggestionSet;
}

function resolveCreatorSuggestionSelection(session, input = {}) {
  const suggestionId = boundedText(input.suggestionId, 160);
  const suggestionSetDigest = boundedText(input.suggestionSetDigest, 128).toLowerCase();
  const storedSet = session?.suggestionSet;
  if (!suggestionId || !/^[a-f0-9]{64}$/.test(suggestionSetDigest)) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_RECEIPT_REQUIRED',
      '这条建议缺少当前版本回执，请刷新 Agent 建议后再试',
      409,
    );
  }
  if (!storedSet || storedSet.schema !== 't8-creator-suggestion-set-v1'
    || storedSet.setDigest !== suggestionSetDigest) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_STALE',
      '这条建议已经不是当前版本，请使用最新回复下方的建议',
      409,
      { staleFields: ['suggestionSet'] },
    );
  }
  const suggestion = storedSet.items.find((item) => item.id === suggestionId);
  if (!suggestion) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_NOT_FOUND',
      '当前建议中没有这个操作，请使用最新回复下方的建议',
      409,
    );
  }
  const boundArtifactId = boundedText(
    storedSet.binding?.artifactId || storedSet.source?.artifactId,
    80,
  );
  const currentArtifactVersion = boundArtifactId
    ? latestCreatorArtifactVersions(session.creativeArtifactVersions)
      .find((version) => version.artifactId === boundArtifactId) || null
    : null;
  const currentBinding = creatorSuggestionBinding(
    input.context || session.context,
    session.latestPlan,
    {
      responseDigest: storedSet.source?.responseDigest || storedSet.binding?.responseDigest,
      artifactDigest: currentArtifactVersion?.content?.contentDigest
        || (storedSet.source && !boundArtifactId
          ? creatorSuggestionArtifactDigest(session.latestPlan).digest
          : storedSet.binding?.artifactDigest),
      artifactId: currentArtifactVersion?.artifactId || boundArtifactId,
      artifactVersionId: currentArtifactVersion?.versionId
        || storedSet.binding?.artifactVersionId,
      workId: session.creatorWork?.workId || storedSet.binding?.workId,
      workRevision: session.creatorWork?.revision || storedSet.binding?.workRevision,
      workDigest: session.creatorWork?.workDigest || storedSet.binding?.workDigest,
      decisionDocument: session.decisionDocument,
    },
  );
  const productionStageConfirmation = (
    input.bindingScope === 'production-stage-confirmation'
    && suggestion.arguments?.confirmCurrentStage === true
  );
  const liveCanvasOnlyFields = new Set([
    'canvasRevision',
    'contextDigest',
    'assetVersion',
  ]);
  const staleFields = [...new Set([
    ...Object.keys(currentBinding || {}),
    ...Object.keys(storedSet.binding || {}),
  ])].filter((field) => (
    currentBinding?.[field] !== storedSet.binding?.[field]
    && !(productionStageConfirmation && liveCanvasOnlyFields.has(field))
  ));
  if (staleFields.length > 0) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_STALE',
      '画布、选区或素材已经变化，或者本轮创作正文已更新；这条旧建议已停止执行，请使用刚刷新的 3 条建议',
      409,
      { staleFields, currentBinding },
    );
  }
  const availableCapabilityIds = creatorCapabilityIds({
    availableCapabilityIds: input.availableCapabilityIds,
  });
  const missingCapabilityIds = [...new Set(storedSet.items.flatMap((item) => (
    Array.isArray(item?.requiredCapabilityIds) ? item.requiredCapabilityIds : []
  )).filter((capabilityId) => !availableCapabilityIds.has(capabilityId)))];
  if (missingCapabilityIds.length > 0) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_STALE',
      '这条建议依赖的画布能力已经变化，请刷新后使用新的建议',
      409,
      { staleFields: ['capabilities'], missingCapabilityIds },
    );
  }
  if (!suggestion.executable || suggestion.blockers.length > 0) {
    throw new CreatorAgentSessionError(
      'CREATOR_SUGGESTION_BLOCKED',
      suggestion.disabledReason || suggestion.blockers[0]?.message || '当前建议暂时不能执行',
      409,
      { blockers: suggestion.blockers, unblockActions: suggestion.unblockActions },
    );
  }
  return suggestion;
}

function creatorSuggestions(context = {}, plan = null, options = {}) {
  return creatorSuggestionSet(context, plan, options).items.map((item) => item.label);
}

function inferCreatorKind(prompt, attachments = []) {
  const value = boundedText(prompt, 200_000).toLowerCase();
  const kinds = new Set(attachments.map((item) => creatorAttachmentKind(item.kind)));
  if (/(?:打包交付|整理成片|交付包|导出(?:项目|成片|作品|全部素材)|下载(?:成片|作品|全部素材)|package\s+(?:delivery|project)|deliver(?:y)?)/i.test(value)) {
    return 'delivery';
  }
  if (/(?:修改|编辑|重做|替换|擦除|扩图|换背景|edit).{0,20}(?:视频|影片|片段|video)/i.test(value)) return 'edit-video';
  if (/(?:修改|编辑|重做|替换|擦除|扩图|换背景|edit).{0,20}(?:图片|图像|照片|海报|image|photo)/i.test(value)) return 'edit-image';
  if (/(?:剧本|故事|分镜|导演|角色设定|人设|短片|广告片|tvc|mv|storyboard|story|script)/i.test(value)) return 'story';
  if (/(?:视频|影片|动画|运镜|镜头|口型|video|film|motion)/i.test(value)) return kinds.has('video') ? 'edit-video' : 'video';
  if (/(?:音频|音乐|歌曲|配音|旁白|对白|音效|转写|字幕|audio|music|voice|suno|whisper)/i.test(value)) return 'audio';
  if (/(?:图片|图像|照片|海报|插画|封面|画面|image|photo|poster|illustration)/i.test(value)) {
    return kinds.has('image') ? 'edit-image' : 'image';
  }
  if (/(?:文案|台词|对白|文章|文本|copywriting)/i.test(value)) return 'script';
  return 'story';
}

function inferCreatorRecipe(prompt, kind = '', attachments = []) {
  const value = boundedText(prompt, 200_000).toLowerCase();
  const normalizedKind = boundedText(kind, 40).toLowerCase();
  const attachmentKinds = new Set((Array.isArray(attachments) ? attachments : [])
    .map((item) => creatorAttachmentKind(item?.kind)));
  if (/(?:一键)?拉片|拆(?:解|分)(?:这个|这段|参考)?视频|分析(?:这个|这段|参考)?视频(?:的)?(?:镜头|运镜|节奏)/i.test(value)
    || (attachmentKinds.has('video') && /(?:镜头语言|运镜|节奏结构|参考分析)/i.test(value))) {
    return 'shot-breakdown';
  }
  if (/(?:tvc|商业广告|产品广告|品牌广告|广告片|宣传片)/i.test(value)) return 'tvc';
  if (/(?:竖屏短剧|短漫剧|微短剧|短剧)/i.test(value)
    || (normalizedKind === 'story' && /竖屏短片/i.test(value))) return 'short-drama';
  if (/(?:音乐\s*mv|歌曲\s*mv|做(?:成|一个)?\s*mv)/i.test(value)) return 'mv';
  if (/(?:商品图|电商图|产品主视觉|商品主图)/i.test(value)) return 'product';
  if (/(?:角色设定图|人物设定图|人设图|三视图)/i.test(value)) return 'character-sheet';
  if (/(?:导演分镜|镜头表|分镜脚本|故事板|storyboard)/i.test(value)) return 'storyboard';
  if (/(?:知识讲解|科普视频|教程视频)/i.test(value)) return 'education';
  if (/(?:参考改编|参考复刻|只学.*(?:风格|结构|节奏))/i.test(value)) return 'remake';
  return 'general';
}

function normalizeCreativePhase(value, fallback = 'idea') {
  const phase = boundedText(value, 80).toLowerCase();
  if (['delivery', 'export', 'done'].includes(phase)) return 'delivery';
  if (['candidates', 'video', 'edit', 'audio', 'sound', 'generation'].includes(phase)) return 'candidates';
  if (['shots', 'prompts', 'storyboard', 'director'].includes(phase)) return 'shots';
  if (['assets', 'style', 'characters'].includes(phase)) return 'assets';
  if (['script', 'story'].includes(phase)) return 'script';
  if (['idea', 'creative', 'brief'].includes(phase)) return 'idea';
  return boundedText(fallback, 80) || 'idea';
}

function phaseForPlan(plan, fallback = 'idea') {
  if (!plan || typeof plan !== 'object') return normalizeCreativePhase(fallback);
  const action = boundedText(plan.action, 80).toLowerCase();
  if (plan.kind === 'delivery') return 'delivery';
  if (action === 'create.story' || action === 'create.script') return 'script';
  if (action === 'asset.place' || plan.kind === 'asset') return 'assets';
  if (['story.analyze', 'story.import', 'story.bind-asset'].includes(action)) return 'assets';
  if (['story.compile', 'director.materialize'].includes(action)) return 'shots';
  if (['story.plan-previews', 'story.adopt-preview', 'video-edit.compose',
    'review', 'accept', 'lock', 'unlock', 'branch', 'rollback'].includes(action)) {
    return 'candidates';
  }
  if (plan.kind === 'story') {
    return normalizeCreativePhase(plan.analysis?.stage || 'script', fallback);
  }
  if (plan.kind === 'script') return 'script';
  if (['image', 'edit-image', 'video', 'edit-video', 'audio'].includes(plan.kind)) return 'candidates';
  return normalizeCreativePhase(fallback);
}

function normalizeCreatorProductionPhaseList(value) {
  const values = Array.isArray(value) ? value : [];
  return CREATOR_PRODUCTION_PHASES.filter((phase) => (
    values.some((item) => normalizeCreativePhase(item, '__invalid__') === phase)
  ));
}

function normalizeCreatorProductionState(value, fallbackPhase = 'idea') {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const currentPhase = normalizeCreativePhase(input.currentPhase || fallbackPhase, 'idea');
  const completedPhases = normalizeCreatorProductionPhaseList(input.completedPhases);
  const invalidatedPhases = normalizeCreatorProductionPhaseList(input.invalidatedPhases)
    .filter((phase) => !completedPhases.includes(phase));
  const visitedPhases = normalizeCreatorProductionPhaseList([
    ...(Array.isArray(input.visitedPhases) ? input.visitedPhases : []),
    currentPhase,
  ]);
  const blocked = input.blocked && typeof input.blocked === 'object'
    ? {
        phase: normalizeCreativePhase(input.blocked.phase, currentPhase),
        message: boundedText(input.blocked.message, 1_000) || '当前阶段需要补充信息后继续',
        at: boundedText(input.blocked.at, 80) || null,
      }
    : null;
  const checkpoint = input.checkpoint && typeof input.checkpoint === 'object'
    ? {
        type: boundedText(input.checkpoint.type, 80),
        planId: boundedText(input.checkpoint.planId, 160) || null,
        planDigest: boundedText(input.checkpoint.planDigest, 160) || null,
        runId: boundedText(input.checkpoint.runId, 160) || null,
        recordedAt: boundedText(input.checkpoint.recordedAt, 80) || null,
      }
    : null;
  const history = (Array.isArray(input.history) ? input.history : [])
    .slice(-CREATOR_PRODUCTION_MAX_HISTORY)
    .map((item) => {
      const from = normalizeCreativePhase(item?.from, 'idea');
      const to = normalizeCreativePhase(item?.to, from);
      return {
        revision: Math.max(1, Math.trunc(Number(item?.revision) || 1)),
        from,
        to,
        direction: item?.direction === 'revise' ? 'revise' : 'advance',
        reason: boundedText(item?.reason, 240) || '恢复创作阶段',
        completedPhases: normalizeCreatorProductionPhaseList(item?.completedPhases),
        invalidatedPhases: normalizeCreatorProductionPhaseList(item?.invalidatedPhases),
        recordedAt: boundedText(item?.recordedAt, 80) || null,
      };
    });
  return {
    schema: CREATOR_PRODUCTION_STATE_SCHEMA,
    currentPhase,
    revision: Math.max(0, Math.trunc(Number(input.revision) || 0)),
    visitedPhases,
    completedPhases,
    invalidatedPhases,
    blocked,
    checkpoint,
    history,
  };
}

function completedPhasesForPlan(plan) {
  // A plan is an intention, not evidence that any production stage completed.
  return [];
}

function creatorProductionCheckpoint(type, payload = {}, recordedAt = null) {
  return {
    type: boundedText(type, 80),
    planId: boundedText(payload?.planId, 160) || null,
    planDigest: boundedText(payload?.planDigest, 160) || null,
    runId: boundedText(payload?.runId, 160) || null,
    recordedAt: boundedText(recordedAt, 80) || null,
  };
}

function transitionCreatorProduction(session, targetPhase, options = {}) {
  const recordedAt = boundedText(options.recordedAt, 80) || null;
  const current = normalizeCreatorProductionState(session.production, session.phase || 'idea');
  const from = current.currentPhase;
  const to = normalizeCreativePhase(targetPhase, from);
  const fromIndex = CREATOR_PRODUCTION_PHASES.indexOf(from);
  const toIndex = CREATOR_PRODUCTION_PHASES.indexOf(to);
  const hasAuthoritativeCompletion = Array.isArray(options.authoritativeCompletedPhases);
  const completed = new Set(hasAuthoritativeCompletion
    ? normalizeCreatorProductionPhaseList(options.authoritativeCompletedPhases)
    : current.completedPhases);
  const invalidated = new Set(current.invalidatedPhases);
  const explicitCompleted = normalizeCreatorProductionPhaseList(options.completedPhases);

  if (hasAuthoritativeCompletion) {
    for (const phase of current.completedPhases) {
      if (!completed.has(phase)) invalidated.add(phase);
    }
    for (const phase of completed) invalidated.delete(phase);
  }
  for (const phase of explicitCompleted) {
    completed.add(phase);
    invalidated.delete(phase);
  }
  if (toIndex < fromIndex) {
    for (const phase of CREATOR_PRODUCTION_PHASES.slice(toIndex)) {
      if (completed.delete(phase) || current.visitedPhases.includes(phase)) invalidated.add(phase);
    }
  }
  const invalidateFromPhase = options.invalidateFromPhase
    ? normalizeCreativePhase(options.invalidateFromPhase, '__invalid__')
    : '';
  const invalidateFromIndex = CREATOR_PRODUCTION_PHASES.indexOf(invalidateFromPhase);
  if (invalidateFromIndex >= 0) {
    for (const phase of CREATOR_PRODUCTION_PHASES.slice(invalidateFromIndex)) {
      if (completed.delete(phase) || current.visitedPhases.includes(phase)) invalidated.add(phase);
    }
  }
  if (options.completeCurrent === true) {
    completed.add(to);
    invalidated.delete(to);
  }
  const completedPhases = CREATOR_PRODUCTION_PHASES.filter((phase) => completed.has(phase));
  const invalidatedPhases = CREATOR_PRODUCTION_PHASES
    .filter((phase) => invalidated.has(phase) && !completed.has(phase));
  const visitedPhases = CREATOR_PRODUCTION_PHASES.filter((phase) => (
    current.visitedPhases.includes(phase) || phase === to
  ));
  const stateChanged = from !== to
    || completedPhases.join('|') !== current.completedPhases.join('|')
    || invalidatedPhases.join('|') !== current.invalidatedPhases.join('|');
  const revision = current.revision + (stateChanged ? 1 : 0);
  const history = stateChanged
    ? [...current.history, {
        revision,
        from,
        to,
        direction: toIndex < fromIndex ? 'revise' : 'advance',
        reason: boundedText(options.reason, 240) || '创作计划更新',
        completedPhases,
        invalidatedPhases,
        recordedAt,
      }].slice(-CREATOR_PRODUCTION_MAX_HISTORY)
    : current.history;
  session.production = {
    schema: CREATOR_PRODUCTION_STATE_SCHEMA,
    currentPhase: to,
    revision,
    visitedPhases,
    completedPhases,
    invalidatedPhases,
    blocked: options.keepBlocked === true ? current.blocked : null,
    checkpoint: options.checkpoint || current.checkpoint,
    history,
  };
  session.phase = to;
  return session.production;
}

function blockCreatorProduction(session, message, options = {}) {
  const current = normalizeCreatorProductionState(session.production, session.phase || 'idea');
  session.production = {
    ...current,
    blocked: {
      phase: current.currentPhase,
      message: boundedText(message, 1_000) || '当前阶段需要补充信息后继续',
      at: boundedText(options.recordedAt, 80) || null,
    },
    checkpoint: options.checkpoint || current.checkpoint,
  };
  session.phase = current.currentPhase;
  return session.production;
}

function clearCreatorProductionBlock(session, checkpoint = null) {
  const current = normalizeCreatorProductionState(session.production, session.phase || 'idea');
  session.production = {
    ...current,
    blocked: null,
    checkpoint: checkpoint || current.checkpoint,
  };
  session.phase = current.currentPhase;
  return session.production;
}

function normalizeCreatorProductionEvidence(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (input.schema !== 't8-creator-production-evidence-v1'
    || input.source !== 'canonical-canvas-evidence') return null;
  const normalizeCountState = (state) => {
    const item = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    return {
      ready: item.ready === true,
      completed: Math.max(0, Math.min(100_000, Math.trunc(Number(item.completed) || 0))),
      total: Math.max(0, Math.min(100_000, Math.trunc(Number(item.total) || 0))),
    };
  };
  const snapshots = (Array.isArray(input.story?.snapshots) ? input.story.snapshots : [])
    .slice(0, 32)
    .map((snapshot) => ({
      nodeId: boundedText(snapshot?.nodeId, 160),
      storyId: boundedText(snapshot?.storyId, 160),
      stage: boundedText(snapshot?.stage, 40),
      storyRevision: Math.max(0, Math.trunc(Number(snapshot?.storyRevision) || 0)),
      productionRevision: Math.max(0, Math.trunc(Number(snapshot?.productionRevision) || 0)),
      scriptReady: snapshot?.scriptReady === true,
      shotsReady: snapshot?.shotsReady === true,
      assets: normalizeCountState(snapshot?.assets),
      prompts: normalizeCountState(snapshot?.prompts),
      videos: normalizeCountState(snapshot?.videos),
      finalVideoReady: snapshot?.finalVideoReady === true,
    }))
    .filter((snapshot) => snapshot.nodeId);
  return {
    schema: 't8-creator-production-evidence-v1',
    source: 'canonical-canvas-evidence',
    verified: input.verified === true,
    authoritative: input.authoritative === true,
    lifecycleType: boundedText(input.lifecycleType, 40),
    action: boundedText(input.action, 80),
    kind: boundedText(input.kind, 40),
    currentPhase: normalizeCreativePhase(input.currentPhase, 'idea'),
    completedPhases: normalizeCreatorProductionPhaseList(input.completedPhases),
    affectedNodeIds: [...new Set((Array.isArray(input.affectedNodeIds) ? input.affectedNodeIds : [])
      .map((value) => boundedText(value, 160))
      .filter(Boolean))].slice(0, 128),
    canvasRevision: input.canvasRevision != null && Number.isSafeInteger(Number(input.canvasRevision))
      ? Number(input.canvasRevision)
      : null,
    documentVerified: input.documentVerified === true,
    story: {
      verified: input.story?.verified === true,
      nodeIds: [...new Set((Array.isArray(input.story?.nodeIds) ? input.story.nodeIds : [])
        .map((value) => boundedText(value, 160))
        .filter(Boolean))].slice(0, 32),
      scriptReady: input.story?.scriptReady === true,
      assetsReady: input.story?.assetsReady === true,
      promptsReady: input.story?.promptsReady === true,
      videosReady: input.story?.videosReady === true,
      finalVideoReady: input.story?.finalVideoReady === true,
      snapshots,
    },
    candidates: {
      acceptedNodeIds: [...new Set((Array.isArray(input.candidates?.acceptedNodeIds)
        ? input.candidates.acceptedNodeIds : [])
        .map((value) => boundedText(value, 160))
        .filter(Boolean))].slice(0, 128),
      reviewedNodeIds: [...new Set((Array.isArray(input.candidates?.reviewedNodeIds)
        ? input.candidates.reviewedNodeIds : [])
        .map((value) => boundedText(value, 160))
        .filter(Boolean))].slice(0, 128),
      acceptedAndReviewed: input.candidates?.acceptedAndReviewed === true,
    },
  };
}

function normalizeCreatorAgentReadinessReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_AGENT_READINESS_SCHEMA) return null;
  const localPlanMs = Number(value.localPlanMs);
  const targetMs = Number(value.targetMs);
  if (!Number.isFinite(localPlanMs) || localPlanMs < 0
    || targetMs !== CREATOR_AGENT_LOCAL_PLAN_TARGET_MS
    || value.sideEffects?.providerCalls !== 0
    || value.sideEffects?.canvasWrites !== 0
    || value.sideEffects?.productionFileWrites !== 0) return null;
  return {
    schema: CREATOR_AGENT_READINESS_SCHEMA,
    measurement: 'server-monotonic-local-planner',
    localPlanMs: Math.round(localPlanMs * 1_000) / 1_000,
    targetMs: CREATOR_AGENT_LOCAL_PLAN_TARGET_MS,
    withinTarget: localPlanMs <= CREATOR_AGENT_LOCAL_PLAN_TARGET_MS,
    sideEffects: {
      providerCalls: 0,
      canvasWrites: 0,
      productionFileWrites: 0,
    },
  };
}

function normalizeCreatorResponseEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 't8-creator-agent-response-evidence-v1') return null;
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (/api[_-]?key|authorization|bearer\s|sk-[A-Za-z0-9_-]{8,}/i.test(serialized)) return null;
  const providerCalls = Math.max(0, Math.min(8, Math.trunc(Number(value.providerCalls) || 0)));
  const mode = boundedText(value.mode, 40);
  const status = boundedText(value.status, 80);
  if (!['online-model', 'offline-structure', 'offline-fallback', 'media-unavailable']
    .includes(mode) || !status) return null;
  const normalized = {
    schema: 't8-creator-agent-response-evidence-v1',
    mode,
    status,
    providerCalls,
    provider: boundedText(value.provider, 160) || null,
    model: boundedText(value.model, 240) || null,
    finishReason: boundedText(value.finishReason, 120) || null,
    requestId: boundedText(value.requestId, 240) || null,
    errorCode: boundedText(value.errorCode, 120) || null,
    qualityCode: boundedText(value.qualityCode, 120) || null,
    modelDecisionDigest: boundedText(value.modelDecisionDigest, 64).toLowerCase() || null,
  };
  if (Object.prototype.hasOwnProperty.call(value, 'qualityMode')
    || Object.prototype.hasOwnProperty.call(value, 'promptContractDigest')
    || Object.prototype.hasOwnProperty.call(value, 'calls')) {
    normalized.qualityMode = ['quick', 'standard', 'quality'].includes(
      boundedText(value.qualityMode, 32).toLowerCase(),
    ) ? boundedText(value.qualityMode, 32).toLowerCase() : 'quick';
    normalized.promptContractDigest = boundedText(
      value.promptContractDigest,
      64,
    ).toLowerCase() || null;
    normalized.calls = (Array.isArray(value.calls) ? value.calls : []).slice(0, 8)
      .map((call, index) => ({
        index,
        role: boundedText(call?.role, 40) || (index === 0 ? 'draft' : 'refine'),
        status: boundedText(call?.status, 40) || 'completed',
        provider: boundedText(call?.provider, 160) || null,
        model: boundedText(call?.model, 240) || null,
        requestId: boundedText(call?.requestId, 240) || null,
        finishReason: boundedText(call?.finishReason, 120) || null,
        errorCode: boundedText(call?.errorCode, 120) || null,
      }));
  }
  if (value.mediaGrounding && typeof value.mediaGrounding === 'object'
    && !Array.isArray(value.mediaGrounding)) {
    normalized.mediaGrounding = {
      required: value.mediaGrounding.required === true,
      status: boundedText(value.mediaGrounding.status, 40) || null,
      attachmentCount: Math.max(
        0,
        Math.min(24, Math.trunc(Number(value.mediaGrounding.attachmentCount) || 0)),
      ),
      kinds: [...new Set(
        (Array.isArray(value.mediaGrounding.kinds) ? value.mediaGrounding.kinds : [])
          .map((kind) => boundedText(kind, 24).toLowerCase())
          .filter(Boolean),
      )].sort(),
      observationDigest: boundedText(
        value.mediaGrounding.observationDigest,
        64,
      ).toLowerCase() || null,
    };
  }
  const evidenceDigest = boundedText(value.evidenceDigest, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(evidenceDigest)
    || evidenceDigest !== creatorDigest(normalized)) return null;
  return { ...normalized, evidenceDigest };
}
function assistantMessageForPlan(plan, context = {}) {
  if (!plan?.ready) {
    const question = plan?.questions?.[0]?.question || '还需要补充一个关键创作条件。';
    return question;
  }
  const normalized = normalizeContext(context);
  const focus = creatorContextFocusForPlan(normalized, plan);
  const focusKind = focus ? creatorFocusKind(focus, plan) : '';
  const goal = creatorPlanGoal(plan);
  const excerpt = creatorGoalExcerpt(plan, 92);
  if (focusKind === 'loop') {
    return '我看到你正在处理一批内容。先只确定每条内容与参考素材怎么配对，避免多条提示词被合并到同一次生成。\n\n请选择一种分配方式，也可以直接写你的规则。';
  }
  if (focusKind === 'image') {
    return creatorImageQuestion(plan)
      || '先不同时改所有细节。请选择这张图最需要优先解决的一件事；你也可以直接写要保留和要修改的部分。';
  }
  if (focusKind === 'video') {
    return creatorVideoQuestion(plan)
      || '先确定这段视频最需要优先改善的是表演、镜头还是节奏。请选择一个方向，也可以直接描述你不满意的具体时间段。';
  }
  if (focusKind === 'audio') {
    return '先确定声音最需要优先改善的是对白、环境层次还是音乐节奏。请选择一个方向，也可以直接写你的处理要求。';
  }
  if (plan.kind === 'delivery') {
    return '交付前先确认范围。你想先核对全部内容、只打包验证通过的素材，还是创建后再做一次完整校验？';
  }
  if (plan.kind === 'story' || plan.kind === 'script') {
    if (/故事收束确定为|无法挽回的代价|带着裂痕继续|真正的背叛者/u.test(goal)) {
      return '故事的关系、爆点、升级和收束已经连成一条线。下一步决定把它整理成什么可编辑成果。\n\n请选择短片提纲、角色设定或分镜，也可以直接指定格式和时长。';
    }
    if (/故事推进方式确定为|当众决裂|私下交易|被迫再次合作/u.test(goal)) {
      return '这场戏的冲突已经能拍出来了。下一步只决定它最终留下什么代价。\n\n请选择一种收束，也可以直接写你想要的结局。';
    }
    if (/关系爆点确定为|共同秘密被揭开|现实目标突然对立|必须做出背叛/u.test(goal)) {
      return '关系已经被推到临界点。下一步只决定它如何升级成一场能拍出来的戏。\n\n请选择一种推进方式，或直接写你想发生的事件。';
    }
    if (/故事核心关系确定为|爱着，却|最亲的人|必须并肩/u.test(goal)) {
      return '核心关系成立了。下一步只决定：什么事件会让这段关系再也无法维持原样？\n\n请选择一个爆点，或直接写你的版本。';
    }
    if (/从人物关系开始|人物关系作为起点|角色或关系|两个人的关系|人物之间的关系|确定.{0,8}关系/u.test(goal)) {
      return '好，我们先从人物关系开工。暂时不展开分镜和生成，先把最能撑起故事的关系定下来。\n\n请选择最接近的一种，也可以自己写两个人是谁、彼此想要什么。';
    }
    if (/从一个画面开始|画面或氛围|画面氛围/u.test(goal)) {
      return '好，我们从一个强画面开工。先选能立刻看见人物处境和情绪的场景，后面再从画面倒推故事。\n\n请选择一个画面，或直接描述你脑中的画面。';
    }
    if (/从故事设定开始|世界设定|故事设定/u.test(goal)) {
      return '好，我们从故事设定开工。先确定一条会持续制造冲突的世界规则，再围绕它建立人物。\n\n请选择一个设定，或直接写你的“如果……会怎样”。';
    }
    if (!goal || goal.length < 36 || /(?:一个)?创意(?:想法)?|还没想好|不知道做什么/u.test(goal.toLowerCase())) {
      return '可以。先不急着把整部作品一次想完，我们只选一个最容易开工的入口。\n\n你更接近一个故事设定、一个画面，还是一段人物关系？也可以直接写你的想法。';
    }
    return `我抓到这次创作的核心是“${excerpt}”。下一步只决定用什么力量推动它持续向前。\n\n请选择一个方向，或直接改成你的版本。`;
  }
  if (plan.kind === 'image' || plan.kind === 'edit-image') {
    const nextQuestion = creatorImageQuestion(plan);
    if (nextQuestion) return nextQuestion;
    return `这张图的目标是“${excerpt || '完成当前画面'}”。先只确定主攻方向：构图、人景融合，还是质感细节？也可以直接写你要保留和修改的内容。`;
  }
  if (plan.kind === 'video' || plan.kind === 'edit-video') {
    const nextQuestion = creatorVideoQuestion(plan);
    if (nextQuestion) return nextQuestion;
    return `这段视频的目标是“${excerpt || '完成当前镜头'}”。先只确定主攻方向：表演、镜头层次，还是节奏张力？也可以直接写你的镜头要求。`;
  }
  if (plan.kind === 'audio') {
    return `这段声音的目标是“${excerpt || '完成当前声音设计'}”。先只确定主攻方向：对白、环境音，还是音乐节奏？也可以直接写你想听到的感觉。`;
  }
  return `我已经理解“${excerpt || '当前创作目标'}”。请选择一个明确方向继续，或直接写你的修改意见。`;
}

function creatorResponseChunks(value, maximum = CREATOR_AGENT_REPLAY_RESPONSE_CHUNKS) {
  const characters = Array.from(boundedText(value, 8_000));
  if (!characters.length) return [];
  const limit = Math.max(1, Math.min(
    CREATOR_AGENT_REPLAY_RESPONSE_CHUNKS,
    Math.trunc(Number(maximum) || CREATOR_AGENT_REPLAY_RESPONSE_CHUNKS),
  ));
  const desired = Math.max(1, Math.min(limit, Math.ceil(characters.length / 24)));
  const targetSize = Math.max(1, Math.ceil(characters.length / desired));
  const chunks = [];
  for (let offset = 0; offset < characters.length; offset += targetSize) {
    chunks.push(characters.slice(offset, offset + targetSize).join(''));
  }
  return chunks;
}

function atomicWriteJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, filename);
}

function safeSessionId(value) {
  const id = boundedText(value, 80);
  const isUuid = /^[a-f0-9-]{36}$/i.test(id);
  const isCliSession = /^cs_[A-Za-z0-9_-]{12,64}$/.test(id);
  if (!isUuid && !isCliSession) {
    throw new CreatorAgentSessionError('CREATOR_SESSION_ID_INVALID', '创作会话 ID 无效');
  }
  return isUuid ? id.toLowerCase() : id;
}

function createCreatorAgentSessionStore(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), 'data', 'creator-agent'));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomUUID = typeof options.randomUUID === 'function' ? options.randomUUID : () => crypto.randomUUID();

  function pathsFor(sessionId) {
    const id = safeSessionId(sessionId);
    return {
      snapshot: path.join(rootDir, 'sessions', `${id}.json`),
      events: path.join(rootDir, 'events', `${id}.jsonl`),
    };
  }

  function withSessionLock(sessionId, purpose, action) {
    const id = safeSessionId(sessionId);
    const lockDir = path.join(rootDir, 'locks');
    const lockPath = path.join(lockDir, `${id}.${boundedText(purpose, 40) || 'write'}.lock`);
    fs.mkdirSync(lockDir, { recursive: true });
    let handle = null;
    for (let attempt = 0; attempt < 250 && handle === null; attempt += 1) {
      try {
        handle = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 30_000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch (statError) {
          if (statError?.code !== 'ENOENT') throw statError;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8);
      }
    }
    if (handle === null) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_BUSY',
        '创作会话正在由另一个本地进程更新，请稍后重试',
        409,
      );
    }
    try {
      return action();
    } finally {
      try { fs.closeSync(handle); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }

  function read(sessionId) {
    const id = safeSessionId(sessionId);
    const locations = pathsFor(id);
    if (!fs.existsSync(locations.snapshot)) {
      throw new CreatorAgentSessionError('CREATOR_SESSION_NOT_FOUND', '创作会话不存在', 404);
    }
    let session;
    try {
      session = JSON.parse(fs.readFileSync(locations.snapshot, 'utf8'));
    } catch {
      throw new CreatorAgentSessionError('CREATOR_SESSION_CORRUPT', '创作会话记录损坏，已停止继续写入', 500);
    }
    if (session?.schema !== CREATOR_AGENT_SESSION_SCHEMA || session?.id !== id) {
      throw new CreatorAgentSessionError('CREATOR_SESSION_CORRUPT', '创作会话结构不匹配，已停止继续写入', 500);
    }
    if (!Array.isArray(session.runLinks)) session.runLinks = [];
    if (!Array.isArray(session.artifactVerifications)) session.artifactVerifications = [];
    session.creativeArtifactVersions = normalizeCreatorArtifactVersions(
      session.creativeArtifactVersions,
    );
    session.creativeArtifacts = creatorArtifactSummaries(session.creativeArtifactVersions);
    const rawWorkVersions = Array.isArray(session.workArtifactVersions)
      ? session.workArtifactVersions : [];
    session.workArtifactVersions = normalizeWorkArtifactVersions(rawWorkVersions);
    if (rawWorkVersions.length !== session.workArtifactVersions.length) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_WORK_ARTIFACTS_CORRUPT',
        '创作会话中的作品版本无法完整验证，已停止继续使用',
        500,
      );
    }
    session.workArtifacts = workArtifactSummaries(session.workArtifactVersions);
    const rawWorkSnapshot = session.creatorWork;
    session.creatorWork = rawWorkSnapshot == null
      ? null : normalizeCreatorWorkSnapshot(rawWorkSnapshot);
    if (rawWorkSnapshot != null && !session.creatorWork) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_WORK_SNAPSHOT_CORRUPT',
        '创作会话中的作品快照无法验证，已停止继续使用',
        500,
      );
    }
    const rawLlmReceipts = Array.isArray(session.creatorLlmTurnReceipts)
      ? session.creatorLlmTurnReceipts : [];
    session.creatorLlmTurnReceipts = rawLlmReceipts
      .slice(-240)
      .map(normalizeCreatorLlmTurnReceipt)
      .filter(Boolean);
    if (rawLlmReceipts.length !== session.creatorLlmTurnReceipts.length) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_LLM_RECEIPTS_CORRUPT',
        '创作会话中的模型调用回执无法完整验证，已停止继续使用',
        500,
      );
    }
    const rawDecisionDocument = session.decisionDocument;
    session.decisionDocument = rawDecisionDocument == null
      ? null
      : normalizeCreatorDecisionDocument(rawDecisionDocument);
    if (rawDecisionDocument != null && !session.decisionDocument) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_DECISION_DOCUMENT_CORRUPT',
        '创作会话中的决策版本无法验证，已停止继续使用',
        500,
      );
    }
    const rawDecisionVersions = Array.isArray(session.decisionDocumentVersions)
      ? session.decisionDocumentVersions
      : [];
    const normalizedDecisionVersions = normalizeCreatorDecisionDocumentVersions(
      rawDecisionVersions,
    );
    if (rawDecisionVersions.length !== normalizedDecisionVersions.length) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_DECISION_HISTORY_CORRUPT',
        '创作会话中的决策历史无法完整验证，已停止继续使用',
        500,
      );
    }
    session.decisionDocumentVersions = normalizedDecisionVersions;
    try {
      session.toolProposals = (Array.isArray(session.toolProposals)
        ? session.toolProposals : [])
        .slice(-100)
        .map((proposal) => validateStoredCreatorToolProposal(proposal));
    } catch (error) {
      if (error instanceof CreatorAgentToolProposalError) {
        throw new CreatorAgentSessionError(
          'CREATOR_SESSION_TOOL_PROPOSALS_CORRUPT',
          '创作会话中的工具提议记录无法验证，已停止继续使用',
          500,
        );
      }
      throw error;
    }
    if (!session.runEventCursors || typeof session.runEventCursors !== 'object'
      || Array.isArray(session.runEventCursors)) session.runEventCursors = {};
    session.runEventCursors = Object.fromEntries(Object.entries(session.runEventCursors)
      .map(([runId, cursor]) => [boundedText(runId, 160), Number(cursor)])
      .filter(([runId, cursor]) => runId
        && Number.isSafeInteger(cursor) && cursor >= 0));
    session.production = normalizeCreatorProductionState(session.production, session.phase || 'idea');
    session.phase = session.production.currentPhase;
    session.productionDocumentConfirmations = normalizeProductionDocumentConfirmations(
      session.productionDocumentConfirmations);
    if (!Array.isArray(session.deliveryEvidence)) session.deliveryEvidence = [];
    if (!Array.isArray(session.events)) session.events = [];
    return validateCreatorSuggestionPersistence(session);
  }

  function appendEvent(session, type, payload = {}) {
    const locations = pathsFor(session.id);
    const sequence = Number(session.lastSequence || 0) + 1;
    const event = {
      schema: CREATOR_AGENT_EVENT_SCHEMA,
      eventId: randomUUID(),
      sessionId: session.id,
      sequence,
      type: boundedText(type, 80),
      payload,
      createdAt: new Date(now()).toISOString(),
    };
    fs.mkdirSync(path.dirname(locations.events), { recursive: true });
    fs.appendFileSync(locations.events, `${JSON.stringify(event)}\n`, 'utf8');
    session.lastSequence = sequence;
    session.updatedAt = event.createdAt;
    session.events = [...(Array.isArray(session.events) ? session.events : []), event]
      .slice(-CREATOR_AGENT_MAX_EVENTS);
    atomicWriteJson(locations.snapshot, session);
    return event;
  }

  function reconcileToolProposalExecutionWritebacks(session) {
    const events = Array.isArray(session.events) ? session.events : [];
    const preparedEvents = events.filter((event) => (
      event?.type === 'assistant.tool-proposal.prepared'
      && boundedText(event?.payload?.proposalId, 80)
      && boundedText(event?.payload?.proposalDigest, 64)
      && boundedText(event?.payload?.planId, 160)
    ));
    let repaired = 0;

    for (const prepared of preparedEvents) {
      const proposalId = boundedText(prepared.payload?.proposalId, 80);
      const proposalDigest = boundedText(prepared.payload?.proposalDigest, 64).toLowerCase();
      const planId = boundedText(prepared.payload?.planId, 160);
      const planApplied = [...events].reverse().find((event) => (
        event?.type === 'plan.applied'
        && boundedText(event?.payload?.planId, 160) === planId
      ));
      const links = (Array.isArray(session.runLinks) ? session.runLinks : [])
        .filter((link) => boundedText(link?.planId, 160) === planId);
      const verifications = links
        .map((link) => (Array.isArray(session.artifactVerifications)
          ? session.artifactVerifications : []).find((verification) => (
          boundedText(verification?.runId, 160) === boundedText(link?.runId, 160)
        )))
        .filter(Boolean)
        .sort((left, right) => String(left?.verifiedAt || '').localeCompare(String(right?.verifiedAt || '')));
      const verification = verifications.at(-1) || null;
      const link = verification
        ? links.find((item) => boundedText(item?.runId, 160) === boundedText(verification?.runId, 160))
        : links.at(-1) || null;
      const writebacks = events.filter((event) => (
        event?.type === 'assistant.tool-proposal.writeback'
        && event?.payload?.proposalId === proposalId
        && event?.payload?.proposalDigest === proposalDigest
        && event?.payload?.planId === planId
      ));
      const priorEvidence = writebacks.reduce((evidence, event) => ({
        canvasWriteRecorded: evidence.canvasWriteRecorded
          || event?.payload?.evidence?.canvasWriteRecorded === true,
        providerRunLinked: evidence.providerRunLinked
          || event?.payload?.evidence?.providerRunLinked === true,
      }), { canvasWriteRecorded: false, providerRunLinked: false });
      const stage = verification
        ? verification.verified === true ? 'verified' : 'verification-failed'
        : link
          ? 'running'
          : planApplied
            ? 'applied'
            : '';
      if (!stage) continue;

      const expectedEvidence = {
        canvasWriteRecorded: Boolean(planApplied) || priorEvidence.canvasWriteRecorded,
        providerRunLinked: Boolean(link) || priorEvidence.providerRunLinked,
        physicalArtifactsVerified: stage === 'verified',
      };
      const runId = boundedText(verification?.runId || link?.runId, 160) || null;
      const latestWriteback = writebacks.at(-1) || null;
      const currentEvidence = latestWriteback?.payload?.evidence || {};
      const alreadyCurrent = latestWriteback?.payload?.stage === stage
        && (latestWriteback?.payload?.runId || null) === runId
        && currentEvidence.canvasWriteRecorded === expectedEvidence.canvasWriteRecorded
        && currentEvidence.providerRunLinked === expectedEvidence.providerRunLinked
        && currentEvidence.physicalArtifactsVerified === expectedEvidence.physicalArtifactsVerified;
      if (alreadyCurrent) continue;

      appendEvent(session, 'assistant.tool-proposal.writeback', {
        schema: 't8-creator-tool-proposal-execution-v1',
        proposalId,
        proposalDigest,
        planId,
        planDigest: boundedText(prepared.payload?.planDigest, 160),
        workId: boundedText(prepared.payload?.workId, 80) || null,
        workRevision: Number.isSafeInteger(Number(prepared.payload?.workRevision))
          ? Number(prepared.payload.workRevision) : null,
        workDigest: boundedText(prepared.payload?.workDigest, 64).toLowerCase() || null,
        requestedOperation: boundedText(prepared.payload?.requestedOperation, 40),
        capabilityId: boundedText(prepared.payload?.capabilityId, 160),
        stage,
        evidenceEventType: 'execution.reconciled',
        runId,
        evidenceDigest: boundedText(
          verification?.verificationDigest || link?.bindingDigest || planApplied?.payload?.bindingDigest,
          160,
        ) || null,
        evidence: expectedEvidence,
        reconciliation: {
          schema: 't8-creator-tool-proposal-writeback-reconciliation-v1',
          reason: 'cumulative-evidence-repair',
          previousWritebackSequence: Number.isSafeInteger(Number(latestWriteback?.sequence))
            ? Number(latestWriteback.sequence) : null,
        },
      });
      repaired += 1;
    }
    return repaired;
  }

  function reconcileToolProposalWritebacks(sessionId) {
    return withSessionLock(sessionId, 'tool-proposal-writebacks', () => {
      const session = read(sessionId);
      const repaired = reconcileToolProposalExecutionWritebacks(session);
      return { session: read(session.id), repaired };
    });
  }

  function eventsAfter(sessionId, afterSequence = 0, limit = 200) {
    const session = read(sessionId);
    const locations = pathsFor(session.id);
    if (!fs.existsSync(locations.events)) return { events: [], cursorReset: false };
    const stat = fs.statSync(locations.events);
    const bytes = Math.min(stat.size, CREATOR_AGENT_EVENT_TAIL_BYTES);
    const start = Math.max(0, stat.size - bytes);
    const buffer = Buffer.alloc(bytes);
    const handle = fs.openSync(locations.events, 'r');
    try {
      fs.readSync(handle, buffer, 0, bytes, start);
    } finally {
      fs.closeSync(handle);
    }
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstLineBreak = text.indexOf('\n');
      text = firstLineBreak >= 0 ? text.slice(firstLineBreak + 1) : '';
    }
    const parsed = text.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((event) => event?.schema === CREATOR_AGENT_EVENT_SCHEMA
        && event.sessionId === session.id
        && Number.isInteger(Number(event.sequence)));
    validateCreatorSuggestionPersistence(session, parsed);
    const after = Math.max(0, Math.trunc(Number(afterSequence) || 0));
    const maximum = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 200)));
    const firstSequence = Number(parsed[0]?.sequence || 0);
    return {
      events: parsed.filter((event) => Number(event.sequence) > after).slice(0, maximum),
      cursorReset: Boolean(after > 0 && firstSequence > after + 1),
    };
  }

  function list(input = {}) {
    const projectId = boundedText(input.projectId, 160);
    const canvasId = boundedText(input.canvasId, 160);
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit) || 20)));
    const directory = path.join(rootDir, 'sessions');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .slice(0, 500)
      .map((entry) => entry.name.slice(0, -5))
      .filter((id) => /^[a-f0-9-]{36}$/i.test(id) || /^cs_[A-Za-z0-9_-]{12,64}$/.test(id))
      .map((id) => {
        try { return read(id); } catch { return null; }
      })
      .filter((session) => session
        && (!projectId || session.projectId === projectId)
        && (!canvasId || session.canvasId === canvasId))
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .slice(0, limit);
  }

  function readPersistedSessionEvents(sessionId) {
    const id = safeSessionId(sessionId);
    const locations = pathsFor(id);
    if (!fs.existsSync(locations.events)) return [];
    return fs.readFileSync(locations.events, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((event) => event?.schema === CREATOR_AGENT_EVENT_SCHEMA
        && event.sessionId === id
        && Number.isSafeInteger(Number(event.sequence))
        && Number(event.sequence) > 0)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  }

  function ensureSessionCreatedEvidence(session) {
    const locations = pathsFor(session.id);
    const persisted = readPersistedSessionEvents(session.id);
    const persistedCreated = persisted.find((event) => event.type === 'session.created');
    const snapshotCreated = (Array.isArray(session.events) ? session.events : [])
      .find((event) => event?.schema === CREATOR_AGENT_EVENT_SCHEMA
        && event.sessionId === session.id
        && event.type === 'session.created'
        && Number.isSafeInteger(Number(event.sequence))
        && Number(event.sequence) > 0);

    if (persistedCreated) {
      const merged = [...persisted];
      const recentPersisted = merged.slice(-CREATOR_AGENT_MAX_EVENTS);
      session.lastSequence = Math.max(
        Number(session.lastSequence || 0),
        ...persisted.map((event) => Number(event.sequence)),
      );
      session.updatedAt = persisted[persisted.length - 1]?.createdAt
        || persistedCreated.createdAt
        || session.updatedAt;
      session.events = recentPersisted;
      atomicWriteJson(locations.snapshot, session);
      return persistedCreated;
    }

    if (snapshotCreated) {
      if (persisted.length > 0) {
        throw new CreatorAgentSessionError(
          'CREATOR_SESSION_CORRUPT',
          '创作会话创建记录不完整，已停止继续写入',
          500,
        );
      }
      fs.mkdirSync(path.dirname(locations.events), { recursive: true });
      fs.writeFileSync(locations.events, `${JSON.stringify(snapshotCreated)}\n`, 'utf8');
      session.lastSequence = Math.max(Number(session.lastSequence || 0), Number(snapshotCreated.sequence));
      session.events = [snapshotCreated];
      session.updatedAt = snapshotCreated.createdAt || session.updatedAt;
      atomicWriteJson(locations.snapshot, session);
      return snapshotCreated;
    }

    if (persisted.length > 0) {
      throw new CreatorAgentSessionError(
        'CREATOR_SESSION_CORRUPT',
        '创作会话缺少创建记录，已停止继续写入',
        500,
      );
    }

    if (fs.existsSync(locations.events) && fs.statSync(locations.events).size > 0) {
      fs.writeFileSync(locations.events, '', 'utf8');
    }
    return appendEvent(session, 'session.created', {
      projectId: session.projectId,
      canvasId: session.canvasId,
      context: session.context,
      suggestions: session.suggestions,
    });
  }

  function create(input = {}) {
    const requestedId = boundedText(input.sessionId || input.id, 80);
    const id = requestedId ? safeSessionId(requestedId) : randomUUID().toLowerCase();
    return withSessionLock(id, 'create', () => {
      if (fs.existsSync(pathsFor(id).snapshot)) {
        const existing = read(id);
        if (boundedText(input.projectId, 160) !== existing.projectId
          || boundedText(input.canvasId, 160) !== existing.canvasId) {
          throw new CreatorAgentSessionError(
            'CREATOR_SESSION_SCOPE_MISMATCH',
            '这个创作会话不属于当前项目或画布',
            409,
          );
        }
        ensureSessionCreatedEvidence(existing);
        return read(id);
      }
      const createdAt = new Date(now()).toISOString();
      const context = normalizeContext({
        ...(input.context && typeof input.context === 'object' && !Array.isArray(input.context)
          ? input.context
          : {}),
        phase: 'idea',
        recentActions: [],
      });
      const suggestionSet = creatorSuggestionSet(context);
      const session = {
        schema: CREATOR_AGENT_SESSION_SCHEMA,
        id,
        projectId: boundedText(input.projectId, 160),
        canvasId: boundedText(input.canvasId, 160),
        title: boundedText(input.title, 160) || '新的创作',
        status: 'active',
        phase: 'idea',
        source: boundedText(input.source, 40) || 'canvas-ui',
        context,
        production: normalizeCreatorProductionState({ currentPhase: 'idea' }, 'idea'),
        suggestions: suggestionSet.items.map((item) => item.label),
        suggestionSet,
        events: [],
        runLinks: [],
        runEventCursors: {},
        artifactVerifications: [],
        creativeArtifactVersions: [],
        creativeArtifacts: [],
        workArtifactVersions: [],
        workArtifacts: [],
        creatorWork: null,
        creatorLlmTurnReceipts: [],
        decisionDocument: null,
        decisionDocumentVersions: [],
        toolProposals: [],
        deliveryEvidence: [],
        lastSequence: 0,
        productionDocumentConfirmations: [],
        latestPlan: null,
        latestPatch: null,
        createdAt,
        updatedAt: createdAt,
      };
      atomicWriteJson(pathsFor(id).snapshot, session);
      ensureSessionCreatedEvidence(session);
      return read(id);
    });
  }

  function compileTurnArtifact(
    session,
    input,
    responseId,
    responseText,
    responseDigest,
    responseEvidence,
  ) {
    if (input.artifactProposal == null) return null;
    const compilation = compileCreatorArtifactVersion({
      sessionId: session.id,
      responseId,
      responseDigest,
      responseText,
      responseEvidence,
      proposal: input.artifactProposal,
      existingVersions: session.creativeArtifactVersions,
      planDigest: input.plan?.planDigest,
      createdAt: new Date(now()).toISOString(),
    });
    const artifactVersion = compilation?.artifactVersion || null;
    if (artifactVersion && compilation.status === 'created') {
      const existingVersionIds = new Set((session.creativeArtifactVersions || [])
        .map((version) => version.versionId));
      if (!existingVersionIds.has(artifactVersion.versionId)) {
        session.creativeArtifactVersions = normalizeCreatorArtifactVersions([
          ...(session.creativeArtifactVersions || []),
          artifactVersion,
        ]);
      }
    }
    session.creativeArtifacts = creatorArtifactSummaries(session.creativeArtifactVersions);
    return compilation;
  }

  function compileTurnWork(
    session,
    input,
    responseId,
    responseEvidence,
  ) {
    const providerCalls = Math.max(
      0,
      Math.trunc(Number(responseEvidence?.providerCalls) || 0),
    );
    if (providerCalls < 1 && input.workProposal == null) return null;
    const createdAt = new Date(now()).toISOString();
    const logicalRequestId = boundedText(input.clientRequestId, 160)
      || `legacy_${creatorDigest({ sessionId: session.id, responseId }).slice(0, 32)}`;
    const inputBindings = (Array.isArray(input.attachments) ? input.attachments : []).map((attachment) => ({
      assetId: attachment?.assetId || null,
      contentRevision: attachment?.contentRevision || 0,
      contentHash: attachment?.contentHash || null,
      kind: attachment?.kind || 'file',
      mimeType: attachment?.mimeType || null,
      observationDigest: attachment?.observationDigest
        || responseEvidence?.mediaGrounding?.observationDigest
        || null,
    }));
    const invocationReceipt = createCreatorLlmTurnReceipt({
      sessionId: session.id,
      responseId,
      logicalRequestId,
      phase: 'invocation',
      qualityMode: responseEvidence?.qualityMode || input.qualityMode || 'quick',
      responseEvidence,
      workProposalDigest: input.workProposal?.proposalDigest,
      inputBindings,
      createdAt,
    });
    const normalizedInvocationReceipt = normalizeCreatorLlmTurnReceipt(invocationReceipt);
    if (!normalizedInvocationReceipt) {
      throw new CreatorAgentSessionError(
        'CREATOR_LLM_TURN_RECEIPT_INVALID',
        '本轮模型调用回执无法验证，已拒绝写入正式作品',
        409,
      );
    }
    if (!(session.creatorLlmTurnReceipts || []).some(
      (receipt) => receipt.receiptDigest === normalizedInvocationReceipt.receiptDigest,
    )) {
      session.creatorLlmTurnReceipts = [
        ...(session.creatorLlmTurnReceipts || []),
        normalizedInvocationReceipt,
      ].slice(-240);
    }
    if (input.workProposal == null) {
      return { turnReceipt: normalizedInvocationReceipt, compilation: null };
    }
    const compilation = compileCreatorWorkProposal({
      sessionId: session.id,
      responseId,
      logicalRequestId,
      llmTurnReceiptDigest: normalizedInvocationReceipt.receiptDigest,
      responseEvidence,
      proposal: input.workProposal,
      existingVersions: session.workArtifactVersions,
      existingSnapshot: session.creatorWork,
      mutationScope: creatorWorkMutationScope(input.text, session.workArtifactVersions),
      createdAt,
    });
    if (compilation.status !== 'created' && compilation.status !== 'reused') {
      const messages = {
        'formal-work-requires-llm': '正式作品必须来自本轮真实语言模型调用',
        'work-field-locked': '模型尝试修改已锁定字段，作品版本已拒绝写入',
        'work-mutation-out-of-scope': '模型修改超出本轮明确范围，作品版本已拒绝写入',
        'work-dependency-invalid': '作品依赖关系无效，已拒绝写入',
        'work-proposal-invalid': '模型作品结构未通过校验，已拒绝写入',
      };
      throw new CreatorAgentSessionError(
        String(compilation.code || 'CREATOR_WORK_COMPILATION_BLOCKED')
          .toUpperCase().replace(/-/g, '_'),
        messages[compilation.code] || '结构化作品未通过安全校验，已拒绝写入',
        409,
        {
          blockedArtifactId: compilation.blockedArtifactId || null,
          blockedPath: compilation.blockedPath || null,
        },
      );
    }
    if (compilation.status === 'created' || compilation.status === 'reused') {
      session.workArtifactVersions = normalizeWorkArtifactVersions(compilation.versions);
      session.workArtifacts = workArtifactSummaries(session.workArtifactVersions);
      session.creatorWork = normalizeCreatorWorkSnapshot(compilation.snapshot);
      if (!session.creatorWork) {
        throw new CreatorAgentSessionError(
          'CREATOR_WORK_SNAPSHOT_INVALID',
          '结构化作品已拒绝：作品快照校验失败',
          409,
        );
      }
    }
    const proposalKinds = new Set((Array.isArray(input.workProposal?.artifacts)
      ? input.workProposal.artifacts : []).map((artifact) => artifact?.kind).filter(Boolean));
    const boundVersions = (Array.isArray(compilation.createdVersions)
      && compilation.createdVersions.length > 0)
      ? compilation.createdVersions
      : latestWorkArtifactVersions(compilation.versions)
        .filter((version) => proposalKinds.has(version.kind));
    const compiledReceipt = createCreatorLlmTurnReceipt({
      sessionId: session.id,
      responseId,
      logicalRequestId,
      phase: 'compiled',
      qualityMode: responseEvidence?.qualityMode || input.qualityMode || 'quick',
      responseEvidence,
      workProposalDigest: input.workProposal?.proposalDigest,
      invocationReceiptDigest: normalizedInvocationReceipt.receiptDigest,
      inputBindings,
      artifactBindings: boundVersions.map((version) => ({
        artifactId: version.artifactId,
        kind: version.kind,
        baseVersionId: version.diff?.baseVersionId || null,
        newVersionId: version.versionId,
        diffDigest: creatorDigest(version.diff),
      })),
      workSnapshotDigest: session.creatorWork?.workDigest || null,
      createdAt,
    });
    const normalizedCompiledReceipt = normalizeCreatorLlmTurnReceipt(compiledReceipt);
    if (!normalizedCompiledReceipt) {
      throw new CreatorAgentSessionError(
        'CREATOR_LLM_TURN_RECEIPT_INVALID',
        '作品版本与模型回执无法建立完整绑定，已拒绝写入正式作品',
        409,
      );
    }
    if (!(session.creatorLlmTurnReceipts || []).some(
      (receipt) => receipt.receiptDigest === normalizedCompiledReceipt.receiptDigest,
    )) {
      session.creatorLlmTurnReceipts = [
        ...(session.creatorLlmTurnReceipts || []),
        normalizedCompiledReceipt,
      ].slice(-240);
    }
    return {
      turnReceipt: normalizedCompiledReceipt,
      invocationReceipt: normalizedInvocationReceipt,
      compilation,
    };
  }

  function applyPlanState(session, input, context) {
    if (input.decisionTurn?.document) {
      storeCreatorDecisionDocument(session, input.decisionTurn.document);
    }
    session.context = context;
    session.status = input.plan?.ready ? 'planned' : 'needs-input';
    const recordedAt = new Date(now()).toISOString();
    if (input.plan?.ready) {
      session.latestPlan = input.plan;
      session.latestPatch = input.patch ? normalizeStoredPatch(input.patch) : null;
      session.source = boundedText(input.source, 40) || session.source || 'canvas-ui';
      clearCreatorProductionBlock(
        session,
        creatorProductionCheckpoint('assistant.plan', input.plan, recordedAt),
      );
    } else if (input.plan) {
      session.latestPlan = input.plan;
      session.latestPatch = null;
      blockCreatorProduction(
        session,
        input.plan?.questions?.[0]?.question || '还需要补充一个关键创作条件',
        {
          recordedAt,
          checkpoint: creatorProductionCheckpoint('assistant.needs-input', input.plan, recordedAt),
        },
      );
    }
    const suggestionContext = {
      ...context,
      phase: session.production.currentPhase,
    };
    const explicitAssistantText = boundedResponseText(input.assistantText, 80_000);
    const assistantText = explicitAssistantText
      || assistantMessageForPlan(input.plan, suggestionContext);
    session.suggestionSet = creatorSuggestionSet(suggestionContext, input.plan, {
      responseText: explicitAssistantText,
      responseEvidence: input.responseEvidence,
      artifactVersion: input.artifactVersion,
      workSnapshot: session.creatorWork,
      decisionDocument: session.decisionDocument,
      production: session.production,
      stageReadyForConfirmation: Boolean(
        input.plan?.ready
        && assistantText
        && Array.isArray(input.plan?.productionDocuments)
        && input.plan.productionDocuments.length > 0
      ),
    });
    session.suggestions = session.suggestionSet.items.map((item) => item.label);
    return assistantText;
  }

  function appendTurn(sessionId, input = {}) {
    const session = read(sessionId);
    const attachments = normalizeAttachments(input.attachments);
    const requestedText = boundedText(input.text, 200_000);
    const text = requestedText
      || creatorAttachmentOnlyPrompt(attachments);
    const attachmentOnly = !requestedText && attachments.length > 0;
    const clientRequestId = boundedText(input.clientRequestId, 120);
    const requestDigest = boundedText(input.requestDigest, 64).toLowerCase();
    const requestBinding = clientRequestId && /^[a-f0-9]{64}$/.test(requestDigest)
      ? { clientRequestId, requestDigest } : null;
    if (!text) throw new CreatorAgentSessionError(
      'CREATOR_MESSAGE_EMPTY', '请先输入创作要求，或添加一个已上传附件',
    );
    const responseEvidence = normalizeCreatorResponseEvidence(input.responseEvidence);
    if (input.responseEvidence != null && !responseEvidence) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_EVIDENCE_INVALID',
        '创作回复的模型调用证据无效，已拒绝写入会话',
      );
    }
    const context = normalizeContext({ ...session.context, ...input.context });
    const suggestionSelection = input.suggestionSelection
      && typeof input.suggestionSelection === 'object'
      && /^[a-f0-9]{64}$/.test(boundedText(input.suggestionSelection.setDigest, 128).toLowerCase())
      ? {
          id: boundedText(input.suggestionSelection.id, 160),
          intent: boundedText(input.suggestionSelection.intent, 160),
          label: boundedText(input.suggestionSelection.label, 240),
          setDigest: boundedText(input.suggestionSelection.setDigest, 128).toLowerCase(),
        }
      : null;
    const userEvent = appendEvent(session, suggestionSelection ? 'user.suggestion' : 'user.message', {
      text,
      attachments,
      context,
      ...(suggestionSelection ? { suggestion: suggestionSelection } : {}),
      ...(attachmentOnly ? { inputMode: 'attachments-only' } : {}),
      ...(requestBinding || {}),
    });
    if (session.title === '新的创作') {
      session.title = attachmentOnly
        ? `分析${creatorAttachmentSummary(attachments)}`.slice(0, 40)
        : text.replace(/\s+/g, ' ').slice(0, 40);
    }
    const suppliedAssistantText = input.assistantText == null
      ? ''
      : boundedResponseText(input.assistantText, 80_000);
    const assistantText = suppliedAssistantText || assistantMessageForPlan(input.plan, context);
    const responseId = randomUUID();
    const responseDigest = creatorDigest({
      schema: 't8-creator-agent-response-v1',
      text: assistantText,
    });
    const artifactCompilation = compileTurnArtifact(
      session,
      input,
      responseId,
      assistantText,
      responseDigest,
      responseEvidence,
    );
    const workResult = compileTurnWork(
      session,
      input,
      responseId,
      responseEvidence,
    );
    const responseProductionPhase = session.production.currentPhase;
    applyPlanState(session, {
      ...input,
      assistantText,
      responseEvidence,
      artifactVersion: artifactCompilation?.artifactVersion || null,
    }, context);
    const readinessReceipt = normalizeCreatorAgentReadinessReceipt(input.readinessReceipt);
    const assistantEventType = responseEvidence
      ? 'assistant.response.completed'
      : 'assistant.plan';
    const assistantEvent = appendEvent(session, assistantEventType, {
      responseId,
      responseDigest,
      text: assistantText,
      plan: input.plan || null,
      productionPhase: responseProductionPhase,
      ...(readinessReceipt ? { readinessReceipt } : {}),
      ...(responseEvidence ? { responseEvidence } : {}),
      ...(artifactCompilation ? { artifactCompilation } : {}),
      ...(artifactCompilation?.artifactVersion ? {
        artifactVersion: artifactCompilation.artifactVersion,
      } : {}),
      ...(workResult?.turnReceipt ? {
        creatorLlmTurnReceipt: workResult.turnReceipt,
      } : {}),
      ...(workResult?.invocationReceipt ? {
        creatorLlmInvocationReceipt: workResult.invocationReceipt,
      } : {}),
      ...(workResult?.compilation ? {
        workCompilation: {
          status: workResult.compilation.status,
          code: workResult.compilation.code,
          snapshot: workResult.compilation.snapshot,
          createdVersions: workResult.compilation.createdVersions || [],
        },
      } : {}),
      ...(creatorDecisionSummary(session.decisionDocument) ? {
        decision: creatorDecisionSummary(session.decisionDocument),
      } : {}),
      providerCalls: responseEvidence?.providerCalls || 0,
      suggestions: session.suggestions,
      suggestionSet: session.suggestionSet,
      suggestionInvariantReceipt: session.suggestionSet.invariantReceipt,
      requiresExplicitApply: Boolean(input.plan?.ready),
      ...(requestBinding || {}),
    });
    return {
      session: read(session.id),
      userEvent,
      assistantEvent,
    };
  }

  function recordToolProposal(sessionId, input = {}) {
    return withSessionLock(sessionId, 'tool-proposal', () => {
      const session = read(sessionId);
      let proposal;
      try {
        proposal = assertCreatorToolProposalCurrent(input.proposal, session);
      } catch (error) {
        if (error instanceof CreatorAgentToolProposalError) {
          throw new CreatorAgentSessionError(
            error.code,
            error.message,
            error.status,
            error.details || {},
          );
        }
        throw error;
      }
      const existing = session.toolProposals.find(
        (candidate) => candidate.proposalId === proposal.proposalId,
      );
      if (existing) {
        if (existing.proposalDigest !== proposal.proposalDigest) {
          throw new CreatorAgentSessionError(
            'CREATOR_TOOL_PROPOSAL_CONFLICT',
            '同一工具提议编号对应了不同内容，已停止继续处理',
            409,
          );
        }
        return {
          session,
          proposal: existing,
          event: session.events.find((event) => (
            event.type === 'assistant.tool-proposal.validated'
            && event.payload?.proposalId === existing.proposalId
          )) || null,
          duplicate: true,
        };
      }
      session.toolProposals = [...session.toolProposals, proposal].slice(-100);
      const event = appendEvent(session, 'assistant.tool-proposal.validated', {
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        responseId: proposal.binding.responseId,
        responseDigest: proposal.binding.responseDigest,
        planId: proposal.binding.planId,
        planDigest: proposal.binding.planDigest,
        artifactId: proposal.binding.artifactId,
        artifactVersionId: proposal.binding.artifactVersionId,
        artifactDigest: proposal.binding.artifactDigest,
        workId: proposal.binding.workId,
        workRevision: proposal.binding.workRevision,
        workDigest: proposal.binding.workDigest,
        canvasRevision: proposal.binding.canvasRevision,
        tool: proposal.tool,
        gate: proposal.gate,
        request: proposal.request,
        execution: proposal.execution,
      });
      return {
        session: read(session.id),
        proposal,
        event,
        duplicate: false,
      };
    });
  }

  function prepareToolProposal(sessionId, input = {}) {
    return withSessionLock(sessionId, 'tool-proposal-prepare', () => {
      const session = read(sessionId);
      const proposalId = boundedText(input.proposalId, 80);
      const proposalDigest = boundedText(input.proposalDigest, 64).toLowerCase();
      const proposalValue = session.toolProposals.find((candidate) => (
        candidate.proposalId === proposalId
      ));
      if (!proposalValue) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_NOT_FOUND',
          '这条工具提议不存在或已经被清理，请基于当前作品重新提议',
          404,
        );
      }
      if (!/^[a-f0-9]{64}$/u.test(proposalDigest)
        || proposalValue.proposalDigest !== proposalDigest) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_STALE',
          '工具提议摘要已经变化，未生成预览；请刷新当前作品后重试',
          409,
        );
      }
      let proposal;
      try {
        proposal = assertCreatorToolProposalCurrent(proposalValue, session);
      } catch (error) {
        if (error instanceof CreatorAgentToolProposalError) {
          throw new CreatorAgentSessionError(
            error.code,
            error.message,
            error.status,
            error.details || {},
          );
        }
        throw error;
      }
      const plan = input.plan && typeof input.plan === 'object' && !Array.isArray(input.plan)
        ? input.plan : null;
      if (!plan
        || boundedText(plan.planId, 160) !== proposal.binding.planId
        || boundedText(plan.planDigest, 160) !== proposal.binding.planDigest) {
        throw new CreatorAgentSessionError(
          'CREATOR_TOOL_PROPOSAL_PLAN_STALE',
          '工具提议绑定的创作计划已变化，未生成预览',
          409,
        );
      }
      const existing = session.events.find((event) => (
        event?.type === 'assistant.tool-proposal.prepared'
        && event?.payload?.proposalId === proposal.proposalId
        && event?.payload?.proposalDigest === proposal.proposalDigest
        && event?.payload?.planId === proposal.binding.planId
        && event?.payload?.planDigest === proposal.binding.planDigest
      ));
      if (existing) {
        return {
          session,
          proposal,
          event: existing,
          duplicate: true,
        };
      }
      const event = appendEvent(session, 'assistant.tool-proposal.prepared', {
        schema: 't8-creator-tool-proposal-execution-v1',
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        responseId: proposal.binding.responseId,
        responseDigest: proposal.binding.responseDigest,
        workId: proposal.binding.workId,
        workRevision: proposal.binding.workRevision,
        workDigest: proposal.binding.workDigest,
        planId: proposal.binding.planId,
        planDigest: proposal.binding.planDigest,
        requestedOperation: proposal.tool.operation,
        capabilityId: proposal.tool.capabilityId,
        status: 'prepared',
        nextBoundary: proposal.gate.approvalRequired ? 'preview-and-approval' : 'preview',
        sideEffects: {
          canvasWrites: 0,
          providerCalls: 0,
          fileWrites: 0,
        },
      });
      return {
        session: read(session.id),
        proposal,
        event,
        duplicate: false,
      };
    });
  }

  function productionSourcePlan(session) {
    if (Array.isArray(session?.latestPlan?.productionDocuments)
      && session.latestPlan.productionDocuments.length > 0) {
      return session.latestPlan;
    }
    const sourceEvent = [...(Array.isArray(session?.events) ? session.events : [])]
      .reverse()
      .find((event) => (
        ['assistant.response.completed', 'assistant.plan'].includes(event?.type)
        && Array.isArray(event?.payload?.plan?.productionDocuments)
        && event.payload.plan.productionDocuments.length > 0
      ));
    return sourceEvent?.payload?.plan || null;
  }

  function productionDocumentsForNextPlan(sessionId) {
    const session = read(sessionId);
    const sourcePlan = productionSourcePlan(session);
    const documents = Array.isArray(sourcePlan?.productionDocuments)
      ? sourcePlan.productionDocuments
      : [];
    return documents.map((document) => ({
      ...document,
      status: productionDocumentConfirmationFor(session, document) ? 'confirmed' : document.status,
    }));
  }

  function confirmProductionDocuments(sessionId, input = {}) {
    const session = read(sessionId);
    const planId = boundedText(input.planId, 160);
    const planDigest = boundedText(input.planDigest, 64).toLowerCase();
    const sourcePlan = productionSourcePlan(session);
    if (!sourcePlan
      || sourcePlan.planId !== planId
      || sourcePlan.planDigest !== planDigest) {
      throw new CreatorAgentSessionError(
        'CREATOR_PRODUCTION_DOCUMENT_STALE',
        '这份前期文档已经有新版本，请刷新后确认当前版本',
        409,
      );
    }
    const currentPhase = normalizeCreativePhase(session.production?.currentPhase, 'idea');
    const requested = Array.isArray(input.documents) ? input.documents.slice(0, 16) : [];
    if (requested.length === 0) {
      throw new CreatorAgentSessionError(
        'CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_EMPTY',
        '请选择至少一份当前前期文档再确认',
      );
    }
    const currentDocuments = Array.isArray(sourcePlan.productionDocuments)
      ? sourcePlan.productionDocuments
      : [];
    const selected = requested.map((item) => {
      const documentId = boundedText(item?.documentId, 160);
      const versionId = boundedText(item?.versionId, 160);
      const contentDigest = boundedText(item?.contentDigest, 64).toLowerCase();
      const document = currentDocuments.find((candidate) => (
        candidate?.id === documentId
        && candidate?.versionId === versionId
        && candidate?.contentDigest === contentDigest
      ));
      if (!document) {
        throw new CreatorAgentSessionError(
          'CREATOR_PRODUCTION_DOCUMENT_STALE',
          '这份前期文档已经有新版本，请刷新后确认当前版本',
          409,
        );
      }
      if (creatorDigest({ kind: document.kind, content: document.content }) !== contentDigest) {
        throw new CreatorAgentSessionError(
          'CREATOR_PRODUCTION_DOCUMENT_INVALID',
          '这份前期文档内容无法验证，已停止确认以保护版本记录',
          409,
        );
      }
      return document;
    });
    if (new Set(selected.map((document) => document.versionId)).size !== selected.length) {
      throw new CreatorAgentSessionError(
        'CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_DUPLICATE',
        '同一份前期文档不能在一次确认中重复提交',
      );
    }
    const allSelectedAlreadyConfirmed = selected.every(
      (document) => productionDocumentConfirmationFor(session, document),
    );
    if (allSelectedAlreadyConfirmed) {
      return {
        session: read(session.id),
        confirmations: selected.map(
          (document) => productionDocumentConfirmationFor(session, document),
        ).filter(Boolean),
        duplicate: true,
        phaseTransition: null,
        stageResponse: null,
      };
    }
    const allowedKinds = new Set(creatorProductionDocumentKindsForPhase(currentPhase));
    if (selected.some((document) => !allowedKinds.has(String(document?.kind || '')))) {
      throw new CreatorAgentSessionError(
        'CREATOR_STAGE_DOCUMENT_SCOPE_INVALID',
        '一次只能确认当前阶段的必需文档；后续阶段仍需逐项完善并明确确认',
        409,
      );
    }
    const decisionDocument = normalizeCreatorDecisionDocument(session.decisionDocument);
    const currentDecision = currentCreatorDecision(decisionDocument);
    const decisionSelection = input.decisionSelection
      && typeof input.decisionSelection === 'object'
      ? input.decisionSelection
      : null;
    if (!decisionDocument
      || decisionDocument.phase !== currentPhase
      || currentDecision?.kind !== 'stage-confirmation'
      || boundedText(decisionSelection?.decisionDocumentId, 160)
        !== decisionDocument.documentId
      || boundedText(decisionSelection?.decisionDocumentVersionId, 80)
        !== decisionDocument.versionId
      || boundedText(decisionSelection?.decisionDocumentDigest, 64).toLowerCase()
        !== decisionDocument.contentDigest
      || boundedText(decisionSelection?.decisionId, 120)
        !== decisionDocument.currentDecisionId) {
      throw new CreatorAgentSessionError(
        'CREATOR_STAGE_DECISION_REQUIRED',
        '请先完成本阶段当前的逐项确认，再使用最新的“确认并进入下一阶段”选项',
        409,
      );
    }
    const decisionOption = currentDecision.options.find((option) => (
      option.id === boundedText(decisionSelection?.decisionOptionId, 80)
    ));
    if (!decisionOption || decisionOption.action !== 'confirm-stage') {
      throw new CreatorAgentSessionError(
        'CREATOR_STAGE_CONFIRMATION_REQUIRED',
        '当前选择不是阶段确认；修改和补充会继续留在本阶段',
        409,
      );
    }
    let confirmedDecisionDocument;
    try {
      confirmedDecisionDocument = advanceCreatorDecisionDocument(decisionDocument, {
        optionId: decisionOption.id,
      }).document;
    } catch (error) {
      throw new CreatorAgentSessionError(
        'CREATOR_STAGE_DECISION_STALE',
        '当前阶段确认版本已经变化，请使用最新回复下方的选项',
        409,
        { cause: String(error?.message || error) },
      );
    }
    const stageResponse = [...(Array.isArray(session.events) ? session.events : [])]
      .reverse()
      .find((event) => (
        ['assistant.response.completed', 'assistant.plan'].includes(event?.type)
        && event?.payload?.plan?.planId === planId
        && event?.payload?.plan?.planDigest === planDigest
        && normalizeCreativePhase(event?.payload?.productionPhase, '__invalid__') === currentPhase
        && boundedText(event?.payload?.text, 80_000)
      ));
    if (!stageResponse) {
      throw new CreatorAgentSessionError(
        'CREATOR_PRODUCTION_STAGE_RESPONSE_REQUIRED',
        '当前阶段还没有完整创作稿，不能只确认空计划；请先让 Agent 完成本阶段内容',
        409,
      );
    }
    const stageArtifact = normalizeCreatorArtifactVersion(
      stageResponse.payload?.artifactVersion,
    );
    const persistedStageArtifact = stageArtifact
      ? session.creativeArtifactVersions.find((version) => (
          version.versionId === stageArtifact.versionId
          && version.versionDigest === stageArtifact.versionDigest
        ))
      : null;
    if (!persistedStageArtifact
      || !boundedResponseText(persistedStageArtifact.content?.bodyMarkdown, 80_000)
      || boundedResponseText(stageResponse.payload?.text, 80_000)
        !== boundedResponseText(persistedStageArtifact.content.bodyMarkdown, 80_000)) {
      throw new CreatorAgentSessionError(
        'CREATOR_STAGE_ARTIFACT_REQUIRED',
        '当前阶段没有可验证的非空创作稿版本，已停止确认；请先让 Agent 完成本阶段内容',
        409,
      );
    }
    const selectedVersionIds = new Set(selected.map((document) => String(document.versionId || '')));
    const expectedSourceKindByDerivedKind = {
      'character-bible': 'script-doc',
      'asset-needs': 'script-doc',
      'shot-list': 'script-doc',
      'audio-plan': 'shot-list',
      storyboard: 'shot-list',
      'prompt-pack': 'storyboard',
      'candidate-review': 'prompt-pack',
      'edit-decision-list': 'candidate-review',
      'qc-report': 'edit-decision-list',
      'delivery-manifest': 'qc-report',
    };
    for (const document of selected) {
      if (!document.content?.derivation) continue;
      const expectedSourceKind = expectedSourceKindByDerivedKind[String(document.kind || '')];
      const derivation = document.content?.derivation;
      const sourceDocumentId = boundedText(derivation?.sourceDocumentId, 160);
      const sourceVersionId = boundedText(derivation?.sourceVersionId, 160);
      const sourceContentDigest = boundedText(derivation?.sourceContentDigest, 64).toLowerCase();
      const sourceDigest = boundedText(derivation?.sourceDigest, 64).toLowerCase();
      const sourceDocument = currentDocuments.find((candidate) => (
        candidate?.kind === expectedSourceKind
        && candidate?.id === sourceDocumentId
        && candidate?.versionId === sourceVersionId
        && candidate?.contentDigest === sourceContentDigest
      ));
      const sourceAnalysisDigest = boundedText(
        sourceDocument?.kind === 'script-doc'
          ? sourceDocument?.content?.scriptAnalysis?.sourceDigest
          : sourceDocument?.content?.derivation?.sourceDigest,
        64,
      ).toLowerCase();
      const sourceDocumentValid = Boolean(sourceDocument
        && /^[a-f0-9]{64}$/.test(sourceContentDigest)
        && creatorDigest({
          kind: sourceDocument.kind,
          content: sourceDocument.content,
        }) === sourceContentDigest);
      const deterministicSourceValid = (
        derivation?.schema === 't8-creator-source-derivation-v1'
        && derivation?.method === 'deterministic-source-map'
        && derivation?.sourceBacked === true
        && derivation?.providerCalls === 0
        && derivation?.inferredFacts === 0
        && /^[a-f0-9]{64}$/.test(sourceDigest)
        && sourceAnalysisDigest === sourceDigest
      );
      const persistedEvidenceValid = (
        document.kind === 'candidate-review'
        && derivation?.schema === 't8-creator-evidence-derivation-v1'
        && derivation?.method === 'persisted-candidate-evidence'
        && Number.isSafeInteger(Number(derivation?.canvasRevision))
        && Number(derivation?.canvasRevision) >= 0
        && /^[a-f0-9]{64}$/.test(boundedText(derivation?.evidenceDigest, 64).toLowerCase())
        && derivation?.documentProviderCalls === 0
        && derivation?.documentCanvasWrites === 0
      );
      const persistedEditDecisionListValid = (
        document.kind === 'edit-decision-list'
        && derivation?.schema === 't8-creator-evidence-derivation-v1'
        && [
          'verified-adopted-video-sequence',
          'verified-adopted-media-sequence',
        ].includes(derivation?.method)
        && Number.isSafeInteger(Number(derivation?.canvasRevision))
        && Number(derivation?.canvasRevision) >= 0
        && Number(derivation?.canvasRevision) === Number(sourceDocument?.content?.derivation?.canvasRevision || 0)
        && boundedText(derivation?.evidenceDigest, 64).toLowerCase()
          === creatorDigest(Array.isArray(document.content?.sequence) ? document.content.sequence : [])
        && derivation?.documentProviderCalls === 0
        && derivation?.documentCanvasWrites === 0
      );
      const persistedQualityControlReportValid = (
        document.kind === 'qc-report'
        && derivation?.schema === 't8-creator-evidence-derivation-v1'
        && derivation?.method === 'persisted-artifact-qc-evidence'
        && Number.isSafeInteger(Number(derivation?.canvasRevision))
        && Number(derivation?.canvasRevision) >= 0
        && Number(derivation?.canvasRevision) === Number(sourceDocument?.content?.derivation?.canvasRevision || 0)
        && boundedText(derivation?.evidenceDigest, 64).toLowerCase()
          === creatorDigest(Array.isArray(document.content?.qcItems) ? document.content.qcItems : [])
        && derivation?.documentProviderCalls === 0
        && derivation?.documentCanvasWrites === 0
      );
      const persistedDeliveryManifestValid = (
        document.kind === 'delivery-manifest'
        && derivation?.schema === 't8-creator-evidence-derivation-v1'
        && derivation?.method === 'verified-local-delivery-package-evidence'
        && Number.isSafeInteger(Number(derivation?.canvasRevision))
        && Number(derivation?.canvasRevision) >= 0
        && Number(derivation?.canvasRevision) === Number(sourceDocument?.content?.derivation?.canvasRevision || 0)
        && boundedText(derivation?.evidenceDigest, 64).toLowerCase()
          === creatorDigest({
            deliverables: Array.isArray(document.content?.deliverables)
              ? document.content.deliverables
              : [],
            packageEvidence: document.content?.packageEvidence || null,
          })
        && derivation?.documentProviderCalls === 0
        && derivation?.documentCanvasWrites === 0
        && derivation?.documentDeliveryWrites === 0
      );
      if (!expectedSourceKind
        || !sourceDocumentValid
        || (!deterministicSourceValid
          && !persistedEvidenceValid
          && !persistedEditDecisionListValid
          && !persistedQualityControlReportValid
          && !persistedDeliveryManifestValid)) {
        throw new CreatorAgentSessionError(
          'CREATOR_PRODUCTION_DOCUMENT_SOURCE_INVALID',
          '源证据草案的来源版本无法验证，已停止确认以保护作品记录',
          409,
        );
      }
      if (!productionDocumentConfirmationFor(session, sourceDocument)
        && !selectedVersionIds.has(sourceVersionId)) {
        throw new CreatorAgentSessionError(
          'CREATOR_PRODUCTION_DOCUMENT_SOURCE_UNCONFIRMED',
          '请先确认这份草案对应的当前来源版本；也可以一次确认当前完整来源链和全部草案',
          409,
        );
      }
    }

    const requiredKinds = creatorProductionDocumentKindsForPhase(currentPhase);
    const requiredDocuments = currentDocuments.filter((document) => (
      requiredKinds.includes(String(document?.kind || ''))
    ));
    const selectedVersionIdsForConfirmation = new Set(
      selected.map((document) => document.versionId),
    );
    const allRequiredSelectedOrConfirmed = requiredDocuments.length > 0
      && requiredDocuments.every((document) => (
        productionDocumentConfirmationFor(session, document)
        || selectedVersionIdsForConfirmation.has(document.versionId)
      ));
    if (!allRequiredSelectedOrConfirmed) {
      throw new CreatorAgentSessionError(
        'CREATOR_STAGE_DOCUMENTS_INCOMPLETE',
        '请一次确认本阶段当前版本的全部必需文档；缺少的内容仍会留在本阶段继续完善',
        409,
      );
    }
    storeCreatorDecisionDocument(session, confirmedDecisionDocument);
    const existing = [];
    const created = [];
    const confirmedAt = new Date(now()).toISOString();
    for (const document of selected) {
      const prior = productionDocumentConfirmationFor(session, document);
      if (prior) {
        existing.push(prior);
        continue;
      }
      const normalized = {
        schema: CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_SCHEMA,
        confirmationId: `pdc_${creatorDigest({
          sessionId: session.id,
          documentId: document.id,
          versionId: document.versionId,
          contentDigest: document.contentDigest,
        }).slice(0, 32)}`,
        documentId: document.id,
        kind: document.kind,
        revision: document.revision,
        versionId: document.versionId,
        contentDigest: document.contentDigest,
        sourcePlanId: planId,
        sourcePlanDigest: planDigest,
        actor: boundedText(input.actor, 40) || 'canvas-ui',
        confirmedAt,
      };
      created.push({ ...normalized, confirmationDigest: creatorDigest(normalized) });
    }
    if (created.length > 0) {
      session.productionDocumentConfirmations = [
        ...session.productionDocumentConfirmations,
        ...created,
      ].slice(-CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_LIMIT);
      appendEvent(session, 'production-documents.confirmed', {
        planId,
        planDigest,
        confirmationIds: created.map((item) => item.confirmationId),
        documentVersions: created.map((item) => ({
          documentId: item.documentId,
          versionId: item.versionId,
          revision: item.revision,
          contentDigest: item.contentDigest,
        })),
        providerCalls: 0,
        canvasWrites: 0,
      });
    }
    const allRequiredConfirmed = requiredDocuments.length > 0
      && requiredDocuments.every((document) => productionDocumentConfirmationFor(session, document));
    let phaseTransition = null;
    if (allRequiredConfirmed) {
      const nextPhase = nextCreatorProductionPhase(currentPhase);
      const recordedAt = new Date(now()).toISOString();
      const previousRevision = Number(session.production?.revision || 0);
      transitionCreatorProduction(session, nextPhase, {
        recordedAt,
        completedPhases: [currentPhase],
        completeCurrent: nextPhase === currentPhase,
        reason: `创作者确认${currentPhase}阶段当前版本`,
        checkpoint: creatorProductionCheckpoint(
          'production-documents.confirmed',
          sourcePlan,
          recordedAt,
        ),
      });
      phaseTransition = {
        advanced: currentPhase !== nextPhase,
        ...(nextPhase === currentPhase
          && session.production.completedPhases.includes(currentPhase)
          ? { completed: true }
          : {}),
        completedPhase: currentPhase,
        nextPhase,
        productionRevision: session.production.revision,
      };
      if (currentPhase !== nextPhase) {
        storeCreatorDecisionDocument(session, createCreatorDecisionDocument({
          sessionId: session.id,
          family: decisionDocument.family,
          phase: nextPhase,
          kind: sourcePlan.kind,
          prompt: persistedStageArtifact.content.bodyMarkdown,
        }));
      }
      session.suggestionSet = creatorSuggestionSet({
        ...session.context,
        phase: session.production.currentPhase,
      }, sourcePlan, {
        responseText: stageResponse.payload.text,
        responseEvidence: stageResponse.payload.responseEvidence,
        artifactVersion: stageResponse.payload.artifactVersion,
        decisionDocument: session.decisionDocument,
        production: session.production,
      });
      session.suggestions = session.suggestionSet.items.map((item) => item.label);
      if (session.production.revision !== previousRevision) {
        appendEvent(session, 'production-stage.advanced', {
          from: currentPhase,
          to: nextPhase,
          completedPhase: currentPhase,
          planId,
          planDigest,
          sourceResponseId: boundedText(stageResponse.payload?.responseId, 160) || null,
          sourceResponseDigest: boundedText(stageResponse.payload?.responseDigest, 64) || null,
          productionRevision: session.production.revision,
          decision: creatorDecisionSummary(session.decisionDocument),
          providerCalls: 0,
          canvasWrites: 0,
        });
      }
    }
    return {
      session: read(session.id),
      confirmations: [...existing, ...created],
      duplicate: created.length === 0,
      phaseTransition,
      stageResponse: {
        eventId: stageResponse.eventId,
        responseId: boundedText(stageResponse.payload?.responseId, 160) || null,
        responseDigest: boundedText(stageResponse.payload?.responseDigest, 64) || null,
        productionPhase: currentPhase,
        text: boundedResponseText(stageResponse.payload?.text, 80_000),
        artifactVersion: persistedStageArtifact,
      },
    };
  }

  function beginStreamingTurn(sessionId, input = {}) {
    const session = read(sessionId);
    const attachments = normalizeAttachments(input.attachments);
    const requestedText = boundedText(input.text, 200_000);
    const text = requestedText
      || creatorAttachmentOnlyPrompt(attachments);
    const attachmentOnly = !requestedText && attachments.length > 0;
    const clientRequestId = boundedText(input.clientRequestId, 120);
    const requestDigest = boundedText(input.requestDigest, 64).toLowerCase();
    const requestBinding = clientRequestId && /^[a-f0-9]{64}$/.test(requestDigest)
      ? { clientRequestId, requestDigest } : null;
    if (!text) throw new CreatorAgentSessionError(
      'CREATOR_MESSAGE_EMPTY', '请先输入创作要求，或添加一个已上传附件',
    );
    const responseEvidence = normalizeCreatorResponseEvidence(input.responseEvidence);
    if (input.responseEvidence != null && !responseEvidence) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_EVIDENCE_INVALID',
        '创作回复的模型调用证据无效，已拒绝写入会话',
      );
    }
    const context = normalizeContext({ ...session.context, ...input.context });
    const suggestionSelection = input.suggestionSelection
      && typeof input.suggestionSelection === 'object'
      && /^[a-f0-9]{64}$/.test(boundedText(input.suggestionSelection.setDigest, 128).toLowerCase())
      ? {
          id: boundedText(input.suggestionSelection.id, 160),
          intent: boundedText(input.suggestionSelection.intent, 160),
          label: boundedText(input.suggestionSelection.label, 240),
          setDigest: boundedText(input.suggestionSelection.setDigest, 128).toLowerCase(),
        }
      : null;
    const responseId = randomUUID();
    const userEvent = appendEvent(session, suggestionSelection ? 'user.suggestion' : 'user.message', {
      text,
      attachments,
      context,
      ...(suggestionSelection ? { suggestion: suggestionSelection } : {}),
      ...(attachmentOnly ? { inputMode: 'attachments-only' } : {}),
      ...(requestBinding || {}),
    });
    if (session.title === '新的创作') {
      session.title = attachmentOnly
        ? `分析${creatorAttachmentSummary(attachments)}`.slice(0, 40)
        : text.replace(/\s+/g, ' ').slice(0, 40);
    }
    session.context = context;
    session.status = 'responding';
    const live = input.live === true;
    const assistantText = live
      ? ''
      : boundedText(input.assistantText, 80_000)
        || assistantMessageForPlan(input.plan, context);
    const chunks = live ? [] : creatorResponseChunks(assistantText);
    const responseDigest = live
      ? ''
      : creatorDigest({
          schema: 't8-creator-agent-response-v1',
          text: assistantText,
        });
    const readinessReceipt = normalizeCreatorAgentReadinessReceipt(input.readinessReceipt);
    const startedEvent = appendEvent(session, 'assistant.response.started', {
      responseId,
      mode: responseEvidence?.mode || 'offline-structure',
      transport: live ? 'upstream-sse' : 'local-replay',
      ...(live ? {} : {
        chunkCount: chunks.length,
        responseDigest,
      }),
      providerCalls: responseEvidence?.providerCalls || 0,
      ...(responseEvidence ? { responseEvidence } : {}),
      ...(readinessReceipt ? { readinessReceipt } : {}),
      ...(requestBinding || {}),
    });
    return {
      session: read(session.id),
      userEvent,
      startedEvent,
      responseId,
      chunks,
      live,
    };
  }

  function appendResponseDelta(sessionId, input = {}) {
    const session = read(sessionId);
    const responseId = boundedText(input.responseId, 160);
    const index = Math.trunc(Number(input.index));
    // Response chunks are immutable text evidence. Do not trim them: a chunk
    // boundary can legitimately start or end with spaces/newlines.
    const delta = String(input.delta == null ? '' : input.delta).slice(0, 2_000);
    if (!responseId || !Number.isInteger(index) || index < 0 || index >= CREATOR_AGENT_MAX_RESPONSE_CHUNKS || !delta) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_DELTA_INVALID',
        '创作 Agent 回复片段无效，已停止继续写入',
      );
    }
    const events = Array.isArray(session.events) ? session.events : [];
    const started = events.find((event) => (
      event.type === 'assistant.response.started'
      && event.payload?.responseId === responseId
    ));
    if (!started) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_NOT_STARTED',
        '创作 Agent 回复起点不存在，已停止继续写入',
        409,
      );
    }
    if (events.some((event) => (
      ['assistant.response.completed', 'assistant.response.failed', 'assistant.response.stopped'].includes(event.type)
      && event.payload?.responseId === responseId
    ))) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_ALREADY_FINISHED',
        '这次创作 Agent 回复已经结束',
        409,
      );
    }
    const responseDeltas = events
      .filter((event) => (
        event.type === 'assistant.response.delta'
        && event.payload?.responseId === responseId
      ))
      .sort((left, right) => Number(left.payload?.index) - Number(right.payload?.index));
    const duplicate = responseDeltas.find((event) => Number(event.payload?.index) === index);
    if (duplicate) {
      if (String(duplicate.payload?.delta || '') !== delta) {
        throw new CreatorAgentSessionError(
          'CREATOR_RESPONSE_DELTA_CONFLICT',
          '同一回复片段内容不一致，已停止继续写入',
          409,
        );
      }
      return { session, event: duplicate, duplicate: true };
    }
    if (index !== responseDeltas.length) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_DELTA_OUT_OF_ORDER',
        '创作 Agent 回复片段顺序不连续，请重新连接后恢复',
        409,
      );
    }
    const event = appendEvent(session, 'assistant.response.delta', {
      responseId,
      index,
      delta,
    });
    return { session: read(session.id), event, duplicate: false };
  }

  function completeStreamingTurnUnlocked(sessionId, input = {}) {
    const session = read(sessionId);
    const responseId = boundedText(input.responseId, 160);
    const events = Array.isArray(session.events) ? session.events : [];
    const terminal = events.find((event) => (
      ['assistant.response.completed', 'assistant.response.failed', 'assistant.response.stopped'].includes(event.type)
      && event.payload?.responseId === responseId
    ));
    if (terminal) {
      return {
        session,
        assistantEvent: terminal,
        duplicate: true,
        status: terminal.type === 'assistant.response.stopped'
          ? 'stopped'
          : terminal.type === 'assistant.response.failed' ? 'failed' : 'completed',
      };
    }
    const started = events.find((event) => (
      event.type === 'assistant.response.started'
      && event.payload?.responseId === responseId
    ));
    if (!responseId || !started) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_NOT_STARTED',
        '创作 Agent 回复起点不存在，已停止完成这次回复',
        409,
      );
    }
    const deltas = events
      .filter((event) => (
        event.type === 'assistant.response.delta'
        && event.payload?.responseId === responseId
      ))
      .sort((left, right) => Number(left.payload?.index) - Number(right.payload?.index));
    const live = started.payload?.transport === 'upstream-sse';
    const expectedCount = live
      ? deltas.length
      : Math.max(0, Number(started.payload?.chunkCount) || 0);
    const context = normalizeContext({ ...session.context, ...input.context });
    const streamedText = deltas.map((event) => String(event.payload?.delta || '')).join('');
    const suppliedAssistantText = input.assistantText == null
      ? null
      : boundedResponseText(input.assistantText, 80_000);
    const startedResponseDigest = boundedText(started.payload?.responseDigest, 64).toLowerCase();
    const computedResponseDigest = creatorDigest({
      schema: 't8-creator-agent-response-v1',
      text: streamedText,
    });
    const streamedTextMatches = live
      ? suppliedAssistantText == null || suppliedAssistantText === streamedText
      : /^[a-f0-9]{64}$/.test(startedResponseDigest)
        ? computedResponseDigest === startedResponseDigest
        : streamedText === assistantMessageForPlan(input.plan, context);
    if ((!live && deltas.length !== expectedCount)
      || (live && deltas.length === 0)
      || deltas.some((event, index) => Number(event.payload?.index) !== index)
      || !streamedTextMatches) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_INCOMPLETE',
        '创作 Agent 回复尚未完整写入，请等待恢复后再继续',
        409,
      );
    }
    const responseDigest = live ? computedResponseDigest : startedResponseDigest;
    const readinessReceipt = normalizeCreatorAgentReadinessReceipt(
      input.readinessReceipt || started.payload?.readinessReceipt,
    );
    const rawResponseEvidence = input.responseEvidence || started.payload?.responseEvidence;
    const responseEvidence = normalizeCreatorResponseEvidence(rawResponseEvidence);
    if (rawResponseEvidence != null && !responseEvidence) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_EVIDENCE_INVALID',
        '创作回复的模型调用证据无效，已拒绝完成会话写入',
      );
    }
    const artifactCompilation = compileTurnArtifact(
      session,
      input,
      responseId,
      streamedText,
      responseDigest,
      responseEvidence,
    );
    const workResult = compileTurnWork(
      session,
      input,
      responseId,
      responseEvidence,
    );
    const responseProductionPhase = session.production.currentPhase;
    applyPlanState(session, {
      ...input,
      assistantText: suppliedAssistantText == null ? streamedText : suppliedAssistantText,
      responseEvidence,
      artifactVersion: artifactCompilation?.artifactVersion || null,
    }, context);
    const assistantEvent = appendEvent(session, 'assistant.response.completed', {
      responseId,
      text: streamedText,
      ...(responseDigest ? { responseDigest } : {}),
      plan: input.plan || null,
      productionPhase: responseProductionPhase,
      ...(readinessReceipt ? { readinessReceipt } : {}),
      suggestions: session.suggestions,
      suggestionSet: session.suggestionSet,
      suggestionInvariantReceipt: session.suggestionSet.invariantReceipt,
      requiresExplicitApply: Boolean(input.plan?.ready),
      ...(responseEvidence ? { responseEvidence } : {}),
      ...(artifactCompilation ? { artifactCompilation } : {}),
      ...(artifactCompilation?.artifactVersion ? {
        artifactVersion: artifactCompilation.artifactVersion,
      } : {}),
      ...(workResult?.turnReceipt ? {
        creatorLlmTurnReceipt: workResult.turnReceipt,
      } : {}),
      ...(workResult?.invocationReceipt ? {
        creatorLlmInvocationReceipt: workResult.invocationReceipt,
      } : {}),
      ...(workResult?.compilation ? {
        workCompilation: {
          status: workResult.compilation.status,
          code: workResult.compilation.code,
          snapshot: workResult.compilation.snapshot,
          createdVersions: workResult.compilation.createdVersions || [],
        },
      } : {}),
      ...(creatorDecisionSummary(session.decisionDocument) ? {
        decision: creatorDecisionSummary(session.decisionDocument),
      } : {}),
      providerCalls: responseEvidence?.providerCalls
        ?? Math.max(0, Math.trunc(Number(started.payload?.providerCalls) || 0)),
      ...(started.payload?.clientRequestId ? { clientRequestId: started.payload.clientRequestId } : {}),
      ...(started.payload?.requestDigest ? { requestDigest: started.payload.requestDigest } : {}),
    });
    return {
      session: read(session.id),
      assistantEvent,
      duplicate: false,
      status: 'completed',
    };
  }

  function completeStreamingTurn(sessionId, input = {}) {
    return withSessionLock(sessionId, 'response-complete', () => (
      completeStreamingTurnUnlocked(sessionId, input)
    ));
  }

  function failStreamingTurn(sessionId, input = {}) {
    const session = read(sessionId);
    const responseId = boundedText(input.responseId, 160);
    if (!responseId) return session;
    const events = Array.isArray(session.events) ? session.events : [];
    if (events.some((event) => (
      ['assistant.response.completed', 'assistant.response.failed', 'assistant.response.stopped'].includes(event.type)
      && event.payload?.responseId === responseId
    ))) return session;
    session.status = 'needs-input';
    const started = events.find((event) => (
      event.type === 'assistant.response.started'
      && event.payload?.responseId === responseId
    ));
    const responseEvidence = normalizeCreatorResponseEvidence(started?.payload?.responseEvidence);
    appendEvent(session, 'assistant.response.failed', {
      responseId,
      message: boundedText(input.message, 1_000) || '回复意外中断；已保留你的要求，可以直接重试。',
      ...(responseEvidence ? { responseEvidence } : {}),
      providerCalls: responseEvidence?.providerCalls
        ?? Math.max(0, Math.trunc(Number(started?.payload?.providerCalls) || 0)),
      ...(started?.payload?.clientRequestId ? { clientRequestId: started.payload.clientRequestId } : {}),
      ...(started?.payload?.requestDigest ? { requestDigest: started.payload.requestDigest } : {}),
    });
    return read(session.id);
  }

  function stopStreamingTurn(sessionId, input = {}) {
    const session = read(sessionId);
    const responseId = boundedText(input.responseId, 160);
    if (!responseId) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_ID_REQUIRED',
        '没有找到要停止的本轮回复，请刷新会话后重试',
      );
    }
    const events = Array.isArray(session.events) ? session.events : [];
    const started = events.find((event) => (
      event.type === 'assistant.response.started'
      && event.payload?.responseId === responseId
    ));
    if (!started) {
      throw new CreatorAgentSessionError(
        'CREATOR_RESPONSE_NOT_STARTED',
        '没有找到要停止的本轮回复；画布里的生成任务没有受到影响',
        404,
      );
    }
    const terminal = events.find((event) => (
      ['assistant.response.completed', 'assistant.response.failed', 'assistant.response.stopped'].includes(event.type)
      && event.payload?.responseId === responseId
    ));
    if (terminal) {
      return {
        session,
        assistantEvent: terminal,
        duplicate: true,
        status: terminal.type === 'assistant.response.stopped'
          ? 'stopped'
          : terminal.type === 'assistant.response.failed' ? 'failed' : 'completed',
      };
    }
    const deltas = events
      .filter((event) => (
        event.type === 'assistant.response.delta'
        && event.payload?.responseId === responseId
      ))
      .sort((left, right) => Number(left.payload?.index) - Number(right.payload?.index));
    const partialText = deltas.map((event) => String(event.payload?.delta || '')).join('');
    const responseEvidence = normalizeCreatorResponseEvidence(started.payload?.responseEvidence);
    session.status = 'needs-input';
    const assistantEvent = appendEvent(session, 'assistant.response.stopped', {
      responseId,
      text: partialText,
      message: '已停止本轮文字回复。你的要求和已显示内容仍然保留；画布里的图像、视频、音频等远端生成任务没有被取消。',
      reason: 'creator-stopped-reply',
      ...(responseEvidence ? { responseEvidence } : {}),
      providerCalls: responseEvidence?.providerCalls
        ?? Math.max(0, Math.trunc(Number(started.payload?.providerCalls) || 0)),
      remoteTasksAffected: 0,
      ...(started.payload?.clientRequestId ? { clientRequestId: started.payload.clientRequestId } : {}),
      ...(started.payload?.requestDigest ? { requestDigest: started.payload.requestDigest } : {}),
    });
    return {
      session: read(session.id),
      assistantEvent,
      duplicate: false,
      status: 'stopped',
    };
  }

  function messageRequest(sessionId, input = {}) {
    const session = read(sessionId);
    const clientRequestId = boundedText(input.clientRequestId, 120);
    const requestDigest = boundedText(input.requestDigest, 64).toLowerCase();
    if (!clientRequestId) {
      throw new CreatorAgentSessionError(
        'CREATOR_MESSAGE_REQUEST_ID_REQUIRED',
        '这条创作要求缺少恢复编号，请重新发送',
      );
    }
    const events = Array.isArray(session.events) ? session.events : [];
    const userEvent = events.find((event) => (
      ['user.message', 'user.suggestion'].includes(event.type)
      && event.payload?.clientRequestId === clientRequestId
    ));
    if (!userEvent) return null;
    const storedDigest = boundedText(userEvent.payload?.requestDigest, 64).toLowerCase();
    if (requestDigest && storedDigest !== requestDigest) {
      throw new CreatorAgentSessionError(
        'CREATOR_MESSAGE_IDEMPOTENCY_CONFLICT',
        '同一恢复编号对应了不同创作要求，已停止重复提交；请作为新要求重新发送',
        409,
      );
    }
    const responseId = boundedText(userEvent.payload?.responseId, 160);
    const matchesRequest = (event) => (
      event.payload?.clientRequestId === clientRequestId
      || (responseId && event.payload?.responseId === responseId)
    );
    const assistantEvent = [...events].reverse().find((event) => (
      [
        'assistant.plan',
        'assistant.response.completed',
        'assistant.response.failed',
        'assistant.response.stopped',
        'assistant.response.started',
      ].includes(event.type)
      && matchesRequest(event)
    )) || null;
    const status = assistantEvent?.type === 'assistant.response.failed'
      ? 'failed'
      : assistantEvent?.type === 'assistant.response.stopped'
        ? 'stopped'
      : ['assistant.plan', 'assistant.response.completed'].includes(assistantEvent?.type)
        ? 'completed'
        : 'in-progress';
    const startedEvent = events.find((event) => (
      event.type === 'assistant.response.started'
      && matchesRequest(event)
    ));
    return {
      schema: 't8-creator-message-request-v1',
      clientRequestId,
      requestDigest: storedDigest,
      status,
      responseId: responseId || boundedText(startedEvent?.payload?.responseId, 160),
      chunkCount: Math.max(0, Number(startedEvent?.payload?.chunkCount) || 0),
      session,
      userEvent,
      assistantEvent,
    };
  }

  function appendActionPlan(sessionId, input = {}) {
    const session = read(sessionId);
    const action = boundedText(input.action, 80);
    const label = boundedText(input.label, 240);
    const silent = input.silent === true;
    const preserveSuggestions = input.preserveSuggestions === true;
    if (!action || !input.plan) {
      throw new CreatorAgentSessionError(
        'CREATOR_ACTION_PLAN_INVALID',
        '受控创作操作缺少动作或预览计划',
      );
    }
    const context = normalizeContext({ ...session.context, ...input.context });
    const userEvent = silent ? null : appendEvent(session, 'user.action', {
      action,
      label: label || action,
      nodeId: boundedText(input.nodeId, 160),
      context,
    });
    session.context = context;
    const recordedAt = new Date(now()).toISOString();
    session.status = input.plan.ready ? 'planned' : 'needs-input';
    session.latestPlan = input.plan;
    session.latestPatch = input.plan.ready && input.patch ? normalizeStoredPatch(input.patch) : null;
    session.source = boundedText(input.source, 40) || session.source || 'canvas-ui';
    if (input.plan.ready) {
      clearCreatorProductionBlock(
        session,
        creatorProductionCheckpoint('assistant.plan', input.plan, recordedAt),
      );
    } else {
      blockCreatorProduction(session, input.plan?.questions?.[0]?.question, {
        recordedAt,
        checkpoint: creatorProductionCheckpoint('assistant.needs-input', input.plan, recordedAt),
      });
    }
    const suggestionContext = {
      ...context,
      phase: session.production.currentPhase,
    };
    if (!preserveSuggestions) {
      session.suggestionSet = creatorSuggestionSet(suggestionContext, input.plan, {
        production: session.production,
        decisionDocument: session.decisionDocument,
      });
      session.suggestions = session.suggestionSet.items.map((item) => item.label);
    }
    const assistantEvent = appendEvent(
      session,
      silent ? 'canvas-retention.preview-prepared' : 'assistant.plan',
      silent ? {
        action,
        label: label || action,
        planId: input.plan.planId,
        planDigest: input.plan.planDigest,
        patchDigest: boundedText(input.patch?.digest, 160) || null,
        productionPhase: session.production.currentPhase,
        requiresExplicitApply: Boolean(input.plan.ready),
        providerCalls: 0,
        canvasWrites: 0,
      } : {
        text: assistantMessageForPlan(input.plan, suggestionContext),
        plan: input.plan,
        productionPhase: session.production.currentPhase,
        suggestions: session.suggestions,
        suggestionSet: session.suggestionSet,
        suggestionInvariantReceipt: session.suggestionSet.invariantReceipt,
        requiresExplicitApply: Boolean(input.plan.ready),
      },
    );
    return {
      session: read(session.id),
      userEvent,
      assistantEvent,
    };
  }

  function appendRunEvents(sessionId, values = []) {
    const session = read(sessionId);
    const linkedRunIds = new Set(session.runLinks.map((link) => boundedText(link?.runId, 160)).filter(Boolean));
    const normalized = (Array.isArray(values) ? values : [])
      .map(normalizeCreatorRunEvent)
      .filter(Boolean)
      .filter((item) => linkedRunIds.has(item.payload.runId))
      .sort((left, right) => left.payload.sourceEventId - right.payload.sourceEventId)
      .slice(0, 500);
    const appended = [];
    let cursorChanged = false;
    for (const item of normalized) {
      const runId = item.payload.runId;
      const currentCursor = Math.max(0, Number(session.runEventCursors[runId]) || 0);
      if (item.payload.sourceEventId <= currentCursor) continue;
      session.runEventCursors[runId] = item.payload.sourceEventId;
      cursorChanged = true;
      if (!item.visible) continue;
      const duplicateSource = session.events.some((event) => (
        event?.type === 'run.event'
        && Number(event?.payload?.sourceEventId) === item.payload.sourceEventId
        && event?.payload?.runId === runId
      ));
      if (duplicateSource) continue;
      if (item.progressBucket != null && !/(?:completed|succeeded|failed|stopped|interrupted|terminal|error)/i
        .test(`${item.payload.eventType} ${item.payload.phase || ''} ${item.payload.status || ''}`)) {
        const duplicateBucket = [...session.events].reverse().find((event) => (
          event?.type === 'run.event'
          && event?.payload?.runId === runId
          && (event?.payload?.nodeRunId || null) === (item.payload.nodeRunId || null)
          && event?.payload?.eventType === item.payload.eventType
          && event?.payload?.phase === item.payload.phase
          && event?.payload?.progress != null
        ));
        if (duplicateBucket
          && Math.floor(Number(duplicateBucket.payload.progress) / 10) * 10 === item.progressBucket) continue;
      }
      appended.push(appendEvent(session, 'run.event', item.payload));
    }
    if (cursorChanged) atomicWriteJson(pathsFor(session.id).snapshot, session);
    return { session: read(session.id), events: appended };
  }

  function appendLifecycle(sessionId, type, payload = {}) {
    const session = read(sessionId);
    const allowed = new Set([
      'plan.previewed',
      'plan.applied',
      'plan.reverted',
      'plan.failed',
      'artifact.sent-to-canvas',
      'run.linked',
      'run.artifacts-verified',
      'delivery.approval-requested',
      'delivery.completed',
      'delivery.denied',
      'delivery.failed',
    ]);
    if (!allowed.has(type)) throw new CreatorAgentSessionError('CREATOR_EVENT_TYPE_INVALID', '创作事件类型无效');
    let normalizedPayload = payload;
    if (type === 'plan.previewed') {
      session.status = 'previewed';
    } else if (type === 'plan.applied' || type === 'plan.reverted') {
      const normalizeRevision = (value) => {
        const revision = Number(value);
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
      };
      const canvasEvidence = payload?.canvasEvidence && typeof payload.canvasEvidence === 'object'
        ? {
            source: boundedText(payload.canvasEvidence.source, 80),
            status: boundedText(payload.canvasEvidence.status, 40),
            actorId: boundedText(payload.canvasEvidence.actorId, 160),
            operationCount: Math.max(0, Math.min(10_000, Number(payload.canvasEvidence.operationCount) || 0)),
          }
        : null;
      normalizedPayload = {
        schema: 't8-creator-canvas-lifecycle-v1',
        planId: boundedText(payload?.planId, 160),
        planDigest: boundedText(payload?.planDigest, 160),
        patchId: boundedText(payload?.patchId, 160),
        previewDigest: /^[a-f0-9]{64}$/i.test(String(payload?.previewDigest || ''))
          ? String(payload.previewDigest).toLowerCase() : '',
        appliedRevision: normalizeRevision(payload?.appliedRevision),
        ...(type === 'plan.reverted'
          ? { revertedRevision: normalizeRevision(payload?.revertedRevision) }
          : {}),
        duplicate: payload?.duplicate === true,
        canvasEvidence,
        productionEvidence: normalizeCreatorProductionEvidence(payload?.productionEvidence),
      };
      const duplicate = (Array.isArray(session.events) ? session.events : []).some((event) => (
        event?.type === type
        && String(event?.payload?.planId || '') === normalizedPayload.planId
        && String(event?.payload?.patchId || '') === normalizedPayload.patchId
        && Number(event?.payload?.appliedRevision) === Number(normalizedPayload.appliedRevision)
        && (type !== 'plan.reverted'
          || Number(event?.payload?.revertedRevision) === Number(normalizedPayload.revertedRevision))
      ));
      if (duplicate) {
        reconcileToolProposalExecutionWritebacks(session);
        return read(session.id);
      }
      session.status = 'active';
      if (type === 'plan.applied') {
        const recordedAt = new Date(now()).toISOString();
        const evidence = normalizedPayload.productionEvidence;
        if (evidence?.verified) {
          transitionCreatorProduction(session, evidence.currentPhase, {
            ...(evidence.authoritative
              ? { authoritativeCompletedPhases: evidence.completedPhases }
              : { completedPhases: evidence.completedPhases }),
            reason: `已通过画布 Patch 台账核验 ${evidence.action || '创作'} 动作`,
            recordedAt,
            checkpoint: creatorProductionCheckpoint(type, normalizedPayload, recordedAt),
          });
        } else {
          clearCreatorProductionBlock(
            session,
            creatorProductionCheckpoint(type, normalizedPayload, recordedAt),
          );
        }
      } else {
        const recordedAt = new Date(now()).toISOString();
        const evidence = normalizedPayload.productionEvidence;
        transitionCreatorProduction(session, evidence?.currentPhase || session.production.currentPhase, {
          ...(evidence?.authoritative
            ? { authoritativeCompletedPhases: evidence.completedPhases }
            : {}),
          invalidateFromPhase: evidence?.currentPhase || phaseForPlan(session.latestPlan, session.phase),
          reason: `已撤回 ${evidence?.action || '创作'} 的画布变更`,
          recordedAt,
          checkpoint: creatorProductionCheckpoint(type, normalizedPayload, recordedAt),
        });
      }
      session.lastFailure = null;
    } else if (type === 'plan.failed') {
      session.status = 'active';
      const recordedAt = new Date(now()).toISOString();
      session.lastFailure = {
        message: boundedText(payload?.error, 2_000) || '创作计划执行失败',
        at: recordedAt,
      };
      blockCreatorProduction(session, session.lastFailure.message, {
        recordedAt,
        checkpoint: creatorProductionCheckpoint(type, payload, recordedAt),
      });
    } else if (type === 'artifact.sent-to-canvas') {
      normalizedPayload = {
        schema: 't8-creator-artifact-canvas-evidence-v1',
        planId: boundedText(payload?.planId, 160),
        planDigest: boundedText(payload?.planDigest, 160),
        patchId: boundedText(payload?.patchId, 160),
        assetId: boundedText(payload?.assetId, 160),
        contentHash: /^[a-f0-9]{64}$/i.test(String(payload?.contentHash || ''))
          ? String(payload.contentHash).toLowerCase()
          : '',
        nodeId: boundedText(payload?.nodeId, 160),
        appliedRevision: Number.isSafeInteger(Number(payload?.appliedRevision))
          && Number(payload.appliedRevision) >= 0
          ? Number(payload.appliedRevision)
          : null,
        duplicate: payload?.duplicate === true,
        recordedAt: new Date(now()).toISOString(),
      };
      if (!normalizedPayload.planId
        || !normalizedPayload.planDigest
        || !normalizedPayload.patchId
        || !normalizedPayload.assetId
        || !normalizedPayload.contentHash
        || !normalizedPayload.nodeId
        || normalizedPayload.appliedRevision == null) {
        throw new CreatorAgentSessionError(
          'CREATOR_ARTIFACT_CANVAS_EVIDENCE_INVALID',
          '素材发送到画布的完成证据不完整',
        );
      }
      const duplicate = (Array.isArray(session.events) ? session.events : []).some((event) => (
        event?.type === type
        && event?.payload?.patchId === normalizedPayload.patchId
        && event?.payload?.assetId === normalizedPayload.assetId
      ));
      if (duplicate) {
        reconcileToolProposalExecutionWritebacks(session);
        return read(session.id);
      }
      session.status = 'active';
      session.lastFailure = null;
      clearCreatorProductionBlock(
        session,
        creatorProductionCheckpoint(type, normalizedPayload, normalizedPayload.recordedAt),
      );
    } else if (type === 'run.linked') {
      normalizedPayload = {
        schema: 't8-creator-run-link-v1',
        planId: boundedText(payload?.planId, 160),
        planDigest: boundedText(payload?.planDigest, 160),
        patchId: boundedText(payload?.patchId, 160),
        runId: boundedText(payload?.runId, 160),
        runIntentId: boundedText(payload?.runIntentId, 160),
        matchedNodeIds: [...new Set((Array.isArray(payload?.matchedNodeIds) ? payload.matchedNodeIds : [])
          .map((value) => boundedText(value, 160))
          .filter(Boolean))].slice(0, 64),
        linkedAt: new Date(now()).toISOString(),
      };
      if (!normalizedPayload.planId || !normalizedPayload.runId || !normalizedPayload.matchedNodeIds.length) {
        throw new CreatorAgentSessionError('CREATOR_RUN_LINK_INVALID', '真实运行关联缺少计划、Run 或节点证据');
      }
      const duplicate = session.runLinks.some((link) => (
        link?.planId === normalizedPayload.planId && link?.runId === normalizedPayload.runId
      ));
      if (duplicate) {
        reconcileToolProposalExecutionWritebacks(session);
        return read(session.id);
      }
      session.runLinks = [...session.runLinks, normalizedPayload].slice(-100);
      session.status = 'active';
      session.lastFailure = null;
    } else if (type === 'run.artifacts-verified') {
      const verification = payload?.verification && typeof payload.verification === 'object'
        ? payload.verification
        : {};
      const normalizeList = (value, limit = 64, textLimit = 200) => (
        [...new Set((Array.isArray(value) ? value : [])
          .map((item) => boundedText(item, textLimit))
          .filter(Boolean))].slice(0, limit)
      );
      const normalizedRun = verification.run && typeof verification.run === 'object'
        ? {
            runId: boundedText(verification.run.runId, 160),
            status: boundedText(verification.run.status, 40),
            canvasRevision: verification.run.canvasRevision != null
              && Number.isSafeInteger(Number(verification.run.canvasRevision))
              ? Number(verification.run.canvasRevision)
              : null,
            createdAt: verification.run.createdAt == null ? null : Number(verification.run.createdAt),
            finishedAt: verification.run.finishedAt == null ? null : Number(verification.run.finishedAt),
          }
        : null;
      const normalizedNodeRuns = (Array.isArray(verification.nodeRuns) ? verification.nodeRuns : [])
        .slice(0, 100)
        .map((nodeRun) => ({
          nodeRunId: boundedText(nodeRun?.nodeRunId, 160),
          nodeId: boundedText(nodeRun?.nodeId, 160),
          status: boundedText(nodeRun?.status, 40),
          latestAttemptId: boundedText(nodeRun?.latestAttemptId, 160) || null,
          latestAttemptStatus: boundedText(nodeRun?.latestAttemptStatus, 40) || null,
          outputAssetIds: normalizeList(nodeRun?.outputAssetIds, 64, 160),
        }))
        .filter((nodeRun) => nodeRun.nodeRunId);
      const normalizedAssets = (Array.isArray(verification.assets) ? verification.assets : [])
        .slice(0, 100)
        .map((asset) => ({
          assetId: boundedText(asset?.assetId, 160),
          nodeRunId: boundedText(asset?.nodeRunId, 160),
          kind: boundedText(asset?.kind, 40) || null,
          mimeType: boundedText(asset?.mimeType, 160) || null,
          contentHash: boundedText(asset?.contentHash, 160) || null,
          availability: boundedText(asset?.availability, 40) || null,
          stored: asset?.stored === true,
          blobPresent: asset?.blobPresent === true,
          hashVerified: asset?.hashVerified === true,
          magicVerified: asset?.magicVerified === true,
          detectedKind: boundedText(asset?.detectedKind, 40) || null,
          detectedMimeType: boundedText(asset?.detectedMimeType, 160) || null,
          observedContentHash: boundedText(asset?.observedContentHash, 160) || null,
          byteSize: asset?.byteSize != null
            && Number.isSafeInteger(Number(asset.byteSize)) && Number(asset.byteSize) >= 0
            ? Number(asset.byteSize)
            : null,
          width: asset?.width != null
            && Number.isFinite(Number(asset.width)) && Number(asset.width) > 0
            ? Number(asset.width)
            : null,
          height: asset?.height != null
            && Number.isFinite(Number(asset.height)) && Number(asset.height) > 0
            ? Number(asset.height)
            : null,
          duration: asset?.duration != null
            && Number.isFinite(Number(asset.duration)) && Number(asset.duration) > 0
            ? Number(asset.duration)
            : null,
          decodeEvidence: boundedText(asset?.decodeEvidence, 80) || 'not-recorded',
          associationVerified: asset?.associationVerified === true,
          expectedNodeId: boundedText(asset?.expectedNodeId, 160) || null,
          expectedShotIds: normalizeList(asset?.expectedShotIds, 64, 160),
          observedShotIds: normalizeList(asset?.observedShotIds, 64, 160),
          expectedCanvasRevision: asset?.expectedCanvasRevision != null
            && Number.isSafeInteger(Number(asset.expectedCanvasRevision))
            ? Number(asset.expectedCanvasRevision)
            : null,
        }))
        .filter((asset) => asset.assetId);
      normalizedPayload = {
        schema: 't8-creator-artifact-verification-v1',
        runId: boundedText(payload?.runId, 160),
        verified: verification.verified === true,
        reasons: normalizeList(verification.reasons, 100, 240),
        run: normalizedRun,
        nodeRuns: normalizedNodeRuns,
        assets: normalizedAssets,
        verifiedAt: new Date(now()).toISOString(),
      };
      if (!normalizedPayload.runId) {
        throw new CreatorAgentSessionError('CREATOR_ARTIFACT_VERIFICATION_INVALID', '产物核验缺少 Run 证据');
      }
      normalizedPayload.verificationDigest = crypto.createHash('sha256')
        .update(JSON.stringify({
          runId: normalizedPayload.runId,
          verified: normalizedPayload.verified,
          reasons: normalizedPayload.reasons,
          run: normalizedPayload.run,
          nodeRuns: normalizedPayload.nodeRuns,
          assets: normalizedPayload.assets,
        }))
        .digest('hex');
      const duplicate = session.artifactVerifications.find((item) => (
        item?.runId === normalizedPayload.runId
        && item?.verificationDigest === normalizedPayload.verificationDigest
      ));
      if (duplicate) {
        reconcileToolProposalExecutionWritebacks(session);
        return read(session.id);
      }
      session.artifactVerifications = [
        ...session.artifactVerifications.filter((item) => item?.runId !== normalizedPayload.runId),
        normalizedPayload,
      ].slice(-100);
      const fullyVerified = normalizedPayload.verified
        && normalizedPayload.assets.length > 0
        && normalizedPayload.nodeRuns.length > 0
        && normalizedPayload.nodeRuns.every((nodeRun) => (
          nodeRun.status === 'succeeded' && nodeRun.outputAssetIds.length > 0
        ));
      if (fullyVerified) {
        transitionCreatorProduction(session, 'candidates', {
          completeCurrent: true,
          reason: '真实 Run 产物已完成文件、格式、摘要与运行关联核验',
          recordedAt: normalizedPayload.verifiedAt,
          checkpoint: creatorProductionCheckpoint(type, normalizedPayload, normalizedPayload.verifiedAt),
        });
      }
    } else if (type.startsWith('delivery.')) {
      const approvalRequestId = boundedText(payload?.approvalRequestId, 160);
      const planId = boundedText(payload?.planId, 160);
      if (!approvalRequestId || !planId) {
        throw new CreatorAgentSessionError(
          'CREATOR_DELIVERY_EVENT_INVALID',
          '交付事件缺少计划或确认记录',
        );
      }
      const duplicate = (Array.isArray(session.events) ? session.events : []).find((event) => (
        event?.type === type
        && event?.payload?.approvalRequestId === approvalRequestId
      ));
      if (duplicate) return session;
      const licenseSummary = payload?.licenseSummary && typeof payload.licenseSummary === 'object'
        ? {
            known: Math.max(0, Math.min(100_000, Number(payload.licenseSummary.known) || 0)),
            unknown: Math.max(0, Math.min(100_000, Number(payload.licenseSummary.unknown) || 0)),
          }
        : { known: 0, unknown: 0 };
      normalizedPayload = {
        schema: 't8-creator-delivery-evidence-v1',
        approvalRequestId,
        planId,
        packageName: boundedText(payload?.packageName, 160),
        itemCount: Math.max(0, Math.min(100_000, Number(payload?.itemCount) || 0)),
        totalBytes: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(payload?.totalBytes) || 0)),
        packageDigest: /^[a-f0-9]{64}$/i.test(String(payload?.packageDigest || ''))
          ? String(payload.packageDigest).toLowerCase()
          : '',
        verifiedItems: Math.max(0, Math.min(100_000, Number(payload?.verifiedItems) || 0)),
        verifiedBytes: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(payload?.verifiedBytes) || 0)),
        valid: payload?.valid === true,
        scope: payload?.scope === 'project' ? 'project' : 'canvas',
        canvasRevision: Number.isSafeInteger(Number(payload?.canvasRevision))
          && Number(payload.canvasRevision) >= 0 ? Number(payload.canvasRevision) : null,
        catalogRevision: Number.isSafeInteger(Number(payload?.catalogRevision))
          && Number(payload.catalogRevision) >= 1 ? Number(payload.catalogRevision) : null,
        selectionDigest: /^[a-f0-9]{64}$/i.test(String(payload?.selectionDigest || ''))
          ? String(payload.selectionDigest).toLowerCase()
          : '',
        files: (Array.isArray(payload?.files) ? payload.files : []).slice(0, 500)
          .map((item) => ({
            assetId: boundedText(item?.assetId, 240),
            size: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(item?.size) || 0)),
            sha256: /^[a-f0-9]{64}$/i.test(String(item?.sha256 || ''))
              ? String(item.sha256).toLowerCase()
              : '',
          }))
          .filter((item) => item.assetId && item.sha256),
        licenseSummary,
        expiresAt: boundedText(payload?.expiresAt, 80),
        error: boundedText(payload?.error, 2_000),
        status: type === 'delivery.completed'
          ? 'completed'
          : type === 'delivery.denied'
            ? 'denied'
            : type === 'delivery.failed'
              ? 'failed'
              : 'pending',
        recordedAt: new Date(now()).toISOString(),
      };
      transitionCreatorProduction(session, 'delivery', {
        completeCurrent: type === 'delivery.completed' && normalizedPayload.valid,
        reason: type === 'delivery.completed'
          ? '交付包已完成本地核验'
          : type === 'delivery.approval-requested'
            ? '已进入交付确认'
            : '交付阶段状态更新',
        recordedAt: normalizedPayload.recordedAt,
        checkpoint: creatorProductionCheckpoint(type, normalizedPayload, normalizedPayload.recordedAt),
      });
      session.status = type === 'delivery.approval-requested' ? 'awaiting-approval' : 'active';
      if (type === 'delivery.failed') {
        session.lastFailure = {
          message: normalizedPayload.error || '交付包创建失败',
          at: normalizedPayload.recordedAt,
        };
        blockCreatorProduction(session, session.lastFailure.message, {
          recordedAt: normalizedPayload.recordedAt,
          checkpoint: creatorProductionCheckpoint(type, normalizedPayload, normalizedPayload.recordedAt),
        });
      } else if (type === 'delivery.completed') {
        session.lastFailure = null;
        session.deliveryEvidence = [
          ...(Array.isArray(session.deliveryEvidence) ? session.deliveryEvidence : [])
            .filter((item) => item?.approvalRequestId !== approvalRequestId),
          normalizedPayload,
        ].slice(-50);
      }
    }
    appendEvent(session, type, normalizedPayload);
    if (['plan.applied', 'run.linked', 'run.artifacts-verified'].includes(type)) {
      const runId = boundedText(normalizedPayload?.runId, 160);
      const linkedPlanId = type === 'run.artifacts-verified'
        ? boundedText(
            (Array.isArray(session.runLinks) ? session.runLinks : [])
              .find((link) => boundedText(link?.runId, 160) === runId)?.planId,
            160,
          )
        : boundedText(normalizedPayload?.planId, 160);
      if (linkedPlanId) {
        const preparedEvents = (Array.isArray(session.events) ? session.events : [])
          .filter((event) => (
            event?.type === 'assistant.tool-proposal.prepared'
            && boundedText(event?.payload?.planId, 160) === linkedPlanId
          ));
        const stage = type === 'plan.applied'
          ? 'applied'
          : type === 'run.linked'
            ? 'running'
            : normalizedPayload?.verified === true ? 'verified' : 'verification-failed';
        for (const prepared of preparedEvents) {
          const proposalId = boundedText(prepared.payload?.proposalId, 80);
          const proposalDigest = boundedText(prepared.payload?.proposalDigest, 64).toLowerCase();
          const priorWritebacks = (Array.isArray(session.events) ? session.events : [])
            .filter((event) => (
              event?.type === 'assistant.tool-proposal.writeback'
              && event?.payload?.proposalId === proposalId
              && event?.payload?.proposalDigest === proposalDigest
              && event?.payload?.planId === linkedPlanId
            ));
          const priorEvidence = priorWritebacks.reduce((evidence, event) => ({
            canvasWriteRecorded: evidence.canvasWriteRecorded
              || event?.payload?.evidence?.canvasWriteRecorded === true,
            providerRunLinked: evidence.providerRunLinked
              || event?.payload?.evidence?.providerRunLinked === true,
          }), { canvasWriteRecorded: false, providerRunLinked: false });
          const duplicate = session.events.some((event) => (
            event?.type === 'assistant.tool-proposal.writeback'
            && event?.payload?.proposalId === proposalId
            && event?.payload?.proposalDigest === proposalDigest
            && event?.payload?.stage === stage
            && event?.payload?.runId === (runId || null)
          ));
          if (duplicate) continue;
          appendEvent(session, 'assistant.tool-proposal.writeback', {
            schema: 't8-creator-tool-proposal-execution-v1',
            proposalId,
            proposalDigest,
            planId: linkedPlanId,
            planDigest: boundedText(prepared.payload?.planDigest, 160),
            workId: boundedText(prepared.payload?.workId, 80) || null,
            workRevision: Number.isSafeInteger(Number(prepared.payload?.workRevision))
              ? Number(prepared.payload.workRevision) : null,
            workDigest: boundedText(prepared.payload?.workDigest, 64).toLowerCase() || null,
            requestedOperation: boundedText(prepared.payload?.requestedOperation, 40),
            capabilityId: boundedText(prepared.payload?.capabilityId, 160),
            stage,
            evidenceEventType: type,
            runId: runId || null,
            evidenceDigest: boundedText(
              normalizedPayload?.verificationDigest || normalizedPayload?.bindingDigest,
              160,
            ) || null,
            evidence: {
              canvasWriteRecorded: priorEvidence.canvasWriteRecorded || type === 'plan.applied',
              providerRunLinked: priorEvidence.providerRunLinked || type === 'run.linked',
              physicalArtifactsVerified: type === 'run.artifacts-verified'
                && normalizedPayload?.verified === true,
            },
          });
        }
      }
    }
    return read(session.id);
  }

  function reviseWorkArtifactVersion(sessionId, input = {}) {
    return withSessionLock(sessionId, 'work-artifact-revise', () => {
      const session = read(sessionId);
      const result = reviseWorkArtifact({
        existingVersions: session.workArtifactVersions,
        artifactId: input.artifactId,
        baseVersionId: input.baseVersionId,
        action: input.action,
        field: input.field,
        value: input.value,
        actor: input.actor || 'creator',
        createdAt: new Date(now()).toISOString(),
      });
      if (result.status === 'blocked') {
        const messages = {
          'work-artifact-stale': '作品已更新，请基于最新版本继续编辑',
          'work-field-invalid': '这个字段不属于当前作品类型',
          'work-field-locked': '该字段已锁定；请先明确解锁后再修改',
          'work-field-value-invalid': '字段内容无法安全保存',
          'work-action-invalid': '不支持这个作品操作',
        };
        throw new CreatorAgentSessionError(
          String(result.code || 'CREATOR_WORK_REVISION_BLOCKED').toUpperCase().replace(/-/g, '_'),
          messages[result.code] || '当前作品修改已被安全阻止',
          409,
          { artifactId: boundedText(input.artifactId, 80), field: boundedText(input.field, 120) },
        );
      }
      if (result.status === 'reused') {
        return { session, artifactVersion: result.artifactVersion, duplicate: true };
      }
      session.workArtifactVersions = normalizeWorkArtifactVersions(result.versions);
      session.workArtifacts = workArtifactSummaries(session.workArtifactVersions);
      const latest = latestWorkArtifactVersions(session.workArtifactVersions);
      const updatedAt = result.artifactVersion.createdAt;
      const snapshot = {
        schema: 't8-creator-work-snapshot-v1',
        workId: session.creatorWork?.workId
          || `cw_${creatorDigest({ schema: 't8-creator-work-snapshot-v1', sessionId: session.id }).slice(0, 32)}`,
        revision: session.creatorWork ? session.creatorWork.revision + 1 : 1,
        taskProfile: session.creatorWork?.taskProfile || {
          family: 'mixed',
          intent: '继续编辑当前作品',
          deliveryKind: 'editable-work',
          modalities: [],
          targetPlatform: null,
          qualityMode: 'standard',
        },
        artifactVersionIds: latest.map((version) => version.versionId),
        changedArtifactIds: [result.artifactVersion.artifactId],
        invalidatedKinds: result.artifactVersion.invalidates || [],
        updatedAt,
      };
      snapshot.workDigest = creatorDigest(snapshot);
      session.creatorWork = normalizeCreatorWorkSnapshot(snapshot);
      if (!session.creatorWork) {
        throw new CreatorAgentSessionError(
          'CREATOR_WORK_SNAPSHOT_INVALID',
          '作品修改后的快照无法验证，已停止写入',
          409,
        );
      }
      if (input.action === 'accept') {
        // Accept is an explicit creator approval of the currently visible
        // structured work. Resolve any still-pending choice questions to the
        // values already present in that accepted work, but leave the final
        // stage-confirmation decision pending. This avoids asking the creator
        // to re-answer decisions their approved draft already embodies while
        // preserving a separate explicit gate before the phase advances.
        acceptCreatorWorkAsCurrentDecisionDefaults(session, result.artifactVersion);
      }
      session.suggestionSet = creatorSuggestionSet(
        { ...session.context, phase: session.production.currentPhase },
        session.latestPlan,
        {
          production: session.production,
          decisionDocument: session.decisionDocument,
          workSnapshot: session.creatorWork,
          // Accepting the current typed work is an explicit creator signal
          // that the draft is ready for the existing production-document
          // confirmation gate. Rebind the three suggestions to the new work
          // digest and keep the exact confirm-and-continue action available;
          // otherwise the safe stale-digest refresh strands the creator on a
          // generic "draft this stage" suggestion after clicking Accept.
          stageReadyForConfirmation: input.action === 'accept'
            && session.latestPlan?.ready === true
            && Array.isArray(session.latestPlan?.productionDocuments)
            && session.latestPlan.productionDocuments.length > 0,
        },
      );
      session.suggestions = session.suggestionSet.items.map((item) => item.label);
      const event = appendEvent(session, 'work.artifact.revised', {
        action: boundedText(input.action, 40),
        field: boundedText(input.field, 120) || null,
        artifactVersion: result.artifactVersion,
        work: session.creatorWork,
        suggestionSet: session.suggestionSet,
        suggestionInvariantReceipt: session.suggestionSet.invariantReceipt,
        sideEffects: { providerCalls: 0, canvasWrites: 0, fileWrites: 0 },
      });
      return {
        session: read(session.id),
        artifactVersion: result.artifactVersion,
        event,
        duplicate: false,
      };
    });
  }

  return {
    appendResponseDelta,
    appendRunEvents,
    appendActionPlan,
    confirmProductionDocuments,
    appendLifecycle,
    appendTurn,
    beginStreamingTurn,
    completeStreamingTurn,
    create,
    eventsAfter,
    failStreamingTurn,
    list,
    stopStreamingTurn,
    messageRequest,
    productionDocumentsForNextPlan,
    prepareToolProposal,
    read,
    reconcileToolProposalWritebacks,
    recordToolProposal,
    reviseWorkArtifactVersion,
    rootDir,
  };
}

module.exports = {
  CREATOR_AGENT_EVENT_SCHEMA,
  CREATOR_AGENT_SESSION_SCHEMA,
  CREATOR_PRODUCTION_DOCUMENT_CONFIRMATION_SCHEMA,
  CREATOR_PRODUCTION_PHASES,
  CREATOR_PRODUCTION_STATE_SCHEMA,
  CreatorAgentSessionError,
  assistantMessageForPlan,
  completedPhasesForPlan,
  createCreatorAgentSessionStore,
  creatorResponseChunks,
  creatorSuggestions,
  creatorSuggestionSet,
  creatorSuggestionInvariantReceipt,
  creatorAttachmentOnlyPrompt,
  creatorSuggestionBinding,
  inferCreatorKind,
  inferCreatorRecipe,
  normalizeAttachments,
  normalizeCreativePhase,
  normalizeContext,
  normalizeCreatorProductionState,
  normalizeStoredPatch,
  phaseForPlan,
  resolveCreatorSuggestionSelection,
};
