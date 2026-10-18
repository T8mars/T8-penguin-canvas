const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const settingsRouter = require('./settings');
const { maskAdvancedProviders, normalizeAdvancedProviders } = require('../providers/registry');
const {
  generateChatWithProvider,
  generateImageWithProvider,
  generateVideoWithProvider,
  testProviderConnection,
} = require('../providers/adapters');
const {
  isT8LocalMediaPath,
  normalizeT8LocalMediaRef,
  resolveMediaRef,
} = require('../providers/mediaResolver');
const { isLoopbackAddress, safeRemoteMediaFetch } = require('../utils/safeRemoteMediaFetch');
const { MIN_PROVIDER_MEDIA_TIMEOUT_MS } = require('../providers/providerTimeoutPolicy');

const router = express.Router();
router.use((req, res, next) => {
  const controller = new AbortController();
  req.t8AbortSignal = controller.signal;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new Error('client_disconnected'));
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
  };
  const cleanup = () => {
    req.off('aborted', abort);
    res.off('close', onClose);
    res.off('finish', cleanup);
  };
  req.once('aborted', abort);
  res.once('close', onClose);
  res.once('finish', cleanup);
  next();
});
const EXTERNAL_GENERATION_TIMEOUT_MS = 60 * 60 * 1000;
const WEB_IMAGE_FETCH_TIMEOUT_MS = 30 * 1000;
const WEB_IMAGE_FETCH_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_WEB_IMAGE_PROVIDER_ID = 'modelscope';
const DEFAULT_WEB_IMAGE_VISION_MODEL = 'Qwen/Qwen3-VL-235B-A22B-Instruct';
const DEFAULT_WEB_IMAGE_PROMPT_INSTRUCTION = [
  '你是资深 AI 图像提示词反推助手。请严格观察这张网页图片，输出一段可直接用于文生图的高质量中文提示词。',
  '必须完全基于图片可见内容，不要补写图中不存在的主体、场景、风格或抽象概念；如果无法识别图片，请明确说明无法读取图片，不要编造。',
  '要求：描述主体、构图、场景、光线、材质、色彩、风格和镜头语言；不要解释过程，不要输出 Markdown，只输出提示词正文。',
].join('\n');

function generationTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return EXTERNAL_GENERATION_TIMEOUT_MS;
  return Math.max(EXTERNAL_GENERATION_TIMEOUT_MS, Math.round(n));
}

function safeProviderForResponse(provider) {
  const masked = maskAdvancedProviders([provider]);
  const id = String(provider?.id || '').trim();
  const protocol = String(provider?.protocol || '').trim();
  return masked.find((item) => item.id === id && item.protocol === protocol) || masked[0] || null;
}

function resolveProvider(body, currentProviders) {
  if (body?.provider && typeof body.provider === 'object') {
    const normalized = normalizeAdvancedProviders([body.provider], currentProviders);
    const id = String(body.provider.id || '').trim();
    return normalized.find((provider) => provider.id === id) || normalized[0] || null;
  }
  const providerId = String(body?.providerId || '').trim();
  if (!providerId) return null;
  return currentProviders.find((provider) => provider.id === providerId) || null;
}

function resolveRunnableProvider(body, currentProviders) {
  const provider = resolveProvider(body, currentProviders);
  if (!provider) {
    return { ok: false, code: 'provider_not_found', error: '未找到扩展平台配置。' };
  }
  if (!provider.enabled) {
    return { ok: false, code: 'provider_disabled', error: '扩展平台未启用，请先在 API 设置中启用。', provider };
  }
  return { ok: true, provider };
}

function outputExtFromMime(mime, fallback = '.png') {
  const text = String(mime || '').toLowerCase();
  if (text.includes('mp4')) return '.mp4';
  if (text.includes('webm')) return '.webm';
  if (text.includes('quicktime')) return '.mov';
  if (text.includes('mpeg') || text.includes('mp3')) return '.mp3';
  if (text.includes('wav')) return '.wav';
  if (text.includes('ogg')) return '.ogg';
  if (text.includes('jpeg') || text.includes('jpg')) return '.jpg';
  if (text.includes('webp')) return '.webp';
  if (text.includes('gif')) return '.gif';
  if (text.includes('bmp')) return '.bmp';
  if (text.includes('png')) return '.png';
  return fallback;
}

