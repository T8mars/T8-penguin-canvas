const crypto = require('node:crypto');

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const APPROVAL_LIMIT = 64;
const APPROVAL_BINDING_SCHEMA = 't8-agent-control-approval-binding-v1';
const APPROVAL_ACTIONS = new Set([
  'patch.apply',
  'patch.revert',
  'asset.place',
  'asset.import',
  'asset.download',
  'delivery.package',
  'run.start',
  'run.retry',
  'creative.apply',
]);

class AgentControlApprovalError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AgentControlApprovalError';
    this.code = code;
    this.status = status;
  }
}

function secretHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

function secretMatches(value, expected) {
  const actual = secretHash(value);
  return Buffer.isBuffer(expected)
    && actual.length === expected.length
    && crypto.timingSafeEqual(actual, expected);
}

function stableDigest(value) {
  const stable = (input) => {
    if (input === undefined || input === null) return 'null';
    if (typeof input !== 'object') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(',')}}`;
  };
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function cloneRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function boundedText(value, maxLength = 240) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function approvalBindingInvalid(message) {
  throw new AgentControlApprovalError(
    'APPROVAL_BINDING_INVALID',
    message,
    409,
  );
}

function normalizeProviderSelections(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    approvalBindingInvalid('审批绑定中的 Provider 与模型范围无效，请重新生成计划');
  }
  if (value.length > 32) {
    approvalBindingInvalid('审批绑定中的 Provider 与模型范围过大，请缩小本次确认范围');
  }
  const selections = value.map((raw) => {
    const entry = cloneRecord(raw);
    const provider = boundedText(entry.provider, 160);
    const model = boundedText(entry.model, 240);
    if (!provider || !model) {
      approvalBindingInvalid('审批绑定中的 Provider 或模型为空，请重新生成计划');
    }
    if (entry.nodeIds != null && !Array.isArray(entry.nodeIds)) {
      approvalBindingInvalid('审批绑定中的节点范围无效，请重新生成计划');
    }
    const nodeIds = [...new Set((Array.isArray(entry.nodeIds) ? entry.nodeIds : [])
      .map((nodeId) => boundedText(nodeId, 160))
      .filter(Boolean))]
      .sort();
    if (nodeIds.length > 64) {
      approvalBindingInvalid('审批绑定中的节点范围过大，请缩小本次确认范围');
    }
    const normalized = {
      kind: boundedText(entry.kind, 40),
      mode: boundedText(entry.mode, 40),
      status: boundedText(entry.status, 40),
      provider,
      model,
    };
    if (nodeIds.length) normalized.nodeIds = nodeIds;
    return normalized;
  }).sort((left, right) => stableDigest(left).localeCompare(stableDigest(right)));
  const unique = new Set(selections.map((entry) => stableDigest(entry)));
  if (unique.size !== selections.length) {
    approvalBindingInvalid('审批绑定中存在重复的 Provider 与模型范围，请重新生成计划');
  }
  return selections;
}

function normalizeEvidenceBoundary(value, label, unknownMessage) {
  const entry = cloneRecord(value);
  const status = boundedText(entry.status || 'unknown', 24).toLowerCase();
  if (status === 'unknown') {
    return {
      status: 'unknown',
      message: boundedText(entry.message, 240) || unknownMessage,
    };
  }
  if (status !== 'verified') {
    approvalBindingInvalid(`${label}缺少可信证据，不能作为审批边界；请重新生成计划`);
  }
  const evidenceValue = boundedText(entry.value, 160);
  const sourceDigest = boundedText(entry.sourceDigest, 128).toLowerCase();
  const asOf = boundedText(entry.asOf, 80);
  const timestamp = Date.parse(asOf);
  if (!evidenceValue
    || !/^[a-f0-9]{64}$/.test(sourceDigest)
    || !asOf
    || !Number.isFinite(timestamp)) {
    approvalBindingInvalid(`${label}的可信来源、时间或取值无效，请重新生成计划`);
  }
  return {
    status: 'verified',
    value: evidenceValue,
    sourceDigest,
    asOf: new Date(timestamp).toISOString(),
    message: boundedText(entry.message, 240) || `${label}已由带摘要和时间的可信来源核验。`,
  };
}

function createAgentControlApprovalBinding(input = {}) {
  const subjectVersionDigest = String(input.subjectVersionDigest || input.planDigest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(subjectVersionDigest)) {
    throw new AgentControlApprovalError(
      'APPROVAL_BINDING_INVALID',
      '审批绑定缺少可验证的计划版本，请重新生成计划',
      409,
    );
  }
  const planDigest = String(input.planDigest || subjectVersionDigest).trim().toLowerCase();
  const modelDecisionDigest = String(input.modelDecisionDigest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(planDigest)
    || (modelDecisionDigest && !/^[a-f0-9]{64}$/.test(modelDecisionDigest))) {
    throw new AgentControlApprovalError(
      'APPROVAL_BINDING_INVALID',
      '审批绑定中的计划或模型回执摘要无效，请重新生成计划',
      409,
    );
  }
  const action = String(input.action || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const projectId = String(input.projectId || '').trim();
  const canvasId = String(input.canvasId || '').trim();
  const subject = cloneRecord(input.subject);
  if (!action || !sessionId || !projectId || !canvasId || !Object.keys(subject).length) {
    throw new AgentControlApprovalError(
      'APPROVAL_BINDING_INVALID',
      '审批绑定范围不完整，请重新生成计划',
      409,
    );
  }
  const inputBoundary = cloneRecord(input.boundary);
  const boundary = {
    providerSelections: normalizeProviderSelections(inputBoundary.providerSelections),
    costTier: normalizeEvidenceBoundary(
      inputBoundary.costTier,
      '费用等级',
      '当前没有可验证的价格等级元数据，审批不会猜测费用。',
    ),
    privacyBoundary: normalizeEvidenceBoundary(
      inputBoundary.privacyBoundary,
      '隐私边界',
      '当前没有可验证的隐私边界元数据，审批不会猜测数据驻留范围。',
    ),
  };
  const subjectKey = stableDigest({
    action,
    sessionId,
    projectId,
    canvasId,
    subject,
  });
  const boundaryDigest = stableDigest(boundary);
  const binding = {
    schema: APPROVAL_BINDING_SCHEMA,
    action,
    sessionId,
    projectId,
    canvasId,
    subject,
    subjectKey,
    subjectVersionDigest,
    planDigest,
    modelDecisionDigest: modelDecisionDigest || null,
    boundary,
    boundaryDigest,
  };
  binding.bindingDigest = stableDigest(binding);
  return Object.freeze(binding);
}

function createAgentControlApprovalService(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const ttlMs = Math.max(60_000, Math.min(15 * 60 * 1000, Number(options.ttlMs) || APPROVAL_TTL_MS));
  const approvals = new Map();
  const approvalPollSecrets = new Map();
  const mutationListeners = new Set();

  function cleanup() {
    const current = now();
    for (const [id, record] of approvals) {
      if (record.expiresAt <= current || record.consumedAt || record.failedAt) {
        approvals.delete(id);
        approvalPollSecrets.delete(id);
      }
    }
  }

  function creationResponse(record, idempotent = false) {
    const pollSecret = approvalPollSecrets.get(record.id);
    if (!pollSecret) {
      throw new AgentControlApprovalError(
        'APPROVAL_RETRY_UNAVAILABLE',
        '这次确认已无法安全恢复，请重新生成计划后再试',
        409,
      );
    }
    return {
      approvalRequestId: record.id,
      pollSecret,
      action: record.action,
      patchId: record.patchId,
      operationId: record.operationId,
      projectId: record.projectId,
      canvasId: record.canvasId,
      preview: record.preview,
      approvalBinding: record.approvalBinding,
      expiresAt: new Date(record.expiresAt).toISOString(),
      status: record.deniedAt ? 'denied' : record.approvedAt ? 'approved' : 'pending',
      idempotent,
    };
  }

  function invalidateBinding(rawBinding = {}) {
    cleanup();
    const binding = createAgentControlApprovalBinding(rawBinding);
    const supersededAt = now();
    let invalidated = 0;
    for (const record of approvals.values()) {
      if (!record.approvalBinding
        || record.approvalBinding.subjectKey !== binding.subjectKey
        || record.approvalBinding.bindingDigest === binding.bindingDigest
        || record.consumedAt
        || record.failedAt
        || record.supersededAt) {
        continue;
      }
      record.supersededAt = supersededAt;
      record.supersededByDigest = binding.bindingDigest;
      invalidated += 1;
    }
    return {
      schema: APPROVAL_BINDING_SCHEMA,
      subjectKey: binding.subjectKey,
      bindingDigest: binding.bindingDigest,
      invalidated,
    };
  }

  function create(input = {}) {
    cleanup();
    if (!APPROVAL_ACTIONS.has(input.action)) {
      throw new AgentControlApprovalError('APPROVAL_REQUEST_INVALID', '待确认操作类型无效');
    }
    const approvalBinding = input.approvalBinding
      ? createAgentControlApprovalBinding(input.approvalBinding)
      : null;
    if (approvalBinding && (
      approvalBinding.action !== input.action
      || approvalBinding.sessionId !== String(input.sessionId || '')
      || approvalBinding.projectId !== String(input.projectId || '')
      || approvalBinding.canvasId !== String(input.canvasId || '')
    )) {
      throw new AgentControlApprovalError(
        'APPROVAL_BINDING_SCOPE_MISMATCH',
        '审批绑定与当前会话或画布范围不一致，已停止创建审批',
        409,
      );
    }
    const operationId = String(input.operationId || '').trim();
    const requestDigest = stableDigest({
      action: input.action,
      operationId,
      sessionId: String(input.sessionId || ''),
      actorId: String(input.actorId || ''),
      projectId: String(input.projectId || ''),
      canvasId: String(input.canvasId || ''),
      patchId: String(input.patchId || input.patch?.id || ''),
      patch: input.patch || null,
      payload: input.payload || null,
      sourceActorId: String(input.sourceActorId || ''),
      preview: input.preview || null,
      expectedRevision: input.expectedRevision == null ? null : Number(input.expectedRevision),
      approvalBindingDigest: approvalBinding?.bindingDigest || null,
    });
    if (operationId) {
      const existing = [...approvals.values()].find((record) => (
        record.action === input.action
        && record.sessionId === String(input.sessionId || '')
        && record.operationId === operationId
      ));
      if (existing) {
        if (existing.requestDigest !== requestDigest) {
          throw new AgentControlApprovalError(
            'APPROVAL_IDEMPOTENCY_CONFLICT',
            '同一 operationId 已用于不同的计划、模型或执行范围，请生成新的操作标识',
            409,
          );
        }
        if (existing.supersededAt) {
          throw new AgentControlApprovalError(
            'APPROVAL_STALE',
            '这个确认对应的计划、模型或平台已经更新；旧确认已失效，请核对最新回执后重新确认',
            409,
          );
        }
        return creationResponse(existing, true);
      }
    }
    if (approvalBinding) invalidateBinding(approvalBinding);
    if ([...approvals.values()].filter((record) => !record.supersededAt).length >= APPROVAL_LIMIT) {
      throw new AgentControlApprovalError('APPROVAL_LIMIT_REACHED', '待确认操作过多，请先处理已有请求', 429);
    }
    const id = crypto.randomUUID();
    const pollSecret = crypto.randomBytes(32).toString('base64url');
    const createdAt = now();
    const record = {
      id,
      action: input.action,
      sessionId: String(input.sessionId || ''),
      actorId: String(input.actorId || ''),
      clientName: String(input.clientName || 'Agent').slice(0, 80),
      projectId: String(input.projectId || ''),
      canvasId: String(input.canvasId || ''),
      patchId: String(input.patchId || input.patch?.id || ''),
      operationId,
      requestDigest,
      patch: input.patch || null,
      payload: input.payload || null,
      sourceActorId: String(input.sourceActorId || ''),
      preview: input.preview || null,
      expectedRevision: input.expectedRevision == null ? null : Number(input.expectedRevision),
      approvalBinding,
      pollSecretHash: secretHash(pollSecret),
      createdAt,
      expiresAt: createdAt + ttlMs,
      approvedAt: null,
      deniedAt: null,
      consumedAt: null,
      failedAt: null,
      completing: false,
      supersededAt: null,
      supersededByDigest: '',
    };
    approvals.set(id, record);
    approvalPollSecrets.set(id, pollSecret);
    return creationResponse(record);
  }

  function publicRecord(record) {
    return {
      approvalRequestId: record.id,
      action: record.action,
      clientName: record.clientName,
      projectId: record.projectId,
      canvasId: record.canvasId,
      patchId: record.patchId,
      operationId: record.operationId,
      preview: record.preview,
      expectedRevision: record.expectedRevision,
      approvalBinding: record.approvalBinding,
      createdAt: new Date(record.createdAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }

  function listPending() {
    cleanup();
    return [...approvals.values()]
      .filter((record) => !record.approvedAt && !record.deniedAt && !record.supersededAt)
      .map(publicRecord)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  function inspectOperation(input = {}) {
    cleanup();
    const record = [...approvals.values()].find((item) => item.action === String(input.action || '') && item.operationId === String(input.operationId || '') && item.sessionId === String(input.sessionId || ''));
    if (!record || record.projectId !== String(input.projectId || '') || record.canvasId !== String(input.canvasId || '') || record.supersededAt) throw new AgentControlApprovalError('APPROVAL_NOT_FOUND', '待确认操作不存在或不属于当前会话', 404);
    // Same authenticated native session only. Its polling secret already has
    // the same disclosure boundary as create(); this never approves/completes.
    return creationResponse(record, true);
  }

  function approve(id) {
    cleanup();
    const record = approvals.get(String(id || ''));
    if (!record) throw new AgentControlApprovalError('APPROVAL_NOT_FOUND', '待确认操作不存在或已过期', 404);
    if (record.supersededAt) {
      throw new AgentControlApprovalError(
        'APPROVAL_STALE',
        '这个确认对应的计划已经更新，请查看最新计划并重新确认',
        409,
      );
    }
    if (!record.approvedAt) record.approvedAt = now();
    return { approvalRequestId: record.id, status: 'approved', approvedAt: new Date(record.approvedAt).toISOString() };
  }

  function deny(id) {
    cleanup();
    const record = approvals.get(String(id || ''));
    if (!record) throw new AgentControlApprovalError('APPROVAL_NOT_FOUND', '待确认操作不存在或已过期', 404);
    record.deniedAt = now();
    return { approvalRequestId: record.id, status: 'denied' };
  }

  function beginCompletion(input = {}) {
    cleanup();
    const record = approvals.get(String(input.approvalRequestId || ''));
    if (!record) throw new AgentControlApprovalError('APPROVAL_NOT_FOUND', '待确认操作不存在或已过期', 404);
    if (record.sessionId !== String(input.sessionId || '')) {
      throw new AgentControlApprovalError('APPROVAL_SESSION_MISMATCH', '待确认操作不属于当前 Agent 会话', 403);
    }
    if (!secretMatches(input.pollSecret, record.pollSecretHash)) {
      throw new AgentControlApprovalError('APPROVAL_POLL_FORBIDDEN', '待确认操作的轮询凭据无效', 403);
    }
    if (record.supersededAt) {
      throw new AgentControlApprovalError(
        'APPROVAL_STALE',
        '这个确认对应的计划、模型或平台已经更新；旧确认已失效，请核对最新回执后重新确认',
        409,
      );
    }
    if (record.deniedAt) return { status: 'denied', record: null };
    if (!record.approvedAt) return { status: 'pending', record: null };
    if (record.completing) {
      throw new AgentControlApprovalError('APPROVAL_IN_PROGRESS', '此操作正在提交，请稍后查询', 409);
    }
    record.completing = true;
    return { status: 'approved', record };
  }

  function finishCompletion(record, succeeded) {
    if (!record) return;
    record.completing = false;
    if (succeeded) record.consumedAt = now();
    else record.failedAt = now();
  }

  function subscribeMutations(listener) {
    if (typeof listener !== 'function') {
      throw new AgentControlApprovalError('APPROVAL_LISTENER_INVALID', '画布变更监听器无效');
    }
    mutationListeners.add(listener);
    return () => mutationListeners.delete(listener);
  }

  function publishMutation(input = {}) {
    const revision = Number(input.revision);
    const event = Object.freeze({
      schema: 't8-agent-control-canvas-mutation-v1',
      approvalRequestId: String(input.approvalRequestId || ''),
      action: input.action === 'patch.revert' ? 'patch.revert' : 'patch.apply',
      projectId: String(input.projectId || ''),
      canvasId: String(input.canvasId || ''),
      patchId: String(input.patchId || ''),
      revision: Number.isSafeInteger(revision) && revision > 0 ? revision : 0,
      warningCodes: Array.isArray(input.warningCodes)
        ? input.warningCodes
          .map((value) => String(value || ''))
          .filter((value) => /^[A-Z0-9_.-]{1,120}$/i.test(value))
          .slice(0, 8)
        : [],
      committedAt: new Date(now()).toISOString(),
    });
    if (!event.approvalRequestId || !event.projectId || !event.canvasId || !event.patchId || !event.revision) {
      throw new AgentControlApprovalError('APPROVAL_MUTATION_EVENT_INVALID', '已提交画布变更的通知数据无效', 500);
    }
    for (const listener of mutationListeners) {
      try {
        listener(event);
      } catch (_) {
        // A renderer notification failure must never turn a committed SQLite
        // transaction into a client-visible failure that may be retried.
      }
    }
    return event;
  }

  return {
    approve,
    beginCompletion,
    cleanup,
    create,
    deny,
    finishCompletion,
    invalidateBinding,
    listPending,
    inspectOperation,
    publishMutation,
    subscribeMutations,
  };
}

const agentControlApprovalService = createAgentControlApprovalService();

module.exports = {
  APPROVAL_ACTIONS,
  APPROVAL_BINDING_SCHEMA,
  AgentControlApprovalError,
  agentControlApprovalService,
  createAgentControlApprovalBinding,
  createAgentControlApprovalService,
};
