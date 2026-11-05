const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { DEFAULT_PROJECT_ID, isUuid } = require('../collaboration/protocol');
const {
  createLazyRuntime,
  getProjectStorageRuntime,
  sendProjectRuntimeUnavailable,
} = require('../services/projectRuntime');
const { getBackgroundAssetIndexer, hashFile } = require('../services/assetIndexer');
const { getAssetPreviewPipeline } = require('../services/assetPreviewPipeline');
const { getAssetBlobStore } = require('../services/assetBlobStore');
const { hasMediaIdentity, matchesMediaIdentity } = require('../services/assetMediaIdentity');
const {
  openVerifiedAssetMedia,
  reconcileAssetAvailabilitySnapshots,
} = require('../services/assetAvailability');
const { getAssetSemanticPipeline, normalizeSemanticText } = require('../services/assetSemanticPipeline');
const { getPublicSemanticModel } = require('../services/assetSemanticModels');
const {
  mapProjectDatabaseStorageCapacityPublicError,
  sendProjectDatabaseStorageCapacityError,
} = require('../services/projectDatabasePublicError');
const {
  publicAsset,
  publicAssetLineageList,
  publicAssetSourceGraph,
  redactLocalPaths,
  sanitizePublicValue,
} = require('../services/assetPublicView');

const router = express.Router();
let database = null;
let previewPipeline = null;
let indexer = null;
let semanticPipeline = null;
let blobStore = null;

const projectAssetsRuntime = createLazyRuntime(() => {
  const nextDatabase = getProjectStorageRuntime(config).database;
  const nextPreviewPipeline = getAssetPreviewPipeline(config, nextDatabase);
  const nextIndexer = getBackgroundAssetIndexer(config, nextDatabase, nextPreviewPipeline);
  const nextSemanticPipeline = getAssetSemanticPipeline(config, nextDatabase);
  const nextBlobStore = getAssetBlobStore(config);
  return {
    database: nextDatabase,
    previewPipeline: nextPreviewPipeline,
    indexer: nextIndexer,
    semanticPipeline: nextSemanticPipeline,
    blobStore: nextBlobStore,
  };
});

function getProjectAssetsRuntime() {
  const runtime = projectAssetsRuntime.get();
  database = runtime.database;
  previewPipeline = runtime.previewPipeline;
  indexer = runtime.indexer;
  semanticPipeline = runtime.semanticPipeline;
  blobStore = runtime.blobStore;
  return runtime;
}

function peekProjectAssetsRuntime() {
  return projectAssetsRuntime.peek();
}

router.use((_req, res, next) => {
  try {
    getProjectAssetsRuntime();
    next();
  } catch (error) {
    sendProjectRuntimeUnavailable(res, error);
  }
});

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isLoopbackHostname(value) {
  const hostname = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isTrustedSemanticRequest(req) {
  if (!isLoopbackRequest(req)) return false;
  const host = String(req.headers?.host || '').trim();
  if (!host) return false;
  let authority;
  try {
    authority = new URL(`http://${host}`);
    if (!isLoopbackHostname(authority.hostname) || authority.username || authority.password) return false;
  } catch (_) {
    return false;
  }
  const fetchSite = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return true; // Native loopback clients do not send browser Origin headers.
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || !isLoopbackHostname(parsed.hostname)) return false;
    const sameRequestOrigin = parsed.protocol === authority.protocol
      && parsed.host.toLowerCase() === authority.host.toLowerCase();
    const configuredDevPort = String(process.env.T8_DEV_FRONTEND_PORT || process.env.VITE_PORT || '11422');
    const configuredDevOrigin = !config.IS_PACKAGED
      && parsed.protocol === 'http:'
      && parsed.port === configuredDevPort;
    // Loopback hostnames alone are not an origin boundary: any unrelated page
    // on localhost could otherwise invoke model download/delete/maintenance.
    return sameRequestOrigin || configuredDevOrigin;
  } catch (_) {
    return false;
  }
}

function requireSemanticJsonMutation(req, res) {
  const contentType = String(req.headers?.['content-type'] || '').trim().toLowerCase();
  if (/^application\/json(?:\s*;|$)/.test(contentType)) return true;
  res.status(415).json({ success: false, error: '语义管理操作只接受 application/json', code: 'semantic_json_required' });
  return false;
}

function isTrustedAssetDuplicateRefreshRequest(req) {
  if (!isTrustedSemanticRequest(req)) return false;
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const requested = new URL(`http://${String(req.headers?.host || '')}`);
    const configuredDevPort = String(process.env.T8_DEV_FRONTEND_PORT || process.env.VITE_PORT || '11422');
    return parsedOrigin.protocol === 'http:'
      && (parsedOrigin.host.toLowerCase() === requested.host.toLowerCase()
        || parsedOrigin.port === configuredDevPort);
  } catch (_) {
    return false;
  }
}

function requireAssetDuplicateRefreshRequest(req, res) {
  if (!isTrustedAssetDuplicateRefreshRequest(req)) {
    res.status(403).json({
      success: false,
      error: '重复候选刷新只允许从可信的主机本地来源发起',
      code: 'trusted_loopback_required',
    });
    return false;
  }
  const contentType = String(req.headers?.['content-type'] || '').trim().toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    res.status(415).json({
      success: false,
      error: '重复候选刷新只接受 application/json',
      code: 'asset_duplicate_refresh_json_required',
    });
    return false;
  }
  return true;
}

const ASSET_AVAILABILITY_REFRESH_BODY_FIELDS = new Set([
  'projectId',
  'expectedCatalogRevision',
  'entityUid',
  'contentRevision',
  'organizationRevision',
  'contentHash',
]);

function requireAssetAvailabilityRefreshRequest(req, res) {
  if (!isTrustedSemanticRequest(req)) {
    res.status(403).json({
      success: false,
      error: '素材可用性校验只允许从可信的主机本地来源发起',
      code: 'trusted_loopback_required',
    });
    return false;
  }
  const contentType = String(req.headers?.['content-type'] || '').trim().toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    res.status(415).json({
      success: false,
      error: '素材可用性校验只接受 application/json',
      code: 'asset_availability_refresh_json_required',
    });
    return false;
  }
  return true;
}

function requireAssetScanRequest(req, res) {
  if (!isTrustedSemanticRequest(req)) {
    res.status(403).json({
      success: false,
      error: '素材扫描只允许从可信的主机本地来源发起',
      code: 'trusted_loopback_required',
    });
    return false;
  }
  const contentType = String(req.headers?.['content-type'] || '').trim().toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    res.status(415).json({
      success: false,
      error: '素材扫描只接受 application/json',
      code: 'asset_scan_json_required',
    });
    return false;
  }
  return true;
}

function parseAssetAvailabilityRefreshBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('素材可用性校验参数无效');
    error.code = 'asset_availability_refresh_body_invalid';
    error.status = 400;
    throw error;
  }
  const keys = Object.keys(body);
  if (keys.length !== ASSET_AVAILABILITY_REFRESH_BODY_FIELDS.size
    || keys.some((key) => !ASSET_AVAILABILITY_REFRESH_BODY_FIELDS.has(key))
    || [...ASSET_AVAILABILITY_REFRESH_BODY_FIELDS].some((key) => !Object.hasOwn(body, key))) {
    const error = new Error('素材可用性校验只接受冻结身份字段');
    error.code = 'asset_availability_refresh_body_invalid';
    error.status = 400;
    throw error;
  }
  if (typeof body.projectId !== 'string'
    || typeof body.entityUid !== 'string'
    || typeof body.contentHash !== 'string'
    || typeof body.expectedCatalogRevision !== 'number'
    || typeof body.contentRevision !== 'number'
    || typeof body.organizationRevision !== 'number') {
    const error = new Error('素材可用性校验冻结身份字段类型无效');
    error.code = 'asset_availability_refresh_body_invalid';
    error.status = 400;
    throw error;
  }
  const parsed = {
    projectId: body.projectId.trim(),
    expectedCatalogRevision: body.expectedCatalogRevision,
    entityUid: body.entityUid.trim().toLowerCase(),
    contentRevision: body.contentRevision,
    organizationRevision: body.organizationRevision,
    contentHash: body.contentHash.trim().toLowerCase(),
  };
  if (!parsed.projectId || parsed.projectId.length > 240
    || !isUuid(parsed.entityUid)
    || !/^[a-f0-9]{64}$/.test(parsed.contentHash)
    || !Number.isSafeInteger(parsed.expectedCatalogRevision) || parsed.expectedCatalogRevision < 1
    || !Number.isSafeInteger(parsed.contentRevision) || parsed.contentRevision < 1
    || !Number.isSafeInteger(parsed.organizationRevision) || parsed.organizationRevision < 1) {
    const error = new Error('素材可用性校验冻结身份无效');
    error.code = 'asset_availability_refresh_body_invalid';
    error.status = 400;
    throw error;
  }
  return parsed;
}

