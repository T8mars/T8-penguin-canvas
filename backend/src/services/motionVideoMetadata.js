'use strict';
// Auxiliary media provenance only. Run/NodeRun/Attempt remain the sole task ledger.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { manifestPathFor } = require('./materializedOutputStore');
const { contract, sanitizeMotionMetadata } = require('../providers/motionVideoContract');
const LIMIT = 512 * 1024;
function readJson(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) return null;
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function validResult(value) {
  return value?.schema === contract.resultSchema && contract.models.includes(value.model)
    && /^[A-Za-z0-9._:-]{1,512}$/.test(value.taskId || '')
    && /^seedance-nz:[a-f0-9]{64}$/.test(value.connectionRef || '');
}
function auxiliaryResult(result) {
  const clean = sanitizeMotionMetadata({ storyboard: result.storyboard, fallbackScenes: result.fallbackScenes, warnings: result.warnings });
  return { storyboard: clean.data?.storyboard || null,
    fallbackScenes: Array.isArray(clean.data?.fallbackScenes) ? clean.data.fallbackScenes : [],
    warnings: [...new Set([...(Array.isArray(clean.data?.warnings) ? clean.data.warnings : []), ...clean.warnings])],
    ...(/^\/files\/output\/[^/?#]+$/.test(result.coverUrl || '') ? { coverUrl: result.coverUrl } : {}) };
}
function writeMotionVideoMetadata(outputDir, url, result) {
  const match = String(url).match(/^\/files\/output\/([^/?#]+)$/);
  if (!match || path.basename(match[1]) !== match[1] || !validResult(result)) return false;
  const manifestPath = manifestPathFor(outputDir, match[1]);
  const manifest = readJson(manifestPath);
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) return false;
  const auxiliary = auxiliaryResult(result);
  const data = { schema: 't8-motion-media-metadata-v1', contentHash: manifest.sha256, result: {
    ...auxiliary, schema: contract.resultSchema, model: result.model, taskId: result.taskId, connectionRef: result.connectionRef,
  } };
  const target = `${manifestPath}.motion.json`, temporary = `${target}.${crypto.randomUUID()}.part`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, target);
    return true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(temporary, { force: true }); } catch { /* own temporary only */ }
  }
}
function readMotionVideoMetadata(outputDir, absolute, contentHash, recovery) {
  if (recovery?.kind !== 'motion') return null;
  try {
    // Windows may hand the verifier the long path while TEMP/config uses an
    // 8.3 alias. Compare real directories, not their spelling.
    if (fs.realpathSync.native(path.dirname(absolute)) !== fs.realpathSync.native(outputDir)) return null;
    const stored = readJson(`${manifestPathFor(outputDir, path.basename(absolute))}.motion.json`);
    const value = stored?.result;
    if (stored?.schema !== 't8-motion-media-metadata-v1' || stored.contentHash !== contentHash || !validResult(value)
      || value.taskId !== recovery.taskId || value.model !== recovery.model || value.connectionRef !== recovery.connectionRef) return null;
    return { ...auxiliaryResult(value), schema: contract.resultSchema, taskId: value.taskId, model: value.model, connectionRef: value.connectionRef };
  } catch { return null; }
}
module.exports = { writeMotionVideoMetadata, readMotionVideoMetadata };
