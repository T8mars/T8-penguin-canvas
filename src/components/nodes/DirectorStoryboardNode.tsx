import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  Clapperboard,
  Copy,
  Download,
  Image as ImageIcon,
  Library,
  Loader2,
  Music,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video as VideoIcon,
  Wand2,
  X,
} from 'lucide-react';
import {
  generateExternalVideo,
  querySeedance,
  submitSeedance,
  type SeedanceTaskProvider,
  uploadFile,
} from '../../services/generation';
import * as api from '../../services/api';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { minimumProviderMediaPollCount } from '../../utils/providerTimeoutPolicy';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { useThemeStore } from '../../stores/theme';
import { useApiKeysStore } from '../../stores/apiKeys';
import { logBus } from '../../stores/logs';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useTranslation } from 'react-i18next';
import { assignDirectorShotImages, importDirectorUpstreamScripts } from '../../utils/directorStoryboardImport';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import MentionPromptInput from './MentionPromptInput';
import SmartImage from '../SmartImage';
import LoopingVideo from '../LoopingVideo';
import { LocalNodeAddonSlot } from 'virtual:t8-local-extensions';
import {
  DIRECTOR_BRIDGE_PROMPT_PRESETS,
  buildDirectorStoryboardBridgeRunPlan,
  createDirectorBridgePromptPresetExport,
  buildDirectorStoryboardOutputItems,
  buildDirectorStoryboardOutputSummary,
  buildDirectorStoryboardReferenceOrder,
  buildDirectorStoryboardRunPlan,
  buildDirectorStoryboardShotInputPatch,
  calculateDirectorTimelineDragDuration,
  DIRECTOR_STORYBOARD_MAX_DURATION_SEC,
  DIRECTOR_STORYBOARD_MIN_DURATION_SEC,
  parseDirectorBridgePromptPresetImport,
  reorderDirectorStoryboardReference,
  runDirectorStoryboardJobs,
  sanitizeDirectorBridgePromptPresets,
  sanitizeDirectorStoryboardBridges,
  sanitizeDirectorStoryboardShots,
  type DirectorBridgePromptPreset,
  type DirectorStoryboardBridge,
  type DirectorStoryboardJob,
  type DirectorStoryboardJobResult,
  type DirectorStoryboardMentionMaterial,
  type DirectorStoryboardReferenceItem,
  type DirectorStoryboardShot,
} from '../../utils/directorStoryboard';
import { materialMentionKey, type MediaMention } from './mediaMentions';
import {
  LEGACY_SEEDANCE_MODEL_OPTIONS,
  LEGACY_SEEDANCE_RATIO_OPTIONS,
  LEGACY_SEEDANCE_RESOLUTION_OPTIONS,
  SEEDANCE_NZ_MODEL_OPTIONS,
  SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS,
  SEEDANCE_NZ_RATIO_OPTIONS,
  SEEDANCE_NZ_RESOLUTION_OPTIONS,
  isSeedanceBuiltinSource,
  isSeedanceNzStandardModel,
  type SeedanceBuiltinSource,
} from '../../config/seedance';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';

const FRAME_MODE_OPTIONS = [
  { value: 'auto', label: '多参考图' },
  { value: 'first', label: '首帧' },
  { value: 'firstlast', label: '首尾帧' },
  { value: 'multiframe', label: '智能多帧' },
];
const MIN_DURATION = DIRECTOR_STORYBOARD_MIN_DURATION_SEC;
const MAX_DURATION = DIRECTOR_STORYBOARD_MAX_DURATION_SEC;

type JobUiResult = {
  status?: DirectorStoryboardJobResult['status'] | 'submitting' | 'polling';
  kind?: DirectorStoryboardJob['kind'];
  title?: string;
  shotId?: string;
  taskId?: string | null;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'> | null;
  videoUrl?: string | null;
  error?: string | null;
  progress?: string;
};

type ResultsMap = Record<string, JobUiResult>;
type ReferenceKind = 'image' | 'video' | 'audio';
type BridgeUploadTarget = 'first-image' | 'last-image' | 'previous-video' | 'next-video';
type DirectorStoryboardRunMode =
  | 'all'
  | 'shot'
  | 'bridge-one'
  | 'bridge-all'
  | 'refresh-bridge-one'
  | 'refresh-all';

const DIRECTOR_STORYBOARD_RUN_PURPOSE: Record<DirectorStoryboardRunMode, string> = {
  all: 'storyboard-all',
  shot: 'storyboard-shot',
  'bridge-one': 'storyboard-bridge',
  'bridge-all': 'storyboard-bridges',
  'refresh-bridge-one': 'storyboard-refresh-bridge',
  'refresh-all': 'storyboard-refresh-all',
};

type DurationResizeState = {
  shotId: string;
  baseShots: DirectorStoryboardShot[];
  startClientX: number;
  startDurationSec: number;
  timelineWidthPx: number;
  totalDurationSec: number;
};

function clampDuration(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, Math.round(n)));
}

function fileName(url: string): string {
  try {
    return decodeURIComponent((url.split('?')[0].split('/').pop() || url).slice(0, 42));
  } catch {
    return (url.split('?')[0].split('/').pop() || url).slice(0, 42);
  }
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function describeShotReusableInputs(shot: DirectorStoryboardShot): string {
  const hasText = Boolean(String(shot.prompt || '').trim());
  const images = Array.isArray(shot.localRefImages) ? shot.localRefImages.length : 0;
  const videos = Array.isArray(shot.localRefVideos) ? shot.localRefVideos.length : 0;
  const audios = Array.isArray(shot.localRefAudios) ? shot.localRefAudios.length : 0;
  return `${hasText ? '有文本' : '无文本'} / ${images}图 / ${videos}视频 / ${audios}音频`;
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
}

function seekVideoTo(vid: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    const onSeek = () => {
      vid.removeEventListener('seeked', onSeek);
      vid.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      vid.removeEventListener('seeked', onSeek);
      vid.removeEventListener('error', onErr);
      reject(new Error('视频跳转失败，可能是格式不支持或跨域限制'));
    };
    vid.addEventListener('seeked', onSeek);
    vid.addEventListener('error', onErr);
    vid.currentTime = Math.max(0, Math.min(t, Math.max(0, (vid.duration || 0) - 0.001)));
  });
}

async function uploadFrameDataUrl(dataUrl: string, prefix: string): Promise<string> {
  const r = await fetch('/api/files/upload-base64', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, prefix }),
  });
  const json = await r.json();
  if (!r.ok || !json?.success) {
    throw new Error(json?.error || `抽帧上传失败 HTTP ${r.status}`);
  }
  return json.data.url as string;
}

async function extractDirectorStoryboardVideoFrame(videoUrl: string, edge: 'first' | 'last', prefix: string): Promise<string> {
  const clean = String(videoUrl || '').trim();
  if (!clean) throw new Error('没有可抽帧的视频');
  const vid = document.createElement('video');
  vid.crossOrigin = 'anonymous';
  vid.src = clean;
  vid.muted = true;
  vid.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    const onMeta = () => {
      vid.removeEventListener('loadedmetadata', onMeta);
      vid.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      vid.removeEventListener('loadedmetadata', onMeta);
      vid.removeEventListener('error', onErr);
      reject(new Error('视频加载失败，可能是格式不支持或跨域限制'));
    };
    vid.addEventListener('loadedmetadata', onMeta);
    vid.addEventListener('error', onErr);
    vid.load();
  });

  const duration = vid.duration || 0;
  if (!duration || !Number.isFinite(duration)) throw new Error('无法读取视频时长');
  const w = vid.videoWidth || 1280;
  const h = vid.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  await seekVideoTo(vid, edge === 'first' ? 0.001 : Math.max(0, duration - 0.05));
  ctx.drawImage(vid, 0, 0, w, h);
  return uploadFrameDataUrl(canvas.toDataURL('image/png'), prefix);
}

function localMaterialsForShot(shot: DirectorStoryboardShot, nodeId: string): Material[] {
  const counters: Record<ReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  return buildDirectorStoryboardReferenceOrder(shot).map((ref) => {
    const index = counters[ref.kind]++;
    if (ref.kind === 'image') {
      return {
        id: `${shot.id}:local-image:${index}:${ref.url}`,
        kind: 'image' as const,
        url: ref.url,
        sourceNodeId: nodeId,
        origin: 'local' as const,
        label: `${shot.title} 图${index + 1}`,
      };
    }
    if (ref.kind === 'video') {
      return {
        id: `${shot.id}:local-video:${index}:${ref.url}`,
        kind: 'video' as const,
        url: ref.url,
        sourceNodeId: nodeId,
        origin: 'local' as const,
        label: `${shot.title} 视频${index + 1}`,
      };
    }
    return {
      id: `${shot.id}:local-audio:${index}:${ref.url}`,
      kind: 'audio' as const,
      url: ref.url,
      sourceNodeId: nodeId,
      origin: 'local' as const,
      label: `${shot.title} 音频${index + 1}`,
    };
  });
}

