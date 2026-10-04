import { CANVAS_NODE_SCHEMA_MANIFEST } from '../config/nodeRegistry.ts';
import { resolveNewMediaNodeData, type MediaNodeDefaults } from './mediaNodeDefaults.ts';
import { sha256Hex } from './incrementalSha256.ts';
import type { SubflowDefinition } from './subflows.ts';
import { validateSubflowDefinition } from './subflows.ts';
import {
  materializeCanvasPatchDraft,
  planCanvasAgentRequest,
  type CanvasPatchDraft,
  type WorkflowIssue,
  type WorkflowRunDiagnostic,
} from './workflowDoctor.ts';

export const CANVAS_AGENT_TOOL_NAMES = [
  'inspectCanvas',
  'inspectNodeSchema',
  'inspectRun',
  'searchAssets',
  'searchSubflows',
  'validateCanvas',
  'simulateExecutionPlan',
  'estimateRun',
] as const;

export type CanvasAgentToolName = typeof CANVAS_AGENT_TOOL_NAMES[number];
export type CanvasAgentStage = 'explain' | 'generate' | 'preview' | 'apply';
export type CanvasAgentPlanMode = 'doctor-repair' | 'reuse-subflow' | 'registered-fallback' | 'unresolved';
export type CanvasAgentPlanStatus = 'ready-for-validation' | 'ready' | 'blocked';
export type CanvasAgentQueueStatus = 'queued' | 'previewing' | 'previewed' | 'applying' | 'applied' | 'stale' | 'failed';
export type CanvasAgentIntent = 'repair' | 'image' | 'video' | 'audio' | 'llm' | 'ambiguous' | 'unknown';

export type RunEvidenceCategory = 'platform' | 'configuration' | 'network' | 'structure' | 'unknown';

export interface RunEvidenceRef {
  runId: string;
  nodeRunId: string;
  attemptId: string;
}

export interface CanvasAgentRunEvidenceFinding {
  id: string;
  ref: RunEvidenceRef;
  runId: string;
  nodeRunId: string;
  attemptId: string;
  nodeId: string;
  attemptNumber: number;
  status: string;
  category: RunEvidenceCategory;
  confidence: 'high' | 'medium' | 'low';
  reasonCode: string;
  summary: string;
  provider: string;
  model: string;
  error: {
    kind: string;
    code: string;
    httpStatus: number | null;
    retryable: boolean;
  };
  timestamp: number;
}

export interface CanvasAgentRunEvidenceInspection {
  schema: 't8-run-evidence-inspection-v1';
  id: string;
  canvasId: string;
  canvasRevision: number;
  status: string;
  selection: {
    runId: string;
    nodeRunId: string | null;
    attemptId: string | null;
  };
  totals: { nodeRuns: number; attempts: number };
  returned: { nodeRuns: number; attempts: number };
  hasMore: { nodeRuns: boolean; attempts: boolean };
  evidenceComplete: boolean;
  evidenceReasons: string[];
  diagnosis: {
    schema: 't8-run-evidence-diagnosis-v1';
    outcome: 'failed' | 'recovered' | 'succeeded' | 'active' | 'no-failure-evidence' | 'insufficient';
    primaryCategory: RunEvidenceCategory | null;
    totalFindings: number;
    truncated: boolean;
    findings: CanvasAgentRunEvidenceFinding[];
    repairPolicy: {
      mode: 'canvas-patch-preview-required' | 'suggestion-only';
      agentMayEditCredentials: false;
      requiresStructuredPreview: true;
      requiresExplicitConfirmation: true;
    };
  };
  nodeRuns: unknown[];
  truncated: boolean;
}

export interface CanvasAgentExecutionProposal {
  schema: 't8-canvas-agent-execution-proposal-v1';
  baseRevision: number;
  operations: Array<
    | {
      type: 'node.add';
      node: {
        id: string;
        type: string;
        position: { x: number; y: number };
        subflowRef?: { definitionId: string; version: number; revision: number };
      };
    }
    | {
      type: 'edge.add';
      edge: {
        id: string;
        source: string;
        target: string;
        sourceHandle?: string;
        targetHandle?: string;
      };
    }
    | { type: 'node.delete'; nodeId: string }
    | { type: 'edge.delete'; edgeId: string }
    | { type: 'node.patch'; nodeId: string; position: { x: number; y: number } }
  >;
}

export interface CanvasAgentToolInputMap {
  inspectCanvas: { nodeOffset?: number; edgeOffset?: number; nodeLimit?: number; edgeLimit?: number };
  inspectNodeSchema: { type?: string; nodeId?: string; offset?: number; limit?: number; includeHidden?: boolean };
  inspectRun: { runId?: string; nodeRunId?: string; attemptId?: string };
  searchAssets: { query?: string; kind?: 'image' | 'video' | 'audio' | 'model3d' | 'text' | 'other'; limit?: number; offset?: number };
  searchSubflows: { query?: string; limit?: number; offset?: number };
  validateCanvas: Record<string, never>;
  simulateExecutionPlan: { proposal?: CanvasAgentExecutionProposal };
  estimateRun: { proposal?: CanvasAgentExecutionProposal };
}

export interface CanvasAgentToolRequest<K extends CanvasAgentToolName = CanvasAgentToolName> {
  tool: K;
  requestId: string;
  projectId: string;
  canvasId: string;
  input: CanvasAgentToolInputMap[K];
}

export interface CanvasAgentToolResult<K extends CanvasAgentToolName = CanvasAgentToolName> {
  schema: 't8-canvas-agent-tool-result-v1';
  tool: K;
  requestId: string;
  projectId: string;
  canvasId: string;
  canvasRevision: number;
  actorId: string;
  role: string;
  authority: {
    advisoryOnly: boolean;
    canPreviewCanvasPatch: true;
    canApplyCanvasPatch: boolean;
    canManageHostCredentials: false;
    credentialVisibility: 'configured-state-only';
  };
  nodeSchemaDigest: string;
  readOnly: true;
  truncated: boolean;
  data: unknown;
  digest: string;
}

export interface CanvasAgentSubflowCandidate {
  id: string;
  version: number;
  revision: number;
  name: string;
  description: string;
  category: string;
  tags: string[];
  inputs: Array<{ id: string; name: string; kind: string; required: boolean }>;
  outputs: Array<{ id: string; name: string; kind: string; required: boolean }>;
  requiredCapabilities: string[];
  nodeCount: number;
  edgeCount: number;
  safeForPlan: true;
}

export interface CanvasAgentRankedSubflowCandidate {
  rank: number;
  candidate: CanvasAgentSubflowCandidate;
  score: number;
  eligible: boolean;
  intentMatched: boolean;
  intent: CanvasAgentIntent;
  promptTerms: string[];
  matchedTerms: string[];
}

export const CANVAS_AGENT_SUBFLOW_RELEVANCE_THRESHOLD = 40;

export interface CanvasAgentExplanation {
  intent: CanvasAgentIntent;
  title: string;
  summary: string;
  willSearchSubflowsFirst: true;
  willRequirePreviewAndConfirmation: true;
}

export interface CanvasAgentWorkflowPlan {
  schema: 't8-workflow-generation-plan-v1';
  planId: string;
  projectId: string;
  canvasId: string;
  baseRevision: number;
  generation: number;
  promptDigest: string;
  graphDigest: string;
  nodeSchemaDigest: string;
  mode: CanvasAgentPlanMode;
  status: CanvasAgentPlanStatus;
  title: string;
  explanation: string;
  subflowSearch: {
    completed: true;
    query: string;
    intent: CanvasAgentIntent;
    promptTerms: string[];
    total: number;
    eligibleTotal: number;
    ranking: Array<{
      rank: number;
      id: string;
      version: number;
      revision: number;
      score: number;
      eligible: boolean;
      matchedTerms: string[];
    }>;
    selected: null | { id: string; version: number; revision: number; name: string };
  };
  stages: Array<{
    id: 'search-subflows' | 'compile-plan' | 'validate' | 'simulate' | 'estimate';
    status: 'completed' | 'pending' | 'blocked' | 'unavailable';
    summary: string;
  }>;
  toolDigests: Partial<Record<CanvasAgentToolName, string>>;
  validation: unknown;
  simulation: unknown;
  estimate: unknown;
  runEvidence: null | {
    ref: RunEvidenceRef;
    complete: boolean;
    outcome: CanvasAgentRunEvidenceInspection['diagnosis']['outcome'];
    primaryCategory: RunEvidenceCategory | null;
    findingCount: number;
  };
  unresolved: string[];
  patchDraft?: CanvasPatchDraft;
  digest: string;
}

