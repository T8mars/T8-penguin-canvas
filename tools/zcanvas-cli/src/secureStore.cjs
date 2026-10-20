'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withStoreLock } = require('./secureStoreTransactions.cjs');

const STORE_SCHEMA = 't8-zcanvas-secure-store-v1';
const STORE_LIMIT = 256 * 1024;
const DPAPI_ENTROPY = 't8-zcanvas-agent-control-v1';
const TRANSACTION_PROTOCOL = 't8-zcanvas-secure-store-transaction-v1';
const snapshots = new WeakMap();

function remember(store, filePath, bytes) {
  snapshots.set(store, { path: path.resolve(filePath), hash: bytes == null ? null : crypto.createHash('sha256').update(bytes).digest('hex') });
  return store;
}

class SecureStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SecureStoreError';
    this.code = code;
  }
}

function storePath(options = {}) {
  const explicit = String(options.env?.ZCANVAS_AUTH_STORE || process.env.ZCANVAS_AUTH_STORE || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(options.homeDir || os.homedir(), '.zcanvas', 'credentials-v1.json');
}

function encodedPowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runDpapi(mode, value, options = {}) {
  const executable = options.powerShell || 'powershell.exe';
  const protect = mode === 'protect';
  const operation = protect
    ? '[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)'
    : '[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)';
  const prefix = protect ? '$b=[Text.Encoding]::UTF8.GetBytes($v);' : '';
  const suffix = protect ? '[Convert]::ToBase64String($o)' : '[Text.Encoding]::UTF8.GetString($o)';
  const script = [
    '$ErrorActionPreference="Stop";',
    'Add-Type -AssemblyName System.Security;',
    '$v=[Console]::In.ReadToEnd();',
    `$e=[Text.Encoding]::UTF8.GetBytes("${DPAPI_ENTROPY}");`,
    prefix,
    `$o=${operation};`,
    `[Console]::Out.Write(${suffix});`,
  ].join('');
  const run = options.spawnSync || spawnSync;
  const attemptLimit = Number.isInteger(options.dpapiAttempts)
    ? Math.max(1, Math.min(5, options.dpapiAttempts))
    : 3;
  let result = null;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    result = run(executable, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedPowerShell(script),
    ], {
      input: String(value),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      shell: false,
    });
    if (!result.error && result.status === 0 && String(result.stdout || '').trim()) {
      return String(result.stdout).trim();
    }
  }
  throw new SecureStoreError(
    'CREDENTIAL_STORE_UNAVAILABLE',
    'Windows 当前用户加密存储不可用，未保存 Agent 凭据',
  );
}

function protectValue(value, options = {}) {
  if (typeof options.protect === 'function') return options.protect(String(value));
  const platform = options.platform || process.platform;
  if (platform === 'win32') return runDpapi('protect', value, options);
  if ((options.env || process.env).ZCANVAS_ALLOW_FILE_CREDENTIALS === '1') {
    return Buffer.from(String(value), 'utf8').toString('base64');
  }
  throw new SecureStoreError(
    'CREDENTIAL_STORE_UNAVAILABLE',
    '当前系统没有可用的安全凭据存储；未保存 Agent 凭据',
  );
}

function unprotectValue(value, options = {}) {
  if (typeof options.unprotect === 'function') return options.unprotect(String(value));
  const platform = options.platform || process.platform;
  if (platform === 'win32') return runDpapi('unprotect', value, options);
  if ((options.env || process.env).ZCANVAS_ALLOW_FILE_CREDENTIALS === '1') {
    return Buffer.from(String(value), 'base64').toString('utf8');
  }
  throw new SecureStoreError(
    'CREDENTIAL_STORE_UNAVAILABLE',
    '当前系统没有可用的安全凭据存储；无法读取 Agent 凭据',
  );
}

function emptyStore() {
  return {
    schema: STORE_SCHEMA,
    sessions: {},
    pending: {},
    contexts: {},
    approvals: {},
    recipeSigning: null,
  };
}

