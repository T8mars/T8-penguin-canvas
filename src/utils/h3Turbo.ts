import contract from '../../backend/src/shared/h3TurboContract.json';
import { createH3TurboContract } from '../../backend/src/shared/h3TurboContract.mjs';
export const H3_TURBO = createH3TurboContract(contract);
export function buildH3ImageRequest(model: string, prompt: string, images: string[], data: Record<string, any>) {
  const request = { model, prompt, images, resolution: data.sizeLevel ?? H3_TURBO.profile(model).defaultResolution,
    ratio: data.aspectRatio ?? '1:1', seed: data.h3TurboSeed ?? -1,
    ...(model === contract.minimax.model ? { output_format: data.h3TurboFormat ?? 'jpeg' } : {}) };
  H3_TURBO.build(request);
  return request as import('../services/generation').SeedreamNzSubmitRequest;
}
