const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const config = require('../config');
const { hasMediaIdentity, matchesMediaIdentity, parseProjectAssetMediaUrl } = require('../services/assetMediaIdentity');
const { openVerifiedAssetMedia } = require('../services/assetAvailability');

const DEFAULT_BASE_URL = `http://127.0.0.1:${config.PORT}`;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function isDataUrl(value) {
  return /^data:[^;,]+;base64,/i.test(String(value || '').trim());
}

function parseDataUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mime: match[1] || 'application/octet-stream',
    base64: match[2] || '',
    dataUrl: text,
  };
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isT8RelativeUrl(value) {
  return /^\/(?:files|api\/resources|api\/project-assets|api\/files|input|output)\//.test(String(value || '').trim());
}

function isT8LocalMediaPath(value) {
  const pathname = String(value || '').trim().split(/[?#]/)[0];
  return /^\/(?:files\/(?:input|output|thumbnails)\/|input\/|output\/|api\/resources\/(?:file|set-file)\/|api\/project-assets\/[^/?#]+\/media(?:[/?#]|$))/.test(pathname);
}

function normalizeT8LocalMediaRef(value, options = {}) {
  const text = String(value || '').trim();
  if (!isRemoteUrl(text)) return text;
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password || !isT8LocalMediaPath(parsed.pathname)) return text;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    if (!isLoopback) return text;
    const allowedPorts = Array.isArray(options.allowedPorts)
      ? new Set(options.allowedPorts.map((port) => String(port || '').trim()).filter(Boolean))
      : null;
    if (allowedPorts?.size && parsed.port && !allowedPorts.has(parsed.port)) return text;
    return `${parsed.pathname}${parsed.search || ''}`;
  } catch {
    return text;
  }
}

function mediaRefToAbsoluteUrl(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (isDataUrl(text) || isRemoteUrl(text)) return text;
  if (isT8RelativeUrl(text)) return `${cleanBaseUrl(options.baseUrl)}${text}`;
  return text;
}

function safeJoinInside(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return '';
  return target;
}

function decodeUrlPathPart(value) {
  try {
    return decodeURIComponent(String(value || '').replace(/^\/+/, ''));
  } catch {
    return String(value || '').replace(/^\/+/, '');
  }
}

function readSettingsResourceLibraryPath() {
  try {
    if (!fs.existsSync(config.SETTINGS_FILE)) return '';
    const settings = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
    return String(settings.resourceLibraryPath || '').trim();
  } catch {
    return '';
  }
}

function resourceLibraryRoot(options = {}) {
  return String(
    options.resourceLibraryPath
    || readSettingsResourceLibraryPath()
    || config.DEFAULT_RESOURCE_LIBRARY_DIR
    || '',
  ).trim();
}

function readResourceLibraryDb(root) {
  if (!root) return null;
  try {
    const file = path.join(root, 'resource_library.json');
    if (!fs.existsSync(file)) return null;
    const db = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return db && typeof db === 'object' ? db : null;
  } catch {
    return null;
  }
}

function findResourceItem(db, id) {
  const cleanId = String(id || '').trim();
  if (!cleanId || !Array.isArray(db?.items)) return null;
  return db.items.find((item) => String(item?.id || '') === cleanId) || null;
}

function resourceEntryMime(entry, filePath) {
  const pathMime = mimeFromPath(filePath, '');
  const declaredMime = String(entry?.mime || '').trim().toLowerCase().split(';')[0];
  // Resource URLs do not carry a file extension. Prefer the persisted file's
  // extension when it is recognized, because older library rows may contain
  // an empty/application-octet-stream MIME. Providers still verify the actual
  // bytes at their upload boundary.
  return pathMime || declaredMime || 'application/octet-stream';
}

function resolveResourceLibraryMediaPath(value, options = {}) {
  const text = String(value || '').trim().split(/[?#]/)[0];
  const fileMatch = /^\/api\/resources\/file\/([^/?#]+)/.exec(text);
  const setFileMatch = /^\/api\/resources\/set-file\/([^/?#]+)\/(\d+)/.exec(text);
  if (!fileMatch && !setFileMatch) return null;

  const root = resourceLibraryRoot(options);
  const db = readResourceLibraryDb(root);
  if (!db) return null;

  if (fileMatch) {
    const item = findResourceItem(db, decodeUrlPathPart(fileMatch[1]));
    if (!item?.fileRel) return null;
    const filePath = safeJoinInside(root, item.fileRel);
    return filePath ? {
      path: filePath,
      mime: resourceEntryMime(item, filePath),
      name: String(item.originalName || item.title || path.basename(filePath)).trim(),
    } : null;
  }

  const item = findResourceItem(db, decodeUrlPathPart(setFileMatch[1]));
  const index = Number(setFileMatch[2]);
  const child = item?.kind === 'set' && Array.isArray(item.materialSetItems)
    ? item.materialSetItems[index]
    : null;
  if (!child?.fileRel) return null;
  const filePath = safeJoinInside(root, child.fileRel);
  return filePath ? {
    path: filePath,
    mime: resourceEntryMime(child, filePath),
    name: String(child.name || path.basename(filePath)).trim(),
  } : null;
}

function resolveProjectAssetMediaPath(value, options = {}) {
  const text = String(value || '').trim();
  const query = Object.fromEntries(new URLSearchParams(text.split('?')[1] || ''));
  const guarded = hasMediaIdentity(query);
  const reference = parseProjectAssetMediaUrl(guarded ? text : text.split(/[?#]/)[0]);
  if (!reference) return null;
  try {
    const { getProjectDatabase } = require('../services/projectDatabase');
    const { getAssetBlobStore } = require('../services/assetBlobStore');
    const database = options.projectDatabase || getProjectDatabase(config);
    const asset = database.getAsset(reference.assetId);
    if (!asset?.managedPath || !['linked', 'managed'].includes(asset.storageMode)) return null;
    if (reference.identity && (!matchesMediaIdentity(asset, reference.identity) || asset.availability !== 'available'
      || ['missing', 'source-changed', 'corrupt'].includes(String(asset.metadata?.health || '').toLowerCase()))) return null;

    const filename = path.resolve(asset.managedPath);
    const lexicalStat = fs.lstatSync(filename);
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) return null;
    const realFilename = fs.realpathSync.native(filename);

    if (asset.storageMode === 'managed') {
      const blobStore = options.blobStore || getAssetBlobStore(config);
      let allowed = blobStore.isBlobPath(realFilename);
      if (!allowed) {
        const managedRoots = [config.INPUT_DIR, config.OUTPUT_DIR]
          .map((root) => {
            try { return fs.realpathSync.native(path.resolve(root)); } catch (_) { return null; }
          })
          .filter(Boolean);
        allowed = managedRoots.some((root) => (
          realFilename === root || realFilename.startsWith(`${root}${path.sep}`)
        ));
      }
      if (!allowed) return null;
    }

    return {
      path: realFilename,
      mime: String(asset.mimeType || '').trim() || mimeFromPath(realFilename),
      name: String(asset.filename || path.basename(realFilename)).trim(),
      ...(reference.identity ? { frozenAsset: asset, frozenIdentity: reference.identity } : {}),
    };
  } catch {
    return null;
  }
}

function resolveT8LocalMediaPath(value, options = {}) {
  const normalized = normalizeT8LocalMediaRef(value, options);
  const text = normalized.split(/[?#]/)[0];
  const resourcePath = resolveResourceLibraryMediaPath(text, options);
  const projectAssetPath = resolveProjectAssetMediaPath(normalized, options);
  if (resourcePath?.path || projectAssetPath?.path) return resourcePath?.path || projectAssetPath.path;
  const rules = [
    ['/files/input/', config.INPUT_DIR],
    ['/input/', config.INPUT_DIR],
    ['/files/output/', config.OUTPUT_DIR],
    ['/output/', config.OUTPUT_DIR],
    ['/files/thumbnails/', config.THUMBNAILS_DIR],
  ];
  for (const [prefix, root] of rules) {
    if (text.startsWith(prefix)) {
      const relative = decodeUrlPathPart(text.slice(prefix.length));
      return safeJoinInside(root, relative);
    }
  }
  return '';
}

function mimeFromPath(filePath, fallback = 'application/octet-stream') {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return MIME_BY_EXT[ext] || fallback;
}

function filePathFromFileUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return '';
    let p = decodeURIComponent(parsed.pathname || '');
    if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    return p;
  } catch {
    return '';
  }
}

function resolveDirectLocalPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('file://')) return filePathFromFileUrl(text);
  if (path.isAbsolute(text)) return text;
  return '';
}

function assertResolvedMediaBuffer(buffer, resolved) {
  if (resolved?.expectedContentHash && crypto.createHash('sha256').update(buffer).digest('hex') !== resolved.expectedContentHash) {
    throw new Error('固定版本素材内容已变化，请重新选择历史素材');
  }
  return buffer;
}

function dataUrlFromFile(filePath, expectedContentHash) {
  const buf = fs.readFileSync(filePath);
  assertResolvedMediaBuffer(buf, { expectedContentHash });
  const mime = mimeFromPath(filePath);
  const base64 = buf.toString('base64');
  return {
    kind: 'data-url',
    dataUrl: `data:${mime};base64,${base64}`,
    base64,
    mime,
    path: filePath,
  };
}

async function resolveMediaRef(value, options = {}) {
  const target = options.target || 'url';
  const text = normalizeT8LocalMediaRef(value, options);
  if (!text) throw new Error('媒体引用为空');

  if (isDataUrl(text)) {
    const parsed = parseDataUrl(text);
    return {
      kind: 'data-url',
      source: text,
      dataUrl: parsed.dataUrl,
      base64: parsed.base64,
      mime: parsed.mime,
      url: parsed.dataUrl,
    };
  }

  const resourcePath = resolveResourceLibraryMediaPath(text, options);
  const projectAssetPath = resolveProjectAssetMediaPath(text, options);
  const guardedProjectAsset = text.startsWith('/api/project-assets/')
    && hasMediaIdentity(Object.fromEntries(new URLSearchParams(text.split('?')[1] || '')));
  if (guardedProjectAsset && !projectAssetPath?.frozenIdentity) throw new Error('固定版本素材已变化或不可用');
  if (projectAssetPath?.frozenIdentity) {
    const verified = await openVerifiedAssetMedia(projectAssetPath.frozenAsset, { filename: projectAssetPath.path });
    if (!verified) throw new Error('固定版本素材文件缺失或内容已变化');
    await verified.handle.close();
    const database = options.projectDatabase || require('../services/projectDatabase').getProjectDatabase(config);
    const current = database.getAsset(projectAssetPath.frozenAsset.id);
    if (!matchesMediaIdentity(current, projectAssetPath.frozenIdentity) || current.availability !== 'available') {
      throw new Error('固定版本素材已变化或不可用');
    }
  }
  const t8Path = resourcePath?.path || projectAssetPath?.path || resolveT8LocalMediaPath(text, options);
  const localPath = t8Path || resolveDirectLocalPath(text);

  if (target === 'local-path') {
    if (localPath && fs.existsSync(localPath)) {
      return {
        kind: 'local-path',
        source: text,
        path: localPath,
        mime: resourcePath?.mime || projectAssetPath?.mime || mimeFromPath(localPath),
        name: resourcePath?.name || projectAssetPath?.name || path.basename(localPath),
        ...(projectAssetPath?.frozenIdentity ? { expectedContentHash: projectAssetPath.frozenIdentity.contentHash } : {}),
      };
    }
    throw new Error(`无法解析本地媒体路径：${text.slice(0, 160)}`);
  }

  if (target === 'data-url' || target === 'base64') {
    if (localPath && fs.existsSync(localPath)) {
      const resolved = dataUrlFromFile(localPath, projectAssetPath?.frozenIdentity?.contentHash);
      return target === 'base64'
        ? { ...resolved, kind: 'base64', dataUrl: undefined }
        : { ...resolved, source: text };
    }
    if (isRemoteUrl(text) || isT8RelativeUrl(text)) {
      const url = mediaRefToAbsoluteUrl(text, options);
      return {
        kind: 'url',
        source: text,
        url,
      };
    }
    throw new Error(`无法转换媒体为 base64：${text.slice(0, 160)}`);
  }

  if (isRemoteUrl(text) || isT8RelativeUrl(text)) {
    return {
      kind: 'url',
      source: text,
      url: mediaRefToAbsoluteUrl(text, options),
    };
  }

  if (localPath && fs.existsSync(localPath)) {
    return {
      kind: 'local-path',
      source: text,
      path: localPath,
      mime: mimeFromPath(localPath),
      name: path.basename(localPath),
    };
  }

  throw new Error(`不支持的媒体引用：${text.slice(0, 160)}`);
}

module.exports = {
  assertResolvedMediaBuffer,
  isDataUrl,
  isT8LocalMediaPath,
  mediaRefToAbsoluteUrl,
  mimeFromPath,
  normalizeT8LocalMediaRef,
  resolveMediaRef,
  resolveProjectAssetMediaPath,
  resolveResourceLibraryMediaPath,
  resolveT8LocalMediaPath,
};