function readStore(options = {}) {
  const filePath = storePath(options);
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > STORE_LIMIT) {
      throw new SecureStoreError('CREDENTIAL_STORE_INVALID', 'Agent 凭据存储无效');
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > STORE_LIMIT) throw new SecureStoreError('CREDENTIAL_STORE_INVALID', 'Agent 凭据存储无效');
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (parsed?.schema !== STORE_SCHEMA
      || !parsed.sessions || typeof parsed.sessions !== 'object'
      || !parsed.pending || typeof parsed.pending !== 'object'
      || (parsed.contexts != null && typeof parsed.contexts !== 'object')
      || (parsed.approvals != null && typeof parsed.approvals !== 'object')
      || (parsed.recipeSigning != null && typeof parsed.recipeSigning !== 'object')) {
      throw new SecureStoreError('CREDENTIAL_STORE_INVALID', 'Agent 凭据存储格式不兼容');
    }
    if (!parsed.contexts) parsed.contexts = {};
    if (!parsed.approvals) parsed.approvals = {};
    if (!parsed.recipeSigning) parsed.recipeSigning = null;
    return remember(parsed, filePath, bytes);
  } catch (error) {
    if (error?.code === 'ENOENT') return remember(emptyStore(), filePath, null);
    if (error instanceof SecureStoreError) throw error;
    throw new SecureStoreError('CREDENTIAL_STORE_INVALID', '无法读取 Agent 凭据存储');
  }
}

