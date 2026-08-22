import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, Loader2, Film, Sparkles, Square, X } from 'lucide-react';
import {
  generateExternalVideo,
  submitSeedance,
  querySeedance,
  type SeedanceSubmitRequest,
  type SeedanceTaskProvider,
} from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { logBus } from '../../stores/logs';
import { useThemeStore } from '../../stores/theme';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import ReuseResultToggle from './ReuseResultToggle';
import MentionPromptInput from './MentionPromptInput';
import LoopingVideo from '../LoopingVideo';
import SmartImage from '../SmartImage';
import { resolveMediaMentions, type MediaMention } from './mediaMentions';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useApiKeysStore } from '../../stores/apiKeys';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import { LocalNodeAddonSlot } from 'virtual:t8-local-extensions';
import {
  LEGACY_SEEDANCE_MODEL_OPTIONS as MODEL_OPTIONS,
  LEGACY_SEEDANCE_RATIO_OPTIONS as RATIO_OPTIONS,
  LEGACY_SEEDANCE_RESOLUTION_OPTIONS as RESOLUTION_OPTIONS,
  SEEDANCE_DURATION_OPTIONS as DURATION_OPTIONS,
  SEEDANCE_NZ_DURATION_OPTIONS,
  SEEDANCE_NZ_MODEL_OPTIONS,
  SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS,
  SEEDANCE_NZ_RATIO_OPTIONS,
  SEEDANCE_NZ_RESOLUTION_OPTIONS,
  SEEDANCE25_DURATION_OPTIONS,
  SEEDANCE25_DEFAULT_DURATION,
  SEEDANCE25_DEFAULT_RESOLUTION,
  SEEDANCE25_MULTI_MAX_AUDIOS,
  SEEDANCE25_MULTI_MAX_IMAGES,
  SEEDANCE25_MULTI_MAX_TOTAL,
  SEEDANCE25_MULTI_MAX_VIDEOS,
  SEEDANCE25_MODEL_OPTIONS,
  SEEDANCE25_RATIO_OPTIONS,
  SEEDANCE25_RESOLUTION_OPTIONS,
  isSeedanceBuiltinSource,
  isSeedanceNzStandardModel,
  seedance25TaskType,
  type SeedanceBuiltinSource,
} from '../../config/seedance';
import JimengCliHelpButton from './JimengCliHelpButton';
import {
  JIMENG_CLI_MULTIFRAME,
  JIMENG_CLI_SEEDANCE20_LIMITS,
  JIMENG_CLI_SEEDANCE25_LIMITS,
  JIMENG_CLI_SUPPORTED_VERSION,
  isJimengSeedance25Model,
  jimengSeedanceDurationOptions,
  jimengSeedanceResolutionOptions,
} from '../../config/jimengCli';

/**
 * SeedanceNode — 字节 Seedance 2.0 视频分镜节点
 * 完全对齐 gpt-image-2-web runSeedance / pollSeedance:
 *   - 上游 endpoint: /seedance/v3/contents/generations/tasks
 *   - 模型: doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128 / doubao-seedance-2.0-mini
 *   - content[]: text + image_url(role=first_frame|last_frame|reference_image)
 *                + video_url(role=reference_video) + audio_url(role=reference_audio)
 *   - 参数: duration / ratio / resolution / generate_audio / return_last_frame
 *           / watermark / web_search(tools) / seed
 *   - 轮询: 默认 10s 间隔, 最少覆盖 3600s
 *
 * 上游连接(支持的输入):
 *   - text 节点 → prompt
 *   - image 节点 / upload 节点 → reference_image
 *   - 多张同时可用作 first_frame / last_frame (UI 中按顺序取第 1、2 张)
 */

const SEEDANCE_POLL_TIMEOUT_SECONDS = 3600;
type SeedanceFrameMode = 'auto' | 'first' | 'firstlast' | 'multiframe';
const seedanceMinPollCount = (intervalMs: number) =>
  Math.ceil((SEEDANCE_POLL_TIMEOUT_SECONDS * 1000) / Math.max(1, intervalMs));

const SeedanceNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollRejectRef = useRef<((reason?: any) => void) | null>(null);
  const generationRunRef = useRef(0);
  const src = `seedance:${id.slice(0, 6)}`;

  // 主题适配
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';

  const d = (data as any) || {};
  const isSeedance25 = d?.seedance25Variant === true;
  const providerParams = (d?.providerParams && typeof d.providerParams === 'object') ? d.providerParams : {};
  const advancedProviders = useApiKeysStore((s) => s.settings.advancedProviders);
  const hasSeedanceNzKey = useApiKeysStore((s) => !!String(s.settings.zhenzhenSd2ApiKey || '').trim());
  const videoAdvancedProviders = useMemo(
    () => advancedProvidersForNode(advancedProviders, 'video'),
    [advancedProviders],
  );
  const providerSelection = useMemo(
    () => resolveAdvancedProviderSelection(advancedProviders, 'video', {
      providerSource: d?.providerSource,
      providerId: d?.providerId,
      providerModel: d?.providerModel,
    }),
    [advancedProviders, d?.providerSource, d?.providerId, d?.providerModel],
  );
  const isExternalSelected = !isSeedance25 && providerSelection.available && providerSelection.providerSource !== 'zhenzhen';
  const isJimengCliSelected = isExternalSelected && providerSelection.provider?.protocol === 'jimeng-cli';
  const savedExternalMissing = !!d?.providerSource && d.providerSource !== 'zhenzhen' && !providerSelection.available;
  const externalModelOptions = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'video')
    : [];
  const externalProviderModel = providerSelection.providerModel || externalModelOptions[0] || '';
  const isJimengSeedance25 = isJimengCliSelected && isJimengSeedance25Model(externalProviderModel);
  const jimengSeedanceLimits = isJimengSeedance25
    ? JIMENG_CLI_SEEDANCE25_LIMITS
    : JIMENG_CLI_SEEDANCE20_LIMITS;
  const savedBuiltinSource = String(d?.seedanceApiSource || '');
  const builtinSource: SeedanceBuiltinSource = isSeedance25
    ? 'seedance-nz'
    : isSeedanceBuiltinSource(savedBuiltinSource)
    ? savedBuiltinSource
    : 'zhenzhen-legacy';
  const effectiveTaskProvider: Exclude<SeedanceTaskProvider, 'auto'> = builtinSource === 'auto'
    ? (hasSeedanceNzKey ? 'seedance-nz' : 'zhenzhen-legacy')
    : builtinSource;
  const isSeedanceNzSelected = !isExternalSelected && effectiveTaskProvider === 'seedance-nz';
  const model: string = d.model || MODEL_OPTIONS[0].value;
  const seedanceNzModel: string = isSeedance25
    ? (SEEDANCE25_MODEL_OPTIONS.some((item) => item.value === d.model)
      ? d.model
      : 'seedance-2.5-global-standard-i2v')
    : d.seedanceNzModel || 'fast';
  const duration: number = typeof d.duration === 'number' ? d.duration : isSeedance25 ? SEEDANCE25_DEFAULT_DURATION : 5;
  const ratio: string = d.ratio || (isSeedance25 ? 'adaptive' : '16:9');
  const resolution: string = d.resolution || (isSeedance25 ? SEEDANCE25_DEFAULT_RESOLUTION : '480p');
  const generateAudio: boolean = d.generateAudio !== false; // 默认 true
  const returnLastFrame: boolean = d.returnLastFrame === true;
  const watermark: boolean = d.watermark === true;
  const webSearch: boolean = d.webSearch === true;
  const seed: number = typeof d.seed === 'number' ? d.seed : -1;
  const maxPoll: number = typeof d.maxPoll === 'number' ? d.maxPoll : 360;
  const pollInt: number = typeof d.pollInt === 'number' ? d.pollInt : 10;
  // 首/末帧使用模式: Jimeng CLI additionally supports explicit intelligent multi-frame.
  const rawFrameMode = String(d.frameMode || 'auto');
  const frameMode: SeedanceFrameMode = (
    rawFrameMode === 'first'
    || rawFrameMode === 'firstlast'
    || rawFrameMode === 'multiframe'
  ) ? rawFrameMode : 'auto';
  const activeFrameMode: SeedanceFrameMode = (
    (!isJimengCliSelected || isJimengSeedance25) && frameMode === 'multiframe'
  ) ? 'auto' : frameMode;
  const builtinModel = isSeedanceNzSelected ? seedanceNzModel : model;
  const seedance25Mode = seedance25TaskType(builtinModel);
  const activeRatioOptions = isSeedance25 ? SEEDANCE25_RATIO_OPTIONS : isSeedanceNzSelected ? SEEDANCE_NZ_RATIO_OPTIONS : RATIO_OPTIONS;
  const activeDurationOptions = isSeedance25
    ? SEEDANCE25_DURATION_OPTIONS
    : isJimengCliSelected
      ? jimengSeedanceDurationOptions(externalProviderModel)
      : isSeedanceNzSelected ? SEEDANCE_NZ_DURATION_OPTIONS : DURATION_OPTIONS;
  const seedanceNzIsStandard = isSeedanceNzStandardModel(seedanceNzModel);
  const activeResolutionOptions = isSeedance25
    ? SEEDANCE25_RESOLUTION_OPTIONS
    : isJimengCliSelected
    ? jimengSeedanceResolutionOptions(externalProviderModel, activeFrameMode === 'multiframe')
    : isSeedanceNzSelected
      ? (seedanceNzIsStandard ? SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS : SEEDANCE_NZ_RESOLUTION_OPTIONS)
      : RESOLUTION_OPTIONS;
  const builtinRatio = activeRatioOptions.includes(ratio as any) ? ratio : isSeedance25 ? 'adaptive' : '16:9';
  const builtinResolution = activeResolutionOptions.includes(resolution as any) ? resolution : '720p';
  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d.status || 'idle';
  const taskId: string | undefined = d.taskId;
  const videoUrl: string | undefined = d.videoUrl;
  const progress: string = d.progress || '';
  const localPrompt: string = d.prompt || '';
  const promptMentions: MediaMention[] = Array.isArray(d?.promptMentions) ? d.promptMentions : [];

  // === 上游素材聚合 (跨节点统一机制) ===
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
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const orderedImages = useOrderedMaterials(visibleUpstreamImages, materialOrder);
  const orderedVideos = useOrderedMaterials(visibleUpstreamVideos, materialOrder);
  const orderedAudios = useOrderedMaterials(visibleUpstreamAudios, materialOrder);
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });

  // === 本地拖入参考素材 (跨节点 Ctrl 拖拽) ===
  const localRefImages: string[] = Array.isArray(d?.localRefImages) ? d.localRefImages : [];
  const localRefVideos: string[] = Array.isArray(d?.localRefVideos) ? d.localRefVideos : [];
  const localRefAudios: string[] = Array.isArray(d?.localRefAudios) ? d.localRefAudios : [];
  const localRefMaterials: Material[] = useMemo(
    () => [
      ...localRefImages.map((url, i) => ({
        id: `local::seedance-image:${url}`,
        kind: 'image' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地图片${i + 1}`,
      })),
      ...localRefVideos.map((url, i) => ({
        id: `local::seedance-video:${url}`,
        kind: 'video' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地视频${i + 1}`,
      })),
      ...localRefAudios.map((url, i) => ({
        id: `local::seedance-audio:${url}`,
        kind: 'audio' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地音频${i + 1}`,
      })),
    ],
    [localRefImages, localRefVideos, localRefAudios, id],
  );
  const mentionMaterials = useMemo(
    () => [...orderedImages, ...orderedVideos, ...orderedAudios, ...localRefMaterials],
    [orderedImages, orderedVideos, orderedAudios, localRefMaterials],
  );

  // 收集上游 prompt + 参考图 + 参考视频 + 参考音频 (按用户拖拽顺序), 并合并本地拖入素材
  const collectUpstream = (): {
    prompt: string;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
  } => {
    const prompts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    const upImg = orderedImages.map((m) => m.url).filter((s) => !!s);
    const upVid = orderedVideos.map((m) => m.url).filter((s) => !!s);
    const upAud = orderedAudios.map((m) => m.url).filter((s) => !!s);
    const dedupe = (arr: string[]) => {
      const out: string[] = [];
      for (const v of arr) if (v && out.indexOf(v) === -1) out.push(v);
      return out;
    };
    return {
      prompt: prompts.join('\n').trim(),
      imageUrls: dedupe([...upImg, ...localRefImages]),
      videoUrls: dedupe([...upVid, ...localRefVideos]),
      audioUrls: dedupe([...upAud, ...localRefAudios]),
    };
  };

  const stopPoll = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const nextGenerationRun = () => {
    generationRunRef.current += 1;
    return generationRunRef.current;
  };
  const isCurrentGenerationRun = (runId: number) => generationRunRef.current === runId;
  const rejectStoppedGeneration = (reject: (reason?: any) => void) => {
    if (pollRejectRef.current === reject) {
      pollRejectRef.current = null;
      stopPoll();
    }
    reject(new Error('用户已停止生成'));
  };
  const cancelActivePoll = () => {
    const reject = pollRejectRef.current;
    pollRejectRef.current = null;
    stopPoll();
    if (reject) reject(new Error('用户已停止生成'));
  };

  useEffect(() => () => cancelActivePoll(), []);

  // v1.2.9.11: 返回 Promise，调用方 await 直到任务真正成功/失败/超时才 resolve/reject。
  //   在循环器中使用时，不 await 会导致 useRunTrigger 提前 markDone → LoopNode 读不到 videoUrl → result=null → failCount++。
  const startPolling = (
    tid: string,
    runId: number,
    taskProvider?: Exclude<SeedanceTaskProvider, 'auto'>,
    reporter?: RunNodeLifecycleReporter,
  ): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      pollRejectRef.current = reject;
      let elapsed = 0;
      const POLL_MS = Math.max(2, pollInt) * 1000;
      const MAX = Math.max(10, maxPoll, seedanceMinPollCount(POLL_MS));
      let lastProgress = '';
      let pollInFlight = false;
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (!isCurrentGenerationRun(runId)) {
          rejectStoppedGeneration(reject);
          return;
        }
        if (elapsed > MAX) {
          pollRejectRef.current = null;
          stopPoll();
          update({ status: 'error', error: '轮询超时' });
          setError('轮询超时');
          logBus.error(`Seedance 轮询超时(${MAX}次)`, src);
          reject(new Error('轮询超时'));
          return;
        }
        pollInFlight = true;
        try {
          const r = await querySeedance(tid, taskProvider);
          if (!isCurrentGenerationRun(runId)) {
            rejectStoppedGeneration(reject);
            return;
          }
          // 进度条估算 (对齐主项目: 30 + a*65/max)
          const pct = Math.min(95, Math.round(30 + (elapsed * 65) / MAX));
          await reporter?.polling({
            provider: r.taskProvider || taskProvider || effectiveTaskProvider,
            model: r.model || builtinModel,
            taskId: tid,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: MAX,
            status: r.status,
            progress: r.progress || `${pct}%`,
          });
          if (r.progress && r.progress !== lastProgress) {
            lastProgress = r.progress;
            logBus.debug(`[${elapsed}/${MAX}] status=${r.status} progress=${r.progress}`, src);
          } else if (elapsed % 3 === 0) {
            logBus.debug(`[${elapsed}/${MAX}] status=${r.status}`, src);
          }
          if (String(r.status || '').toLowerCase() === 'materializing') {
            update({ status: 'polling', progress: '100% · 正在下载' });
            if (elapsed === 1 || elapsed % 10 === 0) {
              logBus.warn(
                r.error || 'Seedance 视频已经生成，正在适配 TUN/代理网络并安全下载；原任务会保留，不会重复提交',
                src,
              );
            }
          } else if (r.status === 'succeeded' && r.videoUrl) {
            pollRejectRef.current = null;
            stopPoll();
            update({
              status: 'success',
              videoUrl: r.videoUrl,
              progress: '100%',
              taskProvider: r.taskProvider || taskProvider,
              resolvedModel: r.model || d?.resolvedModel,
              taskType: r.taskType || d?.taskType,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
            });
            await reporter?.providerResponse({
              provider: r.taskProvider || taskProvider || effectiveTaskProvider,
              model: r.model || builtinModel,
              upstreamTaskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            logBus.success(`任务完成 → ${r.videoUrl}`, src);
            taskCompletionSound.notifyComplete(id, 'seedance');
            resolve();
          } else if (r.status === 'failed') {
            pollRejectRef.current = null;
            stopPoll();
            const msg = r.failReason || '生成失败';
            await reporter?.providerResponse({
              provider: r.taskProvider || taskProvider || effectiveTaskProvider,
              model: r.model || builtinModel,
              upstreamTaskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'failed',
              error: { message: msg },
              httpStatusSource: 'local-backend',
            });
            update({ status: 'error', error: msg });
            setError(msg);
            logBus.error(`生成失败: ${msg}`, src);
            reject(new Error(msg));
          } else {
            update({ status: 'polling', progress: `${pct}%` });
          }
        } catch (e: any) {
          if (!isCurrentGenerationRun(runId)) {
            rejectStoppedGeneration(reject);
            return;
          }
          // 偶发失败不停止
          console.warn('Seedance 轮询出错', e?.message);
        } finally {
          pollInFlight = false;
        }
      }, POLL_MS);
    });
  };

  const handleGenerate = async (reporter?: RunNodeLifecycleReporter) => {
    setError(null);
    const { prompt: upstreamPrompt, imageUrls, videoUrls, audioUrls } = collectUpstream();
    const resolvedLocalPrompt = resolveMediaMentions(localPrompt, promptMentions, mentionMaterials);
    const finalPrompt = (upstreamPrompt || resolvedLocalPrompt || '').trim();
    if (!finalPrompt
      && !(isSeedance25 && seedance25Mode === 'i2v')
      && !(isJimengCliSelected
        && activeFrameMode === 'auto'
        && (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0))) {
      setError('未连接 text 节点也未填写 prompt');
      logBus.error('生成中止: 缺少 prompt', src);
      return;
    }
    const jimengUsesMultimodal = isJimengCliSelected
      && (videoUrls.length > 0 || audioUrls.length > 0 || (activeFrameMode === 'auto' && imageUrls.length > 0));
    if (jimengUsesMultimodal) {
      const total = imageUrls.length + videoUrls.length + audioUrls.length;
      if (imageUrls.length > jimengSeedanceLimits.images) {
        setError(`即梦 ${externalProviderModel} 全能参考最多支持 ${jimengSeedanceLimits.images} 张图片`);
        return;
      }
      if (videoUrls.length > jimengSeedanceLimits.videos) {
        setError(`即梦 ${externalProviderModel} 全能参考最多支持 ${jimengSeedanceLimits.videos} 个视频`);
        return;
      }
      if (audioUrls.length > jimengSeedanceLimits.audios) {
        setError(`即梦 ${externalProviderModel} 全能参考最多支持 ${jimengSeedanceLimits.audios} 个音频`);
        return;
      }
      if (total > jimengSeedanceLimits.total) {
        setError(`即梦 ${externalProviderModel} 全能参考素材合计最多 ${jimengSeedanceLimits.total} 个`);
        return;
      }
      if (!jimengSeedanceLimits.audioOnly && imageUrls.length === 0 && videoUrls.length === 0) {
        setError('即梦 Seedance 2.0 全能参考需要至少一张图片或一个视频');
        return;
      }
    }
    if (isSeedance25 && seedance25Mode === 't2v'
      && (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0)) {
      setError('Seedance 2.5 文生视频不接受参考素材');
      return;
    }
    if (isSeedance25 && seedance25Mode === 'i2v') {
      if (imageUrls.length < 1 || imageUrls.length > 2) {
        setError('Seedance 2.5 图生视频必须提供 1-2 张图片（首帧/可选尾帧）');
        return;
      }
      if (videoUrls.length > 0 || audioUrls.length > 0) {
        setError('Seedance 2.5 图生视频不接受视频或音频素材');
        return;
      }
    }
    if (isSeedance25 && seedance25Mode === 'multi'
      && imageUrls.length === 0 && videoUrls.length === 0 && audioUrls.length === 0) {
      setError('Seedance 2.5 多模态参考至少需要 1 个图片、视频或音频素材');
      return;
    }
    if (isSeedance25 && seedance25Mode === 'multi') {
      const total = imageUrls.length + videoUrls.length + audioUrls.length;
      if (imageUrls.length > SEEDANCE25_MULTI_MAX_IMAGES) {
        setError(`Seedance 2.5 多模态参考最多支持 ${SEEDANCE25_MULTI_MAX_IMAGES} 张图片`);
        return;
      }
      if (videoUrls.length > SEEDANCE25_MULTI_MAX_VIDEOS) {
        setError(`Seedance 2.5 多模态参考最多支持 ${SEEDANCE25_MULTI_MAX_VIDEOS} 个视频`);
        return;
      }
      if (audioUrls.length > SEEDANCE25_MULTI_MAX_AUDIOS) {
        setError(`Seedance 2.5 多模态参考最多支持 ${SEEDANCE25_MULTI_MAX_AUDIOS} 个音频`);
        return;
      }
      if (total > SEEDANCE25_MULTI_MAX_TOTAL) {
        setError(`Seedance 2.5 多模态参考素材合计最多 ${SEEDANCE25_MULTI_MAX_TOTAL} 个`);
        return;
      }
    }
    const runId = nextGenerationRun();
    cancelActivePoll();
    const traceProvider = isExternalSelected && providerSelection.provider
      ? providerSelection.provider.id
      : effectiveTaskProvider;
    const traceModel = isExternalSelected && providerSelection.provider ? externalProviderModel : builtinModel;
    await reporter?.providerRequest({ provider: traceProvider, model: traceModel });
    taskCompletionSound.primeAudio();
    update({ status: 'submitting', error: null, videoUrl: null, taskId: null });

    try {
      if (isExternalSelected && providerSelection.provider) {
        const providerModel = externalProviderModel;
        logBus.info(
          `扩展平台 SD2.0 提交: ${providerSelection.provider.label || providerSelection.provider.id} · ${providerModel} · 图${imageUrls.length}/视${videoUrls.length}/音${audioUrls.length}`,
          src,
        );
        const r = await generateExternalVideo({
          providerId: providerSelection.provider.id,
          providerModel,
          model: providerModel,
          prompt: finalPrompt,
          aspect_ratio: ratio,
          ratio,
          duration,
          resolution,
          seed: seed >= 0 ? seed : undefined,
          images: imageUrls,
          videos: videoUrls,
          audios: audioUrls,
          providerParams: isJimengCliSelected
            ? {
                ...(d?.providerParams || {}),
                frameMode: activeFrameMode,
              }
            : {
                ...(d?.providerParams || {}),
                generate_audio: generateAudio,
                return_last_frame: returnLastFrame,
                watermark,
                web_search: webSearch,
                frameMode: activeFrameMode,
              },
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        const nextVideoUrl = r.videoUrls[0];
        if (!nextVideoUrl) throw new Error('扩展平台没有返回视频。');
        if (r.taskId || r.requestId) {
          await reporter?.providerSubmitted({
            provider: traceProvider,
            model: traceModel,
            upstreamTaskId: r.taskId,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
          });
        }
        await reporter?.providerResponse({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: r.taskId,
          requestId: r.requestId,
          transportHttpStatus: r.transportHttpStatus,
          upstreamHttpStatus: r.upstreamHttpStatus,
          usage: r.usage,
          status: 'succeeded',
          httpStatusSource: 'local-backend',
        });
        update({
          status: 'success',
          videoUrl: nextVideoUrl,
          videoUrls: r.videoUrls,
          remoteVideoUrls: r.remoteVideoUrls,
          taskId: r.taskId || null,
          provider: traceProvider,
          resolvedModel: traceModel,
          requestId: r.requestId,
          transportHttpStatus: r.transportHttpStatus,
          upstreamHttpStatus: r.upstreamHttpStatus,
          usage: r.usage,
          lastPrompt: finalPrompt,
          progress: '100%',
        });
        logBus.success(`扩展平台 SD2.0 完成 → ${nextVideoUrl}`, src);
        taskCompletionSound.notifyComplete(id, 'seedance');
        return;
      }

      // 拆分参考图(对齐主项目 sd_firstFrame / sd_lastFrame / sd_refImgs):
      //  - activeFrameMode='auto'(默认): 全部走 reference_image
      //  - activeFrameMode='first':   第 1 张作为 firstFrame, 其余作为 reference_image
      //  - activeFrameMode='firstlast': 第 1 张 first, 第 2 张 last, 其余作为 reference_image
      let firstFrame: string | undefined;
      let lastFrame: string | undefined;
      let refImages: string[] = [];
      if (isSeedance25 && seedance25Mode === 'i2v') {
        firstFrame = imageUrls[0];
        lastFrame = imageUrls[1];
      } else if (isSeedance25 && seedance25Mode === 'multi') {
        refImages = imageUrls;
      } else if (activeFrameMode === 'first' && imageUrls.length >= 1) {
        firstFrame = imageUrls[0];
        refImages = imageUrls.slice(1);
      } else if (activeFrameMode === 'firstlast' && imageUrls.length >= 1) {
        firstFrame = imageUrls[0];
        if (imageUrls.length >= 2) lastFrame = imageUrls[1];
        refImages = imageUrls.slice(2);
      } else {
        refImages = imageUrls;
      }

      if (!isSeedance25 && isSeedanceNzSelected && activeFrameMode === 'first'
        && (imageUrls.length !== 1 || videoUrls.length > 0 || audioUrls.length > 0)) {
        throw new Error('贞贞的平价AI小屋的首帧模式只接受 1 张图片；混合素材请改为“自动/多参”');
      }
      if (!isSeedance25 && isSeedanceNzSelected && activeFrameMode === 'firstlast'
        && (imageUrls.length !== 2 || videoUrls.length > 0 || audioUrls.length > 0)) {
        throw new Error('贞贞的平价AI小屋的首尾帧模式只接受 2 张图片；混合素材请改为“自动/多参”');
      }

      const payload: SeedanceSubmitRequest = {
        model: builtinModel,
        prompt: finalPrompt,
        duration,
        ratio: builtinRatio,
        resolution: builtinResolution,
        generate_audio: generateAudio,
        return_last_frame: returnLastFrame,
        watermark,
        web_search: webSearch,
        taskProvider: isSeedance25 ? 'seedance-nz' : builtinSource,
        providerParams,
      };
      if (seed !== -1) payload.seed = seed;
      if (firstFrame) payload.firstFrame = firstFrame;
      if (lastFrame) payload.lastFrame = lastFrame;
      if (refImages.length) payload.refImages = refImages;
      if ((!isSeedance25 || seedance25Mode === 'multi') && videoUrls.length) payload.videos = videoUrls;
      if ((!isSeedance25 || seedance25Mode === 'multi') && audioUrls.length) payload.audios = audioUrls;

      logBus.info(
          `提交 ${isSeedance25 ? 'Seedance2.5' : 'Seedance2.0'}: provider=${effectiveTaskProvider} model=${builtinModel} ${duration === -1 ? 'auto' : `${duration}s`} ${builtinRatio} ${builtinResolution} ` +
          `audio=${generateAudio} retLast=${returnLastFrame} ` +
          `frame=${activeFrameMode} refs=${refImages.length}` +
          (firstFrame ? ' +first' : '') +
          (lastFrame ? ' +last' : '') +
          (videoUrls.length ? ` +${videoUrls.length}video` : '') +
          (audioUrls.length ? ` +${audioUrls.length}audio` : '') +
          ` prompt="${finalPrompt.slice(0, 30)}…"`,
        src,
      );

      const r = await submitSeedance(payload, {
        submissionKey: reporter?.providerSubmissionKey,
      });
      if (!isCurrentGenerationRun(runId)) return;
      const submittedProvider = r.taskProvider || effectiveTaskProvider;
      await reporter?.providerSubmitted({
        provider: submittedProvider,
        model: r.model || builtinModel,
        upstreamTaskId: r.taskId,
        requestId: r.requestId,
        transportHttpStatus: r.transportHttpStatus,
        upstreamHttpStatus: r.upstreamHttpStatus,
        usage: r.usage,
        httpStatusSource: 'local-backend',
      });
      update({
        status: 'polling',
        taskId: r.taskId,
        taskProvider: submittedProvider,
        resolvedModel: r.model || builtinModel,
        taskType: r.taskType || null,
        lastPrompt: finalPrompt,
        progress: '15%',
      });
      logBus.info(`异步任务已提交 taskId=${r.taskId}, 进入轮询…`, src);
      // v1.2.9.11: await 让 useRunTrigger 等到任务真正完成才 markDone，循环器才能拿到 videoUrl
      await startPolling(r.taskId, runId, submittedProvider, reporter);
    } catch (e: any) {
      if (!isCurrentGenerationRun(runId)) return;
      const msg = e?.message || '提交失败';
      await reporter?.providerResponse({
        provider: traceProvider,
        model: traceModel,
        requestId: e?.requestId,
        transportHttpStatus: e?.transportHttpStatus,
        upstreamHttpStatus: e?.upstreamHttpStatus,
        status: 'failed',
        error: { message: msg, code: e?.code },
        httpStatusSource: 'local-backend',
      });
      setError(msg);
      update({ status: 'error', error: msg });
      logBus.error(`提交失败: ${msg}`, src);
    }
  };

  const handleStop = () => {
    generationRunRef.current += 1;
    cancelActivePoll();
    setError(null);
    update({
      status: 'idle',
      progress: '已停止',
      error: null,
      lastTaskId: taskId || d?.lastTaskId || null,
      lastTaskProvider: d?.taskProvider || d?.lastTaskProvider || null,
      taskId: null,
    });
    logBus.warn('用户主动停止：已停止本地轮询，远端任务可能仍会完成', src);
  };

  // 批量运行接入
  useRunTrigger(id, async (reporter) => {
    if (status === 'submitting' || status === 'polling') return;
    await handleGenerate(reporter);
  }, 'seedance', {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => shouldReuseGenerationResult('seedance', nodeData),
  });

  // === 跨节点拖拽: source (输出视频可拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (接收 image/video/audio/text) ===
  const jimengImageLimit = activeFrameMode === 'multiframe'
    ? JIMENG_CLI_MULTIFRAME.images
    : jimengSeedanceLimits.images;
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = Array.isArray(d?.localRefImages) ? d.localRefImages : [];
      if (cur.indexOf(payload.url) !== -1 || (isJimengCliSelected && cur.length >= jimengImageLimit)) return;
      update({ localRefImages: [...cur, payload.url] });
    } else if (payload.kind === 'video' && payload.url) {
      const cur = Array.isArray(d?.localRefVideos) ? d.localRefVideos : [];
      if (cur.indexOf(payload.url) !== -1 || (isJimengCliSelected && cur.length >= jimengSeedanceLimits.videos)) return;
      update({ localRefVideos: [...cur, payload.url] });
    } else if (payload.kind === 'audio' && payload.url) {
      const cur = Array.isArray(d?.localRefAudios) ? d.localRefAudios : [];
      if (cur.indexOf(payload.url) !== -1 || (isJimengCliSelected && cur.length >= jimengSeedanceLimits.audios)) return;
      update({ localRefAudios: [...cur, payload.url] });
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'video', 'audio', 'text'],
    onDrop: handleDrop,
  });

  const isBusy = status === 'submitting' || status === 'polling';
  const refsCount = orderedImages.length + localRefImages.length;
  const videoRefsCount = orderedVideos.length + localRefVideos.length;
  const audioRefsCount = orderedAudios.length + localRefAudios.length;

  return (
    <div
      {...dropProps}
      className={`relative rounded-xl border-2 transition-all w-[300px] ${
        selected ? 'border-fuchsia-400 shadow-2xl shadow-fuchsia-500/20' : isAccepting ? 'border-emerald-400' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        boxShadow: isAccepting ? '0 0 0 2px rgba(52,211,153,.45), 0 12px 30px rgba(52,211,153,.18)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-fuchsia-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-fuchsia-400 !border-0" />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(217,70,239,.2)', color: '#f0abfc', boxShadow: 'inset 0 0 0 1px rgba(217,70,239,.45)' }}
        >
          <Film size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{isSeedance25 ? 'SD2.5' : 'SD2.0'}</div>
          <div className="text-[10px] text-white/40">
            {isExternalSelected && providerSelection.provider
              ? `${providerSelection.provider.label || providerSelection.provider.id} · ${externalProviderModel || '未选模型'}`
              : (isSeedanceNzSelected
                ? `贞贞的平价AI小屋 · ${seedanceNzModel}`
                : '贞贞的AI工坊（海外） · Seedance 2.0')}
          </div>
        </div>
        {isJimengCliSelected && <JimengCliHelpButton />}
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        {!isSeedance25 ? (
          <div className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-2">
            <button
              type="button"
              onClick={() => update({ advancedProviderOpen: !d?.advancedProviderOpen })}
              className="w-full flex items-center justify-between text-[10px] font-semibold text-white/70 hover:text-white"
            >
              <span>API 来源</span>
              <span>
                {isExternalSelected && providerSelection.provider
                  ? providerSelection.provider.label
                  : (builtinSource === 'auto'
                    ? `主力自动 · ${effectiveTaskProvider === 'seedance-nz' ? '平价AI小屋' : '海外AI工坊'}`
                    : (effectiveTaskProvider === 'seedance-nz' ? '贞贞的平价AI小屋' : '贞贞的AI工坊（海外）'))}
              </span>
            </button>
            {d?.advancedProviderOpen && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">平台</label>
                  <select
                    value={isExternalSelected ? providerSelection.providerId : `builtin:${builtinSource}`}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (nextId.startsWith('builtin:')) {
                        const nextSource = nextId.slice('builtin:'.length) as SeedanceBuiltinSource;
                        const nextUsesSeedanceNz = nextSource === 'seedance-nz' || (nextSource === 'auto' && hasSeedanceNzKey);
                        update({
                          providerSource: 'zhenzhen',
                          providerId: '',
                          providerModel: '',
                          seedanceApiSource: nextSource,
                          ratio: nextUsesSeedanceNz && ratio === '9:21' ? '9:16' : ratio,
                          resolution: nextUsesSeedanceNz && resolution === 'native4K' ? 'native4k' : resolution,
                        });
                        return;
                      }
                      const provider = videoAdvancedProviders.find((item) => item.id === nextId);
                      if (!provider) return;
                      const nextModels = advancedProviderModelOptions(provider, 'video');
                      update({
                        providerSource: provider.protocol,
                        providerId: provider.id,
                        providerModel: nextModels[0] || '',
                        ...(provider.protocol === 'jimeng-cli' ? { resolution: '720p' } : {}),
                      });
                    }}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  >
                    <option value="builtin:auto" style={{ background: '#18181b', color: '#ffffff' }}>
                      主力 API（自动：优先平价AI小屋）
                    </option>
                    <option value="builtin:seedance-nz" style={{ background: '#18181b', color: '#ffffff' }}>
                      贞贞的平价AI小屋 · api.seedance.nz
                    </option>
                    <option value="builtin:zhenzhen-legacy" style={{ background: '#18181b', color: '#ffffff' }}>
                      贞贞的AI工坊（海外） · ai.t8star.org
                    </option>
                    {videoAdvancedProviders.map((provider) => (
                      <option key={provider.id} value={provider.id} style={{ background: '#18181b', color: '#ffffff' }}>
                        {provider.label || provider.id}
                      </option>
                    ))}
                  </select>
                </div>
                {isExternalSelected && providerSelection.provider && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">外部模型</label>
                    <select
                      value={externalProviderModel}
                      onChange={(e) => {
                        const nextModel = e.target.value;
                        const nextIsJimeng25 = providerSelection.provider?.protocol === 'jimeng-cli'
                          && isJimengSeedance25Model(nextModel);
                        const nextFrameMode = nextIsJimeng25 && activeFrameMode === 'multiframe' ? 'auto' : activeFrameMode;
                        const nextResolutions = providerSelection.provider?.protocol === 'jimeng-cli'
                          ? jimengSeedanceResolutionOptions(nextModel, nextFrameMode === 'multiframe')
                          : [];
                        const nextDurations = providerSelection.provider?.protocol === 'jimeng-cli'
                          ? jimengSeedanceDurationOptions(nextModel)
                          : [];
                        update({
                          providerModel: nextModel,
                          ...(nextResolutions.length && !nextResolutions.includes(resolution)
                            ? { resolution: nextResolutions.includes('720p') ? '720p' : nextResolutions[0] }
                            : {}),
                          ...(nextDurations.length && !nextDurations.includes(duration) ? { duration: 5 } : {}),
                          ...(providerSelection.provider?.protocol === 'jimeng-cli'
                            ? { frameMode: nextFrameMode }
                            : {}),
                        });
                      }}
                      style={{ background: '#18181b', color: '#ffffff' }}
                      className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                    >
                      {externalModelOptions.map((m) => (
                        <option key={m} value={m} style={{ background: '#18181b', color: '#ffffff' }}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
                {savedExternalMissing && (
                  <div className="text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                    当前画布记录的扩展平台未启用或不存在，已临时回到默认来源。
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded border border-fuchsia-300/20 bg-fuchsia-400/[0.06] px-2 py-1.5 text-[10px] text-white/60">
            固定渠道：贞贞的平价AI小屋 · Seedance 2.5 Standard
          </div>
        )}

        {/* 模型 */}
        {isExternalSelected && providerSelection.provider ? (
          <div className="rounded border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-100/90">
            当前使用「{providerSelection.provider.label || providerSelection.provider.id}」的外部模型
            <span className="font-semibold"> {externalProviderModel || '未选模型'} </span>
            生成；下方只保留时长、比例、分辨率、参考素材和 Prompt 等通用参数。
            {isJimengCliSelected && (
              <div className="mt-1 text-amber-100/70">
                当前按即梦 CLI v{JIMENG_CLI_SUPPORTED_VERSION} 适配：Seedance 2.5 支持 4-30 秒与 480P / 720P / 1080P；全能参考最多 30 图、10 视频、10 音频、合计 50 个并允许纯音频。智能多帧仍为固定模型。
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Model</label>
            {isSeedance25 ? (
              <select
                value={builtinModel}
                onChange={(e) => {
                  const nextModel = e.target.value;
                  update({
                    model: nextModel,
                    duration: SEEDANCE25_DEFAULT_DURATION,
                    resolution: SEEDANCE25_DEFAULT_RESOLUTION,
                    ratio: nextModel.endsWith('-i2v') ? 'adaptive' : '16:9',
                  });
                }}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              >
                {SEEDANCE25_MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>
                ))}
              </select>
            ) : isSeedanceNzSelected ? (
              <select
                value={seedanceNzModel}
                onChange={(e) => {
                  const nextModel = e.target.value;
                  const nextStandard = isSeedanceNzStandardModel(nextModel);
                  update({
                    seedanceNzModel: nextModel,
                    resolution: !nextStandard && String(resolution).startsWith('native') ? '720p' : resolution,
                  });
                }}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              >
                {SEEDANCE_NZ_MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>
                ))}
              </select>
            ) : (
              <select
                value={model}
                onChange={(e) => update({ model: e.target.value })}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>
                ))}
              </select>
            )}
            {isSeedanceNzSelected && !hasSeedanceNzKey && (
              <div className="mt-1 text-[10px] text-amber-200">
                尚未配置“贞贞的平价AI小屋 API Key”，请先到 API 设置填写。
              </div>
            )}
          </div>
        )}

        <LocalNodeAddonSlot
          nodeId={id}
          nodeType={isSeedance25 ? 'seedance25' : 'seedance'}
          data={d}
          update={update}
          context={{
            providerSource: isExternalSelected ? providerSelection.providerSource : effectiveTaskProvider,
            providerId: providerSelection.providerId,
            providerModel: isExternalSelected ? externalProviderModel : builtinModel,
            model: builtinModel,
            apiModel: builtinModel,
            providerKind: isSeedance25 ? 'seedance25' : 'seedance',
          }}
        />

        {/* Duration / Ratio */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Duration(s)</label>
            <select
              value={String(duration)}
              onChange={(e) => update({ duration: Number(e.target.value) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {activeDurationOptions.map((s) => (
                <option key={s} value={s} className="bg-zinc-900">{s === -1 ? '自动 (-1)' : `${s}s`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Ratio</label>
            <select
              value={builtinRatio}
              onChange={(e) => update({ ratio: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {activeRatioOptions.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Resolution / Seed */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Resolution</label>
            <select
              value={builtinResolution}
              onChange={(e) => update({ resolution: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {activeResolutionOptions.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Seed (-1=随机)</label>
            <input
              type="number"
              value={seed}
              min={-1}
              max={2147483647}
              onChange={(e) => update({ seed: Number(e.target.value) || -1 })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
        </div>

        {/* 帧使用模式 */}
        {!isSeedance25 && <div>
          <label className="text-[10px] text-white/50 block mb-1">参考图模式</label>
          <select
            value={activeFrameMode}
            onChange={(e) => {
              const nextMode = e.target.value;
              update({
                frameMode: nextMode,
                ...(isJimengCliSelected && nextMode === 'multiframe' && !['720p', '1080p'].includes(resolution)
                  ? { resolution: '720p' }
                  : {}),
              });
            }}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            <option value="auto" className="bg-zinc-900">{isJimengCliSelected ? '全能参考(auto)' : '全部作参考图(auto)'}</option>
            <option value="first" className="bg-zinc-900">{isJimengCliSelected ? '单图参考（图生视频）' : '上传首帧（图生视频）'}</option>
            <option value="firstlast" className="bg-zinc-900">{isJimengCliSelected ? '首帧+尾帧(frames2video)' : '传入首帧+尾帧（首尾帧视频）'}</option>
            {isJimengCliSelected && !isJimengSeedance25 && (
              <option value="multiframe" className="bg-zinc-900">智能多帧(multiframe)</option>
            )}
          </select>
        </div>}

        {isSeedance25 && (
          <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {seedance25Mode === 't2v'
              ? '文生视频：只提交提示词，不接受参考素材。'
              : seedance25Mode === 'i2v'
                ? '图生视频：1-2 张图片依次作为首帧和可选尾帧，提示词可选。'
                : '多模态参考：提示词必填；最多 30 图、10 视频、10 音频，合计不超过 50 个。单段音视频 2-30 秒，全部参考音视频总时长不超过 30 秒，提交前会实际读取时长校验。'}
            <div className="mt-1 text-white/35">
              图片 JPG/JPEG/PNG/WEBP（单张≤30MB）；视频 MP4、音频 MP3/WAV（单个≤50MB）。默认 5 秒 / 720p。
            </div>
          </div>
        )}

        {/* 开关组 */}
        {!isExternalSelected && <div className="grid grid-cols-2 gap-1.5">
          <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={generateAudio}
              onChange={(e) => update({ generateAudio: e.target.checked })}
              className="accent-fuchsia-400"
            />
            生成音频
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={returnLastFrame}
              onChange={(e) => update({ returnLastFrame: e.target.checked })}
              className="accent-fuchsia-400"
            />
            返回末帧
          </label>
          {!isSeedanceNzSelected && <>
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => update({ webSearch: e.target.checked })}
                className="accent-fuchsia-400"
              />
              Web Search
            </label>
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={watermark}
                onChange={(e) => update({ watermark: e.target.checked })}
                className="accent-fuchsia-400"
              />
              水印
            </label>
          </>}
        </div>}

        {/* 轮询参数 */}
        {!isExternalSelected && <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Max Poll</label>
            <input
              type="number"
              value={maxPoll}
              min={10}
              max={3600}
              onChange={(e) => update({ maxPoll: Math.max(10, Math.min(3600, Number(e.target.value) || 360)) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Interval(s)</label>
            <input
              type="number"
              value={pollInt}
              min={2}
              max={60}
              onChange={(e) => update({ pollInt: Math.max(2, Math.min(60, Number(e.target.value) || 10)) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
        </div>}

        {/* 上游素材聚合预览区 (代替原「上游图像计数」, Seedance 支持四类素材全开) */}
        <MaterialPreviewSection
          texts={orderedTexts}
          images={orderedImages}
          videos={orderedVideos}
          audios={orderedAudios}
          order={materialOrder}
          onReorder={setMaterialOrder}
          onExcludeUpstream={handleExcludeUpstreamMaterial}
          excludedCount={excludedUpstreamCount}
          onRestoreExcluded={handleRestoreExcludedMaterials}
          selected={!!selected}
          isDark={isDark}
          isPixel={isPixel}
          groups={['text', 'image', 'video', 'audio']}
          title={isJimengCliSelected
            ? `上游素材 · 图${Math.min(refsCount, jimengImageLimit)}/${jimengImageLimit} 视${Math.min(videoRefsCount, jimengSeedanceLimits.videos)}/${jimengSeedanceLimits.videos} 音${Math.min(audioRefsCount, jimengSeedanceLimits.audios)}/${jimengSeedanceLimits.audios}`
            : `上游素材 · 参考图 ${refsCount}`}
        />

        {/* 本地拖入参考素材 */}
        {(localRefImages.length + localRefVideos.length + localRefAudios.length) > 0 && (
          <div className="rounded border border-emerald-400/30 bg-emerald-500/5 p-1.5 space-y-1">
            <div className="text-[10px] text-emerald-200/80">
              本地拖入 · 图{localRefImages.length} 视{localRefVideos.length} 音{localRefAudios.length}
            </div>
            {localRefImages.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {localRefImages.map((u, i) => (
                  <div key={`i${i}`} className="relative w-10 h-10">
                    <SmartImage
                      src={u}
                      alt=""
                      data-drag-source
                      data-drag-kind="image"
                      data-drag-url={u}
                      data-drag-preview={u}
                      data-drag-node-id={id}
                      onMouseDown={(e) => beginMaterialDrag(e, { kind: 'image', url: u, sourceNodeId: id, previewUrl: u })}
                      className="w-10 h-10 object-cover rounded border border-white/10 cursor-grab"
                      thumbSize={160}
                    />
                    <button
                      onClick={() => update({ localRefImages: localRefImages.filter((x) => x !== u) })}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center"
                    >
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {localRefVideos.length > 0 && (
              <div className="space-y-1">
                {localRefVideos.map((u, i) => (
                  <div key={`v${i}`} className="flex items-center gap-1">
                    <LoopingVideo
                      src={u}
                      data-drag-source
                      data-drag-kind="video"
                      data-drag-url={u}
                      data-drag-preview={u}
                      data-drag-node-id={id}
                      onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: u, sourceNodeId: id, previewUrl: u })}
                      className="w-12 h-8 object-cover rounded border border-white/10 cursor-grab"
                    />
                    <span className="flex-1 truncate text-[10px] text-white/50">{u.split('/').pop()}</span>
                    <button
                      onClick={() => update({ localRefVideos: localRefVideos.filter((x) => x !== u) })}
                      className="text-rose-300/60 hover:text-rose-200"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {localRefAudios.length > 0 && (
              <div className="space-y-1">
                {localRefAudios.map((u, i) => (
                  <div key={`a${i}`} className="flex items-center gap-1">
                    <span
                      data-drag-source
                      data-drag-kind="audio"
                      data-drag-url={u}
                      data-drag-node-id={id}
                      onMouseDown={(e) => beginMaterialDrag(e, { kind: 'audio', url: u, sourceNodeId: id, previewUrl: u })}
                      className="text-[14px] cursor-grab"
                      title="按住 Ctrl 拖拽"
                    >♪</span>
                    <span className="flex-1 truncate text-[10px] text-white/50">{u.split('/').pop()}</span>
                    <button
                      onClick={() => update({ localRefAudios: localRefAudios.filter((x) => x !== u) })}
                      className="text-rose-300/60 hover:text-rose-200"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">本地 Prompt(可选)</label>
          <MentionPromptInput
            title={isSeedance25 ? 'SD2.5 Prompt' : 'SD2.0 Prompt'}
            value={localPrompt}
            mentions={promptMentions}
            materials={mentionMaterials}
            onChange={(value, mentions) => update({ prompt: value, promptMentions: mentions })}
            placeholder="备用:无上游连接时使用"
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="video"
            className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>

        <ReuseResultToggle
          checked={d?.reuseResult === true}
          hasResult={hasReusableGenerationResult('seedance', d)}
          onChange={(checked) => update({ reuseResult: checked })}
          accentColor="#e879f9"
        />

        {!isBusy ? (
          <button
            onClick={() => requestCanvasNodeRun(id)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-200 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> 生成视频
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> 停止({progress || (status === 'submitting' ? '提交中' : '排队中')})
          </button>
        )}

        {isBusy && (
          <div className="flex items-center gap-1 text-[10px] text-fuchsia-200/80">
            <Loader2 size={11} className="animate-spin" />
            {status === 'submitting' ? '提交任务...' : `轮询中 ${progress}`}
            {taskId && <span className="ml-auto text-white/30">{taskId.slice(0, 10)}…</span>}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

      {videoUrl && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <LoopingVideo
            src={videoUrl}
            controls
            className="w-full rounded"
            style={{ aspectRatio: ratio === 'adaptive' ? undefined : ratio.replace(':', '/') }}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={videoUrl}
            data-drag-preview={videoUrl}
            data-drag-node-id={id}
            data-resource-title={videoUrl.split('/').pop() || '生成视频'}
            data-prompt-template-kind="video"
            data-prompt-template-category="video-image-to-video"
            data-prompt-template-prompt={d?.lastPrompt || localPrompt}
            onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl, sourceNodeId: id, previewUrl: videoUrl })}
            title="按住 Ctrl 拖拽到其他节点"
          />
        </div>
      )}
    </div>
  );
};

export default memo(SeedanceNode);