function outputExtFromUrl(url, fallback = '.png') {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.mp4', '.webm', '.mov', '.m4v', '.mp3', '.wav', '.ogg'].includes(ext)) return ext;
  } catch {
    // ignore
  }
  return fallback;
}

function writeOutputBuffer(buffer, ext) {
  if (!fs.existsSync(config.OUTPUT_DIR)) fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
  const suffix = crypto.randomBytes(4).toString('hex');
  const filename = `external_${Date.now()}_${suffix}${ext || '.png'}`;
  fs.writeFileSync(path.join(config.OUTPUT_DIR, filename), buffer);
  return `/files/output/${filename}`;
}

function defaultExtForKind(kind) {
  if (kind === 'video') return '.mp4';
  if (kind === 'audio') return '.mp3';
  return '.png';
}

function trustedLocalOutputOrigins(provider = {}) {
  const candidates = [
    provider.baseUrl,
    ...(Array.isArray(provider?.comfyuiConfig?.instances) ? provider.comfyuiConfig.instances : []),
  ];
  const origins = new Set();
  for (const candidate of candidates) {
    const raw = typeof candidate === 'string' ? candidate : candidate?.baseUrl || candidate?.url;
    try {
      const parsed = new URL(String(raw || '').trim());
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLoopbackAddress(parsed.hostname)) {
        origins.add(parsed.origin);
      }
    } catch (_) {}
  }
  return origins;
}

function isTrustedLocalOutputUrl(value, trustedOrigins) {
  if (!(trustedOrigins instanceof Set) || trustedOrigins.size === 0) return false;
  try {
    const parsed = new URL(String(value || '').trim());
    return isLoopbackAddress(parsed.hostname) && trustedOrigins.has(parsed.origin);
  } catch (_) {
    return false;
  }
}

async function saveOneMediaOutput(url, kind = 'image', options = {}) {
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError');
  const text = String(url || '').trim();
  if (!text) return '';
  const dataMatch = text.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataMatch) {
    const ext = outputExtFromMime(dataMatch[1], defaultExtForKind(kind));
    return writeOutputBuffer(Buffer.from(dataMatch[2], 'base64'), ext);
  }
  if (/^https?:\/\//i.test(text)) {
    if (options.fetchImpl || isTrustedLocalOutputUrl(text, options.trustedLocalOrigins)) {
      const res = await (options.fetchImpl || fetch)(text, { signal: options.signal });
      if (!res.ok) throw new Error(`下载扩展平台输出失败：HTTP ${res.status}`);
      const mime = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : '';
      const ext = outputExtFromMime(mime, outputExtFromUrl(text, defaultExtForKind(kind)));
      const buf = Buffer.from(await res.arrayBuffer());
      return writeOutputBuffer(buf, ext);
    }
    const remote = await safeRemoteMediaFetch(text, {
      allowedKinds: [kind],
      trustedProviderOutput: true,
      maxBytes: kind === 'video' ? 1024 * 1024 * 1024 : kind === 'audio' ? 256 * 1024 * 1024 : 64 * 1024 * 1024,
      deadlineMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
      idleTimeoutMs: MIN_PROVIDER_MEDIA_TIMEOUT_MS,
      maxRedirects: 4,
      userAgent: 'T8-PenguinCanvas-ExternalProvider/1.0',
      signal: options.signal,
    });
    const ext = outputExtFromMime(
      remote.contentType,
      outputExtFromUrl(remote.finalUrl || text, defaultExtForKind(kind)),
    );
    const buf = remote.buffer;
    return writeOutputBuffer(buf, ext);
  }
  if (text.startsWith('/files/output/')) return text;
  return text;
}

