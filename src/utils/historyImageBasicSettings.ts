import contract from '../../backend/src/shared/generationHistoryInputContract.json';

// v1 recorded common prompt/references only. v2 also records the frontend's
// selected basic values. Neither is a full branch-specific Provider payload.
const required = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource',
  'providerSource', 'providerId', 'providerModel'] as const;
const optional = ['seedreamApiSource'] as const;
export const IMAGE_HISTORY_EXTRA_FIELDS: Record<string, { label: string; type: 'string' | 'number' | 'boolean' }> = {
  fluxImageGrounding: { label: 'FLUX grounding', type: 'boolean' },
  fluxImageSafetyTolerance: { label: 'FLUX safety_tolerance', type: 'number' },
  mjVersion: { label: 'MJ 版本', type: 'string' }, mjAr: { label: 'MJ 比例', type: 'string' },
  mjSpeed: { label: 'MJ 速度', type: 'string' }, mjC: { label: 'MJ 混乱度', type: 'number' },
  mjS: { label: 'MJ 风格化', type: 'number' }, mjIw: { label: 'MJ 图像权重', type: 'number' },
  mjSw: { label: 'MJ 风格权重', type: 'number' }, mjSv: { label: 'MJ 风格参考版本', type: 'string' },
  mjNo: { label: 'MJ 排除内容', type: 'string' }, mjSeed: { label: 'MJ 种子设置', type: 'number' },
  mjMaxPoll: { label: 'MJ 最大轮询次数设置', type: 'number' }, mjPollInt: { label: 'MJ 轮询间隔设置', type: 'number' },
  gptImageQuality: { label: '图像质量', type: 'string' }, gptImageModeration: { label: '内容审核', type: 'string' },
  gptImage25Size: { label: '图像规格', type: 'string' }, gptImage25CustomWidth: { label: '自定义宽度', type: 'number' },
  gptImage25CustomHeight: { label: '自定义高度', type: 'number' }, gptImage25Count: { label: '生成数量', type: 'number' },
  gptImage25Background: { label: '背景', type: 'string' }, seedreamCustomSize: { label: 'Seedream 自定义尺寸', type: 'string' },
  seedreamOutputFormat: { label: 'Seedream 输出格式', type: 'string' },
  falN: { label: 'FAL 生成数量', type: 'number' }, falFormat: { label: 'FAL 输出格式', type: 'string' },
  falSync: { label: 'FAL 同步模式', type: 'boolean' }, falMode: { label: 'FAL 生成模式', type: 'string' },
  falSize: { label: 'FAL 图像规格', type: 'string' }, falCustomW: { label: 'FAL 自定义宽度', type: 'number' },
  falCustomH: { label: 'FAL 自定义高度', type: 'number' }, falQuality: { label: 'FAL 图像质量', type: 'string' },
  nbAspect: { label: 'FAL 香蕉比例', type: 'string' }, nbResolution: { label: 'FAL 香蕉分辨率', type: 'string' },
  nbSafety: { label: 'FAL 安全容忍度', type: 'string' }, nbImgMode: { label: 'FAL 图像传输方式', type: 'string' },
  nbWebSearch: { label: 'FAL 联网搜索', type: 'boolean' }, nbSysPrompt: { label: 'FAL 系统提示词', type: 'string' },
  nbSeed: { label: 'FAL 种子设置', type: 'number' },
  zhenzhenImageG25Size: { label: 'Image G 2.5 图像规格', type: 'string' },
  zhenzhenImageG25Resolution: { label: 'Image G 2.5 分辨率', type: 'string' },
  zhenzhenImageG25Count: { label: 'Image G 2.5 数量', type: 'number' },
  zhenzhenImageG25NsfwCheck: { label: 'Image G 2.5 内容检查', type: 'boolean' },
  zhenzhenImageG25CustomWidth: { label: 'Image G 2.5 自定义宽度', type: 'number' },
  zhenzhenImageG25CustomHeight: { label: 'Image G 2.5 自定义高度', type: 'number' },
  zhenzhenImageG25Quality: { label: 'Image G 2.5 质量', type: 'string' },
  zhenzhenImageG25OutputFormat: { label: 'Image G 2.5 输出格式', type: 'string' },
  zhenzhenImageG25OutputCompression: { label: 'Image G 2.5 压缩质量', type: 'number' },
  zhenzhenImageG25Background: { label: 'Image G 2.5 背景', type: 'string' },
  zhenzhenImageG25Moderation: { label: 'Image G 2.5 审核', type: 'string' },
  grokV2ImageCount: { label: 'Grok V2 数量', type: 'number' }, grokV2EditResolution: { label: 'Grok V2 编辑分辨率', type: 'string' },
  grokV2EditNsfwCheck: { label: 'Grok V2 内容检查', type: 'boolean' }, apimartImageCount: { label: '香蕉生成数量', type: 'number' },
  qwenSizingMode: { label: 'Qwen 尺寸模式', type: 'string' }, qwenResolution: { label: 'Qwen 分辨率', type: 'string' },
  qwenCustomSize: { label: 'Qwen 自定义尺寸', type: 'string' }, qwenImageCount: { label: 'Qwen 数量', type: 'number' },
  qwenSeed: { label: 'Qwen 种子设置', type: 'number' }, qwenNegativePrompt: { label: 'Qwen 负面提示词', type: 'string' },
  qwenPromptExtend: { label: 'Qwen 提示词扩展', type: 'boolean' },
  wanImageWidth: { label: 'Wan 图像宽度', type: 'number' }, wanImageHeight: { label: 'Wan 图像高度', type: 'number' },
  wanImageThinkingMode: { label: 'Wan 思考模式', type: 'boolean' }, seedreamLayerResolution: { label: 'Seedream 分层分辨率', type: 'string' },
  seedreamNzModelFamily: { label: 'Seedream 模型区域', type: 'string' }, seedreamNzResolution: { label: 'Seedream 分辨率', type: 'string' },
  seedreamNzCustomSize: { label: 'Seedream 平价渠道自定义尺寸', type: 'string' },
};
const allowed = new Set<string>([...required, ...optional, ...Object.keys(IMAGE_HISTORY_EXTRA_FIELDS)]);
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
export function historyImageBasicSettings(data: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  const input = data.historyResolvedInput;
  if (input === undefined) return undefined;
  const invalid = () => new Error('历史实际输入版本或字段不完整，未套用当前默认值');
  if (!plain(input) || input.origin !== 'frontend-common-context' || typeof input.prompt !== 'string'
    || !Array.isArray(input.referenceImages) || input.referenceImages.some(value => typeof value !== 'string')) throw invalid();
  if (input.schema === contract.imageInputContextSchema) return undefined;
  if (input.schema !== contract.imageSettingsContextSchema || !plain(input.basicSettings)) throw invalid();
  const settings = input.basicSettings;
  if (required.some(key => !Object.hasOwn(settings, key) || typeof settings[key] !== 'string')
    || Object.keys(settings).some(key => !allowed.has(key)
      || typeof settings[key] !== (IMAGE_HISTORY_EXTRA_FIELDS[key]?.type || 'string')
      || (typeof settings[key] === 'number' && !Number.isFinite(settings[key])))
    || !['zhenzhen', 'seedance-nz'].includes(settings.imageBuiltinSource as string)
    || (Object.hasOwn(settings, 'fluxImageSafetyTolerance') && ![0, 1, 2, 3, 4].includes(settings.fluxImageSafetyTolerance as number))
    || (Object.hasOwn(settings, 'seedreamApiSource') && !['zhenzhen', 'seedance-nz'].includes(settings.seedreamApiSource as string))
    || (settings.providerSource !== 'zhenzhen' && (!settings.providerSource || !settings.providerId || !settings.providerModel))) throw invalid();
  return { ...settings } as Record<string, string | number | boolean>;
}
