'use strict';
const contract = require('../shared/g26Krea3dContract.json');
const imageModels = [...contract.g26.models, ...contract.krea.models, contract.zimage.model];
const models3d = [...contract.hitem.models, ...contract.meshy.models];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const integer = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name}: ${min}–${max}`);
  return value;
};
const choice = (value, choices, name) => { if (!choices.includes(value)) fail(`Unsupported ${name}: ${value}`); return value; };
function sources(request) {
  const list = request.images ?? request.refImages ?? [];
  if (!Array.isArray(list) || list.some(v => typeof v !== 'string' || !v.trim())) fail('Invalid ordered image references');
  return [...list];
}
function staticSize(size) {
  if (contract.g26.sizes.filter(v => v !== 'custom').includes(size)) return size;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) fail('Unsupported image size');
  const [width, height] = match.slice(1).map(Number);
  for (const v of [width, height]) if (!Number.isInteger(v) || v < 16 || v > 3840 || v % 16) fail('Canvas dimensions must be multiples of 16, at most 3840');
  if (width * height < 655360 || width * height > 8294400 || Math.max(width,height) > Math.min(width,height) * 3) fail('Canvas area/aspect ratio exceeds documented limits');
  return size;
}
function gifSize(size, count) {
  if (size === 'auto') return size;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) fail('GIF size must be auto or exact pixels');
  const [w,h] = match.slice(1).map(Number);
  if ([w,h].some(v => !Number.isInteger(v) || v < 16 || v > 3840 || v % 16)) fail('GIF dimensions must be positive multiples of 16');
  const [columns,rows] = count <= 8 ? [4,2] : count === 9 ? [3,3] : count <= 12 ? [4,3] : [4,4];
  if (![[columns,rows],[rows,columns]].some(([c,r]) => Math.max(w*c,h*r) <= 3840 && w*h*c*r <= 8294400 && Math.max(w*c,h*r) <= Math.min(w*c,h*r)*3)) fail('GIF contact sheet exceeds documented limits');
  return size;
}
function buildImage(request) {
  const model = request.model;
  if (!imageModels.includes(model)) fail('Unsupported image model');
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) fail('Prompt is required');
  const refs = sources(request), payload = { model, prompt: request.prompt.trim() };
  let maxReferenceBytes = 50 * 1024 * 1024;
  if (contract.g26.models.includes(model)) {
    const lowprice = model === contract.g26.models[0], mode = choice(request.output_mode ?? 'image', lowprice ? ['image','gif'] : ['image','gif','svg'], 'output mode');
    if (!lowprice && payload.prompt.length > contract.g26.maxOfficialPrompt) fail('Official G2.6 prompt exceeds 32000 characters');
    if (refs.length > (lowprice ? contract.g26.lowpriceMaxReferences : 16) || mode !== 'image' && refs.length) fail('Incorrect G2.6 reference count; GIF/SVG are text-only');
    if (lowprice) {
      payload.n = 1;
      if (request.n !== undefined && request.n !== 1) fail('LowPrice requires n=1');
      if (mode === 'gif') {
        payload.size = 'auto'; payload.output_format = 'gif';
      } else {
        payload.resolution = choice(request.resolution ?? '1k', contract.g26.resolutions, 'resolution');
        payload.size = choice(request.size ?? '1:1', contract.g26.sizes.filter(v => v !== 'custom'), 'size');
        payload.quality = choice(request.quality ?? 'auto', contract.g26.qualities, 'quality');
        payload.output_format = choice(request.output_format ?? 'png', contract.g26.formats, 'output format');
      }
    } else {
      payload.n = mode === 'image' ? integer(request.n ?? 1,1,4,'n') : 1;
      if (mode !== 'image' && request.n !== undefined && request.n !== 1) fail('GIF/SVG require n=1');
      if (mode === 'gif') {
        if (request.mask_url || request.markup_url || request.output_compression !== undefined) fail('GIF does not accept mask, markup or compression');
        payload.frame_count = integer(request.frame_count ?? 9,2,16,'frame_count');
        payload.frame_duration_ms = integer(request.frame_duration_ms ?? 200,20,Number.MAX_SAFE_INTEGER,'frame_duration_ms');
        if (payload.frame_duration_ms % 10) fail('Frame duration must be a multiple of 10 ms');
        payload.size = gifSize(request.size ?? '512x512',payload.frame_count); payload.output_format = 'gif';
      } else {
        payload.size = staticSize(request.size ?? 'auto');
        if (mode === 'svg') {
          if (request.mask_url || request.markup_url || request.output_compression !== undefined) fail('SVG is text-only and does not support compression');
          payload.output_format = 'svg'; payload.svg = { model: 'gpt-5.4-mini' };
        } else {
          payload.output_format = choice(request.output_format ?? 'png',contract.g26.formats,'output format');
          if (!/^\d+x\d+$/.test(payload.size)) payload.resolution = choice(request.resolution ?? '1k',contract.g26.resolutions,'resolution');
          payload.quality = choice(request.quality ?? 'auto',contract.g26.qualities,'quality');
          const complexity = choice(request.complexity ?? 'api_default',contract.g26.complexities,'complexity');
          if (complexity !== 'api_default') payload.complexity = complexity;
          if (request.output_compression !== undefined) {
            if (!['jpeg','webp'].includes(payload.output_format)) fail('Compression requires jpeg/webp');
            payload.output_compression = integer(request.output_compression,0,100,'output_compression');
          }
          if (request.mask_url && request.markup_url || (request.mask_url || request.markup_url) && !refs.length) fail('Mask/markup require image1 and are mutually exclusive');
          for (const field of ['mask_url','markup_url']) if (request[field]) {
            let url; try { url = new URL(request[field]); } catch { fail('Mask/markup must be HTTP(S) URLs'); }
            if (!['http:','https:'].includes(url.protocol) || url.username || url.password) fail('Invalid mask/markup URL');
            payload[field] = url.href;
          }
        }
      }
    }
  } else if (contract.krea.models.includes(model)) {
    if (refs.length > 8 || model.endsWith('-t2i') && refs.length || model.endsWith('-i2i') && !refs.length) fail('Krea T2I rejects references; I2I requires 1–8');
    const match = /^(\d+)\*(\d+)$/.exec(request.size ?? '1024*1024');
    if (!match) fail('Krea size requires WIDTH*HEIGHT');
    const [w,h] = match.slice(1).map(Number);
    integer(w,256,4096,'width'); integer(h,256,4096,'height'); if (w*h > contract.krea.maxPixels) fail('Krea size exceeds 4220000 pixels');
    payload.size = `${w}*${h}`; payload.output_format = choice(request.output_format ?? 'png',contract.krea.formats,'output format');
    payload.metadata = { model_variant: choice(request.model_variant ?? request.metadata?.model_variant ?? 'berry',contract.krea.variants,'model_variant'), reasoning_level: choice(request.reasoning_level ?? request.metadata?.reasoning_level ?? 'low',contract.krea.reasoning,'reasoning_level') };
    if (request.seed !== undefined && request.seed !== -1) payload.seed = integer(request.seed,0,2147483647,'seed');
    if (request.negative_prompt !== undefined && typeof request.negative_prompt !== 'string') fail('Negative prompt must be text');
    if (request.negative_prompt?.trim()) payload.negative_prompt = request.negative_prompt.trim();
    maxReferenceBytes = contract.krea.maxReferenceBytes;
  } else {
    if (refs.length) fail('Z-image does not accept references');
    payload.metadata = { ratio: choice(request.ratio ?? request.metadata?.ratio ?? '1:1',contract.zimage.ratios,'ratio') };
    const seed=request.seed??request.metadata?.seed;
    if (seed !== undefined && seed !== -1) payload.metadata.seed = integer(seed,0,Number.MAX_SAFE_INTEGER,'seed');
  }
  return { payload, sources: refs, maxReferenceBytes, model, taskType: refs.length ? 'i2i' : 't2i' };
}
function build3d(request) {
  const model = request.model;
  if (!models3d.includes(model)) fail('Unsupported 3D model');
  const refs = sources(request), multi = model.includes('multi-image'), text = model === contract.meshy.textModel;
  if (text ? refs.length !== 0 : multi ? refs.length < 2 || refs.length > 4 : refs.length !== 1) fail(text ? 'Meshy text-to-3D does not accept reference images' : '3D requires exactly one image, or 2–4 front/back/left/right images for multi-view models');
  const payload = { model };
  if (contract.hitem.models.includes(model)) {
    payload.request_type = choice(request.request_type ?? 'both',contract.hitem.requestTypes,'request_type');
    payload.resolution = choice(request.resolution ?? (model.includes('portrait') ? '1536pro' : '1536'),model.includes('portrait') ? ['1536pro'] : contract.hitem.resolutions,'resolution');
    payload.face = integer(request.face ?? 1000000,100000,2000000,'face');
  } else {
    if (text) {
      if (typeof request.prompt !== 'string' || !request.prompt.trim() || [...request.prompt.trim()].length > contract.meshy.maxPromptCharacters) fail('Meshy prompt requires 1–600 characters');
      payload.prompt = request.prompt.trim();
      if (request.art_style !== undefined && request.art_style !== 'api_default') payload.art_style = choice(request.art_style,contract.meshy.artStyles,'art_style');
      if (request.enable_prompt_expansion !== undefined && request.enable_prompt_expansion !== 'api_default') {
        if (typeof request.enable_prompt_expansion !== 'boolean') fail('enable_prompt_expansion must be boolean');
        payload.enable_prompt_expansion = request.enable_prompt_expansion;
      }
    }
    for (const [field,choices] of [['topology',contract.meshy.topologies],['symmetry_mode',contract.meshy.symmetries]]) if (request[field] !== undefined && request[field] !== 'api_default') payload[field] = choice(request[field],choices,field);
    if (request.target_polycount !== undefined && request.target_polycount !== 0) payload.target_polycount = integer(request.target_polycount,100,300000,'target_polycount');
    for (const field of contract.meshy.booleans) if (request[field] !== undefined && request[field] !== 'api_default') {
      if (text && field === 'should_texture') continue;
      if (typeof request[field] !== 'boolean') fail(`${field} must be boolean`); payload[field] = request[field];
    }
  }
  return { payload, sources: refs, maxReferenceBytes: 50*1024*1024, model, taskType: text ? 't3d' : 'i3d' };
}
module.exports = { contract, imageModels, models3d, buildImage, build3d, staticSize, gifSize };