function outputSaveFailure(error) {
  const cause = error?.cause || error;
  const code = String(cause?.code || error?.code || '').trim();
  const message = String(error?.message || cause?.message || error || '').trim();
  if (code.startsWith('tun_dns_fallback_')) {
    return {
      code: 'output_download_tun_dns_recovering',
      error: '检测到 TUN Fake-IP，应用已尝试通过独立公共 DNS 获取真实结果地址；当前回源暂未成功，请保留任务并稍后重试。',
    };
  }
  if (code === 'private_address') {
    return {
      code: 'output_download_private_address_blocked',
      error: '结果地址实际指向本机或内网，已拒绝访问；TUN Fake-IP 会自动回源解析。',
    };
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /getaddrinfo|dns/i.test(message)) {
    return { code: 'output_download_dns_failed', error: '本机无法解析结果文件域名，请检查 DNS、代理或网络连接。' };
  }
  if (error?.name === 'AbortError' || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) {
    return { code: 'output_download_timeout', error: '从结果服务器下载文件超时，请检查代理或网络后重试。' };
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return { code: 'output_download_network_failed', error: '本机与结果服务器的连接被拒绝或中断，请检查防火墙、代理、VPN 和网络。' };
  }
  if (/HTTP\s+\d+/i.test(message)) {
    return { code: 'output_download_http_error', error: message };
  }
  if (/certificate|cert_|self signed|unable to verify|tls|ssl/i.test(`${code} ${message}`)) {
    return { code: 'output_download_tls_failed', error: '结果服务器 HTTPS 证书校验失败，请检查系统时间、代理证书或杀毒软件的 HTTPS 扫描。' };
  }
  if (code === 'ENOSPC') {
    return { code: 'output_disk_full', error: '本机磁盘空间不足，无法保存生成结果。' };
  }
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) {
    return { code: 'output_not_writable', error: '本机输出目录无法写入，请检查文件夹权限、杀毒软件或受控文件夹访问设置。' };
  }
  const causeMessage = String(cause?.message || '').trim();
  const detail = causeMessage && causeMessage !== message ? `${message}（${code || causeMessage}）` : (message || code);
  return {
    code: 'output_persist_failed',
    error: detail || '下载或保存生成结果失败，请检查网络、代理、磁盘和输出目录权限。',
  };
}

function safeOutputSource(value) {
  const text = String(value || '').trim();
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return text.startsWith('/files/') ? text.slice(0, 240) : '';
  }
}

async function saveMediaOutputs(kind, urls, options = {}) {
  const out = [];
  const errors = [];
  for (const url of Array.isArray(urls) ? urls : []) {
    try {
      const saved = await saveOneMediaOutput(url, kind, options);
      if (saved) out.push(saved);
    } catch (error) {
      const failure = outputSaveFailure(error);
      errors.push({
        kind,
        url: safeOutputSource(url),
        code: failure.code,
        error: failure.error,
      });
    }
  }
  return { urls: out, errors };
}

async function saveVideoOutputs(urls, options = {}) {
  return (await saveMediaOutputs('video', urls, options)).urls;
}

function outputKindsForPayload(payload = {}) {
  const kinds = [];
  if (Array.isArray(payload.imageUrls) && payload.imageUrls.length) kinds.push('image');
  if (Array.isArray(payload.videoUrls) && payload.videoUrls.length) kinds.push('video');
  if (Array.isArray(payload.audioUrls) && payload.audioUrls.length) kinds.push('audio');
  if (String(payload.text || '').trim()) kinds.push('text');
  return kinds;
}

function resultResponse(res, result, provider, dataPatch = {}) {
  const payload = {
    ...result,
    ...dataPatch,
    provider: safeProviderForResponse(provider),
  };
  return res.json({
    success: !!result.ok,
    code: result.code,
    error: result.ok ? undefined : result.error,
    data: payload,
  });
}

