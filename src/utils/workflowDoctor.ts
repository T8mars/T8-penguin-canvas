import type { Edge, Node } from '@xyflow/react';
import { EXECUTABLE_NODE_TYPES } from '../config/executableNodeTypes.ts';
import { CANVAS_NODE_SCHEMA_MANIFEST, NODE_REGISTRY } from '../config/nodeRegistry.ts';
import {
  arePortsCompatible,
  isKnownCanvasNodeType,
  resolveNodeConnectionPorts,
  type NodeConnectionPort,
} from '../config/portTypes.ts';
import type {
  CanvasOperation,
  CanvasPatch as AuthoritativeCanvasPatch,
} from '../types/project.ts';
import { validateSubflowDefinition } from './subflows.ts';

export type DoctorSeverity = 'error' | 'warning' | 'info';
export type WorkflowFixability = 'automatic' | 'manual' | 'none';
export type WorkflowLocationScope = 'canvas' | 'node' | 'edge' | 'subflow' | 'provider' | 'asset' | 'run';

export interface WorkflowApplicableVersion {
  minAppVersion: string;
  doctorSchema: 1;
}

export interface WorkflowLocation {
  scope: WorkflowLocationScope;
  nodeId?: string;
  edgeId?: string;
  entityId?: string;
  field?: string;
}

export type WorkflowEvidenceValue = string | number | boolean | null | string[] | number[];

export interface WorkflowEvidence {
  code: string;
  facts: Record<string, WorkflowEvidenceValue>;
}

export interface WorkflowDoctorRule {
  id: string;
  title: string;
  severity: DoctorSeverity;
  fixability: WorkflowFixability;
  applicableVersion: WorkflowApplicableVersion;
}

const E1_APPLICABLE_VERSION: WorkflowApplicableVersion = {
  minAppVersion: '2.5.5',
  doctorSchema: 1,
};

function doctorRule(
  id: string,
  title: string,
  severity: DoctorSeverity,
  fixability: WorkflowFixability,
): WorkflowDoctorRule {
  return { id, title, severity, fixability, applicableVersion: E1_APPLICABLE_VERSION };
}

/**
 * E1 的稳定规则目录。规则数量本身是产品契约，新增、删除或合并规则时必须显式升级文档与测试。
 */
export const WORKFLOW_DOCTOR_RULES = [
  doctorRule('topology.dangling-edge', '悬空连线', 'error', 'automatic'),
  doctorRule('topology.self-edge', '节点连接到自身', 'error', 'automatic'),
  doctorRule('topology.duplicate-edge', '重复连线', 'warning', 'automatic'),
  doctorRule('identity.duplicate-node-id', '节点 ID 重复', 'error', 'none'),
  doctorRule('registry.unknown-node-type', '未知节点类型', 'error', 'manual'),
  doctorRule('layout.invalid-position', '节点坐标无效', 'error', 'automatic'),
  doctorRule('topology.executable-without-input', '可执行节点没有上游', 'info', 'manual'),
  doctorRule('topology.output-without-input', '输出节点没有来源', 'warning', 'manual'),
  doctorRule('subflow.definition-missing', '子工作流定义缺失', 'error', 'manual'),
  doctorRule('routing.invalid-output-count', '随机路由数量无效', 'error', 'manual'),
  doctorRule('content.empty-text', '空文本节点', 'info', 'manual'),
  doctorRule('content.empty-prompt', '生成节点缺少提示词', 'warning', 'manual'),
  doctorRule('run.stale-writeback', '运行状态可能已过期', 'error', 'manual'),
  doctorRule('run.failure-evidence', '运行失败证据', 'warning', 'manual'),
  doctorRule('topology.isolated-node', '孤立节点', 'info', 'manual'),
  doctorRule('topology.cycle', '工作流存在循环依赖', 'error', 'manual'),
  doctorRule('scale.large-canvas', '大型画布', 'info', 'manual'),
  doctorRule('scale.dense-graph', '连线密度较高', 'info', 'manual'),
  doctorRule('ports.handle-unknown', '连线端口不存在', 'error', 'manual'),
  doctorRule('ports.type-incompatible', '端口类型不兼容', 'error', 'manual'),
  doctorRule('ports.capacity-exceeded', '端口连接数超限', 'error', 'manual'),
  doctorRule('ports.required-input-missing', '必需输入端口未连接', 'error', 'manual'),
  doctorRule('provider.selection-unavailable', '扩展平台不可用', 'error', 'manual'),
  doctorRule('provider.region-credential-missing', '区域凭据不完整', 'error', 'manual'),
  doctorRule('model.capability-mismatch', '模型能力与节点不匹配', 'error', 'manual'),
  doctorRule('asset.invalid', '引用素材不可用', 'error', 'manual'),
  doctorRule('subflow.version-invalid', '子工作流固定版本无效', 'error', 'manual'),
  doctorRule('limits.cost-budget-exceeded', '成本预算或日额度已达上限', 'warning', 'manual'),
  doctorRule('limits.concurrency-exceeded', '并发容量已满或超限', 'warning', 'manual'),
  doctorRule('payload.large-base64', '节点内嵌 Base64 过大', 'warning', 'manual'),
] as const satisfies readonly WorkflowDoctorRule[];

export const WORKFLOW_DOCTOR_RULE_COUNT = WORKFLOW_DOCTOR_RULES.length;

const RULES_BY_ID = new Map<string, WorkflowDoctorRule>(WORKFLOW_DOCTOR_RULES.map((rule) => [rule.id, rule]));

export type CanvasPatchDraftOperation =
  | { type: 'node.add'; node: Node }
  | { type: 'edge.add'; edge: Edge }
  | {
    type: 'node.patch';
    nodeId: string;
    /** Optional trusted type guard used by domain-specific draft producers. */
    nodeType?: string;
    patch: Record<string, unknown>;
    /** 本地不可枚举的陈旧预览前置条件。 */
    expectedPosition?: { x: number; y: number };
  }
  | { type: 'node.delete'; nodeId: string }
  | {
    type: 'edge.delete';
    edgeId: string;
    /** 本地不可枚举的陈旧预览前置条件。 */
    expectedEdge?: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null };
  };

export interface CanvasPatchDraft {
  source?: 'workflow-doctor-v1' | 'canvas-agent-plan-v1' | 'script-master-v1';
  id: string;
  title: string;
  description: string;
  operations: CanvasPatchDraftOperation[];
  diagnosticsResolved: string[];
}

export type CanvasPatchDraftInput = Omit<CanvasPatchDraft, 'diagnosticsResolved'> & {
  diagnosticsResolved?: string[];
};

/** @deprecated E1 compatibility alias. New code should use CanvasPatchDraftOperation. */
export type CanvasPatchOperation = CanvasPatchDraftOperation;
/** @deprecated E1 compatibility alias. New code should use CanvasPatchDraft. */
export type CanvasPatch = CanvasPatchDraftInput;

export interface WorkflowIssue {
  id: string;
  ruleId: string;
  severity: DoctorSeverity;
  title: string;
  detail: string;
  nodeIds: string[];
  edgeIds: string[];
  /** 原始画布定位 ID，仅供本地 UI 定位；定义为不可枚举，避免进入日志/JSON/证据。 */
  targetNodeIds?: string[];
  targetEdgeIds?: string[];
  evidence: WorkflowEvidence;
  location: WorkflowLocation;
  fixability: WorkflowFixability;
  applicableVersion: WorkflowApplicableVersion;
  patch?: CanvasPatchDraft;
}

export type WorkflowProviderNodeKind = 'image' | 'video' | 'llm';

export interface WorkflowProviderDiagnostic {
  id: string;
  source: string;
  label?: string;
  enabled: boolean;
  models?: Partial<Record<WorkflowProviderNodeKind, string[]>>;
  configuredRegion?: string;
  regionCredentialConfigured?: boolean;
}

export interface WorkflowAssetDiagnostic {
  id: string;
  availability: 'available' | 'missing' | 'corrupt' | 'unverified' | string;
  kind?: string;
  projectId?: string;
  nodeIds?: string[];
}

export interface WorkflowRunDiagnostic {
  /** 三层 ID 都来自持久化 Run 证据；不得把它们拼成一个展示 ID 或伪造 Attempt ID。 */
  runId: string;
  nodeRunId: string;
  attemptId: string;
  attemptNumber?: number;
  nodeId?: string;
  status: string;
  category?: 'platform' | 'configuration' | 'network' | 'structure' | 'unknown';
  errorKind?: string;
  errorCode?: string;
  httpStatus?: number | null;
  provider?: string;
  model?: string;
  retryable?: boolean;
  updatedAt?: number;
  /** false 时只允许展示“证据不足”，不得生成故障分类或修复。 */
  evidenceComplete: boolean;
  writebackMatchesCurrent?: boolean;
}

export interface WorkflowLiveRunDiagnostic {
  /** true 表示这是运行总线同一时刻的完整快照；缺失或 false 时不得据此判定遗留状态。 */
  complete: boolean;
  activeNodeIds: string[];
}

export interface WorkflowDoctorLimits {
  estimatedCost?: number;
  costBudget?: number;
  dailyCost?: number;
  dailyCostLimit?: number;
  activeCount?: number;
  concurrencyLimit?: number;
  allowedModels?: string[];
}

export interface WorkflowDoctorContext {
  projectId?: string;
  providers?: WorkflowProviderDiagnostic[];
  providersComplete?: boolean;
  assets?: WorkflowAssetDiagnostic[];
  runs?: WorkflowRunDiagnostic[];
  liveRun?: WorkflowLiveRunDiagnostic;
  limits?: WorkflowDoctorLimits;
  now?: number;
  largeBase64Bytes?: number;
}

export interface WorkflowDoctorCanvasHighlight {
  nodeId: string;
  severity: DoctorSeverity;
  issueCount: number;
  ruleIds: string[];
  inputPortIds: Array<string | null>;
  outputPortIds: Array<string | null>;
}

// 这些节点本身就是数据源，零上游不是异常；其余执行能力统一复用权威注册表。
const SOURCE_CAPABLE_EXECUTABLE_TYPES = new Set([
  'upload',
  'audio',
  'cinematic',
  'video-motion',
  'feishu-bitable-input',
]);

const INVALID_ASSET_AVAILABILITY = new Set(['missing', 'corrupt', 'unverified', 'project-mismatch']);
const BASE64_DATA_RE = /^data:[^;,]{1,120}(?:;[^,]{0,120})?;base64,/i;
const DEFAULT_LARGE_BASE64_BYTES = 512 * 1024;
const MAX_DIAGNOSTIC_TEXT = 240;
const MAX_WALK_ENTRIES = 20_000;
const MAX_WALK_DEPTH = 8;

