const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const {
  startFigmaBridgeOnAppStart,
  stopFigmaBridge,
} = require('./utils/figmaBridge');
const { closeProjectDatabase } = require('./services/projectDatabase');
const {
  cancelProjectStorageDeferredWork,
  onProjectStorageReady,
  getProjectStorageRuntimeStatus,
  requestProjectStorageStartupBackup,
  waitForProjectStorageDeferredWork,
} = require('./services/projectRuntime');
const { registerAgentControlInstance } = require('./services/agentControlRegistry');
const {
  apiErrorEnvelopeMiddleware,
  sendApiError,
} = require('./utils/apiErrorEnvelope');
const agentControlRouter = require('./routes/agentControl');
const canvasAgentToolsRouter = require('./routes/canvasAgentTools');
const creatorAgentRouter = require('./routes/creatorAgent');

const app = express();
const backendStartupStartedAt = Date.now();
const startupReadiness = {
  phase: 'module-loading',
  transportReady: false,
  storageReadReady: false,
  storageWriteReady: false,
  frontendInteractive: false,
  backgroundScheduled: false,
  backgroundStarted: false,
  backgroundReady: false,
  backgroundFailures: 0,
  source: null,
  elapsedMs: 0,
  phases: {},
};

function startupReadinessSnapshot() {
  const storageRuntime = getProjectStorageRuntimeStatus();
  const storageReady = storageRuntime.status === 'ready';
  return {
    schema: 't8-backend-startup-readiness-v1',
    phase: startupReadiness.phase,
    transportReady: startupReadiness.transportReady,
    storageReadReady: storageReady,
    storageWriteReady: storageReady,
    storageRuntime,
    frontendInteractive: startupReadiness.frontendInteractive,
    backgroundScheduled: startupReadiness.backgroundScheduled,
    backgroundStarted: startupReadiness.backgroundStarted,
    backgroundReady: startupReadiness.backgroundReady,
    backgroundFailures: startupReadiness.backgroundFailures,
    source: startupReadiness.source,
    elapsedMs: startupReadiness.elapsedMs,
    phases: { ...startupReadiness.phases },
  };
}

function markBackendStartupStage(phase, extra = {}) {
  const now = Date.now();
  const elapsedMs = Math.max(0, now - backendStartupStartedAt);
  startupReadiness.phase = phase;
  startupReadiness.elapsedMs = elapsedMs;
  startupReadiness.phases[phase] = elapsedMs;
  Object.assign(startupReadiness, extra);
  console.log(`[startup] component=backend phase=${phase} elapsedMs=${elapsedMs}`);
  return startupReadinessSnapshot();
}

// Node's http.Server considers a request closed as soon as its socket is
// destroyed, but an async Express handler can keep running afterwards. Track
// returned handler promises separately so ProjectDatabase is never closed
// underneath application work during a bounded shutdown.
const HTTP_REQUEST_LIFECYCLE = Symbol('t8-http-request-lifecycle');
const activeApplicationRequests = new Set();
const applicationRequestDrainWaiters = new Set();
const wrappedApplicationHandlers = new WeakMap();
const wrappedApplicationRouters = new WeakSet();

function applicationRequestStatus() {
  let pendingHandlers = 0;
  for (const state of activeApplicationRequests) pendingHandlers += state.pendingHandlers;
  return {
    activeRequests: activeApplicationRequests.size,
    pendingHandlers,
  };
}

function resolveApplicationRequestDrainWaiters() {
  if (activeApplicationRequests.size !== 0) return;
  for (const waiter of applicationRequestDrainWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve({ drained: true, ...applicationRequestStatus() });
  }
  applicationRequestDrainWaiters.clear();
}

function settleApplicationRequest(state) {
  if (state.settled || !state.trackingArmed || !state.responseTerminal || state.pendingHandlers !== 0) return;
  state.settled = true;
  activeApplicationRequests.delete(state);
  resolveApplicationRequestDrainWaiters();
}

function applicationRequestLifecycle(req, res, next) {
  const state = {
    pendingHandlers: 0,
    responseTerminal: false,
    responseFinished: false,
    responseEndInvoked: false,
    responseEndWaiters: new Set(),
    trackingArmed: false,
    settled: false,
  };
  req[HTTP_REQUEST_LIFECYCLE] = state;
  activeApplicationRequests.add(state);
  res.locals = res.locals || {};
  res.locals.trackApplicationTask = (task) => trackApplicationTask(req, res, task);
  const originalEnd = res.end;
  res.end = function trackedResponseEnd(...args) {
    state.responseEndInvoked = true;
    try {
      return originalEnd.apply(this, args);
    } finally {
      for (const release of state.responseEndWaiters) release();
      state.responseEndWaiters.clear();
    }
  };
  const markResponseTerminal = () => {
    state.responseTerminal = true;
    settleApplicationRequest(state);
  };
  res.once('finish', () => {
    state.responseFinished = true;
    markResponseTerminal();
  });
  res.once('close', markResponseTerminal);
  queueMicrotask(() => {
    state.trackingArmed = true;
    settleApplicationRequest(state);
  });
  next();
}

function trackApplicationTask(req, res, task) {
  if (!task || typeof task.then !== 'function') return task;
  const lease = acquireApplicationHandlerLease(req, res);
  if (!lease) return task;
  Promise.resolve(task).then(lease.release, lease.release);
  return task;
}

