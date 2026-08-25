const MESSAGE_KEY_BY_STATUS = Object.freeze({
  400: 'errors.api.invalidRequest',
  401: 'errors.api.unauthorized',
  403: 'errors.api.forbidden',
  404: 'errors.api.notFound',
  409: 'errors.api.conflict',
  413: 'errors.api.tooLarge',
  429: 'errors.api.rateLimited',
  500: 'errors.api.internal',
  502: 'errors.api.upstream',
  503: 'errors.api.unavailable',
  504: 'errors.api.timeout',
});

const MESSAGE_KEY_RE = /^[a-z][a-z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/;
const PARAM_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const SENSITIVE_PARAM_RE = /(api.?key|authorization|cookie|credential|password|path|secret|signature|token|url)/i;

function boundedText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function normalizeApiErrorCode(value, status) {
  const code = boundedText(value, 120).replace(/[^a-zA-Z0-9_.:-]+/g, '_');
  return code || `http_${Number.isInteger(status) ? status : 500}`;
}

function sanitizeApiErrorParams(value, status) {
  const params = { status: Number.isInteger(status) ? status : 500 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return params;
  for (const [key, raw] of Object.entries(value)) {
    if (!PARAM_KEY_RE.test(key) || SENSITIVE_PARAM_RE.test(key)) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) params[key] = raw;
    else if (typeof raw === 'boolean') params[key] = raw;
    else if (typeof raw === 'string') params[key] = boundedText(raw, 160);
  }
  return params;
}

function normalizeApiErrorPayload(payload, status = 500) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const normalizedStatus = Number.isInteger(status) ? status : 500;
  const code = normalizeApiErrorCode(payload.code || payload.errorCode, normalizedStatus);
  const suppliedKey = boundedText(payload.messageKey, 160);
  const messageKey = MESSAGE_KEY_RE.test(suppliedKey)
    ? suppliedKey
    : MESSAGE_KEY_BY_STATUS[normalizedStatus] || 'errors.api.requestFailed';
  return {
    ...payload,
    code,
    messageKey,
    params: sanitizeApiErrorParams(payload.params, normalizedStatus),
  };
}

function apiErrorEnvelopeMiddleware(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function localizedErrorJson(payload) {
    const status = Number(res.statusCode) || 200;
    return originalJson(status >= 400 ? normalizeApiErrorPayload(payload, status) : payload);
  };
  next();
}

function sendApiError(res, status, input = {}) {
  const legacyMessage = boundedText(input.error || input.message, 500) || 'Request failed';
  return res.status(status).json(normalizeApiErrorPayload({
    success: false,
    error: legacyMessage,
    ...(input.code ? { code: input.code } : {}),
    ...(input.messageKey ? { messageKey: input.messageKey } : {}),
    ...(input.params ? { params: input.params } : {}),
  }, status));
}

module.exports = {
  MESSAGE_KEY_BY_STATUS,
  normalizeApiErrorCode,
  sanitizeApiErrorParams,
  normalizeApiErrorPayload,
  apiErrorEnvelopeMiddleware,
  sendApiError,
};