export interface CanvasAgentPatchQueueItem {
  schema: 't8-canvas-agent-patch-queue-item-v1';
  id: string;
  projectId: string;
  canvasId: string;
  baseRevision: number;
  generation: number;
  graphDigest: string;
  nodeSchemaDigest: string;
  planDigest: string;
  selectedSubflow: CanvasAgentWorkflowPlan['subflowSearch']['selected'];
  status: CanvasAgentQueueStatus;
  draft: CanvasPatchDraft;
  previewDigest?: string;
  error?: string;
}

export interface CanvasAgentToolTrace {
  tool: CanvasAgentToolName;
  requestId: string;
  status: 'pending' | 'succeeded' | 'unavailable' | 'failed';
  digest?: string;
  message?: string;
}

export interface BuildCanvasAgentWorkflowPlanInput {
  mediaNodeDefaults?: MediaNodeDefaults;
  prompt: string;
  projectId: string;
  canvasId: string;
  baseRevision: number;
  generation: number;
  graphDigest: string;
  nodeSchemaDigest: string;
  currentNodes?: ReadonlyArray<{ id?: unknown; type?: unknown; position?: { x?: unknown; y?: unknown } }>;
  currentEdges?: ReadonlyArray<{ id?: unknown }>;
  issues?: WorkflowIssue[];
  subflowQuery: string;
  subflowCandidates?: CanvasAgentSubflowCandidate[];
  resolvedSubflow?: SubflowDefinition | null;
  validation?: unknown;
  simulation?: unknown;
  estimate?: unknown;
  runEvidence?: CanvasAgentRunEvidenceInspection | null;
  toolDigests?: Partial<Record<CanvasAgentToolName, string>>;
}

