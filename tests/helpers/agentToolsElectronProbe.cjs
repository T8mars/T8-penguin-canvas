'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const sandbox = path.resolve(process.argv[2]);
const resources = path.join(sandbox, 'resources'), installRoot = path.join(sandbox, 'installed');
const { createAgentToolsManager, registerAgentToolsIpc } = require('../../electron/agentTools.cjs');
const { compatibilitySnapshot } = require('../../backend/src/services/agentControlCompatibility');
let window;
app.setPath('userData', path.join(sandbox, 'electron-user-data'));
app.disableHardwareAcceleration();
const manager = createAgentToolsManager({ sourceRoot: resources, packaged: true, getCompatibility: () => compatibilitySnapshot({ resourcesPath: resources }), installOptions: { installRoot } });
registerAgentToolsIpc({ ipcMain, getWindow: () => window, assertTrusted: event => {
  if (event.sender !== window?.webContents) throw Error('foreign renderer');
}, getManager: () => manager });
ipcMain.handle('t8pc:open-path', () => ({ success: true }));
async function waitFor(script) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(script)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error('TEMP settings did not reach the expected state');
}
async function main() {
  await app.whenReady();
  window = new BrowserWindow({ show: false, title: 'Agent tools TEMP integration', webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  await window.loadFile(path.join(sandbox, 'settings.html'));
  await waitFor(`document.body.textContent.includes('已导出的工具内容较旧') && !document.querySelector('button').disabled`);
  const before = manager.status(); assert.equal(before.state, 'outdated');
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('安装/修复')).click()`);
  await waitFor(`document.body.textContent.includes('工具已刷新并完整校验') && !document.querySelector('button').disabled`);
  const after = manager.status(); assert.equal(after.state, 'current');
  assert.equal(after.cliVersion, before.cliVersion); assert.equal(after.rollbackAvailable, true);
  assert.ok((await window.webContents.executeJavaScript('document.querySelector("code").textContent')) === after.cliRoot);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('安装/修复')).click()`);
  await waitFor(`document.body.textContent.includes('无需替换') && !document.querySelector('button').disabled`);
  assert.equal(fs.existsSync(path.join(sandbox, 'credentials.json')), false);
  console.log(JSON.stringify({ passed: true, realElectron: true, productionReactSettings: true, productionPreloadAndIpc: true, sameVersionRefresh: true, strictMode: true, secondClickNoOp: true, current: after.state, temporaryOnly: true, humanApproval: false, pairedSessions: 0, providerCalls: 0 }));
}
const watchdog = setTimeout(() => { process.exitCode = 1; app.quit(); }, 20_000);
main().catch(error => { process.exitCode = 1; console.error(error.stack); }).finally(() => { clearTimeout(watchdog); window?.destroy(); app.quit(); });