function writeStoreAtomic(store, options, lease) {
  const filePath = lease.filename;
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${lease.pid}.${lease.nonce}.tmp`;
  const serialized = `${JSON.stringify(store)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > STORE_LIMIT) {
    throw new SecureStoreError('CREDENTIAL_STORE_FULL', 'Agent 凭据存储超过安全限制');
  }
  try {
    const descriptor = fs.openSync(tempPath, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, serialized, 'utf8'); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(tempPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    remember(store, storePath(options), serialized);
  } finally {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
  }
}

function locked(options, work) {
  try { return withStoreLock(storePath(options), work); }
  catch (error) {
    if (error instanceof SecureStoreError) throw error;
    const code = /^(?:CREDENTIAL_STORE_[A-Z_]+|PAIRING_PROGRESS_CHANGED|PAIRING_ALREADY_PENDING)$/.test(String(error.code || '')) ? error.code : 'CREDENTIAL_STORE_WRITE_FAILED';
    throw new SecureStoreError(code, code === 'CREDENTIAL_STORE_BUSY' ? '另一进程正在更新 Agent 配对，请稍后再试；未覆盖已有凭据' : 'Agent 凭据更新未完成，已有记录未被无条件覆盖');
  }
}
function updateStore(options, update) {
  return locked(options, lease => {
    const store = readStore(options), result = update(store);
    if (result.changed !== false) writeStoreAtomic(store, options, lease);
    return result.value;
  });
}
function writeStore(store, options = {}) {
  return locked(options, lease => {
    const current = readStore(options), previous = snapshots.get(store), actual = snapshots.get(current);
    if ((!previous && actual.hash !== null) || (previous && (previous.path !== actual.path || previous.hash !== actual.hash))) throw new SecureStoreError('CREDENTIAL_STORE_CHANGED', '凭据快照已变化，请重新读取后再更新');
    if (!store || store.schema !== STORE_SCHEMA || !store.sessions || !store.pending) throw new SecureStoreError('CREDENTIAL_STORE_INVALID', 'Agent 凭据存储格式不兼容');
    writeStoreAtomic(store, options, lease);
  });
}

function assertExpected(record, idField, expected, origin) {
  if (expected !== undefined && (!record || record[idField] !== expected || (origin !== undefined && record.origin !== origin))) throw new SecureStoreError('PAIRING_PROGRESS_CHANGED', '配对或会话已由另一进程更新，未覆盖新的记录');
}

function storePending(instance, pairing, options = {}) {
  const record = {
    instanceId: instance.instanceId,
    origin: instance.origin,
    pairingId: pairing.pairingId,
    userCode: pairing.userCode,
    expiresAt: pairing.expiresAt,
    pollSecretProtected: protectValue(pairing.pollSecret, options),
    protection: (options.platform || process.platform) === 'win32' ? 'windows-dpapi-current-user' : 'restricted-file',
  };
  return updateStore(options, store => {
    const previous = store.pending[instance.instanceId];
    if (previous?.pairingId === pairing.pairingId) {
      if (previous.origin !== instance.origin || previous.userCode !== pairing.userCode || previous.expiresAt !== pairing.expiresAt) throw new SecureStoreError('PAIRING_PROGRESS_CHANGED', '同一配对请求的身份信息已变化，未覆盖原记录');
      return { value: { ...previous, pollSecretProtected: undefined }, changed: false };
    }
    if (previous && !(Date.parse(previous.expiresAt) <= Date.now())) throw new SecureStoreError('PAIRING_ALREADY_PENDING', '此实例已有待确认配对，请先在画布处理已有请求');
    store.pending[instance.instanceId] = record;
    return { value: { ...record, pollSecretProtected: undefined } };
  });
}

function loadPending(instanceId, options = {}) {
  const store = readStore(options);
  const record = store.pending[String(instanceId || '')];
  if (!record) return null;
  return {
    ...record,
    pollSecret: unprotectValue(record.pollSecretProtected, options),
    pollSecretProtected: undefined,
  };
}

function deletePending(instanceId, options = {}) {
  return updateStore(options, store => {
    const key = String(instanceId || '');
    assertExpected(store.pending[key], 'pairingId', options.expectedPairingId, options.expectedOrigin);
    const existed = Boolean(store.pending[key]); delete store.pending[key];
    return { value: existed };
  });
}

function storeSession(instance, session, options = {}) {
  const record = {
    instanceId: instance.instanceId,
    origin: instance.origin,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    accessTokenProtected: protectValue(session.accessToken, options),
    protection: (options.platform || process.platform) === 'win32' ? 'windows-dpapi-current-user' : 'restricted-file',
  };
  return updateStore(options, store => {
    const pending = store.pending[instance.instanceId];
    if (session.pairingId !== undefined) assertExpected(pending, 'pairingId', session.pairingId, instance.origin);
    else if (pending && !(Date.parse(pending.expiresAt) <= Date.now())) throw new SecureStoreError('PAIRING_PROGRESS_CHANGED', '当前待配对请求需要匹配的身份，未覆盖它');
    store.sessions[instance.instanceId] = record; delete store.pending[instance.instanceId];
    return { value: { ...record, accessTokenProtected: undefined } };
  });
}

function loadSession(instanceId, options = {}) {
  const store = readStore(options);
  const record = store.sessions[String(instanceId || '')];
  if (!record) return null;
  return {
    ...record,
    accessToken: unprotectValue(record.accessTokenProtected, options),
    accessTokenProtected: undefined,
  };
}

function deleteSession(instanceId, options = {}) {
  return updateStore(options, store => {
    const key = String(instanceId || '');
    assertExpected(store.sessions[key], 'sessionId', options.expectedSessionId, options.expectedOrigin);
    const existed = Boolean(store.sessions[key]); delete store.sessions[key];
    return { value: existed };
  });
}

function configuredInstances(options = {}) {
  const store = readStore(options);
  const current = Number(options.now) || Date.now();
  const remainsValid = (record) => Date.parse(String(record?.expiresAt || '')) > current;
  return {
    sessions: Object.values(store.sessions)
      .filter(remainsValid)
      .map((record) => ({
        instanceId: record.instanceId,
        origin: record.origin,
        sessionId: record.sessionId,
        expiresAt: record.expiresAt,
        configured: true,
      })),
    pending: Object.values(store.pending)
      .filter(remainsValid)
      .map((record) => ({
        instanceId: record.instanceId,
        origin: record.origin,
        pairingId: record.pairingId,
        userCode: record.userCode,
        expiresAt: record.expiresAt,
        configured: true,
      })),
  };
}

function getRecipeSigningSecret(options = {}) {
  const store = readStore(options);
  if (store.recipeSigning?.secretProtected) {
    return {
      keyId: String(store.recipeSigning.keyId || ''),
      secret: unprotectValue(store.recipeSigning.secretProtected, options),
    };
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  const keyId = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 20);
  const candidate = {
    keyId,
    secretProtected: protectValue(secret, options),
    protection: (options.platform || process.platform) === 'win32'
      ? 'windows-dpapi-current-user'
      : 'restricted-file',
    createdAt: new Date().toISOString(),
  };
  const selected = updateStore(options, current => {
    if (current.recipeSigning?.secretProtected) return { value: { record: current.recipeSigning, created: false }, changed: false };
    current.recipeSigning = candidate;
    return { value: { record: candidate, created: true } };
  });
  return selected.created ? { keyId, secret } : { keyId: String(selected.record.keyId || ''), secret: unprotectValue(selected.record.secretProtected, options) };
}

function setWorkspaceContext(instanceId, context, options = {}) {
  const key = String(instanceId || '').trim();
  const projectId = String(context?.projectId || '').trim();
  const canvasId = String(context?.canvasId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(key)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(projectId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(canvasId)) {
    throw new SecureStoreError('WORKSPACE_CONTEXT_INVALID', '工作区项目或画布 ID 无效');
  }
  const record = {
    instanceId: key,
    projectId,
    canvasId,
    selectedAt: new Date().toISOString(),
  };
  return updateStore(options, store => { store.contexts[key] = record; return { value: record }; });
}

function getWorkspaceContext(instanceId, options = {}) {
  const store = readStore(options);
  const context = store.contexts[String(instanceId || '')];
  return context ? { ...context } : null;
}

function storeApproval(instance, approval, options = {}) {
  const approvalRequestId = String(approval.approvalRequestId || '');
  if (!approvalRequestId) {
    throw new SecureStoreError('APPROVAL_INVALID', '待确认操作缺少 approvalRequestId');
  }
  const key = `${instance.instanceId}:${approvalRequestId}`;
  const record = {
    instanceId: instance.instanceId,
    origin: instance.origin,
    approvalRequestId,
    action: String(approval.action || ''),
    creativeAction: String(approval.preview?.creator?.action || approval.creativeAction || ''),
    operationId: String(approval.operationId || ''),
    patchId: String(approval.patchId || ''),
    projectId: String(approval.projectId || ''),
    canvasId: String(approval.canvasId || ''),
    expiresAt: String(approval.expiresAt || ''),
    pollSecretProtected: protectValue(approval.pollSecret, options),
    protection: (options.platform || process.platform) === 'win32' ? 'windows-dpapi-current-user' : 'restricted-file',
  };
  return updateStore(options, store => { store.approvals[key] = record; return { value: { ...record, pollSecretProtected: undefined } }; });
}

function approvalRecordsForInstance(store, instanceId) {
  const key = String(instanceId || '');
  return Object.values(store.approvals || {})
    .filter((record) => record && String(record.instanceId || '') === key)
    .sort((left, right) => String(right.expiresAt || '').localeCompare(String(left.expiresAt || '')));
}

function loadApproval(instanceId, approvalRequestIdOrOptions = {}, maybeOptions = {}) {
  const approvalRequestId = typeof approvalRequestIdOrOptions === 'string'
    ? approvalRequestIdOrOptions
    : '';
  const options = typeof approvalRequestIdOrOptions === 'string'
    ? maybeOptions
    : approvalRequestIdOrOptions;
  const store = readStore(options);
  const records = approvalRecordsForInstance(store, instanceId);
  const record = approvalRequestId
    ? records.find((item) => item.approvalRequestId === approvalRequestId)
    : records[0];
  if (!record) return null;
  return {
    ...record,
    pollSecret: unprotectValue(record.pollSecretProtected, options),
    pollSecretProtected: undefined,
  };
}

function deleteApproval(instanceId, approvalRequestIdOrOptions = {}, maybeOptions = {}) {
  const approvalRequestId = typeof approvalRequestIdOrOptions === 'string'
    ? approvalRequestIdOrOptions
    : '';
  const options = typeof approvalRequestIdOrOptions === 'string'
    ? maybeOptions
    : approvalRequestIdOrOptions;
  return updateStore(options, store => {
    let existed = false;
    for (const [key, record] of Object.entries(store.approvals || {})) {
      if (String(record?.instanceId || '') !== String(instanceId || '')) continue;
      if (approvalRequestId && record.approvalRequestId !== approvalRequestId) continue;
      existed = true; delete store.approvals[key];
    }
    return { value: existed };
  });
}

module.exports = {
  TRANSACTION_PROTOCOL,
  DPAPI_ENTROPY,
  STORE_LIMIT,
  STORE_SCHEMA,
  SecureStoreError,
  configuredInstances,
  deletePending,
  deleteApproval,
  deleteSession,
  loadPending,
  loadApproval,
  loadSession,
  getWorkspaceContext,
  getRecipeSigningSecret,
  protectValue,
  readStore,
  runDpapi,
  storePath,
  storePending,
  storeApproval,
  storeSession,
  setWorkspaceContext,
  unprotectValue,
  writeStore,
};
