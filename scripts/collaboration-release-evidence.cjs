#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  CLIENT_ATTESTATION_CONTRACT,
  DEVICE_ATTESTATION_CONTRACT,
} = require('./collaboration-evidence-attestation.cjs');

const CONTRACT_VERSION = 't8-collaboration-release-evidence-v2';
const POST_RELEASE_DEFERRAL_VERSION = '3.1.3';
const POST_RELEASE_DEFERRAL_APPROVAL = 'owner-approved-post-release-v3.1.3';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SUBJECT_ID_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const MAX_ATTESTATION_BYTES = 64 * 1024;

const REQUIRED_CHECKS = Object.freeze([
  'lanMultiClient',
  'offline60Seconds',
  'hostRestartRecovery',
  'electronInstallUpgrade',
  'chromeCompatibility',
  'edgeCompatibility',
  'publicHealth',
  'inviteRedeem',
  'websocketUpgrade',
  'upload100MiB',
  'rangePlayback',
  'loginRateLimit',
  'messageRateLimit',
  'uploadRateLimit',
  'downloadRateLimit',
  'reviewerAuthorizationRedTeam',
  'privateSurfaceScan',
  'pathMimeCompressionRedTeam',
  'ssrfDeepJsonRedTeam',
  'replayRedTeam',
  'sensitiveLogScan',
  'connectionLoad',
  'operationThroughput',
  'assetIndex100k',
  'storageGrowth',
]);

function evidenceError(message, details = {}) {
  const error = new Error(message);
  error.code = 'collaboration_release_evidence_invalid';
  error.details = Object.freeze({ ...details });
  return error;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    throw evidenceError(`${label} must be an object`);
  }
  return value;
}

