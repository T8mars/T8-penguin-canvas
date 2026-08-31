const { normalizeT8LocalMediaRef, resolveMediaRef } = require('./mediaResolver');
const { normalizeLlmMessageMedia } = require('./llmMedia');
const { providerTrace } = require('./providerTrace');
const { providerIdempotencyHeadersLike } = require('../services/providerSubmissionContext');

const DEFAULT_TIMEOUT_MS = 8000;
const IMAGE_EDIT_REMOTE_MAX_BYTES = 20 * 1024 * 1024;

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function hasApiKey(provider) {
  return typeof provider?.apiKey === 'string' && provider.apiKey.trim().length > 0;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || fetch;
  const { timeoutMs, fetchImpl: _fetchImpl, signal: _externalSignal, ...fetchOptions } = options;
  try {
    return await fetchImpl(url, {
      ...fetchOptions,
      headers: providerIdempotencyHeadersLike(fetchOptions.headers, fetchOptions.method),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.('abort', forwardAbort);
  }
}

function validateProvider(provider, { apiKeyRequired = true } = {}) {
  const baseUrl = cleanBaseUrl(provider?.baseUrl);
  if (!baseUrl) {
    return { ok: false, code: 'missing_base_url', error: '请先填写 Base URL。' };
  }
  if (apiKeyRequired && !hasApiKey(provider)) {
    return { ok: false, code: 'missing_api_key', error: '请先填写 API Key。' };
  }
  return { ok: true, baseUrl };
}

function providerEndpointUrl(provider, defaultPath, overrideKeys = []) {
  const baseUrl = cleanBaseUrl(provider?.baseUrl);
  const defaults = provider?.defaults || {};
  const override = overrideKeys
    .map((key) => defaults[key])
    .find((value) => typeof value === 'string' && value.trim());
  const rawPath = String(override || defaultPath || '').trim();
  if (/^https?:\/\//i.test(rawPath)) return rawPath.replace(/\/+$/, '');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${baseUrl}${path}`;
}

function selectedModel(requested, providerModels, fallback) {
  const fromList = Array.isArray(providerModels) ? providerModels.find((item) => String(item || '').trim()) : '';
  const model = String(requested || fromList || fallback || '').trim();
  if (!model) throw new Error('模型名称不能为空。');
  if (model.length > 240 || /[\x00-\x1f\x7f]/.test(model)) throw new Error('模型名称不合法。');
  return model;
}

function bearerHeaders(provider) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
    'Content-Type': 'application/json',
  };
}

function bearerMultipartHeaders(provider) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };
}

function trimBodyForError(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
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

function unwrapOpenAIResponse(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) && !raw.choices && !raw.data?.url && !raw.data?.b64_json) {
      return raw.data;
    }
  }
  return raw;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractChatText(raw) {
  const data = unwrapOpenAIResponse(raw);
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? data?.output_text ?? data?.text;
  return textFromContent(content).trim();
}

function extractChatDelta(raw) {
  const data = unwrapOpenAIResponse(raw);
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.delta?.content
    ?? choice?.message?.content
    ?? choice?.text
    ?? data?.output_text
    ?? data?.text;
  return textFromContent(content);
}

