/**
 * 模型注册表 - 集中定义可扩展模型清单
 * 后续要新增模型只需在对应数组里追加即可
 */

export type ProviderType = 'zhenzhen' | 'llm-direct' | 'runninghub';

// ========== 图像 ==========
// paramKind:决定调用上游时使用哪种参数协议
//  - 'gpt-size'    : OpenAI 兼容,size 字段为像素串(1024x1024 等),编辑端点 multipart
//  - 'banana-ratio': nano-banana 协议,使用 aspect_ratio + image_size(1K/2K/4K) + image[]
//  - 'grok-image'  : Grok Image 协议,JSON /generations,参考图默认 base64 dataURL
//  - 'seedream-v5' : Seedream V5 Pro 协议,JSON /generations,size 为像素串,image[] 可选
//  - 'seedream-layer': Seedream V5 Pro 分层协议,单图输入,返回底图 + 有序图层列表
//  - 'qwen-image-3.0': Qwen Image 3.0 协议,auto / 比例+分辨率 / 自定义 W*H 三种互斥尺寸模式
//  - 'wan-image'   : Wan 2.7 Global 图像协议,T2I 使用宽高/思考模式,I2I 使用 1-9 张参考图
//  - 'mj'          : Midjourney 协议,走专属 /api/proxy/mj/* 路由(speed_map + sref/oref)
export type ImageParamKind = 'gpt-size' | 'banana-ratio' | 'grok-image' | 'seedream-v5' | 'seedream-layer' | 'qwen-image-3.0' | 'wan-image' | 'mj';

export interface ImageModelDef {
  id: string;             // 节点内部 id(如 'gpt-image-2')
  apiModel: string;       // 默认上游真实模型名(透传给 API)
  label: string;          // 长名(用于描述行)
  tabLabel: string;       // TAB 短名
  provider: ProviderType;
  paramKind: ImageParamKind;
  capabilities: ('t2i' | 'i2i' | 'edit' | 'text-render')[];
  // 子模型变体(对齐主项目 gpt-image-2-web 的 g_model / n_model 下拉)
  apiModelOptions: Array<{ value: string; label: string }>;
  // 比例选项(双协议通用,Auto/1:1/16:9 …)
  aspectRatios: string[];
  defaultAspectRatio: string;
  // 尺寸选项:gpt-size 用像素串(1024x1024…), banana-ratio 用等级(1K/2K/4K)
  sizes: string[];
  defaultSize: string;
  // 是否支持参考图(图生图)
  supportsReference: boolean;
  // 参考图最大数量
  maxReferenceImages: number;
  description?: string;
}

// 主项目 gpt-image-2-web 的 aspectRatio 全集(14 种 + Auto)
const GPT_RATIOS = ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'];
// nano-banana-2(Flash)支持全部 14 个比例并补充 9:21 竖长图,Pro 支持精简集
const BANANA_FLASH_RATIOS = ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9', '9:21', '1:4', '4:1', '1:8', '8:1'];
const BANANA_PRO_RATIOS = ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9', '9:21'];
// gpt-image-2-web Grok Image Tab 的比例集合,默认参考图传入方式为 Base64
const GROK_IMAGE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

export const GPT_IMAGE_2_ZHENZHEN_SIZE_VARIANTS: Record<string, '2K' | '4K'> = {
  'gpt-image-2-2K': '2K',
  'gpt-image-2-4K': '4K',
};

export const ZHENZHEN_IMAGE_G2_T2I_MODEL = 'zhenzhen-image-g2-t2i';
export const ZHENZHEN_IMAGE_G2_I2I_MODEL = 'zhenzhen-image-g2-i2i';
export const ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL = 'zhenzhen-image-g-v2-lowprice';
export const ZHENZHEN_IMAGE_GK_V15_MODEL = 'zhenzhen-image-gk-v15';
export const ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL = 'zhenzhen-image-gk-v15-edit';
export const ZHENZHEN_IMAGE_GK_V2_MODEL = 'zhenzhen-image-gk-v2';
export const ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL = 'zhenzhen-image-gk-v2-edit';
export const ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL = 'zhenzhen-image-gk-v2-segment';
export const ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL = 'zhenzhen-image-gk-v2-region-edit';
export const ZHENZHEN_IMAGE_NB_2_LITE_MODEL = 'zhenzhen-image-nb-2-lite';
export const ZHENZHEN_IMAGE_NB_2_MODEL = 'zhenzhen-image-nb-2';
export const ZHENZHEN_IMAGE_NB_PRO_MODEL = 'zhenzhen-image-nb-pro';
export const ZHENZHEN_IMAGE_G2_MODELS = [
  ZHENZHEN_IMAGE_G2_T2I_MODEL,
  ZHENZHEN_IMAGE_G2_I2I_MODEL,
] as const;
export const ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS = [
  { value: ZHENZHEN_IMAGE_G2_T2I_MODEL, label: ZHENZHEN_IMAGE_G2_T2I_MODEL },
  { value: ZHENZHEN_IMAGE_G2_I2I_MODEL, label: ZHENZHEN_IMAGE_G2_I2I_MODEL },
  { value: ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL, label: ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL },
] as const;
export const ZHENZHEN_BUDGET_GROK_MODEL_OPTIONS = [
  { value: ZHENZHEN_IMAGE_GK_V2_MODEL, label: ZHENZHEN_IMAGE_GK_V2_MODEL },
  { value: ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL, label: ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL },
  { value: ZHENZHEN_IMAGE_GK_V15_MODEL, label: ZHENZHEN_IMAGE_GK_V15_MODEL },
  { value: ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL, label: ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL },
] as const;
export const ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS = [
  { value: ZHENZHEN_IMAGE_NB_2_MODEL, label: ZHENZHEN_IMAGE_NB_2_MODEL },
  { value: ZHENZHEN_IMAGE_NB_2_LITE_MODEL, label: ZHENZHEN_IMAGE_NB_2_LITE_MODEL },
] as const;
export const ZHENZHEN_BUDGET_BANANA_PRO_MODEL_OPTIONS = [
  { value: ZHENZHEN_IMAGE_NB_PRO_MODEL, label: ZHENZHEN_IMAGE_NB_PRO_MODEL },
] as const;
export const ZHENZHEN_IMAGE_G2_MODEL_OPTIONS = ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS.slice(0, 2);
export const ZHENZHEN_APIMART_IMAGE_MODELS = [
  ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL,
  ZHENZHEN_IMAGE_GK_V2_MODEL,
  ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V15_MODEL,
  ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL,
  ZHENZHEN_IMAGE_NB_2_LITE_MODEL,
  ZHENZHEN_IMAGE_NB_2_MODEL,
  ZHENZHEN_IMAGE_NB_PRO_MODEL,
] as const;
export const ZHENZHEN_BUDGET_IMAGE_MODELS = [
  ...ZHENZHEN_IMAGE_G2_MODELS,
  ...ZHENZHEN_APIMART_IMAGE_MODELS,
] as const;
export const ZHENZHEN_IMAGE_G2_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
export const ZHENZHEN_IMAGE_GK_V15_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3'];
export const ZHENZHEN_IMAGE_GK_V2_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3'];
export const ZHENZHEN_IMAGE_GK_V2_EDIT_RATIOS = [
  'auto', '16:9', '19.5:9', '1:1', '1:2', '20:9', '2:1',
  '2:3', '3:2', '3:4', '4:3', '9:16', '9:19.5', '9:20',
] as const;
export const ZHENZHEN_IMAGE_GK_V2_EDIT_RESOLUTIONS = ['1k', '2k'] as const;
export const ZHENZHEN_IMAGE_NB_STANDARD_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
];
export const ZHENZHEN_IMAGE_NB_EXTREME_RATIOS = [
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1',
  '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9',
];

