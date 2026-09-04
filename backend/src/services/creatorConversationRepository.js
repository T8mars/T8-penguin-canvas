'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  createScopedWorkArtifactMutation,
  normalizeCreatorWorkSnapshot,
  normalizeScopeKey,
  normalizeWorkArtifactVersion,
  workArtifactSummaries,
} = require('./creatorAgentWorkArtifacts');
const {
  currentSceneSourcePart,
  readLongScriptWork,
  sceneDraftScopeKey,
  sceneScopeKey,
} = require('./creatorLongScriptWork');
const { sceneProductionScopeKey } = require('./creatorSceneProduction');

const CREATOR_CONVERSATION_SCHEMA = 't8-creator-conversation-v2';
const CREATOR_PHASES = new Set(['idea', 'script', 'assets', 'shots', 'candidates', 'delivery']);
const CREATOR_PHASE_ORDER = ['idea', 'script', 'assets', 'shots', 'candidates', 'delivery'];
const CREATOR_STATUSES = new Set(['active', 'completed', 'archived']);
const MESSAGE_ROLES = new Set(['user', 'assistant']);
const MESSAGE_STATUSES = new Set(['streaming', 'completed', 'failed', 'stopped']);
const ACTION_STATUSES = new Set(['pending', 'running', 'ambiguous', 'completed', 'failed', 'cancelled']);
const ACTION_TYPES = new Set(['image', 'video']);
const SHOT_STATUSES = new Set(['pending', 'running', 'ambiguous', 'completed', 'failed', 'cancelled']);
const SUGGESTION_ROLES = new Set(['recommended', 'alternative', 'execute']);
const FORBIDDEN_PREFERENCE_KEYS = /(api.?key|token|secret|password|price|cost|balance|quota|billing|currency|fee)/iu;

class CreatorConversationError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'CreatorConversationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function bounded(value, maximum = 2_000) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function creatorCreationMode(value) {
  return bounded(value, 24).toLowerCase() === 'scene' ? 'scene' : 'auto';
}

function creatorMessageRequestDigest(body, attachments, selectedNodes, creationMode, includeMode = true) {
  return digest({
    body,
    attachments: attachments.map((item) => ({
      assetId: item.assetId, kind: item.kind, contentHash: item.contentHash, contentRevision: item.contentRevision,
    })),
    selectedNodes,
    ...(includeMode ? { creationMode: creatorCreationMode(creationMode) } : {}),
  });
}

function requiredId(value, label) {
  const result = bounded(value, 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/.test(result)) {
    throw new CreatorConversationError('CREATOR_ID_INVALID', `${label}无效`);
  }
  return result;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function suggestionRecord(item, index) {
  if (typeof item === 'string') {
    const label = bounded(item, 120);
    return label ? {
      label,
      sendText: label,
      intentKind: ['recommended-next-step', 'alternative-direction', 'execute-or-confirm'][index],
      role: ['recommended', 'alternative', 'execute'][index],
      inputAssetIds: [],
    } : null;
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const label = bounded(item.label, 120);
  const sendText = bounded(item.sendText || item.label, 2_000);
  const intentKind = bounded(item.intentKind, 80).toLowerCase();
  const role = bounded(item.role, 24).toLowerCase();
  if (!label || !sendText || !intentKind || !SUGGESTION_ROLES.has(role)) return null;
  return {
    label,
    sendText,
    intentKind,
    role,
    inputAssetIds: [...new Set((Array.isArray(item.inputAssetIds) ? item.inputAssetIds : [])
      .map((assetId) => bounded(assetId, 180)).filter(Boolean))].slice(0, 12),
  };
}

function suggestions(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new CreatorConversationError('CREATOR_SUGGESTIONS_INVALID', '每条完整回复必须包含三个建议');
  }
  const normalized = value.map(suggestionRecord).filter(Boolean);
  if (normalized.length !== 3
    || new Set(normalized.map((item) => item.label)).size !== 3
    || new Set(normalized.map((item) => item.intentKind)).size !== 3
    || new Set(normalized.map((item) => item.role)).size !== 3) {
    throw new CreatorConversationError('CREATOR_SUGGESTIONS_INVALID', '三个建议必须简短且互不重复');
  }
  return normalized;
}

function workingBrief(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    goal: bounded(source.goal, 1_000),
    format: bounded(source.format, 400),
    audience: bounded(source.audience, 400),
    style: bounded(source.style, 1_000),
    story: bounded(source.story, 2_000),
    assets: bounded(source.assets, 2_000),
    constraints: bounded(source.constraints, 2_000),
    decisions: bounded(source.decisions, 2_000),
    openQuestion: bounded(source.openQuestion, 1_000),
  };
}

function mergeWorkingBriefPatch(currentValue = {}, patchValue = {}) {
  const current = workingBrief(currentValue);
  const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue) ? patchValue : {};
  const incoming = workingBrief(patch);
  const next = { ...current };
  Object.keys(current).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
    // Empty model fields must not silently erase long-lived creative facts.
    // openQuestion is the only transient field: an explicit empty value means
    // that the user answered it or delegated the decision.
    if (field === 'openQuestion' || incoming[field]) next[field] = incoming[field];
  });
  return workingBrief(next);
}

function normalizedPhaseEvidence(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    source: bounded(source.source, 80) || 'llm-turn',
    requestedPhase: CREATOR_PHASES.has(source.requestedPhase) ? source.requestedPhase : null,
    acceptedPhase: CREATOR_PHASES.has(source.acceptedPhase) ? source.acceptedPhase : null,
    transition: ['advance', 'stay', 'revise'].includes(source.transition) ? source.transition : 'stay',
    reason: bounded(source.reason, 600),
    at: Math.max(0, Math.trunc(Number(source.at) || Date.now())),
  };
}

function resolvedConversationContext(row, input = {}) {
  const currentBrief = workingBrief(parseJson(row.working_brief_json, {}));
  const nextBrief = mergeWorkingBriefPatch(currentBrief, input.workingBrief);
  const requestedPhase = CREATOR_PHASES.has(input.phaseDecision?.phase) ? input.phaseDecision.phase : row.phase;
  const transition = ['advance', 'stay', 'revise'].includes(input.phaseDecision?.transition)
    ? input.phaseDecision.transition : 'stay';
  const currentIndex = CREATOR_PHASE_ORDER.indexOf(row.phase);
  const requestedIndex = CREATOR_PHASE_ORDER.indexOf(requestedPhase);
  let acceptedPhase = row.phase;
  // An LLM may organize the early creative brief or deliberately revise an
  // earlier step. Production stages are advanced only by durable actions.
  if (transition === 'revise' && requestedIndex >= 0 && requestedIndex < currentIndex) acceptedPhase = requestedPhase;
  else if (transition === 'advance'
    && currentIndex <= 2
    && requestedIndex === currentIndex + 1
    && requestedIndex <= 2) acceptedPhase = requestedPhase;
  const evidence = normalizedPhaseEvidence({
    source: input.source || 'llm-turn',
    requestedPhase,
    acceptedPhase,
    transition,
    reason: input.phaseDecision?.reason,
    at: Date.now(),
  });
  return { acceptedPhase, nextBrief, evidence };
}

function mediaRefs(value, maximum = 12) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > maximum) throw new CreatorConversationError('CREATOR_MEDIA_LIMIT', `单条记录最多引用 ${maximum} 个素材`);
  return items.map((item) => {
    const kind = bounded(item?.kind, 16).toLowerCase();
    if (!['image', 'video', 'audio', 'file'].includes(kind)) {
      throw new CreatorConversationError('CREATOR_MEDIA_INVALID', '素材类型无效');
    }
    return {
      assetId: requiredId(item?.assetId, '素材 ID'),
      kind,
      contentHash: bounded(item?.contentHash, 128) || null,
      contentRevision: Math.max(1, Math.trunc(Number(item?.contentRevision) || 1)),
      mimeType: bounded(item?.mimeType, 120) || null,
      duration: Math.max(0, Math.min(86_400, Number(item?.duration) || 0)),
      ref: bounded(item?.ref || item?.previewUrl, 2_000) || null,
      previewUrl: bounded(item?.previewUrl, 2_000) || null,
      title: bounded(item?.title, 240) || null,
      shotId: bounded(item?.shotId, 180) || null,
      shotOrdinal: Math.max(0, Math.trunc(Number(item?.shotOrdinal) || 0)) || null,
      outputIndex: Math.max(0, Math.trunc(Number(item?.outputIndex) || 0)),
      audioObservation: item?.audioObservation && typeof item.audioObservation === 'object'
        ? item.audioObservation : null,
      documentObservation: item?.documentObservation && typeof item.documentObservation === 'object'
        ? item.documentObservation : null,
    };
  });
}

function selectedNodeRefs(value) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 24) throw new CreatorConversationError('CREATOR_SELECTED_NODE_LIMIT', '单条消息最多引用 24 个画布节点');
  return items.map((item) => ({
    nodeId: requiredId(item?.nodeId, '画布节点 ID'),
    type: bounded(item?.type, 120),
    label: bounded(item?.label, 240),
    assetId: bounded(item?.assetId, 180) || null,
    content: bounded(item?.content, 6_000) || null,
  }));
}

function modelSnapshot(value, expectedKind = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreatorConversationError('CREATOR_MODEL_SNAPSHOT_REQUIRED', '生成动作缺少模型快照');
  }
  const result = {
    providerId: requiredId(value.providerId, '渠道 ID'),
    modelId: bounded(value.modelId, 240),
    catalogDigest: bounded(value.catalogDigest, 128).toLowerCase(),
    kind: bounded(value.kind || expectedKind, 16).toLowerCase(),
  };
  if (!result.modelId || !/^[a-f0-9]{64}$/.test(result.catalogDigest)) {
    throw new CreatorConversationError('CREATOR_MODEL_SNAPSHOT_INVALID', '模型或目录快照无效');
  }
  if (expectedKind && result.kind !== expectedKind) {
    throw new CreatorConversationError('CREATOR_MODEL_KIND_MISMATCH', '模型类型与动作不一致');
  }
  return result;
}

function sceneActionWorkBinding(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 't8-creator-scene-action-binding-v1') {
    throw new CreatorConversationError('CREATOR_ACTION_WORK_BINDING_INVALID', '当前场生成绑定无效');
  }
  const result = {
    schema: 't8-creator-scene-action-binding-v1',
    workId: bounded(value.workId, 180) || null,
    workRevision: Math.max(0, Math.trunc(Number(value.workRevision) || 0)),
    workDigest: bounded(value.workDigest, 64).toLowerCase() || null,
    sceneId: requiredId(value.sceneId, '场次 ID'),
    scenePartId: bounded(value.scenePartId, 180) || null,
    sceneRevision: Math.max(1, Math.trunc(Number(value.sceneRevision) || 1)),
    contextDigest: bounded(value.contextDigest, 64).toLowerCase(),
    shotIds: [...new Set((Array.isArray(value.shotIds) ? value.shotIds : [])
      .map((item) => requiredId(item, '镜头 ID')))].slice(0, 12),
    shotPlanDigest: bounded(value.shotPlanDigest, 64).toLowerCase() || null,
  };
  if ((result.workDigest && !/^[a-f0-9]{64}$/.test(result.workDigest))
    || !/^[a-f0-9]{64}$/.test(result.contextDigest)
    || (result.shotPlanDigest && !/^[a-f0-9]{64}$/.test(result.shotPlanDigest))) {
    throw new CreatorConversationError('CREATOR_ACTION_WORK_BINDING_INVALID', '当前场生成绑定缺少完整版本证据');
  }
  return result;
}

