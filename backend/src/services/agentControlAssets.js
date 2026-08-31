const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { AssetUploadManager } = require('./assetUploadManager');
const { openVerifiedAssetMedia } = require('./assetAvailability');
const {
  publicAsset,
  publicAssetLineageList,
} = require('./assetPublicView');
const { canvasPatchRequestDigest } = require('./canvasPatch');

const DEFAULT_MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MIME_BY_EXTENSION = Object.freeze({
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.webp': ['image', 'image/webp'],
  '.gif': ['image', 'image/gif'],
  '.bmp': ['image', 'image/bmp'],
  '.avif': ['image', 'image/avif'],
  '.mp4': ['video', 'video/mp4'],
  '.mov': ['video', 'video/quicktime'],
  '.webm': ['video', 'video/webm'],
  '.m4v': ['video', 'video/x-m4v'],
  '.mp3': ['audio', 'audio/mpeg'],
  '.wav': ['audio', 'audio/wav'],
  '.m4a': ['audio', 'audio/mp4'],
  '.aac': ['audio', 'audio/aac'],
  '.flac': ['audio', 'audio/flac'],
  '.glb': ['model3d', 'model/gltf-binary'],
  '.gltf': ['model3d', 'model/gltf+json'],
  '.obj': ['model3d', 'model/obj'],
  '.txt': ['text', 'text/plain'],
  '.md': ['text', 'text/markdown'],
});

class AgentControlAssetError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AgentControlAssetError';
    this.code = code;
    this.status = status;
  }
}