function exactIsoTimestamp(value, label) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw evidenceError(`${label} must be an exact UTC ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw evidenceError(`${label} is invalid`);
  }
  return timestamp;
}

function safeIntegerAtLeast(value, minimum, label) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw evidenceError(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let offset = 0;
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function resolveEvidencePath(root, explicitPath) {
  const configured = explicitPath || process.env.T8_COLLAB_RELEASE_EVIDENCE;
  return path.resolve(configured || path.join(
    root,
    'artifacts',
    'collaboration-release-evidence-v2',
    'manifest.json',
  ));
}

function readManifest(filename) {
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    throw evidenceError('collaboration release evidence manifest is missing', {
      reason: error?.code || 'unreadable',
    });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) {
    throw evidenceError('collaboration release evidence manifest must be a bounded regular file');
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (_) {
    throw evidenceError('collaboration release evidence manifest is not valid UTF-8 JSON');
  }
  return assertPlainObject(parsed, 'manifest');
}

function assertPublicEnvironment(environment) {
  assertPlainObject(environment, 'environment');
  if (!SUBJECT_ID_PATTERN.test(environment.challengeDigest)) {
    throw evidenceError('environment.challengeDigest must be a lowercase SHA-256 digest');
  }
  if (!Array.isArray(environment.devices)
    || environment.devices.length < 2
    || environment.devices.length > 16) {
    throw evidenceError('environment.devices must contain 2-16 independently attested Windows devices');
  }
  const devices = new Map();
  const deviceArtifactIds = new Set();
  for (const raw of environment.devices) {
    const device = assertPlainObject(raw, 'environment device');
    if (!SUBJECT_ID_PATTERN.test(device.id) || devices.has(device.id)) {
      throw evidenceError('environment device id must be a unique lowercase SHA-256 digest');
    }
    if (device.platform !== 'win32' || device.physical !== true
      || !['x64', 'arm64'].includes(device.arch)
      || typeof device.osBuild !== 'string'
      || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(device.osBuild)) {
      throw evidenceError('environment device must prove a physical Windows build and supported architecture');
    }
    if (!ARTIFACT_ID_PATTERN.test(device.attestationArtifactId)
      || deviceArtifactIds.has(device.attestationArtifactId)) {
      throw evidenceError('each environment device must use a unique attestation artifact');
    }
    deviceArtifactIds.add(device.attestationArtifactId);
    devices.set(device.id, Object.freeze({ ...device }));
  }
  if (!Array.isArray(environment.clients)
    || environment.clients.length < 3
    || environment.clients.length > 64) {
    throw evidenceError('environment.clients must contain 3-64 isolated clients');
  }
  const clients = new Map();
  const profileIds = new Set();
  const sessionIds = new Set();
  const clientArtifactIds = new Set();
  const clientDeviceIds = new Set();
  const browsers = new Set();
  for (const raw of environment.clients) {
    const client = assertPlainObject(raw, 'environment client');
    if (!SUBJECT_ID_PATTERN.test(client.id) || clients.has(client.id)
      || !SUBJECT_ID_PATTERN.test(client.profileId) || profileIds.has(client.profileId)
      || !SUBJECT_ID_PATTERN.test(client.sessionIdDigest)
      || sessionIds.has(client.sessionIdDigest)) {
      throw evidenceError('environment client, profile, and session ids must be unique lowercase SHA-256 digests');
    }
    if (!devices.has(client.deviceId)
      || !['chrome', 'edge', 'electron'].includes(client.browser)) {
      throw evidenceError('environment client must reference an attested device and supported browser');
    }
    if (!ARTIFACT_ID_PATTERN.test(client.evidenceArtifactId)
      || clientArtifactIds.has(client.evidenceArtifactId)
      || deviceArtifactIds.has(client.evidenceArtifactId)) {
      throw evidenceError('each environment client must use a unique evidence artifact');
    }
    profileIds.add(client.profileId);
    sessionIds.add(client.sessionIdDigest);
    clientArtifactIds.add(client.evidenceArtifactId);
    clientDeviceIds.add(client.deviceId);
    browsers.add(client.browser);
    clients.set(client.id, Object.freeze({ ...client }));
  }
  if (clientDeviceIds.size < 2
    || [...devices.keys()].some((deviceId) => !clientDeviceIds.has(deviceId))) {
    throw evidenceError('environment clients must cover every attested device and at least two devices');
  }
  if (!browsers.has('chrome') || !browsers.has('edge')) {
    throw evidenceError('environment clients must include isolated Chrome and Edge profiles');
  }
  let publicUrl;
  try {
    publicUrl = new URL(environment.publicBaseUrl);
  } catch (_) {
    throw evidenceError('environment.publicBaseUrl is invalid');
  }
  const hostname = publicUrl.hostname.toLowerCase();
  const pathname = publicUrl.pathname.replace(/\/+$/, '') || '/';
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password
    || !pathname.endsWith('/collab') || publicUrl.search || publicUrl.hash
    || net.isIP(hostname) !== 0 || !hostname.includes('.')
    || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw evidenceError('environment.publicBaseUrl must be a public HTTPS /collab URL with a DNS hostname');
  }
  publicUrl.pathname = pathname;
  const proxy = assertPlainObject(environment.proxy, 'environment.proxy');
  if (!['nginx', 'caddy', 'other'].includes(proxy.kind)
    || proxy.tlsVerified !== true
    || proxy.sniVerified !== true
    || proxy.webSocketUpgradeVerified !== true
    || proxy.rangeVerified !== true
    || String(proxy.certificateHostname || '').toLowerCase() !== hostname) {
    throw evidenceError('environment.proxy must prove TLS/SNI, WebSocket, Range, and certificate hostname');
  }
  return Object.freeze({
    hostname,
    publicBaseUrl: publicUrl.toString().replace(/\/$/, ''),
    devices,
    clients,
    deviceArtifactIds,
    clientArtifactIds,
    challengeDigest: environment.challengeDigest,
  });
}

function safeArtifactPath(evidenceDirectory, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length < 1 || relativePath.length > 240
    || relativePath.includes('\\') || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw evidenceError('artifact path must be a canonical relative POSIX path');
  }
  const resolved = path.resolve(evidenceDirectory, ...relativePath.split('/'));
  const boundary = `${path.resolve(evidenceDirectory)}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(boundary)) {
    throw evidenceError('artifact path escapes the evidence directory');
  }
  return resolved;
}

