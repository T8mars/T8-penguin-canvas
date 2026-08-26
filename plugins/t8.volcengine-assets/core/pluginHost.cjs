'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API_VERSION = 1;
const PLUGIN_ID = /^[a-z][a-z0-9._-]{2,63}$/;

function inside(root, target) {
  const base = `${path.resolve(root)}${path.sep}`;
  return path.resolve(target).startsWith(base);
}

function readManifest(pluginDir) {
  const manifestFile = path.join(pluginDir, 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!PLUGIN_ID.test(String(manifest.id || ''))) throw new Error('插件 id 不符合规范');
  if (Number(manifest.apiVersion) !== API_VERSION) throw new Error(`不支持的插件 API 版本: ${manifest.apiVersion}`);
  if (!manifest.entry || typeof manifest.entry !== 'object') throw new Error('插件缺少 entry');
  for (const key of ['backend', 'frontend']) {
    const entry = String(manifest.entry[key] || '').trim();
    if (!entry || path.isAbsolute(entry) || entry.includes('..') || !inside(pluginDir, path.join(pluginDir, entry))) {
      throw new Error(`插件 entry 非法: ${key}`);
    }
  }
  return manifest;
}

function installPluginDirectory(sourceDir, pluginRoot) {
  const source = path.resolve(sourceDir);
  const root = path.resolve(pluginRoot);
  const manifest = readManifest(source);
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, manifest.id);
  if (!inside(root, target)) throw new Error('插件目标目录越界');
  if (fs.existsSync(target)) throw new Error(`插件已安装: ${manifest.id}`);
  const staging = path.join(root, `.install-${manifest.id}-${crypto.randomUUID()}`);
  try {
    fs.cpSync(source, staging, { recursive: true, errorOnExist: true });
    readManifest(staging);
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { manifest, directory: target };
}

function listInstalledPlugins(pluginRoot) {
  const root = path.resolve(pluginRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const directory = path.join(root, entry.name);
      try { return { directory, manifest: readManifest(directory) }; } catch (error) {
        return { directory, error: error.message };
      }
    });
}

function loadInstalledPlugins({ pluginRoot, hostContext = {}, logger = console } = {}) {
  const loaded = [];
  for (const item of listInstalledPlugins(pluginRoot)) {
    if (item.error) {
      logger.warn?.('[t8-plugin-host] skipped invalid plugin', item.directory, item.error);
      continue;
    }
    const manifest = item.manifest;
    const context = {
      ...hostContext,
      plugin: manifest,
      paths: { ...(hostContext.paths || {}), pluginDirectory: item.directory },
    };
    let backend = null;
    if (manifest.entry.backend) {
      backend = require(path.join(item.directory, manifest.entry.backend));
      if (typeof backend?.register !== 'function') throw new Error(`插件后端缺少 register: ${manifest.id}`);
      backend.register(context);
    }
    loaded.push({ manifest, directory: item.directory, backend });
  }
  return loaded;
}

module.exports = {
  API_VERSION,
  readManifest,
  installPluginDirectory,
  listInstalledPlugins,
  loadInstalledPlugins,
};
