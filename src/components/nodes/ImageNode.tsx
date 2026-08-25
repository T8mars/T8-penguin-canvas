import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { AlertCircle, Image as ImageIcon, Plus, Sparkles, Square, X } from 'lucide-react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import ReuseResultToggle from './ReuseResultToggle';
import MentionPromptInput from './MentionPromptInput';
import SmartImage from '../SmartImage';
import LazyVideo from '../LazyVideo';
import PromptTextarea from '../PromptTextarea';
import { resolveMediaMentions, type MediaMention } from './mediaMentions';
import {
  IMAGE_MODELS,
  FAL_REGISTRY,
  GPT_FAL_SIZES,
  NBPRO_FAL_RATIOS,
  NBPRO_FAL_RESOLUTIONS,
  isFalModel,
  MJ_VERSIONS,
  MJ_RATIOS,
  MJ_SPEEDS,
  MJ_SVS,
  DEFAULT_MJ_VERSION,
  DEFAULT_MJ_RATIO,
  DEFAULT_MJ_SPEED,
  gptImage2ZhenzhenVariantSize,
  isZhenzhenApimartImageModel,
  isZhenzhenBudgetImageModel,
  isZhenzhenImageG2Model,
  ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS,
  ZHENZHEN_BUDGET_GROK_MODEL_OPTIONS,
  ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS,
  ZHENZHEN_BUDGET_BANANA_PRO_MODEL_OPTIONS,
  ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL,
  ZHENZHEN_IMAGE_G2_I2I_MODEL,
  ZHENZHEN_IMAGE_G2_RATIOS,
  ZHENZHEN_IMAGE_G2_T2I_MODEL,
  ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V15_MODEL,
  ZHENZHEN_IMAGE_GK_V15_RATIOS,
  ZHENZHEN_IMAGE_GK_V2_MODEL,
  ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_RATIOS,
  ZHENZHEN_IMAGE_GK_V2_EDIT_RATIOS,
  ZHENZHEN_IMAGE_GK_V2_EDIT_RESOLUTIONS,
  ZHENZHEN_IMAGE_NB_2_LITE_MODEL,
  ZHENZHEN_IMAGE_NB_2_MODEL,
  ZHENZHEN_IMAGE_NB_PRO_MODEL,
  ZHENZHEN_IMAGE_NB_EXTREME_RATIOS,
  ZHENZHEN_IMAGE_NB_STANDARD_RATIOS,
  QWEN_IMAGE_30_MODELS,
  QWEN_IMAGE_30_RATIOS,
  SEEDREAM_LAYER_DECOMPOSITION_MODEL,
  SEEDREAM_LAYER_RESOLUTIONS,
  isQwenImage30I2IModel,
  WAN27_GLOBAL_IMAGE_MODELS,
  WAN27_GLOBAL_T2I_MODEL,
  isWan27GlobalI2IModel,
} from '../../providers/models';
import {
  submitImageAsync,
  queryImageStatus,
  submitSeedreamNz,
  querySeedreamNz,
  submitImageFal,
  queryImageFal,
  uploadFile,
  submitMjImagine,
  queryMjTask,
  uploadMjImage,
  buildMjPrompt,
  submitMidjourneyNz,
  queryMidjourneyNz,
  type MidjourneyNzOperation,
  type MidjourneyNzTaskResult,
  generateExternalImage,
  type MjSpeed,
} from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
import { useThemeStore } from '../../stores/theme';
import { logBus } from '../../stores/logs';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useApiKeysStore } from '../../stores/apiKeys';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  distributeModelscopeLoraWeights,
  externalImageSizeFor,
  MAX_MODELSCOPE_NODE_LORAS,
  MODELSCOPE_LORA_TOTAL_WEIGHT,
  modelscopeLoraWeightTotal,
  modelscopeLorasForModel,
  normalizeModelscopeLoraStrength,
  normalizeModelscopeLoraWeightsTotal,
  normalizeModelscopeSelectedLoras,
  resolveAdvancedProviderSelection,
  type ModelscopeSelectedLora,
} from '../../utils/advancedProviders';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import { COMFY_APP_SOURCE_LABELS } from '../../utils/comfyuiApps';
import { canonicalizeComfyFieldsByWorkflow, comfyFieldInputValue } from '../../utils/comfyuiWorkflow';
import { LocalNodeAddonSlot } from 'virtual:t8-local-extensions';
import type { RunNodeLifecycleReporter } from '../../types/project';
import JimengCliHelpButton from './JimengCliHelpButton';
import { JIMENG_CLI_SUPPORTED_VERSION, jimengImageResolutionOptions } from '../../config/jimengCli';
import {
  combinePromptWithImageAdjustments,
  normalizeImagePromptAdjustmentSelections,
  type ImagePromptAdjustmentSelection,
} from '../../data/imagePromptAdjustments';
import MidjourneyNzPanel from './MidjourneyNzPanel';
import {
  buildMidjourneyNzRequest,
  midjourneyNzRequiresPrompt,
} from '../../utils/midjourneyNz';

/**
 * ImageNode - 图像生成(ZhenzhenMagic)
 * 多 TAB 切换:GPT2 / 香蕉2 / 香蕉Pro / Grok / Seedream / Seedream分层 / Qwen Image / MJ
 * 参数:模型 TAB / 比例 / 尺寸 / 多张参考图 / 本地 prompt
 * 上游 text 节点 → prompt(优先);上游 image 节点 → 参考图(并入 references)
 */
const IMAGE_POLL_TIMEOUT_SECONDS = 3600;
const minPollCountForTimeout = (intervalMs: number) =>
  Math.ceil((IMAGE_POLL_TIMEOUT_SECONDS * 1000) / Math.max(1, intervalMs));
const COMFY_NUMERIC_FIELD_SOURCES = new Set([
  'width',
  'height',
  'batch_size',
  'seed',
  'steps',
  'cfg',
  'denoise',
  'start_at_step',
  'end_at_step',
  'guidance',
  'shift',
  'fps',
  'frame_rate',
  'num_frames',
  'duration',
  'strength',
  'weight',
  'strength_model',
  'strength_clip',
]);
const COMFY_NODE_FIELD_SOURCES = new Set([
  'prompt',
  'positive',
  'negative',
  'width',
  'height',
  'batch_size',
  'seed',
  'steps',
  'cfg',
  'sampler_name',
  'scheduler',
  'denoise',
  'model_name',
  'ckpt_name',
  'clip_name',
  'vae_name',
  'lora_name',
  'unet_name',
  'control_net_name',
  'clip_vision_name',
  'style_model_name',
  'upscale_model',
  'strength_model',
  'strength_clip',
  'start_at_step',
  'end_at_step',
  'guidance',
  'shift',
  'fps',
  'frame_rate',
  'num_frames',
  'duration',
  'strength',
  'weight',
  'control_after_generate',
  'add_noise',
]);
const COMFY_IMAGE_SOURCE_RE = /^image(?:_|-)?(\d+)$/i;
const COMFY_MEDIA_SOURCE_RE = /^(image|video|audio)(?:_|-)?\d+$/i;
const COMFY_SAFE_CUSTOM_SOURCE_RE = /^[a-z][a-z0-9_:. -]{0,79}$/i;
const comfyFieldSource = (field: any) => String(field?.source || field?.fieldName || '').trim();
const isComfyNodeFieldSource = (source: string) => {
  if (!source || source === 'fixed') return false;
  if (COMFY_NODE_FIELD_SOURCES.has(source) || COMFY_MEDIA_SOURCE_RE.test(source)) return true;
  return COMFY_SAFE_CUSTOM_SOURCE_RE.test(source);
};
const comfyImageSourceIndex = (source: string) => {
  const match = source.match(COMFY_IMAGE_SOURCE_RE);
  return match ? Math.max(1, Number(match[1]) || 1) : 0;
};

