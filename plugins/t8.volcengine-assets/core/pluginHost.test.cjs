'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installPluginDirectory, listInstalledPlugins, readManifest } = require('./pluginHost.cjs');

const pluginDir = path.resolve(__dirname, '..');

test('plugin manifest is valid for the 3.0 host contract', () => {
  const manifest = readManifest(pluginDir);
  assert.equal(manifest.id, 't8.volcengine-assets');
  assert.equal(manifest.minHostVersion, '3.0.0');
});

test('installer rejects duplicate and path traversal manifests', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 't8-plugin-source-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-plugin-host-'));
  fs.cpSync(pluginDir, source, { recursive: true });
  const first = installPluginDirectory(source, root);
  assert.equal(first.manifest.id, 't8.volcengine-assets');
  assert.throws(() => installPluginDirectory(source, root), /插件已安装/);
  assert.equal(listInstalledPlugins(root).length, 1);
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});
