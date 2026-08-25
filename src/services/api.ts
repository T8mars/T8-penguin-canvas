/**
 * T8-penguin-canvas 后端 API 封装
 * 所有请求走 Vite proxy → http://127.0.0.1:18766
 */
import type { AdvancedProviderConfig, ApiSettings, CanvasData, CanvasListItem, CloudUploadSummary, CloudUploadTargetConfig } from '../types/canvas';
import type { ThemeTemplate } from '../theme/types';
import type { MediaKind } from '../utils/mediaCollection';
import type { RhToolboxManifest } from '../utils/rhToolbox';
import type {
  AssetAvailabilityRefreshInput,
  AssetAvailabilityRefreshResult,
  AssetIndexResult,
  AssetPipelineStatus,
  AssetRef,
  AssetCollection,
  AssetBatchMutationSet,
  AssetBatchResult,
  AssetBatchTarget,
  AssetCatalogPage,
  AssetDuplicateCandidate,
  AssetDuplicateDecision,
  AssetDuplicateKind,
  AssetDuplicatePage,
  AssetDuplicateRefreshResult,
  AssetExactDuplicateGroup,
  AssetExactDuplicateGroupPage,
  AssetLineagePage,
  AssetLineageRecord,
  AssetPermissionRecord,
  AssetRevision,
  AssetSemanticCapability,
  AssetSemanticCapabilityCounts,
  AssetSemanticDocument,
  AssetSemanticEvidence,
  AssetSemanticGenerationCounts,
  AssetSemanticGenerationState,
  AssetSemanticGenerationSummary,
  AssetSemanticIndexState,
  AssetSemanticInstallState,
  AssetSemanticJobRetryInput,
  AssetSemanticJobState,
  AssetSemanticJobSummary,
  AssetSemanticModelDeleteInput,
  AssetSemanticModelMutationInput,
  AssetSemanticModelStatus,
  AssetSemanticProfileUpdateInput,
  AssetSemanticProjectStatus,
  AssetSemanticRebuildInput,
  AssetSemanticSearchHit,
  AssetSemanticSearchInput,
  AssetSemanticSearchPage,
  AssetSemanticStatus,
  AssetSourceTree,
  CanvasPatch,
  CanvasPatchApplyResult,
  CanvasPatchChange,
  CanvasPatchPreview,
  CanvasPatchRecord,
  CanvasPatchRevertResult,
  CanvasOperation,
  CanvasSyncData,
  CollaborationAuditPage,
  CollaborationExecutionPolicy,
  CollaborationExecutionPolicyInput,
  CollaborationRoomExecutionPolicy,
  CollaborationRoomExecutionPolicyInput,
  CollaborationRoomExecutionPolicySnapshot,
  CollaborationRunIntentQueueMutationInput,
  CollaborationReviewVisibilityPolicy,
  CollaborationReviewVisibilityPolicyInput,
  CollaborationMember,
  CollaborationInvite,
  CollaborationExecutionPolicySnapshot,
  CollaborationPublicExposurePolicy,
  CollaborationPublicSelfCheck,
  CollaborationPublicSelfCheckId,
  CollaborationSession,
  CollaborationSessionRevocationResult,
  CollaborationResourceScopeStatus,
  CollaborationStatus,
  NodeRunSummary,
  RunAttemptSummary,
  RunDetail,
  RunEventRecord,
  RunIntent,
  RunRecoveryOverview,
  RunSummary,
  RunRetentionPolicy,
  RunRetentionResult,
  VersionedCanvasData,
  WorkspaceCapability,
  WorkspaceRole,
} from '../types/project';
import type { SubflowDefinition } from '../utils/subflows';
import {
  parseCanvasAgentToolResult,
  type CanvasAgentToolName,
  type CanvasAgentToolRequest,
  type CanvasAgentToolResult,
} from '../utils/canvasAgent.ts';

const BASE = '/api';

export interface ApiErrorEnvelope {
  code: string;
  messageKey: string | null;
  params: Record<string, string | number | boolean>;
  error: string;
}

const API_MESSAGE_KEY_RE = /^[a-z][a-z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/;

export function parseApiErrorEnvelope(data: unknown, status = 500): ApiErrorEnvelope {
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const rawParams = payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown>
    : {};
  const params: Record<string, string | number | boolean> = {};
  Object.entries(rawParams).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      params[key] = value;
    }
  });
  const messageKey = String(payload.messageKey || '').trim();
  return {
    code: String(payload.code || payload.errorCode || `http_${status}`).trim().slice(0, 120) || `http_${status}`,
    messageKey: API_MESSAGE_KEY_RE.test(messageKey) ? messageKey : null,
    params: { status, ...params },
    error: String(payload.error || payload.message || `HTTP ${status}`),
  };
}

export class ApiRequestError extends Error {
  status: number;
  data: unknown;
  code: string;
  messageKey: string | null;
  params: Record<string, string | number | boolean>;

  constructor(message: string, status: number, data: unknown, envelope = parseApiErrorEnvelope(data, status)) {
    super(message || envelope.error);
    this.name = 'ApiRequestError';
    this.status = status;
    this.data = data;
    this.code = envelope.code;
    this.messageKey = envelope.messageKey;
    this.params = envelope.params;
  }
}

export interface ProjectRunIntentClaimInput {
  intentId: string;
  expectedQueueRevision: number;
  leaseToken: string;
  leaseOwner: string;
}

export interface CollaborationRunIntentDispatchLease {
  intent: RunIntent;
  lease: {
    token: string;
    owner: string;
    expiresAt: number;
  };
}

export interface CollaborationParticipantSession {
  id: string;
  projectId: string;
  canvasId: string;
  memberId: string;
  displayName: string;
  role: WorkspaceRole;
  capabilities: WorkspaceCapability[];
  authorizationEpoch: number;
  expiresAt: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    let responseData: unknown = null;
    try {
      const data = await res.json();
      responseData = data;
      errMsg = parseApiErrorEnvelope(data, res.status).error;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(errMsg, res.status, responseData);
  }
  return res.json();
}

// ========== 状态 ==========
export async function checkBackendStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

// ========== 画布列表 ==========
export interface CanvasListRecoveryState {
  status: 'idle' | 'running' | 'ready' | 'failed';
  reason: 'missing' | 'invalid' | null;
  scanned: number;
  total: number;
  recovered: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface CanvasListPage {
  items: CanvasListItem[];
  total: number | null;
  hasMore: boolean;
  nextCursor: string | null;
  partial: boolean;
  searchUnavailable: boolean;
  recovery: CanvasListRecoveryState;
  activeItem: CanvasListItem | null;
}

export interface ListCanvasPageOptions {
  limit?: number;
  cursor?: string | null;
  activeId?: string | null;
  query?: string | null;
}

export async function listCanvases(): Promise<CanvasListItem[]> {
  const res = await request<{ success: boolean; data: CanvasListItem[] }>(`${BASE}/canvas`);
  return res.data || [];
}

export async function listCanvasPage(options: ListCanvasPageOptions = {}): Promise<CanvasListPage> {
  const query = new URLSearchParams();
  query.set('limit', String(Math.max(1, Math.min(200, Math.trunc(options.limit || 50)))));
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.activeId) query.set('activeId', options.activeId);
  if (options.query?.trim()) query.set('q', options.query.trim());
  const res = await request<{
    success: boolean;
    data: CanvasListItem[];
    meta?: {
      total?: number | null;
      hasMore?: boolean;
      nextCursor?: string | null;
      partial?: boolean;
      searchUnavailable?: boolean;
      recovery?: CanvasListRecoveryState;
      activeItem?: CanvasListItem;
    };
  }>(`${BASE}/canvas?${query.toString()}`);
  return {
    items: Array.isArray(res.data) ? res.data : [],
    total: typeof res.meta?.total === 'number' && Number.isSafeInteger(res.meta.total) ? res.meta.total : null,
    hasMore: Boolean(res.meta?.hasMore),
    nextCursor: typeof res.meta?.nextCursor === 'string' && res.meta.nextCursor ? res.meta.nextCursor : null,
    partial: Boolean(res.meta?.partial),
    searchUnavailable: Boolean(res.meta?.searchUnavailable),
    recovery: res.meta?.recovery || {
      status: 'ready', reason: null, scanned: 0, total: 0, recovered: 0, startedAt: null, completedAt: null,
    },
    activeItem: res.meta?.activeItem || null,
  };
}

export async function getCanvasMetadata(id: string): Promise<CanvasListItem | null> {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  const res = await request<{ success: boolean; data: CanvasListItem }>(`${BASE}/canvas/${encodeURIComponent(targetId)}/metadata`);
  return res.data || null;
}

export async function createCanvas(name?: string): Promise<CanvasListItem> {
  const res = await request<{ success: boolean; data: CanvasListItem }>(`${BASE}/canvas`, {
    method: 'POST',
    body: JSON.stringify({ name: name || '未命名画布' }),
  });
  return res.data;
}

export async function getCanvasData(id: string): Promise<CanvasData> {
  const res = await request<{ success: boolean; data: CanvasData }>(`${BASE}/canvas/${id}`);
  return res.data;
}

