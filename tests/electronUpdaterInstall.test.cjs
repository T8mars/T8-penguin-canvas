'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const main = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const operations = main.slice(main.indexOf('async function checkForUpdatesByUser()'), main.indexOf('function startInitialUpdateCheck()'));
const quitHook = main.slice(main.indexOf("app.on('before-quit', (event) => {"));
const errorStart = main.indexOf("    autoUpdater.on('error', (error) => {");
const errorHook = main.slice(errorStart, main.indexOf('\n\n    return { ok: true, updater: autoUpdater };', errorStart));
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture({ platform = 'win32', owner = true, downloaded = true, ready = true, throwInstall = false } = {}) {
  const app = new EventEmitter(), updater = new EventEmitter();
  const approvals = [], shutdowns = [], installations = [], statuses = [], cancelled = [];
  let acceptedExits = 0, destroyed = false, checks = 0, downloads = 0;
  app.quit = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    app.emit('before-quit', event);
    if (!event.prevented) acceptedExits++;
  };
  updater.quitAndInstall = (...args) => {
    installations.push(args);
    if (throwInstall) throw new Error('spawn failed');
    app.quit();
  };
  updater.checkForUpdates = async () => { checks++; return {}; };
  updater.downloadUpdate = async () => { downloads++; };
  const context = vm.createContext({
    app, autoUpdater: updater, process: { platform }, setImmediate,
    ELECTRON_SINGLE_INSTANCE_OWNER: owner,
    mainWindow: { isDestroyed: () => destroyed },
    mainWindowCloseGate: {
      request: () => { const d = deferred(); approvals.push(d); return d.promise; },
      cancelApproval: () => cancelled.push(true),
    },
    electronT: key => key, normalizeError: error => error.message, dbgLog: () => {},
    ensureAutoUpdater: () => ready ? { ok: true, updater } : { ok: false, code: 'DISABLED', messageKey: 'updater.disabled' },
    emitUpdaterStatus: patch => {
      statuses.push(patch);
      return Object.assign(vm.runInContext('updaterState', context), patch);
    },
    shutdownBackendForElectron: reason => {
      const d = deferred();
      shutdowns.push({ ...d, reason });
      context.stopPromise = d.promise;
      vm.runInContext('backendShutdownPromise = stopPromise', context);
      return d.promise;
    },
  });
  // Execute the production functions and actual quit/error hooks, not a copy of their behavior.
  vm.runInContext(`let updaterInstallPromise=null, updaterInstallQueued=false;
    let electronQuitRequested=false, electronQuitReady=false, electronQuitFinalizationPromise=null;
    let backendShutdownPromise=null, dataStorageRestartPending=false;
    let updaterState={status:'downloaded',downloaded:${downloaded}};
    ${operations}\n${quitHook}\n${errorHook}`, context);
  return {
    app, updater, approvals, shutdowns, installations, statuses, cancelled,
    install: () => vm.runInContext('installDownloadedUpdate()', context),
    check: () => vm.runInContext('checkForUpdatesByUser()', context),
    download: () => vm.runInContext('downloadAvailableUpdate()', context),
    set: source => vm.runInContext(source, context),
    destroy: () => { destroyed = true; },
    state: () => vm.runInContext('({requested:electronQuitRequested,ready:electronQuitReady,pending:!!updaterInstallPromise,queued:updaterInstallQueued,status:updaterState})', context),
    get acceptedExits() { return acceptedExits; }, get checks() { return checks; }, get downloads() { return downloads; },
  };
}

test('production update waits for save and backend close before a single installer launch', async () => {
  const f = fixture(), pending = f.install();
  assert.equal(f.install(), pending);
  assert.equal(f.state().status.status, 'preparing-install');
  assert.equal(f.shutdowns.length, 0); assert.equal(f.installations.length, 0);
  f.approvals[0].resolve(true); await turn();
  assert.equal(f.shutdowns[0].reason, 'ELECTRON_UPDATE');
  assert.equal(f.installations.length, 0); assert.equal(f.acceptedExits, 0);
  f.shutdowns[0].resolve({ storageClosed: true });
  assert.equal((await pending).success, true);
  assert.equal(f.install().success, true);
  await turn();
  assert.deepEqual(f.installations, [[false, true]]);
  assert.equal(f.approvals.length, 1); assert.equal(f.shutdowns.length, 1);
  assert.equal(f.acceptedExits, 1); assert.equal(f.state().ready, true);
});