function acquireApplicationHandlerLease(req, res) {
  const state = req?.[HTTP_REQUEST_LIFECYCLE];
  if (!state) return null;
  // A late callback should not normally observe a settled state because its
  // upstream invocation owns a lease. Re-open defensively so a malformed
  // extension cannot silently disappear from request accounting.
  if (state.settled) {
    state.settled = false;
    activeApplicationRequests.add(state);
  }
  state.pendingHandlers += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.responseEndWaiters.delete(release);
    res.removeListener('finish', release);
    state.pendingHandlers = Math.max(0, state.pendingHandlers - 1);
    settleApplicationRequest(state);
  };
  const waitForResponseEnd = (allowEndInvocation = true) => {
    if (state.responseFinished || res.writableFinished) {
      release();
      return;
    }
    res.once('finish', release);
    if (allowEndInvocation) {
      if (state.responseEndInvoked || res.writableEnded) {
        release();
        return;
      }
      state.responseEndWaiters.add(release);
    }
    // Deliberately do not release on a premature socket close. A callback-style
    // middleware can still call next() or res.end() afterwards; retaining the
    // lease is what keeps ProjectDatabase open across that detached work.
  };
  return { release, waitForResponseEnd };
}

function invokeApplicationHandler(handler, receiver, error, req, res, next) {
  const lease = acquireApplicationHandlerLease(req, res);
  if (!lease) {
    return error === undefined
      ? handler.call(receiver, req, res, next)
      : handler.call(receiver, error, req, res, next);
  }
  let invocationReturned = false;
  let returnedPromise = false;
  let nextCalled = false;
  const trackedNext = (...args) => {
    nextCalled = true;
    try {
      return next(...args);
    } finally {
      // next() dispatches downstream synchronously. Release only after those
      // handlers acquired their own leases, and keep this lease when the
      // current handler also returned a Promise that may continue afterwards.
      if (invocationReturned && !returnedPromise) lease.release();
    }
  };
  let result;
  try {
    result = error === undefined
      ? handler.call(receiver, req, res, trackedNext)
      : handler.call(receiver, error, req, res, trackedNext);
  } catch (caught) {
    invocationReturned = true;
    try {
      return trackedNext(caught);
    } finally {
      lease.release();
    }
  }
  invocationReturned = true;
  returnedPromise = Boolean(result && typeof result.then === 'function');
  if (returnedPromise) {
    Promise.resolve(result).then(
      () => lease.release(),
      (caught) => {
        try {
          trackedNext(caught);
        } finally {
          lease.release();
        }
      },
    );
  } else if (nextCalled) {
    lease.release();
  } else {
    // A next-capable callback middleware owns the dispatch lease until it calls
    // next() or a response finishes normally. A forced socket close may invoke
    // response internals, but must not be mistaken for completion of that
    // still-scheduled callback.
    lease.waitForResponseEnd();
  }
  return result;
}

function wrapApplicationHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler.stack && Array.isArray(handler.stack)) {
    wrapApplicationRouter(handler);
    return handler;
  }
  const existing = wrappedApplicationHandlers.get(handler);
  if (existing) return existing;
  let wrapped;
  if (handler.length === 4) {
    wrapped = function trackedErrorHandler(error, req, res, next) {
      return invokeApplicationHandler(handler, this, error, req, res, next);
    };
  } else {
    wrapped = function trackedRequestHandler(req, res, next) {
      return invokeApplicationHandler(handler, this, undefined, req, res, next);
    };
  }
  wrappedApplicationHandlers.set(handler, wrapped);
  wrappedApplicationHandlers.set(wrapped, wrapped);
  return wrapped;
}

function wrapApplicationLayer(layer) {
  if (!layer || typeof layer !== 'object') return;
  if (layer.route?.stack && Array.isArray(layer.route.stack)) {
    layer.route.stack.forEach(wrapApplicationLayer);
    return;
  }
  if (layer.handle?.stack && Array.isArray(layer.handle.stack)) {
    wrapApplicationRouter(layer.handle);
    return;
  }
  if (typeof layer.handle === 'function') layer.handle = wrapApplicationHandler(layer.handle);
}

function wrapApplicationRouter(router) {
  if (!router || wrappedApplicationRouters.has(router)) return router;
  wrappedApplicationRouters.add(router);
  if (Array.isArray(router.stack)) router.stack.forEach(wrapApplicationLayer);
  return router;
}

function wrapRegistrationArgument(value) {
  if (Array.isArray(value)) return value.map(wrapRegistrationArgument);
  if (typeof value === 'function') return wrapApplicationHandler(value);
  return value;
}

// Register the lifecycle middleware before decorating app registration. Every
// router mounted below is traversed once, while routes added later (including
// local extensions) are wrapped at registration time as well.
app.use(applicationRequestLifecycle);
for (const method of ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
  const register = app[method].bind(app);
  app[method] = (...args) => register(...args.map(wrapRegistrationArgument));
}

function waitForApplicationRequests(timeoutMs = null) {
  if (activeApplicationRequests.size === 0) {
    return Promise.resolve({ drained: true, ...applicationRequestStatus() });
  }
  const hasTimeout = timeoutMs !== null && timeoutMs !== undefined;
  const requestedTimeout = hasTimeout ? Number(timeoutMs) : Number.NaN;
  if (hasTimeout && Number.isFinite(requestedTimeout) && requestedTimeout <= 0) {
    return Promise.resolve({ drained: false, ...applicationRequestStatus() });
  }
  return new Promise((resolve) => {
    const waiter = { resolve, timer: null };
    if (hasTimeout && Number.isFinite(requestedTimeout)) {
      waiter.timer = setTimeout(() => {
        applicationRequestDrainWaiters.delete(waiter);
        resolve({ drained: false, ...applicationRequestStatus() });
      }, requestedTimeout);
    }
    applicationRequestDrainWaiters.add(waiter);
  });
}