async function readChatEventStream(response, options = {}) {
  const body = response?.body;
  if (!body) throw new Error('扩展 LLM 流式响应缺少响应体。');

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let eventCount = 0;
  let finishReason = '';
  let model = '';
  let requestId = '';
  let usage;
  let lastRaw = {};
  let stopped = false;
  let done = false;

  const shouldStop = async () => (
    typeof options.shouldStop === 'function' && await options.shouldStop()
  );
  const handleEvent = async (eventBlock) => {
    const data = String(eventBlock || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return false;
    if (data.trim() === '[DONE]') {
      done = true;
      return true;
    }

    let raw;
    try {
      raw = JSON.parse(data);
    } catch {
      const error = new Error('扩展 LLM 返回了无法解析的流式事件。');
      error.code = 'invalid_stream_event';
      throw error;
    }
    if (raw?.error) {
      const error = new Error(trimBodyForError(raw.error?.message || raw.error) || '扩展 LLM 流式调用失败。');
      error.code = 'stream_error';
      error.raw = raw;
      throw error;
    }

    lastRaw = raw;
    eventCount += 1;
    const dataRoot = unwrapOpenAIResponse(raw);
    const choice = Array.isArray(dataRoot?.choices) ? dataRoot.choices[0] : null;
    finishReason = String(choice?.finish_reason || choice?.finishReason || finishReason || '');
    model = String(dataRoot?.model || raw?.model || model || '');
    requestId = String(dataRoot?.id || raw?.id || requestId || '').trim().slice(0, 500);
    if (dataRoot?.usage && typeof dataRoot.usage === 'object') usage = dataRoot.usage;
    if (raw?.usage && typeof raw.usage === 'object') usage = raw.usage;

    const delta = extractChatDelta(raw);
    if (!delta) return false;
    if (await shouldStop()) {
      stopped = true;
      return true;
    }
    text += delta;
    if (typeof options.onDelta === 'function') {
      await options.onDelta(delta, {
        eventCount,
        finishReason,
        model,
      });
    }
    return false;
  };
  const drain = async (flush = false) => {
    while (!done && !stopped) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match || match.index == null) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (await handleEvent(block)) break;
    }
    if (flush && buffer.trim() && !done && !stopped) {
      const block = buffer;
      buffer = '';
      await handleEvent(block);
    }
  };
  const acceptChunk = async (chunk) => {
    buffer += typeof chunk === 'string'
      ? chunk
      : decoder.decode(chunk, { stream: true });
    await drain(false);
  };

  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (!done && !stopped) {
        if (await shouldStop()) {
          stopped = true;
          break;
        }
        const part = await reader.read();
        if (part.done) break;
        await acceptChunk(part.value);
      }
      buffer += decoder.decode();
      await drain(true);
    } finally {
      if ((done || stopped) && typeof reader.cancel === 'function') {
        try {
          await reader.cancel();
        } catch {
          // Best-effort cancellation; the durable response state remains authoritative.
        }
      }
      if (typeof reader.releaseLock === 'function') reader.releaseLock();
    }
  } else if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      if (done || stopped || await shouldStop()) {
        stopped = !done;
        break;
      }
      await acceptChunk(chunk);
    }
    buffer += decoder.decode();
    await drain(true);
  } else {
    throw new Error('扩展 LLM 流式响应体不支持读取。');
  }

  return {
    text,
    eventCount,
    finishReason,
    model,
    requestId,
    usage,
    lastRaw,
    stopped,
  };
}
function normalizeBase64Image(value, mime = 'image/png') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^data:image\//i.test(text)) return text;
  return `data:${mime || 'image/png'};base64,${text}`;
}

function parseImageDataUrl(value) {
  const match = String(value || '').trim().match(/^data:(image\/[^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mime: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function imageExtFromMime(mime) {
  const text = String(mime || '').toLowerCase();
  if (text.includes('jpeg') || text.includes('jpg')) return 'jpg';
  if (text.includes('webp')) return 'webp';
  if (text.includes('gif')) return 'gif';
  if (text.includes('bmp')) return 'bmp';
  if (text.includes('avif')) return 'avif';
  return 'png';
}

function imageMimeFromUrl(value, fallback = 'image/png') {
  try {
    const pathname = new URL(String(value || '')).pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.bmp')) return 'image/bmp';
    if (pathname.endsWith('.avif')) return 'image/avif';
    if (pathname.endsWith('.png')) return 'image/png';
  } catch {
    // ignore
  }
  return fallback;
}

async function fetchImageReference(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`参考图下载失败：HTTP ${res.status}`);
  const contentLength = Number(res.headers?.get?.('content-length') || 0);
  if (contentLength > IMAGE_EDIT_REMOTE_MAX_BYTES) throw new Error('参考图超过 20MB，无法提交到 OpenAI 兼容编辑接口。');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('参考图内容为空。');
  if (buffer.length > IMAGE_EDIT_REMOTE_MAX_BYTES) throw new Error('参考图超过 20MB，无法提交到 OpenAI 兼容编辑接口。');
  const mime = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase() || imageMimeFromUrl(url);
  return {
    buffer,
    mime: mime.startsWith('image/') ? mime : imageMimeFromUrl(url),
  };
}

function collectImageUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^(https?:\/\/|data:image\/)/i.test(text)) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, out);
    return out;
  }
  if (typeof value !== 'object') return out;

  const mime = value.mime_type || value.mime || value.content_type || 'image/png';
  const direct = value.url || value.image_url || value.imageUrl || value.uri || value.value;
  if (direct) collectImageUrls(direct, out);
  if (value.b64_json || value.base64) out.push(normalizeBase64Image(value.b64_json || value.base64, mime));

  for (const key of ['data', 'images', 'image_urls', 'imageUrls', 'output_images', 'outputs', 'results']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) collectImageUrls(value[key], out);
  }
  return out;
}

