import contract from '../../backend/src/shared/maiImageContract.json';
import type { SeedreamNzSubmitRequest } from '../services/generation';

export const MAI_IMAGE_CONTRACT = contract;
export const MAI_IMAGE_TAB = contract.models[0];
export const isMaiImageModel = (model: string) => contract.models.includes(model);
export function maiImageSettings(data: Record<string, any>) {
  return {
    maiSize: data.maiSize ?? contract.defaultSize,
    maiResolution: data.maiResolution ?? contract.defaultResolution,
    maiCustomRatio: data.maiCustomRatio ?? '16:9',
    maiWidth: data.maiWidth ?? 1536,
    maiHeight: data.maiHeight ?? 1024,
    maiAutoAspectRatio: data.maiAutoAspectRatio ?? false,
    maiWebGrounding: data.maiWebGrounding ?? false,
  };
}
export function buildMaiImageRequest(model: string, prompt: string, images: string[], data: Record<string, any>): SeedreamNzSubmitRequest {
  const fail = (key: string): never => { throw new Error(`nodes:generation.mai.${key}`); };
  if (!isMaiImageModel(model)) fail('invalidModel');
  if (!prompt.trim()) fail('promptRequired');
  if (images.length > contract.maxImages) fail('tooManyImages');
  const settings = maiImageSettings(data);
  if (typeof settings.maiWebGrounding !== 'boolean') fail('invalidBoolean');
  const request: SeedreamNzSubmitRequest = { model: model as 'mai-image-2-6' | 'mai-image-2-6-flash',
    prompt: prompt.trim(), n: 1, web_grounding: settings.maiWebGrounding };
  // Reference editing ignores every text-generation sizing control, even stale values.
  if (images.length) return { ...request, images: [...images] };
  if (typeof settings.maiAutoAspectRatio !== 'boolean') fail('invalidBoolean');
  const pixels = !settings.maiAutoAspectRatio && settings.maiSize === 'custom_pixels';
  if (pixels) {
    const { maiWidth: width, maiHeight: height } = settings;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Math.min(width, height) < contract.minEdge
      || width * height > contract.maxPixels) fail('invalidPixels');
    return { ...request, width: Math.floor(width / contract.pixelStep) * contract.pixelStep,
      height: Math.floor(height / contract.pixelStep) * contract.pixelStep };
  }
  const resolution = String(settings.maiResolution).toLowerCase();
  if (!contract.resolutions.includes(resolution)) fail('invalidResolution');
  const size = settings.maiAutoAspectRatio ? 'auto'
    : String(settings.maiSize === 'custom_ratio' ? settings.maiCustomRatio : settings.maiSize).trim();
  if (size !== 'auto') {
    const match = /^(\d+):(\d+)$/.exec(size);
    if (!match) fail('invalidRatio');
    const width = Number(match![1]), height = Number(match![2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Math.min(width, height) < 1
      || width > height * contract.maxAspectRatio || height > width * contract.maxAspectRatio) fail('invalidRatio');
  }
  return { ...request, size, resolution: resolution as '1k' | '2k', auto_aspect_ratio: settings.maiAutoAspectRatio };
}
