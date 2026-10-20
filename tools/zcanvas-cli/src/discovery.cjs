'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const INSTANCE_SCHEMA = 't8-agent-control-instance-v1';
const INSTANCE_FILE_LIMIT = 32 * 1024;
const INSTANCE_LIST_LIMIT = 256;
const INSTANCE_ENTRY_LIMIT = 32768;
const INSTANCE_READ_LIMIT = INSTANCE_FILE_LIMIT * INSTANCE_LIST_LIMIT;

function registryDirectories(env = process.env, homeDir = os.homedir()) {
  const directories = [];
  const explicit = String(env.ZCANVAS_INSTANCE_DIR || '').trim();
  if (explicit) return [path.resolve(explicit)];
  if (homeDir) directories.push(path.join(homeDir, '.zcanvas', 'instances'));
  return [...new Set(directories.map((value) => path.resolve(value)))];
}

function validateDescriptor(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema !== INSTANCE_SCHEMA) return null;
  const instanceId = String(raw.instanceId || '').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(instanceId)) return null;
  const origin = String(raw.origin || '').trim();
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) return null;
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const heartbeatAt = Date.parse(String(raw.heartbeatAt || ''));
  const staleAfterMs = Math.max(2_000, Math.min(120_000, Number(raw.staleAfterMs) || 20_000));
  if (!Number.isFinite(heartbeatAt) || now - heartbeatAt > staleAfterMs || heartbeatAt - now > 60_000) return null;
  if (String(raw.controlProtocol || '') !== 't8-agent-control-v1') return null;
  const exactCompatibilityFields = [
    'skillVersion',
    'cliVersion',
    'canvasPatchProtocol',
    'nodeSchemaDigest',
    'providerCatalogDigest',
    'creativeCapabilityManifestDigest',
    'creativeCapabilityGraphDigest',
    'manifestDigest',
  ];
  if (exactCompatibilityFields.some((field) => !String(raw[field] || '').trim())) return null;
  return {
    schema: INSTANCE_SCHEMA,
    instanceId,
    pid: Number.isInteger(Number(raw.pid)) ? Number(raw.pid) : null,
    origin: parsed.origin,
    statusUrl: `${parsed.origin}/api/status`,
    appVersion: String(raw.appVersion || ''),
    controlProtocol: 't8-agent-control-v1',
    ...Object.fromEntries(exactCompatibilityFields.map((field) => [field, String(raw[field])])),
    heartbeatAt: new Date(heartbeatAt).toISOString(),
    staleAfterMs,
  };
}

function readInstanceDescriptors(options = {}) {
  const now = Number(options.now) || Date.now();
  const descriptors = [];
  const seen = new Set();
  let readBytes = 0;
  for (const directory of registryDirectories(options.env, options.homeDir)) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
      if (entries.length > INSTANCE_ENTRY_LIMIT) {
        const error = new Error('Agent instance registry exceeds the bounded scan limit');
        error.code = 'INSTANCE_REGISTRY_LIMIT';
        throw error;
      }
      // Stale files do not consume the live-descriptor window. Prefer recent
      // atomic heartbeats, but validate the JSON heartbeat as the authority.
      entries = entries.filter((entry) => entry.isFile() && /^[A-Za-z0-9_-]{43,128}\.json$/.test(entry.name))
        .flatMap((entry) => {
          try {
            const stat = fs.lstatSync(path.join(directory, entry.name));
            return stat.isFile() && !stat.isSymbolicLink() && stat.size <= INSTANCE_FILE_LIMIT ? [{ name: entry.name, stat }] : [];
          } catch (_) { return []; }
        })
        .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs || left.name.localeCompare(right.name));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (descriptors.length >= INSTANCE_LIST_LIMIT) break;
      if (readBytes + entry.stat.size + 1 > INSTANCE_READ_LIMIT) continue;
      const filePath = path.join(directory, entry.name);
      let fd;
      try {
        fd = fs.openSync(filePath, 'r');
        const opened = fs.fstatSync(fd);
        if (!opened.isFile() || opened.size !== entry.stat.size || opened.dev !== entry.stat.dev || opened.ino !== entry.stat.ino) continue;
        readBytes += opened.size + 1;
        const bytes = Buffer.alloc(opened.size + 1); let size = 0;
        while (size < bytes.length) { const read = fs.readSync(fd, bytes, size, bytes.length - size, size); if (!read) break; size += read; }
        const after = fs.fstatSync(fd);
        if (size !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) continue;
        const descriptor = validateDescriptor(JSON.parse(bytes.subarray(0, size).toString('utf8')), now);
        if (!descriptor || seen.has(descriptor.instanceId)) continue;
        seen.add(descriptor.instanceId);
        descriptors.push(descriptor);
      } catch (_) {} finally { if (fd !== undefined) fs.closeSync(fd); }
    }
  }
  return descriptors.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
}

async function probeInstance(descriptor, options = {}) {
  const timeoutMs = Math.max(100, Math.min(10_000, Number(options.timeoutMs) || 1_500));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetch || globalThis.fetch)(descriptor.statusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.ok !== true
      || body?.service !== 't8-penguin-canvas-backend'
      || body?.instanceId !== descriptor.instanceId
      || Number(body?.port) !== Number(new URL(descriptor.origin).port)) return null;
    return {
      ...descriptor,
      appVersion: String(body.version || descriptor.appVersion),
      live: true,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverInstances(options = {}) {
  const descriptors = readInstanceDescriptors(options);
  const probed = await Promise.all(descriptors.map((descriptor) => probeInstance(descriptor, options)));
  return probed.filter(Boolean);
}

module.exports = {
  INSTANCE_FILE_LIMIT,
  INSTANCE_LIST_LIMIT,
  INSTANCE_ENTRY_LIMIT,
  INSTANCE_READ_LIMIT,
  INSTANCE_SCHEMA,
  discoverInstances,
  probeInstance,
  readInstanceDescriptors,
  registryDirectories,
  validateDescriptor,
};