// ========== 中间件 ==========
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;
const UXP_ORIGIN_RE = /^uxp:\/\//i;
function isTrustedLocalOrigin(origin) {
  const value = String(origin || '').trim();
  return LOCAL_ORIGIN_RE.test(value) || UXP_ORIGIN_RE.test(value);
}
function isLocalCanvasSyncPath(req) {
  const pathname = String(req?.originalUrl || req?.url || req?.path || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return /^\/api\/canvas\/[^/]+\/sync$/.test(pathname);
}
app.use((req, res, next) => {
  if (isLocalCanvasSyncPath(req)) res.set('Cache-Control', 'no-store');
  next();
});
app.use(cors({
  origin(origin, cb) {
    cb(null, Boolean(origin && isTrustedLocalOrigin(origin)));
  },
  preflightContinue: true,
}));
app.use(apiErrorEnvelopeMiddleware);
app.use((req, res, next) => {
  const origin = String(req.get('origin') || '').trim();
  const trustedOrigin = Boolean(origin && isTrustedLocalOrigin(origin));
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase();
  if ((origin && !trustedOrigin) || fetchSite === 'cross-site') {
    return res.status(403).json({
      success: false,
      code: 'origin_forbidden',
      error: '请求来源未获本地后端授权',
    });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});
const canvasAgentJsonParser = express.json({ limit: '64kb', strict: true });
const creatorAgentJsonParser = express.json({ limit: '1mb', strict: true });
const agentControlJsonParser = express.json({ limit: '64kb', strict: true });
app.use('/api/agent-control/v1', (req, res, next) => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > agentControlRouter.AGENT_CONTROL_REQUEST_LIMIT) {
    return res.status(413).json({
      schema: agentControlRouter.AGENT_CONTROL_HTTP_SCHEMA,
      ok: false,
      code: 'AGENT_CONTROL_REQUEST_TOO_LARGE',
      message: 'Agent Control 请求超过 64 KiB',
    });
  }
  return agentControlJsonParser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      schema: agentControlRouter.AGENT_CONTROL_HTTP_SCHEMA,
      ok: false,
      code: tooLarge ? 'AGENT_CONTROL_REQUEST_TOO_LARGE' : 'AGENT_CONTROL_REQUEST_INVALID',
      message: tooLarge ? 'Agent Control 请求超过 64 KiB' : 'Agent Control JSON 格式无效',
    });
  });
}, agentControlRouter);
app.use('/api/canvas-agent', (req, res, next) => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return res.status(413).json({ success: false, code: 'agent_request_too_large', error: 'Agent 工具请求超过 64 KiB' });
  }
  return canvasAgentJsonParser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: tooLarge ? 'agent_request_too_large' : 'agent_request_invalid',
      error: tooLarge ? 'Agent 工具请求超过 64 KiB' : 'Agent 工具请求格式无效',
    });
  });
}, canvasAgentToolsRouter);
app.use('/api/creator-agent/v1', (req, res, next) => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > creatorAgentRouter.CREATOR_AGENT_REQUEST_LIMIT) {
    return res.status(413).json({
      schema: creatorAgentRouter.CREATOR_AGENT_HTTP_SCHEMA,
      ok: false,
      code: 'CREATOR_AGENT_REQUEST_TOO_LARGE',
      message: '创作 Agent 请求超过 1 MiB，请把大文件作为附件上传，不要嵌入对话正文',
    });
  }
  return creatorAgentJsonParser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      schema: creatorAgentRouter.CREATOR_AGENT_HTTP_SCHEMA,
      ok: false,
      code: tooLarge ? 'CREATOR_AGENT_REQUEST_TOO_LARGE' : 'CREATOR_AGENT_REQUEST_INVALID',
      message: tooLarge
        ? '创作 Agent 请求超过 1 MiB，请把大文件作为附件上传'
        : '创作 Agent JSON 格式无效',
    });
  });
}, creatorAgentRouter);
app.use(express.json({ limit: '120mb' }));
app.use(express.urlencoded({ extended: true, limit: '120mb' }));

