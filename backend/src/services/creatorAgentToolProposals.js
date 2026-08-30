'use strict';

const crypto = require('crypto');
const {
  AgentControlCapabilityToolError,
  prepareVersionedCapabilityToolRequest,
} = require('./agentControlCapabilityTools');

const CREATOR_MODEL_TOOL_PROPOSAL_SCHEMA = 't8-creator-model-tool-proposal-v1';
const CREATOR_TOOL_PROPOSAL_SCHEMA = 't8-creator-tool-proposal-v1';
const CREATOR_TOOL_PROPOSAL_RECEIPT_SCHEMA = 't8-creator-tool-proposal-receipt-v1';
const PROPOSAL_ID_RE = /^ctp_[A-Za-z0-9_-]{12,64}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const EXPECTED_KEYS = new Set([
  'sessionId',
  'responseId',
  'responseDigest',
  'planId',
  'planDigest',
  'artifactId',
  'artifactVersionId',
  'artifactDigest',
  'workId',
  'workRevision',
  'workDigest',
  'canvasRevision',
]);
const TOP_LEVEL_KEYS = new Set(['schema', 'proposalId', 'request', 'expected']);

class CreatorAgentToolProposalError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'CreatorAgentToolProposalError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

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

function plainRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_INVALID',
      `${label}必须是普通对象`,
    );
  }
  return value;
}

function boundedText(value, maximum = 256) {
  return String(value == null ? '' : value).trim().slice(0, maximum);
}

function currentBinding(session, assistantEvent) {
  if (assistantEvent?.type !== 'assistant.response.completed') {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_RESPONSE_REQUIRED',
      '工具提议必须绑定一条已经完整保存的创作回复',
      409,
    );
  }
  const responseId = boundedText(assistantEvent.payload?.responseId, 160);
  const responseDigest = boundedText(assistantEvent.payload?.responseDigest, 64).toLowerCase();
  if (!responseId || !DIGEST_RE.test(responseDigest)) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_RESPONSE_INVALID',
      '创作回复缺少可验证的版本摘要，已拒绝工具提议',
      409,
    );
  }
  const plan = assistantEvent.payload?.plan && typeof assistantEvent.payload.plan === 'object'
    ? assistantEvent.payload.plan : null;
  const artifact = assistantEvent.payload?.artifactVersion
    && typeof assistantEvent.payload.artifactVersion === 'object'
    ? assistantEvent.payload.artifactVersion : null;
  const work = session?.creatorWork && typeof session.creatorWork === 'object'
    && !Array.isArray(session.creatorWork) ? session.creatorWork : null;
  const canvasRevision = Number(session?.context?.canvasRevision);
  return {
    sessionId: boundedText(session?.id, 160),
    projectId: boundedText(session?.projectId, 256),
    canvasId: boundedText(session?.canvasId, 256),
    responseId,
    responseDigest,
    planId: boundedText(plan?.planId, 160) || null,
    planDigest: boundedText(plan?.planDigest, 160) || null,
    artifactId: boundedText(artifact?.artifactId, 80) || null,
    artifactVersionId: boundedText(artifact?.versionId, 80) || null,
    artifactDigest: boundedText(artifact?.content?.contentDigest, 64).toLowerCase() || null,
    workId: boundedText(work?.workId, 80) || null,
    workRevision: Number.isSafeInteger(Number(work?.revision)) && Number(work.revision) >= 1
      ? Number(work.revision) : null,
    workDigest: boundedText(work?.workDigest, 64).toLowerCase() || null,
    canvasRevision: Number.isSafeInteger(canvasRevision) && canvasRevision >= 0
      ? canvasRevision : null,
  };
}

function assertExpectedBinding(expectedValue, binding) {
  if (expectedValue == null) return;
  const expected = plainRecord(expectedValue, '工具提议 expected');
  const unexpected = Object.keys(expected).filter((key) => !EXPECTED_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_INVALID',
      `工具提议 expected 包含未声明字段：${unexpected.join('、')}`,
    );
  }
  for (const key of Object.keys(expected)) {
    const actual = binding[key];
    const supplied = key === 'canvasRevision' || key === 'workRevision'
      ? Number(expected[key])
      : boundedText(expected[key], key.toLowerCase().includes('digest') ? 160 : 256)
        || null;
    if (supplied !== actual) {
      throw new CreatorAgentToolProposalError(
        'CREATOR_TOOL_PROPOSAL_STALE',
        '工具提议绑定的回复、计划、作品或画布版本已经过期，请基于当前结果重新提议',
        409,
        { binding: key },
      );
    }
  }
}

