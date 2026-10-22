import contract from '../../backend/src/shared/mossImageContract.json';
import type { SeedreamNzSubmitRequest } from '../services/generation';

export const MOSS_IMAGE_CONTRACT = contract;
export function buildMossImageRequest(prompt: string, images: string[], ratio: string = contract.defaultRatio): SeedreamNzSubmitRequest {
  const fail = (key: string): never => { throw new Error(`nodes:generation.moss.${key}`); };
  if (!prompt.trim()) fail('promptRequired');
  if (images.length > contract.maxImages) fail('tooManyImages');
  if (!contract.ratios.includes(ratio)) fail('invalidRatio');
  return { model: 'moss-image', prompt: prompt.trim(), ratio: ratio as SeedreamNzSubmitRequest['ratio'],
    ...(images.length ? { images: [...images] } : {}) };
}
