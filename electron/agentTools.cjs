'use strict';

const fs = require('node:fs');
const path = require('node:path');

const COMPATIBILITY_FIELDS = Object.freeze([
  'skillVersion', 'cliVersion', 'controlProtocol', 'canvasPatchProtocol',
  'nodeSchemaDigest', 'providerCatalogDigest', 'creativeCapabilityManifestDigest',
  'creativeCapabilityGraphDigest', 'manifestDigest',
]);

function toolsError(code, fields = []) {
  const error = new Error(code);
  error.code = code;
  error.fields = fields;
  return error;
}

function createAgentToolsManager({ sourceRoot, getCompatibility, packaged = false, installOptions = {} }) {
  let busy = false;
  function sourceState() {
    const root = path.resolve(typeof sourceRoot === 'function' ? sourceRoot() : sourceRoot);
    // Both modules are always loaded from this running application's bundle,
    // never from the user's old export or a renderer-supplied directory.
    const cli = path.join(root, 'tools', 'zcanvas-cli');
    const installer = require(path.join(cli, 'src', 'installer.cjs'));
    const source = installer.sourceLayout({ projectRoot: root });
    if (source.distribution !== (packaged ? 'electron-resources' : 'project-source')
      || source.cli !== cli) throw toolsError('AGENT_TOOLS_SOURCE_INVALID');
    const readManifest = require(path.join(cli, 'src', 'manifest.cjs')).readManifest;
    const compatibility = readManifest({ rootDirectory: cli, disableCache: true });
    const live = getCompatibility();
    if (!live) throw toolsError('AGENT_CONTROL_NOT_READY');
    const mismatched = COMPATIBILITY_FIELDS.filter(field => !compatibility[field] || compatibility[field] !== live[field]);
    if (mismatched.length) throw toolsError('AGENT_TOOLS_SOURCE_MISMATCH', mismatched);
    return { root, source, installer, readManifest, compatibility, digest: installer.sourceDigest(source) };
  }

  function inspect(state = sourceState()) {
    const { installer, readManifest, compatibility, digest, source } = state;
    const root = installer.defaultInstallRoot(installOptions);
    const result = {
      schema: 't8-agent-tools-status-v1', source: source.distribution,
      skillVersion: compatibility.skillVersion, cliVersion: compatibility.cliVersion,
      compatibility: Object.fromEntries(COMPATIBILITY_FIELDS.map(field => [field, compatibility[field]])),
      sourceDigest: digest, installRoot: root,
      cliRoot: path.join(root, 'runtime', compatibility.cliVersion),
      state: 'missing', rollbackAvailable: false,
    };
    const targetStat = fs.lstatSync(root, { throwIfNoEntry: false });
    if (!targetStat) return result;
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) return { ...result, state: 'unmanaged' };
    let manifest;
    try { manifest = installer.readInstallManifest(root); }
    catch { return { ...result, state: 'unmanaged' }; }
    result.rollbackAvailable = fs.existsSync(`${root}.last-known-good`);
    try {
      installer.verifyInstallation({ ...installOptions, installRoot: root });
      const cliRoot = path.join(root, 'runtime', manifest.cliVersion);
      const installed = readManifest({ rootDirectory: cliRoot, disableCache: true });
      const exact = COMPATIBILITY_FIELDS.every(field => installed[field] === compatibility[field]);
      const copiedDigest = installer.sourceDigest({ cli: cliRoot, skill: path.join(root, 'skills', 'zhenzhen-canvas') });
      result.state = exact && manifest.sourceDigest === digest && copiedDigest === digest ? 'current' : 'outdated';
    } catch { result.state = 'damaged'; }
    return result;
  }

  function repair() {
    if (busy) throw toolsError('AGENT_TOOLS_BUSY');
    busy = true;
    try {
      const state = sourceState(), before = inspect(state);
      if (before.state === 'current') return { ...before, changed: false };
      if (before.state === 'unmanaged') throw toolsError('AGENT_TOOLS_TARGET_UNMANAGED');
      const previous = before.state === 'missing' ? null : state.installer.readInstallManifest(before.installRoot);
      state.installer.install({
        ...installOptions, projectRoot: state.root, bundleSha256: state.digest,
        // A connection-tool export must not take over unrelated global Skills.
        // Existing owned discovery copies remain part of their original transaction.
        discoveryRoots: previous?.discoveryRoots || [],
      });
      const after = inspect();
      if (after.state !== 'current') throw toolsError('AGENT_TOOLS_VERIFY_FAILED');
      return { ...after, changed: true };
    } finally { busy = false; }
  }
  return { status: () => inspect(), repair };
}

function registerAgentToolsIpc({ ipcMain, getWindow, assertTrusted, getManager }) {
  for (const [channel, action] of [['status', 'status'], ['repair', 'repair']]) {
    ipcMain.handle(`t8pc:agent-tools:${channel}`, (event) => {
      try {
        assertTrusted(event);
        const window = getWindow();
        if (!window || window.isDestroyed() || event.senderFrame !== window.webContents.mainFrame) {
          throw toolsError('AGENT_CONTROL_RENDERER_FORBIDDEN');
        }
        return { success: true, data: getManager()[action]() };
      } catch (error) {
        return {
          success: false,
          code: /^[A-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'AGENT_TOOLS_FAILED',
          fields: Array.isArray(error?.fields) ? error.fields.filter(field => COMPATIBILITY_FIELDS.includes(field)) : [],
        };
      }
    });
  }
}

module.exports = { COMPATIBILITY_FIELDS, createAgentToolsManager, registerAgentToolsIpc };
