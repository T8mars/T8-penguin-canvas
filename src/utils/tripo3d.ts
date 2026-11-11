import contract from '../../backend/src/shared/tripo3dContract.json';
import { createTripoContract } from '../../backend/src/shared/tripo3dContract.mjs';
import type { TripoRequest } from '../../backend/src/shared/tripo3dContract.mjs';
export const TRIPO = createTripoContract(contract);
export const TRIPO_CONTRACT = contract;
export function tripoValues(data: Record<string, any>) {
  return Object.fromEntries(Object.entries(TRIPO.fields).map(([field, spec]) => [field, field === 'prompt' ? data.prompt ?? '' : data[`tripo_${field}`] ?? spec.default]));
}
export function buildTripoRequest(model: string, images: string[], data: Record<string, any>, sources: { modelUrls: string[]; tripoTaskIds: string[] }, translate: (key: string, options?: any) => string) {
  const values = tripoValues(data), fields = TRIPO.activeFields(model, values, images.length);
  const error = (code: string, field = '') => { throw new Error(translate(`tripo:errors.${code}`, { field })); };
  if (sources.modelUrls.length > 1) error('ambiguousModel');
  if (fields.includes('model_url') && sources.modelUrls.length) {
    if (values.model_url && values.model_url !== sources.modelUrls[0]) error('ambiguousModel');
    values.model_url = sources.modelUrls[0];
  } else if (sources.modelUrls.length && !model.endsWith('mesh-complete')) error('unsupportedModelInput');
  if (fields.includes('tripo_segment_task_id') && sources.tripoTaskIds.length) {
    if (sources.tripoTaskIds.length !== 1 || values.tripo_segment_task_id && values.tripo_segment_task_id !== sources.tripoTaskIds[0]) error('ambiguousModel');
    values.tripo_segment_task_id = sources.tripoTaskIds[0];
  }
  const request: TripoRequest = { model, images: [...images], ...(fields.includes('prompt') ? { prompt: String(values.prompt) } : {}), metadata: Object.fromEntries(fields.filter(f => f !== 'prompt').map(f => [f, values[f]])) };
  try { TRIPO.build(request); } catch (e: any) { error(e.code || 'invalidValue', e.field); }
  return request;
}
