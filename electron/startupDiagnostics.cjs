'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 't8-startup-diagnostics-v1';
const MAX_EVENTS = 512;
const MAX_FILE_BYTES = 256 * 1024;
const PHASES = Object.freeze({
  electron: new Set(['session-start', 'startup-shell-visible', 'backend-start-requested', 'backend-module-ready', 'backend-transport-ready', 'startup-failed', 'main-window-visible', 'main-window-loaded', 'main-window-local-error', 'frontend-url-ready', 'frontend-url-fallback-ready', 'frontend-url-failed', 'frontend-load-still-in-progress']),
  backend: new Set(['routes-mounted', 'transport-listening', 'frontend-interactive', 'background-scheduled', 'background-started', 'background-ready', 'background-deferred']),
  'project-db': new Set(['owner-acquired', 'clean-active-fast-path', 'preflight-verified', 'active-initialized', 'startup-backup-complete', 'schema-verified', 'migration-complete', 'freshness-verified', 'history-verified', 'integrity-verified', 'runs-recovered', 'backup-written', 'backup-sealed', 'backup-validated']),
  renderer: new Set(['connecting', 'backend-error', 'catalog', 'catalog-error', 'empty', 'document', 'flow', 'canvas-error', 'ready', 'event-loop-delay', 'renderer-error', 'renderer-rejection']),
});

function sanitizeEvent(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(PHASES, input.component)
    || !PHASES[input.component].has(input.phase)) return null;
  const event = { component: input.component, phase: input.phase };
  for (const key of ['elapsedMs', 'phaseMs', 'totalMs', 'delayMs']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 7 * 24 * 60 * 60 * 1000) {
      event[key] = Math.round(input[key]);
    }
  }
  return event;
}

// Parse only existing structured startup timers. Never persist free-form console
// output, URLs, paths, error messages, request bodies or canvas documents.
function parseStartupLine(line) {
  if (typeof line !== 'string' || line.length > 4096) return null;
  const match = line.match(/(?:^|\] )\[startup\] component=([\w-]+) phase=([\w-]+)(?:\s|$)/);
  if (!match) return null;
  const event = { component: match[1], phase: match[2] };
  for (const key of ['elapsedMs', 'phaseMs', 'totalMs']) {
    const metric = line.match(new RegExp(`\\b${key}=(\\d+)(?:\\s|$)`));
    if (metric) event[key] = Number(metric[1]);
  }
  return sanitizeEvent(event);
}

function safeVersion(value) {
  return typeof value === 'string' && /^\d+(?:\.\d+){1,3}$/.test(value) && value.length <= 32 ? value : 'unknown';
}

