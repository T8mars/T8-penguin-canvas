'use strict';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'polling']);
const RECOVERY_KINDS = new Set([
  'runninghub',
  'seedance',
  'seedream-nz',
  'wan',
  'happyhorse',
  'hailuo',
  'flux3',
  'kling',
  'upscaler',
  'fashvsr',
  'vidu',
  'seed-audio',
  'suno',
  'image',
  'mj',
  'video',
  'image-fal',
  'video-fal',
]);

function boundedText(value, maxLength = 2048) {
  return String(value || '').trim().slice(0, maxLength);
}

function runRecoveryStateConflict(message) {
  return Object.assign(new Error(message), {
    code: 'run_recovery_state_conflict',
    status: 409,
    retryable: false,
  });
}

function assertRecoveryTicketCurrent(database, ticket, expected = {}) {
  const run = database.getRun(ticket.run.id);
  const nodeRun = database.getNodeRun(ticket.nodeRun.id);
  const attempt = database.getAttempt(ticket.attempt.id);
  const exactIdentity = run
    && nodeRun
    && attempt
    && run.id === ticket.run.id
    && run.entityUid === ticket.run.entityUid
    && nodeRun.id === ticket.nodeRun.id
    && nodeRun.entityUid === ticket.nodeRun.entityUid
    && nodeRun.runId === run.id
    && attempt.id === ticket.attempt.id
    && attempt.entityUid === ticket.attempt.entityUid
    && attempt.nodeRunId === nodeRun.id;
  const active = exactIdentity
    && ACTIVE_STATUSES.has(String(run.status || ''))
    && ACTIVE_STATUSES.has(String(nodeRun.status || ''))
    && ACTIVE_STATUSES.has(String(attempt.status || ''));
  const exactRevision = active
    && Number(run.revision) === Number(expected.runRevision ?? ticket.run.revision)
    && Number(nodeRun.revision) === Number(expected.nodeRunRevision ?? ticket.nodeRun.revision)
    && Number(attempt.revision) === Number(expected.attemptRevision ?? ticket.attempt.revision);
  if (!exactRevision) {
    throw runRecoveryStateConflict('恢复票据对应的 Run/NodeRun/Attempt 已变化，未提交陈旧恢复写入');
  }
  return { run, nodeRun, attempt };
}

function normalizeRunRecoveryDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = boundedText(value.kind, 80).toLowerCase();
  if (!RECOVERY_KINDS.has(kind)) return null;
  const descriptor = {
    version: 1,
    kind,
    taskId: boundedText(value.taskId, 512) || null,
    taskIds: Array.isArray(value.taskIds) ? [...new Set(value.taskIds.map((item) => boundedText(item, 512)).filter(Boolean))].slice(0, 20) : [],
    requestId: boundedText(value.requestId, 512) || null,
    responseUrl: boundedText(value.responseUrl, 4096) || null,
    statusUrl: boundedText(value.statusUrl, 4096) || null,
    endpoint: boundedText(value.endpoint, 1024) || null,
    model: boundedText(value.model, 240) || null,
    site: ['cn', 'intl'].includes(boundedText(value.site, 20).toLowerCase()) ? boundedText(value.site, 20).toLowerCase() : null,
    taskProvider: ['seedance-nz', 'zhenzhen-legacy'].includes(boundedText(value.taskProvider, 80)) ? boundedText(value.taskProvider, 80) : null,
    speed: ['relax', 'fast', 'turbo'].includes(boundedText(value.speed, 20).toLowerCase()) ? boundedText(value.speed, 20).toLowerCase() : null,
    pollIntervalMs: Math.max(250, Math.min(30000, Math.trunc(Number(value.pollIntervalMs) || 3000))),
    maxPolls: Math.max(1, Math.min(7200, Math.trunc(Number(value.maxPolls) || 1200))),
  };
  if (kind === 'suno') return descriptor.taskIds.length ? descriptor : null;
  if (kind === 'image-fal' || kind === 'video-fal') {
    return descriptor.requestId && (descriptor.responseUrl || descriptor.endpoint) ? descriptor : null;
  }
  return descriptor.taskId ? descriptor : null;
}

function isRecoverableRunAttempt(attempt) {
  return Boolean(
    attempt
    && attempt.metadata?.mvChildAttempt !== true
    && ACTIVE_STATUSES.has(String(attempt.status || ''))
    && normalizeRunRecoveryDescriptor(attempt.metadata?.recovery),
  );
}