export async function saveCanvasData(
  id: string,
  data: CanvasData,
  options?: { allowEmpty?: boolean; baseRevision?: number; actorId?: string; sessionId?: string; clientSeq?: number },
): Promise<{ revision?: number; updatedAt?: number }> {
  const query = options?.allowEmpty ? '?allowEmpty=1' : '';
  const res = await request<{ success: boolean; data?: { revision?: number; updatedAt?: number } }>(`${BASE}/canvas/${id}${query}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...data,
      ...(options?.baseRevision != null ? { baseRevision: options.baseRevision } : {}),
      ...(options?.actorId ? { actorId: options.actorId } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options?.clientSeq != null ? { clientSeq: options.clientSeq } : {}),
    }),
  });
  return res.data || {};
}

export async function executeCanvasAgentTool<K extends CanvasAgentToolName>(
  body: CanvasAgentToolRequest<K>,
  options: { signal?: AbortSignal } = {},
): Promise<CanvasAgentToolResult<K>> {
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) throw new Error('Agent 工具请求超过 64 KiB');
  const res = await request<{ success: boolean; data: unknown }>(`${BASE}/canvas-agent/tools`, {
    method: 'POST',
    body: serialized,
    signal: options.signal,
  });
  if (res.success !== true) throw new Error('Agent 工具响应失败');
  return parseCanvasAgentToolResult(res.data, body);
}

export async function syncCanvasData(id: string, afterRevision = 0, generation: string | null = null): Promise<CanvasSyncData> {
  const generationQuery = generation ? `&generation=${encodeURIComponent(generation)}` : '';
  const res = await request<{ success: boolean; data: CanvasSyncData }>(
    `${BASE}/canvas/${encodeURIComponent(id)}/sync?afterRevision=${Math.max(0, Math.trunc(afterRevision))}${generationQuery}`,
  );
  return res.data;
}

export async function applyCanvasOperations(
  id: string,
  operations: CanvasOperation[],
  baseRevision: number,
): Promise<{ document: CanvasData; acknowledgements: Array<{ opId: string; revision: number; duplicate: boolean }> }> {
  const res = await request<{
    success: boolean;
    data: { document: CanvasData; acknowledgements: Array<{ opId: string; revision: number; duplicate: boolean }> };
  }>(`${BASE}/canvas/${encodeURIComponent(id)}/operations`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, operations }),
  });
  return res.data;
}

type CanvasPatchResponseRecord = Record<string, unknown>;

const CANVAS_PATCH_RESPONSE_OPERATION_LIMIT = 100;
const CANVAS_PATCH_RESPONSE_AFFECTED_ID_LIMIT = 1000;
const CANVAS_PATCH_RESPONSE_FIELD_LIMIT = 500;
const CANVAS_PATCH_RESPONSE_JSON_NODE_LIMIT = 10_000;
const CANVAS_PATCH_RESPONSE_JSON_STRING_LIMIT = 512 * 1024;
const CANVAS_PATCH_RESPONSE_DOCUMENT_ENTITY_LIMIT = 100_000;
const CANVAS_PATCH_RESPONSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CANVAS_PATCH_RESPONSE_DIAGNOSTIC_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CANVAS_PATCH_RESPONSE_DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const CANVAS_PATCH_RESPONSE_CHANGE_TYPES = new Set([
  'node.add',
  'node.patch',
  'node.move',
  'node.delete',
  'node.restore',
  'edge.add',
  'edge.delete',
  'edge.restore',
  'viewport.set',
]);
const CANVAS_PATCH_RESPONSE_TARGET_TYPES = new Set(['node', 'edge', 'canvas']);
const CANVAS_PATCH_PREVIEW_KEYS = new Set([
  'patchId', 'baseRevision', 'currentRevision', 'previewDigest', 'summary',
  'diagnosticsResolved', 'affectedNodeIds', 'affectedEdgeIds', 'changes', 'warnings',
]);
const CANVAS_PATCH_CHANGE_KEYS = new Set([
  'operationIndex', 'type', 'targetType', 'targetId', 'fields', 'before', 'after',
  'relatedNodeIds', 'relatedEdgeIds',
]);
const CANVAS_PATCH_APPLY_KEYS = new Set([
  'patchId', 'status', 'duplicate', 'baseRevision', 'revision', 'document', 'acknowledgements',
]);
const CANVAS_PATCH_REVERT_KEYS = new Set([
  'patchId', 'status', 'duplicate', 'revision', 'document',
]);
const CANVAS_PATCH_ACKNOWLEDGEMENT_KEYS = new Set(['opId', 'revision', 'duplicate']);
const CANVAS_PATCH_RECORD_KEYS = new Set([
  'patchId', 'summary', 'diagnosticsResolved', 'baseRevision', 'appliedRevision',
  'revertedRevision', 'actorId', 'status', 'operationCount', 'createdAt',
  'revertedAt', 'canRevert',
]);

function invalidCanvasPatchResponse(kind: '预览' | '应用' | '记录' | '撤回'): never {
  throw new ApiRequestError(`CanvasPatch ${kind}响应无效`, 502, null);
}

function invalidCanvasPatchRequest(kind: '应用' | '撤回'): never {
  throw new ApiRequestError(`CanvasPatch ${kind}请求无效`, 400, null);
}

function canvasPatchResponseRecord(
  value: unknown,
  kind: '预览' | '应用' | '记录' | '撤回',
): CanvasPatchResponseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidCanvasPatchResponse(kind);
  return value as CanvasPatchResponseRecord;
}

function canvasPatchResponseHasOwn(value: CanvasPatchResponseRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertCanvasPatchResponseKeys(
  value: CanvasPatchResponseRecord,
  allowed: ReadonlySet<string>,
  kind: '预览' | '应用' | '记录' | '撤回',
) {
  if (Object.keys(value).some((key) => !allowed.has(key))) invalidCanvasPatchResponse(kind);
}

function canvasPatchResponseString(
  value: unknown,
  maximumLength: number,
  kind: '预览' | '应用' | '记录' | '撤回',
  options: { allowEmpty?: boolean; pattern?: RegExp } = {},
) {
  if (typeof value !== 'string'
    || (!options.allowEmpty && value.length === 0)
    || value.length > maximumLength
    || value.trim() !== value
    || value.normalize('NFKC') !== value
    || /[\u0000-\u001f\u007f]/.test(value)
    || (options.pattern && !options.pattern.test(value))) {
    invalidCanvasPatchResponse(kind);
  }
  return value;
}

function canvasPatchResponsePositiveInteger(
  value: unknown,
  kind: '预览' | '应用' | '记录' | '撤回',
) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalidCanvasPatchResponse(kind);
  return Number(value);
}

function canvasPatchResponseNonNegativeInteger(
  value: unknown,
  kind: '预览' | '应用' | '记录' | '撤回',
) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidCanvasPatchResponse(kind);
  return Number(value);
}

function canvasPatchResponseStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
  kind: '预览' | '应用' | '记录' | '撤回',
  options: { pattern?: RegExp; unique?: boolean } = {},
) {
  if (!Array.isArray(value) || value.length > maximumItems) invalidCanvasPatchResponse(kind);
  const parsed = value.map((item) => canvasPatchResponseString(item, maximumItemLength, kind, {
    pattern: options.pattern,
  }));
  if (options.unique && new Set(parsed).size !== parsed.length) invalidCanvasPatchResponse(kind);
  return parsed;
}

interface CanvasPatchResponseJsonBudget {
  nodes: number;
  stringCharacters: number;
}

function assertBoundedCanvasPatchResponseJson(
  value: unknown,
  budget: CanvasPatchResponseJsonBudget,
  depth = 0,
) {
  budget.nodes += 1;
  if (budget.nodes > CANVAS_PATCH_RESPONSE_JSON_NODE_LIMIT || depth > 16) invalidCanvasPatchResponse('预览');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidCanvasPatchResponse('预览');
    return;
  }
  if (typeof value === 'string') {
    budget.stringCharacters += value.length;
    if (value.length > 64 * 1024 || budget.stringCharacters > CANVAS_PATCH_RESPONSE_JSON_STRING_LIMIT) {
      invalidCanvasPatchResponse('预览');
    }
    return;
  }
  if (!value || typeof value !== 'object') invalidCanvasPatchResponse('预览');
  if (Array.isArray(value)) {
    if (value.length > 1000) invalidCanvasPatchResponse('预览');
    value.forEach((item) => assertBoundedCanvasPatchResponseJson(item, budget, depth + 1));
    return;
  }
  const record = value as CanvasPatchResponseRecord;
  const keys = Object.keys(record);
  if (keys.length > CANVAS_PATCH_RESPONSE_FIELD_LIMIT
    || keys.some((key) => key === '__proto__' || key === 'prototype' || key === 'constructor')) {
    invalidCanvasPatchResponse('预览');
  }
  keys.forEach((key) => assertBoundedCanvasPatchResponseJson(record[key], budget, depth + 1));
}

function parseCanvasPatchChange(
  value: unknown,
  expectedOperations: readonly CanvasOperation[],
  budget: CanvasPatchResponseJsonBudget,
): CanvasPatchChange {
  const record = canvasPatchResponseRecord(value, '预览');
  assertCanvasPatchResponseKeys(record, CANVAS_PATCH_CHANGE_KEYS, '预览');
  for (const key of ['operationIndex', 'type', 'targetType', 'targetId', 'fields', 'before', 'after']) {
    if (!canvasPatchResponseHasOwn(record, key)) invalidCanvasPatchResponse('预览');
  }
  const operationIndex = canvasPatchResponseNonNegativeInteger(record.operationIndex, '预览');
  if (operationIndex >= expectedOperations.length || operationIndex >= CANVAS_PATCH_RESPONSE_OPERATION_LIMIT) {
    invalidCanvasPatchResponse('预览');
  }
  const type = canvasPatchResponseString(record.type, 40, '预览');
  if (!CANVAS_PATCH_RESPONSE_CHANGE_TYPES.has(type)) invalidCanvasPatchResponse('预览');
  if (type !== expectedOperations[operationIndex]?.type) invalidCanvasPatchResponse('预览');
  const targetType = canvasPatchResponseString(record.targetType, 20, '预览');
  if (!CANVAS_PATCH_RESPONSE_TARGET_TYPES.has(targetType)) invalidCanvasPatchResponse('预览');
  const expectedTargetType = type.startsWith('node.')
    ? 'node'
    : type.startsWith('edge.')
      ? 'edge'
      : 'canvas';
  if (targetType !== expectedTargetType) invalidCanvasPatchResponse('预览');
  const targetId = canvasPatchResponseString(record.targetId, 240, '预览');
  const fields = canvasPatchResponseStringArray(
    record.fields,
    CANVAS_PATCH_RESPONSE_FIELD_LIMIT,
    160,
    '预览',
    { unique: true },
  );
  assertBoundedCanvasPatchResponseJson(record.before, budget);
  assertBoundedCanvasPatchResponseJson(record.after, budget);
  const relatedNodeIds = canvasPatchResponseHasOwn(record, 'relatedNodeIds')
    ? canvasPatchResponseStringArray(record.relatedNodeIds, CANVAS_PATCH_RESPONSE_AFFECTED_ID_LIMIT, 240, '预览', { unique: true })
    : undefined;
  const relatedEdgeIds = canvasPatchResponseHasOwn(record, 'relatedEdgeIds')
    ? canvasPatchResponseStringArray(record.relatedEdgeIds, CANVAS_PATCH_RESPONSE_AFFECTED_ID_LIMIT, 240, '预览', { unique: true })
    : undefined;
  return {
    operationIndex,
    type: type as CanvasPatchChange['type'],
    targetType: targetType as CanvasPatchChange['targetType'],
    targetId,
    fields,
    before: record.before,
    after: record.after,
    ...(relatedNodeIds ? { relatedNodeIds } : {}),
    ...(relatedEdgeIds ? { relatedEdgeIds } : {}),
  };
}

function parseCanvasPatchPreviewResponse(value: unknown, expectedPatch: CanvasPatch): CanvasPatchPreview {
  const record = canvasPatchResponseRecord(value, '预览');
  assertCanvasPatchResponseKeys(record, CANVAS_PATCH_PREVIEW_KEYS, '预览');
  for (const key of [
    'patchId', 'baseRevision', 'currentRevision', 'previewDigest', 'summary',
    'diagnosticsResolved', 'affectedNodeIds', 'affectedEdgeIds', 'changes',
  ]) {
    if (!canvasPatchResponseHasOwn(record, key)) invalidCanvasPatchResponse('预览');
  }
  const patchId = canvasPatchResponseString(record.patchId, 160, '预览', {
    pattern: CANVAS_PATCH_RESPONSE_ID_PATTERN,
  });
  const baseRevision = canvasPatchResponsePositiveInteger(record.baseRevision, '预览');
  const currentRevision = canvasPatchResponsePositiveInteger(record.currentRevision, '预览');
  if (patchId !== expectedPatch.id
    || baseRevision !== expectedPatch.baseRevision
    || currentRevision !== expectedPatch.baseRevision) {
    invalidCanvasPatchResponse('预览');
  }
  const previewDigest = canvasPatchResponseString(record.previewDigest, 64, '预览', {
    pattern: CANVAS_PATCH_RESPONSE_DIGEST_PATTERN,
  }).toLowerCase();
  const summary = canvasPatchResponseString(record.summary, 500, '预览');
  const diagnosticsResolved = canvasPatchResponseStringArray(
    record.diagnosticsResolved,
    CANVAS_PATCH_RESPONSE_OPERATION_LIMIT,
    160,
    '预览',
    { pattern: CANVAS_PATCH_RESPONSE_DIAGNOSTIC_PATTERN, unique: true },
  );
  const affectedNodeIds = canvasPatchResponseStringArray(
    record.affectedNodeIds,
    CANVAS_PATCH_RESPONSE_AFFECTED_ID_LIMIT,
    240,
    '预览',
    { unique: true },
  );
  const affectedEdgeIds = canvasPatchResponseStringArray(
    record.affectedEdgeIds,
    CANVAS_PATCH_RESPONSE_AFFECTED_ID_LIMIT,
    240,
    '预览',
    { unique: true },
  );
  if (!Array.isArray(record.changes)
    || record.changes.length > CANVAS_PATCH_RESPONSE_OPERATION_LIMIT
    || record.changes.length > expectedPatch.operations.length) {
    invalidCanvasPatchResponse('预览');
  }
  const budget = { nodes: 0, stringCharacters: 0 };
  const changes = record.changes.map((change) => parseCanvasPatchChange(change, expectedPatch.operations, budget));
  if (new Set(changes.map((change) => change.operationIndex)).size !== changes.length) invalidCanvasPatchResponse('预览');
  const warnings = canvasPatchResponseHasOwn(record, 'warnings')
    ? canvasPatchResponseStringArray(record.warnings, CANVAS_PATCH_RESPONSE_OPERATION_LIMIT, 500, '预览')
    : undefined;
  return {
    patchId,
    baseRevision,
    currentRevision,
    previewDigest,
    summary,
    diagnosticsResolved,
    affectedNodeIds,
    affectedEdgeIds,
    changes,
    ...(warnings ? { warnings } : {}),
  };
}

function parseCanvasPatchDocument(
  value: unknown,
  expectedCanvasId: string,
  expectedRevision: number,
  kind: '应用' | '撤回',
): VersionedCanvasData {
  const record = canvasPatchResponseRecord(value, kind);
  if (record.schema !== 't8-canvas-document'
    || record.schemaVersion !== 2
    || canvasPatchResponseString(record.canvasId, 240, kind) !== expectedCanvasId
    || canvasPatchResponsePositiveInteger(record.revision, kind) !== expectedRevision) {
    invalidCanvasPatchResponse(kind);
  }
  canvasPatchResponseString(record.projectId, 240, kind);
  canvasPatchResponseString(record.entityUid, 240, kind);
  if (!Array.isArray(record.nodes)
    || record.nodes.length > CANVAS_PATCH_RESPONSE_DOCUMENT_ENTITY_LIMIT
    || record.nodes.some((node) => !node || typeof node !== 'object' || Array.isArray(node))
    || !Array.isArray(record.edges)
    || record.edges.length > CANVAS_PATCH_RESPONSE_DOCUMENT_ENTITY_LIMIT
    || record.edges.some((edge) => !edge || typeof edge !== 'object' || Array.isArray(edge))) {
    invalidCanvasPatchResponse(kind);
  }
  const viewport = canvasPatchResponseRecord(record.viewport, kind);
  if (typeof viewport.x !== 'number' || !Number.isFinite(viewport.x)
    || typeof viewport.y !== 'number' || !Number.isFinite(viewport.y)
    || typeof viewport.zoom !== 'number' || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
    invalidCanvasPatchResponse(kind);
  }
  if (!Array.isArray(record.subflowInstances)
    || record.subflowInstances.length > CANVAS_PATCH_RESPONSE_DOCUMENT_ENTITY_LIMIT
    || record.subflowInstances.some((instance) => !instance || typeof instance !== 'object' || Array.isArray(instance))) {
    invalidCanvasPatchResponse(kind);
  }
  const tombstones = canvasPatchResponseRecord(record.tombstones, kind);
  const nodeTombstones = canvasPatchResponseRecord(tombstones.nodes, kind);
  const edgeTombstones = canvasPatchResponseRecord(tombstones.edges, kind);
  if (Object.keys(nodeTombstones).length > CANVAS_PATCH_RESPONSE_DOCUMENT_ENTITY_LIMIT
    || Object.keys(edgeTombstones).length > CANVAS_PATCH_RESPONSE_DOCUMENT_ENTITY_LIMIT) {
    invalidCanvasPatchResponse(kind);
  }
  canvasPatchResponsePositiveInteger(record.updatedAt, kind);
  if (canvasPatchResponseHasOwn(record, 'nextNodeSerialId')) {
    canvasPatchResponsePositiveInteger(record.nextNodeSerialId, kind);
  }
  return record as unknown as VersionedCanvasData;
}

function parseCanvasPatchApplyResponse(
  value: unknown,
  expectedCanvasId: string,
  expectedPatch: CanvasPatch,
): CanvasPatchApplyResult {
  const record = canvasPatchResponseRecord(value, '应用');
  assertCanvasPatchResponseKeys(record, CANVAS_PATCH_APPLY_KEYS, '应用');
  for (const key of ['patchId', 'status', 'duplicate', 'baseRevision', 'revision', 'document']) {
    if (!canvasPatchResponseHasOwn(record, key)) invalidCanvasPatchResponse('应用');
  }
  const patchId = canvasPatchResponseString(record.patchId, 160, '应用', {
    pattern: CANVAS_PATCH_RESPONSE_ID_PATTERN,
  });
  const baseRevision = canvasPatchResponsePositiveInteger(record.baseRevision, '应用');
  const revision = canvasPatchResponsePositiveInteger(record.revision, '应用');
  if (patchId !== expectedPatch.id
    || record.status !== 'applied'
    || typeof record.duplicate !== 'boolean'
    || baseRevision !== expectedPatch.baseRevision
    || revision < baseRevision) {
    invalidCanvasPatchResponse('应用');
  }
  const document = parseCanvasPatchDocument(record.document, expectedCanvasId, revision, '应用');
  let acknowledgements: CanvasPatchApplyResult['acknowledgements'];
  if (canvasPatchResponseHasOwn(record, 'acknowledgements')) {
    if (!Array.isArray(record.acknowledgements)
      || record.acknowledgements.length > CANVAS_PATCH_RESPONSE_OPERATION_LIMIT) {
      invalidCanvasPatchResponse('应用');
    }
    acknowledgements = record.acknowledgements.map((item) => {
      const acknowledgement = canvasPatchResponseRecord(item, '应用');
      assertCanvasPatchResponseKeys(acknowledgement, CANVAS_PATCH_ACKNOWLEDGEMENT_KEYS, '应用');
      if (!canvasPatchResponseHasOwn(acknowledgement, 'opId')
        || !canvasPatchResponseHasOwn(acknowledgement, 'revision')
        || typeof acknowledgement.duplicate !== 'boolean') {
        invalidCanvasPatchResponse('应用');
      }
      const acknowledgementRevision = canvasPatchResponsePositiveInteger(acknowledgement.revision, '应用');
      if (acknowledgementRevision > revision) invalidCanvasPatchResponse('应用');
      return {
        opId: canvasPatchResponseString(acknowledgement.opId, 240, '应用'),
        revision: acknowledgementRevision,
        duplicate: acknowledgement.duplicate,
      };
    });
  }
  return {
    patchId,
    status: 'applied',
    duplicate: record.duplicate,
    baseRevision,
    revision,
    document,
    ...(acknowledgements ? { acknowledgements } : {}),
  };
}

function parseCanvasPatchRecord(value: unknown): CanvasPatchRecord {
  const record = canvasPatchResponseRecord(value, '记录');
  assertCanvasPatchResponseKeys(record, CANVAS_PATCH_RECORD_KEYS, '记录');
  for (const key of CANVAS_PATCH_RECORD_KEYS) {
    if (!canvasPatchResponseHasOwn(record, key)) invalidCanvasPatchResponse('记录');
  }
  const patchId = canvasPatchResponseString(record.patchId, 160, '记录', {
    pattern: CANVAS_PATCH_RESPONSE_ID_PATTERN,
  });
  const summary = canvasPatchResponseString(record.summary, 500, '记录');
  const diagnosticsResolved = canvasPatchResponseStringArray(
    record.diagnosticsResolved,
    CANVAS_PATCH_RESPONSE_OPERATION_LIMIT,
    160,
    '记录',
    { pattern: CANVAS_PATCH_RESPONSE_DIAGNOSTIC_PATTERN, unique: true },
  );
  const baseRevision = canvasPatchResponsePositiveInteger(record.baseRevision, '记录');
  const appliedRevision = canvasPatchResponsePositiveInteger(record.appliedRevision, '记录');
  const operationCount = canvasPatchResponsePositiveInteger(record.operationCount, '记录');
  if (appliedRevision < baseRevision || operationCount > CANVAS_PATCH_RESPONSE_OPERATION_LIMIT) {
    invalidCanvasPatchResponse('记录');
  }
  const actorId = canvasPatchResponseString(record.actorId, 240, '记录');
  if (record.status !== 'applied' && record.status !== 'reverted') invalidCanvasPatchResponse('记录');
  if (typeof record.canRevert !== 'boolean') invalidCanvasPatchResponse('记录');
  const createdAt = canvasPatchResponsePositiveInteger(record.createdAt, '记录');
  const revertedRevision = record.revertedRevision === null
    ? null
    : canvasPatchResponsePositiveInteger(record.revertedRevision, '记录');
  const revertedAt = record.revertedAt === null
    ? null
    : canvasPatchResponsePositiveInteger(record.revertedAt, '记录');
  if (record.status === 'applied' && (revertedRevision !== null || revertedAt !== null)) {
    invalidCanvasPatchResponse('记录');
  }
  if (record.status === 'reverted'
    && (revertedRevision === null || revertedRevision < appliedRevision || revertedAt === null)) {
    invalidCanvasPatchResponse('记录');
  }
  return {
    patchId,
    summary,
    diagnosticsResolved,
    baseRevision,
    appliedRevision,
    revertedRevision,
    actorId,
    status: record.status,
    operationCount,
    createdAt,
    revertedAt,
    canRevert: record.canRevert,
  };
}

function parseCanvasPatchRevertResponse(
  value: unknown,
  expectedCanvasId: string,
  expectedPatchId: string,
): CanvasPatchRevertResult {
  const record = canvasPatchResponseRecord(value, '撤回');
  assertCanvasPatchResponseKeys(record, CANVAS_PATCH_REVERT_KEYS, '撤回');
  for (const key of ['patchId', 'status', 'revision', 'document']) {
    if (!canvasPatchResponseHasOwn(record, key)) invalidCanvasPatchResponse('撤回');
  }
  const patchId = canvasPatchResponseString(record.patchId, 160, '撤回', {
    pattern: CANVAS_PATCH_RESPONSE_ID_PATTERN,
  });
  const revision = canvasPatchResponsePositiveInteger(record.revision, '撤回');
  if (patchId !== expectedPatchId
    || record.status !== 'reverted'
    || (canvasPatchResponseHasOwn(record, 'duplicate') && typeof record.duplicate !== 'boolean')) {
    invalidCanvasPatchResponse('撤回');
  }
  const document = parseCanvasPatchDocument(record.document, expectedCanvasId, revision, '撤回');
  return {
    patchId,
    status: 'reverted',
    ...(canvasPatchResponseHasOwn(record, 'duplicate') ? { duplicate: record.duplicate as boolean } : {}),
    revision,
    document,
  };
}

export async function previewCanvasPatch(id: string, patch: CanvasPatch): Promise<CanvasPatchPreview> {
  const res = await request<{ success: boolean; data: CanvasPatchPreview }>(
    `${BASE}/canvas/${encodeURIComponent(id)}/patches/preview`,
    {
      method: 'POST',
      body: JSON.stringify({ patch }),
    },
  );
  return parseCanvasPatchPreviewResponse(res.data, patch);
}

export async function applyCanvasPatch(
  id: string,
  patch: CanvasPatch,
  previewDigest: string,
): Promise<CanvasPatchApplyResult> {
  if (typeof previewDigest !== 'string' || !CANVAS_PATCH_RESPONSE_DIGEST_PATTERN.test(previewDigest)) {
    invalidCanvasPatchRequest('应用');
  }
  const res = await request<{ success: boolean; data: CanvasPatchApplyResult }>(
    `${BASE}/canvas/${encodeURIComponent(id)}/patches`,
    {
      method: 'POST',
      body: JSON.stringify({ patch, previewDigest, confirmed: true }),
    },
  );
  return parseCanvasPatchApplyResponse(res.data, id, patch);
}

export async function listCanvasPatches(id: string, limit = 50): Promise<CanvasPatchRecord[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
  const res = await request<{ success: boolean; data: CanvasPatchRecord[] }>(
    `${BASE}/canvas/${encodeURIComponent(id)}/patches?limit=${safeLimit}`,
  );
  if (!Array.isArray(res.data) || res.data.length > safeLimit) invalidCanvasPatchResponse('记录');
  const records = res.data.map((record) => parseCanvasPatchRecord(record));
  if (new Set(records.map((record) => record.patchId)).size !== records.length) invalidCanvasPatchResponse('记录');
  return records;
}

export async function revertCanvasPatch(
  id: string,
  patchId: string,
  baseRevision: number,
): Promise<CanvasPatchRevertResult> {
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) invalidCanvasPatchRequest('撤回');
  const res = await request<{ success: boolean; data: CanvasPatchRevertResult }>(
    `${BASE}/canvas/${encodeURIComponent(id)}/patches/${encodeURIComponent(patchId)}/revert`,
    {
      method: 'POST',
      body: JSON.stringify({ baseRevision }),
    },
  );
  return parseCanvasPatchRevertResponse(res.data, id, patchId);
}

export async function autoSaveCanvasData(
  id: string,
  data: CanvasData,
): Promise<{ path?: string; nodeCount?: number; edgeCount?: number }> {
  const res = await request<{
    success: boolean;
    data: { path?: string; nodeCount?: number; edgeCount?: number };
  }>(`${BASE}/canvas/${id}/auto-save`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.data || {};
}

export async function deleteCanvas(id: string): Promise<void> {
  await request(`${BASE}/canvas/${id}`, { method: 'DELETE' });
}

export async function renameCanvas(id: string, name: string): Promise<CanvasListItem> {
  const res = await request<{ success: boolean; data: CanvasListItem }>(
    `${BASE}/canvas/${id}/name`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }
  );
  return res.data;
}

// ========== 设置(三套通用 Key + 分类 Key) ==========
export async function getSettings(options: { signal?: AbortSignal } = {}): Promise<ApiSettings> {
  const res = await request<{ success: boolean; data: ApiSettings }>(`${BASE}/settings`, {
    signal: options.signal,
  });
  return res.data;
}

// 获取明文 Key（仅用于设置弹窗内眼睛预览，不脱敏）
export async function getRawSettings(): Promise<ApiSettings> {
  const res = await request<{ success: boolean; data: ApiSettings }>(`${BASE}/settings/raw`);
  return res.data;
}

export async function updateSettings(patch: Partial<ApiSettings>): Promise<void> {
  await request(`${BASE}/settings`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

// ========== 运行中心 ==========
export async function listProjectRuns(filters: { projectId?: string; canvasId?: string; status?: string; initiatorId?: string; provider?: string; model?: string; limit?: number } = {}, options: { signal?: AbortSignal } = {}): Promise<RunSummary[]> {
  const query = new URLSearchParams();
  if (filters.projectId) query.set('projectId', filters.projectId);
  if (filters.canvasId) query.set('canvasId', filters.canvasId);
  if (filters.status) query.set('status', filters.status);
  if (filters.initiatorId) query.set('initiatorId', filters.initiatorId);
  if (filters.provider) query.set('provider', filters.provider);
  if (filters.model) query.set('model', filters.model);
  if (filters.limit) query.set('limit', String(filters.limit));
  const suffix = query.size ? `?${query.toString()}` : '';
  const res = await request<{ success: boolean; data: RunSummary[] }>(`${BASE}/project-runs${suffix}`, { signal: options.signal });
  return res.data || [];
}

export async function createProjectRun(input: {
  id?: string;
  canvasId: string;
  canvasRevision?: number;
  initiatorId?: string;
  status?: RunSummary['status'];
  summary?: Record<string, unknown>;
  parentRunId?: string;
  runIntentClaim?: ProjectRunIntentClaimInput;
}): Promise<RunSummary> {
  const res = await request<{ success: boolean; data: RunSummary }>(`${BASE}/project-runs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateProjectRun(runId: string, patch: Partial<Pick<RunSummary, 'status' | 'startedAt' | 'finishedAt' | 'summary'>>): Promise<RunSummary> {
  const res = await request<{ success: boolean; data: RunSummary }>(`${BASE}/project-runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.data;
}

export async function getProjectRun(runId: string): Promise<RunDetail> {
  const res = await request<{ success: boolean; data: RunDetail }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}`,
  );
  return res.data;
}

export async function getProjectRunRetention(projectId?: string): Promise<RunRetentionPolicy> {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await request<{ success: boolean; data: RunRetentionPolicy }>(`${BASE}/project-runs/retention${suffix}`);
  return res.data;
}

export async function getProjectRunRecovery(): Promise<RunRecoveryOverview> {
  const res = await request<{ success: boolean; data: RunRecoveryOverview }>(`${BASE}/project-runs/recovery`);
  return res.data;
}

export async function updateProjectRunRetention(patch: Partial<RunRetentionPolicy> & { projectId?: string }): Promise<RunRetentionPolicy> {
  const res = await request<{ success: boolean; data: RunRetentionPolicy }>(`${BASE}/project-runs/retention`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return res.data;
}

export async function pruneProjectRuns(projectId?: string): Promise<RunRetentionResult> {
  const res = await request<{ success: boolean; data: RunRetentionResult }>(`${BASE}/project-runs/retention/prune`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });
  return res.data;
}

// ========== 智能资产索引 ==========
export async function listProjectAssets(filters: {
  projectId?: string;
  kind?: string;
  query?: string;
  limit?: number;
  offset?: number;
  tag?: string;
  collectionId?: string;
  storageMode?: AssetRef['storageMode'];
  availability?: AssetRef['availability'];
  source?: string;
  sort?: 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc';
} = {}, options: { signal?: AbortSignal } = {}): Promise<AssetCatalogPage> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const suffix = params.size ? `?${params.toString()}` : '';
  const res = await request<{
    success: boolean;
    data: AssetRef[];
    meta?: {
      total?: number;
      offset?: number;
      catalogRevision?: AssetRevision;
      tags?: Array<string | { tag?: string; count?: number }>;
    };
  }>(`${BASE}/project-assets${suffix}`, { signal: options.signal });
  const tags = (res.meta?.tags || []).map((entry) => typeof entry === 'string' ? entry : String(entry?.tag || '')).filter(Boolean);
  return {
    items: res.data || [],
    total: Number(res.meta?.total || 0),
    offset: Number(res.meta?.offset || 0),
    catalogRevision: res.meta?.catalogRevision ?? 0,
    tags,
  };
}

function requireAssetProjectId(projectId: string): string {
  const normalized = String(projectId || '').trim();
  if (!normalized) throw new ApiRequestError('素材请求缺少项目身份。', 400, null);
  return normalized;
}

function normalizeAssetIndexResult(value: unknown, expectedProjectId: string): AssetIndexResult {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const projectId = String(raw.projectId || '');
  const catalogRevision = Number(raw.catalogRevision);
  if (projectId !== expectedProjectId
    || !Number.isSafeInteger(catalogRevision)
    || catalogRevision < 1) {
    throw new ApiRequestError('素材扫描响应的项目身份无效。', 502, null);
  }
  const availabilityRaw = raw.availability && typeof raw.availability === 'object' && !Array.isArray(raw.availability)
    ? raw.availability as Record<string, unknown>
    : null;
  const previewJobsRaw = raw.previewJobs && typeof raw.previewJobs === 'object' && !Array.isArray(raw.previewJobs)
    ? raw.previewJobs as Record<string, unknown>
    : null;
  const count = (input: unknown) => Math.max(0, Math.trunc(Number(input) || 0));
  return {
    projectId,
    catalogRevision,
    total: count(raw.total),
    indexed: count(raw.indexed),
    failed: count(raw.failed),
    ...(availabilityRaw ? { availability: {
      checked: count(availabilityRaw.checked),
      changed: count(availabilityRaw.changed),
      missing: count(availabilityRaw.missing),
      restored: count(availabilityRaw.restored),
      sourceChanged: count(availabilityRaw.sourceChanged),
      indeterminate: count(availabilityRaw.indeterminate),
    } } : {}),
    ...(previewJobsRaw ? { previewJobs: {
      queued: count(previewJobsRaw.queued),
      succeeded: count(previewJobsRaw.succeeded),
      failed: count(previewJobsRaw.failed),
    } } : {}),
    startedAt: Number(raw.startedAt) || 0,
    finishedAt: Number(raw.finishedAt) || 0,
  };
}

export async function scanProjectAssets(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AssetIndexResult> {
  const expectedProjectId = requireAssetProjectId(projectId);
  const res = await request<{ success: boolean; data: unknown }>(`${BASE}/project-assets/scan`, {
    method: 'POST',
    body: JSON.stringify({ projectId: expectedProjectId }),
    signal: options.signal,
  });
  return normalizeAssetIndexResult(res.data, expectedProjectId);
}

export async function getProjectAssetPipelineStatus(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AssetPipelineStatus> {
  const expectedProjectId = requireAssetProjectId(projectId);
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/status?projectId=${encodeURIComponent(expectedProjectId)}`,
    { signal: options.signal },
  );
  const raw = res.data && typeof res.data === 'object' && !Array.isArray(res.data)
    ? res.data as Record<string, unknown>
    : {};
  const scan = raw.scan && typeof raw.scan === 'object' && !Array.isArray(raw.scan)
    ? raw.scan as Record<string, unknown>
    : {};
  const previews = raw.previews && typeof raw.previews === 'object' && !Array.isArray(raw.previews)
    ? raw.previews as Record<string, unknown>
    : {};
  if (String(raw.projectId || '') !== expectedProjectId
    || String(scan.projectId || '') !== expectedProjectId
    || String(previews.projectId || '') !== expectedProjectId
    || previews.concurrencyScope !== 'global') {
    throw new ApiRequestError('素材任务状态响应的项目身份无效。', 502, null);
  }
  const lastResult = scan.lastResult == null
    ? null
    : normalizeAssetIndexResult(scan.lastResult, expectedProjectId);
  const previewCount = (value: unknown) => {
    const numeric = Math.trunc(Number(value));
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
  };
  const previewCounts = previews.counts && typeof previews.counts === 'object' && !Array.isArray(previews.counts)
    ? previews.counts as Record<string, unknown>
    : {};
  const pending = previews.pending && typeof previews.pending === 'object' && !Array.isArray(previews.pending)
    ? previews.pending as Record<string, unknown>
    : {};
  const storagePressureRaw = previews.storagePressure && typeof previews.storagePressure === 'object'
    && !Array.isArray(previews.storagePressure)
    ? previews.storagePressure as Record<string, unknown>
    : null;
  const databaseBusyRaw = previews.databaseBusy && typeof previews.databaseBusy === 'object'
    && !Array.isArray(previews.databaseBusy)
    ? previews.databaseBusy as Record<string, unknown>
    : null;
  if ((storagePressureRaw && storagePressureRaw.scope !== 'global')
    || (databaseBusyRaw && databaseBusyRaw.scope !== 'global')
    || (previews.shuttingDown === true && previews.shuttingDownScope !== 'global')) {
    throw new ApiRequestError('素材任务状态响应的全局工作器范围无效。', 502, null);
  }
  return {
    projectId: expectedProjectId,
    scan: {
      projectId: expectedProjectId,
      running: scan.running === true,
      lastResult,
    },
    previews: {
      projectId: expectedProjectId,
      active: previewCount(previews.active),
      activeModel3d: previewCount(previews.activeModel3d),
      concurrency: Math.max(1, previewCount(previews.concurrency)),
      concurrencyScope: 'global',
      counts: {
        queued: previewCount(previewCounts.queued),
        running: previewCount(previewCounts.running),
        retrying: previewCount(previewCounts.retrying),
        succeeded: previewCount(previewCounts.succeeded),
        failed: previewCount(previewCounts.failed),
      },
      pending: {
        completions: previewCount(pending.completions),
        reschedules: previewCount(pending.reschedules),
        reruns: previewCount(pending.reruns),
      },
      ...(Number(previews.nextAttemptAt) > 0 ? { nextAttemptAt: Number(previews.nextAttemptAt) } : {}),
      ...(previews.databaseStatusStale === true ? { databaseStatusStale: true } : {}),
      ...(previews.shuttingDown === true ? { shuttingDown: true, shuttingDownScope: 'global' as const } : {}),
      ...(previews.globalRecoveryPending === true ? { globalRecoveryPending: true } : {}),
      ...(storagePressureRaw?.active === true ? { storagePressure: {
        active: true,
        reason: String(storagePressureRaw.reason || 'storage-pressure').slice(0, 80),
        retryable: storagePressureRaw.retryable === true,
        ...(Number(storagePressureRaw.nextRetryAt) > 0
          ? { nextRetryAt: Number(storagePressureRaw.nextRetryAt) }
          : {}),
        scope: 'global' as const,
      } } : {}),
      ...(databaseBusyRaw?.active === true ? { databaseBusy: {
        active: true,
        code: String(databaseBusyRaw.code || 'project_database_busy').slice(0, 80),
        ...(Number(databaseBusyRaw.nextRetryAt) > 0
          ? { nextRetryAt: Number(databaseBusyRaw.nextRetryAt) }
          : {}),
        scope: 'global' as const,
      } } : {}),
    },
  };
}

export async function refreshProjectAssetAvailability(
  assetId: string,
  input: AssetAvailabilityRefreshInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetAvailabilityRefreshResult> {
  const expectedAssetId = String(assetId || '').trim();
  const projectId = requireAssetProjectId(input.projectId);
  const expectedCatalogRevision = Number(input.expectedCatalogRevision);
  const entityUid = String(input.entityUid || '').trim().toLowerCase();
  const contentRevision = Number(input.contentRevision);
  const organizationRevision = Number(input.organizationRevision);
  const contentHash = String(input.contentHash || '').trim().toLowerCase();
  if (!expectedAssetId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entityUid)
    || !/^[a-f0-9]{64}$/.test(contentHash)
    || !Number.isSafeInteger(expectedCatalogRevision) || expectedCatalogRevision < 1
    || !Number.isSafeInteger(contentRevision) || contentRevision < 1
    || !Number.isSafeInteger(organizationRevision) || organizationRevision < 1) {
    throw new ApiRequestError('素材可用性校验缺少有效的冻结身份。', 400, null);
  }
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/${encodeURIComponent(expectedAssetId)}/availability/refresh`,
    {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({
        projectId,
        expectedCatalogRevision,
        entityUid,
        contentRevision,
        organizationRevision,
        contentHash,
      }),
    },
  );
  const raw = res.data && typeof res.data === 'object' && !Array.isArray(res.data)
    ? res.data as Record<string, unknown>
    : {};
  const state = String(raw.state || '');
  const availability = String(raw.availability || '');
  const responseOrganizationRevision = Number(raw.organizationRevision);
  const responseCatalogRevision = Number(raw.catalogRevision);
  const changed = raw.changed === true;
  if (String(raw.assetId || '') !== expectedAssetId
    || String(raw.projectId || '') !== projectId
    || !['available', 'missing', 'source-changed', 'indeterminate'].includes(state)
    || !['available', 'missing', 'corrupt', 'unverified'].includes(availability)
    || typeof raw.changed !== 'boolean'
    || !Number.isSafeInteger(responseOrganizationRevision) || responseOrganizationRevision < 1
    || !Number.isSafeInteger(responseCatalogRevision) || responseCatalogRevision < 1
    || responseOrganizationRevision !== organizationRevision + (changed ? 1 : 0)
    || responseCatalogRevision !== expectedCatalogRevision + (changed ? 1 : 0)) {
    throw new ApiRequestError('素材可用性校验响应无效。', 502, null);
  }
  return {
    assetId: expectedAssetId,
    projectId,
    state: state as AssetAvailabilityRefreshResult['state'],
    reason: String(raw.reason || '').slice(0, 80),
    changed,
    availability: availability as AssetRef['availability'],
    organizationRevision: responseOrganizationRevision,
    catalogRevision: responseCatalogRevision,
  };
}

export async function retryProjectAssetPreview(assetId: string): Promise<unknown> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/${encodeURIComponent(assetId)}/preview/retry`,
    { method: 'POST' },
  );
  return res.data;
}

export async function linkProjectAssets(input: {
  paths: string[];
  projectId?: string;
  canvasId?: string;
  sourceNodeId?: string;
  sourceNodeType?: string;
}): Promise<AssetRef[]> {
  const res = await request<{ success: boolean; data: AssetRef[] }>(`${BASE}/project-assets/link`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data || [];
}

export async function getProjectAsset(assetId: string, options: { signal?: AbortSignal } = {}): Promise<AssetRef> {
  const res = await request<{ success: boolean; data: AssetRef }>(`${BASE}/project-assets/${encodeURIComponent(assetId)}`, { signal: options.signal });
  return res.data;
}

export async function listAssetCollections(projectId?: string): Promise<AssetCollection[]> {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await request<{ success: boolean; data: AssetCollection[] }>(`${BASE}/project-assets/collections${suffix}`);
  return res.data || [];
}

export async function createAssetCollection(input: { projectId?: string; name: string; description?: string }): Promise<AssetCollection> {
  const res = await request<{ success: boolean; data: AssetCollection }>(`${BASE}/project-assets/collections`, { method: 'POST', body: JSON.stringify(input) });
  return res.data;
}

export async function updateAssetCollection(
  collectionId: string,
  patch: { projectId?: string; name?: string; description?: string; expectedRevision: AssetRevision },
): Promise<AssetCollection> {
  const res = await request<{ success: boolean; data: AssetCollection }>(
    `${BASE}/project-assets/collections/${encodeURIComponent(collectionId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return res.data;
}

export async function deleteAssetCollection(collectionId: string, expectedRevision: AssetRevision, projectId?: string): Promise<void> {
  await request(`${BASE}/project-assets/collections/${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedRevision, projectId }),
  });
}

export async function setAssetCollectionMembers(
  collectionId: string,
  assetIds: string[],
  expectedRevision: AssetRevision,
): Promise<AssetRef[]> {
  const res = await request<{ success: boolean; data: AssetRef[] }>(`${BASE}/project-assets/collections/${encodeURIComponent(collectionId)}/members`, {
    method: 'PUT',
    body: JSON.stringify({ assetIds, expectedRevision }),
  });
  return res.data || [];
}

export async function addAssetToCollection(collectionId: string, assetId: string, expectedRevision: AssetRevision): Promise<AssetRef> {
  const res = await request<{ success: boolean; data: AssetRef }>(`${BASE}/project-assets/collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(assetId)}`, {
    method: 'POST',
    body: JSON.stringify({ expectedRevision }),
  });
  return res.data;
}

export async function removeAssetFromCollection(collectionId: string, assetId: string, expectedRevision: AssetRevision): Promise<AssetRef> {
  const res = await request<{ success: boolean; data: AssetRef }>(`${BASE}/project-assets/collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedRevision }),
  });
  return res.data;
}