function sanitizeDiagnosticText(value: unknown, maxLength = MAX_DIAGNOSTIC_TEXT) {
  return String(value ?? '')
    .replace(/data:[^;,\s]{1,120}(?:;[^,\s]{0,120})?;base64,[A-Za-z0-9+/=_-]{24,}(?:[\r\n]+[ \t]*[A-Za-z0-9+/=_-]{4,})*/gi, '[base64-data]')
    .replace(/\b(?:sk|rk|ak)-[A-Za-z0-9_-]{8,}\b/g, '[credential]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, '[credential]')
    .replace(/((?:api[_-]?key|access[_-]?key|token|secret|authorization)\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[credential]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[credential]')
    .replace(/([?&](?:api[_-]?key|token|signature|secret|authorization)=)[^&\s]+/gi, '$1[credential]')
    .replace(/\b(?=[A-Za-z0-9._~+/=-]{24,}\b)(?=[A-Za-z0-9._~+/=-]*[a-z])(?=[A-Za-z0-9._~+/=-]*[A-Z])(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]+\b/g, '[credential]')
    .replace(/\\\\[^\s\\/]+[\\/][^\s]+/g, '[path]')
    .replace(/[A-Za-z]:\\[^\r\n\t<>|"?*]*/g, '[path]')
    .replace(/(^|\s)\/(?:[^/\s]+\/)+[^\s]*/g, '$1[path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function stableTextHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function looksLikeOpaqueCredential(value: string) {
  return value.length >= 24
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}

export function workflowDisplayId(value: unknown) {
  const raw = String(value ?? '');
  const sanitized = sanitizeDiagnosticText(raw, 120);
  if (looksLikeOpaqueCredential(raw)) return `[sensitive-id]#${stableTextHash(raw)}`;
  return sanitized === raw && raw.length <= 120 ? raw : `${sanitized || '[redacted]'}#${stableTextHash(raw)}`;
}

function safeIssueId(value: unknown) {
  const raw = String(value ?? 'issue');
  if (looksLikeOpaqueCredential(raw)) return `issue-${stableTextHash(raw)}`;
  const sanitized = sanitizeDiagnosticText(raw, 160)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'issue';
  return sanitized === raw ? raw : `${sanitized}-${stableTextHash(raw)}`;
}

function patchId(prefix: string, value: string) {
  return safeIssueId(`${prefix}-${value}`);
}

function normalizedDiagnosticIds(values: readonly unknown[]) {
  return [...new Set(values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .map((value) => safeIssueId(value)))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .slice(0, 64);
}

function edgeTuple(edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>) {
  return [edge.source, edge.sourceHandle ?? null, edge.target, edge.targetHandle ?? null] as const;
}

function edgeDeleteOperation(edge: Edge): CanvasPatchDraftOperation {
  const operation: CanvasPatchDraftOperation = { type: 'edge.delete', edgeId: edge.id };
  Object.defineProperty(operation, 'expectedEdge', {
    value: {
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    },
    enumerable: false,
  });
  return operation;
}

function positionPatchOperation(node: Node, position: { x: number; y: number }): CanvasPatchDraftOperation {
  const operation: CanvasPatchDraftOperation = { type: 'node.patch', nodeId: node.id, patch: { position } };
  Object.defineProperty(operation, 'expectedPosition', {
    value: { x: node.position.x, y: node.position.y },
    enumerable: false,
  });
  return operation;
}

function safeEvidenceFacts(facts: Record<string, WorkflowEvidenceValue>): Record<string, WorkflowEvidenceValue> {
  return Object.fromEntries(Object.entries(facts).map(([key, value]) => {
    if (/(?:api[_-]?key|access[_-]?key|token|secret|authorization)/i.test(key) && typeof value === 'string') {
      return [key, value ? '[credential]' : ''];
    }
    if (typeof value === 'string') return [key, sanitizeDiagnosticText(value, 160)];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return [key, value.slice(0, 20).map((item) => sanitizeDiagnosticText(item, 120))];
    }
    if (Array.isArray(value)) return [key, value.slice(0, 20)];
    return [key, value];
  }));
}

function workflowIssue(
  ruleId: string,
  input: {
    id: string;
    detail: string;
    evidence: Record<string, WorkflowEvidenceValue>;
    location: WorkflowLocation;
    fixability?: WorkflowFixability;
    nodeIds?: string[];
    edgeIds?: string[];
    patch?: CanvasPatchDraftInput;
  },
): WorkflowIssue {
  const rule = RULES_BY_ID.get(ruleId);
  if (!rule) throw new Error(`未知工作流诊断规则: ${ruleId}`);
  const rawNodeIds = input.nodeIds || [];
  const rawEdgeIds = input.edgeIds || [];
  const resolvedPatch: CanvasPatchDraft | undefined = input.patch ? {
    ...input.patch,
    diagnosticsResolved: normalizedDiagnosticIds([...(input.patch.diagnosticsResolved || []), ruleId]),
  } : undefined;
  const result: WorkflowIssue = {
    id: safeIssueId(input.id),
    ruleId,
    severity: rule.severity,
    title: rule.title,
    detail: sanitizeDiagnosticText(input.detail),
    nodeIds: rawNodeIds.map(workflowDisplayId),
    edgeIds: rawEdgeIds.map(workflowDisplayId),
    evidence: { code: ruleId, facts: safeEvidenceFacts(input.evidence) },
    location: {
      ...input.location,
      nodeId: input.location.nodeId ? workflowDisplayId(input.location.nodeId) : undefined,
      edgeId: input.location.edgeId ? workflowDisplayId(input.location.edgeId) : undefined,
      entityId: input.location.entityId ? workflowDisplayId(input.location.entityId) : undefined,
      field: input.location.field ? sanitizeDiagnosticText(input.location.field, 160) : undefined,
    },
    fixability: input.fixability || rule.fixability,
    applicableVersion: rule.applicableVersion,
  };
  Object.defineProperties(result, {
    targetNodeIds: { value: [...rawNodeIds], enumerable: false },
    targetEdgeIds: { value: [...rawEdgeIds], enumerable: false },
    patch: { value: resolvedPatch, enumerable: false },
  });
  return result;
}

function findCycle(nodes: Node[], edges: Edge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacency = new Map([...ids].map((id) => [id, [] as string[]]));
  edges.forEach((edge) => { if (ids.has(edge.source) && ids.has(edge.target)) adjacency.get(edge.source)?.push(edge.target); });
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const pathIndex = new Map<string, number>();
  for (const start of ids) {
    if (state.get(start) === 2) continue;
    const frames: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    state.set(start, 1);
    pathIndex.set(start, path.length);
    path.push(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = adjacency.get(frame.id) || [];
      if (frame.next >= targets.length) {
        frames.pop();
        state.set(frame.id, 2);
        pathIndex.delete(frame.id);
        path.pop();
        continue;
      }
      const target = targets[frame.next];
      frame.next += 1;
      if (state.get(target) === 1) {
        const index = pathIndex.get(target);
        return [...path.slice(index == null ? 0 : index), target];
      }
      if (state.get(target) === 2) continue;
      state.set(target, 1);
      pathIndex.set(target, path.length);
      path.push(target);
      frames.push({ id: target, next: 0 });
    }
  }
  return null;
}

function providerNodeKind(node: Node): WorkflowProviderNodeKind | null {
  if (node.type === 'image') return 'image';
  if (node.type === 'video' || node.type === 'seedance') return 'video';
  if (node.type === 'llm' || node.type === 'minimax-h3-prompt-enhancer' || node.type === 'minimax-music3-prompt-enhancer' || node.type === 'minimax-h3-official-prompt-enhancer' || node.type === 'seedance20-prompt-enhancer' || node.type === 'batch-tagger') return 'llm';
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function approximateBase64Bytes(value: string) {
  const comma = value.indexOf(',');
  const payloadLength = comma >= 0 ? value.length - comma - 1 : value.length;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(payloadLength * 3 / 4) - padding);
}

function walkDiagnosticData(
  value: unknown,
  visit: (value: unknown, path: string, key: string) => void,
  path = 'data',
  depth = 0,
  state = { entries: 0 },
) {
  if (state.entries >= MAX_WALK_ENTRIES || depth > MAX_WALK_DEPTH) return;
  state.entries += 1;
  const key = path.split('.').at(-1) || path;
  visit(value, path, key);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.slice(0, 2_000).forEach((entry, index) => walkDiagnosticData(entry, visit, `${path}[${index}]`, depth + 1, state));
    return;
  }
  Object.entries(value as Record<string, unknown>).slice(0, 2_000).forEach(([childKey, entry]) => {
    walkDiagnosticData(entry, visit, `${path}.${childKey}`, depth + 1, state);
  });
}

export function collectWorkflowAssetIds(nodes: Node[]): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    // Project AssetRef 与视频编辑器内部 timeline assetId 不是同一命名空间。
    // 当前只有 Canvas 插入素材时写入的顶层 sourceAssetId 能确定指向项目素材。
    const sourceAssetId = String(((node.data || {}) as Record<string, unknown>).sourceAssetId || '').trim();
    if (sourceAssetId) ids.add(sourceAssetId);
  }
  return [...ids].filter(Boolean).sort();
}

function diagnosePorts(nodes: Node[], edges: Edge[], issues: WorkflowIssue[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const portResolutions = new Map(nodes.map((node) => [node.id, resolveNodeConnectionPorts(node)]));
  const inputPortsByNodeId = new Map<string, Map<string | null, NodeConnectionPort>>();
  const outputPortsByNodeId = new Map<string, Map<string | null, NodeConnectionPort>>();
  for (const node of nodes) {
    const resolution = portResolutions.get(node.id);
    if (!resolution?.resolved) continue;
    inputPortsByNodeId.set(node.id, new Map(resolution.inputs.map((port) => [port.id, port])));
    outputPortsByNodeId.set(node.id, new Map(resolution.outputs.map((port) => [port.id, port])));
  }
  const portEdgeKey = (nodeId: string, direction: 'inputs' | 'outputs', portId: string | null) => (
    JSON.stringify([nodeId, direction, portId])
  );
  const attachedEdgesByPort = new Map<string, Edge[]>();
  const validInputEdgesByPort = new Map<string, Edge[]>();
  const appendEdge = (map: Map<string, Edge[]>, key: string, edge: Edge) => {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  };
  for (const edge of edges) {
    appendEdge(attachedEdgesByPort, portEdgeKey(edge.source, 'outputs', edge.sourceHandle == null ? null : String(edge.sourceHandle)), edge);
    appendEdge(attachedEdgesByPort, portEdgeKey(edge.target, 'inputs', edge.targetHandle == null ? null : String(edge.targetHandle)), edge);
  }
  const unresolvedReportedNodeIds = new Set<string>();
  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) continue;
    const sourceResolution = portResolutions.get(source.id);
    const targetResolution = portResolutions.get(target.id);
    const sourceHandle = edge.sourceHandle == null ? null : String(edge.sourceHandle);
    const targetHandle = edge.targetHandle == null ? null : String(edge.targetHandle);
    const sourcePort = sourceResolution?.resolved ? outputPortsByNodeId.get(source.id)?.get(sourceHandle) : null;
    const targetPort = targetResolution?.resolved ? inputPortsByNodeId.get(target.id)?.get(targetHandle) : null;
    const unknownSource = !sourceResolution?.resolved || !sourcePort;
    const unknownTarget = !targetResolution?.resolved || !targetPort;
    const unknownSides = [
      unknownSource ? { side: 'source' as const, node: source, handle: edge.sourceHandle } : null,
      unknownTarget ? { side: 'target' as const, node: target, handle: edge.targetHandle } : null,
    ].filter((entry): entry is { side: 'source' | 'target'; node: Node; handle: string | null | undefined } => Boolean(entry));
    for (const { side, node, handle } of unknownSides) {
      if (!portResolutions.get(node.id)?.resolved) unresolvedReportedNodeIds.add(node.id);
      issues.push(workflowIssue('ports.handle-unknown', {
        id: `unknown-${side}-handle-${edge.id}`,
        detail: `连线 ${edge.id} 指向的${side === 'source' ? '输出' : '输入'}端口不存在或节点端口契约无法解析。`,
        evidence: { edgeId: edge.id, side, handle: handle == null ? '(null)' : String(handle), nodeId: node.id },
        location: { scope: 'edge', edgeId: edge.id, nodeId: node.id, field: `${side}Handle` },
        nodeIds: [node.id],
        edgeIds: [edge.id],
      }));
    }
    if (unknownSides.length > 0) continue;
    if (!sourcePort || !targetPort) continue;
    const outputs = sourcePort.kinds;
    const inputs = targetPort.kinds;
    if (!arePortsCompatible(outputs, inputs)) {
      issues.push(workflowIssue('ports.type-incompatible', {
        id: `port-type-${edge.id}`,
        detail: `连线 ${edge.id} 的输出类型与输入类型没有交集。`,
        evidence: { edgeId: edge.id, sourceKinds: outputs, targetKinds: inputs },
        location: { scope: 'edge', edgeId: edge.id },
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id],
      }));
    } else if (edge.source !== edge.target) {
      appendEdge(validInputEdgesByPort, portEdgeKey(target.id, 'inputs', targetPort.id), edge);
    }
  }

  for (const node of nodes) {
    const resolution = portResolutions.get(node.id);
    if (!resolution?.resolved) {
      if (!unresolvedReportedNodeIds.has(node.id)) {
        issues.push(workflowIssue('ports.handle-unknown', {
          id: `unresolved-port-contract-${node.id}`,
          detail: `节点 ${node.id} 的权威端口契约无法解析。`,
          evidence: {
            nodeId: node.id,
            resolver: resolution?.resolver || 'unknown',
            reason: resolution?.reason || 'node port resolution is unavailable',
          },
          location: { scope: node.type === 'subflow' ? 'subflow' : 'node', nodeId: node.id, field: 'ports' },
          nodeIds: [node.id],
        }));
      }
      continue;
    }
    for (const direction of ['inputs', 'outputs'] as const) {
      const isInput = direction === 'inputs';
      for (const port of resolution[direction]) {
        const key = portEdgeKey(node.id, direction, port.id);
        const matching = attachedEdgesByPort.get(key) || [];
        if (port.maxConnections != null && matching.length > port.maxConnections) {
          issues.push(workflowIssue('ports.capacity-exceeded', {
            id: `port-capacity-${node.id}-${direction}-${String(port.id ?? 'default')}`,
            detail: `${isInput ? '输入' : '输出'}端口 ${String(port.id ?? '(默认)')} 允许最多 ${port.maxConnections} 条连线，当前为 ${matching.length} 条。`,
            evidence: { nodeId: node.id, portId: String(port.id ?? '(null)'), direction, maximum: port.maxConnections, actual: matching.length },
            location: { scope: node.type === 'subflow' ? 'subflow' : 'node', nodeId: node.id, field: `${direction}.${String(port.id ?? 'default')}` },
            nodeIds: [node.id],
            edgeIds: matching.map((edge) => edge.id),
          }));
        }
        if (isInput) {
          const minimum = port.hasDefault ? 0 : Math.max(port.required ? 1 : 0, port.minConnections);
          const validMatching = validInputEdgesByPort.get(key) || [];
          if (minimum > 0 && validMatching.length < minimum) {
            issues.push(workflowIssue('ports.required-input-missing', {
              id: `required-port-${node.id}-${String(port.id ?? 'default')}`,
              detail: `必需输入端口 ${String(port.id ?? '(默认)')} 至少需要 ${minimum} 条有效连线，当前为 ${validMatching.length} 条。`,
              evidence: { nodeId: node.id, portId: String(port.id ?? '(null)'), minimum, actual: validMatching.length, attached: matching.length, kind: port.kinds.join('|') },
              location: { scope: node.type === 'subflow' ? 'subflow' : 'node', nodeId: node.id, field: `inputs.${String(port.id ?? 'default')}` },
              nodeIds: [node.id],
              edgeIds: matching.map((edge) => edge.id),
            }));
          }
        }
      }
    }
  }
}

function diagnoseProviders(nodes: Node[], context: WorkflowDoctorContext, issues: WorkflowIssue[]) {
  const providers = Array.isArray(context.providers) ? context.providers : [];
  const hostPolicyAvailable = Array.isArray(context.limits?.allowedModels);
  const hostAllowedModels = (context.limits?.allowedModels || []).map((model) => String(model).trim()).filter(Boolean);
  for (const node of nodes) {
    const kind = providerNodeKind(node);
    if (!kind) continue;
    const data = (node.data || {}) as Record<string, unknown>;
    const isBatchTagger = node.type === 'batch-tagger';
    const explicitProviderSource = String(data.providerSource || '').trim();
    const usesExternalProvider = !!explicitProviderSource && explicitProviderSource !== 'zhenzhen';
    const isOfficialH3Enhancer = node.type === 'minimax-h3-official-prompt-enhancer';
    const isPromptEnhancer = node.type === 'minimax-h3-prompt-enhancer' || node.type === 'minimax-music3-prompt-enhancer' || node.type === 'seedance20-prompt-enhancer';
    const selectedLlmApiSource = isOfficialH3Enhancer
      ? 'seedance-nz'
      : isPromptEnhancer
      ? (data.llmApiSource === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz')
      : data.llmApiSource;
    const isSeedanceNzLlm = (node.type === 'llm' || isPromptEnhancer || isOfficialH3Enhancer)
      && !usesExternalProvider
      && selectedLlmApiSource === 'seedance-nz';
    const source = String(
      (isBatchTagger ? data.batchTagProviderSource : undefined)
      || (isSeedanceNzLlm ? selectedLlmApiSource : undefined)
      || data.providerSource
      || '',
    ).trim();
    const providerId = String((isBatchTagger ? data.batchTagProviderId : undefined) || data.providerId || '').trim();
    const selectedModel = String(
      (isBatchTagger ? data.batchTagProviderModel : undefined)
      || data.providerModel
      || data.apiModel
      || data.model
      || '',
    ).trim();
    const policyProvider = providerId || source;
    const hostModelKeys = [selectedModel, policyProvider && selectedModel ? `${policyProvider}:${selectedModel}` : ''].filter(Boolean);
    const hostPolicyDecidable = Boolean(policyProvider) || hostAllowedModels.every((model) => !model.includes(':'));
    const hostModelAllowed = hostAllowedModels.includes('*') || hostModelKeys.some((key) => hostAllowedModels.includes(key));
    if (selectedModel && hostPolicyAvailable && hostPolicyDecidable && !hostModelAllowed) {
      issues.push(workflowIssue('model.capability-mismatch', {
        id: `host-model-policy-${node.id}`,
        detail: `模型 ${selectedModel} 不在主机代执行策略允许的模型列表中。`,
        evidence: {
          variant: 'host-policy',
          nodeId: node.id,
          providerId,
          source,
          kind,
          selectedModel,
          allowedModelCount: hostAllowedModels.length,
          policy: 'host-execution',
          configured: true,
          enabled: true,
        },
        location: { scope: 'provider', nodeId: node.id, entityId: providerId, field: isBatchTagger ? 'batchTagProviderModel' : 'providerModel' },
        nodeIds: [node.id],
      }));
    }
    if (!source || source === 'zhenzhen' || !providerId) continue;
    const provider = providers.find((item) => item.id === providerId && item.source === source);
    const models = provider?.models?.[kind] || [];
    if ((!provider && context.providersComplete === true) || (provider && (!provider.enabled || models.length === 0))) {
      issues.push(workflowIssue('provider.selection-unavailable', {
        id: `provider-unavailable-${node.id}`,
        detail: `节点保存的扩展平台 ${providerId} 当前不存在、已停用或没有 ${kind} 能力。`,
        evidence: { nodeId: node.id, providerId, source, kind, configured: Boolean(provider), enabled: provider?.enabled === true, modelCount: models.length },
        location: { scope: 'provider', nodeId: node.id, entityId: providerId, field: 'providerId' },
        nodeIds: [node.id],
      }));
      continue;
    }
    if (!provider) continue;
    if (source === 'volcengine' && (!provider.configuredRegion || provider.regionCredentialConfigured !== true)) {
      issues.push(workflowIssue('provider.region-credential-missing', {
        id: `provider-region-${node.id}`,
        detail: '火山引擎扩展平台需要明确区域和已配置的区域凭据。',
        evidence: { nodeId: node.id, providerId, regionConfigured: Boolean(provider.configuredRegion), credentialConfigured: provider.regionCredentialConfigured === true },
        location: { scope: 'provider', nodeId: node.id, entityId: providerId, field: 'regionCredential' },
        nodeIds: [node.id],
      }));
    }
    if (selectedModel && !models.includes(selectedModel)) {
      issues.push(workflowIssue('model.capability-mismatch', {
        id: `model-capability-${node.id}`,
        detail: `模型 ${selectedModel} 不在该平台明确声明的 ${kind} 模型列表中。`,
        evidence: {
          variant: 'provider-capability',
          nodeId: node.id,
          providerId,
          source,
          kind,
          selectedModel,
          allowedModelCount: models.length,
          policy: '',
          configured: true,
          enabled: provider.enabled === true,
        },
        location: { scope: 'provider', nodeId: node.id, entityId: providerId, field: isBatchTagger ? 'batchTagProviderModel' : 'providerModel' },
        nodeIds: [node.id],
      }));
    }
  }
}

function diagnoseAssets(nodes: Node[], context: WorkflowDoctorContext, issues: WorkflowIssue[]) {
  const referenced = new Set(collectWorkflowAssetIds(nodes));
  const combined = new Map<string, WorkflowAssetDiagnostic>();
  [...(Array.isArray(context.assets) ? context.assets : [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach((asset) => {
      const current = combined.get(asset.id);
      combined.set(asset.id, { ...current, ...asset, nodeIds: [...new Set([...(current?.nodeIds || []), ...(asset.nodeIds || [])])] });
    });
  for (const asset of combined.values()) {
    const projectMismatch = Boolean(context.projectId) && asset.projectId !== context.projectId;
    const availability = projectMismatch ? 'project-mismatch' : String(asset.availability || '').toLowerCase();
    if (!INVALID_ASSET_AVAILABILITY.has(availability)) continue;
    const nodeIds = [...new Set([...(asset.nodeIds || []), ...nodes
      .filter((node) => String(((node.data || {}) as Record<string, unknown>).sourceAssetId || '') === asset.id)
      .map((node) => node.id)])];
    if (!nodeIds.length && !referenced.has(asset.id)) continue;
    issues.push(workflowIssue('asset.invalid', {
      id: `asset-${availability}-${asset.id}`,
      detail: `素材 ${asset.id} 当前状态为 ${availability}，运行前需要恢复或重新选择。`,
      evidence: { assetId: asset.id, availability, kind: String(asset.kind || ''), referenceCount: nodeIds.length, projectMatch: !projectMismatch },
      location: { scope: 'asset', entityId: asset.id, nodeId: nodeIds[0] },
      nodeIds,
    }));
  }
}

function diagnoseRuns(context: WorkflowDoctorContext, issues: WorkflowIssue[]) {
  for (const run of [...(context.runs || [])].sort((a, b) => (
    String(a.runId).localeCompare(String(b.runId))
    || String(a.nodeRunId).localeCompare(String(b.nodeRunId))
    || String(a.attemptId).localeCompare(String(b.attemptId))
  ))) {
    // E4 只把完整的 Run -> NodeRun -> Attempt 引用当作权威失败证据。
    // 摘要、历史节点 data.error、截断或缺失身份均不能被提升为诊断事实。
    if (!run.evidenceComplete || !run.runId || !run.nodeRunId || !run.attemptId) continue;
    const status = String(run.status || '').toLowerCase();
    if (['failed', 'interrupted', 'error'].includes(status) || run.errorCode || run.errorKind) {
      issues.push(workflowIssue('run.failure-evidence', {
        id: `run-failure-${run.runId}-${run.nodeRunId}-${run.attemptId}`,
        detail: `Run ${run.runId} / NodeRun ${run.nodeRunId} / Attempt ${run.attemptId} 处于 ${status || 'unknown'} 状态。`,
        evidence: {
          variant: 'run',
          runId: run.runId,
          nodeRunId: run.nodeRunId,
          attemptId: run.attemptId,
          attemptNumber: Number(run.attemptNumber || 0),
          nodeId: String(run.nodeId || ''),
          status,
          category: String(run.category || 'unknown'),
          errorKind: String(run.errorKind || ''),
          errorCode: String(run.errorCode || ''),
          httpStatus: run.httpStatus == null ? null : Number(run.httpStatus),
          provider: String(run.provider || ''),
          model: String(run.model || ''),
          retryable: run.retryable === true,
          errorPresent: true,
          evidenceComplete: true,
        },
        location: { scope: 'run', entityId: run.attemptId, nodeId: run.nodeId },
        nodeIds: run.nodeId ? [run.nodeId] : [],
      }));
    }
    if (run.writebackMatchesCurrent === false) {
      issues.push(workflowIssue('run.stale-writeback', {
        id: `stale-writeback-${run.runId}-${run.nodeRunId}-${run.attemptId}`,
        detail: '上游任务携带的执行令牌与当前节点令牌不一致，结果必须丢弃。',
        evidence: {
          variant: 'writeback-token',
          runId: run.runId,
          nodeRunId: run.nodeRunId,
          attemptId: run.attemptId,
          nodeId: String(run.nodeId || ''),
          storedStatus: '',
          tokenMatch: false,
          activeInLiveSnapshot: null,
        },
        location: { scope: 'run', entityId: run.attemptId, nodeId: run.nodeId, field: 'executionToken' },
        nodeIds: run.nodeId ? [run.nodeId] : [],
      }));
    }
  }
}

function diagnoseLimits(context: WorkflowDoctorContext, issues: WorkflowIssue[]) {
  const limits = context.limits || {};
  const estimatedCost = finiteNumber(limits.estimatedCost);
  const costBudget = finiteNumber(limits.costBudget);
  if (estimatedCost != null && costBudget != null && costBudget >= 0 && estimatedCost > costBudget) {
    issues.push(workflowIssue('limits.cost-budget-exceeded', {
      id: 'cost-budget-exceeded',
      detail: `预计成本 ${estimatedCost} 超过明确预算 ${costBudget}。`,
      evidence: {
        variant: 'per-run',
        estimatedCost,
        costBudget,
        dailyCost: null,
        dailyCostLimit: null,
        projectedDailyCost: null,
        excess: estimatedCost - costBudget,
        atCapacity: false,
      },
      location: { scope: 'canvas', field: 'limits.costBudget' },
    }));
  }
  const dailyCost = finiteNumber(limits.dailyCost);
  const dailyCostLimit = finiteNumber(limits.dailyCostLimit);
  const projectedDailyCost = dailyCost == null ? null : dailyCost + Math.max(0, estimatedCost || 0);
  if (dailyCost != null && dailyCostLimit != null && dailyCostLimit > 0
    && (dailyCost >= dailyCostLimit || (projectedDailyCost != null && projectedDailyCost > dailyCostLimit))) {
    issues.push(workflowIssue('limits.cost-budget-exceeded', {
      id: 'daily-cost-limit-reached',
      detail: projectedDailyCost != null && projectedDailyCost > dailyCostLimit
        ? `本次预计成本会使今日主机代执行成本达到 ${projectedDailyCost}，超过上限 ${dailyCostLimit}。`
        : `今日主机代执行成本 ${dailyCost} 已达到或超过上限 ${dailyCostLimit}。`,
      evidence: {
        variant: 'daily',
        estimatedCost,
        costBudget: null,
        dailyCost,
        dailyCostLimit,
        projectedDailyCost,
        excess: Math.max(0, (projectedDailyCost ?? dailyCost) - dailyCostLimit),
        atCapacity: dailyCost >= dailyCostLimit,
      },
      location: { scope: 'canvas', field: 'limits.dailyCostLimit' },
    }));
  }
  const activeCount = finiteNumber(limits.activeCount);
  const concurrencyLimit = finiteNumber(limits.concurrencyLimit);
  if (activeCount != null && concurrencyLimit != null && concurrencyLimit > 0 && activeCount >= concurrencyLimit) {
    issues.push(workflowIssue('limits.concurrency-exceeded', {
      id: 'concurrency-limit-exceeded',
      detail: `活动任务 ${activeCount} 个，已达到或超过明确并发上限 ${concurrencyLimit}。`,
      evidence: { activeCount, concurrencyLimit, atCapacity: true, excess: Math.max(0, activeCount - concurrencyLimit) },
      location: { scope: 'canvas', field: 'limits.concurrencyLimit' },
    }));
  }
}

function diagnoseLargeBase64(nodes: Node[], context: WorkflowDoctorContext, issues: WorkflowIssue[]) {
  const threshold = Math.max(64 * 1024, finiteNumber(context.largeBase64Bytes) || DEFAULT_LARGE_BASE64_BYTES);
  for (const node of nodes) {
    const oversized: Array<{ path: string; bytes: number }> = [];
    walkDiagnosticData(node.data || {}, (value, path) => {
      if (typeof value !== 'string' || !BASE64_DATA_RE.test(value)) return;
      const bytes = approximateBase64Bytes(value);
      if (bytes >= threshold && oversized.length < 20) oversized.push({ path, bytes });
    });
    if (!oversized.length) continue;
    issues.push(workflowIssue('payload.large-base64', {
      id: `large-base64-${node.id}`,
      detail: `节点内有 ${oversized.length} 个大 Base64 字段，最大约 ${Math.max(...oversized.map((entry) => entry.bytes)).toLocaleString()} 字节。`,
      evidence: {
        nodeId: node.id,
        fieldCount: oversized.length,
        fields: oversized.map((entry) => entry.path),
        maxBytes: Math.max(...oversized.map((entry) => entry.bytes)),
        thresholdBytes: threshold,
      },
      location: { scope: 'node', nodeId: node.id, field: oversized[0].path },
      nodeIds: [node.id],
    }));
  }
}

function ensureUniqueIssueIds(issues: WorkflowIssue[]) {
  const occurrences = new Map<string, number>();
  for (const issue of issues) {
    const occurrence = (occurrences.get(issue.id) || 0) + 1;
    occurrences.set(issue.id, occurrence);
    if (occurrence > 1) issue.id = safeIssueId(`${issue.id}-${occurrence}`);
  }
  return issues;
}

const PUBLIC_SUBFLOW_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}@[1-9]\d*$/;

function localSubflowFixedRef(node: Node, projectId?: string) {
  if (node.type !== 'subflow') return '';
  const data = (node.data || {}) as Record<string, unknown>;
  const definitionId = String(data.definitionId || '').trim();
  const definitionVersion = Number(data.definitionVersion);
  const definitionProjectId = String(data.definitionProjectId || projectId || '').trim();
  if (!definitionId
    || !Number.isSafeInteger(definitionVersion)
    || definitionVersion < 1
    || (projectId && definitionProjectId && definitionProjectId !== projectId)) return '';
  const ref = `${definitionId}@${definitionVersion}`;
  return PUBLIC_SUBFLOW_REF_PATTERN.test(ref) ? ref : '';
}

/**
 * 只接受通过 Canvas Agent 摘要验证后的 validateCanvas.data，并只映射权威递归依赖循环。
 * 远端 targetId 永远不用于本地定位；定位由当前 revision 的固定 definitionId/version 重新建立。
 */
export function workflowIssuesFromCanvasAgentValidation(
  rawValidation: unknown,
  nodes: Node[],
  projectId?: string,
): WorkflowIssue[] {
  if (!rawValidation || typeof rawValidation !== 'object' || Array.isArray(rawValidation)) return [];
  const diagnostics = (rawValidation as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length > 200) return [];
  const nodesByRootRef = new Map<string, string[]>();
  for (const node of nodes) {
    const ref = localSubflowFixedRef(node, projectId);
    if (!ref) continue;
    nodesByRootRef.set(ref, [...(nodesByRootRef.get(ref) || []), node.id]);
  }
  const issues: WorkflowIssue[] = [];
  for (const rawDiagnostic of diagnostics) {
    if (!rawDiagnostic || typeof rawDiagnostic !== 'object' || Array.isArray(rawDiagnostic)) continue;
    const diagnostic = rawDiagnostic as Record<string, unknown>;
    if (diagnostic.severity !== 'error'
      || diagnostic.targetType !== 'subflow'
      || !diagnostic.facts
      || typeof diagnostic.facts !== 'object'
      || Array.isArray(diagnostic.facts)) continue;
    const facts = diagnostic.facts as Record<string, unknown>;
    const rootRefs = Array.isArray(facts.rootRefs)
      ? facts.rootRefs.filter((value): value is string => typeof value === 'string' && PUBLIC_SUBFLOW_REF_PATTERN.test(value)).slice(0, 20)
      : [];
    if (rootRefs.length === 0) continue;
    const targetNodeIds = [...new Set(rootRefs.flatMap((ref) => nodesByRootRef.get(ref) || []))].sort();
    if (targetNodeIds.length === 0) continue;
    if (diagnostic.ruleId === 'topology.cycle' && facts.variant === 'subflow-dependency') {
      const cycleRefs = Array.isArray(facts.cycleRefs)
        ? facts.cycleRefs.filter((value): value is string => typeof value === 'string' && PUBLIC_SUBFLOW_REF_PATTERN.test(value)).slice(0, 20)
        : [];
      if (cycleRefs.length < 2 || cycleRefs[0] !== cycleRefs[cycleRefs.length - 1]) continue;
      const definitionCount = Number(facts.definitionCount);
      const maxDepth = Number(facts.maxDepth);
      issues.push(workflowIssue('topology.cycle', {
        id: `subflow-dependency-cycle-${stableTextHash(cycleRefs.join('\u0000'))}`,
        detail: `固定版本子工作流依赖形成循环：${cycleRefs.join(' → ')}`,
        evidence: {
          variant: 'subflow-dependency',
          rootRefs,
          cycleRefs,
          definitionCount: Number.isSafeInteger(definitionCount) && definitionCount >= 0 ? definitionCount : 0,
          maxDepth: Number.isSafeInteger(maxDepth) && maxDepth > 0 ? maxDepth : 0,
        },
        location: { scope: 'subflow', nodeId: targetNodeIds[0], field: 'definitionDependencies' },
        nodeIds: targetNodeIds,
      }));
      continue;
    }
    if (diagnostic.ruleId !== 'subflow.version-invalid') continue;
    const variant = String(facts.variant || '');
    if (![
      'subflow-dependency-limit',
      'subflow-dependency-unavailable',
      'subflow-dependency-pin-mismatch',
      'subflow-dependency-depth-limit',
    ].includes(variant)) continue;
    const dependencyRef = typeof facts.dependencyRef === 'string' && PUBLIC_SUBFLOW_REF_PATTERN.test(facts.dependencyRef)
      ? facts.dependencyRef
      : '';
    const definitionRef = typeof facts.definitionRef === 'string' && PUBLIC_SUBFLOW_REF_PATTERN.test(facts.definitionRef)
      ? facts.definitionRef
      : '';
    const maximum = Number(facts.maximum);
    const safeMaximum = Number.isSafeInteger(maximum) && maximum > 0 ? maximum : 0;
    if ((variant === 'subflow-dependency-limit' || variant === 'subflow-dependency-depth-limit') && safeMaximum === 0) continue;
    const detail = variant === 'subflow-dependency-limit'
      ? `固定版本子工作流依赖超过 ${safeMaximum} 项，权威验证已失败关闭。`
      : variant === 'subflow-dependency-depth-limit'
        ? `固定版本子工作流依赖展开超过 ${safeMaximum} 层${definitionRef ? `（${definitionRef}）` : ''}，权威验证已失败关闭。`
        : variant === 'subflow-dependency-pin-mismatch'
          ? `固定版本子工作流依赖不满足权威版本契约${definitionRef ? `（${definitionRef}）` : ''}。`
          : dependencyRef
            ? `嵌套子工作流固定版本 ${dependencyRef} 不存在或不属于当前项目。`
            : '固定版本子工作流依赖仓储暂不可用，权威验证已失败关闭。';
    issues.push(workflowIssue('subflow.version-invalid', {
      id: `subflow-dependency-invalid-${stableTextHash(JSON.stringify([
        variant,
        rootRefs,
        dependencyRef,
        definitionRef,
        safeMaximum,
      ]))}`,
      detail,
      evidence: {
        variant,
        rootRefs,
        dependencyRef,
        definitionRef,
        maximum: safeMaximum,
      },
      location: { scope: 'subflow', nodeId: targetNodeIds[0], field: 'definitionDependencies' },
      nodeIds: targetNodeIds,
    }));
  }
  return ensureUniqueIssueIds(issues);
}

function doctorSeverityRank(severity: DoctorSeverity) {
  return severity === 'error' ? 3 : severity === 'warning' ? 2 : 1;
}

function sortedPortIds(values: Set<string | null>) {
  return [...values].sort((left, right) => {
    if (left == null) return right == null ? 0 : -1;
    if (right == null) return 1;
    return left.localeCompare(right);
  });
}

/**
 * 把诊断结果转换成纯临时画布标记；不返回节点 data，也不参与保存、历史或 Patch。
 */
export function buildWorkflowDoctorCanvasHighlights(
  issues: readonly WorkflowIssue[],
  edges: readonly Edge[],
): WorkflowDoctorCanvasHighlight[] {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const highlights = new Map<string, {
    severity: DoctorSeverity;
    issueIds: Set<string>;
    ruleIds: Set<string>;
    inputPortIds: Set<string | null>;
    outputPortIds: Set<string | null>;
  }>();
  const ensure = (nodeId: string, issue: WorkflowIssue) => {
    const current = highlights.get(nodeId);
    if (current) {
      if (doctorSeverityRank(issue.severity) > doctorSeverityRank(current.severity)) current.severity = issue.severity;
      current.issueIds.add(issue.id);
      current.ruleIds.add(issue.ruleId);
      return current;
    }
    const created = {
      severity: issue.severity,
      issueIds: new Set([issue.id]),
      ruleIds: new Set([issue.ruleId]),
      inputPortIds: new Set<string | null>(),
      outputPortIds: new Set<string | null>(),
    };
    highlights.set(nodeId, created);
    return created;
  };

  for (const issue of issues) {
    const rawNodeIds = [...new Set(issue.targetNodeIds || issue.nodeIds || [])];
    rawNodeIds.forEach((nodeId) => ensure(nodeId, issue));
    const rawEdgeIds = [...new Set(issue.targetEdgeIds || issue.edgeIds || [])];
    for (const edgeId of rawEdgeIds) {
      const edge = edgeById.get(edgeId);
      if (!edge) continue;
      ensure(edge.source, issue).outputPortIds.add(edge.sourceHandle == null ? null : String(edge.sourceHandle));
      ensure(edge.target, issue).inputPortIds.add(edge.targetHandle == null ? null : String(edge.targetHandle));
    }
    const portId = issue.evidence.facts.portId;
    const direction = issue.evidence.facts.direction;
    if (typeof portId === 'string' && rawNodeIds.length > 0) {
      const normalizedPortId = portId === '(null)' ? null : portId;
      const target = ensure(rawNodeIds[0], issue);
      if (direction === 'inputs') target.inputPortIds.add(normalizedPortId);
      if (direction === 'outputs') target.outputPortIds.add(normalizedPortId);
    }
  }

  return [...highlights.entries()]
    .map(([nodeId, highlight]) => ({
      nodeId,
      severity: highlight.severity,
      issueCount: highlight.issueIds.size,
      ruleIds: [...highlight.ruleIds].sort(),
      inputPortIds: sortedPortIds(highlight.inputPortIds),
      outputPortIds: sortedPortIds(highlight.outputPortIds),
    }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export function analyzeWorkflow(nodes: Node[], edges: Edge[], context: WorkflowDoctorContext = {}): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeIdCounts = new Map<string, number>();
  const edgeIdCounts = new Map<string, number>();
  nodes.forEach((node) => nodeIdCounts.set(node.id, (nodeIdCounts.get(node.id) || 0) + 1));
  edges.forEach((edge) => edgeIdCounts.set(edge.id, (edgeIdCounts.get(edge.id) || 0) + 1));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    const repairTargetUnique = edgeIdCounts.get(edge.id) === 1;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(workflowIssue('topology.dangling-edge', {
        id: `dangling-edge-${edge.id}`,
        detail: `连线 ${edge.id} 的起点或终点已不存在。`,
        evidence: { edgeId: edge.id, sourceExists: nodeIds.has(edge.source), targetExists: nodeIds.has(edge.target), repairTargetUnique },
        location: { scope: 'edge', edgeId: edge.id },
        edgeIds: [edge.id],
        fixability: repairTargetUnique ? 'automatic' : 'none',
        patch: repairTargetUnique
          ? { id: patchId('remove-edge', edge.id), title: '删除悬空连线', description: '只删除这条失效连线。', operations: [edgeDeleteOperation(edge)] }
          : undefined,
      }));
      continue;
    }
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) || 0) + 1);
    if (edge.source === edge.target) {
      issues.push(workflowIssue('topology.self-edge', {
        id: `self-edge-${edge.id}`,
        detail: '自连接会让拓扑运行无法结束。',
        evidence: { edgeId: edge.id, nodeId: edge.source, repairTargetUnique },
        location: { scope: 'edge', edgeId: edge.id, nodeId: edge.source },
        nodeIds: [edge.source],
        edgeIds: [edge.id],
        fixability: repairTargetUnique ? 'automatic' : 'none',
        patch: repairTargetUnique
          ? { id: patchId('remove-self-edge', edge.id), title: '删除自连接', description: '删除该节点指向自己的连线。', operations: [edgeDeleteOperation(edge)] }
          : undefined,
      }));
    }
  }

  const edgeSignatures = new Map<string, Edge[]>();
  edges.forEach((edge) => {
    const signature = JSON.stringify(edgeTuple(edge));
    edgeSignatures.set(signature, [...(edgeSignatures.get(signature) || []), edge]);
  });
  edgeSignatures.forEach((duplicates) => {
    if (duplicates.length < 2) return;
    const redundant = duplicates.slice(1);
    const repairTargetsUnique = redundant.every((edge) => edgeIdCounts.get(edge.id) === 1);
    issues.push(workflowIssue('topology.duplicate-edge', {
      id: `duplicate-edge-${duplicates[0].id}`,
      detail: `同一端口连接了 ${duplicates.length} 次。`,
      evidence: { keptEdgeId: duplicates[0].id, redundantEdgeIds: redundant.map((edge) => edge.id), count: duplicates.length, repairTargetsUnique },
      location: { scope: 'edge', edgeId: duplicates[0].id },
      nodeIds: [duplicates[0].source, duplicates[0].target],
      edgeIds: redundant.map((edge) => edge.id),
      fixability: repairTargetsUnique ? 'automatic' : 'none',
      patch: repairTargetsUnique
        ? { id: patchId('dedupe-edge', duplicates[0].id), title: '保留一条连线', description: '删除重复连线，保留最早的一条。', operations: redundant.map(edgeDeleteOperation) }
        : undefined,
    }));
  });

  const seenNodeIds = new Map<string, number>();
  for (const node of nodes) {
    const data = (node.data || {}) as Record<string, unknown>;
    const occurrence = (seenNodeIds.get(node.id) || 0) + 1;
    if (occurrence > 1) {
      issues.push(workflowIssue('identity.duplicate-node-id', {
        id: `duplicate-node-${node.id}-${occurrence}`,
        detail: `节点 ${node.id} 出现多次，必须重新导入或重建。`,
        evidence: { nodeId: node.id, occurrence, totalOccurrences: nodeIdCounts.get(node.id) || occurrence },
        location: { scope: 'node', nodeId: node.id, field: 'id' },
        nodeIds: [node.id],
      }));
    }
    seenNodeIds.set(node.id, occurrence);
    if (!isKnownCanvasNodeType(node.type)) {
      issues.push(workflowIssue('registry.unknown-node-type', {
        id: `unknown-type-${node.id}`,
        detail: `节点类型 ${node.type || '(空)'} 未注册，可能来自缺失插件或旧版本。`,
        evidence: { nodeId: node.id, nodeType: String(node.type || '') },
        location: { scope: 'node', nodeId: node.id, field: 'type' },
        nodeIds: [node.id],
      }));
    }
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
      const repairTargetUnique = nodeIdCounts.get(node.id) === 1;
      issues.push(workflowIssue('layout.invalid-position', {
        id: `invalid-position-${node.id}`,
        detail: '节点坐标不是有限数值，可能无法显示。',
        evidence: { nodeId: node.id, xFinite: Number.isFinite(node.position?.x), yFinite: Number.isFinite(node.position?.y), repairTargetUnique },
        location: { scope: 'node', nodeId: node.id, field: 'position' },
        nodeIds: [node.id],
        fixability: repairTargetUnique ? 'automatic' : 'none',
        patch: repairTargetUnique
          ? { id: patchId('position', node.id), title: '重置节点坐标', description: '把节点移回画布原点附近。', operations: [positionPatchOperation(node, { x: 80, y: 80 })] }
          : undefined,
      }));
    }
    if (EXECUTABLE_NODE_TYPES.has(String(node.type))
      && (incoming.get(node.id) || 0) === 0
      && !SOURCE_CAPABLE_EXECUTABLE_TYPES.has(String(node.type))) {
      issues.push(workflowIssue('topology.executable-without-input', {
        id: `no-input-${node.id}`,
        detail: '这可能是独立生成节点，也可能漏接了输入。',
        evidence: { nodeId: node.id, nodeType: String(node.type || ''), incoming: 0 },
        location: { scope: 'node', nodeId: node.id, field: 'incomingEdges' },
        nodeIds: [node.id],
      }));
    }
    if (node.type === 'output' && (incoming.get(node.id) || 0) === 0) {
      issues.push(workflowIssue('topology.output-without-input', {
        id: `empty-output-${node.id}`,
        detail: '该输出节点不会收到任何素材。',
        evidence: { nodeId: node.id, incoming: 0 },
        location: { scope: 'node', nodeId: node.id, field: 'incomingEdges' },
        nodeIds: [node.id],
      }));
    }
    if (node.type === 'subflow') {
      const definition = data.definition as Record<string, unknown> | undefined;
      if (!definition || typeof definition !== 'object') {
        issues.push(workflowIssue('subflow.definition-missing', {
          id: `subflow-missing-${node.id}`,
          detail: '固定版本定义没有嵌入节点，当前实例无法运行。',
          evidence: { nodeId: node.id, definitionPresent: false },
          location: { scope: 'subflow', nodeId: node.id, field: 'definition' },
          nodeIds: [node.id],
        }));
      } else {
        const definitionId = String(data.definitionId || definition.id || '').trim();
        const embeddedId = String(definition.id || '').trim();
        const rawVersion = data.definitionVersion ?? definition.version;
        const version = Number(rawVersion);
        const embeddedVersion = Number(definition.version);
        const referenceProjectId = String(data.definitionProjectId || '').trim();
        const embeddedProjectId = String(definition.projectId || '').trim();
        const invalid = !definitionId
          || !Number.isInteger(version)
          || version < 1
          || !embeddedId
          || embeddedId !== definitionId
          || !Number.isInteger(embeddedVersion)
          || embeddedVersion !== version
          || (Boolean(referenceProjectId) && Boolean(embeddedProjectId) && referenceProjectId !== embeddedProjectId);
        if (invalid) {
          issues.push(workflowIssue('subflow.version-invalid', {
            id: `subflow-version-${node.id}`,
            detail: '实例固定的 definitionId/version 与内嵌不可变定义不一致。',
            evidence: { nodeId: node.id, definitionId, embeddedId, version: Number.isFinite(version) ? version : -1, embeddedVersion: Number.isFinite(embeddedVersion) ? embeddedVersion : -1, referenceProjectId, embeddedProjectId },
            location: { scope: 'subflow', nodeId: node.id, field: 'definitionVersion' },
            nodeIds: [node.id],
          }));
        }
      }
    }
    if (node.type === 'random-route') {
      const total = Number(data.totalOutputs ?? data.total_outputs);
      const pass = Number(data.randomPassCount ?? data.random_pass_count);
      if (!Number.isFinite(total) || total < 1 || !Number.isFinite(pass) || pass < 1 || pass > total) {
        issues.push(workflowIssue('routing.invalid-output-count', {
          id: `random-route-count-${node.id}`,
          detail: '随机运行数量必须介于 1 和输出口总数之间。',
          evidence: { nodeId: node.id, total: Number.isFinite(total) ? total : -1, pass: Number.isFinite(pass) ? pass : -1 },
          location: { scope: 'node', nodeId: node.id, field: 'randomPassCount' },
          nodeIds: [node.id],
        }));
      }
    }
    if (node.type === 'text' && !String(data.text || data.prompt || '').trim()) {
      issues.push(workflowIssue('content.empty-text', {
        id: `empty-text-${node.id}`,
        detail: '文本节点没有内容。',
        evidence: { nodeId: node.id, contentLength: 0 },
        location: { scope: 'node', nodeId: node.id, field: 'text' },
        nodeIds: [node.id],
      }));
    }
    if ((node.type === 'image' || node.type === 'video') && !String(data.prompt || '').trim() && (incoming.get(node.id) || 0) === 0) {
      issues.push(workflowIssue('content.empty-prompt', {
        id: `empty-prompt-${node.id}`,
        detail: '节点既没有本地提示词，也没有上游输入。',
        evidence: { nodeId: node.id, promptLength: 0, incoming: 0 },
        location: { scope: 'node', nodeId: node.id, field: 'prompt' },
        nodeIds: [node.id],
      }));
    }
    if ((incoming.get(node.id) || 0) === 0 && (outgoing.get(node.id) || 0) === 0 && nodes.length > 1) {
      issues.push(workflowIssue('topology.isolated-node', {
        id: `isolated-${node.id}`,
        detail: '该节点与画布中的其他节点没有连线。',
        evidence: { nodeId: node.id, incoming: 0, outgoing: 0 },
        location: { scope: 'node', nodeId: node.id },
        nodeIds: [node.id],
      }));
    }
  }

  diagnosePorts(nodes, edges, issues);
  diagnoseProviders(nodes, context, issues);
  diagnoseAssets(nodes, context, issues);
  diagnoseRuns(context, issues);
  if (context.liveRun?.complete === true) {
    const activeNodeIds = new Set(context.liveRun.activeNodeIds || []);
    for (const node of nodes) {
      const storedStatus = String(((node.data || {}) as Record<string, unknown>).status || '').toLowerCase();
      if (!['running', 'generating', 'submitting', 'polling'].includes(storedStatus) || activeNodeIds.has(node.id)) continue;
      issues.push(workflowIssue('run.stale-writeback', {
        id: `stale-running-${node.id}`,
        detail: '完整运行总线快照中没有该节点，画布保存的活动状态属于遗留状态。',
        evidence: {
          variant: 'stored-status',
          runId: '',
          nodeId: node.id,
          storedStatus,
          tokenMatch: null,
          upstreamTaskPresent: false,
          activeInLiveSnapshot: false,
        },
        location: { scope: 'node', nodeId: node.id, field: 'data.status' },
        nodeIds: [node.id],
      }));
    }
  }
  diagnoseLimits(context, issues);
  diagnoseLargeBase64(nodes, context, issues);

  const cycle = findCycle(nodes, edges);
  if (cycle) {
    issues.unshift(workflowIssue('topology.cycle', {
      id: 'workflow-cycle',
      detail: `循环路径：${cycle.join(' → ')}`,
      evidence: { cycleNodeIds: [...new Set(cycle)], edgeCount: Math.max(0, cycle.length - 1) },
      location: { scope: 'canvas', nodeId: cycle[0] },
      nodeIds: [...new Set(cycle)],
    }));
  }
  if (nodes.length > 250) {
    issues.push(workflowIssue('scale.large-canvas', {
      id: 'large-canvas',
      detail: `${nodes.length} 个节点可能影响交互性能，建议按阶段封装子工作流。`,
      evidence: { nodeCount: nodes.length, threshold: 250 },
      location: { scope: 'canvas', field: 'nodes' },
    }));
  }
  if (edges.length > nodes.length * 3 && nodes.length > 10) {
    issues.push(workflowIssue('scale.dense-graph', {
      id: 'dense-graph',
      detail: '建议检查重复数据流，或使用子工作流降低阅读负担。',
      evidence: { nodeCount: nodes.length, edgeCount: edges.length, threshold: nodes.length * 3 },
      location: { scope: 'canvas', field: 'edges' },
    }));
  }
  return ensureUniqueIssueIds(issues);
}

