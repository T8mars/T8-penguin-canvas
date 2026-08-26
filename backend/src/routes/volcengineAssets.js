const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const settingsRouter = require('./settings');
const {
  findVolcengineAssetsProfile,
  normalizeVolcengineAssetUri,
  requestVolcengineAssets,
  validatePublicAssetUrl,
  volcengineAssetsProfileStatus,
} = require('../providers/volcengineAssets');

function cleanText(value, maxLength = 256) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，\n]/);
  return [...new Set(values.map((item) => cleanText(item, 32)).filter(Boolean))].slice(0, 12);
}

function createCatalogStore(file) {
  const empty = () => ({ schema: 't8-volcengine-assets-catalog-v1', assets: {} });
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed?.schema === 't8-volcengine-assets-catalog-v1' && parsed.assets && typeof parsed.assets === 'object'
        ? parsed
        : empty();
    } catch (_) {
      return empty();
    }
  };
  const write = (state) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  return {
    many(assetIds) {
      const state = read();
      const result = {};
      for (const rawId of assetIds) {
        const id = cleanText(rawId, 256);
        if (id) result[id] = normalizeTags(state.assets[id]?.tags);
      }
      return result;
    },
    set(assetId, tags) {
      const id = cleanText(assetId, 256);
      if (!id) throw Object.assign(new Error('assetId 必填'), { status: 400, code: 'invalid_asset_id' });
      const state = read();
      const normalized = normalizeTags(tags);
      state.assets[id] = { tags: normalized, updatedAt: new Date().toISOString() };
      write(state);
      return normalized;
    },
  };
}

const IMPORT_JOB_SCHEMA = 't8-volcengine-assets-jobs-v1';
const IMPORT_JOB_LIMIT = 100;
const IMPORT_JOB_STATUSES = new Set(['submitted', 'processing', 'active', 'failed']);

function normalizeImportJob(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanText(raw.id, 128);
  const profileId = cleanText(raw.profileId, 128) || 'volcengine';
  const projectName = cleanText(raw.projectName, 128);
  const assetId = cleanText(raw.assetId, 256);
  const rawStatus = cleanText(raw.status, 24).toLowerCase();
  const status = IMPORT_JOB_STATUSES.has(rawStatus) ? rawStatus : 'processing';
  if (!/^volcjob-[a-z0-9-]+$/i.test(id) || !projectName) return null;
  let assetUri = '';
  if (assetId) {
    try {
      assetUri = normalizeVolcengineAssetUri(`asset://${assetId}`);
    } catch (_) {
      return null;
    }
  }
  return {
    id,
    profileId,
    projectName,
    kind: ['Image', 'Video', 'Audio'].includes(cleanText(raw.kind, 16)) ? cleanText(raw.kind, 16) : 'Image',
    name: cleanText(raw.name, 128),
    assetId,
    assetUri,
    status,
    requestId: cleanText(raw.requestId, 160),
    error: status === 'failed' ? cleanText(raw.error, 500) : '',
    createdAt: cleanText(raw.createdAt, 64) || new Date().toISOString(),
    updatedAt: cleanText(raw.updatedAt, 64) || new Date().toISOString(),
  };
}

function createImportJobStore(file) {
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed?.schema !== IMPORT_JOB_SCHEMA || !Array.isArray(parsed.jobs)) return [];
      return parsed.jobs.map(normalizeImportJob).filter(Boolean).slice(0, IMPORT_JOB_LIMIT);
    } catch (_) {
      return [];
    }
  };
  const write = (jobs) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ schema: IMPORT_JOB_SCHEMA, jobs: jobs.slice(0, IMPORT_JOB_LIMIT) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  const put = (raw) => {
    const job = normalizeImportJob(raw);
    if (!job) throw Object.assign(new Error('火山素材导入任务无效'), { status: 400, code: 'invalid_import_job' });
    const jobs = read().filter((item) => item.id !== job.id);
    write([job, ...jobs]);
    return job;
  };
  return {
    create(input) {
      const now = new Date().toISOString();
      return put({
        ...input,
        id: `volcjob-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`,
        createdAt: now,
        updatedAt: now,
      });
    },
    get(id) {
      return read().find((item) => item.id === cleanText(id, 128)) || null;
    },
    list(profileId, projectName) {
      const profile = cleanText(profileId, 128) || 'volcengine';
      const project = cleanText(projectName, 128);
      return read().filter((item) => item.profileId === profile && item.projectName === project);
    },
    put,
  };
}

