'use strict';

const { signRequest } = require('./volcengineSigner.cjs');

const SERVICE = 'ark';
const VERSION = '2024-01-01';
const REGION = 'cn-beijing';
const HOST = 'open.volcengineapi.com';
const ALLOWED_ACTIONS = new Set([
  'CreateAsset',
  'GetAsset',
  'ListAssets',
  'CreateAssetGroup',
  'ListAssetGroups',
  'GetAssetGroup',
]);

function findVolcengineConfig(settings, profileId = 'volcengine') {
  const providers = Array.isArray(settings?.advancedProviders) ? settings.advancedProviders : [];
  const provider = providers.find((item) => String(item?.id || '') === String(profileId))
    || providers.find((item) => item?.protocol === 'volcengine');
  const config = provider?.volcengineConfig || {};
  return {
    project: String(config.project || '').trim(),
    region: String(config.region || REGION).trim() || REGION,
    accessKeyId: String(config.accessKeyId || '').trim(),
    secretAccessKey: String(config.secretAccessKey || '').trim(),
  };
}

function validateBody(action, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('火山资产请求体必须是对象');
  if (action === 'CreateAsset' && !String(body.GroupId || '').trim()) throw new Error('CreateAsset 缺少 GroupId');
  if (action === 'CreateAsset' && !String(body.URL || '').trim()) throw new Error('CreateAsset 缺少公开可访问的 URL');
}

function registerVolcengineAssetsCapability({ capabilities, loadSettings, logger = console, fetchImpl = globalThis.fetch }) {
  if (!capabilities || typeof capabilities.register !== 'function') throw new Error('核心缺少 capability registry');
  if (typeof loadSettings !== 'function') throw new Error('核心缺少 settings loader');
  if (typeof fetchImpl !== 'function') throw new Error('运行时缺少 fetch');

  capabilities.register('volcengine.assets.request', async (input = {}) => {
    const action = String(input.action || '').trim();
    if (!ALLOWED_ACTIONS.has(action)) throw new Error(`火山资产 Action 不在白名单: ${action}`);
    const cfg = findVolcengineConfig(loadSettings(), input.profileId);
    if (!cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('请先在贞贞画布火山引擎设置中填写 AK/SK');
    const body = input.body && typeof input.body === 'object' ? input.body : {};
    validateBody(action, body);
    const rawBody = JSON.stringify(body);
    const uri = `/open/${action}`;
    const query = { Action: action, Version: VERSION };
    const headers = signRequest({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
      service: SERVICE,
      host: HOST,
      uri,
      query,
      body: rawBody,
    });
    const response = await fetchImpl(`https://${HOST}${uri}?Action=${encodeURIComponent(action)}&Version=${VERSION}`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = { raw: text }; }
    if (!response.ok) {
      logger.warn?.('[volcengine-assets] request failed', response.status, action);
      const error = new Error(payload?.ResponseMetadata?.Error?.Message || `火山资产请求失败 (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  });
}

module.exports = { registerVolcengineAssetsCapability, findVolcengineConfig, ALLOWED_ACTIONS };
