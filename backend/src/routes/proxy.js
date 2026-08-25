/**
 * 上游 API 代理路由
 * 1. 隐藏 API Key,前端只通过 /api/proxy/* 调用
 * 2. 自动注入对应的 Key(贞贞工坊 / LLM 独立)
 * 3. 图像生成结果自动转存到 /output 并返回本地 URL
 */
const express = require('express');
const crypto = require('node:crypto');
const fs = require('fs');
const net = require('node:net');
const path = require('path');
const multer = require('multer');
const { Agent: UndiciAgent } = require('undici');
const config = require('../config');
const seedanceNzLlmModels = require('../shared/seedanceNzLlmModels.json');
const { getWhitePng } = require('../utils/whitePng');
const { tryDecodeDuckPayload } = require('../utils/duckPayload');
const { normalizeLlmMessageMedia } = require('../providers/llmMedia');
const seedanceNz = require('../providers/seedanceNz');
const {
  isT8LocalMediaPath,
  normalizeT8LocalMediaRef,
  resolveMediaRef,
} = require('../providers/mediaResolver');
const {
  normalizeRhSite,
  buildRhSiteCandidates,
  shouldRetryRhSiteResponse,
  missingRhKeyError,
} = require('../providers/runninghubSite');
const { runLocalHooks } = require('../extensions/runtimeHooks');
const { redactLocalPaths } = require('../services/assetPublicView');
const { detectBinaryKind } = require('../collaboration/gatewaySecurity');
const {
  assertJsonComplexity,
  resolveTunPublicDns,
  safeRemoteJsonFetch,
  safeRemoteMediaFetch,
  safeRemoteUpload,
} = require('../utils/safeRemoteMediaFetch');
const {
  providerSubmissionContextMiddleware,
  currentProviderSubmissionKey,
  providerIdempotencyHeaders,
} = require('../services/providerSubmissionContext');
const {
  commitMaterializedOutputBuffer,
  isCommittedMaterializedOutputUrl,
} = require('../services/materializedOutputStore');

const router = express.Router();
router.use(providerSubmissionContextMiddleware);
router.use((req, res, next) => {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(Object.assign(new Error('client_disconnected'), { code: 'request_aborted' }));
  };
  const cleanup = () => {
    req.off('aborted', abort);
    res.off('close', onClose);
    res.off('finish', cleanup);
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
    cleanup();
  };
  req.t8AbortSignal = controller.signal;
  req.on('aborted', abort);
  res.on('close', onClose);
  res.on('finish', cleanup);
  next();
});

function throwIfProxyRequestAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw Object.assign(new Error('client_disconnected'), { code: 'request_aborted' });
}

function proxyAbortableDelay(delayMs, signal) {
  if (!(delayMs > 0)) return Promise.resolve();
  throwIfProxyRequestAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    const onAbort = () => done(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('client_disconnected'), { code: 'request_aborted' }));
    function done(error) {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function diagnosticDigest(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 12);
}

function opaqueDiagnosticSummary(label, value) {
  const text = String(value ?? '');
  return `${label}Length=${text.length} ${label}Sha256=${diagnosticDigest(text)}`;
}

function safeDiagnosticText(value, maximum = 240, exactSecrets = []) {
  let text = String(value ?? '');
  for (const secret of new Set((Array.isArray(exactSecrets) ? exactSecrets : [exactSecrets])
    .map((entry) => String(entry || ''))
    .filter((entry) => entry.length >= 4))) {
    text = text.split(secret).join('[redacted-secret]');
  }
  return redactLocalPaths(text)
    .replace(/(["']?\b(?:authorization|proxy-authorization|api[_-]?key|x-api-key|x-auth-token|access[_-]?token|refresh[_-]?token|session[_-]?token|token|secret|cookie|set-cookie|password|credential|signature)\b["']?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|(?:bearer|basic)\s+[^\s,;]+|[^\s,;}\]]+)/gi, '$1=[redacted]')
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, '[redacted-credential]')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)\b/g, '[redacted-token]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maximum));
}

function boundedProxyInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)));
}

const PROXY_IMAGE_REFERENCE_MAX_BYTES = boundedProxyInteger(
  process.env.T8_PROXY_IMAGE_REFERENCE_MAX_BYTES,
  64 * 1024 * 1024,
  1024 * 1024,
  512 * 1024 * 1024,
);
const PROXY_AUDIO_REFERENCE_MAX_BYTES = boundedProxyInteger(
  process.env.T8_PROXY_AUDIO_REFERENCE_MAX_BYTES,
  64 * 1024 * 1024,
  1024 * 1024,
  256 * 1024 * 1024,
);
const PROXY_MEDIA_REFERENCE_MAX_BYTES = boundedProxyInteger(
  process.env.T8_PROXY_MEDIA_REFERENCE_MAX_BYTES,
  512 * 1024 * 1024,
  1024 * 1024,
  1024 * 1024 * 1024,
);
const RUNNINGHUB_TEXT_OUTPUT_MAX_BYTES = boundedProxyInteger(
  process.env.T8_RUNNINGHUB_TEXT_OUTPUT_MAX_BYTES,
  2 * 1024 * 1024,
  16 * 1024,
  16 * 1024 * 1024,
);
const PROXY_PROVIDER_JSON_MAX_BYTES = boundedProxyInteger(
  process.env.T8_PROXY_PROVIDER_JSON_MAX_BYTES,
  2 * 1024 * 1024,
  64 * 1024,
  8 * 1024 * 1024,
);
const PROXY_PROVIDER_JSON_MAX_DEPTH = 64;
const PROXY_PROVIDER_JSON_MAX_NODES = 50_000;
const PROXY_PROVIDER_SSE_MAX_BYTES = 32 * 1024 * 1024;
const PROXY_PROVIDER_SSE_MAX_LINE_BYTES = 2 * 1024 * 1024;
const FAL_GLTF_JSON_MAX_BYTES = 16 * 1024 * 1024;
const PROXY_REMOTE_DEADLINE_MS = boundedProxyInteger(
  process.env.T8_PROXY_REMOTE_DEADLINE_MS,
  90_000,
  1_000,
  5 * 60_000,
);
// Seedream V5 Pro is a synchronous image endpoint. High-resolution requests
// can legitimately take longer than the generic Provider boundary before the
// first response header arrives, so only this protocol receives a longer
// deadline. All other Provider calls retain the 90-second default above.
const SEEDREAM_V5_RESPONSE_DEADLINE_MS = boundedProxyInteger(
  process.env.T8_SEEDREAM_V5_RESPONSE_DEADLINE_MS,
  5 * 60_000,
  30_000,
  10 * 60_000,
);
const PROXY_REMOTE_IDLE_TIMEOUT_MS = boundedProxyInteger(
  process.env.T8_PROXY_REMOTE_IDLE_TIMEOUT_MS,
  15_000,
  1_000,
  60_000,
);
const PROVIDER_CONNECT_TIMEOUT_MS = boundedProxyInteger(
  process.env.T8_PROVIDER_CONNECT_TIMEOUT_MS,
  15_000,
  500,
  30_000,
);
const PROVIDER_NETWORK_RETRY_DELAY_MS = boundedProxyInteger(
  process.env.T8_PROVIDER_NETWORK_RETRY_DELAY_MS,
  3_000,
  0,
  30_000,
);
const FAL_POLL_MAX_BYTES = 2 * 1024 * 1024;
const FAL_POLL_MAX_JSON_DEPTH = 64;
const FAL_POLL_MAX_JSON_NODES = 50_000;
let proxySafeRemoteTestOptions = null;
const providerResponseTimings = new WeakMap();
let providerDispatcher = null;
let providerPublicDnsDispatcher = null;

const PROVIDER_NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function providerPublicDnsLookup(
  hostname,
  options,
  callback,
  resolvePublicDns = resolveTunPublicDns,
) {
  const literalFamily = net.isIP(String(hostname || ''));
  if (literalFamily) {
    if (options?.all === true) {
      callback(null, [{ address: String(hostname), family: literalFamily }]);
    } else {
      callback(null, String(hostname), literalFamily);
    }
    return;
  }
  resolvePublicDns(hostname)
    .then((records) => {
      const candidates = [...records].sort((left, right) => {
        if (Number(left?.family) === Number(right?.family)) return 0;
        return Number(left?.family) === 4 ? -1 : 1;
      });
      if (!candidates.length) {
        callback(Object.assign(new Error('公共 DNS 未返回可用地址'), {
          code: 'TUN_DNS_FALLBACK_FAILED',
        }));
        return;
      }
      if (options?.all === true) {
        callback(null, candidates);
        return;
      }
      callback(null, candidates[0].address, candidates[0].family);
    })
    .catch((error) => callback(error));
}

function createProviderDispatcher(options = {}) {
  const usePublicDns = options.publicDns === true;
  return new UndiciAgent({
    // This dispatcher is a recovery path only. The first request deliberately
    // uses the runtime's native fetch path (the same behavior as v2.5.3) so
    // system proxies, transparent TUN routing and platform DNS keep working.
    // A recovery socket must never reuse a connection opened before a route
    // switch, therefore keep-alive is disabled here.
    pipelining: 0,
    connectTimeout: Math.min(PROXY_REMOTE_DEADLINE_MS, PROVIDER_CONNECT_TIMEOUT_MS),
    // Let Undici race usable IPv4/IPv6 addresses instead of getting stuck on
    // an enabled-but-unroutable IPv6 interface after a TUN/VPN switch.
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    ...(usePublicDns ? {
      // The first attempt always honors the active system/TUN resolver. Only
      // after that path fails do read-only task queries use independent public
      // DNS, which recovers from stale Fake-IP and broken IPv6 resolver state.
      connect: { lookup: providerPublicDnsLookup },
    } : {}),
  });
}

function currentProviderDispatcher(publicDns = false) {
  if (publicDns) {
    if (!providerPublicDnsDispatcher) {
      providerPublicDnsDispatcher = createProviderDispatcher({ publicDns: true });
    }
    return providerPublicDnsDispatcher;
  }
  if (!providerDispatcher) providerDispatcher = createProviderDispatcher();
  return providerDispatcher;
}

function rotateProviderDispatcher() {
  const previous = [providerDispatcher, providerPublicDnsDispatcher].filter(Boolean);
  providerDispatcher = null;
  providerPublicDnsDispatcher = null;
  for (const dispatcher of previous) void dispatcher.close().catch(() => {});
}

async function resetProviderDispatcherForTests() {
  const previous = [providerDispatcher, providerPublicDnsDispatcher].filter(Boolean);
  providerDispatcher = null;
  providerPublicDnsDispatcher = null;
  await Promise.all(previous.map((dispatcher) => dispatcher.close().catch(() => {})));
}

function providerNetworkCause(error) {
  let current = error;
  let depth = 0;
  while (current?.cause && current.cause !== current && depth < 8) {
    current = current.cause;
    depth += 1;
  }
  return current || error;
}

function isProviderNetworkError(error) {
  const cause = providerNetworkCause(error);
  const code = String(cause?.code || error?.code || '').trim().toUpperCase();
  const message = String(cause?.message || error?.message || '').toLowerCase();
  return PROVIDER_NETWORK_ERROR_CODES.has(code)
    || /fetch failed|failed to fetch|network error|socket|connect/.test(message);
}

function providerNetworkFailure(error, label, options = {}) {
  const cause = providerNetworkCause(error);
  const causeCode = String(cause?.code || error?.code || '').trim().toUpperCase();
  const diagnosticCode = causeCode || 'NETWORK_ERROR';
  const retryAttempted = options.retryAttempted === true;
  let message;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(causeCode)) {
    message = retryAttempted
      ? `${label}：系统网络与全新连接仍无法解析 API 平台域名（${diagnosticCode}）。原任务不会重复提交，请在 3 秒后重试。`
      : `${label}：系统网络暂时无法解析 API 平台域名（${diagnosticCode}）。应用已刷新连接；请在 3 秒后重试原节点。`;
  } else if (/certificate|cert_|self signed|unable to verify|tls|ssl/i.test(`${causeCode} ${cause?.message || ''}`)) {
    message = `${label}：HTTPS 证书校验失败。请检查系统时间、代理证书或安全软件的 HTTPS 扫描。`;
  } else {
    message = retryAttempted
      ? `${label}：系统网络与全新连接均未能访问 API 平台（${diagnosticCode}）。原任务不会重复提交，请在 3 秒后重试。`
      : `${label}：本机到 API 平台的连接中断（${diagnosticCode}）。应用已刷新连接；请在 3 秒后重试原节点。`;
  }
  return providerResponseError(
    'provider_network_unavailable',
    message,
    {
      status: 503,
      causeCode: diagnosticCode,
      recoverable: true,
      retryAfterMs: PROVIDER_NETWORK_RETRY_DELAY_MS,
      retryAttempted,
    },
  );
}

function proxySafeRemoteOptions(base) {
  if (!proxySafeRemoteTestOptions) return base;
  return {
    ...base,
    ...proxySafeRemoteTestOptions,
    headers: {
      ...(base.headers || {}),
      ...(proxySafeRemoteTestOptions.headers || {}),
    },
  };
}

function setProxySafeRemoteTestOptions(options) {
  proxySafeRemoteTestOptions = options && typeof options === 'object' ? { ...options } : null;
}

function providerFetchDeadlineMs(options = {}) {
  return boundedProxyInteger(
    proxySafeRemoteTestOptions?.providerDeadlineMs ?? options?.deadlineMs,
    PROXY_REMOTE_DEADLINE_MS,
    10,
    10 * 60_000,
  );
}

function providerRetryDelayMs() {
  return boundedProxyInteger(
    proxySafeRemoteTestOptions?.providerRetryDelayMs,
    PROVIDER_NETWORK_RETRY_DELAY_MS,
    0,
    30_000,
  );
}

async function fetchProviderResponse(url, init = {}, label = 'Provider', options = {}) {
  const deadlineMs = providerFetchDeadlineMs(options);
  const deadlineAt = Date.now() + deadlineMs;
  const upstreamSignal = init?.signal;
  const method = String(init?.method || 'GET').trim().toUpperCase();
  const safeReadRequest = (method === 'GET' || method === 'HEAD') && !init?.body;
  const maxAttempts = options?.noRetry === true
    ? 1
    : safeReadRequest || options?.retryNetwork === true ? 2 : 1;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw providerResponseTimeout(label, 'deadline');
    const controller = new AbortController();
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) abortFromUpstream();
    else upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true });

    let timeout;
    let timeoutError = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timeoutError = providerResponseTimeout(label, 'deadline');
        controller.abort(timeoutError);
        reject(timeoutError);
      }, remaining);
    });
    try {
      const requestHeaders = providerIdempotencyHeaders(init?.headers, method);
      const explicitDispatcher = init?.dispatcher;
      const recoveryDispatcher = explicitDispatcher
        || (attempt > 0 ? currentProviderDispatcher(false) : null);
      const requestInit = {
        ...init,
        headers: requestHeaders,
        signal: controller.signal,
      };
      // Do not force a custom Undici dispatcher on the primary request.
      // Packaged Electron installs a fetch bridge before loading the backend,
      // so this attempt uses Chromium's native networking stack and therefore
      // the real Windows proxy/PAC/TUN/IPv4/IPv6 configuration. Standalone
      // development retains Node fetch. The recovery request below deliberately
      // uses an explicit Undici dispatcher and therefore a fresh Node socket.
      if (recoveryDispatcher) requestInit.dispatcher = recoveryDispatcher;
      else delete requestInit.dispatcher;
      const response = await Promise.race([
        fetch(url, requestInit),
        timeoutPromise,
      ]);
      if (response && typeof response === 'object') {
        providerResponseTimings.set(response, { deadlineAt, label });
      }
      return response;
    } catch (error) {
      if (timeoutError) throw timeoutError;
      if (upstreamSignal?.aborted) throw upstreamSignal.reason || error;
      if (!isProviderNetworkError(error)) throw error;
      lastError = error;
      rotateProviderDispatcher();
      if (attempt + 1 >= maxAttempts) {
        throw providerNetworkFailure(error, label, { retryAttempted: attempt > 0 });
      }
      const retryDelay = providerRetryDelayMs();
      if (retryDelay > 0) {
        const retryRemaining = deadlineAt - Date.now();
        if (retryRemaining <= retryDelay) throw providerResponseTimeout(label, 'deadline');
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      upstreamSignal?.removeEventListener?.('abort', abortFromUpstream);
    }
  }
  throw providerNetworkFailure(lastError, label, { retryAttempted: maxAttempts > 1 });
}

function proxyErrorStatus(error, fallback = 500) {
  const status = Number(error?.status);
  return status >= 400 && status < 600 ? status : fallback;
}

function proxyRouteError(label, error, exactSecrets = []) {
  console.error(`${label}:`, safeDiagnosticText(error?.message || error || 'unknown error', 240, exactSecrets));
}

function proxyPublicError(error, fallback = '请求失败', exactSecrets = []) {
  const safe = safeDiagnosticText(error?.message || '', 300, exactSecrets);
  return safe || fallback;
}

function isRecoverableTaskResultQueryError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return error?.recoverable === true
    || code === 'PROVIDER_NETWORK_UNAVAILABLE'
    || code === 'PROVIDER_RESPONSE_TIMEOUT'
    || code === 'SEEDANCE_UPSTREAM_UNAVAILABLE'
    || code === 'SEEDANCE_UPSTREAM_TIMEOUT'
    || code === 'SEEDANCE_REQUEST_ABORTED'
    || code === 'CONNECT_TIMEOUT'
    || code === 'FETCH_TIMEOUT'
    || code === 'TUN_DNS_FALLBACK_FAILED'
    || code === 'TUN_DNS_FALLBACK_DOH_TIMEOUT'
    || code === 'REMOTE_CONNECT_FAILED'
    || isProviderNetworkError(error);
}

function sendTaskResultQueryRecovery(res, error, options = {}) {
  if (!isRecoverableTaskResultQueryError(error)) return false;
  const taskId = String(options.taskId || '').trim();
  const retryAfterMs = Math.max(
    500,
    Number(error?.retryAfterMs) || PROVIDER_NETWORK_RETRY_DELAY_MS,
  );
  const status = String(options.status || 'MATERIALIZING');
  const message = '后台任务和生成结果仍然保留；当前仅结果查询或下载连接中断。正在使用原任务 ID 自动重新获取，不会重新生成，也不会重复扣费。';
  res.status(202).json({
    success: true,
    code: 'task_result_query_recovering',
    message,
    data: {
      ...(options.data && typeof options.data === 'object' ? options.data : {}),
      ...(taskId ? { taskId } : {}),
      status,
      progress: '100% · 正在重新获取结果',
      recoverable: true,
      retryAfterMs,
      code: 'task_result_query_recovering',
      error: message,
    },
  });
  return true;
}

function normalizedContentType(value) {
  const normalized = String(value || '').trim().toLowerCase().split(';')[0];
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (['audio/x-wav', 'audio/vnd.wave'].includes(normalized)) return 'audio/wav';
  if (['audio/mp3', 'audio/x-mp3'].includes(normalized)) return 'audio/mpeg';
  if (normalized === 'audio/x-m4a') return 'audio/mp4';
  if (normalized === 'audio/x-flac') return 'audio/flac';
  if (normalized === 'application/ogg') return 'audio/ogg';
  return normalized;
}

const ISO_BMFF_CONTAINER_BOXES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta',
]);

function inspectIsoBmffHandlerTypes(buffer) {
  const handlers = new Set();
  let visited = 0;
  const walk = (start, end, depth) => {
    if (depth > 8 || visited > 10_000) return;
    let offset = start;
    while (offset + 8 <= end && visited <= 10_000) {
      visited += 1;
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      let headerBytes = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        const extended = buffer.readBigUInt64BE(offset + 8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(extended);
        headerBytes = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerBytes || offset + size > end) return;
      if (type === 'hdlr' && size >= headerBytes + 12) {
        handlers.add(buffer.toString('ascii', offset + headerBytes + 8, offset + headerBytes + 12));
      }
      if (ISO_BMFF_CONTAINER_BOXES.has(type)) {
        const fullBoxBytes = type === 'meta' ? 4 : 0;
        const childStart = offset + headerBytes + fullBoxBytes;
        if (childStart <= offset + size) walk(childStart, offset + size, depth + 1);
      }
      offset += size;
    }
  };
  walk(0, buffer.length, 0);
  return handlers;
}

function detectProxyMediaMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if ((buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])))
    || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return 'image/tiff';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    const riffKind = buffer.subarray(8, 12).toString('ascii');
    if (riffKind === 'WEBP') return 'image/webp';
    if (riffKind === 'WAVE') return 'audio/wav';
    if (riffKind === 'AVI ') return 'video/x-msvideo';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  if (buffer.length >= 16 && buffer.subarray(0, 16).equals(Buffer.from([
    0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
    0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
  ]))) return 'audio/x-ms-wma';
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    const handlers = inspectIsoBmffHandlerTypes(buffer);
    if (handlers.has('soun') && !handlers.has('vide')) return 'audio/mp4';
    if (handlers.has('vide')) return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    if (['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/avif';
    if (['m4a ', 'm4b ', 'm4p '].includes(brand)) return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const ebmlHeader = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1').toLowerCase();
    if (ebmlHeader.includes('matroska')) return 'video/x-matroska';
    if (ebmlHeader.includes('webm')) return 'video/webm';
  }
  return '';
}

function detectProxyMediaKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return null;
  const mime = detectProxyMediaMime(buffer);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return detectBinaryKind(buffer);
}

function mediaKindAllowed(detectedKind, allowedKinds) {
  if (allowedKinds.has(detectedKind)) return true;
  return detectedKind === 'video-audio' && (allowedKinds.has('video') || allowedKinds.has('audio'));
}

function declaredMediaKind(contentType) {
  const normalized = normalizedContentType(contentType);
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (!normalized || normalized === 'application/octet-stream' || normalized === 'binary/octet-stream') return null;
  return 'unsupported';
}

function proxyMediaKindForMime(contentType) {
  const kind = declaredMediaKind(contentType);
  return kind && kind !== 'unsupported' ? kind : null;
}

function proxyMediaFallbackMime(kind) {
  if (kind === 'image') return 'image/png';
  if (kind === 'video') return 'video/mp4';
  if (kind === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function proxyMediaSourceHint(sourceName) {
  const clean = String(sourceName || '').split(/[?#]/)[0];
  const mime = normalizedContentType(mimeTypeForProxyFilename(clean));
  const kind = proxyMediaKindForMime(mime);
  return { mime: kind ? mime : '', kind };
}

function looksLikeProxyNonMediaResponse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  const lower = sample.toLowerCase();
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/.test(lower)) return true;
  if (/^(?:error\b|failed\b|failure\b|invalid\b|forbidden\b|unauthorized\b|access denied\b|bad gateway\b|gateway timeout\b|service unavailable\b|upstream\b.*\berror\b|not\s+(?:an?\s+)?(?:image|video|audio|media)\b)/i.test(sample)) {
    return true;
  }
  if (!sample.startsWith('{') && !sample.startsWith('[')) return false;
  try {
    JSON.parse(buffer.toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

function validateProxyMediaBuffer(buffer, contentType, options = {}) {
  const allowedKinds = new Set(options.allowedKinds || ['image', 'video', 'audio']);
  const maximum = Number(options.maxBytes) || PROXY_MEDIA_REFERENCE_MAX_BYTES;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('远程素材为空');
  if (buffer.length > maximum) throw new Error(`远程素材超过 ${maximum} bytes 限制`);
  const detectedKind = detectProxyMediaKind(buffer);
  const detectedMime = detectProxyMediaMime(buffer);
  if (detectedKind === 'archive') throw new Error('远程素材不能是 ZIP/归档容器');
  if (looksLikeProxyNonMediaResponse(buffer)) throw new Error('远程地址返回了 HTML/JSON 错误内容，不是媒体文件');
  const declaredMime = normalizedContentType(contentType);
  const sourceHint = proxyMediaSourceHint(options.sourceName);

  // Compatibility-first, matching the v2.5.3 behaviour: a positive signature
  // corrects stale MIME/filename metadata instead of rejecting readable media.
  // Unknown legacy/new codecs fall back to MIME, filename, or caller context.
  if (detectedKind && !mediaKindAllowed(detectedKind, allowedKinds)) {
    throw new Error('素材实际类型与当前节点需要的媒体类型不一致');
  }
  let mediaKind = detectedKind;
  if (mediaKind === 'video-audio') {
    const hintedKind = [proxyMediaKindForMime(declaredMime), sourceHint.kind]
      .find((kind) => kind && allowedKinds.has(kind));
    mediaKind = hintedKind || (allowedKinds.has('video') ? 'video' : 'audio');
  }
  if (!mediaKind) {
    const hintedKind = [proxyMediaKindForMime(declaredMime), sourceHint.kind]
      .find((kind) => kind && allowedKinds.has(kind));
    mediaKind = hintedKind || (allowedKinds.size === 1 ? [...allowedKinds][0] : null);
  }
  if (!mediaKind && allowedKinds.size > 0) mediaKind = [...allowedKinds][0];
  if (!mediaKindAllowed(mediaKind, allowedKinds)) throw new Error('素材类型不在当前节点支持范围内');
  const effectiveMime = detectedMime
    || (proxyMediaKindForMime(declaredMime) === mediaKind ? declaredMime : '')
    || (sourceHint.kind === mediaKind ? sourceHint.mime : '')
    || proxyMediaFallbackMime(mediaKind);
  return {
    detectedKind,
    detectedMime,
    declaredMime,
    mediaKind,
    contentType: effectiveMime,
    contentTypeMismatch: !!declaredMime && !!detectedMime && declaredMime !== detectedMime,
  };
}

async function fetchProxyRemoteMedia(url, options = {}) {
  const maximum = Number(options.maxBytes) || PROXY_MEDIA_REFERENCE_MAX_BYTES;
  const deadlineMs = Number(options.deadlineMs) > 0
    ? Number(options.deadlineMs)
    : PROXY_REMOTE_DEADLINE_MS;
  const idleTimeoutMs = Number(options.idleTimeoutMs) > 0
    ? Number(options.idleTimeoutMs)
    : PROXY_REMOTE_IDLE_TIMEOUT_MS;
  const remote = await safeRemoteMediaFetch(url, proxySafeRemoteOptions({
    maxBytes: maximum,
    deadlineMs,
    trustedProviderFallbackDeadlineMs: Number(options.trustedProviderFallbackDeadlineMs) > 0
      ? Number(options.trustedProviderFallbackDeadlineMs)
      : undefined,
    trustedProviderOutput: options.trustedProviderOutput === true,
    connectTimeoutMs: Number(options.connectTimeoutMs) > 0
      ? Number(options.connectTimeoutMs)
      : undefined,
    idleTimeoutMs,
    maxRedirects: 4,
    accept: options.accept || 'image/*,video/*,audio/*,application/octet-stream;q=0.5',
    userAgent: 'T8-PenguinCanvas-ProviderProxy/1.0',
    signal: options.signal,
  }));
  throwIfProxyRequestAborted(options.signal);
  const verified = validateProxyMediaBuffer(remote.buffer, remote.contentType, {
    allowedKinds: options.allowedKinds,
    maxBytes: maximum,
    sourceName: remote.finalUrl || remote.url || url,
  });
  return { ...remote, ...verified };
}

async function fetchFalPollJson(url, apiKey, signal) {
  return safeRemoteJsonFetch(url, proxySafeRemoteOptions({
    trustedProviderOutput: true,
    maxBytes: FAL_POLL_MAX_BYTES,
    maxJsonDepth: FAL_POLL_MAX_JSON_DEPTH,
    maxJsonNodes: FAL_POLL_MAX_JSON_NODES,
    deadlineMs: PROXY_REMOTE_DEADLINE_MS,
    idleTimeoutMs: PROXY_REMOTE_IDLE_TIMEOUT_MS,
    maxRedirects: 4,
    accept: 'application/json',
    userAgent: 'T8-PenguinCanvas-FAL-Poll/1.0',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  }));
}

function comparableFilesystemPath(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathIsStrictlyInside(root, target) {
  const comparableRoot = comparableFilesystemPath(root);
  const comparableTarget = comparableFilesystemPath(target);
  return comparableTarget !== comparableRoot && comparableTarget.startsWith(`${comparableRoot}${path.sep}`);
}

function pathChainContainsSymbolicLink(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return true;
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function realpathInsideRoot(root, target) {
  try {
    const rootResolved = path.resolve(root);
    const targetResolved = path.resolve(target);
    if (!pathIsStrictlyInside(rootResolved, targetResolved)) return null;
    // Mounted media references never need symlinks/junctions. Rejecting the
    // complete path chain removes reparse-point escapes before opening a file.
    if (pathChainContainsSymbolicLink(rootResolved, targetResolved)) return null;
    const rootReal = fs.realpathSync(rootResolved);
    const targetReal = fs.realpathSync(targetResolved);
    if (!pathIsStrictlyInside(rootReal, targetReal)) return null;
    const stat = fs.statSync(targetReal);
    return stat.isFile() ? {
      filename: targetReal,
      root: rootReal,
      size: stat.size,
      identity: { dev: stat.dev, ino: stat.ino },
    } : null;
  } catch (_) {
    return null;
  }
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function readResolvedFile(resolved, maximum = PROXY_MEDIA_REFERENCE_MAX_BYTES) {
  if (!resolved?.filename || !resolved?.root) return null;
  const maxBytes = Math.max(1, Number(maximum) || PROXY_MEDIA_REFERENCE_MAX_BYTES);
  let fd;
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
    fd = fs.openSync(resolved.filename, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size <= 0 || opened.size > maxBytes) return null;

    // Verify that the opened handle still names the same in-root file that was
    // resolved. This closes the stat/realpath -> read symlink-swap window.
    const currentReal = fs.realpathSync(resolved.filename);
    if (!pathIsStrictlyInside(resolved.root, currentReal)) return null;
    const current = fs.statSync(currentReal);
    if (!sameFileIdentity(opened, current) || !sameFileIdentity(opened, resolved.identity)) return null;

    const chunks = [];
    const scratch = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    while (total <= maxBytes) {
      const remaining = Math.min(scratch.length, (maxBytes + 1) - total);
      const read = fs.readSync(fd, scratch, 0, remaining, total);
      if (read === 0) break;
      chunks.push(Buffer.from(scratch.subarray(0, read)));
      total += read;
    }
    if (total <= 0 || total > maxBytes) return null;
    const after = fs.fstatSync(fd);
    if (!after.isFile() || after.size <= 0 || after.size > maxBytes || !sameFileIdentity(opened, after)) return null;
    return { ...resolved, filename: currentReal, size: total, buffer: Buffer.concat(chunks, total) };
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function resolveMountedFileReference(value, mounts, maximum = PROXY_MEDIA_REFERENCE_MAX_BYTES) {
  const raw = String(value || '').trim().split(/[?#]/)[0];
  if (!raw || raw.includes('\0')) return null;
  for (const mount of mounts) {
    const prefix = (mount.prefixes || []).find((candidate) => raw.startsWith(candidate));
    if (!prefix) continue;
    const encodedTail = raw.slice(prefix.length);
    let relative;
    try { relative = decodeURIComponent(encodedTail); } catch (_) { return null; }
    if (!relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) return null;
    const segments = relative.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    const resolved = realpathInsideRoot(mount.root, path.join(mount.root, ...segments));
    if (!resolved || resolved.size <= 0 || resolved.size > maximum) return null;
    return resolved;
  }
  return null;
}

function readMountedFileReference(value, mounts, maximum = PROXY_MEDIA_REFERENCE_MAX_BYTES) {
  const resolved = resolveMountedFileReference(value, mounts, maximum);
  return readResolvedFile(resolved, maximum);
}

// 音频文件上传中间件(内存存储, 50MB)
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function safeMultipartFilename(value) {
  const name = path.basename(String(value || 'audio.bin'))
    .replace(/[\r\n"\\]/g, '_')
    .slice(0, 240);
  return name || 'audio.bin';
}

function safeAudioUploadFilename(value, extension) {
  const original = path.basename(String(value || 'audio'));
  const originalExt = path.extname(original);
  const stem = path.basename(original, originalExt)
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180) || 'audio';
  return `${stem}.${safeOutputExt(extension, 'mp3')}`;
}

function buildSignedAudioMultipart(fields, audioBuffer, contentType, filename) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('上传表单 fields 格式无效');
  const entries = Object.entries(fields);
  if (entries.length > 128) throw new Error('上传表单 fields 数量过多');
  const boundary = `----T8PenguinCanvas${crypto.randomBytes(18).toString('hex')}`;
  const parts = [];
  let metadataBytes = 0;
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || '');
    if (!/^[A-Za-z0-9_.-]{1,256}$/.test(name)) throw new Error('上传表单字段名无效');
    const value = String(rawValue ?? '');
    const part = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    metadataBytes += part.length;
    if (metadataBytes > 1024 * 1024) throw new Error('上传表单字段总大小超过限制');
    parts.push(part);
  }
  const safeName = safeMultipartFilename(filename);
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ));
  parts.push(audioBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, parts };
}

async function uploadAudioToSignedUrl({ uploadUrl, fields, audioBuffer, contentType, filename }) {
  const common = {
    deadlineMs: PROXY_REMOTE_DEADLINE_MS,
    idleTimeoutMs: PROXY_REMOTE_IDLE_TIMEOUT_MS,
    maxResponseBytes: 64 * 1024,
    maxRequestBytes: 52 * 1024 * 1024,
    userAgent: 'T8-PenguinCanvas-SignedUpload/1.0',
    accept: 'application/json,text/plain,*/*;q=0.1',
    protocols: ['https:'],
  };
  if (fields && typeof fields === 'object' && !Array.isArray(fields) && Object.keys(fields).length > 0) {
    const multipart = buildSignedAudioMultipart(fields, audioBuffer, contentType, filename);
    return safeRemoteUpload(uploadUrl, proxySafeRemoteOptions({
      ...common,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${multipart.boundary}` },
      bodyParts: multipart.parts,
    }));
  }
  return safeRemoteUpload(uploadUrl, proxySafeRemoteOptions({
    ...common,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    bodyParts: [audioBuffer],
  }));
}

function safeOutputExt(ext, fallback = 'png') {
  const s = String(ext || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  return s || fallback;
}

function extFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
    'image/tiff': 'tif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'video/x-matroska': 'mkv',
    'video/x-msvideo': 'avi',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/x-ms-wma': 'wma',
  };
  return map[ct] || '';
}

function verifiedProxyMediaExtension(media) {
  const mimeExtension = extFromContentType(media?.detectedMime || media?.contentType);
  if (mimeExtension) return mimeExtension;
  const sourceMime = mimeTypeForProxyFilename(
    media?.finalUrl || media?.url || media?.filename || media?.sourceName || '',
  );
  const sourceExtension = extFromContentType(sourceMime);
  if (sourceExtension) return sourceExtension;
  const kind = media?.mediaKind || media?.detectedKind;
  if (kind === 'image') return 'png';
  if (kind === 'video') return 'mp4';
  if (kind === 'audio') return 'mp3';
  throw new Error('素材无法确定可保存的媒体扩展名');
}

function mimeTypeForProxyFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

// Mounted canvas files have already crossed the app's controlled upload/output
// boundary. Prefer recognized bytes, while allowing old/new codecs to fall back
// to MIME, filename, or the media kind required by the consuming node.
function validateMountedMediaBuffer(buffer, filename, options = {}) {
  const verified = validateProxyMediaBuffer(
    buffer,
    mimeTypeForProxyFilename(filename),
    {
      allowedKinds: options.allowedKinds,
      maxBytes: options.maxBytes,
      sourceName: filename,
    },
  );
  return {
    ...verified,
    contentType: verified.contentType,
  };
}

function providerResponseError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function cancelProviderResponseBody(body) {
  try {
    if (typeof body?.cancel === 'function') await body.cancel();
    else if (typeof body?.destroy === 'function') body.destroy();
  } catch (_) {}
}

function providerResponseTimeout(label, timeoutKind) {
  return providerResponseError(
    'provider_response_timeout',
    `${label} 响应读取${timeoutKind === 'deadline' ? '超过总时限' : '长时间无数据'}`,
    { status: 504 },
  );
}

async function waitForProviderBodyStep(promise, timing, label) {
  const remaining = timing.deadlineAt - Date.now();
  if (remaining <= 0) throw providerResponseTimeout(label, 'deadline');
  const waitMs = Math.max(1, Math.min(remaining, timing.idleTimeoutMs));
  const timeoutKind = remaining <= timing.idleTimeoutMs ? 'deadline' : 'idle';
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(providerResponseTimeout(label, timeoutKind)), waitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBoundedProviderResponse(response, label, options = {}) {
  const maximum = boundedProxyInteger(
    options.maxBytes,
    PROXY_PROVIDER_JSON_MAX_BYTES,
    1,
    8 * 1024 * 1024,
  );
  const deadlineMs = boundedProxyInteger(options.deadlineMs, PROXY_REMOTE_DEADLINE_MS, 10, 5 * 60_000);
  const idleTimeoutMs = boundedProxyInteger(options.idleTimeoutMs, PROXY_REMOTE_IDLE_TIMEOUT_MS, 10, 60_000);
  const inheritedDeadlineAt = Number(options.deadlineAt || providerResponseTimings.get(response)?.deadlineAt);
  const timing = {
    deadlineAt: Number.isFinite(inheritedDeadlineAt) && inheritedDeadlineAt > 0
      ? inheritedDeadlineAt
      : Date.now() + deadlineMs,
    idleTimeoutMs,
  };
  if (timing.deadlineAt <= Date.now()) {
    await cancelProviderResponseBody(response.body);
    throw providerResponseTimeout(label, 'deadline');
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    await cancelProviderResponseBody(response.body);
    throw providerResponseError(
      'provider_response_too_large',
      `${label} 响应超过 ${maximum} bytes 限制`,
      { status: Number(response.status || 0) },
    );
  }
  const chunks = [];
  let total = 0;
  const append = (value) => {
    const chunk = Buffer.isBuffer(value)
      ? value
      : (value instanceof Uint8Array
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : Buffer.from(value));
    total += chunk.length;
    if (total > maximum) {
      throw providerResponseError(
        'provider_response_too_large',
        `${label} 响应超过 ${maximum} bytes 限制`,
        { status: Number(response.status || 0) },
      );
    }
    chunks.push(chunk);
  };
  try {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await waitForProviderBodyStep(reader.read(), timing, label);
          if (done) break;
          append(value);
        }
      } catch (error) {
        try { await reader.cancel(error); } catch (_) {}
        throw error;
      } finally {
        reader.releaseLock?.();
      }
    } else if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
      const iterator = response.body[Symbol.asyncIterator]();
      try {
        while (true) {
          const { done, value } = await waitForProviderBodyStep(iterator.next(), timing, label);
          if (done) break;
          append(value);
        }
      } catch (error) {
        // A Node Readable can keep iterator.return() pending while next() is
        // outstanding. Destroy first so the pending read wakes and releases
        // the socket before awaiting iterator cleanup.
        await cancelProviderResponseBody(response.body);
        try { await iterator.return?.(); } catch (_) {}
        throw error;
      }
    } else if (typeof response.arrayBuffer === 'function') {
      append(Buffer.from(await waitForProviderBodyStep(response.arrayBuffer(), timing, label)));
    } else {
      append(Buffer.from(await waitForProviderBodyStep(response.text(), timing, label), 'utf8'));
    }
  } catch (error) {
    await cancelProviderResponseBody(response.body);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

async function parseJsonResponse(response, label, options = {}) {
  const buffer = await readBoundedProviderResponse(response, label, options);
  const trimmed = buffer.toString('utf8').trim();
  if (!trimmed) return {};
  try {
    return assertJsonComplexity(JSON.parse(trimmed), {
      maxJsonDepth: options.maxJsonDepth || PROXY_PROVIDER_JSON_MAX_DEPTH,
      maxJsonNodes: options.maxJsonNodes || PROXY_PROVIDER_JSON_MAX_NODES,
    });
  } catch (error) {
    if (error?.code === 'json_too_complex') throw error;
    const contentType = response.headers?.get?.('content-type') || 'unknown';
    const bodySummary = opaqueDiagnosticSummary('body', trimmed);
    const err = new Error(`${label} 返回非 JSON：HTTP ${response.status} ${contentType} · ${bodySummary}`);
    err.status = response.status;
    err.contentType = contentType;
    err.bodySummary = bodySummary;
    throw err;
  }
}

function isRunningHubOutputUrl(value) {
  return /^(https?:\/\/|data:(image|video|audio)\/|\/files\/|\/output\/|\/input\/)/i.test(String(value || '').trim());
}

const RUNNINGHUB_OUTPUT_URL_KEYS = [
  'fileUrl',
  'file_url',
  'url',
  'src',
  'href',
  'downloadUrl',
  'download_url',
  'resultUrl',
  'result_url',
  'outputUrl',
  'output_url',
  'imageUrl',
  'image_url',
  'videoUrl',
  'video_url',
  'audioUrl',
  'audio_url',
  'ossUrl',
  'oss_url',
  'signedUrl',
  'signed_url',
  'publicUrl',
  'public_url',
  'originUrl',
  'origin_url',
  'originalUrl',
  'original_url',
  'previewUrl',
  'preview_url',
  'thumbnailUrl',
  'thumbnail_url',
  'thumbUrl',
  'thumb_url',
  'largeImageUrl',
  'large_image_url',
  'file',
  'path',
  'fileName',
  'file_name',
  'filename',
];

function collectRunningHubOutputItems(value, out = [], seen = new Set()) {
  const pushRemote = (remote, source = {}) => {
    const text = String(remote || '').trim();
    if (!text || !isRunningHubOutputUrl(text) || seen.has(text)) return;
    seen.add(text);
    out.push({
      ...source,
      fileUrl: text,
      url: text,
      fileType: source.fileType || source.file_type || source.type || '',
    });
  };
  if (value == null) return out;
  if (typeof value === 'string') {
    pushRemote(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRunningHubOutputItems(item, out, seen);
    return out;
  }
  if (typeof value !== 'object') return out;

  for (const key of RUNNINGHUB_OUTPUT_URL_KEYS) {
    if (typeof value[key] === 'string') pushRemote(value[key], value);
  }

  for (const child of Object.values(value)) {
    collectRunningHubOutputItems(child, out, seen);
  }
  return out;
}

const RUNNINGHUB_TEXT_OUTPUT_TYPES = new Set([
  'txt',
  'text',
  'string',
  'md',
  'markdown',
  'json',
  'csv',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

function normalizedRunningHubOutputType(item) {
  return String(
    item?.fileType
      || item?.file_type
      || item?.contentType
      || item?.content_type
      || item?.mimeType
      || item?.mime_type
      || item?.type
      || '',
  )
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .split(';')[0]
    .trim();
}

function runningHubOutputUrlExtension(item) {
  const remote = String(
    item?.fileUrl
      || item?.file_url
      || item?.downloadUrl
      || item?.download_url
      || item?.resultUrl
      || item?.result_url
      || item?.outputUrl
      || item?.output_url
      || item?.url
      || '',
  ).trim();
  try {
    return path.extname(new URL(remote).pathname).toLowerCase().replace(/^\./, '');
  } catch (_) {
    return '';
  }
}

function isRunningHubTextOutputItem(item) {
  const declared = normalizedRunningHubOutputType(item);
  if (RUNNINGHUB_TEXT_OUTPUT_TYPES.has(declared) || declared.startsWith('text/')) return true;
  return ['txt', 'md', 'markdown', 'json', 'csv'].includes(runningHubOutputUrlExtension(item));
}

function runningHubTextOutputExtension(item) {
  const declared = normalizedRunningHubOutputType(item);
  const extension = runningHubOutputUrlExtension(item);
  if (declared === 'json' || declared === 'application/json' || extension === 'json') return 'json';
  if (declared === 'csv' || declared === 'text/csv' || extension === 'csv') return 'csv';
  if (declared === 'md' || declared === 'markdown' || declared === 'text/markdown' || ['md', 'markdown'].includes(extension)) {
    return 'md';
  }
  return 'txt';
}

function decodeRunningHubTextOutput(buffer, contentType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('RunningHub 文本输出为空');
  if (buffer.length > RUNNINGHUB_TEXT_OUTPUT_MAX_BYTES) {
    throw new Error(`RunningHub 文本输出超过 ${RUNNINGHUB_TEXT_OUTPUT_MAX_BYTES} bytes 限制`);
  }
  const declared = normalizedContentType(contentType);
  if (declared === 'text/html' || declared === 'application/xhtml+xml') {
    throw new Error('RunningHub 文本输出返回了 HTML 页面');
  }

  let text = '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.subarray(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const left = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = left;
    }
    text = swapped.toString('utf16le');
  } else {
    if (buffer.includes(0)) throw new Error('RunningHub 文本输出包含二进制数据');
    text = buffer.toString('utf8');
  }

  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('RunningHub 文本输出为空');
  if (/^\s*<!doctype\s+html|^\s*<html[\s>]/i.test(normalized)) {
    throw new Error('RunningHub 文本输出返回了 HTML 页面');
  }
  return normalized;
}

async function fetchRunningHubTextOutput(remote, item, materializationKey) {
  const downloaded = await safeRemoteMediaFetch(remote, proxySafeRemoteOptions({
    maxBytes: RUNNINGHUB_TEXT_OUTPUT_MAX_BYTES,
    deadlineMs: PROXY_REMOTE_DEADLINE_MS,
    trustedProviderOutput: true,
    idleTimeoutMs: PROXY_REMOTE_IDLE_TIMEOUT_MS,
    maxRedirects: 4,
    accept: 'text/plain,text/markdown,text/csv,application/json,application/octet-stream;q=0.5',
    userAgent: 'T8-PenguinCanvas-ProviderProxy/1.0',
  }));
  const text = decodeRunningHubTextOutput(downloaded.buffer, downloaded.contentType);
  const extension = runningHubTextOutputExtension(item);
  const utf8Buffer = Buffer.from(text, 'utf8');
  const url = storeMaterializedOutputBuffer(
    utf8Buffer,
    'rh_text',
    extension,
    materializationKey,
  );
  return { text, url };
}

function summarizeRunningHubOutputShape(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  const type = typeof value;
  if (type !== 'object') {
    if (type === 'string') {
      const text = value.trim();
      return isRunningHubOutputUrl(text)
        ? `url(${opaqueDiagnosticSummary('ref', text)})`
        : `string(${text.length})`;
    }
    return type;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (depth >= 3) {
    return Array.isArray(value)
      ? { type: 'array', length: value.length }
      : { type: 'object', keys: Object.keys(value).slice(0, 30) };
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: value.slice(0, 3).map((item) => summarizeRunningHubOutputShape(item, depth + 1, seen)),
    };
  }
  const keys = Object.keys(value);
  const sample = {};
  for (const key of keys.slice(0, 24)) {
    sample[key] = summarizeRunningHubOutputShape(value[key], depth + 1, seen);
  }
  return { type: 'object', keys: keys.slice(0, 60), sample };
}

// ========== 工具:加载 Settings 明文 ==========
function loadRawSettings() {
  if (!fs.existsSync(config.SETTINGS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// ========== 工具: 按提示词（模型名 / endpoint / 路由名）选择分类 API Key ==========
// 未填分类 key 时 fallback 到 通用 zhenzhenApiKey。
// hint 例: 'gpt-image-1' / 'gemini-3-pro-image' / 'gemini-3.1-flash-image' / 'mj-fast' / 'veo3.1-fal'
//          / 'grok-video-fal' / 'seedance-v3' / 'suno-v5.5' / 'fal-ai/nano-banana/edit'
function pickApiKey(settings, hint = '') {
  if (!settings) return '';
  const fb = settings.zhenzhenApiKey || '';
  const m = String(hint || '').toLowerCase();
  if (!m) return fb;
  if (m.includes('gpt-image') || m.includes('gpt2') || m.includes('gpt_image') || m.includes('gptimage')) return settings.gptImageApiKey || fb;
  if (m.includes('nano-banana') || m.includes('nano_banana') || m.includes('nanobanana') || m.includes('flash-image') || m.includes('flash-lite-image') || m.includes('gemini-3-pro-image')) return settings.nanoBananaApiKey || fb;
  if (m.includes('midjourney') || /\bmj[-_/]/.test(m) || m.startsWith('mj') || m === 'mj') return settings.mjApiKey || fb;
  if (m.includes('veo')) return settings.veoApiKey || fb;
  if (m.includes('sora')) return settings.soraApiKey || fb;
  if (m.includes('grok')) return settings.grokApiKey || fb;
  if (m.includes('seedance')) return settings.seedanceApiKey || fb;
  if (m.includes('suno') || m.includes('chirp')) return settings.sunoApiKey || fb;
  return fb;
}

function normalizeImageApiModel(model) {
  const raw = String(model || '').trim();
  if (raw === 'nano-banana-2') return 'gemini-3.1-flash-image';
  if (raw === 'gemini-3.1-flash-image-preview') return 'gemini-3.1-flash-image';
  if (raw === 'gemini-3.1-flash-image-previiew') return 'gemini-3.1-flash-image';
  if (raw === 'gemini-3-pro-image-preview') return 'gemini-3-pro-image';
  if (raw === 'gemini-3-pro-image-2k-preview') return 'gemini-3-pro-image-2k';
  if (raw === 'gemini-3-pro-image-4k-preview') return 'gemini-3-pro-image-4k';
  if (gptImage2ZhenzhenVariantSize(raw)) return 'gpt-image-2';
  return raw;
}

function gptImage2ZhenzhenVariantSize(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (raw === 'gpt-image-2-2k') return '2K';
  if (raw === 'gpt-image-2-4k') return '4K';
  return '';
}

function isBananaImageModel(model) {
  const m = String(model || '').toLowerCase();
  return m.includes('nano-banana')
    || m.includes('nano_banana')
    || m.includes('nanobanana')
    || m.includes('flash-image')
    || m.includes('flash-lite-image')
    || m.includes('gemini-3-pro-image');
}

function isOfficialGeminiImageModel(model) {
  const raw = String(model || '').trim();
  return raw === 'gemini-3.1-flash-lite-image'
    || raw === 'gemini-3-pro-image';
}

// ========== 工具: 以提示词为准，将 settings.zhenzhenApiKey 临时覆盖为分类 key ==========
// 调用后，后续所有 settings.zhenzhenApiKey 引用默认都会拿到分类 key（零侵入原逻辑）。
function applyClassifiedKey(settings, hint) {
  if (!settings) return;
  const picked = pickApiKey(settings, hint);
  if (picked) settings.zhenzhenApiKey = picked;
}

// ========== v1.2.9.15 新增：「专属优先 fallback 通用」一体化 API Key 校验 ==========
// 修复 v1.2.9.14 之前的两类 bug：
//   ① 旧路由先校验 settings.zhenzhenApiKey 非空 → 再 applyClassifiedKey；
//      若用户「只配置了分类专属 key 而通用 key 留空」，会被第一道检查误拦，
//      报「未配置贞贞工坊 API Key」，但其实专属 key 已存在；
//   ② 即使 zhenzhenApiKey 是错误值（如 '123'），按旧顺序通过校验后 applyClassifiedKey
//      仍能用 sunoApiKey 覆盖，但用户错配了 audio/upload 这类「完全没调 applyClassifiedKey」
//      的子路由 → Suno 上传步骤直接用 zhenzhenApiKey='123' 上传 → 上游返回令牌错误。
//
// 用法：
//   const settings = loadRawSettings();
//   if (!ensureKey(settings, res, 'suno', 'Suno')) return;
//   // 此时 settings.zhenzhenApiKey 已是 effective key（专属优先 fallback 通用），
//   // 后续直接 `Bearer ${settings.zhenzhenApiKey}` 即可。
//
// 副作用：成功时（return true）已对 settings 做 applyClassifiedKey；
//        失败时（return false）已通过 res 写入 400 响应，调用方应直接 return。
//
// 设计原则：
//   - 「专属优先」：sunoApiKey 非空 → 用 sunoApiKey；
//   - 「通用 fallback」：sunoApiKey 留空但 zhenzhenApiKey 非空 → 用 zhenzhenApiKey；
//   - 「双空才拒」：两者都空时报「分类专属 + 通用 至少填其一」。
function ensureKey(settings, res, hint, label) {
  if (!settings) {
    res.status(400).json({ success: false, error: '未找到 settings 文件，请先在【设置】中配置 API Key' });
    return false;
  }
  applyClassifiedKey(settings, hint || '');
  if (!settings.zhenzhenApiKey) {
    const tip = label
      ? `未配置 ${label} 专属 API Key，且贞贞工坊通用 API Key 也为空（请在【设置】中至少填写其中一个）`
      : '未配置贞贞工坊 API Key（请在【设置】中填写）';
    res.status(400).json({ success: false, error: tip });
    return false;
  }
  return true;
}

function ensureDefaultZhenzhenKey(settings, res, label = '贞贞工坊') {
  if (!settings) {
    res.status(400).json({ success: false, error: '未找到 settings 文件，请先在【设置】中配置 API Key' });
    return false;
  }
  if (!settings.zhenzhenApiKey) {
    res.status(400).json({ success: false, error: `${label} 使用通用贞贞 API Key，请先在【设置】中填写贞贞工坊通用 API Key` });
    return false;
  }
  return true;
}

// ========== 工具: taskId → 实际使用的 apiKey 内存映射 ==========
// submit 阶段根据 hint 选了分类 key 后，将 (taskId → key) 记下，
// query/status 阶段优先从该 Map 恢复 key，
// 防止前端未透传 model 时轮询错误 fallback 到通用 key 导致“令牌不合法”。
// 30 分钟过期自清。
const TASK_KEY_REGISTRY_MAX_ENTRIES = 4096;
const FAL_TASK_REGISTRY_MAX_ENTRIES = 4096;
const FAL_TASK_REGISTRY_TTL_MS = 2 * 60 * 60 * 1000;
const taskKeyMap = new Map();
function setBoundedRegistryEntry(registry, key, entry, maximum) {
  if (registry.has(key)) registry.delete(key);
  while (registry.size >= maximum) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    registry.delete(oldest);
  }
  registry.set(key, entry);
}
function taskKeyMapKey(taskId, authorityScope) {
  const id = String(taskId || '').trim();
  const scope = String(authorityScope || '').trim();
  return id && scope ? `${scope}:${id}` : '';
}
function rememberTaskKey(taskId, apiKey, meta = {}) {
  if (!taskId || !apiKey) return;
  const authorityScope = String(meta.authorityScope || meta.provider || '').trim();
  const key = taskKeyMapKey(taskId, authorityScope);
  if (!key) return;
  const entry = { apiKey, ...meta, authorityScope };
  setBoundedRegistryEntry(taskKeyMap, key, entry, TASK_KEY_REGISTRY_MAX_ENTRIES);
  const timer = setTimeout(() => {
    if (taskKeyMap.get(key) === entry) taskKeyMap.delete(key);
  }, 30 * 60 * 1000);
  timer.unref?.();
}
function recallTaskMeta(taskId, authorityScope) {
  const key = taskKeyMapKey(taskId, authorityScope);
  if (!key) return null;
  const item = taskKeyMap.get(key);
  if (!item) return null;
  return typeof item === 'string' ? { apiKey: item } : item;
}

// FAL poll authority is kept separately from the legacy provider key cache.
// Composite keys prevent a task id from another route/provider overwriting the
// URL that is allowed to receive the host's Bearer credential.
const falTaskRegistry = new Map();
const FAL_TASK_REGISTRY_SCHEMA = 't8-fal-task-registry-v1';
const FAL_TASK_REGISTRY_FILENAME = 'fal-task-registry.private.json';
const FAL_TASK_REGISTRY_MAX_FILE_BYTES = 4 * 1024 * 1024;
let falTaskRegistryLoadedFile = '';

function falTaskRegistryFilename() {
  const directory = config.SETTINGS_FILE ? path.dirname(config.SETTINGS_FILE) : config.DATA_DIR;
  return path.join(directory, FAL_TASK_REGISTRY_FILENAME);
}

function falTaskRegistryKey(route, taskId) {
  const safeRoute = String(route || '').trim();
  const safeTaskId = safeFalRequestId(taskId);
  return safeRoute && safeTaskId ? `${safeRoute}:${safeTaskId}` : '';
}

function falTaskRegistryPayload(route, taskId, meta, expiresAt) {
  const payload = {
    route: String(route || '').trim(),
    requestId: safeFalRequestId(taskId),
    endpoint: String(meta?.endpoint || '').trim().slice(0, 1024),
    responseUrl: String(meta?.responseUrl || '').trim().slice(0, 8192),
    expiresAt: Number(expiresAt),
  };
  const model = String(meta?.model || '').trim().slice(0, 240);
  const toolId = String(meta?.toolId || '').trim().slice(0, 240);
  const statusUrl = String(meta?.statusUrl || '').trim().slice(0, 8192);
  const statusPath = String(meta?.statusPath || '').trim().slice(0, 80);
  if (model) payload.model = model;
  if (toolId) payload.toolId = toolId;
  if (statusUrl) payload.statusUrl = statusUrl;
  if (statusPath) payload.statusPath = statusPath;
  if (Array.isArray(meta?.outputSchema)) payload.outputSchema = meta.outputSchema;
  return payload;
}

function falTaskRegistryMac(payload, apiKey) {
  return crypto.createHmac('sha256', String(apiKey || ''))
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

function validFalTaskRegistryRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const key = falTaskRegistryKey(value.route, value.requestId);
  const expiresAt = Number(value.expiresAt);
  const mac = String(value.mac || '');
  if (!key || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !/^[a-f0-9]{64}$/.test(mac)) return null;
  const payload = falTaskRegistryPayload(value.route, value.requestId, value, expiresAt);
  if (!payload.endpoint || !payload.responseUrl) return null;
  return Object.freeze({ ...payload, mac });
}

function persistFalTaskRegistry() {
  const filename = falTaskRegistryFilename();
  if (falTaskRegistryLoadedFile !== filename) return;
  const now = Date.now();
  const records = [];
  for (const [key, record] of falTaskRegistry) {
    if (Number(record?.expiresAt) <= now) {
      falTaskRegistry.delete(key);
      continue;
    }
    records.push(record);
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({
      schema: FAL_TASK_REGISTRY_SCHEMA,
      version: 1,
      records,
    })}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temporary, 0o600); } catch (_) {}
    fs.renameSync(temporary, filename);
    try { fs.chmodSync(filename, 0o600); } catch (_) {}
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
}

function ensureFalTaskRegistryLoaded() {
  const filename = falTaskRegistryFilename();
  if (falTaskRegistryLoadedFile === filename) return;
  falTaskRegistry.clear();
  falTaskRegistryLoadedFile = filename;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size <= 0 || stat.size > FAL_TASK_REGISTRY_MAX_FILE_BYTES) return;
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (parsed?.schema !== FAL_TASK_REGISTRY_SCHEMA || !Array.isArray(parsed.records)) return;
    for (const raw of parsed.records.slice(0, FAL_TASK_REGISTRY_MAX_ENTRIES)) {
      const record = validFalTaskRegistryRecord(raw);
      if (!record) continue;
      setBoundedRegistryEntry(
        falTaskRegistry,
        falTaskRegistryKey(record.route, record.requestId),
        record,
        FAL_TASK_REGISTRY_MAX_ENTRIES,
      );
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[fal] 私有任务注册读取失败，已按空注册表处理');
  }
}

function rememberFalTask(route, taskId, apiKey, meta = {}) {
  ensureFalTaskRegistryLoaded();
  const key = falTaskRegistryKey(route, taskId);
  if (!key || !apiKey) return null;
  const payload = falTaskRegistryPayload(route, taskId, meta, Date.now() + FAL_TASK_REGISTRY_TTL_MS);
  if (!payload.endpoint || !payload.responseUrl) return null;
  const entry = Object.freeze({ ...payload, mac: falTaskRegistryMac(payload, apiKey) });
  setBoundedRegistryEntry(falTaskRegistry, key, entry, FAL_TASK_REGISTRY_MAX_ENTRIES);
  try { persistFalTaskRegistry(); } catch (_) { return null; }
  const timer = setTimeout(() => {
    if (falTaskRegistry.get(key) === entry) {
      falTaskRegistry.delete(key);
      try { persistFalTaskRegistry(); } catch (_) {}
    }
  }, FAL_TASK_REGISTRY_TTL_MS);
  timer.unref?.();
  return Object.freeze({ apiKey, ...payload });
}
function recallFalTask(route, taskId) {
  ensureFalTaskRegistryLoaded();
  const key = falTaskRegistryKey(route, taskId);
  const entry = key ? falTaskRegistry.get(key) || null : null;
  if (!entry) return null;
  if (Number(entry.expiresAt) <= Date.now()) {
    falTaskRegistry.delete(key);
    try { persistFalTaskRegistry(); } catch (_) {}
    return null;
  }
  const apiKey = String(loadRawSettings()?.zhenzhenApiKey || '');
  if (!apiKey) return null;
  const { mac, ...payload } = entry;
  const expected = Buffer.from(falTaskRegistryMac(payload, apiKey), 'hex');
  const actual = Buffer.from(String(mac || ''), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return Object.freeze({ apiKey, ...payload });
}
function resetFalTaskRegistryMemoryForTests() {
  falTaskRegistry.clear();
  falTaskRegistryLoadedFile = '';
}
function normalizeProviderParams(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseProviderParams(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return normalizeProviderParams(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return normalizeProviderParams(value);
}

function hasSelectedProviderGroup(providerParams) {
  const params = normalizeProviderParams(providerParams);
  return !!String(params.zhenzhenGroup || params.t8Group || params.group || '').trim();
}

function ensureKeyOrSelectedGroup(settings, res, hint = '', label = '', providerParams = {}) {
  if (!settings) {
    res.status(400).json({ success: false, error: '未找到 settings 文件，请先在【设置】中配置 API Key' });
    return false;
  }
  applyClassifiedKey(settings, hint || '');
  if (settings.zhenzhenApiKey || hasSelectedProviderGroup(providerParams)) return true;
  const tip = label
    ? `未配置 ${label} 专属 API Key，且贞贞工坊通用 API Key 也为空（如已绑定 New API 分组令牌，请在节点上选择分组）`
    : '未配置贞贞工坊 API Key（请在【设置】中填写，或绑定 New API 后在节点选择分组）';
  res.status(400).json({ success: false, error: tip });
  return false;
}

async function applyZhenzhenProviderContext(settings, options = {}) {
  if (!settings) {
    return {
      apiKey: '',
      taskMeta: {},
    };
  }
  const providerParams = normalizeProviderParams(options.providerParams);
  const selectedGroup = String(providerParams.zhenzhenGroup || providerParams.t8Group || providerParams.group || '').trim();
  const result = await runLocalHooks('zhenzhen.resolveApiKey', {
    provider: 'zhenzhen',
    route: options.route || '',
    kind: options.kind || '',
    model: options.model || options.hint || '',
    hint: options.hint || options.model || '',
    apiKey: settings.zhenzhenApiKey,
    providerParams,
  });
  if (result?.apiKey && typeof result.apiKey === 'string') {
    settings.zhenzhenApiKey = result.apiKey;
  }
  if (selectedGroup && !settings.zhenzhenApiKey) {
    throw new Error('已选择分组令牌，但当前未找到可用 API Key；请在 API Key 设置里启用并绑定 New API 分组令牌，或改用通用贞贞 API Key');
  }
  const taskMeta = {
    ...(result?.taskMeta && typeof result.taskMeta === 'object' ? result.taskMeta : {}),
  };
  if (result?.group) taskMeta.group = result.group;
  if (result?.groupLabel) taskMeta.groupLabel = result.groupLabel;
  if (result?.model) taskMeta.model = result.model;
  return {
    apiKey: settings.zhenzhenApiKey,
    taskMeta,
  };
}

function isInvalidApiKeyError(errorText) {
  return /无效的令牌|令牌无效|invalid\s+(?:access\s+)?token|unauthorized/i.test(String(errorText || ''));
}

async function invalidateZhenzhenProviderKey(providerContext, apiKey, errorText) {
  const group = providerContext?.taskMeta?.group || providerContext?.taskMeta?.selectedGroup;
  if (!group || !apiKey || !isInvalidApiKeyError(errorText)) return;
  try {
    await runLocalHooks('zhenzhen.invalidateApiKey', {
      group,
      apiKey,
      error: String(errorText || '').slice(0, 500),
    });
  } catch (error) {
    console.warn('[zhenzhen] invalidate group token failed:', error?.message || error);
  }
}

function storeMaterializedOutputBuffer(buffer, prefix, extension, materializationKey = '') {
  const committed = commitMaterializedOutputBuffer({
    outputDir: config.OUTPUT_DIR,
    buffer,
    prefix,
    extension,
    materializationKey,
  });
  return `/files/output/${committed.filename}`;
}

// ========== 工具:保存上游返回的图像到本地 ==========
async function saveRemoteImage(url, _providerFetchImpl, materializationKey = '') {
  const result = await saveRemoteImageDetailed(url, _providerFetchImpl, materializationKey);
  return result.url || null;
}

const REMOTE_OUTPUT_RETRY_DELAYS_MS = Object.freeze([0, 500, 1_500]);
// Result materialization is a read-only continuation of an already-completed
// Provider task.  A slow proxy/TUN/CDN path must not lose the result merely
// because the former image-only 25 second budget expired.  The total budget
// schedules retries; an already-open recovery transfer is allowed to finish
// its own bounded attempt instead of being cut off at the outer boundary.
const REMOTE_OUTPUT_MATERIALIZATION_DEADLINE_MS = boundedProxyInteger(
  process.env.T8_REMOTE_OUTPUT_MATERIALIZATION_DEADLINE_MS
    || process.env.T8_IMAGE_OUTPUT_MATERIALIZATION_DEADLINE_MS,
  5 * 60_000,
  15_000,
  15 * 60_000,
);
const REMOTE_OUTPUT_ATTEMPT_DEADLINE_MS = boundedProxyInteger(
  process.env.T8_REMOTE_OUTPUT_ATTEMPT_DEADLINE_MS,
  2 * 60_000,
  5_000,
  5 * 60_000,
);
// Chunk idle time is intentionally looser than the old image-only 15 seconds,
// while connection establishment fails over quickly to a fresh route.
const REMOTE_OUTPUT_IDLE_TIMEOUT_MS = boundedProxyInteger(
  process.env.T8_REMOTE_OUTPUT_IDLE_TIMEOUT_MS
    || process.env.T8_IMAGE_OUTPUT_MATERIALIZATION_IDLE_TIMEOUT_MS,
  30_000,
  1_000,
  2 * 60_000,
);
const REMOTE_OUTPUT_CONNECT_TIMEOUT_MS = boundedProxyInteger(
  process.env.T8_REMOTE_OUTPUT_CONNECT_TIMEOUT_MS,
  8_000,
  500,
  30_000,
);
const REMOTE_OUTPUT_RETRY_AFTER_MS = 1_000;

function remoteOutputRetryDelays() {
  const testDelays = proxySafeRemoteTestOptions?.remoteOutputRetryDelaysMs;
  if (!Array.isArray(testDelays) || !testDelays.length) return REMOTE_OUTPUT_RETRY_DELAYS_MS;
  return testDelays
    .map((value) => Math.max(0, Math.min(30_000, Math.trunc(Number(value)) || 0)))
    .slice(0, 8);
}

function remoteOutputDeadlineAt() {
  const override = Number(proxySafeRemoteTestOptions?.remoteOutputMaterializationDeadlineMs);
  const budget = Number.isFinite(override) && override > 0
    ? Math.max(10, Math.min(15 * 60_000, Math.trunc(override)))
    : REMOTE_OUTPUT_MATERIALIZATION_DEADLINE_MS;
  return Date.now() + budget;
}

function remoteOutputTransferWindow(deadlineAt, label = '生成结果') {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw Object.assign(new Error(`${label}下载超过本轮恢复时间`), { code: 'fetch_timeout' });
  }
  const configuredAttempt = Number(proxySafeRemoteTestOptions?.remoteOutputAttemptDeadlineMs);
  const attemptBudget = Number.isFinite(configuredAttempt) && configuredAttempt > 0
    ? Math.max(10, Math.min(5 * 60_000, Math.trunc(configuredAttempt)))
    : REMOTE_OUTPUT_ATTEMPT_DEADLINE_MS;
  const deadlineMs = Math.max(1, Math.min(attemptBudget, remainingMs));
  const configuredIdle = Number(proxySafeRemoteTestOptions?.remoteOutputIdleTimeoutMs);
  const idleBudget = Number.isFinite(configuredIdle) && configuredIdle > 0
    ? Math.max(10, Math.min(2 * 60_000, Math.trunc(configuredIdle)))
    : REMOTE_OUTPUT_IDLE_TIMEOUT_MS;
  const configuredConnect = Number(proxySafeRemoteTestOptions?.remoteOutputConnectTimeoutMs);
  const connectBudget = Number.isFinite(configuredConnect) && configuredConnect > 0
    ? Math.max(10, Math.min(30_000, Math.trunc(configuredConnect)))
    : REMOTE_OUTPUT_CONNECT_TIMEOUT_MS;
  return {
    deadlineMs,
    // Chromium/system networking and DNS-pinned recovery are different paths.
    // The second path receives a fresh budget so the first cannot starve it.
    trustedProviderFallbackDeadlineMs: deadlineMs,
    idleTimeoutMs: Math.max(1, Math.min(idleBudget, deadlineMs)),
    connectTimeoutMs: Math.max(1, Math.min(connectBudget, deadlineMs)),
  };
}

const REMOTE_OUTPUT_KIND_LABELS = Object.freeze({
  image: { noun: '图片', object: '图片', code: 'image' },
  video: { noun: '视频', object: '视频', code: 'video' },
  audio: { noun: '音频', object: '音频', code: 'audio' },
  model3d: { noun: '3D 素材', object: '3D 素材', code: 'model3d' },
  media: { noun: '生成结果', object: '结果文件', code: 'media' },
});

function remoteOutputDownloadFailure(error, kind = 'media') {
  const label = REMOTE_OUTPUT_KIND_LABELS[kind] || REMOTE_OUTPUT_KIND_LABELS.media;
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').trim();
  const status = Number(error?.status || 0);
  if (code.startsWith('tun_dns_fallback_')) {
    return {
      code: `${label.code}_download_tun_dns_recovering`,
      message: `${label.noun}已经生成；检测到 TUN Fake-IP，应用正在通过独立公共 DNS 获取真实结果地址并自动重试，不会重新提交生成任务。`,
      recoverable: true,
      retryAfterMs: REMOTE_OUTPUT_RETRY_AFTER_MS,
    };
  }
  if (code === 'private_address') {
    return {
      code: `${label.code}_download_private_address_blocked`,
      message: `${label.noun}已经生成，但结果地址实际指向本机或内网，已拒绝访问。TUN Fake-IP 会自动回源解析；如果仍出现此提示，请联系 API 平台检查结果地址。`,
    };
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /getaddrinfo|dns/i.test(message)) {
    return {
      code: `${label.code}_download_dns_failed`,
      message: `${label.noun}已经生成，但本机暂时无法解析${label.object}域名。应用会保留原任务并自动重试，请检查 DNS、代理或网络状态。`,
      recoverable: true,
      retryAfterMs: REMOTE_OUTPUT_RETRY_AFTER_MS,
    };
  }
  if (code === 'fetch_timeout' || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) {
    return {
      code: `${label.code}_download_timeout`,
      message: `${label.noun}已经生成，但从结果服务器下载${label.object}超时。应用会保留原任务并自动重试。`,
      recoverable: true,
      retryAfterMs: REMOTE_OUTPUT_RETRY_AFTER_MS,
    };
  }
  if (code === 'remote_http_error') {
    return {
      code: `${label.code}_download_http_error`,
      message: `${label.noun}已经生成，但结果服务器下载失败${status ? `（HTTP ${status}）` : ''}。可能是临时链接、代理链路或结果服务器短暂异常。`,
      recoverable: status === 408 || status === 425 || status === 429 || status >= 500,
      retryAfterMs: REMOTE_OUTPUT_RETRY_AFTER_MS,
    };
  }
  if ([
    'system_network_fetch_failed', 'connect_timeout', 'remote_response_aborted',
    'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH',
  ].includes(code)) {
    return {
      code: `${label.code}_download_network_failed`,
      message: `${label.noun}已经生成，但本机与结果服务器的连接被拒绝或中断。应用会刷新连接并保留原任务自动重试。`,
      recoverable: true,
      retryAfterMs: REMOTE_OUTPUT_RETRY_AFTER_MS,
    };
  }
  if (/certificate|cert_|self signed|unable to verify|tls|ssl/i.test(`${code} ${message}`)) {
    return {
      code: `${label.code}_download_tls_failed`,
      message: `${label.noun}已经生成，但结果服务器的 HTTPS 证书校验失败。请检查系统时间、代理证书或安全软件的 HTTPS 扫描。`,
    };
  }
  if (code === 'item_too_large' || /超过.+bytes|大小限制/i.test(message)) {
    return {
      code: `${label.code}_download_too_large`,
      message: `${label.noun}已经生成，但${label.object}超过本地安全下载大小限制。`,
    };
  }
  if (/Content-Type|文件魔数|媒体类型|归档容器|图片格式/i.test(message)) {
    return {
      code: `${label.code}_download_invalid_content`,
      message: `${label.noun}已经生成，但下载到的内容不是有效${label.object}。常见原因是代理、登录页或安全软件替换了响应。`,
    };
  }
  if (code === 'ENOSPC') {
    return {
      code: `${label.code}_output_disk_full`,
      message: `${label.noun}已经生成，但本机磁盘空间不足，无法保存到输出目录。请释放磁盘空间后重试。`,
    };
  }
  if (['EACCES', 'EPERM', 'EROFS', 'download_write_failed'].includes(code)) {
    return {
      code: `${label.code}_output_not_writable`,
      message: `${label.noun}已经生成，但本机输出目录无法写入。请检查文件夹权限、安全软件拦截或受控文件夹访问设置。`,
    };
  }
  const safeDetail = safeDiagnosticText(message, 140);
  return {
    code: `${label.code}_download_failed`,
    message: safeDetail
      ? `${label.noun}已经生成，但本机下载或保存结果失败：${safeDetail}`
      : `${label.noun}已经生成，但本机下载或保存结果失败。请检查网络、代理、磁盘和输出目录权限。`,
  };
}

function imageOutputDownloadFailure(error) {
  return remoteOutputDownloadFailure(error, 'image');
}

function retryableRemoteOutputError(error) {
  const code = String(error?.code || '').trim();
  const status = Number(error?.status || 0);
  if (code.startsWith('tun_dns_fallback_')) return true;
  if (code === 'remote_http_error') return status === 408 || status === 425 || status === 429 || status >= 500;
  return new Set([
    'system_network_fetch_failed', 'connect_timeout', 'fetch_timeout',
    'remote_response_aborted', 'ECONNREFUSED', 'ECONNRESET',
    'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ESOCKETTIMEDOUT',
  ]).has(code);
}

function retryableImageOutputError(error) {
  return retryableRemoteOutputError(error);
}

async function saveRemoteImageDetailed(url, _providerFetchImpl, materializationKey = '', signal) {
  let lastError = null;
  const deadlineAt = remoteOutputDeadlineAt();
  const retryDelays = remoteOutputRetryDelays();
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) {
      if (Date.now() + delay >= deadlineAt) {
        lastError = Object.assign(new Error('图片结果下载超过本轮恢复时间'), { code: 'fetch_timeout' });
        break;
      }
      await proxyAbortableDelay(delay, signal);
    }
    try {
      const transferWindow = remoteOutputTransferWindow(deadlineAt, '图片结果');
      const remote = await fetchProxyRemoteMedia(url, {
        allowedKinds: ['image'],
        trustedProviderOutput: true,
        maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
        ...transferWindow,
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/tiff;q=0.9',
        signal,
      });
      throwIfProxyRequestAborted(signal);
      const buf = remote.buffer;
      const ext = verifiedProxyMediaExtension(remote);
      return { url: storeMaterializedOutputBuffer(buf, 'img', ext, materializationKey), error: null };
    } catch (error) {
      lastError = error;
      if (!retryableImageOutputError(error)) break;
    }
  }
  proxyRouteError('转存图像失败', lastError);
  return { url: '', error: imageOutputDownloadFailure(lastError) };
}

async function boundedProviderHttpError(response, label) {
  try {
    await readBoundedProviderResponse(response, label);
  } catch (_) {
    // The public error intentionally exposes only the HTTP status; bounded
    // consumption/cancellation above prevents a Provider body from lingering.
  }
  return providerResponseError(
    'provider_http_error',
    `${label}: HTTP ${Number(response.status || 0)}`,
    { status: Number(response.status || 0) },
  );
}

// ========== 工具:保存上游返回的音频到本地 ==========
async function saveRemoteAudio(url, materializationKey = '') {
  const result = await saveRemoteAudioDetailed(url, materializationKey);
  return result.url || null;
}

async function saveRemoteAudioDetailed(url, materializationKey = '', signal) {
  let lastError = null;
  const deadlineAt = remoteOutputDeadlineAt();
  const retryDelays = remoteOutputRetryDelays();
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) {
      if (Date.now() + delay >= deadlineAt) {
        lastError = Object.assign(new Error('音频结果下载超过本轮恢复时间'), { code: 'fetch_timeout' });
        break;
      }
      await proxyAbortableDelay(delay, signal);
    }
    try {
      const transferWindow = remoteOutputTransferWindow(deadlineAt, '音频结果');
      const remote = await fetchProxyRemoteMedia(url, {
        allowedKinds: ['audio'],
        trustedProviderOutput: true,
        maxBytes: PROXY_AUDIO_REFERENCE_MAX_BYTES,
        ...transferWindow,
        accept: 'audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac;q=0.9',
        signal,
      });
      throwIfProxyRequestAborted(signal);
      const buf = remote.buffer;
      const ext = verifiedProxyMediaExtension(remote);
      return {
        url: storeMaterializedOutputBuffer(buf, 'audio', ext, materializationKey),
        error: null,
      };
    } catch (error) {
      lastError = error;
      if (!retryableRemoteOutputError(error)) break;
    }
  }
  proxyRouteError('转存音频失败', lastError);
  return { url: '', error: remoteOutputDownloadFailure(lastError, 'audio') };
}

// 处理 b64_json 格式
function saveBase64Image(b64) {
  try {
    const raw = String(b64 || '');
    const clean = raw.includes(',') ? raw.split(',').pop() : raw;
    if (!clean || clean.length > Math.ceil(PROXY_IMAGE_REFERENCE_MAX_BYTES * 4 / 3) + 8) {
      throw new Error('Base64 图像为空或超过大小限制');
    }
    const buf = Buffer.from(clean || '', 'base64');
    const verified = validateProxyMediaBuffer(buf, '', {
      allowedKinds: ['image'],
      maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
    });
    const ext = extFromContentType(verified.contentType) || 'png';
    return storeMaterializedOutputBuffer(buf, 'img', ext);
  } catch (e) {
    console.error('⚠ 解析 b64 失败:', e.message);
    return null;
  }
}

// ========== POST /api/proxy/image — 图像生成 ==========
// body: { model, apiModel?, paramKind?, prompt, aspect_ratio?, image_size?, images?[], size?, image?, quality?, moderation?, n?, response_format?, output_format? }
//
// 主项目对齐的双协议路由:
//  1. paramKind === 'gpt-size'
//     - 无参考图 → POST /v1/images/generations (JSON)  body: { model, prompt, size }
//     - 有参考图 → POST /v1/images/edits        (multipart) image 多次 append
//     - size 从 (aspect_ratio + image_size 等级) 映射为像素串(1024x1024/1536x1024/1024x1536/2048x2048…)
//  2. paramKind === 'banana-ratio'
//     - POST /v1/images/generations (JSON) body: { model, prompt, aspect_ratio, image_size:'1K'|'2K'|'4K', image:[base64...]? }

// ========== 主项目 gpt-image-2-web 完整 GPT_SIZE_MAP(line 2173)==========
const GPT_SIZE_MAP = {
  '1:1_1k': '1024x1024', '1:1_2k': '2048x2048', '1:1_4k': '2880x2880',
  '3:2_1k': '1248x832',  '3:2_2k': '2496x1664', '3:2_4k': '3504x2336',
  '2:3_1k': '832x1248',  '2:3_2k': '1664x2496', '2:3_4k': '2336x3504',
  '4:3_1k': '1152x864',  '4:3_2k': '2304x1728', '4:3_4k': '3264x2448',
  '3:4_1k': '864x1152',  '3:4_2k': '1728x2304', '3:4_4k': '2448x3264',
  '5:4_1k': '1120x896',  '5:4_2k': '2240x1792', '5:4_4k': '3200x2560',
  '4:5_1k': '896x1120',  '4:5_2k': '1792x2240', '4:5_4k': '2560x3200',
  '16:9_1k': '1280x720', '16:9_2k': '2560x1440', '16:9_4k': '3840x2160',
  '9:16_1k': '720x1280', '9:16_2k': '1440x2560', '9:16_4k': '2160x3840',
  '2:1_1k': '2048x1024', '2:1_2k': '2688x1344', '2:1_4k': '3840x1920',
  '1:2_1k': '1024x2048', '1:2_2k': '1344x2688', '1:2_4k': '1920x3840',
  '21:9_1k': '1456x624', '21:9_2k': '3024x1296', '21:9_4k': '3696x1584',
  '9:21_1k': '624x1456', '9:21_2k': '1296x3024', '9:21_4k': '1584x3696',
};

// 将 (aspectRatio + sizeLevel) 用主项目 GPT_SIZE_MAP 映射成像素串;Auto 返 'auto'
function aspectToGptSize(aspectRatio, sizeLevel) {
  const ar = String(aspectRatio || '').trim();
  const lvl = String(sizeLevel || '1K').toLowerCase();
  const isAuto = !ar || ar === 'Auto' || ar === 'AUTO' || ar === 'empty';
  if (isAuto) return 'auto';
  const key = `${ar}_${lvl}`;
  return GPT_SIZE_MAP[key] || '1024x1024';
}

function assertInsideDir(root, target) {
  const base = path.resolve(root);
  const full = path.resolve(target);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function toLocalPathnameIfSameApp(url) {
  const raw = String(url || '').trim();
  try {
    const u = new URL(raw);
    const host = String(u.hostname || '').toLowerCase();
    const localHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    const allowedPorts = new Set([
      String(Number(config.PORT) || 18766),
      '11422',
    ]);
    const actualPort = u.port || (u.protocol === 'http:' ? '80' : u.protocol === 'https:' ? '443' : '');
    if (
      localHost
      && u.protocol === 'http:'
      && allowedPorts.has(actualPort)
      && !u.username
      && !u.password
      && !raw.includes('\\')
    ) {
      // Keep percent encoding intact. resolveMountedFileReference performs the
      // sole decode so double-encoded dot segments cannot become traversal.
      return u.pathname || '';
    }
  } catch {
    // Relative app URLs stay on the normal path below.
  }
  return raw;
}

function resolveStaticImagePath(ref) {
  const raw = toLocalPathnameIfSameApp(ref);
  return resolveMountedFileReference(raw, [
    { prefixes: ['/files/input/', '/input/'], root: config.INPUT_DIR },
    { prefixes: ['/files/output/', '/output/'], root: config.OUTPUT_DIR },
    { prefixes: ['/files/thumbnails/'], root: config.THUMBNAILS_DIR },
  ], PROXY_IMAGE_REFERENCE_MAX_BYTES)?.filename || null;
}

function readLocalImageRefBuffer(ref) {
  const raw = toLocalPathnameIfSameApp(ref);
  const local = readMountedFileReference(raw, [
    { prefixes: ['/files/input/', '/input/'], root: config.INPUT_DIR },
    { prefixes: ['/files/output/', '/output/'], root: config.OUTPUT_DIR },
    { prefixes: ['/files/thumbnails/'], root: config.THUMBNAILS_DIR },
  ], PROXY_IMAGE_REFERENCE_MAX_BYTES);
  if (!local) return null;
  const verified = validateMountedMediaBuffer(local.buffer, local.filename, {
    allowedKinds: ['image'],
    maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
  });
  return {
    buf: local.buffer,
    mime: verified.contentType,
    ext: verifiedProxyMediaExtension(verified),
  };
}

function getResourceLibraryRootForProxy() {
  const settings = loadRawSettings() || {};
  return String(settings.resourceLibraryPath || config.DEFAULT_RESOURCE_LIBRARY_DIR || '').trim();
}

function readResourceLibraryDbForProxy(root) {
  if (!root) return null;
  const dbPath = path.join(root, 'resource_library.json');
  if (!fs.existsSync(dbPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function resolveResourceMediaRef(ref, maximum = PROXY_MEDIA_REFERENCE_MAX_BYTES) {
  const clean = toLocalPathnameIfSameApp(ref).split(/[?#]/)[0];
  const fileMatch = /^\/api\/resources\/file\/([^/?#]+)/.exec(clean);
  const setFileMatch = /^\/api\/resources\/set-file\/([^/?#]+)\/(\d+)/.exec(clean);
  if (!fileMatch && !setFileMatch) return null;

  const root = getResourceLibraryRootForProxy();
  const db = readResourceLibraryDbForProxy(root);
  const items = Array.isArray(db?.items) ? db.items : [];
  if (!root || items.length === 0) return null;

  if (fileMatch) {
    const id = decodeURIComponent(fileMatch[1]);
    const item = items.find((entry) => entry?.id === id);
    const fileRel = String(item?.fileRel || '').trim();
    if (!item || !fileRel) return null;
    const resolved = realpathInsideRoot(root, path.join(root, fileRel));
    if (!resolved || resolved.size > maximum) return null;
    const full = resolved.filename;
    return {
      full,
      resolved,
      declaredMime: String(item.mime || '').trim(),
      fileMime: mimeTypeForProxyFilename(full),
      originalName: String(item.originalName || item.title || path.basename(full)).trim(),
    };
  }

  const id = decodeURIComponent(setFileMatch[1]);
  const index = Number(setFileMatch[2]);
  const item = items.find((entry) => entry?.id === id);
  const children = Array.isArray(item?.materialSetItems) ? item.materialSetItems : [];
  const child = Number.isFinite(index) ? children[index] : null;
  const fileRel = String(child?.fileRel || '').trim();
  if (!child || !fileRel) return null;
  const resolved = realpathInsideRoot(root, path.join(root, fileRel));
  if (!resolved || resolved.size > maximum) return null;
  const full = resolved.filename;
  return {
    full,
    resolved,
    declaredMime: String(child.mime || '').trim(),
    fileMime: mimeTypeForProxyFilename(full),
    originalName: String(child.name || path.basename(full)).trim(),
  };
}

function readResourceMediaRefBuffer(ref, options = {}) {
  const allowedKinds = Array.isArray(options.allowedKinds) && options.allowedKinds.length > 0
    ? options.allowedKinds
    : ['image', 'video', 'audio'];
  const maximum = Number(options.maxBytes) || PROXY_MEDIA_REFERENCE_MAX_BYTES;
  const resolved = resolveResourceMediaRef(ref, maximum);
  const opened = readResolvedFile(resolved?.resolved, maximum);
  if (!resolved || !opened) return null;
  const buf = opened.buffer;
  const declaredMime = normalizedContentType(resolved.declaredMime);
  const fileMime = normalizedContentType(resolved.fileMime);
  // Old resource-library rows can contain an empty/generic/stale MIME. Prefer
  // recognized bytes, but use the managed filename/caller kind for codecs whose
  // signature detector does not know yet.
  let verified;
  try {
    verified = validateProxyMediaBuffer(buf, declaredMime || fileMime, {
      allowedKinds,
      maxBytes: maximum,
      sourceName: resolved.originalName || resolved.full,
    });
  } catch {
    return null;
  }
  const mime = verified.contentType || fileMime || declaredMime;
  const ext = extFromContentType(mime)
    || safeOutputExt(path.extname(resolved.full), allowedKinds[0] === 'audio' ? 'mp3' : 'png');
  return {
    buf,
    mime,
    ext,
    originalName: resolved.originalName || path.basename(resolved.full),
    detectedKind: verified.detectedKind || verified.mediaKind,
  };
}

function resolveResourceImageRef(ref) {
  return resolveResourceMediaRef(ref, PROXY_IMAGE_REFERENCE_MAX_BYTES);
}

function readResourceImageRefBuffer(ref) {
  return readResourceMediaRefBuffer(ref, {
    allowedKinds: ['image'],
    maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
  });
}

// 将 base64 dataURL / http(s) URL 转成 multipart Buffer
async function refToBuffer(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  if (ref.startsWith('data:')) {
    const m = ref.match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1] || 'image/png';
    const buf = Buffer.from(m[2], 'base64');
    validateProxyMediaBuffer(buf, mime, {
      allowedKinds: ['image'],
      maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
    });
    const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return { buf, mime, ext };
  }
  const normalizedRef = normalizeT8LocalMediaRef(ref, {
    allowedPorts: [config.PORT, 11422],
  });
  if (/^https?:\/\//i.test(normalizedRef) || isT8LocalMediaPath(normalizedRef)) {
    const local = await readProviderLocalMediaRefBuffer(normalizedRef, {
      allowedKinds: ['image'],
      maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
    });
    if (local) {
      return {
        buf: local.buffer,
        mime: local.contentType,
        ext: extFromContentType(local.contentType) || 'png',
      };
    }
    if (normalizedRef.startsWith('/')) return null;
    const remote = await fetchProxyRemoteMedia(normalizedRef, {
      allowedKinds: ['image'],
      maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/tiff;q=0.9',
    });
    const ct = remote.contentType || 'image/png';
    const buf = remote.buffer;
    const ext = extFromContentType(ct) || (ct.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return { buf, mime: ct, ext };
  }
  return null;
}

function summarizeImageRef(ref, index) {
  const text = String(ref || '').trim();
  if (!text) return `#${index + 1} 空引用`;
  if (text.startsWith('data:')) {
    const mime = text.match(/^data:([^;,]+)/)?.[1] || 'image';
    return `#${index + 1} data:${mime};base64,...`;
  }
  return `#${index + 1} ${opaqueDiagnosticSummary('ref', text)}`;
}

async function collectConvertedImageRefs(refs, label = '参考图') {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const convertedRefs = [];
  const failedRefs = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    try {
      const conv = await refToBuffer(ref);
      if (!conv) {
        failedRefs.push({ index: i, ref, reason: '读取结果为空或 HTTP 非成功' });
        continue;
      }
      const mime = String(conv.mime || '').toLowerCase();
      if (mime && !mime.startsWith('image/')) {
        failedRefs.push({ index: i, ref, reason: `非图片内容 ${conv.mime}` });
        continue;
      }
      convertedRefs.push({ ...conv, index: i, ref });
    } catch (error) {
      failedRefs.push({ index: i, ref, reason: error?.message || '读取异常' });
    }
  }
  if (refs.length > 0 && convertedRefs.length === 0) {
    const preview = failedRefs
      .slice(0, 3)
      .map((item) => `${summarizeImageRef(item.ref, item.index)} ${item.reason}`)
      .join('；');
    throw new Error(`${label}读取失败，已中止生成，避免按无参考图生成${preview ? `：${preview}` : ''}`);
  }
  if (failedRefs.length > 0) {
    const preview = failedRefs
      .slice(0, 3)
      .map((item) => `${summarizeImageRef(item.ref, item.index)} ${item.reason}`)
      .join('；');
    console.warn(`[upstream] ${label}部分读取失败 converted=${convertedRefs.length}/${refs.length}: ${preview}`);
  }
  return convertedRefs;
}

function appendConvertedImagesToForm(form, convertedRefs) {
  for (let i = 0; i < convertedRefs.length; i++) {
    const conv = convertedRefs[i];
    const blob = new Blob([conv.buf], { type: conv.mime || 'image/png' });
    const ext = safeOutputExt(conv.ext, 'png');
    form.append('image', blob, `image_${Number.isFinite(conv.index) ? conv.index : i}.${ext}`);
  }
}

// 将 base64/URL 参考图转成 banana 希望的 dataURL 或保留外部 URL
function isLocalImageDataRef(ref) {
  if (typeof ref !== 'string') return false;
  const normalized = normalizeT8LocalMediaRef(ref, { allowedPorts: [config.PORT, 11422] });
  return isT8LocalMediaPath(normalized);
}

async function localImageRefToDataUrl(ref) {
  const conv = await refToBuffer(ref);
  if (!conv) return null;
  const mime = String(conv.mime || 'image/png');
  if (!mime.toLowerCase().startsWith('image/')) return null;
  return `data:${mime};base64,${conv.buf.toString('base64')}`;
}

async function refToBananaImage(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  try {
    const converted = await refToBuffer(ref);
    return converted ? `data:${converted.mime};base64,${converted.buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

// Grok Image 默认按 gpt-image-2-web 的 Base64 方式传参考图,最多 4 张。
async function refToGrokImage(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  if (ref.startsWith('data:')) {
    const converted = await refToBuffer(ref);
    return converted ? `data:${converted.mime};base64,${converted.buf.toString('base64')}` : null;
  }
  const normalizedRef = normalizeT8LocalMediaRef(ref, { allowedPorts: [config.PORT, 11422] });
  if (/^https?:\/\//i.test(normalizedRef) || isT8LocalMediaPath(normalizedRef)) {
    try {
      if (isLocalImageDataRef(normalizedRef)) return await localImageRefToDataUrl(normalizedRef);
      if (normalizedRef.startsWith('/')) return null;
      const remote = await fetchProxyRemoteMedia(normalizedRef, {
        allowedKinds: ['image'],
        maxBytes: PROXY_IMAGE_REFERENCE_MAX_BYTES,
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/tiff;q=0.9',
      });
      const ct = remote.contentType || 'image/png';
      const buf = remote.buffer;
      return `data:${ct};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
  return null;
}

function isImageTaskString(s) {
  return /^[A-Za-z0-9_-]{8,256}$/.test(String(s || '').trim());
}

function imageTaskId(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  for (const k of ['task_id', 'id', 'request_id']) {
    if (result[k]) return String(result[k]);
  }
  const d = result.data;
  if (typeof d === 'string' && d.trim() && !/^https?:\/\//.test(d) && !d.startsWith('data:image')) return d.trim();
  if (d && typeof d === 'object') {
    for (const k of ['task_id', 'id', 'request_id']) {
      if (d[k]) return String(d[k]);
    }
  }
  return '';
}

function imageError(result) {
  if (!result) return '';
  if (typeof result === 'string') return result.substring(0, 500);
  if (Array.isArray(result)) return JSON.stringify(result.slice(0, 3)).substring(0, 500);
  if (typeof result !== 'object') return '';
  for (const k of ['detail', 'fail_reason', 'error', 'message']) {
    const v = result[k];
    if (!v) continue;
    if (typeof v === 'string') return v.substring(0, 500);
    if (typeof v === 'object') return String(v.message || v.detail || JSON.stringify(v)).substring(0, 500);
  }
  const d = result.data;
  if (d && typeof d === 'object') {
    const nested = imageError(d);
    if (nested) return nested;
  }
  return '';
}

function imageApiFailed(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const code = String(result.code ?? '').toLowerCase();
  if (code && !['success', 'ok', '0', '200'].includes(code)) return true;
  if (result.detail || result.error) return true;
  return false;
}

function imageStatus(result) {
  if (!result || typeof result !== 'object') return '';
  for (const k of ['status', 'task_status', 'state']) {
    if (result[k]) return String(result[k]).toUpperCase();
  }
  const d = result.data;
  if (d && typeof d === 'object') {
    for (const k of ['status', 'task_status', 'state']) {
      if (d[k]) return String(d[k]).toUpperCase();
    }
  }
  return '';
}

function imageItems(result) {
  if (!result) return [];
  if (Array.isArray(result)) {
    const nested = result.flatMap((item) => imageItems(item));
    return nested.length ? nested : result;
  }
  if (typeof result === 'string') {
    const s = result.trim();
    return s && !isImageTaskString(s) ? [s] : [];
  }
  if (typeof result !== 'object') return [];
  const inlineData = result.inlineData || result.inline_data;
  if (inlineData?.data) {
    return [{
      b64_json: inlineData.data,
      mime_type: inlineData.mimeType || inlineData.mime_type || inlineData.mime || 'image/png',
    }];
  }
  if (Array.isArray(result.parts)) return imageItems(result.parts);
  if (Array.isArray(result.content?.parts)) return imageItems(result.content.parts);
  if (Array.isArray(result.candidates)) return imageItems(result.candidates);
  if (result.url || result.image_url || result.imageUrl || result.result_url || result.resultUrl
    || result.output_url || result.outputUrl || result.download_url || result.downloadUrl
    || result.b64_json || result.base64 || result.image_base64 || result.imageBase64) return [result];
  for (const k of ['data', 'images', 'result', 'results', 'output', 'outputs', 'image', 'artifacts', 'files', 'content', 'parts', 'candidates', 'response', 'url']) {
    const v = result[k];
    if (!v) continue;
    if (Array.isArray(v)) {
      const nested = imageItems(v);
      if (nested.length) return nested;
      continue;
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s || isImageTaskString(s)) continue;
      return [s];
    }
    if (typeof v === 'object') {
      const nested = imageItems(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeImageItems(result) {
  return imageItems(result).map((item) => {
    if (typeof item === 'string') {
      return /^https?:\/\//.test(item) ? { url: item } : { b64_json: item.startsWith('data:image') ? item : item };
    }
    if (item && typeof item === 'object') {
      const nestedImageUrl = item.image_url && typeof item.image_url === 'object' ? item.image_url.url : '';
      const url = item.url || nestedImageUrl || (typeof item.image_url === 'string' ? item.image_url : '')
        || item.imageUrl || item.result_url || item.resultUrl || item.output_url || item.outputUrl
        || item.download_url || item.downloadUrl
        || (typeof item.image === 'string' && /^https?:\/\//.test(item.image) ? item.image : '');
      const b64 = item.b64_json || item.base64 || item.image_base64 || item.imageBase64
        || (!url && typeof item.image === 'string' ? item.image : '');
      if (url) return { url };
      if (b64) return { b64_json: b64 };
    }
    return null;
  }).filter(Boolean);
}

async function saveImageItemsFromResultDetailed(result, options = {}) {
  const urls = [];
  const failures = [];
  const items = normalizeImageItems(result);
  const materializationScope = String(options.materializationScope || '').trim();
  for (const [outputIndex, it] of items.entries()) {
    if (it?.b64_json) {
      const u = saveBase64Image(it.b64_json);
      if (u) urls.push(u);
      else failures.push({
        code: 'image_output_invalid_base64',
        message: '图片已经生成，但上游返回的 Base64 图片无效或超过大小限制。',
      });
    } else if (it?.url) {
      const saved = await saveRemoteImageDetailed(
        it.url,
        null,
        materializationScope ? `${materializationScope}:${outputIndex}` : '',
        options.signal,
      );
      if (saved.url) urls.push(saved.url);
      else if (saved.error) failures.push(saved.error);
    }
  }
  return { urls: [...new Set(urls)], itemCount: items.length, failures };
}

async function saveImageItemsFromResult(result, options = {}) {
  return (await saveImageItemsFromResultDetailed(result, options)).urls;
}

function completedImageOutputError(materialized) {
  const first = materialized?.failures?.[0];
  const reason = first || (materialized?.itemCount > 0
    ? { code: 'image_output_unusable', message: '图片已经生成，但返回的图片内容无法使用。' }
    : { code: 'image_output_missing', message: '上游任务已经完成，但响应中没有可识别的图片地址。请保留任务 ID 并联系 API 平台检查该任务。' });
  const recoverable = reason.recoverable === true;
  return Object.assign(new Error(reason.message), {
    code: reason.code,
    status: recoverable ? 202 : 502,
    imageOutputFailure: true,
    recoverable,
    retryAfterMs: recoverable ? Math.max(500, Number(reason.retryAfterMs) || REMOTE_OUTPUT_RETRY_AFTER_MS) : 0,
  });
}

function sendCompletedImageOutputFailure(res, failure, data = {}) {
  if (failure?.recoverable) {
    return res.status(202).json({
      success: true,
      code: failure.code,
      message: failure.message,
      data: {
        ...data,
        status: 'materializing',
        progress: '100%',
        code: failure.code,
        error: failure.message,
        recoverable: true,
        retryAfterMs: failure.retryAfterMs,
      },
    });
  }
  return res.status(failure?.status || 502).json({
    success: false,
    code: failure?.code || 'image_output_unusable',
    error: failure?.message || '图片结果无法保存。',
    ...(Object.keys(data).length ? { data } : {}),
  });
}

function completedRemoteOutputError(materialized, kind = 'media') {
  const label = REMOTE_OUTPUT_KIND_LABELS[kind] || REMOTE_OUTPUT_KIND_LABELS.media;
  const first = materialized?.error || materialized?.failures?.[0];
  const reason = first || (Number(materialized?.itemCount || 0) > 0
    ? {
      code: `${label.code}_output_unusable`,
      message: `${label.noun}已经生成，但返回的${label.object}内容无法使用。`,
    }
    : {
      code: `${label.code}_output_missing`,
      message: `上游任务已经完成，但响应中没有可识别的${label.object}地址。请保留任务 ID 并联系 API 平台检查该任务。`,
    });
  const recoverable = reason.recoverable === true;
  return Object.assign(new Error(reason.message), {
    code: reason.code,
    status: recoverable ? 202 : 502,
    remoteOutputFailure: true,
    recoverable,
    retryAfterMs: recoverable ? Math.max(500, Number(reason.retryAfterMs) || REMOTE_OUTPUT_RETRY_AFTER_MS) : 0,
  });
}

function sendCompletedRemoteOutputFailure(res, failure, data = {}, options = {}) {
  const statusValue = options.status || 'materializing';
  const defaultCode = options.defaultCode || 'output_unusable';
  const defaultMessage = options.defaultMessage || '生成结果无法保存。';
  if (failure?.recoverable) {
    return res.status(202).json({
      success: true,
      code: failure.code,
      message: failure.message,
      data: {
        ...data,
        status: statusValue,
        progress: '100%',
        code: failure.code,
        error: failure.message,
        recoverable: true,
        retryAfterMs: failure.retryAfterMs,
      },
    });
  }
  return res.status(failure?.status || 502).json({
    success: false,
    code: failure?.code || defaultCode,
    error: failure?.message || defaultMessage,
    ...(Object.keys(data).length ? { data } : {}),
  });
}

async function materializeRemoteTaskOutput({
  status,
  completedStatuses = ['succeeded', 'success', 'completed'],
  remoteUrl,
  kind,
  materializationKey,
  providerFetchImpl,
  signal,
}) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!completedStatuses.includes(normalized)) return { url: '', failure: null };
  if (!remoteUrl) {
    return {
      url: '',
      failure: completedRemoteOutputError({ itemCount: 0 }, kind),
    };
  }
  const saved = kind === 'video'
    ? await saveRemoteVideoDetailed(remoteUrl, providerFetchImpl, materializationKey, signal)
    : kind === 'audio'
      ? await saveRemoteAudioDetailed(remoteUrl, materializationKey, signal)
      : await saveRemoteImageDetailed(remoteUrl, providerFetchImpl, materializationKey, signal);
  if (saved.url) return { url: saved.url, failure: null };
  return {
    url: '',
    failure: completedRemoteOutputError({
      itemCount: 1,
      failures: saved.error ? [saved.error] : [],
    }, kind),
  };
}

async function saveRemoteSunoFileDetailed(url, materializationKey = '') {
  let lastError = null;
  const deadlineAt = remoteOutputDeadlineAt();
  const retryDelays = remoteOutputRetryDelays();
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const transferWindow = remoteOutputTransferWindow(deadlineAt, 'Suno 结果');
      const remote = await safeRemoteMediaFetch(url, proxySafeRemoteOptions({
        maxBytes: PROXY_AUDIO_REFERENCE_MAX_BYTES,
        trustedProviderOutput: true,
        ...transferWindow,
        maxRedirects: 4,
        accept: 'audio/midi,audio/x-midi,application/x-midi,application/octet-stream;q=0.8',
        userAgent: 'T8-PenguinCanvas-Suno-File/1.0',
      }));
      const buffer = remote.buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error('音乐文件为空或不完整');
      const isMidi = buffer.length >= 14 && buffer.subarray(0, 4).toString('ascii') === 'MThd';
      const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b
        && ((buffer[2] === 0x03 && buffer[3] === 0x04)
          || (buffer[2] === 0x05 && buffer[3] === 0x06)
          || (buffer[2] === 0x07 && buffer[3] === 0x08));
      if (!isMidi && !isZip) throw new Error('音乐文件不是有效的 MIDI 或 ZIP 文件');
      return {
        url: storeMaterializedOutputBuffer(
          buffer,
          isZip ? 'flowmusic_stems' : 'suno_midi',
          isZip ? 'zip' : 'mid',
          materializationKey,
        ),
        error: null,
      };
    } catch (error) {
      lastError = error;
      if (!retryableRemoteOutputError(error)) break;
    }
  }
  proxyRouteError('转存音乐文件失败', lastError);
  return { url: '', error: remoteOutputDownloadFailure(lastError, 'media') };
}

async function materializeSunoNzResult(result, taskId, options = {}) {
  const normalizedStatus = String(result?.status || '').trim().toLowerCase();
  const completed = ['succeeded', 'success', 'completed'].includes(normalizedStatus);
  const output = {
    status: result?.status || 'pending',
    progress: result?.progress || '',
    resultFamily: result?.resultFamily || 'audio',
    text: result?.text || '',
    tracks: [],
    audioUrls: [],
    videoUrls: [],
    imageUrls: [],
    fileUrls: [],
    artifacts: [],
    failures: [],
    itemCount: 0,
  };
  if (!completed) return output;

  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  output.itemCount = artifacts.length;
  for (const [index, artifact] of artifacts.entries()) {
    const kind = String(artifact?.kind || 'file');
    const remoteUrl = String(artifact?.url || '').trim();
    if (!remoteUrl) continue;
    const materializationKey = `${options.materializationPrefix || 'suno-nz'}:${taskId || 'sync'}:${index}:${kind}`;
    let saved;
    if (kind === 'audio') saved = await saveRemoteAudioDetailed(remoteUrl, materializationKey);
    else if (kind === 'video') saved = await saveRemoteVideoDetailed(remoteUrl, null, materializationKey);
    else if (kind === 'image') saved = await saveRemoteImageDetailed(remoteUrl, null, materializationKey);
    else saved = await saveRemoteSunoFileDetailed(remoteUrl, materializationKey);
    if (!saved?.url) {
      if (saved?.error) output.failures.push(saved.error);
      continue;
    }
    output.artifacts.push({ kind, url: saved.url });
    if (kind === 'audio') output.audioUrls.push(saved.url);
    else if (kind === 'video') output.videoUrls.push(saved.url);
    else if (kind === 'image') output.imageUrls.push(saved.url);
    else output.fileUrls.push(saved.url);
  }

  const music = Array.isArray(result?.music) ? result.music : [];
  output.tracks = output.audioUrls.map((audioUrl, index) => {
    const item = music[index] && typeof music[index] === 'object' ? music[index] : {};
    return {
      id: String(item.id || item.audio_id || `${taskId || 'sync'}:${index}`),
      clipId: String(item.clip_id || item.audio_id || item.id || taskId || ''),
      audioUrl,
      imageUrl: output.imageUrls[index] || output.imageUrls[0] || '',
      title: safeDiagnosticText(item.title || '', 240),
      tags: safeDiagnosticText(item.tags || item.style || '', 500),
      duration: Number(item.duration || item.duration_s || 0) || 0,
    };
  });
  return output;
}

function sunoNzCompletedOutputFailure(result, materialized) {
  const family = String(result?.resultFamily || 'audio');
  const familyUrls = family === 'video'
    ? materialized.videoUrls
    : family === 'file' ? materialized.fileUrls : materialized.audioUrls;
  if (family !== 'text' && familyUrls.length > 0) return null;
  if (materialized.failures.length > 0) {
    return completedRemoteOutputError({
      itemCount: materialized.itemCount,
      failures: materialized.failures,
    }, family === 'file' ? 'media' : family);
  }
  if (family === 'text') {
    if (String(materialized.text || '').trim()) return null;
    return completedRemoteOutputError({ itemCount: 0 }, 'media');
  }
  return completedRemoteOutputError({ itemCount: materialized.itemCount }, family === 'file' ? 'media' : family);
}

// LLM 多模态 image_url 预处理:
//   上游 LLM 服务(贞贞工坊)无法访问本地 /files/* 路径,需提前转成 base64 dataURL inline。
//   - data: 保留
//   - http(s):// 保留(上游可访问)
//   - /files/* → 本地拉 buffer 转 base64 dataURL
//   对齐 gpt-image-2-web chat 模式处理参考图的思路。
//   零破坏:对于 content 为字符串的普通文本消息不动;仅处理 content 为数组且含 image_url 部分。
async function normalizeLlmMessageImages(messages) {
  if (!Array.isArray(messages)) return messages;
  for (const msg of messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (!part || part.type !== 'image_url' || !part.image_url) continue;
      const url = part.image_url.url;
      if (typeof url !== 'string' || !url) continue;
      // 已是 base64 或外网 URL→不动
      if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) continue;
      // 本地路径→转 base64 dataURL
      if (url.startsWith('/files/')) {
        const dataUrl = await refToBananaImage(url);
        if (dataUrl) {
          part.image_url.url = dataUrl;
        } else {
          // 转换失败:报一个明确错误,避免上游 'base64:/files/...' 这种误导报错
          throw new Error(`本地图片读取失败: ${url}`);
        }
      }
      // 其它未知前缀:保留原值,让上游报真错误
    }
  }
  return messages;
}

function geminiOfficialImageSize(model, value) {
  if (String(model || '').trim() === 'gemini-3.1-flash-lite-image') return '1K';
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (upper === '1K' || upper === '2K' || upper === '4K') return upper;
  if (raw === '512' || raw.toLowerCase() === '512px') return '512';
  return '';
}

async function buildGeminiOfficialContents(prompt, refs) {
  const parts = [];
  if (Array.isArray(refs) && refs.length) {
    const convertedRefs = await collectConvertedImageRefs(refs, 'Gemini 官方参考图');
    for (const conv of convertedRefs) {
      parts.push({
        inlineData: {
          mimeType: conv.mime || 'image/png',
          data: conv.buf.toString('base64'),
        },
      });
    }
  }
  parts.push({ text: prompt });
  return [{ parts }];
}

// ========================================================================
// 核心 helper:完全对齐主项目 gpt-image-2-web 的上游调用
//   - GPT2 始终走 multipart /v1/images/edits?async=true(line 2869)
//   - 文生图时用 1024x1024 白图占位(line 2861)
//   - GPT2 字段: prompt/model/n/quality/moderation/size(像素串)/aspectRatio(camelCase)/resolution(1k|2k|4k)
//   - nano-banana 文生图: JSON /generations?async=true { prompt, model, aspect_ratio, image_size }
//   - nano-banana 图生图: multipart /edits?async=true 添加 image 多个
//   - Gemini 3 官方图像模型: JSON /v1/models/{model}:generateContent + generationConfig.responseFormat.image
//   - Grok Image: JSON /generations?async=true { model, prompt, aspect_ratio, image:[base64...]? }
// ========================================================================
async function callImageUpstreamAsync({ apiKey, finalApiModel, paramKind, prompt, n, aspect_ratio, image_size, refs, size, quality, moderation, response_format, output_format, signal }) {
  const upstreamBase = `${config.ZHENZHEN_BASE_URL}/v1/images`;
  const auth = `Bearer ${apiKey}`;
  const ar = String(aspect_ratio || '').trim();
  const isAuto = !ar || ar === 'Auto' || ar === 'AUTO' || ar === 'empty';
  const lvlLower = String(image_size || '1K').toLowerCase();
  const lvlUpper = String(image_size || '2K').toUpperCase();
  const hasRefs = Array.isArray(refs) && refs.length > 0;

  // ===== Gemini 3 官方图像格式(对齐 Nano Banana 2 Lite / Gemini 3 Pro Image generateContent) =====
  if (isOfficialGeminiImageModel(finalApiModel)) {
    const imageConfig = { aspectRatio: isAuto ? '1:1' : ar };
    const officialImageSize = geminiOfficialImageSize(finalApiModel, image_size || '2K');
    if (officialImageSize) imageConfig.imageSize = officialImageSize;
    const body = {
      contents: await buildGeminiOfficialContents(prompt, refs),
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        responseFormat: {
          image: imageConfig,
        },
      },
    };
    const url = `${config.ZHENZHEN_BASE_URL}/v1/models/${encodeURIComponent(finalApiModel)}:generateContent`;
    console.log('[upstream] Gemini official JSON → generateContent model:', finalApiModel, 'aspectRatio:', imageConfig.aspectRatio, 'imageSize:', imageConfig.imageSize || '', { refs: refs?.length || 0 });
    return await fetchProviderResponse(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  }

  // ===== Seedream V5 Pro (OpenAI Dall-e compatible JSON) =====
  // Text-to-image omits image; image editing uses the same endpoint with image[].
  if (paramKind === 'seedream-v5') {
    const seedreamRefs = [];
    if (hasRefs) {
      for (const ref of refs.slice(0, 10)) {
        const converted = await refToBananaImage(ref);
        if (converted) seedreamRefs.push(converted);
      }
      if (seedreamRefs.length === 0) {
        throw new Error('Seedream 参考图读取失败，已中止生成，避免按文生图生成');
      }
    }
    const requestedSize = String(size || image_size || '2048x2048')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[X×]/g, 'x');
    if (!/^\d+x\d+$/.test(requestedSize)) {
      throw new Error(`Seedream 尺寸格式无效: ${requestedSize || '(空)'}，应为 WIDTHxHEIGHT`);
    }
    const body = {
      model: finalApiModel,
      prompt,
      size: requestedSize,
      response_format: response_format === 'b64_json' ? 'b64_json' : 'url',
      output_format: output_format === 'jpeg' ? 'jpeg' : 'png',
    };
    if (seedreamRefs.length) body.image = seedreamRefs;
    const url = `${upstreamBase}/generations`;
    console.log('[upstream] Seedream JSON → /generations model:', finalApiModel, 'size:', body.size, 'output_format:', body.output_format, { requested: refs?.length || 0, converted: seedreamRefs.length });
    return await fetchProviderResponse(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
      signal,
    }, 'Seedream V5 Pro', {
      deadlineMs: SEEDREAM_V5_RESPONSE_DEADLINE_MS,
    });
  }

  // ===== Grok Image 路径(对齐 gpt-image-2-web Tab 12,默认参考图 Base64) =====
  if (paramKind === 'grok-image') {
    const grokRefs = [];
    if (hasRefs) {
      for (const ref of refs.slice(0, 4)) {
        const converted = await refToGrokImage(ref);
        if (converted) grokRefs.push(converted);
      }
      if (grokRefs.length === 0) {
        throw new Error('Grok 参考图读取失败，已中止生成，避免按无参考图生成');
      }
    }
    const body = { model: finalApiModel, prompt, aspect_ratio: isAuto ? '1:1' : ar };
    if (grokRefs.length) body.image = grokRefs;
    const url = `${upstreamBase}/generations?async=true`;
    console.log('[upstream] Grok Image JSON → /generations?async=true model:', finalApiModel, 'aspect_ratio:', body.aspect_ratio, { requested: refs?.length || 0, converted: grokRefs.length });
    return await fetchProviderResponse(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
      signal,
    });
  }

  // ===== GPT2 总走 multipart /edits?async=true(文生图加白图占位) =====
  if (paramKind === 'gpt-size') {
    const form = new FormData();
    const px = size || aspectToGptSize(ar, lvlLower);
    const normalizedQuality = ['auto', 'high', 'medium', 'low'].includes(String(quality || '').toLowerCase())
      ? String(quality).toLowerCase()
      : 'auto';
    const normalizedModeration = ['auto', 'low'].includes(String(moderation || '').toLowerCase())
      ? String(moderation).toLowerCase()
      : 'auto';
    form.append('prompt', prompt);
    form.append('model', finalApiModel);
    form.append('n', String(n || 1));
    form.append('quality', normalizedQuality);
    form.append('moderation', normalizedModeration);
    form.append('size', px);
    form.append('aspectRatio', isAuto ? '' : ar); // 主项目用 camelCase
    form.append('resolution', lvlLower);          // 主项目用小写 1k/2k/4k

    let convertedRefs = [];
    if (hasRefs) {
      convertedRefs = await collectConvertedImageRefs(refs, 'GPT2 参考图');
      appendConvertedImagesToForm(form, convertedRefs);
    } else {
      // 主项目 line 2861: 无参考图时创建 1024x1024 白图占位
      const whiteBuf = getWhitePng(1024, 1024);
      const blob = new Blob([whiteBuf], { type: 'image/png' });
      form.append('image', blob, 'blank.png');
    }

    const url = `${upstreamBase}/edits?async=true`;
    console.log('[upstream] GPT2 multipart → /edits?async=true model:', finalApiModel, 'size:', px, 'aspectRatio:', ar, 'resolution:', lvlLower, { requested: refs.length, converted: convertedRefs.length });
    return await fetchProviderResponse(url, { method: 'POST', headers: { Authorization: auth }, body: form, signal });
  }

  // ===== nano-banana 路径 =====
  if (hasRefs) {
    // 图生图 → multipart /edits?async=true
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('model', finalApiModel);
    form.append('aspect_ratio', isAuto ? '1:1' : ar);
    form.append('image_size', lvlUpper);
    const convertedRefs = await collectConvertedImageRefs(refs, 'nano-banana 参考图');
    appendConvertedImagesToForm(form, convertedRefs);
    const url = `${upstreamBase}/edits?async=true`;
    console.log('[upstream] nano-banana multipart → /edits?async=true model:', finalApiModel, 'aspect_ratio:', ar, 'image_size:', lvlUpper, { requested: refs.length, converted: convertedRefs.length });
    return await fetchProviderResponse(url, { method: 'POST', headers: { Authorization: auth }, body: form, signal });
  }
  // 文生图 → JSON /generations?async=true
  const body = { prompt, model: finalApiModel, aspect_ratio: isAuto ? '1:1' : ar };
  body.image_size = lvlUpper;
  const url = `${upstreamBase}/generations?async=true`;
  console.log('[upstream] nano-banana JSON → /generations?async=true model:', finalApiModel, 'aspect_ratio:', body.aspect_ratio, 'image_size:', body.image_size);
  return await fetchProviderResponse(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
    signal,
  });
}

// 将上游响应 normalize 为 { kind: 'sync'|'async', urls?, taskId? }
async function normalizeImageResponse(data, options = {}) {
  if (imageApiFailed(data)) {
    return { kind: 'failed', error: imageError(data) || '上游图像 API 返回失败' };
  }
  const materialized = await saveImageItemsFromResultDetailed(data, options);
  if (materialized.urls.length) return { kind: 'sync', urls: materialized.urls };
  // 异步任务 task_id
  const taskId = imageTaskId(data);
  if (taskId) return { kind: 'async', taskId };
  if (materialized.itemCount > 0) {
    const failure = completedImageOutputError(materialized);
    return { kind: 'failed', error: failure.message, code: failure.code };
  }
  return { kind: 'unknown' };
}

function seedreamNzProgress(value, fallback = '0%') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text}%` : text;
}

function seedanceNzTrace(value = {}) {
  const requestId = String(value?.requestId || '').trim();
  const upstreamHttpStatus = Number(value?.upstreamHttpStatus);
  const pollCount = value?.pollCount === undefined ? undefined : Math.max(0, Math.trunc(Number(value.pollCount) || 0));
  const usage = value?.usage && typeof value.usage === 'object' && !Array.isArray(value.usage) ? value.usage : undefined;
  return {
    ...(requestId ? { requestId } : {}),
    ...(Number.isInteger(upstreamHttpStatus) && upstreamHttpStatus >= 100 && upstreamHttpStatus <= 599 ? { upstreamHttpStatus } : {}),
    ...(pollCount !== undefined ? { pollCount } : {}),
    ...(usage ? { usage } : {}),
  };
}

// seedance.nz Seedream / Zhenzhen Image G-2 use a dedicated async protocol. Keep this route
// isolated from the existing zhenzhen /v1/images/generations implementation.
router.post('/image/seedance-nz/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitImageTask(req.body || {}, apiKey, { signal: req.t8AbortSignal });
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'seedance-nz-image',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        sync: false,
        taskId: result.taskId,
        status: 'pending',
        progress: '0%',
        model: result.model,
        taskProvider: 'seedance-nz-image',
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/image/seedance-nz/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'seedance.nz 图像请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/image/seedance-nz/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'seedance-nz-image');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  }
  try {
    const result = await seedanceNz.queryImageTask(req.params.tid, apiKey, { signal: req.t8AbortSignal });
    if (result.status === 'succeeded') {
      if (result.operationResult && typeof result.operationResult === 'object' && result.operationResult.image_id) {
        return res.json({
          success: true,
          data: {
            status: 'completed',
            progress: '100%',
            operationResult: result.operationResult,
            outputCount: 0,
            ...seedanceNzTrace(result),
          },
        });
      }
      const listedImageUrls = (Array.isArray(result.imageUrls) && result.imageUrls.length
        ? result.imageUrls
        : [result.imageUrl])
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      // queryImageTask has already normalized scalar fallbacks. Preserve the Provider's
      // canonical array exactly here so a repeated URL still represents a distinct output slot.
      const remoteImageUrls = listedImageUrls;
      if (!remoteImageUrls.length) {
        const failure = completedImageOutputError({ itemCount: 0, failures: [] });
        return sendCompletedImageOutputFailure(res, failure, seedanceNzTrace(result));
      }
      const urls = [];
      const failures = [];
      for (const [index, remoteUrl] of remoteImageUrls.entries()) {
        const saved = await saveRemoteImageDetailed(
          remoteUrl,
          seedanceNz.fetchRemote,
          `seedance-nz-image:${req.params.tid}:${index}`,
          req.t8AbortSignal,
        );
        if (saved.url) urls.push(saved.url);
        else if (saved.error) failures.push(saved.error);
      }
      if (urls.length !== remoteImageUrls.length) {
        const failure = completedImageOutputError({
          itemCount: remoteImageUrls.length,
          failures,
        });
        return sendCompletedImageOutputFailure(res, failure, seedanceNzTrace(result));
      }
      return res.json({
        success: true,
        data: {
          status: 'completed',
          progress: '100%',
          urls,
          outputCount: urls.length,
          ...seedanceNzTrace(result),
        },
      });
    }
    if (result.status === 'failed') {
      return res.json({
        success: false,
        data: {
          status: 'failed',
          progress: safeDiagnosticText(seedreamNzProgress(result.progress, '100%'), 80, [apiKey]),
          error: safeDiagnosticText(result.failReason || '图像任务失败', 240, [apiKey]),
          ...seedanceNzTrace(result),
        },
      });
    }
    return res.json({
      success: true,
      data: {
        status: result.status,
        progress: safeDiagnosticText(seedreamNzProgress(result.progress), 80, [apiKey]),
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/image/seedance-nz/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, {
      taskId: req.params.tid,
      status: 'materializing',
    })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'seedance.nz 图像查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/3d/seedance-nz/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  try {
    const result = await seedanceNz.submitHunyuan3dTask(req.body || {}, apiKey, { signal: req.t8AbortSignal });
    rememberTaskKey(result.taskId, apiKey, { provider: 'seedance-nz-3d', model: result.model, taskType: result.taskType });
    return res.json({
      success: true,
      data: { taskId: result.taskId, status: 'pending', progress: '0%', model: result.model, taskProvider: 'seedance-nz-3d', ...seedanceNzTrace(result) },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/3d/seedance-nz/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ success: false, error: proxyPublicError(error, 'Hunyuan 3D 请求失败', [apiKey]), ...seedanceNzTrace(error) });
  }
});

router.get('/3d/seedance-nz/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'seedance-nz-3d');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryHunyuan3dTask(req.params.tid, apiKey, { signal: req.t8AbortSignal });
    if (result.status === 'succeeded') {
      const remoteUrls = (Array.isArray(result.modelUrls) ? result.modelUrls : [result.modelUrl]).map((value) => String(value || '').trim()).filter(Boolean);
      if (!remoteUrls.length) return res.status(502).json({ success: false, data: { status: 'failed', progress: '100%', error: '3D 任务完成但未返回可下载模型文件', recoverable: true } });
      const modelUrls = [];
      const failures = [];
      for (const [index, remoteUrl] of remoteUrls.entries()) {
        const saved = await saveRemoteFalToolboxFile(remoteUrl, 'model3d', `seedance-nz-3d:${req.params.tid}:${index}`);
        if (saved.url) modelUrls.push(saved.url);
        else if (saved.error) failures.push(saved.error);
      }
      if (!modelUrls.length || modelUrls.length !== remoteUrls.length) {
        return res.status(502).json({ success: false, data: { status: 'materializing', progress: '99%', error: failures[0]?.message || '3D 模型下载尚未完成', recoverable: true, retryAfterMs: 800 } });
      }
      return res.json({ success: true, data: { status: 'completed', progress: '100%', modelUrl: modelUrls[0], modelUrls, urls: modelUrls, outputCount: modelUrls.length, ...seedanceNzTrace(result) } });
    }
    if (result.status === 'failed') return res.json({ success: false, data: { status: 'failed', progress: '100%', error: safeDiagnosticText(result.failReason || '3D 任务失败', 240, [apiKey]), ...seedanceNzTrace(result) } });
    return res.json({ success: true, data: { status: result.status, progress: safeDiagnosticText(seedreamNzProgress(result.progress), 80, [apiKey]), ...seedanceNzTrace(result) } });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/3d/seedance-nz/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid, status: 'materializing' })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ success: false, error: proxyPublicError(error, 'Hunyuan 3D 查询失败', [apiKey]), ...seedanceNzTrace(error) });
  }
});

async function materializeSeedanceNzMidjourneyResult(result, taskId, resultFamilyHint = '') {
  const resultFamily = String(resultFamilyHint || result?.resultFamily || '').trim().toLowerCase();
  const imageRefs = [...new Set([
    String(result?.gridImageUrl || '').trim(),
    ...(Array.isArray(result?.imageUrls) ? result.imageUrls : []),
  ].filter(Boolean))];
  const videoRefs = [...new Set((Array.isArray(result?.videoUrls) ? result.videoUrls : []).filter(Boolean))];
  const imageUrls = [];
  const videoUrls = [];
  const failures = [];

  for (const [index, ref] of imageRefs.entries()) {
    const saved = await saveRemoteImageDetailed(
      ref,
      seedanceNz.fetchRemote,
      `seedance-nz-midjourney:${taskId || 'sync'}:image:${index}`,
    );
    if (saved.url) imageUrls.push(saved.url);
    else if (saved.error) failures.push(saved.error);
  }
  for (const [index, ref] of videoRefs.entries()) {
    const saved = await saveRemoteVideoDetailed(
      ref,
      seedanceNz.fetchRemote,
      `seedance-nz-midjourney:${taskId || 'sync'}:video:${index}`,
    );
    if (saved.url) videoUrls.push(saved.url);
    else if (saved.error) failures.push(saved.error);
  }

  const text = String(result?.text || '').trim();
  const hasExpectedOutput = resultFamily === 'text'
    ? !!text
    : resultFamily === 'video'
      ? videoUrls.length > 0
      : imageUrls.length > 0 || videoUrls.length > 0 || !!text;
  let failure = null;
  if (!hasExpectedOutput) {
    failure = completedRemoteOutputError({
      itemCount: imageRefs.length + videoRefs.length,
      failures,
    }, resultFamily === 'video' ? 'video' : resultFamily === 'text' ? 'media' : 'image');
  }
  return {
    imageUrls,
    videoUrls,
    text,
    buttons: Array.isArray(result?.buttons) ? result.buttons : [],
    failures,
    failure,
  };
}

// 贞贞的平价AI小屋 Midjourney v1 动作协议。该路由与上方原贞贞AI工坊
// /mj/* 三路由完全隔离，避免 API Key、动作参数和轮询协议互相串线。
router.post('/image/seedance-nz/midjourney/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitMidjourneyAction(req.body || {}, apiKey);
    const taskId = String(result.taskId || '').trim();
    if (taskId) {
      rememberTaskKey(taskId, apiKey, {
        provider: 'seedance-nz-midjourney',
        operation: result.operation,
        action: result.action,
        resultFamily: result.resultFamily,
      });
    }
    const upstreamStatus = String(result.status || '').trim().toLowerCase();
    if (upstreamStatus === 'modal') {
      return res.json({
        success: true,
        data: {
          sync: true,
          status: 'modal',
          progress: result.progress || '',
          taskId,
          action: result.action,
          operation: result.operation,
          resultFamily: 'modal',
          buttons: result.buttons || [],
          ...seedanceNzTrace(result),
        },
      });
    }
    if (!taskId || result.sync) {
      const materialized = await materializeSeedanceNzMidjourneyResult(
        result,
        taskId || `sync-${diagnosticDigest(`${result.operation}:${Date.now()}`)}`,
        result.resultFamily,
      );
      if (materialized.failure) {
        return sendCompletedRemoteOutputFailure(res, materialized.failure, {
          action: result.action,
          operation: result.operation,
          resultFamily: result.resultFamily,
          taskId,
          ...seedanceNzTrace(result),
        });
      }
      return res.json({
        success: true,
        data: {
          sync: true,
          status: 'completed',
          progress: '100%',
          taskId,
          action: result.action,
          operation: result.operation,
          resultFamily: result.resultFamily,
          imageUrls: materialized.imageUrls,
          videoUrls: materialized.videoUrls,
          text: materialized.text,
          buttons: materialized.buttons,
          ...seedanceNzTrace(result),
        },
      });
    }
    return res.json({
      success: true,
      data: {
        sync: false,
        status: 'pending',
        progress: result.progress || '0%',
        taskId,
        action: result.action,
        operation: result.operation,
        resultFamily: result.resultFamily,
        buttons: result.buttons || [],
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/image/seedance-nz/midjourney/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, '平价AI小屋 Midjourney 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/image/seedance-nz/midjourney/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'seedance-nz-midjourney');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  }
  try {
    const result = await seedanceNz.queryMidjourneyTask(req.params.tid, apiKey);
    const taskId = String(result.taskId || req.params.tid).trim();
    if (result.status === 'modal') {
      return res.json({
        success: true,
        data: {
          status: 'modal',
          progress: result.progress || '',
          taskId,
          action: remembered?.action || 'inpaint',
          operation: remembered?.operation || 'midjourney-inpaint',
          resultFamily: 'modal',
          buttons: result.buttons || [],
          ...seedanceNzTrace(result),
        },
      });
    }
    if (result.status === 'succeeded') {
      const resultFamily = remembered?.resultFamily
        || (result.videoUrls?.length ? 'video' : result.text ? 'text' : 'image');
      const materialized = await materializeSeedanceNzMidjourneyResult(result, taskId, resultFamily);
      if (materialized.failure) {
        return sendCompletedRemoteOutputFailure(res, materialized.failure, {
          taskId,
          action: remembered?.action || '',
          operation: remembered?.operation || '',
          resultFamily,
          ...seedanceNzTrace(result),
        });
      }
      return res.json({
        success: true,
        data: {
          status: 'completed',
          progress: '100%',
          taskId,
          action: remembered?.action || '',
          operation: remembered?.operation || '',
          resultFamily,
          imageUrls: materialized.imageUrls,
          videoUrls: materialized.videoUrls,
          text: materialized.text,
          buttons: materialized.buttons,
          ...seedanceNzTrace(result),
        },
      });
    }
    if (result.status === 'failed') {
      return res.json({
        success: false,
        data: {
          status: 'failed',
          progress: seedreamNzProgress(result.progress, '100%'),
          taskId,
          error: result.failReason || 'Midjourney 任务失败',
          ...seedanceNzTrace(result),
        },
      });
    }
    return res.json({
      success: true,
      data: {
        status: result.status,
        progress: seedreamNzProgress(result.progress),
        taskId,
        buttons: result.buttons || [],
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/image/seedance-nz/midjourney/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, {
      taskId: req.params.tid,
      status: 'materializing',
    })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, '平价AI小屋 Midjourney 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/happyhorse/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitHappyHorseTask(req.body || {}, apiKey);
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'happyhorse-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/happyhorse/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Happy Horse 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/happyhorse/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'happyhorse-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey);
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `happyhorse-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'Happy Horse 任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'happyhorse_output_unusable',
        defaultMessage: 'Happy Horse 视频结果无法保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/happyhorse/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Happy Horse 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/hailuo/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitHailuoTask(req.body || {}, apiKey, { signal: req.t8AbortSignal });
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'hailuo-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        taskProvider: seedanceNz.PROVIDER_ID,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/hailuo/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Hailuo 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/hailuo/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'hailuo-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey, { signal: req.t8AbortSignal });
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `hailuo-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
      signal: req.t8AbortSignal,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'Hailuo 任务失败', 240, [apiKey])
        : '',
      taskProvider: seedanceNz.PROVIDER_ID,
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'hailuo_output_unusable',
        defaultMessage: 'Hailuo 视频结果无法保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/hailuo/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Hailuo 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/minimax-h3-context-ir/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitMinimaxH3ContextIrTask(
      req.body || {},
      apiKey,
      { signal: req.t8AbortSignal },
    );
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'minmax-h3-context-ir-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        taskProvider: seedanceNz.PROVIDER_ID,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/minimax-h3-context-ir/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'MiniMax H3 官方提示词增强请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/minimax-h3-context-ir/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'minmax-h3-context-ir-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryMinimaxH3ContextIrTask(
      req.params.tid,
      apiKey,
      { signal: req.t8AbortSignal },
    );
    return res.json({
      success: true,
      data: {
        status: result.status,
        progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
        resultText: result.resultText || '',
        failReason: result.status === 'failed'
          ? safeDiagnosticText(result.failReason || 'MiniMax H3 Context IR 任务失败', 240, [apiKey])
          : '',
        taskProvider: seedanceNz.PROVIDER_ID,
        model: remembered?.model || '',
        taskType: remembered?.taskType || '',
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/minimax-h3-context-ir/status 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'MiniMax H3 官方提示词增强查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/flux3/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitFlux3Task(req.body || {}, apiKey, { signal: req.t8AbortSignal });
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'flux3-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        taskProvider: seedanceNz.PROVIDER_ID,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/flux3/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'FLUX 3 Video 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/flux3/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'flux3-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey, { signal: req.t8AbortSignal });
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `flux3-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
      signal: req.t8AbortSignal,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      draftCache: safeDiagnosticText(result.draftCache || '', 262144, [apiKey]),
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'FLUX 3 Video 任务失败', 240, [apiKey])
        : '',
      taskProvider: seedanceNz.PROVIDER_ID,
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'flux3_output_unusable',
        defaultMessage: 'FLUX 3 Video 结果无法保存。',
      });
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/flux3/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'FLUX 3 Video 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/kling/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitKlingTask(req.body || {}, apiKey);
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'kling-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/kling/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Kling 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/kling/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'kling-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey);
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `kling-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'Kling 任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'kling_output_unusable',
        defaultMessage: 'Kling 视频结果无法保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/kling/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Kling 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/upscaler/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitUpscalerTask(req.body || {}, apiKey);
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'upscaler-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/upscaler/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Zhenzhen Upscaler 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/upscaler/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'upscaler-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey);
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `upscaler-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'Zhenzhen Upscaler 任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'upscaler_output_unusable',
        defaultMessage: 'Zhenzhen Upscaler 视频结果无法保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/upscaler/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Zhenzhen Upscaler 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/fashvsr/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitFashVsrTask(req.body || {}, apiKey, { signal: req.t8AbortSignal });
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'fashvsr-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/fashvsr/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'FlashVSR 视频超分请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/fashvsr/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'fashvsr-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryFashVsrTask(req.params.tid, apiKey, { signal: req.t8AbortSignal });
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `fashvsr-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'FlashVSR 视频超分任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || seedanceNz.FASHVSR_VIDEO_UPSCALE_MODEL,
      taskType: remembered?.taskType || 'upscale',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'fashvsr_output_unusable',
        defaultMessage: 'FlashVSR 视频结果无法保存。',
      });
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/fashvsr/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'FlashVSR 视频超分查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/vidu/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitViduTask(req.body || {}, apiKey);
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'vidu-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/vidu/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Vidu Q3 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/vidu/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'vidu-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey);
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `vidu-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'Vidu Q3 任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'vidu_output_unusable',
        defaultMessage: 'Vidu Q3 视频结果无法保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/vidu/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Vidu Q3 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/video/wan/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitWanTask(req.body || {}, apiKey);
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'wan-nz',
      model: result.model,
      taskType: result.taskType,
    });
    return res.json({
      success: true,
      data: {
        taskId: result.taskId,
        model: result.model,
        taskType: result.taskType,
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/wan/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Wan 视频请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/video/wan/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'wan-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryTask(req.params.tid, apiKey);
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: result.videoUrl,
      kind: 'video',
      materializationKey: `wan-nz:${req.params.tid}`,
      providerFetchImpl: seedanceNz.fetchRemote,
    });
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      videoUrl: materialized.url,
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || 'Wan 任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || '',
      taskType: remembered?.taskType || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failure) {
      return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
        defaultCode: 'wan_output_unusable',
        defaultMessage: 'Wan 视频结果无法保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/video/wan/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Wan 视频查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

function sunoNzResponseData(result, materialized, remembered = {}) {
  return {
    taskId: result?.taskId || remembered?.taskId || '',
    operation: result?.operation || remembered?.operation || '',
    status: materialized?.status || result?.status || 'pending',
    progress: safeDiagnosticText(materialized?.progress || result?.progress || '', 80),
    resultFamily: result?.resultFamily || remembered?.resultFamily || 'audio',
    text: safeDiagnosticText(materialized?.text || result?.text || '', 100_000),
    tracks: materialized?.tracks || [],
    audioUrls: materialized?.audioUrls || [],
    videoUrls: materialized?.videoUrls || [],
    imageUrls: materialized?.imageUrls || [],
    fileUrls: materialized?.fileUrls || [],
    artifacts: materialized?.artifacts || [],
    partialFailures: (materialized?.failures || []).map((failure) => ({
      code: safeDiagnosticText(failure?.code || 'output_unusable', 120),
      message: safeDiagnosticText(failure?.message || '部分结果保存失败', 500),
      recoverable: failure?.recoverable === true,
    })),
    failReason: result?.status === 'failed'
      ? safeDiagnosticText(result?.failReason || 'Suno 任务失败', 500)
      : '',
    ...seedanceNzTrace(result),
  };
}

router.post('/audio/suno-nz/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitSunoMusicTask(req.body || {}, apiKey);
    if (result.taskId) {
      rememberTaskKey(result.taskId, apiKey, {
        provider: 'suno-nz',
        taskId: result.taskId,
        operation: result.operation,
        resultFamily: result.resultFamily,
      });
    }
    const materialized = await materializeSunoNzResult(result, result.taskId || `sync:${result.operation}`);
    const responseData = sunoNzResponseData(result, materialized);
    if (String(result.status || '').toLowerCase() === 'succeeded') {
      const failure = sunoNzCompletedOutputFailure(result, materialized);
      if (failure) {
        return sendCompletedRemoteOutputFailure(res, failure, responseData, {
          defaultCode: 'suno_nz_output_unusable',
          defaultMessage: 'Suno 结果无法保存。',
        });
      }
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/suno-nz/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Suno 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/audio/suno-nz/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'suno-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.querySunoMusicTask(req.params.tid, apiKey, {
      resultFamily: remembered?.resultFamily,
    });
    result.operation = remembered?.operation || '';
    result.resultFamily = remembered?.resultFamily || result.resultFamily;
    const materialized = await materializeSunoNzResult(result, req.params.tid);
    const responseData = sunoNzResponseData(result, materialized, remembered);
    if (String(result.status || '').toLowerCase() === 'succeeded') {
      const failure = sunoNzCompletedOutputFailure(result, materialized);
      if (failure) {
        return sendCompletedRemoteOutputFailure(res, failure, responseData, {
          defaultCode: 'suno_nz_output_unusable',
          defaultMessage: 'Suno 结果无法保存。',
        });
      }
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/suno-nz/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, {
      taskId: req.params.tid,
      data: { tracks: [] },
    })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Suno 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

function flowMusicResponseData(result, materialized, remembered = {}) {
  const base = sunoNzResponseData(result, materialized, remembered);
  const clipIds = Array.isArray(result?.clipIds)
    ? result.clipIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!clipIds.length) {
    for (const track of base.tracks || []) {
      const clipId = String(track?.clipId || '').trim();
      if (clipId && !clipIds.includes(clipId)) clipIds.push(clipId);
    }
  }
  return {
    ...base,
    model: 'flowmusic',
    operation: result?.operation || remembered?.operation || '',
    clipIds,
    clipId: clipIds[0] || '',
  };
}

router.post('/audio/flowmusic/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitFlowMusicTask(req.body || {}, apiKey);
    if (result.taskId) {
      rememberTaskKey(result.taskId, apiKey, {
        provider: 'flowmusic-nz',
        taskId: result.taskId,
        operation: result.operation,
        resultFamily: result.resultFamily,
      });
    }
    const materialized = await materializeSunoNzResult(
      result,
      result.taskId || `sync:${result.operation}`,
      { materializationPrefix: 'flowmusic-nz' },
    );
    const responseData = flowMusicResponseData(result, materialized);
    if (String(result.status || '').toLowerCase() === 'succeeded') {
      const failure = sunoNzCompletedOutputFailure(result, materialized);
      if (failure) {
        return sendCompletedRemoteOutputFailure(res, failure, responseData, {
          defaultCode: 'flowmusic_output_unusable',
          defaultMessage: 'Flow Music 结果无法保存。',
        });
      }
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/flowmusic/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Flow Music 请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.get('/audio/flowmusic/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'flowmusic-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryFlowMusicTask(req.params.tid, apiKey, {
      resultFamily: remembered?.resultFamily,
    });
    result.operation = remembered?.operation || '';
    result.resultFamily = remembered?.resultFamily || result.resultFamily;
    const materialized = await materializeSunoNzResult(
      result,
      req.params.tid,
      { materializationPrefix: 'flowmusic-nz' },
    );
    const responseData = flowMusicResponseData(result, materialized, remembered);
    if (String(result.status || '').toLowerCase() === 'succeeded') {
      const failure = sunoNzCompletedOutputFailure(result, materialized);
      if (failure) {
        return sendCompletedRemoteOutputFailure(res, failure, responseData, {
          defaultCode: 'flowmusic_output_unusable',
          defaultMessage: 'Flow Music 结果无法保存。',
        });
      }
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/flowmusic/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid, data: { tracks: [] } })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Flow Music 查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/audio/seed-audio/submit', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.submitAudioTask(req.body || {}, apiKey);
    rememberTaskKey(result.taskId, apiKey, {
      provider: 'seed-audio-nz',
      model: result.model,
    });
    return res.json({ success: true, data: { taskId: result.taskId, model: result.model, ...seedanceNzTrace(result) } });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/seed-audio/submit 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, '平价AI小屋音频请求失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

async function materializeSeedanceNzAudioResults(result, taskId) {
  const status = String(result?.status || '').trim().toLowerCase();
  if (!['succeeded', 'success', 'completed'].includes(status)) {
    return { audioUrls: [], failures: [] };
  }
  const remoteUrls = (Array.isArray(result?.audioUrls) && result.audioUrls.length
    ? result.audioUrls
    : [result?.audioUrl])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (remoteUrls.length === 0) {
    if (String(result?.resultText || '').trim()) return { audioUrls: [], failures: [] };
    return { audioUrls: [], failures: [completedRemoteOutputError({ itemCount: 0 }, 'audio')] };
  }
  const audioUrls = [];
  const failures = [];
  for (let index = 0; index < remoteUrls.length; index += 1) {
    const materialized = await materializeRemoteTaskOutput({
      status: result.status,
      remoteUrl: remoteUrls[index],
      kind: 'audio',
      materializationKey: `seed-audio-nz:${taskId}:${index}`,
    });
    if (materialized.url) audioUrls.push(materialized.url);
    if (materialized.failure) failures.push(materialized.failure);
  }
  return { audioUrls, failures };
}

router.get('/audio/seed-audio/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  const remembered = recallTaskMeta(req.params.tid, 'seed-audio-nz');
  const apiKey = String(remembered?.apiKey || settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) return res.status(400).json({ success: false, error: '缺少贞贞的平价AI小屋 API Key' });
  try {
    const result = await seedanceNz.queryAudioTask(req.params.tid, apiKey);
    const materialized = await materializeSeedanceNzAudioResults(result, req.params.tid);
    const responseData = {
      status: result.status,
      progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
      audioUrl: materialized.audioUrls[0] || '',
      audioUrls: materialized.audioUrls,
      resultText: safeDiagnosticText(result.resultText || '', 100_000, [apiKey]),
      tracks: materialized.audioUrls.map((audioUrl, index) => ({
        id: `${req.params.tid}:${index}`,
        clipId: req.params.tid,
        audioUrl,
        title: `${remembered?.model || '音频'} #${index + 1}`,
      })),
      failReason: result.status === 'failed'
        ? safeDiagnosticText(result.failReason || '音频任务失败', 240, [apiKey])
        : '',
      model: remembered?.model || '',
      ...seedanceNzTrace(result),
    };
    if (materialized.failures.length) {
      return sendCompletedRemoteOutputFailure(res, materialized.failures[0], responseData, {
        defaultCode: 'seed_audio_output_unusable',
        defaultMessage: '音频结果无法完整保存。',
      });
    }
    return res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/seed-audio/status 错误', error, [apiKey]);
    if (sendTaskResultQueryRecovery(res, error, { taskId: req.params.tid })) return;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, '平价AI小屋音频查询失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/audio/whisper/transcribe', async (req, res) => {
  const settings = loadRawSettings();
  const apiKey = String(settings?.zhenzhenSd2ApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请先在 API 设置中填写“贞贞的平价AI小屋 API Key”' });
  }
  try {
    const result = await seedanceNz.transcribeAudio(req.body || {}, apiKey, { signal: req.t8AbortSignal });
    return res.json({
      success: true,
      data: {
        text: result.text,
        model: result.model,
        responseFormat: result.responseFormat,
        segments: Array.isArray(result.segments) ? result.segments : [],
        ...seedanceNzTrace(result),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    proxyRouteError('proxy/audio/whisper/transcribe 错误', error, [apiKey]);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: proxyPublicError(error, 'Whisper 转写失败', [apiKey]),
      ...seedanceNzTrace(error),
    });
  }
});

router.post('/image', async (req, res) => {
  const settings = loadRawSettings();
  const {
    model, apiModel, paramKind: paramKindIn,
    prompt, n,
    aspect_ratio, image_size,
    images, image, size, quality, moderation, response_format, output_format, providerParams,
  } = req.body || {};
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
  if (!ensureKeyOrSelectedGroup(settings, res, apiModel || model || '', '图像', providerParams)) return;
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt 必填' });
  const originalApiModel = String(apiModel || model || '');
  const gptImage2ForcedSize = gptImage2ZhenzhenVariantSize(originalApiModel);
  const finalApiModel = normalizeImageApiModel(originalApiModel);
  const ml = `${originalApiModel} ${finalApiModel}`.toLowerCase();
  const paramKind = paramKindIn || (ml.includes('seedream-v5') ? 'seedream-v5' : (ml.includes('grok') && ml.includes('image') ? 'grok-image' : (isBananaImageModel(ml) ? 'banana-ratio' : 'gpt-size')));
  if (!finalApiModel) return res.status(400).json({ success: false, error: 'model 必填' });
  const refs = Array.isArray(images) ? images.filter(Boolean) : [];
  if (typeof image === 'string' && image && !refs.includes(image)) refs.unshift(image);

  let apiKey = String(settings?.zhenzhenApiKey || '');
  try {
    const providerContext = await applyZhenzhenProviderContext(settings, {
      route: 'image',
      kind: 'image',
      model: finalApiModel,
      hint: apiModel || model || '',
      providerParams,
    });
    apiKey = String(settings.zhenzhenApiKey || '');
    const r = await callImageUpstreamAsync({
      apiKey, finalApiModel, paramKind,
      prompt, n, aspect_ratio, image_size: gptImage2ForcedSize || image_size, refs, size: gptImage2ForcedSize ? undefined : size, quality, moderation, response_format, output_format,
      signal: req.t8AbortSignal,
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Image generation failed');
      await invalidateZhenzhenProviderKey(
        providerContext,
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({
        success: false,
        error: providerError.message,
      });
    }
    const data = await parseJsonResponse(r, 'Image generation');
    const norm = await normalizeImageResponse(data, { signal: req.t8AbortSignal });
    if (norm.kind === 'failed') {
      await invalidateZhenzhenProviderKey(providerContext, apiKey, norm.error);
      return res.status(502).json({
        success: false,
        ...(norm.code ? { code: norm.code } : {}),
        error: proxyPublicError({ message: norm.error }, '上游图像任务失败', [apiKey]),
      });
    }
    if (norm.kind === 'sync') {
      return res.json({ success: true, data: { urls: norm.urls, model: finalApiModel, prompt } });
    }
    if (norm.kind === 'async') {
      // 同步接口需要同步返回结果 → 内部轮询
      const url = await pollImageTask(norm.taskId, apiKey);
      if (!url) return res.status(500).json({ success: false, error: '异步任务轮询超时/失败', taskId: norm.taskId });
      return res.json({ success: true, data: { urls: [url], taskId: norm.taskId, model: finalApiModel, prompt } });
    }
    return res.status(502).json({ success: false, error: '上游未返回图片或 task_id' });
  } catch (e) {
    proxyRouteError('proxy/image 错误', e, [apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

// ========================================================================
// 图像异步任务接口(与主项目 gpt-image-2-web 一致)
// POST /api/proxy/image/submit -> { taskId }(同 submit 逻辑,但不同步轮询)
// GET  /api/proxy/image/status/:tid -> { status, progress, urls? }
// ========================================================================
router.post('/image/submit', async (req, res) => {
  const settings = loadRawSettings();
  let apiKey = String(settings?.zhenzhenApiKey || '');
  try {
    const { model, apiModel, paramKind: paramKindIn, prompt, n,
            aspect_ratio, image_size, images, image, size, quality, moderation, response_format, output_format, providerParams } = req.body || {};
    // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
    if (!ensureKeyOrSelectedGroup(settings, res, apiModel || model || '', '图像', providerParams)) return;
    apiKey = String(settings.zhenzhenApiKey || '');
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt 不得为空' });
    const originalApiModel = String(apiModel || model || '');
    const gptImage2ForcedSize = gptImage2ZhenzhenVariantSize(originalApiModel);
    const finalApiModel = normalizeImageApiModel(originalApiModel);
    const ml = `${originalApiModel} ${finalApiModel}`.toLowerCase();
    const paramKind = paramKindIn || (ml.includes('seedream-v5') ? 'seedream-v5' : (ml.includes('grok') && ml.includes('image') ? 'grok-image' : (isBananaImageModel(ml) ? 'banana-ratio' : 'gpt-size')));
    if (!finalApiModel) return res.status(400).json({ success: false, error: 'model 必填' });
    const refs = Array.isArray(images) ? images.filter(Boolean) : [];
    if (typeof image === 'string' && image && !refs.includes(image)) refs.unshift(image);

    // 完全对齐主项目 gpt-image-2-web:走 ?async=true,GPT2 强制 multipart edits + 白图占位
    const providerContext = await applyZhenzhenProviderContext(settings, {
      route: 'image/submit',
      kind: 'image',
      model: finalApiModel,
      hint: apiModel || model || '',
      providerParams,
    });
    apiKey = String(settings.zhenzhenApiKey || '');
    const r = await callImageUpstreamAsync({
      apiKey, finalApiModel, paramKind,
      prompt, n, aspect_ratio, image_size: gptImage2ForcedSize || image_size, refs, size: gptImage2ForcedSize ? undefined : size, quality, moderation, response_format, output_format,
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Image submit failed');
      await invalidateZhenzhenProviderKey(
        providerContext,
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Image submit');

    const norm = await normalizeImageResponse(data, { signal: req.t8AbortSignal });
    if (norm.kind === 'failed') {
      await invalidateZhenzhenProviderKey(providerContext, apiKey, norm.error);
      return res.status(502).json({
        success: false,
        ...(norm.code ? { code: norm.code } : {}),
        error: proxyPublicError({ message: norm.error }, '上游图像任务失败', [apiKey]),
      });
    }
    if (norm.kind === 'sync') {
      return res.json({ success: true, data: { sync: true, status: 'completed', progress: '100%', urls: norm.urls } });
    }
    if (norm.kind === 'async') {
      rememberTaskKey(norm.taskId, apiKey, { authorityScope: 'zhenzhen-image', model: finalApiModel, ...providerContext.taskMeta });
      return res.json({ success: true, data: { sync: false, taskId: norm.taskId, status: 'pending', progress: '0%' } });
    }
    return res.status(502).json({ success: false, error: '上游未返回图片或 task_id' });
  } catch (e) {
    proxyRouteError('proxy/image/submit 错误', e, [apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

// 查询异步图像任务状态
router.get('/image/status/:tid', async (req, res) => {
  const settings = loadRawSettings();
  // 优先从 submit 阶段记录的 (taskId → key) 映射恢复，防止前端未传 model 导致 fallback 错 key。
  const rememberedMeta = recallTaskMeta(req.params.tid, 'zhenzhen-image');
  if (rememberedMeta?.apiKey) {
    if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
    else return res.status(400).json({ success: false, error: '未找到 settings' });
  } else {
    // v1.2.9.15: 一体化「专属优先 fallback 通用」校验（查询阶段可选传 ?model=xxx）
    if (!ensureKey(settings, res, String(req.query.model || ''), '图像')) return;
  }
  const tid = req.params.tid;
  const apiKey = String(settings.zhenzhenApiKey || '');
  try {
    const url = `${config.ZHENZHEN_BASE_URL}/v1/images/tasks/${encodeURIComponent(tid)}`;
    const r = await fetchProviderResponse(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: req.t8AbortSignal });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Image status failed');
      await invalidateZhenzhenProviderKey(
        { taskMeta: rememberedMeta || {} },
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Image status');
    if (imageApiFailed(data)) {
      const errorText = imageError(data) || '任务失败';
      await invalidateZhenzhenProviderKey({ taskMeta: rememberedMeta || {} }, apiKey, errorText);
      return res.json({
        success: false,
        data: { status: 'failed', progress: '0%', error: proxyPublicError({ message: errorText }, '任务失败', [apiKey]) },
      });
    }
    const statusRaw = imageStatus(data);
    const status = String(statusRaw || '').toLowerCase();
    const inner = data?.data && typeof data.data === 'object' ? data.data : {};
    const progress = inner.progress || data?.progress || '0%';
    const SUCCESS = ['success', 'completed', 'complete', 'done', 'finished'];
    const FAILURE = ['failure', 'failed', 'error', 'cancelled', 'canceled'];
    const materialized = await saveImageItemsFromResultDetailed(data, {
      materializationScope: `zhenzhen-image:${tid}`,
      signal: req.t8AbortSignal,
    });
    if (materialized.urls.length) {
      return res.json({ success: true, data: { status: 'completed', progress: '100%', urls: materialized.urls } });
    }
    if (SUCCESS.includes(status)) {
      const failure = completedImageOutputError(materialized);
      return sendCompletedImageOutputFailure(res, failure);
    }
    if (FAILURE.includes(status)) {
      return res.json({
        success: false,
        data: {
          status: 'failed',
          progress,
          error: proxyPublicError({ message: imageError(data) || inner.fail_reason }, '任务失败', [apiKey]),
        },
      });
    }
    res.json({ success: true, data: { status: status || 'pending', progress } });
  } catch (e) {
    proxyRouteError('proxy/image/status 错误', e, [apiKey]);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId: tid,
      status: 'materializing',
    })) return;
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '查询失败', [apiKey]) });
  }
});

// ========== 图像异步任务轮询(同步代理内部使用,路径对齐主项目 /v1/images/tasks/) ==========
// 轮询上限:1800 × 2s = 3600s = 60 分钟,与前端 ImageNode 标准路径保持一致,
// 避免 GPT2 复杂 prompt / 多参考图任务被 120s 提前中断。
async function pollImageTask(taskId, apiKey, maxRetries = 1800, interval = 2000) {
  const url = `${config.ZHENZHEN_BASE_URL}/v1/images/tasks/${encodeURIComponent(taskId)}`;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, interval));
    try {
      const r = await fetchProviderResponse(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!r.ok) {
        await boundedProviderHttpError(r, 'Image poll failed');
        continue;
      }
      const data = await parseJsonResponse(r, 'Image poll');
      const st = String(imageStatus(data) || '').toLowerCase();
      const materialized = await saveImageItemsFromResultDetailed(data, {
        materializationScope: `zhenzhen-image:${taskId}`,
      });
      if (materialized.urls.length) {
        return materialized.urls[0];
      }
      if (['success', 'completed', 'complete', 'done', 'finished'].includes(st)) {
        const failure = completedImageOutputError(materialized);
        if (failure.recoverable) {
          if (i === 0 || (i + 1) % 15 === 0) {
            console.warn(
              '[poll] 图片已生成，等待本机网络恢复后转存:',
              safeDiagnosticText(failure.message, 200, [apiKey]),
            );
          }
          continue;
        }
        throw failure;
      }
      if (['failure', 'failed', 'error', 'cancelled', 'canceled'].includes(st) || imageApiFailed(data)) {
        console.error('[poll] 任务失败:', opaqueDiagnosticSummary('reason', imageError(data) || st));
        return null;
      }
    } catch (e) {
      if (e?.imageOutputFailure) throw e;
      console.warn('[poll] 轮询异常:', safeDiagnosticText(e?.message || e, 200, [apiKey]));
    }
  }
  return null;
}

// ========================================================================
// FAL 渠道 —— 完全对齐 gpt-image-2-web SKILL.md §FAL模型渠道接入规范
// 不破坏原有 /image · /image/submit · /image/status/:tid 三个路由。
//
// 核心路由:
//   POST /api/proxy/image/fal/submit   -> { sync, urls?, requestId?, endpoint? }
//   POST /api/proxy/image/fal/query    -> { status, images?, error? }   body: { endpoint, requestId }
//
// 主项目上游协议(index.html line 2890 runGPTFal / line 3587 runNanoFal):
//   URL: ${baseUrl}/fal/${endpoint}
//   Auth: Bearer ${apiKey}
//   GPT FAL  endpoint: 'openai/gpt-image-2' 或 'openai/gpt-image-2/edit'
//   NBPro FAL endpoint: 'fal-ai/nano-banana-pro/edit'
//   参考图上传: POST ${baseUrl}/v1/files  (复用现有 uploadRefToZhenzhen)
//   response_url 域名修复: queue.fal.run → ${baseUrl}/fal
//   轮询 HTTP 非200时 body 中 status=IN_QUEUE/IN_PROGRESS 仍视为进行中
// ========================================================================

const FAL_REGISTRY = {
  'gpt-image-2-fal': {
    endpoint: 'openai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    paramKind: 'gpt-fal',
    maxRefs: 5,
  },
  'nano-banana-pro-fal': {
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
  // 主项目 runGeminiFal (line 3491) 与 runNanoFal 共用同一 fal-ai/nano-banana-pro/edit 端点 + 同 paramKind。
  // 只是 UI 控件 id 前缀不同 (g2f_* vs nf_*)。后端零增量分支，复用 nbpro-fal payload 组装。
  'nano-banana-2-fal': {
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
};

function falRegistryEndpoints(registry) {
  const endpoints = new Set();
  for (const entry of Object.values(registry || {})) {
    for (const key of ['endpoint', 'editEndpoint', 'i2vEndpoint', 'referenceEndpoint']) {
      if (entry?.[key]) endpoints.add(String(entry[key]));
    }
  }
  return endpoints;
}

function resolveFalQueryTarget(options = {}) {
  const requestId = safeFalRequestId(options.requestId);
  if (!requestId) throw new Error('FAL requestId 格式无效');
  const remembered = options.rememberedMeta;
  if (!remembered || remembered.route !== options.route) {
    throw Object.assign(new Error('FAL 任务注册已失效，请重新提交任务'), { status: 409 });
  }
  const endpoint = String(remembered.endpoint || '');
  const target = trustedFalPollUrl(remembered.responseUrl, options.baseUrl)
    || constructedFalPollUrl(options.baseUrl, endpoint, requestId);
  if (!target) throw new Error('FAL 轮询地址无法从服务端任务注册恢复');
  const supplied = String(options.suppliedUrl || '').trim();
  if (supplied) throw new Error('FAL 轮询地址只能由服务端任务注册恢复');
  return { endpoint, responseUrl: target };
}

// 按 16 倍数对齐(主项目 line 2904)
function snap16(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(256, Math.min(3840, Math.round(n / 16) * 16));
}

function safeFalRequestId(value) {
  const requestId = String(value || '').trim();
  if (requestId === '.' || requestId === '..') return '';
  return /^[a-z0-9._:-]{1,256}$/i.test(requestId) ? requestId : '';
}

function falBaseUrl(baseUrl) {
  const parsed = new URL(String(baseUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('FAL Provider Base URL 配置无效');
  }
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/fal/`;
  return parsed;
}

function trustedFalPollUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const providerBase = falBaseUrl(baseUrl);
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('FAL 轮询地址格式无效');
  }
  let candidate = parsed;
  if (parsed.origin === 'https://queue.fal.run' || parsed.origin === 'https://fal.run') {
    candidate = new URL(providerBase.toString());
    candidate.pathname = `${providerBase.pathname}${parsed.pathname.replace(/^\/+/, '')}`;
    candidate.search = parsed.search;
  }
  if (candidate.origin !== providerBase.origin || !candidate.pathname.startsWith(providerBase.pathname)) {
    throw new Error('FAL 轮询地址不属于已配置 Provider');
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(candidate.pathname); } catch (_) { throw new Error('FAL 轮询地址编码无效'); }
  if (decodedPath.includes('\\') || decodedPath.includes('\0')
    || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('FAL 轮询地址路径无效');
  }
  return candidate.toString();
}

function constructedFalPollUrl(baseUrl, endpoint, requestId) {
  const normalizedEndpoint = String(endpoint || '').trim();
  const normalizedRequestId = safeFalRequestId(requestId);
  if (!isFalToolboxEndpoint(normalizedEndpoint) || !normalizedRequestId) return '';
  const providerBase = falBaseUrl(baseUrl);
  providerBase.pathname = `${providerBase.pathname}${normalizedEndpoint}/requests/${encodeURIComponent(normalizedRequestId)}`;
  return trustedFalPollUrl(providerBase.toString(), baseUrl);
}

// Provider response URLs are accepted only from the exact configured FAL
// origin/path (or queue.fal.run, which is rewritten onto that trusted path).
function fixFalResponseUrl(responseUrl, baseUrl, endpoint, requestId) {
  const supplied = String(responseUrl || '').trim();
  if (supplied) return trustedFalPollUrl(supplied, baseUrl);
  const requestEndpoint = String(endpoint || '').startsWith('fal-ai/sora-2/')
    ? 'fal-ai/sora-2'
    : endpoint;
  return constructedFalPollUrl(baseUrl, requestEndpoint, requestId);
}

// POST /api/proxy/image/fal/submit
//   body 公用: { apiModel, prompt, images?, n?, format?, sync?, ... }
//   gpt-fal 专属: { mode?: 'edit'|'gen', size?: '1024x1024'|'square'|...|'custom', customW?, customH?, quality?: low|medium|high|auto }
//   nbpro-fal 专属: { aspect_ratio, resolution, safety_tolerance, seed?, system_prompt?, enable_web_search?, image_mode?: 'image_url'|'base64' }
router.post('/image/fal/submit', async (req, res) => {
  const settings = loadRawSettings();
  const {
    apiModel, prompt, images, n, format, sync,
    // gpt-fal
    mode, size, customW, customH, quality,
    // nbpro-fal
    aspect_ratio, resolution, safety_tolerance, seed,
    system_prompt, enable_web_search, image_mode,
  } = req.body || {};
  // FAL 全部固定使用通用贞贞 API Key，不参与 New API 分组令牌。
  if (!ensureDefaultZhenzhenKey(settings, res, '图像 FAL')) return;
  let apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;

  if (!apiModel) return res.status(400).json({ success: false, error: 'apiModel 必填' });
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt 不得为空' });

  const reg = FAL_REGISTRY[apiModel];
  if (!reg) return res.status(400).json({ success: false, error: `未知的 FAL 模型: ${apiModel}` });

  const refs = Array.isArray(images) ? images.filter(Boolean) : [];
  const trimmedRefs = refs.slice(0, reg.maxRefs);
  const numImages = Math.max(1, Math.min(4, parseInt(n ?? 1, 10) || 1));
  const outputFormat = String(format || 'png').toLowerCase();

  // ========== 根据 paramKind 组装 payload ==========
  let payload;
  let endpoint;
  try {
    if (reg.paramKind === 'gpt-fal') {
      // 选 endpoint: edit 或 gen
      const useEdit = (mode === 'edit') || (mode !== 'gen' && trimmedRefs.length > 0);
      endpoint = useEdit ? (reg.editEndpoint || reg.endpoint) : reg.endpoint;
      // image_size
      let imageSize;
      const sz = String(size || 'auto');
      if (sz === 'custom') {
        imageSize = { width: snap16(customW, 1280), height: snap16(customH, 1280) };
      } else if (sz && sz !== 'auto') {
        imageSize = sz; // 预设字串 square_hd / portrait_16_9 等,或像素串
      }
      payload = {
        prompt,
        quality: String(quality || 'medium'),
        num_images: numImages,
        output_format: outputFormat,
      };
      if (imageSize) payload.image_size = imageSize;
      // image_urls 仅在 edit 下添加
      if (useEdit && trimmedRefs.length) {
        const urls = [];
        for (let i = 0; i < trimmedRefs.length; i++) {
          const u = await uploadRefToZhenzhen(trimmedRefs[i], apiKey);
          if (u) urls.push(u);
          else throw new Error(`FAL 参考图 #${i + 1} 上传失败`);
        }
        if (urls.length) payload.image_urls = urls;
      }
      if (sync === true || sync === 'true') payload.sync_mode = true;
    } else if (reg.paramKind === 'nbpro-fal') {
      // nano-banana-pro 只有 edit 端点
      endpoint = reg.endpoint;
      payload = {
        prompt,
        num_images: numImages,
        aspect_ratio: String(aspect_ratio || 'auto'),
        resolution: String(resolution || '2K'),
        output_format: outputFormat,
        safety_tolerance: String(safety_tolerance || '4'),
      };
      if (seed && Number(seed) > 0) payload.seed = Number(seed);
      if (system_prompt) payload.system_prompt = String(system_prompt);
      if (enable_web_search === true || enable_web_search === 'true') payload.enable_web_search = true;
      // 参考图(最多 8 张)
      if (trimmedRefs.length) {
        const imgs = [];
        const useBase64 = String(image_mode || 'image_url') === 'base64';
        for (let i = 0; i < trimmedRefs.length; i++) {
          const r = trimmedRefs[i];
          if (useBase64) {
            // 转 base64 dataURI
            const conv = await refToBananaImage(r);
            if (conv) imgs.push(conv);
          } else {
            const u = await uploadRefToZhenzhen(r, apiKey);
            if (u) imgs.push(u);
            else throw new Error(`FAL 参考图 #${i + 1} 上传失败`);
          }
        }
        if (imgs.length) payload.image_urls = imgs;
      }
    } else {
      return res.status(400).json({ success: false, error: `不支持的 FAL paramKind: ${reg.paramKind}` });
    }

    const falUrl = `${baseUrl}/fal/${endpoint}`;
    console.log('[fal/submit]', apiModel, '→', falUrl, '| payload keys:', Object.keys(payload), '| refs:', trimmedRefs.length);

    const resp = await fetchProviderResponse(falUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: req.t8AbortSignal,
    });
    const data = await parseJsonResponse(resp, 'FAL image submit');
    if (!resp.ok) {
      return res.status(resp.status).json({
        success: false,
        error: `FAL HTTP ${resp.status}`,
      });
    }
    if (Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'FAL 参数校验错误' });
    }
    if (data?.detail && !data?.images && !data?.request_id) {
      return res.status(400).json({ success: false, error: 'FAL 请求被 Provider 拒绝' });
    }

    // 同步返回
    if (Array.isArray(data?.images) && data.images.length) {
      const materialized = await saveImageItemsFromResultDetailed(data, { signal: req.t8AbortSignal });
      if (!materialized.urls.length) {
        const failure = completedImageOutputError(materialized);
        return res.status(502).json({
          success: false,
          code: failure.code,
          error: `${failure.message} 此接口未返回可继续查询的任务 ID，请网络恢复后重新生成。`,
        });
      }
      return res.json({ success: true, data: { sync: true, urls: materialized.urls, endpoint } });
    }

    // 异步
    const requestId = safeFalRequestId(data?.request_id);
    let responseUrl = data?.response_url || '';
    if (!requestId) {
      return res.status(502).json({ success: false, error: 'FAL 返回的 request_id 无效' });
    }
    responseUrl = fixFalResponseUrl(responseUrl, baseUrl, endpoint, requestId);
    if (!responseUrl) return res.status(502).json({ success: false, error: 'FAL 未返回可验证的轮询地址' });
    const registered = rememberFalTask('image-fal', requestId, apiKey, {
      model: apiModel,
      endpoint,
      responseUrl,
    });
    if (!registered) return res.status(502).json({ success: false, error: 'FAL 任务注册失败' });
    return res.json({
      success: true,
      data: { sync: false, requestId, endpoint },
    });
  } catch (e) {
    proxyRouteError('proxy/image/fal/submit 错误', e);
    return res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e) });
  }
});

// POST /api/proxy/image/fal/query
//   body: { endpoint, requestId }
//   返回: { status: 'pending'|'completed'|'failed', urls?, error? }
router.post('/image/fal/query', async (req, res) => {
  const settings = loadRawSettings();
  const { responseUrl: rawUrl, endpoint, requestId } = req.body || {};
  const rememberedMeta = recallFalTask('image-fal', requestId);
  if (!rememberedMeta) return res.status(409).json({ success: false, error: 'FAL 图像任务注册已失效，请重新提交任务' });
  if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
  else return res.status(400).json({ success: false, error: '未找到 settings' });
  const apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;

  try {
    const target = resolveFalQueryTarget({
      route: 'image-fal',
      requestId,
      endpoint,
      suppliedUrl: rawUrl,
      rememberedMeta,
      baseUrl,
    });
    const responseUrl = target.responseUrl;
    const pr = await fetchFalPollJson(responseUrl, apiKey, req.t8AbortSignal);
    const data = pr.data;
    // HTTP 非200: 主项目规范 - body 中 status=IN_QUEUE/IN_PROGRESS 视为继续等待,其他报错
    if (!pr.ok) {
      if (data && (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS')) {
        return res.json({ success: true, data: { status: 'pending', falStatus: String(data.status) } });
      }
      return res.status(pr.status).json({
        success: false,
        error: `FAL Poll HTTP ${pr.status}`,
      });
    }
    if (!data) {
      return res.status(502).json({ success: false, error: 'FAL Poll 响应非 JSON' });
    }
    // 完成
    if (Array.isArray(data.images) && data.images.length) {
      const materialized = await saveImageItemsFromResultDetailed(data, {
        materializationScope: `image-fal:${requestId}`,
        signal: req.t8AbortSignal,
      });
      if (!materialized.urls.length) {
        const failure = completedImageOutputError(materialized);
        return sendCompletedImageOutputFailure(res, failure);
      }
      return res.json({ success: true, data: { status: 'completed', urls: materialized.urls } });
    }
    const st = String(data.status || '').toUpperCase();
    if (st === 'COMPLETED' || st === 'SUCCESS') {
      const failure = completedImageOutputError({ itemCount: 0, failures: [] });
      return sendCompletedImageOutputFailure(res, failure);
    }
    if (st === 'FAILED' || st === 'CANCELLED') {
      return res.json({
        success: false,
        data: { status: 'failed', error: `FAL ${st}` },
      });
    }
    // IN_QUEUE / IN_PROGRESS / 空 => pending
    return res.json({ success: true, data: { status: 'pending', falStatus: st || 'IN_QUEUE' } });
  } catch (e) {
    proxyRouteError('proxy/image/fal/query 错误', e);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId: requestId,
      status: 'materializing',
    })) return;
    return res.status(Number(e?.status) || 400).json({ success: false, error: proxyPublicError(e, '查询失败') });
  }
});

// ============================================================================
// Midjourney 三路由：严格对齐 gpt-image-2-web server.py _handle_mj_imagine / _handle_mj_fetch_task / _handle_mj_upload
//   上游：{ZHENZHEN_BASE_URL}/{mj-turbo|mj-fast|mj-relax}/mj/submit/imagine
//          {ZHENZHEN_BASE_URL}/{...}/mj/task/{id}/fetch
//          {ZHENZHEN_BASE_URL}/{...}/mj/submit/upload-discord-images
//   服从贞贞工坊集中 Key（同上其他 zhenzhen 路由）。
// ============================================================================
const MJ_SPEED_MAP = { turbo: 'mj-turbo', fast: 'mj-fast', relax: 'mj-relax' };
function mjSpeedSeg(speed) {
  return MJ_SPEED_MAP[String(speed || '').toLowerCase()] || 'mj-fast';
}

function safeMjTaskId(value) {
  const taskId = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,512}$/.test(taskId) ? taskId : '';
}

function mjImageReferences(data) {
  const values = [];
  let list = data?.image_urls ?? data?.imageUrls;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch (_) { list = []; }
  }
  if (Array.isArray(list)) {
    for (const item of list.slice(0, 8)) {
      const value = typeof item === 'string' ? item : item?.url || item?.image_url || item?.imageUrl;
      if (value) values.push(String(value));
    }
  }
  const single = data?.image_url || data?.imageUrl;
  if (single) values.unshift(String(single));
  return [...new Set(values)].slice(0, 8);
}

function safeProviderReferenceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4096) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return '';
    for (const key of parsed.searchParams.keys()) {
      if (/token|secret|signature|credential|api[_-]?key|authorization|password/i.test(key)) return '';
    }
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

// ---- POST /api/proxy/mj/imagine ----
// body: { prompt, ar?, no?, c?, s?, iw?, sw?, cw?, sv?, seed?, base64Array?, speed?, modes?, instanceId?, notifyHook?, remix? }
// 返回上游 imagine 原始响应 { code, description, result(taskId), properties }
router.post('/mj/imagine', async (req, res) => {
  const settings = loadRawSettings();
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
  if (!ensureKey(settings, res, 'mj', 'MJ')) return;
  const body = req.body || {};
  const speedSeg = mjSpeedSeg(body.speed);
  const url = `${config.ZHENZHEN_BASE_URL}/${speedSeg}/mj/submit/imagine`;
  // 严格对齐主项目 runMJ payload（index.html L4547~L4587）
  const payload = {
    base64Array: Array.isArray(body.base64Array) ? body.base64Array : [],
    instanceId: body.instanceId || '',
    modes: Array.isArray(body.modes) ? body.modes : [],
    notifyHook: body.notifyHook || '',
    prompt: String(body.prompt || ''),
    remix: body.remix !== false,
    state: body.state || '',
    ar: body.ar || null,
    no: body.no || null,
    c: body.c || null,
    s: body.s || null,
    iw: body.iw || null,
    tile: false,
    r: null,
    video: false,
    sw: body.sw || null,
    cw: body.cw || null,
    sv: body.sv || null,
    seed: body.seed || null,
  };
  try {
    console.log(`[mj/imagine] -> ${url} ${opaqueDiagnosticSummary('prompt', payload.prompt)}`);
    const r = await fetchProviderResponse(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.zhenzhenApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'MJ imagine failed');
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'MJ imagine');
    const taskId = safeMjTaskId(data?.result || data?.task_id || data?.taskId);
    if (data?.code !== undefined && Number(data.code) !== 1) {
      return res.status(502).json({ success: false, error: 'MJ Provider 拒绝了生成任务' });
    }
    if (!taskId) return res.status(502).json({ success: false, error: 'MJ 未返回有效 taskId' });
    return res.json({ success: true, data: { taskId } });
  } catch (e) {
    proxyRouteError('proxy/mj/imagine 错误', e, [settings.zhenzhenApiKey]);
    return res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '提交失败', [settings.zhenzhenApiKey]) });
  }
});

// ---- GET /api/proxy/mj/task/:id?speed=fast ----
// 轮询任务状态
router.get('/mj/task/:id', async (req, res) => {
  const settings = loadRawSettings();
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
  if (!ensureKey(settings, res, 'mj', 'MJ')) return;
  const taskId = req.params.id;
  const speedSeg = mjSpeedSeg(req.query.speed);
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId 必填' });
  const url = `${config.ZHENZHEN_BASE_URL}/${speedSeg}/mj/task/${encodeURIComponent(taskId)}/fetch`;
  try {
    const r = await fetchProviderResponse(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.zhenzhenApiKey}`,
      },
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'MJ task failed');
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'MJ task');
    const upstreamStatus = String(data?.status || '').toUpperCase();
    const status = ['SUBMITTED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE'].includes(upstreamStatus)
      ? upstreamStatus
      : 'IN_PROGRESS';
    const imageUrls = [];
    if (status === 'SUCCESS') {
      const references = mjImageReferences(data);
      const failures = [];
      for (const [outputIndex, ref] of references.entries()) {
        const saved = await saveRemoteImageDetailed(ref, null, `midjourney:${taskId}:${outputIndex}`);
        if (saved.url) imageUrls.push(saved.url);
        else if (saved.error) failures.push(saved.error);
      }
      if (!imageUrls.length) {
        const failure = completedImageOutputError({ itemCount: references.length, failures });
        return sendCompletedImageOutputFailure(res, failure);
      }
    }
    return res.json({
      success: true,
      data: {
        status,
        progress: safeDiagnosticText(data?.progress || '', 80, [settings.zhenzhenApiKey]),
        imageUrl: imageUrls[0] || '',
        imageUrls,
        ...(status === 'FAILURE' ? { failReason: 'MJ 任务失败' } : {}),
      },
    });
  } catch (e) {
    proxyRouteError('proxy/mj/task 错误', e, [settings.zhenzhenApiKey]);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId,
      status: 'materializing',
    })) return;
    return res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '查询失败', [settings.zhenzhenApiKey]) });
  }
});

// ---- POST /api/proxy/mj/upload ----
// body: { base64Data: 'data:image/png;base64,xxxx', speed? }
// 上传参考图到 MJ Discord，返回 URL（主项目 uploadMJImage L4407 + server.py L2457）
router.post('/mj/upload', async (req, res) => {
  const settings = loadRawSettings();
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
  if (!ensureKey(settings, res, 'mj', 'MJ')) return;
  const { base64Data, speed } = req.body || {};
  if (!base64Data) return res.status(400).json({ success: false, error: 'base64Data 不得为空' });
  const speedSeg = mjSpeedSeg(speed);
  const url = `${config.ZHENZHEN_BASE_URL}/${speedSeg}/mj/submit/upload-discord-images`;
  const payload = { base64Array: [base64Data], instanceId: '', notifyHook: '' };
  try {
    const r = await fetchProviderResponse(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.zhenzhenApiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'MJ upload failed');
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'MJ upload');
    if (data.status === 'FAILURE') return res.status(502).json({ success: false, error: 'MJ 参考图上传失败' });
    let imgUrl = '';
    if (Array.isArray(data.result)) imgUrl = data.result[0] || '';
    else if (typeof data.result === 'string') imgUrl = data.result;
    imgUrl = safeProviderReferenceUrl(imgUrl);
    if (!imgUrl) return res.status(502).json({ success: false, error: 'MJ 未返回安全的参考图 URL' });
    return res.json({ success: true, data: { url: imgUrl } });
  } catch (e) {
    proxyRouteError('proxy/mj/upload 错误', e, [settings.zhenzhenApiKey]);
    return res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '上传失败', [settings.zhenzhenApiKey]) });
  }
});

// ========== POST /api/proxy/llm — LLM Chat(独立 Key) ==========
const SEEDANCE_NZ_LLM_MODEL_SET = new Set(seedanceNzLlmModels);

function resolveBuiltInLlmProvider(settings, requestedSource, model) {
  const source = requestedSource === 'seedance-nz' ? 'seedance-nz' : 'zhenzhen';
  if (source === 'seedance-nz') {
    const normalizedModel = String(model || '').trim();
    return {
      source,
      apiKey: String(settings?.zhenzhenSd2ApiKey || ''),
      baseUrl: config.ZHENZHEN_SD2_BASE_URL,
      label: '贞贞的平价AI小屋',
      modelAllowed: SEEDANCE_NZ_LLM_MODEL_SET.has(normalizedModel),
      missingKeyError: '未配置贞贞的平价AI小屋 API Key',
    };
  }
  return {
    source,
    apiKey: String(settings?.llmApiKey || ''),
    baseUrl: config.ZHENZHEN_BASE_URL,
    label: '贞贞的AI工坊-独立LLM Key',
    modelAllowed: true,
    missingKeyError: '未配置 LLM 独立 API Key',
  };
}

function hasLlmVideoParts(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((msg) => Array.isArray(msg?.content) && msg.content.some((part) => (
    part?.type === 'video_url' || part?.type === 'input_video' || !!part?.video_url || !!part?.input_video
  )));
}

const MINIMAX_H3_REQUEST_PROFILE = 'minimax-h3-prompt-enhancer';
const MINIMAX_MUSIC3_REQUEST_PROFILE = 'minimax-music3-prompt-enhancer';
const SEEDANCE20_REQUEST_PROFILE = 'seedance20-prompt-enhancer';
const MV_MUSIC_MASTER_REQUEST_PROFILE = 'mv-music-master';
const PROMPT_ENHANCER_REQUEST_PROFILES = new Set([
  MINIMAX_H3_REQUEST_PROFILE,
  MINIMAX_MUSIC3_REQUEST_PROFILE,
  SEEDANCE20_REQUEST_PROFILE,
  MV_MUSIC_MASTER_REQUEST_PROFILE,
]);
const MINIMAX_H3_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const MINIMAX_H3_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];

async function uploadMiniMaxH3MessageMedia(messages, provider, requestProfile = MINIMAX_H3_REQUEST_PROFILE) {
  const output = [];
  let pictureIndex = 0;
  let videoIndex = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(message?.content)) {
      output.push(message);
      continue;
    }
    const content = [];
    for (const part of message.content) {
      const imageUrl = part?.type === 'image_url' ? String(part?.image_url?.url || '').trim() : '';
      const videoUrl = part?.type === 'video_url' ? String(part?.video_url?.url || '').trim() : '';
      if (imageUrl) {
        pictureIndex += 1;
        const url = await seedanceNz.uploadMedia(imageUrl, 'image', provider.apiKey, {
          baseUrl: provider.baseUrl,
          maxBytes: MINIMAX_H3_MEDIA_MAX_BYTES,
          normalizeImagePng: true,
          fileName: `picture_${pictureIndex}.png`,
          cacheVariant: `${requestProfile}-picture-${pictureIndex}`,
        });
        content.push({ ...part, image_url: { ...part.image_url, url } });
        continue;
      }
      if (videoUrl) {
        videoIndex += 1;
        const url = await seedanceNz.uploadMedia(videoUrl, 'video', provider.apiKey, {
          baseUrl: provider.baseUrl,
          maxBytes: MINIMAX_H3_MEDIA_MAX_BYTES,
          allowedMimes: MINIMAX_H3_VIDEO_MIMES,
          cacheVariant: `${requestProfile}-video-${videoIndex}`,
        });
        content.push({ ...part, video_url: { ...part.video_url, url } });
        continue;
      }
      content.push(part);
    }
    output.push({ ...message, content });
  }
  return output;
}

function redactExactSecrets(value, exactSecrets = []) {
  let text = String(value ?? '');
  for (const secret of new Set((Array.isArray(exactSecrets) ? exactSecrets : [exactSecrets])
    .map((entry) => String(entry || ''))
    .filter((entry) => entry.length >= 4))) {
    text = text.split(secret).join('[redacted-secret]');
  }
  return text;
}

function normalizeLlmUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = {};
  for (const [key, raw] of Object.entries(value).slice(0, 32)) {
    if (!/^(?:total|prompt|completion|input|output|cached|reasoning)[_-]?tokens?(?:[_-]?count)?$/i.test(key)) continue;
    const number = Number(raw);
    if (Number.isFinite(number) && number >= 0) output[key] = number;
  }
  return Object.keys(output).length ? output : undefined;
}

function sanitizedLlmSseEvent(rawLine, exactSecrets) {
  const line = String(rawLine || '').trim();
  if (!line || line.startsWith(':')) return line.startsWith(':') ? ':\n\n' : '';
  if (!line.startsWith('data:')) return '';
  const rawData = line.slice(5).trim();
  if (rawData === '[DONE]') return 'data: [DONE]\n\n';
  let parsed;
  try { parsed = JSON.parse(rawData); } catch (_) { return ''; }
  const sourceChoice = parsed?.choices?.[0];
  const safeChoice = {};
  const deltaContent = sourceChoice?.delta?.content;
  if (typeof deltaContent === 'string') {
    safeChoice.delta = { content: redactExactSecrets(deltaContent, exactSecrets) };
  }
  const finishReason = safeDiagnosticText(
    sourceChoice?.finish_reason || sourceChoice?.finishReason || '',
    80,
    exactSecrets,
  );
  if (finishReason) safeChoice.finish_reason = finishReason;
  const usage = normalizeLlmUsage(parsed?.usage);
  if (!safeChoice.delta && !safeChoice.finish_reason && !usage) return '';
  return `data: ${JSON.stringify({
    ...(Object.keys(safeChoice).length ? { choices: [safeChoice] } : {}),
    ...(usage ? { usage } : {}),
  })}\n\n`;
}

async function pipeSanitizedProviderSse(req, res, response, label, exactSecrets = []) {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    await readBoundedProviderResponse(response, label);
    throw providerResponseError('provider_stream_invalid_type', `${label} 未返回 SSE`, { status: 502 });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw providerResponseError('provider_stream_missing', `${label} 未返回可读流`, { status: 502 });
  }
  const inheritedDeadlineAt = Number(providerResponseTimings.get(response)?.deadlineAt);
  const timing = {
    deadlineAt: Number.isFinite(inheritedDeadlineAt) && inheritedDeadlineAt > 0
      ? inheritedDeadlineAt
      : Date.now() + providerFetchDeadlineMs(),
    idleTimeoutMs: boundedProxyInteger(
      proxySafeRemoteTestOptions?.idleTimeoutMs,
      PROXY_REMOTE_IDLE_TIMEOUT_MS,
      10,
      60_000,
    ),
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  let providerDone = false;
  let clientClosedReject;
  const clientClosed = new Promise((_, reject) => { clientClosedReject = reject; });
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientClosedReject(providerResponseError('client_stream_closed', '客户端已关闭流式响应'));
    }
  };
  res.once('close', onClientClose);
  const ensureHeaders = () => {
    if (res.headersSent || res.destroyed) return;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const requestId = safeMjTaskId(response.headers?.get?.('x-request-id'));
    if (requestId) res.setHeader('X-Request-Id', requestId);
  };
  const emitLine = (line) => {
    const safeEvent = sanitizedLlmSseEvent(line, exactSecrets);
    if (!safeEvent) return false;
    ensureHeaders();
    res.write(safeEvent);
    return safeEvent.includes('data: [DONE]');
  };
  try {
    while (!providerDone) {
      const step = await waitForProviderBodyStep(
        Promise.race([reader.read(), clientClosed]),
        timing,
        label,
      );
      if (step.done) break;
      const value = step.value instanceof Uint8Array ? step.value : Buffer.from(step.value || []);
      total += value.byteLength;
      if (total > PROXY_PROVIDER_SSE_MAX_BYTES) {
        throw providerResponseError(
          'provider_response_too_large',
          `${label} 响应超过 ${PROXY_PROVIDER_SSE_MAX_BYTES} bytes 限制`,
          { status: 502 },
        );
      }
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer, 'utf8') > PROXY_PROVIDER_SSE_MAX_LINE_BYTES) {
        throw providerResponseError('provider_sse_line_too_large', `${label} SSE 行超过限制`, { status: 502 });
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (emitLine(line)) {
          providerDone = true;
          break;
        }
      }
    }
    buffer += decoder.decode();
    if (!providerDone && buffer) providerDone = emitLine(buffer);
    if (providerDone) {
      try { await reader.cancel(); } catch (_) {}
    }
    ensureHeaders();
    res.end();
  } catch (error) {
    try { await reader.cancel(error); } catch (_) {}
    if (res.headersSent) {
      res.destroy();
      return;
    }
    throw error;
  } finally {
    res.removeListener('close', onClientClose);
    reader.releaseLock?.();
  }
}

// body: { model, messages, temperature?, max_tokens?, stream?, llmVideoMode? }
//   - messages[i].content 支持 string 或 多模态数组 [{type:'text',text} | {type:'image_url',image_url:{url}} | {type:'video_url',video_url:{url}}]
//   - stream=true → 透传上游 SSE(text/event-stream) 到前端；有视频时强制非流式，避免网关丢多模态附件
//   - 完全对齐 gpt-image-2-web _doSendChat (index.html L8128~L8305)
router.post('/llm', async (req, res) => {
  const settings = loadRawSettings();
  const { model, messages, temperature, max_tokens, stream, source } = req.body || {};
  if (!model || !messages) {
    return res.status(400).json({ success: false, error: 'model 和 messages 必填' });
  }
  const provider = resolveBuiltInLlmProvider(settings, source, model);
  if (!provider.apiKey) {
    return res.status(400).json({ success: false, error: provider.missingKeyError });
  }
  if (!provider.modelAllowed) {
    return res.status(400).json({
      success: false,
      error: `贞贞的平价AI小屋不支持模型 ${String(model).slice(0, 240)}，请从平台模型列表重新选择。`,
    });
  }
  const inputHadVideos = hasLlmVideoParts(messages);

  // 预处理 messages 中的 image_url / video_url:
  //   - 图片: 本地 /files/* 转 base64 dataURL
  //   - 视频: 默认用项目内置 ffmpeg 抽关键帧转 image_url；或按用户选择发送原视频 Base64 / URL
  // 避免上游 LLM 服务拿着本地相对路径报 convert_request_failed。
  const requestProfile = String(req.body?.requestProfile || '').trim();
  const promptEnhancerProfile = PROMPT_ENHANCER_REQUEST_PROFILES.has(requestProfile);
  let normalizedMessages;
  try {
    normalizedMessages = promptEnhancerProfile && provider.source === 'seedance-nz'
      ? await uploadMiniMaxH3MessageMedia(messages, provider, requestProfile)
      : await normalizeLlmMessageMedia(messages, req.body || {}, {
          baseUrl: `http://127.0.0.1:${config.PORT}`,
        });
  } catch (e) {
    return res.status(400).json({ success: false, error: proxyPublicError(e, '多模态素材预处理失败') });
  }

  const upstream = `${String(provider.baseUrl || '').replace(/\/+$/, '')}/v1/chat/completions`;
  const payload = {
    model,
    messages: normalizedMessages,
    temperature: temperature ?? 0.7,
    max_tokens: max_tokens ?? 16384,
    stream: !!stream && !inputHadVideos,
  };

  try {
    const r = await fetchProviderResponse(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: req.t8AbortSignal,
    }, 'Provider', { noRetry: promptEnhancerProfile });

    // ===== 流式分支:SSE pass-through =====
    if (payload.stream) {
      if (!r.ok) {
        const providerError = await boundedProviderHttpError(r, 'LLM stream failed');
        return res.status(r.status).json({ success: false, error: providerError.message });
      }
      await pipeSanitizedProviderSse(req, res, r, `${provider.label} LLM stream`, [provider.apiKey]);
      return;
    }

    // ===== 非流式分支(gpt-image-2-all 等) =====
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'LLM request failed');
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'LLM response');
    // 处理 content 可能是字符串或多模态数组(gpt-image-2-all 出图)
    const choice = data?.choices?.[0];
    let content = choice?.message?.content || '';
    const imageReferences = [];
    if (Array.isArray(content)) {
      let textParts = '';
      content.forEach((part) => {
        if (part?.type === 'text') textParts += part.text || '';
        else if (part?.type === 'image_url' && part.image_url?.url) imageReferences.push(part.image_url.url);
        else if (part?.type === 'image' && part.image_url?.url) imageReferences.push(part.image_url.url);
      });
      content = textParts;
    }
    if (Array.isArray(data?.data)) {
      data.data.forEach((d) => {
        if (d?.url) imageReferences.push(d.url);
        else if (d?.b64_json) imageReferences.push(`data:image/png;base64,${d.b64_json}`);
      });
    }
    const imageUrls = [];
    const imageFailures = [];
    for (const reference of [...new Set(imageReferences)].slice(0, 16)) {
      if (String(reference || '').startsWith('data:')) {
        const local = saveBase64Image(reference);
        if (local) imageUrls.push(local);
        else imageFailures.push({
          code: 'image_download_invalid_content',
          message: '图片已经生成，但返回的 Base64 图片内容无效，无法保存。',
        });
      } else {
        const saved = await saveRemoteImageDetailed(reference);
        if (saved.url) imageUrls.push(saved.url);
        else if (saved.error) imageFailures.push(saved.error);
      }
    }
    if (imageReferences.length && !imageUrls.length) {
      const failure = completedImageOutputError({
        itemCount: imageReferences.length,
        failures: imageFailures,
      });
      return res.status(failure.status).json({
        success: false,
        code: failure.code,
        error: failure.message,
      });
    }
    const finishReason = safeDiagnosticText(
      choice?.finish_reason || choice?.finishReason || '',
      80,
      [provider.apiKey],
    );
    const usage = normalizeLlmUsage(data?.usage);
    const requestId = safeMjTaskId(data?.id || r.headers?.get?.('x-request-id'));
    res.json({
      success: true,
      data: {
        content: redactExactSecrets(typeof content === 'string' ? content : '', [provider.apiKey]),
        imageUrls,
        model: String(model).slice(0, 240),
        finishReason,
        truncated: ['length', 'max_tokens', 'content_length'].includes(String(finishReason || '').toLowerCase()),
        ...(usage ? { usage } : {}),
        ...(requestId ? { requestId } : {}),
      },
    });
  } catch (e) {
    if (res.headersSent || res.destroyed) return;
    proxyRouteError('proxy/llm 错误', e, [provider.apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [provider.apiKey]) });
  }
});

// ========================================================================
// 视频生成(异步) — 完全对齐 gpt-image-2-web
// 协议(贞贞工坊): POST /v2/videos/generations + GET /v2/videos/generations/:tid
//
// 通过 model 字段自动选择上游 payload 协议:
//   - veo-omni-10s  → Veo Omni 协议: POST /v1/videos multipart
//                      { model=omni_flash-10s, prompt, size, seconds=10, watermark, input_reference }
//   - 含 'veo'      → Veo3.1 协议:  { prompt, model, enhance_prompt, aspect_ratio, seed?, enable_upsample?, images?(base64,最多3) }
//                       (主项目 runVeo3, index.html line 3372)
//   - 含 'grok'     → Grok Video 协议: { prompt, model, ratio, duration(数字秒), resolution, seed?, images?(URL,最多7) }
//                       (主项目 runGrok3, index.html line 3863) — 参考图先 POST /v1/files 取 URL
//   - 其它(seedance 等)→ 沿用旧 Veo 字段(零破坏)
// ========================================================================

// 上传本地/远端参考素材到上游 /v1/files 取 URL
// 对齐 gpt-image-2-web 的 uploadFileToAPI: Seedance 的图像、视频、音频都不能直接传 /files/* 本地 URL。
async function uploadRefToZhenzhen(ref, apiKey, label = '参考素材') {
  if (typeof ref !== 'string' || !ref) throw new Error(`${label} 上传失败: 引用为空`);
  const trimmed = normalizeT8LocalMediaRef(ref, {
    allowedPorts: [config.PORT, 11422],
  });
  if (/^asset-[a-z0-9_-]+$/i.test(trimmed)) return trimmed;
  let buf, mime, ext;
  if (trimmed.startsWith('data:')) {
    const m = trimmed.match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) throw new Error(`${label} 上传失败: data URL 格式无效`);
    mime = m[1] || 'image/png';
    buf = Buffer.from(m[2], 'base64');
    validateProxyMediaBuffer(buf, mime, {
      allowedKinds: ['image', 'video', 'audio'],
      maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
    });
    ext = extFromContentType(mime) || (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  } else if (isT8LocalMediaPath(trimmed) || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    let sourceName = trimmed;
    const local = isT8LocalMediaPath(trimmed)
      ? await readProviderLocalMediaRefBuffer(trimmed, {
        allowedKinds: ['image', 'video', 'audio'],
        maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
      })
      : null;
    if (isT8LocalMediaPath(trimmed)) {
      if (!local) throw new Error(`${label} 上传失败: 本地资源不存在或越出授权目录`);
      sourceName = local.filename;
      buf = local.buffer;
      mime = local.contentType;
    } else {
      const remote = await fetchProxyRemoteMedia(trimmed, {
        allowedKinds: ['image', 'video', 'audio'],
        maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
      });
      buf = remote.buffer;
      mime = remote.contentType || 'application/octet-stream';
      sourceName = remote.filename || sourceName;
    }
    const tailExt = sourceName.split(/[?#]/)[0].match(/\.([a-z0-9]{2,8})$/i)?.[1];
    ext = extFromContentType(mime) || tailExt || (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  } else {
    throw new Error(`${label} 上传失败: 不支持的引用地址`);
  }
  const fd = new FormData();
  const blob = new Blob([buf], { type: mime });
  fd.append('file', blob, `ref_${Date.now()}.${ext}`);
  const upR = await fetchProviderResponse(`${config.ZHENZHEN_BASE_URL}/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!upR.ok) {
    const providerError = await boundedProviderHttpError(upR, `${label} /v1/files upload failed`);
    throw providerError;
  }
  const j = await parseJsonResponse(upR, `${label} /v1/files upload`);
  const uploadedUrl = j?.url || j?.file_url || j?.data?.url || j?.data?.file_url || null;
  if (!uploadedUrl) throw new Error(`${label} 上传失败: /v1/files 未返回 url`);
  return uploadedUrl;
}

// ========================================================================
// Video FAL 渠道 — 完全对齐 gpt-image-2-web runVeo3Fal / runGrokFal
// 不破坏原有 /video/submit · /video/query 路由。
//
// POST /api/proxy/video/fal/submit  → { sync, videoUrl?, requestId?, endpoint? }
// POST /api/proxy/video/fal/query   → { status, videoUrl?, error? }   body: { endpoint, requestId }
// ========================================================================

const VIDEO_FAL_REGISTRY = {
  'veo3.1-fal': {
    endpoint: 'fal-ai/veo3.1/fast/reference-to-video',
    paramKind: 'veo-fal',
    maxRefImages: 3,
  },
  'grok-video-fal': {
    endpoint: 'xai/grok-imagine-video/text-to-video',
    i2vEndpoint: 'xai/grok-imagine-video/image-to-video',
    referenceEndpoint: 'xai/grok-imagine-video/reference-to-video',
    paramKind: 'grok-fal',
    maxRefImages: 7,
    defaultImageMode: 'base64',
  },
  'grok-imagine-video-1.5': {
    endpoint: 'xai/grok-imagine-video/v1.5/image-to-video',
    paramKind: 'grok-fal',
    maxRefImages: 1,
    defaultImageMode: 'base64',
    requiresImage: true,
    disableAspectRatio: true,
  },
  'sora-2': {
    endpoint: 'fal-ai/sora-2/text-to-video',
    i2vEndpoint: 'fal-ai/sora-2/image-to-video',
    paramKind: 'sora-fal',
    maxRefImages: 1,
    defaultImageMode: 'base64',
  },
};

function getFalVideoUrl(data) {
  const video = data && data.video;
  if (video && typeof video === 'object' && video.url) return video.url;
  if (typeof video === 'string') return video;
  return data?.video_url
    || data?.url
    || data?.output?.video?.url
    || data?.data?.output
    || data?.data?.video_url
    || data?.data?.video?.url
    || '';
}

function splitSoraCharacterIds(raw) {
  return String(raw || '')
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function splitGrokReferenceUrls(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || '').split(/[,，\n]/);
  return values
    .map((s) => String(s || '').trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function stripDataUrlPrefix(value) {
  const text = String(value || '').trim();
  const match = /^data:[^,;]+;base64,(.+)$/i.exec(text);
  return match ? match[1].trim() : text;
}

const VEO_OMNI_PUBLIC_MODEL = 'veo-omni-10s';
const VEO_OMNI_UPSTREAM_MODEL = 'omni_flash-10s';
const GROK_VIDEO_1_5_NEW_MODELS = new Set([
  'grok-1.5-video-6s',
  'grok-1.5-video-10s',
  'grok-1.5-video-15s',
]);

function isVeoOmniModel(model) {
  const m = String(model || '').trim().toLowerCase();
  return m === VEO_OMNI_PUBLIC_MODEL || m === VEO_OMNI_UPSTREAM_MODEL;
}

function isGrokVideo15NewModel(model) {
  const m = String(model || '').trim().toLowerCase();
  return GROK_VIDEO_1_5_NEW_MODELS.has(m);
}

function veoOmniSizeFromAspect(aspectRatio) {
  return String(aspectRatio || '').trim() === '9:16' ? '720x1280' : '1280x720';
}

function grokVideo15NewSizeFromRatio(ratioOrSize) {
  const value = String(ratioOrSize || '').trim();
  if (value === '720x1280') return '720x1280';
  if (value === '9:16') return '720x1280';
  return '1280x720';
}

async function appendGrokVideo15InputReference(form, ref) {
  const refText = String(ref || '').trim();
  if (!refText) return false;
  if (/^https?:\/\//i.test(refText)) {
    form.append('input_reference', refText);
    return true;
  }
  const conv = await refToBuffer(refText);
  if (!conv) return false;
  form.append('input_reference', new Blob([conv.buf], { type: conv.mime || 'image/png' }), `input_reference.${conv.ext || 'png'}`);
  return true;
}

function normalizeVideoTaskStatus(status) {
  const raw = String(status || '').trim();
  const lower = raw.toLowerCase();
  if (['success', 'succeeded', 'completed', 'complete', 'done'].includes(lower)) return 'SUCCESS';
  if (['failure', 'failed', 'error', 'cancelled', 'canceled'].includes(lower)) return 'FAILURE';
  if (['running', 'processing', 'in_progress', 'in-progress'].includes(lower)) return 'RUNNING';
  if (['queued', 'pending', 'created', 'submitted'].includes(lower)) return 'PENDING';
  return raw.toUpperCase();
}

function stringifyUpstreamErrorValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return value.message.trim();
    if (typeof value.msg === 'string') return value.msg.trim();
    if (typeof value.detail === 'string') return value.detail.trim();
    try { return JSON.stringify(value).slice(0, 500); } catch { return ''; }
  }
  return String(value).trim();
}

function getUpstreamErrorMessage(data, text, status) {
  const candidates = [
    data?.error?.message,
    data?.error,
    data?.message,
    data?.msg,
    data?.detail,
    data?.error_msg,
    data?.fail_reason,
    data?.data?.error?.message,
    data?.data?.error,
    data?.data?.message,
    data?.data?.msg,
    data?.data?.detail,
    data?.data?.fail_reason,
  ];
  for (const candidate of candidates) {
    const msg = stringifyUpstreamErrorValue(candidate);
    if (msg) return `上游 HTTP ${status}: ${msg}`;
  }
  const rawText = String(text || '').trim();
  if (rawText) return `上游 HTTP ${status}: ${rawText.slice(0, 500)}`;
  return `上游 HTTP ${status}`;
}

// 保存远程视频到本地。异步任务查询可能被多个前端轮询/恢复请求同时命中；
// 同一 Provider task 必须只转存一次，否则每次“已完成”查询都会生成一个重复 vid_* 文件。
const VIDEO_MATERIALIZATION_MAX_ENTRIES = 4096;
const videoMaterializationCache = new Map();
const videoMaterializationInFlight = new Map();

function materializedOutputExists(localUrl) {
  return isCommittedMaterializedOutputUrl(config.OUTPUT_DIR, localUrl);
}

function resetVideoMaterializationCacheForTests() {
  videoMaterializationCache.clear();
  videoMaterializationInFlight.clear();
}

async function saveRemoteVideo(url, _providerFetchImpl, materializationKey = '') {
  const result = await saveRemoteVideoDetailed(url, _providerFetchImpl, materializationKey);
  return result.url || null;
}

async function saveRemoteVideoDetailed(url, _providerFetchImpl, materializationKey = '', signal) {
  const cacheKey = String(materializationKey || '').trim();
  if (cacheKey) {
    const cached = videoMaterializationCache.get(cacheKey);
    if (cached && materializedOutputExists(cached)) {
      setBoundedRegistryEntry(
        videoMaterializationCache,
        cacheKey,
        cached,
        VIDEO_MATERIALIZATION_MAX_ENTRIES,
      );
      return { url: cached, error: null };
    }
    if (cached) videoMaterializationCache.delete(cacheKey);
    const pending = videoMaterializationInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const materialize = (async () => {
    let lastError = null;
    const deadlineAt = remoteOutputDeadlineAt();
    const retryDelays = remoteOutputRetryDelays();
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      const delay = retryDelays[attempt];
      if (delay > 0) {
        if (Date.now() + delay >= deadlineAt) {
          lastError = Object.assign(new Error('视频结果下载超过本轮恢复时间'), { code: 'fetch_timeout' });
          break;
        }
        await proxyAbortableDelay(delay, signal);
      }
      try {
        const transferWindow = remoteOutputTransferWindow(deadlineAt, '视频结果');
        const remote = await fetchProxyRemoteMedia(url, {
          allowedKinds: ['video'],
          trustedProviderOutput: true,
          maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
          ...transferWindow,
          accept: 'video/mp4,video/webm,video/quicktime,video/x-matroska;q=0.9',
          signal,
        });
        throwIfProxyRequestAborted(signal);
        const buf = remote.buffer;
        const ext = verifiedProxyMediaExtension(remote);
        const localUrl = storeMaterializedOutputBuffer(buf, 'vid', ext, cacheKey);
        if (cacheKey) {
          setBoundedRegistryEntry(
            videoMaterializationCache,
            cacheKey,
            localUrl,
            VIDEO_MATERIALIZATION_MAX_ENTRIES,
          );
        }
        return { url: localUrl, error: null };
      } catch (error) {
        lastError = error;
        if (!retryableRemoteOutputError(error)) break;
      }
    }
    proxyRouteError('转存视频失败', lastError);
    return { url: '', error: remoteOutputDownloadFailure(lastError, 'video') };
  })();

  if (!cacheKey) return materialize;
  videoMaterializationInFlight.set(cacheKey, materialize);
  try {
    return await materialize;
  } finally {
    if (videoMaterializationInFlight.get(cacheKey) === materialize) {
      videoMaterializationInFlight.delete(cacheKey);
    }
  }
}

// POST /api/proxy/video/fal/submit
router.post('/video/fal/submit', async (req, res) => {
  const settings = loadRawSettings();
  const {
    apiModel, prompt, images,
    // veo-fal
    aspect_ratio, duration, resolution, generate_audio, safety_tolerance, image_mode,
    // grok-fal
    gkDuration, gkRatio, gkMode, gkReferenceUrls,
    // sora-fal
    soraMode, soraRatio, soraDuration, soraResolution, soraDeleteVideo, soraBlockIp, soraCharacterIds,
  } = req.body || {};
  const rawApiModel = String(apiModel || '').trim();
  // 历史节点里可能保存过日期版 Sora2 选项；T8 现在只暴露稳定的 sora-2 FAL。
  const effectiveApiModel = /^sora-2(?:-\d{4}-\d{2}-\d{2})?$/.test(rawApiModel) ? 'sora-2' : rawApiModel;
  // FAL 全部固定使用通用贞贞 API Key，不参与 New API 分组令牌。
  if (!ensureDefaultZhenzhenKey(settings, res, '视频 FAL')) return;
  let apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;

  if (!rawApiModel) return res.status(400).json({ success: false, error: 'apiModel 必填' });
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt 不得为空' });

  const reg = VIDEO_FAL_REGISTRY[effectiveApiModel];
  if (!reg) return res.status(400).json({ success: false, error: `未知的 Video FAL 模型: ${rawApiModel}` });

  const refs = Array.isArray(images) ? images.filter(Boolean) : [];
  const trimmedRefs = refs.slice(0, reg.maxRefImages);

  let payload;
  let endpoint;
  try {
    if (reg.paramKind === 'veo-fal') {
      // ===== Veo3.1 FAL (主项目 runVeo3Fal line 3694) =====
      endpoint = reg.endpoint;
      payload = {
        prompt,
        aspect_ratio: String(aspect_ratio || '16:9'),
        duration: String(duration || '8s'),
        resolution: String(resolution || '720p'),
        generate_audio: generate_audio === true,
        safety_tolerance: parseInt(safety_tolerance ?? 4, 10) || 4,
      };
      // 参考图(最多 3 张)
      if (trimmedRefs.length) {
        const imgArr = [];
        const useBase64 = String(image_mode || 'image_url') === 'base64';
        for (let i = 0; i < trimmedRefs.length; i++) {
          if (useBase64) {
            // base64 直传
            const conv = await refToBananaImage(trimmedRefs[i]);
            if (conv) imgArr.push(conv);
          } else {
            const u = await uploadRefToZhenzhen(trimmedRefs[i], apiKey);
            if (u) imgArr.push(u);
            else throw new Error(`FAL 参考图 #${i + 1} 上传失败`);
          }
        }
        if (imgArr.length) payload.image_urls = imgArr;
      }
    } else if (reg.paramKind === 'grok-fal') {
      // ===== Grok Video FAL (主项目 runGrokFal line 3787) =====
      const isV15 = effectiveApiModel === 'grok-imagine-video-1.5';
      const mode = isV15
        ? 'image_to_video'
        : String(gkMode || 'image_to_video') === 'reference_to_video' ? 'reference_to_video' : 'image_to_video';
      const extraReferenceUrls = splitGrokReferenceUrls(gkReferenceUrls);
      const hasImg = trimmedRefs.length > 0;
      const effectiveRatio = (mode === 'reference_to_video' || !hasImg) && String(gkRatio || '16:9') === 'auto'
        ? '16:9'
        : String(gkRatio || '16:9');
      payload = {
        prompt,
        duration: parseInt(gkDuration ?? 6, 10) || 6,
        resolution: String(resolution || '720p'),
      };
      if (!isV15) payload.aspect_ratio = effectiveRatio;
      const useBase64 = String(image_mode || reg.defaultImageMode || 'base64') === 'base64';
      if (isV15) {
        endpoint = reg.endpoint;
        if (!hasImg) throw new Error('Grok Video 1.5 requires one uploaded image');
        const imgData = useBase64
          ? await refToBananaImage(trimmedRefs[0])
          : await uploadRefToZhenzhen(trimmedRefs[0], apiKey);
        if (imgData) payload.image_url = imgData;
        else throw new Error('Grok Video 1.5 参考图处理失败');
      } else if (mode === 'reference_to_video') {
        endpoint = reg.referenceEndpoint || reg.i2vEndpoint || reg.endpoint;
        const referenceImageUrls = [];
        const uploadRefs = trimmedRefs.slice(0, 7);
        for (let i = 0; i < uploadRefs.length && referenceImageUrls.length < 7; i++) {
          const imgData = useBase64
            ? await refToBananaImage(uploadRefs[i])
            : await uploadRefToZhenzhen(uploadRefs[i], apiKey);
          if (imgData) referenceImageUrls.push(imgData);
          else throw new Error(`Grok FAL 参考图 #${i + 1} 处理失败`);
        }
        for (const url of extraReferenceUrls) {
          if (referenceImageUrls.length >= 7) break;
          referenceImageUrls.push(url);
        }
        if (!referenceImageUrls.length) throw new Error('Grok FAL 参考生视频需要至少 1 张参考图或 URL');
        payload.reference_image_urls = referenceImageUrls;
      } else {
        endpoint = hasImg ? (reg.i2vEndpoint || reg.endpoint) : reg.endpoint;
        // 图生视频模式: 单张 image_url；无图时保留文生视频 fallback。
        if (hasImg) {
          const imgData = useBase64
            ? await refToBananaImage(trimmedRefs[0])
            : await uploadRefToZhenzhen(trimmedRefs[0], apiKey);
          if (imgData) payload.image_url = imgData;
          else throw new Error('Grok FAL 参考图处理失败');
        }
      }
    } else if (reg.paramKind === 'sora-fal') {
      // ===== Sora2 FAL (主项目 runSora2Fal line 5341) =====
      const hasImg = trimmedRefs.length > 0;
      let mode = String(soraMode || 'auto');
      if (!['auto', 'text_to_video', 'image_to_video'].includes(mode)) mode = 'auto';
      if (mode === 'auto') mode = hasImg ? 'image_to_video' : 'text_to_video';
      if (mode === 'image_to_video' && !hasImg) throw new Error('FAL Sora2 image-to-video requires one uploaded image');

      const ratio = String(soraRatio || aspect_ratio || '16:9');
      const reso = String(soraResolution || resolution || '720p');
      endpoint = mode === 'image_to_video' ? (reg.i2vEndpoint || reg.endpoint) : reg.endpoint;
      payload = {
        prompt,
        resolution: mode === 'text_to_video' && reso === 'auto' ? '720p' : reso,
        aspect_ratio: mode === 'text_to_video' && ratio === 'auto' ? '16:9' : ratio,
        duration: parseInt(soraDuration ?? duration ?? 4, 10) || 4,
        delete_video: soraDeleteVideo !== false,
        model: effectiveApiModel,
        detect_and_block_ip: soraBlockIp === true,
      };
      const ids = splitSoraCharacterIds(soraCharacterIds);
      if (ids.length) payload.character_ids = ids;
      if (mode === 'image_to_video') {
        const useBase64 = String(image_mode || 'base64') === 'base64';
        const imgData = useBase64
          ? await refToBananaImage(trimmedRefs[0])
          : await uploadRefToZhenzhen(trimmedRefs[0], apiKey);
        if (imgData) payload.image_url = imgData;
        else throw new Error('Sora2 FAL 参考图处理失败');
      }
    } else {
      return res.status(400).json({ success: false, error: `不支持的 Video FAL paramKind: ${reg.paramKind}` });
    }

    const falUrl = `${baseUrl}/fal/${endpoint}`;
    console.log('[video/fal/submit]', effectiveApiModel, '→', falUrl, '| payload keys:', Object.keys(payload), '| refs:', trimmedRefs.length);

    const resp = await fetchProviderResponse(falUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonResponse(resp, 'FAL video submit');
    if (!resp.ok) {
      return res.status(resp.status).json({
        success: false,
        error: `FAL HTTP ${resp.status}`,
      });
    }
    if (Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'FAL 参数校验错误' });
    }
    if (data?.detail && !data?.video && !data?.request_id) {
      return res.status(400).json({ success: false, error: 'FAL 请求被 Provider 拒绝' });
    }

    // 同步返回: result.video.url 或同类 video_url/url 字段
    const syncVideoUrl = getFalVideoUrl(data);
    if (syncVideoUrl) {
      const saved = await saveRemoteVideoDetailed(syncVideoUrl);
      if (!saved.url) {
        const failure = completedRemoteOutputError({
          itemCount: 1,
          failures: saved.error ? [saved.error] : [],
        }, 'video');
        return res.status(502).json({
          success: false,
          code: failure.code,
          error: `${failure.message} 此同步响应没有可继续查询的任务，网络恢复后请重新运行。`,
        });
      }
      return res.json({ success: true, data: { sync: true, videoUrl: saved.url, endpoint } });
    }

    // 异步: request_id + response_url
    const requestId = safeFalRequestId(data?.request_id);
    let responseUrl = data?.response_url || '';
    if (!requestId) {
      return res.status(502).json({ success: false, error: 'FAL 返回的 request_id 无效' });
    }
    responseUrl = fixFalResponseUrl(responseUrl, baseUrl, endpoint, requestId);
    if (!responseUrl) return res.status(502).json({ success: false, error: 'FAL 未返回可验证的轮询地址' });
    const registered = rememberFalTask('video-fal', requestId, apiKey, {
      model: effectiveApiModel,
      endpoint,
      responseUrl,
    });
    if (!registered) return res.status(502).json({ success: false, error: 'FAL 任务注册失败' });
    return res.json({
      success: true,
      data: { sync: false, requestId, endpoint },
    });
  } catch (e) {
    proxyRouteError('proxy/video/fal/submit 错误', e);
    return res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e) });
  }
});

// POST /api/proxy/video/fal/query
//   body: { endpoint, requestId }
//   完成标志: data.video.url (区别于图像的 data.images[])
router.post('/video/fal/query', async (req, res) => {
  const settings = loadRawSettings();
  const { responseUrl: rawUrl, endpoint, requestId } = req.body || {};
  const rememberedMeta = recallFalTask('video-fal', requestId);
  if (!rememberedMeta) return res.status(409).json({ success: false, error: 'FAL 视频任务注册已失效，请重新提交任务' });
  if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
  else return res.status(400).json({ success: false, error: '未找到 settings' });
  const apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;

  try {
    const target = resolveFalQueryTarget({
      route: 'video-fal',
      requestId,
      endpoint,
      suppliedUrl: rawUrl,
      rememberedMeta,
      baseUrl,
    });
    const responseUrl = target.responseUrl;
    const pr = await fetchFalPollJson(responseUrl, apiKey);
    const data = pr.data;
    // HTTP 非200: 主项目规范 - body 中 status=IN_QUEUE/IN_PROGRESS 视为继续等待
    if (!pr.ok) {
      if (data && (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS')) {
        return res.json({ success: true, data: { status: 'pending', falStatus: String(data.status) } });
      }
      return res.status(pr.status).json({
        success: false,
        error: `FAL Poll HTTP ${pr.status}`,
      });
    }
    if (!data) {
      return res.status(502).json({ success: false, error: 'FAL Poll 响应非 JSON' });
    }
    // 完成: video.url 或同类 video_url/url 字段
    const finishedVideoUrl = getFalVideoUrl(data);
    if (finishedVideoUrl) {
      const saved = await saveRemoteVideoDetailed(finishedVideoUrl, null, `video-fal:${requestId}`);
      if (!saved.url) {
        const failure = completedRemoteOutputError({
          itemCount: 1,
          failures: saved.error ? [saved.error] : [],
        }, 'video');
        return sendCompletedRemoteOutputFailure(res, failure, {
          requestId,
          falStatus: String(data.status || ''),
        }, {
          defaultCode: 'fal_video_output_unusable',
          defaultMessage: 'FAL 视频结果无法保存。',
        });
      }
      return res.json({ success: true, data: { status: 'completed', videoUrl: saved.url } });
    }
    const st = String(data.status || '').toUpperCase();
    if (st === 'FAILED' || st === 'CANCELLED') {
      return res.json({
        success: false,
        data: { status: 'failed', error: `FAL ${st}` },
      });
    }
    // IN_QUEUE / IN_PROGRESS / 空 => pending
    return res.json({ success: true, data: { status: 'pending', falStatus: st || 'IN_QUEUE' } });
  } catch (e) {
    proxyRouteError('proxy/video/fal/query 错误', e);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId: requestId,
      status: 'MATERIALIZING',
    })) return;
    return res.status(Number(e?.status) || 400).json({ success: false, error: proxyPublicError(e, '查询失败') });
  }
});

// ========================================================================
// Fal 超市通用 FAL Queue 适配器
// 不替换现有 /image/fal/* 与 /video/fal/* 路由；这里只服务新的 Fal超市节点。
// ========================================================================

const FAL_TOOLBOX_PENDING = new Set(['IN_QUEUE', 'IN_PROGRESS', 'PENDING', 'RUNNING', 'QUEUED']);
const FAL_TOOLBOX_COMPLETED = new Set(['COMPLETED', 'COMPLETE', 'DONE', 'SUCCEEDED', 'SUCCESS']);
const FAL_TOOLBOX_FAILED = new Set(['FAILED', 'FAILURE', 'ERROR', 'CANCELLED', 'CANCELED']);

function isFalToolboxEndpoint(value) {
  const endpoint = String(value || '').trim();
  return !!endpoint && /^[a-z0-9._~:/-]+$/i.test(endpoint) && !endpoint.includes('..') && !/^https?:\/\//i.test(endpoint);
}

function falToolboxStatusValue(data) {
  if (!data || typeof data !== 'object') return '';
  const status = data.status ?? data.state ?? data.task_status ?? data.taskStatus;
  return String(status || '').trim().toUpperCase();
}

function falToolboxErrorMessage(data, fallback = 'FAL 任务失败') {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  const candidates = [
    data.failure_details,
    data.failure_reason,
    data.fail_reason,
    data.error,
    data.errors,
    data.detail,
    data.message,
    data.msg,
    data.data?.failure_details,
    data.data?.error,
    data.data?.detail,
    data.data?.message,
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '' || (Array.isArray(candidate) && !candidate.length)) continue;
    const msg = stringifyUpstreamErrorValue(candidate);
    if (msg) return msg;
  }
  try {
    return JSON.stringify(data).slice(0, 800);
  } catch {
    return fallback;
  }
}

function fixFalToolboxUrl(url, baseUrl, endpoint, requestId) {
  const value = String(url || '').trim();
  if (value) return trustedFalPollUrl(value, baseUrl);
  return constructedFalPollUrl(baseUrl, endpoint, requestId);
}

function getByPath(data, pathText) {
  if (!data || !pathText) return undefined;
  const parts = String(pathText).split('.').filter(Boolean);
  let cur = data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function collectFalToolboxUrls(value, out = []) {
  const pushUrl = (url) => {
    const text = String(url || '').trim();
    if (text && !out.includes(text)) out.push(text);
  };
  if (value == null) return out;
  if (typeof value === 'string') {
    if (/^(https?:\/\/|\/files\/|\/output\/|\/input\/)/i.test(value) || /^data:/i.test(value)) pushUrl(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFalToolboxUrls(item, out);
    return out;
  }
  if (typeof value === 'object') {
    if (typeof value.url === 'string') pushUrl(value.url);
    if (typeof value.file_url === 'string') pushUrl(value.file_url);
    if (typeof value.fileUrl === 'string') pushUrl(value.fileUrl);
    for (const child of Object.values(value)) collectFalToolboxUrls(child, out);
  }
  return out;
}

function collectFalToolboxText(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    if (!/^(https?:\/\/|\/files\/|data:)/i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFalToolboxText(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'content', 'caption', 'prompt']) {
      if (typeof value[key] === 'string') out.push(value[key]);
    }
  }
  return out;
}

async function saveRemoteFalToolboxFile(url, kind, materializationKey = '') {
  if (/^\/(files|output|input)\//i.test(String(url || ''))) {
    return { url: String(url), error: null };
  }
  if (kind === 'image') return saveRemoteImageDetailed(url, null, materializationKey);
  if (kind === 'video') return saveRemoteVideoDetailed(url, null, materializationKey);
  if (kind === 'audio') return saveRemoteAudioDetailed(url, materializationKey);
  try {
    const cleanUrl = String(url || '').split(/[?#]/)[0];
    const match = cleanUrl.match(/\.([a-z0-9]{2,8})$/i);
    const ext = safeOutputExt(match?.[1], kind === 'model3d' ? 'glb' : 'bin');
    if (kind !== 'model3d' || !new Set(['glb', 'gltf', 'obj', 'fbx', 'stl', 'usdz', 'zip']).has(ext)) {
      throw new Error('FAL 文件类型不在服务端允许列表');
    }
    const remote = await safeRemoteMediaFetch(url, {
      maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
      trustedProviderOutput: true,
      deadlineMs: PROXY_REMOTE_DEADLINE_MS,
      idleTimeoutMs: PROXY_REMOTE_IDLE_TIMEOUT_MS,
      maxRedirects: 4,
      accept: 'model/gltf-binary,model/gltf+json,application/octet-stream,application/zip;q=0.8',
      userAgent: 'T8-PenguinCanvas-ProviderProxy/1.0',
    });
    const buf = remote.buffer;
    if (!buf.length) throw new Error('FAL 模型文件为空');
    const contentType = normalizedContentType(remote.contentType);
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') throw new Error('FAL 模型响应类型无效');
    if (ext === 'glb' && buf.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error('FAL GLB 魔数无效');
    if ((ext === 'zip' || ext === 'usdz') && !buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new Error('FAL ZIP/USDZ 魔数无效');
    }
    if (ext === 'fbx' && !buf.subarray(0, 20).toString('ascii').startsWith('Kaydara FBX Binary')) throw new Error('FAL FBX 魔数无效');
    if (ext === 'gltf') {
      if (buf.length > FAL_GLTF_JSON_MAX_BYTES) throw new Error('FAL glTF JSON 超过安全大小限制');
      let parsed;
      try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) { throw new Error('FAL glTF JSON 无效'); }
      assertJsonComplexity(parsed, { maxJsonDepth: 64, maxJsonNodes: 200_000 });
      if (!parsed?.asset?.version) throw new Error('FAL glTF 结构无效');
    }
    const prefix = kind === 'model3d' ? 'model3d' : 'fal';
    return {
      url: storeMaterializedOutputBuffer(buf, prefix, ext, materializationKey),
      error: null,
    };
  } catch (e) {
    proxyRouteError('转存 FAL 文件失败', e);
    return { url: '', error: remoteOutputDownloadFailure(e, kind === 'model3d' ? 'model3d' : 'media') };
  }
}

async function extractFalToolboxOutputs(data, outputSchema, materializationScope = '') {
  const outputs = Array.isArray(outputSchema) ? outputSchema : [];
  const urls = [];
  const imageUrls = [];
  const videoUrls = [];
  const audioUrls = [];
  const modelUrls = [];
  const textOutputs = [];
  const jsonOutputs = [];
  const failures = [];
  const seenRemoteOutputs = new Set();
  let materializationIndex = 0;

  const normalizedOutputs = outputs.length ? outputs : [
    { key: 'images', kind: 'image', pathCandidates: ['images', 'data.images'] },
    { key: 'video', kind: 'video', pathCandidates: ['video', 'data.video', 'video_url', 'url'] },
    { key: 'audio', kind: 'audio', pathCandidates: ['audio', 'data.audio', 'audio_url'] },
    { key: 'model', kind: 'model3d', pathCandidates: ['model', 'mesh', 'file', 'files'] },
  ];

  for (const output of normalizedOutputs) {
    const kind = String(output?.kind || 'json');
    const candidates = Array.isArray(output?.pathCandidates) && output.pathCandidates.length
      ? output.pathCandidates
      : [output?.key].filter(Boolean);
    for (const candidate of candidates) {
      const value = getByPath(data, candidate);
      if (value == null) continue;
      if (kind === 'text') {
        textOutputs.push(...collectFalToolboxText(value));
        continue;
      }
      if (kind === 'json') {
        jsonOutputs.push(value);
        continue;
      }
      const found = collectFalToolboxUrls(value, []);
      for (const remote of found) {
        const remoteIdentity = `${kind}\u0000${remote}`;
        if (seenRemoteOutputs.has(remoteIdentity)) continue;
        seenRemoteOutputs.add(remoteIdentity);
        const materializationKey = materializationScope
          ? `${materializationScope}:${kind}:${materializationIndex}`
          : '';
        materializationIndex += 1;
        const saved = await saveRemoteFalToolboxFile(remote, kind, materializationKey);
        if (!saved.url) {
          if (saved.error) failures.push(saved.error);
          continue;
        }
        urls.push(saved.url);
        if (kind === 'image') imageUrls.push(saved.url);
        else if (kind === 'video') videoUrls.push(saved.url);
        else if (kind === 'audio') audioUrls.push(saved.url);
        else if (kind === 'model3d') modelUrls.push(saved.url);
      }
    }
  }

  return {
    urls: Array.from(new Set(urls)),
    imageUrls: Array.from(new Set(imageUrls)),
    videoUrls: Array.from(new Set(videoUrls)),
    audioUrls: Array.from(new Set(audioUrls)),
    modelUrls: Array.from(new Set(modelUrls)),
    textOutputs: Array.from(new Set(textOutputs.filter(Boolean))),
    jsonOutputs,
    failures,
  };
}

function falToolboxHasOutput(result) {
  return Boolean(result.urls.length || result.textOutputs.length || result.jsonOutputs.length);
}

const FAL_TOOLBOX_OUTPUT_TEMPLATES = Object.freeze({
  image: Object.freeze({ key: 'images', kind: 'image', pathCandidates: ['images', 'data.images', 'image', 'data.image', 'image.url', 'url'] }),
  video: Object.freeze({ key: 'video', kind: 'video', pathCandidates: ['video', 'data.video', 'video.url', 'data.video.url', 'video_url', 'url'] }),
  audio: Object.freeze({ key: 'audio', kind: 'audio', pathCandidates: ['audio', 'audios', 'data.audio', 'data.audios', 'audio.url', 'data.audio.url', 'audio_url', 'url'] }),
  text: Object.freeze({ key: 'output', kind: 'text', pathCandidates: ['output', 'data.output', 'text', 'data.text', 'transcript', 'data.transcript'] }),
  model3d: Object.freeze({ key: 'model', kind: 'model3d', pathCandidates: ['model_mesh', 'model_meshes', 'model_glb', 'model_urls', 'model', 'mesh', 'file', 'files', 'url'] }),
});

function falTool(endpoint, fields = [], outputKinds = [], statusPath = '') {
  return Object.freeze({
    endpoint,
    mediaFields: Object.freeze(fields.map(([key, kind, multiple, upload, mediaMode]) => Object.freeze({ key, kind, multiple, upload, mediaMode }))),
    outputSchema: Object.freeze(outputKinds.map((kind) => FAL_TOOLBOX_OUTPUT_TEMPLATES[kind]).filter(Boolean)),
    statusPath,
  });
}

// Security authority copied from the shipped Fal toolbox manifest. The client
// may choose a toolId and payload values, but cannot choose its Provider route,
// media handling, output extraction schema, or polling mode.
const FAL_TOOLBOX_AUTHORITY = Object.freeze({
  'gpt-image-2-fal': falTool('openai/gpt-image-2', [], ['image']),
  'gpt-image-2-fal-edit': falTool('openai/gpt-image-2/edit', [['image_urls', 'image', true, true, 'base64']], ['image']),
  'zhenzhen-luma-uni-1-v1-fal': falTool('luma/agent/uni-1/v1/text-to-image', [['reference_image_urls', 'image', true, true, 'base64']], ['image']),
  'zhenzhen-luma-uni-1-v1-max-fal': falTool('luma/agent/uni-1/v1/max', [['reference_image_urls', 'image', true, true, 'base64']], ['image']),
  'zhenzhen-bernini-r-edit-image-fal': falTool('fal-ai/bernini-r/edit-image', [['image_url', 'image', false, true, 'base64']], ['image']),
  'zhenzhen-luma-uni-1-v1-edit-fal': falTool('luma/agent/uni-1/v1/edit', [['image_url', 'image', false, true, 'base64'], ['reference_image_urls', 'image', true, true, 'base64']], ['image']),
  'zhenzhen-luma-uni-1-v1-edit-max-fal': falTool('luma/agent/uni-1/v1/max/edit', [['image_url', 'image', false, true, 'base64'], ['reference_image_urls', 'image', true, true, 'base64']], ['image']),
  'zhenzhen-bria-genfill-v2-fal': falTool('bria/genfill/v2', [['image_url', 'image', false, true, 'base64'], ['mask_url', 'image', false, true, 'base64']], ['image']),
  'ideogram-v4-fal': falTool('ideogram/v4', [], ['image']),
  'mai-image-2-5-fal': falTool('microsoft/mai-image-2.5', [], ['image']),
  'cosmos-3-super-text-image-fal': falTool('nvidia/cosmos-3-super/text-to-image', [], ['image']),
  'recraft-v4-1-fal': falTool('fal-ai/recraft/v4.1/text-to-image', [], ['image']),
  'krea-v2-medium-fal': falTool('krea/v2/medium/text-to-image', [], ['image']),
  'krea-v2-medium-turbo-fal': falTool('krea/v2/medium/turbo/text-to-image', [], ['image']),
  'krea-v2-large-fal': falTool('krea/v2/large/text-to-image', [], ['image']),
  'nano-banana-2-fal': falTool('fal-ai/nano-banana/edit', [['image_urls', 'image', true, true, 'url']], ['image']),
  'nano-banana-pro-fal': falTool('fal-ai/nano-banana-pro/edit', [['image_urls', 'image', true, true, 'url']], ['image']),
  'seedream-v5-lite-edit-fal': falTool('fal-ai/bytedance/seedream/v5/lite/edit', [['image_urls', 'image', true, true, 'url']], ['image']),
  'mai-image-2-5-edit-fal': falTool('microsoft/mai-image-2.5/edit', [['image_urls', 'image', true, true, 'base64']], ['image']),
  'flux-pro-vto-fal': falTool('fal-ai/flux-pro/v1/vto', [['human_image_url', 'image', false, true, 'base64'], ['garment_image_url', 'image', false, true, 'base64']], ['image']),
  'bria-fibo-edit-fal': falTool('bria/fibo-edit/edit', [['image_url', 'image', false, true, 'base64'], ['mask_url', 'image', false, true, 'base64']], ['image']),
  'topaz-image-upscale-fal': falTool('fal-ai/topaz/upscale/image', [['image_url', 'image', false, true, 'base64']], ['image']),
  'zhenzhen-bernini-r-video-fal': falTool('fal-ai/bernini-r/reference-to-video', [['reference_image_urls', 'image', true, true, 'base64']], ['video']),
  'zhenzhen-bernini-r-edit-video-fal': falTool('fal-ai/bernini-r/edit-video', [['video_url', 'video', false, true, 'url']], ['video']),
  'zhenzhen-bernini-r-reference-edit-video-fal': falTool('fal-ai/bernini-r/reference-edit-video', [['video_url', 'video', false, true, 'url'], ['reference_image_urls', 'image', true, true, 'base64']], ['video']),
  'zhenzhen-luma-ray-v3.2-fal': falTool('luma/agent/ray/v3.2/text-to-video', [['reference_image_urls', 'image', true, true, 'base64']], ['video']),
  'zhenzhen-luma-ray-v3.2-image-to-video-fal': falTool('luma/agent/ray/v3.2/image-to-video', [['image_url', 'image', false, true, 'base64'], ['end_image_url', 'image', false, true, 'base64'], ['reference_image_urls', 'image', true, true, 'base64']], ['video']),
  'zhenzhen-luma-ray-v3.2-video-to-video-fal': falTool('luma/agent/ray/v3.2/video-to-video', [['video_url', 'video', false, true, 'url'], ['start_image_url', 'image', false, true, 'base64']], ['video']),
  'zhenzhen-bria-video-background-removal-v3-fal': falTool('bria/video/background-removal/v3', [['video_url', 'video', false, true, 'url']], ['video']),
  'zhenzhen-pixelcut-video-background-removal-fal': falTool('pixelcut/video-background-removal', [['video_url', 'video', false, true, 'url']], ['video']),
  'veo3-1-fal': falTool('fal-ai/veo3.1/fast/reference-to-video', [['image_urls', 'image', true, true, 'url']], ['video']),
  'seedance2-fal': falTool('bytedance/seedance-2.0/reference-to-video', [['image_urls', 'image', true, true, 'url'], ['video_urls', 'video', true, true, 'url'], ['audio_urls', 'audio', true, true, 'url']], ['video']),
  'cosmos-3-super-image-video-fal': falTool('nvidia/cosmos-3-super/image-to-video', [['image_url', 'image', false, true, 'base64']], ['video']),
  'grok-video-text-fal': falTool('xai/grok-imagine-video/text-to-video', [], ['video']),
  'grok-video-fal': falTool('xai/grok-imagine-video/image-to-video', [['image_url', 'image', false, true, 'base64']], ['video']),
  'grok-video-reference-fal': falTool('xai/grok-imagine-video/reference-to-video', [['image_urls', 'image', true, true, 'base64']], ['video']),
  'grok-video-1-5-fal': falTool('xai/grok-imagine-video/v1.5/image-to-video', [['image_url', 'image', false, true, 'base64']], ['video']),
  'grok-video-edit-fal': falTool('xai/grok-imagine-video/edit-video', [['video_url', 'video', false, true, 'url']], ['video']),
  'grok-video-extend-fal': falTool('xai/grok-imagine-video/extend-video', [['video_url', 'video', false, true, 'url']], ['video']),
  'pixverse-v6-fal': falTool('fal-ai/pixverse/v6/image-to-video', [['image_url', 'image', false, true, 'base64']], ['video']),
  'heygen-avatar4-i2v-fal': falTool('fal-ai/heygen/avatar4/image-to-video', [['image_url', 'image', false, true, 'base64'], ['audio_url', 'audio', false, true, 'url']], ['video']),
  'creatify-aurora-fal': falTool('fal-ai/creatify/aurora', [['image_url', 'image', false, true, 'base64'], ['audio_url', 'audio', false, true, 'url']], ['video']),
  'veed-fabric-1-0-fal': falTool('veed/fabric-1.0', [['image_url', 'image', false, true, 'base64'], ['audio_url', 'audio', false, true, 'url']], ['video']),
  'topaz-video-upscale-fal': falTool('fal-ai/topaz/upscale/video', [['video_url', 'video', false, true, 'url']], ['video']),
  'sora2-fal-text': falTool('fal-ai/sora-2/text-to-video', [], ['video']),
  'sora2-fal-image': falTool('fal-ai/sora-2/image-to-video', [['image_url', 'image', false, true, 'base64']], ['video']),
  'zhenzhen-nemotron-asr-multilingual-fal': falTool('nvidia/nemotron-asr-multilingual/asr', [['audio_url', 'audio', false, true, 'url']], ['text']),
  'sonilo-video-to-music-fal': falTool('sonilo/v1.1/video-to-music', [['video_url', 'video', false, true, 'url']], ['audio']),
  'seed-speech-tts-v2-fal': falTool('fal-ai/bytedance/seed-speech/tts/v2', [], ['audio']),
  'minimax-speech-2-8-turbo-fal': falTool('fal-ai/minimax/speech-2.8-turbo', [], ['audio']),
  'minimax-speech-2-8-hd-fal': falTool('fal-ai/minimax/speech-2.8-hd', [], ['audio']),
  'lyria2-fal': falTool('fal-ai/lyria2', [], ['audio']),
  'heygen-avatar5-fal': falTool('fal-ai/heygen/avatar5/digital-twin', [['audio_url', 'audio', false, true, 'url']], ['video']),
  'hyper3d-rodin-v2-5-text-fal': falTool('fal-ai/hyper3d/rodin/v2.5/text-to-3d', [], ['model3d']),
  'hyper3d-rodin-v2-5-image-fal': falTool('fal-ai/hyper3d/rodin/v2.5', [['image_urls', 'image', true, true, 'base64']], ['model3d']),
  'hunyuan-3d-v3-1-pro-text-fal': falTool('fal-ai/hunyuan-3d/v3.1/pro/text-to-3d', [], ['model3d']),
  'hunyuan-3d-v3-1-pro-image-fal': falTool('fal-ai/hunyuan-3d/v3.1/pro/image-to-3d', [['input_image_url', 'image', false, true, 'base64'], ['back_image_url', 'image', false, true, 'base64'], ['left_image_url', 'image', false, true, 'base64'], ['right_image_url', 'image', false, true, 'base64']], ['model3d']),
  'trellis-2-fal': falTool('fal-ai/trellis-2', [['image_urls', 'image', true, true, 'base64']], ['model3d']),
});

function falPayloadContainsUnboundMedia(value) {
  if (typeof value === 'string') return /^(https?:\/\/|data:|\/(?:files|output|input|api\/resources)\/)/i.test(value.trim());
  if (Array.isArray(value)) return value.some(falPayloadContainsUnboundMedia);
  if (value && typeof value === 'object') return Object.values(value).some(falPayloadContainsUnboundMedia);
  return false;
}

function assertFalToolboxPayloadAuthority(payload, mediaFields) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('FAL payload 必须是对象');
  const mediaKeys = new Set((mediaFields || []).map((field) => field.key));
  for (const [key, value] of Object.entries(payload)) {
    if (!mediaKeys.has(key) && falPayloadContainsUnboundMedia(value)) {
      throw new Error(`FAL payload 字段 ${key} 含未注册媒体引用`);
    }
  }
}

async function resolveFalToolboxMediaPayload(payload, mediaFields, apiKey) {
  const next = { ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) };
  const fields = Array.isArray(mediaFields) ? mediaFields : [];
  for (const field of fields) {
    const key = String(field?.key || '').trim();
    if (!key || !(key in next)) continue;
    const rawValues = Array.isArray(next[key]) ? next[key] : [next[key]];
    const resolved = [];
    for (const raw of rawValues) {
      const value = String(raw || '').trim();
      if (!value) continue;
      if (field?.upload === false) {
        resolved.push(value);
      } else if (field?.kind === 'image' && field?.mediaMode === 'base64') {
        const dataUrl = await refToBananaImage(value);
        if (!dataUrl) throw new Error(`FAL 图片读取失败 (${opaqueDiagnosticSummary('ref', value)})`);
        resolved.push(dataUrl);
      } else {
        const url = await uploadRefToZhenzhen(value, apiKey);
        if (!url) throw new Error(`FAL 素材上传失败 (${opaqueDiagnosticSummary('ref', value)})`);
        resolved.push(url);
      }
    }
    if (field?.multiple === false || !Array.isArray(next[key])) next[key] = resolved[0] || '';
    else next[key] = resolved;
  }
  return next;
}

router.post('/fal-toolbox/submit', async (req, res) => {
  const settings = loadRawSettings();
  if (!ensureDefaultZhenzhenKey(settings, res, 'Fal超市')) return;
  const apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;
  const {
    toolId,
    endpoint: requestedEndpoint,
    payload,
  } = req.body || {};
  const toolAuthority = FAL_TOOLBOX_AUTHORITY[String(toolId || '').trim()];
  if (!toolAuthority) return res.status(400).json({ success: false, error: 'Fal超市 toolId 未在服务端注册' });
  if (requestedEndpoint && String(requestedEndpoint).trim() !== toolAuthority.endpoint) {
    return res.status(400).json({ success: false, error: 'Fal超市 endpoint 与服务端工具注册不一致' });
  }
  const { endpoint, mediaFields, outputSchema, statusPath } = toolAuthority;
  try {
    assertFalToolboxPayloadAuthority(payload, mediaFields);
    const finalPayload = await resolveFalToolboxMediaPayload(payload, mediaFields, apiKey);
    const falUrl = `${baseUrl}/fal/${endpoint}`;
    console.log('[fal-toolbox/submit]', toolId, '→', falUrl, '| payload keys:', Object.keys(finalPayload));
    const upstream = await fetchProviderResponse(falUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload),
    });
    const data = await parseJsonResponse(upstream, 'FAL toolbox submit');
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false,
        error: `FAL HTTP ${upstream.status}`,
      });
    }
    if (Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'FAL 参数校验错误' });
    }
    const st = falToolboxStatusValue(data);
    if (FAL_TOOLBOX_FAILED.has(st)) {
      return res.json({ success: false, data: { status: 'failed', error: `FAL ${st}` } });
    }

    const output = await extractFalToolboxOutputs(data, outputSchema);
    if (output.failures.length > 0) {
      const failure = completedRemoteOutputError({
        itemCount: output.urls.length + output.failures.length,
        failures: output.failures,
      }, 'media');
      return res.status(502).json({
        success: false,
        code: failure.code,
        error: `${failure.message} 此同步响应没有可继续查询的任务，网络恢复后请重新运行。`,
      });
    }
    if (['COMPLETED', 'COMPLETE', 'DONE', 'SUCCEEDED', 'SUCCESS'].includes(st)) {
      const failure = completedRemoteOutputError({ itemCount: 0 }, 'video');
      return sendCompletedRemoteOutputFailure(res, failure, { requestId, falStatus: st }, {
        defaultCode: 'fal_video_output_missing',
        defaultMessage: 'FAL 视频任务已完成，但没有返回视频地址。',
      });
    }
    if (falToolboxHasOutput(output)) {
      const { failures: _failures, ...safeOutput } = output;
      return res.json({ success: true, data: { sync: true, endpoint, ...safeOutput } });
    }

    const requestId = safeFalRequestId(data?.request_id || data?.requestId);
    if (!requestId) {
      return res.status(502).json({ success: false, error: 'FAL 返回的 request_id 无效' });
    }
    const responseUrl = fixFalToolboxUrl(data?.response_url || data?.responseUrl, baseUrl, endpoint, requestId);
    const rawStatusUrl = data?.status_url || data?.statusUrl || (statusPath === 'result-only' ? '' : `${responseUrl}/status`);
    const statusUrl = rawStatusUrl ? fixFalToolboxUrl(rawStatusUrl, baseUrl, endpoint, requestId) : '';
    const registered = rememberFalTask('fal-toolbox', requestId, apiKey, {
      toolId,
      endpoint,
      outputSchema,
      responseUrl,
      statusUrl,
      statusPath,
    });
    if (!registered) return res.status(502).json({ success: false, error: 'FAL 工具箱任务注册失败' });
    return res.json({
      success: true,
      data: { sync: false, requestId, endpoint },
    });
  } catch (e) {
    proxyRouteError('proxy/fal-toolbox/submit 错误', e);
    return res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e) });
  }
});

router.post('/fal-toolbox/query', async (req, res) => {
  const settings = loadRawSettings();
  const { requestId } = req.body || {};
  if (req.body?.responseUrl || req.body?.statusUrl) {
    return res.status(400).json({ success: false, error: 'FAL 轮询地址只能由服务端任务注册恢复' });
  }
  const rememberedMeta = recallFalTask('fal-toolbox', requestId);
  if (rememberedMeta?.apiKey) {
    if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
    else return res.status(400).json({ success: false, error: '未找到 settings' });
  } else {
    return res.status(409).json({ success: false, error: 'FAL 工具箱任务注册已失效，请重新提交任务' });
  }
  const apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;
  const endpoint = rememberedMeta.endpoint;
  const outputSchema = rememberedMeta.outputSchema;
  const statusPath = rememberedMeta.statusPath;
  let responseUrl;
  let statusUrl;
  try {
    responseUrl = trustedFalPollUrl(rememberedMeta.responseUrl, baseUrl)
      || constructedFalPollUrl(baseUrl, endpoint, requestId);
    statusUrl = rememberedMeta.statusUrl ? trustedFalPollUrl(rememberedMeta.statusUrl, baseUrl) : '';
  } catch (error) {
    proxyRouteError('proxy/fal-toolbox/query authority 错误', error);
    return res.status(400).json({ success: false, error: proxyPublicError(error, 'FAL 工具箱轮询地址无效') });
  }
  if (!responseUrl && !statusUrl) return res.status(409).json({ success: false, error: 'FAL 工具箱任务注册缺少轮询地址，请重新提交任务' });

  const fetchJson = async (url) => {
    const r = await fetchFalPollJson(url, apiKey);
    return { r, data: r.data };
  };

  try {
    let statusData = null;
    if (statusUrl) {
      const statusResp = await fetchJson(statusUrl);
      statusData = statusResp.data;
      if (!statusResp.r.ok) {
        const st = falToolboxStatusValue(statusData);
        if (FAL_TOOLBOX_PENDING.has(st)) {
          return res.json({ success: true, data: { status: 'pending', falStatus: st, requestId } });
        }
        return res.status(statusResp.r.status).json({
          success: false,
          data: { status: 'failed', error: `FAL Poll HTTP ${statusResp.r.status}` },
        });
      }
      const st = falToolboxStatusValue(statusData);
      if (FAL_TOOLBOX_FAILED.has(st)) {
        return res.json({ success: false, data: { status: 'failed', error: `FAL ${st}`, falStatus: st, requestId } });
      }
      const statusOutput = await extractFalToolboxOutputs(statusData, outputSchema, `fal-toolbox:${requestId}`);
      if (statusOutput.failures.length > 0) {
        const failure = completedRemoteOutputError({
          itemCount: statusOutput.urls.length + statusOutput.failures.length,
          failures: statusOutput.failures,
        }, 'media');
        const { failures: _failures, ...safeOutput } = statusOutput;
        return sendCompletedRemoteOutputFailure(res, failure, {
          requestId,
          falStatus: st,
          ...safeOutput,
        }, {
          defaultCode: 'fal_toolbox_output_unusable',
          defaultMessage: 'FAL 工具箱结果无法保存。',
        });
      }
      if (falToolboxHasOutput(statusOutput)) {
        const { failures: _failures, ...safeOutput } = statusOutput;
        return res.json({ success: true, data: { status: 'completed', requestId, ...safeOutput } });
      }
      if (st && !FAL_TOOLBOX_COMPLETED.has(st)) {
        return res.json({ success: true, data: { status: 'pending', falStatus: st, requestId } });
      }
    }

    const resultResp = await fetchJson(responseUrl || statusUrl);
    if (!resultResp.r.ok) {
      const st = falToolboxStatusValue(resultResp.data);
      if (FAL_TOOLBOX_PENDING.has(st)) {
        return res.json({ success: true, data: { status: 'pending', falStatus: st, requestId } });
      }
      return res.status(resultResp.r.status).json({
        success: false,
        data: { status: 'failed', error: `FAL Result HTTP ${resultResp.r.status}` },
      });
    }
    if (!resultResp.data) {
      return res.status(502).json({ success: false, data: { status: 'failed', error: 'FAL 响应非 JSON' } });
    }
    const resultStatus = falToolboxStatusValue(resultResp.data);
    if (FAL_TOOLBOX_FAILED.has(resultStatus)) {
      return res.json({ success: false, data: { status: 'failed', error: `FAL ${resultStatus}`, falStatus: resultStatus, requestId } });
    }
    const output = await extractFalToolboxOutputs(resultResp.data, outputSchema, `fal-toolbox:${requestId}`);
    if (output.failures.length > 0) {
      const failure = completedRemoteOutputError({
        itemCount: output.urls.length + output.failures.length,
        failures: output.failures,
      }, 'media');
      const { failures: _failures, ...safeOutput } = output;
      return sendCompletedRemoteOutputFailure(res, failure, {
        requestId,
        falStatus: resultStatus,
        ...safeOutput,
      }, {
        defaultCode: 'fal_toolbox_output_unusable',
        defaultMessage: 'FAL 工具箱结果无法保存。',
      });
    }
    if (falToolboxHasOutput(output)) {
      const { failures: _failures, ...safeOutput } = output;
      return res.json({ success: true, data: { status: 'completed', requestId, ...safeOutput } });
    }
    return res.json({ success: true, data: { status: 'pending', falStatus: resultStatus || falToolboxStatusValue(statusData) || 'IN_PROGRESS', requestId } });
  } catch (e) {
    proxyRouteError('proxy/fal-toolbox/query 错误', e);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId: requestId,
      status: 'MATERIALIZING',
    })) return;
    return res.status(proxyErrorStatus(e)).json({ success: false, data: { status: 'failed', error: proxyPublicError(e, '查询失败') } });
  }
});

router.post('/video/submit', async (req, res) => {
  const settings = loadRawSettings();
  const {
    model, prompt,
    // Veo 参数
    aspect_ratio, enhance_prompt, enable_upsample,
    // Grok 参数
    ratio, duration, resolution,
    // 通用
    seed, private: privateVideo, is_private, watermark, images, providerParams, size,
  } = req.body || {};
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
  if (!ensureKeyOrSelectedGroup(settings, res, model || '', '视频', providerParams)) return;
  if (!model || !prompt) {
    return res.status(400).json({ success: false, error: 'model 和 prompt 必填' });
  }
  const lowerModel = String(model).toLowerCase();
  const isVeoOmni = isVeoOmniModel(lowerModel);
  const isGrokVideo15New = isGrokVideo15NewModel(lowerModel);
  const isGrok = lowerModel.includes('grok');
  const isSoraZhenzhen = lowerModel === 'sora-2-zhenzhen';
  const isVeo = lowerModel.includes('veo');
  let body;
  let apiKey = String(settings?.zhenzhenApiKey || '');

  try {
    const providerContext = await applyZhenzhenProviderContext(settings, {
      route: 'video/submit',
      kind: 'video',
      model,
      hint: model || '',
      providerParams,
    });
    apiKey = String(settings.zhenzhenApiKey || '');
    if (isVeoOmni) {
      // ===== Veo Omni 协议(参考 Comfly_veo_omini): POST /v1/videos multipart =====
      const refs = Array.isArray(images) ? images.slice(0, 1) : [];
      if (!refs.length) {
        return res.status(400).json({ success: false, error: 'veo-omni-10s 需要 1 张参考图' });
      }
      const conv = await refToBuffer(refs[0]);
      if (!conv) {
        return res.status(400).json({ success: false, error: 'veo-omni-10s 参考图读取失败' });
      }
      const form = new FormData();
      const seconds = ['4', '5', '6', '8', '10'].includes(String(duration)) ? String(duration) : '10';
      const size = veoOmniSizeFromAspect(aspect_ratio || ratio || '16:9');
      form.append('model', VEO_OMNI_UPSTREAM_MODEL);
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('seconds', seconds);
      form.append('watermark', String(Boolean(watermark)).toLowerCase());
      form.append('input_reference', new Blob([conv.buf], { type: conv.mime }), `input_reference.${conv.ext || 'png'}`);

      const upstream = `${config.ZHENZHEN_BASE_URL}/v1/videos`;
      console.log('[upstream] Veo Omni → /v1/videos model:', VEO_OMNI_UPSTREAM_MODEL, 'size:', size, 'seconds:', seconds, 'refs:', refs.length);
      const r = await fetchProviderResponse(upstream, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!r.ok) {
        const providerError = await boundedProviderHttpError(r, 'Veo Omni submit failed');
        await invalidateZhenzhenProviderKey(
          providerContext,
          apiKey,
          Number(r.status) === 401 ? 'unauthorized' : providerError.message,
        );
        return res.status(r.status).json({ success: false, error: providerError.message });
      }
      const data = await parseJsonResponse(r, 'Veo Omni submit');
      const taskId = data?.task_id || data?.id;
      if (!taskId) return res.status(502).json({ success: false, error: 'Veo Omni 未返回 task_id' });
      rememberTaskKey(taskId, apiKey, { model: VEO_OMNI_PUBLIC_MODEL, authorityScope: 'zhenzhen-video', ...providerContext.taskMeta });
      return res.json({ success: true, data: { taskId } });
    } else if (isGrokVideo15New) {
      // ===== Grok Video 1.5 New 协议(参考 Comfly_grok_video_1_5): POST /v1/videos multipart =====
      const refs = Array.isArray(images) ? images.slice(0, 1) : [];
      if (!refs.length) {
        return res.status(400).json({ success: false, error: 'Grok 1.5 New 需要 1 张参考图' });
      }
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('size', grokVideo15NewSizeFromRatio(size || aspect_ratio || ratio || '16:9'));
      const hasReference = await appendGrokVideo15InputReference(form, refs[0]);
      if (!hasReference) {
        return res.status(400).json({ success: false, error: 'Grok 1.5 New 参考图读取失败' });
      }

      const upstream = `${config.ZHENZHEN_BASE_URL}/v1/videos`;
      console.log('[upstream] Grok Video 1.5 New → /v1/videos model:', model, 'size:', grokVideo15NewSizeFromRatio(size || aspect_ratio || ratio || '16:9'), 'refs:', refs.length);
      const r = await fetchProviderResponse(upstream, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!r.ok) {
        const providerError = await boundedProviderHttpError(r, 'Grok Video submit failed');
        await invalidateZhenzhenProviderKey(
          providerContext,
          apiKey,
          Number(r.status) === 401 ? 'unauthorized' : providerError.message,
        );
        return res.status(r.status).json({ success: false, error: providerError.message });
      }
      const data = await parseJsonResponse(r, 'Grok Video submit');
      const taskId = data?.task_id || data?.id;
      if (!taskId) return res.status(502).json({ success: false, error: 'Grok Video 未返回 task_id' });
      rememberTaskKey(taskId, apiKey, { model, authorityScope: 'zhenzhen-video', ...providerContext.taskMeta });
      return res.json({ success: true, data: { taskId } });
    } else if (isSoraZhenzhen) {
      // ===== Sora2 Zhenzhen API 协议(参考 gpt-image-2-web runSora2) =====
      body = {
        prompt,
        model: 'sora-2',
        aspect_ratio: aspect_ratio || ratio || '16:9',
        duration: String(duration ?? 15),
        private: privateVideo !== false && is_private !== false,
      };
      if (seed && seed > 0) body.seed = seed;
      if (Array.isArray(images) && images.length) {
        const refs = images.slice(0, 1).map(stripDataUrlPrefix).filter(Boolean);
        if (refs.length) body.images = refs;
      }
      console.log('[upstream] Sora2 Zhenzhen → /v2/videos/generations model:', body.model, 'aspect_ratio:', body.aspect_ratio, 'duration:', body.duration, 'private:', body.private, 'refs:', body.images?.length || 0);
    } else if (isGrok) {
      // ===== Grok Video 协议(主项目 runGrok3 line 3863) =====
      body = {
        prompt,
        model,
        ratio: ratio || '16:9',
        duration: parseInt(duration ?? 15, 10),
        resolution: resolution || '720P',
      };
      if (seed && seed > 0) body.seed = seed;
      if (Array.isArray(images) && images.length) {
        const refs = images.slice(0, 7); // Grok 最多 7 张
        const urls = [];
        for (let i = 0; i < refs.length; i++) {
          const u = await uploadRefToZhenzhen(refs[i], apiKey);
          if (u) urls.push(u);
          else throw new Error(`参考图 #${i + 1} 上传失败`);
        }
        if (urls.length) body.images = urls;
      }
      console.log('[upstream] Grok Video → /v2/videos/generations model:', model, 'ratio:', body.ratio, 'duration:', body.duration, 'resolution:', body.resolution, 'refs:', body.images?.length || 0);
    } else {
      // ===== Veo3.1 协议(主项目 runVeo3 line 3372)=====
      // 旧 seedance / 默认行为也走这里(零破坏)
      body = { prompt, model, enhance_prompt: enhance_prompt !== false };
      if (aspect_ratio) body.aspect_ratio = aspect_ratio;
      if (seed && seed > 0) body.seed = seed;
      if (enable_upsample) body.enable_upsample = true;
      if (Array.isArray(images) && images.length) body.images = images.slice(0, 3); // base64 dataURL
      console.log('[upstream] Veo/Default → /v2/videos/generations model:', model, 'aspect_ratio:', body.aspect_ratio, 'refs:', body.images?.length || 0, isVeo ? '(veo)' : '(legacy)');
    }

    const upstream = `${config.ZHENZHEN_BASE_URL}/v2/videos/generations`;
    const r = await fetchProviderResponse(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: req.t8AbortSignal,
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Video submit failed');
      await invalidateZhenzhenProviderKey(
        providerContext,
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Video submit');
    const taskId = data?.task_id || data?.id;
    if (!taskId) return res.status(502).json({ success: false, error: '视频 Provider 未返回 task_id' });
    rememberTaskKey(taskId, apiKey, { model, authorityScope: 'zhenzhen-video', ...providerContext.taskMeta });
    res.json({ success: true, data: { taskId } });
  } catch (e) {
    proxyRouteError('proxy/video/submit 错误', e, [apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

router.get('/video/query', async (req, res) => {
  const settings = loadRawSettings();
  const taskId = String(req.query.taskId || '').trim();
  const rememberedMeta = recallTaskMeta(taskId, 'zhenzhen-video');
  const queryModel = String(req.query.model || rememberedMeta?.model || '').trim();
  // 优先从 submit 阶段记录的 (taskId → key) 映射恢复，防止前端未传 model 导致 fallback 错 key。
  if (rememberedMeta?.apiKey) {
    if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
    else return res.status(400).json({ success: false, error: '未找到 settings' });
  } else {
    // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
    if (!ensureKey(settings, res, queryModel, '视频')) return;
  }
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId 必填' });
  const usesV1VideoQuery = isVeoOmniModel(queryModel) || isGrokVideo15NewModel(queryModel);
  const upstream = usesV1VideoQuery
    ? `${config.ZHENZHEN_BASE_URL}/v1/videos/${encodeURIComponent(taskId)}`
    : `${config.ZHENZHEN_BASE_URL}/v2/videos/generations/${encodeURIComponent(taskId)}`;
  const apiKey = String(settings.zhenzhenApiKey || '');
  try {
    const r = await fetchProviderResponse(upstream, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Video query failed');
      await invalidateZhenzhenProviderKey(
        { taskMeta: rememberedMeta || {} },
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Video query');
    const st = normalizeVideoTaskStatus(data?.status);
    let videoUrl = null;
    if (st === 'SUCCESS') {
      const remote = getFalVideoUrl(data);
      const materialized = await materializeRemoteTaskOutput({
        status: st,
        completedStatuses: ['success'],
        remoteUrl: remote,
        kind: 'video',
        materializationKey: `zhenzhen-video:${taskId}`,
      });
      if (materialized.failure) {
        return sendCompletedRemoteOutputFailure(res, materialized.failure, {
          taskId,
          failReason: null,
        }, {
          status: 'MATERIALIZING',
          defaultCode: 'video_output_unusable',
          defaultMessage: '视频结果无法保存。',
        });
      }
      videoUrl = materialized.url;
    }
    res.json({
      success: true,
      data: {
        status: st || 'PENDING',
        progress: data?.progress == null ? '' : safeDiagnosticText(data.progress, 64, [apiKey]),
        videoUrl,
        failReason: data?.fail_reason || data?.failure_details || data?.error || data?.message
          ? '视频任务失败'
          : null,
      },
    });
  } catch (e) {
    proxyRouteError('proxy/video/query 错误', e, [apiKey]);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId,
      status: 'MATERIALIZING',
    })) return;
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

// ========================================================================
// Seedance 2.0(异步)— 完全对齐 gpt-image-2-web runSeedance / pollSeedance
//   submit: POST ${ZHENZHEN_BASE_URL}/seedance/v3/contents/generations/tasks
//   query : GET  ${ZHENZHEN_BASE_URL}/seedance/v3/contents/generations/tasks/{tid}
// model includes: doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128 / doubao-seedance-2.0-mini
// resolution includes: 480p / 720p / native1080p / native4K / 1080p / 2k / 4k
// payload: { model, content[], duration, ratio, resolution, generate_audio,
//            return_last_frame, watermark, tools?[web_search], seed? }
// content 数组成员:
//   { type:'text', text }
//   { type:'image_url', image_url:{url}, role:'first_frame'|'last_frame'|'reference_image' }
//   { type:'video_url', video_url:{url}, role:'reference_video' }   // 需先 /v1/files 上传换 URL
//   { type:'audio_url', audio_url:{url}, role:'reference_audio' }   // 需先 /v1/files 上传换 URL
// ========================================================================
router.post('/seedance/submit', async (req, res) => {
  const settings = loadRawSettings();
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
  let apiKey = settings?.zhenzhenApiKey || '';
  const baseUrl = config.ZHENZHEN_BASE_URL;
  const {
    model, prompt,
    duration, ratio, resolution,
    generate_audio, return_last_frame, watermark, web_search,
    seed,
    firstFrame, lastFrame,
    refImages,
    videos, audios,
    taskProvider,
    providerParams,
  } = req.body || {};

  const requestedTaskProvider = taskProvider === 'auto'
    ? (settings?.zhenzhenSd2ApiKey ? seedanceNz.PROVIDER_ID : 'zhenzhen-legacy')
    : (taskProvider || 'zhenzhen-legacy');

  if (requestedTaskProvider === seedanceNz.PROVIDER_ID) {
    try {
      const result = await seedanceNz.submitTask(req.body || {}, settings?.zhenzhenSd2ApiKey || '', { signal: req.t8AbortSignal });
      rememberTaskKey(result.taskId, settings.zhenzhenSd2ApiKey, {
        provider: seedanceNz.PROVIDER_ID,
        model: result.model,
        taskType: result.taskType,
      });
      return res.json({
        success: true,
        data: {
          taskId: result.taskId,
          taskProvider: seedanceNz.PROVIDER_ID,
          model: result.model,
          taskType: result.taskType,
          ...seedanceNzTrace(result),
        },
      });
    } catch (e) {
      proxyRouteError('proxy/seedance/submit seedance.nz 错误', e, [settings?.zhenzhenSd2ApiKey || '']);
      const status = Number(e?.status);
      const code = /^SEEDANCE_[A-Z0-9_]+$/.test(String(e?.code || '')) ? String(e.code) : '';
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        error: proxyPublicError(e, 'seedance.nz 请求失败', [settings?.zhenzhenSd2ApiKey || '']),
        ...(code ? { code } : {}),
        ...seedanceNzTrace(e),
      });
    }
  }

  if (requestedTaskProvider !== 'zhenzhen-legacy') {
    return res.status(400).json({ success: false, error: `不支持的 Seedance provider：${requestedTaskProvider}` });
  }
  if (!ensureKeyOrSelectedGroup(settings, res, 'seedance', 'Seedance', providerParams)) return;

  if (!model) return res.status(400).json({ success: false, error: 'model 必填' });
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt 不得为空' });

  try {
    const providerContext = await applyZhenzhenProviderContext(settings, {
      route: 'seedance/submit',
      kind: 'seedance',
      model,
      hint: model || 'seedance',
      providerParams,
    });
    apiKey = settings.zhenzhenApiKey;
    const content = [{ type: 'text', text: String(prompt) }];

    const hasF = !!firstFrame;
    const hasL = !!lastFrame;

    // first_frame:
    //   - 单独 first_frame(无 last_frame): 不带 role
    //   - 与 last_frame 同时存在: role='first_frame'
    if (hasF) {
      const u = await uploadRefToZhenzhen(firstFrame, apiKey, 'first_frame');
      if (!u) throw new Error('first_frame 上传失败');
      const e = { type: 'image_url', image_url: { url: u } };
      if (hasL) e.role = 'first_frame';
      content.push(e);
    }

    // last_frame: 必须与 first_frame 同时
    if (hasL && hasF) {
      const u = await uploadRefToZhenzhen(lastFrame, apiKey, 'last_frame');
      if (!u) throw new Error('last_frame 上传失败');
      content.push({ type: 'image_url', image_url: { url: u }, role: 'last_frame' });
    }

    // reference_image
    if (Array.isArray(refImages)) {
      for (let i = 0; i < refImages.length; i++) {
        const u = await uploadRefToZhenzhen(refImages[i], apiKey, `reference_image ${i + 1}`);
        if (u) content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
      }
    }

    // reference_video / reference_audio:
    // gpt-image-2-web 的 runSeedance 会把本地视频/音频先上传到 /v1/files，再把返回 URL 放入 content。
    // T8 画布上游素材通常是 /files/input 或 /files/output，本地地址不能直接提交给 Seedance。
    if (Array.isArray(videos)) {
      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        if (typeof v === 'string' && v) {
          const u = await uploadRefToZhenzhen(v, apiKey, `reference_video ${i + 1}`);
          if (!u) throw new Error(`reference_video ${i + 1} 上传失败`);
          content.push({ type: 'video_url', video_url: { url: u }, role: 'reference_video' });
        }
      }
    }
    if (Array.isArray(audios)) {
      for (let i = 0; i < audios.length; i++) {
        const a = audios[i];
        if (typeof a === 'string' && a) {
          const u = await uploadRefToZhenzhen(a, apiKey, `reference_audio ${i + 1}`);
          if (!u) throw new Error(`reference_audio ${i + 1} 上传失败`);
          content.push({ type: 'audio_url', audio_url: { url: u }, role: 'reference_audio' });
        }
      }
    }

    const payload = {
      model,
      content,
      duration: parseInt(duration ?? 5, 10),
      ratio: ratio || '16:9',
      resolution: resolution || '720p',
      generate_audio: generate_audio !== false,
      return_last_frame: return_last_frame === true,
      watermark: watermark === true,
    };
    if (web_search === true) payload.tools = [{ type: 'web_search' }];
    if (typeof seed === 'number' && seed !== -1) payload.seed = seed;

    console.log('[upstream] Seedance2.0 → /seedance/v3/contents/generations/tasks model:', model,
      'duration:', payload.duration, 'ratio:', payload.ratio, 'resolution:', payload.resolution,
      'content_items:', content.length);

    const r = await fetchProviderResponse(`${baseUrl}/seedance/v3/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: req.t8AbortSignal,
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Seedance submit failed');
      await invalidateZhenzhenProviderKey(
        providerContext,
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Seedance submit');
    const taskId = data?.id || data?.task_id;
    if (!taskId) return res.status(502).json({ success: false, error: 'Seedance 未返回 task_id' });
    const taskType = content.some((item) => item?.type === 'video_url' || item?.type === 'audio_url') || content.filter((item) => item?.type === 'image_url').length > 1
      ? 'multi'
      : content.some((item) => item?.type === 'image_url') ? 'i2v' : 't2v';
    rememberTaskKey(taskId, apiKey, { provider: 'zhenzhen-legacy', model, taskType, ...providerContext.taskMeta });
    res.json({ success: true, data: { taskId, taskProvider: 'zhenzhen-legacy', model, taskType } });
  } catch (e) {
    proxyRouteError('proxy/seedance/submit 错误', e, [apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

router.get('/seedance/query', async (req, res) => {
  const settings = loadRawSettings();
  const taskId = String(req.query.taskId || '').trim();
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId 必填' });
  const providerHint = String(req.query.taskProvider || '').trim();
  let rememberedMeta = null;
  if (providerHint === seedanceNz.PROVIDER_ID || providerHint === 'zhenzhen-legacy') {
    rememberedMeta = recallTaskMeta(taskId, providerHint);
  } else if (!providerHint) {
    const nzMeta = recallTaskMeta(taskId, seedanceNz.PROVIDER_ID);
    const legacyMeta = recallTaskMeta(taskId, 'zhenzhen-legacy');
    if (nzMeta && legacyMeta) return res.status(409).json({ success: false, error: 'Seedance taskId 在多个 Provider 范围冲突，请重新提交任务' });
    rememberedMeta = nzMeta || legacyMeta;
  }
  const requestedTaskProvider = String(providerHint || rememberedMeta?.provider || 'zhenzhen-legacy').trim();

  if (requestedTaskProvider === seedanceNz.PROVIDER_ID) {
    const apiKey = rememberedMeta?.apiKey || settings?.zhenzhenSd2ApiKey || '';
    try {
      const result = await seedanceNz.queryTask(taskId, apiKey, { signal: req.t8AbortSignal });
      const materialized = await materializeRemoteTaskOutput({
        status: result.status,
        remoteUrl: result.videoUrl,
        kind: 'video',
        materializationKey: `${seedanceNz.PROVIDER_ID}:${taskId}`,
        providerFetchImpl: seedanceNz.fetchRemote,
        signal: req.t8AbortSignal,
      });
      const responseData = {
        status: result.status,
        progress: safeDiagnosticText(result.progress || '', 80, [apiKey]),
        videoUrl: materialized.url,
        failReason: result.status === 'failed'
          ? safeDiagnosticText(result.failReason || 'Seedance 任务失败', 240, [apiKey])
          : '',
        taskProvider: seedanceNz.PROVIDER_ID,
        model: rememberedMeta?.model || '',
        taskType: rememberedMeta?.taskType || '',
        ...seedanceNzTrace(result),
      };
      if (materialized.failure) {
        return sendCompletedRemoteOutputFailure(res, materialized.failure, responseData, {
          defaultCode: 'seedance_output_unusable',
          defaultMessage: 'Seedance 视频结果无法保存。',
        });
      }
      return res.json({
        success: true,
        data: responseData,
      });
    } catch (e) {
      proxyRouteError('proxy/seedance/query seedance.nz 错误', e, [apiKey]);
      if (sendTaskResultQueryRecovery(res, e, {
        taskId,
        status: 'MATERIALIZING',
        data: { taskProvider: seedanceNz.PROVIDER_ID },
      })) return;
      const status = Number(e?.status);
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        error: proxyPublicError(e, 'seedance.nz 查询失败', [apiKey]),
        ...seedanceNzTrace(e),
      });
    }
  }

  if (requestedTaskProvider !== 'zhenzhen-legacy') {
    return res.status(400).json({ success: false, error: `不支持的 Seedance provider：${requestedTaskProvider}` });
  }
  if (rememberedMeta?.apiKey) {
    if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
    else return res.status(400).json({ success: false, error: '未找到 settings' });
  } else {
    // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
    if (!ensureKey(settings, res, 'seedance', 'Seedance')) return;
  }

  const apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;
  const upstream = `${baseUrl}/seedance/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`;

  try {
    const r = await fetchProviderResponse(upstream, { headers: { Authorization: `Bearer ${apiKey}` }, signal: req.t8AbortSignal });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Seedance query failed');
      await invalidateZhenzhenProviderKey(
        { taskMeta: rememberedMeta || {} },
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Seedance query');
    // 状态归一(对齐主项目)
    let st = String(data?.status || '').toLowerCase();
    if (st === 'success') st = 'succeeded';
    if (st === 'fail' || st === 'failure') st = 'failed';

    let videoUrl = null;
    if (st === 'succeeded') {
      // 多重路径解析 video_url(对齐 pollSeedance line 3287-3296)
      let vUrl = null;
      const rc = data?.content;
      if (rc && typeof rc === 'object' && !Array.isArray(rc)) {
        vUrl = rc.video_url || rc.videoUrl;
      }
      if (!vUrl && data?.data && typeof data.data === 'object') {
        const dc = data.data.content;
        if (dc && typeof dc === 'object') vUrl = dc.video_url || dc.videoUrl;
        if (!vUrl) vUrl = data.data.video_url || data.data.videoUrl;
      }
      if (!vUrl && Array.isArray(data?.results)) {
        for (const it of data.results) {
          if (it && (it.outputType === 'mp4' || it.outputType === 'video' || (it.url && /\.mp4(\?|$)/i.test(it.url)))) {
            vUrl = it.url; break;
          }
          if (it && it.url && !vUrl) vUrl = it.url;
        }
      }
      if (!vUrl && Array.isArray(data?.content)) {
        for (const it of data.content) {
          if (it?.type === 'video_url') {
            const vu = it.video_url;
            vUrl = typeof vu === 'string' ? vu : (vu && vu.url);
            if (vUrl) break;
          }
        }
      }
      if (!vUrl) vUrl = data?.video_url || data?.videoUrl;

      const materialized = await materializeRemoteTaskOutput({
        status: st,
        remoteUrl: vUrl,
        kind: 'video',
        materializationKey: `zhenzhen-legacy:${taskId}`,
        signal: req.t8AbortSignal,
      });
      if (materialized.failure) {
        return sendCompletedRemoteOutputFailure(res, materialized.failure, {
          taskId,
          taskProvider: 'zhenzhen-legacy',
        }, {
          defaultCode: 'seedance_output_unusable',
          defaultMessage: 'Seedance 视频结果无法保存。',
        });
      }
      videoUrl = materialized.url;
    }

    return res.json({
      success: true,
      data: {
        status: st || 'pending',
        progress: data?.progress ? safeDiagnosticText(data.progress, 64, [apiKey]) : '',
        videoUrl,
        failReason: data?.fail_reason || data?.failReason ? 'Seedance 任务失败' : null,
        taskProvider: 'zhenzhen-legacy',
        model: rememberedMeta?.model || '',
        taskType: rememberedMeta?.taskType || '',
      },
    });
  } catch (e) {
    proxyRouteError('proxy/seedance/query 错误', e, [apiKey]);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId,
      status: 'MATERIALIZING',
      data: { taskProvider: 'zhenzhen-legacy' },
    })) return;
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '查询失败', [apiKey]) });
  }
});

// ========================================================================
// 音频生成(Suno - 异步)
// 协议(贞贞工坊):POST /suno/generate + GET /suno/feed/:clipIds + POST /suno/submit/music
// 模式:generate / cover / extend
// 严格对齐主项目 gpt-image-2-web 的 SUNO_MV_MAP (7 个版本)
// ========================================================================
const SUNO_MV_MAP = {
  'v3.0': 'chirp-v3.0',
  'v3.5': 'chirp-v3.5',
  'v4': 'chirp-v4',
  'v4.5': 'chirp-auk',
  'v4.5+': 'chirp-bluejay',
  'v5': 'chirp-crow',
  'v5.5': 'chirp-fenix',
};

// 兼容带 'suno-' 前缀的旧调用方 (如 'suno-v5.5')
function resolveSunoMv(version) {
  const v = String(version || 'v5.5').replace(/^suno-/i, '');
  return SUNO_MV_MAP[v] || 'chirp-fenix';
}

router.post('/audio/submit', async (req, res) => {
  const settings = loadRawSettings();
  // v1.2.9.15: 一体化「专属优先 fallback 通用」校验 —— 先 applyClassifiedKey('suno') 再校验 effective key
  const { mode, prompt, title, tags, version, seed, continue_clip_id, continue_at, cover_clip_id, providerParams } = req.body || {};
  if (!ensureKeyOrSelectedGroup(settings, res, 'suno', 'Suno', providerParams)) return;
  const m = mode || 'generate';
  if (!prompt && m !== 'extend') {
    return res.status(400).json({ success: false, error: 'prompt 必填' });
  }
  const mv = resolveSunoMv(version);
  let apiKey = String(settings?.zhenzhenApiKey || '');
  try {
    const providerContext = await applyZhenzhenProviderContext(settings, {
      route: 'audio/submit',
      kind: 'audio',
      model: `suno-${version || 'v5.5'}`,
      hint: 'suno',
      providerParams,
    });
    apiKey = String(settings.zhenzhenApiKey || '');
    const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (m === 'generate') {
      const body = { prompt: prompt || '', tags: tags || '', mv, title: title || '' };
      if (seed && seed > 0) body.seed = seed;
      const r = await fetchProviderResponse(`${config.ZHENZHEN_BASE_URL}/suno/generate`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      if (!r.ok) {
        const providerError = await boundedProviderHttpError(r, 'Suno generate failed');
        await invalidateZhenzhenProviderKey(
          providerContext,
          apiKey,
          Number(r.status) === 401 ? 'unauthorized' : providerError.message,
        );
        return res.status(r.status).json({ success: false, error: providerError.message });
      }
      const data = await parseJsonResponse(r, 'Suno generate');
      const taskId = data?.id;
      const clipIds = (data?.clips || []).map((c) => c.id).filter(Boolean);
      if (!taskId || clipIds.length < 1) return res.status(502).json({ success: false, error: 'Suno 未返回有效 task/clip' });
      rememberTaskKey(taskId, apiKey, { authorityScope: 'zhenzhen-audio', model: `suno-${version || 'v5.5'}`, ...providerContext.taskMeta });
      for (const clipId of clipIds) rememberTaskKey(clipId, apiKey, { authorityScope: 'zhenzhen-audio', model: `suno-${version || 'v5.5'}`, taskId, ...providerContext.taskMeta });
      return res.json({ success: true, data: { taskId, clipIds } });
    }
    if (m === 'extend') {
      if (!continue_clip_id) return res.status(400).json({ success: false, error: 'extend 模式需 continue_clip_id' });
      const body = { prompt: prompt || '', tags: tags || '', mv, title: title || '', task: 'upload_extend', continue_clip_id, continue_at: continue_at ?? 28 };
      if (seed && seed > 0) body.seed = seed;
      const r = await fetchProviderResponse(`${config.ZHENZHEN_BASE_URL}/suno/generate`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      if (!r.ok) {
        const providerError = await boundedProviderHttpError(r, 'Suno extend failed');
        await invalidateZhenzhenProviderKey(
          providerContext,
          apiKey,
          Number(r.status) === 401 ? 'unauthorized' : providerError.message,
        );
        return res.status(r.status).json({ success: false, error: providerError.message });
      }
      const data = await parseJsonResponse(r, 'Suno extend');
      const taskId = data?.id;
      const clipIds = (data?.clips || []).map((c) => c.id).filter(Boolean);
      if (!taskId) return res.status(502).json({ success: false, error: 'Suno 未返回有效 task' });
      rememberTaskKey(taskId, apiKey, { authorityScope: 'zhenzhen-audio', model: `suno-${version || 'v5.5'}`, ...providerContext.taskMeta });
      for (const clipId of clipIds) rememberTaskKey(clipId, apiKey, { authorityScope: 'zhenzhen-audio', model: `suno-${version || 'v5.5'}`, taskId, ...providerContext.taskMeta });
      return res.json({ success: true, data: { taskId, clipIds } });
    }
    if (m === 'cover') {
      if (!cover_clip_id) return res.status(400).json({ success: false, error: 'cover 模式需 cover_clip_id' });
      const body = {
        prompt: prompt || '', tags: tags || '', mv, title: title || '', task: 'cover',
        cover_clip_id, generation_type: 'TEXT', make_instrumental: false, negative_tags: '',
        continue_clip_id: null, continue_at: null, continued_aligned_prompt: null,
        infill_start_s: null, infill_end_s: null,
      };
      if (seed && seed > 0) body.seed = seed;
      const r = await fetchProviderResponse(`${config.ZHENZHEN_BASE_URL}/suno/submit/music`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
      if (!r.ok) {
        const providerError = await boundedProviderHttpError(r, 'Suno cover failed');
        await invalidateZhenzhenProviderKey(
          providerContext,
          apiKey,
          Number(r.status) === 401 ? 'unauthorized' : providerError.message,
        );
        return res.status(r.status).json({ success: false, error: providerError.message });
      }
      const data = await parseJsonResponse(r, 'Suno cover');
      const taskId = (typeof data?.data === 'string' ? data.data : data?.id) || '';
      const clipIds = Array.isArray(data?.data) ? data.data.map((c) => c.id || c.clip_id).filter(Boolean) : (data?.clips || []).map((c) => c.id);
      if (!taskId) return res.status(502).json({ success: false, error: 'Suno 未返回有效 task' });
      rememberTaskKey(taskId, apiKey, { authorityScope: 'zhenzhen-audio', model: `suno-${version || 'v5.5'}`, ...providerContext.taskMeta });
      for (const clipId of clipIds) rememberTaskKey(clipId, apiKey, { authorityScope: 'zhenzhen-audio', model: `suno-${version || 'v5.5'}`, taskId, ...providerContext.taskMeta });
      return res.json({ success: true, data: { taskId, clipIds } });
    }
    return res.status(400).json({ success: false, error: `未知模式: ${m}` });
  } catch (e) {
    proxyRouteError('proxy/audio/submit 错误', e, [apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

router.get('/audio/query', async (req, res) => {
  const settings = loadRawSettings();
  const ids = String(req.query.clipIds || req.query.taskId || '').trim();
  if (!ids) return res.status(400).json({ success: false, error: 'clipIds 或 taskId 必填' });
  const rememberedMeta = recallTaskMeta(ids.split(',')[0]?.trim() || ids, 'zhenzhen-audio');
  if (rememberedMeta?.apiKey) {
    if (settings) settings.zhenzhenApiKey = rememberedMeta.apiKey;
    else return res.status(400).json({ success: false, error: '未找到 settings' });
  } else {
    // v1.2.9.15: 一体化「专属优先 fallback 通用」校验
    if (!ensureKey(settings, res, 'suno', 'Suno')) return;
  }
  // 兼容旧客户端保留 saveLocal 查询参数，但完成品必须先转存到本地。
  // Provider 签名 URL 只能留在服务端瞬时使用，不能写入响应或画布状态。
  const apiKey = String(settings.zhenzhenApiKey || '');
  try {
    const r = await fetchProviderResponse(`${config.ZHENZHEN_BASE_URL}/suno/feed/${encodeURIComponent(ids)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const providerError = await boundedProviderHttpError(r, 'Suno query failed');
      await invalidateZhenzhenProviderKey(
        { taskMeta: rememberedMeta || {} },
        apiKey,
        Number(r.status) === 401 ? 'unauthorized' : providerError.message,
      );
      return res.status(r.status).json({ success: false, error: providerError.message });
    }
    const data = await parseJsonResponse(r, 'Suno query');
    const clips = Array.isArray(data) ? data : (data?.clips || []);
    const tracks = [];
    const materializationFailures = [];
    for (const [clipIndex, c] of clips.entries()) {
      if (c?.status === 'complete' && c?.audio_url) {
        const clipId = String(c.clip_id || c.id || '').trim();
        const materializationId = clipId || `${ids}:${clipIndex}`;
        const savedAudio = await saveRemoteAudioDetailed(c.audio_url, `suno:${materializationId}:audio`);
        if (!savedAudio.url) {
          if (savedAudio.error) materializationFailures.push(savedAudio.error);
          continue;
        }
        const coverSource = c.image_large_url || c.image_url || '';
        const localImageUrl = coverSource
          ? await saveRemoteImage(coverSource, null, `suno:${materializationId}:cover`)
          : '';
        tracks.push({
          id: c.id || c.clip_id,
          clipId: c.clip_id || c.id,
          audioUrl: savedAudio.url,
          imageUrl: localImageUrl || '',
          title: safeDiagnosticText(c.title || '', 240, [apiKey]),
          tags: safeDiagnosticText(c.tags || '', 500, [apiKey]),
          duration: c.metadata?.duration || 0,
        });
      }
    }
    if (materializationFailures.length > 0) {
      const failure = completedRemoteOutputError({
        itemCount: materializationFailures.length,
        failures: materializationFailures,
      }, 'audio');
      return sendCompletedRemoteOutputFailure(res, failure, {
        tracks,
        total: clips.length,
        completed: tracks.length,
      }, {
        status: 'MATERIALIZING',
        defaultCode: 'suno_output_unusable',
        defaultMessage: 'Suno 音频结果无法保存。',
      });
    }
    const completedClips = clips.filter((clip) => String(clip?.status || '').toLowerCase() === 'complete');
    if (clips.length > 0 && completedClips.length === clips.length && tracks.length === 0) {
      const failure = completedRemoteOutputError({ itemCount: 0 }, 'audio');
      return sendCompletedRemoteOutputFailure(res, failure, {
        tracks,
        total: clips.length,
        completed: 0,
      }, {
        status: 'FAILED',
        defaultCode: 'suno_output_missing',
        defaultMessage: 'Suno 任务已完成，但没有返回音频地址。',
      });
    }
    const allDone = clips.length > 0 && tracks.length === clips.length;
    res.json({
      success: true,
      data: {
        status: allDone ? 'SUCCESS' : 'PENDING',
        tracks,
        total: clips.length,
        completed: tracks.length,
      },
    });
  } catch (e) {
    proxyRouteError('proxy/audio/query 错误', e, [apiKey]);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId: ids,
      status: 'MATERIALIZING',
      data: { tracks: [], total: 0, completed: 0 },
    })) return;
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

// ========================================================================
// 音频上传 (Suno cover/extend 使用)
// 完全对齐主项目 gpt-image-2-web 的 _sunoUploadAudio 5 步流程:
// 1) POST /suno/uploads/audio { extension }  -> { id, url, fields? }
// 2) S3 上传: 有 fields 走 POST FormData / 无 fields 走 PUT 预签 URL
// 3) POST /suno/uploads/audio/{id}/upload-finish { upload_type, upload_filename }
// 4) GET /suno/uploads/audio/{id} 轮询 30 × 2s 直到 status='complete'
// 5) POST /suno/uploads/audio/{id}/initialize-clip {} -> { clip_id }
// ========================================================================
router.post('/audio/upload', audioUpload.single('file'), async (req, res) => {
  const settings = loadRawSettings();
  // v1.2.9.15: 修复 BUG —— 之前完全缺失 applyClassifiedKey('suno')，
  // 导致 Suno cover/extend 上传步骤即使配置了 sunoApiKey 也始终用通用 zhenzhenApiKey，
  // 与 audio/submit · audio/query 的 key 不一致。改用 ensureKey 统一「专属优先 fallback 通用」。
  if (!req.file) return res.status(400).json({ success: false, error: '未接收到音频文件 (field=file)' });
  const audioBuf = req.file.buffer;
  let verifiedAudio;
  try {
    verifiedAudio = validateProxyMediaBuffer(audioBuf, req.file.mimetype, {
      allowedKinds: ['audio'],
      maxBytes: 50 * 1024 * 1024,
      sourceName: req.file.originalname,
    });
  } catch (_) {
    return res.status(400).json({
      success: false,
      code: 'invalid_audio_upload',
      error: '上传文件不是受支持的音频内容，或声明类型与文件内容不一致',
    });
  }
  const ext = verifiedProxyMediaExtension({
    ...verifiedAudio,
    filename: req.file.originalname,
  });
  if (!ext || !new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma']).has(ext)) {
    return res.status(400).json({ success: false, code: 'invalid_audio_upload', error: '上传音频格式不受支持' });
  }
  const ct = verifiedAudio.contentType;
  const filename = safeAudioUploadFilename(req.file.originalname, ext);
  const providerParams = parseProviderParams(req.body?.providerParams);
  if (!ensureKeyOrSelectedGroup(settings, res, 'suno', 'Suno', providerParams)) return;
  let apiKey = settings.zhenzhenApiKey;
  const baseUrl = config.ZHENZHEN_BASE_URL;
  try {
    const providerContext = await applyZhenzhenProviderContext(settings, {
      route: 'audio/upload',
      kind: 'audio',
      model: 'suno-upload',
      hint: 'suno',
      providerParams,
    });
    apiKey = settings.zhenzhenApiKey;
    // 1) init
    const r1 = await fetchProviderResponse(`${baseUrl}/suno/uploads/audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ extension: ext }),
    });
    if (!r1.ok) {
      const providerError = await boundedProviderHttpError(r1, 'Upload init failed');
      await invalidateZhenzhenProviderKey(providerContext, apiKey, providerError.message);
      return res.status(r1.status).json({ success: false, error: providerError.message });
    }
    const r1Json = await parseJsonResponse(r1, 'Upload init');
    const upData = (r1Json.code && r1Json.data) ? r1Json.data : r1Json;
    const uploadId = upData.id;
    const uploadUrl = upData.url;
    const fields = upData.fields;
    if (!uploadId || !uploadUrl) return res.status(500).json({ success: false, error: 'Upload init 返回无效: missing id/url' });
    // 2) S3 upload
    const r2 = await uploadAudioToSignedUrl({
      uploadUrl,
      fields,
      audioBuffer: audioBuf,
      contentType: ct,
      filename,
    });
    if (r2.status !== 204 && r2.status !== 200 && !r2.ok) {
      return res.status(500).json({ success: false, error: `S3 upload failed: ${r2.status}` });
    }
    // 3) finish
    const r3 = await fetchProviderResponse(`${baseUrl}/suno/uploads/audio/${uploadId}/upload-finish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_type: 'file_upload', upload_filename: filename }),
    });
    if (!r3.ok) {
      const providerError = await boundedProviderHttpError(r3, 'Upload finish failed');
      await invalidateZhenzhenProviderKey(providerContext, apiKey, providerError.message);
      return res.status(502).json({ success: false, error: providerError.message });
    }
    await readBoundedProviderResponse(r3, 'Upload finish', { maxBytes: 64 * 1024 });
    // 4) poll status
    let clipId = '';
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const sr = await fetchProviderResponse(`${baseUrl}/suno/uploads/audio/${uploadId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!sr.ok) {
        await boundedProviderHttpError(sr, 'Upload status failed');
        continue;
      }
      const srJson = await parseJsonResponse(sr, 'Upload status');
      const sd = (srJson.code && srJson.data) ? srJson.data : srJson;
      const st = sd.status || sd.state || '';
      if (st === 'complete') {
        // 5) initialize-clip
        const r4 = await fetchProviderResponse(`${baseUrl}/suno/uploads/audio/${uploadId}/initialize-clip`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!r4.ok) {
          const providerError = await boundedProviderHttpError(r4, 'Initialize clip failed');
          await invalidateZhenzhenProviderKey(providerContext, apiKey, providerError.message);
          return res.status(502).json({ success: false, error: providerError.message });
        }
        const r4Json = await parseJsonResponse(r4, 'Initialize clip');
        const initData = (r4Json.code && r4Json.data) ? r4Json.data : r4Json;
        clipId = initData.clip_id || initData.id || '';
        break;
      } else if (st === 'failed' || st === 'error') {
        return res.status(502).json({ success: false, error: `音频处理失败（Provider 状态：${st}）` });
      }
    }
    if (!clipId) return res.status(504).json({ success: false, error: 'Upload timeout - no clip_id (60s)' });
    return res.json({ success: true, data: { clipId, uploadId, filename, size: req.file.size, mime: ct } });
  } catch (e) {
    proxyRouteError('proxy/audio/upload 错误', e, [apiKey]);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', [apiKey]) });
  }
});

// ========================================================================
// RunningHub 工作流(异步)
// 协议:POST /task/openapi/ai-app/run + POST /task/openapi/outputs
// 国内站使用 settings.rhApiKey，海外站使用 settings.rhIntlApiKey。
// RH 钱包应用仍只做 UI 区分，不再拥有独立钱包 Key。
// ========================================================================

function rhRequestedSite(value) {
  return normalizeRhSite(value);
}

function isRhTaskStateCode(code) {
  return ['0', '804', '813', '805'].includes(String(code));
}

function logRhSiteFallback(stage, from, to, detail = '') {
  const summary = detail ? opaqueDiagnosticSummary('reason', detail) : '';
  console.warn(`[RH/${stage}] ${from.id} -> ${to.id} 自动切换站点${summary ? ` · ${summary}` : ''}`);
}

function safeRhAppInfoValue(value, exactSecrets, depth = 0) {
  if (depth > 4 || value == null) return value == null ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    return redactExactSecrets(value, exactSecrets)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .slice(0, 4000);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeRhAppInfoValue(item, exactSecrets, depth + 1));
  if (typeof value !== 'object') return null;
  const output = {};
  for (const key of ['label', 'name', 'value']) {
    if (Object.hasOwn(value, key)) output[key] = safeRhAppInfoValue(value[key], exactSecrets, depth + 1);
  }
  return output;
}

function normalizeRhAppInfo(data, webappId, exactSecrets) {
  const allowedItemKeys = [
    'nodeId', 'fieldName', 'fieldValue', 'fieldType', 'fieldData',
    'options', 'list', 'values', 'enum', 'choices', 'items', 'selectOptions', 'dropdown',
    'required', 'min', 'max', 'step', 'description', 'name', 'label',
  ];
  const nodeInfoList = Array.isArray(data?.nodeInfoList)
    ? data.nodeInfoList.slice(0, 1000).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const normalized = {};
      for (const key of allowedItemKeys) {
        if (Object.hasOwn(item, key)) normalized[key] = safeRhAppInfoValue(item[key], exactSecrets);
      }
      return normalized;
    }).filter(Boolean)
    : [];
  return {
    webappId: String(webappId || '').trim().slice(0, 256),
    appName: redactExactSecrets(String(data?.appName || '').trim().slice(0, 240), exactSecrets),
    name: redactExactSecrets(String(data?.name || '').trim().slice(0, 240), exactSecrets),
    nodeInfoList,
  };
}

router.post('/runninghub/submit', async (req, res) => {
  const settings = loadRawSettings();
  const { webappId, nodeInfoList, instanceType } = req.body || {};
  const requestedSite = rhRequestedSite(req.body?.site);
  const candidates = buildRhSiteCandidates(settings, requestedSite);
  if (candidates.length === 0) return res.status(400).json({ success: false, error: missingRhKeyError(requestedSite) });
  if (!webappId) return res.status(400).json({ success: false, error: 'webappId 必填' });
  try {
    let lastResponse = null;
    let lastData = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const body = { apiKey: candidate.apiKey, webappId, nodeInfoList: nodeInfoList || [] };
      if (instanceType) body.instanceType = instanceType;
      const r = await fetchProviderResponse(`${candidate.baseUrl}/task/openapi/ai-app/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
        body: JSON.stringify(body),
        signal: req.t8AbortSignal,
      });
      const data = await parseJsonResponse(r, `RH ${candidate.label}提交接口`);
      lastResponse = r;
      lastData = data;
      if (String(data?.code) === '0' && data?.data?.taskId) {
        const taskId = data.data.taskId;
        rememberTaskKey(taskId, candidate.apiKey, {
          provider: 'runninghub',
          webappId,
          instanceType: instanceType || '',
          rhSite: candidate.id,
        });
        console.log(`[RH/submit] site=${candidate.id} webappId=${webappId} fields=${Array.isArray(nodeInfoList) ? nodeInfoList.length : 0} instance=${instanceType || 'default'} taskId=${taskId}`);
        return res.json({
          success: true,
          data: { taskId, site: candidate.id, fallbackUsed: candidate.id !== requestedSite },
        });
      }
      const next = candidates[index + 1];
      if (!next || !shouldRetryRhSiteResponse(r, data)) break;
      logRhSiteFallback('submit', candidate, next, data?.msg || `HTTP ${r.status}`);
    }
    console.warn(`[RH/submit] failed webappId=${webappId} code=${lastData?.code} ${opaqueDiagnosticSummary('response', JSON.stringify(lastData || {}))}`);
    return res.status(lastResponse?.status === 401 || lastResponse?.status === 403 ? lastResponse.status : 400).json({
      success: false,
      error: `RH 提交失败 code=${lastData?.code}`,
    });
  } catch (e) {
    proxyRouteError('proxy/rh/submit 错误', e);
    res.status(502).json({ success: false, error: 'RunningHub 提交请求失败' });
  }
});

router.get('/runninghub/query', async (req, res) => {
  const settings = loadRawSettings();
  const taskId = String(req.query.taskId || '').trim();
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId 必填' });
  const taskMeta = recallTaskMeta(taskId, 'runninghub');
  const requestedSite = rhRequestedSite(taskMeta?.rhSite || req.query.site);
  const candidates = buildRhSiteCandidates(settings, requestedSite, taskMeta?.apiKey || '');
  if (candidates.length === 0) return res.status(400).json({ success: false, error: missingRhKeyError(requestedSite) });
  try {
    let selectedCandidate = candidates[0];
    let selectedData = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const r = await fetchProviderResponse(`${candidate.baseUrl}/task/openapi/outputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
        body: JSON.stringify({ apiKey: candidate.apiKey, taskId }),
      }, `RH ${candidate.label}查询接口`, { retryNetwork: true });
      const data = await parseJsonResponse(r, `RH ${candidate.label}查询接口`);
      selectedCandidate = candidate;
      selectedData = data;
      if (isRhTaskStateCode(data?.code)) break;
      const next = candidates[index + 1];
      if (!next || !shouldRetryRhSiteResponse(r, data)) break;
      logRhSiteFallback('query', candidate, next, data?.msg || `HTTP ${r.status}`);
    }
    const data = selectedData || {};
    rememberTaskKey(taskId, selectedCandidate.apiKey, { ...(taskMeta || {}), provider: 'runninghub', rhSite: selectedCandidate.id });
    // code 0=成功 / 804=运行中 / 813=排队 / 805=失败
    const taskCode = String(data.code ?? '');
    let status = 'PENDING';
    let urls = [];
    let texts = [];
    let textUrls = [];
    if (taskCode === '0') {
      status = 'SUCCESS';
      const materializationFailures = [];
      // RH outputs 返回结构兼容：
      //   ① data: [{fileUrl, fileType}, ...]                  // 常见 (AI 应用)
      //   ② data: { outputs: [...] }                            // 包一层的变体
      //   ③ data: { fileUrl, fileType }                         // 单产物对象
      //   ④ data: { results: [...] } / { files: [...] }         // 边缘变体
      //   ⑤ data: { data/output/images/... }                    // 应用市场嵌套变体
      const arr = collectRunningHubOutputItems(data.data);
      if (arr.length === 0) {
        const shape = JSON.stringify(summarizeRunningHubOutputShape(data.data)).slice(0, 1800);
        console.warn(`[RH/query] taskId=${taskId} code=0 but no output urls. shape=${shape}`);
        const failure = completedRemoteOutputError({ itemCount: 0 }, 'media');
        return sendCompletedRemoteOutputFailure(res, failure, {
          taskId,
          urls: [],
          code: Number.isFinite(Number(data.code)) ? Number(data.code) : data.code,
          site: selectedCandidate.id,
          fallbackUsed: selectedCandidate.id !== requestedSite,
        }, {
          status: 'FAILED',
          defaultCode: 'runninghub_output_missing',
          defaultMessage: 'RunningHub 任务已完成，但没有返回素材地址。',
        });
      }
      // 转存所有产物到本地
      for (const [outputIndex, it] of arr.entries()) {
        const remote = it?.fileUrl || it?.file_url || it?.downloadUrl || it?.download_url || it?.resultUrl || it?.result_url || it?.outputUrl || it?.output_url || it?.signedUrl || it?.signed_url || it?.publicUrl || it?.public_url || it?.previewUrl || it?.preview_url || it?.url;
        if (!remote) continue;
        try {
          if (isRunningHubTextOutputItem(it)) {
            const output = await fetchRunningHubTextOutput(
              remote,
              it,
              `runninghub:${selectedCandidate.id}:${taskId}:text:${outputIndex}`,
            );
            texts.push(output.text);
            textUrls.push(output.url);
            continue;
          }
          const downloaded = await fetchProxyRemoteMedia(remote, {
            allowedKinds: ['image', 'video', 'audio'],
            trustedProviderOutput: true,
            maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
          });
          let buf = downloaded.buffer;
          let ext = verifiedProxyMediaExtension(downloaded);
          const duck = await tryDecodeDuckPayload(buf);
          if (duck?.decoded && duck.buffer) {
            const decoded = validateProxyMediaBuffer(duck.buffer, '', {
              allowedKinds: ['image', 'video', 'audio'],
              maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
            });
            buf = duck.buffer;
            ext = verifiedProxyMediaExtension(decoded);
            console.log(
              '[RH/query][duck] decoded',
              `bits=${duck.lsbBits}`,
              `${duck.originalExt} -> ${ext}`,
              `kind=${duck.kind}`,
              `bytes=${buf.length}`,
            );
          } else if (duck?.passwordProtected) {
            console.log('[RH/query][duck] password protected payload detected, keep original duck image');
          }
          urls.push(storeMaterializedOutputBuffer(
            buf,
            'rh',
            ext,
            `runninghub:${selectedCandidate.id}:${taskId}:${outputIndex}`,
          ));
        } catch (downloadError) {
          console.warn(`[RH/query] save output failed taskId=${taskId} ${opaqueDiagnosticSummary('url', remote)} error=${safeDiagnosticText(downloadError?.message || downloadError, 200)}`);
          materializationFailures.push(remoteOutputDownloadFailure(downloadError, 'media'));
        }
      }
      if (materializationFailures.length > 0) {
        const failure = completedRemoteOutputError({
          itemCount: arr.length,
          failures: materializationFailures,
        }, 'media');
        return sendCompletedRemoteOutputFailure(res, failure, {
          taskId,
          urls,
          texts,
          textUrls,
          code: Number.isFinite(Number(data.code)) ? Number(data.code) : data.code,
          site: selectedCandidate.id,
          fallbackUsed: selectedCandidate.id !== requestedSite,
        }, {
          status: 'MATERIALIZING',
          defaultCode: 'runninghub_output_unusable',
          defaultMessage: 'RunningHub 结果无法保存。',
        });
      }
      texts = [...new Set(texts)];
      textUrls = [...new Set(textUrls)];
    } else if (taskCode === '804') status = 'RUNNING';
    else if (taskCode === '813') status = 'QUEUED';
    else if (taskCode === '805') status = 'FAILED';
    else status = 'UNKNOWN';
    // failReason 序列化为字符串：ComfyUI 报错可能是 object（traceback/exception_message/...）
    // 前端直接用于 setError 会造成 React JSX 渲染 object 崩溃。
    let failReasonRaw = data?.data?.failedReason ?? data?.data?.failReason ?? null;
    let failReasonStr = null;
    if (failReasonRaw != null) {
      if (typeof failReasonRaw === 'string') {
        failReasonStr = failReasonRaw;
      } else if (typeof failReasonRaw === 'object') {
        failReasonStr = failReasonRaw.exception_message || failReasonRaw.message || JSON.stringify(failReasonRaw);
      } else {
        failReasonStr = String(failReasonRaw);
      }
    }
    console.log(`[RH/query] site=${selectedCandidate.id} taskId=${taskId} status=${status} code=${data.code} media=${urls.length} texts=${texts.length}${failReasonStr ? ` ${opaqueDiagnosticSummary('fail', failReasonStr)}` : ''}`);
    res.json({
      success: true,
      data: {
        status,
        urls,
        texts,
        textUrls,
        failReason: failReasonStr ? 'RunningHub 任务失败' : null,
        code: data.code,
        site: selectedCandidate.id,
        fallbackUsed: selectedCandidate.id !== requestedSite,
      },
    });
  } catch (e) {
    proxyRouteError('proxy/rh/query 错误', e);
    if (sendTaskResultQueryRecovery(res, e, {
      taskId,
      status: 'MATERIALIZING',
      data: { urls: [], site: requestedSite },
    })) return;
    res.status(502).json({ success: false, error: 'RunningHub 查询请求失败' });
  }
});

router.post('/runninghub/cancel', async (req, res) => {
  const settings = loadRawSettings();
  const taskId = String(req.body?.taskId || '').trim();
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId 必填' });
  const taskMeta = recallTaskMeta(taskId, 'runninghub');
  const requestedSite = rhRequestedSite(taskMeta?.rhSite || req.body?.site);
  const candidates = buildRhSiteCandidates(settings, requestedSite, taskMeta?.apiKey || '');
  if (candidates.length === 0) return res.status(400).json({ success: false, error: missingRhKeyError(requestedSite) });
  try {
    let lastResponse = null;
    let lastData = null;
    let lastCandidate = candidates[0];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const r = await fetchProviderResponse(`${candidate.baseUrl}/task/openapi/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
        body: JSON.stringify({ apiKey: candidate.apiKey, taskId }),
      });
      const data = await parseJsonResponse(r, `RH ${candidate.label}取消接口`);
      lastResponse = r;
      lastData = data;
      lastCandidate = candidate;
      console.log(`[RH/cancel] site=${candidate.id} taskId=${taskId} http=${r.status} code=${data?.code}${data?.msg ? ` ${opaqueDiagnosticSummary('message', data.msg)}` : ''}`);
      if (String(data?.code) === '0') {
        rememberTaskKey(taskId, candidate.apiKey, { ...(taskMeta || {}), provider: 'runninghub', rhSite: candidate.id });
        return res.json({ success: true, data: { taskId, site: candidate.id, fallbackUsed: candidate.id !== requestedSite } });
      }
      const next = candidates[index + 1];
      if (!next || !shouldRetryRhSiteResponse(r, data)) break;
      logRhSiteFallback('cancel', candidate, next, data?.msg || `HTTP ${r.status}`);
    }
    try {
      console.warn(`[RH/cancel] failed site=${lastCandidate.id} taskId=${taskId} ${opaqueDiagnosticSummary('response', JSON.stringify(lastData))}`);
    } catch {}
    return res.status(lastResponse?.status === 401 || lastResponse?.status === 403 ? lastResponse.status : 400).json({ success: false, error: `RH 取消失败 code=${lastData?.code}` });
  } catch (e) {
    proxyRouteError('proxy/rh/cancel 错误', e);
    res.status(502).json({ success: false, error: 'RunningHub 取消请求失败', data: { taskId } });
  }
});

// ----------------------------------------------------------------
// POST /runninghub/upload-asset
// 通用素材→RH 上传转换：
//   入参 JSON: { url: '/files/output/xxx.png' | 'https://....' }
//   出参: { success, data: { fileName, fileType } }
// 用途: RhConfigNode 中 valueType=image|video|audio 的条目，
//       提交工作流前先把 url 转成 RH 内部 fileName，再写入 nodeInfoList.fieldValue。
// 协议: POST {RH}/task/openapi/upload  (multipart: apiKey, fileType=input, file)
// ----------------------------------------------------------------
router.post('/runninghub/upload-asset', express.json({ limit: '64kb', strict: true }), async (req, res) => {
  const settings = loadRawSettings();
  const requestedSite = rhRequestedSite(req.body?.site);
  const candidates = buildRhSiteCandidates(settings, requestedSite);
  if (candidates.length === 0) return res.status(400).json({ success: false, error: missingRhKeyError(requestedSite) });
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'url 必填' });
  if (Buffer.byteLength(url, 'utf8') > 16_384) return res.status(400).json({ success: false, error: 'url 过长' });
  try {
    const normalizedUrl = normalizeT8LocalMediaRef(url, {
      allowedPorts: [config.PORT, 11422],
    });
    // 1) 拿到 buffer + mime + filename
    let buf;
    let mime = 'application/octet-stream';
    let baseName = 'asset';
    if (isT8LocalMediaPath(normalizedUrl)) {
      const local = await readProviderLocalMediaRefBuffer(normalizedUrl, {
        allowedKinds: ['image', 'video', 'audio'],
        maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
      });
      if (!local) {
        return res.status(404).json({ success: false, error: '本地素材不存在、超限或越出允许目录' });
      }
      buf = local.buffer;
      mime = local.contentType;
      baseName = path.basename(local.filename);
    } else if (/^https?:\/\//i.test(normalizedUrl)) {
      const remote = await fetchProxyRemoteMedia(normalizedUrl, {
        allowedKinds: ['image', 'video', 'audio'],
        maxBytes: PROXY_MEDIA_REFERENCE_MAX_BYTES,
      });
      buf = remote.buffer;
      mime = remote.contentType || mime;
      const tail = normalizedUrl.split(/[?#]/)[0];
      baseName = tail.split('/').pop() || baseName;
    } else {
      return res.status(400).json({ success: false, error: '不支持的素材引用' });
    }
    // 2) MIME 只服从已验证的响应类型/魔数，扩展名不能反向覆盖它。
    const extMatch = baseName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const verifiedExt = extFromContentType(mime);
    if (verifiedExt && verifiedExt !== ext) baseName = `${path.basename(baseName, path.extname(baseName))}.${verifiedExt}`;
    else if (!ext) baseName += verifiedExt ? `.${verifiedExt}` : '.bin';
    // 3) FormData 上传到 RH
    let lastData = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const fd = new FormData();
      fd.append('apiKey', candidate.apiKey);
      fd.append('fileType', 'input');
      fd.append('file', new Blob([buf], { type: mime }), baseName);
      const r = await fetchProviderResponse(`${candidate.baseUrl}/task/openapi/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${candidate.apiKey}` },
        body: fd,
      });
      const data = await parseJsonResponse(r, `RH ${candidate.label}上传接口`);
      lastData = data;
      console.log('[RH/upload-asset]', `site=${candidate.id}`, baseName, mime, buf.length, '→', data?.code, data?.data?.fileName);
      if (String(data?.code) === '0' && data?.data?.fileName) {
        return res.json({ success: true, data: { fileName: data.data.fileName, fileType: data.data.fileType || mime, site: candidate.id, fallbackUsed: candidate.id !== requestedSite } });
      }
      const next = candidates[index + 1];
      if (!next || !shouldRetryRhSiteResponse(r, data)) break;
      logRhSiteFallback('upload', candidate, next, data?.msg || `HTTP ${r.status}`);
    }
    return res.status(400).json({ success: false, error: `RH 上传失败 code=${lastData?.code}` });
  } catch (e) {
    proxyRouteError('proxy/rh/upload-asset 错误', e);
    res.status(Number(e?.status) || 400).json({ success: false, error: proxyPublicError(e, '素材上传失败') });
  }
});

// 获取 AI 应用信息(nodeInfoList 等)
router.get('/runninghub/app-info', async (req, res) => {
  const settings = loadRawSettings();
  const requestedSite = rhRequestedSite(req.query.site);
  const candidates = buildRhSiteCandidates(settings, requestedSite);
  if (candidates.length === 0) return res.status(400).json({ success: false, error: missingRhKeyError(requestedSite) });
  const webappId = String(req.query.webappId || '').trim();
  if (!webappId) return res.status(400).json({ success: false, error: 'webappId 必填' });
  try {
    let lastData = null;
    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        const url = `${candidate.baseUrl}/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(candidate.apiKey)}&webappId=${encodeURIComponent(webappId)}`;
        const r = await fetchProviderResponse(url, { method: 'GET', headers: { Authorization: `Bearer ${candidate.apiKey}` } });
        const data = await parseJsonResponse(r, `RH ${candidate.label}应用参数接口`);
        lastData = data;
        if (String(data?.code) === '0') {
          return res.json({
            success: true,
            data: {
              ...normalizeRhAppInfo(data.data || {}, webappId, [candidate.apiKey]),
              rhSite: candidate.id,
              rhFallbackUsed: candidate.id !== requestedSite,
            },
          });
        }
        const next = candidates[index + 1];
        if (!next) break;
        // app-info is a read-only lookup. Exhaust the other configured site on
        // every non-success instead of guessing the meaning of opaque Provider
        // codes such as 332. Paid submit/upload paths keep their narrow replay
        // classifier so this lookup tolerance cannot cause duplicate charges.
        logRhSiteFallback('app-info', candidate, next, data?.msg || `Provider code ${data?.code ?? 'unknown'}`);
      } catch (candidateError) {
        lastError = candidateError;
        const next = candidates[index + 1];
        if (!next) throw candidateError;
        // Do not include the upstream error text here: transport errors may
        // contain a URL whose query string carries the Provider credential.
        logRhSiteFallback('app-info', candidate, next, 'read-only lookup transport failure');
      }
    }
    if (!lastData && lastError) throw lastError;
    const code = String(lastData?.code ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32) || 'unknown';
    return res.status(400).json({ success: false, error: `RH 查询失败 code=${code}` });
  } catch (e) {
    const exactSecrets = candidates.map((candidate) => candidate.apiKey);
    proxyRouteError('proxy/rh/app-info 错误', e, exactSecrets);
    res.status(proxyErrorStatus(e)).json({ success: false, error: proxyPublicError(e, '请求失败', exactSecrets) });
  }
});

module.exports = router;
module.exports._test = Object.freeze({
  decodeRunningHubTextOutput,
  diagnosticDigest,
  FAL_TOOLBOX_AUTHORITY,
  currentProviderDispatcher,
  fetchProxyRemoteMedia,
  fetchRunningHubTextOutput,
  fetchFalPollJson,
  storeMaterializedOutputBuffer,
  refToBuffer,
  validateMountedMediaBuffer,
  fetchProviderResponse,
  opaqueDiagnosticSummary,
  parseJsonResponse,
  providerPublicDnsLookup,
  resetFalTaskRegistryMemoryForTests,
  resetProviderDispatcherForTests,
  resetVideoMaterializationCacheForTests,
  remoteOutputDownloadFailure,
  resolveBuiltInLlmProvider,
  resolveMountedFileReference,
  readResourceImageRefBuffer,
  readResourceMediaRefBuffer,
  readProviderLocalMediaRefBuffer,
  safeDiagnosticText,
  safeFalRequestId,
  saveRemoteVideo,
  setProxySafeRemoteTestOptions,
  isRunningHubTextOutputItem,
  normalizedRunningHubOutputType,
  runningHubTextOutputExtension,
  summarizeImageRef,
  summarizeRunningHubOutputShape,
  trustedFalPollUrl,
  uploadAudioToSignedUrl,
  validateProxyMediaBuffer,
  verifiedProxyMediaExtension,
});

async function readProviderLocalMediaRefBuffer(ref, options = {}) {
  const allowedKinds = Array.isArray(options.allowedKinds) && options.allowedKinds.length > 0
    ? options.allowedKinds
    : ['image', 'video', 'audio'];
  const maximum = Number(options.maxBytes) || PROXY_MEDIA_REFERENCE_MAX_BYTES;
  const normalized = normalizeT8LocalMediaRef(ref, {
    allowedPorts: [config.PORT, 11422],
  });

  if (normalized.startsWith('/api/resources/file/')
    || normalized.startsWith('/api/resources/set-file/')) {
    const resource = readResourceMediaRefBuffer(normalized, {
      allowedKinds,
      maxBytes: maximum,
    });
    if (!resource) return null;
    return {
      buffer: resource.buf,
      contentType: resource.mime,
      filename: resource.originalName || `resource.${resource.ext || 'bin'}`,
      detectedKind: resource.detectedKind,
    };
  }

  if (normalized.startsWith('/files/output/') || normalized.startsWith('/output/')
    || normalized.startsWith('/files/input/') || normalized.startsWith('/input/')
    || normalized.startsWith('/files/thumbnails/')) {
    const local = readMountedFileReference(normalized, [
      { prefixes: ['/files/output/', '/output/'], root: config.OUTPUT_DIR },
      { prefixes: ['/files/input/', '/input/'], root: config.INPUT_DIR },
      { prefixes: ['/files/thumbnails/'], root: config.THUMBNAILS_DIR },
    ], maximum);
    if (!local) return null;
    const verified = validateMountedMediaBuffer(local.buffer, local.filename, {
      allowedKinds,
      maxBytes: maximum,
    });
    return {
      buffer: local.buffer,
      contentType: verified.contentType,
      filename: path.basename(local.filename),
      detectedKind: verified.detectedKind || verified.mediaKind,
    };
  }

  if (normalized.startsWith('/api/project-assets/')) {
    const resolved = await resolveMediaRef(normalized, { target: 'local-path' });
    const stat = fs.statSync(resolved.path);
    if (!stat.isFile() || stat.size > maximum) return null;
    const buffer = fs.readFileSync(resolved.path);
    const verified = validateProxyMediaBuffer(buffer, resolved.mime || mimeTypeForProxyFilename(resolved.path), {
      allowedKinds,
      maxBytes: maximum,
      sourceName: resolved.name || resolved.path,
    });
    return {
      buffer,
      contentType: verified.contentType,
      filename: resolved.name || path.basename(resolved.path),
      detectedKind: verified.detectedKind || verified.mediaKind,
    };
  }
  return null;
}