function wait(ms, signal = null) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener?.('abort', finish, { once: true });
  });
}

function recoveryRequest(baseUrl, descriptor) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const get = (path) => ({ url: `${root}${path}`, options: { method: 'GET' } });
  const post = (path, body) => ({
    url: `${root}${path}`,
    options: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  });
  const taskId = encodeURIComponent(descriptor.taskId || '');
  if (descriptor.kind === 'runninghub') return get(`/api/proxy/runninghub/query?taskId=${taskId}&site=${encodeURIComponent(descriptor.site || 'cn')}`);
  if (descriptor.kind === 'seedance') return get(`/api/proxy/seedance/query?taskId=${taskId}&taskProvider=${encodeURIComponent(descriptor.taskProvider || 'seedance-nz')}`);
  if (descriptor.kind === 'seedream-nz') return get(`/api/proxy/image/seedance-nz/status/${taskId}`);
  if (descriptor.kind === 'wan') return get(`/api/proxy/video/wan/status/${taskId}`);
  if (descriptor.kind === 'happyhorse') return get(`/api/proxy/video/happyhorse/status/${taskId}`);
  if (descriptor.kind === 'hailuo') return get(`/api/proxy/video/hailuo/status/${taskId}`);
  if (descriptor.kind === 'flux3') return get(`/api/proxy/video/flux3/status/${taskId}`);
  if (descriptor.kind === 'kling') return get(`/api/proxy/video/kling/status/${taskId}`);
  if (descriptor.kind === 'upscaler') return get(`/api/proxy/video/upscaler/status/${taskId}`);
  if (descriptor.kind === 'fashvsr') return get(`/api/proxy/video/fashvsr/status/${taskId}`);
  if (descriptor.kind === 'vidu') return get(`/api/proxy/video/vidu/status/${taskId}`);
  if (descriptor.kind === 'seed-audio') return get(`/api/proxy/audio/seed-audio/status/${taskId}`);
  if (descriptor.kind === 'suno') return get(`/api/proxy/audio/query?clipIds=${encodeURIComponent(descriptor.taskIds.join(','))}&saveLocal=true`);
  if (descriptor.kind === 'image') return get(`/api/proxy/image/status/${taskId}${descriptor.model ? `?model=${encodeURIComponent(descriptor.model)}` : ''}`);
  if (descriptor.kind === 'mj') return get(`/api/proxy/mj/task/${taskId}?speed=${encodeURIComponent(descriptor.speed || 'fast')}`);
  if (descriptor.kind === 'video') return get(`/api/proxy/video/query?taskId=${taskId}${descriptor.model ? `&model=${encodeURIComponent(descriptor.model)}` : ''}`);
  if (descriptor.kind === 'image-fal') return post('/api/proxy/image/fal/query', descriptor);
  if (descriptor.kind === 'video-fal') return post('/api/proxy/video/fal/query', descriptor);
  throw new Error(`不支持的恢复类型: ${descriptor.kind}`);
}

function normalizedState(value) {
  const state = boundedText(value, 120).toLowerCase();
  if (['success', 'succeeded', 'completed', 'complete', 'done'].includes(state)) return 'succeeded';
  if (['failure', 'failed', 'error', 'cancelled', 'canceled'].includes(state)) return 'failed';
  return 'pending';
}

function outputKindForDescriptor(descriptor) {
  if (descriptor.kind === 'seed-audio' || descriptor.kind === 'suno') return 'audio';
  if (['seedance', 'wan', 'happyhorse', 'hailuo', 'flux3', 'kling', 'upscaler', 'fashvsr', 'vidu', 'video', 'video-fal'].includes(descriptor.kind)) return 'video';
  return 'image';
}

