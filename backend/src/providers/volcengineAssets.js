const crypto = require('node:crypto');
const net = require('node:net');

const VOLCENGINE_ASSETS_HOST = 'open.volcengineapi.com';
const VOLCENGINE_ASSETS_VERSION = '2024-01-01';
const VOLCENGINE_ASSETS_SERVICE = 'ark';
const DEFAULT_REGION = 'cn-beijing';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ALLOWED_ACTIONS = new Set([
  'CreateAsset',
  'GetAsset',
  'ListAssets',
  'CreateAssetGroup',
  'ListAssetGroups',
  'GetAssetGroup',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function encodeQuery(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(query) {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeQuery(key)}=${encodeQuery(query[key])}`)
    .join('&');
}

function cleanText(value, maxLength = 256) {
  return String(value || '').trim().slice(0, maxLength);
}

function findVolcengineAssetsProfile(settings, profileId = 'volcengine') {
  const providers = Array.isArray(settings?.advancedProviders) ? settings.advancedProviders : [];
  const requested = cleanText(profileId, 128) || 'volcengine';
  const provider = providers.find((item) => cleanText(item?.id, 128) === requested)
    || providers.find((item) => item?.protocol === 'volcengine');
  const config = provider?.volcengineConfig && typeof provider.volcengineConfig === 'object'
    ? provider.volcengineConfig
    : {};
  return {
    profileId: cleanText(provider?.id, 128) || requested,
    project: cleanText(config.project, 128) || 'default',
    region: cleanText(config.region, 80) || DEFAULT_REGION,
    accessKeyId: cleanText(config.accessKeyId, 512),
    secretAccessKey: cleanText(config.secretAccessKey, 2048),
  };
}

function volcengineAssetsProfileStatus(settings, profileId = 'volcengine') {
  const profile = findVolcengineAssetsProfile(settings, profileId);
  return {
    profileId: profile.profileId,
    project: profile.project,
    region: profile.region,
    configured: Boolean(profile.accessKeyId && profile.secretAccessKey),
  };
}

function normalizeVolcengineAssetUri(value) {
  const text = cleanText(value, 512);
  const match = text.match(/^asset:\/\/([A-Za-z0-9][A-Za-z0-9._:-]{2,255})$/i);
  if (!match) throw new Error('火山素材引用必须是 asset://<asset-id>');
  return `asset://${match[1]}`;
}

function privateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function privateIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
}

function validatePublicAssetUrl(value) {
  let parsed;
  try {
    parsed = new URL(cleanText(value, 4096));
  } catch (_) {
    throw new Error('素材导入地址必须是公网 HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || !parsed.hostname
    || parsed.hostname.toLowerCase() === 'localhost'
    || parsed.hostname.toLowerCase().endsWith('.localhost')
    || (net.isIP(parsed.hostname) === 4 && privateIpv4(parsed.hostname))
    || (net.isIP(parsed.hostname) === 6 && privateIpv6(parsed.hostname))) {
    throw new Error('素材导入地址必须是公网 HTTP(S) URL');
  }
  return parsed.toString();
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('火山素材请求体必须是对象');
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) throw new Error('火山素材请求体过大');
  return raw;
}

function validateActionBody(action, body) {
  requireObject(body);
  if (action === 'CreateAsset') {
    if (!cleanText(body.GroupId, 256)) throw new Error('CreateAsset 缺少 GroupId');
    validatePublicAssetUrl(body.URL);
    if (!['Image', 'Video', 'Audio'].includes(cleanText(body.AssetType, 16))) {
      throw new Error('CreateAsset 的 AssetType 仅支持 Image、Video 或 Audio');
    }
  }
  if (action === 'CreateAssetGroup' && !cleanText(body.Name, 64)) throw new Error('CreateAssetGroup 缺少 Name');
  if (action === 'GetAsset' && !cleanText(body.Id, 256)) throw new Error('GetAsset 缺少 Id');
  if (action === 'GetAssetGroup' && !cleanText(body.Id, 256)) throw new Error('GetAssetGroup 缺少 Id');
}

function signVolcengineAssetsRequest({
  accessKeyId,
  secretAccessKey,
  region = DEFAULT_REGION,
  action,
  body = {},
  now = new Date(),
}) {
  const normalizedAction = cleanText(action, 64);
  if (!ALLOWED_ACTIONS.has(normalizedAction)) throw new Error(`火山素材 Action 不在白名单: ${normalizedAction}`);
  if (!cleanText(accessKeyId, 512) || !cleanText(secretAccessKey, 2048)) throw new Error('火山素材 API 缺少 AK/SK');
  validateActionBody(normalizedAction, body);
  const rawBody = JSON.stringify(body);
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256(rawBody);
  const query = { Action: normalizedAction, Version: VOLCENGINE_ASSETS_VERSION };
  const canonicalHeaders = `host:${VOLCENGINE_ASSETS_HOST}\nx-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const signedHeaders = 'host;x-content-sha256;x-date';
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${shortDate}/${region}/${VOLCENGINE_ASSETS_SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(secretAccessKey, shortDate), region), VOLCENGINE_ASSETS_SERVICE), 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `https://${VOLCENGINE_ASSETS_HOST}/?${canonicalQuery(query)}`,
    body: rawBody,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
      Authorization: authorization,
    },
  };
}

async function parseResponse(response) {
  const declaredLength = Number(response?.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('火山素材响应过大');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('火山素材响应过大');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('火山素材接口返回了无效 JSON');
  }
}

function upstreamError(payload, status) {
  const upstream = payload?.ResponseMetadata?.Error || payload?.error || {};
  const error = new Error(cleanText(upstream.Message || upstream.message, 500) || `火山素材请求失败 (HTTP ${status || 500})`);
  error.status = Number(status) || 500;
  error.code = cleanText(upstream.Code || upstream.code, 120) || 'volcengine_assets_error';
  error.requestId = cleanText(payload?.ResponseMetadata?.RequestId || payload?.request_id, 160);
  return error;
}

async function requestVolcengineAssets({
  settings,
  profileId = 'volcengine',
  action,
  body = {},
  fetchImpl = globalThis.fetch,
  now = new Date(),
  signal,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('运行时缺少 fetch');
  const normalizedAction = cleanText(action, 64);
  if (!ALLOWED_ACTIONS.has(normalizedAction)) throw new Error(`火山素材 Action 不在白名单: ${normalizedAction}`);
  const profile = findVolcengineAssetsProfile(settings, profileId);
  if (!profile.accessKeyId || !profile.secretAccessKey) throw new Error('请先在 API 设置的火山引擎高级项中填写 AK/SK');
  const signed = signVolcengineAssetsRequest({
    accessKeyId: profile.accessKeyId,
    secretAccessKey: profile.secretAccessKey,
    region: profile.region,
    action: normalizedAction,
    body,
    now,
  });
  const response = await fetchImpl(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
    ...(signal ? { signal } : {}),
  });
  const payload = await parseResponse(response);
  if (!response.ok || payload?.ResponseMetadata?.Error) throw upstreamError(payload, response.status);
  return payload;
}

module.exports = {
  ALLOWED_ACTIONS,
  findVolcengineAssetsProfile,
  normalizeVolcengineAssetUri,
  requestVolcengineAssets,
  signVolcengineAssetsRequest,
  validatePublicAssetUrl,
  volcengineAssetsProfileStatus,
};
