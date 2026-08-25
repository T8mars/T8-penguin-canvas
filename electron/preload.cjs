// preload.cjs — 暴露最小信息给 BrowserWindow 渲染进程
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('t8pc', {
  getInfo: () => ipcRenderer.invoke('t8pc:get-info'),
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
