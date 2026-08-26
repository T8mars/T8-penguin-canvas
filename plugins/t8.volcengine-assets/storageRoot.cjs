'use strict';

const path = require('node:path');
const fs = require('node:fs');

function isAbsolute(value) {
  return typeof value === 'string' && path.isAbsolute(value);
}

/**
 * Resolve persistent plugin data outside the install directory.
 * For the user's install this becomes E:\\T8整合包\\T8-PenguinCanvas-Data.
 */
function resolvePersistentRoot(options = {}) {
  const explicit = String(options.root || process.env.T8_PLUGIN_DATA_ROOT || '').trim();
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error('T8_PLUGIN_DATA_ROOT 必须是绝对路径');
    return path.resolve(explicit);
  }

  const executable = String(options.executablePath || process.execPath || '').trim();
  if (isAbsolute(executable)) {
    const installDir = path.dirname(executable);
    return path.resolve(installDir, '..', 'T8-PenguinCanvas-Data');
  }

  return path.resolve(process.cwd(), 'T8-PenguinCanvas-Data');
}

function ensurePersistentLayout(root) {
  const directories = ['plugins', 'plugin-data', 'staging', 'cache'];
  fs.mkdirSync(root, { recursive: true });
  for (const directory of directories) fs.mkdirSync(path.join(root, directory), { recursive: true });
  const layout = {
    root,
    pluginRoot: path.join(root, 'plugins'),
    dataRoot: path.join(root, 'plugin-data', 'volcengine-assets'),
    stagingRoot: path.join(root, 'staging', 'volcengine-assets'),
    cacheRoot: path.join(root, 'cache', 'volcengine-assets'),
  };
  for (const directory of [layout.dataRoot, layout.stagingRoot, layout.cacheRoot]) fs.mkdirSync(directory, { recursive: true });
  return Object.freeze(layout);
}

module.exports = { resolvePersistentRoot, ensurePersistentLayout };
