import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { localizeLegacyRuntimeText } from '../../i18n/legacyRuntimeText';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import {
  AlertTriangle,
  AudioLines,
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileInput,
  Film,
  Hand,
  Image as ImageIcon,
  Layers3,
  Lock,
  Magnet,
  Maximize2,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as api from '../../services/api';
import { generateExternalLlm, generateLlm } from '../../services/generation';
import { probeVideo } from '../../services/videoOps';
import { useCanvasStore } from '../../stores/canvas';
import { useApiKeysStore } from '../../stores/apiKeys';
import { LLM_MODELS, isImageOutputLlm } from '../../providers/models';
import { SEEDANCE_NZ_LLM_MODELS, resolveSeedanceNzLlmModel } from '../../config/llm';
import { advancedProviderModelOptions, advancedProvidersForNode } from '../../utils/advancedProviders';
import {
  DEFAULT_SCRIPT_MASTER_TARGET,
  SCRIPT_MASTER_DOMAIN_PACKS,
  addScriptMasterAsset,
  adoptScriptMasterAnalysisCandidate,
  appendScriptMasterShot,
  applyScriptMasterCompilation,
  beginScriptMasterAnalysis,
  buildScriptMasterDownstreamPayloads,
  compileScriptMasterProject,
  createScriptMasterAnalysisRequest,
  createEmptyScriptMasterProject,
  distributeScriptMasterShotDurations,
  duplicateScriptMasterTimelineItems,
  duplicateScriptMasterShot,
  effectiveScriptMasterBindingsForShot,
  formatScriptMasterTimecode,
  importScriptMasterSource,
  mergeScriptMasterTimelineItems,
  failScriptMasterAnalysis,
  moveScriptMasterTimelineItems,
  patchScriptMasterBinding,
  patchScriptMasterAssetMetadata,
  parseScriptMasterAnalysisCandidate,
  patchScriptMasterProjectSettings,
  patchScriptMasterProviderSelection,
  patchScriptMasterShot,
  patchScriptMasterTimelineTrack,
  patchScriptMasterTimelineView,
  rationalTime,
  rangeDurationFrames,
  recordScriptMasterDownstreamApply,
  recordScriptMasterAnalysisCandidate,
  rejectScriptMasterAnalysisCandidate,
  removeScriptMasterAsset,
  removeScriptMasterShot,
  removeScriptMasterTimelineItems,
  restoreScriptMasterProjectSnapshot,
  sanitizeScriptMasterProject,
  selectScriptMasterCompileTarget,
  scriptMasterExportBundle,
  scriptMasterProjectSummary,
  splitScriptMasterTimelineItem,
  trimScriptMasterTimelineItem,
  type ScriptMasterAsset,
  type ScriptMasterAssetKind,
  type ScriptMasterAnalysisCandidate,
  type ScriptMasterBinding,
  type ScriptMasterCompilation,
  type ScriptMasterDomain,
  type ScriptMasterDownstreamNodePayload,
  type ScriptMasterDownstreamTarget,
  type ScriptMasterProject,
  type ScriptMasterScope,
  type ScriptMasterShot,
  type ScriptMasterTimelineItem,
  type ScriptMasterTimelineTrack,
} from '../../utils/scriptMaster';
import {
  CANVAS_PATCH_DRAFT_MAX_OPERATIONS,
  type CanvasPatchDraft,
  type CanvasPatchDraftOperation,
} from '../../utils/workflowDoctor';
import {
  applyScriptMasterCanvasPatch,
  previewScriptMasterCanvasPatch,
  type ScriptMasterCanvasPatchPreviewResult,
} from '../../utils/scriptMasterCanvasBridge';
import { defaultSizeOf, placeBatchNodes, type Rect as PlacementRect } from '../../utils/nodePlacement';
import {
  applyVideoEditTimelineControllerCommand,
  normalizeVideoEditTimelineControllerState,
  type VideoEditTimelineControllerCommand,
  type VideoEditTimelineControllerState,
  type VideoEditTimelineControllerTool,
} from '../../utils/videoTimeline';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import LazyVideo from '../LazyVideo';
import SmartImage from '../SmartImage';

const DOMAIN_OPTIONS: Array<{ value: ScriptMasterDomain; label: string }> = [
  { value: 'unconfirmed', label: '待确认类型' },
  { value: 'narrative', label: '叙事 / 短剧' },
  { value: 'ecommerce', label: '电商 / 产品' },
  { value: 'advertising', label: '广告 / 品牌' },
  { value: 'music-video', label: 'MV / 音乐' },
  { value: 'documentary', label: '纪录 / 访谈' },
  { value: 'tutorial', label: '口播 / 教学' },
];

const SCOPE_LABELS: Record<ScriptMasterScope, string> = {
  project: '全片',
  scene: '本场',
  shot: '本镜',
  custom: '自定义',
};

const GROUP_LABELS: Record<ScriptMasterTimelineTrack['group'], string> = {
  picture: '画面',
  transition: '转场',
  reference: '参考',
  dialogue: '台词',
  sound: '声音',
};

const DOWNSTREAM_TARGET_LABELS: Record<ScriptMasterDownstreamTarget, string> = {
  story: 'Story 生产',
  'director-storyboard': '导演分镜',
  seedance: 'Seedance 视频',
  audio: '音频计划',
  'video-edit': '剪辑工程',
};

const SCRIPT_MASTER_TIMELINE_RULER_HEIGHT = 36;
const SCRIPT_MASTER_TIMELINE_ROW_HEIGHT = 48;
const SCRIPT_MASTER_TIMELINE_LABEL_WIDTH = 240;
const SCRIPT_MASTER_TIMELINE_VERTICAL_OVERSCAN = 6;
const SCRIPT_MASTER_ASSET_ROW_HEIGHT = 124;
const SCRIPT_MASTER_ASSET_OVERSCAN = 4;

const TIMELINE_TOOL_LABELS: Array<{ tool: VideoEditTimelineControllerTool; label: string }> = [
  { tool: 'select', label: '选择' },
  { tool: 'trim', label: '修剪' },
  { tool: 'blade', label: '切刀' },
  { tool: 'hand', label: '平移' },
  { tool: 'range', label: '框选' },
];

interface ScriptMasterHistoryState {
  projectId: string;
  past: ScriptMasterProject[];
  future: ScriptMasterProject[];
  lastKey: string;
  lastRecordedAt: number;
}

interface ScriptMasterCommitOptions {
  recordHistory?: boolean;
  historyKey?: string;
  forceHistoryBoundary?: boolean;
  viewOnly?: boolean;
}

interface ScriptMasterPointerDrag {
  mode: 'move' | 'trim';
  itemId: string;
  itemIds: string[];
  edge?: 'start' | 'end';
  startClientX: number;
  pixelsPerFrame: number;
  originalProject: ScriptMasterProject;
  lastDeltaFrames: number;
  changed: boolean;
}

interface ScriptMasterMarqueeState {
  left: number;
  top: number;
  width: number;
  height: number;
}

function projectOutputText(project: ScriptMasterProject, compilation?: ScriptMasterCompilation): string {
  const summary = scriptMasterProjectSummary(project);
  const header = `剧本大师：${project.title}\n${summary.shots} 镜 · ${(summary.durationSeconds || 0).toFixed(2)}s · ${summary.images} 图 / ${summary.audios} 音频`;
  return compilation?.humanPrompt ? `${header}\n\n${compilation.humanPrompt}` : header;
}

function safeFilename(value: string): string {
  return (value || 'script-master').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 96) || 'script-master';
}

function scriptMasterHistoryStorageKey(canvasId: string | null, nodeId: string, projectId: string) {
  return `t8-script-master-history-v1:${canvasId || 'local'}:${nodeId}:${projectId}`;
}

function loadPersistedScriptMasterHistory(key: string, projectId: string): Pick<ScriptMasterHistoryState, 'past' | 'future'> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    const sanitize = (items: unknown) => Array.isArray(items)
      ? items.slice(-20).map((item) => sanitizeScriptMasterProject(item)).filter((item) => item.projectId === projectId)
      : [];
    return { past: sanitize(raw.past), future: sanitize(raw.future) };
  } catch {
    return { past: [], future: [] };
  }
}

function persistScriptMasterHistory(key: string, history: ScriptMasterHistoryState) {
  try {
    localStorage.setItem(key, JSON.stringify({
      schema: 't8-script-master-history-v1',
      projectId: history.projectId,
      past: history.past.slice(-20),
      future: history.future.slice(0, 20),
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Canvas 当前项目仍是权威自动保存；历史缓存写满时只降级撤销深度。
  }
}

function waitForImageMetadata(url: string, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const abort = () => { image.src = ''; reject(new DOMException('媒体探测已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      signal.removeEventListener('abort', abort);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('图片不可读取或已失效'));
    };
    image.src = url;
  });
}

function waitForAudioMetadata(url: string, signal: AbortSignal): Promise<{ duration: number; mime: string }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const cleanup = () => { audio.removeAttribute('src'); audio.load(); };
    const abort = () => { cleanup(); reject(new DOMException('媒体探测已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    audio.onloadedmetadata = () => {
      signal.removeEventListener('abort', abort);
      const duration = Number(audio.duration);
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error('音频时长不可读'));
      else resolve({ duration, mime: '' });
    };
    audio.onerror = () => {
      signal.removeEventListener('abort', abort);
      cleanup();
      reject(new Error('音频不可读取或已失效'));
    };
    audio.src = url;
  });
}

async function sampleScriptMasterWaveform(url: string, signal: AbortSignal, peakCount = 64): Promise<number[]> {
  const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext as typeof AudioContext | undefined;
  if (!AudioContextConstructor) return [];
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`波形读取失败（HTTP ${response.status}）`);
  const bytes = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException('媒体探测已取消', 'AbortError');
  const context = new AudioContextConstructor();
  try {
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (signal.aborted) throw new DOMException('媒体探测已取消', 'AbortError');
    const channel = buffer.getChannelData(0);
    const windowSize = Math.max(1, Math.floor(channel.length / peakCount));
    const peaks = Array.from({ length: peakCount }, (_, index) => {
      const start = index * windowSize;
      const end = index === peakCount - 1 ? channel.length : Math.min(channel.length, start + windowSize);
      let peak = 0;
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) peak = Math.max(peak, Math.abs(channel[sampleIndex] || 0));
      return peak;
    });
    const maximum = Math.max(...peaks, 0.0001);
    return peaks.map((peak) => Math.max(0.04, Math.min(1, peak / maximum)));
  } finally {
    await context.close().catch(() => {});
  }
}

async function probeScriptMasterAsset(asset: ScriptMasterAsset, fps: number, signal: AbortSignal) {
  if (!asset.url) throw new Error('素材没有可探测 URL');
  if (asset.mediaKind === 'image') {
    const metadata = await waitForImageMetadata(asset.url, signal);
    return { ...metadata, durationFrames: null, mime: asset.mime, hasAudio: null as boolean | null };
  }
  if (asset.mediaKind === 'video') {
    const metadata = await probeVideo(asset.url);
    if (signal.aborted) throw new DOMException('媒体探测已取消', 'AbortError');
    const durationSeconds = typeof metadata.duration === 'number' ? metadata.duration : Number.NaN;
    return {
      durationFrames: Number.isFinite(durationSeconds) ? Math.max(1, Math.round(durationSeconds * fps)) : null,
      width: metadata.width || null,
      height: metadata.height || null,
      mime: metadata.mime || asset.mime,
      hasAudio: typeof metadata.hasAudio === 'boolean' ? metadata.hasAudio : null,
    };
  }
  const metadata = await waitForAudioMetadata(asset.url, signal);
  let waveformPeaks: number[] = [];
  try {
    waveformPeaks = await sampleScriptMasterWaveform(asset.url, signal);
  } catch (error: any) {
    if (signal.aborted || error?.name === 'AbortError') throw error;
  }
  return {
    durationFrames: Math.max(1, Math.round(metadata.duration * fps)),
    width: null,
    height: null,
    mime: metadata.mime || asset.mime,
    hasAudio: true,
    waveformPeaks,
  };
}

function analysisCandidateChangeCount(candidate?: ScriptMasterAnalysisCandidate | null) {
  return candidate?.shotSuggestions.reduce((sum, suggestion) => sum + Object.keys(suggestion.fields).length, 0) || 0;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function assetKindForFile(file: File): ScriptMasterAssetKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'dialogue-audio';
  return null;
}

function domainLabel(domain: ScriptMasterDomain): string {
  return DOMAIN_OPTIONS.find((option) => option.value === domain)?.label || '待确认类型';
}

function assetTone(asset: ScriptMasterAsset): string {
  if (asset.mediaKind === 'image') return 'border-cyan-300/25 bg-cyan-300/[0.07] text-cyan-100';
  if (asset.mediaKind === 'video') return 'border-fuchsia-300/25 bg-fuchsia-300/[0.07] text-fuchsia-100';
  return 'border-amber-300/25 bg-amber-300/[0.07] text-amber-100';
}

function timelineItemTone(item: ScriptMasterTimelineItem, track: ScriptMasterTimelineTrack): string {
  if (track.group === 'picture') return 'border-sky-300/35 bg-sky-400/25 text-sky-50';
  if (track.group === 'transition') return 'border-violet-300/35 bg-violet-400/20 text-violet-50';
  if (track.group === 'reference') return 'border-cyan-300/35 bg-cyan-400/20 text-cyan-50';
  if (track.group === 'dialogue') return 'border-emerald-300/35 bg-emerald-400/20 text-emerald-50';
  if (item.assetId) return 'border-amber-300/35 bg-amber-400/20 text-amber-50';
  return 'border-orange-300/35 bg-orange-400/20 text-orange-50';
}