function toMentionMaterials(materials: Material[]): DirectorStoryboardMentionMaterial[] {
  return materials.map((material) => ({
    kind: material.kind,
    url: material.url,
    label: material.label,
    mentionKey: materialMentionKey(material),
  }));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('用户已停止'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new Error('用户已停止'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const DirectorStoryboardNode = ({ id, data, selected }: NodeProps) => {
  const {t} = useTranslation('creativeUx');
  const [scriptImportNotice, setScriptImportNotice] = useState('');
  const rf = useReactFlow();
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';
  const d = (data as any) || {};
  const hasSeedanceNzKey = useApiKeysStore((state) => !!String(state.settings.zhenzhenSd2ApiKey || '').trim());
  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const src = `director:${id.slice(0, 6)}`;

  const shots = useMemo(
    () => sanitizeDirectorStoryboardShots(Array.isArray(d.shots) ? d.shots : []),
    [d.shots],
  );
  const bridges = useMemo(
    () => sanitizeDirectorStoryboardBridges(Array.isArray(d.bridges) ? d.bridges : [], shots),
    [d.bridges, shots],
  );
  const [activeShotId, setActiveShotId] = useState(() => shots[0]?.id || 'shot-1');
  const [activeBridgeId, setActiveBridgeId] = useState(() => bridges[0]?.id || '');
  const [inputReuseSourceShotId, setInputReuseSourceShotId] = useState('');
  const activeShot = shots.find((shot) => shot.id === activeShotId) || shots[0];
  const inputReuseCandidates = useMemo(
    () => (activeShot ? shots.filter((shot) => shot.id !== activeShot.id) : []),
    [activeShot, shots],
  );
  const inputReuseSourceShot = inputReuseCandidates.find((shot) => shot.id === inputReuseSourceShotId)
    || inputReuseCandidates[0]
    || null;
  const activeBridge = bridges.find((bridge) => bridge.id === activeBridgeId) || null;
  const bridgePromptPresets = useMemo(
    () => sanitizeDirectorBridgePromptPresets(d.directorBridgePromptPresets),
    [d.directorBridgePromptPresets],
  );
  const bridgeSelectedPresetId = typeof d.directorBridgeSelectedPresetId === 'string' ? d.directorBridgeSelectedPresetId : '';
  const bridgePresetName = typeof d.directorBridgePresetName === 'string' ? d.directorBridgePresetName : '';
  const allBridgePromptPresets = useMemo(
    () => [...DIRECTOR_BRIDGE_PROMPT_PRESETS, ...bridgePromptPresets],
    [bridgePromptPresets],
  );
  const selectedBridgePromptPreset = allBridgePromptPresets.find((preset) => preset.id === bridgeSelectedPresetId) || null;
  const results: ResultsMap = d.shotResults && typeof d.shotResults === 'object' ? d.shotResults : {};
  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' | 'cancelled' = d.status || 'idle';
  const isBridgeBusy = (bridge?: DirectorStoryboardBridge | null) => (
    bridge?.status === 'extracting' || bridge?.status === 'submitting' || bridge?.status === 'polling'
  );
  const hasBusyBridge = bridges.some((bridge) => isBridgeBusy(bridge));
  const isBusy = status === 'submitting' || status === 'polling' || hasBusyBridge;
  const videoProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'video'), [advancedProviders]);
  const externalVideoSelection = useMemo(() => resolveAdvancedProviderSelection(advancedProviders, 'video', {
    providerSource: d.providerSource,
    providerId: d.providerId,
    providerModel: d.providerModel,
  }), [advancedProviders, d.providerId, d.providerModel, d.providerSource]);
  const isExternalVideo = externalVideoSelection.available;
  const savedBuiltinSource = String(d.seedanceApiSource || '');
  const builtinSource: SeedanceBuiltinSource = isSeedanceBuiltinSource(savedBuiltinSource)
    ? savedBuiltinSource
    : 'zhenzhen-legacy';
  const effectiveTaskProvider: Exclude<SeedanceTaskProvider, 'auto'> = builtinSource === 'auto'
    ? (hasSeedanceNzKey ? 'seedance-nz' : 'zhenzhen-legacy')
    : builtinSource;
  const isSeedanceNzSelected = !isExternalVideo && effectiveTaskProvider === 'seedance-nz';
  const legacyModel = String(d.model || LEGACY_SEEDANCE_MODEL_OPTIONS[0].value);
  const seedanceNzModel = String(d.seedanceNzModel || 'fast');
  const model = isExternalVideo ? externalVideoSelection.providerModel : isSeedanceNzSelected ? seedanceNzModel : legacyModel;
  const modelOptions = isExternalVideo && externalVideoSelection.provider
    ? advancedProviderModelOptions(externalVideoSelection.provider, 'video').map((value) => ({ value, label: value }))
    : isSeedanceNzSelected ? SEEDANCE_NZ_MODEL_OPTIONS : LEGACY_SEEDANCE_MODEL_OPTIONS;
  const ratioOptions = isSeedanceNzSelected ? SEEDANCE_NZ_RATIO_OPTIONS : LEGACY_SEEDANCE_RATIO_OPTIONS;
  const resolutionOptions = isSeedanceNzSelected
    ? (isSeedanceNzStandardModel(seedanceNzModel) ? SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS : SEEDANCE_NZ_RESOLUTION_OPTIONS)
    : LEGACY_SEEDANCE_RESOLUTION_OPTIONS;
  const savedRatio = String(d.ratio || '16:9');
  const ratio = ratioOptions.includes(savedRatio as any) ? savedRatio : '16:9';
  const savedResolution = String(d.resolution || '480p');
  const resolution = resolutionOptions.includes(savedResolution as any) ? savedResolution : '720p';
  const generateAudio = d.generateAudio !== false;
  const returnLastFrame = d.returnLastFrame === true;
  const watermark = d.watermark === true;
  const webSearch = d.webSearch === true;
  const seed = typeof d.seed === 'number' ? d.seed : -1;
  const bridgePanelEnabled = d.directorBridgePanelEnabled === true;
  const providerParams = useMemo(
    () => ((d?.providerParams && typeof d.providerParams === 'object') ? d.providerParams : {}),
    [d?.providerParams],
  );
  const pollInt = Math.max(2, Math.min(60, Number(d.pollInt || 10)));
  const maxPoll = minimumProviderMediaPollCount(
    pollInt * 1000,
    Math.max(10, Math.min(3600, Number(d.maxPoll || 360))),
  );
  const latestVideoUrl = typeof d.videoUrl === 'string' ? d.videoUrl : '';
  const completedVideoUrls: string[] = Array.isArray(d.videoUrls) ? d.videoUrls : [];

  const abortRef = useRef<AbortController | null>(null);
  const bridgeAbortRefs = useRef<Map<string, AbortController>>(new Map());
  const resultsRef = useRef<ResultsMap>(results);
  const videosRef = useRef<string[]>(completedVideoUrls);
  const bridgesRef = useRef<DirectorStoryboardBridge[]>(bridges);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const durationResizeActiveRef = useRef(false);
  const durationResizeStateRef = useRef<DurationResizeState | null>(null);
  const durationResizeCleanupRef = useRef<(() => void) | null>(null);
  const bridgeSeparatorActiveRef = useRef(false);
  const uploadImageRef = useRef<HTMLInputElement | null>(null);
  const uploadVideoRef = useRef<HTMLInputElement | null>(null);
  const uploadAudioRef = useRef<HTMLInputElement | null>(null);
  const bridgeUploadRef = useRef<HTMLInputElement | null>(null);
  const bridgePresetImportRef = useRef<HTMLInputElement | null>(null);
  const bridgeUploadTargetRef = useRef<{ bridgeId: string; target: BridgeUploadTarget } | null>(null);
  const startDrag = useDragMaterialStore((state) => state.start);
  const [resourcePickerKind, setResourcePickerKind] = useState<ReferenceKind | null>(null);
  const [resourceQuery, setResourceQuery] = useState('');
  const [resourceItems, setResourceItems] = useState<api.ResourceItem[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceMessage, setResourceMessage] = useState('');
  const [refDrag, setRefDrag] = useState<{ index: number } | null>(null);
  const [bridgePresetNotice, setBridgePresetNotice] = useState('');

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    videosRef.current = completedVideoUrls;
  }, [completedVideoUrls]);

  useEffect(() => {
    bridgesRef.current = bridges;
  }, [bridges]);

  useEffect(() => {
    if (!shots.some((shot) => shot.id === activeShotId)) {
      setActiveShotId(shots[0]?.id || 'shot-1');
    }
  }, [activeShotId, shots]);

  useEffect(() => {
    if (inputReuseCandidates.length === 0) {
      if (inputReuseSourceShotId) setInputReuseSourceShotId('');
      return;
    }
    if (!inputReuseCandidates.some((shot) => shot.id === inputReuseSourceShotId)) {
      setInputReuseSourceShotId(inputReuseCandidates[0].id);
    }
  }, [inputReuseCandidates, inputReuseSourceShotId]);

  useEffect(() => {
    if (bridges.length === 0) {
      if (activeBridgeId) setActiveBridgeId('');
      return;
    }
    if (!bridges.some((bridge) => bridge.id === activeBridgeId)) {
      setActiveBridgeId(bridges[0].id);
    }
  }, [activeBridgeId, bridges]);

  useEffect(() => {
    if (!resourcePickerKind) return;
    let cancelled = false;
    const query = resourceQuery.trim();
    setResourceLoading(true);
    setResourceMessage('');

    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await api.getResourceItems({ kind: resourcePickerKind, q: query });
        if (cancelled) return;
        if (result.success) {
          setResourceItems((result.data || []).filter((item) => !!item.fileUrl));
          setResourceMessage('');
        } else {
          setResourceItems([]);
          setResourceMessage(result.error || '资源库读取失败');
        }
        setResourceLoading(false);
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resourcePickerKind, resourceQuery]);

  useEffect(() => () => {
    abortRef.current?.abort();
    bridgeAbortRefs.current.forEach((controller) => controller.abort());
    bridgeAbortRefs.current.clear();
  }, []);

  const upstream = useUpstreamMaterials(id);
  const allUpstreamMaterials = useMemo(
    () => [...upstream.texts, ...upstream.images, ...upstream.videos, ...upstream.audios],
    [upstream.texts, upstream.images, upstream.videos, upstream.audios],
  );
  const activeLocalMaterials = useMemo(
    () => (activeShot ? localMaterialsForShot(activeShot, id) : []),
    [activeShot, id],
  );
  const mentionMaterials = useMemo(
    () => [...allUpstreamMaterials, ...activeLocalMaterials],
    [allUpstreamMaterials, activeLocalMaterials],
  );
  const storyboardMentionMaterials = useMemo(() => {
    const localForAllShots = shots.flatMap((shot) => localMaterialsForShot(shot, id));
    return toMentionMaterials([...allUpstreamMaterials, ...localForAllShots]);
  }, [allUpstreamMaterials, shots, id]);
  const upstreamPrompt = useMemo(
    () => upstream.texts.map((text) => text.url).filter(Boolean).join('\n').trim(),
    [upstream.texts],
  );
  const runSettings = useMemo(() => ({
    model,
    taskProvider: isExternalVideo ? undefined : builtinSource,
    ratio,
    resolution,
    generateAudio,
    returnLastFrame,
    watermark,
    webSearch,
    seed,
    providerParams,
  }), [model, isExternalVideo, builtinSource, ratio, resolution, generateAudio, returnLastFrame, watermark, webSearch, seed, providerParams]);
  const currentShotPlan = useMemo(
    () => buildDirectorStoryboardRunPlan(shots, runSettings, {
      upstreamPrompt,
      mentionMaterials: storyboardMentionMaterials,
    }),
    [shots, runSettings, upstreamPrompt, storyboardMentionMaterials],
  );
  const currentBridgePlan = useMemo(
    () => buildDirectorStoryboardBridgeRunPlan(bridges, shots, runSettings),
    [bridges, shots, runSettings],
  );
  const currentOutputPlan = useMemo(
    () => [...currentShotPlan, ...currentBridgePlan].sort((a, b) => a.order - b.order),
    [currentShotPlan, currentBridgePlan],
  );

  const inputStyle: React.CSSProperties = {
    background: 'var(--t8-bg-panel, rgba(15,23,42,.72))',
    color: 'var(--t8-text-main, #f8fafc)',
    borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))',
  };
  const mutedStyle: React.CSSProperties = {
    color: 'var(--t8-text-muted, rgba(248,250,252,.62))',
  };

  const writeShots = (nextShots: DirectorStoryboardShot[]) => {
    update({ shots: nextShots });
  };

  const writeBridges = (nextBridges: DirectorStoryboardBridge[]) => {
    bridgesRef.current = nextBridges;
    update({ bridges: nextBridges });
  };

  const patchBridge = (bridgeId: string, patch: Partial<DirectorStoryboardBridge>) => {
    const next = bridgesRef.current.map((bridge) => (
      bridge.id === bridgeId ? { ...bridge, ...patch } : bridge
    ));
    writeBridges(next);
    return next.find((bridge) => bridge.id === bridgeId) || null;
  };

  const patchShot = (shotId: string, patch: Partial<DirectorStoryboardShot>) => {
    writeShots(shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)));
  };

  const applyInputReuseToActiveShot = () => {
    if (!activeShot || !inputReuseSourceShot) return;
    patchShot(activeShot.id, buildDirectorStoryboardShotInputPatch(inputReuseSourceShot));
    logBus.info(`已将 ${inputReuseSourceShot.title} 的输入应用到 ${activeShot.title}`, src);
  };

  const importUpstreamScripts = () => {
    if (isBusy || !upstream.texts.length) return;
    const plan = importDirectorUpstreamScripts(shots, upstream.texts, upstream.images);
    if (plan.invalidDurations.length) {
      setScriptImportNotice(t('directorImport.invalidDuration', {items:plan.invalidDurations.map(item=>`${item.title}: ${item.duration}s`).join('；'),min:MIN_DURATION,max:MAX_DURATION}));
      return;
    }
    if (plan.added.length) {
      writeShots(plan.shots);
      setActiveShotId(plan.added[0].id);
    }
    setScriptImportNotice(t('directorImport.result',{count:plan.added.length,images:plan.added.reduce((count,shot)=>count+shot.localRefImages.length,0)})
      +(plan.issues.length ? ` ${t('directorImport.review',{items:plan.issues.join('、')})}` : ''));
  };

  const assignShotImages = () => {
    if (isBusy) return;
    const assigned = shots.map(shot=>assignDirectorShotImages(shot,upstream.images));
    writeShots(assigned.map(result=>result.shot));
    const issues=[...new Set(assigned.flatMap(result=>result.issues))];
    setScriptImportNotice(t('directorImport.assigned',{count:assigned.reduce((count,result)=>count+result.shot.localRefImages.length,0)})
      +(issues.length ? ` ${t('directorImport.review',{items:issues.join('、')})}` : ''));
  };

  const addShot = () => {
    const nextIndex = shots.length + 1;
    const newShot: DirectorStoryboardShot = {
      id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: `S${nextIndex}`,
      durationSec: 5,
      prompt: '',
      frameMode: 'auto',
      localRefImages: [],
      localRefVideos: [],
      localRefAudios: [],
      localRefOrder: [],
      promptMentions: [],
    };
    writeShots([...shots, newShot]);
    setActiveShotId(newShot.id);
  };

  const duplicateShot = () => {
    if (!activeShot) return;
    const index = shots.findIndex((shot) => shot.id === activeShot.id);
    const copy: DirectorStoryboardShot = {
      ...activeShot,
      id: `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: `${activeShot.title} copy`,
      taskId: null,
      videoUrl: null,
      error: null,
      status: undefined,
    };
    const next = shots.slice();
    next.splice(index + 1, 0, copy);
    writeShots(next);
    setActiveShotId(copy.id);
  };

  const removeShot = (shotId: string) => {
    if (shots.length <= 1) return;
    const next = shots.filter((shot) => shot.id !== shotId);
    writeShots(next);
    if (shotId === activeShotId) setActiveShotId(next[0]?.id || '');
  };

  const moveShot = (shotId: string, dir: -1 | 1) => {
    const index = shots.findIndex((shot) => shot.id === shotId);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= shots.length) return;
    const next = shots.slice();
    [next[index], next[target]] = [next[target], next[index]];
    writeShots(next);
  };

  const appendRefs = (kind: 'image' | 'video' | 'audio', urls: string[]) => {
    if (!activeShot || urls.length === 0) return;
    const field = kind === 'image' ? 'localRefImages' : kind === 'video' ? 'localRefVideos' : 'localRefAudios';
    const draft = {
      ...activeShot,
      [field]: dedupe([...(activeShot as any)[field], ...urls]),
    } as DirectorStoryboardShot;
    patchShot(activeShot.id, { [field]: (draft as any)[field], localRefOrder: buildDirectorStoryboardReferenceOrder(draft) } as any);
  };

  const removeRef = (kind: 'image' | 'video' | 'audio', url: string) => {
    if (!activeShot) return;
    const field = kind === 'image' ? 'localRefImages' : kind === 'video' ? 'localRefVideos' : 'localRefAudios';
    const draft = {
      ...activeShot,
      [field]: ((activeShot as any)[field] || []).filter((item: string) => item !== url),
    } as DirectorStoryboardShot;
    patchShot(activeShot.id, { [field]: (draft as any)[field], localRefOrder: buildDirectorStoryboardReferenceOrder(draft) } as any);
  };

  const reorderRef = (fromIndex: number, toIndex: number) => {
    if (!activeShot || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = reorderDirectorStoryboardReference(activeShot, fromIndex, toIndex);
    patchShot(activeShot.id, {
      localRefImages: next.localRefImages,
      localRefVideos: next.localRefVideos,
      localRefAudios: next.localRefAudios,
      localRefOrder: next.localRefOrder,
    });
  };

  const startReferenceReorder = (event: ReactPointerEvent<HTMLDivElement>, fromIndex: number) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button,input,textarea,select,a')) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let didMove = false;
    setRefDrag({ index: fromIndex });

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      setRefDrag(null);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 4) didMove = true;
      if (didMove) {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
      }
    };
    const onUp = (upEvent: PointerEvent) => {
      upEvent.stopPropagation();
      const dropTarget = document
        .elementFromPoint(upEvent.clientX, upEvent.clientY)
        ?.closest('[data-director-ref-index]') as HTMLElement | null;
      const rawIndex = dropTarget?.getAttribute('data-director-ref-index');
      const toIndex = rawIndex != null ? Number(rawIndex) : -1;
      cleanup();
      if (didMove && Number.isInteger(toIndex) && toIndex >= 0) reorderRef(fromIndex, toIndex);
    };
    const onCancel = () => cleanup();
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  };

  const handleUpload = async (kind: 'image' | 'video' | 'audio', event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    try {
      logBus.info(`上传${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}参考 ${files.length} 个`, src);
      const uploaded = await Promise.all(files.map((file) => uploadFile(file)));
      appendRefs(kind, uploaded.map((item) => item.url));
    } catch (error: any) {
      const message = error?.message || '上传失败';
      logBus.error(`分镜参考素材上传失败: ${message}`, src);
      update({ error: message });
    }
  };

  const getShotVideoUrl = (shotId: string): string => {
    const result = resultsRef.current[`shot-${shotId}`];
    const fromResult = typeof result?.videoUrl === 'string' ? result.videoUrl.trim() : '';
    if (fromResult) return fromResult;
    const shot = shots.find((item) => item.id === shotId);
    return typeof shot?.videoUrl === 'string' ? shot.videoUrl.trim() : '';
  };

  const prepareBridgeFrames = async (
    bridge: DirectorStoryboardBridge,
    options: { previousVideoUrl?: string; nextVideoUrl?: string; sourceMode?: DirectorStoryboardBridge['sourceMode'] } = {},
  ): Promise<DirectorStoryboardBridge> => {
    const previousVideoUrl = options.previousVideoUrl || bridge.previousVideoUrl || getShotVideoUrl(bridge.fromShotId);
    const nextVideoUrl = options.nextVideoUrl || bridge.nextVideoUrl || getShotVideoUrl(bridge.toShotId);
    if (!previousVideoUrl || !nextVideoUrl) {
      const message = '请先生成前后两个镜头视频，或手动上传前段/后段视频后再生成桥接。';
      patchBridge(bridge.id, { status: 'error', error: message });
      logBus.warn(`桥接 ${bridge.fromShotId} → ${bridge.toShotId} 缺少视频：${message}`, src);
      throw new Error(message);
    }

    patchBridge(bridge.id, {
      status: 'extracting',
      error: null,
      previousVideoUrl,
      nextVideoUrl,
      sourceMode: options.sourceMode || bridge.sourceMode || 'auto-video',
    });
    logBus.info(`桥接 ${bridge.fromShotId} → ${bridge.toShotId} 开始抽取前段尾帧和后段首帧`, src);
    const [firstFrameUrl, lastFrameUrl] = await Promise.all([
      extractDirectorStoryboardVideoFrame(previousVideoUrl, 'last', 'director-bridge-first'),
      extractDirectorStoryboardVideoFrame(nextVideoUrl, 'first', 'director-bridge-last'),
    ]);
    const next = patchBridge(bridge.id, {
      status: 'ready',
      error: null,
      firstFrameUrl,
      lastFrameUrl,
      previousVideoUrl,
      nextVideoUrl,
      sourceMode: options.sourceMode || 'auto-video',
    });
    logBus.success(`桥接 ${bridge.fromShotId} → ${bridge.toShotId} 首尾帧已就绪`, src);
    return next || { ...bridge, firstFrameUrl, lastFrameUrl, previousVideoUrl, nextVideoUrl, status: 'ready' };
  };

  const openBridgeUpload = (bridgeId: string, target: BridgeUploadTarget) => {
    bridgeUploadTargetRef.current = { bridgeId, target };
    if (bridgeUploadRef.current) {
      bridgeUploadRef.current.accept = target.includes('video') ? 'video/*' : 'image/*';
      bridgeUploadRef.current.click();
    }
  };

  const handleBridgeUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const target = bridgeUploadTargetRef.current;
    const file = event.target.files?.[0];
    event.target.value = '';
    bridgeUploadTargetRef.current = null;
    if (!target || !file) return;
    const bridge = bridgesRef.current.find((item) => item.id === target.bridgeId);
    if (!bridge) return;

    try {
      const uploaded = await uploadFile(file);
      const url = uploaded.url;
      if (target.target === 'first-image' || target.target === 'last-image') {
        const patch = target.target === 'first-image'
          ? { firstFrameUrl: url, sourceMode: 'manual-image' as const }
          : { lastFrameUrl: url, sourceMode: 'manual-image' as const };
        const next = patchBridge(bridge.id, {
          ...patch,
          status: (target.target === 'first-image' ? url && bridge.lastFrameUrl : bridge.firstFrameUrl && url) ? 'ready' : 'idle',
          error: null,
        });
        if (next?.firstFrameUrl && next?.lastFrameUrl) {
          logBus.success(`桥接 ${next.fromShotId} → ${next.toShotId} 手动首尾帧已就绪`, src);
        }
        return;
      }

      patchBridge(bridge.id, { status: 'extracting', error: null });
      const frameUrl = await extractDirectorStoryboardVideoFrame(
        url,
        target.target === 'previous-video' ? 'last' : 'first',
        target.target === 'previous-video' ? 'director-bridge-first' : 'director-bridge-last',
      );
      const current = bridgesRef.current.find((item) => item.id === bridge.id) || bridge;
      const patch = target.target === 'previous-video'
        ? { previousVideoUrl: url, firstFrameUrl: frameUrl }
        : { nextVideoUrl: url, lastFrameUrl: frameUrl };
      patchBridge(bridge.id, {
        ...patch,
        sourceMode: 'manual-video',
        status: (target.target === 'previous-video' ? frameUrl && current.lastFrameUrl : current.firstFrameUrl && frameUrl) ? 'ready' : 'idle',
        error: null,
      });
      logBus.success(`桥接 ${bridge.fromShotId} → ${bridge.toShotId} 已从手动视频抽帧`, src);
    } catch (error: any) {
      const message = error?.message || '桥接素材处理失败';
      patchBridge(bridge.id, { status: 'error', error: message });
      logBus.error(`桥接素材处理失败: ${message}`, src);
    }
  };

  const selectBridgePromptPreset = (presetId: string) => {
    const preset = allBridgePromptPresets.find((item) => item.id === presetId);
    update({
      directorBridgeSelectedPresetId: preset?.id || '',
      directorBridgePresetName: preset?.name || bridgePresetName,
    });
    setBridgePresetNotice('');
  };

  const applyBridgePromptPreset = () => {
    if (!activeBridge || !selectedBridgePromptPreset) return;
    patchBridge(activeBridge.id, { prompt: selectedBridgePromptPreset.text });
    update({ directorBridgePresetName: selectedBridgePromptPreset.name });
    setBridgePresetNotice(`已套用：${selectedBridgePromptPreset.name}`);
  };

  const saveBridgePromptPreset = () => {
    const text = String(activeBridge?.prompt || selectedBridgePromptPreset?.text || '').trim();
    if (!text) {
      setBridgePresetNotice('先填写桥接提示词');
      return;
    }
    const now = new Date().toISOString();
    const existing = bridgePromptPresets.find((item) => item.id === bridgeSelectedPresetId);
    const fallbackName = selectedBridgePromptPreset?.name || text.replace(/\s+/g, ' ').slice(0, 18) || `桥接预设 ${bridgePromptPresets.length + 1}`;
    const name = bridgePresetName.trim() || existing?.name || fallbackName;
    const next: DirectorBridgePromptPreset[] = existing
      ? bridgePromptPresets.map((item) => item.id === existing.id ? { ...item, name, text, updatedAt: now } : item)
      : [
          ...bridgePromptPresets,
          {
            id: `director-bridge-preset-${Date.now().toString(36)}`,
            name,
            text,
            category: '自定义',
            createdAt: now,
            updatedAt: now,
          },
        ];
    const sanitized = sanitizeDirectorBridgePromptPresets(next);
    const saved = existing
      ? sanitized.find((item) => item.id === existing.id)
      : sanitized[sanitized.length - 1];
    update({
      directorBridgePromptPresets: sanitized,
      directorBridgeSelectedPresetId: saved?.id || '',
      directorBridgePresetName: saved?.name || name,
    });
    setBridgePresetNotice(existing ? '已更新自定义预设' : '已保存自定义预设');
  };

  const exportBridgePromptPresets = () => {
    const fallbackText = String(activeBridge?.prompt || selectedBridgePromptPreset?.text || '').trim();
    const exportPresets = bridgePromptPresets.length
      ? bridgePromptPresets
      : sanitizeDirectorBridgePromptPresets([
          {
            id: 'current-bridge-prompt',
            name: bridgePresetName.trim() || selectedBridgePromptPreset?.name || '当前桥接提示词',
            text: fallbackText,
            category: '自定义',
          },
        ]);
    if (!exportPresets.length) {
      setBridgePresetNotice('没有可导出的自定义预设');
      return;
    }
    downloadJson(
      `director-bridge-prompts-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`,
      createDirectorBridgePromptPresetExport(exportPresets),
    );
    setBridgePresetNotice(`已导出 ${exportPresets.length} 条预设`);
  };

  const importBridgePromptPresets = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = parseDirectorBridgePromptPresetImport(await file.text());
      const next = sanitizeDirectorBridgePromptPresets([...bridgePromptPresets, ...imported]);
      const firstImported = next[bridgePromptPresets.length] || next[next.length - 1];
      update({
        directorBridgePromptPresets: next,
        directorBridgeSelectedPresetId: firstImported?.id || '',
        directorBridgePresetName: firstImported?.name || bridgePresetName,
      });
      setBridgePresetNotice(`已导入 ${imported.length} 条预设`);
    } catch (error: any) {
      setBridgePresetNotice(error?.message || '导入预设失败');
    }
  };

  const handleDrop = (payload: MaterialPayload) => {
    if (!activeShot) return;
    if (payload.kind === 'image' && payload.url) appendRefs('image', [payload.url]);
    if (payload.kind === 'video' && payload.url) appendRefs('video', [payload.url]);
    if (payload.kind === 'audio' && payload.url) appendRefs('audio', [payload.url]);
    if (payload.kind === 'text' && payload.text) {
      const nextPrompt = activeShot.prompt ? `${activeShot.prompt}\n${payload.text}` : payload.text;
      patchShot(activeShot.id, { prompt: nextPrompt, promptMentions: [] });
    }
  };

  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'video', 'audio', 'text'],
    onDrop: handleDrop,
  });

  const openResourcePicker = (kind: ReferenceKind) => {
    setResourcePickerKind(kind);
    setResourceQuery('');
    setResourceMessage('');
  };

  const closeResourcePicker = () => {
    setResourcePickerKind(null);
    setResourceQuery('');
    setResourceMessage('');
  };

  const handlePickResourceItem = async (item: api.ResourceItem) => {
    if (!resourcePickerKind || !item.fileUrl) return;
    appendRefs(resourcePickerKind, [item.fileUrl]);
    setResourceMessage(`已加入：${item.title || fileName(item.fileUrl)}`);
    void api.updateResourceItem(item.id, { touch: true });
  };

  const beginMaterialDrag = (event: React.MouseEvent, payload: MaterialPayload) => {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    startDrag(payload, event.clientX, event.clientY);
  };

  const applyDurationResize = (clientX: number) => {
    const state = durationResizeStateRef.current;
    if (!state) return false;
    const durationSec = calculateDirectorTimelineDragDuration({
      startDurationSec: state.startDurationSec,
      startClientX: state.startClientX,
      currentClientX: clientX,
      timelineWidthPx: state.timelineWidthPx,
      totalDurationSec: state.totalDurationSec,
    });
    writeShots(state.baseShots.map((item) => (item.id === state.shotId ? { ...item, durationSec } : item)));
    return true;
  };

  const finishDurationResize = () => {
    durationResizeActiveRef.current = false;
    durationResizeStateRef.current = null;
    const cleanup = durationResizeCleanupRef.current;
    durationResizeCleanupRef.current = null;
    cleanup?.();
  };

  const startDurationResizeSession = (shot: DirectorStoryboardShot, startClientX: number, cleanup: () => void) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || durationResizeActiveRef.current) return false;
    durationResizeCleanupRef.current?.();
    durationResizeActiveRef.current = true;
    durationResizeStateRef.current = {
      shotId: shot.id,
      baseShots: shots,
      startClientX,
      startDurationSec: shot.durationSec,
      timelineWidthPx: rect.width,
      totalDurationSec: Math.max(MIN_DURATION, shots.reduce((sum, item) => sum + item.durationSec, 0)),
    };
    durationResizeCleanupRef.current = cleanup;
    return true;
  };

  const beginDurationResize = (
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
    shot: DirectorStoryboardShot,
  ) => {
    if ('button' in event && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const onMove = (nativeEvent: globalThis.PointerEvent | globalThis.MouseEvent) => {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      applyDurationResize(nativeEvent.clientX);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', cleanup, true);
      window.removeEventListener('pointercancel', cleanup, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', cleanup, true);
      durationResizeCleanupRef.current = null;
      durationResizeActiveRef.current = false;
      durationResizeStateRef.current = null;
    };
    if (!startDurationResizeSession(shot, event.clientX, cleanup)) return;
    if ('pointerId' in event) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners and element move handlers below are the real drag channels; pointer capture is best effort.
      }
    }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', cleanup, true);
    window.addEventListener('pointercancel', cleanup, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', cleanup, true);
  };

  const beginBridgeSeparatorInteraction = (
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
    shot: DirectorStoryboardShot,
    bridgeId: string,
  ) => {
    if ('button' in event && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (bridgeSeparatorActiveRef.current) return;
    bridgeSeparatorActiveRef.current = true;

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    let didResize = false;

    function cleanup() {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      bridgeSeparatorActiveRef.current = false;
    }

    function onMove(nativeEvent: globalThis.PointerEvent | globalThis.MouseEvent) {
      const moved = Math.abs(nativeEvent.clientX - startClientX) + Math.abs(nativeEvent.clientY - startClientY);
      if (!didResize && moved < 4) return;
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      if (!didResize) {
        didResize = startDurationResizeSession(shot, startClientX, cleanup);
        if (!didResize) return;
      }
      applyDurationResize(nativeEvent.clientX);
    }

    function onUp(nativeEvent: globalThis.PointerEvent | globalThis.MouseEvent) {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      if (didResize) {
        finishDurationResize();
        return;
      }
      cleanup();
      setActiveBridgeId(bridgeId);
    }

    function onCancel() {
      if (didResize) {
        finishDurationResize();
        return;
      }
      cleanup();
    }

    if ('pointerId' in event) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The global listeners keep the separator draggable even when pointer capture is unavailable.
      }
    }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  };

  const moveDurationResize = (event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>) => {
    if (!durationResizeStateRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    applyDurationResize(event.clientX);
  };

  const endDurationResize = (event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>) => {
    if (!durationResizeStateRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if ('pointerId' in event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
    finishDurationResize();
  };

  const setJobPatch = (job: DirectorStoryboardJob, patch: JobUiResult) => {
    const next = {
      ...resultsRef.current,
      [job.id]: {
        ...(resultsRef.current[job.id] || {}),
        kind: job.kind,
        title: job.title,
        shotId: job.shotId,
        ...patch,
      },
    };
    resultsRef.current = next;
    update({ shotResults: next });
    if (job.kind === 'bridge') {
      const bridgeIdFromJob = job.id.replace(/^bridge-/, '');
      const bridgePatch: Partial<DirectorStoryboardBridge> = {};
      if (patch.status === 'submitting' || patch.status === 'polling' || patch.status === 'success' || patch.status === 'error' || patch.status === 'cancelled') {
        bridgePatch.status = patch.status;
      }
      if (patch.taskId !== undefined) bridgePatch.taskId = patch.taskId;
      if (patch.taskProvider !== undefined) bridgePatch.taskProvider = patch.taskProvider;
      if (patch.videoUrl !== undefined) bridgePatch.videoUrl = patch.videoUrl;
      if (patch.error !== undefined) bridgePatch.error = patch.error;
      if (Object.keys(bridgePatch).length > 0) patchBridge(bridgeIdFromJob, bridgePatch);
    }
  };

  const applyStoryboardOutputs = (plan: DirectorStoryboardJob[], patch: Record<string, any> = {}) => {
    const items = buildDirectorStoryboardOutputItems(plan, resultsRef.current);
    const videoUrls = items.map((item) => item.videoUrl);
    const textSegments = items.map((item) => item.text);
    videosRef.current = videoUrls;
    update({
      videoUrl: videoUrls[videoUrls.length - 1] || '',
      videoUrls,
      textSegments,
      directorOutputItems: items,
      outputText: buildDirectorStoryboardOutputSummary(items),
      shotResults: resultsRef.current,
      ...patch,
    });
    return items;
  };

  const syncBridgeResultFromState = (bridge: DirectorStoryboardBridge, job: DirectorStoryboardJob): boolean => {
    const existing = resultsRef.current[job.id] || {};
    const taskId = existing.taskId || bridge.taskId || null;
    const videoUrl = existing.videoUrl || bridge.videoUrl || null;
    if (!taskId && !videoUrl) return false;
    setJobPatch(job, {
      status: videoUrl ? 'success' : (existing.status === 'error' ? 'error' : 'polling'),
      taskId,
      taskProvider: existing.taskProvider || bridge.taskProvider || null,
      videoUrl,
      error: videoUrl ? null : (existing.error || bridge.error || null),
      progress: videoUrl ? '100%' : (existing.progress || '待查询'),
    });
    return true;
  };

  const refreshStoryboardOutputs = async (
    options: { bridgeId?: string } = {},
    reporter?: RunNodeLifecycleReporter,
  ) => {
    const targetBridgeId = options.bridgeId;
    const targetJobId = targetBridgeId ? `bridge-${targetBridgeId}` : '';
    const jobsToRefresh = targetBridgeId
      ? currentOutputPlan.filter((job) => job.id === targetJobId)
      : currentOutputPlan;
    if (targetBridgeId) {
      const bridge = bridgesRef.current.find((item) => item.id === targetBridgeId);
      const job = jobsToRefresh[0];
      if (!bridge || !job) {
        const message = '这个桥接还没有可重新获取的输出记录，请先生成一次桥接。';
        if (bridge) patchBridge(bridge.id, { error: message });
        update({ error: message });
        logBus.warn(`导演分镜台桥接重新获取失败：${message}`, src);
        throw new Error(message);
      }
      if (!syncBridgeResultFromState(bridge, job)) {
        const message = '这个桥接还没有 taskId 或视频记录，无法重新获取；请先生成桥接。';
        patchBridge(bridge.id, { error: message });
        update({ error: message });
        logBus.warn(`导演分镜台桥接重新获取失败：${message}`, src);
        throw new Error(message);
      }
    } else {
      for (const bridge of bridgesRef.current) {
        const job = currentOutputPlan.find((item) => item.id === `bridge-${bridge.id}`);
        if (job) syncBridgeResultFromState(bridge, job);
      }
    }

    const refreshable = jobsToRefresh
      .map((job) => [job, resultsRef.current[job.id]] as const)
      .filter(([, result]) => result?.taskId || result?.videoUrl);
    if (refreshable.length === 0) {
      const message = targetBridgeId
        ? '这个桥接还没有可重新获取的任务或视频记录。'
        : '当前没有可重新获取的任务或视频记录，请先生成分镜或桥接。';
      update({ status: 'error', error: message });
      logBus.warn(`导演分镜台重新获取失败：${message}`, src);
      throw new Error(message);
    }

    const recoverable = refreshable
      .filter(([, result]) => result?.taskId && !result.videoUrl);
    const refreshErrors: string[] = [];
    if (recoverable.length > 0) {
      logBus.info(`导演分镜台重新获取：补查 ${recoverable.length} 个已提交任务`, src);
      await Promise.all(recoverable.map(async ([job, result]) => {
        if (!result?.taskId) return;
        const taskProvider = result.taskProvider || effectiveTaskProvider;
        const baseTrace = {
          provider: taskProvider,
          model: job.payload.model,
          upstreamTaskId: result.taskId,
          jobId: job.id,
          jobKind: job.kind,
          operation: 'refresh-query',
          httpStatusSource: 'local-backend',
        };
        await reporter?.providerRequest(baseTrace);
        try {
          const query = await querySeedance(result.taskId, taskProvider);
          const responseTrace = {
            ...baseTrace,
            provider: query.taskProvider || taskProvider,
            model: query.model || job.payload.model,
            requestId: query.requestId,
            transportHttpStatus: query.transportHttpStatus,
            upstreamHttpStatus: query.upstreamHttpStatus,
            usage: query.usage,
            status: query.status,
          };
          await reporter?.providerPolling({
            ...responseTrace,
            taskId: result.taskId,
            progress: query.progress,
            pollCount: 1,
          });
          if (query.status === 'succeeded' && query.videoUrl) {
            setJobPatch(job, {
              status: 'success',
              taskId: result.taskId,
              taskProvider: query.taskProvider || result.taskProvider || null,
              videoUrl: query.videoUrl,
              error: null,
              progress: '100%',
            });
            if (job.kind === 'bridge') {
              const bridgeIdFromJob = job.id.replace(/^bridge-/, '');
              patchBridge(bridgeIdFromJob, {
                status: 'success',
                videoUrl: query.videoUrl,
                error: null,
                taskId: result.taskId,
                taskProvider: query.taskProvider || result.taskProvider || null,
              });
            } else {
              patchShot(job.shotId, {
                status: 'success',
                videoUrl: query.videoUrl,
                error: null,
                taskId: result.taskId,
                taskProvider: query.taskProvider || result.taskProvider || null,
              });
            }
            await reporter?.providerResponse({ ...responseTrace, status: 'succeeded' });
          } else if (query.status === 'failed') {
            const message = query.failReason || '任务失败';
            setJobPatch(job, {
              status: 'error',
              taskId: result.taskId,
              taskProvider: result.taskProvider || null,
              error: message,
              progress: '失败',
            });
            if (job.kind === 'bridge') {
              patchBridge(job.id.replace(/^bridge-/, ''), {
                status: 'error',
                error: message,
                taskId: result.taskId,
                taskProvider: result.taskProvider || null,
              });
            } else {
              patchShot(job.shotId, {
                status: 'error',
                error: message,
                taskId: result.taskId,
                taskProvider: result.taskProvider || null,
              });
            }
            refreshErrors.push(`${job.title}: ${message}`);
            await reporter?.providerResponse({
              ...responseTrace,
              status: 'failed',
              error: { message },
            });
          } else if (query.status === 'succeeded') {
            const message = '任务已完成但未返回视频地址';
            setJobPatch(job, {
              status: 'error',
              taskId: result.taskId,
              taskProvider: query.taskProvider || result.taskProvider || null,
              error: message,
              progress: '失败',
            });
            if (job.kind === 'bridge') {
              patchBridge(job.id.replace(/^bridge-/, ''), {
                status: 'error',
                error: message,
                taskId: result.taskId,
                taskProvider: query.taskProvider || result.taskProvider || null,
              });
            } else {
              patchShot(job.shotId, {
                status: 'error',
                error: message,
                taskId: result.taskId,
                taskProvider: query.taskProvider || result.taskProvider || null,
              });
            }
            refreshErrors.push(`${job.title}: ${message}`);
            await reporter?.providerResponse({
              ...responseTrace,
              status: 'failed',
              error: { message },
            });
          } else {
            const isMaterializing = String(query.status || '').toLowerCase() === 'materializing';
            setJobPatch(job, {
              status: 'polling',
              taskId: result.taskId,
              taskProvider: query.taskProvider || result.taskProvider || null,
              error: null,
              progress: isMaterializing ? '100% · 正在下载' : query.progress || '处理中',
            });
            if (job.kind === 'bridge') {
              patchBridge(job.id.replace(/^bridge-/, ''), {
                status: 'polling',
                error: null,
                taskId: result.taskId,
                taskProvider: query.taskProvider || result.taskProvider || null,
              });
            } else {
              patchShot(job.shotId, {
                status: 'polling',
                error: null,
                taskId: result.taskId,
                taskProvider: query.taskProvider || result.taskProvider || null,
              });
            }
            if (isMaterializing) {
              logBus.warn(
                query.error || `${job.title} 已经生成，正在适配 TUN/代理网络并安全下载；不会重复提交任务`,
                src,
              );
            }
            await reporter?.providerResponse(responseTrace);
          }
        } catch (error: any) {
          const message = error?.message || '重新获取失败';
          setJobPatch(job, {
            status: 'error',
            taskId: result.taskId,
            taskProvider: result.taskProvider || null,
            error: message,
            progress: '失败',
          });
          if (job.kind === 'bridge') {
            patchBridge(job.id.replace(/^bridge-/, ''), {
              status: 'error',
              error: message,
              taskId: result.taskId,
              taskProvider: result.taskProvider || null,
            });
          } else {
            patchShot(job.shotId, {
              status: 'error',
              error: message,
              taskId: result.taskId,
              taskProvider: result.taskProvider || null,
            });
          }
          refreshErrors.push(`${job.title}: ${message}`);
          await reporter?.providerResponse({
            ...baseTrace,
            requestId: error?.requestId,
            transportHttpStatus: error?.transportHttpStatus,
            upstreamHttpStatus: error?.upstreamHttpStatus,
            status: 'failed',
            error: { message, code: error?.code },
          });
        }
      }));
    }
    const items = applyStoryboardOutputs(currentOutputPlan, {
      directorOutputRefreshNonce: Date.now(),
      status: refreshErrors.length > 0 ? 'error' : 'success',
      error: refreshErrors.length > 0 ? `${refreshErrors.length} 个任务重新获取失败` : null,
    });
    await reporter?.output({
      status: refreshErrors.length > 0 ? 'failed' : 'succeeded',
      outputCount: items.length,
      assets: items.map((item) => ({ kind: 'video', sourceUrl: item.videoUrl })),
    });
    if (refreshErrors.length > 0) {
      const message = refreshErrors.join('；');
      logBus.error(`导演分镜台重新获取失败：${message}`, src);
      throw new Error(message);
    }
    logBus.info(`导演分镜台重新获取：已整理 ${items.length} 个视频输出`, src);
  };

  const pollJob = async (
    job: DirectorStoryboardJob,
    signal?: AbortSignal,
    reporter?: RunNodeLifecycleReporter,
  ): Promise<string> => {
    if (!String(job.payload.prompt || '').trim()) {
      throw new Error('这个分镜没有提示词');
    }
    if (signal?.aborted) throw new Error('用户已停止');
    logBus.info(
      `提交${job.kind === 'bridge' ? '桥接' : '分镜'} ${job.title}: ${job.payload.duration || 5}s ${job.payload.ratio || ratio} ${job.payload.resolution || resolution}`,
      src,
    );
    const runtimeProvider = isExternalVideo ? externalVideoSelection.providerSource : effectiveTaskProvider;
    await reporter?.providerRequest({
      provider: runtimeProvider,
      model: job.payload.model,
      jobId: job.id,
      jobKind: job.kind,
    });
    setJobPatch(job, { status: 'submitting', error: null, progress: '提交中' });
    if (isExternalVideo) {
      try {
        const result = await generateExternalVideo({
          providerId: externalVideoSelection.providerId,
          providerModel: externalVideoSelection.providerModel,
          model: externalVideoSelection.providerModel,
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
        }, { submissionKey: reporter?.providerSubmissionKey });
        const videoUrl = String(result.videoUrls?.[0] || '');
        if (!videoUrl) throw new Error(`${job.title} 未返回视频`);
        if (result.taskId || result.requestId) await reporter?.providerSubmitted({
          provider: runtimeProvider,
          model: externalVideoSelection.providerModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        await reporter?.providerResponse({
          provider: runtimeProvider,
          model: externalVideoSelection.providerModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          status: 'succeeded',
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        return videoUrl;
      } catch (error: any) {
        await reporter?.providerResponse({
          provider: runtimeProvider,
          model: externalVideoSelection.providerModel,
          requestId: error?.requestId,
          transportHttpStatus: error?.transportHttpStatus,
          upstreamHttpStatus: error?.upstreamHttpStatus,
          status: 'failed',
          error: { message: error?.message || '提交失败', code: error?.code },
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        throw error;
      }
    }
    let submitted: Awaited<ReturnType<typeof submitSeedance>>;
    try {
      submitted = await submitSeedance(job.payload, {
        submissionKey: reporter?.providerSubmissionKey,
      });
    } catch (error: any) {
      await reporter?.providerResponse({
        provider: effectiveTaskProvider,
        model: job.payload.model,
        requestId: error?.requestId,
        transportHttpStatus: error?.transportHttpStatus,
        upstreamHttpStatus: error?.upstreamHttpStatus,
        status: 'failed',
        error: { message: error?.message || '提交失败', code: error?.code },
        jobId: job.id,
        jobKind: job.kind,
        httpStatusSource: 'local-backend',
      });
      throw error;
    }
    const submittedProvider = submitted.taskProvider || effectiveTaskProvider;
    await reporter?.providerSubmitted({
      provider: submittedProvider,
      model: submitted.model || job.payload.model,
      upstreamTaskId: submitted.taskId,
      requestId: submitted.requestId,
      transportHttpStatus: submitted.transportHttpStatus,
      upstreamHttpStatus: submitted.upstreamHttpStatus,
      usage: submitted.usage,
      jobId: job.id,
      jobKind: job.kind,
      httpStatusSource: 'local-backend',
    });
    setJobPatch(job, {
      status: 'polling',
      taskId: submitted.taskId,
      taskProvider: submittedProvider,
      progress: '15%',
    });
    if (job.kind === 'bridge') {
      patchBridge(job.id.replace(/^bridge-/, ''), {
        status: 'polling',
        taskId: submitted.taskId,
        taskProvider: submittedProvider,
        error: null,
      });
    } else {
      patchShot(job.shotId, {
        status: 'polling',
        taskId: submitted.taskId,
        taskProvider: submittedProvider,
        error: null,
      });
    }
    logBus.info(`${job.title} taskId=${submitted.taskId} 已提交，进入轮询`, src);

    for (let elapsed = 1; elapsed <= maxPoll; elapsed += 1) {
      try {
        await sleep(pollInt * 1000, signal);
      } catch (error: any) {
        const message = error?.message || (signal?.aborted ? '用户已停止' : '等待轮询失败');
        await reporter?.providerResponse({
          provider: submittedProvider,
          model: submitted.model || job.payload.model,
          upstreamTaskId: submitted.taskId,
          requestId: submitted.requestId,
          pollCount: Math.max(0, elapsed - 1),
          status: signal?.aborted ? 'cancelled' : 'failed',
          error: { message, code: error?.code },
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        throw error;
      }
      let result;
      try {
        result = await querySeedance(submitted.taskId, submittedProvider);
      } catch (error: any) {
        await reporter?.providerResponse({
          provider: submittedProvider,
          model: submitted.model || job.payload.model,
          upstreamTaskId: submitted.taskId,
          requestId: error?.requestId || submitted.requestId,
          transportHttpStatus: error?.transportHttpStatus,
          upstreamHttpStatus: error?.upstreamHttpStatus,
          pollCount: elapsed,
          status: 'failed',
          error: { message: error?.message || '轮询失败', code: error?.code },
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        throw error;
      }
      const pct = Math.min(95, Math.round(15 + (elapsed * 80) / maxPoll));
      const pollingTrace = {
        provider: result.taskProvider || submittedProvider || effectiveTaskProvider,
        model: result.model || submitted.model || job.payload.model || null,
        taskId: submitted.taskId,
        upstreamTaskId: submitted.taskId,
        requestId: result.requestId,
        transportHttpStatus: result.transportHttpStatus,
        upstreamHttpStatus: result.upstreamHttpStatus,
        usage: result.usage,
        httpStatusSource: 'local-backend',
        jobId: job.id,
        jobKind: job.kind,
        pollCount: elapsed,
        pollLimit: maxPoll,
        status: result.status,
        progress: result.progress || `${pct}%`,
      };
      await reporter?.polling(pollingTrace);
      await reporter?.providerPolling(pollingTrace);
      if (result.status === 'succeeded' && result.videoUrl) {
        await reporter?.providerResponse({
          provider: result.taskProvider || submittedProvider,
          model: result.model || submitted.model || job.payload.model,
          upstreamTaskId: submitted.taskId,
          requestId: result.requestId || submitted.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          pollCount: elapsed,
          status: 'succeeded',
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        logBus.success(`${job.title} 完成 → ${result.videoUrl}`, src);
        return result.videoUrl;
      }
      if (result.status === 'failed') {
        const message = result.failReason || '生成失败';
        await reporter?.providerResponse({
          provider: result.taskProvider || submittedProvider,
          model: result.model || submitted.model || job.payload.model,
          upstreamTaskId: submitted.taskId,
          requestId: result.requestId || submitted.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          pollCount: elapsed,
          status: 'failed',
          error: { message },
          jobId: job.id,
          jobKind: job.kind,
          httpStatusSource: 'local-backend',
        });
        throw new Error(message);
      }
      setJobPatch(job, {
        status: 'polling',
        taskId: submitted.taskId,
        taskProvider: result.taskProvider || submittedProvider,
        progress: String(result.status || '').toLowerCase() === 'materializing'
          ? '100% · 正在下载'
          : result.progress || `${pct}%`,
      });
      if (elapsed === 1 || elapsed % 3 === 0) {
        logBus.debug(`${job.title} 轮询 ${elapsed}/${maxPoll} · ${result.status} · ${result.progress || `${pct}%`}`, src);
      }
    }
    await reporter?.providerResponse({
      provider: submittedProvider,
      model: submitted.model || job.payload.model,
      upstreamTaskId: submitted.taskId,
      requestId: submitted.requestId,
      pollCount: maxPoll,
      status: 'failed',
      error: { message: '轮询超时' },
      jobId: job.id,
      jobKind: job.kind,
    });
    throw new Error('轮询超时');
  };

  const runBridge = async (bridgeId?: string, reporter?: RunNodeLifecycleReporter) => {
    const selectedBridge = bridgeId ? bridgesRef.current.find((bridge) => bridge.id === bridgeId) : null;
    if (bridgeId && !selectedBridge) {
      const message = '指定的桥接已不存在，无法生成。';
      update({ status: 'error', error: message });
      throw new Error(message);
    }
    if (selectedBridge && isBridgeBusy(selectedBridge)) {
      const message = '这个桥接已有任务在处理中，请先停止或重新获取结果。';
      patchBridge(selectedBridge.id, { error: message });
      update({ status: 'error', error: message });
      throw new Error(message);
    }
    let selectedBridges = bridgeId
      ? bridgesRef.current.filter((bridge) => bridge.id === bridgeId)
      : bridgesRef.current.filter((bridge) => bridge.firstFrameUrl && bridge.lastFrameUrl && !isBridgeBusy(bridge));
    if (selectedBridges.length === 0 && bridgeId) {
      const bridge = bridgesRef.current.find((item) => item.id === bridgeId);
      if (!bridge) {
        const message = '指定的桥接已不存在，无法生成。';
        update({ status: 'error', error: message });
        throw new Error(message);
      }
      try {
        selectedBridges = [await prepareBridgeFrames(bridge)];
      } catch (error: any) {
        const message = error?.message || '桥接首尾帧未准备好';
        update({ status: 'error', error: message });
        throw error instanceof Error ? error : new Error(message);
      }
    }

    const plan = buildDirectorStoryboardBridgeRunPlan(selectedBridges, shots, runSettings);
    if (plan.length === 0) {
      const message = bridgeId
        ? '请先生成前后两个镜头视频，或手动上传前段/后段视频、首帧/尾帧后再生成桥接。'
        : '还没有准备好的桥接片段，请先在两个镜头之间获取首尾帧。';
      if (bridgeId) patchBridge(bridgeId, { status: 'error', error: message });
      update({ status: 'error', error: message });
      logBus.warn(message, src);
      throw new Error(message);
    }

    taskCompletionSound.primeAudio();
    const controller = new AbortController();
    for (const job of plan) {
      const bridgeIdFromJob = job.id.replace(/^bridge-/, '');
      bridgeAbortRefs.current.set(bridgeIdFromJob, controller);
      patchBridge(bridgeIdFromJob, { status: 'submitting', error: null });
    }
    update({ status: 'polling', error: null });
    logBus.info(`导演分镜台开始生成桥接：${plan.length} 个任务，不限制并发`, src);
    const outputPlan = [...currentShotPlan, ...plan].sort((a, b) => a.order - b.order);

    const onJobComplete = (result: DirectorStoryboardJobResult) => {
      const bridgeIdFromJob = result.job.id.replace(/^bridge-/, '');
      if (result.status === 'success' && result.videoUrl) {
        videosRef.current = dedupe([...videosRef.current, result.videoUrl]);
        setJobPatch(result.job, {
          status: 'success',
          videoUrl: result.videoUrl,
          error: null,
          progress: '100%',
        });
        patchBridge(bridgeIdFromJob, { status: 'success', videoUrl: result.videoUrl, error: null });
        applyStoryboardOutputs(outputPlan, { status: 'polling' });
        taskCompletionSound.notifyComplete(id, 'director-storyboard');
      } else {
        const error = result.error || (result.status === 'cancelled' ? '用户已停止' : '桥接生成失败');
        setJobPatch(result.job, {
          status: result.status,
          error,
          progress: result.status === 'cancelled' ? '已停止' : '失败',
        });
        patchBridge(bridgeIdFromJob, { status: result.status, error });
        applyStoryboardOutputs(outputPlan);
      }
    };

    try {
      const runResult = await runDirectorStoryboardJobs(plan, (job, signal) => pollJob(job, signal, reporter), {
        signal: controller.signal,
        onJobComplete,
      });
      const failed = runResult.results.filter((result) => result.status !== 'success');
      const items = applyStoryboardOutputs(outputPlan, {
        status: controller.signal.aborted ? 'cancelled' : failed.length > 0 ? 'error' : 'success',
        error: failed.length ? `${failed.length} 个桥接任务失败或取消` : null,
      });
      if (controller.signal.aborted || failed.length > 0) {
        const message = controller.signal.aborted
          ? '用户已停止'
          : `${failed.length} 个桥接任务失败或取消`;
        logBus.warn(`导演分镜台桥接完成，但有 ${message}`, src);
        throw new Error(message);
      }
      await reporter?.output({
        status: 'succeeded',
        outputCount: items.length,
        assets: items.map((item) => ({ kind: 'video', sourceUrl: item.videoUrl })),
      });
      logBus.success(`导演分镜台桥接完成：${plan.length} 个视频`, src);
    } catch (error: any) {
      const message = error?.message || '桥接生成失败';
      applyStoryboardOutputs(outputPlan, { status: controller.signal.aborted ? 'cancelled' : 'error', error: message });
      logBus.error(`导演分镜台桥接失败: ${message}`, src);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      for (const job of plan) {
        const bridgeIdFromJob = job.id.replace(/^bridge-/, '');
        if (bridgeAbortRefs.current.get(bridgeIdFromJob) === controller) {
          bridgeAbortRefs.current.delete(bridgeIdFromJob);
        }
      }
    }
  };

  const runStoryboard = async (onlyShotId?: string, reporter?: RunNodeLifecycleReporter) => {
    if (abortRef.current || bridgeAbortRefs.current.size > 0) {
      throw new Error('导演分镜台已有本地任务正在运行，请先停止后再试。');
    }
    const selectedShots = onlyShotId ? shots.filter((shot) => shot.id === onlyShotId) : shots;
    if (selectedShots.length === 0) {
      throw new Error(onlyShotId ? '指定的分镜已不存在，无法生成。' : '当前没有可生成的分镜。');
    }
    const plan = buildDirectorStoryboardRunPlan(selectedShots, runSettings, {
      upstreamPrompt,
      mentionMaterials: storyboardMentionMaterials,
    });
    const outputPlan = onlyShotId && currentOutputPlan.length > 0 ? currentOutputPlan : plan;
    if (plan.length === 0) {
      throw new Error('当前没有可提交的分镜任务。');
    }

    taskCompletionSound.primeAudio();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!onlyShotId) {
      resultsRef.current = {};
      videosRef.current = [];
      update({
        status: 'submitting',
        error: null,
        videoUrl: '',
        videoUrls: [],
        textSegments: [],
        directorOutputItems: [],
        outputText: '',
        shotResults: {},
      });
    } else {
      update({ status: 'submitting', error: null });
    }
    logBus.info(`导演分镜台开始生成：${plan.length} 个任务，不限制并发`, src);

    const onJobComplete = (result: DirectorStoryboardJobResult) => {
      if (result.status === 'success' && result.videoUrl) {
        videosRef.current = dedupe([...videosRef.current, result.videoUrl]);
        setJobPatch(result.job, {
          status: 'success',
          videoUrl: result.videoUrl,
          error: null,
          progress: '100%',
        });
        applyStoryboardOutputs(outputPlan, { status: 'polling' });
        taskCompletionSound.notifyComplete(id, 'director-storyboard');
      } else {
        setJobPatch(result.job, {
          status: result.status,
          error: result.error || (result.status === 'cancelled' ? '用户已停止' : '生成失败'),
          progress: result.status === 'cancelled' ? '已停止' : '失败',
        });
        applyStoryboardOutputs(outputPlan);
      }
    };

    try {
      const runResult = await runDirectorStoryboardJobs(plan, (job, signal) => pollJob(job, signal, reporter), {
        signal: controller.signal,
        onJobComplete,
      });
      const failed = runResult.results.filter((result) => result.status !== 'success');
      const nextStatus = controller.signal.aborted ? 'cancelled' : failed.length > 0 ? 'error' : 'success';
      applyStoryboardOutputs(outputPlan, {
        status: nextStatus,
        error: failed.length ? `${failed.length} 个任务失败或取消` : null,
      });
      if (failed.length > 0) {
        logBus.warn(`导演分镜台完成，但有 ${failed.length} 个任务失败或取消`, src);
        throw new Error(`${failed.length} 个分镜任务失败或取消`);
      } else {
        logBus.success(`导演分镜台全部完成：${videosRef.current.length} 个视频`, src);
      }
    } catch (error: any) {
      const message = error?.message || '导演分镜生成失败';
      applyStoryboardOutputs(outputPlan, { status: controller.signal.aborted ? 'cancelled' : 'error', error: message });
      logBus.error(`导演分镜台失败: ${message}`, src);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const stopAll = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    bridgeAbortRefs.current.forEach((controller) => controller.abort());
    bridgeAbortRefs.current.clear();
    update({ status: 'cancelled', error: '用户已停止' });
    logBus.warn('用户停止导演分镜台：已停止本地提交/轮询，已提交的远端视频任务会按平台状态继续或自行结束', src);
  };

  const requestStoryboardRun = (mode: DirectorStoryboardRunMode, targetId = '') => {
    const normalizedTargetId = String(targetId || '').trim();
    const requestId = createCanvasNodeRunRequestId(id, DIRECTOR_STORYBOARD_RUN_PURPOSE[mode]);
    update({
      directorStoryboardRunMode: mode,
      directorStoryboardRunTargetId: normalizedTargetId,
      directorStoryboardRunRequestId: requestId,
    });
    // Let React publish the persisted intent before Canvas snapshots the graph
    // for the execution digest and confirmation preview.
    window.requestAnimationFrame(() => {
      if (requestCanvasNodeRun(id, { requestId })) return;
      const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
      if (liveData?.directorStoryboardRunRequestId !== requestId) return;
      update({
        directorStoryboardRunMode: 'all',
        directorStoryboardRunTargetId: '',
        directorStoryboardRunRequestId: '',
        status: 'error',
        error: '无法提交画布运行请求，请重试。',
      });
    });
  };

  useRunTrigger(id, async (reporter) => {
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const contextRequestId = String(reporter.runContext?.requestId || '').trim();
    const persistedRequestId = String(liveData?.directorStoryboardRunRequestId || '').trim();
    const requestedMode = String(liveData?.directorStoryboardRunMode || '').trim() as DirectorStoryboardRunMode;
    const requestedTargetId = String(liveData?.directorStoryboardRunTargetId || '').trim();
    try {
      if (abortRef.current || bridgeAbortRefs.current.size > 0) {
        throw new Error('导演分镜台已有本地任务正在运行，请先停止后再试。');
      }
      // Canvas assigns a requestId to ordinary group/single runs too. Only a
      // persisted node-surface intent opts into the secondary mode dispatcher.
      if (!persistedRequestId) {
        await runStoryboard(undefined, reporter);
        return;
      }
      if (!contextRequestId || contextRequestId !== persistedRequestId) {
        throw new Error('导演分镜运行请求已变化或失效，已拒绝执行。');
      }
      switch (requestedMode) {
        case 'all':
          if (requestedTargetId) throw new Error('生成全部分镜请求不应包含目标 ID。');
          await runStoryboard(undefined, reporter);
          break;
        case 'shot':
          if (!requestedTargetId || !shots.some((shot) => shot.id === requestedTargetId)) {
            throw new Error('指定的分镜已不存在，无法重跑。');
          }
          await runStoryboard(requestedTargetId, reporter);
          break;
        case 'bridge-one':
          if (!requestedTargetId || !bridgesRef.current.some((bridge) => bridge.id === requestedTargetId)) {
            throw new Error('指定的桥接已不存在，无法生成。');
          }
          await runBridge(requestedTargetId, reporter);
          break;
        case 'bridge-all':
          if (requestedTargetId) throw new Error('生成所有桥接请求不应包含目标 ID。');
          await runBridge(undefined, reporter);
          break;
        case 'refresh-bridge-one':
          if (!requestedTargetId || !bridgesRef.current.some((bridge) => bridge.id === requestedTargetId)) {
            throw new Error('指定的桥接已不存在，无法重新获取。');
          }
          await refreshStoryboardOutputs({ bridgeId: requestedTargetId }, reporter);
          break;
        case 'refresh-all':
          if (requestedTargetId) throw new Error('重新获取全部输出请求不应包含目标 ID。');
          await refreshStoryboardOutputs({}, reporter);
          break;
        default:
          throw new Error('导演分镜运行模式无效，已拒绝执行。');
      }
    } finally {
      if (contextRequestId) {
        const latestData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
        if (latestData?.directorStoryboardRunRequestId === contextRequestId) {
          update({
            directorStoryboardRunMode: 'all',
            directorStoryboardRunTargetId: '',
            directorStoryboardRunRequestId: '',
          });
        }
      }
    }
  }, 'director-storyboard', { lifecycleAware: true });

  const totalDuration = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const statusText = isBusy ? '生成中' : status === 'success' ? '已完成' : status === 'error' ? '有失败' : status === 'cancelled' ? '已停止' : '待生成';
  const resourceKindLabel = resourcePickerKind === 'image' ? '图像' : resourcePickerKind === 'video' ? '视频' : '音频';

  const renderResourcePreview = (item: api.ResourceItem) => {
    if (resourcePickerKind === 'video') {
      return <LoopingVideo src={item.fileUrl} className="h-full w-full object-cover" muted />;
    }
    if (resourcePickerKind === 'audio') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/35 text-[9px]">
          <Music size={17} />
          <span className="max-w-full truncate px-1">{fileName(item.fileUrl)}</span>
        </div>
      );
    }
    return <SmartImage src={item.thumbUrl || item.fileUrl} alt={item.title} thumbSize={160} className="h-full w-full object-cover" />;
  };

  const renderReferencePool = (shot: DirectorStoryboardShot) => {
    const refs = buildDirectorStoryboardReferenceOrder(shot);
    if (refs.length === 0) {
      return <div className="text-[10px]" style={mutedStyle}>暂无参考素材</div>;
    }
    return (
      <div className="flex flex-wrap gap-1.5" data-director-reference-pool>
        {refs.map((ref: DirectorStoryboardReferenceItem, index) => (
          <div
            key={`${ref.kind}:${ref.url}`}
            className={`relative nodrag nopan cursor-grab active:cursor-grabbing ${refDrag?.index === index ? 'opacity-70 ring-2 ring-white/40' : ''}`}
            data-director-ref-index={index}
            onPointerDown={(event) => startReferenceReorder(event, index)}
            title="拖动调整素材位置；按 Ctrl 拖到其他节点"
          >
            {ref.kind === 'image' ? (
              <SmartImage
                src={ref.url}
                alt=""
                thumbSize={180}
                className="h-12 w-14 rounded object-cover border"
                style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
                draggable={false}
                data-drag-source
                data-drag-kind="image"
                data-drag-url={ref.url}
                data-drag-preview={ref.url}
                data-drag-node-id={id}
                onMouseDown={(event) => beginMaterialDrag(event, { kind: 'image', url: ref.url, sourceNodeId: id, previewUrl: ref.url })}
              />
            ) : ref.kind === 'video' ? (
              <LoopingVideo
                src={ref.url}
                className="h-12 w-14 rounded object-cover border bg-black"
                style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
                draggable={false}
                data-drag-source
                data-drag-kind="video"
                data-drag-url={ref.url}
                data-drag-preview={ref.url}
                data-drag-node-id={id}
                onMouseDown={(event) => beginMaterialDrag(event, { kind: 'video', url: ref.url, sourceNodeId: id, previewUrl: ref.url })}
              />
            ) : (
              <div
                className="h-12 w-14 rounded border flex flex-col items-center justify-center text-[9px]"
                style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', background: 'var(--t8-bg-panel, rgba(15,23,42,.72))' }}
                draggable={false}
                data-drag-source
                data-drag-kind="audio"
                data-drag-url={ref.url}
                data-drag-node-id={id}
                onMouseDown={(event) => beginMaterialDrag(event, { kind: 'audio', url: ref.url, sourceNodeId: id, previewUrl: ref.url })}
              >
                <Music size={14} />
                <span className="max-w-full truncate">{fileName(ref.url)}</span>
              </div>
            )}
            <span
              className="pointer-events-none absolute left-0.5 top-0.5 rounded px-1 text-[8px] font-semibold"
              style={{ background: 'rgba(0,0,0,.55)', color: '#fff' }}
            >
              {ref.kind === 'image' ? '图' : ref.kind === 'video' ? '视' : '音'}
            </span>
            <button
              type="button"
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white"
              onClick={(event) => {
                event.stopPropagation();
                removeRef(ref.kind, ref.url);
              }}
              title="移除参考"
            >
              <X size={9} />
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderBridgeFramePreview = (label: string, url?: string) => (
    <div className="min-w-0 rounded border p-1" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
      <div className="mb-1 text-[10px] font-semibold" style={mutedStyle}>{label}</div>
      <div className="flex h-20 items-center justify-center overflow-hidden rounded bg-black/35">
        {url ? (
          <SmartImage src={url} alt={label} thumbSize={220} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px]" style={mutedStyle}>待获取</span>
        )}
      </div>
    </div>
  );

  const renderBridgeEditor = () => {
    if (!activeBridge) {
      return (
        <div
          className="rounded-md border p-2"
          style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', background: 'var(--t8-bg-panel, rgba(15,23,42,.52))' }}
        >
          <div className="flex items-center justify-between gap-2">
            <label className="nodrag flex min-w-0 items-center gap-2 text-[11px] font-semibold">
              <input type="checkbox" checked={false} disabled />
              <span className="truncate">启用首尾帧桥接</span>
            </label>
            <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', color: 'var(--t8-text-muted, rgba(248,250,252,.72))' }}>
              需要至少 2 个分镜
            </span>
          </div>
        </div>
      );
    }
    const fromShot = shots.find((shot) => shot.id === activeBridge.fromShotId);
    const toShot = shots.find((shot) => shot.id === activeBridge.toShotId);
    const fromVideo = getShotVideoUrl(activeBridge.fromShotId) || activeBridge.previousVideoUrl || '';
    const toVideo = getShotVideoUrl(activeBridge.toShotId) || activeBridge.nextVideoUrl || '';
    const missingGeneratedVideos = !fromVideo || !toVideo;
    const isActiveBridgeBusy = isBridgeBusy(activeBridge);
    const isActiveBridgeLocallyPolling = bridgeAbortRefs.current.has(activeBridge.id);
    const readyBridgeCount = bridges.filter((bridge) => bridge.firstFrameUrl && bridge.lastFrameUrl && !isBridgeBusy(bridge)).length;
    const activeBridgeResult = results[`bridge-${activeBridge.id}`] || {};
    const canRefreshActiveBridgeOutput = Boolean(
      activeBridgeResult.taskId
        || activeBridge.taskId
        || activeBridgeResult.videoUrl
        || activeBridge.videoUrl,
    );

    return (
      <div
        className="rounded-md border p-2"
        style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', background: 'var(--t8-bg-panel, rgba(15,23,42,.52))' }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <label className="nodrag flex min-w-0 items-center gap-2 text-[11px] font-semibold">
              <input
                type="checkbox"
                checked={bridgePanelEnabled}
                onChange={(event) => update({
                  directorBridgePanelEnabled: event.target.checked,
                  bridgeEnabled: event.target.checked,
                })}
              />
              <span className="truncate">启用首尾帧桥接 · {fromShot?.title || '上一镜'} → {toShot?.title || '下一镜'}</span>
            </label>
            <div className="truncate text-[10px]" style={mutedStyle}>
              默认关闭；勾选后展开当前相邻分镜的桥接设置。
            </div>
          </div>
          <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', color: 'var(--t8-accent, #d946ef)' }}>
            {!bridgePanelEnabled ? '已关闭' : activeBridge.status === 'success' ? '已完成' : activeBridge.status === 'extracting' ? '抽帧中' : activeBridge.status === 'error' ? '需处理' : activeBridge.firstFrameUrl && activeBridge.lastFrameUrl ? '可生成' : '待首尾帧'}
          </span>
        </div>

        {!bridgePanelEnabled && (
          <div className="rounded border border-dashed px-2 py-2 text-[10px] leading-relaxed" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', color: 'var(--t8-text-muted, rgba(248,250,252,.72))' }}>
            桥接功能默认收起，不会占用分镜编辑空间；需要制作 S1→S2 这类首尾帧过渡时，勾选上方开关即可展开。
          </div>
        )}

        {bridgePanelEnabled && (
          <>

        {missingGeneratedVideos && (
          <div className="mb-2 rounded border border-amber-400/35 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
            请先生成前后两个镜头视频；也可以手动上传前段视频和后段视频，系统会自动获取前段尾帧与后段首帧。
          </div>
        )}

        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {renderBridgeFramePreview('前段尾帧 / 首帧输入', activeBridge.firstFrameUrl)}
          {renderBridgeFramePreview('后段首帧 / 尾帧输入', activeBridge.lastFrameUrl)}
        </div>

        <div className="mb-2 grid grid-cols-[72px_1fr] gap-1.5">
          <input
            type="number"
            min={MIN_DURATION}
            max={MAX_DURATION}
            value={activeBridge.durationSec}
            onChange={(event) => patchBridge(activeBridge.id, { durationSec: clampDuration(event.target.value) })}
            className="nodrag rounded border px-2 py-1 text-xs outline-none"
            style={inputStyle}
            title="桥接时长，4-15 秒"
          />
          <input
            value={activeBridge.prompt}
            onChange={(event) => patchBridge(activeBridge.id, { prompt: event.target.value })}
            placeholder="桥接提示词，例如：镜头平滑转场，动作自然延续"
            className="nodrag rounded border px-2 py-1 text-xs outline-none"
            style={inputStyle}
          />
        </div>

        <div className="mb-2 rounded border p-1.5" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--t8-accent, #d946ef)' }}>
              <Wand2 size={11} /> 桥接预设 · LIST
            </div>
            <div className="shrink-0 text-[10px]" style={mutedStyle}>内置 50 · 自定义 {bridgePromptPresets.length}</div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
            <select
              aria-label="director-bridge-prompt-preset-select"
              value={selectedBridgePromptPreset?.id || ''}
              onChange={(event) => selectBridgePromptPreset(event.target.value)}
              className="nodrag min-w-0 rounded border px-1.5 py-1 text-[10px] outline-none"
              style={inputStyle}
              title="选择常用桥接提示词"
            >
              <option value="">选择预设提示词</option>
              <optgroup label="内置 50 条">
                {DIRECTOR_BRIDGE_PROMPT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{`${preset.category || '通用'} · ${preset.name}`}</option>
                ))}
              </optgroup>
              {bridgePromptPresets.length > 0 && (
                <optgroup label={`自定义 ${bridgePromptPresets.length} 条`}>
                  {bridgePromptPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              onClick={applyBridgePromptPreset}
              disabled={!selectedBridgePromptPreset}
              className="nodrag flex items-center justify-center gap-1 whitespace-nowrap rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--t8-accent, #d946ef)', color: 'var(--t8-accent, #d946ef)' }}
              title="把选中的预设写入桥接提示词"
            >
              <Wand2 size={10} /> 套用
            </button>
          </div>
          <div className="mt-1 truncate text-[10px]" style={mutedStyle}>
            {selectedBridgePromptPreset ? `预览：${selectedBridgePromptPreset.text}` : '选择一条预设后点套用；保存会记录当前桥接提示词。'}
          </div>
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1.5">
            <input
              value={bridgePresetName}
              onChange={(event) => update({ directorBridgePresetName: event.target.value })}
              placeholder="自定义名称"
              className="nodrag min-w-0 rounded border px-1.5 py-1 text-[10px] outline-none"
              style={inputStyle}
              title="保存当前桥接提示词时使用"
            />
            <button
              type="button"
              onClick={saveBridgePromptPreset}
              className="nodrag flex items-center justify-center gap-1 whitespace-nowrap rounded border px-1.5 py-1 text-[10px]"
              style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
              title="保存当前桥接提示词为自定义预设"
            >
              <Save size={10} /> 保存
            </button>
            <button
              type="button"
              onClick={exportBridgePromptPresets}
              className="nodrag flex items-center justify-center gap-1 whitespace-nowrap rounded border px-1.5 py-1 text-[10px]"
              style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
              title="导出自定义桥接提示词 JSON"
            >
              <Download size={10} /> 导出
            </button>
            <button
              type="button"
              onClick={() => bridgePresetImportRef.current?.click()}
              className="nodrag flex items-center justify-center gap-1 whitespace-nowrap rounded border px-1.5 py-1 text-[10px]"
              style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
              title="导入桥接提示词 JSON"
            >
              <Upload size={10} /> 导入
            </button>
          </div>
          <input
            ref={bridgePresetImportRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={importBridgePromptPresets}
          />
          {bridgePresetNotice && (
            <div className="mt-1.5 rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', color: 'var(--t8-text-muted, rgba(248,250,252,.72))' }}>
              {bridgePresetNotice}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => void prepareBridgeFrames(activeBridge)}
            className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
          >
            <RotateCcw size={11} /> 自动获取
          </button>
          <button
            type="button"
            onClick={() => openBridgeUpload(activeBridge.id, 'previous-video')}
            className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
          >
            <VideoIcon size={11} /> 上传前段视频
          </button>
          <button
            type="button"
            onClick={() => openBridgeUpload(activeBridge.id, 'next-video')}
            className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
          >
            <VideoIcon size={11} /> 上传后段视频
          </button>
          <button
            type="button"
            onClick={() => openBridgeUpload(activeBridge.id, 'first-image')}
            className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
          >
            <ImageIcon size={11} /> 上传首帧
          </button>
          <button
            type="button"
            onClick={() => openBridgeUpload(activeBridge.id, 'last-image')}
            className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
          >
            <ImageIcon size={11} /> 上传尾帧
          </button>
          <button
            type="button"
            onClick={() => requestStoryboardRun('bridge-one', activeBridge.id)}
            disabled={isActiveBridgeBusy}
            className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--t8-accent, #d946ef)', color: 'var(--t8-accent, #d946ef)' }}
          >
            <Sparkles size={11} /> 生成桥接
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={mutedStyle}>
          <span className="min-w-0 flex-1 truncate">{activeBridge.error || (activeBridge.videoUrl ? `已生成：${fileName(activeBridge.videoUrl)}` : '桥接会输出在两个分镜之间。')}</span>
          <button
            type="button"
            onClick={() => requestStoryboardRun('refresh-bridge-one', activeBridge.id)}
            disabled={!canRefreshActiveBridgeOutput || isActiveBridgeLocallyPolling}
            className="nodrag shrink-0 rounded border px-1.5 py-0.5 disabled:opacity-40"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', color: 'var(--t8-text-main, #f8fafc)' }}
            title="不重新提交任务，只按当前桥接 taskId 或已生成记录重新获取桥接视频"
          >
            重新获取桥接
          </button>
          <button
            type="button"
            onClick={() => requestStoryboardRun('bridge-all')}
            disabled={readyBridgeCount === 0}
            className="nodrag shrink-0 rounded border px-1.5 py-0.5 disabled:opacity-40"
            style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', color: 'var(--t8-text-main, #f8fafc)' }}
            title="并发生成所有已准备首尾帧的桥接片段"
          >
            生成所有桥接 {readyBridgeCount || ''}
          </button>
        </div>
          </>
        )}
      </div>
    );
  };

  const resourcePicker = resourcePickerKind ? (
    <div
      className="nodrag nopan absolute left-3 right-3 top-[112px] z-50 rounded-lg border p-2 shadow-2xl"
      style={{
        background: 'var(--t8-bg-node, rgba(10,15,24,.98))',
        borderColor: 'var(--t8-border-strong, rgba(255,255,255,.2))',
        color: 'var(--t8-text-main, #f8fafc)',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold">
          <Library size={14} />
          <span className="truncate">从资源库导入{resourceKindLabel}</span>
        </div>
        <button
          type="button"
          className="nodrag flex h-7 w-7 items-center justify-center rounded border"
          style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
          onClick={closeResourcePicker}
          title="关闭"
        >
          <X size={13} />
        </button>
      </div>
      <label className="mb-2 flex items-center gap-1.5 rounded border px-2 py-1" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
        <Search size={13} />
        <input
          value={resourceQuery}
          onChange={(event) => setResourceQuery(event.target.value)}
          placeholder={`搜索资源库${resourceKindLabel}`}
          className="nodrag min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </label>
      {resourceMessage && (
        <div className="mb-2 rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', color: 'var(--t8-text-muted, rgba(248,250,252,.72))' }}>
          {resourceMessage}
        </div>
      )}
      <div className="max-h-56 overflow-y-auto pr-1">
        {resourceLoading ? (
          <div className="flex h-24 items-center justify-center gap-1.5 text-[11px]" style={mutedStyle}>
            <Loader2 size={13} className="animate-spin" /> 读取资源库...
          </div>
        ) : resourceItems.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-[11px]" style={mutedStyle}>暂无{resourceKindLabel}资源</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {resourceItems.slice(0, 60).map((item) => (
              <button
                type="button"
                key={item.id}
                className="nodrag min-w-0 overflow-hidden rounded border p-1 text-left"
                style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', background: 'var(--t8-bg-panel, rgba(15,23,42,.58))' }}
                onClick={() => void handlePickResourceItem(item)}
                title={item.title}
              >
                <div className="mb-1 h-16 overflow-hidden rounded bg-black/40">
                  {renderResourcePreview(item)}
                </div>
                <div className="truncate text-[10px] font-semibold">{item.title || fileName(item.fileUrl)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      {...dropProps}
      className={`relative w-[460px] overflow-visible rounded-lg border-2 text-sm shadow-2xl transition-all ${
        selected ? 'shadow-fuchsia-500/20' : ''
      }`}
      style={{
        background: 'var(--t8-bg-node, rgba(10,15,24,.95))',
        color: 'var(--t8-text-main, #f8fafc)',
        borderColor: selected
          ? 'var(--t8-accent, #d946ef)'
          : isAccepting
            ? 'var(--t8-success, #22c55e)'
            : 'var(--t8-border-strong, rgba(255,255,255,.18))',
        boxShadow: isAccepting ? '0 0 0 3px color-mix(in srgb, var(--t8-success, #22c55e) 28%, transparent)' : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="director-storyboard-port !h-4 !w-4 !border-2"
        style={{
          left: -9,
          background: 'var(--t8-accent, #d946ef)',
          borderColor: 'var(--t8-bg-node, rgba(10,15,24,.95))',
          zIndex: 30,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="director-storyboard-port !h-4 !w-4 !border-2"
        style={{
          right: -9,
          background: 'var(--t8-accent, #d946ef)',
          borderColor: 'var(--t8-bg-node, rgba(10,15,24,.95))',
          zIndex: 30,
        }}
      />

      {resourcePicker}

      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-md border"
          style={{
            background: 'color-mix(in srgb, var(--t8-accent, #d946ef) 18%, transparent)',
            borderColor: 'var(--t8-accent, #d946ef)',
            color: 'var(--t8-accent, #d946ef)',
          }}
        >
          <Clapperboard size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">导演分镜台</div>
          <div className="truncate text-[11px]" style={mutedStyle}>
            {shots.length} 镜头 · {totalDuration}s · {isExternalVideo ? externalVideoSelection.provider?.label || externalVideoSelection.providerSource : 'Seedance2.0'} 无限并发
          </div>
        </div>
        <span
          className="rounded border px-2 py-1 text-[10px] font-semibold"
          style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', color: 'var(--t8-accent, #d946ef)' }}
        >
          {statusText}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-4 gap-1.5">
          <select
            value={isExternalVideo ? `advanced:${externalVideoSelection.providerId}` : builtinSource}
            onChange={(event) => {
              const selectedValue = event.target.value;
              if (selectedValue.startsWith('advanced:')) {
                const providerId = selectedValue.slice('advanced:'.length);
                const provider = videoProviders.find((item) => item.id === providerId);
                if (provider) update({ providerSource: provider.protocol, providerId: provider.id, providerModel: advancedProviderModelOptions(provider, 'video')[0] || '' });
                return;
              }
              const nextSource = selectedValue as SeedanceBuiltinSource;
              const nextUsesSeedanceNz = nextSource === 'seedance-nz' || (nextSource === 'auto' && hasSeedanceNzKey);
              update({
                seedanceApiSource: nextSource,
                providerSource: 'zhenzhen',
                providerId: '',
                providerModel: '',
                ratio: nextUsesSeedanceNz && savedRatio === '9:21' ? '9:16' : savedRatio,
                resolution: nextUsesSeedanceNz && savedResolution === 'native4K' ? 'native4k' : savedResolution,
              });
            }}
            className="nodrag col-span-4 rounded border px-2 py-1 text-[11px] outline-none"
            style={inputStyle}
            title="Seedance API 来源"
          >
            <option value="auto">主力 API（自动：优先平价AI小屋）</option>
            <option value="seedance-nz">贞贞的平价AI小屋 · api.seedance.nz</option>
            <option value="zhenzhen-legacy">贞贞的AI工坊（海外） · ai.t8star.org</option>
            {videoProviders.map((provider) => <option key={provider.id} value={`advanced:${provider.id}`}>{provider.label} · {provider.protocol}</option>)}
          </select>
        </div>
        {isSeedanceNzSelected && !hasSeedanceNzKey && (
          <div className="rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'var(--t8-warning, #f59e0b)', color: 'var(--t8-warning, #f59e0b)' }}>
            尚未配置“贞贞的平价AI小屋 API Key”，请先到 API 设置填写。
          </div>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          <select
            value={model}
            onChange={(event) => {
              const nextModel = event.target.value;
              update({
                [isExternalVideo ? 'providerModel' : isSeedanceNzSelected ? 'seedanceNzModel' : 'model']: nextModel,
                resolution: isSeedanceNzSelected
                  && !isSeedanceNzStandardModel(nextModel)
                  && String(resolution).startsWith('native')
                  ? '720p'
                  : resolution,
              });
            }}
            className="nodrag rounded border px-2 py-1 text-[11px] outline-none col-span-2"
            style={inputStyle}
          >
            {modelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={ratio} onChange={(event) => update({ ratio: event.target.value })} className="nodrag rounded border px-2 py-1 text-[11px] outline-none" style={inputStyle}>
            {ratioOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={resolution} onChange={(event) => update({ resolution: event.target.value })} className="nodrag rounded border px-2 py-1 text-[11px] outline-none" style={inputStyle}>
            {resolutionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <label className="flex items-center gap-1 text-[10px]" style={mutedStyle}>
            <input type="checkbox" checked={generateAudio} onChange={(event) => update({ generateAudio: event.target.checked })} />
            音频
          </label>
          <label className="flex items-center gap-1 text-[10px]" style={mutedStyle}>
            <input type="checkbox" checked={returnLastFrame} onChange={(event) => update({ returnLastFrame: event.target.checked })} />
            末帧
          </label>
          {!isSeedanceNzSelected ? (
            <label className="flex items-center gap-1 text-[10px]" style={mutedStyle}>
              <input type="checkbox" checked={watermark} onChange={(event) => update({ watermark: event.target.checked })} />
              水印
            </label>
          ) : <span className="text-[10px]" style={mutedStyle}>原生协议</span>}
          <input
            type="number"
            value={seed}
            onChange={(event) => update({ seed: Number(event.target.value) || -1 })}
            className="nodrag rounded border px-2 py-1 text-[11px] outline-none"
            style={inputStyle}
            title="Seed，-1 为随机"
          />
        </div>

        <LocalNodeAddonSlot
          nodeId={id}
          nodeType="director-storyboard"
          data={d}
          update={update}
          context={{
            providerSource: effectiveTaskProvider,
            providerModel: model,
            model,
            apiModel: model,
            mainId: 'seedance-2.0',
            providerKind: 'seedance',
          }}
        />

        <div
          className="rounded-md border p-2"
          style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', background: 'var(--t8-bg-panel, rgba(15,23,42,.52))' }}
        >
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-semibold">秒级时间线</span>
            <button type="button" className="nodrag rounded border px-2 py-1 text-[10px] disabled:opacity-50" disabled={isBusy || !upstream.texts.length} onClick={importUpstreamScripts} title={t('directorImport.hint')}>
              {t('directorImport.import')}
            </button>
            <button type="button" className="nodrag rounded border px-2 py-1 text-[10px] disabled:opacity-50" disabled={isBusy || !upstream.images.length} onClick={assignShotImages} title={t('directorImport.hint')}>
              {t('directorImport.assign')}
            </button>
            <button
              type="button"
              onClick={addShot}
              className="nodrag flex items-center gap-1 rounded border px-2 py-1 text-[10px]"
              style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}
            >
              <Plus size={11} /> 加分镜
            </button>
          </div>
          {scriptImportNotice && <div role="status" className="nodrag nopan nowheel mb-1 max-h-16 overflow-auto whitespace-pre-wrap text-[10px]" data-director-import-notice="true">{scriptImportNotice}</div>}
          <div ref={timelineRef} className="nodrag nopan flex h-14 min-w-0 overflow-hidden rounded border" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
            {shots.map((shot, index) => {
              const result = results[`shot-${shot.id}`];
              const isActive = activeShot?.id === shot.id;
              const bridge = bridges[index];
              const bridgeResult = bridge ? results[`bridge-${bridge.id}`] : null;
              return (
                <div key={shot.id} className="contents">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveShotId(shot.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActiveShotId(shot.id);
                      }
                    }}
                    className="nodrag nopan relative min-w-[42px] border-r px-1 text-left text-[10px] outline-none transition-colors focus-visible:ring-2"
                    style={{
                      flex: Math.max(1, shot.durationSec),
                      borderColor: 'var(--t8-border, rgba(255,255,255,.12))',
                      background: isActive
                        ? 'color-mix(in srgb, var(--t8-accent, #d946ef) 26%, var(--t8-bg-panel, #111827))'
                        : 'var(--t8-bg-panel, rgba(15,23,42,.42))',
                    }}
                    title="点击编辑；拖动右侧小条调整秒数"
                  >
                    <div className="truncate font-semibold">{shot.title || `S${index + 1}`}</div>
                    <div style={mutedStyle}>{shot.durationSec}s</div>
                    {result?.status === 'success' && <div className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                    {result?.status === 'error' && <div className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-rose-400" />}
                    <button
                      type="button"
                      data-director-timeline-resize-handle
                      className="nodrag nopan absolute -right-1 top-0 z-20 h-full w-4 cursor-ew-resize rounded-sm border-l border-white/20 bg-white/5 opacity-80 transition hover:bg-white/20"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDownCapture={(event) => beginDurationResize(event, shot)}
                      onPointerDown={(event) => beginDurationResize(event, shot)}
                      onPointerMoveCapture={moveDurationResize}
                      onPointerUpCapture={endDurationResize}
                      onPointerCancelCapture={endDurationResize}
                      onMouseDownCapture={(event) => beginDurationResize(event, shot)}
                      onMouseDown={(event) => beginDurationResize(event, shot)}
                      onMouseMoveCapture={moveDurationResize}
                      onMouseUpCapture={endDurationResize}
                      aria-label={`拖动调整 ${shot.title || `S${index + 1}`} 时长`}
                      title="拖动调整秒数"
                    />
                  </div>
                  {bridge && (
                    <button
                      key={bridge.id}
                      type="button"
                      data-director-timeline-resize-handle
                      onClick={() => setActiveBridgeId(bridge.id)}
                      onPointerDownCapture={(event) => beginBridgeSeparatorInteraction(event, shot, bridge.id)}
                      onMouseDownCapture={(event) => beginBridgeSeparatorInteraction(event, shot, bridge.id)}
                      className="nodrag nopan flex w-7 shrink-0 items-center justify-center border-r text-[10px] font-semibold outline-none transition focus-visible:ring-2"
                      style={{
                        borderColor: 'var(--t8-border, rgba(255,255,255,.12))',
                        background: activeBridgeId === bridge.id
                          ? 'color-mix(in srgb, var(--t8-accent, #d946ef) 30%, var(--t8-bg-panel, #111827))'
                          : 'color-mix(in srgb, var(--t8-accent, #d946ef) 12%, var(--t8-bg-panel, #111827))',
                        color: bridgeResult?.status === 'success'
                          ? 'var(--t8-success, #22c55e)'
                          : bridge.firstFrameUrl && bridge.lastFrameUrl
                            ? 'var(--t8-accent, #d946ef)'
                            : 'var(--t8-text-muted, rgba(248,250,252,.72))',
                      }}
                      aria-label={`点击编辑桥接，拖动调整 ${shot.title || `S${index + 1}`} 时长`}
                      title={`点击编辑桥接；拖动调整 ${shot.title || `S${index + 1}`} 时长`}
                    >
                      ↔
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {activeShot && (
          <div
            className="rounded-md border p-2"
            style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))', background: 'var(--t8-bg-panel, rgba(15,23,42,.52))' }}
          >
            <div className="mb-2 flex items-center gap-1.5">
              <input
                value={activeShot.title}
                onChange={(event) => patchShot(activeShot.id, { title: event.target.value })}
                className="nodrag min-w-0 flex-1 rounded border px-2 py-1 text-xs font-semibold outline-none"
                style={inputStyle}
              />
              <input
                type="number"
                min={MIN_DURATION}
                max={MAX_DURATION}
                value={activeShot.durationSec}
                onChange={(event) => patchShot(activeShot.id, { durationSec: clampDuration(event.target.value) })}
                className="nodrag w-16 rounded border px-2 py-1 text-xs outline-none"
                style={inputStyle}
              />
              <select
                value={activeShot.frameMode}
                onChange={(event) => patchShot(activeShot.id, { frameMode: event.target.value as any })}
                className="nodrag w-24 rounded border px-2 py-1 text-xs outline-none"
                style={inputStyle}
              >
                {FRAME_MODE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>

            {inputReuseCandidates.length > 0 && (
              <div className="mb-2 rounded border p-1.5" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--t8-accent, #d946ef)' }}>
                    <Copy size={11} /> 复用输入
                  </div>
                  <div className="min-w-0 truncate text-right text-[10px]" style={mutedStyle}>
                    {inputReuseSourceShot ? describeShotReusableInputs(inputReuseSourceShot) : '无可复用输入'}
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                  <select
                    value={inputReuseSourceShot?.id || ''}
                    onChange={(event) => setInputReuseSourceShotId(event.target.value)}
                    className="nodrag min-w-0 rounded border px-1.5 py-1 text-[10px] outline-none"
                    style={inputStyle}
                    title="选择要复用输入的来源分镜"
                  >
                    {inputReuseCandidates.map((shot, index) => (
                      <option key={shot.id} value={shot.id}>
                        {`${shot.title || `S${index + 1}`} - ${describeShotReusableInputs(shot)}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={applyInputReuseToActiveShot}
                    disabled={!inputReuseSourceShot}
                    className="nodrag flex items-center justify-center gap-1 whitespace-nowrap rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--t8-accent, #d946ef)', color: 'var(--t8-accent, #d946ef)' }}
                    title="应用到当前分镜"
                  >
                    <Copy size={10} /> 应用到当前分镜
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]" style={mutedStyle}>
                  {['提示词', '图像', '视频', '音频', '帧模式'].map((label) => (
                    <span key={label} className="rounded border px-1 py-0.5" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-2 rounded border p-1.5" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
              <div className="mb-1 text-[10px] font-semibold" style={mutedStyle}>镜头覆盖</div>
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={activeShot.modelOverride || ''}
                  onChange={(event) => patchShot(activeShot.id, { modelOverride: event.target.value || undefined })}
                  className="nodrag min-w-0 rounded border px-1.5 py-1 text-[10px] outline-none"
                  style={inputStyle}
                  title="单镜头模型，留空继承全局"
                >
                  <option value="">继承模型</option>
                  {modelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <select
                  value={activeShot.ratioOverride || ''}
                  onChange={(event) => patchShot(activeShot.id, { ratioOverride: event.target.value || undefined })}
                  className="nodrag min-w-0 rounded border px-1.5 py-1 text-[10px] outline-none"
                  style={inputStyle}
                  title="单镜头比例，留空继承全局"
                >
                  <option value="">继承比例</option>
                  {ratioOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select
                  value={activeShot.resolutionOverride || ''}
                  onChange={(event) => patchShot(activeShot.id, { resolutionOverride: event.target.value || undefined })}
                  className="nodrag min-w-0 rounded border px-1.5 py-1 text-[10px] outline-none"
                  style={inputStyle}
                  title="单镜头分辨率，留空继承全局"
                >
                  <option value="">继承分辨率</option>
                  {resolutionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>

            <MentionPromptInput
              title="分镜提示词"
              value={activeShot.prompt || ''}
              mentions={Array.isArray(activeShot.promptMentions) ? activeShot.promptMentions : []}
              materials={mentionMaterials}
              onChange={(value: string, mentions: MediaMention[]) => patchShot(activeShot.id, { prompt: value, promptMentions: mentions })}
              placeholder="写这个镜头的画面、动作、镜头语言；输入 @ 可引用素材"
              isDark={isDark}
              isPixel={isPixel}
              promptTemplateKind="video"
              className="nodrag min-h-[72px] w-full resize-none rounded border px-2 py-1 text-xs outline-none"
              style={inputStyle}
            />

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button type="button" onClick={() => uploadImageRef.current?.click()} className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <ImageIcon size={12} /> 上传图
              </button>
              <button type="button" onClick={() => uploadVideoRef.current?.click()} className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <VideoIcon size={12} /> 上传视频
              </button>
              <button type="button" onClick={() => uploadAudioRef.current?.click()} className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <Music size={12} /> 上传音频
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <button type="button" onClick={() => openResourcePicker('image')} className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <Library size={12} /> 资源图
              </button>
              <button type="button" onClick={() => openResourcePicker('video')} className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <Library size={12} /> 资源视频
              </button>
              <button type="button" onClick={() => openResourcePicker('audio')} className="nodrag flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <Library size={12} /> 资源音频
              </button>
            </div>

            <input ref={uploadImageRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleUpload('image', event)} />
            <input ref={uploadVideoRef} type="file" accept="video/*" multiple className="hidden" onChange={(event) => handleUpload('video', event)} />
            <input ref={uploadAudioRef} type="file" accept="audio/*" multiple className="hidden" onChange={(event) => handleUpload('audio', event)} />
            <input ref={bridgeUploadRef} type="file" className="hidden" onChange={handleBridgeUpload} />

            <div className="mt-2">
              {renderReferencePool(activeShot)}
            </div>

            <div className="mt-2 grid grid-cols-5 gap-1.5">
              <button type="button" onClick={() => moveShot(activeShot.id, -1)} className="nodrag rounded border px-1 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>上移</button>
              <button type="button" onClick={() => moveShot(activeShot.id, 1)} className="nodrag rounded border px-1 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>下移</button>
              <button type="button" onClick={duplicateShot} className="nodrag flex items-center justify-center gap-1 rounded border px-1 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))' }}>
                <Copy size={10} /> 复制
              </button>
              <button type="button" onClick={() => requestStoryboardRun('shot', activeShot.id)} disabled={isBusy} className="nodrag flex items-center justify-center gap-1 rounded border px-1 py-1 text-[10px] disabled:opacity-50" style={{ borderColor: 'var(--t8-accent, #d946ef)', color: 'var(--t8-accent, #d946ef)' }}>
                <RotateCcw size={10} /> 重跑
              </button>
              <button type="button" onClick={() => removeShot(activeShot.id)} disabled={shots.length <= 1} className="nodrag flex items-center justify-center gap-1 rounded border px-1 py-1 text-[10px] text-rose-300 disabled:opacity-40" style={{ borderColor: 'rgba(244,63,94,.45)' }}>
                <Trash2 size={10} /> 删除
              </button>
            </div>
          </div>
        )}

        {renderBridgeEditor()}

        <div className="grid grid-cols-2 gap-2">
          {!isBusy ? (
            <button
              type="button"
              onClick={() => requestStoryboardRun('all')}
              className="nodrag flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold"
              style={{
                borderColor: 'var(--t8-accent, #d946ef)',
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--t8-accent, #d946ef) 80%, #111827), color-mix(in srgb, var(--t8-accent-2, #22d3ee) 70%, #111827))',
                color: '#fff',
              }}
            >
              <Sparkles size={14} /> 生成全部
            </button>
          ) : (
            <button
              type="button"
              onClick={stopAll}
              className="nodrag flex items-center justify-center gap-1.5 rounded-md border border-rose-400/50 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-100"
            >
              <Square size={13} /> 停止全部
            </button>
          )}
          <div className="flex items-center gap-2 rounded-md border px-2 py-2 text-[11px]" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            <span className="truncate" style={mutedStyle}>
              已输出 {completedVideoUrls.length} / {currentOutputPlan.length || shots.length}
            </span>
                <button
                  type="button"
                  onClick={() => requestStoryboardRun('refresh-all')}
                  className="nodrag ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
              style={{ borderColor: 'var(--t8-border-strong, rgba(255,255,255,.18))', color: 'var(--t8-text-main, #f8fafc)' }}
              title="不重新提交任务，仅重新整理已完成的视频输出"
            >
              重新获取
            </button>
          </div>
        </div>

        {Object.keys(results).length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
            {Object.entries(results).map(([jobId, result]) => (
              <div key={jobId} className="flex items-center gap-1.5 rounded border px-2 py-1 text-[10px]" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
                <span className={`h-2 w-2 rounded-full ${
                  result.status === 'success' ? 'bg-emerald-400' : result.status === 'error' ? 'bg-rose-400' : result.status === 'cancelled' ? 'bg-zinc-400' : 'bg-amber-300'
                }`} />
                <span className="min-w-0 flex-1 truncate">{result.kind === 'bridge' ? '桥接' : '分镜'} · {result.title}</span>
                <span className="shrink-0" style={mutedStyle}>{result.progress || result.status}</span>
              </div>
            ))}
          </div>
        )}

        {d.error && (
          <div className="flex items-start gap-1 rounded border border-rose-400/35 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="break-all">{d.error}</span>
          </div>
        )}

        {latestVideoUrl && !hasAutoOutput && (
          <div className="rounded border p-1.5" style={{ borderColor: 'var(--t8-border, rgba(255,255,255,.12))' }}>
            <LoopingVideo
              src={latestVideoUrl}
              controls
              className="w-full rounded"
              style={{ aspectRatio: ratio === 'adaptive' ? undefined : ratio.replace(':', '/') }}
              data-drag-source
              data-drag-kind="video"
              data-drag-url={latestVideoUrl}
              data-drag-preview={latestVideoUrl}
              data-drag-node-id={id}
              data-resource-title={fileName(latestVideoUrl)}
              onMouseDown={(event) => beginMaterialDrag(event, { kind: 'video', url: latestVideoUrl, sourceNodeId: id, previewUrl: latestVideoUrl })}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(DirectorStoryboardNode);