function publicErrorMessage(error, fallback = '素材操作失败') {
  return redactLocalPaths(error?.message || String(error || fallback)) || fallback;
}

function errorStatus(error, fallback = 400) {
  return /(?:[_-]conflict|[_-]in[_-](?:progress|use))$/.test(String(error?.code || '')) ? 409 : fallback;
}

function assetDuplicateErrorStatus(error, fallback = 400) {
  const code = String(error?.code || '');
  if (code === 'asset_duplicate_scan_required') return 409;
  if (code === 'asset_duplicate_scan_limit_exceeded') return 422;
  if (code === 'asset_not_found') return 404;
  return errorStatus(error, fallback);
}

function publicErrorBody(error, fallback = '素材操作失败') {
  const body = { success: false, error: publicErrorMessage(error, fallback) };
  const code = String(error?.code || '').trim().replace(/-/g, '_').slice(0, 120);
  if (/^[a-z0-9_]+$/i.test(code)) body.code = code;
  if (error?.current && typeof error.current === 'object') {
    const current = {};
    for (const key of [
      'id', 'assetId', 'projectId', 'revision', 'organizationRevision',
      'catalogRevision', 'graphRevision', 'lineageRevision', 'decision', 'updatedAt',
    ]) {
      const value = error.current[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') current[key] = value;
    }
    if (Object.keys(current).length) body.current = current;
  }
  return body;
}

const ASSET_DELETE_CLEANUP_WARNING_CODE = 'asset_delete_cleanup_pending';
const ASSET_DELETE_CLEANUP_PHASES = new Set([
  'legacy-file-delete',
  'cas-file-delete',
  'cas-record-finalize',
]);

function assetDeleteCleanupWarning(error, phase) {
  const safePhase = ASSET_DELETE_CLEANUP_PHASES.has(String(phase))
    ? String(phase)
    : 'cas-file-delete';
  const capacity = mapProjectDatabaseStorageCapacityPublicError(error, {
    operation: safePhase === 'cas-record-finalize'
      ? 'asset.blob.delete-mark'
      : 'asset.file.cleanup',
  });
  return {
    code: ASSET_DELETE_CLEANUP_WARNING_CODE,
    committed: true,
    phase: safePhase,
    ...(capacity ? { reason: capacity.body.reason } : {}),
    // A destructive request must never be replayed automatically. CAS cleanup
    // remains on its pending-delete ledger; legacy cleanup is explicit/manual
    // until schema32 provides a durable quarantine intent.
    retryable: false,
    reconciliationPending: true,
  };
}

function committedAssetDeleteData(assetId, input = {}) {
  return {
    id: String(assetId),
    indexRemoved: true,
    fileDeleted: input.fileDeleted === true,
    ...(Object.hasOwn(input, 'blobRetained') ? { blobRetained: input.blobRetained === true } : {}),
    ...(input.persistenceWarning ? { persistenceWarning: input.persistenceWarning } : {}),
  };
}

function sendAssetDeleteDatabaseError(res, error) {
  if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.index.remove' })) return;
  if (error?.code === 'asset_delete_identity_conflict') {
    res.status(409).json({
      success: false,
      code: 'asset_delete_identity_conflict',
      error: '素材已变化，请刷新后重新确认删除',
    });
    return;
  }
  if (error?.code === 'asset_delete_blob_identity_conflict') {
    res.status(409).json({
      success: false,
      code: 'asset_delete_blob_identity_conflict',
      error: 'CAS 素材存储状态已变化，请刷新或完成存储对账后重试',
    });
    return;
  }
  if (error?.code === 'asset_delete_retained_run_output') {
    res.status(409).json({
      success: false,
      code: 'asset_delete_retained_run_output',
      error: '素材仍被运行输出证据引用，不能删除',
    });
    return;
  }
  res.status(500).json({ success: false, error: '删除素材索引失败' });
}

function sameManagedPath(left, right) {
  const leftPath = path.resolve(String(left || ''));
  const rightPath = path.resolve(String(right || ''));
  return process.platform === 'win32'
    ? leftPath.toLocaleLowerCase('en-US') === rightPath.toLocaleLowerCase('en-US')
    : leftPath === rightPath;
}

function classifyManagedAssetPath(asset, roots) {
  const managedPath = path.resolve(String(asset?.managedPath || ''));
  const managed = asset?.storageMode === 'managed' && Boolean(asset?.managedPath);
  const anyCasPath = managed && blobStore.isBlobPath(managedPath);
  let casManaged = false;
  if (anyCasPath) {
    try {
      casManaged = sameManagedPath(blobStore.resolvePath(asset.contentHash), managedPath);
    } catch (_) {
      casManaged = false;
    }
  }
  const legacyManaged = managed && !anyCasPath
    && roots.some((root) => managedPath === root || managedPath.startsWith(`${root}${path.sep}`));
  return {
    managedPath,
    casManaged,
    legacyManaged,
    casIdentityMismatch: anyCasPath && !casManaged,
  };
}

function sameFileSnapshot(left, right) {
  return Boolean(left && right)
    && Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs);
}

async function verifyLegacyDeleteTarget(asset, roots) {
  const filename = path.resolve(String(asset?.managedPath || ''));
  if (!fs.existsSync(filename)) return { exists: false, filename, stat: null };
  const before = await fs.promises.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) {
    const error = new Error('受管素材路径不是安全的普通文件');
    error.code = 'asset_delete_file_identity_conflict';
    throw error;
  }
  const realFilename = await fs.promises.realpath(filename);
  const realRoots = await Promise.all(roots.map(async (root) => (
    fs.existsSync(root) ? fs.promises.realpath(root) : path.resolve(root)
  )));
  const insideRealRoot = realRoots.some((root) => (
    sameManagedPath(realFilename, root)
      || (process.platform === 'win32'
        ? realFilename.toLocaleLowerCase('en-US').startsWith(`${root.toLocaleLowerCase('en-US')}${path.sep}`)
        : realFilename.startsWith(`${root}${path.sep}`))
  ));
  // A lexical Windows path can legitimately use an 8.3 alias (for example
  // ADMINI~1) while realpath() returns the long spelling.  Requiring those two
  // strings to match rejects the same file.  The resolved-root containment
  // check still rejects junction/symlink escapes, while lstat above rejects a
  // link as the delete target itself.
  if (!insideRealRoot) {
    const error = new Error('受管素材路径解析到了不安全位置');
    error.code = 'asset_delete_file_identity_conflict';
    throw error;
  }
  const digest = await hashFile(filename);
  const after = await fs.promises.lstat(filename);
  const afterRealFilename = await fs.promises.realpath(filename);
  if (!sameFileSnapshot(before, after)
    || !sameManagedPath(realFilename, afterRealFilename)
    || String(digest || '').toLowerCase() !== String(asset.contentHash || '').toLowerCase()) {
    const error = new Error('受管素材文件已变化，请重新索引后再删除');
    error.code = 'asset_delete_file_identity_conflict';
    throw error;
  }
  return { exists: true, filename, stat: after };
}

