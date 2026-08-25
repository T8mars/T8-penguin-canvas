import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { localizeLegacyRuntimeText } from '../../i18n/legacyRuntimeText';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  Eraser,
  Film,
  ImagePlus,
  Library,
  Loader2,
  Lock,
  Maximize2,
  PackageOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  generateExternalImage,
  generateExternalLlm,
  generateExternalVideo,
  generateImage,
  generateLlm,
  queryImageFal,
  queryAudio,
  querySeedance,
  querySeedreamNz,
  submitAudio,
  submitImageFal,
  submitSeedance,
  submitSeedreamNz,
} from '../../services/generation';
import {
  IMAGE_MODELS,
  LLM_MODELS,
  ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS,
  ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL,
  ZHENZHEN_IMAGE_G2_I2I_MODEL,
  ZHENZHEN_IMAGE_G2_T2I_MODEL,
  gptImage2ZhenzhenVariantSize,
  isFalModel,
} from '../../providers/models';
import {
  SEEDANCE_NZ_LLM_MODELS,
} from '../../config/llm';
import { cancelVideoEditJob, composeVideoEditAsync, getVideoEditJob } from '../../services/videoOps';
import * as api from '../../services/api';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { useApiKeysStore } from '../../stores/apiKeys';
import { useCanvasStore } from '../../stores/canvas';
import { logBus } from '../../stores/logs';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import type { RunNodeLifecycleReporter } from '../../types/project';
import type { CanvasProviderSource } from '../../types/canvas';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import {
  buildDirectorStoryboardOutputItems,
  buildDirectorStoryboardOutputSummary,
  buildDirectorStoryboardRunPlan,
  runDirectorStoryboardJobs,
  type DirectorStoryboardJob,
} from '../../utils/directorStoryboard';
import { DEFAULT_VIDEO_EDIT_DATA, DEFAULT_VIDEO_EDIT_SETTINGS } from '../../utils/videoEdit';
import {
  STORY_ANALYSIS_SCHEMA,
  applyStoryAnalysis,
  buildStoryAssetGenerationSpec,
  buildLocalStoryAnalysis,
  compileStoryPrompts,
  createEmptyStoryProject,
  duplicateStoryShot,
  extractJsonObject,
  invalidateStoryForAssetChange,
  invalidateStoryForScriptChange,
  isStoryAssetTaskResumable,
  isStoryShotTaskResumable,
  limitStoryAssetTargets,
  limitStoryVideoTargets,
  mergeStoryShotWithNext,
  moveStoryShot,
  patchStoryShot,
  removeStoryShot,
  sanitizeStoryProject,
  selectStoryAssetTargets,
  selectStoryVideoTargets,
  splitStoryShot,
  storyAnalysisSystemPrompt,
  storyAnalysisUserPrompt,
  storyAssetKindLabel,
  storyProgress,
  storyStageLabel,
  storyToDirectorShots,
  storyToVideoEditClips,
  storyToVideoEditTimeline,
  type StoryAnalysisPayload,
  type StoryAsset,
  type StoryAssetKind,
  type StoryProject,
  type StoryRunMode,
  type StoryShot,
  type StoryStage,
} from '../../utils/storyProduction';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import LazyVideo from '../LazyVideo';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  externalImageSizeFor,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import {
  LEGACY_SEEDANCE_MODEL_OPTIONS,
  SEEDANCE_NZ_MODEL_OPTIONS,
  type SeedanceBuiltinSource,
} from '../../config/seedance';

const STORY_RUN_PURPOSE: Record<StoryRunMode, string> = {
  all: 'story-all',
  analyze: 'story-analyze',
  'asset-one': 'story-asset',
  'assets-missing': 'story-assets',
  compile: 'story-prompts',
  'videos-missing': 'story-videos',
  compose: 'story-compose',
  'retry-failed': 'story-retry',
};

const STAGE_ORDER: StoryStage[] = ['script', 'shots', 'assets', 'prompts', 'videos', 'compose'];
const ASSET_KIND_ORDER: StoryAssetKind[] = ['character', 'scene', 'prop', 'costume', 'audio'];
const ACTIVE_TASK_STATUSES = new Set(['submitting', 'running', 'polling']);
const POLL_TIMEOUT_MS = 60 * 60 * 1000;
const GPT_IMAGE_2_OPTIONS = IMAGE_MODELS.find((item) => item.id === 'gpt-image-2')?.apiModelOptions || [];
const LEGACY_GPT_IMAGE_2_MODELS = new Set(['gpt-image-2-all', 'gpt-image-2', 'gpt-image-2-2K', 'gpt-image-2-4K']);
const STORY_LEGACY_IMAGE_OPTIONS = [
  ...GPT_IMAGE_2_OPTIONS.filter((item) => item.value === 'gpt-image-2'),
  ...GPT_IMAGE_2_OPTIONS.filter((item) => item.value !== 'gpt-image-2' && LEGACY_GPT_IMAGE_2_MODELS.has(item.value)),
];
const STORY_BUDGET_IMAGE_OPTIONS = [
  ...ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS.filter((item) => item.value === ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL),
  ...ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS.filter((item) => item.value !== ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL),
];
const STORY_BUDGET_IMAGE_MODELS = new Set(STORY_BUDGET_IMAGE_OPTIONS.map((item) => item.value));
const STORY_RUN_LABEL: Record<StoryRunMode, string> = {
  all: '一键生产',
  analyze: '分析剧本',
  'asset-one': '生成资产',
  'assets-missing': '生成缺失资产',
  compile: '编译提示词',
  'videos-missing': '生成缺失视频',
  compose: '合成为片',
  'retry-failed': '重试失败任务',
};

type StoryProviderChoice = 'builtin' | `advanced:${string}`;
type StoryLlmPlatformChoice = 'builtin:zhenzhen' | 'builtin:seedance-nz' | `advanced:${string}`;
type StoryImagePlatformChoice = 'builtin:legacy' | 'builtin:seedance-nz' | 'builtin:fal' | `advanced:${string}`;

function advancedChoice(providerId: string): `advanced:${string}` {
  return `advanced:${providerId}`;
}

function providerIdFromChoice(value: string): string {
  return value.startsWith('advanced:') ? value.slice('advanced:'.length) : '';
}

function builtInImagePlatform(model: string): Exclude<StoryImagePlatformChoice, `advanced:${string}`> {
  if (STORY_BUDGET_IMAGE_MODELS.has(model as typeof STORY_BUDGET_IMAGE_OPTIONS[number]['value'])) return 'builtin:seedance-nz';
  if (isFalModel(model)) return 'builtin:fal';
  return 'builtin:legacy';
}

function builtInImageOptions(platform: StoryImagePlatformChoice) {
  if (platform === 'builtin:seedance-nz') return [...STORY_BUDGET_IMAGE_OPTIONS];
  if (platform === 'builtin:legacy') return [...STORY_LEGACY_IMAGE_OPTIONS];
  return GPT_IMAGE_2_OPTIONS.filter((item) => {
    return platform === 'builtin:fal' && isFalModel(item.value);
  });
}

function storyRunSubmissionError(raw: unknown): string {
  const detail = String(raw || '').trim();
  if (/恢复代次|sidecar.*持久化确认|freshness\s*ack/i.test(detail)) {
    return '后台在上次异常退出后尚未完成画布数据恢复确认。请完全退出并重新启动应用或开发服务后再试；本次没有调用模型，也不会产生费用。';
  }
  if (/无法创建持久化\s*Run|无法创建.*运行记录/i.test(detail)) {
    return `无法创建本次运行记录，已停止调用模型。${detail.replace(/^.*?：/, '').trim() || '请重新启动应用后再试。'}`;
  }
  return detail
    ? `Story 未能启动：${detail}`
    : 'Story 未能启动，请查看左下角 Logs；本次没有调用模型。';
}

function falImageSizeFor(ratio: string): string {
  if (ratio === '1:1') return 'square_hd';
  if (ratio === '9:16') return 'portrait_16_9';
  if (ratio === '3:4') return 'portrait_4_3';
  if (ratio === '4:3') return 'landscape_4_3';
  return 'landscape_16_9';
}

function storyAssetsReady(project: StoryProject): boolean {
  return project.assets.length > 0 && project.assets.every((asset) => Boolean(asset.url) && asset.status === 'succeeded');
}

function hasClearableAssetMedia(asset: StoryAsset): boolean {
  return Boolean(
    asset.url
    || asset.taskId
    || asset.taskProvider
    || asset.taskModel
    || asset.taskEndpoint
    || asset.taskClipIds.length
    || asset.error
    || asset.generatedAt
    || asset.source !== 'missing'
    || asset.status !== 'pending',
  );
}

interface StoryRunTaskBudget {
  limit: number;
  reserved: number;
}

interface StoryProductionRevisionGuard {
  expected: number;
  finalizeTail: Promise<void>;
}

interface StoryAssetRunSessionHandle {
  enqueue: (assetId: string) => boolean;
}

function parseStoryAnalysisPayload(content: string): StoryAnalysisPayload {
  const payload = extractJsonObject(content) as StoryAnalysisPayload;
  if (!payload || typeof payload !== 'object') throw new Error('模型没有返回 Story JSON 对象');
  if (!Array.isArray(payload.shots) || payload.shots.length === 0) throw new Error('模型返回的 Story JSON 没有镜头');
  payload.schema = STORY_ANALYSIS_SCHEMA;
  return payload;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('用户已停止'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new Error('用户已停止'));
    }, { once: true });
  });
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function statusLabel(status: string): string {
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'stale') return '需更新';
  if (ACTIVE_TASK_STATUSES.has(status)) return '进行中';
  if (status === 'cancelled') return '已停止';
  return '待处理';
}

function statusTone(status: string): string {
  if (status === 'succeeded') return 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200';
  if (status === 'failed') return 'border-rose-400/35 bg-rose-400/10 text-rose-200';
  if (status === 'stale') return 'border-amber-400/35 bg-amber-400/10 text-amber-200';
  if (ACTIVE_TASK_STATUSES.has(status)) return 'border-cyan-400/35 bg-cyan-400/10 text-cyan-200';
  return 'border-white/10 bg-white/[0.04] text-white/55';
}

function safeOutputFilename(value: string, extension: string): string {
  const base = String(value || 'story-output').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 96) || 'story-output';
  return `${base}.${extension}`;
}

function storyOutputText(project: StoryProject): string {
  const progress = storyProgress(project);
  return [
    `Story：${project.title}`,
    `分镜 ${project.shots.length} · 资产 ${progress.assets.completed}/${progress.assets.total} · 视频 ${progress.videos.completed}/${progress.videos.total}`,
    `剧本覆盖 ${project.coverage.percent}%`,
    project.finalVideoUrl ? `成片 ${project.finalVideoUrl}` : '',
  ].filter(Boolean).join('\n');
}