function hashFile(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filename);
    input.once('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

function regularFileSnapshot(filename, options = {}) {
  const absolute = path.resolve(String(filename || ''));
  if (!path.isAbsolute(String(filename || ''))) {
    throw new AgentControlAssetError('ASSET_IMPORT_PATH_INVALID', '素材导入必须使用绝对文件路径');
  }
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (_) {
    throw new AgentControlAssetError('ASSET_IMPORT_FILE_NOT_FOUND', '找不到待导入的素材文件', 404);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AgentControlAssetError('ASSET_IMPORT_FILE_INVALID', '待导入素材必须是普通文件，不能是目录或链接');
  }
  const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_IMPORT_BYTES);
  if (stat.size <= 0 || stat.size > maxBytes) {
    throw new AgentControlAssetError(
      'ASSET_IMPORT_SIZE_INVALID',
      `素材必须在 1-${maxBytes} 字节之间`,
      413,
    );
  }
  const extension = path.extname(absolute).toLowerCase();
  const media = MIME_BY_EXTENSION[extension];
  if (!media) {
    throw new AgentControlAssetError('ASSET_IMPORT_TYPE_UNSUPPORTED', '当前不支持此素材格式', 415);
  }
  return {
    absolute,
    basename: path.basename(absolute),
    extension,
    kind: media[0],
    mimeType: media[1],
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function hasPrefix(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((value, index) => buffer[offset + index] === value);
}

function verifyMagicBytes(snapshot) {
  if (snapshot.kind === 'text' || snapshot.extension === '.obj' || snapshot.extension === '.gltf') return true;
  const handle = fs.openSync(snapshot.absolute, 'r');
  const head = Buffer.alloc(32);
  try {
    const read = fs.readSync(handle, head, 0, head.length, 0);
    const bytes = head.subarray(0, read);
    if (snapshot.extension === '.png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (['.jpg', '.jpeg'].includes(snapshot.extension)) return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    if (snapshot.extension === '.gif') return bytes.subarray(0, 4).toString('ascii') === 'GIF8';
    if (snapshot.extension === '.bmp') return bytes.subarray(0, 2).toString('ascii') === 'BM';
    if (snapshot.extension === '.webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (['.mp4', '.mov', '.m4v', '.m4a', '.avif'].includes(snapshot.extension)) {
      return bytes.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    if (snapshot.extension === '.webm') return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    if (snapshot.extension === '.wav') return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WAVE';
    if (snapshot.extension === '.flac') return bytes.subarray(0, 4).toString('ascii') === 'fLaC';
    if (snapshot.extension === '.mp3') return bytes.subarray(0, 3).toString('ascii') === 'ID3'
      || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    if (snapshot.extension === '.aac') return bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0;
    if (snapshot.extension === '.glb') return bytes.subarray(0, 4).toString('ascii') === 'glTF';
    return true;
  } finally {
    fs.closeSync(handle);
  }
}

async function inspectImportFile(filename, options = {}) {
  const snapshot = regularFileSnapshot(filename, options);
  if (!verifyMagicBytes(snapshot)) {
    throw new AgentControlAssetError(
      'ASSET_IMPORT_MIME_MISMATCH',
      '文件扩展名与实际内容不一致，已停止导入',
      415,
    );
  }
  return {
    ...snapshot,
    sha256: await hashFile(snapshot.absolute),
  };
}

function publicImportPreview(snapshot, scope = {}) {
  return {
    summary: `导入 ${snapshot.basename}`,
    riskLevel: 'L2',
    currentRevision: Number(scope.canvasRevision) || null,
    projectId: String(scope.projectId || ''),
    canvasId: String(scope.canvasId || ''),
    file: {
      name: snapshot.basename,
      kind: snapshot.kind,
      mimeType: snapshot.mimeType,
      size: snapshot.size,
      sha256: snapshot.sha256,
    },
    destination: '当前项目素材中心',
    providerTransfer: {
      occursNow: false,
      scope: 'none',
      message: '本次只复制到当前项目素材中心，不会发送给任何 AI Provider。',
    },
    changes: [{
      type: 'asset.import',
      targetType: 'asset',
      targetId: snapshot.basename,
      fields: ['file', 'project', 'lineage'],
    }],
    warnings: [
      '批准只覆盖以上文件哈希；文件内容、大小或类型变化后必须重新预览。',
    ],
  };
}

function assertSameSnapshot(expected, actual) {
  if (expected.absolute !== actual.absolute
    || expected.size !== actual.size
    || expected.sha256 !== actual.sha256
    || expected.kind !== actual.kind
    || expected.mimeType !== actual.mimeType) {
    throw new AgentControlAssetError(
      'ASSET_IMPORT_FILE_CHANGED',
      '素材在批准后发生变化，未导入；请重新预览并确认',
      409,
    );
  }
}

function inspectDownloadTarget(target) {
  const raw = String(target || '');
  if (!path.isAbsolute(raw)) {
    throw new AgentControlAssetError('ASSET_DOWNLOAD_PATH_INVALID', '素材下载必须使用绝对目标路径');
  }
  const absolute = path.resolve(raw);
  let current = path.dirname(absolute);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new AgentControlAssetError('ASSET_DOWNLOAD_PATH_SYMLINK', '目标目录包含链接，已停止下载');
      }
      if (!stat.isDirectory()) {
        throw new AgentControlAssetError('ASSET_DOWNLOAD_PARENT_INVALID', '目标路径的上级不是文件夹');
      }
    }
    current = path.dirname(current);
  }
  if (fs.existsSync(absolute)) {
    throw new AgentControlAssetError('ASSET_DOWNLOAD_TARGET_EXISTS', '目标文件已存在，未覆盖', 409);
  }
  return {
    absolute,
    basename: path.basename(absolute),
  };
}

function publicDownloadPreview(asset, target, scope = {}) {
  return {
    summary: `导出 ${target.basename}`,
    riskLevel: 'L2',
    currentRevision: Number(scope.canvasRevision) || null,
    projectId: String(scope.projectId || ''),
    canvasId: String(scope.canvasId || ''),
    file: {
      name: target.basename,
      kind: String(asset.kind || ''),
      mimeType: String(asset.mimeType || ''),
      size: Math.max(0, Number(asset.sizeBytes || asset.size) || 0),
      sha256: String(asset.contentHash || '').toLowerCase(),
    },
    assetId: String(asset.id || ''),
    destination: `你选择的本机目录 / ${target.basename}`,
    providerTransfer: {
      occursNow: false,
      scope: 'none',
      message: '本次只把素材原件复制到你选择的本机目录，不会发送给任何 AI Provider。',
    },
    changes: [{
      type: 'asset.download',
      targetType: 'file',
      targetId: target.basename,
      fields: ['assetId', 'contentHash', 'destination'],
    }],
    warnings: [
      '不会覆盖已有文件；目标目录或素材原件在批准后变化时会停止导出。',
    ],
  };
}

function stableAssetPlacementDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedPosition(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(-1_000_000, Math.min(1_000_000, Math.round(number)));
}

async function readVerifiedTextAsset(asset, maxBytes = 2 * 1024 * 1024) {
  const size = Math.max(0, Number(asset?.sizeBytes || asset?.size) || 0);
  if (size > maxBytes) {
    throw new AgentControlAssetError(
      'ASSET_PLACE_TEXT_TOO_LARGE',
      '文本素材超过 ' + maxBytes + ' 字节，不能直接放入文本节点',
      413,
    );
  }
  const verified = await openVerifiedAssetMedia(asset);
  if (!verified) {
    throw new AgentControlAssetError('ASSET_MEDIA_UNAVAILABLE', '素材原件缺失或哈希校验失败', 409);
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of verified.handle.createReadStream()) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new AgentControlAssetError(
          'ASSET_PLACE_TEXT_TOO_LARGE',
          '文本素材超过 ' + maxBytes + ' 字节，不能直接放入文本节点',
          413,
        );
      }
      chunks.push(chunk);
    }
  } finally {
    try { await verified.handle.close(); } catch (_) {}
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function verifyPlaceableAsset(asset) {
  if (asset?.kind === 'text') return readVerifiedTextAsset(asset);
  const verified = await openVerifiedAssetMedia(asset);
  if (!verified) {
    throw new AgentControlAssetError('ASSET_MEDIA_UNAVAILABLE', '素材原件缺失或哈希校验失败', 409);
  }
  try {
    return '';
  } finally {
    try { await verified.handle.close(); } catch (_) {}
  }
}

function assetPlacementPatch(asset, document, input = {}, textContent = '') {
  const kind = String(asset?.kind || '');
  if (!['image', 'video', 'audio', 'model3d', 'text'].includes(kind)) {
    throw new AgentControlAssetError('ASSET_PLACE_KIND_UNSUPPORTED', '当前素材类型不能直接放入画布', 415);
  }
  const targetNodeId = String(input.targetNodeId || '').trim();
  const targetNode = targetNodeId
    ? (document.nodes || []).find((node) => String(node?.id || '') === targetNodeId)
    : null;
  if (targetNodeId && !targetNode) {
    throw new AgentControlAssetError('ASSET_PLACE_TARGET_NOT_FOUND', '目标节点不存在，请刷新画布后重新选择', 404);
  }
  const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
  // A replay without an explicit position must resolve to the node that this
  // exact asset revision already placed. Otherwise the growing rightmost-node
  // fallback changes the placement digest on every click and defeats the
  // CanvasPatch exactly-once ledger.
  const priorPlacement = !targetNodeId && input.position == null
    ? nodes.find((node) => {
        const data = node?.data && typeof node.data === 'object' ? node.data : {};
        const bindings = Array.isArray(data.referenceBindings) ? data.referenceBindings : [];
        return String(data.sourceAssetId || '') === String(asset.id || '')
          && bindings.some((binding) => (
            String(binding?.assetId || '') === String(asset.id || '')
            && String(binding?.contentHash || '').toLowerCase() === String(asset.contentHash || '').toLowerCase()
            && Math.max(1, Number(binding?.contentRevision) || 1) === Math.max(1, Number(asset.contentRevision || asset.revision) || 1)
          ));
      })
    : null;
  const defaultX = priorPlacement
    ? Number(priorPlacement.position?.x || 0)
    : targetNode
    ? Number(targetNode.position?.x || 0) - 420
    : nodes.reduce((maximum, node) => Math.max(maximum, Number(node?.position?.x) || 0), 0) + 420;
  const defaultY = priorPlacement
    ? Number(priorPlacement.position?.y || 0)
    : targetNode
    ? Number(targetNode.position?.y || 0)
    : nodes.reduce((minimum, node) => Math.min(minimum, Number(node?.position?.y) || 0), 0);
  const position = {
    x: boundedPosition(input.position?.x, defaultX),
    y: boundedPosition(input.position?.y, defaultY),
  };
  const filename = String(asset.filename || asset.name || asset.id || '项目素材').slice(0, 240);
  const contentHash = String(asset.contentHash || '').toLowerCase();
  const contentRevision = Math.max(1, Number(asset.contentRevision || asset.revision) || 1);
  const placementScope = {
    projectId: String(document.projectId || ''),
    canvasId: String(document.canvasId || ''),
    assetId: String(asset.id || ''),
    contentHash,
    contentRevision,
    targetNodeId,
    targetHandle: String(input.targetHandle || ''),
    sourceHandle: String(input.sourceHandle || ''),
    position,
  };
  const digest = stableAssetPlacementDigest(placementScope);
  const nodeId = 'asset-place-' + digest.slice(0, 24);
  const mediaUrl = '/api/project-assets/' + encodeURIComponent(asset.id) + '/media';
  const binding = {
    assetId: String(asset.id),
    kind,
    contentHash,
    contentRevision,
  };
  const fieldPrefix = kind === 'model3d' ? 'model' : kind;
  const data = kind === 'text'
    ? {
        title: filename,
        text: textContent,
        sourceAssetId: String(asset.id),
        referenceAssetIds: [String(asset.id)],
        referenceBindings: [binding],
      }
    : {
        title: filename,
        uploadType: kind,
        [fieldPrefix + 'Url']: mediaUrl,
        [fieldPrefix + 'Urls']: [mediaUrl],
        fileName: filename,
        fileNames: [filename],
        fileSize: Math.max(0, Number(asset.sizeBytes || asset.size) || 0),
        fileSizes: [Math.max(0, Number(asset.sizeBytes || asset.size) || 0)],
        mime: String(asset.mimeType || ''),
        mimes: [String(asset.mimeType || '')],
        sourceAssetId: String(asset.id),
        referenceAssetIds: [String(asset.id)],
        referenceBindings: [binding],
      };
  const operations = [{
    type: 'node.add',
    payload: {
      node: {
        id: nodeId,
        type: kind === 'text' ? 'text' : 'upload',
        position,
        data,
      },
    },
  }];
  if (targetNode) {
    operations.push({
      type: 'edge.add',
      payload: {
        edge: {
          id: 'asset-place-edge-' + digest.slice(0, 24),
          source: nodeId,
          target: targetNodeId,
          sourceHandle: input.sourceHandle == null ? null : String(input.sourceHandle || ''),
          targetHandle: input.targetHandle == null ? null : String(input.targetHandle || ''),
        },
      },
    });
  }
  return {
    asset: {
      id: String(asset.id),
      kind,
      filename,
      contentHash,
      contentRevision,
      mimeType: String(asset.mimeType || ''),
      size: Math.max(0, Number(asset.sizeBytes || asset.size) || 0),
    },
    placement: {
      nodeId,
      nodeType: kind === 'text' ? 'text' : 'upload',
      position,
      targetNodeId: targetNodeId || null,
      sourceHandle: input.sourceHandle == null ? null : String(input.sourceHandle || ''),
      targetHandle: input.targetHandle == null ? null : String(input.targetHandle || ''),
      lineage: binding,
    },
    patch: {
      schema: 't8-canvas-patch-v1',
      id: 'asset-place-' + digest.slice(0, 32),
      baseRevision: Number(document.revision),
      summary: targetNode
        ? '把 ' + filename + ' 放入画布并连接到 ' + targetNodeId
        : '把 ' + filename + ' 放入画布',
      diagnosticsResolved: [],
      requiresConfirmation: true,
      operations,
    },
  };
}

function resolveAppliedAssetPlacement(database, canvasId, snapshot) {
  const patch = snapshot?.patch;
  if (!patch?.id) {
    throw new AgentControlAssetError(
      'ASSET_PLACE_PATCH_INVALID',
      '素材放置计划缺少稳定 Patch 身份，请刷新后重试',
      409,
    );
  }
  if (!database) return { status: 'new', patch, application: null };
  const application = typeof database.getCanvasPatchApplication === 'function'
    ? database.getCanvasPatchApplication(canvasId, patch.id, {
        includeAllActors: true,
        includeRequestDigest: true,
      })
    : typeof database.listCanvasPatches === 'function'
      ? (database.listCanvasPatches(canvasId, {
          includeAllActors: true,
          includeRequestDigest: true,
          limit: 100,
        }) || []).find((item) => String(item?.patchId || '') === patch.id)
      : null;
  if (!application) return { status: 'new', patch, application: null };

  const baseRevision = Number(application.baseRevision);
  const appliedRevision = Number(application.appliedRevision);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0
    || !Number.isSafeInteger(appliedRevision) || appliedRevision < baseRevision) {
    throw new AgentControlAssetError(
      'ASSET_PLACE_PATCH_EVIDENCE_INVALID',
      '素材放置的画布台账不完整，请重新读取画布后重试',
      409,
    );
  }
  const recoveredPatch = { ...patch, baseRevision };
  const expectedRequestDigest = canvasPatchRequestDigest(recoveredPatch);
  if (!/^[a-f0-9]{64}$/i.test(String(application.requestDigest || ''))
    || String(application.requestDigest).toLowerCase() !== expectedRequestDigest) {
    throw new AgentControlAssetError(
      'ASSET_PLACE_PATCH_CONFLICT',
      '相同素材放置身份已对应其他画布内容，已停止重复写入',
      409,
    );
  }
  if (String(application.status || '') === 'reverted') {
    throw new AgentControlAssetError(
      'ASSET_PLACE_ALREADY_REVERTED',
      '这次素材放置已经撤回；如需重新添加，请调整放置位置后重新预览',
      409,
    );
  }
  if (String(application.status || '') !== 'applied') {
    throw new AgentControlAssetError(
      'ASSET_PLACE_PATCH_EVIDENCE_INVALID',
      '素材放置台账状态无效，已停止重复写入',
      409,
    );
  }
  return {
    status: 'applied',
    patch: recoveredPatch,
    application: {
      ...application,
      requestDigest: expectedRequestDigest,
      baseRevision,
      appliedRevision,
    },
  };
}