function normalizeRecoveryPayload(payload, descriptor) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  let state = normalizedState(data?.status ?? data?.state ?? data?.task_status ?? data?.code);
  if (descriptor.kind === 'runninghub') {
    if (String(data?.code) === '0') state = 'succeeded';
    else if (String(data?.code) === '805') state = 'failed';
  }
  if (descriptor.kind === 'suno' && Number(data?.total) > 0 && Number(data?.completed) >= Number(data?.total)) state = 'succeeded';
  const rawUrls = [
    ...(Array.isArray(data?.urls) ? data.urls : []),
    ...(Array.isArray(data?.imageUrls) ? data.imageUrls : []),
    data?.imageUrl,
    data?.videoUrl,
    data?.audioUrl,
    ...(Array.isArray(data?.tracks) ? data.tracks.map((track) => track?.audioUrl) : []),
  ].map((item) => boundedText(item, 16384)).filter(Boolean);
  const kind = outputKindForDescriptor(descriptor);
  return {
    state,
    outputs: [...new Set(rawUrls)].map((sourceUrl, index) => ({
      kind,
      sourceUrl,
      filename: `recovered-${descriptor.kind}-${index + 1}`,
    })),
    usage: data?.usage && typeof data.usage === 'object' ? data.usage : {},
    error: boundedText(data?.failReason || data?.error || payload?.error, 4000) || null,
    providerStatus: boundedText(data?.status ?? data?.state ?? data?.task_status ?? data?.code, 160) || null,
  };
}

async function queryRecoveryViaLocalApi(baseUrl, descriptor, fetchImpl = fetch, options = {}) {
  const request = recoveryRequest(baseUrl, descriptor);
  if (options.signal) request.options.signal = options.signal;
  const response = await fetchImpl(request.url, request.options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text.slice(0, 1000) }; }
  if (!response.ok) {
    const error = new Error(boundedText(payload?.error || `恢复查询 HTTP ${response.status}`, 4000));
    error.httpStatus = response.status;
    error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    throw error;
  }
  return normalizeRecoveryPayload(payload, descriptor);
}

class RunRecoveryManager {
  constructor(options) {
    this.database = options.database;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl || fetch;
    this.queryRecovery = options.queryRecovery || ((descriptor, _ticket, _index, context = {}) => (
      queryRecoveryViaLocalApi(this.baseUrl, descriptor, this.fetchImpl, context)
    ));
    this.wait = options.wait || wait;
    this.broadcast = options.broadcast || {};
    this.commitRunOutputArtifacts = typeof options.commitRunOutputArtifacts === 'function'
      ? options.commitRunOutputArtifacts
      : null;
    this.afterRunRecoveryStartCommit = typeof options.afterRunRecoveryStartCommit === 'function'
      ? options.afterRunRecoveryStartCommit
      : null;
    this.running = null;
    this.stopping = false;
    this.shutdownPromise = null;
    this.lifecycleAbortController = new AbortController();
    this.lastResult = { status: 'idle', recovered: 0, failed: 0, interrupted: 0, deferred: 0, pending: 0, startedAt: null, finishedAt: null };
  }

  status() {
    return { ...this.lastResult, running: Boolean(this.running) };
  }

  recoverPendingRuns() {
    if (this.stopping) return Promise.resolve(this.status());
    if (this.running) return this.running;
    this.running = this.runAll().finally(() => { this.running = null; });
    return this.running;
  }

