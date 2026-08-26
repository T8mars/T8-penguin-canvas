'use strict';

const path = require('node:path');
const { resolvePersistentRoot, ensurePersistentLayout } = require('../storageRoot.cjs');
const { createJobStore } = require('./jobStore.cjs');
const { createCatalogStore, normalizeTags } = require('./catalogStore.cjs');

const PLUGIN_ID = 't8.volcengine-assets';
const PREFIX = '/api/plugins/volc-assets';

function invokeCapability(ctx, name, input) {
  if (typeof ctx?.capabilities?.invoke === 'function') return ctx.capabilities.invoke(name, input);
  if (typeof ctx?.invokeCapability === 'function') return ctx.invokeCapability(name, input);
  throw new Error('核心未提供 capability invoke');
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    const status = Number(error?.status) || 500;
    const upstream = error?.payload?.ResponseMetadata?.Error;
    const message = upstream?.Code === 'SignatureDoesNotMatch'
      ? '火山 AK/SK 签名校验失败。请在 API 设置中重新粘贴同一对 IAM Access Key ID 和 Secret Access Key 后保存。'
      : (error?.message || '火山资产请求失败');
    res.status(status).json({ error: message, code: upstream?.Code || '' });
  });
}

function requestBody(req) {
  return req && req.body && typeof req.body === 'object' ? req.body : {};
}

function assetRef(job) {
  const assetId = String(job.assetId || '').trim();
  return assetId ? `Asset://${assetId}` : '';
}

function createRouter(ctx, express, store, catalog) {
  const router = express.Router();
  const call = (action, body, req) => invokeCapability(ctx, 'volcengine.assets.request', {
    action,
    profileId: requestBody(req).profileId || req?.query?.profileId || 'volcengine',
    body,
  });

  router.get('/health', (_req, res) => res.json({ ok: true, pluginId: PLUGIN_ID, storageRoot: store.storageRoot }));
  router.get('/groups', asyncRoute(async (req, res) => {
    const projectName = String(req.query.projectName || '').trim();
    res.json(await call('ListAssetGroups', { ProjectName: projectName, Filter: { GroupType: 'AIGC' } }, req));
  }));
  router.get('/assets', asyncRoute(async (req, res) => {
    const groupId = String(req.query.groupId || '').trim();
    const body = {
      ProjectName: String(req.query.projectName || '').trim(),
      Filter: {
        GroupType: 'AIGC',
        ...(groupId ? { GroupIds: [groupId] } : {}),
      },
      PageNumber: Number(req.query.pageNumber || 1),
      PageSize: Math.min(100, Math.max(1, Number(req.query.pageSize || 20))),
    };
    res.json(await call('ListAssets', body, req));
  }));
  router.get('/assets/:assetId', asyncRoute(async (req, res) => {
    res.json(await call('GetAsset', {
      ProjectName: String(req.query.projectName || '').trim(),
      Id: String(req.params.assetId || '').trim(),
    }, req));
  }));
  router.get('/metadata', (req, res) => {
    const assetIds = String(req.query.assetIds || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 100);
    res.json({ assets: catalog.tagsForMany(assetIds) });
  });
  router.put('/assets/:assetId/tags', (req, res) => {
    const tags = catalog.setTags(req.params.assetId, normalizeTags(requestBody(req).tags));
    res.json({ assetId: String(req.params.assetId || ''), tags });
  });
  router.post('/groups', asyncRoute(async (req, res) => {
    const body = requestBody(req);
    res.json(await call('CreateAssetGroup', {
      ProjectName: String(body.projectName || '').trim(),
      Name: String(body.name || '').trim(),
      Description: String(body.description || '').trim() || undefined,
    }, req));
  }));
  router.post('/assets/import', asyncRoute(async (req, res) => {
    const body = requestBody(req);
    const projectName = String(body.projectName || '').trim();
    const url = String(body.url || '').trim();
    const groupId = String(body.groupId || '').trim();
    if (!groupId || !url) return res.status(400).json({ error: 'groupId 和 url 必填' });
    const payload = {
      ProjectName: projectName,
      URL: url,
      Name: String(body.name || '').trim() || undefined,
      AssetType: String(body.kind || 'Image').trim(),
      GroupId: groupId,
    };
    const response = await call('CreateAsset', payload, req);
    const created = response?.Result || response?.result || response?.data || response;
    const assetId = String(created?.Id || created?.AssetId || created?.assetId || '').trim();
    const job = store.create({
      projectName,
      kind: payload.AssetType,
      name: payload.Name || '',
      sourceUrl: url,
      assetId,
      assetUri: assetId ? `Asset://${assetId}` : '',
      status: assetId ? 'processing' : 'submitted',
      providerResponse: { requestId: response?.ResponseMetadata?.RequestId || '' },
    });
    res.status(202).json(job);
  }));
  router.get('/jobs', (_req, res) => res.json({ jobs: store.list() }));
  router.get('/jobs/:jobId', (req, res) => {
    const job = store.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json(job);
  });

  return router;
}

function mountRouter(ctx, router) {
  if (typeof ctx?.http?.registerRouter === 'function') return ctx.http.registerRouter(PREFIX, router);
  if (typeof ctx?.registerRouter === 'function') return ctx.registerRouter(PREFIX, router);
  if (ctx?.app?.use) return ctx.app.use(PREFIX, router);
  throw new Error('核心未提供 registerRouter/app.use');
}

function startPoller(ctx, store, logger = console) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const job of store.list()) {
        if (!job.assetId || ['active', 'failed'].includes(job.status)) continue;
        try {
          const response = await invokeCapability(ctx, 'volcengine.assets.request', {
            action: 'GetAsset',
            profileId: job.profileId || 'volcengine',
            body: { ProjectName: job.projectName, Id: job.assetId },
          });
          const asset = response?.Result?.Asset || response?.Result || response?.result || response?.data || {};
          const upstreamStatus = String(asset?.Status || asset?.status || '').toLowerCase();
          const nextStatus = upstreamStatus === 'active'
            ? 'active'
            : upstreamStatus === 'failed' ? 'failed' : 'processing';
          store.put({
            ...job,
            status: nextStatus,
            assetUri: assetRef({ assetId: job.assetId }),
            previewUrl: '',
            error: nextStatus === 'failed' ? String(asset?.Message || asset?.ErrorMessage || '火山资产处理失败') : '',
            updatedAt: new Date().toISOString(),
          });
        } catch (error) {
          logger.warn?.('[t8.volcengine-assets] poll failed', job.id, error?.message || error);
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, 5000);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}

function register(ctx = {}) {
  const express = ctx.express || require('express');
  const root = resolvePersistentRoot({ root: ctx.paths?.pluginDataRoot, executablePath: ctx.paths?.executablePath });
  const layout = ensurePersistentLayout(root);
  const store = createJobStore(path.join(layout.dataRoot, 'jobs.json'));
  const catalog = createCatalogStore(path.join(layout.dataRoot, 'catalog.json'));
  store.storageRoot = layout.root;
  const router = createRouter(ctx, express, store, catalog);
  const unmount = mountRouter(ctx, router);
  const stopPoller = startPoller(ctx, store, ctx.logger || console);
  ctx.logger?.info?.(`[${PLUGIN_ID}] loaded; persistent root=${layout.root}`);
  return {
    pluginId: PLUGIN_ID,
    nodeType: 'volc-asset',
    layout,
    dispose: () => {
      stopPoller();
      if (typeof unmount === 'function') unmount();
    },
  };
}

module.exports = { id: PLUGIN_ID, version: '0.1.0', register };