function extractImageUrls(raw) {
  const data = unwrapOpenAIResponse(raw);
  return [...new Set(collectImageUrls(data))];
}

function collectVideoUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^(https?:\/\/|data:video\/|\/files\/output\/)/i.test(text)) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVideoUrls(item, out);
    return out;
  }
  if (typeof value !== 'object') return out;

  const direct = value.video_url || value.videoUrl || value.url || value.uri || value.value || value.download_url || value.downloadUrl;
  if (direct) collectVideoUrls(direct, out);
  for (const key of ['data', 'videos', 'video_urls', 'videoUrls', 'output_videos', 'outputs', 'results', 'files']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) collectVideoUrls(value[key], out);
  }
  return out;
}

function extractVideoUrls(raw) {
  const data = unwrapOpenAIResponse(raw);
  return [...new Set(collectVideoUrls(data))];
}

function extractTaskId(raw) {
  const data = unwrapOpenAIResponse(raw);
  return String(
    data?.task_id ||
    data?.taskId ||
    data?.id ||
    raw?.task_id ||
    raw?.taskId ||
    raw?.id ||
    '',
  ).trim();
}

async function resolveReferenceImages(refs, options = {}) {
  const out = [];
  for (const ref of Array.isArray(refs) ? refs : []) {
    const value = typeof ref === 'string' ? ref : ref?.url || ref?.imageUrl || ref?.value;
    if (!value) continue;
    const resolved = await resolveMediaRef(normalizeLocalT8MediaRef(value, options.baseUrl), {
      target: options.referenceTarget || 'data-url',
      baseUrl: options.baseUrl,
    });
    out.push(resolved.dataUrl || resolved.url || resolved.path || value);
  }
  return out;
}

function collectReferenceImageInputs(...values) {
  const out = [];
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const refValue = typeof item === 'string' ? item : item?.url || item?.imageUrl || item?.value;
      if (String(refValue || '').trim()) out.push(item);
    }
  }
  return out;
}

async function resolveImageEditFiles(refs, options = {}) {
  const out = [];
  for (const ref of Array.isArray(refs) ? refs : []) {
    const rawValue = typeof ref === 'string' ? ref : ref?.url || ref?.imageUrl || ref?.value;
    const value = normalizeLocalT8MediaRef(rawValue, options.baseUrl);
    if (!value) continue;

    const inline = parseImageDataUrl(value);
    if (inline) {
      out.push(inline);
      continue;
    }

    try {
      const local = await resolveMediaRef(value, {
        target: 'local-path',
        baseUrl: options.baseUrl,
      });
      if (local?.path) {
        const fs = require('fs');
        out.push({
          buffer: fs.readFileSync(local.path),
          mime: local.mime || imageMimeFromUrl(local.path),
        });
        continue;
      }
    } catch {
      // Fall through to data URL or remote URL handling.
    }

    const resolved = await resolveMediaRef(value, {
      target: 'data-url',
      baseUrl: options.baseUrl,
    });
    const dataUrl = parseImageDataUrl(resolved.dataUrl || resolved.url);
    if (dataUrl) {
      out.push(dataUrl);
      continue;
    }
    if (/^https?:\/\//i.test(resolved.url || '')) {
      out.push(await fetchImageReference(resolved.url, options));
      continue;
    }
    throw new Error(`无法转换参考图：${String(value).slice(0, 120)}`);
  }
  return out;
}

function appendImageEditField(form, key, value) {
  if (value == null || value === '') return;
  form.append(key, String(value));
}

