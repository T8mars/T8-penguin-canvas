'use strict';
// Isolated native Electron/IPC/DOM + real SQLite/HTTP drain. No updater download,
// NSIS payload, existing profile, provider call or user canvas is used.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = process.argv[2];
const project = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(root, 'electron-profile'));
app.disableHardwareAcceleration();
process.env.T8_FIGMA_BRIDGE_AUTOSTART = '0';
process.env.T8PC_STARTUP_MAINTENANCE_FALLBACK_MS = '300000';
process.env.T8_COLLAB_MANAGEMENT_TOKEN = 'E'.repeat(43);
process.env.ZCANVAS_INSTANCE_DIR = path.join(root, 'instances');
let backend, window;
const watchdog = setTimeout(() => { console.error('isolated update exit timed out'); app.exit(1); }, 25_000);
function transpile(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
app.whenReady().then(async () => {
  const config = require('../../backend/src/config');
  Object.assign(config, {
    HOST: '127.0.0.1', PORT: 0, HTTP_SHUTDOWN_TIMEOUT_MS: 100,
    DATA_DIR: path.join(root, 'data'), INPUT_DIR: path.join(root, 'input'),
    OUTPUT_DIR: path.join(root, 'output'), THUMBNAILS_DIR: path.join(root, 'thumbnails'),
    ASSET_PREVIEWS_DIR: path.join(root, 'thumbnails/previews'),
    ASSET_BLOB_DIR: path.join(root, 'data/blobs'),
    COLLAB_UPLOAD_TEMP_DIR: path.join(root, 'data/uploads'),
    PROJECT_DB_FILE: path.join(root, 'data/projects.sqlite3'),
    PROJECT_DB_BACKUP_FILE: path.join(root, 'data/projects.sqlite3.backup'),
    PROJECT_DB_STORAGE_POLICY_32: require('./startupStoragePolicy32.cjs'),
  });
  for (const directory of [config.DATA_DIR, config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) fs.mkdirSync(directory, { recursive: true });
  backend = require('../../backend/src/server');
  await backend.serverStartPromise;
  const { getProjectDatabase, ProjectDatabase } = require('../../backend/src/services/projectDatabase');
  const database = getProjectDatabase();
  let saveCalls = 0, launches = 0, lateWriteRead = false;
  let releaseWriter, writerStarted;
  const writerGate = new Promise(resolve => { releaseWriter = resolve; });
  const started = new Promise(resolve => { writerStarted = resolve; });
  backend.app.get('/__isolated-update-writer', async (_req, res) => {
    writerStarted(); await writerGate;
    lateWriteRead = database.db.prepare('SELECT 1 AS ok').get().ok === 1;
    res.end('done');
  });
  const client = http.get(`http://127.0.0.1:${backend.server.address().port}/__isolated-update-writer`);
  client.on('error', () => {}); await started;
  const preload = path.join(root, 'probe-preload.cjs');
  fs.writeFileSync(preload, `require(${JSON.stringify(path.join(project, 'electron/preload.cjs'))});
    require('electron').contextBridge.exposeInMainWorld('probe', {save:()=>require('electron').ipcRenderer.invoke('probe:save')});`);
  window = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: false, contextIsolation: true } });
  ipcMain.handle('probe:save', event => {
    assert.equal(event.sender, window.webContents);
    assert.equal(event.senderFrame, window.webContents.mainFrame);
    saveCalls++;
    return database.saveCanvasSnapshot('isolated-update', {
      name: 'saved before update', nodes: [{ id: 'text', type: 'text', position: { x: 0, y: 0 }, data: { text: 'durable' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    }, { expectedRevision: 0 });
  });
  await window.loadURL('data:text/html,<html><body><div id="root"><input value="draft"></div></body></html>');
  const guard = fs.readFileSync(path.join(project, 'src/components/CanvasCloseGuard.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const effectStart = guard.indexOf('  useEffect(() => {');
  const effectEnd = guard.indexOf('  }, [runtime, t]);', effectStart) + '  }, [runtime, t]);'.length;
  const saveCode = transpile(fs.readFileSync(path.join(project, 'src/utils/canvasCloseSave.ts'), 'utf8'));
  await window.webContents.executeJavaScript(`
    (() => { const exports={}; ${saveCode}; globalThis.waitForCanvasCloseSave=exports.waitForCanvasCloseSave; })();
    globalThis.useEffect=callback=>{globalThis.releaseProbe=callback();};
    globalThis.t=key=>key;
    let dirty=true, queued=false;
    globalThis.runtime={closeObserver:{prepare(){},read:()=>({dirty,queued}),flush(){
      if(queued)return; queued=true; window.probe.save().then(()=>{dirty=false;queued=false;});
    }}};
    ${transpile(guard.slice(effectStart, effectEnd))}
  `);
  const main = fs.readFileSync(path.join(project, 'electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const gate = main.slice(main.indexOf('function createCanvasCloseGate('), main.indexOf('\nlet vibeXRhLoginWindow'));
  const operations = main.slice(main.indexOf('async function checkForUpdatesByUser()'), main.indexOf('function startInitialUpdateCheck()'));
  const shutdown = main.slice(main.indexOf('function settleWithinElectronDeadline('), main.indexOf('// ---------- 创建主窗口'));
  const quit = main.slice(main.indexOf("app.on('before-quit', (event) => {"));
  const phases = [];
  let updater = { quitAndInstall() { app.quit(); } };
  if (process.argv.includes('--real-nsis')) {
    const executable = path.join(root, 'isolated-installer.exe');
    const source = path.join(root, 'isolated-installer.nsi');
    // This silent test installer only waits for THIS probe PID and writes one
    // marker in its fresh TEMP directory. No files/registry/product are installed.
    fs.writeFileSync(source, `Unicode true
Name "T8 isolated update exit test"
OutFile "${executable}"
SilentInstall silent
RequestExecutionLevel user
Section
  System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i ${process.pid}) p.r0'
  StrCmp $0 0 confirmed
  System::Call 'kernel32::WaitForSingleObject(p r0, i 10000) i.r1'
  System::Call 'kernel32::CloseHandle(p r0)'
  StrCmp $1 0 confirmed failed
confirmed:
  FileOpen $0 "$EXEDIR\\installer-result.txt" w
  FileWrite $0 "old-process-exited"
  FileClose $0
  Quit
failed:
  SetErrorLevel 3
SectionEnd
`);
    const compilation = spawnSync(process.env.T8_TEST_MAKENSIS, ['/V2', source], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
    const { NsisUpdater } = require('electron-updater');
    updater = new NsisUpdater();
    updater.autoInstallOnAppQuit = false;
    updater.logger = { info() {}, warn() {}, error() {} };
    updater.downloadedUpdateHelper = { file: executable, downloadedFileInfo: { isAdminRightsRequired: false } };
    updater.on('error', error => { console.error(error.stack); app.exit(1); });
  }
  const launch = updater.quitAndInstall.bind(updater);
  updater.quitAndInstall = (...args) => {
    assert.equal(database.db.open, false); assert.equal(backend.server.listening, false);
    launches++; launch(...args);
  };
  const context = vm.createContext({
    app, ipcMain, crypto, setTimeout, clearTimeout, setImmediate, process,
    mainWindow: window, backendModule: backend, backendStartPromise: null,
    agentControlMutationUnsubscribe: null, stopLegacyBackendProcess() {},
    ELECTRON_SINGLE_INSTANCE_OWNER: true, ELECTRON_BACKEND_SHUTDOWN_DEADLINE_MS: 250,
    ELECTRON_UPDATE_SHUTDOWN_GRACE_MS: 5_000, autoUpdater: updater,
    electronT: key => key, normalizeError: error => error.message, dbgLog() {},
    ensureAutoUpdater: () => ({ ok: true, updater }),
    emitUpdaterStatus: patch => { phases.push(patch.messageKey); return patch; },
    dialog: { showMessageBox: async () => { throw new Error('unexpected save refusal'); } },
  });
  vm.runInContext(`let backendShutdownPromise=null, backendShutdownCompletionPromise=null, backendShutdownComplete=false;
    let electronQuitRequested=false,electronQuitReady=false,electronQuitFinalizationPromise=null;
    let updaterInstallPromise=null,updaterInstallQueued=false,dataStorageRestartPending=false;
    let updaterState={downloaded:true}; ${gate}; let mainWindowCloseGate=createCanvasCloseGate(mainWindow);
    ${operations}\n${shutdown}\n${quit}`, context);
  const pending = vm.runInContext('installDownloadedUpdate()', context);
  while (!phases.includes('updater.waitingForStorage')) await new Promise(resolve => setTimeout(resolve, 10));
  const hold = await window.webContents.executeJavaScript(`({inert:document.getElementById('root').inert,text:document.querySelector('[data-canvas-close-hold]').textContent})`);
  // Native DOM polling may lag IPC by one 50ms UI turn; verify the saved hold,
  // then release real server work. It must still have a live database here.
  assert.equal(hold.inert, true); assert.match(hold.text, /savedBeforeClose|waitingBeforeClose/);
  assert.equal(database.db.open, true); assert.equal(launches, 0); assert.equal(saveCalls, 1);
  app.once('will-quit', () => {
    try {
      assert.equal(launches, 1); assert.equal(lateWriteRead, true);
      const reopened = new ProjectDatabase(config.PROJECT_DB_FILE, { projectDatabaseStoragePolicy32: config.PROJECT_DB_STORAGE_POLICY_32 });
      assert.equal(reopened.getCanvas('isolated-update').nodes[0].data.text, 'durable');
      void reopened.close(); clearTimeout(watchdog);
      console.log('T8_UPDATE_EXIT_RESULT=' + JSON.stringify({ saveCalls, launches, storageClosed: !database.db.open, lateWriteRead, reopened: true, phases }));
    } catch (error) { console.error(error.stack); process.exitCode = 1; }
  });
  releaseWriter();
  assert.equal((await pending).success, true);
}).catch(async error => {
  console.error(error.stack); clearTimeout(watchdog);
  window?.destroy();
  try { await backend?.gracefulShutdown(); } catch {}
  app.exit(1);
});