function cleanWebText(value, maxLen = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function cleanWebImageUrl(value) {
  const text = normalizeT8LocalMediaRef(value);
  if (!text || text.length > 8 * 1024 * 1024) return '';
  if (/^(https?:\/\/|data:image\/)/i.test(text)) return text;
  if (isT8LocalMediaPath(text)) return text;
  return '';
}

function imageMimeFromUrl(value) {
  const ext = outputExtFromUrl(value, '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.avif') return 'image/avif';
  return '';
}

function cleanImageMime(value, fallback = '') {
  const mime = String(value || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/')) return mime;
  return fallback;
}

async function fetchWebImageAsDataUrl(imageUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || WEB_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(imageUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'T8-PenguinCanvas-WebImageReverse/2.3',
      },
    });
    if (!response.ok) throw new Error(`读取网页图片失败：HTTP ${response.status}`);

    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > WEB_IMAGE_FETCH_MAX_BYTES) {
      throw new Error(`网页图片过大，最大支持 ${Math.round(WEB_IMAGE_FETCH_MAX_BYTES / 1024 / 1024)}MB。`);
    }

    const fallbackMime = imageMimeFromUrl(imageUrl);
    const mime = cleanImageMime(response.headers?.get?.('content-type'), fallbackMime);
    if (!mime) throw new Error('网页图片返回的内容不是可识别的图片。');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('网页图片内容为空。');
    if (buffer.length > WEB_IMAGE_FETCH_MAX_BYTES) {
      throw new Error(`网页图片过大，最大支持 ${Math.round(WEB_IMAGE_FETCH_MAX_BYTES / 1024 / 1024)}MB。`);
    }
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('读取网页图片超时，请重试或换一张图片。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWebImageForVision(imageUrl, options = {}) {
  const text = normalizeT8LocalMediaRef(imageUrl);
  if (/^data:image\/[^;,]+;base64,/i.test(text)) return text;
  if (/^https?:\/\//i.test(text)) return fetchWebImageAsDataUrl(text, options);

  const resolved = await resolveMediaRef(text, {
    target: 'data-url',
    baseUrl: options.baseUrl,
  });
  if (resolved?.dataUrl && /^data:image\/[^;,]+;base64,/i.test(resolved.dataUrl)) return resolved.dataUrl;
  throw new Error('无法读取网页图片内容，请换用可访问的图片地址。');
}

function resolveWebImageProvider(body, currentProviders) {
  const explicit = resolveProvider(body, currentProviders);
  if (explicit) return explicit;
  const providerId = cleanWebText(body?.providerId || body?.provider_id || DEFAULT_WEB_IMAGE_PROVIDER_ID, 80) || DEFAULT_WEB_IMAGE_PROVIDER_ID;
  return currentProviders.find((provider) => provider.id === providerId) ||
    currentProviders.find((provider) => provider.id === DEFAULT_WEB_IMAGE_PROVIDER_ID) ||
    null;
}

function webImagePromptFromChatText(value) {
  return cleanWebText(value, 4000)
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function webImagePromptLooksUnreadable(value) {
  const text = cleanWebText(value, 1200);
  if (!text) return false;
  return [
    /无法读取(?:该|这张|当前)?(?:网页)?图片/,
    /未检测到(?:可分析的)?图像数据/,
    /无法(?:识别|分析)(?:该|这张|当前)?(?:图片|图像)/,
    /不能(?:读取|识别|查看|看到|分析)(?:该|这张|当前)?(?:图片|图像)/,
    /没有(?:收到|提供|检测到)(?:图片|图像)/,
    /看不到(?:图片|图像)/,
    /unable to (?:read|view|access|analy[sz]e) (?:the )?image/i,
    /cannot (?:read|view|access|see|analy[sz]e) (?:the )?image/i,
    /no image (?:data|provided|attached|available)/i,
  ].some((pattern) => pattern.test(text));
}

function webImageChatMessages(imageUrl, instruction) {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: instruction || DEFAULT_WEB_IMAGE_PROMPT_INSTRUCTION },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ];
}

router.post('/test-provider', async (req, res) => {
  try {
    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const currentProviders = normalizeAdvancedProviders(settings.advancedProviders);
    const provider = resolveProvider(req.body || {}, currentProviders);
    if (!provider) {
      return res.json({
        success: false,
        code: 'provider_not_found',
        error: '未找到扩展平台配置。',
      });
    }

    const result = await testProviderConnection(provider, {
      dryRun: !!req.body?.dryRun,
      timeoutMs: Number(req.body?.timeoutMs) || undefined,
    });
    const data = {
      ...result,
      provider: safeProviderForResponse(provider),
    };
    return res.json({
      success: !!result.ok,
      code: result.code,
      error: result.ok ? undefined : result.error,
      data,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      code: 'provider_test_failed',
      error: e?.message || String(e),
    });
  }
});