export async function setProjectAssetTags(assetId: string, tags: string[], expectedRevision: AssetRevision): Promise<AssetRef> {
  const res = await request<{ success: boolean; data: AssetRef }>(`${BASE}/project-assets/${encodeURIComponent(assetId)}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tags, expectedRevision }),
  });
  return res.data;
}

type AssetBatchWireResult = {
  idempotent?: boolean;
  selectionMode?: string;
  affectedCount?: number;
  assetIds?: string[];
  organizationRevisions?: Record<string, AssetRevision>;
  catalogRevision?: AssetRevision;
};

function assetBatchWireSelection(target: AssetBatchTarget) {
  if (target.mode === 'ids') {
    return { selection: { assetIds: target.assetIds }, expectedRevisions: target.expectedRevisions };
  }
  return {
    selection: {
      query: { ...target.query },
      catalogRevision: target.catalogRevision,
      exclusions: target.exclusions,
    },
  };
}

function rolePermissions(role: 'owner' | 'editor' | 'viewer'): string[] {
  if (role === 'owner') return ['view', 'preview', 'original', 'organize', 'manage_acl'];
  if (role === 'editor') return ['view', 'preview', 'original', 'organize'];
  return ['view', 'preview'];
}

function assetBatchOperations(mutations: AssetBatchMutationSet): Array<Record<string, unknown>> {
  const operations: Array<Record<string, unknown>> = [];
  if (mutations.tags) operations.push({ type: `tags.${mutations.tags.mode}`, tags: mutations.tags.values });
  if (mutations.collections) {
    if (mutations.collections.mode === 'move') {
      const fromCollectionIds = [...new Set(mutations.collections.fromCollectionIds.map((value) => String(value || '').trim()).filter(Boolean))];
      const toCollectionId = String(mutations.collections.toCollectionId || '').trim();
      if (!fromCollectionIds.length || !toCollectionId) throw new Error('移动集合必须同时指定来源集合和目标集合');
      if (fromCollectionIds.includes(toCollectionId)) throw new Error('移动集合的来源和目标不能相同');
      operations.push({
        type: 'collection.move',
        fromCollectionIds,
        toCollectionId,
      });
    } else {
      operations.push({
        type: `collection.${mutations.collections.mode}`,
        collectionIds: mutations.collections.values,
        collectionId: mutations.collections.values[0],
      });
    }
  }
  if (mutations.access) {
    operations.push({
      type: 'access.replace',
      scope: mutations.access.visibility,
      grants: mutations.access.grants.map((grant) => ({
        principalType: grant.principalType,
        principalId: grant.principalId,
        permissions: rolePermissions(grant.role),
      })),
    });
  }
  return operations;
}

export async function applyProjectAssetBatch(input: {
  projectId?: string;
  target: AssetBatchTarget;
  mutations: AssetBatchMutationSet;
  idempotencyKey: string;
}): Promise<AssetBatchResult> {
  const operations = assetBatchOperations(input.mutations);
  if (!operations.length) throw new Error('批量操作不能为空');
  if (operations.length !== 1) throw new Error('每次批量请求只能提交一种操作，以保证筛选选集在单一事务内保持不变');
  const wireTarget = assetBatchWireSelection(input.target);
  const res = await request<{ success: boolean; data: AssetBatchWireResult }>(`${BASE}/project-assets/batch`, {
    method: 'POST',
    body: JSON.stringify({
      projectId: input.projectId,
      ...wireTarget,
      idempotencyKey: input.idempotencyKey,
      operation: operations[0],
    }),
  });
  return {
    idempotent: Boolean(res.data?.idempotent),
    affected: Number(res.data?.affectedCount || 0),
    assetIds: res.data?.assetIds || [],
    organizationRevisions: res.data?.organizationRevisions || {},
    catalogRevision: res.data?.catalogRevision ?? (input.target.mode === 'query' ? input.target.catalogRevision : 0),
  };
}

function normalizeDuplicateCandidate(raw: Record<string, unknown>): AssetDuplicateCandidate {
  const asset = (raw.asset || {}) as AssetRef;
  const evidence = raw.evidence && typeof raw.evidence === 'object' && !Array.isArray(raw.evidence) ? raw.evidence as Record<string, unknown> : {};
  const rawFrames = Array.isArray(raw.evidence)
    ? raw.evidence
    : Array.isArray(evidence.frameMatches)
    ? evidence.frameMatches
    : Array.isArray(evidence.matches)
      ? evidence.matches
      : evidence.sourceFrameIndex != null || evidence.targetFrameIndex != null ? [evidence] : [];
  const frameMatches = rawFrames.slice(0, 12).map((entry, index) => {
    const frame = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    return {
      sourceIndex: Number(frame.sourceIndex ?? frame.sourceFrameIndex ?? frame.leftIndex ?? index),
      targetIndex: Number(frame.targetIndex ?? frame.targetFrameIndex ?? frame.rightIndex ?? index),
      sourceTime: frame.sourceTime != null
        ? Number(frame.sourceTime)
        : frame.sourceTimestampMs == null ? undefined : Number(frame.sourceTimestampMs) / 1000,
      targetTime: frame.targetTime != null
        ? Number(frame.targetTime)
        : frame.targetTimestampMs == null ? undefined : Number(frame.targetTimestampMs) / 1000,
      distance: Number(frame.distance ?? raw.distance ?? 0),
      algorithm: String(frame.algorithm || raw.algorithm || ''),
    };
  });
  const kind: AssetDuplicateKind = raw.type === 'exact' || raw.match === 'exact' ? 'exact' : 'near';
  return {
    id: String(raw.id || `${kind}:${asset.id}`),
    asset,
    kind,
    algorithm: String(raw.algorithm || evidence.algorithm || (kind === 'exact' ? 'sha256' : 'unknown')),
    distance: Number(raw.distance || 0),
    frameMatches,
    decision: raw.decision === 'confirmed' || raw.decision === 'dismissed' ? raw.decision : 'pending',
    revision: (raw.decisionRevision ?? raw.revision) as AssetRevision | undefined,
    updatedAt: raw.updatedAt == null ? undefined : Number(raw.updatedAt),
    confidence: raw.confidence === 'low' || raw.confidence === 'medium' || raw.confidence === 'high' ? raw.confidence : undefined,
    evidenceCount: raw.evidenceCount == null ? undefined : Number(raw.evidenceCount),
    coverage: raw.coverage == null ? undefined : Number(raw.coverage),
    aggregateDistance: raw.aggregateDistance == null ? undefined : Number(raw.aggregateDistance),
  };
}

export async function listProjectAssetDuplicates(
  assetId: string,
  options: { mode?: 'all' | AssetDuplicateKind; maxDistance?: number; limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<AssetDuplicatePage> {
  const params = new URLSearchParams({
    mode: options.mode || 'all',
    maxDistance: String(Math.max(0, Math.min(8, Math.trunc(options.maxDistance ?? 8)))),
    limit: String(Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)))),
  });
  if (options.cursor) params.set('cursor', options.cursor);
  const res = await request<{
    success: boolean;
    data: Array<Record<string, unknown>>;
    meta?: { nextCursor?: string | null; hasMore?: boolean; catalogRevision?: AssetRevision };
  }>(`${BASE}/project-assets/${encodeURIComponent(assetId)}/duplicates?${params}`, { signal: options.signal });
  const catalogRevision = Number(res.meta?.catalogRevision);
  if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 1) {
    throw new ApiRequestError('重复候选响应缺少有效的素材目录 revision。', 409, {
      code: 'asset_duplicate_catalog_revision_missing',
    });
  }
  return {
    items: (res.data || []).map(normalizeDuplicateCandidate),
    cursor: res.meta?.nextCursor || null,
    hasMore: Boolean(res.meta?.hasMore),
    limit: Number(params.get('limit')),
    catalogRevision,
  };
}

export async function refreshProjectAssetDuplicates(
  assetId: string,
  options: { expectedCatalogRevision: AssetRevision; signal?: AbortSignal },
): Promise<AssetDuplicateRefreshResult> {
  const res = await request<{
    success: boolean;
    data: AssetDuplicateRefreshResult;
  }>(`${BASE}/project-assets/${encodeURIComponent(assetId)}/duplicates/refresh`, {
    method: 'POST',
    body: JSON.stringify({ expectedCatalogRevision: options.expectedCatalogRevision }),
    signal: options.signal,
  });
  return {
    refreshed: Boolean(res.data?.refreshed),
    assetId: String(res.data?.assetId || assetId),
    projectId: String(res.data?.projectId || ''),
    catalogRevision: res.data?.catalogRevision ?? options.expectedCatalogRevision,
    candidateCount: res.data?.candidateCount == null ? undefined : Number(res.data.candidateCount),
  };
}

export async function decideProjectAssetDuplicate(
  candidateId: string,
  decision: AssetDuplicateDecision,
  options: {
    expectedRevision: AssetRevision;
    expectedCatalogRevision: AssetRevision;
    projectId?: string;
  },
): Promise<Pick<AssetDuplicateCandidate, 'id' | 'decision' | 'revision' | 'updatedAt'>> {
  const res = await request<{ success: boolean; data: Record<string, unknown> }>(
    `${BASE}/project-assets/duplicate-candidates/${encodeURIComponent(candidateId)}/decision`,
    {
      method: 'PUT',
      body: JSON.stringify({ decision, ...options }),
    },
  );
  const data = res.data || {};
  return {
    id: String(data.id || candidateId),
    decision: data.decision === 'confirmed' || data.decision === 'dismissed' ? data.decision : 'pending',
    revision: (data.decisionRevision ?? data.revision) as AssetRevision | undefined,
    updatedAt: data.updatedAt == null ? undefined : Number(data.updatedAt),
  };
}

function normalizeExactDuplicateGroup(raw: Record<string, unknown>): AssetExactDuplicateGroup {
  return {
    id: String(raw.id || ''),
    kind: 'exact',
    contentHash: String(raw.contentHash || ''),
    memberCount: Math.max(0, Number(raw.memberCount || 0)),
    members: Array.isArray(raw.members) ? raw.members.slice(0, 20) as AssetRef[] : [],
    membersTruncated: Boolean(raw.membersTruncated),
  };
}

export async function listProjectAssetDuplicateGroups(options: {
  projectId?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
} = {}): Promise<AssetExactDuplicateGroupPage> {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, Math.trunc(options.limit ?? 25)))) });
  if (options.projectId) params.set('projectId', options.projectId);
  if (options.cursor) params.set('cursor', options.cursor);
  const res = await request<{
    success: boolean;
    data: Array<Record<string, unknown>>;
    meta?: { nextCursor?: string | null; hasMore?: boolean };
  }>(`${BASE}/project-assets/duplicate-groups?${params}`, { signal: options.signal });
  return {
    items: (res.data || []).map(normalizeExactDuplicateGroup),
    cursor: res.meta?.nextCursor || null,
    hasMore: Boolean(res.meta?.hasMore),
  };
}

export async function listProjectAssetDuplicateGroupMembers(
  groupId: string,
  options: { projectId?: string; limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<{ items: AssetRef[]; cursor: string | null; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, Math.trunc(options.limit ?? 100)))) });
  if (options.projectId) params.set('projectId', options.projectId);
  if (options.cursor) params.set('cursor', options.cursor);
  const res = await request<{
    success: boolean;
    data: AssetRef[] | { members?: AssetRef[] };
    meta?: { nextCursor?: string | null; hasMore?: boolean };
  }>(`${BASE}/project-assets/duplicate-groups/${encodeURIComponent(groupId)}?${params}`, { signal: options.signal });
  return {
    items: Array.isArray(res.data) ? res.data : res.data?.members || [],
    cursor: res.meta?.nextCursor || null,
    hasMore: Boolean(res.meta?.hasMore),
  };
}

function reachableAssetIds(start: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    (adjacency.get(current) || []).forEach((next) => {
      if (visited.has(next)) return;
      visited.add(next);
      queue.push(next);
    });
  }
  return visited;
}

export async function getProjectAssetSourceTree(
  assetId: string,
  options: { direction?: 'ancestors' | 'descendants' | 'both'; maxDepth?: number; maxNodes?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<AssetSourceTree> {
  const params = new URLSearchParams({
    direction: options.direction || 'both',
    maxDepth: String(Math.max(1, Math.min(16, Math.trunc(options.maxDepth ?? 8)))),
    maxNodes: String(Math.max(1, Math.min(120, Math.trunc(options.maxNodes ?? 120)))),
  });
  if (options.cursor) params.set('cursor', options.cursor);
  const res = await request<{ success: boolean; data: Record<string, unknown> }>(
    `${BASE}/project-assets/${encodeURIComponent(assetId)}/source-tree?${params}`,
    { signal: options.signal },
  );
  const data = res.data || {};
  const rootAssetId = String(data.rootAssetId || assetId);
  const rawEdges = Array.isArray(data.edges) ? data.edges as Array<Record<string, unknown>> : [];
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  rawEdges.forEach((edge) => {
    const source = String(edge.sourceAssetId || '');
    const target = String(edge.targetAssetId || '');
    if (!source || !target) return;
    forward.set(source, [...(forward.get(source) || []), target]);
    reverse.set(target, [...(reverse.get(target) || []), source]);
  });
  const descendants = reachableAssetIds(rootAssetId, forward);
  const ancestors = reachableAssetIds(rootAssetId, reverse);
  const nodes = (Array.isArray(data.nodes) ? data.nodes as Array<Record<string, unknown>> : []).map((node) => {
    const asset = node.asset && typeof node.asset === 'object' ? node.asset as AssetRef : undefined;
    const tombstone = node.tombstone && typeof node.tombstone === 'object' ? node.tombstone as Record<string, unknown> : undefined;
    const nodeAssetId = String(asset?.id || tombstone?.id || node.id || '');
    const wireDirection = String(node.direction || '');
    return {
      assetId: nodeAssetId,
      direction: nodeAssetId === rootAssetId
        ? 'root' as const
        : wireDirection === 'ancestors' || wireDirection === 'ancestor' ? 'ancestor' as const
        : wireDirection === 'descendants' || wireDirection === 'descendant' ? 'descendant' as const
        : ancestors.has(nodeAssetId) ? 'ancestor' as const : descendants.has(nodeAssetId) ? 'descendant' as const : 'descendant' as const,
      depth: Math.max(0, Math.trunc(Number(node.depth) || 0)),
      asset,
      filename: asset?.filename || (tombstone?.filename ? String(tombstone.filename) : undefined),
      tombstone: Boolean(tombstone),
    };
  });
  const edges = rawEdges.map((edge) => ({
    id: String(edge.id || ''),
    fromAssetId: String(edge.sourceAssetId || ''),
    toAssetId: String(edge.targetAssetId || ''),
    relation: String(edge.derivedOperation || edge.sourceType || 'derived'),
  }));
  return {
    rootAssetId,
    nodes,
    edges,
    cursor: typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null,
    hasMore: Boolean(data.nextCursor),
    truncated: Boolean(data.truncated),
    cycleDetected: Boolean(data.cycleDetected),
    totalNodes: data.totalNodes == null ? undefined : Math.max(0, Number(data.totalNodes) || 0),
    totalEdges: data.totalEdges == null ? undefined : Math.max(0, Number(data.totalEdges) || 0),
  };
}

export async function getProjectAssetPermissions(assetId: string, options: { signal?: AbortSignal } = {}): Promise<AssetPermissionRecord> {
  const res = await request<{ success: boolean; data: AssetPermissionRecord }>(
    `${BASE}/project-assets/${encodeURIComponent(assetId)}/permissions`,
    { signal: options.signal },
  );
  return res.data;
}

export async function setProjectAssetPermissions(
  assetId: string,
  input: Pick<AssetPermissionRecord, 'scope' | 'grants'> & { expectedRevision: AssetRevision },
): Promise<AssetPermissionRecord> {
  const res = await request<{ success: boolean; data: AssetPermissionRecord }>(
    `${BASE}/project-assets/${encodeURIComponent(assetId)}/permissions`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
  return res.data;
}

/**
 * Pure compatibility read. Call refreshProjectAssetDuplicates explicitly with
 * the current catalog revision before requesting the default all/near page.
 */
export async function findProjectAssetDuplicates(assetId: string, maxDistance = 8): Promise<Array<{ asset: AssetRef; match: 'exact' | 'perceptual'; distance: number }>> {
  const page = await listProjectAssetDuplicates(assetId, { maxDistance, limit: 100 });
  return page.items.map((candidate) => ({
    asset: candidate.asset,
    match: candidate.kind === 'exact' ? 'exact' : 'perceptual',
    distance: candidate.distance,
  }));
}

export async function listProjectAssetLineage(assetId: string, options: {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
} = {}): Promise<AssetLineagePage> {
  const query = new URLSearchParams();
  if (options.limit != null) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.size ? `?${query.toString()}` : '';
  const res = await request<{
    success: boolean;
    data: AssetLineageRecord[];
    meta?: {
      total?: number;
      limit?: number;
      nextCursor?: string | null;
      hasMore?: boolean;
      lineageRevision?: string;
    };
  }>(`${BASE}/project-assets/${encodeURIComponent(assetId)}/lineage${suffix}`, { signal: options.signal });
  return {
    items: res.data || [],
    total: Math.max(0, Number(res.meta?.total) || 0),
    limit: Math.max(1, Math.min(100, Number(res.meta?.limit) || Number(options.limit) || 50)),
    cursor: res.meta?.nextCursor || null,
    hasMore: Boolean(res.meta?.hasMore),
    lineageRevision: String(res.meta?.lineageRevision || ''),
  };
}

export async function getProjectAssetLineage(assetId: string, options: { signal?: AbortSignal } = {}): Promise<AssetLineageRecord[]> {
  return (await listProjectAssetLineage(assetId, { limit: 100, signal: options.signal })).items;
}

export async function removeProjectAssetIndex(assetId: string): Promise<void> {
  await request(`${BASE}/project-assets/${encodeURIComponent(assetId)}/index`, { method: 'DELETE' });
}

export type ProjectAssetDeleteCleanupPhase = 'cas-file-delete' | 'cas-record-finalize' | 'legacy-file-delete';

export interface ProjectAssetDeletePersistenceWarning {
  code: 'asset_delete_cleanup_pending';
  committed: true;
  phase: ProjectAssetDeleteCleanupPhase;
  reconciliationPending: true;
  retryable: false;
}

export interface ProjectAssetDeleteResult {
  id: string;
  indexRemoved: true;
  fileDeleted: boolean;
  blobRetained?: boolean;
  persistenceWarning?: ProjectAssetDeletePersistenceWarning;
}

export interface ProjectAssetDeleteExpectedIdentity {
  entityUid: string;
  contentRevision: number;
  contentHash: string;
}

const PROJECT_ASSET_DELETE_CLEANUP_PHASES = new Set<ProjectAssetDeleteCleanupPhase>([
  'cas-file-delete',
  'cas-record-finalize',
  'legacy-file-delete',
]);

function normalizeProjectAssetDeleteWarning(value: unknown): ProjectAssetDeletePersistenceWarning | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const warning = value as Record<string, unknown>;
  const phase = typeof warning.phase === 'string' && PROJECT_ASSET_DELETE_CLEANUP_PHASES.has(warning.phase as ProjectAssetDeleteCleanupPhase)
    ? warning.phase as ProjectAssetDeleteCleanupPhase
    : null;
  if (warning.code !== 'asset_delete_cleanup_pending'
    || warning.committed !== true
    || !phase
    || warning.reconciliationPending !== true
    || warning.retryable !== false) return undefined;
  return {
    code: 'asset_delete_cleanup_pending',
    committed: true,
    phase,
    reconciliationPending: true,
    retryable: false,
  };
}

function normalizeProjectAssetDeleteResult(value: unknown, assetId: string): ProjectAssetDeleteResult {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const hasWarning = Object.hasOwn(data, 'persistenceWarning');
  const persistenceWarning = normalizeProjectAssetDeleteWarning(data.persistenceWarning);
  if (data.indexRemoved !== true
    || typeof data.fileDeleted !== 'boolean'
    || (Object.hasOwn(data, 'blobRetained') && typeof data.blobRetained !== 'boolean')
    || (hasWarning && !persistenceWarning)
    || (data.fileDeleted !== true && data.blobRetained !== true && !persistenceWarning)
    || (data.fileDeleted === true && data.blobRetained === true && !persistenceWarning)) {
    throw new Error('素材删除响应无效，请刷新素材库确认当前状态');
  }
  const result: ProjectAssetDeleteResult = {
    id: assetId,
    indexRemoved: true,
    fileDeleted: data.fileDeleted === true,
  };
  if (typeof data.blobRetained === 'boolean') result.blobRetained = data.blobRetained;
  if (persistenceWarning) result.persistenceWarning = persistenceWarning;
  return result;
}

export async function deleteProjectAssetFile(
  assetId: string,
  confirmFilename: string,
  expectedIdentity: ProjectAssetDeleteExpectedIdentity,
): Promise<ProjectAssetDeleteResult> {
  const entityUid = String(expectedIdentity?.entityUid || '').trim().toLowerCase();
  const contentRevision = Number(expectedIdentity?.contentRevision);
  const contentHash = String(expectedIdentity?.contentHash || '').trim().toLowerCase();
  if (!entityUid || !Number.isSafeInteger(contentRevision) || contentRevision < 1 || !/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error('素材缺少可验证的删除身份，请刷新后重试');
  }
  const response = await request<unknown>(`${BASE}/project-assets/${encodeURIComponent(assetId)}/file`, {
    method: 'DELETE',
    body: JSON.stringify({
      deleteFile: true,
      confirmFilename,
      expectedEntityUid: entityUid,
      expectedContentRevision: contentRevision,
      expectedContentHash: contentHash,
    }),
  });
  const envelope = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : {};
  return normalizeProjectAssetDeleteResult(envelope.data, assetId);
}

// ========== 智能素材：Caption / OCR / Embedding ==========
type SemanticWireRecord = Record<string, unknown>;

function semanticWireRecord(value: unknown): SemanticWireRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SemanticWireRecord : {};
}

function semanticWireNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function semanticWireOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return value != null && Number.isFinite(parsed) ? parsed : undefined;
}

function semanticWireNullableNumber(value: unknown): number | null {
  return value == null ? null : semanticWireNumber(value);
}

function semanticWireRevision(value: unknown, fallback: AssetRevision = 0): AssetRevision {
  return typeof value === 'string' || typeof value === 'number' ? value : fallback;
}

function semanticWireError(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const record = semanticWireRecord(value);
  return typeof record.message === 'string' ? record.message : null;
}

function semanticCapability(value: unknown): AssetSemanticCapability | null {
  return value === 'caption' || value === 'ocr' || value === 'embedding' ? value : null;
}

function semanticInstallState(value: unknown, installed = false): AssetSemanticInstallState {
  const normalized = String(value || '').toLowerCase().replace(/_/g, '-');
  if (normalized === 'failed' || normalized === 'error') return 'error';
  if (normalized === 'absent' || normalized === 'missing' || normalized === 'not-installed') return 'not-installed';
  if (normalized === 'downloading' || normalized === 'verifying' || normalized === 'installed'
    || normalized === 'disabled' || normalized === 'deleting') return normalized;
  return installed ? 'installed' : 'not-installed';
}

function normalizeSemanticModelStatus(value: unknown): AssetSemanticModelStatus | null {
  const raw = semanticWireRecord(value);
  const key = String(raw.key || raw.modelKey || raw.modelId || '');
  const capability = semanticCapability(raw.capability || raw.task);
  if (!key || !capability) return null;
  const installed = typeof raw.installed === 'boolean' ? raw.installed : String(raw.installState || raw.status || raw.state) === 'installed';
  const installState = semanticInstallState(raw.installState || raw.status || raw.state, installed);
  return {
    key,
    capability,
    label: String(raw.label || raw.displayName || key),
    version: String(raw.version || raw.modelVersion || ''),
    revision: Math.max(0, Math.trunc(semanticWireNumber(raw.revision))),
    installState,
    installed: installed || installState === 'installed',
    downloadedBytes: Math.max(0, semanticWireNumber(raw.downloadedBytes)),
    totalBytes: raw.totalBytes == null && raw.downloadBytes == null
      ? null
      : Math.max(0, semanticWireNumber(raw.totalBytes ?? raw.downloadBytes)),
    error: semanticWireError(raw.error),
  };
}

function semanticCapabilityCounts(value: unknown): AssetSemanticCapabilityCounts {
  const raw = semanticWireRecord(value);
  return {
    eligible: Math.max(0, Math.trunc(semanticWireNumber(raw.eligible))),
    queued: Math.max(0, Math.trunc(semanticWireNumber(raw.queued))),
    running: Math.max(0, Math.trunc(semanticWireNumber(raw.running))),
    succeeded: Math.max(0, Math.trunc(semanticWireNumber(raw.succeeded))),
    skipped: Math.max(0, Math.trunc(semanticWireNumber(raw.skipped))),
    failed: Math.max(0, Math.trunc(semanticWireNumber(raw.failed))),
  };
}

function semanticIndexState(value: unknown): AssetSemanticIndexState {
  return value === 'disabled' || value === 'empty' || value === 'queued' || value === 'building'
    || value === 'ready' || value === 'stale' || value === 'degraded' || value === 'error'
    ? value
    : 'empty';
}

function normalizeSemanticProjectStatus(value: unknown, models: AssetSemanticModelStatus[]): AssetSemanticProjectStatus {
  const raw = semanticWireRecord(value);
  const rawCapabilities = semanticWireRecord(raw.capabilities);
  const normalizeCapability = (capability: AssetSemanticCapability) => {
    const configured = semanticWireRecord(rawCapabilities[capability]);
    const nestedModel = normalizeSemanticModelStatus(configured.model);
    const modelKey = String(configured.modelKey || nestedModel?.key || '');
    const model = nestedModel || models.find((entry) => entry.key === modelKey) || null;
    return {
      capability,
      enabled: Boolean(configured.enabled),
      modelKey,
      modelVersion: String(configured.modelVersion || model?.version || ''),
      model,
      ...semanticCapabilityCounts(configured),
    };
  };
  return {
    projectId: String(raw.projectId || ''),
    revision: semanticWireRevision(raw.revision),
    enabled: Boolean(raw.enabled),
    activeGeneration: Math.max(0, Math.trunc(semanticWireNumber(raw.activeGeneration))),
    activeIndexRevision: semanticWireRevision(raw.activeIndexRevision, ''),
    activeCatalogRevision: semanticWireRevision(raw.activeCatalogRevision),
    currentCatalogRevision: semanticWireRevision(raw.currentCatalogRevision),
    buildingGeneration: semanticWireNullableNumber(raw.buildingGeneration),
    indexState: semanticIndexState(raw.indexState),
    indexStale: Boolean(raw.indexStale),
    capabilities: {
      caption: normalizeCapability('caption'),
      ocr: normalizeCapability('ocr'),
      embedding: normalizeCapability('embedding'),
    },
    updatedAt: raw.updatedAt == null ? null : semanticWireNumber(raw.updatedAt),
  };
}

function semanticGenerationState(value: unknown): AssetSemanticGenerationState {
  return value === 'ready' || value === 'active' || value === 'failed' || value === 'superseded' ? value : 'building';
}

function semanticGenerationCounts(value: unknown): AssetSemanticGenerationCounts {
  const raw = semanticWireRecord(value);
  return {
    queued: Math.max(0, Math.trunc(semanticWireNumber(raw.queued))),
    running: Math.max(0, Math.trunc(semanticWireNumber(raw.running))),
    retrying: Math.max(0, Math.trunc(semanticWireNumber(raw.retrying))),
    succeeded: Math.max(0, Math.trunc(semanticWireNumber(raw.succeeded))),
    skipped: Math.max(0, Math.trunc(semanticWireNumber(raw.skipped))),
    failed: Math.max(0, Math.trunc(semanticWireNumber(raw.failed))),
    superseded: Math.max(0, Math.trunc(semanticWireNumber(raw.superseded))),
    total: Math.max(0, Math.trunc(semanticWireNumber(raw.total))),
  };
}

function normalizeSemanticGeneration(value: unknown, fallbackProjectId = ''): AssetSemanticGenerationSummary {
  const raw = semanticWireRecord(value);
  return {
    projectId: String(raw.projectId || fallbackProjectId),
    generation: Math.max(0, Math.trunc(semanticWireNumber(raw.generation))),
    revision: Math.max(0, Math.trunc(semanticWireNumber(raw.revision))),
    profileRevision: Math.max(0, Math.trunc(semanticWireNumber(raw.profileRevision))),
    catalogRevision: Math.max(0, Math.trunc(semanticWireNumber(raw.catalogRevision))),
    jobsSealed: Boolean(raw.jobsSealed),
    expectedJobCount: Math.max(0, Math.trunc(semanticWireNumber(raw.expectedJobCount))),
    eligibleAssetCount: Math.max(0, Math.trunc(semanticWireNumber(raw.eligibleAssetCount))),
    excludedAssetCount: Math.max(0, Math.trunc(semanticWireNumber(raw.excludedAssetCount))),
    payloadPrunedAt: raw.payloadPrunedAt == null ? null : semanticWireNumber(raw.payloadPrunedAt),
    status: semanticGenerationState(raw.status),
    counts: semanticGenerationCounts(raw.counts),
    error: semanticWireError(raw.error) || (typeof raw.errorMessage === 'string' ? raw.errorMessage : null),
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : null,
    createdAt: raw.createdAt == null ? null : semanticWireNumber(raw.createdAt),
    updatedAt: raw.updatedAt == null ? null : semanticWireNumber(raw.updatedAt),
    finishedAt: raw.finishedAt == null ? null : semanticWireNumber(raw.finishedAt),
  };
}

function normalizeSemanticStatus(value: unknown): AssetSemanticStatus {
  const raw = semanticWireRecord(value);
  const models = (Array.isArray(raw.models) ? raw.models : [])
    .map(normalizeSemanticModelStatus)
    .filter((entry): entry is AssetSemanticModelStatus => Boolean(entry));
  const project = normalizeSemanticProjectStatus(raw.project, models);
  return {
    project,
    models,
    rebuild: raw.rebuild == null ? null : normalizeSemanticGeneration(raw.rebuild, project.projectId),
  };
}

function semanticCapabilityPatch(value: unknown): SemanticWireRecord | undefined {
  const raw = semanticWireRecord(value);
  if (!Object.keys(raw).length) return undefined;
  return {
    ...(Object.hasOwn(raw, 'enabled') ? { enabled: Boolean(raw.enabled) } : {}),
    ...(Object.hasOwn(raw, 'modelKey') ? { modelKey: String(raw.modelKey || '') } : {}),
    ...(Object.hasOwn(raw, 'modelVersion') ? { modelVersion: String(raw.modelVersion || '') } : {}),
  };
}

function requireSemanticModelStatus(value: unknown): AssetSemanticModelStatus {
  const model = normalizeSemanticModelStatus(value);
  if (!model) throw new ApiRequestError('语义模型响应缺少公开身份字段', 502, value);
  return model;
}

export async function getProjectAssetSemanticStatus(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticStatus> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/semantic/status?projectId=${encodeURIComponent(projectId)}`,
    { signal: options.signal },
  );
  return normalizeSemanticStatus(res.data);
}

