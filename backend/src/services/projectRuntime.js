const {
  getProjectDatabase,
  onProjectDatabaseReady,
  startProjectDatabaseStartupBackup,
} = require('./projectDatabase');

const PROJECT_RUNTIME_RETRY_DELAY_MS = 1_000;

function safeRuntimeErrorCode(error) {
  const code = String(error?.code || error?.name || 'project_runtime_unavailable')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 120);
  return code || 'project_runtime_unavailable';
}

class ProjectRuntimeUnavailableError extends Error {
  constructor(state, cause = null, retryAfterSeconds = 1) {
    const initializing = state === 'initializing';
    super(initializing ? '项目存储正在初始化，请稍后重试' : '项目存储暂时不可用，请稍后重试');
    this.name = 'ProjectRuntimeUnavailableError';
    this.code = initializing ? 'project_runtime_initializing' : 'project_runtime_unavailable';
    this.status = 503;
    this.retryAfterSeconds = Math.max(1, Math.trunc(Number(retryAfterSeconds) || 1));
    if (cause) this.cause = cause;
  }
}

function createLazyRuntime(factory, options = {}) {
  if (typeof factory !== 'function') throw new TypeError('lazy runtime factory is required');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const retryDelayMs = Math.max(100, Math.trunc(Number(options.retryDelayMs) || PROJECT_RUNTIME_RETRY_DELAY_MS));
  let value = null;
  let lastError = null;
  const state = {
    status: 'idle',
    attempts: 0,
    initializedAt: null,
    failedAt: null,
    retryAt: null,
    errorCode: null,
  };

  function unavailable(status = state.status, cause = lastError) {
    const remainingMs = state.retryAt == null ? retryDelayMs : Math.max(0, state.retryAt - now());
    return new ProjectRuntimeUnavailableError(
      status === 'initializing' ? 'initializing' : 'failed',
      cause,
      Math.max(1, Math.ceil(remainingMs / 1_000)),
    );
  }

  function get(...args) {
    if (value) return value;
    const timestamp = now();
    if (state.status === 'initializing') throw unavailable('initializing');
    if (state.status === 'failed' && state.retryAt != null && timestamp < state.retryAt) {
      throw unavailable('failed');
    }
    state.status = 'initializing';
    state.attempts += 1;
    try {
      const candidate = factory(...args);
      if (!candidate) throw new Error('project runtime factory returned no value');
      value = candidate;
      lastError = null;
      state.status = 'ready';
      state.initializedAt = now();
      state.failedAt = null;
      state.retryAt = null;
      state.errorCode = null;
      return value;
    } catch (error) {
      lastError = error;
      state.status = 'failed';
      state.failedAt = now();
      state.retryAt = state.failedAt + retryDelayMs;
      state.errorCode = safeRuntimeErrorCode(error);
      throw unavailable('failed', error);
    }
  }

  function adopt(candidate) {
    if (!candidate) throw new Error('lazy runtime adoption requires a value');
    if (value) return value;
    value = candidate;
    lastError = null;
    state.status = 'ready';
    state.initializedAt = now();
    state.failedAt = null;
    state.retryAt = null;
    state.errorCode = null;
    return value;
  }

  return {
    adopt,
    get,
    peek: () => value,
    status: () => ({ ...state }),
  };
}

const projectStorageRuntime = createLazyRuntime((config) => ({
  database: getProjectDatabase(config),
}));
const projectStorageReadyHooks = new Set();
const projectStorageReadyWork = new Set();
let projectStorageReadyDispatchScheduled = false;
let projectStorageDeferredWorkCancelled = false;

function scheduleProjectStorageReadyHooks(runtime) {
  if (projectStorageDeferredWorkCancelled
    || projectStorageReadyDispatchScheduled
    || projectStorageReadyHooks.size === 0) return;
  projectStorageReadyDispatchScheduled = true;
  const handle = setImmediate(() => {
    projectStorageReadyDispatchScheduled = false;
    if (projectStorageDeferredWorkCancelled) {
      projectStorageReadyHooks.clear();
      return;
    }
    const hooks = [...projectStorageReadyHooks];
    projectStorageReadyHooks.clear();
    for (const hook of hooks) {
      const work = Promise.resolve().then(() => hook(runtime)).catch((error) => {
        console.warn('[project-db] storage-ready hook failed:', error?.code || error?.message || 'unknown_error');
      });
      projectStorageReadyWork.add(work);
      work.finally(() => projectStorageReadyWork.delete(work));
    }
  });
  handle.unref?.();
}

function onProjectStorageReady(callback) {
  if (typeof callback !== 'function') throw new TypeError('project storage ready callback is required');
  if (projectStorageDeferredWorkCancelled) return () => false;
  projectStorageReadyHooks.add(callback);
  const runtime = projectStorageRuntime.peek();
  if (runtime) scheduleProjectStorageReadyHooks(runtime);
  return () => projectStorageReadyHooks.delete(callback);
}