function downloadJson(project: StoryProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.title || 'story'}.t8-story.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const StoryNode = ({ id, data, selected }: NodeProps) => {
  const { t, i18n } = useTranslation('nodes');
  const storyT = (key: string, options?: Record<string, unknown>) => t(`story.editor.${key}`, options);
  const storyRuntimeText = (value: unknown) => localizeLegacyRuntimeText('story', i18n.resolvedLanguage || i18n.language, value);
  const stageLabel = (stage: StoryStage) => storyT(`stages.${stage}`, { defaultValue: storyStageLabel(stage) });
  const assetKindLabel = (kind: StoryAssetKind) => storyT(`assetKinds.${kind}`, { defaultValue: storyAssetKindLabel(kind) });
  const runLabel = (mode: StoryRunMode) => storyT(`runLabels.${mode}`, { defaultValue: STORY_RUN_LABEL[mode] });
  const displayStatus = (status: string) => storyT(`statuses.${status}`, { defaultValue: statusLabel(status) });
  const updateNode = useUpdateNodeData(id);
  const rf = useReactFlow();
  const upstream = useUpstreamMaterials(id);
  const activeCanvasId = useCanvasStore((state) => state.activeId);
  const hasDomesticKey = useApiKeysStore((state) => Boolean(String(state.settings.zhenzhenSd2ApiKey || '').trim()));
  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [activeStage, setActiveStage] = useState<StoryStage>('script');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compactSettingsOpen, setCompactSettingsOpen] = useState(false);
  const [resourcePickerAssetId, setResourcePickerAssetId] = useState('');
  const [resourceQuery, setResourceQuery] = useState('');
  const [resourceItems, setResourceItems] = useState<api.ResourceItem[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceMessage, setResourceMessage] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [runRequestPending, setRunRequestPending] = useState(false);
  const [assetRunActive, setAssetRunActive] = useState(false);
  const [generatingAssetIds, setGeneratingAssetIds] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const runRequestPendingRef = useRef(false);
  const composeJobIdRef = useRef('');
  const assetRunSessionRef = useRef<StoryAssetRunSessionHandle | null>(null);
  const assetRunRequestPendingRef = useRef(false);
  const pendingAssetRunIdsRef = useRef(new Set<string>());
  const initialProject = useMemo(() => sanitizeStoryProject((data as any)?.storyProject || createEmptyStoryProject({ storyId: `story-${id}` })), [data, id]);
  const projectRef = useRef<StoryProject>(initialProject);
  projectRef.current = initialProject;
  const project = initialProject;
  const progress = storyProgress(project);
  const src = `story:${id.slice(-6)}`;
  const llmProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'llm'), [advancedProviders]);
  const imageProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'image'), [advancedProviders]);
  const videoProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'video'), [advancedProviders]);
  const llmSelection = useMemo(() => resolveAdvancedProviderSelection(advancedProviders, 'llm', {
    providerSource: project.settings.llmProviderSource,
    providerId: project.settings.llmProviderId,
    providerModel: project.settings.llmProviderModel,
  }), [advancedProviders, project.settings.llmProviderId, project.settings.llmProviderModel, project.settings.llmProviderSource]);
  const imageSelection = useMemo(() => resolveAdvancedProviderSelection(advancedProviders, 'image', {
    providerSource: project.settings.imageProviderSource,
    providerId: project.settings.imageProviderId,
    providerModel: project.settings.imageProviderModel,
  }), [advancedProviders, project.settings.imageProviderId, project.settings.imageProviderModel, project.settings.imageProviderSource]);
  const videoSelection = useMemo(() => resolveAdvancedProviderSelection(advancedProviders, 'video', {
    providerSource: project.settings.videoProviderSource,
    providerId: project.settings.videoProviderId,
    providerModel: project.settings.videoProviderModel,
  }), [advancedProviders, project.settings.videoProviderId, project.settings.videoProviderModel, project.settings.videoProviderSource]);
  const llmChoice: StoryLlmPlatformChoice = llmSelection.available
    ? advancedChoice(llmSelection.providerId)
    : project.settings.llmApiSource === 'seedance-nz' ? 'builtin:seedance-nz' : 'builtin:zhenzhen';
  const imageChoice: StoryImagePlatformChoice = imageSelection.available
    ? advancedChoice(imageSelection.providerId)
    : builtInImagePlatform(project.settings.imageModel);
  const videoChoice: StoryProviderChoice = videoSelection.available ? advancedChoice(videoSelection.providerId) : 'builtin';
  const effectiveVideoBuiltinSource: Exclude<SeedanceBuiltinSource, 'auto'> = project.settings.videoApiSource === 'auto'
    ? (hasDomesticKey ? 'seedance-nz' : 'zhenzhen-legacy')
    : project.settings.videoApiSource;
  const effectiveVideoModel = videoSelection.available
    ? videoSelection.providerModel
    : effectiveVideoBuiltinSource === 'seedance-nz'
      ? project.settings.videoNzModel
      : project.settings.videoModel;

  const commit = useCallback((nextInput: StoryProject, extra: Record<string, unknown> = {}) => {
    const next = sanitizeStoryProject(nextInput);
    projectRef.current = next;
    updateNode({
      storyProject: next,
      storyId: next.storyId,
      storyRevision: next.storyRevision,
      productionRevision: next.productionRevision,
      outputText: storyOutputText(next),
      videoUrl: next.finalVideoUrl,
      videoUrls: next.finalVideoUrl ? [next.finalVideoUrl] : [],
      status: next.lastError ? 'error' : next.finalVideoUrl ? 'success' : next.shots.length ? 'ready' : 'idle',
      error: next.lastError || '',
      ...extra,
    });
    return next;
  }, [updateNode]);

  const mutate = useCallback((transform: (current: StoryProject) => StoryProject, extra: Record<string, unknown> = {}) => {
    return commit(transform(projectRef.current), extra);
  }, [commit]);

  useEffect(() => {
    if ((data as any)?.storyProject) return;
    commit(project);
  }, [commit, data, project]);

  useEffect(() => {
    if (!selectedShotId && project.shots[0]) setSelectedShotId(project.shots[0].id);
    if (selectedShotId && !project.shots.some((shot) => shot.id === selectedShotId)) setSelectedShotId(project.shots[0]?.id || '');
  }, [project.shots, selectedShotId]);

  useEffect(() => {
    if (!selectedAssetId && project.assets[0]) setSelectedAssetId(project.assets[0].id);
    if (selectedAssetId && !project.assets.some((asset) => asset.id === selectedAssetId)) setSelectedAssetId(project.assets[0]?.id || '');
  }, [project.assets, selectedAssetId]);

  useEffect(() => {
    if (!resourcePickerAssetId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setResourceLoading(true);
        setResourceMessage('');
        const result = await api.getResourceItems({ kind: 'image', q: resourceQuery.trim() });
        if (cancelled) return;
        if (result.success) {
          setResourceItems((result.data || []).filter((item) => Boolean(item.fileUrl)));
        } else {
          setResourceItems([]);
          setResourceMessage(result.error || '资产库读取失败');
        }
        setResourceLoading(false);
      })();
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resourcePickerAssetId, resourceQuery]);

  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) || project.shots[0];
  const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId) || project.assets[0];
  const selectedAssetGenerationSpec = useMemo(
    () => selectedAsset ? buildStoryAssetGenerationSpec(project, selectedAsset) : null,
    [project, selectedAsset],
  );
  const selectedAssetReferenceNames = selectedAssetGenerationSpec?.referenceAssetIds
    .map((assetId) => project.assets.find((asset) => asset.id === assetId)?.name)
    .filter(Boolean)
    .join('、') || '';
  const busy = runRequestPending || Boolean(abortRef.current) || ACTIVE_TASK_STATUSES.has(String((data as any)?.status || ''));

  const setProjectPatch = useCallback((patch: Partial<StoryProject>) => {
    mutate((current) => ({ ...current, ...patch, storyRevision: current.storyRevision + 1, updatedAt: new Date().toISOString() }));
  }, [mutate]);

  const updateSettings = useCallback((patch: Partial<StoryProject['settings']>) => {
    mutate((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
      storyRevision: current.storyRevision + 1,
      productionRevision: current.productionRevision + 1,
      finalVideoUrl: '',
      composeTaskId: '',
      composeTaskStatus: 'idle',
      updatedAt: new Date().toISOString(),
    }));
  }, [mutate]);

  const requestRun = useCallback((mode: StoryRunMode, targetId = '') => {
    if (busy || runRequestPendingRef.current) return false;
    if (mode === 'asset-one' || mode === 'assets-missing') setActiveStage('assets');
    if (mode === 'compile') setActiveStage('prompts');
    if (mode === 'videos-missing') setActiveStage('videos');
    if (mode === 'compose') setActiveStage('compose');
    const requestId = createCanvasNodeRunRequestId(id, STORY_RUN_PURPOSE[mode]);
    const assetTarget = mode === 'asset-one' ? projectRef.current.assets.find((asset) => asset.id === targetId) : null;
    const usesLlm = mode === 'analyze' || (mode === 'all' && projectRef.current.shots.length === 0);
    const usesImage = !usesLlm && (mode === 'assets-missing' || mode === 'asset-one' && assetTarget?.kind !== 'audio' || mode === 'all' && projectRef.current.assets.some((asset) => !asset.url));
    const selection = usesLlm ? llmSelection : usesImage ? imageSelection : videoSelection;
    const storySettings = projectRef.current.settings;
    const builtinModel = usesLlm
      ? storySettings.llmApiSource === 'seedance-nz' ? storySettings.llmNzModel : storySettings.llmModel
      : usesImage ? storySettings.imageModel : effectiveVideoModel;
    const clearPendingRequest = () => {
      runRequestPendingRef.current = false;
      setRunRequestPending(false);
    };
    const rejectRequest = (reason: unknown) => {
      const message = storyRunSubmissionError(reason);
      clearPendingRequest();
      setLocalMessage(message);
      mutate((current) => ({
        ...current,
        lastError: message,
        updatedAt: new Date().toISOString(),
      }), { status: 'error', error: message });
      updateNode({
        storyRunRequestId: '',
        storyRunTargetId: '',
        storyRunMode: 'all',
      });
    };
    runRequestPendingRef.current = true;
    setRunRequestPending(true);
    setLocalMessage(`${STORY_RUN_LABEL[mode]}请求正在提交…`);
    updateNode({
      storyRunMode: mode,
      storyRunTargetId: targetId,
      storyRunRequestId: requestId,
      providerSource: selection.available
        ? selection.providerSource
        : usesLlm ? storySettings.llmApiSource : 'zhenzhen',
      providerId: selection.available ? selection.providerId : '',
      providerModel: selection.available ? selection.providerModel : builtinModel,
      llmApiSource: usesLlm ? storySettings.llmApiSource : undefined,
    });
    window.requestAnimationFrame(() => {
      if (requestCanvasNodeRun(id, {
        requestId,
        onSettled: (outcome) => {
          if (outcome.accepted) {
            clearPendingRequest();
            return;
          }
          rejectRequest(outcome.error);
        },
      })) return;
      rejectRequest('无法派发 Story 运行请求，请重试。');
    });
    return true;
  }, [busy, effectiveVideoModel, id, imageSelection, llmSelection, mutate, updateNode, videoSelection]);

  const enterAssetReview = useCallback(() => {
    if (busy || projectRef.current.shots.length === 0) return;
    setActiveStage('assets');
    mutate((current) => ({
      ...current,
      stage: 'assets',
      lastError: '',
      updatedAt: new Date().toISOString(),
    }), { status: 'ready', error: '' });
    setLocalMessage('已进入准备资产；可先电脑上传、绑定上游或资产库，再手动生成仍缺失的资产。');
  }, [busy, mutate]);

  const stopRun = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const jobId = composeJobIdRef.current || projectRef.current.composeTaskId;
    composeJobIdRef.current = '';
    if (jobId) await cancelVideoEditJob(jobId).catch(() => undefined);
    mutate((current) => ({ ...current, composeTaskStatus: current.stage === 'compose' ? 'cancelled' : current.composeTaskStatus, lastError: '用户已停止', updatedAt: new Date().toISOString() }), { status: 'cancelled' });
  }, [mutate]);

  const ensureScript = useCallback((): StoryProject => {
    const current = projectRef.current;
    const upstreamText = upstream.texts.map((item) => item.url).filter(Boolean).join('\n\n').trim();
    if (!current.script && upstreamText) return commit(invalidateStoryForScriptChange(current, upstreamText));
    if (!current.script.trim()) throw new Error('请先粘贴剧本，或连接一个文本节点');
    return current;
  }, [commit, upstream.texts]);

  const analyze = useCallback(async (reporter: RunNodeLifecycleReporter, signal: AbortSignal) => {
    let current = ensureScript();
    if (signal.aborted) throw new Error('用户已停止');
    setLocalMessage('正在理解剧本并规划镜头…');
    mutate((value) => ({ ...value, stage: 'script', lastError: '', updatedAt: new Date().toISOString() }), { status: 'running' });
    let payload: StoryAnalysisPayload;
    let source: StoryProject['analysisSource'] = 'llm';
    const external = llmSelection.available ? llmSelection : null;
    const builtinSource = current.settings.llmApiSource;
    const provider = external?.providerSource || builtinSource;
    const model = external?.providerModel || (
      builtinSource === 'seedance-nz'
        ? current.settings.llmNzModel
        : current.settings.llmModel
    );
    const runLlm = (messages: Array<{ role: 'system' | 'user'; content: string }>, temperature: number) => external
      ? generateExternalLlm({
        providerId: external.providerId,
        providerModel: external.providerModel,
        model: external.providerModel,
        temperature,
        max_tokens: 32768,
        messages,
      }, { submissionKey: reporter.providerSubmissionKey })
      : generateLlm({ source: builtinSource, model, temperature, max_tokens: 32768, messages }, { submissionKey: reporter.providerSubmissionKey });
    try {
      await reporter.providerRequest({ provider, model, jobKind: 'story-analysis' });
      const result = await runLlm([
          { role: 'system', content: storyAnalysisSystemPrompt() },
          { role: 'user', content: storyAnalysisUserPrompt(current.script, current.settings) },
        ], 0.2);
      await reporter.providerResponse({
        provider, model, requestId: result.requestId,
        transportHttpStatus: result.transportHttpStatus,
        usage: result.usage, status: 'succeeded', jobKind: 'story-analysis', httpStatusSource: 'local-backend',
      });
      try {
        payload = parseStoryAnalysisPayload(result.content);
      } catch (parseError: any) {
        await reporter.providerRequest({ provider, model, jobKind: 'story-analysis-repair', repairOf: 'story-analysis' });
        const repaired = await runLlm([
            { role: 'system', content: `${storyAnalysisSystemPrompt()}\n这是一次且仅一次的格式修复：保持原有事实和镜头，不得删减剧本覆盖，只修成合法 JSON。` },
            { role: 'user', content: JSON.stringify({ parseError: parseError?.message || 'JSON 无效', invalidResponse: String(result.content || '').slice(0, 60_000) }) },
          ], 0);
        await reporter.providerResponse({
          provider, model, requestId: repaired.requestId,
          transportHttpStatus: repaired.transportHttpStatus, usage: repaired.usage,
          status: 'succeeded', jobKind: 'story-analysis-repair', httpStatusSource: 'local-backend',
        });
        payload = parseStoryAnalysisPayload(repaired.content);
      }
    } catch (error: any) {
      await reporter.providerResponse({ provider, model, status: 'failed', error: { message: error?.message || '剧本分析失败' }, jobKind: 'story-analysis', httpStatusSource: 'local-backend' }).catch(() => undefined);
      payload = buildLocalStoryAnalysis(current.script, current.settings);
      source = 'local-fallback';
      logBus.warn(`Story LLM 分析不可用，已使用可解释的本地分段：${error?.message || '未知错误'}`, src);
    }
    if (signal.aborted) throw new Error('用户已停止');
    current = commit(applyStoryAnalysis(projectRef.current, payload, source), { status: 'ready' });
    setActiveStage('shots');
    setLocalMessage(source === 'llm' ? '分镜和资产已规划，可继续微调' : '已使用本地分段完成基础规划，请检查资产识别');
    return current;
  }, [commit, ensureScript, llmSelection, mutate, src]);

  const updateAsset = useCallback((assetId: string, patch: Partial<StoryAsset>, invalidate = false) => {
    mutate((current) => {
      const base = invalidate ? invalidateStoryForAssetChange(current, assetId) : current;
      return {
        ...base,
        assets: base.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch, revision: asset.revision + 1 } : asset),
        stage: 'assets',
        updatedAt: new Date().toISOString(),
      };
    });
  }, [mutate]);

  const generateAsset = useCallback(async (
    assetId: string,
    reporter: RunNodeLifecycleReporter,
    signal: AbortSignal,
    revisionGuard: StoryProductionRevisionGuard,
    replaceExisting = false,
  ) => {
    const asset = projectRef.current.assets.find((item) => item.id === assetId);
    if (!asset || asset.locked || asset.url && !replaceExisting) return;
    const originalUrl = asset.url;
    const generationSpec = buildStoryAssetGenerationSpec(projectRef.current, asset);
    const referenceImages = generationSpec.referenceImages;
    const imageAspectRatio = generationSpec.aspectRatio;
    const external = asset.kind !== 'audio' && imageSelection.available ? imageSelection : null;
    const configuredImageModel = external?.providerModel || projectRef.current.settings.imageModel;
    const configuredModelWithReferences = !external && configuredImageModel === ZHENZHEN_IMAGE_G2_T2I_MODEL && referenceImages.length
      ? ZHENZHEN_IMAGE_G2_I2I_MODEL
      : configuredImageModel;
    if (
      !external
      && asset.kind !== 'audio'
      && STORY_BUDGET_IMAGE_MODELS.has(configuredModelWithReferences as typeof STORY_BUDGET_IMAGE_OPTIONS[number]['value'])
      && !hasDomesticKey
    ) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
    if (!external && asset.kind !== 'audio' && configuredModelWithReferences === ZHENZHEN_IMAGE_G2_I2I_MODEL && !referenceImages.length) {
      throw new Error('G-2 图生图需要参考图；请先生成或绑定角色参考图，或改用 G-2 文生图/其他文生图模型');
    }
    const resumable = !replaceExisting && isStoryAssetTaskResumable(asset);
    const model = resumable && asset.taskModel ? asset.taskModel : asset.kind === 'audio' ? 'suno-v5.5' : configuredModelWithReferences;
    const provider = resumable
      ? asset.taskProvider
      : asset.kind === 'audio'
        ? 'suno'
        : external?.providerSource || (STORY_BUDGET_IMAGE_MODELS.has(model as typeof STORY_BUDGET_IMAGE_OPTIONS[number]['value']) ? 'seedance-nz' : isFalModel(model) ? 'fal' : 'zhenzhen');
    updateAsset(assetId, {
      status: resumable ? 'polling' : 'submitting',
      error: '',
      ...(resumable ? {} : { taskId: '', taskProvider: '', taskModel: '', taskEndpoint: '', taskClipIds: [] }),
    });
    await reporter.providerRequest({ provider, model, jobId: assetId, jobKind: asset.kind === 'audio' ? 'story-audio-asset' : 'story-asset', resumed: resumable });
    let url = '';
    let taskId = resumable ? asset.taskId : '';
    let taskProvider = resumable ? asset.taskProvider : provider;
    let taskModel = resumable ? asset.taskModel : model;
    let taskEndpoint = resumable ? asset.taskEndpoint : '';
    let taskClipIds = resumable ? asset.taskClipIds : [];
    if (asset.kind === 'audio') {
      if (resumable) {
        await reporter.providerSubmitted({ provider: taskProvider, model, upstreamTaskId: taskId, jobId: assetId, jobKind: 'story-audio-asset', resumed: true, httpStatusSource: 'local-backend' });
      } else {
        const submitted = await submitAudio(
          { mode: 'generate', prompt: generationSpec.prompt, title: asset.name, version: 'v5.5' },
          { submissionKey: reporter.providerSubmissionKey },
        );
        taskId = submitted.taskId;
        taskProvider = 'suno';
        taskClipIds = submitted.clipIds?.length ? submitted.clipIds : taskId ? [taskId] : [];
        if (!taskId || !taskClipIds.length) throw new Error(`${asset.name} 未返回音频任务 ID`);
        await reporter.providerSubmitted({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: submitted.requestId, transportHttpStatus: submitted.transportHttpStatus, upstreamHttpStatus: submitted.upstreamHttpStatus, usage: submitted.usage, jobId: assetId, jobKind: 'story-audio-asset', httpStatusSource: 'local-backend' });
      }
      updateAsset(assetId, { status: 'polling', taskId, taskProvider, taskModel, taskEndpoint: '', taskClipIds });
      const startedAt = Date.now();
      let pollCount = 0;
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await sleep(5000, signal);
        pollCount += 1;
        const result = await queryAudio(taskClipIds, true);
        await reporter.polling({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: result.status, progress: `${result.completed}/${result.total}`, jobId: assetId, jobKind: 'story-audio-asset', httpStatusSource: 'local-backend' });
        const status = String(result.status || '').toUpperCase();
        if (status === 'MATERIALIZING') {
          if (pollCount === 1 || pollCount % 10 === 0) {
            logBus.warn(
              result.error || `${asset.name} 音频已经生成，正在适配 TUN/代理网络并安全下载；不会重复提交任务`,
              `story:${id.slice(0, 6)}`,
            );
          }
          continue;
        }
        if (status === 'SUCCESS' && result.tracks[0]?.audioUrl) {
          url = result.tracks[0].audioUrl;
          await reporter.providerResponse({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: 'succeeded', jobId: assetId, jobKind: 'story-audio-asset', httpStatusSource: 'local-backend' });
          break;
        }
        if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) throw new Error(`${asset.name} 音频生成失败`);
      }
    } else if (external) {
      const result = await generateExternalImage({
        providerId: external.providerId,
        providerModel: external.providerModel,
        model: external.providerModel,
        prompt: generationSpec.prompt,
        negativePrompt: generationSpec.negativePrompt,
        images: referenceImages,
        size: externalImageSizeFor(imageAspectRatio, '2K'),
        n: 1,
      }, { submissionKey: reporter.providerSubmissionKey });
      url = String(result.imageUrls?.[0] || '');
      taskId = String(result.taskId || '');
      taskProvider = external.providerSource;
      taskModel = external.providerModel;
      if (!url) throw new Error(`${asset.name} 未返回图片`);
      if (taskId || result.requestId) await reporter.providerSubmitted({ provider: taskProvider, model: taskModel, upstreamTaskId: taskId || undefined, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
      await reporter.providerResponse({ provider: taskProvider, model: taskModel, upstreamTaskId: taskId || undefined, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, status: 'succeeded', jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
    } else if (STORY_BUDGET_IMAGE_MODELS.has(model as typeof STORY_BUDGET_IMAGE_OPTIONS[number]['value'])) {
      if (resumable) {
        await reporter.providerSubmitted({ provider: taskProvider, model, upstreamTaskId: taskId, jobId: assetId, jobKind: 'story-asset', resumed: true, httpStatusSource: 'local-backend' });
      } else {
        const isLowpriceModel = model === ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL;
        const submitted = await submitSeedreamNz({
          prompt: generationSpec.prompt,
          images: referenceImages,
          model: model as typeof STORY_BUDGET_IMAGE_OPTIONS[number]['value'],
          resolution: isLowpriceModel ? '2k' : '1k',
          ratio: isLowpriceModel ? undefined : imageAspectRatio as any,
          size: isLowpriceModel ? imageAspectRatio : undefined,
          n: isLowpriceModel ? 1 : undefined,
        }, { submissionKey: reporter.providerSubmissionKey });
        taskId = String(submitted.taskId || '');
        taskProvider = 'seedance-nz';
        if (!taskId) throw new Error(`${asset.name} 未返回图像任务 ID`);
        await reporter.providerSubmitted({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: submitted.requestId, transportHttpStatus: submitted.transportHttpStatus, upstreamHttpStatus: submitted.upstreamHttpStatus, usage: submitted.usage, jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
      }
      updateAsset(assetId, { status: 'polling', taskId, taskProvider, taskModel: model, taskEndpoint: '', taskClipIds: [] });
      const startedAt = Date.now();
      let pollCount = 0;
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await sleep(3000, signal);
        pollCount += 1;
        const result = await querySeedreamNz(taskId);
        await reporter.polling({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: result.status, progress: result.progress, jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
        const status = String(result.status || '').toLowerCase();
        if (status === 'materializing') {
          if (pollCount === 1 || pollCount % 10 === 0) {
            logBus.warn(
              result.error || `${asset.name} 已经生成，正在适配 TUN/代理网络并安全下载；不会重复提交任务`,
              `story:${id.slice(0, 6)}`,
            );
          }
          continue;
        }
        if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
          url = String(result.urls?.[0] || '');
          if (!url) throw new Error(`${asset.name} 已完成但没有图片`);
          await reporter.providerResponse({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: 'succeeded', jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
          break;
        }
        if (['failed', 'error', 'cancelled'].includes(status)) throw new Error(result.error || `${asset.name} 生成失败`);
      }
    } else if (isFalModel(model)) {
      if (resumable) {
        await reporter.providerSubmitted({ provider: taskProvider, model, upstreamTaskId: taskId, jobId: assetId, jobKind: 'story-asset', resumed: true, httpStatusSource: 'local-backend' });
      } else {
        const submitted = await submitImageFal({
          apiModel: model,
          prompt: generationSpec.prompt,
          images: referenceImages,
          n: 1,
          format: 'png',
          sync: false,
          mode: referenceImages.length ? 'edit' : 'gen',
          size: falImageSizeFor(imageAspectRatio),
          quality: 'medium',
        }, { submissionKey: reporter.providerSubmissionKey });
        url = String(submitted.urls?.[0] || '');
        taskId = String(submitted.requestId || '');
        taskEndpoint = String(submitted.endpoint || '');
        taskProvider = 'fal';
        taskModel = model;
        if (!url && (!taskId || !taskEndpoint)) throw new Error(`${asset.name} 未返回 FAL 任务信息`);
        await reporter.providerSubmitted({ provider: taskProvider, model, upstreamTaskId: taskId || undefined, requestId: submitted.requestId, transportHttpStatus: submitted.transportHttpStatus, upstreamHttpStatus: submitted.upstreamHttpStatus, usage: submitted.usage, jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
      }
      if (!url) {
        updateAsset(assetId, { status: 'polling', taskId, taskProvider, taskModel, taskEndpoint, taskClipIds: [] });
        const startedAt = Date.now();
        let pollCount = 0;
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await sleep(3000, signal);
          pollCount += 1;
          const result = await queryImageFal({ endpoint: taskEndpoint, requestId: taskId });
          await reporter.polling({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: result.status, jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
          const status = String(result.status || '').toLowerCase();
          if (status === 'materializing') {
            if (pollCount === 1 || pollCount % 10 === 0) {
              logBus.warn(
                result.error || `${asset.name} 已经生成，正在适配 TUN/代理网络并安全下载；不会重复提交任务`,
                `story:${id.slice(0, 6)}`,
              );
            }
            continue;
          }
          if (status === 'completed') {
            url = String(result.urls?.[0] || '');
            if (!url) throw new Error(`${asset.name} 已完成但没有图片`);
            await reporter.providerResponse({ provider: taskProvider, model, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: 'succeeded', jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
            break;
          }
          if (status === 'failed') throw new Error(result.error || `${asset.name} 生成失败`);
        }
      }
    } else {
      const result = await generateImage({
        model: 'gpt-image-2',
        apiModel: model,
        paramKind: 'gpt-size',
        prompt: generationSpec.prompt,
        images: referenceImages,
        n: 1,
        aspect_ratio: imageAspectRatio,
        image_size: gptImage2ZhenzhenVariantSize(model) || '2K',
      }, { submissionKey: reporter.providerSubmissionKey });
      url = String(result.urls?.[0] || '');
      if (!url) throw new Error(`${asset.name} 未返回图片`);
      await reporter.providerResponse({ provider: 'zhenzhen', model, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, status: 'succeeded', jobId: assetId, jobKind: 'story-asset', httpStatusSource: 'local-backend' });
    }
    if (!url) throw new Error(`${asset.name} 生成超时`);
    const assetChangedDuringGeneration = (latest: StoryAsset | undefined) => (
      replaceExisting ? !latest || latest.url !== originalUrl : Boolean(latest?.url)
    );
    const preserveChangedAsset = (latest: StoryAsset | undefined) => {
      const sourceLabel = latest?.source === 'upload'
        ? '电脑上传'
        : latest?.source === 'existing'
          ? '绑定'
          : '已有';
      logBus.info(`${asset.name} 的素材已在生成期间发生变化，AI 返回结果未覆盖当前${sourceLabel}素材`, src);
    };
    const previousFinalize = revisionGuard.finalizeTail;
    let releaseFinalize: () => void = () => undefined;
    revisionGuard.finalizeTail = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    await previousFinalize;
    try {
      const latestAsset = projectRef.current.assets.find((item) => item.id === assetId);
      if (assetChangedDuringGeneration(latestAsset)) {
        preserveChangedAsset(latestAsset);
        return;
      }
      if (projectRef.current.productionRevision !== revisionGuard.expected) {
        updateAsset(assetId, { status: 'stale', error: '生产修订已变化，迟到结果未覆盖当前资产' });
        return;
      }
      const outputRevision = replaceExisting ? revisionGuard.expected + 1 : revisionGuard.expected;
      await reporter.output({
        status: 'partial',
        outputCount: 1,
        assets: [{
          kind: asset.kind === 'audio' ? 'audio' : 'image',
          sourceUrl: url,
          filename: safeOutputFilename(asset.name, asset.kind === 'audio' ? 'mp3' : 'png'),
          mimeType: asset.kind === 'audio' ? 'audio/mpeg' : 'image/png',
          metadata: {
            storyId: projectRef.current.storyId,
            storyAssetId: asset.id,
            storyAssetKind: asset.kind,
            productionRevision: outputRevision,
          },
        }],
      }).catch((error) => logBus.warn(`Story 资产已生成，但资产中心登记失败：${error instanceof Error ? error.message : String(error)}`, src));
      const latestAfterOutput = projectRef.current.assets.find((item) => item.id === assetId);
      if (assetChangedDuringGeneration(latestAfterOutput)) {
        preserveChangedAsset(latestAfterOutput);
        return;
      }
      if (projectRef.current.productionRevision !== revisionGuard.expected) {
        updateAsset(assetId, { status: 'stale', error: '生产修订已变化，迟到结果未覆盖当前资产' });
        return;
      }
      const committed = mutate((current) => {
        const base = replaceExisting ? invalidateStoryForAssetChange(current, assetId) : current;
        return {
          ...base,
          assets: base.assets.map((item) => item.id === assetId ? {
            ...item, source: 'ai', status: 'succeeded', url, taskId, taskProvider, taskModel, taskEndpoint, taskClipIds, error: '', generatedAt: new Date().toISOString(), revision: item.revision + 1,
          } : item),
          shots: replaceExisting ? base.shots : base.shots.map((shot) => shot.assetIds.includes(assetId) ? {
            ...shot, finalPrompt: '', videoUrl: '', taskId: '', taskProvider: '', taskModel: '', error: '', status: 'stale', revision: shot.revision + 1,
          } : shot),
          finalVideoUrl: '',
          composeTaskId: '',
          composeTaskStatus: 'idle',
          updatedAt: new Date().toISOString(),
        };
      });
      revisionGuard.expected = committed.productionRevision;
    } finally {
      releaseFinalize();
    }
  }, [hasDomesticKey, imageSelection, mutate, src, updateAsset]);

  const generateAssets = useCallback(async (
    targetIds: string[] | null,
    reporter: RunNodeLifecycleReporter,
    signal: AbortSignal,
    budget: StoryRunTaskBudget,
    retryFailed = false,
    replaceExisting = false,
  ) => {
    setActiveStage('assets');
    const current = projectRef.current;
    const revisionGuard: StoryProductionRevisionGuard = {
      expected: current.productionRevision,
      finalizeTail: Promise.resolve(),
    };
    const candidates = selectStoryAssetTargets(current, targetIds, retryFailed, replaceExisting);
    const selection = limitStoryAssetTargets(candidates, budget.limit, budget.reserved);
    budget.reserved += selection.newTaskCount;
    const targets = selection.selected;
    if (targets.length === 0) {
      if (storyAssetsReady(current)) {
        setActiveStage('prompts');
        setLocalMessage('资产已齐，已进入提示词编译');
        return mutate((value) => ({ ...value, stage: 'prompts', lastError: '', updatedAt: new Date().toISOString() }));
      }
      if (selection.deferred.length) setLocalMessage(`已达到本次新任务上限，剩余 ${selection.deferred.length} 个资产待下次继续`);
      return current;
    }
    setLocalMessage(replaceExisting
      ? `正在重新生成 ${targets[0]?.name || '图像资产'}；新结果成功前会保留当前图片…`
      : `正在生成 ${targets.length} 个缺失资产…`);
    mutate((value) => ({ ...value, stage: 'assets', lastError: '', updatedAt: new Date().toISOString() }), { status: 'running' });
    const errors: string[] = [];
    const generateTarget = async (asset: StoryAsset) => {
      try {
        await generateAsset(asset.id, reporter, signal, revisionGuard, replaceExisting);
      } catch (error: any) {
        const message = error?.message || `${asset.name} 生成失败`;
        updateAsset(asset.id, {
          status: replaceExisting && asset.url ? 'succeeded' : signal.aborted ? 'cancelled' : 'failed',
          error: replaceExisting && asset.url ? `重新生成失败：${message}` : message,
        });
        errors.push(`${asset.name}：${message}`);
      }
    };
    const characterTargets = targets.filter((asset) => asset.kind === 'character');
    const remainingTargets = targets.filter((asset) => asset.kind !== 'character');
    if (characterTargets.length) await runPool(characterTargets, current.settings.maxParallelAssets, generateTarget);
    if (!signal.aborted && remainingTargets.length) await runPool(remainingTargets, current.settings.maxParallelAssets, generateTarget);
    if (signal.aborted) throw new Error('用户已停止');
    if (errors.length === targets.length) throw new Error(errors.join('；'));
    if (errors.length) setLocalMessage(`${targets.length - errors.length} 个资产完成，${errors.length} 个失败，可仅重试失败`);
    else if (selection.deferred.length) setLocalMessage(`${targets.length} 个资产完成；已达到本次新任务上限，剩余 ${selection.deferred.length} 个待下次继续`);
    if (replaceExisting) {
      setActiveStage('assets');
      if (!errors.length) setLocalMessage(`${targets[0]?.name || '图像资产'} 已重新生成；原素材仅在新结果成功后才被替换`);
      return projectRef.current;
    }
    if (storyAssetsReady(projectRef.current)) {
      setActiveStage('prompts');
      setLocalMessage('资产已齐，已自动进入提示词编译');
      return mutate((value) => ({ ...value, stage: 'prompts', lastError: '', updatedAt: new Date().toISOString() }));
    }
    return projectRef.current;
  }, [generateAsset, mutate, updateAsset]);

  const runAssetRegenerationSession = useCallback(async (
    initialTargetId: string,
    reporter: RunNodeLifecycleReporter,
    signal: AbortSignal,
    budget: StoryRunTaskBudget,
  ) => {
    setActiveStage('assets');
    const revisionGuard: StoryProductionRevisionGuard = {
      expected: projectRef.current.productionRevision,
      finalizeTail: Promise.resolve(),
    };
    const pending = new Set<string>();
    const active = new Map<string, Promise<void>>();
    const owned = new Set<string>();
    const errors: string[] = [];
    let queueVersion = 0;
    let completed = 0;
    let sessionClosed = false;
    const concurrency = Math.max(1, projectRef.current.settings.maxParallelAssets);

    const setGenerating = (assetId: string, generating: boolean) => {
      setGeneratingAssetIds((current) => {
        const next = new Set(current);
        if (generating) next.add(assetId);
        else next.delete(assetId);
        return next;
      });
    };

    let pump = () => undefined;
    const enqueue = (assetId: string) => {
      if (sessionClosed || !assetId || owned.has(assetId)) return false;
      const asset = projectRef.current.assets.find((item) => item.id === assetId);
      if (!asset || asset.locked || asset.kind === 'audio' && Boolean(asset.url)) return false;
      if (budget.reserved >= budget.limit) {
        setLocalMessage(`本轮最多启动 ${budget.limit} 个新任务；请等待当前任务完成后再继续`);
        return false;
      }
      budget.reserved += 1;
      owned.add(assetId);
      pending.add(assetId);
      queueVersion += 1;
      setGenerating(assetId, true);
      pump();
      return true;
    };

    pump = () => {
      while (!sessionClosed && !signal.aborted && active.size < concurrency && pending.size > 0) {
        const assetId = pending.values().next().value as string;
        pending.delete(assetId);
        const asset = projectRef.current.assets.find((item) => item.id === assetId);
        if (!asset) {
          setGenerating(assetId, false);
          continue;
        }
        const replaceExisting = Boolean(asset.url && asset.kind !== 'audio');
        const task = (async () => {
          try {
            setLocalMessage(`${asset.name} 正在${replaceExisting ? '重新' : ''}生成；当前最多并发 ${concurrency} 个资产任务…`);
            await generateAsset(asset.id, reporter, signal, revisionGuard, replaceExisting);
            completed += 1;
          } catch (error: any) {
            const message = error?.message || `${asset.name} 生成失败`;
            updateAsset(asset.id, {
              status: replaceExisting && asset.url ? 'succeeded' : signal.aborted ? 'cancelled' : 'failed',
              error: replaceExisting && asset.url ? `重新生成失败：${message}` : message,
            });
            errors.push(`${asset.name}：${message}`);
          } finally {
            active.delete(assetId);
            queueVersion += 1;
            setGenerating(assetId, false);
            pump();
          }
        })();
        active.set(assetId, task);
      }
    };

    assetRunSessionRef.current = { enqueue };
    assetRunRequestPendingRef.current = false;
    setAssetRunActive(true);
    const initialIds = new Set([initialTargetId, ...pendingAssetRunIdsRef.current].filter(Boolean));
    pendingAssetRunIdsRef.current.clear();
    initialIds.forEach((assetId) => {
      if (!enqueue(assetId)) setGenerating(assetId, false);
    });

    try {
      while (!signal.aborted) {
        pump();
        if (active.size > 0) {
          await Promise.race(Array.from(active.values()));
          continue;
        }
        if (pending.size > 0) continue;
        const idleVersion = queueVersion;
        await sleep(160, signal);
        if (active.size === 0 && pending.size === 0 && queueVersion === idleVersion) break;
      }
      if (signal.aborted) throw new Error('用户已停止');
      if (errors.length === owned.size && errors.length > 0) throw new Error(errors.join('；'));
      if (errors.length) setLocalMessage(`${completed} 个资产完成，${errors.length} 个失败；其他资产可继续并发生成`);
      else if (completed > 0) setLocalMessage(`${completed} 个资产已生成；每张旧图都只在新图成功后替换`);
      return projectRef.current;
    } finally {
      sessionClosed = true;
      if (assetRunSessionRef.current?.enqueue === enqueue) assetRunSessionRef.current = null;
      assetRunRequestPendingRef.current = false;
      pendingAssetRunIdsRef.current.clear();
      setAssetRunActive(false);
      setGeneratingAssetIds((current) => {
        const next = new Set(current);
        owned.forEach((assetId) => next.delete(assetId));
        return next;
      });
    }
  }, [generateAsset, updateAsset]);

  const compile = useCallback(() => {
    const current = projectRef.current;
    if (current.shots.length === 0) throw new Error('请先完成剧本分析');
    const next = commit(compileStoryPrompts(current), { status: 'ready' });
    if (!next.coverage.ready) {
      const problems = [
        next.coverage.uncovered.length ? `${next.coverage.uncovered.length} 段未覆盖` : '',
        next.coverage.hardConstraintLosses.length ? `${next.coverage.hardConstraintLosses.length} 条硬约束未保留` : '',
        next.coverage.continuityIssues.filter((issue) => issue.severity === 'error').length ? '存在连续性错误' : '',
      ].filter(Boolean).join('、');
      throw new Error(`提示词预检未通过：${problems}`);
    }
    setActiveStage('prompts');
    setLocalMessage('提示词已编译并通过覆盖检查');
    return next;
  }, [commit]);

  const pollVideoJob = useCallback(async (job: DirectorStoryboardJob, signal: AbortSignal, reporter: RunNodeLifecycleReporter): Promise<string> => {
    const shot = projectRef.current.shots.find((item) => item.id === job.shotId);
    const external = videoSelection.available ? videoSelection : null;
    const resumable = !external && Boolean(shot && isStoryShotTaskResumable(shot));
    const defaultProvider = effectiveVideoBuiltinSource;
    let taskProvider = resumable ? shot!.taskProvider : defaultProvider;
    let taskId = resumable ? shot!.taskId : '';
    let resolvedModel = resumable && shot!.taskModel ? shot!.taskModel : external?.providerModel || job.payload.model;
    if (external) {
      taskProvider = external.providerSource;
      await reporter.providerRequest({ provider: taskProvider, model: resolvedModel, jobId: job.id, jobKind: 'story-shot', resumed: false });
      mutate((current) => ({
        ...current,
        shots: current.shots.map((item) => item.id === job.shotId ? { ...item, status: 'running', taskId: '', taskProvider, taskModel: resolvedModel, error: '' } : item),
        updatedAt: new Date().toISOString(),
      }));
      const result = await generateExternalVideo({
        providerId: external.providerId,
        providerModel: external.providerModel,
        model: external.providerModel,
        prompt: job.payload.prompt,
        aspect_ratio: job.payload.ratio,
        ratio: job.payload.ratio,
        duration: job.payload.duration,
        resolution: job.payload.resolution,
        seed: job.payload.seed,
        images: [job.payload.firstFrame, job.payload.lastFrame, ...(job.payload.refImages || [])].filter((value): value is string => Boolean(value)),
        videos: job.payload.videos,
        audios: job.payload.audios,
        providerParams: job.payload.providerParams,
      }, { submissionKey: reporter.providerSubmissionKey });
      const videoUrl = String(result.videoUrls?.[0] || '');
      if (!videoUrl) throw new Error(`${job.title} 未返回视频`);
      if (result.taskId || result.requestId) await reporter.providerSubmitted({ provider: taskProvider, model: resolvedModel, upstreamTaskId: result.taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, jobId: job.id, jobKind: 'story-shot', httpStatusSource: 'local-backend' });
      await reporter.providerResponse({ provider: taskProvider, model: resolvedModel, upstreamTaskId: result.taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, status: 'succeeded', jobId: job.id, jobKind: 'story-shot', httpStatusSource: 'local-backend' });
      return videoUrl;
    }
    await reporter.providerRequest({ provider: taskProvider, model: resolvedModel, jobId: job.id, jobKind: 'story-shot', resumed: resumable });
    if (resumable) {
      await reporter.providerSubmitted({ provider: taskProvider, model: resolvedModel, upstreamTaskId: taskId, jobId: job.id, jobKind: 'story-shot', resumed: true, httpStatusSource: 'local-backend' });
    } else {
      const submitted = await submitSeedance(
        { ...job.payload, taskProvider: defaultProvider },
        { submissionKey: reporter.providerSubmissionKey },
      );
      taskProvider = submitted.taskProvider || defaultProvider;
      taskId = submitted.taskId;
      resolvedModel = submitted.model || job.payload.model;
      await reporter.providerSubmitted({ provider: taskProvider, model: resolvedModel, upstreamTaskId: taskId, requestId: submitted.requestId, transportHttpStatus: submitted.transportHttpStatus, upstreamHttpStatus: submitted.upstreamHttpStatus, usage: submitted.usage, jobId: job.id, jobKind: 'story-shot', httpStatusSource: 'local-backend' });
    }
    mutate((current) => ({
      ...current,
      shots: current.shots.map((item) => item.id === job.shotId ? { ...item, status: 'polling', taskId, taskProvider, taskModel: resolvedModel, error: '' } : item),
      updatedAt: new Date().toISOString(),
    }));
    const startedAt = Date.now();
    let pollCount = 0;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await sleep(5000, signal);
      pollCount += 1;
      const result = await querySeedance(taskId, taskProvider as any);
      await reporter.polling({ provider: result.taskProvider || taskProvider, model: result.model || resolvedModel, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: result.status, progress: result.progress, jobId: job.id, jobKind: 'story-shot', httpStatusSource: 'local-backend' });
      if (String(result.status || '').toLowerCase() === 'materializing' && (pollCount === 1 || pollCount % 10 === 0)) {
        logBus.warn(
          result.error || `${job.title} 已经生成，正在适配 TUN/代理网络并安全下载；不会重复提交任务`,
          `story:${id.slice(0, 6)}`,
        );
      }
      if (result.status === 'succeeded' && result.videoUrl) {
        await reporter.providerResponse({ provider: result.taskProvider || taskProvider, model: result.model || resolvedModel, upstreamTaskId: taskId, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus, usage: result.usage, pollCount, status: 'succeeded', jobId: job.id, jobKind: 'story-shot', httpStatusSource: 'local-backend' });
        return result.videoUrl;
      }
      if (result.status === 'failed') throw new Error(result.failReason || `${job.title} 生成失败`);
    }
    throw new Error(`${job.title} 生成超时`);
  }, [effectiveVideoBuiltinSource, mutate, videoSelection]);

  const generateVideos = useCallback(async (reporter: RunNodeLifecycleReporter, signal: AbortSignal, budget: StoryRunTaskBudget, retryFailed = false) => {
    setActiveStage('videos');
    let current = projectRef.current;
    if (current.shots.some((shot) => !shot.finalPrompt)) current = compile();
    const capturedRevision = current.productionRevision;
    const candidates = selectStoryVideoTargets(current, retryFailed);
    const selection = limitStoryVideoTargets(candidates, budget.limit, budget.reserved);
    budget.reserved += selection.newTaskCount;
    const targetShots = selection.selected;
    if (targetShots.length === 0) {
      if (selection.deferred.length) setLocalMessage(`已达到本次新任务上限，剩余 ${selection.deferred.length} 个镜头待下次继续`);
      return current;
    }
    setLocalMessage(`正在并行生成 ${targetShots.length} 个镜头视频…`);
    mutate((value) => ({ ...value, stage: 'videos', lastError: '', updatedAt: new Date().toISOString() }), { status: 'running' });
    const directorShots = storyToDirectorShots({ ...current, shots: targetShots }, { videoModel: effectiveVideoModel });
    const settings = {
      model: effectiveVideoModel,
      taskProvider: videoSelection.available ? undefined : effectiveVideoBuiltinSource,
      ratio: current.settings.aspectRatio,
      resolution: current.settings.resolution,
      generateAudio: current.settings.generateAudio,
      returnLastFrame: false,
      watermark: false,
      webSearch: false,
      seed: -1,
    };
    const plan = buildDirectorStoryboardRunPlan(directorShots as any, settings);
    const completedResults: Awaited<ReturnType<typeof runDirectorStoryboardJobs>>['results'] = [];
    const completedVideoUrls: string[] = [];
    const onJobComplete = (completed: Awaited<ReturnType<typeof runDirectorStoryboardJobs>>['results'][number]) => {
        const stale = projectRef.current.productionRevision !== capturedRevision;
        mutate((value) => ({
          ...value,
          shots: value.shots.map((shot) => shot.id === completed.job.shotId ? {
            ...shot,
            status: stale ? 'stale' : completed.status === 'success' ? 'succeeded' : completed.status === 'cancelled' ? 'cancelled' : 'failed',
            videoUrl: stale ? shot.videoUrl : completed.videoUrl || '',
            error: stale ? '生产修订已变化，迟到视频未覆盖当前镜头' : completed.error || '',
          } : shot),
          updatedAt: new Date().toISOString(),
        }));
    };
    for (let offset = 0; offset < plan.length; offset += current.settings.maxParallelVideos) {
      const batch = plan.slice(offset, offset + current.settings.maxParallelVideos);
      const batchResult = await runDirectorStoryboardJobs(batch, (job, jobSignal) => pollVideoJob(job, jobSignal || signal, reporter), {
        signal,
        onJobComplete,
      });
      completedResults.push(...batchResult.results);
      completedVideoUrls.push(...batchResult.videoUrls);
      if (projectRef.current.productionRevision === capturedRevision) {
        const outputAssets = batchResult.results.filter((item) => item.status === 'success' && item.videoUrl).map((item) => ({
          kind: 'video' as const,
          sourceUrl: item.videoUrl!,
          filename: safeOutputFilename(item.job.title, 'mp4'),
          mimeType: 'video/mp4',
          metadata: { storyId: current.storyId, storyShotId: item.job.shotId, productionRevision: capturedRevision },
        }));
        if (outputAssets.length) {
          await reporter.output({ status: 'partial', outputCount: outputAssets.length, assets: outputAssets })
            .catch((error) => logBus.warn(`Story 镜头已生成，但资产中心登记失败：${error instanceof Error ? error.message : String(error)}`, src));
        }
      }
      if (signal.aborted) break;
    }
    const result = { results: completedResults, videoUrls: completedVideoUrls };
    if (signal.aborted) throw new Error('用户已停止');
    const failures = result.results.filter((item) => item.status !== 'success');
    if (failures.length === result.results.length) throw new Error(failures.map((item) => item.error).filter(Boolean).join('；') || '全部镜头生成失败');
    if (failures.length) setLocalMessage(`${result.videoUrls.length} 个镜头完成，${failures.length} 个失败，可仅重试失败`);
    else if (selection.deferred.length) setLocalMessage(`${result.videoUrls.length} 个镜头完成；已达到本次新任务上限，剩余 ${selection.deferred.length} 个待下次继续`);
    return projectRef.current;
  }, [compile, effectiveVideoBuiltinSource, effectiveVideoModel, mutate, pollVideoJob, src, videoSelection.available]);

  const compose = useCallback(async (reporter: RunNodeLifecycleReporter, signal: AbortSignal) => {
    const current = projectRef.current;
    const clips = storyToVideoEditClips(current);
    if (clips.length !== current.shots.length || clips.length === 0) throw new Error('仍有镜头视频未完成，不能合成成片');
    setActiveStage('compose');
    const { timelineV2, renderPlan } = storyToVideoEditTimeline(current);
    const capturedRevision = current.productionRevision;
    // Only an in-flight compose task is resumable. A failed/cancelled/stale
    // Story can still retain the previous task id for diagnostics, but reusing
    // that terminal job would simply return the old (possibly corrupt) file
    // instead of performing the user's requested recomposition.
    const existingTaskId = ACTIVE_TASK_STATUSES.has(current.composeTaskStatus)
      ? current.composeTaskId
      : '';
    setLocalMessage('正在按镜头顺序合成成片…');
    mutate((value) => ({ ...value, stage: 'compose', composeTaskStatus: existingTaskId ? 'polling' : 'submitting', lastError: '', updatedAt: new Date().toISOString() }), { status: 'running' });
    await reporter.providerRequest({ provider: 'local-ffmpeg', model: 'video-edit', jobKind: 'story-compose', resumed: Boolean(existingTaskId), upstreamTaskId: existingTaskId || undefined });
    let job = existingTaskId ? await getVideoEditJob(existingTaskId).catch((error) => {
      logBus.warn(`Story 旧合成任务不可恢复，将安全重新提交：${error instanceof Error ? error.message : String(error)}`, src);
      return null;
    }) : null;
    if (job && ['failed', 'cancelled', 'interrupted'].includes(job.status)) job = null;
    if (!job) {
      job = await composeVideoEditAsync(
        clips,
        { ...DEFAULT_VIDEO_EDIT_SETTINGS, aspect: 'first', resolution: 'first', transition: 'none', audio: 'keep' },
        { timelineV2, renderPlan },
      );
    }
    composeJobIdRef.current = job.id;
    const resumed = Boolean(existingTaskId && job.id === existingTaskId);
    mutate((value) => ({ ...value, stage: 'compose', composeTaskId: job!.id, composeTaskStatus: 'polling', updatedAt: new Date().toISOString() }), { status: 'running' });
    await reporter.providerSubmitted({ provider: 'local-ffmpeg', model: 'video-edit', upstreamTaskId: job.id, status: job.status, jobKind: 'story-compose', resumed });
    const startedAt = Date.now();
    let pollCount = 0;
    let status = job;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      if (status.status !== 'done') {
        await sleep(1000, signal);
        pollCount += 1;
        status = await getVideoEditJob(job.id);
      }
      await reporter.polling({ provider: 'local-ffmpeg', model: 'video-edit', upstreamTaskId: job.id, pollCount, status: status.status, progress: status.progress, jobKind: 'story-compose' });
      if (status.status === 'done' && status.result?.videoUrl) {
        composeJobIdRef.current = '';
        if (projectRef.current.productionRevision !== capturedRevision) {
          mutate((value) => ({ ...value, composeTaskStatus: 'stale', lastError: '生产修订已变化，迟到成片未覆盖当前项目', updatedAt: new Date().toISOString() }));
          throw new Error('生产修订已变化，迟到成片未覆盖当前项目');
        }
        await reporter.providerResponse({ provider: 'local-ffmpeg', model: 'video-edit', upstreamTaskId: job.id, status: 'succeeded', jobKind: 'story-compose' });
        const next = mutate((value) => ({ ...value, finalVideoUrl: status.result!.videoUrl, composeTaskId: job!.id, composeTaskStatus: 'succeeded', lastError: '', updatedAt: new Date().toISOString() }), { status: 'success' });
        setLocalMessage('成片已完成');
        return next;
      }
      if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'interrupted') {
        mutate((value) => ({ ...value, composeTaskStatus: status.status === 'cancelled' ? 'cancelled' : 'failed', updatedAt: new Date().toISOString() }));
        throw new Error(status.error || status.message || '成片合成失败');
      }
    }
    throw new Error('成片合成超时');
  }, [mutate, src]);

  const materializeLinkedNodes = useCallback((projectInput = projectRef.current) => {
    const current = sanitizeStoryProject(projectInput);
    if (current.shots.length === 0) return current;
    const nodes = rf.getNodes();
    const owner = nodes.find((node) => node.id === id);
    const baseX = (owner?.position.x || 0) + 430;
    const baseY = owner?.position.y || 0;
    const directorId = current.linkedDirectorNodeId || `story-director-${current.storyId}`;
    const videoEditId = current.linkedVideoEditNodeId || `story-video-edit-${current.storyId}`;
    const directorShots = storyToDirectorShots(current, { videoModel: effectiveVideoModel });
    const jobs = buildDirectorStoryboardRunPlan(directorShots as any, {
      model: effectiveVideoModel,
      taskProvider: videoSelection.available ? undefined : effectiveVideoBuiltinSource,
      ratio: current.settings.aspectRatio,
      resolution: current.settings.resolution,
      generateAudio: current.settings.generateAudio,
      returnLastFrame: false,
      watermark: false,
      webSearch: false,
      seed: -1,
    });
    const shotResults = Object.fromEntries(current.shots.map((shot) => [`shot-${shot.id}`, {
      kind: 'shot', title: shot.title, shotId: shot.id, status: shot.videoUrl ? 'success' : shot.status,
      taskId: shot.taskId || null, videoUrl: shot.videoUrl || null, error: shot.error || null,
    }]));
    const outputItems = buildDirectorStoryboardOutputItems(jobs, shotResults);
    const clips = storyToVideoEditClips(current);
    const timeline = storyToVideoEditTimeline(current);
    const directorData = {
      seedanceApiSource: current.settings.videoApiSource,
      seedanceNzModel: current.settings.videoNzModel,
      model: current.settings.videoModel,
      providerSource: videoSelection.available ? videoSelection.providerSource : 'zhenzhen',
      providerId: videoSelection.available ? videoSelection.providerId : '',
      providerModel: videoSelection.available ? videoSelection.providerModel : '',
      ratio: current.settings.aspectRatio,
      resolution: current.settings.resolution, generateAudio: current.settings.generateAudio,
      returnLastFrame: false, watermark: false, webSearch: false, seed: -1,
      shots: directorShots, shotResults, videoUrls: outputItems.map((item) => item.videoUrl),
      videoUrl: outputItems.at(-1)?.videoUrl || '', directorOutputItems: outputItems,
      outputText: buildDirectorStoryboardOutputSummary(outputItems), status: outputItems.length === current.shots.length ? 'success' : 'idle',
      storySourceId: current.storyId, storySourceRevision: current.productionRevision,
    };
    const videoEditData = {
      ...DEFAULT_VIDEO_EDIT_DATA,
      clips,
      timelineV2: timeline.timelineV2,
      settings: { ...DEFAULT_VIDEO_EDIT_SETTINGS },
      videoUrl: current.finalVideoUrl,
      videoUrls: current.finalVideoUrl ? [current.finalVideoUrl] : [],
      output: current.finalVideoUrl ? { videoUrl: current.finalVideoUrl, name: `${current.title}.mp4` } : undefined,
      status: current.finalVideoUrl ? 'success' : clips.length ? 'ready' : 'idle',
      storySourceId: current.storyId, storySourceRevision: current.productionRevision,
    };
    rf.setNodes((previous) => {
      const next = [...previous];
      const directorIndex = next.findIndex((node) => node.id === directorId);
      const videoEditIndex = next.findIndex((node) => node.id === videoEditId);
      const directorNode: Node = directorIndex >= 0
        ? { ...next[directorIndex], data: { ...(next[directorIndex].data as any), ...directorData } }
        : { id: directorId, type: 'director-storyboard', position: { x: baseX, y: baseY }, data: directorData };
      const editNode: Node = videoEditIndex >= 0
        ? { ...next[videoEditIndex], data: { ...(next[videoEditIndex].data as any), ...videoEditData } }
        : { id: videoEditId, type: 'video-edit', position: { x: baseX + 500, y: baseY }, data: videoEditData };
      if (directorIndex >= 0) next[directorIndex] = directorNode; else next.push(directorNode);
      if (videoEditIndex >= 0) next[videoEditIndex] = editNode; else next.push(editNode);
      return next;
    });
    const nextProject = { ...current, linkedDirectorNodeId: directorId, linkedVideoEditNodeId: videoEditId };
    commit(nextProject);
    return nextProject;
  }, [commit, effectiveVideoBuiltinSource, effectiveVideoModel, id, rf, videoSelection]);

  const runMode = useCallback(async (mode: StoryRunMode, targetId: string, reporter: RunNodeLifecycleReporter, signal: AbortSignal, budget: StoryRunTaskBudget) => {
    if (mode === 'analyze') return analyze(reporter, signal);
    if (mode === 'asset-one') return runAssetRegenerationSession(targetId, reporter, signal, budget);
    if (mode === 'assets-missing') return generateAssets(null, reporter, signal, budget);
    if (mode === 'compile') return compile();
    if (mode === 'videos-missing') return generateVideos(reporter, signal, budget);
    if (mode === 'compose') return compose(reporter, signal);
    if (mode === 'retry-failed') {
      await generateAssets(null, reporter, signal, budget, true);
      if (projectRef.current.assets.some((asset) => !asset.url)) return projectRef.current;
      compile();
      await generateVideos(reporter, signal, budget, true);
      if (projectRef.current.shots.every((shot) => shot.videoUrl)) await compose(reporter, signal);
      return projectRef.current;
    }
    if (projectRef.current.shots.length === 0) await analyze(reporter, signal);
    await generateAssets(null, reporter, signal, budget);
    if (projectRef.current.assets.some((asset) => !asset.url)) return projectRef.current;
    compile();
    await generateVideos(reporter, signal, budget);
    if (projectRef.current.shots.every((shot) => shot.videoUrl)) await compose(reporter, signal);
    return projectRef.current;
  }, [analyze, compile, compose, generateAssets, generateVideos, runAssetRegenerationSession]);

  useRunTrigger(id, async (reporter) => {
    runRequestPendingRef.current = false;
    setRunRequestPending(false);
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const contextRequestId = String(reporter.runContext?.requestId || '').trim();
    const persistedRequestId = String(liveData?.storyRunRequestId || '').trim();
    const mode = (String(liveData?.storyRunMode || 'all') as StoryRunMode);
    const targetId = String(liveData?.storyRunTargetId || '').trim();
    if (persistedRequestId && persistedRequestId !== contextRequestId) throw new Error('Story 运行请求已变化，已拒绝陈旧执行');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const budget: StoryRunTaskBudget = { limit: projectRef.current.settings.maxNewTasksPerRun, reserved: 0 };
      const result = await runMode(mode, targetId, reporter, controller.signal, budget);
      const synced = materializeLinkedNodes(result);
      await reporter.output({
        status: 'succeeded',
        outputCount: (synced.finalVideoUrl ? 1 : 0) + 1,
        assets: [
          ...(synced.finalVideoUrl ? [{
            kind: 'video' as const,
            sourceUrl: synced.finalVideoUrl,
            filename: safeOutputFilename(synced.title, 'mp4'),
            mimeType: 'video/mp4',
            metadata: { storyId: synced.storyId, storyOutput: 'final', productionRevision: synced.productionRevision },
          }] : []),
          { kind: 'text' as const, text: storyOutputText(synced), filename: safeOutputFilename(synced.title, 'txt') },
        ],
      });
      commit(synced, { status: synced.finalVideoUrl ? 'success' : 'ready' });
      taskCompletionSound.notifyComplete(id, 'story');
      logBus.success(`Story 流程完成：${synced.title}`, src);
    } catch (error: any) {
      const message = error?.message || 'Story 自动生产失败';
      mutate((current) => {
        const composeAlreadySucceeded = current.stage === 'compose'
          && current.composeTaskStatus === 'succeeded'
          && Boolean(current.finalVideoUrl);
        return {
          ...current,
          composeTaskStatus: current.stage === 'compose'
            && current.composeTaskStatus !== 'stale'
            && !composeAlreadySucceeded
            ? controller.signal.aborted ? 'cancelled' : 'failed'
            : current.composeTaskStatus,
          lastError: composeAlreadySucceeded
            ? `成片已生成，但保存运行记录失败：${message}`
            : message,
          updatedAt: new Date().toISOString(),
        };
      }, { status: controller.signal.aborted ? 'cancelled' : 'error', error: message });
      logBus.error(`Story 失败：${message}`, src);
      throw error;
    } finally {
      runRequestPendingRef.current = false;
      setRunRequestPending(false);
      if (abortRef.current === controller) abortRef.current = null;
      composeJobIdRef.current = '';
      if (contextRequestId) {
        const latest = rf.getNode(id)?.data as Record<string, unknown> | undefined;
        if (latest?.storyRunRequestId === contextRequestId) updateNode({ storyRunRequestId: '', storyRunTargetId: '', storyRunMode: 'all' });
      }
    }
  }, 'story', { lifecycleAware: true });

  const requestAssetRun = useCallback((assetId: string) => {
    const asset = projectRef.current.assets.find((item) => item.id === assetId);
    if (!asset || asset.locked || asset.kind === 'audio' && Boolean(asset.url)) return;
    if (generatingAssetIds.has(assetId)) return;
    const activeSession = assetRunSessionRef.current;
    if (activeSession) {
      if (!activeSession.enqueue(assetId)) setLocalMessage(`${asset.name} 当前无法加入生成队列`);
      return;
    }
    if (assetRunRequestPendingRef.current) {
      pendingAssetRunIdsRef.current.add(assetId);
      setGeneratingAssetIds((current) => new Set(current).add(assetId));
      setLocalMessage(`${asset.name} 已加入并发生成队列`);
      return;
    }
    if (busy) {
      setLocalMessage('Story 正在执行其他生产步骤；完成或停止后即可生成该资产');
      return;
    }
    assetRunRequestPendingRef.current = true;
    pendingAssetRunIdsRef.current.add(assetId);
    setAssetRunActive(true);
    setGeneratingAssetIds((current) => new Set(current).add(assetId));
    setLocalMessage(`${asset.name} 正在准备生成…`);
    if (!requestRun('asset-one', assetId)) {
      assetRunRequestPendingRef.current = false;
      pendingAssetRunIdsRef.current.delete(assetId);
      setAssetRunActive(false);
      setGeneratingAssetIds((current) => {
        const next = new Set(current);
        next.delete(assetId);
        return next;
      });
      setLocalMessage('当前无法启动资产生成，请稍后重试');
    }
  }, [busy, generatingAssetIds, requestRun]);

  const handleScriptChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    commit(invalidateStoryForScriptChange(projectRef.current, event.target.value));
  }, [commit]);

  const handleAssetUpload = useCallback(async (asset: StoryAsset, file: File) => {
    setLocalMessage(`正在上传 ${asset.name}…`);
    try {
      const uploaded = await api.uploadResourceLocalFile(file, {
        projectId: 'project-local',
        canvasId: activeCanvasId || undefined,
        sourceNodeId: id,
        sourceNodeType: 'story',
      });
      updateAsset(asset.id, { source: 'upload', status: 'succeeded', url: uploaded.url, taskId: '', taskProvider: '', taskModel: '', taskEndpoint: '', taskClipIds: [], error: '', generatedAt: new Date().toISOString() }, true);
      setLocalMessage(uploaded.assetId ? `${asset.name} 已上传并进入资产中心` : `${asset.name} 已上传`);
    } catch (error: any) {
      updateAsset(asset.id, { status: 'failed', error: error?.message || '上传失败' });
      setLocalMessage(error?.message || '上传失败');
    }
  }, [activeCanvasId, id, updateAsset]);

  const useUpstreamAsset = useCallback((asset: StoryAsset) => {
    const candidates = asset.kind === 'audio' ? upstream.audios : upstream.images;
    const candidate = candidates.find((item) => !projectRef.current.assets.some((other) => other.id !== asset.id && other.url === item.url));
    if (!candidate) {
      setLocalMessage(`上游没有可用的未绑定${asset.kind === 'audio' ? '音频' : '图片'}，请先连接对应素材节点`);
      return;
    }
    updateAsset(asset.id, { source: 'existing', status: 'succeeded', url: candidate.url, taskId: '', taskProvider: '', taskModel: '', taskEndpoint: '', taskClipIds: [], error: '', generatedAt: new Date().toISOString() }, true);
    setLocalMessage(`${asset.name} 已绑定上游素材`);
  }, [updateAsset, upstream.audios, upstream.images]);

  const openResourcePicker = useCallback((asset: StoryAsset) => {
    if (asset.kind === 'audio') return;
    setSelectedAssetId(asset.id);
    setResourcePickerAssetId(asset.id);
    setResourceQuery('');
    setResourceItems([]);
    setResourceMessage('');
  }, []);

  const closeResourcePicker = useCallback(() => {
    setResourcePickerAssetId('');
    setResourceQuery('');
    setResourceItems([]);
    setResourceMessage('');
    setResourceLoading(false);
  }, []);

  const handlePickResourceItem = useCallback((item: api.ResourceItem) => {
    const asset = projectRef.current.assets.find((candidate) => candidate.id === resourcePickerAssetId);
    if (!asset || asset.kind === 'audio' || !item.fileUrl) return;
    updateAsset(asset.id, {
      source: 'existing',
      status: 'succeeded',
      url: item.fileUrl,
      taskId: '',
      taskProvider: '',
      taskModel: '',
      taskEndpoint: '',
      taskClipIds: [],
      error: '',
      generatedAt: new Date().toISOString(),
    }, true);
    void api.updateResourceItem(item.id, { touch: true });
    setLocalMessage(`${asset.name} 已从资产库绑定「${item.title || '图片'}」`);
    closeResourcePicker();
  }, [closeResourcePicker, resourcePickerAssetId, updateAsset]);

  const addShot = useCallback(() => {
    mutate((current) => {
      const index = current.shots.length;
      const shot = sanitizeStoryProject({ ...current, shots: [...current.shots, {
        id: `shot-manual-${Date.now().toString(36)}`, sceneId: current.scenes[0]?.id || '', title: `新镜头 ${index + 1}`,
        sourceSpan: { start: current.script.length, end: current.script.length, text: '' }, durationSec: 6,
        visualDescription: '', action: '', dialogue: '', voiceover: '', sfx: '', camera: '稳定电影镜头', lighting: '',
        mustInclude: [], mustNotInclude: [], entityRefs: [], assetIds: [], finalPrompt: '', negativePrompt: '', status: 'pending', videoUrl: '', taskId: '', taskProvider: '', taskModel: '', error: '', lockedFields: [], revision: 1,
      }] }).shots.at(-1)!;
      setSelectedShotId(shot.id);
      return { ...current, shots: [...current.shots, shot], storyRevision: current.storyRevision + 1, productionRevision: current.productionRevision + 1, finalVideoUrl: '', composeTaskId: '', composeTaskStatus: 'idle', updatedAt: new Date().toISOString() };
    });
  }, [mutate]);

  const duplicateShot = useCallback((shot: StoryShot) => {
    const next = duplicateStoryShot(projectRef.current, shot.id);
    const copy = next.shots[next.shots.findIndex((item) => item.id === shot.id) + 1];
    commit(next);
    if (copy) setSelectedShotId(copy.id);
  }, [commit]);

  const handleSplitShot = useCallback((shotId: string) => {
    try {
      const next = splitStoryShot(projectRef.current, shotId);
      commit(next);
      setLocalMessage('镜头已按语义断点拆成两段，约束与资产引用已保留');
    } catch (error: any) {
      setLocalMessage(error?.message || '拆分镜头失败');
    }
  }, [commit]);

  const handleMergeShot = useCallback((shotId: string) => {
    try {
      const next = mergeStoryShotWithNext(projectRef.current, shotId);
      commit(next);
      setSelectedShotId(shotId);
      setLocalMessage('已与下一镜头合并');
    } catch (error: any) {
      setLocalMessage(error?.message || '合并镜头失败');
    }
  }, [commit]);

  const removeShot = useCallback((shotId: string) => {
    commit(removeStoryShot(projectRef.current, shotId));
  }, [commit]);

  const moveShot = useCallback((shotId: string, delta: number) => {
    commit(moveStoryShot(projectRef.current, shotId, delta));
  }, [commit]);

  const patchShot = useCallback((shotId: string, patch: Partial<StoryShot>) => {
    commit(patchStoryShot(projectRef.current, shotId, patch));
  }, [commit]);

  const toggleShotLock = useCallback((shot: StoryShot, field: keyof StoryShot) => {
    const locked = new Set(shot.lockedFields);
    if (locked.has(field)) locked.delete(field); else locked.add(field);
    patchShot(shot.id, { lockedFields: Array.from(locked) });
  }, [patchShot]);

  const addAsset = useCallback((kind: StoryAssetKind) => {
    const assetId = `asset-manual-${kind}-${Date.now().toString(36)}`;
    mutate((current) => ({
      ...current,
      assets: [...current.assets, {
        id: assetId,
        kind,
        name: `新${storyAssetKindLabel(kind)}`,
        description: '',
        prompt: '',
        negativePrompt: '',
        requiredByShotIds: [],
        source: 'missing',
        status: 'pending',
        url: '',
        taskId: '',
        taskProvider: '',
        taskModel: '',
        taskEndpoint: '',
        taskClipIds: [],
        error: '',
        locked: false,
        revision: 1,
        generatedAt: '',
      }],
      stage: 'assets',
      storyRevision: current.storyRevision + 1,
      updatedAt: new Date().toISOString(),
    }));
    setSelectedAssetId(assetId);
  }, [mutate]);

  const removeAsset = useCallback((assetId: string) => {
    mutate((current) => {
      const affected = new Set(current.shots.filter((shot) => shot.assetIds.includes(assetId)).map((shot) => shot.id));
      return {
        ...current,
        assets: current.assets.filter((asset) => asset.id !== assetId),
        shots: current.shots.map((shot) => affected.has(shot.id) ? {
          ...shot,
          assetIds: shot.assetIds.filter((idValue) => idValue !== assetId),
          finalPrompt: '', videoUrl: '', taskId: '', taskProvider: '', taskModel: '', status: 'stale', error: '', revision: shot.revision + 1,
        } : shot),
        storyRevision: current.storyRevision + 1,
        productionRevision: current.productionRevision + 1,
        finalVideoUrl: affected.size ? '' : current.finalVideoUrl,
        updatedAt: new Date().toISOString(),
      };
    });
    setLocalMessage('资产已删除，相关镜头已标记为需更新');
  }, [mutate]);

  const confirmRemoveAsset = useCallback((asset: StoryAsset) => {
    if (generatingAssetIds.has(asset.id)) {
      setLocalMessage(`${asset.name} 正在生成，请等待完成或先停止当前流程`);
      return;
    }
    if (!window.confirm(`确认删除资产「${asset.name}」？相关镜头会标记为需要更新。`)) return;
    removeAsset(asset.id);
  }, [generatingAssetIds, removeAsset]);

  const clearAssetMedia = useCallback((asset: StoryAsset) => {
    updateAsset(asset.id, {
      source: 'missing', status: 'pending', url: '', taskId: '', taskProvider: '', taskModel: '', taskEndpoint: '', taskClipIds: [], error: '', generatedAt: '',
    }, true);
    setLocalMessage(`${asset.name} 已清空，可重新上传或 AI 生成`);
  }, [updateAsset]);

  const confirmClearAssetMedia = useCallback((asset: StoryAsset) => {
    if (generatingAssetIds.has(asset.id)) {
      setLocalMessage(`${asset.name} 正在生成，请等待完成或先停止当前流程`);
      return;
    }
    const materialKind = asset.kind === 'audio' ? '音频' : '图片';
    if (!window.confirm(`确认清空资产「${asset.name}」的当前${materialKind}？资产设定、提示词和镜头关联都会保留。`)) return;
    clearAssetMedia(asset);
  }, [clearAssetMedia, generatingAssetIds]);

  const toggleAssetShot = useCallback((assetId: string, shotId: string) => {
    mutate((current) => {
      const asset = current.assets.find((item) => item.id === assetId);
      const shot = current.shots.find((item) => item.id === shotId);
      if (!asset || !shot) return current;
      const linked = shot.assetIds.includes(assetId);
      const nextShotIds = linked ? asset.requiredByShotIds.filter((idValue) => idValue !== shotId) : Array.from(new Set([...asset.requiredByShotIds, shotId]));
      return {
        ...current,
        assets: current.assets.map((item) => item.id === assetId ? { ...item, requiredByShotIds: nextShotIds, revision: item.revision + 1 } : item),
        shots: current.shots.map((item) => item.id === shotId ? {
          ...item,
          assetIds: linked ? item.assetIds.filter((idValue) => idValue !== assetId) : Array.from(new Set([...item.assetIds, assetId])),
          finalPrompt: '', videoUrl: '', taskId: '', taskProvider: '', taskModel: '', status: 'stale', error: '', revision: item.revision + 1,
        } : item),
        storyRevision: current.storyRevision + 1,
        productionRevision: current.productionRevision + 1,
        finalVideoUrl: '',
        composeTaskId: '',
        composeTaskStatus: 'idle',
        updatedAt: new Date().toISOString(),
      };
    });
  }, [mutate]);

  const compactProgress = storyT('compactProgress', {
    assetsCompleted: progress.assets.completed,
    assetsTotal: progress.assets.total,
    videosCompleted: progress.videos.completed,
    videosTotal: progress.videos.total,
  });

  const selectLlmPlatform = (value: string) => {
    if (value === 'builtin:zhenzhen' || value === 'builtin:seedance-nz') {
      updateSettings({
        llmApiSource: value === 'builtin:seedance-nz' ? 'seedance-nz' : 'zhenzhen',
        llmProviderSource: 'zhenzhen',
        llmProviderId: '',
        llmProviderModel: '',
      });
      return;
    }
    const providerId = providerIdFromChoice(value);
    const provider = llmProviders.find((item) => item.id === providerId);
    if (!provider) {
      updateSettings({
        llmApiSource: 'zhenzhen',
        llmProviderSource: 'zhenzhen',
        llmProviderId: '',
        llmProviderModel: '',
      });
      return;
    }
    updateSettings({
      llmProviderSource: provider.protocol as CanvasProviderSource,
      llmProviderId: provider.id,
      llmProviderModel: advancedProviderModelOptions(provider, 'llm')[0] || '',
    });
  };

  const selectImagePlatform = (value: string) => {
    const providerId = providerIdFromChoice(value);
    const provider = imageProviders.find((item) => item.id === providerId);
    if (provider) {
      updateSettings({
        imageProviderSource: provider.protocol as CanvasProviderSource,
        imageProviderId: provider.id,
        imageProviderModel: advancedProviderModelOptions(provider, 'image')[0] || '',
      });
      return;
    }
    const platform = value as StoryImagePlatformChoice;
    const firstModel = builtInImageOptions(platform)[0]?.value || 'gpt-image-2';
    updateSettings({ imageProviderSource: 'zhenzhen', imageProviderId: '', imageProviderModel: '', imageModel: firstModel });
  };

  const selectVideoPlatform = (value: string) => {
    const providerId = providerIdFromChoice(value);
    const provider = videoProviders.find((item) => item.id === providerId);
    if (!provider) {
      updateSettings({ videoProviderSource: 'zhenzhen', videoProviderId: '', videoProviderModel: '' });
      return;
    }
    updateSettings({
      videoProviderSource: provider.protocol as CanvasProviderSource,
      videoProviderId: provider.id,
      videoProviderModel: advancedProviderModelOptions(provider, 'video')[0] || '',
    });
  };

  const renderProductionSettings = (compact = false) => {
    const selectClass = `nodrag nowheel mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 ${compact ? 'py-1.5 text-[10px]' : 'py-2 text-xs'} text-white`;
    const labelClass = compact ? 'block text-[9px] text-white/45' : 'block text-[11px] text-white/50';
    const llmModels = llmSelection.available && llmSelection.provider
      ? advancedProviderModelOptions(llmSelection.provider, 'llm').map((value) => ({ value, label: value }))
      : project.settings.llmApiSource === 'seedance-nz'
        ? SEEDANCE_NZ_LLM_MODELS.map((value) => ({ value, label: value }))
        : LLM_MODELS.map((item) => ({ value: item.id, label: item.label }));
    const selectedLlmModel = llmSelection.available
      ? llmSelection.providerModel
      : project.settings.llmApiSource === 'seedance-nz'
        ? project.settings.llmNzModel
        : project.settings.llmModel;
    const imageModels = imageSelection.available && imageSelection.provider
      ? advancedProviderModelOptions(imageSelection.provider, 'image').map((value) => ({ value, label: value }))
      : builtInImageOptions(imageChoice);
    const videoModels = videoSelection.available && videoSelection.provider
      ? advancedProviderModelOptions(videoSelection.provider, 'video').map((value) => ({ value, label: value }))
      : effectiveVideoBuiltinSource === 'seedance-nz' ? SEEDANCE_NZ_MODEL_OPTIONS : LEGACY_SEEDANCE_MODEL_OPTIONS;
    return <div className={`space-y-2 ${compact ? 'rounded-xl border border-white/10 bg-black/20 p-2.5' : ''}`}>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>{storyT('llmPlatform')}<select value={llmChoice} onChange={(event) => selectLlmPlatform(event.target.value)} className={selectClass}><option value="builtin:zhenzhen">{storyT('providers.workshopLlm')}</option><option value="builtin:seedance-nz">{storyT('providers.budgetHouse')}</option>{llmProviders.map((provider) => <option key={provider.id} value={advancedChoice(provider.id)}>{provider.label} · {provider.protocol}</option>)}</select></label>
        <label className={labelClass}>{storyT('llmModel')}<select value={selectedLlmModel} onChange={(event) => llmSelection.available ? updateSettings({ llmProviderModel: event.target.value }) : project.settings.llmApiSource === 'seedance-nz' ? updateSettings({ llmNzModel: event.target.value }) : updateSettings({ llmModel: event.target.value })} className={selectClass}>{llmModels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>{storyT('imagePlatform')}<select value={imageChoice} onChange={(event) => selectImagePlatform(event.target.value)} className={selectClass}><option value="builtin:legacy">{storyT('providers.workshopOverseas')}</option><option value="builtin:seedance-nz">{storyT('providers.budgetHouse')}</option><option value="builtin:fal">{storyT('providers.fal')}</option>{imageProviders.map((provider) => <option key={provider.id} value={advancedChoice(provider.id)}>{provider.label} · {provider.protocol}</option>)}</select></label>
        <label className={labelClass}>{storyT('imageModel')}<select value={imageSelection.available ? imageSelection.providerModel : project.settings.imageModel} onChange={(event) => imageSelection.available ? updateSettings({ imageProviderModel: event.target.value }) : updateSettings({ imageModel: event.target.value })} className={selectClass}>{imageModels.map((item) => <option key={item.value} value={item.value} disabled={item.value === ZHENZHEN_IMAGE_G2_I2I_MODEL}>{item.label}{item.value === ZHENZHEN_IMAGE_G2_I2I_MODEL ? storyT('referenceRequired') : ''}</option>)}</select></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>{storyT('videoPlatform')}<select value={videoChoice} onChange={(event) => selectVideoPlatform(event.target.value)} className={selectClass}><option value="builtin">{storyT('providers.seedanceBuiltin')}</option>{videoProviders.map((provider) => <option key={provider.id} value={advancedChoice(provider.id)}>{provider.label} · {provider.protocol}</option>)}</select></label>
        {videoSelection.available ? <label className={labelClass}>{storyT('videoModel')}<select value={videoSelection.providerModel} onChange={(event) => updateSettings({ videoProviderModel: event.target.value })} className={selectClass}>{videoModels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : <label className={labelClass}>{storyT('seedanceSource')}<select value={project.settings.videoApiSource} onChange={(event) => updateSettings({ videoApiSource: event.target.value as SeedanceBuiltinSource })} className={selectClass}><option value="auto">{storyT('providers.autoBudget')}</option><option value="seedance-nz">{storyT('providers.budgetHouse')}</option><option value="zhenzhen-legacy">{storyT('providers.workshopOverseas')}</option></select></label>}
      </div>
      {!videoSelection.available && <label className={labelClass}>{storyT('videoModel')}<select value={effectiveVideoModel} onChange={(event) => effectiveVideoBuiltinSource === 'seedance-nz' ? updateSettings({ videoNzModel: event.target.value }) : updateSettings({ videoModel: event.target.value })} className={selectClass}>{videoModels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
      {!imageSelection.available && project.settings.imageModel === ZHENZHEN_IMAGE_G2_I2I_MODEL && <p className="text-[9px] text-amber-200">{storyT('g2ReferenceWarning')}</p>}
      {!llmSelection.available && project.settings.llmApiSource === 'seedance-nz' && !hasDomesticKey && <p className="text-[9px] text-amber-200">{storyT('missingBudgetKey')}</p>}
      {!videoSelection.available && effectiveVideoBuiltinSource === 'seedance-nz' && !hasDomesticKey && <p className="text-[9px] text-amber-200">{storyT('missingBudgetKey')}</p>}
    </div>;
  };

  const renderScriptStage = () => (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4">
      <section className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div><h3 className="font-semibold text-white">{storyT('script')}</h3><p className="text-xs text-white/45">{storyT('scriptHelp')}</p></div>
          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/50">{storyT('characters', { count: project.script.length })}</span>
        </div>
        <textarea value={project.script} onChange={handleScriptChange} placeholder={storyT('scriptPlaceholder')} className="nowheel nodrag min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-7 text-white outline-none focus:border-amber-300/60" />
      </section>
      <aside className="space-y-3 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <label className="block text-xs text-white/55">{storyT('projectTitle')}<input value={project.title} onChange={(event) => setProjectPatch({ title: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none" /></label>
        <label className="block text-xs text-white/55">{storyT('visualStyle')}<textarea value={project.settings.visualStyle} onChange={(event) => updateSettings({ visualStyle: event.target.value })} className="mt-1 h-24 w-full resize-none rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs leading-5 text-white outline-none" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-white/55">{storyT('aspectRatio')}<select value={project.settings.aspectRatio} onChange={(event) => updateSettings({ aspectRatio: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-xs text-white"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option><option>21:9</option></select></label>
          <label className="text-xs text-white/55">{storyT('pace')}<select value={project.settings.pace} onChange={(event) => updateSettings({ pace: event.target.value as any })} className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-xs text-white"><option value="slow">{storyT('paceOptions.slow')}</option><option value="balanced">{storyT('paceOptions.balanced')}</option><option value="fast">{storyT('paceOptions.fast')}</option></select></label>
        </div>
        <label className="block text-xs text-white/55">{storyT('targetDuration')}<input type="number" min={4} max={86400} value={project.settings.targetDurationSec} onChange={(event) => updateSettings({ targetDurationSec: Number(event.target.value) || 60 })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" /></label>
        <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="w-full rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 hover:bg-white/5">{advancedOpen ? storyT('collapseAdvanced') : storyT('advanced')}</button>
        {advancedOpen && <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
          {renderProductionSettings()}
          <label className="flex items-center justify-between text-[11px] text-white/50"><span>{storyT('nativeAudio')}</span><input type="checkbox" checked={project.settings.generateAudio} onChange={(event) => updateSettings({ generateAudio: event.target.checked })} /></label>
          <label className="block text-[11px] text-white/50">{storyT('assetConcurrency', { count: project.settings.maxParallelAssets })}<input type="range" min={1} max={8} value={project.settings.maxParallelAssets} onChange={(event) => updateSettings({ maxParallelAssets: Number(event.target.value) })} className="mt-1 w-full" /></label>
          <label className="block text-[11px] text-white/50">{storyT('videoConcurrency', { count: project.settings.maxParallelVideos })}<input type="range" min={1} max={8} value={project.settings.maxParallelVideos} onChange={(event) => updateSettings({ maxParallelVideos: Number(event.target.value) })} className="mt-1 w-full" /></label>
          <label className="block text-[11px] text-white/50">{storyT('maxNewTasks')}<input type="number" min={0} max={999} value={project.settings.maxNewTasksPerRun} onChange={(event) => updateSettings({ maxNewTasksPerRun: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 w-full rounded bg-zinc-900 p-2 text-xs text-white" /><span className="mt-1 block text-[9px] text-white/30">{storyT('maxNewTasksHelp')}</span></label>
        </div>}
      </aside>
    </div>
  );

  const renderShotsStage = () => (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.35fr)] gap-4">
      <section className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-3">
        <div className="mb-2 flex items-center justify-between"><div><h3 className="font-semibold text-white">{storyT('shotList')}</h3><p className="text-xs text-white/45">{storyT('shotCoverage', { covered: project.coverage.coveredBlocks, total: project.coverage.totalBlocks, shots: project.shots.length })}</p></div><button type="button" onClick={addShot} className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-2 text-amber-200" title={storyT('addShot')}><Plus size={15} /></button></div>
        <div className="space-y-2">{project.shots.map((shot, index) => <button key={shot.id} type="button" onClick={() => setSelectedShotId(shot.id)} className={`w-full rounded-xl border p-3 text-left transition ${shot.id === selectedShot?.id ? 'border-amber-300/55 bg-amber-300/10' : 'border-white/10 bg-black/15 hover:border-white/20'}`}>
          <div className="flex items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] text-white/70">{index + 1}</span><strong className="min-w-0 flex-1 truncate text-xs text-white">{shot.title}</strong><span className={`rounded-full border px-2 py-0.5 text-[9px] ${statusTone(shot.status)}`}>{shot.durationSec}s</span></div>
          <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-white/50">{shot.visualDescription || storyT('visualPending')}</p>
        </button>)}</div>
      </section>
      <section className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        {selectedShot ? <div className="space-y-3">
          <div className="flex items-center gap-2"><input value={selectedShot.title} onChange={(event) => patchShot(selectedShot.id, { title: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-white" /><button onClick={() => moveShot(selectedShot.id, -1)} className="rounded border border-white/10 p-2 text-white/60" title={storyT('moveEarlier')}><ChevronLeft size={14} /></button><button onClick={() => moveShot(selectedShot.id, 1)} className="rounded border border-white/10 p-2 text-white/60" title={storyT('moveLater')}><ChevronRight size={14} /></button><button onClick={() => handleSplitShot(selectedShot.id)} className="rounded border border-white/10 px-2 py-2 text-[10px] text-white/60" title={storyT('splitSemantic')}>{storyT('splitShort')}</button><button onClick={() => handleMergeShot(selectedShot.id)} className="rounded border border-white/10 px-2 py-2 text-[10px] text-white/60" title={storyT('mergeNext')}>{storyT('mergeShort')}</button><button onClick={() => duplicateShot(selectedShot)} className="rounded border border-white/10 p-2 text-white/60" title={storyT('copy')}><Copy size={14} /></button><button onClick={() => removeShot(selectedShot.id)} className="rounded border border-rose-400/25 p-2 text-rose-300" title={storyT('delete')}><Trash2 size={14} /></button></div>
          <div className="grid grid-cols-[110px_1fr] gap-3"><label className="text-xs text-white/55">{storyT('duration')}<input type="number" min={4} max={15} value={selectedShot.durationSec} onChange={(event) => patchShot(selectedShot.id, { durationSec: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" /></label><FieldWithLock label={storyT('visualDescription')} field="visualDescription" shot={selectedShot} onLock={toggleShotLock}><textarea value={selectedShot.visualDescription} onChange={(event) => patchShot(selectedShot.id, { visualDescription: event.target.value })} className="h-24 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white" /></FieldWithLock></div>
          <div className="grid grid-cols-2 gap-3"><FieldWithLock label={storyT('action')} field="action" shot={selectedShot} onLock={toggleShotLock}><textarea value={selectedShot.action} onChange={(event) => patchShot(selectedShot.id, { action: event.target.value })} className="h-20 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white" /></FieldWithLock><FieldWithLock label={storyT('camera')} field="camera" shot={selectedShot} onLock={toggleShotLock}><textarea value={selectedShot.camera} onChange={(event) => patchShot(selectedShot.id, { camera: event.target.value })} className="h-20 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white" /></FieldWithLock></div>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs text-white/55">{storyT('dialogueVoiceover')}<textarea value={[selectedShot.dialogue, selectedShot.voiceover].filter(Boolean).join('\n')} onChange={(event) => patchShot(selectedShot.id, { dialogue: event.target.value })} className="mt-1 h-20 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white" /></label><label className="text-xs text-white/55">{storyT('sfxAtmosphere')}<textarea value={[selectedShot.sfx, selectedShot.lighting].filter(Boolean).join('\n')} onChange={(event) => patchShot(selectedShot.id, { sfx: event.target.value })} className="mt-1 h-20 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white" /></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs text-white/55">{storyT('mustInclude')}<input value={selectedShot.mustInclude.join('；')} onChange={(event) => patchShot(selectedShot.id, { mustInclude: event.target.value.split(/[；;\n]/).map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white" /></label><label className="text-xs text-white/55">{storyT('mustNotInclude')}<input value={selectedShot.mustNotInclude.join('；')} onChange={(event) => patchShot(selectedShot.id, { mustNotInclude: event.target.value.split(/[；;\n]/).map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-rose-400/20 bg-black/20 p-2 text-xs text-white" /></label></div>
          <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-[11px] text-white/45"><strong className="text-white/65">{storyT('sourceTrace')}</strong><p className="mt-1 whitespace-pre-wrap leading-5">{selectedShot.sourceSpan.text || storyT('manualShot')}</p></div>
        </div> : <div className="grid h-full place-items-center text-sm text-white/40">{storyT('noShots')}</div>}
      </section>
    </div>
  );

  const assetActionsBlocked = busy && !assetRunActive;

  const renderAssetsStage = () => (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-4">
      <section className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        {ASSET_KIND_ORDER.map((kind) => {
          const assets = project.assets.filter((asset) => asset.kind === kind);
          const selectedKindAsset = selectedAsset?.kind === kind ? selectedAsset : null;
          return <section key={kind} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{assetKindLabel(kind)}</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">{assets.filter((asset) => asset.url).length}/{assets.length}</span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => addAsset(kind)} className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:text-amber-200" title={storyT('addAsset', { kind: assetKindLabel(kind) })}><Plus size={13} /></button>
                <button type="button" disabled={!selectedKindAsset || generatingAssetIds.has(selectedKindAsset.id)} onClick={() => selectedKindAsset && confirmRemoveAsset(selectedKindAsset)} className="rounded-lg border border-rose-300/15 p-1.5 text-rose-300/70 hover:border-rose-300/35 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-25" title={selectedKindAsset ? storyT('deleteSelectedAsset', { kind: assetKindLabel(kind), name: selectedKindAsset.name }) : storyT('selectAssetToDelete', { kind: assetKindLabel(kind) })}><Trash2 size={13} /></button>
              </div>
            </div>
            {assets.length ? <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{assets.map((asset) => {
              const generating = generatingAssetIds.has(asset.id);
              return <article key={asset.id} onClick={() => setSelectedAssetId(asset.id)} className={`overflow-hidden rounded-xl border transition ${asset.id === selectedAsset?.id ? 'border-amber-300/50' : 'border-white/10'} ${generating ? 'shadow-[0_0_24px_rgba(251,191,36,0.12)]' : ''} bg-black/20`}>
                <div className="relative aspect-video bg-white/[0.03]">
                  {asset.url
                    ? asset.kind === 'audio'
                      ? <div className="grid h-full place-items-center px-3"><LazyAudio src={asset.url} controls className="w-full" /></div>
                      : <SmartImage src={asset.url} alt={asset.name} thumbSize={720} className={`h-full w-full object-cover transition duration-500 ${generating ? 'scale-[1.02] opacity-55' : ''}`} />
                    : <div className="grid h-full place-items-center text-white/25"><PackageOpen size={30} /></div>}
                  {generating && <div className="absolute inset-0 grid place-items-center overflow-hidden bg-black/45 backdrop-blur-[1px]">
                    <span className="absolute h-24 w-24 animate-ping rounded-full border border-amber-300/20" />
                    <div className="relative flex flex-col items-center gap-1 rounded-xl border border-amber-300/30 bg-black/65 px-4 py-3 text-amber-100 shadow-xl">
                      <Loader2 size={20} className="animate-spin" />
                      <strong className="text-[11px]">{storyT('generating')}</strong>
                      <span className="text-[9px] text-white/45">{asset.url ? storyT('retainOldAsset') : storyT('creatingAsset')}</span>
                    </div>
                  </div>}
                  <span className={`absolute right-2 top-2 rounded-full border px-2 py-1 text-[9px] ${statusTone(asset.status)}`}>{generating ? storyT('generating') : displayStatus(asset.status)}</span>
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <strong className="min-w-0 flex-1 truncate text-xs text-white">{asset.name}</strong>
                    <button onClick={(event) => { event.stopPropagation(); updateAsset(asset.id, { locked: !asset.locked }); }} className="text-white/45" title={asset.locked ? storyT('unlock') : storyT('lockAsset')}>{asset.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
                    <button disabled={generating || !hasClearableAssetMedia(asset)} onClick={(event) => { event.stopPropagation(); confirmClearAssetMedia(asset); }} className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/55 hover:border-cyan-300/30 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-25" title={storyT('clearAssetTitle', { name: asset.name, material: asset.kind === 'audio' ? storyT('audio') : storyT('image') })}><Eraser size={11} />{storyT('clear')}</button>
                    <button disabled={generating} onClick={(event) => { event.stopPropagation(); confirmRemoveAsset(asset); }} className="text-rose-300/65 hover:text-rose-200 disabled:opacity-25" title={storyT('deleteNamed', { name: asset.name })}><Trash2 size={13} /></button>
                  </div>
                  <p className="line-clamp-2 min-h-9 text-[10px] leading-4 text-white/45">{asset.description || storyT('assetDescriptionHint')}</p>
                  {asset.error && <p className="text-[10px] text-rose-300">{asset.error}</p>}
                  <div className={`grid ${kind === 'audio' ? 'grid-cols-3' : 'grid-cols-4'} gap-1`}>
                    <label className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-white/10 px-2 py-2 text-[10px] text-white/65 hover:bg-white/5"><Upload size={11} />{storyT('computer')}<input type="file" accept={kind === 'audio' ? 'audio/*' : 'image/*'} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleAssetUpload(asset, file); event.currentTarget.value = ''; }} /></label>
                    <button onClick={(event) => { event.stopPropagation(); useUpstreamAsset(asset); }} className="flex items-center justify-center gap-1 rounded-lg border border-white/10 px-2 py-2 text-[10px] text-white/65"><ImagePlus size={11} />{storyT('upstream')}</button>
                    {kind !== 'audio' && <button onClick={(event) => { event.stopPropagation(); openResourcePicker(asset); }} className="flex items-center justify-center gap-1 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.06] px-2 py-2 text-[10px] text-cyan-100"><Library size={11} />{storyT('resourceLibrary')}</button>}
                    <button disabled={assetActionsBlocked || generating || asset.locked || kind === 'audio' && Boolean(asset.url)} onClick={(event) => { event.stopPropagation(); requestAssetRun(asset.id); }} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-30 ${generating ? 'animate-pulse border-amber-200/50 bg-amber-200/15 text-amber-100' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'}`} title={asset.url && kind !== 'audio' ? storyT('regenerateHelp') : storyT('aiGenerate')}>{generating ? <Loader2 size={11} className="animate-spin" /> : <WandSparkles size={11} />}{generating ? storyT('generating') : asset.url && kind !== 'audio' ? storyT('regenerateShort') : 'AI'}</button>
                  </div>
                </div>
              </article>;
            })}</div> : <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-[10px] text-white/30">{storyT('noAssetKind', { kind: assetKindLabel(kind) })}</div>}
          </section>;
        })}
      </section>
      <aside className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        {selectedAsset ? <div className="space-y-3">
          <div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-sm text-white">{storyT('assetDetails')}</strong><button onClick={() => updateAsset(selectedAsset.id, { locked: !selectedAsset.locked })} className={selectedAsset.locked ? 'text-amber-200' : 'text-white/40'}>{selectedAsset.locked ? <Lock size={14} /> : <Unlock size={14} />}</button><button disabled={generatingAssetIds.has(selectedAsset.id)} onClick={() => confirmRemoveAsset(selectedAsset)} className="text-rose-300 disabled:opacity-25" title={storyT('deleteNamed', { name: selectedAsset.name })}><Trash2 size={14} /></button></div>
          <label className="block text-[11px] text-white/50">{storyT('name')}<input value={selectedAsset.name} onChange={(event) => updateAsset(selectedAsset.id, { name: event.target.value }, true)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-white" /></label>
          <label className="block text-[11px] text-white/50">{storyT('type')}<select value={selectedAsset.kind} onChange={(event) => updateAsset(selectedAsset.id, { kind: event.target.value as StoryAssetKind }, true)} className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-white">{ASSET_KIND_ORDER.map((kind) => <option key={kind} value={kind}>{assetKindLabel(kind)}</option>)}</select></label>
          <label className="block text-[11px] text-white/50">{storyT('description')}<textarea value={selectedAsset.description} onChange={(event) => updateAsset(selectedAsset.id, { description: event.target.value }, true)} className="mt-1 h-24 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white" /></label>
          <label className="block text-[11px] text-white/50">{storyT('aiPrompt')}<textarea value={selectedAsset.prompt} onChange={(event) => updateAsset(selectedAsset.id, { prompt: event.target.value }, true)} className="mt-1 h-28 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white" /></label>
          <label className="block text-[11px] text-white/50">{storyT('negativePrompt')}<textarea value={selectedAsset.negativePrompt} onChange={(event) => updateAsset(selectedAsset.id, { negativePrompt: event.target.value }, true)} className="mt-1 h-16 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white" /></label>
          {selectedAsset.kind === 'character' && <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-[10px] leading-4 text-emerald-100">{storyT('characterSpec')}</div>}
          {selectedAsset.kind === 'costume' && <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-[10px] leading-4 text-cyan-100">{selectedAssetReferenceNames ? storyT('costumeSpecWithReference', { names: selectedAssetReferenceNames }) : storyT('costumeSpecNoReference')}</div>}
          <div><div className="mb-2 text-[11px] text-white/50">{storyT('usedByShots')}</div><div className="flex max-h-32 flex-wrap gap-1 overflow-auto">{project.shots.map((shot, index) => { const linked = shot.assetIds.includes(selectedAsset.id); return <button key={shot.id} onClick={() => toggleAssetShot(selectedAsset.id, shot.id)} className={`rounded-lg border px-2 py-1 text-[9px] ${linked ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : 'border-white/10 text-white/40'}`}>#{index + 1} {shot.title}</button>; })}</div></div>
          <div className={`grid ${selectedAsset.kind === 'audio' ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
            <button disabled={assetActionsBlocked || generatingAssetIds.has(selectedAsset.id) || selectedAsset.locked || selectedAsset.kind === 'audio' && Boolean(selectedAsset.url)} onClick={() => requestAssetRun(selectedAsset.id)} className={`rounded-lg border px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-30 ${generatingAssetIds.has(selectedAsset.id) ? 'animate-pulse border-amber-200/50 bg-amber-200/15 text-amber-100' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'}`} title={selectedAsset.url && selectedAsset.kind !== 'audio' ? storyT('regenerateHelp') : storyT('aiGenerate')}>{generatingAssetIds.has(selectedAsset.id) ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : <WandSparkles size={12} className="mr-1 inline" />}{generatingAssetIds.has(selectedAsset.id) ? storyT('generating') : selectedAsset.url && selectedAsset.kind !== 'audio' ? storyT('regenerate') : storyT('aiGenerate')}</button>
            {selectedAsset.kind !== 'audio' && <button onClick={() => openResourcePicker(selectedAsset)} className="rounded-lg border border-cyan-300/25 bg-cyan-300/[0.06] px-3 py-2 text-xs text-cyan-100"><Library size={12} className="mr-1 inline" />{storyT('resourceLibrary')}</button>}
            <button disabled={!hasClearableAssetMedia(selectedAsset) || generatingAssetIds.has(selectedAsset.id)} onClick={() => confirmClearAssetMedia(selectedAsset)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-30" title={storyT('clearAssetHelp')}><Eraser size={12} className="mr-1 inline" />{storyT('clearAsset')}</button>
          </div>
          {selectedAsset.taskId && <div className="break-all rounded-lg border border-white/10 bg-black/20 p-2 text-[9px] text-white/30">{storyT('task')} {selectedAsset.taskId} · {selectedAsset.taskProvider || 'unknown'}</div>}
        </div> : <div className="grid h-full place-items-center text-center text-xs text-white/35"><div><PackageOpen className="mx-auto mb-2" /><p>{storyT('selectAssetToEdit')}</p></div></div>}
      </aside>
    </div>
  );

  const renderPromptsStage = () => (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 grid grid-cols-3 gap-3"><Metric label={storyT('scriptCoverage')} value={`${project.coverage.percent}%`} ok={project.coverage.percent === 100} /><Metric label={storyT('hardConstraintLoss')} value={String(project.coverage.hardConstraintLosses.length)} ok={project.coverage.hardConstraintLosses.length === 0} /><Metric label={storyT('continuityIssues')} value={String(project.coverage.continuityIssues.length)} ok={!project.coverage.continuityIssues.some((issue) => issue.severity === 'error')} /></div><div className="space-y-3">{project.shots.map((shot, index) => <article key={shot.id} className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="mb-2 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-amber-300/10 text-[10px] text-amber-200">{index + 1}</span><strong className="flex-1 text-xs text-white">{shot.title}</strong><button onClick={() => toggleShotLock(shot, 'finalPrompt')} className="text-white/45">{shot.lockedFields.includes('finalPrompt') ? <Lock size={13} /> : <Unlock size={13} />}</button></div><textarea value={shot.finalPrompt} onChange={(event) => patchShot(shot.id, { finalPrompt: event.target.value })} placeholder={storyT('compilePromptPlaceholder')} className="h-36 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-white/75 outline-none" /><p className="mt-2 text-[10px] text-rose-200/70">{storyT('negative')}: {shot.negativePrompt || storyT('pendingCompile')}</p></article>)}</div></div>
  );

  const renderVideosStage = () => (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{project.shots.map((shot, index) => <article key={shot.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/20"><div className="relative aspect-video bg-black">{shot.videoUrl ? <LazyVideo src={shot.videoUrl} controls className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-white/25">{ACTIVE_TASK_STATUSES.has(shot.status) ? <Loader2 className="animate-spin" /> : <Film />}</div>}<span className={`absolute right-2 top-2 rounded-full border px-2 py-1 text-[9px] ${statusTone(shot.status)}`}>{displayStatus(shot.status)}</span></div><div className="p-3"><div className="flex gap-2"><span className="text-[10px] text-white/35">#{index + 1}</span><strong className="min-w-0 flex-1 truncate text-xs text-white">{shot.title}</strong><span className="text-[10px] text-white/45">{shot.durationSec}s</span></div>{shot.error && <p className="mt-2 text-[10px] text-rose-300">{shot.error}</p>}</div></article>)}</div></div>
  );

  const composeRunning = ACTIVE_TASK_STATUSES.has(project.composeTaskStatus);
  const renderComposeStage = () => (
    <div
      data-story-compose-state={project.composeTaskStatus}
      className="grid min-h-0 flex-1 place-items-center rounded-2xl border border-white/10 bg-white/[0.025] p-6"
    >
      <div className="w-full max-w-4xl text-center">
        {project.finalVideoUrl ? (
          <LazyVideo src={project.finalVideoUrl} controls className="mx-auto max-h-[58vh] w-full rounded-2xl bg-black shadow-2xl" />
        ) : (
          <div className={`mx-auto grid aspect-video max-w-3xl place-items-center rounded-2xl border border-dashed bg-black/20 ${project.composeTaskStatus === 'failed' ? 'border-rose-300/30' : composeRunning ? 'border-amber-300/30' : 'border-white/15'}`}>
            <div className={project.composeTaskStatus === 'failed' ? 'text-rose-200/80' : composeRunning ? 'text-amber-100/80' : 'text-white/30'}>
              {composeRunning ? <Loader2 className="mx-auto mb-3 animate-spin" size={36} /> : project.composeTaskStatus === 'failed' ? <AlertTriangle className="mx-auto mb-3" size={36} /> : <Clapperboard className="mx-auto mb-3" size={36} />}
              <p className="font-medium">
                {composeRunning ? storyT('composingPleaseWait') : project.composeTaskStatus === 'failed' ? storyT('lastComposeFailed') : storyT('composeWhenReady')}
              </p>
              {composeRunning && <p className="mt-2 text-xs opacity-60">{storyT('ffmpegComposeHelp')}</p>}
            </div>
          </div>
        )}
        <h3 className="mt-5 text-xl font-semibold text-white">{project.title}</h3>
        <p className="mt-2 text-sm text-white/45">{storyT('projectSummary', { shots: project.shots.length, seconds: project.shots.reduce((sum, shot) => sum + shot.durationSec, 0), ratio: project.settings.aspectRatio })}</p>
        {project.composeTaskStatus === 'failed' && project.lastError && (
          <div data-story-compose-error="true" className="mx-auto mt-4 max-w-3xl rounded-xl border border-rose-300/25 bg-rose-300/[0.06] px-4 py-3 text-left text-xs leading-5 text-rose-100">
            <strong className="block text-rose-200">{storyT('composeFailed')}</strong>
            <span className="break-words text-rose-100/75">{storyRuntimeText(project.lastError)}</span>
          </div>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => materializeLinkedNodes()} className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/70">{storyT('openLinkedEditors')}</button>
          {project.finalVideoUrl && <a href={project.finalVideoUrl} download className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs text-emerald-200">{storyT('downloadFinal')}</a>}
        </div>
      </div>
    </div>
  );

  const mainAction = activeStage === 'script'
    ? { label: runLabel('analyze'), mode: 'analyze' as StoryRunMode, disabled: !project.script.trim() }
    : activeStage === 'shots'
      ? { label: storyT('confirmShots'), mode: 'review-assets' as const, disabled: !project.shots.length }
      : activeStage === 'assets'
        ? { label: progress.assets.missing ? storyT('generateMissingAssets', { count: progress.assets.missing }) : storyT('assetsReadyCompile'), mode: progress.assets.missing ? 'assets-missing' as StoryRunMode : 'compile' as StoryRunMode, disabled: !project.shots.length }
        : activeStage === 'prompts'
          ? { label: project.shots.every((shot) => shot.finalPrompt) ? storyT('generateShotVideos', { count: project.shots.filter((shot) => !shot.videoUrl).length }) : storyT('compileAllPrompts'), mode: project.shots.every((shot) => shot.finalPrompt) ? 'videos-missing' as StoryRunMode : 'compile' as StoryRunMode, disabled: !project.shots.length }
          : activeStage === 'videos'
            ? { label: progress.videos.completed === progress.videos.total && progress.videos.total > 0 ? runLabel('compose') : runLabel('videos-missing'), mode: progress.videos.completed === progress.videos.total && progress.videos.total > 0 ? 'compose' as StoryRunMode : 'videos-missing' as StoryRunMode, disabled: !project.shots.length }
            : { label: project.finalVideoUrl || project.composeTaskStatus === 'failed' ? storyT('recompose') : runLabel('compose'), mode: 'compose' as StoryRunMode, disabled: !project.shots.length || progress.videos.completed !== progress.videos.total };

  const resourcePickerTarget = project.assets.find((asset) => asset.id === resourcePickerAssetId);
  const resourcePicker = resourcePickerAssetId ? (
    <div className="fixed inset-0 z-[1100] grid place-items-center bg-black/70 p-5 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) closeResourcePicker(); }}>
      <section className="flex max-h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cyan-300/25 bg-[#101511] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3"><div className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100"><Library size={17} /></div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-white">{storyT('chooseLibraryImage')}</h3><p className="truncate text-[10px] text-white/45">{storyT('bindResourceTo', { name: resourcePickerTarget?.name || storyT('currentAsset') })}</p></div><button type="button" onClick={closeResourcePicker} className="rounded-lg border border-white/10 p-2 text-white/55" title={storyT('close')}><X size={15} /></button></header>
        <div className="border-b border-white/10 p-3"><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-white/55"><Search size={14} /><input autoFocus value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder={storyT('searchImages')} className="nowheel nodrag min-w-0 flex-1 bg-transparent text-xs text-white outline-none" /></label>{resourceMessage && <p className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-[10px] text-rose-200">{resourceMessage}</p>}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{resourceLoading ? <div className="grid h-48 place-items-center text-xs text-white/40"><span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" />{storyT('loadingLibrary')}</span></div> : resourceItems.length === 0 ? <div className="grid h-48 place-items-center text-xs text-white/35">{storyT('noLibraryImages')}</div> : <div className="grid grid-cols-3 gap-3 md:grid-cols-4 xl:grid-cols-5">{resourceItems.slice(0, 100).map((item) => <button type="button" key={item.id} onClick={() => handlePickResourceItem(item)} className="group overflow-hidden rounded-xl border border-white/10 bg-black/20 p-1.5 text-left hover:border-cyan-300/45 hover:bg-cyan-300/[0.05]" title={item.title}><div className="aspect-square overflow-hidden rounded-lg bg-black/40"><SmartImage src={item.thumbUrl || item.fileUrl} alt={item.title || storyT('libraryImage')} thumbSize={220} className="h-full w-full object-cover transition group-hover:scale-[1.02]" /></div><div className="mt-1.5 truncate px-1 text-[10px] font-medium text-white/75">{item.title || storyT('unnamedImage')}</div>{item.tags?.length > 0 && <div className="truncate px-1 text-[9px] text-white/30">{item.tags.slice(0, 3).join(' · ')}</div>}</button>)}</div>}</div>
      </section>
    </div>
  ) : null;

  const workbench = workbenchOpen && typeof document !== 'undefined' ? createPortal(
    <div data-story-workbench="true" className="fixed inset-0 z-[1000] flex flex-col bg-[#090b0a] text-white" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-white/10 px-5"><div className="grid h-9 w-9 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-amber-200"><BookOpenText size={18} /></div><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{storyT('workbenchTitle', { title: project.title })}</h2><p className="text-[10px] text-white/45">{storyT('workbenchSummary', { progress: compactProgress, coverage: project.coverage.percent, revision: project.productionRevision })}</p></div><div className="ml-auto flex items-center gap-2"><button onClick={() => downloadJson(project)} className="rounded-lg border border-white/10 p-2 text-white/55" title={storyT('exportJson')}><Download size={15} /></button><button onClick={() => { closeResourcePicker(); setWorkbenchOpen(false); }} className="rounded-lg border border-white/10 p-2 text-white/65" title={storyT('close')}><X size={16} /></button></div></header>
      <nav className="shrink-0 border-b border-white/10 px-5 py-3"><div className="mx-auto flex max-w-6xl items-center">{STAGE_ORDER.map((stage, index) => { const state = project.stages[stage]; const active = activeStage === stage; return <div key={stage} className="flex min-w-0 flex-1 items-center"><button onClick={() => setActiveStage(stage)} className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left ${active ? 'bg-amber-300/10 text-amber-100' : 'text-white/45 hover:bg-white/[0.03]'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] ${state.status === 'succeeded' ? 'border-emerald-300/35 bg-emerald-300/10 text-emerald-200' : active ? 'border-amber-300/50 text-amber-200' : 'border-white/10'}`}>{state.status === 'succeeded' ? <Check size={11} /> : index + 1}</span><span className="min-w-0"><span className="block truncate text-xs font-medium">{stageLabel(stage)}</span><span className="block truncate text-[9px] opacity-60">{state.message ? storyRuntimeText(state.message) : `${state.completed}/${state.total}`}</span></span></button>{index < STAGE_ORDER.length - 1 && <div className="h-px flex-1 bg-white/10" />}</div>; })}</div></nav>
      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col p-4">{activeStage === 'script' ? renderScriptStage() : activeStage === 'shots' ? renderShotsStage() : activeStage === 'assets' ? renderAssetsStage() : activeStage === 'prompts' ? renderPromptsStage() : activeStage === 'videos' ? renderVideosStage() : renderComposeStage()}</main>
      <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-black/25 px-5 py-3"><div className="min-w-0 flex-1 text-xs text-white/50">{localMessage || project.lastError ? storyRuntimeText(localMessage || project.lastError) : storyT('autosaveHelp')}</div>{(progress.assets.failed > 0 || progress.videos.failed > 0) && <button disabled={busy} onClick={() => requestRun('retry-failed')} className="rounded-xl border border-rose-300/25 px-4 py-2.5 text-xs text-rose-200 disabled:opacity-40"><RefreshCw size={13} className="mr-1 inline" />{storyT('retryFailedOnly')}</button>}{runRequestPending ? <button type="button" disabled className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-5 py-2.5 text-xs font-semibold text-amber-100"><Loader2 size={14} className="mr-1 inline animate-spin" />{storyT('submitting')}</button> : busy ? <button onClick={() => void stopRun()} className="rounded-xl border border-rose-300/30 bg-rose-300/10 px-5 py-2.5 text-xs font-semibold text-rose-200"><Pause size={14} className="mr-1 inline" />{storyT('stop')}</button> : <><button onClick={() => requestRun('all')} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-white/70"><Sparkles size={13} className="mr-1 inline" />{storyT('produceAll')}</button><button disabled={mainAction.disabled} onClick={() => mainAction.mode === 'review-assets' ? enterAssetReview() : requestRun(mainAction.mode)} className="rounded-xl bg-gradient-to-r from-lime-300 to-emerald-300 px-6 py-2.5 text-xs font-bold text-black shadow-lg shadow-emerald-500/10 disabled:opacity-35"><Play size={13} className="mr-1 inline fill-current" />{mainAction.label}</button></>}</footer>
      {resourcePicker}
    </div>, document.body) : null;

  return <>
    <div className={`relative w-[350px] overflow-hidden rounded-2xl border-2 bg-[#111611]/95 shadow-2xl transition ${selected ? 'border-amber-300/70 shadow-amber-500/10' : 'border-white/10 hover:border-white/20'}`}>
      <Handle type="target" position={Position.Left} className="!h-4 !w-4 !border-2 !border-[#111611] !bg-amber-300" />
      <Handle type="source" position={Position.Right} className="!h-4 !w-4 !border-2 !border-[#111611] !bg-amber-300" />
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3"><div className="grid h-9 w-9 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-amber-200"><BookOpenText size={18} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-white">{storyT('compactTitle')}</div><div className="truncate text-[10px] text-white/40">{project.title} · {stageLabel(project.stage)}</div></div><button type="button" onClick={() => setCompactSettingsOpen((value) => !value)} className={`nodrag rounded-lg border p-1.5 ${compactSettingsOpen ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : 'border-white/10 text-white/45'}`} title={storyT('productionModels')}><Settings2 size={13} /></button><span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[9px] text-amber-200">{progress.percent}%</span></div>
      <div className="space-y-3 p-3" onMouseDown={(event) => event.stopPropagation()}><div className="grid grid-cols-3 gap-2"><Metric label={storyT('shots')} value={String(project.shots.length)} ok={project.shots.length > 0} compact /><Metric label={storyT('missingAssets')} value={String(progress.assets.missing)} ok={progress.assets.missing === 0 && progress.assets.total > 0} compact /><Metric label={storyT('videos')} value={`${progress.videos.completed}/${progress.videos.total}`} ok={progress.videos.total > 0 && progress.videos.completed === progress.videos.total} compact /></div>
        {compactSettingsOpen && renderProductionSettings(true)}
        <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="mb-2 flex items-center justify-between text-[10px] text-white/45"><span>{stageLabel(project.stage)}</span><span>{compactProgress}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-300 transition-all" style={{ width: `${progress.percent}%` }} /></div>{project.lastError && <div className="mt-2 flex gap-1 text-[10px] text-rose-300"><AlertTriangle size={12} className="shrink-0" /><span className="line-clamp-2">{storyRuntimeText(project.lastError)}</span></div>}</div>
        <button onClick={() => { setWorkbenchOpen(true); setActiveStage(project.stage); }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-medium text-white/80 hover:bg-white/[0.07]"><Maximize2 size={14} />{storyT('openWorkbench')}</button>
        <div className="grid grid-cols-2 gap-2">{busy ? <button onClick={() => void stopRun()} className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2.5 text-xs text-rose-200"><Pause size={13} />{storyT('stopFlow')}</button> : <><button onClick={() => requestRun('retry-failed')} disabled={progress.assets.failed + progress.videos.failed === 0} className="rounded-xl border border-white/10 px-3 py-2.5 text-[11px] text-white/65 disabled:opacity-30"><RefreshCw size={12} className="mr-1 inline" />{storyT('retryFailed')}</button><button onClick={() => requestRun('all')} className="rounded-xl bg-gradient-to-r from-lime-300 to-emerald-300 px-3 py-2.5 text-[11px] font-bold text-black"><Sparkles size={12} className="mr-1 inline" />{storyT('produce')}</button></>}</div>
      </div>
    </div>
    {workbench}
  </>;
};

function Metric({ label, value, ok, compact = false }: { label: string; value: string; ok: boolean; compact?: boolean }) {
  return <div className={`rounded-xl border ${ok ? 'border-emerald-300/20 bg-emerald-300/[0.06]' : 'border-white/10 bg-white/[0.025]'} ${compact ? 'p-2 text-center' : 'p-3'}`}><div className="text-[9px] text-white/40">{label}</div><div className={`${compact ? 'mt-0.5 text-xs' : 'mt-1 text-lg'} font-semibold ${ok ? 'text-emerald-200' : 'text-white'}`}>{value}</div></div>;
}

function FieldWithLock({ label, field, shot, onLock, children }: { label: string; field: keyof StoryShot; shot: StoryShot; onLock: (shot: StoryShot, field: keyof StoryShot) => void; children: React.ReactNode }) {
  const locked = shot.lockedFields.includes(field);
  return <label className="block text-xs text-white/55"><span className="mb-1 flex items-center justify-between"><span>{label}</span><button type="button" onClick={() => onLock(shot, field)} className={locked ? 'text-amber-200' : 'text-white/35'}>{locked ? <Lock size={12} /> : <Unlock size={12} />}</button></span>{children}</label>;
}

export default memo(StoryNode);