// 简易访问日志
app.use((req, _res, next) => {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${t}] ${req.method} ${req.path}`);
  next();
});

// ========== 目录初始化 ==========
[
  config.DATA_DIR,
  config.INPUT_DIR,
  config.OUTPUT_DIR,
  config.THUMBNAILS_DIR,
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========== 静态资源托管 ==========
const ACTIVE_USER_MEDIA_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.js', '.mjs', '.cjs',
  '.css', '.xml', '.xsl', '.xslt', '.hta', '.vbs',
]);

function guardUserMediaStatic(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let pathname = String(req.path || '');
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch (_) {
    return res.status(400).end();
  }
  if (ACTIVE_USER_MEDIA_EXTENSIONS.has(path.extname(pathname).toLowerCase())) {
    return res.status(404).end();
  }
  return next();
}

const userMediaStaticOptions = {
  dotfiles: 'deny',
  // User-controlled media roots must never turn a nested index.html into an
  // executable directory landing page whose request URL has no active suffix.
  index: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
};

function mountUserMediaStatic(prefix, directory) {
  app.use(prefix, guardUserMediaStatic, express.static(directory, userMediaStaticOptions));
}

mountUserMediaStatic('/files/output', config.OUTPUT_DIR);
mountUserMediaStatic('/files/input', config.INPUT_DIR);
mountUserMediaStatic('/files/thumbnails', config.THUMBNAILS_DIR);
mountUserMediaStatic('/output', config.OUTPUT_DIR);
mountUserMediaStatic('/input', config.INPUT_DIR);

// ========== 健康检查 ==========
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 't8-penguin-canvas-backend',
    version: config.APP_VERSION,
    port: config.PORT,
    instanceId: config.BACKEND_INSTANCE_ID,
    time: new Date().toISOString(),
    readiness: startupReadinessSnapshot(),
  });
});

// ========== 业务路由 ==========
const canvasRouter = require('./routes/canvas');
const settingsRouter = require('./routes/settings');
const proxyRouter = require('./routes/proxy');
const filesRouter = require('./routes/files');
const imageOpsRouter = require('./routes/imageOps');
const resourcesRouter = require('./routes/resources');
const themesRouter = require('./routes/themes');
const eagleRouter = require('./routes/eagle');
const figmaRouter = require('./routes/figma');
const externalProvidersRouter = require('./routes/externalProviders');
const grokOAuthRouter = require('./routes/grokOAuth');
const codexCliRouter = require('./routes/codexCli');
const aiWatermarkRouter = require('./routes/aiWatermark');
const cloudUploadsRouter = require('./routes/cloudUploads');
const parseHubRouter = require('./routes/parseHub');
const achievementsRouter = require('./routes/achievements');
const topazRouter = require('./routes/topaz');
const animeTagsRouter = require('./routes/animeTags');
const vibexBridgeRouter = require('./routes/vibexBridge');
const videoOpsRouter = require('./routes/videoOps');
const batchTagsRouter = require('./routes/batchTags');
const photoshopBridgeRouter = require('./routes/photoshopBridge');
const feishuBitableRouter = require('./routes/feishuBitable');
const volcengineAssetsRouter = require('./routes/volcengineAssets');
const localizationMasterRouter = require('./routes/localizationMaster');
const webAssetsRouter = require('./routes/webAssets');
const collaborationRouter = require('./routes/collaboration');
const { peekCollaborationGateway } = require('./collaboration/gateway');
const projectRunsRouter = require('./routes/projectRuns');
const projectAssetsRouter = require('./routes/projectAssets');
const { peekAssetPreviewPipeline } = require('./services/assetPreviewPipeline');
const subflowsRouter = require('./routes/subflows');
const { registerLocalExtensions } = require('./extensions/localExtensions');
const localHooks = require('./extensions/runtimeHooks');

app.use('/api/canvas', canvasRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/proxy/external', externalProvidersRouter);
app.use('/api/files', filesRouter);
app.use('/api/image', imageOpsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/themes', themesRouter);
app.use('/api/eagle', eagleRouter);
app.use('/api/figma', figmaRouter);
app.use('/api/grok-oauth', grokOAuthRouter);
app.use('/api/codex-cli', codexCliRouter);
app.use('/api/ai-watermark', aiWatermarkRouter);
app.use('/api/cloud-uploads', cloudUploadsRouter);
app.use('/api/parsehub', parseHubRouter);
app.use('/api/achievements', achievementsRouter);
app.use('/api/topaz', topazRouter);
app.use('/api/anime-tags', animeTagsRouter);
app.use('/api/vibex-bridge', vibexBridgeRouter);
app.use('/api/video-ops', videoOpsRouter);
app.use('/api/batch-tags', batchTagsRouter);
app.use('/api/photoshop-bridge', photoshopBridgeRouter);
app.use('/api/feishu-bitable', feishuBitableRouter);
app.use('/api/volcengine-assets', volcengineAssetsRouter);
app.use('/api/localization-master', localizationMasterRouter);
app.use('/api/web-assets', webAssetsRouter);
app.use('/api/collaboration', collaborationRouter);
app.use('/api/project-runs', projectRunsRouter);
app.use('/api/project-assets', projectAssetsRouter);
app.use('/api/subflows', subflowsRouter);
registerLocalExtensions(app, { config, express, logger: console, hooks: localHooks });
app.use('/api', (req, res) => sendApiError(res, 404, {
  code: 'api_route_not_found',
  messageKey: 'errors.api.notFound',
  error: 'API route not found',
}));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error?.status || error?.statusCode);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  console.error('[backend] unhandled request error:', {
    method: req.method,
    path: req.path,
    status: safeStatus,
    code: error?.code || null,
    message: error?.message || 'unknown_error',
  });
  return sendApiError(res, safeStatus, {
    code: error?.code || 'internal_request_error',
    messageKey: safeStatus >= 500 ? 'errors.api.internal' : undefined,
    error: safeStatus >= 500 ? 'Internal server error' : error?.message,
  });
});
markBackendStartupStage('routes-mounted', {
  storageReadReady: false,
  storageWriteReady: false,
});

// ========== 前端静态资源(仅打包模式) ==========
// 开发模式下不启用,避免与 Vite dev server 打架。
if (config.IS_PACKAGED && config.FRONTEND_DIST && fs.existsSync(config.FRONTEND_DIST)) {
  app.use(express.static(config.FRONTEND_DIST));
  // SPA 兑底: 除了 /api/* 与 /files/* 外,其他路由返回 index.html(允许前端路由)
  app.get(/^\/(?!api\/|files\/|input\/|output\/).*/, (_req, res) => {
    res.sendFile(path.join(config.FRONTEND_DIST, 'index.html'));
  });
}

// ========== 启动 ==========
const PORT = config.PORT;
const HOST = config.HOST;

let shutdownStarted = false;
let semanticPipelineClosed = false;
let previewPipelineShutdownPromise = null;
let runRecoveryShutdownPromise = null;
let videoOperationsShutdownPromise = null;
let collaborationGatewayShutdownPromise = null;
let projectDatabaseClosePromise = null;
let runtimeStorageClosePromise = null;
let deferredRuntimeStorageClosePromise = null;
let httpServerClosePromise = null;
let gracefulShutdownPromise = null;
let startupRunRecoveryPromise = null;
let startupSemanticModelRefreshPromise = null;
let startupMaintenanceTimer = null;
let startupMaintenanceFallbackTimer = null;
let startupMaintenancePromise = null;
let resolveStartupMaintenance = null;
let deferredStorageMaintenanceUnsubscribe = null;
let deferredStorageMaintenanceRetryTimer = null;
let deferredStorageMaintenanceRetryAttempt = 0;
let startupNonStorageMaintenanceSettled = false;
let startupStorageMaintenanceSettled = false;
let startupNonStorageMaintenanceFailures = 0;
let startupStorageMaintenanceFailures = 0;

function publishBackgroundMaintenanceReadiness() {
  const complete = startupNonStorageMaintenanceSettled && startupStorageMaintenanceSettled;
  return markBackendStartupStage(complete ? 'background-ready' : 'background-deferred', {
    backgroundReady: complete,
    backgroundFailures: startupNonStorageMaintenanceFailures + startupStorageMaintenanceFailures,
  });
}
const figmaStartupAbortController = new AbortController();
let figmaBridgeShutdownPromise = null;
let agentControlRegistration = null;
let serverStartOutcome = null;
let resolveServerStart;
const serverStartPromise = new Promise((resolve) => { resolveServerStart = resolve; });
let serverClosedOutcome = false;
let resolveServerClosed;
const serverClosedPromise = new Promise((resolve) => { resolveServerClosed = resolve; });
const STARTUP_MAINTENANCE_FALLBACK_MS = Math.max(
  1_000,
  Math.min(300_000, Number(process.env.T8PC_STARTUP_MAINTENANCE_FALLBACK_MS) || 30_000),
);
const STARTUP_MAINTENANCE_INTERACTIVE_DELAY_MS = Math.max(
  0,
  Math.min(10_000, Number(process.env.T8PC_STARTUP_MAINTENANCE_INTERACTIVE_DELAY_MS) || 750),
);
const STORAGE_MAINTENANCE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

function retryStorageDependentMaintenance(error) {
  startupStorageMaintenanceFailures = 1;
  if (!shutdownStarted) publishBackgroundMaintenanceReadiness();
  if (shutdownStarted || deferredStorageMaintenanceRetryTimer) return;
  const attempt = deferredStorageMaintenanceRetryAttempt;
  const delayMs = STORAGE_MAINTENANCE_RETRY_DELAYS_MS[
    Math.min(attempt, STORAGE_MAINTENANCE_RETRY_DELAYS_MS.length - 1)
  ];
  deferredStorageMaintenanceRetryAttempt += 1;
  console.warn(
    '[backend] deferred storage maintenance initialization failed; retrying:',
    error?.code || error?.message || 'unknown_error',
    `in ${delayMs}ms`,
  );
  deferredStorageMaintenanceRetryTimer = setTimeout(() => {
    deferredStorageMaintenanceRetryTimer = null;
    scheduleStorageDependentMaintenance();
  }, delayMs);
  deferredStorageMaintenanceRetryTimer.unref?.();
}
function scheduleStorageDependentMaintenance() {
  if (shutdownStarted || deferredStorageMaintenanceUnsubscribe) return;
  deferredStorageMaintenanceUnsubscribe = onProjectStorageReady(() => {
    deferredStorageMaintenanceUnsubscribe = null;
    if (shutdownStarted) return { ok: false, deferred: true, shutdown: true };
    let assets;
    let runs;
    try {
      assets = projectAssetsRouter.getRuntime();
      runs = projectRunsRouter.getRuntime();
    } catch (error) {
      retryStorageDependentMaintenance(error);
      return { ok: false, deferred: true, retryable: true };
    }
    deferredStorageMaintenanceRetryAttempt = 0;
    startupSemanticModelRefreshPromise = Promise.resolve()
      .then(() => assets.semanticPipeline.refreshModelStates())
      .catch((error) => {
        console.warn('[asset-semantic] deferred model refresh failed:', error?.code || 'unknown_error');
        return { ok: false, code: error?.code || 'unknown_error' };
      });
    startupRunRecoveryPromise = Promise.resolve()
      .then(() => runs.recoveryManager.recoverPendingRuns())
      .then((result) => {
        if (result.recovered || result.failed || result.interrupted) {
          console.log('[run-recovery] deferred result', result);
        }
        return result;
      })
      .catch((error) => {
        console.warn('[run-recovery] deferred startup failed:', error?.message || error);
        return { ok: false, code: error?.code || 'run_recovery_failed' };
      });
    return Promise.allSettled([
      startupSemanticModelRefreshPromise,
      startupRunRecoveryPromise,
    ]).then((results) => {
      startupStorageMaintenanceSettled = true;
      startupStorageMaintenanceFailures = results.filter((result) => (
        result.status === 'rejected'
        || (result.status === 'fulfilled' && result.value?.ok === false
          && result.value?.disabled !== true)
      )).length;
      if (!shutdownStarted) publishBackgroundMaintenanceReadiness();
      return results;
    });
  });
}


function scheduleStartupMaintenance(source = 'fallback', delayMs = 0) {
  if (shutdownStarted || startupReadiness.backgroundScheduled) {
    return startupMaintenancePromise || Promise.resolve(startupReadinessSnapshot());
  }
  startupReadiness.backgroundScheduled = true;
  startupReadiness.source = String(source || 'fallback');
  markBackendStartupStage('background-scheduled');
  if (startupMaintenanceFallbackTimer) {
    clearTimeout(startupMaintenanceFallbackTimer);
    startupMaintenanceFallbackTimer = null;
  }
  startupMaintenancePromise = new Promise((resolve) => {
    resolveStartupMaintenance = resolve;
    startupMaintenanceTimer = setTimeout(() => {
      startupMaintenanceTimer = null;
      if (shutdownStarted) {
        resolve(startupReadinessSnapshot());
        resolveStartupMaintenance = null;
        return;
      }
      markBackendStartupStage('background-started', { backgroundStarted: true });
      const figmaStart = startFigmaBridgeOnAppStart(console, {
        signal: figmaStartupAbortController.signal,
      });
      startupSemanticModelRefreshPromise = Promise.resolve({ ok: true, deferred: true });
      startupRunRecoveryPromise = Promise.resolve({ ok: true, deferred: true });
      // Register intent only; the first real storage request opens DB and triggers backup.
      scheduleStorageDependentMaintenance();
      const startupBackup = requestProjectStorageStartupBackup();
      Promise.allSettled([
        figmaStart,
        startupSemanticModelRefreshPromise,
        startupRunRecoveryPromise,
        startupBackup,
      ]).then((results) => {
        if (shutdownStarted) {
          resolve(startupReadinessSnapshot());
          resolveStartupMaintenance = null;
          return;
        }
        const failures = results.filter((result) => (
          result.status === 'rejected'
          || (result.status === 'fulfilled' && result.value?.ok === false
            && result.value?.disabled !== true)
        )).length;
        startupNonStorageMaintenanceSettled = true;
        startupNonStorageMaintenanceFailures = failures;
        publishBackgroundMaintenanceReadiness();
        resolve(startupReadinessSnapshot());
        resolveStartupMaintenance = null;
      });
    }, Math.max(0, Number(delayMs) || 0));
    startupMaintenanceTimer.unref?.();
  });
  return startupMaintenancePromise;
}

function markFrontendInteractive(source = 'renderer') {
  if (shutdownStarted) return startupReadinessSnapshot();
  if (!startupReadiness.frontendInteractive) {
    markBackendStartupStage('frontend-interactive', {
      frontendInteractive: true,
      source: String(source || 'renderer'),
    });
  }
  scheduleStartupMaintenance(source, STARTUP_MAINTENANCE_INTERACTIVE_DELAY_MS);
  return startupReadinessSnapshot();
}

function settleServerStart(state, error = null) {
  if (serverStartOutcome) return serverStartOutcome;
  serverStartOutcome = { state, error };
  resolveServerStart(serverStartOutcome);
  return serverStartOutcome;
}

function settleServerClosed() {
  if (serverClosedOutcome) return;
  serverClosedOutcome = true;
  resolveServerClosed();
}

const server = app.listen(PORT, HOST, () => {
  settleServerStart('listening');
  markBackendStartupStage('transport-listening', { transportReady: true });
  // A signal can arrive after listen() was requested but before this callback.
  // In that window startup side effects must not outlive the shutdown lifecycle.
  if (shutdownStarted) return;
  try {
    agentControlRegistration = registerAgentControlInstance(config);
  } catch (error) {
    console.warn('[agent-control] instance discovery registration failed:', error?.message || error);
  }
  console.log('==================================================');
  console.log('🐧 T8-penguin-canvas 后端服务');
  console.log('==================================================');
  console.log(`🚀 服务器启动成功!`);
  console.log(`   地址: http://${HOST}:${PORT}`);
  console.log(`   环境: ${config.NODE_ENV}`);
  console.log(`   数据目录: ${config.DATA_DIR}`);
  console.log(`   输出目录: ${config.OUTPUT_DIR}`);
  console.log('   Figma Bridge: 首屏就绪后后台启动（如需禁用可设置 T8_FIGMA_BRIDGE_AUTOSTART=0）');
  console.log('   按 Ctrl+C 停止服务器...');
  console.log('--------------------------------------------------');
  startupMaintenanceFallbackTimer = setTimeout(() => {
    startupMaintenanceFallbackTimer = null;
    scheduleStartupMaintenance('transport-idle-fallback', 0);
  }, STARTUP_MAINTENANCE_FALLBACK_MS);
  startupMaintenanceFallbackTimer.unref?.();
});
server.once('error', (error) => {
  const start = settleServerStart('error', error);
  // A failed listen has no later close event. A runtime server error after a
  // successful listen does, so never forge the transport-closed barrier there.
  if (start.state === 'error') settleServerClosed();
  console.warn('[backend] listen failed:', error?.message || error);
  setImmediate(() => {
    gracefulShutdown('LISTEN_ERROR').catch((shutdownError) => {
      console.warn('[backend] listen failure cleanup failed:', shutdownError?.message || shutdownError);
    });
  });
});
server.once('close', () => {
  settleServerStart('closed');
  settleServerClosed();
});