function verifyArtifacts(manifest, evidenceDirectory) {
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < 1
    || manifest.artifacts.length > 64) {
    throw evidenceError('manifest.artifacts must contain 1-64 entries');
  }
  const evidenceReal = fs.realpathSync.native(evidenceDirectory);
  const byId = new Map();
  const paths = new Set();
  let totalBytes = 0;
  for (const raw of manifest.artifacts) {
    const artifact = assertPlainObject(raw, 'artifact');
    if (typeof artifact.id !== 'string' || !ARTIFACT_ID_PATTERN.test(artifact.id)
      || byId.has(artifact.id)) {
      throw evidenceError('artifact id is invalid or duplicated');
    }
    if (!['json', 'tap', 'junit', 'log', 'screenshot', 'video', 'network-capture', 'report']
      .includes(artifact.kind)) {
      throw evidenceError(`artifact ${artifact.id} has an unsupported kind`);
    }
    const filename = safeArtifactPath(evidenceDirectory, artifact.path);
    let stat;
    try {
      stat = fs.lstatSync(filename);
    } catch (_) {
      throw evidenceError(`artifact ${artifact.id} is missing`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0
      || stat.size > MAX_ARTIFACT_BYTES) {
      throw evidenceError(`artifact ${artifact.id} must be a bounded regular file`);
    }
    const real = fs.realpathSync.native(filename);
    const realBoundary = `${evidenceReal}${path.sep}`.toLowerCase();
    if (!real.toLowerCase().startsWith(realBoundary) || paths.has(real.toLowerCase())) {
      throw evidenceError(`artifact ${artifact.id} escapes or duplicates an evidence file`);
    }
    paths.add(real.toLowerCase());
    safeIntegerAtLeast(artifact.bytes, 1, `artifact ${artifact.id}.bytes`);
    if (artifact.bytes !== stat.size) {
      throw evidenceError(`artifact ${artifact.id} byte length does not match`);
    }
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || sha256File(filename) !== artifact.sha256) {
      throw evidenceError(`artifact ${artifact.id} SHA-256 does not match`);
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
      throw evidenceError('total collaboration evidence size exceeds the release-gate bound');
    }
    byId.set(artifact.id, Object.freeze({ ...artifact, filename }));
  }
  return byId;
}

function readAttestationArtifact(artifact, label) {
  if (!artifact || artifact.kind !== 'json' || artifact.bytes > MAX_ATTESTATION_BYTES) {
    throw evidenceError(`${label} must reference a bounded JSON attestation artifact`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(artifact.filename, 'utf8'));
  } catch (_) {
    throw evidenceError(`${label} attestation is not valid UTF-8 JSON`);
  }
  return assertPlainObject(parsed, `${label} attestation`);
}

function verifyAttestationTime(value, label, generatedAt) {
  const capturedAt = exactIsoTimestamp(value, `${label}.capturedAt`);
  if (capturedAt > generatedAt + 5 * 60 * 1000
    || generatedAt - capturedAt > MAX_EVIDENCE_AGE_MS) {
    throw evidenceError(`${label}.capturedAt is outside the evidence window`);
  }
}

function verifyEnvironmentArtifacts(environment, artifacts, context) {
  for (const device of environment.devices.values()) {
    const attestation = readAttestationArtifact(
      artifacts.get(device.attestationArtifactId),
      'device',
    );
    verifyAttestationTime(attestation.capturedAt, 'device attestation', context.generatedAt);
    if (attestation.contractVersion !== DEVICE_ATTESTATION_CONTRACT
      || attestation.challengeDigest !== environment.challengeDigest
      || attestation.sourceCommit !== context.sourceCommit
      || attestation.deviceId !== device.id
      || attestation.platform !== device.platform
      || attestation.physical !== true
      || attestation.arch !== device.arch
      || attestation.osBuild !== device.osBuild) {
      throw evidenceError('device attestation does not match the release environment');
    }
  }
  for (const client of environment.clients.values()) {
    const attestation = readAttestationArtifact(
      artifacts.get(client.evidenceArtifactId),
      'client',
    );
    verifyAttestationTime(attestation.capturedAt, 'client attestation', context.generatedAt);
    if (attestation.contractVersion !== CLIENT_ATTESTATION_CONTRACT
      || attestation.challengeDigest !== environment.challengeDigest
      || attestation.sourceCommit !== context.sourceCommit
      || attestation.clientId !== client.id
      || attestation.profileId !== client.profileId
      || attestation.sessionIdDigest !== client.sessionIdDigest
      || attestation.deviceId !== client.deviceId
      || attestation.browser !== client.browser) {
      throw evidenceError('client attestation does not match the release environment');
    }
  }
}