function actionShotParameters(value, type) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return type === 'image' ? {
    ratio: bounded(source.ratio, 16) || '16:9',
    count: Math.max(1, Math.min(4, Math.trunc(Number(source.count) || 1))),
  } : {
    ratio: bounded(source.ratio, 16) || '16:9',
    duration: Math.max(1, Math.min(30, Number(source.duration) || 6)),
    resolution: bounded(source.resolution, 24) || '720p',
  };
}

function actionShots(value, type) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 12) throw new CreatorConversationError('CREATOR_SHOT_LIMIT', '单场最多生成 12 个镜头');
  const normalized = items.map((item, index) => {
    const shotId = requiredId(item?.shotId, '镜头 ID');
    const prompt = bounded(item?.prompt, 20_000);
    if (!prompt) throw new CreatorConversationError('CREATOR_ACTION_PROMPT_EMPTY', '镜头缺少提示词');
    const status = bounded(item?.status || 'pending', 24).toLowerCase();
    if (!SHOT_STATUSES.has(status)) throw new CreatorConversationError('CREATOR_SHOT_STATUS_INVALID', '镜头状态无效');
    return {
      shotId,
      ordinal: Math.max(1, Math.min(12, Math.trunc(Number(item?.ordinal) || index + 1))),
      title: bounded(item?.title, 240) || `镜头 ${index + 1}`,
      prompt,
      parameters: actionShotParameters(item?.parameters, type),
      inputAssetIds: [...new Set((Array.isArray(item?.inputAssetIds) ? item.inputAssetIds : [])
        .map((assetId) => requiredId(assetId, '输入素材 ID')))].slice(0, 12),
      status,
      resultAssets: mediaRefs(item?.resultAssets, 48),
      runId: bounded(item?.runId, 180) || null,
      nodeRunId: bounded(item?.nodeRunId, 180) || null,
      attemptId: bounded(item?.attemptId, 180) || null,
      errorCode: bounded(item?.errorCode, 120) || null,
      errorMessage: bounded(item?.errorMessage, 1_000) || null,
    };
  });
  if (new Set(normalized.map((shot) => shot.shotId)).size !== normalized.length) {
    throw new CreatorConversationError('CREATOR_SHOT_ID_CONFLICT', '同一场内镜头 ID 不能重复');
  }
  return normalized.sort((left, right) => left.ordinal - right.ordinal
    || left.shotId.localeCompare(right.shotId));
}

function immutableShotSpecs(shots) {
  return shots.map((shot) => ({
    shotId: shot.shotId,
    ordinal: shot.ordinal,
    title: shot.title,
    prompt: shot.prompt,
    parameters: shot.parameters,
    inputAssetIds: shot.inputAssetIds,
  }));
}

function preferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreatorConversationError('CREATOR_PREFERENCES_INVALID', '生成设置格式无效');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => FORBIDDEN_PREFERENCE_KEYS.test(key))) {
    throw new CreatorConversationError('CREATOR_PREFERENCES_FORBIDDEN', '生成设置包含不受支持的字段');
  }
  const normalizeChoice = (choice) => {
    if (choice == null) return null;
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
      throw new CreatorConversationError('CREATOR_PREFERENCES_INVALID', '模型选择格式无效');
    }
    const providerId = bounded(choice.providerId, 180);
    const modelId = bounded(choice.modelId, 240);
    return providerId && modelId ? { providerId, modelId } : null;
  };
  const result = {
    providerId: bounded(value.providerId, 180) || 'auto',
    llm: normalizeChoice(value.llm),
    image: normalizeChoice(value.image),
    video: normalizeChoice(value.video),
    catalogDigest: bounded(value.catalogDigest, 128).toLowerCase() || null,
  };
  if (result.catalogDigest && !/^[a-f0-9]{64}$/.test(result.catalogDigest)) {
    throw new CreatorConversationError('CREATOR_CATALOG_DIGEST_INVALID', '模型目录版本无效');
  }
  return result;
}

function cursor(value) {
  const result = Math.max(0, Math.trunc(Number(value) || 0));
  return Number.isSafeInteger(result) ? result : 0;
}

function conversationCursor(value) {
  const raw = bounded(value, 400);
  if (!raw) return null;
  const separator = raw.indexOf(':');
  if (separator > 0) {
    const updatedAt = cursor(raw.slice(0, separator));
    const id = bounded(raw.slice(separator + 1), 180);
    if (updatedAt && id) return { updatedAt, id };
  }
  const updatedAt = cursor(raw);
  return updatedAt ? { updatedAt, id: null } : null;
}

function limit(value, fallback = 24, maximum = 100) {
  return Math.max(1, Math.min(maximum, Math.trunc(Number(value) || fallback)));
}

