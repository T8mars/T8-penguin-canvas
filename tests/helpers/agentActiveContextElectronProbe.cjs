'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { createActiveContextProvider } = require('../../electron/agentContext.cjs');
const { createAgentControlContextService } = require('../../backend/src/services/agentControlContext');
const sandbox = path.resolve(process.argv[2]);
const reportPath = path.join(sandbox, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify({ passed: false, stage: 'starting' }));
app.setPath('userData', path.join(sandbox, 'electron-user-data'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const page = path.join(sandbox, 'context.html');
let windows = [];
const provider = createActiveContextProvider({ ipcMain, getWindows: () => windows,
  isTrustedUrl: value => { try { return path.resolve(fileURLToPath(value)) === page; } catch { return false; } }, timeoutMs: 1500 });
const contextService = createAgentControlContextService(); contextService.setProvider(provider);
const snapshot = () => contextService.snapshot('EXAMPLE_TEMP_INSTANCE');
async function create() {
  const win = new BrowserWindow({ show: false, title: 'TEMP active context', webPreferences: {
    preload: path.resolve(__dirname, '../../electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  windows.push(win); await win.loadFile(page);
  assert.equal(await win.webContents.executeJavaScript('window.exampleReady'), true); return win;
}
const source = canvasId => ({ loaded: true, canvasId, currentCanvasId: canvasId, loadedCanvasId: canvasId,
  initializedCanvasId: canvasId, projectId: 'project-local', revision: 9 });
async function set(win, value) { await win.webContents.executeJavaScript(`window.exampleSetContext(${JSON.stringify(value)})`); }
async function main() {
  await app.whenReady();
  const a = await create(); assert.equal((await snapshot()).status, 'not-ready');
  await set(a, source('EXAMPLE_A'));
  let state = await snapshot(); assert.equal(state.status, 'resolved', JSON.stringify({ state,
    url: a.webContents.getURL(), expected: pathToFileURL(page).href, loading: a.webContents.isLoadingMainFrame(), destroyed: a.isDestroyed() })); assert.equal(state.candidates[0].canvasId, 'EXAMPLE_A');
  await set(a, { ...source('EXAMPLE_A'), currentCanvasId: 'EXAMPLE_B' });
  assert.equal((await snapshot()).status, 'not-ready');
  await set(a, source('EXAMPLE_B')); assert.equal((await snapshot()).candidates[0].canvasId, 'EXAMPLE_B');
  a.webContents.send('t8pc:canvas-close-request', 'EXAMPLE_TEMP_CLOSE');
  assert.equal((await snapshot()).status, 'not-ready');
  a.webContents.send('t8pc:canvas-close-cancel', 'EXAMPLE_TEMP_CLOSE');
  assert.equal((await snapshot()).status, 'resolved');
  const b = await create(); await set(b, source('EXAMPLE_SECOND'));
  state = await snapshot(); assert.equal(state.status, 'ambiguous'); assert.equal(state.candidates.length, 2);
  assert.equal(state.activeWindowId, null);
  const reloaded = new Promise(resolve => a.webContents.once('did-finish-load', resolve));
  a.reload(); await reloaded;
  state = await snapshot(); assert.equal(state.candidates.find(row => row.windowId === String(a.id)).canvasId, null);
  a.destroy(); windows = [b];
  assert.equal((await snapshot()).activeWindowId, String(b.id));
  b.destroy(); windows = []; assert.equal((await snapshot()).status, 'unavailable');
  const restarted = await create(); assert.equal((await snapshot()).status, 'not-ready');
  await set(restarted, source('EXAMPLE_RESTART')); assert.equal((await snapshot()).candidates[0].canvasId, 'EXAMPLE_RESTART');
  assert.equal(ipcMain.listenerCount('t8pc:agent-control:context-result'), 0);
  const report = { passed: true, realElectron: true, productionPreload: true, productionCanvasReporter: true,
    freshQueries: true, multipleWindows: true, reload: true, restart: true, userDatabaseRead: false,
    humanApproval: false, providerCalls: 0 };
  fs.writeFileSync(reportPath, JSON.stringify(report));
  console.log(JSON.stringify(report));
}
const watchdog = setTimeout(() => { process.exitCode = 1; app.quit(); }, 25_000);
main().catch(error => { process.exitCode = 1; fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: error.stack })); console.error(error.stack); }).finally(() => {
  clearTimeout(watchdog); for (const win of windows) if (!win.isDestroyed()) win.destroy(); app.quit();
});
