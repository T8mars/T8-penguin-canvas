const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const sharp = require('sharp');
const { resolveBundledFfmpeg, resolveBundledFfprobe } = require('../providers/llmMedia');
const { DEFAULT_PROJECT_ID, stableEntityUuid } = require('../collaboration/protocol');
const { COMMON_OPERATION_BATCH_CONTRACT } = require('../collaboration/commonOperationProtocol');
const { AssetBlobStoreError, getAssetBlobStore } = require('./assetBlobStore');
const { reconcileAssetAvailabilitySnapshots } = require('./assetAvailability');
const { isUtf8 } = require('buffer');
const { safeRemoteMediaDownload } = require('../utils/safeRemoteMediaFetch');
const { withFfmpegProcessSlot } = require('../utils/ffmpegProcessQueue');
const {
  MIN_PROVIDER_MEDIA_TIMEOUT_MS,
  normalizeProviderMediaTimeoutMs,
} = require('../providers/providerTimeoutPolicy');

const MAX_IMAGE_INPUT_PIXELS = 100_000_000;
const PHASH_DCT64_ALGORITHM = 'phash-dct64-v1';
const DEFAULT_ASSET_PREVIEW_PIPELINE_VERSION = 'asset-preview-v2-phash';
const DEFAULT_HOST_ARTIFACT_REMOTE_MAX_BYTES = 256 * 1024 * 1024;
const MAX_HOST_ARTIFACT_REMOTE_MAX_BYTES = 512 * 1024 * 1024;
const MAX_HOST_ARTIFACT_INLINE_TEXT_BYTES = 1024 * 1024;
const DEFAULT_HOST_ARTIFACT_TOTAL_MAX_BYTES = 1024 * 1024 * 1024;
const MAX_HOST_ARTIFACT_TOTAL_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_HOST_ARTIFACT_DEADLINE_MS = MIN_PROVIDER_MEDIA_TIMEOUT_MS;
const MAX_HOST_ARTIFACT_DEADLINE_MS = 60 * 60_000;
const DEFAULT_HOST_ARTIFACT_CONCURRENCY = 2;
const MAX_HOST_ARTIFACT_CONCURRENCY = 4;
const DEFAULT_HOST_ARTIFACT_QUEUE_LIMIT = 16;
const MAX_HOST_ARTIFACT_QUEUE_LIMIT = 64;
const DEFAULT_HOST_ARTIFACT_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HOST_ARTIFACT_STAGING_FILE_PATTERN = /^host-artifact-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.part$/i;
const HOST_ARTIFACT_SOURCE_DESCRIPTOR_VERSION = 't8-host-artifact-source-v1';
const PHASH_SAMPLE_SIZE = 32;
const PHASH_LOW_FREQUENCY_SIZE = 8;
const PHASH_DCT_COSINES = Object.freeze(Array.from(
  { length: PHASH_LOW_FREQUENCY_SIZE },
  (_, frequency) => Object.freeze(Array.from(
    { length: PHASH_SAMPLE_SIZE },
    (_, position) => Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * PHASH_SAMPLE_SIZE)),
  )),
));
const PHASH_DCT_SCALES = Object.freeze(Array.from(
  { length: PHASH_LOW_FREQUENCY_SIZE },
  (_, frequency) => frequency === 0 ? Math.sqrt(1 / PHASH_SAMPLE_SIZE) : Math.sqrt(2 / PHASH_SAMPLE_SIZE),
));
const MODEL_METADATA_LIMITS = Object.freeze({
  // Keep the source gate aligned with modelPreviewRenderer. Text/JSON parsing is
  // deliberately stricter because JavaScript strings and parsed objects can use
  // several times the on-disk byte count.
  maxSourceBytes: 128 * 1024 * 1024,
  maxJsonBytes: 16 * 1024 * 1024,
  maxMtlBytes: 8 * 1024 * 1024,
  maxMtlTotalBytes: 32 * 1024 * 1024,
  maxLineBytes: 1_000_000,
  maxLines: 2_000_000,
  maxVertices: 500_000,
  maxTriangles: 1_000_000,
  maxFaceVertices: 4096,
  maxReferences: 4096,
  maxMaterialLibraries: 64,
  maxReferenceBytes: 4096,
  maxGltfEntries: 500_000,
  maxGlbChunks: 128,
});

class AssetModelMetadataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AssetModelMetadataError';
    this.code = code;
  }
}

function failModelMetadata(code, message) {
  throw new AssetModelMetadataError(code, message);
}

function normalizeModelMetadataLimits(overrides = {}) {
  const bounded = (name) => {
    const maximum = MODEL_METADATA_LIMITS[name];
    const requested = Math.trunc(Number(overrides?.[name]));
    return Number.isSafeInteger(requested) && requested > 0 ? Math.min(maximum, requested) : maximum;
  };
  const limits = Object.fromEntries(Object.keys(MODEL_METADATA_LIMITS).map((name) => [name, bounded(name)]));
  limits.maxJsonBytes = Math.min(limits.maxJsonBytes, limits.maxSourceBytes);
  limits.maxMtlBytes = Math.min(limits.maxMtlBytes, limits.maxSourceBytes);
  limits.maxMtlTotalBytes = Math.max(limits.maxMtlBytes, limits.maxMtlTotalBytes);
  return limits;
}

function statBoundedModelFile(filename, maximumBytes, label = '3D 模型') {
  let stat;
  try { stat = fs.statSync(path.resolve(filename)); } catch (_) { failModelMetadata('MODEL_SOURCE_UNREADABLE', `${label}不可读取`); }
  if (!stat.isFile()) failModelMetadata('MODEL_SOURCE_NOT_FILE', `${label}不是普通文件`);
  if (stat.size < 1) failModelMetadata('MODEL_SOURCE_EMPTY', `${label}为空`);
  if (stat.size > maximumBytes) failModelMetadata('MODEL_SOURCE_TOO_LARGE', `${label}超过 ${maximumBytes} bytes 安全上限`);
  return stat;
}

function readExactSync(fileDescriptor, length, position, label) {
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = fs.readSync(fileDescriptor, output, offset, length - offset, position + offset);
    if (!bytesRead) failModelMetadata('INVALID_MODEL_METADATA', `${label}数据被截断`);
    offset += bytesRead;
  }
  return output;
}

function scanUtf8LinesSync(filename, options, visitor) {
  const limits = normalizeModelMetadataLimits(options?.limits);
  const maximumBytes = Math.min(limits.maxSourceBytes, Number(options?.maximumBytes) || limits.maxSourceBytes);
  const label = String(options?.label || '3D 模型');
  statBoundedModelFile(filename, maximumBytes, label);
  const descriptor = fs.openSync(path.resolve(filename), 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = '';
  let lineNumber = 0;
  const emit = (line) => {
    lineNumber += 1;
    if (lineNumber > limits.maxLines) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `${label}行数超过 ${limits.maxLines}`);
    if (Buffer.byteLength(line, 'utf8') > limits.maxLineBytes) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `${label}第 ${lineNumber} 行过长`);
    visitor(line.replace(/\r$/, ''), lineNumber, limits);
  };
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      if (chunk.includes(0)) failModelMetadata('INVALID_MODEL_METADATA', `${label}包含无效二进制数据`);
      pending += decoder.write(chunk);
      let lineStart = 0;
      let newline;
      while ((newline = pending.indexOf('\n', lineStart)) !== -1) {
        emit(pending.slice(lineStart, newline));
        lineStart = newline + 1;
      }
      if (lineStart) pending = pending.slice(lineStart);
      if (Buffer.byteLength(pending, 'utf8') > limits.maxLineBytes) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `${label}行长度超过 ${limits.maxLineBytes}`);
    }
    pending += decoder.end();
    if (pending) emit(pending);
  } finally {
    fs.closeSync(descriptor);
  }
  return { lines: lineNumber, limits };
}

const EXTENSION_INFO = Object.freeze({
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], webp: ['image', 'image/webp'], gif: ['image', 'image/gif'], bmp: ['image', 'image/bmp'], avif: ['image', 'image/avif'], tif: ['image', 'image/tiff'], tiff: ['image', 'image/tiff'],
  mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'], mov: ['video', 'video/quicktime'], m4v: ['video', 'video/x-m4v'], mkv: ['video', 'video/x-matroska'], avi: ['video', 'video/x-msvideo'],
  mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], m4a: ['audio', 'audio/mp4'], flac: ['audio', 'audio/flac'], aac: ['audio', 'audio/aac'],
  glb: ['model3d', 'model/gltf-binary'], gltf: ['model3d', 'model/gltf+json'], obj: ['model3d', 'model/obj'], fbx: ['model3d', 'application/octet-stream'], stl: ['model3d', 'model/stl'], usdz: ['model3d', 'model/vnd.usdz+zip'],
  spz: ['model3d', 'application/octet-stream'], ply: ['model3d', 'application/octet-stream'], splat: ['model3d', 'application/octet-stream'], ksplat: ['model3d', 'application/octet-stream'],
  txt: ['text', 'text/plain'], md: ['text', 'text/markdown'], json: ['text', 'application/json'], csv: ['text', 'text/csv'], srt: ['text', 'application/x-subrip'], vtt: ['text', 'text/vtt'],
});

const MIME_EXTENSION = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'model/obj': 'obj',
  'model/stl': 'stl',
  'model/vnd.usdz+zip': 'usdz',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/json': 'json',
  'text/csv': 'csv',
});

const KIND_EXTENSION = Object.freeze({
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  model3d: 'glb',
  text: 'txt',
  other: 'bin',
});

function normalizedContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJsonDigest(value) {
  return sha256Value(Buffer.from(JSON.stringify(value), 'utf8'));
}

function sourceDescriptorDigest(sourceType, sourceIdentity) {
  return canonicalJsonDigest({
    contract: HOST_ARTIFACT_SOURCE_DESCRIPTOR_VERSION,
    sourceType,
    sourceIdentity,
  });
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function canonicalHostArtifactFilename(sourceType, originalFilename, detected, outputOrdinal) {
  const extension = detected.extension || KIND_EXTENSION[detected.kind] || 'bin';
  if (sourceType === 'inline-text' || sourceType === 'remote-provider') {
    return `run-output-${outputOrdinal}.${extension}`;
  }
  let stem = path.basename(String(originalFilename || ''), path.extname(String(originalFilename || '')))
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 190);
  if (!stem || stem === '.' || stem === '..') stem = `run-output-${outputOrdinal}`;
  return `${stem}.${extension}`.slice(0, 240);
}

function bufferStartsWith(buffer, signature, offset = 0) {
  return buffer.length >= offset + signature.length
    && buffer.subarray(offset, offset + signature.length).equals(signature);
}

function artifactType(kind, mimeType, extension, options = {}) {
  return { kind, mimeType, extension, ...options };
}

function detectHostArtifactType(filename, declaredContentType = '', sourceType = '') {
  const descriptor = fs.openSync(filename, 'r');
  let prefix;
  let stat;
  try {
    stat = fs.fstatSync(descriptor);
    const length = Math.min(Number(stat.size) || 0, 64 * 1024);
    prefix = Buffer.alloc(length);
    if (length > 0) fs.readSync(descriptor, prefix, 0, length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const declared = normalizedContentType(declaredContentType);
  const sourceExtension = path.extname(filename).slice(1).toLowerCase();
  const known = (() => {
    if (bufferStartsWith(prefix, Buffer.from('89504e470d0a1a0a', 'hex'))) return artifactType('image', 'image/png', 'png');
    if (bufferStartsWith(prefix, Buffer.from('ffd8ff', 'hex'))) return artifactType('image', 'image/jpeg', 'jpg');
    if (bufferStartsWith(prefix, Buffer.from('GIF87a')) || bufferStartsWith(prefix, Buffer.from('GIF89a'))) return artifactType('image', 'image/gif', 'gif');
    if (bufferStartsWith(prefix, Buffer.from('BM'))) return artifactType('image', 'image/bmp', 'bmp');
    if (bufferStartsWith(prefix, Buffer.from('49492a00', 'hex')) || bufferStartsWith(prefix, Buffer.from('4d4d002a', 'hex'))) return artifactType('image', 'image/tiff', 'tiff');
    if (bufferStartsWith(prefix, Buffer.from('RIFF')) && prefix.subarray(8, 12).toString('ascii') === 'WEBP') return artifactType('image', 'image/webp', 'webp');
    if (prefix.length >= 12 && prefix.subarray(4, 8).toString('ascii') === 'ftyp') {
      const brand = prefix.subarray(8, 12).toString('ascii').toLowerCase();
      if (brand === 'avif' || brand === 'avis') return artifactType('image', 'image/avif', 'avif');
      if (brand === 'qt  ') return artifactType('video', 'video/quicktime', 'mov');
      return artifactType('video', 'video/mp4', 'mp4');
    }
    if (bufferStartsWith(prefix, Buffer.from('1a45dfa3', 'hex'))) {
      return declared === 'video/x-matroska'
        ? artifactType('video', 'video/x-matroska', 'mkv')
        : artifactType('video', 'video/webm', 'webm');
    }
    if (bufferStartsWith(prefix, Buffer.from('RIFF')) && prefix.subarray(8, 12).toString('ascii') === 'AVI ') return artifactType('video', 'video/x-msvideo', 'avi');
    if (bufferStartsWith(prefix, Buffer.from('RIFF')) && prefix.subarray(8, 12).toString('ascii') === 'WAVE') return artifactType('audio', 'audio/wav', 'wav');
    if (bufferStartsWith(prefix, Buffer.from('OggS'))) return artifactType('audio', 'audio/ogg', 'ogg');
    if (bufferStartsWith(prefix, Buffer.from('fLaC'))) return artifactType('audio', 'audio/flac', 'flac');
    if (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1] === 0xf1 || prefix[1] === 0xf9)) return artifactType('audio', 'audio/aac', 'aac');
    if (bufferStartsWith(prefix, Buffer.from('ID3')) || (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0)) return artifactType('audio', 'audio/mpeg', 'mp3');
    if (bufferStartsWith(prefix, Buffer.from('glTF'))) return artifactType('model3d', 'model/gltf-binary', 'glb');
    if (bufferStartsWith(prefix, Buffer.from('Kaydara FBX Binary'))) return artifactType('model3d', 'application/octet-stream', 'fbx');
    if (bufferStartsWith(prefix, Buffer.from('PK\x03\x04')) && declared === 'model/vnd.usdz+zip') return artifactType('model3d', 'model/vnd.usdz+zip', 'usdz');
    return null;
  })();
  if (known) return { ...known, stat };

  const textual = prefix.length === 0 || (isUtf8(prefix) && !prefix.includes(0));
  const trimmed = textual ? prefix.toString('utf8').trimStart().toLowerCase() : '';
  if (sourceType === 'remote-provider' && (
    declared === 'text/html'
    || declared === 'application/xhtml+xml'
    || trimmed.startsWith('<!doctype html')
    || trimmed.startsWith('<html')
  )) {
    return { ...artifactType('other', 'application/octet-stream', 'bin', { forbidden: true }), stat };
  }
  if (textual) {
    const jsonLike = trimmed.startsWith('{') || trimmed.startsWith('[');
    if (jsonLike && Number(stat.size) <= MODEL_METADATA_LIMITS.maxJsonBytes) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (declared === 'model/gltf+json' && parsed && typeof parsed === 'object' && parsed.asset) {
          return { ...artifactType('model3d', 'model/gltf+json', 'gltf'), stat };
        }
        return { ...artifactType('text', 'application/json', 'json'), stat };
      } catch (_) {
        if (declared === 'application/json' || declared === 'model/gltf+json') {
          return { ...artifactType('other', 'application/octet-stream', 'bin', { forbidden: true }), stat };
        }
      }
    }
    if (declared === 'model/obj' || (sourceType === 'controlled-output' && sourceExtension === 'obj')) {
      return { ...artifactType('model3d', 'model/obj', 'obj'), stat };
    }
    if (declared === 'model/stl' || (sourceType === 'controlled-output' && sourceExtension === 'stl')) {
      return { ...artifactType('model3d', 'model/stl', 'stl'), stat };
    }
    if (declared === 'text/markdown') return { ...artifactType('text', 'text/markdown', 'md'), stat };
    if (declared === 'text/csv') return { ...artifactType('text', 'text/csv', 'csv'), stat };
    if (declared === 'text/vtt') return { ...artifactType('text', 'text/vtt', 'vtt'), stat };
    if (declared === 'application/x-subrip') return { ...artifactType('text', 'application/x-subrip', 'srt'), stat };
    return { ...artifactType('text', 'text/plain', 'txt'), stat };
  }

  const declaredKind = EXTENSION_INFO[MIME_EXTENSION[declared]]?.[0]
    || (declared.startsWith('image/') ? 'image' : null)
    || (declared.startsWith('video/') ? 'video' : null)
    || (declared.startsWith('audio/') ? 'audio' : null)
    || (declared.startsWith('model/') ? 'model3d' : null)
    || (declared.startsWith('text/') ? 'text' : null);
  if (sourceType === 'remote-provider' && ['image', 'video', 'audio', 'model3d', 'text'].includes(declaredKind)) {
    return { ...artifactType('other', 'application/octet-stream', 'bin', { forbidden: true }), stat };
  }
  return { ...artifactType('other', 'application/octet-stream', 'bin'), stat };
}