function createStartupDiagnostics({ directory, version, platform = process.platform, arch = process.arch, versions = process.versions } = {}) {
  const metadata = {
    schema: SCHEMA, sessionId: crypto.randomUUID(), startedAt: new Date().toISOString(),
    appVersion: safeVersion(version),
    platform: ['win32', 'darwin', 'linux'].includes(platform) ? platform : 'unknown',
    arch: ['x64', 'arm64', 'ia32'].includes(arch) ? arch : 'unknown',
    electron: safeVersion(versions?.electron), node: safeVersion(versions?.node),
  };
  const events = [];
  let truncated = false;
  let persistence = directory ? 'pending' : 'memory-only';
  const currentFile = directory ? path.join(directory, 'startup-current.jsonl') : null;
  const previousFile = directory ? path.join(directory, 'startup-previous.jsonl') : null;
  let pending = Promise.resolve();
  const enqueue = (work) => {
    pending = pending.then(work).catch(() => { persistence = 'memory-only'; });
    return pending;
  };
  if (directory) enqueue(async () => {
    await fs.promises.mkdir(directory, { recursive: true });
    // Fixed two-session retention, independent of the project database/data path.
    try {
      const stat = await fs.promises.lstat(currentFile);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_FILE_BYTES) await fs.promises.copyFile(currentFile, previousFile);
      else await fs.promises.writeFile(previousFile, '', { mode: 0o600 });
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.promises.writeFile(currentFile, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
    persistence = 'saved';
  });

  const record = (input) => {
    const event = sanitizeEvent(input);
    if (!event) return false;
    if (events.length >= MAX_EVENTS) { truncated = true; return false; }
    const entry = { ...event, at: new Date().toISOString() };
    events.push(entry);
    if (currentFile) enqueue(async () => {
      if (persistence === 'saved') await fs.promises.appendFile(currentFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    });
    return true;
  };

  const previousSession = async () => {
    if (!previousFile) return [];
    let handle;
    try {
      handle = await fs.promises.open(previousFile, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];
      // Bound reads even if another process modifies the file after stat().
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE_BYTES) return [];
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
      const header = JSON.parse(lines.shift());
      if (header.schema !== SCHEMA) return [];
      const safe = [{ schema: SCHEMA, session: 'previous', appVersion: safeVersion(header.appVersion) }];
      for (const line of lines.slice(0, MAX_EVENTS)) {
        if (!line) continue;
        try {
          const source = JSON.parse(line);
          const event = sanitizeEvent(source);
          if (event) safe.push({ ...event, ...(typeof source.at === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(source.at) ? { at: source.at } : {}) });
        } catch { /* Ignore an incomplete last line after an interrupted launch. */ }
      }
      return safe;
    } catch { return []; }
    finally { await handle?.close().catch(() => {}); }
  };

  const exportText = async () => {
    await pending;
    const previous = await previousSession();
    return [...previous, { ...metadata, session: 'current', persistence, truncated }, ...events].map((item) => JSON.stringify(item)).join('\n') + '\n';
  };
  record({ component: 'electron', phase: 'session-start', elapsedMs: 0 });
  return { record, exportText, flush: () => pending };
}

function installStartupConsoleCapture(diagnostics, targetConsole = console) {
  const original = targetConsole.log;
  function captured(...args) {
    try {
      const event = parseStartupLine(args[0]);
      if (event) diagnostics.record(event);
    } catch { /* Diagnostics must never break normal logging/startup. */ }
    return Reflect.apply(original, this, args);
  }
  targetConsole.log = captured;
  return () => { if (targetConsole.log === captured) targetConsole.log = original; };
}

function registerStartupDiagnosticsIpc({ ipcMain, getWindow, assertTrusted, dialog, diagnostics, title }) {
  const trustedWindow = (event) => {
    assertTrusted(event);
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Startup diagnostics require the main frame');
    }
    return window;
  };
  ipcMain.on('t8pc:startup-diagnostics:record', (event, input) => {
    try { trustedWindow(event); if (input?.component === 'renderer') diagnostics.record(input); }
    catch { /* Ignore foreign frames; never open an unauthorised dialog. */ }
  });
  let saving = false;
  ipcMain.handle('t8pc:startup-diagnostics:save', async (event) => {
    const window = trustedWindow(event);
    if (saving) return { success: false, code: 'STARTUP_LOG_BUSY' };
    saving = true;
    try {
      const filename = `t8-startup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
      const picked = await dialog.showSaveDialog(window, { title: title(), defaultPath: filename, filters: [{ name: 'Log', extensions: ['log'] }] });
      if (picked.canceled || !picked.filePath) return { success: false, canceled: true };
      await fs.promises.writeFile(picked.filePath, await diagnostics.exportText(), { encoding: 'utf8', mode: 0o600 });
      return { success: true };
    } catch { return { success: false, code: 'STARTUP_LOG_SAVE_FAILED' }; }
    finally { saving = false; }
  });
}

module.exports = { SCHEMA, MAX_EVENTS, MAX_FILE_BYTES, sanitizeEvent, parseStartupLine, createStartupDiagnostics, installStartupConsoleCapture, registerStartupDiagnosticsIpc };
