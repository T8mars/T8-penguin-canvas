'use strict';
// Auxiliary provenance attached to committed media; not a submission ledger.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { manifestPathFor } = require('./materializedOutputStore');
const { MODELS, MODEL_FORMATS } = require('../providers/tripo3d');
function json(file) { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || s.size > 256 * 1024) throw Error('Invalid receipt'); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeTripoMediaMetadata(outputDir, file, result, taskId) {
  if (!MODEL_FORMATS.has(file.type) || !MODELS.includes(result.model)) return;
  const name = /^\/files\/output\/([^/?#]+)$/.exec(file.url || '')?.[1];
  if (!name || path.basename(name) !== name) throw Error('Invalid Tripo media path');
  const receipt = manifestPathFor(outputDir, name), manifest = json(receipt);
  const value = { schema: 't8-tripo-media-v1', contentHash: manifest.sha256, taskId, model: result.model,
    fileRole: file.name, format: file.type, tripoTaskId: result.tripoTaskId || '', tripoPartNames: result.partNames || [] };
  const target = receipt + '.tripo.json', temporary = target + '.' + crypto.randomUUID() + '.part';
  let fd;
  try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, target); }
  finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); }
}
function readTripoMediaMetadata(outputDir, absolute, contentHash, recovery) {
  try {
    if (fs.realpathSync.native(path.dirname(absolute)) !== fs.realpathSync.native(outputDir)) return null;
    const s = fs.lstatSync(absolute); if (!s.isFile() || s.isSymbolicLink()) return null;
    const value = json(manifestPathFor(outputDir, path.basename(absolute)) + '.tripo.json');
    if (value.schema !== 't8-tripo-media-v1' || !MODELS.includes(value.model) || !MODEL_FORMATS.has(value.format)
      || !/^[a-f0-9]{64}$/.test(value.contentHash) || path.extname(absolute) !== '.' + value.format) return null;
    if (recovery && (recovery.kind !== 'model3d' || value.taskId !== recovery.taskId || value.model !== recovery.model)) return null;
    if (contentHash === undefined) {
      const hash = crypto.createHash('sha256'), fd = fs.openSync(absolute, 'r'), chunk = Buffer.alloc(1024 * 1024);
      try { let n; while ((n = fs.readSync(fd, chunk))) hash.update(chunk.subarray(0, n)); } finally { fs.closeSync(fd); }
      contentHash = hash.digest('hex');
    }
    return value.contentHash === contentHash ? value : null;
  } catch { return null; }
}
module.exports = { writeTripoMediaMetadata, readTripoMediaMetadata };
