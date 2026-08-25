const openaiCompatible = require('./openaiCompatible');
const { resolveMediaRef } = require('./mediaResolver');
const { normalizeVolcengineAssetUri } = require('./volcengineAssets');
const { mergeProviderTrace, providerTrace } = require('./providerTrace');

const GENERATION_TIMEOUT_MS = 60 * 60 * 1000;
const VOLCENGINE_API_PREFIX = '/api/v3';
const SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEED', 'SUCCEEDED', 'COMPLETED', 'COMPLETE', 'DONE', 'FINISHED', 'OK', 'READY']);
const FAILURE_STATUSES = new Set(['FAILURE', 'FAILED', 'FAIL', 'ERROR', 'ERRORED', 'CANCELED', 'CANCELLED', 'TIMEOUT', 'REJECTED', 'EXPIRED']);

function generationTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return GENERATION_TIMEOUT_MS;
  return Math.max(GENERATION_TIMEOUT_MS, Math.round(n));
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '') || 'https://ark.cn-beijing.volces.com/api/v3';
}

function cleanArkApiKey(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '').trim();
}

function looksLikeVolcengineAccessKeyId(value) {
  return /^AKLT[A-Z0-9]{16,}$/i.test(cleanArkApiKey(value));
}

function hasVolcengineAkSk(provider) {
  const cfg = provider?.volcengineConfig || {};
  return !!(cleanArkApiKey(cfg.accessKeyId) && cleanArkApiKey(cfg.secretAccessKey));
}

function credentialTypeMismatchError() {
  return '上方需要填写「方舟 Ark API Key」，不是 Access Key ID / Secret Access Key。Seedream / Seedance / LLM 生成走 Ark Bearer Key；AK/SK 只能放在火山高级项里用于素材签名类 OpenAPI。';
}

function validateArkProvider(provider) {
  const baseUrl = cleanBaseUrl(provider?.baseUrl);
  if (!baseUrl) {
    return { ok: false, code: 'missing_base_url', error: '请先填写火山方舟 Base URL。' };
  }
  const apiKey = cleanArkApiKey(provider?.apiKey);
  if (!apiKey) {
    const suffix = hasVolcengineAkSk(provider)
      ? '已检测到 AK/SK，但它不能替代 Ark API Key。'
      : 'Access Key ID / Secret Access Key 不能替代 Ark API Key。';
    return {
      ok: false,
      code: 'missing_api_key',
      error: `请先填写「方舟 Ark API Key」用于 Seedream / Seedance / LLM 生成。${suffix}`,
      baseUrl,
    };
  }
  if (looksLikeVolcengineAccessKeyId(apiKey)) {
    return {
      ok: false,
      code: 'credential_type_mismatch',
      error: credentialTypeMismatchError(),
      baseUrl,
    };
  }
  return { ok: true, baseUrl, apiKey };
}

function endpointOverride(provider, overrideKeys = []) {
  const defaults = provider?.defaults || {};
  return overrideKeys
    .map((key) => defaults[key])
    .find((value) => typeof value === 'string' && value.trim());
}

function joinVolcengineEndpoint(provider, rawPath) {
  const baseUrl = cleanBaseUrl(provider?.baseUrl);
  const raw = String(rawPath || '').trim();
  if (!raw) return baseUrl;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const baseHasApiPrefix = baseUrl.endsWith(VOLCENGINE_API_PREFIX);
  const pathHasApiPrefix = path === VOLCENGINE_API_PREFIX || path.startsWith(`${VOLCENGINE_API_PREFIX}/`);
  if (baseHasApiPrefix && pathHasApiPrefix) {
    return `${baseUrl}${path.slice(VOLCENGINE_API_PREFIX.length) || ''}`;
  }
  if (baseHasApiPrefix || pathHasApiPrefix) return `${baseUrl}${path}`;
  return `${baseUrl}${VOLCENGINE_API_PREFIX}${path}`;
}

function endpointUrl(provider, defaultPath, overrideKeys = []) {
  return joinVolcengineEndpoint(provider, endpointOverride(provider, overrideKeys) || defaultPath);
}