export async function refreshProjectAssetSemanticModels(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticStatus> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/semantic/models/refresh`,
    {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({ projectId }),
    },
  );
  return normalizeSemanticStatus(res.data);
}

export async function updateProjectAssetSemanticProfile(
  input: AssetSemanticProfileUpdateInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticStatus> {
  const body = {
    projectId: input.projectId,
    expectedRevision: input.expectedRevision,
    ...(Object.hasOwn(input, 'enabled') ? { enabled: Boolean(input.enabled) } : {}),
    ...(input.caption ? { caption: semanticCapabilityPatch(input.caption) } : {}),
    ...(input.ocr ? { ocr: semanticCapabilityPatch(input.ocr) } : {}),
    ...(input.embedding ? { embedding: semanticCapabilityPatch(input.embedding) } : {}),
    updatedBy: input.updatedBy,
  };
  const res = await request<{ success: boolean; data: unknown }>(`${BASE}/project-assets/semantic/profile`, {
    method: 'PUT',
    signal: options.signal,
    body: JSON.stringify(body),
  });
  return normalizeSemanticStatus(res.data);
}

export async function downloadProjectAssetSemanticModel(
  modelKey: string,
  input: AssetSemanticModelMutationInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticModelStatus> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/semantic/models/${encodeURIComponent(modelKey)}/download`,
    {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({ expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey }),
    },
  );
  return requireSemanticModelStatus(res.data);
}

