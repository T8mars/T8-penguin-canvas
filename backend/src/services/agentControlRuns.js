const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const {
  assertRunIntentAuthorityMatches,
  deriveRunIntentAuthority,
  summarizeRunIntentAuthority,
} = require('../collaboration/runIntentAuthority');

const PLAN_TTL_MS = 30 * 60 * 1000;
const PLAN_LIMIT = 64;
const ARTIFACT_PREFIX_BYTES = 64 * 1024;
const ARTIFACT_HASH_BUFFER_BYTES = 1024 * 1024;

class AgentControlRunError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AgentControlRunError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function requireRunOperationId(value) {
  const operationId = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(operationId)) {
    throw new AgentControlRunError('RUN_OPERATION_ID_INVALID', '运行 operationId 无效');
  }
  return operationId;
}

function digest(value) {
  const stable = (input) => {
    if (input === undefined || input === null) return 'null';
    if (typeof input !== 'object') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(',')}}`;
  };
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function normalizeContentHash(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function sameFileIdentity(left, right) {
  return Boolean(left && right
    && Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.mode) === Number(right.mode)
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && Number(left.ctimeMs) === Number(right.ctimeMs));
}

function startsWith(buffer, signature, offset = 0) {
  return buffer.length >= offset + signature.length
    && buffer.subarray(offset, offset + signature.length).equals(signature);
}

function normalizedMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function detectedArtifactType(prefix, declaredMimeType = '') {
  const declared = normalizedMime(declaredMimeType);
  if (startsWith(prefix, Buffer.from('89504e470d0a1a0a', 'hex'))) return { kind: 'image', mimeType: 'image/png' };
  if (startsWith(prefix, Buffer.from('ffd8ff', 'hex'))) return { kind: 'image', mimeType: 'image/jpeg' };
  if (startsWith(prefix, Buffer.from('GIF87a')) || startsWith(prefix, Buffer.from('GIF89a'))) return { kind: 'image', mimeType: 'image/gif' };
  if (startsWith(prefix, Buffer.from('BM'))) return { kind: 'image', mimeType: 'image/bmp' };
  if (startsWith(prefix, Buffer.from('49492a00', 'hex')) || startsWith(prefix, Buffer.from('4d4d002a', 'hex'))) return { kind: 'image', mimeType: 'image/tiff' };
  if (startsWith(prefix, Buffer.from('RIFF')) && prefix.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', mimeType: 'image/webp' };
  if (prefix.length >= 12 && prefix.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = prefix.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mimeType: 'image/avif' };
    if (declared === 'audio/mp4' || declared === 'audio/x-m4a') return { kind: 'audio', mimeType: 'audio/mp4' };
    if (brand === 'qt  ') return { kind: 'video', mimeType: 'video/quicktime' };
    return { kind: 'video', mimeType: 'video/mp4' };
  }
  if (startsWith(prefix, Buffer.from('1a45dfa3', 'hex'))) {
    return declared === 'video/x-matroska'
      ? { kind: 'video', mimeType: 'video/x-matroska' }
      : { kind: 'video', mimeType: 'video/webm' };
  }
  if (startsWith(prefix, Buffer.from('RIFF')) && prefix.subarray(8, 12).toString('ascii') === 'AVI ') return { kind: 'video', mimeType: 'video/x-msvideo' };
  if (startsWith(prefix, Buffer.from('RIFF')) && prefix.subarray(8, 12).toString('ascii') === 'WAVE') return { kind: 'audio', mimeType: 'audio/wav' };
  if (startsWith(prefix, Buffer.from('OggS'))) return { kind: 'audio', mimeType: 'audio/ogg' };
  if (startsWith(prefix, Buffer.from('fLaC'))) return { kind: 'audio', mimeType: 'audio/flac' };
  if (prefix.length >= 2 && prefix[0] === 0xff && [0xf1, 0xf9].includes(prefix[1])) return { kind: 'audio', mimeType: 'audio/aac' };
  if (startsWith(prefix, Buffer.from('ID3')) || (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0)) return { kind: 'audio', mimeType: 'audio/mpeg' };
  if (startsWith(prefix, Buffer.from('glTF'))) return { kind: 'model3d', mimeType: 'model/gltf-binary' };
  if (startsWith(prefix, Buffer.from('Kaydara FBX Binary'))) return { kind: 'model3d', mimeType: 'application/octet-stream' };
  if (startsWith(prefix, Buffer.from('PK\x03\x04')) && declared === 'model/vnd.usdz+zip') {
    return { kind: 'model3d', mimeType: 'model/vnd.usdz+zip' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(prefix);
    if (text.includes('\0')) return null;
    if (declared === 'model/gltf+json') return { kind: 'model3d', mimeType: 'model/gltf+json' };
    if (declared === 'model/obj') return { kind: 'model3d', mimeType: 'model/obj' };
    if (declared === 'model/stl') return { kind: 'model3d', mimeType: 'model/stl' };
    if (declared === 'text/markdown') return { kind: 'text', mimeType: 'text/markdown' };
    if (declared === 'text/csv') return { kind: 'text', mimeType: 'text/csv' };
    if (declared === 'text/vtt') return { kind: 'text', mimeType: 'text/vtt' };
    if (declared === 'application/x-subrip') return { kind: 'text', mimeType: 'application/x-subrip' };
    if (declared === 'application/json') return { kind: 'text', mimeType: 'application/json' };
    if (declared.startsWith('text/') || declared === 'application/octet-stream') {
      return { kind: 'text', mimeType: declared.startsWith('text/') ? declared : 'text/plain' };
    }
  } catch (_) {
    return null;
  }
  return null;
}

const MIME_EQUIVALENTS = Object.freeze({
  'audio/mpeg': new Set(['audio/mpeg', 'audio/mp3']),
  'audio/wav': new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
  'audio/mp4': new Set(['audio/mp4', 'audio/x-m4a']),
  'image/jpeg': new Set(['image/jpeg', 'image/jpg']),
  'model/gltf-binary': new Set(['model/gltf-binary', 'application/gltf-buffer']),
  'video/mp4': new Set(['video/mp4', 'video/x-m4v', 'application/mp4']),
});

function mimeMatches(declared, detected) {
  const expected = normalizedMime(declared);
  const observed = normalizedMime(detected);
  if (!expected) return true;
  if (expected === observed) return true;
  return MIME_EQUIVALENTS[observed]?.has(expected) === true;
}

function readVerifiedManagedArtifact(asset) {
  const assetId = String(asset?.id || '');
  const expectedHash = normalizeContentHash(asset?.contentHash);
  const evidence = {
    blobPresent: false,
    hashVerified: false,
    magicVerified: false,
    detectedKind: null,
    detectedMimeType: null,
    observedContentHash: null,
    byteSize: null,
    width: null,
    height: null,
    duration: null,
    decodeEvidence: 'not-recorded',
  };
  if (!expectedHash) return { verified: false, reasons: [`output_asset_hash_invalid:${assetId}`], evidence };
  if (String(asset?.storageMode || '').toLowerCase() !== 'managed') {
    return { verified: false, reasons: [`output_asset_blob_uncontrolled:${assetId}`], evidence };
  }
  const managedPath = String(asset?.managedPath || '');
  if (!managedPath || !path.isAbsolute(managedPath)) {
    return { verified: false, reasons: [`output_asset_blob_missing:${assetId}`], evidence };
  }
  const absolute = path.resolve(managedPath);
  let before;
  let descriptor;
  try {
    before = fs.lstatSync(absolute);
    if (!before.isFile() || before.isSymbolicLink()) {
      return { verified: false, reasons: [`output_asset_blob_unsafe:${assetId}`], evidence };
    }
    const noFollow = Number(fs.constants.O_NOFOLLOW) || 0;
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      return { verified: false, reasons: [`output_asset_blob_changed:${assetId}`], evidence };
    }
    evidence.blobPresent = true;
    evidence.byteSize = Number(opened.size);
    if (!Number.isSafeInteger(evidence.byteSize) || evidence.byteSize <= 0) {
      return { verified: false, reasons: [`output_asset_corrupt:${assetId}`], evidence };
    }

    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(ARTIFACT_HASH_BUFFER_BYTES);
    const prefixChunks = [];
    let prefixBytes = 0;
    let position = 0;
    while (position < opened.size) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, opened.size - position),
        position,
      );
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (prefixBytes < ARTIFACT_PREFIX_BYTES) {
        const take = Math.min(chunk.length, ARTIFACT_PREFIX_BYTES - prefixBytes);
        prefixChunks.push(Buffer.from(chunk.subarray(0, take)));
        prefixBytes += take;
      }
      position += bytesRead;
    }
    const afterOpened = fs.fstatSync(descriptor);
    const after = fs.lstatSync(absolute);
    if (position !== opened.size
      || !sameFileIdentity(opened, afterOpened)
      || !sameFileIdentity(opened, after)
      || after.isSymbolicLink()) {
      return { verified: false, reasons: [`output_asset_blob_changed:${assetId}`], evidence };
    }
    const observedHash = hash.digest('hex');
    evidence.observedContentHash = observedHash;
    evidence.hashVerified = observedHash === expectedHash;
    if (!evidence.hashVerified) {
      return { verified: false, reasons: [`output_asset_hash_mismatch:${assetId}`], evidence };
    }
    const detected = detectedArtifactType(Buffer.concat(prefixChunks, prefixBytes), asset?.mimeType);
    if (!detected) return { verified: false, reasons: [`output_asset_corrupt:${assetId}`], evidence };
    evidence.detectedKind = detected.kind;
    evidence.detectedMimeType = detected.mimeType;
    const declaredKind = String(asset?.kind || '').trim().toLowerCase();
    if ((declaredKind && declaredKind !== detected.kind)
      || !mimeMatches(asset?.mimeType, detected.mimeType)) {
      return { verified: false, reasons: [`output_asset_mime_mismatch:${assetId}`], evidence };
    }
    evidence.magicVerified = true;

    const metadata = asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
      ? asset.metadata
      : {};
    evidence.width = Number.isFinite(Number(metadata.width)) && Number(metadata.width) > 0
      ? Number(metadata.width)
      : null;
    evidence.height = Number.isFinite(Number(metadata.height)) && Number(metadata.height) > 0
      ? Number(metadata.height)
      : null;
    evidence.duration = Number.isFinite(Number(metadata.duration)) && Number(metadata.duration) > 0
      ? Number(metadata.duration)
      : null;
    const health = String(metadata.health || '').trim().toLowerCase();
    if (String(asset?.availability || '').toLowerCase() === 'corrupt' || health === 'corrupt') {
      return { verified: false, reasons: [`output_asset_corrupt:${assetId}`], evidence };
    }
    const decodeFieldsPresent = detected.kind === 'image'
      ? Number(metadata.width) > 0 && Number(metadata.height) > 0
      : detected.kind === 'video'
        ? Number(metadata.streamCount) > 0 && Number(metadata.videoStreamCount) > 0
        : detected.kind === 'audio'
          ? Number(metadata.streamCount) > 0 && Number(metadata.audioStreamCount) > 0
          : health === 'ok';
    evidence.decodeEvidence = decodeFieldsPresent || health === 'ok'
      ? 'indexed-parser-verified'
      : 'magic-only-legacy';
    return { verified: true, reasons: [], evidence };
  } catch (error) {
    const code = String(error?.code || '').toUpperCase();
    const reason = ['ENOENT', 'ENOTDIR'].includes(code)
      ? `output_asset_blob_missing:${assetId}`
      : `output_asset_blob_unreadable:${assetId}`;
    return { verified: false, reasons: [reason], evidence };
  } finally {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch (_) { /* best-effort close */ }
    }
  }
}

function stringValues(...values) {
  return [...new Set(values.flatMap((value) => (
    Array.isArray(value) ? value : [value]
  )).map((value) => String(value || '').trim()).filter(Boolean))];
}

function shotIdsFromNodeRun(nodeRun) {
  const snapshot = nodeRun?.inputSnapshot && typeof nodeRun.inputSnapshot === 'object'
    ? nodeRun.inputSnapshot
    : {};
  const nodeData = snapshot?.node?.data && typeof snapshot.node.data === 'object'
    ? snapshot.node.data
    : {};
  const input = snapshot?.input && typeof snapshot.input === 'object' ? snapshot.input : {};
  return stringValues(
    snapshot.shotId,
    snapshot.shotIds,
    snapshot.storyShotId,
    nodeData.shotId,
    nodeData.shotIds,
    nodeData.storyShotId,
    input.shotId,
    input.shotIds,
    input.storyShotId,
  );
}

function verifyAssetAssociation(asset, nodeRun, latestAttempt, run, result) {
  const assetId = String(asset?.id || '');
  const provenance = asset?.provenance && typeof asset.provenance === 'object' && !Array.isArray(asset.provenance)
    ? asset.provenance
    : {};
  const metadata = asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
    ? asset.metadata
    : {};
  const reasons = [];
  const nodeId = String(nodeRun?.originalNodeId || nodeRun?.nodeId || '');
  const checks = [
    ['runId', provenance.runId, run?.id, 'run'],
    ['nodeRunId', provenance.nodeRunId, nodeRun?.id, 'node'],
    ['attemptId', provenance.attemptId, latestAttempt?.id, 'attempt'],
    ['canvasId', provenance.canvasId, result?.canvasId, 'canvas'],
    ['sourceNodeId', provenance.sourceNodeId, nodeId, 'node'],
  ];
  for (const [, actual, expected, label] of checks) {
    if (actual != null && String(actual) && expected != null && String(actual) !== String(expected)) {
      reasons.push(`output_asset_${label}_mismatch:${assetId}`);
    }
  }
  const provenanceSource = String(provenance.source || '').trim().toLowerCase();
  if (provenanceSource && !['run-output', 'node-output'].includes(provenanceSource)) {
    reasons.push(`output_asset_provenance_mismatch:${assetId}`);
  }

  const expectedRevision = Number(run?.canvasRevision ?? result?.canvasRevision);
  const actualRevisions = [
    provenance.canvasRevision,
    provenance.sourceCanvasRevision,
    metadata.canvasRevision,
    metadata.sourceCanvasRevision,
  ].filter((value) => value != null && value !== '');
  if (Number.isSafeInteger(expectedRevision)
    && actualRevisions.some((value) => Number(value) !== expectedRevision)) {
    reasons.push(`output_asset_revision_mismatch:${assetId}`);
  }

  const expectedShots = shotIdsFromNodeRun(nodeRun);
  const actualShots = stringValues(
    provenance.shotId,
    provenance.shotIds,
    provenance.storyShotId,
    metadata.shotId,
    metadata.shotIds,
    metadata.storyShotId,
  );
  if (expectedShots.length && actualShots.length
    && !actualShots.some((shotId) => expectedShots.includes(shotId))) {
    reasons.push(`output_asset_shot_mismatch:${assetId}`);
  }
  return {
    verified: reasons.length === 0,
    reasons,
    expectedNodeId: nodeId || null,
    expectedShotIds: expectedShots,
    observedShotIds: actualShots,
    expectedCanvasRevision: Number.isSafeInteger(expectedRevision) ? expectedRevision : null,
  };
}

function normalizeNodeIds(value) {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 500) throw new AgentControlRunError('RUN_SCOPE_TOO_LARGE', '单次运行范围最多包含 500 个节点');
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))].sort();
}

function publicIntent(intent) {
  if (!intent) return null;
  return {
    id: String(intent.id || ''),
    entityUid: String(intent.entityUid || ''),
    projectId: String(intent.projectId || ''),
    canvasId: String(intent.canvasId || ''),
    canvasRevision: Number(intent.canvasRevision) || 0,
    operationId: String(intent.idempotencyKey || ''),
    nodeIds: normalizeNodeIds(intent.nodeIds),
    requestedBy: String(intent.requestedBy || ''),
    provider: intent.provider || null,
    model: intent.model || null,
    status: String(intent.status || ''),
    runId: intent.runId || null,
    queueRevision: Math.max(1, Number(intent.queueRevision) || 1),
    dispatchAttempts: Math.max(0, Number(intent.dispatchAttempts) || 0),
    nextAttemptAt: Math.max(0, Number(intent.nextAttemptAt) || 0),
    leaseExpiresAt: intent.leaseExpiresAt == null ? null : Number(intent.leaseExpiresAt),
    lastHeartbeatAt: intent.lastHeartbeatAt == null ? null : Number(intent.lastHeartbeatAt),
    cancelRequestedAt: intent.cancelRequestedAt == null ? null : Number(intent.cancelRequestedAt),
    cancelledAt: intent.cancelledAt == null ? null : Number(intent.cancelledAt),
    lastErrorCode: intent.lastErrorCode || null,
    lastErrorMessage: intent.lastErrorMessage || null,
    createdAt: Number(intent.createdAt) || 0,
    updatedAt: Number(intent.updatedAt) || 0,
  };
}

function verifyCompletionEvidence(database, result) {
  const reasons = [];
  if (!result?.runId) {
    return {
      verified: false,
      reasons: ['run_id_missing'],
      run: null,
      nodeRuns: [],
      assets: [],
    };
  }
  const evidence = database.getRunEvidence?.({
    projectId: result.projectId,
    canvasId: result.canvasId,
    runId: result.runId,
    nodeLimit: 500,
    attemptLimit: 20,
  });
  if (!evidence) {
    return {
      verified: false,
      reasons: ['run_evidence_missing'],
      run: null,
      nodeRuns: [],
      assets: [],
    };
  }
  if (evidence.evidenceComplete !== true) reasons.push(...(evidence.evidenceReasons || ['run_evidence_incomplete']));
  if (!['completed', 'succeeded'].includes(String(evidence.run?.status || ''))) {
    reasons.push('run_not_completed');
  }
  if (String(evidence.run?.id || '') !== String(result.runId || '')) reasons.push('run_id_mismatch');
  if (evidence.run?.projectId != null
    && String(evidence.run.projectId) !== String(result.projectId || '')) reasons.push('run_project_mismatch');
  if (evidence.run?.canvasId != null
    && String(evidence.run.canvasId) !== String(result.canvasId || '')) reasons.push('run_canvas_mismatch');
  const expectedCanvasRevision = result.canvasRevision == null || result.canvasRevision === ''
    ? Number.NaN
    : Number(result.canvasRevision);
  if (Number.isSafeInteger(expectedCanvasRevision)
    && evidence.run?.canvasRevision != null
    && Number(evidence.run.canvasRevision) !== expectedCanvasRevision) reasons.push('run_canvas_revision_mismatch');
  if (!Array.isArray(evidence.nodeRuns) || evidence.nodeRuns.length === 0) reasons.push('node_run_evidence_missing');
  const assets = [];
  const requestedNodeIds = new Set(normalizeNodeIds(result.nodeIds));
  const nodeRuns = (evidence.nodeRuns || []).map((nodeRun) => {
    const attempts = evidence.attemptsByNodeId instanceof Map
      ? evidence.attemptsByNodeId.get(String(nodeRun.id)) || []
      : [];
    const latestAttempt = attempts[attempts.length - 1] || null;
    const outputRefs = [...new Set((Array.isArray(nodeRun.outputRefs) ? nodeRun.outputRefs : [])
      .map(String)
      .filter(Boolean))];
    const nodeId = String(nodeRun.originalNodeId || nodeRun.nodeId || '');
    if (nodeRun.runId != null && String(nodeRun.runId) !== String(result.runId || '')) {
      reasons.push(`node_run_run_mismatch:${nodeRun.id}`);
    }
    if (requestedNodeIds.size > 0
      && nodeId
      && !requestedNodeIds.has(nodeId)
      && !nodeRun.parentNodeRunId
      && !nodeRun.definitionId) {
      reasons.push(`node_run_node_mismatch:${nodeRun.id}`);
    }
    if (String(nodeRun.status || '') !== 'succeeded') reasons.push(`node_run_not_succeeded:${nodeRun.id}`);
    if (!latestAttempt) reasons.push(`attempt_evidence_missing:${nodeRun.id}`);
    else if (String(latestAttempt.status || '') !== 'succeeded') reasons.push(`attempt_not_succeeded:${nodeRun.id}`);
    if (outputRefs.length === 0) reasons.push(`output_asset_missing:${nodeRun.id}`);
    for (const assetId of outputRefs) {
      const asset = database.getAsset?.(assetId) || null;
      const databaseStored = Boolean(
        asset
        && String(asset.projectId || '') === String(result.projectId || '')
        && String(asset.availability || '') === 'available',
      );
      if (!databaseStored) reasons.push(`output_asset_unverified:${assetId}`);
      const physical = databaseStored
        ? readVerifiedManagedArtifact(asset)
        : {
            verified: false,
            reasons: [],
            evidence: {
              blobPresent: false,
              hashVerified: false,
              magicVerified: false,
              detectedKind: null,
              detectedMimeType: null,
              observedContentHash: null,
              byteSize: null,
              width: null,
              height: null,
              duration: null,
              decodeEvidence: 'not-recorded',
            },
          };
      reasons.push(...physical.reasons);
      const association = asset
        ? verifyAssetAssociation(asset, nodeRun, latestAttempt, evidence.run, result)
        : {
            verified: false,
            reasons: [],
            expectedNodeId: nodeId || null,
            expectedShotIds: [],
            observedShotIds: [],
            expectedCanvasRevision: Number.isSafeInteger(expectedCanvasRevision) ? expectedCanvasRevision : null,
          };
      reasons.push(...association.reasons);
      const stored = databaseStored && physical.verified && association.verified;
      assets.push({
        assetId,
        nodeRunId: String(nodeRun.id || ''),
        kind: asset?.kind || null,
        mimeType: asset?.mimeType || null,
        contentHash: asset?.contentHash || null,
        availability: asset?.availability || null,
        stored,
        blobPresent: physical.evidence.blobPresent,
        hashVerified: physical.evidence.hashVerified,
        magicVerified: physical.evidence.magicVerified,
        detectedKind: physical.evidence.detectedKind,
        detectedMimeType: physical.evidence.detectedMimeType,
        observedContentHash: physical.evidence.observedContentHash,
        byteSize: physical.evidence.byteSize,
        width: physical.evidence.width,
        height: physical.evidence.height,
        duration: physical.evidence.duration,
        decodeEvidence: physical.evidence.decodeEvidence,
        associationVerified: association.verified,
        expectedNodeId: association.expectedNodeId,
        expectedShotIds: association.expectedShotIds,
        observedShotIds: association.observedShotIds,
        expectedCanvasRevision: association.expectedCanvasRevision,
      });
    }
    return {
      nodeRunId: String(nodeRun.id || ''),
      nodeId,
      status: String(nodeRun.status || ''),
      latestAttemptId: latestAttempt?.id || null,
      latestAttemptStatus: latestAttempt?.status || null,
      outputAssetIds: outputRefs,
    };
  });
  return {
    verified: reasons.length === 0,
    reasons: [...new Set(reasons)],
    run: evidence.run ? {
      runId: String(evidence.run.id || ''),
      status: String(evidence.run.status || ''),
      canvasRevision: Number(evidence.run.canvasRevision) || null,
      createdAt: evidence.run.createdAt || null,
      finishedAt: evidence.run.finishedAt || null,
    } : null,
    nodeRuns,
    assets,
  };
}

function createAgentControlRunService(options = {}) {
  const database = options.database;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const plans = new Map();

  function cleanup() {
    const current = now();
    for (const [id, plan] of plans) if (plan.expiresAt <= current) plans.delete(id);
  }

  function documentFor(projectId, canvasId) {
    const document = database?.getCanvas?.(String(canvasId || ''));
    if (!document || String(document.projectId || '') !== String(projectId || '')) {
      throw new AgentControlRunError('RUN_SCOPE_NOT_FOUND', '运行目标不存在或不属于当前项目', 404);
    }
    return document;
  }

  function createPlan(input = {}, scope = {}) {
    cleanup();
    if (plans.size >= PLAN_LIMIT) throw new AgentControlRunError('RUN_PLAN_LIMIT_REACHED', '待处理运行计划过多，请先完成或等待旧计划过期', 429);
    const projectId = String(scope.projectId || '');
    const canvasId = String(scope.canvasId || '');
    const document = documentFor(projectId, canvasId);
    const expectedRevision = Number(input.canvasRevision ?? document.revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== Number(document.revision)) {
      throw new AgentControlRunError('RUN_CANVAS_STALE', '画布 revision 已变化，请重新生成运行计划', 409, {
        currentRevision: Number(document.revision),
      });
    }
    const nodeIds = normalizeNodeIds(input.nodeIds);
    const authority = deriveRunIntentAuthority(document, nodeIds);
    const summary = summarizeRunIntentAuthority(authority);
    const createdAt = now();
    const internal = {
      id: crypto.randomUUID(),
      schema: 't8-agent-run-plan-v1',
      projectId,
      canvasId,
      canvasRevision: Number(document.revision),
      requestedNodeIds: authority.requestedNodeIds,
      authorizedNodeIds: authority.authorizedNodeIds,
      declarations: authority.declarations,
      authority,
      mode: String(input.mode || 'missing-failed-unlocked').slice(0, 80),
      provider: summary.provider,
      model: summary.model,
      actorId: String(scope.actorId || ''),
      sessionId: String(scope.sessionId || ''),
      createdAt,
      expiresAt: createdAt + PLAN_TTL_MS,
    };
    internal.planDigest = digest({
      schema: internal.schema,
      projectId,
      canvasId,
      canvasRevision: internal.canvasRevision,
      requestedNodeIds: internal.requestedNodeIds,
      authorizedNodeIds: internal.authorizedNodeIds,
      declarations: internal.declarations,
      mode: internal.mode,
    });
    plans.set(internal.id, internal);
    return publicPlan(internal);
  }

  function publicPlan(plan) {
    return {
      schema: plan.schema,
      planId: plan.id,
      planDigest: plan.planDigest,
      projectId: plan.projectId,
      canvasId: plan.canvasId,
      canvasRevision: plan.canvasRevision,
      requestedNodeIds: [...plan.requestedNodeIds],
      authorizedNodeIds: [...plan.authorizedNodeIds],
      declarations: plan.declarations.map((item) => ({
        provider: item.provider,
        model: item.model,
        nodeIds: [...item.nodeIds],
      })),
      mode: plan.mode,
      canStart: true,
      blockers: [],
      warnings: [],
      createdAt: new Date(plan.createdAt).toISOString(),
      expiresAt: new Date(plan.expiresAt).toISOString(),
    };
  }

  function requirePlan(planId, scope = {}) {
    cleanup();
    const plan = plans.get(String(planId || ''));
    if (!plan) throw new AgentControlRunError('RUN_PLAN_NOT_FOUND', '运行计划不存在或已过期，请重新生成', 404);
    if (plan.projectId !== String(scope.projectId || '')
      || plan.canvasId !== String(scope.canvasId || '')
      || plan.actorId !== String(scope.actorId || '')
      || plan.sessionId !== String(scope.sessionId || '')) {
      throw new AgentControlRunError('RUN_PLAN_SCOPE_MISMATCH', '运行计划不属于当前 Agent 会话或画布', 403);
    }
    return plan;
  }

  function startPreview(planId, scope = {}) {
    const plan = requirePlan(planId, scope);
    if (plan.submissionOperationId) throw new AgentControlRunError('RUN_PLAN_ALREADY_SUBMITTED', '这份运行计划已提交；请查询原运行意图，不要再次申请启动', 409);
    const document = documentFor(plan.projectId, plan.canvasId);
    if (Number(document.revision) !== plan.canvasRevision) {
      throw new AgentControlRunError('RUN_CANVAS_STALE', '画布 revision 已变化，未提交运行；请重新生成计划', 409, {
        currentRevision: Number(document.revision),
      });
    }
    const currentAuthority = deriveRunIntentAuthority(document, plan.requestedNodeIds);
    assertRunIntentAuthorityMatches(plan.authority, currentAuthority);
    return {
      plan,
      preview: {
        summary: `运行 ${plan.authorizedNodeIds.length} 个生成节点`,
        riskLevel: 'L2',
        currentRevision: plan.canvasRevision,
        projectId: plan.projectId,
        canvasId: plan.canvasId,
        run: {
          planId: plan.id,
          planDigest: plan.planDigest,
          requestedNodeIds: [...plan.requestedNodeIds],
          authorizedNodeIds: [...plan.authorizedNodeIds],
          declarations: plan.declarations,
          mode: plan.mode,
        },
        providerTransfer: {
          occursNow: false,
          scope: 'after-approval-only',
          message: '批准前不会向任何 Provider 提交任务；批准后只运行以上节点范围。',
        },
        changes: plan.authorizedNodeIds.map((nodeId) => ({
          type: 'run.start',
          targetType: 'node',
          targetId: nodeId,
          fields: ['input', 'provider', 'model', 'result'],
        })),
        warnings: [
          '刷新、断线或重复提交不会重复创建相同 operationId 的运行意图。',
        ],
      },
    };
  }

  function complete(plan, context = {}) {
    if (!plan || !Number.isFinite(Number(plan.expiresAt)) || Number(plan.expiresAt) <= now()) throw new AgentControlRunError('RUN_PLAN_EXPIRED', '运行计划已过期，未提交运行', 409);
    const actorId = String(context.actorId || plan.actorId || '');
    const sessionId = String(context.sessionId || plan.sessionId || '');
    if (actorId !== String(plan.actorId || '') || sessionId !== String(plan.sessionId || '')) throw new AgentControlRunError('RUN_PLAN_SCOPE_MISMATCH', '运行计划不属于当前 Agent 会话', 403);
    const owned = requirePlan(plan.id, { projectId: plan.projectId, canvasId: plan.canvasId, actorId, sessionId });
    if (owned.planDigest !== plan.planDigest) throw new AgentControlRunError('RUN_PLAN_SCOPE_MISMATCH', '运行计划引用已变化', 409);
    plan = owned;
    const document = documentFor(plan.projectId, plan.canvasId);
    if (Number(document.revision) !== plan.canvasRevision) {
      throw new AgentControlRunError('RUN_CANVAS_STALE', '批准后画布已变化，未提交运行；请重新生成计划', 409);
    }
    const currentAuthority = deriveRunIntentAuthority(document, plan.requestedNodeIds);
    assertRunIntentAuthorityMatches(plan.authority, currentAuthority);
    const operationId = requireRunOperationId(context.operationId);
    if (plan.submissionOperationId && plan.submissionOperationId !== operationId) throw new AgentControlRunError('RUN_PLAN_ALREADY_SUBMITTED', '这份运行计划已使用另一个操作引用，未再次提交', 409);
    // This is the existing in-memory plan's single-use binding. The durable
    // run_intents ledger remains the only reservation/execution authority.
    plan.submissionOperationId = operationId;
    const intent = database.createRunIntent({
      projectId: plan.projectId,
      canvasId: plan.canvasId,
      canvasRevision: plan.canvasRevision,
      nodeIds: plan.requestedNodeIds,
      idempotencyKey: operationId,
      requestedBy: actorId,
      provider: plan.provider,
      model: plan.model,
      estimatedCost: null,
      estimatedCostKnown: false,
      executionAuthority: plan.authority,
      confirmationRequired: false,
    });
    if (!intent || intent.projectId !== plan.projectId || intent.canvasId !== plan.canvasId || intent.requestedBy !== actorId || Number(intent.canvasRevision) !== plan.canvasRevision || digest(normalizeNodeIds(intent.nodeIds)) !== digest(normalizeNodeIds(plan.requestedNodeIds)) || intent.idempotencyKey !== operationId) throw new AgentControlRunError('RUN_OPERATION_CONFLICT', '运行操作引用已属于其他范围，未返回该运行信息', 409);
    try { assertRunIntentAuthorityMatches(plan.authority, intent.executionAuthority); } catch (_) { throw new AgentControlRunError('RUN_OPERATION_CONFLICT', '运行操作引用的授权范围不一致', 409); }
    return publicIntent(intent);
  }

  function inspectOperation(operationId, scope = {}) {
    operationId = requireRunOperationId(operationId);
    const intent = database.getRunIntentByKey(String(scope.projectId || ''), String(operationId));
    if (!intent || String(intent.canvasId || '') !== String(scope.canvasId || '') || String(intent.requestedBy || '') !== String(scope.actorId || '')) throw new AgentControlRunError('RUN_INTENT_NOT_FOUND', '运行请求不存在或不属于当前 Agent', 404);
    return inspect(intent.id, scope);
  }

  function list(scope = {}, filters = {}) {
    const intents = database.listRunIntents({
      projectId: scope.projectId,
      canvasId: scope.canvasId,
      ...(filters.status ? { status: String(filters.status) } : {}),
    });
    return intents
      .filter((item) => String(item.requestedBy || '') === String(scope.actorId || ''))
      .slice(0, 100)
      .map(publicIntent);
  }

  function inspect(intentId, scope = {}) {
    const intent = database.getRunIntent(String(intentId || ''));
    if (!intent
      || String(intent.projectId || '') !== String(scope.projectId || '')
      || String(intent.canvasId || '') !== String(scope.canvasId || '')
      || String(intent.requestedBy || '') !== String(scope.actorId || '')) {
      throw new AgentControlRunError('RUN_INTENT_NOT_FOUND', '运行请求不存在或不属于当前 Agent', 404);
    }
    const result = publicIntent(intent);
    const artifactVerification = result.status === 'completed'
      ? verifyCompletionEvidence(database, result)
      : {
          verified: false,
          reasons: ['run_not_completed'],
          run: null,
          nodeRuns: [],
          assets: [],
        };
    return {
      ...result,
      completionVerified: artifactVerification.verified,
      artifactVerification,
    };
  }

  function cancel(intentId, expectedQueueRevision, scope = {}) {
    const current = inspect(intentId, scope);
    const revision = Number(expectedQueueRevision ?? current.queueRevision);
    const intent = database.requestRunIntentCancellation(intentId, {
      projectId: scope.projectId,
      canvasId: scope.canvasId,
      expectedQueueRevision: revision,
      actorId: scope.actorId,
      sessionId: scope.sessionId,
    });
    return publicIntent(intent);
  }

  function retryPlan(intentId, scope = {}) {
    const previous = inspect(intentId, scope);
    if (!['failed', 'cancelled'].includes(previous.status)) {
      throw new AgentControlRunError('RUN_RETRY_INVALID_STATE', '只有失败或已取消的运行可以创建重试计划', 409);
    }
    return createPlan({
      canvasRevision: previous.canvasRevision,
      nodeIds: previous.nodeIds,
      mode: 'failed-only',
    }, scope);
  }

  return {
    cancel,
    cleanup,
    complete,
    createPlan,
    inspect,
    inspectOperation,
    list,
    requirePlan,
    retryPlan,
    startPreview,
  };
}

module.exports = {
  AgentControlRunError,
  createAgentControlRunService,
  publicIntent,
  requireRunOperationId,
  verifyCompletionEvidence,
};