router.post('/llm', async (req, res) => {
  let heartbeat;
  const stream = req.body?.stream === true;
  const send = (event) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  try {
    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const currentProviders = normalizeAdvancedProviders(settings.advancedProviders);
    const resolved = resolveRunnableProvider(req.body || {}, currentProviders);
    if (!resolved.ok) {
      return res.json({
        success: false,
        code: resolved.code,
        error: resolved.error,
        data: resolved.provider ? { provider: safeProviderForResponse(resolved.provider) } : undefined,
      });
    }
    if (stream) {
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 10000);
    }
    const result = await generateChatWithProvider(resolved.provider, req.body || {}, {
      timeoutMs: Number(req.body?.timeoutMs) || undefined,
      baseUrl: `http://127.0.0.1:${config.PORT}`,
      signal: req.t8AbortSignal,
      onDelta: stream ? (delta) => send({ type: 'delta', delta }) : undefined,
      onStatus: stream ? (status) => send({ type: 'status', ...status }) : undefined,
    });
    if (stream) {
      // Terminal result is authoritative; deltas alone are never successful output.
      const { raw, ...safeResult } = result;
      send({ type: 'result', success: result.ok === true, data: safeResult, error: result.error, code: result.code });
      return res.end();
    }
    return resultResponse(res, result, resolved.provider);
  } catch (e) {
    if (res.headersSent) {
      send({ type: 'result', success: false, code: 'external_llm_failed', error: e?.message || 'LLM failed' });
      return res.end();
    }
    return res.status(500).json({
      success: false,
      code: 'external_llm_failed',
      error: e?.message || String(e),
    });
  } finally { clearInterval(heartbeat); }
});

router.post('/image', async (req, res) => {
  try {
    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const currentProviders = normalizeAdvancedProviders(settings.advancedProviders);
    const resolved = resolveRunnableProvider(req.body || {}, currentProviders);
    if (!resolved.ok) {
      return res.json({
        success: false,
        code: resolved.code,
        error: resolved.error,
        data: resolved.provider ? { provider: safeProviderForResponse(resolved.provider) } : undefined,
      });
    }
    const result = await generateImageWithProvider(resolved.provider, req.body || {}, {
      timeoutMs: generationTimeoutMs(req.body?.timeoutMs),
      baseUrl: `http://127.0.0.1:${config.PORT}`,
      signal: req.t8AbortSignal,
    });
    if (!result.ok) return resultResponse(res, result, resolved.provider);
    const remoteImageUrls = Array.isArray(result.imageUrls) ? result.imageUrls : [];
    const remoteVideoUrls = Array.isArray(result.videoUrls) ? result.videoUrls : [];
    const remoteAudioUrls = Array.isArray(result.audioUrls) ? result.audioUrls : [];
    const outputSaveOptions = { trustedLocalOrigins: trustedLocalOutputOrigins(resolved.provider), signal: req.t8AbortSignal };
    const [savedImages, savedVideos, savedAudios] = await Promise.all([
      saveMediaOutputs('image', remoteImageUrls, outputSaveOptions),
      saveMediaOutputs('video', remoteVideoUrls, outputSaveOptions),
      saveMediaOutputs('audio', remoteAudioUrls, outputSaveOptions),
    ]);
    const imageUrls = savedImages.urls;
    const videoUrls = savedVideos.urls;
    const audioUrls = savedAudios.urls;
    const outputSaveErrors = [...savedImages.errors, ...savedVideos.errors, ...savedAudios.errors];
    const outputKinds = outputKindsForPayload({ imageUrls, videoUrls, audioUrls, text: result.text });
    const primaryKind = outputKinds[0] || result.primaryKind || result.kind || 'image';
    if (!outputKinds.length) {
      const firstFailure = outputSaveErrors[0];
      return resultResponse(res, {
        ...result,
        ok: false,
        code: firstFailure?.code || 'output_missing',
        error: firstFailure
          ? `扩展平台已生成结果，但保存到 T8 本地失败：${firstFailure.error}`
          : '扩展平台任务已完成，但没有返回可识别的图像、视频、音频或文本结果。请保留任务 ID 并检查平台任务详情。',
      }, resolved.provider, {
        remoteImageUrls,
        remoteVideoUrls,
        remoteAudioUrls,
        imageUrls,
        videoUrls,
        audioUrls,
        outputKinds,
        primaryKind,
        outputSaveErrors,
      });
    }
    return resultResponse(res, result, resolved.provider, {
      remoteImageUrls,
      remoteVideoUrls,
      remoteAudioUrls,
      imageUrls,
      videoUrls,
      audioUrls,
      outputKinds,
      primaryKind,
      kind: primaryKind,
      outputSaveErrors,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      code: 'external_image_failed',
      error: e?.message || String(e),
    });
  }
});

