'use strict';
// Hidden full packaged App + native IPC/CAS/SQLite/real electron-updater.
// TEMP feed and harmless NSIS only: never installs or changes a user profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const http = require('node:http'), cp = require('node:child_process');
const project = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(100); }
  throw Error(label);
}

async function electronMain() {
  const { app, BrowserWindow, session, dialog } = require('electron');
  const scratch = process.env.T8_UPDATE_FIXTURE_ROOT;
  assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
  assert.ok(path.basename(scratch).startsWith('t8-update-full-'));
  const resources = process.env.T8_UPDATE_FIXTURE_RESOURCES;
  const scenario = process.env.T8_UPDATE_TEST_SCENARIO || 'late';
  assert.ok(['late', 'timeout', 'conflict'].includes(scenario));
  const closeWarnings = [];
  if (scenario === 'conflict') dialog.showMessageBox = async (_window, options) => {
    // Display suppression for this test only; do not change refusal/IPC logic.
    assert.equal(options.type, 'warning'); assert.equal(options.buttons.length, 1);
    closeWarnings.push(options.message); return { response: 0 };
  };
  const mainFile = path.join(resources, 'app.asar/electron/main.cjs');
  const version = JSON.parse(fs.readFileSync(path.join(resources, 'app.asar/package.json'))).version;
  const profile = path.join(scratch, 'profile');
  fs.mkdirSync(path.join(profile, 'data'), { recursive: true });
  app.setPath('userData', profile); app.setPath('sessionData', profile);
  Object.defineProperty(process, 'resourcesPath', { value: resources });
  Object.defineProperty(app, 'isPackaged', { value: true }); app.getVersion = () => version;
  app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu');
  for (const name of ['show', 'showInactive', 'focus']) BrowserWindow.prototype[name] = function () {};
  app.on('browser-window-created', (_event, win) => {
    win.setSkipTaskbar(true); win.webContents.setBackgroundThrottling(false);
  });
  let blockedRequests = 0;
  app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const url = new URL(details.url);
    const blocked = ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname);
    if (blocked) blockedRequests++; done({ cancel: blocked });
  }));
  fs.writeFileSync(path.join(profile, 'data/settings.json'), JSON.stringify({
    canvasAutoSavePath: path.join(scratch, 'mirrors'), autoSavePath: path.join(scratch, 'outputs'),
    resourceLibraryPath: path.join(scratch, 'resources'),
  }));
  const Module = require('node:module'), originalLoad = Module._load;
  let database, config, writerRelease, writerStarted = false, writerFinished = false;
  const id = 'update-fixture-' + crypto.randomUUID();
  Module._load = function (request, parent, isMain) {
    const value = originalLoad.apply(this, arguments);
    let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch {}
    if (resolved === path.join(resources, 'backend-enc/config.t8c')) {
      assert.ok(path.resolve(value.PROJECT_DB_FILE).startsWith(profile + path.sep));
      value.PROJECT_DB_STORAGE_POLICY_32 = require('../tests/helpers/startupStoragePolicy32.cjs'); config = value;
    }
    if (request === path.join(resources, 'backend-enc/server.t8c')) {
      assert.ok(config);
      database = originalLoad(path.join(resources, 'backend-enc/services/projectDatabase.t8c'), parent, false).getProjectDatabase();
      database.ensureCanvas(id, { name: 'Synthetic update exit', nodes: [{ id: 'text-1',
        entityUid: crypto.randomUUID(), type: 'text', position: { x: 80, y: 80 }, data: { prompt: 'BASE' },
      }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
      value.app.get('/__update_fixture_writer', async (_req, res) => {
        writerStarted = true; await new Promise(resolve => { writerRelease = resolve; });
        assert.equal(database.db.open, true); writerFinished = true; res.end('done');
      });
      // The packaged SPA fallback otherwise consumes this test URL. Keep the
      // production request tracker ahead of it, exactly as for /api/status.
      const layer = value.app._router.stack.pop();
      const beforeStatus = value.app._router.stack.findIndex(item => item.route?.path === '/api/status');
      assert.ok(beforeStatus > 0); value.app._router.stack.splice(beforeStatus, 0, layer);
    }
    return value;
  };
  const product = new Module(mainFile, module);
  product.filename = mainFile; product.paths = Module._nodeModulePaths(path.dirname(mainFile));
  // Untouched product main plus an observer in its lexical scope. No product
  // save/close/update function is replaced, extracted, or given short deadlines.
  product._compile(fs.readFileSync(mainFile, 'utf8') + `
    // Test network configuration only: never reuse the public desktop port.
    developmentBackendPortPreference=()=>Number(process.env.T8_UPDATE_FIXTURE_PORT);
    globalThis.updateFixtureMain={get window(){return mainWindow;},get backend(){return backendModule;},
      get state(){return {status:updaterState,complete:backendShutdownComplete};},
      configureFeed(url,cache){const r=ensureAutoUpdater();if(!r.ok)throw Error('Updater unavailable');
        Object.defineProperty(r.updater.app,'baseCachePath',{get:()=>cache});
        r.updater.disableDifferentialDownload=true;r.updater.setFeedURL({provider:'generic',url});}};`, mainFile);
  const report = { version, scenario, backendPort: Number(process.env.T8_UPDATE_FIXTURE_PORT), cases: [], errors: [], blockedRequests: 0 };
  const write = () => fs.writeFileSync(path.join(scratch, 'child-result.json'), JSON.stringify(report, null, 2));
  const checkpoint = phase => { report.phase = phase; write(); console.log('UPDATE_FIXTURE_PHASE=' + phase); };
  const recordQuit = () => {
    report.quit = { storageClosed: !database.db.open, writerFinished,
      httpClosed: !globalThis.updateFixtureMain.backend.server.listening,
      complete: globalThis.updateFixtureMain.state.complete,
      allWindowsHidden: BrowserWindow.getAllWindows().every(item => !item.isVisible()) };
    report.blockedRequests = blockedRequests; write();
  };
  let writer, feed, releaseSave, completed = false;
  try {
    checkpoint('wait for full product main');
    await until(() => !!globalThis.updateFixtureMain?.window, 'Product main window missing', 120_000);
    assert.equal(globalThis.updateFixtureMain.backend.server.address().port, report.backendPort);
    assert.notEqual(report.backendPort, 18766);
    const win = globalThis.updateFixtureMain.window;
    win.webContents.on('render-process-gone', (_event, info) => report.errors.push('Renderer: ' + info.reason));
    const js = async code => {
      let timer;
      try { return await Promise.race([win.webContents.executeJavaScript(code, true),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned renderer command deadline')), 8_000); })]); }
      finally { clearTimeout(timer); }
    };
    const compiler = process.env.T8_TEST_MAKENSIS || path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe');
    const installer = path.join(scratch, 'test-update.exe'), source = path.join(scratch, 'test-update.nsi');
    fs.writeFileSync(source, `Unicode true\nName "T8 TEMP update proof"\nOutFile "${installer}"\nSilentInstall silent\nRequestExecutionLevel user\nSection\n System::Call 'kernel32::OpenProcess(i 0x100000,i 0,i ${process.pid}) p.r0'\n StrCmp $0 0 confirmed\n System::Call 'kernel32::WaitForSingleObject(p r0,i 15000) i.r1'\n System::Call 'kernel32::CloseHandle(p r0)'\n StrCmp $1 0 confirmed failed\nconfirmed:\n FileOpen $0 "${path.join(scratch, 'installer-result.txt')}" w\n FileWrite $0 "old-process-exited"\n FileClose $0\n Quit\nfailed:\n SetErrorLevel 3\nSectionEnd\n`);
    const compile = cp.spawnSync(compiler, ['/V2', source], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const payload = fs.readFileSync(installer), digest = crypto.createHash('sha512').update(payload).digest('base64');
    feed = http.createServer((req, res) => {
      if (req.url.startsWith('/latest.yml')) res.end(`version: 9.9.9\nfiles:\n  - url: test-update.exe\n    sha512: ${digest}\n    size: ${payload.length}\npath: test-update.exe\nsha512: ${digest}\n`);
      else if (req.url.startsWith('/test-update.exe')) { res.setHeader('Content-Length', payload.length); res.end(payload); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise(resolve => feed.listen(0, '127.0.0.1', resolve));
    globalThis.updateFixtureMain.configureFeed(`http://127.0.0.1:${feed.address().port}`, path.join(scratch, 'updater-cache'));
    checkpoint('wait for actual compiled Canvas');
    await until(() => js(`!!document.querySelector('.t8-sidebar-node[data-canvas-node-ready=true]')`), 'Full Canvas not interactive', 120_000);
    await js(`document.querySelector('.t8-startup-poster__close')?.click()`);
    await until(() => js(`!!document.querySelector('.react-flow__node[data-id=text-1] [contenteditable=true]')`), 'Seeded text node not rendered');
    assert.ok(BrowserWindow.getAllWindows().every(item => !item.isVisible()));
    checkpoint('real updater checks and downloads harmless TEMP NSIS');
    // Let the product's scheduled initial check finish before the manual one.
    await pause(3_000);
    assert.equal((await js('window.t8pc.updater.check()')).success, true);
    assert.equal((await js('window.t8pc.updater.download()')).success, true);
    assert.equal((await js('window.t8pc.updater.getStatus()')).downloaded, true);
    await new Promise(resolve => feed.close(resolve)); feed = null;
    writer = http.get(`http://127.0.0.1:${globalThis.updateFixtureMain.backend.server.address().port}/__update_fixture_writer`);
    writer.on('error', () => {}); await until(() => writerStarted, 'Late writer not accepted');
    checkpoint('edit actual text node with one delayed CAS request');
    // Hold the actual renderer fetch, not a synthetic save observer or ACK.
    releaseSave = () => js('window.updateFixtureRelease?.()');
    await js(`(() => { const original=window.fetch;let held=false;window.updateFixturePutStarted=false;
      window.fetch=async(...args)=>{const url=typeof args[0]==='string'?args[0]:args[0].url;
        if(!held&&new URL(url,location.href).pathname===${JSON.stringify('/api/canvas/' + id)}&&(args[1]?.method||'GET')==='PUT'){
          held=true;
          window.updateFixturePutStarted=true;await new Promise(resolve=>{window.updateFixtureRelease=resolve;});}
        return original(...args);};
      const el=document.querySelector('.react-flow__node[data-id=text-1] [contenteditable=true]');
      el.focus();const range=document.createRange();range.selectNodeContents(el);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);})()`);
    await win.webContents.insertText('DURABLE_BEFORE_AUTO_UPDATE');
    await js(`document.querySelector('.react-flow__node[data-id=text-1] [contenteditable=true]').blur()`);
    await until(() => js('window.updateFixturePutStarted'), 'Actual Canvas autosave not observed');
    if (scenario === 'conflict') {
      const remote = database.getCanvas(id); remote.nodes[0].data.prompt = 'REMOTE_CONFLICT';
      database.saveCanvasSnapshot(id, remote, { expectedRevision: remote.revision });
    }
    checkpoint('actual dirty Canvas native save gate');
    await js(`void window.t8pc.updater.install().catch(()=>{})`);
    await until(() => js('document.getElementById("root").inert'), 'Native close hold missing');
    assert.equal(globalThis.updateFixtureMain.state.complete, false);
    await releaseSave(); releaseSave = null;
    if (scenario === 'conflict') {
      await until(() => globalThis.updateFixtureMain.state.status.messageKey === 'updater.closeBlocked', 'Conflicted save not refused');
      await until(() => js(`!document.getElementById('root').inert&&!document.querySelector('[data-canvas-close-hold]')&&!!document.querySelector('[data-canvas-save-conflict]')`), 'Conflict notice hidden behind saving hold');
      assert.equal(globalThis.updateFixtureMain.backend.server.listening, true);
      assert.equal(database.db.open, true); assert.equal(closeWarnings.length, 1);
      assert.equal(database.getCanvas(id).nodes[0].data.prompt, 'REMOTE_CONFLICT');
      assert.equal(await js(`document.querySelector('.react-flow__node[data-id=text-1] [contenteditable=true]').textContent`), 'DURABLE_BEFORE_AUTO_UPDATE');
      report.cases.push('Real 409 conflict blocks update before backend shutdown', 'Saving hold and inert state are removed, leaving actual conflict controls reachable', 'Both local draft and authoritative text remain unchanged');
      // Only the synthetic draft is explicitly resolved for clean test disposal.
      await js(`Array.from(document.querySelectorAll('[data-canvas-save-conflict] button')).find(el=>el.textContent==='保留本地修改并合并保存').click()`);
      await js(`Array.from(document.querySelectorAll('[data-canvas-save-conflict] button')).find(el=>el.textContent==='确认处理').click()`);
      await until(() => database.getCanvas(id).nodes[0].data.prompt === 'DURABLE_BEFORE_AUTO_UPDATE', 'Explicit synthetic conflict resolution failed');
      await until(() => js(`!document.querySelector('[data-canvas-save-conflict]')`), 'Synthetic conflict controls remained');
      writerRelease(); await until(() => writerFinished, 'Writer disposal failed');
      app.once('will-quit', recordQuit); completed = true;
      checkpoint('conflict correctly refused; normal test disposal'); app.quit(); return;
    }
    await until(() => globalThis.updateFixtureMain.state.status.messageKey === 'updater.waitingForStorage', 'Slow-close phase missing', 25_000);
    assert.equal(database.getCanvas(id).nodes[0].data.prompt, 'DURABLE_BEFORE_AUTO_UPDATE');
    const hold = await js('document.querySelector("[data-canvas-close-hold]").textContent');
    if (process.env.T8_UPDATE_REQUIRE_TRANSPORT_FENCE === '1') {
      await until(() => js(`document.querySelector('[data-canvas-close-hold]')?.getAttribute('data-canvas-close-phase')==='waiting'`), 'Packaged transport phase fence missing');
      // Observe a complete production polling interval without shortening it.
      // The compiled API guard must stop requests before even reaching fetch.
      await js(`window.updateFixtureRequests=[];const before=window.fetch;window.fetch=(...args)=>{window.updateFixtureRequests.push(typeof args[0]==='string'?args[0]:args[0].url);return before(...args);};void 0;`);
      await pause(16_000);
      const requests = await js(`window.updateFixtureRequests.filter(url=>new URL(url,location.href).pathname==='/api/status')`);
      assert.deepEqual(requests, [], 'Compiled App re-probed backend after save ACK');
      report.transportFence = true;
      report.cases.push('Compiled release phase fence prevents backend health requests for a full production polling interval');
    }
    assert.ok(!hold.includes('正在保存画布，保存完成后自动关闭'), hold);
    assert.equal(fs.existsSync(path.join(scratch, 'installer-result.txt')), false);
    report.cases.push('Actual compiled Canvas edit and native IPC await real CAS save', 'Editing remains inert while closing', 'Real 15-second deadline changes saving to bounded waiting');
    if (scenario === 'timeout') {
      checkpoint('wait through unchanged production 105-second grace');
      await until(() => globalThis.updateFixtureMain.state.status.status === 'error', 'Finite failure state missing', 112_000);
      await until(() => js(`!document.querySelector('[data-canvas-close-hold] button').parentElement.hidden`), 'Failure actions hidden');
      assert.equal(await js('document.getElementById("root").inert'), true);
      assert.equal(globalThis.updateFixtureMain.state.complete, false);
      assert.equal(fs.existsSync(path.join(scratch, 'installer-result.txt')), false);
      assert.equal(globalThis.updateFixtureMain.state.status.messageKey, 'updater.installFailedRestart');
      report.cases.push('Actual 120-second failure exposes retry/export above the inert Canvas without launching NSIS');
    }
    checkpoint('release writer, require actual storage close before installer');
    app.once('will-quit', recordQuit);
    completed = true; writerRelease();
    if (scenario === 'timeout') {
      await js(`document.querySelector('[data-canvas-close-hold] button').click()`);
    }
  } catch (error) {
    report.failure = String(error.stack).slice(0, 3500); write(); throw error;
  } finally {
    if (!completed) { await releaseSave?.().catch(() => {}); writerRelease?.(); writer?.destroy(); feed?.close(); setTimeout(() => app.quit(), 0); }
  }
}

async function main() {
  assert.equal(process.platform, 'win32');
  const budget = require('./history-low-load-memory.cjs').inspectHistoryMemoryBudget();
  if (process.env.T8_UPDATE_TEST_SCENARIO === 'native-fence') {
    const evidence = path.join(project, 'local-private/update-full-app-20261021', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT, '.json'));
    fs.mkdirSync(evidence, { recursive: true });
    const run = cp.spawnSync(process.execPath, ['--max-old-space-size=768', '--test', '--test-concurrency=1',
      'tests/canvasExitTransport.test.cjs', 'tests/electronUpdateExitIntegration.test.cjs'], {
      encoding: 'utf8', windowsHide: true, timeout: 100_000,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=768' },
    });
    fs.writeFileSync(path.join(evidence, 'native-fence.log'), run.stdout + run.stderr, { flag: 'wx' });
    console.log(run.stdout); assert.equal(run.status, 0, String(run.error || '') + run.stderr);
    return;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 't8-update-full-'));
  const evidence = path.join(project, 'local-private/update-full-app-20261021', path.basename(process.env.T8_ACCEPTANCE_RUNNER_RECEIPT, '.json'));
  fs.mkdirSync(evidence, { recursive: true });
  const report = { passed: false, budget,
    boundary: 'Frozen packaged main/preload/encrypted backend/full compiled Canvas; hidden Electron/TEMP profile/feed/harmless NSIS. Not an in-place installation or the affected user database.' };
  const resources = path.resolve(process.env.T8_UPDATE_TEST_RESOURCES || path.join(project, 'dist_electron/win-unpacked/resources'));
  report.packagedMainSha256 = crypto.createHash('sha256').update(require('@electron/asar').extractFile(path.join(resources, 'app.asar'), 'electron/main.cjs')).digest('hex');
  let child, closed = false;
  try {
    // Reserve both random ports simultaneously, then release immediately before
    // startup. A closing real window must never reconnect to this TEMP server.
    const ports = [http.createServer(), http.createServer()];
    await Promise.all(ports.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
    const [backendPort, collaborationPort] = ports.map(server => server.address().port);
    await Promise.all(ports.map(server => new Promise(resolve => server.close(resolve))));
    assert.notEqual(backendPort, 18766); assert.notEqual(backendPort, collaborationPort);
    const env = { ...process.env, T8_UPDATE_FIXTURE_ROOT: scratch, T8_UPDATE_FIXTURE_RESOURCES: resources,
      T8_UPDATE_FIXTURE_PORT: String(backendPort), T8_COLLAB_PORT: String(collaborationPort),
      T8_FIGMA_BRIDGE_AUTOSTART: '0', T8_ENABLE_LOCAL_PRIVATE: '0', ZCANVAS_INSTANCE_DIR: path.join(scratch, 'registry') };
    delete env.ELECTRON_RUN_AS_NODE;
    child = cp.spawn(require('electron'), ['--js-flags=--max-old-space-size=768', __filename, '--electron-child'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = fs.createWriteStream(path.join(evidence, 'electron.log'), { flags: 'wx' });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    child.stdout.on('data', chunk => { for (const line of String(chunk).split(/\r?\n/)) if (line.startsWith('UPDATE_FIXTURE_PHASE=')) console.log(line); });
    let watchdog;
    const exit = await Promise.race([
      new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); }); }),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(Error('Owned full-App verifier deadline')), 210_000); }),
    ]).finally(() => clearTimeout(watchdog));
    await new Promise(resolve => output.end(resolve)); report.exit = exit;
    if (fs.existsSync(path.join(scratch, 'child-result.json'))) report.child = JSON.parse(fs.readFileSync(path.join(scratch, 'child-result.json')));
    assert.equal(exit.code, 0, JSON.stringify(report.child || exit));
    assert.ok(!report.child.failure, report.child.failure);
    for (const key of ['storageClosed', 'writerFinished', 'httpClosed', 'complete', 'allWindowsHidden']) assert.equal(report.child.quit?.[key], true, key);
    if (report.child.scenario === 'conflict') assert.equal(fs.existsSync(path.join(scratch, 'installer-result.txt')), false);
    else {
      await until(() => fs.existsSync(path.join(scratch, 'installer-result.txt')), 'NSIS did not observe old-process exit', 20_000);
      assert.equal(fs.readFileSync(path.join(scratch, 'installer-result.txt'), 'utf8'), 'old-process-exited');
    }
    assert.deepEqual(report.child.errors, []);
    if (process.env.T8_UPDATE_REQUIRE_TRANSPORT_FENCE === '1' && report.child.scenario !== 'conflict') assert.equal(report.child.transportFence, true);
    report.passed = true; console.log('Full packaged App update exit passed');
  } catch (error) { report.failure = String(error.stack).slice(0, 3500); throw error; }
  finally {
    if (child && !closed) { report.forcedOwnedTestDisposal = true; child.kill(); report.passed = false; }
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
    if (report.passed && closed) {
      assert.equal(path.dirname(scratch), path.resolve(os.tmpdir())); assert.ok(path.basename(scratch).startsWith('t8-update-full-'));
      fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } else { console.error('Failed TEMP fixture retained: ' + scratch); process.exitCode = 1; }
  }
}
if (process.argv.includes('--electron-child')) electronMain().catch(error => { console.error(error.stack); require('electron').app.quit(); });
else main().catch(error => { console.error(error.stack); process.exitCode = 1; });
