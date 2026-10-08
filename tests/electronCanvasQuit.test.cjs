'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const main = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8');
const hook = main.slice(main.indexOf("app.on('before-quit', (event) => {"));
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ owner = true, throwingGate = false } = {}) {
  const app = new EventEmitter(), approvals = [], shutdowns = [], logs = [];
  let acceptedExits = 0;
  app.quit = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    app.emit('before-quit', event); if (!event.prevented) acceptedExits++;
  };
  const context = vm.createContext({ app, ELECTRON_SINGLE_INSTANCE_OWNER: owner,
    mainWindowCloseGate: { request: () => { if (throwingGate) throw new Error('gate failed'); const d = deferred(); approvals.push(d); return d.promise; } },
    shutdownBackendForElectron: reason => { const d = deferred(); shutdowns.push({ ...d, reason }); return d.promise; },
    dbgLog: message => logs.push(message),
  });
  vm.runInContext(`let updaterInstallPromise=null, updaterInstallQueued=false; let electronQuitRequested=false, electronQuitReady=false, electronQuitFinalizationPromise=null; ${hook}`, context);
  return { app, approvals, shutdowns, logs,
    state: () => vm.runInContext('({requested:electronQuitRequested,ready:electronQuitReady,pending:!!electronQuitFinalizationPromise})', context),
    get acceptedExits() { return acceptedExits; } };
}

test('actual before-quit hook coalesces requests and waits for save then backend stop', async () => {
  const f = fixture(); f.app.quit(); f.app.quit();
  assert.equal(f.approvals.length, 1); assert.equal(f.shutdowns.length, 0); assert.equal(f.acceptedExits, 0);
  f.approvals[0].resolve(true); await turn();
  assert.equal(f.shutdowns.length, 1); assert.equal(f.shutdowns[0].reason, 'ELECTRON_QUIT');
  assert.equal(f.acceptedExits, 0); assert.equal(f.state().ready, false);
  f.shutdowns[0].resolve(); await turn();
  assert.equal(f.acceptedExits, 1); assert.equal(f.state().pending, false);
});

test('save refusal retains application and backend, then permits a new quit attempt', async () => {
  const f = fixture(); f.app.quit(); f.approvals[0].resolve(false); await turn();
  assert.equal(f.state().requested, false); assert.equal(f.state().pending, false);
  assert.equal(f.shutdowns.length, 0); assert.equal(f.acceptedExits, 0);
  f.app.quit(); assert.equal(f.approvals.length, 2);
  f.approvals[1].resolve(true); await turn(); f.shutdowns[0].resolve(); await turn();
  assert.equal(f.acceptedExits, 1);
});

test('thrown save gate does not shut down backend or approve exit', async () => {
  const f = fixture({ throwingGate: true }); f.app.quit(); await turn();
  assert.equal(f.shutdowns.length, 0); assert.equal(f.acceptedExits, 0);
  assert.equal(f.state().requested, false); assert.equal(f.state().pending, false);
  assert.match(f.logs[0], /gate failed/);
});

test('non-owner quit never coordinates the owner backend', () => {
  const f = fixture({ owner: false }); f.app.quit();
  assert.equal(f.approvals.length, 0); assert.equal(f.shutdowns.length, 0); assert.equal(f.acceptedExits, 1);
});
