import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { AlertCircle, Loader2, Video as VideoIcon, Sparkles, Square, X } from 'lucide-react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import {
  VIDEO_MODELS,
  inferVideoBuiltinSource,
  isZhenzhenApimartVideoModel,
  videoModelOptionsForSource,
  videoModelsForSource,
  type VideoBuiltinSource,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_GK_V15_MODEL,
  ZHENZHEN_VIDEO_V31_FAST_MODEL,
  ZHENZHEN_VIDEO_V31_LITE_MODEL,
  ZHENZHEN_VIDEO_V31_QUALITY_MODEL,
  FASHVSR_VIDEO_UPSCALE_MODEL,
  WAN30_I2V_MODELS,
  WAN30_R2V_MODELS,
  WAN30_THINKING_MODELS,
  GROK_VIDEO_1_5_NEW_SIZES,
  grokVideo15NewSizeFromRatio,
  isFalVideoModel,
  isGrokVideo15NewModel,
  VIDEO_FAL_REGISTRY,
  VEO_FAL_RATIOS,
  VEO_FAL_DURATIONS,
  VEO_FAL_RESOLUTIONS,
  GROK_FAL_RATIOS,
  GROK_FAL_RESOLUTIONS,
  GROK_FAL_MODES,
  SORA2_FAL_MODES,
  SORA2_FAL_RATIOS,
  SORA2_FAL_DURATIONS,
  SORA2_FAL_RESOLUTIONS,
} from '../../providers/models';
import {
  generateExternalVideo,
  submitHappyHorse,
  queryHappyHorse,
  submitHailuo,
  queryHailuo,
  submitFlux3,
  queryFlux3,
  submitKling,
  queryKling,
  submitUpscaler,
  queryUpscaler,
  submitFashVsr,
  queryFashVsr,
  submitVidu,
  queryVidu,
  submitWan,
  queryWan,
  submitSeedance,
  querySeedance,
  submitVideo,
  queryVideo,
  submitVideoFal,
  queryVideoFal,
  type VideoSubmitRequest,
  type VideoFalSubmitRequest,
  type HailuoModel,
  type HailuoDuration,
  type Flux3VideoModel,
  type KlingModel,
  type UpscalerResolution,
  type ViduQ3Model,
  type WanSubmitRequest,
} from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import NodeVisible from '../../i18n/NodeVisible';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
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
import { normalizeProviderErrorMessage } from '../../utils/providerErrorMessage.ts';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
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
import JimengCliHelpButton from './JimengCliHelpButton';
import {
  SEEDANCE25_MULTI_MAX_AUDIOS,
  SEEDANCE25_MULTI_MAX_IMAGES,
  SEEDANCE25_MULTI_MAX_TOTAL,
  SEEDANCE25_MULTI_MAX_VIDEOS,
  SEEDANCE25_DEFAULT_DURATION,
  SEEDANCE25_DEFAULT_RESOLUTION,
} from '../../config/seedance';
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
 * VideoNode - 异步视频生成(完全对齐 gpt-image-2-web)
 * 支持:
 *   - Veo      (kind=veo)       — 默认 veo-omni-10s / 旧 Veo 3.1 子模型 / images(≤3)
 *   - Grok Video(kind=grok)     — Zhenzhen Grok 1.5 New / Grok Video 1.5 FAL / 旧版 FAL / grok-video-3 / images
 *   - Sora2    (kind=sora)      — Zhenzhen API + FAL 双渠道 / Base64 参考图(≤1)
 *   - HappyHorse(kind=happyhorse)— api.seedance.nz 文生/图生/参考图生视频(≤9 图)
 *   - Hailuo   (kind=hailuo)    — api.seedance.nz Hailuo 2.3 / H3 / H3 Max + MiniMax H3 OW
 *   - Flux3    (kind=flux3)     — api.seedance.nz FLUX 3 国内/海外 T2V/I2V/V2V/Draft Enhance
 *   - Seedance 2.5(kind=seedance25)— api.seedance.nz 六个 Standard 文生/图生/多模态模型
 *   - Vidu     (kind=vidu)      — api.seedance.nz Vidu Q3 文生/图生/首尾帧/参考/短剧成片(≤14 图)
 *   - Kling    (kind=kling)     — api.seedance.nz Kling 文生/图生/首尾帧/参考/视频编辑
 *   - Wan      (kind=wan)       — api.seedance.nz Wan 2.7 Spicy 图生视频(1 张首帧)
 *   - Seedance  (kind=seedance) — 零破坏兼容旧 veo 字段
 * 流程: submit → poll(5s 间隔) → 转存 → 展示
 */
const VIDEO_POLL_TIMEOUT_SECONDS = 3600;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLL = Math.ceil((VIDEO_POLL_TIMEOUT_SECONDS * 1000) / VIDEO_POLL_INTERVAL_MS);
const VIDEO_FAL_POLL_INTERVAL_MS = 6000;
const VIDEO_FAL_MAX_POLL = Math.ceil((VIDEO_POLL_TIMEOUT_SECONDS * 1000) / VIDEO_FAL_POLL_INTERVAL_MS);
type JimengSeedanceMode = 'omni' | 'first' | 'firstlast' | 'multiframe';
const JIMENG_SEEDANCE_MODE_OPTIONS: Array<{ value: JimengSeedanceMode; label: string }> = [
  { value: 'omni', label: '全能参考' },
  { value: 'first', label: '首帧图生视频' },
  { value: 'firstlast', label: '首尾帧生视频' },
  { value: 'multiframe', label: '智能多帧' },
];

const splitGrokFalRefUrls = (raw: string): string[] =>
  String(raw || '')
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const normalizeJimengSeedanceMode = (value: unknown): JimengSeedanceMode => {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'first') return 'first';
  if (text === 'firstlast' || text === 'first_last' || text === 'frames2video') return 'firstlast';
  if (text === 'multiframe' || text === 'smart' || text === 'smart-multiframe') return 'multiframe';
  return 'omni';
};