async function quarantineAndDeleteVerifiedLegacyFile(asset, roots, expectedSnapshot) {
  if (!expectedSnapshot?.exists) return false;
  const originalPath = path.resolve(String(asset?.managedPath || ''));
  const parent = path.dirname(originalPath);
  let quarantineDirectory = null;
  let quarantinePath = null;
  let moved = false;
  try {
    quarantineDirectory = fs.mkdtempSync(path.join(parent, '.t8-asset-delete-'));
    try { fs.chmodSync(quarantineDirectory, 0o700); } catch (_) {}
    quarantinePath = path.join(quarantineDirectory, 'payload');
    fs.renameSync(originalPath, quarantinePath);
    moved = true;
    const quarantined = await verifyLegacyDeleteTarget({
      ...asset,
      managedPath: quarantinePath,
    }, roots);
    if (!quarantined.exists || !sameFileSnapshot(expectedSnapshot.stat, quarantined.stat)) {
      const error = new Error('隔离后的受管素材文件与已验证对象不一致');
      error.code = 'asset_delete_file_identity_conflict';
      throw error;
    }
    fs.unlinkSync(quarantinePath);
    moved = false;
    return true;
  } catch (error) {
    // Never delete an object that appeared after the verified snapshot. If the
    // atomic rename moved an unexpected replacement, put it back when the
    // original pathname is still free; otherwise retain it in quarantine.
    if (moved && quarantinePath && fs.existsSync(quarantinePath)) {
      try {
        // link() is an atomic no-replace restore: unlike POSIX rename(), it
        // fails with EEXIST if another writer recreated the original pathname.
        // Unsupported hard links leave the verified object quarantined rather
        // than risking an overwrite.
        fs.linkSync(quarantinePath, originalPath);
        try {
          fs.unlinkSync(quarantinePath);
          moved = false;
        } catch (_) {
          // Both names reference the same inode. Keep the quarantine directory
          // for explicit reconciliation if its name cannot be removed.
        }
      } catch (_) {}
    }
    throw error;
  } finally {
    if (quarantineDirectory && !moved) {
      try { fs.rmdirSync(quarantineDirectory); } catch (_) {}
    }
  }
}

function requireLoopback(req, res, message = '该素材管理操作只允许从主机本地执行') {
  if (isTrustedSemanticRequest(req) && requireSemanticJsonMutation(req, res)) return true;
  if (res.headersSent) return false;
  res.status(403).json({ success: false, error: message, code: 'trusted_loopback_required' });
  return false;
}

router.use('/semantic', (req, res, next) => {
  if (isTrustedSemanticRequest(req)) return next();
  return res.status(403).json({
    success: false,
    error: '语义接口只接受可信的本机回环来源',
    code: 'trusted_loopback_required',
  });
});

function semanticInstallState(value) {
  const normalized = String(value || '').toLowerCase().replace(/_/g, '-');
  if (['invalid', 'cancelled'].includes(normalized)) return 'error';
  if (normalized === 'missing') return 'not-installed';
  if (['not-installed', 'downloading', 'verifying', 'installed', 'failed', 'error', 'disabled', 'deleting'].includes(normalized)) return normalized;
  return 'not-installed';
}

function publicSemanticModel(model) {
  let manifest = null;
  try {
    manifest = getPublicSemanticModel(String(model?.modelId || model?.modelKey || model?.key || ''));
  } catch (_) {}
  const installState = semanticInstallState(model?.status || model?.state || model?.installState);
  const error = model?.error?.message || model?.errorMessage || model?.error || null;
  return {
    key: String(model?.modelId || model?.modelKey || model?.key || ''),
    capability: String(model?.task || model?.capability || manifest?.task || ''),
    label: String(model?.displayName || model?.label || manifest?.displayName || model?.modelId || model?.modelKey || ''),
    version: String(model?.version || model?.modelVersion || manifest?.revision || ''),
    revision: model?.revision ?? 1,
    installState,
    installed: Boolean(model?.installed || installState === 'installed'),
    downloadedBytes: Math.max(0, Number(model?.downloadedBytes) || 0),
    totalBytes: Math.max(0, Number(model?.totalBytes || model?.downloadBytes || manifest?.downloadBytes) || 0),
    error: error ? normalizeSemanticText(redactLocalPaths(String(error)), 600) || null : null,
    updatedAt: model?.updatedAt || null,
  };
}

function publicSemanticCounts(value) {
  const counts = value && typeof value === 'object' ? value : {};
  return Object.fromEntries([
    'queued', 'running', 'retrying', 'succeeded', 'skipped', 'failed', 'superseded', 'total',
  ].map((key) => [key, Math.max(0, Math.trunc(Number(counts[key]) || 0))]));
}

function publicSemanticGeneration(generation) {
  if (!generation || typeof generation !== 'object') return null;
  const error = generation.error?.message || generation.errorMessage || generation.error || null;
  return {
    projectId: String(generation.projectId || ''),
    generation: Math.max(0, Math.trunc(Number(generation.generation) || 0)),
    revision: Math.max(0, Math.trunc(Number(generation.revision) || 0)),
    profileRevision: Math.max(0, Math.trunc(Number(generation.profileRevision) || 0)),
    catalogRevision: Math.max(0, Math.trunc(Number(generation.catalogRevision) || 0)),
    jobsSealed: Boolean(generation.jobsSealed),
    expectedJobCount: Math.max(0, Math.trunc(Number(generation.expectedJobCount) || 0)),
    eligibleAssetCount: Math.max(0, Math.trunc(Number(generation.eligibleAssetCount) || 0)),
    excludedAssetCount: Math.max(0, Math.trunc(Number(generation.excludedAssetCount) || 0)),
    payloadPrunedAt: generation.payloadPrunedAt == null ? null : Number(generation.payloadPrunedAt),
    status: ['building', 'ready', 'active', 'failed', 'superseded'].includes(String(generation.status))
      ? String(generation.status)
      : 'failed',
    counts: publicSemanticCounts(generation.counts),
    error: error ? normalizeSemanticText(redactLocalPaths(String(error)), 600) || null : null,
    createdAt: generation.createdAt == null ? null : Number(generation.createdAt),
    updatedAt: generation.updatedAt == null ? null : Number(generation.updatedAt),
    finishedAt: generation.finishedAt == null ? null : Number(generation.finishedAt),
  };
}

function publicSemanticJob(job) {
  if (!job || typeof job !== 'object') return null;
  const error = job.error?.message || job.errorMessage || job.error || null;
  return {
    id: String(job.id || ''),
    projectId: String(job.projectId || ''),
    assetId: String(job.assetId || ''),
    generation: Math.max(0, Math.trunc(Number(job.generation) || 0)),
    jobKind: String(job.jobKind || ''),
    modelKey: String(job.modelKey || ''),
    modelVersion: String(job.modelVersion || ''),
    status: String(job.status || ''),
    revision: Math.max(0, Math.trunc(Number(job.revision) || 0)),
    attemptCount: Math.max(0, Math.trunc(Number(job.attemptCount) || 0)),
    maxAttempts: Math.max(1, Math.trunc(Number(job.maxAttempts) || 1)),
    nextAttemptAt: job.nextAttemptAt == null ? null : Number(job.nextAttemptAt),
    error: error ? normalizeSemanticText(redactLocalPaths(String(error)), 600) || null : null,
    createdAt: job.createdAt == null ? null : Number(job.createdAt),
    startedAt: job.startedAt == null ? null : Number(job.startedAt),
    updatedAt: job.updatedAt == null ? null : Number(job.updatedAt),
    finishedAt: job.finishedAt == null ? null : Number(job.finishedAt),
  };
}

function countSemanticJobsByCapability(jobs = []) {
  const initial = () => ({ eligible: 0, queued: 0, running: 0, succeeded: 0, skipped: 0, failed: 0 });
  const result = { caption: initial(), ocr: initial(), embedding: initial() };
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const capability = result[job.jobKind];
    if (!capability) continue;
    capability.eligible += 1;
    const status = String(job.status || '').toLowerCase();
    if (status === 'retrying') capability.queued += 1;
    else if (Object.hasOwn(capability, status)) capability[status] += 1;
    else if (status === 'superseded') capability.failed += 1;
  }
  return result;
}