export const CANVAS_PATCH_DRAFT_MAX_OPERATIONS = 100;

export interface MaterializeCanvasPatchDraftOptions {
  projectId: string;
  canvasId: string;
  baseRevision: number;
  diagnosticsResolved?: readonly string[];
}

function stablePatchHash(value: string) {
  return `${stableTextHash(`canvas-patch-a:${value}`)}${stableTextHash(`canvas-patch-b:${value}`)}`;
}

function safeAuthoritativeIdentity(value: unknown, label: string) {
  const identity = String(value ?? '');
  if (!identity || identity.length > 160
    || looksLikeOpaqueCredential(identity)
    || sanitizeDiagnosticText(identity, 161) !== identity) {
    throw new Error(`CanvasPatchDraft 包含不安全的${label}`);
  }
  return identity;
}

function materializeDraftOperation(
  operation: CanvasPatchDraftOperation,
  source: CanvasPatchDraft['source'],
  projectId: string,
): Pick<CanvasOperation, 'type' | 'payload'> {
  if (!operation || typeof operation !== 'object') {
    throw new Error('CanvasPatchDraft 包含不支持的操作');
  }
  if (source === 'script-master-v1' && operation.type !== 'node.add' && operation.type !== 'node.patch') {
    throw new Error('剧本大师下游草案只允许新增或更新受控节点');
  }
  if (operation.type === 'edge.delete') {
    return {
      type: 'edge.delete',
      payload: { edgeId: safeAuthoritativeIdentity(operation.edgeId, '连线 ID') },
    };
  }
  if (operation.type === 'node.delete') {
    return {
      type: 'node.delete',
      payload: { nodeId: safeAuthoritativeIdentity(operation.nodeId, '节点 ID') },
    };
  }
  if (operation.type === 'node.patch') {
    if (source === 'script-master-v1') {
      const nodeType = safeScriptMasterDownstreamNodeType(operation.nodeType);
      const patchKeys = operation.patch && typeof operation.patch === 'object' && !Array.isArray(operation.patch)
        ? Object.keys(operation.patch)
        : [];
      const data = operation.patch?.data;
      if (patchKeys.length !== 1 || patchKeys[0] !== 'data' || !data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`剧本大师下游节点 ${nodeType} 只允许更新公开 data`);
      }
      assertCanvasAgentPlanJson(data, `scriptMaster.${nodeType}.data`);
      return {
        type: 'node.patch',
        payload: {
          nodeId: safeAuthoritativeIdentity(operation.nodeId, '节点 ID'),
          dataPatch: JSON.parse(JSON.stringify(data)),
        },
      };
    }
    const patchKeys = operation.patch && typeof operation.patch === 'object' && !Array.isArray(operation.patch)
      ? Object.keys(operation.patch)
      : [];
    const position = operation.patch?.position;
    const positionKeys = position && typeof position === 'object' && !Array.isArray(position)
      ? Object.keys(position)
      : [];
    if (patchKeys.length !== 1 || patchKeys[0] !== 'position'
      || positionKeys.length !== 2 || !positionKeys.includes('x') || !positionKeys.includes('y')) {
      throw new Error('CanvasPatchDraft 的 node.patch 只允许修改有限坐标');
    }
    const rawX = (position as { x?: unknown }).x;
    const rawY = (position as { y?: unknown }).y;
    if (typeof rawX !== 'number' || typeof rawY !== 'number' || !Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      throw new Error('CanvasPatchDraft 的 node.patch 只允许修改有限坐标');
    }
    const x = Object.is(rawX, -0) ? 0 : rawX;
    const y = Object.is(rawY, -0) ? 0 : rawY;
    return {
      type: 'node.move',
      payload: {
        nodeId: safeAuthoritativeIdentity(operation.nodeId, '节点 ID'),
        position: { x, y },
      },
    };
  }
  if (operation.type === 'node.add') {
    if (source === 'script-master-v1') {
      const rawNode = operation.node;
      if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) throw new Error('剧本大师下游节点无效');
      if (Object.keys(rawNode).some((key) => !['data', 'id', 'position', 'type'].includes(key))) {
        throw new Error('剧本大师下游节点包含未定义字段');
      }
      const id = safeAuthoritativeIdentity(rawNode.id, '节点 ID');
      const type = safeScriptMasterDownstreamNodeType(rawNode.type);
      const position = rawNode.position;
      if (!position || typeof position !== 'object'
        || typeof position.x !== 'number' || typeof position.y !== 'number'
        || !Number.isFinite(position.x) || !Number.isFinite(position.y)
        || Math.abs(position.x) > 1_000_000 || Math.abs(position.y) > 1_000_000) {
        throw new Error('剧本大师下游节点坐标无效');
      }
      const data = rawNode.data && typeof rawNode.data === 'object' && !Array.isArray(rawNode.data)
        ? rawNode.data as Record<string, unknown>
        : {};
      if (!Object.keys(data).length) throw new Error(`剧本大师下游节点 ${type} 缺少 data`);
      assertCanvasAgentPlanJson(data, `scriptMaster.${type}.data`);
      return {
        type: 'node.add',
        payload: {
          node: {
            id,
            type,
            position: { x: Object.is(position.x, -0) ? 0 : position.x, y: Object.is(position.y, -0) ? 0 : position.y },
            data: JSON.parse(JSON.stringify(data)),
          },
        },
      };
    }
    if (source !== 'canvas-agent-plan-v1') throw new Error('CanvasPatchDraft 的 node.add 仅允许来自版本化 Agent 计划');
    const rawNode = operation.node;
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) throw new Error('Agent 计划节点无效');
    const nodeKeys = Object.keys(rawNode).sort();
    if (nodeKeys.some((key) => !['data', 'id', 'position', 'type'].includes(key))) throw new Error('Agent 计划节点包含未定义字段');
    const id = safeAuthoritativeIdentity(rawNode.id, '节点 ID');
    const type = safeAuthoritativeIdentity(rawNode.type, '节点类型');
    const schema = CANVAS_NODE_SCHEMA_MANIFEST.types.find((item) => item.type === type);
    if (!schema || schema.hidden === true || schema.generatable !== true) throw new Error(`Agent 计划不允许生成节点类型: ${type}`);
    const position = rawNode.position;
    if (!position || typeof position !== 'object'
      || typeof position.x !== 'number' || typeof position.y !== 'number'
      || !Number.isFinite(position.x) || !Number.isFinite(position.y)
      || Math.abs(position.x) > 1_000_000 || Math.abs(position.y) > 1_000_000) {
      throw new Error('Agent 计划节点坐标无效');
    }
    const data = rawNode.data && typeof rawNode.data === 'object' && !Array.isArray(rawNode.data)
      ? rawNode.data as Record<string, unknown>
      : {};
    const allowedDataFields = schema.generation.allowedDataFields || {};
    if (Object.keys(data).some((key) => !Object.prototype.hasOwnProperty.call(allowedDataFields, key))) {
      throw new Error(`Agent 计划节点 ${type} 包含未授权 data 字段`);
    }
    assertCanvasAgentPlanJson(data, `node.${type}.data`);
    for (const [key, value] of Object.entries(data)) {
      assertCanvasAgentPlanField(value, allowedDataFields[key] || {}, `node.${type}.data.${key}`);
    }
    if (type === 'subflow') {
      const definition = data.definition;
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Agent 子工作流节点缺少固定定义');
      validateSubflowDefinition(definition as any, {
        maxDepth: 8,
        maxNodes: 2000,
        maxEdges: 4000,
        knownNodeTypes: new Set(NODE_REGISTRY.map((item) => item.type)),
      });
      const typedDefinition = definition as { id?: unknown; version?: unknown; projectId?: unknown };
      if (String(data.definitionId || '') !== String(typedDefinition.id || '')
        || Number(data.definitionVersion) !== Number(typedDefinition.version)
        || (typedDefinition.projectId && String(typedDefinition.projectId) !== projectId)) {
        throw new Error('Agent 子工作流固定引用与定义不一致');
      }
    }
    return {
      type: 'node.add',
      payload: {
        node: {
          id,
          type,
          position: { x: Object.is(position.x, -0) ? 0 : position.x, y: Object.is(position.y, -0) ? 0 : position.y },
          data: JSON.parse(JSON.stringify(data)),
        },
      },
    };
  }
  if (operation.type === 'edge.add') {
    if (source !== 'canvas-agent-plan-v1') throw new Error('CanvasPatchDraft 的 edge.add 仅允许来自版本化 Agent 计划');
    const rawEdge = operation.edge;
    if (!rawEdge || typeof rawEdge !== 'object' || Array.isArray(rawEdge)) throw new Error('Agent 计划连线无效');
    if (Object.keys(rawEdge).some((key) => !['id', 'source', 'sourceHandle', 'target', 'targetHandle'].includes(key))) {
      throw new Error('Agent 计划连线包含未定义字段');
    }
    return {
      type: 'edge.add',
      payload: {
        edge: {
          id: safeAuthoritativeIdentity(rawEdge.id, '连线 ID'),
          source: safeAuthoritativeIdentity(rawEdge.source, '源节点 ID'),
          target: safeAuthoritativeIdentity(rawEdge.target, '目标节点 ID'),
          ...(rawEdge.sourceHandle == null ? {} : { sourceHandle: safeAuthoritativeIdentity(rawEdge.sourceHandle, '源端口 ID') }),
          ...(rawEdge.targetHandle == null ? {} : { targetHandle: safeAuthoritativeIdentity(rawEdge.targetHandle, '目标端口 ID') }),
        },
      },
    };
  }
  throw new Error('CanvasPatchDraft 包含不支持的操作');
}