function buildImageEditFormData({ model, prompt, input, files }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  appendImageEditField(form, 'size', input.size);
  appendImageEditField(form, 'n', input.n != null ? Number(input.n) : undefined);
  appendImageEditField(form, 'quality', input.quality);
  appendImageEditField(form, 'response_format', input.response_format);
  appendImageEditField(form, 'background', input.background);
  appendImageEditField(form, 'output_format', input.output_format);
  files.forEach((file, index) => {
    const mime = file.mime || 'image/png';
    const filename = `reference-${index + 1}.${imageExtFromMime(mime)}`;
    form.append('image', new Blob([file.buffer], { type: mime }), filename);
  });
  return form;
}

function normalizeLocalT8MediaRef(value, _baseUrl) {
  return normalizeT8LocalMediaRef(value);
}

function providerLooksLikeAgnes(provider) {
  const label = `${provider?.id || ''} ${provider?.label || ''} ${provider?.name || ''}`.toLowerCase();
  if (label.includes('agnes')) return true;
  try {
    const host = new URL(cleanBaseUrl(provider?.baseUrl)).hostname.toLowerCase();
    return host === 'agnes-ai.com' || host.endsWith('.agnes-ai.com');
  } catch {
    return false;
  }
}

function modelLooksLikeAgnesImage(model) {
  return /^agnes-image-/i.test(String(model || '').trim());
}

function useAgnesImageJson(provider, model) {
  return modelLooksLikeAgnesImage(model) || providerLooksLikeAgnes(provider);
}

function imageResponseFormat(provider, input = {}) {
  const params = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  return String(
    input.response_format ||
    input.responseFormat ||
    params.response_format ||
    params.responseFormat ||
    provider?.defaults?.responseFormat ||
    provider?.defaults?.response_format ||
    'url',
  ).trim() || 'url';
}

function buildAgnesImageJsonBody(provider, input, model, prompt, refs = []) {
  const params = input.providerParams && typeof input.providerParams === 'object' ? input.providerParams : {};
  const responseFormat = imageResponseFormat(provider, input);
  const body = {
    model,
    prompt,
    size: String(input.size || params.size || '1024x1024'),
    extra_body: {
      response_format: responseFormat,
    },
  };
  if (refs.length) body.extra_body.image = refs;
  if (!refs.length && (input.return_base64 === true || responseFormat === 'b64_json')) {
    body.return_base64 = true;
  }
  return body;
}