function extractAsset(payload) {
  return payload?.Result?.Asset || payload?.Result || payload?.result?.asset || payload?.result || payload?.data?.asset || payload?.data || {};
}

function normalizeImportStatus(value) {
  const status = cleanText(value, 32).toLowerCase();
  if (['active', 'success', 'succeeded', 'completed', 'complete'].includes(status)) return 'active';
  if (['failed', 'failure', 'error'].includes(status)) return 'failed';
  return 'processing';
}

function apiError(res, error) {
  const status = Math.max(400, Math.min(599, Number(error?.status) || 500));
  return res.status(status).json({
    success: false,
    error: cleanText(error?.message, 500) || '火山素材请求失败',
    code: cleanText(error?.code, 120) || 'volcengine_assets_error',
    ...(error?.requestId ? { requestId: cleanText(error.requestId, 160) } : {}),
  });
}

function createVolcengineAssetsRouter(options = {}) {
  const router = express.Router();
  const loadSettings = options.loadSettings || (() => settingsRouter.loadSettings({ persistMigrations: false }));
  const requestAssets = options.requestAssets || requestVolcengineAssets;
  const catalog = createCatalogStore(options.catalogFile || config.VOLCENGINE_ASSETS_CATALOG_FILE);
  const jobs = createImportJobStore(options.jobsFile || config.VOLCENGINE_ASSETS_JOBS_FILE);
  const run = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      apiError(res, error);
    }
  };
  const context = (req) => {
    const settings = loadSettings();
    const profileId = cleanText(req.body?.profileId || req.query?.profileId, 128) || 'volcengine';
    const profile = findVolcengineAssetsProfile(settings, profileId);
    const projectName = cleanText(req.body?.projectName || req.query?.projectName, 128) || profile.project;
    return { settings, profileId, projectName };
  };
  const call = async (req, action, body) => {
    const { settings, profileId } = context(req);
    return requestAssets({ settings, profileId, action, body });
  };

  router.get('/status', run(async (req, res) => {
    const settings = loadSettings();
    const profileId = cleanText(req.query?.profileId, 128) || 'volcengine';
    res.json({ success: true, data: volcengineAssetsProfileStatus(settings, profileId) });
  }));

  router.post('/groups/list', run(async (req, res) => {
    const { projectName } = context(req);
    const data = await call(req, 'ListAssetGroups', { ProjectName: projectName, Filter: { GroupType: 'AIGC' } });
    res.json({ success: true, data });
  }));

  router.post('/groups/create', run(async (req, res) => {
    const { projectName } = context(req);
    const name = cleanText(req.body?.name, 64);
    if (!name) throw Object.assign(new Error('素材组名称必填'), { status: 400, code: 'invalid_group_name' });
    const body = { ProjectName: projectName, Name: name };
    const description = cleanText(req.body?.description, 256);
    if (description) body.Description = description;
    const data = await call(req, 'CreateAssetGroup', body);
    res.json({ success: true, data });
  }));

  router.post('/assets/list', run(async (req, res) => {
    const { projectName } = context(req);
    const groupId = cleanText(req.body?.groupId, 256);
    const filter = { GroupType: 'AIGC', ...(groupId ? { GroupIds: [groupId] } : {}) };
    const body = {
      ProjectName: projectName,
      Filter: filter,
      PageNumber: Math.max(1, Math.min(10_000, Number(req.body?.pageNumber) || 1)),
      PageSize: Math.max(1, Math.min(100, Number(req.body?.pageSize) || 20)),
    };
    const data = await call(req, 'ListAssets', body);
    res.json({ success: true, data });
  }));

  router.post('/assets/get', run(async (req, res) => {
    const { projectName } = context(req);
    const id = cleanText(req.body?.assetId, 256);
    if (!id) throw Object.assign(new Error('assetId 必填'), { status: 400, code: 'invalid_asset_id' });
    const data = await call(req, 'GetAsset', { ProjectName: projectName, Id: id });
    res.json({ success: true, data });
  }));

  router.post('/assets/import', run(async (req, res) => {
    const { settings, profileId, projectName } = context(req);
    const groupId = cleanText(req.body?.groupId, 256);
    let url;
    try {
      url = validatePublicAssetUrl(req.body?.url);
    } catch (error) {
      throw Object.assign(error, { status: 400, code: 'invalid_asset_url' });
    }
    const kind = cleanText(req.body?.kind, 16) || 'Image';
    if (!groupId) throw Object.assign(new Error('groupId 必填'), { status: 400, code: 'invalid_group_id' });
    if (!['Image', 'Video', 'Audio'].includes(kind)) throw Object.assign(new Error('kind 仅支持 Image、Video 或 Audio'), { status: 400, code: 'invalid_asset_kind' });
    const body = { ProjectName: projectName, URL: url, AssetType: kind, GroupId: groupId };
    const name = cleanText(req.body?.name, 128);
    if (name) body.Name = name;
    const data = await requestAssets({ settings, profileId, action: 'CreateAsset', body });
    const created = extractAsset(data);
    const assetId = cleanText(created?.Id || created?.AssetId || created?.assetId, 256);
    const status = assetId ? normalizeImportStatus(created?.Status || created?.status) : 'submitted';
    const job = jobs.create({
      profileId,
      projectName,
      kind,
      name,
      assetId,
      status,
      requestId: cleanText(data?.ResponseMetadata?.RequestId || data?.requestId || data?.request_id, 160),
      error: status === 'failed' ? cleanText(created?.Message || created?.ErrorMessage || created?.error, 500) : '',
    });
    res.status(202).json({
      success: true,
      data: job,
    });
  }));

  router.get('/jobs', run(async (req, res) => {
    const { profileId, projectName } = context(req);
    res.json({ success: true, data: { jobs: jobs.list(profileId, projectName) } });
  }));

  router.post('/jobs/:jobId/refresh', run(async (req, res) => {
    const { settings, profileId, projectName } = context(req);
    const job = jobs.get(req.params.jobId);
    if (!job || job.profileId !== profileId || job.projectName !== projectName) {
      throw Object.assign(new Error('火山素材导入任务不存在'), { status: 404, code: 'import_job_not_found' });
    }
    if (!job.assetId || job.status === 'active' || job.status === 'failed') {
      return res.json({ success: true, data: job });
    }
    const data = await requestAssets({
      settings,
      profileId,
      action: 'GetAsset',
      body: { ProjectName: projectName, Id: job.assetId },
    });
    const asset = extractAsset(data);
    const status = normalizeImportStatus(asset?.Status || asset?.status);
    const updated = jobs.put({
      ...job,
      status,
      requestId: cleanText(data?.ResponseMetadata?.RequestId || data?.requestId || data?.request_id, 160) || job.requestId,
      error: status === 'failed' ? cleanText(asset?.Message || asset?.ErrorMessage || asset?.error, 500) || '火山素材处理失败' : '',
      updatedAt: new Date().toISOString(),
    });
    return res.json({ success: true, data: updated });
  }));

  router.get('/assets/tags', run(async (req, res) => {
    const assetIds = String(req.query?.assetIds || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 100);
    res.json({ success: true, data: { assets: catalog.many(assetIds) } });
  }));

  router.put('/assets/:assetId/tags', run(async (req, res) => {
    const assetId = cleanText(req.params.assetId, 256);
    const tags = catalog.set(assetId, req.body?.tags);
    res.json({ success: true, data: { assetId, tags } });
  }));

  return router;
}

const router = createVolcengineAssetsRouter();
module.exports = router;
module.exports.createCatalogStore = createCatalogStore;
module.exports.createImportJobStore = createImportJobStore;
module.exports.createVolcengineAssetsRouter = createVolcengineAssetsRouter;
module.exports.normalizeImportJob = normalizeImportJob;
module.exports.normalizeTags = normalizeTags;
