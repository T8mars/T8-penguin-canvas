'use strict';

const { normalizeProviderLlmTimeoutMs } = require('./providerTimeoutPolicy');
const { llmDeadline: deadline } = require('./llmDeadline');
const { providerEndpointUrl } = require('./openaiCompatible');

const queues = new Map();
const isStrata = (provider) => provider?.profile === 'strata';
function failure(code, message) { return Object.assign(new Error(message), { code }); }

function strataConnection(provider) {
  let base;
  try { base = new URL(String(provider.baseUrl || '').trim()); } catch {
    throw failure('invalid_base_url', 'Strata: 请填写实际 API 地址，而非设置页面地址。');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw failure('invalid_base_url', 'Strata: 地址仅支持 HTTP/HTTPS，不能包含凭据、查询参数或片段。');
  }
  if (!['none', 'bearer'].includes(provider.authMode)) throw failure('invalid_auth_mode', 'Strata: 请选择认证方式。');
  if (provider.authMode === 'none' && !['127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw failure('local_auth_required', 'Strata: 无认证仅允许 127.0.0.1 或 [::1]；局域网需要 API Key。');
  }
  if (provider.authMode === 'bearer' && (!provider.apiKey || /^\*{2,}/.test(provider.apiKey))) {
    throw failure('missing_api_key', 'Strata: 请填写服务端配置的 API Key。');
  }
  const path = base.pathname.replace(/\/+$/, '');
  // Root and explicit reverse-proxy prefixes share one deterministic /v1 rule.
  base.pathname = /\/v1$/.test(path) ? path : `${path}/v1`;
  const baseUrl = base.href.replace(/\/+$/, '');
  const endpoint = (path, overrideKeys = []) => {
    // Validate the exact adapter URL, including its whitespace/override precedence.
    const url = new URL(providerEndpointUrl({ ...provider, baseUrl }, path, overrideKeys));
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) {
      throw failure('invalid_endpoint', 'Strata: API 端点必须与服务地址同源且不包含凭据或查询参数。');
    }
    return url.href;
  };
  return {
    baseUrl, origin: base.origin,
    chatUrl: endpoint('chat/completions', ['chatEndpoint', 'chat_endpoint']),
    statusUrl: endpoint('status'), modelsUrl: endpoint('models'),
    healthUrl: `${baseUrl.replace(/\/v1$/, '')}/health`,
    headers: { Accept: 'application/json', ...(provider.authMode === 'bearer' ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
  };
}

async function getJson(url, connection, options) {
  const response = await (options.fetchImpl || fetch)(url, {
    headers: connection.headers, redirect: 'error', signal: options.signal,
  });
  if (!response.ok) throw failure(response.status === 401 || response.status === 403 ? 'authentication_failed' : 'discovery_http_error', `Strata: 读取服务信息失败 HTTP ${response.status}。`);
  // Bound discovery without ever retaining raw status (machine, paths, processes).
  if (Number(response.headers?.get?.('content-length')) > 1024 * 1024) throw failure('invalid_discovery', 'Strata: 服务信息过大。');
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        text += decoder.decode(part.value, { stream: true });
        if (text.length > 1024 * 1024) throw failure('invalid_discovery', 'Strata: 服务信息过大。');
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else text = await response.text();
  if (text.length > 1024 * 1024) throw failure('invalid_discovery', 'Strata: 服务信息过大。');
  try { return JSON.parse(text); } catch { throw failure('invalid_discovery', 'Strata: 接口没有返回 JSON，请检查是否填写了设置页面端口。'); }
}

async function discover(provider, options = {}) {
  const connection = strataConnection(provider);
  const health = await getJson(connection.healthUrl, connection, options);
  const status = await getJson(connection.statusUrl, connection, options);
  const catalog = await getJson(connection.modelsUrl, connection, options);
  if (health.service !== 'strata' || status.service !== 'strata' || status.protocol_version !== 1 || !Array.isArray(catalog.data)) {
    throw failure('unsupported_strata_protocol', 'Strata: 服务身份或协议版本不匹配（需要 protocol 1）。');
  }
  const cleanId = (value) => typeof value === 'string' && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';
  const vision = status.vision?.enabled === true && status.vision?.available === true;
  const models = catalog.data.filter((m) => m?.architecture?.output_modalities?.includes('text')).slice(0, 100).map((m) => ({
    id: cleanId(m.id), aliasOf: cleanId(m.alias_of),
    vision: vision && m.architecture?.input_modalities?.includes('image') === true,
  })).filter((m) => m.id);
  const canonical = cleanId(status.model);
  if (!models.length && !status.loaded && status.auto_load && canonical) models.push({ id: canonical, aliasOf: '', vision });
  if (!models.length) throw failure('model_unavailable', 'Strata: 没有可用的文本模型，请先在 Strata 配置模型。');
  return {
    service: 'strata', protocolVersion: 1, baseUrl: connection.baseUrl,
    model: canonical, models, loaded: status.loaded === true, autoLoad: status.auto_load === true,
    vision, visionLoaded: status.vision?.loaded === true,
    contextTokens: Math.max(0, Number(status.context?.native) || 0),
    instanceId: cleanId(status.instance_id), started: Number(status.started) || 0,
    inFlight: Math.max(0, Number(status.activity?.in_flight) || 0),
    structuredOutput: status.structured_output?.formats?.includes('json_object') === true,
  };
}

async function testProvider(provider, options = {}) {
  const clock = deadline(Math.min(30000, Number(options.timeoutMs) || 8000), options.signal);
  try {
    strataConnection(provider);
    if (options.dryRun) return { ok: true, code: 'dry_run_ok', providerId: provider.id, protocol: provider.protocol };
    const discovery = await clock.run(() => discover(provider, { ...options, signal: clock.signal }));
    return { ok: true, code: 'connected', providerId: provider.id, protocol: provider.protocol, discovery,
      message: `Strata: ${discovery.models.map((m) => m.id).join(', ')} · ${discovery.loaded ? '已加载' : '按需加载'} · context ${discovery.contextTokens} · vision ${discovery.vision ? 'on' : 'off'}` };
  } catch (error) { return errorResult(provider, error, options.signal); }
  finally { clock.close(); }
}

async function acquire(origin, signal, onStatus) {
  const prior = queues.get(origin) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = prior.then(() => current);
  queues.set(origin, tail);
  const clean = () => { release(); if (queues.get(origin) === tail) tail.then(() => { if (queues.get(origin) === tail) queues.delete(origin); }); };
  const waiting = deadline(normalizeProviderLlmTimeoutMs(), signal);
  try {
    onStatus?.({ phase: 'local_queue' });
    await waiting.run(() => prior);
    return clean;
  } catch (error) { clean(); throw error; }
  finally { waiting.close(); }
}

function errorResult(provider, error, signal) {
  return { ok: false, providerId: provider.id, protocol: provider.protocol,
    code: signal?.aborted ? 'request_aborted' : error.code || 'strata_network_error',
    error: signal?.aborted ? 'Strata: 已取消本次调用。' : error.message || 'Strata: 连接失败，请检查用户填写的服务地址。' };
}

async function generateChat(provider, input, options, chat) {
  let release; let clock;
  try {
    const connection = strataConnection(provider);
    release = await acquire(connection.origin, options.signal, options.onStatus);
    clock = deadline(normalizeProviderLlmTimeoutMs(options.timeoutMs), options.signal);
    return await clock.run(async () => {
      options.onStatus?.({ phase: 'preparing' });
      const discovery = await discover(provider, { ...options, signal: clock.signal });
      const model = String(input.model || input.providerModel || provider.chatModels?.[0] || '').trim();
      const selected = discovery.models.find((m) => m.id === model);
      if (!selected) throw failure('model_unavailable', 'Strata: 原模型已失效，请重新读取模型并明确选择，未切换其他模型。');
      const messages = input.messages || [{ role: 'user', content: input.prompt || '' }];
      const videoMode = input.llmVideoMode ?? input.videoMode ?? input.providerParams?.llmVideoMode ?? 'frames';
      for (const message of messages) {
        for (const part of Array.isArray(message.content) ? message.content : []) {
          if (['image_url', 'image', 'video_url', 'input_video'].includes(part?.type) && !selected.vision) throw failure('vision_unavailable', 'Strata: 当前模型未启用视觉，不能读取图片或视频抽帧。');
          if (['video_url', 'input_video'].includes(part?.type) && videoMode !== 'frames') throw failure('unsupported_video_mode', 'Strata: 当前仅支持视频抽帧观察（不含音轨），不支持 video_url 原生视频。');
          if (['input_audio', 'audio', 'strata_video'].includes(part?.type)) throw failure('unsupported_media', 'Strata: 本入口仅支持文本、图片和视频抽帧。');
        }
      }
      const maxTokens = input.max_tokens ?? input.maxTokens ?? provider.defaults?.maxTokens ?? 1024;
      if (!Number.isInteger(Number(maxTokens)) || Number(maxTokens) < 1 || (discovery.contextTokens && Number(maxTokens) >= discovery.contextTokens)) throw failure('context_budget_exceeded', 'Strata: 输出 token 预算必须为正整数且小于模型上下文，不会自动裁剪输入。');
      const format = input.response_format ?? input.responseFormat;
      if ((format?.type === 'json_object' || format === 'json_object') && !discovery.structuredOutput) throw failure('structured_output_unavailable', 'Strata: 服务未声明 JSON 输出能力。');
      const effort = input.reasoning_effort ?? input.reasoningEffort ?? provider.defaults?.reasoningEffort ?? 'none';
      if (!['none', 'low', 'medium', 'high', ''].includes(effort)) throw failure('invalid_reasoning_effort', 'Strata: 思考强度不合法。');
      return chat({ ...provider, baseUrl: connection.baseUrl, defaults: { ...provider.defaults, chatEndpoint: connection.chatUrl } }, {
        ...input, model, max_tokens: Number(maxTokens), reasoning_effort: effort,
      }, { ...options, signal: clock.signal, timeoutMs: Math.max(1, clock.end - Date.now()), deadlineAt: clock.end,
        strictCompletion: true, strictLocalMedia: true, expectedModel: selected.aliasOf || selected.id, redirect: 'error' });
    });
  } catch (error) { return errorResult(provider, error, options.signal); }
  finally { clock?.close(); release?.(); }
}

module.exports = { isStrata, strataConnection, discover, testProvider, generateChat };