test('save refusal preserves downloaded update and never stops backend or starts installer', async () => {
  const f = fixture(), pending = f.install();
  f.approvals[0].resolve(false);
  const result = await pending; await turn();
  assert.equal(result.code, 'UPDATER_CANVAS_CLOSE_BLOCKED');
  assert.equal(result.status.downloaded, true);
  assert.equal(f.shutdowns.length, 0); assert.equal(f.installations.length, 0);
  assert.equal(f.acceptedExits, 0); assert.equal(f.state().requested, false);
  const retry = f.install(); assert.equal(f.approvals.length, 2);
  f.approvals[1].resolve(false); await retry;
});

test('save gate exception cancels approval and leaves backend live', async () => {
  const f = fixture(), pending = f.install();
  f.approvals[0].reject(new Error('save failed'));
  assert.equal((await pending).code, 'UPDATER_INSTALL_PREPARATION_FAILED');
  assert.equal(f.cancelled.length, 1); assert.equal(f.shutdowns.length, 0);
  assert.equal(f.state().ready, false); assert.equal(f.installations.length, 0);
});

for (const outcome of ['timeout', 'error']) {
  test(`backend ${outcome} blocks install and retry without releasing renderer hold`, async () => {
    const f = fixture(), pending = f.install();
    f.approvals[0].resolve(true); await turn();
    if (outcome === 'timeout') f.shutdowns[0].resolve({ timedOut: true });
    else f.shutdowns[0].reject(new Error('storage close failed'));
    const result = await pending; await turn();
    assert.equal(result.success, false); assert.equal(result.messageKey, 'updater.installFailedRestart');
    assert.equal(f.cancelled.length, 0); assert.equal(f.acceptedExits, 0); assert.equal(f.installations.length, 0);
    assert.equal(f.install().code, 'UPDATER_RESTART_REQUIRED');
    assert.equal((await f.check()).code, 'UPDATER_RESTART_REQUIRED');
    assert.equal((await f.download()).code, 'UPDATER_RESTART_REQUIRED');
    assert.equal(f.approvals.length, 1);
  });
}

test('concurrent ordinary quit cannot bypass update preparation or create a second shutdown', async () => {
  const f = fixture(), pending = f.install(); f.app.quit();
  assert.equal(f.approvals.length, 1); assert.equal(f.acceptedExits, 0);
  f.approvals[0].resolve(true); await turn(); f.app.quit();
  assert.equal(f.shutdowns.length, 1); assert.equal(f.acceptedExits, 0);
  f.shutdowns[0].resolve(); await pending; await turn();
  assert.equal(f.acceptedExits, 1); assert.equal(f.shutdowns.length, 1);
});

test('checking and downloading cannot replace state or artifacts during preparation/install', async () => {
  const f = fixture(), pending = f.install();
  assert.equal((await f.check()).code, 'UPDATER_INSTALL_BUSY');
  assert.equal((await f.download()).code, 'UPDATER_INSTALL_BUSY');
  assert.equal(f.state().status.status, 'preparing-install');
  f.approvals[0].resolve(true); await turn(); f.shutdowns[0].resolve(); await pending;
  assert.equal((await f.download()).code, 'UPDATER_INSTALL_BUSY');
  assert.equal(f.checks, 0); assert.equal(f.downloads, 0); await turn();
});

for (const source of ['electronQuitRequested=true', 'electronQuitFinalizationPromise=Promise.resolve()', 'dataStorageRestartPending=true']) {
  test(`existing quit/migration intent blocks installer: ${source}`, () => {
    const f = fixture(); f.set(source);
    assert.equal(f.install().code, 'UPDATER_INSTALL_BUSY'); assert.equal(f.approvals.length, 0);
  });
}

test('disabled, non-owner and not-downloaded paths never request save or shutdown', () => {
  for (const options of [{ ready: false }, { owner: false }, { downloaded: false }]) {
    const f = fixture(options); assert.equal(f.install().success, false);
    assert.equal(f.approvals.length, 0); assert.equal(f.shutdowns.length, 0); assert.equal(f.installations.length, 0);
  }
});

