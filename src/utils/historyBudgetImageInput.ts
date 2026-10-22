import { ZHENZHEN_IMAGE_G25_MODELS, ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL, ZHENZHEN_IMAGE_G25_RESOLUTIONS,
  ZHENZHEN_IMAGE_G25_LOWPRICE_SIZES, ZHENZHEN_IMAGE_G25_OFFICIAL_SIZES, ZHENZHEN_IMAGE_G25_QUALITIES,
  ZHENZHEN_IMAGE_G25_OUTPUT_FORMATS, ZHENZHEN_IMAGE_G25_BACKGROUNDS, ZHENZHEN_IMAGE_G25_MODERATION,
  ZHENZHEN_IMAGE_G25_PROMPT_MAX_LENGTH, ZHENZHEN_IMAGE_G25_LOWPRICE_MAX_IMAGES,
  ZHENZHEN_IMAGE_G25_OFFICIAL_MAX_IMAGES, validateGptImage25Size } from '../providers/models';
import { historyImageBasicSettings } from './historyImageBasicSettings';
import { MAI_IMAGE_TAB, isMaiImageModel, buildMaiImageRequest } from './maiImage';
import { MOSS_IMAGE_CONTRACT, buildMossImageRequest } from './mossImage';

const baseKeys = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource', 'providerSource', 'providerId', 'providerModel',
  'zhenzhenImageG25Size', 'zhenzhenImageG25Resolution', 'zhenzhenImageG25Count'];
const officialKeys = ['zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight', 'zhenzhenImageG25Quality',
  'zhenzhenImageG25OutputFormat', 'zhenzhenImageG25OutputCompression', 'zhenzhenImageG25Background', 'zhenzhenImageG25Moderation'];

/** Read-only Image G 2.5 preparation. The draft caller separately verifies
 * scope, fixed assets and mention rebinding before confirmation/persistence. */
export function readHistoryBudgetImageInput(data: Record<string, unknown>) {
  const settings = historyImageBasicSettings(data);
  if (!settings) throw new Error('历史未记录完整图像输入，未套用当前默认值');
  if (settings.model === MOSS_IMAGE_CONTRACT.model) {
    const keys = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource', 'providerSource', 'providerId', 'providerModel'];
    const context = data.historyResolvedInput as { prompt: string; referenceImages: string[] };
    const invalid = () => new Error('历史 Moss 输入不完整或已不兼容，未套用当前默认值');
    if (settings.apiModel !== MOSS_IMAGE_CONTRACT.model || settings.imageBuiltinSource !== 'seedance-nz'
      || settings.providerSource !== 'zhenzhen' || settings.providerId !== '' || settings.providerModel !== ''
      || settings.sizeLevel !== '' || keys.some(key => !Object.hasOwn(settings, key))
      || context.referenceImages.some(url => !url.trim())) throw invalid();
    try { buildMossImageRequest(context.prompt, context.referenceImages, String(settings.aspectRatio)); } catch { throw invalid(); }
    return { settings: Object.fromEntries(keys.map(key => [key, settings[key]])), prompt: context.prompt,
      media: context.referenceImages.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })) };
  }
  if (settings.model === MAI_IMAGE_TAB) {
    const keys = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource', 'providerSource', 'providerId', 'providerModel',
      'maiSize', 'maiResolution', 'maiCustomRatio', 'maiWidth', 'maiHeight', 'maiAutoAspectRatio', 'maiWebGrounding'];
    const invalid = () => new Error('历史 Mai 输入不完整或已不兼容，未套用当前默认值');
    if (!isMaiImageModel(String(settings.apiModel)) || settings.imageBuiltinSource !== 'seedance-nz'
      || settings.providerSource !== 'zhenzhen' || settings.providerId !== '' || settings.providerModel !== ''
      || keys.some(key => !Object.hasOwn(settings, key))) throw invalid();
    const context = data.historyResolvedInput as { prompt: string; referenceImages: string[] };
    if (context.referenceImages.some(url => !url.trim())) throw invalid();
    try { buildMaiImageRequest(String(settings.apiModel), context.prompt, context.referenceImages, settings); }
    catch { throw invalid(); }
    return { settings: Object.fromEntries(keys.map(key => [key, settings[key]])), prompt: context.prompt,
      media: context.referenceImages.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })) };
  }
  if (settings.model !== 'gpt-image-2' || settings.imageBuiltinSource !== 'seedance-nz'
    || settings.providerSource !== 'zhenzhen' || settings.providerId !== '' || settings.providerModel !== ''
    || !(ZHENZHEN_IMAGE_G25_MODELS as readonly string[]).includes(String(settings.apiModel))) {
    throw new Error('此图像渠道尚未支持完整输入恢复');
  }
  const lowprice = settings.apiModel === ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL;
  const keys = [...baseKeys, ...(lowprice ? ['zhenzhenImageG25NsfwCheck'] : officialKeys)];
  const invalid = () => new Error('历史图像参数不完整或已不兼容，未套用当前默认值');
  const member = (key: string, values: readonly string[]) => values.includes(String(settings[key]));
  const integer = (key: string, min: number, max: number) => Number.isSafeInteger(settings[key])
    && Number(settings[key]) >= min && Number(settings[key]) <= max;
  if (keys.some(key => !Object.hasOwn(settings, key))
    || !member('zhenzhenImageG25Size', lowprice ? ZHENZHEN_IMAGE_G25_LOWPRICE_SIZES : ZHENZHEN_IMAGE_G25_OFFICIAL_SIZES)
    || !member('zhenzhenImageG25Resolution', ZHENZHEN_IMAGE_G25_RESOLUTIONS)
    || !integer('zhenzhenImageG25Count', 1, lowprice ? 1 : 4)) throw invalid();
  if (!lowprice && (!integer('zhenzhenImageG25CustomWidth', 16, 3840) || !integer('zhenzhenImageG25CustomHeight', 16, 3840)
    || !integer('zhenzhenImageG25OutputCompression', 0, 100)
    || !member('zhenzhenImageG25Quality', ZHENZHEN_IMAGE_G25_QUALITIES)
    || !member('zhenzhenImageG25OutputFormat', ZHENZHEN_IMAGE_G25_OUTPUT_FORMATS)
    || !member('zhenzhenImageG25Background', ZHENZHEN_IMAGE_G25_BACKGROUNDS)
    || !member('zhenzhenImageG25Moderation', ZHENZHEN_IMAGE_G25_MODERATION)
    || (settings.zhenzhenImageG25Background === 'transparent' && settings.zhenzhenImageG25OutputFormat === 'jpeg')
    || (settings.zhenzhenImageG25Size === 'custom'
      && validateGptImage25Size(`${settings.zhenzhenImageG25CustomWidth}x${settings.zhenzhenImageG25CustomHeight}`)))) throw invalid();
  const context = data.historyResolvedInput as { prompt: string; referenceImages: string[] };
  if (!context.prompt.trim() || (lowprice && context.prompt.length > ZHENZHEN_IMAGE_G25_PROMPT_MAX_LENGTH)
    || context.referenceImages.length > (lowprice ? ZHENZHEN_IMAGE_G25_LOWPRICE_MAX_IMAGES : ZHENZHEN_IMAGE_G25_OFFICIAL_MAX_IMAGES)
    || context.referenceImages.some(url => !url.trim())) throw invalid();
  // This node branch sends a closed submitSeedreamNz object, not providerParams.
  // Do not introduce raw unused overrides, runtime outputs, or old adjustments.
  return { settings: Object.fromEntries(keys.map(key => [key, settings[key]])), prompt: context.prompt,
    media: context.referenceImages.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })) };
}