function taskEndpointUrl(provider, taskId) {
  const encoded = encodeURIComponent(String(taskId || '').trim());
  const override = endpointOverride(provider, ['videoTaskEndpoint', 'video_task_endpoint']);
  if (!override) return endpointUrl(provider, `/contents/generations/tasks/${encoded}`);
  let url = joinVolcengineEndpoint(provider, override);
  if (url.includes('{taskId}')) return url.replaceAll('{taskId}', encoded);
  if (url.includes('{task_id}')) return url.replaceAll('{task_id}', encoded);
  if (/\/tasks\/[^/?#]+(?:[?#].*)?$/.test(url)) return url;
  return `${url.replace(/\/+$/, '')}/${encoded}`;
}

function bearerHeaders(provider) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${cleanArkApiKey(provider?.apiKey)}`,
    'Content-Type': 'application/json',
  };
}

function selectedModel(requested, models, fallback) {
  const fromList = Array.isArray(models) ? models.find((item) => String(item || '').trim()) : '';
  const model = String(requested || fromList || fallback || '').trim();
  if (!model) throw new Error('模型名称不能为空。');
  if (model.length > 240 || /[\x00-\x1f\x7f]/.test(model)) throw new Error('模型名称不合法。');
  return model;
}

function volcengineErrorCode(raw) {
  return String(raw?.error?.code || raw?.code || raw?.ResponseMetadata?.Error?.Code || '').trim();
}

function volcengineErrorMessage(raw) {
  const code = volcengineErrorCode(raw);
  const message = String(
    raw?.error?.message ||
    raw?.message ||
    raw?.detail ||
    raw?.ResponseMetadata?.Error?.Message ||
    '',
  ).replace(/\s+/g, ' ').trim();
  if (/modelnotopen/i.test(code) || /has not activated the model/i.test(message)) {
    const modelMatch = message.match(/model\s+([A-Za-z0-9_.:-]+)/i);
    const model = String(modelMatch?.[1] || '').replace(/[.。]+$/, '');
    return `火山方舟模型未开通${model ? `：${model}` : ''}。请在火山方舟控制台开通对应 Seedance / Seedream 模型服务，或在节点里切换到已开通模型后重试。`;
  }
  if (message) return message.slice(0, 300);
  if (code) return code;
  return '';
}

async function responseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

const VIDEO_URL_KEYS = [
  'url', 'uri', 'value', 'src', 'path',
  'video', 'videos', 'video_url', 'videoUrl', 'video_urls', 'videoUrls',
  'mp4_url', 'mp4Url', 'output_url', 'outputUrl',
  'file_url', 'fileUrl', 'download_url', 'downloadUrl', 'preview_url', 'previewUrl',
  'last_frame_url', 'lastFrameUrl',
];

const VIDEO_CONTAINER_KEYS = [
  'data', 'result', 'results', 'output', 'outputs', 'content', 'choices',
  'message', 'file', 'files', 'media', 'assets',
];

function normalizeMediaUrlCandidate(value) {
  return String(value || '')
    .trim()
    .replace(/[),.;\]}]+$/g, '');
}

function collectMediaUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^[{[]/.test(text)) {
      try {
        return collectMediaUrls(JSON.parse(text), out);
      } catch {
        // Some upstreams return human-readable text with an embedded URL.
      }
    }
    if (/^(https?:\/\/|data:video\/|\/(?:files\/output|output|assets)\/)/i.test(text)) {
      out.push(normalizeMediaUrlCandidate(text));
      return out;
    }
    const embeddedUrls = text.match(/https?:\/\/[^\s"'<>\\]+|\/(?:files\/output|output|assets)\/[^\s"'<>\\]+/gi) || [];
    for (const url of embeddedUrls) out.push(normalizeMediaUrlCandidate(url));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const key of VIDEO_CONTAINER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) collectMediaUrls(value[key], out);
  }
  for (const key of VIDEO_URL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) collectMediaUrls(value[key], out);
  }
  return out;
}

function extractTaskId(raw) {
  return String(raw?.id || raw?.task_id || raw?.taskId || raw?.data?.id || raw?.data?.task_id || raw?.data?.taskId || '').trim();
}

function extractStatus(raw) {
  const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  return String(data?.status || data?.task_status || raw?.status || raw?.task_status || '').trim().toUpperCase();
}

async function resolveRefs(refs, options = {}) {
  const out = [];
  for (const ref of Array.isArray(refs) ? refs : []) {
    const value = typeof ref === 'string' ? ref : ref?.url || ref?.imageUrl || ref?.value;
    if (!value) continue;
    if (/^asset:\/\//i.test(value)) {
      out.push(normalizeVolcengineAssetUri(value));
      continue;
    }
    const resolved = await resolveMediaRef(value, {
      target: 'data-url',
      baseUrl: options.baseUrl,
    });
    out.push(resolved.dataUrl || resolved.url || value);
  }
  return out;
}

async function resolveMediaItems(refs, options = {}) {
  const out = [];
  for (const ref of Array.isArray(refs) ? refs : []) {
    const value = typeof ref === 'string'
      ? ref
      : ref?.url || ref?.imageUrl || ref?.videoUrl || ref?.audioUrl || ref?.value;
    if (!value) continue;
    const role = typeof ref === 'object' && ref ? String(ref.role || ref.mediaRole || '').trim() : '';
    if (/^asset:\/\//i.test(value)) {
      out.push({ url: normalizeVolcengineAssetUri(value), role });
      continue;
    }
    const resolved = await resolveMediaRef(value, {
      target: 'data-url',
      baseUrl: options.baseUrl,
    });
    out.push({
      url: resolved.dataUrl || resolved.url || value,
      role,
    });
  }
  return out;
}

function volcengineVideoDuration(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(60, n));
}

function volcengineVideoResolution(value) {
  const text = String(value || '').trim().toLowerCase();
  const aliases = {
    '': '',
    auto: '',
    native1080p: '1080p',
    '480': '480p',
    '720': '720p',
    '1080': '1080p',
  };
  const normalized = Object.prototype.hasOwnProperty.call(aliases, text) ? aliases[text] : text;
  return ['480p', '720p', '1080p'].includes(normalized) ? normalized : '';
}

function truthyParam(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function validVolcengineContentRole(role, kind = 'image') {
  const value = String(role || '').trim().toLowerCase();
  const allowed = new Set([
    'first_frame',
    'last_frame',
    'reference_image',
    'reference_video',
    'reference_audio',
    'image',
    'video',
    'audio',
  ]);
  if (allowed.has(value)) {
    if (kind === 'audio' && value === 'audio') return 'reference_audio';
    if (kind === 'video' && value === 'video') return 'reference_video';
    if (kind === 'image' && value === 'image') return 'reference_image';
    return value;
  }
  if (kind === 'audio') return 'reference_audio';
  if (kind === 'video') return 'reference_video';
  return '';
}

function imageRoleForFrameMode(index, explicitRole, frameMode) {
  const role = validVolcengineContentRole(explicitRole, 'image');
  if (role) return role;
  const mode = String(frameMode || 'auto').trim().toLowerCase();
  if (mode === 'first' && index === 0) return 'first_frame';
  if (mode === 'firstlast' && index === 0) return 'first_frame';
  if (mode === 'firstlast' && index === 1) return 'last_frame';
  return 'reference_image';
}

async function generateImage(provider, input = {}, options = {}) {
  const validation = validateArkProvider(provider);
  if (!validation.ok) return validation;
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: 'volcengine', error: '请输入图像提示词。' };
  }
  let model;
  try {
    model = selectedModel(input.model || input.providerModel, provider.imageModels, provider.defaults?.imageModel || 'doubao-seedream-4-0-250828');
  } catch (e) {
    return { ok: false, code: 'invalid_model', providerId: provider.id, protocol: 'volcengine', error: e.message };
  }

  const body = {
    model,
    prompt,
    size: String(input.size || '1024x1024'),
    response_format: input.response_format || 'url',
  };
  if (input.n != null) body.n = Number(input.n);
  try {
    const images = await resolveRefs(input.images || input.referenceImages || input.reference_images, options);
    if (images.length) body.image = images.slice(0, 10);
  } catch (e) {
    return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: 'volcengine', error: e?.message || '参考图解析失败。' };
  }

  try {
    const res = await openaiCompatible.fetchWithTimeout(endpointUrl(provider, '/images/generations', ['imageGenerationEndpoint', 'image_generation_endpoint']), {
      method: 'POST',
      headers: bearerHeaders(provider),
      body: JSON.stringify(body),
      timeoutMs: generationTimeoutMs(options.timeoutMs),
      fetchImpl: options.fetchImpl,
    });
    const raw = await responseJson(res);
    const trace = providerTrace(res, raw, { pollCount: 0 });
    if (!res.ok) {
      const upstreamMessage = volcengineErrorMessage(raw);
      const code = /modelnotopen/i.test(volcengineErrorCode(raw)) ? 'model_not_open' : 'http_error';
      return {
        ok: false,
        code,
        providerId: provider.id,
        protocol: 'volcengine',
        model,
        error: `火山图像调用失败：HTTP ${res.status}${upstreamMessage ? `，${upstreamMessage}` : ''}`,
        raw,
        ...trace,
      };
    }
    const imageUrls = openaiCompatible.extractImageUrls(raw);
    if (!imageUrls.length) {
      return { ok: false, code: 'empty_image', providerId: provider.id, protocol: 'volcengine', model, error: '火山图像接口没有返回图片。', raw, ...trace };
    }
    return { ok: true, kind: 'image', code: 'completed', providerId: provider.id, protocol: 'volcengine', model, imageUrls, raw, ...trace };
  } catch (e) {
    return { ok: false, code: e?.name === 'AbortError' ? 'timeout' : 'network_error', providerId: provider.id, protocol: 'volcengine', error: e?.message || '火山图像调用失败。' };
  }
}

async function pollVideoTask(provider, taskId, options = {}) {
  const pollUrl = taskEndpointUrl(provider, taskId);
  const interval = Number(options.pollIntervalMs || 5000);
  const requestedMaxPoll = Math.max(1, Number(options.maxPoll || 600));
  const minMaxPoll = Math.ceil(GENERATION_TIMEOUT_MS / Math.max(1, interval));
  const maxPoll = Math.max(requestedMaxPoll, minMaxPoll);
  let lastRaw = null;
  let trace = {};
  for (let i = 0; i < maxPoll; i += 1) {
    if (i > 0 && interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    const res = await openaiCompatible.fetchWithTimeout(pollUrl, {
      method: 'GET',
      headers: bearerHeaders(provider),
      timeoutMs: generationTimeoutMs(options.timeoutMs),
      fetchImpl: options.fetchImpl,
    });
    const raw = await responseJson(res);
    lastRaw = raw;
    trace = mergeProviderTrace(trace, providerTrace(res, raw, { pollCount: i + 1 }));
    if (!res.ok) {
      const error = new Error(`火山视频任务查询失败：HTTP ${res.status}`);
      Object.assign(error, trace);
      throw error;
    }
    const status = extractStatus(raw);
    const urls = [...new Set(collectMediaUrls(raw))];
    if (SUCCESS_STATUSES.has(status) || (!status && urls.length)) return { raw, videoUrls: urls, ...trace };
    if (FAILURE_STATUSES.has(status)) {
      const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
      const error = new Error(data?.message || data?.error?.message || raw?.message || '火山视频任务失败。');
      Object.assign(error, trace);
      throw error;
    }
  }
  const error = new Error(`火山视频任务超时：${JSON.stringify(lastRaw || taskId).slice(0, 500)}`);
  Object.assign(error, trace, { pollCount: maxPoll });
  throw error;
}

async function generateVideo(provider, input = {}, options = {}) {
  const validation = validateArkProvider(provider);
  if (!validation.ok) return validation;
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: 'volcengine', error: '请输入视频提示词。' };
  }
  let model;
  try {
    model = selectedModel(input.model || input.providerModel, provider.videoModels, provider.defaults?.videoModel || 'doubao-seedance-2-0-fast-260128');
  } catch (e) {
    return { ok: false, code: 'invalid_model', providerId: provider.id, protocol: 'volcengine', error: e.message };
  }

  let images = [];
  let videos = [];
  let audios = [];
  try {
    images = await resolveMediaItems(input.images || input.referenceImages || input.reference_images, options);
    videos = await resolveMediaItems(input.videos || input.referenceVideos || input.reference_videos, options);
    audios = await resolveMediaItems(input.audios || input.referenceAudios || input.reference_audios, options);
  } catch (e) {
    return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: 'volcengine', error: e?.message || '参考图解析失败。' };
  }
  const providerParams = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  const frameMode = String(providerParams.frameMode || input.frameMode || 'auto').trim().toLowerCase();
  const content = [{ type: 'text', text: prompt }];
  for (const [index, item] of images.slice(0, 9).entries()) {
    const part = { type: 'image_url', image_url: { url: item.url } };
    const role = imageRoleForFrameMode(index, item.role, frameMode);
    if (role) part.role = role;
    content.push(part);
  }
  for (const item of videos.slice(0, 3)) {
    const part = { type: 'video_url', video_url: { url: item.url } };
    const role = validVolcengineContentRole(item.role, 'video');
    if (role) part.role = role;
    content.push(part);
  }
  for (const item of audios.slice(0, 3)) {
    const part = { type: 'audio_url', audio_url: { url: item.url } };
    const role = validVolcengineContentRole(item.role, 'audio');
    if (role) part.role = role;
    content.push(part);
  }
  const body = {
    model,
    content,
  };
  if (input.duration != null || providerParams.duration != null) body.duration = volcengineVideoDuration(input.duration ?? providerParams.duration);
  const resolution = volcengineVideoResolution(input.resolution ?? providerParams.resolution);
  if (resolution) body.resolution = resolution;
  if (input.aspect_ratio || input.ratio || providerParams.aspect_ratio || providerParams.ratio) {
    body.ratio = String(input.aspect_ratio || input.ratio || providerParams.aspect_ratio || providerParams.ratio);
  }
  if (input.seed != null && Number(input.seed) >= 0) body.seed = Number(input.seed);
  if (truthyParam(providerParams.generate_audio ?? input.generate_audio)) body.generate_audio = true;
  if (truthyParam(providerParams.return_last_frame ?? input.return_last_frame)) body.return_last_frame = true;
  if (truthyParam(providerParams.watermark ?? input.watermark)) body.watermark = true;
  if (truthyParam(providerParams.camerafixed ?? input.camerafixed)) body.camerafixed = true;

  let trace = {};
  try {
    const res = await openaiCompatible.fetchWithTimeout(endpointUrl(provider, '/contents/generations/tasks', ['videoGenerationEndpoint', 'video_generation_endpoint']), {
      method: 'POST',
      headers: bearerHeaders(provider),
      body: JSON.stringify(body),
      timeoutMs: generationTimeoutMs(options.timeoutMs),
      fetchImpl: options.fetchImpl,
    });
    const raw = await responseJson(res);
    trace = providerTrace(res, raw, { pollCount: 0 });
    if (!res.ok) {
      const upstreamMessage = volcengineErrorMessage(raw);
      const code = /modelnotopen/i.test(volcengineErrorCode(raw)) ? 'model_not_open' : 'http_error';
      return {
        ok: false,
        code,
        providerId: provider.id,
        protocol: 'volcengine',
        model,
        error: `火山视频提交失败：HTTP ${res.status}${upstreamMessage ? `，${upstreamMessage}` : ''}`,
        raw,
        ...trace,
      };
    }
    const taskId = extractTaskId(raw);
    const directUrls = [...new Set(collectMediaUrls(raw))];
    if (directUrls.length) {
      return { ok: true, kind: 'video', code: 'completed', providerId: provider.id, protocol: 'volcengine', model, taskId, videoUrls: directUrls, raw, ...trace };
    }
    if (!taskId) {
      return { ok: false, code: 'missing_task_id', providerId: provider.id, protocol: 'volcengine', model, error: '火山视频提交后未返回 task id。', raw, ...trace };
    }
    const polled = await pollVideoTask(provider, taskId, options);
    trace = mergeProviderTrace(trace, polled);
    if (!polled.videoUrls.length) {
      return { ok: false, code: 'empty_video', providerId: provider.id, protocol: 'volcengine', model, taskId, error: '火山视频任务完成但没有返回视频。', raw: polled.raw, ...trace };
    }
    return { ok: true, kind: 'video', code: 'completed', providerId: provider.id, protocol: 'volcengine', model, taskId, videoUrls: polled.videoUrls, raw: polled.raw, ...trace };
  } catch (e) {
    return { ok: false, code: e?.name === 'AbortError' ? 'timeout' : 'network_error', providerId: provider.id, protocol: 'volcengine', model, error: e?.message || '火山视频调用失败。', ...mergeProviderTrace(trace, e) };
  }
}

async function generateChat(provider, input = {}, options = {}) {
  const validation = validateArkProvider(provider);
  if (!validation.ok) return validation;
  const result = await openaiCompatible.generateChat({
    ...provider,
    apiKey: validation.apiKey,
    protocol: 'volcengine',
    baseUrl: cleanBaseUrl(provider?.baseUrl),
  }, input, options);
  return { ...result, providerId: provider.id, protocol: 'volcengine' };
}

function trimBodyForError(raw) {
  if (!raw) return '';
  const message = raw?.error?.message || raw?.message || raw?.detail || raw?.ResponseMetadata?.Error?.Message || '';
  if (message) return String(message).replace(/\s+/g, ' ').trim().slice(0, 240);
  try {
    return JSON.stringify(raw).replace(/\s+/g, ' ').trim().slice(0, 240);
  } catch {
    return String(raw).replace(/\s+/g, ' ').trim().slice(0, 240);
  }
}

function looksLikeHtmlResponse(text) {
  return /^\s*</.test(String(text || '')) || /<html[\s>]/i.test(String(text || ''));
}

async function probeJson(res) {
  const text = await res.text();
  if (!text) return { raw: {}, text: '' };
  try {
    return { raw: JSON.parse(text), text };
  } catch {
    return { raw: { message: text.slice(0, 500) }, text };
  }
}

async function probeTaskEndpoint(provider, options = {}) {
  const url = endpointUrl(provider, '/contents/generations/tasks/healthcheck_probe_do_not_submit', ['videoTaskEndpoint', 'video_task_endpoint']);
  const res = await openaiCompatible.fetchWithTimeout(url, {
    method: 'GET',
    headers: bearerHeaders(provider),
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  const { raw, text } = await probeJson(res);
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: '方舟 Ark API Key 无效或账号无权限。', raw };
  }
  if (looksLikeHtmlResponse(text)) {
    return { ok: false, status: res.status, message: '任务接口返回网页 HTML，Base URL 可能不是火山方舟 API 地址。', raw };
  }
  if (res.status < 500) {
    return { ok: true, status: res.status, message: '检测到方舟 Ark 任务接口。', raw };
  }
  return { ok: false, status: res.status, message: `方舟任务接口服务端错误 HTTP ${res.status}。`, raw };
}

async function testProvider(provider, options = {}) {
  const apiKey = cleanArkApiKey(provider?.apiKey);
  if (!apiKey && hasVolcengineAkSk(provider)) {
    return {
      ok: true,
      code: 'aksk_configured',
      providerId: provider.id,
      protocol: 'volcengine',
      message: '已识别火山 AK/SK。注意：AK/SK 只用于素材签名类 OpenAPI；Seedream / Seedance / LLM 生成还需要上方「方舟 Ark API Key」。',
    };
  }

  const validation = validateArkProvider(provider);
  if (!validation.ok) return { ...validation, providerId: provider.id, protocol: 'volcengine' };

  const normalized = {
    ...provider,
    apiKey: validation.apiKey,
    protocol: 'volcengine',
    baseUrl: validation.baseUrl,
  };
  if (options.dryRun) {
    return {
      ok: true,
      code: 'dry_run_ok',
      providerId: provider.id,
      protocol: 'volcengine',
      message: '火山方舟配置格式可用，已跳过真实网络请求。',
    };
  }

  try {
    const res = await openaiCompatible.fetchWithTimeout(endpointUrl(normalized, '/models'), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${validation.apiKey}` },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    const { raw, text } = await probeJson(res);
    if (res.ok) {
      return {
        ok: true,
        code: 'connected',
        providerId: provider.id,
        protocol: 'volcengine',
        message: '方舟 Ark API Key 可用，模型列表接口可达。',
      };
    }
    if (res.status === 401 || res.status === 403) {
      const detail = trimBodyForError(raw);
      return {
        ok: false,
        code: 'auth_failed',
        providerId: provider.id,
        protocol: 'volcengine',
        error: `方舟 Ark API Key 鉴权失败：HTTP ${res.status}${detail ? ` ${detail}` : ''}。如果你填的是 Access Key ID 或 Secret Access Key，请移到「火山 AK/SK」高级项；生成接口必须使用 Ark API Key。`,
        raw,
      };
    }
    if (looksLikeHtmlResponse(text)) {
      return {
        ok: false,
        code: 'html_response',
        providerId: provider.id,
        protocol: 'volcengine',
        error: '模型列表返回网页 HTML，请检查 Base URL 是否为 https://ark.cn-beijing.volces.com/api/v3。',
        raw,
      };
    }
    const probe = await probeTaskEndpoint(normalized, options);
    if (probe.ok) {
      return {
        ok: true,
        code: 'connected_by_task_probe',
        providerId: provider.id,
        protocol: 'volcengine',
        message: `${probe.message} /models 不可用时仍可使用内置 Seedream / Seedance 默认模型。`,
        raw: { models: raw, taskProbe: probe.raw },
      };
    }
    return {
      ok: false,
      code: 'http_error',
      providerId: provider.id,
      protocol: 'volcengine',
      error: `测试连接失败：HTTP ${res.status}${trimBodyForError(raw) ? ` ${trimBodyForError(raw)}` : ''}；${probe.message}`,
      raw: { models: raw, taskProbe: probe.raw },
    };
  } catch (e) {
    return {
      ok: false,
      code: e?.name === 'AbortError' ? 'timeout' : 'network_error',
      providerId: provider.id,
      protocol: 'volcengine',
      error: e?.name === 'AbortError' ? '测试连接超时。' : (e?.message || '测试连接失败。'),
    };
  }
}

module.exports = {
  generateChat,
  generateImage,
  generateVideo,
  testProvider,
};