  shutdown(options = {}) {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopping = true;
    this.lifecycleAbortController.abort();
    const timeoutMs = Math.max(100, Math.min(30_000, Number(options.timeoutMs) || 5_000));
    const running = this.running;
    if (!running) return Promise.resolve({ drained: true });
    this.shutdownPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ drained: false, forced: true }), timeoutMs);
      running.then(
        () => finish({ drained: true }),
        (error) => finish({ drained: true, error }),
      );
    });
    return this.shutdownPromise;
  }

  async runAll() {
    const tickets = this.database.listPendingRunRecoveries();
    const result = { status: 'running', recovered: 0, failed: 0, interrupted: 0, deferred: 0, pending: tickets.length, startedAt: Date.now(), finishedAt: null };
    this.lastResult = result;
    for (let index = 0; index < tickets.length; index += 4) {
      if (this.stopping) {
        result.deferred += tickets.length - index;
        result.pending = 0;
        break;
      }
      const chunk = tickets.slice(index, index + 4);
      const settled = await Promise.allSettled(chunk.map((ticket) => this.recoverTicket(ticket)));
      for (const outcome of settled) {
        if (outcome.status === 'rejected') continue;
        const state = outcome.value;
        if (Object.hasOwn(result, state)) result[state] += 1;
        else result.deferred += 1;
      }
      result.pending -= chunk.length;
      this.lastResult = { ...result };
      const failure = settled.find((outcome) => outcome.status === 'rejected');
      if (failure) {
        result.status = 'failed';
        result.finishedAt = Date.now();
        this.lastResult = { ...result };
        throw failure.reason;
      }
    }
    result.status = this.stopping ? 'stopped' : 'completed';
    result.finishedAt = Date.now();
    this.lastResult = { ...result };
    return this.status();
  }

  async recoverTicket(ticket) {
    if (this.stopping) return 'deferred';
    // Creator Agent owns the matching conversation/action transition and uses
    // the same durable Run/NodeRun/Attempt as its recovery authority.  Leave
    // these tickets active for the lazy Creator runtime instead of committing
    // them through canvas-node artifact authority (the detached NodeRun has no
    // canvas node entity by design).
    if (ticket.attempt.metadata?.creatorAgentV2?.version === 1) return 'deferred';
    const descriptor = normalizeRunRecoveryDescriptor(ticket.attempt.metadata?.recovery);
    if (!descriptor) return this.interruptTicket(ticket, '恢复描述缺失或不受支持');
    const startedAt = Date.now();
    const started = this.database.beginRunRecoveryAttempt({
      runId: ticket.run.id,
      runEntityUid: ticket.run.entityUid,
      runRevision: ticket.run.revision,
      nodeRunId: ticket.nodeRun.id,
      nodeRunEntityUid: ticket.nodeRun.entityUid,
      nodeRunRevision: ticket.nodeRun.revision,
      attemptId: ticket.attempt.id,
      attemptEntityUid: ticket.attempt.entityUid,
      attemptRevision: ticket.attempt.revision,
      kind: descriptor.kind,
      startedAt,
    });
    let startedNodeRun = started.nodeRun;
    let startedAttempt = started.attempt;
    if (!started.duplicate) {
      // This synchronous hook exists only to freeze the otherwise
      // unobservable commit-to-broadcast hard-crash boundary in node:test.
      // Production must ignore an accidentally injected callback after the
      // durable start transaction has already committed.
      if (process.env.NODE_TEST_CONTEXT) {
        this.afterRunRecoveryStartCommit?.({ ticket, started });
      }
      this.broadcast.node?.(started.run, startedNodeRun);
    }

    let lastError = null;
    for (let index = 0; index < descriptor.maxPolls; index += 1) {
      if (this.stopping) return 'deferred';
      if (index > 0) {
        await this.wait(descriptor.pollIntervalMs, this.lifecycleAbortController.signal);
        if (this.stopping) return 'deferred';
      }
      let probe;
      try {
        probe = await this.queryRecovery(descriptor, ticket, index, {
          signal: this.lifecycleAbortController.signal,
        });
      } catch (error) {
        if (this.stopping) return 'deferred';
        lastError = error;
        if (error?.retryable === false || (Number(error?.httpStatus) >= 400 && Number(error?.httpStatus) < 500 && Number(error?.httpStatus) !== 408 && Number(error?.httpStatus) !== 429)) break;
        continue;
      }
      if (this.stopping) return 'deferred';
      const pollCount = ticket.attempt.pollCount + index + 1;
      this.database.withProjectDatabaseWrite('run.recovery.poll', () => {
        assertRecoveryTicketCurrent(this.database, ticket, {
          runRevision: ticket.run.revision,
          nodeRunRevision: startedNodeRun.revision,
          attemptRevision: startedAttempt.revision,
        });
        const updatedAttempt = this.database.updateAttempt(ticket.attempt.id, {
          status: 'polling',
          pollCount,
          timestamps: { lastPolledAt: Date.now() },
          usage: probe.usage,
          metadata: { recovery: descriptor, recoveryProviderStatus: probe.providerStatus },
        }, { runId: ticket.run.id, nodeRunId: ticket.nodeRun.id });
        if (!updatedAttempt) {
          throw runRecoveryStateConflict('恢复轮询状态已变化，未提交部分轮询记录');
        }
        this.database.appendRunEvent(ticket.run.id, {
          nodeRunId: ticket.nodeRun.id,
          type: 'provider.polling',
          payload: { recovered: true, provider: ticket.attempt.provider, model: ticket.attempt.model, pollCount, status: probe.providerStatus },
        });
        startedAttempt = updatedAttempt;
      });
      if (probe.state === 'pending') continue;
      if (probe.state === 'failed') return this.failTicket(ticket, probe.error || '上游恢复查询返回失败');
      return await this.succeedTicket(ticket, probe.outputs, probe.usage);
    }
    return this.interruptTicket(ticket, lastError?.message || '恢复轮询达到上限');
  }

  async succeedTicket(ticket, outputs, usage) {
    if (this.stopping) return 'deferred';
    const now = Date.now();
    const recoveryTerminal = {
      runId: ticket.run.id,
      runEntityUid: ticket.run.entityUid,
      nodeRunId: ticket.nodeRun.id,
      nodeRunEntityUid: ticket.nodeRun.entityUid,
      attemptId: ticket.attempt.id,
      attemptEntityUid: ticket.attempt.entityUid,
      status: 'succeeded',
      usage: usage && typeof usage === 'object' ? usage : {},
      finishedAt: now,
      recoveredAt: now,
    };
    let terminal;
    if (Array.isArray(outputs) && outputs.length > 0) {
      if (!this.commitRunOutputArtifacts) {
        throw Object.assign(new Error('恢复产物缺少 host artifact 权威提交器'), {
          code: 'host_artifact_committer_missing',
          retryable: false,
        });
      }
      const recorded = await this.commitRunOutputArtifacts({
        runId: ticket.run.id,
        nodeRunId: ticket.nodeRun.id,
        attemptId: ticket.attempt.id,
        outputs,
        recoveryTerminal,
        signal: this.lifecycleAbortController.signal,
      });
      if (this.stopping) return 'deferred';
      terminal = recorded?.recoveryTerminal;
      if (!terminal?.run || !terminal?.nodeRun || !terminal?.attempt) {
        throw Object.assign(new Error('host artifact 恢复提交未返回同事务终态证据'), {
          code: 'run_recovery_terminal_missing',
          retryable: false,
        });
      }
      if (!recorded.duplicate) {
        this.broadcast.output?.(terminal.run, terminal.nodeRun, recorded.assets);
      }
    } else {
      terminal = this.database.completeRecoveredRunAttempt(recoveryTerminal);
    }
    this.broadcastTerminal(terminal);
    return 'recovered';
  }

  failTicket(ticket, message) {
    if (this.stopping) return 'deferred';
    const now = Date.now();
    const error = { kind: 'upstream', code: 'RUN_RECOVERY_UPSTREAM_FAILED', message: boundedText(message, 4000), retryable: false };
    const terminal = this.database.completeRecoveredRunAttempt({
      runId: ticket.run.id,
      runEntityUid: ticket.run.entityUid,
      nodeRunId: ticket.nodeRun.id,
      nodeRunEntityUid: ticket.nodeRun.entityUid,
      attemptId: ticket.attempt.id,
      attemptEntityUid: ticket.attempt.entityUid,
      status: 'failed',
      usage: {},
      error,
      finishedAt: now,
      recoveredAt: now,
    });
    this.broadcastTerminal(terminal);
    return 'failed';
  }

  interruptTicket(ticket, message) {
    if (this.stopping) return 'deferred';
    const now = Date.now();
    const error = { kind: 'protocol', code: 'RUN_RECOVERY_UNAVAILABLE', message: boundedText(message, 4000), retryable: true };
    const terminal = this.database.completeRecoveredRunAttempt({
      runId: ticket.run.id,
      runEntityUid: ticket.run.entityUid,
      nodeRunId: ticket.nodeRun.id,
      nodeRunEntityUid: ticket.nodeRun.entityUid,
      attemptId: ticket.attempt.id,
      attemptEntityUid: ticket.attempt.entityUid,
      status: 'interrupted',
      usage: {},
      error,
      finishedAt: now,
      recoveredAt: now,
    });
    this.broadcastTerminal(terminal);
    return 'interrupted';
  }

  broadcastTerminal(terminal) {
    if (!terminal || terminal.duplicate) return;
    this.broadcast.node?.(terminal.run, terminal.nodeRun);
    if (terminal.runChanged) {
      this.broadcast.run?.(terminal.run);
      if (terminal.intent) this.broadcast.intent?.(terminal.intent);
    }
  }
}

let singleton = null;

function getRunRecoveryManager(options) {
  if (!singleton) singleton = new RunRecoveryManager(options);
  return singleton;
}

module.exports = {
  ACTIVE_STATUSES,
  RECOVERY_KINDS,
  normalizeRunRecoveryDescriptor,
  isRecoverableRunAttempt,
  recoveryRequest,
  normalizeRecoveryPayload,
  queryRecoveryViaLocalApi,
  RunRecoveryManager,
  getRunRecoveryManager,
};