function scopePatch(binding: ScriptMasterBinding, scope: ScriptMasterScope, shot: ScriptMasterShot | undefined) {
  if (scope === 'shot') return { scope, shotIds: shot ? [shot.id] : [] };
  if (scope === 'scene') return { scope, sceneId: shot?.sceneId || null, shotIds: [] };
  if (scope === 'custom') return { scope, range: shot?.range || binding.range, shotIds: [] };
  return { scope, sceneId: null, shotIds: [], range: null };
}

function scriptMasterControllerOptions(project: ScriptMasterProject) {
  return {
    duration: project.targetDurationFrames,
    knownItemIds: project.timeline.items.map((item) => item.id),
    minZoom: 0.5,
    maxZoom: 4,
  };
}

function snapScriptMasterFrame(
  project: ScriptMasterProject,
  frameInput: number,
  excludedItemIds: string[] = [],
  thresholdFrames = 3,
): number {
  const frame = Math.max(0, Math.min(project.targetDurationFrames, Math.round(frameInput)));
  if (!project.timeline.snap) return frame;
  const excluded = new Set(excludedItemIds);
  const targets = [0, project.targetDurationFrames, project.timeline.playhead.value];
  project.timeline.items.forEach((item) => {
    if (excluded.has(item.id)) return;
    targets.push(item.range.start.value, item.range.end.value);
  });
  const nearest = targets.reduce((best, candidate) => Math.abs(candidate - frame) < Math.abs(best - frame) ? candidate : best, targets[0] || 0);
  return Math.abs(nearest - frame) <= thresholdFrames ? nearest : frame;
}

function timelineToolIcon(tool: VideoEditTimelineControllerTool) {
  if (tool === 'trim') return <Scissors size={11} />;
  if (tool === 'blade') return <Scissors size={11} />;
  if (tool === 'hand') return <Hand size={11} />;
  if (tool === 'range') return <Maximize2 size={11} />;
  return <MousePointer2 size={11} />;
}

