import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import {
  Activity,
  Boxes,
  Bug,
  ChevronRight,
  Copy,
  Download,
  FolderSearch,
  GitFork,
  History,
  Heart,
  Loader2,
  Play,
  RefreshCw,
  Share2,
  ShieldCheck,
  Tags,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import * as api from '../services/api';
import { normalizeMediaNodeDefaults } from '../utils/mediaNodeDefaults';
import i18n from '../i18n';
import type { AssetRef, CanvasPatch, CanvasPatchPreview, CanvasPatchRecord, CollaborationExecutionPolicySnapshot, NodeRunSummary, RunAttemptSummary, RunDetail, RunEventRecord, RunIntent, RunRecoveryOverview, RunRetentionPolicy, RunSummary } from '../types/project';
import { diffSubflowDefinitions, upgradeSubflowInstances, type SubflowDefinition, type SubflowUpgradeResult } from '../utils/subflows';
import {
  analyzeWorkflow,
  buildWorkflowDoctorCanvasHighlights,
  collectWorkflowAssetIds,
  workflowIssuesFromCanvasAgentValidation,
  workflowDisplayId,
  WORKFLOW_DOCTOR_RULE_COUNT,
  type CanvasPatchDraft,
  type WorkflowAssetDiagnostic,
  type WorkflowDoctorCanvasHighlight,
  type WorkflowIssue,
  type WorkflowProviderDiagnostic,
  type WorkflowRunDiagnostic,
} from '../utils/workflowDoctor';
import {
  CANVAS_AGENT_TOOL_NAMES,
  buildCanvasAgentSearchQuery,
  buildCanvasAgentSearchQueries,
  buildCanvasAgentWorkflowPlan,
  canCanvasAgentReuseResolvedSubflow,
  canvasAgentDigest,
  canvasAgentExecutionProposalFromPlan,
  canvasAgentSubflowCandidatesFromResult,
  createCanvasAgentPatchQueueItem,
  createCanvasAgentRequestId,
  explainCanvasAgentRequest,
  rankCanvasAgentSubflowCandidates,
  parseCanvasAgentRunEvidence,
  workflowRunDiagnosticsFromEvidence,
  type CanvasAgentExplanation,
  type CanvasAgentPatchQueueItem,
  type CanvasAgentRunEvidenceInspection,
  type CanvasAgentStage,
  type CanvasAgentToolInputMap,
  type CanvasAgentToolName,
  type CanvasAgentToolRequest,
  type CanvasAgentToolResult,
  type CanvasAgentToolTrace,
  type CanvasAgentWorkflowPlan,
  type RunEvidenceRef,
} from '../utils/canvasAgent';
import { buildRunTimelineAnalysis, collectFailedDownstreamNodeIds, compareRuns, formatBoundedJson, getRunPlannedEdges, getRunPlannedNodeIds, runNodeIdentity } from '../utils/runCenter';
import { validateRunAttemptOriginalReplay, validateRunOriginalReplay, validateSubflowNodeRunOriginalReplay } from '../utils/runReplay';
import AssetCenter from './assets/AssetCenter';
import {
  buildSubflowThumbnailLayout,
  createIndependentSubflowDraft,
  normalizeSubflowLibraryMetadata,
  parseSubflowFavoriteIds,
  toggleSubflowFavorite as toggleSubflowFavoriteId,
} from '../utils/subflowLibrary';
import { advancedProviderModelOptions, hasAdvancedProviderSecret } from '../utils/advancedProviders';
import {
  beginCanvasPatchSingleFlight,
  canvasPatchScopeKey as buildCanvasPatchScopeKey,
  endCanvasPatchSingleFlight,
  type CanvasPatchFlight,
} from '../utils/canvasPatchMerge';
import { useApiKeysStore } from '../stores/apiKeys';
import { parseCanvasNodeExecutionKey, useRunBusStore } from '../stores/runBus';
import CollaborationHostPanel from './CollaborationHostPanel';

type WorkbenchTab = 'subflows' | 'runs' | 'assets' | 'doctor' | 'collaboration';
type ProjectRunReplayMode = 'full-current' | 'failed-original' | 'full-original';

interface CanvasAgentSessionState {
  id: string;
  scopeKey: string;
  baseRevision: number;
  generation: number;
  prompt: string;
  stage: CanvasAgentStage;
  startedAt: number;
  completedAt?: number;
}

interface ProjectWorkbenchProps {
  open: boolean;
  initialTab?: WorkbenchTab;
  canvasId?: string | null;
  projectId: string;
  canvasRevision: number;
  patchConflictMessage?: string;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onInsertSubflow: (definition: SubflowDefinition) => void;
  onUpgradeSubflowInstances: (fromDefinition: SubflowDefinition, toDefinition: SubflowDefinition) => void;
  onInsertAsset: (asset: AssetRef) => void;
  onFocusNode: (nodeId: string) => void;
  onDoctorHighlightsChange: (highlights: WorkflowDoctorCanvasHighlight[]) => void;
  onPreviewPatch: (patch: CanvasPatchDraft) => Promise<{ patch: CanvasPatch; preview: CanvasPatchPreview }>;
  onApplyPatch: (patch: CanvasPatch, preview: CanvasPatchPreview) => Promise<void>;
  onRevertPatch: (patchId: string, baseRevision: number) => Promise<void>;
  onResolvePatchConflict: (resolution: 'keep-local' | 'use-authoritative') => Promise<void>;
  onAcceptRunIntent: (intent: RunIntent) => Promise<boolean>;
  onRetryRun: (run: RunDetail, mode: ProjectRunReplayMode) => Promise<number>;
  onRetrySubflowNodeRun: (run: RunDetail, nodeRun: NodeRunSummary) => Promise<number>;
  onRetryRunAttempt: (run: RunDetail, nodeRun: NodeRunSummary, attempt: RunAttemptSummary) => Promise<number>;
}

function SubflowThumbnail({ definition }: { definition: SubflowDefinition }) {
  const layout = buildSubflowThumbnailLayout(definition);
  return <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]" aria-label={`${definition.name} 稳定缩略图`}>
    {layout.nodes.map((node) => <span key={node.id} className="absolute h-2.5 w-4 rounded-sm border border-[var(--accent-primary)] bg-[var(--bg-primary)]" style={{ left: `${node.leftPercent}%`, top: `${node.topPercent}%` }} title={node.label} />)}
    <span className="absolute bottom-1 left-1 text-[8px] text-[var(--text-secondary)]">{layout.totalNodes}N / {layout.totalEdges}E</span>
  </div>;
}

const tabs: Array<{ id: WorkbenchTab; label: string; icon: typeof Boxes }> = [
  { id: 'subflows', label: '子流程', icon: GitFork },
  { id: 'runs', label: '运行', icon: Activity },
  { id: 'assets', label: '资产', icon: FolderSearch },
  { id: 'doctor', label: '医生', icon: Bug },
  { id: 'collaboration', label: '协作', icon: Share2 },
];

