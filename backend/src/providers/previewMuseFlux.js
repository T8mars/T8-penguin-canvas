'use strict';
const contract = require('../shared/previewMuseFluxContract.json');
const imageModels = [contract.hy.model, contract.muse.imageModel, ...contract.flux.models];
const fail = message => { throw new Error(message); };
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}: ${min}–${max}`);
  return value;
}
function buildPreviewMuseFluxPayload(request) {
  const model = request.model;
  if (![...imageModels, contract.muse.videoModel].includes(model)) fail('Unknown preview/Muse/Flux model');
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) fail('Prompt is required');
  const images = request.images ?? request.refImages ?? [];
  if (!Array.isArray(images) || images.some(value => typeof value !== 'string' || !value.trim())) fail('Invalid reference images');
  if ((request.videos?.length || request.audios?.length)) fail('This model accepts image references only');
  const hy = model === contract.hy.model, flux = contract.flux.models.includes(model), klein = model.includes('-klein-');
  const spec = hy ? contract.hy : flux ? contract.flux : contract.muse;
  if (images.length > spec.maxImages) fail(`At most ${spec.maxImages} reference images`);
  if (flux && (model.endsWith('-t2i') ? images.length !== 0 : images.length < 1)) fail('FLUX T2I accepts no images; I2I requires 1–10 images');
  const payload = { model, prompt: request.prompt.trim() };
  if (flux) {
    const resolution = request.resolution ?? '1k';
    const ratio = request.aspect_ratio ?? request.ratio ?? 'auto';
    if (!spec.resolutions.includes(resolution) || !spec.ratios.includes(ratio)) fail('Invalid Flux resolution/ratio');
    Object.assign(payload, { resolution, aspect_ratio: ratio, safety_tolerance: integer(request.safety_tolerance ?? 2, 0, 4, 'safety_tolerance') });
    if (request.n !== undefined) fail('FLUX variants do not support n');
    if (klein) {
      payload.seed = integer(request.seed ?? 0, 0, 2147483647, 'seed');
      const steps = request.steps ?? request.metadata?.steps ?? 0;
      integer(steps, 0, 16, 'steps');
      if (steps) payload.metadata = { steps };
      const format = request.output_format ?? 'api_default';
      if (!['api_default', 'jpeg', 'png'].includes(format)) fail('Invalid output_format');
      if (format !== 'api_default') payload.output_format = format;
    } else {
      if (typeof (request.grounding ?? true) !== 'boolean') fail('grounding must be boolean');
      payload.grounding = request.grounding ?? true;
    }
  } else {
    if (request.n !== undefined && request.n !== 1) fail('n must be 1');
    payload.n = 1;
    const size = request.size ?? request.ratio ?? 'auto';
    if (!spec.ratios.filter(v => v !== 'custom').includes(size) && !(hy && /^\d+x\d+$/.test(size))) fail('Invalid size');
    payload.size = size;
    if (hy) {
      const resolution = String(request.resolution ?? '1K').toUpperCase();
      if (!spec.resolutions.includes(resolution)) fail('Invalid HY resolution');
      payload.resolution = resolution;
      payload.seed = integer(request.seed ?? 0, 0, Number.MAX_SAFE_INTEGER, 'seed');
      const validatePixels = (width, height) => {
        integer(width, spec.minEdge, spec.maxEdge, 'width'); integer(height, spec.minEdge, spec.maxEdge, 'height');
        if (width * height > spec.maxPixels) fail('HY exceeds 8,294,400 pixels');
      };
      if (/^\d+x\d+$/.test(size)) validatePixels(...size.split('x').map(Number));
      if (request.width !== undefined || request.height !== undefined) {
        validatePixels(request.width, request.height); Object.assign(payload, { width: request.width, height: request.height });
      }
      if (request.negative_prompt !== undefined && typeof request.negative_prompt !== 'string') fail('negative_prompt must be text');
      if (request.negative_prompt?.trim()) payload.negative_prompt = request.negative_prompt.trim();
    } else {
      if (request.aspect_ratio !== undefined) {
        if (!spec.ratios.slice(1).includes(request.aspect_ratio)) fail('Invalid Muse aspect_ratio');
        payload.aspect_ratio = request.aspect_ratio;
      }
      if (model === contract.muse.videoModel) {
        if ((request.duration !== undefined && request.duration !== 10) || (request.resolution !== undefined && request.resolution !== '720p')
          || (request.audio !== undefined && request.audio !== true)) fail('Muse Video requires 10 seconds, 720p and audio');
        Object.assign(payload, { duration: 10, resolution: '720p', audio: true });
      }
    }
  }
  return { payload, model, sources: [...images], taskType: images.length ? (model === contract.muse.videoModel ? 'i2v' : 'i2i') : model === contract.muse.videoModel ? 't2v' : 't2i' };
}
module.exports = { contract, imageModels, buildPreviewMuseFluxPayload };
