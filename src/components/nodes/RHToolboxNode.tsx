import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  ArrowLeft,
  Image as ImageIcon,
  Layers,
  Loader2,
  Music,
  Pencil,
  Play,
  Search,
  Sparkles,
  Square,
  Upload,
  Video as VideoIcon,
  Wrench,
  X,
} from 'lucide-react';
import { PORT_COLOR } from '../../config/portTypes';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { cancelRh, fetchRhAppInfo, uploadFile } from '../../services/generation';
import { runRhToolboxTool, getRhToolboxManifest, type RunRhToolboxProgress } from '../../services/rhToolbox';
import { getRhToolboxPersistentManifest } from '../../services/api';
import { useThemeStore } from '../../stores/theme';
import { logBus } from '../../stores/logs';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../../stores/runBus';
import { useCanvasStore } from '../../stores/canvas';
import {
  RH_TOOLBOX_ALL_CATEGORY_ID,
  RH_TOOLBOX_CAPABILITY_LABELS,
  filterRhToolboxTools,
  getRhToolboxCategoryMajorId,
  getRhToolboxNodeInfoFieldLabel,
  getRhToolboxNodeInfoFieldName,
  getRhToolboxNodeInfoFieldNodeId,
  getRhToolboxNodeInfoFieldOptions,
  getRhToolboxToolMajorCategory,
  inferRhToolboxUserParamsFromNodeInfoList,
  isRhToolboxBuiltinCategoryId,
  listRhToolboxTools,
  mergeRhToolboxManifests,
  normalizeRhToolboxManifest,
  RH_TOOLBOX_MAJOR_CATEGORIES,
  type RhToolboxInputMapping,
  type RhToolboxTool,
  type RhToolboxUserParam,
} from '../../utils/rhToolbox';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useOrderedMaterials } from './useOrderedMaterials';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import ReuseResultToggle from './ReuseResultToggle';
import MentionPromptInput from './MentionPromptInput';
import { resolveMediaMentions, type MediaMention } from './mediaMentions';
import LoopingVideo from '../LoopingVideo';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import NodeVisible from '../../i18n/NodeVisible';
import ResizableCorners from './ResizableCorners';

const handleStyle: CSSProperties = {
  width: 12,
  height: 12,
  border: 'none',
  zIndex: 20,
};

const STATUS_LABEL: Record<string, string> = {
  idle: '待命',
  submitting: '提交中',
  polling: '运行中',
  success: '已完成',
  error: '失败',
};
const RH_TOOLBOX_DEVELOPER_MODULE = '../../utils/rhToolboxDeveloper';

function capabilityLabel(capability: string): string {
  return RH_TOOLBOX_CAPABILITY_LABELS[capability] || capability;
}

function toolMatchesNodeSurface(tool: RhToolboxTool): boolean {
  return tool.ui?.showInNode !== false;
}

function rhToolboxDisplayIdentity(tool: RhToolboxTool): string {
  const title = String(tool.title || '').trim().replace(/[\s\u200b-\u200f\ufeff]+/g, '').toLowerCase();
  if (title) return `title:${title}`;
  const webappId = String(tool.webappId || '').trim();
  if (webappId) return `webapp:${webappId}`;
  return `id:${tool.id}`;
}

function dedupeRhToolboxDisplayTools(tools: RhToolboxTool[]): RhToolboxTool[] {
  const orderedKeys: string[] = [];
  const byKey = new Map<string, RhToolboxTool>();
  for (const tool of tools) {
    const key = rhToolboxDisplayIdentity(tool);
    if (!byKey.has(key)) orderedKeys.push(key);
    byKey.set(key, tool);
  }
  return orderedKeys.map((key) => byKey.get(key)).filter(Boolean) as RhToolboxTool[];
}

function mediaMentionsForKey(value: unknown): MediaMention[] {
  return Array.isArray(value) ? (value as MediaMention[]) : [];
}

function inputKindLabel(kind: RhToolboxInputMapping['kind']): string {
  if (kind === 'image') return '图像';
  if (kind === 'video') return '视频';
  if (kind === 'audio') return '音频';
  return '文本';
}

function acceptForInputKind(kind: RhToolboxInputMapping['kind']): string {
  if (kind === 'image') return 'image/*';
  if (kind === 'video') return 'video/*';
  if (kind === 'audio') return 'audio/*';
  return '*/*';
}

const RHToolboxNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const updateNodeInternals = useUpdateNodeInternals();
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isLight = theme === 'light';
  const isPixel = themeStyle === 'pixel';
  const hasAutoOutput = useHasAutoOutput(id);
  const d = (data || {}) as any;

  const [manifest, setManifest] = useState(() => normalizeRhToolboxManifest(getRhToolboxManifest()));
  const allTools = useMemo(
    () => dedupeRhToolboxDisplayTools(listRhToolboxTools(manifest, { includeDisabled: true }).filter(toolMatchesNodeSurface)),
    [manifest],
  );
  const enabledTools = useMemo(
    () => allTools.filter((tool) => tool.enabled !== false),
    [allTools],
  );
  const draftTools = useMemo(
    () => allTools.filter((tool) => !tool.enabled),
    [allTools],
  );
  const majorCategoryId = d.rhToolboxMajorCategoryId || RH_TOOLBOX_ALL_CATEGORY_ID;
  const categoryId = d.rhToolboxCategoryId || RH_TOOLBOX_ALL_CATEGORY_ID;
  const query = d.rhToolboxSearchQuery || '';
  const activeToolId = d.rhToolboxActiveToolId || '';
  const baseActiveTool = enabledTools.find((tool) => tool.id === activeToolId);
  const status = d.status || 'idle';
  const remoteBusy = status === 'submitting' || status === 'polling';
  const urls: string[] = Array.isArray(d.urls) ? d.urls : [];
  const imageUrls: string[] = Array.isArray(d.imageUrls) ? d.imageUrls : (d.imageUrl ? [d.imageUrl] : []);
  const videoUrls: string[] = Array.isArray(d.videoUrls) ? d.videoUrls : (d.videoUrl ? [d.videoUrl] : []);
  const audioUrls: string[] = Array.isArray(d.audioUrls) ? d.audioUrls : (d.audioUrl ? [d.audioUrl] : []);
  const outputText = String(d.outputText || '');
  const userParamValues: Record<string, string | number | boolean> = d.rhToolboxUserParams || {};
  const userParamMentions: Record<string, MediaMention[]> = d.rhToolboxUserParamMentions || {};
  const textInputValues: Record<string, string> = d.rhToolboxTextInputs || {};
  const textInputMentions: Record<string, MediaMention[]> = d.rhToolboxTextMentions || {};
  const promptMentions: MediaMention[] = Array.isArray(d.promptMentions) ? d.promptMentions : [];
  const localInputValues: Record<string, string[]> = d.rhToolboxLocalInputs || {};
  const instanceType = d.instanceType || '';
  const [progressMessage, setProgressMessage] = useState('');
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeTaskIdRef = useRef<string>(d.taskId ? String(d.taskId) : '');
  const stopRequestedRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const isBusy = remoteBusy || cancelling;
  const originCanvasIdRef = useRef(useCanvasStore.getState().activeId);
  const executionNodeId = createCanvasNodeExecutionKey(originCanvasIdRef.current, id);
  const runCancelSeq = useRunBusStore((s) => s.cancelSeq);
  const runCancelTargets = useRunBusStore((s) => s.cancelTargets);
  const lastRunCancelSeqRef = useRef(runCancelSeq);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [activeToolAppInfo, setActiveToolAppInfo] = useState<any>(null);
  const activeToolAppInfoFields = useMemo(
    () => (Array.isArray(activeToolAppInfo?.nodeInfoList) ? activeToolAppInfo.nodeInfoList : []),
    [activeToolAppInfo],
  );
  const activeTool = useMemo(() => {
    if (!baseActiveTool) return undefined;
    const resolvedSite: 'cn' | 'intl' = activeToolAppInfo?.rhSite === 'intl' ? 'intl' : (baseActiveTool.rhSite === 'intl' ? 'intl' : 'cn');
    if (!activeToolAppInfoFields.length) {
      return resolvedSite === baseActiveTool.rhSite ? baseActiveTool : { ...baseActiveTool, rhSite: resolvedSite };
    }
    const enrichedParams = (baseActiveTool.userParams || []).map((param) => {
      const matchedField = activeToolAppInfoFields.find((field: any) => (
        getRhToolboxNodeInfoFieldNodeId(field) === String(param.rhNodeId || '').trim().replace(/^#/, '')
        && getRhToolboxNodeInfoFieldName(field) === String(param.fieldName || '').trim()
      ));
      const label = matchedField ? getRhToolboxNodeInfoFieldLabel(matchedField) : '';
      const options = matchedField && param.kind === 'select' ? getRhToolboxNodeInfoFieldOptions(matchedField) : undefined;
      const shouldPatchLabel = !!label
        && label !== param.label
        && (!param.label || param.label === param.fieldName || param.label === param.key || param.label === 'value');
      const shouldPatchOptions = param.kind === 'select' && (!param.options?.length) && !!options?.length;
      if (!shouldPatchLabel && !shouldPatchOptions) return param;
      return {
        ...param,
        ...(shouldPatchLabel ? { label } : {}),
        ...(shouldPatchOptions ? { options } : {}),
      };
    });
    const inferredParams = inferRhToolboxUserParamsFromNodeInfoList(activeToolAppInfoFields, [
      ...(baseActiveTool.inputSchema || []),
      ...enrichedParams,
      ...(baseActiveTool.fixedParams || []),
    ]);
    if (enrichedParams === baseActiveTool.userParams && inferredParams.length === 0) {
      return resolvedSite === baseActiveTool.rhSite ? baseActiveTool : { ...baseActiveTool, rhSite: resolvedSite };
    }
    return {
      ...baseActiveTool,
      rhSite: resolvedSite,
      userParams: [...enrichedParams, ...inferredParams],
    };
  }, [activeToolAppInfo, activeToolAppInfoFields, baseActiveTool]);

  const initialSize = (d?.size && typeof d.size.w === 'number') ? d.size : { w: 360, h: 460 };
  const [size, setSize] = useState<{ w: number; h: number }>(initialSize);

  useEffect(() => {
    let disposed = false;
    const refreshManifest = (event?: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail || {};
      const applyManifest = (nextManifest: ReturnType<typeof normalizeRhToolboxManifest>) => {
        if (disposed) return;
        setManifest(nextManifest);
        if (detail?.kind === 'tool-deleted' && detail.toolId && activeToolId === detail.toolId) {
          update({
            rhToolboxActiveToolId: '',
            rhToolboxSearchQuery: '',
            rhToolboxMajorCategoryId: RH_TOOLBOX_ALL_CATEGORY_ID,
            rhToolboxCategoryId: RH_TOOLBOX_ALL_CATEGORY_ID,
          });
          return;
        }
        if ((detail?.kind === 'tool-saved' || detail?.kind === 'focus-tool') && detail.toolId) {
          const nextTool = nextManifest.tools.find((tool) => tool.id === detail.toolId);
          update({
            rhToolboxSearchQuery: '',
            rhToolboxMajorCategoryId: RH_TOOLBOX_ALL_CATEGORY_ID,
            rhToolboxCategoryId: RH_TOOLBOX_ALL_CATEGORY_ID,
            rhToolboxActiveToolId: nextTool && nextTool.enabled !== false && nextTool.ui?.showInNode !== false ? nextTool.id : '',
            status: 'idle',
            error: nextTool ? '' : '工具已保存，但还不能显示：请检查 WebApp ID、启用状态和节点显示开关',
          });
        }
      };
      const loadManifest = async () => {
        const base = getRhToolboxManifest();
        const persisted = await getRhToolboxPersistentManifest();
        const baseWithPersistent = persisted.success && persisted.data?.manifest
          ? mergeRhToolboxManifests(base, persisted.data.manifest)
          : normalizeRhToolboxManifest(base);
        if (!import.meta.env.DEV) {
          applyManifest(baseWithPersistent);
          return;
        }
        await import(/* @vite-ignore */ RH_TOOLBOX_DEVELOPER_MODULE)
          .then(({ mergeRhToolboxManifestWithDeveloperDrafts }) => {
            applyManifest(mergeRhToolboxManifestWithDeveloperDrafts(baseWithPersistent, detail?.manifest));
          })
          .catch(() => {
            applyManifest(baseWithPersistent);
          });
      };
      loadManifest().catch(() => {
        applyManifest(normalizeRhToolboxManifest(getRhToolboxManifest()));
      });
    };
    refreshManifest();
    window.addEventListener('penguin:rh-toolbox-manifest-updated', refreshManifest);
    const intervalId = import.meta.env.DEV ? window.setInterval(() => refreshManifest(), 1500) : undefined;
    return () => {
      disposed = true;
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener('penguin:rh-toolbox-manifest-updated', refreshManifest);
    };
  }, [activeToolId, update]);

  useEffect(() => {
    let disposed = false;
    setActiveToolAppInfo(null);
    if (!baseActiveTool?.webappId || baseActiveTool.runtime?.fetchAppInfo === false) return () => {
      disposed = true;
    };
    fetchRhAppInfo(baseActiveTool.webappId, baseActiveTool.rhSite === 'intl' ? 'intl' : 'cn')
      .then((info) => {
        if (disposed) return;
        setActiveToolAppInfo(info);
      })
      .catch((error: any) => {
        if (disposed) return;
        logBus.debug(error?.message || '读取 RH NodeList 失败', `rh-toolbox:${id}`);
      });
    return () => {
      disposed = true;
    };
  }, [baseActiveTool?.id, baseActiveTool?.runtime?.fetchAppInfo, baseActiveTool?.webappId]);

  const upstream = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(
    () => normalizeExcludedMaterialIds(d?.excludedMaterialIds),
    [d?.excludedMaterialIds],
  );
  const visibleUpstreamTexts = useMemo(
    () => filterExcludedMaterials(upstream.texts, excludedMaterialIds),
    [upstream.texts, excludedMaterialIds],
  );
  const visibleUpstreamImages = useMemo(
    () => filterExcludedMaterials(upstream.images, excludedMaterialIds),
    [upstream.images, excludedMaterialIds],
  );
  const visibleUpstreamVideos = useMemo(
    () => filterExcludedMaterials(upstream.videos, excludedMaterialIds),
    [upstream.videos, excludedMaterialIds],
  );
  const visibleUpstreamAudios = useMemo(
    () => filterExcludedMaterials(upstream.audios, excludedMaterialIds),
    [upstream.audios, excludedMaterialIds],
  );
  const excludedUpstreamCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstream.texts, ...upstream.images, ...upstream.videos, ...upstream.audios]),
    [excludedMaterialIds, upstream.texts, upstream.images, upstream.videos, upstream.audios],
  );
  const materialOrder: string[] = Array.isArray(d.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const orderedImages = useOrderedMaterials(visibleUpstreamImages, materialOrder);
  const orderedVideos = useOrderedMaterials(visibleUpstreamVideos, materialOrder);
  const orderedAudios = useOrderedMaterials(visibleUpstreamAudios, materialOrder);

  const categoriesForMajor = useMemo(
    () => manifest.categories.filter((category) => (
      !isRhToolboxBuiltinCategoryId(category.id)
      && (
      majorCategoryId === RH_TOOLBOX_ALL_CATEGORY_ID || getRhToolboxCategoryMajorId(category) === majorCategoryId
      )
    )),
    [manifest.categories, majorCategoryId],
  );
  const visibleCategoryId = useMemo(
    () => {
      if (categoryId === RH_TOOLBOX_ALL_CATEGORY_ID) return RH_TOOLBOX_ALL_CATEGORY_ID;
      return categoriesForMajor.some((category) => category.id === categoryId) ? categoryId : RH_TOOLBOX_ALL_CATEGORY_ID;
    },
    [categoriesForMajor, categoryId],
  );
  const filteredTools = useMemo(
    () => dedupeRhToolboxDisplayTools(filterRhToolboxTools(manifest, {
      majorCategoryId,
      categoryId: visibleCategoryId,
      query,
    }).filter(toolMatchesNodeSurface)),
    [manifest, majorCategoryId, visibleCategoryId, query],
  );
  const previewTool = useMemo(
    () => (hoveredToolId ? enabledTools.find((tool) => tool.id === hoveredToolId) : undefined),
    [enabledTools, hoveredToolId],
  );
  const majorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of enabledTools) {
      const majorId = getRhToolboxToolMajorCategory(tool, manifest.categories);
      counts.set(majorId, (counts.get(majorId) || 0) + 1);
    }
    return counts;
  }, [enabledTools, manifest.categories]);
  const majorVisibleToolCount = useMemo(
    () => enabledTools.filter((tool) => (
      majorCategoryId === RH_TOOLBOX_ALL_CATEGORY_ID || getRhToolboxToolMajorCategory(tool, manifest.categories) === majorCategoryId
    )).length,
    [enabledTools, majorCategoryId, manifest.categories],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of enabledTools) {
      const toolMajorId = getRhToolboxToolMajorCategory(tool, manifest.categories);
      if (majorCategoryId !== RH_TOOLBOX_ALL_CATEGORY_ID && toolMajorId !== majorCategoryId) continue;
      counts.set(tool.categoryId, (counts.get(tool.categoryId) || 0) + 1);
    }
    return counts;
  }, [enabledTools, majorCategoryId, manifest.categories]);

  const accent = isPixel ? 'var(--px-ink)' : isLight ? '#0891b2' : '#67e8f9';
  const bg = isPixel ? 'var(--px-surface)' : isLight ? '#ffffff' : 'rgba(18, 24, 27, 0.96)';
  const surface = isPixel ? 'var(--px-muted)' : isLight ? 'rgba(8,145,178,0.08)' : 'rgba(255,255,255,0.06)';
  const surfaceStrong = isPixel ? 'var(--px-yellow)' : isLight ? 'rgba(8,145,178,0.16)' : 'rgba(103,232,249,0.14)';
  const text = isPixel ? 'var(--px-ink)' : isLight ? '#0f172a' : '#e5f7fb';
  const subText = isPixel ? 'var(--px-ink-soft)' : isLight ? '#64748b' : 'rgba(229,247,251,0.62)';
  const border = isPixel ? 'var(--px-ink)' : isLight ? 'rgba(8,145,178,0.24)' : 'rgba(103,232,249,0.22)';
  const errorText = isPixel ? '#dc2626' : '#fca5a5';

  const activeTextInputs = useMemo(
    () => (activeTool?.inputSchema || []).filter((input) => input.kind === 'text'),
    [activeTool],
  );
  const activeMediaInputs = useMemo(
    () => (activeTool?.inputSchema || []).filter((input) => input.kind !== 'text'),
    [activeTool],
  );
  const localMaterials = useMemo(() => {
    const out: { images: Material[]; videos: Material[]; audios: Material[] } = { images: [], videos: [], audios: [] };
    for (const input of activeMediaInputs) {
      const urls = Array.isArray(localInputValues[input.key]) ? localInputValues[input.key].filter(Boolean) : [];
      urls.forEach((url, index) => {
        const material: Material = {
          id: `${id}::rh-local:${input.key}:${index}:${url}`,
          kind: input.kind,
          url,
          sourceNodeId: id,
          origin: 'local',
          label: `${input.label || input.key}${urls.length > 1 ? index + 1 : ''}`,
        };
        if (input.kind === 'image') out.images.push(material);
        else if (input.kind === 'video') out.videos.push(material);
        else if (input.kind === 'audio') out.audios.push(material);
      });
    }
    return out;
  }, [activeMediaInputs, id, localInputValues]);
  const displayImages = useMemo(() => [...localMaterials.images, ...orderedImages], [localMaterials.images, orderedImages]);
  const displayVideos = useMemo(() => [...localMaterials.videos, ...orderedVideos], [localMaterials.videos, orderedVideos]);
  const displayAudios = useMemo(() => [...localMaterials.audios, ...orderedAudios], [localMaterials.audios, orderedAudios]);
  const mentionMaterials = useMemo(
    () => [...displayImages, ...displayVideos, ...displayAudios],
    [displayImages, displayVideos, displayAudios],
  );

  const rootStyle: CSSProperties = {
    background: bg,
    color: text,
    width: size.w,
    height: size.h,
    minWidth: 300,
    minHeight: 340,
    border: `2px solid ${selected ? accent : border}`,
    boxShadow: isPixel ? (selected ? '5px 5px 0 var(--px-ink)' : '3px 3px 0 var(--px-ink)') : 'var(--t8-node-shadow, 0 12px 30px rgba(0,0,0,0.28))',
    borderRadius: isPixel ? 8 : 14,
    overflow: 'visible',
  };

  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const hasTextInputValue = (input: RhToolboxInputMapping): boolean => (
    Object.prototype.hasOwnProperty.call(textInputValues, input.key)
  );
  const textInputValue = (input: RhToolboxInputMapping): string => {
    if (hasTextInputValue(input)) return String(textInputValues[input.key] ?? '');
    if (input.key === 'prompt' && typeof d.prompt === 'string' && d.prompt.length > 0) return d.prompt;
    return input.defaultValue == null ? '' : String(input.defaultValue);
  };
  const textInputMentionsFor = (input: RhToolboxInputMapping): MediaMention[] => {
    const mentions = mediaMentionsForKey(textInputMentions[input.key]);
    if (mentions.length || input.key !== 'prompt' || hasTextInputValue(input)) return mentions;
    return typeof d.prompt === 'string' && d.prompt.length > 0 ? promptMentions : [];
  };
  const setTextInput = (input: RhToolboxInputMapping, value: string, mentions: MediaMention[]) => {
    const patch: Record<string, unknown> = {
      rhToolboxTextInputs: {
        ...textInputValues,
        [input.key]: value,
      },
      rhToolboxTextMentions: {
        ...textInputMentions,
        [input.key]: mentions,
      },
    };
    if (input.key === 'prompt') {
      patch.prompt = value;
      patch.promptMentions = mentions;
    }
    update(patch);
  };
  const setLocalInputUrls = (input: RhToolboxInputMapping, urls: string[]) => {
    update({
      rhToolboxLocalInputs: {
        ...localInputValues,
        [input.key]: urls.filter(Boolean),
      },
    });
  };
  const removeLocalMaterial = (m: Material) => {
    if (m.origin !== 'local') return;
    const input = activeMediaInputs.find((candidate) => m.id.includes(`rh-local:${candidate.key}:`));
    if (!input) return;
    const next = (localInputValues[input.key] || []).filter((url) => url !== m.url);
    setLocalInputUrls(input, next);
  };
  const uploadInputFiles = async (input: RhToolboxInputMapping, files: FileList | null) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) return;
    setProgressMessage(`上传 ${input.label || input.key}...`);
    try {
      const maxItems = Math.max(1, input.multiple ? (input.maxItems || selectedFiles.length) : 1);
      const uploaded = [] as string[];
      for (const file of selectedFiles.slice(0, maxItems)) {
        const result = await uploadFile(file);
        uploaded.push(result.url);
      }
      const prev = input.multiple ? (localInputValues[input.key] || []) : [];
      setLocalInputUrls(input, [...prev, ...uploaded].slice(0, maxItems));
      setProgressMessage(`已上传 ${uploaded.length} 个${inputKindLabel(input.kind)}`);
    } catch (error: any) {
      const message = error?.message || '上传失败';
      update({ status: 'error', error: message });
      setProgressMessage('');
    }
  };
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });
  const collectExplicitInputValues = (): Record<string, string | string[]> => {
    const explicit: Record<string, string | string[]> = {};
    for (const input of activeTextInputs) {
      const value = resolveMediaMentions(textInputValue(input), textInputMentionsFor(input), mentionMaterials).trim();
      if (value) explicit[input.key] = value;
    }
    for (const input of activeMediaInputs) {
      const urls = (localInputValues[input.key] || []).filter(Boolean);
      if (urls.length > 0) explicit[input.key] = input.multiple ? urls : urls[0];
    }
    return explicit;
  };

  const setActiveTool = (tool: RhToolboxTool) => {
    setProgressMessage('');
    const defaultTextInputs = Object.fromEntries(
      tool.inputSchema
        .filter((input) => input.kind === 'text' && input.defaultValue != null && input.defaultValue !== '')
        .map((input) => [input.key, String(input.defaultValue)]),
    );
    const defaultPrompt = String(defaultTextInputs.prompt || '');
    update({
      rhToolboxActiveToolId: tool.id,
      rhToolboxUserParams: {},
      rhToolboxTextInputs: defaultTextInputs,
      rhToolboxTextMentions: {},
      rhToolboxLocalInputs: {},
      instanceType: tool.runtime?.instanceType || '',
      status: 'idle',
      taskId: '',
      urls: [],
      imageUrl: '',
      imageUrls: [],
      videoUrl: '',
      videoUrls: [],
      audioUrl: '',
      audioUrls: [],
      outputText: '',
      prompt: defaultPrompt,
      promptMentions: [],
      promptResolved: defaultPrompt,
      lastPrompt: defaultPrompt,
      error: '',
    });
  };

  const editDeveloperTool = (toolId: string) => {
    if (!import.meta.env.DEV) return;
    import(/* @vite-ignore */ RH_TOOLBOX_DEVELOPER_MODULE)
      .then(({ notifyRhToolboxDeveloperToolEdit }) => notifyRhToolboxDeveloperToolEdit(toolId))
      .catch(() => undefined);
  };

  const setUserParam = (param: RhToolboxUserParam, value: string | number | boolean) => {
    update({
      rhToolboxUserParams: {
        ...userParamValues,
        [param.key]: value,
      },
    });
  };
  const setUserParamText = (param: RhToolboxUserParam, value: string, mentions: MediaMention[]) => {
    update({
      rhToolboxUserParams: {
        ...userParamValues,
        [param.key]: value,
      },
      rhToolboxUserParamMentions: {
        ...userParamMentions,
        [param.key]: mentions,
      },
    });
  };
  const collectResolvedUserParams = (): Record<string, string | number | boolean> => {
    const resolved: Record<string, string | number | boolean> = { ...userParamValues };
    for (const param of activeTool?.userParams || []) {
      if (param.kind !== 'text') continue;
      const value = String(userParamValues[param.key] ?? param.defaultValue ?? '');
      resolved[param.key] = resolveMediaMentions(value, mediaMentionsForKey(userParamMentions[param.key]), mentionMaterials);
    }
    return resolved;
  };

  const handleRun = async (reporter?: RunNodeLifecycleReporter) => {
    if (!activeTool) {
      update({ status: 'error', error: '请先选择 RH工具箱工具' });
      throw new Error('请先选择 RH工具箱工具');
    }
    abortRef.current?.abort();
    const aborter = new AbortController();
    abortRef.current = aborter;
    activeTaskIdRef.current = '';
    setProgressMessage('准备运行...');
    update({
      status: 'submitting',
      error: '',
      taskId: '',
      urls: [],
      imageUrl: '',
      imageUrls: [],
      videoUrl: '',
      videoUrls: [],
      audioUrl: '',
      audioUrls: [],
      outputText: '',
    });
    const source = `rh-toolbox:${id}`;
    await reporter?.providerRequest({ provider: 'runninghub', model: activeTool.id });
    try {
      const explicitInputValues = collectExplicitInputValues();
      const resolvedUserParams = collectResolvedUserParams();
      const runManifest = normalizeRhToolboxManifest({
        ...manifest,
        tools: manifest.tools.map((tool) => (tool.id === activeTool.id ? activeTool : tool)),
      });
      const onProgress = async (progress: RunRhToolboxProgress) => {
        setProgressMessage(progress.message);
        if (progress.taskId) activeTaskIdRef.current = progress.taskId;
        if (progress.taskId && progress.stage !== 'cancel') update({ status: progress.stage === 'poll' ? 'polling' : 'submitting', taskId: progress.taskId });
        const payload = {
          provider: 'runninghub',
          toolId: activeTool.id,
          site: activeTool.rhSite === 'intl' ? 'intl' : 'cn',
          taskId: progress.taskId || null,
          requestId: progress.requestId,
          transportHttpStatus: progress.transportHttpStatus,
          upstreamHttpStatus: progress.upstreamHttpStatus,
          usage: progress.usage,
          httpStatusSource: 'local-backend',
          pollCount: progress.pollCount || null,
          stage: progress.stage,
          message: progress.message,
        };
        if (progress.stage === 'poll') await reporter?.polling(payload);
        else if (progress.stage === 'submit' && progress.taskId) await reporter?.providerSubmitted(payload);
        else await reporter?.progress(payload);
        if (progress.taskId && stopRequestedRef.current) {
          void handleStop();
        }
      };
      const result = await runRhToolboxTool({
        toolId: activeTool.id,
        manifest: runManifest,
        appInfo: activeToolAppInfo,
        inputs: {
          texts: orderedTexts.map((m) => m.url),
          images: orderedImages.map((m) => m.url),
          videos: orderedVideos.map((m) => m.url),
          audios: orderedAudios.map((m) => m.url),
        },
        inputValues: explicitInputValues,
        userParams: resolvedUserParams,
        instanceType,
        signal: aborter.signal,
        submissionKey: reporter?.providerSubmissionKey,
        onProgress,
      });
      const textOutputs = result.textOutputs.filter(Boolean);
      const textValue = textOutputs.join('\n\n');
      activeTaskIdRef.current = '';
      await reporter?.providerResponse({
        provider: 'runninghub',
        model: activeTool.id,
        upstreamTaskId: result.taskId,
        requestId: result.requestId,
        transportHttpStatus: result.transportHttpStatus,
        upstreamHttpStatus: result.upstreamHttpStatus,
        usage: result.usage,
        status: 'succeeded',
        httpStatusSource: 'local-backend',
      });
      update({
        status: 'success',
        taskId: result.taskId,
        urls: result.urls,
        imageUrls: result.imageUrls,
        imageUrl: result.imageUrls[0] || '',
        videoUrls: result.videoUrls,
        videoUrl: result.videoUrls[0] || '',
        audioUrls: result.audioUrls,
        audioUrl: result.audioUrls[0] || '',
        outputText: textValue,
        text: textValue,
        prompt: textValue || String(explicitInputValues.prompt || ''),
        promptResolved: String(explicitInputValues.prompt || ''),
        lastPrompt: String(explicitInputValues.prompt || ''),
        texts: textOutputs,
        textSegments: textOutputs,
        raw: result.raw,
        provider: 'runninghub',
        model: activeTool.id,
        requestId: result.requestId,
        transportHttpStatus: result.transportHttpStatus,
        upstreamHttpStatus: result.upstreamHttpStatus,
        usage: result.usage,
        error: '',
      });
      setProgressMessage(`完成 · ${result.urls.length} 个输出`);
      logBus.success(`${activeTool.title} 完成 · ${result.urls.length} 个输出`, source);
    } catch (error: any) {
      const message = error?.message || 'RH工具箱运行失败';
      await reporter?.providerResponse({
        provider: 'runninghub',
        model: activeTool.id,
        upstreamTaskId: activeTaskIdRef.current || undefined,
        requestId: error?.requestId,
        transportHttpStatus: error?.transportHttpStatus,
        upstreamHttpStatus: error?.upstreamHttpStatus,
        status: aborter.signal.aborted ? 'stopped' : 'failed',
        error: { message, code: error?.code },
        httpStatusSource: 'local-backend',
      });
      if (aborter.signal.aborted && !/取消 RH 后台任务失败/.test(message)) {
        activeTaskIdRef.current = '';
        stopRequestedRef.current = false;
        update({ status: 'idle', error: '', taskId: '' });
        setProgressMessage('已停止');
        logBus.warn(`${activeTool.title} 已停止`, source);
        return;
      }
      if (/取消 RH 后台任务失败/.test(message)) {
        const tid = activeTaskIdRef.current || String(d.taskId || '');
        stopRequestedRef.current = false;
        update({ status: tid ? 'polling' : 'error', taskId: tid, error: message });
        setProgressMessage(message);
        logBus.error(message, source);
        return;
      }
      activeTaskIdRef.current = '';
      stopRequestedRef.current = false;
      update({ status: 'error', error: message });
      setProgressMessage('');
      logBus.error(message, source);
      throw error;
    }
  };

  const handleStop = async () => {
    stopRequestedRef.current = true;
    const tid = String(activeTaskIdRef.current || d.taskId || '').trim();
    const source = `rh-toolbox:${id}`;
    if (!tid) {
      setProgressMessage('等待 RH taskId，拿到后会立即取消后台任务');
      update({ error: '正在等待 RH taskId，拿到后会立即取消后台任务' });
      logBus.warn('用户主动停止：等待 RH 返回 taskId 后再取消后台任务', source);
      return;
    }
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setCancelling(true);
    setProgressMessage('正在请求取消 RH 后台任务...');
    update({ taskId: tid, error: '正在请求取消 RH 后台任务...' });
    logBus.warn(`用户主动停止，正在请求取消 RH 后台任务 taskId=${tid}`, source);
    try {
      await cancelRh(tid, activeTool?.rhSite === 'intl' ? 'intl' : 'cn');
      logBus.success(`已请求取消 RH 后台任务 taskId=${tid}`, source);
      abortRef.current?.abort();
      abortRef.current = null;
      activeTaskIdRef.current = '';
      stopRequestedRef.current = false;
      update({ status: 'idle', error: '', taskId: '' });
      setProgressMessage('已停止');
    } catch (error: any) {
      const message = `取消 RH 后台任务失败：${error?.message || error}`;
      logBus.error(message, source);
      update({ status: remoteBusy ? status : 'polling', taskId: tid, error: message });
      setProgressMessage(message);
    } finally {
      cancelInFlightRef.current = false;
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (runCancelSeq === lastRunCancelSeqRef.current) return;
    lastRunCancelSeqRef.current = runCancelSeq;
    if (!runCancelTargets.includes(executionNodeId)) return;
    if (!isBusy && !d.taskId && !activeTaskIdRef.current) return;
    handleStop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCancelSeq, runCancelTargets, executionNodeId, isBusy, d.taskId]);

  useRunTrigger(id, async (reporter) => {
    if (isBusy) return;
    await handleRun(reporter);
  }, undefined, {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => shouldReuseGenerationResult('rh-toolbox', nodeData),
  });

  const onResize = (_event: any, params: { width: number; height: number }) => {
    const next = { w: Math.round(params.width), h: Math.round(params.height) };
    setSize(next);
    update({ size: next });
    updateNodeInternals(id);
  };

  const renderHeader = () => (
    <div
      className="flex items-center gap-2 px-3 py-2 shrink-0"
      style={{
        borderBottom: `1px solid ${border}`,
        background: isPixel ? 'var(--px-surface)' : activeTool ? `${accent}1c` : surface,
        borderRadius: isPixel ? '6px 6px 0 0' : '12px 12px 0 0',
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 28,
          height: 28,
          borderRadius: isPixel ? 6 : 8,
          background: surfaceStrong,
          color: accent,
          border: isPixel ? `2px solid ${border}` : `1px solid ${border}`,
        }}
      >
        <Wrench size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold leading-tight truncate" style={{ fontSize: 15 }}>RH工具箱</div>
        <div className="text-[10px] truncate" style={{ color: subText }}>
          {activeTool ? `${activeTool.title} · ${activeTool.rhSite === 'intl' ? '海外站' : '国内站'} · ${activeTool.capabilities.map(capabilityLabel).join(' / ')}` : '维护者精选 RunningHub 工具'}
        </div>
      </div>
      {status !== 'idle' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: accent, background: surface, border: `1px solid ${border}` }}>
          {STATUS_LABEL[status] || status}
        </span>
      )}
    </div>
  );

  const renderLauncher = () => (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 shrink-0 space-y-2" style={{ borderBottom: `1px solid ${border}` }}>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded nodrag" style={{ background: surface, border: `1px solid ${border}` }} onMouseDown={(e) => e.stopPropagation()}>
          <Search size={13} style={{ color: subText }} />
          <input
            value={query}
            onChange={(e) => update({ rhToolboxSearchQuery: e.target.value })}
            placeholder="搜索工具 / 能力..."
            className="nodrag nowheel flex-1 bg-transparent outline-none text-xs"
            style={{ color: text }}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto nodrag nowheel" onMouseDown={(e) => e.stopPropagation()}>
          {[{ id: RH_TOOLBOX_ALL_CATEGORY_ID, name: '全部' }, ...RH_TOOLBOX_MAJOR_CATEGORIES].map((category) => {
            const active = majorCategoryId === category.id;
            const count = category.id === RH_TOOLBOX_ALL_CATEGORY_ID ? enabledTools.length : majorCounts.get(category.id) || 0;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => update({ rhToolboxMajorCategoryId: category.id, rhToolboxCategoryId: RH_TOOLBOX_ALL_CATEGORY_ID })}
                className="nodrag shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                style={{
                  background: active ? accent : surface,
                  color: active ? (isPixel ? 'var(--px-surface)' : '#001018') : text,
                  border: `1px solid ${active ? accent : border}`,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {category.name} {count}
              </button>
            );
          })}
        </div>
        {categoriesForMajor.length > 0 && (
          <div className="flex gap-1 overflow-x-auto nodrag nowheel" onMouseDown={(e) => e.stopPropagation()}>
            {[{ id: RH_TOOLBOX_ALL_CATEGORY_ID, name: '全部' }, ...categoriesForMajor].map((category) => {
              const active = visibleCategoryId === category.id;
              const count = category.id === RH_TOOLBOX_ALL_CATEGORY_ID
                ? majorVisibleToolCount
                : categoryCounts.get(category.id) || 0;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => update({ rhToolboxCategoryId: category.id })}
                  className="nodrag shrink-0 rounded px-2 py-0.5 text-[10px]"
                  style={{
                    background: active ? surfaceStrong : bg,
                    color: active ? accent : subText,
                    border: `1px solid ${active ? accent : border}`,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {category.name} {count}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 nodrag nowheel" onMouseDown={(e) => e.stopPropagation()}>
        {enabledTools.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-4" style={{ color: subText }}>
            <Sparkles size={22} />
            <div className="text-xs font-semibold" style={{ color: text }}>暂未发布工具</div>
            <div className="text-[11px] leading-relaxed">
              当前 manifest 有 {allTools.length} 个工具，其中 {enabledTools.length} 个可见、{draftTools.length} 个待配置。填写真实 WebApp ID 并启用后，会自动出现在这里。
            </div>
          </div>
        ) : filteredTools.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px]" style={{ color: subText }}>无匹配工具</div>
        ) : (
          <div
            className="rh-toolbox-app-grid grid grid-cols-1 gap-2"
            style={{
              '--rh-toolbox-app-bg': bg,
              '--rh-toolbox-app-hover-bg': surface,
              '--rh-toolbox-app-text': text,
              '--rh-toolbox-app-border': border,
            } as CSSProperties}
          >
            {filteredTools.map((tool) => (
              <div key={tool.id} className="relative group">
                <button
                  type="button"
                  onClick={() => setActiveTool(tool)}
                  onMouseEnter={() => setHoveredToolId(tool.id)}
                  onMouseLeave={() => setHoveredToolId((prev) => (prev === tool.id ? null : prev))}
                  title={tool.description || tool.title}
                  className="nodrag rh-toolbox-app-button"
                >
                  <span className="rh-toolbox-app-title">{tool.title}</span>
                </button>
                {import.meta.env.DEV && (
                  <button
                    type="button"
                    title="载入制作器编辑名称和分类"
                    onClick={(event) => {
                      event.stopPropagation();
                      editDeveloperTool(tool.id);
                    }}
                    className="nodrag rh-toolbox-app-edit-button opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <Pencil size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className="px-3 py-2 shrink-0"
        style={{ borderTop: `1px solid ${border}`, minHeight: 50, background: surface }}
      >
        {previewTool ? (
          <div>
            <div className="text-[11px] font-bold truncate" style={{ color: accent }}>
              <Sparkles size={11} className="inline-block mr-1 align-[-2px]" />
              {previewTool.title}
            </div>
            <div className="text-[10px] mt-0.5 line-clamp-2" style={{ color: subText, lineHeight: 1.35 }}>
              {previewTool.description || previewTool.capabilities.map(capabilityLabel).join(' / ') || `WebApp ${previewTool.webappId}`}
            </div>
          </div>
        ) : (
          <div className="text-[10px] leading-relaxed" style={{ color: subText }}>
            悬停工具查看说明，点击进入 · 共 {enabledTools.length} 个可用工具
          </div>
        )}
      </div>
    </div>
  );

  const renderUserParam = (param: RhToolboxUserParam) => {
    const value = userParamValues[param.key] ?? param.defaultValue ?? (param.kind === 'boolean' ? false : '');
    const commonStyle: CSSProperties = {
      width: '100%',
      background: surface,
      color: text,
      border: `1px solid ${border}`,
      borderRadius: 6,
      padding: '5px 7px',
      fontSize: 11,
      outline: 'none',
    };
    if (param.kind === 'boolean') {
      return (
        <label key={param.key} className="flex items-center gap-2 text-[11px] nodrag" style={{ color: text }}>
          <input
            type="checkbox"
            checked={value === true || value === 'true'}
            onChange={(e) => setUserParam(param, e.target.checked)}
            style={{ accentColor: String(accent) }}
          />
          {param.label}
        </label>
      );
    }
    if (param.kind === 'select') {
      return (
        <label key={param.key} className="block text-[10px] space-y-1" style={{ color: subText }}>
          <span>{param.label}</span>
          <select
            value={String(value)}
            onChange={(e) => setUserParam(param, e.target.value)}
            className="nodrag nowheel"
            style={commonStyle}
          >
            {(param.options || []).map((option) => (
              <option key={String(option)} value={String(option)}>{String(option)}</option>
            ))}
          </select>
        </label>
      );
    }
    if (param.kind === 'text') {
      return (
        <div key={param.key} className="block text-[10px] space-y-1" style={{ color: subText }}>
          <span>{param.label}</span>
          <MentionPromptInput
            title={`RH工具箱 · ${param.label}`}
            value={String(value)}
            mentions={mediaMentionsForKey(userParamMentions[param.key])}
            materials={mentionMaterials}
            placeholder={param.placeholder}
            onChange={(nextValue, mentions) => setUserParamText(param, nextValue, mentions)}
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="image"
            className="nodrag nowheel"
            style={{
              ...commonStyle,
              minHeight: 54,
              paddingRight: 64,
            }}
          />
        </div>
      );
    }
    return (
      <label key={param.key} className="block text-[10px] space-y-1" style={{ color: subText }}>
        <span>{param.label}</span>
        <input
          type={param.kind === 'number' ? 'number' : 'text'}
          value={String(value)}
          min={param.min}
          max={param.max}
          step={param.step}
          placeholder={param.placeholder}
          onChange={(e) => setUserParam(param, param.kind === 'number' ? Number(e.target.value) : e.target.value)}
          className="nodrag nowheel"
          style={commonStyle}
        />
      </label>
    );
  };

  const renderRunner = () => {
    if (!activeTool) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-5" style={{ color: subText }}>
          <AlertCircle size={22} />
          <div className="text-xs">当前工具不可用或已被禁用</div>
          <button type="button" onClick={() => update({ rhToolboxActiveToolId: '' })} className="nodrag text-xs px-3 py-1 rounded" style={{ background: surface, color: text, border: `1px solid ${border}` }}>
            返回工具列表
          </button>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 shrink-0 flex items-center gap-2" style={{ borderBottom: `1px solid ${border}` }}>
          <button
            type="button"
            onClick={() => update({ rhToolboxActiveToolId: '' })}
            className="nodrag flex items-center gap-1 rounded px-2 py-1 text-[11px]"
            style={{ background: surface, color: text, border: `1px solid ${border}` }}
          >
            <ArrowLeft size={12} /> 列表
          </button>
          <div className="flex-1 min-w-0 text-[10px] truncate" style={{ color: subText }}>
            {activeTool.inputSchema.map((input) => `${input.label || input.key}:${input.kind}`).join(' · ')}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 nodrag nowheel" onMouseDown={(e) => e.stopPropagation()}>
          {activeTextInputs.length > 0 && (
            <div className="space-y-2 rounded-lg p-2" style={{ background: surface, border: `1px solid ${border}` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[11px] font-bold" style={{ color: text }}>
                  <Sparkles size={12} /> Prompt
                </div>
                {orderedTexts.length > 0 && (
                  <span className="text-[10px]" style={{ color: subText }}>本地为空时使用上游文本</span>
                )}
              </div>
              {activeTextInputs.map((input) => (
                <div key={input.key} className="block text-[10px] space-y-1" style={{ color: subText }}>
                  <span>{input.label || input.key}{input.required !== false ? '' : '（可选）'}</span>
                  <MentionPromptInput
                    title={`RH工具箱 · ${input.label || input.key}`}
                    value={textInputValue(input)}
                    mentions={textInputMentionsFor(input)}
                    materials={mentionMaterials}
                    onChange={(nextValue, mentions) => setTextInput(input, nextValue, mentions)}
                    placeholder={input.defaultValue || '输入提示词，也可以 @ 引用上游图片、视频、音频'}
                    isDark={isDark}
                    isPixel={isPixel}
                    promptTemplateKind="image"
                    className="nodrag nowheel"
                    style={{
                      width: '100%',
                      minHeight: 72,
                      background: surface,
                      color: text,
                      border: `1px solid ${border}`,
                      borderRadius: 6,
                      padding: '7px 64px 7px 8px',
                      fontSize: 11,
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          {activeMediaInputs.length > 0 && (
            <div className="space-y-2 rounded-lg p-2" style={{ background: surface, border: `1px solid ${border}` }}>
              <div className="flex items-center gap-1 text-[11px] font-bold" style={{ color: text }}>
                <Layers size={12} /> 素材输入
              </div>
              {activeMediaInputs.map((input) => {
                const localUrls = (localInputValues[input.key] || []).filter(Boolean);
                const Icon = input.kind === 'image' ? ImageIcon : input.kind === 'video' ? VideoIcon : Music;
                const upstreamCount = input.kind === 'image' ? orderedImages.length : input.kind === 'video' ? orderedVideos.length : orderedAudios.length;
                return (
                  <div key={input.key} className="rounded-md p-2 space-y-1.5" style={{ background: bg, border: `1px solid ${border}` }}>
                    <div className="flex items-center gap-1.5 text-[10px]" style={{ color: subText }}>
                      <Icon size={12} style={{ color: accent }} />
                      <span className="font-bold" style={{ color: text }}>{input.label || input.key}</span>
                      <span>{inputKindLabel(input.kind)}{input.multiple ? ` · 最多 ${input.maxItems || '多'} 个` : ''}</span>
                      {input.required === false && <span>可选</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="nodrag flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold"
                        style={{ background: surfaceStrong, color: text, border: `1px solid ${border}`, boxShadow: 'none' }}
                        onClick={() => fileInputRefs.current[input.key]?.click()}
                      >
                        <Upload size={11} /> 上传{inputKindLabel(input.kind)}
                      </button>
                      <input
                        ref={(el) => {
                          fileInputRefs.current[input.key] = el;
                        }}
                        type="file"
                        className="hidden"
                        accept={acceptForInputKind(input.kind)}
                        multiple={input.multiple}
                        onChange={(event) => {
                          void uploadInputFiles(input, event.currentTarget.files);
                          event.currentTarget.value = '';
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: subText }}>
                        {localUrls.length > 0
                          ? `已本地指定 ${localUrls.length} 个`
                          : upstreamCount > 0
                          ? `未上传时自动使用上游 ${inputKindLabel(input.kind)}`
                          : `也可以从左侧接入上游 ${inputKindLabel(input.kind)}`}
                      </span>
                      {localUrls.length > 0 && (
                        <button
                          type="button"
                          className="nodrag rounded p-1"
                          title="清空本地指定素材"
                          style={{ color: errorText, border: `1px solid ${border}`, boxShadow: 'none' }}
                          onClick={() => setLocalInputUrls(input, [])}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <MaterialPreviewSection
            texts={orderedTexts}
            images={displayImages}
            videos={displayVideos}
            audios={displayAudios}
            order={materialOrder}
            onReorder={setMaterialOrder}
            onRemoveLocal={removeLocalMaterial}
            onExcludeUpstream={handleExcludeUpstreamMaterial}
            excludedCount={excludedUpstreamCount}
            onRestoreExcluded={handleRestoreExcludedMaterials}
            isDark={isDark}
            isPixel={isPixel}
            title="上游素材 · 工具输入"
          />
          {(activeTool.userParams || []).length > 0 && (
            <div className="space-y-2 rounded-lg p-2" style={{ background: surface, border: `1px solid ${border}` }}>
              <div className="flex items-center gap-1 text-[11px] font-bold" style={{ color: text }}>
                <Layers size={12} /> 参数
              </div>
              {(activeTool.userParams || []).map(renderUserParam)}
            </div>
          )}
          <label className="block text-[10px] space-y-1" style={{ color: subText }}>
            <span>实例类型</span>
            <select
              value={instanceType}
              onChange={(e) => update({ instanceType: e.target.value })}
              className="nodrag nowheel"
              style={{ width: '100%', background: surface, color: text, border: `1px solid ${border}`, borderRadius: 6, padding: '5px 7px', fontSize: 11 }}
            >
              <option value="">默认</option>
              <option value="plus">plus</option>
              <option value="pro">pro</option>
            </select>
          </label>

          <ReuseResultToggle
            checked={d?.reuseResult === true}
            hasResult={hasReusableGenerationResult('rh-toolbox', d)}
            onChange={(checked) => update({ reuseResult: checked })}
            accentColor={accent}
          />

          {isBusy ? (
            <button type="button" onClick={handleStop} className="nodrag w-full flex items-center justify-center gap-1.5 rounded py-2 text-xs font-bold" style={{ background: surface, color: text, border: `1px solid ${border}` }}>
              <Square size={12} /> {cancelling ? '取消中...' : '停止'}
            </button>
          ) : (
            <button type="button" onClick={() => requestCanvasNodeRun(id)} className="nodrag w-full flex items-center justify-center gap-1.5 rounded py-2 text-xs font-bold" style={{ background: accent, color: isPixel ? 'var(--px-surface)' : '#001018', border: `1px solid ${accent}` }}>
              <Play size={12} fill="currentColor" /> 运行工具
            </button>
          )}

          {progressMessage && (
            <div className="flex items-center gap-1 text-[10px]" style={{ color: accent }}>
              {isBusy && <Loader2 size={11} className="animate-spin" />}
              <span className="flex-1">{progressMessage}</span>
              {d.taskId && <span style={{ color: subText }}>{String(d.taskId).slice(0, 10)}…</span>}
            </div>
          )}

          {d.error && (
            <div className="flex items-start gap-1 rounded px-2 py-1 text-[10px]" style={{ color: errorText, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}>
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span className="break-all">{d.error}</span>
            </div>
          )}

          {!hasAutoOutput && (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0 || outputText) && (
            <div className="space-y-2 pt-2" style={{ borderTop: `1px solid ${border}` }}>
              {imageUrls.map((url, index) => <SmartImage key={`${url}-${index}`} src={url} alt="RH工具箱输出" className="w-full rounded object-contain" thumbSize={720} />)}
              {videoUrls.map((url, index) => <LoopingVideo key={`${url}-${index}`} src={url} controls className="w-full rounded" />)}
              {audioUrls.map((url, index) => <LazyAudio key={`${url}-${index}`} src={url} controls className="w-full h-8" />)}
              {outputText && <div data-provider-content className="rounded p-2 text-[11px] whitespace-pre-wrap" style={{ background: surface, border: `1px solid ${border}`, color: text }}>{outputText}</div>}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <NodeVisible>
      <div className="relative flex flex-col" style={rootStyle}>
      <Handle type="target" position={Position.Left} className="!border-0" style={{ ...handleStyle, background: PORT_COLOR.any, left: -6 }} />
      <Handle type="source" position={Position.Right} className="!border-0" style={{ ...handleStyle, background: PORT_COLOR.any, right: -6 }} />
      <ResizableCorners
        selected={selected}
        minWidth={300}
        minHeight={340}
        accent={String(accent)}
        onResize={onResize}
        onResizeEnd={onResize}
      />
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ borderRadius: isPixel ? 6 : 12 }}>
        {renderHeader()}
        {activeToolId ? renderRunner() : renderLauncher()}
      </div>
      </div>
    </NodeVisible>
  );
};

export default memo(RHToolboxNode);