export async function deleteProjectAssetSemanticModel(
  modelKey: string,
  input: AssetSemanticModelDeleteInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticModelStatus> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/semantic/models/${encodeURIComponent(modelKey)}`,
    {
      method: 'DELETE',
      signal: options.signal,
      body: JSON.stringify({ expectedRevision: input.expectedRevision }),
    },
  );
  return requireSemanticModelStatus(res.data);
}

export async function rebuildProjectAssetSemanticIndex(
  input: AssetSemanticRebuildInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticGenerationSummary> {
  const res = await request<{ success: boolean; data: unknown }>(`${BASE}/project-assets/semantic/rebuild`, {
    method: 'POST',
    signal: options.signal,
    body: JSON.stringify({
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    }),
  });
  return normalizeSemanticGeneration(res.data, input.projectId);
}

function normalizeSemanticEvidence(value: unknown): AssetSemanticEvidence | null {
  const raw = semanticWireRecord(value);
  const sourceValue = raw.source || raw.kind;
  const source = sourceValue === 'filename' || sourceValue === 'tag' || sourceValue === 'metadata'
    || sourceValue === 'caption' || sourceValue === 'ocr' || sourceValue === 'text'
    ? sourceValue
    : null;
  const snippet = String(raw.snippet ?? raw.text ?? '').trim();
  if (!source || !snippet) return null;
  const bboxValues = Array.isArray(raw.bbox) ? raw.bbox.map(Number) : [];
  const bbox = bboxValues.length === 4 && bboxValues.every(Number.isFinite)
    ? bboxValues as [number, number, number, number]
    : undefined;
  return {
    source,
    snippet,
    language: typeof raw.language === 'string' ? raw.language : null,
    modelKey: typeof raw.modelKey === 'string' ? raw.modelKey : undefined,
    modelVersion: typeof raw.modelVersion === 'string' ? raw.modelVersion : undefined,
    frameIndex: semanticWireOptionalNumber(raw.frameIndex),
    time: semanticWireOptionalNumber(raw.time),
    page: semanticWireOptionalNumber(raw.page),
    bbox,
  };
}

function semanticHitMetric(value: unknown, raw: SemanticWireRecord): AssetSemanticSearchHit['metric'] {
  if (value === 'cosine' || value === 'rrf' || value === 'bm25' || value === 'keyword') return value;
  if (raw.mode === 'hybrid') return 'rrf';
  if (raw.mode === 'vector' || semanticWireNumber(raw.vectorScore) !== 0) return 'cosine';
  return raw.mode === 'keyword' ? 'keyword' : 'bm25';
}

function normalizeSemanticSearchHit(value: unknown, index: number, offset: number): AssetSemanticSearchHit | null {
  const raw = semanticWireRecord(value);
  const asset = semanticWireRecord(raw.asset) as unknown as AssetRef;
  if (!asset.id) return null;
  const evidenceInput = Array.isArray(raw.evidence) ? raw.evidence : Array.isArray(raw.matches) ? raw.matches : [];
  return {
    asset,
    rank: Math.max(1, Math.trunc(semanticWireNumber(raw.rank, offset + index + 1))),
    score: semanticWireNumber(raw.score),
    metric: semanticHitMetric(raw.metric, raw),
    evidence: evidenceInput
      .map(normalizeSemanticEvidence)
      .filter((entry): entry is AssetSemanticEvidence => Boolean(entry)),
  };
}

export async function searchProjectAssetsSemantic(
  input: AssetSemanticSearchInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticSearchPage> {
  const requestedLimit = Number(input.limit ?? 120);
  const limit = Math.max(1, Math.min(120, Math.trunc(Number.isFinite(requestedLimit) ? requestedLimit : 120)));
  const requestedOffset = Number(input.offset ?? 0);
  const offset = Math.max(0, Math.trunc(Number.isFinite(requestedOffset) ? requestedOffset : 0));
  const body = {
    projectId: input.projectId,
    query: input.query,
    filters: input.filters || {},
    limit,
    offset,
    ...(input.expectedCatalogRevision != null ? { expectedCatalogRevision: input.expectedCatalogRevision } : {}),
    ...(input.expectedProfileRevision != null ? { expectedProfileRevision: input.expectedProfileRevision } : {}),
    ...(input.expectedGeneration != null ? { expectedGeneration: input.expectedGeneration } : {}),
  };
  const res = await request<{ success: boolean; data: unknown; meta?: SemanticWireRecord }>(
    `${BASE}/project-assets/semantic/search`,
    { method: 'POST', signal: options.signal, body: JSON.stringify(body) },
  );
  const dataRecord = semanticWireRecord(res.data);
  const wireHits = Array.isArray(res.data) ? res.data : Array.isArray(dataRecord.items) ? dataRecord.items : [];
  const meta = { ...dataRecord, ...semanticWireRecord(res.meta) };
  const pageOffset = Math.max(0, Math.trunc(semanticWireNumber(meta.offset, offset)));
  const pageLimit = Math.max(1, Math.min(120, Math.trunc(semanticWireNumber(meta.limit, limit))));
  return {
    hits: wireHits
      .map((entry, index) => normalizeSemanticSearchHit(entry, index, pageOffset))
      .filter((entry): entry is AssetSemanticSearchHit => Boolean(entry)),
    total: Math.max(0, Math.trunc(semanticWireNumber(meta.total))),
    offset: pageOffset,
    limit: pageLimit,
    identity: {
      projectId: String(meta.projectId || input.projectId),
      queryDigest: String(meta.queryDigest || ''),
      catalogRevision: semanticWireRevision(meta.catalogRevision, input.expectedCatalogRevision ?? 0),
      semanticIndexRevision: semanticWireRevision(meta.semanticIndexRevision, ''),
      activeGeneration: Math.max(0, Math.trunc(semanticWireNumber(meta.activeGeneration, input.expectedGeneration ?? 0))),
      modelKey: String(meta.modelKey || ''),
      modelVersion: String(meta.modelVersion || ''),
    },
    stale: Boolean(meta.stale),
  };
}

export const searchProjectAssetSemantics = searchProjectAssetsSemantic;

function normalizeSemanticDocument(value: unknown): AssetSemanticDocument | null {
  const raw = semanticWireRecord(value);
  const sourceValue = raw.source || raw.kind || raw.documentKind;
  const source = sourceValue === 'caption' || sourceValue === 'ocr' ? sourceValue : null;
  if (!source || raw.id == null || !raw.assetId) return null;
  return {
    id: typeof raw.id === 'number' ? raw.id : String(raw.id),
    assetId: String(raw.assetId),
    source,
    modelKey: String(raw.modelKey || ''),
    modelVersion: String(raw.modelVersion || ''),
    text: String(raw.text || ''),
    language: typeof raw.language === 'string' ? raw.language : null,
    metadata: semanticWireRecord(raw.metadata),
    indexedAt: raw.indexedAt == null ? null : semanticWireNumber(raw.indexedAt),
  };
}

export async function getProjectAssetSemanticDocuments(
  assetId: string,
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticDocument[]> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/semantic/assets/${encodeURIComponent(assetId)}?projectId=${encodeURIComponent(projectId)}`,
    { signal: options.signal },
  );
  const record = semanticWireRecord(res.data);
  const documents = Array.isArray(res.data) ? res.data : Array.isArray(record.documents) ? record.documents : [];
  return documents.map(normalizeSemanticDocument).filter((entry): entry is AssetSemanticDocument => Boolean(entry));
}

function semanticJobState(value: unknown): AssetSemanticJobState | null {
  return value === 'queued' || value === 'running' || value === 'retrying' || value === 'succeeded'
    || value === 'skipped' || value === 'failed' || value === 'superseded'
    ? value
    : null;
}