function subjectIdsForCheck(check, key, allowed, minimum, label) {
  const values = check[key];
  if (!Array.isArray(values) || values.length < minimum || values.length > 64
    || new Set(values).size !== values.length) {
    throw evidenceError(`check ${label}.${key} must contain ${minimum}-64 unique subject ids`);
  }
  for (const value of values) {
    if (!SUBJECT_ID_PATTERN.test(value) || !allowed.has(value)) {
      throw evidenceError(`check ${label}.${key} references an unknown subject`);
    }
  }
  return values;
}

function validateCheckSubjects(name, check, environment) {
  let minimumDevices = 0;
  let minimumClients = 0;
  if (name === 'lanMultiClient' || name === 'hostRestartRecovery') {
    minimumDevices = 2;
    minimumClients = 3;
  } else if (name === 'offline60Seconds') {
    minimumDevices = 2;
    minimumClients = 2;
  } else if (name === 'electronInstallUpgrade') {
    minimumDevices = 2;
  } else if (['chromeCompatibility', 'edgeCompatibility', 'upload100MiB',
    'rangePlayback'].includes(name)) {
    minimumDevices = 1;
    minimumClients = 1;
  }
  const deviceIds = minimumDevices > 0
    ? subjectIdsForCheck(check, 'subjectDeviceIds', environment.devices, minimumDevices, name)
    : [];
  const clientIds = minimumClients > 0
    ? subjectIdsForCheck(check, 'subjectClientIds', environment.clients, minimumClients, name)
    : [];
  const selectedDevices = new Set(deviceIds);
  for (const clientId of clientIds) {
    const client = environment.clients.get(clientId);
    if (!selectedDevices.has(client.deviceId)) {
      throw evidenceError(`check ${name} client subjects must belong to its device subjects`);
    }
  }
  if (minimumClients > 0
    && new Set(clientIds.map((clientId) => environment.clients.get(clientId).deviceId)).size < minimumDevices) {
    throw evidenceError(`check ${name} client subjects do not cover enough devices`);
  }
  if (name === 'chromeCompatibility'
    && !clientIds.some((clientId) => environment.clients.get(clientId).browser === 'chrome')) {
    throw evidenceError('check chromeCompatibility must reference a Chrome client');
  }
  if (name === 'edgeCompatibility'
    && !clientIds.some((clientId) => environment.clients.get(clientId).browser === 'edge')) {
    throw evidenceError('check edgeCompatibility must reference an Edge client');
  }
  const artifactIds = new Set(check.artifactIds);
  for (const deviceId of deviceIds) {
    if (!artifactIds.has(environment.devices.get(deviceId).attestationArtifactId)) {
      throw evidenceError(`check ${name} is missing a subject device attestation artifact`);
    }
  }
  for (const clientId of clientIds) {
    if (!artifactIds.has(environment.clients.get(clientId).evidenceArtifactId)) {
      throw evidenceError(`check ${name} is missing a subject client evidence artifact`);
    }
  }
  return Object.freeze({ deviceIds, clientIds });
}

function assertMetric(metrics, key, predicate, label) {
  if (!predicate(metrics[key])) throw evidenceError(`${label}.metrics.${key} is invalid`);
}