async function generateChat(provider, input = {}, options = {}) {
  const validation = validateProvider(provider, { apiKeyRequired: true });
  if (!validation.ok) return validation;

  let model;
  try {
    model = selectedModel(input.model || input.providerModel, provider.chatModels, provider.defaults?.chatModel || 'gpt-4o-mini');
  } catch (e) {
    return { ok: false, code: 'invalid_model', providerId: provider.id, protocol: provider.protocol, error: e.message };
  }

  const messages = Array.isArray(input.messages) && input.messages.length
    ? input.messages
    : [{ role: 'user', content: String(input.prompt || '').trim() }];
  if (!messages.some((message) => String(message?.content || '').trim())) {
    return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: provider.protocol, error: '请输入要发送给 LLM 的内容。' };
  }

  let normalizedMessages;
  try {
    normalizedMessages = await normalizeLlmMessageMedia(messages, input, {
      baseUrl: options.baseUrl,
      ffmpegPath: options.ffmpegPath,
      ffmpegTimeoutMs: options.ffmpegTimeoutMs,
    });
  } catch (e) {
    return {
      ok: false,
      code: 'invalid_multimodal_reference',
      providerId: provider.id,
      protocol: provider.protocol,
      error: e?.message || 'LLM 多模态素材预处理失败。',
    };
  }

  const body = {
    model,
    messages: normalizedMessages,
  };
  if (input.temperature != null) body.temperature = Number(input.temperature);
  if (input.maxTokens != null) body.max_tokens = Number(input.maxTokens);
  if (input.max_tokens != null) body.max_tokens = Number(input.max_tokens);
  const requestedResponseFormat = input.response_format ?? input.responseFormat;
  if (requestedResponseFormat && typeof requestedResponseFormat === 'object'
    && !Array.isArray(requestedResponseFormat)
    && ['json_object', 'text'].includes(String(requestedResponseFormat.type || '').trim())) {
    body.response_format = { type: String(requestedResponseFormat.type).trim() };
  } else if (['json_object', 'text'].includes(String(requestedResponseFormat || '').trim())) {
    body.response_format = { type: String(requestedResponseFormat).trim() };
  }
  const reasoningEffort = String(input.reasoning_effort ?? input.reasoningEffort ?? '')
    .trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(reasoningEffort)) {
    body.reasoning_effort = reasoningEffort;
  }
  if (input.stream != null) body.stream = !!input.stream;

  const url = providerEndpointUrl(provider, '/chat/completions', ['chatEndpoint', 'chat_endpoint']);
  try {
    const shouldReadStream = body.stream === true;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        ...bearerHeaders(provider),
        Accept: shouldReadStream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    if (!res.ok) {
      const raw = await responseJson(res);
      const trace = providerTrace(res, raw, { pollCount: 0 });
      const upstreamMessage = raw?.message || raw?.error?.message || raw?.error;
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: provider.protocol,
        model,
        error: `扩展 LLM 调用失败：HTTP ${res.status}${upstreamMessage ? ` ${trimBodyForError(upstreamMessage)}` : ''}`,
        raw,
        ...trace,
      };
    }

    const contentType = typeof res?.headers?.get === 'function'
      ? String(res.headers.get('content-type') || '').toLowerCase()
      : '';
    if (shouldReadStream && res.body && !contentType.includes('application/json')) {
      const streamed = await readChatEventStream(res, options);
      const traceRaw = {
        ...(streamed.lastRaw && typeof streamed.lastRaw === 'object' ? streamed.lastRaw : {}),
        ...(streamed.requestId ? { requestId: streamed.requestId } : {}),
        ...(streamed.usage ? { usage: streamed.usage } : {}),
      };
      const trace = providerTrace(res, traceRaw, { pollCount: 0 });
      if (streamed.stopped) {
        return {
          ok: false,
          code: 'stopped',
          providerId: provider.id,
          protocol: provider.protocol,
          model: streamed.model || model,
          text: streamed.text,
          finishReason: streamed.finishReason,
          eventCount: streamed.eventCount,
          error: '扩展 LLM 流式生成已停止。',
          ...trace,
        };
      }
      if (!streamed.text) {
        return {
          ok: false,
          code: 'empty_text',
          providerId: provider.id,
          protocol: provider.protocol,
          model: streamed.model || model,
          eventCount: streamed.eventCount,
          error: '扩展 LLM 没有返回文本。',
          ...trace,
        };
      }
      return {
        ok: true,
        kind: 'llm',
        code: 'completed',
        providerId: provider.id,
        protocol: provider.protocol,
        model: streamed.model || model,
        text: streamed.text,
        finishReason: streamed.finishReason,
        truncated: ['length', 'max_tokens', 'content_length'].includes(String(streamed.finishReason || '').toLowerCase()),
        eventCount: streamed.eventCount,
        raw: traceRaw,
        ...trace,
      };
    }

    const raw = await responseJson(res);
    const trace = providerTrace(res, raw, { pollCount: 0 });
    const text = extractChatText(raw);
    if (!text) {
      return { ok: false, code: 'empty_text', providerId: provider.id, protocol: provider.protocol, model, error: '扩展 LLM 没有返回文本。', raw, ...trace };
    }
    const data = unwrapOpenAIResponse(raw);
    const finishReason = data?.choices?.[0]?.finish_reason || data?.choices?.[0]?.finishReason || '';
    return {
      ok: true,
      kind: 'llm',
      code: 'completed',
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      text,
      finishReason,
      truncated: ['length', 'max_tokens', 'content_length'].includes(String(finishReason || '').toLowerCase()),
      raw,
      ...trace,
    };
  } catch (e) {
    const isParentAbort = options.signal?.aborted === true;
    const isTimeout = !isParentAbort && e?.name === 'AbortError';
    const streamCode = ['invalid_stream_event', 'stream_error'].includes(String(e?.code || ''))
      ? String(e.code)
      : '';
    const networkCauseCode = String(e?.cause?.code || '').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
    return {
      ok: false,
      code: isParentAbort ? 'request_aborted' : isTimeout ? 'timeout' : (streamCode || 'network_error'),
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      error: isParentAbort
        ? '扩展 LLM 调用已取消。'
        : isTimeout
          ? '扩展 LLM 调用超时。'
          : `${e?.message || '扩展 LLM 调用失败。'}${networkCauseCode ? ` [${networkCauseCode}]` : ''}`,
      ...(networkCauseCode ? { networkCauseCode } : {}),
    };
  }
}
async function generateImage(provider, input = {}, options = {}) {
  const validation = validateProvider(provider, { apiKeyRequired: true });
  if (!validation.ok) return validation;

  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: provider.protocol, error: '请输入图像提示词。' };
  }

  let model;
  try {
    model = selectedModel(input.model || input.providerModel, provider.imageModels, provider.defaults?.imageModel || 'gpt-image-1');
  } catch (e) {
    return { ok: false, code: 'invalid_model', providerId: provider.id, protocol: provider.protocol, error: e.message };
  }

  const refsInput = collectReferenceImageInputs(input.images, input.referenceImages, input.reference_images);
  const hasReferenceImages = refsInput.length > 0;
  const useAgnesJson = useAgnesImageJson(provider, model);

  let url;
  let requestBody;
  let requestHeaders;
  if (useAgnesJson) {
    let refs = [];
    if (hasReferenceImages) {
      try {
        refs = await resolveReferenceImages(refsInput, {
          baseUrl: options.baseUrl,
          referenceTarget: input.referenceTarget || provider.defaults?.imageReferenceTarget || provider.defaults?.referenceTarget || 'data-url',
        });
      } catch (e) {
        return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: provider.protocol, error: e?.message || '参考图解析失败。' };
      }
      if (!refs.length) {
        return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: provider.protocol, error: '参考图解析失败。' };
      }
    }
    url = providerEndpointUrl(provider, '/images/generations', ['imageGenerationEndpoint', 'image_generation_endpoint']);
    requestBody = JSON.stringify(buildAgnesImageJsonBody(provider, input, model, prompt, refs));
    requestHeaders = bearerHeaders(provider);
  } else if (hasReferenceImages) {
    let files;
    try {
      files = await resolveImageEditFiles(refsInput, {
        baseUrl: options.baseUrl,
        timeoutMs: options.referenceTimeoutMs || options.timeoutMs,
        fetchImpl: options.fetchImpl,
        signal: options.signal,
      });
    } catch (e) {
      return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: provider.protocol, error: e?.message || '参考图解析失败。' };
    }
    if (!files.length) {
      return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: provider.protocol, error: '参考图解析失败。' };
    }
    url = providerEndpointUrl(provider, '/images/edits', ['imageEditEndpoint', 'image_edit_endpoint']);
    requestBody = buildImageEditFormData({ model, prompt, input, files });
    requestHeaders = bearerMultipartHeaders(provider);
  } else {
    const body = {
      model,
      prompt,
    };
    if (input.size) body.size = String(input.size);
    if (input.n != null) body.n = Number(input.n);
    if (input.quality) body.quality = String(input.quality);
    if (input.response_format) body.response_format = String(input.response_format);

    url = providerEndpointUrl(provider, '/images/generations', ['imageGenerationEndpoint', 'image_generation_endpoint']);
    requestBody = JSON.stringify(body);
    requestHeaders = bearerHeaders(provider);
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    const raw = await responseJson(res);
    const trace = providerTrace(res, raw, { pollCount: 0 });
    if (!res.ok) {
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: provider.protocol,
        model,
        error: `扩展图像调用失败：HTTP ${res.status}${raw?.message ? ` ${trimBodyForError(raw.message)}` : ''}`,
        raw,
        ...trace,
      };
    }
    const imageUrls = extractImageUrls(raw);
    if (!imageUrls.length) {
      return { ok: false, code: 'empty_image', providerId: provider.id, protocol: provider.protocol, model, error: '扩展图像接口没有返回图片。', raw, ...trace };
    }
    return { ok: true, kind: 'image', code: 'completed', providerId: provider.id, protocol: provider.protocol, model, imageUrls, raw, ...trace };
  } catch (e) {
    const isParentAbort = options.signal?.aborted === true;
    return {
      ok: false,
      code: isParentAbort ? 'request_aborted' : e?.name === 'AbortError' ? 'timeout' : 'network_error',
      providerId: provider.id,
      protocol: provider.protocol,
      error: isParentAbort ? '扩展图像调用已取消。' : e?.name === 'AbortError' ? '扩展图像调用超时。' : (e?.message || '扩展图像调用失败。'),
    };
  }
}

