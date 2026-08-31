const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');
const { withFfmpegProcessSlot } = require('../utils/ffmpegProcessQueue');
const {
  isDataUrl,
  isT8LocalMediaPath,
  mediaRefToAbsoluteUrl,
  mimeFromPath,
  normalizeT8LocalMediaRef,
  resolveMediaRef,
} = require('./mediaResolver');

const DEFAULT_BASE_URL = `http://127.0.0.1:${config.PORT}`;
const DEFAULT_VIDEO_MODE = 'frames';
const DEFAULT_VIDEO_MAX_DIMENSION = 720;
const DEFAULT_VIDEO_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_VIDEO_CRF = 32;
const DEFAULT_FFMPEG_TIMEOUT_MS = 120 * 1000;
const DEFAULT_VIDEO_FRAME_COUNT = 12;
const MAX_VIDEO_FRAME_COUNT = 60;
const DEFAULT_IMAGE_MAX_DIMENSION = 1600;
const DEFAULT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function dataUrlInfo(value) {
  const match = String(value || '').trim().match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1] || 'application/octet-stream', base64: match[2] || '' };
}

function dataUrlByteLength(value) {
  const info = dataUrlInfo(value);
  return info ? Buffer.byteLength(info.base64, 'base64') : 0;
}

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function ffmpegBinaryName() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function ffprobeBinaryName() {
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function executableExists(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveBundledFfmpeg() {
  const binary = ffmpegBinaryName();
  const resRoot = String(process.env.T8PC_RES || '').trim();
  const candidates = [
    process.env.T8_FFMPEG_BIN,
    resRoot && path.join(resRoot, 'tools', 'ffmpeg', binary),
    resRoot && path.join(resRoot, 'tools', 'ffmpeg-runtime', binary),
    path.join(repoRoot(), 'tools', 'ffmpeg-runtime', binary),
    path.join(repoRoot(), 'tools', 'ffmpeg', binary),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (executableExists(candidate)) return candidate;
  }
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (executableExists(installer.path)) return installer.path;
  } catch {
    // optional dev fallback only
  }
  return binary;
}

function resolveBundledFfprobe() {
  const binary = ffprobeBinaryName();
  const resRoot = String(process.env.T8PC_RES || '').trim();
  const candidates = [
    process.env.T8_FFPROBE_BIN,
    resRoot && path.join(resRoot, 'tools', 'ffmpeg', binary),
    resRoot && path.join(resRoot, 'tools', 'ffmpeg-runtime', binary),
    path.join(repoRoot(), 'tools', 'ffmpeg-runtime', binary),
    path.join(repoRoot(), 'tools', 'ffmpeg', binary),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (executableExists(candidate)) return candidate;
  }
  return binary;
}

function tempFilePath(ext) {
  const suffix = crypto.randomBytes(5).toString('hex');
  return path.join(os.tmpdir(), `t8-llm-video-${Date.now()}-${suffix}.${ext || 'mp4'}`);
}

function fileDataUrl(filePath, mime = 'video/mp4') {
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function parseDurationSeconds(stderr) {
  const match = String(stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function probeVideoDurationSeconds(inputPath, options = {}) {
  const ffmpeg = options.ffmpegPath || resolveBundledFfmpeg();
  const timeoutMs = clampInt(options.ffmpegProbeTimeoutMs || options.ffmpegTimeoutMs, 5 * 1000, 60 * 1000, 15 * 1000);
  return withFfmpegProcessSlot(() => new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', inputPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      resolve(0);
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(0);
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseDurationSeconds(stderr));
    });
  }));
}

function formatFpsValue(durationSeconds, frameCount) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || frameCount <= 1) return '1';
  const fps = Math.max(0.02, Math.min(30, frameCount / Math.max(durationSeconds, 0.2)));
  return String(Number(fps.toFixed(6)));
}

function formatVideoTimecode(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    `${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`,
  ].join(':');
}

