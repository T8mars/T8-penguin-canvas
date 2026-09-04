'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { AssetIndexer } = require('./assetIndexer');
const { currentSceneSourcePart } = require('./creatorLongScriptWork');
const { readSceneProduction } = require('./creatorSceneProduction');
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
    'CREATOR_ACTION_PROCESS_INTERRUPTED',
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

function shotAssetRef(asset, shot, outputIndex) {
  return {
    ...publicAssetRef(asset),
    shotId: shot.shotId,
    shotOrdinal: shot.ordinal,
    outputIndex,
  };
}

function shotAction(action, shot) {
  return {
    ...action,
    prompt: shot.prompt,
    parameters: shot.parameters,
    inputAssetIds: shot.inputAssetIds,
  };
}

function flattenedShotAssets(shots) {
  const byId = new Map();
  (Array.isArray(shots) ? shots : []).forEach((shot) => {
    (Array.isArray(shot.resultAssets) ? shot.resultAssets : []).forEach((asset) => {
      if (asset?.assetId) byId.set(String(asset.assetId), asset);
    });
  });
  return [...byId.values()];
}

function sameStringList(left, right) {
  const a = Array.isArray(left) ? left.map(String) : [];
  const b = Array.isArray(right) ? right.map(String) : [];
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function exactCatalogModel(snapshot) {
  return (Array.isArray(creativeModelCatalog[snapshot.kind]) ? creativeModelCatalog[snapshot.kind] : []).find((item) => (
    item.provider === snapshot.providerId && item.model === snapshot.modelId && item.available !== false
  )) || null;
}

function groupedInputPaths(inputPaths) {
  const grouped = { images: [], videos: [], audios: [] };
  for (const item of Array.isArray(inputPaths) ? inputPaths : []) {
    const kind = String(item?.kind || '').trim().toLowerCase();
    const source = String(item?.source || '').trim();
    if (!source) continue;
    if (kind === 'image') grouped.images.push(source);
    else if (kind === 'video') grouped.videos.push(source);
    else if (kind === 'audio') grouped.audios.push(source);
    else throw new CreatorActionExecutorError('CREATOR_INPUT_ASSET_KIND_UNSUPPORTED', '这个参考素材类型暂时不能用于生成', 409);
  }
  return grouped;
}

function referenceCountLabel(kind, count) {
  if (kind === 'images') return `${count} 张图片`;
  if (kind === 'videos') return `${count} 个视频`;
  return `${count} 段音频`;
}

function preflightActionReferences(action, modelEntry, inputPaths) {
  const grouped = groupedInputPaths(inputPaths);
  const parameters = modelEntry?.parameters && typeof modelEntry.parameters === 'object'
    ? modelEntry.parameters : {};
  const lost = [];
  const over = [];
  const specs = [
    ['images', 'supportsImages', 'maxReferenceImages'],
    ['videos', 'supportsVideos', 'maxReferenceVideos'],
    ['audios', 'supportsAudios', 'maxReferenceAudios'],
  ];

  for (const [kind, supportField, maximumField] of specs) {
    const count = grouped[kind].length;
    if (!count) continue;
    // Image generation in Creator currently has no video/audio compiler.  Fail
    // closed instead of filtering those inputs out of the Provider request.
    const unsupportedByAction = action?.type === 'image' && kind !== 'images';
    const hasExplicitSupport = Object.prototype.hasOwnProperty.call(parameters, supportField);
    if (unsupportedByAction || (hasExplicitSupport && parameters[supportField] !== true)) {
      lost.push(referenceCountLabel(kind, count));
      continue;
    }
    const maximum = Number(parameters[maximumField]);
    if (Number.isFinite(maximum) && maximum >= 0 && count > maximum) {
      over.push(`${referenceCountLabel(kind, count)}（最多 ${maximum}）`);
    }
  }

  if (lost.length || over.length) {
    const details = [
      lost.length ? `会丢失 ${lost.join('、')}` : '',
      over.length ? `超出限制：${over.join('、')}` : '',
    ].filter(Boolean).join('；');
    throw new CreatorActionExecutorError(
      'CREATOR_MODEL_REFERENCE_LOSS',
      `所选模型无法完整保留当前参考素材（${details}），已停止生成。请换用支持这些素材的模型。`,
      409,
    );
  }
  return grouped;
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
    this.faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null;
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

  _injectFault(point, context = {}) {
    if (!this.faultInjector) return;
    try {
      this.faultInjector(point, context);
    } catch (error) {
      // Fault injection models a process disappearing between durable steps.
      // Once an upstream task id exists, recovery must continue that task rather
      // than classify the interruption as a provider failure and submit again.
      if (error && typeof error === 'object' && !error.code) {
        error.code = 'CREATOR_ACTION_PROCESS_INTERRUPTED';
      }
      throw error;
    }
  }

  async _recordOutputAssets(input) {
    try {
      return await this.assetIndexer.recordRunOutputAssets(input);
    } catch (error) {
      if (error instanceof CreatorActionExecutorError) throw error;
      const wrapped = new CreatorActionExecutorError(
        'CREATOR_ASSET_RECORD_FAILED',
        '生成结果已下载，但暂时没能保存为项目素材，将继续恢复原任务。',
      );
      wrapped.cause = error;
      throw wrapped;
    }
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
    if (action.status === 'ambiguous' && action.errorCode === 'CREATOR_SUBMISSION_STATUS_UNKNOWN') return action;
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
    if (action.status !== 'ambiguous' || action.errorCode === 'CREATOR_SUBMISSION_STATUS_UNKNOWN') return;
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
    if (Array.isArray(action.shots) && action.shots.length) {
      // Shot status is the authoritative per-output ledger. A successful Run
      // summary alone must never erase a failed or ambiguous sibling shot.
      const completed = action.shots.every((shot) => shot.status === 'completed');
      if (completed && action.status !== 'completed') {
        return this.repository.updateAction(actionId, sessionId, {
          status: 'completed', shots: action.shots,
          resultAssets: flattenedShotAssets(action.shots),
          errorCode: null, errorMessage: null, conversationPhase: 'candidates',
        }, scope);
      }
      return action;
    }
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

  _shotNodeRun(runId, actionId, shotId) {
    if (typeof this.database.listNodeRuns !== 'function') return null;
    return this.database.listNodeRuns(runId).find((item) => (
      item.inputSnapshot?.actionId === actionId && item.inputSnapshot?.shotId === shotId
    )) || null;
  }

  _latestShotAttempt(nodeRun) {
    if (!nodeRun || typeof this.database.listAttempts !== 'function') return null;
    return this.database.listAttempts(nodeRun.id).at(-1) || null;
  }

  _updateShotAction(action, shotId, shotPatch, actionPatch, scope) {
    const shots = action.shots.map((shot) => shot.shotId === shotId ? { ...shot, ...shotPatch } : shot);
    return this.repository.updateAction(action.id, action.sessionId, {
      ...actionPatch,
      shots,
      resultAssets: flattenedShotAssets(shots),
    }, scope);
  }

  async _recordShotResults({ action, shot, run, nodeRun, attempt, completed, recovered = false }) {
    const downloaded = await this.downloadResults(
      completed.urls || completed.url,
      action.type,
      `${action.id}-${shot.shotId}`,
    );
    this._injectFault('media-downloaded', {
      actionId: action.id, shotId: shot.shotId, outputCount: downloaded.length,
    });
    const recorded = await this._recordOutputAssets({
      runId: run.id,
      nodeRunId: nodeRun.id,
      attemptId: attempt.id,
      outputs: downloaded.map((item, index) => ({
        kind: action.type,
        sourceUrl: `/files/output/${encodeURIComponent(item.filename)}`,
        filename: item.filename,
        mimeType: item.mimeType,
        metadata: {
          operation: `creator-agent-${action.type}`,
          actionId: action.id,
          shotId: shot.shotId,
          shotOrdinal: shot.ordinal,
          outputIndex: index,
          recovered,
          workBinding: action.workBinding || null,
        },
      })),
    });
    const resultAssets = (recorded.assets || []).map((asset, index) => shotAssetRef(asset, shot, index));
    if (!resultAssets.length) {
      throw new CreatorActionExecutorError('CREATOR_ASSET_RECORD_FAILED', '生成结果没有形成项目素材');
    }
    return resultAssets;
  }

  _finishShotAttempt(run, nodeRun, attempt, resultAssets, pollCount) {
    this.database.updateAttempt(attempt.id, {
      status: 'succeeded',
      pollCount,
      timestamps: { downloadedAt: Date.now(), finishedAt: Date.now() },
      metadata: {
        ...(attempt.metadata && typeof attempt.metadata === 'object' ? attempt.metadata : {}),
        outputAssetIds: resultAssets.map((item) => item.assetId),
      },
      error: null,
    }, { runId: run.id, nodeRunId: nodeRun.id });
    this.database.updateNodeRun(nodeRun.id, { status: 'succeeded' });
  }

  _markShotFailure(action, shot, run, nodeRun, attempt, error, pollCount, scope) {
    const code = bounded(error?.code, 120) || 'CREATOR_SHOT_FAILED';
    const message = bounded(error?.message, 500) || '这个镜头生成失败';
    if (attempt) {
      try {
        this.database.updateAttempt(attempt.id, {
          status: 'failed', pollCount,
          timestamps: { finishedAt: Date.now() },
          error: { kind: 'provider', code, message, retryable: true },
        }, { runId: run.id, nodeRunId: nodeRun?.id });
      } catch (_) {}
    }
    if (nodeRun) {
      try { this.database.updateNodeRun(nodeRun.id, { status: 'failed' }); } catch (_) {}
    }
    return this._updateShotAction(action, shot.shotId, {
      status: 'failed',
      runId: run.id,
      nodeRunId: nodeRun?.id || shot.nodeRunId || null,
      attemptId: attempt?.id || shot.attemptId || null,
      errorCode: code,
      errorMessage: message,
    }, { status: 'running', errorCode: null, errorMessage: null }, scope);
  }

  _markShotAmbiguous(action, shot, run, nodeRun, attempt, error, pollCount, unknownSubmission, scope) {
    const code = unknownSubmission
      ? 'CREATOR_SUBMISSION_STATUS_UNKNOWN'
      : bounded(error?.code, 120) || 'CREATOR_ACTION_CONTINUATION_PENDING';
    const message = unknownSubmission
      ? '远端可能已经收到这个镜头，但本地没有拿到任务号。为避免重复提交，已停止自动重试。'
      : null;
    if (attempt) {
      try {
        this.database.updateAttempt(attempt.id, {
          status: 'polling', pollCount,
          timestamps: { lastPolledAt: Date.now() },
          error: {
            kind: 'provider', code,
            message: unknownSubmission ? '远端提交结果不确定，已停止自动重提' : bounded(error?.message, 500),
            retryable: !unknownSubmission,
          },
        }, { runId: run.id, nodeRunId: nodeRun?.id });
      } catch (_) {}
    }
    return this._updateShotAction(action, shot.shotId, {
      status: 'ambiguous',
      runId: run.id,
      nodeRunId: nodeRun?.id || shot.nodeRunId || null,
      attemptId: attempt?.id || shot.attemptId || null,
      errorCode: code,
      errorMessage: message,
    }, {
      status: 'ambiguous',
      runIntentId: action.runIntentId,
      runId: run.id,
      errorCode: code,
      errorMessage: message,
    }, scope);
  }

  async _executePendingShot(action, shot, run, apiKey, settings, modelEntry, scope) {
    let nodeRun = null;
    let attempt = null;
    let pollCount = 0;
    let submissionStarted = false;
    let submissionPersisted = false;
    try {
      const scopedAction = shotAction(action, shot);
      const preparedInputPaths = this.inputPaths(scopedAction, scope);
      preflightActionReferences(scopedAction, modelEntry, preparedInputPaths);
      nodeRun = this.database.createNodeRun({
        runId: run.id,
        nodeId: `creator-detached-${action.id}-${shot.shotId}`,
        originalNodeId: null,
        status: 'running',
        inputSnapshot: {
          schema: 't8-creator-detached-shot-input-v1',
          actionId: action.id,
          shotId: shot.shotId,
          shotOrdinal: shot.ordinal,
          type: action.type,
          prompt: shot.prompt,
          parameters: shot.parameters,
          inputAssetIds: shot.inputAssetIds,
          workBinding: action.workBinding || null,
        },
      });
      attempt = this.database.createAttempt({
        nodeRunId: nodeRun.id,
        provider: action.modelSnapshot.providerId,
        model: action.modelSnapshot.modelId,
        status: 'running',
        timestamps: { queuedAt: Date.now(), startedAt: Date.now() },
        metadata: {
          source: 'creator-agent-v2',
          shotId: shot.shotId,
          shotOrdinal: shot.ordinal,
          workBinding: action.workBinding || null,
        },
      });
      action = this._updateShotAction(action, shot.shotId, {
        status: 'running', runId: run.id, nodeRunId: nodeRun.id, attemptId: attempt.id,
        errorCode: null, errorMessage: null,
      }, { status: 'running', runId: run.id, errorCode: null, errorMessage: null }, scope);
      const currentShot = action.shots.find((item) => item.shotId === shot.shotId);
      submissionStarted = true;
      const submitted = await this.submit(shotAction(action, currentShot), apiKey, settings, preparedInputPaths, modelEntry);
      this._injectFault('provider-submitted', {
        actionId: action.id, shotId: shot.shotId, taskId: submitted.taskId,
      });
      this.database.updateAttempt(attempt.id, {
        upstreamTaskId: submitted.taskId,
        requestId: submitted.requestId || null,
        httpStatus: submitted.httpStatus || null,
        status: 'polling',
        timestamps: { submittedAt: Date.now() },
        metadata: {
          source: 'creator-agent-v2',
          shotId: shot.shotId,
          shotOrdinal: shot.ordinal,
          taskType: submitted.taskType || action.type,
          recovery: {
            version: 1,
            kind: action.type === 'image' ? 'image' : 'video',
            taskId: submitted.taskId,
            model: action.modelSnapshot.modelId,
            taskProvider: 'seedance-nz',
            pollIntervalMs: this.pollIntervalMs,
            maxPolls: 1200,
          },
          creatorAgentV2: {
            version: 1, actionId: action.id, shotId: shot.shotId,
            sessionId: action.sessionId, projectId: scope.projectId, canvasId: scope.canvasId,
            workBinding: action.workBinding || null,
          },
        },
      }, { runId: run.id, nodeRunId: nodeRun.id });
      submissionPersisted = true;
      this._injectFault('provider-task-id-persisted', {
        actionId: action.id, shotId: shot.shotId, taskId: submitted.taskId,
      });
      const completed = await this.poll(shotAction(action, currentShot), submitted.taskId, apiKey, settings);
      pollCount = completed.pollCount;
      const resultAssets = await this._recordShotResults({
        action, shot: currentShot, run, nodeRun, attempt, completed,
      });
      this._finishShotAttempt(run, nodeRun, attempt, resultAssets, pollCount);
      action = this._updateShotAction(action, shot.shotId, {
        status: 'completed', resultAssets, runId: run.id,
        nodeRunId: nodeRun.id, attemptId: attempt.id,
        errorCode: null, errorMessage: null,
      }, { status: 'running', runId: run.id, errorCode: null, errorMessage: null }, scope);
      return { action, terminal: null };
    } catch (error) {
      const uncertainSubmission = submissionStarted && !submissionPersisted
        && !(Number(error?.status || error?.upstreamHttpStatus) >= 400
          && Number(error?.status || error?.upstreamHttpStatus) < 500);
      if (uncertainSubmission) {
        action = this._markShotAmbiguous(action, shot, run, nodeRun, attempt, error, pollCount, true, scope);
        return { action, terminal: 'ambiguous' };
      }
      if (isRecoverableContinuationError(error) && submissionPersisted) {
        action = this._markShotAmbiguous(action, shot, run, nodeRun, attempt, error, pollCount, false, scope);
        return { action, terminal: 'ambiguous' };
      }
      action = this._markShotFailure(action, shot, run, nodeRun, attempt, error, pollCount, scope);
      return { action, terminal: 'failed' };
    }
  }

  async _resumeAmbiguousShot(action, shot, run, apiKey, settings, scope) {
    const nodeRun = this._shotNodeRun(run.id, action.id, shot.shotId);
    const attempt = this._latestShotAttempt(nodeRun);
    if (!nodeRun || !attempt?.upstreamTaskId) {
      action = this._markShotAmbiguous(
        action, shot, run, nodeRun, attempt,
        new CreatorActionExecutorError('CREATOR_SUBMISSION_STATUS_UNKNOWN', '缺少可恢复任务号'),
        attempt?.pollCount || 0, true, scope,
      );
      return { action, terminal: 'ambiguous' };
    }
    let pollCount = attempt.pollCount || 0;
    try {
      const scopedAction = shotAction(action, shot);
      const completed = await this.poll(scopedAction, attempt.upstreamTaskId, apiKey, settings);
      pollCount += completed.pollCount;
      const resultAssets = await this._recordShotResults({
        action, shot, run, nodeRun, attempt, completed, recovered: true,
      });
      this._finishShotAttempt(run, nodeRun, attempt, resultAssets, pollCount);
      action = this._updateShotAction(action, shot.shotId, {
        status: 'completed', resultAssets, runId: run.id,
        nodeRunId: nodeRun.id, attemptId: attempt.id,
        errorCode: null, errorMessage: null,
      }, { status: 'running', runId: run.id, errorCode: null, errorMessage: null }, scope);
      return { action, terminal: null };
    } catch (error) {
      if (isRecoverableContinuationError(error)) {
        action = this._markShotAmbiguous(action, shot, run, nodeRun, attempt, error, pollCount, false, scope);
        return { action, terminal: 'ambiguous' };
      }
      action = this._markShotFailure(action, shot, run, nodeRun, attempt, error, pollCount, scope);
      return { action, terminal: 'failed' };
    }
  }

  _finishShotBatch(action, run, scope) {
    const shots = action.shots;
    const resultAssets = flattenedShotAssets(shots);
    const completedCount = shots.filter((shot) => shot.status === 'completed').length;
    const failedCount = shots.filter((shot) => shot.status === 'failed').length;
    const ambiguous = shots.find((shot) => shot.status === 'ambiguous');
    if (ambiguous) {
      const unknown = ambiguous.errorCode === 'CREATOR_SUBMISSION_STATUS_UNKNOWN';
      return this.repository.updateAction(action.id, action.sessionId, {
        status: 'ambiguous', shots, resultAssets,
        errorCode: unknown ? 'CREATOR_SUBMISSION_STATUS_UNKNOWN' : ambiguous.errorCode,
        errorMessage: unknown ? ambiguous.errorMessage : null,
      }, scope);
    }
    if (failedCount) {
      const summary = {
        source: 'creator-agent-v2', actionId: action.id,
        workBinding: action.workBinding || null,
        outputAssetIds: resultAssets.map((item) => item.assetId),
        succeededNodes: completedCount,
        failedNodes: failedCount,
        shotCount: shots.length,
      };
      try { this.database.updateRun(run.id, { status: 'failed', finishedAt: Date.now(), summary }); } catch (_) {}
      try {
        this.database.finishRunIntentForRun(run.id, 'failed', null, {
          actorId: 'local-owner', sessionId: `creator-agent:${action.sessionId}`,
        });
      } catch (_) {}
      return this.repository.updateAction(action.id, action.sessionId, {
        status: 'failed', shots, resultAssets,
        errorCode: 'CREATOR_SHOT_BATCH_PARTIAL_FAILURE',
        errorMessage: shots.length === 1
          ? '这个镜头生成失败，可以单独重试。'
          : `${shots.length} 个镜头中 ${failedCount} 个失败；已保留 ${completedCount} 个成功结果，重试只会生成失败镜头。`,
      }, scope);
    }
    if (completedCount === shots.length && shots.length) {
      const summary = {
        source: 'creator-agent-v2', actionId: action.id,
        workBinding: action.workBinding || null,
        outputAssetIds: resultAssets.map((item) => item.assetId),
        succeededNodes: completedCount, failedNodes: 0, shotCount: shots.length,
      };
      this.database.updateRun(run.id, { status: 'succeeded', finishedAt: Date.now(), summary });
      this.database.finishRunIntentForRun(run.id, 'succeeded', null, {
        actorId: 'local-owner', sessionId: `creator-agent:${action.sessionId}`,
      });
      return this.repository.updateAction(action.id, action.sessionId, {
        status: 'completed', shots, resultAssets, errorCode: null, errorMessage: null,
        conversationPhase: 'candidates',
      }, scope);
    }
    return this.repository.updateAction(action.id, action.sessionId, {
      status: 'failed', shots, resultAssets,
      errorCode: 'CREATOR_SHOT_BATCH_INCOMPLETE',
      errorMessage: '镜头任务没有完整结束，请重试失败镜头。',
    }, scope);
  }

  async _processShotBatch(action, run, apiKey, settings, modelEntry, scope) {
    for (const originalShot of action.shots) {
      const shot = action.shots.find((item) => item.shotId === originalShot.shotId);
      if (!shot || shot.status === 'completed' || shot.status === 'cancelled') continue;
      let outcome;
      if (shot.status === 'ambiguous' || shot.status === 'running') {
        outcome = await this._resumeAmbiguousShot(action, shot, run, apiKey, settings, scope);
      } else {
        outcome = await this._executePendingShot(action, shot, run, apiKey, settings, modelEntry, scope);
      }
      action = outcome.action;
      if (outcome.terminal === 'ambiguous') return this._finishShotBatch(action, run, scope);
      // A definitive failure is isolated to this shot. Continue so the user
      // still receives every other requested result from this batch.
    }
    return this._finishShotBatch(action, run, scope);
  }

  async _resumeShotBatch(action, settings, apiKey, scope) {
    const run = action.runId ? this.database.getRun(action.runId) : null;
    if (!run) {
      this.repository.updateAction(action.id, action.sessionId, {
        status: 'failed', shots: action.shots,
        errorCode: 'CREATOR_RECOVERY_EVIDENCE_MISSING',
        errorMessage: '镜头任务缺少可恢复运行记录，请重试失败镜头。',
      }, scope);
      return;
    }
    const modelEntry = exactCatalogModel(action.modelSnapshot);
    await this._processShotBatch(action, run, apiKey, settings, modelEntry, scope);
  }

  async _startShotBatch(action, document, settings, apiKey, modelEntry, scope) {
    const workBinding = action.workBinding || null;
    const intent = this.database.createRunIntent({
      projectId: scope.projectId,
      canvasId: scope.canvasId,
      canvasRevision: document.revision,
      nodeIds: [],
      idempotencyKey: `creator-action:${action.id}`,
      requestedBy: 'creator-agent-v2',
      provider: action.modelSnapshot.providerId,
      model: action.modelSnapshot.modelId,
      estimatedCost: null,
      estimatedCostKnown: false,
      executionAuthority: {
        schema: 't8-creator-detached-run-authority-v1',
        actionId: action.id,
        workBinding,
        shotIds: action.shots.map((shot) => shot.shotId),
      },
      confirmationRequired: false,
    });
    let run = null;
    try {
      const leased = this.database.leaseRunIntentForDispatch({
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        requestedBy: 'creator-agent-v2',
        expectedIntentId: intent.id,
      }, {
        workerId: 'creator-agent-v2-worker',
        actorId: 'local-owner',
        sessionId: `creator-agent:${action.sessionId}`,
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
        summary: {
          source: 'creator-agent-v2', actionId: action.id, workBinding,
          shotIds: action.shots.map((shot) => shot.shotId),
          outputAssetIds: flattenedShotAssets(action.shots).map((item) => item.assetId),
        },
      });
      this.database.claimRunIntent(intent.id, run, {
        expectedQueueRevision: leased.intent.queueRevision,
        leaseOwner: 'creator-agent-v2-worker',
        leaseToken: leased.leaseToken,
        actorId: 'local-owner',
        sessionId: `creator-agent:${action.sessionId}`,
      });
      action = this.repository.updateAction(action.id, action.sessionId, {
        status: 'running', runIntentId: intent.id, runId: run.id,
        shots: action.shots, resultAssets: flattenedShotAssets(action.shots),
        errorCode: null, errorMessage: null,
      }, scope);
      await this._processShotBatch(action, run, apiKey, settings, modelEntry, scope);
    } catch (error) {
      if (run) {
        try {
          this.database.updateRun(run.id, {
            status: 'failed', finishedAt: Date.now(),
            summary: {
              source: 'creator-agent-v2', actionId: action.id,
              failedNodes: action.shots.filter((shot) => shot.status === 'failed').length,
              error: { code: bounded(error?.code, 120), message: bounded(error?.message, 500) },
            },
          });
        } catch (_) {}
        try {
          this.database.finishRunIntentForRun(run.id, 'failed', null, {
            actorId: 'local-owner', sessionId: `creator-agent:${action.sessionId}`,
          });
        } catch (_) {}
      }
      this.repository.updateAction(action.id, action.sessionId, {
        status: 'failed', runIntentId: intent.id, runId: run?.id || null,
        shots: action.shots, resultAssets: flattenedShotAssets(action.shots),
        errorCode: bounded(error?.code, 120) || 'CREATOR_SHOT_BATCH_START_FAILED',
        errorMessage: bounded(error?.message, 500) || '镜头任务未能启动，请重试。',
      }, scope);
    }
  }

  async resume(sessionId, actionId, scope) {
    const action = this.repository.getAction(actionId, sessionId, scope);
    const settings = this.settingsProvider() || {};
    const apiKey = bounded(settings.zhenzhenSd2ApiKey, 4_000);
    if (Array.isArray(action.shots) && action.shots.length) {
      if (!apiKey) {
        this.repository.updateAction(actionId, sessionId, {
          status: 'failed', shots: action.shots,
          errorCode: 'CREATOR_PROVIDER_NOT_READY', errorMessage: '请先在 API 设置中配置所选渠道',
        }, scope);
        return;
      }
      await this._resumeShotBatch(action, settings, apiKey, scope);
      return;
    }
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
      if (run && nodeRun && attempt && !attempt.upstreamTaskId) {
        this.repository.updateAction(actionId, sessionId, {
          status: 'ambiguous',
          errorCode: 'CREATOR_SUBMISSION_STATUS_UNKNOWN',
          errorMessage: '远端可能已经收到这次生成，但本地还没来得及保存任务号。为避免重复生成，不会自动重提；请先到渠道后台确认。',
        }, scope);
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
      const recorded = await this._recordOutputAssets({
        runId: run.id,
        nodeRunId: nodeRun.id,
        attemptId: attempt.id,
        outputs: downloaded.map((item, index) => ({
          kind: action.type,
          sourceUrl: `/files/output/${encodeURIComponent(item.filename)}`,
          filename: item.filename,
          mimeType: item.mimeType,
          metadata: {
            operation: `creator-agent-${action.type}`, actionId, outputIndex: index,
            recovered: true, workBinding: action.workBinding || null,
          },
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
      this.database.updateRun(run.id, { status: 'succeeded', finishedAt: Date.now(), summary: { source: 'creator-agent-v2', actionId, workBinding: action.workBinding || null, recoveredWithoutResubmit: true, outputAssetIds: resultAssets.map((item) => item.assetId), succeededNodes: 1, failedNodes: 0 } });
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

  async submit(action, apiKey, settings, inputPaths, modelEntry = exactCatalogModel(action.modelSnapshot)) {
    const baseUrl = bounded(settings.zhenzhenSd2BaseUrl, 2_000) || undefined;
    const grouped = preflightActionReferences(action, modelEntry, inputPaths);
    if (action.type === 'image') {
      return this.provider.submitImageTask({
        model: action.modelSnapshot.modelId,
        prompt: action.prompt,
        ratio: action.parameters.ratio || '16:9',
        n: Math.max(1, Math.min(4, Number(action.parameters.count) || 1)),
        ...(grouped.images.length ? { images: grouped.images } : {}),
      }, apiKey, { baseUrl });
    }
    const modelId = action.modelSnapshot.modelId;
    const parameters = modelEntry?.parameters && typeof modelEntry.parameters === 'object'
      ? modelEntry.parameters : {};
    const family = String(parameters.family || modelEntry?.family || '').trim().toLowerCase();
    const nodeKind = String(parameters.nodeKind || '').trim().toLowerCase();
    const common = {
      model: action.modelSnapshot.modelId,
      prompt: action.prompt,
      seconds: action.parameters.duration || 6,
      duration: action.parameters.duration || 6,
      resolution: action.parameters.resolution || '720p',
      aspect_ratio: action.parameters.ratio || '16:9',
      ratio: action.parameters.ratio || '16:9',
      nsfw_check: false,
    };

    if (family === 'seedance-2.5' || nodeKind === 'seedance25') {
      const request = { ...common };
      if (/-i2v$/iu.test(modelId)) {
        request.firstFrame = grouped.images[0] || '';
        request.lastFrame = grouped.images[1] || '';
      } else if (/-multi$/iu.test(modelId)) {
        request.refImages = grouped.images;
        request.videos = grouped.videos;
        request.audios = grouped.audios;
      }
      return this.provider.submitTask(request, apiKey, { baseUrl });
    }

    if (nodeKind === 'hailuo') {
      return this.provider.submitHailuoTask({
        ...common,
        images: grouped.images,
        videos: grouped.videos,
        audios: grouped.audios,
      }, apiKey, { baseUrl });
    }

    if (family === 'seedance-2.0') {
      const hasMultimodalInput = grouped.videos.length > 0 || grouped.audios.length > 0 || grouped.images.length > 2;
      return this.provider.submitTask({
        ...common,
        ...(hasMultimodalInput
          ? { refImages: grouped.images, videos: grouped.videos, audios: grouped.audios }
          : { firstFrame: grouped.images[0] || '', lastFrame: grouped.images[1] || '' }),
      }, apiKey, { baseUrl });
    }

    const specializedSubmitters = {
      wan: 'submitWanTask',
      kling: 'submitKlingTask',
      vidu: 'submitViduTask',
      happyhorse: 'submitHappyHorseTask',
    };
    const specializedMethod = specializedSubmitters[nodeKind];
    if (specializedMethod && typeof this.provider[specializedMethod] === 'function') {
      return this.provider[specializedMethod]({
        ...common,
        images: grouped.images,
        videos: grouped.videos,
        audios: grouped.audios,
      }, apiKey, { baseUrl });
    }

    const mode = grouped.videos.length
      ? 'reference_video'
      : grouped.images.length === 3 ? 'reference_images' : grouped.images.length ? 'frame' : 'text';
    return this.provider.submitTask({
      ...common,
      mode,
      images: grouped.images,
      videos: grouped.videos,
      audios: grouped.audios,
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
    const modelEntry = exactCatalogModel(snapshot);
    if (snapshot.catalogDigest !== creativeModelCatalog.sourceDigest || !modelEntry) {
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
    const workBinding = action.workBinding || null;
    if (workBinding) {
      let currentScene = null;
      let currentPart = null;
      let currentWorkId = null;
      let currentProduction = null;
      try {
        const workState = this.repository.getLongScriptContextState(sessionId, {
          ...scope,
          sceneId: workBinding.sceneId,
        });
        currentScene = workState.work?.activeScenes?.find((item) => item.sceneId === workBinding.sceneId) || null;
        currentPart = currentScene ? currentSceneSourcePart(workState.work, currentScene) : null;
        currentWorkId = workState.snapshot?.workId || null;
        currentProduction = readSceneProduction(workState.currentVersions, workBinding.sceneId);
      } catch (_) {}
      const stale = !currentScene
        || (workBinding.workId && currentWorkId !== workBinding.workId)
        || Math.max(1, Math.trunc(Number(currentScene?.recordRevision) || 1)) !== workBinding.sceneRevision
        || (workBinding.scenePartId && currentPart?.scenePartId !== workBinding.scenePartId)
        || (workBinding.shotPlanDigest && currentProduction?.planDigest !== workBinding.shotPlanDigest)
        || (workBinding.shotIds?.length
          && !sameStringList(workBinding.shotIds, currentProduction?.shots?.map((shot) => shot.shotId)));
      if (stale) {
        this.repository.updateAction(actionId, sessionId, {
          status: 'failed',
          errorCode: 'CREATOR_ACTION_SCENE_STALE',
          errorMessage: '这条生成对应的场次已经变化，已停止使用旧提示词。请回到当前场重新生成。',
        }, scope);
        return;
      }
    }
    if (Array.isArray(action.shots) && action.shots.length) {
      await this._startShotBatch(action, document, settings, apiKey, modelEntry, scope);
      return;
    }
    let preparedInputPaths;
    try {
      preparedInputPaths = this.inputPaths(action, scope);
      preflightActionReferences(action, modelEntry, preparedInputPaths);
    } catch (error) {
      this.repository.updateAction(actionId, sessionId, {
        status: 'failed',
        errorCode: bounded(error?.code, 120) || 'CREATOR_INPUT_PREFLIGHT_FAILED',
        errorMessage: bounded(error?.message, 500) || '参考素材与所选模型不兼容，请换一个模型',
      }, scope);
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
      executionAuthority: { schema: 't8-creator-detached-run-authority-v1', actionId, workBinding },
      confirmationRequired: false,
    });
    let run = null;
    let nodeRun = null;
    let attempt = null;
    let pollCount = 0;
    let submissionStarted = false;
    let submissionPersisted = false;
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
        summary: { source: 'creator-agent-v2', actionId, workBinding, outputAssetIds: [] },
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
        inputSnapshot: {
          schema: 't8-creator-detached-input-v1', actionId, type: action.type,
          prompt: action.prompt, workBinding,
        },
      });
      attempt = this.database.createAttempt({
        nodeRunId: nodeRun.id,
        provider: snapshot.providerId,
        model: snapshot.modelId,
        status: 'running',
        timestamps: { queuedAt: Date.now(), startedAt: Date.now() },
        metadata: { source: 'creator-agent-v2', workBinding },
      });
      action = this.repository.updateAction(actionId, sessionId, { status: 'running', runIntentId: intent.id, runId: run.id }, scope);
      submissionStarted = true;
      const submitted = await this.submit(action, apiKey, settings, preparedInputPaths, modelEntry);
      this._injectFault('provider-submitted', { actionId, taskId: submitted.taskId });
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
            workBinding,
          },
        },
      }, { runId: run.id, nodeRunId: nodeRun.id });
      submissionPersisted = true;
      this._injectFault('provider-task-id-persisted', { actionId, taskId: submitted.taskId });
      const completed = await this.poll(action, submitted.taskId, apiKey, settings);
      pollCount = completed.pollCount;
      const downloaded = await this.downloadResults(completed.urls || completed.url, action.type, actionId);
      this._injectFault('media-downloaded', { actionId, outputCount: downloaded.length });
      const recorded = await this._recordOutputAssets({
        runId: run.id,
        nodeRunId: nodeRun.id,
        attemptId: attempt.id,
        outputs: downloaded.map((item, index) => ({
          kind: action.type,
          sourceUrl: `/files/output/${encodeURIComponent(item.filename)}`,
          filename: item.filename,
          mimeType: item.mimeType,
          metadata: {
            operation: `creator-agent-${action.type}`, actionId, outputIndex: index, workBinding,
          },
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
      this.database.updateRun(run.id, { status: 'succeeded', finishedAt: Date.now(), summary: { source: 'creator-agent-v2', actionId, workBinding, outputAssetIds: resultAssets.map((item) => item.assetId), succeededNodes: 1, failedNodes: 0 } });
      this.database.finishRunIntentForRun(run.id, 'succeeded', null, { actorId: 'local-owner', sessionId: `creator-agent:${sessionId}` });
      this.repository.updateAction(actionId, sessionId, {
        status: 'completed', runIntentId: intent.id, runId: run.id, resultAssets,
        conversationPhase: 'candidates',
      }, scope);
    } catch (error) {
      const uncertainSubmission = submissionStarted && !submissionPersisted
        && !(Number(error?.status || error?.upstreamHttpStatus) >= 400
          && Number(error?.status || error?.upstreamHttpStatus) < 500);
      if (uncertainSubmission) {
        if (attempt) {
          try {
            this.database.updateAttempt(attempt.id, {
              status: 'polling',
              timestamps: { lastPolledAt: Date.now() },
              error: {
                kind: 'provider',
                code: 'CREATOR_SUBMISSION_STATUS_UNKNOWN',
                message: '远端提交结果不确定，已停止自动重提',
                retryable: false,
              },
            }, { runId: run.id, nodeRunId: nodeRun.id });
          } catch (_) {}
        }
        this.repository.updateAction(actionId, sessionId, {
          status: 'ambiguous',
          runIntentId: intent.id,
          runId: run?.id || null,
          errorCode: 'CREATOR_SUBMISSION_STATUS_UNKNOWN',
          errorMessage: '远端可能已经收到这次生成，但本地没有拿到可恢复任务号。为避免重复生成，不会自动重提；请先到渠道后台确认。',
        }, scope);
        return;
      }
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
  preflightActionReferences,
  mimeAndExtension,
};
