'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const realNsis of [false, true]) test(`native Electron save receipt, SQLite and late writer close before ${realNsis ? 'real electron-updater/NSIS launch' : 'installer callback'} and process exit`, { timeout: 45_000 }, async t => {
  const compiler = process.env.T8_TEST_MAKENSIS || path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe');
  if (process.platform !== 'win32' || (realNsis && !fs.existsSync(compiler))) { t.skip('Requires Windows and the already cached NSIS compiler'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-native-update-exit-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });
  const env = { ...process.env, T8_TEST_MAKENSIS: compiler }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = path.resolve(__dirname, '../node_modules/electron/dist/electron.exe');
  const run = spawnSync(executable, [path.join(__dirname, 'helpers/electronUpdateExitProbe.cjs'), root, ...(realNsis ? ['--real-nsis'] : [])], { env, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(run.status, 0, `${run.error || ''}\n${run.stdout}\n${run.stderr}`);
  const line = run.stdout.split(/\r?\n/).find(line => line.startsWith('T8_UPDATE_EXIT_RESULT='));
  assert.ok(line, run.stdout + run.stderr);
  const result = JSON.parse(line.slice('T8_UPDATE_EXIT_RESULT='.length));
  assert.equal(result.saveCalls, 1); assert.equal(result.launches, 1);
  assert.equal(result.storageClosed, true); assert.equal(result.lateWriteRead, true); assert.equal(result.reopened, true);
  assert.equal(result.transportFence, true);
  assert.ok(result.phases.includes('updater.waitingForStorage'));
  if (realNsis) {
    const marker = path.join(root, 'installer-result.txt'), deadline = Date.now() + 12_000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(fs.readFileSync(marker, 'utf8'), 'old-process-exited');
  }
  t.diagnostic(JSON.stringify(result));
});