function extensionInfo(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const [kind = 'other', mimeType = 'application/octet-stream'] = EXTENSION_INFO[extension] || [];
  return { extension, kind, mimeType };
}

function stableAssetId(rootName, relativePath) {
  const digest = crypto.createHash('sha256').update(`${rootName}:${relativePath.replace(/\\/g, '/').toLowerCase()}`).digest('hex');
  return `asset_${digest.slice(0, 32)}`;
}

function stableSourceLocator(projectId, rootName, relativePath) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    String(projectId || 'project-local'),
    String(rootName || 'linked').toLowerCase(),
    normalizedPath,
  ])).digest('hex');
  return `asset_source_${digest}`;
}

function versionedAssetId(rootName, relativePath, contentHash) {
  const hash = String(contentHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('内容版本 assetId 需要完整 SHA-256');
  return stableAssetId(rootName, `${String(relativePath || '')}\0sha256:${hash}`);
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function nearestExistingPath(filename) {
  let current = path.resolve(filename);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/**
 * Resolve only URLs served by this application's controlled output root. The
 * realpath checks prevent an output symlink (or an existing symlink parent for
 * a not-yet-written file) from escaping OUTPUT_DIR.
 */
function resolveControlledOutputSource(sourceUrl, config = {}) {
  const raw = String(sourceUrl || '').trim();
  if (!raw || !config.OUTPUT_DIR) return null;
  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try { parsed = new URL(raw); } catch (_) { return null; }
    if (!isLoopbackHostname(parsed.hostname)) return null;
    pathname = parsed.pathname;
  } else {
    pathname = raw.split(/[?#]/, 1)[0];
  }
  const prefix = ['/files/output/', '/output/'].find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return null;
  const encodedSegments = pathname.slice(prefix.length).split('/');
  if (!encodedSegments.length || encodedSegments.some((segment) => !segment)) {
    return { controlled: true, safe: false };
  }
  let segments;
  try { segments = encodedSegments.map((segment) => decodeURIComponent(segment)); } catch (_) {
    return { controlled: true, safe: false };
  }
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/\0:]/.test(segment))) {
    return { controlled: true, safe: false };
  }
  const root = path.resolve(config.OUTPUT_DIR);
  const absolute = path.resolve(root, ...segments);
  if (!isPathInside(root, absolute)) return { controlled: true, safe: false };
  try {
    const realRoot = fs.realpathSync.native(root);
    const existingAnchor = nearestExistingPath(absolute);
    if (!existingAnchor) return { controlled: true, safe: false };
    const realAnchor = fs.realpathSync.native(existingAnchor);
    if (realAnchor !== realRoot && !isPathInside(realRoot, realAnchor)) return { controlled: true, safe: false };
    const exists = fs.existsSync(absolute);
    const isFile = exists && fs.statSync(absolute).isFile();
    if (exists && !isFile) return { controlled: true, safe: false };
    const anchoredAbsolute = path.resolve(realAnchor, path.relative(existingAnchor, absolute));
    if (!isPathInside(realRoot, anchoredAbsolute)) return { controlled: true, safe: false };
    return {
      controlled: true,
      safe: true,
      exists,
      absolute: anchoredAbsolute,
      relativePath: segments.join(path.sep),
      sourceUrl: `/files/output/${segments.map(encodeURIComponent).join('/')}`,
    };
  } catch (_) {
    return { controlled: true, safe: false };
  }
}

function hashFile(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function runFfprobe(filename) {
  return withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
    execFile(resolveBundledFfprobe(), [
      '-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', filename,
    ], { windowsHide: true, timeout: 45_000, maxBuffer: 3 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      try { resolve(JSON.parse(stdout || '{}')); } catch (parseError) { reject(parseError); }
    });
  }));
}

function runFfprobeKeyframes(filename) {
  return withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
    execFile(resolveBundledFfprobe(), [
      '-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_frames',
      '-show_entries', 'frame=key_frame,best_effort_timestamp_time,pkt_pts_time', '-of', 'json', filename,
    ], { windowsHide: true, timeout: 45_000, maxBuffer: 3 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      try {
        const parsed = JSON.parse(stdout || '{}');
        const timestamps = (Array.isArray(parsed.frames) ? parsed.frames : [])
          .filter((frame) => Number(frame?.key_frame) === 1)
          .map((frame) => Number(frame.best_effort_timestamp_time ?? frame.pkt_pts_time))
          .filter((value) => Number.isFinite(value) && value >= 0);
        resolve([...new Set(timestamps.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b));
      } catch (parseError) {
        reject(parseError);
      }
    });
  }));
}

function runFfmpeg(args, timeout = 90_000) {
  return withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
    execFile(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout, maxBuffer: 3 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      resolve(stdout);
    });
  }));
}

