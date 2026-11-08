import contract from '../../backend/src/shared/flashVideoContract.json';
export const FLASH_VIDEO_CONTRACT = contract;
export const KLING_FLASH_MODEL = 'zhenzhen-video-kling-v4-flash';
export const OMNI12_FLASH_MODEL = 'zhenzhen-video-g-omni-1.2-flash-lowprice';
export function flashVideoProfile(model: string) {
  return Object.hasOwn(contract.models, model) ? contract.models[model as keyof typeof contract.models] : undefined;
}
export function validFlashVideoReferences(model: string, images: string[], videos: string[], audios: string[]) {
  const profile = flashVideoProfile(model);
  return Boolean(profile && images.length <= profile.maxImages && videos.length <= profile.maxVideos
    && !(images.length && videos.length) && !audios.length);
}