router.post('/web-image', async (req, res) => {
  try {
    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const currentProviders = normalizeAdvancedProviders(settings.advancedProviders);
    const provider = resolveWebImageProvider(req.body || {}, currentProviders);
    if (!provider) {
      return res.json({
        success: false,
        code: 'provider_not_found',
        error: '未找到 ModelScope 扩展平台配置。',
      });
    }
    if (!provider.enabled) {
      return res.json({
        success: false,
        code: 'provider_disabled',
        error: 'ModelScope 扩展平台未启用，请先在 API 设置中启用。',
        data: { provider: safeProviderForResponse(provider) },
      });
    }

    const imageUrl = cleanWebImageUrl(req.body?.imageUrl || req.body?.image_url || req.body?.url);
    if (!imageUrl) {
      return res.json({
        success: false,
        code: 'missing_image_url',
        error: '请提供要反推的网页图片地址。',
        data: { provider: safeProviderForResponse(provider) },
      });
    }

    const instruction = cleanWebText(req.body?.promptInstruction || req.body?.instruction, 2000) || DEFAULT_WEB_IMAGE_PROMPT_INSTRUCTION;
    const visionModel = DEFAULT_WEB_IMAGE_VISION_MODEL;

    const visionImageUrl = await resolveWebImageForVision(imageUrl, {
      baseUrl: `http://127.0.0.1:${config.PORT}`,
    });

    const chatResult = await generateChatWithProvider(provider, {
      model: visionModel,
      messages: webImageChatMessages(visionImageUrl, instruction),
      temperature: req.body?.temperature ?? 0.2,
      maxTokens: req.body?.maxTokens || req.body?.max_tokens || 900,
    }, {
      timeoutMs: Number(req.body?.llmTimeoutMs || req.body?.timeoutMs) || undefined,
      baseUrl: `http://127.0.0.1:${config.PORT}`,
      signal: req.t8AbortSignal,
    });
    if (!chatResult.ok) return resultResponse(res, chatResult, provider);

    const prompt = webImagePromptFromChatText(chatResult.text);
    if (!prompt) {
      return res.json({
        success: false,
        code: 'empty_prompt',
        error: 'ModelScope 反推成功但没有返回提示词。',
        data: {
          ...chatResult,
          provider: safeProviderForResponse(provider),
          prompt: '',
          sourceImageUrl: imageUrl,
        },
      });
    }
    if (webImagePromptLooksUnreadable(prompt)) {
      return res.json({
        success: false,
        code: 'unreadable_image_prompt',
        error: 'ModelScope 视觉模型没有读到这张网页图片，已停止生图。请换一张可访问图片，或先下载图片后上传到画布。',
        data: {
          ...chatResult,
          provider: safeProviderForResponse(provider),
          prompt: '',
          sourceImageUrl: imageUrl,
          imageUrls: [],
          remoteImageUrls: [],
          visionModel,
          visionFailureText: prompt,
          chat: {
            model: chatResult.model,
            finishReason: chatResult.finishReason,
            truncated: chatResult.truncated,
          },
        },
      });
    }

    const shouldGenerateImage = req.body?.generateImage !== false && req.body?.generate_image !== false;
    if (!shouldGenerateImage) {
      return res.json({
        success: true,
        code: 'completed',
        data: {
          ok: true,
          kind: 'web-image',
          code: 'completed',
          providerId: provider.id,
          protocol: provider.protocol,
          provider: safeProviderForResponse(provider),
          prompt,
          sourceImageUrl: imageUrl,
          imageUrls: [],
          remoteImageUrls: [],
          chat: {
            model: chatResult.model,
            finishReason: chatResult.finishReason,
            truncated: chatResult.truncated,
          },
        },
      });
    }

    const imageModel = cleanWebText(
      req.body?.imageModel ||
      req.body?.providerModel ||
      provider.defaults?.imageModel ||
      provider.imageModels?.[0],
      240,
    );
    const imageResult = await generateImageWithProvider(provider, {
      ...req.body,
      prompt,
      model: imageModel || req.body?.providerModel || req.body?.model,
      providerModel: imageModel || req.body?.providerModel,
      size: req.body?.size || req.body?.imageSize || req.body?.image_size || provider.defaults?.size || '1024x1024',
    }, {
      timeoutMs: generationTimeoutMs(req.body?.imageTimeoutMs || req.body?.timeoutMs),
      pollIntervalMs: Number(req.body?.pollIntervalMs) || undefined,
      baseUrl: `http://127.0.0.1:${config.PORT}`,
      signal: req.t8AbortSignal,
    });
    if (!imageResult.ok) {
      return res.json({
        success: false,
        code: imageResult.code,
        error: imageResult.error,
        data: {
          ...imageResult,
          provider: safeProviderForResponse(provider),
          prompt,
          sourceImageUrl: imageUrl,
          imageUrls: [],
          remoteImageUrls: [],
          chat: {
            model: chatResult.model,
            finishReason: chatResult.finishReason,
            truncated: chatResult.truncated,
          },
        },
      });
    }

    const remoteImageUrls = Array.isArray(imageResult.imageUrls) ? imageResult.imageUrls : [];
    const savedImages = await saveMediaOutputs('image', remoteImageUrls, {
      trustedLocalOrigins: trustedLocalOutputOrigins(provider),
      signal: req.t8AbortSignal,
    });
    const imageUrls = savedImages.urls;
    if (!imageUrls.length) {
      const firstFailure = savedImages.errors[0];
      return res.json({
        success: false,
        code: firstFailure?.code || 'output_missing',
        error: firstFailure
          ? `图片已经生成，但保存到 T8 本地失败：${firstFailure.error}`
          : '图片任务已完成，但平台没有返回可识别的图片地址。请保留任务 ID 并检查平台任务详情。',
        data: {
          ...imageResult,
          provider: safeProviderForResponse(provider),
          prompt,
          sourceImageUrl: imageUrl,
          remoteImageUrls,
          imageUrls: [],
          outputSaveErrors: savedImages.errors,
        },
      });
    }
    return res.json({
      success: true,
      code: 'completed',
      data: {
        ...imageResult,
        provider: safeProviderForResponse(provider),
        prompt,
        sourceImageUrl: imageUrl,
        remoteImageUrls,
        imageUrls,
        outputSaveErrors: savedImages.errors,
        chat: {
          model: chatResult.model,
          finishReason: chatResult.finishReason,
          truncated: chatResult.truncated,
        },
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      code: 'web_image_reverse_failed',
      error: e?.message || String(e),
    });
  }
});

router.post('/video', async (req, res) => {
  try {
    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const currentProviders = normalizeAdvancedProviders(settings.advancedProviders);
    const resolved = resolveRunnableProvider(req.body || {}, currentProviders);
    if (!resolved.ok) {
      return res.json({
        success: false,
        code: resolved.code,
        error: resolved.error,
        data: resolved.provider ? { provider: safeProviderForResponse(resolved.provider) } : undefined,
      });
    }
    const result = await generateVideoWithProvider(resolved.provider, req.body || {}, {
      timeoutMs: generationTimeoutMs(req.body?.timeoutMs),
      baseUrl: `http://127.0.0.1:${config.PORT}`,
      signal: req.t8AbortSignal,
    });
    if (!result.ok) return resultResponse(res, result, resolved.provider);
    const remoteVideoUrls = Array.isArray(result.videoUrls) ? result.videoUrls : [];
    const videoUrls = await saveVideoOutputs(remoteVideoUrls, {
      trustedLocalOrigins: trustedLocalOutputOrigins(resolved.provider),
      signal: req.t8AbortSignal,
    });
    return resultResponse(res, result, resolved.provider, {
      remoteVideoUrls,
      videoUrls,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      code: 'external_video_failed',
      error: e?.message || String(e),
    });
  }
});

module.exports = router;
