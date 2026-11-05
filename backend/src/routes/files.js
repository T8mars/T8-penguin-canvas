/**
 * 文件上传/下载路由
 * 用于:用户从本地上传参考图,后续传给图像生成接口
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const config = require('../config');
const { tryDecodeDuckPayload } = require('../utils/duckPayload');
const { getProjectDatabase } = require('../services/projectDatabase');
const {
  getBackgroundAssetIndexer,
  writeAtomicTarget,
  MAX_IMAGE_INPUT_PIXELS,
} = require('../services/assetIndexer');
const { getAssetPreviewPipeline, sanitizePreviewError } = require('../services/assetPreviewPipeline');
const { safeRemoteMediaDownload } = require('../utils/safeRemoteMediaFetch');
const { resolveBundledFfmpeg } = require('../providers/llmMedia');
const { withFfmpegProcessSlot } = require('../utils/ffmpegProcessQueue');

const router = express.Router();
// Generated vectors are displayed through an isolated response. The generic
// user-media static mounts continue to reject SVG and other active documents.
router.get('/vector/:filename',async(req,res)=>{
  const name=String(req.params.filename||'');
  if(!/^img_(?:task_[a-f0-9]+_[a-f0-9]+|\d+_[a-f0-9]+)\.svg$/.test(name))return res.status(404).end();
  const url='/files/output/'+name;
  if(!require('../services/materializedOutputStore').isCommittedMaterializedOutputUrl(config.OUTPUT_DIR,url))return res.status(404).end();
  let source;
  try{
    source=await openMountedLocalSource(url,DEFAULT_FILE_SAVE_MAX_BYTES);
    if(!source)return res.status(404).end();
    const prefix=await readFilePrefix(source.handle,source.stat.size);
    if(!require('../providers/providerOutputFormats').isSvgBuffer(prefix))throw Error('Not SVG');
    res.type('image/svg+xml');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename="${name}"`);
    const stream=source.handle.createReadStream();stream.on('error',()=>res.destroy());stream.on('close',()=>source.handle.close().catch(()=>{}));res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{if(source)await source.handle.close().catch(()=>{});if(!res.headersSent)res.status(404).end();else res.destroy();}
});
let projectDatabase = null;
let previewPipeline = null;
let assetIndexer = null;

function getFilesProjectDatabase() {
  if (!projectDatabase) projectDatabase = getProjectDatabase(config);
  return projectDatabase;
}

function getFilesPreviewPipeline() {
  if (!previewPipeline) {
    previewPipeline = getAssetPreviewPipeline(config, getFilesProjectDatabase());
  }
  return previewPipeline;
}

function getFilesAssetIndexer() {
  if (!assetIndexer) {
    assetIndexer = getBackgroundAssetIndexer(
      config,
      getFilesProjectDatabase(),
      getFilesPreviewPipeline(),
    );
  }
  return assetIndexer;
}
const THUMBNAIL_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(?:$|\?)/i;
const LOCAL_MOV_VIDEO_RE = /\.mov(?:$|[?#])/i;
const thumbnailInflight = new Map();
const compatibleVideoPreviewInflight = new Map();
const LOCAL_IMPORT_EXTENSIONS = new Map([
  ['.png', { kind: 'image', mime: 'image/png' }],
  ['.jpg', { kind: 'image', mime: 'image/jpeg' }],
  ['.jpeg', { kind: 'image', mime: 'image/jpeg' }],
  ['.webp', { kind: 'image', mime: 'image/webp' }],
  ['.gif', { kind: 'image', mime: 'image/gif' }],
  ['.bmp', { kind: 'image', mime: 'image/bmp' }],
  ['.avif', { kind: 'image', mime: 'image/avif' }],
  ['.tif', { kind: 'image', mime: 'image/tiff' }],
  ['.tiff', { kind: 'image', mime: 'image/tiff' }],
  ['.mp4', { kind: 'video', mime: 'video/mp4' }],
  ['.mov', { kind: 'video', mime: 'video/quicktime' }],
  ['.webm', { kind: 'video', mime: 'video/webm' }],
  ['.mkv', { kind: 'video', mime: 'video/x-matroska' }],
  ['.avi', { kind: 'video', mime: 'video/x-msvideo' }],
  ['.m4v', { kind: 'video', mime: 'video/x-m4v' }],
]);
const DEFAULT_FILE_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_FILE_SAVE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_DUCK_DECODE_MAX_BYTES = 128 * 1024 * 1024;
const MAX_FILE_ROUTE_BYTES = 4 * 1024 * 1024 * 1024;
const FILE_COPY_CHUNK_BYTES = 64 * 1024;
const FILE_MEDIA_PREFIX_BYTES = 64 * 1024;
const FILE_SAVE_TEST_OPTIONS = Object.create(null);

function boundedFileBytes(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_FILE_ROUTE_BYTES)
    : fallback;
}

const FILE_UPLOAD_MAX_BYTES = boundedFileBytes(
  config.FILE_UPLOAD_MAX_BYTES,
  boundedFileBytes(config.COLLAB_MAX_UPLOAD_BYTES, DEFAULT_FILE_UPLOAD_MAX_BYTES),
);

// 配置 multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.INPUT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: FILE_UPLOAD_MAX_BYTES,
    files: 1,
    fields: 32,
    fieldSize: 64 * 1024,
    parts: 40,
  },
});

function sendUploadError(res, err) {
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: err.code || 'upload_error',
      error: tooLarge ? '上传文件超过允许大小' : (err.message || '文件上传失败'),
    });
  }
  console.error('文件上传错误:', err);
  return res.status(500).json({
    success: false,
    code: 'upload_failed',
    error: err?.message || '文件上传失败',
  });
}

const uploadSingleFile = upload.single('file');

// POST /api/files/upload — 上传文件
router.post('/upload', (req, res) => {
  uploadSingleFile(req, res, async (err) => {
    if (err) return sendUploadError(res, err);
    if (!req.file) {
      return res.status(400).json({ success: false, code: 'missing_file', error: '未收到文件' });
    }
    let asset = null;
    let indexError = null;
    try {
      asset = await getFilesAssetIndexer().indexFile(req.file.path, {
        projectId: req.body?.projectId,
        rootName: 'input',
        rootPath: config.INPUT_DIR,
        publicPrefix: '/files/input/',
        canvasId: req.body?.canvasId,
        sourceNodeId: req.body?.sourceNodeId,
        sourceNodeType: req.body?.sourceNodeType || (req.body?.sourceNodeId ? 'upload' : undefined),
        creatorId: req.body?.creatorId || 'local-owner',
        sourceType: req.body?.sourceNodeId ? 'upload-node' : 'upload',
      });
    } catch (error) {
      indexError = error?.message || String(error);
      console.warn('[asset-index] upload indexing failed:', indexError);
    }
    return res.json({
      success: true,
      data: {
        filename: req.file.filename,
        url: `/files/input/${req.file.filename}`,
        size: req.file.size,
        mime: req.file.mimetype,
        assetId: asset?.id || null,
        storageMode: asset?.storageMode || 'managed',
        availability: asset?.availability || (indexError ? 'unverified' : 'available'),
        ...(indexError ? { indexError } : {}),
      },
    });
  });
});

function localImportMeta(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  return LOCAL_IMPORT_EXTENSIONS.get(ext) || null;
}

function resolveExistingLocalFile(sourcePath) {
  const raw = String(sourcePath || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    throw new Error('本地素材路径必须是绝对路径');
  }
  const resolved = path.resolve(raw);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error('本地素材路径不是文件');
  }
  return { resolved, stat };
}

function importLocalFile(sourcePath) {
  const { resolved, stat } = resolveExistingLocalFile(sourcePath);
  const meta = localImportMeta(resolved);
  if (!meta) {
    throw new Error('仅支持导入图像或视频文件');
  }
  const ext = path.extname(resolved).toLowerCase() || '.bin';
  const filename = `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
  fs.mkdirSync(config.INPUT_DIR, { recursive: true });
  const target = path.join(config.INPUT_DIR, filename);
  fs.copyFileSync(resolved, target);
  return {
    filename,
    originalName: path.basename(resolved),
    url: `/files/input/${filename}`,
    path: target,
    sourcePath: resolved,
    size: stat.size,
    mime: meta.mime,
    kind: meta.kind,
  };
}

// POST /api/files/import-local — Electron 系统选择器拿到绝对路径后，复制到 input 并保留原始路径
router.post('/import-local', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const data = importLocalFile(req.body?.sourcePath || req.body?.path);
    let asset = null;
    let indexError = null;
    try {
      asset = await getFilesAssetIndexer().indexFile(data.path, {
        projectId: req.body?.projectId,
        rootName: 'input',
        rootPath: config.INPUT_DIR,
        publicPrefix: '/files/input/',
        canvasId: req.body?.canvasId,
        sourceNodeId: req.body?.sourceNodeId,
        sourceNodeType: req.body?.sourceNodeType,
        creatorId: req.body?.creatorId || 'local-owner',
        sourceType: req.body?.sourceNodeId ? 'upload-node-import' : 'local-import-copy',
      });
    } catch (error) {
      indexError = error?.message || String(error);
      console.warn('[asset-index] local import indexing failed:', indexError);
    }
    return res.json({
      success: true,
      data: {
        ...data,
        assetId: asset?.id || null,
        storageMode: asset?.storageMode || 'managed',
        availability: asset?.availability || (indexError ? 'unverified' : 'available'),
        ...(indexError ? { indexError } : {}),
      },
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e?.message || String(e) });
  }
});

// GET /api/files/list — 列出 output 目录
router.get('/list', (_req, res) => {
  try {
    const files = fs.readdirSync(config.OUTPUT_DIR)
      .filter((f) => /\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav)$/i.test(f))
      .map((f) => {
        const stat = fs.statSync(path.join(config.OUTPUT_DIR, f));
        return {
          filename: f,
          url: `/files/output/${f}`,
          size: stat.size,
          mtime: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ success: true, data: files });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/files/upload-base64 — 从 base64 dataURL 保存 PNG/JPG 到 OUTPUT_DIR
// 供手绘画板 / 抽帧等前端产生的图像使用
router.post('/upload-base64', express.json({ limit: '20mb' }), (req, res) => {
  try {
    const { dataUrl, prefix } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 dataUrl' });
    }
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl);
    if (!m) {
      return res.status(400).json({ success: false, error: 'dataUrl 格式不支持' });
    }
    const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const tag = (prefix || 'draw').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'draw';
    const filename = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext === 'jpeg' ? 'png' : ext}`;
    const fp = path.join(config.OUTPUT_DIR, filename);
    fs.writeFileSync(fp, buf);
    res.json({
      success: true,
      data: {
        filename,
        url: `/files/output/${filename}`,
        size: buf.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function resolveLocalFileUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const clean = url.split('?')[0].split('#')[0];
  const mounts = [
    { prefix: '/files/input/', dir: config.INPUT_DIR },
    { prefix: '/files/output/', dir: config.OUTPUT_DIR },
  ];
  const mount = mounts.find((item) => clean.startsWith(item.prefix));
  if (!mount) return null;
  const rel = decodeURIComponent(clean.slice(mount.prefix.length));
  const base = path.resolve(mount.dir);
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

function sanitizeOutputPart(value, fallback = 'batch') {
  const clean = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[._-]+$/, '')
    .slice(0, 120);
  return clean || fallback;
}

function ensureUniqueFile(targetDir, filename, overwrite) {
  const parsed = path.parse(String(filename || 'batch-item.bin'));
  const base = sanitizeOutputPart(parsed.name, 'batch-item');
  const ext = sanitizeOutputPart(parsed.ext.replace(/^\./, ''), 'bin');
  let candidate = `${base}.${ext}`;
  if (overwrite || !fs.existsSync(path.join(targetDir, candidate))) return candidate;
  for (let i = 2; i < 10000; i += 1) {
    candidate = `${base}_${i}.${ext}`;
    if (!fs.existsSync(path.join(targetDir, candidate))) return candidate;
  }
  return `${base}_${Date.now()}.${ext}`;
}

function resolveOutputSubdir(subdir) {
  const safeSubdir = sanitizeOutputPart(subdir || 'batch', 'batch');
  const outputRoot = path.resolve(config.OUTPUT_DIR);
  const targetDir = path.resolve(outputRoot, safeSubdir);
  if (targetDir !== outputRoot && !targetDir.startsWith(outputRoot + path.sep)) {
    return null;
  }
  return { safeSubdir, targetDir };
}

function spawnOpenFolder(targetDir, options = {}) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
    const selectPath = String(options.selectPath || '').trim();
    const args = selectPath && platform === 'win32'
      ? [`/select,${selectPath}`]
      : selectPath && platform === 'darwin'
        ? ['-R', selectPath]
        : [targetDir];
    let child;
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    try {
      child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
      });
    } catch (error) {
      done(error);
      return;
    }
    child.once('error', done);
    setTimeout(() => done(), 120);
    child.unref();
  });
}

function clampThumbnailSize(value) {
  const raw = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(raw)) return config.THUMBNAIL_SIZE || 320;
  return Math.max(96, Math.min(1024, raw));
}

function thumbnailCacheFile(sourcePath, stat, size) {
  const key = crypto
    .createHash('sha1')
    .update(`${sourcePath}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}|${size}|${config.ASSET_PREVIEW_PIPELINE_VERSION}`)
    .digest('hex')
    .slice(0, 28);
  return path.join(config.THUMBNAILS_DIR, `preview_${size}_${key}.webp`);
}

async function ensureThumbnailFile(sourcePath, target, size) {
  if (fs.existsSync(target)) return target;
  const inflight = thumbnailInflight.get(target);
  if (inflight) return inflight;
  const promise = getFilesPreviewPipeline().runEphemeral(async () => {
    if (fs.existsSync(target)) return target;
    await writeAtomicTarget(target, async (temporary) => {
      await sharp(sourcePath, {
        animated: false,
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: size,
          height: size,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: config.THUMBNAIL_QUALITY || 78, effort: 4 })
        .toFile(temporary);
    });
    return target;
  }).finally(() => {
    thumbnailInflight.delete(target);
  });
  thumbnailInflight.set(target, promise);
  return promise;
}

// GET /api/files/thumbnail?url=/files/input/x.png&size=360
// 用于画布内预览：只为本地 input/output 图片生成轻量 webp 缩略图。
router.get('/thumbnail', async (req, res) => {
  try {
    const url = String(req.query?.url || '').trim();
    if (!url || !THUMBNAIL_IMAGE_RE.test(url.split('?')[0].split('#')[0])) {
      return res.status(400).json({ success: false, error: '不支持的图片预览地址' });
    }
    const sourcePath = resolveLocalFileUrl(url);
    if (!sourcePath) {
      return res.status(400).json({ success: false, error: '只支持本地 input/output 图片缩略图' });
    }
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ success: false, error: '源图片不存在' });
    }
    const stat = fs.statSync(sourcePath);
    const size = clampThumbnailSize(req.query?.size);
    const target = thumbnailCacheFile(sourcePath, stat, size);
    if (!fs.existsSync(config.THUMBNAILS_DIR)) {
      fs.mkdirSync(config.THUMBNAILS_DIR, { recursive: true });
    }
    await ensureThumbnailFile(sourcePath, target, size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/webp');
    return res.sendFile(target);
  } catch (e) {
    const safe = sanitizePreviewError(e);
    return res.status(safe.code === 'preview-queue-full' ? 429 : 500).json({ success: false, code: safe.code, error: safe.message });
  }
});

function resolveCompatibleVideoPreviewFfmpeg() {
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const resourceRoot = String(process.env.T8PC_RES || '').trim();
  const candidates = [
    process.env.T8_VIDEO_PREVIEW_FFMPEG_BIN,
    resourceRoot && path.join(resourceRoot, 'tools', 'ffmpeg-compat', binary),
  ].filter(Boolean);
  try {
    candidates.push(require('ffmpeg-static'));
  } catch (_) {
    // 开发依赖缺失时继续使用项目内置 ffmpeg。
  }
  candidates.push(resolveBundledFfmpeg());
  return candidates.find((candidate) => {
    try {
      return Boolean(candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    } catch (_) {
      return false;
    }
  }) || candidates.at(-1) || binary;
}

function compatibleVideoPreviewCacheFile(sourcePath, stat) {
  const key = crypto
    .createHash('sha256')
    .update(`${sourcePath}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}|mov-h264-preview-v1`)
    .digest('hex')
    .slice(0, 32);
  return path.join(config.THUMBNAILS_DIR, `video_preview_${key}.mp4`);
}

async function runCompatibleVideoPreviewFfmpeg(sourcePath, targetPath, options = {}) {
  const ffmpeg = options.ffmpegPath || resolveCompatibleVideoPreviewFfmpeg();
  const timeoutMs = Math.max(30_000, Math.min(20 * 60_000, Number(options.timeoutMs) || 10 * 60_000));
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', sourcePath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    '-dn',
    '-vf', "scale=w='trunc(min(1280,iw)/2)*2':h=-2",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '24',
    '-pix_fmt', 'yuv420p',
    '-threads', '1',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '4096',
    '-f', 'mp4',
    targetPath,
  ];
  return withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk || '')}`.slice(-16 * 1024);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('MOV 兼容预览转码超时'));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim().slice(-1200) || `MOV 兼容预览转码失败: ${code}`));
        return;
      }
      try {
        const stat = fs.statSync(targetPath);
        if (!stat.isFile() || stat.size <= 1024) throw new Error('MOV 兼容预览输出无效');
        resolve(targetPath);
      } catch (error) {
        reject(error);
      }
    });
  }));
}

async function ensureCompatibleVideoPreviewFile(sourcePath, sourceStat, targetPath) {
  if (fs.existsSync(targetPath)) return targetPath;
  const inflight = compatibleVideoPreviewInflight.get(targetPath);
  if (inflight) return inflight;
  const promise = getFilesPreviewPipeline().runEphemeral(async () => {
    if (fs.existsSync(targetPath)) return targetPath;
    await writeAtomicTarget(targetPath, (temporary) => (
      runCompatibleVideoPreviewFfmpeg(sourcePath, temporary)
    ));
    const currentStat = fs.statSync(sourcePath);
    if (currentStat.size !== sourceStat.size || currentStat.mtimeMs !== sourceStat.mtimeMs) {
      fs.rmSync(targetPath, { force: true });
      throw new Error('MOV 源文件在生成预览期间发生变化，请重试');
    }
    return targetPath;
  }).finally(() => {
    compatibleVideoPreviewInflight.delete(targetPath);
  });
  compatibleVideoPreviewInflight.set(targetPath, promise);
  return promise;
}

// GET /api/files/video-preview?url=/files/input/x.mov
// Chromium 不支持 Apple ProRes/QuickTime 等常见 MOV 编码。这里仅为本地
// input/output MOV 生成 H.264/AAC MP4 预览；原 MOV URL 不变，下载、连线与生成仍使用原文件。
router.get('/video-preview', async (req, res) => {
  try {
    const url = String(req.query?.url || '').trim();
    if (!url || !LOCAL_MOV_VIDEO_RE.test(url)) {
      return res.status(400).json({ success: false, error: '仅支持本地 MOV 视频兼容预览' });
    }
    const sourcePath = resolveLocalFileUrl(url);
    if (!sourcePath) {
      return res.status(400).json({ success: false, error: '只支持本地 input/output MOV 视频' });
    }
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ success: false, error: '源 MOV 视频不存在' });
    }
    const sourceStat = fs.statSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0) {
      return res.status(415).json({ success: false, error: 'MOV 视频文件无效' });
    }
    fs.mkdirSync(config.THUMBNAILS_DIR, { recursive: true });
    const target = compatibleVideoPreviewCacheFile(sourcePath, sourceStat);
    await ensureCompatibleVideoPreviewFile(sourcePath, sourceStat, target);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.type('video/mp4');
    return res.sendFile(target);
  } catch (error) {
    const safe = sanitizePreviewError(error);
    const status = safe.code === 'preview-queue-full' ? 429 : 500;
    return res.status(status).json({ success: false, code: safe.code, error: safe.message });
  }
});

function safeDuckExt(ext) {
  const clean = String(ext || 'bin')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9._+-]/g, '')
    .slice(0, 40);
  return clean || 'bin';
}

// POST /api/files/duck-decode — 尝试按 SS_tools 无密码鸭鸭图批量解码本地素材
// 非鸭鸭图 / 密码鸭鸭图 / 非图片输出都只返回 decoded:false，前端会静默回退到普通上传输出。
router.post('/duck-decode', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter((u) => typeof u === 'string') : [];
    if (urls.length === 0) {
      return res.status(400).json({ success: false, error: '缺少 urls' });
    }
    const limited = urls.slice(0, 30);
    const items = [];
    for (let i = 0; i < limited.length; i += 1) {
      const sourceUrl = limited[i];
      let openedSource = null;
      try {
        openedSource = await openMountedLocalSource(sourceUrl, fileSaveOptions().duckMaxBytes);
        if (!openedSource) {
          items.push({ sourceUrl, decoded: false, reason: 'local_file_not_found' });
          continue;
        }
        const decoded = await tryDecodeDuckPayload(await openedSource.handle.readFile());
        if (!decoded?.decoded || !decoded.buffer) {
          items.push({
            sourceUrl,
            decoded: false,
            isDuck: !!decoded?.isDuck,
            passwordProtected: !!decoded?.passwordProtected,
            reason: decoded?.passwordProtected ? 'password_protected' : 'not_duck',
          });
          continue;
        }
        if (!['image', 'video', 'audio'].includes(decoded.kind)) {
          items.push({ sourceUrl, decoded: false, isDuck: true, reason: 'unsupported_kind' });
          continue;
        }
        if (!fs.existsSync(config.OUTPUT_DIR)) fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
        const ext = safeDuckExt(decoded.ext);
        const filename = `duck_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const target = path.join(config.OUTPUT_DIR, filename);
        fs.writeFileSync(target, decoded.buffer);
        items.push({
          sourceUrl,
          decoded: true,
          filename,
          url: `/files/output/${filename}`,
          size: decoded.buffer.length,
          kind: decoded.kind,
          mime: decoded.mime,
          originalExt: decoded.originalExt,
          ext,
          lsbBits: decoded.lsbBits,
        });
      } catch (e) {
        const reason = e?.code === 'media_too_large'
          ? 'file_too_large'
          : (e?.code === 'unsafe_local_source' ? 'unsafe_local_source' : 'decode_failed');
        items.push({ sourceUrl, decoded: false, reason });
      } finally {
        if (openedSource?.handle) {
          try { await openedSource.handle.close(); } catch (_) {}
        }
      }
    }
    res.json({
      success: true,
      data: {
        items,
        decodedCount: items.filter((item) => item.decoded).length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// POST /api/files/copy-to-output — 把本地 input/output 文件复制到 output 子目录并按指定文件名命名
router.post('/copy-to-output', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { url, filename, subdir, overwrite } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 url' });
    }
    const src = resolveLocalFileUrl(url);
    if (!src || !fs.existsSync(src)) {
      return res.status(404).json({ success: false, error: '只支持已落地的本地 input/output 文件' });
    }

    const safeSubdir = sanitizeOutputPart(subdir || 'batch', 'batch');
    const targetDir = path.join(config.OUTPUT_DIR, safeSubdir);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const safeName = ensureUniqueFile(targetDir, filename || path.basename(src), Boolean(overwrite));
    const target = path.join(targetDir, safeName);
    if (path.resolve(src) !== path.resolve(target) || Boolean(overwrite)) {
      fs.copyFileSync(src, target);
    }
    const stat = fs.statSync(target);
    return res.json({
      success: true,
      data: {
        filename: safeName,
        url: `/files/output/${safeSubdir}/${encodeURIComponent(safeName)}`,
        path: target,
        size: stat.size,
        exist: false,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// POST /api/files/open-output-folder — 打开 output 子目录，方便批处理完成后直接查看结果
router.post('/open-output-folder', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const resolved = resolveOutputSubdir(req.body?.subdir || 'batch');
    if (!resolved) {
      return res.status(400).json({ success: false, error: '输出目录不合法' });
    }
    const { safeSubdir, targetDir } = resolved;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const dryRun = Boolean(req.body?.dryRun) || process.env.T8PC_OPEN_FOLDER_DRY_RUN === '1';
    if (!dryRun) await spawnOpenFolder(targetDir);
    return res.json({
      success: true,
      data: {
        subdir: safeSubdir,
        path: targetDir,
        url: `/files/output/${encodeURIComponent(safeSubdir)}`,
        opened: !dryRun,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

function resolveOpenLocalTarget(targetPath, selectFile = false) {
  const raw = String(targetPath || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    throw new Error('本地目录路径必须是绝对路径');
  }
  const resolved = path.resolve(raw);
  const stat = fs.statSync(resolved);
  const isFile = stat.isFile();
  return {
    path: isFile ? path.dirname(resolved) : resolved,
    targetPath: resolved,
    selectFile: Boolean(selectFile && isFile),
  };
}

// POST /api/files/open-local-path — 打开最近一次真实保存目录（用于原素材目录 sidecar）
router.post('/open-local-path', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const target = resolveOpenLocalTarget(req.body?.path || req.body?.targetPath, req.body?.selectFile === true);
    const dryRun = Boolean(req.body?.dryRun) || process.env.T8PC_OPEN_FOLDER_DRY_RUN === '1';
    if (!dryRun) await spawnOpenFolder(target.path, target.selectFile ? { selectPath: target.targetPath } : {});
    return res.json({
      success: true,
      data: {
        path: target.path,
        targetPath: target.targetPath,
        selectFile: target.selectFile,
        opened: !dryRun,
      },
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e?.message || String(e) });
  }
});

function fileSaveError(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message), { code, status, ...details });
}

function fileSaveOptions() {
  return {
    maxBytes: boundedFileBytes(
      FILE_SAVE_TEST_OPTIONS.maxBytes ?? config.FILE_SAVE_MAX_BYTES,
      DEFAULT_FILE_SAVE_MAX_BYTES,
    ),
    duckMaxBytes: boundedFileBytes(
      FILE_SAVE_TEST_OPTIONS.duckMaxBytes ?? config.DUCK_DECODE_MAX_BYTES,
      DEFAULT_DUCK_DECODE_MAX_BYTES,
    ),
    deadlineMs: boundedFileBytes(
      FILE_SAVE_TEST_OPTIONS.deadlineMs ?? config.FILE_SAVE_REMOTE_DEADLINE_MS,
      10 * 60 * 1000,
    ),
    idleTimeoutMs: boundedFileBytes(
      FILE_SAVE_TEST_OPTIONS.idleTimeoutMs ?? config.FILE_SAVE_REMOTE_IDLE_TIMEOUT_MS,
      30 * 1000,
    ),
    maxRedirects: Number.isSafeInteger(Number(FILE_SAVE_TEST_OPTIONS.maxRedirects))
      ? Math.max(0, Math.min(8, Number(FILE_SAVE_TEST_OPTIONS.maxRedirects)))
      : 4,
    allowPrivateForTests: FILE_SAVE_TEST_OPTIONS.allowPrivateForTests,
    lookupImpl: FILE_SAVE_TEST_OPTIONS.lookupImpl,
  };
}

function setFileSaveRouteTestOptions(options = {}) {
  for (const key of Object.keys(FILE_SAVE_TEST_OPTIONS)) delete FILE_SAVE_TEST_OPTIONS[key];
  if (!options || typeof options !== 'object') return;
  for (const key of [
    'maxBytes',
    'duckMaxBytes',
    'deadlineMs',
    'idleTimeoutMs',
    'maxRedirects',
    'allowPrivateForTests',
    'lookupImpl',
  ]) {
    if (Object.hasOwn(options, key)) FILE_SAVE_TEST_OPTIONS[key] = options[key];
  }
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  if (typeof left.dev === 'number' && typeof right.dev === 'number'
    && typeof left.ino === 'number' && typeof right.ino === 'number') {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function decodeMountedSegment(encoded) {
  if (!encoded || /%(?:2f|5c)/i.test(encoded)) {
    throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(encoded).normalize('NFKC');
  } catch (_) {
    throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
  }
  // A still-encoded octet after one decode makes the path interpretation
  // ambiguous (for example %252e%252e). Fail closed instead of decoding twice.
  if (/%[0-9a-f]{2}/i.test(decoded)
    || !decoded
    || decoded === '.'
    || decoded === '..'
    || /[\\/\0:\u0000-\u001f\u007f]/.test(decoded)) {
    throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
  }
  return decoded;
}

function parseMountedFileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const pathname = raw.split(/[?#]/, 1)[0];
  const mounts = [
    { prefix: '/files/output/', root: config.OUTPUT_DIR },
    { prefix: '/files/input/', root: config.INPUT_DIR },
  ];
  const mount = mounts.find((candidate) => pathname.startsWith(candidate.prefix));
  if (!mount) return null;
  const encodedSegments = pathname.slice(mount.prefix.length).split('/');
  if (!encodedSegments.length || encodedSegments.some((segment) => !segment)) {
    throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
  }
  return {
    root: mount.root,
    segments: encodedSegments.map(decodeMountedSegment),
  };
}

function mountedSourceSaveName(segments) {
  const cleanSegments = Array.isArray(segments) ? segments.filter(Boolean) : [];
  if (cleanSegments.length <= 1) return cleanSegments[0] || '';
  const leaf = cleanSegments.at(-1);
  const extension = path.extname(leaf);
  const leafStem = path.basename(leaf, extension);
  return `${[...cleanSegments.slice(0, -1), leafStem].join('_')}${extension}`;
}

async function ensureSafeSaveDirectory(rawSavePath) {
  const raw = String(rawSavePath || '').trim();
  if (!raw || raw.includes('\0') || !path.isAbsolute(raw)) {
    throw fileSaveError('save_directory_unavailable', '文件自动保存目录不可用', 400);
  }
  const resolved = path.resolve(raw);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  try {
    const rootStat = await fs.promises.lstat(current);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw fileSaveError('save_directory_unsafe', '文件自动保存目录不安全', 400);
    }
    const relative = path.relative(current, resolved);
    const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
    for (const segment of segments) {
      current = path.join(current, segment);
      let stat;
      try {
        stat = await fs.promises.lstat(current);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        try {
          await fs.promises.mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          if (mkdirError?.code !== 'EEXIST') throw mkdirError;
        }
        stat = await fs.promises.lstat(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw fileSaveError('save_directory_unsafe', '文件自动保存目录不安全', 400);
      }
    }
    return await fs.promises.realpath(resolved);
  } catch (error) {
    if (error?.status) throw error;
    throw fileSaveError('save_directory_unavailable', '文件自动保存目录不可用', 400);
  }
}

async function openMountedLocalSource(value, maxBytes) {
  const parsed = parseMountedFileUrl(value);
  if (!parsed) return null;
  const root = path.resolve(String(parsed.root || ''));
  let handle = null;
  try {
    const rootStat = await fs.promises.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
    }
    const realRoot = await fs.promises.realpath(root);
    let current = root;
    let lastStat = null;
    for (let index = 0; index < parsed.segments.length; index += 1) {
      current = path.join(current, parsed.segments[index]);
      try {
        lastStat = await fs.promises.lstat(current);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw fileSaveError('local_source_not_found', '本地素材不存在', 404);
        }
        throw error;
      }
      const isLast = index === parsed.segments.length - 1;
      if (lastStat.isSymbolicLink()
        || (isLast ? !lastStat.isFile() : !lastStat.isDirectory())) {
        throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
      }
    }
    const absolute = path.resolve(root, ...parsed.segments);
    if (!pathIsInside(root, absolute)) {
      throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
    }
    const realSource = await fs.promises.realpath(absolute);
    if (!pathIsInside(realRoot, realSource)) {
      throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
    }
    handle = await fs.promises.open(absolute, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || !sameFileIdentity(lastStat, stat)) {
      throw fileSaveError('unsafe_local_source', '本地素材地址不安全', 400);
    }
    if (stat.size <= 0) throw fileSaveError('unsupported_media', '素材不是允许的媒体文件', 415);
    if (stat.size > maxBytes) throw fileSaveError('media_too_large', '素材超过允许大小', 413);
    return {
      handle,
      stat,
      // Preserve mounted path context so ParseHub outputs such as
      // parsehub/<title>/0.mp4 do not all collapse to the same 0.mp4 target.
      sourceName: mountedSourceSaveName(parsed.segments),
    };
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
    if (error?.status) throw error;
    throw fileSaveError('unsafe_local_source', '本地素材不可读取', 400);
  }
}

function mediaType(kind, mime, extension, extensions = []) {
  return {
    kind,
    mime,
    extension,
    extensions: new Set([extension, ...extensions].map((item) => String(item).toLowerCase())),
  };
}

function bufferHas(buffer, signature, offset = 0) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= offset + signature.length
    && buffer.subarray(offset, offset + signature.length).equals(signature);
}

function detectSavedMediaType(buffer) {
  if(require('../providers/providerOutputFormats').isSvgBuffer(buffer))return mediaType('image','image/svg+xml','svg');
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return null;
  if (bufferHas(buffer, Buffer.from('89504e470d0a1a0a', 'hex'))) return mediaType('image', 'image/png', 'png');
  if (bufferHas(buffer, Buffer.from('ffd8ff', 'hex'))) return mediaType('image', 'image/jpeg', 'jpg', ['jpeg']);
  if (bufferHas(buffer, Buffer.from('GIF87a')) || bufferHas(buffer, Buffer.from('GIF89a'))) return mediaType('image', 'image/gif', 'gif');
  if (bufferHas(buffer, Buffer.from('BM'))) return mediaType('image', 'image/bmp', 'bmp');
  if (bufferHas(buffer, Buffer.from('49492a00', 'hex')) || bufferHas(buffer, Buffer.from('4d4d002a', 'hex'))) {
    return mediaType('image', 'image/tiff', 'tiff', ['tif']);
  }
  if (bufferHas(buffer, Buffer.from('RIFF')) && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return mediaType('image', 'image/webp', 'webp');
  }
  if (bufferHas(buffer, Buffer.from('RIFF')) && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return mediaType('audio', 'audio/wav', 'wav', ['wave']);
  }
  if (bufferHas(buffer, Buffer.from('RIFF')) && buffer.subarray(8, 12).toString('ascii') === 'AVI ') {
    return mediaType('video', 'video/x-msvideo', 'avi');
  }
  if (bufferHas(buffer, Buffer.from('OggS'))) return mediaType('audio', 'audio/ogg', 'ogg', ['oga', 'opus']);
  if (bufferHas(buffer, Buffer.from('fLaC'))) return mediaType('audio', 'audio/flac', 'flac');
  if (bufferHas(buffer, Buffer.from([
    0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
    0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
  ]))) return mediaType('audio', 'audio/x-ms-wma', 'wma');
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return mediaType('audio', 'audio/aac', 'aac');
  }
  if (bufferHas(buffer, Buffer.from('ID3'))
    || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return mediaType('audio', 'audio/mpeg', 'mp3', ['mpga']);
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) {
      return mediaType('image', 'image/avif', 'avif', ['heic', 'heif']);
    }
    if (['m4a ', 'm4b ', 'm4p '].includes(brand)) {
      return mediaType('audio', 'audio/mp4', 'm4a', ['m4b', 'mp4']);
    }
    const isoPrefix = buffer.toString('latin1').toLowerCase();
    if (isoPrefix.includes('soun') && !isoPrefix.includes('vide')) {
      return mediaType('audio', 'audio/mp4', 'm4a', ['mp4']);
    }
    if (brand === 'qt  ') return mediaType('video', 'video/quicktime', 'mov', ['qt']);
    return mediaType('video', 'video/mp4', 'mp4', ['m4v']);
  }
  if (bufferHas(buffer, Buffer.from('1a45dfa3', 'hex'))) {
    const ebmlPrefix = buffer.toString('latin1').toLowerCase();
    if (ebmlPrefix.includes('matroska')) return mediaType('video', 'video/x-matroska', 'mkv');
    return mediaType('video', 'video/webm', 'webm');
  }
  return null;
}

const CONTENT_TYPE_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['audio/mp3', 'audio/mpeg'],
  ['audio/x-wav', 'audio/wav'],
  ['audio/wave', 'audio/wav'],
  ['application/ogg', 'audio/ogg'],
  ['audio/x-m4a', 'audio/mp4'],
  ['video/x-m4v', 'video/mp4'],
]);

function normalizedMediaContentType(value) {
  const normalized = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return CONTENT_TYPE_ALIASES.get(normalized) || normalized;
}

async function readFilePrefix(handle, size) {
  const length = Math.min(Number(size) || 0, FILE_MEDIA_PREFIX_BYTES);
  const prefix = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(prefix, offset, length - offset, offset);
    if (!result.bytesRead) break;
    offset += result.bytesRead;
  }
  return offset === prefix.length ? prefix : prefix.subarray(0, offset);
}

async function validateSavedMedia(handle, stat, contentType, expectedKind) {
  const prefix = await readFilePrefix(handle, stat.size);
  const detected = detectSavedMediaType(prefix);
  if (!detected) throw fileSaveError('unsupported_media', '素材不是允许的媒体文件', 415);
  const requestedKind = String(expectedKind || '').trim().toLowerCase();
  if (requestedKind && !['image', 'video', 'audio'].includes(requestedKind)) {
    throw fileSaveError('unsupported_media_kind', '素材类型不受支持', 400);
  }
  if (requestedKind && requestedKind !== detected.kind) {
    throw fileSaveError('media_kind_mismatch', '素材类型与文件内容不一致', 415);
  }
  const declared = normalizedMediaContentType(contentType);
  if (declared && declared !== 'application/octet-stream' && declared !== 'binary/octet-stream') {
    const declaredKind = declared.split('/', 1)[0];
    if (!['image', 'video', 'audio'].includes(declaredKind)
      || declaredKind !== detected.kind
      || declared !== detected.mime) {
      throw fileSaveError('media_type_mismatch', '素材 Content-Type 与文件内容不一致', 415);
    }
  }
  return detected;
}

function inferredRemoteFilename(value) {
  try {
    const target = new URL(String(value || ''));
    const encoded = target.pathname.split('/').filter(Boolean).at(-1) || '';
    if (!encoded) return '';
    const decoded = decodeURIComponent(encoded).normalize('NFKC');
    return /%[0-9a-f]{2}/i.test(decoded) ? '' : decoded;
  } catch (_) {
    return '';
  }
}

function safeSavedFilename(requested, fallbackName, detected) {
  const raw = typeof requested === 'string' && requested.trim() ? requested : fallbackName;
  let leaf = String(raw || '').normalize('NFKC').split(/[\\/]/).at(-1) || '';
  leaf = leaf.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/[. ]+$/g, '').trim();
  const parsed = path.parse(leaf);
  let stem = String(parsed.name || '')
    .replace(/[^\p{L}\p{N}._()\[\] -]+/gu, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!stem || stem === '.' || stem === '..') stem = `out_${Date.now()}`;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`;
  const requestedExt = String(parsed.ext || '').slice(1).toLowerCase();
  const extension = detected.extensions.has(requestedExt) ? requestedExt : detected.extension;
  const maximumStemLength = Math.max(16, 180 - extension.length - 1);
  stem = stem.slice(0, maximumStemLength).replace(/[. ]+$/g, '') || `out_${Date.now()}`;
  return `${stem}.${extension}`;
}

async function existingSafeTarget(target) {
  try {
    const stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw fileSaveError('save_target_unsafe', '自动保存目标不安全', 409);
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeOwnedTarget(target, identity) {
  try {
    const current = await fs.promises.lstat(target);
    if (!current.isSymbolicLink() && sameFileIdentity(current, identity)) {
      await fs.promises.unlink(target);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeWholeFileChunk(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const result = await handle.write(chunk, offset, chunk.length - offset, null);
    if (!result.bytesWritten) throw fileSaveError('save_write_failed', '自动保存文件写入失败', 500);
    offset += result.bytesWritten;
  }
}

async function copyHandleExclusive(sourceHandle, sourceStat, target, maxBytes) {
  let targetHandle = null;
  let targetIdentity = null;
  try {
    targetHandle = await fs.promises.open(target, 'wx', 0o600);
    targetIdentity = await targetHandle.stat();
    await targetHandle.chmod(0o600);
    const buffer = Buffer.allocUnsafe(FILE_COPY_CHUNK_BYTES);
    let offset = 0;
    while (true) {
      const result = await sourceHandle.read(buffer, 0, buffer.length, offset);
      if (!result.bytesRead) break;
      if (offset + result.bytesRead > maxBytes || offset + result.bytesRead > sourceStat.size) {
        throw fileSaveError('media_changed', '素材在保存过程中发生变化', 409);
      }
      await writeWholeFileChunk(targetHandle, buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
    }
    if (offset !== sourceStat.size) {
      throw fileSaveError('media_changed', '素材在保存过程中发生变化', 409);
    }
    await targetHandle.sync();
    await targetHandle.close();
    targetHandle = null;
    return offset;
  } catch (error) {
    if (targetHandle) {
      try { await targetHandle.close(); } catch (_) {}
    }
    if (targetIdentity) {
      try { await removeOwnedTarget(target, targetIdentity); } catch (_) {}
    }
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw fileSaveError('save_target_exists', '自动保存目标已存在', 409);
    }
    if (error?.status) throw error;
    throw fileSaveError('save_write_failed', '自动保存文件写入失败', 500);
  }
}

function readConfiguredSavePath() {
  let savePath = config.DEFAULT_LOCAL_SAVE_DIR;
  try {
    if (fs.existsSync(config.SETTINGS_FILE)) {
      const settings = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8'));
      if (typeof settings?.fileSavePath === 'string' && settings.fileSavePath.trim()) {
        savePath = settings.fileSavePath.trim();
      }
    }
  } catch (_) {
    // A malformed optional settings file falls back to the configured default.
  }
  if (!savePath) throw fileSaveError('save_directory_unavailable', '未配置文件自动保存目录', 400);
  return savePath;
}

function targetForSavedMedia(saveDirectory, requestedFilename, fallbackName, detected) {
  const filename = safeSavedFilename(requestedFilename, fallbackName, detected);
  const target = path.resolve(saveDirectory, filename);
  if (!pathIsInside(saveDirectory, target)) {
    throw fileSaveError('save_target_unsafe', '自动保存目标不安全', 400);
  }
  return { filename, target };
}

function publicRemoteSaveError(error) {
  const mappings = {
    invalid_url: ['remote_url_invalid', '远程素材地址无效', 400],
    invalid_protocol: ['remote_url_invalid', '远程素材地址无效', 400],
    url_credentials_forbidden: ['remote_url_invalid', '远程素材地址无效', 400],
    private_address: ['remote_address_forbidden', '远程素材地址不允许访问', 400],
    item_too_large: ['media_too_large', '素材超过允许大小', 413],
    fetch_timeout: ['remote_timeout', '远程素材下载超时', 504],
    too_many_redirects: ['remote_redirect_rejected', '远程素材重定向不安全', 502],
    invalid_redirect: ['remote_redirect_rejected', '远程素材重定向不安全', 502],
    remote_http_error: ['remote_http_error', '远程素材下载失败', 502],
    remote_response_aborted: ['remote_body_incomplete', '远程素材响应不完整', 502],
    download_target_exists: ['save_target_exists', '自动保存目标已存在', 409],
    download_target_open_failed: ['save_write_failed', '自动保存文件写入失败', 500],
    download_write_failed: ['save_write_failed', '自动保存文件写入失败', 500],
  };
  const mapped = mappings[error?.code];
  if (mapped) return fileSaveError(mapped[0], mapped[1], mapped[2]);
  return fileSaveError('remote_download_failed', '远程素材下载失败', 502);
}

function sendFileSaveError(res, error) {
  const status = Number(error?.status);
  return res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500).json({
    success: false,
    code: typeof error?.code === 'string' ? error.code : 'file_save_failed',
    error: error?.status ? error.message : '文件自动保存失败',
  });
}

async function saveMountedMediaToDisk(source, saveDirectory, requestedFilename, expectedKind, maxBytes) {
  try {
    const detected = await validateSavedMedia(source.handle, source.stat, '', expectedKind);
    const { filename, target } = targetForSavedMedia(
      saveDirectory,
      requestedFilename,
      source.sourceName,
      detected,
    );
    if (await existingSafeTarget(target)) {
      return { path: target, filename, exist: true, source: 'copy', size: source.stat.size };
    }
    try {
      await copyHandleExclusive(source.handle, source.stat, target, maxBytes);
    } catch (error) {
      if (error?.code === 'save_target_exists' && await existingSafeTarget(target)) {
        return { path: target, filename, exist: true, source: 'copy', size: source.stat.size };
      }
      throw error;
    }
    return {
      path: target,
      filename,
      exist: false,
      source: 'copy',
      size: source.stat.size,
      kind: detected.kind,
      mime: detected.mime,
    };
  } finally {
    try { await source.handle.close(); } catch (_) {}
  }
}

async function saveRemoteMediaToDisk(url, saveDirectory, requestedFilename, expectedKind, options) {
  const staging = path.join(saveDirectory, `.t8-save-${crypto.randomUUID()}.part`);
  let handle = null;
  try {
    let remote;
    try {
      remote = await safeRemoteMediaDownload(url, staging, {
        protocols: ['http:', 'https:'],
        maxBytes: options.maxBytes,
        maxRedirects: options.maxRedirects,
        deadlineMs: options.deadlineMs,
        idleTimeoutMs: options.idleTimeoutMs,
        accept: 'image/*,video/*,audio/*,application/octet-stream;q=0.5',
        userAgent: 'T8-PenguinCanvas-FileSave/1.0',
        ...(options.allowPrivateForTests === undefined
          ? {}
          : { allowPrivateForTests: options.allowPrivateForTests }),
        ...(typeof options.lookupImpl === 'function' ? { lookupImpl: options.lookupImpl } : {}),
      });
    } catch (error) {
      throw publicRemoteSaveError(error);
    }
    handle = await fs.promises.open(staging, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== remote.byteSize || stat.size <= 0) {
      throw fileSaveError('remote_body_invalid', '远程素材响应无效', 502);
    }
    const detected = await validateSavedMedia(handle, stat, remote.contentType, expectedKind);
    const { filename, target } = targetForSavedMedia(
      saveDirectory,
      requestedFilename,
      inferredRemoteFilename(url),
      detected,
    );
    if (await existingSafeTarget(target)) {
      return { path: target, filename, exist: true, source: 'fetch', size: stat.size };
    }
    try {
      await copyHandleExclusive(handle, stat, target, options.maxBytes);
    } catch (error) {
      if (error?.code === 'save_target_exists' && await existingSafeTarget(target)) {
        return { path: target, filename, exist: true, source: 'fetch', size: stat.size };
      }
      throw error;
    }
    return {
      path: target,
      filename,
      exist: false,
      source: 'fetch',
      size: stat.size,
      kind: detected.kind,
      mime: detected.mime,
    };
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
    try { await fs.promises.rm(staging, { force: true }); } catch (_) {}
  }
}

// v1.2.10.2: 全局生成素材自动保存到本地路径。
// 本地 URL 只接受真实位于 input/output mount 内且不经过符号链接/目录联接的媒体；
// 远端 URL 使用 DNS 固定、逐跳重验和有界流式下载。目标始终 exclusive 创建且不覆盖。
router.post('/save-to-disk', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { url, filename, kind } = req.body || {};
    if (!url || typeof url !== 'string') {
      throw fileSaveError('missing_url', '缺少素材地址', 400);
    }
    const options = fileSaveOptions();
    const localDescriptor = parseMountedFileUrl(url);
    const isRemote = /^https?:\/\//i.test(url.trim());
    if (!localDescriptor && !isRemote) {
      throw fileSaveError('unsupported_url', '不支持的素材地址', 400);
    }
    const saveDirectory = await ensureSafeSaveDirectory(readConfiguredSavePath());
    const localSource = localDescriptor ? await openMountedLocalSource(url, options.maxBytes) : null;
    const data = localSource
      ? await saveMountedMediaToDisk(localSource, saveDirectory, filename, kind, options.maxBytes)
      : await saveRemoteMediaToDisk(url.trim(), saveDirectory, filename, kind, options);
    return res.json({ success: true, data });
  } catch (error) {
    return sendFileSaveError(res, error);
  }
});

module.exports = router;
Object.defineProperties(module.exports, {
  assetIndexer: {
    configurable: true,
    enumerable: true,
    get: getFilesAssetIndexer,
  },
  previewPipeline: {
    configurable: true,
    enumerable: true,
    get: getFilesPreviewPipeline,
  },
});
module.exports.importLocalFile = importLocalFile;
module.exports.resolveOpenLocalTarget = resolveOpenLocalTarget;
module.exports.resolveOpenLocalDirectory = (targetPath) => resolveOpenLocalTarget(targetPath).path;
module.exports._test = {
  compatibleVideoPreviewCacheFile,
  detectSavedMediaType,
  ensureCompatibleVideoPreviewFile,
  openMountedLocalSource,
  parseMountedFileUrl,
  resolveCompatibleVideoPreviewFfmpeg,
  runCompatibleVideoPreviewFfmpeg,
  safeSavedFilename,
  setFileSaveRouteTestOptions,
  validateSavedMedia,
};
