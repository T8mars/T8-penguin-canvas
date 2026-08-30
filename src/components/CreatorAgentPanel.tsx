import {
  AtSign,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  History,
  Link2,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import LocalizedVisibleTree from '../i18n/LocalizedVisibleTree';
import { localizeCreatorAgentStarterIdea } from '../i18n/creatorAgentStarterEnglish';
import { CREATOR_AGENT_VISIBLE_CATALOG } from '../i18n/workbenchVisibleCatalog';
import './CreatorAgentModels.css';
import './CreatorAgentRichText.css';
import * as api from '../services/api';
import {
  appendCreatorAgentEvent,
  completeCreatorAgentDeliveryApproval,
  confirmCreatorAgentProductionDocuments,
  createCreatorAgentAssetPlacePlan,
  createCreatorAgentDeliveryPlan,
  createCreatorAgentSession,
  createCreatorAgentIteratePlan,
  getCreatorAgentCapabilities,
  getCreatorAgentCandidateComparison,
  getCreatorAgentRuntimeCatalog,
  getLatestCreatorAgentSession,
  getCreatorAgentPlanPatch,
  listCreatorAgentSessions,
  getCreatorAgentSession,
  prepareCreatorAgentToolProposal,
  reconcileCreatorAgentRunLinks,
  recoverCreatorAgentMessageRequest,
  requestCreatorAgentDeliveryApproval,
  reviseCreatorAgentWorkArtifact,
  sendCreatorAgentMessage,
  stopCreatorAgentResponse,
  subscribeCreatorAgentEvents,
  verifyCreatorAgentRunArtifacts,
  type CreatorAgentAttachment,
  type CreatorAgentAttachmentKind,
  type CreatorAgentCapabilities,
  type CreatorAgentCandidate,
  type CreatorAgentCandidateComparison,
  type CreatorAgentContext,
  type CreatorAgentCreativeArtifactVersion,
  type CreatorAgentWorkArtifactVersion,
  type CreatorAgentWorkQualityMode,
  type CreatorAgentEvent,
  type CreatorAgentPlan,
  type CreatorAgentProductionDocument,
  type CreatorAgentProductionDocumentConfirmation,
  type CreatorAgentProductionPhase,
  type CreatorAgentSuggestion,
  type CreatorAgentSuggestionSet,
  type CreatorAgentSession,
  type CreatorAgentToolProposal,
  type CreatorAgentRunLink,
  type CreatorAgentArtifactVerification,
  type CreatorAgentCatalogModel,
  type CreatorAgentModelKind,
  type CreatorAgentModelPreferences,
  type CreatorAgentRuntimeCatalog,
  type CreatorAgentLocalReadinessReceipt,
} from '../services/creatorAgent';
import type {
  AssetLineageRecord,
  AssetRef,
  CanvasPatch,
  CanvasPatchChange,
  CanvasPatchApplyResult,
  CanvasPatchPreview,
  CanvasPatchRevertResult,
  RunDetail,
} from '../types/project';
import {
  createCanvasNodeRunRequestId,
  requestCanvasNodeRun,
} from '../utils/canvasRunRequest';
import {
  CREATOR_AGENT_STARTER_IDEA_BATCH_COUNT,
  creatorAgentStarterIdeaBatch,
  creatorAgentStarterIdeaContextKey,
  creatorAgentStarterMode,
} from '../utils/creatorAgentStarterIdeas';
import type { ThemeTokens } from '../theme/types';

interface CreatorAgentPanelProps {
  projectId: string;
  canvasId: string;
  canvasRevision: number;
  canvasTitle?: string;
  nodeCount: number;
  edgeCount: number;
  nodeTypeCounts: Record<string, number>;
  selectedNodeIds: string[];
  selectedNodeTypes: string[];
  viewport: { x: number; y: number; zoom: number };
  canvasObjects: NonNullable<CreatorAgentContext['canvasObjects']>;
  offscreenSummary: NonNullable<CreatorAgentContext['offscreenSummary']>;
  visualStyle: string;
  themeMode: 'light' | 'dark';
  themeTokens: ThemeTokens;
  onPreviewPatch: (patch: CanvasPatch) => Promise<{ patch: CanvasPatch; preview: CanvasPatchPreview }>;
  onApplyPatch: (patch: CanvasPatch, preview: CanvasPatchPreview) => Promise<CanvasPatchApplyResult>;
  onRevertPatch: (patchId: string, appliedRevision: number) => Promise<CanvasPatchRevertResult>;
  onFocusNode: (nodeId: string) => void;
}

interface PatchPreviewState {
  plan: CreatorAgentPlan;
  patch: CanvasPatch;
  preview: CanvasPatchPreview;
  toolProposalBinding?: {
    proposalId: string;
    proposalDigest: string;
    workId: string;
    workRevision: number;
    workDigest: string;
  };
}

interface PendingStageContinuation {
  prompt: string;
  targetPhase: CreatorAgentProductionPhase;
  readyAfterApply: boolean;
}

interface CreatorAgentUploadTask {
  id: string;
  name: string;
  kind: CreatorAgentAttachmentKind;
  loaded: number;
  total: number | null;
  percent: number | null;
  status: 'queued' | 'uploading' | 'failed';
  error?: string;
}

interface CreatorAgentNodeReference {
  nodeId: string;
  nodeType: string;
  label: string;
  assetIds: string[];
}

type CreatorToolProposalStage = 'not-started' | 'prepared' | 'applied' | 'running' | 'verified' | 'verification-failed';

function creatorToolProposalStage(
  events: CreatorAgentEvent[] | undefined,
  proposalId: string,
): CreatorToolProposalStage {
  let stage: CreatorToolProposalStage = 'not-started';
  for (const event of events || []) {
    if (String(event.payload?.proposalId || '') !== proposalId) continue;
    if (event.type === 'assistant.tool-proposal.prepared') stage = 'prepared';
    if (event.type === 'assistant.tool-proposal.writeback') {
      const next = String(event.payload?.stage || '') as CreatorToolProposalStage;
      if (['applied', 'running', 'verified', 'verification-failed'].includes(next)) stage = next;
    }
  }
  return stage;
}

function creatorToolProposalStageLabel(stage: CreatorToolProposalStage) {
  const labels: Record<CreatorToolProposalStage, string> = {
    'not-started': '尚未预览',
    prepared: '预览已准备',
    applied: '已写入画布',
    running: '生成任务已关联',
    verified: '真实结果已核验',
    'verification-failed': '结果核验未通过',
  };
  return labels[stage];
}

const CREATIVE_PHASES = [
  { id: 'idea', label: '创意' },
  { id: 'script', label: '剧本' },
  { id: 'assets', label: '资产' },
  { id: 'shots', label: '分镜' },
  { id: 'candidates', label: '生成' },
  { id: 'delivery', label: '成片' },
] as const;

const CREATOR_STAGE_DOCUMENT_KINDS: Record<
  CreatorAgentProductionPhase,
  CreatorAgentProductionDocument['kind'][]
> = {
  idea: ['production-brief'],
  script: ['script-doc', 'world-bible'],
  assets: ['character-bible', 'asset-needs'],
  shots: ['shot-list', 'audio-plan', 'storyboard', 'prompt-pack'],
  candidates: ['candidate-review', 'edit-decision-list', 'qc-report'],
  delivery: ['delivery-manifest'],
};

const CREATOR_STAGE_CONFIRM_LABELS: Record<CreatorAgentProductionPhase, string> = {
  idea: '确认创意，进入剧本',
  script: '确认剧本，准备资产',
  assets: '确认资产，开始分镜',
  shots: '确认分镜，准备生成',
  candidates: '确认采用，准备成片',
  delivery: '确认最终交付',
};

const CREATOR_MODEL_KINDS = ['llm', 'image', 'video', 'audio'] as const;
const CREATOR_MODEL_KIND_LABELS: Record<CreatorAgentModelKind, string> = {
  llm: '语言 / 剧本',
  image: '图像',
  video: '视频',
  audio: '音频',
};

function creatorModelPreferenceValue(preference?: { provider: string; model: string }) {
  return preference ? JSON.stringify([preference.provider, preference.model]) : '';
}
function creatorRuntimeModelExecutable(item: CreatorAgentCatalogModel) {
  return item.readiness ? item.readiness.executable : item.available !== false && item.configured !== false;
}

function creatorRuntimeModelStatus(item: CreatorAgentCatalogModel) {
  if (creatorRuntimeModelExecutable(item)) return '';
  return item.readiness?.blockers[0]?.message
    || (item.available === false ? '当前已停用' : item.configured === false ? '未完成平台配置' : '当前不可执行');
}

interface CreatorAgentSuggestionReceipt {
  effect: string;
  cost: string;
  risk: string;
  riskDetail: string;
}

function creatorSuggestionReceipt(
  suggestion: CreatorAgentSuggestion,
  providerCalls: number | null,
): CreatorAgentSuggestionReceipt {
  const operationContracts = Array.isArray(suggestion.operationContracts)
    ? suggestion.operationContracts
    : [];
  const riskLevels = [...new Set(operationContracts
    .map((contract) => String(contract.riskLevel || '').trim())
    .filter(Boolean))];
  const approvalRequired = operationContracts
    .some((contract) => Boolean(contract.approvalRequired));
  const readOnly = operationContracts.length > 0
    && riskLevels.length > 0
    && riskLevels.every((riskLevel) => riskLevel === 'L0')
    && !approvalRequired;
  const riskFallback = String(suggestion.riskLevel || '').trim() || '风险待核验';
  const risk = readOnly
    ? 'L0 · 本步只读'
    : `${riskLevels.join('/') || riskFallback} · ${approvalRequired ? '需要确认' : '边界待核验'}`;
  return {
    effect: String(suggestion.expectedEffect || '').trim() || '效果说明待刷新',
    cost: providerCalls === 0
      ? '模型调用 0 次'
      : providerCalls === null
        ? '调用成本待核验'
        : `模型调用 ${Math.max(0, Math.trunc(providerCalls))} 次`,
    risk,
    riskDetail: readOnly
      ? '本步只读且无需批准；后续写画布或生成仍按各自合同确认'
      : approvalRequired
        ? '执行前需要明确确认'
        : '请先刷新建议合同再继续',
  };
}


const CODEX_CONNECT_PROMPT = '请安装或更新贞贞无限画布 Skill，安全连接当前画布，然后根据我下一句话直接开始规划；先给可编辑方案，不自动生成。';

const CODEX_SCOPE_LABELS: Partial<Record<T8AgentControlScope, string>> = {
  'canvas:read': '查看画布',
  'canvas:write': '预览后修改画布',
  'run:read': '查看任务',
  'run:execute': '确认后运行任务',
  'asset:read': '查看素材信息',
  'asset:transfer': '确认后传输素材',
  'browser:handoff': '可见浏览器交接',
};

function creativePhaseIndex(value: string) {
  const phase = String(value || '').toLowerCase();
  if (['delivery', 'export', 'done'].includes(phase)) return 5;
  if (['candidates', 'video', 'edit', 'audio', 'sound', 'generation'].includes(phase)) return 4;
  if (['shots', 'prompts', 'storyboard', 'director'].includes(phase)) return 3;
  if (['assets', 'style', 'characters'].includes(phase)) return 2;
  if (['script', 'story'].includes(phase)) return 1;
  return 0;
}

function creativePhaseLabel(value: string) {
  const index = creativePhaseIndex(value);
  return CREATIVE_PHASES[index]?.label || '创意';
}

const CREATOR_RECENT_ACTION_LABELS: Record<string, string> = {
  'user.message': '你补充了新的创作要求',
  'assistant.response.completed': 'Agent 已整理完本轮回复',
  'assistant.plan': '已形成可编辑创作计划',
  'production-documents.confirmed': '你确认了当前创作前期文档',
  'plan.previewed': '已生成画布变更预览',
  'plan.applied': '已把确认的变更写入画布',
  'plan.reverted': '已精确撤回尚未运行的画布变更',
  'run.linked': '已关联真实画布任务',
  'run.event': '真实任务进度已更新',
  'asset.sent': '素材已发送到画布',
  'candidate.accepted': '已采用一个候选结果',
  'candidate.locked': '已锁定创作连续性',
  'candidate.rolled-back': '已回退候选版本',
  'delivery.completed': '交付包已经完成核验',
};

function creatorRecentActions(events: CreatorAgentEvent[]) {
  return [...events]
    .reverse()
    .flatMap((event) => {
      const label = CREATOR_RECENT_ACTION_LABELS[event.type];
      return label ? [{
        eventType: event.type,
        label,
        createdAt: event.createdAt,
      }] : [];
    })
    .slice(0, 6);
}

function capabilityContractReady(value: CreatorAgentCapabilities | null) {
  return Boolean(
    value
    && value.schema === 't8-creative-capability-manifest-v1'
    && value.digest
    && value.capabilityGraph?.schema === 't8-creative-capability-graph-v1'
    && Boolean(value.capabilityGraph.aggregateDigest)
    && value.capabilityGraph.counts.unknownNodeReferences === 0
    && value.capabilityGraph.counts.handlers === value.capabilityGraph.counts.capabilities
    && value.capabilityGraph.counts.missingOperationRisk === 0
    && value.capabilityGraph.counts.operations > 0
    && value.principles.directCanvasMutation === false
    && value.principles.previewBeforeApply === true
    && value.principles.explicitApprovalForWrites === true,
  );
}

function creatorSuggestionSetContractReady(
  set: CreatorAgentSuggestionSet | null | undefined,
  capabilities: CreatorAgentCapabilities | null,
) {
  const receipt = set?.invariantReceipt;
  const items = Array.isArray(set?.items) ? set.items : [];
  if (!set || !receipt || !capabilities
    || receipt.schema !== 't8-creator-suggestion-invariant-receipt-v1'
    || receipt.suggestionSetCount !== 1
    || receipt.itemCount !== 3
    || receipt.uniqueIdCount !== 3
    || receipt.uniqueIntentCount !== 3
    || receipt.invalidCapabilityIds.length !== 0
    || receipt.invalidContractCount !== 0
    || receipt.fakeEnabledActionCount !== 0
    || receipt.unexplainedDisabledActionCount !== 0
    || receipt.setDigest !== set.setDigest
    || items.length !== 3
    || items.some((item) => !item.id.trim() || !item.intent.trim())
    || new Set(items.map((item) => item.id.trim())).size !== 3
    || new Set(items.map((item) => item.intent.trim())).size !== 3) return false;
  const capabilityById = new Map(
    capabilities.capabilities.map((capability) => [capability.id, capability]),
  );
  return items.every((item) => {
    const required = item.requiredCapabilityIds.map((id) => id.trim()).filter(Boolean);
    if (required.length === 0 || new Set(required).size !== required.length
      || item.operationContracts.length !== required.length) return false;
    const contractsValid = required.every((capabilityId) => {
      const capability = capabilityById.get(capabilityId);
      const matches = item.operationContracts
        .filter((contract) => contract.capabilityId === capabilityId);
      if (!capability || matches.length !== 1) return false;
      const contract = matches[0];
      const operation = capability.operations
        .find((candidate) => candidate.operation === contract.operation);
      if (!operation) return false;
      const scopes = contract.requiredScopes.slice().sort();
      const authoritativeScopes = operation.requiredScopes.slice().sort();
      return contract.riskLevel === operation.riskLevel
        && contract.approvalRequired === operation.approvalRequired
        && contract.boundary === operation.boundary
        && scopes.length === new Set(scopes).size
        && scopes.join('\u0000') === authoritativeScopes.join('\u0000');
    });
    if (!contractsValid) return false;
    const blockerMessages = item.blockers.map((blocker) => blocker.message.trim()).filter(Boolean);
    const unblockActions = item.unblockActions.map((action) => action.trim()).filter(Boolean);
    if (item.executable) {
      return item.blockers.length === 0
        && !item.disabledReason.trim()
        && item.unblockActions.length === 0;
    }
    return blockerMessages.length > 0
      || Boolean(item.disabledReason.trim())
      || unblockActions.length > 0;
  });
}

const SESSION_STORAGE_PREFIX = 't8-creator-agent-session-v1';
const CREATOR_PANEL_WIDTH_STORAGE_KEY = 't8-creator-agent-panel-width-v1';
const CREATOR_EFFECTS_STORAGE_KEY = 't8-creator-agent-effects-v1';
const CREATOR_PANEL_MIN_WIDTH = 420;
const CREATOR_PANEL_MAX_WIDTH = 560;
const CREATOR_MESSAGE_WINDOW_SIZE = 80;
const CREATOR_ATTACHMENT_LIMIT = 16;
const CREATOR_REFERENCE_LIMIT = 8;
const CREATOR_UPLOAD_MAX_CONCURRENCY = 3;
const CREATOR_IME_COMMIT_GUARD_MS = 140;
const CREATOR_SHELL_READINESS_SCHEMA = 't8-creator-agent-shell-readiness-receipt-v1';
const CREATOR_SHELL_TARGET_MS = 300;

function CreatorAgentVisible({ children }: { children: ReactNode }) {
  return (
    <LocalizedVisibleTree area="creatorAgent" catalog={CREATOR_AGENT_VISIBLE_CATALOG}>
      {children}
    </LocalizedVisibleTree>
  );
}

function storageKey(projectId: string, canvasId: string) {
  return `${SESSION_STORAGE_PREFIX}:${projectId}:${canvasId}`;
}

const CREATOR_PENDING_MESSAGE_PREFIX = 't8-creator-agent-pending-message-v1';

interface CreatorPendingMessage {
  requestId: string;
  signature: string;
}

function pendingMessageStorageKey(projectId: string, canvasId: string) {
  return `${CREATOR_PENDING_MESSAGE_PREFIX}:${projectId}:${canvasId}`;
}

function readPendingCreatorMessage(key: string): CreatorPendingMessage | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as CreatorPendingMessage | null;
    return value
      && /^[A-Za-z0-9_-]{16,120}$/.test(String(value.requestId || ''))
      && typeof value.signature === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

function writePendingCreatorMessage(key: string, value: CreatorPendingMessage) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The server still enforces idempotency for the current in-memory submission.
  }
}

function clearPendingCreatorMessage(key: string, requestId: string) {
  try {
    const current = readPendingCreatorMessage(key);
    if (current?.requestId === requestId) sessionStorage.removeItem(key);
  } catch {
    // Pending recovery storage is best-effort; durable server events remain authoritative.
  }
}

function clampCreatorPanelWidth(value: number) {
  return Math.max(CREATOR_PANEL_MIN_WIDTH, Math.min(CREATOR_PANEL_MAX_WIDTH, Math.round(value)));
}

function attachmentKind(file: File): CreatorAgentAttachmentKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('text/')) return 'text';
  return 'file';
}

function creatorInlineText(text: string): ReactNode[] {
  return String(text || '')
    .split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`strong-${index}`}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={`code-${index}`}>{part.slice(1, -1)}</code>;
      }
      return part;
    });
}

function CreatorAgentMessageText(props: { text: string; isUser: boolean }) {
  const text = String(props.text || '').trim();
  if (!text) return null;
  if (props.isUser) return <p>{text}</p>;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length + 1));
      const content = creatorInlineText(heading[2]);
      nodes.push(level <= 2
        ? <h3 key={`heading-${index}`}>{content}</h3>
        : <h4 key={`heading-${index}`}>{content}</h4>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(
          <li key={`bullet-${index}`}>
            {creatorInlineText(lines[index].trim().replace(/^[-*]\s+/, ''))}
          </li>,
        );
        index += 1;
      }
      nodes.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\d+[.)、]\s*/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+[.)、]\s*/.test(lines[index].trim())) {
        items.push(
          <li key={`ordered-${index}`}>
            {creatorInlineText(lines[index].trim().replace(/^\d+[.)、]\s*/, ''))}
          </li>,
        );
        index += 1;
      }
      nodes.push(<ol key={`ordered-list-${index}`}>{items}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      nodes.push(
        <blockquote key={`quote-${index}`}>
          {creatorInlineText(quote.join(' '))}
        </blockquote>,
      );
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next
        || /^(#{1,4})\s+/.test(next)
        || /^[-*]\s+/.test(next)
        || /^\d+[.)、]\s*/.test(next)
        || /^>\s?/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    nodes.push(
      <p key={`paragraph-${index}`}>
        {creatorInlineText(paragraph.join(' '))}
      </p>,
    );
  }
  return <div className="t8-creator-agent-rich-text">{nodes}</div>;
}

function eventReadinessReceipt(event: CreatorAgentEvent) {
  const value = event.payload.readinessReceipt as CreatorAgentLocalReadinessReceipt | undefined;
  return value?.schema === 't8-creator-agent-local-readiness-receipt-v1'
    ? value
    : null;
}

function eventPlan(event: CreatorAgentEvent) {
  return ['assistant.plan', 'assistant.response'].includes(event.type) && event.payload.plan
    ? event.payload.plan as CreatorAgentPlan
    : null;
}

function creatorEventArtifactVersion(value: unknown): CreatorAgentCreativeArtifactVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as CreatorAgentCreativeArtifactVersion;
  if (candidate.schema !== 't8-creator-artifact-version-v1'
    || !candidate.artifactId
    || !candidate.versionId
    || !candidate.title
    || !Number.isInteger(candidate.revision)
    || candidate.revision < 1
    || candidate.content?.schema !== 't8-creator-artifact-content-v1'
    || !candidate.content.contentDigest
    || candidate.diff?.schema !== 't8-creator-artifact-diff-v1'
    || !Array.isArray(candidate.diff.operations)) return null;
  return candidate;
}

function eventArtifactVersion(event: CreatorAgentEvent) {
  return creatorEventArtifactVersion(event.payload.artifactVersion);
}