export function isZhenzhenImageG2Model(apiModel: string | undefined | null): boolean {
  return (ZHENZHEN_IMAGE_G2_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

export const QWEN_IMAGE_30_T2I_MODELS = [
  'qwen-image-3.0-t2i',
  'qwen-image-3.0-pro-t2i',
  'qwen-image-3.0-global-t2i',
  'qwen-image-3.0-global-pro-t2i',
] as const;
export const QWEN_IMAGE_30_I2I_MODELS = [
  'qwen-image-3.0-i2i',
  'qwen-image-3.0-pro-i2i',
  'qwen-image-3.0-global-i2i',
  'qwen-image-3.0-global-pro-i2i',
] as const;
export const QWEN_IMAGE_30_MODELS = [
  'qwen-image-3.0-t2i',
  'qwen-image-3.0-i2i',
  'qwen-image-3.0-pro-t2i',
  'qwen-image-3.0-pro-i2i',
  'qwen-image-3.0-global-t2i',
  'qwen-image-3.0-global-i2i',
  'qwen-image-3.0-global-pro-t2i',
  'qwen-image-3.0-global-pro-i2i',
] as const;
export type QwenImage30Model = typeof QWEN_IMAGE_30_MODELS[number];
export const QWEN_IMAGE_30_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
export const SEEDREAM_LAYER_DECOMPOSITION_MODEL = 'seedream-v5-pro-layer-decomposition';
export const DOLA_SEEDREAM_LAYER_DECOMPOSITION_MODEL = 'dola-seedream-5.0-pro-layer-decomposition';
export const SEEDREAM_LAYER_DECOMPOSITION_MODELS = [
  SEEDREAM_LAYER_DECOMPOSITION_MODEL,
  DOLA_SEEDREAM_LAYER_DECOMPOSITION_MODEL,
] as const;
export type SeedreamLayerDecompositionModel = typeof SEEDREAM_LAYER_DECOMPOSITION_MODELS[number];
export const SEEDREAM_LAYER_RESOLUTIONS = ['auto', '1k', '1.5k', '2k'] as const;

export function isQwenImage30Model(apiModel: string | undefined | null): apiModel is QwenImage30Model {
  return (QWEN_IMAGE_30_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

export function isQwenImage30I2IModel(apiModel: string | undefined | null): boolean {
  return (QWEN_IMAGE_30_I2I_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

export const WAN27_GLOBAL_T2I_MODEL = 'wan-2.7-global-t2i';
export const WAN27_GLOBAL_I2I_MODEL = 'wan-2.7-global-i2i';
export const WAN27_GLOBAL_I2I_PRO_MODEL = 'wan-2.7-global-i2i-pro';
export const WAN27_GLOBAL_IMAGE_MODELS = [
  WAN27_GLOBAL_T2I_MODEL,
  WAN27_GLOBAL_I2I_MODEL,
  WAN27_GLOBAL_I2I_PRO_MODEL,
] as const;
export const WAN27_GLOBAL_I2I_MODELS = [WAN27_GLOBAL_I2I_MODEL, WAN27_GLOBAL_I2I_PRO_MODEL] as const;
export type Wan27GlobalImageModel = typeof WAN27_GLOBAL_IMAGE_MODELS[number];

export function isWan27GlobalI2IModel(apiModel: string | undefined | null): boolean {
  return (WAN27_GLOBAL_I2I_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

export function isZhenzhenApimartImageModel(apiModel: string | undefined | null): boolean {
  return (ZHENZHEN_APIMART_IMAGE_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

export function isZhenzhenBudgetImageModel(apiModel: string | undefined | null): boolean {
  return (ZHENZHEN_BUDGET_IMAGE_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

export function gptImage2ZhenzhenVariantSize(apiModel: string | undefined | null): '2K' | '4K' | null {
  return GPT_IMAGE_2_ZHENZHEN_SIZE_VARIANTS[String(apiModel || '').trim()] || null;
}

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: 'gpt-image-2',
    apiModel: 'gpt-image-2',
    label: 'GPT Image 2',
    tabLabel: 'GPT2',
    provider: 'zhenzhen',
    paramKind: 'gpt-size',
    capabilities: ['t2i', 'i2i', 'edit', 'text-render'],
    apiModelOptions: [
      { value: 'gpt-image-2-all', label: 'gpt-image-2-all' },
      { value: 'gpt-image-2', label: 'gpt-image-2' },
      { value: 'gpt-image-2-2K', label: 'gpt-image-2-2K' },
      { value: 'gpt-image-2-4K', label: 'gpt-image-2-4K' },
      { value: 'gpt-image-2-fal', label: 'gpt-image-2-fal' },
    ],
    aspectRatios: GPT_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K', // 主项目默认为 2K
    supportsReference: true,
    maxReferenceImages: 9,
    description: '支持文生图/图生图/编辑/文字渲染',
  },
  {
    id: 'nano-banana-2',
    apiModel: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    tabLabel: '香蕉2',
    provider: 'zhenzhen',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [
      { value: 'gemini-3.1-flash-image', label: 'nano-banana-2 (Flash)' },
      { value: 'gemini-3.1-flash-lite-image', label: 'gemini-3.1-flash-lite-image' },
      { value: 'nano-banana-2-fal', label: 'nano-banana-2-fal' },
    ],
    aspectRatios: BANANA_FLASH_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '高速生成,适合迭代',
  },
  {
    id: 'nano-banana-pro',
    apiModel: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    tabLabel: '香蕉Pro',
    provider: 'zhenzhen',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i', 'edit'],
    apiModelOptions: [
      { value: 'nano-banana-pro', label: 'nano-banana-pro' },
      { value: 'nano-banana-pro-2k', label: 'nano-banana-pro-2k' },
      { value: 'nano-banana-pro-4k', label: 'nano-banana-pro-4k' },
      { value: 'gemini-3-pro-image', label: 'gemini-3-pro-image' },
      { value: 'nano-banana-pro-fal', label: 'nano-banana-pro-fal' },
    ],
    aspectRatios: BANANA_PRO_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '高品质 Pro 版本',
  },
  {
    id: 'grok-image',
    apiModel: 'grok-4.2-image',
    label: 'Grok Image',
    tabLabel: 'Grok',
    provider: 'zhenzhen',
    paramKind: 'grok-image',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [
      { value: 'grok-4.2-image', label: 'grok-4.2-image' },
    ],
    aspectRatios: GROK_IMAGE_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 4,
    description: 'Grok Image · 参考图 Base64',
  },
  {
    id: 'seedream-v5-pro',
    apiModel: 'seedream-v5-pro',
    label: 'Seedream V5 Pro',
    tabLabel: 'Seedream',
    provider: 'zhenzhen',
    paramKind: 'seedream-v5',
    capabilities: ['t2i', 'i2i', 'edit'],
    apiModelOptions: [
      { value: 'seedream-v5-pro', label: 'seedream-v5-pro' },
    ],
    aspectRatios: [],
    defaultAspectRatio: '',
    sizes: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096', 'custom'],
    defaultSize: '2048x2048',
    supportsReference: true,
    maxReferenceImages: 10,
    description: 'Seedream V5 Pro · 文生图/多图编辑',
  },
  {
    id: 'seedream-layer-decomposition',
    apiModel: SEEDREAM_LAYER_DECOMPOSITION_MODEL,
    label: 'Seedream V5 Pro 分层',
    tabLabel: 'Seedream分层',
    provider: 'zhenzhen',
    paramKind: 'seedream-layer',
    capabilities: ['i2i', 'edit'],
    apiModelOptions: SEEDREAM_LAYER_DECOMPOSITION_MODELS.map((value) => ({ value, label: value })),
    aspectRatios: [],
    defaultAspectRatio: '',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 1,
    description: 'Seedream / Dola Seedream V5 Pro 图层拆分 · 单图输入，完整返回底图与全部有序图层',
  },
  {
    id: 'qwen-image-3.0',
    apiModel: 'qwen-image-3.0-t2i',
    label: 'Qwen Image 3.0',
    tabLabel: 'Qwen Image',
    provider: 'zhenzhen',
    paramKind: 'qwen-image-3.0',
    capabilities: ['t2i', 'i2i', 'edit', 'text-render'],
    apiModelOptions: QWEN_IMAGE_30_MODELS.map((value) => ({ value, label: value })),
    aspectRatios: QWEN_IMAGE_30_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 3,
    description: 'Qwen Image 3.0 / Pro · 国内与 Global 文生图、图像编辑',
  },
  {
    id: 'wan-image',
    apiModel: WAN27_GLOBAL_T2I_MODEL,
    label: 'Wan Image 2.7 Global',
    tabLabel: 'Wan Image',
    provider: 'zhenzhen',
    paramKind: 'wan-image',
    capabilities: ['t2i', 'i2i', 'edit'],
    apiModelOptions: WAN27_GLOBAL_IMAGE_MODELS.map((value) => ({ value, label: value })),
    aspectRatios: [],
    defaultAspectRatio: '',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 9,
    description: 'Wan 2.7 Global · 文生图与 1–9 图编辑',
  },
  // ========================================================================
  // Midjourney — 完全对齐 gpt-image-2-web/index.html runMJ L4437~L4694
  //   * 不走 FAL 渠道
  //   * 不使用主流 size/imageSize 字段(MJ 用 ar 控制比例)
  //   * 参考图通过 --sref/--oref(uploadMJImage 后取 URL) 注入 prompt
  //   * 子模型在 prompt 后追加 --{version}(v 8.1 / niji 7 等)
  //   * 速度 fast/turbo/relax 决定上游 URL 段(mj-fast/mj-turbo/mj-relax)
  // ========================================================================
  {
    id: 'midjourney',
    apiModel: 'midjourney',
    label: 'Midjourney',
    tabLabel: 'MJ',
    provider: 'zhenzhen',
    paramKind: 'mj',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [
      { value: 'midjourney', label: 'Midjourney' },
    ],
    aspectRatios: ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'],
    defaultAspectRatio: '1:1',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 4, // sref + oref(各 2 张)
    description: 'Midjourney v8.1 / niji 7 等',
  },
];

// ========================================================================
// MJ 常量(对齐 gpt-image-2-web/index.html L1552~L1580 mj_model/mj_ar 下拉)
// ========================================================================
/** 11 个 MJ 版本(v 8.1 默认 + niji 系列) */
export const MJ_VERSIONS: Array<{ value: string; label: string }> = [
  { value: 'v 8.1', label: 'v 8.1 (默认)' },
  { value: 'v 8',   label: 'v 8' },
  { value: 'v 7',   label: 'v 7' },
  { value: 'v 6.1', label: 'v 6.1' },
  { value: 'v 6.0', label: 'v 6.0' },
  { value: 'v 5.2', label: 'v 5.2' },
  { value: 'v 5.1', label: 'v 5.1' },
  { value: 'niji 7', label: 'niji 7' },
  { value: 'niji 6', label: 'niji 6' },
  { value: 'niji 5', label: 'niji 5' },
  { value: 'niji 4', label: 'niji 4' },
];
export const DEFAULT_MJ_VERSION = 'v 8.1';

/** 7 个 MJ 比例 */
export const MJ_RATIOS = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];
export const DEFAULT_MJ_RATIO = '1:1';

/** 3 档速度 */
export const MJ_SPEEDS: Array<{ value: 'fast' | 'turbo' | 'relax'; label: string }> = [
  { value: 'fast',  label: 'Fast (默认)' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'relax', label: 'Relax' },
];
export const DEFAULT_MJ_SPEED = 'fast';

/** 4 档 sv(Stylize Version) */
export const MJ_SVS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'sv 1 (默认)' },
  { value: '2', label: 'sv 2' },
  { value: '3', label: 'sv 3' },
  { value: '4', label: 'sv 4' },
];

/** 判断 modelDef.paramKind === 'mj' */
export function isMjModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  const def = IMAGE_MODELS.find((m) => m.id === apiModel || m.apiModel === apiModel);
  return def?.paramKind === 'mj';
}

// ========================================================================
// FAL 渠道注册表(完全对齐 gpt-image-2-web SKILL.md §FAL模型渠道接入规范)
//   - URL: {baseUrl}/fal/{endpoint}   (替换官方 queue.fal.run)
//   - 同步: response.images[]; 异步: request_id + response_url + 轮询
//   - response_url 域名修复: queue.fal.run → {baseUrl}/fal
//   - 轮询 HTTP 非 200 时,body 中 status==='IN_QUEUE'/'IN_PROGRESS' 时重试,否则抛错
// ========================================================================
// FAL 参数协议种类
//   - 'gpt-fal'      : openai/gpt-image-2(/edit) — quality/num_images/output_format/image_size/sync_mode
//   - 'nbpro-fal'    : fal-ai/nano-banana-pro/edit — num_images/aspect_ratio/resolution/output_format/safety_tolerance/system_prompt/enable_web_search
export type FalParamKind = 'gpt-fal' | 'nbpro-fal';

export interface FalEndpointDef {
  /** 文生图(无参考图)endpoint */
  endpoint: string;
  /** 图生图(有参考图,image_urls)endpoint;不填则与 endpoint 相同 */
  editEndpoint?: string;
  paramKind: FalParamKind;
  /** 最大参考图数(主项目: gpt=5, nbpro=8) */
  maxRefs: number;
}

/** 按 apiModel(如 'gpt-image-2-fal' / 'nano-banana-pro-fal' / 'nano-banana-2-fal')索引 */
export const FAL_REGISTRY: Record<string, FalEndpointDef> = {
  'gpt-image-2-fal': {
    endpoint: 'openai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    paramKind: 'gpt-fal',
    maxRefs: 5,
  },
  'nano-banana-pro-fal': {
    // nano-banana-pro FAL 只对外提供 edit 端点(主项目 line 3623)
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
  // 主项目 runGeminiFal(line 3491) 与 runNanoFal 共用同一个 fal-ai/nano-banana-pro/edit 端点,
  // 参数集与 nbpro-fal 完全一致(g2f_* 与 nf_* 仅是 UI 控件 id 前缀差异),
  // 所以复用 nbpro-fal paramKind / maxRefs=8 。
  'nano-banana-2-fal': {
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
};

/** 判断一个 apiModel 是否走 FAL 协议 */
export function isFalModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  return !!FAL_REGISTRY[String(apiModel)] || /-fal$/.test(String(apiModel));
}

/** GPT FAL 预设尺寸枚举(主项目 g_model 切到 fal 时的 gf_size 下拉) */
export const GPT_FAL_SIZES = [
  { value: 'auto', label: 'Auto' },
  { value: 'square_hd', label: 'Square HD' },
  { value: 'square', label: 'Square' },
  { value: 'portrait_4_3', label: 'Portrait 4:3' },
  { value: 'portrait_16_9', label: 'Portrait 16:9' },
  { value: 'landscape_4_3', label: 'Landscape 4:3' },
  { value: 'landscape_16_9', label: 'Landscape 16:9' },
  { value: 'custom', label: 'Custom (16 倍数)' },
];

/** Nano Banana Pro FAL 比例枚举(主项目 nf_ratio) */
export const NBPRO_FAL_RATIOS = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];
/** Nano Banana Pro FAL 分辨率枚举(主项目 nf_resolution) */
export const NBPRO_FAL_RESOLUTIONS = ['1K', '2K', '4K'];

// ========== 视频 ==========
// kind 决定上游 payload 协议(后端会根据 model 名自动识别,前端主要用于控制参数 UI 列表)
export type VideoKind = 'veo' | 'grok' | 'sora' | 'seedance' | 'seedance25' | 'happyhorse' | 'hailuo' | 'flux3' | 'kling' | 'vidu' | 'upscaler' | 'wan';

// ---- Video FAL 渠道注册表 (1:1 对齐 gpt-image-2-web runVeo3Fal / runGrokFal / runSora2Fal) ----
export interface VideoFalEndpointDef {
  /** 文生视频 endpoint */
  endpoint: string;
  /** 图生视频 endpoint (有参考图时走这个) */
  i2vEndpoint?: string;
  /** 参考生视频 endpoint (多参考图时走这个) */
  referenceEndpoint?: string;
  paramKind: 'veo-fal' | 'grok-fal' | 'sora-fal';
  maxRefImages: number;
  /** 参考图默认传入方式；Grok/Sora 新 FAL 默认走 base64 */
  defaultImageMode?: 'image_url' | 'base64';
  /** 该 FAL 端点是否必须带参考图 */
  requiresImage?: boolean;
  /** 该 FAL 端点是否不支持 aspect_ratio UI/参数 */
  disableAspectRatio?: boolean;
}
export const VIDEO_FAL_REGISTRY: Record<string, VideoFalEndpointDef> = {
  // 主项目 runVeo3Fal (index.html line 3713)
  'veo3.1-fal': {
    endpoint: 'fal-ai/veo3.1/fast/reference-to-video',
    paramKind: 'veo-fal',
    maxRefImages: 3,
  },
  // 主项目 runGrokFal (index.html line 3772)
  'grok-video-fal': {
    endpoint: 'xai/grok-imagine-video/text-to-video',
    i2vEndpoint: 'xai/grok-imagine-video/image-to-video',
    referenceEndpoint: 'xai/grok-imagine-video/reference-to-video',
    paramKind: 'grok-fal',
    maxRefImages: 7,
    defaultImageMode: 'base64',
  },
  // 主项目 gpt-image-2-web v4.5U: Grok Video 1.5 只走 image-to-video,不传 aspect_ratio。
  'grok-imagine-video-1.5': {
    endpoint: 'xai/grok-imagine-video/v1.5/image-to-video',
    paramKind: 'grok-fal',
    maxRefImages: 1,
    defaultImageMode: 'base64',
    requiresImage: true,
    disableAspectRatio: true,
  },
  // 主项目 runSora2Fal (index.html line 5341)
  'sora-2': {
    endpoint: 'fal-ai/sora-2/text-to-video',
    i2vEndpoint: 'fal-ai/sora-2/image-to-video',
    paramKind: 'sora-fal',
    maxRefImages: 1,
    defaultImageMode: 'base64',
  },
};
export function isFalVideoModel(apiModel: string): boolean {
  return apiModel in VIDEO_FAL_REGISTRY;
}
/** Veo FAL 比例(主项目 vf_ratio) */
export const VEO_FAL_RATIOS = ['16:9', '9:16'];
/** Veo FAL 时长(主项目 vf_duration) */
export const VEO_FAL_DURATIONS = ['8s'];
/** Veo FAL 分辨率(主项目 vf_resolution) */
export const VEO_FAL_RESOLUTIONS = ['720p', '1080p', '4k'];
/** Grok FAL 比例(主项目 gkf_ratio) */
export const GROK_FAL_RATIOS = ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', 'auto'];
/** Grok FAL 分辨率(主项目 gkf_resolution) */
export const GROK_FAL_RESOLUTIONS = ['720p', '480p'];
/** Grok FAL 模式(主项目 gkf_mode) */
export const GROK_FAL_MODES = [
  { value: 'image_to_video', label: '图生' },
  { value: 'reference_to_video', label: '参考' },
] as const;
/** Sora2 FAL 模式(主项目 srf_mode) */
export const SORA2_FAL_MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'text_to_video', label: 'Text' },
  { value: 'image_to_video', label: 'Image' },
] as const;
/** Sora2 FAL 比例(主项目 srf_ratio) */
export const SORA2_FAL_RATIOS = ['16:9', '9:16', 'auto'];
/** Sora2 FAL 时长(主项目 srf_duration) */
export const SORA2_FAL_DURATIONS = [4, 8, 12, 16, 20];
/** Sora2 FAL 分辨率(主项目 srf_resolution) */
export const SORA2_FAL_RESOLUTIONS = ['720p', 'auto'];

export const GROK_VIDEO_1_5_NEW_MODELS = [
  'grok-1.5-video-6s',
  'grok-1.5-video-10s',
  'grok-1.5-video-15s',
] as const;

export type GrokVideo15NewModel = typeof GROK_VIDEO_1_5_NEW_MODELS[number];

export const GROK_VIDEO_1_5_NEW_SIZES = [
  { value: '1280x720', label: '横屏 1280x720' },
  { value: '720x1280', label: '竖屏 720x1280' },
] as const;

export function isGrokVideo15NewModel(model: string): model is GrokVideo15NewModel {
  return (GROK_VIDEO_1_5_NEW_MODELS as readonly string[]).includes(String(model || '').trim());
}

export function grokVideo15NewSizeFromRatio(ratioOrSize: string): '1280x720' | '720x1280' {
  const value = String(ratioOrSize || '').trim();
  if (value === '720x1280') return '720x1280';
  if (value === '9:16') return '720x1280';
  return '1280x720';
}

export type VideoBuiltinSource = 'zhenzhen' | 'seedance-nz';

export interface VideoModelOption {
  value: string;
  label: string;
  disabled?: boolean;
  builtinSource?: VideoBuiltinSource;
  description?: string;
  ratios?: string[];
  defaultRatio?: string;
  durations?: number[];
  defaultDuration?: number;
  resolutions?: string[];
  defaultResolution?: string;
  supportImages?: boolean;
  supportVideos?: boolean;
  supportAudios?: boolean;
  maxRefImages?: number;
  maxRefVideos?: number;
  maxRefAudios?: number;
}

export interface VideoModelDef {
  id: string;                // 节点默认 model 字段(也是上游真实 model)
  label: string;             // 主选项显示名
  kind: VideoKind;
  provider: ProviderType;
  // 同一个 Tab 可以同时收录两套内置平台的模型；未标注时属于贞贞 AI 工坊。
  builtinSource?: VideoBuiltinSource;
  description?: string;
  // 子模型下拉(参考项目 类似 gpt-image-2-web 的 g_model / veo_model / gk_model)
  apiModelOptions: VideoModelOption[];
  // 比例/尺寸 — 字段名上游各不同,这里只是 UI 选项
  ratios: string[];
  defaultRatio: string;
  // Grok 专用:duration(s)、resolution 下拉
  durations?: number[];
  defaultDuration?: number;
  resolutions?: string[];
  defaultResolution?: string;
  // 参考图
  supportImages: boolean;
  // 参考视频（如视频编辑、超分）
  supportVideos?: boolean;
  maxRefImages: number;
}

// Veo 系列子模型。第一项是切到 Veo 分类时的默认具体模型。
export const ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL = 'zhenzhen-video-g-omni-flash';
export const ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL = 'zhenzhen-video-g-omni-flash-lowprice';
export const ZHENZHEN_VIDEO_GK_V15_MODEL = 'zhenzhen-video-gk-v15';
export const ZHENZHEN_VIDEO_V31_FAST_MODEL = 'zhenzhen-video-v31-fast';
export const ZHENZHEN_VIDEO_V31_QUALITY_MODEL = 'zhenzhen-video-v31-quality';
export const ZHENZHEN_VIDEO_V31_LITE_MODEL = 'zhenzhen-video-v31-lite';
export const ZHENZHEN_APIMART_VIDEO_MODELS = [
  ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_GK_V15_MODEL,
  ZHENZHEN_VIDEO_V31_FAST_MODEL,
  ZHENZHEN_VIDEO_V31_QUALITY_MODEL,
  ZHENZHEN_VIDEO_V31_LITE_MODEL,
] as const;

export const SEEDANCE25_VIDEO_MODELS = [
  'seedance-2.5-global-standard-i2v',
  'seedance-2.5-global-standard-multi',
  'seedance-2.5-global-standard-t2v',
  'seedance-2.5-standard-i2v',
  'seedance-2.5-standard-multi',
  'seedance-2.5-standard-t2v',
] as const;
export const HAILUO_H3_GLOBAL_VIDEO_MODELS = [
  'hailuo-h3-global-t2v',
  'hailuo-h3-global-i2v',
  'hailuo-h3-global-multi',
] as const;
export const MINIMAX_H3_OW_VIDEO_MODELS = [
  'minimax-h3-ow-t2v',
  'minimax-h3-ow-r2v',
  'minimax-h3-ow-i2v',
  'minimax-h3-ow-i2v-fast',
  'minimax-h3-ow-r2v-fast',
  'minimax-h3-ow-ref2va-audio-drive-fast',
  'minimax-h3-ow-fl2va-audio-drive-fast',
  'minimax-h3-ow-t2v-fast',
] as const;
export const FLUX3_VIDEO_MODELS = [
  'flux-3-video-t2v',
  'flux-3-video-i2v',
  'flux-3-video-v2v',
  'flux-3-video-draft-enhance',
  'flux-3-video-global-t2v',
  'flux-3-video-global-i2v',
  'flux-3-video-global-v2v',
  'flux-3-video-global-draft-enhance',
] as const;
export const FLUX3_VIDEO_RATIOS = ['auto', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const FLUX3_VIDEO_DURATIONS = Array.from({ length: 16 }, (_, index) => index + 5);
export const FLUX3_VIDEO_RESOLUTIONS = ['hd', 'fhd'] as const;
export const WAN30_I2V_MODELS = [
  'wan-3.0-i2v',
  'wan-3.0-global-i2v',
  'wan-3.0-prime-i2v',
  'wan-3.0-global-prime-i2v',
] as const;
export const WAN30_R2V_MODELS = [
  'wan-3.0-r2v',
  'wan-3.0-global-r2v',
  'wan-3.0-prime-r2v',
  'wan-3.0-global-prime-r2v',
] as const;
export const WAN30_VIDEO_MODELS = [
  'wan-3.0-global-i2v',
  'wan-3.0-global-r2v',
  'wan-3.0-i2v',
  'wan-3.0-r2v',
  'wan-3.0-prime-i2v',
  'wan-3.0-prime-r2v',
  'wan-3.0-global-prime-i2v',
  'wan-3.0-global-prime-r2v',
] as const;
export const WAN30_THINKING_MODELS = [
  'wan-3.0-global-i2v',
  'wan-3.0-global-r2v',
] as const;
export const WAN30_VIDEO_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const WAN30_VIDEO_DURATIONS = [-1, ...Array.from({ length: 29 }, (_, index) => index + 2)];
export const WAN30_VIDEO_RESOLUTIONS = ['480P', '720P', '1080P'] as const;
const SEEDANCE25_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
const SEEDANCE25_DURATIONS = [-1, ...Array.from({ length: 27 }, (_, index) => index + 4)];
const SEEDANCE25_RESOLUTIONS = ['480p', '720p', '1080p', '2k', '4k', 'native1080p'];
export const FLASHVSR_VIDEO_UPSCALE_MODEL = 'FlashVSR_video_upscale';
/** @deprecated Kept as an internal symbol alias so existing imports remain source-compatible. */
export const FASHVSR_VIDEO_UPSCALE_MODEL = FLASHVSR_VIDEO_UPSCALE_MODEL;

export function isZhenzhenApimartVideoModel(apiModel: string | undefined | null): boolean {
  return (ZHENZHEN_APIMART_VIDEO_MODELS as readonly string[]).includes(String(apiModel || '').trim());
}

const VEO_MODELS = [
  { value: 'veo-omni-10s', label: 'veo-omni-10s' },
  { value: ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL, label: ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL, builtinSource: 'seedance-nz' as const },
  { value: ZHENZHEN_VIDEO_V31_FAST_MODEL, label: ZHENZHEN_VIDEO_V31_FAST_MODEL, builtinSource: 'seedance-nz' as const },
  { value: ZHENZHEN_VIDEO_V31_QUALITY_MODEL, label: ZHENZHEN_VIDEO_V31_QUALITY_MODEL, builtinSource: 'seedance-nz' as const },
  { value: ZHENZHEN_VIDEO_V31_LITE_MODEL, label: ZHENZHEN_VIDEO_V31_LITE_MODEL, builtinSource: 'seedance-nz' as const },
  { value: 'veo3', label: 'veo3' },
  { value: 'veo3-fast', label: 'veo3-fast' },
  { value: 'veo3-pro', label: 'veo3-pro' },
  { value: 'veo3-fast-frames', label: 'veo3-fast-frames' },
  { value: 'veo3-pro-frames', label: 'veo3-pro-frames' },
  { value: 'veo3.1', label: 'veo3.1 默认' },
  { value: 'veo3.1-fast', label: 'veo3.1-fast' },
  { value: 'veo3.1-pro', label: 'veo3.1-pro' },
  { value: 'veo3.1-components', label: 'veo3.1-components' },
  { value: 'veo3.1-4k', label: 'veo3.1-4k' },
  { value: 'veo3.1-pro-4k', label: 'veo3.1-pro-4k' },
  { value: 'veo3.1-components-4k', label: 'veo3.1-components-4k' },
  { value: 'veo3.1-lite', label: 'veo3.1-lite' },
  // FAL 渠道
  { value: 'veo3.1-fal', label: 'veo3.1-fal (FAL)' },
];

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: 'grok-video-3',
    label: 'Grok Video',
    kind: 'grok',
    provider: 'zhenzhen',
    description: 'xAI Grok Video (最多 7 张参考图)',
    apiModelOptions: [
      { value: 'grok-video-3', label: 'grok-video-3（新版1.5）' },
      { value: ZHENZHEN_VIDEO_GK_V15_MODEL, label: ZHENZHEN_VIDEO_GK_V15_MODEL, builtinSource: 'seedance-nz' },
      {
        value: ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL,
        label: `${ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL}（平价 Omni）`,
        builtinSource: 'seedance-nz',
        ratios: ['16:9', '9:16'], defaultRatio: '16:9',
        durations: [4, 6, 8, 10], defaultDuration: 6,
        resolutions: ['720p', '1080p', '4k'], defaultResolution: '720p',
        supportImages: true, supportVideos: true, maxRefImages: 3, maxRefVideos: 1,
      },
      { value: 'grok-1.5-video-6s', label: 'grok-1.5-video-6s（Zhenzhen New）' },
      { value: 'grok-1.5-video-10s', label: 'grok-1.5-video-10s（Zhenzhen New）' },
      { value: 'grok-1.5-video-15s', label: 'grok-1.5-video-15s（Zhenzhen New）' },
      { value: 'grok-imagine-video-1.5', label: 'Grok Video 1.5 (FAL)' },
      { value: 'grok-video-fal', label: 'grok-video-fal (FAL)' },
    ],
    // 主项目 gk_ratio(line 1410): 2:3 / 3:2 / 16:9 / 9:16 / 1:1
    ratios: ['2:3', '3:2', '16:9', '9:16', '1:1'],
    defaultRatio: '16:9',
    // gk_duration(line 1412): 6 / 10 / 15 / 30
    durations: [6, 10, 15, 30],
    defaultDuration: 15,
    // gk_resolution(line 1414): 480P / 720P
    resolutions: ['480P', '720P'],
    defaultResolution: '720P',
    supportImages: true,
    maxRefImages: 7,
  },
  {
    id: 'veo3.1',
    label: 'Veo',
    kind: 'veo',
    provider: 'zhenzhen',
    description: 'Google Veo 系列 (默认 veo-omni-10s)',
    apiModelOptions: VEO_MODELS,
    // 主项目 veo_ratio 只有 16:9 / 9:16(line 1352)
    ratios: ['16:9', '9:16'],
    defaultRatio: '16:9',
    defaultDuration: 10,
    supportImages: true,
    maxRefImages: 3,
  },
  {
    id: 'sora-2',
    label: 'Sora2',
    kind: 'sora',
    provider: 'zhenzhen',
    description: 'Sora2 支持 FAL 与 Zhenzhen API 双渠道；旧 sora-2 保持 FAL',
    apiModelOptions: [
      { value: 'sora-2', label: 'sora-2 (FAL)' },
      { value: 'sora-2-zhenzhen', label: 'sora-2 (Zhenzhen API)' },
    ],
    ratios: ['16:9', '9:16'],
    defaultRatio: '16:9',
    durations: [15],
    defaultDuration: 15,
    resolutions: [],
    defaultResolution: '',
    supportImages: true,
    maxRefImages: 1,
  },
  {
    id: 'wan-2.7-spicy',
    label: 'Wan',
    kind: 'wan',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Wan 2.7 Spicy / Wan 3.0 · 图生与多模态参考视频',
    apiModelOptions: [
      { value: 'wan-2.7-spicy-i2v', label: 'wan-2.7-spicy-i2v（图生视频）' },
      ...WAN30_VIDEO_MODELS.map((value) => {
        const mode = value.endsWith('-r2v') ? 'r2v' : 'i2v';
        return {
          value,
          label: `${value}${mode === 'i2v' ? '（首尾帧图生视频）' : '（多模态参考生视频）'}`,
          description: mode === 'i2v'
            ? 'Wan 3.0 I2V：第 1 张为首帧，第 2 张可选为尾帧；提示词可选。'
            : 'Wan 3.0 R2V：提示词必填，最多 10 图、5 视频、5 音频，并可附加文件或网页 URL。',
          ratios: [...WAN30_VIDEO_RATIOS],
          defaultRatio: 'adaptive',
          durations: WAN30_VIDEO_DURATIONS,
          defaultDuration: 2,
          resolutions: [...WAN30_VIDEO_RESOLUTIONS],
          defaultResolution: '480P',
          supportImages: true,
          supportVideos: mode === 'r2v',
          supportAudios: mode === 'r2v',
          maxRefImages: mode === 'i2v' ? 2 : 10,
          maxRefVideos: mode === 'r2v' ? 5 : 0,
          maxRefAudios: mode === 'r2v' ? 5 : 0,
        };
      }),
    ],
    ratios: ['16:9'],
    defaultRatio: '16:9',
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 2,
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 1,
  },
  {
    id: 'happyhorse-1.1',
    label: 'Happy Horse',
    kind: 'happyhorse',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Happy Horse 1.1 · 文生/图生/参考图生视频',
    apiModelOptions: [
      { value: 'happyhorse-1.1-t2v', label: 'happyhorse-1.1-t2v（文生视频）' },
      { value: 'happyhorse-1.1-i2v', label: 'happyhorse-1.1-i2v（图生视频）' },
      { value: 'happyhorse-1.1-r2v', label: 'happyhorse-1.1-r2v（参考图生视频）' },
    ],
    ratios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    defaultRatio: 'adaptive',
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 4,
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    supportImages: true,
    maxRefImages: 9,
  },
  {
    id: 'hailuo-2.3',
    label: 'Hailuo',
    kind: 'hailuo',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Hailuo 2.3 · 文生/图生/Fast 图生视频',
    apiModelOptions: [
      { value: 'hailuo-2.3-t2v-standard', label: 'hailuo-2.3-t2v-standard（文生标准）' },
      { value: 'hailuo-2.3-t2v-pro', label: 'hailuo-2.3-t2v-pro（文生 Pro）' },
      { value: 'hailuo-2.3-i2v-standard', label: 'hailuo-2.3-i2v-standard（图生标准）' },
      { value: 'hailuo-2.3-i2v-pro', label: 'hailuo-2.3-i2v-pro（图生 Pro）' },
      { value: 'hailuo-2.3-fast-i2v', label: 'hailuo-2.3-fast-i2v（Fast 图生）' },
      { value: 'hailuo-2.3-fast-pro-i2v', label: 'hailuo-2.3-fast-pro-i2v（Fast Pro 图生）' },
      {
        value: 'hailuo-h3-t2v',
        label: 'hailuo-h3-t2v（H3 文生视频）',
        description: 'Hailuo H3 国内文生视频；768P/2K，支持 5-15 秒与自适应比例。',
        ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        defaultDuration: 5,
        resolutions: ['768P', '2K'],
        defaultResolution: '768P',
        supportImages: false,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 0,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'hailuo-h3-i2v',
        label: 'hailuo-h3-i2v（H3 首尾帧图生视频）',
        description: 'Hailuo H3 国内图生视频；第 1 张为首帧，第 2 张可选为尾帧，支持 768P/2K。',
        ratios: [],
        defaultRatio: '16:9',
        durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        defaultDuration: 5,
        resolutions: ['768P', '2K'],
        defaultResolution: '768P',
        supportImages: true,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 2,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'hailuo-h3-multi',
        label: 'hailuo-h3-multi（H3 多模态参考）',
        description: 'Hailuo H3 国内多模态参考；最多 9 图、3 视频、3 音频，支持 768P/2K。',
        ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        defaultDuration: 5,
        resolutions: ['768P', '2K'],
        defaultResolution: '768P',
        supportImages: true,
        supportVideos: true,
        supportAudios: true,
        maxRefImages: 9,
        maxRefVideos: 3,
        maxRefAudios: 3,
      },
      ...HAILUO_H3_GLOBAL_VIDEO_MODELS.map((value) => {
        const mode = value.endsWith('-t2v') ? 't2v' : value.endsWith('-i2v') ? 'i2v' : 'multi';
        return {
          value,
          label: `${value}${mode === 't2v' ? '（H3 海外文生视频）' : mode === 'i2v' ? '（H3 海外首尾帧）' : '（H3 海外多模态）'}`,
          description: mode === 't2v'
            ? 'Hailuo H3 海外文生视频；768P/2K，支持 5-15 秒。'
            : mode === 'i2v'
              ? 'Hailuo H3 海外图生视频；第 1 张为首帧，第 2 张可选为尾帧。'
              : 'Hailuo H3 海外多模态参考；最多 9 图、3 视频、3 音频。',
          ratios: mode === 'i2v' ? [] : ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
          defaultRatio: '16:9',
          durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          defaultDuration: 5,
          resolutions: ['768P', '2K'],
          defaultResolution: '2K',
          supportImages: mode !== 't2v',
          supportVideos: mode === 'multi',
          supportAudios: mode === 'multi',
          maxRefImages: mode === 't2v' ? 0 : mode === 'i2v' ? 2 : 9,
          maxRefVideos: mode === 'multi' ? 3 : 0,
          maxRefAudios: mode === 'multi' ? 3 : 0,
        };
      }),
      {
        value: 'minimax-h3-ow-t2v',
        label: 'minimax-h3-ow-t2v（MiniMax H3 OW 文生视频）',
        description: 'MiniMax H3 OW 文生视频；5/10/15 秒，480p/720p。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: false,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 0,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'minimax-h3-ow-r2v',
        label: 'minimax-h3-ow-r2v（MiniMax H3 OW 参考生视频）',
        description: 'MiniMax H3 OW 参考图生视频；必须提供提示词与 1 张参考图。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: true,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 1,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'minimax-h3-ow-i2v',
        label: 'minimax-h3-ow-i2v（MiniMax H3 OW 图生视频）',
        description: 'MiniMax H3 OW 图生视频；必须提供 1 张首帧图，提示词可选。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: true,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 1,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'minimax-h3-ow-i2v-fast',
        label: 'minimax-h3-ow-i2v-fast（MiniMax H3 OW Fast 首帧图生视频）',
        description: 'MiniMax H3 OW Fast 图生视频；必须且只能提供 1 张首帧图，提示词可选。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: true,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 1,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'minimax-h3-ow-r2v-fast',
        label: 'minimax-h3-ow-r2v-fast（MiniMax H3 OW Fast 参考生视频）',
        description: 'MiniMax H3 OW Fast 参考生视频；必须填写提示词并提供 1-9 张参考图。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: true,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 9,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
      {
        value: 'minimax-h3-ow-ref2va-audio-drive-fast',
        label: 'minimax-h3-ow-ref2va-audio-drive-fast（参考图音频驱动 Fast）',
        description: 'MiniMax H3 OW 参考图音频驱动；必须且只能提供 1 张参考图与 1 段音频，提示词可选。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: true,
        supportVideos: false,
        supportAudios: true,
        maxRefImages: 1,
        maxRefVideos: 0,
        maxRefAudios: 1,
      },
      {
        value: 'minimax-h3-ow-fl2va-audio-drive-fast',
        label: 'minimax-h3-ow-fl2va-audio-drive-fast（首帧音频驱动 Fast）',
        description: 'MiniMax H3 OW 首帧音频驱动；必须且只能提供 1 张首帧图与 1 段音频，提示词可选。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: true,
        supportVideos: false,
        supportAudios: true,
        maxRefImages: 1,
        maxRefVideos: 0,
        maxRefAudios: 1,
      },
      {
        value: 'minimax-h3-ow-t2v-fast',
        label: 'minimax-h3-ow-t2v-fast（MiniMax H3 OW Fast 文生视频）',
        description: 'MiniMax H3 OW Fast 文生视频；必须填写提示词，不接受参考素材。',
        ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
        defaultRatio: '16:9',
        durations: [5, 10, 15],
        defaultDuration: 5,
        resolutions: ['480p', '720p'],
        defaultResolution: '480p',
        supportImages: false,
        supportVideos: false,
        supportAudios: false,
        maxRefImages: 0,
        maxRefVideos: 0,
        maxRefAudios: 0,
      },
    ],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: 'adaptive',
    durations: [6, 10],
    defaultDuration: 6,
    resolutions: ['768p', '1080p'],
    defaultResolution: '768p',
    supportImages: true,
    maxRefImages: 1,
  },
  {
    id: 'flux-3-video',
    label: 'Flux3',
    kind: 'flux3',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'FLUX 3 Video · 国内/海外文生、关键帧图生、视频编辑与草稿增强',
    apiModelOptions: FLUX3_VIDEO_MODELS.map((value) => {
      const mode = value.endsWith('-draft-enhance')
        ? 'draft-enhance'
        : value.endsWith('-v2v') ? 'v2v' : value.endsWith('-i2v') ? 'i2v' : 't2v';
      return {
        value,
        label: `${value}${mode === 't2v' ? '（文生视频）' : mode === 'i2v' ? '（关键帧图生）' : mode === 'v2v' ? '（视频编辑）' : '（草稿增强）'}`,
        description: mode === 't2v'
          ? '仅提示词；可开启 Draft 以返回后续增强所需缓存。'
          : mode === 'i2v'
            ? '提示词 + 1-10 张排序关键帧图片。'
            : mode === 'v2v'
              ? '提示词 + 1 个 MP4 输入视频。'
              : '使用同线路已完成 Draft 任务返回的 draft_cache。',
        ratios: [...FLUX3_VIDEO_RATIOS],
        defaultRatio: 'auto',
        durations: FLUX3_VIDEO_DURATIONS,
        defaultDuration: 5,
        resolutions: [...FLUX3_VIDEO_RESOLUTIONS],
        defaultResolution: 'hd',
        supportImages: mode === 'i2v',
        supportVideos: mode === 'v2v',
        supportAudios: false,
        maxRefImages: mode === 'i2v' ? 10 : 0,
        maxRefVideos: mode === 'v2v' ? 1 : 0,
        maxRefAudios: 0,
      };
    }),
    ratios: [...FLUX3_VIDEO_RATIOS],
    defaultRatio: 'auto',
    durations: FLUX3_VIDEO_DURATIONS,
    defaultDuration: 5,
    resolutions: [...FLUX3_VIDEO_RESOLUTIONS],
    defaultResolution: 'hd',
    supportImages: true,
    supportVideos: true,
    maxRefImages: 10,
  },
  {
    id: 'vidu-q3',
    label: 'Vidu',
    kind: 'vidu',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Vidu Q3 · 文生/图生/首尾帧/参考生视频/短剧成片',
    apiModelOptions: [
      { value: 'vidu-q3-turbo-t2v', label: 'vidu-q3-turbo-t2v（文生 Turbo）' },
      { value: 'vidu-q3-pro-t2v', label: 'vidu-q3-pro-t2v（文生 Pro）' },
      { value: 'vidu-q3-pro-fast-t2v', label: 'vidu-q3-pro-fast-t2v（文生 Pro Fast）' },
      { value: 'vidu-q3-turbo-i2v', label: 'vidu-q3-turbo-i2v（图生 Turbo）' },
      { value: 'vidu-q3-pro-i2v', label: 'vidu-q3-pro-i2v（图生 Pro）' },
      { value: 'vidu-q3-pro-fast-i2v', label: 'vidu-q3-pro-fast-i2v（图生 Pro Fast）' },
      { value: 'vidu-q3-turbo-start-end', label: 'vidu-q3-turbo-start-end（首尾帧 Turbo）' },
      { value: 'vidu-q3-pro-start-end', label: 'vidu-q3-pro-start-end（首尾帧 Pro）' },
      { value: 'vidu-q3-pro-fast-start-end', label: 'vidu-q3-pro-fast-start-end（首尾帧 Pro Fast）' },
      { value: 'vidu-q3-r2v', label: 'vidu-q3-r2v（上游当前不可用）', disabled: true },
      { value: 'vidu-q3-mix-r2v', label: 'vidu-q3-mix-r2v（上游当前不可用）', disabled: true },
      { value: 'vidu-q3-ad-r2v', label: 'vidu-q3-ad-r2v（上游当前不可用）', disabled: true },
      { value: 'vidu-q3-drama-r2v', label: 'vidu-q3-drama-r2v（上游当前不可用）', disabled: true },
      { value: 'vidu-q3-drama-short-play', label: 'vidu-q3-drama-short-play（上游当前不可用）', disabled: true },
      { value: 'vidu-q3-ad-short-play', label: 'vidu-q3-ad-short-play（上游当前不可用）', disabled: true },
    ],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: '16:9',
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 4,
    resolutions: ['default', '720p', '1080p'],
    defaultResolution: 'default',
    supportImages: true,
    maxRefImages: 14,
  },
  {
    id: 'kling-v3.0',
    label: 'Kling',
    kind: 'kling',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Kling · 文生/图生/首尾帧/O3 参考生视频与视频编辑',
    apiModelOptions: [
      { value: 'kling-v3.0-std-t2v', label: 'kling-v3.0-std-t2v（文生标准）' },
      { value: 'kling-v3.0-pro-t2v', label: 'kling-v3.0-pro-t2v（文生 Pro）' },
      { value: 'kling-v3-turbo-std-t2v', label: 'kling-v3-turbo-std-t2v（文生 Turbo 标准）' },
      { value: 'kling-v3-turbo-pro-t2v', label: 'kling-v3-turbo-pro-t2v（文生 Turbo Pro）' },
      { value: 'kling-v3-4k-t2v', label: 'kling-v3-4k-t2v（文生 4K）' },
      { value: 'kling-o3-std-t2v', label: 'kling-o3-std-t2v（O3 文生标准）' },
      { value: 'kling-o3-pro-t2v', label: 'kling-o3-pro-t2v（O3 文生 Pro）' },
      { value: 'kling-o3-4k-t2v', label: 'kling-o3-4k-t2v（O3 文生 4K）' },
      { value: 'kling-v3.0-std-i2v', label: 'kling-v3.0-std-i2v（图生标准）' },
      { value: 'kling-v3.0-pro-i2v', label: 'kling-v3.0-pro-i2v（图生 Pro）' },
      { value: 'kling-v3-turbo-std-i2v', label: 'kling-v3-turbo-std-i2v（图生 Turbo 标准）' },
      { value: 'kling-v3-turbo-pro-i2v', label: 'kling-v3-turbo-pro-i2v（图生 Turbo Pro）' },
      { value: 'kling-v3-4k-i2v', label: 'kling-v3-4k-i2v（图生 4K）' },
      { value: 'kling-o3-std-i2v', label: 'kling-o3-std-i2v（O3 图生标准）' },
      { value: 'kling-o3-pro-i2v', label: 'kling-o3-pro-i2v（O3 图生 Pro）' },
      { value: 'kling-o3-4k-i2v', label: 'kling-o3-4k-i2v（O3 图生 4K）' },
      { value: 'kling-o3-std-r2v', label: 'kling-o3-std-r2v（上游当前不可用）', disabled: true },
      { value: 'kling-o3-pro-r2v', label: 'kling-o3-pro-r2v（上游当前不可用）', disabled: true },
      { value: 'kling-o3-4k-r2v', label: 'kling-o3-4k-r2v（O3 参考 4K）' },
      { value: 'kling-o3-std-edit', label: 'kling-o3-std-edit（O3 视频编辑标准）' },
      { value: 'kling-o3-pro-edit', label: 'kling-o3-pro-edit（O3 视频编辑 Pro）' },
    ],
    ratios: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    defaultRatio: '16:9',
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: [],
    defaultResolution: '',
    supportImages: true,
    maxRefImages: 4,
  },
  {
    id: 'zhenzhen-upscaler',
    label: 'Upscaler',
    kind: 'upscaler',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Zhenzhen Upscaler · 单个 MP4 视频高清化',
    apiModelOptions: [
      { value: 'zhenzhen-upscaler', label: 'zhenzhen-upscaler' },
    ],
    ratios: [],
    defaultRatio: '',
    durations: [],
    resolutions: ['720p', '1080p', '2k', '4k'],
    defaultResolution: '1080p',
    supportImages: false,
    supportVideos: true,
    maxRefImages: 0,
  },
  {
    id: 'fashvsr-video-upscale',
    label: 'FlashVSR 视频超分',
    kind: 'upscaler',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'FlashVSR · 单个 480P、3-15 秒视频超分',
    apiModelOptions: [
      { value: FASHVSR_VIDEO_UPSCALE_MODEL, label: FASHVSR_VIDEO_UPSCALE_MODEL },
    ],
    ratios: [],
    defaultRatio: '',
    durations: [],
    resolutions: [],
    defaultResolution: '',
    supportImages: false,
    supportVideos: true,
    maxRefImages: 0,
  },
  {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    kind: 'seedance25',
    provider: 'zhenzhen',
    builtinSource: 'seedance-nz',
    description: 'Seedance 2.5 Standard · 文生、首尾帧与多模态参考视频',
    apiModelOptions: SEEDANCE25_VIDEO_MODELS.map((value) => {
      const mode = value.endsWith('-t2v') ? 't2v' : value.endsWith('-i2v') ? 'i2v' : 'multi';
      return {
        value,
        label: `${value}${mode === 't2v' ? '（文生视频）' : mode === 'i2v' ? '（首尾帧图生视频）' : '（多模态参考）'}`,
        description: mode === 't2v'
          ? '仅提示词；不发送参考素材。'
          : mode === 'i2v'
            ? '1-2 张图片，依次作为首帧和可选尾帧；提示词可选。'
            : '至少 1 个素材；最多 30 图、10 视频、10 音频，合计不超过 50 个。',
        ratios: SEEDANCE25_RATIOS,
        defaultRatio: mode === 'i2v' ? 'adaptive' : '16:9',
        durations: SEEDANCE25_DURATIONS,
        defaultDuration: 5,
        resolutions: SEEDANCE25_RESOLUTIONS,
        defaultResolution: '720p',
        supportImages: mode !== 't2v',
        supportVideos: mode === 'multi',
        supportAudios: mode === 'multi',
        maxRefImages: mode === 't2v' ? 0 : mode === 'i2v' ? 2 : 30,
        maxRefVideos: mode === 'multi' ? 10 : 0,
        maxRefAudios: mode === 'multi' ? 10 : 0,
      };
    }),
    ratios: SEEDANCE25_RATIOS,
    defaultRatio: 'adaptive',
    durations: SEEDANCE25_DURATIONS,
    defaultDuration: 5,
    resolutions: SEEDANCE25_RESOLUTIONS,
    defaultResolution: '720p',
    supportImages: true,
    supportVideos: true,
    maxRefImages: 30,
  },
  {
    id: 'seedance-2.0',
    label: 'Seedance 2.0',
    kind: 'seedance',
    provider: 'zhenzhen',
    description: '字节 Seedance 分镜 (兼容 veo 字段)',
    apiModelOptions: [{ value: 'seedance-2.0', label: 'seedance-2.0' }],
    ratios: ['16:9', '9:16', '1:1'],
    defaultRatio: '16:9',
    durations: [5, 10, 15],
    defaultDuration: 5,
    supportImages: true,
    maxRefImages: 3,
  },
];

export function videoModelOptionSource(
  model: VideoModelDef,
  option: VideoModelOption,
): VideoBuiltinSource {
  return option.builtinSource || model.builtinSource || 'zhenzhen';
}

export function videoModelOptionsForSource(
  model: VideoModelDef,
  source: VideoBuiltinSource,
): VideoModelOption[] {
  return model.apiModelOptions.filter((option) => videoModelOptionSource(model, option) === source);
}

export function videoModelsForSource(source: VideoBuiltinSource): VideoModelDef[] {
  return VIDEO_MODELS.filter(
    (model) => model.kind !== 'seedance' && videoModelOptionsForSource(model, source).length > 0,
  );
}

/**
 * 兼容旧画布：旧数据只有 model，没有 videoBuiltinSource。
 * 精确命中目录时恢复真实来源；未知模型交给调用方回退到贞贞 AI 工坊。
 */
export function inferVideoBuiltinSource(apiModel: unknown): VideoBuiltinSource | null {
  const savedModel = String(apiModel || '').trim();
  if (!savedModel) return null;
  for (const model of VIDEO_MODELS) {
    if (model.id === savedModel) {
      const sources = new Set(model.apiModelOptions.map((option) => videoModelOptionSource(model, option)));
      return sources.size === 1 ? Array.from(sources)[0] : model.builtinSource || 'zhenzhen';
    }
    const option = model.apiModelOptions.find((item) => item.value === savedModel);
    if (option) return videoModelOptionSource(model, option);
  }
  return null;
}

// ========== 音频(Suno) ==========
export interface AudioModelDef {
  id: string;
  label: string;
  provider: ProviderType;
  mode: 'generate' | 'cover' | 'extend';
  description?: string;
}

export const AUDIO_MODELS: AudioModelDef[] = [
  { id: 'suno-v5.5-generate', label: 'Suno V5.5 生成', provider: 'zhenzhen', mode: 'generate' },
  { id: 'suno-v5.5-cover', label: 'Suno V5.5 翻唱', provider: 'zhenzhen', mode: 'cover' },
  { id: 'suno-v5.5-extend', label: 'Suno V5.5 续写', provider: 'zhenzhen', mode: 'extend' },
];

// Suno 版本下拉选项（完全对齐主项目 gpt-image-2-web 的 SUNO_MV_MAP）。
// value 将被原样发送给后端。
export const SUNO_VERSIONS: Array<{ value: string; label: string }> = [
  { value: 'v3.0', label: 'v3.0' },
  { value: 'v3.5', label: 'v3.5' },
  { value: 'v4', label: 'v4' },
  { value: 'v4.5', label: 'v4.5' },
  { value: 'v4.5+', label: 'v4.5+' },
  { value: 'v5', label: 'v5' },
  { value: 'v5.5', label: 'v5.5' },
];
export const DEFAULT_SUNO_VERSION = 'v5.5';

export type SunoNzOperation =
  | 'suno-generation'
  | 'suno-lyrics'
  | 'suno-upload'
  | 'suno-extend'
  | 'suno-cover-song'
  | 'suno-inspo'
  | 'suno-mashup'
  | 'suno-upsample-tags'
  | 'suno-sounds'
  | 'suno-create-voice'
  | 'suno-stems'
  | 'suno-stems-all'
  | 'suno-wav'
  | 'suno-generate-mp4'
  | 'suno-concat'
  | 'suno-crop'
  | 'suno-fade-in'
  | 'suno-fade-out'
  | 'suno-remove-section'
  | 'suno-replace-music'
  | 'suno-adjust-speed'
  | 'suno-remaster'
  | 'suno-midi'
  | 'suno-bpm'
  | 'suno-aligned-lyrics'
  | 'suno-persona'
  | 'suno-vox'
  | 'suno-sample'
  | 'suno-add-vocals'
  | 'suno-add-instrumental'
  | 'suno-add-stem';

export type SunoNzResultFamily = 'audio' | 'text' | 'video' | 'file';
export type SunoNzReferenceType = 'none' | 'url' | 'task_audio' | 'mashup';
export type SunoNzField =
  | 'prompt'
  | 'version'
  | 'custom'
  | 'instrumental'
  | 'title'
  | 'style'
  | 'vocal_gender'
  | 'tags'
  | 'audioFilePath'
  | 'audio_url'
  | 'audio_urls'
  | 'task_id'
  | 'task_ids'
  | 'audio_index'
  | 'continue_at'
  | 'start_s'
  | 'end_s'
  | 'duration_s'
  | 'speed'
  | 'name';

export interface SunoNzActionDef {
  value: SunoNzOperation;
  label: string;
  action: string;
  requiredFields: readonly SunoNzField[];
  allowedVersions: readonly string[];
  defaultVersion?: string;
  resultFamily: SunoNzResultFamily;
  referenceType: SunoNzReferenceType;
}

export const SUNO_NZ_VERSIONS = ['v3.5', 'v4', 'v4.5', 'v4.5+', 'v4.5-all', 'v5', 'v5.5'] as const;
const SUNO_NZ_INSPO_VERSIONS = ['v4', 'v4.5', 'v4.5+', 'v4.5-all', 'v5', 'v5.5'] as const;
const SUNO_NZ_REPLACE_VERSIONS = ['v4', 'v4.5+', 'v5', 'v5.5'] as const;
const SUNO_NZ_REMASTER_VERSIONS = ['v4.5+', 'v5', 'v5.5'] as const;
const SUNO_NZ_V5_VERSIONS = ['v5', 'v5.5'] as const;

const sunoNzAction = (
  value: SunoNzOperation,
  label: string,
  requiredFields: readonly SunoNzField[],
  resultFamily: SunoNzResultFamily,
  referenceType: SunoNzReferenceType = 'none',
  allowedVersions: readonly string[] = [],
  defaultVersion?: string,
): SunoNzActionDef => ({
  value,
  label,
  action: value === 'suno-generation' ? '' : value.slice('suno-'.length),
  requiredFields,
  allowedVersions,
  defaultVersion,
  resultFamily,
  referenceType,
});

/**
 * api.seedance.nz 官方 Suno 31 项动作。
 * 这里使用显式目录，前后端都不会根据用户输入拼接未知 action 路径。
 */
export const SUNO_NZ_ACTIONS: readonly SunoNzActionDef[] = [
  sunoNzAction('suno-generation', '音乐生成', ['version', 'prompt'], 'audio', 'none', SUNO_NZ_VERSIONS),
  sunoNzAction('suno-lyrics', '生成歌词', ['prompt'], 'text'),
  sunoNzAction('suno-upload', '上传音频', ['audioFilePath'], 'audio', 'url'),
  sunoNzAction('suno-extend', '续写', ['task_id', 'continue_at'], 'audio', 'task_audio', SUNO_NZ_VERSIONS, 'v5.5'),
  sunoNzAction('suno-cover-song', '翻唱 / 换风格', ['task_id', 'prompt'], 'audio', 'task_audio', SUNO_NZ_VERSIONS, 'v5.5'),
  sunoNzAction('suno-inspo', '灵感参考', ['audio_urls'], 'audio', 'url', SUNO_NZ_INSPO_VERSIONS, 'v5.5'),
  sunoNzAction('suno-mashup', '双曲混合', ['task_ids', 'prompt'], 'audio', 'mashup', SUNO_NZ_VERSIONS, 'v5.5'),
  sunoNzAction('suno-upsample-tags', '扩写风格标签', ['tags'], 'text'),
  sunoNzAction('suno-sounds', '生成音效', ['prompt'], 'audio', 'none', SUNO_NZ_V5_VERSIONS, 'v5.5'),
  sunoNzAction('suno-create-voice', '创建音色', ['audio_url'], 'text', 'url'),
  sunoNzAction('suno-stems', '单分轨', ['task_id'], 'audio', 'task_audio'),
  sunoNzAction('suno-stems-all', '全分轨', ['task_id'], 'audio', 'task_audio'),
  sunoNzAction('suno-wav', '导出 WAV', ['task_id'], 'audio', 'task_audio'),
  sunoNzAction('suno-generate-mp4', '生成 MP4 / MV', ['task_id'], 'video', 'task_audio'),
  sunoNzAction('suno-concat', '拼接完整歌曲', ['task_id'], 'audio', 'task_audio'),
  sunoNzAction('suno-crop', '裁剪', ['task_id', 'start_s', 'end_s'], 'audio', 'task_audio'),
  sunoNzAction('suno-fade-in', '淡入', ['task_id', 'duration_s'], 'audio', 'task_audio'),
  sunoNzAction('suno-fade-out', '淡出', ['task_id', 'duration_s'], 'audio', 'task_audio'),
  sunoNzAction('suno-remove-section', '删除片段', ['task_id', 'start_s', 'end_s'], 'audio', 'task_audio'),
  sunoNzAction('suno-replace-music', '替换片段', ['task_id', 'start_s', 'end_s'], 'audio', 'task_audio', SUNO_NZ_REPLACE_VERSIONS, 'v5.5'),
  sunoNzAction('suno-adjust-speed', '调整速度', ['task_id', 'speed'], 'audio', 'task_audio'),
  sunoNzAction('suno-remaster', '母带处理', ['task_id'], 'audio', 'task_audio', SUNO_NZ_REMASTER_VERSIONS, 'v5.5'),
  sunoNzAction('suno-midi', '生成 MIDI', ['task_id'], 'file', 'task_audio'),
  sunoNzAction('suno-bpm', '分析 BPM', ['task_id'], 'text', 'task_audio'),
  sunoNzAction('suno-aligned-lyrics', '对齐歌词', ['task_id'], 'text', 'task_audio'),
  sunoNzAction('suno-persona', '创建 Persona', ['task_id', 'name'], 'text', 'task_audio'),
  sunoNzAction('suno-vox', '提取人声片段', ['task_id'], 'audio', 'task_audio'),
  sunoNzAction('suno-sample', '采样生成', ['task_id', 'start_s', 'end_s', 'prompt'], 'audio', 'task_audio', SUNO_NZ_VERSIONS, 'v5.5'),
  sunoNzAction('suno-add-vocals', '添加人声', ['task_id', 'prompt'], 'audio', 'task_audio', SUNO_NZ_V5_VERSIONS, 'v5.5'),
  sunoNzAction('suno-add-instrumental', '添加伴奏', ['task_id', 'prompt'], 'audio', 'task_audio', SUNO_NZ_V5_VERSIONS, 'v5.5'),
  sunoNzAction('suno-add-stem', '添加 Stem', ['task_id', 'prompt'], 'audio', 'task_audio', ['v5.5'], 'v5.5'),
] as const;

export const DEFAULT_SUNO_NZ_OPERATION: SunoNzOperation = 'suno-generation';

export function getSunoNzActionDef(value: unknown): SunoNzActionDef {
  return SUNO_NZ_ACTIONS.find((item) => item.value === value) || SUNO_NZ_ACTIONS[0];
}

// ========== LLM/Vision ==========
// 完全对齐 gpt-image-2-web Chat Tab(index.html L1600 chat_model select)
// 默认: gemini-3.5-flash
// 特殊模型: gpt-image-2-all — 图文双向(非流式,可返回 image_url)
export interface LlmModelDef {
  id: string;
  label: string;
  provider: ProviderType;
  /** 是否支持多模态(图片输入) */
  vision?: boolean;
  /** 是否支持图像输出(gpt-image-2-all) */
  imageOutput?: boolean;
  /** 是否仅支持非流式(出图模型走非流式) */
  nonStreaming?: boolean;
  contextLength?: number;
  description?: string;
}

export const LLM_MODELS: LlmModelDef[] = [
  { id: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite-preview', provider: 'llm-direct', vision: true, contextLength: 1_000_000 },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'llm-direct', vision: true, contextLength: 1_000_000 },
  { id: 'gemini-3.6-flash', label: 'gemini-3.6-flash', provider: 'llm-direct' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'llm-direct', vision: true, contextLength: 128_000 },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'llm-direct', vision: true, contextLength: 2_000_000 },
  { id: 'gpt-5', label: 'GPT-5', provider: 'llm-direct', vision: true, contextLength: 200_000 },
  { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna', provider: 'llm-direct' },
  { id: 'kimi-k3', label: 'kimi-k3', provider: 'llm-direct' },
  { id: 'gpt-image-2-all', label: 'GPT Image 2 All (图文)', provider: 'llm-direct', vision: true, imageOutput: true, nonStreaming: true, description: '可自动调用图像生成' },
];

export const QWEN3_TTS_FLASH_MODEL = 'qwen3-tts-flash';
export const QWEN3_TTS_INSTRUCT_FLASH_MODEL = 'qwen3-tts-instruct-flash';
export const QWEN3_TTS_MODELS = [QWEN3_TTS_FLASH_MODEL, QWEN3_TTS_INSTRUCT_FLASH_MODEL] as const;
export const QWEN3_TTS_LANGUAGE_TYPES = [
  'Chinese', 'English', 'Japanese', 'Korean', 'German',
  'French', 'Russian', 'Portuguese', 'Spanish', 'Italian',
] as const;

export const MINIMAX_MUSIC_MODEL = 'minimax-music-2.6';
export const MINIMAX_SPEECH_HD_MODEL = 'minimax-speech-2.8-hd';
export const MINIMAX_SPEECH_TURBO_MODEL = 'minimax-speech-2.8-turbo';
export const MINIMAX_VOICE_CLONE_MODEL = 'minimax-voice-clone';
export const MINIMAX_AUDIO_MODELS = [
  MINIMAX_MUSIC_MODEL,
  MINIMAX_SPEECH_HD_MODEL,
  MINIMAX_SPEECH_TURBO_MODEL,
  MINIMAX_VOICE_CLONE_MODEL,
] as const;
export const MINIMAX_SPEECH_MODELS = [MINIMAX_SPEECH_HD_MODEL, MINIMAX_SPEECH_TURBO_MODEL] as const;
export const MINIMAX_AUDIO_FORMATS = ['mp3', 'wav', 'flac'] as const;
export const MINIMAX_SAMPLE_RATES = ['16000', '24000', '32000', '44100'] as const;
export const MINIMAX_BITRATES = ['32000', '64000', '128000', '256000'] as const;
export const MINIMAX_LANGUAGE_BOOSTS = [
  'auto', 'Chinese', 'Chinese,Yue', 'English', 'Japanese', 'Korean',
  'French', 'German', 'Spanish', 'Portuguese', 'Russian',
] as const;

export const MUREKA_BGM_MODELS = ['mureka-v8-bgm', 'mureka-v9-bgm'] as const;

export const FLOWMUSIC_MODEL = 'flowmusic';
export const FLOWMUSIC_VERSIONS = ['default', 'lyria-3.5'] as const;
export const FLOWMUSIC_FORMATS = ['mp3', 'wav'] as const;
export const FLOWMUSIC_VIDEO_PRESETS = ['simple', 'modern', 'player'] as const;
export type FlowMusicOperation =
  | 'flowmusic-generation'
  | 'flowmusic-lyrics'
  | 'flowmusic-upload-audio'
  | 'flowmusic-extend'
  | 'flowmusic-replace'
  | 'flowmusic-cover'
  | 'flowmusic-stems'
  | 'flowmusic-download-audio'
  | 'flowmusic-video-clip';
export const FLOWMUSIC_ACTIONS = [
  { value: 'flowmusic-generation', label: '音乐生成', action: '', resultFamily: 'audio', supportsLyria35: true },
  { value: 'flowmusic-lyrics', label: '歌词生成', action: 'lyrics', resultFamily: 'text', supportsLyria35: false },
  { value: 'flowmusic-upload-audio', label: '上传音频', action: 'upload-audio', resultFamily: 'audio', supportsLyria35: false },
  { value: 'flowmusic-extend', label: '音乐续写', action: 'extend', resultFamily: 'audio', supportsLyria35: true },
  { value: 'flowmusic-replace', label: '片段替换', action: 'replace', resultFamily: 'audio', supportsLyria35: true },
  { value: 'flowmusic-cover', label: '整曲翻唱', action: 'cover', resultFamily: 'audio', supportsLyria35: true },
  { value: 'flowmusic-stems', label: '人声伴奏分离', action: 'stems', resultFamily: 'file', supportsLyria35: false },
  { value: 'flowmusic-download-audio', label: '下载音频', action: 'download-audio', resultFamily: 'audio', supportsLyria35: false },
  { value: 'flowmusic-video-clip', label: '音乐视频', action: 'video-clip', resultFamily: 'video', supportsLyria35: false },
] as const satisfies ReadonlyArray<{
  value: FlowMusicOperation;
  label: string;
  action: string;
  resultFamily: 'audio' | 'text' | 'file' | 'video';
  supportsLyria35: boolean;
}>;

export function getFlowMusicActionDef(value: unknown) {
  return FLOWMUSIC_ACTIONS.find((item) => item.value === value) || FLOWMUSIC_ACTIONS[0];
}

export const SEEDANCE_NZ_AUDIO_MODELS = [
  ...QWEN3_TTS_MODELS,
  ...MINIMAX_AUDIO_MODELS,
  ...MUREKA_BGM_MODELS,
  FLOWMUSIC_MODEL,
] as const;

export const DEFAULT_LLM_MODEL = 'gemini-3.5-flash';
export const CUSTOM_LLM_MODEL_VALUE = '__custom__';

export interface LlmModelSelectionInput {
  model?: unknown;
  customModel?: unknown;
  useCustomModel?: unknown;
}

export interface ResolvedLlmModelSelection {
  model: string;
  customModelInput: string;
  isCustom: boolean;
  presetValue: string;
}

/**
 * Resolve the persisted LLM node fields without forcing custom model names
 * through the preset registry. Unknown legacy model IDs are treated as custom,
 * so older canvases keep calling the exact model they saved.
 */
export function resolveLlmModelSelection(input: LlmModelSelectionInput): ResolvedLlmModelSelection {
  const storedModel = typeof input.model === 'string' ? input.model.trim() : '';
  const storedIsPreset = LLM_MODELS.some((item) => item.id === storedModel);
  const isCustom = input.useCustomModel === true || (!!storedModel && !storedIsPreset);
  const customModelInput = typeof input.customModel === 'string'
    ? input.customModel
    : (isCustom ? storedModel : '');
  const model = isCustom
    ? customModelInput.trim()
    : (storedIsPreset ? storedModel : DEFAULT_LLM_MODEL);
  return {
    model,
    customModelInput,
    isCustom,
    presetValue: isCustom ? CUSTOM_LLM_MODEL_VALUE : model,
  };
}

/** 是否为出图模型(需走非流式 + 检测 generate_image 指令) */
export function isImageOutputLlm(modelId: string): boolean {
  return LLM_MODELS.find((m) => m.id === modelId)?.imageOutput === true;
}