const VideoNode = ({ id, data, selected }: NodeProps) => {
  const { t: translate } = useTranslation(['nodes', 'common']);
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { getEdges, getNodes } = useReactFlow();
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollRejectRef = useRef<((reason?: any) => void) | null>(null);
  const generationRunRef = useRef(0);
  const src = `video:${id.slice(0, 6)}`;

  // 主题适配 (默认科技风深色, 传递给聚合预览区)
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';

  const d = data as any;
  const isFashVsrVariant = d?.fashVsrVariant === true;
  const providerParams = (d?.providerParams && typeof d.providerParams === 'object') ? d.providerParams : {};
  const advancedProviders = useApiKeysStore((s) => s.settings.advancedProviders);
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
  const isExternalSelected = !isFashVsrVariant && providerSelection.available && providerSelection.providerSource !== 'zhenzhen';
  const savedExternalMissing = !!d?.providerId
    && !!d?.providerSource
    && d.providerSource !== 'zhenzhen'
    && !providerSelection.available;
  const externalModelOptions = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'video')
    : [];
  const externalProviderModel = providerSelection.providerModel || externalModelOptions[0] || '';
  const isAgnesExternalSelected = isExternalSelected && providerSelection.provider?.protocol === 'agnes';
  const isJimengCliSelected = isExternalSelected && providerSelection.provider?.protocol === 'jimeng-cli';
  const isJimengSeedanceSelected = isJimengCliSelected && /seedance|jimeng-video|video/i.test(externalProviderModel);
  const isJimengSeedance25 = isJimengSeedanceSelected && isJimengSeedance25Model(externalProviderModel);
  const rawJimengSeedanceMode = normalizeJimengSeedanceMode(providerParams.frameMode ?? d?.jimengFrameMode);
  const jimengSeedanceMode = isJimengSeedance25 && rawJimengSeedanceMode === 'multiframe'
    ? 'omni'
    : rawJimengSeedanceMode;
  const jimengSeedanceLimits = isJimengSeedance25
    ? JIMENG_CLI_SEEDANCE25_LIMITS
    : JIMENG_CLI_SEEDANCE20_LIMITS;
  const jimengModeOptions = isJimengSeedance25
    ? JIMENG_SEEDANCE_MODE_OPTIONS.filter((item) => item.value !== 'multiframe')
    : JIMENG_SEEDANCE_MODE_OPTIONS;
  const jimengImageLimit = jimengSeedanceMode === 'multiframe'
    ? JIMENG_CLI_MULTIFRAME.images
    : jimengSeedanceLimits.images;
  const agnesFrameRate = Number(providerParams.frameRate ?? providerParams.frame_rate ?? 24) || 24;
  const agnesNumFrames = providerParams.numFrames ?? providerParams.num_frames ?? '';
  const updateProviderParams = (patch: Record<string, any>) => update({ providerParams: { ...providerParams, ...patch } });
  // 主模型 id (对应 VIDEO_MODELS 项)
  const rawModel = typeof d?.model === 'string' ? d.model : '';
  const isLegacySora2Model = /^sora-2(?:-\d{4}-\d{2}-\d{2})?$/.test(rawModel);
  const savedModelDef = VIDEO_MODELS.find(
    (model) => model.id === rawModel || model.apiModelOptions.some((option) => option.value === rawModel),
  );
  // 旧画布没有 videoBuiltinSource；根据已保存的真实模型恢复来源，避免升级后模型被静默切换。
  const inferredBuiltinSource = inferVideoBuiltinSource(rawModel || d?.mainId);
  const videoBuiltinSource: VideoBuiltinSource = d?.videoBuiltinSource === 'seedance-nz'
    || d?.videoBuiltinSource === 'zhenzhen'
    ? d.videoBuiltinSource
    : d?.providerSource === 'seedance-nz' && !d?.providerId
      ? 'seedance-nz'
      : inferredBuiltinSource || 'zhenzhen';
  const builtinVideoModels = useMemo(
    () => videoModelsForSource(videoBuiltinSource),
    [videoBuiltinSource],
  );
  const requestedMainId = d?.mainId
    || (isLegacySora2Model ? 'sora-2' : savedModelDef?.id)
    || builtinVideoModels[0]?.id
    || VIDEO_MODELS[0].id;
  const modelDef = useMemo(
    () => builtinVideoModels.find((model) => model.id === requestedMainId)
      || (savedModelDef && builtinVideoModels.find((model) => model.id === savedModelDef.id))
      || builtinVideoModels[0]
      || VIDEO_MODELS[0],
    [builtinVideoModels, requestedMainId, savedModelDef],
  );
  const mainId = modelDef.id;
  const builtinApiModelOptions = useMemo(
    () => videoModelOptionsForSource(modelDef, videoBuiltinSource),
    [modelDef, videoBuiltinSource],
  );
  // 子模型(上游真实 model 名)
  const apiModel: string = rawModel && builtinApiModelOptions.some((option) => option.value === rawModel)
    ? rawModel
    : builtinApiModelOptions[0]?.value || modelDef.apiModelOptions[0].value;
  const activeModelOption = builtinApiModelOptions.find((option) => option.value === apiModel);
  const isHappyHorse = !isExternalSelected && modelDef.kind === 'happyhorse';
  const isHailuo = !isExternalSelected && modelDef.kind === 'hailuo';
  const isFlux3 = !isExternalSelected && modelDef.kind === 'flux3';
  const isSeedance25 = !isExternalSelected && modelDef.kind === 'seedance25';
  const isKling = !isExternalSelected && modelDef.kind === 'kling';
  const isUpscaler = !isExternalSelected && modelDef.kind === 'upscaler';
  const isFashVsr = isUpscaler && apiModel === FASHVSR_VIDEO_UPSCALE_MODEL;
  const isVidu = !isExternalSelected && modelDef.kind === 'vidu';
  const isWan = !isExternalSelected && modelDef.kind === 'wan';
  const isWan30 = isWan && apiModel.startsWith('wan-3.0-');
  const wan30Mode: 'i2v' | 'r2v' = (WAN30_I2V_MODELS as readonly string[]).includes(apiModel)
    ? 'i2v'
    : (WAN30_R2V_MODELS as readonly string[]).includes(apiModel) ? 'r2v' : 'i2v';
  const wan30SupportsThinking = isWan30 && (WAN30_THINKING_MODELS as readonly string[]).includes(apiModel);
  const isApimartBudgetVideo = !isExternalSelected && isZhenzhenApimartVideoModel(apiModel);
  const isApimartOmni = apiModel === ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL;
  const isApimartOmniLowprice = apiModel === ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL
    || apiModel === ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL;
  const isApimartGrok = apiModel === ZHENZHEN_VIDEO_GK_V15_MODEL;
  const isApimartV31Fast = apiModel === ZHENZHEN_VIDEO_V31_FAST_MODEL;
  const isApimartV31Quality = apiModel === ZHENZHEN_VIDEO_V31_QUALITY_MODEL;
  const isApimartV31Lite = apiModel === ZHENZHEN_VIDEO_V31_LITE_MODEL;
  const isApimartV31 = isApimartV31Fast || isApimartV31Quality || isApimartV31Lite;
  const apimartOmniLowpriceMode: 'text' | 'frame' | 'reference_images' | 'reference_video' =
    ['text', 'frame', 'reference_images', 'reference_video'].includes(d?.apimartOmniLowpriceMode)
      ? d.apimartOmniLowpriceMode
      : 'text';
  const apimartOmniLowpriceNsfwCheck = d?.apimartOmniLowpriceNsfwCheck === true;
  const happyHorseMode = apiModel.endsWith('-i2v') ? 'i2v' : apiModel.endsWith('-r2v') ? 'r2v' : 't2v';
  const isHailuoH3Max = isHailuo && apiModel.startsWith('hailuo-h3-max-');
  const isHailuoH3 = isHailuo && apiModel.startsWith('hailuo-h3-') && !isHailuoH3Max;
  const isMinimaxH3Ow = isHailuo && apiModel.startsWith('minimax-h3-ow-');
  const isMinimaxH3OwFast = isMinimaxH3Ow && apiModel.endsWith('-fast');
  const isMinimaxH3OwAudioDrive = isMinimaxH3Ow && apiModel.includes('-audio-drive-');
  const hailuoMode = isMinimaxH3OwAudioDrive
    ? 'audio-drive'
    : apiModel.endsWith('-multi')
    ? 'multi'
    : apiModel.includes('-r2v') ? 'r2v' : apiModel.includes('-i2v') ? 'i2v' : 't2v';
  const flux3Mode = apiModel.endsWith('-draft-enhance')
    ? 'draft-enhance'
    : apiModel.endsWith('-v2v') ? 'v2v' : apiModel.endsWith('-i2v') ? 'i2v' : 't2v';
  const seedance25Mode = apiModel.endsWith('-multi') ? 'multi' : apiModel.endsWith('-i2v') ? 'i2v' : 't2v';
  const klingMode = apiModel.endsWith('-edit')
    ? 'edit'
    : apiModel.endsWith('-r2v')
      ? 'r2v'
      : apiModel.endsWith('-i2v')
        ? 'i2v'
        : 't2v';
  const viduMode = apiModel.endsWith('-short-play')
    ? 'short-play'
    : apiModel.endsWith('-start-end')
      ? 'start-end'
      : apiModel.endsWith('-r2v')
        ? 'r2v'
        : apiModel.endsWith('-i2v')
          ? 'i2v'
          : 't2v';
  const isViduUpstreamUnavailable = isVidu && (viduMode === 'r2v' || viduMode === 'short-play');
  const isKlingUpstreamUnavailable = isKling && ['kling-o3-std-r2v', 'kling-o3-pro-r2v'].includes(apiModel);
  const isSeedanceNzVideo = !isExternalSelected && videoBuiltinSource === 'seedance-nz';
  // 各参数(跳过着调用 update 默认值)
  const apimartRatioOptions = isApimartGrok
    ? ['16:9', '9:16', '1:1', '3:2', '2:3']
    : ['16:9', '9:16'];
  const rawRatio: string = d?.ratio || activeModelOption?.defaultRatio || modelDef.defaultRatio;
  const ratio: string = isApimartBudgetVideo && !apimartRatioOptions.includes(rawRatio) ? '16:9' : rawRatio;
  const rawDuration: number = d?.duration
    ?? activeModelOption?.defaultDuration
    ?? modelDef.defaultDuration
    ?? (activeModelOption?.durations?.[0] || modelDef.durations?.[0] || 0);
  const duration: number = isApimartV31
    ? 8
    : isApimartGrok
      ? Math.max(6, Math.min(30, Number(rawDuration) || 6))
      : isApimartOmni ? 0
        : isApimartOmniLowprice && ![4, 6, 8, 10].includes(Number(rawDuration)) ? 6
          : rawDuration;
  const rawResolution: string = d?.resolution
    || (isJimengSeedanceSelected ? '720p' : activeModelOption?.defaultResolution || modelDef.defaultResolution || '');
  const resolution: string = isApimartOmni
    ? '720p'
    : isApimartOmniLowprice && !['720p', '1080p', '4k'].includes(rawResolution.toLowerCase())
      ? '720p'
    : isApimartV31 && !['720p', '1080p', '4k'].includes(rawResolution.toLowerCase())
      ? '720p'
      : isApimartGrok && !['480p', '720p'].includes(rawResolution.toLowerCase())
        ? '720p'
        : isApimartBudgetVideo ? rawResolution.toLowerCase() : rawResolution;
  const hailuoDuration: HailuoDuration = isMinimaxH3Ow
    ? ([5, 10, 15].includes(Number(duration)) ? Number(duration) : 5) as HailuoDuration
    : isHailuoH3 || isHailuoH3Max
      ? Math.max(5, Math.min(15, Number(duration) || 5)) as HailuoDuration
    : resolution === '1080p' ? 6 : Number(duration) === 10 ? 10 : 6;
  const flux3Duration = Math.max(5, Math.min(20, Number(duration) || 5));
  const flux3Resolution: 'hd' | 'fhd' = resolution === 'fhd' ? 'fhd' : 'hd';
  const flux3Draft = d?.flux3Draft === true;
  const flux3AudioMode: 'api_default' | 'enabled' | 'disabled' = ['enabled', 'disabled'].includes(d?.flux3AudioMode)
    ? d.flux3AudioMode
    : 'api_default';
  const flux3SafetyTolerance: 'api_default' | 0 | 1 | 2 | 3 | 4 = [0, 1, 2, 3, 4].includes(Number(d?.flux3SafetyTolerance))
    ? Number(d.flux3SafetyTolerance) as 0 | 1 | 2 | 3 | 4
    : 'api_default';
  const flux3DraftCache = typeof d?.flux3DraftCache === 'string' ? d.flux3DraftCache : '';
  const flux3DraftCacheResult = typeof d?.flux3DraftCacheResult === 'string' ? d.flux3DraftCacheResult : '';
  const klingDuration: 5 | 10 = Number(duration) === 10 ? 10 : 5;
  const klingNegativePrompt: string = typeof d?.klingNegativePrompt === 'string' ? d.klingNegativePrompt : '';
  const viduDuration = viduMode === 'short-play'
    ? Math.max(8, Math.min(12, Number(duration) || 8))
    : Math.max(4, Math.min(15, Number(duration) || 4));
  const viduResolution: 'default' | '720p' | '1080p' = viduMode === 'short-play'
    ? '1080p'
    : resolution === '720p' || resolution === '1080p' ? resolution : 'default';
  const viduRatio = viduMode === 'short-play'
    ? ratio === '16:9' ? '16:9' : '9:16'
    : ratio;
  const viduSeed: number = Number.isInteger(d?.viduSeed) ? d.viduSeed : -1;
  const viduScriptName: string = typeof d?.viduScriptName === 'string' ? d.viduScriptName : 'Vidu short play';
  const viduStyle: string = typeof d?.viduStyle === 'string' ? d.viduStyle : 'realistic';
  const viduAssetType: 'character' | 'scene' | 'prop' = ['character', 'scene', 'prop'].includes(d?.viduAssetType)
    ? d.viduAssetType
    : 'character';
  const viduAssetNamePrefix: string = typeof d?.viduAssetNamePrefix === 'string' ? d.viduAssetNamePrefix : 'Asset';
  const viduAssetDescription: string = typeof d?.viduAssetDescription === 'string' ? d.viduAssetDescription : 'Reference asset';
  const seed: number = typeof d?.seed === 'number' ? d.seed : 0;
  const generateAudio: boolean = d?.generateAudio !== false;
  const returnLastFrame: boolean = d?.returnLastFrame === true;
  const enhancePrompt: boolean = d?.enhancePrompt ?? false;
  const enableUpsample: boolean = d?.enableUpsample ?? false;
  const wanNegativePrompt: string = typeof d?.wanNegativePrompt === 'string' ? d.wanNegativePrompt : '';
  const wanAudioUrl: string = typeof d?.wanAudioUrl === 'string' ? d.wanAudioUrl : '';
  const wanPromptExtend: boolean = d?.wanPromptExtend === true;
  const wanSeed: number = Number.isInteger(d?.wanSeed) ? d.wanSeed : -1;
  const wan30Seed: number = Number.isInteger(d?.wan30Seed) ? d.wan30Seed : 0;
  const wan30EnableThinking: boolean = d?.wan30EnableThinking === true;
  const wan30FileUrl: string = typeof d?.wan30FileUrl === 'string' ? d.wan30FileUrl : '';
  const wan30LinkUrl: string = typeof d?.wan30LinkUrl === 'string' ? d.wan30LinkUrl : '';

  // FAL 专属参数
  const isFal = isFalVideoModel(apiModel);
  const falReg = isFal ? VIDEO_FAL_REGISTRY[apiModel] : null;
  const isGrokFalV15 = apiModel === 'grok-imagine-video-1.5';
  const isGrok15New = !isExternalSelected && isGrokVideo15NewModel(apiModel);
  const grok15NewSize = d?.size === '1280x720' || d?.size === '720x1280'
    ? d.size
    : grokVideo15NewSizeFromRatio(ratio);
  const isSoraZhenzhen = !isExternalSelected && modelDef.kind === 'sora' && !isFal;
  const isVeoOmni = !isExternalSelected && apiModel === 'veo-omni-10s';
  const showBuiltinFalControls = !isExternalSelected && isFal && !!falReg;
  const showGenericVideoControls = isExternalSelected || !isFal;
  const ratioOptions = isJimengSeedanceSelected
    ? ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
    : isAgnesExternalSelected
    ? ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
    : isApimartBudgetVideo
    ? apimartRatioOptions
    : isGrok15New
    ? ['16:9', '9:16']
    : activeModelOption?.ratios || modelDef.ratios;
  const durationOptions = isJimengSeedanceSelected
    ? jimengSeedanceDurationOptions(externalProviderModel)
    : isAgnesExternalSelected
    ? [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18]
    : isApimartOmni
    ? []
    : isApimartOmniLowprice
    ? [4, 6, 8, 10]
    : isApimartV31
    ? [8]
    : isApimartGrok
    ? Array.from({ length: 25 }, (_, index) => index + 6)
    : isGrok15New
    ? []
    : isHailuo && !isHailuoH3 && !isHailuoH3Max && resolution === '1080p'
    ? [6]
    : activeModelOption?.durations || modelDef.durations || [];
  const resolutionOptions = isJimengSeedanceSelected
    ? jimengSeedanceResolutionOptions(externalProviderModel, jimengSeedanceMode === 'multiframe')
    : isAgnesExternalSelected
    ? ['480p', '720p', '1080p']
    : isApimartOmni
    ? ['720p']
    : isApimartOmniLowprice
    ? ['720p', '1080p', '4k']
    : isApimartV31
    ? ['720p', '1080p', '4k']
    : isApimartGrok
    ? ['480p', '720p']
    : isGrok15New
    ? []
    : activeModelOption?.resolutions || modelDef.resolutions || [];
  // veo-fal 专属
  const vfRatio: string = d?.vfRatio || '16:9';
  const vfDuration: string = d?.vfDuration || '8s';
  const vfResolution: string = d?.vfResolution || '720p';
  const vfAudio: boolean = d?.vfAudio ?? false;
  const vfSafety: number = d?.vfSafety ?? 4;
  // grok-fal 专属
  const gkfMode: 'image_to_video' | 'reference_to_video' = isGrokFalV15
    ? 'image_to_video'
    : d?.gkfMode === 'image_to_video' ? 'image_to_video' : 'reference_to_video';
  const gkfRatio: string = d?.gkfRatio || '16:9';
  const gkfDuration: number = d?.gkfDuration ?? 6;
  const gkfResolution: string = d?.gkfResolution || '720p';
  const gkfReferenceUrls: string = d?.gkfReferenceUrls || '';
  // sora-fal 专属(图片传入默认 base64,与 gpt-image-2-web srf_imgway 默认一致)
  const soraMode: 'auto' | 'text_to_video' | 'image_to_video' = d?.soraMode || 'auto';
  const soraRatio: string = d?.soraRatio || '16:9';
  const soraDuration: number = d?.soraDuration ?? 4;
  const soraResolution: string = d?.soraResolution || '720p';
  const soraDeleteVideo: boolean = d?.soraDeleteVideo ?? true;
  const soraBlockIp: boolean = d?.soraBlockIp ?? false;
  const soraCharacterIds: string = d?.soraCharacterIds || '';
  const soraPrivate: boolean = d?.soraPrivate ?? true;

  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d?.status || 'idle';
  const taskId: string | undefined = d?.taskId;
  const videoUrl: string | undefined = d?.videoUrl;
  const progress: string = d?.progress || '';
  const localPrompt: string = d?.prompt || '';
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
        id: `local::video-image:${url}`,
        kind: 'image' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地图片${i + 1}`,
      })),
      ...localRefVideos.map((url, i) => ({
        id: `local::video-video:${url}`,
        kind: 'video' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地视频${i + 1}`,
      })),
      ...localRefAudios.map((url, i) => ({
        id: `local::video-audio:${url}`,
        kind: 'audio' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地音频${i + 1}`,
      })),
    ],
    [localRefImages, localRefVideos, localRefAudios, id],
  );
  const maxMentionRefs =
    isUpscaler
      ? 0
      : isWan
      ? isWan30 ? wan30Mode === 'i2v' ? 2 : 10 : 1
      : isKling
      ? klingMode === 'i2v' ? 2 : klingMode === 'r2v' ? 4 : 0
      : isVidu
      ? viduMode === 't2v' ? 0 : viduMode === 'i2v' ? 1 : viduMode === 'start-end' ? 2 : viduMode === 'r2v' ? 9 : 14
      : isSeedance25
      ? seedance25Mode === 't2v' ? 0 : seedance25Mode === 'i2v' ? 2 : SEEDANCE25_MULTI_MAX_IMAGES
      : isFlux3
      ? flux3Mode === 'i2v' ? 10 : 0
      : isHailuo
      ? isMinimaxH3Ow
        ? hailuoMode === 't2v' ? 0 : isMinimaxH3OwFast && hailuoMode === 'r2v' ? 9 : 1
        : isHailuoH3 || isHailuoH3Max
        ? hailuoMode === 't2v' ? 0 : hailuoMode === 'i2v' ? 2 : 9
        : hailuoMode === 't2v' ? 0 : 1
      : isHappyHorse
      ? happyHorseMode === 't2v' ? 0 : happyHorseMode === 'i2v' ? 1 : 9
      : isApimartOmni
      ? 16
      : isApimartOmniLowprice
      ? apimartOmniLowpriceMode === 'frame' ? 1 : apimartOmniLowpriceMode === 'reference_images' ? 3 : 0
      : isApimartGrok
      ? 7
      : isApimartV31Fast
      ? 3
      : isApimartV31Quality
      ? 2
      : isApimartV31Lite
      ? 0
      : isVeoOmni
      ? 1
      : isGrok15New
      ? 1
      : isJimengSeedanceSelected
      ? jimengImageLimit
      : isFal && falReg
      ? falReg.paramKind === 'grok-fal' && (isGrokFalV15 || gkfMode !== 'reference_to_video')
        ? 1
        : falReg.maxRefImages
      : modelDef.maxRefImages;
  const maxMentionVideos = isUpscaler
    ? 1
    : isWan30 && wan30Mode === 'r2v'
    ? 5
    : isKling && klingMode === 'edit'
    ? 1
    : isSeedance25 && seedance25Mode === 'multi'
    ? SEEDANCE25_MULTI_MAX_VIDEOS
    : isFlux3 && flux3Mode === 'v2v'
    ? 1
    : isHailuoH3 && hailuoMode === 'multi'
    ? 3
    : isApimartOmni
    ? 1
    : isApimartOmniLowprice && apimartOmniLowpriceMode === 'reference_video'
    ? 1
    : isJimengSeedanceSelected ? jimengSeedanceLimits.videos : 0;
  const maxMentionAudios = isSeedance25 && seedance25Mode === 'multi'
    ? SEEDANCE25_MULTI_MAX_AUDIOS
    : isWan30 && wan30Mode === 'r2v'
    ? 5
    : isMinimaxH3OwAudioDrive
    ? 1
    : isHailuoH3 && hailuoMode === 'multi'
    ? 3
    : isJimengSeedanceSelected ? jimengSeedanceLimits.audios : 0;
  const mentionMaterials = useMemo(
    () => [
      ...[...orderedImages, ...localRefMaterials.filter((m) => m.kind === 'image')].slice(0, maxMentionRefs),
      ...[...orderedVideos, ...localRefMaterials.filter((m) => m.kind === 'video')].slice(0, maxMentionVideos),
      ...[...orderedAudios, ...localRefMaterials.filter((m) => m.kind === 'audio')].slice(0, maxMentionAudios),
    ],
    [orderedImages, orderedVideos, orderedAudios, localRefMaterials, maxMentionRefs, maxMentionVideos, maxMentionAudios],
  );
  const supportsActiveMaterials = isFlux3
    ? flux3Mode === 'i2v' || flux3Mode === 'v2v'
    : isSeedance25
    ? seedance25Mode !== 't2v'
    : Boolean(modelDef.supportImages || modelDef.supportVideos);

  // 分组动态跟随子模型: Seedance / 即梦 CLI 支持 image/video/audio, 其他 (grok/veo/sora) 仅 image
  const previewGroups = useMemo<ReadonlyArray<'text' | 'image' | 'video' | 'audio'>>(
    () => (modelDef.kind === 'seedance' || isJimengSeedanceSelected
      ? ['text', 'image', 'video', 'audio']
      : isApimartOmni
        ? ['text', 'image', 'video']
      : isApimartOmniLowprice
        ? apimartOmniLowpriceMode === 'reference_video' ? ['text', 'video'] : apimartOmniLowpriceMode === 'text' ? ['text'] : ['text', 'image']
      : isUpscaler
        ? ['video']
      : isWan30 && wan30Mode === 'r2v'
        ? ['text', 'image', 'video', 'audio']
      : isWan30
        ? ['text', 'image']
      : isKling && klingMode === 'edit'
        ? ['text', 'video']
      : isSeedance25 && seedance25Mode === 'multi'
        ? ['text', 'image', 'video', 'audio']
      : isFlux3 && flux3Mode === 'v2v'
        ? ['text', 'video']
      : isFlux3 && flux3Mode === 'i2v'
        ? ['text', 'image']
      : isMinimaxH3OwAudioDrive
        ? ['text', 'image', 'audio']
      : isHailuoH3 && hailuoMode === 'multi'
        ? ['text', 'image', 'video', 'audio']
        : ['text', 'image']),
    [modelDef.kind, isJimengSeedanceSelected, isApimartOmni, isApimartOmniLowprice, apimartOmniLowpriceMode, isUpscaler, isWan30, wan30Mode, isKling, klingMode, isSeedance25, seedance25Mode, isFlux3, flux3Mode, isMinimaxH3OwAudioDrive, isHailuoH3, hailuoMode],
  );

  // 收集上游 prompt + 参考图/视频/音频 (按用户拖拽顺序), 合并本地拖入素材
  const collectUpstream = (): { prompt: string; imageUrls: string[]; videoUrls: string[]; audioUrls: string[] } => {
    const prompts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    const upImageUrls = orderedImages.map((m) => m.url).filter((s) => !!s);
    const upVideoUrls = orderedVideos.map((m) => m.url).filter((s) => !!s);
    const upAudioUrls = orderedAudios.map((m) => m.url).filter((s) => !!s);
    const dedupe = (items: string[]) => {
      const out: string[] = [];
      for (const item of items) if (item && !out.includes(item)) out.push(item);
      return out;
    };
    return {
      prompt: prompts.join('\n').trim(),
      imageUrls: dedupe([...upImageUrls, ...localRefImages]),
      videoUrls: dedupe([...upVideoUrls, ...localRefVideos]),
      audioUrls: dedupe([...upAudioUrls, ...localRefAudios]),
    };
  };

  // 本地 URL 转 base64(veo/seedance 路径使用;grok 可直接传 URL)
  const urlToBase64 = async (url: string): Promise<string> => {
    const r = await fetch(url);
    const blob = await r.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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

  // 切主模型时重置所有参数为该模型默认值(避免跨模型参数遗留)
  const switchMainModel = (nextId: string) => {
    const def = builtinVideoModels.find((model) => model.id === nextId) || builtinVideoModels[0] || VIDEO_MODELS[0];
    const nextModel = videoModelOptionsForSource(def, videoBuiltinSource)[0]?.value || def.apiModelOptions[0].value;
    update({
      mainId: def.id,
      model: nextModel,
      videoBuiltinSource,
      ratio: def.defaultRatio,
      duration: def.defaultDuration ?? def.durations?.[0],
      resolution: def.defaultResolution || '',
      ...(nextModel === 'grok-imagine-video-1.5' ? { gkfMode: 'image_to_video' } : {}),
      ...(isGrokVideo15NewModel(nextModel) ? { ratio: '16:9', resolution: '' } : {}),
      ...(nextModel.startsWith('vidu-q3-') ? { viduSeed: -1 } : {}),
      ...(nextModel.startsWith('flux-3-video-')
        ? { ratio: 'auto', duration: 5, resolution: 'hd', flux3Draft: false, flux3AudioMode: 'api_default', flux3SafetyTolerance: 'api_default' }
        : {}),
    });
  };

  const switchBuiltinVideoSource = (nextSource: VideoBuiltinSource) => {
    const nextModels = videoModelsForSource(nextSource);
    const nextDef = nextModels.find((model) => model.id === modelDef.id) || nextModels[0] || VIDEO_MODELS[0];
    const nextModel = videoModelOptionsForSource(nextDef, nextSource)[0]?.value || nextDef.apiModelOptions[0].value;
    update({
      providerSource: 'zhenzhen',
      providerId: '',
      providerModel: '',
      videoBuiltinSource: nextSource,
      mainId: nextDef.id,
      model: nextModel,
      ratio: nextDef.defaultRatio,
      duration: nextDef.defaultDuration ?? nextDef.durations?.[0],
      resolution: nextDef.defaultResolution || '',
      ...(nextModel === ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL
        ? { ratio: '16:9', duration: 0, resolution: '720p' }
        : {}),
      ...(nextModel === ZHENZHEN_VIDEO_GK_V15_MODEL
        ? { ratio: '16:9', duration: 6, resolution: '720p' }
        : {}),
      ...(nextModel === ZHENZHEN_VIDEO_V31_FAST_MODEL
        || nextModel === ZHENZHEN_VIDEO_V31_QUALITY_MODEL
        || nextModel === ZHENZHEN_VIDEO_V31_LITE_MODEL
        ? { ratio: '16:9', duration: 8, resolution: '720p' }
        : {}),
      ...(nextModel === 'grok-imagine-video-1.5' ? { gkfMode: 'image_to_video' } : {}),
      ...(isGrokVideo15NewModel(nextModel) ? { ratio: '16:9', size: '1280x720', resolution: '' } : {}),
      ...(nextModel.startsWith('vidu-q3-') ? { viduSeed: -1 } : {}),
      ...(nextModel.startsWith('flux-3-video-')
        ? { ratio: 'auto', duration: 5, resolution: 'hd', flux3Draft: false, flux3AudioMode: 'api_default', flux3SafetyTolerance: 'api_default' }
        : {}),
    });
  };

  // v1.2.9.11: 返回 Promise，调用方 await 直到任务真正成功/失败/超时才 resolve/reject。
  //   原设计中 startPolling 启动 setInterval 后立即返回 → handleGenerate 提交成功后也立即返回 →
  //   useRunTrigger 认为 runFn 完成 markDone(true)。 但实际任务 videoUrl 还未赋值 → LoopNode awaitNode
  //   立即继续 → extractFromNode 读不到 videoUrl → result=null → failCount++。
  //   修复: 轮询完成才 resolve，handleGenerate await 它，markDone 时机=任务真正结束。
  const startPolling = (tid: string, runId: number, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      pollRejectRef.current = reject;
      let elapsed = 0;
      const POLL_INT = VIDEO_POLL_INTERVAL_MS;
      const MAX = VIDEO_MAX_POLL; // 60 分钟
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
          logBus.error('轮询超时', src);
          reject(new Error('轮询超时'));
          return;
        }
        pollInFlight = true;
        try {
          const r = isWan
            ? await queryWan(tid)
            : isSeedance25
              ? await querySeedance(tid, 'seedance-nz')
            : isFlux3
              ? await queryFlux3(tid)
            : isHailuo
              ? await queryHailuo(tid)
            : isKling
              ? await queryKling(tid)
            : isUpscaler
              ? isFashVsr ? await queryFashVsr(tid) : await queryUpscaler(tid)
            : isVidu
              ? await queryVidu(tid)
            : isHappyHorse
              ? await queryHappyHorse(tid)
            : isApimartBudgetVideo
              ? await querySeedance(tid, 'seedance-nz')
              : await queryVideo(tid, apiModel);
          const normalizedStatus = String(r.status || '').trim().toUpperCase();
          const currentProgress = String(r.progress ?? '');
          await reporter?.polling({
            provider: isSeedanceNzVideo ? 'seedance-nz' : 'zhenzhen',
            model: apiModel,
            taskId: tid,
            recovery: {
              kind: isWan ? 'wan' : isSeedance25 ? 'seedance' : isFlux3 ? 'flux3' : isHailuo ? 'hailuo' : isKling ? 'kling' : isFashVsr ? 'fashvsr' : isUpscaler ? 'upscaler' : isVidu ? 'vidu' : isHappyHorse ? 'happyhorse' : isApimartBudgetVideo ? 'seedance' : 'video',
              taskId: tid, model: apiModel, pollIntervalMs: POLL_INT, maxPolls: MAX,
            },
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: MAX,
            status: normalizedStatus,
            progress: currentProgress,
          });
          if (!isCurrentGenerationRun(runId)) {
            rejectStoppedGeneration(reject);
            return;
          }
          if (currentProgress && currentProgress !== lastProgress) {
            lastProgress = currentProgress;
            logBus.debug(`[${elapsed}/${MAX}] status=${r.status} progress=${currentProgress}`, src);
          }
          if (normalizedStatus === 'MATERIALIZING') {
            update({ status: 'polling', progress: '100% · 正在下载' });
            if (elapsed === 1 || elapsed % 10 === 0) {
              logBus.warn(
                r.error || '视频已经生成，正在适配 TUN/代理网络并安全下载；原任务会保留，不会重复提交',
                src,
              );
            }
          } else if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(normalizedStatus) && r.videoUrl) {
            const completedDraftCache = isFlux3 ? String((r as any).draftCache || '').trim() : '';
            pollRejectRef.current = null;
            stopPoll();
            update({
              status: 'success',
              videoUrl: r.videoUrl,
              progress: '100%',
              provider: isSeedanceNzVideo ? 'seedance-nz' : 'zhenzhen',
              apiModel,
              taskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              ...(isFlux3 ? { flux3DraftCacheResult: completedDraftCache || null } : {}),
            });
            await reporter?.providerResponse({
              provider: isSeedanceNzVideo ? 'seedance-nz' : 'zhenzhen',
              model: apiModel,
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
            taskCompletionSound.notifyComplete(id, 'video');
            resolve();
          } else if (['FAILURE', 'FAILED'].includes(normalizedStatus)) {
            pollRejectRef.current = null;
            stopPoll();
            const msg = normalizeProviderErrorMessage(r.failReason, '生成失败');
            await reporter?.providerResponse({
              provider: isSeedanceNzVideo ? 'seedance-nz' : 'zhenzhen',
              model: apiModel,
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
            update({ status: 'polling', progress: currentProgress });
          }
        } catch (e: any) {
          if (!isCurrentGenerationRun(runId)) {
            rejectStoppedGeneration(reject);
            return;
          }
          // 偶尔失败不停止
          console.warn('轮询出错', e?.message);
        } finally {
          pollInFlight = false;
        }
      }, POLL_INT);
    });
  };

  // FAL 轮询
  const falPollRef = useRef<{ endpoint?: string; requestId?: string } | null>(null);

  // v1.2.9.11: 同样改造为 Promise（理由同 startPolling）
  const startFalPolling = (runId: number, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      pollRejectRef.current = reject;
      let elapsed = 0;
      const POLL_INT = VIDEO_FAL_POLL_INTERVAL_MS;
      const MAX = VIDEO_FAL_MAX_POLL; // 60分钟
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
          update({ status: 'error', error: 'FAL 轮询超时' });
          setError('FAL 轮询超时');
          logBus.error('FAL 轮询超时', src);
          reject(new Error('FAL 轮询超时'));
          return;
        }
        pollInFlight = true;
        try {
          const r = await queryVideoFal(falPollRef.current!);
          await reporter?.polling({
            provider: 'fal',
            model: apiModel,
            requestId: falPollRef.current?.requestId || null,
            recovery: {
              kind: 'video-fal',
              requestId: falPollRef.current?.requestId || null,
              endpoint: falPollRef.current?.endpoint,
              model: apiModel,
              pollIntervalMs: POLL_INT,
              maxPolls: MAX,
            },
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: MAX,
            status: r.status,
          });
          if (!isCurrentGenerationRun(runId)) {
            rejectStoppedGeneration(reject);
            return;
          }
          if (elapsed % 10 === 0) logBus.debug(`[FAL ${elapsed}/${MAX}] status=${r.status}`, src);
          if (String(r.status || '').toLowerCase() === 'materializing') {
            update({ status: 'polling', progress: '100% · 正在下载' });
            if (elapsed === 1 || elapsed % 10 === 0) {
              logBus.warn(
                r.error || 'FAL 视频已经生成，正在适配 TUN/代理网络并安全下载；不会重复提交任务',
                src,
              );
            }
          } else if (r.status === 'completed' && r.videoUrl) {
            pollRejectRef.current = null;
            stopPoll();
            update({
              status: 'success',
              videoUrl: r.videoUrl,
              progress: '100%',
              provider: 'fal',
              apiModel,
              requestId: r.requestId || falPollRef.current?.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
            });
            await reporter?.providerResponse({
              provider: 'fal',
              model: apiModel,
              requestId: r.requestId || falPollRef.current?.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            logBus.success(`FAL 视频完成 → ${r.videoUrl}`, src);
            taskCompletionSound.notifyComplete(id, 'video');
            resolve();
          } else if (r.status === 'failed') {
            pollRejectRef.current = null;
            stopPoll();
            const msg = normalizeProviderErrorMessage(r.error, 'FAL 生成失败');
            await reporter?.providerResponse({
              provider: 'fal',
              model: apiModel,
              requestId: r.requestId || falPollRef.current?.requestId,
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
            logBus.error(`FAL 生成失败: ${msg}`, src);
            reject(new Error(msg));
          } else {
            update({ status: 'polling', progress: `${Math.min(95, Math.round(20 + elapsed / MAX * 75))}%` });
          }
        } catch (e: any) {
          if (!isCurrentGenerationRun(runId)) {
            rejectStoppedGeneration(reject);
            return;
          }
          console.warn('FAL 轮询出错', e?.message);
        } finally {
          pollInFlight = false;
        }
      }, POLL_INT);
    });
  };

  const handleGenerate = async (reporter?: RunNodeLifecycleReporter) => {
    setError(null);
    const { prompt: upstreamPrompt, imageUrls, videoUrls, audioUrls } = collectUpstream();
    const resolvedLocalPrompt = resolveMediaMentions(localPrompt, promptMentions, mentionMaterials);
    const finalPrompt = (upstreamPrompt || resolvedLocalPrompt || '').trim();
    if (
      !finalPrompt
      && !(isWan && (!isWan30 || wan30Mode === 'i2v'))
      && !isUpscaler
      && !(isHappyHorse && happyHorseMode !== 't2v')
      && !(isHailuo && hailuoMode === 'i2v' && !isHailuoH3Max)
      && !isMinimaxH3OwAudioDrive
      && !(isSeedance25 && seedance25Mode === 'i2v')
      && !(isFlux3 && flux3Mode === 'draft-enhance')
      && !(isKling && klingMode === 'i2v')
      && !(isVidu && !['t2v', 'short-play'].includes(viduMode))
      && !(isApimartOmni && (imageUrls.length > 0 || videoUrls.length > 0))
      && !(isJimengSeedanceSelected
        && jimengSeedanceMode === 'omni'
        && (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0))
    ) {
      setError('未连接 text 节点也未填写 prompt');
      logBus.error('生成中止: 缺少 prompt', src);
      return;
    }
    const jimengUsesMultimodal = isJimengSeedanceSelected
      && (videoUrls.length > 0 || audioUrls.length > 0 || (jimengSeedanceMode === 'omni' && imageUrls.length > 0));
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
    if (isHappyHorse && happyHorseMode !== 't2v' && imageUrls.length === 0) {
      setError(`Happy Horse ${happyHorseMode} 至少需要 1 张参考图`);
      logBus.error(`生成中止: Happy Horse ${happyHorseMode} 缺少参考图`, src);
      return;
    }
    if (isHailuo && hailuoMode === 'i2v' && imageUrls.length === 0) {
      const hailuoLabel = isMinimaxH3Ow
        ? 'MiniMax H3 OW'
        : isHailuoH3Max ? 'MiniMax H3 Max' : isHailuoH3 ? 'Hailuo H3' : 'Hailuo 2.3';
      setError(`${hailuoLabel} 图生视频必须连接或拖入第 1 张首帧图`);
      logBus.error(`生成中止: ${hailuoLabel} 图生视频缺少首帧图`, src);
      return;
    }
    if (isSeedance25 && seedance25Mode === 't2v'
      && (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0)) {
      setError('Seedance 2.5 文生视频不接受参考素材，请断开图片、视频和音频');
      logBus.error('生成中止: Seedance 2.5 文生视频混入参考素材', src);
      return;
    }
    if (isSeedance25 && seedance25Mode === 'i2v') {
      if (imageUrls.length < 1 || imageUrls.length > 2) {
        setError('Seedance 2.5 图生视频必须提供 1-2 张图片（首帧/可选尾帧）');
        logBus.error('生成中止: Seedance 2.5 图生视频图片数量不合法', src);
        return;
      }
      if (videoUrls.length > 0 || audioUrls.length > 0) {
        setError('Seedance 2.5 图生视频不接受视频或音频素材');
        logBus.error('生成中止: Seedance 2.5 图生视频混入视频或音频', src);
        return;
      }
    }
    if (isSeedance25 && seedance25Mode === 'multi'
      && imageUrls.length === 0 && videoUrls.length === 0 && audioUrls.length === 0) {
      setError('Seedance 2.5 多模态参考至少需要 1 个图片、视频或音频素材');
      logBus.error('生成中止: Seedance 2.5 多模态参考缺少素材', src);
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
    if (isFlux3 && flux3Mode === 't2v' && (imageUrls.length || videoUrls.length || audioUrls.length)) {
      setError('FLUX 3 文生视频只接受提示词，请断开图片、视频和音频素材');
      logBus.error('生成中止: FLUX 3 文生视频混入参考素材', src);
      return;
    }
    if (isFlux3 && flux3Mode === 'i2v') {
      if (imageUrls.length < 1 || imageUrls.length > 10) {
        setError('FLUX 3 图生视频必须提供 1-10 张排序关键帧图片');
        logBus.error('生成中止: FLUX 3 图生视频关键帧数量不合法', src);
        return;
      }
      if (videoUrls.length || audioUrls.length) {
        setError('FLUX 3 图生视频不接受视频或音频素材');
        return;
      }
    }
    if (isFlux3 && flux3Mode === 'v2v') {
      if (videoUrls.length !== 1) {
        setError('FLUX 3 视频编辑必须且只能提供 1 个 MP4 视频');
        logBus.error('生成中止: FLUX 3 视频编辑输入视频数量不合法', src);
        return;
      }
      if (imageUrls.length || audioUrls.length) {
        setError('FLUX 3 视频编辑不接受图片或音频素材');
        return;
      }
    }
    if (isFlux3 && flux3Mode === 'draft-enhance') {
      if (!flux3DraftCache.trim()) {
        setError('FLUX 3 草稿增强必须填写同线路已完成 Draft 任务返回的 draft_cache');
        logBus.error('生成中止: FLUX 3 草稿增强缺少 draft_cache', src);
        return;
      }
      if (imageUrls.length || videoUrls.length || audioUrls.length) {
        setError('FLUX 3 草稿增强只使用 draft_cache，不接受参考素材');
        return;
      }
    }
    if (isMinimaxH3Ow && hailuoMode === 'r2v') {
      const maxImages = isMinimaxH3OwFast ? 9 : 1;
      if (imageUrls.length < 1 || imageUrls.length > maxImages) {
        setError(`MiniMax H3 OW 参考生视频必须连接或拖入 1-${maxImages} 张参考图`);
        logBus.error('生成中止: MiniMax H3 OW 参考生视频图片数量不合法', src);
        return;
      }
    }
    if (isMinimaxH3Ow && hailuoMode === 't2v'
      && (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0)) {
      setError('MiniMax H3 OW 文生视频不接受图片、视频或音频素材');
      logBus.error('生成中止: MiniMax H3 OW 文生视频混入参考素材', src);
      return;
    }
    if (isMinimaxH3OwFast && hailuoMode === 'i2v' && imageUrls.length !== 1) {
      setError('MiniMax H3 OW Fast 图生视频必须且只能连接或拖入 1 张首帧图');
      logBus.error('生成中止: MiniMax H3 OW Fast 图生视频首帧数量不合法', src);
      return;
    }
    if (isMinimaxH3OwAudioDrive && (imageUrls.length !== 1 || audioUrls.length !== 1)) {
      setError('MiniMax H3 OW 音频驱动必须且只能连接或拖入 1 张图片与 1 段音频');
      logBus.error('生成中止: MiniMax H3 OW 音频驱动素材数量不合法', src);
      return;
    }
    if (isMinimaxH3OwAudioDrive && videoUrls.length > 0) {
      setError('MiniMax H3 OW 音频驱动不接受视频素材');
      logBus.error('生成中止: MiniMax H3 OW 音频驱动混入视频素材', src);
      return;
    }
    if (isMinimaxH3OwFast && !isMinimaxH3OwAudioDrive && (videoUrls.length > 0 || audioUrls.length > 0)) {
      setError('MiniMax H3 OW Fast 只接受图片参考，不接受视频或音频素材');
      logBus.error('生成中止: MiniMax H3 OW Fast 混入视频或音频素材', src);
      return;
    }
    if (
      isHailuoH3
      && hailuoMode === 'multi'
      && imageUrls.length === 0
      && videoUrls.length === 0
      && audioUrls.length === 0
    ) {
      setError('Hailuo H3 多模态参考至少需要 1 个图片、视频或音频素材');
      logBus.error('生成中止: Hailuo H3 多模态参考缺少素材', src);
      return;
    }
    if (isKling && klingMode === 'i2v' && imageUrls.length === 0) {
      setError('Kling 图生视频必须连接或拖入第 1 张首帧图');
      logBus.error('生成中止: Kling 图生视频缺少首帧图', src);
      return;
    }
    if (isKlingUpstreamUnavailable) {
      setError('该 Kling O3 参考生视频模型已按官方协议接入，但参考插件当前实测上游提交返回 502，暂时禁用以避免无效请求');
      logBus.error('生成中止: Kling O3 参考生视频上游当前不可用', src);
      return;
    }
    if (isKling && klingMode === 'r2v' && imageUrls.length === 0) {
      setError('Kling 参考生视频至少需要 1 张参考图');
      logBus.error('生成中止: Kling 参考生视频缺少参考图', src);
      return;
    }
    if (isKling && klingMode === 'edit' && videoUrls.length === 0) {
      setError('Kling 视频编辑必须连接或拖入 1 个输入视频');
      logBus.error('生成中止: Kling 视频编辑缺少输入视频', src);
      return;
    }
    if (isUpscaler && videoUrls.length !== 1) {
      setError(isFashVsr
        ? 'FlashVSR 必须连接或拖入且只能保留 1 个 480P、3-15 秒视频'
        : 'Zhenzhen Upscaler 必须连接或拖入且只能保留 1 个 MP4 视频');
      logBus.error(`生成中止: ${isFashVsr ? 'FlashVSR' : 'Zhenzhen Upscaler'} 输入视频数量必须为 1`, src);
      return;
    }
    if (isViduUpstreamUnavailable) {
      setError('该 Vidu Q3 模型已按官方协议接入，但当前上游提交返回 fail_to_fetch_task，暂时禁用以避免无效请求');
      logBus.error('生成中止: Vidu Q3 上游当前不可用', src);
      return;
    }
    if (isVidu && viduMode === 'i2v' && imageUrls.length === 0) {
      setError('Vidu Q3 图生视频必须连接或拖入第 1 张首帧图');
      logBus.error('生成中止: Vidu Q3 图生视频缺少首帧图', src);
      return;
    }
    if (isVidu && viduMode === 'start-end' && imageUrls.length < 2) {
      setError('Vidu Q3 首尾帧视频必须连接或拖入起始帧和结束帧两张图片');
      logBus.error('生成中止: Vidu Q3 首尾帧视频缺少两张图片', src);
      return;
    }
    if (isVidu && viduMode === 'r2v' && imageUrls.length === 0) {
      setError('Vidu Q3 参考生视频至少需要 1 张参考图');
      logBus.error('生成中止: Vidu Q3 参考生视频缺少参考图', src);
      return;
    }
    if (isVidu && viduMode === 'short-play') {
      if (imageUrls.length === 0) {
        setError('Vidu Q3 短剧成片至少需要 1 张参考资产图');
        logBus.error('生成中止: Vidu Q3 短剧成片缺少参考资产图', src);
        return;
      }
      if (!viduScriptName.trim()) {
        setError('Vidu Q3 短剧成片必须填写脚本名称');
        logBus.error('生成中止: Vidu Q3 短剧成片缺少脚本名称', src);
        return;
      }
      if (!viduAssetNamePrefix.trim() || !viduAssetDescription.trim()) {
        setError('Vidu Q3 短剧资产名称前缀和描述不能为空');
        logBus.error('生成中止: Vidu Q3 短剧资产信息不完整', src);
        return;
      }
    }
    if (isWan30 && finalPrompt.length > 20000) {
      setError('Wan 3.0 提示词不能超过 20000 字符');
      return;
    }
    if (isWan30 && wan30Mode === 'i2v') {
      if (imageUrls.length < 1 || imageUrls.length > 2) {
        setError('Wan 3.0 I2V 必须提供 1-2 张图片（首帧/可选尾帧）');
        logBus.error('生成中止: Wan 3.0 I2V 图片数量不合法', src);
        return;
      }
      if (videoUrls.length || audioUrls.length || wan30FileUrl.trim() || wan30LinkUrl.trim()) {
        setError('Wan 3.0 I2V 只接受首帧与可选尾帧图片');
        return;
      }
    } else if (isWan30) {
      if (imageUrls.length > 10 || videoUrls.length > 5 || audioUrls.length > 5) {
        setError('Wan 3.0 R2V 最多支持 10 张图片、5 个视频和 5 个音频');
        return;
      }
      if (wan30FileUrl.trim() && wan30LinkUrl.trim()) {
        setError('Wan 3.0 R2V 的文件 URL 与网页 URL 不能同时填写');
        return;
      }
      for (const [label, value] of [['文件 URL', wan30FileUrl], ['网页 URL', wan30LinkUrl]] as const) {
        if (!value.trim()) continue;
        try {
          const parsed = new URL(value.trim());
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
        } catch {
          setError(`Wan 3.0 ${label} 必须是 http(s) URL`);
          return;
        }
      }
    } else if (isWan && imageUrls.length === 0) {
      setError('Wan 2.7 Spicy 必须连接或拖入 1 张首帧图');
      logBus.error('生成中止: Wan 2.7 Spicy 缺少首帧图', src);
      return;
    }
    if (isVeoOmni && imageUrls.length === 0) {
      setError('veo-omni-10s 需要 1 张参考图');
      logBus.error('生成中止: veo-omni-10s 缺少参考图', src);
      return;
    }
    if (isGrok15New && imageUrls.length === 0) {
      setError('Grok 1.5 New 需要 1 张参考图');
      logBus.error('生成中止: Grok 1.5 New 缺少参考图', src);
      return;
    }
    const runId = nextGenerationRun();
    cancelActivePoll();
    falPollRef.current = null;
    const traceProvider = isExternalSelected && providerSelection.provider
      ? providerSelection.provider.id
      : isFal
        ? 'fal'
        : isSeedanceNzVideo
          ? 'seedance-nz'
          : 'zhenzhen';
    const traceModel = isExternalSelected && providerSelection.provider ? externalProviderModel : apiModel;
    await reporter?.providerRequest({ provider: traceProvider, model: traceModel });
    taskCompletionSound.primeAudio();
    update({ status: 'submitting', error: null, videoUrl: null, taskId: null });
    try {
      if (isExternalSelected && providerSelection.provider) {
        const providerModel = externalProviderModel;
        const refs = imageUrls.slice(0, Math.max(1, maxMentionRefs || modelDef.maxRefImages || 8));
        const videoRefs = videoUrls.slice(0, maxMentionVideos);
        const audioRefs = audioUrls.slice(0, maxMentionAudios);
        logBus.info(
          isJimengSeedanceSelected
            ? `扩展平台视频提交: ${providerSelection.provider.label || providerSelection.provider.id} · ${providerModel} · 图${refs.length}/视${videoRefs.length}/音${audioRefs.length}`
            : `扩展平台视频提交: ${providerSelection.provider.label || providerSelection.provider.id} · ${providerModel} · refs=${refs.length}`,
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
          seed: seed > 0 ? seed : undefined,
          images: refs,
          videos: videoRefs,
          audios: audioRefs,
          providerParams: isJimengSeedanceSelected
            ? { ...providerParams, frameMode: jimengSeedanceMode }
            : providerParams,
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
          apiModel: traceModel,
          requestId: r.requestId,
          transportHttpStatus: r.transportHttpStatus,
          upstreamHttpStatus: r.upstreamHttpStatus,
          usage: r.usage,
          lastPrompt: finalPrompt,
          progress: '100%',
        });
        logBus.success(`扩展平台视频完成 → ${nextVideoUrl}`, src);
        taskCompletionSound.notifyComplete(id, 'video');
        return;
      }

      if (isApimartBudgetVideo) {
        const apimartImages = imageUrls.slice(0, maxMentionRefs);
        const apimartVideos = (isApimartOmni || (isApimartOmniLowprice && apimartOmniLowpriceMode === 'reference_video')) ? videoUrls.slice(0, 1) : [];
        logBus.info(
          `提交平价AI小屋视频: ${apiModel} · ${isApimartOmni ? '时长由模型决定' : `${duration}s`} · ${resolution} · ${ratio} · 图${apimartImages.length}/视${apimartVideos.length}`,
          src,
        );
        const result = await submitSeedance({
          model: apiModel,
          prompt: finalPrompt,
          duration: isApimartOmni ? undefined : duration,
          ratio,
          resolution,
          refImages: apimartImages.length ? apimartImages : undefined,
          videos: apimartVideos.length ? apimartVideos : undefined,
          ...(isApimartOmniLowprice ? {
            mode: apimartOmniLowpriceMode,
            aspect_ratio: ratio,
            nsfw_check: apimartOmniLowpriceNsfwCheck,
          } : {}),
          taskProvider: 'seedance-nz',
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({
          status: 'polling',
          taskId: result.taskId,
          lastPrompt: finalPrompt,
          progress: '0%',
          provider: 'seedance-nz',
          apiModel,
        });
        logBus.info(`平价AI小屋视频任务 ${result.taskId} 已提交，开始轮询`, src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isSeedance25) {
        const seedance25Images = imageUrls.slice(0, seedance25Mode === 'i2v' ? 2 : seedance25Mode === 'multi' ? SEEDANCE25_MULTI_MAX_IMAGES : 0);
        const seedance25Videos = seedance25Mode === 'multi' ? videoUrls.slice(0, SEEDANCE25_MULTI_MAX_VIDEOS) : [];
        const seedance25Audios = seedance25Mode === 'multi' ? audioUrls.slice(0, SEEDANCE25_MULTI_MAX_AUDIOS) : [];
        logBus.info(
          `提交 Seedance 2.5: ${apiModel} · ${duration === -1 ? '自动时长' : `${duration}s`} · ${resolution} · ${ratio} · 图${seedance25Images.length}/视${seedance25Videos.length}/音${seedance25Audios.length}`,
          src,
        );
        const result = await submitSeedance({
          model: apiModel,
          prompt: finalPrompt,
          duration,
          ratio,
          resolution,
          generate_audio: generateAudio,
          return_last_frame: returnLastFrame,
          seed: seed > 0 ? seed : undefined,
          ...(seedance25Mode === 'i2v'
            ? {
                firstFrame: seedance25Images[0],
                lastFrame: seedance25Images[1],
              }
            : seedance25Mode === 'multi'
              ? {
                  refImages: seedance25Images,
                  videos: seedance25Videos,
                  audios: seedance25Audios,
                }
              : {}),
          taskProvider: 'seedance-nz',
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: result.model || traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({
          status: 'polling',
          taskId: result.taskId,
          lastPrompt: finalPrompt,
          progress: '0%',
          provider: 'seedance-nz',
          apiModel: result.model || apiModel,
          taskType: result.taskType || seedance25Mode,
        });
        logBus.info('Seedance 2.5 任务已提交，开始轮询', src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isFlux3) {
        const fluxImages = flux3Mode === 'i2v' ? imageUrls.slice(0, 10) : [];
        const fluxVideos = flux3Mode === 'v2v' ? videoUrls.slice(0, 1) : [];
        logBus.info(
          `提交 FLUX 3: ${apiModel} · ${flux3Duration}s · ${flux3Resolution} · ${ratio} · 图${fluxImages.length}/视${fluxVideos.length} · draft=${flux3Draft}`,
          src,
        );
        const result = await submitFlux3({
          model: apiModel as Flux3VideoModel,
          prompt: flux3Mode === 'draft-enhance' ? undefined : finalPrompt,
          duration: flux3Duration,
          ratio: ratio as 'auto' | '21:9' | '2:1' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16',
          resolution: flux3Resolution,
          images: fluxImages.length ? fluxImages : undefined,
          videos: fluxVideos.length ? fluxVideos : undefined,
          draft: flux3Mode === 'draft-enhance' ? false : flux3Draft,
          draftCache: flux3Mode === 'draft-enhance' ? flux3DraftCache.trim() : undefined,
          audioMode: flux3AudioMode,
          safetyTolerance: flux3SafetyTolerance,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({
          status: 'polling',
          taskId: result.taskId,
          lastPrompt: finalPrompt,
          progress: '0%',
          provider: 'seedance-nz',
          apiModel,
          flux3DraftCacheResult: null,
        });
        logBus.info('FLUX 3 Video 任务已提交，开始轮询', src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isWan) {
        if (isWan30) {
          const wan30Images = imageUrls.slice(0, wan30Mode === 'i2v' ? 2 : 10);
          const wan30Videos = wan30Mode === 'r2v' ? videoUrls.slice(0, 5) : [];
          const wan30Audios = wan30Mode === 'r2v' ? audioUrls.slice(0, 5) : [];
          const wan30Resolution = ['480P', '720P', '1080P'].includes(resolution) ? resolution : '480P';
          logBus.info(
            `提交 Wan 3.0: ${apiModel} · ${duration === -1 ? 'auto' : `${duration}s`} · ${wan30Resolution} · ${ratio} · 图${wan30Images.length}/视${wan30Videos.length}/音${wan30Audios.length}`,
            src,
          );
          const result = await submitWan({
            model: apiModel as WanSubmitRequest['model'],
            prompt: finalPrompt || undefined,
            duration: duration === -1 ? 'auto' : Number(duration) || 2,
            resolution: wan30Resolution as '480P' | '720P' | '1080P',
            ratio: (['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(ratio) ? ratio : 'adaptive') as WanSubmitRequest['ratio'],
            images: wan30Images,
            videos: wan30Videos,
            audios: wan30Audios,
            generateAudio,
            enableThinking: wan30SupportsThinking && wan30EnableThinking,
            fileUrl: wan30Mode === 'r2v' ? wan30FileUrl.trim() || undefined : undefined,
            linkUrl: wan30Mode === 'r2v' ? wan30LinkUrl.trim() || undefined : undefined,
            seed: wan30Seed,
          }, { submissionKey: reporter?.providerSubmissionKey });
          if (!isCurrentGenerationRun(runId)) return;
          await reporter?.providerSubmitted({
            provider: traceProvider,
            model: traceModel,
            upstreamTaskId: result.taskId,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
          });
          update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%', provider: 'seedance-nz', apiModel });
          logBus.info(`Wan 3.0 任务 ${result.taskId} 已提交，开始轮询`, src);
          await startPolling(result.taskId, runId, reporter);
          return;
        }

        const firstImage = imageUrls[0];
        logBus.info(
          `提交 Wan 2.7 Spicy: ${apiModel} · ${duration}s · ${resolution || '720p'} · promptExtend=${wanPromptExtend}`,
          src,
        );
        const result = await submitWan({
          model: 'wan-2.7-spicy-i2v',
          prompt: finalPrompt || undefined,
          duration: Number(duration) || 2,
          resolution: resolution === '1080p' ? '1080p' : '720p',
          images: [firstImage],
          negativePrompt: wanNegativePrompt.trim() || undefined,
          audioUrl: wanAudioUrl.trim() || undefined,
          promptExtend: wanPromptExtend,
          seed: wanSeed,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%' });
        logBus.info(`Wan 2.7 Spicy 任务 ${result.taskId} 已提交，开始轮询`, src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isHailuo) {
        const hailuoImages = hailuoMode === 'i2v' || hailuoMode === 'r2v' || hailuoMode === 'audio-drive'
          ? imageUrls.slice(0, isHailuoH3 || isHailuoH3Max ? 2 : isMinimaxH3OwFast && hailuoMode === 'r2v' ? 9 : 1)
          : hailuoMode === 'multi' ? imageUrls.slice(0, 9) : [];
        const hailuoVideos = isHailuoH3 && hailuoMode === 'multi' ? videoUrls.slice(0, 3) : [];
        const hailuoAudios = isMinimaxH3OwAudioDrive
          ? audioUrls.slice(0, 1)
          : isHailuoH3 && hailuoMode === 'multi' ? audioUrls.slice(0, 3) : [];
        const hailuoResolution = isMinimaxH3Ow
          ? resolution === '720p' ? '720p' : '480p'
          : isHailuoH3Max ? resolution === '768P' ? '768P' : '480P'
          : isHailuoH3 ? resolution === '768P' ? '768P' : '2K' : resolution === '1080p' ? '1080p' : '768p';
        const hailuoLabel = isMinimaxH3Ow
          ? 'MiniMax H3 OW'
          : isHailuoH3Max ? 'MiniMax H3 Max' : isHailuoH3 ? 'Hailuo H3' : 'Hailuo 2.3';
        logBus.info(
          `提交 ${hailuoLabel}: ${apiModel} · ${hailuoDuration}s · ${hailuoResolution} · ${ratio} · 图${hailuoImages.length}/视${hailuoVideos.length}/音${hailuoAudios.length}`,
          src,
        );
        const result = await submitHailuo({
          model: apiModel as HailuoModel,
          prompt: finalPrompt || undefined,
          duration: hailuoDuration,
          ratio,
          resolution: hailuoResolution,
          images: hailuoImages.length ? hailuoImages : undefined,
          videos: hailuoVideos.length ? hailuoVideos : undefined,
          audios: hailuoAudios.length ? hailuoAudios : undefined,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%' });
        logBus.info(`${hailuoLabel} 任务已提交，开始轮询`, src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isKling) {
        const klingImages = klingMode === 'i2v'
          ? imageUrls.slice(0, 2)
          : klingMode === 'r2v' ? imageUrls.slice(0, 4) : [];
        const klingVideos = klingMode === 'edit' ? videoUrls.slice(0, 1) : [];
        logBus.info(
          `提交 Kling: ${apiModel} · ${klingDuration}s · ${klingMode === 'edit' ? 'video-edit' : ratio} · refs=${klingImages.length} · videos=${klingVideos.length}`,
          src,
        );
        const result = await submitKling({
          model: apiModel as KlingModel,
          prompt: finalPrompt || undefined,
          duration: klingDuration,
          ...(klingMode === 'edit'
            ? { videos: klingVideos }
            : {
                ratio,
                negativePrompt: klingNegativePrompt.trim() || undefined,
                images: klingImages.length ? klingImages : undefined,
              }),
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%' });
        logBus.info('Kling 任务已提交，开始轮询', src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isUpscaler) {
        if (isFashVsr) {
          logBus.info('提交 FlashVSR: 单个 480P、3-15 秒视频', src);
          const result = await submitFashVsr({
            model: FASHVSR_VIDEO_UPSCALE_MODEL,
            videos: [videoUrls[0]],
          }, { submissionKey: reporter?.providerSubmissionKey });
          if (!isCurrentGenerationRun(runId)) return;
          await reporter?.providerSubmitted({
            provider: traceProvider,
            model: traceModel,
            upstreamTaskId: result.taskId,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
          });
          update({ status: 'polling', taskId: result.taskId, lastPrompt: '', progress: '0%' });
          logBus.info('FlashVSR 任务已提交，开始轮询', src);
          await startPolling(result.taskId, runId, reporter);
          return;
        }
        const targetResolution: UpscalerResolution = ['720p', '1080p', '2k', '4k'].includes(resolution)
          ? resolution as UpscalerResolution
          : '1080p';
        logBus.info(`提交 Zhenzhen Upscaler: ${targetResolution} · videos=1`, src);
        const result = await submitUpscaler({
          model: 'zhenzhen-upscaler',
          resolution: targetResolution,
          videos: [videoUrls[0]],
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: '', progress: '0%' });
        logBus.info('Zhenzhen Upscaler 任务已提交，开始轮询', src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isVidu) {
        const viduImages = viduMode === 't2v'
          ? []
          : imageUrls.slice(0, viduMode === 'i2v' ? 1 : viduMode === 'start-end' ? 2 : viduMode === 'r2v' ? 9 : 14);
        logBus.info(
          `提交 Vidu Q3: ${apiModel} · ${viduDuration}s · ${viduResolution} · ${viduRatio} · refs=${viduImages.length}`,
          src,
        );
        const result = await submitVidu({
          model: apiModel as ViduQ3Model,
          prompt: finalPrompt || undefined,
          duration: viduDuration,
          ratio: viduRatio,
          resolution: viduResolution,
          seed: viduSeed,
          images: viduImages.length ? viduImages : undefined,
          ...(viduMode === 'short-play'
            ? {
                scriptName: viduScriptName.trim(),
                style: viduStyle.trim(),
                assetType: viduAssetType,
                assetNamePrefix: viduAssetNamePrefix.trim(),
                assetDescription: viduAssetDescription.trim(),
              }
            : {}),
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%' });
        logBus.info('Vidu Q3 任务已提交，开始轮询', src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      if (isHappyHorse) {
        const happyImages = happyHorseMode === 't2v'
          ? []
          : imageUrls.slice(0, happyHorseMode === 'i2v' ? 1 : 9);
        logBus.info(
          `提交 Happy Horse: ${apiModel} · ${duration}s · ${resolution || '720p'} · ${ratio} · refs=${happyImages.length}`,
          src,
        );
        const result = await submitHappyHorse({
          model: apiModel as 'happyhorse-1.1-t2v' | 'happyhorse-1.1-i2v' | 'happyhorse-1.1-r2v',
          prompt: finalPrompt || undefined,
          duration: Number(duration) || 4,
          ratio,
          resolution: (resolution === '1080p' ? '1080p' : '720p'),
          images: happyImages.length ? happyImages : undefined,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%' });
        logBus.info(`Happy Horse 任务 ${result.taskId} 已提交，开始轮询`, src);
        await startPolling(result.taskId, runId, reporter);
        return;
      }

      // === FAL 分支 ===
      if (isFal && falReg) {
        const falMaxRefs =
          falReg.paramKind === 'grok-fal' && (isGrokFalV15 || gkfMode !== 'reference_to_video')
            ? 1
            : falReg.maxRefImages;
        const refs = imageUrls.slice(0, falMaxRefs);
        let images: string[] | undefined;
        if (refs.length > 0) {
          // FAL 参考图直传 URL 或 base64，后端会处理上传
          images = refs;
        }

        const falReq: VideoFalSubmitRequest = { apiModel, prompt: finalPrompt, providerParams };
        if (images && images.length) falReq.images = images;

        if (falReg.paramKind === 'veo-fal') {
          falReq.aspect_ratio = vfRatio;
          falReq.duration = vfDuration;
          falReq.resolution = vfResolution;
          falReq.generate_audio = vfAudio;
          falReq.safety_tolerance = vfSafety;
        } else if (falReg.paramKind === 'grok-fal') {
          const effectiveGkfMode = isGrokFalV15 ? 'image_to_video' : gkfMode;
          const pastedReferenceUrls = isGrokFalV15
            ? []
            : splitGrokFalRefUrls(gkfReferenceUrls).slice(0, Math.max(0, 7 - (images?.length || 0)));
          if (isGrokFalV15 && (!images || images.length === 0)) {
            throw new Error('Grok Video 1.5 需要至少 1 张参考图');
          }
          if (!isGrokFalV15 && effectiveGkfMode === 'reference_to_video' && (!images || images.length === 0) && pastedReferenceUrls.length === 0) {
            throw new Error('Grok FAL 参考生视频需要至少 1 张参考图或 URL');
          }
          falReq.gkMode = effectiveGkfMode;
          if (!isGrokFalV15) {
            falReq.gkRatio = effectiveGkfMode === 'reference_to_video' && gkfRatio === 'auto' ? '16:9' : gkfRatio;
          }
          falReq.gkDuration = gkfDuration;
          falReq.resolution = gkfResolution;
          falReq.image_mode = falReg.defaultImageMode || 'base64';
          if (pastedReferenceUrls.length) falReq.gkReferenceUrls = pastedReferenceUrls;
        } else if (falReg.paramKind === 'sora-fal') {
          if (soraMode === 'image_to_video' && (!images || images.length === 0)) {
            throw new Error('Sora2 图生视频需要 1 张参考图');
          }
          falReq.soraMode = soraMode;
          falReq.soraRatio = soraRatio;
          falReq.soraDuration = soraDuration;
          falReq.soraResolution = soraResolution;
          falReq.soraDeleteVideo = soraDeleteVideo;
          falReq.soraBlockIp = soraBlockIp;
          falReq.soraCharacterIds = soraCharacterIds;
          falReq.image_mode = falReg.defaultImageMode || 'base64';
        }

        const falInfo =
          falReg.paramKind === 'veo-fal'
            ? `ratio=${vfRatio} dur=${vfDuration} res=${vfResolution} audio=${vfAudio}`
            : falReg.paramKind === 'grok-fal'
              ? isGrokFalV15
                ? `model=1.5 mode=image_to_video dur=${gkfDuration}s res=${gkfResolution} image=${falReg.defaultImageMode || 'base64'}`
                : `mode=${gkfMode} ratio=${gkfMode === 'reference_to_video' && gkfRatio === 'auto' ? '16:9' : gkfRatio} dur=${gkfDuration}s res=${gkfResolution} image=${falReg.defaultImageMode || 'base64'} urls=${splitGrokFalRefUrls(gkfReferenceUrls).length}`
              : `mode=${soraMode} ratio=${soraRatio} dur=${soraDuration}s res=${soraResolution} image=base64`;
        logBus.info(
          `提交 FAL 视频: ${apiModel} ${falInfo} refs=${images?.length || 0} prompt="${finalPrompt.slice(0, 30)}…"`,
          src,
        );

        const r = await submitVideoFal(falReq, {
          submissionKey: reporter?.providerSubmissionKey,
        });
        if (!isCurrentGenerationRun(runId)) return;
        if (r.sync && r.videoUrl) {
          await reporter?.providerResponse({
            provider: traceProvider,
            model: traceModel,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            status: 'succeeded',
            httpStatusSource: 'local-backend',
          });
          update({
            status: 'success',
            videoUrl: r.videoUrl,
            lastPrompt: finalPrompt,
            progress: '100%',
            provider: traceProvider,
            apiModel: traceModel,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
          });
          logBus.success(`FAL 同步完成 → ${r.videoUrl}`, src);
          taskCompletionSound.notifyComplete(id, 'video');
        } else {
          falPollRef.current = { endpoint: r.endpoint, requestId: r.requestId };
          await reporter?.providerSubmitted({
            provider: traceProvider,
            model: traceModel,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
          });
          update({ status: 'polling', lastPrompt: finalPrompt, progress: '15%' });
          logBus.info(`FAL 异步任务 requestId=${r.requestId} 进入轮询…`, src);
          // v1.2.9.11: await 让 useRunTrigger 等到任务真正完成才 markDone
          await startFalPolling(runId, reporter);
        }
        return;
      }

      // === 原有贞贞工坊分支 ===
      // 参考图预处理:
      //   - Grok: 直接传 URL (本地 /files/* 也可,后端会转上游 URL)
      //   - Veo / Sora2 / Seedance: 转 base64
      const refs = imageUrls.slice(0, (isVeoOmni || isGrok15New) ? 1 : modelDef.maxRefImages);
      let images: string[] | undefined;
      if (modelDef.supportImages && refs.length > 0) {
        if (modelDef.kind === 'grok') {
          images = refs;
        } else {
          const arr: string[] = [];
          for (const u of refs) {
            try {
              const encoded = await urlToBase64(u);
              if (!isCurrentGenerationRun(runId)) return;
              arr.push(encoded);
            }
            catch (e) { console.warn('图像编码失败', e); }
          }
          if (arr.length) images = arr;
        }
      }

      // 按 kind 走不同字段(完全对齐 gpt-image-2-web payload)
      const payload: VideoSubmitRequest = { model: apiModel, prompt: finalPrompt, providerParams };
      if (isGrok15New) {
        payload.size = grok15NewSize;
      } else if (modelDef.kind === 'grok') {
        payload.ratio = ratio;
        payload.duration = Number(duration) || modelDef.defaultDuration || 15;
        payload.resolution = resolution || modelDef.defaultResolution || '720P';
        if (seed > 0) payload.seed = seed;
      } else if (modelDef.kind === 'sora') {
        payload.aspect_ratio = ratio;
        payload.duration = Number(duration) || modelDef.defaultDuration || 15;
        payload.private = soraPrivate;
        if (seed > 0) payload.seed = seed;
      } else {
        // veo / seedance
        payload.aspect_ratio = ratio;
        if (isVeoOmni) {
          payload.duration = 10;
        } else {
          payload.enhance_prompt = enhancePrompt;
          if (enableUpsample) payload.enable_upsample = true;
        }
        if (seed > 0) payload.seed = seed;
      }
      if (images && images.length) payload.images = images;

      logBus.info(
        `提交任务: kind=${modelDef.kind} model=${apiModel} ratio=${ratio}` +
        (isGrok15New
          ? ` size=${payload.size} v1-multipart`
          : modelDef.kind === 'grok'
          ? ` duration=${payload.duration}s resolution=${payload.resolution}`
          : modelDef.kind === 'sora'
            ? ` duration=${payload.duration}s private=${payload.private}`
            : isVeoOmni
              ? ' duration=10s endpoint=/v1/videos'
              : ` enhance=${payload.enhance_prompt}`) +
        ` refs=${images?.length || 0} prompt="${finalPrompt.slice(0, 30)}…"`,
        src,
      );

      const r = await submitVideo(payload, {
        submissionKey: reporter?.providerSubmissionKey,
      });
      if (!isCurrentGenerationRun(runId)) return;
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
      update({ status: 'polling', taskId: r.taskId, lastPrompt: finalPrompt, progress: '0%' });
      logBus.info(`异步任务已提交 taskId=${r.taskId} 进入轮询…`, src);
      // v1.2.9.11: await 让 useRunTrigger 等到任务真正完成才 markDone
      await startPolling(r.taskId, runId, reporter);
    } catch (e: any) {
      if (!isCurrentGenerationRun(runId)) return;
      const msg = normalizeProviderErrorMessage(e, '提交失败');
      await reporter?.providerResponse({
        provider: traceProvider,
        model: traceModel,
        transportHttpStatus: e?.transportHttpStatus,
        upstreamHttpStatus: e?.upstreamHttpStatus,
        requestId: e?.requestId,
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
    falPollRef.current = null;
    setError(null);
    update({ status: 'idle', progress: '已停止', error: null, taskId: null });
    logBus.warn('用户主动停止：已停止本地轮询，远端任务可能仍会完成', src);
  };

  // 批量运行接入
  useRunTrigger(id, async (reporter) => {
    if (status === 'submitting' || status === 'polling') return;
    await handleGenerate(reporter);
  }, 'video', {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => shouldReuseGenerationResult('video', nodeData),
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
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = Array.isArray(d?.localRefImages) ? d.localRefImages : [];
      if (cur.indexOf(payload.url) !== -1) return;
      const cap = isWan
        ? 1
        : isKling
        ? maxMentionRefs
        : isVidu
        ? maxMentionRefs
        : isHappyHorse
        ? maxMentionRefs
        : isApimartBudgetVideo
        ? maxMentionRefs
        : isGrok15New
          ? 1
          : isJimengSeedanceSelected
            ? jimengImageLimit
            : (modelDef.maxRefImages || 7) + 4;
      if (cur.length >= cap) return;
      update({ localRefImages: [...cur, payload.url] });
    } else if (payload.kind === 'video' && payload.url && (isJimengSeedanceSelected || isApimartOmni || (isApimartOmniLowprice && apimartOmniLowpriceMode === 'reference_video') || isUpscaler || (isFlux3 && flux3Mode === 'v2v') || (isKling && klingMode === 'edit'))) {
      const cur = Array.isArray(d?.localRefVideos) ? d.localRefVideos : [];
      const cap = isUpscaler || isApimartOmni || isApimartOmniLowprice || (isFlux3 && flux3Mode === 'v2v') || (isKling && klingMode === 'edit') ? 1 : jimengSeedanceLimits.videos;
      if (cur.indexOf(payload.url) !== -1 || cur.length >= cap) return;
      update({ localRefVideos: [...cur, payload.url] });
    } else if (payload.kind === 'audio' && payload.url && isJimengSeedanceSelected) {
      const cur = Array.isArray(d?.localRefAudios) ? d.localRefAudios : [];
      if (cur.indexOf(payload.url) !== -1 || cur.length >= jimengSeedanceLimits.audios) return;
      update({ localRefAudios: [...cur, payload.url] });
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: isJimengSeedanceSelected
      ? ['image', 'video', 'audio', 'text']
      : isApimartOmni ? ['image', 'video', 'text']
      : isApimartOmniLowprice
        ? apimartOmniLowpriceMode === 'reference_video' ? ['video', 'text'] : apimartOmniLowpriceMode === 'text' ? ['text'] : ['image', 'text']
      : isApimartV31Lite ? ['text']
      : isUpscaler ? ['video']
      : isFlux3 ? flux3Mode === 'v2v' ? ['video', 'text'] : flux3Mode === 'i2v' ? ['image', 'text'] : ['text']
      : isKling && klingMode === 'edit' ? ['video', 'text'] : ['image', 'text'],
    onDrop: handleDrop,
  });

  const isBusy = status === 'submitting' || status === 'polling';
  const refsCount = orderedImages.length + localRefImages.length;
  const videoRefsCount = orderedVideos.length + localRefVideos.length;
  const audioRefsCount = orderedAudios.length + localRefAudios.length;
  const previewTitle = isWan
    ? `上游素材 · 首帧图 ${Math.min(refsCount, 1)}/1`
    : isUpscaler
    ? `上游素材 · 输入 MP4 ${Math.min(videoRefsCount, 1)}/1`
    : isFlux3
    ? flux3Mode === 't2v' || flux3Mode === 'draft-enhance'
      ? '上游素材 · 当前模式不使用参考素材'
      : flux3Mode === 'i2v'
        ? `上游素材 · 关键帧图片 ${Math.min(refsCount, 10)}/10`
        : `上游素材 · 输入 MP4 ${Math.min(videoRefsCount, 1)}/1`
    : isKling
    ? klingMode === 't2v'
      ? '上游素材 · 当前模型不使用参考素材'
      : klingMode === 'edit'
        ? `上游素材 · 输入视频 ${Math.min(videoRefsCount, 1)}/1`
        : `上游素材 · ${klingMode === 'i2v' ? '首尾帧' : '参考图'} ${Math.min(refsCount, maxMentionRefs)}/${maxMentionRefs}`
    : isVidu
    ? viduMode === 't2v'
      ? '上游素材 · 当前模型不使用参考图'
      : `上游素材 · ${viduMode === 'short-play' ? '资产图' : '参考图'} ${Math.min(refsCount, maxMentionRefs)}/${maxMentionRefs}`
    : isHappyHorse
    ? happyHorseMode === 't2v'
      ? '上游素材 · 当前模型不使用参考图'
      : `上游素材 · 参考图 ${Math.min(refsCount, maxMentionRefs)}/${maxMentionRefs}`
    : isApimartOmni
    ? `上游素材 · 图片 ${Math.min(refsCount, 16)}/16 · 视频 ${Math.min(videoRefsCount, 1)}/1`
    : isApimartBudgetVideo
    ? `上游素材 · 参考图 ${Math.min(refsCount, maxMentionRefs)}/${maxMentionRefs}`
    : isJimengSeedanceSelected
    ? `上游素材 · 图${Math.min(refsCount, jimengImageLimit)}/${jimengImageLimit} 视${Math.min(videoRefsCount, jimengSeedanceLimits.videos)}/${jimengSeedanceLimits.videos} 音${Math.min(audioRefsCount, jimengSeedanceLimits.audios)}/${jimengSeedanceLimits.audios}`
    : `上游素材 · 参考图 ${Math.min(refsCount, maxMentionRefs)}/${maxMentionRefs}`;

  if (canvasRenderMode === 'cold') {
    return (
      <div className="t8-node-cold-shell w-[300px]" data-t8-node-cold-shell="video" style={{ minHeight: 112 }}>
        <Handle type="target" position={Position.Left} className="!border-0 !bg-rose-400" />
        <Handle type="source" position={Position.Right} className="!border-0 !bg-rose-400" />
        <div className="t8-node-cold-shell__header">
          <VideoIcon size={16} className="shrink-0 text-rose-300" />
          <div className="t8-node-cold-shell__copy">
            <strong>{translate(isFashVsrVariant ? 'nodes:video.flashTitle' : 'nodes:video.title')}</strong>
            <small>{apiModel || modelDef.label || 'Video'} · {translate('common:performance.offscreenPreview')}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <NodeVisible>
      <div
      {...dropProps}
      className={`relative rounded-xl border-2 transition-all w-[300px] ${
        selected ? 'border-rose-400 shadow-2xl shadow-rose-500/20' : isAccepting ? 'border-emerald-400' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        boxShadow: isAccepting ? '0 0 0 2px rgba(52,211,153,.45), 0 12px 30px rgba(52,211,153,.18)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-rose-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-rose-400 !border-0" />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(244,63,94,.2)', color: '#fda4af', boxShadow: 'inset 0 0 0 1px rgba(244,63,94,.45)' }}
        >
          <VideoIcon size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{translate(isFashVsrVariant ? 'nodes:video.flashTitle' : 'nodes:video.title')}</div>
          <div className="text-[10px] text-white/40">
            {isExternalSelected && providerSelection.provider
              ? `${providerSelection.provider.label || providerSelection.provider.id} · ${externalProviderModel || translate('nodes:generation.unselectedModel')}`
              : isSeedanceNzVideo
                ? `${translate('nodes:generation.budgetHouse')} · ${apiModel}`
              : `${modelDef.label} · ${modelDef.kind}`}
          </div>
        </div>
        {isJimengCliSelected && <JimengCliHelpButton />}
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-2">
            <button
              type="button"
              onClick={() => update({ advancedProviderOpen: !d?.advancedProviderOpen })}
              className="w-full flex items-center justify-between text-[10px] font-semibold text-white/70 hover:text-white"
            >
              <span>{translate('nodes:generation.advancedSource')}</span>
              <span>
                {isExternalSelected && providerSelection.provider
                  ? providerSelection.provider.label
                  : videoBuiltinSource === 'seedance-nz'
                    ? translate('nodes:generation.budgetHouse')
                    : translate('nodes:generation.workshop')}
              </span>
            </button>
            {d?.advancedProviderOpen && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.platform')}</label>
                  <select
                    value={isExternalSelected
                      ? providerSelection.providerId
                      : videoBuiltinSource === 'seedance-nz'
                        ? 'builtin:seedance-nz'
                        : 'zhenzhen'}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (nextId === 'zhenzhen') {
                        switchBuiltinVideoSource('zhenzhen');
                        return;
                      }
                      if (nextId === 'builtin:seedance-nz') {
                        switchBuiltinVideoSource('seedance-nz');
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
                        ...(provider.protocol === 'agnes'
                          ? {
                            ratio: '16:9',
                            duration: 5,
                            resolution: '720p',
                            providerParams: { ...providerParams, frameRate: 24 },
                          }
                          : {}),
                      });
                    }}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  >
                    <option value="zhenzhen" style={{ background: '#18181b', color: '#ffffff' }}>{translate('nodes:generation.workshopDefault')}</option>
                    <option value="builtin:seedance-nz" style={{ background: '#18181b', color: '#ffffff' }}>{translate('nodes:generation.budgetHouse')}</option>
                    {videoAdvancedProviders.map((provider) => (
                      <option key={provider.id} value={provider.id} style={{ background: '#18181b', color: '#ffffff' }}>
                        {provider.label || provider.id}
                      </option>
                    ))}
                  </select>
                </div>
                {isExternalSelected && providerSelection.provider && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.externalModel')}</label>
                    <select
                      value={externalProviderModel}
                      onChange={(e) => {
                        const nextModel = e.target.value;
                        const nextIsJimeng25 = providerSelection.provider?.protocol === 'jimeng-cli'
                          && isJimengSeedance25Model(nextModel);
                        const nextMode = nextIsJimeng25 && jimengSeedanceMode === 'multiframe' ? 'omni' : jimengSeedanceMode;
                        const nextResolutions = providerSelection.provider?.protocol === 'jimeng-cli'
                          ? jimengSeedanceResolutionOptions(nextModel, nextMode === 'multiframe')
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
                            ? { providerParams: { ...providerParams, frameMode: nextMode } }
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
                    {translate('nodes:generation.missingProvider')}
                  </div>
                )}
              </div>
            )}
        </div>

        {/* 主模型 */}
        {!isExternalSelected && (
        <div>
          <label className="text-[10px] text-white/50 block mb-1">模型类型</label>
          <select
            value={modelDef.id}
            onChange={(e) => switchMainModel(e.target.value)}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            {builtinVideoModels.map((m) => (
              <option key={m.id} value={m.id} className="bg-zinc-900">{m.label}</option>
            ))}
          </select>
        </div>
        )}

        {/* 子模型(主项目 veo_model / gk_model) */}
        {!isExternalSelected && builtinApiModelOptions.length > 1 && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.specificModel')}</label>
            <select
              value={apiModel}
              onChange={(e) => {
                const nextModel = e.target.value;
                update({
                  model: nextModel,
                  ...(nextModel === 'grok-imagine-video-1.5' ? { gkfMode: 'image_to_video' } : {}),
                  ...(isGrokVideo15NewModel(nextModel) ? { ratio: '16:9', size: '1280x720', resolution: '' } : {}),
                   ...(nextModel === 'sora-2-zhenzhen' ? { ratio: '16:9', duration: 15, resolution: '' } : {}),
                   ...(nextModel === 'veo-omni-10s' ? { ratio: '16:9', duration: 10, resolution: '' } : {}),
                   ...(nextModel === ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL
                     ? { ratio: '16:9', duration: 0, resolution: '720p' }
                     : {}),
                   ...(nextModel === ZHENZHEN_VIDEO_GK_V15_MODEL
                     ? { ratio: '16:9', duration: 6, resolution: '720p' }
                     : {}),
                   ...(nextModel === ZHENZHEN_VIDEO_V31_FAST_MODEL
                     || nextModel === ZHENZHEN_VIDEO_V31_QUALITY_MODEL
                     || nextModel === ZHENZHEN_VIDEO_V31_LITE_MODEL
                     ? { ratio: '16:9', duration: 8, resolution: '720p' }
                     : {}),
                   ...(nextModel.startsWith('hailuo-h3-max-')
                     ? { ratio: '16:9', duration: 5, resolution: '480P' }
                     : nextModel.startsWith('hailuo-h3-')
                     ? { ratio: '16:9', duration: 5, resolution: '768P' }
                     : nextModel.startsWith('minimax-h3-ow-')
                       ? { ratio: '16:9', duration: 5, resolution: '480p' }
                     : nextModel.startsWith('hailuo-2.3-')
                       ? { ratio: '16:9', duration: 6, resolution: '768p' }
                       : {}),
                   ...(nextModel.startsWith('seedance-2.5-')
                     ? { ratio: nextModel.endsWith('-i2v') ? 'adaptive' : '16:9', duration: SEEDANCE25_DEFAULT_DURATION, resolution: SEEDANCE25_DEFAULT_RESOLUTION, generateAudio: true, returnLastFrame: false }
                     : {}),
                   ...(nextModel.startsWith('flux-3-video-')
                     ? { ratio: 'auto', duration: 5, resolution: 'hd', flux3Draft: false, flux3AudioMode: 'api_default', flux3SafetyTolerance: 'api_default' }
                     : {}),
                   ...(nextModel.startsWith('wan-3.0-')
                     ? { ratio: 'adaptive', duration: 2, resolution: '480P', generateAudio: true, wan30Seed: 0, wan30EnableThinking: false, wan30FileUrl: '', wan30LinkUrl: '' }
                     : {}),
                   ...(nextModel.endsWith('-short-play')
                     ? { ratio: '9:16', duration: 8, resolution: '1080p' }
                     : nextModel.startsWith('vidu-q3-')
                       ? { ratio: '16:9', duration: 4, resolution: 'default' }
                       : {}),
                 });
              }}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {builtinApiModelOptions.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled} className="bg-zinc-900">{o.label}</option>
              ))}
            </select>
          </div>
        )}

        <LocalNodeAddonSlot
          nodeId={id}
          nodeType="video"
          data={d}
          update={update}
          context={{
            providerSource: isExternalSelected ? providerSelection.providerSource : (isSeedanceNzVideo ? 'seedance-nz' : 'zhenzhen'),
            providerId: providerSelection.providerId,
            providerModel: isExternalSelected ? externalProviderModel : apiModel,
            model: apiModel,
            apiModel,
            mainId,
            providerKind: isFal ? 'fal' : (isSeedanceNzVideo ? 'seedance-nz-video' : modelDef.kind),
          }}
        />

        {/* === FAL 专属参数面板 === */}
        {showBuiltinFalControls && falReg?.paramKind === 'veo-fal' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')} (FAL)</label>
                <select value={vfRatio} onChange={(e) => update({ vfRatio: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {VEO_FAL_RATIOS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.duration')}</label>
                <select value={vfDuration} onChange={(e) => update({ vfDuration: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {VEO_FAL_DURATIONS.map((d) => <option key={d} value={d} className="bg-zinc-900">{d}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
                <select value={vfResolution} onChange={(e) => update({ vfResolution: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {VEO_FAL_RESOLUTIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">安全等级</label>
                <select value={String(vfSafety)} onChange={(e) => update({ vfSafety: Number(e.target.value) })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {[1,2,3,4,5,6].map((s) => <option key={s} value={s} className="bg-zinc-900">{s}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input type="checkbox" checked={vfAudio} onChange={(e) => update({ vfAudio: e.target.checked })} className="accent-rose-400" />
              生成音频
            </label>
          </>
        )}

        {showBuiltinFalControls && falReg?.paramKind === 'grok-fal' && (
          <>
            {isGrokFalV15 ? (
              <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-white/60">
                Grok Video 1.5 仅支持图生视频，必须有 1 张参考图；图像传入模式默认 Base64，不发送比例参数。
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">模式 (FAL)</label>
                  <select
                    value={gkfMode}
                    onChange={(e) => {
                      const next = e.target.value as 'image_to_video' | 'reference_to_video';
                      update({
                        gkfMode: next,
                        ...(next === 'reference_to_video' && gkfRatio === 'auto' ? { gkfRatio: '16:9' } : {}),
                      });
                    }}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
                  >
                    {GROK_FAL_MODES.map((m) => <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')} (FAL)</label>
                  <select value={gkfRatio} onChange={(e) => update({ gkfRatio: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                    {GROK_FAL_RATIOS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.durationSeconds')}</label>
                <input type="number" value={gkfDuration} min={1} max={30} onChange={(e) => update({ gkfDuration: Number(e.target.value) || 6 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30" />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
                <select value={gkfResolution} onChange={(e) => update({ gkfResolution: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {GROK_FAL_RESOLUTIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
            </div>
            {!isGrokFalV15 && gkfMode === 'reference_to_video' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">公开参考 URL(可选)</label>
                <textarea
                  value={gkfReferenceUrls}
                  onChange={(e) => update({ gkfReferenceUrls: e.target.value })}
                  placeholder="每行或逗号分隔，最多补足到 7 张"
                  className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
                />
              </div>
            )}
            <div className="text-[10px] text-white/45 leading-relaxed">
              {isGrokFalV15
                ? '只取第 1 张参考图，提交到 v1.5 image-to-video；Base64 为默认传入方式。'
                : gkfMode === 'reference_to_video'
                ? '参考生视频最多 7 张，优先使用上游/本地图，再补充 URL。'
                : '图生视频只取第 1 张参考图；无图时保留文生视频 fallback。'}
            </div>
          </>
        )}

        {showBuiltinFalControls && falReg?.paramKind === 'sora-fal' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">FAL Mode</label>
                <select value={soraMode} onChange={(e) => update({ soraMode: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {SORA2_FAL_MODES.map((m) => <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                <select value={soraRatio} onChange={(e) => update({ soraRatio: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {SORA2_FAL_RATIOS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.duration')}</label>
                <select value={String(soraDuration)} onChange={(e) => update({ soraDuration: Number(e.target.value) || 4 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {SORA2_FAL_DURATIONS.map((d) => <option key={d} value={d} className="bg-zinc-900">{d}s</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
                <select value={soraResolution} onChange={(e) => update({ soraResolution: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {SORA2_FAL_RESOLUTIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">Character IDs</label>
              <input
                value={soraCharacterIds}
                onChange={(e) => update({ soraCharacterIds: e.target.value })}
                placeholder="id1, id2"
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/25"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
                <input type="checkbox" checked={soraDeleteVideo} onChange={(e) => update({ soraDeleteVideo: e.target.checked })} className="accent-rose-400" />
                Delete Video
              </label>
              <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
                <input type="checkbox" checked={soraBlockIp} onChange={(e) => update({ soraBlockIp: e.target.checked })} className="accent-rose-400" />
                Block IP
              </label>
            </div>
            <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] leading-relaxed text-white/45">
              默认用 Base64 传入第 1 张参考图；Auto 无图时走文生视频。
            </div>
          </>
        )}

        {isSoraZhenzhen && (
          <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-white/70">Sora2 Zhenzhen API</span>
              <span className="text-[9px] text-white/35">参考图 ≤ 1</span>
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={soraPrivate}
                onChange={(e) => update({ soraPrivate: e.target.checked })}
                className="accent-rose-400"
              />
              Private
            </label>
            <div className="text-[10px] text-white/40 leading-relaxed">
              提交到 /v2/videos/generations，真实模型名为 sora-2；参考图会转为裸 Base64。
            </div>
          </div>
        )}

        {isVeoOmni && (
          <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-white/45">
            Veo Omni 走 /v1/videos，固定调用 omni_flash-10s，需要 1 张参考图；16:9=1280x720，9:16=720x1280。
          </div>
        )}

        {isGrok15New && (
          <>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">尺寸</label>
              <select
                value={grok15NewSize}
                onChange={(e) => {
                  const nextSize = e.target.value;
                  update({
                    size: nextSize,
                    ratio: nextSize === '720x1280' ? '9:16' : '16:9',
                  });
                }}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              >
                {GROK_VIDEO_1_5_NEW_SIZES.map((item) => (
                  <option key={item.value} value={item.value} className="bg-zinc-900">{item.label}</option>
                ))}
              </select>
            </div>
            <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-relaxed text-white/45">
              Grok 1.5 New 需要 1 张参考图；按 Comfly 原节点提交 model / prompt / size / input_reference，时长由具体模型 6s / 10s / 15s 决定。
            </div>
          </>
        )}

        {isHappyHorse && (
          <div className="rounded border border-amber-300/20 bg-amber-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {happyHorseMode === 't2v'
              ? '文生视频只使用提示词，不发送画布中的参考图。'
              : happyHorseMode === 'i2v'
                ? '图生视频必须有参考图，只取排序后的第 1 张作为首图。'
                : '参考图生视频需要 1-9 张图，可在提示词中使用“图1 / 图2”指代。'}
            <div className="mt-1 text-white/35">贞贞的平价AI小屋 · 3-15 秒 · 720p / 1080p</div>
          </div>
        )}

        {isSeedance25 && (
          <div className="rounded border border-fuchsia-300/20 bg-fuchsia-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {seedance25Mode === 't2v'
              ? '文生视频必须填写提示词，不发送任何参考素材。'
              : seedance25Mode === 'i2v'
                ? '图生视频使用排序后的第 1 张首帧图与可选第 2 张尾帧图；提示词可选。'
                : '多模态参考必须填写提示词并至少提供 1 个素材；最多 30 图、10 视频、10 音频，合计不超过 50 个。'}
            <div className="mt-1 text-white/35">贞贞的平价AI小屋 · Standard · 4-30 秒/自动 · 480p/720p/1080p/2k/4k/native1080p · 默认 5 秒/720p</div>
            {seedance25Mode === 'multi' && (
              <div className="mt-1 text-white/35">
                单段音视频 2-30 秒，全部参考音视频总时长不超过 30 秒；提交前实际读取时长。图片 JPG/JPEG/PNG/WEBP≤30MB，视频 MP4、音频 MP3/WAV≤50MB。
              </div>
            )}
          </div>
        )}

        {isApimartBudgetVideo && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55 space-y-2">
            <div>贞贞的平价AI小屋 · {apiModel}</div>
            {isApimartOmniLowprice && (
              <>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">生成模式</label>
                  <select
                    value={apimartOmniLowpriceMode}
                    onChange={(e) => update({ apimartOmniLowpriceMode: e.target.value, localRefImages: [], localRefVideos: [] })}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/40"
                  >
                    <option value="text" className="bg-zinc-900">文生视频</option>
                    <option value="frame" className="bg-zinc-900">首帧图生视频（1 图）</option>
                    <option value="reference_images" className="bg-zinc-900">参考图生视频（1 或 3 图）</option>
                    <option value="reference_video" className="bg-zinc-900">参考视频</option>
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-white/60 cursor-pointer">
                  <input type="checkbox" checked={apimartOmniLowpriceNsfwCheck} onChange={(e) => update({ apimartOmniLowpriceNsfwCheck: e.target.checked })} className="accent-cyan-400" />
                  启用内容检查
                </label>
              </>
            )}
            <div className="mt-1 text-white/40">
              {isApimartOmni
                ? 'Omni Flash：时长由模型决定，固定 720p；支持 Prompt、最多 16 张图片，或 1 个参考视频。'
                : isApimartOmniLowprice
                  ? '平价 Omni：4/6/8/10 秒，720p/1080p/4K；支持文生、首帧、1/3 张参考图或 1 个参考视频。参考视频模式不发送 seconds。'
                : isApimartGrok
                  ? 'Grok Video 1.5：6–30 秒，480p / 720p，最多 7 张参考图。'
                  : isApimartV31Fast
                    ? 'Veo 3.1 Fast：固定 8 秒，720p / 1080p / 4K，最多 3 张参考图。'
                    : isApimartV31Quality
                      ? 'Veo 3.1 Quality：固定 8 秒，720p / 1080p / 4K；最多 2 张参考图，避免进入不支持的 3 图 reference 模式。'
                      : 'Veo 3.1 Lite：纯文生视频，固定 8 秒，支持 720p / 1080p / 4K，不接受参考图或参考视频。'}
            </div>
          </div>
        )}

        {isFlux3 && (
          <div className="rounded border border-amber-300/20 bg-amber-400/[0.06] p-2 space-y-2">
            <div className="text-[10px] leading-relaxed text-white/60">
              {flux3Mode === 't2v'
                ? '文生视频只提交提示词；开启 Draft 后，完成任务会返回可继续增强的 draft_cache。'
                : flux3Mode === 'i2v'
                  ? '按画布素材顺序提交 1-10 张关键帧图片和提示词。'
                  : flux3Mode === 'v2v'
                    ? '提交 1 个 MP4 输入视频和编辑提示词。'
                    : '草稿增强只使用同线路已完成 Draft 任务返回的 draft_cache。'}
              <div className="mt-1 text-white/35">贞贞的平价AI小屋 · 5-20 秒 · HD/FHD · 国内/海外线路不可混用缓存</div>
            </div>
            {flux3Mode !== 'draft-enhance' && (
              <label className="flex items-center gap-1.5 text-[10px] text-white/65 cursor-pointer">
                <input
                  type="checkbox"
                  checked={flux3Draft}
                  onChange={(e) => update({ flux3Draft: e.target.checked })}
                  className="accent-amber-400"
                />
                Draft 草稿模式（完成后返回增强缓存）
              </label>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:video.generateAudio')}</label>
                <select
                  value={flux3AudioMode}
                  onChange={(e) => update({ flux3AudioMode: e.target.value })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-amber-300/40"
                >
                  <option value="api_default" className="bg-zinc-900">API 默认</option>
                  <option value="enabled" className="bg-zinc-900">{translate('nodes:generation.enabled')}</option>
                  <option value="disabled" className="bg-zinc-900">{translate('nodes:generation.disabled')}</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">安全容忍度</label>
                <select
                  value={String(flux3SafetyTolerance)}
                  onChange={(e) => update({ flux3SafetyTolerance: e.target.value === 'api_default' ? 'api_default' : Number(e.target.value) })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-amber-300/40"
                >
                  <option value="api_default" className="bg-zinc-900">API 默认</option>
                  {[0, 1, 2, 3, 4].map((item) => <option key={item} value={item} className="bg-zinc-900">{item}{item === 0 ? '（最严）' : item === 4 ? '（最宽）' : ''}</option>)}
                </select>
              </div>
            </div>
            {flux3Mode === 'draft-enhance' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">draft_cache（必填）</label>
                <textarea
                  value={flux3DraftCache}
                  onChange={(e) => update({ flux3DraftCache: e.target.value })}
                  placeholder="粘贴同线路 Draft 完成任务返回的缓存"
                  className="w-full h-16 resize-y rounded bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white outline-none focus:border-amber-300/40 placeholder:text-white/25"
                />
              </div>
            )}
            {flux3DraftCacheResult && (
              <div className="rounded border border-emerald-300/20 bg-emerald-400/[0.06] p-1.5 space-y-1.5">
                <div className="text-[10px] text-emerald-100/80">本次任务已返回 Draft 增强缓存</div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(flux3DraftCacheResult)}
                    className="flex-1 rounded border border-emerald-300/20 px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-300/10"
                  >
                    复制缓存
                  </button>
                  <button
                    type="button"
                    onClick={() => update({
                      model: apiModel.includes('-global-') ? 'flux-3-video-global-draft-enhance' : 'flux-3-video-draft-enhance',
                      flux3DraftCache: flux3DraftCacheResult,
                      flux3Draft: false,
                    })}
                    className="flex-1 rounded border border-amber-300/25 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-300/10"
                  >
                    继续草稿增强
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isHailuo && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {isMinimaxH3Ow
              ? hailuoMode === 'audio-drive'
                ? 'MiniMax H3 OW 音频驱动必须且只能使用 1 张图片与 1 段音频，不接受视频；提示词可选。'
                : hailuoMode === 't2v'
                ? 'MiniMax H3 OW 文生视频必须填写提示词，不发送任何参考素材。'
                : hailuoMode === 'r2v'
                  ? isMinimaxH3OwFast
                    ? 'MiniMax H3 OW Fast 参考生视频必须填写提示词，并按排序使用 1-9 张参考图。'
                    : 'MiniMax H3 OW 参考生视频必须填写提示词，并使用排序后的第 1 张参考图。'
                  : isMinimaxH3OwFast
                    ? 'MiniMax H3 OW Fast 图生视频必须且只能使用排序后的第 1 张首帧图，提示词可选。'
                    : 'MiniMax H3 OW 图生视频必须使用排序后的第 1 张首帧图，提示词可选。'
              : isHailuoH3Max
                ? hailuoMode === 't2v'
                  ? 'H3 Max 文生视频必须填写提示词，不发送参考素材；比例会随请求提交。'
                  : 'H3 Max 图生视频必须填写提示词并使用第 1 张首帧图，可选第 2 张尾帧图；比例跟随输入图片且不会发送。'
              : isHailuoH3
              ? hailuoMode === 't2v'
                ? 'H3 文生视频必须填写提示词，不发送参考素材；比例会随请求提交。'
                : hailuoMode === 'i2v'
                  ? 'H3 图生视频使用第 1 张首帧图，可选第 2 张尾帧图；提示词可选，比例跟随输入图片。'
                  : 'H3 多模态参考必须填写提示词并至少提供一种素材；最多 9 图、3 视频、3 音频，可按素材顺序在提示词中指代。'
              : hailuoMode === 't2v'
                ? '文生视频必须填写提示词，不发送画布中的参考图；比例会随请求提交。'
                : '图生视频使用排序后的第 1 张首帧图，提示词可选；比例跟随输入图片，不发送比例参数。'}
            <div className="mt-1 text-white/35">
              {isMinimaxH3Ow
                ? '贞贞的平价AI小屋 API · 5 / 10 / 15 秒 · 480p / 720p'
                : isHailuoH3Max
                  ? '贞贞的平价AI小屋 API · 5-15 秒 · 480P / 768P'
                : isHailuoH3
                  ? '贞贞的平价AI小屋 API · 按次计费 · 5-15 秒 · 768P / 2K'
                : '贞贞的平价AI小屋 API · 按次计费 · 6 / 10 秒 · 768p / 1080p（1080p 仅 6 秒）'}
            </div>
            {!isHailuoH3 && !isHailuoH3Max && hailuoMode === 'i2v' && (
              <div className="mt-1 text-white/35">首帧图短边需大于 300px，宽高比需在 2:5 到 5:2 之间。</div>
            )}
          </div>
        )}

        {isKling && (
          <div className="rounded border border-sky-300/20 bg-sky-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {klingMode === 't2v'
              ? '文生视频必须填写提示词，不发送参考图。'
              : klingMode === 'i2v'
                ? '图生视频使用第 1 张图作为首帧，可选第 2 张图作为尾帧；提示词可选。'
                : klingMode === 'r2v'
                  ? 'O3 参考生视频必须填写提示词，按素材顺序使用 1-4 张参考图。'
                  : 'O3 视频编辑必须填写提示词，并使用第 1 个输入视频。'}
            <div className="mt-1 text-white/35">贞贞的平价AI小屋 API · 按次计费 · 5 / 10 秒</div>
          </div>
        )}

        {isUpscaler && (
          <div className="rounded border border-emerald-300/20 bg-emerald-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {isFashVsr
              ? '连接或拖入恰好 1 个 480P、3-15 秒视频；无需 Prompt，也没有分辨率参数，模型按固定协议执行超分。'
              : '连接或拖入恰好 1 个 MP4 视频，选择目标分辨率后执行高清化；无需 Prompt，时长由输入视频读取。'}
            <div className="mt-1 text-white/35">
              {isFashVsr
                ? '贞贞的平价AI小屋 API · FlashVSR_video_upscale · 固定 ¥1/次'
                : '贞贞的平价AI小屋 API · 目标 720p / 1080p / 2k / 4k · 输入最长约 10 分钟'}
            </div>
          </div>
        )}

        {isVidu && (
          <div className="rounded border border-violet-300/20 bg-violet-400/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-white/55">
            {viduMode === 't2v'
              ? '文生视频只提交提示词，不发送参考图。'
              : viduMode === 'i2v'
                ? '图生视频使用排序后的第 1 张图作为首帧，提示词可选。'
                : viduMode === 'start-end'
                  ? '首尾帧视频依次使用前 2 张图片作为起始帧和结束帧。'
                  : viduMode === 'r2v'
                    ? '参考生视频使用 1-9 张图片，按画布素材顺序提交。'
                    : '短剧成片把 Prompt 作为脚本内容，并使用 1-14 张图片构造参考资产。'}
            <div className="mt-1 text-white/35">
              贞贞的平价AI小屋 API · 按次计费 · {viduMode === 'short-play' ? '8-12 秒 · 固定 1080p' : '4-15 秒 · default / 720p / 1080p'}
            </div>
          </div>
        )}

        {isWan && (isWan30 ? (
          <div className="rounded border border-orange-300/20 bg-orange-400/[0.06] p-2 space-y-2">
            <div className="text-[10px] leading-relaxed text-white/60">
              {wan30Mode === 'i2v'
                ? translate('nodes:video.wan30I2vHint')
                : translate('nodes:video.wan30R2vHint')}
              <div className="mt-1 text-white/35">{translate('nodes:video.wan30BudgetHint')}</div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                <select
                  value={ratio}
                  onChange={(e) => update({ ratio: e.target.value })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40"
                >
                  {['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:video.generateAudio')}</label>
                <select
                  value={generateAudio ? 'enabled' : 'disabled'}
                  onChange={(e) => update({ generateAudio: e.target.value === 'enabled' })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40"
                >
                  <option value="enabled" className="bg-zinc-900">{translate('nodes:generation.enabled')}</option>
                  <option value="disabled" className="bg-zinc-900">{translate('nodes:generation.disabled')}</option>
                </select>
              </div>
            </div>
            {wan30SupportsThinking && (
              <label className="flex items-center gap-1.5 text-[10px] text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wan30EnableThinking}
                  onChange={(e) => update({ wan30EnableThinking: e.target.checked })}
                  className="accent-orange-400"
                />
                {translate('nodes:video.wan30Thinking')}
              </label>
            )}
            {wan30Mode === 'r2v' && (
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:video.wan30FileUrl')}</label>
                  <input
                    value={wan30FileUrl}
                    onChange={(e) => update({ wan30FileUrl: e.target.value })}
                    placeholder="https://..."
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40 placeholder:text-white/25"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:video.wan30WebUrl')}</label>
                  <input
                    value={wan30LinkUrl}
                    onChange={(e) => update({ wan30LinkUrl: e.target.value })}
                    placeholder="https://..."
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40 placeholder:text-white/25"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:video.wan30Seed')}</label>
              <input
                type="number"
                min={0}
                max={2147483647}
                value={wan30Seed}
                onChange={(e) => update({ wan30Seed: Math.max(0, Math.min(2147483647, Number(e.target.value) || 0)) })}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40"
              />
            </div>
          </div>
        ) : (
          <div className="rounded border border-orange-300/20 bg-orange-400/[0.06] p-2 space-y-2">
            <div className="text-[10px] leading-relaxed text-white/60">
              Wan 2.7 Spicy 仅支持图生视频，必须提供 1 张首帧图；提示词可选。
              <div className="mt-1 text-white/35">贞贞的平价AI小屋 · 海外模型 · 2-15 秒 · 720p / 1080p</div>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.negativePromptOptional')}</label>
              <textarea
                value={wanNegativePrompt}
                onChange={(e) => update({ wanNegativePrompt: e.target.value })}
                placeholder="不希望出现在视频中的内容"
                className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-orange-300/40 placeholder:text-white/25"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">配乐公网 URL（可选）</label>
              <input
                value={wanAudioUrl}
                onChange={(e) => update({ wanAudioUrl: e.target.value })}
                placeholder="https://.../audio.mp3"
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40 placeholder:text-white/25"
              />
            </div>
            <div className="grid grid-cols-[1fr_110px] gap-2 items-end">
              <label className="flex items-center gap-1.5 text-[10px] text-white/60 cursor-pointer pb-1.5">
                <input
                  type="checkbox"
                  checked={wanPromptExtend}
                  onChange={(e) => update({ wanPromptExtend: e.target.checked })}
                  className="accent-orange-400"
                />
                扩写提示词
              </label>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.seedRandom')}</label>
                <input
                  type="number"
                  min={-1}
                  max={2147483647}
                  value={wanSeed}
                  onChange={(e) => update({ wanSeed: Math.max(-1, Math.min(2147483647, Number(e.target.value) || 0)) })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-orange-300/40"
                />
              </div>
            </div>
          </div>
        ))}

        {isJimengSeedanceSelected && (
          <div className="rounded border border-white/10 bg-white/5 p-1.5 space-y-1">
            <div className="rounded border border-lime-300/15 bg-lime-400/[0.05] px-2 py-1 text-[10px] leading-relaxed text-lime-100/70">
              当前按即梦 CLI v{JIMENG_CLI_SUPPORTED_VERSION} 适配，视频分辨率为必填参数。
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] text-white/50">即梦模式</label>
              <span className="text-[9px] text-white/35">
                {jimengSeedanceMode === 'multiframe'
                  ? `多帧图${JIMENG_CLI_MULTIFRAME.images}`
                  : `图${jimengSeedanceLimits.images} / 视${jimengSeedanceLimits.videos} / 音${jimengSeedanceLimits.audios} / 总${jimengSeedanceLimits.total}`}
              </span>
            </div>
            <select
              value={jimengSeedanceMode}
              onChange={(e) => {
                const nextMode = e.target.value;
                update({
                  providerParams: { ...providerParams, frameMode: nextMode },
                  ...(nextMode === 'multiframe' && !['720p', '1080p'].includes(resolution)
                    ? { resolution: '720p' }
                    : {}),
                });
              }}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {jimengModeOptions.map((item) => (
                <option key={item.value} value={item.value} className="bg-zinc-900">{item.label}</option>
              ))}
            </select>
            <div className="text-[10px] text-white/40 leading-relaxed">
              {jimengSeedanceMode === 'omni'
                ? isJimengSeedance25
                  ? 'Seedance 2.5 全能参考支持混合素材和纯音频输入；单段及音视频总时长均须为 2-30 秒，由官方 CLI 提交前实际校验。'
                  : 'Seedance 2.0 全能参考支持图片、视频和音频混合输入，但必须至少包含图片或视频。'
                : jimengSeedanceMode === 'first'
                  ? '只取第 1 张图作为首帧。'
                  : jimengSeedanceMode === 'firstlast'
                    ? '取第 1 张为首帧，第 2 张为尾帧。'
                    : `仅使用 2-${JIMENG_CLI_MULTIFRAME.images} 张图片序列生成固定模型智能多帧；必须选择 720P 或 1080P。`}
            </div>
          </div>
        )}

        {/* 比例(非 FAL 时显示原始控件) */}
        {showGenericVideoControls && !isGrok15New && !isWan && !isHailuo && !isKling && !isUpscaler && !isVidu && (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
            <select
              value={ratio}
              onChange={(e) => update({ ratio: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {ratioOptions.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
          {/* 时长(grok / seedance) */}
          {durationOptions.length > 0 && (
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.durationSeconds')}</label>
              <select
                value={String(duration)}
                onChange={(e) => update({ duration: Number(e.target.value) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
                {durationOptions.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900">{s === -1 ? '自动 (-1)' : `${s}s`}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        )}

        {isSeedance25 && (
          <div className="grid grid-cols-2 gap-1.5">
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
          </div>
        )}

        {isHailuo && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {(hailuoMode !== 'i2v' || isMinimaxH3Ow) && (
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                  <select
                    value={ratio}
                    onChange={(e) => update({ ratio: e.target.value })}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/40"
                  >
                    {ratioOptions.map((item) => (
                      <option key={item} value={item} className="bg-zinc-900">{item}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.durationSeconds')}</label>
                <select
                  value={String(hailuoDuration)}
                  onChange={(e) => {
                    const requested = Number(e.target.value);
                    const nextDuration = (isMinimaxH3Ow
                      ? ([5, 10, 15].includes(requested) ? requested : 5)
                      : isHailuoH3 || isHailuoH3Max
                        ? Math.max(5, Math.min(15, requested || 5))
                      : requested === 10 ? 10 : 6) as HailuoDuration;
                    update({
                      duration: nextDuration,
                      ...(!isHailuoH3 && !isHailuoH3Max && nextDuration === 10 && resolution === '1080p' ? { resolution: '768p' } : {}),
                    });
                  }}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/40"
                >
                  {durationOptions.map((seconds) => (
                    <option key={seconds} value={seconds} className="bg-zinc-900">{seconds}s</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
              <select
                value={isMinimaxH3Ow
                  ? resolution === '720p' ? '720p' : '480p'
                  : isHailuoH3Max ? resolution === '768P' ? '768P' : '480P'
                  : isHailuoH3 ? resolution === '768P' ? '768P' : '2K' : resolution === '1080p' ? '1080p' : '768p'}
                onChange={(e) => {
                  if (isHailuoH3Max) {
                    update({ resolution: e.target.value === '768P' ? '768P' : '480P' });
                    return;
                  }
                  if (isHailuoH3) {
                    update({ resolution: e.target.value === '768P' ? '768P' : '2K' });
                    return;
                  }
                  if (isMinimaxH3Ow) {
                    update({ resolution: e.target.value === '720p' ? '720p' : '480p' });
                    return;
                  }
                  const nextResolution = e.target.value === '1080p' ? '1080p' : '768p';
                  update({ resolution: nextResolution, ...(nextResolution === '1080p' ? { duration: 6 } : {}) });
                }}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/40"
              >
                {resolutionOptions.map((item) => (
                  <option key={item} value={item} className="bg-zinc-900">{item}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {isKling && (
          <div className="rounded border border-sky-300/20 bg-sky-400/[0.06] p-2 space-y-2">
            <div className={klingMode === 'edit' ? '' : 'grid grid-cols-2 gap-1.5'}>
              {klingMode !== 'edit' && (
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                  <select
                    value={ratio}
                    onChange={(e) => update({ ratio: e.target.value })}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-sky-300/40"
                  >
                    {ratioOptions.map((item) => (
                      <option key={item} value={item} className="bg-zinc-900">{item}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.durationSeconds')}</label>
                <select
                  value={String(klingDuration)}
                  onChange={(e) => update({ duration: Number(e.target.value) })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-sky-300/40"
                >
                  {[5, 10].map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">{item}s</option>
                  ))}
                </select>
              </div>
            </div>
            {klingMode !== 'edit' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.negativePromptOptional')}</label>
                <textarea
                  value={klingNegativePrompt}
                  maxLength={20480}
                  onChange={(e) => update({ klingNegativePrompt: e.target.value })}
                  placeholder="不希望出现在视频中的内容"
                  className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-sky-300/40 placeholder:text-white/25"
                />
              </div>
            )}
          </div>
        )}

        {isVidu && (
          <div className="rounded border border-violet-300/20 bg-violet-400/[0.06] p-2 space-y-2">
            {viduMode === 'short-play' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">脚本名称（≤20 字符）</label>
                <input
                  value={viduScriptName}
                  maxLength={20}
                  onChange={(e) => update({ viduScriptName: e.target.value })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                <select
                  value={viduRatio}
                  onChange={(e) => update({ ratio: e.target.value })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                >
                  {(viduMode === 'short-play' ? ['9:16', '16:9'] : ratioOptions).map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.durationSeconds')}</label>
                <select
                  value={String(viduDuration)}
                  onChange={(e) => update({ duration: Number(e.target.value) })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                >
                  {(viduMode === 'short-play' ? [8, 9, 10, 11, 12] : [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]).map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">{item}s</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
                <select
                  value={viduResolution}
                  disabled={viduMode === 'short-play'}
                  onChange={(e) => update({ resolution: e.target.value })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40 disabled:opacity-60"
                >
                  {(viduMode === 'short-play' ? ['1080p'] : ['default', '720p', '1080p']).map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">{item}</option>
                  ))}
                </select>
              </div>
              {viduMode === 'short-play' ? (
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">资产类型</label>
                  <select
                    value={viduAssetType}
                    onChange={(e) => update({ viduAssetType: e.target.value })}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                  >
                    {['character', 'scene', 'prop'].map((item) => (
                      <option key={item} value={item} className="bg-zinc-900">{item}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.seedRandom')}</label>
                  <input
                    type="number"
                    min={-1}
                    max={2147483647}
                    value={viduSeed}
                    onChange={(e) => update({ viduSeed: Math.max(-1, Math.min(2147483647, Number(e.target.value) || 0)) })}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                  />
                </div>
              )}
            </div>
            {viduMode === 'short-play' && (
              <>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">视频风格（≤30 字符）</label>
                  <input
                    value={viduStyle}
                    maxLength={30}
                    onChange={(e) => update({ viduStyle: e.target.value })}
                    className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">资产名称前缀</label>
                    <input
                      value={viduAssetNamePrefix}
                      onChange={(e) => update({ viduAssetNamePrefix: e.target.value })}
                      className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">资产描述</label>
                    <input
                      value={viduAssetDescription}
                      onChange={(e) => update({ viduAssetDescription: e.target.value })}
                      className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {isWan && durationOptions.length > 0 && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.durationSeconds')}</label>
            <select
              value={String(duration)}
              onChange={(e) => update({ duration: Number(e.target.value) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {durationOptions.map((seconds) => (
                <option key={seconds} value={seconds} className="bg-zinc-900">{seconds === -1 ? 'auto' : `${seconds}s`}</option>
              ))}
            </select>
          </div>
        )}

        {/* 分辨率(仅 grok 非FAL) */}
        {showGenericVideoControls && !isHailuo && !isKling && !isVidu && resolutionOptions.length > 0 && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
            <select
              value={resolution || resolutionOptions[0]}
              onChange={(e) => update({ resolution: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {resolutionOptions.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
        )}

        {isAgnesExternalSelected && (
          <div className="rounded border border-emerald-300/20 bg-emerald-400/[0.06] p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-white/75">Agnes 视频参数</span>
              <span className="text-[9px] text-emerald-100/60">/v1/videos</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">帧率</label>
                <select
                  value={String(agnesFrameRate)}
                  onChange={(e) => updateProviderParams({ frameRate: Number(e.target.value) || 24 })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
                >
                  {[8, 12, 16, 24, 30].map((fps) => (
                    <option key={fps} value={fps} className="bg-zinc-900">{fps} fps</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">帧数覆盖</label>
                <input
                  type="number"
                  min={9}
                  max={441}
                  value={String(agnesNumFrames)}
                  onChange={(e) => updateProviderParams({
                    numFrames: e.target.value ? Math.max(9, Math.min(441, Number(e.target.value) || 9)) : '',
                  })}
                  placeholder="自动"
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/25"
                />
              </div>
            </div>
            <div className="text-[10px] leading-relaxed text-white/45">
              默认由比例、分辨率和时长换算宽高与帧数；通常只需要调比例、时长和分辨率，特殊测试再覆盖帧数。
            </div>
          </div>
        )}

        {/* veo 专用选项(非FAL) */}
        {!isExternalSelected && !isFal && modelDef.kind === 'veo' && !isVeoOmni && !isApimartBudgetVideo && (
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={enhancePrompt}
                onChange={(e) => update({ enhancePrompt: e.target.checked })}
                className="accent-rose-400"
              />
              Enhance Prompt
            </label>
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={enableUpsample}
                onChange={(e) => update({ enableUpsample: e.target.checked })}
                className="accent-rose-400"
              />
              Upsample
            </label>
          </div>
        )}

        {/* Seed(非FAL) */}
        {showGenericVideoControls && !isHappyHorse && !isFlux3 && !isKling && !isUpscaler && !isWan && !isApimartBudgetVideo && (
        <div>
          <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.seedRandom')}</label>
          <input
            type="number"
            value={seed}
            min={0}
            max={2147483647}
            onChange={(e) => update({ seed: Number(e.target.value) || 0 })}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          />
        </div>
        )}

        {/* 上游素材聚合预览区 (代替原「参考图(上游)」计数提示) */}
        {supportsActiveMaterials && !isApimartV31Lite && (
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
            groups={previewGroups}
            title={previewTitle}
          />
        )}

        {/* 本地拖入参考素材 (Ctrl+拖拽自其他节点) */}
        {supportsActiveMaterials && !isApimartV31Lite && (isUpscaler ? localRefVideos.length : localRefImages.length + localRefVideos.length + localRefAudios.length) > 0 && (
          <div className="rounded border border-emerald-400/30 bg-emerald-500/5 p-1.5 space-y-1">
            <div className="text-[10px] text-emerald-200/80">
              {isUpscaler ? `本地拖入 · 视频 ${localRefVideos.length}/1` : `本地拖入 · 图${localRefImages.length} 视${localRefVideos.length} 音${localRefAudios.length}`}
            </div>
            {!isUpscaler && localRefImages.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {localRefImages.map((u, i) => (
                  <div key={`img-${i}`} className="relative w-10 h-10">
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
                  <div key={`vid-${i}`} className="flex items-center gap-1">
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
            {!isUpscaler && localRefAudios.length > 0 && (
              <div className="space-y-1">
                {localRefAudios.map((u, i) => (
                  <div key={`aud-${i}`} className="flex items-center gap-1">
                    <span
                      data-drag-source
                      data-drag-kind="audio"
                      data-drag-url={u}
                      data-drag-node-id={id}
                      onMouseDown={(e) => beginMaterialDrag(e, { kind: 'audio', url: u, sourceNodeId: id, previewUrl: u })}
                      className="text-[14px] cursor-grab"
                      title={translate('nodes:generation.ctrlDrag')}
                    >
                      ♪
                    </span>
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
        {!isUpscaler && <div>
              <label className="text-[10px] text-white/50 block mb-1">
                {isWan30 && wan30Mode === 'r2v'
                  ? translate('nodes:video.wan30LocalPromptRequired')
                  : isVidu && viduMode === 'short-play'
                  ? '短剧脚本内容（必填）'
              : isKling && klingMode !== 'i2v'
                ? '本地 Prompt（必填）'
                : '本地 Prompt(可选)'}
          </label>
          <MentionPromptInput
            title={translate('nodes:video.promptTitle')}
            value={localPrompt}
            mentions={promptMentions}
            materials={mentionMaterials}
            onChange={(value, mentions) => update({ prompt: value, promptMentions: mentions })}
            placeholder={translate('nodes:generation.promptFallback')}
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="video"
            className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>}

        <ReuseResultToggle
          checked={d?.reuseResult === true}
          hasResult={hasReusableGenerationResult('video', d)}
          onChange={(checked) => update({ reuseResult: checked })}
          accentColor="#fb7185"
        />

        {!isBusy ? (
          <button
            onClick={() => requestCanvasNodeRun(id)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> {translate(isUpscaler ? 'nodes:video.startUpscale' : 'nodes:video.generateVideo')}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> {translate('nodes:generation.stopWithStatus', { status: progress || translate(status === 'submitting' ? 'nodes:video.submitting' : 'nodes:video.queued') })}
          </button>
        )}

        {isBusy && (
          <div className="flex items-center gap-1 text-[10px] text-rose-200/80">
            <Loader2 size={11} className="animate-spin" />
            {status === 'submitting' ? '提交任务...' : `轮询中 ${progress}`}
            {taskId && <span className="ml-auto text-white/30">{taskId.slice(0, 10)}…</span>}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{normalizeProviderErrorMessage(error, '生成失败')}</span>
          </div>
        )}
      </div>

      {videoUrl && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <LoopingVideo
            src={videoUrl}
            controls
            className="w-full rounded"
            style={{ aspectRatio: ratio.replace(':', '/') }}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={videoUrl}
            data-drag-preview={videoUrl}
            data-drag-node-id={id}
            data-resource-title={videoUrl.split('/').pop() || translate('nodes:video.generatedVideo')}
            data-prompt-template-kind="video"
            data-prompt-template-category="video-image-to-video"
            data-prompt-template-prompt={d?.lastPrompt || localPrompt}
            onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl, sourceNodeId: id, previewUrl: videoUrl })}
            title={translate('nodes:video.dragHint')}
          />
        </div>
      )}
      </div>
    </NodeVisible>
  );
};

export default memo(VideoNode);