function formatTime(value?: number) {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatDuration(value?: number) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

function statusColor(status: string) {
  if (status === 'succeeded') return 'var(--success, #22c55e)';
  if (status === 'failed') return 'var(--danger, #ef4444)';
  if (status === 'running') return 'var(--warning, #f59e0b)';
  if (status === 'interrupted') return '#a855f7';
  if (status === 'stopped') return '#64748b';
  return 'var(--text-secondary)';
}

function timelinePhaseBackground(kind: 'waiting' | 'running' | 'polling', status: string) {
  if (kind === 'waiting') return '#94a3b8';
  if (kind === 'polling') return 'repeating-linear-gradient(135deg, #8b5cf6 0 4px, #c4b5fd 4px 7px)';
  return statusColor(status);
}

interface DoctorRemoteContext {
  scopeKey: string;
  loading: boolean;
  error: string;
  assets: WorkflowAssetDiagnostic[];
  requestedAssetCount: number;
  resolvedAssetCount: number;
  runs: RunSummary[];
  pendingIntents: RunIntent[];
  executionPolicy: CollaborationExecutionPolicySnapshot | null;
  validation: CanvasAgentToolResult<'validateCanvas'> | null;
  validationError: string;
  runEvidence: CanvasAgentRunEvidenceInspection | null;
  runEvidenceError: string;
}

const EMPTY_DOCTOR_REMOTE_CONTEXT: DoctorRemoteContext = {
  scopeKey: '',
  loading: false,
  error: '',
  assets: [],
  requestedAssetCount: 0,
  resolvedAssetCount: 0,
  runs: [],
  pendingIntents: [],
  executionPolicy: null,
  validation: null,
  validationError: '',
  runEvidence: null,
  runEvidenceError: '',
};

function selectDoctorReservedRunIntent(intents: readonly RunIntent[]) {
  return [...intents]
    .filter((intent) => ['pending', 'accepted'].includes(intent.status) && !intent.runId)
    .sort((left, right) => {
      const leftKnown = left.estimatedCostKnown === true && left.estimatedCost != null;
      const rightKnown = right.estimatedCostKnown === true && right.estimatedCost != null;
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
      if (leftKnown && rightKnown) {
        const costDifference = Number(right.estimatedCost) - Number(left.estimatedCost);
        if (costDifference !== 0) return costDifference;
      }
      return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
    })[0] || null;
}

function workflowEvidenceText(value: unknown) {
  if (Array.isArray(value)) return value.join('、');
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function canvasPatchDiffText(value: unknown) {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.slice(0, 1200);
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  } catch {
    return String(value).slice(0, 1200);
  }
}

function replayValidationMessage(
  result: { ok: true } | { ok: false; reason: string } | null | undefined,
  availableMessage: string,
  unavailableMessage: string,
) {
  if (!result) return unavailableMessage;
  return result.ok ? availableMessage : result.reason;
}

function LazyJsonDetails({ label, value, className = '', maxCharacters = 64 * 1024 }: { label: string; value: unknown; className?: string; maxCharacters?: number }) {
  const [open, setOpen] = useState(false);
  const rendered = useMemo(() => open ? formatBoundedJson(value, maxCharacters) : null, [maxCharacters, open, value]);
  return <details className={className} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-[10px]">{label}</summary>
    {rendered && <>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-[10px]">{rendered.text}</pre>
      {rendered.truncated && <p className="mt-1 text-[9px] text-amber-500">内容共 {rendered.originalLength.toLocaleString()} 字符，仅显示前 {maxCharacters.toLocaleString()} 字符。</p>}
    </>}
  </details>;
}

function flattenNodeRunTree(items: NodeRunSummary[]) {
  const children = new Map<string, NodeRunSummary[]>();
  items.forEach((item) => {
    if (!item.parentNodeRunId) return;
    children.set(item.parentNodeRunId, [...(children.get(item.parentNodeRunId) || []), item]);
  });
  const known = new Set(items.map((item) => item.id));
  const roots = items.filter((item) => !item.parentNodeRunId || !known.has(item.parentNodeRunId));
  const rows: Array<{ item: NodeRunSummary; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (item: NodeRunSummary, depth: number) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    rows.push({ item, depth });
    (children.get(item.id) || []).forEach((child) => visit(child, depth + 1));
  };
  roots.forEach((item) => visit(item, 0));
  items.filter((item) => !visited.has(item.id)).forEach((item) => visit(item, 0));
  return rows;
}

export default function ProjectWorkbench(props: ProjectWorkbenchProps) {
  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders || []);
  const providerSettingsLoaded = useApiKeysStore((state) => state.loaded);
  const liveRunningExecutionNodeIds = useRunBusStore((state) => state.runningIds);
  const liveExecutionTokens = useRunBusStore((state) => state.executionTokens);
  const liveRunningNodeIds = useMemo(() => {
    const executionNodeIds = [...new Set([
      ...liveRunningExecutionNodeIds,
      ...Object.keys(liveExecutionTokens),
    ])];
    return executionNodeIds
      .map(parseCanvasNodeExecutionKey)
      .filter((identity) => !props.canvasId || identity.canvasId === null || identity.canvasId === props.canvasId)
      .map((identity) => identity.nodeId);
  }, [liveExecutionTokens, liveRunningExecutionNodeIds, props.canvasId]);
  const [tab, setTab] = useState<WorkbenchTab>(props.initialTab || 'subflows');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [subflows, setSubflows] = useState<SubflowDefinition[]>([]);
  const [subflowVersions, setSubflowVersions] = useState<{ root: SubflowDefinition; items: SubflowDefinition[]; selected: number } | null>(null);
  const [subflowPackageDraft, setSubflowPackageDraft] = useState<{ file: File; inspection: api.SubflowPackageInspection } | null>(null);
  const [subflowCategory, setSubflowCategory] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [favoriteSubflowIds, setFavoriteSubflowIds] = useState<string[]>([]);
  const [subflowLibraryEdit, setSubflowLibraryEdit] = useState<{
    definition: SubflowDefinition;
    category: string;
    tags: string;
    conflict?: { revision: number; latestVersion: number; definition: SubflowDefinition };
  } | null>(null);
  const [subflowUpgradeDraft, setSubflowUpgradeDraft] = useState<{ from: SubflowDefinition; to: SubflowDefinition; preview: SubflowUpgradeResult } | null>(null);
  const subflowPackageInputRef = useRef<HTMLInputElement>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runStatus, setRunStatus] = useState('');
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runEvents, setRunEvents] = useState<RunEventRecord[]>([]);
  const [runEventVisibleCount, setRunEventVisibleCount] = useState(100);
  const [runFilter, setRunFilter] = useState({ initiatorId: '', provider: '', model: '' });
  const [runFilterDraft, setRunFilterDraft] = useState({ initiatorId: '', provider: '', model: '' });
  const [runRetention, setRunRetention] = useState<RunRetentionPolicy | null>(null);
  const [runRecovery, setRunRecovery] = useState<RunRecoveryOverview | null>(null);
  const [compareRunId, setCompareRunId] = useState('');
  const [compareRunDetail, setCompareRunDetail] = useState<RunDetail | null>(null);
  const [doctorEvidenceTarget, setDoctorEvidenceTarget] = useState<RunEvidenceRef | null>(null);
  const [patchPreview, setPatchPreview] = useState<{ draft: CanvasPatchDraft; patch: CanvasPatch; preview: CanvasPatchPreview; queueItemId?: string } | null>(null);
  const [patchPreviewBusy, setPatchPreviewBusy] = useState(false);
  const [patchApplyBusy, setPatchApplyBusy] = useState(false);
  const [patchApplyError, setPatchApplyError] = useState('');
  const [patchApplyRetryable, setPatchApplyRetryable] = useState(false);
  const [patchRepreviewAllowed, setPatchRepreviewAllowed] = useState(false);
  const [patchHistory, setPatchHistory] = useState<CanvasPatchRecord[]>([]);
  const [patchHistoryLoading, setPatchHistoryLoading] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('修复全部可自动修复的问题');
  const [agentSession, setAgentSession] = useState<CanvasAgentSessionState | null>(null);
  const [agentExplanation, setAgentExplanation] = useState<CanvasAgentExplanation | null>(null);
  const [agentPlan, setAgentPlan] = useState<CanvasAgentWorkflowPlan | null>(null);
  const [agentPatchQueue, setAgentPatchQueue] = useState<CanvasAgentPatchQueueItem[]>([]);
  const [agentToolTrace, setAgentToolTrace] = useState<CanvasAgentToolTrace[]>([]);
  const [agentAuthority, setAgentAuthority] = useState<CanvasAgentToolResult['authority'] | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState('');
  const agentPreviewQueueItem = patchPreview?.queueItemId
    ? agentPatchQueue.find((item) => item.id === patchPreview.queueItemId)
    : null;
  const agentPreviewApplyBlocked = Boolean(patchPreview?.queueItemId && (
    !agentPreviewQueueItem
    || agentPreviewQueueItem.status !== 'previewed'
    || agentPreviewQueueItem.projectId !== props.projectId
    || agentPreviewQueueItem.canvasId !== props.canvasId
    || agentPreviewQueueItem.baseRevision !== props.canvasRevision
    || agentPreviewQueueItem.previewDigest !== patchPreview.preview.previewDigest
    || agentAuthority?.canApplyCanvasPatch !== true
  ));
  const [doctorRemoteContext, setDoctorRemoteContext] = useState<DoctorRemoteContext>(EMPTY_DOCTOR_REMOTE_CONTEXT);
  const doctorLoadGenerationRef = useRef(0);
  const subflowLoadGenerationRef = useRef(0);
  const subflowLoadAbortRef = useRef<AbortController | null>(null);
  const runLoadGenerationRef = useRef(0);
  const runLoadAbortRef = useRef<AbortController | null>(null);
  const agentGenerationRef = useRef(0);
  const agentAbortRef = useRef<AbortController | null>(null);
  const agentRevisionRef = useRef(props.canvasRevision);
  const patchPreviewRequestRef = useRef(0);
  const patchApplyRequestRef = useRef(0);
  const patchHistoryRequestRef = useRef(0);
  const patchPreviewFlightRef = useRef<CanvasPatchFlight | null>(null);
  const patchApplyFlightRef = useRef<CanvasPatchFlight | null>(null);
  const patchScopeKey = useMemo(
    () => buildCanvasPatchScopeKey(props.projectId, props.canvasId || '', props.open, tab),
    [props.canvasId, props.open, props.projectId, tab],
  );
  const patchScopeKeyRef = useRef(patchScopeKey);
  patchScopeKeyRef.current = patchScopeKey;
  const doctorEvidenceTargetKey = useMemo(
    () => doctorEvidenceTarget
      ? JSON.stringify([doctorEvidenceTarget.runId, doctorEvidenceTarget.nodeRunId, doctorEvidenceTarget.attemptId])
      : '',
    [doctorEvidenceTarget],
  );
  const agentIdentityScopeKey = useMemo(
    () => JSON.stringify([props.projectId, props.canvasId || '', props.open, tab === 'doctor', doctorEvidenceTargetKey]),
    [doctorEvidenceTargetKey, props.canvasId, props.open, props.projectId, tab],
  );
  const agentSnapshotScopeKey = useMemo(
    () => JSON.stringify([agentIdentityScopeKey, props.canvasRevision]),
    [agentIdentityScopeKey, props.canvasRevision],
  );
  const agentIdentityScopeRef = useRef(agentIdentityScopeKey);
  const agentSnapshotScopeRef = useRef(agentSnapshotScopeKey);
  const agentPatchQueueRef = useRef(agentPatchQueue);
  const agentRevisionIdentityRef = useRef(agentIdentityScopeKey);
  agentIdentityScopeRef.current = agentIdentityScopeKey;
  agentSnapshotScopeRef.current = agentSnapshotScopeKey;
  agentPatchQueueRef.current = agentPatchQueue;
  const doctorAssetIds = useMemo(
    () => props.open && tab === 'doctor' ? collectWorkflowAssetIds(props.nodes) : [],
    [props.nodes, props.open, tab],
  );
  // 远程只核验排序后的前 64 个引用；稳定字符串避免节点拖拽产生的新数组重复触发请求。
  const doctorAssetIdKey = useMemo(() => JSON.stringify([doctorAssetIds.length, doctorAssetIds.slice(0, 64)]), [doctorAssetIds]);
  const doctorScopeKey = useMemo(
    () => JSON.stringify([props.projectId, props.canvasId || '', props.canvasRevision, doctorAssetIdKey, doctorEvidenceTargetKey]),
    [doctorAssetIdKey, doctorEvidenceTargetKey, props.canvasId, props.canvasRevision, props.projectId],
  );
  const scopedDoctorRemoteContext = doctorRemoteContext.scopeKey === doctorScopeKey
    ? doctorRemoteContext
    : EMPTY_DOCTOR_REMOTE_CONTEXT;
  const doctorProviders = useMemo<WorkflowProviderDiagnostic[]>(() => advancedProviders.map((provider) => ({
    id: provider.id,
    source: provider.protocol,
    label: provider.label,
    enabled: provider.enabled === true,
    models: {
      image: advancedProviderModelOptions(provider, 'image'),
      video: advancedProviderModelOptions(provider, 'video'),
      llm: advancedProviderModelOptions(provider, 'llm'),
    },
    ...(provider.protocol === 'volcengine' ? {
      configuredRegion: String(provider.volcengineConfig?.region || '').trim(),
      // 火山生成端使用 Ark bearer API Key；这里只传是否配置，不传掩码或明文。
      regionCredentialConfigured: hasAdvancedProviderSecret(provider.apiKey),
    } : {}),
  })), [advancedProviders]);
  const doctorRuns = useMemo<WorkflowRunDiagnostic[]>(
    () => workflowRunDiagnosticsFromEvidence(scopedDoctorRemoteContext.runEvidence),
    [scopedDoctorRemoteContext.runEvidence],
  );
  const issues = useMemo(() => {
    if (!props.open || tab !== 'doctor') return [];
    const policy = scopedDoctorRemoteContext.executionPolicy?.policy;
    const usage = scopedDoctorRemoteContext.executionPolicy?.usage;
    const reservedIntent = selectDoctorReservedRunIntent(scopedDoctorRemoteContext.pendingIntents);
    const reservedEstimatedCost = reservedIntent?.estimatedCostKnown === true && reservedIntent.estimatedCost != null
      ? Math.max(0, Number(reservedIntent.estimatedCost) || 0)
      : undefined;
    const localIssues = analyzeWorkflow(props.nodes, props.edges, {
      projectId: props.projectId,
      providers: doctorProviders,
      providersComplete: providerSettingsLoaded,
      assets: scopedDoctorRemoteContext.assets,
      runs: doctorRuns,
      liveRun: {
        complete: true,
        activeNodeIds: liveRunningNodeIds,
      },
      limits: {
        estimatedCost: reservedEstimatedCost,
        costBudget: policy && policy.perRunCostLimit > 0 ? policy.perRunCostLimit : undefined,
        dailyCost: usage?.dailyCost,
        dailyCostLimit: policy?.dailyCostLimit,
        activeCount: usage?.activeCount,
        concurrencyLimit: policy?.concurrencyLimit,
        allowedModels: policy?.allowedModels,
      },
    });
    const authoritativeIssues = scopedDoctorRemoteContext.validation
      ? workflowIssuesFromCanvasAgentValidation(
        scopedDoctorRemoteContext.validation.data,
        props.nodes,
        props.projectId,
      )
      : [];
    return [...authoritativeIssues, ...localIssues];
  }, [doctorProviders, doctorRuns, liveRunningNodeIds, props.edges, props.nodes, props.open, props.projectId, providerSettingsLoaded, scopedDoctorRemoteContext, tab]);
  const doctorHighlights = useMemo(
    () => buildWorkflowDoctorCanvasHighlights(issues, props.edges),
    [issues, props.edges],
  );
  const favoriteStorageKey = `t8-subflow-favorites:${props.projectId || 'project-local'}`;
  const subflowCategories = useMemo(() => [...new Set(subflows.map((definition) => String(definition.category || '').trim()).filter(Boolean))].sort(), [subflows]);
  const visibleSubflows = useMemo(() => subflows.filter((definition) => (!subflowCategory || definition.category === subflowCategory) && (!favoriteOnly || favoriteSubflowIds.includes(definition.id))), [favoriteOnly, favoriteSubflowIds, subflowCategory, subflows]);
  const selectedSubflowVersion = subflowVersions?.items.find((item) => item.version === subflowVersions.selected) || null;
  const runNodeRows = useMemo(() => flattenNodeRunTree(runDetail?.nodeRuns || []), [runDetail]);
  const runTimelineAnalysis = useMemo(() => runDetail ? buildRunTimelineAnalysis(runDetail, runEvents) : null, [runDetail, runEvents]);
  const runTimeline = runTimelineAnalysis?.items || [];
  const runTimelineByNodeId = useMemo(() => new Map((runTimelineAnalysis?.items || []).map((item) => [runNodeIdentity(item.nodeRun), item])), [runTimelineAnalysis]);
  const runComparison = useMemo(() => runDetail && compareRunDetail ? compareRuns(runDetail, compareRunDetail) : null, [compareRunDetail, runDetail]);
  const originalReplayAvailability = useMemo(() => {
    if (!runDetail) return null;
    const plannedNodeIds = getRunPlannedNodeIds(runDetail);
    const failedAndDownstream = new Set(collectFailedDownstreamNodeIds(runDetail, getRunPlannedEdges(runDetail)));
    const failedNodeIds = plannedNodeIds.filter((nodeId) => failedAndDownstream.has(nodeId));
    return {
      failedNodeIds,
      full: validateRunOriginalReplay(runDetail, plannedNodeIds),
      failed: validateRunOriginalReplay(runDetail, failedNodeIds),
    };
  }, [runDetail]);
  const subflowReplayAvailability = useMemo(() => new Map(
    (runDetail?.nodeRuns || [])
      .filter((nodeRun) => Boolean(nodeRun.parentNodeRunId))
      .map((nodeRun) => [nodeRun.id, validateSubflowNodeRunOriginalReplay(runDetail!, nodeRun.id)]),
  ), [runDetail]);
  const attemptReplayAvailability = useMemo(() => new Map(
    (runDetail?.nodeRuns || []).flatMap((nodeRun) => (nodeRun.attempts || []).map((attempt) => [
      attempt.id,
      validateRunAttemptOriginalReplay(runDetail!, nodeRun.id, attempt.id),
    ] as const)),
  ), [runDetail]);
  const selectedSubflowDiff = useMemo(() => {
    if (!subflowVersions || !selectedSubflowVersion || selectedSubflowVersion.version === subflowVersions.root.version) return null;
    return diffSubflowDefinitions(selectedSubflowVersion, subflowVersions.root);
  }, [selectedSubflowVersion, subflowVersions]);

  const withBusy = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, []);

  const loadSubflows = useCallback(async (searchQuery = '') => {
    const generation = ++subflowLoadGenerationRef.current;
    subflowLoadAbortRef.current?.abort();
    const controller = new AbortController();
    subflowLoadAbortRef.current = controller;
    const requestScopeKey = patchScopeKey;
    setBusy(true);
    setMessage('');
    try {
      const items = await api.listSubflows(searchQuery, props.projectId, { signal: controller.signal });
      if (controller.signal.aborted || generation !== subflowLoadGenerationRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setSubflows(items);
    } catch (error) {
      if (controller.signal.aborted || generation !== subflowLoadGenerationRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === subflowLoadGenerationRef.current && requestScopeKey === patchScopeKeyRef.current) setBusy(false);
    }
  }, [patchScopeKey, props.projectId]);
  const loadRuns = useCallback(async () => {
    const generation = ++runLoadGenerationRef.current;
    runLoadAbortRef.current?.abort();
    const controller = new AbortController();
    runLoadAbortRef.current = controller;
    const requestScopeKey = patchScopeKey;
    setBusy(true);
    setMessage('');
    try {
      const [items, retention, recovery] = await Promise.all([
        api.listProjectRuns({ projectId: props.projectId, canvasId: props.canvasId || undefined, status: runStatus || undefined, initiatorId: runFilter.initiatorId || undefined, provider: runFilter.provider || undefined, model: runFilter.model || undefined, limit: 100 }, { signal: controller.signal }),
        api.getProjectRunRetention(props.projectId),
        api.getProjectRunRecovery(),
      ]);
      if (controller.signal.aborted || generation !== runLoadGenerationRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setRuns(items);
      setRunRetention(retention);
      setRunRecovery(recovery);
    } catch (error) {
      if (controller.signal.aborted || generation !== runLoadGenerationRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === runLoadGenerationRef.current && requestScopeKey === patchScopeKeyRef.current) setBusy(false);
    }
  }, [patchScopeKey, props.canvasId, props.projectId, runFilter.initiatorId, runFilter.model, runFilter.provider, runStatus]);
  const updateAgentQueueItem = useCallback((queueItemId: string, patch: Partial<CanvasAgentPatchQueueItem>) => {
    setAgentPatchQueue((current) => current.map((item) => item.id === queueItemId ? { ...item, ...patch } : item));
  }, []);

  const updateAgentTrace = useCallback((tool: CanvasAgentToolName, patch: Partial<CanvasAgentToolTrace>) => {
    setAgentToolTrace((current) => current.map((item) => item.tool === tool ? { ...item, ...patch } : item));
  }, []);

  const explainAgentPrompt = useCallback(() => {
    try {
      const explanation = explainCanvasAgentRequest(agentPrompt);
      const generation = ++agentGenerationRef.current;
      agentAbortRef.current?.abort();
      const sessionId = `agent-${Date.now().toString(36)}-${generation}`;
      setAgentSession({
        id: sessionId,
        scopeKey: agentIdentityScopeKey,
        baseRevision: props.canvasRevision,
        generation,
        prompt: agentPrompt,
        stage: 'explain',
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
      setAgentExplanation(explanation);
      setAgentPlan(null);
      setAgentPatchQueue([]);
      setAgentToolTrace([]);
      setAgentAuthority(null);
      setAgentBusy(false);
      setAgentError('');
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    }
  }, [agentIdentityScopeKey, agentPrompt, props.canvasRevision]);

  const generateAgentPlan = useCallback(async () => {
    if (!props.canvasId) {
      setAgentError('当前没有可绑定的权威画布。');
      return;
    }
    const generation = ++agentGenerationRef.current;
    agentAbortRef.current?.abort();
    const controller = new AbortController();
    agentAbortRef.current = controller;
    const requestScopeKey = agentIdentityScopeKey;
    const requestSnapshotKey = agentSnapshotScopeKey;
    const baseRevision = props.canvasRevision;
    const sessionId = `agent-${Date.now().toString(36)}-${generation}`;
    const trace: CanvasAgentToolTrace[] = CANVAS_AGENT_TOOL_NAMES.map((tool, sequence) => ({
      tool,
      requestId: createCanvasAgentRequestId(sessionId, generation, tool, sequence),
      status: 'pending',
    }));
    const assertCurrent = () => {
      if (controller.signal.aborted || generation !== agentGenerationRef.current
        || requestScopeKey !== agentIdentityScopeRef.current
        || requestSnapshotKey !== agentSnapshotScopeRef.current
        || baseRevision !== props.canvasRevision) {
        throw new Error('Agent 会话作用域已变化');
      }
    };
    setAgentBusy(true);
    setAgentError('');
    setAgentExplanation(null);
    setAgentPlan(null);
    setAgentPatchQueue([]);
    setAgentToolTrace(trace);
    setAgentAuthority(null);
    setAgentSession({
      id: sessionId,
      scopeKey: requestScopeKey,
      baseRevision,
      generation,
      prompt: agentPrompt,
      stage: 'generate',
      startedAt: Date.now(),
    });

    async function executeTool<K extends CanvasAgentToolName>(
      tool: K,
      input: CanvasAgentToolInputMap[K],
      sequence: number,
    ): Promise<CanvasAgentToolResult<K>> {
      const request: CanvasAgentToolRequest<K> = {
        tool,
        requestId: createCanvasAgentRequestId(sessionId, generation, tool, sequence),
        projectId: props.projectId,
        canvasId: props.canvasId!,
        input,
      };
      try {
        const result = await api.executeCanvasAgentTool(request, { signal: controller.signal });
        assertCurrent();
        if (result.canvasRevision !== baseRevision) throw new Error(`${tool} 返回了不同的画布 revision`);
        updateAgentTrace(tool, { status: 'succeeded', digest: result.digest, message: result.truncated ? '响应已截断' : undefined });
        return result;
      } catch (error) {
        if (!controller.signal.aborted && generation === agentGenerationRef.current) {
          const unavailable = tool === 'inspectRun' && error instanceof api.ApiRequestError && error.status === 404;
          updateAgentTrace(tool, {
            status: unavailable ? 'unavailable' : 'failed',
            message: unavailable ? '当前画布暂无 Run 证据' : error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    }

    try {
      const promptExplanation = explainCanvasAgentRequest(agentPrompt);
      const subflowQuery = buildCanvasAgentSearchQuery(agentPrompt);
      const subflowQueries = buildCanvasAgentSearchQueries(agentPrompt);
      const searchResults: CanvasAgentToolResult<'searchSubflows'>[] = [];
      for (let index = 0; index < subflowQueries.length; index += 1) {
        searchResults.push(await executeTool('searchSubflows', { query: subflowQueries[index], limit: 20, offset: 0 }, 40 + index));
      }
      assertCurrent();
      if (searchResults.some((result) => result.truncated)) throw new Error('子工作流搜索响应被截断，已停止生成');
      const seenSubflowCandidates = new Set<string>();
      const subflowCandidates = searchResults.flatMap(canvasAgentSubflowCandidatesFromResult).filter((candidate) => {
        const key = `${candidate.id}\u0000${candidate.version}\u0000${candidate.revision}`;
        if (seenSubflowCandidates.has(key)) return false;
        seenSubflowCandidates.add(key);
        return true;
      });
      const contextual = await Promise.allSettled([
        executeTool('inspectCanvas', { nodeOffset: 0, edgeOffset: 0, nodeLimit: 100, edgeLimit: 200 }, 0),
        executeTool('inspectNodeSchema', { offset: 0, limit: 100, includeHidden: false }, 1),
        executeTool('inspectRun', doctorEvidenceTarget ? {
          runId: doctorEvidenceTarget.runId,
          nodeRunId: doctorEvidenceTarget.nodeRunId,
          attemptId: doctorEvidenceTarget.attemptId,
        } : {}, 2),
        executeTool('searchAssets', { query: subflowQuery, limit: 10, offset: 0 }, 3),
        executeTool('validateCanvas', {}, 5),
      ] as const);
      assertCurrent();
      const [canvasSettled, schemaSettled, runSettled, assetsSettled, validationSettled] = contextual;
      if (canvasSettled.status !== 'fulfilled') throw canvasSettled.reason;
      if (schemaSettled.status !== 'fulfilled') throw schemaSettled.reason;
      if (validationSettled.status !== 'fulfilled') throw validationSettled.reason;
      if (doctorEvidenceTarget && runSettled.status !== 'fulfilled') throw runSettled.reason;
      const runEvidence = doctorEvidenceTarget && runSettled.status === 'fulfilled'
        ? parseCanvasAgentRunEvidence(runSettled.value, doctorEvidenceTarget)
        : null;
      if (runEvidence && !runEvidence.evidenceComplete) {
        throw new Error(`指定运行证据不完整：${runEvidence.evidenceReasons.join('、') || '未知原因'}`);
      }
      setAgentAuthority(canvasSettled.value.authority);
      const essentialResults = [
        ...searchResults,
        canvasSettled.value,
        schemaSettled.value,
        validationSettled.value,
        ...(doctorEvidenceTarget && runSettled.status === 'fulfilled' ? [runSettled.value] : []),
      ];
      if (essentialResults.some((result) => result.truncated)) throw new Error('关键 Agent 工具响应被截断，已停止生成');
      const canvasData = canvasSettled.value.data as {
        nodes?: Array<{ id?: unknown; type?: unknown; position?: { x?: unknown; y?: unknown } }>;
        edges?: Array<{ id?: unknown }>;
        page?: { hasMoreNodes?: boolean; hasMoreEdges?: boolean };
      };
      if (canvasData.page?.hasMoreNodes || canvasData.page?.hasMoreEdges) {
        throw new Error('当前画布超过单轮权威检查上限，请先封装子工作流或缩小画布后再生成');
      }
      let resolvedSubflow: SubflowDefinition | null = null;
      const rankedSubflowCandidates = rankCanvasAgentSubflowCandidates(agentPrompt, subflowCandidates);
      for (const rankedCandidate of rankedSubflowCandidates.filter((item) => item.eligible)) {
        const candidate = rankedCandidate.candidate;
        const candidateDefinition = await api.getSubflow(candidate.id, candidate.version, props.projectId, { signal: controller.signal });
        assertCurrent();
        if (candidateDefinition.id !== candidate.id || candidateDefinition.version !== candidate.version
          || Number(candidateDefinition.revision || candidateDefinition.version) !== candidate.revision
          || String(candidateDefinition.projectId || props.projectId) !== props.projectId) {
          throw new Error('子工作流固定版本与搜索摘要不一致');
        }
        if (canCanvasAgentReuseResolvedSubflow(candidate, candidateDefinition, props.projectId)) {
          resolvedSubflow = candidateDefinition;
          break;
        }
      }
      const fulfilledContext = [runSettled, assetsSettled].flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const toolResults = [...searchResults, canvasSettled.value, schemaSettled.value, validationSettled.value, ...fulfilledContext];
      const toolDigests = Object.fromEntries(toolResults.map((result) => [result.tool, result.digest]));
      toolDigests.searchSubflows = canvasAgentDigest(searchResults.map((result) => result.digest));
      const graphDigest = canvasAgentDigest(canvasSettled.value.data);
      const settingsSnapshot = useApiKeysStore.getState();
      if (!settingsSnapshot.loaded) throw new Error(i18n.t('settings:mediaDefaults.notReady'));
      const mediaNodeDefaults = normalizeMediaNodeDefaults(settingsSnapshot.settings.preferences?.mediaNodeDefaults);
      const preliminaryPlan = buildCanvasAgentWorkflowPlan({
        mediaNodeDefaults,
        prompt: agentPrompt,
        projectId: props.projectId,
        canvasId: props.canvasId,
        baseRevision,
        generation,
        graphDigest,
        nodeSchemaDigest: schemaSettled.value.nodeSchemaDigest,
        currentNodes: canvasData.nodes || [],
        currentEdges: canvasData.edges || [],
        issues,
        subflowQuery,
        subflowCandidates,
        resolvedSubflow,
        validation: validationSettled.value.data,
        runEvidence,
        toolDigests,
      });
      const proposal = canvasAgentExecutionProposalFromPlan(preliminaryPlan);
      if (!proposal) throw new Error('Agent 计划无法编译为受控的应用后画布模拟');
      const [simulationResult, estimateResult] = await Promise.all([
        executeTool('simulateExecutionPlan', { proposal }, 6),
        executeTool('estimateRun', { proposal }, 7),
      ]);
      assertCurrent();
      const finalToolDigests = {
        ...toolDigests,
        simulateExecutionPlan: simulationResult.digest,
        estimateRun: estimateResult.digest,
      };
      const finalPlan = buildCanvasAgentWorkflowPlan({
        mediaNodeDefaults,
        prompt: agentPrompt,
        projectId: props.projectId,
        canvasId: props.canvasId,
        baseRevision,
        generation,
        graphDigest,
        nodeSchemaDigest: schemaSettled.value.nodeSchemaDigest,
        currentNodes: canvasData.nodes || [],
        currentEdges: canvasData.edges || [],
        issues,
        subflowQuery,
        subflowCandidates,
        resolvedSubflow,
        validation: validationSettled.value.data,
        simulation: simulationResult.data,
        estimate: estimateResult.data,
        runEvidence,
        toolDigests: finalToolDigests,
      });
      assertCurrent();
      setAgentExplanation(promptExplanation);
      setAgentPlan(finalPlan);
      setAgentPatchQueue(finalPlan.status === 'ready' && finalPlan.patchDraft ? [createCanvasAgentPatchQueueItem(finalPlan)] : []);
      setAgentSession((current) => current && current.id === sessionId ? { ...current, completedAt: Date.now() } : current);
      if (finalPlan.status !== 'ready') setAgentError(finalPlan.unresolved.join('；') || '计划未通过受控验证。');
    } catch (error) {
      if (!controller.signal.aborted && generation === agentGenerationRef.current
        && requestScopeKey === agentIdentityScopeRef.current) {
        setAgentError(error instanceof Error ? error.message : String(error));
        setAgentPatchQueue([]);
        setAgentSession((current) => current && current.id === sessionId ? { ...current, completedAt: Date.now() } : current);
      }
    } finally {
      if (generation === agentGenerationRef.current && requestScopeKey === agentIdentityScopeRef.current) setAgentBusy(false);
    }
  }, [agentIdentityScopeKey, agentPrompt, agentSnapshotScopeKey, doctorEvidenceTarget, issues, props.canvasId, props.canvasRevision, props.projectId, updateAgentTrace]);

  const changeAgentPrompt = useCallback((value: string) => {
    agentGenerationRef.current += 1;
    agentAbortRef.current?.abort();
    setAgentPrompt(value);
    setAgentBusy(false);
    setAgentPlan(null);
    setAgentExplanation(null);
    setAgentToolTrace([]);
    setAgentPatchQueue((current) => current.map((item) => item.status === 'applied' ? item : { ...item, status: 'stale', error: 'Agent 请求已修改' }));
    setAgentError('');
  }, []);
  const loadPatchHistory = useCallback(async () => {
    const requestId = ++patchHistoryRequestRef.current;
    const requestScopeKey = patchScopeKey;
    if (!props.canvasId) {
      setPatchHistory([]);
      setPatchHistoryLoading(false);
      return;
    }
    setPatchHistoryLoading(true);
    try {
      const records = await api.listCanvasPatches(props.canvasId, 30);
      if (requestId !== patchHistoryRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setPatchHistory(records);
    } catch (error) {
      if (requestId !== patchHistoryRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === patchHistoryRequestRef.current && requestScopeKey === patchScopeKeyRef.current) {
        setPatchHistoryLoading(false);
      }
    }
  }, [patchScopeKey, props.canvasId]);
  const openPatchPreview = useCallback(async (draft: CanvasPatchDraft, queueItemId?: string) => {
    if (patchPreviewBusy || patchApplyBusy) return;
    if (queueItemId) {
      const queueItem = agentPatchQueueRef.current.find((item) => item.id === queueItemId);
      if (!queueItem || ['stale', 'applied', 'applying'].includes(queueItem.status)
        || queueItem.projectId !== props.projectId || queueItem.canvasId !== props.canvasId
        || queueItem.baseRevision !== props.canvasRevision) {
        setAgentError('该 Agent 队列项已过期或不属于当前画布。');
        if (queueItem) updateAgentQueueItem(queueItemId, { status: 'stale', error: '画布作用域或 revision 已变化' });
        return;
      }
      updateAgentQueueItem(queueItemId, { status: 'previewing', error: undefined });
      setAgentSession((current) => current ? { ...current, stage: 'preview' } : current);
    }
    const requestId = patchPreviewRequestRef.current + 1;
    const requestScopeKey = patchScopeKey;
    const started = beginCanvasPatchSingleFlight(patchPreviewFlightRef.current, requestScopeKey, requestId);
    if (!started.accepted) return;
    patchPreviewRequestRef.current = requestId;
    patchPreviewFlightRef.current = started.flight;
    setPatchPreviewBusy(true);
    setPatchApplyError('');
    setPatchApplyRetryable(false);
    setPatchRepreviewAllowed(false);
    try {
      const authoritative = await props.onPreviewPatch(draft);
      if (requestId !== patchPreviewRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      if (authoritative.patch.requiresConfirmation !== true) throw new Error('CanvasPatch 缺少明确确认标记');
      if (!/^[a-f0-9]{64}$/i.test(authoritative.preview.previewDigest)) throw new Error('CanvasPatch 预览摘要无效');
      setPatchPreview({ draft, ...authoritative, ...(queueItemId ? { queueItemId } : {}) });
      if (queueItemId) {
        updateAgentQueueItem(queueItemId, { status: 'previewed', previewDigest: authoritative.preview.previewDigest, error: undefined });
        setAgentError('');
      }
      setPatchRepreviewAllowed(true);
    } catch (error) {
      if (requestId !== patchPreviewRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      const code = error instanceof Error && 'code' in error
        ? String((error as Error & { code?: unknown }).code || '')
        : '';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stale = (error instanceof api.ApiRequestError && error.status === 409)
        || code === 'CANVAS_BASELINE_CONFLICT' || code === 'PATCH_PREVIEW_STALE';
      if (queueItemId) updateAgentQueueItem(queueItemId, {
        status: stale ? 'stale' : 'failed',
        error: errorMessage,
      });
      setPatchRepreviewAllowed(code !== 'CANVAS_BASELINE_CONFLICT');
      setPatchApplyError(errorMessage);
      setMessage(errorMessage);
    } finally {
      patchPreviewFlightRef.current = endCanvasPatchSingleFlight(
        patchPreviewFlightRef.current,
        { requestId, scopeKey: requestScopeKey },
      );
      if (requestId === patchPreviewRequestRef.current && requestScopeKey === patchScopeKeyRef.current) {
        setPatchPreviewBusy(false);
      }
    }
  }, [patchApplyBusy, patchPreviewBusy, patchScopeKey, props.canvasId, props.canvasRevision, props.onPreviewPatch, props.projectId, updateAgentQueueItem]);
  const confirmPatchPreview = useCallback(async () => {
    if (!patchPreview || patchApplyBusy || patchPreview.patch.requiresConfirmation !== true) return;
    if (patchPreview.queueItemId) {
      const queueItem = agentPatchQueueRef.current.find((item) => item.id === patchPreview.queueItemId);
      const queueIsCurrent = queueItem?.status === 'previewed'
        && queueItem.projectId === props.projectId
        && queueItem.canvasId === props.canvasId
        && queueItem.baseRevision === props.canvasRevision
        && queueItem.previewDigest === patchPreview.preview.previewDigest;
      if (!queueIsCurrent) {
        const message = '该 Agent 预览已过期，请从当前 Patch 队列重新预览。';
        if (queueItem && queueItem.status !== 'applied') {
          updateAgentQueueItem(queueItem.id, { status: 'stale', error: message });
        }
        setAgentError(message);
        setPatchApplyError(message);
        setPatchApplyRetryable(false);
        setPatchRepreviewAllowed(false);
        return;
      }
    }
    const requestId = patchApplyRequestRef.current + 1;
    const requestScopeKey = patchScopeKey;
    const started = beginCanvasPatchSingleFlight(patchApplyFlightRef.current, requestScopeKey, requestId);
    if (!started.accepted) return;
    patchApplyRequestRef.current = requestId;
    patchApplyFlightRef.current = started.flight;
    setPatchApplyBusy(true);
    if (patchPreview.queueItemId) {
      updateAgentQueueItem(patchPreview.queueItemId, { status: 'applying', error: undefined });
      setAgentSession((current) => current ? { ...current, stage: 'apply' } : current);
    }
    setPatchApplyError('');
    setPatchApplyRetryable(false);
    try {
      await props.onApplyPatch(patchPreview.patch, patchPreview.preview);
      if (requestId !== patchApplyRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      if (patchPreview.queueItemId) {
        updateAgentQueueItem(patchPreview.queueItemId, { status: 'applied', error: undefined });
        setAgentError('');
      }
      setPatchPreview(null);
      await loadPatchHistory();
    } catch (error) {
      if (requestId !== patchApplyRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      const stale = (error instanceof api.ApiRequestError && error.status === 409)
        || (error instanceof Error && 'code' in error && error.code === 'PATCH_PREVIEW_STALE');
      const retryable = !stale && (error instanceof TypeError
        || (error instanceof api.ApiRequestError && error.status >= 500));
      if (patchPreview.queueItemId) updateAgentQueueItem(patchPreview.queueItemId, {
        status: stale ? 'stale' : retryable ? 'previewed' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      setPatchApplyRetryable(retryable);
      setPatchRepreviewAllowed(stale || !retryable);
      setPatchApplyError(stale
        ? '画布 revision 已变化，此预览没有应用。请同步后重新预览并再次确认。'
        : error instanceof Error ? error.message : String(error));
    } finally {
      patchApplyFlightRef.current = endCanvasPatchSingleFlight(
        patchApplyFlightRef.current,
        { requestId, scopeKey: requestScopeKey },
      );
      if (requestId === patchApplyRequestRef.current && requestScopeKey === patchScopeKeyRef.current) {
        setPatchApplyBusy(false);
      }
    }
  }, [loadPatchHistory, patchApplyBusy, patchPreview, patchScopeKey, props.canvasId, props.canvasRevision, props.onApplyPatch, props.projectId, updateAgentQueueItem]);
  const revertPatchRecord = useCallback(async (record: CanvasPatchRecord) => {
    if (!record.canRevert || patchApplyBusy) return;
    const requestId = patchApplyRequestRef.current + 1;
    const requestScopeKey = patchScopeKey;
    const started = beginCanvasPatchSingleFlight(patchApplyFlightRef.current, requestScopeKey, requestId);
    if (!started.accepted) return;
    patchApplyRequestRef.current = requestId;
    patchApplyFlightRef.current = started.flight;
    setPatchApplyBusy(true);
    setPatchApplyError('');
    setPatchApplyRetryable(false);
    try {
      await props.onRevertPatch(record.patchId, props.canvasRevision);
      if (requestId !== patchApplyRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      await loadPatchHistory();
    } catch (error) {
      if (requestId !== patchApplyRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      const stale = error instanceof api.ApiRequestError && error.status === 409;
      setPatchApplyError(stale
        ? '该 Patch 涉及的字段已经变化，未覆盖后续修改。请重新检查画布。'
        : error instanceof Error ? error.message : String(error));
      setMessage(stale
        ? '该 Patch 涉及的字段已经变化，未覆盖后续修改。请重新检查画布。'
        : error instanceof Error ? error.message : String(error));
    } finally {
      patchApplyFlightRef.current = endCanvasPatchSingleFlight(
        patchApplyFlightRef.current,
        { requestId, scopeKey: requestScopeKey },
      );
      if (requestId === patchApplyRequestRef.current && requestScopeKey === patchScopeKeyRef.current) {
        setPatchApplyBusy(false);
      }
    }
  }, [loadPatchHistory, patchApplyBusy, patchScopeKey, props.canvasRevision, props.onRevertPatch]);

  const resolvePatchConflict = useCallback(async (resolution: 'keep-local' | 'use-authoritative') => {
    if (!props.patchConflictMessage || patchApplyBusy) return;
    const requestId = patchApplyRequestRef.current + 1;
    const requestScopeKey = patchScopeKey;
    const started = beginCanvasPatchSingleFlight(patchApplyFlightRef.current, requestScopeKey, requestId);
    if (!started.accepted) return;
    patchApplyRequestRef.current = requestId;
    patchApplyFlightRef.current = started.flight;
    setPatchApplyBusy(true);
    setPatchApplyError('');
    setPatchApplyRetryable(false);
    try {
      await props.onResolvePatchConflict(resolution);
      if (requestId !== patchApplyRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      setMessage(resolution === 'keep-local'
        ? '本地冲突版本已与最新服务端内容合并并保存。'
        : '已显式采用最新服务端版本。');
      await loadPatchHistory();
    } catch (error) {
      if (requestId !== patchApplyRequestRef.current || requestScopeKey !== patchScopeKeyRef.current) return;
      const errorMessage = error instanceof Error ? error.message : String(error);
      setPatchApplyError(errorMessage);
      setMessage(errorMessage);
    } finally {
      patchApplyFlightRef.current = endCanvasPatchSingleFlight(
        patchApplyFlightRef.current,
        { requestId, scopeKey: requestScopeKey },
      );
      if (requestId === patchApplyRequestRef.current && requestScopeKey === patchScopeKeyRef.current) {
        setPatchApplyBusy(false);
      }
    }
  }, [loadPatchHistory, patchApplyBusy, patchScopeKey, props.onResolvePatchConflict, props.patchConflictMessage]);

  useEffect(() => {
    if (!props.open) return;
    setTab(props.initialTab || 'subflows');
  }, [props.initialTab, props.open]);

  useEffect(() => {
    setFavoriteSubflowIds(parseSubflowFavoriteIds(localStorage.getItem(favoriteStorageKey)));
  }, [favoriteStorageKey]);

  useEffect(() => {
    doctorLoadGenerationRef.current += 1;
    subflowLoadGenerationRef.current += 1;
    runLoadGenerationRef.current += 1;
    subflowLoadAbortRef.current?.abort();
    runLoadAbortRef.current?.abort();
    agentGenerationRef.current += 1;
    agentAbortRef.current?.abort();
    patchPreviewRequestRef.current += 1;
    patchApplyRequestRef.current += 1;
    patchHistoryRequestRef.current += 1;
    patchPreviewFlightRef.current = null;
    patchApplyFlightRef.current = null;
    setDoctorRemoteContext(EMPTY_DOCTOR_REMOTE_CONTEXT);
    setSubflows([]);
    setSubflowVersions(null);
    setRuns([]);
    setRunDetail(null);
    setRunEvents([]);
    setCompareRunDetail(null);
    setAgentSession(null);
    setAgentExplanation(null);
    setAgentPlan(null);
    setAgentPatchQueue([]);
    setAgentToolTrace([]);
    setAgentAuthority(null);
    setAgentBusy(false);
    setAgentError('');
    setPatchPreview(null);
    setPatchPreviewBusy(false);
    setPatchApplyBusy(false);
    setPatchApplyError('');
    setPatchApplyRetryable(false);
    setPatchRepreviewAllowed(false);
    setPatchHistory([]);
    setPatchHistoryLoading(false);
  }, [props.canvasId, props.open, props.projectId, tab]);

  useEffect(() => {
    // 失败证据允许从 Run 页切到 Doctor 后继续使用，但不能跨工作台关闭或跨画布/项目复用。
    setDoctorEvidenceTarget(null);
  }, [props.canvasId, props.open, props.projectId]);

  useEffect(() => {
    if (agentRevisionIdentityRef.current !== agentIdentityScopeKey) {
      agentRevisionIdentityRef.current = agentIdentityScopeKey;
      agentRevisionRef.current = props.canvasRevision;
      return;
    }
    const previousRevision = agentRevisionRef.current;
    agentRevisionRef.current = props.canvasRevision;
    if (previousRevision === props.canvasRevision) return;
    agentGenerationRef.current += 1;
    agentAbortRef.current?.abort();
    setAgentBusy(false);
    const hasUnapplied = agentPatchQueueRef.current.some((item) => item.status !== 'applied');
    setAgentPatchQueue((current) => current.map((item) => item.status === 'applied' ? item : {
      ...item,
      status: 'stale',
      error: `画布已从 r${item.baseRevision} 更新到 r${props.canvasRevision}`,
    }));
    if (hasUnapplied) setAgentError((current) => current || '画布 revision 已变化，未应用的 Agent 队列项已标记为过期。');
  }, [agentIdentityScopeKey, props.canvasRevision]);

  useEffect(() => {
    if (!props.open) return;
    if (tab === 'subflows') void loadSubflows('');
    if (tab === 'runs') void loadRuns();
  }, [loadRuns, loadSubflows, props.open, tab]);

  useEffect(() => {
    if (!props.open || tab !== 'doctor') return;
    void loadPatchHistory();
  }, [loadPatchHistory, props.canvasRevision, props.open, tab]);

  useEffect(() => {
    if (!props.open || tab !== 'doctor') {
      props.onDoctorHighlightsChange([]);
      return;
    }
    props.onDoctorHighlightsChange(doctorHighlights);
    return () => props.onDoctorHighlightsChange([]);
  }, [doctorHighlights, props.onDoctorHighlightsChange, props.open, tab]);

  useEffect(() => {
    if (!props.open || tab !== 'doctor') return;
    const generation = ++doctorLoadGenerationRef.current;
    const controller = new AbortController();
    setDoctorRemoteContext({
      ...EMPTY_DOCTOR_REMOTE_CONTEXT,
      scopeKey: doctorScopeKey,
      loading: true,
      requestedAssetCount: doctorAssetIds.length,
    });
    void (async () => {
      const runEvidencePromise = doctorEvidenceTarget
        ? api.executeCanvasAgentTool({
          tool: 'inspectRun',
          requestId: `doctor-run-${Date.now().toString(36)}`,
          projectId: props.projectId,
          canvasId: props.canvasId!,
          input: {
            runId: doctorEvidenceTarget.runId,
            nodeRunId: doctorEvidenceTarget.nodeRunId,
            attemptId: doctorEvidenceTarget.attemptId,
          },
        }, { signal: controller.signal }).then((result) => parseCanvasAgentRunEvidence(result, doctorEvidenceTarget))
        : Promise.resolve(null);
      const intentsPromise = api.listCollaborationRunIntents('actionable', props.projectId, props.canvasId, { signal: controller.signal });
      const policyPromise = intentsPromise.then((intents) => {
        const reservedIntent = selectDoctorReservedRunIntent(intents);
        return api.getCollaborationExecutionPolicy(props.projectId, {
          signal: controller.signal,
          excludeIntentId: reservedIntent?.id,
        });
      });
      const validationPromise = api.executeCanvasAgentTool({
        tool: 'validateCanvas',
        requestId: `doctor-validation-${Date.now().toString(36)}`,
        projectId: props.projectId,
        canvasId: props.canvasId!,
        input: {},
      }, { signal: controller.signal });
      const remotePromise = Promise.allSettled([
        api.listProjectRuns({ projectId: props.projectId, canvasId: props.canvasId || undefined, limit: 30 }, { signal: controller.signal }),
        intentsPromise,
        policyPromise,
        validationPromise,
        runEvidencePromise,
      ] as const);
      const assets: WorkflowAssetDiagnostic[] = [];
      let unavailableAssetCount = 0;
      const requestedAssetIds = doctorAssetIds.slice(0, 64);
      for (let index = 0; index < requestedAssetIds.length && !controller.signal.aborted; index += 6) {
        const batchAssetIds = requestedAssetIds.slice(index, index + 6);
        const batch = await Promise.allSettled(batchAssetIds.map((assetId) => api.getProjectAsset(assetId, { signal: controller.signal })));
        if (controller.signal.aborted) break;
        batch.forEach((result, offset) => {
          if (result.status === 'rejected') {
            if (result.reason instanceof api.ApiRequestError && result.reason.status === 404) {
              assets.push({ id: batchAssetIds[offset], availability: 'missing', projectId: props.projectId });
            } else {
              unavailableAssetCount += 1;
            }
            return;
          }
          assets.push({ id: result.value.id, availability: result.value.availability, kind: result.value.kind, projectId: result.value.projectId });
        });
      }
      const [runsResult, intentsResult, policyResult, validationResult, runEvidenceResult] = await remotePromise;
      if (controller.signal.aborted || generation !== doctorLoadGenerationRef.current) return;
      const unavailable: string[] = [];
      if (runsResult.status === 'rejected') unavailable.push('Run');
      if (intentsResult.status === 'rejected') unavailable.push('运行请求');
      if (policyResult.status === 'rejected') unavailable.push('执行策略');
      if (validationResult.status === 'rejected' || validationResult.value.truncated) unavailable.push('递归子工作流结构诊断');
      if (doctorEvidenceTarget && runEvidenceResult.status === 'rejected') unavailable.push('指定 Run/NodeRun/Attempt 证据');
      if (unavailableAssetCount > 0) unavailable.push(`${unavailableAssetCount} 项项目素材`);
      setDoctorRemoteContext({
        scopeKey: doctorScopeKey,
        loading: false,
        error: unavailable.length ? `${unavailable.join('、')}上下文暂不可用；对应规则不会据此下结论。` : '',
        assets,
        requestedAssetCount: doctorAssetIds.length,
        resolvedAssetCount: assets.length,
        runs: runsResult.status === 'fulfilled' ? runsResult.value : [],
        pendingIntents: intentsResult.status === 'fulfilled' ? intentsResult.value : [],
        executionPolicy: policyResult.status === 'fulfilled' ? policyResult.value : null,
        validation: validationResult.status === 'fulfilled' && !validationResult.value.truncated
          ? validationResult.value
          : null,
        validationError: validationResult.status === 'rejected'
          ? validationResult.reason instanceof Error ? validationResult.reason.message : String(validationResult.reason)
          : validationResult.value.truncated ? '权威结构诊断响应被截断，已拒绝使用部分结论。' : '',
        runEvidence: runEvidenceResult.status === 'fulfilled' ? runEvidenceResult.value : null,
        runEvidenceError: runEvidenceResult.status === 'rejected'
          ? runEvidenceResult.reason instanceof Error ? runEvidenceResult.reason.message : String(runEvidenceResult.reason)
          : '',
      });
    })();
    return () => controller.abort();
  }, [doctorAssetIdKey, doctorEvidenceTarget, doctorScopeKey, props.canvasId, props.canvasRevision, props.open, props.projectId, tab]);

  if (!props.open) return null;

  const inspectSubflowFile = (file: File) => withBusy(async () => {
    const inspection = await api.inspectSubflowPackage(file);
    setSubflowPackageDraft({ file, inspection });
    setMessage(`安全检查通过：${inspection.definition.name} · ${inspection.entryCount} 个条目 · SHA256 ${inspection.archiveSha256.slice(0, 12)}…`);
  });

  const importInspectedSubflow = () => withBusy(async () => {
    if (!subflowPackageDraft) return;
    const imported = await api.importSubflowPackage(subflowPackageDraft.file, subflowPackageDraft.inspection.archiveSha256, props.projectId);
    setSubflowPackageDraft(null);
    setMessage(`已导入“${imported.name}” v${imported.version}`);
    await loadSubflows();
  });

  const openSubflowVersions = (definition: SubflowDefinition) => withBusy(async () => {
    const items = await api.listSubflowVersions(definition.id, definition.projectId || props.projectId);
    setSubflowVersions({ root: definition, items, selected: items.find((item) => item.version !== definition.version)?.version || definition.version });
  });

  const toggleSubflowFavorite = (definitionId: string) => {
    setFavoriteSubflowIds((current) => {
      const next = toggleSubflowFavoriteId(current, definitionId);
      localStorage.setItem(favoriteStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const copySubflowAsIndependent = (definition: SubflowDefinition) => withBusy(async () => {
    const copyId = `subflow-copy-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
    const saved = await api.saveSubflow(createIndependentSubflowDraft(definition, {
      id: copyId,
      projectId: definition.projectId || props.projectId,
    }));
    setMessage(`已另存独立副本“${saved.name}” v${saved.version}`);
    await loadSubflows();
  });

  const saveSubflowLibraryMetadata = () => withBusy(async () => {
    if (!subflowLibraryEdit) return;
    const baseRevision = Number(subflowLibraryEdit.definition.revision || subflowLibraryEdit.definition.version);
    const { version: _version, revision: _revision, changeSummary: _changeSummary, publishedBy: _publishedBy, publishedAt: _publishedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = subflowLibraryEdit.definition;
    const metadata = normalizeSubflowLibraryMetadata(subflowLibraryEdit.category, subflowLibraryEdit.tags);
    try {
      const saved = await api.saveSubflow({
        ...definition,
        ...metadata,
        baseRevision,
        changeSummary: '更新子工作流分类与标签',
      });
      setSubflowLibraryEdit(null);
      setMessage(`分类/标签已保存为不可变新版本 v${saved.version} / revision ${saved.revision}`);
      await loadSubflows();
    } catch (error) {
      const current = error instanceof api.ApiRequestError && error.status === 409
        ? (error.data as { data?: { revision?: unknown; latestVersion?: unknown; definition?: unknown } } | null)?.data
        : null;
      if (current?.definition && typeof current.definition === 'object') {
        setSubflowLibraryEdit((draft) => draft ? {
          ...draft,
          conflict: {
            revision: Math.max(1, Number(current.revision) || 1),
            latestVersion: Math.max(1, Number(current.latestVersion) || 1),
            definition: current.definition as SubflowDefinition,
          },
        } : draft);
        throw new Error(`发布冲突：服务器已到 v${current.latestVersion} / revision ${current.revision}，分类和标签草稿仍保留`);
      }
      throw error;
    }
  });

  const loadLatestSubflowLibraryConflict = () => setSubflowLibraryEdit((draft) => {
    if (!draft?.conflict) return draft;
    const latest = draft.conflict.definition;
    return {
      definition: latest,
      category: latest.category || '',
      tags: (latest.tags || []).join(', '),
    };
  });

  const prepareSubflowUpgrade = (from: SubflowDefinition, to: SubflowDefinition) => {
    try {
      const preview = upgradeSubflowInstances(props.nodes, props.edges, from, to);
      if (!preview.upgradedNodeIds.length) {
        setMessage(`当前画布没有固定在 ${from.name} v${from.version} 的实例。`);
        return;
      }
      setSubflowUpgradeDraft({ from, to, preview });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openRunDetail = (runId: string) => withBusy(async () => {
    const [detail, events] = await Promise.all([api.getProjectRun(runId), api.listProjectRunEvents(runId)]);
    setRunDetail(detail);
    setRunEvents(events);
    setRunEventVisibleCount(100);
    setCompareRunId('');
    setCompareRunDetail(null);
  });

  const diagnoseRunAttempt = (nodeRun: NodeRunSummary, attempt: RunAttemptSummary) => {
    if (!runDetail?.id || !nodeRun.id || !attempt.id) {
      setMessage('缺少真实 Run/NodeRun/Attempt 身份，不能执行权威诊断。');
      return;
    }
    setDoctorEvidenceTarget({ runId: runDetail.id, nodeRunId: nodeRun.id, attemptId: attempt.id });
    setTab('doctor');
  };

  const applyRunFilters = () => setRunFilter({
    initiatorId: runFilterDraft.initiatorId.trim(),
    provider: runFilterDraft.provider.trim(),
    model: runFilterDraft.model.trim(),
  });

  const resetRunFilters = () => {
    const empty = { initiatorId: '', provider: '', model: '' };
    setRunFilterDraft(empty);
    setRunFilter(empty);
    setRunStatus('');
  };

  const retryRun = (mode: ProjectRunReplayMode) => withBusy(async () => {
    if (!runDetail) return;
    const count = await props.onRetryRun(runDetail, mode);
    if (count < 0) return;
    if (count === 0) throw new Error(mode === 'full-current' ? '原 Run 的可执行节点已不在当前画布，无法按当前参数重跑。' : '没有可使用原输入重放的节点。');
    const action = mode === 'failed-original'
      ? '失败节点已按原输入继续'
      : mode === 'full-original'
        ? '已用原输入另开运行'
        : '已按当前画布参数重跑';
    setMessage(`已创建子 Run，${action} ${count} 个节点。`);
    await loadRuns();
  });

  const retrySubflowNodeRun = (nodeRun: NodeRunSummary) => withBusy(async () => {
    if (!runDetail) return;
    const count = await props.onRetrySubflowNodeRun(runDetail, nodeRun);
    if (count < 0) return;
    if (count === 0) throw new Error('没有可使用原输入重试的内部节点。');
    setMessage(`已创建子 Run，并按原输入重试内部节点 ${nodeRun.originalNodeId || nodeRun.nodeId}。`);
    await loadRuns();
  });

  const retryRunAttempt = (nodeRun: NodeRunSummary, attempt: RunAttemptSummary) => withBusy(async () => {
    if (!runDetail) return;
    const count = await props.onRetryRunAttempt(runDetail, nodeRun, attempt);
    if (count < 0) return;
    if (count === 0) throw new Error('没有可使用该 Attempt 原输入重试的节点。');
    setMessage(`已创建子 Run，按 Attempt #${attempt.attemptNumber} 的原输入重试 ${count} 个节点。`);
    await loadRuns();
  });

  const saveRunRetention = () => withBusy(async () => {
    if (!runRetention) return;
    setRunRetention(await api.updateProjectRunRetention({ ...runRetention, projectId: props.projectId }));
    setMessage('运行记录保留策略已保存。素材不随 Run 清理。');
  });

  const pruneRunHistory = () => withBusy(async () => {
    const result = await api.pruneProjectRuns(props.projectId);
    const blocked = result.blockedBy.length ? `；仍受保护项限制：${result.blockedBy.join('、')}` : '';
    setMessage(`清理完成：Run ${result.beforeRuns} → ${result.afterRuns}，产物引用 ${result.beforeAssetRefs} → ${result.afterAssetRefs}，保护 ${result.protectedRuns} 个 Run；删除素材 ${result.assetsDeleted} 个${blocked}。`);
    setRunDetail(null);
    setRunEvents([]);
    await loadRuns();
  });

  return (
    <div className="fixed inset-0 z-[85] bg-black/45" data-project-workbench onPointerDown={(event) => {
      if (event.target === event.currentTarget && !patchPreviewBusy && !patchApplyBusy) props.onClose();
    }}>
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[980px] flex-col border-l-2 border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-primary)] px-5">
          <span className="grid h-10 w-10 place-items-center rounded bg-[var(--accent-primary)] text-white"><Boxes size={20} /></span>
          <div className="min-w-0 flex-1"><h2 className="text-base font-bold">项目工作台</h2><p className="truncate text-xs text-[var(--text-secondary)]">子流程、运行记录、资产、诊断与协作</p></div>
          {busy && <Loader2 size={18} className="animate-spin" />}
          <button type="button" disabled={patchPreviewBusy || patchApplyBusy} className="grid h-9 w-9 place-items-center rounded border border-[var(--border-primary)] disabled:cursor-wait disabled:opacity-40" aria-label="关闭项目工作台" onClick={props.onClose}><X size={17} /></button>
        </header>
        <nav className="flex shrink-0 overflow-x-auto border-b border-[var(--border-primary)] px-3">
          {tabs.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={`flex h-12 min-w-24 items-center justify-center gap-2 border-b-2 px-3 text-xs font-bold ${tab === item.id ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : 'border-transparent text-[var(--text-secondary)]'}`} onClick={() => setTab(item.id)}><Icon size={15} />{item.label}</button>;
          })}
        </nav>
        {message && <div className="shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-2 text-xs">{message}</div>}
        <main className={`min-h-0 flex-1 ${tab === 'assets' ? 'overflow-hidden' : 'overflow-auto p-5'}`}>
          {tab === 'subflows' && (
            <section>
              <input ref={subflowPackageInputRef} type="file" accept=".t8flow,application/vnd.t8.subflow+zip" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void inspectSubflowFile(file); }} />
              <div className="mb-4 flex flex-wrap gap-2"><input value={query} className="h-10 min-w-48 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm" placeholder="搜索名称、说明或标签" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadSubflows(query); }} /><select value={subflowCategory} className="h-10 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs" onChange={(event) => setSubflowCategory(event.target.value)}><option value="">全部分类</option>{subflowCategories.map((category) => <option key={category}>{category}</option>)}</select><button type="button" className={`flex h-10 items-center gap-2 rounded border px-3 text-xs font-bold ${favoriteOnly ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : 'border-[var(--border-primary)]'}`} onClick={() => setFavoriteOnly((value) => !value)}><Heart size={15} fill={favoriteOnly ? 'currentColor' : 'none'} />收藏</button><button type="button" className="flex h-10 items-center gap-2 rounded border border-[var(--border-primary)] px-3 text-xs font-bold" onClick={() => subflowPackageInputRef.current?.click()}><Upload size={15} />导入 .t8flow</button><button type="button" className="grid h-10 w-10 place-items-center rounded border border-[var(--border-primary)]" title="刷新" onClick={() => void loadSubflows(query)}><RefreshCw size={16} /></button></div>
              {subflowPackageDraft && <div className="mb-4 border-y border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3"><div className="flex flex-wrap items-center gap-3"><ShieldCheck size={18} className="text-green-500" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">检查通过 · {subflowPackageDraft.inspection.definition.name}</div><div className="mt-1 truncate font-mono text-[10px] text-[var(--text-secondary)]">SHA256 {subflowPackageDraft.inspection.archiveSha256}</div><div className="mt-1 text-[10px] text-[var(--text-secondary)]">{subflowPackageDraft.inspection.definition.nodes.length} 节点 · {subflowPackageDraft.inspection.entryCount} 条目 · {(subflowPackageDraft.inspection.totalBytes / 1024).toFixed(1)} KB</div></div><button type="button" className="h-9 rounded border border-[var(--border-primary)] px-3 text-xs font-bold" onClick={() => setSubflowPackageDraft(null)}>取消</button><button type="button" className="h-9 rounded bg-[var(--accent-primary)] px-4 text-xs font-bold text-white" onClick={() => void importInspectedSubflow()}>确认导入</button></div></div>}
              {subflowVersions && <div className="mb-4 border-y border-[var(--border-primary)] py-4">
                <div className="mb-3 flex items-center gap-3"><History size={18} className="text-[var(--accent-primary)]" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{subflowVersions.root.name} · 版本记录</div><div className="text-[10px] text-[var(--text-secondary)]">最新 v{subflowVersions.root.version} · revision {subflowVersions.root.revision || subflowVersions.root.version}，实例不会自动升级</div></div><button type="button" className="grid h-8 w-8 place-items-center rounded border border-[var(--border-primary)]" aria-label="关闭版本记录" onClick={() => setSubflowVersions(null)}><X size={14} /></button></div>
                <div className="flex flex-wrap gap-2">{subflowVersions.items.map((item) => <button key={item.version} type="button" className={`h-8 rounded border px-3 text-xs font-bold ${subflowVersions.selected === item.version ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : 'border-[var(--border-primary)]'}`} onClick={() => setSubflowVersions((current) => current ? { ...current, selected: item.version } : current)}>v{item.version} · r{item.revision || item.version}</button>)}</div>
                {selectedSubflowVersion && <div className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-[10px] leading-5 text-[var(--text-secondary)]"><span className="font-bold text-[var(--text-primary)]">revision {selectedSubflowVersion.revision || selectedSubflowVersion.version}</span> · {selectedSubflowVersion.publishedBy || 'local-owner'}<div>{selectedSubflowVersion.changeSummary || '旧版本未记录变更说明'}</div></div>}
                {selectedSubflowVersion && <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]"><div className="text-xs text-[var(--text-secondary)]">{selectedSubflowVersion.version === subflowVersions.root.version ? '这是当前最新固定版本。' : selectedSubflowDiff ? <><div>{`升级到 v${subflowVersions.root.version}：节点 +${selectedSubflowDiff.nodes.added.length} / -${selectedSubflowDiff.nodes.removed.length} / 改${selectedSubflowDiff.nodes.changed.length}，连线 +${selectedSubflowDiff.edges.added.length} / -${selectedSubflowDiff.edges.removed.length} / 改${selectedSubflowDiff.edges.changed.length}`}</div><div className="mt-1 text-amber-500">端口删除：{[...selectedSubflowDiff.inputs.removed, ...selectedSubflowDiff.outputs.removed].join('、') || '无'}；端口契约变更：{[...selectedSubflowDiff.inputs.changed, ...selectedSubflowDiff.outputs.changed].join('、') || '无'}；参数删除/变更：{[...selectedSubflowDiff.parameters.removed, ...selectedSubflowDiff.parameters.changed].join('、') || '无'}</div></> : '无可比较差异'}</div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="h-9 rounded border border-[var(--border-primary)] px-3 text-xs font-bold" onClick={() => void copySubflowAsIndependent(selectedSubflowVersion)}><Copy size={14} className="mr-1 inline" />另存副本</button><button type="button" className="h-9 rounded border border-[var(--border-primary)] px-3 text-xs font-bold" onClick={() => void withBusy(async () => api.downloadSubflowPackage(selectedSubflowVersion))}><Download size={14} className="mr-1 inline" />导出该版</button>{selectedSubflowVersion.version !== subflowVersions.root.version && <button type="button" className="h-9 rounded border border-amber-500 px-3 text-xs font-bold text-amber-600" onClick={() => prepareSubflowUpgrade(selectedSubflowVersion, subflowVersions.root)}>升级画布实例</button>}<button type="button" className="h-9 rounded bg-[var(--accent-primary)] px-3 text-xs font-bold text-white" onClick={() => props.onInsertSubflow(selectedSubflowVersion)}>插入该版</button></div></div>}
              </div>}
              <div className="grid gap-2 md:grid-cols-2">
                {visibleSubflows.map((definition) => <article key={`${definition.id}-${definition.version}`} className="flex min-h-32 items-center gap-3 border-b border-[var(--border-primary)] py-3"><SubflowThumbnail definition={definition} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold">{definition.name}</h3><button type="button" className="grid h-6 w-6 shrink-0 place-items-center" title={favoriteSubflowIds.includes(definition.id) ? '取消收藏' : '收藏'} onClick={() => toggleSubflowFavorite(definition.id)}><Heart size={14} fill={favoriteSubflowIds.includes(definition.id) ? 'currentColor' : 'none'} /></button></div><p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{definition.description || '无说明'}</p><p className="mt-1 line-clamp-1 text-[10px] text-[var(--text-secondary)]">变更：{definition.changeSummary || '旧版本未记录'}</p><div className="mt-2 flex flex-wrap gap-1 text-[9px] text-[var(--text-secondary)]"><span>v{definition.version} · revision {definition.revision || definition.version} · {definition.nodes.length} 节点 · {definition.inputs.length}/{definition.outputs.length} 端口</span>{definition.category && <span className="rounded border border-[var(--border-primary)] px-1">{definition.category}</span>}{(definition.tags || []).slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div></div><div className="grid shrink-0 grid-cols-2 gap-1"><button type="button" className="grid h-8 w-8 place-items-center rounded border border-[var(--border-primary)]" title="编辑分类/标签（创建新版本）" onClick={() => setSubflowLibraryEdit({ definition, category: definition.category || '', tags: (definition.tags || []).join(', ') })}><Tags size={14} /></button><button type="button" className="grid h-8 w-8 place-items-center rounded border border-[var(--border-primary)]" title="另存独立副本" onClick={() => void copySubflowAsIndependent(definition)}><Copy size={14} /></button><button type="button" className="grid h-8 w-8 place-items-center rounded border border-[var(--border-primary)]" title="版本记录" onClick={() => void openSubflowVersions(definition)}><History size={14} /></button><button type="button" className="grid h-8 w-8 place-items-center rounded border border-[var(--border-primary)]" title="导出 .t8flow" onClick={() => void withBusy(async () => api.downloadSubflowPackage(definition))}><Download size={14} /></button><button type="button" className="col-span-2 h-8 rounded bg-[var(--accent-primary)] px-3 text-xs font-bold text-white" onClick={() => props.onInsertSubflow(definition)}>插入</button></div></article>)}
              </div>
              {!visibleSubflows.length && !busy && <div className="py-16 text-center text-sm text-[var(--text-secondary)]">{subflows.length ? '当前筛选没有匹配的子流程。' : '还没有子流程。框选节点后右键“封装为子工作流”。'}</div>}
            </section>
          )}

          {tab === 'runs' && (
            <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
              <div>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <select value={runStatus} className="h-10 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs" onChange={(event) => setRunStatus(event.target.value)}><option value="">全部状态</option><option value="queued">排队中</option><option value="running">运行中</option><option value="succeeded">成功</option><option value="failed">失败</option><option value="stopped">已停止</option><option value="interrupted">已中断</option></select>
                  <button type="button" className="flex h-10 items-center justify-center gap-2 rounded border border-[var(--border-primary)] text-xs font-bold" onClick={() => void loadRuns()}><RefreshCw size={15} />刷新</button>
                  <input value={runFilterDraft.initiatorId} maxLength={160} className="h-9 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs" placeholder="发起人（精确）" onChange={(event) => setRunFilterDraft((current) => ({ ...current, initiatorId: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') applyRunFilters(); }} />
                  <input value={runFilterDraft.provider} maxLength={160} className="h-9 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs" placeholder="平台（精确）" onChange={(event) => setRunFilterDraft((current) => ({ ...current, provider: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') applyRunFilters(); }} />
                  <input value={runFilterDraft.model} maxLength={240} className="col-span-2 h-9 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs" placeholder="模型（精确）" onChange={(event) => setRunFilterDraft((current) => ({ ...current, model: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') applyRunFilters(); }} />
                  <button type="button" className="h-9 rounded bg-[var(--accent-primary)] text-xs font-bold text-white" onClick={applyRunFilters}>应用筛选</button>
                  <button type="button" className="h-9 rounded border border-[var(--border-primary)] text-xs font-bold" onClick={resetRunFilters}>清空筛选</button>
                </div>
                <div className="mb-3 flex min-h-5 flex-wrap items-center gap-1 text-[9px] text-[var(--text-secondary)]"><span>{runs.length} 个结果</span>{runFilter.initiatorId && <span className="rounded border border-[var(--border-primary)] px-1">发起人 {runFilter.initiatorId}</span>}{runFilter.provider && <span className="rounded border border-[var(--border-primary)] px-1">平台 {runFilter.provider}</span>}{runFilter.model && <span className="rounded border border-[var(--border-primary)] px-1">模型 {runFilter.model}</span>}</div>
                <details className="mb-3 border-y border-[var(--border-primary)] py-2 text-xs">
                  <summary className="cursor-pointer font-bold">保留与恢复策略</summary>
                  {runRetention && <div className="mt-3 grid grid-cols-2 gap-2">
                    <label>保留天数<input type="number" min={1} max={3650} value={runRetention.maxDays} className="mt-1 h-9 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2" onChange={(event) => setRunRetention({ ...runRetention, maxDays: Number(event.target.value) || 1 })} /></label>
                    <label>最多 Run<input type="number" min={10} max={1000000} value={runRetention.maxRuns} className="mt-1 h-9 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2" onChange={(event) => setRunRetention({ ...runRetention, maxRuns: Number(event.target.value) || 10 })} /></label>
                    <label className="col-span-2">最多产物引用<input type="number" min={0} max={10000000} value={runRetention.maxAssetRefs} className="mt-1 h-9 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2" onChange={(event) => setRunRetention({ ...runRetention, maxAssetRefs: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} /></label>
                    <label className="col-span-2">数据库上限 GB<input type="number" min={0.0625} max={1024} step={0.25} value={Number((runRetention.maxDbBytes / 1024 / 1024 / 1024).toFixed(2))} className="mt-1 h-9 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2" onChange={(event) => setRunRetention({ ...runRetention, maxDbBytes: Math.round((Number(event.target.value) || 0.0625) * 1024 * 1024 * 1024) })} /></label>
                    <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={runRetention.keepReferenced} onChange={(event) => setRunRetention({ ...runRetention, keepReferenced: event.target.checked })} />保护有产物引用的 Run</label>
                    <button type="button" className="h-9 rounded border border-[var(--border-primary)] font-bold" onClick={() => void saveRunRetention()}>保存策略</button>
                    <button type="button" className="h-9 rounded border border-red-500 text-red-500 font-bold" onClick={() => void pruneRunHistory()}>立即清理</button>
                    {runRecovery && <div className="col-span-2 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                      <div className="font-bold text-[var(--text-primary)]">启动恢复：待续查 {runRecovery.startup.recoverableAttempts}，已诚实中断 {runRecovery.startup.attempts}</div>
                      <div>恢复器 {runRecovery.manager.running ? '运行中' : runRecovery.manager.status === 'completed' ? '已完成' : '空闲'} · 成功 {runRecovery.manager.recovered} · 上游失败 {runRecovery.manager.failed} · 无法续查 {runRecovery.manager.interrupted} · 待处理 {runRecovery.pending}</div>
                    </div>}
                    <p className="col-span-2 text-[10px] leading-4 text-[var(--text-secondary)]">清理只处理终态 Run，永不删除素材文件或素材索引；启用“保护有产物引用”时，受保护 Run 可能使数量/体积目标无法完全达到，结果会明确提示。</p>
                  </div>}
                </details>
                <div className="space-y-1">{runs.map((run) => <button key={run.id} type="button" className={`flex w-full items-center gap-3 border-b border-[var(--border-primary)] px-2 py-3 text-left ${runDetail?.id === run.id ? 'bg-[var(--bg-secondary)]' : ''}`} onClick={() => void openRunDetail(run.id)}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: statusColor(run.status) }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{run.id.slice(0, 12)}</span><span className="text-[10px] text-[var(--text-secondary)]">{run.initiatorId} · {formatTime(run.createdAt)}</span></span><ChevronRight size={14} /></button>)}</div>
              </div>
              <div className="min-w-0 border-l border-[var(--border-primary)] pl-5">{runDetail ? <>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="break-all text-sm font-bold">运行 {runDetail.id}</h3><p className="text-xs text-[var(--text-secondary)]">revision {runDetail.canvasRevision} · {runDetail.status}{runDetail.parentRunId ? ` · 重跑自 ${runDetail.parentRunId.slice(0, 8)}` : ''}{typeof runDetail.summary?.replaySourceAttemptId === 'string' && runDetail.summary.replaySourceAttemptId ? ` · Attempt ${runDetail.summary.replaySourceAttemptId.slice(0, 8)}` : ''}</p></div><span className="text-xs">{formatTime(runDetail.startedAt)} → {formatTime(runDetail.finishedAt)}</span></div>
                {runDetail.canvasRevision !== props.canvasRevision && <div className="mb-3 border-y border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">当前画布 revision {props.canvasRevision} 与该 Run 的 revision {runDetail.canvasRevision} 不同；“原输入”按钮使用该 Run 已安全保存的输入图，“当前画布”按钮才读取现在的节点参数。</div>}
                <div className="mb-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !originalReplayAvailability?.failed.ok} title={replayValidationMessage(originalReplayAvailability?.failed, '只重放失败、停止、异常中断节点及其下游，成功上游作为只读原输入', '没有失败节点')} className="h-9 rounded bg-[var(--accent-primary)] px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void retryRun('failed-original')}>失败节点按原输入继续</button>
                  <button type="button" disabled={busy || !originalReplayAvailability?.full.ok} title={replayValidationMessage(originalReplayAvailability?.full, '按该 Run 保存的原输入图创建完整子 Run', '原输入不可用')} className="h-9 rounded border border-[var(--border-primary)] px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void retryRun('full-original')}>用原输入另开 Run</button>
                  <button type="button" disabled={busy} className="h-9 rounded border border-[var(--border-primary)] px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void retryRun('full-current')}>按当前画布重跑</button>
                  <select value={compareRunId} className="h-9 min-w-44 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs" onChange={(event) => { const id = event.target.value; setCompareRunId(id); if (!id) setCompareRunDetail(null); else void withBusy(async () => setCompareRunDetail(await api.getProjectRun(id))); }}><option value="">选择 Run 对比</option>{runs.filter((run) => run.id !== runDetail.id).map((run) => <option key={run.id} value={run.id}>{run.id.slice(0, 12)} · {run.status}</option>)}</select>
                </div>
                {originalReplayAvailability && (!originalReplayAvailability.full.ok || !originalReplayAvailability.failed.ok) && <p className="mb-4 text-[10px] leading-4 text-[var(--text-secondary)]">原输入可用性：完整重放 {originalReplayAvailability.full.ok ? '可用' : originalReplayAvailability.full.reason}；失败续跑 {originalReplayAvailability.failed.ok ? `${originalReplayAvailability.failedNodeIds.length} 个节点可用` : originalReplayAvailability.failed.reason}。旧记录或被安全脱敏/截断的输入不会伪装成原输入。</p>}
                {runComparison && <div className="mb-4 border-y border-[var(--border-primary)] py-3 text-xs">
                  <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5"><div><strong>{formatDuration(runComparison.leftDurationMs)}</strong><span className="block text-[10px] opacity-55">当前耗时</span></div><div><strong className={runComparison.durationDeltaMs > 0 ? 'text-red-500' : 'text-green-500'}>{runComparison.durationDeltaMs >= 0 ? '+' : ''}{formatDuration(Math.abs(runComparison.durationDeltaMs))}</strong><span className="block text-[10px] opacity-55">耗时变化</span></div><div><strong>{runComparison.leftOutputs} → {runComparison.rightOutputs}</strong><span className="block text-[10px] opacity-55">输出数量</span></div><div><strong>{runComparison.inputChangedNodes}</strong><span className="block text-[10px] opacity-55">输入变化节点</span></div><div><strong>{runComparison.costMetrics.length}</strong><span className="block text-[10px] opacity-55">成本/额度指标</span></div></div>
                  <div className="mt-3 max-h-40 space-y-2 overflow-auto text-[10px] text-[var(--text-secondary)]">{runComparison.changedNodes.map((item) => <div key={item.nodeId} className="rounded border border-[var(--border-primary)] p-2"><div><strong>{item.nodeId}</strong>: {item.leftStatus || '无'} / {formatDuration(item.leftDurationMs)} → {item.rightStatus || '无'} / {formatDuration(item.rightDurationMs)}{item.inputChanged ? ' · 输入变化' : ''}{item.providerChanged ? ' · 平台/模型变化' : ''}{item.usageChanged ? ' · 用量变化' : ''}</div>{item.providerChanged && <div className="mt-1 opacity-60">{item.leftProviders.join(', ') || '无平台'} → {item.rightProviders.join(', ') || '无平台'}</div>}{item.inputChanged && <LazyJsonDetails className="mt-1" label="展开两次输入快照" value={{ currentRun: item.leftInput, comparedRun: item.rightInput }} />}</div>)}</div>
                  {runComparison.costMetrics.length > 0 && <LazyJsonDetails className="mt-2" label="展开成本/额度差异（不跨平台、模型或单位相加）" value={runComparison.costMetrics} />}
                  {runComparison.usageMetrics.length > 0 && <LazyJsonDetails className="mt-1" label="展开全部数值用量差异" value={runComparison.usageMetrics} />}
                </div>}
                <LazyJsonDetails className="mb-4 border-y border-[var(--border-primary)] py-2" label="展开 Run 汇总字段" value={runDetail.summary} />
                <h4 className="mb-2 text-xs font-bold">DAG 依赖 <span className="font-normal text-[var(--text-secondary)]">按依赖深度分层，橙框为关键路径</span></h4>
                <div className="mb-4 overflow-x-auto border-y border-[var(--border-primary)] py-3">
                  <div className="flex min-w-max items-stretch gap-2">{runTimelineAnalysis?.dagLevels.map((level) => <div key={level.depth} className="w-40 shrink-0 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2"><div className="mb-2 text-[9px] font-bold uppercase opacity-55">层级 {level.depth}</div><div className="space-y-1">{level.nodeIds.map((nodeId) => {
                    const item = runTimelineByNodeId.get(nodeId);
                    if (!item) return null;
                    return <button key={nodeId} type="button" className={`block w-full rounded border px-2 py-1 text-left text-[10px] ${item.critical ? 'border-amber-500' : 'border-[var(--border-primary)]'}`} title={`依赖：${item.dependencies.join(', ') || '无'}；下游：${item.dependents.join(', ') || '无'}`} onClick={() => props.onFocusNode(nodeId)}><span className="block truncate font-semibold">{nodeId}</span><span className="block truncate text-[8px] opacity-55">{item.dependencies.length ? `← ${item.dependencies.join(', ')}` : '起点'}</span></button>;
                  })}</div></div>)}</div>
                </div>
                <h4 className="mb-2 text-xs font-bold">执行时间轴</h4>
                {runTimelineAnalysis && <div className="mb-2 grid grid-cols-3 gap-1 text-center text-[9px] sm:grid-cols-6"><div className="rounded bg-[var(--bg-secondary)] p-2"><strong className="block text-xs">{runTimelineAnalysis.maxConcurrency}</strong>峰值并发</div><div className="rounded bg-[var(--bg-secondary)] p-2"><strong className="block text-xs">{formatDuration(runTimelineAnalysis.totalWaitMs)}</strong>累计等待</div><div className="rounded bg-[var(--bg-secondary)] p-2"><strong className="block text-xs">{runTimelineAnalysis.pollingNodeCount}</strong>轮询节点</div><div className="rounded bg-[var(--bg-secondary)] p-2"><strong className="block text-xs">{runTimelineAnalysis.retryNodeCount}</strong>重试节点</div><div className="rounded bg-[var(--bg-secondary)] p-2"><strong className="block text-xs">{formatDuration(runTimelineAnalysis.totalPollMs)}</strong>轮询耗时</div><div className="rounded bg-[var(--bg-secondary)] p-2"><strong className="block text-xs">{formatDuration(runTimelineAnalysis.criticalPathMs)}</strong>关键路径</div></div>}
                <div className="mb-2 flex flex-wrap gap-3 text-[9px] text-[var(--text-secondary)]"><span><i className="mr-1 inline-block h-2 w-3 bg-slate-400" />等待</span><span><i className="mr-1 inline-block h-2 w-3 bg-green-500" />执行</span><span><i className="mr-1 inline-block h-2 w-3 bg-violet-500" />轮询</span><span><i className="mr-1 inline-block h-2 w-3 border border-amber-500" />关键路径</span></div>
                <div className="mb-4 overflow-x-auto border-y border-[var(--border-primary)] py-3"><div className="min-w-[720px] space-y-2">{runTimeline.map((item) => <div key={item.nodeRun.id} className="grid grid-cols-[140px_minmax(300px,1fr)_180px] items-center gap-2 text-[10px]"><button type="button" className="min-w-0 text-left" title={runNodeIdentity(item.nodeRun)} onClick={() => props.onFocusNode(runNodeIdentity(item.nodeRun))}><span className="block truncate font-semibold">{runNodeIdentity(item.nodeRun)}</span><span className="block truncate text-[8px] opacity-55">层 {item.dependencyDepth} · lane {item.lane + 1} · 尝试 {item.attemptCount} / 重试 {item.retryCount} / 轮询 {item.pollCount}</span></button><div className="relative h-5 overflow-hidden rounded bg-[var(--bg-secondary)]" title={`${formatTime(item.queuedAt)} → ${formatTime(item.finishedAt)}`}>{item.segments.map((segment) => <span key={`${segment.kind}-${segment.startAt}`} className="absolute inset-y-0 rounded-sm" style={{ left: `${segment.offsetPercent}%`, width: `${Math.min(segment.widthPercent, Math.max(0, 100 - segment.offsetPercent))}%`, background: timelinePhaseBackground(segment.kind, item.nodeRun.status), boxShadow: item.critical ? 'inset 0 0 0 1px #f59e0b' : undefined }} />)}</div><span className="text-right text-[8px] leading-4"><span className="block">总计 {formatDuration(item.durationMs)}</span><span className="opacity-55">等 {formatDuration(item.waitMs)} · 跑 {formatDuration(item.runMs)} · 询 {formatDuration(item.pollMs)}</span></span></div>)}</div></div>
                <div className="space-y-1">{runNodeRows.map(({ item: nodeRun, depth }, index) => {
                  const internalReplay = subflowReplayAvailability.get(nodeRun.id);
                  return <details key={nodeRun.id} className="border-b border-[var(--border-primary)] py-2" style={{ marginLeft: depth * 18 }}>
                    <summary className="flex cursor-pointer list-none items-center gap-3 py-1"><span className="w-6 text-xs opacity-50">{index + 1}</span>{depth > 0 && <GitFork size={13} className="shrink-0 text-[var(--accent-primary)]" />}<span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{nodeRun.originalNodeId || nodeRun.nodeId}</span><span className="text-[10px] text-[var(--text-secondary)]">{nodeRun.definitionId ? `${nodeRun.definitionId} v${nodeRun.definitionVersion} · ` : ''}{nodeRun.subflowPath.length ? `${nodeRun.subflowPath.join(' / ')} · ` : ''}{nodeRun.attempts?.length || 0} 次尝试 · {nodeRun.outputRefs.length} 输出</span></span><span className="text-[11px] font-semibold" style={{ color: statusColor(nodeRun.status) }}>{nodeRun.status}</span></summary>
                    <div className="ml-9 mt-2 border-l border-[var(--border-primary)] pl-3 text-[11px]">
                      <div className="mb-2 flex flex-wrap gap-3"><button type="button" className="text-[var(--accent-primary)]" onClick={() => props.onFocusNode(nodeRun.subflowPath[0] || nodeRun.nodeId)}>定位{depth > 0 ? '外层实例' : '画布节点'}</button>{depth > 0 && ['failed', 'stopped', 'interrupted'].includes(nodeRun.status) && <button type="button" disabled={busy || !internalReplay?.ok} title={replayValidationMessage(internalReplay, '仅重试该内部节点，上游使用原 Run 安全快照作为只读输入', '原输入不可用')} className="font-bold text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-35" onClick={() => void retrySubflowNodeRun(nodeRun)}>按原输入重试内部节点</button>}</div>
                      {depth > 0 && internalReplay && !internalReplay.ok && <p className="mb-2 text-[10px] leading-4 text-[var(--text-secondary)]">内部重试不可用：{internalReplay.reason}</p>}
                      <LazyJsonDetails className="mb-2" label="展开节点输入快照" value={nodeRun.inputSnapshot} />
                      {nodeRun.attempts?.map((attempt) => {
                        const attemptReplay = attemptReplayAvailability.get(attempt.id);
                        return <div key={attempt.id} className="mb-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2">
                        <div className="flex justify-between gap-2 font-semibold"><span>尝试 #{attempt.attemptNumber} · {attempt.status}</span><span className="truncate opacity-60">{attempt.provider || 'unknown'}{attempt.model ? ` / ${attempt.model}` : ''}</span></div>
                        {(attempt.upstreamTaskId || attempt.requestId) && <div className="mt-1 truncate font-mono text-[9px] opacity-55">task {attempt.upstreamTaskId || '—'} · request {attempt.requestId || '—'}</div>}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] opacity-55"><span>HTTP {attempt.httpStatus ?? '—'}</span><span>轮询 {attempt.pollCount || 0}</span><span>usage {Object.keys(attempt.usage || {}).length} 项</span><span>{formatTime(attempt.createdAt)} → {formatTime(attempt.updatedAt)}</span></div>
                        {['failed', 'stopped', 'interrupted', 'error'].includes(attempt.status) && <div className="mt-2 flex flex-wrap gap-3"><button type="button" disabled={busy || !attemptReplay?.ok} title={replayValidationMessage(attemptReplay, '只执行该 Attempt 所属节点，上游使用安全保存的原输入', '该 Attempt 不可重试')} className="text-[10px] font-bold text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-35" onClick={() => void retryRunAttempt(nodeRun, attempt)}>按此 Attempt 原输入重试</button><button type="button" disabled={busy || !runDetail?.id || !nodeRun.id || !attempt.id} className="text-[10px] font-bold text-amber-500 disabled:cursor-not-allowed disabled:opacity-35" onClick={() => diagnoseRunAttempt(nodeRun, attempt)}>诊断此失败</button></div>}
                        <div className="mt-2 grid gap-1 sm:grid-cols-2"><LazyJsonDetails label="展开 Attempt 时间戳" value={attempt.timestamps} /><LazyJsonDetails label="展开 Attempt 元数据" value={attempt.metadata} />{Object.keys(attempt.usage || {}).length > 0 && <LazyJsonDetails label="展开用量详情" value={attempt.usage} />}{attempt.error && <LazyJsonDetails className="text-red-500" label="展开标准化错误" value={attempt.error} />}</div>
                      </div>;})}
                      {nodeRun.outputRefs.length > 0 && <LazyJsonDetails className="mb-2 rounded border border-[var(--border-primary)] px-2 py-1 font-mono opacity-60" label={`展开 AssetRef（${nodeRun.outputRefs.length}）`} value={nodeRun.outputRefs} />}
                    </div>
                  </details>;
                })}</div>
                <h4 className="mb-2 mt-5 text-xs font-bold">事件时间线 <span className="font-normal text-[var(--text-secondary)]">已显示 {Math.min(runEventVisibleCount, runEvents.length)} / {runEvents.length}</span></h4><div className="max-h-64 overflow-auto border-l border-[var(--border-primary)] pl-3">{runEvents.slice(0, runEventVisibleCount).map((event) => <div key={event.id} className="relative mb-3 text-[10px]"><span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-[var(--accent-primary)]" /><div className="font-semibold">{event.type}</div><div className="opacity-55">{formatTime(event.createdAt)}{event.nodeRunId ? ` · ${event.nodeRunId.slice(0, 8)}` : ''}</div><LazyJsonDetails className="mt-1" label="展开事件载荷" value={event.payload} maxCharacters={32 * 1024} /></div>)}{runEventVisibleCount < runEvents.length && <button type="button" className="mb-3 h-8 rounded border border-[var(--border-primary)] px-3 text-[10px] font-bold" onClick={() => setRunEventVisibleCount((count) => Math.min(runEvents.length, count + 100))}>再显示 100 条</button>}</div>
              </> : <div className="grid min-h-80 place-items-center text-sm text-[var(--text-secondary)]">选择一次运行查看节点级详情</div>}</div>
            </section>
          )}

          {tab === 'assets' && <AssetCenter key={`${props.projectId}:${props.canvasId || ''}`} canvasId={props.canvasId} projectId={props.projectId} onInsertAsset={props.onInsertAsset} />}

          {tab === 'doctor' && (
            <section className="grid gap-5 lg:grid-cols-[1fr_320px]" data-testid="workflow-doctor">
              <div>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold">诊断结果</h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {issues.length ? `${issues.length} 项，其中 ${issues.filter((item) => item.severity === 'error').length} 个错误` : '未发现明确问题'}
                    </p>
                  </div>
                  <ShieldCheck size={24} className={issues.some((item) => item.severity === 'error') ? 'text-red-500' : 'text-green-500'} />
                </div>
                <div className="mb-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-[10px] leading-5 text-[var(--text-secondary)]" data-testid="workflow-doctor-context">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span><strong className="text-[var(--text-primary)]">{WORKFLOW_DOCTOR_RULE_COUNT}</strong> 条稳定规则</span>
                    <span>平台 {providerSettingsLoaded ? doctorProviders.length : '读取中'}</span>
                    <span>项目素材 {scopedDoctorRemoteContext.resolvedAssetCount}/{scopedDoctorRemoteContext.requestedAssetCount}</span>
                    <span>最近 Run {scopedDoctorRemoteContext.runs.length}</span>
                    <span>执行策略 {scopedDoctorRemoteContext.executionPolicy ? '已读取' : '未提供'}</span>
                    <span>递归依赖 {scopedDoctorRemoteContext.validation ? '已权威核验' : '未核验'}</span>
                    {scopedDoctorRemoteContext.loading && <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" />刷新上下文</span>}
                  </div>
                  {scopedDoctorRemoteContext.requestedAssetCount > 64 && <p className="text-amber-500">本轮只核验按 ID 排序后的前 64 个项目素材引用，其余不据此下结论。</p>}
                  {scopedDoctorRemoteContext.validationError && <p className="text-amber-500">{scopedDoctorRemoteContext.validationError}</p>}
                  {scopedDoctorRemoteContext.error && <p className="text-amber-500">{scopedDoctorRemoteContext.error}</p>}
                </div>
                {doctorEvidenceTarget && <div className="mb-3 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-[10px] leading-5" data-testid="run-evidence-diagnosis">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong>指定失败证据</strong><p className="break-all font-mono text-[9px] text-[var(--text-secondary)]">Run {workflowDisplayId(doctorEvidenceTarget.runId)} · NodeRun {workflowDisplayId(doctorEvidenceTarget.nodeRunId)} · Attempt {workflowDisplayId(doctorEvidenceTarget.attemptId)}</p></div><button type="button" className="shrink-0 text-[var(--accent-primary)]" onClick={() => setDoctorEvidenceTarget(null)}>清除目标</button></div>
                  {scopedDoctorRemoteContext.loading && <p className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><Loader2 size={11} className="animate-spin" />正在按三层身份读取持久化证据…</p>}
                  {scopedDoctorRemoteContext.runEvidenceError && <p className="text-amber-600">证据不足：{scopedDoctorRemoteContext.runEvidenceError}</p>}
                  {scopedDoctorRemoteContext.runEvidence && !scopedDoctorRemoteContext.runEvidence.evidenceComplete && <p className="text-amber-600">证据不完整，已禁止分类和修复：{scopedDoctorRemoteContext.runEvidence.evidenceReasons.join('、') || '返回被截断'}</p>}
                  {scopedDoctorRemoteContext.runEvidence?.evidenceComplete && <>
                    <p>结论 <strong>{scopedDoctorRemoteContext.runEvidence.diagnosis.outcome}</strong> · 分类 <strong>{scopedDoctorRemoteContext.runEvidence.diagnosis.primaryCategory || '无'}</strong> · 发现 {scopedDoctorRemoteContext.runEvidence.diagnosis.totalFindings} 项</p>
                    {scopedDoctorRemoteContext.runEvidence.diagnosis.findings.map((finding) => <div key={finding.id} className="mt-2 rounded border border-amber-500/40 bg-[var(--bg-secondary)] p-2"><div className="font-semibold">{finding.summary} · {finding.category}</div><div className="font-mono text-[9px] text-[var(--text-secondary)]">{finding.provider || 'unknown'} / {finding.model || 'unknown'} · {finding.error.kind || 'unknown'} · {finding.error.code || '无代码'} · HTTP {finding.error.httpStatus ?? '—'} · retryable {finding.error.retryable ? 'true' : 'false'}</div></div>)}
                  </>}
                </div>}
                <div className="space-y-1">
                  {issues.map((item) => (
                    <article key={item.id} className="flex items-start gap-3 border-b border-[var(--border-primary)] py-3" data-rule-id={item.ruleId}>
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.severity === 'error' ? 'bg-red-500' : item.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h4 className="mr-1 text-xs font-bold">{item.title}</h4>
                          <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px]">{item.ruleId}</code>
                          <span className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[9px]">{item.severity}</span>
                          <span className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[9px]">{item.fixability === 'automatic' ? '可自动修复' : item.fixability === 'manual' ? '需人工处理' : '不可自动修复'}</span>
                          <span className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[9px]">≥ v{item.applicableVersion.minAppVersion} · schema {item.applicableVersion.doctorSchema}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.detail}</p>
                        <p className="mt-1 truncate text-[9px] text-[var(--text-secondary)]">
                          位置 {item.location.scope}
                          {item.location.nodeId ? ` · node ${item.location.nodeId}` : ''}
                          {item.location.edgeId ? ` · edge ${item.location.edgeId}` : ''}
                          {item.location.entityId ? ` · ${item.location.entityId}` : ''}
                          {item.location.field ? ` · ${item.location.field}` : ''}
                        </p>
                        <details className="mt-1 text-[9px] text-[var(--text-secondary)]">
                          <summary className="cursor-pointer">稳定证据 · {item.evidence.code}</summary>
                          <dl className="mt-1 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-2 rounded bg-[var(--bg-secondary)] p-2">
                            {Object.entries(item.evidence.facts).map(([key, value]) => <div key={key} className="contents"><dt className="truncate font-mono opacity-60">{key}</dt><dd className="break-all">{workflowEvidenceText(value)}</dd></div>)}
                          </dl>
                        </details>
                        {item.nodeIds.length > 0 && <button type="button" className="mt-1 text-[10px] text-[var(--accent-primary)]" onClick={() => props.onFocusNode(item.targetNodeIds?.[0] || item.nodeIds[0])}>定位 {item.nodeIds[0]}</button>}
                      </div>
                      {item.patch && <button type="button" disabled={patchPreviewBusy || patchApplyBusy} className="h-8 shrink-0 rounded border border-[var(--border-primary)] px-3 text-[11px] font-bold disabled:cursor-wait disabled:opacity-50" onClick={() => void openPatchPreview(item.patch!)}>{patchPreviewBusy ? '校验中…' : '预览修复'}</button>}
                    </article>
                  ))}
                </div>
              </div>
              <aside className="border-l border-[var(--border-primary)] pl-4">
                <div className="mb-2 flex items-center gap-2"><WandSparkles size={16} /><h3 className="text-sm font-bold">Canvas Agent</h3></div>
                <p className="mb-2 text-xs leading-5 text-[var(--text-secondary)]">受控只读工具先检索项目子工作流，再生成结构化计划；生成不会直接修改画布。</p>
                <p className="mb-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-[9px] leading-4 text-[var(--text-secondary)]" data-testid="canvas-agent-ephemeral">临时会话：关闭工作台、离开医生页或切换项目/画布即清空。</p>
                <div className="mb-3 grid grid-cols-4 gap-1" data-testid="canvas-agent-stages">
                  {([['explain', '1 说明'], ['generate', '2 计划'], ['preview', '3 预览'], ['apply', '4 应用']] as const).map(([stage, label]) => <span key={stage} className={`rounded border px-1 py-1 text-center text-[9px] font-bold ${agentSession?.stage === stage ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]' : 'border-[var(--border-primary)] text-[var(--text-secondary)]'}`}>{label}</span>)}
                </div>
                {props.patchConflictMessage && <div role="alert" className="mb-3 rounded border border-red-500/60 bg-red-500/10 p-2 text-[10px] leading-5 text-red-500"><p>{props.patchConflictMessage}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={patchApplyBusy} className="h-8 rounded border border-red-500/60 px-2 font-bold disabled:opacity-50" onClick={() => void resolvePatchConflict('keep-local')}>{patchApplyBusy ? '处理中…' : '保留本地并合并保存'}</button><button type="button" disabled={patchApplyBusy} className="h-8 rounded border border-[var(--border-primary)] px-2 font-bold text-[var(--text-primary)] disabled:opacity-50" onClick={() => void resolvePatchConflict('use-authoritative')}>采用服务端版本</button></div></div>}
                <textarea value={agentPrompt} rows={5} maxLength={2000} className="w-full resize-none rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-xs" onChange={(event) => changeAgentPrompt(event.target.value)} />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" disabled={agentBusy || patchPreviewBusy || patchApplyBusy} className="h-9 rounded border border-[var(--border-primary)] text-[10px] font-bold disabled:cursor-wait disabled:opacity-50" onClick={explainAgentPrompt}>只解释</button>
                  <button type="button" disabled={agentBusy || patchPreviewBusy || patchApplyBusy || !props.canvasId} className="flex h-9 items-center justify-center gap-1 rounded bg-[var(--accent-primary)] text-[10px] font-bold text-white disabled:cursor-wait disabled:opacity-50" onClick={() => void generateAgentPlan()}>{agentBusy ? <Loader2 size={12} className="animate-spin" /> : <WandSparkles size={12} />}{agentBusy ? '读取 8 个工具…' : '生成方案'}</button>
                </div>
                {agentSession && <div className="mt-2 truncate font-mono text-[9px] text-[var(--text-secondary)]">{agentSession.id} · r{agentSession.baseRevision} · g{agentSession.generation}</div>}
                {agentAuthority && <p className="mt-2 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-[9px] leading-4 text-[var(--text-secondary)]">当前角色：{agentAuthority.advisoryOnly ? '仅建议' : '可预览并按权限应用画布 Patch'}；主机凭据：只显示是否配置，Agent 永远不能读取或修改。</p>}
                {agentExplanation && <div className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-[10px] leading-5"><div className="font-bold">{agentExplanation.title}</div><p className="text-[var(--text-secondary)]">{agentExplanation.summary}</p></div>}
                {agentToolTrace.length > 0 && <details className="mt-3 rounded border border-[var(--border-primary)] p-2 text-[9px]" open={agentBusy} data-testid="canvas-agent-tool-trace"><summary className="cursor-pointer font-bold">只读工具轨迹 · {agentToolTrace.filter((item) => item.status === 'succeeded').length}/8</summary><div className="mt-2 space-y-1">{agentToolTrace.map((item) => <div key={item.tool} className="flex gap-2"><code className="min-w-32">{item.tool}</code><span className={item.status === 'succeeded' ? 'text-green-500' : item.status === 'failed' ? 'text-red-500' : item.status === 'unavailable' ? 'text-amber-500' : 'text-[var(--text-secondary)]'}>{item.status === 'succeeded' ? '完成' : item.status === 'failed' ? '失败' : item.status === 'unavailable' ? '暂无证据' : '等待'}</span>{item.message && <span className="truncate text-[var(--text-secondary)]">{item.message}</span>}</div>)}</div></details>}
                {agentPlan && <div className="mt-3 rounded border border-[var(--border-primary)] p-2 text-[10px]" data-testid="canvas-agent-plan"><div className="flex items-center justify-between gap-2"><strong className="truncate">{agentPlan.title}</strong><span className={agentPlan.status === 'ready' ? 'text-green-500' : 'text-amber-500'}>{agentPlan.status === 'ready' ? '可入队' : agentPlan.status === 'ready-for-validation' ? '待模拟' : '已阻止'}</span></div><p className="mt-1 leading-4 text-[var(--text-secondary)]">{agentPlan.explanation}</p>{agentPlan.runEvidence && <p className="mt-2 break-all rounded bg-[var(--bg-secondary)] p-2 font-mono text-[8px] text-[var(--text-secondary)]">Run {workflowDisplayId(agentPlan.runEvidence.ref.runId)} · NodeRun {workflowDisplayId(agentPlan.runEvidence.ref.nodeRunId)} · Attempt {workflowDisplayId(agentPlan.runEvidence.ref.attemptId)} · {agentPlan.runEvidence.outcome} / {agentPlan.runEvidence.primaryCategory || 'none'} · complete {agentPlan.runEvidence.complete ? 'true' : 'false'}</p>}<div className="mt-2 space-y-1">{agentPlan.stages.map((stage) => <div key={stage.id} className="flex gap-2"><span className="min-w-14 font-mono">{stage.id}</span><span>{stage.status}</span><span className="truncate text-[var(--text-secondary)]">{stage.summary}</span></div>)}</div>{agentPlan.unresolved.map((item) => <p key={item} className="mt-1 text-amber-500">{item}</p>)}<div className="mt-2 truncate font-mono text-[8px] text-[var(--text-secondary)]">plan {agentPlan.digest.slice(0, 16)} · graph {agentPlan.graphDigest.slice(0, 12)}</div></div>}
                {agentError && <p role="alert" className="mt-3 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-[10px] leading-5 text-amber-600">{agentError}</p>}
                <div className="mt-3" data-testid="canvas-agent-patch-queue"><div className="mb-1 flex items-center justify-between text-[10px] font-bold"><span>Patch 队列</span><span>{agentPatchQueue.length}/1</span></div>{agentPatchQueue.map((item) => <article key={item.id} className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-[9px]"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><div className="truncate font-bold">{item.draft.title}</div><div className="text-[var(--text-secondary)]">r{item.baseRevision} · {item.draft.operations.length} 操作 · {item.status}</div></div><button type="button" disabled={patchPreviewBusy || patchApplyBusy || !['queued', 'failed', 'previewed'].includes(item.status)} className="h-8 rounded border border-[var(--border-primary)] px-2 font-bold disabled:opacity-40" onClick={() => void openPatchPreview(item.draft, item.id)}>{item.status === 'previewing' ? '预览中…' : '预览修改'}</button></div>{item.error && <p className="mt-1 text-amber-500">{item.error}</p>}</article>)}{!agentPatchQueue.length && <p className="rounded border border-dashed border-[var(--border-primary)] p-2 text-center text-[9px] text-[var(--text-secondary)]">生成并通过模拟后才会入队；这里没有直接应用按钮。</p>}</div>
                <div className="mt-5 border-t border-[var(--border-primary)] pt-4" data-testid="canvas-patch-history">
                  <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-bold">我的 Patch 记录</h4><button type="button" className="text-[10px] text-[var(--accent-primary)]" disabled={patchHistoryLoading} onClick={() => void loadPatchHistory()}>{patchHistoryLoading ? '读取中…' : '刷新'}</button></div>
                  <p className="mb-2 text-[9px] leading-4 text-[var(--text-secondary)]">Patch 以审计边界保存，不使用本地 Ctrl+Z 撤销；请从记录中执行个人撤回。</p>
                  <div className="max-h-48 space-y-2 overflow-auto">
                    {patchHistory.map((record) => <article key={record.patchId} className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-[10px]">
                      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="truncate font-bold">{record.summary}</div><div className="mt-1 text-[var(--text-secondary)]">r{record.baseRevision} → r{record.appliedRevision} · {record.operationCount} 操作 · {record.status === 'reverted' ? '已撤回' : '已应用'}</div><div className="mt-1 truncate text-[var(--text-secondary)]">{record.diagnosticsResolved.join('、') || '无诊断标记'} · {formatTime(record.createdAt)}</div></div>{record.canRevert && <button type="button" disabled={patchApplyBusy} className="h-7 shrink-0 rounded border border-[var(--border-primary)] px-2 font-bold disabled:opacity-50" onClick={() => void revertPatchRecord(record)}>撤回</button>}</div>
                    </article>)}
                    {!patchHistoryLoading && !patchHistory.length && <div className="py-3 text-center text-[10px] text-[var(--text-secondary)]">暂无已应用 Patch</div>}
                  </div>
                  {patchApplyError && !patchPreview && <p role="alert" className="mt-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-[10px] leading-5 text-amber-600">{patchApplyError}</p>}
                </div>
              </aside>
            </section>
          )}

          {tab === 'collaboration' && (
            <CollaborationHostPanel
              projectId={props.projectId}
              canvasId={props.canvasId}
              onAcceptRunIntent={props.onAcceptRunIntent}
            />
          )}
        </main>
      </aside>

      {subflowLibraryEdit && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-md border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 text-[var(--text-primary)]">
            <div className="flex items-center gap-3">
              <Tags size={19} className="text-[var(--accent-primary)]" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold">编辑 {subflowLibraryEdit.definition.name}</h3>
                <p className="text-xs text-[var(--text-secondary)]">基于 revision {subflowLibraryEdit.definition.revision || subflowLibraryEdit.definition.version}；保存后创建不可变新版本。</p>
              </div>
              <button type="button" className="grid h-8 w-8 place-items-center" onClick={() => setSubflowLibraryEdit(null)}><X size={16} /></button>
            </div>
            {subflowLibraryEdit.conflict && (
              <div role="alert" className="mt-4 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-[10px] leading-5 text-amber-600">
                服务器已到 v{subflowLibraryEdit.conflict.latestVersion} / revision {subflowLibraryEdit.conflict.revision}，当前分类和标签草稿仍保留。
                <button type="button" className="mt-2 h-8 w-full rounded border border-amber-500/60 font-bold" onClick={loadLatestSubflowLibraryConflict}>放弃草稿并载入最新版本</button>
              </div>
            )}
            <label className="mt-4 block text-xs font-semibold">分类<input value={subflowLibraryEdit.category} maxLength={60} className="mt-1 h-10 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3" onChange={(event) => setSubflowLibraryEdit((current) => current ? { ...current, category: event.target.value } : current)} /></label>
            <label className="mt-3 block text-xs font-semibold">标签<textarea value={subflowLibraryEdit.tags} rows={4} placeholder="用逗号分隔，最多 30 个" className="mt-1 w-full resize-none rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3" onChange={(event) => setSubflowLibraryEdit((current) => current ? { ...current, tags: event.target.value } : current)} /></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="h-9 rounded border border-[var(--border-primary)] px-4 text-xs font-bold" onClick={() => setSubflowLibraryEdit(null)}>取消</button><button type="button" className="h-9 rounded bg-[var(--accent-primary)] px-4 text-xs font-bold text-white" onClick={() => void saveSubflowLibraryMetadata()}>保存为新版本</button></div>
          </div>
        </div>
      )}

      {subflowUpgradeDraft && <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4"><div className="w-full max-w-lg rounded-md border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 text-[var(--text-primary)]"><div className="flex items-center gap-3"><History size={20} className="text-amber-500" /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">升级 {subflowUpgradeDraft.from.name}</h3><p className="text-xs text-[var(--text-secondary)]">v{subflowUpgradeDraft.from.version} → v{subflowUpgradeDraft.to.version} · {subflowUpgradeDraft.preview.upgradedNodeIds.length} 个画布实例</p></div><button type="button" className="grid h-8 w-8 place-items-center" onClick={() => setSubflowUpgradeDraft(null)}><X size={16} /></button></div><dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs"><dt className="text-[var(--text-secondary)]">删除端口</dt><dd className="text-right">{subflowUpgradeDraft.preview.removedPortIds.join('、') || '无'}</dd><dt className="text-[var(--text-secondary)]">契约变更端口</dt><dd className="text-right">{subflowUpgradeDraft.preview.changedPortIds.join('、') || '无'}</dd><dt className="text-[var(--text-secondary)]">删除/变更参数</dt><dd className="text-right">{[...subflowUpgradeDraft.preview.removedParameterIds, ...subflowUpgradeDraft.preview.changedParameterIds].join('、') || '无'}</dd><dt className="text-[var(--text-secondary)]">将丢弃的覆盖值</dt><dd className={`text-right font-bold ${subflowUpgradeDraft.preview.discardedOverrides.length ? 'text-amber-500' : 'text-green-500'}`}>{subflowUpgradeDraft.preview.discardedOverrides.length}</dd><dt className="text-[var(--text-secondary)]">将断开的连线</dt><dd className={`text-right font-bold ${subflowUpgradeDraft.preview.disconnectedEdges.length ? 'text-amber-500' : 'text-green-500'}`}>{subflowUpgradeDraft.preview.disconnectedEdges.length}</dd></dl>{subflowUpgradeDraft.preview.discardedOverrides.length > 0 && <div className="mt-3 max-h-28 overflow-auto rounded border border-amber-500/50 bg-amber-500/10 p-3 text-[10px]">{subflowUpgradeDraft.preview.discardedOverrides.map((item) => <div key={`${item.nodeId}:${item.parameterId}`} className="truncate py-1">{item.nodeId} · {item.parameterId} · {item.reason === 'removed' ? '参数已删除' : '值不符合新约束'}</div>)}</div>}{subflowUpgradeDraft.preview.disconnectedEdges.length > 0 && <div className="mt-3 max-h-36 overflow-auto rounded border border-amber-500/50 bg-amber-500/10 p-3 text-[10px]">{subflowUpgradeDraft.preview.disconnectedEdges.map((edge) => <div key={edge.id} className="truncate py-1">{edge.source}:{edge.sourceHandle || 'default'} → {edge.target}:{edge.targetHandle || 'default'}</div>)}</div>}<p className="mt-3 text-[10px] leading-5 text-[var(--text-secondary)]">升级只影响同项目、固定在旧版本的实例；其他版本不变。操作写入画布历史，可撤销恢复全部实例与连线。</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="h-9 rounded border border-[var(--border-primary)] px-4 text-xs font-bold" onClick={() => setSubflowUpgradeDraft(null)}>取消</button><button type="button" className="h-9 rounded bg-amber-500 px-4 text-xs font-bold text-black" onClick={() => { props.onUpgradeSubflowInstances(subflowUpgradeDraft.from, subflowUpgradeDraft.to); setSubflowUpgradeDraft(null); }}>确认升级{subflowUpgradeDraft.preview.disconnectedEdges.length ? '并断开' : ''}</button></div></div></div>}

      {patchPreview && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4" data-testid="canvas-patch-preview">
          <div className="w-full max-w-3xl rounded-md border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 text-[var(--text-primary)]">
            <div className="flex items-start gap-3">
              <WandSparkles size={20} className="mt-0.5 text-[var(--accent-primary)]" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold">{patchPreview.patch.summary}</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{patchPreview.draft.description}</p>
                <p className="mt-1 font-mono text-[9px] text-[var(--text-secondary)]">base r{patchPreview.patch.baseRevision} · current r{patchPreview.preview.currentRevision} · digest {patchPreview.preview.previewDigest.slice(0, 12)}</p>
              </div>
              <button type="button" disabled={patchPreviewBusy || patchApplyBusy} className="grid h-8 w-8 place-items-center disabled:cursor-wait disabled:opacity-40" onClick={() => {
                patchPreviewRequestRef.current += 1;
                setPatchPreview(null);
                setPatchApplyError('');
                setPatchApplyRetryable(false);
                setPatchRepreviewAllowed(false);
              }}><X size={16} /></button>
            </div>

            <div className="mt-4 grid gap-3 text-[10px] sm:grid-cols-2">
              <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                <div className="font-bold">受影响节点 · {patchPreview.preview.affectedNodeIds.length}</div>
                <div className="mt-1 break-all text-[var(--text-secondary)]">{patchPreview.preview.affectedNodeIds.map((id) => workflowDisplayId(id)).join('、') || '无'}</div>
              </div>
              <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3">
                <div className="font-bold">受影响连线 · {patchPreview.preview.affectedEdgeIds.length}</div>
                <div className="mt-1 break-all text-[var(--text-secondary)]">{patchPreview.preview.affectedEdgeIds.map((id) => workflowDisplayId(id)).join('、') || '无'}</div>
              </div>
            </div>
            <div className="mt-3 rounded border border-[var(--border-primary)] p-3 text-[10px]">
              <strong>预计解决：</strong>{patchPreview.patch.diagnosticsResolved.join('、') || '无诊断标记'}
            </div>

            <div className="my-4 max-h-[46vh] space-y-3 overflow-auto border-y border-[var(--border-primary)] py-3">
              {patchPreview.preview.changes.map((change) => (
                <article key={`${change.operationIndex}:${change.type}:${change.targetId}`} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2"><code>{change.type}</code><span>{change.targetType} · {workflowDisplayId(change.targetId)}</span><span className="text-[10px] text-[var(--text-secondary)]">{change.fields.join('、') || '实体状态'}</span></div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div><div className="mb-1 text-[9px] font-bold uppercase text-red-500">Before</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-red-500/5 p-2 text-[9px] leading-4">{canvasPatchDiffText(change.before)}</pre></div>
                    <div><div className="mb-1 text-[9px] font-bold uppercase text-green-500">After</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-green-500/5 p-2 text-[9px] leading-4">{canvasPatchDiffText(change.after)}</pre></div>
                  </div>
                </article>
              ))}
            </div>
            {patchPreview.preview.warnings?.map((warning) => <p key={warning} className="mb-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-[10px] text-amber-600">{warning}</p>)}
            {patchApplyError && <div role="alert" className="mb-3 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-xs leading-5 text-amber-600">{patchApplyError}{patchRepreviewAllowed && <button type="button" disabled={patchPreviewBusy || patchApplyBusy} className="mt-2 block h-8 rounded border border-amber-500/60 px-3 font-bold" onClick={() => void openPatchPreview(patchPreview.draft, patchPreview.queueItemId)}>同步并重新预览</button>}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={patchPreviewBusy || patchApplyBusy} className="h-9 rounded border border-[var(--border-primary)] px-4 text-xs font-bold disabled:cursor-wait disabled:opacity-40" onClick={() => {
                patchPreviewRequestRef.current += 1;
                setPatchPreview(null);
                setPatchApplyError('');
                setPatchApplyRetryable(false);
                setPatchRepreviewAllowed(false);
              }}>取消</button>
              <button type="button" disabled={patchApplyBusy || patchPreviewBusy || agentPreviewApplyBlocked || (Boolean(patchApplyError) && !patchApplyRetryable) || patchPreview.patch.requiresConfirmation !== true} className="h-9 rounded bg-[var(--accent-primary)] px-4 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-50" onClick={() => void confirmPatchPreview()}>{patchApplyBusy ? '原子应用中…' : patchApplyError && patchApplyRetryable ? '重试原子应用' : '确认并原子应用'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