const ScriptMasterNode = ({ id, data, selected }: NodeProps) => {
  const { t: translate, i18n } = useTranslation(['nodes', 'common']);
  const smT = (key: string, options?: Record<string, unknown>) => translate(`nodes:scriptMaster.editor.${key}`, options);
  const scriptMasterRuntimeText = (value: unknown) => localizeLegacyRuntimeText('scriptMaster', i18n.resolvedLanguage || i18n.language, value);
  const domainDisplayLabel = (domain: ScriptMasterDomain) => smT(`domains.${domain}`, { defaultValue: domainLabel(domain) });
  const downstreamDisplayLabel = (target: ScriptMasterDownstreamTarget) => smT(`downstreamTargets.${target}`, { defaultValue: DOWNSTREAM_TARGET_LABELS[target] });
  const scopeDisplayLabel = (scope: keyof typeof SCOPE_LABELS) => smT(`scopes.${scope}`, { defaultValue: SCOPE_LABELS[scope] });
  const groupDisplayLabel = (group: keyof typeof GROUP_LABELS) => smT(`groups.${group}`, { defaultValue: GROUP_LABELS[group] });
  const timelineToolDisplayLabel = (tool: VideoEditTimelineControllerTool) => smT(`timelineTools.${tool}`, { defaultValue: TIMELINE_TOOL_LABELS.find((item) => item.tool === tool)?.label || tool });
  const compileTargetDisplayLabel = (targetId: string, fallback: string) => smT(`compileTargets.${targetId}`, { defaultValue: fallback });
  const domainPackDisplayValue = (section: 'focus' | 'evidence' | 'critic', fallback: string) => smT(`domainPacks.${project.domain}.${section}`, { defaultValue: fallback });
  const trackDisplayName = (trackId: string, fallback: string) => smT(`trackNames.${trackId}`, { defaultValue: fallback });
  const canvasRenderMode = useCanvasNodeRenderMode();
  const updateNode = useUpdateNodeData(id);
  const reactFlow = useReactFlow();
  const activeCanvasId = useCanvasStore((state) => state.activeId);
  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const upstream = useUpstreamMaterials(id);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loopCurrentShot, setLoopCurrentShot] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [marquee, setMarquee] = useState<ScriptMasterMarqueeState | null>(null);
  const [, setHistoryVersion] = useState(0);
  const [assetFilter, setAssetFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [analysisScope, setAnalysisScope] = useState<'all' | 'current'>('all');
  const [analyzing, setAnalyzing] = useState(false);
  const [downstreamTarget, setDownstreamTarget] = useState<ScriptMasterDownstreamTarget>('director-storyboard');
  const [downstreamBusy, setDownstreamBusy] = useState(false);
  const [downstreamPreview, setDownstreamPreview] = useState<{
    projectRevision: number;
    payloads: ScriptMasterDownstreamNodePayload[];
    result: ScriptMasterCanvasPatchPreviewResult;
  } | null>(null);
  const [timelineViewport, setTimelineViewport] = useState({ scrollTop: 0, height: 320, scrollLeft: 0, width: 1200, scrollWidth: 1200 });
  const [assetViewport, setAssetViewport] = useState({ scrollTop: 0, height: 320 });
  const initialProject = useMemo(
    () => sanitizeScriptMasterProject((data as any)?.scriptMasterProject || createEmptyScriptMasterProject({ projectId: `script-master-${id}`, title: '未命名剧本' })),
    [data, id],
  );
  const projectRef = useRef(initialProject);
  projectRef.current = initialProject;
  const project = initialProject;
  const summary = scriptMasterProjectSummary(project);
  const historyRef = useRef<ScriptMasterHistoryState>({ projectId: project.projectId, past: [], future: [], lastKey: '', lastRecordedAt: 0 });
  const historyLoadedKeyRef = useRef('');
  const mediaProbeAbortRef = useRef<AbortController | null>(null);
  const pointerDragRef = useRef<ScriptMasterPointerDrag | null>(null);
  const timelineScrollerRef = useRef<HTMLDivElement | null>(null);
  const assetScrollerRef = useRef<HTMLDivElement | null>(null);
  const suppressTimelineClickRef = useRef(false);
  if (historyRef.current.projectId !== project.projectId) {
    historyRef.current = { projectId: project.projectId, past: [], future: [], lastKey: '', lastRecordedAt: 0 };
  }
  const [timelineController, setTimelineController] = useState<VideoEditTimelineControllerState>(() => normalizeVideoEditTimelineControllerState({
    playhead: project.timeline.playhead.value,
    zoom: project.timeline.zoom,
    selectedItemIds: project.timeline.selectedItemIds,
    activeTool: 'select',
    snapEnabled: project.timeline.snap,
  }, scriptMasterControllerOptions(project)));
  const historyStorageKey = scriptMasterHistoryStorageKey(activeCanvasId, id, project.projectId);
  const llmAdvancedProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'llm'), [advancedProviders]);
  const llmSelection = project.providerSelections.llm;
  const selectedAdvancedLlmProvider = llmAdvancedProviders.find((provider) => provider.id === llmSelection.provider);
  const llmModelOptions = selectedAdvancedLlmProvider
    ? advancedProviderModelOptions(selectedAdvancedLlmProvider, 'llm')
    : llmSelection.provider === 'seedance-nz'
      ? [...SEEDANCE_NZ_LLM_MODELS]
      : LLM_MODELS.filter((model) => !isImageOutputLlm(model.id)).map((model) => model.id);

  useEffect(() => {
    if (historyLoadedKeyRef.current === historyStorageKey) return;
    const restored = loadPersistedScriptMasterHistory(historyStorageKey, project.projectId);
    historyRef.current = { projectId: project.projectId, past: restored.past, future: restored.future, lastKey: '', lastRecordedAt: 0 };
    historyLoadedKeyRef.current = historyStorageKey;
    setHistoryVersion((value) => value + 1);
  }, [historyStorageKey, project.projectId]);

  useEffect(() => () => mediaProbeAbortRef.current?.abort(), []);

  const rememberHistorySnapshot = useCallback((snapshot: ScriptMasterProject, historyKey: string, forceBoundary = false) => {
    const history = historyRef.current;
    const now = Date.now();
    const coalesced = !forceBoundary && history.lastKey === historyKey && now - history.lastRecordedAt < 700;
    if (!coalesced) history.past = [...history.past, sanitizeScriptMasterProject(snapshot)].slice(-80);
    history.future = [];
    history.lastKey = historyKey;
    history.lastRecordedAt = now;
    persistScriptMasterHistory(historyStorageKey, history);
    setHistoryVersion((value) => value + 1);
  }, [historyStorageKey]);

  const commit = useCallback((
    nextInput: ScriptMasterProject,
    extra: Record<string, unknown> = {},
    options: ScriptMasterCommitOptions = {},
  ) => {
    const previous = projectRef.current;
    const next = sanitizeScriptMasterProject(nextInput);
    if (options.recordHistory !== false && next.revision !== previous.revision) {
      rememberHistorySnapshot(previous, options.historyKey || 'project-edit', options.forceHistoryBoundary === true);
    }
    projectRef.current = next;
    if (options.viewOnly) {
      updateNode({
        scriptMasterProject: next,
        scriptMasterProjectId: next.projectId,
        scriptMasterRevision: next.revision,
      });
      return next;
    }
    const latestCompilation = next.promptPacks.length ? compileScriptMasterProject(next, next.compileTargets[0] || DEFAULT_SCRIPT_MASTER_TARGET) : undefined;
    updateNode({
      scriptMasterProject: next,
      scriptMasterProjectId: next.projectId,
      scriptMasterRevision: next.revision,
      outputText: projectOutputText(next, latestCompilation),
      prompt: latestCompilation?.humanPrompt || '',
      status: latestCompilation?.qualityReport.blockers ? 'blocked' : next.shots.length ? 'ready' : 'idle',
      error: '',
      ...extra,
    });
    return next;
  }, [rememberHistorySnapshot, updateNode]);

  useEffect(() => {
    if ((data as any)?.scriptMasterProject) return;
    commit(project, {}, { recordHistory: false });
  }, [commit, data, project]);

  useEffect(() => {
    if (!selectedShotId && project.shots[0]) setSelectedShotId(project.shots[0].id);
    if (selectedShotId && !project.shots.some((shot) => shot.id === selectedShotId)) setSelectedShotId(project.shots[0]?.id || '');
  }, [project.shots, selectedShotId]);

  useEffect(() => {
    setDownstreamPreview((current) => current && current.projectRevision === project.revision ? current : null);
  }, [project.revision]);

  const selectedShot = project.shots.find((shot) => shot.id === selectedShotId) || project.shots[0];
  const selectedBindings = selectedShot ? effectiveScriptMasterBindingsForShot(project, selectedShot) : [];
  const selectedAssets = selectedBindings.flatMap((binding) => {
    const asset = project.assets.find((item) => item.id === binding.assetId);
    return asset ? [{ asset, binding }] : [];
  });
  const previewAsset = selectedAssets.find(({ asset }) => asset.mediaKind === 'image' && asset.url)?.asset
    || selectedAssets.find(({ asset }) => asset.mediaKind === 'video' && asset.url)?.asset;
  const filteredAssets = project.assets.filter((asset) => assetFilter === 'all' || asset.mediaKind === assetFilter);
  const assetStartIndex = Math.max(0, Math.floor(assetViewport.scrollTop / SCRIPT_MASTER_ASSET_ROW_HEIGHT) - SCRIPT_MASTER_ASSET_OVERSCAN);
  const assetEndIndex = Math.min(filteredAssets.length, Math.ceil((assetViewport.scrollTop + assetViewport.height) / SCRIPT_MASTER_ASSET_ROW_HEIGHT) + SCRIPT_MASTER_ASSET_OVERSCAN);
  const visibleAssets = filteredAssets.slice(assetStartIndex, assetEndIndex);
  const assetTopSpacerHeight = assetStartIndex * SCRIPT_MASTER_ASSET_ROW_HEIGHT;
  const assetBottomSpacerHeight = Math.max(0, (filteredAssets.length - assetEndIndex) * SCRIPT_MASTER_ASSET_ROW_HEIGHT);
  const currentCompilation = useMemo(
    () => compileScriptMasterProject(project, project.compileTargets[0] || DEFAULT_SCRIPT_MASTER_TARGET, selectedShot ? [selectedShot.id] : undefined),
    [project, selectedShot],
  );
  const activeAnalysisCandidate = project.analysis.candidates.find((candidate) => candidate.id === project.analysis.activeCandidateId) || null;
  const selectedTimelineItems = project.timeline.items.filter((item) => project.timeline.selectedItemIds.includes(item.id));
  const currentDomainPack = project.domain === 'unconfirmed' ? null : SCRIPT_MASTER_DOMAIN_PACKS[project.domain];
  const timelineTrackStart = Math.max(
    0,
    Math.floor((timelineViewport.scrollTop - SCRIPT_MASTER_TIMELINE_RULER_HEIGHT) / SCRIPT_MASTER_TIMELINE_ROW_HEIGHT)
      - SCRIPT_MASTER_TIMELINE_VERTICAL_OVERSCAN,
  );
  const timelineTrackEnd = Math.min(
    project.timeline.tracks.length,
    Math.ceil((timelineViewport.scrollTop + timelineViewport.height - SCRIPT_MASTER_TIMELINE_RULER_HEIGHT) / SCRIPT_MASTER_TIMELINE_ROW_HEIGHT)
      + SCRIPT_MASTER_TIMELINE_VERTICAL_OVERSCAN,
  );
  const visibleTimelineTracks = project.timeline.tracks.slice(timelineTrackStart, timelineTrackEnd);
  const timelineTopSpacerHeight = timelineTrackStart * SCRIPT_MASTER_TIMELINE_ROW_HEIGHT;
  const timelineBottomSpacerHeight = Math.max(0, (project.timeline.tracks.length - timelineTrackEnd) * SCRIPT_MASTER_TIMELINE_ROW_HEIGHT);
  const timelineLaneWidth = Math.max(1, timelineViewport.scrollWidth - SCRIPT_MASTER_TIMELINE_LABEL_WIDTH);
  const timelineVisibleStartRatio = Math.max(0, timelineViewport.scrollLeft - SCRIPT_MASTER_TIMELINE_LABEL_WIDTH) / timelineLaneWidth;
  const timelineVisibleEndRatio = Math.min(1, Math.max(0, timelineViewport.scrollLeft + timelineViewport.width - SCRIPT_MASTER_TIMELINE_LABEL_WIDTH) / timelineLaneWidth);
  const timelineHorizontalOverscanFrames = Math.max(
    project.fps * 2,
    Math.ceil(project.targetDurationFrames * Math.max(0.02, timelineViewport.width / timelineLaneWidth * 0.2)),
  );
  const timelineVisibleStartFrame = Math.max(0, Math.floor(project.targetDurationFrames * timelineVisibleStartRatio) - timelineHorizontalOverscanFrames);
  const timelineVisibleEndFrame = Math.min(project.targetDurationFrames, Math.ceil(project.targetDurationFrames * timelineVisibleEndRatio) + timelineHorizontalOverscanFrames);

  useEffect(() => {
    setTimelineController((current) => normalizeVideoEditTimelineControllerState({
      ...current,
      playhead: project.timeline.playhead.value,
      zoom: project.timeline.zoom,
      selectedItemIds: project.timeline.selectedItemIds,
      snapEnabled: project.timeline.snap,
    }, scriptMasterControllerOptions(project)));
  }, [project.projectId, project.revision, project.timeline.playhead.value, project.timeline.selectedItemIds.join('\u0000'), project.timeline.snap, project.timeline.zoom]);

  const updateTimelineViewport = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    setTimelineViewport((current) => {
      const next = {
        scrollTop: element.scrollTop,
        height: Math.max(1, element.clientHeight),
        scrollLeft: element.scrollLeft,
        width: Math.max(1, element.clientWidth),
        scrollWidth: Math.max(1, element.scrollWidth),
      };
      return Object.keys(next).every((key) => Object.is(next[key as keyof typeof next], current[key as keyof typeof current])) ? current : next;
    });
  }, []);

  useEffect(() => {
    if (!workbenchOpen) return;
    const element = timelineScrollerRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => updateTimelineViewport(element));
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateTimelineViewport(element));
    observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [project.timeline.tracks.length, project.timeline.zoom, updateTimelineViewport, workbenchOpen]);

  useEffect(() => {
    if (!workbenchOpen) return;
    const element = assetScrollerRef.current;
    if (!element) return;
    const update = () => setAssetViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [assetFilter, filteredAssets.length, workbenchOpen]);

  const selectTimelineItems = useCallback((
    itemIds: string[],
    mode: 'replace' | 'add' | 'remove' | 'toggle' | 'clear' = 'replace',
  ) => {
    const currentProject = projectRef.current;
    const currentController = normalizeVideoEditTimelineControllerState({
      ...timelineController,
      selectedItemIds: currentProject.timeline.selectedItemIds,
    }, scriptMasterControllerOptions(currentProject));
    const nextController = applyVideoEditTimelineControllerCommand(currentController, { type: 'select', itemIds, mode }, scriptMasterControllerOptions(currentProject));
    setTimelineController(nextController);
    commit(
      patchScriptMasterTimelineView(currentProject, { selectedItemIds: nextController.selectedItemIds }),
      {},
      { recordHistory: false, viewOnly: true },
    );
    const first = currentProject.timeline.items.find((item) => nextController.selectedItemIds.includes(item.id) && item.shotId);
    if (first?.shotId) setSelectedShotId(first.shotId);
  }, [commit, timelineController]);

  const setTimelineTool = useCallback((tool: VideoEditTimelineControllerTool) => {
    setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'tool', tool }, scriptMasterControllerOptions(projectRef.current)));
    setMessage(`${TIMELINE_TOOL_LABELS.find((item) => item.tool === tool)?.label || tool}工具已启用`);
  }, []);

  const undoWorkbenchChange = useCallback(() => {
    const history = historyRef.current;
    const snapshot = history.past.at(-1);
    if (!snapshot) return;
    history.past = history.past.slice(0, -1);
    history.future = [sanitizeScriptMasterProject(projectRef.current), ...history.future].slice(0, 80);
    history.lastKey = '';
    history.lastRecordedAt = 0;
    const restored = restoreScriptMasterProjectSnapshot(projectRef.current, snapshot, '撤销剧本大师编辑');
    commit(restored, {}, { recordHistory: false });
    persistScriptMasterHistory(historyStorageKey, history);
    setHistoryVersion((value) => value + 1);
    setMessage('已撤销上一项编辑');
  }, [commit, historyStorageKey]);

  const redoWorkbenchChange = useCallback(() => {
    const history = historyRef.current;
    const snapshot = history.future[0];
    if (!snapshot) return;
    history.future = history.future.slice(1);
    history.past = [...history.past, sanitizeScriptMasterProject(projectRef.current)].slice(-80);
    history.lastKey = '';
    history.lastRecordedAt = 0;
    const restored = restoreScriptMasterProjectSnapshot(projectRef.current, snapshot, '重做剧本大师编辑');
    commit(restored, {}, { recordHistory: false });
    persistScriptMasterHistory(historyStorageKey, history);
    setHistoryVersion((value) => value + 1);
    setMessage('已重做编辑');
  }, [commit, historyStorageKey]);

  const splitTimelineSelection = useCallback(() => {
    const current = projectRef.current;
    const fallback = current.timeline.items.find((item) => item.range.start.value < current.timeline.playhead.value && item.range.end.value > current.timeline.playhead.value && item.kind === 'shot');
    const itemIds = current.timeline.selectedItemIds.length ? current.timeline.selectedItemIds : fallback ? [fallback.id] : [];
    let next = current;
    itemIds.forEach((itemId) => { next = splitScriptMasterTimelineItem(next, itemId, current.timeline.playhead.value); });
    if (next.revision !== current.revision) {
      commit(next, {}, { historyKey: 'timeline-split', forceHistoryBoundary: true });
      setMessage(`已在 ${formatScriptMasterTimecode(current.timeline.playhead, current.fps)} 切分所选片段`);
    }
  }, [commit]);

  const duplicateTimelineSelection = useCallback(() => {
    const current = projectRef.current;
    const next = duplicateScriptMasterTimelineItems(current, current.timeline.selectedItemIds);
    if (next.revision !== current.revision) {
      commit(next, {}, { historyKey: 'timeline-duplicate', forceHistoryBoundary: true });
      setMessage(`已复制 ${current.timeline.selectedItemIds.length} 个时间线片段`);
    }
  }, [commit]);

  const mergeTimelineSelection = useCallback(() => {
    const current = projectRef.current;
    const next = mergeScriptMasterTimelineItems(current, current.timeline.selectedItemIds);
    if (next.revision !== current.revision) {
      commit(next, {}, { historyKey: 'timeline-merge', forceHistoryBoundary: true });
      setMessage('已合并同场景内相邻且未锁定的镜头，总时长保持不变');
    } else {
      setMessage('请选择同场景内至少两个相邻且未锁定的画面片段');
    }
  }, [commit]);

  const deleteTimelineSelection = useCallback(() => {
    const current = projectRef.current;
    const next = removeScriptMasterTimelineItems(current, current.timeline.selectedItemIds);
    if (next.revision !== current.revision) {
      commit(next, {}, { historyKey: 'timeline-delete', forceHistoryBoundary: true });
      setMessage(`已删除 ${current.timeline.selectedItemIds.length} 个可编辑片段；锁定内容保持不变`);
    }
  }, [commit]);

  const distributeShotDurations = useCallback(() => {
    const current = projectRef.current;
    const next = distributeScriptMasterShotDurations(current);
    if (next.revision !== current.revision) {
      commit(next, {}, { historyKey: 'timeline-distribute', forceHistoryBoundary: true });
      setMessage('已按整数帧平均分配全部镜头时长');
    }
  }, [commit]);

  const importSource = useCallback((source: string, name = '导入剧本.txt', format: 'text' | 'markdown' | 'fountain' | 'json' = 'text') => {
    if (!source.trim()) {
      setMessage('请先粘贴或选择剧本文本');
      return;
    }
    const next = importScriptMasterSource(projectRef.current, source, { name, format });
    commit(next);
    setSourceDraft(source);
    setSelectedShotId(next.shots[0]?.id || '');
    setMessage(`确定性解析完成：${next.scenes.length} 场 · ${next.shots.length} 镜 · 未调用模型`);
  }, [commit]);

  const handleSourceFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const text = await file.text();
    const lower = file.name.toLowerCase();
    const format = lower.endsWith('.md') ? 'markdown' : lower.endsWith('.fountain') ? 'fountain' : lower.endsWith('.json') ? 'json' : 'text';
    importSource(text, file.name, format);
  }, [importSource]);

  const probeAssets = useCallback(async (assets: ScriptMasterAsset[]) => {
    mediaProbeAbortRef.current?.abort();
    const controller = new AbortController();
    mediaProbeAbortRef.current = controller;
    for (const requested of assets) {
      if (controller.signal.aborted) break;
      const currentAsset = projectRef.current.assets.find((asset) => asset.id === requested.id);
      if (!currentAsset) continue;
      try {
        const metadata = await probeScriptMasterAsset(currentAsset, projectRef.current.fps, controller.signal);
        if (controller.signal.aborted) break;
        const next = patchScriptMasterAssetMetadata(projectRef.current, currentAsset.id, {
          ...metadata,
          probeStatus: 'ready',
          probeError: '',
        });
        commit(next, {}, { historyKey: `asset-probe:${currentAsset.id}` });
      } catch (error: any) {
        if (controller.signal.aborted || error?.name === 'AbortError') break;
        const next = patchScriptMasterAssetMetadata(projectRef.current, currentAsset.id, {
          probeStatus: 'error',
          probeError: error?.message || '媒体探测失败',
        });
        commit(next, {}, { historyKey: `asset-probe:${currentAsset.id}` });
      }
    }
    if (mediaProbeAbortRef.current === controller) mediaProbeAbortRef.current = null;
  }, [commit]);

  const addUploadedFiles = useCallback(async (files: File[]) => {
    const supported = files.map((file) => ({ file, kind: assetKindForFile(file) })).filter((item): item is { file: File; kind: ScriptMasterAssetKind } => Boolean(item.kind));
    if (!supported.length) {
      setMessage('没有识别到图片、视频或音频文件');
      return;
    }
    setUploading(true);
    let next = projectRef.current;
    let succeeded = 0;
    try {
      for (const { file, kind } of supported) {
        const uploaded = await api.uploadResourceLocalFile(file, {
          projectId: next.projectId,
          canvasId: activeCanvasId || undefined,
          sourceNodeId: id,
          sourceNodeType: 'script-master',
        });
        next = addScriptMasterAsset(next, {
          kind,
          name: file.name,
          url: uploaded.url,
          source: 'local',
          sourceKey: uploaded.assetId || `local:${file.name}:${file.size}:${file.lastModified}`,
          mime: file.type,
          probeStatus: 'probing',
        });
        succeeded += 1;
      }
      const committed = commit(next);
      const probeTargets = committed.assets.filter((asset) => asset.probeStatus === 'probing');
      if (probeTargets.length) void probeAssets(probeTargets);
      setMessage(`已加入 ${succeeded} 个素材；每个参考图/音频都有独立稳定别名与轨道`);
    } catch (error: any) {
      if (succeeded) commit(next);
      setMessage(error?.message || '素材上传失败');
    } finally {
      setUploading(false);
    }
  }, [activeCanvasId, commit, id, probeAssets]);

  const handleAssetFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = '';
    void addUploadedFiles(files);
  }, [addUploadedFiles]);

  const syncUpstream = useCallback(() => {
    const materials: Material[] = [...upstream.images, ...upstream.videos, ...upstream.audios];
    let next = projectRef.current;
    let added = 0;
    materials.forEach((material) => {
      const before = next.assets.length;
      next = addScriptMasterAsset(next, {
        kind: material.kind === 'image' ? 'image' : material.kind === 'video' ? 'video' : 'dialogue-audio',
        name: material.label || `上游${material.kind}`,
        url: material.url,
        source: 'upstream',
        sourceKey: material.id,
        probeStatus: 'probing',
      });
      if (next.assets.length > before) added += 1;
    });
    if (added) {
      const committed = commit(next);
      void probeAssets(committed.assets.filter((asset) => asset.probeStatus === 'probing'));
    }
    setMessage(added ? `已同步 ${added} 个上游素材` : '上游素材均已同步，或当前没有可用素材');
  }, [commit, probeAssets, upstream.audios, upstream.images, upstream.videos]);

  const compileAll = useCallback(async (copy = false) => {
    const compilation = compileScriptMasterProject(projectRef.current, projectRef.current.compileTargets[0] || DEFAULT_SCRIPT_MASTER_TARGET);
    const next = applyScriptMasterCompilation(projectRef.current, compilation);
    commit(next, { outputText: projectOutputText(next, compilation), prompt: compilation.humanPrompt, status: compilation.qualityReport.blockers ? 'blocked' : 'success' });
    if (copy && compilation.humanPrompt) await navigator.clipboard.writeText(compilation.humanPrompt);
    setMessage(compilation.qualityReport.blockers
      ? `编译完成，但有 ${compilation.qualityReport.blockers} 个硬阻断；未提交任何 Provider`
      : copy ? '全部逐镜提示词已编译并复制' : '全部逐镜提示词已编译；未提交任何 Provider');
  }, [commit]);

  const runExplicitLlmAnalysis = useCallback(async () => {
    const base = projectRef.current;
    const selection = base.providerSelections.llm;
    if (!selection.provider || !selection.model) {
      setMessage('请先在统一模型选择器中选择 LLM 平台与模型');
      return;
    }
    const scopeShotIds = analysisScope === 'current' && selectedShot ? [selectedShot.id] : [];
    const request = createScriptMasterAnalysisRequest(base, scopeShotIds);
    if (!request.scopeShotIds.length) {
      setMessage('没有可分析镜头；请先导入剧本或新增镜头');
      return;
    }
    setAnalyzing(true);
    commit(beginScriptMasterAnalysis(base), { status: 'analyzing' }, { recordHistory: false, viewOnly: true });
    setMessage(`正在显式分析 ${request.characterCount.toLocaleString()} 字符 · ${request.scopeShotIds.length} 镜；不会调用图像/视频/音频 Provider`);
    try {
      const messages = [
        { role: 'system' as const, content: request.system },
        { role: 'user' as const, content: request.user },
      ];
      const result = selection.provider === 'zhenzhen' || selection.provider === 'seedance-nz'
        ? await generateLlm({
          source: selection.provider === 'seedance-nz' ? 'seedance-nz' : 'zhenzhen',
          model: selection.provider === 'seedance-nz' ? resolveSeedanceNzLlmModel(selection.model) : selection.model,
          messages,
          temperature: 0.2,
          max_tokens: 16_384,
        })
        : await generateExternalLlm({
          providerId: selection.provider,
          providerModel: selection.model,
          model: selection.model,
          messages,
          temperature: 0.2,
          max_tokens: 16_384,
        });
      const candidate = recordScriptMasterAnalysisCandidate(
        projectRef.current,
        parseScriptMasterAnalysisCandidate(base, result.content, selection, request.scopeShotIds),
      );
      commit(candidate, { status: 'review' }, { recordHistory: false, viewOnly: true });
      setMessage(`分析候选已进入审阅：${candidate.analysis.candidates.at(-1)?.shotSuggestions.length || 0} 镜 · 未自动采纳`);
    } catch (error: any) {
      const failed = failScriptMasterAnalysis(projectRef.current, error?.message || 'LLM 分析失败');
      commit(failed, { status: 'error', error: failed.analysis.lastError }, { recordHistory: false, viewOnly: true });
      setMessage(failed.analysis.lastError);
    } finally {
      setAnalyzing(false);
    }
  }, [analysisScope, commit, selectedShot]);

  const adoptAnalysisCandidate = useCallback(() => {
    const candidateId = projectRef.current.analysis.activeCandidateId;
    if (!candidateId) return;
    try {
      const next = adoptScriptMasterAnalysisCandidate(projectRef.current, candidateId);
      commit(next, {}, { historyKey: 'analysis-adopt', forceHistoryBoundary: true });
      setMessage('已采纳当前 LLM 候选；锁定镜头保持不变，生成仍未触发');
    } catch (error: any) {
      setMessage(error?.message || '候选采纳失败');
    }
  }, [commit]);

  const rejectAnalysisCandidate = useCallback(() => {
    const candidateId = projectRef.current.analysis.activeCandidateId;
    if (!candidateId) return;
    commit(rejectScriptMasterAnalysisCandidate(projectRef.current, candidateId), {}, { recordHistory: false, viewOnly: true });
    setMessage('已放弃当前 LLM 候选，项目内容未变化');
  }, [commit]);

  const exportBundle = useCallback(() => {
    const bundle = scriptMasterExportBundle(projectRef.current);
    downloadJson(`${safeFilename(projectRef.current.title)}.t8-script-master.json`, bundle);
    setMessage('已导出项目、PromptPack、AudioPlan、EDL、引用清单与 Director 适配数据');
  }, []);

  const previewDownstreamPatch = useCallback(async () => {
    setDownstreamBusy(true);
    setDownstreamPreview(null);
    try {
      const current = projectRef.current;
      const payloads = buildScriptMasterDownstreamPayloads(current, downstreamTarget);
      if (!payloads.length) throw new Error('当前编译结果没有可发送的下游节点');
      if (payloads.length > CANVAS_PATCH_DRAFT_MAX_OPERATIONS) {
        throw new Error(`下游需要 ${payloads.length} 个节点，超过单次预览上限 ${CANVAS_PATCH_DRAFT_MAX_OPERATIONS}；请缩小范围或先合并合法片段`);
      }
      const existingNodes = reactFlow.getNodes();
      const existingById = new Map(existingNodes.map((node) => [node.id, node]));
      const origin = reactFlow.getNode(id);
      const originSize = defaultSizeOf(String(origin?.type || 'script-master'));
      const creates = payloads.filter((payload) => !existingById.has(payload.nodeId));
      const desiredByNodeId = new Map<string, PlacementRect>();
      creates.forEach((payload, index) => {
        const size = defaultSizeOf(payload.nodeType);
        const column = index % 3;
        const row = Math.floor(index / 3);
        desiredByNodeId.set(payload.nodeId, {
          x: (origin?.position.x || 0) + originSize.w + 160 + column * (size.w + 48),
          y: (origin?.position.y || 0) + row * (size.h + 48),
          w: size.w,
          h: size.h,
        });
      });
      const desiredRects = [...desiredByNodeId.values()];
      const offset = desiredRects.length
        ? placeBatchNodes(desiredRects, existingNodes, { source: `placement:script-master:${id}:${downstreamTarget}` })
        : { dx: 0, dy: 0 };
      const operations: CanvasPatchDraftOperation[] = payloads.map((payload) => {
        const existing = existingById.get(payload.nodeId);
        if (existing && existing.type !== payload.nodeType) {
          throw new Error(`稳定节点 ID ${payload.nodeId} 已被其他类型 ${String(existing.type || 'unknown')} 占用`);
        }
        if (existing) {
          return {
            type: 'node.patch',
            nodeId: payload.nodeId,
            nodeType: payload.nodeType,
            patch: { data: payload.data },
          };
        }
        const desired = desiredByNodeId.get(payload.nodeId);
        if (!desired) throw new Error(`无法为下游节点 ${payload.nodeId} 计算安全落点`);
        return {
          type: 'node.add',
          node: {
            id: payload.nodeId,
            type: payload.nodeType,
            position: { x: desired.x + offset.dx, y: desired.y + offset.dy },
            data: payload.data,
          },
        };
      });
      const draft: CanvasPatchDraft = {
        source: 'script-master-v1',
        id: `script-master-downstream-${current.projectId}-${current.revision}-${downstreamTarget}`,
        title: `剧本大师发送到${DOWNSTREAM_TARGET_LABELS[downstreamTarget]}`,
        description: `基于项目 ${current.projectId} r${current.revision} 的确定性编译结果，新增或更新 ${payloads.length} 个受控节点。`,
        operations,
        diagnosticsResolved: [],
      };
      const result = await previewScriptMasterCanvasPatch(draft);
      setDownstreamPreview({ projectRevision: current.revision, payloads, result });
      setMessage(`已生成 ${payloads.length} 个${DOWNSTREAM_TARGET_LABELS[downstreamTarget]}节点的服务端预览；尚未写入画布`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDownstreamBusy(false);
    }
  }, [downstreamTarget, id, reactFlow]);

  const confirmDownstreamPatch = useCallback(async () => {
    const pending = downstreamPreview;
    if (!pending) return;
    if (pending.projectRevision !== projectRef.current.revision) {
      setDownstreamPreview(null);
      setMessage('项目已变化，请重新生成并确认下游预览');
      return;
    }
    setDownstreamBusy(true);
    try {
      const applied = await applyScriptMasterCanvasPatch(pending.result.patch, pending.result.preview);
      commit(
        recordScriptMasterDownstreamApply(projectRef.current, pending.payloads, applied.patchId, applied.revision),
        {},
        { recordHistory: false, viewOnly: true },
      );
      setDownstreamPreview(null);
      setMessage(`${applied.duplicate ? '已确认' : '已写入'} ${pending.payloads.length} 个下游节点 · 画布 r${applied.revision}`);
    } catch (error) {
      setDownstreamPreview(null);
      setMessage(`${error instanceof Error ? error.message : String(error)}；请重新预览`);
    } finally {
      setDownstreamBusy(false);
    }
  }, [commit, downstreamPreview]);

  const changeBindingScope = useCallback((binding: ScriptMasterBinding, scope: ScriptMasterScope) => {
    commit(patchScriptMasterBinding(projectRef.current, binding.id, scopePatch(binding, scope, selectedShot)), {}, { historyKey: `binding:${binding.id}` });
  }, [commit, selectedShot]);

  const patchShot = useCallback((shot: ScriptMasterShot, patch: Parameters<typeof patchScriptMasterShot>[2]) => {
    commit(patchScriptMasterShot(projectRef.current, shot.id, patch), {}, { historyKey: `shot:${shot.id}` });
  }, [commit]);

  const selectRelativeShot = useCallback((delta: number) => {
    if (!selectedShot) return;
    const index = project.shots.findIndex((shot) => shot.id === selectedShot.id);
    const next = project.shots[Math.max(0, Math.min(project.shots.length - 1, index + delta))];
    if (next) {
      setSelectedShotId(next.id);
      setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'seek', time: next.range.start.value }, scriptMasterControllerOptions(projectRef.current)));
      commit(patchScriptMasterTimelineView(projectRef.current, { playhead: rationalTime(next.range.start.value, projectRef.current.fps) }), {}, { recordHistory: false, viewOnly: true });
    }
  }, [commit, project.shots, selectedShot]);

  const handleTimelineClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (suppressTimelineClickRef.current || timelineController.activeTool === 'hand') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const frame = snapScriptMasterFrame(projectRef.current, Math.round(ratio * projectRef.current.targetDurationFrames));
    const nextShot = projectRef.current.shots.find((shot) => frame >= shot.range.start.value && frame < shot.range.end.value);
    if (nextShot) setSelectedShotId(nextShot.id);
    setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'seek', time: frame }, scriptMasterControllerOptions(projectRef.current)));
    commit(patchScriptMasterTimelineView(projectRef.current, { playhead: rationalTime(frame, projectRef.current.fps) }), {}, { recordHistory: false, viewOnly: true });
  }, [commit, timelineController.activeTool]);

  const beginTimelineItemPointer = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    item: ScriptMasterTimelineItem,
    edge?: 'start' | 'end',
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentProject = projectRef.current;
    const mode = event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace';
    const alreadySelected = currentProject.timeline.selectedItemIds.includes(item.id);
    if (!alreadySelected || mode !== 'replace') selectTimelineItems([item.id], mode);
    if (item.shotId) setSelectedShotId(item.shotId);
    const selectedIds = alreadySelected && mode === 'replace' ? currentProject.timeline.selectedItemIds : [item.id];
    if (timelineController.activeTool === 'blade' && !edge) {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      const frame = snapScriptMasterFrame(currentProject, item.range.start.value + Math.round(rangeDurationFrames(item.range, currentProject.fps) * ratio), [item.id]);
      const next = splitScriptMasterTimelineItem(currentProject, item.id, frame);
      if (next.revision !== currentProject.revision) commit(next, {}, { historyKey: 'timeline-blade', forceHistoryBoundary: true });
      return;
    }
    if (timelineController.activeTool === 'hand' || timelineController.activeTool === 'range') return;
    const trackRect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!trackRect || currentProject.targetDurationFrames <= 0) return;
    const drag: ScriptMasterPointerDrag = {
      mode: edge || timelineController.activeTool === 'trim' ? 'trim' : 'move',
      itemId: item.id,
      itemIds: edge ? [item.id] : selectedIds,
      edge: edge || (timelineController.activeTool === 'trim' ? 'end' : undefined),
      startClientX: event.clientX,
      pixelsPerFrame: trackRect.width / Math.max(1, currentProject.targetDurationFrames),
      originalProject: currentProject,
      lastDeltaFrames: 0,
      changed: false,
    };
    pointerDragRef.current = drag;
    setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, {
      type: 'begin-drag',
      drag: { kind: drag.mode, itemId: item.id, edge: drag.edge, pointerId: event.pointerId, startedAt: item.range.start.value },
    }, scriptMasterControllerOptions(currentProject)));

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const active = pointerDragRef.current;
      if (!active) return;
      const rawDelta = Math.round((pointerEvent.clientX - active.startClientX) / Math.max(0.0001, active.pixelsPerFrame));
      if (rawDelta === active.lastDeltaFrames) return;
      active.lastDeltaFrames = rawDelta;
      const sourceItem = active.originalProject.timeline.items.find((candidate) => candidate.id === active.itemId);
      if (!sourceItem) return;
      let next: ScriptMasterProject;
      if (active.mode === 'trim' && active.edge) {
        const sourceFrame = active.edge === 'start' ? sourceItem.range.start.value : sourceItem.range.end.value;
        const frame = snapScriptMasterFrame(active.originalProject, sourceFrame + rawDelta, [active.itemId]);
        next = trimScriptMasterTimelineItem(active.originalProject, active.itemId, active.edge, frame);
      } else {
        let deltaFrames = rawDelta;
        if (active.originalProject.timeline.snap && active.itemIds.length) {
          const groupItems = active.originalProject.timeline.items.filter((candidate) => active.itemIds.includes(candidate.id));
          const groupStart = Math.min(...groupItems.map((candidate) => candidate.range.start.value));
          const snappedStart = snapScriptMasterFrame(active.originalProject, groupStart + rawDelta, active.itemIds);
          deltaFrames = snappedStart - groupStart;
        }
        next = moveScriptMasterTimelineItems(active.originalProject, active.itemIds, deltaFrames);
      }
      active.changed = next.revision !== active.originalProject.revision;
      commit(next, {}, { recordHistory: false, viewOnly: true });
      setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'update-drag', currentAt: rawDelta }, scriptMasterControllerOptions(next)));
    };
    const onPointerUp = () => {
      const active = pointerDragRef.current;
      pointerDragRef.current = null;
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'end-drag' }, scriptMasterControllerOptions(projectRef.current)));
      if (active?.changed) {
        rememberHistorySnapshot(active.originalProject, `timeline-${active.mode}`, true);
        commit(projectRef.current, {}, { recordHistory: false });
        setMessage(active.mode === 'trim' ? '已按整数帧修剪片段' : '已移动所选片段；图片与音频别名保持不变');
      }
    };
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, { capture: true, once: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true, once: true });
  }, [commit, rememberHistorySnapshot, selectTimelineItems, timelineController.activeTool]);

  const beginTimelineMarquee = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-script-master-timeline-item],button,input,select,textarea')) return;
    const scroller = timelineScrollerRef.current;
    if (!scroller) return;
    if (timelineController.activeTool === 'hand') {
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = scroller.scrollLeft;
      const startTop = scroller.scrollTop;
      const onPointerMove = (pointerEvent: PointerEvent) => {
        scroller.scrollLeft = Math.max(0, startLeft - (pointerEvent.clientX - startX));
        scroller.scrollTop = Math.max(0, startTop - (pointerEvent.clientY - startY));
        setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'scroll', left: scroller.scrollLeft, top: scroller.scrollTop }, scriptMasterControllerOptions(projectRef.current)));
      };
      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);
      };
      window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
      window.addEventListener('pointerup', onPointerUp, { capture: true, once: true });
      window.addEventListener('pointercancel', onPointerUp, { capture: true, once: true });
      return;
    }
    if (timelineController.activeTool !== 'select' && timelineController.activeTool !== 'range') return;
    const bounds = scroller.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLocalX = event.clientX - bounds.left + scroller.scrollLeft;
    const startLocalY = event.clientY - bounds.top + scroller.scrollTop;
    let moved = false;
    const onPointerMove = (pointerEvent: PointerEvent) => {
      const left = Math.min(startLocalX, pointerEvent.clientX - bounds.left + scroller.scrollLeft);
      const top = Math.min(startLocalY, pointerEvent.clientY - bounds.top + scroller.scrollTop);
      const width = Math.abs(pointerEvent.clientX - startX);
      const height = Math.abs(pointerEvent.clientY - startY);
      moved ||= width > 4 || height > 4;
      setMarquee({ left, top, width, height });
    };
    const onPointerUp = (pointerEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      setMarquee(null);
      if (!moved) return;
      const left = Math.min(startX, pointerEvent.clientX);
      const right = Math.max(startX, pointerEvent.clientX);
      const top = Math.min(startY, pointerEvent.clientY);
      const bottom = Math.max(startY, pointerEvent.clientY);
      const itemIds = [...scroller.querySelectorAll<HTMLElement>('[data-script-master-timeline-item]')].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const intersects = rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
        const itemId = element.dataset.scriptMasterTimelineItem;
        return intersects && itemId ? [itemId] : [];
      });
      selectTimelineItems(itemIds, event.shiftKey ? 'add' : 'replace');
      suppressTimelineClickRef.current = true;
      window.setTimeout(() => { suppressTimelineClickRef.current = false; }, 0);
      setMessage(`框选 ${itemIds.length} 个片段`);
    };
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, { capture: true, once: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true, once: true });
  }, [selectTimelineItems, timelineController.activeTool]);

  useEffect(() => {
    if (!workbenchOpen || !playing) return;
    const timer = window.setInterval(() => {
      const current = projectRef.current;
      if (!current.targetDurationFrames) {
        setPlaying(false);
        return;
      }
      const activeShot = current.shots.find((shot) => shot.id === selectedShotId)
        || current.shots.find((shot) => current.timeline.playhead.value >= shot.range.start.value && current.timeline.playhead.value < shot.range.end.value);
      let frame = current.timeline.playhead.value + 1;
      if (loopCurrentShot && activeShot && frame >= activeShot.range.end.value) frame = activeShot.range.start.value;
      if (!loopCurrentShot && frame >= current.targetDurationFrames) {
        frame = current.targetDurationFrames;
        setPlaying(false);
      }
      const nextShot = current.shots.find((shot) => frame >= shot.range.start.value && frame < shot.range.end.value);
      if (nextShot && nextShot.id !== selectedShotId) setSelectedShotId(nextShot.id);
      setTimelineController((controller) => applyVideoEditTimelineControllerCommand(controller, { type: 'seek', time: frame }, scriptMasterControllerOptions(current)));
      commit(patchScriptMasterTimelineView(current, { playhead: rationalTime(frame, current.fps) }), {}, { recordHistory: false, viewOnly: true });
    }, Math.max(25, Math.round(1000 / Math.max(1, project.fps))));
    return () => window.clearInterval(timer);
  }, [commit, loopCurrentShot, playing, project.fps, selectedShotId, workbenchOpen]);

  useEffect(() => {
    if (!workbenchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest('input,textarea,select,[contenteditable="true"]'));
      if (event.key === 'Escape') {
        setWorkbenchOpen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        setMessage('更改已写入画布项目');
        return;
      }
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoWorkbenchChange();
        else undoWorkbenchChange();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoWorkbenchChange();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteTimelineSelection();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const current = projectRef.current;
        if (!current.timeline.selectedItemIds.length) return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const next = moveScriptMasterTimelineItems(current, current.timeline.selectedItemIds, direction * (event.shiftKey ? 10 : 1));
        if (next.revision !== current.revision) commit(next, {}, { historyKey: 'timeline-nudge' });
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        setPlaying((value) => !value);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's') splitTimelineSelection();
      else if (key === 'm') mergeTimelineSelection();
      else if (key === 'v') setTimelineTool('select');
      else if (key === 't') setTimelineTool('trim');
      else if (key === 'b') setTimelineTool('blade');
      else if (key === 'h') setTimelineTool('hand');
      else if (key === 'r') setTimelineTool('range');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit, deleteTimelineSelection, mergeTimelineSelection, redoWorkbenchChange, setTimelineTool, splitTimelineSelection, undoWorkbenchChange, workbenchOpen]);

  const workbench = workbenchOpen && typeof document !== 'undefined' ? createPortal(
    <div role="dialog" aria-modal="true" aria-label={smT('workbenchAria')} className="nodrag nowheel fixed inset-0 z-[2140] flex min-h-0 flex-col overflow-hidden bg-[#07090d] text-white" data-script-master-workbench="true">
      <header className="flex h-[76px] shrink-0 items-center gap-4 border-b border-white/10 bg-[#0a0d13] px-5 shadow-2xl">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-300/30 bg-violet-300/10 text-violet-100"><BookOpenText size={22} /></div>
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h2 className="max-w-[320px] truncate text-sm font-semibold">{smT('titleWithProject', { title: project.title })}</h2><span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] text-white/45">r{project.revision}</span></div>
          <p className="text-[10px] text-white/35">{smT('projectMeta', { domain: domainDisplayLabel(project.domain), fps: project.fps, aspect: project.aspectRatio })}</p>
        </div>
        <div className="relative ml-3">
          <button onClick={() => setGlobalSettingsOpen((value) => !value)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] ${globalSettingsOpen ? 'border-violet-300/35 bg-violet-300/10 text-violet-100' : 'border-white/10 text-white/55'}`}><Settings2 size={12} />{smT('globalSettings')}</button>
          {globalSettingsOpen && <section className="absolute left-0 top-12 z-40 max-h-[calc(100vh-104px)] w-[360px] overflow-y-auto rounded-xl border border-white/10 bg-[#111620] p-4 shadow-2xl">
            <div className="mb-3 flex items-center"><strong className="text-[11px]">{smT('projectSettings')}</strong><button aria-label={smT('closeGlobalSettings')} onClick={() => setGlobalSettingsOpen(false)} className="ml-auto rounded p-1 text-white/35 hover:bg-white/5"><X size={12} /></button></div>
            <div className="space-y-2.5">
              <label className="block text-[9px] text-white/40">{smT('projectTitle')}<input key={`title-${project.projectId}-${project.revision}`} defaultValue={project.title} onBlur={(event) => commit(patchScriptMasterProjectSettings(projectRef.current, { title: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-[10px] text-white outline-none focus:border-violet-300/30" /></label>
              <label className="block text-[9px] text-white/40">{smT('contentType')}<select value={project.domain} onChange={(event) => commit(patchScriptMasterProjectSettings(projectRef.current, { domain: event.target.value as ScriptMasterDomain }))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#161c28] px-2.5 py-2 text-[10px] text-white">{DOMAIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{domainDisplayLabel(option.value)}</option>)}</select></label>
              {currentDomainPack ? <section aria-label={smT('domainPackAria', { domain: domainDisplayLabel(project.domain) })} className="rounded-lg border border-violet-300/15 bg-violet-300/[0.04] p-2 text-[8px] leading-4 text-white/40">
                <strong className="block text-[9px] text-violet-100">{smT('domainPackTitle', { domain: domainDisplayLabel(project.domain) })}</strong>
                <span className="block">{smT('focusFields', { value: domainPackDisplayValue('focus', currentDomainPack.focusFields.join('、')) })}</span>
                <span className="block">{smT('requiredEvidence', { value: domainPackDisplayValue('evidence', currentDomainPack.requiredEvidence.join('、')) })}</span>
                <span className="block">{smT('criticRules', { value: domainPackDisplayValue('critic', currentDomainPack.criticRules.map((rule) => rule.label).join('、')) })}</span>
              </section> : <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-2 py-1.5 text-[8px] leading-4 text-amber-100/70">{smT('unconfirmedDomainNote')}</p>}
               <div className="grid grid-cols-2 gap-2">
                <label className="block text-[9px] text-white/40">{smT('language')}<select value={project.language} onChange={(event) => commit(patchScriptMasterProjectSettings(projectRef.current, { language: event.target.value }))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#161c28] px-2 py-2 text-[10px] text-white"><option value="zh-CN">简体中文</option><option value="zh-TW">繁体中文</option><option value="en-US">English</option><option value="ja-JP">日本語</option><option value="ko-KR">한국어</option></select></label>
                <label className="block text-[9px] text-white/40">{smT('aspectRatio')}<select value={project.aspectRatio} onChange={(event) => commit(patchScriptMasterProjectSettings(projectRef.current, { aspectRatio: event.target.value }))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#161c28] px-2 py-2 text-[10px] text-white"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option><option>21:9</option></select></label>
               </div>
               <label className="flex items-center gap-2 rounded-lg border border-white/10 px-2 py-2 text-[9px] text-white/55"><input type="checkbox" checked={project.strictMode} onChange={(event) => commit(patchScriptMasterProjectSettings(projectRef.current, { strictMode: event.target.checked }))} />{smT('strictCompileGate')}</label>
               <label className="block text-[9px] text-white/40">{smT('llmPlatform')}<select aria-label={smT('llmPlatformAria')} value={llmSelection.provider} onChange={(event) => {
                 const provider = event.target.value;
                 const advanced = llmAdvancedProviders.find((item) => item.id === provider);
                 const model = advanced ? advancedProviderModelOptions(advanced, 'llm')[0] || '' : provider === 'seedance-nz' ? resolveSeedanceNzLlmModel('') : LLM_MODELS.find((item) => !isImageOutputLlm(item.id))?.id || '';
                 commit(patchScriptMasterProviderSelection(projectRef.current, 'llm', { provider, model, version: '1' }));
               }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#161c28] px-2 py-2 text-[10px] text-white"><option value="">{smT('providerNone')}</option><option value="zhenzhen">{smT('providerWorkshop')}</option><option value="seedance-nz">{smT('providerBudget')}</option>{llmAdvancedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} · {provider.protocol}</option>)}</select></label>
               <label className="block text-[9px] text-white/40">{smT('llmModel')}<select aria-label={smT('llmModelAria')} value={llmSelection.model} disabled={!llmSelection.provider} onChange={(event) => commit(patchScriptMasterProviderSelection(projectRef.current, 'llm', { ...llmSelection, model: event.target.value }))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#161c28] px-2 py-2 text-[10px] text-white disabled:opacity-40"><option value="">{smT('notSelected')}</option>{llmModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
               <label className="block text-[9px] text-white/40">{smT('compileTarget')}<select aria-label={smT('compileTargetAria')} value={project.compileTargets[0]?.id || ''} onChange={(event) => commit(selectScriptMasterCompileTarget(projectRef.current, event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#161c28] px-2 py-2 text-[10px] text-white">{project.compileTargets.map((target) => <option key={target.id} value={target.id}>{compileTargetDisplayLabel(target.id, target.label)}</option>)}</select></label>
               <p className="text-[9px] leading-4 text-white/25">{smT('fpsFrozenNote', { fps: project.fps })}</p>
            </div>
          </section>}
        </div>
        <div className="ml-4 hidden items-center gap-1.5 xl:flex">
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/55">{smT('characterCount', { count: summary.characters })}</span>
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/55">{smT('sceneCount', { count: summary.scenes })}</span>
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/55">{smT('shotCount', { count: summary.shots })}</span>
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/55">{summary.durationSeconds.toFixed(2)}s</span>
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/55">{smT('promptCharacters', { count: currentCompilation.humanPrompt.length })}</span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:thin] [&>*]:shrink-0">
          <select aria-label={smT('analysisScopeAria')} value={analysisScope} onChange={(event) => setAnalysisScope(event.target.value === 'current' ? 'current' : 'all')} className="hidden rounded-lg border border-white/10 bg-[#121722] px-2 py-2 text-[9px] text-white/55 2xl:block"><option value="all">{smT('analysisAll')}</option><option value="current">{smT('analysisCurrent')}</option></select>
          <button disabled={analyzing || !llmSelection.provider || !llmSelection.model || !project.shots.length} onClick={() => void runExplicitLlmAnalysis()} className="hidden items-center gap-1.5 rounded-lg border border-violet-300/25 bg-violet-300/10 px-2.5 py-2 text-[10px] text-violet-100 disabled:border-white/10 disabled:bg-transparent disabled:text-white/25 2xl:flex" title={smT('analyzeTitle')}><Sparkles size={13} className={analyzing ? 'animate-pulse' : ''} />{analyzing ? smT('analyzing') : smT('analyzeScript')}</button>
          <select aria-label={smT('downstreamTargetAria')} value={downstreamTarget} onChange={(event) => { setDownstreamTarget(event.target.value as ScriptMasterDownstreamTarget); setDownstreamPreview(null); }} className="hidden rounded-lg border border-white/10 bg-[#121722] px-2 py-2 text-[9px] text-white/55 xl:block">{(Object.keys(DOWNSTREAM_TARGET_LABELS) as ScriptMasterDownstreamTarget[]).map((target) => <option key={target} value={target}>{downstreamDisplayLabel(target)}</option>)}</select>
          <button disabled={downstreamBusy || !project.shots.length} onClick={() => void previewDownstreamPatch()} className="hidden items-center gap-1.5 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-2 text-[10px] text-emerald-100 disabled:border-white/10 disabled:bg-transparent disabled:text-white/25 xl:flex" title={smT('previewDownstreamTitle')}><Layers3 size={13} />{downstreamBusy ? smT('processing') : smT('previewDownstream')}</button>
          <button onClick={() => void compileAll(true)} className="flex items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-2 text-[10px] text-cyan-100"><Clipboard size={13} />{smT('compileAndCopy')}</button>
          <button onClick={exportBundle} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-white/65"><Download size={13} />{smT('export')}</button>
          <button aria-label={smT('closeWorkbench')} onClick={() => setWorkbenchOpen(false)} className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/5"><X size={16} /></button>
        </div>
      </header>

      {downstreamPreview && <div className="absolute inset-0 z-[70] grid place-items-center bg-black/75 p-6" role="alertdialog" aria-modal="true" aria-label={smT('confirmDownstreamAria')}>
        <section className="w-full max-w-2xl rounded-2xl border border-emerald-300/25 bg-[#101620] p-5 shadow-2xl">
          <div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-100"><Layers3 size={16} /></div><div className="min-w-0"><h3 className="text-sm font-semibold">{smT('confirmWriteTarget', { target: downstreamDisplayLabel(downstreamPreview.payloads[0]?.target || downstreamTarget) })}</h3><p className="mt-1 text-[10px] leading-4 text-white/45">{smT('downstreamPreviewNote')}</p></div></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[9px]"><div className="rounded-lg border border-white/10 bg-black/20 p-2"><b className="block text-sm text-white/80">{downstreamPreview.result.preview.changes.length}</b>{smT('changes')}</div><div className="rounded-lg border border-white/10 bg-black/20 p-2"><b className="block text-sm text-white/80">{downstreamPreview.result.preview.affectedNodeIds.length}</b>{smT('nodes')}</div><div className="rounded-lg border border-white/10 bg-black/20 p-2"><b className="block text-sm text-white/80">r{downstreamPreview.result.preview.currentRevision}</b>{smT('canvasBaseline')}</div></div>
          <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto" role="list" aria-label={smT('patchChangesAria')}>{downstreamPreview.result.preview.changes.map((change) => <div key={`${change.operationIndex}:${change.targetId}`} role="listitem" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[9px] text-white/55"><span className="mr-2 rounded border border-white/10 px-1.5 py-0.5 text-white/35">{change.type === 'node.add' ? smT('add') : smT('update')}</span><b className="text-white/75">{change.targetId}</b><span className="ml-2 text-white/30">{change.fields.join('、') || smT('nodeContent')}</span></div>)}</div>
          {!!downstreamPreview.result.preview.warnings?.length && <div role="alert" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[9px] text-amber-100">{downstreamPreview.result.preview.warnings.join('；')}</div>}
          <div className="mt-4 flex justify-end gap-2"><button disabled={downstreamBusy} onClick={() => setDownstreamPreview(null)} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/55 disabled:opacity-40">{smT('cancel')}</button><button disabled={downstreamBusy} onClick={() => void confirmDownstreamPatch()} className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-[10px] font-medium text-emerald-100 disabled:opacity-40">{downstreamBusy ? smT('writing') : smT('confirmWriteCanvas')}</button></div>
        </section>
      </div>}

       <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(320px,38vh)]">
         <div className="grid min-h-0 grid-cols-[260px_minmax(420px,1fr)_320px] xl:grid-cols-[300px_minmax(480px,1fr)_380px] 2xl:grid-cols-[330px_minmax(640px,1fr)_420px]">
           <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-[#0b0e14] p-4">
             <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-2 flex items-center gap-2"><FileInput size={14} className="text-violet-200" /><strong className="text-xs">{smT('sourceScript')}</strong><span className="ml-auto text-[9px] text-white/30">{smT('localParse')}</span></div>
              <textarea value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} placeholder={smT('sourcePlaceholder')} className="h-24 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] leading-4 text-white outline-none focus:border-violet-300/35" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => importSource(sourceDraft)} className="rounded-lg border border-violet-300/25 bg-violet-300/10 px-2 py-2 text-[10px] text-violet-100">{smT('importAndParse')}</button>
                <label className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-white/10 px-2 py-2 text-[10px] text-white/60"><Upload size={11} />TXT/MD/Fountain<input type="file" accept=".txt,.md,.markdown,.fountain,.json,text/plain,text/markdown,application/json" className="hidden" onChange={(event) => void handleSourceFile(event)} /></label>
              </div>
            </section>

            <div className="mb-2 flex items-center gap-2"><Layers3 size={14} className="text-cyan-200" /><strong className="text-xs">{smT('assetsAndReferences')}</strong><span className="ml-auto text-[9px] text-white/30">{smT('itemCount', { count: project.assets.length })}</span></div>
             <div className="mb-3 grid grid-cols-2 gap-2">
               <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 px-2 py-2.5 text-[9px] text-white/60"><ImageIcon size={14} />{smT('imageVideo')}<input multiple type="file" accept="image/*,video/*" className="hidden" onChange={handleAssetFiles} /></label>
               <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 px-2 py-2.5 text-[9px] text-white/60"><AudioLines size={14} />{smT('audio')}<input multiple type="file" accept="audio/*" className="hidden" onChange={handleAssetFiles} /></label>
               <button disabled={uploading} onClick={syncUpstream} className="col-span-2 flex items-center justify-center gap-2 rounded-lg border border-cyan-300/20 px-2 py-2.5 text-[9px] text-cyan-100 disabled:opacity-40"><RefreshCw size={14} className={uploading ? 'animate-spin' : ''} />{smT('syncUpstreamAssets')}</button>
            </div>
            <div className="mb-2 flex gap-1 overflow-x-auto">
              {(['all', 'image', 'video', 'audio'] as const).map((filter) => <button key={filter} onClick={() => setAssetFilter(filter)} className={`rounded-full border px-2 py-1 text-[9px] ${assetFilter === filter ? 'border-violet-300/30 bg-violet-300/10 text-violet-100' : 'border-white/10 text-white/35'}`}>{smT(`assetFilters.${filter}`)}</button>)}
            </div>
             <div ref={assetScrollerRef} role="list" aria-label={smT('assetListAria')} aria-setsize={filteredAssets.length} onScroll={(event) => setAssetViewport({ scrollTop: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })} className="max-h-[min(42vh,460px)] overflow-y-auto pr-1">
              {assetTopSpacerHeight > 0 && <div aria-hidden="true" style={{ height: assetTopSpacerHeight }} />}
              <div className="space-y-2">
              {visibleAssets.map((asset, visibleIndex) => {
                const binding = project.bindings.find((item) => item.assetId === asset.id);
                 return <article key={asset.id} role="listitem" aria-posinset={assetStartIndex + visibleIndex + 1} aria-setsize={filteredAssets.length} className={`h-[116px] overflow-hidden rounded-xl border p-3 ${assetTone(asset)}`}>
                   <div className="flex gap-3">
                     <div className="grid h-16 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                       {asset.mediaKind === 'image' && asset.url ? <SmartImage src={asset.url} alt={`${asset.alias} ${asset.name}`} thumbSize={240} className="h-full w-full object-cover" /> : asset.mediaKind === 'video' ? <Film size={17} aria-label={smT('videoAsset')} /> : <Volume2 size={17} aria-label={smT('audioAsset')} />}
                    </div>
                     <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><strong className="rounded bg-black/30 px-1.5 py-0.5 text-[10px]">{asset.alias}</strong><span className="truncate text-[10px] text-white/80">{asset.name}</span></div><p className="mt-1 truncate text-[9px] text-white/35">{smT(`assetKinds.${asset.kind}`, { defaultValue: asset.kind })} · r{asset.revision} · {asset.probeStatus === 'ready' ? smT('probeReady', { frames: asset.durationFrames ? smT('frameCount', { count: asset.durationFrames }) : '' }) : asset.probeStatus === 'error' ? smT('probeError') : asset.probeStatus === 'probing' ? smT('probing') : smT('notProbed')}</p></div>
                     {asset.probeStatus !== 'ready' && <button disabled={!asset.url || asset.probeStatus === 'probing'} onClick={() => void probeAssets([asset])} className="self-start text-cyan-200/60 disabled:text-white/15" aria-label={smT('reprobeAsset', { alias: asset.alias, name: asset.name })} title={asset.probeError || smT('probeMedia')}><RefreshCw size={12} className={asset.probeStatus === 'probing' ? 'animate-spin' : ''} /></button>}
                     <button disabled={asset.locked} onClick={() => commit(removeScriptMasterAsset(projectRef.current, asset.id))} className="self-start text-rose-300/55 disabled:text-white/15" aria-label={smT('deleteAsset', { alias: asset.alias, name: asset.name })} title={smT('deleteAssetTitle')}><Trash2 size={12} /></button>
                  </div>
                   {binding && <div className="mt-3 flex items-center gap-2"><select value={binding.scope} onChange={(event) => changeBindingScope(binding, event.target.value as ScriptMasterScope)} className="min-w-0 flex-1 rounded border border-white/10 bg-[#121722] px-2 py-1.5 text-[9px] text-white/65">{(Object.keys(SCOPE_LABELS) as ScriptMasterScope[]).map((scope) => <option key={scope} value={scope}>{scopeDisplayLabel(scope)}</option>)}</select><button onClick={() => commit(patchScriptMasterBinding(projectRef.current, binding.id, { locked: !binding.locked }))} className={binding.locked ? 'text-amber-200' : 'text-white/35'}>{binding.locked ? <Lock size={14} /> : <Unlock size={14} />}</button></div>}
                </article>;
              })}
              </div>
              {assetBottomSpacerHeight > 0 && <div aria-hidden="true" style={{ height: assetBottomSpacerHeight }} />}
              {!filteredAssets.length && <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[10px] leading-4 text-white/25">{smT('emptyAssets')}</div>}
            </div>
          </aside>

           <main className="relative min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_50%_25%,rgba(79,70,229,0.12),transparent_42%)] p-5">
            {selectedShot ? <div className="mx-auto flex h-full max-w-5xl flex-col">
               <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2 py-1 text-[9px] text-violet-100">{smT('shotIndex', { current: project.shots.findIndex((shot) => shot.id === selectedShot.id) + 1, total: project.shots.length })}</span>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-white/45">{formatScriptMasterTimecode(selectedShot.range.start, project.fps)} — {formatScriptMasterTimecode(selectedShot.range.end, project.fps)}</span>
                <div className="ml-auto flex flex-wrap justify-end gap-1">{selectedAssets.map(({ asset, binding }) => <span key={binding.id} className={`rounded-full border px-2 py-1 text-[9px] ${assetTone(asset)}`}>{asset.alias} · {scopeDisplayLabel(binding.scope)}</span>)}</div>
               </div>
               {activeAnalysisCandidate && <section className="mb-3 rounded-xl border border-violet-300/25 bg-violet-300/[0.07] p-3" aria-label={smT('candidateReviewAria')}>
                 <div className="flex items-center gap-2"><Sparkles size={13} className="text-violet-200" /><strong className="text-[11px]">{smT('candidateReview')}</strong><span className="rounded border border-white/10 px-1.5 py-0.5 text-[8px] text-white/40">{activeAnalysisCandidate.provider} · {activeAnalysisCandidate.model}</span><span className="text-[9px] text-white/35">{smT('candidateMeta', { shots: activeAnalysisCandidate.shotSuggestions.length, fields: analysisCandidateChangeCount(activeAnalysisCandidate), confidence: Math.round(activeAnalysisCandidate.confidence * 100) })}</span><div className="ml-auto flex gap-1"><button onClick={rejectAnalysisCandidate} className="rounded border border-white/10 px-2 py-1 text-[9px] text-white/50">{smT('discard')}</button><button onClick={adoptAnalysisCandidate} className="rounded border border-violet-300/30 bg-violet-300/10 px-2 py-1 text-[9px] text-violet-100">{smT('adoptCandidate')}</button></div></div>
                 {activeAnalysisCandidate.shotSuggestions.find((suggestion) => suggestion.shotId === selectedShot.id) ? <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] leading-4 text-white/55">{Object.entries(activeAnalysisCandidate.shotSuggestions.find((suggestion) => suggestion.shotId === selectedShot.id)!.fields).map(([field, value]) => <div key={field} className="rounded-lg border border-white/10 bg-black/20 p-2"><b className="block text-violet-100/75">{field}</b><span className="line-clamp-2">{Array.isArray(value) ? value.join('；') : value}</span></div>)}</div> : <p className="mt-2 text-[9px] text-white/35">{smT('noCandidateChange')}</p>}
                 <p className="mt-2 text-[8px] text-white/30">{smT('candidateSafetyNote')}</p>
               </section>}
               {project.analysis.status === 'error' && project.analysis.lastError && <div role="alert" className="mb-3 rounded-lg border border-rose-300/25 bg-rose-300/[0.07] px-3 py-2 text-[9px] text-rose-100">{project.analysis.lastError}</div>}
               <div className="relative min-h-[260px] flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/45 shadow-2xl">
                {previewAsset?.mediaKind === 'image' && previewAsset.url ? <SmartImage src={previewAsset.url} alt={smT('shotReferencePreview')} thumbSize={960} className="absolute inset-0 h-full w-full object-contain opacity-70" /> : previewAsset?.mediaKind === 'video' && previewAsset.url ? <LazyVideo src={previewAsset.url} muted controls className="absolute inset-0 h-full w-full object-contain opacity-80" /> : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-black/30" />
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="mb-2 flex items-center gap-2"><span className="rounded bg-white/10 px-2 py-1 text-[9px] text-white/55">{smT('storyboardPreview')}</span>{!previewAsset && <span className="text-[9px] text-white/30">{smT('noRealFrame')}</span>}</div>
                  <h3 className="text-lg font-semibold">{selectedShot.title}</h3>
                  <p className="mt-2 max-w-3xl whitespace-pre-wrap text-xs leading-5 text-white/65">{selectedShot.visualDescription || smT('noVisualDescription')}</p>
                  {selectedShot.action && <p className="mt-2 text-[11px] text-cyan-100/70">{smT('actionValue', { value: selectedShot.action })}</p>}
                  <div className="mt-3 flex items-center gap-2"><button onClick={() => selectRelativeShot(-1)} className="rounded-full border border-white/10 p-2 text-white/55" title={smT('previousShot')}><ChevronLeft size={14} /></button><button onClick={() => setPlaying((value) => !value)} className="grid h-9 w-9 place-items-center rounded-full border border-violet-300/30 bg-violet-300/15 text-violet-100" title={playing ? smT('pauseSpace') : smT('playSpace')}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><button onClick={() => selectRelativeShot(1)} className="rounded-full border border-white/10 p-2 text-white/55" title={smT('nextShot')}><ChevronRight size={14} /></button><button onClick={() => setLoopCurrentShot((value) => !value)} className={`rounded-full border px-2 py-1.5 text-[9px] ${loopCurrentShot ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-white/35'}`} title={smT('loopCurrentShot')}>{smT('loop')}</button><span className="ml-2 text-[9px] text-white/30">{smT('playheadLinked')}</span></div>
                </div>
              </div>
              <section className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="mb-2 flex items-center"><strong className="text-[11px]">{smT('currentCompiledPrompt')}</strong><span className="ml-auto text-[9px] text-white/30">{smT('deterministicCompile')}</span></div>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-white/45">{currentCompilation.promptPacks[0]?.prompt || smT('compileAfterImport')}</pre>
              </section>
            </div> : <div className="grid h-full place-items-center"><div className="max-w-sm text-center"><BookOpenText size={36} className="mx-auto text-violet-200/60" /><h3 className="mt-3 text-sm font-semibold">{smT('importOrAddShot')}</h3><p className="mt-2 text-[10px] leading-5 text-white/35">{smT('localImportNote')}</p><button onClick={() => { const next = appendScriptMasterShot(projectRef.current); commit(next); setSelectedShotId(next.shots.at(-1)?.id || ''); }} className="mt-4 rounded-lg border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-[10px] text-violet-100"><Plus size={12} className="mr-1 inline" />{smT('addEmptyShot')}</button></div></div>}
          </main>

               <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-[#0b0e14] p-4">
            <div className="mb-3 flex items-center gap-2"><Settings2 size={14} className="text-violet-200" /><strong className="text-xs">{smT('shotInspector')}</strong>{selectedShot && <span className="ml-auto text-[9px] text-white/30">{smT('frameCount', { count: rangeDurationFrames(selectedShot.range, project.fps) })}</span>}</div>
            {selectedShot ? <div className="space-y-3">
              <label className="block text-[10px] text-white/45">{smT('shotName')}<input value={selectedShot.title} onChange={(event) => patchShot(selectedShot, { title: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs text-white" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-[10px] text-white/45">{smT('startTime')}<input readOnly value={formatScriptMasterTimecode(selectedShot.range.start, project.fps)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[10px] text-white/55" /></label><label className="block text-[10px] text-white/45">{smT('durationSeconds')}<input type="number" min={1 / project.fps} step={1 / project.fps} value={(rangeDurationFrames(selectedShot.range, project.fps) / project.fps).toFixed(3)} onChange={(event) => patchShot(selectedShot, { durationFrames: Math.max(1, Math.round(Number(event.target.value) * project.fps)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label></div>
              <label className="block text-[10px] text-white/45">{smT('shotPurpose')}<textarea value={selectedShot.purpose} onChange={(event) => patchShot(selectedShot, { purpose: event.target.value })} className="mt-1 h-16 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] leading-4 text-white" /></label>
              <label className="block text-[10px] text-white/45">{smT('visibleFrame')}<textarea value={selectedShot.visualDescription} onChange={(event) => patchShot(selectedShot, { visualDescription: event.target.value })} className="mt-1 h-24 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] leading-4 text-white" /></label>
              <label className="block text-[10px] text-white/45">{smT('actionAndEndState')}<textarea value={selectedShot.action} onChange={(event) => patchShot(selectedShot, { action: event.target.value })} className="mt-1 h-16 w-full resize-none rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] leading-4 text-white" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-[10px] text-white/45">{smT('shotSize')}<select value={selectedShot.shotSize} onChange={(event) => patchShot(selectedShot, { shotSize: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#121722] px-2 py-2 text-[10px] text-white">{['大远景', '远景', '全景', '中景', '近景', '特写', '微距'].map((value, index) => <option key={value} value={value}>{smT(`shotSizes.${index}`, { defaultValue: value })}</option>)}</select></label><label className="block text-[10px] text-white/45">{smT('camera')}<input value={selectedShot.camera} onChange={(event) => patchShot(selectedShot, { camera: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label></div>
              <div className="grid grid-cols-3 gap-2"><label className="block text-[10px] text-white/45">{smT('transitionIn')}<input aria-label={smT('transitionInAria')} value={selectedShot.transitionIn} onChange={(event) => patchShot(selectedShot, { transitionIn: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label><label className="block text-[10px] text-white/45">{smT('transitionOut')}<input aria-label={smT('transitionOutAria')} value={selectedShot.transitionOut} onChange={(event) => patchShot(selectedShot, { transitionOut: event.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label><label className="block text-[10px] text-white/45">{smT('handlesFrames')}<input aria-label={smT('handlesFramesAria')} type="number" min={0} step={1} value={selectedShot.transitionInFrames} onChange={(event) => patchShot(selectedShot, { transitionInFrames: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label></div>
              <label className="block text-[10px] text-white/45">{smT('mustInclude')}<input value={selectedShot.mustInclude.join('；')} onChange={(event) => patchShot(selectedShot, { mustInclude: event.target.value.split(/[；;]/).map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label>
              <label className="block text-[10px] text-white/45">{smT('mustAvoid')}<input value={selectedShot.mustAvoid.join('；')} onChange={(event) => patchShot(selectedShot, { mustAvoid: event.target.value.split(/[；;]/).map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white" /></label>
              <section className="rounded-xl border border-white/10 bg-white/[0.025] p-2"><div className="mb-2 flex items-center"><strong className="text-[10px]">{smT('shotReferences')}</strong><span className="ml-auto text-[9px] text-white/30">{selectedAssets.length}</span></div><div className="flex flex-wrap gap-1">{selectedAssets.map(({ asset, binding }) => <span key={binding.id} className={`rounded-full border px-2 py-1 text-[9px] ${assetTone(asset)}`}>{asset.alias} · {scopeDisplayLabel(binding.scope)}</span>)}{!selectedAssets.length && <span className="text-[9px] text-white/25">{smT('noValidReferences')}</span>}</div></section>
              <div className="grid grid-cols-3 gap-2"><button onClick={() => { const next = duplicateScriptMasterShot(projectRef.current, selectedShot.id); commit(next); const index = next.shots.findIndex((shot) => shot.id === selectedShot.id); setSelectedShotId(next.shots[index + 1]?.id || selectedShot.id); }} className="rounded-lg border border-white/10 px-2 py-2 text-[9px] text-white/55"><Copy size={11} className="mr-1 inline" />{smT('copy')}</button><button onClick={() => { const next = appendScriptMasterShot(projectRef.current); commit(next); setSelectedShotId(next.shots.at(-1)?.id || ''); }} className="rounded-lg border border-white/10 px-2 py-2 text-[9px] text-white/55"><Plus size={11} className="mr-1 inline" />{smT('add')}</button><button disabled={selectedShot.locked} onClick={() => commit(removeScriptMasterShot(projectRef.current, selectedShot.id))} className="rounded-lg border border-rose-300/20 px-2 py-2 text-[9px] text-rose-200/70 disabled:opacity-25"><Trash2 size={11} className="mr-1 inline" />{smT('delete')}</button></div>
            </div> : <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[10px] text-white/25">{smT('selectShotToEdit')}</div>}
          </aside>
        </div>

        <section className="flex min-h-0 flex-col overflow-hidden border-t border-white/10 bg-[#090c12]">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4"><Scissors size={16} className="text-violet-200" /><strong className="text-[11px]">{smT('multitrackTimeline')}</strong><span className="text-[9px] text-white/30">{smT('timelineContract')}</span><span className="rounded border border-white/10 px-2 py-1 text-[8px] text-white/35">{smT('selectedCount', { count: selectedTimelineItems.length })}</span><div className="ml-auto flex items-center gap-2"><button onClick={() => { const zoom = Math.max(0.5, projectRef.current.timeline.zoom - 0.25); setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'zoom', zoom }, scriptMasterControllerOptions(projectRef.current))); commit(patchScriptMasterTimelineView(projectRef.current, { zoom }), {}, { recordHistory: false, viewOnly: true }); }} className="rounded border border-white/10 p-2 text-white/45" title={smT('zoomOutTimeline')}><ZoomOut size={14} /></button><span className="w-12 text-center text-[9px] text-white/35">{Math.round(project.timeline.zoom * 100)}%</span><button onClick={() => { const zoom = Math.min(4, projectRef.current.timeline.zoom + 0.25); setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'zoom', zoom }, scriptMasterControllerOptions(projectRef.current))); commit(patchScriptMasterTimelineView(projectRef.current, { zoom }), {}, { recordHistory: false, viewOnly: true }); }} className="rounded border border-white/10 p-2 text-white/45" title={smT('zoomInTimeline')}><ZoomIn size={14} /></button></div></div>
          <div className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-white/10 bg-[#0a0e15] px-4 py-2 [scrollbar-width:thin]">
            <button disabled={!historyRef.current.past.length} onClick={undoWorkbenchChange} className="rounded border border-white/10 p-2 text-white/45 disabled:opacity-20" title={smT('undoTitle')}><RotateCcw size={14} /></button>
            <button disabled={!historyRef.current.future.length} onClick={redoWorkbenchChange} className="rounded border border-white/10 p-2 text-white/45 disabled:opacity-20" title={smT('redoTitle')}><RotateCw size={14} /></button>
            <span className="mx-1 h-4 w-px bg-white/10" />
            {TIMELINE_TOOL_LABELS.map(({ tool }) => <button key={tool} onClick={() => setTimelineTool(tool)} className={`flex items-center gap-1 rounded border px-2 py-1 text-[8px] ${timelineController.activeTool === tool ? 'border-violet-300/35 bg-violet-300/10 text-violet-100' : 'border-white/10 text-white/35'}`} title={smT('timelineToolTitle', { tool: timelineToolDisplayLabel(tool) })}>{timelineToolIcon(tool)}{timelineToolDisplayLabel(tool)}</button>)}
            <button onClick={() => { const snap = !projectRef.current.timeline.snap; setTimelineController((current) => applyVideoEditTimelineControllerCommand(current, { type: 'snap', enabled: snap }, scriptMasterControllerOptions(projectRef.current))); commit(patchScriptMasterTimelineView(projectRef.current, { snap }), {}, { recordHistory: false, viewOnly: true }); }} className={`flex items-center gap-1 rounded border px-2 py-1 text-[8px] ${project.timeline.snap ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-white/30'}`} title={smT('snapToggle')}><Magnet size={10} />{smT('snap')}</button>
            <span className="mx-1 h-4 w-px bg-white/10" />
            <button disabled={!selectedTimelineItems.length} onClick={splitTimelineSelection} className="rounded border border-white/10 px-2 py-1 text-[8px] text-white/50 disabled:opacity-20">{smT('split')}</button>
            <button disabled={selectedTimelineItems.filter((item) => item.kind === 'shot').length < 2} onClick={mergeTimelineSelection} className="rounded border border-white/10 px-2 py-1 text-[8px] text-white/50 disabled:opacity-20">{smT('merge')}</button>
            <button disabled={!selectedTimelineItems.length} onClick={duplicateTimelineSelection} className="rounded border border-white/10 px-2 py-1 text-[8px] text-white/50 disabled:opacity-20">{smT('copy')}</button>
            <button disabled={!selectedTimelineItems.length} onClick={deleteTimelineSelection} className="rounded border border-rose-300/15 px-2 py-1 text-[8px] text-rose-200/65 disabled:opacity-20">{smT('delete')}</button>
            <button onClick={() => { const next = appendScriptMasterShot(projectRef.current); commit(next, {}, { historyKey: 'timeline-new-shot', forceHistoryBoundary: true }); setSelectedShotId(next.shots.at(-1)?.id || ''); }} className="rounded border border-white/10 px-2 py-1 text-[8px] text-white/50">{smT('newShot')}</button>
            <button disabled={!project.shots.length || project.shots.some((shot) => shot.locked)} onClick={distributeShotDurations} className="rounded border border-white/10 px-2 py-1 text-[8px] text-white/50 disabled:opacity-20">{smT('distributeEvenly')}</button>
            <span className="ml-auto hidden text-[8px] text-white/25 xl:inline">{smT('timelineHelp')}</span>
          </div>
          <div ref={timelineScrollerRef} role="grid" aria-label={smT('timelineAria')} aria-rowcount={project.timeline.tracks.length} onScroll={(event) => updateTimelineViewport(event.currentTarget)} onPointerDown={beginTimelineMarquee} className="relative min-h-0 flex-1 overflow-auto">
            <div className="relative" style={{ minWidth: `${Math.max(100, project.timeline.zoom * 100)}%` }}>
              {marquee && <div style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} className="pointer-events-none absolute z-40 border border-cyan-200/70 bg-cyan-300/10" />}
              <div className="sticky top-0 z-20 grid h-9 grid-cols-[240px_minmax(900px,1fr)] border-b border-white/10 bg-[#0b0f17]"><div className="border-r border-white/10 px-4 py-2 text-[9px] text-white/30">{smT('trackGroupSubtrack')}</div><div className="relative cursor-crosshair" onClick={handleTimelineClick}>{[0, 0.25, 0.5, 0.75, 1].map((ratio) => <span key={ratio} style={{ left: `${ratio * 100}%` }} className="absolute top-2 -translate-x-1/2 text-[8px] text-white/25">{formatScriptMasterTimecode(rationalTime(Math.round(project.targetDurationFrames * ratio), project.fps), project.fps)}</span>)}<span style={{ left: `${project.targetDurationFrames ? project.timeline.playhead.value / project.targetDurationFrames * 100 : 0}%` }} className="pointer-events-none absolute inset-y-0 z-30 w-px bg-rose-300" /></div></div>
              {timelineTopSpacerHeight > 0 && <div aria-hidden="true" style={{ height: timelineTopSpacerHeight }} />}
              {visibleTimelineTracks.map((track, visibleTrackIndex) => {
                const items = project.timeline.items.filter((item) => item.trackId === track.id && (
                  project.timeline.selectedItemIds.includes(item.id)
                  || (item.range.end.value >= timelineVisibleStartFrame && item.range.start.value <= timelineVisibleEndFrame)
                ));
                return <div key={track.id} role="row" aria-rowindex={timelineTrackStart + visibleTrackIndex + 1} className={`grid h-12 grid-cols-[240px_minmax(900px,1fr)] border-b border-white/[0.06] ${track.hidden ? 'opacity-55' : ''}`}>
                  <div role="rowheader" className="flex items-center gap-2 border-r border-white/10 px-4"><span className="w-10 rounded border border-white/10 px-1.5 py-1 text-center text-[8px] text-white/35">{groupDisplayLabel(track.group)}</span><span className="min-w-0 flex-1 truncate text-[9px] text-white/55">{trackDisplayName(track.id, track.name)}</span><button aria-label={smT(track.locked ? 'unlockTrackAria' : 'lockTrackAria', { name: trackDisplayName(track.id, track.name) })} onClick={() => commit(patchScriptMasterTimelineTrack(projectRef.current, track.id, { locked: !track.locked }), {}, { historyKey: `track:${track.id}` })} className={track.locked ? 'text-amber-200' : 'text-white/25'} title={smT(track.locked ? 'unlockTrack' : 'lockTrack')}>{track.locked ? <Lock size={12} /> : <Unlock size={12} />}</button><button aria-label={smT(track.hidden ? 'showTrackAria' : 'hideTrackAria', { name: trackDisplayName(track.id, track.name) })} onClick={() => commit(patchScriptMasterTimelineTrack(projectRef.current, track.id, { hidden: !track.hidden }), {}, { historyKey: `track:${track.id}` })} className={track.hidden ? 'text-white/20' : 'text-white/35'} title={smT(track.hidden ? 'showTrack' : 'hideTrack')}>{track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button><button aria-label={smT(track.muted ? 'unmuteTrackAria' : 'muteTrackAria', { name: trackDisplayName(track.id, track.name) })} onClick={() => commit(patchScriptMasterTimelineTrack(projectRef.current, track.id, { muted: !track.muted }), {}, { historyKey: `track:${track.id}` })} className={track.muted ? 'text-rose-200/70' : 'text-white/35'} title={smT(track.muted ? 'unmuteTrack' : 'muteTrack')}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button></div>
                  <div className="relative min-h-12 cursor-crosshair bg-[linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:10%_100%]" onClick={handleTimelineClick}>
                    {!track.hidden && items.map((item) => {
                      const total = Math.max(1, project.targetDurationFrames);
                      const left = item.range.start.value / total * 100;
                      const width = Math.max(0.35, (item.range.end.value - item.range.start.value) / total * 100);
                      const isSelected = project.timeline.selectedItemIds.includes(item.id);
                      const waveformAsset = item.assetId ? project.assets.find((asset) => asset.id === item.assetId && asset.mediaKind === 'audio') : null;
                      const itemTimeLabel = smT('timeRange', { start: formatScriptMasterTimecode(item.range.start, project.fps), end: formatScriptMasterTimecode(item.range.end, project.fps) });
                      return <button key={item.id} role="gridcell" data-script-master-timeline-item={item.id} aria-label={smT('timelineItemAria', { group: groupDisplayLabel(track.group), label: item.label, time: itemTimeLabel, waveform: waveformAsset?.waveformPeaks.length ? smT('waveformReadySuffix') : '', selected: isSelected ? smT('selectedSuffix') : '', locked: item.locked || track.locked ? smT('lockedSuffix') : '' })} aria-selected={isSelected} style={{ left: `${left}%`, width: `${width}%` }} onPointerDown={(event) => beginTimelineItemPointer(event, item)} onDoubleClick={() => { const next = splitScriptMasterTimelineItem(projectRef.current, item.id, projectRef.current.timeline.playhead.value); if (next.revision !== projectRef.current.revision) commit(next, {}, { historyKey: 'timeline-double-split', forceHistoryBoundary: true }); }} onClick={(event) => { event.stopPropagation(); if (item.shotId) setSelectedShotId(item.shotId); }} className={`absolute inset-y-1.5 overflow-hidden rounded-md border px-2 py-1 text-left text-[8px] shadow ${timelineItemTone(item, track)} ${isSelected ? 'ring-2 ring-white/75 ring-offset-1 ring-offset-[#090c12]' : ''} ${track.locked || item.locked ? 'cursor-not-allowed' : timelineController.activeTool === 'blade' ? 'cursor-crosshair' : 'cursor-grab'}`} title={`${item.label} · ${formatScriptMasterTimecode(item.range.start, project.fps)}-${formatScriptMasterTimecode(item.range.end, project.fps)}`}><span className="relative z-10 block truncate">{item.label}</span>{waveformAsset?.waveformPeaks.length ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 bottom-0 flex h-3 items-end gap-px opacity-45">{waveformAsset.waveformPeaks.map((peak, peakIndex) => <i key={peakIndex} className="min-w-px flex-1 bg-current" style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }} />)}</span> : null}{isSelected && item.kind !== 'transition' && <><span onPointerDown={(event) => beginTimelineItemPointer(event, item, 'start')} className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize border-l border-white/70 bg-white/10" title={smT('trimStart')} /><span onPointerDown={(event) => beginTimelineItemPointer(event, item, 'end')} className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize border-r border-white/70 bg-white/10" title={smT('trimEnd')} /></>}</button>;
                    })}
                    <span style={{ left: `${project.targetDurationFrames ? project.timeline.playhead.value / project.targetDurationFrames * 100 : 0}%` }} className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-300 shadow-[0_0_8px_rgba(253,164,175,0.9)]" />
                  </div>
                </div>;
              })}
              {timelineBottomSpacerHeight > 0 && <div aria-hidden="true" style={{ height: timelineBottomSpacerHeight }} />}
            </div>
          </div>
        </section>
      </div>
      <footer
        className="flex h-9 shrink-0 items-center gap-4 border-t border-white/10 bg-[#080a0f] px-4 text-[9px] text-white/35"
        role="status"
        aria-live="polite"
      ><Save size={10} /><span>{message ? scriptMasterRuntimeText(message) : smT('readyNoAutoGenerate')}</span><span className="ml-auto">{smT('validationSummary', { blockers: summary.blockers, warnings: summary.warnings })} · schema t8-script-master-project-v1</span></footer>
    </div>,
    document.body,
  ) : null;

  if (canvasRenderMode === 'cold' && !workbenchOpen) {
    return (
      <div className="t8-node-cold-shell w-[390px]" data-t8-node-cold-shell="script-master" style={{ minHeight: 220 }}>
        <div className="t8-node-cold-shell__header">
          <BookOpenText size={17} className="shrink-0 text-violet-200" />
          <div className="t8-node-cold-shell__copy">
            <strong>{translate('nodes:scriptMaster.title')}</strong>
            <small>{translate('nodes:scriptMaster.offscreenSummary', { title: project.title, count: summary.shots })} · {translate('common:performance.offscreenPreview')}</small>
          </div>
        </div>
        <Handle type="target" position={Position.Left} className="!h-4 !w-4 !border-2 !border-[#0b0e14] !bg-violet-300" />
        <Handle type="source" position={Position.Right} className="!h-4 !w-4 !border-2 !border-[#0b0e14] !bg-cyan-300" />
      </div>
    );
  }

  return <>
    <div className={`w-[390px] overflow-hidden rounded-2xl border bg-[#0b0e14] text-white shadow-2xl transition ${selected ? 'border-violet-300/60 shadow-violet-500/10' : 'border-white/10'}`}>
      <div className="flex items-center gap-3 border-b border-white/10 bg-gradient-to-r from-violet-500/15 to-cyan-500/5 px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-violet-300/30 bg-violet-300/10 text-violet-100"><BookOpenText size={17} /></div>
        <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{translate('nodes:scriptMaster.title')}</h3><p className="truncate text-[10px] text-white/40">{scriptMasterRuntimeText(project.title)} · {domainDisplayLabel(project.domain)}</p></div>
        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[9px] text-white/45">r{project.revision}</span>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-4 gap-1.5">{[
          [smT('duration'), `${summary.durationSeconds.toFixed(1)}s`],
          [smT('scenes'), summary.scenes],
          [smT('shots'), summary.shots],
          [smT('characters'), summary.characters],
        ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-white/10 bg-white/[0.025] px-2 py-2 text-center"><strong className="block text-xs text-white/80">{value}</strong><span className="text-[8px] text-white/30">{label}</span></div>)}</div>
        <div className="flex flex-wrap gap-1.5"><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-1 text-[9px] text-cyan-100">{smT('referenceImagesCount', { count: summary.images })}</span><span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/[0.06] px-2 py-1 text-[9px] text-fuchsia-100">{smT('videosCount', { count: summary.videos })}</span><span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-[9px] text-amber-100">{smT('audiosCount', { count: summary.audios })}</span>{summary.blockers > 0 && <span className="flex items-center gap-1 rounded-full border border-rose-300/25 bg-rose-300/[0.08] px-2 py-1 text-[9px] text-rose-100"><AlertTriangle size={9} />{smT('blockersCount', { count: summary.blockers })}</span>}{summary.blockers === 0 && summary.shots > 0 && <span className="flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-2 py-1 text-[9px] text-emerald-100"><CheckCircle2 size={9} />{smT('structureCompilable')}</span>}</div>
        <button onClick={() => { setSourceDraft(project.sourceDocuments.at(-1)?.content || ''); setWorkbenchOpen(true); }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300/30 bg-violet-300/10 px-3 py-2.5 text-xs font-medium text-violet-100 hover:bg-violet-300/15"><Maximize2 size={14} />{smT('openScriptMaster')}</button>
        <div className="grid grid-cols-3 gap-2"><button onClick={() => { setSourceDraft(project.sourceDocuments.at(-1)?.content || ''); setWorkbenchOpen(true); }} className="rounded-lg border border-white/10 px-2 py-2 text-[9px] text-white/55"><FileInput size={11} className="mr-1 inline" />{smT('importReplace')}</button><button onClick={() => void compileAll(true)} className="rounded-lg border border-cyan-300/20 px-2 py-2 text-[9px] text-cyan-100"><Copy size={11} className="mr-1 inline" />{smT('exportPrompt')}</button><button onClick={() => { setSourceDraft(project.sourceDocuments.at(-1)?.content || ''); setWorkbenchOpen(true); setMessage(smT('previewBeforeWrite')); }} className="rounded-lg border border-emerald-300/20 px-2 py-2 text-[9px] text-emerald-100"><Layers3 size={11} className="mr-1 inline" />{smT('downstreamNodes')}</button></div>
        <p className="line-clamp-2 min-h-8 text-[9px] leading-4 text-white/30">{message ? scriptMasterRuntimeText(message) : smT('compactSafetyNote')}</p>
      </div>
      <Handle type="target" position={Position.Left} className="!h-4 !w-4 !border-2 !border-[#0b0e14] !bg-violet-300" />
      <Handle type="source" position={Position.Right} className="!h-4 !w-4 !border-2 !border-[#0b0e14] !bg-cyan-300" />
    </div>
    {workbench}
  </>;
};

export default memo(ScriptMasterNode);