function closeSemanticPipeline() {
  if (semanticPipelineClosed) return;
  semanticPipelineClosed = true;
  try {
    projectAssetsRouter.peekRuntime()?.semanticPipeline?.close?.();
  } catch (error) {
    console.warn('[asset-semantic] shutdown failed:', error?.message || error);
  }
}

function closeProjectDatabaseLifecycle() {
  if (!projectDatabaseClosePromise) {
    projectDatabaseClosePromise = closeProjectDatabase().catch((error) => {
      console.warn('[project-db] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return projectDatabaseClosePromise;
}

function shutdownPreviewPipelineLifecycle() {
  if (!previewPipelineShutdownPromise) {
    const pipeline = projectAssetsRouter.peekRuntime()?.previewPipeline
      || peekAssetPreviewPipeline();
    try {
      previewPipelineShutdownPromise = typeof pipeline?.shutdown === 'function'
        ? Promise.resolve(pipeline.shutdown())
        : Promise.resolve(pipeline?.close?.());
    } catch (error) {
      previewPipelineShutdownPromise = Promise.reject(error);
    }
    previewPipelineShutdownPromise = previewPipelineShutdownPromise.then((result) => {
      if (result?.forced) console.warn('[asset-preview] shutdown deadline reached; running jobs remain durable for recovery');
      return result;
    }).catch((error) => {
      console.warn('[asset-preview] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return previewPipelineShutdownPromise;
}

function shutdownRunRecoveryLifecycle() {
  if (!runRecoveryShutdownPromise) {
    const runRecoveryManager = projectRunsRouter.peekRuntime()?.recoveryManager;
    try {
      runRecoveryShutdownPromise = typeof runRecoveryManager?.shutdown === 'function'
        ? Promise.resolve(runRecoveryManager.shutdown({ timeoutMs: 5_000 }))
        : Promise.resolve(startupRunRecoveryPromise);
    } catch (error) {
      runRecoveryShutdownPromise = Promise.reject(error);
    }
    runRecoveryShutdownPromise = runRecoveryShutdownPromise.then((result) => {
      if (result?.forced) console.warn('[run-recovery] shutdown deadline reached; deferred work remains durable');
      return result;
    }).catch((error) => {
      console.warn('[run-recovery] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return runRecoveryShutdownPromise;
}

function shutdownFigmaBridgeLifecycle() {
  if (!figmaBridgeShutdownPromise) {
    figmaStartupAbortController.abort();
    figmaBridgeShutdownPromise = Promise.resolve(stopFigmaBridge({ timeoutMs: 2_000 }))
      .catch((error) => {
        console.warn('[figma-bridge] shutdown failed:', error?.message || error);
        return { ok: false, error: error?.message || String(error) };
      });
  }
  return figmaBridgeShutdownPromise;
}

function shutdownVideoOperationsLifecycle() {
  if (!videoOperationsShutdownPromise) {
    try {
      videoOperationsShutdownPromise = typeof videoOpsRouter?.shutdownLifecycle === 'function'
        ? Promise.resolve(videoOpsRouter.shutdownLifecycle({ timeoutMs: 5_000 }))
        : Promise.resolve({ tasks: { drained: true, activeTasks: 0 }, forced: false });
    } catch (error) {
      videoOperationsShutdownPromise = Promise.reject(error);
    }
    videoOperationsShutdownPromise = videoOperationsShutdownPromise.then((result) => {
      if (result?.forced) console.warn('[video-ops] shutdown deadline reached; active tasks remain fenced by request lifecycle');
      return result;
    }).catch((error) => {
      console.warn('[video-ops] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return videoOperationsShutdownPromise;
}

function collaborationGatewayNotCreatedOutcome() {
  return {
    running: false,
    notCreated: true,
    applicationRequests: {
      drained: true,
      activeRequests: 0,
      pendingHandlers: 0,
    },
  };
}

function shutdownCollaborationGatewayLifecycle() {
  const gateway = peekCollaborationGateway();
  // Do not cache the no-op: an already accepted request may lazily create the
  // singleton before HTTP drain completes, and the later shutdown pass must see it.
  if (!gateway) return Promise.resolve(collaborationGatewayNotCreatedOutcome());
  if (!collaborationGatewayShutdownPromise) {
    try {
      collaborationGatewayShutdownPromise = typeof gateway.shutdown === 'function'
        ? Promise.resolve(gateway.shutdown())
        : Promise.resolve(gateway.stop?.());
    } catch (error) {
      collaborationGatewayShutdownPromise = Promise.reject(error);
    }
    collaborationGatewayShutdownPromise = collaborationGatewayShutdownPromise.catch((error) => {
      console.warn('[collaboration-gateway] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return collaborationGatewayShutdownPromise;
}
function closeRuntimeStorageLifecycle() {
  if (!runtimeStorageClosePromise) {
    runtimeStorageClosePromise = (async () => {
      // Both workers may own database writes across async provider/renderer
      // boundaries. The collaboration listener is a third database writer and
      // must enter its terminal lifecycle before ProjectDatabase is closed.
      await Promise.resolve(startupSemanticModelRefreshPromise);
      await shutdownRunRecoveryLifecycle();
      await shutdownPreviewPipelineLifecycle();
      await shutdownVideoOperationsLifecycle();
      await shutdownCollaborationGatewayLifecycle();
      await videoOpsRouter.waitForShutdownDrain?.();
      await peekCollaborationGateway()?.waitForApplicationRequests?.();
      await waitForProjectStorageDeferredWork();
      await closeProjectDatabaseLifecycle();
    })();
  }
  return runtimeStorageClosePromise;
}

function closeHttpServerLifecycle() {
  if (!httpServerClosePromise) {
    httpServerClosePromise = (async () => {
      const start = await serverStartPromise;
      if (start.state !== 'listening') {
        await serverClosedPromise;
        const requests = await waitForApplicationRequests(0);
        return { serverClosed: true, forced: false, ...requests };
      }
      const shutdownTimeoutMs = Math.max(
        100,
        Math.min(120_000, Number(config.HTTP_SHUTDOWN_TIMEOUT_MS) || 5_000),
      );
      const deadline = Date.now() + shutdownTimeoutMs;
      let forced = false;
      // Arm the deadline even when another owner already called server.close().
      // In that state server.listening is false while active sockets may still
      // keep the close event pending forever.
      const forceClose = setTimeout(() => {
        forced = true;
        server.closeAllConnections?.();
      }, shutdownTimeoutMs);
      try {
        if (server.listening) {
          try {
            server.close((error) => {
              if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                console.warn('[backend] HTTP close callback failed:', error?.message || error);
              }
            });
          } catch (error) {
            if (error?.code !== 'ERR_SERVER_NOT_RUNNING') throw error;
          }
        }
        await serverClosedPromise;
        const requests = await waitForApplicationRequests(Math.max(0, deadline - Date.now()));
        return { serverClosed: true, forced, ...requests };
      } finally {
        clearTimeout(forceClose);
      }
    })();
  }
  return httpServerClosePromise;
}

function deferRuntimeStorageCloseUntilRequestsDrain() {
  if (!deferredRuntimeStorageClosePromise) {
    deferredRuntimeStorageClosePromise = (async () => {
      await serverClosedPromise;
      await Promise.all([
        waitForApplicationRequests(),
        peekCollaborationGateway()?.waitForApplicationRequests?.()
          || Promise.resolve({ drained: true, activeRequests: 0, pendingHandlers: 0 }),
        videoOpsRouter.waitForShutdownDrain?.(),
      ]);
      await closeRuntimeStorageLifecycle();
      return { drained: true };
    })().catch((error) => {
      console.warn('[backend] deferred storage shutdown failed:', error?.message || error);
      throw error;
    });
    deferredRuntimeStorageClosePromise.catch(() => {});
  }
  return deferredRuntimeStorageClosePromise;
}

function waitForRuntimeStorageCloseLifecycle() {
  return runtimeStorageClosePromise
    || deferredRuntimeStorageClosePromise
    || Promise.resolve(null);
}

function gracefulShutdown(signal) {
  if (shutdownStarted) return gracefulShutdownPromise || projectDatabaseClosePromise || Promise.resolve();
  shutdownStarted = true;
  cancelProjectStorageDeferredWork();
  figmaStartupAbortController.abort();
  if (startupMaintenanceTimer) {
    clearTimeout(startupMaintenanceTimer);
    startupMaintenanceTimer = null;
  }
  if (startupMaintenanceFallbackTimer) {
    clearTimeout(startupMaintenanceFallbackTimer);
    startupMaintenanceFallbackTimer = null;
  }
  if (deferredStorageMaintenanceRetryTimer) {
    clearTimeout(deferredStorageMaintenanceRetryTimer);
    deferredStorageMaintenanceRetryTimer = null;
  }
  if (deferredStorageMaintenanceUnsubscribe) {
    deferredStorageMaintenanceUnsubscribe();
    deferredStorageMaintenanceUnsubscribe = null;
  }
  if (resolveStartupMaintenance) {
    resolveStartupMaintenance(startupReadinessSnapshot());
    resolveStartupMaintenance = null;
  }
  try {
    agentControlRegistration?.stop?.();
  } catch (error) {
    console.warn('[agent-control] instance discovery cleanup failed:', error?.message || error);
  }
  closeSemanticPipeline();
  // Stop accepting new preview work/claims as soon as shutdown begins. The
  // database itself remains open until the HTTP server has drained as well.
  const previewShutdown = shutdownPreviewPipelineLifecycle();
  previewShutdown.catch(() => {});
  const figmaShutdown = shutdownFigmaBridgeLifecycle();
  figmaShutdown.catch(() => {});
  const recoveryShutdown = shutdownRunRecoveryLifecycle();
  recoveryShutdown.catch(() => {});
  const videoShutdown = shutdownVideoOperationsLifecycle();
  videoShutdown.catch(() => {});
  const collaborationShutdown = shutdownCollaborationGatewayLifecycle();
  collaborationShutdown.catch(() => {});
  if (signal === 'SIGINT') process.exitCode = 130;
  else if (signal === 'SIGTERM') process.exitCode = 143;
  gracefulShutdownPromise = (async () => {
    const http = await closeHttpServerLifecycle();
    await figmaShutdown;
    await recoveryShutdown;
    await previewShutdown;
    const videoOperations = await videoShutdown;
    await collaborationShutdown;
    // A request accepted before close may have created the lazy gateway after
    // the first shutdown pass. Recheck only after the main server is closed.
    const collaboration = await shutdownCollaborationGatewayLifecycle();
    // A main HTTP management request can enqueue a gateway-owned cancellation
    // after the initial gateway stop outcome was captured. Recheck only after
    // the main transport lifecycle has reached its bounded outcome; when it is
    // drained, no request remains that can add another gateway task.
    const collaborationRequests = await peekCollaborationGateway()?.waitForApplicationRequests?.(0)
      || collaboration?.applicationRequests
      || { drained: true };
    const collaborationOutcome = {
      ...collaboration,
      applicationRequests: collaborationRequests,
    };
    const collaborationDrained = collaborationRequests.drained !== false;
    const videoOperationTasks = await videoOpsRouter.waitForShutdownDrain?.(0)
      || videoOperations?.tasks
      || { drained: true, activeTasks: 0 };
    const videoOperationsOutcome = {
      ...videoOperations,
      tasks: videoOperationTasks,
    };
    const videoOperationsDrained = videoOperationTasks.drained !== false;
    if (http.drained && collaborationDrained && videoOperationsDrained) {
      await closeRuntimeStorageLifecycle();
      return {
        http,
        collaboration: collaborationOutcome,
        videoOperations: videoOperationsOutcome,
        storageClosed: true,
        storageDeferred: false,
      };
    }
    // closeAllConnections() only severs transport. Returned async Express
    // handlers remain application work and may still need the database. Keep
    // storage open, resolve the bounded shutdown, and close it as soon as the
    // tracked handler promises settle.
    deferRuntimeStorageCloseUntilRequestsDrain();
    return {
      http,
      collaboration: collaborationOutcome,
      videoOperations: videoOperationsOutcome,
      storageClosed: false,
      storageDeferred: true,
    };
  })();
  return gracefulShutdownPromise;
}

function handleShutdownSignal(signal) {
  gracefulShutdown(signal).catch((error) => {
    console.warn('[backend] runtime shutdown failed:', error?.message || error);
  });
}

process.once('SIGINT', () => handleShutdownSignal('SIGINT'));
process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.once('exit', closeSemanticPipeline);
process.once('exit', () => {
  try { agentControlRegistration?.stop?.(); } catch (_) {}
});

module.exports = {
  app,
  server,
  gracefulShutdown,
  markFrontendInteractive,
  scheduleStartupMaintenance,
  startupReadinessSnapshot,
  closeSemanticPipeline,
  shutdownFigmaBridgeLifecycle,
  shutdownPreviewPipelineLifecycle,
  shutdownRunRecoveryLifecycle,
  shutdownVideoOperationsLifecycle,
  shutdownCollaborationGatewayLifecycle,
  serverStartPromise,
  applicationRequestStatus,
  waitForApplicationRequests,
  waitForRuntimeStorageCloseLifecycle,
  agentControlAuthService: require('./services/agentControlAuth').agentControlAuthService,
  agentControlApprovalService: require('./services/agentControlApprovals').agentControlApprovalService,
};