function mergeCreatorAgentSessionEvent(
  session: CreatorAgentSession,
  event: CreatorAgentEvent,
): CreatorAgentSession {
  if (event.sessionId !== session.id
    || session.events.some((current) => current.eventId === event.eventId)) return session;
  const events = [...session.events, event]
    .sort((left, right) => Number(left.sequence) - Number(right.sequence))
    .slice(-1_000);
  const artifactVersion = eventArtifactVersion(event);
  const creativeArtifactVersions = artifactVersion
    ? [...(session.creativeArtifactVersions || []).filter(
        (current) => current.versionId !== artifactVersion.versionId,
      ), artifactVersion].slice(-120)
    : session.creativeArtifactVersions;
  const creativeArtifacts = artifactVersion && creativeArtifactVersions
    ? [...creativeArtifactVersions.reduce((latest, current) => {
        const known = latest.get(current.artifactId);
        if (!known || current.revision > known.revision) latest.set(current.artifactId, current);
        return latest;
      }, new Map<string, CreatorAgentCreativeArtifactVersion>()).values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((current) => ({
        artifactId: current.artifactId,
        versionId: current.versionId,
        revision: current.revision,
        taskFamily: current.taskFamily,
        kind: current.kind,
        title: current.title,
        status: current.status,
        contentDigest: current.content.contentDigest,
        updatedAt: current.createdAt,
      }))
    : session.creativeArtifacts;
  return {
    ...session,
    events,
    ...(creativeArtifactVersions ? { creativeArtifactVersions } : {}),
    ...(creativeArtifacts ? { creativeArtifacts } : {}),
    lastSequence: Math.max(Number(session.lastSequence) || 0, Number(event.sequence) || 0),
    updatedAt: String(event.createdAt || session.updatedAt),
  };
}
function creatorDisplayEvents(events: CreatorAgentEvent[]) {
  const output: CreatorAgentEvent[] = [];
  const responseIndexes = new Map<string, number>();
  const responseDeltaIndexes = new Map<string, Set<number>>();
  const ensureResponse = (event: CreatorAgentEvent, responseId: string) => {
    const known = responseIndexes.get(responseId);
    if (known != null) return known;
    const index = output.length;
    responseIndexes.set(responseId, index);
    responseDeltaIndexes.set(responseId, new Set());
    output.push({
      ...event,
      eventId: `creator-response:${responseId}`,
      type: 'assistant.response',
      payload: {
        ...event.payload,
        responseId,
        text: '',
        streamStatus: 'streaming',
      },
    });
    return index;
  };
  for (const event of events) {
    if (![
      'assistant.response.started',
      'assistant.response.delta',
      'assistant.response.completed',
      'assistant.response.failed',
      'assistant.response.stopped',
    ].includes(event.type)) {
      output.push(event);
      continue;
    }
    const responseId = String(event.payload.responseId || '');
    if (!responseId) continue;
    const outputIndex = ensureResponse(event, responseId);
    const current = output[outputIndex];
    if (event.type === 'assistant.response.delta') {
      const deltaIndex = Math.max(0, Math.trunc(Number(event.payload.index) || 0));
      const seen = responseDeltaIndexes.get(responseId) as Set<number>;
      if (seen.has(deltaIndex)) continue;
      seen.add(deltaIndex);
      output[outputIndex] = {
        ...current,
        sequence: event.sequence,
        payload: {
          ...current.payload,
          text: `${String(current.payload.text || '')}${String(event.payload.delta || '')}`,
          streamStatus: 'streaming',
        },
      };
    } else if (event.type === 'assistant.response.completed') {
      output[outputIndex] = {
        ...current,
        sequence: event.sequence,
        createdAt: event.createdAt,
        payload: {
          ...current.payload,
          ...event.payload,
          text: String(event.payload.text || current.payload.text || ''),
          streamStatus: 'completed',
        },
      };
    } else if (event.type === 'assistant.response.failed') {
      output[outputIndex] = {
        ...current,
        sequence: event.sequence,
        createdAt: event.createdAt,
        payload: {
          ...current.payload,
          streamStatus: 'failed',
          streamError: String(event.payload.message || '回复意外中断；已保留你的要求，可以直接重试。'),
        },
      };
    } else if (event.type === 'assistant.response.stopped') {
      output[outputIndex] = {
        ...current,
        sequence: event.sequence,
        createdAt: event.createdAt,
        payload: {
          ...current.payload,
          ...event.payload,
          text: String(event.payload.text || current.payload.text || ''),
          streamStatus: 'stopped',
          streamMessage: String(event.payload.message || '已停止本轮文字回复；画布里的生成任务没有被取消。'),
        },
      };
    }
  }
  const runActivityIndexes = new Map<string, number>();
  output.forEach((event, index) => {
    if (event.type !== 'run.event') return;
    const runId = String(event.payload.runId || '');
    if (!runId) return;
    runActivityIndexes.set(`${runId}:${String(event.payload.nodeRunId || 'run')}`, index);
  });
  return output.filter((event, index) => (
    event.type !== 'run.event'
    || runActivityIndexes.get(
      `${String(event.payload.runId || '')}:${String(event.payload.nodeRunId || 'run')}`,
    ) === index
  ));
}

const CREATOR_ACTIVITY_EVENT_TYPES = new Set([
  'plan.previewed',
  'plan.applied',
  'plan.reverted',
  'plan.failed',
  'artifact.sent-to-canvas',
  'run.linked',
  'run.event',
  'run.artifacts-verified',
  'delivery.approval-requested',
  'delivery.completed',
  'delivery.denied',
  'delivery.failed',
]);

function LifecycleActivity(props: { event: CreatorAgentEvent }) {
  const { event } = props;
  let tone = 'info';
  let title = '';
  let detail = '';
  let icon = <Clock3 size={15} />;
  if (event.type === 'plan.previewed') {
    const changeCount = Math.max(0, Number(event.payload.changeCount) || 0);
    title = '画布预览已准备';
    detail = `${changeCount} 项变更已核对，尚未写入画布`;
    icon = <WandSparkles size={15} />;
  } else if (event.type === 'plan.applied') {
    const revision = Math.max(0, Number(event.payload.appliedRevision) || 0);
    tone = 'success';
    title = '已添加到画布';
    detail = revision ? `画布已更新到 r${revision}；没有自动运行生成节点` : '画布变更已完成；没有自动运行生成节点';
    icon = <Check size={15} />;
  } else if (event.type === 'plan.reverted') {
    const revision = Math.max(0, Number(event.payload.revertedRevision) || 0);
    tone = 'success';
    title = '已撤回画布变更';
    detail = revision ? `画布已精确恢复并更新到 r${revision}` : '画布已按原 Patch 精确恢复';
    icon = <Undo2 size={15} />;
  } else if (event.type === 'plan.failed') {
    tone = 'danger';
    title = event.payload.stage === 'preview' ? '预览未完成' : '画布变更未完成';
    detail = String(event.payload.error || '没有修改画布，可检查后重试');
    icon = <X size={15} />;
  } else if (event.type === 'artifact.sent-to-canvas') {
    tone = 'success';
    title = '素材已发送到画布';
    detail = String(event.payload.name || event.payload.assetId || '真实素材引用已写入当前创作会话');
    icon = <Send size={15} />;
  } else if (event.type === 'run.event') {
    const status = String(event.payload.status || '').toLowerCase();
    const sourceType = String(event.payload.eventType || '');
    const progress = event.payload.progress == null
      ? null
      : Math.max(0, Math.min(100, Math.round(Number(event.payload.progress) || 0)));
    const terminalSuccess = /(?:succeeded|completed)/.test(`${status} ${sourceType}`);
    const terminalFailure = /(?:failed|stopped|interrupted|error)/.test(`${status} ${sourceType}`);
    const subject = event.payload.nodeRunId ? '节点任务' : '生成任务';
    if (terminalSuccess) {
      tone = 'success';
      title = `${subject}已完成`;
      icon = <Check size={15} />;
    } else if (terminalFailure) {
      tone = 'danger';
      title = `${subject}未完成`;
      icon = <X size={15} />;
    } else {
      title = progress == null ? `${subject}进行中` : `${subject}进行中 · ${progress}%`;
      icon = <Clock3 size={15} />;
    }
    detail = String(
      event.payload.error
      || event.payload.message
      || event.payload.phase
      || event.payload.status
      || '进度已经持久化，断线后会从当前位置继续显示',
    );
    if (event.payload.runId) detail += ` · Run ${String(event.payload.runId).slice(0, 8)}`;
  } else if (event.type === 'run.linked') {
    tone = 'success';
    title = '真实运行已关联';
    detail = event.payload.runIntentId
      ? `Run ${String(event.payload.runId).slice(0, 8)} · RunIntent ${String(event.payload.runIntentId).slice(0, 8)}`
      : `Run ${String(event.payload.runId).slice(0, 8)} · 已按权威 NodeRun 关联`;
    icon = <Check size={15} />;
  } else if (event.type === 'run.artifacts-verified') {
    const verified = event.payload.verified === true;
    tone = verified ? 'success' : 'danger';
    title = verified ? '本地产物核验通过' : '本地产物核验未通过';
    detail = verified
      ? '文件存在、SHA-256、格式魔数与运行关联均已核对'
      : '已记录真实失败证据，可在任务卡片查看并重新核验';
    icon = verified ? <Check size={15} /> : <X size={15} />;
  } else if (event.type === 'delivery.approval-requested') {
    const itemCount = Math.max(0, Number(event.payload.itemCount) || 0);
    const totalBytes = Math.max(0, Number(event.payload.totalBytes) || 0);
    title = '等待桌面交付确认';
    detail = `${itemCount} 个已核验素材 · ${formatArtifactBytes(totalBytes)}；确认前不会创建任何文件`;
    icon = <FolderOpen size={15} />;
  } else if (event.type === 'delivery.completed') {
    const itemCount = Math.max(0, Number(event.payload.itemCount) || 0);
    const totalBytes = Math.max(0, Number(event.payload.totalBytes) || 0);
    const packageDigest = String(event.payload.packageDigest || '').trim();
    tone = event.payload.valid === false ? 'danger' : 'success';
    title = event.payload.valid === false ? '交付包复核未通过' : '交付包已创建并复核';
    detail = `${String(event.payload.packageName || '交付包')} · ${itemCount} 项 · ${formatArtifactBytes(totalBytes)}${packageDigest ? ` · SHA-256 ${packageDigest.slice(0, 12)}…` : ''}`;
    icon = event.payload.valid === false ? <X size={15} /> : <PackageCheck size={15} />;
  } else if (event.type === 'delivery.denied') {
    tone = 'info';
    title = '已取消交付';
    detail = '没有创建文件，当前画布和已确认素材保持不变';
    icon = <X size={15} />;
  } else if (event.type === 'delivery.failed') {
    tone = 'danger';
    title = '交付未完成';
    detail = String(event.payload.error || '没有留下未核验的交付结果，可重新选择位置后再试');
    icon = <X size={15} />;
  } else {
    return null;
  }
  return (
    <CreatorAgentVisible>
    <article className={`t8-creator-agent-activity is-${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </article>
    </CreatorAgentVisible>
  );
}

const ACTIVE_RUN_STATUSES = new Set<RunDetail['status']>(['queued', 'running']);

function runFailureDetail(run: RunDetail) {
  const attempts = run.nodeRuns.flatMap((nodeRun) => nodeRun.attempts || []);
  const failedAttempt = [...attempts].reverse().find((attempt) => attempt.error);
  const error = failedAttempt?.error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return String(record.message || record.error || record.code || '').trim();
  }
  const summaryError = run.summary?.error;
  if (summaryError && typeof summaryError === 'object') {
    const record = summaryError as Record<string, unknown>;
    return String(record.message || record.error || record.code || '').trim();
  }
  return typeof summaryError === 'string' ? summaryError : '';
}

function formatArtifactBytes(value: number | null) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function creatorDistinctLineageValues(
  records: AssetLineageRecord[],
  pick: (record: AssetLineageRecord) => string | null | undefined,
) {
  return [...new Set(records.map((record) => String(pick(record) || '').trim()).filter(Boolean))].slice(0, 8);
}

function creatorAssetLineageSummary(
  asset: AssetRef,
  records: AssetLineageRecord[],
  total: number,
  hasMore: boolean,
  canvasId: string,
): NonNullable<CreatorAgentContext['assetLineage']>[number] {
  const ordered = [...records].sort((left, right) => (
    Number(right.canvasId === canvasId) - Number(left.canvasId === canvasId)
    || Number(right.createdAt || 0) - Number(left.createdAt || 0)
  ));
  return {
    assetId: asset.id,
    kind: asset.kind,
    label: String(asset.filename || asset.id).slice(0, 120),
    eventCount: Math.max(records.length, Number(total) || 0),
    relations: creatorDistinctLineageValues(ordered, (record) => record.relation),
    parentAssetIds: creatorDistinctLineageValues(ordered, (record) => record.parentAssetId),
    sourceNodeIds: creatorDistinctLineageValues(ordered, (record) => record.sourceNodeId),
    runIds: creatorDistinctLineageValues(ordered, (record) => record.runId),
    nodeRunIds: creatorDistinctLineageValues(ordered, (record) => record.nodeRunId),
    derivedOperations: creatorDistinctLineageValues(ordered, (record) => record.derivedOperation),
    truncated: hasMore || total > records.length,
  };
}

function creatorAssetPreviewUrl(asset: AssetRef) {
  const metadata = asset.metadata || {};
  const value = asset.kind === 'image'
    ? metadata.thumbnailUrl || asset.sourceUrl
    : asset.kind === 'video'
      ? metadata.thumbnailUrl || metadata.firstFrameUrl || metadata.contactSheetUrl || metadata.keyframeUrls?.[0]
      : asset.kind === 'audio'
        ? metadata.waveformUrl
        : metadata.modelPreviewUrl || metadata.thumbnailUrl;
  return typeof value === 'string' ? value : '';
}

function creatorAssetAttachmentKind(kind: AssetRef['kind']): CreatorAgentAttachmentKind {
  return kind === 'image'
    || kind === 'video'
    || kind === 'audio'
    || kind === 'text'
    ? kind
    : 'file';
}

function creatorProjectAssetMediaRef(assetId: string) {
  return `/api/project-assets/${encodeURIComponent(assetId)}/media`;
}

function uploadProgressLabel(task: CreatorAgentUploadTask) {
  if (task.status === 'failed') return task.error || '上传失败';
  if (task.status === 'queued') return '等待上传';
  if (task.percent !== null) return `${task.percent}% · 正在上传`;
  return `${formatArtifactBytes(task.loaded)} · 正在上传`;
}

function artifactVerificationFailure(verification: CreatorAgentArtifactVerification) {
  const reason = verification.reasons[0] || '';
  if (reason.startsWith('output_asset_blob_missing')) return '本地文件不存在';
  if (reason.startsWith('output_asset_blob_unreadable')) return '本地文件无法读取';
  if (reason.startsWith('output_asset_blob_changed')) return '核验时文件发生变化';
  if (reason.startsWith('output_asset_hash_mismatch')) return '文件内容与 SHA-256 记录不一致';
  if (reason.startsWith('output_asset_mime_mismatch')) return '文件格式与记录不一致';
  if (reason.startsWith('output_asset_corrupt')) return '文件损坏或无法识别';
  if (reason.startsWith('output_asset_unverified')) return '资产索引未确认可用';
  if (reason.startsWith('output_asset_missing')) return '节点没有持久化产物';
  if (reason.startsWith('attempt_')) return '缺少成功 Attempt 证据';
  if (reason.startsWith('node_run_')) return 'NodeRun 证据不完整';
  if (reason === 'run_not_completed') return 'Run 尚未完成';
  return reason ? `未通过：${reason}` : '没有可核验的产物';
}

function RealRunActivity(props: {
  run: RunDetail;
  assets: AssetRef[];
  link?: CreatorAgentRunLink;
  verification?: CreatorAgentArtifactVerification;
  verifying?: boolean;
  onVerify: (runId: string) => void;
  onFocusNode: (nodeId: string) => void;
}) {
  const { run } = props;
  const attempts = run.nodeRuns.reduce((total, nodeRun) => total + (nodeRun.attempts?.length || 0), 0);
  const outputs = new Set(run.nodeRuns.flatMap((nodeRun) => nodeRun.outputRefs || [])).size;
  const focusNodeId = run.nodeRuns
    .map((nodeRun) => String(nodeRun.originalNodeId || nodeRun.nodeId || '')).find(Boolean) || '';
  const presentation = {
    queued: { title: '真实任务正在排队', tone: 'info', icon: <Clock3 size={15} /> },
    running: {
      title: '真实任务正在运行',
      tone: 'info',
      icon: <LoaderCircle size={15} className="animate-spin" />,
    },
    succeeded: { title: '真实任务已完成', tone: 'success', icon: <Check size={15} /> },
    failed: { title: '真实任务失败', tone: 'danger', icon: <X size={15} /> },
    stopped: { title: '真实任务已停止', tone: 'danger', icon: <X size={15} /> },
    interrupted: { title: '真实任务被中断', tone: 'danger', icon: <X size={15} /> },
  }[run.status];
  const failure = runFailureDetail(run);
  const detail = failure || [
    `${run.nodeRuns.length} 个 NodeRun`,
    `${attempts} 次 Attempt`,
    `${outputs} 个产物引用`,
  ].join(' · ');
  return (
    <CreatorAgentVisible>
    <article className={`t8-creator-agent-run is-${presentation.tone}`}>
      <span>{presentation.icon}</span>
      <div>
        <strong>{presentation.title}</strong>
        <small>{detail}</small>
        {props.link && (
          <small className="t8-creator-agent-run__link">
            当前创作会话已验证 · 计划 {props.link.planId.slice(0, 8)}
            {props.link.runIntentId ? ` · RunIntent ${props.link.runIntentId.slice(0, 8)}` : ''}
          </small>
        )}
        {props.verification && (
          <small className={`t8-creator-agent-run__verification${props.verification.verified ? ' is-verified' : ' is-invalid'}`}>
            {props.verification.verified
              ? `物理产物已核验 · ${props.verification.assets.length} 项 · SHA-256 / 魔数 / 运行关联`
              : `物理产物未通过 · ${artifactVerificationFailure(props.verification)}`}
          </small>
        )}
        {props.assets.length > 0 && (
          <ul aria-label="已持久化资产索引">
            {props.assets.slice(0, 3).map((asset) => {
              const evidence = props.verification?.assets.find((item) => item.assetId === asset.id);
              return (
                <li key={asset.id}>
                  <span>{asset.filename || asset.id}</span>
                  <em>
                    {evidence
                      ? `${evidence.stored ? '物理通过' : '物理未通过'} · ${formatArtifactBytes(evidence.byteSize)} · ${evidence.detectedMimeType || asset.kind}`
                      : `${asset.kind} · ${asset.availability}（仅索引）`}
                  </em>
                </li>
              );
            })}
            {props.assets.length > 3 && <li>另有 {props.assets.length - 3} 个资产索引</li>}
          </ul>
        )}
      </div>
      <aside>
        <code title={run.id}>{run.id.slice(0, 8)}</code>
        {props.link && run.status === 'succeeded' && (
          <button
            type="button"
            disabled={props.verifying}
            title="只读取一次本地产物，核对 SHA-256、格式魔数和运行关联；不调用模型"
            onClick={() => props.onVerify(run.id)}
          >
            {props.verifying
              ? <><LoaderCircle size={10} className="animate-spin" />核验中</>
              : props.verification
                ? '重新核验'
                : '核验产物'}
          </button>
        )}
        {focusNodeId && (
          <button type="button" onClick={() => props.onFocusNode(focusNodeId)}>
            定位节点
          </button>
        )}
      </aside>
    </article>
    </CreatorAgentVisible>
  );
}

function planKindLabel(kind: string) {
  const labels: Record<string, string> = {
    story: 'Story 全流程',
    script: '剧本',
    image: '图像',
    'edit-image': '图像修改',
    video: '视频',
    'edit-video': '视频修改',
    audio: '音频',
    review: '检查实际候选',
    accept: '采用候选',
    lock: '锁定连续性',
    unlock: '解锁连续性',
    branch: '创建探索分支',
    rollback: '回到上一版',
    delivery: '作品交付包',
  };
  return labels[kind] || '创作计划';
}

function productionDocumentPreview(document: CreatorAgentProductionDocument) {
  const content = document.content || {};
  if (document.kind === 'production-brief') {
    return [
      content.audience ? `受众：${content.audience}` : '',
      content.format ? `形式：${content.format}` : '',
      content.ratio ? `画幅：${content.ratio}` : '',
      Number(content.durationSec) > 0 ? `时长：${content.durationSec} 秒` : '',
      content.style ? `风格：${content.style}` : '',
    ].filter(Boolean).join(' · ') || content.goal || '等待补充制作目标';
  }
  if (document.kind === 'reference-breakdown') {
    const source = content.sourceBinding;
    const evidence = content.resultEvidence;
    if (!source) return '尚未绑定参考视频；不会猜测镜头、时间码和声音。';
    const prefix = [
      `已绑定视频：${source.filename || source.assetId}`,
      `素材版本 r${source.contentRevision}`,
    ];
    const shots = Array.isArray(content.shots) ? content.shots : [];
    if (content.status === 'analysis-result-ready') {
      const runEvidenceLabel = evidence?.runBindingStatus === 'verified'
        ? '运行证据已核验'
        : evidence?.runBindingStatus === 'pending'
          ? '运行证据写入中'
          : evidence?.runBindingStatus === 'failed'
            ? '关联运行失败'
            : evidence?.runBindingStatus === 'invalid-run-evidence'
              ? '运行证据不匹配'
              : '运行证据待关联';
      return [...prefix, `已安全回收 ${shots.length} 个镜头`, runEvidenceLabel, '待创作者核对'].join(' · ');
    }
    if (content.status === 'analysis-running') {
      return [...prefix, '拉片节点正在运行', '不会重复创建工作流'].join(' · ');
    }
    if (content.status === 'analysis-failed') {
      return [...prefix, '拉片节点运行失败', content.analysisError || '请打开来源节点查看原因'].join(' · ');
    }
    if (content.status === 'analysis-output-invalid') {
      return [...prefix, '拉片结果未通过来源与结构校验', content.analysisError || '原始结果仍保留在节点中'].join(' · ');
    }
    if (content.status === 'analysis-workflow-present') {
      return [...prefix, '已有来源匹配的拉片节点', '等待节点返回可验证结果'].join(' · ');
    }
    return [...prefix, `${content.requestedScopes?.length || 0} 项拉片维度`, '镜头结果待运行后生成'].join(' · ');
  }
  if (document.kind === 'script-doc') {
    const analysis = content.scriptAnalysis;
    const sourceText = String(content.sourceText || '').replace(/\s+/g, ' ').trim();
    const structure = analysis?.status === 'source-structured'
      ? `已按原文识别 ${analysis.counts.scenes} 场 · ${analysis.counts.shots} 镜头 · ${analysis.counts.characters} 个明示人物`
      : '';
    return structure
      ? `${structure} · ${sourceText.slice(0, 180)}`
      : sourceText
        ? sourceText.slice(0, 260)
      : '原始剧本尚未提供，人物、场景与镜头结构保持未知。';
  }
  if (document.kind === 'character-bible') {
    const characters = Array.isArray(content.characters) ? content.characters : [];
    return characters.length > 0
      ? `${characters.length} 个原文明示角色 · 外观、服装、性格与连续性细节待补`
      : '原文没有明示人物标签；没有从正文名字或动作猜测角色。';
  }
  if (document.kind === 'asset-needs') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 个缺口 · 角色 ${counts.characters || 0} · 场景 ${counts.locations || 0} · 尚未生成`
      : '原文没有可验证的人物标签或场景标题；资产缺口保持空白。';
  }
  if (document.kind === 'shot-list') {
    const shots = Array.isArray(content.shots) ? content.shots : [];
    return shots.length > 0
      ? `${shots.length} 个原文明示镜头 · 时长、景别、运镜、声音与关联资产待补`
      : '原文没有明示镜头标题；没有从正文段落猜测镜头切分。';
  }
  if (document.kind === 'audio-plan') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 条原文明示声音 · 对白 ${counts.dialogue || 0} · 旁白 ${counts.voiceover || 0} · 音乐 ${counts.music || 0} · 环境声 ${counts.ambience || 0} · SFX ${counts.sfx || 0}`
      : '镜头原文没有明确声音标签；没有从“雨声”等正文描述猜测 AudioPlan。';
  }
  if (document.kind === 'storyboard') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 个待补分镜格 · 已采用 ${counts.ready || 0} · 缺失 ${counts.missing || 0}`
      : '镜头表没有可验证镜头；没有创建分镜候选或生成任务。';
  }
  if (document.kind === 'prompt-pack') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 条来源提示词草案 · 待审阅 ${counts.drafts || 0} · 已确认 ${counts.reviewed || 0}`
      : '分镜板没有可验证分镜格；没有创建空 Prompt 或生成任务。';
  }
  if (document.kind === 'candidate-review') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 个真实候选 · 有结果 ${counts.withResult || 0} · 已审 ${counts.reviewed || 0} · 已采用 ${counts.adopted || 0}`
      : '当前 PromptPack 版本还没有精确绑定的真实候选；不会拿旧候选或缩略图充当证据。';
  }
  if (document.kind === 'edit-decision-list') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 段已审并采用的视频 · 时间码就绪 ${counts.ready || 0} · 缺真实时长 ${counts.missingDuration || 0} · 缺镜头视频 ${counts.missingShots || 0}`
      : '当前还没有实际视频已审、硬门通过且采用回执有效的镜头；EDL 保持空白。';
  }
  if (document.kind === 'qc-report') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 段 · 通过 ${counts.pass || 0} · 失败 ${counts.fail || 0} · 待核验 ${counts.unknown || 0} · ${counts.checks || 0} 项检查`
      : '当前 EDL 没有可质检片段；QCReport 保持空白。';
  }
  if (document.kind === 'delivery-manifest') {
    const counts = content.counts || {};
    return Number(counts.total) > 0
      ? `${counts.total} 项交付物 · 已入包 ${counts.included || 0} · QC 阻断 ${counts.blocked || 0} · 待交付 ${counts.awaiting || 0} · 包内 ${counts.packageFiles || 0} 文件 · 许可未知 ${counts.licenseUnknown || 0}`
      : '当前 QCReport 没有可交付片段；DeliveryManifest 保持空白。';
  }
  const worldSummary = [
    content.visualStyle ? `视觉：${content.visualStyle}` : '',
    Array.isArray(content.continuityLocks) && content.continuityLocks.length > 0
      ? `连续性锁定 ${content.continuityLocks.length} 项`
      : '',
    Array.isArray(content.missingSections) && content.missingSections.length > 0
      ? `待补充：${content.missingSections.join('、')}`
      : '',
  ].filter(Boolean).join(' · ');
  return worldSummary || '人物、地点与世界规则尚未确认，未知设定保持空白。';
}

function productionDocumentIsConfirmed(
  document: CreatorAgentProductionDocument,
  confirmations: CreatorAgentProductionDocumentConfirmation[],
) {
  return document.status === 'confirmed' || confirmations.some((confirmation) => (
    confirmation.documentId === document.id
    && confirmation.versionId === document.versionId
    && confirmation.contentDigest === document.contentDigest
  ));
}

function productionDocumentSourceReady(
  document: CreatorAgentProductionDocument,
  documents: CreatorAgentProductionDocument[],
  confirmations: CreatorAgentProductionDocumentConfirmation[],
) {
  const derivation = document.content?.derivation;
  if (!derivation) return true;
  const source = documents.find((candidate) => (
    candidate.id === derivation.sourceDocumentId
    && candidate.versionId === derivation.sourceVersionId
    && candidate.contentDigest === derivation.sourceContentDigest
  ));
  return Boolean(source && productionDocumentIsConfirmed(source, confirmations));
}

function compactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

interface CreatorPatchPreviewItem {
  key: string;
  kind: 'node' | 'edge' | 'canvas';
  title: string;
  detail: string;
}

function creatorPatchRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function creatorPatchText(value: unknown, maxLength = 72) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(1, maxLength - 1))}…`
    : normalized;
}

function creatorPatchEntityLabel(value: unknown) {
  return creatorPatchText(value, 36) || '未知';
}

function creatorPatchPositionLabel(value: unknown) {
  const position = creatorPatchRecord(value);
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '位置沿用当前画布';
  return `位置 ${Math.round(x)}, ${Math.round(y)}`;
}

function creatorPatchEndpoint(nodeId: unknown, handle: unknown) {
  const node = creatorPatchEntityLabel(nodeId);
  const port = creatorPatchText(handle, 32);
  return port ? `${node}（端口 ${port}）` : node;
}

function creatorPatchPreviewItem(
  change: CanvasPatchChange,
  patch: CanvasPatch,
): CreatorPatchPreviewItem {
  const operation = patch.operations[change.operationIndex];
  const payload = creatorPatchRecord(operation?.payload);
  const key = `${change.operationIndex}:${change.type}:${change.targetId}`;
  const targetId = creatorPatchEntityLabel(change.targetId);

  if (change.type === 'node.add' || change.type === 'node.restore') {
    const node = creatorPatchRecord(payload.node);
    const nodeType = creatorPatchText(node.type, 40) || '节点';
    return {
      key,
      kind: 'node',
      title: `${change.type === 'node.add' ? '新增' : '恢复'} ${nodeType}`,
      detail: `节点 ${targetId} · ${creatorPatchPositionLabel(node.position)}`,
    };
  }
  if (change.type === 'node.move') {
    return {
      key,
      kind: 'node',
      title: '移动节点',
      detail: `节点 ${targetId} · ${creatorPatchPositionLabel(payload.position)}`,
    };
  }
  if (change.type === 'node.patch') {
    const fields = change.fields.slice(0, 8).map((field) => creatorPatchText(field, 36)).filter(Boolean);
    return {
      key,
      kind: 'node',
      title: '调整节点',
      detail: `节点 ${targetId} · 字段 ${fields.join('、') || '受控数据'}${change.fields.length > fields.length ? ` 等 ${change.fields.length} 项` : ''}`,
    };
  }
  if (change.type === 'node.delete') {
    return {
      key,
      kind: 'node',
      title: '删除节点',
      detail: `节点 ${targetId}${change.relatedEdgeIds?.length ? ` · 同时移除 ${change.relatedEdgeIds.length} 条关联连线` : ''}`,
    };
  }
  if (change.type === 'edge.add' || change.type === 'edge.restore') {
    const edge = creatorPatchRecord(payload.edge);
    return {
      key,
      kind: 'edge',
      title: `${change.type === 'edge.add' ? '新增' : '恢复'}连线`,
      detail: `${creatorPatchEndpoint(edge.source, edge.sourceHandle)} → ${creatorPatchEndpoint(edge.target, edge.targetHandle)} · 连线 ${targetId}`,
    };
  }
  if (change.type === 'edge.delete') {
    const nodes = (change.relatedNodeIds || []).map(creatorPatchEntityLabel);
    return {
      key,
      kind: 'edge',
      title: '删除连线',
      detail: `连线 ${targetId}${nodes.length ? ` · 关联 ${nodes.join('、')}` : ''}`,
    };
  }
  const viewport = creatorPatchRecord(payload.viewport);
  const zoom = Number(viewport.zoom);
  return {
    key,
    kind: 'canvas',
    title: '调整画布视口',
    detail: `${creatorPatchPositionLabel(viewport)}${Number.isFinite(zoom) ? ` · 缩放 ${zoom.toFixed(2)}` : ''}`,
  };
}

type DeliveryCardStatus = 'needs-target' | 'ready' | 'pending' | 'completed';

function PlanCard(props: {
  plan: CreatorAgentPlan;
  readinessReceipt: CreatorAgentLocalReadinessReceipt | null;
  busy: boolean;
  previewing: boolean;
  reverted: boolean;
  applied: boolean;
  runLinked: boolean;
  running: boolean;
  reverting: boolean;
  isLatestPlan: boolean;
  confirmingDocumentKey: string;
  documentConfirmations: CreatorAgentProductionDocumentConfirmation[];
  onConfirmDocuments: (plan: CreatorAgentPlan, documents: CreatorAgentProductionDocument[]) => void;
  onPreview: (plan: CreatorAgentPlan) => void;
  onRun: (plan: CreatorAgentPlan) => void;
  onRevert: (plan: CreatorAgentPlan) => void;
  deliveryStatus: DeliveryCardStatus;
  onPrepareDelivery: (plan: CreatorAgentPlan) => void;
  onRequestDelivery: (plan: CreatorAgentPlan) => void;
}) {
  const { plan } = props;
  const executableNodeId = String(plan.targets?.primaryNodeId || '').trim();
  const isDelivery = plan.kind === 'delivery' && Boolean(plan.delivery);
  const deliveryStatus = props.deliveryStatus;
  const modelDecisionReceipt = plan.modelDecisionReceipt;
  const requiredModelDecisions = modelDecisionReceipt?.decisions.filter((decision) => decision.required) || [];
  const hasCanvasPatch = Boolean(plan.patchId);
  const isReferenceBreakdownReview = plan.action === 'review.reference-breakdown';
  const isReferenceBreakdownRecovery = plan.action === 'recover.reference-breakdown';
  const blockedModelDecision = requiredModelDecisions.find((decision) => decision.status !== 'ready');
  const modelRunBlocked = Boolean(blockedModelDecision);
  const modelBlocker = blockedModelDecision
    ? blockedModelDecision.blockers[0]?.message
      || `${blockedModelDecision.kindLabel}模型还不能运行，请在模型设置中重新选择`
    : '';
  const productionDocuments = Array.isArray(plan.productionDocuments) ? plan.productionDocuments : [];
  const referenceBreakdownEvidence = productionDocuments
    .find((document) => document.kind === 'reference-breakdown')
    ?.content.resultEvidence;
  const referenceRunEvidenceVerified = referenceBreakdownEvidence?.runBindingStatus === 'verified';
  const pendingProductionDocuments = productionDocuments.filter((document) => (
    !productionDocumentIsConfirmed(document, props.documentConfirmations)
  ));
  const confirmedDocumentCount = productionDocuments.length - pendingProductionDocuments.length;

  const statusClass = isDelivery
    ? deliveryStatus === 'completed'
      ? 'is-applied'
      : deliveryStatus === 'ready'
        ? 'is-ready'
        : 'is-needs-input'
    : props.applied
      ? 'is-applied'
      : plan.ready && !modelRunBlocked
        ? 'is-ready'
        : 'is-needs-input';
  const statusLabel = isDelivery
    ? deliveryStatus === 'completed'
      ? '已交付'
      : deliveryStatus === 'pending'
        ? '待桌面确认'
        : deliveryStatus === 'ready'
          ? '已核对'
          : '待选位置'
    : props.applied
      ? '已在画布'
      : props.reverted
        ? '已撤回'
        : plan.ready ? (modelRunBlocked ? '模型待就绪' : '可预览') : '待补充';
  const visibleStatusLabel = isReferenceBreakdownReview
    ? referenceRunEvidenceVerified
      ? '结果证据已核验'
      : '结果待核对'
    : isReferenceBreakdownRecovery
      ? '来源节点待处理'
      : statusLabel;
  return (
    <CreatorAgentVisible>
    <article
      className="t8-creator-agent-plan"
      data-creator-agent-plan-id={plan.planId}
      data-readiness-schema={props.readinessReceipt?.schema}
      data-local-plan-ms={props.readinessReceipt?.localPlanMs}
      data-local-plan-target-ms={props.readinessReceipt?.targetMs}
      data-local-plan-within-target={props.readinessReceipt?.withinTarget ? 'true' : 'false'}
      data-plan-provider-calls={props.readinessReceipt?.sideEffects.providerCalls}
      data-plan-canvas-writes={props.readinessReceipt?.sideEffects.canvasWrites}
      data-plan-production-file-writes={props.readinessReceipt?.sideEffects.productionFileWrites}
    >
      <div className="t8-creator-agent-plan__top">
        <div>
          <span className="t8-creator-agent-kicker">可编辑计划</span>
          <strong>{planKindLabel(plan.kind)}</strong>
        </div>
        <span className={statusClass}>
          {visibleStatusLabel}
        </span>
      </div>
      <p>{plan.brief?.goal || plan.brief?.summary || '等待创作目标'}</p>
      <div className="t8-creator-agent-plan__facts">
        {plan.visibleAssumptions?.ratio && <span>{plan.visibleAssumptions.ratio}</span>}
        {Number(plan.visibleAssumptions?.durationSec) > 0 && (
          <span>{plan.visibleAssumptions?.durationSec} 秒</span>
        )}
        {Number(plan.analysis?.shotCount) > 0 && <span>{plan.analysis?.shotCount} 镜头</span>}
        {Number(plan.analysis?.assetCount) > 0 && <span>{plan.analysis?.assetCount} 资产</span>}
        {isDelivery ? (
          <>
            <span>{plan.delivery?.itemCount || 0} 个已核验素材</span>
            <span>{formatArtifactBytes(plan.delivery?.totalBytes || 0)}</span>
            <span>授权未知 {plan.delivery?.licenseSummary?.unknown || 0}</span>
          </>
        ) : (
          <span>{plan.impact?.patchOperationCount || 0} 项画布变更</span>
        )}
      </div>
      <div className="t8-creator-agent-plan__safety">
        <Check size={13} />
        {isDelivery
          ? deliveryStatus === 'completed'
            ? '交付包已按固定清单创建，并用独立固定摘要完成二次复核'
            : '当前 0 次模型调用、0 次写入；只收集已核验本地素材，创建文件前必须桌面确认'
          : props.applied
          ? '结构已写入；生成仍需进入现有运行体检和确认，不会静默调用模型'
          : '当前 0 次模型调用、0 次画布写入；保留已确认和锁定内容'}
      </div>
      {productionDocuments.length > 0 && (
        <details className="t8-creator-agent-production-documents">
          <summary>
            <span>创作前期文档</span>
            <small>{confirmedDocumentCount}/{productionDocuments.length} 已确认 · 可用一句话修改</small>
          </summary>
          <div className="t8-creator-agent-production-documents__body">
            {productionDocuments.map((document) => {
              const confirmed = productionDocumentIsConfirmed(document, props.documentConfirmations);
              const sourceReady = productionDocumentSourceReady(document, productionDocuments, props.documentConfirmations);
              const changeSummary = document.changeSummary;
              const confirming = props.confirmingDocumentKey === document.versionId
                || props.confirmingDocumentKey === 'all';
              return (
              <article
                key={document.versionId || document.id}
                className={confirmed ? 'is-confirmed' : ''}
              >
                <header>
                  <strong>{document.label}</strong>
                  <span>v{document.revision} · {confirmed ? '已确认' : '草稿'}</span>
                </header>
                <p>{productionDocumentPreview(document)}</p>
                {document.kind === 'script-doc'
                  && document.content.scriptAnalysis?.status === 'source-structured'
                  && Array.isArray(document.content.shots)
                  && document.content.shots.length > 0 && (
                  <details className="t8-creator-agent-script-analysis">
                    <summary>
                      原文结构 · {document.content.scriptAnalysis.counts.scenes} 场 / {document.content.scriptAnalysis.counts.shots} 镜头
                    </summary>
                    <ol>
                      {document.content.shots.slice(0, 12).map((shot) => (
                        <li key={shot.id}>
                          <span>{shot.ordinal}. {shot.title}</span>
                          <small>第 {shot.sourceRange.lineStart}-{shot.sourceRange.lineEnd} 行</small>
                        </li>
                      ))}
                    </ol>
                    {document.content.shots.length > 12 && (
                      <small>其余 {document.content.shots.length - 12} 个镜头保留在当前文档版本中</small>
                    )}
                    <p>只识别原文明示结构，模型调用 0 次，推断事实 0 项。</p>
                  </details>
                )}
                {document.kind === 'reference-breakdown' && (
                  <details className="t8-creator-agent-source-proposals">
                    {(() => {
                      const shots = Array.isArray(document.content.shots) ? document.content.shots : [];
                      const evidence = document.content.resultEvidence;
                      return (
                        <>
                    <summary>
                      真实参考视频 · {document.content.status === 'analysis-result-ready'
                        ? `已回收 ${shots.length} 镜头`
                        : document.content.sourceBinding ? '已绑定' : '待上传'}
                    </summary>
                    {document.content.sourceBinding ? (
                      <ol>
                        <li>
                          <span>{document.content.sourceBinding.filename}</span>
                          <small>
                            r{document.content.sourceBinding.contentRevision}
                            {' · '}SHA-256 {document.content.sourceBinding.contentHash?.slice(0, 12) || '未知'}
                          </small>
                        </li>
                      </ol>
                    ) : (
                      <p>请先上传或引用一个当前项目中的真实视频素材。</p>
                    )}
                    <p>
                      {(document.content.requestedScopes || []).join(' · ')}
                    </p>
                    {shots.length > 0 && (
                      <ol>
                        {shots.slice(0, 12).map((shot) => (
                          <li key={shot.id}>
                            <span>
                              #{shot.ordinal} {shot.startTimecode || '未知'}–{shot.endTimecode || '未知'}
                              {' · '}{shot.shotSize || '景别未知'}
                              {' · '}{shot.cameraMovement || '运镜未知'}
                            </span>
                            <small>{shot.action || shot.description || '主体动作未知'}</small>
                          </li>
                        ))}
                      </ol>
                    )}
                    {shots.length > 12 && (
                      <small>其余 {shots.length - 12} 个镜头保留在当前作品文档版本中</small>
                    )}
                    {document.content.analysisError && (
                      <p>{document.content.analysisError}</p>
                    )}
                    {document.content.status === 'analysis-result-ready' ? (
                      <>
                        <p>
                        结果来自节点 {evidence?.sourceNodeId || '未知'}
                        {evidence?.outputDigest ? ` · 输出摘要 ${evidence.outputDigest.slice(0, 12)}` : ''}
                        {' · '}确认只冻结此作品文档版本，不会重复运行 Provider。
                        </p>
                        <p>
                          {evidence?.runBindingStatus === 'verified'
                            ? `运行证据已核验：Run ${evidence.runId} · NodeRun ${evidence.nodeRunId} · Attempt ${evidence.attemptId}`
                            : `运行证据状态：${evidence?.runEvidenceReason || '尚未关联到可验证的 Run / NodeRun / Attempt'}`}
                        </p>
                      </>
                    ) : (
                      <p>{document.content.editingGuidance || '当前 Provider 调用 0 次、媒体生成 0 次、画布写入 0 次；确认后只创建分析工作流，不会自动运行。'}</p>
                    )}
                        </>
                      );
                    })()}
                  </details>
                )}
                {document.kind === 'candidate-review' && document.content.derivation && (
                  <details className="t8-creator-agent-source-proposals">
                    <summary>
                      真实候选证据 · {document.content.candidates?.length || 0} 项
                    </summary>
                    <ol>
                      {(document.content.candidates || []).slice(0, 10).map((candidate) => (
                        <li key={candidate.id}>
                          <span>
                            {candidate.candidateLabel}
                            {' · '}
                            {candidate.review.status === 'verified' ? '实际媒体已审' : '待检查实际媒体'}
                          </span>
                          <small>
                            {candidate.adoption.status === 'adopted'
                              ? '已显式采用'
                              : candidate.adoption.status === 'unverified-legacy'
                                ? '旧采用记录待复核'
                                : '未采用'}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {(document.content.candidates?.length || 0) > 10 && (
                      <small>其余 {(document.content.candidates?.length || 0) - 10} 项保留在当前证据版本中</small>
                    )}
                    <p>
                      {sourceReady ? 'PromptPack 来源版本已确认' : '先确认 PromptPack 来源版本'}
                      {' · '}本次汇总模型调用 0 次、画布写入 0 次
                    </p>
                  </details>
                )}
                {document.kind === 'edit-decision-list' && document.content.derivation && (
                  <details className="t8-creator-agent-source-proposals">
                    <summary>
                      EDL 剪辑顺序 · {document.content.sequence?.length || 0} 段
                    </summary>
                    <ol>
                      {(document.content.sequence || []).slice(0, 10).map((item) => (
                        <li key={item.id}>
                          <span>{item.ordinal}. {item.title}</span>
                          <small>
                            {item.timelineStartSec != null && item.timelineEndSec != null
                              ? `${item.timelineStartSec.toFixed(2)}s → ${item.timelineEndSec.toFixed(2)}s`
                              : item.requestedDurationSec
                                ? `缺真实时长（请求值 ${item.requestedDurationSec}s 不作时间码）`
                                : '缺真实媒体时长'}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {(document.content.sequence?.length || 0) > 10 && (
                      <small>其余 {(document.content.sequence?.length || 0) - 10} 段保留在当前 EDL 版本中</small>
                    )}
                    <p>
                      只纳入实际视频已审、硬门通过且采用回执有效的候选；请求时长仅作提示，不会冒充真实成片时长。
                    </p>
                    <p>
                      {sourceReady ? '候选审阅证据版本已确认' : '先确认候选审阅证据版本'}
                      {' · '}模型调用 0 次，画布写入 0 次
                    </p>
                  </details>
                )}
                {document.kind === 'qc-report' && document.content.derivation && (
                  <details className="t8-creator-agent-source-proposals">
                    <summary>
                      QC 质量检查 · {document.content.qcItems?.length || 0} 段
                    </summary>
                    <ol>
                      {(document.content.qcItems || []).slice(0, 10).map((item) => (
                        <li key={item.id}>
                          <span>{item.ordinal}. {item.title}</span>
                          <small>
                            {item.status === 'pass' ? '通过'
                              : item.status === 'fail' ? '失败' : '待核验'}
                            {' · '}{item.counts.pass}/{item.counts.total} 通过
                            {item.counts.fail > 0 ? ` · ${item.counts.fail} 失败` : ''}
                            {item.counts.unknown > 0 ? ` · ${item.counts.unknown} 未知` : ''}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {(document.content.qcItems?.length || 0) > 10 && (
                      <small>其余 {(document.content.qcItems?.length || 0) - 10} 段保留在当前 QCReport 版本中</small>
                    )}
                    <p>
                      只读取已持久化的文件、摘要、魔数、解码索引、尺寸、时长和 Run 关联回执；缺证据保持未知。
                    </p>
                    <p>
                      {sourceReady ? 'EDL 来源版本已确认' : '先确认 EDL 来源版本'}
                      {' · '}模型调用 0 次，文件扫描 0 次，画布写入 0 次
                    </p>
                  </details>
                )}
                {document.kind === 'delivery-manifest' && document.content.derivation && (
                  <details className="t8-creator-agent-source-proposals">
                    <summary>
                      DeliveryManifest 交付证据 · {document.content.deliverables?.length || 0} 项
                    </summary>
                    <ol>
                      {(document.content.deliverables || []).slice(0, 10).map((item) => (
                        <li key={item.id}>
                          <span>{item.ordinal}. {item.title}</span>
                          <small>
                            {item.status === 'included-and-verified'
                              ? '已包含并复核'
                              : item.status === 'blocked-by-qc'
                                ? '被 QC 阻断'
                                : '等待当前版本交付包'}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {(document.content.deliverables?.length || 0) > 10 && (
                      <small>其余 {(document.content.deliverables?.length || 0) - 10} 项保留在当前 DeliveryManifest 版本中</small>
                    )}
                    <p>
                      {document.content.packageEvidence
                        ? `交付包 ${document.content.packageEvidence.packageName || '未命名'} · ${document.content.packageEvidence.itemCount} 文件 · ${document.content.packageEvidence.verifiedBytes} 字节已复核`
                        : '尚无与当前 QC 资产、哈希和画布版本精确匹配的已完成交付包。'}
                    </p>
                    <p>
                      {sourceReady ? 'QCReport 来源版本已确认' : '先确认 QCReport 来源版本'}
                      {' · '}模型调用 0 次，交付文件写入 0 次，画布写入 0 次
                    </p>
                  </details>
                )}
                {document.content.derivation
                  && document.kind !== 'candidate-review'
                  && document.kind !== 'edit-decision-list'
                  && document.kind !== 'qc-report'
                  && document.kind !== 'delivery-manifest' && (
                  <details className="t8-creator-agent-source-proposals">
                    <summary>
                      {document.kind === 'character-bible'
                        ? `角色来源 · ${document.content.characters?.length || 0} 项`
                        : document.kind === 'asset-needs'
                          ? `资产缺口 · ${document.content.needs?.length || 0} 项`
                          : document.kind === 'shot-list'
                            ? `镜头表 · ${document.content.shots?.length || 0} 镜`
                            : document.kind === 'audio-plan'
                              ? `AudioPlan · ${document.content.items?.length || 0} 条`
                            : document.kind === 'storyboard'
                              ? `分镜板 · ${document.content.frames?.length || 0} 格`
                              : `PromptPack · ${document.content.prompts?.length || 0} 条`}
                    </summary>
                    <ol>
                      {(document.kind === 'character-bible'
                        ? (document.content.characters || []).map((item) => ({
                            id: item.id || item.name,
                            label: item.name,
                            kind: '角色',
                            evidence: item.sourceEvidence,
                          }))
                        : document.kind === 'asset-needs'
                          ? (document.content.needs || []).map((item) => ({
                              id: item.id,
                              label: item.label,
                              kind: item.kind === 'character' ? '角色' : '场景',
                              evidence: item.sourceEvidence,
                            }))
                          : document.kind === 'shot-list'
                            ? (document.content.shots || []).map((item) => ({
                                id: item.id,
                                label: `${item.ordinal}. ${item.title}`,
                                kind: item.sceneTitle ? `镜头 · ${item.sceneTitle}` : '镜头',
                                evidence: item.sourceEvidence,
                              }))
                            : document.kind === 'audio-plan'
                              ? (document.content.items || []).map((item) => ({
                                  id: item.id,
                                  label: `${item.shotOrdinal}. ${item.title} · ${item.cueText}`,
                                  kind: `${
                                    item.role === 'dialogue' ? '对白'
                                      : item.role === 'voiceover' ? '旁白'
                                        : item.role === 'music' ? '音乐'
                                          : item.role === 'ambience' ? '环境声'
                                            : 'SFX'
                                  }${item.sceneTitle ? ` · ${item.sceneTitle}` : ''}`,
                                  evidence: item.sourceEvidence,
                                }))
                            : document.kind === 'storyboard'
                              ? (document.content.frames || []).map((item) => ({
                                  id: item.id,
                                  label: `${item.ordinal}. ${item.title}`,
                                  kind: item.sceneTitle ? `分镜 · ${item.sceneTitle}` : '分镜',
                                  evidence: item.sourceEvidence,
                                }))
                              : (document.content.prompts || []).map((item) => ({
                                  id: item.id,
                                  label: `${item.ordinal}. ${item.title}`,
                                  kind: item.sceneTitle ? `Prompt · ${item.sceneTitle}` : 'Prompt',
                                  evidence: item.sourceEvidence,
                                }))).slice(0, 10).map((item) => (
                        <li key={item.id}>
                          <span>{item.kind} · {item.label}</span>
                          <small>原文第 {item.evidence?.lineStart || '?'} 行</small>
                        </li>
                      ))}
                    </ol>
                    <p>
                      {sourceReady ? '来源版本已确认' : '先确认来源版本，再确认这份草案'}
                      {' · '}模型调用 0 次，推断事实 0 项，素材生成 0 次，画布写入 0 次
                    </p>
                  </details>
                )}
                {changeSummary && changeSummary.changedFields.length > 0 && (
                  <details className="t8-creator-agent-production-document-diff">
                    <summary>
                      较 v{changeSummary.baseRevision} 改了 {changeSummary.changedFields.length} 项
                    </summary>
                    <ul>
                      {changeSummary.changedFields.map((change) => (
                        <li key={change.field}>
                          <strong>{change.label}</strong>
                          <span>{change.before}</span>
                          <ChevronRight size={10} />
                          <span>{change.after}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <small>
                  {document.content.derivation
                    ? sourceReady
                      ? document.kind === 'candidate-review'
                        ? '确认只固化此版真实候选、评审和采用回执；不会自动采用、锁定、运行或生成素材'
                        : document.kind === 'storyboard'
                        ? '确认只接受分镜结构；候选画面仍需创作者显式采用和锁定'
                        : document.kind === 'audio-plan'
                          ? '确认只接受此版 AudioPlan 文本与分轨结构；不会调用模型、生成音频、上传素材或提交任务'
                        : document.kind === 'qc-report'
                          ? '确认只固化此版 QC 证据与未知项；不会扫描文件、重新验证、下载、生成、渲染或交付'
                        : document.kind === 'edit-decision-list'
                          ? '确认只接受此版 EDL 顺序与默认完整片段/硬切草案；不会创建剪辑节点、修改时间线或渲染成片'
                        : document.kind === 'delivery-manifest'
                          ? '确认只固化当前交付证据；不会创建或覆盖文件、重新打包、下载、调用 Provider、渲染或写画布'
                        : document.kind === 'prompt-pack'
                          ? '确认只接受此版 PromptPack 文本与结构；不会调用模型、生成、采用或锁定素材'
                          : '可审阅和补充此版；确认不会上传、生成、采用、锁定或覆盖素材'
                      : '这是带来源证据的只读草案；请先确认对应来源版本'
                    : document.kind === 'script-doc'
                    ? document.content?.structureStatus === 'source-draft'
                      ? '尚未识别明确结构，不会把猜测写成人物、场景或镜头设定'
                      : '已建立原文行号映射；可先确认此版，再继续补充人物与镜头细节'
                    : '在下方直接说出修改要求；新版本不会覆盖上一版'}
                </small>
                {props.isLatestPlan && !confirmed && (
                  <button
                    type="button"
                    className="t8-creator-agent-production-document-confirm"
                    disabled={props.busy || Boolean(props.confirmingDocumentKey) || !sourceReady}
                    title={!sourceReady ? '请先确认这份草案对应的当前来源版本' : undefined}
                    onClick={() => props.onConfirmDocuments(plan, [document])}
                  >
                    {confirming
                      ? <><LoaderCircle size={11} className="animate-spin" />正在确认</>
                      : sourceReady
                        ? <><Check size={11} />确认此版</>
                        : '先确认来源'}
                  </button>
                )}
              </article>
              );
            })}
            {props.isLatestPlan && pendingProductionDocuments.length > 1 && (
              <button
                type="button"
                className="t8-creator-agent-production-documents__confirm-all"
                disabled={props.busy || Boolean(props.confirmingDocumentKey)}
                onClick={() => props.onConfirmDocuments(plan, pendingProductionDocuments)}
              >
                {props.confirmingDocumentKey === 'all'
                  ? <><LoaderCircle size={11} className="animate-spin" />正在确认当前版本</>
                  : <><Check size={11} />确认全部当前版本</>}
              </button>
            )}
          </div>
        </details>
      )}
      {modelDecisionReceipt && (
        <details className="t8-creator-agent-model-receipt">
          <summary>
            <span>模型选择依据 · {modelDecisionReceipt.mode === 'smart' ? '智能匹配' : modelDecisionReceipt.mode === 'fixed' ? '全部固定' : '混合选择'}</span>
            <small>
              {requiredModelDecisions.filter((decision) => decision.status === 'ready').length}/{requiredModelDecisions.length} 已就绪
            </small>
          </summary>
          <div className="t8-creator-agent-model-receipt__body">
            {modelDecisionReceipt.decisions.map((decision) => (
              <article key={decision.kind} className={decision.status === 'ready' ? 'is-ready' : 'is-blocked'}>
                <div>
                  <strong>{decision.kindLabel} · {decision.mode === 'fixed' ? '已固定' : '智能匹配'}</strong>
                  <span>{decision.status === 'ready' ? '可运行' : '待处理'}</span>
                </div>
                <b>{decision.selected
                  ? `${decision.selected.platformLabel} · ${decision.selected.label || decision.selected.model}`
                  : '没有可验证模型'}</b>
                <ul className="t8-creator-agent-model-receipt__reasons">
                  {(decision.reasons.length > 0 ? decision.reasons : ['已按当前输入和运行状态核对'])
                    .map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                <small>
                  输入兼容：{decision.inputCompatibility.status === 'compatible' ? '已核对' : '未验证'}
                  {decision.inputCompatibility.request.attachmentKinds.length > 0
                    ? ` · ${decision.inputCompatibility.request.attachmentKinds.join(' / ')} 输入`
                    : ' · 无附件'}
                  {decision.inputCompatibility.request.ratio
                    ? ` · ${decision.inputCompatibility.request.ratio}`
                    : ''}
                </small>
                {decision.inputCompatibility.limitations.map((limitation) => (
                  <em key={limitation}>兼容限制：{limitation}</em>
                ))}
                {decision.blockers[0]?.message && <em>{decision.blockers[0].message}</em>}
                <small>费用证据：{decision.estimates.cost.message}</small>
                <small>时延证据：{decision.estimates.latency.message}</small>
                {decision.alternatives.length > 0 && (
                  <details className="t8-creator-agent-model-receipt__alternatives">
                    <summary>查看 {decision.alternatives.length} 个兼容备选</summary>
                    <div>
                      {decision.alternatives.map((alternative) => (
                        <section key={alternative.id}>
                          <b>{alternative.platformLabel} · {alternative.label || alternative.model}</b>
                          <span>{alternative.executable ? '可运行' : '环境未就绪'}</span>
                          <small>{alternative.compatibility.reasons[0] || '与当前输入兼容'}</small>
                          {(alternative.compatibility.limitations[0] || alternative.blockers[0]?.message) && (
                            <em>{alternative.compatibility.limitations[0] || alternative.blockers[0]?.message}</em>
                          )}
                        </section>
                      ))}
                    </div>
                  </details>
                )}
              </article>
            ))}
            <small>{modelDecisionReceipt.approvalBoundary.costTier.message}</small>
            <small>{modelDecisionReceipt.approvalBoundary.privacyBoundary.message}</small>
            <footer>{modelDecisionReceipt.fallbackPolicy.message}</footer>
          </div>
        </details>
      )}
      {plan.questions?.map((question) => (
        <div className="t8-creator-agent-question" key={question.id}>
          <strong>{question.question}</strong>
          <span>{question.reason}</span>
        </div>
      ))}
      {isDelivery && deliveryStatus === 'completed' && (
        <button type="button" className="t8-creator-agent-primary is-linked" disabled>
          <PackageCheck size={15} />
          已创建并完成 SHA-256 复核
        </button>
      )}
      {isDelivery && deliveryStatus === 'pending' && (
        <button type="button" className="t8-creator-agent-primary" disabled>
          <LoaderCircle size={15} className="animate-spin" />
          等待桌面确认
        </button>
      )}
      {isDelivery && deliveryStatus === 'ready' && (
        <button
          type="button"
          className="t8-creator-agent-primary"
          disabled={props.busy}
          onClick={() => props.onRequestDelivery(plan)}
        >
          <PackageCheck size={15} />
          核对并创建交付包
        </button>
      )}
      {isDelivery && deliveryStatus === 'needs-target' && (
        <button
          type="button"
          className="t8-creator-agent-primary"
          disabled={props.busy}
          onClick={() => props.onPrepareDelivery(plan)}
        >
          <FolderOpen size={15} />
          选择交付位置
        </button>
      )}
      {!isDelivery && props.applied && props.runLinked && (
        <button type="button" className="t8-creator-agent-primary is-linked" disabled>
          <Check size={15} />
          已关联真实任务，请在下方查看
        </button>
      )}
      {!isDelivery && props.reverted && (
        <button type="button" className="t8-creator-agent-primary is-linked" disabled>
          <Undo2 size={15} />
          已撤回，画布已恢复
        </button>
      )}
      {!isDelivery && props.applied && !props.runLinked && executableNodeId && modelRunBlocked && (
        <button type="button" className="t8-creator-agent-primary is-model-blocked" disabled title={modelBlocker}>
          <WandSparkles size={15} />
          {modelBlocker}
        </button>
      )}
      {!isDelivery && props.applied && !props.runLinked && executableNodeId && !modelRunBlocked && (
        <button
          type="button"
          className="t8-creator-agent-primary is-run"
          disabled={props.busy || props.running}
          onClick={() => props.onRun(plan)}
        >
          {props.running
            ? <><LoaderCircle size={15} className="animate-spin" />正在等待运行结果</>
            : <><WandSparkles size={15} />开始运行（进入体检）</>}
        </button>
      )}
      {!isDelivery && props.applied && !props.runLinked && (
        <button
          type="button"
          className="t8-creator-agent-primary is-revert"
          disabled={props.busy || props.reverting}
          onClick={() => props.onRevert(plan)}
        >
          {props.reverting
            ? <><LoaderCircle size={15} className="animate-spin" />正在精确恢复画布</>
            : <><Undo2 size={15} />撤回这次画布变更</>}
        </button>
      )}
      {!isDelivery && !props.applied && !props.reverted && isReferenceBreakdownReview && (
        <button type="button" className="t8-creator-agent-primary is-linked" disabled>
          <Check size={15} />
          {referenceRunEvidenceVerified
            ? '拉片结果与运行证据已核验' : '拉片结果已回收，运行证据待核对'}
        </button>
      )}
      {!isDelivery && !props.applied && !props.reverted && isReferenceBreakdownRecovery && (
        <button type="button" className="t8-creator-agent-primary is-model-blocked" disabled>
          <RefreshCw size={15} />
          请处理来源拉片节点后继续
        </button>
      )}
      {!isDelivery && !props.applied && !props.reverted && plan.ready
        && hasCanvasPatch && !isReferenceBreakdownReview && !isReferenceBreakdownRecovery && (
        <button
          type="button"
          className="t8-creator-agent-primary"
          disabled={props.busy}
          onClick={() => props.onPreview(plan)}
        >
          {props.previewing
            ? <><LoaderCircle size={15} className="animate-spin" />正在生成画布预览</>
            : <><WandSparkles size={15} />预览并发送到画布</>}
        </button>
      )}
    </article>
    </CreatorAgentVisible>
  );
}

function CandidateMedia({ candidate }: { candidate: CreatorAgentCandidate }) {
  if (candidate.resultKind === 'text' && candidate.resultText) {
    return (
      <div
        className="t8-creator-agent-candidate__text"
        aria-label={`${candidate.candidateLabel} 实际文本候选`}
      >
        {candidate.resultText}
      </div>
    );
  }
  const url = candidate.resultUrls[0];
  if (!url) {
    return (
      <div className="t8-creator-agent-candidate__empty">
        {candidate.qa.warnings[0] || '候选还没有实际作品'}
      </div>
    );
  }
  if (candidate.resultKind === 'image') {
    return <img src={url} alt={`${candidate.candidateLabel} 实际图像候选`} loading="lazy" />;
  }
  if (candidate.resultKind === 'video') {
    return <video src={url} controls preload="metadata" aria-label={`${candidate.candidateLabel} 实际视频候选`} />;
  }
  if (candidate.resultKind === 'audio') {
    return (
      <div className="t8-creator-agent-candidate__audio">
        <FileAudio size={22} />
        <audio src={url} controls preload="metadata" aria-label={`${candidate.candidateLabel} 实际音频候选`} />
      </div>
    );
  }
  return (
    <div className="t8-creator-agent-candidate__text">
      {candidate.promptSummary || '暂无文本内容'}
    </div>
  );
}

function reviewDimensionLabel(value: string) {
  const labels: Record<string, string> = {
    composition: '构图与主体',
    identity: '角色一致性',
    productShape: '产品外形',
    continuity: '镜头连续性',
    rhythm: '节奏',
    textAccuracy: '文字正确性',
    intelligibility: '听感清晰度',
    timing: '时序与节拍',
    noise: '噪音与杂音',
    structure: '结构完整性',
  };
  return labels[value] || value;
}


function CandidateComparison(props: {
  comparison: CreatorAgentCandidateComparison;
  selectedNodeIds: string[];
  busyAction: string;
  availableCapabilityIds: Set<string>;
  onFocusNode: (nodeId: string) => void;
  onReview: (
    candidate: CreatorAgentCandidate,
    dimensions: Record<string, 'pass' | 'warn' | 'fail'>,
    notes: string,
  ) => void;
  onAction: (
    action: 'accept' | 'lock' | 'unlock' | 'branch' | 'rollback',
    candidate: CreatorAgentCandidate,
  ) => void;
}) {
  const { comparison } = props;
  const [reviewNodeId, setReviewNodeId] = useState('');
  const [reviewDimensions, setReviewDimensions] = useState<Record<string, 'pass' | 'warn' | 'fail' | ''>>({});
  const [reviewNotes, setReviewNotes] = useState('');
  const reviewCandidate = comparison.candidates.find((candidate) => candidate.nodeId === reviewNodeId) || null;
  const beginReview = (candidate: CreatorAgentCandidate) => {
    setReviewNodeId(candidate.nodeId);
    setReviewDimensions(Object.fromEntries(
      candidate.review.requiredDimensions.map((dimension) => [dimension, '']),
    ));
    setReviewNotes('');
  };
  const reviewComplete = Boolean(
    reviewCandidate
    && reviewCandidate.review.requiredDimensions.length
    && reviewCandidate.review.requiredDimensions.every((dimension) => reviewDimensions[dimension]),
  );
  return (
    <CreatorAgentVisible>
    <section className="t8-creator-agent-comparison" aria-label="真实候选对比">
      <header>
        <div>
          <span className="t8-creator-agent-kicker">真实作品对比</span>
          <strong>{comparison.candidates.length} 个候选</strong>
        </div>
        <small>已检查 {comparison.reviewCoverage.verified}/{comparison.reviewCoverage.totalWithResult}</small>
      </header>
      {comparison.requiresVisualReview && (
        <p className="t8-creator-agent-comparison__notice">
          请先检查实际作品。没有真实媒体评审证据时，“采用”会保持禁用。
        </p>
      )}
      <div className="t8-creator-agent-comparison__grid">
        {comparison.candidates.map((candidate) => {
          const selected = props.selectedNodeIds.includes(candidate.nodeId);
          const lockActive = Object.values(candidate.locks || {}).some(Boolean);
          const acceptReady = candidate.qa.creativeReady
            && !candidate.review.missingDimensions?.length
            && candidate.review.hardGatesPassed === true;
          const actionBusy = props.busyAction.endsWith(`:${candidate.nodeId}`);
          return (
            <article
              key={candidate.nodeId}
              className={[
                't8-creator-agent-candidate',
                selected ? 'is-selected' : '',
                candidate.accepted ? 'is-accepted' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="t8-creator-agent-candidate__media">
                <CandidateMedia candidate={candidate} />
              </div>
              <div className="t8-creator-agent-candidate__body">
                <div>
                  <strong>{candidate.candidateLabel}</strong>
                  <span className={acceptReady ? 'is-verified' : 'is-pending'}>
                    {candidate.accepted
                      ? '已采用'
                      : acceptReady
                        ? '真实检查通过'
                        : candidate.review.reason || '待实际检查'}
                  </span>
                </div>
                {candidate.creativeDirection && <p>{candidate.creativeDirection}</p>}
                <small>
                  {[candidate.provider, candidate.model].filter(Boolean).join(' · ') || candidate.nodeType}
                </small>
              </div>
              <div className="t8-creator-agent-candidate__actions">
                {props.availableCapabilityIds.has('iterate.review')
                  && candidate.hasResult
                  && Boolean(candidate.reviewEvidence.url
                    || candidate.reviewEvidence.assetId
                    || candidate.reviewEvidence.contentHash) && (
                  <button type="button" disabled={Boolean(props.busyAction)} onClick={() => beginReview(candidate)}>
                    <FileImage size={13} />{candidate.review.status === 'verified' ? '重查' : '检查'}
                  </button>
                )}
                {props.availableCapabilityIds.has('iterate.accept') && !candidate.accepted && (
                  <button
                    type="button"
                    disabled={!acceptReady || Boolean(props.busyAction)}
                    title={acceptReady ? '先生成预览，再由你确认采用' : '必须先完成真实作品检查且硬性检查通过'}
                    onClick={() => props.onAction('accept', candidate)}
                  >
                    <Check size={13} />采用
                  </button>
                )}
                {props.availableCapabilityIds.has(lockActive ? 'iterate.unlock' : 'iterate.lock') && (
                  <button
                    type="button"
                    disabled={Boolean(props.busyAction)}
                    onClick={() => props.onAction(lockActive ? 'unlock' : 'lock', candidate)}
                  >
                    <LockKeyhole size={13} />{lockActive ? '解锁' : '锁定'}
                  </button>
                )}
                {props.availableCapabilityIds.has('iterate.branch') && (
                  <button
                    type="button"
                    disabled={Boolean(props.busyAction)}
                    onClick={() => props.onAction('branch', candidate)}
                  >
                    {actionBusy ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />}
                    分支
                  </button>
                )}
                {candidate.versionCount > 0 && props.availableCapabilityIds.has('iterate.rollback') && (
                  <button
                    type="button"
                    disabled={Boolean(props.busyAction)}
                    onClick={() => props.onAction('rollback', candidate)}
                  >
                    <Undo2 size={13} />上一版
                  </button>
                )}
                <button
                  type="button"
                  disabled={Boolean(props.busyAction)}
                  onClick={() => props.onFocusNode(candidate.nodeId)}
                >
                  <ChevronRight size={13} />定位
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {reviewCandidate && (
        <section className="t8-creator-agent-review" aria-label={`检查 ${reviewCandidate.candidateLabel}`}>
          <header>
            <div>
              <span className="t8-creator-agent-kicker">创作者真实检查</span>
              <strong>{reviewCandidate.candidateLabel}</strong>
            </div>
            <button type="button" aria-label="关闭检查" onClick={() => setReviewNodeId('')}>
              <X size={14} />
            </button>
          </header>
          <p>请先播放或放大查看上方真实作品，再逐项选择。这里不会自动替你打“通过”。</p>
          <div className="t8-creator-agent-review__dimensions">
            {reviewCandidate.review.requiredDimensions.map((dimension) => (
              <label key={dimension}>
                <span>{reviewDimensionLabel(dimension)}</span>
                <select
                  value={reviewDimensions[dimension] || ''}
                  onChange={(event) => setReviewDimensions((current) => ({
                    ...current,
                    [dimension]: event.target.value as 'pass' | 'warn' | 'fail' | '',
                  }))}
                >
                  <option value="">待检查</option>
                  <option value="pass">通过</option>
                  <option value="warn">可接受但需注意</option>
                  <option value="fail">不通过</option>
                </select>
              </label>
            ))}
          </div>
          <textarea
            rows={2}
            value={reviewNotes}
            placeholder="可选：记录具体问题或保留理由"
            onChange={(event) => setReviewNotes(event.target.value)}
          />
          <button
            type="button"
            className="t8-creator-agent-review__submit"
            disabled={!reviewComplete || Boolean(props.busyAction)}
            onClick={() => {
              const completedDimensions: Record<string, 'pass' | 'warn' | 'fail'> = {};
              Object.entries(reviewDimensions).forEach(([dimension, status]) => {
                if (status === 'pass' || status === 'warn' || status === 'fail') {
                  completedDimensions[dimension] = status;
                }
              });
              props.onReview(
                reviewCandidate,
                completedDimensions,
                reviewNotes,
              );
              setReviewNodeId('');
            }}
          >
            <Check size={14} />生成检查预览
          </button>
        </section>
      )}
    </section>
    </CreatorAgentVisible>
  );
}

function workFieldText(value: unknown) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ''); }
}

function parseWorkFieldText(value: string, previous: unknown) {
  if (typeof previous === 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function CreatorWorkArtifactCard(props: {
  artifact: CreatorAgentWorkArtifactVersion;
  versions: CreatorAgentWorkArtifactVersion[];
  busyAction: string;
  onRevise: (
    artifact: CreatorAgentWorkArtifactVersion,
    action: 'edit' | 'lock' | 'unlock' | 'accept' | 'reject',
    field?: string,
    value?: unknown,
  ) => void;
}) {
  const [editingField, setEditingField] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState(props.artifact.versionId);
  useEffect(() => {
    setSelectedVersionId(props.artifact.versionId);
    setEditingField('');
  }, [props.artifact.versionId]);
  const history = [...props.versions].sort((left, right) => right.revision - left.revision);
  const displayedArtifact = history.find((version) => version.versionId === selectedVersionId)
    || props.artifact;
  const isLatestVersion = displayedArtifact.versionId === props.artifact.versionId;
  const fields = Object.entries(displayedArtifact.fields || {}).slice(0, 12);
  const busy = Boolean(props.busyAction);
  return (
    <article className={`t8-creator-work-card is-${displayedArtifact.status}`}>
      <header>
        <span>
          <strong>{displayedArtifact.title}</strong>
          <small>{displayedArtifact.kind} · v{displayedArtifact.revision}</small>
        </span>
        <em>{displayedArtifact.status === 'accepted'
          ? '已接受'
          : displayedArtifact.status === 'rejected'
            ? '已驳回'
            : displayedArtifact.status === 'creator-edited'
              ? '已编辑'
              : '模型草案'}</em>
      </header>
      {history.length > 1 && (
        <label className="t8-creator-work-card__version-picker">
          <span>查看版本</span>
          <select
            value={displayedArtifact.versionId}
            onChange={(event) => {
              setSelectedVersionId(event.currentTarget.value);
              setEditingField('');
            }}
          >
            {history.map((version) => (
              <option key={version.versionId} value={version.versionId}>
                V{version.revision} · {version.status} · {new Date(version.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {!isLatestVersion && (
        <p className="t8-creator-work-card__history-note">
          这是只读历史版本。切回最新版本后可以继续编辑、锁定或接受。
        </p>
      )}
      {displayedArtifact.diff.operations.length > 0 && (
        <details className="t8-creator-work-card__diff">
          <summary>与上一版的字段差异（{displayedArtifact.diff.operations.length}）</summary>
          <ul>
            {displayedArtifact.diff.operations.map((operation, index) => (
              <li key={`${operation.path}-${index}`}>
                <code>{operation.op}</code>
                <span>{operation.path}</span>
                {operation.beforeDigest && <small>原 {operation.beforeDigest.slice(0, 8)}</small>}
                {operation.afterDigest && <small>新 {operation.afterDigest.slice(0, 8)}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="t8-creator-work-card__fields">
        {fields.map(([field, value]) => {
          const path = `/fields/${field}`;
          const locked = displayedArtifact.fieldLocks.includes(path);
          const editing = editingField === field;
          return (
            <section key={field}>
              <header>
                <span>{field}</span>
                <div>
                  <button
                    type="button"
                    disabled={busy || !isLatestVersion || displayedArtifact.status === 'rejected'}
                    title={locked ? '解锁后允许后续修改' : '锁定后模型不得修改此字段'}
                    aria-label={locked ? `解锁 ${field}` : `锁定 ${field}`}
                    onClick={() => props.onRevise(
                      displayedArtifact,
                      locked ? 'unlock' : 'lock',
                      field,
                    )}
                  >
                    <LockKeyhole size={11} />{locked ? '已锁' : '锁定'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !isLatestVersion || displayedArtifact.status === 'rejected'}
                    title={locked ? '创作者仍可修改；字段锁只阻止模型自动改写' : '编辑并保存为新版本'}
                    onClick={() => {
                      setEditingField(editing ? '' : field);
                      setDraftValue(workFieldText(value));
                    }}
                  >
                    {editing ? '取消' : '编辑'}
                  </button>
                </div>
              </header>
              {editing ? (
                <div className="t8-creator-work-card__editor">
                  <textarea
                    value={draftValue}
                    rows={Math.min(8, Math.max(2, draftValue.split('\n').length))}
                    onChange={(event) => setDraftValue(event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !draftValue.trim()}
                    onClick={() => {
                      props.onRevise(
                        displayedArtifact,
                        'edit',
                        field,
                        parseWorkFieldText(draftValue, value),
                      );
                      setEditingField('');
                    }}
                  >保存新版本</button>
                </div>
              ) : (
                <p>{workFieldText(value)}</p>
              )}
            </section>
          );
        })}
      </div>
      {Object.keys(displayedArtifact.fields || {}).length > fields.length && (
        <small>其余字段仍完整保存在当前作品版本中</small>
      )}
      <footer>
        <button
          type="button"
          disabled={busy || !isLatestVersion || displayedArtifact.status === 'rejected'}
          onClick={() => props.onRevise(displayedArtifact, 'reject')}
        >驳回此版</button>
        <button
          type="button"
          disabled={busy || !isLatestVersion || displayedArtifact.status === 'accepted'}
          onClick={() => props.onRevise(displayedArtifact, 'accept')}
        ><Check size={12} />接受此版</button>
      </footer>
    </article>
  );
}

export default function CreatorAgentPanel(props: CreatorAgentPanelProps) {
  const { i18n } = useTranslation();
  const uiLocale = i18n.resolvedLanguage || i18n.language;
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<CreatorAgentSession | null>(null);
  const [draft, setDraft] = useState('');
  const [customIdeaDraft, setCustomIdeaDraft] = useState('');
  const [attachments, setAttachments] = useState<CreatorAgentAttachment[]>([]);
  const [referencedNodes, setReferencedNodes] = useState<CreatorAgentNodeReference[]>([]);
  const [uploadTasks, setUploadTasks] = useState<CreatorAgentUploadTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stoppingResponseId, setStoppingResponseId] = useState('');
  const [error, setError] = useState('');
  const [previewingPlanId, setPreviewingPlanId] = useState('');
  const [revertingPlanId, setRevertingPlanId] = useState('');
  const [placingAssetId, setPlacingAssetId] = useState('');
  const [preparingProposalId, setPreparingProposalId] = useState('');
  const [patchPreview, setPatchPreview] = useState<PatchPreviewState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [codexSummary, setCodexSummary] = useState<T8AgentControlConnectionSummary | null>(null);
  const [codexStatusError, setCodexStatusError] = useState('');
  const [codexRefreshing, setCodexRefreshing] = useState(false);
  const [codexCopied, setCodexCopied] = useState(false);
  const [capabilities, setCapabilities] = useState<CreatorAgentCapabilities | null>(null);
  const [runtimeCatalog, setRuntimeCatalog] = useState<CreatorAgentRuntimeCatalog | null>(null);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelPreferences, setModelPreferences] = useState<CreatorAgentModelPreferences>({});
  const [workQualityMode, setWorkQualityMode] = useState<CreatorAgentWorkQualityMode>(() => {
    if (typeof window === 'undefined') return 'standard';
    try {
      const stored = window.localStorage.getItem(
        `t8.creator-agent.quality.${props.projectId}.${props.canvasId}`,
      );
      return stored === 'quick' || stored === 'quality' ? stored : 'standard';
    } catch {
      return 'standard';
    }
  });
  const [workActionBusy, setWorkActionBusy] = useState('');
  const [runDetails, setRunDetails] = useState<RunDetail[]>([]);
  const [runSyncError, setRunSyncError] = useState('');
  const [connectionState, setConnectionState] = useState<
    'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped'
  >('idle');
  const [sessionHistory, setSessionHistory] = useState<CreatorAgentSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [assetsById, setAssetsById] = useState<Record<string, AssetRef>>({});
  const [assetLineage, setAssetLineage] = useState<NonNullable<CreatorAgentContext['assetLineage']>>([]);
  const [lineageReadError, setLineageReadError] = useState('');
  const [verifyingRunId, setVerifyingRunId] = useState('');
  const [runningPlanId, setRunningPlanId] = useState('');
  const [panelWidth, setPanelWidth] = useState(480);
  const [historyPage, setHistoryPage] = useState(0);
  const [candidateComparison, setCandidateComparison] = useState<CreatorAgentCandidateComparison | null>(null);
  const [candidateComparisonLoading, setCandidateComparisonLoading] = useState(false);
  const [candidateActionBusy, setCandidateActionBusy] = useState('');
  const [deliveryBusyPlanId, setDeliveryBusyPlanId] = useState('');
  const [confirmingDocumentKey, setConfirmingDocumentKey] = useState('');
  const [pendingStageContinuation, setPendingStageContinuation] =
    useState<PendingStageContinuation | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [starterIdeaRotation, setStarterIdeaRotation] = useState(0);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState<{
    eventId: string;
    text: string;
  } | null>(null);
  const [deliveryApproval, setDeliveryApproval] = useState<{
    approvalRequestId: string;
    planId: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const assetCacheRef = useRef(new Map<string, AssetRef>());
  const stickToBottomRef = useRef(true);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const uploadFilesRef = useRef(new Map<string, File>());
  const launcherButtonRef = useRef<HTMLButtonElement>(null);
  const panelShellRef = useRef<HTMLElement>(null);
  const launcherOpenedAtRef = useRef<number | null>(null);
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null);
  const [launcherPageVisible, setLauncherPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  const [launcherEffectsEnabled, setLauncherEffectsEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(CREATOR_EFFECTS_STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const composerFocusPendingRef = useRef(false);
  const composerComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const terminalMessageRequestsRef = useRef(
    new Map<string, 'completed' | 'failed' | 'stopped'>(),
  );
  const uploadGenerationRef = useRef(0);
  const uploadBatchActiveRef = useRef(false);
  const modelPreferenceStorageKey = useMemo(
    () => `t8.creator-agent.models.${props.projectId}.${props.canvasId}`,
    [props.canvasId, props.projectId],
  );
  const workQualityStorageKey = useMemo(
    () => `t8.creator-agent.quality.${props.projectId}.${props.canvasId}`,
    [props.canvasId, props.projectId],
  );
  const pendingMessageKey = useMemo(
    () => pendingMessageStorageKey(props.projectId, props.canvasId),
    [props.canvasId, props.projectId],
  );
  const selectedModelPreferenceCount = useMemo(
    () => CREATOR_MODEL_KINDS.filter((kind) => Boolean(modelPreferences[kind]?.model)).length,
    [modelPreferences],
  );

  const outputAssetIdsByNode = useMemo(() => {
    const result = new Map<string, string[]>();
    runDetails.forEach((run) => run.nodeRuns.forEach((nodeRun) => {
      const sourceNodeId = String(nodeRun.originalNodeId || nodeRun.nodeId || '');
      if (!sourceNodeId) return;
      const current = result.get(sourceNodeId) || [];
      result.set(sourceNodeId, [...new Set([...current, ...(nodeRun.outputRefs || [])])].slice(0, 6));
    }));
    return result;
  }, [runDetails]);

  const selectedOutputAssetIds = useMemo(() => {
    if (props.selectedNodeIds.length === 0) return [];
    return [...new Set(props.selectedNodeIds.flatMap(
      (nodeId) => outputAssetIdsByNode.get(nodeId) || [],
    ))].slice(0, 6);
  }, [outputAssetIdsByNode, props.selectedNodeIds]);
  const selectedOutputAssetKey = useMemo(
    () => JSON.stringify(selectedOutputAssetIds),
    [selectedOutputAssetIds],
  );
  const selectedOutputAssets = useMemo(
    () => selectedOutputAssetIds
      .map((assetId) => assetsById[assetId])
      .filter((asset): asset is AssetRef => Boolean(asset)),
    [assetsById, selectedOutputAssetIds],
  );
  const referencedAssetIds = useMemo(
    () => [...new Set(referencedNodes.flatMap((item) => item.assetIds))].slice(0, CREATOR_ATTACHMENT_LIMIT),
    [referencedNodes],
  );
  const referencedAssetAttachments = useMemo<CreatorAgentAttachment[]>(
    () => referencedAssetIds.flatMap((assetId) => {
      const asset = assetsById[assetId];
      if (!asset || asset.projectId !== props.projectId || asset.availability !== 'available') return [];
      return [{
        id: `node-ref:${asset.id}`,
        assetId: asset.id,
        kind: creatorAssetAttachmentKind(asset.kind),
        name: asset.filename || `${asset.kind} 素材`,
        ref: creatorProjectAssetMediaRef(asset.id),
        mimeType: asset.mimeType,
      }];
    }),
    [assetsById, props.projectId, referencedAssetIds],
  );
  const messageAttachments = useMemo(() => {
    const seen = new Set<string>();
    return [...attachments, ...referencedAssetAttachments].filter((attachment) => {
      const key = attachment.assetId || attachment.ref;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, CREATOR_ATTACHMENT_LIMIT);
  }, [attachments, referencedAssetAttachments]);
  const assetLineageById = useMemo(
    () => new Map(assetLineage.map((item) => [item.assetId, item])),
    [assetLineage],
  );

  const context = useMemo<CreatorAgentContext>(() => ({
    nodeCount: props.nodeCount,
    edgeCount: props.edgeCount,
    nodeTypeCounts: props.nodeTypeCounts,
    selectedNodeIds: props.selectedNodeIds,
    selectedNodeTypes: props.selectedNodeTypes,
    referencedNodeIds: referencedNodes.map((item) => item.nodeId),
    referencedNodeTypes: referencedNodes.map((item) => item.nodeType),
    canvasTitle: props.canvasTitle || '',
    canvasRevision: props.canvasRevision,
    phase: session?.phase || 'idea',
    viewport: props.viewport,
    failedRunCount: runDetails.filter((run) => (
      run.status === 'failed' || run.status === 'stopped' || run.status === 'interrupted'
    )).length,
    outputAssetCount: runDetails.reduce((total, run) => (
      total + run.nodeRuns.reduce((nodeTotal, nodeRun) => nodeTotal + nodeRun.outputRefs.length, 0)
    ), 0),
    canvasObjects: props.canvasObjects,
    offscreenSummary: props.offscreenSummary,
    recentActions: creatorRecentActions(session?.events || []),
    assetLineage,
    recentRuns: runDetails.slice(0, 5).map((run) => ({
      runId: run.id,
      status: run.status,
      nodeRunCount: run.nodeRuns.length,
      failedNodeCount: run.nodeRuns.filter((nodeRun) => (
        nodeRun.status === 'failed' || nodeRun.status === 'stopped' || nodeRun.status === 'interrupted'
      )).length,
      outputAssetCount: run.nodeRuns.reduce(
        (total, nodeRun) => total + nodeRun.outputRefs.length,
        0,
      ),
    })),
  }), [
    assetLineage,
    props.canvasObjects,
    props.canvasRevision,
    props.canvasTitle,
    props.edgeCount,
    props.nodeCount,
    props.nodeTypeCounts,
    props.offscreenSummary,
    props.selectedNodeIds,
    props.selectedNodeTypes,
    props.viewport,
    referencedNodes,
    runDetails,
    session?.events,
    session?.phase,
  ]);

  const starterIdeaContext = useMemo(
    () => ({
      canvasRevision: context.canvasRevision,
      nodeCount: context.nodeCount,
      edgeCount: context.edgeCount,
      selectedNodeTypes: context.selectedNodeTypes,
      referencedNodeTypes: context.referencedNodeTypes,
      attachmentKinds: messageAttachments.map((attachment) => attachment.kind),
      failedRunCount: context.failedRunCount,
      offscreenFailedCount: context.offscreenSummary?.failedCount,
    }),
    [
      context.canvasRevision,
      context.edgeCount,
      context.failedRunCount,
      context.nodeCount,
      context.offscreenSummary?.failedCount,
      context.referencedNodeTypes,
      context.selectedNodeTypes,
      messageAttachments,
    ],
  );
  const starterIdeaMode = useMemo(
    () => creatorAgentStarterMode(starterIdeaContext),
    [starterIdeaContext],
  );
  const starterIdeaContextKey = useMemo(
    () => creatorAgentStarterIdeaContextKey(starterIdeaContext),
    [starterIdeaContext],
  );
  const starterIdeaSessionSeed = session?.id || storageKey(props.projectId, props.canvasId);
  const starterIdeaRotationStorageKey = useMemo(
    () => [
      't8.creator-agent.starter-ideas.v2',
      props.projectId,
      props.canvasId,
      starterIdeaSessionSeed,
      starterIdeaMode,
      starterIdeaContextKey,
    ].join(':'),
    [
      props.canvasId,
      props.projectId,
      starterIdeaContextKey,
      starterIdeaMode,
      starterIdeaSessionSeed,
    ],
  );
  useEffect(() => {
    let nextRotation = 0;
    try {
      const saved = Number(localStorage.getItem(starterIdeaRotationStorageKey));
      if (Number.isInteger(saved) && saved >= 0) {
        nextRotation = saved % CREATOR_AGENT_STARTER_IDEA_BATCH_COUNT;
      }
    } catch {
      // Stable local ideas remain available when browser storage is unavailable.
    }
    setStarterIdeaRotation(nextRotation);
  }, [starterIdeaRotationStorageKey]);
  const rotateStarterIdeas = useCallback(() => {
    setStarterIdeaRotation((current) => {
      const next = (current + 1) % CREATOR_AGENT_STARTER_IDEA_BATCH_COUNT;
      try {
        localStorage.setItem(starterIdeaRotationStorageKey, String(next));
      } catch {
        // Rotation still works in memory for this open panel.
      }
      return next;
    });
  }, [starterIdeaRotationStorageKey]);
  const starterIdeas = useMemo(() => creatorAgentStarterIdeaBatch({
    sessionSeed: starterIdeaSessionSeed,
    contextKey: starterIdeaContextKey,
    mode: starterIdeaMode,
    rotation: starterIdeaRotation,
  }).map((idea) => localizeCreatorAgentStarterIdea(idea, uiLocale)), [
    starterIdeaContextKey,
    starterIdeaMode,
    starterIdeaRotation,
    starterIdeaSessionSeed,
    uiLocale,
  ]);

  const contextReceipt = useMemo(() => {
    const objects = context.canvasObjects || [];
    const referencedIds = new Set(context.referencedNodeIds || []);
    const referenced = referencedNodes.length > 0
      ? referencedNodes
      : objects.filter((item) => referencedIds.has(item.nodeId));
    const selected = objects.filter((item) => item.selected);
    const visible = objects.filter((item) => item.inViewport);
    const protectedCount = objects.filter((item) => item.accepted || item.lockKeys.length > 0).length;
    const resultCount = objects.reduce((total, item) => total + item.resultCount, 0);
    const latestAction = context.recentActions?.[0]?.label || '';
    const lineageCount = context.assetLineage?.length || 0;
    if (referenced.length > 0) {
      const labels = referenced.slice(0, 2).map((item) => `「${item.label}」`).join('、');
      return {
        title: `已固定引用 ${labels}`,
        detail: referencedAssetAttachments.length > 0
          ? `${referencedAssetAttachments.length} 项持久素材会随本轮要求发送`
          : `${referenced.length} 个对象会优先于临时选区进入下一步建议`,
      };
    }
    if (selected.length > 0) {
      const selectedLabels = selected.slice(0, 2).map((item) => `「${item.label}」`).join('、');
      return {
        title: `正在结合 ${selectedLabels} 及其上下游`,
        detail: lineageCount > 0 ? `${lineageCount} 项真实素材来源已核对` : (latestAction || `${selected.length} 个选中对象会优先进入下一步建议`),
      };
    }
    if (visible.length > 0) {
      const visibleLabels = visible.slice(0, 2).map((item) => `「${item.label}」`).join('、');
      return {
        title: `当前视口聚焦 ${visibleLabels}`,
        detail: lineageCount > 0
          ? `${lineageCount} 项真实素材来源已核对；视口对象会优先于会话阶段和全项目摘要`
          : `${visible.length} 个视口对象会优先于会话阶段和全项目摘要`,
      };
    }
    if ((context.offscreenSummary?.failedCount || 0) > 0) {
      return {
        title: `画布外有 ${context.offscreenSummary?.failedCount} 个异常对象`,
        detail: '下一步建议会优先定位问题，并保护已经完成的成果',
      };
    }
    return {
      title: `已理解 ${objects.length} 个关键对象 · ${resultCount} 个结果`,
      detail: protectedCount > 0 ? `${protectedCount} 个采用或锁定对象会保持不变` : (latestAction || '可直接用一句话继续创作'),
    };
  }, [
    context.assetLineage,
    context.canvasObjects,
    context.offscreenSummary,
    context.recentActions,
    context.referencedNodeIds,
    referencedAssetAttachments.length,
    referencedNodes,
  ]);

  const panelStyle = useMemo(() => ({
    '--creator-bg': props.themeTokens.panelBg,
    '--creator-bg-elevated': props.themeTokens.panelBgElevated,
    '--creator-bg-muted': props.themeTokens.panelBgMuted,
    '--creator-text': props.themeTokens.textMain,
    '--creator-muted': props.themeTokens.textMuted,
    '--creator-dim': props.themeTokens.textDim,
    '--creator-border': props.themeTokens.border,
    '--creator-border-strong': props.themeTokens.borderStrong,
    '--creator-accent': props.themeTokens.accent,
    '--creator-accent-hover': props.themeTokens.accentHover,
    '--creator-accent-text': props.themeTokens.accentText,
    '--creator-secondary': props.themeTokens.secondary,
    '--creator-success': props.themeTokens.success,
    '--creator-warning': props.themeTokens.warning,
    '--creator-danger': props.themeTokens.danger,
    '--creator-shadow': props.themeTokens.shadowPanel,
    '--creator-radius': props.themeTokens.radiusPanel,
    '--creator-button-radius': props.themeTokens.radiusButton,
    '--creator-font': props.themeTokens.fontFamily,
    '--creator-display-font': props.themeTokens.displayFont,
    '--creator-panel-width': `${panelWidth}px`,
  }) as CSSProperties, [panelWidth, props.themeTokens]);

  const launcherStyle = panelStyle;

  const refreshCodexConnection = useCallback(async () => {
    const bridge = window.t8pc?.agentControl;
    if (!bridge?.getConnectionSummary) {
      setCodexSummary(null);
      setCodexStatusError('当前浏览器环境不能读取桌面配对状态；请在桌面版核对验证码。');
      return;
    }
    setCodexRefreshing(true);
    setCodexStatusError('');
    try {
      const result = await bridge.getConnectionSummary();
      if (!result.success || !result.data) {
        setCodexSummary(null);
        setCodexStatusError(result.message || '暂时无法读取 Codex 连接状态');
        return;
      }
      setCodexSummary(result.data);
    } catch {
      setCodexSummary(null);
      setCodexStatusError('暂时无法读取 Codex 连接状态，请确认桌面端后端已经启动');
    } finally {
      setCodexRefreshing(false);
    }
  }, []);

  const closeAndRestoreLauncherFocus = useCallback(() => {
    composerFocusPendingRef.current = false;
    setOpen(false);
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus());
  }, []);

  const toggleLauncherEffects = useCallback(() => {
    setLauncherEffectsEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(CREATOR_EFFECTS_STORAGE_KEY, next ? 'on' : 'off');
      } catch {
        // The low-resource preference still applies for the current page.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setLauncherPageVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleVisibilityChange();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>(
      '[data-canvas-floating-ui="creator-agent-launcher-slot"]',
    );
    setLauncherHost(host);
    return () => setLauncherHost(null);
  }, [props.canvasId]);

  useLayoutEffect(() => {
    const shell = panelShellRef.current;
    if (!open || !shell) return undefined;
    const startedAt = launcherOpenedAtRef.current ?? performance.now();
    const commitMs = Math.max(0, performance.now() - startedAt);
    shell.dataset.shellReadinessSchema = CREATOR_SHELL_READINESS_SCHEMA;
    shell.dataset.shellCommitMs = commitMs.toFixed(3);
    shell.dataset.shellTargetMs = String(CREATOR_SHELL_TARGET_MS);
    shell.dataset.shellReadinessStatus = 'pending-paint';
    const frame = window.requestAnimationFrame(() => {
      const paintReadyMs = Math.max(0, performance.now() - startedAt);
      shell.dataset.shellPaintReadyMs = paintReadyMs.toFixed(3);
      shell.dataset.shellReadinessStatus = paintReadyMs <= CREATOR_SHELL_TARGET_MS
        ? 'within-target'
        : 'over-target';
      launcherOpenedAtRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (
      !open
      || !composerFocusPendingRef.current
      || busy
      || !session?.id
      || !capabilityContractReady(capabilities)
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const composer = composerRef.current;
      if (!composer || composer.disabled) return;
      composer.focus();
      composerFocusPendingRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, capabilities, open, session?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeAndRestoreLauncherFocus();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeAndRestoreLauncherFocus, open]);

  useEffect(() => {
    if (!open || !codexOpen) return undefined;
    void refreshCodexConnection();
    const timer = window.setInterval(() => {
      void refreshCodexConnection();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [codexOpen, open, refreshCodexConnection]);

  const copyCodexConnectPrompt = useCallback(async () => {
    setCodexCopied(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(CODEX_CONNECT_PROMPT);
      setCodexCopied(true);
      setCodexStatusError('');
    } catch {
      setDraft((current) => current.trim() ? current : CODEX_CONNECT_PROMPT);
      setCodexStatusError('系统没有开放剪贴板，已把一句话放入下方输入框，可手动复制到 Codex。');
    }
  }, []);

  useEffect(() => {
    const stored = Number(localStorage.getItem(CREATOR_PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      setPanelWidth(clampCreatorPanelWidth(stored));
    }
  }, []);

  const beginPanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    let latestWidth = panelWidth;
    const onPointerMove = (pointerEvent: PointerEvent) => {
      latestWidth = clampCreatorPanelWidth(startWidth + startX - pointerEvent.clientX);
      setPanelWidth(latestWidth);
    };
    const onPointerUp = () => {
      localStorage.setItem(CREATOR_PANEL_WIDTH_STORAGE_KEY, String(latestWidth));
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [panelWidth]);

  const resizePanelWithKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 16 : -16;
    setPanelWidth((current) => {
      const next = clampCreatorPanelWidth(current + delta);
      localStorage.setItem(CREATOR_PANEL_WIDTH_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const showOlderMessages = useCallback(() => {
    stickToBottomRef.current = false;
    setHistoryPage((current) => current + 1);
    window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  }, []);

  const showNewerMessages = useCallback(() => {
    setHistoryPage((current) => Math.max(0, current - 1));
  }, []);

  const ensureSession = useCallback(async (forceNew = false) => {
    if (!props.projectId || !props.canvasId) return null;
    setBusy(true);
    setError('');
    try {
      const key = storageKey(props.projectId, props.canvasId);
      const existingId = forceNew ? '' : String(localStorage.getItem(key) || '').trim();
      let next: CreatorAgentSession;
      const freshSessionContext: CreatorAgentContext = {
        ...context,
        phase: 'idea',
        recentActions: [],
      };
      const createFresh = () => createCreatorAgentSession({
        projectId: props.projectId,
        canvasId: props.canvasId,
        context: freshSessionContext,
      });
      if (forceNew) {
        next = await createFresh();
      } else if (existingId) {
        try {
          next = await getCreatorAgentSession(existingId, props.projectId, props.canvasId);
        } catch {
          localStorage.removeItem(key);
          next = await getLatestCreatorAgentSession(props.projectId, props.canvasId)
            || await createFresh();
        }
      } else {
        next = await getLatestCreatorAgentSession(props.projectId, props.canvasId)
          || await createFresh();
      }
      localStorage.setItem(key, next.id);
      setSession(next);
      setPatchPreview(null);
      setPendingStageContinuation(null);
      setHistoryPage(0);
      setSessionHistory((current) => [
        next,
        ...current.filter((item) => item.id !== next.id),
      ].slice(0, 20));
      setHistoryOpen(false);
      return next;
    } catch (sessionError) {
      setError(compactError(sessionError));
      return null;
    } finally {
      setBusy(false);
    }
  }, [context, props.canvasId, props.projectId]);

  const startNewConversation = useCallback(async () => {
    const next = await ensureSession(true);
    if (!next) return;
    const pending = readPendingCreatorMessage(pendingMessageKey);
    if (pending?.requestId) {
      clearPendingCreatorMessage(pendingMessageKey, pending.requestId);
    }
    terminalMessageRequestsRef.current.clear();
    setDraft('');
    setCustomIdeaDraft('');
    setAttachments([]);
    setReferencedNodes([]);
    setDetailsOpen(false);
    setHistoryOpen(false);
    setCodexOpen(false);
    composerFocusPendingRef.current = true;
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [ensureSession, pendingMessageKey]);

  useEffect(() => {
    if (!open || session || busy) return;
    void ensureSession();
  }, [busy, ensureSession, open, session]);

  useEffect(() => {
    if (!open || capabilities) return;
    let cancelled = false;
    void getCreatorAgentCapabilities()
      .then((value) => {
        if (cancelled) return;
        if (!capabilityContractReady(value)) {
          setError('创作能力清单与当前 Agent 不兼容，已停止执行以保护画布。请更新应用后重试。');
          return;
        }
        setCapabilities(value);
      })
      .catch((capabilityError) => {
        if (cancelled) return;
        setError(`无法核对创作能力清单，当前不会修改画布：${compactError(capabilityError)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilities, open]);

  useEffect(() => {
    setRuntimeCatalog(null);
    try {
      const saved = localStorage.getItem(modelPreferenceStorageKey);
      setModelPreferences(saved ? JSON.parse(saved) as CreatorAgentModelPreferences : {});
    } catch {
      setModelPreferences({});
    }
  }, [modelPreferenceStorageKey]);

  useEffect(() => {
    if (!open || runtimeCatalog) return;
    let cancelled = false;
    void getCreatorAgentRuntimeCatalog(props.projectId, props.canvasId)
      .then((value) => {
        if (!cancelled) setRuntimeCatalog(value);
      })
      .catch((catalogError) => {
        if (!cancelled) {
          setError(`选模目录暂时不可用，仍可保持“自动匹配”：${compactError(catalogError)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, props.canvasId, props.projectId, runtimeCatalog]);

  useEffect(() => {
    if (!runtimeCatalog) return;
    try {
      localStorage.setItem(modelPreferenceStorageKey, JSON.stringify(modelPreferences));
    } catch {
      // Local preference persistence is optional; the session still uses the current in-memory selection.
    }
  }, [modelPreferenceStorageKey, modelPreferences, runtimeCatalog]);

  useEffect(() => {
    if (!open || !session?.id) return undefined;
    const handleOffline = () => setConnectionState('reconnecting');
    const handleOnline = () => setConnectionState('connecting');
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (navigator.onLine === false) handleOffline();
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [open, session?.id]);

  useEffect(() => {
    if (!open || !session?.id) return undefined;
    let active = true;
    setConnectionState('connecting');
    let cursor = Number(session.lastSequence || 0);
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing) return;
      refreshing = true;
      try {
        const latest = await getCreatorAgentSession(session.id, props.projectId, props.canvasId);
        if (active && latest.id === session.id && Number(latest.lastSequence || 0) >= cursor) {
          cursor = Number(latest.lastSequence || cursor);
          setSession((current) => (
            current?.id === latest.id
              && Number(latest.lastSequence || 0) >= Number(current.lastSequence || 0)
              ? latest
              : current
          ));
        }
      } catch {
        // EventSource reconnects automatically; the current durable snapshot remains usable.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const close = subscribeCreatorAgentEvents({
      sessionId: session.id,
      projectId: props.projectId,
      canvasId: props.canvasId,
      after: cursor,
      onEvent(event) {
        if (active && navigator.onLine !== false) setConnectionState('open');
        if (event.type === 'assistant.response.started') {
          setScreenReaderAnnouncement(null);
        } else if (event.type === 'assistant.response.completed') {
          setScreenReaderAnnouncement({
            eventId: event.eventId,
            text: '贞贞创作 Agent 回复完成。下面有 3 个可直接继续的建议。',
          });
        } else if (event.type === 'assistant.response.stopped') {
          setScreenReaderAnnouncement({
            eventId: event.eventId,
            text: '贞贞创作 Agent 回复已停止。画布里的生成任务没有被取消。',
          });
        } else if (event.type === 'assistant.response.failed') {
          setScreenReaderAnnouncement({
            eventId: event.eventId,
            text: '贞贞创作 Agent 回复中断。你的要求已经保留，可以直接重试。',
          });
        }
        cursor = Math.max(cursor, Number(event.sequence) || cursor);
        setSession((current) => current?.id === event.sessionId
          ? mergeCreatorAgentSessionEvent(current, event)
          : current);
        const clientRequestId = String(event.payload?.clientRequestId || '');
        if (clientRequestId && [
          'assistant.plan',
          'assistant.response.completed',
          'assistant.response.failed',
          'assistant.response.stopped',
        ].includes(event.type)) {
          terminalMessageRequestsRef.current.set(
            clientRequestId,
            event.type === 'assistant.response.failed'
              ? 'failed'
              : event.type === 'assistant.response.stopped' ? 'stopped' : 'completed',
          );
          clearPendingCreatorMessage(pendingMessageKey, clientRequestId);
          if (event.type !== 'assistant.response.failed') setError('');
        }
        if (![
          'assistant.response.started',
          'assistant.response.delta',
        ].includes(event.type)) void refresh();
      },
      onCursorReset() {
        void refresh();
      },
      onStreamError(message) {
        setError(message);
      },
      onRunSyncError(message) {
        setRunSyncError(message);
      },
      onConnectionState(state) {
        if (active) setConnectionState(state);
      },
    });
    return () => {
      active = false;
      close();
    };
  }, [open, pendingMessageKey, props.canvasId, props.projectId, session?.id]);

  useEffect(() => {
    const nodeId = props.selectedNodeIds[0] || '';
    if (!open || !session?.id || !nodeId || !capabilities?.capabilities
      .some((capability) => capability.id === 'iterate.compare')) {
      setCandidateComparison(null);
      return undefined;
    }
    let cancelled = false;
    setCandidateComparisonLoading(true);
    void getCreatorAgentCandidateComparison(session.id, {
      projectId: props.projectId,
      canvasId: props.canvasId,
      nodeId,
    })
      .then((comparison) => {
        if (!cancelled) setCandidateComparison(comparison);
      })
      .catch((comparisonError) => {
        if (cancelled) return;
        const code = String((comparisonError as { code?: string })?.code || '');
        setCandidateComparison(null);
        if (!['CREATIVE_GROUP_REQUIRED', 'CREATIVE_NODE_NOT_FOUND'].includes(code)) {
          setError(`候选对比暂时无法读取：${compactError(comparisonError)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setCandidateComparisonLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    capabilities,
    open,
    props.canvasId,
    props.canvasRevision,
    props.projectId,
    props.selectedNodeIds,
    session?.id,
  ]);

  useEffect(() => {
    if (!open || !historyOpen || !props.projectId || !props.canvasId) return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    void listCreatorAgentSessions(props.projectId, props.canvasId, 20)
      .then((result) => {
        if (!cancelled) setSessionHistory(result.sessions);
      })
      .catch((historyError) => {
        if (!cancelled) setError(`会话历史暂时无法读取：${compactError(historyError)}`);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [historyOpen, open, props.canvasId, props.projectId]);

  const switchSession = useCallback((next: CreatorAgentSession) => {
    localStorage.setItem(storageKey(props.projectId, props.canvasId), next.id);
    setSession(next);
    setPatchPreview(null);
    setPendingStageContinuation(null);
    setAttachments([]);
    setReferencedNodes([]);
    setError('');
    setHistoryOpen(false);
    setHistoryPage(0);
  }, [props.canvasId, props.projectId]);

  useEffect(() => {
    if (!open || !props.projectId || !props.canvasId) return undefined;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      let delay = 8_000;
      try {
        const summaries = await api.listProjectRuns({
          projectId: props.projectId,
          canvasId: props.canvasId,
          limit: 3,
        });
        const details = await Promise.all(summaries.slice(0, 3).map(async (summary) => {
          try {
            return await api.getProjectRun(summary.id);
          } catch {
            return { ...summary, nodeRuns: [] } satisfies RunDetail;
          }
        }));
        let linkSyncError = '';
        if (session?.id && details.length) {
          try {
            const reconciled = await reconcileCreatorAgentRunLinks(session.id, {
              projectId: props.projectId,
              canvasId: props.canvasId,
              runIds: details.map((run) => run.id),
            });
            if (!disposed) setSession((current) => (
              current?.id === reconciled.session.id
                && Number(reconciled.session.lastSequence) >= Number(current.lastSequence)
                ? reconciled.session
                : current
            ));
          } catch (linkError) {
            linkSyncError = `运行关联暂时无法核对：${compactError(linkError)}`;
          }
        }
        const assetIds = [...new Set(details.flatMap((run) => (
          run.nodeRuns.flatMap((nodeRun) => nodeRun.outputRefs || [])
        )))].slice(0, 12);
        const missingIds = assetIds.filter((assetId) => !assetCacheRef.current.has(assetId));
        const resolved = await Promise.allSettled(missingIds.map((assetId) => api.getProjectAsset(assetId)));
        resolved.forEach((result) => {
          if (result.status === 'fulfilled') assetCacheRef.current.set(result.value.id, result.value);
        });
        if (!disposed) {
          setRunDetails(details);
          setRunSyncError(linkSyncError);
          setAssetsById(Object.fromEntries(assetIds.flatMap((assetId) => {
            const asset = assetCacheRef.current.get(assetId);
            return asset ? [[assetId, asset]] : [];
          })));
          delay = details.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ? 2_500 : 8_000;
        }
      } catch (runError) {
        if (!disposed) setRunSyncError(compactError(runError));
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), delay);
      }
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [open, props.canvasId, props.projectId, session?.id]);

  useEffect(() => {
    let assetIds: string[] = [];
    try {
      const parsed = JSON.parse(selectedOutputAssetKey);
      assetIds = Array.isArray(parsed) ? parsed.map(String).slice(0, 6) : [];
    } catch {
      assetIds = [];
    }
    if (!open || assetIds.length === 0) {
      setAssetLineage([]);
      setLineageReadError('');
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    void Promise.allSettled(assetIds.map(async (assetId) => {
      let asset = assetCacheRef.current.get(assetId);
      if (!asset) {
        asset = await api.getProjectAsset(assetId, { signal: controller.signal });
        assetCacheRef.current.set(asset.id, asset);
      }
      if (asset.projectId !== props.projectId) throw new Error('素材不属于当前项目');
      const page = await api.listProjectAssetLineage(assetId, { limit: 12, signal: controller.signal });
      return creatorAssetLineageSummary(asset, page.items, page.total, page.hasMore, props.canvasId);
    })).then((results) => {
      if (disposed) return;
      const summaries = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const failed = results.length - summaries.length;
      setAssetLineage(summaries);
      setLineageReadError(failed > 0 ? `${failed} 项素材来源暂时无法读取；现有成果不受影响` : '');
    });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [open, props.canvasId, props.projectId, selectedOutputAssetKey]);

  useEffect(() => {
    if (!open || historyPage !== 0 || !stickToBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [historyPage, open, session?.lastSequence]);

  const trackMessageScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element) stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
  }, []);

  useEffect(() => {
    uploadGenerationRef.current += 1;
    uploadBatchActiveRef.current = false;
    uploadControllersRef.current.forEach((controller) => controller.abort());
    uploadControllersRef.current.clear();
    uploadFilesRef.current.clear();
    setUploadTasks([]);
    setUploading(false);
    setSession(null);
    setPatchPreview(null);
    setPendingStageContinuation(null);
    setAttachments([]);
    setCustomIdeaDraft('');
    setReferencedNodes([]);
    setError('');
    setRunDetails([]);
    setRunSyncError('');
    setSessionHistory([]);
    setAssetsById({});
    setHistoryPage(0);
    setCandidateComparison(null);
    setCandidateActionBusy('');
    setDeliveryBusyPlanId('');
    setDeliveryApproval(null);
    stickToBottomRef.current = true;
    assetCacheRef.current.clear();
  }, [props.canvasId, props.projectId]);

  useEffect(() => () => {
    uploadGenerationRef.current += 1;
    uploadBatchActiveRef.current = false;
    uploadControllersRef.current.forEach((controller) => controller.abort());
    uploadControllersRef.current.clear();
    uploadFilesRef.current.clear();
  }, []);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (uploadBatchActiveRef.current) {
      setError('已有附件正在上传，可单独取消后再添加。');
      return;
    }
    const accepted = files.slice(0, Math.max(0, CREATOR_ATTACHMENT_LIMIT - attachments.length));
    if (!accepted.length) {
      setError(`一次对话最多添加 ${CREATOR_ATTACHMENT_LIMIT} 个附件。`);
      return;
    }

    const generation = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = generation;
    uploadBatchActiveRef.current = true;
    setUploading(true);
    setError('');
    const records = accepted.map((file) => {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      uploadControllersRef.current.set(id, controller);
      uploadFilesRef.current.set(id, file);
      return {
        file,
        controller,
        task: {
          id,
          name: file.name,
          kind: attachmentKind(file),
          loaded: 0,
          total: file.size || null,
          percent: 0,
          status: 'queued',
        } satisfies CreatorAgentUploadTask,
      };
    });
    setUploadTasks((current) => [...current, ...records.map((record) => record.task)]);
    const failures: string[] = [];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < records.length) {
        const record = records[nextIndex];
        nextIndex += 1;
        if (record.controller.signal.aborted) {
          setUploadTasks((current) => current.filter((task) => task.id !== record.task.id));
          uploadControllersRef.current.delete(record.task.id);
          uploadFilesRef.current.delete(record.task.id);
          continue;
        }
        setUploadTasks((current) => current.map((task) => (
          task.id === record.task.id ? { ...task, status: 'uploading' } : task
        )));
        try {
          const result = await api.uploadResourceLocalFile(record.file, {
            projectId: props.projectId,
            canvasId: props.canvasId,
            sourceNodeType: 'creator-agent',
          }, {
            signal: record.controller.signal,
            onProgress: (progress) => {
              if (generation !== uploadGenerationRef.current) return;
              setUploadTasks((current) => current.map((task) => (
                task.id === record.task.id ? { ...task, ...progress, status: 'uploading' } : task
              )));
            },
          });
          if (generation !== uploadGenerationRef.current) continue;
          setAttachments((current) => [...current, {
            id: result.assetId || record.task.id,
            assetId: result.assetId || undefined,
            kind: record.task.kind,
            name: record.file.name,
            ref: result.url,
            mimeType: record.file.type,
            size: record.file.size,
          } satisfies CreatorAgentAttachment].slice(0, CREATOR_ATTACHMENT_LIMIT));
          setUploadTasks((current) => current.filter((task) => task.id !== record.task.id));
          uploadFilesRef.current.delete(record.task.id);
        } catch (uploadError) {
          if (record.controller.signal.aborted || (
            uploadError instanceof DOMException && uploadError.name === 'AbortError'
          )) {
            setUploadTasks((current) => current.filter((task) => task.id !== record.task.id));
            uploadFilesRef.current.delete(record.task.id);
            continue;
          }
          if (generation !== uploadGenerationRef.current) continue;
          const message = compactError(uploadError);
          failures.push(`${record.file.name}：${message}`);
          setUploadTasks((current) => current.map((task) => (
            task.id === record.task.id
              ? { ...task, status: 'failed', error: message }
              : task
          )));
        } finally {
          uploadControllersRef.current.delete(record.task.id);
        }
      }
    };

    try {
      await Promise.all(Array.from(
        { length: Math.min(CREATOR_UPLOAD_MAX_CONCURRENCY, records.length) },
        () => worker(),
      ));
      if (generation === uploadGenerationRef.current && failures.length > 0) {
        setError(`有 ${failures.length} 个附件未上传：${failures.slice(0, 2).join('；')}`);
      }
    } finally {
      if (generation === uploadGenerationRef.current) {
        uploadBatchActiveRef.current = false;
        setUploading(false);
      }
    }
  }, [attachments.length, props.canvasId, props.projectId]);

  const cancelUpload = useCallback((taskId: string) => {
    uploadControllersRef.current.get(taskId)?.abort();
    uploadFilesRef.current.delete(taskId);
    setUploadTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const retryUpload = useCallback((taskId: string) => {
    if (uploadBatchActiveRef.current) {
      setError('已有附件正在上传，请稍后重试这个失败项。');
      return;
    }
    const file = uploadFilesRef.current.get(taskId);
    if (!file) {
      setError('原文件已不在当前会话中，请重新选择后上传。');
      return;
    }
    uploadFilesRef.current.delete(taskId);
    setUploadTasks((current) => current.filter((task) => task.id !== taskId));
    void uploadFiles([file]);
  }, [uploadFiles]);

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void uploadFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void uploadFiles(Array.from(event.dataTransfer.files || []));
  };

  const confirmProductionDocuments = useCallback(async (
    plan: CreatorAgentPlan,
    documents: CreatorAgentProductionDocument[],
    suggestion?: CreatorAgentSuggestion,
  ) => {
    if (!session || busy || confirmingDocumentKey || documents.length === 0) return;
    setConfirmingDocumentKey(documents.length > 1 ? 'all' : documents[0].versionId);
    setError('');
    try {
      const result = await confirmCreatorAgentProductionDocuments(session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        documents: documents.map((document) => ({
          documentId: document.id,
          versionId: document.versionId,
          contentDigest: document.contentDigest,
        })),
        suggestion: {
          id: String(suggestion?.id || ''),
          setDigest: String(session.suggestionSet?.setDigest || ''),
        },
      });
      setSession(result.session);
      if (result.canvasRetention) {
        const previewResult = await props.onPreviewPatch(result.canvasRetention.patch);
        setPatchPreview({
          plan: result.canvasRetention.plan,
          patch: previewResult.patch,
          preview: previewResult.preview,
        });
      }
      return result;
    } catch (confirmationError) {
      setError(compactError(confirmationError));
      return null;
    } finally {
      setConfirmingDocumentKey('');
    }
  }, [
    busy,
    confirmingDocumentKey,
    props.canvasId,
    props.onPreviewPatch,
    props.projectId,
    session,
  ]);

  const pinSelectedNodes = useCallback(() => {
    if (props.selectedNodeIds.length === 0) {
      setError('请先在画布上选中要引用的节点。');
      return;
    }
    setReferencedNodes((current) => {
      const byId = new Map(current.map((item) => [item.nodeId, item]));
      props.selectedNodeIds.slice(0, CREATOR_REFERENCE_LIMIT).forEach((nodeId, index) => {
        const object = props.canvasObjects.find((item) => item.nodeId === nodeId);
        const existing = byId.get(nodeId);
        byId.set(nodeId, {
          nodeId,
          nodeType: object?.nodeType || props.selectedNodeTypes[index] || existing?.nodeType || 'unknown',
          label: object?.label || existing?.label || props.selectedNodeTypes[index] || '画布对象',
          assetIds: [...new Set([
            ...(existing?.assetIds || []),
            ...(outputAssetIdsByNode.get(nodeId) || []),
          ])].slice(0, 6),
        });
      });
      return [...byId.values()].slice(0, CREATOR_REFERENCE_LIMIT);
    });
    setError('');
  }, [
    outputAssetIdsByNode,
    props.canvasObjects,
    props.selectedNodeIds,
    props.selectedNodeTypes,
  ]);

  const submit = useCallback(async (
    value = draft,
    suggestion?: { id: string; setDigest: string },
    options: { stageContinuation?: boolean } = {},
  ) => {
    const text = value.trim();
    if ((!text && messageAttachments.length === 0 && !suggestion) || busy || uploading) return;
    if (!capabilityContractReady(capabilities)) {
      setError('正在核对可用创作能力，请稍候再发送。当前没有修改画布或调用模型。');
      return;
    }
    const activeSession = session || await ensureSession();
    if (!activeSession) return;
    const requestSignature = JSON.stringify({
      text,
      suggestion: suggestion || null,
      attachments: messageAttachments.map((attachment) => ({
        id: attachment.id,
        assetId: attachment.assetId,
        kind: attachment.kind,
        ref: attachment.ref,
        size: attachment.size,
      })),
      context,
      modelPreferences,
      qualityMode: workQualityMode,
      stageContinuation: options.stageContinuation === true,
    });
    const existingPending = readPendingCreatorMessage(pendingMessageKey);
    const pendingRequest = existingPending?.signature === requestSignature
      ? existingPending
      : {
          requestId: crypto.randomUUID(),
          signature: requestSignature,
        };
    writePendingCreatorMessage(pendingMessageKey, pendingRequest);
    setBusy(true);
    setError('');
    setDraft('');
    try {
      const turn = await sendCreatorAgentMessage(activeSession.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        text,
        clientRequestId: pendingRequest.requestId,
        attachments: messageAttachments,
        context,
        modelPreferences,
        qualityMode: workQualityMode,
        stageContinuation: options.stageContinuation === true,
        ...(suggestion ? { suggestion } : {}),
      });
      setSession(turn.session);
      setPatchPreview(null);
      if (turn.request?.status === 'stopped') {
        setDraft(text);
        clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
      } else if (turn.request?.status === 'in-progress') {
        setConnectionState('reconnecting');
      } else {
        setAttachments([]);
        setReferencedNodes([]);
        clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
      }
    } catch (sendError) {
      try {
        const recovered = await recoverCreatorAgentMessageRequest(
          activeSession.id,
          pendingRequest.requestId,
          {
            projectId: props.projectId,
            canvasId: props.canvasId,
          },
        );
        setSession(recovered.session);
        if (recovered.status === 'stopped') {
          setDraft(text);
          setPatchPreview(null);
          clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
          setError('');
        } else if (recovered.status === 'completed') {
          setAttachments([]);
          setReferencedNodes([]);
          setPatchPreview(null);
          clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
          setError('');
        } else if (recovered.status === 'in-progress') {
          setConnectionState('reconnecting');
          setError('');
        } else {
          clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
          setDraft(text);
          setError('这条创作要求已保存，但回复明确失败；请查看会话中的真实原因后重试。');
        }
      } catch {
        const terminalStatus = terminalMessageRequestsRef.current.get(
          pendingRequest.requestId,
        );
        if (terminalStatus === 'completed') {
          setAttachments([]);
          setReferencedNodes([]);
          setPatchPreview(null);
          clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
          setError('');
        } else if (terminalStatus === 'stopped') {
          clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
          setDraft(text);
          setError('');
        } else if (terminalStatus === 'failed') {
          clearPendingCreatorMessage(pendingMessageKey, pendingRequest.requestId);
          setError('这条创作要求已保存，但回复明确失败；请查看会话中的真实原因后重试。');
        } else {
          setDraft(text);
          setError(`${compactError(sendError)}；网络恢复后再次发送会沿用原请求，不会重复创建计划。`);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    capabilities,
    context,
    draft,
    messageAttachments,
    modelPreferences,
    workQualityMode,
    ensureSession,
    pendingMessageKey,
    props.canvasId,
    props.projectId,
    session,
    uploading,
  ]);

  const reviseWork = useCallback(async (
    artifact: CreatorAgentWorkArtifactVersion,
    action: 'edit' | 'lock' | 'unlock' | 'accept' | 'reject',
    field?: string,
    value?: unknown,
  ) => {
    if (!session || workActionBusy) return;
    const actionKey = `${artifact.artifactId}:${action}:${field || ''}`;
    setWorkActionBusy(actionKey);
    setError('');
    try {
      const result = await reviseCreatorAgentWorkArtifact(
        session.id,
        artifact.artifactId,
        {
          projectId: props.projectId,
          canvasId: props.canvasId,
          baseVersionId: artifact.versionId,
          action,
          ...(field ? { field } : {}),
          ...(action === 'edit' ? { value } : {}),
        },
      );
      setSession(result.session);
    } catch (revisionError) {
      setError(compactError(revisionError));
      try {
        setSession(await getCreatorAgentSession(
          session.id,
          props.projectId,
          props.canvasId,
        ));
      } catch {
        // Preserve the actionable revision error if the refresh also fails.
      }
    } finally {
      setWorkActionBusy('');
    }
  }, [props.canvasId, props.projectId, session, workActionBusy]);

  const stopResponse = useCallback(async (
    responseId: string,
    clientRequestId = '',
  ) => {
    if (!session || !responseId || stoppingResponseId) return;
    setStoppingResponseId(responseId);
    setError('');
    try {
      const result = await stopCreatorAgentResponse(session.id, responseId, {
        projectId: props.projectId,
        canvasId: props.canvasId,
      });
      setSession(result.session);
      if (result.status === 'stopped') {
        const originalRequest = [...result.session.events].reverse().find((event) => (
          ['user.message', 'user.suggestion'].includes(event.type)
          && (
            (clientRequestId && event.payload.clientRequestId === clientRequestId)
            || event.payload.responseId === responseId
          )
        ));
        const originalText = String(originalRequest?.payload.text || '');
        const attachmentOnly = originalRequest?.payload.inputMode === 'attachments-only';
        if (originalText && !attachmentOnly) {
          setDraft((current) => current.trim() ? current : originalText);
        }
      }
    } catch (stopError) {
      setError(`停止本轮回复失败：${compactError(stopError)}。画布里的生成任务没有受到影响。`);
    } finally {
      setStoppingResponseId('');
    }
  }, [
    props.canvasId,
    props.projectId,
    session,
    stoppingResponseId,
  ]);

  const previewPlan = useCallback(async (plan: CreatorAgentPlan) => {
    if (!session || previewingPlanId || busy) return;
    setPreviewingPlanId(plan.planId);
    setError('');
    try {
      const prepared = await getCreatorAgentPlanPatch(
        session.id,
        plan.planId,
        props.projectId,
        props.canvasId,
      );
      const preparedPreview = await props.onPreviewPatch(prepared.patch);
      const preview = preparedPreview.preview;
      setPatchPreview({ plan, patch: preparedPreview.patch, preview });
      const updated = await appendCreatorAgentEvent(session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        type: 'plan.previewed',
        payload: {
          planId: plan.planId,
          planDigest: plan.planDigest,
          patchId: preparedPreview.patch.id,
          previewDigest: preview.previewDigest,
          changeCount: preview.changes.length,
        },
      });
      setSession(updated);
    } catch (previewError) {
      const message = compactError(previewError);
      setError(`无法生成画布预览：${message}`);
      try {
        const updated = await appendCreatorAgentEvent(session.id, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          type: 'plan.failed',
          payload: {
            planId: plan.planId,
            planDigest: plan.planDigest,
            stage: 'preview',
            error: message,
          },
        });
        setSession(updated);
      } catch {
        // The visible preview error remains primary when event persistence also fails.
      }
    } finally {
      setPreviewingPlanId('');
    }
  }, [busy, previewingPlanId, props, session]);

  const prepareToolProposal = useCallback(async (proposal: CreatorAgentToolProposal) => {
    if (!session || busy || preparingProposalId) return;
    setPreparingProposalId(proposal.proposalId);
    setError('');
    try {
      const prepared = await prepareCreatorAgentToolProposal(
        session.id,
        proposal.proposalId,
        {
          projectId: props.projectId,
          canvasId: props.canvasId,
          proposalDigest: proposal.proposalDigest,
        },
      );
      setSession(prepared.session);
      const preparedPreview = await props.onPreviewPatch(prepared.patch);
      const updated = await appendCreatorAgentEvent(prepared.session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        type: 'plan.previewed',
        payload: {
          planId: prepared.plan.planId,
          planDigest: prepared.plan.planDigest,
          patchId: preparedPreview.patch.id,
          previewDigest: preparedPreview.preview.previewDigest,
          changeCount: preparedPreview.preview.changes.length,
          proposalId: proposal.proposalId,
          proposalDigest: proposal.proposalDigest,
        },
      });
      setSession(updated);
      const toolProposalBinding = proposal.binding.workId
        && proposal.binding.workRevision !== null
        && proposal.binding.workDigest
        ? {
            proposalId: proposal.proposalId,
            proposalDigest: proposal.proposalDigest,
            workId: proposal.binding.workId,
            workRevision: proposal.binding.workRevision,
            workDigest: proposal.binding.workDigest,
          }
        : undefined;
      setPatchPreview({
        plan: prepared.plan,
        patch: preparedPreview.patch,
        preview: preparedPreview.preview,
        toolProposalBinding,
      });
    } catch (proposalError) {
      setError(`无法准备这条操作预览：${compactError(proposalError)}`);
    } finally {
      setPreparingProposalId('');
    }
  }, [busy, preparingProposalId, props, session]);

  const prepareAssetPlacement = useCallback(async (asset: AssetRef) => {
    if (!session || busy || placingAssetId) return;
    setPlacingAssetId(asset.id);
    setError('');
    try {
      const prepared = await createCreatorAgentAssetPlacePlan(session.id, asset.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        context,
      });
      setSession(prepared.session);
      if (prepared.alreadyApplied) {
        let updated = await appendCreatorAgentEvent(prepared.session.id, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          type: 'plan.applied',
          payload: {
            planId: prepared.plan.planId,
            planDigest: prepared.plan.planDigest,
            patchId: prepared.alreadyApplied.patchId,
            previewDigest: prepared.alreadyApplied.previewDigest,
            appliedRevision: prepared.alreadyApplied.appliedRevision,
            duplicate: true,
            affectedNodeIds: prepared.alreadyApplied.affectedNodeIds,
            affectedEdgeIds: prepared.alreadyApplied.affectedEdgeIds,
          },
        });
        const placement = prepared.plan.assetPlacement;
        if (placement?.asset?.id && placement.nodeId) {
          updated = await appendCreatorAgentEvent(prepared.session.id, {
            projectId: props.projectId,
            canvasId: props.canvasId,
            type: 'artifact.sent-to-canvas',
            payload: {
              planId: prepared.plan.planId,
              planDigest: prepared.plan.planDigest,
              patchId: prepared.alreadyApplied.patchId,
              assetId: placement.asset.id,
              contentHash: placement.asset.contentHash,
              nodeId: placement.nodeId,
              appliedRevision: prepared.alreadyApplied.appliedRevision,
              duplicate: true,
            },
          });
        }
        setSession(updated);
        setPatchPreview(null);
        return;
      }
      const preparedPreview = await props.onPreviewPatch(prepared.patch);
      const updated = await appendCreatorAgentEvent(prepared.session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        type: 'plan.previewed',
        payload: {
          planId: prepared.plan.planId,
          planDigest: prepared.plan.planDigest,
          patchId: preparedPreview.patch.id,
          previewDigest: preparedPreview.preview.previewDigest,
          changeCount: preparedPreview.preview.changes.length,
        },
      });
      setSession(updated);
      setPatchPreview({
        plan: prepared.plan,
        patch: preparedPreview.patch,
        preview: preparedPreview.preview,
      });
    } catch (placementError) {
      const message = compactError(placementError);
      setError(`无法预览素材放置：${message}`);
      try {
        const updated = await appendCreatorAgentEvent(session.id, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          type: 'plan.failed',
          payload: {
            assetId: asset.id,
            stage: 'asset-place-preview',
            error: message,
          },
        });
        setSession(updated);
      } catch {
        // The visible placement error remains primary when evidence persistence also fails.
      }
    } finally {
      setPlacingAssetId('');
    }
  }, [busy, context, placingAssetId, props, session]);

  const applyPreview = useCallback(async () => {
    if (!patchPreview || !session || busy) return;
    const proposalBinding = patchPreview.toolProposalBinding;
    if (proposalBinding && (
      session.creatorWork?.workId !== proposalBinding.workId
      || session.creatorWork?.revision !== proposalBinding.workRevision
      || session.creatorWork?.workDigest !== proposalBinding.workDigest
    )) {
      setPatchPreview(null);
      setError('作品版本已变化，这条操作预览已失效；请从当前作品重新准备预览。没有写入画布或调用 Provider。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const applyResult = await props.onApplyPatch(patchPreview.patch, patchPreview.preview);
      let updated = await appendCreatorAgentEvent(session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        type: 'plan.applied',
        payload: {
          planId: patchPreview.plan.planId,
          planDigest: patchPreview.plan.planDigest,
          patchId: patchPreview.patch.id,
          previewDigest: patchPreview.preview.previewDigest,
          appliedRevision: applyResult.revision,
          duplicate: applyResult.duplicate,
          affectedNodeIds: patchPreview.preview.affectedNodeIds,
          affectedEdgeIds: patchPreview.preview.affectedEdgeIds,
        },
      });
      let evidenceError = '';
      const placement = patchPreview.plan.assetPlacement;
      if (placement?.asset?.id && placement.nodeId) {
        try {
          updated = await appendCreatorAgentEvent(session.id, {
            projectId: props.projectId,
            canvasId: props.canvasId,
            type: 'artifact.sent-to-canvas',
            payload: {
              planId: patchPreview.plan.planId,
              planDigest: patchPreview.plan.planDigest,
              patchId: patchPreview.patch.id,
              assetId: placement.asset.id,
              contentHash: placement.asset.contentHash,
              nodeId: placement.nodeId,
              appliedRevision: applyResult.revision,
              duplicate: applyResult.duplicate,
            },
          });
        } catch (eventError) {
          evidenceError = compactError(eventError);
        }
      }
      setSession(updated);
      setPatchPreview(null);
      setPendingStageContinuation((current) => (
        current ? { ...current, readyAfterApply: true } : current
      ));
      if (evidenceError) {
        setError(`素材已发送到画布，但会话证据同步失败；刷新后可继续：${evidenceError}`);
      }
    } catch (applyError) {
      setError(`发送到画布失败：${compactError(applyError)}`);
      try {
        await appendCreatorAgentEvent(session.id, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          type: 'plan.failed',
          payload: {
            planId: patchPreview.plan.planId,
            error: compactError(applyError),
          },
        });
      } catch {
        // Primary error remains visible; event persistence failure is secondary.
      }
    } finally {
      setBusy(false);
    }
  }, [busy, patchPreview, props, session]);

  const revertAppliedPlan = useCallback(async (plan: CreatorAgentPlan) => {
    if (!session || busy || revertingPlanId) return;
    if ((session.runLinks || []).some((link) => String(link.planId || '') === plan.planId)) {
      setError('这个计划已关联真实运行，不能再撤回结构；请创建探索分支或使用版本回退。');
      return;
    }
    let state: { patchId: string; appliedRevision: number } | null = null;
    for (const event of session.events || []) {
      if (String(event.payload?.planId || '') !== plan.planId) continue;
      if (event.type === 'plan.applied') {
        state = {
          patchId: String(event.payload.patchId || ''),
          appliedRevision: Math.max(0, Number(event.payload.appliedRevision) || 0),
        };
      } else if (event.type === 'plan.reverted') {
        state = null;
      }
    }
    if (!state?.patchId || !state.appliedRevision) {
      setError('找不到这次画布变更的权威 Patch 证据，请刷新会话后重试。');
      return;
    }
    setBusy(true);
    setRevertingPlanId(plan.planId);
    setError('');
    try {
      const revertResult = await props.onRevertPatch(state.patchId, state.appliedRevision);
      try {
        const updated = await appendCreatorAgentEvent(session.id, {
          projectId: props.projectId,
          canvasId: props.canvasId,
          type: 'plan.reverted',
          payload: {
            planId: plan.planId,
            planDigest: plan.planDigest,
            patchId: state.patchId,
            appliedRevision: state.appliedRevision,
            revertedRevision: revertResult.revision,
            duplicate: revertResult.duplicate === true,
          },
        });
        setSession(updated);
      } catch (eventError) {
        setError(`画布已成功撤回，但会话证据同步失败；刷新后可继续：${compactError(eventError)}`);
      }
    } catch (revertError) {
      setError(`撤回画布变更失败：${compactError(revertError)}`);
    } finally {
      setBusy(false);
      setRevertingPlanId('');
    }
  }, [busy, props, revertingPlanId, session]);

  const prepareDelivery = useCallback(async (plan: CreatorAgentPlan) => {
    if (!session || busy || deliveryBusyPlanId) return;
    const pickDirectory = window.t8pc?.pickDirectory;
    if (!pickDirectory) {
      setError('交付包需要在桌面版选择本机保存位置；浏览器模式不会接收或保存本机路径。');
      return;
    }
    setDeliveryBusyPlanId(plan.planId);
    setError('');
    try {
      const picked = await pickDirectory({
        title: '选择作品交付包保存位置',
        buttonLabel: '选择这里',
      });
      if (picked.cancelled) return;
      if (!picked.success || !picked.path) {
        throw new Error(picked.message || '没有取得可用的交付位置');
      }
      const turn = await createCreatorAgentDeliveryPlan(session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        parentPath: picked.path,
        scope: 'canvas',
        context,
      });
      setSession(turn.session);
      setPatchPreview(null);
      stickToBottomRef.current = true;
      setHistoryPage(0);
    } catch (deliveryError) {
      setError(`无法准备交付包：${compactError(deliveryError)}`);
    } finally {
      setDeliveryBusyPlanId('');
    }
  }, [
    busy,
    context,
    deliveryBusyPlanId,
    props.canvasId,
    props.projectId,
    session,
  ]);

  const requestDelivery = useCallback(async (plan: CreatorAgentPlan) => {
    if (!session || busy || deliveryBusyPlanId) return;
    if (!capabilities?.capabilities.some((capability) => capability.id === 'delivery.package')) {
      setError('当前版本没有注册作品交付能力，已停止执行且没有创建文件。');
      return;
    }
    setDeliveryBusyPlanId(plan.planId);
    setError('');
    try {
      const approval = await requestCreatorAgentDeliveryApproval(session.id, plan.planId, {
        projectId: props.projectId,
        canvasId: props.canvasId,
      });
      setSession(approval.session);
      setDeliveryApproval({
        approvalRequestId: approval.approvalRequestId,
        planId: approval.planId,
      });
    } catch (approvalError) {
      setDeliveryBusyPlanId('');
      setError(`无法发起桌面交付确认：${compactError(approvalError)}`);
    }
  }, [
    busy,
    capabilities,
    deliveryBusyPlanId,
    props.canvasId,
    props.projectId,
    session,
  ]);

  useEffect(() => {
    if (deliveryApproval || !session?.events?.length) return;
    const terminalApprovalIds = new Set(session.events
      .filter((event) => [
        'delivery.completed',
        'delivery.denied',
        'delivery.failed',
      ].includes(event.type))
      .map((event) => String(event.payload.approvalRequestId || ''))
      .filter(Boolean));
    const pending = [...session.events].reverse().find((event) => (
      event.type === 'delivery.approval-requested'
      && Boolean(event.payload.approvalRequestId)
      && Boolean(event.payload.planId)
      && !terminalApprovalIds.has(String(event.payload.approvalRequestId))
      && (!event.payload.expiresAt || Date.parse(String(event.payload.expiresAt)) > Date.now())
    ));
    if (!pending) return;
    setDeliveryApproval({
      approvalRequestId: String(pending.payload.approvalRequestId),
      planId: String(pending.payload.planId),
    });
    setDeliveryBusyPlanId(String(pending.payload.planId));
  }, [deliveryApproval, session?.events]);

  useEffect(() => {
    if (!deliveryApproval || !session?.id) return undefined;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await completeCreatorAgentDeliveryApproval(
          session.id,
          deliveryApproval.approvalRequestId,
          { projectId: props.projectId, canvasId: props.canvasId },
        );
        if (cancelled) return;
        setSession(result.session);
        if (result.status === 'pending') {
          timer = window.setTimeout(() => void poll(), 1_500);
          return;
        }
        setDeliveryApproval(null);
        setDeliveryBusyPlanId('');
        if (result.status === 'denied') {
          setError('已取消交付，没有创建任何文件。');
        }
      } catch (deliveryError) {
        if (cancelled) return;
        const code = String((deliveryError as { code?: string })?.code || '');
        if (code === 'APPROVAL_IN_PROGRESS') {
          timer = window.setTimeout(() => void poll(), 1_500);
          return;
        }
        setDeliveryApproval(null);
        setDeliveryBusyPlanId('');
        setError(`交付未完成：${compactError(deliveryError)}`);
      }
    };
    timer = window.setTimeout(() => void poll(), 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    deliveryApproval,
    props.canvasId,
    props.projectId,
    session?.id,
  ]);

  const createCandidateActionPlan = useCallback(async (
    action: 'review' | 'accept' | 'lock' | 'unlock' | 'branch' | 'rollback',
    candidate: CreatorAgentCandidate,
    review?: Parameters<typeof createCreatorAgentIteratePlan>[1]['review'],
  ) => {
    if (!session || candidateActionBusy || busy) return;
    const capabilityId = `iterate.${action}`;
    if (!capabilities?.capabilities.some((capability) => capability.id === capabilityId)) {
      setError('这个候选操作尚未注册到当前版本的统一能力清单。');
      return;
    }
    setCandidateActionBusy(`${action}:${candidate.nodeId}`);
    setError('');
    try {
      const turn = await createCreatorAgentIteratePlan(session.id, {
        projectId: props.projectId,
        canvasId: props.canvasId,
        action,
        nodeId: candidate.nodeId,
        label: action === 'branch' ? `从 ${candidate.candidateLabel} 创建探索分支` : undefined,
        review,
        context,
      });
      setSession(turn.session);
      setPatchPreview(null);
      stickToBottomRef.current = true;
      setHistoryPage(0);
    } catch (actionError) {
      setError(`无法形成候选操作预览：${compactError(actionError)}`);
    } finally {
      setCandidateActionBusy('');
    }
  }, [
    busy,
    candidateActionBusy,
    capabilities,
    context,
    props.canvasId,
    props.projectId,
    session,
  ]);

  const runAppliedPlan = useCallback((plan: CreatorAgentPlan) => {
    if (runningPlanId) return;
    const nodeId = String(plan.targets?.primaryNodeId || '').trim();
    if (!nodeId) {
      setRunSyncError('这个计划没有可执行的主节点；画布内容保持不变，请先检查计划。');
      return;
    }

    setRunningPlanId(plan.planId);
    setRunSyncError('');
    const dispatched = requestCanvasNodeRun(nodeId, {
      requestId: createCanvasNodeRunRequestId(nodeId, 'creator-agent'),
      onSettled(outcome) {
        setRunningPlanId((current) => current === plan.planId ? '' : current);
        if (!outcome.accepted) {
          setRunSyncError(`本次运行未启动：${outcome.error || '请检查运行体检提示后重试。'}`);
        }
      },
    });

    if (!dispatched) {
      setRunningPlanId('');
      setRunSyncError('当前画布未能接收运行请求；没有调用模型，请刷新画布后重试。');
    }
  }, [runningPlanId]);

  const verifyRunArtifacts = useCallback(async (runId: string) => {
    if (!session || !runId || verifyingRunId) return;
    setVerifyingRunId(runId);
    setRunSyncError('');
    try {
      const result = await verifyCreatorAgentRunArtifacts(session.id, runId, {
        projectId: props.projectId,
        canvasId: props.canvasId,
      });
      setSession((current) => (
        current?.id === result.session.id
          && Number(result.session.lastSequence) >= Number(current.lastSequence)
          ? result.session
          : current
      ));
      if (result.verification && !result.verification.verified) {
        setRunSyncError(`产物核验未通过：${artifactVerificationFailure(result.verification)}`);
      }
    } catch (verificationError) {
      setRunSyncError(`产物核验失败：${compactError(verificationError)}`);
    } finally {
      setVerifyingRunId('');
    }
  }, [props.canvasId, props.projectId, session, verifyingRunId]);

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const nativeEvent = event.nativeEvent;
    if (
      composerComposingRef.current
      || nativeEvent.isComposing
      || nativeEvent.keyCode === 229
    ) return;
    if (Date.now() - compositionEndedAtRef.current < CREATOR_IME_COMMIT_GUARD_MS) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void submit();
  };

  const allVisibleEvents = creatorDisplayEvents(session?.events || []).filter((event) => (
    event.type === 'user.message'
    || event.type === 'user.suggestion'
    || event.type === 'user.action'
    || event.type === 'assistant.plan'
    || event.type === 'assistant.response'
    || CREATOR_ACTIVITY_EVENT_TYPES.has(event.type)
  ));
  const creativeArtifactVersions = session?.creativeArtifactVersions || [];
  const creativeArtifacts = session?.creativeArtifacts || [];
  const workArtifactVersions = session?.workArtifactVersions || [];
  const workArtifactHistories = useMemo(() => {
    const histories = new Map<string, CreatorAgentWorkArtifactVersion[]>();
    workArtifactVersions.forEach((version) => {
      const current = histories.get(version.artifactId) || [];
      current.push(version);
      histories.set(version.artifactId, current);
    });
    histories.forEach((versions) => versions.sort((left, right) => right.revision - left.revision));
    return histories;
  }, [workArtifactVersions]);
  const latestWorkArtifacts = useMemo(() => {
    const latest = new Map<string, CreatorAgentWorkArtifactVersion>();
    workArtifactVersions.forEach((version) => {
      const previous = latest.get(version.artifactId);
      if (!previous || version.revision > previous.revision) latest.set(version.artifactId, version);
    });
    return [...latest.values()].sort((left, right) => left.kind.localeCompare(right.kind));
  }, [workArtifactVersions]);
  const latestWorkReceipt = [...(session?.creatorLlmTurnReceipts || [])]
    .reverse()
    .find((receipt) => receipt.phase === 'compiled')
    || session?.creatorLlmTurnReceipts?.at(-1)
    || null;
  const latestCompletedResponseEvent = [...((session?.events) || [])]
    .reverse()
    .find((event) => event.type === 'assistant.response.completed');
  const latestCompletedResponseId = String(
    latestCompletedResponseEvent?.payload.responseId || '',
  );
  const currentToolProposals = (session?.toolProposals || [])
    .filter((proposal) => proposal.binding.responseId === latestCompletedResponseId)
    .slice(-3)
    .reverse();
  const isPristineSession = allVisibleEvents.length === 0;
  const historyWindowEnd = Math.max(
    0,
    allVisibleEvents.length - historyPage * CREATOR_MESSAGE_WINDOW_SIZE,
  );
  const historyWindowStart = Math.max(0, historyWindowEnd - CREATOR_MESSAGE_WINDOW_SIZE);
  const visibleEvents = allVisibleEvents.slice(historyWindowStart, historyWindowEnd);
  const olderMessageCount = historyWindowStart;
  const newerMessageCount = allVisibleEvents.length - historyWindowEnd;
  const activeStreamingResponse = [...allVisibleEvents].reverse().find((event) => (
    event.type === 'assistant.response' && event.payload.streamStatus === 'streaming'
  ));
  const hasStreamingResponse = Boolean(activeStreamingResponse);
  const thinkingActive = busy || hasStreamingResponse || Boolean(confirmingDocumentKey);
  useEffect(() => {
    if (!thinkingActive) {
      setThinkingSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    setThinkingSeconds(0);
    const timer = window.setInterval(() => {
      setThinkingSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [thinkingActive]);
  const activeStreamingResponseId = String(activeStreamingResponse?.payload.responseId || '');
  const activeStreamingClientRequestId = String(
    activeStreamingResponse?.payload.clientRequestId || '',
  );
  const starterIdeaSuggestions: CreatorAgentSuggestion[] = starterIdeas.map((idea) => ({
    id: idea.id,
    label: idea.label,
    description: idea.description,
    intent: idea.intent,
    arguments: {
      planOnly: true,
      preserveAccepted: true,
      creatorPrompt: idea.starterPrompt,
      creatorKind: idea.creatorKind,
      taskFamily: idea.taskFamily,
      starterRequestId: idea.id,
      starterMode: starterIdeaMode,
    },
    expectedEffect: `${idea.expectedFirstArtifact}；先产出可编辑内容，不自动写画布或启动媒体生成`,
    riskLevel: 'L0-intent',
    requiredCapabilityIds: [...idea.requiredCapabilityIds],
    disabledReason: '',
    executable: true,
    operationContracts: idea.requiredCapabilityIds.map((capabilityId) => ({
      capabilityId,
      operation: 'plan',
      riskLevel: 'L0' as const,
      approvalRequired: false as const,
      boundary: 'local-read',
      requiredScopes: ['canvas:read'],
    })),
    blockers: [],
    unblockActions: [],
  }));
  const localPlanSuggestionContract = [{
    capabilityId: 'create.story',
    operation: 'plan',
    riskLevel: 'L0' as const,
    approvalRequired: false as const,
    boundary: 'local-read',
    requiredScopes: ['canvas:read'],
  }];
  const legacySuggestions = session?.suggestions?.length === 3
    ? session.suggestions.map((label, index) => ({
        id: `legacy-${index + 1}`,
        label,
        description: '选择后只推进一个关键决定；也可以在下方直接写自己的方向。',
        intent: `legacy-${index + 1}`,
        arguments: {
          planOnly: true,
          preserveAccepted: true,
          creatorPrompt: label,
          creatorKind: 'story',
        },
        expectedEffect: '先形成可编辑计划，不自动写画布或调用模型',
        riskLevel: 'L0-intent' as const,
        requiredCapabilityIds: ['create.story'],
        disabledReason: '',
        executable: true,
        operationContracts: localPlanSuggestionContract,
        blockers: [],
        unblockActions: [],
      }))
    : starterIdeaSuggestions;
  const suggestionReceiptReady = Boolean(
    session?.suggestionSet?.setDigest
    && session.suggestionSet.binding?.schema === 't8-creator-suggestion-binding-v1'
    && creatorSuggestionSetContractReady(session.suggestionSet, capabilities)
  );
  const latestCompletedSuggestionSet = latestCompletedResponseEvent?.payload.suggestionSet as
    | { setDigest?: unknown }
    | undefined;
  const latestCompletedSuggestionSetDigest = String(
    latestCompletedSuggestionSet?.setDigest || '',
  );
  const recommendationChoicesReady = !thinkingActive && (
    isPristineSession
    || Boolean(
      suggestionReceiptReady
      && latestCompletedSuggestionSetDigest
      && latestCompletedSuggestionSetDigest === session?.suggestionSet?.setDigest
    )
  );
  const candidateSuggestions = (
    isPristineSession
      ? starterIdeaSuggestions
      : session?.suggestionSet?.items?.length === 3
        ? session.suggestionSet.items
        : legacySuggestions
  ).slice(0, 3);
  const capabilityReady = capabilityContractReady(capabilities);
  const availableCapabilityIds = new Set(
    capabilities?.capabilities.map((capability) => capability.id) || [],
  );
  const suggestions = capabilityReady
    ? candidateSuggestions.map((suggestion) => {
        if (session && !isPristineSession && !suggestionReceiptReady) {
          const disabledReason = '这 3 条建议来自旧会话版本，请先发送一句新要求刷新建议';
          return {
            ...suggestion,
            executable: false,
            disabledReason,
            blockers: [{ code: 'suggestion-receipt-missing', message: disabledReason }],
            unblockActions: [disabledReason],
          };
        }
        const missingCapabilityId = suggestion.requiredCapabilityIds
          .find((id) => !availableCapabilityIds.has(id));
        if (!missingCapabilityId) return suggestion;
        const disabledReason = `当前版本缺少“${missingCapabilityId}”能力，请更新应用后重试`;
        return {
          ...suggestion,
          executable: false,
          disabledReason,
          blockers: [{ code: 'capability-not-found', message: disabledReason }],
          unblockActions: [disabledReason],
        };
      })
    : [];
  const suggestionContractBroken = capabilityReady && suggestions.length !== 3;
  const activePhaseCandidate = session?.production?.currentPhase || session?.phase;
  const activePhase = CREATIVE_PHASES[
    creativePhaseIndex(activePhaseCandidate || 'idea')
  ].id;
  const activePhaseIndex = creativePhaseIndex(activePhase);
  const completedPhaseIds = new Set(session?.production?.completedPhases
    || CREATIVE_PHASES.slice(0, activePhaseIndex).map((phase) => phase.id));
  const invalidatedPhaseIds = new Set(session?.production?.invalidatedPhases || []);
  const currentStageResponseEvent = [...allVisibleEvents].reverse().find((event) => {
    if (event.type !== 'assistant.response'
      || event.payload.streamStatus !== 'completed'
      || String(event.payload.productionPhase || '') !== activePhase) return false;
    const plan = eventPlan(event);
    return Boolean(plan && Array.isArray(plan.productionDocuments) && plan.productionDocuments.length > 0);
  });
  const currentStagePlan = currentStageResponseEvent
    ? eventPlan(currentStageResponseEvent)
    : null;
  const currentStageRequiredKinds = CREATOR_STAGE_DOCUMENT_KINDS[activePhase];
  const currentStageDocuments = (currentStagePlan?.productionDocuments || []).filter(
    (document) => currentStageRequiredKinds.includes(document.kind),
  );
  const currentStageDocumentKinds = new Set(currentStageDocuments.map((document) => document.kind));
  const currentStageComplete = Boolean(
    currentStagePlan
    && session?.latestPlan?.planId === currentStagePlan.planId
    && currentStageRequiredKinds.every((kind) => currentStageDocumentKinds.has(kind)),
  );
  const confirmedProductionVersionIds = new Set(
    (session?.productionDocumentConfirmations || []).map((item) => item.versionId),
  );
  const currentStageUnconfirmedDocuments = currentStageDocuments.filter(
    (document) => !confirmedProductionVersionIds.has(document.versionId),
  );
  const continueFromStageSuggestion = useCallback(async (
    suggestion: CreatorAgentSuggestion,
  ) => {
    if (!currentStagePlan
      || !currentStageComplete
      || currentStageUnconfirmedDocuments.length === 0) {
      setError('当前阶段还没有完整可确认稿；请先完成本阶段内容，再确认并继续。');
      return;
    }
    const prompt = String(suggestion.arguments?.creatorPrompt || '').trim();
    const targetPhase = String(suggestion.arguments?.continueToPhase || '') as
      CreatorAgentProductionPhase;
    if (!prompt || !CREATIVE_PHASES.some((phase) => phase.id === targetPhase)) {
      setError('这条继续操作缺少下一阶段信息，请刷新会话后重试。');
      return;
    }
    const result = await confirmProductionDocuments(
      currentStagePlan,
      currentStageUnconfirmedDocuments,
      suggestion,
    );
    const phaseTransitionReady = Boolean(
      result?.phaseTransition
      && result.phaseTransition.nextPhase === targetPhase
      && (
        result.phaseTransition.advanced
        || (targetPhase === 'delivery' && result.phaseTransition.completed === true)
      ),
    );
    if (!result || !phaseTransitionReady) {
      if (result) setError('当前阶段版本已保存，但没有进入预期的下一阶段；请刷新会话后重试。');
      return;
    }
    const productionFinished = targetPhase === 'delivery'
      && result?.phaseTransition?.completed === true;
    if (productionFinished) {
      setPendingStageContinuation(null);
      return;
    }
    setPendingStageContinuation({
      prompt,
      targetPhase,
      readyAfterApply: !result.canvasRetention,
    });
  }, [
    confirmProductionDocuments,
    currentStageComplete,
    currentStagePlan,
    currentStageUnconfirmedDocuments,
  ]);
  const stageContinuationSuggestion = suggestions.find((suggestion) => (
    suggestion.arguments
    && 'confirmCurrentStage' in suggestion.arguments
    && suggestion.arguments.confirmCurrentStage === true
  )) || null;

  useEffect(() => {
    if (!pendingStageContinuation?.readyAfterApply
      || patchPreview
      || busy
      || uploading) return;
    const prompt = pendingStageContinuation.prompt;
    setPendingStageContinuation(null);
    stickToBottomRef.current = true;
    setHistoryPage(0);
    void submit(prompt, undefined, { stageContinuation: true });
  }, [
    busy,
    patchPreview,
    pendingStageContinuation,
    submit,
    uploading,
  ]);

  const completedPhaseLabels = CREATIVE_PHASES
    .filter((phase) => completedPhaseIds.has(phase.id))
    .map((phase) => phase.label);
  const pendingPhaseLabels = CREATIVE_PHASES
    .filter((phase) => !completedPhaseIds.has(phase.id))
    .map((phase) => phase.label);
  const affectedPhaseLabels = CREATIVE_PHASES
    .filter((phase) => invalidatedPhaseIds.has(phase.id))
    .map((phase) => phase.label);
  const phaseScopeReceipt = {
    completed: completedPhaseLabels.length > 0 ? completedPhaseLabels.join('、') : '暂无已核验阶段',
    pending: pendingPhaseLabels.length > 0 ? pendingPhaseLabels.join('、') : '全部阶段已完成',
    impact: affectedPhaseLabels.length > 0
      ? `需重新确认：${affectedPhaseLabels.join('、')}`
      : '当前没有已记录的阶段失效',
  };
  const phaseReceipt = (() => {
    const label = creativePhaseLabel(activePhase);
    const blocked = session?.production?.blocked?.message;
    if (blocked) {
      return {
        tone: 'is-blocked',
        title: `当前停在「${label}」`,
        detail: `${blocked}；已完成、已采用和已锁定内容都会保留。`,
      };
    }
    if (invalidatedPhaseIds.size > 0) {
      const invalidatedLabels = CREATIVE_PHASES
        .filter((phase) => invalidatedPhaseIds.has(phase.id))
        .map((phase) => phase.label)
        .join('、');
      return {
        tone: 'is-revising',
        title: `正在返修「${label}」`,
        detail: `${invalidatedLabels}已重新打开；后续阶段不会被误标为完成。`,
      };
    }
    return {
      tone: '',
      title: `当前在「${label}」`,
      detail: `已完成 ${completedPhaseIds.size}/${CREATIVE_PHASES.length} 个阶段；每次前进或返修都会保存在当前作品会话。`,
    };
  })();
  const planCanvasStates = useMemo(() => {
    const states = new Map<string, 'applied' | 'reverted'>();
    for (const event of session?.events || []) {
      const planId = String(event.payload?.planId || '');
      if (!planId) continue;
      if (event.type === 'plan.applied') states.set(planId, 'applied');
      if (event.type === 'plan.reverted') states.set(planId, 'reverted');
    }
    return states;
  }, [session?.events]);
  const appliedPlanIds = new Set([...planCanvasStates.entries()]
    .filter(([, state]) => state === 'applied').map(([planId]) => planId));
  const revertedPlanIds = new Set([...planCanvasStates.entries()]
    .filter(([, state]) => state === 'reverted').map(([planId]) => planId));
  const runLinkedPlanIds = new Set((session?.runLinks || [])
    .map((link) => String(link.planId || ''))
    .filter(Boolean));
  const completedDeliveryPlanIds = new Set((session?.deliveryEvidence || [])
    .filter((evidence) => evidence.status === 'completed' && evidence.valid)
    .map((evidence) => evidence.planId));

  const patchPreviewItems = useMemo(() => (
    patchPreview?.preview.changes.map((change) => creatorPatchPreviewItem(change, patchPreview.patch)) || []
  ), [patchPreview]);
  const latestAssistantResponse = [...(session?.events || [])]
    .reverse()
    .find((event) => event.type === 'assistant.response');
  const launcherStatus = error
    || runSyncError
    || latestAssistantResponse?.payload?.streamStatus === 'failed'
    ? 'warning'
    : patchPreview || deliveryApproval || session?.status === 'awaiting-approval'
      ? 'approval'
      : runningPlanId || uploading || runDetails.some((run) => ACTIVE_RUN_STATUSES.has(run.status))
        ? 'running'
        : busy || latestAssistantResponse?.payload?.streamStatus === 'streaming'
          ? 'replying'
          : latestAssistantResponse?.payload?.streamStatus === 'completed'
              || session?.status === 'planned'
              || session?.status === 'previewed'
            ? 'completed'
            : 'idle';
  const launcherStatusLabel = {
    idle: '待命',
    replying: '回复中',
    approval: '待确认',
    running: '运行中',
    completed: '已完成',
    warning: '需处理',
  }[launcherStatus];

  const launcherButton = (
    <CreatorAgentVisible>
      <button
        ref={launcherButtonRef}
        type="button"
        className={`t8-creator-agent-launcher nodrag nopan${open ? ' is-open' : ''}`}
        data-canvas-floating-ui="creator-agent-launcher"
        data-theme-visual={props.visualStyle}
        data-theme-mode={props.themeMode}
        data-status={launcherStatus}
        data-motion-active={!open && launcherPageVisible && launcherEffectsEnabled ? 'true' : 'false'}
        data-effects-enabled={launcherEffectsEnabled ? 'true' : 'false'}
        style={launcherStyle}
        aria-label={`${open ? '关闭' : '打开'}贞贞创作 Agent；当前状态：${launcherStatusLabel}；装饰特效${launcherEffectsEnabled ? '已开启' : '已关闭'}`}
        title={`AI 创作助手 · ${launcherStatusLabel}`}
        aria-controls="t8-creator-agent-panel"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closeAndRestoreLauncherFocus();
            return;
          }
          launcherOpenedAtRef.current = performance.now();
          composerFocusPendingRef.current = true;
          setOpen(true);
        }}
      >
        <span className="t8-creator-agent-launcher__aura" aria-hidden="true" />
        <span className="t8-creator-agent-launcher__label" aria-hidden="true">AI</span>
        <span className="t8-creator-agent-launcher__glyph" aria-hidden="true">
          {open ? <X size={17} /> : <Sparkles size={17} />}
        </span>
        <span
          className="t8-creator-agent-launcher__status"
          title={launcherStatusLabel}
          aria-hidden="true"
        />
        <span className="sr-only">贞贞创作 Agent，{launcherStatusLabel}</span>
      </button>
    </CreatorAgentVisible>
  );

  return (
    <CreatorAgentVisible>
    <>
      {launcherHost ? createPortal(launcherButton, launcherHost) : launcherButton}

      {open && (
        <aside
          ref={panelShellRef}
          id="t8-creator-agent-panel"
          className="t8-creator-agent-panel nodrag nopan nowheel"
          data-canvas-floating-ui="creator-agent-panel"
          data-theme-visual={props.visualStyle}
          data-theme-mode={props.themeMode}
          data-effects-enabled={launcherEffectsEnabled ? 'true' : 'false'}
          style={panelStyle}
          aria-label="贞贞创作 Agent"
          aria-labelledby="t8-creator-agent-title"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <button
            type="button"
            className="t8-creator-agent-resize-handle"
            role="separator"
            aria-label="调整创作 Agent 面板宽度"
            aria-orientation="vertical"
            aria-valuemin={CREATOR_PANEL_MIN_WIDTH}
            aria-valuemax={CREATOR_PANEL_MAX_WIDTH}
            aria-valuenow={panelWidth}
            onPointerDown={beginPanelResize}
            onKeyDown={resizePanelWithKeyboard}
          />
          <header className="t8-creator-agent-header">
            <div className="t8-creator-agent-brand">
              <span><Bot size={18} /></span>
              <div>
                <strong id="t8-creator-agent-title">贞贞创作 Agent</strong>
                <small>{capabilityReady ? '一句话开工' : '正在准备创作能力'}</small>
              </div>
            </div>
            <div className="t8-creator-agent-header__actions">
              <button
                type="button"
                title="Codex / 本地 Agent"
                aria-label="连接 Codex 或本地 Agent"
                className={codexOpen ? 'is-active' : ''}
                onClick={() => {
                  setCodexOpen((current) => !current);
                  setHistoryOpen(false);
                  setDetailsOpen(false);
                  setCodexCopied(false);
                }}
              >
                <Link2 size={17} />
              </button>
              <button
                type="button"
                title="历史对话"
                aria-label="查看历史对话"
                className={historyOpen ? 'is-active' : ''}
                onClick={() => {
                  setHistoryOpen((current) => !current);
                  setCodexOpen(false);
                  setDetailsOpen(false);
                }}
              >
                <History size={17} />
              </button>
              <button
                type="button"
                className="t8-creator-agent-new-session"
                title="开始一个新对话，当前对话会保留在历史中"
                aria-label="新对话"
                disabled={busy}
                onClick={() => void startNewConversation()}
              >
                <Plus size={16} />
                <span>新对话</span>
              </button>
              <button type="button" title="关闭" onClick={closeAndRestoreLauncherFocus}>
                <X size={18} />
              </button>
            </div>
          </header>

          {!isPristineSession && (
            <nav className="t8-creator-agent-phases is-compact" aria-label="创作阶段">
              {CREATIVE_PHASES.map((phase, index) => (
                <span
                  key={phase.id}
                  className={[
                    completedPhaseIds.has(phase.id) ? 'is-done' : '',
                    index === activePhaseIndex ? 'is-current' : '',
                    invalidatedPhaseIds.has(phase.id) ? 'is-revising' : '',
                  ].filter(Boolean).join(' ')}
                  aria-current={index === activePhaseIndex ? 'step' : undefined}
                >
                  <i aria-hidden="true">
                    {completedPhaseIds.has(phase.id) ? <Check size={10} /> : index + 1}
                  </i>
                  {phase.label}
                </span>
              ))}
            </nav>
          )}

          <div
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-creator-agent-live-status="true"
          >
            {screenReaderAnnouncement
              ? <span key={screenReaderAnnouncement.eventId}>{screenReaderAnnouncement.text}</span>
              : null}
          </div>

          {(connectionState === 'reconnecting' || connectionState === 'stopped') && (
            <div className={`t8-creator-agent-connection is-${connectionState}`} role="status">
              <LoaderCircle
                size={14}
                className={connectionState === 'reconnecting' ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              <span>
                <strong>{connectionState === 'reconnecting' ? '正在恢复同一会话' : '会话连接已暂停'}</strong>
                <small>
                  {connectionState === 'reconnecting'
                    ? '已保存的回复和任务不会丢失，也不会重复提交。'
                    : '重新打开面板会从最后一条已确认事件继续。'}
                </small>
              </span>
            </div>
          )}

          {codexOpen && (
            <section className="t8-creator-agent-codex" aria-label="Codex 与本地 Agent 连接">
              <header>
                <span>
                  <Link2 size={14} aria-hidden="true" />
                  <span>
                    <strong>Codex / 本地 Agent</strong>
                    <small>与画布共用 Creator Session、批准和任务证据</small>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void refreshCodexConnection()}
                  disabled={codexRefreshing || !window.t8pc?.agentControl?.getConnectionSummary}
                >
                  {codexRefreshing ? <LoaderCircle size={13} className="animate-spin" /> : '刷新'}
                </button>
              </header>
              <div className="t8-creator-agent-codex__status" aria-live="polite">
                <i className={codexSummary?.codexConnected ? 'is-connected' : ''} aria-hidden="true" />
                <span>
                  <strong>
                    {codexSummary?.codexConnected
                      ? `Codex 已安全连接 · ${codexSummary.codexSessionCount} 个本机会话`
                      : codexSummary
                        ? 'Codex 尚未连接'
                        : codexStatusError
                          ? '桌面连接状态不可用'
                          : '正在读取本机连接状态'}
                  </strong>
                  <small>
                    {codexSummary?.pendingPairingCount
                      ? `有 ${codexSummary.pendingPairingCount} 个待确认请求，请核对 Codex 与弹窗中的验证码。`
                      : codexSummary?.codexConnected
                        ? `当前权限：${codexSummary.codexScopes.map((scope) => CODEX_SCOPE_LABELS[scope] || scope).join('、') || '只读'}`
                        : '连接前不会读取画布内容，也不会自动获得修改或运行权限。'}
                  </small>
                </span>
              </div>
              <div className="t8-creator-agent-codex__prompt">
                <small>把这一句话发给 Codex</small>
                <p>{CODEX_CONNECT_PROMPT}</p>
                <button type="button" onClick={() => void copyCodexConnectPrompt()}>
                  {codexCopied ? <><Check size={13} />已复制</> : '复制一句话'}
                </button>
              </div>
              {codexStatusError && <p role="status">{codexStatusError}</p>}
              <footer>
                只复制说明文字；API Key、token、Cookie、路径和画布私有内容不会进入剪贴板。
              </footer>
            </section>
          )}

          {historyOpen && (
            <section className="t8-creator-agent-history" aria-label="创作会话历史">
              <header>
                <div>
                  <History size={14} />
                  <strong>创作会话</strong>
                </div>
                <small>{historyLoading ? '正在读取…' : `${sessionHistory.length} 个`}</small>
              </header>
              <div>
                {sessionHistory.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={item.id === session?.id ? 'is-current' : ''}
                    aria-pressed={item.id === session?.id}
                    onClick={() => switchSession(item)}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.phase} · {Math.max(0, item.lastSequence - 1)} 个事件
                      </small>
                    </span>
                    <time dateTime={item.updatedAt}>
                      {new Date(item.updatedAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </button>
                ))}
                {!historyLoading && sessionHistory.length === 0 && <p>当前画布还没有可恢复会话</p>}
              </div>
            </section>
          )}

          {false && detailsOpen && (
            <section
              id="t8-creator-agent-details-content"
              className="t8-creator-agent-details"
              aria-label="创作计划"
            >
              <header className="t8-creator-agent-details__header">
                <span>
                  <strong>创作计划</strong>
                  <small>按需查看方案与执行状态</small>
                </span>
                <div>
                  <button
                    type="button"
                    title="连接 Codex / 本地 Agent"
                    className={codexOpen ? 'is-active' : ''}
                    aria-expanded={codexOpen}
                    onClick={() => {
                      setCodexOpen((current) => !current);
                      setHistoryOpen(false);
                      setCodexCopied(false);
                    }}
                  >
                    <Link2 size={14} />
                    Codex
                  </button>
                  <button
                    type="button"
                    title={launcherEffectsEnabled ? '关闭装饰特效（低资源模式）' : '开启装饰特效'}
                    aria-pressed={launcherEffectsEnabled}
                    onClick={toggleLauncherEffects}
                  >
                    <Sparkles size={14} />
                    {launcherEffectsEnabled ? '特效开' : '特效关'}
                  </button>
                  <button
                    type="button"
                    aria-label="关闭创作计划"
                    onClick={() => {
                      setDetailsOpen(false);
                      setCodexOpen(false);
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              </header>
              <div className="t8-creator-agent-details__scroll">
          <nav className="t8-creator-agent-phases" aria-label="创作阶段">
            {CREATIVE_PHASES.map((phase, index) => (
              <span
                key={phase.id}
                className={[
                  completedPhaseIds.has(phase.id) ? 'is-done' : '',
                  index === activePhaseIndex ? 'is-current' : '',
                  invalidatedPhaseIds.has(phase.id) ? 'is-revising' : '',
                ].filter(Boolean).join(' ')}
                aria-current={index === activePhaseIndex ? 'step' : undefined}
                title={invalidatedPhaseIds.has(phase.id) ? `${phase.label}需要重新确认` : undefined}
              >
                <i aria-hidden="true">
                  {completedPhaseIds.has(phase.id) ? <Check size={10} /> : index + 1}
                </i>
                {phase.label}
              </span>
            ))}
          </nav>

          {session?.production && (
            <section className={`t8-creator-agent-phase-receipt ${phaseReceipt.tone}`} aria-live="polite">
              <span>
                <strong>{phaseReceipt.title}</strong>
                <small>{phaseReceipt.detail}</small>
                <dl className="t8-creator-agent-phase-scope" aria-label="阶段范围回执">
                  <div>
                    <dt>已完成</dt>
                    <dd>{phaseScopeReceipt.completed}</dd>
                  </div>
                  <div>
                    <dt>待完成</dt>
                    <dd>{phaseScopeReceipt.pending}</dd>
                  </div>
                  <div>
                    <dt>影响范围</dt>
                    <dd>{phaseScopeReceipt.impact}</dd>
                  </div>
                </dl>
              </span>
            </section>
          )}

          <section className="t8-creator-agent-context-receipt" aria-label="Agent 当前理解">
            <Sparkles size={14} aria-hidden="true" />
            <span>
              <strong>{contextReceipt.title}</strong>
              <small>{contextReceipt.detail}</small>
            </span>
          </section>
          {currentToolProposals.length > 0 && (
            <section className="t8-creator-agent-tool-proposals" aria-label="待确认操作">
              <header>
                <WandSparkles size={14} aria-hidden="true" />
                <span>
                  <strong>待确认操作</strong>
                  <small>{currentToolProposals.length} 项建议已准备，尚未执行</small>
                </span>
              </header>
              <div>
                {currentToolProposals.map((proposal) => {
                  const stage = creatorToolProposalStage(session?.events, proposal.proposalId);
                  const terminal = ['applied', 'running', 'verified'].includes(stage);
                  return (
                    <article key={proposal.proposalId} data-proposal-stage={stage}>
                      <span>
                        <strong>{proposal.tool.creatorLabel || proposal.tool.capabilityId}</strong>
                        <small>
                          {proposal.gate.previewRequired ? '需先预览并确认' : '先核对操作预览'}
                        </small>
                      </span>
                      <em>{creatorToolProposalStageLabel(stage)}</em>
                      <button
                        type="button"
                        disabled={busy || Boolean(preparingProposalId) || terminal}
                        onClick={() => void prepareToolProposal(proposal)}
                      >
                        {preparingProposalId === proposal.proposalId
                          ? <LoaderCircle size={12} className="animate-spin" />
                          : <WandSparkles size={12} />}
                        {stage === 'prepared' ? '重新打开预览' : terminal ? '已进入执行链' : '预览并确认'}
                      </button>
                    </article>
                  );
                })}
              </div>
              <p>Agent 不会自动生成内容、改动画布或写入文件。</p>
            </section>
          )}
          {creativeArtifacts.length > 0 && (
            <section className="t8-creator-agent-artifacts" aria-label="可编辑创作产物">
              <header>
                <FileText size={14} aria-hidden="true" />
                <span>
                  <strong>可编辑产物</strong>
                  <small>每轮正文保存为独立版本；后续修改不会覆盖上一版</small>
                </span>
              </header>
              <div>
                {creativeArtifacts.map((artifact) => {
                  const version = creativeArtifactVersions.find(
                    (current) => current.versionId === artifact.versionId,
                  );
                  const sectionLabels = (version?.content.sections || [])
                    .map((section) => section.title)
                    .filter(Boolean)
                    .slice(0, 3);
                  const changeCount = version?.diff.operations.length || 0;
                  return (
                    <article key={artifact.artifactId}>
                      <span>
                        <strong>{artifact.title}</strong>
                        <small>
                          v{artifact.revision}
                          {' · '}
                          {artifact.status === 'model-draft' ? '模型草案' : '离线结构草案'}
                          {' · '}
                          {artifact.revision === 1 ? '首版' : `${changeCount} 项版本差异`}
                        </small>
                      </span>
                      {sectionLabels.length > 0 && <em>{sectionLabels.join(' · ')}</em>}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {(selectedOutputAssets.length > 0 || lineageReadError) && (
            <section className="t8-creator-agent-filmstrip" aria-label="当前选区真实素材">
              <header>
                <strong>当前选区素材</strong>
                <small>
                  {assetLineage.length > 0
                    ? `${assetLineage.length} 项来源已核对`
                    : '正在读取持久素材'}
                </small>
              </header>
              {selectedOutputAssets.length > 0 && (
                <div className="t8-creator-agent-filmstrip__rail">
                  {selectedOutputAssets.map((asset) => {
                    const previewUrl = creatorAssetPreviewUrl(asset);
                    const lineage = assetLineageById.get(asset.id);
                    const sourceNodeId = lineage?.sourceNodeIds[0] || '';
                    const placeable = ['image', 'video', 'audio', 'text', 'model3d'].includes(asset.kind);
                    const placing = placingAssetId === asset.id;
                    return (
                      <article key={asset.id} title={asset.filename || asset.id}>
                        <span className="t8-creator-agent-filmstrip__preview" aria-hidden="true">
                          {previewUrl ? (
                            <img src={previewUrl} alt="" loading="lazy" decoding="async" />
                          ) : asset.kind === 'video' ? (
                            <FileVideo size={18} />
                          ) : asset.kind === 'audio' ? (
                            <FileAudio size={18} />
                          ) : (
                            <FileImage size={18} />
                          )}
                        </span>
                        <span className="t8-creator-agent-filmstrip__meta">
                          <strong>{asset.filename || '未命名素材'}</strong>
                          <small>
                            {asset.kind}
                            {asset.availability ? ` · ${asset.availability}` : ''}
                            {lineage?.eventCount ? ` · ${lineage.eventCount} 条来源` : ''}
                          </small>
                        </span>
                        <span className="t8-creator-agent-filmstrip__actions">
                          <button
                            type="button"
                            title={placeable
                              ? '先预览确定性画布变更，确认后再放入画布；不会调用模型'
                              : '当前素材类型不能直接放入画布'}
                            disabled={!placeable
                              || !availableCapabilityIds.has('asset.place')
                              || busy
                              || Boolean(placingAssetId)}
                            onClick={() => void prepareAssetPlacement(asset)}
                          >
                            {placing ? <LoaderCircle size={11} className="animate-spin" /> : <Send size={11} />}
                            发送
                          </button>
                          {sourceNodeId && (
                            <button
                              type="button"
                              title="定位到产生这个素材的节点"
                              disabled={busy || Boolean(placingAssetId)}
                              onClick={() => props.onFocusNode(sourceNodeId)}
                            >
                              定位
                            </button>
                          )}
                        </span>
                      </article>
                    );
                  })}
                </div>
              )}
              {lineageReadError && <p role="status">{lineageReadError}</p>}
            </section>
          )}
          {(runDetails.length > 0 || runSyncError) && (
            <section className="t8-creator-agent-runs" aria-label="当前画布真实任务">
              <header>
                <div>
                  <strong>当前画布真实任务</strong>
                  <small>Run / NodeRun / Attempt</small>
                </div>
                {Number(context.outputAssetCount) > 0 && (
                  <button
                    type="button"
                    disabled={busy || uploading}
                    title="只把已核验本地素材纳入交付清单；创建文件前仍会桌面确认"
                    onClick={() => void submit('把当前画布已验证素材打包交付')}
                  >
                    <FolderOpen size={12} />
                    准备交付
                  </button>
                )}
              </header>
              {runDetails.map((run) => {
                const assetIds = [...new Set(run.nodeRuns.flatMap((nodeRun) => nodeRun.outputRefs || []))];
                return (
                  <RealRunActivity
                    key={run.id}
                    run={run}
                    assets={assetIds.map((assetId) => assetsById[assetId]).filter(Boolean)}
                    link={session?.runLinks?.find((link) => link.runId === run.id)}
                    verification={session?.artifactVerifications?.find((item) => item.runId === run.id)}
                    verifying={verifyingRunId === run.id}
                    onVerify={(runId) => void verifyRunArtifacts(runId)}
                    onFocusNode={props.onFocusNode}
                  />
                );
              })}
              {runSyncError && (
                <p>真实任务暂时无法读取：{runSyncError}</p>
              )}
            </section>
          )}

          {(candidateComparisonLoading || candidateComparison) && (
            <div className="t8-creator-agent-comparison-wrap">
              {candidateComparisonLoading && !candidateComparison ? (
                <div className="t8-creator-agent-comparison-loading">
                  <LoaderCircle size={14} className="animate-spin" />
                  正在读取真实候选作品…
                </div>
              ) : candidateComparison ? (
                <CandidateComparison
                  comparison={candidateComparison!}
                  selectedNodeIds={props.selectedNodeIds}
                  busyAction={candidateActionBusy}
                  availableCapabilityIds={new Set(
                    capabilities?.capabilities.map((capability) => capability.id) || [],
                  )}
                  onFocusNode={props.onFocusNode}
                  onReview={(candidate, dimensions, notes) => {
                    const evidence = {
                      ...(candidate.reviewEvidence.url ? { url: candidate.reviewEvidence.url } : {}),
                      ...(candidate.reviewEvidence.assetId ? { assetId: candidate.reviewEvidence.assetId } : {}),
                      ...(candidate.reviewEvidence.contentHash ? { contentHash: candidate.reviewEvidence.contentHash } : {}),
                    };
                    void createCandidateActionPlan('review', candidate, {
                      schema: 't8-creative-review-v1',
                      source: 'visual-inspection',
                      reviewer: 'creator',
                      evidence,
                      dimensions: Object.fromEntries(Object.entries(dimensions).map(([dimension, status]) => [
                        dimension,
                        {
                          status,
                          summary: status === 'pass'
                            ? `${reviewDimensionLabel(dimension)}通过`
                            : status === 'warn'
                              ? `${reviewDimensionLabel(dimension)}可接受但需注意`
                              : `${reviewDimensionLabel(dimension)}不通过`,
                          evidence: '创作者在候选对比面板中检查了当前实际作品',
                        },
                      ])),
                      notes,
                    });
                  }}
                  onAction={(action, candidate) => void createCandidateActionPlan(action, candidate)}
                />
              ) : null}
            </div>
          )}
              </div>
            </section>
          )}

          <div
            className="t8-creator-agent-messages"
            ref={scrollRef}
            role="log"
            aria-live="off"
            aria-relevant="additions text"
            aria-busy={hasStreamingResponse}
            onScroll={trackMessageScroll}
          >
            {(olderMessageCount > 0 || newerMessageCount > 0) && (
              <nav className="t8-creator-agent-history-window" aria-label="长会话消息翻页">
                <button type="button" disabled={olderMessageCount === 0} onClick={showOlderMessages}>
                  更早消息{olderMessageCount > 0 ? `（${olderMessageCount}）` : ''}
                </button>
                <span>
                  {historyWindowStart + 1}–{historyWindowEnd} / {allVisibleEvents.length}
                </span>
                <button type="button" disabled={newerMessageCount === 0} onClick={showNewerMessages}>
                  较新消息{newerMessageCount > 0 ? `（${newerMessageCount}）` : ''}
                </button>
              </nav>
            )}
            {allVisibleEvents.length === 0 && (
              <section className="t8-creator-agent-empty">
                <div className="t8-creator-agent-empty__orb">
                  <Sparkles size={26} />
                </div>
                <span>Hi，创作者</span>
                <h2>今天想把什么灵感做出来？</h2>
                <span className="sr-only">没有你的确认，不会写画布或调用模型。</span>
                <button
                  type="button"
                  className="t8-creator-agent-empty__shuffle"
                  aria-label="换一批创作想法"
                  title="只更换本地创作想法，不调用模型"
                  disabled={busy || uploading}
                  onClick={rotateStarterIdeas}
                >
                  <RefreshCw size={13} />
                  换一批
                </button>
              </section>
            )}

            {visibleEvents.map((event) => {
              const isUser = event.type === 'user.message'
                || event.type === 'user.suggestion'
                || event.type === 'user.action';
              const plan = eventPlan(event);
              const readinessReceipt = eventReadinessReceipt(event);
              const artifactVersion = eventArtifactVersion(event);
              return (
                <div
                  key={event.eventId}
                  className={`t8-creator-agent-message ${isUser ? 'is-user' : 'is-assistant'}`}
                  data-creator-agent-plan-id={plan?.planId || undefined}
                  data-readiness-schema={readinessReceipt?.schema || undefined}
                  data-local-plan-ms={readinessReceipt?.localPlanMs}
                  data-local-plan-target-ms={readinessReceipt?.targetMs}
                  data-local-plan-within-target={readinessReceipt?.withinTarget}
                  data-plan-provider-calls={readinessReceipt?.sideEffects.providerCalls}
                  data-plan-canvas-writes={readinessReceipt?.sideEffects.canvasWrites}
                  data-plan-production-file-writes={readinessReceipt?.sideEffects.productionFileWrites}
                >
                  {!isUser && <span className="t8-creator-agent-avatar"><Sparkles size={14} /></span>}
                  <div className="t8-creator-agent-message__body">
                    {event.type === 'user.suggestion' && Boolean(event.payload.suggestion) && (
                      <span className="t8-creator-agent-suggestion-selection">
                        已选择：{String(
                          (event.payload.suggestion as { label?: unknown }).label || '当前建议',
                        )}
                      </span>
                    )}
                    {event.type !== 'user.suggestion' && event.payload.text && (
                      <CreatorAgentMessageText text={String(event.payload.text)} isUser={isUser} />
                    )}
                    {event.type === 'assistant.response' && event.payload.streamStatus === 'streaming' && (
                      <span className="t8-creator-agent-stream-status" aria-hidden="true">
                        {event.payload.text ? '继续整理中' : '正在理解并组织为可编辑步骤'}
                      </span>
                    )}
                    {event.type === 'assistant.response' && event.payload.streamStatus === 'failed' && (
                      <span className="t8-creator-agent-stream-status is-failed" aria-hidden="true">
                        {String(event.payload.streamError || '回复意外中断；已保留你的要求，可以直接重试。')}
                      </span>
                    )}
                    {event.type === 'assistant.response' && event.payload.streamStatus === 'stopped' && (
                      <span className="t8-creator-agent-stream-status is-stopped" aria-hidden="true">
                        {String(event.payload.streamMessage || '已停止本轮文字回复；画布里的生成任务没有被取消。')}
                      </span>
                    )}
                    {event.type === 'user.action' && Boolean(event.payload.label) && (
                      <p>{String(event.payload.label)}</p>
                    )}
                    {Array.isArray(event.payload.attachments) && event.payload.attachments.length > 0 && (
                      <div className="t8-creator-agent-attachments is-inline">
                        {event.payload.attachments.map((attachment) => (
                          <span key={attachment.id}>{attachment.name}</span>
                        ))}
                      </div>
                    )}
                    {artifactVersion && (
                      <div className="t8-creator-agent-artifact-chip">
                        <span>
                          <strong>可编辑产物</strong>
                          <small>
                            v{artifactVersion.revision}
                            {' · '}
                            {artifactVersion.status === 'model-draft' ? '模型草案' : '离线结构草案'}
                          </small>
                        </span>
                        <em>
                          {artifactVersion.revision === 1
                            ? '首版'
                            : `${artifactVersion.diff.operations.length} 项版本差异`}
                        </em>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {currentToolProposals.length > 0 && (
              <section className="t8-creator-agent-tool-proposals is-visible" aria-label="待确认操作">
                <header>
                  <WandSparkles size={14} aria-hidden="true" />
                  <span>
                    <strong>待确认操作</strong>
                    <small>{currentToolProposals.length} 项建议已准备，尚未执行</small>
                  </span>
                </header>
                <div>
                  {currentToolProposals.map((proposal) => {
                    const stage = creatorToolProposalStage(session?.events, proposal.proposalId);
                    const terminal = ['applied', 'running', 'verified'].includes(stage);
                    return (
                      <article key={proposal.proposalId} data-proposal-stage={stage}>
                        <span>
                          <strong>{proposal.tool.creatorLabel || proposal.tool.capabilityId}</strong>
                          <small>
                            {proposal.gate.previewRequired ? '需先预览并确认' : '先核对操作预览'}
                          </small>
                        </span>
                        <em>{creatorToolProposalStageLabel(stage)}</em>
                        <button
                          type="button"
                          disabled={busy || Boolean(preparingProposalId) || terminal}
                          onClick={() => void prepareToolProposal(proposal)}
                        >
                          {preparingProposalId === proposal.proposalId
                            ? <LoaderCircle size={12} className="animate-spin" />
                            : <WandSparkles size={12} />}
                          {stage === 'prepared' ? '重新打开预览' : terminal ? '已进入执行链' : '预览并确认'}
                        </button>
                      </article>
                    );
                  })}
                </div>
                <p>Agent 不能直接执行：必须先通过能力校验、预览和你的确认。</p>
              </section>
            )}

            {latestWorkArtifacts.length > 0 && session?.creatorWork && (
              <section className="t8-creator-work" aria-label="当前结构化作品">
                <header>
                  <span>
                    <Sparkles size={14} aria-hidden="true" />
                    <span>
                      <strong>当前作品 · V{session.creatorWork.revision}</strong>
                      <small>
                        {session.creatorWork.taskProfile.deliveryKind}
                        {' · '}
                        {latestWorkArtifacts.length} 份可编辑文档
                      </small>
                    </span>
                  </span>
                  <em>
                    {session.creatorWork.taskProfile.qualityMode === 'quality'
                      ? '高质量'
                      : session.creatorWork.taskProfile.qualityMode === 'standard'
                        ? '标准'
                        : '快速'}
                  </em>
                </header>
                <p>{session.creatorWork.taskProfile.intent}</p>
                {session.creatorWork.invalidatedKinds.length > 0 && (
                  <p className="t8-creator-work__invalidation" role="status">
                    上游版本已变化，以下作品需要重新核对：
                    {' '}{session.creatorWork.invalidatedKinds.join('、')}
                  </p>
                )}
                <div className="t8-creator-work__documents">
                  {latestWorkArtifacts.map((artifact) => (
                    <CreatorWorkArtifactCard
                      key={artifact.versionId}
                      artifact={artifact}
                      versions={workArtifactHistories.get(artifact.artifactId) || [artifact]}
                      busyAction={workActionBusy}
                      onRevise={(current, action, field, value) => {
                        void reviseWork(current, action, field, value);
                      }}
                    />
                  ))}
                </div>
                <footer>
                  <span>字段修改、接受和锁定只创建作品版本，不调用模型、运行节点或写入画布。</span>
                  {latestWorkReceipt && (
                    <details className="t8-creator-work__diagnostics">
                      <summary>本轮模型凭证</summary>
                      <dl>
                        <div><dt>渠道 / 模型</dt><dd>{latestWorkReceipt.provider} · {latestWorkReceipt.model}</dd></div>
                        <div><dt>真实调用</dt><dd>{latestWorkReceipt.providerCalls} 次 · {latestWorkReceipt.status}</dd></div>
                        <div><dt>请求</dt><dd>{latestWorkReceipt.calls.map((call) => call.requestId || '无 request ID').join(' · ')}</dd></div>
                        <div><dt>作品摘要</dt><dd>{session.creatorWork.workDigest.slice(0, 16)}</dd></div>
                        <div><dt>回执摘要</dt><dd>{latestWorkReceipt.receiptDigest.slice(0, 16)}</dd></div>
                      </dl>
                    </details>
                  )}
                </footer>
              </section>
            )}

            {thinkingActive && (
              <div className="t8-creator-agent-thinking">
                <LoaderCircle size={15} className="animate-spin" />
                <span>
                  {confirmingDocumentKey
                    ? '正在确认当前版本并准备画布留存'
                    : patchPreview && busy
                    ? '正在把你确认的内容写入画布'
                    : hasStreamingResponse
                      ? '正在构思并整理本阶段方案'
                      : '正在准备本阶段内容'}
                  {'（已 '}{thinkingSeconds} 秒）
                </span>
              </div>
            )}

            {!thinkingActive
              && !patchPreview
              && currentStagePlan
              && currentStageComplete
              && currentStageUnconfirmedDocuments.length > 0
              && creativeArtifactVersions.some((artifact) => artifact.status === 'model-draft')
              && stageContinuationSuggestion && (
                <section className="t8-creator-agent-stage-confirm" aria-label="确认当前创作阶段">
                  <span>
                    <strong>{creativePhaseLabel(activePhase)}方案已整理好</strong>
                    <small>可继续修改；确认后进入下一阶段，并准备一份画布留存预览。</small>
                  </span>
                  <button
                    type="button"
                    disabled={busy || Boolean(confirmingDocumentKey)}
                    onClick={() => {
                      void continueFromStageSuggestion(stageContinuationSuggestion);
                    }}
                  >
                    {confirmingDocumentKey
                      ? <LoaderCircle size={14} className="animate-spin" />
                      : <Check size={14} />}
                    {CREATOR_STAGE_CONFIRM_LABELS[activePhase]}
                  </button>
                </section>
              )}

            {patchPreview && (
              <section className="t8-creator-agent-confirm">
                <div>
                  <span>画布变更预览</span>
                  <strong>
                    {patchPreview.preview.affectedNodeIds.length} 节点
                    {' · '}{patchPreview.preview.affectedEdgeIds.length} 连线
                    {' · '}基于 r{patchPreview.preview.baseRevision}
                  </strong>
                </div>
                <p>
                  {pendingStageContinuation
                    ? `只会留存已确认内容；写入后 Agent 会自动进入「${creativePhaseLabel(
                        pendingStageContinuation.targetPhase,
                      )}」并继续交付下一版可编辑稿。`
                    : '只会添加或调整预览中列出的内容；生成任务仍需在画布中单独运行。'}
                </p>
                <ol className="t8-creator-agent-confirm__changes" aria-label="将写入画布的节点和连线">
                  {patchPreviewItems.map((item) => (
                    <li key={item.key} data-kind={item.kind}>
                      <span>{item.title}</span>
                      <small>{item.detail}</small>
                    </li>
                  ))}
                </ol>
                {patchPreview.plan.assetPlacement && (
                  <div className="t8-creator-agent-confirm__lineage">
                    <span>素材来源</span>
                    <strong>{patchPreview.plan.assetPlacement.asset.filename}</strong>
                    <small>
                      Asset {creatorPatchEntityLabel(patchPreview.plan.assetPlacement.lineage.assetId)}
                      {' · '}r{patchPreview.plan.assetPlacement.lineage.contentRevision}
                      {' · '}SHA-256 {patchPreview.plan.assetPlacement.lineage.contentHash.slice(0, 12)}
                    </small>
                    <small>
                      {patchPreview.plan.assetPlacement.targetNodeId
                        ? `${creatorPatchEndpoint(
                            patchPreview.plan.assetPlacement.nodeId,
                            patchPreview.plan.assetPlacement.sourceHandle,
                          )} → ${creatorPatchEndpoint(
                            patchPreview.plan.assetPlacement.targetNodeId,
                            patchPreview.plan.assetPlacement.targetHandle,
                          )}`
                        : `只放置 ${patchPreview.plan.assetPlacement.nodeType} 节点，不自动连线`}
                      {' · '}{creatorPatchPositionLabel(patchPreview.plan.assetPlacement.position)}
                    </small>
                  </div>
                )}
                {patchPreview.preview.warnings?.slice(0, 3).map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setPatchPreview(null);
                      setPendingStageContinuation(null);
                    }}
                  >
                    返回修改
                  </button>
                  <button type="button" disabled={busy} onClick={() => void applyPreview()}>
                    {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
                    确认添加到画布
                  </button>
                </div>
              </section>
            )}

            {!patchPreview && recommendationChoicesReady && suggestionContractBroken && (
              <div className="t8-creator-agent-suggestion-warning" role="status">
                当前能力清单无法提供完整的 3 条建议，请更新应用或新建会话后重试。
              </div>
            )}

            {!patchPreview && recommendationChoicesReady && suggestions.length === 3 && (
              <>
                <div className="t8-creator-agent-suggestions" aria-label="选择一个方向继续">
                  {suggestions.map((suggestion) => {
                    const blockedReason = suggestion.disabledReason
                      || suggestion.blockers?.[0]?.message
                      || suggestion.unblockActions?.[0]
                      || '';
                    const accessibleLabel = [
                      suggestion.label,
                      suggestion.description,
                      blockedReason,
                    ].filter(Boolean).join('。');
                    return (
                      <button
                        type="button"
                        key={suggestion.id}
                        title={blockedReason || suggestion.label}
                        aria-label={accessibleLabel}
                        data-suggestion-id={suggestion.id}
                        data-suggestion-intent={suggestion.intent}
                        data-suggestion-executable={suggestion.executable ? 'true' : 'false'}
                        data-required-capabilities={suggestion.requiredCapabilityIds.join(',')}
                        disabled={busy || uploading || !capabilityReady || !suggestion.executable || Boolean(blockedReason)}
                        onClick={() => {
                          if (suggestion.arguments
                            && 'confirmCurrentStage' in suggestion.arguments
                            && suggestion.arguments.confirmCurrentStage === true) {
                            void continueFromStageSuggestion(suggestion);
                            return;
                          }
                          void submit(
                            isPristineSession
                              ? String(suggestion.arguments?.creatorPrompt || suggestion.label)
                              : '',
                            !isPristineSession && session?.suggestionSet?.setDigest
                              ? { id: suggestion.id, setDigest: session.suggestionSet.setDigest }
                              : undefined,
                          );
                        }}
                      >
                        <span className="t8-creator-agent-suggestions__content">
                          <strong>{suggestion.label}</strong>
                          {suggestion.description && <small>{suggestion.description}</small>}
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
                <div className="t8-creator-agent-custom-idea">
                  <label htmlFor="t8-creator-agent-custom-idea">✎ 我有其他想法</label>
                  <div>
                    <textarea
                      id="t8-creator-agent-custom-idea"
                      rows={2}
                      maxLength={200_000}
                      value={customIdeaDraft}
                      placeholder="直接写你的方向，或修改上面任一方案…"
                      disabled={busy || uploading}
                      onChange={(event) => setCustomIdeaDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      title="按我的想法继续"
                      aria-label="按我的想法继续"
                      disabled={busy || uploading || !customIdeaDraft.trim()}
                      onClick={() => {
                        const value = customIdeaDraft.trim();
                        if (!value) return;
                        setCustomIdeaDraft('');
                        void submit(value);
                      }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="t8-creator-agent-error" role="alert">
              {error}
            </div>
          )}

          {uploadTasks.length > 0 && (
            <div className="t8-creator-agent-upload-queue" aria-label="附件上传进度">
              {uploadTasks.map((task) => (
                <div key={task.id} className={task.status === 'failed' ? 'is-failed' : ''}>
                  <span title={task.name}>{task.name}</span>
                  <em title={task.error}>{uploadProgressLabel(task)}</em>
                  <i aria-hidden="true">
                    <b style={{ width: `${task.percent ?? 18}%` }} />
                  </i>
                  <div className="t8-creator-agent-upload-queue__actions">
                    {task.status === 'failed' && (
                      <button
                        type="button"
                        aria-label={`重试上传 ${task.name}`}
                        title="重试这个附件"
                        disabled={uploading || busy}
                        onClick={() => retryUpload(task.id)}
                      >
                        <RefreshCw size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${task.status === 'failed' ? '移除失败项' : '取消上传'} ${task.name}`}
                      title={task.status === 'failed' ? '移除失败项' : '取消这一个附件'}
                      onClick={() => cancelUpload(task.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="t8-creator-agent-attachments">
              {attachments.map((attachment) => (
                <span key={attachment.id}>
                  {attachment.kind === 'image'
                    ? <FileImage size={13} />
                    : attachment.kind === 'video'
                      ? <FileVideo size={13} />
                      : attachment.kind === 'audio'
                        ? <FileAudio size={13} />
                        : <Paperclip size={13} />}
                  {attachment.name}
                  <button
                    type="button"
                    aria-label={`移除 ${attachment.name}`}
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {referencedNodes.length > 0 && (
            <div className="t8-creator-agent-references" aria-label="本轮显式引用">
              {referencedNodes.map((reference) => (
                <span key={reference.nodeId}>
                  <AtSign size={12} />
                  <b>{reference.label}</b>
                  {reference.assetIds.length > 0 && <small>{reference.assetIds.length} 素材</small>}
                  <button
                    type="button"
                    aria-label={`移除引用 ${reference.label}`}
                    title="只移除本轮引用，不删除画布节点或素材"
                    onClick={() => setReferencedNodes((current) => (
                      current.filter((item) => item.nodeId !== reference.nodeId)
                    ))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {modelSettingsOpen && (
            <section className="t8-creator-agent-models" aria-label="创作模型与平台">
              <header className="t8-creator-agent-models__head">
                <div>
                  <strong>创作模型</strong>
                  <small>默认自动匹配；只在你明确选择时固定平台与模型。</small>
                </div>
                <button type="button" aria-label="关闭创作模型" onClick={() => setModelSettingsOpen(false)}>
                  <X size={14} />
                </button>
              </header>
              <div className="t8-creator-agent-models__grid">
                {CREATOR_MODEL_KINDS.map((modelKind) => {
                  const availableModels = (runtimeCatalog?.models || [])
                    .filter((item) => item.kind === modelKind);
                  const currentPreference = modelPreferences[modelKind];
                  const currentValue = creatorModelPreferenceValue(currentPreference);
                  const currentModel = currentPreference
                    ? availableModels.find((item) => item.provider === currentPreference.provider
                        && item.model === currentPreference.model)
                    : null;
                  const platformLabels = [...new Set(availableModels.map((item) => item.platformLabel || item.provider))];
                  return (
                    <label key={modelKind}>
                      <span>{CREATOR_MODEL_KIND_LABELS[modelKind]}</span>
                      <select
                        value={currentValue}
                        disabled={!runtimeCatalog || busy}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setModelPreferences((current) => {
                            const next = { ...current };
                            if (!value) {
                              delete next[modelKind];
                              return next;
                            }
                            try {
                              const parsed = JSON.parse(value) as [string, string];
                              if (!Array.isArray(parsed) || !parsed[0] || !parsed[1]) return current;
                              next[modelKind] = { provider: parsed[0], model: parsed[1] };
                              return next;
                            } catch {
                              return current;
                            }
                          });
                        }}
                      >
                        <option value="">自动匹配（推荐）</option>
                        {currentPreference && !currentModel && (
                          <option value={currentValue} disabled>
                            已固定：{currentPreference.provider} / {currentPreference.model}（目录暂不可用）
                          </option>
                        )}
                        {platformLabels.map((platformLabel) => (
                          <optgroup key={platformLabel} label={platformLabel}>
                            {availableModels
                              .filter((item) => (item.platformLabel || item.provider) === platformLabel)
                              .map((item) => (
                                <option
                                  key={item.id}
                                  value={JSON.stringify([item.provider, item.model])}
                                  disabled={!creatorRuntimeModelExecutable(item)}
                                >
                                  {item.label || item.model}
                                  {creatorRuntimeModelStatus(item) ? `（${creatorRuntimeModelStatus(item)}）` : ''}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <footer className="t8-creator-agent-models__foot">
                <span>
                  {runtimeCatalog
                    ? `已就绪 ${runtimeCatalog.counts.executableModels}/${runtimeCatalog.counts.models} 个模型 · ${runtimeCatalog.counts.executableActions}/${runtimeCatalog.counts.actions} 个专项动作`
                    : '正在读取真实节点目录…'}
                </span>
                <button type="button" onClick={() => setModelPreferences({})}>全部恢复自动</button>
              </footer>
            </section>
          )}
          <footer className="t8-creator-agent-composer">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              accept="image/*,video/*,audio/*,.txt,.md,.pdf"
              onChange={onFilesSelected}
            />
            <textarea
              ref={composerRef}
              data-creator-agent-composer="true"
              value={draft}
              rows={2}
              maxLength={200_000}
              placeholder={messageAttachments.length > 0
                ? '可直接发送引用素材，或补一句你想怎么处理…'
                : referencedNodes.length > 0
                  ? '已引用节点；补一句你想怎么处理…'
                : '描述创意、粘贴剧本，或告诉我下一步…'}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              onCompositionStart={() => {
                composerComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                composerComposingRef.current = false;
                compositionEndedAtRef.current = Date.now();
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files || []);
                if (files.length) void uploadFiles(files);
              }}
            />
            {hasStreamingResponse && (
              <p className="t8-creator-agent-composer__stop-note" role="note">
                停止回复只结束本轮文字输出；画布中已提交的图像、视频或音频任务仍会继续，取消远端任务需在对应任务卡单独操作。
              </p>
            )}
            <div className="t8-creator-agent-composer__bar">
              <button
                type="button"
                title="添加图片、视频、音频或文档"
                disabled={uploading || busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <LoaderCircle size={17} className="animate-spin" /> : <Paperclip size={17} />}
              </button>
              <button
                type="button"
                className={`t8-creator-agent-reference-trigger${referencedNodes.length ? ' is-active' : ''}`}
                title={props.selectedNodeIds.length > 0
                  ? '把当前选区固定为本轮引用；已持久化素材会一并发送'
                  : '先在画布上选中要引用的节点'}
                aria-label="引用当前选区"
                disabled={props.selectedNodeIds.length === 0 || busy}
                onClick={pinSelectedNodes}
              >
                <AtSign size={14} />
                <span>{referencedNodes.length ? `已引用 ${referencedNodes.length}` : '引用选区'}</span>
              </button>
              <button
                type="button"
                className={`t8-creator-agent-model-trigger${modelSettingsOpen ? ' is-active' : ''}`}
                title="选择语言、图像、视频和音频模型；默认由 Agent 自动匹配"
                aria-expanded={modelSettingsOpen}
                onClick={() => setModelSettingsOpen((value) => !value)}
              >
                <Sparkles size={14} />
                <span>{selectedModelPreferenceCount ? `已固定 ${selectedModelPreferenceCount} 项` : '智能选模'}</span>
              </button>
              <label
                className="t8-creator-agent-quality-mode"
                title="快速 1 次；标准 2 次；高质量 3 次。控制操作不会额外调用模型。"
              >
                <span>作品质量</span>
                <select
                  value={workQualityMode}
                  disabled={busy || hasStreamingResponse}
                  onChange={(event) => {
                    const value = event.currentTarget.value as CreatorAgentWorkQualityMode;
                    setWorkQualityMode(value);
                    try {
                      window.localStorage.setItem(
                        `t8.creator-agent.quality.${props.projectId}.${props.canvasId}`,
                        value,
                      );
                    } catch {
                      // Local storage is optional; the in-memory choice still applies.
                    }
                  }}
                >
                  <option value="quick">快速 · 1 次</option>
                  <option value="standard">标准 · 2 次</option>
                  <option value="quality">高质量 · 3 次</option>
                </select>
              </label>
              <span className="t8-creator-agent-call-estimate" role="note">
                本轮预计 {workQualityMode === 'quality' ? 3 : workQualityMode === 'standard' ? 2 : 1} 次模型调用
                {messageAttachments.filter((attachment) => attachment.kind === 'audio').length > 0
                  ? ` · 另需 ${messageAttachments.filter((attachment) => attachment.kind === 'audio').length} 次音频转写`
                  : ''}
              </span>
              {hasStreamingResponse ? (
                <button
                  type="button"
                  className="is-stop-response"
                  aria-label="停止本轮回复，不取消远端生成任务"
                  title="只停止本轮文字回复；不会取消画布里的远端生成任务"
                  disabled={!activeStreamingResponseId || Boolean(stoppingResponseId)}
                  onClick={() => void stopResponse(
                    activeStreamingResponseId,
                    activeStreamingClientRequestId,
                  )}
                >
                  {stoppingResponseId
                    ? <LoaderCircle size={15} className="animate-spin" />
                    : <Square size={13} fill="currentColor" />}
                  <span>{stoppingResponseId ? '停止中' : '停止回复'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="is-send"
                  aria-label={draft.trim() ? '发送' : '发送引用素材并分析'}
                  disabled={(!draft.trim() && messageAttachments.length === 0) || busy || uploading || !capabilityReady}
                  onClick={() => void submit()}
                >
                  <Send size={17} />
                </button>
              )}
            </div>
          </footer>
        </aside>
      )}
    </>
    </CreatorAgentVisible>
  );
}