function normalizeSemanticJob(value: unknown): AssetSemanticJobSummary | null {
  const raw = semanticWireRecord(value);
  const jobKind = semanticCapability(raw.jobKind || raw.capability);
  const status = semanticJobState(raw.status);
  if (!raw.id || !raw.assetId || !jobKind || !status) return null;
  return {
    id: String(raw.id),
    projectId: String(raw.projectId || ''),
    assetId: String(raw.assetId),
    generation: Math.max(0, Math.trunc(semanticWireNumber(raw.generation))),
    jobKind,
    modelKey: String(raw.modelKey || ''),
    modelVersion: String(raw.modelVersion || ''),
    status,
    revision: Math.max(0, Math.trunc(semanticWireNumber(raw.revision))),
    attemptCount: Math.max(0, Math.trunc(semanticWireNumber(raw.attemptCount))),
    maxAttempts: Math.max(1, Math.trunc(semanticWireNumber(raw.maxAttempts, 1))),
    nextAttemptAt: raw.nextAttemptAt == null ? null : semanticWireNumber(raw.nextAttemptAt),
    error: semanticWireError(raw.error) || (typeof raw.errorMessage === 'string' ? raw.errorMessage : null),
    createdAt: raw.createdAt == null ? null : semanticWireNumber(raw.createdAt),
    startedAt: raw.startedAt == null ? null : semanticWireNumber(raw.startedAt),
    updatedAt: raw.updatedAt == null ? null : semanticWireNumber(raw.updatedAt),
    finishedAt: raw.finishedAt == null ? null : semanticWireNumber(raw.finishedAt),
  };
}

export async function retryProjectAssetSemanticJob(
  jobId: string,
  input: AssetSemanticJobRetryInput,
  options: { signal?: AbortSignal } = {},
): Promise<AssetSemanticJobSummary[]> {
  const res = await request<{ success: boolean; data: unknown }>(
    `${BASE}/project-assets/semantic/jobs/${encodeURIComponent(jobId)}/retry`,
    {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({ projectId: input.projectId, expectedRevision: input.expectedRevision }),
    },
  );
  const record = semanticWireRecord(res.data);
  const jobs = Array.isArray(res.data) ? res.data : Array.isArray(record.jobs) ? record.jobs : [];
  return jobs.map(normalizeSemanticJob).filter((entry): entry is AssetSemanticJobSummary => Boolean(entry));
}

// ========== 本机协作网关管理 ==========
const COLLABORATION_PUBLIC_SELF_CHECK_IDS = new Set<CollaborationPublicSelfCheckId>([
  'health',
  'invite',
  'websocket',
  'upload',
  'range',
]);

function normalizeCollaborationPublicExposure(value: unknown): CollaborationPublicExposurePolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<CollaborationPublicExposurePolicy>;
  const exposure = ['loopback', 'lan', 'public'].includes(String(raw.exposure))
    ? raw.exposure as CollaborationPublicExposurePolicy['exposure']
    : 'public';
  const protocol = raw.protocol === 'https' ? 'https' : 'http';
  return {
    baseUrl: String(raw.baseUrl || ''),
    origin: String(raw.origin || ''),
    exposure,
    protocol,
    https: raw.https === true,
    insecurePublic: raw.insecurePublic === true,
    ownerManagementAllowed: raw.ownerManagementAllowed !== false,
    sensitiveOriginalDownloadAllowed: raw.sensitiveOriginalDownloadAllowed !== false,
    warning: raw.warning == null ? null : String(raw.warning),
  };
}

function normalizeCollaborationPublicExposureConfiguration(
  value: unknown,
): CollaborationStatus['publicExposureConfiguration'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as NonNullable<CollaborationStatus['publicExposureConfiguration']>;
  const status = ['configured', 'unconfigured', 'invalid'].includes(String(raw.status))
    ? raw.status
    : 'invalid';
  const source = ['persisted', 'environment', 'runtime', 'none'].includes(String(raw.source))
    ? raw.source
    : 'none';
  return {
    status,
    source,
    durable: raw.durable === true,
    failClosed: raw.failClosed !== false,
    canClearPersisted: raw.canClearPersisted === true,
    updatedAt: raw.updatedAt != null
      && Number.isSafeInteger(Number(raw.updatedAt))
      && Number(raw.updatedAt) > 0
      ? Number(raw.updatedAt)
      : null,
    errorCode: raw.errorCode == null ? null : String(raw.errorCode),
    warning: raw.warning == null ? null : String(raw.warning),
  };
}

function normalizeCollaborationPublicSelfCheck(value: unknown): CollaborationPublicSelfCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('公网自检结果格式无效');
  }
  const raw = value as Partial<CollaborationPublicSelfCheck>;
  const policy = normalizeCollaborationPublicExposure(raw);
  const checks = (Array.isArray(raw.checks) ? raw.checks : []).flatMap((check) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) return [];
    const entry = check as CollaborationPublicSelfCheck['checks'][number];
    if (!COLLABORATION_PUBLIC_SELF_CHECK_IDS.has(entry.id)) return [];
    return [{
      id: entry.id,
      status: entry.status === 'passed' ? 'passed' as const : 'failed' as const,
      latencyMs: Math.max(0, Number(entry.latencyMs) || 0),
      ...(Number(entry.httpStatus) ? { httpStatus: Number(entry.httpStatus) } : {}),
      ...(entry.errorCode ? { errorCode: String(entry.errorCode) } : {}),
      ...(entry.message ? { message: String(entry.message) } : {}),
      hint: String(entry.hint || ''),
    }];
  });
  if (raw.contractVersion !== 't8-collaboration-public-self-check-v1'
    || !policy
    || checks.length !== COLLABORATION_PUBLIC_SELF_CHECK_IDS.size
    || new Set(checks.map((check) => check.id)).size !== COLLABORATION_PUBLIC_SELF_CHECK_IDS.size) {
    throw new Error('公网自检结果不完整');
  }
  return {
    contractVersion: 't8-collaboration-public-self-check-v1',
    baseUrl: policy.baseUrl,
    exposure: policy.exposure,
    protocol: policy.protocol,
    https: policy.https,
    insecurePublic: policy.insecurePublic,
    ownerManagementAllowed: policy.ownerManagementAllowed,
    sensitiveOriginalDownloadAllowed: policy.sensitiveOriginalDownloadAllowed,
    warning: policy.warning,
    allChecksPassed: raw.allChecksPassed === true,
    status: raw.status === 'passed' || raw.status === 'degraded' ? raw.status : 'failed',
    completedAt: Math.max(0, Number(raw.completedAt) || 0),
    checks,
  };
}

function normalizeCollaborationStatus(value: CollaborationStatus): CollaborationStatus {
  const legacy = value as Partial<CollaborationStatus> & { connections?: number };
  const rawResourceScope = legacy.room?.resourceScope;
  const resourceScope: CollaborationResourceScopeStatus | null = rawResourceScope
    && typeof rawResourceScope === 'object'
    ? {
        status: ['ready', 'confirmation-required', 'stale'].includes(String(rawResourceScope.status))
          ? rawResourceScope.status
          : 'stale',
        ready: Boolean(rawResourceScope.ready),
        canvasRevision: Math.max(0, Number(rawResourceScope.canvasRevision) || 0),
        trustedRevision: rawResourceScope.trustedRevision == null
          ? null
          : Math.max(0, Number(rawResourceScope.trustedRevision) || 0),
        initializedAt: rawResourceScope.initializedAt == null
          ? null
          : Math.max(0, Number(rawResourceScope.initializedAt) || 0),
        assetCount: Math.max(0, Number(rawResourceScope.assetCount) || 0),
        subflowCount: Math.max(0, Number(rawResourceScope.subflowCount) || 0),
      }
    : null;
  const room = legacy.room && typeof legacy.room === 'object'
    ? {
        projectId: String(legacy.room.projectId || ''),
        canvasId: String(legacy.room.canvasId || ''),
        canvasCount: Math.max(0, Number(legacy.room.canvasCount) || 0),
        memberCount: Math.max(0, Number(legacy.room.memberCount) || 0),
        activeSessionCount: Math.max(0, Number(legacy.room.activeSessionCount) || 0),
        connectionCount: Math.max(0, Number(legacy.room.connectionCount) || 0),
        resourceScope,
      }
    : null;
  return {
    running: Boolean(legacy.running),
    host: legacy.host == null ? null : String(legacy.host),
    port: Number.isInteger(Number(legacy.port)) ? Number(legacy.port) : null,
    startedAt: legacy.startedAt == null ? null : Number(legacy.startedAt),
    connectionCount: Math.max(0, Number(legacy.connectionCount ?? legacy.connections) || 0),
    privateBackendExposed: Boolean(legacy.privateBackendExposed),
    networkInterfaces: Array.isArray(legacy.networkInterfaces) ? legacy.networkInterfaces : [],
    shareUrls: Array.isArray(legacy.shareUrls)
      ? legacy.shareUrls.filter((url): url is string => typeof url === 'string' && Boolean(url))
      : [],
    defaultHost: String(legacy.defaultHost || '127.0.0.1'),
    defaultPort: Number.isInteger(Number(legacy.defaultPort)) ? Number(legacy.defaultPort) : 18767,
    publicBaseUrl: legacy.publicBaseUrl == null ? null : String(legacy.publicBaseUrl),
    publicExposure: normalizeCollaborationPublicExposure(legacy.publicExposure),
    publicExposureConfiguration: normalizeCollaborationPublicExposureConfiguration(
      legacy.publicExposureConfiguration,
    ),
    lastPublicSelfCheck: legacy.lastPublicSelfCheck
      ? normalizeCollaborationPublicSelfCheck(legacy.lastPublicSelfCheck)
      : null,
    room,
  };
}