function publicThumbnailUrl(filename, config = {}) {
  const root = config.THUMBNAILS_DIR ? path.resolve(config.THUMBNAILS_DIR) : null;
  const absolute = path.resolve(filename);
  const relative = root && (absolute === root || absolute.startsWith(`${root}${path.sep}`))
    ? path.relative(root, absolute)
    : path.basename(absolute);
  return `/files/thumbnails/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function temporarySibling(target) {
  const parsed = path.parse(target);
  return path.join(parsed.dir, `${parsed.name}.part-${process.pid}-${crypto.randomBytes(5).toString('hex')}${parsed.ext}`);
}

async function writeAtomicTarget(target, writer) {
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = temporarySibling(target);
  try {
    await writer(temporary);
    if (!fs.existsSync(temporary)) throw new Error('预览生成器未写入临时文件');
    if (fs.existsSync(target)) fs.rmSync(temporary, { force: true });
    else fs.renameSync(temporary, target);
    return target;
  } finally {
    try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); } catch (_) {}
  }
}

function selectBoundedTimestamps(timestamps, maximum = 12) {
  const values = [...new Set((Array.isArray(timestamps) ? timestamps : []).filter((value) => Number.isFinite(value) && value >= 0))].sort((a, b) => a - b);
  if (values.length <= maximum) return values;
  return Array.from({ length: maximum }, (_, index) => values[Math.round((index * (values.length - 1)) / (maximum - 1))]);
}

const EXIF_IFD0_TAGS = Object.freeze({
  0x010E: 'imageDescription', 0x010F: 'make', 0x0110: 'model', 0x0112: 'orientation',
  0x011A: 'xResolution', 0x011B: 'yResolution', 0x0128: 'resolutionUnit', 0x0131: 'software',
  0x0132: 'dateTime', 0x013B: 'artist', 0x8298: 'copyright',
});
const EXIF_SUBIFD_TAGS = Object.freeze({
  0x829A: 'exposureTime', 0x829D: 'fNumber', 0x8822: 'exposureProgram', 0x8827: 'iso',
  0x9000: 'exifVersion', 0x9003: 'dateTimeOriginal', 0x9004: 'dateTimeDigitized',
  0x9204: 'exposureBias', 0x9207: 'meteringMode', 0x9209: 'flash', 0x920A: 'focalLength',
  0xA001: 'colorSpace', 0xA002: 'pixelWidth', 0xA003: 'pixelHeight', 0xA402: 'exposureMode',
  0xA403: 'whiteBalance', 0xA405: 'focalLength35mm', 0xA432: 'lensSpecification',
  0xA433: 'lensMake', 0xA434: 'lensModel',
});

function parseExifBuffer(raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 8) return {};
  const tiffStart = raw.subarray(0, 6).toString('ascii') === 'Exif\0\0' ? 6 : 0;
  if (raw.length < tiffStart + 8) return {};
  const byteOrder = raw.toString('ascii', tiffStart, tiffStart + 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return {};
  const uint16 = (offset) => {
    if (offset < 0 || offset + 2 > raw.length) throw new Error('EXIF SHORT 越界');
    return littleEndian ? raw.readUInt16LE(offset) : raw.readUInt16BE(offset);
  };
  const uint32 = (offset) => {
    if (offset < 0 || offset + 4 > raw.length) throw new Error('EXIF LONG 越界');
    return littleEndian ? raw.readUInt32LE(offset) : raw.readUInt32BE(offset);
  };
  const int32 = (offset) => {
    if (offset < 0 || offset + 4 > raw.length) throw new Error('EXIF SLONG 越界');
    return littleEndian ? raw.readInt32LE(offset) : raw.readInt32BE(offset);
  };
  if (uint16(tiffStart + 2) !== 42) return {};
  const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const readValue = (entryOffset, type, count) => {
    const size = typeSize[type] || 0;
    if (!size || count < 1 || count > 1024 || size * count > 8192) return undefined;
    const byteLength = size * count;
    const valueOffset = byteLength <= 4 ? entryOffset + 8 : tiffStart + uint32(entryOffset + 8);
    if (valueOffset < 0 || valueOffset + byteLength > raw.length) return undefined;
    if (type === 2) return raw.toString('utf8', valueOffset, valueOffset + byteLength).replace(/\0+$/g, '').trim().slice(0, 500);
    if (type === 7) return raw.subarray(valueOffset, valueOffset + byteLength).toString('ascii').replace(/\0+$/g, '').trim().slice(0, 100);
    const values = [];
    for (let index = 0; index < Math.min(count, 16); index += 1) {
      const offset = valueOffset + index * size;
      if (type === 1) values.push(raw[offset]);
      else if (type === 3) values.push(uint16(offset));
      else if (type === 4) values.push(uint32(offset));
      else if (type === 9) values.push(int32(offset));
      else if (type === 5 || type === 10) {
        const numerator = type === 5 ? uint32(offset) : int32(offset);
        const denominator = type === 5 ? uint32(offset + 4) : int32(offset + 4);
        values.push(denominator ? numerator / denominator : null);
      }
    }
    return count === 1 ? values[0] : values;
  };
  const readIfd = (relativeOffset, tags) => {
    const output = {};
    const absolute = tiffStart + Number(relativeOffset || 0);
    if (absolute < tiffStart || absolute + 2 > raw.length) return output;
    const entries = Math.min(256, uint16(absolute));
    for (let index = 0; index < entries; index += 1) {
      const entryOffset = absolute + 2 + index * 12;
      if (entryOffset + 12 > raw.length) break;
      const tag = uint16(entryOffset);
      const name = tags[tag];
      if (!name) continue;
      const value = readValue(entryOffset, uint16(entryOffset + 2), uint32(entryOffset + 4));
      if (value !== undefined && value !== '') output[name] = value;
    }
    return output;
  };
  try {
    const ifd0Offset = uint32(tiffStart + 4);
    const ifd0 = readIfd(ifd0Offset, EXIF_IFD0_TAGS);
    const ifd0Absolute = tiffStart + ifd0Offset;
    const entries = Math.min(256, uint16(ifd0Absolute));
    let exifOffset = 0;
    for (let index = 0; index < entries; index += 1) {
      const entryOffset = ifd0Absolute + 2 + index * 12;
      if (entryOffset + 12 > raw.length) break;
      if (uint16(entryOffset) === 0x8769) { exifOffset = uint32(entryOffset + 8); break; }
    }
    const exif = exifOffset ? readIfd(exifOffset, EXIF_SUBIFD_TAGS) : {};
    return { ...ifd0, ...exif };
  } catch (_) {
    return {};
  }
}

function safeProbeTags(tags) {
  if (!tags || typeof tags !== 'object') return {};
  const allowed = new Set(['title', 'artist', 'album', 'album_artist', 'date', 'genre', 'comment', 'language', 'encoder', 'creation_time']);
  return Object.fromEntries(Object.entries(tags).filter(([key, value]) => allowed.has(String(key).toLowerCase()) && typeof value === 'string').slice(0, 30).map(([key, value]) => [key, value.slice(0, 500)]));
}

async function differenceHash(filename) {
  const input = fs.createReadStream(filename);
  const transformer = sharp({
    animated: false,
    failOn: 'error',
    limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
  }).resize(9, 8, { fit: 'fill' }).greyscale().raw();
  input.once('error', (error) => transformer.destroy(error));
  input.pipe(transformer);
  let result;
  try {
    result = await transformer.toBuffer({ resolveWithObject: true });
  } finally {
    input.destroy();
    transformer.destroy();
  }
  const { data, info } = result;
  if (info.width !== 9 || info.height !== 8) return '';
  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

async function readOrientedGrayscale32(filename) {
  const input = fs.createReadStream(filename);
  const transformer = sharp({
    animated: false,
    failOn: 'error',
    limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
  })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(PHASH_SAMPLE_SIZE, PHASH_SAMPLE_SIZE, { fit: 'fill' })
    .greyscale()
    .raw();
  input.once('error', (error) => transformer.destroy(error));
  input.pipe(transformer);
  let result;
  try {
    result = await transformer.toBuffer({ resolveWithObject: true });
  } finally {
    input.destroy();
    transformer.destroy();
  }
  const { data, info } = result;
  if (info.width !== PHASH_SAMPLE_SIZE || info.height !== PHASH_SAMPLE_SIZE || info.channels !== 1 || data.length !== PHASH_SAMPLE_SIZE ** 2) {
    throw new Error('DCT pHash 灰度采样尺寸无效');
  }
  return data;
}

function dct64FromGrayscale32(grayscale) {
  if (!grayscale || grayscale.length !== PHASH_SAMPLE_SIZE ** 2) {
    throw new TypeError('DCT pHash 需要 32x32 灰度采样');
  }
  // Separable, orthonormal 2-D DCT-II. Only the upper-left 8x8
  // coefficients are materialized because the remaining frequencies do not
  // contribute to the 64-bit fingerprint.
  const horizontal = new Float64Array(PHASH_SAMPLE_SIZE * PHASH_LOW_FREQUENCY_SIZE);
  for (let y = 0; y < PHASH_SAMPLE_SIZE; y += 1) {
    for (let u = 0; u < PHASH_LOW_FREQUENCY_SIZE; u += 1) {
      let sum = 0;
      for (let x = 0; x < PHASH_SAMPLE_SIZE; x += 1) {
        sum += Number(grayscale[y * PHASH_SAMPLE_SIZE + x]) * PHASH_DCT_COSINES[u][x];
      }
      horizontal[y * PHASH_LOW_FREQUENCY_SIZE + u] = sum * PHASH_DCT_SCALES[u];
    }
  }
  const coefficients = new Float64Array(PHASH_LOW_FREQUENCY_SIZE ** 2);
  for (let v = 0; v < PHASH_LOW_FREQUENCY_SIZE; v += 1) {
    for (let u = 0; u < PHASH_LOW_FREQUENCY_SIZE; u += 1) {
      let sum = 0;
      for (let y = 0; y < PHASH_SAMPLE_SIZE; y += 1) {
        sum += horizontal[y * PHASH_LOW_FREQUENCY_SIZE + u] * PHASH_DCT_COSINES[v][y];
      }
      coefficients[v * PHASH_LOW_FREQUENCY_SIZE + u] = sum * PHASH_DCT_SCALES[v];
    }
  }
  // The DC coefficient participates as bit 0 so the result is exactly 64
  // bits, but it is excluded from the median to prevent global brightness
  // from setting the threshold for every low-frequency AC coefficient.
  const ac = Array.from(coefficients.subarray(1)).sort((left, right) => left - right);
  const median = ac[Math.floor(ac.length / 2)];
  let fingerprint = 0n;
  for (const coefficient of coefficients) {
    fingerprint = (fingerprint << 1n) | (coefficient > median ? 1n : 0n);
  }
  return fingerprint.toString(16).padStart(16, '0');
}

async function dctPerceptualHash(filename) {
  return dct64FromGrayscale32(await readOrientedGrayscale32(filename));
}

function safeExternalReference(root, reference) {
  const cleaned = String(reference || '').replace(/\\/g, '/');
  if (!cleaned) return { reference: cleaned, external: false, exists: true };
  if (/^data:/i.test(cleaned)) return { reference: 'data:embedded', external: false, exists: true, embedded: true };
  if (/^https?:/i.test(cleaned)) return { reference: cleaned, external: true, exists: false, unsafe: true, remote: true };
  const absolute = path.resolve(root, cleaned);
  const inside = absolute === root || absolute.startsWith(`${root}${path.sep}`);
  return { reference: cleaned, external: true, exists: inside && fs.existsSync(absolute), unsafe: !inside };
}

function boundedModelReference(value, limits, label) {
  if (typeof value !== 'string' || !value) return null;
  if (/^data:/i.test(value)) return value;
  if (Buffer.byteLength(value, 'utf8') > limits.maxReferenceBytes) {
    failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `${label}长度超过 ${limits.maxReferenceBytes} bytes`);
  }
  return value;
}

function validateGltfCollections(document, limits) {
  const collectionNames = ['accessors', 'animations', 'buffers', 'bufferViews', 'images', 'materials', 'meshes', 'nodes', 'samplers', 'scenes', 'skins', 'textures'];
  let totalEntries = 0;
  for (const name of collectionNames) {
    const collection = document[name];
    if (collection == null) continue;
    if (!Array.isArray(collection)) failModelMetadata('INVALID_MODEL_METADATA', `glTF ${name} 必须是数组`);
    totalEntries += collection.length;
    if (totalEntries > limits.maxGltfEntries) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `glTF 结构条目超过 ${limits.maxGltfEntries}`);
  }
}

function parseGlbJsonDocument(filename, limits) {
  const stat = statBoundedModelFile(filename, limits.maxSourceBytes, 'GLB 文件');
  const descriptor = fs.openSync(path.resolve(filename), 'r');
  try {
    if (stat.size < 20) failModelMetadata('INVALID_MODEL_METADATA', '无效 GLB 文件头');
    const header = readExactSync(descriptor, 12, 0, 'GLB 文件头');
    if (header.readUInt32LE(0) !== 0x46546C67) failModelMetadata('INVALID_MODEL_METADATA', '无效 GLB 文件头');
    if (header.readUInt32LE(4) !== 2) failModelMetadata('INVALID_MODEL_METADATA', '仅支持 GLB 2.0');
    if (header.readUInt32LE(8) !== stat.size) failModelMetadata('INVALID_MODEL_METADATA', 'GLB 声明长度与文件不一致');
    let document;
    let offset = 12;
    let chunks = 0;
    while (offset < stat.size) {
      chunks += 1;
      if (chunks > limits.maxGlbChunks) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `GLB chunk 数超过 ${limits.maxGlbChunks}`);
      if (offset + 8 > stat.size) failModelMetadata('INVALID_MODEL_METADATA', 'GLB chunk header 被截断');
      const chunkHeader = readExactSync(descriptor, 8, offset, 'GLB chunk header');
      const chunkLength = chunkHeader.readUInt32LE(0);
      const chunkType = chunkHeader.readUInt32LE(4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkLength;
      if (!Number.isSafeInteger(chunkEnd) || chunkEnd > stat.size) failModelMetadata('INVALID_MODEL_METADATA', 'GLB chunk 数据越界');
      if (chunkType === 0x4E4F534A && !document) {
        if (chunkLength > limits.maxJsonBytes) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `GLB JSON 超过 ${limits.maxJsonBytes} bytes`);
        const json = readExactSync(descriptor, chunkLength, chunkStart, 'GLB JSON');
        try {
          document = JSON.parse(json.toString('utf8').replace(/[\0\s]+$/g, ''));
        } catch (_) {
          failModelMetadata('INVALID_MODEL_METADATA', 'GLB JSON 无法解析');
        }
      }
      offset = chunkEnd;
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) failModelMetadata('INVALID_MODEL_METADATA', '缺少 glTF JSON 数据');
    return document;
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseGltfDocument(filename, options = {}) {
  const limits = normalizeModelMetadataLimits(options);
  const extension = path.extname(filename).toLowerCase();
  let document;
  if (extension === '.gltf') {
    const stat = statBoundedModelFile(filename, Math.min(limits.maxSourceBytes, limits.maxJsonBytes), 'glTF JSON');
    const descriptor = fs.openSync(path.resolve(filename), 'r');
    try {
      const raw = readExactSync(descriptor, stat.size, 0, 'glTF JSON');
      if (raw.includes(0)) failModelMetadata('INVALID_MODEL_METADATA', 'glTF JSON 包含无效二进制数据');
      try { document = JSON.parse(raw.toString('utf8')); } catch (_) { failModelMetadata('INVALID_MODEL_METADATA', 'glTF JSON 无法解析'); }
    } finally {
      fs.closeSync(descriptor);
    }
  } else if (extension === '.glb') document = parseGlbJsonDocument(filename, limits);
  else failModelMetadata('INVALID_MODEL_METADATA', '仅支持 glTF 或 GLB 元数据解析');
  if (!document || typeof document !== 'object' || Array.isArray(document)) failModelMetadata('INVALID_MODEL_METADATA', '缺少 glTF JSON 数据');
  validateGltfCollections(document, limits);
  const root = path.dirname(path.resolve(filename));
  const references = [];
  const appendReferences = (collection, kind) => {
    for (let index = 0; index < collection.length; index += 1) {
      const uri = boundedModelReference(collection[index]?.uri, limits, `glTF ${kind} 引用`);
      if (!uri) continue;
      if (references.length >= limits.maxReferences) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `glTF 外部引用超过 ${limits.maxReferences}`);
      references.push({ ...safeExternalReference(root, uri), kind, index });
    }
  };
  appendReferences(document.buffers || [], 'buffer');
  appendReferences(document.images || [], 'texture');
  let bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const accessor of document.accessors || []) {
    if (accessor?.type !== 'VEC3' || !Array.isArray(accessor.min) || !Array.isArray(accessor.max) || accessor.min.length < 3 || accessor.max.length < 3) continue;
    const minimum = accessor.min.slice(0, 3).map(Number);
    const maximum = accessor.max.slice(0, 3).map(Number);
    if (![...minimum, ...maximum].every(Number.isFinite)) continue;
    bounds = {
      min: bounds.min.map((entry, index) => Math.min(entry, minimum[index])),
      max: bounds.max.map((entry, index) => Math.max(entry, maximum[index])),
    };
  }
  let primitives = 0;
  let vertices = 0;
  let triangles = 0;
  for (const mesh of document.meshes || []) {
    if (mesh?.primitives != null && !Array.isArray(mesh.primitives)) failModelMetadata('INVALID_MODEL_METADATA', 'glTF mesh primitives 必须是数组');
    primitives += mesh?.primitives?.length || 0;
    if (primitives > limits.maxTriangles) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `glTF primitive 数超过 ${limits.maxTriangles}`);
    for (const primitive of mesh?.primitives || []) {
      if (primitive?.mode != null && primitive.mode !== 4) continue;
      const positionIndex = primitive?.attributes?.POSITION;
      if (positionIndex == null) continue;
      if (!Number.isSafeInteger(positionIndex) || !document.accessors?.[positionIndex]) failModelMetadata('INVALID_MODEL_METADATA', 'glTF POSITION accessor 无效');
      const positionAccessor = document.accessors[positionIndex];
      const positionCount = Number(positionAccessor.count);
      if (positionAccessor.type !== 'VEC3' || !Number.isSafeInteger(positionCount) || positionCount < 1 || positionCount > limits.maxVertices) {
        failModelMetadata('MODEL_TOO_COMPLEX', `glTF POSITION 顶点数量无效或超过 ${limits.maxVertices}`);
      }
      vertices += positionCount;
      if (vertices > limits.maxVertices) failModelMetadata('MODEL_TOO_COMPLEX', `glTF 顶点总数超过 ${limits.maxVertices}`);
      let indexCount = positionCount;
      if (primitive.indices != null) {
        if (!Number.isSafeInteger(primitive.indices) || !document.accessors?.[primitive.indices]) failModelMetadata('INVALID_MODEL_METADATA', 'glTF 索引 accessor 无效');
        indexCount = Number(document.accessors[primitive.indices].count);
      }
      if (!Number.isSafeInteger(indexCount) || indexCount < 3 || indexCount % 3 !== 0 || indexCount > limits.maxTriangles * 3) {
        failModelMetadata('MODEL_TOO_COMPLEX', 'glTF 三角面索引数量无效或超限');
      }
      triangles += indexCount / 3;
      if (triangles > limits.maxTriangles) failModelMetadata('MODEL_TOO_COMPLEX', `glTF 三角面超过 ${limits.maxTriangles}`);
    }
  }
  return {
    format: extension.slice(1), version: document.asset?.version, generator: document.asset?.generator,
    scenes: document.scenes?.length || 0, nodes: document.nodes?.length || 0, meshes: document.meshes?.length || 0,
    primitives, vertices, triangles, materials: document.materials?.length || 0,
    textures: document.textures?.length || 0, animations: document.animations?.length || 0, skins: document.skins?.length || 0,
    bounds: Number.isFinite(bounds.min[0]) ? bounds : null,
    references,
    textureReferences: references.filter((item) => item.kind === 'texture'),
    missingReferences: references.filter((item) => item.external && !item.exists).map((item) => item.reference),
  };
}

function parseObjMetadata(filename, options = {}) {
  const limits = normalizeModelMetadataLimits(options);
  const root = path.dirname(path.resolve(filename));
  let vertices = 0;
  let faces = 0;
  let triangles = 0;
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const references = [];
  const textureReferences = [];
  scanUtf8LinesSync(filename, { limits, label: 'OBJ 文件' }, (rawLine) => {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      if (parts.length < 4) failModelMetadata('INVALID_MODEL_METADATA', 'OBJ 顶点数据不完整');
      const vertex = parts.slice(1, 4).map(Number);
      if (!vertex.every(Number.isFinite)) failModelMetadata('INVALID_MODEL_METADATA', 'OBJ 顶点包含非有限数值');
      vertices += 1;
      if (vertices > limits.maxVertices) failModelMetadata('MODEL_TOO_COMPLEX', `OBJ 顶点超过 ${limits.maxVertices}`);
      bounds.min = bounds.min.map((entry, index) => Math.min(entry, vertex[index]));
      bounds.max = bounds.max.map((entry, index) => Math.max(entry, vertex[index]));
    } else if (parts[0] === 'f') {
      const faceVertices = parts.length - 1;
      if (faceVertices < 3) failModelMetadata('INVALID_MODEL_METADATA', 'OBJ 面数据不完整');
      if (faceVertices > limits.maxFaceVertices) failModelMetadata('MODEL_TOO_COMPLEX', `OBJ 单面顶点超过 ${limits.maxFaceVertices}`);
      faces += 1;
      triangles += faceVertices - 2;
      if (triangles > limits.maxTriangles) failModelMetadata('MODEL_TOO_COMPLEX', `OBJ 三角面超过 ${limits.maxTriangles}`);
    } else if (parts[0] === 'mtllib' && parts[1]) {
      if (references.length >= limits.maxMaterialLibraries) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `OBJ 材质库超过 ${limits.maxMaterialLibraries}`);
      const reference = boundedModelReference(parts.slice(1).join(' '), limits, 'OBJ 材质库引用');
      references.push({ ...safeExternalReference(root, reference), kind: 'material-library' });
    }
  });
  let totalMaterialBytes = 0;
  const visitedMaterials = new Set();
  for (const material of [...references]) {
    if (!material.exists || material.unsafe) continue;
    const materialPath = path.resolve(root, material.reference);
    const materialKey = materialPath.toLowerCase();
    if (visitedMaterials.has(materialKey)) continue;
    visitedMaterials.add(materialKey);
    let materialStat;
    try { materialStat = fs.statSync(materialPath); } catch (_) { continue; }
    if (!materialStat.isFile()) continue;
    if (materialStat.size > limits.maxMtlBytes) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `MTL 文件超过 ${limits.maxMtlBytes} bytes`);
    totalMaterialBytes += materialStat.size;
    if (totalMaterialBytes > limits.maxMtlTotalBytes) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `MTL 总大小超过 ${limits.maxMtlTotalBytes} bytes`);
    const materialRoot = path.dirname(materialPath);
    scanUtf8LinesSync(materialPath, { limits, maximumBytes: limits.maxMtlBytes, label: 'MTL 文件' }, (rawLine) => {
      const parts = rawLine.replace(/#.*$/, '').trim().split(/\s+/);
      if (!/^(?:map_(?:Ka|Kd|Ks|Ke|Ns|d|bump)|bump|disp|decal|norm)$/i.test(parts[0] || '') || parts.length < 2) return;
      if (references.length + textureReferences.length >= limits.maxReferences) failModelMetadata('MODEL_METADATA_TOO_COMPLEX', `OBJ/MTL 引用超过 ${limits.maxReferences}`);
      const reference = boundedModelReference(parts.at(-1), limits, 'MTL 贴图引用');
      textureReferences.push({ ...safeExternalReference(materialRoot, reference), kind: 'texture', mapType: parts[0] });
    });
  }
  references.push(...textureReferences);
  return { format: 'obj', vertices, faces, triangles, bounds: vertices ? bounds : null, references, textureReferences, missingReferences: references.filter((item) => !item.exists).map((item) => item.reference) };
}

async function createDerivedMedia(filename, kind, metadata, config, contentHash) {
  if (!config.THUMBNAILS_DIR || !['image', 'video', 'audio', 'model3d'].includes(kind)) return {};
  const previewRoot = config.ASSET_PREVIEWS_DIR || config.THUMBNAILS_DIR;
  fs.mkdirSync(previewRoot, { recursive: true });
  const pipelineVersion = String(config.ASSET_PREVIEW_PIPELINE_VERSION || DEFAULT_ASSET_PREVIEW_PIPELINE_VERSION)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || DEFAULT_ASSET_PREVIEW_PIPELINE_VERSION;
  // Include the pipeline version in every cache path so a pipeline upgrade cannot
  // accidentally reuse an older or partially compatible derived artifact.
  const prefix = `asset-${contentHash.slice(0, 24)}-${pipelineVersion}`;
  if (kind === 'image') {
    const target = path.join(previewRoot, `${prefix}-thumb.webp`);
    await writeAtomicTarget(target, async (temporary) => {
      await sharp(filename, { animated: false, failOn: 'error', limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
        .rotate()
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(temporary);
    });
    const perceptualHash = await dctPerceptualHash(filename);
    return {
      previewStatus: 'ready',
      thumbnailUrl: publicThumbnailUrl(target, config),
      perceptualHash,
      perceptualHashAlgorithm: PHASH_DCT64_ALGORITHM,
      perceptualHashes: [{
        role: 'primary',
        index: 0,
        hash: perceptualHash,
        algorithm: PHASH_DCT64_ALGORITHM,
      }],
    };
  }
  if (kind === 'video') {
    const duration = Math.max(0, Number(metadata.duration) || 0);
    const keyframeTimes = selectBoundedTimestamps(await runFfprobeKeyframes(filename), 12);
    if (!keyframeTimes.length) throw new Error('视频未找到可验证的 codec 关键帧');
    const first = path.join(previewRoot, `${prefix}-first.webp`);
    const last = path.join(previewRoot, `${prefix}-last.webp`);
    const contact = path.join(previewRoot, `${prefix}-contact.webp`);
    const proxy = path.join(previewRoot, `${prefix}-proxy.mp4`);
    await writeAtomicTarget(first, (temporary) => runFfmpeg(['-ss', '0', '-i', filename, '-frames:v', '1', '-vf', 'scale=480:-2', '-c:v', 'libwebp', '-quality', '75', temporary]));
    await writeAtomicTarget(last, (temporary) => runFfmpeg(['-ss', String(Math.max(0, duration - 0.08)), '-i', filename, '-frames:v', '1', '-vf', 'scale=480:-2', '-c:v', 'libwebp', '-quality', '75', temporary]));
    await writeAtomicTarget(contact, async (temporary) => {
      const interval = Math.max(0.1, duration / 6 || 1);
      await runFfmpeg(['-i', filename, '-vf', `fps=1/${interval},scale=240:-2,tile=3x2`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '75', temporary]);
    });
    await writeAtomicTarget(proxy, (temporary) => runFfmpeg([
      '-i', filename,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale=w='trunc(min(1280,iw)/2)*2':h=-2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', temporary,
    ], 10 * 60_000));
    const keyframes = [];
    const perceptualHashes = [];
    for (let index = 0; index < keyframeTimes.length; index += 1) {
      const target = path.join(previewRoot, `${prefix}-keyframe-${String(index + 1).padStart(2, '0')}.webp`);
      await writeAtomicTarget(target, (temporary) => runFfmpeg([
        '-ss', String(keyframeTimes[index]), '-i', filename, '-frames:v', '1', '-vf', 'scale=480:-2',
        '-c:v', 'libwebp', '-quality', '75', temporary,
      ]));
      keyframes.push(publicThumbnailUrl(target, config));
      perceptualHashes.push({
        role: 'codec-keyframe',
        index,
        time: keyframeTimes[index],
        hash: await dctPerceptualHash(target),
        algorithm: PHASH_DCT64_ALGORITHM,
      });
    }
    return {
      previewStatus: 'ready',
      thumbnailUrl: publicThumbnailUrl(first, config),
      firstFrameUrl: publicThumbnailUrl(first, config),
      lastFrameUrl: publicThumbnailUrl(last, config),
      keyframeUrls: keyframes,
      keyframeTimes,
      contactSheetUrl: publicThumbnailUrl(contact, config),
      proxyUrl: publicThumbnailUrl(proxy, config),
      perceptualHash: perceptualHashes[0].hash,
      perceptualHashAlgorithm: PHASH_DCT64_ALGORITHM,
      perceptualHashes,
    };
  }
  if (kind === 'audio') {
    const waveform = path.join(previewRoot, `${prefix}-waveform.png`);
    await writeAtomicTarget(waveform, (temporary) => runFfmpeg(['-i', filename, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=960x180:colors=36cfc9', '-frames:v', '1', temporary]));
    return { previewStatus: 'ready', waveformUrl: publicThumbnailUrl(waveform, config) };
  }
  const target = path.join(previewRoot, `${prefix}-model.webp`);
  await writeAtomicTarget(target, async (temporary) => {
    const { renderModelPreview } = require('./modelPreviewRenderer');
    if (typeof renderModelPreview !== 'function') throw new Error('3D 预览渲染器不可用');
    await renderModelPreview({ sourcePath: filename, targetPath: temporary, width: 480, height: 480 });
  });
  const modelPreviewUrl = publicThumbnailUrl(target, config);
  return { previewStatus: 'ready', thumbnailUrl: modelPreviewUrl, modelPreviewUrl };
}

function parseRatio(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return Number(value) || 0;
  return Number(match[2]) ? Number(match[1]) / Number(match[2]) : 0;
}

async function readMetadata(filename, kind, stat, options = {}) {
  const base = { size: stat.size, modifiedAt: stat.mtimeMs };
  if (kind === 'image') {
    const info = await sharp(filename, {
      animated: true,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    }).metadata();
    const exif = parseExifBuffer(info.exif);
    return {
      ...base,
      width: info.width,
      height: info.height,
      format: info.format,
      space: info.space,
      channels: info.channels,
      depth: info.depth,
      density: info.density,
      orientation: info.orientation,
      chromaSubsampling: info.chromaSubsampling,
      isProgressive: info.isProgressive,
      pages: info.pages || 1,
      hasAlpha: info.hasAlpha,
      hasIccProfile: Boolean(info.icc),
      hasExif: Boolean(info.exif),
      colorProfile: {
        space: info.space || null,
        depth: info.depth || null,
        channels: Number(info.channels) || null,
        chromaSubsampling: info.chromaSubsampling || null,
        iccBytes: Buffer.isBuffer(info.icc) ? info.icc.length : 0,
      },
      exif,
    };
  }
  if (kind === 'video' || kind === 'audio') {
    const probe = await runFfprobe(filename);
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    return {
      ...base,
      duration: Number(probe.format?.duration || video?.duration || audio?.duration) || 0,
      bitrate: Number(probe.format?.bit_rate) || 0,
      formatName: probe.format?.format_name,
      formatLongName: probe.format?.format_long_name,
      startTime: Number(probe.format?.start_time) || 0,
      streamCount: streams.length,
      videoStreamCount: streams.filter((stream) => stream.codec_type === 'video').length,
      audioStreamCount: streams.filter((stream) => stream.codec_type === 'audio').length,
      tags: safeProbeTags(probe.format?.tags),
      width: Number(video?.width) || undefined,
      height: Number(video?.height) || undefined,
      frameRate: video ? parseRatio(video.avg_frame_rate || video.r_frame_rate) : undefined,
      frameCount: Number(video?.nb_read_frames || video?.nb_frames) || undefined,
      rotation: Number(video?.tags?.rotate || video?.side_data_list?.find((item) => Number.isFinite(Number(item.rotation)))?.rotation) || 0,
      videoCodec: video?.codec_name,
      videoCodecLongName: video?.codec_long_name,
      videoProfile: video?.profile,
      videoLevel: Number(video?.level) || undefined,
      videoBitrate: Number(video?.bit_rate) || undefined,
      videoTimeBase: video?.time_base,
      videoStartTime: Number(video?.start_time) || undefined,
      videoDuration: Number(video?.duration) || undefined,
      pixelFormat: video?.pix_fmt,
      bitsPerRawSample: Number(video?.bits_per_raw_sample) || undefined,
      sampleAspectRatio: video?.sample_aspect_ratio,
      displayAspectRatio: video?.display_aspect_ratio,
      fieldOrder: video?.field_order,
      colorRange: video?.color_range,
      colorPrimaries: video?.color_primaries,
      colorSpace: video?.color_space,
      colorTransfer: video?.color_transfer,
      audioCodec: audio?.codec_name,
      audioCodecLongName: audio?.codec_long_name,
      audioProfile: audio?.profile,
      audioBitrate: Number(audio?.bit_rate) || undefined,
      audioTimeBase: audio?.time_base,
      audioStartTime: Number(audio?.start_time) || undefined,
      audioDuration: Number(audio?.duration) || undefined,
      sampleRate: Number(audio?.sample_rate) || undefined,
      channels: Number(audio?.channels) || undefined,
      channelLayout: audio?.channel_layout,
      sampleFormat: audio?.sample_fmt,
      bitsPerSample: Number(audio?.bits_per_sample) || undefined,
      audioBitsPerRawSample: Number(audio?.bits_per_raw_sample) || undefined,
      audioTags: safeProbeTags(audio?.tags),
    };
  }
  if (kind === 'model3d') {
    const extension = String(options.sourceExtension || path.extname(filename)).toLowerCase();
    const limits = normalizeModelMetadataLimits(options.modelMetadataLimits || options);
    statBoundedModelFile(filename, limits.maxSourceBytes, '3D 模型');
    if (extension === '.gltf' || extension === '.glb') return { ...base, ...parseGltfDocument(filename, limits) };
    if (extension === '.obj') return { ...base, ...parseObjMetadata(filename, limits) };
    return { ...base, format: extension.slice(1), previewStatus: 'unsupported', health: 'unverified' };
  }
  if (kind === 'text' && stat.size <= 512 * 1024) {
    const preview = fs.readFileSync(filename, 'utf8').replace(/\s+/g, ' ').trim().slice(0, 1000);
    return { ...base, preview };
  }
  return base;
}

function sourceStatIdentity(stat) {
  return {
    dev: Number(stat?.dev) || 0,
    ino: Number(stat?.ino) || 0,
    mode: Number(stat?.mode) || 0,
    size: Number(stat?.size) || 0,
    mtimeMs: Number(stat?.mtimeMs) || 0,
    ctimeMs: Number(stat?.ctimeMs) || 0,
  };
}

function sameSourceStat(left, right) {
  const a = sourceStatIdentity(left);
  const b = sourceStatIdentity(right);
  return a.dev === b.dev
    && a.ino === b.ino
    && a.mode === b.mode
    && a.size === b.size
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs;
}

function sourceChangedError() {
  const error = new Error('素材在索引期间发生变化，请等待写入完成后重试');
  error.code = 'ASSET_SOURCE_CHANGED';
  error.retryable = true;
  return error;
}

function isFatalAssetScanError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return code === 'PROJECT_DATABASE_STORAGE_CAPACITY_EXCEEDED'
    || code === 'ENOSPC'
    || code === 'EDQUOT'
    || /^SQLITE_(?:FULL|BUSY|LOCKED)(?:_|$)/.test(code);
}

function hostArtifactCommitError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function throwIfHostArtifactAborted(signal) {
  if (!signal?.aborted) return;
  const error = hostArtifactCommitError('host_artifact_aborted', '应用正在关闭，host artifact 提交已停止', 503);
  error.name = 'AbortError';
  error.retryable = true;
  throw error;
}

async function readStableAssetSource(filename, kind, options = {}) {
  const absolute = path.resolve(filename);
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 2));
  const hashReader = typeof options.hashFile === 'function' ? options.hashFile : hashFile;
  const metadataReader = typeof options.readMetadata === 'function' ? options.readMetadata : readMetadata;
  const buildDerived = typeof options.buildDerived === 'function' ? options.buildDerived : null;
  let lastChange = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let before;
    try {
      before = fs.statSync(absolute);
      if (!before.isFile()) throw new Error('素材路径不是文件');
      const firstHash = await hashReader(absolute);
      let metadata;
      try {
        metadata = await metadataReader(absolute, kind, before, options.metadataOptions || {});
      } catch (error) {
        if (isFatalAssetScanError(error)) throw error;
        metadata = {
          size: before.size,
          modifiedAt: before.mtimeMs,
          health: 'corrupt',
          metadataErrorCode: String(error?.code || 'METADATA_READ_FAILED').slice(0, 100),
          metadataError: String(error?.message || error || '元数据读取失败').replace(/\s+/g, ' ').trim().slice(0, 600),
        };
      }
      if (!metadata.health) {
        metadata.health = Array.isArray(metadata.missingReferences) && metadata.missingReferences.length
          ? 'missing-dependencies'
          : 'ok';
      }
      if (buildDerived) {
        if (metadata.health === 'corrupt') {
          metadata.previewStatus = 'failed';
          metadata.previewError = metadata.metadataError || '素材损坏，未生成预览';
        } else {
          try {
            metadata = { ...metadata, ...await buildDerived({ filename: absolute, kind, metadata, contentHash: firstHash }) };
          } catch (error) {
            if (isFatalAssetScanError(error)) throw error;
            metadata.previewStatus = 'failed';
            metadata.previewError = error?.message || String(error);
          }
        }
      }

      const afterMetadata = fs.statSync(absolute);
      if (!afterMetadata.isFile() || !sameSourceStat(before, afterMetadata)) {
        lastChange = sourceChangedError();
        continue;
      }
      const secondHash = await hashReader(absolute);
      const afterHash = fs.statSync(absolute);
      if (!afterHash.isFile()
        || !sameSourceStat(before, afterHash)
        || firstHash !== secondHash) {
        lastChange = sourceChangedError();
        continue;
      }
      return { stat: afterHash, contentHash: secondHash, metadata, attempts: attempt };
    } catch (error) {
      if (error?.message === '素材路径不是文件') throw error;
      if (attempt < attempts && ['ENOENT', 'ESTALE', 'EBUSY', 'EPERM'].includes(String(error?.code || '').toUpperCase())) {
        lastChange = sourceChangedError();
        continue;
      }
      throw error;
    }
  }
  throw lastChange || sourceChangedError();
}

function walkFiles(root, maxFiles = 100000) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const queue = [root];
  while (queue.length && result.length < maxFiles) {
    const directory = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (isFatalAssetScanError(error)) throw error;
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile()) result.push(fullPath);
      if (result.length >= maxFiles) break;
    }
  }
  return result;
}

const DERIVED_METADATA_FIELDS = Object.freeze([
  'thumbnailUrl', 'firstFrameUrl', 'lastFrameUrl', 'keyframeUrls', 'keyframeTimes',
  'contactSheetUrl', 'proxyUrl', 'waveformUrl', 'modelPreviewUrl', 'perceptualHash',
  'perceptualHashAlgorithm', 'perceptualHashes',
  'previewError',
]);

function previewStatePatchForJob(job) {
  const restoredResult = job?.status === 'succeeded' && job.result && typeof job.result === 'object'
    ? Object.fromEntries(DERIVED_METADATA_FIELDS
      .filter((field) => field !== 'previewError' && job.result[field] !== undefined)
      .map((field) => [field, job.result[field]]))
    : {};
  return {
    ...restoredResult,
    previewStatus: job?.status === 'succeeded' ? 'ready' : (job?.status || 'queued'),
    previewError: job?.errorMessage || null,
  };
}

class AssetIndexer {
  constructor(config, database, options = {}) {
    this.config = config;
    this.database = database;
    this.previewPipeline = options.previewPipeline || null;
    this.blobStore = options.blobStore || null;
    this.remoteMediaDownload = options.remoteMediaDownload || safeRemoteMediaDownload;
    this.modelMetadataLimits = normalizeModelMetadataLimits(options.modelMetadataLimits);
    this.hostArtifactActive = 0;
    this.hostArtifactWaiters = [];
    this.runningByProject = new Map();
    this.lastResultByProject = new Map();
    this.cleanupHostArtifactStaging();
  }

  roots() {
    return [
      { name: 'input', path: this.config.INPUT_DIR, publicPrefix: '/files/input/' },
      { name: 'output', path: this.config.OUTPUT_DIR, publicPrefix: '/files/output/' },
    ];
  }

  hostArtifactLimits() {
    return {
      totalMaxBytes: boundedPositiveInteger(
        this.config.HOST_ARTIFACT_TOTAL_MAX_BYTES,
        DEFAULT_HOST_ARTIFACT_TOTAL_MAX_BYTES,
        MAX_HOST_ARTIFACT_TOTAL_MAX_BYTES,
      ),
      remoteMaxBytes: boundedPositiveInteger(
        this.config.HOST_ARTIFACT_REMOTE_MAX_BYTES,
        DEFAULT_HOST_ARTIFACT_REMOTE_MAX_BYTES,
        MAX_HOST_ARTIFACT_REMOTE_MAX_BYTES,
      ),
      deadlineMs: normalizeProviderMediaTimeoutMs(this.config.HOST_ARTIFACT_DEADLINE_MS, {
        fallback: DEFAULT_HOST_ARTIFACT_DEADLINE_MS,
        maximum: MAX_HOST_ARTIFACT_DEADLINE_MS,
      }),
      concurrency: boundedPositiveInteger(
        this.config.HOST_ARTIFACT_CONCURRENCY,
        DEFAULT_HOST_ARTIFACT_CONCURRENCY,
        MAX_HOST_ARTIFACT_CONCURRENCY,
      ),
      queueLimit: boundedPositiveInteger(
        this.config.HOST_ARTIFACT_QUEUE_LIMIT,
        DEFAULT_HOST_ARTIFACT_QUEUE_LIMIT,
        MAX_HOST_ARTIFACT_QUEUE_LIMIT,
      ),
    };
  }

  cleanupHostArtifactStaging() {
    try {
      if (!this.config.OUTPUT_DIR || !fs.existsSync(this.config.OUTPUT_DIR)) return;
      const outputRoot = fs.realpathSync.native(path.resolve(this.config.OUTPUT_DIR));
      const stagingRoot = path.join(outputRoot, '.host-artifact-staging');
      if (!fs.existsSync(stagingRoot)) return;
      const stagingStat = fs.lstatSync(stagingRoot);
      if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) return;
      const realStagingRoot = fs.realpathSync.native(stagingRoot);
      if (!isPathInside(outputRoot, realStagingRoot)) return;
      const maxAgeMs = boundedPositiveInteger(
        this.config.HOST_ARTIFACT_STAGING_MAX_AGE_MS,
        DEFAULT_HOST_ARTIFACT_STAGING_MAX_AGE_MS,
        DEFAULT_HOST_ARTIFACT_STAGING_MAX_AGE_MS,
      );
      const cutoff = Date.now() - maxAgeMs;
      for (const entry of fs.readdirSync(realStagingRoot, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !HOST_ARTIFACT_STAGING_FILE_PATTERN.test(entry.name)) continue;
        const candidate = path.join(realStagingRoot, entry.name);
        if (!isPathInside(realStagingRoot, candidate)) continue;
        const stat = fs.lstatSync(candidate);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) fs.rmSync(candidate, { force: true });
      }
    } catch (_) {
      // Cleanup is best-effort. The strict path checks run again before every
      // new staging file and fail closed if the directory is unsafe.
    }
  }

  hostArtifactStagingTarget(stagedPaths) {
    const outputRoot = path.resolve(this.config.OUTPUT_DIR || '');
    if (!this.config.OUTPUT_DIR || !fs.existsSync(outputRoot)) {
      throw hostArtifactCommitError('host_artifact_output_root_missing', 'host artifact 输出目录不可用', 500);
    }
    const stagingRoot = path.join(outputRoot, '.host-artifact-staging');
    try {
      fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
      const realOutputRoot = fs.realpathSync.native(outputRoot);
      const realStagingRoot = fs.realpathSync.native(stagingRoot);
      const stagingStat = fs.lstatSync(realStagingRoot);
      if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()
        || !isPathInside(realOutputRoot, realStagingRoot)) {
        throw hostArtifactCommitError('host_artifact_staging_unsafe', 'host artifact 临时目录越界', 500);
      }
      const stagedName = `host-artifact-${crypto.randomUUID()}.part`;
      const absolute = path.join(realStagingRoot, stagedName);
      if (!isPathInside(realStagingRoot, absolute)) {
        throw hostArtifactCommitError('host_artifact_staging_unsafe', 'host artifact 临时文件越界', 500);
      }
      stagedPaths.add(absolute);
      return {
        absolute,
        relativePath: path.relative(realOutputRoot, absolute),
        materialized: true,
      };
    } catch (error) {
      if (error?.code && String(error.code).startsWith('host_artifact_')) throw error;
      throw hostArtifactCommitError('host_artifact_staging_failed', 'host artifact 临时文件写入失败', 500);
    }
  }

  writeHostArtifactStagingFile(buffer, stagedPaths) {
    const target = this.hostArtifactStagingTarget(stagedPaths);
    try {
      fs.writeFileSync(target.absolute, buffer, { flag: 'wx', mode: 0o600 });
      return target;
    } catch (_) {
      throw hostArtifactCommitError('host_artifact_staging_failed', 'host artifact 临时文件写入失败', 500);
    }
  }

  prepareHostArtifactInput(raw, index, outputOrdinal) {
    const sourceValue = raw.sourceUrl == null ? '' : String(raw.sourceUrl);
    if (sourceValue.length > 16_384) {
      throw hostArtifactCommitError('host_artifact_source_forbidden', 'host artifact 输出来源无效', 403);
    }
    const sourceUrl = sourceValue.trim();
    const hasInlineText = typeof raw.text === 'string';
    if (sourceUrl && hasInlineText) {
      throw hostArtifactCommitError('host_artifact_source_ambiguous', 'host artifact 输出来源不能同时包含 URL 和正文');
    }
    if (hasInlineText) {
      const buffer = Buffer.from(raw.text, 'utf8');
      if (buffer.length > MAX_HOST_ARTIFACT_INLINE_TEXT_BYTES) {
        throw hostArtifactCommitError('host_artifact_inline_text_too_large', 'host artifact 文本超过 1 MiB 安全上限', 413);
      }
      return {
        raw,
        index,
        outputOrdinal,
        sourceType: 'inline-text',
        buffer,
        contentType: 'text/plain',
        sourceDescriptorDigest: sourceDescriptorDigest('inline-text', {
          contentHash: sha256Value(buffer),
          byteSize: buffer.length,
        }),
      };
    }

    const controlled = resolveControlledOutputSource(sourceUrl, this.config);
    if (controlled?.controlled) {
      if (!controlled.safe) {
        throw hostArtifactCommitError('host_artifact_source_forbidden', 'host artifact 本机输出路径不安全', 403);
      }
      if (!controlled.exists) {
        throw hostArtifactCommitError('host_artifact_source_missing', 'host artifact 输出文件不存在', 409);
      }
      return {
        raw,
        index,
        outputOrdinal,
        sourceType: 'controlled-output',
        controlled,
        contentType: '',
        sourceDescriptorDigest: null,
      };
    }

    let target;
    try { target = new URL(sourceUrl); } catch (_) {
      throw hostArtifactCommitError('host_artifact_source_forbidden', 'host artifact 输出来源无效', 403);
    }
    if (target.protocol !== 'https:' || target.username || target.password) {
      throw hostArtifactCommitError('host_artifact_source_forbidden', 'host artifact 远程来源协议无效', 403);
    }
    target.hash = '';
    const canonicalSourceUrl = target.toString();
    return {
      raw,
      index,
      outputOrdinal,
      sourceType: 'remote-provider',
      sourceUrl: canonicalSourceUrl,
      contentType: '',
      sourceDescriptorDigest: sourceDescriptorDigest('remote-provider', { sourceUrl: canonicalSourceUrl }),
    };
  }

  async materializeHostArtifactSource(prepared, stagedPaths, maximumBytes, deadlineMs, signal = null) {
    throwIfHostArtifactAborted(signal);
    if (prepared.sourceType === 'inline-text') {
      return {
        ...this.writeHostArtifactStagingFile(prepared.buffer, stagedPaths),
        sourceType: prepared.sourceType,
        originalFilename: '',
        contentType: 'text/plain',
        sourceDescriptorDigest: prepared.sourceDescriptorDigest,
      };
    }
    if (prepared.sourceType === 'controlled-output') {
      return {
        absolute: prepared.controlled.absolute,
        relativePath: prepared.controlled.relativePath,
        materialized: false,
        sourceType: prepared.sourceType,
        originalFilename: path.basename(prepared.controlled.absolute),
        contentType: '',
        sourceDescriptorDigest: null,
      };
    }

    const target = this.hostArtifactStagingTarget(stagedPaths);
    let remote;
    try {
      remote = await this.remoteMediaDownload(prepared.sourceUrl, target.absolute, {
        maxBytes: maximumBytes,
        timeoutMs: deadlineMs,
        idleTimeoutMs: deadlineMs,
        deadlineMs,
        maxRedirects: 4,
        protocols: ['https:'],
        trustedProviderOutput: true,
        accept: 'image/*,video/*,audio/*,model/*,text/*,application/json,application/octet-stream;q=0.8',
        signal,
      });
    } catch (error) {
      throwIfHostArtifactAborted(signal);
      const tooLarge = error?.code === 'item_too_large';
      const status = tooLarge ? 413 : 502;
      throw hostArtifactCommitError(
        tooLarge ? 'host_artifact_remote_too_large' : 'host_artifact_remote_fetch_failed',
        tooLarge ? 'host artifact 远程文件超过安全上限' : 'host artifact 远程文件获取失败',
        status,
      );
    }
    throwIfHostArtifactAborted(signal);
    let stagedStat = null;
    try { stagedStat = fs.lstatSync(target.absolute); } catch (_) {}
    if (!remote || !Number.isSafeInteger(Number(remote.byteSize))
      || Number(remote.byteSize) < 0 || Number(remote.byteSize) > maximumBytes
      || !stagedStat || !stagedStat.isFile() || stagedStat.isSymbolicLink()
      || Number(stagedStat.size) !== Number(remote.byteSize)) {
      throw hostArtifactCommitError('host_artifact_remote_invalid', 'host artifact 远程响应无效', 502);
    }
    const contentType = normalizedContentType(remote.contentType);
    return {
      ...target,
      sourceType: 'remote-provider',
      originalFilename: '',
      contentType,
      sourceDescriptorDigest: prepared.sourceDescriptorDigest,
    };
  }

  status(projectId = DEFAULT_PROJECT_ID) {
    const key = String(projectId || DEFAULT_PROJECT_ID);
    return {
      projectId: key,
      running: this.runningByProject.has(key),
      lastResult: this.lastResultByProject.get(key) || null,
    };
  }

  scan(options = {}) {
    const projectId = String(options.projectId || DEFAULT_PROJECT_ID);
    const running = this.runningByProject.get(projectId);
    if (running) return running;
    const promise = this.performScan({ ...options, projectId })
      .then((result) => {
        this.lastResultByProject.set(projectId, result);
        return result;
      })
      .finally(() => {
        if (this.runningByProject.get(projectId) === promise) this.runningByProject.delete(projectId);
      });
    this.runningByProject.set(projectId, promise);
    return promise;
  }

  async indexFile(filename, options = {}) {
    const absolute = path.resolve(filename);
    const rootName = String(options.rootName || 'linked');
    const rootPath = options.rootPath ? path.resolve(options.rootPath) : path.dirname(absolute);
    const relativePath = options.relativePath || (rootName === 'linked' ? absolute.replace(/\\/g, '/') : path.relative(rootPath, absolute));
    const publicRelativePath = rootName === 'linked' ? path.basename(absolute) : relativePath;
    const info = extensionInfo(absolute);
    const supportsDerivedPreview = ['image', 'video', 'audio', 'model3d'].includes(info.kind);
    const stableSource = await readStableAssetSource(absolute, info.kind, {
      attempts: options.sourceStabilityAttempts || this.config.ASSET_INDEX_STABILITY_ATTEMPTS || 2,
      metadataOptions: { modelMetadataLimits: this.modelMetadataLimits },
      buildDerived: !this.previewPipeline && supportsDerivedPreview
        ? ({ filename: source, kind, metadata, contentHash }) => createDerivedMedia(source, kind, metadata, this.config, contentHash)
        : null,
    });
    const { stat, contentHash } = stableSource;
    const metadata = stableSource.metadata;
    const storageMode = options.storageMode || (rootName === 'linked' ? 'linked' : 'managed');
    const assetRootIdentity = options.projectId ? `${options.projectId}:${rootName}` : rootName;
    const fallbackId = stableAssetId(assetRootIdentity, relativePath);
    const sourceLocator = stableSourceLocator(options.projectId, rootName, relativePath);
    const sourceUrl = options.sourceUrl || (rootName === 'linked'
      ? `/api/project-assets/${encodeURIComponent(fallbackId)}/media`
      : `${options.publicPrefix || `/files/${rootName}/`}${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`);
    const currentAtSource = this.database.findAssetBySourceLocator?.(options.projectId, sourceLocator)
      || this.database.findAssetBySourceUrl?.(options.projectId, sourceUrl)
      || null;
    const historicalVersion = currentAtSource?.contentHash && currentAtSource.contentHash !== contentHash
      ? this.database.findAssetBySourceLocator?.(options.projectId, sourceLocator, {
        contentHash,
        includeReplaced: true,
      }) || null
      : null;
    const existingVersion = currentAtSource?.contentHash === contentHash
      ? currentAtSource
      : historicalVersion;
    // New source paths use a content-versioned identity from their first scan.
    // A legacy schema-15 row keeps its existing ID while its bytes are unchanged,
    // and replaceAssetAtSource can reactivate that row for an A -> B -> A cycle.
    const id = existingVersion?.id || versionedAssetId(assetRootIdentity, relativePath, contentHash);
    const availability = metadata.health === 'corrupt' ? 'corrupt' : 'available';
    const contentChangedAtSource = Boolean(currentAtSource?.contentHash && currentAtSource.contentHash !== contentHash);
    const existingMetadata = existingVersion?.metadata || {};
    const mergedMetadata = { ...existingMetadata, ...metadata };
    if (this.previewPipeline && supportsDerivedPreview) {
      if (metadata.health === 'corrupt') {
        mergedMetadata.previewStatus = 'failed';
        mergedMetadata.previewError = metadata.metadataError || '素材损坏，未加入预览队列';
      } else {
        mergedMetadata.previewStatus = existingVersion?.metadata?.previewStatus || 'queued';
        if (mergedMetadata.previewStatus !== 'failed') delete mergedMetadata.previewError;
      }
    }
    const assetInput = {
      id,
      projectId: options.projectId,
      contentHash,
      contentHashVerification: 'verified',
      perceptualHash: mergedMetadata.perceptualHash || existingVersion?.perceptualHash || null,
      perceptualHashAlgorithm: mergedMetadata.perceptualHashAlgorithm || existingVersion?.perceptualHashAlgorithm || null,
      kind: info.kind,
      mimeType: info.mimeType,
      filename: options.filename || path.basename(absolute),
      managedPath: absolute,
      sourceUrl: rootName === 'linked' ? `/api/project-assets/${encodeURIComponent(id)}/media` : sourceUrl,
      sourceLocator,
      storageMode,
      availability,
      metadata: {
        ...mergedMetadata,
        extension: info.extension,
        root: rootName,
        relativePath: String(publicRelativePath).replace(/\\/g, '/'),
      },
      provenance: {
        source: rootName === 'input' ? 'local-upload' : rootName === 'output' ? 'node-output' : 'linked-local-file',
        ...(existingVersion?.provenance || {}),
      },
      createdBy: options.creatorId || existingVersion?.createdBy || 'local-owner',
      createdAt: existingVersion?.createdAt || stat.birthtimeMs || stat.ctimeMs,
    };
    let asset;
    if (contentChangedAtSource && typeof this.database.replaceAssetAtSource === 'function') {
      const replacement = this.database.replaceAssetAtSource(currentAtSource.id, assetInput, {
        sourceType: 'source-version-replacement',
        derivedOperation: 'replaced-at-source',
        canvasId: options.canvasId,
        creatorId: options.creatorId,
        metadata: {
          storageMode,
          root: rootName,
          previousContentHash: currentAtSource.contentHash,
          contentHash,
        },
      });
      asset = replacement?.asset || this.database.getAsset?.(id);
    } else {
      asset = this.database.upsertAsset(assetInput);
    }
    if (!asset) throw new Error('素材索引写入失败');
    if (this.previewPipeline && supportsDerivedPreview && metadata.health !== 'corrupt') {
      const job = this.previewPipeline.enqueueAsset(asset);
      asset = this.database.patchAssetPreviewState(asset.id, contentHash, previewStatePatchForJob(job)) || asset;
    }
    if (options.recordLineage !== false && this.database.recordAssetLineageEvent) {
      this.database.recordAssetLineageEvent({
        assetId: asset.id,
        parentAssetId: options.parentAssetId,
        sourceType: options.sourceType || (rootName === 'input' ? 'upload' : rootName === 'output' ? 'output-scan' : 'linked-file'),
        sourceNodeId: options.sourceNodeId,
        sourceNodeType: options.sourceNodeType,
        runId: options.runId,
        nodeRunId: options.nodeRunId,
        attemptId: options.attemptId,
        canvasId: options.canvasId,
        creatorId: options.creatorId,
        promptSummary: options.promptSummary,
        derivedOperation: options.derivedOperation,
        metadata: { storageMode, root: rootName },
      });
    }
    return asset;
  }

  async recordRunOutputAssets(input = {}) {
    const run = this.database.getRun(input.runId);
    const nodeRun = this.database.getNodeRun(input.nodeRunId);
    if (!run || !nodeRun || nodeRun.runId !== run.id) throw new Error('输出记录不属于当前 Run');
    const attempt = input.attemptId ? this.database.getAttempt(input.attemptId) : null;
    if (input.attemptId && (!attempt || attempt.nodeRunId !== nodeRun.id)) throw new Error('输出 Attempt 不属于当前 NodeRun');
    const outputs = Array.isArray(input.outputs) ? input.outputs.slice(0, 100) : [];
    const normalized = [];
    for (const item of outputs) {
      if (!item || typeof item !== 'object') {
        normalized.push(item);
        continue;
      }
      const sourceUrl = String(item.sourceUrl || '').trim().slice(0, 16384);
      const clean = {
        kind: item.kind,
        sourceUrl,
        text: item.text,
        filename: item.filename,
        mimeType: item.mimeType,
        metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
      };
      const resolved = resolveControlledOutputSource(sourceUrl, this.config);
      if (!resolved) {
        normalized.push({
          ...clean,
          storageMode: /^https?:\/\//i.test(sourceUrl) ? 'remote' : (sourceUrl ? 'linked' : 'embedded'),
          availability: sourceUrl ? 'unverified' : 'available',
        });
        continue;
      }
      if (!resolved.safe) {
        normalized.push({ ...clean, storageMode: 'linked', availability: 'unverified' });
        continue;
      }
      if (!resolved.exists) {
        normalized.push({
          ...clean,
          sourceUrl: resolved.sourceUrl,
          managedPath: resolved.absolute,
          storageMode: 'managed',
          availability: 'missing',
          metadata: {
            ...clean.metadata,
            health: 'missing',
            root: 'output',
            relativePath: resolved.relativePath.replace(/\\/g, '/'),
          },
        });
        continue;
      }
      try {
        const indexed = await this.indexFile(resolved.absolute, {
          projectId: run.projectId,
          rootName: 'output',
          rootPath: this.config.OUTPUT_DIR,
          publicPrefix: '/files/output/',
          relativePath: resolved.relativePath,
          storageMode: 'managed',
          creatorId: run.initiatorId,
          recordLineage: false,
        });
        normalized.push({
          ...clean,
          kind: indexed.kind,
          filename: indexed.filename,
          mimeType: indexed.mimeType,
          sourceUrl: indexed.sourceUrl,
          managedPath: indexed.managedPath,
          storageMode: indexed.storageMode,
          availability: indexed.availability,
          contentHash: indexed.contentHash,
          perceptualHash: indexed.perceptualHash,
          metadata: { ...clean.metadata, ...indexed.metadata },
        });
      } catch (_) {
        const missing = !fs.existsSync(resolved.absolute);
        normalized.push({
          ...clean,
          sourceUrl: resolved.sourceUrl,
          managedPath: resolved.absolute,
          storageMode: 'managed',
          availability: missing ? 'missing' : 'unverified',
          metadata: {
            ...clean.metadata,
            health: missing ? 'missing' : 'unverified',
            indexingStatus: 'failed',
            root: 'output',
            relativePath: resolved.relativePath.replace(/\\/g, '/'),
          },
        });
      }
    }
    return this.database.recordRunOutputAssets({ ...input, outputs: normalized });
  }

  /**
   * Commit output files produced by the trusted local host executor. Request
   * metadata is intentionally ignored: the output root, source bytes, CAS
   * address, media type and all common-operation identities are derived here.
   * The nested CAS callbacks provide compensation if the single SQLite
   * transaction fails after one or more new blobs were installed.
   */
  releaseHostArtifactPermit() {
    const next = this.hostArtifactWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.hostArtifactActive = Math.max(0, this.hostArtifactActive - 1);
  }

  async acquireHostArtifactPermit(signal = null) {
    throwIfHostArtifactAborted(signal);
    const { concurrency, queueLimit } = this.hostArtifactLimits();
    if (this.hostArtifactActive < concurrency) {
      this.hostArtifactActive += 1;
    } else {
      if (this.hostArtifactWaiters.length >= queueLimit) {
        throw hostArtifactCommitError('host_artifact_busy', 'host artifact 提交队列已满，请稍后重试', 429);
      }
      await new Promise((resolve, reject) => {
        const waiter = () => {
          signal?.removeEventListener?.('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.hostArtifactWaiters.indexOf(waiter);
          if (index >= 0) this.hostArtifactWaiters.splice(index, 1);
          const error = hostArtifactCommitError('host_artifact_aborted', '应用正在关闭，host artifact 提交已停止', 503);
          error.name = 'AbortError';
          error.retryable = true;
          reject(error);
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
        this.hostArtifactWaiters.push(waiter);
        if (signal?.aborted) onAbort();
      });
    }
    try {
      throwIfHostArtifactAborted(signal);
    } catch (error) {
      this.releaseHostArtifactPermit();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseHostArtifactPermit();
    };
  }

  hydrateHostArtifactCommit(committed, run, nodeRun, attempt) {
    const assets = committed.results.map((result) => (
      this.database.getAssetByEntityUid(result.artifactUid, run.projectId)
      || this.database.getAsset(result.assetId)
    ));
    if (assets.some((asset) => !asset)) {
      throw hostArtifactCommitError('host_artifact_result_missing', 'host artifact 提交结果无法读取', 500);
    }
    return {
      ...committed,
      run: this.database.getRun(run.id),
      nodeRun: this.database.getNodeRun(nodeRun.id),
      attempt: this.database.getAttempt(attempt.id),
      assets,
    };
  }

  buildHostArtifactBatch(run, nodeRun, attempt, document, artifacts, existingCommits = []) {
    const ordinals = artifacts.map((artifact) => artifact.outputOrdinal);
    const deterministicBatchId = stableEntityUuid(
      't8-host-artifact-batch-v1',
      run.entityUid,
      nodeRun.entityUid,
      attempt.entityUid,
      ordinals.join(','),
    );
    const deterministicClientId = stableEntityUuid(
      't8-host-artifact-client-v1',
      run.entityUid,
      nodeRun.entityUid,
      attempt.entityUid,
    );
    if (existingCommits.length) {
      const firstCommit = existingCommits[0];
      const common = this.database.getCommonOperationBatch({ batchId: firstCommit.batchId });
      let persistedOperationIds = null;
      try { persistedOperationIds = JSON.parse(common?.operation_ids_json || 'null'); } catch (_) {}
      const headerMatches = common
        && firstCommit.batchId === deterministicBatchId
        && common.batch_id === deterministicBatchId
        && common.project_id === run.projectId
        && common.canvas_id === run.canvasId
        && common.client_id === deterministicClientId
        && Number(common.client_seq) === Math.min(...ordinals)
        && common.actor_id === 'host-executor'
        && common.session_id === 'host-authority'
        && Array.isArray(persistedOperationIds)
        && persistedOperationIds.length === artifacts.length;
      const recordsMatch = headerMatches && existingCommits.every((commit, index) => {
        const artifact = artifacts[index];
        return commit.batchId === deterministicBatchId
          && commit.operationIndex === index
          && persistedOperationIds[index] === artifact.opId
          && commit.opId === artifact.opId
          && commit.projectId === run.projectId
          && commit.canvasId === run.canvasId
          && commit.canvasRevision === Number(common.base_revision)
          && commit.runId === run.id
          && commit.runEntityUid === run.entityUid
          && commit.nodeRunId === nodeRun.id
          && commit.nodeRunEntityUid === nodeRun.entityUid
          && commit.attemptId === attempt.id
          && commit.attemptEntityUid === attempt.entityUid
          && commit.nodeEntityUid === nodeRun.nodeEntityUid
          && commit.outputOrdinal === artifact.outputOrdinal
          && commit.assetId === `run-output-${artifact.artifactUid}`
          && commit.assetEntityUid === artifact.artifactUid
          && commit.blobEntityUid === artifact.blobUid
          && commit.kind === artifact.kind
          && commit.contentHash === artifact.contentHash
          && commit.byteSize === artifact.byteSize
          && commit.filename === artifact.filename
          && commit.mimeType === artifact.mimeType
          && (commit.sourceDescriptorDigest || null) === (artifact.sourceDescriptorDigest || null);
      });
      if (!recordsMatch) {
        throw hostArtifactCommitError('host_artifact_output_slot_conflict', 'host artifact output slot 与冻结提交不一致', 409);
      }
      return {
        contractVersion: COMMON_OPERATION_BATCH_CONTRACT,
        projectId: run.projectId,
        canvasId: run.canvasId,
        baseRevision: Number(common.base_revision),
        batchId: deterministicBatchId,
        clientId: deterministicClientId,
        clientSeq: Number(common.client_seq),
        operations: artifacts.map((artifact, index) => {
          const commit = existingCommits[index];
          return {
            opId: artifact.opId,
            type: 'host.artifact.commit',
            payload: {
              artifactUid: artifact.artifactUid,
              blobUid: artifact.blobUid,
              runUid: run.entityUid,
              nodeRunUid: nodeRun.entityUid,
              attemptUid: attempt.entityUid,
              nodeUid: nodeRun.nodeEntityUid,
              expectedCanvasRevision: Number(common.base_revision),
              expectedRunRevision: commit.runRevisionBefore,
              expectedNodeRunRevision: commit.nodeRunRevisionBefore,
              expectedAttemptRevision: commit.attemptRevisionBefore,
              outputOrdinal: artifact.outputOrdinal,
              kind: artifact.kind,
              contentHash: artifact.contentHash,
              byteSize: artifact.byteSize,
              filename: artifact.filename,
              mimeType: artifact.mimeType,
            },
          };
        }),
      };
    }
    return {
      contractVersion: COMMON_OPERATION_BATCH_CONTRACT,
      projectId: run.projectId,
      canvasId: run.canvasId,
      baseRevision: document.revision,
      batchId: deterministicBatchId,
      clientId: deterministicClientId,
      clientSeq: Math.min(...ordinals),
      operations: artifacts.map((artifact, index) => ({
        opId: artifact.opId,
        type: 'host.artifact.commit',
        payload: {
          artifactUid: artifact.artifactUid,
          blobUid: artifact.blobUid,
          runUid: run.entityUid,
          nodeRunUid: nodeRun.entityUid,
          attemptUid: attempt.entityUid,
          nodeUid: nodeRun.nodeEntityUid,
          expectedCanvasRevision: document.revision,
          expectedRunRevision: run.revision + index,
          expectedNodeRunRevision: nodeRun.revision + index,
          expectedAttemptRevision: attempt.revision + index,
          outputOrdinal: artifact.outputOrdinal,
          kind: artifact.kind,
          contentHash: artifact.contentHash,
          byteSize: artifact.byteSize,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
        },
      })),
    };
  }

  async loadCommittedHostArtifact(prepared, commit, run, attempt, signal = null) {
    throwIfHostArtifactAborted(signal);
    if (!prepared.sourceDescriptorDigest
      || commit.sourceDescriptorDigest !== prepared.sourceDescriptorDigest) {
      throw hostArtifactCommitError('host_artifact_output_slot_conflict', 'host artifact 来源与冻结提交不一致', 409);
    }
    const blobStore = this.blobStore || (this.blobStore = getAssetBlobStore(this.config));
    let verified;
    try { verified = await blobStore.resolveVerifiedBlob(commit.contentHash, commit.byteSize); } catch (_) {
      throw hostArtifactCommitError('host_artifact_cas_corrupt', 'host artifact 冻结 CAS 产物校验失败', 409);
    }
    throwIfHostArtifactAborted(signal);
    if (!verified) {
      throw hostArtifactCommitError('host_artifact_cas_missing', 'host artifact 冻结 CAS 产物缺失', 409);
    }
    const asset = this.database.getAssetByEntityUid(commit.assetEntityUid, run.projectId);
    const artifactUid = stableEntityUuid('t8-host-artifact-v1', attempt.entityUid, prepared.outputOrdinal);
    return {
      opId: stableEntityUuid('t8-host-artifact-operation-v1', attempt.entityUid, prepared.outputOrdinal),
      artifactUid,
      blobUid: stableEntityUuid('t8-asset-blob-v1', 'sha256', commit.contentHash),
      contentHash: commit.contentHash,
      sourceDescriptorDigest: prepared.sourceDescriptorDigest,
      byteSize: commit.byteSize,
      kind: commit.kind,
      filename: commit.filename,
      mimeType: commit.mimeType,
      outputOrdinal: prepared.outputOrdinal,
      sourcePath: verified.path,
      metadata: {
        ...(asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}),
        size: commit.byteSize,
        sourceDescriptorDigest: prepared.sourceDescriptorDigest,
      },
      installed: {
        path: verified.path,
        storageKey: path.relative(blobStore.rootPath, verified.path).split(path.sep).join('/'),
      },
    };
  }

  async replayCommittedHostArtifacts(input, run, nodeRun, attempt, document, preparedOutputs, existingCommits) {
    const signal = input.signal || null;
    throwIfHostArtifactAborted(signal);
    const limits = this.hostArtifactLimits();
    const totalBytes = existingCommits.reduce((sum, commit) => sum + Number(commit.byteSize), 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.totalMaxBytes) {
      throw hostArtifactCommitError('host_artifact_total_too_large', 'host artifact 批次超过总字节安全上限', 413);
    }
    const blobStore = this.blobStore || (this.blobStore = getAssetBlobStore(this.config));
    const locksByHash = new Map();
    existingCommits.forEach((commit) => {
      const hash = String(commit.contentHash || '').toLowerCase();
      const byteSize = Number(commit.byteSize);
      const existing = locksByHash.get(hash);
      if (existing && existing.byteSize !== byteSize) {
        throw hostArtifactCommitError('host_artifact_blob_metadata_conflict', '相同 CAS 内容具有冲突的 blob 元数据', 409);
      }
      locksByHash.set(hash, { contentHash: hash, byteSize });
    });
    const locks = [...locksByHash.values()]
      .sort((left, right) => left.contentHash.localeCompare(right.contentHash));

    const applyReplayUnderLocks = async () => {
      throwIfHostArtifactAborted(signal);
      const artifacts = [];
      for (let index = 0; index < preparedOutputs.length; index += 1) {
        artifacts.push(await this.loadCommittedHostArtifact(
          preparedOutputs[index],
          existingCommits[index],
          run,
          attempt,
          signal,
        ));
        throwIfHostArtifactAborted(signal);
      }
      const batch = this.buildHostArtifactBatch(
        run,
        nodeRun,
        attempt,
        document,
        artifacts,
        existingCommits,
      );
      const verifiedAt = Date.now();
      const verifiedArtifacts = artifacts.map((artifact, index) => ({
        opId: artifact.opId,
        artifactUid: artifact.artifactUid,
        blobUid: artifact.blobUid,
        contentHash: artifact.contentHash,
        sourceDescriptorDigest: artifact.sourceDescriptorDigest,
        byteSize: artifact.byteSize,
        kind: artifact.kind,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        outputOrdinal: artifact.outputOrdinal,
        storageKey: artifact.installed.storageKey,
        managedPath: artifact.installed.path,
        metadata: artifact.metadata,
        verifiedAt: verifiedAt + index,
      }));
      throwIfHostArtifactAborted(signal);
      const committed = this.database.applyCommonHostArtifactBatch(batch, {
        hostIdentity: { actorId: 'host-executor', sessionId: 'host-authority' },
        verifiedArtifacts,
        recoveryTerminal: input.recoveryTerminal,
      });
      return this.hydrateHostArtifactCommit(committed, run, nodeRun, attempt);
    };

    const acquireAt = async (index) => {
      throwIfHostArtifactAborted(signal);
      if (index >= locks.length) return applyReplayUnderLocks();
      const lock = locks[index];
      let result;
      try {
        result = await blobStore.withVerifiedBlobLock(
          lock.contentHash,
          lock.byteSize,
          () => acquireAt(index + 1),
        );
      } catch (error) {
        if (!(error instanceof AssetBlobStoreError)) throw error;
        throw hostArtifactCommitError('host_artifact_cas_corrupt', 'host artifact 冻结 CAS 产物校验失败', 409);
      }
      throwIfHostArtifactAborted(signal);
      if (result == null) {
        throw hostArtifactCommitError('host_artifact_cas_missing', 'host artifact 冻结 CAS 产物缺失', 409);
      }
      return result;
    };
    return acquireAt(0);
  }

  async commitHostRunOutputAssets(input = {}) {
    const signal = input.signal || null;
    throwIfHostArtifactAborted(signal);
    const release = await this.acquireHostArtifactPermit(signal);
    const stagedPaths = new Set();
    try {
      throwIfHostArtifactAborted(signal);
      return await this.commitMaterializedHostRunOutputAssets(input, stagedPaths);
    } finally {
      for (const filename of stagedPaths) {
        try { fs.rmSync(filename, { force: true }); } catch (_) {}
      }
      release();
    }
  }

  async commitMaterializedHostRunOutputAssets(input = {}, stagedPaths = new Set()) {
    const signal = input.signal || null;
    throwIfHostArtifactAborted(signal);
    const run = this.database.getRun(String(input.runId || ''));
    const nodeRun = this.database.getNodeRun(String(input.nodeRunId || ''));
    const attempt = this.database.getAttempt(String(input.attemptId || ''));
    if (!run || !nodeRun || nodeRun.runId !== run.id) {
      throw hostArtifactCommitError('host_artifact_run_scope_invalid', '输出记录不属于当前 Run', 409);
    }
    if (!attempt || attempt.nodeRunId !== nodeRun.id) {
      throw hostArtifactCommitError('host_artifact_attempt_scope_invalid', '输出 Attempt 不属于当前 NodeRun', 409);
    }
    const document = this.database.getCanvas(run.canvasId);
    if (!document || document.projectId !== run.projectId) {
      throw hostArtifactCommitError('host_artifact_canvas_scope_invalid', '输出 Run 不属于有效 Canvas', 409);
    }
    if (!nodeRun.nodeEntityUid) {
      throw hostArtifactCommitError('host_artifact_node_identity_missing', 'NodeRun 缺少权威节点稳定身份', 409);
    }

    const rawOutputs = Array.isArray(input.outputs) ? input.outputs : [];
    if (rawOutputs.length < 1 || rawOutputs.length > 100) {
      throw hostArtifactCommitError('host_artifact_outputs_invalid', 'host artifact 必须包含 1-100 个输出');
    }
    const seenOrdinals = new Set();
    const preparedOutputs = rawOutputs.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw hostArtifactCommitError('host_artifact_output_invalid', `第 ${index + 1} 个输出无效`);
      }
      const outputOrdinal = raw.outputOrdinal == null ? index : raw.outputOrdinal;
      if (!Number.isSafeInteger(outputOrdinal) || outputOrdinal < 0 || outputOrdinal > 999
        || seenOrdinals.has(outputOrdinal)) {
        throw hostArtifactCommitError('host_artifact_output_ordinal_invalid', 'host artifact outputOrdinal 必须是唯一的 0-999 整数');
      }
      seenOrdinals.add(outputOrdinal);
      return this.prepareHostArtifactInput(raw, index, outputOrdinal);
    }).sort((left, right) => left.outputOrdinal - right.outputOrdinal);

    const existingCommits = preparedOutputs.map((prepared) => (
      this.database.getRunOutputCommitBySlot(attempt.entityUid, prepared.outputOrdinal)
    ));
    const existingReservations = preparedOutputs.map((prepared) => (
      this.database.getRunOutputSlotReservation(attempt.entityUid, prepared.outputOrdinal)
    ));
    const inconsistentReservation = existingCommits.some((commit, index) => {
      const reservation = existingReservations[index];
      return Boolean(commit) !== Boolean(reservation)
        || (commit && reservation && (
          reservation.reservationState !== 'host-verified'
          || reservation.sourceDescriptorDigest !== commit.sourceDescriptorDigest
          || reservation.assetEntityUid !== commit.assetEntityUid
          || reservation.contentHash !== commit.contentHash
        ));
    });
    if (inconsistentReservation) {
      throw hostArtifactCommitError('host_artifact_output_slot_conflict', 'host artifact output slot 预留与冻结提交不一致', 409);
    }
    const existingCount = existingCommits.filter(Boolean).length;
    if (existingCount > 0 && existingCount !== preparedOutputs.length) {
      throw hostArtifactCommitError('host_artifact_output_slot_conflict', 'host artifact output slot 已被其他批次部分占用', 409);
    }
    if (existingCount === preparedOutputs.length
      && preparedOutputs.every((prepared) => prepared.sourceType !== 'controlled-output')) {
      return this.replayCommittedHostArtifacts(
        input,
        run,
        nodeRun,
        attempt,
        document,
        preparedOutputs,
        existingCommits,
      );
    }

    const limits = this.hostArtifactLimits();
    const deadlineAt = Date.now() + limits.deadlineMs;
    let totalBytes = 0;
    const artifacts = [];
    for (let preparedIndex = 0; preparedIndex < preparedOutputs.length; preparedIndex += 1) {
      const prepared = preparedOutputs[preparedIndex];
      const remainingBytes = limits.totalMaxBytes - totalBytes;
      if (remainingBytes < 0 || Date.now() >= deadlineAt) {
        throw hostArtifactCommitError(
          remainingBytes < 0 ? 'host_artifact_total_too_large' : 'host_artifact_deadline_exceeded',
          remainingBytes < 0 ? 'host artifact 批次超过总字节安全上限' : 'host artifact 提交超时',
          remainingBytes < 0 ? 413 : 504,
        );
      }
      if (existingCount && prepared.sourceType !== 'controlled-output') {
        const committedArtifact = await this.loadCommittedHostArtifact(
          prepared,
          existingCommits[preparedIndex],
          run,
          attempt,
          signal,
        );
        throwIfHostArtifactAborted(signal);
        if (!Number.isSafeInteger(Number(committedArtifact.byteSize))
          || Number(committedArtifact.byteSize) < 0
          || Number(committedArtifact.byteSize) > remainingBytes) {
          throw hostArtifactCommitError('host_artifact_total_too_large', 'host artifact 批次超过总字节安全上限', 413);
        }
        totalBytes += Number(committedArtifact.byteSize);
        artifacts.push(committedArtifact);
        continue;
      }
      const maximumBytes = prepared.sourceType === 'remote-provider'
        ? Math.min(limits.remoteMaxBytes, remainingBytes)
        : remainingBytes;
      if (prepared.sourceType === 'remote-provider' && maximumBytes < 1) {
        throw hostArtifactCommitError('host_artifact_total_too_large', 'host artifact 批次超过总字节安全上限', 413);
      }
      const materialized = await this.materializeHostArtifactSource(
        prepared,
        stagedPaths,
        maximumBytes,
        deadlineAt - Date.now(),
        signal,
      );
      throwIfHostArtifactAborted(signal);
      let initialStat;
      try { initialStat = fs.lstatSync(materialized.absolute); } catch (_) {
        throw hostArtifactCommitError('host_artifact_source_missing', 'host artifact 输出文件不存在', 409);
      }
      if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
        throw hostArtifactCommitError('host_artifact_source_forbidden', 'host artifact 输出必须是安全的普通文件', 403);
      }
      if (Number(initialStat.size) > maximumBytes) {
        throw hostArtifactCommitError(
          prepared.sourceType === 'remote-provider' ? 'host_artifact_remote_too_large' : 'host_artifact_total_too_large',
          'host artifact 文件超过安全上限',
          413,
        );
      }
      const detected = detectHostArtifactType(
        materialized.absolute,
        materialized.contentType,
        materialized.sourceType,
      );
      if (detected.forbidden) {
        throw hostArtifactCommitError('host_artifact_type_forbidden', 'host artifact 响应类型与实际内容不一致', 415);
      }
      const stableSource = await readStableAssetSource(materialized.absolute, detected.kind, {
        attempts: this.config.ASSET_INDEX_STABILITY_ATTEMPTS || 2,
        metadataOptions: {
          modelMetadataLimits: this.modelMetadataLimits,
          sourceExtension: `.${detected.extension}`,
        },
      });
      throwIfHostArtifactAborted(signal);
      const verifiedType = detectHostArtifactType(
        materialized.absolute,
        materialized.contentType,
        materialized.sourceType,
      );
      if (verifiedType.forbidden
        || verifiedType.kind !== detected.kind
        || verifiedType.mimeType !== detected.mimeType
        || verifiedType.extension !== detected.extension
        || !sameSourceStat(stableSource.stat, verifiedType.stat)) {
        throw sourceChangedError();
      }
      if (stableSource.metadata?.health === 'corrupt'
        && ['image', 'video', 'audio', 'model3d'].includes(detected.kind)) {
        throw hostArtifactCommitError('host_artifact_media_corrupt', 'host artifact 媒体或模型文件无法通过解析校验', 415);
      }
      const byteSize = Number(stableSource.stat.size);
      if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > remainingBytes) {
        throw hostArtifactCommitError('host_artifact_total_too_large', 'host artifact 批次超过总字节安全上限', 413);
      }
      totalBytes += byteSize;
      const filename = canonicalHostArtifactFilename(
        materialized.sourceType,
        materialized.originalFilename,
        detected,
        prepared.outputOrdinal,
      );
      const contentHash = String(stableSource.contentHash).toLowerCase();
      const artifactUid = stableEntityUuid('t8-host-artifact-v1', attempt.entityUid, prepared.outputOrdinal);
      // Read auxiliary provider data from the verified local media receipt, never
      // from caller-supplied metadata. Match the exact task/model/connection and bytes.
      const motionResult = detected.kind === 'video'
        ? require('./motionVideoMetadata').readMotionVideoMetadata(this.config.OUTPUT_DIR, materialized.absolute, contentHash, attempt.metadata?.recovery)
        : null;
      artifacts.push({
        opId: stableEntityUuid('t8-host-artifact-operation-v1', attempt.entityUid, prepared.outputOrdinal),
        artifactUid,
        blobUid: stableEntityUuid('t8-asset-blob-v1', 'sha256', contentHash),
        contentHash,
        sourceDescriptorDigest: materialized.sourceDescriptorDigest,
        byteSize,
        kind: detected.kind,
        filename,
        mimeType: detected.mimeType,
        outputOrdinal: prepared.outputOrdinal,
        sourcePath: materialized.absolute,
        metadata: {
          ...stableSource.metadata,
          ...(motionResult ? { motionResult } : {}),
          size: byteSize,
          extension: detected.extension,
          root: 'output',
          sourceType: materialized.sourceType,
          ...(materialized.sourceDescriptorDigest
            ? { sourceDescriptorDigest: materialized.sourceDescriptorDigest }
            : {}),
          ...(materialized.materialized
            ? {}
            : { relativePath: materialized.relativePath.replace(/\\/g, '/') }),
        },
      });
    }

    let batch = this.buildHostArtifactBatch(
      run,
      nodeRun,
      attempt,
      document,
      artifacts,
      existingCount ? existingCommits : [],
    );
    const groups = [];
    const groupsByHash = new Map();
    for (const artifact of artifacts) {
      const existing = groupsByHash.get(artifact.contentHash);
      if (existing) {
        if (existing.mimeType !== artifact.mimeType || existing.byteSize !== artifact.byteSize) {
          throw hostArtifactCommitError('host_artifact_blob_metadata_conflict', '相同 CAS 内容具有冲突的 blob 元数据', 409);
        }
        existing.artifacts.push(artifact);
      } else {
        const group = {
          contentHash: artifact.contentHash,
          byteSize: artifact.byteSize,
          mimeType: artifact.mimeType,
          sourcePath: artifact.sourcePath,
          artifacts: [artifact],
        };
        groupsByHash.set(artifact.contentHash, group);
        groups.push(group);
      }
    }
    // Every request acquires per-hash CAS locks in the same global order. This
    // prevents two multi-output commits with reversed artifact order from
    // waiting on each other's nested compensation callbacks.
    groups.sort((left, right) => left.contentHash.localeCompare(right.contentHash));
    const installedByHash = new Map(artifacts
      .filter((artifact) => artifact.installed)
      .map((artifact) => [artifact.contentHash, artifact.installed]));
    const blobStore = this.blobStore || (this.blobStore = getAssetBlobStore(this.config));
    let committed;
    const installAt = async (index) => {
      throwIfHostArtifactAborted(signal);
      if (index >= groups.length) {
        // Materializing and hashing a large video may take long enough for the
        // normal canvas autosave to advance its revision. Build a fresh batch
        // immediately before the synchronous database transaction so a valid
        // long-running Run output is committed against the live canvas rather
        // than the stale revision captured before file I/O began. Exact replay
        // must keep the originally persisted batch/revision.
        if (!existingCount) {
          const liveDocument = this.database.getCanvas(run.canvasId);
          const liveRun = this.database.getRun(run.id);
          const liveNodeRun = this.database.getNodeRun(nodeRun.id);
          const liveAttempt = this.database.getAttempt(attempt.id);
          if (!liveDocument || liveDocument.projectId !== run.projectId) {
            throw hostArtifactCommitError('host_artifact_canvas_scope_invalid', '输出 Run 不属于有效 Canvas', 409);
          }
          if (!liveRun || !liveNodeRun || liveNodeRun.runId !== liveRun.id
            || !liveAttempt || liveAttempt.nodeRunId !== liveNodeRun.id) {
            throw hostArtifactCommitError('host_artifact_run_scope_invalid', '输出记录不属于当前 Run', 409);
          }
          batch = this.buildHostArtifactBatch(
            liveRun,
            liveNodeRun,
            liveAttempt,
            liveDocument,
            artifacts,
          );
        }
        const verifiedAt = Date.now();
        const verifiedArtifacts = artifacts.map((artifact, artifactIndex) => {
          const installed = installedByHash.get(artifact.contentHash);
          return {
            opId: artifact.opId,
            artifactUid: artifact.artifactUid,
            blobUid: artifact.blobUid,
            contentHash: artifact.contentHash,
            sourceDescriptorDigest: artifact.sourceDescriptorDigest,
            byteSize: artifact.byteSize,
            kind: artifact.kind,
            filename: artifact.filename,
            mimeType: artifact.mimeType,
            outputOrdinal: artifact.outputOrdinal,
            storageKey: installed.storageKey,
            managedPath: installed.path,
            metadata: artifact.metadata,
            verifiedAt: verifiedAt + artifactIndex,
          };
        });
        committed = this.database.applyCommonHostArtifactBatch(batch, {
          hostIdentity: { actorId: 'host-executor', sessionId: 'host-authority' },
          verifiedArtifacts,
          recoveryTerminal: input.recoveryTerminal,
        });
        return;
      }
      if (Date.now() >= deadlineAt) {
        throw hostArtifactCommitError('host_artifact_deadline_exceeded', 'host artifact 提交超时', 504);
      }
      const group = groups[index];
      if (installedByHash.has(group.contentHash)) {
        await installAt(index + 1);
        return;
      }
      await blobStore.installVerifiedFile(group.sourcePath, {
        expectedHash: group.contentHash,
        expectedSize: group.byteSize,
        onInstalled: async (installed) => {
          throwIfHostArtifactAborted(signal);
          installedByHash.set(group.contentHash, installed);
          await installAt(index + 1);
        },
      });
      throwIfHostArtifactAborted(signal);
    };
    await installAt(0);
    throwIfHostArtifactAborted(signal);
    return this.hydrateHostArtifactCommit(committed, run, nodeRun, attempt);
  }

  indexLinkedFile(filename, options = {}) {
    return this.indexFile(filename, { ...options, rootName: 'linked', storageMode: 'linked' });
  }

  async performScan(options = {}) {
    const startedAt = Date.now();
    const roots = this.roots();
    const candidates = roots.flatMap((root) => walkFiles(root.path, Number(options.maxFiles) || 100000).map((filename) => ({ root, filename })));
    let indexed = 0;
    let failed = 0;
    let cursor = 0;
    let fatalError = null;
    const workers = Array.from({ length: Math.min(4, Math.max(1, Number(options.concurrency) || 2)) }, async () => {
      while (!fatalError && cursor < candidates.length) {
        const item = candidates[cursor++];
        const relativePath = path.relative(item.root.path, item.filename);
        try {
          await this.indexFile(item.filename, {
            projectId: options.projectId,
            rootName: item.root.name,
            rootPath: item.root.path,
            publicPrefix: item.root.publicPrefix,
            relativePath,
            storageMode: 'managed',
          });
          indexed += 1;
        } catch (error) {
          if (isFatalAssetScanError(error)) {
            if (!fatalError) fatalError = error;
            break;
          }
          failed += 1;
        }
      }
    });
    // A fatal worker must not let the request reject while already-claimed
    // index writes are still running in the background.
    const workerResults = await Promise.allSettled(workers);
    if (fatalError) throw fatalError;
    const unexpectedWorkerFailure = workerResults.find((result) => result.status === 'rejected');
    if (unexpectedWorkerFailure) throw unexpectedWorkerFailure.reason;
    const availabilityBatch = this.database.listAssetAvailabilitySnapshots(options.projectId);
    const availability = await reconcileAssetAvailabilitySnapshots(this.database, availabilityBatch, {
      concurrency: options.availabilityConcurrency,
    });
    return {
      projectId: String(options.projectId || DEFAULT_PROJECT_ID),
      catalogRevision: availability.catalogRevision,
      total: candidates.length,
      indexed,
      failed,
      availability,
      startedAt,
      finishedAt: Date.now(),
    };
  }
}

const backgroundIndexerSingletons = new WeakMap();

function getBackgroundAssetIndexer(config, database, previewPipeline) {
  let indexer = backgroundIndexerSingletons.get(database);
  if (!indexer) {
    indexer = new AssetIndexer(config, database, { previewPipeline });
    backgroundIndexerSingletons.set(database, indexer);
  }
  return indexer;
}

module.exports = {
  AssetIndexer,
  getBackgroundAssetIndexer,
  EXTENSION_INFO,
  extensionInfo,
  resolveControlledOutputSource,
  stableAssetId,
  stableSourceLocator,
  versionedAssetId,
  hashFile,
  readMetadata,
  readStableAssetSource,
  sameSourceStat,
  parseExifBuffer,
  differenceHash,
  dctPerceptualHash,
  dct64FromGrayscale32,
  parseGltfDocument,
  parseObjMetadata,
  createDerivedMedia,
  runFfprobeKeyframes,
  selectBoundedTimestamps,
  writeAtomicTarget,
  previewStatePatchForJob,
  MAX_IMAGE_INPUT_PIXELS,
  PHASH_DCT64_ALGORITHM,
  DEFAULT_ASSET_PREVIEW_PIPELINE_VERSION,
  MODEL_METADATA_LIMITS,
  AssetModelMetadataError,
};