function validateCheckMetrics(name, metrics, subjects) {
  const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
  const positive = (value) => Number.isSafeInteger(value) && value >= 1;
  const zero = (value) => value === 0;
  if (name === 'lanMultiClient') {
    assertMetric(metrics, 'devices', (value) => value === subjects.deviceIds.length, name);
    assertMetric(metrics, 'clients', (value) => value === subjects.clientIds.length, name);
    assertMetric(metrics, 'simultaneousDifferentNodeMoves', positive, name);
    assertMetric(metrics, 'sameNodeConflictsResolved', positive, name);
    assertMetric(metrics, 'simultaneousTextEdits', positive, name);
    assertMetric(metrics, 'deleteEditConflictsResolved', positive, name);
    assertMetric(metrics, 'silentDataLoss', zero, name);
    assertMetric(metrics, 'resurrectedDeletes', zero, name);
    assertMetric(metrics, 'staleRunResultWrites', zero, name);
  } else if (name === 'offline60Seconds') {
    assertMetric(metrics, 'offlineDurationMs', (value) => Number.isSafeInteger(value) && value >= 60_000, name);
    assertMetric(metrics, 'clientsRecovered', (value) => (
      Number.isSafeInteger(value) && value >= subjects.clientIds.length
    ), name);
    assertMetric(metrics, 'operationGapsRecovered', positive, name);
    assertMetric(metrics, 'silentDataLoss', zero, name);
    assertMetric(metrics, 'resurrectedDeletes', zero, name);
    assertMetric(metrics, 'staleRunResultWrites', zero, name);
  } else if (name === 'hostRestartRecovery') {
    assertMetric(metrics, 'restartCount', positive, name);
    assertMetric(metrics, 'clientsReconnected', (value) => (
      Number.isSafeInteger(value) && value >= subjects.clientIds.length
    ), name);
    assertMetric(metrics, 'backupRestoreVerified', (value) => value === true, name);
    assertMetric(metrics, 'quickCheckOk', (value) => value === true, name);
    assertMetric(metrics, 'foreignKeyViolations', zero, name);
    assertMetric(metrics, 'silentDataLoss', zero, name);
    assertMetric(metrics, 'resurrectedDeletes', zero, name);
    assertMetric(metrics, 'staleRunResultWrites', zero, name);
  } else if (name === 'publicHealth') {
    assertMetric(metrics, 'statusCode', (value) => value === 200, name);
    assertMetric(metrics, 'tlsAuthorized', (value) => value === true, name);
    assertMetric(metrics, 'dnsResolvedPublic', (value) => value === true, name);
    assertMetric(metrics, 'totalDurationMs', (value) => (
      Number.isSafeInteger(value) && value >= 1 && value <= 10_000
    ), name);
  } else if (name === 'inviteRedeem') {
    assertMetric(metrics, 'successfulRedeems', positive, name);
    assertMetric(metrics, 'replayRejected', positive, name);
    assertMetric(metrics, 'expiredRejected', positive, name);
  } else if (name === 'websocketUpgrade') {
    assertMetric(metrics, 'statusCode', (value) => value === 101, name);
    assertMetric(metrics, 'joinedClients', (value) => Number.isSafeInteger(value) && value >= 3, name);
    assertMetric(metrics, 'unexpectedCloses', zero, name);
  } else if (name === 'upload100MiB') {
    assertMetric(metrics, 'bytes', (value) => Number.isSafeInteger(value) && value >= 100 * 1024 * 1024, name);
    assertMetric(metrics, 'completedUploads', positive, name);
    assertMetric(metrics, 'sha256Verified', (value) => value === true, name);
    assertMetric(metrics, 'unexpectedErrors', zero, name);
  } else if (name === 'rangePlayback') {
    assertMetric(metrics, 'bytes', (value) => Number.isSafeInteger(value) && value >= 100 * 1024 * 1024, name);
    assertMetric(metrics, 'partialResponses', positive, name);
    assertMetric(metrics, 'seekVerified', (value) => value === true, name);
  } else if (name === 'assetIndex100k') {
    assertMetric(metrics, 'assets', (value) => Number.isSafeInteger(value) && value >= 100_000, name);
  } else if (name === 'connectionLoad') {
    assertMetric(metrics, 'peakConnections', (value) => Number.isSafeInteger(value) && value >= 100, name);
    assertMetric(metrics, 'unexpectedDisconnects', zero, name);
  } else if (name === 'operationThroughput') {
    assertMetric(metrics, 'operations', (value) => Number.isSafeInteger(value) && value >= 10_000, name);
    assertMetric(metrics, 'durationMs', positive, name);
    assertMetric(metrics, 'unexpectedErrors', zero, name);
    if (metrics.operations / metrics.durationMs < 0.1) {
      throw evidenceError(`${name}.metrics must sustain at least 100 operations per second`);
    }
  } else if (name === 'storageGrowth') {
    assertMetric(metrics, 'withinConfiguredBudget', (value) => value === true, name);
    assertMetric(metrics, 'observedGrowthBytes', nonnegative, name);
    assertMetric(metrics, 'durationMs', positive, name);
  } else if (name === 'privateSurfaceScan') {
    assertMetric(metrics, 'exposedPrivateEndpoints', (value) => value === 0, name);
  } else if (name === 'sensitiveLogScan') {
    assertMetric(metrics, 'findings', (value) => value === 0, name);
  } else if (['reviewerAuthorizationRedTeam', 'pathMimeCompressionRedTeam',
    'ssrfDeepJsonRedTeam', 'replayRedTeam'].includes(name)) {
    assertMetric(metrics, 'unexpectedBypasses', (value) => value === 0, name);
  } else if (['loginRateLimit', 'uploadRateLimit', 'downloadRateLimit'].includes(name)) {
    assertMetric(metrics, 'limitedRequests', positive, name);
    assertMetric(metrics, 'stableRetryAfter', (value) => value === true, name);
  } else if (name === 'messageRateLimit') {
    assertMetric(metrics, 'limitedMessages', positive, name);
    assertMetric(metrics, 'stableCloseSemantics', (value) => value === true, name);
  } else if (name === 'electronInstallUpgrade') {
    assertMetric(metrics, 'installedPackageVerified', (value) => value === true, name);
    assertMetric(metrics, 'upgradeVerified', (value) => value === true, name);
    assertMetric(metrics, 'downgradeRejected', (value) => value === true, name);
    assertMetric(metrics, 'betterSqlite3Loaded', (value) => value === true, name);
    assertMetric(metrics, 'dataMigrationVerified', (value) => value === true, name);
  } else if (name === 'chromeCompatibility' || name === 'edgeCompatibility') {
    assertMetric(metrics, 'scenariosPassed', positive, name);
    assertMetric(metrics, 'unexpectedErrors', zero, name);
  }
}

