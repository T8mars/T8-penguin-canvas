'use strict';
const contract = require('../shared/klingV4Contract.json');
const crypto = require('node:crypto');
const sharp = require('sharp');
const fail = message => { throw Object.assign(Error(message), { code: 'KLING_V4_INVALID_INPUT', status: 400 }); };
const text = value => typeof value === 'string' ? value.trim() : '';
const count = value => [...value].length;
function list(value, field) {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try { value = value.trim().startsWith('[') ? JSON.parse(value) : value.split(/\r?\n/).filter(x => x.trim()); }
    catch { fail(`${field} 需要逐行填写或JSON字符串数组`); }
  }
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x.trim())) fail(`${field} 必须是非空字符串列表`);
  return value.map(x => x.trim());
}
function validate(request) {
  const r = request || {}, model = r.model;
  if (!contract.models.includes(model)) fail('不支持的Kling 4模型');
  const kind = model.slice('kling-v4-'.length), images = list(r.images, 'images'), videos = [...list(r.videos, 'videos'), ...list(r.videoUrlsText, 'videoUrlsText')];
  const prompt = text(r.prompt), payload = { model }, metadata = {};
  if (contract.videoModels.includes(model)) {
    const chars = [...prompt], english = chars.filter(c => c.codePointAt(0) < 128).length;
    if (english / 26000 + (chars.length - english) / 11000 > 1) fail('Kling 4提示词超过混合语言长度限制');
    if (kind !== 'i2v' && !prompt) fail('请填写Kling 4提示词');
    const seconds = r.duration ?? 3;
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 30) fail('Kling 4时长必须是3–30秒整数');
    const resolution = r.resolution || '720p';
    if (!contract.resolutions.includes(resolution)) fail('Kling 4清晰度仅支持720p/1080p');
    metadata.resolution = resolution;
    if (kind !== 'i2v') {
      const ratio = r.ratio || '16:9';
      if (![...contract.ratios, ...(kind === 'omni' ? ['adaptive'] : [])].includes(ratio)) fail('Kling 4比例无效');
      metadata.ratio = ratio;
    }
    const watermark = r.watermark || 'api_default';
    if (!contract.watermarks.includes(watermark)) fail('Kling 4水印设置无效');
    if (watermark !== 'api_default') metadata.watermark = watermark === 'enabled';
    if (kind === 'i2v' && (images.length < 1 || images.length > 2)) fail('Kling 4图生视频需要首帧和可选尾帧，共1–2张图');
    if (kind === 't2v' && (images.length || videos.length)) fail('Kling 4文生视频不接受参考素材');
    if (kind === 'i2v' && videos.length) fail('Kling 4图生视频不接受视频素材');
    if (kind === 'omni') {
      const imageIds = list(r.imageElementIds, 'imageElementIds'), videoIds = list(r.videoElementIds, 'videoElementIds'), voices = list(r.voiceIds, 'voiceIds');
      if (images.length > 10 || videos.length > 5 || imageIds.length + videoIds.length > 7 || videoIds.length > 3 || voices.length > 3
        || images.length + videos.length + imageIds.length + videoIds.length > 15 || videos.length + videoIds.length > 5) fail('Kling 4 Omni素材数量超过官方上限');
      if (new Set([...imageIds, ...videoIds]).size !== imageIds.length + videoIds.length) fail('图片主体与视频主体ID不能重复');
      if (imageIds.length + videoIds.length) metadata.elementIds = [...imageIds, ...videoIds];
      if (voices.length) metadata.voiceIds = voices;
    }
    payload.seconds = String(seconds); if (prompt) payload.prompt = prompt;
  } else if (kind === 'custom-element') {
    const name = text(r.elementName), referenceType = r.referenceType || 'image_refer';
    if (!name || count(name) > 20 || !prompt || count(prompt) > 100) fail('主体名称需要1–20字，主体描述需要1–100字');
    if (!contract.referenceTypes.includes(referenceType)) fail('主体参考方式无效');
    if (referenceType === 'image_refer' && (images.length < 2 || images.length > 4 || videos.length)) fail('图片主体需要正面图和1–3张不同视角图，不能混用视频');
    if (referenceType === 'video_refer' && (videos.length !== 1 || images.length)) fail('视频主体需要且只能提供1个视频');
    const tags = list(r.tagList, 'tagList'); if (tags.some(tag => !contract.tags.includes(tag))) fail('主体标签仅支持o_101至o_108');
    Object.assign(metadata, { elementName: name, referenceType });
    if (text(r.elementVoiceId)) metadata.elementVoiceId = text(r.elementVoiceId);
    if (tags.length) metadata.tagList = tags;
    payload.prompt = prompt;
  } else {
    const name = text(r.voiceName), mode = r.voiceSource || 'audio', audioUrl = text(r.audioUrl), videoId = text(r.videoId);
    if (!name || count(name) > 20) fail('音色名称需要1–20字（已由上游实际校验确认）');
    if (!['audio', 'video_id'].includes(mode)) fail('音色来源无效');
    if (images.length || videos.length) fail('音色创建只接受音频素材或提供商videoId');
    if (mode === 'audio' && (!audioUrl || videoId) || mode === 'video_id' && (!videoId || audioUrl)) fail('音频与提供商videoId必须且只能选择一种');
    metadata.voiceName = name;
    if (mode === 'video_id') metadata.videoId = videoId;
  }
  payload.metadata = metadata;
  return { payload, model, kind, images, videos };
}
async function build(request, key, options, media) {
  const built = validate(request), { payload, images, videos, kind } = built;
  const element = kind === 'custom-element', hashes = new Set();
  for (const source of images) {
    const file = await media.read(source, 'image', (element ? 10 : 30) * 1024 ** 2, options);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mime)) fail('参考图需要JPG/PNG/WebP图片');
    const info = await sharp(file.buffer).metadata();
    if (element && (Math.min(info.width, info.height) < 300 || info.width / info.height < 0.4 || info.width / info.height > 2.5)) fail('主体图片最短边至少300px，比例需在1:2.5–2.5:1之间');
    const normalized = await sharp(file.buffer).png().toBuffer(), hash = crypto.createHash('sha256').update(normalized).digest('hex');
    if (element && hashes.has(hash)) fail('主体图片必须是不同视角，不能重复'); hashes.add(hash);
    if (normalized.length > (element ? 10 : 30) * 1024 ** 2) fail('PNG参考图超过模型大小限制');
  }
  let total = 0;
  for (const source of videos) {
    const remote = /^https?:\/\//i.test(source);
    const file = await media.read(source, 'video', (remote ? element ? 200 : 300 : 50) * 1024 ** 2, options);
    let info;
    try { info = await media.probe(file.buffer, file, options); }
    catch (error) { throw Object.assign(Error(String(error.message || '无法读取参考视频').replace(/F(?:l)?ashVSR/gi, 'Kling 4')), { status: 400, code: 'KLING_V4_VIDEO_PROBE_FAILED' }); }
    total += info.duration;
    if (!Number.isFinite(info.duration) || info.duration <= 0) fail('无法读取参考视频时长');
    if (element && (!['video/mp4', 'video/quicktime'].includes(file.mime) || info.duration < 3 || info.duration > 8
      || ![[1920,1080],[1080,1920]].some(([w,h]) => w === info.width && h === info.height))) fail('视频主体需要3–8秒、1080p的16:9或9:16 MP4/MOV');
  }
  if (!element && total > 30) fail('Omni参考视频合计不能超过30秒');
  // Validate every reference before the first upload/submission.
  if (images.length) {
    payload.images = [];
    for (const source of images) payload.images.push(await media.upload(source, 'image', key, { ...options, maxBytes: (element ? 10 : 30) * 1024 ** 2, normalizeImagePng: true, cacheVariant: 'kling-v4-png' }));
  }
  if (videos.length) {
    payload.metadata.video_url = [];
    for (const source of videos) payload.metadata.video_url.push(/^https?:\/\//i.test(source) ? source : await media.upload(source, 'video', key, { ...options, maxBytes: 50 * 1024 ** 2, cacheVariant: 'kling-v4-video' }));
  }
  if (kind === 'custom-voice' && (request.voiceSource || 'audio') === 'audio') {
    payload.metadata.audio_url = await media.upload(request.audioUrl, 'audio', key, { ...options, maxBytes: 10 * 1024 ** 2, cacheVariant: 'kling-v4-voice' });
  }
  return built;
}
function normalize(response, model) {
  if (!contract.models.includes(model)) fail('查询原任务需要准确的Kling 4模型');
  const containers = []; for (let d = response; d && typeof d === 'object' && containers.length < 5; d = d.data) containers.push(d);
  if (containers.some(d => d.model != null && d.model !== model)) throw Object.assign(Error('Kling 4原任务模型不匹配'), { status: 502, code: 'KLING_V4_MODEL_MISMATCH' });
  const states = containers.map(d => String(d.status || '').toLowerCase()).filter(Boolean);
  const failed = states.some(s => ['failure','failed','cancelled','canceled'].includes(s));
  const succeeded = states.length && states.every(s => ['success','succeeded','completed'].includes(s));
  const status = failed ? 'failed' : succeeded ? 'succeeded' : 'pending';
  const result = { status, model, videoUrls: [], elementId: '', voiceId: '', trialUrl: '', failReason: failed ? String(containers.find(d => d.fail_reason || d.error)?.fail_reason || 'Kling 4任务失败') : '' };
  if (status !== 'succeeded') return result;
  const record = containers.findLast(d => d.content || d.result_text) || containers.at(-1);
  if (contract.auxiliaryModels.includes(model)) {
    const raw = containers.findLast(d => typeof d.result_text === 'string')?.result_text;
    let rows; try { rows = JSON.parse(raw).results; } catch { throw Object.assign(Error('Kling 4辅助结果缺少有效result_text；请查询原任务'), { status: 502 }); }
    if (!Array.isArray(rows)) throw Object.assign(Error('Kling 4辅助结果缺少results'), { status: 502 });
    const values = Object.fromEntries(rows.filter(r => r && typeof r.name === 'string').map(r => [r.name, text(r.text || r.value || r.url)]));
    result.elementId = values.element_id || ''; result.voiceId = values.voice_id || ''; result.trialUrl = values.trial_url || '';
    for (const id of [result.elementId, result.voiceId]) if (id && !/^[A-Za-z0-9._:-]{1,512}$/.test(id)) throw Object.assign(Error('Kling 4返回了无效ID；请查询原任务'), { status: 502 });
    if (!(model.endsWith('element') ? result.elementId : result.voiceId)) throw Object.assign(Error('Kling 4创建完成但没有返回对应ID；请继续查询原任务'), { status: 502 });
  } else {
    const content = record.content || {}, urls = content.video_urls || [content.video_url || record.video_url || record.url];
    if (!Array.isArray(urls) || !urls.length || urls.some(url => { try { return !['http:', 'https:'].includes(new URL(url).protocol); } catch { return true; } })) throw Object.assign(Error('Kling 4已完成但视频地址不可用；请查询原任务'), { status: 502 });
    result.videoUrls = urls;
  }
  return result;
}
module.exports = { contract, list, validate, build, normalize };
