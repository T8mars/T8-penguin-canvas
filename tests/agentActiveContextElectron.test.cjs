'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { buildSync } = require('esbuild');

test('real Electron preload and production reporter provide fresh multiwindow and restart context without DB or approval', { skip: process.platform !== 'win32' }, t => {
  const root = path.resolve(__dirname, '..');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 't8-active-electron-'));
  t.after(() => { const rel = path.relative(os.tmpdir(), sandbox);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const bundle = buildSync({ stdin: { contents: `import {registerCanvasActiveContext} from './src/utils/agentActiveContext';
    let source = {loaded:false};
    window.exampleSetContext = value => {source=value};
    window.exampleDispose = registerCanvasActiveContext(window.t8pc.agentControl, () => source);
    window.exampleReady = true;`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'browser', format: 'iife', write: false }).outputFiles[0].text;
  fs.writeFileSync(path.join(sandbox, 'context.html'), '<!doctype html><meta charset="UTF-8"><script>'+bundle.replaceAll('</script', '<\\/script')+'</script>');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const electron = process.versions.electron ? process.execPath : require('electron');
  const child = spawnSync(electron, [path.join(root, 'tests/helpers/agentActiveContextElectronProbe.cjs'), sandbox,
    '--disable-gpu', '--js-flags=--max-old-space-size=512'], { env, windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  const result = JSON.parse(fs.readFileSync(path.join(sandbox, 'report.json'), 'utf8'));
  assert.equal(result.passed, true, JSON.stringify(result) + child.stdout + child.stderr);
  assert.equal(result.realElectron, true); assert.equal(result.providerCalls, 0); assert.equal(result.humanApproval, false);
});