function publicSemanticStatus(raw) {
  const profile = raw.profile || {};
  const models = (Array.isArray(raw.models) ? raw.models : []).map(publicSemanticModel);
  const generation = raw.building || raw.failedGeneration || raw.activeGenerationRecord || null;
  const aggregate = raw.jobs?.byCapability;
  const counts = aggregate
    ? Object.fromEntries(['caption', 'ocr', 'embedding'].map((name) => {
      const value = aggregate[name] || {};
      return [name, {
        eligible: Math.max(0, Number(value.total) || 0),
        queued: Math.max(0, Number(value.queued) || 0) + Math.max(0, Number(value.retrying) || 0),
        running: Math.max(0, Number(value.running) || 0),
        succeeded: Math.max(0, Number(value.succeeded) || 0),
        skipped: Math.max(0, Number(value.skipped) || 0),
        failed: Math.max(0, Number(value.failed) || 0) + Math.max(0, Number(value.superseded) || 0),
      }];
    }))
    : countSemanticJobsByCapability(generation
      ? database.listAssetSemanticJobs({ projectId: raw.projectId, generation: generation.generation, limit: 500 })
      : []);
  const capability = (name) => {
    const configured = profile[name] || {};
    const modelKey = String(configured.modelKey || '');
    const model = models.find((entry) => entry.key === modelKey) || null;
    return {
      capability: name,
      enabled: Boolean(profile.enabled && configured.enabled),
      modelKey,
      modelVersion: String(configured.modelVersion || model?.version || ''),
      model,
      ...counts[name],
    };
  };
  const activeGeneration = Math.max(0, Number(profile.activeGeneration) || 0);
  const buildingGeneration = profile.buildingGeneration == null ? null : Math.max(0, Number(profile.buildingGeneration) || 0);
  const hasEnabledCapability = ['caption', 'ocr', 'embedding'].some((name) => Boolean(profile.enabled && profile[name]?.enabled));
  const embeddingEnabled = Boolean(profile.enabled && profile.embedding?.enabled);
  let indexState = 'empty';
  if (!hasEnabledCapability) indexState = 'disabled';
  else if (raw.building) indexState = 'building';
  else if (raw.failedGeneration) indexState = raw.activeGenerationRecord
    ? (raw.indexStale ? 'stale' : 'degraded')
    : 'error';
  else if (['ready', 'active'].includes(raw.activeGenerationRecord?.status)) {
    if (raw.indexStale) indexState = 'stale';
    else indexState = embeddingEnabled && Number(counts.embedding?.succeeded || 0) === 0 ? 'empty' : 'ready';
  }
  else if (raw.activeGenerationRecord?.status === 'failed') indexState = 'error';
  return {
    project: {
      projectId: String(raw.projectId || ''),
      revision: profile.revision ?? 1,
      enabled: Boolean(profile.enabled),
      activeGeneration,
      activeIndexRevision: raw.activeGenerationRecord?.revision || (raw.activeGenerationRecord ? `${raw.activeGenerationRecord.generation}:${raw.activeGenerationRecord.updatedAt || raw.activeGenerationRecord.createdAt || 0}` : ''),
      activeCatalogRevision: raw.activeGenerationRecord?.catalogRevision ?? 0,
      currentCatalogRevision: raw.currentCatalogRevision ?? 0,
      buildingGeneration,
      indexState,
      indexStale: Boolean(raw.indexStale),
      capabilities: {
        caption: capability('caption'),
        ocr: capability('ocr'),
        embedding: capability('embedding'),
      },
      updatedAt: profile.updatedAt || null,
    },
    models,
    rebuild: publicSemanticGeneration(raw.building || raw.failedGeneration || raw.activeGenerationRecord),
    worker: {
      active: Math.max(0, Number(raw.workerActive) || 0),
      concurrency: Math.max(1, Number(raw.concurrency) || 1),
    },
  };
}

function publicSemanticEvidence(match) {
  const metadata = match?.metadata && typeof match.metadata === 'object'
    ? sanitizePublicValue(match.metadata, {}, 0, 'metadata') || {}
    : {};
  return {
    source: String(match?.sourceKind || match?.source || match?.kind || 'metadata').slice(0, 40),
    snippet: normalizeSemanticText(match?.snippet || match?.text || '', 320),
    language: match?.language ? String(match.language).slice(0, 40) : undefined,
    modelKey: match?.modelKey ? String(match.modelKey).slice(0, 120) : undefined,
    modelVersion: match?.modelVersion ? String(match.modelVersion).slice(0, 120) : undefined,
    frameIndex: Number.isInteger(metadata.frameIndex) ? metadata.frameIndex : undefined,
    time: Number.isFinite(metadata.time) ? metadata.time : undefined,
    page: Number.isInteger(metadata.page) ? metadata.page : undefined,
    bbox: Array.isArray(metadata.bbox) && metadata.bbox.length === 4 ? metadata.bbox.map(Number) : undefined,
  };
}

function requireExpectedRevision(req, res, options = {}) {
  const raw = req.body?.expectedRevision;
  const revision = Number(raw);
  const minimum = options.allowZero ? 0 : 1;
  if (!Object.hasOwn(req.body || {}, 'expectedRevision')) {
    res.status(400).json({ success: false, error: '缺少 expectedRevision', code: 'expected_revision_required' });
    return false;
  }
  if (!Number.isInteger(revision) || revision < minimum) {
    res.status(400).json({ success: false, error: options.allowZero ? 'expectedRevision 必须为非负整数' : 'expectedRevision 必须为正整数', code: 'expected_revision_invalid' });
    return false;
  }
  return true;
}

function parseRange(value, size) {
  const match = String(value || '').match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start == null && end != null) { start = Math.max(0, size - end); end = size - 1; }
  if (start == null) return null;
  if (end == null) end = size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

router.get('/', (req, res) => {
  const filters = {
    projectId: req.query.projectId,
    kind: req.query.kind,
    storageMode: req.query.storageMode,
    availability: req.query.availability,
    query: req.query.query,
    tag: req.query.tag,
    collectionId: req.query.collectionId,
    source: req.query.source,
    sort: req.query.sort,
    limit: req.query.limit,
    offset: req.query.offset,
  };
  res.json({
    success: true,
    data: database.listAssets(filters).map(publicAsset),
    meta: {
      total: database.countAssets(filters),
      offset: Math.max(0, Number(filters.offset) || 0),
      limit: Math.min(500, Math.max(1, Number(filters.limit) || 100)),
      catalogRevision: database.getAssetCatalogRevision(filters.projectId),
      tags: database.listAssetTags(filters.projectId),
    },
  });
});

function projectAssetStatus(projectId = DEFAULT_PROJECT_ID) {
  const normalizedProjectId = String(projectId || DEFAULT_PROJECT_ID);
  return {
    projectId: normalizedProjectId,
    scan: indexer.status(normalizedProjectId),
    previews: previewPipeline.status(normalizedProjectId),
  };
}

router.get('/status', (req, res) => res.json({ success: true, data: projectAssetStatus(req.query.projectId) }));

router.post('/scan', async (req, res) => {
  if (!requireAssetScanRequest(req, res)) return;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'projectId')
      || typeof body.projectId !== 'string'
      || !body.projectId.trim()
      || body.projectId.trim().length > 240) {
      return res.status(400).json({
        success: false,
        error: '素材扫描只接受 projectId',
        code: 'asset_scan_body_invalid',
      });
    }
    return res.json({
      success: true,
      data: await indexer.scan({ projectId: body.projectId.trim() }),
    });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.scan' })) return;
    return res.status(error?.status || 500).json(publicErrorBody(error, '素材扫描失败'));
  }
});

router.all('/scan', (_req, res) => res
  .set('Allow', 'POST')
  .status(405)
  .json({ success: false, error: '素材扫描只支持 POST', code: 'method_not_allowed' }));

