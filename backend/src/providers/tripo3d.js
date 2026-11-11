'use strict';
const contract = require('../shared/tripo3dContract.json');
const { inspectGlb } = require('./providerOutputFormats');
const yauzl = require('yauzl');
const MODELS = contract.models.map(item => item.id);
const IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MODEL_FORMATS = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'usdz', '3mf', 'splat', 'zip']);
let shared;
const getContract = () => shared || (shared = import('../shared/tripo3dContract.mjs').then(m => m.createTripoContract(contract)));
const invalid = message => Object.assign(new Error(message), { status: 502, code: 'TRIPO_INVALID_RESULT' });
function parseFiles(record) {
  const content = record?.data?.content;
  if (!Array.isArray(content?.files) || !content.files.length) throw invalid('Tripo result is missing its typed files manifest');
  const files = content.files.map(item => {
    if (!item || typeof item.name !== 'string' || typeof item.type !== 'string' || typeof item.url !== 'string') throw invalid('Invalid Tripo file entry');
    const type = item.type.toLowerCase();
    let url; try { url = new URL(item.url); } catch { throw invalid('Invalid Tripo result URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !MODEL_FORMATS.has(type) && !IMAGE_FORMATS.has(type)) throw invalid('Invalid Tripo file format or URL');
    return { name: item.name, type, url: item.url };
  });
  const main = files.filter(item => item.name === 'modelUrl');
  if (main.length !== 1 || !MODEL_FORMATS.has(main[0].type)) throw invalid('Tripo must return exactly one primary modelUrl');
  if (content.file_url !== undefined && content.file_url !== main[0].url) throw invalid('Tripo file_url disagrees with modelUrl');
  if (content.file_urls !== undefined && JSON.stringify(content.file_urls) !== JSON.stringify(files.map(f => f.url))) throw invalid('Tripo file_urls disagrees with manifest order');
  if (content.tripo_task_id !== undefined && typeof content.tripo_task_id !== 'string') throw invalid('Invalid native Tripo task ID');
  return { files, modelUrl: main[0].url, modelUrls: [main[0].url], tripoTaskId: content.tripo_task_id || '' };
}
const crcTable = Array.from({ length: 256 }, (_, i) => { for (let j = 0; j < 8; j++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1; return i >>> 0; });
function validateArchive(buffer) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error) return reject(error);
    let count = 0, total = 0, settled = false;
    const finish = error => { if (settled) return; settled = true; zip.close(); error ? reject(error) : resolve(); };
    zip.on('error', finish); zip.on('end', () => finish(count ? null : invalid('Empty Tripo archive')));
    zip.on('entry', entry => {
      const name = entry.fileName.replace(/\\/g, '/');
      if (++count > 10000 || (total += entry.uncompressedSize) > 1024 ** 3 || entry.generalPurposeBitFlag & 1 || /^(?:\/|[a-z]:)/i.test(name) || name.split('/').includes('..')) return finish(invalid('Unsafe Tripo archive'));
      if (name.endsWith('/')) return zip.readEntry();
      zip.openReadStream(entry, (error, stream) => {
        if (error) return finish(error);
        let size = 0, crc = 0xffffffff;
        stream.on('error', finish);
        stream.on('data', chunk => {
          size += chunk.length;
          if (size > entry.uncompressedSize || size > 1024 ** 3) { stream.destroy(); return finish(invalid('Tripo archive entry exceeds limit')); }
          for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
        });
        stream.on('end', () => size === entry.uncompressedSize && ((crc ^ 0xffffffff) >>> 0) === entry.crc32 ? zip.readEntry() : finish(invalid('Corrupt Tripo archive entry')));
      });
    });
    zip.readEntry();
  }));
}
async function validateArtifact(buffer, declared) {
  if (!MODEL_FORMATS.has(declared) || !Buffer.isBuffer(buffer) || !buffer.length) throw invalid('Empty or unsupported Tripo model');
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    await validateArchive(buffer);
    return { format: ['usdz', '3mf'].includes(declared) ? declared : 'zip', partNames: [] };
  }
  const prefix = buffer.subarray(0, 256).toString('utf8'); let document;
  if (declared === 'glb') document = inspectGlb(buffer);
  else if (declared === 'gltf') { document = JSON.parse(buffer.toString('utf8')); if (document?.asset?.version !== '2.0') throw invalid('Invalid GLTF'); }
  else if (declared === 'fbx' && !prefix.startsWith('Kaydara FBX Binary') && !/FBX/.test(prefix)) throw invalid('Invalid FBX');
  else if (declared === 'obj' && !/^v\s+-?\d/m.test(buffer.toString('utf8'))) throw invalid('Invalid OBJ');
  else if (declared === 'stl' && !(buffer.length >= 84 && buffer.length === 84 + 50 * buffer.readUInt32LE(80)) && !/^\s*solid\s/i.test(prefix)) throw invalid('Invalid STL');
  else if (declared === 'splat' && buffer.length % 32 !== 0) throw invalid('Invalid Splat point stride');
  else if (['zip', 'usdz', '3mf'].includes(declared)) throw invalid('Expected Tripo archive');
  return { format: declared, partNames: [...new Set((document?.nodes || []).map(n => n?.name).filter(n => typeof n === 'string' && n))] };
}
async function materialize(result, download, taskId) {
  const files = []; let primary, partNames = [];
  for (const [index, item] of result.files.entries()) {
    const kind = IMAGE_FORMATS.has(item.type) ? 'image' : 'model3d';
    const saved = await download(item.url, kind, `seedance-nz-tripo:${taskId}:${index}`, { tripo: true, declaredFormat: item.type });
    if (!saved.url) {
      if (['renderedImageUrl', 'generatedImageUrl'].includes(item.name)) { files.push({ name: item.name, type: item.type, downloadError: true }); continue; }
      return null;
    }
    const file = { name: item.name, type: saved.actualFormat || item.type, url: saved.url };
    files.push(file);
    if (item.name === 'modelUrl') { primary = file; partNames = saved.partNames || []; }
  }
  return primary ? { modelUrl: primary.url, modelUrls: [primary.url], urls: [primary.url], files, tripoTaskId: result.tripoTaskId, partNames } : null;
}
module.exports = { contract, MODELS, MODEL_FORMATS, IMAGE_FORMATS, getContract, parseFiles, validateArtifact, materialize };