function createAgentControlAssetService(options = {}) {
  const runtimeConfig = options.config || {};
  const database = options.database;
  const uploadManager = options.uploadManager || (
    database ? new AssetUploadManager(runtimeConfig, database, options.uploadOptions || {}) : null
  );

  async function inspectImport(filename) {
    return inspectImportFile(filename, {
      maxBytes: runtimeConfig.COLLAB_MAX_UPLOAD_BYTES || DEFAULT_MAX_IMPORT_BYTES,
    });
  }

  async function importFile(expected, context = {}) {
    if (!uploadManager) {
      throw new AgentControlAssetError('ASSET_IMPORT_UNAVAILABLE', '当前画布没有可用的素材导入服务', 503);
    }
    const actual = await inspectImport(expected.absolute);
    assertSameSnapshot(expected, actual);
    const result = await uploadManager.ingestFile(actual.absolute, {
      filename: actual.basename,
      sha256: actual.sha256,
      idempotencyKey: String(context.operationId || `agent-import-${actual.sha256}`),
      removeSource: false,
    }, {
      projectId: String(context.projectId || ''),
      canvasId: String(context.canvasId || ''),
      memberId: String(context.actorId || 'agent'),
      sessionId: String(context.sessionId || 'agent-session'),
      sourceKind: 'agent-control',
    });
    return {
      asset: publicAsset(result.asset),
      deduplicated: result.deduplicated === true,
      idempotentReplay: result.idempotentReplay === true,
      contentHash: actual.sha256,
    };
  }

  function search(input = {}) {
    if (!database) throw new AgentControlAssetError('ASSET_READ_UNAVAILABLE', '素材中心不可用', 503);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(input.limit) || 25)));
    const offset = Math.max(0, Math.trunc(Number(input.offset) || 0));
    const filters = {
      projectId: input.projectId,
      kind: input.kind,
      query: input.query,
      limit,
      offset,
    };
    return {
      items: database.listAssets(filters).map(publicAsset),
      total: database.countAssets(filters),
      limit,
      offset,
      catalogRevision: database.getAssetCatalogRevision(input.projectId),
    };
  }

  function internalAsset(assetId, projectId) {
    if (!database) throw new AgentControlAssetError('ASSET_READ_UNAVAILABLE', '素材中心不可用', 503);
    const asset = database.getAsset(String(assetId || ''));
    if (!asset || String(asset.projectId || '') !== String(projectId || '')) {
      throw new AgentControlAssetError('ASSET_NOT_FOUND', '素材不存在或不属于当前项目', 404);
    }
    return asset;
  }

  function inspect(assetId, projectId) {
    return publicAsset(internalAsset(assetId, projectId));
  }

  async function inspectPlace(assetId, document, input = {}) {
    if (!document || String(document.projectId || '') !== String(input.projectId || document?.projectId || '')) {
      throw new AgentControlAssetError('ASSET_PLACE_SCOPE_INVALID', '素材放置目标不存在或不属于当前项目', 404);
    }
    const asset = internalAsset(assetId, document.projectId);
    const textContent = await verifyPlaceableAsset(asset);
    return assetPlacementPatch(asset, document, input, textContent);
  }

  function inspectDownload(assetId, target, projectId) {
    const asset = internalAsset(assetId, projectId);
    const targetSnapshot = inspectDownloadTarget(target);
    return {
      asset: {
        id: String(asset.id || ''),
        contentHash: String(asset.contentHash || '').toLowerCase(),
      },
      target: targetSnapshot,
      preview: publicDownloadPreview(asset, targetSnapshot, { projectId }),
    };
  }

  function lineage(assetId, projectId, input = {}) {
    inspect(assetId, projectId);
    const page = database.listAssetLineage(String(assetId), {
      limit: Math.min(100, Math.max(1, Math.trunc(Number(input.limit) || 50))),
      cursor: input.cursor,
    });
    return {
      items: publicAssetLineageList(page?.items || []),
      total: Number(page?.total) || 0,
      nextCursor: page?.nextCursor || null,
      hasMore: page?.hasMore === true,
      lineageRevision: page?.lineageRevision || null,
    };
  }

  async function download(assetId, expected, context = {}) {
    const asset = internalAsset(assetId, context.projectId);
    if (String(asset.contentHash || '').toLowerCase() !== String(expected?.asset?.contentHash || '').toLowerCase()) {
      throw new AgentControlAssetError('ASSET_DOWNLOAD_SOURCE_CHANGED', '素材版本在批准后发生变化，未导出；请重新预览', 409);
    }
    const target = inspectDownloadTarget(expected?.target?.absolute);
    if (target.absolute !== expected?.target?.absolute || target.basename !== expected?.target?.basename) {
      throw new AgentControlAssetError('ASSET_DOWNLOAD_TARGET_CHANGED', '下载目标在批准后发生变化，未导出；请重新预览', 409);
    }
    const targetPath = target.absolute;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const verified = await openVerifiedAssetMedia(asset);
    if (!verified) {
      throw new AgentControlAssetError('ASSET_MEDIA_UNAVAILABLE', '素材原件缺失或哈希校验失败', 409);
    }
    const temporary = `${targetPath}.${process.pid}.${crypto.randomUUID()}.part`;
    try {
      const output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      await pipeline(verified.handle.createReadStream(), output);
      const actualHash = await hashFile(temporary);
      if (actualHash !== String(asset.contentHash || '').toLowerCase()) {
        throw new AgentControlAssetError('ASSET_DOWNLOAD_HASH_MISMATCH', '素材下载后哈希不一致，已删除临时文件', 409);
      }
      fs.renameSync(temporary, targetPath);
      return {
        assetId: String(asset.id || ''),
        filename: path.basename(targetPath),
        size: fs.statSync(targetPath).size,
        sha256: actualHash,
      };
    } finally {
      try { await verified.handle.close(); } catch (_) {}
      try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    }
  }

  return {
    download,
    importFile,
    inspect,
    inspectDownload,
    inspectImport,
    inspectPlace,
    lineage,
    search,
  };
}

module.exports = {
  AgentControlAssetError,
  MIME_BY_EXTENSION,
  assetPlacementPatch,
  createAgentControlAssetService,
  inspectImportFile,
  inspectDownloadTarget,
  publicDownloadPreview,
  resolveAppliedAssetPlacement,
  publicImportPreview,
};