const ImageNode = ({ id, data, selected }: NodeProps) => {
  const { t: translate } = useTranslation(['nodes', 'common']);
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { getEdges, getNodes } = useReactFlow();
  const { style, theme } = useThemeStore();
  const isPixel = style === 'pixel';
  const isDark = theme === 'dark';
  // 主参考图(referenceImages)上传入口 - 与下面 MJ sref/oref 上传隔离
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // MJ 上传时区分 sref 还是 oref(共用 fileInputRef)
  const mjUploadKindRef = useRef<'sref' | 'oref'>('sref');
  const generationRunRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const d = data as any;
  const model = d?.model || IMAGE_MODELS[0].id;
  const modelDef = useMemo(() => IMAGE_MODELS.find((m) => m.id === model) || IMAGE_MODELS[0], [model]);
  const advancedProviders = useApiKeysStore((s) => s.settings.advancedProviders);
  const zhenzhenSd2ApiKey = useApiKeysStore((s) => s.settings.zhenzhenSd2ApiKey);
  const imageAdvancedProviders = useMemo(
    () => advancedProvidersForNode(advancedProviders, 'image'),
    [advancedProviders],
  );
  const providerSelection = useMemo(
    () => resolveAdvancedProviderSelection(advancedProviders, 'image', {
      providerSource: d?.providerSource,
      providerId: d?.providerId,
      providerModel: d?.providerModel,
    }),
    [advancedProviders, d?.providerSource, d?.providerId, d?.providerModel],
  );
  const isExternalSelected = providerSelection.available && providerSelection.providerSource !== 'zhenzhen';
  const savedExternalMissing = !!d?.providerSource && d.providerSource !== 'zhenzhen' && !providerSelection.available;
  const externalModelOptions = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'image')
    : [];
  const externalProviderModel = providerSelection.providerModel || externalModelOptions[0] || '';
  const providerParams = (d?.providerParams && typeof d.providerParams === 'object') ? d.providerParams : {};
  const isModelScopeExternal = isExternalSelected && providerSelection.provider?.protocol === 'modelscope';
  const isComfyExternal = isExternalSelected && providerSelection.provider?.protocol === 'comfyui';
  const isJimengCliImageSelected = isExternalSelected && providerSelection.provider?.protocol === 'jimeng-cli';
  const isJimengCliSeedream5Pro = isJimengCliImageSelected && /seedream[-_\s]?5\.0[-_\s]?pro/i.test(externalProviderModel);
  const jimengImageResolutions = jimengImageResolutionOptions(externalProviderModel);
  const jimengImageResolution = String(providerParams.resolutionType || (isJimengCliSeedream5Pro ? '1.5k' : '2k')).toLowerCase();
  const jimengCliCustomSizeEnabled = isJimengCliImageSelected && providerParams?.customSizeEnabled === true;
  const jimengCliWidth = Math.round(Number(providerParams?.width) || 1024);
  const jimengCliHeight = Math.round(Number(providerParams?.height) || 1024);
  const externalImageCountLimit = isJimengCliImageSelected ? 10 : 4;
  const comfyWorkflow = isComfyExternal
    ? providerSelection.provider?.comfyuiConfig?.workflows?.find((workflow) => workflow.id === externalProviderModel || workflow.name === externalProviderModel)
    : undefined;
  const comfyWorkflowFields = useMemo(() => {
    if (!isComfyExternal || !comfyWorkflow) return [];
    return canonicalizeComfyFieldsByWorkflow(comfyWorkflow.workflowJson, comfyWorkflow.fields || []);
  }, [isComfyExternal, comfyWorkflow]);
  const comfyRequiredImageCount = isComfyExternal
    ? comfyWorkflowFields.filter((field: any) => COMFY_IMAGE_SOURCE_RE.test(String(field?.source || ''))).length
    : 0;
  const comfyParamFields = useMemo(() => {
    if (!isComfyExternal || !comfyWorkflow) return [];
    const seen = new Set<string>();
    return comfyWorkflowFields.filter((field: any) => {
      const source = comfyFieldSource(field);
      const key = `${field?.nodeId || ''}:${field?.fieldName || ''}:${source}`;
      if (!isComfyNodeFieldSource(source) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [isComfyExternal, comfyWorkflow, comfyWorkflowFields]);
  const comfyHasPromptField = useMemo(
    () => comfyParamFields.some((field: any) => ['prompt', 'positive'].includes(comfyFieldSource(field))),
    [comfyParamFields],
  );
  const comfyImageInputFields = useMemo(
    () => comfyParamFields.filter((field: any) => COMFY_IMAGE_SOURCE_RE.test(comfyFieldSource(field))),
    [comfyParamFields],
  );
  const modelscopeLoras = useMemo(
    () => modelscopeLorasForModel(providerSelection.provider, externalProviderModel),
    [providerSelection.provider, externalProviderModel],
  );
  const modelscopeLoraEnabled = providerParams?.modelscopeLoraEnabled === true;
  const selectedModelscopeLoras = useMemo(() => {
    if (!modelscopeLoraEnabled) return [];
    const normalized = normalizeModelscopeSelectedLoras(
      providerParams?.modelscopeLoras ?? providerParams?.loras,
      modelscopeLoras,
      {
        enabled: providerParams?.modelscopeLoraEnabled,
        id: providerParams?.modelscopeLoraId,
        strength: providerParams?.modelscopeLoraStrength,
      },
    );
    if (normalized.length) return normalized;
    const first = modelscopeLoras[0];
    return first
      ? [{ id: first.id, strength: normalizeModelscopeLoraStrength(first.strength, 0.8) }]
      : [];
  }, [
    modelscopeLoraEnabled,
    modelscopeLoras,
    providerParams?.loras,
    providerParams?.modelscopeLoraId,
    providerParams?.modelscopeLoraStrength,
    providerParams?.modelscopeLoras,
  ]);
  const selectedModelscopeLoraIds = useMemo(
    () => new Set(selectedModelscopeLoras.map((lora) => lora.id)),
    [selectedModelscopeLoras],
  );
  const unselectedModelscopeLoras = useMemo(
    () => modelscopeLoras.filter((lora) => !selectedModelscopeLoraIds.has(lora.id)),
    [modelscopeLoras, selectedModelscopeLoraIds],
  );
  const selectedModelscopeLoraTotal = useMemo(
    () => modelscopeLoraWeightTotal(selectedModelscopeLoras),
    [selectedModelscopeLoras],
  );
  const selectedModelscopeLoraRemaining = Math.max(
    0,
    Number((MODELSCOPE_LORA_TOTAL_WEIGHT - selectedModelscopeLoraTotal).toFixed(4)),
  );
  const nextGenerationRun = () => {
    generationRunRef.current += 1;
    return generationRunRef.current;
  };
  const isCurrentGenerationRun = (runId: number) => generationRunRef.current === runId;
  const patchProviderParams = (patch: Record<string, any>) => {
    update({ providerParams: { ...providerParams, ...patch } });
  };
  const applyModelscopeLoraSelection = (nextSelection: ModelscopeSelectedLora[], enabled = true) => {
    const normalized = normalizeModelscopeLoraWeightsTotal(
      normalizeModelscopeSelectedLoras(nextSelection, modelscopeLoras),
    );
    const first = normalized[0];
    update({
      providerParams: {
        ...providerParams,
        modelscopeLoraEnabled: enabled && normalized.length > 0,
        modelscopeLoras: normalized,
        loras: undefined,
        modelscopeLoraId: first?.id || '',
        modelscopeLoraStrength: first?.strength,
      },
    });
  };
  const addModelscopeLoraSelection = () => {
    if (selectedModelscopeLoras.length >= MAX_MODELSCOPE_NODE_LORAS) return;
    if (selectedModelscopeLoras.length > 0 && selectedModelscopeLoraRemaining <= 0.0001) return;
    const next = unselectedModelscopeLoras[0];
    if (!next) return;
    const defaultWeight = normalizeModelscopeLoraStrength(next.strength, 0.8);
    const nextWeight = selectedModelscopeLoras.length > 0
      ? Math.min(defaultWeight, selectedModelscopeLoraRemaining)
      : defaultWeight;
    applyModelscopeLoraSelection([
      ...selectedModelscopeLoras,
      { id: next.id, strength: nextWeight },
    ]);
  };
  const updateModelscopeLoraSelection = (index: number, patch: Partial<ModelscopeSelectedLora>) => {
    const otherTotal = modelscopeLoraWeightTotal(selectedModelscopeLoras.filter((_, i) => i !== index));
    const maxForRow = Math.max(0, Number((MODELSCOPE_LORA_TOTAL_WEIGHT - otherTotal).toFixed(4)));
    const nextSelection = selectedModelscopeLoras.map((item, i) => {
      if (i !== index) return item;
      const nextId = String(patch.id ?? item.id).trim();
      const nextOption = modelscopeLoras.find((lora) => lora.id === nextId);
      const hasStrengthPatch = Object.prototype.hasOwnProperty.call(patch, 'strength');
      return {
        id: nextId,
        strength: Math.min(
          normalizeModelscopeLoraStrength(
            hasStrengthPatch ? patch.strength : item.strength,
            nextOption?.strength ?? 0.8,
          ),
          maxForRow,
        ),
      };
    });
    applyModelscopeLoraSelection(nextSelection);
  };
  const removeModelscopeLoraSelection = (index: number) => {
    applyModelscopeLoraSelection(selectedModelscopeLoras.filter((_, i) => i !== index));
  };
  const distributeSelectedModelscopeLoraWeights = () => {
    applyModelscopeLoraSelection(distributeModelscopeLoraWeights(selectedModelscopeLoras));
  };
  const comfyFieldDefault = (field: any) => {
    if (!comfyWorkflow?.workflowJson || !field?.nodeId || !field?.fieldName) return '';
    const value = comfyFieldInputValue(comfyWorkflow.workflowJson, field);
    if (Array.isArray(value) || (value && typeof value === 'object')) return '';
    return value ?? '';
  };
  const comfyValueForSource = (source: string) => {
    const field = comfyParamFields.find((item: any) => comfyFieldSource(item) === source);
    return providerParams[source] ?? (field ? comfyFieldDefault(field) : '');
  };
  const comfyNumberForSource = (source: string, fallback = 0) => {
    const n = Number(comfyValueForSource(source));
    return Number.isFinite(n) ? n : fallback;
  };
  const clearModelscopeLoraParams = () => ({
    providerParams: {
      ...providerParams,
      modelscopeLoraEnabled: false,
      modelscopeLoraId: '',
      modelscopeLoraStrength: undefined,
      modelscopeLoras: [],
      loras: undefined,
    },
  });

  const aspectRatio = d?.aspectRatio || modelDef.defaultAspectRatio;
  const sizeLevel = d?.sizeLevel || modelDef.defaultSize;
  // 子模型变体(对齐 gpt-image-2-web 的 g_model/n_model)
  const savedApiModel = typeof d?.apiModel === 'string' ? d.apiModel : '';
  // 旧画布没有 imageBuiltinSource；保存过平价小屋模型时自动恢复对应平台。
  const isBudgetImageTab = modelDef.id === 'gpt-image-2'
    || modelDef.id === 'nano-banana-2'
    || modelDef.id === 'nano-banana-pro'
    || modelDef.id === 'grok-image';
  const isQwenImageTab = modelDef.paramKind === 'qwen-image-3.0';
  const isSeedreamLayerTab = modelDef.paramKind === 'seedream-layer';
  const isWanImageTab = modelDef.paramKind === 'wan-image';
  const isZhenzhenBudgetImageSelected = !isExternalSelected
    && isBudgetImageTab
    && (d?.imageBuiltinSource === 'seedance-nz' || isZhenzhenBudgetImageModel(savedApiModel));
  const isZhenzhenBudgetMjSelected = !isExternalSelected
    && modelDef.paramKind === 'mj'
    && d?.imageBuiltinSource === 'seedance-nz';
  const isZhenzhenBudgetPlatformSelected = isZhenzhenBudgetImageSelected
    || isZhenzhenBudgetMjSelected
    || isQwenImageTab
    || isSeedreamLayerTab
    || isWanImageTab;
  const budgetDefaultApiModel = modelDef.id === 'grok-image'
    ? ZHENZHEN_IMAGE_GK_V15_MODEL
    : modelDef.id === 'nano-banana-2'
      ? ZHENZHEN_IMAGE_NB_2_MODEL
      : modelDef.id === 'nano-banana-pro'
        ? ZHENZHEN_IMAGE_NB_PRO_MODEL
        : ZHENZHEN_IMAGE_G2_T2I_MODEL;
  const builtinApiModelOptions = isZhenzhenBudgetImageSelected
    ? modelDef.id === 'grok-image'
      ? ZHENZHEN_BUDGET_GROK_MODEL_OPTIONS
      : modelDef.id === 'nano-banana-2'
        ? ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS
        : modelDef.id === 'nano-banana-pro'
          ? ZHENZHEN_BUDGET_BANANA_PRO_MODEL_OPTIONS
          : ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS
    : modelDef.apiModelOptions;
  const apiModel = builtinApiModelOptions.some((opt) => opt.value === savedApiModel)
    ? savedApiModel
    : (isZhenzhenBudgetImageSelected ? budgetDefaultApiModel : modelDef.apiModel);
  const isZhenzhenImageG2 = isZhenzhenBudgetImageSelected && isZhenzhenImageG2Model(apiModel);
  const isZhenzhenImageG2I2I = apiModel === ZHENZHEN_IMAGE_G2_I2I_MODEL;
  const isZhenzhenApimartImage = isZhenzhenBudgetImageSelected && isZhenzhenApimartImageModel(apiModel);
  const isZhenzhenLowpriceImage = apiModel === ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL;
  const isZhenzhenGrokImageV2 = apiModel === ZHENZHEN_IMAGE_GK_V2_MODEL;
  const isZhenzhenGrokImageV2Edit = apiModel === ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL;
  const isZhenzhenGrokImage = apiModel === ZHENZHEN_IMAGE_GK_V15_MODEL;
  const isZhenzhenGrokImageEdit = apiModel === ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL;
  const isZhenzhenNb2Lite = apiModel === ZHENZHEN_IMAGE_NB_2_LITE_MODEL;
  const isZhenzhenNb2 = apiModel === ZHENZHEN_IMAGE_NB_2_MODEL;
  const isZhenzhenNbPro = apiModel === ZHENZHEN_IMAGE_NB_PRO_MODEL;
  const isZhenzhenNb = isZhenzhenNb2Lite || isZhenzhenNb2 || isZhenzhenNbPro;
  const isQwenImageI2I = isQwenImageTab && isQwenImage30I2IModel(apiModel);
  const isWanImageI2I = isWanImageTab && isWan27GlobalI2IModel(apiModel);
  const zhenzhenNbImageCount = isZhenzhenNb2Lite
    ? Math.min(4, Math.max(1, Number(d?.apimartImageCount) || 1))
    : 1;
  const grokV2ImageCount = Math.min(isZhenzhenGrokImageV2 ? 12 : 10, Math.max(1, Number(d?.grokV2ImageCount) || 1));
  const grokV2EditResolution = (ZHENZHEN_IMAGE_GK_V2_EDIT_RESOLUTIONS as readonly string[]).includes(d?.grokV2EditResolution)
    ? d.grokV2EditResolution as '1k' | '2k'
    : '1k';
  const grokV2EditNsfwCheck = d?.grokV2EditNsfwCheck === true;
  const seedanceNzProviderLabel = isZhenzhenBudgetPlatformSelected
    ? '贞贞的平价AI小屋'
    : '贞贞的平价AI小屋';
  const effectiveAspectRatios = isZhenzhenImageG2
    ? ZHENZHEN_IMAGE_G2_RATIOS
    : isZhenzhenGrokImageV2Edit
      ? [...ZHENZHEN_IMAGE_GK_V2_EDIT_RATIOS]
    : isZhenzhenGrokImageV2
      ? ZHENZHEN_IMAGE_GK_V2_RATIOS
    : (isZhenzhenGrokImage || isZhenzhenGrokImageEdit)
      ? ZHENZHEN_IMAGE_GK_V15_RATIOS
      : (isZhenzhenNb2 || isZhenzhenNb2Lite)
        ? ZHENZHEN_IMAGE_NB_EXTREME_RATIOS
        : isZhenzhenNbPro
          ? ZHENZHEN_IMAGE_NB_STANDARD_RATIOS
      : isZhenzhenLowpriceImage
        ? modelDef.aspectRatios.filter((item) => item !== 'Auto')
        : modelDef.aspectRatios;
  const effectiveAspectRatio = effectiveAspectRatios.includes(aspectRatio)
    ? aspectRatio
    : (isZhenzhenImageG2 ? 'adaptive' : isZhenzhenGrokImageV2Edit ? 'auto' : '1:1');
  const effectiveSizes = isZhenzhenImageG2
    ? ['1K']
    : isZhenzhenLowpriceImage
      ? ['1K', '2K', '4K']
      : isZhenzhenNb2
        ? ['0.5K', '1K', '2K', '4K']
        : isZhenzhenNb2Lite
          ? ['1K']
          : isZhenzhenNbPro
            ? ['1K', '2K', '4K']
      : (isZhenzhenGrokImageV2 || isZhenzhenGrokImageV2Edit || isZhenzhenGrokImage || isZhenzhenGrokImageEdit)
        ? []
        : modelDef.sizes;
  const effectiveSizeLevel = isZhenzhenImageG2
    ? '1K'
    : isZhenzhenNb2Lite
      ? '1K'
      : isZhenzhenNb2 && !['0.5K', '1K', '2K', '4K'].includes(sizeLevel)
        ? '1K'
        : (isZhenzhenLowpriceImage || isZhenzhenNbPro) && !['1K', '2K', '4K'].includes(sizeLevel)
          ? '1K'
          : sizeLevel;

  // ========== FAL 渠道识别及参数(不影响其他模型) ==========
  const isFal = isFalModel(apiModel);
  const falDef = isFal ? FAL_REGISTRY[apiModel] : undefined;
  const falKind = falDef?.paramKind; // 'gpt-fal' | 'nbpro-fal'
  const isStandardGptImage2 = !isExternalSelected
    && modelDef.paramKind === 'gpt-size'
    && !isFal
    && !isZhenzhenBudgetImageSelected;
  const gptImageQuality: 'auto' | 'high' | 'medium' | 'low' = ['auto', 'high', 'medium', 'low'].includes(d?.gptImageQuality)
    ? d.gptImageQuality
    : 'auto';
  const gptImageModeration: 'auto' | 'low' = d?.gptImageModeration === 'low' ? 'low' : 'auto';
  // FAL 参数(默认对齐主项目初始值)
  // gpt-fal: mode/size/quality/n/format/sync/customW/customH
  const falMode: 'edit' | 'gen' = d?.falMode || 'edit';
  const falSize: string = d?.falSize || 'auto';
  const falCustomW: number = d?.falCustomW ?? 1280;
  const falCustomH: number = d?.falCustomH ?? 1280;
  const falQuality: 'low' | 'medium' | 'high' | 'auto' = d?.falQuality || 'medium';
  const falN: number = d?.falN ?? 1;
  const falFormat: 'png' | 'jpeg' | 'webp' = d?.falFormat || 'png';
  const falSync: boolean = d?.falSync === true;
  // nbpro-fal: aspect_ratio/resolution/safety/imgMode/webSearch/sysPrompt/seed
  const nbAspect: string = d?.nbAspect || 'auto';
  const nbResolution: string = d?.nbResolution || '2K';
  const nbSafety: string = d?.nbSafety || '4';
  const nbImgMode: 'image_url' | 'base64' = d?.nbImgMode || 'image_url';
  const nbWebSearch: boolean = d?.nbWebSearch === true;
  const nbSysPrompt: string = d?.nbSysPrompt || '';
  const nbSeed: number = d?.nbSeed ?? 0;

  // ========== MJ 渠道识别及参数(完全对齐 gpt-image-2-web mj_* 控件 L1552~L1580) ==========
  const isMj = modelDef.paramKind === 'mj';
  const mjNzOperation = (d?.mjNzOperation || 'midjourney-imagine') as MidjourneyNzOperation;
  const mjNzVideoSource: 'image' | 'task' = d?.mjNzVideoSource === 'task' ? 'task' : 'image';
  const isGrokImage = modelDef.paramKind === 'grok-image';
  const isSeedream = modelDef.paramKind === 'seedream-v5';
  const qwenSizingMode: 'auto' | 'ratio' | 'custom_size' = ['ratio', 'custom_size'].includes(d?.qwenSizingMode)
    ? d.qwenSizingMode
    : 'auto';
  const qwenResolution: '1k' | '2k' = d?.qwenResolution === '2k' ? '2k' : '1k';
  const qwenCustomSize = String(d?.qwenCustomSize || '1024*1024').trim().replace(/[xX×]/g, '*');
  const qwenImageCount = Math.min(6, Math.max(1, Number(d?.qwenImageCount) || 1));
  const qwenSeed = Number.isInteger(d?.qwenSeed) ? Math.max(-1, Math.min(2147483647, d.qwenSeed)) : -1;
  const qwenNegativePrompt = typeof d?.qwenNegativePrompt === 'string' ? d.qwenNegativePrompt : '';
  const qwenPromptExtend = d?.qwenPromptExtend !== false;
  const wanImageWidth = Math.min(4096, Math.max(512, Number(d?.wanImageWidth) || 1024));
  const wanImageHeight = Math.min(4096, Math.max(512, Number(d?.wanImageHeight) || 1024));
  const wanImageThinkingMode = d?.wanImageThinkingMode !== false;
  const seedreamLayerResolution: 'auto' | '1k' | '1.5k' | '2k' = (SEEDREAM_LAYER_RESOLUTIONS as readonly string[])
    .includes(d?.seedreamLayerResolution)
    ? d.seedreamLayerResolution
    : 'auto';
  const seedreamApiSource: 'zhenzhen' | 'seedance-nz' = d?.seedreamApiSource === 'seedance-nz' ? 'seedance-nz' : 'zhenzhen';
  const isSeedreamNz = isSeedream && seedreamApiSource === 'seedance-nz';
  const seedreamNzModelFamily: 'domestic' | 'overseas' = d?.seedreamNzModelFamily === 'overseas'
    ? 'overseas'
    : 'domestic';
  const seedreamNzResolution: '1k' | '2k' | 'custom' = ['1k', '2k', 'custom'].includes(d?.seedreamNzResolution)
    ? d.seedreamNzResolution
    : '2k';
  const seedreamNzCustomSize = typeof d?.seedreamNzCustomSize === 'string' ? d.seedreamNzCustomSize : '2048x2048';
  const seedreamNzResolvedSize = seedreamNzCustomSize.trim().replace(/\s+/g, '').replace(/[X×]/g, 'x');
  const seedreamOutputFormat: 'png' | 'jpeg' = d?.seedreamOutputFormat === 'jpeg' ? 'jpeg' : 'png';
  const seedreamCustomSize = typeof d?.seedreamCustomSize === 'string' ? d.seedreamCustomSize : '2048x2048';
  const seedreamResolvedSize = (sizeLevel === 'custom' ? seedreamCustomSize : sizeLevel)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[X×]/g, 'x');
  const mjVersion: string = d?.mjVersion || DEFAULT_MJ_VERSION;
  const mjAr: string = d?.mjAr || DEFAULT_MJ_RATIO;
  const mjSpeed: MjSpeed = (d?.mjSpeed as MjSpeed) || DEFAULT_MJ_SPEED;
  const mjC: number = d?.mjC ?? 0;
  const mjS: number = d?.mjS ?? 0;
  const mjIw: number = d?.mjIw ?? 0;
  const mjSw: number = d?.mjSw ?? 0;
  const mjSv: string = d?.mjSv || '1';
  const mjNo: string = d?.mjNo || '';
  const mjSeed: number = d?.mjSeed ?? 0;
  const mjMaxPoll: number = d?.mjMaxPoll ?? 1200;
  const mjPollInt: number = d?.mjPollInt ?? 3;
  const mjSrefImages: string[] = Array.isArray(d?.mjSrefImages) ? d.mjSrefImages : [];
  const mjOrefImages: string[] = Array.isArray(d?.mjOrefImages) ? d.mjOrefImages : [];
  const MJ_REF_MAX = 2; // sref 与 oref 各最多 2 张

  // 参考图上限(FAL 使用 FAL_REGISTRY.maxRefs,其他走原设计)
  const maxRefs = isExternalSelected
    ? isJimengCliImageSelected
      ? 10
      : Math.max(8, modelDef.maxReferenceImages || 0)
    : isSeedreamLayerTab
      ? 1
    : isQwenImageTab
      ? isQwenImageI2I ? 3 : 0
    : isWanImageTab
      ? isWanImageI2I ? 9 : 0
    : isZhenzhenImageG2I2I
      ? 10
    : isZhenzhenLowpriceImage
      ? 16
      : isZhenzhenNb
        ? 14
      : isZhenzhenGrokImageEdit
          ? 1
          : (isZhenzhenImageG2 || isZhenzhenGrokImageV2 || isZhenzhenGrokImage)
            ? 0
      : (falDef?.maxRefs ?? modelDef.maxReferenceImages);
  const status: 'idle' | 'generating' | 'success' | 'error' = d?.status || 'idle';
  const imageUrl = d?.imageUrl as string | undefined;
  const videoUrl = d?.videoUrl as string | undefined;
  const outputText = typeof d?.outputText === 'string' ? d.outputText : '';
  const localPrompt = d?.prompt || '';
  const imageOnlyOutput = d?.imageOnlyOutput !== false;
  const promptMentions: MediaMention[] = Array.isArray(d?.promptMentions) ? d.promptMentions : [];
  const imagePromptAdjustments = useMemo(
    () => normalizeImagePromptAdjustmentSelections(d?.imagePromptAdjustments),
    [d?.imagePromptAdjustments],
  );
  const updateImagePromptAdjustments = (next: ImagePromptAdjustmentSelection[]) => {
    update({ imagePromptAdjustments: next });
  };
  // 节点内本地上传的参考图(除了上游接入的,这里是手动上传)
  const refImages: string[] = Array.isArray(d?.referenceImages) ? d.referenceImages : [];

  // ============ 上游素材聚合 (新机制) ============
  const upstream = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(
    () => normalizeExcludedMaterialIds(d?.excludedMaterialIds),
    [d?.excludedMaterialIds],
  );
  const visibleUpstreamImages = useMemo(
    () => filterExcludedMaterials(upstream.images, excludedMaterialIds),
    [upstream.images, excludedMaterialIds],
  );
  const visibleUpstreamTexts = useMemo(
    () => filterExcludedMaterials(upstream.texts, excludedMaterialIds),
    [upstream.texts, excludedMaterialIds],
  );
  const excludedUpstreamCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstream.images, ...upstream.texts]),
    [excludedMaterialIds, upstream.images, upstream.texts],
  );
  const localImageMaterials: Material[] = useMemo(
    () =>
      refImages.map((url, i) => ({
        id: `local::image:${url}`,
        kind: 'image' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地${i + 1}`,
      })),
    [refImages, id],
  );
  const allImagesUnordered = useMemo(
    () => [...localImageMaterials, ...visibleUpstreamImages],
    [localImageMaterials, visibleUpstreamImages],
  );
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedImages = useOrderedMaterials(allImagesUnordered, materialOrder);
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const seedreamNzUiModel = seedreamNzModelFamily === 'overseas'
    ? (orderedImages.length > 0 ? 'dola-seedream-5.0-pro-i2i' : 'dola-seedream-5.0-pro-t2i')
    : (orderedImages.length > 0 ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro-t2i');
  const seedreamNzModelRegion = seedreamNzModelFamily === 'overseas' ? '海外模型' : '国内模型';
  const mentionMaterials = useMemo(
    () => orderedImages.slice(0, maxRefs),
    [orderedImages, maxRefs],
  );
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const handleRemoveLocalMaterial = (m: Material) => {
    if (m.origin !== 'local') return;
    update({ referenceImages: refImages.filter((u) => u !== m.url) });
  };
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });

  // 切换模型时,如果当前比例/尺寸不在新模型选项里则重置
  const switchModel = (mId: string) => {
    const newDef = IMAGE_MODELS.find((m) => m.id === mId) || IMAGE_MODELS[0];
    if (newDef.paramKind === 'seedream-layer') {
      update({
        model: newDef.id,
        apiModel: newDef.apiModel,
        imageBuiltinSource: 'seedance-nz',
        aspectRatio: '',
        sizeLevel: '',
        seedreamLayerResolution: (SEEDREAM_LAYER_RESOLUTIONS as readonly string[]).includes(d?.seedreamLayerResolution)
          ? d.seedreamLayerResolution
          : 'auto',
        seedreamOutputFormat: d?.seedreamOutputFormat === 'jpeg' ? 'jpeg' : 'png',
      });
      return;
    }
    if (newDef.paramKind === 'qwen-image-3.0') {
      update({
        model: newDef.id,
        apiModel: newDef.apiModel,
        imageBuiltinSource: 'seedance-nz',
        aspectRatio: '1:1',
        sizeLevel: '',
        qwenSizingMode: d?.qwenSizingMode || 'auto',
        qwenResolution: d?.qwenResolution || '1k',
        qwenCustomSize: d?.qwenCustomSize || '1024*1024',
        qwenImageCount: Math.min(6, Math.max(1, Number(d?.qwenImageCount) || 1)),
        qwenSeed: Number.isInteger(d?.qwenSeed) ? d.qwenSeed : -1,
        qwenPromptExtend: d?.qwenPromptExtend !== false,
      });
      return;
    }
    if (newDef.paramKind === 'wan-image') {
      update({
        model: newDef.id,
        apiModel: newDef.apiModel,
        imageBuiltinSource: 'seedance-nz',
        aspectRatio: '',
        sizeLevel: '',
        wanImageWidth: Math.min(4096, Math.max(512, Number(d?.wanImageWidth) || 1024)),
        wanImageHeight: Math.min(4096, Math.max(512, Number(d?.wanImageHeight) || 1024)),
        wanImageThinkingMode: d?.wanImageThinkingMode !== false,
      });
      return;
    }
    if (
      isZhenzhenBudgetPlatformSelected
      && (
        newDef.id === 'gpt-image-2'
        || newDef.id === 'nano-banana-2'
        || newDef.id === 'nano-banana-pro'
        || newDef.id === 'grok-image'
        || newDef.id === 'midjourney'
      )
    ) {
      if (newDef.id === 'midjourney') {
        update({
          model: newDef.id,
          apiModel: newDef.apiModel,
          imageBuiltinSource: 'seedance-nz',
          mjNzOperation: d?.mjNzOperation || 'midjourney-imagine',
          mjNzSpeed: d?.mjNzSpeed || 'fast',
        });
        return;
      }
      const nextApiModel = newDef.id === 'grok-image'
        ? ZHENZHEN_IMAGE_GK_V15_MODEL
        : newDef.id === 'nano-banana-2'
          ? ZHENZHEN_IMAGE_NB_2_MODEL
          : newDef.id === 'nano-banana-pro'
            ? ZHENZHEN_IMAGE_NB_PRO_MODEL
            : ZHENZHEN_IMAGE_G2_T2I_MODEL;
      update({
        model: newDef.id,
        apiModel: nextApiModel,
        imageBuiltinSource: 'seedance-nz',
        aspectRatio: newDef.id === 'gpt-image-2' ? 'adaptive' : '1:1',
        sizeLevel: newDef.id === 'grok-image' ? '' : '1K',
        apimartImageCount: 1,
      });
      return;
    }
    const patch: any = { model: mId, apiModel: newDef.apiModel, imageBuiltinSource: 'zhenzhen' };
    if (newDef.paramKind === 'mj') {
      if (!d?.mjVersion) patch.mjVersion = DEFAULT_MJ_VERSION;
      if (!d?.mjAr) patch.mjAr = DEFAULT_MJ_RATIO;
      if (!d?.mjSpeed) patch.mjSpeed = DEFAULT_MJ_SPEED;
      if (d?.mjSv === undefined) patch.mjSv = '1';
    } else {
      if (!newDef.aspectRatios.includes(aspectRatio)) patch.aspectRatio = newDef.defaultAspectRatio;
      if (!newDef.sizes.includes(sizeLevel)) patch.sizeLevel = newDef.defaultSize;
    }
    update(patch);
  };

  const switchApiModel = (nextApiModel: string) => {
    if ((QWEN_IMAGE_30_MODELS as readonly string[]).includes(nextApiModel)) {
      update({
        model: 'qwen-image-3.0',
        apiModel: nextApiModel,
        imageBuiltinSource: 'seedance-nz',
        aspectRatio: QWEN_IMAGE_30_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1',
      });
      return;
    }
    if ((WAN27_GLOBAL_IMAGE_MODELS as readonly string[]).includes(nextApiModel)) {
      update({
        model: 'wan-image',
        apiModel: nextApiModel,
        imageBuiltinSource: 'seedance-nz',
        aspectRatio: '',
        sizeLevel: '',
      });
      return;
    }
    const nextSize = gptImage2ZhenzhenVariantSize(nextApiModel);
    if (isZhenzhenBudgetImageModel(nextApiModel)) {
      const nextModel = nextApiModel === ZHENZHEN_IMAGE_GK_V2_MODEL
        || nextApiModel === ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL
        || nextApiModel === ZHENZHEN_IMAGE_GK_V15_MODEL
        || nextApiModel === ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL
        ? 'grok-image'
        : nextApiModel === ZHENZHEN_IMAGE_NB_2_MODEL || nextApiModel === ZHENZHEN_IMAGE_NB_2_LITE_MODEL
          ? 'nano-banana-2'
          : nextApiModel === ZHENZHEN_IMAGE_NB_PRO_MODEL
            ? 'nano-banana-pro'
            : 'gpt-image-2';
      const nextRatio = isZhenzhenImageG2Model(nextApiModel)
        ? (ZHENZHEN_IMAGE_G2_RATIOS.includes(aspectRatio) ? aspectRatio : 'adaptive')
        : nextApiModel === ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL
          ? ((ZHENZHEN_IMAGE_GK_V2_EDIT_RATIOS as readonly string[]).includes(aspectRatio) ? aspectRatio : 'auto')
        : nextModel === 'grok-image'
          ? (ZHENZHEN_IMAGE_GK_V15_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1')
          : nextModel === 'nano-banana-2'
            ? (ZHENZHEN_IMAGE_NB_EXTREME_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1')
            : nextModel === 'nano-banana-pro'
              ? (ZHENZHEN_IMAGE_NB_STANDARD_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1')
          : (aspectRatio !== 'Auto' && IMAGE_MODELS[0].aspectRatios.includes(aspectRatio) ? aspectRatio : '1:1');
      update({
        model: nextModel,
        apiModel: nextApiModel,
        imageBuiltinSource: 'seedance-nz',
        sizeLevel: nextApiModel === ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL
          ? (['1K', '2K', '4K'].includes(sizeLevel) ? sizeLevel : '1K')
          : nextApiModel === ZHENZHEN_IMAGE_NB_2_MODEL
            ? (['0.5K', '1K', '2K', '4K'].includes(sizeLevel) ? sizeLevel : '1K')
            : nextApiModel === ZHENZHEN_IMAGE_NB_2_LITE_MODEL
              ? '1K'
              : nextApiModel === ZHENZHEN_IMAGE_NB_PRO_MODEL
                ? (['1K', '2K', '4K'].includes(sizeLevel) ? sizeLevel : '1K')
                : isZhenzhenImageG2Model(nextApiModel) ? '1K' : '',
        aspectRatio: nextRatio,
        apimartImageCount: nextApiModel === ZHENZHEN_IMAGE_NB_2_LITE_MODEL
          ? Math.min(4, Math.max(1, Number(d?.apimartImageCount) || 1))
          : 1,
      });
      return;
    }
    const leavingG2Patch = isZhenzhenBudgetImageSelected ? { aspectRatio: modelDef.defaultAspectRatio } : {};
    update(nextSize
      ? { apiModel: nextApiModel, imageBuiltinSource: 'zhenzhen', sizeLevel: nextSize, ...leavingG2Patch }
      : { apiModel: nextApiModel, imageBuiltinSource: 'zhenzhen', ...leavingG2Patch });
  };

  // 从上游节点 + 本地上传按用户排序后的顺序聚合 prompt + 参考图
  // 注意: 此处只输出已合并、已排序的列表, 不再原地从 edges/nodes 二次收集
  const collectUpstream = (): { prompt: string; images: string[] } => {
    const prompts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    const images: string[] = [];
    for (const m of orderedImages) {
      if (typeof m.url === 'string' && m.url) images.push(m.url);
    }
    void getEdges;
    void getNodes;
    return {
      prompt: prompts.join('\n').trim(),
      images: images.slice(0, maxRefs),
    };
  };

  // 手动上传主参考图 (走 mainFileInputRef, 与 MJ sref/oref 隔离)
  const handlePickFile = () => mainFileInputRef.current?.click();
  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);
    try {
      const remain = maxRefs - orderedImages.length;
      const accepted = files.slice(0, Math.max(0, remain));
      const uploaded: string[] = [];
      for (const f of accepted) {
        const r = await uploadFile(f);
        uploaded.push(r.url);
      }
      update({ referenceImages: [...refImages, ...uploaded] });
    } catch (err: any) {
      setError(err?.message || '上传失败');
    } finally {
      if (mainFileInputRef.current) mainFileInputRef.current.value = '';
    }
  };

  // ========== MJ 参考图上传(sref/oref)与移除 ==========
  const handleMjPick = (kind: 'sref' | 'oref') => {
    mjUploadKindRef.current = kind;
    fileInputRef.current?.click();
  };
  const handleMjFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);
    try {
      const kind = mjUploadKindRef.current;
      const cur = kind === 'sref' ? mjSrefImages : mjOrefImages;
      const remain = MJ_REF_MAX - cur.length;
      const accepted = files.slice(0, Math.max(0, remain));
      const uploaded: string[] = [];
      for (const f of accepted) {
        const url = await uploadMjImage(f, mjSpeed);
        if (url) uploaded.push(url);
      }
      if (kind === 'sref') update({ mjSrefImages: [...cur, ...uploaded] });
      else update({ mjOrefImages: [...cur, ...uploaded] });
    } catch (err: any) {
      setError(err?.message || 'MJ 参考图上传失败');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const removeMjRef = (kind: 'sref' | 'oref', idx: number) => {
    if (kind === 'sref') update({ mjSrefImages: mjSrefImages.filter((_, i) => i !== idx) });
    else update({ mjOrefImages: mjOrefImages.filter((_, i) => i !== idx) });
  };

  const handleGenerate = async (reporter?: RunNodeLifecycleReporter) => {
    setError(null);
    setDownloadNotice(null);
    const { prompt: upstreamPrompt, images: upstreamImages } = collectUpstream();
    const resolvedLocalPrompt = resolveMediaMentions(localPrompt, promptMentions, mentionMaterials);
    const comfyProviderPrompt = isComfyExternal
      ? String(providerParams.prompt ?? providerParams.positive ?? '').trim()
      : '';
    const resolvedComfyPrompt = isComfyExternal
      ? resolveMediaMentions(comfyProviderPrompt || localPrompt, promptMentions, mentionMaterials)
      : '';
    const basePrompt = (
      upstreamPrompt
      || (isComfyExternal ? resolvedComfyPrompt : resolvedLocalPrompt)
      || ''
    ).trim();
    const compiledPrompt = (!isComfyExternal || comfyHasPromptField)
      ? combinePromptWithImageAdjustments(
          basePrompt,
          imagePromptAdjustments,
          {
            hasReferenceImages: upstreamImages.length > 0,
            language: 'auto',
          },
        )
      : { finalPrompt: basePrompt, active: [], inactive: [], text: '', language: 'zh' as const };
    const finalPrompt = compiledPrompt.finalPrompt;
    const src = `image:${id.slice(0, 6)}`;
    const promptRequired = !isSeedreamLayerTab && (
      !isZhenzhenBudgetMjSelected
      || midjourneyNzRequiresPrompt(mjNzOperation, mjNzVideoSource)
    );
    if (!basePrompt && promptRequired && (!isComfyExternal || comfyHasPromptField)) {
      setError('未连接 text 节点也未填写 prompt');
      logBus.error('生成中止: 缺少 prompt', src);
      return;
    }
    if (compiledPrompt.inactive.length > 0) {
      logBus.info(
        `图像调节未应用: ${compiledPrompt.inactive.map((item) => `${item.labelZh}（${item.reason}）`).join('、')}`,
        src,
      );
    }
    if (isZhenzhenImageG2 && finalPrompt.length > 20000) {
      setError('Zhenzhen Image G-2 提示词不能超过 20000 字符');
      logBus.error(`生成中止: G-2 提示词长度 ${finalPrompt.length} 超过 20000`, src);
      return;
    }
    if (isZhenzhenImageG2I2I && upstreamImages.length === 0) {
      setError('zhenzhen-image-g2-i2i 至少需要 1 张参考图');
      logBus.error('生成中止: G-2 图生图缺少参考图', src);
      return;
    }
    if (isZhenzhenGrokImageEdit && upstreamImages.length === 0) {
      setError(`${ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL} 必须提供 1 张参考图`);
      logBus.error('生成中止: Grok Image 1.5 编辑缺少参考图', src);
      return;
    }
    if (isZhenzhenGrokImageV2 && finalPrompt.length > 20000) {
      setError('zhenzhen-image-gk-v2 提示词最多 20000 字符');
      logBus.error(`生成中止: Grok Image v2 提示词长度 ${finalPrompt.length} 超过 20000`, src);
      return;
    }
    if (isZhenzhenGrokImageV2Edit) {
      if (finalPrompt.length > 20000) {
        setError('zhenzhen-image-gk-v2-edit 提示词最多 20000 字符');
        logBus.error(`生成中止: Grok Image v2 编辑提示词长度 ${finalPrompt.length} 超过 20000`, src);
        return;
      }
      if (upstreamImages.length < 1 || upstreamImages.length > 3) {
        setError('zhenzhen-image-gk-v2-edit 必须按顺序提供 1–3 张参考图');
        logBus.error(`生成中止: Grok Image v2 编辑参考图数量 ${upstreamImages.length}`, src);
        return;
      }
    }
    if (isQwenImageTab && (finalPrompt.length < 5 || finalPrompt.length > 2000)) {
      setError('Qwen Image 3.0 提示词必须为 5-2000 字符');
      logBus.error(`生成中止: Qwen Image 3.0 提示词长度 ${finalPrompt.length}`, src);
      return;
    }
    if (isQwenImageI2I && upstreamImages.length === 0) {
      setError(`${apiModel} 必须提供 1-3 张参考图`);
      logBus.error('生成中止: Qwen Image 3.0 图像编辑缺少参考图', src);
      return;
    }
    if (isWanImageTab) {
      const promptLimit = isWanImageI2I ? 2048 : 5000;
      if (finalPrompt.length > promptLimit) {
        setError(`${apiModel} 提示词最多 ${promptLimit} 字符`);
        logBus.error(`生成中止: Wan Image 提示词长度 ${finalPrompt.length} 超过 ${promptLimit}`, src);
        return;
      }
      if (isWanImageI2I && (upstreamImages.length < 1 || upstreamImages.length > 9)) {
        setError(`${apiModel} 必须按顺序提供 1–9 张参考图`);
        logBus.error(`生成中止: Wan Image 编辑参考图数量 ${upstreamImages.length}`, src);
        return;
      }
    }
    if (isSeedreamLayerTab && orderedImages.length !== 1) {
      setError('Seedream 分层必须且只能连接或上传 1 张源图');
      logBus.error(`生成中止: Seedream 分层源图数量 ${orderedImages.length}，要求恰好 1 张`, src);
      return;
    }
    if (isSeedreamLayerTab && finalPrompt.length > 2000) {
      setError('Seedream 分层提示词最多 2000 字符');
      logBus.error(`生成中止: Seedream 分层提示词长度 ${finalPrompt.length}`, src);
      return;
    }
    if (isQwenImageTab && qwenSizingMode === 'custom_size' && !/^\d+\*\d+$/.test(qwenCustomSize)) {
      setError('Qwen Image 3.0 自定义尺寸必须为 W*H，例如 1024*1024');
      logBus.error(`生成中止: Qwen Image 3.0 自定义尺寸无效 ${qwenCustomSize || '(空)'}`, src);
      return;
    }
    if (isSeedream && !isSeedreamNz && !/^\d+x\d+$/.test(seedreamResolvedSize)) {
      setError('Seedream 自定义尺寸格式应为 宽x高，例如 2048x1536');
      logBus.error(`生成中止: Seedream 尺寸格式无效 ${seedreamResolvedSize || '(空)'}`, src);
      return;
    }
    if (isSeedreamNz && seedreamNzResolution === 'custom') {
      const match = seedreamNzResolvedSize.match(/^(\d+)x(\d+)$/);
      const width = Number(match?.[1]);
      const height = Number(match?.[2]);
      if (!match || width < 240 || width > 8192 || height < 240 || height > 8192) {
        setError('贞贞的平价AI小屋 Seedream 自定义宽高必须为 240-8192，例如 2048x1536');
        logBus.error(`生成中止: Seedream NZ 尺寸格式无效 ${seedreamNzResolvedSize || '(空)'}`, src);
        return;
      }
    }
    const runId = nextGenerationRun();
    const traceProvider = isExternalSelected && providerSelection.provider
      ? providerSelection.provider.id
      : isFal
        ? 'fal'
        : isSeedreamNz || isZhenzhenBudgetPlatformSelected
          ? 'seedance-nz'
          : isMj
            ? 'zhenzhen-mj'
            : 'zhenzhen';
    const traceModel = isExternalSelected
      ? externalProviderModel
      : isSeedreamNz
        ? seedreamNzUiModel
        : isZhenzhenBudgetImageSelected
          ? apiModel
        : isZhenzhenBudgetMjSelected
          ? mjNzOperation
        : isMj
          ? mjVersion
          : apiModel;
    await reporter?.providerRequest({ provider: traceProvider, model: traceModel });
    taskCompletionSound.primeAudio();
    update({ status: 'generating', progress: '0%', error: null });
    try {
      // collectUpstream 已返回「本地上传 + 上游接入」按用户拖拽顺序合并后的列表,
      // 这里不再二次叠加 refImages, 避免本地参考图重复传递。
      const allRefs = upstreamImages.slice(0, maxRefs);

      if (isExternalSelected && providerSelection.provider) {
        const providerModel = externalProviderModel;
        if (!providerModel) throw new Error('扩展平台未配置可用图像模型');
        let size = externalImageSizeFor(aspectRatio, sizeLevel);
        if (isJimengCliImageSelected && jimengCliCustomSizeEnabled) {
          size = `${jimengCliWidth}x${jimengCliHeight}`;
        }
        if (isComfyExternal && comfyWorkflow) {
          const width = comfyNumberForSource('width', 1024);
          const height = comfyNumberForSource('height', 1024);
          if (width > 0 && height > 0) size = `${Math.round(width)}x${Math.round(height)}`;
        }
        const externalProviderParams = { ...(d?.providerParams || {}) };
        let loraLog = '';
        if (isModelScopeExternal && modelscopeLoraEnabled) {
          if (!selectedModelscopeLoras.length) throw new Error('当前 ModelScope 模型没有可用 LoRA，请先在 API 设置中绑定。');
          const loraPayload: Record<string, number> = {};
          selectedModelscopeLoras.forEach((item) => {
            loraPayload[item.id] = item.strength;
          });
          externalProviderParams.loras = loraPayload;
          externalProviderParams.modelscopeLoras = selectedModelscopeLoras;
          externalProviderParams.modelscopeLoraId = selectedModelscopeLoras[0]?.id || '';
          externalProviderParams.modelscopeLoraStrength = selectedModelscopeLoras[0]?.strength;
          loraLog = ` · LoRA=${selectedModelscopeLoras.map((item) => {
            const option = modelscopeLoras.find((lora) => lora.id === item.id);
            return `${option?.name || item.id}@${item.strength.toFixed(2)}`;
          }).join('+')}`;
        } else {
          delete externalProviderParams.loras;
          delete externalProviderParams.modelscopeLoras;
        }
        const externalNegativePrompt = isComfyExternal
          ? String(
              externalProviderParams.negativePrompt
              ?? externalProviderParams.negative
              ?? '',
            ).trim()
          : '';
        logBus.info(
          `扩展平台提交: ${providerSelection.provider.label || providerSelection.provider.id} · ${providerModel}${loraLog} · size=${size} · 参考图=${allRefs.length}`,
          src,
        );
        const res = await generateExternalImage({
          providerId: providerSelection.provider.id,
          providerModel,
          model: providerModel,
          prompt: finalPrompt,
          size,
          images: allRefs,
          negativePrompt: externalNegativePrompt || undefined,
          negative: externalNegativePrompt || undefined,
          n: Math.max(1, Math.min(externalImageCountLimit, Number(d?.providerParams?.n || 1))),
          providerParams: externalProviderParams,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        const urls = res.imageUrls || [];
        if (!urls.length) throw new Error('扩展平台完成但未返回图片');
        if (res.taskId || res.requestId) await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: res.taskId,
          requestId: res.requestId,
          transportHttpStatus: res.transportHttpStatus,
          upstreamHttpStatus: res.upstreamHttpStatus,
          usage: res.usage,
          httpStatusSource: 'local-backend',
        });
        await reporter?.providerResponse({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: res.taskId,
          requestId: res.requestId,
          transportHttpStatus: res.transportHttpStatus,
          upstreamHttpStatus: res.upstreamHttpStatus,
          usage: res.usage,
          status: 'succeeded',
          httpStatusSource: 'local-backend',
        });
        update({
          status: 'success',
          progress: '100%',
          imageUrl: urls[0],
          imageUrls: urls,
          remoteImageUrls: res.remoteImageUrls,
          lastPrompt: finalPrompt,
          usedI2I: allRefs.length > 0,
          taskId: res.taskId || d?.taskId,
          requestId: res.requestId,
          transportHttpStatus: res.transportHttpStatus,
          upstreamHttpStatus: res.upstreamHttpStatus,
          usage: res.usage,
        });
        logBus.success(`扩展平台完成 → ${urls[0]}`, src);
        taskCompletionSound.notifyComplete(id, 'image');
        return;
      }

      // ============ MJ 路径(对齐 gpt-image-2-web runMJ L4437~L4716) ============
      if (isMj) {
        if (isZhenzhenBudgetMjSelected) {
          if (!zhenzhenSd2ApiKey) {
            throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
          }
          if (mjNzOperation === 'midjourney-blend' && (allRefs.length < 2 || allRefs.length > 4)) {
            throw new Error('midjourney-blend 必须提供 2–4 张参考图');
          }
          if (mjNzOperation === 'midjourney-describe' && allRefs.length !== 1) {
            throw new Error('midjourney-describe 必须且只能提供 1 张参考图');
          }
          if (mjNzOperation === 'midjourney-edits' && (allRefs.length < 1 || allRefs.length > 4)) {
            throw new Error('midjourney-edits 必须提供 1–4 张参考图');
          }
          if (
            mjNzOperation === 'midjourney-video'
            && mjNzVideoSource === 'image'
            && allRefs.length < 1
          ) {
            throw new Error('midjourney-video 直接图片模式必须提供 1 张首帧参考图');
          }
          if (
            mjNzOperation === 'midjourney-video'
            && mjNzVideoSource === 'image'
            && String(d?.mjNzVideoType || '').includes('_start_end_')
            && allRefs.length < 2
          ) {
            throw new Error('Midjourney 首尾帧视频模式还需要第 2 张参考图作为尾帧');
          }
          if (
            mjNzOperation === 'midjourney-modal'
            && d?.mjNzModalMode !== 'outpaint'
            && allRefs.length < 1
          ) {
            throw new Error('Midjourney 局部重绘必须把 PNG 遮罩作为第 1 张参考图');
          }

          const request = buildMidjourneyNzRequest(d, finalPrompt, allRefs);
          logBus.info(
            `平价AI小屋 MJ 提交: action=${mjNzOperation} ref=${allRefs.length} task=${request.task_id ? 'yes' : 'no'}`,
            src,
          );
          const submit = await submitMidjourneyNz(request, {
            submissionKey: reporter?.providerSubmissionKey,
          });
          if (!isCurrentGenerationRun(runId)) return;
          const submittedTaskId = String(submit.taskId || '').trim();
          if (submittedTaskId) {
            await reporter?.providerSubmitted({
              provider: traceProvider,
              model: traceModel,
              upstreamTaskId: submittedTaskId,
              requestId: submit.requestId,
              transportHttpStatus: submit.transportHttpStatus,
              upstreamHttpStatus: submit.upstreamHttpStatus,
              usage: submit.usage,
              httpStatusSource: 'local-backend',
            });
          }

          const finishMidjourneyNz = async (
            result: MidjourneyNzTaskResult,
            pollCount = 0,
          ): Promise<boolean> => {
            const resultStatus = String(result.status || '').toLowerCase();
            const taskId = String(result.taskId || submittedTaskId || '').trim();
            if (resultStatus === 'modal') {
              update({
                status: 'idle',
                progress: '等待遮罩 / Modal',
                taskId,
                mjNzLastTaskId: taskId,
                mjNzSourceTaskId: taskId,
                mjNzOperation: 'midjourney-modal',
                mjNzButtons: result.buttons || [],
                error: null,
              });
              logBus.success('Midjourney 已进入 MODAL：请连接 PNG 遮罩后再次生成', src);
              await reporter?.providerResponse({
                provider: traceProvider,
                model: traceModel,
                upstreamTaskId: taskId,
                requestId: result.requestId || submit.requestId,
                transportHttpStatus: result.transportHttpStatus,
                upstreamHttpStatus: result.upstreamHttpStatus,
                usage: result.usage,
                pollCount,
                status: 'succeeded',
                httpStatusSource: 'local-backend',
              });
              return true;
            }
            if (!['completed', 'success', 'succeeded', 'done'].includes(resultStatus)) return false;
            const imageUrls = Array.isArray(result.imageUrls) ? result.imageUrls : [];
            const videoUrls = Array.isArray(result.videoUrls) ? result.videoUrls : [];
            const outputText = String(result.text || '').trim();
            const resultFamily = String(result.resultFamily || (
              videoUrls.length ? 'video' : outputText ? 'text' : 'image'
            ));
            if (!imageUrls.length && !videoUrls.length && !outputText) {
              throw new Error('Midjourney 任务完成但没有返回可用结果');
            }
            update({
              status: 'success',
              progress: '100%',
              imageUrl: imageUrls[0] || null,
              imageUrls,
              videoUrl: videoUrls[0] || null,
              videoUrls,
              outputText,
              textSegments: outputText ? [outputText] : [],
              imageOnlyOutput: resultFamily === 'text' ? false : imageOnlyOutput,
              lastPrompt: finalPrompt,
              usedI2I: allRefs.length > 0,
              taskId: taskId || d?.taskId,
              mjNzLastTaskId: taskId || d?.mjNzLastTaskId,
              mjNzButtons: result.buttons || [],
              mjNzResultFamily: resultFamily,
              requestId: result.requestId,
              transportHttpStatus: result.transportHttpStatus,
              upstreamHttpStatus: result.upstreamHttpStatus,
              usage: result.usage,
              pollCount,
            });
            logBus.success(
              `平价AI小屋 MJ 完成 · ${resultFamily}${imageUrls.length ? ` · 图片 ${imageUrls.length}` : ''}${videoUrls.length ? ` · 视频 ${videoUrls.length}` : ''}${outputText ? ' · 文本' : ''}`,
              src,
            );
            taskCompletionSound.notifyComplete(id, resultFamily === 'video' ? 'video' : 'image');
            await reporter?.providerResponse({
              provider: traceProvider,
              model: traceModel,
              upstreamTaskId: taskId,
              requestId: result.requestId || submit.requestId,
              transportHttpStatus: result.transportHttpStatus,
              upstreamHttpStatus: result.upstreamHttpStatus,
              usage: result.usage,
              pollCount,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            return true;
          };

          if (await finishMidjourneyNz(submit)) return;
          if (!submittedTaskId) throw new Error('Midjourney 未返回任务 ID 或同步结果');
          update({
            progress: submit.progress || '5%',
            taskId: submittedTaskId,
            mjNzLastTaskId: submittedTaskId,
            mjNzButtons: submit.buttons || [],
          });

          const interval = Math.max(1, Math.min(30, Number(d?.mjNzPollInterval) || 3)) * 1000;
          const maxPoll = Math.max(minPollCountForTimeout(interval), 1200);
          let nextPollDelay = interval;
          for (let i = 0; i < maxPoll; i++) {
            await new Promise((resolve) => setTimeout(resolve, nextPollDelay));
            nextPollDelay = interval;
            if (!isCurrentGenerationRun(runId)) return;
            const query = await queryMidjourneyNz(submittedTaskId);
            if (!isCurrentGenerationRun(runId)) return;
            await reporter?.polling({
              provider: traceProvider,
              model: traceModel,
              taskId: submittedTaskId,
              requestId: query.requestId,
              transportHttpStatus: query.transportHttpStatus,
              upstreamHttpStatus: query.upstreamHttpStatus,
              usage: query.usage,
              httpStatusSource: 'local-backend',
              pollCount: i + 1,
              pollLimit: maxPoll,
              status: query.status,
              progress: query.progress,
            });
            const queryStatus = String(query.status || '').toLowerCase();
            if (queryStatus === 'materializing') {
              nextPollDelay = Math.max(interval, Math.min(30_000, Number(query.retryAfterMs) || 5_000));
              update({ progress: '100% · 正在下载' });
              setDownloadNotice(query.error || 'Midjourney 已生成，正在保存结果到本机。');
              continue;
            }
            if (query.progress) update({ progress: query.progress });
            if (await finishMidjourneyNz(query, i + 1)) return;
            if (['failed', 'failure', 'error'].includes(queryStatus)) {
              throw new Error(query.error || 'Midjourney 任务失败');
            }
          }
          throw new Error(`Midjourney 轮询超时：${Math.round((maxPoll * interval) / 1000)} 秒`);
        }

        logBus.info(
          `MJ提交: version=${mjVersion} ar=${mjAr} speed=${mjSpeed} ref=${allRefs.length} sref=${mjSrefImages.length} oref=${mjOrefImages.length} prompt="${finalPrompt.slice(0, 60)}${finalPrompt.length > 60 ? '…' : ''}"`,
          src,
        );
        // 主参考图(垫图): 将 URL 转 base64(主项目只接受 base64Array,上游节点输出的 imageUrl 需下载转换)
        const base64Array: string[] = [];
        for (const u of allRefs) {
          try {
            const resp = await fetch(u);
            if (!isCurrentGenerationRun(runId)) return;
            const blob = await resp.blob();
            if (!isCurrentGenerationRun(runId)) return;
            const dataUrl: string = await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result || ''));
              fr.onerror = () => reject(new Error('读取失败'));
              fr.readAsDataURL(blob);
            });
            if (!isCurrentGenerationRun(runId)) return;
            base64Array.push(dataUrl);
          } catch (err: any) {
            logBus.warn(`MJ 主参考图转 base64 失败,跳过: ${u}`, src);
          }
        }
        // sref/oref 允许多张(buildMjPrompt 会为每个 URL 各追加一个 flag)
        const fullPrompt = buildMjPrompt({
          prompt: finalPrompt,
          model: mjVersion,
          ar: mjAr,
          c: mjC || undefined,
          s: mjS || undefined,
          iw: mjIw || undefined,
          sw: mjSw || undefined,
          sv: mjSv || undefined,
          no: mjNo || undefined,
          srefUrls: mjSrefImages,
          orefUrls: mjOrefImages,
        });
        const submit = await submitMjImagine({
          prompt: fullPrompt,
          ar: mjAr,
          c: mjC || undefined,
          s: mjS || undefined,
          iw: mjIw || undefined,
          sw: mjSw || undefined,
          sv: mjSv || undefined,
          no: mjNo || undefined,
          seed: mjSeed || undefined,
          speed: mjSpeed,
          base64Array,
          remix: true,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        const taskId = submit.taskId;
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: taskId,
          requestId: submit.requestId,
          transportHttpStatus: submit.transportHttpStatus,
          upstreamHttpStatus: submit.upstreamHttpStatus,
          usage: submit.usage,
          httpStatusSource: 'local-backend',
        });
        logBus.info(`MJ 任务已提交 taskId=${taskId} fullPrompt="${fullPrompt.slice(0, 120)}${fullPrompt.length > 120 ? '…' : ''}"`, src);
        update({ progress: '15%', taskId });
        const interval = Math.max(1, Math.min(30, mjPollInt || 3)) * 1000;
        const maxPoll = Math.max(
          10,
          minPollCountForTimeout(interval),
          Math.min(3600, mjMaxPoll || 1200),
        );
        for (let i = 0; i < maxPoll; i++) {
          await new Promise((r) => setTimeout(r, interval));
          if (!isCurrentGenerationRun(runId)) return;
          const q = await queryMjTask(taskId, mjSpeed);
          if (!isCurrentGenerationRun(runId)) return;
          await reporter?.polling({
            provider: traceProvider,
            model: traceModel,
            taskId,
            recovery: { kind: 'mj', taskId, model: traceModel, speed: mjSpeed, pollIntervalMs: interval, maxPolls: maxPoll },
            requestId: q.requestId,
            transportHttpStatus: q.transportHttpStatus,
            upstreamHttpStatus: q.upstreamHttpStatus,
            usage: q.usage,
            httpStatusSource: 'local-backend',
            pollCount: i + 1,
            pollLimit: maxPoll,
            status: q.status,
            progress: q.progress,
          });
          if (String(q.status || '').toLowerCase() === 'materializing') {
            update({ progress: '100% · 正在下载' });
            setDownloadNotice(q.error || '图片已经生成，正在通过当前 TUN/代理或直连网络保存到本机。');
            if (i === 0 || (i + 1) % 10 === 0) {
              logBus.warn(
                q.error || 'MJ 图片已生成，正在适配 TUN/代理网络并安全下载，不会重新提交任务',
                src,
              );
            }
            continue;
          }
          if (q.status === 'FAILURE') {
            throw new Error(`MJ 失败: ${q.failReason || '未知错误'}`);
          }
          if (q.progress) {
            const pct = parseInt(String(q.progress)) || 0;
            const out = `${Math.min(99, 15 + Math.floor(pct * 0.85))}%`;
            update({ progress: out });
            if (i % 3 === 2) logBus.debug(`[${i + 1}/${maxPoll}] MJ progress=${q.progress} status=${q.status}`, src);
          }
          if (q.status === 'SUCCESS') {
            const main = q.imageUrl || '';
            const grid = q.imageUrls || [];
            const all = grid.length ? grid : (main ? [main] : []);
            if (!all.length) {
              logBus.warn('MJ 任务完成但未拿到通过安全校验的 imageUrl/imageUrls', src);
              throw new Error('MJ 任务完成但未返回图片');
            }
            const final = main || all[0];
            logBus.success(`MJ 任务完成 → ${final}` + (grid.length ? ` (含 ${grid.length} 张子图)` : ''), src);
            update({
              status: 'success',
              progress: '100%',
              imageUrl: final,
              imageUrls: all,
              lastPrompt: finalPrompt,
              usedI2I: allRefs.length > 0 || mjSrefImages.length > 0 || mjOrefImages.length > 0,
              requestId: q.requestId,
              transportHttpStatus: q.transportHttpStatus,
              upstreamHttpStatus: q.upstreamHttpStatus,
              usage: q.usage,
              pollCount: i + 1,
            });
            taskCompletionSound.notifyComplete(id, 'image');
            await reporter?.providerResponse({
              provider: traceProvider,
              model: traceModel,
              upstreamTaskId: taskId,
              requestId: q.requestId || submit.requestId,
              transportHttpStatus: q.transportHttpStatus,
              upstreamHttpStatus: q.upstreamHttpStatus,
              usage: q.usage,
              pollCount: i + 1,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            return;
          }
        }
        throw new Error(`MJ 轮询超时: ${maxPoll} 次 × ${interval / 1000}s`);
      }

      // ============ FAL 路径(对齐 gpt-image-2-web runGPTFal / runNanoFal) ============
      if (isFal && falDef) {
        const sizeDesc = falKind === 'gpt-fal'
          ? (falSize === 'custom' ? `${falCustomW}×${falCustomH}` : falSize)
          : `${nbAspect}/${nbResolution}`;
        logBus.info(
          `FAL提交: model=${apiModel} kind=${falKind} size=${sizeDesc} 参考图=${allRefs.length} prompt="${finalPrompt.slice(0, 60)}${finalPrompt.length > 60 ? '…' : ''}"`,
          src,
        );
        const submit = await submitImageFal({
          apiModel,
          prompt: finalPrompt,
          images: allRefs,
          n: falKind === 'gpt-fal' ? falN : (d?.falN ?? 1),
          format: falFormat,
          sync: falSync,
          // gpt-fal
          mode: falKind === 'gpt-fal' ? falMode : undefined,
          size: falKind === 'gpt-fal' ? falSize : undefined,
          customW: falKind === 'gpt-fal' && falSize === 'custom' ? falCustomW : undefined,
          customH: falKind === 'gpt-fal' && falSize === 'custom' ? falCustomH : undefined,
          quality: falKind === 'gpt-fal' ? falQuality : undefined,
          // nbpro-fal
          aspect_ratio: falKind === 'nbpro-fal' ? nbAspect : undefined,
          resolution: falKind === 'nbpro-fal' ? nbResolution : undefined,
          safety_tolerance: falKind === 'nbpro-fal' ? nbSafety : undefined,
          seed: falKind === 'nbpro-fal' && nbSeed > 0 ? nbSeed : undefined,
          system_prompt: falKind === 'nbpro-fal' ? nbSysPrompt : undefined,
          enable_web_search: falKind === 'nbpro-fal' ? nbWebSearch : undefined,
          image_mode: falKind === 'nbpro-fal' ? nbImgMode : undefined,
          providerParams,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;

        // 同步完成
        if (submit.sync && submit.urls && submit.urls.length) {
          await reporter?.providerResponse({
            provider: traceProvider,
            model: traceModel,
            requestId: submit.requestId,
            transportHttpStatus: submit.transportHttpStatus,
            upstreamHttpStatus: submit.upstreamHttpStatus,
            usage: submit.usage,
            status: 'succeeded',
            httpStatusSource: 'local-backend',
          });
          logBus.success(`FAL同步返回 → ${submit.urls[0]}`, src);
          update({
            status: 'success',
            progress: '100%',
            imageUrl: submit.urls[0],
            lastPrompt: finalPrompt,
            usedI2I: allRefs.length > 0,
            requestId: submit.requestId,
            transportHttpStatus: submit.transportHttpStatus,
            upstreamHttpStatus: submit.upstreamHttpStatus,
            usage: submit.usage,
          });
          taskCompletionSound.notifyComplete(id, 'image');
          return;
        }

        // 异步轮询: 1200×3s = 3600s，避免 FAL 图像长队列 30min 提前超时。
        const { requestId, endpoint } = submit;
        if (!requestId) throw new Error('FAL 提交后未获得 request_id');
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          requestId,
          transportHttpStatus: submit.transportHttpStatus,
          upstreamHttpStatus: submit.upstreamHttpStatus,
          usage: submit.usage,
          httpStatusSource: 'local-backend',
        });
        logBus.info(`FAL异步任务已提交 requestId=${requestId}`, src);
        update({
          progress: '5%',
          taskId: requestId,
          falEndpoint: endpoint,
        });
        const interval = 3000;
        const maxPoll = minPollCountForTimeout(interval);
        for (let i = 0; i < maxPoll; i++) {
          await new Promise((r) => setTimeout(r, interval));
          if (!isCurrentGenerationRun(runId)) return;
          const q = await queryImageFal({ endpoint, requestId });
          if (!isCurrentGenerationRun(runId)) return;
          const st = String(q.status || '').toLowerCase();
          await reporter?.polling({
            provider: traceProvider,
            model: traceModel,
            requestId,
            recovery: {
              kind: 'image-fal', requestId, endpoint, model: traceModel,
              pollIntervalMs: interval, maxPolls: maxPoll,
            },
            transportHttpStatus: q.transportHttpStatus,
            upstreamHttpStatus: q.upstreamHttpStatus,
            usage: q.usage,
            httpStatusSource: 'local-backend',
            pollCount: i + 1,
            pollLimit: maxPoll,
            status: st,
            providerStatus: q.falStatus,
          });
          if (st === 'materializing') {
            update({ progress: '100% · 正在下载' });
            setDownloadNotice(q.error || '图片已经生成，正在通过当前 TUN/代理或直连网络保存到本机。');
            if (i === 0 || (i + 1) % 10 === 0) {
              logBus.warn(
                q.error || 'FAL 图片已生成，正在适配 TUN/代理网络并安全下载，不会重新提交任务',
                src,
              );
            }
            continue;
          }
          if (st === 'completed') {
            const url = q.urls?.[0];
            if (!url) throw new Error('FAL 任务完成但未返回图片');
            logBus.success(`FAL 任务完成 → ${url}`, src);
            update({
              status: 'success',
              progress: '100%',
              imageUrl: url,
              lastPrompt: finalPrompt,
              usedI2I: allRefs.length > 0,
              requestId: q.requestId || requestId,
              transportHttpStatus: q.transportHttpStatus,
              upstreamHttpStatus: q.upstreamHttpStatus,
              usage: q.usage,
              pollCount: i + 1,
            });
            taskCompletionSound.notifyComplete(id, 'image');
            await reporter?.providerResponse({
              provider: traceProvider,
              model: traceModel,
              requestId: q.requestId || requestId,
              transportHttpStatus: q.transportHttpStatus,
              upstreamHttpStatus: q.upstreamHttpStatus,
              usage: q.usage,
              pollCount: i + 1,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            return;
          }
          if (st === 'failed') {
            throw new Error(q.error || 'FAL 任务失败');
          }
          // 进度估算(15% 起步,到 95% 上限)
          const pct = Math.min(95, 15 + Math.floor((i / maxPoll) * 80));
          if (i % 5 === 4) {
            update({ progress: `${pct}%` });
            logBus.debug(`[${i + 1}/${maxPoll}] FAL 轮询 status=${q.falStatus || 'IN_QUEUE'}`, src);
          }
        }
        throw new Error(`FAL 超时: ${(maxPoll * interval) / 1000}s 未完成`);
      }

      // seedance.nz uses a dedicated asynchronous image protocol for Seedream,
      // Zhenzhen Image G-2 and APIMart image models.
      if (isSeedreamNz || isZhenzhenBudgetImageSelected || isQwenImageTab || isSeedreamLayerTab || isWanImageTab) {
        if (!zhenzhenSd2ApiKey) throw new Error(`请先在 API 设置中填写“${seedanceNzProviderLabel} API Key”`);
        const providerRefs = isSeedreamLayerTab
          ? allRefs.slice(0, 1)
          : isWanImageTab
          ? (isWanImageI2I ? allRefs.slice(0, 9) : [])
          : isQwenImageTab
          ? (isQwenImageI2I ? allRefs.slice(0, 3) : [])
          : isZhenzhenImageG2 && !isZhenzhenImageG2I2I
          ? []
          : isZhenzhenGrokImage
            ? []
            : isZhenzhenGrokImageV2
              ? []
            : isZhenzhenGrokImageV2Edit
              ? allRefs.slice(0, 3)
            : isZhenzhenGrokImageEdit
              ? allRefs.slice(0, 1)
              : allRefs;
        const expectedModel = isSeedreamLayerTab
          ? apiModel
          : isWanImageTab
          ? apiModel
          : isQwenImageTab
          ? apiModel
          : isZhenzhenBudgetImageSelected
          ? apiModel
          : seedreamNzModelFamily === 'overseas'
            ? (providerRefs.length ? 'dola-seedream-5.0-pro-i2i' : 'dola-seedream-5.0-pro-t2i')
            : (providerRefs.length ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro-t2i');
        const imageFamilyLabel = isSeedreamLayerTab
          ? 'Seedream 分层'
          : isWanImageTab
          ? 'Wan Image 2.7 Global'
          : isQwenImageTab
          ? 'Qwen Image 3.0'
          : isZhenzhenImageG2
          ? 'Zhenzhen Image G-2'
          : isZhenzhenNb
            ? 'Zhenzhen Image Nano Banana'
          : isZhenzhenApimartImage
            ? 'APIMart Image'
            : 'Seedream';
        const sizeLabel = isSeedreamLayerTab
          ? `${seedreamLayerResolution} · ${seedreamOutputFormat} · 全部图层`
          : isWanImageTab
          ? isWanImageI2I
            ? `图像编辑 · ${providerRefs.length} 张参考图`
            : `${wanImageWidth}x${wanImageHeight} · 思考模式${wanImageThinkingMode ? '开' : '关'}`
          : isQwenImageTab
          ? qwenSizingMode === 'auto'
            ? `自动推荐 · n=${qwenImageCount}`
            : qwenSizingMode === 'ratio'
              ? `${qwenResolution} · ${effectiveAspectRatio} · n=${qwenImageCount}`
              : `${qwenCustomSize} · n=${qwenImageCount}`
          : isZhenzhenImageG2
          ? '1k'
          : isZhenzhenLowpriceImage
            ? `${effectiveSizeLevel.toLowerCase()} · ${effectiveAspectRatio}`
            : isZhenzhenNb
              ? `${effectiveSizeLevel.toLowerCase()} · ${effectiveAspectRatio} · n=${zhenzhenNbImageCount}`
            : isZhenzhenGrokImageV2Edit
              ? `${grokV2EditResolution} · ${effectiveAspectRatio} · n=${grokV2ImageCount}`
            : (isZhenzhenGrokImageV2 || isZhenzhenGrokImage || isZhenzhenGrokImageEdit)
              ? effectiveAspectRatio
          : (seedreamNzResolution === 'custom' ? seedreamNzResolvedSize : seedreamNzResolution);
        logBus.info(
          `${seedanceNzProviderLabel} ${imageFamilyLabel} 提交: model=${expectedModel} 参考图=${providerRefs.length} 尺寸=${sizeLabel}`,
          src,
        );
        const submit = await submitSeedreamNz({
          prompt: finalPrompt,
          images: providerRefs,
          model: isSeedreamLayerTab
            ? apiModel as
              | 'seedream-v5-pro-layer-decomposition'
              | 'dola-seedream-5.0-pro-layer-decomposition'
            : isWanImageTab
            ? apiModel as
              | 'wan-2.7-global-t2i'
              | 'wan-2.7-global-i2i'
              | 'wan-2.7-global-i2i-pro'
            : isQwenImageTab
            ? apiModel as
              | 'qwen-image-3.0-t2i'
              | 'qwen-image-3.0-i2i'
              | 'qwen-image-3.0-pro-t2i'
              | 'qwen-image-3.0-pro-i2i'
              | 'qwen-image-3.0-global-t2i'
              | 'qwen-image-3.0-global-i2i'
              | 'qwen-image-3.0-global-pro-t2i'
              | 'qwen-image-3.0-global-pro-i2i'
            : isZhenzhenBudgetImageSelected
            ? apiModel as
              | 'zhenzhen-image-g2-t2i'
              | 'zhenzhen-image-g2-i2i'
              | 'zhenzhen-image-g-v2-lowprice'
              | 'zhenzhen-image-gk-v2'
              | 'zhenzhen-image-gk-v2-edit'
              | 'zhenzhen-image-gk-v15'
              | 'zhenzhen-image-gk-v15-edit'
              | 'zhenzhen-image-nb-2-lite'
              | 'zhenzhen-image-nb-2'
              | 'zhenzhen-image-nb-pro'
            : undefined,
          modelFamily: isZhenzhenBudgetImageSelected || isQwenImageTab || isSeedreamLayerTab || isWanImageTab ? undefined : seedreamNzModelFamily,
          resolution: isZhenzhenGrokImageV2Edit
            ? grokV2EditResolution
            : isSeedreamLayerTab
            ? seedreamLayerResolution
            : isQwenImageTab
            ? qwenSizingMode === 'ratio' ? qwenResolution : undefined
            : isZhenzhenImageG2
            ? '1k'
            : isZhenzhenLowpriceImage
              ? effectiveSizeLevel.toLowerCase() as '1k' | '2k' | '4k'
              : isZhenzhenNb
                ? effectiveSizeLevel.toLowerCase() as '0.5k' | '1k' | '2k' | '4k'
            : (seedreamNzResolution === 'custom' ? undefined : seedreamNzResolution),
          ratio: isZhenzhenGrokImageV2Edit
            ? effectiveAspectRatio as any
            : isQwenImageTab
            ? qwenSizingMode === 'ratio' ? effectiveAspectRatio as
              | '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'
              : undefined
            : isZhenzhenImageG2
            ? effectiveAspectRatio as 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9'
            : undefined,
          size: isQwenImageTab
            ? qwenSizingMode === 'custom_size' ? qwenCustomSize : undefined
            : isZhenzhenApimartImage
            ? effectiveAspectRatio
            : !isZhenzhenImageG2 && seedreamNzResolution === 'custom' ? seedreamNzResolvedSize : undefined,
          n: isQwenImageTab
            ? qwenImageCount
            : isZhenzhenGrokImageV2 || isZhenzhenGrokImageV2Edit
              ? grokV2ImageCount
              : isZhenzhenNb ? zhenzhenNbImageCount : isZhenzhenApimartImage ? 1 : undefined,
          output_format: isSeedreamLayerTab
            ? seedreamOutputFormat
            : isZhenzhenBudgetImageSelected || isQwenImageTab ? undefined : seedreamOutputFormat,
          negative_prompt: isQwenImageTab ? qwenNegativePrompt.trim() || undefined : undefined,
          prompt_extend: isQwenImageTab ? qwenPromptExtend : undefined,
          sizing_mode: isQwenImageTab ? qwenSizingMode : undefined,
          seed: isQwenImageTab ? qwenSeed : undefined,
          width: isWanImageTab && !isWanImageI2I ? wanImageWidth : undefined,
          height: isWanImageTab && !isWanImageI2I ? wanImageHeight : undefined,
          thinking_mode: isWanImageTab && !isWanImageI2I ? wanImageThinkingMode : undefined,
          aspect_ratio: isZhenzhenGrokImageV2Edit ? effectiveAspectRatio : undefined,
          nsfw_check: isZhenzhenGrokImageV2Edit ? grokV2EditNsfwCheck : undefined,
        }, { submissionKey: reporter?.providerSubmissionKey });
        if (!isCurrentGenerationRun(runId)) return;
        const taskId = submit.taskId;
        if (!taskId) throw new Error(`${seedanceNzProviderLabel}${imageFamilyLabel} 未返回任务 ID`);
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: taskId,
          requestId: submit.requestId,
          transportHttpStatus: submit.transportHttpStatus,
          upstreamHttpStatus: submit.upstreamHttpStatus,
          usage: submit.usage,
          httpStatusSource: 'local-backend',
        });
        update({ progress: submit.progress || '0%', taskId });
        const interval = 3000;
        const maxPoll = minPollCountForTimeout(interval);
        let lastProgress = submit.progress || '0%';
        for (let i = 0; i < maxPoll; i++) {
          await new Promise((resolve) => setTimeout(resolve, interval));
          if (!isCurrentGenerationRun(runId)) return;
          const query = await querySeedreamNz(taskId);
          if (!isCurrentGenerationRun(runId)) return;
          await reporter?.polling({
            provider: traceProvider,
            model: traceModel,
            taskId,
            requestId: query.requestId,
            transportHttpStatus: query.transportHttpStatus,
            upstreamHttpStatus: query.upstreamHttpStatus,
            usage: query.usage,
            httpStatusSource: 'local-backend',
            pollCount: i + 1,
            pollLimit: maxPoll,
            status: query.status,
            progress: query.progress,
          });
          if (query.progress && query.progress !== lastProgress) {
            lastProgress = query.progress;
            update({ progress: query.progress });
          }
          const queryStatus = String(query.status || '').toLowerCase();
          if (queryStatus === 'materializing') {
            update({ progress: '100% · 正在下载' });
            setDownloadNotice(query.error || '图片已经生成，正在通过当前 TUN/代理或直连网络保存到本机。');
            if (i === 0 || (i + 1) % 10 === 0) {
              logBus.warn(
                query.error || `${seedanceNzProviderLabel}${imageFamilyLabel} 已生成，正在适配 TUN/代理网络并安全下载`,
                src,
              );
            }
            continue;
          }
          if (queryStatus === 'completed' || queryStatus === 'success' || queryStatus === 'done') {
            const url = query.urls?.[0];
            if (!url) throw new Error(`${seedanceNzProviderLabel}${imageFamilyLabel} 任务完成但未返回图片`);
            logBus.success(`${seedanceNzProviderLabel}${imageFamilyLabel} 完成 → ${url}`, src);
            update({
              status: 'success',
              progress: '100%',
              imageUrl: url,
              imageUrls: query.urls,
              lastPrompt: finalPrompt,
              usedI2I: isSeedreamLayerTab
                ? true
                : isWanImageTab ? isWanImageI2I
                : isQwenImageTab ? isQwenImageI2I : isZhenzhenImageG2 ? isZhenzhenImageG2I2I : providerRefs.length > 0,
              requestId: query.requestId,
              transportHttpStatus: query.transportHttpStatus,
              upstreamHttpStatus: query.upstreamHttpStatus,
              usage: query.usage,
              pollCount: i + 1,
            });
            taskCompletionSound.notifyComplete(id, 'image');
            await reporter?.providerResponse({
              provider: traceProvider,
              model: traceModel,
              upstreamTaskId: taskId,
              requestId: query.requestId || submit.requestId,
              transportHttpStatus: query.transportHttpStatus,
              upstreamHttpStatus: query.upstreamHttpStatus,
              usage: query.usage,
              pollCount: i + 1,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            return;
          }
          if (queryStatus === 'failed' || queryStatus === 'failure' || queryStatus === 'error') {
            throw new Error(query.error || `${seedanceNzProviderLabel}${imageFamilyLabel} 任务失败`);
          }
        }
        throw new Error(`${seedanceNzProviderLabel}${imageFamilyLabel} 超时: ${(maxPoll * interval) / 1000}s 未完成`);
      }

      // ============ 原有标准路径(GPT2 standard / nano-banana / nano-banana-pro 未动) ============
      logBus.info(
        `提交任务: model=${apiModel} 比例=${effectiveAspectRatio} 尺寸=${effectiveSizeLevel} 参考图=${allRefs.length} prompt="${finalPrompt.slice(0, 60)}${finalPrompt.length > 60 ? '…' : ''}"`,
        src,
      );
      const submit = await submitImageAsync({
        model: modelDef.id,
        apiModel: apiModel,
        paramKind: modelDef.paramKind,
        prompt: finalPrompt,
        aspect_ratio: isSeedream ? undefined : effectiveAspectRatio,
        image_size: isSeedream ? undefined : effectiveSizeLevel,
        size: isSeedream ? seedreamResolvedSize : undefined,
        response_format: isSeedream ? 'url' : undefined,
        output_format: isSeedream ? seedreamOutputFormat : undefined,
        images: allRefs,
        n: 1,
        quality: isStandardGptImage2 ? gptImageQuality : undefined,
        moderation: isStandardGptImage2 ? gptImageModeration : undefined,
        providerParams,
      }, { submissionKey: reporter?.providerSubmissionKey });
      if (!isCurrentGenerationRun(runId)) return;

      // 分支一:同步完成
      if (submit.sync && submit.urls && submit.urls.length) {
        logBus.success(`同步返回 → ${submit.urls[0]}`, src);
        update({
          status: 'success',
          progress: '100%',
          imageUrl: submit.urls[0],
          imageUrls: submit.urls,
          lastPrompt: finalPrompt,
          usedI2I: allRefs.length > 0,
          requestId: submit.requestId,
          transportHttpStatus: submit.transportHttpStatus,
          upstreamHttpStatus: submit.upstreamHttpStatus,
          usage: submit.usage,
        });
        taskCompletionSound.notifyComplete(id, 'image');
        await reporter?.providerResponse({
          provider: traceProvider,
          model: traceModel,
          requestId: submit.requestId,
          transportHttpStatus: submit.transportHttpStatus,
          upstreamHttpStatus: submit.upstreamHttpStatus,
          usage: submit.usage,
          status: 'succeeded',
          httpStatusSource: 'local-backend',
        });
        return;
      }

      // 分支二:异步任务 → 轮询状态(对齐主项目 gpt-image-2-web pollTask)
      const taskId = submit.taskId;
      if (!taskId) throw new Error('未获取到 taskId 且无同步结果');
      await reporter?.providerSubmitted({
        provider: traceProvider,
        model: traceModel,
        upstreamTaskId: taskId,
        requestId: submit.requestId,
        transportHttpStatus: submit.transportHttpStatus,
        upstreamHttpStatus: submit.upstreamHttpStatus,
        usage: submit.usage,
        httpStatusSource: 'local-backend',
      });
      logBus.info(`异步任务已提交 taskId=${taskId} 进入轮询…`, src);
      update({ progress: submit.progress || '5%', taskId });
      // GPT2 / nano-banana / nano-banana-pro 标准路径轮询上限:
      //   maxPoll × interval = 1800 × 2s = 3600s = 60 分钟(避免复杂 prompt / 多参考图任务被 120s 提前中断)
      const maxPoll = 1800;     // 最多 1800 次
      const interval = 2000;    // 每 2 秒一次
      let lastProg = '5%';
      let nextPollDelay = interval;
      for (let i = 0; i < maxPoll; i++) {
        await new Promise((r) => setTimeout(r, nextPollDelay));
        nextPollDelay = interval;
        if (!isCurrentGenerationRun(runId)) return;
        const q = await queryImageStatus(taskId, apiModel);
        if (!isCurrentGenerationRun(runId)) return;
        await reporter?.polling({
          provider: traceProvider,
          model: traceModel,
          taskId,
          recovery: { kind: 'image', taskId, model: apiModel || traceModel, pollIntervalMs: interval, maxPolls: maxPoll },
          requestId: q.requestId,
          transportHttpStatus: q.transportHttpStatus,
          upstreamHttpStatus: q.upstreamHttpStatus,
          usage: q.usage,
          httpStatusSource: 'local-backend',
          pollCount: i + 1,
          pollLimit: maxPoll,
          status: q.status,
          progress: q.progress,
        });
        if (q.progress && q.progress !== lastProg) {
          lastProg = q.progress;
          update({ progress: q.progress });
          logBus.debug(`[${i + 1}/${maxPoll}] status=${q.status} progress=${q.progress}`, src);
        }
        const st = String(q.status || '').toLowerCase();
        if (st === 'materializing') {
          nextPollDelay = Math.max(interval, Math.min(30_000, Number(q.retryAfterMs) || 5_000));
          update({ progress: '100% · 正在下载' });
          setDownloadNotice(q.error || '图片已经生成，正在通过当前 TUN/代理或直连网络保存到本机。');
          if (i === 0 || (i + 1) % 10 === 0) {
            logBus.warn(
              q.error || '图片已生成，正在适配 TUN/代理网络并安全下载，不会重新提交任务',
              src,
            );
          }
          continue;
        }
        if (st === 'completed' || st === 'success' || st === 'done') {
          const url = q.urls?.[0];
          if (!url) throw new Error(q.error || '任务已完成，但本机没有拿到图片；请查看 Logs 中的下载失败原因');
          logBus.success(`任务完成 → ${url}`, src);
          update({
            status: 'success',
            progress: '100%',
            imageUrl: url,
            imageUrls: q.urls,
            lastPrompt: finalPrompt,
            usedI2I: allRefs.length > 0,
            requestId: q.requestId,
            transportHttpStatus: q.transportHttpStatus,
            upstreamHttpStatus: q.upstreamHttpStatus,
            usage: q.usage,
            pollCount: i + 1,
          });
          taskCompletionSound.notifyComplete(id, 'image');
          await reporter?.providerResponse({
            provider: traceProvider,
            model: traceModel,
            upstreamTaskId: taskId,
            requestId: q.requestId || submit.requestId,
            transportHttpStatus: q.transportHttpStatus,
            upstreamHttpStatus: q.upstreamHttpStatus,
            usage: q.usage,
            pollCount: i + 1,
            status: 'succeeded',
            httpStatusSource: 'local-backend',
          });
          return;
        }
        if (st === 'failed' || st === 'failure' || st === 'error') {
          throw new Error(q.error || '任务失败');
        }
      }
      throw new Error(`超时:${maxPoll * interval / 1000}s 未完成`);
    } catch (e: any) {
      if (!isCurrentGenerationRun(runId)) return;
      const msg = e?.message || '生成失败';
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
      logBus.error(`生成失败: ${msg}`, src);
      update({ status: 'error', error: msg });
    }
  };

  const handleStop = () => {
    generationRunRef.current += 1;
    setError(null);
    update({ status: 'idle', progress: '已停止', error: null, taskId: null });
    logBus.warn('用户主动停止：已停止本地轮询，远端任务可能仍会完成', `image:${id.slice(0, 6)}`);
  };

  // 接入运行总线,供批量运行调起
  useRunTrigger(id, handleGenerate, 'image', {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => shouldReuseGenerationResult('image', nodeData),
  });

  // === 跨节点拖拽: source (从输出图 Ctrl+拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (接收图像 → 追加到 referenceImages; 接收文本 → 替换 prompt) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = Array.isArray(d?.referenceImages) ? d.referenceImages : [];
      if (cur.indexOf(payload.url) !== -1) return;
      if (cur.length >= maxRefs) return;
      update({ referenceImages: [...cur, payload.url] });
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'text'],
    onDrop: handleDrop,
  });

  if (canvasRenderMode === 'cold') {
    return (
      <div className="t8-node-cold-shell w-[320px]" data-t8-node-cold-shell="image" style={{ minHeight: 112 }}>
        <Handle type="target" position={Position.Left} className="!border-0 !bg-amber-400" />
        <Handle type="source" position={Position.Right} className="!border-0 !bg-amber-400" />
        <div className="t8-node-cold-shell__header">
          <ImageIcon size={16} className="shrink-0 text-amber-300" />
          <div className="t8-node-cold-shell__copy">
            <strong>{translate('nodes:image.title')}</strong>
            <small>{apiModel || modelDef.label || 'Image'} · {translate('common:performance.offscreenPreview')}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl border-2 transition-all w-[320px] ${
        selected ? 'border-amber-400 shadow-2xl shadow-amber-500/20' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        ...(isAccepting ? { borderColor: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,0.25)' } : null),
      }}
      {...dropProps}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-amber-400 !border-0" />

      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(245,158,11,.2)', color: '#fcd34d', boxShadow: 'inset 0 0 0 1px rgba(245,158,11,.45)' }}
        >
          <ImageIcon size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{translate('nodes:image.title')}</div>
          <div className="text-[10px] text-white/40">
            {isExternalSelected && providerSelection.provider
              ? `${providerSelection.provider.label || providerSelection.provider.id} · ${externalProviderModel || translate('nodes:generation.unselectedModel')}`
              : isZhenzhenBudgetPlatformSelected
                ? `${translate('nodes:generation.budgetHouse')} · ${isZhenzhenBudgetMjSelected ? mjNzOperation : apiModel}`
              : isSeedreamNz
                ? `${translate('nodes:generation.budgetHouse')} · ${seedreamNzUiModel}`
                : `${modelDef.label} · ${modelDef.description}`}
          </div>
        </div>
        {isJimengCliImageSelected && <JimengCliHelpButton />}
      </div>

      {/* 配置区 */}
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
                  : isZhenzhenBudgetPlatformSelected
                    ? translate('nodes:generation.budgetHouse')
                    : translate('nodes:generation.defaultWorkshop')}
              </span>
            </button>
            {d?.advancedProviderOpen && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.platform')}</label>
                  <select
                    value={isExternalSelected
                      ? providerSelection.providerId
                      : isZhenzhenBudgetPlatformSelected
                        ? 'builtin:seedance-nz'
                        : 'zhenzhen'}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (nextId === 'zhenzhen') {
                        const leavingBudgetPlatform = d?.imageBuiltinSource === 'seedance-nz'
                          || isZhenzhenBudgetImageModel(savedApiModel)
                          || isQwenImageTab
                          || isSeedreamLayerTab
                          || isWanImageTab;
                        const leavingDedicatedBudgetTab = isQwenImageTab || isSeedreamLayerTab || isWanImageTab;
                        const fallbackModel = IMAGE_MODELS[0];
                        update({
                          providerSource: 'zhenzhen',
                          providerId: '',
                          providerModel: '',
                          imageBuiltinSource: 'zhenzhen',
                          ...(leavingBudgetPlatform
                            ? {
                                model: leavingDedicatedBudgetTab ? fallbackModel.id : modelDef.id,
                                apiModel: leavingDedicatedBudgetTab ? fallbackModel.apiModel : modelDef.apiModel,
                                aspectRatio: leavingDedicatedBudgetTab ? fallbackModel.defaultAspectRatio : modelDef.defaultAspectRatio,
                                sizeLevel: leavingDedicatedBudgetTab ? fallbackModel.defaultSize : modelDef.defaultSize,
                              }
                            : {}),
                          ...clearModelscopeLoraParams(),
                        });
                        return;
                      }
                      if (nextId === 'builtin:seedance-nz') {
                        update({
                          providerSource: 'zhenzhen',
                          providerId: '',
                          providerModel: '',
                          imageBuiltinSource: 'seedance-nz',
                          model: 'gpt-image-2',
                          apiModel: ZHENZHEN_IMAGE_G2_T2I_MODEL,
                          aspectRatio: 'adaptive',
                          sizeLevel: '1K',
                          ...clearModelscopeLoraParams(),
                        });
                        return;
                      }
                      const provider = imageAdvancedProviders.find((item) => item.id === nextId);
                      if (!provider) return;
                      const nextModels = advancedProviderModelOptions(provider, 'image');
                      update({
                        providerSource: provider.protocol,
                        providerId: provider.id,
                        providerModel: nextModels[0] || '',
                        ...clearModelscopeLoraParams(),
                      });
                    }}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  >
                    <option value="zhenzhen" style={{ background: '#18181b', color: '#ffffff' }}>{translate('nodes:generation.workshopDefault')}</option>
                    <option value="builtin:seedance-nz" style={{ background: '#18181b', color: '#ffffff' }}>{translate('nodes:generation.budgetHouse')}</option>
                    {imageAdvancedProviders.map((provider) => (
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
                        const currentResolution = String(providerParams.resolutionType || '').toLowerCase();
                        const nextResolutions = providerSelection.provider?.protocol === 'jimeng-cli'
                          ? jimengImageResolutionOptions(nextModel)
                          : [];
                        const nextIsSeedream5Pro = /seedream[-_\s]?5\.0[-_\s]?pro/i.test(nextModel);
                        const mustResetResolution = nextResolutions.length > 0
                          && currentResolution !== ''
                          && !nextResolutions.includes(currentResolution);
                        update({
                          providerModel: nextModel,
                          ...(mustResetResolution
                            ? { providerParams: { ...providerParams, resolutionType: nextIsSeedream5Pro ? '1.5k' : '2k' } }
                            : {}),
                          ...clearModelscopeLoraParams(),
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
                {isJimengCliImageSelected && (
                  <div className="space-y-2 rounded border border-lime-300/15 bg-lime-400/[0.05] p-2">
                    <label className="block space-y-1">
                      <span className="text-[10px] text-white/50">{translate('nodes:generation.generationCount')}</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={String(providerParams.n ?? 1)}
                        onChange={(e) => patchProviderParams({ n: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                        style={{ background: '#18181b', color: '#ffffff' }}
                        className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-white/65">
                      <input
                        type="checkbox"
                        checked={jimengCliCustomSizeEnabled}
                        onChange={(e) => patchProviderParams({
                          customSizeEnabled: e.target.checked,
                          ...(!e.target.checked ? { width: undefined, height: undefined, resolutionType: undefined } : {}),
                        })}
                        className="accent-lime-400"
                      />
                      自定义宽高（v{JIMENG_CLI_SUPPORTED_VERSION}）
                    </label>
                    {jimengCliCustomSizeEnabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] text-white/45">{translate('nodes:generation.width')}</span>
                          <input
                            type="number"
                            min={512}
                            max={6240}
                            step={8}
                            value={jimengCliWidth}
                            onChange={(e) => patchProviderParams({ width: Math.round(Number(e.target.value) || 0) })}
                            style={{ background: '#18181b', color: '#ffffff' }}
                            className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] text-white/45">{translate('nodes:generation.height')}</span>
                          <input
                            type="number"
                            min={512}
                            max={6240}
                            step={8}
                            value={jimengCliHeight}
                            onChange={(e) => patchProviderParams({ height: Math.round(Number(e.target.value) || 0) })}
                            style={{ background: '#18181b', color: '#ffffff' }}
                            className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                          />
                        </label>
                        <label className="col-span-2 space-y-1">
                          <span className="text-[10px] text-white/45">{translate('nodes:generation.resolutionLevel')}</span>
                          <select
                            value={jimengImageResolutions.includes(jimengImageResolution) ? jimengImageResolution : (isJimengCliSeedream5Pro ? '1.5k' : '2k')}
                            onChange={(e) => patchProviderParams({ resolutionType: e.target.value })}
                            style={{ background: '#18181b', color: '#ffffff' }}
                            className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                          >
                            {jimengImageResolutions.map((item) => (
                              <option key={item} value={item} style={{ background: '#18181b', color: '#ffffff' }}>{item.toUpperCase()}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    <span className="block text-[10px] leading-relaxed text-white/40">
                      当前按即梦 CLI v{JIMENG_CLI_SUPPORTED_VERSION} 提交；图生图支持 1-10 张参考图，自定义宽高会成对传入并自动停用 ratio。Seedream 3.0/3.1 支持 1K/2K；5.0 Pro 支持 1.5K/2K/4K，不再发送已移除的 1K。
                    </span>
                  </div>
                )}
                {isModelScopeExternal && (
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[10px] font-semibold text-white/70">
                        <input
                          type="checkbox"
                          checked={modelscopeLoraEnabled}
                          disabled={!modelscopeLoras.length}
                          onChange={(e) => {
                            const nextEnabled = e.target.checked;
                            if (!nextEnabled) {
                              applyModelscopeLoraSelection([], false);
                              return;
                            }
                            const next = selectedModelscopeLoras[0] || modelscopeLoras[0];
                            applyModelscopeLoraSelection(next ? [{
                              id: next.id,
                              strength: normalizeModelscopeLoraStrength(next.strength, 0.8),
                            }] : []);
                          }}
                        />
                        <span>LoRA</span>
                      </label>
                      <span className="text-[10px] text-white/40">
                        {modelscopeLoras.length
                          ? `${selectedModelscopeLoras.length}/${Math.min(MAX_MODELSCOPE_NODE_LORAS, modelscopeLoras.length)} 已选 · 权重 ${selectedModelscopeLoraTotal.toFixed(2)}/1.00`
                          : '当前模型无绑定'}
                      </span>
                    </div>
                    {modelscopeLoras.length > 0 && modelscopeLoraEnabled && (
                      <div className="space-y-2">
                        <div className="rounded border border-amber-300/20 bg-amber-400/[0.06] p-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="font-semibold text-amber-100">官方总权重</span>
                            <span className={selectedModelscopeLoraTotal >= MODELSCOPE_LORA_TOTAL_WEIGHT - 0.0001 ? 'text-amber-100' : 'text-white/65'}>
                              {selectedModelscopeLoraTotal.toFixed(2)} / 1.00
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
                            <div
                              className="h-full rounded-full bg-amber-300 transition-all"
                              style={{ width: `${Math.min(100, selectedModelscopeLoraTotal * 100)}%` }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-white/45">
                            <span>
                              {selectedModelscopeLoras.length > 1
                                ? selectedModelscopeLoraRemaining > 0.0001
                                  ? `多个 LoRA 权重总和必须为 1.00；还可分配 ${selectedModelscopeLoraRemaining.toFixed(2)}。`
                                  : '多个 LoRA 权重总和已到 1.00；要添加或提高某项，请先降低其他 LoRA。'
                                : '单个 LoRA 可直接提交；多个 LoRA 时官方要求总和为 1.00。'}
                            </span>
                            <button
                              type="button"
                              onClick={distributeSelectedModelscopeLoraWeights}
                              disabled={selectedModelscopeLoras.length < 2}
                              className="rounded border border-white/15 px-2 py-0.5 font-semibold text-white/65 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white"
                              title="把当前选择的 LoRA 权重平均分配到总和 1.00"
                            >
                              均分到 1.00
                            </button>
                          </div>
                        </div>
                        {selectedModelscopeLoras.map((selectedLora, index) => {
                          const currentOption = modelscopeLoras.find((lora) => lora.id === selectedLora.id) || modelscopeLoras[0];
                          const rowOptions = modelscopeLoras.filter((lora) => (
                            lora.id === selectedLora.id || !selectedModelscopeLoraIds.has(lora.id)
                          ));
                          const rowOtherTotal = modelscopeLoraWeightTotal(selectedModelscopeLoras.filter((_, i) => i !== index));
                          const rowMax = Math.max(0, Number((MODELSCOPE_LORA_TOTAL_WEIGHT - rowOtherTotal).toFixed(4)));
                          const strength = normalizeModelscopeLoraStrength(selectedLora.strength, currentOption?.strength ?? 0.8);
                          return (
                            <div key={`${selectedLora.id}-${index}`} className="rounded border border-white/10 bg-black/10 p-2 space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={selectedLora.id}
                                  onChange={(e) => {
                                    const next = modelscopeLoras.find((lora) => lora.id === e.target.value) || currentOption;
                                    updateModelscopeLoraSelection(index, {
                                      id: next?.id || '',
                                      strength: next?.strength ?? 0.8,
                                    });
                                  }}
                                  style={{ background: '#18181b', color: '#ffffff' }}
                                  className="min-w-0 flex-1 rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                                >
                                  {rowOptions.map((lora) => (
                                    <option key={lora.id} value={lora.id} style={{ background: '#18181b', color: '#ffffff' }}>
                                      {lora.name || lora.id}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => removeModelscopeLoraSelection(index)}
                                  className="h-7 w-7 shrink-0 rounded border border-white/15 inline-flex items-center justify-center text-white/60 hover:text-white"
                                  title="移除这组 LoRA"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                              <label className="block space-y-1">
                                <div className="flex items-center justify-between text-[10px] text-white/50">
                                  <span title="ModelScope 多 LoRA 官方权重总和必须为 1.00；本行最大值会随其他 LoRA 权重自动变化。">官方权重</span>
                                  <span>{strength.toFixed(2)} · 最多 {rowMax.toFixed(2)}</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={rowMax}
                                  step={0.01}
                                  value={strength}
                                  onChange={(e) => updateModelscopeLoraSelection(index, { strength: Number(e.target.value) })}
                                  className="w-full accent-amber-400"
                                />
                              </label>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={addModelscopeLoraSelection}
                          disabled={
                            selectedModelscopeLoras.length >= MAX_MODELSCOPE_NODE_LORAS ||
                            !unselectedModelscopeLoras.length ||
                            (selectedModelscopeLoras.length > 0 && selectedModelscopeLoraRemaining <= 0.0001)
                          }
                          className="w-full rounded border border-white/15 px-2 py-1 text-[11px] font-semibold text-white/70 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white"
                          title={selectedModelscopeLoraRemaining <= 0.0001 ? '总权重已满，请先降低其他 LoRA 权重' : '添加一组 LoRA'}
                        >
                          <Plus size={12} className="inline mr-1" />
                          {selectedModelscopeLoraRemaining <= 0.0001 && selectedModelscopeLoras.length > 0
                            ? '总权重已满'
                            : `添加 LoRA（最多 ${MAX_MODELSCOPE_NODE_LORAS} 个）`}
                        </button>
                      </div>
                    )}
                    {!modelscopeLoras.length && (
                      <div className="text-[10px] leading-relaxed text-white/45">
                        到 API 设置的 ModelScope LoRA 区，为当前外部模型绑定 LoRA 后即可在这里选择。
                      </div>
                    )}
                  </div>
                )}
                {isComfyExternal && (
                  <div className="rounded border border-cyan-300/25 bg-cyan-400/[0.06] p-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-semibold text-white/80">ComfyUI 工作流参数</div>
                      <span className="text-[10px] text-cyan-200/80">{comfyParamFields.length} 项</span>
                    </div>
                    <div className="text-[10px] leading-relaxed text-white/45">
                      {[
                        comfyHasPromptField ? 'Prompt 会按此处字段注入到 workflow' : '此工作流未声明 Prompt 字段',
                        comfyRequiredImageCount > 0
                          ? `需要 ${comfyRequiredImageCount} 张图片；当前 ${orderedImages.length} 张`
                          : '未声明图片输入',
                      ].join('；')}
                    </div>
                    {comfyRequiredImageCount > orderedImages.length && (
                      <div className="text-[10px] text-amber-200">
                        请连接上传素材或在 ComfyUI 输入素材区添加图片，否则对应 LoadImage 字段会缺失。
                      </div>
                    )}
                    {comfyParamFields.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {comfyParamFields.map((field: any) => {
                          const source = comfyFieldSource(field);
                          const label = COMFY_APP_SOURCE_LABELS[source] || source;
                          const target = field?.nodeId && field?.fieldName ? `#${field.nodeId}.${field.fieldName}` : '';
                          const value = providerParams[source] ?? comfyFieldDefault(field);
                          const selectOptions = Array.isArray(field?.options) ? field.options : [];
                          const isNumber = COMFY_NUMERIC_FIELD_SOURCES.has(source);
                          if (source === 'prompt' || source === 'positive') {
                            const promptValue = localPrompt || String(providerParams[source] ?? providerParams.prompt ?? '');
                            return (
                              <label key={`${field.nodeId}-${field.fieldName}-${source}`} className="space-y-1 col-span-2">
                                <span className="flex items-center justify-between gap-2 text-[10px] text-white/55">
                                  <span>{label}</span>
                                  {target && <span className="text-cyan-100/80">{target}</span>}
                                </span>
                                <MentionPromptInput
                                  title="ComfyUI 正向 Prompt"
                                  value={promptValue}
                                  mentions={promptMentions}
                                  materials={mentionMaterials}
                                  onChange={(nextValue, mentions) => {
                                    const nextParams = {
                                      ...providerParams,
                                      [source]: nextValue,
                                      prompt: nextValue,
                                    };
                                    update({ prompt: nextValue, promptMentions: mentions, providerParams: nextParams });
                                  }}
                                  placeholder={String(comfyFieldDefault(field) || '填写 ComfyUI 正向 Prompt')}
                                  isDark={isDark}
                                  isPixel={isPixel}
                                  promptTemplateKind="image"
                                  imagePromptAdjustments={imagePromptAdjustments}
                                  onImagePromptAdjustmentsChange={updateImagePromptAdjustments}
                                  imagePromptAdjustmentHasReferenceImages={orderedImages.length > 0}
                                  className="w-full min-h-[68px] resize-y rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-cyan-300/60 placeholder:text-white/30"
                                />
                                {orderedTexts.length > 0 && (
                                  <span className="block text-[10px] text-amber-200/80">
                                    已连接 {orderedTexts.length} 条上游文本，运行时会优先使用上游文本。
                                  </span>
                                )}
                              </label>
                            );
                          }
                          if (source === 'negative') {
                            const negativeValue = String(providerParams.negative ?? providerParams.negativePrompt ?? '');
                            return (
                              <label key={`${field.nodeId}-${field.fieldName}-${source}`} className="space-y-1 col-span-2">
                                <span className="flex items-center justify-between gap-2 text-[10px] text-white/55">
                                  <span>{label}</span>
                                  {target && <span className="text-cyan-100/80">{target}</span>}
                                </span>
                                <PromptTextarea
                                  title="ComfyUI 负向 Prompt"
                                  value={negativeValue}
                                  onValueChange={(value) => patchProviderParams({ negative: value, negativePrompt: value })}
                                  placeholder={String(comfyFieldDefault(field) || '填写 ComfyUI 负向 Prompt')}
                                  rows={3}
                                  promptTemplateKind="image"
                                  style={{ background: '#18181b', color: '#ffffff' }}
                                  className="w-full rounded border border-white/10 px-2 py-1 text-[11px] outline-none focus:border-cyan-300/60 placeholder:text-white/30"
                                />
                              </label>
                            );
                          }
                          const imageSlot = comfyImageSourceIndex(source);
                          if (imageSlot > 0) {
                            const imageMaterial = orderedImages[imageSlot - 1];
                            return (
                              <div key={`${field.nodeId}-${field.fieldName}-${source}`} className="col-span-2 rounded border border-white/10 bg-black/10 p-2">
                                <div className="flex items-center justify-between gap-2 text-[10px] text-white/55">
                                  <span>{label}</span>
                                  {target && <span className="text-cyan-100/80">{target}</span>}
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/60">
                                  <span>{imageMaterial ? `使用第 ${imageSlot} 张图片：${imageMaterial.label || imageMaterial.url}` : `等待第 ${imageSlot} 张图片`}</span>
                                  <button
                                    type="button"
                                    onClick={handlePickFile}
                                    className="nodrag rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 hover:bg-cyan-300/10"
                                  >
                                    添加图片
                                  </button>
                                </div>
                              </div>
                            );
                          }
                            if (/^(video|audio)(?:_|-)?\d+$/i.test(source)) {
                            return (
                              <div key={`${field.nodeId}-${field.fieldName}-${source}`} className="col-span-2 rounded border border-amber-300/20 bg-amber-400/10 p-2 text-[10px] text-amber-100">
                                {label} {target ? `(${target})` : ''} 已映射，但图像节点当前仅提交文本和图片输入；如需视频/音频工作流，后续应放到对应节点入口。
                              </div>
                            );
                          }
                          return (
                            <label key={`${field.nodeId}-${field.fieldName}-${source}`} className="space-y-1">
                              <span className="flex items-center justify-between gap-2 text-[10px] text-white/55">
                                <span>{label}</span>
                                {target && <span className="text-cyan-100/80">{target}</span>}
                              </span>
                              {selectOptions.length > 0 ? (
                                <select
                                  value={String(value ?? selectOptions[0] ?? '')}
                                  onChange={(e) => patchProviderParams({ [source]: e.target.value })}
                                  style={{ background: '#18181b', color: '#ffffff' }}
                                  className="nodrag nowheel w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-300/60"
                                >
                                  {selectOptions.map((option: string | number) => (
                                    <option key={String(option)} value={String(option)} style={{ background: '#18181b', color: '#ffffff' }}>
                                      {String(option)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={isNumber ? 'number' : 'text'}
                                  value={String(value ?? '')}
                                  step={source === 'cfg' || source === 'denoise' || source.startsWith('strength_') ? 0.1 : 1}
                                  min={source === 'width' || source === 'height' ? 64 : source === 'batch_size' ? 1 : undefined}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    patchProviderParams({ [source]: isNumber && raw !== '' ? Number(raw) : raw });
                                  }}
                                  placeholder={String(comfyFieldDefault(field) ?? '')}
                                  style={{ background: '#18181b', color: '#ffffff' }}
                                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-300/60"
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-200">
                        当前工作流没有保存字段映射，请到 API 设置中点“自动映射”，或使用 ComfyUI应用制作工具重新导入 workflow。
                      </div>
                    )}
                    {(comfyImageInputFields.length > 0 || orderedTexts.length > 0 || excludedUpstreamCount > 0) && (
                      <MaterialPreviewSection
                        texts={orderedTexts}
                        images={orderedImages}
                        order={materialOrder}
                        onReorder={setMaterialOrder}
                        onRemoveLocal={handleRemoveLocalMaterial}
                        onExcludeUpstream={handleExcludeUpstreamMaterial}
                        excludedCount={excludedUpstreamCount}
                        onRestoreExcluded={handleRestoreExcludedMaterials}
                        selected={!!selected}
                        isDark={isDark}
                        isPixel={isPixel}
                        groups={comfyImageInputFields.length > 0 ? ['text', 'image'] : ['text']}
                        title="ComfyUI 输入素材 · 上游+本地"
                        imageUploadAction={
                          comfyImageInputFields.length > 0 && refImages.length < maxRefs
                            ? {
                                onClick: handlePickFile,
                                title: '上传 ComfyUI 输入图',
                                remaining: maxRefs - refImages.length,
                              }
                            : undefined
                        }
                      />
                    )}
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

        {/* 模型 TAB 切换(对应主项目 gpt-image-2-web Tab 0/1/2) */}
        {!isExternalSelected && <div>
          <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.model')}</label>
          <div
            className={`flex flex-wrap gap-0.5 p-0.5 rounded ${isPixel ? '' : 'bg-white/5'}`}
            style={isPixel ? { background: 'var(--px-muted)', border: '1.5px solid var(--px-ink)' } : undefined}
          >
            {IMAGE_MODELS
              .filter((m) => !isZhenzhenBudgetPlatformSelected
                || m.id === 'gpt-image-2'
                || m.id === 'nano-banana-2'
                || m.id === 'nano-banana-pro'
                || m.id === 'grok-image'
                || m.id === 'qwen-image-3.0'
                || m.id === 'wan-image'
                || m.id === 'seedream-layer-decomposition'
                || m.id === 'midjourney')
              .map((m) => {
              const isActive = m.id === model;
              return (
                <button
                  key={m.id}
                  onClick={() => switchModel(m.id)}
                  title={m.description}
                  className={`min-w-[64px] flex-1 py-1 text-[10px] font-semibold rounded transition-all ${
                    isActive ? 'bg-amber-500/30 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  style={
                    isPixel && isActive
                      ? { background: 'var(--px-yellow)', color: 'var(--px-ink)', border: '1.5px solid var(--px-ink)', boxShadow: '1px 1px 0 var(--px-ink)' }
                      : isPixel ? { color: 'var(--px-ink-soft)' } : undefined
                  }
                >
                  {m.tabLabel}
                </button>
              );
            })}
          </div>
        </div>}

        {isSeedream && !isExternalSelected && (
          <div className="rounded border border-cyan-400/25 bg-cyan-500/5 p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.apiSource')}</label>
              <select
                value={seedreamApiSource}
                onChange={(e) => update({ seedreamApiSource: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
              >
                <option value="zhenzhen" style={{ background: '#18181b', color: '#ffffff' }}>贞贞的AI工坊（海外） · 原 Seedream</option>
                <option value="seedance-nz" style={{ background: '#18181b', color: '#ffffff' }}>贞贞的平价AI小屋 · api.seedance.nz</option>
              </select>
            </div>
            {isSeedreamNz && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.modelRegion')}</label>
                  <select
                    value={seedreamNzModelFamily}
                    onChange={(e) => update({ seedreamNzModelFamily: e.target.value })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                  >
                    <option value="domestic" style={{ background: '#18181b', color: '#ffffff' }}>Seedream v5 Pro（国内模型）</option>
                    <option value="overseas" style={{ background: '#18181b', color: '#ffffff' }}>Dola Seedream 5.0 Pro（海外模型）</option>
                  </select>
                </div>
                <div className="text-[10px] leading-4 text-cyan-100/75">
                  实际模型：{seedreamNzUiModel}（{seedreamNzModelRegion}，按参考图自动切换）
                  {!zhenzhenSd2ApiKey && <div className="mt-1 text-amber-300">{translate('nodes:generation.missingBudgetKey')}</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 子模型选择(对齐主项目 Tab 内的 model 下拉) - MJ 模式隐藏(用下面专属版本选择) */}
        {!isExternalSelected && !isMj && !isSeedreamNz && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.specificModel')}</label>
            <select
              value={apiModel}
              onChange={(e) => switchApiModel(e.target.value)}
              style={{ background: '#18181b', color: '#ffffff' }}
              className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
            >
              {builtinApiModelOptions.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ background: '#18181b', color: '#ffffff' }}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {isZhenzhenBudgetImageSelected && !isExternalSelected && (
          <div className="rounded border border-cyan-400/25 bg-cyan-500/5 px-2 py-1.5 text-[10px] leading-4 text-cyan-100/80">
            <div>{`贞贞的平价AI小屋 · ${apiModel}`}</div>
            <div>
              {isZhenzhenImageG2
                ? isZhenzhenImageG2I2I
                  ? '图生图模式：必须提供 1–10 张参考图；固定 1K。'
                  : '文生图模式：只使用 Prompt，已连接的参考图不会发送；固定 1K。'
                : isZhenzhenLowpriceImage
                  ? 'GPT Image 2 平价模型：支持 1K/2K/4K，可选 1–16 张参考图。'
                  : isZhenzhenNb2Lite
                    ? 'Nano Banana 2 Lite：固定 1K，支持 1–4 张输出和最多 14 张参考图。'
                    : isZhenzhenNb2
                      ? 'Nano Banana 2：支持 0.5K/1K/2K/4K、超宽/超高比例和最多 14 张参考图；单次固定 1 张输出。'
                      : isZhenzhenNbPro
                        ? 'Nano Banana Pro：支持 1K/2K/4K、标准比例和最多 14 张参考图；单次固定 1 张输出。'
                  : isZhenzhenGrokImageV2
                    ? 'Grok Imagine 2.0 文生图：提示词最多 20000 字符，支持一次生成 1–12 张，不发送参考图。'
                  : isZhenzhenGrokImageV2Edit
                    ? 'Grok Imagine 2.0 编辑：必须按顺序提供 1–3 张参考图，支持 1K/2K、自动或固定比例、一次生成 1–10 张。'
                  : isZhenzhenGrokImageEdit
                    ? 'Grok Image 1.5 编辑：必须提供参考图，仅使用第 1 张。'
                    : 'Grok Image 1.5 文生图：只使用 Prompt，不发送参考图。'}
            </div>
            {!zhenzhenSd2ApiKey && <div className="text-amber-300">{translate('nodes:generation.missingBudgetKey')}</div>}
          </div>
        )}

        {isQwenImageTab && !isExternalSelected && (
          <div className="rounded border border-cyan-400/25 bg-cyan-500/5 px-2 py-1.5 text-[10px] leading-4 text-cyan-100/80">
            <div>贞贞的平价AI小屋 · {apiModel}</div>
            <div>
              {isQwenImageI2I
                ? '图像编辑模式：必须按顺序提供 1–3 张参考图。'
                : '文生图模式：只发送 Prompt，不发送已连接的参考图。'}
            </div>
            <div>提示词 5–2000 字符；单次可请求 1–6 张图。</div>
            {!zhenzhenSd2ApiKey && <div className="text-amber-300">{translate('nodes:generation.missingBudgetKey')}</div>}
          </div>
        )}

        {isWanImageTab && !isExternalSelected && (
          <div className="rounded border border-cyan-400/25 bg-cyan-500/5 px-2 py-1.5 text-[10px] leading-4 text-cyan-100/80">
            <div>贞贞的平价AI小屋 · {apiModel}</div>
            <div>
              {isWanImageI2I
                ? '图像编辑模式：必须按顺序提供 1–9 张参考图；提示词最多 2048 字符。'
                : '文生图模式：只发送 Prompt，不发送已连接的参考图；提示词最多 5000 字符。'}
            </div>
            {!zhenzhenSd2ApiKey && <div className="text-amber-300">{translate('nodes:generation.missingBudgetKey')}</div>}
          </div>
        )}

        {isSeedreamLayerTab && !isExternalSelected && (
          <div className="rounded border border-cyan-400/25 bg-cyan-500/5 px-2 py-1.5 text-[10px] leading-4 text-cyan-100/80">
            <div>贞贞的平价AI小屋 · {apiModel}</div>
            <div>必须且只能输入 1 张图；提示词可留空，最多 2000 字符。</div>
            <div>国内 Seedream 与海外 Dola 共用同一参数；国内模型保持默认。</div>
            <div>完成后按官方顺序保存底图与全部图层，不排序、不去重、不截断，不会只取第一张。</div>
            {!zhenzhenSd2ApiKey && <div className="text-amber-300">{translate('nodes:generation.missingBudgetKey')}</div>}
          </div>
        )}

        {isZhenzhenNb2Lite && !isExternalSelected && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.outputCount')}</label>
            <select
              value={zhenzhenNbImageCount}
              onChange={(e) => update({ apimartImageCount: Number(e.target.value) })}
              style={{ background: '#18181b', color: '#ffffff' }}
              className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count} style={{ background: '#18181b', color: '#ffffff' }}>{count}</option>
              ))}
            </select>
          </div>
        )}

        {(isZhenzhenGrokImageV2 || isZhenzhenGrokImageV2Edit) && !isExternalSelected && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.outputCount')}</label>
            <select
              value={grokV2ImageCount}
              onChange={(e) => update({ grokV2ImageCount: Number(e.target.value) })}
              style={{ background: '#18181b', color: '#ffffff' }}
              className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
            >
              {Array.from({ length: isZhenzhenGrokImageV2 ? 12 : 10 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count} style={{ background: '#18181b', color: '#ffffff' }}>{count}</option>
              ))}
            </select>
          </div>
        )}

        {isZhenzhenGrokImageV2Edit && !isExternalSelected && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">编辑分辨率</label>
              <select
                value={grokV2EditResolution}
                onChange={(e) => update({ grokV2EditResolution: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              >
                {ZHENZHEN_IMAGE_GK_V2_EDIT_RESOLUTIONS.map((resolution) => (
                  <option key={resolution} value={resolution} style={{ background: '#18181b', color: '#ffffff' }}>{resolution.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <label className="mt-4 flex items-center gap-2 rounded border border-white/10 px-2 py-1 text-[10px] text-white/65">
              <input
                type="checkbox"
                checked={grokV2EditNsfwCheck}
                onChange={(e) => update({ grokV2EditNsfwCheck: e.target.checked })}
                className="accent-cyan-400"
              />
              启用 NSFW 检查
            </label>
          </div>
        )}

        <LocalNodeAddonSlot
          nodeId={id}
          nodeType="image"
          data={d}
          update={update}
          context={{
            providerSource: isExternalSelected ? providerSelection.providerSource : ((isSeedreamNz || isZhenzhenBudgetPlatformSelected) ? 'seedance-nz' : 'zhenzhen'),
            providerId: providerSelection.providerId,
            providerModel: isExternalSelected ? externalProviderModel : (isSeedreamNz ? seedreamNzUiModel : apiModel),
            model: modelDef.id,
            apiModel,
            providerKind: isFal
              ? 'fal'
              : isZhenzhenBudgetMjSelected
                ? 'seedance-nz-midjourney'
                : (isZhenzhenBudgetImageSelected ? 'seedance-nz-image' : modelDef.paramKind),
          }}
        />

        {/* 比例 + 尺寸;Seedream 使用像素尺寸 + 输出格式,Grok Image 只需要比例 */}
        {(!isFal && !isMj && !isComfyExternal && !isQwenImageTab && !isSeedreamLayerTab && !isWanImageTab) && (
          <div className={`grid gap-2 ${isSeedream || (!isGrokImage && effectiveSizes.length) ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {effectiveAspectRatios.length > 0 && <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
              <select
                value={effectiveAspectRatio}
                onChange={(e) => update({ aspectRatio: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              >
                {effectiveAspectRatios.map((r) => (
                  <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                ))}
              </select>
            </div>}
            {!isGrokImage && !isSeedreamNz && effectiveSizes.length > 0 && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.size')}</label>
                <select
                  value={effectiveSizeLevel}
                  onChange={(e) => update({ sizeLevel: e.target.value })}
                  disabled={isZhenzhenImageG2}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {effectiveSizes.map((s) => (
                    <option key={s} value={s} style={{ background: '#18181b', color: '#ffffff' }}>{s}</option>
                  ))}
                </select>
              </div>
            )}
            {isSeedreamNz && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
                <select
                  value={seedreamNzResolution}
                  onChange={(e) => update({ seedreamNzResolution: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="1k" style={{ background: '#18181b', color: '#ffffff' }}>1K</option>
                  <option value="2k" style={{ background: '#18181b', color: '#ffffff' }}>2K</option>
                  <option value="custom" style={{ background: '#18181b', color: '#ffffff' }}>Custom</option>
                </select>
              </div>
            )}
            {isSeedream && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">格式</label>
                <select
                  value={seedreamOutputFormat}
                  onChange={(e) => update({ seedreamOutputFormat: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="png" style={{ background: '#18181b', color: '#ffffff' }}>PNG</option>
                  <option value="jpeg" style={{ background: '#18181b', color: '#ffffff' }}>JPEG</option>
                </select>
              </div>
            )}
            {isSeedream && !isSeedreamNz && sizeLevel === 'custom' && (
              <div className="col-span-2">
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.customSize')}</label>
                <input
                  value={seedreamCustomSize}
                  onChange={(e) => update({ seedreamCustomSize: e.target.value })}
                  placeholder="2048x1536"
                  inputMode="text"
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            )}
            {isSeedreamNz && seedreamNzResolution === 'custom' && (
              <div className="col-span-2">
                <label className="text-[10px] text-white/50 block mb-1">自定义尺寸（240-8192）</label>
                <input
                  value={seedreamNzCustomSize}
                  onChange={(e) => update({ seedreamNzCustomSize: e.target.value })}
                  placeholder="2048x1536"
                  inputMode="text"
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            )}
          </div>
        )}
        {isSeedreamLayerTab && !isExternalSelected && (
          <div className="grid grid-cols-2 gap-2 rounded border border-cyan-400/25 bg-cyan-500/5 p-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">分层分辨率</label>
              <select
                value={seedreamLayerResolution}
                onChange={(e) => update({ seedreamLayerResolution: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
              >
                <option value="auto" style={{ background: '#18181b', color: '#ffffff' }}>Auto</option>
                <option value="1k" style={{ background: '#18181b', color: '#ffffff' }}>1K</option>
                <option value="1.5k" style={{ background: '#18181b', color: '#ffffff' }}>1.5K</option>
                <option value="2k" style={{ background: '#18181b', color: '#ffffff' }}>2K</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.outputFormat')}</label>
              <select
                value={seedreamOutputFormat}
                onChange={(e) => update({ seedreamOutputFormat: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
              >
                <option value="png" style={{ background: '#18181b', color: '#ffffff' }}>PNG（推荐，保留透明层）</option>
                <option value="jpeg" style={{ background: '#18181b', color: '#ffffff' }}>JPEG</option>
              </select>
            </div>
          </div>
        )}
        {isQwenImageTab && !isExternalSelected && (
          <div className="space-y-2 rounded border border-cyan-400/25 bg-cyan-500/5 p-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">尺寸模式</label>
                <select
                  value={qwenSizingMode}
                  onChange={(e) => update({ qwenSizingMode: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                >
                  <option value="auto" style={{ background: '#18181b', color: '#ffffff' }}>自动推荐</option>
                  <option value="ratio" style={{ background: '#18181b', color: '#ffffff' }}>比例 + 分辨率</option>
                  <option value="custom_size" style={{ background: '#18181b', color: '#ffffff' }}>{translate('nodes:generation.customSize')}</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.outputCount')}</label>
                <select
                  value={qwenImageCount}
                  onChange={(e) => update({ qwenImageCount: Number(e.target.value) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                >
                  {[1, 2, 3, 4, 5, 6].map((count) => (
                    <option key={count} value={count} style={{ background: '#18181b', color: '#ffffff' }}>{count}</option>
                  ))}
                </select>
              </div>
            </div>
            {qwenSizingMode === 'ratio' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                  <select
                    value={effectiveAspectRatio}
                    onChange={(e) => update({ aspectRatio: e.target.value })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                  >
                    {QWEN_IMAGE_30_RATIOS.map((item) => (
                      <option key={item} value={item} style={{ background: '#18181b', color: '#ffffff' }}>{item}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.resolution')}</label>
                  <select
                    value={qwenResolution}
                    onChange={(e) => update({ qwenResolution: e.target.value })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                  >
                    <option value="1k" style={{ background: '#18181b', color: '#ffffff' }}>1K</option>
                    <option value="2k" style={{ background: '#18181b', color: '#ffffff' }}>2K</option>
                  </select>
                </div>
              </div>
            )}
            {qwenSizingMode === 'custom_size' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">自定义尺寸（W*H）</label>
                <input
                  value={qwenCustomSize}
                  onChange={(e) => update({ qwenCustomSize: e.target.value })}
                  placeholder="1024*1024"
                  inputMode="text"
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.seedRandom')}</label>
                <input
                  type="number"
                  min={-1}
                  max={2147483647}
                  value={qwenSeed}
                  onChange={(e) => update({ qwenSeed: Math.max(-1, Math.min(2147483647, Number(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                />
              </div>
              <label className="flex items-end gap-2 pb-1 text-[10px] text-white/65">
                <input
                  type="checkbox"
                  checked={qwenPromptExtend}
                  onChange={(e) => update({ qwenPromptExtend: e.target.checked })}
                  className="accent-cyan-400"
                />
                启用提示词扩写
              </label>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.negativePromptOptional')}</label>
              <textarea
                value={qwenNegativePrompt}
                onChange={(e) => update({ qwenNegativePrompt: e.target.value })}
                placeholder="不希望出现在图像中的内容"
                className="h-12 w-full resize-none rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white outline-none focus:border-cyan-400/60 placeholder:text-white/25"
              />
            </div>
          </div>
        )}
        {isWanImageTab && !isExternalSelected && !isWanImageI2I && (
          <div className="space-y-2 rounded border border-cyan-400/25 bg-cyan-500/5 p-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">宽度（512–4096）</label>
                <input
                  type="number"
                  min={512}
                  max={4096}
                  step={8}
                  value={wanImageWidth}
                  onChange={(e) => update({ wanImageWidth: Math.min(4096, Math.max(512, Number(e.target.value) || 1024)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">高度（512–4096）</label>
                <input
                  type="number"
                  min={512}
                  max={4096}
                  step={8}
                  value={wanImageHeight}
                  onChange={(e) => update({ wanImageHeight: Math.min(4096, Math.max(512, Number(e.target.value) || 1024)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-cyan-400/60"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[10px] text-white/65">
              <input
                type="checkbox"
                checked={wanImageThinkingMode}
                onChange={(e) => update({ wanImageThinkingMode: e.target.checked })}
                className="accent-cyan-400"
              />
              启用上游思考模式
            </label>
          </div>
        )}
        {isStandardGptImage2 && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">质量</label>
              <select
                value={gptImageQuality}
                onChange={(e) => update({ gptImageQuality: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              >
                <option value="auto" style={{ background: '#18181b', color: '#ffffff' }}>Auto</option>
                <option value="high" style={{ background: '#18181b', color: '#ffffff' }}>High</option>
                <option value="medium" style={{ background: '#18181b', color: '#ffffff' }}>Medium</option>
                <option value="low" style={{ background: '#18181b', color: '#ffffff' }}>Low</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.contentReview')}</label>
              <select
                value={gptImageModeration}
                onChange={(e) => update({ gptImageModeration: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              >
                <option value="auto" style={{ background: '#18181b', color: '#ffffff' }}>Auto</option>
                <option value="low" style={{ background: '#18181b', color: '#ffffff' }}>Low</option>
              </select>
            </div>
          </div>
        )}
        {isSeedreamNz && !isExternalSelected && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.specificModel')}</label>
            <div className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-xs text-white/80">
              {seedreamNzUiModel}
            </div>
          </div>
        )}

        {/* ========== FAL 专属参数面板(完全对齐 gpt-image-2-web gf_panel / nano_fal_panel) ========== */}
        {!isExternalSelected && isFal && falKind === 'gpt-fal' && (
          <div className="space-y-2 rounded border border-blue-400/30 bg-blue-500/5 p-2">
            <div className="text-[10px] text-blue-300 font-semibold tracking-wide">
              💡 FAL Queue API · openai/gpt-image-2
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Mode</label>
                <select
                  value={falMode}
                  onChange={(e) => update({ falMode: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="edit" style={{ background: '#18181b', color: '#ffffff' }}>Edit</option>
                  <option value="gen" style={{ background: '#18181b', color: '#ffffff' }}>Generate</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Size</label>
                <select
                  value={falSize}
                  onChange={(e) => update({ falSize: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {GPT_FAL_SIZES.map((s) => (
                    <option key={s.value} value={s.value} style={{ background: '#18181b', color: '#ffffff' }}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {falSize === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">Width (≈1 6倍)</label>
                  <input
                    type="number" min={256} max={3840} step={16}
                    value={falCustomW}
                    onChange={(e) => update({ falCustomW: parseInt(e.target.value) || 0 })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">Height (≈1 6倍)</label>
                  <input
                    type="number" min={256} max={3840} step={16}
                    value={falCustomH}
                    onChange={(e) => update({ falCustomH: parseInt(e.target.value) || 0 })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Quality</label>
                <select
                  value={falQuality}
                  onChange={(e) => update({ falQuality: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="low" style={{ background: '#18181b', color: '#ffffff' }}>Low</option>
                  <option value="medium" style={{ background: '#18181b', color: '#ffffff' }}>Medium</option>
                  <option value="high" style={{ background: '#18181b', color: '#ffffff' }}>High</option>
                  <option value="auto" style={{ background: '#18181b', color: '#ffffff' }}>Auto</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">N</label>
                <input
                  type="number" min={1} max={4}
                  value={falN}
                  onChange={(e) => update({ falN: Math.max(1, Math.min(4, parseInt(e.target.value) || 1)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Format</label>
                <select
                  value={falFormat}
                  onChange={(e) => update({ falFormat: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="png" style={{ background: '#18181b', color: '#ffffff' }}>PNG</option>
                  <option value="jpeg" style={{ background: '#18181b', color: '#ffffff' }}>JPEG</option>
                  <option value="webp" style={{ background: '#18181b', color: '#ffffff' }}>WebP</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/60">
              <input
                type="checkbox"
                checked={falSync}
                onChange={(e) => update({ falSync: e.target.checked })}
              />
              <span>同步模式 (sync_mode: 适合快速返回场景)</span>
            </label>
          </div>
        )}

        {!isExternalSelected && isFal && falKind === 'nbpro-fal' && (
          <div className="space-y-2 rounded border border-blue-400/30 bg-blue-500/5 p-2">
            <div className="text-[10px] text-blue-300 font-semibold tracking-wide">
              💡 FAL Queue API · fal-ai/nano-banana-pro/edit (需参考图)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">N</label>
                <input
                  type="number" min={1} max={4}
                  value={falN}
                  onChange={(e) => update({ falN: Math.max(1, Math.min(4, parseInt(e.target.value) || 1)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Aspect</label>
                <select
                  value={nbAspect}
                  onChange={(e) => update({ nbAspect: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {NBPRO_FAL_RATIOS.map((r) => (
                    <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Resolution</label>
                <select
                  value={nbResolution}
                  onChange={(e) => update({ nbResolution: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {NBPRO_FAL_RESOLUTIONS.map((r) => (
                    <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Format</label>
                <select
                  value={falFormat}
                  onChange={(e) => update({ falFormat: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="png" style={{ background: '#18181b', color: '#ffffff' }}>PNG</option>
                  <option value="jpeg" style={{ background: '#18181b', color: '#ffffff' }}>JPEG</option>
                  <option value="webp" style={{ background: '#18181b', color: '#ffffff' }}>WebP</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Safety</label>
                <select
                  value={nbSafety}
                  onChange={(e) => update({ nbSafety: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="1" style={{ background: '#18181b', color: '#ffffff' }}>1 (严)</option>
                  <option value="2" style={{ background: '#18181b', color: '#ffffff' }}>2</option>
                  <option value="3" style={{ background: '#18181b', color: '#ffffff' }}>3</option>
                  <option value="4" style={{ background: '#18181b', color: '#ffffff' }}>4</option>
                  <option value="5" style={{ background: '#18181b', color: '#ffffff' }}>5</option>
                  <option value="6" style={{ background: '#18181b', color: '#ffffff' }}>6 (松)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">ImgMode</label>
                <select
                  value={nbImgMode}
                  onChange={(e) => update({ nbImgMode: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="image_url" style={{ background: '#18181b', color: '#ffffff' }}>URL</option>
                  <option value="base64" style={{ background: '#18181b', color: '#ffffff' }}>Base64</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.seedOmit')}</label>
                <input
                  type="number" min={0}
                  value={nbSeed}
                  onChange={(e) => update({ nbSeed: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-white/60 mt-4">
                <input
                  type="checkbox"
                  checked={nbWebSearch}
                  onChange={(e) => update({ nbWebSearch: e.target.checked })}
                />
                <span>Web Search</span>
              </label>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.systemPromptOptional')}</label>
              <PromptTextarea
                title="图像扩展模型 System Prompt"
                value={nbSysPrompt}
                onValueChange={(value) => update({ nbSysPrompt: value })}
                placeholder={translate('nodes:generation.optionalSystemInstruction')}
                rows={2}
                promptTemplateKind="image"
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              />
            </div>
          </div>
        )}

        {/* ========== MJ 专属参数面板(完全对齐 gpt-image-2-web mj_* 控件 L1552~L1580) ========== */}
        {!isExternalSelected && isMj && isZhenzhenBudgetMjSelected && (
          <MidjourneyNzPanel
            data={d}
            update={update}
            imageCount={orderedImages.length}
            hasApiKey={!!zhenzhenSd2ApiKey}
          />
        )}

        {!isExternalSelected && isMj && !isZhenzhenBudgetMjSelected && (
          <div className="space-y-2 rounded border border-purple-400/30 bg-purple-500/5 p-2">
            <div className="text-[10px] text-purple-300 font-semibold tracking-wide">
              ✨ Midjourney(严格对齐主项目 runMJ)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">版本</label>
                <select
                  value={mjVersion}
                  onChange={(e) => update({ mjVersion: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_VERSIONS.map((m) => (
                    <option key={m.value} value={m.value} style={{ background: '#18181b', color: '#ffffff' }}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.aspectRatio')}</label>
                <select
                  value={mjAr}
                  onChange={(e) => update({ mjAr: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_RATIOS.map((r) => (
                    <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">速度</label>
                <select
                  value={mjSpeed}
                  onChange={(e) => update({ mjSpeed: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_SPEEDS.map((s) => (
                    <option key={s.value} value={s.value} style={{ background: '#18181b', color: '#ffffff' }}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="chaos 0~100">--c</label>
                <input
                  type="number" min={0} max={100}
                  value={mjC}
                  onChange={(e) => update({ mjC: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="stylize 0~1000">--s</label>
                <input
                  type="number" min={0} max={1000}
                  value={mjS}
                  onChange={(e) => update({ mjS: Math.max(0, Math.min(1000, parseInt(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="image weight 0~3">--iw</label>
                <input
                  type="number" min={0} max={3} step={0.25}
                  value={mjIw}
                  onChange={(e) => update({ mjIw: Math.max(0, Math.min(3, parseFloat(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="style ref weight 0~1000">--sw</label>
                <input
                  type="number" min={0} max={1000}
                  value={mjSw}
                  onChange={(e) => update({ mjSw: Math.max(0, Math.min(1000, parseInt(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">--sv</label>
                <select
                  value={mjSv}
                  onChange={(e) => update({ mjSv: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_SVS.map((o) => (
                    <option key={o.value} value={o.value} style={{ background: '#18181b', color: '#ffffff' }}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="seed 0=不传">seed</label>
                <input
                  type="number" min={0}
                  value={mjSeed}
                  onChange={(e) => update({ mjSeed: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="排除词">--no</label>
                <input
                  type="text"
                  value={mjNo}
                  onChange={(e) => update({ mjNo: e.target.value })}
                  placeholder="text, blurry"
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title={translate('nodes:generation.pollingMax')}>maxPoll</label>
                <input
                  type="number" min={10} max={3600}
                  value={mjMaxPoll}
                  onChange={(e) => update({ mjMaxPoll: Math.max(10, Math.min(3600, parseInt(e.target.value) || 1200)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title={translate('nodes:generation.pollingInterval')}>pollInt(s)</label>
                <input
                  type="number" min={1} max={30}
                  value={mjPollInt}
                  onChange={(e) => update({ mjPollInt: Math.max(1, Math.min(30, parseInt(e.target.value) || 3)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            </div>
            {/* sref 风格参考图 */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">--sref 风格参考 · {mjSrefImages.length}/{MJ_REF_MAX}</label>
              <div className="flex flex-wrap gap-1.5">
                {mjSrefImages.map((url, i) => (
                  <div key={i} className="relative w-12 h-12 rounded overflow-hidden border border-purple-300/30">
                    <SmartImage src={url} alt={`sref-${i}`} className="w-full h-full object-cover" thumbSize={160} />
                    <button
                      onClick={() => removeMjRef('sref', i)}
                      className="absolute top-0 right-0 w-4 h-4 bg-red-500/80 hover:bg-red-500 flex items-center justify-center rounded-bl"
                      title="移除"
                    >
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
                {mjSrefImages.length < MJ_REF_MAX && (
                  <button
                    onClick={() => handleMjPick('sref')}
                    className="w-12 h-12 rounded border-2 border-dashed border-purple-300/30 hover:border-purple-300/60 flex items-center justify-center text-purple-300/60 hover:text-purple-300 transition-colors"
                    title="上传 sref 风格参考图"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </div>
            {/* oref 角色参考图 */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">--oref 角色参考 · {mjOrefImages.length}/{MJ_REF_MAX}</label>
              <div className="flex flex-wrap gap-1.5">
                {mjOrefImages.map((url, i) => (
                  <div key={i} className="relative w-12 h-12 rounded overflow-hidden border border-purple-300/30">
                    <SmartImage src={url} alt={`oref-${i}`} className="w-full h-full object-cover" thumbSize={160} />
                    <button
                      onClick={() => removeMjRef('oref', i)}
                      className="absolute top-0 right-0 w-4 h-4 bg-red-500/80 hover:bg-red-500 flex items-center justify-center rounded-bl"
                      title="移除"
                    >
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
                {mjOrefImages.length < MJ_REF_MAX && (
                  <button
                    onClick={() => handleMjPick('oref')}
                    className="w-12 h-12 rounded border-2 border-dashed border-purple-300/30 hover:border-purple-300/60 flex items-center justify-center text-purple-300/60 hover:text-purple-300 transition-colors"
                    title="上传 oref 角色参考图"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 上游素材聚合预览区 (新机制) - 本地上传 + 上游接入统一呈现, 可拖动排序 */}
        {(!isComfyExternal && (isExternalSelected || modelDef.supportsReference)) && (
          <MaterialPreviewSection
            texts={orderedTexts}
            images={orderedImages}
            order={materialOrder}
            onReorder={setMaterialOrder}
            onRemoveLocal={handleRemoveLocalMaterial}
            onExcludeUpstream={handleExcludeUpstreamMaterial}
            excludedCount={excludedUpstreamCount}
            onRestoreExcluded={handleRestoreExcludedMaterials}
            selected={!!selected}
            isDark={isDark}
            isPixel={isPixel}
            groups={['text', 'image']}
            title={isMj
              ? '主参考图 · 上游+本地'
              : (isZhenzhenImageG2 && !isZhenzhenImageG2I2I) || isZhenzhenGrokImage
                ? '参考图 · 当前文生图模型不会发送'
                : '参考图 · 上游+本地'}
            imageUploadAction={
              maxRefs > 0 && orderedImages.length < maxRefs
                ? {
                    onClick: handlePickFile,
                    title: '上传本地参考图',
                    remaining: maxRefs - orderedImages.length,
                  }
                : undefined
            }
          />
        )}
        {/* 隐藏的主参考图上传 input - 走 mainFileInputRef + handleFiles */}
        <input
          ref={mainFileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          className="hidden"
        />
        {/* 隐藏的 MJ sref/oref 上传 input - 走 fileInputRef + handleMjFiles */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleMjFiles}
          className="hidden"
        />

        {/* 本地 prompt(优先取上游) */}
        {!isComfyExternal && <div>
          <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.localPrompt')}</label>
          <MentionPromptInput
            title={translate('nodes:image.promptTitle')}
            value={localPrompt}
            mentions={promptMentions}
            materials={mentionMaterials}
            onChange={(value, mentions) => update({ prompt: value, promptMentions: mentions })}
            placeholder={translate('nodes:generation.promptFallback')}
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="image"
            imagePromptAdjustments={imagePromptAdjustments}
            onImagePromptAdjustmentsChange={updateImagePromptAdjustments}
            imagePromptAdjustmentHasReferenceImages={orderedImages.length > 0}
            className="w-full h-14 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>}

        <label className="nodrag flex cursor-pointer items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-white/60">
          <input
            type="checkbox"
            className="nodrag nowheel h-3.5 w-3.5 shrink-0 accent-amber-400"
            checked={imageOnlyOutput}
            disabled={status === 'generating'}
            onChange={(event) => update({ imageOnlyOutput: event.currentTarget.checked })}
            aria-label={translate('nodes:image.imageOnlyAria')}
          />
          <span>{translate('nodes:image.imageOnly')}</span>
        </label>

        <ReuseResultToggle
          checked={d?.reuseResult === true}
          hasResult={hasReusableGenerationResult('image', d)}
          onChange={(checked) => update({ reuseResult: checked })}
          accentColor="#f59e0b"
        />

        {/* 生成按钮(包含异步进度) */}
        {status === 'generating' ? (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> {translate('nodes:generation.stopWithStatus', { status: d?.progress || translate('nodes:generation.generating') })}
          </button>
        ) : (
          <button
            onClick={() => requestCanvasNodeRun(id)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> {translate('nodes:generation.generate')}
          </button>
        )}

        {status === 'generating' && downloadNotice && (
          <div className="flex items-start gap-1 text-[10px] text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{downloadNotice}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

      {/* 结果展示：仅在未外挂 OutputNode 时在节点内预览，避免与下游 OutputNode 重复 */}
      {imageUrl && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <SmartImage
            src={imageUrl}
            alt={translate('nodes:image.resultAlt')}
            className="w-full rounded object-cover"
            thumbSize={720}
            data-drag-source
            data-drag-kind="image"
            data-drag-url={imageUrl}
            data-drag-preview={imageUrl}
            data-drag-node-id={id}
            data-resource-title={imageUrl.split('/').pop() || translate('nodes:image.generatedImage')}
            data-prompt-template-kind="image"
            data-prompt-template-category="image-reference-edit"
            data-prompt-template-prompt={d?.lastPrompt || localPrompt || String(providerParams.prompt ?? providerParams.positive ?? '')}
            data-prompt-template-negative={String(providerParams.negative ?? providerParams.negativePrompt ?? '')}
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'image', url: imageUrl, sourceNodeId: id, previewUrl: imageUrl })
            }
            title={translate('nodes:generation.ctrlDrag')}
          />
        </div>
      )}
      {isZhenzhenBudgetMjSelected && videoUrl && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <LazyVideo
            src={videoUrl}
            controls
            preload="metadata"
            className="w-full rounded bg-black"
            data-drag-source
            data-drag-kind="video"
            data-drag-url={videoUrl}
            data-drag-preview={videoUrl}
            data-drag-node-id={id}
          />
        </div>
      )}
      {isZhenzhenBudgetMjSelected && outputText && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-cyan-300/15 bg-cyan-500/5 p-2 text-[10px] leading-4 text-cyan-50/80">
            {outputText}
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(ImageNode);
