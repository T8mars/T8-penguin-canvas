'use strict';

const crypto = require('node:crypto');
const REQUEST = 't8pc:agent-control:context-request';
const RESULT = 't8pc:agent-control:context-result';
const MAX_WINDOWS = 8;
const safeId = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 160 && !/[\s\u0000-\u001f\u007f/\\]/.test(value);

// Only explicitly supplied canvas windows are queried. Login, logs and DevTools
// are never discovered through BrowserWindow.getAllWindows(). No state is cached.
function createActiveContextProvider({ ipcMain, getWindows, isTrustedUrl, timeoutMs = 1500 }) {
  let flight = null;
  const capture = async () => {
    const all = [...new Set(getWindows())].filter((win) => win && !win.isDestroyed());
    const truncated = all.length > MAX_WINDOWS;
    const queried = all.slice(0, MAX_WINDOWS);
    const invalidated = new Set();
    const cleanups = [];
    try {
    const candidates = await Promise.all(queried.map((win) => new Promise((resolve) => {
      const wc = win.webContents;
      const windowId = String(win.id);
      const base = { windowId, rendererReady: false, projectId: null, canvasId: null, revision: null };
      let settled = false;
      let timer;
      const requestId = crypto.randomUUID();
      const frame = wc.mainFrame;
      const url = wc.getURL();
      const finish = (data, reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener(RESULT, onResult);
        resolve({ ...base, ...data, reason, observedAt: new Date().toISOString() });
      };
      const onGone = () => { invalidated.add(windowId); finish(null, 'window-unavailable'); };
      const onNavigation = (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) { invalidated.add(windowId); finish(null, 'window-reloading'); }
      };
      const onResult = (event, input) => {
        if (event.sender !== wc || event.senderFrame !== frame || input?.requestId !== requestId) return;
        if (win.isDestroyed() || wc.isDestroyed() || wc.mainFrame !== frame
          || wc.getURL() !== url || !isTrustedUrl(wc.getURL())) return finish(null, 'window-reloading');
        const data = input?.context;
        if (data?.ready !== true) return finish(null, 'canvas-not-ready');
        if (!safeId(data.projectId) || !safeId(data.canvasId)
          || !Number.isSafeInteger(data.revision) || data.revision < 1) return finish(null, 'invalid-metadata');
        finish({ rendererReady: true, projectId: data.projectId, canvasId: data.canvasId,
          revision: data.revision }, 'ready');
      };
      if (wc.isDestroyed() || !isTrustedUrl(url) || wc.isLoadingMainFrame()) return finish(null, 'window-not-ready');
      ipcMain.on(RESULT, onResult);
      wc.on('did-start-navigation', onNavigation);
      wc.on('render-process-gone', onGone);
      wc.on('destroyed', onGone);
      win.on('closed', onGone);
      cleanups.push(() => {
        ipcMain.removeListener(RESULT, onResult);
        clearTimeout(timer);
        wc.removeListener('did-start-navigation', onNavigation);
        wc.removeListener('render-process-gone', onGone);
        wc.removeListener('destroyed', onGone);
        win.removeListener('closed', onGone);
      });
      timer = setTimeout(() => finish(null, 'renderer-timeout'), timeoutMs);
      try { wc.send(REQUEST, requestId); } catch { finish(null, 'window-unavailable'); }
    })));
    // Recheck focus and membership after the asynchronous replies. A window that
    // appeared meanwhile makes this snapshot ambiguous, rather than invisible.
    const current = [...new Set(getWindows())].filter((win) => win && !win.isDestroyed());
    const changed = current.length !== all.length || current.some((win) => !all.includes(win));
    for (const candidate of candidates) {
      const win = current.find((item) => String(item.id) === candidate.windowId);
      candidate.windowReady = Boolean(!invalidated.has(candidate.windowId) && win && !win.webContents.isDestroyed()
        && isTrustedUrl(win.webContents.getURL()) && !win.webContents.isLoadingMainFrame());
      candidate.focused = Boolean(win && win.isFocused() && !win.isMinimized());
      if (!candidate.windowReady) Object.assign(candidate, baseUnavailable(
        invalidated.has(candidate.windowId) ? 'window-unavailable' : candidate.reason,
      ));
    }
    const focused = candidates.filter((candidate) => candidate.focused);
    const selected = !truncated && !changed && (focused.length === 1
      ? focused[0] : candidates.length === 1 ? candidates[0] : null);
    const resolved = selected?.windowReady && selected?.rendererReady;
    let status = candidates.length ? 'not-ready' : 'unavailable';
    if (truncated || changed || candidates.length > 1 && !selected) status = 'ambiguous';
    if (resolved) status = 'resolved';
    return {
      status,
      resolution: resolved ? focused.length === 1 ? 'focused-window' : 'single-window' : null,
      activeWindowId: resolved ? selected.windowId : null,
      candidates, truncated, observedAt: new Date().toISOString(),
    };
    } finally { for (const cleanup of cleanups) cleanup(); }
  };
  return () => {
    // Bound native IPC work under concurrent Agent polling, never reuse a
    // completed snapshot. Errors propagate to the fail-closed control service.
    if (!flight) flight = capture().finally(() => { flight = null; });
    return flight;
  };
}

function baseUnavailable(reason) {
  return { rendererReady: false, projectId: null, canvasId: null, revision: null, reason };
}

module.exports = { createActiveContextProvider };
