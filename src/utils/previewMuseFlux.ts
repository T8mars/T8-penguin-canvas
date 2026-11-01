import contract from '../../backend/src/shared/previewMuseFluxContract.json';
import type { SeedreamNzSubmitRequest } from '../services/generation';
export const PREVIEW_MUSE_FLUX = contract;
export const isPreviewImage = (model: string) => [contract.hy.model, contract.muse.imageModel].includes(model);
export const isFluxVariant = (model: string) => contract.flux.models.includes(model);
export function previewImageSettings(data: Record<string, any>) {
  return { hyWidth: data.hyWidth ?? 1024, hyHeight: data.hyHeight ?? 1024,
    hySeed: data.hySeed ?? 0, hyNegativePrompt: data.hyNegativePrompt ?? '' };
}
export function fluxVariantSettings(data: Record<string, any>) {
  return { fluxImageGrounding: data.fluxImageGrounding ?? true, fluxImageSafetyTolerance: data.fluxImageSafetyTolerance ?? 2,
    fluxImageSeed: data.fluxImageSeed ?? 0, fluxImageSteps: data.fluxImageSteps ?? 0, fluxImageOutputFormat: data.fluxImageOutputFormat ?? 'api_default' };
}
export function buildPreviewImageRequest(model: string, prompt: string, images: string[], ratio: string, resolution: string, data: Record<string, any>): SeedreamNzSubmitRequest {
  const fail = (key: string): never => { throw new Error(`previewMuseFlux:${key}`); };
  if (!prompt.trim()) fail('promptRequired');
  const hy = model === contract.hy.model, flux = isFluxVariant(model), klein = model.includes('-klein-');
  if (!hy && !flux && model !== contract.muse.imageModel) fail('invalidModel');
  const spec = hy ? contract.hy : flux ? contract.flux : contract.muse;
  if (images.length > spec.maxImages) fail('imageCount');
  const request: SeedreamNzSubmitRequest = {model: model as SeedreamNzSubmitRequest['model'], prompt: prompt.trim(), ...(images.length ? { images: [...images] } : {})};
  if (!spec.ratios.includes(ratio)) fail('invalidRatio');
  if (flux) {
    if (model.endsWith('-t2i') && images.length || model.endsWith('-i2i') && !images.length) fail('fluxReferences');
    if (!contract.flux.resolutions.includes(resolution)) fail('invalidResolution');
    const settings = fluxVariantSettings(data);
    if (!Number.isInteger(settings.fluxImageSafetyTolerance) || settings.fluxImageSafetyTolerance < 0 || settings.fluxImageSafetyTolerance > 4) fail('invalidSafety');
    Object.assign(request, { resolution, aspect_ratio: ratio, safety_tolerance: settings.fluxImageSafetyTolerance });
    if (klein) {
      if (!Number.isSafeInteger(settings.fluxImageSeed) || settings.fluxImageSeed < 0 || settings.fluxImageSeed > 2147483647) fail('invalidSeed');
      if (!Number.isInteger(settings.fluxImageSteps) || settings.fluxImageSteps < 0 || settings.fluxImageSteps > 16) fail('invalidSteps');
      if (!['api_default','jpeg','png'].includes(settings.fluxImageOutputFormat)) fail('invalidFormat');
      request.seed = settings.fluxImageSeed;
      if (settings.fluxImageSteps) request.steps = settings.fluxImageSteps;
      if (settings.fluxImageOutputFormat !== 'api_default') request.output_format = settings.fluxImageOutputFormat;
    } else {
      if (typeof settings.fluxImageGrounding !== 'boolean') fail('invalidBoolean');
      request.grounding = settings.fluxImageGrounding;
    }
  } else {
    request.n = 1;
    if (hy) {
      if (!contract.hy.resolutions.includes(resolution)) fail('invalidResolution');
      request.resolution = resolution as '1K'|'2K'|'4K';
      const settings = previewImageSettings(data);
      if (!Number.isSafeInteger(settings.hySeed) || settings.hySeed < 0) fail('invalidSeed');
      request.seed = settings.hySeed;
      if (typeof settings.hyNegativePrompt !== 'string') fail('invalidPrompt');
      if (settings.hyNegativePrompt.trim()) request.negative_prompt = settings.hyNegativePrompt.trim();
      if (ratio === 'custom') {
        const { hyWidth: width, hyHeight: height } = settings;
        if (![width,height].every(v => Number.isSafeInteger(v) && v >= contract.hy.minEdge && v <= contract.hy.maxEdge) || width * height > contract.hy.maxPixels) fail('invalidPixels');
        Object.assign(request, {width,height});
      } else request.size = ratio;
    } else request.size = ratio;
  }
  return request;
}