export async function getCollaborationStatus(
  projectId?: string,
  canvasId?: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationStatus> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (canvasId) params.set('canvasId', canvasId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const res = await request<{ success: boolean; data: CollaborationStatus }>(
    `${BASE}/collaboration/status${suffix}`,
    { signal: options.signal },
  );
  return normalizeCollaborationStatus(res.data);
}

export async function startCollaborationGateway(input: { host?: string; port?: number } = {}): Promise<CollaborationStatus> {
  const res = await request<{ success: boolean; data: CollaborationStatus }>(`${BASE}/collaboration/start`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return normalizeCollaborationStatus(res.data);
}

export async function stopCollaborationGateway(): Promise<CollaborationStatus> {
  const res = await request<{ success: boolean; data: CollaborationStatus }>(`${BASE}/collaboration/stop`, { method: 'POST' });
  return normalizeCollaborationStatus(res.data);
}

export async function runCollaborationPublicSelfCheck(
  baseUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationPublicSelfCheck> {
  const res = await request<{ success: boolean; data: CollaborationPublicSelfCheck }>(
    `${BASE}/collaboration/public-self-check`,
    {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({ baseUrl }),
    },
  );
  return normalizeCollaborationPublicSelfCheck(res.data);
}

export async function clearCollaborationPublicBaseUrl(): Promise<CollaborationStatus> {
  const res = await request<{ success: boolean; data: CollaborationStatus }>(
    `${BASE}/collaboration/public-base-url`,
    { method: 'DELETE' },
  );
  return normalizeCollaborationStatus(res.data);
}

export async function initializeCollaborationResourceScope(
  projectId: string,
  canvasId: string,
): Promise<CollaborationResourceScopeStatus> {
  const res = await request<{ success: boolean; data: CollaborationResourceScopeStatus }>(
    `${BASE}/collaboration/resource-scope/initialize`,
    {
      method: 'POST',
      body: JSON.stringify({ projectId, canvasId, confirmed: true }),
    },
  );
  return res.data;
}

export async function getCollaborationExecutionPolicy(
  projectId?: string,
  options: { signal?: AbortSignal; excludeIntentId?: string } = {},
): Promise<CollaborationExecutionPolicySnapshot> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (options.excludeIntentId) params.set('excludeIntentId', options.excludeIntentId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const res = await request<{ success: boolean; data: CollaborationExecutionPolicySnapshot }>(
    `${BASE}/collaboration/execution-policy${suffix}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function updateCollaborationExecutionPolicy(
  projectId: string,
  input: CollaborationExecutionPolicyInput,
): Promise<CollaborationExecutionPolicy> {
  const res = await request<{ success: boolean; data: CollaborationExecutionPolicy }>(
    `${BASE}/collaboration/execution-policy`,
    {
      method: 'PUT',
      body: JSON.stringify({ projectId, ...input }),
    },
  );
  return res.data;
}

export async function getCollaborationRoomExecutionPolicy(
  projectId: string,
  canvasId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationRoomExecutionPolicySnapshot> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationRoomExecutionPolicySnapshot }>(
    `${BASE}/collaboration/room-execution-policy?${params.toString()}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function updateCollaborationRoomExecutionPolicy(
  projectId: string,
  canvasId: string,
  input: CollaborationRoomExecutionPolicyInput,
): Promise<CollaborationRoomExecutionPolicy> {
  const res = await request<{ success: boolean; data: CollaborationRoomExecutionPolicy }>(
    `${BASE}/collaboration/room-execution-policy`,
    {
      method: 'PUT',
      body: JSON.stringify({ projectId, canvasId, ...input }),
    },
  );
  return res.data;
}

export async function getCollaborationReviewVisibilityPolicy(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationReviewVisibilityPolicy> {
  const params = new URLSearchParams({ projectId });
  const res = await request<{ success: boolean; data: CollaborationReviewVisibilityPolicy }>(
    `${BASE}/collaboration/review-visibility-policy?${params.toString()}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function updateCollaborationReviewVisibilityPolicy(
  projectId: string,
  input: CollaborationReviewVisibilityPolicyInput,
): Promise<CollaborationReviewVisibilityPolicy> {
  const res = await request<{ success: boolean; data: CollaborationReviewVisibilityPolicy }>(
    `${BASE}/collaboration/review-visibility-policy`,
    {
      method: 'PUT',
      body: JSON.stringify({ projectId, ...input }),
    },
  );
  return res.data;
}

export async function listCollaborationAuditEvents(
  input: {
    projectId: string;
    canvasId?: string | null;
    action?: string;
    actorId?: string;
    targetType?: string;
    offset?: number;
    limit?: number;
  },
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationAuditPage> {
  const params = new URLSearchParams({ projectId: input.projectId });
  if (input.canvasId) params.set('canvasId', input.canvasId);
  if (input.action) params.set('action', input.action);
  if (input.actorId) params.set('actorId', input.actorId);
  if (input.targetType) params.set('targetType', input.targetType);
  if (input.offset != null) params.set('offset', String(input.offset));
  if (input.limit != null) params.set('limit', String(input.limit));
  const res = await request<{ success: boolean; data: CollaborationAuditPage }>(
    `${BASE}/collaboration/audit-events?${params.toString()}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function logoutCurrentCollaborationSession(): Promise<void> {
  await request<{ success: boolean }>(`${BASE}/collab/logout`, {
    method: 'POST',
    credentials: 'same-origin',
    body: '{}',
  });
}

export async function rotateCurrentCollaborationSession(
  recoveryGeneration: string | null = null,
): Promise<CollaborationParticipantSession> {
  const res = await request<{ success: boolean; data: CollaborationParticipantSession }>(
    `${BASE}/collab/session/rotate`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: recoveryGeneration
        ? { 'X-T8-Canvas-Generation': recoveryGeneration }
        : undefined,
      body: '{}',
    },
  );
  return res.data;
}

export async function createCollaborationInvite(input: {
  projectId: string;
  canvasId: string;
  role: WorkspaceRole;
  expiresInMs?: number;
  maxUses?: number;
}): Promise<CollaborationInvite> {
  const res = await request<{ success: boolean; data: CollaborationInvite }>(`${BASE}/collaboration/invites`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function listCollaborationInvites(
  projectId: string,
  canvasId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationInvite[]> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationInvite[] }>(
    `${BASE}/collaboration/invites?${params.toString()}`,
    { signal: options.signal },
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function revokeCollaborationInvite(inviteId: string, projectId: string, canvasId: string): Promise<CollaborationInvite> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationInvite }>(
    `${BASE}/collaboration/invites/${encodeURIComponent(inviteId)}?${params.toString()}`,
    { method: 'DELETE' },
  );
  return res.data;
}

export async function listCollaborationMembers(
  projectId: string,
  canvasId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationMember[]> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationMember[] }>(
    `${BASE}/collaboration/members?${params.toString()}`,
    { signal: options.signal },
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function updateCollaborationMember(
  memberId: string,
  projectId: string,
  canvasId: string,
  patch: { role: Exclude<WorkspaceRole, 'owner'>; displayName?: string },
): Promise<CollaborationMember> {
  const res = await request<{ success: boolean; data: CollaborationMember }>(
    `${BASE}/collaboration/members/${encodeURIComponent(memberId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, projectId, canvasId }),
    },
  );
  return res.data;
}

export async function removeCollaborationMember(memberId: string, projectId: string, canvasId: string): Promise<CollaborationMember> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationMember }>(
    `${BASE}/collaboration/members/${encodeURIComponent(memberId)}?${params.toString()}`,
    { method: 'DELETE' },
  );
  return res.data;
}

export async function listCollaborationSessions(
  projectId: string,
  canvasId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CollaborationSession[]> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationSession[] }>(
    `${BASE}/collaboration/sessions?${params.toString()}`,
    { signal: options.signal },
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function revokeCollaborationSession(sessionId: string, projectId: string, canvasId: string): Promise<CollaborationSession> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: CollaborationSession }>(
    `${BASE}/collaboration/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`,
    { method: 'DELETE' },
  );
  return res.data;
}

export async function revokeAllCollaborationSessions(projectId: string, canvasId: string): Promise<CollaborationSessionRevocationResult> {
  const res = await request<{ success: boolean; data: CollaborationSessionRevocationResult }>(
    `${BASE}/collaboration/sessions/revoke-all`,
    {
      method: 'POST',
      body: JSON.stringify({ projectId, canvasId }),
    },
  );
  return res.data;
}

export async function listCollaborationRunIntents(
  status?: string,
  projectId?: string,
  canvasId?: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<RunIntent[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (projectId) params.set('projectId', projectId);
  if (canvasId) params.set('canvasId', canvasId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const res = await request<{ success: boolean; data: RunIntent[] }>(
    `${BASE}/collaboration/run-intents${suffix}`,
    { signal: options.signal },
  );
  return res.data || [];
}

export async function getCollaborationRunIntent(
  intentId: string,
  projectId: string,
  canvasId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RunIntent> {
  const params = new URLSearchParams({ projectId, canvasId });
  const res = await request<{ success: boolean; data: RunIntent }>(
    `${BASE}/collaboration/run-intents/${encodeURIComponent(intentId)}?${params.toString()}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function getCollaborationRunIntentSnapshot(
  intentId: string,
  projectId: string,
  canvasId: string,
  canvasRevision: number,
  options: { signal?: AbortSignal } = {},
): Promise<CanvasData> {
  const params = new URLSearchParams({
    projectId,
    canvasId,
    canvasRevision: String(canvasRevision),
  });
  const res = await request<{ success: boolean; data: CanvasData }>(
    `${BASE}/collaboration/run-intents/${encodeURIComponent(intentId)}/snapshot?${params.toString()}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function updateCollaborationRunIntent(
  intentId: string,
  projectId: string,
  canvasId: string,
  patch: CollaborationRunIntentQueueMutationInput & { status: 'rejected' | 'stale' },
): Promise<RunIntent> {
  const res = await request<{ success: boolean; data: RunIntent }>(`${BASE}/collaboration/run-intents/${encodeURIComponent(intentId)}`, {
    method: 'PATCH', body: JSON.stringify({ ...patch, projectId, canvasId }),
  });
  return res.data;
}

export async function acceptCollaborationRunIntent(
  intentId: string,
  projectId: string,
  canvasId: string,
  input: CollaborationRunIntentQueueMutationInput,
): Promise<RunIntent> {
  const res = await request<{ success: boolean; data: RunIntent }>(
    `${BASE}/collaboration/run-intents/${encodeURIComponent(intentId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ projectId, canvasId, ...input }),
    },
  );
  return res.data;
}

export async function cancelCollaborationRunIntent(
  intentId: string,
  projectId: string,
  canvasId: string,
  input: CollaborationRunIntentQueueMutationInput,
): Promise<RunIntent> {
  const res = await request<{ success: boolean; data: RunIntent }>(
    `${BASE}/collaboration/run-intents/${encodeURIComponent(intentId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ projectId, canvasId, ...input }),
    },
  );
  return res.data;
}

export async function leaseCollaborationRunIntent(input: {
  projectId: string;
  canvasId: string;
  workerId: string;
  expectedIntentId?: string;
  leaseDurationMs?: number;
}): Promise<CollaborationRunIntentDispatchLease | null> {
  const res = await request<{ success: boolean; data: CollaborationRunIntentDispatchLease | null }>(
    `${BASE}/collaboration/run-intents/lease`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.data || null;
}

export async function releaseCollaborationRunIntentLease(
  intentId: string,
  input: {
    projectId: string;
    canvasId: string;
    expectedQueueRevision: number;
    workerId: string;
    leaseToken: string;
    retryable?: boolean;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<RunIntent> {
  const res = await request<{ success: boolean; data: RunIntent }>(
    `${BASE}/collaboration/run-intents/${encodeURIComponent(intentId)}/lease/release`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.data;
}

export async function appendProjectRunEvent(runId: string, event: {
  nodeRunId?: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}): Promise<RunEventRecord> {
  const res = await request<{ success: boolean; data: RunEventRecord }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}/events`,
    { method: 'POST', body: JSON.stringify(event) },
  );
  return res.data;
}

export async function listProjectRunEvents(runId: string, afterId = 0): Promise<RunEventRecord[]> {
  const res = await request<{ success: boolean; data: RunEventRecord[] }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}/events?afterId=${Math.max(0, Math.trunc(afterId))}`,
  );
  return res.data || [];
}

export async function createProjectNodeRun(runId: string, input: {
  nodeId: string;
  parentNodeRunId?: string;
  originalNodeId?: string;
  definitionId?: string;
  definitionVersion?: number;
  subflowPath?: string[];
  status?: string;
  inputSnapshot?: Record<string, unknown>;
}): Promise<NodeRunSummary> {
  const res = await request<{ success: boolean; data: NodeRunSummary }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}/nodes`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return res.data;
}

export async function updateProjectNodeRun(runId: string, nodeRunId: string, patch: {
  status?: string;
  eventPayload?: Record<string, unknown>;
}): Promise<NodeRunSummary> {
  const res = await request<{ success: boolean; data: NodeRunSummary }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return res.data;
}

export async function createProjectRunAttempt(runId: string, nodeRunId: string, input: {
  id?: string;
  entityUid?: string;
  provider?: string;
  model?: string;
  upstreamTaskId?: string;
  requestId?: string;
  httpStatus?: number;
  pollCount?: number;
  status?: string;
  timestamps?: Record<string, number>;
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
}): Promise<RunAttemptSummary & { reusedSubmission?: boolean }> {
  const res = await request<{ success: boolean; data: RunAttemptSummary; reusedSubmission?: boolean }>(`${BASE}/project-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}/attempts`, { method: 'POST', body: JSON.stringify(input) });
  return { ...res.data, reusedSubmission: res.reusedSubmission === true };
}

export async function updateProjectRunAttempt(runId: string, nodeRunId: string, attemptId: string, patch: {
  provider?: string;
  model?: string;
  upstreamTaskId?: string;
  requestId?: string;
  httpStatus?: number;
  pollCount?: number;
  status?: string;
  timestamps?: Record<string, number>;
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
}): Promise<RunAttemptSummary> {
  const res = await request<{ success: boolean; data: RunAttemptSummary }>(`${BASE}/project-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}/attempts/${encodeURIComponent(attemptId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return res.data;
}

export async function finalizeProjectNodeRunAttempt(
  runId: string,
  nodeRunId: string,
  attemptId: string,
  input: {
    status: 'succeeded' | 'failed' | 'stopped' | 'interrupted';
    timestamps?: Record<string, number>;
    error?: Record<string, unknown> | null;
    eventPayload?: Record<string, unknown>;
  },
): Promise<{ nodeRun: NodeRunSummary; attempt: RunAttemptSummary; event: RunEventRecord }> {
  const res = await request<{
    success: boolean;
    data: { nodeRun: NodeRunSummary; attempt: RunAttemptSummary; event: RunEventRecord };
  }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}/attempts/${encodeURIComponent(attemptId)}/terminal`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return res.data;
}

export async function persistProjectRunOutputAssets(runId: string, nodeRunId: string, input: {
  attemptId?: string;
  outputs: Array<{
    kind: 'image' | 'video' | 'audio' | 'model3d' | 'text' | 'other';
    sourceUrl?: string;
    text?: string;
    filename: string;
    mimeType?: string;
    metadata?: Record<string, unknown>;
  }>;
  eventPayload?: Record<string, unknown>;
}, options: { signal?: AbortSignal } = {}): Promise<{ nodeRun: NodeRunSummary; assets: AssetRef[] }> {
  const res = await request<{ success: boolean; data: { nodeRun: NodeRunSummary; assets: AssetRef[] } }>(
    `${BASE}/project-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}/outputs`,
    { method: 'POST', body: JSON.stringify(input), signal: options.signal },
  );
  return res.data;
}

// ========== 可复用子工作流 ==========
export async function listSubflows(query = '', projectId?: string, options: { signal?: AbortSignal } = {}): Promise<SubflowDefinition[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (projectId) params.set('projectId', projectId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const res = await request<{ success: boolean; data: SubflowDefinition[] }>(`${BASE}/subflows${suffix}`, { signal: options.signal });
  return res.data || [];
}

export async function saveSubflow(definition: Omit<SubflowDefinition, 'version'> & {
  version?: number;
  baseRevision: number;
  changeSummary: string;
}): Promise<SubflowDefinition> {
  const res = await request<{ success: boolean; data: SubflowDefinition }>(`${BASE}/subflows`, {
    method: 'POST',
    body: JSON.stringify(definition),
  });
  return res.data;
}

export async function getSubflow(id: string, version?: number, projectId?: string, options: { signal?: AbortSignal } = {}): Promise<SubflowDefinition> {
  const suffix = version ? `/${Math.max(1, Math.trunc(version))}` : '';
  const projectSuffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await request<{ success: boolean; data: SubflowDefinition }>(
    `${BASE}/subflows/${encodeURIComponent(id)}${suffix}${projectSuffix}`,
    { signal: options.signal },
  );
  return res.data;
}

export async function listSubflowVersions(id: string, projectId?: string, options: { signal?: AbortSignal } = {}): Promise<SubflowDefinition[]> {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await request<{ success: boolean; data: SubflowDefinition[] }>(
    `${BASE}/subflows/${encodeURIComponent(id)}/versions${suffix}`,
    { signal: options.signal },
  );
  return res.data || [];
}

export interface SubflowPackageInspection {
  archiveSha256: string;
  manifest: { schema: string; version: number; definitionId?: string; definitionVersion?: number; files: Array<{ path: string; size: number; sha256: string; license?: string; redistributable?: boolean }> };
  definition: SubflowDefinition;
  entryCount: number;
  totalBytes: number;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export async function inspectSubflowPackage(file: File): Promise<SubflowPackageInspection> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await request<{ success: boolean; data: SubflowPackageInspection }>(`${BASE}/subflows/package/inspect`, { method: 'POST', body: form });
  return res.data;
}

export async function importSubflowPackage(file: File, archiveSha256: string, projectId?: string): Promise<SubflowDefinition> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('archiveSha256', archiveSha256);
  if (projectId) form.append('projectId', projectId);
  const res = await request<{ success: boolean; data: { definition: SubflowDefinition } }>(`${BASE}/subflows/package/import`, { method: 'POST', body: form });
  return res.data.definition;
}

export async function downloadSubflowPackage(definition: Pick<SubflowDefinition, 'id' | 'version' | 'projectId' | 'name'>): Promise<void> {
  const projectId = definition.projectId ? `?projectId=${encodeURIComponent(definition.projectId)}` : '';
  const response = await fetch(`${BASE}/subflows/${encodeURIComponent(definition.id)}/${definition.version}/package${projectId}`);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
    throw new ApiRequestError(message, response.status, null);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${definition.name || definition.id}-v${definition.version}.t8flow`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type TaskCompletionSoundSettings = NonNullable<ApiSettings['taskCompletionSound']>;

export async function getTaskCompletionSoundSettings(): Promise<TaskCompletionSoundSettings> {
  const res = await request<{ success: boolean; data: TaskCompletionSoundSettings }>(
    `${BASE}/settings/task-completion-sound`,
  );
  return res.data || { mode: 'default', url: '' };
}

export async function uploadTaskCompletionSound(file: File): Promise<TaskCompletionSoundSettings> {
  const form = new FormData();
  form.append('audio', file);
  const res = await fetch(`${BASE}/settings/task-completion-sound`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    let responseData: unknown = null;
    try {
      const data = await res.json();
      responseData = data;
      errMsg = data.error || data.message || errMsg;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(errMsg, res.status, responseData);
  }
  const data = await res.json();
  return data.data || { mode: 'default', url: '' };
}

export async function resetTaskCompletionSound(): Promise<TaskCompletionSoundSettings> {
  const res = await request<{ success: boolean; data: TaskCompletionSoundSettings }>(
    `${BASE}/settings/task-completion-sound`,
    { method: 'DELETE' },
  );
  return res.data || { mode: 'default', url: '' };
}

export interface AdvancedProviderTestResult {
  ok: boolean;
  code: string;
  providerId: string;
  protocol: string;
  message?: string;
  error?: string;
  provider?: AdvancedProviderConfig;
}

export async function testAdvancedProvider(payload: {
  providerId?: string;
  provider?: AdvancedProviderConfig;
  dryRun?: boolean;
}): Promise<AdvancedProviderTestResult> {
  const res = await request<{
    success: boolean;
    code?: string;
    error?: string;
    data?: AdvancedProviderTestResult;
  }>(`${BASE}/proxy/external/test-provider`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.success && res.data) return res.data;
  if (!res.success) {
    return {
      ok: false,
      code: res.code || 'provider_test_failed',
      providerId: payload.providerId || payload.provider?.id || '',
      protocol: payload.provider?.protocol || '',
      error: res.error || '测试失败',
    };
  }
  return res.data || {
    ok: false,
    code: 'empty_response',
    providerId: payload.providerId || payload.provider?.id || '',
    protocol: payload.provider?.protocol || '',
    error: '测试接口没有返回结果',
  };
}

export interface CloudUploadStatus {
  targets: CloudUploadTargetConfig[];
  summary: CloudUploadSummary;
}

export interface CloudUploadTestResult {
  ok: boolean;
  supported?: boolean;
  message?: string;
  error?: string;
  code?: string;
  hint?: string;
  statusCode?: number;
  providerCode?: string;
  providerMessage?: string;
  requestId?: string;
  target?: CloudUploadTargetConfig;
}

export interface CloudUploadAssetResult {
  provider: string;
  targetId: string;
  label: string;
  objectKey?: string;
  path?: string;
  url?: string;
  filename?: string;
  size?: number;
  mime?: string;
  kind?: string;
  uploadedAt?: string;
}

export function getCloudUploadStatus() {
  return safeRequest<CloudUploadStatus>(`${BASE}/cloud-uploads/status`);
}

export function testCloudUploadTarget(payload: {
  targetId?: string;
  target?: CloudUploadTargetConfig;
}) {
  return safeRequest<CloudUploadTestResult>(`${BASE}/cloud-uploads/test`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function uploadCloudAsset(payload: {
  targetId: string;
  url: string;
  kind?: ResourceMediaKind | string;
  filename?: string;
  title?: string;
  sourceNodeId?: string;
  sourceCanvasId?: string;
}) {
  return safeRequest<CloudUploadAssetResult>(`${BASE}/cloud-uploads/upload`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ========== 文件自动保存到本地路径 (v1.2.10.2) ==========
// 静默失败(后端不可用/路径不存在/写入床夫败等) —— 仅返回布尔, 不抛
// 以免阐业务外主生成链路(OutputNode 只负责 "心愿尝试保存")。
export async function saveAssetToDisk(
  url: string,
  filename?: string,
): Promise<{ ok: boolean; path?: string; exist?: boolean; error?: string }> {
  try {
    if (!url) return { ok: false, error: 'empty url' };
    const res = await fetch(`${BASE}/files/save-to-disk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, filename }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    return { ok: true, path: json?.data?.path, exist: !!json?.data?.exist };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export interface DuckDecodeFileItem {
  sourceUrl: string;
  decoded: boolean;
  url?: string;
  filename?: string;
  size?: number;
  kind?: MediaKind;
  mime?: string;
  originalExt?: string;
  ext?: string;
  isDuck?: boolean;
  passwordProtected?: boolean;
  reason?: string;
}

export async function decodeDuckFiles(
  urls: string[],
): Promise<{ items: DuckDecodeFileItem[]; decodedCount: number }> {
  const res = await request<{
    success: boolean;
    data: { items: DuckDecodeFileItem[]; decodedCount: number };
  }>(`${BASE}/files/duck-decode`, {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
  return res.data || { items: [], decodedCount: 0 };
}

// ========== RH 工具节点 (v1.2.10+) ==========
//   与顶层控件区分：仅供 RHToolsNode 使用，与 RH 应用创意包数据完全分开。
//   后端走 T8 自己的 18766 服务。

export interface RHToolCategory {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface RHTool {
  id: string;
  webappId: string;
  rhSite?: 'cn' | 'intl';
  title: string;
  description: string;
  categoryId: string;
  coverUrl: string;
  order: number;
  addedAt: number;
}

export interface RHToolsBackup {
  schema?: 't8-rh-tools' | string;
  version?: number;
  exportedAt?: string;
  categories: RHToolCategory[];
  tools: RHTool[];
}

export interface AddRHToolPayload {
  webappId: string;
  rhSite?: 'cn' | 'intl';
  title: string;
  description?: string;
  categoryId?: string;
  coverUrl?: string;
}

export type OkData<T> = { success: true; data: T };
export type ErrData = {
  success: false;
  error: string;
  code?: string;
  messageKey?: string | null;
  params?: Record<string, string | number | boolean>;
  data?: any;
};
export type Result<T> = OkData<T> | ErrData;

async function safeRequest<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const envelope = parseApiErrorEnvelope(json, res.status);
      return { success: false, ...envelope, data: json.data };
    }
    if (json && typeof json === 'object' && 'success' in json) {
      if (json.success === false) {
        const envelope = parseApiErrorEnvelope(json, res.status || 400);
        return { ...json, ...envelope, success: false } as ErrData;
      }
      return json as Result<T>;
    }
    return { success: true, data: json as T };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || 'Network error',
      code: 'network_error',
      messageKey: 'errors.api.network',
      params: {},
    };
  }
}

export interface FeishuBitableSettingsStatus {
  apiBase: string;
  appId?: string;
  appSecret?: string;
  hasAppId: boolean;
  hasAppSecret: boolean;
  tokenPreview?: string;
}

export interface FeishuBitableField {
  field_id?: string;
  field_name?: string;
  id?: string;
  name?: string;
  type?: string | number;
  is_primary?: boolean;
  property?: Record<string, any>;
}

export interface FeishuBitableRecord {
  record_id?: string;
  recordId?: string;
  id?: string;
  fields?: Record<string, any>;
  created_time?: number;
  last_modified_time?: number;
}

export function getFeishuBitableStatus() {
  return safeRequest<FeishuBitableSettingsStatus>(`${BASE}/feishu-bitable/status`);
}

export function saveFeishuBitableSettings(payload: {
  apiBase?: string;
  appId?: string;
  appSecret?: string;
}) {
  return safeRequest<FeishuBitableSettingsStatus>(`${BASE}/feishu-bitable/settings`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function testFeishuBitableConnection(payload: {
  apiBase?: string;
  appId?: string;
  appSecret?: string;
} = {}) {
  return safeRequest<FeishuBitableSettingsStatus>(`${BASE}/feishu-bitable/test`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getFeishuBitableFields(payload: {
  appToken: string;
  tableId: string;
  apiBase?: string;
}) {
  return safeRequest<{ items: FeishuBitableField[] }>(`${BASE}/feishu-bitable/fields`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function searchFeishuBitableRecords(payload: {
  appToken: string;
  tableId: string;
  viewId?: string;
  fieldNames?: string[];
  pageSize?: number;
  limit?: number;
  filter?: Record<string, any>;
  sort?: any[];
  apiBase?: string;
}) {
  return safeRequest<{ items: FeishuBitableRecord[] }>(`${BASE}/feishu-bitable/records/search`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function downloadFeishuBitableMedia(payload: {
  fileToken: string;
  name?: string;
  apiBase?: string;
}) {
  return safeRequest<{ name: string; path: string; url: string; size: number; contentType?: string }>(
    `${BASE}/feishu-bitable/media/download`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export function writeFeishuBitableRecords(payload: {
  appToken: string;
  tableId: string;
  mode?: 'create' | 'update';
  recordId?: string;
  records?: Array<{ recordId?: string; fields: Record<string, any> }>;
  fields?: Record<string, any>;
  apiBase?: string;
}) {
  return safeRequest<{ items: FeishuBitableRecord[] }>(`${BASE}/feishu-bitable/records/write`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface RhToolboxManifestPersistenceResult {
  manifest: RhToolboxManifest;
  path?: string;
  categoryCount: number;
  toolCount: number;
}

export function getRhToolboxPersistentManifest() {
  return safeRequest<RhToolboxManifestPersistenceResult>(`${BASE}/settings/rh-toolbox/manifest`);
}

export function saveRhToolboxPersistentManifest(manifest: RhToolboxManifest, source = 'maker') {
  return safeRequest<RhToolboxManifestPersistenceResult>(`${BASE}/settings/rh-toolbox/manifest`, {
    method: 'PUT',
    body: JSON.stringify({ manifest, source }),
  });
}

// ----- 分类 -----
export function getRHToolCategories() {
  return safeRequest<RHToolCategory[]>(`${BASE}/settings/rh-tool-categories`);
}
export function addRHToolCategory(name: string) {
  return safeRequest<RHToolCategory>(`${BASE}/settings/rh-tool-categories`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}
export function renameRHToolCategory(id: string, name: string) {
  return safeRequest<RHToolCategory>(`${BASE}/settings/rh-tool-categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}
export function deleteRHToolCategory(id: string) {
  return safeRequest<void>(`${BASE}/settings/rh-tool-categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
export function reorderRHToolCategories(ids: string[]) {
  return safeRequest<RHToolCategory[]>(`${BASE}/settings/rh-tool-categories/reorder`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

// ----- 应用 -----
export function getRHTools() {
  return safeRequest<RHTool[]>(`${BASE}/settings/rh-tool-apps`);
}
export function addRHTool(payload: AddRHToolPayload) {
  return safeRequest<RHTool>(`${BASE}/settings/rh-tool-apps`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
export function updateRHTool(id: string, payload: Partial<AddRHToolPayload>) {
  return safeRequest<RHTool>(`${BASE}/settings/rh-tool-apps/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
export function deleteRHTool(id: string) {
  return safeRequest<void>(`${BASE}/settings/rh-tool-apps/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
export function reorderRHTools(ids: string[]) {
  return safeRequest<RHTool[]>(`${BASE}/settings/rh-tool-apps/reorder`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
export function getRHToolsBackup() {
  return safeRequest<RHToolsBackup>(`${BASE}/settings/rh-tools/export`);
}
export function importRHToolsBackup(payload: RHToolsBackup, mode: 'replace' | 'merge' = 'replace') {
  return safeRequest<{ categories: RHToolCategory[]; tools: RHTool[]; categoryCount: number; toolCount: number }>(
    `${BASE}/settings/rh-tools/import`,
    {
      method: 'POST',
      body: JSON.stringify({ ...payload, mode }),
    }
  );
}

// ========== 资源库 (v1.3.4) ==========
export type ResourceKind = 'image' | 'video' | 'audio' | 'panorama' | 'set' | 'pose' | 'workflow';
export type ResourceMediaKind = 'image' | 'video' | 'audio';
export type ResourceAddKind = ResourceMediaKind | 'panorama';
export type ResourceMaterialSetKind = 'text' | 'image' | 'video' | 'audio';

export interface ResourceCategory {
  id: string;
  kind: ResourceKind;
  name: string;
  order: number;
  system?: boolean;
  createdAt: number;
}

export interface ResourceItem {
  id: string;
  kind: ResourceKind;
  categoryId: string;
  title: string;
  originalName?: string;
  fileUrl: string;
  thumbUrl?: string;
  mime?: string;
  size: number;
  width?: number;
  height?: number;
  sha256?: string;
  tags: string[];
  favorite: boolean;
  sourceUrl?: string;
  sourceNodeId?: string;
  sourceCanvasId?: string;
  materialSetKind?: ResourceMaterialSetKind;
  materialSetItems?: Array<{
    id: string;
    kind: ResourceMaterialSetKind;
    url?: string;
    text?: string;
    name?: string;
    size?: number;
    mime?: string;
  }>;
  workflowNodeCount?: number;
  workflowEdgeCount?: number;
  workflowNodeTypes?: string[];
  workflowPreview?: {
    nodes: Array<{ id: string; type: string; label: string; x: number; y: number }>;
    edges: Array<{ source: string; target: string }>;
  };
  workflowFragment?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface AddResourceSetPayload {
  materialSetKind: ResourceMaterialSetKind;
  materialSetItems: Array<{
    id?: string;
    kind: ResourceMaterialSetKind;
    url?: string;
    text?: string;
    name?: string;
    size?: number;
    mime?: string;
  }>;
  categoryId?: string;
  title?: string;
  tags?: string[];
  sourceNodeId?: string;
  sourceCanvasId?: string;
  favorite?: boolean;
}

export interface AddResourcePayload {
  url: string;
  kind: ResourceAddKind;
  categoryId?: string;
  title?: string;
  tags?: string[];
  sourceNodeId?: string;
  sourceCanvasId?: string;
  favorite?: boolean;
}

export interface UploadedResourceLocalFile {
  filename: string;
  url: string;
  size: number;
  mime?: string;
  assetId?: string | null;
  storageMode?: string;
  availability?: string;
  indexError?: string;
}

export interface UploadResourceLocalFileContext {
  projectId?: string;
  canvasId?: string;
  sourceNodeId?: string;
  sourceNodeType?: string;
}

export interface UploadResourceLocalFileProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface UploadResourceLocalFileOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UploadResourceLocalFileProgress) => void;
}

export interface AddResourcePosePayload {
  poseBackup: Record<string, any>;
  categoryId?: string;
  title?: string;
  tags?: string[];
  sourceNodeId?: string;
  sourceCanvasId?: string;
  favorite?: boolean;
}

export interface AddResourceWorkflowPayload {
  workflowFragment: Record<string, any>;
  categoryId?: string;
  title?: string;
  tags?: string[];
  sourceNodeId?: string;
  sourceCanvasId?: string;
  favorite?: boolean;
}

export function getResourceCategories(kind?: ResourceKind) {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return safeRequest<ResourceCategory[]>(`${BASE}/resources/categories${q}`);
}

export function addResourceCategory(kind: ResourceKind, name: string) {
  return safeRequest<ResourceCategory>(`${BASE}/resources/categories`, {
    method: 'POST',
    body: JSON.stringify({ kind, name }),
  });
}

export function renameResourceCategory(id: string, name: string) {
  return safeRequest<ResourceCategory>(`${BASE}/resources/categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function deleteResourceCategory(id: string) {
  return safeRequest<{ movedTo: string }>(`${BASE}/resources/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function getResourceItems(params: {
  kind?: ResourceKind;
  categoryId?: string;
  q?: string;
  favorite?: boolean;
} = {}) {
  const sp = new URLSearchParams();
  if (params.kind) sp.set('kind', params.kind);
  if (params.categoryId) sp.set('categoryId', params.categoryId);
  if (params.q) sp.set('q', params.q);
  if (params.favorite) sp.set('favorite', '1');
  const qs = sp.toString();
  return safeRequest<ResourceItem[]>(`${BASE}/resources/items${qs ? `?${qs}` : ''}`);
}

export function addResourceItem(payload: AddResourcePayload) {
  return safeRequest<ResourceItem & { duplicate?: boolean }>(`${BASE}/resources/items/add`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function parseUploadedResourceLocalFile(payload: unknown, status: number): UploadedResourceLocalFile {
  const json = payload && typeof payload === 'object'
    ? payload as { success?: boolean; error?: string; message?: string; data?: UploadedResourceLocalFile }
    : null;
  if (status < 200 || status >= 300 || !json?.success) {
    throw new Error(json?.error || json?.message || `HTTP ${status}`);
  }
  if (!json.data?.url) {
    throw new Error('文件上传接口未返回可用地址');
  }
  return json.data;
}

function creatorUploadAbortError() {
  return new DOMException('附件上传已取消', 'AbortError');
}

export async function uploadResourceLocalFile(
  file: File,
  context: UploadResourceLocalFileContext = {},
  options: UploadResourceLocalFileOptions = {},
): Promise<UploadedResourceLocalFile> {
  const fd = new FormData();
  fd.append('file', file);
  for (const [key, value] of Object.entries(context)) {
    const normalized = String(value || '').trim();
    if (normalized) fd.append(key, normalized);
  }

  if (options.onProgress && typeof XMLHttpRequest !== 'undefined') {
    return await new Promise<UploadedResourceLocalFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const cleanup = () => {
        options.signal?.removeEventListener('abort', abort);
        xhr.upload.onprogress = null;
        xhr.onload = null;
        xhr.onerror = null;
        xhr.onabort = null;
      };
      const finish = (callback: () => void) => {
        cleanup();
        callback();
      };
      const abort = () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) xhr.abort();
      };

      if (options.signal?.aborted) {
        reject(creatorUploadAbortError());
        return;
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      xhr.open('POST', `${BASE}/files/upload`);
      xhr.responseType = 'json';
      xhr.upload.onprogress = (event) => {
        const total = event.lengthComputable && event.total > 0 ? event.total : null;
        options.onProgress?.({
          loaded: Math.max(0, event.loaded),
          total,
          percent: total === null
            ? null
            : Math.max(0, Math.min(100, Math.round((event.loaded / total) * 100))),
        });
      };
      xhr.onload = () => {
        let payload: unknown = xhr.response;
        if (!payload) {
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            payload = null;
          }
        }
        try {
          const uploaded = parseUploadedResourceLocalFile(payload, xhr.status);
          finish(() => resolve(uploaded));
        } catch (error) {
          finish(() => reject(error));
        }
      };
      xhr.onerror = () => finish(() => reject(new Error('附件上传网络连接失败')));
      xhr.onabort = () => finish(() => reject(creatorUploadAbortError()));
      options.onProgress?.({ loaded: 0, total: file.size || null, percent: 0 });
      xhr.send(fd);
    });
  }

  const res = await fetch(`${BASE}/files/upload`, {
    method: 'POST',
    body: fd,
    signal: options.signal,
  });
  const json = await res.json().catch(() => null);
  return parseUploadedResourceLocalFile(json, res.status);
}

export function addResourceSet(payload: AddResourceSetPayload) {
  return safeRequest<ResourceItem & { duplicate?: boolean }>(`${BASE}/resources/sets/add`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function addResourcePose(payload: AddResourcePosePayload) {
  return safeRequest<ResourceItem & { duplicate?: boolean }>(`${BASE}/resources/poses/add`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function addResourceWorkflow(payload: AddResourceWorkflowPayload) {
  return safeRequest<ResourceItem & { duplicate?: boolean }>(`${BASE}/resources/workflows/add`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateResourceItem(id: string, patch: Partial<Pick<ResourceItem, 'title' | 'categoryId' | 'tags' | 'favorite'>> & { touch?: boolean }) {
  return safeRequest<ResourceItem>(`${BASE}/resources/items/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function deleteResourceItem(id: string) {
  return safeRequest<void>(`${BASE}/resources/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ========== Eagle 本地库 ==========
export interface EagleImportMaterial {
  id?: string;
  kind: ResourceMaterialSetKind;
  url?: string;
  text?: string;
  name?: string;
  tags?: string[];
}

export interface EagleImportResult {
  base: string;
  imported: Array<{ kind: string; name: string; result?: any }>;
  skipped: Array<{ kind: string; name: string; reason: string }>;
  failures: Array<{ kind: string; name: string; error: string }>;
}

export interface FigmaImportResult {
  base: string;
  sent: number;
  result?: any;
}

export interface PhotoshopImportResult {
  commandId: string;
  queued: boolean;
  queueSize: number;
  sent: number;
  skipped: number;
}

export function sendToEagle(payload: {
  materials: EagleImportMaterial[];
  tags?: string[];
  folderId?: string;
  eagleApiBase?: string;
}) {
  return safeRequest<EagleImportResult>(`${BASE}/eagle/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function sendToFigma(payload: {
  materials: EagleImportMaterial[];
  tags?: string[];
  figmaApiBase?: string;
}) {
  return safeRequest<FigmaImportResult>(`${BASE}/figma/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function sendToPhotoshop(payload: {
  materials: EagleImportMaterial[];
  tags?: string[];
  sourceCanvasId?: string;
  sourceLabel?: string;
}) {
  return safeRequest<PhotoshopImportResult>(`${BASE}/photoshop-bridge/send-to-photoshop`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ========== 主题模板 (v1.3.6) ==========

export interface ThemeTemplatesResponse {
  path: string;
  templates: ThemeTemplate[];
}

export function getThemeTemplates() {
  return safeRequest<ThemeTemplatesResponse>(`${BASE}/themes/templates`);
}

export function importThemeTemplate(template: ThemeTemplate) {
  return safeRequest<ThemeTemplate>(`${BASE}/themes/templates/import`, {
    method: 'POST',
    body: JSON.stringify({ template }),
  });
}

export function saveThemeTemplate(template: ThemeTemplate) {
  return safeRequest<ThemeTemplate>(`${BASE}/themes/templates/${encodeURIComponent(template.id)}`, {
    method: 'PUT',
    body: JSON.stringify(template),
  });
}

export function exportThemeTemplate(id: string) {
  return safeRequest<ThemeTemplate>(`${BASE}/themes/templates/${encodeURIComponent(id)}/export`);
}

export function deleteThemeTemplate(id: string) {
  return safeRequest<void>(`${BASE}/themes/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ========== 主题成就 / 时长 ==========

export type AchievementEventType =
  | 'theme.active_tick'
  | 'theme.switched'
  | 'hidden_mode.enabled'
  | 'hidden_mode.used'
  | 'node.created'
  | 'node.run_success'
  | 'resource.saved'
  | 'workflow.saved'
  | 'panorama.generated'
  | 'parsehub.resolved'
  | 'dragon_ball.collected'
  | 'dragon_ball.set_completed'
  | 'saint_seiya.cloth_collected'
  | 'saint_seiya.gold_completed'
  | 'saint_seiya.battle_won'
  | 'saint_seiya.cosmo_burst'
  | 'tetris.game_started'
  | 'tetris.line_clear'
  | 'tetris.tetris_clear'
  | 'tetris.level_reached'
  | 'tetris.chapter_completed'
  | 'tetris.clean_chapter_completed'
  | 'tetris.game_over'
  | 'farm.plot_tilled'
  | 'farm.crop_planted'
  | 'farm.crop_watered'
  | 'farm.crop_harvested'
  | 'farm.order_completed'
  | 'farm.building_placed'
  | 'farm.decor_placed'
  | 'farm.rare_crop'
  | 'farm.beauty_reward';

export interface AchievementEventPayload {
  type: AchievementEventType;
  theme?: string;
  amountSeconds?: number;
  nodeType?: string;
  kind?: string;
  mode?: string;
  category?: string;
}

export interface AchievementSummary {
  today: string;
  todaySeconds: number;
  totalActiveSeconds: number;
  achievementCount: number;
  unlockedCount: number;
  filmCount: number;
  unlockedFilmCount: number;
  recentUnlocks: AchievementDefinitionData[];
  recentFilms: AchievementUnlockedFilm[];
  dailyTasks?: AchievementDailyTask[];
  weeklyPassport?: AchievementWeeklyPassport;
  creativeReview?: AchievementCreativeReview;
  themeShowcases?: Record<string, AchievementThemeShowcase>;
}

export interface AchievementDailyTask {
  id: string;
  theme: string;
  themeLabel: string;
  accent: string;
  achievementId: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  ratio: number;
  targetKind: string;
  todaySeconds: number;
}

export interface AchievementWeeklyPassportTheme {
  theme: string;
  themeLabel: string;
  shortLabel: string;
  accent: string;
  weeklySeconds: number;
  actionCount: number;
  completed: boolean;
}

export interface AchievementWeeklyPassport {
  weekStart: string;
  weekEnd: string;
  targetThemeCount: number;
  completedThemeCount: number;
  ratio: number;
  themes: AchievementWeeklyPassportTheme[];
}

export interface AchievementCreativeReview {
  topTheme?: { theme: string; themeLabel: string; activeSeconds: number } | null;
  todayTopTheme?: { theme: string; themeLabel: string; todaySeconds: number } | null;
  weeklyActiveSeconds: number;
  weeklyThemeCount: number;
  mostUsedNodeType?: { key: string; value: number } | null;
  recentCreativeEventCount: number;
  nodesCreated: number;
  runsSucceeded: number;
  resourcesSaved: number;
  workflowsSaved: number;
  hiddenModeActivations: number;
}

export interface AchievementThemeShowcase {
  theme: string;
  themeLabel: string;
  resourcesSaved: number;
  workflowsSaved: number;
  panoramasGenerated: number;
  parseHubResolved: number;
  topCategory: string;
  topCategoryCount: number;
  lastActivityAt: string;
  hasShowcase: boolean;
}

export interface AchievementDefinitionData {
  id: string;
  theme: string;
  themeLabel: string;
  title: string;
  description: string;
  rarity: string;
  condition: Record<string, any>;
  medal?: boolean;
  hidden?: boolean;
}

export interface AchievementUnlocked {
  id: string;
  theme: string;
  title: string;
  rarity: string;
  unlockedAt: string;
  eventType?: string;
}

export interface AchievementUnlockedFilm {
  id: string;
  theme: string;
  title: string;
  unlockedAt: string;
  sourceAchievementId: string;
  hasMedia: boolean;
  status: 'awaiting-media' | string;
  lockedText?: string;
  unavailableText?: string;
  playedSeconds?: number;
  mediaUrl?: string;
  mime?: string;
  fileName?: string;
}

export interface AchievementProfile {
  schema: 't8-achievements';
  version: number;
  profileId: string;
  createdAt: string;
  updatedAt: string;
  themeStats: Record<string, any>;
  events: Array<Record<string, any>>;
  unlockedAchievements: Record<string, AchievementUnlocked>;
  claimedMedals: Record<string, any>;
  unlockedFilms: Record<string, AchievementUnlockedFilm>;
  preferences: {
    enabled: boolean;
    showToast: boolean;
    showTopBadge: boolean;
  };
}

export interface AchievementProfileData {
  profile: AchievementProfile;
  manifest: Record<string, any>;
  definitions: AchievementDefinitionData[];
  summary: AchievementSummary;
  event?: Record<string, any>;
  ignored?: boolean;
  ignoredReason?: string;
}

export function getAchievementProfile() {
  return safeRequest<AchievementProfileData>(`${BASE}/achievements/profile`);
}

export function recordAchievementEvent(payload: AchievementEventPayload) {
  return safeRequest<AchievementProfileData>(`${BASE}/achievements/event`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAchievementPreferences(payload: Partial<AchievementProfile['preferences']>) {
  return safeRequest<AchievementProfileData>(`${BASE}/achievements/preferences`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function resetAchievements() {
  return safeRequest<AchievementProfileData>(`${BASE}/achievements/reset`, { method: 'POST' });
}

export function exportAchievements() {
  return safeRequest<AchievementProfile>(`${BASE}/achievements/export`);
}

export function importAchievements(data: AchievementProfile | Record<string, any>) {
  return safeRequest<AchievementProfileData>(`${BASE}/achievements/import`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}