test('macOS uses the same save/close gate and retains native restart arguments', async () => {
  const f = fixture({ platform: 'darwin' }), pending = f.install();
  f.approvals[0].resolve(true); await turn(); f.shutdowns[0].resolve();
  assert.equal((await pending).status.messageKey, 'updater.installingMac'); await turn();
  assert.deepEqual(f.installations, [[true, true]]);
});

test('synchronous installer startup error is contained and requires manual restart', async () => {
  const f = fixture({ throwInstall: true }), pending = f.install();
  f.approvals[0].resolve(true); await turn(); f.shutdowns[0].resolve(); await pending; await turn();
  assert.equal(f.state().status.messageKey, 'updater.installFailedRestart');
  assert.equal(f.state().queued, false); assert.equal(f.install().code, 'UPDATER_RESTART_REQUIRED');
  assert.equal(f.cancelled.length, 0);
});

test('actual updater error listener distinguishes async installer error and prevents re-launch', async () => {
  const f = fixture(), pending = f.install();
  f.approvals[0].resolve(true); await turn(); f.shutdowns[0].resolve(); await pending;
  f.updater.emit('error', new Error('EACCES'));
  assert.equal(f.state().status.messageKey, 'updater.installFailedRestart');
  assert.equal(f.install().code, 'UPDATER_RESTART_REQUIRED'); await turn();
  assert.equal(f.installations.length, 0);
});

test('closed window with failed preparation does not leave an invisible owner process', async () => {
  const f = fixture(), pending = f.install(); f.destroy();
  f.approvals[0].resolve(false); await pending; await turn();
  assert.equal(f.approvals.length, 2); assert.equal(f.installations.length, 0);
  f.approvals[1].resolve(true); await turn(); f.shutdowns[0].resolve(); await turn();
  assert.equal(f.acceptedExits, 1);
});

test('NSIS integration uses the supported custom hook, exact app executable and no forced kill', () => {
  const installer = fs.readFileSync(require.resolve('../electron/build-resources/installer.nsh'), 'utf8');
  const template = fs.readFileSync(require.resolve('../node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh'), 'utf8');
  assert.match(template, /!ifmacrodef customCheckAppRunning\s+!insertmacro customCheckAppRunning/);
  assert.match(installer, /!macro customCheckAppRunning/);
  assert.match(installer, /\$\{nsProcess::FindProcess\} "\$\{APP_EXECUTABLE_FILENAME\}" \$R0/);
  assert.match(installer, /\$R0 == 603/); assert.match(installer, /\$R1 < 30/);
  assert.match(installer, /\$R0 != 0/); assert.match(installer, /SetErrorLevel 2/);
  assert.doesNotMatch(installer, /taskkill|nsProcess::(?:KillProcess|CloseProcess)|_CHECK_APP_RUNNING/);
  assert.match(installer, /\$LANGUAGE == 2052/);
});

test('production updater UI labels preparation and disables re-entry after partial shutdown', () => {
  const ts = require('typescript');
  const source = fs.readFileSync(require.resolve('../src/components/AppUpdaterButton.tsx'), 'utf8');
  const functions = source.slice(source.indexOf('function statusTone('), source.indexOf('function PrimaryIcon('));
  const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({}); vm.runInContext(compiled, context);
  const t = key => key;
  const preparing = { status: 'preparing-install', downloaded: true };
  assert.equal(context.statusTone(preparing.status), 'busy');
  assert.equal(context.statusLabel(preparing, t), 'updater.labels.preparingInstall');
  assert.equal(context.primaryLabel(preparing, t), 'updater.labels.preparingInstall');
  const disabled = source.slice(source.indexOf('  const disabled ='), source.indexOf('  const buttonClass ='));
  context.updaterUnavailable = false; context.busy = false; context.status = preparing;
  assert.equal(vm.runInContext(`(() => { ${disabled}; return disabled; })()`, context), true);
  context.status = { status: 'error', downloaded: true, messageKey: 'updater.installFailedRestart' };
  assert.equal(vm.runInContext(`(() => { ${disabled}; return disabled; })()`, context), true);
  context.status = { status: 'error', downloaded: true, messageKey: 'updater.closeBlocked' };
  assert.equal(vm.runInContext(`(() => { ${disabled}; return disabled; })()`, context), false);
});
