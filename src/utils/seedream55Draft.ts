import contract from '../../backend/src/shared/seedream55DraftContract.json';
import { createSeedream55DraftContract } from '../../backend/src/shared/seedream55DraftContract.mjs';
export const SEEDREAM55_DRAFT = createSeedream55DraftContract(contract);
export const SEEDREAM55_DRAFT_MODELS = contract;
export function buildSeedream55Request(model: string, prompt: string, images: string[], data: Record<string, any>, layer: boolean, translate?: (key: string) => string) {
  const resolution = layer ? data.seedreamLayerResolution || 'auto' : data.seedreamNzResolution || '2k';
  const request = { model, prompt, images, output_format: data.seedreamOutputFormat || 'png', ...seedream55Options(data, layer),
    ...(resolution === 'custom' ? { size: data.seedreamNzCustomSize || '2048x2048' } : { resolution }) };
  try { SEEDREAM55_DRAFT.buildImage(request); } catch (error: any) { if (translate) error.message = translate(`seedream55:errors.${error.code}`); throw error; }
  return request as import('../services/generation').SeedreamNzSubmitRequest;
}
export function seedream55Options(data: Record<string, any>, layer: boolean) {
  return { watermark: data.seedream55Watermark ?? false, safety_identifier: data.seedream55SafetyIdentifier ?? '',
    ...(layer ? { max_images: data.seedream55MaxImages ?? 30, text_recognition: data.seedream55TextRecognition ?? false } : { background: data.seedream55Background ?? 'auto' }) };
}
export function resolveSeedance25Draft(model: string, data: Record<string, any>, sources: { id: string; model: string }[]) {
  const unique = [...new Map(sources.map(source => [source.id, source])).values()];
  const candidates = unique.length ? unique : data.seedance25DraftTaskIdResult ? [{ id: data.seedance25DraftTaskIdResult, model: data.seedance25DraftSourceModel || '' }] : [];
  if (candidates.length > 1 || data.seedance25DraftTaskId && candidates[0] && data.seedance25DraftTaskId.trim() !== candidates[0].id) throw Object.assign(new Error('ambiguousDraft'), { code: 'ambiguousDraft' });
  if (candidates[0]?.model && candidates[0].model.includes('-global-') !== model.includes('-global-')) throw Object.assign(new Error('draftRegion'), { code: 'draftRegion' });
  return SEEDREAM55_DRAFT.draftId(data.seedance25DraftTaskId || candidates[0]?.id);
}
