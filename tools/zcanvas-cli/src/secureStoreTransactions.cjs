'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOCK_TIMEOUT_MS = 2000;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const identifier = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const receiptName = new RegExp(`^(owner|recover)-([1-9][0-9]{0,9})-(${identifier})$`);
const noncePattern = new RegExp(`^${identifier}$`);

function lockError(code) {
  const error = new Error(code === 'CREDENTIAL_STORE_BUSY'
    ? '另一进程正在更新 Agent 配对，请稍后再试；未覆盖已有凭据'
    : 'Agent 凭据写入协调不可用；未绕过保护写入');
  error.code = code; return error;
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}
function unlinkOwned(filename) {
  try { fs.unlinkSync(filename); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function readOwner(filename) {
  let descriptor;
  try {
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
    descriptor = fs.openSync(filename, 'r');
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== info.dev || opened.ino !== info.ino) return null;
    if (opened.size > 1024) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length > 1024) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
    const data = JSON.parse(bytes.toString('utf8'));
    if (data?.schema !== 't8-zcanvas-store-lock-v1' || !Number.isSafeInteger(data.pid) || data.pid < 1 || data.pid > 2147483647 || !noncePattern.test(String(data.nonce || ''))) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (String(error.code || '').startsWith('CREDENTIAL_STORE_')) throw error;
    throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function regularReceipt(filename, maximum) {
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
}

/** Cooperative synchronous transactions. Only participating native writers are
 * serialized; this is not an OS sandbox against arbitrary direct file writes.
 * Recovery claims prevent a contender entering while a dead lock is reclaimed.
 * Unique claim names can be removed after a dead PID without an unlink/recreate
 * race. Live PIDs are never reclaimed based on age. */
function withStoreLock(filename, work) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parent = fs.realpathSync.native(directory);
  let canonical = path.join(parent, path.basename(filename));
  try {
    const info = fs.lstatSync(canonical);
    if (info.isSymbolicLink() || !info.isFile()) throw lockError('CREDENTIAL_STORE_INVALID');
    canonical = fs.realpathSync.native(canonical);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stateDirectory = canonical + '.lock-state';
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(stateDirectory).isDirectory() || fs.lstatSync(stateDirectory).isSymbolicLink()) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
  const lock = canonical + '.lock';
  const owner = { schema: 't8-zcanvas-store-lock-v1', pid: process.pid, nonce: crypto.randomUUID() };
  const ownFile = path.join(stateDirectory, `owner-${owner.pid}-${owner.nonce}`);
  fs.writeFileSync(ownFile, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  const matches = value => value?.pid === owner.pid && value?.nonce === owner.nonce;
  const temporary = value => `${canonical}.${value.pid}.${value.nonce}.tmp`;
  let acquired = false;

  function recoveryActive() {
    const names = fs.readdirSync(stateDirectory);
    if (names.length > 1024) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
    let active = false;
    for (const name of names) {
      const match = receiptName.exec(name);
      if (!match || name === path.basename(ownFile)) continue;
      const full = path.join(stateDirectory, name);
      try { regularReceipt(full, match[1] === 'recover' ? 0 : 1024); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const pid = Number(match[2]);
      if (!Number.isSafeInteger(pid) || pid > 2147483647) throw lockError('CREDENTIAL_STORE_LOCK_INVALID');
      if (alive(pid)) { if (match[1] === 'recover') active = true; continue; }
      // These names are never reused by the native protocol. Neither the
      // checkpoint nor an unrelated file is removed during orphan cleanup.
      if (match[1] === 'owner') {
        const orphan = temporary({ pid, nonce: match[3] });
        try { regularReceipt(orphan, 256 * 1024); unlinkOwned(orphan); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      unlinkOwned(full);
    }
    return active;
  }
  function releasePrimary() {
    const current = readOwner(lock);
    if (matches(current)) unlinkOwned(lock);
    else if (acquired) throw lockError('CREDENTIAL_STORE_LOCK_CHANGED');
  }
  function recoverDeadPrimary() {
    const claim = path.join(stateDirectory, `recover-${process.pid}-${crypto.randomUUID()}`);
    fs.closeSync(fs.openSync(claim, 'wx', 0o600));
    try {
      // Re-read under our unique claim. A writer that appeared before the
      // claim is alive; one that appeared after must fail its entry check.
      const current = readOwner(lock);
      if (current && !alive(current.pid)) {
        unlinkOwned(lock);
        const orphan = temporary(current);
        try { regularReceipt(orphan, 256 * 1024); unlinkOwned(orphan); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    } finally { unlinkOwned(claim); }
  }
  const deadline = process.hrtime.bigint() + BigInt(LOCK_TIMEOUT_MS) * 1000000n;
  try {
    while (process.hrtime.bigint() < deadline) {
      if (!recoveryActive()) {
        try {
          // A hard link publishes a fully initialized owner receipt with an
          // exclusive create, avoiding an empty primary lock after a crash.
          fs.linkSync(ownFile, lock);
          if (!recoveryActive() && matches(readOwner(lock))) { acquired = true; break; }
          releasePrimary();
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const current = readOwner(lock);
          if (current && !alive(current.pid)) recoverDeadPrimary();
        }
      }
      Atomics.wait(sleepCell, 0, 0, 10);
    }
    if (!acquired) throw lockError('CREDENTIAL_STORE_BUSY');
    return work({ filename: canonical, pid: owner.pid, nonce: owner.nonce });
  } catch (error) {
    if (String(error.code || '').startsWith('CREDENTIAL_STORE_') || error.code === 'PAIRING_PROGRESS_CHANGED' || error.code === 'PAIRING_ALREADY_PENDING') throw error;
    throw lockError('CREDENTIAL_STORE_LOCK_UNAVAILABLE');
  } finally {
    try { if (acquired) releasePrimary(); }
    finally { unlinkOwned(ownFile); }
  }
}

module.exports = { LOCK_TIMEOUT_MS, withStoreLock };