router.post('/link', async (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ success: false, error: '链接本机素材只允许从主机本地操作' });
  if (req.body?.canvasId) {
    const canvas = database.getCanvas(req.body.canvasId);
    const projectId = String(req.body?.projectId || DEFAULT_PROJECT_ID);
    if (!canvas || canvas.projectId !== projectId) {
      return res.status(400).json({ success: false, error: 'Canvas 不存在或不属于当前项目', code: 'invalid_canvas_reference' });
    }
  }
  const paths = [...new Set((Array.isArray(req.body?.paths) ? req.body.paths : [req.body?.sourcePath]).map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 100);
  if (!paths.length) return res.status(400).json({ success: false, error: '缺少本机素材路径' });
  try {
    const assets = [];
    for (const sourcePath of paths) {
      if (!path.isAbsolute(sourcePath)) throw new Error('链接素材必须使用绝对路径');
      assets.push(publicAsset(await indexer.indexLinkedFile(sourcePath, {
        projectId: req.body?.projectId,
        canvasId: req.body?.canvasId,
        sourceNodeId: req.body?.sourceNodeId,
        sourceNodeType: req.body?.sourceNodeType,
        creatorId: req.body?.creatorId || 'local-owner',
        sourceType: req.body?.sourceNodeId ? 'upload-node-link' : 'linked-file',
      })));
    }
    res.status(201).json({ success: true, data: assets });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.link' })) return;
    res.status(400).json({ success: false, error: publicErrorMessage(error, '链接素材失败') });
  }
});

router.get('/collections', (req, res) => {
  res.json({ success: true, data: database.listAssetCollections(req.query.projectId) });
});

router.get('/tags', (req, res) => {
  res.json({ success: true, data: database.listAssetTags(req.query.projectId, { limit: req.query.limit }) });
});