const AGENT_RESULT_KEYS = new Set([
  'schema', 'tool', 'requestId', 'projectId', 'canvasId', 'canvasRevision', 'actorId', 'role',
  'authority', 'nodeSchemaDigest', 'readOnly', 'truncated', 'data', 'digest',
]);
const AGENT_AUTHORITY_KEYS = new Set([
  'advisoryOnly', 'canPreviewCanvasPatch', 'canApplyCanvasPatch', 'canManageHostCredentials', 'credentialVisibility',
]);
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const RUN_EVIDENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_EVIDENCE_CATEGORY_SET = new Set<RunEvidenceCategory>(['platform', 'configuration', 'network', 'structure', 'unknown']);
const RUN_EVIDENCE_OUTCOME_SET = new Set<CanvasAgentRunEvidenceInspection['diagnosis']['outcome']>([
  'failed', 'recovered', 'succeeded', 'active', 'no-failure-evidence', 'insufficient',
]);
const PRIVATE_TEXT_PATTERN = /(?:\bBearer\s+[^\s,;"'`<>]+|\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{12,}\b|[?&](?:api[_-]?key|token|signature|secret|authorization)=)/i;
const LOCAL_PATH_PATTERN = /(?:^|[\s"'`=,:;?&#])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|tmp|var|private|mnt|workspace)(?:\/|$))/i;
const DATA_BASE64_PATTERN = /data:[^;,\s]+;base64\s*,/i;
const LONG_BASE64_PATTERN = /(?:[A-Za-z0-9+/]{80,}={0,2}|(?:[A-Za-z0-9+/]{20,}\s*){5,})/;
const TOOL_NAME_SET = new Set<string>(CANVAS_AGENT_TOOL_NAMES);
const KNOWN_NODE_TYPES = new Set(CANVAS_NODE_SCHEMA_MANIFEST.types.map((item) => item.type));

export function stableCanvasAgentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableCanvasAgentJson(item)).join(',')}]`;
  if (!value || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableCanvasAgentJson(object[key])}`).join(',')}}`;
}

export function canvasAgentDigest(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(stableCanvasAgentJson(value)));
}

export const CANVAS_AGENT_LOCAL_NODE_SCHEMA_DIGEST = canvasAgentDigest(CANVAS_NODE_SCHEMA_MANIFEST);

function decodedSafetyVariants(value: string) {
  const variants = [value];
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      variants.push(decoded);
      current = decoded;
    } catch {
      break;
    }
  }
  return variants;
}

function containsPrivateAgentText(value: string) {
  return decodedSafetyVariants(value).some((candidate) => PRIVATE_TEXT_PATTERN.test(candidate)
    || LOCAL_PATH_PATTERN.test(candidate)
    || DATA_BASE64_PATTERN.test(candidate)
    || LONG_BASE64_PATTERN.test(candidate.replace(/\r?\n/g, '')));
}

const AGENT_PROMPT_OVERRIDE_PATTERN = /(?:(?:ignore|disregard|forget|override|bypass)\b.{0,32}\b(?:previous|prior|system|developer|hidden)\b.{0,24}\b(?:instruction|instructions|prompt|message|messages)\b|(?:忽略|无视|绕过|覆盖).{0,24}(?:之前|此前|先前|系统|开发者|隐藏).{0,16}(?:指令|提示词|消息|规则))/i;
const AGENT_PROMPT_DISCLOSURE_PATTERN = /(?:(?:show|reveal|print|dump|expose)\b.{0,32}\b(?:system prompt|developer message|hidden instruction|hidden prompt)s?\b|(?:显示|泄露|打印|导出|透露).{0,24}(?:系统提示词|开发者消息|隐藏指令|隐藏提示词))/i;
const AGENT_PROMPT_PRIVILEGED_READ_PATTERN = /(?:(?:read|show|reveal|print|dump|list|extract|exfiltrate)\b.{0,36}\b(?:api keys?|credentials?|secrets?|environment variables?|local (?:config|configuration|files?)|filesystem)\b|(?:读取|查看|显示|导出|泄露|列出).{0,28}(?:API\s*Key|密钥|凭据|环境变量|本机配置|本地配置|本机文件|本地文件|文件系统))/i;
const AGENT_PROMPT_PRIVILEGED_TOOL_PATTERN = /(?:(?:call|invoke|use|execute|run)\b.{0,28}\b(?:powershell|cmd(?:\.exe)?|shell|filesystem|exec)\b|(?:调用|执行|运行).{0,24}(?:PowerShell|cmd(?:\.exe)?|shell|filesystem|文件系统|终端命令|系统命令))/i;

function containsCanvasAgentPromptInjection(value: string) {
  return AGENT_PROMPT_OVERRIDE_PATTERN.test(value)
    || AGENT_PROMPT_DISCLOSURE_PATTERN.test(value)
    || AGENT_PROMPT_PRIVILEGED_READ_PATTERN.test(value)
    || AGENT_PROMPT_PRIVILEGED_TOOL_PATTERN.test(value);
}

export function sanitizeCanvasAgentPrompt(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Canvas Agent 请求必须是文本');
  const prompt = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!prompt) throw new Error('请输入要解释、规划或生成的工作流');
  if (prompt.length > 2_000) throw new Error('Canvas Agent 请求不能超过 2000 字符');
  if (containsPrivateAgentText(prompt)) throw new Error('Canvas Agent 请求包含凭据、绝对路径或内嵌二进制，已拒绝处理');
  if (containsCanvasAgentPromptInjection(prompt)) throw new Error('Canvas Agent 请求包含提示注入或越权操作，已拒绝处理');
  return prompt;
}

type CanvasAgentGenerativeIntent = 'image' | 'video' | 'audio' | 'llm';

interface CanvasAgentSemanticConcept {
  id: string;
  aliases: readonly string[];
}

interface CanvasAgentPromptProfile {
  intent: CanvasAgentIntent;
  core: string;
  promptTerms: string[];
  concepts: Array<CanvasAgentSemanticConcept & { promptAliases: string[] }>;
  intentAliases: string[];
}

const CANVAS_AGENT_INTENT_ALIASES: Record<CanvasAgentGenerativeIntent, readonly string[]> = {
  image: [
    '图像', '图片', '照片', '海报', '封面', '插画', '人像', '肖像', '证件照', '标志', '徽标',
    'image', 'photo', 'picture', 'poster', 'cover', 'illustration', 'portrait', 'headshot', 'logo',
  ],
  video: ['视频', '短片', '动画', '影片', '电影', 'video', 'movie', 'animation', 'short film'],
  audio: ['音频', '音乐', '歌曲', '配音', '旁白', 'audio', 'music', 'song', 'voiceover', 'voice over', 'narration'],
  llm: [
    '文案', '文章', '总结', '摘要', '改写', '润色', '翻译', '文本', '文字',
    'copywriting', 'write', 'writing', 'translate', 'translation', 'summary', 'summarize', 'rewrite', 'text', 'article',
  ],
};

const CANVAS_AGENT_REPAIR_ALIASES = ['修复', '修正', '清理', '诊断', 'repair', 'fix'] as const;

// These aliases are deliberately finite. They provide exact bilingual equivalence without
// introducing fuzzy matching or an AI-dependent guess into the reuse decision.
const CANVAS_AGENT_SEMANTIC_CONCEPTS: readonly CanvasAgentSemanticConcept[] = [
  { id: 'product', aliases: ['商品', '产品', '电商', 'product', 'products', 'ecommerce', 'e commerce'] },
  { id: 'advertisement', aliases: ['广告', '宣传', '营销', 'advert', 'advertisement', 'marketing'] },
  { id: 'logo', aliases: ['标志', '徽标', 'logo'] },
  { id: 'portrait', aliases: ['人像', '肖像', '证件照', 'portrait', 'headshot'] },
  { id: 'storyboard', aliases: ['分镜', '故事板', 'storyboard'] },
  { id: 'cover', aliases: ['封面', 'cover', 'thumbnail'] },
  { id: 'illustration', aliases: ['插画', 'illustration'] },
  { id: 'poster', aliases: ['海报', 'poster'] },
  { id: 'animation', aliases: ['动画', 'animation'] },
  { id: 'short-film', aliases: ['短片', 'short film'] },
  { id: 'music', aliases: ['音乐', '歌曲', 'music', 'song'] },
  { id: 'voiceover', aliases: ['配音', '旁白', 'voiceover', 'voice over', 'narration'] },
  { id: 'translation', aliases: ['翻译', 'translate', 'translation'] },
  { id: 'summary', aliases: ['总结', '摘要', 'summary', 'summarize'] },
  { id: 'rewrite', aliases: ['改写', '润色', 'rewrite'] },
] as const;

const CANVAS_AGENT_ENGLISH_PROMPT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'build', 'canvas', 'create', 'for', 'generate', 'help', 'make', 'me', 'new',
  'of', 'please', 'the', 'to', 'want', 'workflow',
]);
const CANVAS_AGENT_CHINESE_PROMPT_STOP_PHRASES = [
  '请帮我', '帮我', '工作流程', '工作流', '新建', '创建', '制作', '生成', '一张', '一个', '一份',
  '请', '需要', '想要', '用于', '流程',
] as const;

function normalizeCanvasAgentSemanticText(value: unknown, maximum = 512) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maximum).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function canvasAgentTextContainsTerm(text: string, rawTerm: string) {
  const term = normalizeCanvasAgentSemanticText(rawTerm, 80);
  if (!term) return false;
  if (/[\u3400-\u9fff]/u.test(term)) return text.includes(term);
  const haystack = ` ${text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const needle = ` ${term.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return needle.length > 2 && haystack.includes(needle);
}

function canvasAgentMatchedAliases(text: string, aliases: readonly string[]) {
  return aliases.filter((alias) => canvasAgentTextContainsTerm(text, alias));
}

function deterministicCanvasAgentPromptCore(prompt: string) {
  const normalized = normalizeCanvasAgentSemanticText(prompt, 512);
  const parts = normalized.match(/[\u3400-\u9fff]+|[a-z0-9]+/gu) || [];
  const kept = parts.flatMap((part) => {
    if (/^[a-z0-9]+$/u.test(part)) {
      return part.length >= 2 && !CANVAS_AGENT_ENGLISH_PROMPT_STOP_WORDS.has(part) ? [part] : [];
    }
    let value = part;
    for (const phrase of CANVAS_AGENT_CHINESE_PROMPT_STOP_PHRASES) value = value.split(phrase).join(' ');
    return value.split(/\s+/u).filter((item) => item.length >= 2);
  });
  return kept.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160) || normalized.slice(0, 160);
}

function deterministicCanvasAgentPromptTerms(core: string, preferred: readonly string[]) {
  const terms: string[] = [];
  const add = (value: string) => {
    const normalized = normalizeCanvasAgentSemanticText(value, 48);
    if (normalized.length < 2 || terms.includes(normalized) || terms.length >= 24) return;
    terms.push(normalized);
  };
  preferred.forEach(add);
  for (const part of core.match(/[\u3400-\u9fff]+|[a-z0-9]+/gu) || []) {
    add(part);
    if (/^[\u3400-\u9fff]+$/u.test(part)) {
      for (let index = 0; index + 1 < part.length && index < 8; index += 1) add(part.slice(index, index + 2));
    }
  }
  return terms;
}

function classifyCanvasAgentIntent(prompt: string): CanvasAgentIntent {
  const normalized = normalizeCanvasAgentSemanticText(prompt, 2_000);
  if (canvasAgentMatchedAliases(normalized, CANVAS_AGENT_REPAIR_ALIASES).length) return 'repair';
  const matches = (Object.keys(CANVAS_AGENT_INTENT_ALIASES) as CanvasAgentGenerativeIntent[])
    .filter((intent) => canvasAgentMatchedAliases(normalized, CANVAS_AGENT_INTENT_ALIASES[intent]).length > 0);
  if (matches.length > 1) return 'ambiguous';
  return matches[0] || 'unknown';
}

function canvasAgentPromptProfile(prompt: string): CanvasAgentPromptProfile {
  const normalized = normalizeCanvasAgentSemanticText(prompt, 2_000);
  const intent = classifyCanvasAgentIntent(prompt);
  const concepts = CANVAS_AGENT_SEMANTIC_CONCEPTS.flatMap((concept) => {
    const promptAliases = canvasAgentMatchedAliases(normalized, concept.aliases);
    return promptAliases.length ? [{ ...concept, promptAliases }] : [];
  });
  const intentAliases = ['image', 'video', 'audio', 'llm'].includes(intent)
    ? canvasAgentMatchedAliases(normalized, CANVAS_AGENT_INTENT_ALIASES[intent as CanvasAgentGenerativeIntent])
    : [];
  const core = deterministicCanvasAgentPromptCore(prompt);
  const preferred = [...concepts.flatMap((concept) => concept.promptAliases), ...intentAliases];
  return {
    intent,
    core,
    promptTerms: deterministicCanvasAgentPromptTerms(core, preferred),
    concepts,
    intentAliases,
  };
}

export function explainCanvasAgentRequest(value: unknown): CanvasAgentExplanation {
  const prompt = sanitizeCanvasAgentPrompt(value);
  const intent = classifyCanvasAgentIntent(prompt);
  const title = intent === 'repair' ? '确定性修复计划'
    : intent === 'ambiguous' ? '请求包含多个输出目标'
      : intent === 'unknown' ? '需要补充明确输出目标'
        : `${intent === 'image' ? '图像' : intent === 'video' ? '视频' : intent === 'audio' ? '音频' : '文本'}工作流计划`;
  return {
    intent,
    title,
    summary: '生成阶段会先检索同项目固定版本子工作流，再使用权威节点 Schema 编译小型候选；这里只解释，不创建或预览 Patch。',
    willSearchSubflowsFirst: true,
    willRequirePreviewAndConfirmation: true,
  };
}

export function buildCanvasAgentSearchQuery(value: unknown): string {
  const prompt = sanitizeCanvasAgentPrompt(value);
  return canvasAgentPromptProfile(prompt).core;
}

export function buildCanvasAgentSearchQueries(value: unknown): string[] {
  const prompt = sanitizeCanvasAgentPrompt(value);
  const profile = canvasAgentPromptProfile(prompt);
  const queries: string[] = [];
  const add = (query: string) => {
    const bounded = normalizeCanvasAgentSemanticText(query, 160);
    if (bounded && !queries.includes(bounded) && queries.length < 4) queries.push(bounded);
  };
  add(profile.core);
  profile.concepts.flatMap((concept) => concept.promptAliases).forEach(add);
  profile.intentAliases.forEach(add);
  return queries;
}

function assertAgentIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) throw new Error(`${label} 无效`);
  return value;
}

function assertAgentDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`${label} 无效`);
  return value;
}

function assertPublicJson(value: unknown, label: string, depth = 0, state = { nodes: 0, chars: 0, seen: new WeakSet<object>() }) {
  state.nodes += 1;
  if (depth > 16 || state.nodes > 10_000) throw new Error(`${label} 结构超过限制`);
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} 包含非有限数值`);
    return;
  }
  if (typeof value === 'string') {
    state.chars += value.length;
    if (value.length > 16_384 || state.chars > 64 * 1024) throw new Error(`${label} 文本超过限制`);
    if (containsPrivateAgentText(value)) throw new Error(`${label} 包含不可公开内容`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${label} 不是 JSON`);
  if (state.seen.has(value as object)) throw new Error(`${label} 包含循环引用`);
  state.seen.add(value as object);
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error(`${label} 数组超过限制`);
    value.forEach((item, index) => assertPublicJson(item, `${label}[${index}]`, depth + 1, state));
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 500) throw new Error(`${label} 字段超过限制`);
    for (const [key, item] of entries) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`${label} 包含不安全字段`);
      assertPublicJson(item, `${label}.${key}`, depth + 1, state);
    }
  }
  state.seen.delete(value as object);
}

export function parseCanvasAgentToolResult<K extends CanvasAgentToolName>(
  raw: unknown,
  expected: CanvasAgentToolRequest<K>,
): CanvasAgentToolResult<K> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Agent 工具响应不是对象');
  const result = raw as Record<string, unknown>;
  if (Object.keys(result).some((key) => !AGENT_RESULT_KEYS.has(key))) throw new Error('Agent 工具响应包含未定义字段');
  if (result.schema !== 't8-canvas-agent-tool-result-v1') throw new Error('Agent 工具响应 schema 不匹配');
  if (result.tool !== expected.tool || !TOOL_NAME_SET.has(String(result.tool))) throw new Error('Agent 工具响应 tool 不匹配');
  if (result.requestId !== expected.requestId) throw new Error('Agent 工具响应 requestId 不匹配');
  if (result.projectId !== expected.projectId || result.canvasId !== expected.canvasId) throw new Error('Agent 工具响应 scope 不匹配');
  if (!Number.isSafeInteger(result.canvasRevision) || Number(result.canvasRevision) < 1) throw new Error('Agent 工具响应 revision 无效');
  if (result.readOnly !== true || typeof result.truncated !== 'boolean') throw new Error('Agent 工具响应只读标记无效');
  assertAgentIdentifier(result.actorId, 'Agent actorId');
  assertAgentIdentifier(result.role, 'Agent role');
  if (!result.authority || typeof result.authority !== 'object' || Array.isArray(result.authority)) throw new Error('Agent authority 无效');
  const authority = result.authority as Record<string, unknown>;
  if (Object.keys(authority).some((key) => !AGENT_AUTHORITY_KEYS.has(key))
    || typeof authority.advisoryOnly !== 'boolean'
    || authority.canPreviewCanvasPatch !== true
    || typeof authority.canApplyCanvasPatch !== 'boolean'
    || authority.canManageHostCredentials !== false
    || authority.credentialVisibility !== 'configured-state-only'
    || authority.advisoryOnly === authority.canApplyCanvasPatch) {
    throw new Error('Agent authority 边界无效');
  }
  const nodeSchemaDigest = assertAgentDigest(result.nodeSchemaDigest, 'Agent nodeSchemaDigest');
  if (nodeSchemaDigest !== CANVAS_AGENT_LOCAL_NODE_SCHEMA_DIGEST) throw new Error('前后端节点 Schema 摘要不一致');
  const digest = assertAgentDigest(result.digest, 'Agent digest');
  assertPublicJson(result.data, 'Agent data');
  const digestEnvelope = { ...result };
  delete digestEnvelope.digest;
  if (canvasAgentDigest(digestEnvelope) !== digest) throw new Error('Agent 工具响应摘要校验失败');
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024) throw new Error('Agent 工具响应超过 64 KiB');
  return result as unknown as CanvasAgentToolResult<K>;
}

function runEvidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 不是对象`);
  return value as Record<string, unknown>;
}

function runEvidenceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !RUN_EVIDENCE_ID_PATTERN.test(value)) throw new Error(`${label} 无效`);
  return value;
}

function runEvidenceOptionalId(value: unknown, label: string): string | null {
  if (value == null) return null;
  return runEvidenceId(value, label);
}

function runEvidenceCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} 无效`);
  return Number(value);
}

function runEvidenceText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || containsPrivateAgentText(value)) throw new Error(`${label} 无效`);
  return value;
}

function runEvidenceHttpStatus(value: unknown, label: string): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || Number(value) < 100 || Number(value) > 599) throw new Error(`${label} 无效`);
  return Number(value);
}

/**
 * 把 inspectRun 的通用只读信封收紧为 E4 的权威三层证据。
 * 不完整证据可以被展示，但只能保持 insufficient/suggestion-only，不能进入修复规划。
 */
export function parseCanvasAgentRunEvidence(
  result: CanvasAgentToolResult<'inspectRun'>,
  expectedRef?: RunEvidenceRef,
): CanvasAgentRunEvidenceInspection {
  if (result.tool !== 'inspectRun') throw new Error('Run 证据工具类型不匹配');
  const data = runEvidenceRecord(result.data, 'Run 证据');
  if (data.schema !== 't8-run-evidence-inspection-v1') throw new Error('Run 证据 schema 不匹配');
  const runId = runEvidenceId(data.id, 'Run ID');
  if (data.canvasId !== result.canvasId) throw new Error('Run 证据画布 scope 不匹配');
  if (!Number.isSafeInteger(data.canvasRevision) || Number(data.canvasRevision) < 0) throw new Error('Run 证据 revision 无效');
  runEvidenceText(data.status, 'Run 状态', 80);

  const selection = runEvidenceRecord(data.selection, 'Run 证据选择');
  const selectedRunId = runEvidenceId(selection.runId, '选择 Run ID');
  const selectedNodeRunId = runEvidenceOptionalId(selection.nodeRunId, '选择 NodeRun ID');
  const selectedAttemptId = runEvidenceOptionalId(selection.attemptId, '选择 Attempt ID');
  if (selectedRunId !== runId || (selectedAttemptId && !selectedNodeRunId)) throw new Error('Run 证据选择链不完整');
  if (expectedRef && (
    selectedRunId !== expectedRef.runId
    || selectedNodeRunId !== expectedRef.nodeRunId
    || selectedAttemptId !== expectedRef.attemptId
  )) throw new Error('Run 证据没有命中指定的 Run/NodeRun/Attempt');

  const totals = runEvidenceRecord(data.totals, 'Run 证据总数');
  const returned = runEvidenceRecord(data.returned, 'Run 证据返回数');
  const hasMore = runEvidenceRecord(data.hasMore, 'Run 证据分页');
  const totalNodeRuns = runEvidenceCount(totals.nodeRuns, 'NodeRun 总数');
  const totalAttempts = runEvidenceCount(totals.attempts, 'Attempt 总数');
  const returnedNodeRuns = runEvidenceCount(returned.nodeRuns, 'NodeRun 返回数');
  const returnedAttempts = runEvidenceCount(returned.attempts, 'Attempt 返回数');
  if (returnedNodeRuns > totalNodeRuns || returnedAttempts > totalAttempts
    || typeof hasMore.nodeRuns !== 'boolean' || typeof hasMore.attempts !== 'boolean') {
    throw new Error('Run 证据完整性计数矛盾');
  }
  if (!Array.isArray(data.evidenceReasons) || data.evidenceReasons.length > 20) throw new Error('Run 证据缺失原因无效');
  const evidenceReasons = data.evidenceReasons.map((item, index) => runEvidenceText(item, `Run 证据缺失原因 ${index + 1}`, 160));
  if (typeof data.evidenceComplete !== 'boolean' || typeof data.truncated !== 'boolean' || !Array.isArray(data.nodeRuns)) {
    throw new Error('Run 证据完整性标记无效');
  }

  const diagnosis = runEvidenceRecord(data.diagnosis, 'Run 诊断');
  if (diagnosis.schema !== 't8-run-evidence-diagnosis-v1'
    || !RUN_EVIDENCE_OUTCOME_SET.has(diagnosis.outcome as CanvasAgentRunEvidenceInspection['diagnosis']['outcome'])
    || !Array.isArray(diagnosis.findings)
    || diagnosis.findings.length > 20
    || typeof diagnosis.truncated !== 'boolean') {
    throw new Error('Run 诊断契约无效');
  }
  const primaryCategory = diagnosis.primaryCategory == null
    ? null
    : RUN_EVIDENCE_CATEGORY_SET.has(diagnosis.primaryCategory as RunEvidenceCategory)
      ? diagnosis.primaryCategory as RunEvidenceCategory
      : (() => { throw new Error('Run 主分类无效'); })();
  const totalFindings = runEvidenceCount(diagnosis.totalFindings, 'Run 诊断总数');
  if (totalFindings < diagnosis.findings.length) throw new Error('Run 诊断计数矛盾');

  const findings = diagnosis.findings.map((rawFinding, index): CanvasAgentRunEvidenceFinding => {
    const finding = runEvidenceRecord(rawFinding, `Run 诊断 ${index + 1}`);
    const ref = runEvidenceRecord(finding.ref, `Run 诊断 ${index + 1} 引用`);
    const refValue: RunEvidenceRef = {
      runId: runEvidenceId(ref.runId, '诊断 Run ID'),
      nodeRunId: runEvidenceId(ref.nodeRunId, '诊断 NodeRun ID'),
      attemptId: runEvidenceId(ref.attemptId, '诊断 Attempt ID'),
    };
    if (refValue.runId !== runId || finding.runId !== refValue.runId
      || finding.nodeRunId !== refValue.nodeRunId || finding.attemptId !== refValue.attemptId) {
      throw new Error('Run 诊断三层引用不一致');
    }
    if (!RUN_EVIDENCE_CATEGORY_SET.has(finding.category as RunEvidenceCategory)) throw new Error('Run 诊断分类无效');
    if (!['high', 'medium', 'low'].includes(String(finding.confidence))) throw new Error('Run 诊断置信度无效');
    const error = runEvidenceRecord(finding.error, 'Run 诊断错误事实');
    const attemptNumber = runEvidenceCount(finding.attemptNumber, 'Attempt 序号');
    if (attemptNumber < 1 || !Number.isFinite(finding.timestamp) || Number(finding.timestamp) < 0) throw new Error('Run 诊断时间或序号无效');
    return {
      id: runEvidenceText(finding.id, 'Run 诊断 ID', 360),
      ref: refValue,
      runId: refValue.runId,
      nodeRunId: refValue.nodeRunId,
      attemptId: refValue.attemptId,
      nodeId: runEvidenceId(finding.nodeId, '诊断节点 ID'),
      attemptNumber,
      status: runEvidenceText(finding.status, 'Attempt 状态', 80),
      category: finding.category as RunEvidenceCategory,
      confidence: finding.confidence as CanvasAgentRunEvidenceFinding['confidence'],
      reasonCode: runEvidenceText(finding.reasonCode, '诊断理由', 160),
      summary: runEvidenceText(finding.summary, '诊断摘要', 240),
      provider: runEvidenceText(finding.provider, '诊断 Provider', 160),
      model: runEvidenceText(finding.model, '诊断模型', 240),
      error: {
        kind: runEvidenceText(error.kind, '标准化错误 kind', 80),
        code: runEvidenceText(error.code, '标准化错误 code', 160),
        httpStatus: runEvidenceHttpStatus(error.httpStatus, '标准化 HTTP 状态'),
        retryable: error.retryable === true,
      },
      timestamp: Math.trunc(Number(finding.timestamp)),
    };
  });

  const repairPolicy = runEvidenceRecord(diagnosis.repairPolicy, 'Run 修复策略');
  if (!['canvas-patch-preview-required', 'suggestion-only'].includes(String(repairPolicy.mode))
    || repairPolicy.agentMayEditCredentials !== false
    || repairPolicy.requiresStructuredPreview !== true
    || repairPolicy.requiresExplicitConfirmation !== true) {
    throw new Error('Run 修复策略越过安全边界');
  }

  const evidenceComplete = data.evidenceComplete === true;
  const incompleteByEnvelope = result.truncated || data.truncated || hasMore.nodeRuns || hasMore.attempts
    || evidenceReasons.length > 0 || diagnosis.truncated === true;
  if (evidenceComplete === incompleteByEnvelope) throw new Error('Run 证据完整性标记矛盾');
  if (evidenceComplete && (diagnosis.outcome === 'insufficient' || totalFindings !== findings.length)) {
    throw new Error('完整 Run 证据被错误标记为不足或截断');
  }
  if (!evidenceComplete && (diagnosis.outcome !== 'insufficient' || repairPolicy.mode !== 'suggestion-only')) {
    throw new Error('不完整 Run 证据不得分类或生成修复');
  }

  return {
    schema: 't8-run-evidence-inspection-v1',
    id: runId,
    canvasId: result.canvasId,
    canvasRevision: Number(data.canvasRevision),
    status: String(data.status),
    selection: { runId: selectedRunId, nodeRunId: selectedNodeRunId, attemptId: selectedAttemptId },
    totals: { nodeRuns: totalNodeRuns, attempts: totalAttempts },
    returned: { nodeRuns: returnedNodeRuns, attempts: returnedAttempts },
    hasMore: { nodeRuns: Boolean(hasMore.nodeRuns), attempts: Boolean(hasMore.attempts) },
    evidenceComplete,
    evidenceReasons,
    diagnosis: {
      schema: 't8-run-evidence-diagnosis-v1',
      outcome: diagnosis.outcome as CanvasAgentRunEvidenceInspection['diagnosis']['outcome'],
      primaryCategory,
      totalFindings,
      truncated: Boolean(diagnosis.truncated),
      findings,
      repairPolicy: {
        mode: repairPolicy.mode as CanvasAgentRunEvidenceInspection['diagnosis']['repairPolicy']['mode'],
        agentMayEditCredentials: false,
        requiresStructuredPreview: true,
        requiresExplicitConfirmation: true,
      },
    },
    nodeRuns: data.nodeRuns,
    truncated: Boolean(data.truncated),
  };
}

export function workflowRunDiagnosticsFromEvidence(
  evidence: CanvasAgentRunEvidenceInspection | null | undefined,
): WorkflowRunDiagnostic[] {
  if (!evidence?.evidenceComplete || evidence.diagnosis.outcome === 'insufficient') return [];
  return evidence.diagnosis.findings.map((finding) => ({
    runId: finding.runId,
    nodeRunId: finding.nodeRunId,
    attemptId: finding.attemptId,
    attemptNumber: finding.attemptNumber,
    nodeId: finding.nodeId,
    status: finding.status,
    category: finding.category,
    errorKind: finding.error.kind,
    errorCode: finding.error.code,
    httpStatus: finding.error.httpStatus,
    provider: finding.provider,
    model: finding.model,
    retryable: finding.error.retryable,
    updatedAt: finding.timestamp,
    evidenceComplete: true,
  }));
}

export function canvasAgentSubflowCandidatesFromResult(result: CanvasAgentToolResult<'searchSubflows'>): CanvasAgentSubflowCandidate[] {
  const data = result.data as { items?: unknown[] };
  if (!Array.isArray(data?.items)) return [];
  return data.items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (item.safeForPlan !== true || typeof item.id !== 'string' || !AGENT_ID_PATTERN.test(item.id)
      || !Number.isSafeInteger(item.version) || Number(item.version) < 1
      || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
      || typeof item.name !== 'string') return [];
    return [item as unknown as CanvasAgentSubflowCandidate];
  });
}

type CanvasAgentCandidateSemanticField = 'name' | 'tags' | 'category' | 'description';

interface CanvasAgentCandidateSemanticFields {
  name: string;
  tags: string;
  category: string;
  description: string;
}

function canvasAgentCandidateSemanticFields(candidate: CanvasAgentSubflowCandidate): CanvasAgentCandidateSemanticFields {
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.slice(0, 30).map((tag) => normalizeCanvasAgentSemanticText(tag, 80)).filter(Boolean)
    : [];
  return {
    name: normalizeCanvasAgentSemanticText(candidate.name, 240),
    tags: tags.join(' '),
    category: normalizeCanvasAgentSemanticText(candidate.category, 120),
    description: normalizeCanvasAgentSemanticText(candidate.description, 500),
  };
}

function bestCanvasAgentFieldMatch(
  aliases: readonly string[],
  fields: CanvasAgentCandidateSemanticFields,
  weights: Record<CanvasAgentCandidateSemanticField, number>,
) {
  const fieldOrder: CanvasAgentCandidateSemanticField[] = ['name', 'tags', 'category', 'description'];
  let best: null | { alias: string; field: CanvasAgentCandidateSemanticField; score: number } = null;
  for (const alias of aliases) {
    for (const field of fieldOrder) {
      if (!canvasAgentTextContainsTerm(fields[field], alias)) continue;
      const score = weights[field];
      if (!best || score > best.score) best = { alias, field, score };
    }
  }
  return best;
}

function compareCanvasAgentText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rankCanvasAgentSubflowCandidates(
  value: unknown,
  candidates: readonly CanvasAgentSubflowCandidate[],
): CanvasAgentRankedSubflowCandidate[] {
  const prompt = sanitizeCanvasAgentPrompt(value);
  const profile = canvasAgentPromptProfile(prompt);
  const specificWeights = { name: 80, tags: 60, category: 20, description: 10 } as const;
  const intentWeights = { name: 50, tags: 50, category: 40, description: 20 } as const;
  const tokenWeights = { name: 12, tags: 10, category: 4, description: 2 } as const;
  const knownPromptTerms = new Set([
    ...profile.concepts.flatMap((concept) => concept.promptAliases),
    ...profile.intentAliases,
  ].map((term) => normalizeCanvasAgentSemanticText(term, 80)));
  const generativeIntent = ['image', 'video', 'audio', 'llm'].includes(profile.intent)
    ? profile.intent as CanvasAgentGenerativeIntent
    : null;

  const scored = candidates.map((candidate, originalIndex) => {
    const fields = canvasAgentCandidateSemanticFields(candidate);
    const matchedTerms: string[] = [];
    let score = 0;
    let strongConceptMatches = 0;
    for (const concept of profile.concepts) {
      const match = bestCanvasAgentFieldMatch(concept.aliases, fields, specificWeights);
      if (!match) continue;
      score += match.score;
      if (match.field === 'name' || match.field === 'tags') strongConceptMatches += 1;
      matchedTerms.push(`${concept.id}:${match.alias}@${match.field}`);
    }

    const intentMatch = generativeIntent
      ? bestCanvasAgentFieldMatch(CANVAS_AGENT_INTENT_ALIASES[generativeIntent], fields, intentWeights)
      : null;
    const intentMatched = Boolean(intentMatch && intentMatch.score >= CANVAS_AGENT_SUBFLOW_RELEVANCE_THRESHOLD);
    if (intentMatch) {
      score += intentMatch.score;
      matchedTerms.push(`intent:${generativeIntent}:${intentMatch.alias}@${intentMatch.field}`);
    }

    let tokenBonus = 0;
    for (const term of profile.promptTerms) {
      if (knownPromptTerms.has(term) || tokenBonus >= CANVAS_AGENT_SUBFLOW_RELEVANCE_THRESHOLD) continue;
      const match = bestCanvasAgentFieldMatch([term], fields, tokenWeights);
      if (!match) continue;
      const boundedScore = Math.min(match.score, CANVAS_AGENT_SUBFLOW_RELEVANCE_THRESHOLD - tokenBonus);
      tokenBonus += boundedScore;
      matchedTerms.push(`token:${term}@${match.field}`);
    }
    score += tokenBonus;

    const requiredScore = profile.concepts.length
      ? profile.concepts.length * 60 + CANVAS_AGENT_SUBFLOW_RELEVANCE_THRESHOLD
      : CANVAS_AGENT_SUBFLOW_RELEVANCE_THRESHOLD;
    const eligible = Boolean(
      generativeIntent
      && intentMatched
      && strongConceptMatches === profile.concepts.length
      && score >= requiredScore,
    );
    return {
      rank: 0,
      candidate,
      score,
      eligible,
      intentMatched,
      intent: profile.intent,
      promptTerms: [...profile.promptTerms],
      matchedTerms,
      originalIndex,
    };
  });

  scored.sort((left, right) => Number(right.eligible) - Number(left.eligible)
    || right.score - left.score
    || compareCanvasAgentText(left.candidate.id, right.candidate.id)
    || right.candidate.version - left.candidate.version
    || right.candidate.revision - left.candidate.revision
    || left.originalIndex - right.originalIndex);
  return scored.map(({ originalIndex: _originalIndex, ...item }, index) => ({ ...item, rank: index + 1 }));
}

function finiteCanvasPosition(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 900_000 ? value : fallback;
}

function plannedOrigin(nodes: BuildCanvasAgentWorkflowPlanInput['currentNodes']) {
  const positions = (nodes || []).map((node) => ({
    x: finiteCanvasPosition(node.position?.x, 0),
    y: finiteCanvasPosition(node.position?.y, 0),
  }));
  return {
    x: Math.min(900_000, (positions.length ? Math.max(...positions.map((item) => item.x)) : -420) + 420),
    y: positions.length ? Math.min(...positions.map((item) => item.y)) : 0,
  };
}

function schemaDefaults(type: string) {
  const schema = CANVAS_NODE_SCHEMA_MANIFEST.types.find((item) => item.type === type);
  if (!schema || schema.hidden === true || schema.generatable !== true) throw new Error(`节点类型 ${type} 不在 Agent 生成白名单中`);
  return JSON.parse(JSON.stringify(schema.generation.defaults || {})) as Record<string, unknown>;
}

function preferredSourceHandle(type: string) {
  const ports = CANVAS_NODE_SCHEMA_MANIFEST.connectionPorts[type]?.outputs || [];
  const preferred = ports.find((port) => port.preferred) || (ports.length === 1 ? ports[0] : null);
  return preferred?.id ?? null;
}

function allocatePlanId(existingIds: Set<string>, base: string, label: string) {
  if (!existingIds.has(base)) {
    existingIds.add(base);
    return base;
  }
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) {
      existingIds.add(candidate);
      return candidate;
    }
  }
  throw new Error(`无法为 Agent 计划分配唯一${label} ID`);
}

function buildRegisteredFallbackDraft(
  prompt: string,
  intent: 'image' | 'video' | 'audio' | 'llm',
  seed: string,
  currentNodes: BuildCanvasAgentWorkflowPlanInput['currentNodes'],
  currentEdges: BuildCanvasAgentWorkflowPlanInput['currentEdges'],
  mediaNodeDefaults?: MediaNodeDefaults,
): CanvasPatchDraft {
  const origin = plannedOrigin(currentNodes);
  const existingNodeIds = new Set((currentNodes || []).map((node) => String(node.id || '')));
  const existingEdgeIds = new Set((currentEdges || []).map((edge) => String(edge.id || '')));
  const uniqueId = (suffix: string) => allocatePlanId(existingNodeIds, `agent-${seed}-${suffix}`, '节点');
  const uniqueEdgeId = (suffix: string) => allocatePlanId(existingEdgeIds, `agent-${seed}-edge-${suffix}`, '连线');
  const textId = uniqueId('prompt');
  const generatorId = uniqueId(intent);
  const outputId = uniqueId('output');
  const generatorType = intent === 'llm' ? 'llm' : intent;
  const sourceHandle = preferredSourceHandle(generatorType);
  const operations: CanvasPatchDraft['operations'] = [
    { type: 'node.add', node: { id: textId, type: 'text', position: { x: origin.x, y: origin.y }, data: { ...schemaDefaults('text'), text: prompt } } },
    { type: 'node.add', node: { id: generatorId, type: generatorType, position: { x: origin.x + 360, y: origin.y }, data: resolveNewMediaNodeData(generatorType, schemaDefaults(generatorType), {}, mediaNodeDefaults) } },
    { type: 'node.add', node: { id: outputId, type: 'output', position: { x: origin.x + 720, y: origin.y }, data: schemaDefaults('output') } },
    { type: 'edge.add', edge: { id: uniqueEdgeId('prompt'), source: textId, target: generatorId } },
    { type: 'edge.add', edge: { id: uniqueEdgeId('output'), source: generatorId, target: outputId, ...(sourceHandle == null ? {} : { sourceHandle }) } },
  ];
  return {
    source: 'canvas-agent-plan-v1',
    id: `agent-plan-${seed}`,
    title: `Canvas Agent ${intent} 工作流`,
    description: '由权威节点 Schema 编译的 3 节点候选；只进入 Patch 队列。',
    operations,
    diagnosticsResolved: [],
  };
}

function subflowValueMatchesSchema(value: unknown, schema: SubflowDefinition['inputs'][number]['schema']) {
  if (!schema) return true;
  if (schema.enum && !schema.enum.some((candidate) => stableCanvasAgentJson(candidate) === stableCanvasAgentJson(value))) return false;
  if (schema.type) {
    const matches = schema.type === 'null'
      ? value === null
      : schema.type === 'array'
        ? Array.isArray(value)
        : schema.type === 'integer'
          ? Number.isInteger(value)
          : schema.type === 'object'
            ? Boolean(value) && typeof value === 'object' && !Array.isArray(value)
            : typeof value === schema.type;
    if (!matches) return false;
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) return false;
    if (schema.maximum != null && value > schema.maximum) return false;
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) return false;
    if (schema.maxLength != null && value.length > schema.maxLength) return false;
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

function standaloneSubflowPromptPort(definition: SubflowDefinition) {
  const missing = [] as SubflowDefinition['inputs'];
  for (const port of definition.inputs || []) {
    const minimum = Math.max(0, Math.trunc(port.minConnections ?? (port.required ? 1 : 0)));
    const hasDefault = Object.prototype.hasOwnProperty.call(port, 'defaultValue') && port.defaultValue !== undefined;
    if (hasDefault && !subflowValueMatchesSchema(port.defaultValue, port.schema)) return null;
    if (minimum === 0 || (hasDefault && minimum <= 1)) continue;
    if (minimum !== 1 || !['text', 'any'].includes(port.kind)) return null;
    missing.push(port);
  }
  return missing.length <= 1 ? (missing[0] || undefined) : null;
}

function matchedResolvedSubflow(
  candidates: CanvasAgentSubflowCandidate[],
  definition: SubflowDefinition | null | undefined,
  projectId: string,
) {
  if (!definition) return null;
  const candidate = candidates.find((item) => item.id === definition.id && item.version === definition.version);
  if (!candidate || candidate.revision !== Number(definition.revision || definition.version)) return null;
  if (String(definition.projectId || projectId) !== projectId) return null;
  validateSubflowDefinition(definition, { maxDepth: 8, maxNodes: 2_000, maxEdges: 4_000, knownNodeTypes: KNOWN_NODE_TYPES });
  const promptPort = standaloneSubflowPromptPort(definition);
  if (promptPort === null) return null;
  return { candidate, promptPort };
}

export function canCanvasAgentReuseResolvedSubflow(
  candidate: CanvasAgentSubflowCandidate,
  definition: SubflowDefinition,
  projectId: string,
) {
  try {
    return matchedResolvedSubflow([candidate], definition, assertAgentIdentifier(projectId, '项目 ID')) != null;
  } catch {
    return false;
  }
}

function simulationState(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return {
    valid: data.valid === true,
    blocked: data.blocked === true,
    postPatch: data.basis === 'post-patch-canvas' && typeof data.proposalDigest === 'string' && SHA256_PATTERN.test(data.proposalDigest),
  };
}

function planWithoutDigest(value: Omit<CanvasAgentWorkflowPlan, 'digest'>): CanvasAgentWorkflowPlan {
  return { ...value, digest: canvasAgentDigest(value) };
}

export function buildCanvasAgentWorkflowPlan(input: BuildCanvasAgentWorkflowPlanInput): CanvasAgentWorkflowPlan {
  const prompt = sanitizeCanvasAgentPrompt(input.prompt);
  const projectId = assertAgentIdentifier(input.projectId, '项目 ID');
  const canvasId = assertAgentIdentifier(input.canvasId, '画布 ID');
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1) throw new Error('画布 revision 无效');
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) throw new Error('Agent generation 无效');
  const graphDigest = assertAgentDigest(input.graphDigest, '画布图摘要');
  const nodeSchemaDigest = assertAgentDigest(input.nodeSchemaDigest, '节点 Schema 摘要');
  const promptDigest = canvasAgentDigest(prompt);
  const seed = canvasAgentDigest([projectId, canvasId, input.baseRevision, input.generation, prompt, input.mediaNodeDefaults || null]).slice(0, 12);
  const candidates = input.subflowCandidates || [];
  const intent = classifyCanvasAgentIntent(prompt);
  const rankedCandidates = rankCanvasAgentSubflowCandidates(prompt, candidates);
  const eligibleCandidates = rankedCandidates.filter((item) => item.eligible).map((item) => item.candidate);
  const matchedSubflow = matchedResolvedSubflow(eligibleCandidates, input.resolvedSubflow, projectId);
  const unresolved: string[] = [];
  const runEvidence = input.runEvidence ? {
    ref: {
      runId: input.runEvidence.selection.runId,
      nodeRunId: input.runEvidence.selection.nodeRunId || '',
      attemptId: input.runEvidence.selection.attemptId || '',
    },
    complete: input.runEvidence.evidenceComplete,
    outcome: input.runEvidence.diagnosis.outcome,
    primaryCategory: input.runEvidence.diagnosis.primaryCategory,
    findingCount: input.runEvidence.diagnosis.totalFindings,
  } : null;
  if (input.runEvidence && (
    !input.runEvidence.evidenceComplete
    || input.runEvidence.diagnosis.outcome === 'insufficient'
    || !runEvidence?.ref.nodeRunId
    || !runEvidence.ref.attemptId
  )) {
    unresolved.push('指定的 Run/NodeRun/Attempt 证据不完整，已停止推测性诊断与修复。');
  }
  let mode: CanvasAgentPlanMode = 'unresolved';
  let patchDraft: CanvasPatchDraft | undefined;
  let title = '未生成可应用计划';
  let explanation = '请求没有被转换为 Patch。';

  if (nodeSchemaDigest !== CANVAS_AGENT_LOCAL_NODE_SCHEMA_DIGEST) {
    unresolved.push('前后端节点 Schema 摘要不一致，已停止生成。');
  } else if (intent === 'repair') {
    const repair = planCanvasAgentRequest(prompt, input.issues || []);
    if (repair) {
      mode = 'doctor-repair';
      patchDraft = { ...repair, source: 'canvas-agent-plan-v1', id: `agent-plan-${seed}` };
      title = '确定性诊断修复计划';
      explanation = '复用已命中的工作流医生规则，不引入未知节点。';
    } else unresolved.push('没有与请求匹配的可自动修复诊断。');
  } else if (matchedSubflow && input.resolvedSubflow) {
    const origin = plannedOrigin(input.currentNodes);
    const definition = JSON.parse(JSON.stringify(input.resolvedSubflow)) as SubflowDefinition;
    const existingNodeIds = new Set((input.currentNodes || []).map((node) => String(node.id || '')));
    const existingEdgeIds = new Set((input.currentEdges || []).map((edge) => String(edge.id || '')));
    const nodeId = allocatePlanId(existingNodeIds, `agent-${seed}-subflow`, '节点');
    const promptNodeId = matchedSubflow.promptPort
      ? allocatePlanId(existingNodeIds, `agent-${seed}-prompt`, '节点')
      : null;
    const operations: CanvasPatchDraft['operations'] = [
      ...(promptNodeId ? [{
        type: 'node.add' as const,
        node: { id: promptNodeId, type: 'text', position: origin, data: { ...schemaDefaults('text'), text: prompt } },
      }] : []),
      {
        type: 'node.add',
        node: {
          id: nodeId,
          type: 'subflow',
          position: { x: origin.x + (promptNodeId ? 360 : 0), y: origin.y },
          data: {
            definitionId: matchedSubflow.candidate.id,
            definitionVersion: matchedSubflow.candidate.version,
            definition,
            parameterOverrides: {},
          },
        },
      },
      ...(promptNodeId && matchedSubflow.promptPort ? [{
        type: 'edge.add' as const,
        edge: {
          id: allocatePlanId(existingEdgeIds, `agent-${seed}-edge-subflow-input`, '连线'),
          source: promptNodeId,
          target: nodeId,
          targetHandle: matchedSubflow.promptPort.id,
        },
      }] : []),
    ];
    mode = 'reuse-subflow';
    patchDraft = {
      source: 'canvas-agent-plan-v1',
      id: `agent-plan-${seed}`,
      title: `复用子工作流：${matchedSubflow.candidate.name}`,
      description: `固定 ${matchedSubflow.candidate.id} v${matchedSubflow.candidate.version} / revision ${matchedSubflow.candidate.revision}，只进入 Patch 队列。`,
      operations,
      diagnosticsResolved: [],
    };
    title = `优先复用 ${matchedSubflow.candidate.name}`;
    explanation = matchedSubflow.promptPort
      ? '搜索命中同项目固定版本子工作流，并用一个受控文本节点满足其唯一必填输入。'
      : '搜索命中同项目固定版本且可独立运行的子工作流。';
  } else if (['image', 'video', 'audio', 'llm'].includes(intent)) {
    mode = 'registered-fallback';
    patchDraft = buildRegisteredFallbackDraft(prompt, intent as 'image' | 'video' | 'audio' | 'llm', seed, input.currentNodes, input.currentEdges, input.mediaNodeDefaults);
    title = '权威 Schema 小型回退计划';
    explanation = candidates.length
      ? eligibleCandidates.length
        ? '相关搜索结果没有可验证的固定版本定义，回退到最多 3 个可生成节点。'
        : '搜索结果均低于确定性语义相关阈值，回退到最多 3 个可生成节点。'
      : '项目内未找到可复用子工作流，回退到最多 3 个可生成节点。';
  } else if (intent === 'ambiguous') {
    unresolved.push('请求同时包含多个输出目标，请明确选择图像、视频、音频或文本。');
  } else {
    unresolved.push('无法从请求中确定受控输出类型。');
  }

  if (patchDraft) {
    try {
      materializeCanvasPatchDraft(patchDraft, { projectId, canvasId, baseRevision: input.baseRevision });
    } catch (error) {
      unresolved.push(error instanceof Error ? error.message : '受控 Patch 编译失败');
      patchDraft = undefined;
      mode = 'unresolved';
    }
  }

  const simulation = simulationState(input.simulation);
  if (patchDraft && simulation && (!simulation.postPatch || !simulation.valid || simulation.blocked)) {
    unresolved.push('服务端执行计划模拟未通过，Patch 已阻止入队。');
    patchDraft = undefined;
  }
  const status: CanvasAgentPlanStatus = unresolved.length || !patchDraft
    ? 'blocked'
    : simulation?.postPatch && simulation.valid && !simulation.blocked
      ? 'ready'
      : 'ready-for-validation';
  const selected = mode === 'reuse-subflow' && matchedSubflow ? {
    id: matchedSubflow.candidate.id,
    version: matchedSubflow.candidate.version,
    revision: matchedSubflow.candidate.revision,
    name: matchedSubflow.candidate.name,
  } : null;
  return planWithoutDigest({
    schema: 't8-workflow-generation-plan-v1',
    planId: `agent-plan-${seed}`,
    projectId,
    canvasId,
    baseRevision: input.baseRevision,
    generation: input.generation,
    promptDigest,
    graphDigest,
    nodeSchemaDigest,
    mode,
    status,
    title,
    explanation,
    subflowSearch: {
      completed: true,
      query: String(input.subflowQuery || '').slice(0, 512),
      intent,
      promptTerms: rankedCandidates[0]?.promptTerms || canvasAgentPromptProfile(prompt).promptTerms,
      total: candidates.length,
      eligibleTotal: eligibleCandidates.length,
      ranking: rankedCandidates.map((item) => ({
        rank: item.rank,
        id: item.candidate.id,
        version: item.candidate.version,
        revision: item.candidate.revision,
        score: item.score,
        eligible: item.eligible,
        matchedTerms: item.matchedTerms,
      })),
      selected,
    },
    stages: [
      { id: 'search-subflows', status: 'completed', summary: candidates.length ? `找到 ${candidates.length} 个安全摘要，其中 ${eligibleCandidates.length} 个达到相关阈值` : '没有找到可复用子工作流' },
      { id: 'compile-plan', status: patchDraft ? 'completed' : 'blocked', summary: patchDraft ? `${patchDraft.operations.length} 个受控操作` : '没有生成 Patch' },
      { id: 'validate', status: input.validation == null ? 'unavailable' : 'completed', summary: input.validation == null ? '未提供画布验证证据' : '已读取当前画布结构验证' },
      { id: 'simulate', status: simulation == null ? 'pending' : simulation.valid && !simulation.blocked ? 'completed' : 'blocked', summary: simulation == null ? '等待服务端模拟候选' : simulation.valid && !simulation.blocked ? '候选执行计划可模拟' : '候选执行计划被阻止' },
      { id: 'estimate', status: input.estimate == null ? 'unavailable' : 'completed', summary: input.estimate == null ? '未提供估算证据' : '已读取不猜价的运行估算' },
    ],
    toolDigests: input.toolDigests || {},
    validation: input.validation ?? null,
    simulation: input.simulation ?? null,
    estimate: input.estimate ?? null,
    runEvidence,
    unresolved,
    ...(patchDraft ? { patchDraft } : {}),
  });
}

export function canvasAgentExecutionProposalFromPlan(plan: CanvasAgentWorkflowPlan): CanvasAgentExecutionProposal | null {
  if (!plan.patchDraft) return null;
  const operations: CanvasAgentExecutionProposal['operations'] = plan.patchDraft.operations.map((operation) => {
    if (operation.type === 'node.add') {
      const selected = operation.node.type === 'subflow' ? plan.subflowSearch.selected : null;
      return {
        type: 'node.add',
        node: {
          id: String(operation.node.id),
          type: String(operation.node.type || ''),
          position: { x: Number(operation.node.position.x), y: Number(operation.node.position.y) },
          ...(selected ? { subflowRef: { definitionId: selected.id, version: selected.version, revision: selected.revision } } : {}),
        },
      };
    }
    if (operation.type === 'edge.add') return {
      type: 'edge.add',
      edge: {
        id: String(operation.edge.id),
        source: String(operation.edge.source),
        target: String(operation.edge.target),
        ...(operation.edge.sourceHandle == null ? {} : { sourceHandle: String(operation.edge.sourceHandle) }),
        ...(operation.edge.targetHandle == null ? {} : { targetHandle: String(operation.edge.targetHandle) }),
      },
    };
    if (operation.type === 'node.delete') return { type: 'node.delete', nodeId: String(operation.nodeId) };
    if (operation.type === 'edge.delete') return { type: 'edge.delete', edgeId: String(operation.edgeId) };
    const position = operation.patch?.position;
    if (!position || typeof position !== 'object' || Array.isArray(position)
      || typeof (position as { x?: unknown }).x !== 'number' || typeof (position as { y?: unknown }).y !== 'number') {
      throw new Error('Agent 节点修复无法编译为受控坐标模拟');
    }
    return {
      type: 'node.patch',
      nodeId: String(operation.nodeId),
      position: { x: Number((position as { x: number }).x), y: Number((position as { y: number }).y) },
    };
  });
  return { schema: 't8-canvas-agent-execution-proposal-v1', baseRevision: plan.baseRevision, operations };
}

export function createCanvasAgentPatchQueueItem(plan: CanvasAgentWorkflowPlan): CanvasAgentPatchQueueItem {
  if (plan.status !== 'ready' || !plan.patchDraft) throw new Error('只有通过服务端模拟的计划才能进入 Patch 队列');
  return {
    schema: 't8-canvas-agent-patch-queue-item-v1',
    id: `agent-queue-${plan.digest.slice(0, 16)}`,
    projectId: plan.projectId,
    canvasId: plan.canvasId,
    baseRevision: plan.baseRevision,
    generation: plan.generation,
    graphDigest: plan.graphDigest,
    nodeSchemaDigest: plan.nodeSchemaDigest,
    planDigest: plan.digest,
    selectedSubflow: plan.subflowSearch.selected,
    status: 'queued',
    draft: plan.patchDraft,
  };
}

export function createCanvasAgentRequestId(sessionId: string, generation: number, tool: CanvasAgentToolName, sequence: number) {
  const safeSessionId = assertAgentIdentifier(sessionId, 'Agent sessionId');
  if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('Agent 请求序号无效');
  }
  return `${safeSessionId}:${generation}:${sequence}:${tool}`.slice(0, 160);
}
