'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const CREATOR_CONVERSATION_SCHEMA = 't8-creator-conversation-v2';
const CREATOR_PHASES = new Set(['idea', 'script', 'assets', 'shots', 'candidates', 'delivery']);
const CREATOR_PHASE_ORDER = ['idea', 'script', 'assets', 'shots', 'candidates', 'delivery'];
const CREATOR_STATUSES = new Set(['active', 'completed', 'archived']);
const MESSAGE_ROLES = new Set(['user', 'assistant']);
const MESSAGE_STATUSES = new Set(['streaming', 'completed', 'failed', 'stopped']);
const ACTION_STATUSES = new Set(['pending', 'running', 'ambiguous', 'completed', 'failed', 'cancelled']);
const ACTION_TYPES = new Set(['image', 'video']);
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

function mediaRefs(value) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 12) throw new CreatorConversationError('CREATOR_MEDIA_LIMIT', '单条消息最多引用 12 个素材');
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

function preferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreatorConversationError('CREATOR_PREFERENCES_INVALID', '生成设置格式无效');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => FORBIDDEN_PREFERENCE_KEYS.test(key))) {
    throw new CreatorConversationError('CREATOR_PREFERENCES_FORBIDDEN', '生成设置不能保存凭据或费用信息');
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
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    if (filename !== ':memory:') this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.reconcileInterruptedResponses();
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
    `);
    const conversationColumns = new Set(this.db.prepare('PRAGMA table_info(creator_conversations)').all().map((row) => row.name));
    if (!conversationColumns.has('working_brief_json')) {
      this.db.exec("ALTER TABLE creator_conversations ADD COLUMN working_brief_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!conversationColumns.has('phase_evidence_json')) {
      this.db.exec("ALTER TABLE creator_conversations ADD COLUMN phase_evidence_json TEXT NOT NULL DEFAULT '{}'");
    }
    const messageColumns = new Set(this.db.prepare('PRAGMA table_info(creator_messages)').all().map((row) => row.name));
    if (!messageColumns.has('reply_to_message_id')) {
      this.db.exec('ALTER TABLE creator_messages ADD COLUMN reply_to_message_id TEXT');
    }
    if (!messageColumns.has('selected_nodes_json')) {
      this.db.exec("ALTER TABLE creator_messages ADD COLUMN selected_nodes_json TEXT NOT NULL DEFAULT '[]'");
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_creator_messages_reply
      ON creator_messages(session_id, reply_to_message_id)
      WHERE reply_to_message_id IS NOT NULL;`);
    this.db.exec(`DROP INDEX IF EXISTS idx_creator_actions_pending;
      CREATE UNIQUE INDEX idx_creator_actions_pending ON creator_actions(session_id)
      WHERE status IN ('pending', 'running', 'ambiguous');`);
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
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  _publicMessage(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: Number(row.sequence),
      role: row.role,
      body: row.body,
      status: row.status,
      suggestions: parseJson(row.suggestions_json, []),
      actionId: row.action_id || null,
      media: parseJson(row.media_json, []),
      responseId: row.response_id || null,
      replyToMessageId: row.reply_to_message_id || null,
      selectedNodes: selectedNodeRefs(parseJson(row.selected_nodes_json, [])),
      errorCode: row.error_code || null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  _publicAction(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      sequence: Number(row.sequence),
      type: row.type,
      prompt: row.prompt,
      parameters: parseJson(row.parameters_json, {}),
      modelSnapshot: parseJson(row.model_snapshot_json, {}),
      inputAssetIds: parseJson(row.input_asset_ids_json, []),
      status: row.status,
      runIntentId: row.run_intent_id || null,
      runId: row.run_id || null,
      resultAssets: parseJson(row.result_assets_json, []),
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
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
    const requestDigest = digest({
      body,
      attachments: normalizedMedia.map((item) => ({
        assetId: item.assetId, kind: item.kind, contentHash: item.contentHash, contentRevision: item.contentRevision,
      })),
      selectedNodes: normalizedSelectedNodes,
    });
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
    const requestDigest = digest({
      body,
      attachments: normalizedMedia.map((item) => ({
        assetId: item.assetId, kind: item.kind, contentHash: item.contentHash, contentRevision: item.contentRevision,
      })),
      selectedNodes: normalizedSelectedNodes,
    });
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
    if (existing.body !== body) {
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
    const run = this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM creator_messages WHERE session_id = ? AND response_id = ?')
        .get(row.id, requiredId(responseId, '回复 ID'));
      if (!current) throw new CreatorConversationError('CREATOR_RESPONSE_NOT_FOUND', '回复不存在', 404);
      if (current.status !== 'streaming') return current;
      const changeSequence = this._nextSequence(row.id, now);
      eventSequence = changeSequence;
      this.db.prepare(`UPDATE creator_messages SET body = ?, status = 'completed', suggestions_json = ?, action_id = ?, updated_at = ? WHERE id = ?`)
        .run(body, JSON.stringify(normalizedSuggestions), actionId, now, current.id);
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
      return this.db.prepare('SELECT * FROM creator_messages WHERE id = ?').get(current.id);
    });
    const message = this._publicMessage(run());
    this._emit(row.id, 'message', message, eventSequence || message.sequence);
    if (input.action) this._emit(row.id, 'action', this.getAction(input.action.id, row.id));
    if (conversationEventSequence) {
      this._emit(row.id, 'conversation', this._publicConversation(this._conversation(row.id)), conversationEventSequence);
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
    const requestDigest = digest({ type, prompt, parameters, snapshot, inputAssetIds });
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
      model_snapshot_json, model_snapshot_digest, input_asset_ids_json, status,
      result_assets_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?)`)
      .run(id, sessionId, sequence, type, prompt, JSON.stringify(parameters), requestDigest,
        JSON.stringify(snapshot), digest(snapshot), JSON.stringify(inputAssetIds), now, now);
    this._recordChange(sessionId, sequence, 'action', id);
    return this.db.prepare('SELECT * FROM creator_actions WHERE id = ?').get(id);
  }

  getAction(id, sessionId, scope = {}) {
    this._requireConversation(sessionId, scope);
    const row = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(id, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!row) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    return this._publicAction(row);
  }

  updateAction(id, sessionId, patch = {}, scope = {}) {
    this._requireConversation(sessionId, scope);
    const current = this.db.prepare('SELECT * FROM creator_actions WHERE id = ? AND session_id = ?')
      .get(requiredId(id, '动作 ID'), requiredId(sessionId, '会话 ID'));
    if (!current) throw new CreatorConversationError('CREATOR_ACTION_NOT_FOUND', '生成动作不存在', 404);
    const status = bounded(patch.status || current.status, 24);
    if (!ACTION_STATUSES.has(status)) throw new CreatorConversationError('CREATOR_ACTION_STATUS_INVALID', '生成状态无效');
    const resultAssets = patch.resultAssets == null ? parseJson(current.result_assets_json, []) : mediaRefs(patch.resultAssets);
    const now = Date.now();
    let eventSequence = 0;
    let conversationEventSequence = 0;
    this.db.transaction(() => {
      const changeSequence = this._nextSequence(current.session_id, now);
      eventSequence = changeSequence;
      this.db.prepare(`UPDATE creator_actions SET status = ?, run_intent_id = ?, run_id = ?, result_assets_json = ?,
        error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND session_id = ?`)
        .run(status, bounded(patch.runIntentId || current.run_intent_id, 180) || null,
          bounded(patch.runId || current.run_id, 180) || null, JSON.stringify(resultAssets),
          bounded(patch.errorCode, 120) || null, bounded(patch.errorMessage, 1_000) || null,
          now, current.id, current.session_id);
      if (status === 'completed' && resultAssets.length) {
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
      return { sequence: Number(change.sequence), kind: 'conversation', data: this._publicConversation(this._conversation(row.id)) };
    });
  }

  stats() {
    return {
      conversations: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_conversations').get().count),
      messages: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_messages').get().count),
      actions: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_actions').get().count),
      preferences: Number(this.db.prepare('SELECT COUNT(*) AS count FROM creator_preferences').get().count),
    };
  }

  close() {
    this.events.removeAllListeners();
    if (this.ownsDatabase) this.db.close();
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
