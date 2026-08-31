'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { AssetIndexer } = require('./assetIndexer');
const seedanceNz = require('../providers/seedanceNz');
const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const { safeRemoteMediaDownload } = require('../utils/safeRemoteMediaFetch');

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

class CreatorActionExecutorError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'CreatorActionExecutorError';
    this.code = code;
    this.status = status;
  }
}

function bounded(value, maximum = 1_000) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function mimeAndExtension(kind, bytes, contentType) {
  const mime = bounded(contentType, 120).split(';')[0].toLowerCase();
  if (kind === 'image') {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: 'image/png', extension: 'png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mimeType: 'image/jpeg', extension: 'jpg' };
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
    throw new CreatorActionExecutorError('CREATOR_IMAGE_INVALID', `生成结果不是有效图片（${mime || 'unknown'}）`);
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return { mimeType: 'video/mp4', extension: 'mp4' };
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mimeType: mime.includes('webm') ? 'video/webm' : 'video/x-matroska', extension: mime.includes('webm') ? 'webm' : 'mkv' };
  throw new CreatorActionExecutorError('CREATOR_VIDEO_INVALID', `生成结果不是有效视频（${mime || 'unknown'}）`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecoverableContinuationError(error) {
  return new Set([
    'CREATOR_PROVIDER_TIMEOUT',
    'CREATOR_PROVIDER_RESULT_MISSING',
    'CREATOR_RESULT_DOWNLOAD_FAILED',
    'CREATOR_ASSET_RECORD_FAILED',
  ]).has(String(error?.code || ''));
}

function fileSha256(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function publicAssetRef(asset) {
  return {
    assetId: String(asset.id),
    kind: String(asset.kind),
    contentHash: String(asset.contentHash || ''),
    previewUrl: `/api/project-assets/${encodeURIComponent(asset.id)}/media`,
    title: String(asset.filename || asset.id || '生成素材').slice(0, 240),
  };
}

function exactCatalogModel(snapshot) {
  return (Array.isArray(creativeModelCatalog[snapshot.kind]) ? creativeModelCatalog[snapshot.kind] : []).find((item) => (
    item.provider === snapshot.providerId && item.model === snapshot.modelId && item.available !== false
  )) || null;
}

class CreatorActionExecutor {
  constructor(options = {}) {
    this.config = options.config || {};
    this.database = options.database;
    this.repository = options.repository;
    this.settingsProvider = typeof options.settingsProvider === 'function' ? options.settingsProvider : () => ({});
    this.provider = options.provider || seedanceNz;
    this.remoteMediaDownload = options.remoteMediaDownload || safeRemoteMediaDownload;
    this.assetIndexer = options.assetIndexer || new AssetIndexer(this.config, this.database);
    this.active = new Map();
    this.continuations = new Map();
    this.pollIntervalMs = Math.max(100, Math.min(10_000, Number(options.pollIntervalMs) || 3_000));
    this.timeoutMs = Math.max(30_000, Math.min(30 * 60_000, Number(options.timeoutMs) || 12 * 60_000));
    const continuationDelays = options.continuationRetryDelaysMs === undefined
      ? [750, 2_000, 5_000]
      : options.continuationRetryDelaysMs;
    this.continuationRetryDelaysMs = (Array.isArray(continuationDelays) ? continuationDelays : [])
      .map((value) => Math.max(25, Math.min(60_000, Math.trunc(Number(value) || 0))))
      .filter(Boolean)
      .slice(0, 5);
  }

  start(sessionId, actionId, scope = {}) {
    const scheduled = this.continuations.get(actionId);
    if (scheduled) {
      clearTimeout(scheduled.timer);
      this.continuations.delete(actionId);
    }
    return this._startInternal(sessionId, actionId, scope, scheduled?.nextRetryIndex || 0);
  }

  _startInternal(sessionId, actionId, scope = {}, retryIndex = 0) {
    const existing = this.active.get(actionId);
    if (existing) return this.repository.getAction(actionId, sessionId, scope);
    const action = this.repository.getAction(actionId, sessionId, scope);
    if (action.status === 'completed') return action;
    if (action.status === 'running' || action.status === 'ambiguous') {
      const reconciled = this.reconcileAction(sessionId, actionId, scope);
      if (!['running', 'ambiguous'].includes(reconciled.status)) return reconciled;
      let promise;
      promise = this.resume(sessionId, actionId, scope)
        .catch(() => null)
        .finally(() => {
          if (this.active.get(actionId) === promise) this.active.delete(actionId);
          this._scheduleContinuation(sessionId, actionId, scope, retryIndex);
        });
      this.active.set(actionId, promise);
      return reconciled;
    }
    if (action.status !== 'pending' && action.status !== 'failed') {
      throw new CreatorActionExecutorError('CREATOR_ACTION_NOT_CONFIRMABLE', '这个生成动作当前不能执行', 409);
    }
    let promise;
    promise = this.execute(sessionId, actionId, scope)
      .catch(() => null)
      .finally(() => {
        if (this.active.get(actionId) === promise) this.active.delete(actionId);
        this._scheduleContinuation(sessionId, actionId, scope, retryIndex);
      });
    this.active.set(actionId, promise);
    return this.repository.getAction(actionId, sessionId, scope);
  }

  _scheduleContinuation(sessionId, actionId, scope, retryIndex) {
    if (retryIndex >= this.continuationRetryDelaysMs.length || this.continuations.has(actionId)) return;
    let action;
    try { action = this.repository.getAction(actionId, sessionId, scope); } catch { return; }
    if (action.status !== 'ambiguous') return;
    const timer = setTimeout(() => {
      const scheduled = this.continuations.get(actionId);
      if (!scheduled || scheduled.timer !== timer) return;
      this.continuations.delete(actionId);
      try { this._startInternal(sessionId, actionId, scope, scheduled.nextRetryIndex); } catch (_) {}
    }, this.continuationRetryDelaysMs[retryIndex]);
    timer.unref?.();
    this.continuations.set(actionId, { timer, nextRetryIndex: retryIndex + 1 });
  }

  async wait(actionId) {
    await this.active.get(actionId);
  }

  reconcileAction(sessionId, actionId, scope = {}) {
    const action = this.repository.getAction(actionId, sessionId, scope);
    if (!action.runId) return action;
    const run = this.database.getRun(action.runId);
    if (!run) return action;
    if (run.status === 'succeeded') {
      const outputAssetIds = [...new Set([
        ...(Array.isArray(run.summary?.outputAssetIds) ? run.summary.outputAssetIds : []),
        ...(typeof this.database.listNodeRuns === 'function'
          ? this.database.listNodeRuns(run.id).flatMap((nodeRun) => Array.isArray(nodeRun.outputRefs) ? nodeRun.outputRefs : [])
          : []),
      ].map(String).filter(Boolean))];
      const resultAssets = outputAssetIds.map((assetId) => this.database.getAsset(assetId)).filter(Boolean).map(publicAssetRef);
      if (resultAssets.length) {
        const completed = this.repository.updateAction(actionId, sessionId, {
          status: 'completed', resultAssets, errorCode: null, errorMessage: null,
          conversationPhase: 'candidates',
        }, scope);
        return completed;
      }
    }
    if (['failed', 'interrupted', 'stopped', 'cancelled'].includes(String(run.status || ''))) {
      return this.repository.updateAction(actionId, sessionId, {
        status: 'failed',
        errorCode: 'CREATOR_RECOVERED_RUN_FAILED',
        errorMessage: bounded(run.summary?.error?.message || run.summary?.message, 500) || '原生成任务没有完成，请重新生成',
      }, scope);
    }
    if (['queued', 'running', 'polling'].includes(String(run.status || '')) && action.status !== 'ambiguous') {
      return this.repository.updateAction(actionId, sessionId, { status: 'ambiguous', errorCode: null, errorMessage: null }, scope);
    }
    return action;
  }

  async download(url, kind, actionId) {
    if (!/^https:\/\//iu.test(String(url || ''))) throw new CreatorActionExecutorError('CREATOR_RESULT_URL_INVALID', '生成结果没有安全下载地址');
    const maximum = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    fs.mkdirSync(this.config.OUTPUT_DIR, { recursive: true });
    let lastError = null;
    for (let index = 0; index < 3; index += 1) {
      const staging = path.join(this.config.OUTPUT_DIR, `.creator-v2-${crypto.randomUUID()}.download`);
      try {
        const downloaded = await this.remoteMediaDownload(url, staging, {
          protocols: ['https:'],
          maxBytes: maximum,
          maxRedirects: 6,
          deadlineMs: kind === 'image' ? 180_000 : 12 * 60_000,
          idleTimeoutMs: 45_000,
          accept: kind === 'image' ? 'image/*,*/*;q=0.2' : 'video/*,*/*;q=0.2',
          trustedProviderOutput: true,
          trustedProviderFallbackDeadlineMs: kind === 'image' ? 120_000 : 8 * 60_000,
        });
        const descriptor = fs.openSync(staging, 'r');
        const header = Buffer.alloc(16);
        const headerSize = fs.readSync(descriptor, header, 0, header.length, 0);
        fs.closeSync(descriptor);
        if (!downloaded.byteSize) throw new CreatorActionExecutorError('CREATOR_RESULT_INVALID_SIZE', '生成结果为空');
        const format = mimeAndExtension(kind, header.subarray(0, headerSize), downloaded.contentType);
        const contentHash = await fileSha256(staging);
        const filename = `creator-v2-${actionId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48)}-${contentHash.slice(0, 12)}.${format.extension}`;
        const absolute = path.join(this.config.OUTPUT_DIR, filename);
        const existed = fs.existsSync(absolute);
        if (existed) fs.rmSync(staging, { force: true });
        else fs.renameSync(staging, absolute);
        return { filename, absolute, contentHash, byteSize: downloaded.byteSize, created: !existed, ...format };
      } catch (error) {
        lastError = error;
        try { fs.rmSync(staging, { force: true }); } catch (_) {}
        if (index < 2) await sleep(250 * (index + 1));
      }
    }
    throw new CreatorActionExecutorError('CREATOR_RESULT_DOWNLOAD_FAILED', bounded(lastError?.message, 500) || '生成完成但下载失败');
  }

  async downloadResults(urls, kind, actionId) {
    const maximum = kind === 'image' ? 4 : 1;
    const sources = [...new Set((Array.isArray(urls) ? urls : [urls])
      .map((url) => bounded(url, 4_000)).filter(Boolean))].slice(0, maximum);
    if (!sources.length) throw new CreatorActionExecutorError('CREATOR_PROVIDER_RESULT_MISSING', '生成任务完成但没有返回结果');
    const downloaded = [];
    try {
      for (let index = 0; index < sources.length; index += 1) {
        downloaded.push(await this.download(
          sources[index],
          kind,
          sources.length === 1 ? actionId : `${actionId}-${index + 1}`,
        ));
      }
      return downloaded;
    } catch (error) {
      downloaded.filter((item) => item.created).forEach((item) => {
        try { fs.rmSync(item.absolute, { force: true }); } catch (_) {}
      });
      throw error;
    }
  }

  async resume(sessionId, actionId, scope) {
    const action = this.repository.getAction(actionId, sessionId, scope);
    const settings = this.settingsProvider() || {};
    const apiKey = bounded(settings.zhenzhenSd2ApiKey, 4_000);
    const run = action.runId ? this.database.getRun(action.runId) : null;
    const nodeRun = run && typeof this.database.listNodeRuns === 'function'
      ? this.database.listNodeRuns(run.id).find((item) => item.inputSnapshot?.actionId === actionId)
      : null;
    const attempt = nodeRun && typeof this.database.listAttempts === 'function'
      ? this.database.listAttempts(nodeRun.id).at(-1)
      : null;
    if (!apiKey || !run || !nodeRun || !attempt?.upstreamTaskId) {
      if (run && ['succeeded', 'failed', 'interrupted', 'stopped'].includes(String(run.status || ''))) {
        this.reconcileAction(sessionId, actionId, scope);
        return;
      }
      this.repository.updateAction(actionId, sessionId, {
        status: 'failed', errorCode: 'CREATOR_RECOVERY_EVIDENCE_MISSING', errorMessage: '原生成任务缺少可恢复信息，请重新生成',
      }, scope);
      return;
    }
    let pollCount = attempt.pollCount || 0;
    try {
      const completed = await this.poll(action, attempt.upstreamTaskId, apiKey, settings);
      pollCount += completed.pollCount;
      const downloaded = await this.downloadResults(completed.urls || completed.url, action.type, actionId);
      const recorded = await this.assetIndexer.recordRunOutputAssets({
        runId: run.id,
        nodeRunId: nodeRun.id,
        attemptId: attempt.id,
        outputs: downloaded.map((item, index) => ({
          kind: action.type,
          sourceUrl: `/files/output/${encodeURIComponent(item.filename)}`,
          filename: item.filename,
          mimeType: item.mimeType,
          metadata: { operation: `creator-agent-${action.type}`, actionId, outputIndex: index, recovered: true },
        })),
      });
      const resultAssets = (recorded.assets || []).map(publicAssetRef);
      if (!resultAssets.length) throw new CreatorActionExecutorError('CREATOR_ASSET_RECORD_FAILED', '生成结果没有形成项目素材');
      this.database.updateAttempt(attempt.id, {
        status: 'succeeded', pollCount,
        timestamps: { downloadedAt: Date.now(), finishedAt: Date.now() },
        metadata: { outputAssetIds: resultAssets.map((item) => item.assetId) }, error: null,
      }, { runId: run.id, nodeRunId: nodeRun.id });
      this.database.updateNodeRun(nodeRun.id, { status: 'succeeded' });
      this.database.updateRun(run.id, { status: 'succeeded', finishedAt: Date.now(), summary: { source: 'creator-agent-v2', actionId, recoveredWithoutResubmit: true, outputAssetIds: resultAssets.map((item) => item.assetId), succeededNodes: 1, failedNodes: 0 } });
      this.database.finishRunIntentForRun(run.id, 'succeeded', null, { actorId: 'local-owner', sessionId: `creator-agent:${sessionId}` });
      this.repository.updateAction(actionId, sessionId, {
        status: 'completed', resultAssets, errorCode: null, errorMessage: null,
        conversationPhase: 'candidates',
      }, scope);
    } catch (error) {
      const recoverable = isRecoverableContinuationError(error);
      if (recoverable) {
        this.database.updateAttempt(attempt.id, {
          status: 'polling',
          pollCount,
          timestamps: { lastPolledAt: Date.now() },
          error: {
            kind: 'provider',
            code: bounded(error?.code, 120) || 'CREATOR_ACTION_CONTINUATION_PENDING',
            message: bounded(error?.message, 500),
            retryable: true,
          },
        }, { runId: run.id, nodeRunId: nodeRun.id });
        this.repository.updateAction(actionId, sessionId, {
          status: 'ambiguous',
          errorCode: bounded(error?.code, 120) || 'CREATOR_ACTION_CONTINUATION_PENDING',
          errorMessage: null,
        }, scope);
        return;
      }
      try { this.database.updateAttempt(attempt.id, { status: 'failed', pollCount, timestamps: { finishedAt: Date.now() }, error: { kind: 'provider', code: bounded(error?.code, 120) || 'CREATOR_ACTION_FAILED', message: bounded(error?.message, 500), retryable: true } }, { runId: run.id, nodeRunId: nodeRun.id }); } catch (_) {}
      try { this.database.updateNodeRun(nodeRun.id, { status: 'failed' }); } catch (_) {}
      try { this.database.updateRun(run.id, { status: 'failed', finishedAt: Date.now(), summary: { source: 'creator-agent-v2', actionId, failedNodes: 1 } }); } catch (_) {}
      try { this.database.finishRunIntentForRun(run.id, 'failed', null, { actorId: 'local-owner', sessionId: `creator-agent:${sessionId}` }); } catch (_) {}
      this.repository.updateAction(actionId, sessionId, { status: 'failed', errorCode: bounded(error?.code, 120) || 'CREATOR_ACTION_FAILED', errorMessage: bounded(error?.message, 500) || '生成失败，请重新生成' }, scope);
    }
  }

  inputPaths(action, scope) {
    return (Array.isArray(action.inputAssetIds) ? action.inputAssetIds : []).map((assetId) => {
      const asset = this.database.getAsset(assetId);
      if (!asset || String(asset.projectId || '') !== String(scope.projectId || '')) {
        throw new CreatorActionExecutorError('CREATOR_INPUT_ASSET_NOT_FOUND', '生成所需的参考素材不存在或不属于当前项目', 409);
      }
      const source = String(asset.managedPath || asset.sourcePath || '').trim();
      if (!source || !path.isAbsolute(source) || !fs.existsSync(source)) {
        throw new CreatorActionExecutorError('CREATOR_INPUT_ASSET_UNAVAILABLE', '参考素材原件不可用', 409);
      }
      return { kind: asset.kind, source };
    });
  }

  async submit(action, apiKey, settings, inputPaths) {
    const baseUrl = bounded(settings.zhenzhenSd2BaseUrl, 2_000) || undefined;
    if (action.type === 'image') {
      return this.provider.submitImageTask({
        model: action.modelSnapshot.modelId,
        prompt: action.prompt,
        ratio: action.parameters.ratio || '16:9',
        n: Math.max(1, Math.min(4, Number(action.parameters.count) || 1)),
        ...(inputPaths.length ? { images: inputPaths.filter((item) => item.kind === 'image').map((item) => item.source) } : {}),
      }, apiKey, { baseUrl });
    }
    const imageSources = inputPaths.filter((item) => item.kind === 'image').map((item) => item.source);
    return this.provider.submitTask({
      model: action.modelSnapshot.modelId,
      mode: imageSources.length ? 'frame' : 'text',
      prompt: action.prompt,
      seconds: action.parameters.duration || 6,
      duration: action.parameters.duration || 6,
      resolution: action.parameters.resolution || '720p',
      aspect_ratio: action.parameters.ratio || '16:9',
      ratio: action.parameters.ratio || '16:9',
      nsfw_check: false,
      ...(imageSources.length ? { images: imageSources.slice(0, 1) } : {}),
    }, apiKey, { baseUrl });
  }

  async poll(action, taskId, apiKey, settings) {
    const baseUrl = bounded(settings.zhenzhenSd2BaseUrl, 2_000) || undefined;
    const deadline = Date.now() + this.timeoutMs;
    let pollCount = 0;
    while (Date.now() < deadline) {
      const result = action.type === 'image'
        ? await this.provider.queryImageTask(taskId, apiKey, { baseUrl })
        : await this.provider.queryTask(taskId, apiKey, { baseUrl });
      pollCount += 1;
      if (result.status === 'failed') throw new CreatorActionExecutorError('CREATOR_PROVIDER_TASK_FAILED', bounded(result.failReason, 500) || '生成任务失败');
      if (result.status === 'succeeded') {
        const urls = action.type === 'image'
          ? [...new Set([...(Array.isArray(result.imageUrls) ? result.imageUrls : []), result.imageUrl].map((url) => bounded(url, 4_000)).filter(Boolean))].slice(0, 4)
          : [bounded(result.videoUrl, 4_000)].filter(Boolean);
        if (!urls.length) throw new CreatorActionExecutorError('CREATOR_PROVIDER_RESULT_MISSING', '生成任务完成但没有返回结果');
        return { url: urls[0], urls, pollCount, result };
      }
      await sleep(this.pollIntervalMs);
    }
    throw new CreatorActionExecutorError('CREATOR_PROVIDER_TIMEOUT', '生成时间较长，任务仍会由运行中心继续恢复', 504);
  }

  async execute(sessionId, actionId, scope) {
    let action = this.repository.getAction(actionId, sessionId, scope);
    const snapshot = action.modelSnapshot;
    if (snapshot.catalogDigest !== creativeModelCatalog.sourceDigest || !exactCatalogModel(snapshot)) {
      this.repository.updateAction(actionId, sessionId, { status: 'failed', errorCode: 'CREATOR_MODEL_SNAPSHOT_STALE', errorMessage: '这个模型暂时不可用，请重新选择' }, scope);
      return;
    }
    const settings = this.settingsProvider() || {};
    const apiKey = bounded(settings.zhenzhenSd2ApiKey, 4_000);
    if (snapshot.providerId !== 'seedance-nz' || !apiKey) {
      this.repository.updateAction(actionId, sessionId, { status: 'failed', errorCode: 'CREATOR_PROVIDER_NOT_READY', errorMessage: '请先在 API 设置中配置所选渠道' }, scope);
      return;
    }
    const document = this.database.getCanvas(scope.canvasId);
    if (!document || String(document.projectId || '') !== String(scope.projectId || '')) {
      this.repository.updateAction(actionId, sessionId, { status: 'failed', errorCode: 'CREATOR_SCOPE_NOT_FOUND', errorMessage: '当前画布不存在' }, scope);
      return;
    }
    const intent = this.database.createRunIntent({
      projectId: scope.projectId,
      canvasId: scope.canvasId,
      canvasRevision: document.revision,
      nodeIds: [],
      idempotencyKey: `creator-action:${actionId}`,
      requestedBy: 'creator-agent-v2',
      provider: snapshot.providerId,
      model: snapshot.modelId,
      estimatedCost: null,
      estimatedCostKnown: false,
      executionAuthority: { schema: 't8-creator-detached-run-authority-v1', actionId },
      confirmationRequired: false,
    });
    let run = null;
    let nodeRun = null;
    let attempt = null;
    let pollCount = 0;
    try {
      const leased = this.database.leaseRunIntentForDispatch({
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        requestedBy: 'creator-agent-v2',
        expectedIntentId: intent.id,
      }, {
        workerId: 'creator-agent-v2-worker',
        actorId: 'local-owner',
        sessionId: `creator-agent:${sessionId}`,
        leaseDurationMs: 60_000,
      });
      if (!leased) throw new CreatorActionExecutorError('CREATOR_RUN_QUEUE_BUSY', '当前画布已有生成任务，请稍后重试', 409);
      run = this.database.createRun({
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        canvasRevision: document.revision,
        initiatorId: 'creator-agent-v2',
        status: 'running',
        startedAt: Date.now(),
        summary: { source: 'creator-agent-v2', actionId, outputAssetIds: [] },
      });
      this.database.claimRunIntent(intent.id, run, {
        expectedQueueRevision: leased.intent.queueRevision,
        leaseOwner: 'creator-agent-v2-worker',
        leaseToken: leased.leaseToken,
        actorId: 'local-owner',
        sessionId: `creator-agent:${sessionId}`,
      });
      nodeRun = this.database.createNodeRun({
        runId: run.id,
        nodeId: `creator-detached-${actionId}`,
        originalNodeId: null,
        status: 'running',
        inputSnapshot: { schema: 't8-creator-detached-input-v1', actionId, type: action.type, prompt: action.prompt },
      });
      attempt = this.database.createAttempt({
        nodeRunId: nodeRun.id,
        provider: snapshot.providerId,
        model: snapshot.modelId,
        status: 'running',
        timestamps: { queuedAt: Date.now(), startedAt: Date.now() },
        metadata: { source: 'creator-agent-v2' },
      });
      action = this.repository.updateAction(actionId, sessionId, { status: 'running', runIntentId: intent.id, runId: run.id }, scope);
      const submitted = await this.submit(action, apiKey, settings, this.inputPaths(action, scope));
      this.database.updateAttempt(attempt.id, {
        upstreamTaskId: submitted.taskId,
        requestId: submitted.requestId || null,
        httpStatus: submitted.httpStatus || null,
        status: 'polling',
        timestamps: { submittedAt: Date.now() },
        metadata: {
          taskType: submitted.taskType || action.type,
          recovery: {
            version: 1,
            kind: action.type === 'image' ? 'image' : 'video',
            taskId: submitted.taskId,
            model: snapshot.modelId,
            taskProvider: 'seedance-nz',
            pollIntervalMs: this.pollIntervalMs,
            maxPolls: 1200,
          },
          creatorAgentV2: {
            version: 1,
            actionId,
            sessionId,
            projectId: scope.projectId,
            canvasId: scope.canvasId,
          },
        },
      }, { runId: run.id, nodeRunId: nodeRun.id });
      const completed = await this.poll(action, submitted.taskId, apiKey, settings);
      pollCount = completed.pollCount;
      const downloaded = await this.downloadResults(completed.urls || completed.url, action.type, actionId);
      const recorded = await this.assetIndexer.recordRunOutputAssets({
        runId: run.id,
        nodeRunId: nodeRun.id,
        attemptId: attempt.id,
        outputs: downloaded.map((item, index) => ({
          kind: action.type,
          sourceUrl: `/files/output/${encodeURIComponent(item.filename)}`,
          filename: item.filename,
          mimeType: item.mimeType,
          metadata: { operation: `creator-agent-${action.type}`, actionId, outputIndex: index },
        })),
      });
      const resultAssets = (recorded.assets || []).map(publicAssetRef);
      if (!resultAssets.length) throw new CreatorActionExecutorError('CREATOR_ASSET_RECORD_FAILED', '生成结果没有形成项目素材');
      this.database.updateAttempt(attempt.id, {
        status: 'succeeded',
        pollCount,
        timestamps: { downloadedAt: Date.now(), finishedAt: Date.now() },
        metadata: { outputAssetIds: resultAssets.map((item) => item.assetId) },
        error: null,
      }, { runId: run.id, nodeRunId: nodeRun.id });
      this.database.updateNodeRun(nodeRun.id, { status: 'succeeded' });
      this.database.updateRun(run.id, { status: 'succeeded', finishedAt: Date.now(), summary: { source: 'creator-agent-v2', actionId, outputAssetIds: resultAssets.map((item) => item.assetId), succeededNodes: 1, failedNodes: 0 } });
      this.database.finishRunIntentForRun(run.id, 'succeeded', null, { actorId: 'local-owner', sessionId: `creator-agent:${sessionId}` });
      this.repository.updateAction(actionId, sessionId, {
        status: 'completed', runIntentId: intent.id, runId: run.id, resultAssets,
        conversationPhase: 'candidates',
      }, scope);
    } catch (error) {
      const recoverable = isRecoverableContinuationError(error);
      if (attempt) {
        try {
          this.database.updateAttempt(attempt.id, {
            status: recoverable ? 'polling' : 'failed',
            pollCount,
            timestamps: recoverable ? { lastPolledAt: Date.now() } : { finishedAt: Date.now() },
            error: { kind: 'provider', code: bounded(error?.code, 120) || 'CREATOR_ACTION_FAILED', message: bounded(error?.message, 500) || '生成失败', retryable: true },
          }, { runId: run.id, nodeRunId: nodeRun.id });
        } catch (_) {}
      }
      if (!recoverable && nodeRun) try { this.database.updateNodeRun(nodeRun.id, { status: 'failed' }); } catch (_) {}
      if (!recoverable && run) {
        try { this.database.updateRun(run.id, { status: 'failed', finishedAt: Date.now(), summary: { source: 'creator-agent-v2', actionId, failedNodes: 1 } }); } catch (_) {}
        try { this.database.finishRunIntentForRun(run.id, 'failed', null, { actorId: 'local-owner', sessionId: `creator-agent:${sessionId}` }); } catch (_) {}
      }
      this.repository.updateAction(actionId, sessionId, {
        status: recoverable ? 'ambiguous' : 'failed',
        runIntentId: intent.id,
        runId: run?.id || null,
        errorCode: bounded(error?.code, 120) || 'CREATOR_ACTION_FAILED',
        errorMessage: recoverable ? null : (bounded(error?.message, 500) || '生成失败，请重试'),
      }, scope);
    }
  }
}

module.exports = {
  CreatorActionExecutor,
  CreatorActionExecutorError,
  mimeAndExtension,
};