function verifyChecks(manifest, artifacts, generatedAt, environment) {
  const checks = assertPlainObject(manifest.checks, 'manifest.checks');
  const referenced = new Set();
  for (const name of REQUIRED_CHECKS) {
    if (!Object.hasOwn(checks, name)) throw evidenceError(`required check is missing: ${name}`);
  }
  for (const [name, raw] of Object.entries(checks)) {
    if (!/^[a-z][A-Za-z0-9]{2,63}$/.test(name)) throw evidenceError(`check name is invalid: ${name}`);
    const check = assertPlainObject(raw, `check ${name}`);
    if (check.status !== 'passed') throw evidenceError(`check ${name} did not pass`);
    const completedAt = exactIsoTimestamp(check.completedAt, `check ${name}.completedAt`);
    if (completedAt > generatedAt + 5 * 60 * 1000
      || generatedAt - completedAt > MAX_EVIDENCE_AGE_MS) {
      throw evidenceError(`check ${name} timestamp is outside the evidence window`);
    }
    if (!Array.isArray(check.artifactIds) || check.artifactIds.length < 1
      || new Set(check.artifactIds).size !== check.artifactIds.length) {
      throw evidenceError(`check ${name} must reference at least one unique artifact`);
    }
    for (const id of check.artifactIds) {
      if (!artifacts.has(id)) throw evidenceError(`check ${name} references unknown artifact ${id}`);
      referenced.add(id);
    }
    const subjects = validateCheckSubjects(name, check, environment);
    const metrics = assertPlainObject(check.metrics || {}, `check ${name}.metrics`);
    validateCheckMetrics(name, metrics, subjects);
  }
  const unreferenced = [...artifacts.keys()].filter((id) => !referenced.has(id));
  if (unreferenced.length > 0) {
    throw evidenceError(`unreferenced artifacts are forbidden: ${unreferenced.join(', ')}`);
  }
  return Object.freeze({ checkCount: Object.keys(checks).length, referencedArtifactCount: referenced.size });
}