function runFfmpeg(inputPath, outputPath, options = {}) {
  const ffmpeg = options.ffmpegPath || resolveBundledFfmpeg();
  const maxWidth = clampInt(options.videoMaxWidth, 128, 4096, DEFAULT_VIDEO_MAX_DIMENSION);
  const maxHeight = clampInt(options.videoMaxHeight, 128, 4096, DEFAULT_VIDEO_MAX_DIMENSION);
  const crf = clampInt(options.videoCrf, 18, 40, DEFAULT_VIDEO_CRF);
  const timeoutMs = clampInt(options.ffmpegTimeoutMs, 10 * 1000, 20 * 60 * 1000, DEFAULT_FFMPEG_TIMEOUT_MS);
  const args = [
    '-y',
    '-hide_banner',
    '-i',
    inputPath,
    '-vf',
    `scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    String(crf),
    '-an',
    '-movflags',
    '+faststart',
    outputPath,
  ];
  return withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`ffmpeg 压缩超时(${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`ffmpeg 压缩失败(${code}): ${stderr.trim().slice(0, 600)}`));
    });
  }));
}

async function runFfmpegExtractFrames(inputPath, outputDir, options = {}) {
  const ffmpeg = options.ffmpegPath || resolveBundledFfmpeg();
  const maxSize = clampInt(
    options.videoFrameMaxSize || options.videoMaxWidth || options.videoMaxHeight,
    128,
    2048,
    DEFAULT_VIDEO_MAX_DIMENSION,
  );
  const frameCount = clampInt(options.videoFrameCount, 1, MAX_VIDEO_FRAME_COUNT, DEFAULT_VIDEO_FRAME_COUNT);
  const timeoutMs = clampInt(options.ffmpegTimeoutMs, 10 * 1000, 20 * 60 * 1000, DEFAULT_FFMPEG_TIMEOUT_MS);
  const pattern = path.join(outputDir, 'frame_%03d.jpg');
  const durationSeconds = await probeVideoDurationSeconds(inputPath, options);
  const fpsValue = formatFpsValue(durationSeconds, frameCount);
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vf',
    `fps=${fpsValue},scale=${maxSize}:${maxSize}:force_original_aspect_ratio=decrease`,
    '-frames:v',
    String(frameCount),
    pattern,
  ];
  return withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`ffmpeg 抽帧超时(${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({
        pattern,
        durationSeconds,
        frameCount,
        frameIntervalSeconds: Number(fpsValue) > 0 ? 1 / Number(fpsValue) : null,
      });
      else reject(new Error(`ffmpeg 抽帧失败(${code}): ${stderr.trim().slice(0, 600)}`));
    });
  }));
}

async function compressLocalVideoToDataUrl(inputPath, options = {}) {
  const outPath = tempFilePath('mp4');
  try {
    await runFfmpeg(inputPath, outPath, options);
    const maxBytes = numberOr(options.videoMaxBase64Bytes, DEFAULT_VIDEO_MAX_BYTES);
    const size = fs.statSync(outPath).size;
    if (size > maxBytes) throw new Error(`压缩后视频仍超过上限 ${Math.round(size / 1024 / 1024)}MB`);
    return fileDataUrl(outPath, 'video/mp4');
  } finally {
    try { fs.rmSync(outPath, { force: true }); } catch {}
  }
}

async function compressDataVideoToDataUrl(value, options = {}) {
  const info = dataUrlInfo(value);
  if (!info) return value;
  const inputExt = info.mime.includes('webm') ? 'webm' : info.mime.includes('quicktime') ? 'mov' : 'mp4';
  const inPath = tempFilePath(inputExt);
  try {
    fs.writeFileSync(inPath, Buffer.from(info.base64, 'base64'));
    return await compressLocalVideoToDataUrl(inPath, options);
  } finally {
    try { fs.rmSync(inPath, { force: true }); } catch {}
  }
}

function normalizeVideoMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'frames' || text === 'keyframes' || text === 'frame') return 'frames';
  if (text === 'url') return 'url';
  if (text === 'raw-base64' || text === 'raw_base64') return 'raw-base64';
  if (
    text === 'base64' ||
    text === 'native-base64' ||
    text === 'native_base64' ||
    text === 'compressed-base64' ||
    text === 'compressed_base64' ||
    text === 'video-base64' ||
    text === 'video_base64'
  ) return 'compressed-base64';
  return DEFAULT_VIDEO_MODE;
}

function dataUrlToTempVideoFile(value) {
  const info = dataUrlInfo(value);
  if (!info || !/^video\//i.test(info.mime || '')) return '';
  const inputExt = info.mime.includes('webm') ? 'webm' : info.mime.includes('quicktime') ? 'mov' : 'mp4';
  const inPath = tempFilePath(inputExt);
  fs.writeFileSync(inPath, Buffer.from(info.base64, 'base64'));
  return inPath;
}

async function resolveVideoToLocalPath(value, options = {}) {
  const text = normalizeT8LocalMediaRef(value);
  if (!text) return { path: '', cleanup: '' };
  if (isDataUrl(text)) {
    const cleanup = dataUrlToTempVideoFile(text);
    return { path: cleanup, cleanup };
  }
  if (
    isT8LocalMediaPath(text) ||
    path.isAbsolute(text) ||
    text.startsWith('file://')
  ) {
    const local = await resolveMediaRef(text, { target: 'local-path', baseUrl: options.baseUrl || DEFAULT_BASE_URL });
    return { path: local.path, cleanup: '' };
  }
  return { path: '', cleanup: '' };
}

async function extractVideoFramesWithTimingToDataUrls(value, options = {}) {
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-llm-video-frames-'));
  let cleanupVideo = '';
  try {
    const resolved = await resolveVideoToLocalPath(value, options);
    cleanupVideo = resolved.cleanup || '';
    if (!resolved.path || !fs.existsSync(resolved.path)) return [];
    const extraction = await runFfmpegExtractFrames(resolved.path, frameDir, options);
    const files = fs.readdirSync(frameDir)
      .filter((name) => /\.(jpe?g|png)$/i.test(name))
      .sort();
    return files.map((name, index) => {
      const rawTimestamp = Number(extraction?.frameIntervalSeconds) > 0
        ? index * Number(extraction.frameIntervalSeconds)
        : null;
      const timestampSeconds = rawTimestamp == null
        ? null
        : Math.min(rawTimestamp, Math.max(0, Number(extraction?.durationSeconds) || rawTimestamp));
      return {
        url: fileDataUrl(path.join(frameDir, name), 'image/jpeg'),
        index,
        timestampSeconds,
        timecode: timestampSeconds == null ? '' : formatVideoTimecode(timestampSeconds),
        durationSeconds: Number(extraction?.durationSeconds) || null,
      };
    });
  } catch (e) {
    if (options.logFrameErrors) console.warn('[llmMedia] video frame extraction failed:', e?.message || e);
    return [];
  } finally {
    try { fs.rmSync(frameDir, { recursive: true, force: true }); } catch {}
    if (cleanupVideo) {
      try { fs.rmSync(cleanupVideo, { force: true }); } catch {}
    }
  }
}

async function extractVideoFramesToDataUrls(value, options = {}) {
  const frames = await extractVideoFramesWithTimingToDataUrls(value, options);
  return frames.map((frame) => frame.url);
}

async function compactVisionImage(resolved, original, options = {}) {
  const maximumDimension = clampInt(options.imageMaxDimension, 512, 4096, DEFAULT_IMAGE_MAX_DIMENSION);
  const maximumBytes = numberOr(options.imageMaxBase64Bytes, DEFAULT_IMAGE_MAX_BYTES);
  let bytes;
  let mime = resolved?.mime || 'image/png';
  try {
    bytes = resolved?.path ? fs.readFileSync(resolved.path) : Buffer.from(String(resolved?.base64 || ''), 'base64');
    const sharp = require('sharp');
    const metadata = await sharp(bytes, { failOn: 'none' }).metadata();
    const width = Number(metadata.width) || 0;
    const height = Number(metadata.height) || 0;
    if (bytes.length <= maximumBytes && width <= maximumDimension && height <= maximumDimension) {
      return /^data:image\//iu.test(original)
        ? original
        : `data:${mime};base64,${bytes.toString('base64')}`;
    }
    bytes = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: maximumDimension, height: maximumDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    mime = 'image/webp';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    if (resolved?.path && fs.existsSync(resolved.path)) {
      bytes = fs.readFileSync(resolved.path);
      return `data:${mime};base64,${bytes.toString('base64')}`;
    }
    return original;
  }
}

async function normalizeImageUrl(url, options = {}) {
  const text = normalizeT8LocalMediaRef(url, options);
  if (!text || isRemoteUrl(text)) return text;
  if (isDataUrl(text)) {
    const info = dataUrlInfo(text);
    return compactVisionImage(info, text, options);
  }
  if (isT8LocalMediaPath(text) || path.isAbsolute(text) || text.startsWith('file://')) {
    const resolved = await resolveMediaRef(text, {
      target: 'local-path',
      baseUrl: options.baseUrl || DEFAULT_BASE_URL,
    });
    if (resolved.path) return compactVisionImage(resolved, text, options);
    throw new Error(`本地图片读取失败: ${text}`);
  }
  return text;
}

async function normalizeVideoUrl(url, options = {}) {
  const text = normalizeT8LocalMediaRef(url);
  if (!text) return text;
  const mode = normalizeVideoMode(options.videoMode);
  const nativeMode = mode === 'frames' ? 'compressed-base64' : mode;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  if (nativeMode === 'url') return mediaRefToAbsoluteUrl(text, { baseUrl });
  if (isRemoteUrl(text)) return text;

  const maxBytes = numberOr(options.videoMaxBase64Bytes, DEFAULT_VIDEO_MAX_BYTES);
  if (isDataUrl(text)) {
    if (!/^data:video\//i.test(text)) return text;
    if (mode === 'raw-base64') {
      const size = dataUrlByteLength(text);
      if (size > maxBytes) throw new Error(`完整视频超过上限 ${Math.ceil(size / 1024 / 1024)}MB`);
      return text;
    }
    if (dataUrlByteLength(text) <= maxBytes) return text;
    try {
      return await compressDataVideoToDataUrl(text, { ...options, videoMaxBase64Bytes: maxBytes });
    } catch {
      return text;
    }
  }

  if (isT8LocalMediaPath(text) || path.isAbsolute(text) || text.startsWith('file://')) {
    let local;
    try {
      local = await resolveMediaRef(text, { target: 'local-path', baseUrl });
    } catch {
      return mediaRefToAbsoluteUrl(text, { baseUrl });
    }
    try {
      if (mode === 'raw-base64') {
        const size = fs.existsSync(local.path) ? fs.statSync(local.path).size : Number.POSITIVE_INFINITY;
        if (size > maxBytes) throw new Error(`完整视频超过上限 ${Math.ceil(size / 1024 / 1024)}MB`);
        return fileDataUrl(local.path, local.mime || mimeFromPath(local.path, 'video/mp4'));
      }
      return await compressLocalVideoToDataUrl(local.path, { ...options, videoMaxBase64Bytes: maxBytes });
    } catch {
      const size = fs.existsSync(local.path) ? fs.statSync(local.path).size : Number.POSITIVE_INFINITY;
      if (size <= maxBytes) return fileDataUrl(local.path, mimeFromPath(local.path, 'video/mp4'));
      return mediaRefToAbsoluteUrl(text, { baseUrl });
    }
  }

  return text;
}

async function videoPartToMessageParts(part, options = {}, index = 0) {
  const videoRef = getMediaUrlPart(part, 'video');
  if (!videoRef) return [part];
  const value = videoRef.container?.[videoRef.key];
  if (typeof value !== 'string' || !value) return [part];
  const mode = normalizeVideoMode(options.videoMode);
  if (mode === 'frames') {
    const frames = await extractVideoFramesWithTimingToDataUrls(value, options);
    if (frames.length) {
      const label = index > 0 ? `视频 ${index + 1}` : '视频';
      const durationSeconds = frames.find((frame) => Number(frame.durationSeconds) > 0)?.durationSeconds;
      const timedParts = frames.flatMap((frame, frameIndex) => [
        {
          type: 'text',
          text: frame.timecode
            ? `${label}采样帧 ${frameIndex + 1}/${frames.length} · 约 ${frame.timecode}`
            : `${label}采样帧 ${frameIndex + 1}/${frames.length} · 时间码未知`,
        },
        { type: 'image_url', image_url: { url: frame.url } },
      ]);
      return [
        {
          type: 'text',
          text: `以下是${label}按整段视频时间顺序均匀抽取的 ${frames.length} 张关键帧${durationSeconds ? `（视频时长约 ${formatVideoTimecode(durationSeconds)}）` : ''}。时间码均为采样近似值，不代表逐帧镜头边界；此模式不包含音轨。`,
        },
        ...timedParts,
      ];
    }
  }
  const normalized = await normalizeVideoUrl(value, { ...options, videoMode: mode === 'frames' ? 'compressed-base64' : mode });
  const cloned = JSON.parse(JSON.stringify(part));
  const clonedRef = getMediaUrlPart(cloned, 'video');
  if (clonedRef) clonedRef.container[clonedRef.key] = normalized;
  return [cloned];
}

function getMediaUrlPart(part, kind) {
  if (!part || typeof part !== 'object') return null;
  if (kind === 'image') {
    if (part.type === 'image_url' && part.image_url) return { container: part.image_url, key: 'url' };
    if (part.type === 'image' && part.image_url) return { container: part.image_url, key: 'url' };
  }
  if (kind === 'video') {
    if (part.type === 'video_url' && part.video_url) return { container: part.video_url, key: 'url' };
    if (part.type === 'input_video' && part.video_url) return { container: part.video_url, key: 'url' };
    if (part.type === 'input_video' && part.input_video) return { container: part.input_video, key: 'url' };
  }
  return null;
}

function normalizeOptions(input = {}, options = {}) {
  const providerParams = input.providerParams || {};
  const mb = Number(input.videoMaxBase64Mb ?? providerParams.videoMaxBase64Mb ?? options.videoMaxBase64Mb);
  return {
    baseUrl: options.baseUrl || input.baseUrl || DEFAULT_BASE_URL,
    videoMode: normalizeVideoMode(input.llmVideoMode ?? input.videoMode ?? providerParams.llmVideoMode ?? options.videoMode),
    videoMaxWidth: input.videoMaxWidth ?? providerParams.videoMaxWidth ?? options.videoMaxWidth ?? DEFAULT_VIDEO_MAX_DIMENSION,
    videoMaxHeight: input.videoMaxHeight ?? providerParams.videoMaxHeight ?? options.videoMaxHeight ?? DEFAULT_VIDEO_MAX_DIMENSION,
    videoCrf: input.videoCrf ?? providerParams.videoCrf ?? options.videoCrf ?? DEFAULT_VIDEO_CRF,
    videoFrameCount: clampInt(input.videoFrameCount ?? providerParams.videoFrameCount ?? options.videoFrameCount, 1, MAX_VIDEO_FRAME_COUNT, DEFAULT_VIDEO_FRAME_COUNT),
    videoFrameMaxSize: input.videoFrameMaxSize ?? providerParams.videoFrameMaxSize ?? options.videoFrameMaxSize,
    imageMaxDimension: input.imageMaxDimension ?? providerParams.imageMaxDimension ?? options.imageMaxDimension ?? DEFAULT_IMAGE_MAX_DIMENSION,
    imageMaxBase64Bytes: input.imageMaxBase64Bytes ?? providerParams.imageMaxBase64Bytes ?? options.imageMaxBase64Bytes ?? DEFAULT_IMAGE_MAX_BYTES,
    videoMaxBase64Bytes: Number.isFinite(mb) && mb > 0
      ? mb * 1024 * 1024
      : (options.videoMaxBase64Bytes || DEFAULT_VIDEO_MAX_BYTES),
    ffmpegPath: options.ffmpegPath,
    ffmpegTimeoutMs: options.ffmpegTimeoutMs,
  };
}

async function normalizeLlmMessageMedia(messages, inputOrOptions = {}, maybeOptions = {}) {
  if (!Array.isArray(messages)) return messages;
  const opts = normalizeOptions(inputOrOptions, maybeOptions);
  const out = JSON.parse(JSON.stringify(messages));
  for (const msg of out) {
    if (!msg || !Array.isArray(msg.content)) continue;
    const rebuilt = [];
    let videoIndex = 0;
    for (const part of msg.content) {
      const imageRef = getMediaUrlPart(part, 'image');
      if (imageRef) {
        const value = imageRef.container?.[imageRef.key];
        if (typeof value === 'string' && value) imageRef.container[imageRef.key] = await normalizeImageUrl(value, opts);
        rebuilt.push(part);
        continue;
      }
      const videoRef = getMediaUrlPart(part, 'video');
      if (videoRef) {
        const parts = await videoPartToMessageParts(part, opts, videoIndex);
        rebuilt.push(...parts);
        videoIndex += 1;
        continue;
      }
      rebuilt.push(part);
    }
    msg.content = rebuilt;
  }
  return out;
}

module.exports = {
  DEFAULT_VIDEO_MAX_BYTES,
  extractVideoFramesToDataUrls,
  extractVideoFramesWithTimingToDataUrls,
  normalizeLlmMessageMedia,
  resolveBundledFfmpeg,
  resolveBundledFfprobe,
};