function compileCreatorToolProposal(input = {}) {
  const raw = plainRecord(input.proposal, '模型工具提议');
  const unexpected = Object.keys(raw).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unexpected.length > 0 || raw.schema !== CREATOR_MODEL_TOOL_PROPOSAL_SCHEMA) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_INVALID',
      unexpected.length > 0
        ? `模型工具提议包含未声明字段：${unexpected.join('、')}`
        : '模型工具提议版本不受支持',
    );
  }
  const binding = currentBinding(input.session, input.assistantEvent);
  assertExpectedBinding(raw.expected, binding);
  let prepared;
  try {
    prepared = prepareVersionedCapabilityToolRequest(raw.request);
  } catch (error) {
    if (error instanceof AgentControlCapabilityToolError) {
      throw new CreatorAgentToolProposalError(
        error.code,
        error.message,
        error.status,
        error.details,
      );
    }
    throw error;
  }
  if (prepared.projectId !== binding.projectId || prepared.canvasId !== binding.canvasId) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_SCOPE_MISMATCH',
      '工具提议不属于当前项目或画布，已拒绝保存',
      403,
    );
  }
  const createdAt = boundedText(input.createdAt, 80) || new Date().toISOString();
  const body = {
    schema: CREATOR_TOOL_PROPOSAL_SCHEMA,
    binding,
    tool: {
      protocol: 't8-versioned-creative-tool-v1',
      requestSchema: prepared.requestSchema,
      name: prepared.tool,
      version: prepared.version,
      capabilityId: prepared.capabilityId,
      creatorLabel: boundedText(prepared.surface?.creatorLabel, 80) || prepared.capabilityId,
      operation: prepared.operation,
      requestAction: prepared.requestAction,
      capabilityManifestDigest: prepared.surfaceDigest,
      capabilityGraphDigest: prepared.capabilityGraphDigest,
    },
    request: {
      schema: prepared.requestSchema,
      tool: prepared.tool,
      version: prepared.version,
      operation: prepared.operation,
      projectId: prepared.projectId,
      canvasId: prepared.canvasId,
      clientRequestId: prepared.clientRequestId || null,
      input: prepared.input,
    },
    gate: {
      riskLevel: prepared.operationContract.riskLevel,
      approvalRequired: Boolean(prepared.operationContract.approvalRequired),
      requiredScopes: [...prepared.requiredScopes],
      directOperation: Boolean(prepared.direct),
      previewRequired: prepared.operationContract.riskLevel !== 'L0',
      dispatchAllowed: false,
      status: 'proposed',
    },
    execution: {
      status: 'not-started',
      canvasWrites: 0,
      providerCalls: 0,
      fileWrites: 0,
    },
    createdAt,
  };
  const proposalDigest = digest(body);
  const suppliedId = boundedText(raw.proposalId, 80);
  const proposalId = suppliedId
    ? suppliedId
    : `ctp_${proposalDigest.slice(0, 32)}`;
  if (!PROPOSAL_ID_RE.test(proposalId)) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_ID_INVALID',
      '模型工具提议编号无效',
    );
  }
  return Object.freeze({
    ...body,
    proposalId,
    proposalDigest,
  });
}

function validateStoredCreatorToolProposal(value) {
  const proposal = plainRecord(value, '已保存工具提议');
  if (proposal.schema !== CREATOR_TOOL_PROPOSAL_SCHEMA
    || !PROPOSAL_ID_RE.test(String(proposal.proposalId || ''))
    || !DIGEST_RE.test(String(proposal.proposalDigest || ''))
    || proposal.execution?.status !== 'not-started'
    || Number(proposal.execution?.canvasWrites) !== 0
    || Number(proposal.execution?.providerCalls) !== 0
    || Number(proposal.execution?.fileWrites) !== 0
    || proposal.gate?.dispatchAllowed !== false) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_STORED_INVALID',
      '已保存工具提议结构无效，已停止继续使用',
      409,
    );
  }
  const { proposalDigest, proposalId, ...body } = proposal;
  if (digest(body) !== proposalDigest) {
    throw new CreatorAgentToolProposalError(
      'CREATOR_TOOL_PROPOSAL_STORED_INVALID',
      '已保存工具提议摘要不匹配，已停止继续使用',
      409,
    );
  }
  return proposal;
}

function assertCreatorToolProposalCurrent(proposalValue, session, options = {}) {
  const proposal = validateStoredCreatorToolProposal(proposalValue);
  const latestResponse = [...(Array.isArray(session?.events) ? session.events : [])]
    .reverse()
    .find((event) => event?.type === 'assistant.response.completed');
  const binding = currentBinding(session, latestResponse);
  for (const key of [
    'sessionId',
    'projectId',
    'canvasId',
    'responseId',
    'responseDigest',
    'planId',
    'planDigest',
    'artifactId',
    'artifactVersionId',
    'artifactDigest',
    'workId',
    'workRevision',
    'workDigest',
    'canvasRevision',
  ]) {
    if (proposal.binding?.[key] !== binding[key]) {
      throw new CreatorAgentToolProposalError(
        'CREATOR_TOOL_PROPOSAL_STALE',
        '工具提议绑定的版本已经过期，请基于当前回复重新提议',
        409,
        { binding: key },
      );
    }
  }
  if (Array.isArray(options.grantedScopes)) {
    const granted = new Set(options.grantedScopes.map((scope) => String(scope || '')));
    const missing = proposal.gate.requiredScopes.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new CreatorAgentToolProposalError(
        'CREATOR_TOOL_PROPOSAL_SCOPE_REQUIRED',
        '当前授权范围不足，不能继续这条工具提议',
        403,
        { missingScopes: missing },
      );
    }
  }
  return proposal;
}

function rejectionReceipt(error, index = 0) {
  return {
    schema: CREATOR_TOOL_PROPOSAL_RECEIPT_SCHEMA,
    status: 'rejected',
    index: Math.max(0, Math.trunc(Number(index) || 0)),
    code: boundedText(error?.code, 120) || 'CREATOR_TOOL_PROPOSAL_INVALID',
    message: boundedText(error?.message, 300) || '工具提议无效，已拒绝保存',
    sideEffects: {
      canvasWrites: 0,
      providerCalls: 0,
      fileWrites: 0,
    },
  };
}

module.exports = {
  CREATOR_MODEL_TOOL_PROPOSAL_SCHEMA,
  CREATOR_TOOL_PROPOSAL_RECEIPT_SCHEMA,
  CREATOR_TOOL_PROPOSAL_SCHEMA,
  CreatorAgentToolProposalError,
  assertCreatorToolProposalCurrent,
  compileCreatorToolProposal,
  rejectionReceipt,
  validateStoredCreatorToolProposal,
};