function assertCollaborationReleaseEvidence(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const evidencePath = resolveEvidencePath(root, options.evidencePath);
  const manifest = readManifest(evidencePath);
  const version = String(options.version || require(path.join(root, 'package.json')).version);
  const target = String(options.target || process.env.T8_RELEASE_TARGET || '').toLowerCase();
  if (manifest.contractVersion !== CONTRACT_VERSION) {
    throw evidenceError(`manifest.contractVersion must be ${CONTRACT_VERSION}`);
  }
  if (manifest.releaseVersion !== version) {
    throw evidenceError(`evidence releaseVersion ${manifest.releaseVersion || '(missing)'} does not match ${version}`);
  }
  if (!/^[a-f0-9]{40}$/.test(target)
    || String(manifest.sourceCommit || '').toLowerCase() !== target) {
    throw evidenceError('evidence sourceCommit does not match the exact release target');
  }
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const generatedAt = exactIsoTimestamp(manifest.generatedAt, 'manifest.generatedAt');
  if (generatedAt > now + 5 * 60 * 1000 || now - generatedAt > MAX_EVIDENCE_AGE_MS) {
    throw evidenceError('collaboration release evidence is stale or from the future');
  }
  const environment = assertPublicEnvironment(manifest.environment);
  const evidenceDirectory = path.dirname(evidencePath);
  const artifacts = verifyArtifacts(manifest, evidenceDirectory);
  verifyEnvironmentArtifacts(environment, artifacts, {
    sourceCommit: target,
    generatedAt,
  });
  const checks = verifyChecks(manifest, artifacts, generatedAt, environment);
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    evidencePath,
    releaseVersion: version,
    sourceCommit: target,
    generatedAt: manifest.generatedAt,
    publicBaseUrl: environment.publicBaseUrl,
    deviceCount: environment.devices.size,
    clientCount: environment.clients.size,
    artifactCount: artifacts.size,
    checkCount: checks.checkCount,
    manifestSha256: sha256File(evidencePath),
  });
}

function assertCollaborationReleaseEvidenceForPublish(options = {}) {
  try {
    return Object.freeze({
      ...assertCollaborationReleaseEvidence(options),
      deferred: false,
    });
  } catch (error) {
    const version = String(options.version || require(path.join(
      path.resolve(options.root || path.join(__dirname, '..')),
      'package.json',
    )).version);
    const target = String(options.target || process.env.T8_RELEASE_TARGET || '').toLowerCase();
    const approval = String(
      options.deferralApproval ?? process.env.T8_COLLAB_RELEASE_EVIDENCE_DEFERRAL ?? '',
    );
    const missingManifest = error?.code === 'collaboration_release_evidence_invalid'
      && error?.details?.reason === 'ENOENT';
    if (version !== POST_RELEASE_DEFERRAL_VERSION
      || approval !== POST_RELEASE_DEFERRAL_APPROVAL
      || !/^[a-f0-9]{40}$/.test(target)
      || !missingManifest) {
      throw error;
    }
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      releaseVersion: version,
      sourceCommit: target,
      deferred: true,
      deferralApproval: POST_RELEASE_DEFERRAL_APPROVAL,
      reason: 'owner-approved-post-release-evidence',
    });
  }
}

function gitHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.status !== 0) throw evidenceError('cannot resolve git HEAD for evidence validation');
  return String(result.stdout || '').trim().toLowerCase();
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const pathIndex = args.indexOf('--evidence');
  const targetIndex = args.indexOf('--target');
  const evidencePath = pathIndex >= 0 ? args[pathIndex + 1] : undefined;
  const target = targetIndex >= 0 ? args[targetIndex + 1] : gitHead(root);
  const result = assertCollaborationReleaseEvidence({ root, evidencePath, target });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[collaboration-release-evidence] ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  COLLABORATION_RELEASE_EVIDENCE_CONTRACT: CONTRACT_VERSION,
  COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_APPROVAL: POST_RELEASE_DEFERRAL_APPROVAL,
  COLLABORATION_RELEASE_EVIDENCE_POST_RELEASE_DEFERRAL_VERSION: POST_RELEASE_DEFERRAL_VERSION,
  COLLABORATION_RELEASE_REQUIRED_CHECKS: REQUIRED_CHECKS,
  assertCollaborationReleaseEvidence,
  assertCollaborationReleaseEvidenceForPublish,
};
