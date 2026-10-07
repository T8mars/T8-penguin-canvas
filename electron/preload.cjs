// preload.cjs — 暴露最小信息给 BrowserWindow 渲染进程
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let canvasCloseHandler = null;
let canvasCloseEverRegistered = false;
let canvasCloseRequest = null;
ipcRenderer.on('t8pc:canvas-close-cancel', (_event, requestId) => {
  if (canvasCloseRequest?.id !== requestId) return;
  canvasCloseRequest.cancelled = true;
  if (canvasCloseRequest.settled) canvasCloseRequest = null;
});
ipcRenderer.on('t8pc:canvas-close-request', async (_event, requestId) => {
  if (typeof requestId !== 'string' || canvasCloseRequest) return;
  const request = { id: requestId, cancelled: false, settled: false, approved: false };
  canvasCloseRequest = request;
  try {
    const result = canvasCloseHandler
      ? await canvasCloseHandler(() => request.cancelled)
      : { ok: !canvasCloseEverRegistered, reason: 'save' };
    request.approved = result?.ok === true;
    if (!request.cancelled) ipcRenderer.send('t8pc:canvas-close-result', {
      requestId, ok: result?.ok === true,
      reason: ['running', 'conflict'].includes(result?.reason) ? result.reason : 'save',
    });
  } catch {
    request.approved = false;
    if (!request.cancelled) ipcRenderer.send('t8pc:canvas-close-result', { requestId, ok: false, reason: 'save' });
  } finally {
    request.settled = true;
    // A successful ACK can race the main deadline. Keep its cancellation
    // handle alive until the window closes or main explicitly cancels it.
    if (canvasCloseRequest === request && (request.cancelled || !request.approved)) canvasCloseRequest = null;
  }
});

contextBridge.exposeInMainWorld('t8pc', {
  onCanvasCloseRequest: (callback) => {
    if (typeof callback !== 'function') return () => {};
    canvasCloseEverRegistered = true;
    canvasCloseHandler = callback;
    return () => {
      if (canvasCloseHandler === callback) canvasCloseHandler = null;
    };
  },
  getInfo: () => ipcRenderer.invoke('t8pc:get-info'),
  startupDiagnostics: {
    record: (event) => ipcRenderer.send('t8pc:startup-diagnostics:record', {
      component: 'renderer',
      phase: typeof event?.phase === 'string' ? event.phase.slice(0, 80) : '',
      elapsedMs: typeof event?.elapsedMs === 'number' ? event.elapsedMs : 0,
      phaseMs: typeof event?.phaseMs === 'number' ? event.phaseMs : undefined,
      delayMs: typeof event?.delayMs === 'number' ? event.delayMs : undefined,
    }),
    save: () => ipcRenderer.invoke('t8pc:startup-diagnostics:save'),
  },
  storage: {
    status: () => ipcRenderer.invoke('t8pc:storage:status'),
    chooseAndRestart: () => ipcRenderer.invoke('t8pc:storage:choose'),
  },
  locale: {
    get: () => ipcRenderer.invoke('t8pc:locale:get'),
    set: (locale) => ipcRenderer.invoke(
      't8pc:locale:set',
      locale === 'en-US' ? 'en-US' : 'zh-CN',
    ),
  },
  openExternal: (url) => ipcRenderer.invoke('t8pc:open-external', url),
  openPath: (targetPath) => ipcRenderer.invoke('t8pc:open-path', targetPath),
  pickMediaFiles: (options) => ipcRenderer.invoke('t8pc:pick-media-files', options || {}),
  pickDirectory: (options) => ipcRenderer.invoke('t8pc:pick-directory', options || {}),
  getPathForFile: (file) => {
    try {
      return webUtils?.getPathForFile?.(file) || '';
    } catch {
      return '';
    }
  },
  dragFileOut: (payload) => ipcRenderer.send('t8pc:drag-file-out', {
    url: typeof payload?.url === 'string' ? payload.url : '',
    path: typeof payload?.path === 'string' ? payload.path : '',
    filename: typeof payload?.filename === 'string' ? payload.filename : '',
    kind: typeof payload?.kind === 'string' ? payload.kind : '',
    requestId: typeof payload?.requestId === 'string' ? payload.requestId.slice(0, 120) : '',
  }),
  onDragFileOutStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('t8pc:drag-file-out-status', listener);
    return () => ipcRenderer.removeListener('t8pc:drag-file-out-status', listener);
  },
  parseAuth: {
    login: (profileId) => ipcRenderer.invoke('t8pc:parse-auth:login', profileId),
    getCookie: (profileId) => ipcRenderer.invoke('t8pc:parse-auth:get-cookie', profileId),
    listSaved: (profileId) => ipcRenderer.invoke('t8pc:parse-auth:list-saved', profileId),
    save: (profileId, cookieText, meta) => ipcRenderer.invoke('t8pc:parse-auth:save', profileId, cookieText, meta),
    load: (profileId) => ipcRenderer.invoke('t8pc:parse-auth:load', profileId),
    clear: (profileId) => ipcRenderer.invoke('t8pc:parse-auth:clear', profileId),
  },
  agentControl: {
    getConnectionSummary: () => ipcRenderer.invoke('t8pc:agent-control:connection-summary'),
    listPendingPairings: () => ipcRenderer.invoke('t8pc:agent-control:list-pending'),
    approvePairing: (input) => ipcRenderer.invoke('t8pc:agent-control:approve', {
      pairingId: typeof input?.pairingId === 'string' ? input.pairingId : '',
      userCode: typeof input?.userCode === 'string' ? input.userCode : '',
      approvedScopes: Array.isArray(input?.approvedScopes)
        ? input.approvedScopes.filter((scope) => typeof scope === 'string').slice(0, 16)
        : [],
    }),
    denyPairing: (pairingId) => ipcRenderer.invoke(
      't8pc:agent-control:deny',
      typeof pairingId === 'string' ? pairingId : '',
    ),
    listPendingApprovals: () => ipcRenderer.invoke('t8pc:agent-control:list-approvals'),
    approveOperation: (approvalRequestId) => ipcRenderer.invoke(
      't8pc:agent-control:approve-operation',
      typeof approvalRequestId === 'string' ? approvalRequestId : '',
    ),
    denyOperation: (approvalRequestId) => ipcRenderer.invoke(
      't8pc:agent-control:deny-operation',
      typeof approvalRequestId === 'string' ? approvalRequestId : '',
    ),
    onCanvasMutation: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('t8pc:agent-control:canvas-mutated', listener);
      return () => ipcRenderer.removeListener('t8pc:agent-control:canvas-mutated', listener);
    },
  },
  updater: {
    getStatus: () => ipcRenderer.invoke('t8pc:updater:status'),
    check: () => ipcRenderer.invoke('t8pc:updater:check'),
    download: () => ipcRenderer.invoke('t8pc:updater:download'),
    install: () => ipcRenderer.invoke('t8pc:updater:install'),
    onStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('t8pc:updater-status', listener);
      return () => ipcRenderer.removeListener('t8pc:updater-status', listener);
    },
  },
});