const AGENT_PLAN_PRIVATE_KEY = /(?:api[_-]?key|authorization|cookie|password|passwd|passphrase|private[_-]?key|client[_-]?secret|secret|credential|access[_-]?token|refresh[_-]?token|session[_-]?token|signature|managed[_-]?path|source[_-]?path|executable[_-]?path)$/i;
const AGENT_PLAN_LOCAL_PATH = /(?:^|[\s"'`=,:;?&#])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|var|private|mnt|workspace)(?:\/|$))/i;
const SCRIPT_MASTER_DOWNSTREAM_NODE_TYPES = new Set(['story', 'director-storyboard', 'seedance', 'audio', 'video-edit']);

function safeScriptMasterDownstreamNodeType(value: unknown): string {
  const type = safeAuthoritativeIdentity(value, '节点类型');
  if (!SCRIPT_MASTER_DOWNSTREAM_NODE_TYPES.has(type)) throw new Error(`剧本大师不允许写入节点类型: ${type}`);
  return type;
}

function assertCanvasAgentPlanJson(value: unknown, path: string, depth = 0, state = { nodes: 0, chars: 0, seen: new WeakSet<object>() }) {
  state.nodes += 1;
  if (state.nodes > 2000 || depth > 12) throw new Error('Agent 计划 JSON 结构超过限制');
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Agent 计划 ${path} 包含非有限数值`);
    return;
  }
  if (typeof value === 'string') {
    state.chars += value.length;
    if (value.length > 16 * 1024 || state.chars > 256 * 1024) throw new Error('Agent 计划文本超过限制');
    if (/data:[^;,\s]+;base64,/i.test(value) || AGENT_PLAN_LOCAL_PATH.test(value)
      || /\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b/i.test(value)
      || /[?&](?:api[_-]?key|token|signature|secret|authorization)=/i.test(value)) {
      throw new Error(`Agent 计划 ${path} 包含不可公开内容`);
    }
    return;
  }
  if (typeof value !== 'object' || value instanceof ArrayBuffer) throw new Error(`Agent 计划 ${path} 不是 JSON 值`);
  const object = value as object;
  if (state.seen.has(object)) throw new Error('Agent 计划不能包含循环引用');
  state.seen.add(object);
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error(`Agent 计划 ${path} 数组超过限制`);
    value.forEach((item, index) => assertCanvasAgentPlanJson(item, `${path}[${index}]`, depth + 1, state));
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 200) throw new Error(`Agent 计划 ${path} 字段超过限制`);
    for (const [key, item] of entries) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || AGENT_PLAN_PRIVATE_KEY.test(key)) {
        throw new Error(`Agent 计划 ${path} 包含私有字段`);
      }
      assertCanvasAgentPlanJson(item, `${path}.${key}`, depth + 1, state);
    }
  }
  state.seen.delete(object);
}

function assertCanvasAgentPlanField(value: unknown, schema: Record<string, unknown>, path: string) {
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > Number(schema.maxLength || 16_384)) throw new Error(`Agent 计划 ${path} 不符合字符串 Schema`);
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`Agent 计划 ${path} 不在允许枚举中`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || Number(value) < Number(schema.minimum || 0)) throw new Error(`Agent 计划 ${path} 不符合整数 Schema`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > Number(schema.maxItems ?? 100)) throw new Error(`Agent 计划 ${path} 不符合数组 Schema`);
    return;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > Number(schema.maxProperties || 100)) {
      throw new Error(`Agent 计划 ${path} 不符合对象 Schema`);
    }
    return;
  }
  if (schema.type === 'subflow-definition' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`Agent 计划 ${path} 不符合子工作流定义 Schema`);
  }
}

interface CanvasAgentConnectionPort {
  id: string | null;
  kinds: string[];
}

function canvasAgentNodeConnectionPorts(node: Node, direction: 'inputs' | 'outputs'): CanvasAgentConnectionPort[] {
  const resolution = resolveNodeConnectionPorts(node);
  if (!resolution.resolved) {
    throw new Error(`Agent 计划节点 ${String(node.type || '')} 缺少精确连接 Schema`);
  }
  const ports = resolution[direction];
  return ports.map((port) => ({
    id: port.id,
    kinds: [...port.kinds],
  }));
}

function validateCanvasAgentDraftTopology(draft: CanvasPatchDraftInput) {
  if (draft.source !== 'canvas-agent-plan-v1') return;
  const addedNodes = new Map<string, { node: Node; operationIndex: number }>();
  draft.operations.forEach((operation, operationIndex) => {
    if (operation.type !== 'node.add') return;
    const nodeId = safeAuthoritativeIdentity(operation.node?.id, '节点 ID');
    if (addedNodes.has(nodeId)) throw new Error(`Agent 计划包含重复节点 ID: ${workflowDisplayId(nodeId)}`);
    addedNodes.set(nodeId, { node: operation.node, operationIndex });
  });
  const edgeIds = new Set<string>();
  const edgeTuples = new Set<string>();
  const adjacency = new Map([...addedNodes.keys()].map((id) => [id, [] as string[]]));
  const indegree = new Map([...addedNodes.keys()].map((id) => [id, 0]));
  draft.operations.forEach((operation, operationIndex) => {
    if (operation.type !== 'edge.add') return;
    const edge = operation.edge;
    const edgeId = safeAuthoritativeIdentity(edge?.id, '连线 ID');
    const source = safeAuthoritativeIdentity(edge?.source, '源节点 ID');
    const target = safeAuthoritativeIdentity(edge?.target, '目标节点 ID');
    if (edgeIds.has(edgeId)) throw new Error(`Agent 计划包含重复连线 ID: ${workflowDisplayId(edgeId)}`);
    edgeIds.add(edgeId);
    const sourceNode = addedNodes.get(source);
    const targetNode = addedNodes.get(target);
    if (!sourceNode || !targetNode) throw new Error('Agent 计划连线只能连接同一受控计划中新增的节点');
    if (sourceNode.operationIndex >= operationIndex || targetNode.operationIndex >= operationIndex) {
      throw new Error('Agent 计划必须先新增节点，再新增连线');
    }
    if (source === target) throw new Error('Agent 计划不能创建自连接');
    const sourceHandle = edge.sourceHandle == null ? null : safeAuthoritativeIdentity(edge.sourceHandle, '源端口 ID');
    const targetHandle = edge.targetHandle == null ? null : safeAuthoritativeIdentity(edge.targetHandle, '目标端口 ID');
    const sourcePort = canvasAgentNodeConnectionPorts(sourceNode.node, 'outputs').find((port) => port.id === sourceHandle);
    const targetPort = canvasAgentNodeConnectionPorts(targetNode.node, 'inputs').find((port) => port.id === targetHandle);
    if (!sourcePort || !targetPort) throw new Error(`Agent 计划连线 ${workflowDisplayId(edgeId)} 使用了未定义端口`);
    const compatible = sourcePort.kinds.includes('any') || targetPort.kinds.includes('any')
      || sourcePort.kinds.some((kind) => targetPort.kinds.includes(kind));
    if (!compatible) throw new Error(`Agent 计划连线 ${workflowDisplayId(edgeId)} 的端口类型不兼容`);
    const tuple = JSON.stringify([source, sourceHandle, target, targetHandle]);
    if (edgeTuples.has(tuple)) throw new Error(`Agent 计划包含重复连线: ${workflowDisplayId(edgeId)}`);
    edgeTuples.add(tuple);
    adjacency.get(source)!.push(target);
    indegree.set(target, (indegree.get(target) || 0) + 1);
  });
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let visited = 0;
  while (queue.length) {
    const nodeId = queue.shift()!;
    visited += 1;
    for (const target of adjacency.get(nodeId) || []) {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== addedNodes.size) throw new Error('Agent 计划不能包含循环依赖');
}

/**
 * Converts a local E1 doctor draft into the complete E2 wire protocol without
 * copying display text, credentials, paths, or other arbitrary node data.
 */
export function materializeCanvasPatchDraft(
  draft: CanvasPatchDraftInput,
  options: MaterializeCanvasPatchDraftOptions,
): AuthoritativeCanvasPatch {
  if (!draft || typeof draft !== 'object') throw new Error('CanvasPatchDraft 必须是对象');
  if (!options || typeof options !== 'object') throw new Error('CanvasPatch 物化选项必须是对象');
  if (!Number.isSafeInteger(options.baseRevision) || options.baseRevision < 1) {
    throw new Error('CanvasPatch baseRevision 必须是正安全整数');
  }
  const projectId = safeAuthoritativeIdentity(options.projectId, '项目 ID');
  const canvasId = safeAuthoritativeIdentity(options.canvasId, '画布 ID');
  if (!Array.isArray(draft.operations) || draft.operations.length === 0) {
    throw new Error('CanvasPatchDraft operations 不能为空');
  }
  if (draft.operations.length > CANVAS_PATCH_DRAFT_MAX_OPERATIONS) {
    throw new Error(`CanvasPatchDraft operations 不能超过 ${CANVAS_PATCH_DRAFT_MAX_OPERATIONS} 条`);
  }
  validateCanvasAgentDraftTopology(draft);
  const diagnosticsResolved = normalizedDiagnosticIds(
    options.diagnosticsResolved ?? draft.diagnosticsResolved ?? [],
  );
  const materialized = draft.operations.map((operation) => materializeDraftOperation(operation, draft.source, projectId));
  const stableEnvelope = JSON.stringify({
    schema: 't8-canvas-patch-v1',
    projectId,
    canvasId,
    baseRevision: options.baseRevision,
    diagnosticsResolved,
    operations: materialized,
  });
  const idPrefix = draft.source === 'canvas-agent-plan-v1'
    ? 'agent-plan-patch'
    : draft.source === 'script-master-v1'
      ? 'script-master-patch'
      : 'doctor-patch';
  const id = `${idPrefix}-${stablePatchHash(stableEnvelope)}`;
  const operations: CanvasOperation[] = materialized.map((operation, index) => ({
    opId: `${id}-op-${String(index + 1).padStart(3, '0')}`,
    projectId,
    canvasId,
    actorId: '',
    sessionId: '',
    baseRevision: options.baseRevision,
    clientSeq: index,
    timestamp: index + 1,
    type: operation.type,
    payload: operation.payload,
  }));
  return {
    schema: 't8-canvas-patch-v1',
    id,
    baseRevision: options.baseRevision,
    summary: draft.source === 'canvas-agent-plan-v1'
      ? `Canvas Agent 生成计划：${operations.length} 个受控操作`
      : `工作流医生确定性修复：${operations.length} 个操作，${diagnosticsResolved.length} 项诊断`,
    operations,
    diagnosticsResolved,
    requiresConfirmation: true,
  };
}

export function applyCanvasPatchDraft(nodes: Node[], edges: Edge[], canvasPatch: CanvasPatchDraftInput) {
  const originalNodeIds = new Set(nodes.map((node) => node.id));
  const originalDanglingCounts = new Map<string, number>();
  for (const edge of edges) {
    if (originalNodeIds.has(edge.source) && originalNodeIds.has(edge.target)) continue;
    const key = JSON.stringify([edge.id, ...edgeTuple(edge)]);
    originalDanglingCounts.set(key, (originalDanglingCounts.get(key) || 0) + 1);
  }
  let nextNodes = nodes.map((node) => ({ ...node, data: { ...(node.data || {}) } }));
  let nextEdges = edges.map((edge) => ({ ...edge }));
  for (const operation of canvasPatch.operations) {
    if (operation.type === 'node.add') {
      if (nextNodes.some((node) => node.id === operation.node.id)) throw new Error(`新增节点已存在: ${workflowDisplayId(operation.node.id)}`);
      nextNodes.push({ ...operation.node, data: { ...(operation.node.data || {}) } });
    }
    if (operation.type === 'edge.add') {
      if (nextEdges.some((edge) => edge.id === operation.edge.id)) throw new Error(`新增连线已存在: ${workflowDisplayId(operation.edge.id)}`);
      if (!nextNodes.some((node) => node.id === operation.edge.source) || !nextNodes.some((node) => node.id === operation.edge.target)) {
        throw new Error(`新增连线端点不存在: ${workflowDisplayId(operation.edge.id)}`);
      }
      nextEdges.push({ ...operation.edge });
    }
    if (operation.type === 'edge.delete') {
      const matchingEdges = nextEdges.filter((edge) => edge.id === operation.edgeId);
      if (matchingEdges.length === 0) throw new Error(`修复目标连线不存在: ${workflowDisplayId(operation.edgeId)}`);
      if (matchingEdges.length > 1) throw new Error(`修复目标连线不唯一: ${workflowDisplayId(operation.edgeId)}`);
      if (operation.expectedEdge) {
        const expected = operation.expectedEdge;
        const actual = matchingEdges[0];
        const matchesPreview = actual.source === expected.source
          && actual.target === expected.target
          && (actual.sourceHandle ?? null) === expected.sourceHandle
          && (actual.targetHandle ?? null) === expected.targetHandle;
        if (!matchesPreview) throw new Error(`修复预览已过期，连线已变化: ${workflowDisplayId(operation.edgeId)}`);
      }
      nextEdges = nextEdges.filter((edge) => edge.id !== operation.edgeId);
    }
    if (operation.type === 'node.delete') {
      const matches = nextNodes.filter((node) => node.id === operation.nodeId).length;
      if (matches === 0) throw new Error(`修复目标节点不存在: ${workflowDisplayId(operation.nodeId)}`);
      if (matches > 1) throw new Error(`修复目标节点不唯一: ${workflowDisplayId(operation.nodeId)}`);
      nextNodes = nextNodes.filter((node) => node.id !== operation.nodeId);
      nextEdges = nextEdges.filter((edge) => edge.source !== operation.nodeId && edge.target !== operation.nodeId);
    }
    if (operation.type === 'node.patch') {
      const matchingNodes = nextNodes.filter((node) => node.id === operation.nodeId);
      if (matchingNodes.length === 0) throw new Error(`修复目标节点不存在: ${workflowDisplayId(operation.nodeId)}`);
      if (matchingNodes.length > 1) throw new Error(`修复目标节点不唯一: ${workflowDisplayId(operation.nodeId)}`);
      if (Object.prototype.hasOwnProperty.call(operation.patch, 'id')) {
        throw new Error(`确定性修复不允许修改节点 ID: ${workflowDisplayId(operation.nodeId)}`);
      }
      if (operation.expectedPosition
        && (!Object.is(matchingNodes[0].position.x, operation.expectedPosition.x)
          || !Object.is(matchingNodes[0].position.y, operation.expectedPosition.y))) {
        throw new Error(`修复预览已过期，节点位置已变化: ${workflowDisplayId(operation.nodeId)}`);
      }
      nextNodes = nextNodes.map((node) => node.id === operation.nodeId ? {
        ...node,
        ...operation.patch,
        data: operation.patch.data && typeof operation.patch.data === 'object' ? { ...(node.data || {}), ...(operation.patch.data as object) } : node.data,
      } as Node : node);
    }
  }
  const ids = new Set(nextNodes.map((node) => node.id));
  const remainingOriginalDangling = new Map(originalDanglingCounts);
  for (const edge of nextEdges) {
    if (ids.has(edge.source) && ids.has(edge.target)) continue;
    const key = JSON.stringify([edge.id, ...edgeTuple(edge)]);
    const originalCount = remainingOriginalDangling.get(key) || 0;
    if (originalCount > 0) {
      remainingOriginalDangling.set(key, originalCount - 1);
      continue;
    }
    throw new Error(`修复会产生悬空连线: ${workflowDisplayId(edge.id)}`);
  }
  return { nodes: nextNodes, edges: nextEdges };
}

/** @deprecated E1 compatibility alias. Use applyCanvasPatchDraft for local draft previews. */
export function applyCanvasPatch(nodes: Node[], edges: Edge[], canvasPatch: CanvasPatchDraftInput) {
  return applyCanvasPatchDraft(nodes, edges, canvasPatch);
}

export function planCanvasAgentRequest(prompt: string, issues: WorkflowIssue[]): CanvasPatchDraft | null {
  const text = prompt.trim().toLowerCase();
  if (!text) return null;
  const fixable = issues.filter((item) => item.patch && item.fixability === 'automatic');
  const keywordsByRule: Partial<Record<string, string[]>> = {
    'topology.dangling-edge': ['悬空连线', '失效连线'],
    'topology.self-edge': ['自连接', '自连'],
    'topology.duplicate-edge': ['重复连线'],
    'layout.invalid-position': ['节点坐标', '节点位置', '坐标无效', '位置无效'],
  };
  const explicitlyScopedRules = new Set<string>();
  const addExplicitScope = (ruleId: string, scopePattern: RegExp) => {
    if (scopePattern.test(text)) explicitlyScopedRules.add(ruleId);
  };
  addExplicitScope('layout.invalid-position', /(?:(?:只|仅).{0,8}(?:节点)?(?:坐标|位置)|(?:不要|别|无需|不需|不修复|不处理|不修改).{0,12}(?:(?:节点)?(?:坐标|位置).{0,4}以外|除.{0,6}(?:节点)?(?:坐标|位置).{0,4}之外))/);
  addExplicitScope('topology.duplicate-edge', /(?:(?:只|仅).{0,8}重复连线|(?:不要|别|无需|不需|不修复|不处理|不修改).{0,12}(?:重复连线.{0,4}以外|除.{0,6}重复连线.{0,4}之外))/);
  addExplicitScope('topology.dangling-edge', /(?:(?:只|仅).{0,8}(?:悬空|失效)连线|(?:不要|别|无需|不需|不修复|不处理|不修改).{0,12}(?:(?:悬空|失效)连线.{0,4}以外|除.{0,6}(?:悬空|失效)连线.{0,4}之外))/);
  addExplicitScope('topology.self-edge', /(?:(?:只|仅).{0,8}(?:自连接|自连)|(?:不要|别|无需|不需|不修复|不处理|不修改).{0,12}(?:(?:自连接|自连).{0,4}以外|除.{0,6}(?:自连接|自连).{0,4}之外))/);
  const explicitlyExcludedRules = new Set<string>();
  if (explicitlyScopedRules.size === 0) {
    const addExcludedScope = (ruleId: string, scopePattern: RegExp) => {
      if (scopePattern.test(text)) explicitlyExcludedRules.add(ruleId);
    };
    addExcludedScope('layout.invalid-position', /(?:(?:除了?|除).{0,6}(?:节点)?(?:坐标|位置)|(?:节点)?(?:坐标|位置).{0,4}(?:以外|除外))/);
    addExcludedScope('topology.duplicate-edge', /(?:(?:除了?|除).{0,6}重复连线|重复连线.{0,4}(?:以外|除外))/);
    addExcludedScope('topology.dangling-edge', /(?:(?:除了?|除).{0,6}(?:悬空|失效)连线|(?:悬空|失效)连线.{0,4}(?:以外|除外))/);
    addExcludedScope('topology.self-edge', /(?:(?:除了?|除).{0,6}(?:自连接|自连)|(?:自连接|自连).{0,4}(?:以外|除外))/);
  }
  const negatesAll = /(?:不要|别|无需|不需|不修复|不处理|不修改).{0,10}(?:全部|所有|\ball\b)/i.test(text);
  const wantsAll = explicitlyScopedRules.size === 0
    && !negatesAll
    && (explicitlyExcludedRules.size > 0 || /全部|所有|\ball\b/i.test(text));
  const excludesEdges = explicitlyScopedRules.size === 0
    && /(?:不要|别|无需|不需|不修复|不修改|不处理).{0,8}(?:连线|边)/.test(text);
  const excludesNodes = explicitlyScopedRules.size === 0
    && /(?:不要|别|无需|不需|不修复|不修改|不处理).{0,8}(?:节点|坐标|位置)/.test(text);
  const selected = (explicitlyScopedRules.size > 0
    ? fixable.filter((item) => explicitlyScopedRules.has(item.ruleId))
    : wantsAll ? fixable : fixable.filter((item) => {
    const rawTargetIds = item.targetNodeIds || [];
    const keywords = keywordsByRule[item.ruleId] || [];
    return text.includes(item.title.toLowerCase())
      || text.includes(item.ruleId.toLowerCase())
      || item.nodeIds.some((id) => text.includes(id.toLowerCase()))
      || rawTargetIds.some((id) => text.includes(String(id).toLowerCase()))
      || keywords.some((keyword) => text.includes(keyword));
  })).filter((item) => {
    if (explicitlyExcludedRules.has(item.ruleId)) return false;
    const operations = item.patch?.operations || [];
    if (excludesEdges && operations.every((operation) => operation.type === 'edge.delete')) return false;
    if (excludesNodes && operations.every((operation) => operation.type !== 'edge.delete')) return false;
    return true;
  });
  const operations: CanvasPatchDraftOperation[] = [];
  const seenOperations = new Set<string>();
  for (const operation of selected.flatMap((item) => item.patch?.operations || [])) {
    let signature: string;
    if (operation.type === 'edge.delete') {
      signature = JSON.stringify([operation.type, operation.edgeId]);
    } else if (operation.type === 'edge.add') {
      signature = JSON.stringify([operation.type, operation.edge.id]);
    } else if (operation.type === 'node.add') {
      signature = JSON.stringify([operation.type, operation.node.id]);
    } else {
      signature = JSON.stringify([
        operation.type,
        operation.nodeId,
        operation.type === 'node.patch' ? operation.patch : null,
      ]);
    }
    if (seenOperations.has(signature)) continue;
    seenOperations.add(signature);
    operations.push(operation);
  }
  if (!operations.length) return null;
  return {
    id: `agent-${Date.now()}`,
    title: `Canvas Agent：修复 ${selected.length} 项`,
    description: '由确定性诊断规则生成；应用前仍需人工确认。',
    operations,
    diagnosticsResolved: normalizedDiagnosticIds(selected.flatMap((item) => [
      item.ruleId,
      ...(item.patch?.diagnosticsResolved || []),
    ])),
  };
}
