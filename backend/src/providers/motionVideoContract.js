'use strict';

const crypto = require('node:crypto');
const contract = require('../shared/motionVideoContract.json');
const models = new Set(contract.models);
const templates = new Set(contract.templates.map(item => item.id));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function motionError(message, code = 'MOTION_INVALID_INPUT', status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function text(value, field, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw motionError(`${field} 必须为文本`);
  const trimmed = value.trim();
  if (required && !trimmed) throw motionError(`${field} 不能为空`);
  return trimmed;
}
function motionHttpUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}
function stringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw motionError(`${field} 必须为非空文本列表`);
  return value.map(item => item.trim());
}

// Only the documented fields cross the provider boundary. UI state never becomes API parameters.
function buildMotionVideoPayload(request = {}) {
  if (!object(request)) throw motionError('代码动画参数必须为对象');
  const model = request.model ?? contract.defaults.model;
  const operation = request.operation ?? 'generate';
  if (!models.has(model)) throw motionError('不支持的代码动画模型');
  if (!['generate', 'revise'].includes(operation)) throw motionError('不支持的代码动画操作');
  const payload = { model, prompt: text(request.prompt, 'prompt', true) };
  for (const [field, values] of [['duration', contract.durations], ['ratio', contract.ratios], ['resolution', contract.resolutions]]) {
    const value = request[field] ?? contract.defaults[field];
    if (!values.includes(value) || (field === 'duration' && !Number.isInteger(value))) throw motionError(`${field} 选项无效`);
    payload[field] = value;
  }
  if (request.motion !== undefined && !object(request.motion)) throw motionError('motion 必须为对象');
  const input = request.motion || {};
  const motion = {};
  for (const field of contract.textFields) {
    const value = text(input[field], field);
    if (value) motion[field] = value;
  }
  const template = text(input.template_id, 'template_id');
  if (template && template !== 'api_default') {
    if (!templates.has(template)) throw motionError('template_id 选项无效');
    motion.template_id = template;
  }
  const music = text(input.music, 'music');
  if (music && music !== 'api_default') {
    if (!contract.music.includes(music)) throw motionError('music 选项无效');
    motion.music = music;
  }
  const keywords = stringList(input.keywords, 'keywords');
  const assets = stringList(input.assets, 'assets');
  if (assets.length > contract.maxAssets || assets.some(value => !motionHttpUrl(value))) throw motionError('参考图片需要最多4个持久公开HTTP(S)图片直链');
  if (keywords.length) motion.keywords = keywords;
  if (assets.length) motion.assets = assets;
  if (operation === 'revise') {
    motion.revise_from = text(input.revise_from, 'revise_from', true);
    motion.revision_instruction = text(input.revision_instruction, 'revision_instruction', true);
  }
  if (Object.keys(motion).length) payload.motion = motion;
  return { model, operation, payload };
}

