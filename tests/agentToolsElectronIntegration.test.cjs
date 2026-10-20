'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const { install } = require('../tools/zcanvas-cli/src/installer.cjs');
const root = path.resolve(__dirname, '..');

test('real Electron settings and preload refresh an old same-version managed CLI in a fresh TEMP home', { skip: process.platform !== 'win32' }, t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 't8-agent-tools-electron-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), sandbox);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries:5, retryDelay:50 });
  });
  const resources = path.join(sandbox, 'resources');
  fs.cpSync(path.join(root, 'tools/zcanvas-cli'), path.join(resources, 'tools/zcanvas-cli'), { recursive: true });
  fs.cpSync(path.join(root, '.agents/skills/zhenzhen-canvas'), path.join(resources, 'agent/skills/zhenzhen-canvas'), { recursive: true });
  const provider = path.join(resources, 'backend-enc/shared/creativeModelCatalog.json');
  fs.mkdirSync(path.dirname(provider), { recursive: true }); fs.copyFileSync(path.join(root, 'backend/src/shared/creativeModelCatalog.json'), provider);
  const old = path.join(sandbox, 'old-resources'); fs.cpSync(resources, old, { recursive: true });
  const oldManifest = path.join(old, 'tools/zcanvas-cli/manifest.json'), metadata = JSON.parse(fs.readFileSync(oldManifest, 'utf8'));
  metadata.minimumDesktopVersion = '2.6.3'; fs.writeFileSync(oldManifest, JSON.stringify(metadata));
  install({ projectRoot: old, installRoot: path.join(sandbox, 'installed'), discoveryRoots: [] });
  const bundle = buildSync({ entryPoints: [path.join(root, 'tests/helpers/agentToolsSettingsEntry.tsx')], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false }).outputFiles[0].text;
  fs.writeFileSync(path.join(sandbox, 'settings.html'), '<!doctype html><meta charset="UTF-8"><div id="root"></div><script>'+bundle.replaceAll('</script', '<\\/script')+'</script>');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const electron = process.versions.electron ? process.execPath : require('electron');
  const child = spawnSync(electron, [path.join(root, 'tests/helpers/agentToolsElectronProbe.cjs'), sandbox, '--disable-gpu', '--js-flags=--max-old-space-size=512'], { env, encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  const report = child.stdout.split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(row => row?.realElectron);
  assert.ok(report?.passed); assert.equal(report.sameVersionRefresh, true); assert.equal(report.humanApproval, false); assert.equal(report.providerCalls, 0);
});