let startupBackupRequested = false;
let startupBackupPromise = null;
let startupBackupImmediate = null;
let startupBackupStarted = false;
let resolveStartupBackup = null;
let rejectStartupBackup = null;

function ensureStartupBackupPromise() {
  if (!startupBackupPromise) {
    startupBackupPromise = new Promise((resolve, reject) => {
      resolveStartupBackup = resolve;
      rejectStartupBackup = reject;
    });
    // Readiness and shutdown both retain the promise, but keep a rejection
    // handler here as a final guard for callers that intentionally do not wait.
    startupBackupPromise.catch((error) => {
      console.warn('[project-db] deferred startup backup failed:', error?.code || error?.message || 'unknown_error');
    });
  }
  return startupBackupPromise;
}

function triggerRequestedStartupBackup() {
  if (projectStorageDeferredWorkCancelled) {
    return Promise.resolve({ ok: false, cancelled: true });
  }
  if (!startupBackupRequested || !projectStorageRuntime.peek()) return null;
  const completion = ensureStartupBackupPromise();
  if (!startupBackupStarted && !startupBackupImmediate) {
    startupBackupImmediate = setImmediate(() => {
      startupBackupImmediate = null;
      startupBackupStarted = true;
      if (projectStorageDeferredWorkCancelled) {
        resolveStartupBackup?.({ ok: false, cancelled: true });
        resolveStartupBackup = null;
        rejectStartupBackup = null;
        return;
      }
      Promise.resolve().then(() => startProjectDatabaseStartupBackup())
        .then(
          (result) => {
            resolveStartupBackup?.(result);
            resolveStartupBackup = null;
            rejectStartupBackup = null;
          },
          (error) => {
            rejectStartupBackup?.(error);
            resolveStartupBackup = null;
            rejectStartupBackup = null;
          },
        );
    });
    startupBackupImmediate.unref?.();
  }
  return completion;
}

function getProjectStorageRuntime(config) {
  const runtime = projectStorageRuntime.get(config);
  scheduleProjectStorageReadyHooks(runtime);
  triggerRequestedStartupBackup();
  return runtime;
}

// Older route modules intentionally retain the long-standing synchronous
// getProjectDatabase() ABI. Adopt that same singleton into the lazy runtime as
// soon as any of those routes opens it, so readiness, deferred maintenance and
// the requested startup backup cannot remain permanently idle.
if (typeof onProjectDatabaseReady === 'function') {
  onProjectDatabaseReady((database) => {
    const runtime = projectStorageRuntime.adopt({ database });
    scheduleProjectStorageReadyHooks(runtime);
    triggerRequestedStartupBackup();
  });
}

function requestProjectStorageStartupBackup() {
  startupBackupRequested = true;
  const completion = ensureStartupBackupPromise();
  triggerRequestedStartupBackup();
  return completion;
}

function cancelProjectStorageDeferredWork() {
  projectStorageDeferredWorkCancelled = true;
  projectStorageReadyHooks.clear();
  const backupMayBeCancelled = !startupBackupStarted;
  if (startupBackupImmediate) {
    clearImmediate(startupBackupImmediate);
    startupBackupImmediate = null;
  }
  if (backupMayBeCancelled) {
    resolveStartupBackup?.({ ok: false, cancelled: true });
    resolveStartupBackup = null;
    rejectStartupBackup = null;
  }
}

function waitForProjectStorageDeferredWork() {
  const work = [...projectStorageReadyWork];
  if (startupBackupPromise) work.push(startupBackupPromise);
  return work.length > 0
    ? Promise.allSettled(work)
    : Promise.resolve([]);
}

function peekProjectStorageRuntime() {
  return projectStorageRuntime.peek();
}

function getProjectStorageRuntimeStatus() {
  return {
    ...projectStorageRuntime.status(),
    startupBackupRequested,
    startupBackupStarted,
    deferredWorkCancelled: projectStorageDeferredWorkCancelled,
    pendingReadyWork: projectStorageReadyWork.size,
  };
}
function sendProjectRuntimeUnavailable(res, error) {
  const unavailable = error instanceof ProjectRuntimeUnavailableError
    ? error
    : new ProjectRuntimeUnavailableError('failed', error);
  res.setHeader('Retry-After', String(unavailable.retryAfterSeconds));
  return res.status(503).json({
    success: false,
    error: unavailable.message,
    code: unavailable.code,
    retryable: true,
  });
}

module.exports = {
  PROJECT_RUNTIME_RETRY_DELAY_MS,
  ProjectRuntimeUnavailableError,
  createLazyRuntime,
  cancelProjectStorageDeferredWork,
  getProjectStorageRuntime,
  getProjectStorageRuntimeStatus,
  peekProjectStorageRuntime,
  onProjectStorageReady,
  requestProjectStorageStartupBackup,
  sendProjectRuntimeUnavailable,
  waitForProjectStorageDeferredWork,
};