// Local display/storage budgets, not provider limits. Optional metadata can never invalidate a valid MP4.
function sanitizeMotionMetadata(value, secrets = []) {
  const warnings = new Set();
  let entries = 0;
  const clean = (input, depth = 0) => {
    if (++entries > 4096 || depth > 10) { warnings.add('metadata_truncated'); return null; }
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'string') {
      let output = input;
      for (const secret of secrets.filter(Boolean)) output = output.split(secret).join('[redacted]');
      output = output.replace(/\b(?:Bearer\s+[^\s"']+|sk-[A-Za-z0-9_-]{16,})/gi, '[redacted]').replace(/https?:\/\/[^\s"'<>]+/gi, '[remote-url]');
      if (output.length > 16000) { warnings.add('metadata_truncated'); output = output.slice(0, 16000); }
      return output;
    }
    if (Array.isArray(input)) {
      if (input.length > 256) warnings.add('metadata_truncated');
      return input.slice(0, 256).map(item => clean(item, depth + 1));
    }
    if (object(input)) {
      const output = Object.create(null);
      const pairs = Object.entries(input);
      if (pairs.length > 100) warnings.add('metadata_truncated');
      for (const [key, item] of pairs.slice(0, 100)) {
        if (/__proto__|constructor|prototype|api.?key|authorization|cookie|secret|credential|token|signature.*url/i.test(key)) continue;
        if (key.length > 160) { warnings.add('metadata_truncated'); continue; }
        output[key] = clean(item, depth + 1);
      }
      return output;
    }
    warnings.add('metadata_invalid'); return null;
  };
  let data = clean(value);
  if (Buffer.byteLength(JSON.stringify(data ?? null)) > 256 * 1024) { data = null; warnings.add('metadata_truncated'); }
  return { data, warnings: [...warnings] };
}
function stateOf(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['success', 'succeeded', 'completed'].includes(status)) return 'succeeded';
  if (['failure', 'failed', 'canceled', 'cancelled'].includes(status)) return 'failed';
  return 'pending';
}
function normalizeMotionVideoResponse(response, options = {}) {
  const containers = []; let current = response;
  for (let depth = 0; depth < 5 && object(current); depth++, current = current.data) containers.push(current);
  const records = containers.filter(item => typeof item.status === 'string' && item.status.trim());
  const states = records.map(item => stateOf(item.status));
  const status = states.includes('failed') ? 'failed' : states.length && states.every(item => item === 'succeeded') ? 'succeeded' : 'pending';
  const record = containers.findLast(item => object(item.content)) || containers.at(-1) || {};
  const model = containers.findLast(item => typeof item.model === 'string' && item.model.trim())?.model || '';
  if (status === 'succeeded' && (!models.has(model) || options.model && model !== options.model)) throw motionError('代码动画返回的模型身份不一致，请继续查询原任务', 'MOTION_MODEL_MISMATCH', 502);
  const content = object(record.content) ? record.content : {};
  const rawUrls = Array.isArray(content.video_urls) && content.video_urls.length ? content.video_urls : [content.video_url];
  const videoUrls = status === 'succeeded' ? rawUrls.filter(motionHttpUrl) : [];
  if (status === 'succeeded' && (!videoUrls.length || videoUrls.length !== rawUrls.length)) throw motionError('视频已生成但缺少有效结果地址，请继续查询原任务', 'MOTION_OUTPUT_MISSING', 502);
  const metadata = sanitizeMotionMetadata({ storyboard: record.storyboard ?? content.storyboard ?? null, fallbackScenes: record.fallback_scenes ?? content.fallback_scenes ?? [] }, options.secrets);
  const warnings = [...metadata.warnings];
  const clean = metadata.data || {};
  if (clean.storyboard !== null && !object(clean.storyboard)) warnings.push('storyboard_invalid');
  if (!Array.isArray(clean.fallbackScenes)) warnings.push('fallback_invalid');
  const rawStage = String(records.at(-1)?.status || '').toLowerCase();
  const stage = contract.stages.includes(rawStage) ? rawStage : status === 'pending' ? ['queued', 'not_start', 'submitted'].includes(rawStage) ? 'queued' : 'running' : status;
  const rawProgress = [...containers].reverse().find(item => typeof item.progress === 'number')?.progress;
  const rawFailure = records.find(item => stateOf(item.status) === 'failed');
  const failReason = status === 'failed' ? sanitizeMotionMetadata(String(rawFailure?.fail_reason || rawFailure?.error?.message || '代码动画生成失败'), options.secrets).data : null;
  const attachment = field => motionHttpUrl(record[field] || content[field]) ? record[field] || content[field] : null;
  return {
    status, stage, model: model || options.model || null,
    progress: Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : null,
    videoUrl: videoUrls[0] || null, videoUrls, failReason,
    coverUrl: attachment('cover_url'), previewUrl: attachment('preview_url'), htmlPreviewUrl: attachment('html_preview_url'), subtitleUrl: attachment('subtitle_url'),
    motionResult: { schema: contract.resultSchema, storyboard: object(clean.storyboard) ? clean.storyboard : null, fallbackScenes: Array.isArray(clean.fallbackScenes) ? clean.fallbackScenes : [], warnings: [...new Set(warnings)] },
  };
}
function motionConnectionRef(apiKey) {
  if (!String(apiKey || '').trim()) return '';
  return 'seedance-nz:' + crypto.createHash('sha256').update(String(apiKey).trim()).digest('hex');
}
module.exports = { contract, buildMotionVideoPayload, normalizeMotionVideoResponse, sanitizeMotionMetadata, motionConnectionRef, motionError, motionHttpUrl };