router.post('/collections', (req, res) => {
  try {
    res.status(201).json({ success: true, data: database.createAssetCollection(req.body || {}) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.collection.create' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.patch('/collections/:collectionId', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    res.json({ success: true, data: database.updateAssetCollection(req.params.collectionId, req.body || {}, { projectId: req.body?.projectId }) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.collection.update' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.delete('/collections/:collectionId', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    const removed = database.deleteAssetCollection(req.params.collectionId, { projectId: req.body?.projectId, expectedRevision: req.body?.expectedRevision });
    if (!removed) return res.status(404).json({ success: false, error: '素材集合不存在' });
    return res.json({ success: true, data: removed });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.collection.delete' })) return;
    return res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.put('/collections/:collectionId/members', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    res.json({ success: true, data: database.setAssetCollectionMembers(req.params.collectionId, req.body?.assetIds, { expectedRevision: req.body?.expectedRevision }).map(publicAsset) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.collection.members.replace' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.post('/collections/:collectionId/members/:assetId', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    res.json({ success: true, data: publicAsset(database.addAssetCollectionMember(req.params.collectionId, req.params.assetId, { expectedRevision: req.body?.expectedRevision })) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.collection.members.add' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.delete('/collections/:collectionId/members/:assetId', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    res.json({ success: true, data: publicAsset(database.removeAssetCollectionMember(req.params.collectionId, req.params.assetId, { expectedRevision: req.body?.expectedRevision })) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.collection.members.remove' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.post('/batch', (req, res) => {
  try {
    const projectId = req.body?.projectId || req.query.projectId;
    const data = database.applyAssetBatch(projectId, req.body || {}, { actorId: req.body?.actorId || 'local-owner' });
    res.json({ success: true, data });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.batch' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.get('/duplicate-groups', (req, res) => {
  try {
    const page = database.listExactDuplicateGroups(req.query.projectId, { limit: req.query.limit, cursor: req.query.cursor });
    res.json({ success: true, data: page.items.map((group) => ({ ...group, members: group.members.map(publicAsset) })), meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } });
  } catch (error) {
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.get('/duplicate-groups/:groupId', (req, res) => {
  try {
    const group = database.getExactDuplicateGroup(req.query.projectId, req.params.groupId, { limit: req.query.limit, cursor: req.query.cursor });
    if (!group) return res.status(404).json({ success: false, error: '精确重复组不存在' });
    return res.json({ success: true, data: { ...group, members: group.members.map(publicAsset) }, meta: { nextCursor: group.nextCursor, hasMore: group.hasMore } });
  } catch (error) {
    return res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.put('/duplicate-candidates/:candidateId/decision', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    const updated = database.setAssetDuplicateDecision(req.body?.projectId, req.params.candidateId, req.body || {}, { actorId: req.body?.actorId || 'local-owner' });
    if (!updated) return res.status(404).json({ success: false, error: '重复候选不存在' });
    return res.json({ success: true, data: updated });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.duplicate.decision' })) return;
    return res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.get('/semantic/status', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || DEFAULT_PROJECT_ID);
    res.json({ success: true, data: publicSemanticStatus(await semanticPipeline.status(projectId)) });
  } catch (error) {
    res.status(errorStatus(error, 500)).json(publicErrorBody(error, '语义能力状态读取失败'));
  }
});

router.post('/semantic/models/refresh', async (req, res) => {
  if (!requireLoopback(req, res, '语义模型状态同步只允许从主机本地发起')) return;
  try {
    const projectId = String(req.body?.projectId || DEFAULT_PROJECT_ID);
    await semanticPipeline.refreshModelStates();
    return res.json({
      success: true,
      data: publicSemanticStatus(await semanticPipeline.status(projectId)),
    });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.semantic.models.sync' })) return;
    return res.status(errorStatus(error, 500)).json(publicErrorBody(error, '语义模型状态同步失败'));
  }
});

router.put('/semantic/profile', async (req, res) => {
  if (!requireLoopback(req, res)) return;
  if (!requireExpectedRevision(req, res, { allowZero: true })) return;
  try {
    const projectId = String(req.body?.projectId || DEFAULT_PROJECT_ID);
    await semanticPipeline.setProfile(projectId, {
      ...(Object.hasOwn(req.body || {}, 'enabled') ? { enabled: req.body.enabled } : {}),
      ...(req.body?.caption ? { caption: req.body.caption } : {}),
      ...(req.body?.ocr ? { ocr: req.body.ocr } : {}),
      ...(req.body?.embedding ? { embedding: req.body.embedding } : {}),
    }, {
      expectedRevision: req.body.expectedRevision,
      updatedBy: req.body.updatedBy || 'local-owner',
    });
    res.json({ success: true, data: publicSemanticStatus(await semanticPipeline.status(projectId)) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.semantic.profile.update' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error, '语义配置保存失败'));
  }
});

router.post('/semantic/models/:modelKey/download', async (req, res) => {
  if (!requireLoopback(req, res, '语义模型下载只允许从主机本地发起')) return;
  if (!requireExpectedRevision(req, res)) return;
  try {
    const model = await semanticPipeline.startModelDownload(req.params.modelKey, {
      expectedRevision: req.body.expectedRevision,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(202).json({ success: true, data: publicSemanticModel(model) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.semantic.model.download' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error, '语义模型下载启动失败'));
  }
});

router.delete('/semantic/models/:modelKey', async (req, res) => {
  if (!requireLoopback(req, res, '语义模型删除只允许从主机本地执行')) return;
  if (!requireExpectedRevision(req, res)) return;
  try {
    const model = await semanticPipeline.removeModel(req.params.modelKey, { expectedRevision: req.body.expectedRevision });
    res.json({ success: true, data: publicSemanticModel(model) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.semantic.model.remove' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error, '语义模型删除失败'));
  }
});

router.post('/semantic/rebuild', async (req, res) => {
  if (!requireLoopback(req, res, '语义索引重建只允许从主机本地发起')) return;
  if (!requireExpectedRevision(req, res)) return;
  try {
    const projectId = String(req.body?.projectId || DEFAULT_PROJECT_ID);
    const generation = await semanticPipeline.rebuild(projectId, {
      expectedRevision: req.body.expectedRevision,
      idempotencyKey: req.body.idempotencyKey,
      createdBy: req.body.createdBy || 'local-owner',
    });
    res.status(202).json({ success: true, data: publicSemanticGeneration(generation), status: publicSemanticStatus(await semanticPipeline.status(projectId)) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.semantic.rebuild' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error, '语义索引重建失败'));
  }
});

router.post('/semantic/search', async (req, res) => {
  const projectId = String(req.body?.projectId || DEFAULT_PROJECT_ID);
  const query = normalizeSemanticText(req.body?.query, 2_000);
  if (!query) return res.status(400).json({ success: false, error: '请输入自然语言检索内容', code: 'asset_semantic_query_empty' });
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const result = await semanticPipeline.search(projectId, {
      query,
      filters: req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {},
      limit: req.body?.limit,
      offset: req.body?.offset,
      expectedCatalogRevision: req.body?.expectedCatalogRevision,
      expectedProfileRevision: req.body?.expectedProfileRevision,
      expectedGeneration: req.body?.expectedGeneration,
    }, { signal: controller.signal });
    const hits = (result.items || []).map((item, index) => ({
      asset: publicAsset(item.asset),
      rank: Math.max(1, Number(result.offset || 0) + index + 1),
      score: Number(item.score) || 0,
      metric: String(result.scoreMetric || item.scoreMetric || '').startsWith('rrf')
        ? 'rrf'
        : (result.scoreMetric === 'cosine' ? 'cosine' : (result.scoreMetric === 'keyword' ? 'keyword' : 'bm25')),
      evidence: (item.matches || []).slice(0, 3).map(publicSemanticEvidence).filter((entry) => entry.snippet),
    }));
    res.json({
      success: true,
      data: hits,
      meta: {
        total: Number(result.total) || 0,
        offset: Number(result.offset) || 0,
        limit: Math.min(120, Math.max(1, Number(result.limit) || 120)),
        projectId,
        queryDigest: result.queryDigest,
        catalogRevision: result.catalogRevision,
        semanticIndexRevision: result.semanticIndexRevision,
        profileRevision: result.profileRevision,
        activeGeneration: result.activeGeneration ?? result.generation,
        modelKey: result.modelKey,
        modelVersion: result.modelVersion,
        stale: Boolean(result.stale),
      },
    });
  } catch (error) {
    if (controller.signal.aborted && !res.headersSent) return;
    const fallbackStatus = /unavailable|not[_-]installed|query[_-]empty/.test(String(error?.code || '')) ? 422 : 400;
    res.status(errorStatus(error, fallbackStatus)).json(publicErrorBody(error, '自然语言检索失败'));
  }
});

router.get('/semantic/assets/:assetId', (req, res) => {
  const projectId = String(req.query.projectId || DEFAULT_PROJECT_ID);
  const asset = database.getAsset(req.params.assetId);
  if (!asset || asset.projectId !== projectId) return res.status(404).json({ success: false, error: '素材不存在' });
  const profile = database.getAssetSemanticProfile(projectId);
  const generation = Math.max(0, Number(profile.activeGeneration) || 0);
  const activeDocumentKinds = new Set(profile.enabled
    ? ['caption', 'ocr'].filter((kind) => Boolean(profile[kind]?.enabled))
    : []);
  const documents = generation > 0 && activeDocumentKinds.size > 0
    ? database.listAssetSemanticDocuments(projectId, { assetId: asset.id, generation, limit: 8 })
      .filter((document) => activeDocumentKinds.has(document.kind))
    : [];
  res.json({ success: true, data: documents.map((document) => ({
    id: document.id,
    assetId: document.assetId,
    source: document.sourceKind || document.kind,
    text: normalizeSemanticText(document.text, 1_200),
    language: document.language || null,
    modelKey: document.modelKey,
    modelVersion: document.modelVersion,
    metadata: sanitizePublicValue(document.metadata || {}, {}, 0, 'metadata') || {},
    indexedAt: document.updatedAt || document.createdAt,
  })) });
});

router.post('/semantic/jobs/:jobId/retry', (req, res) => {
  if (!requireLoopback(req, res, '语义任务重试只允许从主机本地发起')) return;
  if (!requireExpectedRevision(req, res)) return;
  try {
    const jobs = semanticPipeline.retryJob(req.params.jobId, {
      projectId: String(req.body?.projectId || DEFAULT_PROJECT_ID),
      expectedRevision: req.body.expectedRevision,
    });
    res.json({ success: true, data: jobs.map(publicSemanticJob).filter(Boolean) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.semantic.job.retry' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error, '语义任务重试失败'));
  }
});

router.put('/:assetId/tags', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    res.json({ success: true, data: publicAsset(database.setAssetTags(req.params.assetId, req.body?.tags, { expectedRevision: req.body?.expectedRevision })) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.tags.update' })) return;
    res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.get('/:assetId/duplicates', (req, res) => {
  try {
    const page = database.listAssetDuplicates(req.params.assetId, {
      mode: req.query.mode,
      maxDistance: req.query.maxDistance,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    res.json({
      success: true,
      data: page.items.map((item) => ({ ...item, asset: publicAsset(item.asset) })),
      meta: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        catalogRevision: page.catalogRevision,
      },
    });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.duplicate.list' })) return;
    res.status(assetDuplicateErrorStatus(error)).json(publicErrorBody(error));
  }
});

router.post('/:assetId/duplicates/refresh', (req, res) => {
  if (!requireAssetDuplicateRefreshRequest(req, res)) return;
  try {
    const result = database.refreshAssetDuplicateCandidates(req.params.assetId, {
      expectedCatalogRevision: req.body?.expectedCatalogRevision,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.duplicate.refresh' })) return;
    return res.status(assetDuplicateErrorStatus(error)).json(publicErrorBody(error));
  }
});

router.all('/:assetId/duplicates/refresh', (_req, res) => res
  .set('Allow', 'POST')
  .status(405)
  .json({ success: false, error: '重复候选刷新只支持 POST', code: 'method_not_allowed' }));

router.post('/:assetId/availability/refresh', async (req, res) => {
  if (!requireAssetAvailabilityRefreshRequest(req, res)) return;
  try {
    const expected = parseAssetAvailabilityRefreshBody(req.body);
    const snapshot = database.getAssetAvailabilitySnapshot(req.params.assetId);
    if (!snapshot || snapshot.projectId !== expected.projectId) {
      return res.status(404).json({ success: false, error: '素材不存在', code: 'asset_not_found' });
    }
    const identityMatches = snapshot.catalogRevision === expected.expectedCatalogRevision
      && snapshot.entityUid === expected.entityUid
      && snapshot.contentRevision === expected.contentRevision
      && snapshot.organizationRevision === expected.organizationRevision
      && snapshot.contentHash === expected.contentHash;
    if (!identityMatches) {
      const error = new Error('素材或目录已变化，请刷新后重新校验可用性');
      error.code = snapshot.catalogRevision !== expected.expectedCatalogRevision
        ? 'asset_catalog_revision_conflict'
        : 'asset_availability_identity_conflict';
      error.status = 409;
      error.current = {
        id: snapshot.id,
        assetId: snapshot.id,
        projectId: snapshot.projectId,
        revision: snapshot.contentRevision,
        organizationRevision: snapshot.organizationRevision,
        catalogRevision: snapshot.catalogRevision,
        updatedAt: snapshot.updatedAt,
      };
      throw error;
    }
    const result = await reconcileAssetAvailabilitySnapshots(database, {
      projectId: snapshot.projectId,
      catalogRevision: snapshot.catalogRevision,
      snapshots: [snapshot],
    });
    const item = result.items[0];
    return res.json({
      success: true,
      data: {
        assetId: item.assetId,
        projectId: result.projectId,
        state: item.state,
        reason: item.reason,
        changed: item.changed,
        availability: item.availability,
        organizationRevision: item.organizationRevision,
        catalogRevision: result.catalogRevision,
      },
    });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.availability.sync' })) return;
    return res.status(error?.status || errorStatus(error)).json(publicErrorBody(error, '素材可用性校验失败'));
  }
});

router.all('/:assetId/availability/refresh', (_req, res) => res
  .set('Allow', 'POST')
  .status(405)
  .json({ success: false, error: '素材可用性校验只支持 POST', code: 'method_not_allowed' }));

router.get('/:assetId/lineage', (req, res) => {
  try {
    const page = database.listAssetLineage(req.params.assetId, {
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    if (!page) return res.status(404).json({ success: false, error: '素材不存在' });
    return res.json({
      success: true,
      data: publicAssetLineageList(page.items),
      meta: {
        total: page.total,
        limit: page.limit,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        lineageRevision: page.lineageRevision,
      },
    });
  } catch (error) {
    return res.status(errorStatus(error, 404)).json(publicErrorBody(error));
  }
});

router.post('/:assetId/lineage', (req, res) => {
  try {
    res.status(201).json({ success: true, data: publicAssetLineageList(database.addAssetLineage({ ...req.body, id: undefined, childAssetId: req.params.assetId, strictReferences: true })) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.lineage.add' })) return;
    res.status(400).json({ success: false, error: publicErrorMessage(error) });
  }
});

router.get('/:assetId/source-tree', (req, res) => {
  try {
    const graph = database.getAssetSourceGraph(req.params.assetId, {
      direction: req.query.direction,
      maxDepth: req.query.maxDepth,
      maxNodes: req.query.maxNodes,
      cursor: req.query.cursor,
    });
    if (!graph) return res.status(404).json({ success: false, error: '素材不存在' });
    return res.json({ success: true, data: publicAssetSourceGraph(graph) });
  } catch (error) {
    return res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.get('/:assetId/permissions', (req, res) => {
  const asset = database.getAsset(req.params.assetId);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  return res.json({ success: true, data: database.getAssetAccessPolicy(asset.projectId, asset.id) });
});

router.put('/:assetId/permissions', (req, res) => {
  if (!requireExpectedRevision(req, res)) return;
  try {
    const asset = database.getAsset(req.params.assetId);
    if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
    return res.json({ success: true, data: database.setAssetAccessPolicy(asset.projectId, asset.id, req.body || {}, { actorId: req.body?.actorId || 'local-owner' }) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.permissions.update' })) return;
    return res.status(errorStatus(error)).json(publicErrorBody(error));
  }
});

router.post('/:assetId/preview/retry', (req, res) => {
  if (!isLoopbackRequest(req)) return res.status(403).json({ success: false, error: '重试本机预览只允许从主机本地操作' });
  const asset = database.getAsset(req.params.assetId);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  try {
    previewPipeline.retryAsset(asset.id);
    return res.json({ success: true, data: projectAssetStatus(asset.projectId) });
  } catch (error) {
    if (sendProjectDatabaseStorageCapacityError(res, error, { operation: 'asset.preview.retry' })) return;
    return res.status(400).json({ success: false, error: publicErrorMessage(error, '当前素材不能生成预览') });
  }
});

router.delete('/:assetId/index', (req, res) => {
  if (!isTrustedSemanticRequest(req)) {
    return res.status(403).json({ success: false, code: 'trusted_loopback_required', error: '删除素材只允许从主机本地操作' });
  }
  try {
    const removed = database.removeAssetIndex(req.params.assetId, { scheduleBlobDelete: false });
    if (!removed) return res.status(404).json({ success: false, error: '素材不存在' });
    return res.json({ success: true, data: committedAssetDeleteData(removed.id, { fileDeleted: false }) });
  } catch (error) {
    sendAssetDeleteDatabaseError(res, error);
    return undefined;
  }
});

router.delete('/:assetId/file', async (req, res) => {
  if (!isTrustedSemanticRequest(req)) {
    return res.status(403).json({ success: false, code: 'trusted_loopback_required', error: '删除素材只允许从主机本地操作' });
  }
  if (!requireSemanticJsonMutation(req, res)) return undefined;
  let asset;
  try {
    asset = database.getAsset(req.params.assetId);
  } catch (error) {
    sendAssetDeleteDatabaseError(res, error);
    return undefined;
  }
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  if (req.body?.deleteFile !== true || req.body?.confirmFilename !== asset.filename) return res.status(400).json({ success: false, error: '删除原文件需要输入完整文件名确认' });
  const requestedIdentity = {
    entityUid: String(req.body?.expectedEntityUid || '').trim().toLowerCase(),
    contentRevision: Number(req.body?.expectedContentRevision),
    contentHash: String(req.body?.expectedContentHash || '').trim().toLowerCase(),
  };
  if (!requestedIdentity.entityUid
    || !Number.isSafeInteger(requestedIdentity.contentRevision)
    || requestedIdentity.contentRevision < 1
    || !/^[a-f0-9]{64}$/.test(requestedIdentity.contentHash)) {
    return res.status(400).json({
      success: false,
      code: 'asset_delete_identity_required',
      error: '删除原文件需要最新素材身份，请刷新后重试',
    });
  }
  if (requestedIdentity.entityUid !== String(asset.entityUid || '').toLowerCase()
    || requestedIdentity.contentRevision !== Number(asset.contentRevision)
    || requestedIdentity.contentHash !== String(asset.contentHash || '').toLowerCase()) {
    return res.status(409).json({
      success: false,
      code: 'asset_delete_identity_conflict',
      error: '素材已变化，请刷新后重新确认删除',
    });
  }
  const roots = [config.INPUT_DIR, config.OUTPUT_DIR].map((root) => path.resolve(root));
  const requestedPath = classifyManagedAssetPath(asset, roots);
  const requestedCasManaged = requestedPath.casManaged;
  const requestedLegacyManaged = requestedPath.legacyManaged;
  if (requestedPath.casIdentityMismatch) {
    return res.status(409).json({
      success: false,
      code: 'asset_delete_identity_conflict',
      error: '素材存储身份不一致，请刷新或重新索引后再删除',
    });
  }
  if (!requestedCasManaged && !requestedLegacyManaged) return res.status(400).json({ success: false, error: '只允许删除受管 input/output 或私有 CAS 内的素材；链接文件只能移除索引' });
  let requestedLegacySnapshot = null;
  if (requestedLegacyManaged) {
    try {
      requestedLegacySnapshot = await verifyLegacyDeleteTarget(asset, roots);
    } catch (_) {
      return res.status(409).json({
        success: false,
        code: 'asset_delete_file_identity_conflict',
        error: '受管素材文件已变化或路径不安全，请刷新或重新索引后再删除',
      });
    }
  }

  let removed;
  try {
    removed = database.removeAssetIndex(asset.id, {
      // Only an explicitly confirmed CAS target authorizes CAS GC. A legacy
      // input/output file may share its hash with a separately retained CAS
      // source; deleting that legacy path must not revoke the CAS retention.
      scheduleBlobDelete: requestedCasManaged,
      requireVerifiedCasBlob: requestedCasManaged,
      expectedIdentity: {
        ...requestedIdentity,
        filename: asset.filename,
        managedPath: asset.managedPath,
        storageMode: asset.storageMode,
      },
    });
  } catch (error) {
    sendAssetDeleteDatabaseError(res, error);
    return undefined;
  }
  if (!removed) return res.status(404).json({ success: false, error: '素材不存在' });
  asset = removed;
  const committedPath = classifyManagedAssetPath(asset, roots);
  const casManaged = committedPath.casManaged;
  const legacyManaged = committedPath.legacyManaged;
  if (!casManaged && !legacyManaged) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, {
        fileDeleted: false,
        blobRetained: false,
        persistenceWarning: assetDeleteCleanupWarning(
          null,
          requestedCasManaged ? 'cas-file-delete' : 'legacy-file-delete',
        ),
      }),
    });
  }

  if (!casManaged && legacyManaged) {
    try {
      const committedLegacySnapshot = await verifyLegacyDeleteTarget(asset, roots);
      if (requestedLegacySnapshot?.exists !== committedLegacySnapshot.exists
        || (requestedLegacySnapshot?.exists
          && !sameFileSnapshot(requestedLegacySnapshot.stat, committedLegacySnapshot.stat))) {
        throw Object.assign(new Error('受管素材文件在删除确认期间发生变化'), {
          code: 'asset_delete_file_identity_conflict',
        });
      }
      if (committedLegacySnapshot.exists) {
        await quarantineAndDeleteVerifiedLegacyFile(asset, roots, committedLegacySnapshot);
      }
      return res.json({
        success: true,
        data: committedAssetDeleteData(asset.id, { fileDeleted: true, blobRetained: false }),
      });
    } catch (error) {
      return res.json({
        success: true,
        data: committedAssetDeleteData(asset.id, {
          fileDeleted: false,
          blobRetained: false,
          persistenceWarning: assetDeleteCleanupWarning(error, 'legacy-file-delete'),
        }),
      });
    }
  }

  let blobRetained;
  try {
    blobRetained = database.assetBlobReferenceCount(asset.contentHash) > 0;
  } catch (error) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, {
        fileDeleted: false,
        blobRetained: false,
        persistenceWarning: assetDeleteCleanupWarning(error, 'cas-file-delete'),
      }),
    });
  }
  if (blobRetained) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, { fileDeleted: false, blobRetained: true }),
    });
  }

  let fileDeleted = false;
  try {
    fileDeleted = Boolean(await blobStore.removeVerifiedBlob(asset.contentHash, {
      expectedSize: asset.metadata?.size,
      beforeDelete: () => database.assetBlobReferenceCount(asset.contentHash) === 0,
    }));
  } catch (error) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, {
        fileDeleted: false,
        blobRetained: false,
        persistenceWarning: assetDeleteCleanupWarning(error, 'cas-file-delete'),
      }),
    });
  }

  try {
    blobRetained = database.assetBlobReferenceCount(asset.contentHash) > 0;
  } catch (error) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, {
        fileDeleted,
        blobRetained: false,
        persistenceWarning: assetDeleteCleanupWarning(error, 'cas-record-finalize'),
      }),
    });
  }
  if (blobRetained) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, { fileDeleted, blobRetained: true }),
    });
  }
  if (!fileDeleted) {
    // `false` is deliberately ambiguous: the CAS file may already be absent,
    // or the zero-reference guard may have refused deletion during a race.
    // Never erase the pending-delete reconciliation record without positive
    // physical-deletion evidence.
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, {
        fileDeleted: false,
        blobRetained: false,
        persistenceWarning: assetDeleteCleanupWarning(null, 'cas-file-delete'),
      }),
    });
  }
  let recordFinalized;
  try {
    recordFinalized = database.markAssetBlobDeleted(asset.contentHash);
  } catch (error) {
    return res.json({
      success: true,
      data: committedAssetDeleteData(asset.id, {
        fileDeleted,
        blobRetained: false,
        persistenceWarning: assetDeleteCleanupWarning(error, 'cas-record-finalize'),
      }),
    });
  }
  if (!recordFinalized) {
    let finalBlobRetained = false;
    let recordExists = true;
    try {
      finalBlobRetained = database.assetBlobReferenceCount(asset.contentHash) > 0;
      recordExists = typeof database.getAssetBlob === 'function'
        ? Boolean(database.getAssetBlob(asset.contentHash))
        : true;
    } catch (_) {
      // Keep the conservative committed warning below. The index deletion is
      // already durable and must not be replayed to discover finalize state.
    }
    if (finalBlobRetained || recordExists) {
      return res.json({
        success: true,
        data: committedAssetDeleteData(asset.id, {
          fileDeleted,
          blobRetained: finalBlobRetained,
          persistenceWarning: assetDeleteCleanupWarning(null, 'cas-record-finalize'),
        }),
      });
    }
  }
  return res.json({
    success: true,
    data: committedAssetDeleteData(asset.id, { fileDeleted, blobRetained: false }),
  });
});

async function serveProjectAssetMedia(req, res) {
  const notFound = () => res.set('Cache-Control', 'no-store').status(404).end();
  if (!isLoopbackRequest(req)) return res.set('Cache-Control', 'no-store').status(403).end();
  const asset = database.getAsset(req.params.assetId);
  const frozenIdentity = hasMediaIdentity(req.query) ? req.query : null;
  if (frozenIdentity && !matchesMediaIdentity(asset, frozenIdentity)) return notFound();
  const health = String(asset?.metadata?.health || '').trim().toLowerCase();
  if (!asset
    || !asset.managedPath
    || !['linked', 'managed'].includes(asset.storageMode)
    || asset.availability !== 'available'
    || ['missing', 'source-changed', 'corrupt'].includes(health)) return notFound();
  let verifiedMedia = null;
  try {
    const filename = path.resolve(asset.managedPath);
    const lexicalStat = fs.lstatSync(filename);
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) return notFound();
    const realFilename = fs.realpathSync.native(filename);
    if (asset.storageMode === 'managed') {
      let safeManaged = blobStore.isBlobPath(realFilename);
      if (!safeManaged) {
        const managedRoots = [config.INPUT_DIR, config.OUTPUT_DIR]
          .map((root) => {
            try { return fs.realpathSync.native(path.resolve(root)); } catch (_) { return null; }
          })
          .filter(Boolean);
        safeManaged = managedRoots.some((root) => realFilename === root || realFilename.startsWith(`${root}${path.sep}`));
      }
      if (!safeManaged) return notFound();
    }
    verifiedMedia = await openVerifiedAssetMedia(asset, { filename: realFilename });
    if (!verifiedMedia || req.destroyed) {
      if (verifiedMedia) await verifiedMedia.handle.close();
      return notFound();
    }
    const { handle, stat } = verifiedMedia;
    // Hashing may await I/O. A deletion or identity replacement during that
    // window must not make a frozen reference silently follow the new asset.
    if (frozenIdentity) {
      const current = database.getAsset(req.params.assetId);
      if (!matchesMediaIdentity(current, frozenIdentity) || current.availability !== 'available') {
        await handle.close();
        return notFound();
      }
    }
    const rangeHeader = req.headers.range;
    const range = parseRange(rangeHeader, stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    if (asset.mimeType==='image/svg+xml') {
      res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options','nosniff');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    if (rangeHeader && !range) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      await handle.close();
      return res.status(416).end();
    }
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
      if (req.method === 'HEAD') {
        await handle.close();
        return res.end();
      }
      const stream = handle.createReadStream(range);
      stream.once('error', (error) => {
        if (!res.headersSent) notFound();
        else res.destroy(error);
      });
      return stream.pipe(res);
    }
    res.setHeader('Content-Length', stat.size);
    if (req.method === 'HEAD') {
      await handle.close();
      return res.end();
    }
    const stream = handle.createReadStream();
    stream.once('error', (error) => {
      if (!res.headersSent) notFound();
      else res.destroy(error);
    });
    return stream.pipe(res);
  } catch (_) {
    if (verifiedMedia) {
      try { await verifiedMedia.handle.close(); } catch (_) { /* best-effort close */ }
    }
    return notFound();
  }
}

router.head('/:assetId/media', serveProjectAssetMedia);
router.get('/:assetId/media', serveProjectAssetMedia);

router.get('/:assetId', (req, res) => {
  const asset = database.getAsset(req.params.assetId);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  res.json({ success: true, data: publicAsset(asset) });
});

module.exports = router;
module.exports.getRuntime = getProjectAssetsRuntime;
module.exports.peekRuntime = peekProjectAssetsRuntime;
Object.defineProperties(module.exports, {
  indexer: { enumerable: true, get: () => peekProjectAssetsRuntime()?.indexer || null },
  previewPipeline: { enumerable: true, get: () => peekProjectAssetsRuntime()?.previewPipeline || null },
  semanticPipeline: { enumerable: true, get: () => peekProjectAssetsRuntime()?.semanticPipeline || null },
});
module.exports.isLoopbackRequest = isLoopbackRequest;
module.exports.isTrustedSemanticRequest = isTrustedSemanticRequest;