async function generateVideo(provider, input = {}, options = {}) {
  const validation = validateProvider(provider, { apiKeyRequired: true });
  if (!validation.ok) return validation;

  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    return { ok: false, code: 'missing_prompt', providerId: provider.id, protocol: provider.protocol, error: '请输入视频提示词。' };
  }

  let model;
  try {
    model = selectedModel(input.model || input.providerModel, provider.videoModels, provider.defaults?.videoModel || '');
  } catch (e) {
    return { ok: false, code: 'invalid_model', providerId: provider.id, protocol: provider.protocol, error: e.message };
  }

  const body = { model, prompt };
  if (input.aspect_ratio) body.aspect_ratio = String(input.aspect_ratio);
  if (input.ratio) body.ratio = String(input.ratio);
  if (input.duration != null) body.duration = Number(input.duration);
  if (input.resolution) body.resolution = String(input.resolution);
  if (input.seed != null && Number(input.seed) >= 0) body.seed = Number(input.seed);

  try {
    const refs = await resolveReferenceImages(input.images || input.referenceImages || input.reference_images, {
      baseUrl: options.baseUrl,
      referenceTarget: input.referenceTarget || provider.defaults?.videoReferenceTarget || provider.defaults?.referenceTarget || 'data-url',
    });
    if (refs.length) body.images = refs;
  } catch (e) {
    return { ok: false, code: 'invalid_reference', providerId: provider.id, protocol: provider.protocol, error: e?.message || '参考图解析失败。' };
  }

  const url = providerEndpointUrl(provider, '/videos/generations', ['videoGenerationEndpoint', 'video_generation_endpoint']);
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: bearerHeaders(provider),
      body: JSON.stringify(body),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    const raw = await responseJson(res);
    const trace = providerTrace(res, raw, { pollCount: 0 });
    if (!res.ok) {
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: provider.protocol,
        model,
        error: `扩展视频调用失败：HTTP ${res.status}${raw?.message ? ` ${trimBodyForError(raw.message)}` : ''}`,
        raw,
        ...trace,
      };
    }
    const videoUrls = extractVideoUrls(raw);
    if (!videoUrls.length) {
      return { ok: false, code: 'empty_video', providerId: provider.id, protocol: provider.protocol, model, error: '扩展视频接口没有返回视频。', taskId: extractTaskId(raw), raw, ...trace };
    }
    return { ok: true, kind: 'video', code: 'completed', providerId: provider.id, protocol: provider.protocol, model, taskId: extractTaskId(raw), videoUrls, raw, ...trace };
  } catch (e) {
    const isParentAbort = options.signal?.aborted === true;
    return {
      ok: false,
      code: isParentAbort ? 'request_aborted' : e?.name === 'AbortError' ? 'timeout' : 'network_error',
      providerId: provider.id,
      protocol: provider.protocol,
      error: isParentAbort ? '扩展视频调用已取消。' : e?.name === 'AbortError' ? '扩展视频调用超时。' : (e?.message || '扩展视频调用失败。'),
    };
  }
}

async function testProvider(provider, options = {}) {
  const validation = validateProvider(provider, { apiKeyRequired: true });
  if (!validation.ok) return validation;

  if (options.dryRun) {
    return {
      ok: true,
      code: 'dry_run_ok',
      providerId: provider.id,
      protocol: provider.protocol,
      message: '配置格式可用，已跳过真实网络请求。',
    };
  }

  const url = `${validation.baseUrl}/models`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    if (!res.ok) {
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: provider.protocol,
        error: `测试连接失败：HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      code: 'connected',
      providerId: provider.id,
      protocol: provider.protocol,
      message: '连接成功。',
    };
  } catch (e) {
    return {
      ok: false,
      code: e?.name === 'AbortError' ? 'timeout' : 'network_error',
      providerId: provider.id,
      protocol: provider.protocol,
      error: e?.name === 'AbortError' ? '测试连接超时。' : (e?.message || '测试连接失败。'),
    };
  }
}

module.exports = {
  cleanBaseUrl,
  extractChatDelta,
  extractChatText,
  extractImageUrls,
  extractVideoUrls,
  fetchWithTimeout,
  generateChat,
  generateImage,
  generateVideo,
  providerEndpointUrl,
  readChatEventStream,
  testProvider,
  validateProvider,
};