class CreatorConversationRepository {
  constructor(options = {}) {
    const filename = options.filename || ':memory:';
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = options.database || new Database(filename);
    this.ownsDatabase = !options.database;
    this.faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null;
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    if (filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.recoverStagedAssistantResponses();
    this.reconcileInterruptedResponses();
  }

  _injectFault(point, details = {}) {
    if (this.faultInjector) this.faultInjector(point, details);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS creator_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        canvas_id TEXT NOT NULL,
        title TEXT NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        working_brief_json TEXT NOT NULL DEFAULT '{}',
        phase_evidence_json TEXT NOT NULL DEFAULT '{}',
        current_scene_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_creator_conversations_scope
        ON creator_conversations(project_id, canvas_id, updated_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS creator_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        suggestions_json TEXT NOT NULL DEFAULT '[]',
        action_id TEXT,
        media_json TEXT NOT NULL DEFAULT '[]',
        client_request_id TEXT,
        request_digest TEXT,
        response_id TEXT,
        reply_to_message_id TEXT,
        selected_nodes_json TEXT NOT NULL DEFAULT '[]',
        model_snapshot_digest TEXT,
        error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_messages_request
        ON creator_messages(session_id, client_request_id)
        WHERE client_request_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_messages_response
        ON creator_messages(session_id, response_id)
        WHERE response_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_creator_messages_page
        ON creator_messages(session_id, sequence DESC);

      CREATE TABLE IF NOT EXISTS creator_response_drafts (
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        response_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, response_id)
      );

      CREATE TABLE IF NOT EXISTS creator_actions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        request_digest TEXT NOT NULL,
        model_snapshot_json TEXT NOT NULL,
        model_snapshot_digest TEXT NOT NULL,
        input_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        work_binding_json TEXT,
        shots_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        run_intent_id TEXT,
        run_id TEXT,
        result_assets_json TEXT NOT NULL DEFAULT '[]',
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_creator_actions_session
        ON creator_actions(session_id, sequence DESC);

      CREATE TABLE IF NOT EXISTS creator_media_candidates (
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        action_id TEXT NOT NULL REFERENCES creator_actions(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        review_request_id TEXT,
        review_request_digest TEXT,
        review_evidence_json TEXT,
        review_digest TEXT,
        reviewed_at INTEGER,
        adoption_request_id TEXT,
        adoption_request_digest TEXT,
        adoption_receipt_json TEXT,
        adoption_digest TEXT,
        adopted_at INTEGER,
        placement_request_id TEXT,
        placement_request_digest TEXT,
        placement_status TEXT,
        placement_receipt_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, action_id, asset_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_media_review_request
        ON creator_media_candidates(session_id, review_request_id)
        WHERE review_request_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_media_adoption_request
        ON creator_media_candidates(session_id, adoption_request_id)
        WHERE adoption_request_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_media_placement_request
        ON creator_media_candidates(session_id, placement_request_id)
        WHERE placement_request_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS creator_change_log (
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        PRIMARY KEY(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_creator_change_log_cursor
        ON creator_change_log(session_id, sequence ASC);
      INSERT OR IGNORE INTO creator_change_log(session_id, sequence, kind, entity_id)
        SELECT session_id, sequence, 'message', id FROM creator_messages;
      INSERT OR IGNORE INTO creator_change_log(session_id, sequence, kind, entity_id)
        SELECT session_id, sequence, 'action', id FROM creator_actions;

      CREATE TABLE IF NOT EXISTS creator_preferences (
        project_id TEXT NOT NULL,
        canvas_id TEXT NOT NULL,
        preferences_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(project_id, canvas_id)
      );

      CREATE TABLE IF NOT EXISTS creator_work_snapshots (
        session_id TEXT PRIMARY KEY REFERENCES creator_conversations(id) ON DELETE CASCADE,
        work_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        work_digest TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS creator_work_artifact_versions (
        version_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        version_json TEXT NOT NULL,
        version_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, artifact_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_creator_work_versions_artifact
        ON creator_work_artifact_versions(session_id, artifact_id, revision DESC);
      CREATE INDEX IF NOT EXISTS idx_creator_work_versions_scope
        ON creator_work_artifact_versions(session_id, kind, scope_key, revision DESC);
      CREATE TABLE IF NOT EXISTS creator_work_current (
        session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL REFERENCES creator_work_artifact_versions(version_id),
        version_digest TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, kind, scope_key)
      );
    `);
    const conversationColumns = new Set(this.db.prepare('PRAGMA table_info(creator_conversations)').all().map((row) => row.name));
    if (!conversationColumns.has('working_brief_json')) {
      this.db.exec("ALTER TABLE creator_conversations ADD COLUMN working_brief_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!conversationColumns.has('phase_evidence_json')) {
      this.db.exec("ALTER TABLE creator_conversations ADD COLUMN phase_evidence_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!conversationColumns.has('current_scene_id')) {
      this.db.exec('ALTER TABLE creator_conversations ADD COLUMN current_scene_id TEXT');
    }
    const messageColumns = new Set(this.db.prepare('PRAGMA table_info(creator_messages)').all().map((row) => row.name));
    if (!messageColumns.has('reply_to_message_id')) {
      this.db.exec('ALTER TABLE creator_messages ADD COLUMN reply_to_message_id TEXT');
    }
    if (!messageColumns.has('selected_nodes_json')) {
      this.db.exec("ALTER TABLE creator_messages ADD COLUMN selected_nodes_json TEXT NOT NULL DEFAULT '[]'");
    }
    const actionColumns = new Set(this.db.prepare('PRAGMA table_info(creator_actions)').all().map((row) => row.name));
    if (!actionColumns.has('work_binding_json')) {
      this.db.exec('ALTER TABLE creator_actions ADD COLUMN work_binding_json TEXT');
    }
    if (!actionColumns.has('shots_json')) {
      this.db.exec("ALTER TABLE creator_actions ADD COLUMN shots_json TEXT NOT NULL DEFAULT '[]'");
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_creator_messages_reply
      ON creator_messages(session_id, reply_to_message_id)
      WHERE reply_to_message_id IS NOT NULL;`);
    this.db.exec(`DROP INDEX IF EXISTS idx_creator_actions_pending;
      CREATE UNIQUE INDEX idx_creator_actions_pending ON creator_actions(session_id)
      WHERE status IN ('pending', 'running', 'ambiguous');`);
  }

  _assistantCompletionPayload(input = {}) {
    const body = bounded(input.body, 80_000);
    if (!body) throw new CreatorConversationError('CREATOR_RESPONSE_EMPTY', '模型没有返回有效内容', 502);
    return {
      body,
      suggestions: suggestions(input.suggestions),
      ...(input.action ? { action: input.action } : {}),
      ...(input.conversationContext ? { conversationContext: input.conversationContext } : {}),
      ...(input.workMutation ? { workMutation: input.workMutation } : {}),
    };
  }

  stageAssistantResult(id, responseId, input = {}, scope = {}) {
    const row = this._requireConversation(id, scope);
    const requiredResponseId = requiredId(responseId, '回复 ID');
    const message = this.db.prepare(`SELECT status FROM creator_messages
      WHERE session_id = ? AND response_id = ?`).get(row.id, requiredResponseId);
    if (!message) throw new CreatorConversationError('CREATOR_RESPONSE_NOT_FOUND', '回复不存在', 404);
    if (message.status !== 'streaming') return { staged: false, status: message.status };
    const payload = this._assistantCompletionPayload(input);
    const payloadDigest = digest(payload);
    const existing = this.db.prepare(`SELECT payload_digest FROM creator_response_drafts
      WHERE session_id = ? AND response_id = ?`).get(row.id, requiredResponseId);
    if (existing && existing.payload_digest !== payloadDigest) {
      throw new CreatorConversationError('CREATOR_RESPONSE_DRAFT_CONFLICT', '同一回复已经绑定另一份模型结果', 409);
    }
    if (!existing) {
      const now = Date.now();
      this.db.prepare(`INSERT INTO creator_response_drafts(
        session_id, response_id, payload_json, payload_digest, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        row.id, requiredResponseId, JSON.stringify(payload), payloadDigest, now, now,
      );
    }
    this._injectFault('response-draft-staged', { sessionId: row.id, responseId: requiredResponseId });
    return { staged: true, payloadDigest };
  }

  _assistantDraft(sessionId, responseId) {
    const row = this.db.prepare(`SELECT * FROM creator_response_drafts
      WHERE session_id = ? AND response_id = ?`).get(sessionId, responseId);
    if (!row) return null;
    const payload = parseJson(row.payload_json, null);
    if (!payload || digest(payload) !== row.payload_digest) {
      throw new CreatorConversationError('CREATOR_RESPONSE_DRAFT_CORRUPT', '已保存的模型结果校验失败', 409);
    }
    return { payload, payloadDigest: row.payload_digest };
  }

  discardAssistantDraft(id, responseId, scope = {}) {
    const row = this._requireConversation(id, scope);
    return this.db.prepare(`DELETE FROM creator_response_drafts
      WHERE session_id = ? AND response_id = ?`).run(row.id, requiredId(responseId, '回复 ID')).changes > 0;
  }

  recoverStagedAssistantResponse(id, responseId, scope = {}) {
    const row = this._requireConversation(id, scope);
    const requiredResponseId = requiredId(responseId, '回复 ID');
    const draft = this._assistantDraft(row.id, requiredResponseId);
    if (!draft) return null;
    return this.completeAssistantResponse(row.id, requiredResponseId, draft.payload);
  }

  recoverStagedAssistantResponses() {
    const drafts = this.db.prepare(`SELECT session_id, response_id FROM creator_response_drafts
      ORDER BY created_at ASC, session_id ASC, response_id ASC`).all();
    let recovered = 0;
    drafts.forEach((draft) => {
      try {
        this.recoverStagedAssistantResponse(draft.session_id, draft.response_id);
        recovered += 1;
      } catch (_) {
        this.db.prepare(`DELETE FROM creator_response_drafts
          WHERE session_id = ? AND response_id = ?`).run(draft.session_id, draft.response_id);
      }
    });
    return recovered;
  }

  reconcileInterruptedResponses() {
    const interrupted = this.db.prepare(`SELECT id, session_id FROM creator_messages
      WHERE role = 'assistant' AND status = 'streaming' ORDER BY session_id, sequence`).all();
    if (!interrupted.length) return 0;
    const now = Date.now();
    this.db.transaction(() => {
      interrupted.forEach((message) => {
        const sequence = this._nextSequence(message.session_id, now);
        this.db.prepare(`UPDATE creator_messages
          SET body = ?, status = 'failed', error_code = 'CREATOR_LLM_INTERRUPTED', updated_at = ?
          WHERE id = ? AND status = 'streaming'`).run('上次回复被应用关闭中断，请重新发送。', now, message.id);
        this._recordChange(message.session_id, sequence, 'message', message.id);
      });
    })();
    return interrupted.length;
  }

  _conversation(id) {
    return this.db.prepare('SELECT * FROM creator_conversations WHERE id = ?').get(id);
  }

  _requireConversation(id, scope = {}) {
    const row = this._conversation(requiredId(id, '会话 ID'));
    if (!row) throw new CreatorConversationError('CREATOR_SESSION_NOT_FOUND', '创作会话不存在', 404);
    if ((scope.projectId && String(scope.projectId) !== row.project_id)
      || (scope.canvasId && String(scope.canvasId) !== row.canvas_id)) {
      throw new CreatorConversationError('CREATOR_SESSION_SCOPE_MISMATCH', '创作会话不属于当前画布', 409);
    }
    return row;
  }

  _nextSequence(sessionId, now = Date.now()) {
    const updated = this.db.prepare(`
      UPDATE creator_conversations
      SET sequence = sequence + 1, updated_at = ?
      WHERE id = ?
      RETURNING sequence
    `).get(now, sessionId);
    if (!updated) throw new CreatorConversationError('CREATOR_SESSION_NOT_FOUND', '创作会话不存在', 404);
    return Number(updated.sequence);
  }

  _recordChange(sessionId, sequence, kind, entityId) {
    this.db.prepare(`INSERT INTO creator_change_log(session_id, sequence, kind, entity_id)
      VALUES (?, ?, ?, ?)`).run(sessionId, sequence, kind, entityId);
  }

  _emit(sessionId, kind, data, sequence = data?.sequence) {
    queueMicrotask(() => this.events.emit(sessionId, { sequence: cursor(sequence), kind, data }));
  }

  subscribe(sessionId, listener) {
    const id = requiredId(sessionId, '会话 ID');
    if (typeof listener !== 'function') throw new CreatorConversationError('CREATOR_LISTENER_INVALID', '事件监听器无效');
    this.events.on(id, listener);
    return () => this.events.off(id, listener);
  }

  _publicConversation(row) {
    return {
      schema: CREATOR_CONVERSATION_SCHEMA,
      id: row.id,
      projectId: row.project_id,
      canvasId: row.canvas_id,
      title: row.title,
      phase: row.phase,
      status: row.status,
      sequence: Number(row.sequence),
      workingBrief: workingBrief(parseJson(row.working_brief_json, {})),
      phaseEvidence: normalizedPhaseEvidence(parseJson(row.phase_evidence_json, {})),
      currentSceneId: bounded(row.current_scene_id, 180) || null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  _publicMessage(row) {
    const rawMedia = parseJson(row.media_json, []);
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: Number(row.sequence),
      role: row.role,
      body: row.body,
      status: row.status,
      suggestions: parseJson(row.suggestions_json, []),
      actionId: row.action_id || null,
      media: row.action_id
        ? this._decorateCandidateAssets(row.session_id, row.action_id, rawMedia)
        : rawMedia,
      responseId: row.response_id || null,
      replyToMessageId: row.reply_to_message_id || null,
      selectedNodes: selectedNodeRefs(parseJson(row.selected_nodes_json, [])),
      errorCode: row.error_code || null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  _decorateCandidateAssets(sessionId, actionId, assets) {
    const candidateRows = this.db.prepare(`SELECT * FROM creator_media_candidates
      WHERE session_id = ? AND action_id = ?`).all(sessionId, actionId);
    const candidateByAssetId = new Map(candidateRows.map((candidate) => [candidate.asset_id, candidate]));
    return (Array.isArray(assets) ? assets : []).map((asset) => {
      const candidate = candidateByAssetId.get(asset.assetId);
      return {
        ...asset,
        reviewStatus: candidate?.review_digest ? 'reviewed' : 'pending',
        adoptionStatus: candidate?.adoption_digest ? 'adopted' : 'pending',
        placementStatus: candidate?.placement_status || 'pending',
        sentToCanvas: candidate?.placement_status === 'completed',
        canvasNodeId: parseJson(candidate?.placement_receipt_json, null)?.nodeId || null,
        canvasRevision: parseJson(candidate?.placement_receipt_json, null)?.canvasRevision || null,
      };
    });
  }

  _publicAction(row) {
    const resultAssets = this._decorateCandidateAssets(
      row.session_id, row.id, parseJson(row.result_assets_json, []),
    );
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: Number(row.sequence),
      type: row.type,
      prompt: row.prompt,
      parameters: parseJson(row.parameters_json, {}),
      modelSnapshot: parseJson(row.model_snapshot_json, {}),
      inputAssetIds: parseJson(row.input_asset_ids_json, []),
      workBinding: sceneActionWorkBinding(parseJson(row.work_binding_json, null)),
      shots: actionShots(parseJson(row.shots_json, []), row.type).map((shot) => ({
        ...shot,
        resultAssets: this._decorateCandidateAssets(row.session_id, row.id, shot.resultAssets),
      })),
      status: row.status,
      runIntentId: row.run_intent_id || null,
      runId: row.run_id || null,
      resultAssets,
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  _workSnapshot(sessionId) {
    const row = this.db.prepare(`SELECT snapshot_json FROM creator_work_snapshots
      WHERE session_id = ?`).get(sessionId);
    return row ? normalizeCreatorWorkSnapshot(parseJson(row.snapshot_json, null)) : null;
  }

  _currentWorkVersions(sessionId, input = {}) {
    const kinds = [...new Set((Array.isArray(input.kinds) ? input.kinds : [])
      .map((item) => bounded(item, 80)).filter(Boolean))];
    const scopeKeys = [...new Set((Array.isArray(input.scopeKeys) ? input.scopeKeys : [])
      .map((item) => normalizeScopeKey(item)).filter(Boolean))];
    const clauses = ['current.session_id = ?'];
    const bindings = [sessionId];
    if (kinds.length) {
      clauses.push(`current.kind IN (${kinds.map(() => '?').join(',')})`);
      bindings.push(...kinds);
    }
    if (scopeKeys.length) {
      clauses.push(`current.scope_key IN (${scopeKeys.map(() => '?').join(',')})`);
      bindings.push(...scopeKeys);
    }
    const rows = this.db.prepare(`SELECT versions.version_json
      FROM creator_work_current AS current
      INNER JOIN creator_work_artifact_versions AS versions
        ON versions.version_id = current.version_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY current.kind ASC, current.scope_key ASC`).all(...bindings);
    return rows.map((row) => normalizeWorkArtifactVersion(parseJson(row.version_json, null))).filter(Boolean);
  }

  _publicWorkState(sessionId, input = {}) {
    const snapshot = this._workSnapshot(sessionId);
    const currentVersions = this._currentWorkVersions(sessionId, input);
    return {
      snapshot,
      artifacts: workArtifactSummaries(currentVersions),
      ...(input.includeCurrentVersions === true ? { currentVersions } : {}),
    };
  }

  getWorkState(id, input = {}) {
    const row = this._requireConversation(id, input);
    return this._publicWorkState(row.id, input);
  }

  _longScriptIndex(sessionId) {
    const snapshot = this._workSnapshot(sessionId);
    const root = this._currentWorkVersions(sessionId, {
      kinds: ['ScriptDoc'],
      scopeKeys: ['root'],
    })[0] || null;
    const manifest = root?.fields?.manifest || null;
    const sceneScopeKeys = (Array.isArray(manifest?.sceneShardKeys) ? manifest.sceneShardKeys : [])
      .map((item) => normalizeScopeKey(item)).filter(Boolean);
    const sceneVersions = sceneScopeKeys.length ? this._currentWorkVersions(sessionId, {
      kinds: ['ScriptDoc'], scopeKeys: sceneScopeKeys,
    }) : [];
    const detailedScenes = sceneVersions
      .flatMap((version) => Array.isArray(version.fields?.scenes) ? version.fields.scenes : []);
    const detailedById = new Map(detailedScenes
      .map((scene) => [bounded(scene?.sceneId, 180), scene]).filter(([sceneId]) => sceneId));
    const orderScopeKeys = (Array.isArray(manifest?.orderShardKeys) ? manifest.orderShardKeys : [])
      .map((item) => normalizeScopeKey(item)).filter(Boolean);
    let rawScenes = [];
    if (orderScopeKeys.length) {
      rawScenes = this._currentWorkVersions(sessionId, {
        kinds: ['ScriptDoc'], scopeKeys: orderScopeKeys,
      }).flatMap((version) => Array.isArray(version.fields?.scenes) ? version.fields.scenes : []);
    } else {
      // Compatibility path for work imported before ordered navigation shards existed.
      rawScenes = detailedScenes;
    }
    const byId = new Map();
    rawScenes.forEach((scene) => {
      const sceneId = bounded(scene?.sceneId, 180);
      if (!sceneId || scene?.deleted === true) return;
      const detailed = detailedById.get(sceneId);
      byId.set(sceneId, detailed ? { ...scene, ...detailed } : scene);
    });
    const scenes = [...byId.values()].sort((left, right) => (
      String(left.orderKey || '').localeCompare(String(right.orderKey || ''))
      || String(left.sceneId || '').localeCompare(String(right.sceneId || ''))
    ));
    return { snapshot, root, manifest, scenes, sceneVersions };
  }

  getLongScriptContextState(id, input = {}) {
    const row = this._requireConversation(id, input);
    const index = this._longScriptIndex(row.id);
    const requestedSceneId = bounded(input.sceneId || row.current_scene_id, 180);
    const selectedSceneId = index.scenes.some((scene) => scene.sceneId === requestedSceneId)
      ? requestedSceneId : index.scenes[0]?.sceneId || null;
    const sceneVersions = index.sceneVersions;
    const selectedScene = sceneVersions
      .flatMap((version) => Array.isArray(version.fields?.scenes) ? version.fields.scenes : [])
      .find((scene) => scene?.sceneId === selectedSceneId && scene?.deleted !== true) || null;
    const sourceScopeKeys = selectedSceneId
      ? (Array.isArray(selectedScene?.sourceShardKeys) && selectedScene.sourceShardKeys.length
          ? selectedScene.sourceShardKeys
          : Array.isArray(index.manifest?.sourceShardKeys) ? index.manifest.sourceShardKeys : [])
        .map((item) => normalizeScopeKey(item)).filter(Boolean)
      : [];
    const sourceVersions = sourceScopeKeys.length ? this._currentWorkVersions(row.id, {
      kinds: ['ScriptDoc'], scopeKeys: sourceScopeKeys,
    }) : [];
    const supportingVersions = this._currentWorkVersions(row.id, {
      kinds: ['CharacterBible', 'ProductionBrief', 'WorldBible'],
    });
    const productionVersions = selectedSceneId ? this._currentWorkVersions(row.id, {
      kinds: ['ShotList', 'PromptPack'],
      scopeKeys: [sceneProductionScopeKey(selectedSceneId)],
    }) : [];
    let currentVersions = [...new Map([
      ...(index.root ? [index.root] : []),
      ...sceneVersions,
      ...sourceVersions,
      ...supportingVersions,
      ...productionVersions,
    ].map((version) => [version.versionId, version])).values()];
    let work = readLongScriptWork(currentVersions, index.snapshot, selectedSceneId ? {
      partialSourceSceneIds: [selectedSceneId],
    } : {});
    const sourcePart = selectedSceneId
      ? currentSceneSourcePart(work, work.scenes.find((scene) => scene.sceneId === selectedSceneId))
      : null;
    if (sourcePart?.scenePartId) {
      const draftVersions = this._currentWorkVersions(row.id, {
        kinds: ['ScriptDoc'], scopeKeys: [sceneDraftScopeKey(sourcePart.scenePartId)],
      });
      if (draftVersions.length) {
        currentVersions = [...new Map([...currentVersions, ...draftVersions]
          .map((version) => [version.versionId, version])).values()];
        work = readLongScriptWork(currentVersions, index.snapshot, {
          partialSourceSceneIds: [selectedSceneId],
        });
      }
    }
    return {
      snapshot: index.snapshot,
      artifacts: workArtifactSummaries(currentVersions),
      currentVersions,
      work,
      currentSceneId: selectedSceneId,
    };
  }

  getLongScriptState(id, input = {}) {
    const row = this._requireConversation(id, input);
    const indexState = this._longScriptIndex(row.id);
    const scenes = indexState.scenes.map((scene, index) => ({
      sceneId: scene.sceneId,
      index,
      number: index + 1,
      title: scene.title,
      status: scene.status,
      recordRevision: Math.max(1, Math.trunc(Number(scene.recordRevision) || 1)),
    }));
    const selectedSceneId = scenes.some((scene) => scene.sceneId === row.current_scene_id)
      ? row.current_scene_id : scenes[0]?.sceneId || null;
    const selectedScope = selectedSceneId ? sceneScopeKey(selectedSceneId) : null;
    const selectedSceneVersions = selectedScope
      ? indexState.sceneVersions.filter((version) => normalizeScopeKey(version.scopeKey) === selectedScope)
      : [];
    const persistedScene = selectedSceneVersions
      .flatMap((version) => Array.isArray(version.fields?.scenes) ? version.fields.scenes : [])
      .find((candidate) => candidate?.sceneId === selectedSceneId && candidate?.deleted !== true) || null;
    const sourceScopeKeys = selectedSceneId
      ? (Array.isArray(persistedScene?.sourceShardKeys) && persistedScene.sourceShardKeys.length
          ? persistedScene.sourceShardKeys
          : Array.isArray(indexState.manifest?.sourceShardKeys) ? indexState.manifest.sourceShardKeys : [])
        .map((item) => normalizeScopeKey(item)).filter(Boolean)
      : [];
    const sourceVersions = sourceScopeKeys.length ? this._currentWorkVersions(row.id, {
      kinds: ['ScriptDoc'], scopeKeys: sourceScopeKeys,
    }) : [];
    let currentVersions = [
      ...(indexState.root ? [indexState.root] : []),
      ...selectedSceneVersions,
      ...sourceVersions,
    ];
    let work = readLongScriptWork(currentVersions, indexState.snapshot, selectedSceneId ? { partialSourceSceneIds: [selectedSceneId] } : {});
    let scene = selectedSceneId
      ? work.scenes.find((candidate) => candidate.sceneId === selectedSceneId) || null
      : null;
    let sourcePart = scene ? currentSceneSourcePart(work, scene) : null;
    if (sourcePart?.scenePartId) {
      const draftVersions = this._currentWorkVersions(row.id, {
        kinds: ['ScriptDoc'], scopeKeys: [sceneDraftScopeKey(sourcePart.scenePartId)],
      });
      if (draftVersions.length) {
        currentVersions = [...currentVersions, ...draftVersions];
        work = readLongScriptWork(currentVersions, indexState.snapshot, {
          partialSourceSceneIds: [selectedSceneId],
        });
        scene = work.scenes.find((candidate) => candidate.sceneId === selectedSceneId) || null;
        sourcePart = scene ? currentSceneSourcePart(work, scene) : null;
      }
    }
    const sceneDraft = sourcePart?.scenePartId
      ? work.draftsByScenePartId?.get(sourcePart.scenePartId) || null : null;
    const currentScene = scene ? {
      sceneId: scene.sceneId,
      orderKey: scene.orderKey,
      title: scene.title,
      sourceText: sourcePart?.sourceText || '',
      sourcePartId: sourcePart?.scenePartId || null,
      sourcePartIndex: sourcePart?.index || 0,
      sourcePartCount: sourcePart?.total || Math.max(1, Math.trunc(Number(scene.sourcePartCount) || 1)),
      sourcePartHasDraft: Boolean(sceneDraft?.draftText),
      draftText: sceneDraft?.draftText || '',
      sourceIntegrity: Boolean(sourcePart),
      status: scene.status,
      purpose: scene.purpose,
      objective: scene.objective,
      obstacle: scene.obstacle,
      turn: scene.turn,
      valueChange: scene.valueChange,
      activeEntityIds: Array.isArray(scene.activeEntityIds) ? scene.activeEntityIds : [],
      locationId: scene.locationId || null,
      recordRevision: Math.max(1, Math.trunc(Number(scene.recordRevision) || 1)),
    } : null;
    return {
      schema: 't8-creator-long-script-navigation-v1',
      scriptId: work.scriptId || null,
      title: work.title || '',
      currentSceneId: selectedSceneId,
      currentScene,
      scenes,
      total: scenes.length,
      work: {
        revision: indexState.snapshot?.revision || 0,
        digest: indexState.snapshot?.workDigest || null,
      },
    };
  }

  setCurrentScene(id, sceneId, scope = {}) {
    const row = this._requireConversation(id, scope);
    const requestedSceneId = requiredId(sceneId, '场次 ID');
    const state = this.getLongScriptState(row.id, scope);
    if (!state.scenes.some((scene) => scene.sceneId === requestedSceneId)) {
      throw new CreatorConversationError('CREATOR_SCENE_NOT_FOUND', '这个场次不存在或已经被移除', 404);
    }
    if (row.current_scene_id === requestedSceneId) return state;
    const now = Date.now();
    let sequence = 0;
    this.db.transaction(() => {
      sequence = this._nextSequence(row.id, now);
      this.db.prepare('UPDATE creator_conversations SET current_scene_id = ?, updated_at = ? WHERE id = ?')
        .run(requestedSceneId, now, row.id);
      this._recordChange(row.id, sequence, 'conversation', row.id);
    })();
    this._emit(row.id, 'conversation', this._publicConversation(this._conversation(row.id)), sequence);
    return this.getLongScriptState(row.id, scope);
  }

  _setCurrentSceneInTransaction(sessionId, sceneId, now = Date.now()) {
    const requestedSceneId = bounded(sceneId, 180);
    if (!requestedSceneId) return false;
    const indexState = this._longScriptIndex(sessionId);
    if (!indexState.scenes.some((scene) => scene.sceneId === requestedSceneId)) {
      throw new CreatorConversationError('CREATOR_SCENE_NOT_FOUND', '这个场次不存在或已经被移除', 404);
    }
    this.db.prepare('UPDATE creator_conversations SET current_scene_id = ?, updated_at = ? WHERE id = ?')
      .run(requestedSceneId, now, sessionId);
    return true;
  }

  _commitWorkMutationInTransaction(sessionId, input = {}) {
    const existingSnapshot = this._workSnapshot(sessionId);
    const existingVersions = this._currentWorkVersions(sessionId);
    const mutation = createScopedWorkArtifactMutation({
      ...input,
      sessionId,
      existingSnapshot,
      existingVersions,
    });
    if (mutation.status !== 'created') return mutation;
    const now = Date.parse(mutation.snapshot.updatedAt) || Date.now();
    const insertVersion = this.db.prepare(`INSERT INTO creator_work_artifact_versions(
      version_id, session_id, artifact_id, kind, scope_key, revision,
      version_json, version_digest, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const upsertCurrent = this.db.prepare(`INSERT INTO creator_work_current(
      session_id, kind, scope_key, artifact_id, version_id, version_digest, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, kind, scope_key) DO UPDATE SET
      artifact_id = excluded.artifact_id,
      version_id = excluded.version_id,
      version_digest = excluded.version_digest,
      updated_at = excluded.updated_at`);
    for (const version of mutation.createdVersions) {
      const scopeKey = normalizeScopeKey(version.scopeKey);
      insertVersion.run(
        version.versionId, sessionId, version.artifactId, version.kind, scopeKey,
        version.revision, JSON.stringify(version), version.versionDigest, now,
      );
      this._injectFault('work-version-inserted', {
        sessionId, versionId: version.versionId, scopeKey,
      });
      this._injectFault('work-before-current-pointer-update', {
        sessionId, versionId: version.versionId, scopeKey,
      });
      upsertCurrent.run(
        sessionId, version.kind, scopeKey, version.artifactId,
        version.versionId, version.versionDigest, now,
      );
      this._injectFault('work-current-pointer-updated', {
        sessionId, versionId: version.versionId, scopeKey,
      });
    }
    this._injectFault('work-before-snapshot-update', { sessionId, revision: mutation.snapshot.revision });
    this.db.prepare(`INSERT INTO creator_work_snapshots(
      session_id, work_id, revision, snapshot_json, work_digest, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      work_id = excluded.work_id,
      revision = excluded.revision,
      snapshot_json = excluded.snapshot_json,
      work_digest = excluded.work_digest,
      updated_at = excluded.updated_at`).run(
      sessionId, mutation.snapshot.workId, mutation.snapshot.revision,
      JSON.stringify(mutation.snapshot), mutation.snapshot.workDigest, now,
    );
    this._injectFault('work-snapshot-updated', { sessionId, revision: mutation.snapshot.revision });
    return mutation;
  }

  commitWorkMutation(id, input = {}, scope = {}) {
    const row = this._requireConversation(id, scope);
    let mutation;
    let sequence = 0;
    let conversationSequence = 0;
    this.db.transaction(() => {
      mutation = this._commitWorkMutationInTransaction(row.id, input);
      if (mutation.status !== 'created') return;
      if (this._setCurrentSceneInTransaction(row.id, input.currentSceneId, Date.now())) {
        conversationSequence = this._nextSequence(row.id, Date.now());
        this._recordChange(row.id, conversationSequence, 'conversation', row.id);
      }
      sequence = this._nextSequence(row.id, Date.now());
      this._recordChange(row.id, sequence, 'work', mutation.snapshot.workId);
    })();
    if (conversationSequence) {
      this._emit(row.id, 'conversation', this._publicConversation(this._conversation(row.id)), conversationSequence);
    }
    if (sequence) this._emit(row.id, 'work', this._publicWorkState(row.id), sequence);
    return mutation;
  }

  createConversation(input = {}) {
    const now = Date.now();
    const id = input.id ? requiredId(input.id, '会话 ID') : `creator-${crypto.randomUUID()}`;
    const projectId = requiredId(input.projectId, '项目 ID');
    const canvasId = requiredId(input.canvasId, '画布 ID');
    const title = bounded(input.title, 120) || '未命名创作';
    const phase = CREATOR_PHASES.has(input.phase) ? input.phase : 'idea';
    const status = CREATOR_STATUSES.has(input.status) ? input.status : 'active';
    this.db.prepare(`
      INSERT INTO creator_conversations(id, project_id, canvas_id, title, phase, status, sequence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, projectId, canvasId, title, phase, status, now, now);
    const row = this._requireConversation(id, { projectId, canvasId });
    return this._publicConversation(row);
  }

  listConversations(input = {}) {
    const projectId = requiredId(input.projectId, '项目 ID');
    const canvasId = requiredId(input.canvasId, '画布 ID');
    const pageSize = limit(input.limit, 20, 50);
    const before = conversationCursor(input.before);
    const rows = before?.id
      ? this.db.prepare(`SELECT * FROM creator_conversations
          WHERE project_id = ? AND canvas_id = ?
            AND NOT (title = '未命名创作' AND NOT EXISTS (
              SELECT 1 FROM creator_messages WHERE creator_messages.session_id = creator_conversations.id
            ))
            AND (updated_at < ? OR (updated_at = ? AND id < ?))
          ORDER BY updated_at DESC, id DESC LIMIT ?`).all(
        projectId, canvasId, before.updatedAt, before.updatedAt, before.id, pageSize + 1,
      )
      : before
        ? this.db.prepare(`SELECT * FROM creator_conversations
            WHERE project_id = ? AND canvas_id = ?
              AND NOT (title = '未命名创作' AND NOT EXISTS (
                SELECT 1 FROM creator_messages WHERE creator_messages.session_id = creator_conversations.id
              ))
              AND updated_at < ?
            ORDER BY updated_at DESC, id DESC LIMIT ?`).all(projectId, canvasId, before.updatedAt, pageSize + 1)
      : this.db.prepare(`SELECT * FROM creator_conversations
          WHERE project_id = ? AND canvas_id = ?
            AND NOT (title = '未命名创作' AND NOT EXISTS (
              SELECT 1 FROM creator_messages WHERE creator_messages.session_id = creator_conversations.id
            ))
          ORDER BY updated_at DESC, id DESC LIMIT ?`).all(projectId, canvasId, pageSize + 1);
    const more = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    return {
      items: page.map((row) => this._publicConversation(row)),
      nextBefore: more && page.length
        ? `${Number(page[page.length - 1].updated_at)}:${page[page.length - 1].id}`
        : null,
    };
  }

  updateConversationPhase(id, phase, scope = {}) {
    const row = this._requireConversation(id, scope);
    if (!CREATOR_PHASES.has(phase)) throw new CreatorConversationError('CREATOR_PHASE_INVALID', '创作阶段无效');
    if (row.phase === phase) return this._publicConversation(row);
    const now = Date.now();
    this.db.transaction(() => {
      const sequence = this._nextSequence(row.id, now);
      this.db.prepare('UPDATE creator_conversations SET phase = ?, updated_at = ? WHERE id = ?')
        .run(phase, now, row.id);
      this._recordChange(row.id, sequence, 'conversation', row.id);
    })();
    const conversation = this._publicConversation(this._conversation(row.id));
    this._emit(row.id, 'conversation', conversation);
    return conversation;
  }

  updateConversationContext(id, input = {}, scope = {}) {
    const row = this._requireConversation(id, scope);
    const { acceptedPhase, nextBrief, evidence } = resolvedConversationContext(row, input);
    const now = Date.now();
    this.db.transaction(() => {
      const sequence = this._nextSequence(row.id, now);
      this.db.prepare(`UPDATE creator_conversations SET phase = ?, working_brief_json = ?,
        phase_evidence_json = ?, updated_at = ? WHERE id = ?`).run(
        acceptedPhase, JSON.stringify(nextBrief), JSON.stringify(evidence), now, row.id,
      );
      this._recordChange(row.id, sequence, 'conversation', row.id);
    })();
    const conversation = this._publicConversation(this._conversation(row.id));
    this._emit(row.id, 'conversation', conversation);
    return conversation;
  }

  getConversation(id, input = {}) {
    const row = this._requireConversation(id, input);
    const pageSize = limit(input.limit, 24, 100);
    const before = cursor(input.beforeSequence);
    const rows = before
      ? this.db.prepare(`SELECT * FROM creator_messages
          WHERE session_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?`).all(row.id, before, pageSize + 1)
      : this.db.prepare(`SELECT * FROM creator_messages
          WHERE session_id = ? ORDER BY sequence DESC LIMIT ?`).all(row.id, pageSize + 1);
    const more = rows.length > pageSize;
    const page = rows.slice(0, pageSize).reverse();
    // Recover the action attached to the latest assistant turn, including a
    // completed result.  Restricting this lookup to pending/running actions
    // made a successful image or video disappear after a refresh.  Looking up
    // through the latest assistant message also prevents an older result from
    // masking the suggestions of a newer text-only reply.
    const latestAssistant = this.db.prepare(`SELECT action_id FROM creator_messages
      WHERE session_id = ? AND role = 'assistant'
      ORDER BY sequence DESC LIMIT 1`).get(row.id);
    const currentAction = latestAssistant?.action_id
      ? this.db.prepare(`SELECT * FROM creator_actions
          WHERE id = ? AND session_id = ? AND status != 'cancelled'`).get(latestAssistant.action_id, row.id)
      : null;
    return {
      conversation: this._publicConversation(row),
      messages: page.map((message) => this._publicMessage(message)),
      pendingAction: currentAction ? this._publicAction(currentAction) : null,
      work: this._publicWorkState(row.id),
      nextBeforeSequence: more && page.length ? Number(page[0].sequence) : null,
    };
  }

  appendUserMessage(id, input = {}) {
    const row = this._requireConversation(id, input);
    const body = bounded(input.body, 30_000);
    if (!body) throw new CreatorConversationError('CREATOR_MESSAGE_EMPTY', '请输入创作需求');
    const clientRequestId = requiredId(input.clientRequestId, '请求 ID');
    const normalizedMedia = mediaRefs(input.attachments);
    const normalizedSelectedNodes = selectedNodeRefs(input.selectedNodes);
    const requestDigest = creatorMessageRequestDigest(
      body, normalizedMedia, normalizedSelectedNodes, input.creationMode,
    );
    const existing = this.db.prepare(`SELECT * FROM creator_messages
      WHERE session_id = ? AND client_request_id = ?`).get(row.id, clientRequestId);
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        throw new CreatorConversationError('CREATOR_REQUEST_CONFLICT', '同一请求 ID 的内容不一致', 409);
      }
      return { duplicate: true, message: this._publicMessage(existing) };
    }
    const now = Date.now();
    const messageId = input.messageId ? requiredId(input.messageId, '消息 ID') : `msg-${crypto.randomUUID()}`;
    const run = this.db.transaction(() => {
      const sequence = this._nextSequence(row.id, now);
      this.db.prepare(`INSERT INTO creator_messages(
        id, session_id, sequence, role, body, status, suggestions_json, media_json,
        selected_nodes_json, client_request_id, request_digest, created_at, updated_at
      ) VALUES (?, ?, ?, 'user', ?, 'completed', '[]', ?, ?, ?, ?, ?, ?)`)
        .run(messageId, row.id, sequence, body, JSON.stringify(normalizedMedia), JSON.stringify(normalizedSelectedNodes),
          clientRequestId, requestDigest, now, now);
      this._recordChange(row.id, sequence, 'message', messageId);
      if (row.title === '未命名创作') {
        const title = bounded(body.replace(/\s+/gu, ' '), 34);
        if (title) this.db.prepare('UPDATE creator_conversations SET title = ? WHERE id = ?').run(title, row.id);
      }
      return this.db.prepare('SELECT * FROM creator_messages WHERE id = ?').get(messageId);
    });
    const message = this._publicMessage(run());
    this._emit(row.id, 'message', message);
    return { duplicate: false, message };
  }

  findUserMessageByRequest(id, input = {}) {
    const row = this._requireConversation(id, input);
    const body = bounded(input.body, 30_000);
    const clientRequestId = requiredId(input.clientRequestId, '请求 ID');
    const normalizedMedia = mediaRefs(input.attachments);
    const normalizedSelectedNodes = selectedNodeRefs(input.selectedNodes);
    const requestDigest = creatorMessageRequestDigest(
      body, normalizedMedia, normalizedSelectedNodes, input.creationMode,
    );
    const existing = this.db.prepare(`SELECT * FROM creator_messages
      WHERE session_id = ? AND client_request_id = ?`).get(row.id, clientRequestId);
    if (!existing) return null;
    if (existing.request_digest !== requestDigest) {
      throw new CreatorConversationError('CREATOR_REQUEST_CONFLICT', '同一请求 ID 的内容不一致', 409);
    }
    return this._publicMessage(existing);
  }

  findUserMessageByClientRequest(id, input = {}) {
    const row = this._requireConversation(id, input);
    const clientRequestId = requiredId(input.clientRequestId, '请求 ID');
    const existing = this.db.prepare(`SELECT * FROM creator_messages
      WHERE session_id = ? AND client_request_id = ?`).get(row.id, clientRequestId);
    if (!existing) return null;
    const body = bounded(input.body, 30_000);
    const normalizedMedia = mediaRefs(parseJson(existing.media_json, []));
    const normalizedSelectedNodes = selectedNodeRefs(parseJson(existing.selected_nodes_json, []));
    const modernDigest = creatorMessageRequestDigest(
      body, normalizedMedia, normalizedSelectedNodes, input.creationMode,
    );
    const legacyDigest = creatorMessageRequestDigest(
      body, normalizedMedia, normalizedSelectedNodes, input.creationMode, false,
    );
    if (existing.body !== body
      || (existing.request_digest !== modernDigest && existing.request_digest !== legacyDigest)) {
      throw new CreatorConversationError('CREATOR_REQUEST_CONFLICT', '同一请求 ID 的内容不一致', 409);
    }
    // A transport retry must replay the exact durable turn.  Re-resolving its
    // former canvas selection can fail after a node was edited or removed and
    // can silently change the context that the idempotency key represents.
    return this._publicMessage(existing);
  }

  findAssistantResponseForUserMessage(id, userMessageId, input = {}) {
    const row = this._requireConversation(id, input);
    const user = this.db.prepare(`SELECT id, sequence FROM creator_messages
      WHERE id = ? AND session_id = ? AND role = 'user'`).get(requiredId(userMessageId, '用户消息 ID'), row.id);
    if (!user) throw new CreatorConversationError('CREATOR_MESSAGE_NOT_FOUND', '用户消息不存在', 404);
    const linked = this.db.prepare(`SELECT * FROM creator_messages
      WHERE session_id = ? AND role = 'assistant' AND reply_to_message_id = ?
      ORDER BY sequence ASC LIMIT 1`).get(row.id, user.id);
    if (linked) return this._publicMessage(linked);
    // Databases created before reply_to_message_id used strict alternating
    // turns. Preserve that history without letting a newer linked response be
    // mistaken for the legacy request.
    const legacy = this.db.prepare(`SELECT * FROM creator_messages
      WHERE session_id = ? AND role = 'assistant' AND reply_to_message_id IS NULL AND sequence > ?
      ORDER BY sequence ASC LIMIT 1`).get(row.id, user.sequence);
    return legacy ? this._publicMessage(legacy) : null;
  }

  startAssistantResponse(id, input = {}) {
    const row = this._requireConversation(id, input);
    const responseId = requiredId(input.responseId || `response-${crypto.randomUUID()}`, '回复 ID');
    const replyToMessageId = input.replyToMessageId
      ? requiredId(input.replyToMessageId, '用户消息 ID') : null;
    if (replyToMessageId) {
      const user = this.db.prepare(`SELECT id FROM creator_messages
        WHERE id = ? AND session_id = ? AND role = 'user'`).get(replyToMessageId, row.id);
      if (!user) throw new CreatorConversationError('CREATOR_MESSAGE_NOT_FOUND', '用户消息不存在', 404);
    }
    const now = Date.now();
    const messageId = `msg-${crypto.randomUUID()}`;
    let inserted = false;
    const run = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM creator_messages WHERE session_id = ? AND response_id = ?')
        .get(row.id, responseId);
      if (existing) return existing;
      const active = this.db.prepare(`SELECT response_id FROM creator_messages
        WHERE session_id = ? AND role = 'assistant' AND status = 'streaming' LIMIT 1`).get(row.id);
      if (active) {
        throw new CreatorConversationError(
          'CREATOR_RESPONSE_PENDING',
          '上一条回复仍在处理中，请先停止或等待完成',
          409,
        );
      }
      const sequence = this._nextSequence(row.id, now);
      inserted = true;
      this.db.prepare(`INSERT INTO creator_messages(
        id, session_id, sequence, role, body, status, suggestions_json, media_json,
        response_id, reply_to_message_id, model_snapshot_digest, created_at, updated_at
      ) VALUES (?, ?, ?, 'assistant', '', 'streaming', '[]', '[]', ?, ?, ?, ?, ?)`)
        .run(messageId, row.id, sequence, responseId, replyToMessageId,
          bounded(input.modelSnapshotDigest, 128) || null, now, now);
      this._recordChange(row.id, sequence, 'message', messageId);
      return this.db.prepare('SELECT * FROM creator_messages WHERE id = ?').get(messageId);
    });
    const message = this._publicMessage(run());
    if (inserted) this._emit(row.id, 'message', message);
    return { ...message, startedNew: inserted };
  }

  completeAssistantResponse(id, responseId, input = {}) {
    const row = this._requireConversation(id, input);
    const body = bounded(input.body, 80_000);
    if (!body) throw new CreatorConversationError('CREATOR_RESPONSE_EMPTY', '模型没有返回有效内容', 502);
    const normalizedSuggestions = suggestions(input.suggestions);
    const actionId = input.action?.id ? requiredId(input.action.id, '动作 ID') : null;
    const now = Date.now();
    let eventSequence = 0;
    let conversationEventSequence = 0;
    let workEventSequence = 0;
    let workMutation = null;
    const run = this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM creator_messages WHERE session_id = ? AND response_id = ?')
        .get(row.id, requiredId(responseId, '回复 ID'));
      if (!current) throw new CreatorConversationError('CREATOR_RESPONSE_NOT_FOUND', '回复不存在', 404);
      if (current.status !== 'streaming') {
        this.db.prepare(`DELETE FROM creator_response_drafts
          WHERE session_id = ? AND response_id = ?`).run(row.id, responseId);
        return current;
      }
      const changeSequence = this._nextSequence(row.id, now);
      eventSequence = changeSequence;
      this.db.prepare(`UPDATE creator_messages SET body = ?, status = 'completed', suggestions_json = ?, action_id = ?, updated_at = ? WHERE id = ?`)
        .run(body, JSON.stringify(normalizedSuggestions), actionId, now, current.id);
      this._injectFault('assistant-response-updated', { sessionId: row.id, responseId });
      this._recordChange(row.id, changeSequence, 'message', current.id);
      if (input.action) this._createActionInTransaction(row.id, input.action, now);
      if (input.conversationContext) {
        const contextRow = this._conversation(row.id);
        const { acceptedPhase, nextBrief, evidence } = resolvedConversationContext(
          contextRow,
          input.conversationContext,
        );
        conversationEventSequence = this._nextSequence(row.id, now);
        this.db.prepare(`UPDATE creator_conversations SET phase = ?, working_brief_json = ?,
          phase_evidence_json = ?, updated_at = ? WHERE id = ?`).run(
          acceptedPhase, JSON.stringify(nextBrief), JSON.stringify(evidence), now, row.id,
        );
        this._recordChange(row.id, conversationEventSequence, 'conversation', row.id);
      }
      if (input.workMutation) {
        workMutation = this._commitWorkMutationInTransaction(row.id, input.workMutation);
        if (!['created', 'reused'].includes(workMutation.status)) {
          throw new CreatorConversationError(
            'CREATOR_WORK_COMMIT_BLOCKED',
            workMutation.code === 'work-snapshot-stale' || workMutation.code === 'work-artifact-stale'
              ? '这份长剧本已经被更新，请恢复最新场次后重试'
              : '这次长剧本没有完整保存，请重试',
            workMutation.code === 'work-snapshot-stale' || workMutation.code === 'work-artifact-stale' ? 409 : 422,
            { workCode: workMutation.code },
          );
        }
        if (workMutation.status === 'created') {
          const requestedSceneId = bounded(input.workMutation.currentSceneId, 180);
          if (requestedSceneId) {
            this._setCurrentSceneInTransaction(row.id, requestedSceneId, now);
            if (!conversationEventSequence) {
              conversationEventSequence = this._nextSequence(row.id, now);
              this._recordChange(row.id, conversationEventSequence, 'conversation', row.id);
            }
          }
          workEventSequence = this._nextSequence(row.id, now);
          this._recordChange(row.id, workEventSequence, 'work', workMutation.snapshot.workId);
        }
      }
      this.db.prepare(`DELETE FROM creator_response_drafts
        WHERE session_id = ? AND response_id = ?`).run(row.id, responseId);
      this._injectFault('assistant-before-commit', { sessionId: row.id, responseId });
      return this.db.prepare('SELECT * FROM creator_messages WHERE id = ?').get(current.id);
    });
    const message = this._publicMessage(run());
    this._emit(row.id, 'message', message, eventSequence || message.sequence);
    if (input.action) this._emit(row.id, 'action', this.getAction(input.action.id, row.id));
    if (conversationEventSequence) {
      this._emit(row.id, 'conversation', this._publicConversation(this._conversation(row.id)), conversationEventSequence);
    }
    if (workEventSequence) {
      this._emit(row.id, 'work', this._publicWorkState(row.id), workEventSequence);
    }
    return message;
  }

  failAssistantResponse(id, responseId, input = {}) {
    const row = this._requireConversation(id, input);
    const status = input.stopped === true ? 'stopped' : 'failed';
    const body = bounded(input.body, 2_000) || (status === 'stopped' ? '已停止。' : '这次没有生成成功，请重试。');
    const now = Date.now();
    let eventSequence = 0;
    this.db.transaction(() => {
      const current = this.db.prepare(`SELECT id FROM creator_messages
        WHERE session_id = ? AND response_id = ? AND status = 'streaming'`)
        .get(row.id, requiredId(responseId, '回复 ID'));
      if (!current) return;
      const changeSequence = this._nextSequence(row.id, now);
      eventSequence = changeSequence;
      this.db.prepare(`UPDATE creator_messages SET body = ?, status = ?, error_code = ?, updated_at = ?
        WHERE id = ?`).run(body, status, bounded(input.errorCode, 120) || null, now, current.id);
      this._recordChange(row.id, changeSequence, 'message', current.id);
    })();
    const result = this.db.prepare('SELECT * FROM creator_messages WHERE session_id = ? AND response_id = ?').get(row.id, responseId);
    if (!result) throw new CreatorConversationError('CREATOR_RESPONSE_NOT_FOUND', '回复不存在', 404);
    const message = this._publicMessage(result);
    this._emit(row.id, 'message', message, eventSequence || message.sequence);
    return message;
  }

  _createActionInTransaction(sessionId, input = {}, now = Date.now()) {
    const id = requiredId(input.id, '动作 ID');
    const type = bounded(input.type, 16).toLowerCase();
    if (!ACTION_TYPES.has(type)) throw new CreatorConversationError('CREATOR_ACTION_TYPE_INVALID', '只支持图片或视频生成');
    const prompt = bounded(input.prompt, 20_000);
    if (!prompt) throw new CreatorConversationError('CREATOR_ACTION_PROMPT_EMPTY', '生成动作缺少提示词');
    const snapshot = modelSnapshot(input.modelSnapshot, type);
    const parameters = input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
      ? input.parameters : {};
    const inputAssetIds = [...new Set((Array.isArray(input.inputAssetIds) ? input.inputAssetIds : [])
      .map((item) => requiredId(item, '输入素材 ID')))].slice(0, 12);
    const workBinding = sceneActionWorkBinding(input.workBinding);
    const shots = actionShots(input.shots, type);
    const resultAssets = mediaRefs(input.resultAssets, 48);
    const requestDigest = digest({
      type, prompt, parameters, snapshot, inputAssetIds, workBinding,
      shots: immutableShotSpecs(shots),
    });
    const existing = this.db.prepare('SELECT * FROM creator_actions WHERE id = ?').get(id);
    if (existing) {
      if (existing.request_digest !== requestDigest || existing.session_id !== sessionId) {
        throw new CreatorConversationError('CREATOR_ACTION_CONFLICT', '动作 ID 已绑定其他内容', 409);
      }
      return existing;
    }
    const pending = this.db.prepare(`SELECT id FROM creator_actions WHERE session_id = ? AND status IN ('pending', 'running', 'ambiguous') LIMIT 1`)
      .get(sessionId);
    if (pending) throw new CreatorConversationError('CREATOR_ACTION_PENDING', '请先完成当前生成操作', 409);
    const sequence = this._nextSequence(sessionId, now);
    this.db.prepare(`INSERT INTO creator_actions(
      id, session_id, sequence, type, prompt, parameters_json, request_digest,
      model_snapshot_json, model_snapshot_digest, input_asset_ids_json, work_binding_json, shots_json, status,
      result_assets_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(id, sessionId, sequence, type, prompt, JSON.stringify(parameters), requestDigest,
        JSON.stringify(snapshot), digest(snapshot), JSON.stringify(inputAssetIds),
        workBinding ? JSON.stringify(workBinding) : null, JSON.stringify(shots),
        JSON.stringify(resultAssets), now, now);
    this._recordChange(sessionId, sequence, 'action', id);
    return this.db.prepare('SELECT * FROM creator_actions WHERE id = ?').get(id);
  }

  _resultAssetForAction(actionId, sessionId, assetId) {
    const action = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(actionId, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!action) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    if (action.status !== 'completed') {
      throw new CreatorConversationError('CREATOR_ACTION_NOT_COMPLETED', '这条生成结果还没有完成', 409);
    }
    const requestedAssetId = requiredId(assetId, '素材 ID');
    const asset = mediaRefs(parseJson(action.result_assets_json, []), 48)
      .find((item) => item.assetId === requestedAssetId);
    if (!asset) {
      throw new CreatorConversationError('CREATOR_ACTION_ASSET_MISMATCH', '这个素材不属于当前生成结果', 409);
    }
    if (!['image', 'video'].includes(asset.kind) || !/^[a-f0-9]{64}$/iu.test(String(asset.contentHash || ''))) {
      throw new CreatorConversationError('CREATOR_CANDIDATE_EVIDENCE_INVALID', '这个结果缺少可核验的媒体证据', 409);
    }
    return { action, asset };
  }

  recordMediaReviewed(actionId, sessionId, assetId, input = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const { action, asset } = this._resultAssetForAction(actionId, sessionId, assetId);
    const clientRequestId = requiredId(input.clientRequestId, '查看请求 ID');
    const evidenceKind = bounded(input.evidenceKind, 80).toLowerCase();
    const expectedEvidenceKind = asset.kind === 'video' ? 'video-frame-visible' : 'image-visible';
    if (evidenceKind !== expectedEvidenceKind) {
      throw new CreatorConversationError('CREATOR_CANDIDATE_REVIEW_INVALID', '媒体还没有在对话框中正常显示', 409);
    }
    const requestDigest = digest({ actionId: action.id, assetId: asset.assetId, contentHash: asset.contentHash, evidenceKind });
    const existing = this.db.prepare(`SELECT * FROM creator_media_candidates
      WHERE session_id = ? AND action_id = ? AND asset_id = ?`).get(sessionId, action.id, asset.assetId);
    if (existing?.review_digest) {
      if (existing.review_request_id === clientRequestId && existing.review_request_digest !== requestDigest) {
        throw new CreatorConversationError('CREATOR_REQUEST_CONFLICT', '同一查看请求 ID 的内容不一致', 409);
      }
      return this._publicAction(action);
    }
    const now = Date.now();
    const evidence = {
      schema: 't8-creator-media-review-evidence-v1',
      sessionId, actionId: action.id, assetId: asset.assetId,
      kind: asset.kind, contentHash: String(asset.contentHash).toLowerCase(),
      evidenceKind, observedAt: now,
    };
    const evidenceDigest = digest(evidence);
    let sequence = 0;
    this.db.transaction(() => {
      sequence = this._nextSequence(sessionId, now);
      this.db.prepare(`INSERT INTO creator_media_candidates(
        session_id, action_id, asset_id, kind, content_hash,
        review_request_id, review_request_digest, review_evidence_json, review_digest, reviewed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, action_id, asset_id) DO UPDATE SET
        review_request_id = excluded.review_request_id,
        review_request_digest = excluded.review_request_digest,
        review_evidence_json = excluded.review_evidence_json,
        review_digest = excluded.review_digest,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at`).run(
        sessionId, action.id, asset.assetId, asset.kind, String(asset.contentHash).toLowerCase(),
        clientRequestId, requestDigest, JSON.stringify(evidence), evidenceDigest, now, now,
      );
      this._recordChange(sessionId, sequence, 'action', action.id);
    })();
    const result = this.getAction(action.id, sessionId, scope);
    this._emit(sessionId, 'action', result, sequence);
    return result;
  }

  adoptMediaCandidate(actionId, sessionId, assetId, input = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const { action, asset } = this._resultAssetForAction(actionId, sessionId, assetId);
    const clientRequestId = requiredId(input.clientRequestId, '采用请求 ID');
    const candidate = this.db.prepare(`SELECT * FROM creator_media_candidates
      WHERE session_id = ? AND action_id = ? AND asset_id = ?`).get(sessionId, action.id, asset.assetId);
    if (!candidate?.review_digest || candidate.content_hash !== String(asset.contentHash).toLowerCase()) {
      throw new CreatorConversationError('CREATOR_CANDIDATE_REVIEW_REQUIRED', '请等图片或视频在对话框中显示后再采用', 409);
    }
    const requestDigest = digest({
      actionId: action.id, assetId: asset.assetId, contentHash: asset.contentHash,
      reviewDigest: candidate.review_digest,
    });
    if (candidate.adoption_digest) {
      if (candidate.adoption_request_id === clientRequestId
        && candidate.adoption_request_digest !== requestDigest) {
        throw new CreatorConversationError('CREATOR_REQUEST_CONFLICT', '同一采用请求 ID 的内容不一致', 409);
      }
      return this._publicAction(action);
    }
    const now = Date.now();
    const unsigned = {
      schema: 't8-creative-adoption-receipt-v1',
      sessionId, actionId: action.id, assetId: asset.assetId,
      kind: asset.kind, contentHash: String(asset.contentHash).toLowerCase(),
      reviewDigest: candidate.review_digest, adoptedAt: now,
    };
    const receipt = { ...unsigned, receiptDigest: digest(unsigned) };
    let sequence = 0;
    this.db.transaction(() => {
      sequence = this._nextSequence(sessionId, now);
      this.db.prepare(`UPDATE creator_media_candidates SET
        adoption_request_id = ?, adoption_request_digest = ?, adoption_receipt_json = ?,
        adoption_digest = ?, adopted_at = ?, updated_at = ?
        WHERE session_id = ? AND action_id = ? AND asset_id = ?`).run(
        clientRequestId, requestDigest, JSON.stringify(receipt), receipt.receiptDigest,
        now, now, sessionId, action.id, asset.assetId,
      );
      this._recordChange(sessionId, sequence, 'action', action.id);
    })();
    const result = this.getAction(action.id, sessionId, scope);
    this._emit(sessionId, 'action', result, sequence);
    return result;
  }

  beginMediaPlacement(actionId, sessionId, assetId, input = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const { action, asset } = this._resultAssetForAction(actionId, sessionId, assetId);
    const clientRequestId = requiredId(input.clientRequestId, '画布请求 ID');
    const candidate = this.db.prepare(`SELECT * FROM creator_media_candidates
      WHERE session_id = ? AND action_id = ? AND asset_id = ?`).get(sessionId, action.id, asset.assetId);
    if (!candidate?.adoption_digest || candidate.content_hash !== String(asset.contentHash).toLowerCase()) {
      throw new CreatorConversationError('CREATOR_CANDIDATE_ADOPTION_REQUIRED', '请先采用这个结果再发送到画布', 409);
    }
    const target = {
      targetNodeId: bounded(input.targetNodeId, 180) || null,
      position: input.position && Number.isFinite(Number(input.position.x)) && Number.isFinite(Number(input.position.y))
        ? { x: Math.round(Number(input.position.x)), y: Math.round(Number(input.position.y)) } : null,
    };
    const requestDigest = digest({
      actionId: action.id, assetId: asset.assetId, contentHash: asset.contentHash,
      adoptionDigest: candidate.adoption_digest, target,
    });
    if (candidate.placement_request_id) {
      if (candidate.placement_request_id !== clientRequestId
        || candidate.placement_request_digest !== requestDigest) {
        throw new CreatorConversationError('CREATOR_PLACEMENT_REQUEST_CONFLICT', '这个结果已经绑定另一份画布放置计划', 409);
      }
      return { action: this._publicAction(action), status: candidate.placement_status || 'pending', target };
    }
    const now = Date.now();
    let sequence = 0;
    this.db.transaction(() => {
      sequence = this._nextSequence(sessionId, now);
      this.db.prepare(`UPDATE creator_media_candidates SET
        placement_request_id = ?, placement_request_digest = ?, placement_status = 'pending', updated_at = ?
        WHERE session_id = ? AND action_id = ? AND asset_id = ?`).run(
        clientRequestId, requestDigest, now, sessionId, action.id, asset.assetId,
      );
      this._recordChange(sessionId, sequence, 'action', action.id);
    })();
    const result = this.getAction(action.id, sessionId, scope);
    this._emit(sessionId, 'action', result, sequence);
    return { action: result, status: 'pending', target };
  }

  completeMediaPlacement(actionId, sessionId, assetId, input = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const { action, asset } = this._resultAssetForAction(actionId, sessionId, assetId);
    const clientRequestId = requiredId(input.clientRequestId, '画布请求 ID');
    const candidate = this.db.prepare(`SELECT * FROM creator_media_candidates
      WHERE session_id = ? AND action_id = ? AND asset_id = ?`).get(sessionId, action.id, asset.assetId);
    if (!candidate?.placement_request_id || candidate.placement_request_id !== clientRequestId) {
      throw new CreatorConversationError('CREATOR_PLACEMENT_NOT_STARTED', '画布放置计划尚未建立', 409);
    }
    if (candidate.placement_status === 'completed') return this._publicAction(action);
    const nodeId = requiredId(input.nodeId, '画布节点 ID');
    const patchId = requiredId(input.patchId, '画布补丁 ID');
    const patchRequestDigest = bounded(input.patchRequestDigest, 64).toLowerCase();
    const rawCanvasRevision = Number(input.canvasRevision);
    const canvasRevision = Math.trunc(rawCanvasRevision);
    if (!/^[a-f0-9]{64}$/u.test(patchRequestDigest)
      || !Number.isFinite(rawCanvasRevision) || !Number.isSafeInteger(canvasRevision) || canvasRevision < 0) {
      throw new CreatorConversationError('CREATOR_PLACEMENT_EVIDENCE_INVALID', '画布没有返回完整的写入证据', 409);
    }
    const now = Date.now();
    const unsigned = {
      schema: 't8-creator-canvas-placement-receipt-v1', sessionId,
      actionId: action.id, assetId: asset.assetId, contentHash: String(asset.contentHash).toLowerCase(),
      adoptionDigest: candidate.adoption_digest, patchId, patchRequestDigest,
      nodeId, canvasRevision, appliedAt: now,
    };
    const receipt = { ...unsigned, receiptDigest: digest(unsigned) };
    let sequence = 0;
    this.db.transaction(() => {
      sequence = this._nextSequence(sessionId, now);
      this.db.prepare(`UPDATE creator_media_candidates SET placement_status = 'completed',
        placement_receipt_json = ?, updated_at = ?
        WHERE session_id = ? AND action_id = ? AND asset_id = ?`).run(
        JSON.stringify(receipt), now, sessionId, action.id, asset.assetId,
      );
      this._recordChange(sessionId, sequence, 'action', action.id);
    })();
    const result = this.getAction(action.id, sessionId, scope);
    this._emit(sessionId, 'action', result, sequence);
    return result;
  }

  getAction(id, sessionId, scope = {}) {
    this._requireConversation(sessionId, scope);
    const row = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(id, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!row) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    return this._publicAction(row);
  }

  retryFailedAction(id, sessionId, input = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const source = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(id, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!source) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    if (source.status !== 'failed') {
      throw new CreatorConversationError('CREATOR_ACTION_NOT_RETRYABLE', '只有失败的这一条可以单独重试', 409);
    }
    if (source.error_code === 'CREATOR_ACTION_SCENE_STALE') {
      throw new CreatorConversationError(
        'CREATOR_ACTION_SCENE_STALE',
        '这条生成使用的是旧场次内容，请按当前场重新整理后生成',
        409,
      );
    }
    const clientRequestId = requiredId(input.clientRequestId, '重试请求 ID');
    const replacementId = `action-retry-${digest({
      sessionId, sourceActionId: source.id, clientRequestId,
    }).slice(0, 32)}`;
    const sourceShots = actionShots(parseJson(source.shots_json, []), source.type);
    if (sourceShots.some((shot) => shot.status === 'ambiguous'
      && shot.errorCode === 'CREATOR_SUBMISSION_STATUS_UNKNOWN')) {
      throw new CreatorConversationError(
        'CREATOR_SUBMISSION_STATUS_UNKNOWN',
        '有镜头可能已经提交到远端，请先到渠道后台确认，不能自动重提',
        409,
      );
    }
    const retryShots = sourceShots.map((shot) => {
      if (shot.status === 'completed') return shot;
      return {
        ...shot,
        status: 'pending',
        resultAssets: [],
        runId: null,
        nodeRunId: null,
        attemptId: null,
        errorCode: null,
        errorMessage: null,
      };
    });
    const preservedAssets = sourceShots.length
      ? retryShots.flatMap((shot) => shot.status === 'completed' ? shot.resultAssets : [])
      : mediaRefs(parseJson(source.result_assets_json, []), 48);
    let created;
    let messageSequence = 0;
    const now = Date.now();
    this.db.transaction(() => {
      created = this._createActionInTransaction(sessionId, {
        id: replacementId,
        type: source.type,
        prompt: source.prompt,
        parameters: parseJson(source.parameters_json, {}),
        modelSnapshot: parseJson(source.model_snapshot_json, {}),
        inputAssetIds: parseJson(source.input_asset_ids_json, []),
        workBinding: parseJson(source.work_binding_json, null),
        shots: retryShots,
        resultAssets: preservedAssets,
      }, now);
      const message = this.db.prepare(`SELECT id FROM creator_messages
        WHERE session_id = ? AND action_id = ? ORDER BY sequence DESC LIMIT 1`).get(sessionId, source.id);
      if (message) {
        this.db.prepare('UPDATE creator_messages SET action_id = ?, media_json = ?, updated_at = ? WHERE id = ?')
          .run(replacementId, JSON.stringify(preservedAssets), now, message.id);
        messageSequence = this._nextSequence(sessionId, now);
        this._recordChange(sessionId, messageSequence, 'message', message.id);
      }
    })();
    const action = this._publicAction(created);
    this._emit(sessionId, 'action', action, action.sequence);
    if (messageSequence) {
      const message = this.db.prepare(`SELECT * FROM creator_messages
        WHERE session_id = ? AND action_id = ? ORDER BY sequence DESC LIMIT 1`).get(sessionId, replacementId);
      if (message) this._emit(sessionId, 'message', this._publicMessage(message), messageSequence);
    }
    return action;
  }

  updateAction(id, sessionId, patch = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const current = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(id, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!current) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    const status = bounded(patch.status || current.status, 24);
    if (!ACTION_STATUSES.has(status)) throw new CreatorConversationError('CREATOR_ACTION_STATUS_INVALID', '生成状态无效');
    const resultAssets = patch.resultAssets == null
      ? mediaRefs(parseJson(current.result_assets_json, []), 48) : mediaRefs(patch.resultAssets, 48);
    const shots = patch.shots == null
      ? actionShots(parseJson(current.shots_json, []), current.type) : actionShots(patch.shots, current.type);
    const now = Date.now();
    let eventSequence = 0;
    let conversationEventSequence = 0;
    this.db.transaction(() => {
      const changeSequence = this._nextSequence(current.session_id, now);
      eventSequence = changeSequence;
      this.db.prepare(`UPDATE creator_actions SET status = ?, run_intent_id = ?, run_id = ?, result_assets_json = ?, shots_json = ?,
        error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND session_id = ?`)
      .run(status, bounded(patch.runIntentId || current.run_intent_id, 180) || null,
          bounded(patch.runId || current.run_id, 180) || null, JSON.stringify(resultAssets), JSON.stringify(shots),
          bounded(patch.errorCode, 120) || null, bounded(patch.errorMessage, 1_000) || null,
          now, current.id, current.session_id);
      if (resultAssets.length) {
        this.db.prepare(`UPDATE creator_messages SET media_json = ?, updated_at = ?
          WHERE session_id = ? AND action_id = ?`).run(
          JSON.stringify(resultAssets), now, current.session_id, current.id,
        );
      }
      this._recordChange(current.session_id, changeSequence, 'action', current.id);
      const requestedConversationPhase = CREATOR_PHASES.has(patch.conversationPhase)
        ? patch.conversationPhase : null;
      if (requestedConversationPhase) {
        const conversation = this._conversation(current.session_id);
        const currentIndex = CREATOR_PHASE_ORDER.indexOf(conversation.phase);
        const requestedIndex = CREATOR_PHASE_ORDER.indexOf(requestedConversationPhase);
        if (requestedIndex > currentIndex) {
          conversationEventSequence = this._nextSequence(current.session_id, now);
          this.db.prepare('UPDATE creator_conversations SET phase = ?, updated_at = ? WHERE id = ?')
            .run(requestedConversationPhase, now, current.session_id);
          this._recordChange(current.session_id, conversationEventSequence, 'conversation', current.session_id);
        }
      }
    })();
    const action = this.getAction(current.id, current.session_id, scope);
    this._emit(current.session_id, 'action', action, eventSequence || action.sequence);
    if (conversationEventSequence) {
      this._emit(current.session_id, 'conversation', this._publicConversation(this._conversation(current.session_id)), conversationEventSequence);
    }
    return action;
  }

  cancelPendingAction(id, sessionId, scope = {}) {
    this._requireConversation(sessionId, scope);
    const current = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(id, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!current) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    if (current.status === 'cancelled') return this._publicAction(current);
    if (current.status !== 'pending') {
      throw new CreatorConversationError('CREATOR_ACTION_ALREADY_STARTED', '生成已经开始，不能在这里取消', 409);
    }
    const now = Date.now();
    let eventSequence = 0;
    this.db.transaction(() => {
      const changeSequence = this._nextSequence(current.session_id, now);
      eventSequence = changeSequence;
      this.db.prepare(`UPDATE creator_actions SET status = 'cancelled', error_code = NULL,
        error_message = NULL, updated_at = ? WHERE id = ? AND session_id = ?`)
        .run(now, current.id, current.session_id);
      this._recordChange(current.session_id, changeSequence, 'action', current.id);
    })();
    const action = this.getAction(current.id, current.session_id, scope);
    this._emit(current.session_id, 'action', action, eventSequence || action.sequence);
    return action;
  }

  getPreferences(input = {}) {
    const projectId = requiredId(input.projectId, '项目 ID');
    const canvasId = requiredId(input.canvasId, '画布 ID');
    const row = this.db.prepare('SELECT * FROM creator_preferences WHERE project_id = ? AND canvas_id = ?')
      .get(projectId, canvasId);
    return row ? { ...parseJson(row.preferences_json, preferences()), updatedAt: Number(row.updated_at) } : preferences();
  }

  putPreferences(input = {}) {
    const projectId = requiredId(input.projectId, '项目 ID');
    const canvasId = requiredId(input.canvasId, '画布 ID');
    const normalized = preferences(input.preferences);
    const now = Date.now();
    this.db.prepare(`INSERT INTO creator_preferences(project_id, canvas_id, preferences_json, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(project_id, canvas_id)
      DO UPDATE SET preferences_json = excluded.preferences_json, updated_at = excluded.updated_at`)
      .run(projectId, canvasId, JSON.stringify(normalized), now);
    return { ...normalized, updatedAt: now };
  }

  listChanges(id, input = {}) {
    const row = this._requireConversation(id, input);
    const after = cursor(input.after);
    const pageSize = limit(input.limit, 100, 200);
    const changes = this.db.prepare(`SELECT sequence, kind, entity_id FROM creator_change_log
      WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`).all(row.id, after, pageSize);
    return changes.map((change) => {
      if (change.kind === 'message') {
        return { sequence: Number(change.sequence), kind: 'message', data: this._publicMessage(this.db.prepare('SELECT * FROM creator_messages WHERE id = ?').get(change.entity_id)) };
      }
      if (change.kind === 'action') {
        return { sequence: Number(change.sequence), kind: 'action', data: this._publicAction(this.db.prepare('SELECT * FROM creator_actions WHERE id = ?').get(change.entity_id)) };
      }
      if (change.kind === 'work') {
        return { sequence: Number(change.sequence), kind: 'work', data: this._publicWorkState(row.id) };
      }
      return { sequence: Number(change.sequence), kind: 'conversation', data: this._publicConversation(this._conversation(row.id)) };
    });
  }

  stats() {
    return {
      conversations: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_conversations').get().count),
      messages: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_messages').get().count),
      actions: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_actions').get().count),
      preferences: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_preferences').get().count),
      workSnapshots: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_work_snapshots').get().count),
      workArtifactVersions: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_work_artifact_versions').get().count),
    };
  }

  close() {
    this.events.removeAllListeners();
    // This is the Creator repository's owned better-sqlite3 handle, not the
    // application ProjectDatabase lifecycle surface audited elsewhere.
    const ownedSqlite = this.db;
    if (this.ownsDatabase) ownedSqlite.close();
  }
}

module.exports = {
  CREATOR_CONVERSATION_SCHEMA,
  CreatorConversationError,
  CreatorConversationRepository,
  digest,
  mergeWorkingBriefPatch,
  modelSnapshot,
  preferences,
};
