'use strict';

const crypto = require('node:crypto');
const { readSceneProduction } = require('./creatorSceneProduction');
const { normalizeScopeKey } = require('./creatorAgentWorkArtifacts');

const LONG_SCRIPT_ROOT_SCHEMA = 't8-creator-long-script-root-v1';
const LONG_SCRIPT_SCENE_SCHEMA = 't8-creator-scene-record-v1';
const LONG_SCRIPT_CONTEXT_SCHEMA = 't8-creator-scene-context-pack-v1';
const LONG_SCRIPT_PATCH_SCHEMA = 't8-creator-scene-patch-v1';
const LONG_SCRIPT_ENTITY_SCHEMA = 't8-creator-entity-v1';
const LONG_SCRIPT_RELATIONSHIP_SCHEMA = 't8-creator-relationship-v1';
const LONG_SCRIPT_STYLE_CANON_SCHEMA = 't8-creator-style-canon-v1';
const LONG_SCRIPT_SCENE_PART_SCHEMA = 't8-creator-scene-part-v1';
const LONG_SCRIPT_SOURCE_SHARD_SCHEMA = 't8-creator-source-shard-v1';
const LONG_SCRIPT_SCENE_DRAFT_SCHEMA = 't8-creator-scene-draft-v1';
const SCENE_SHARD_COUNT = 32;
const ORDER_SHARD_SIZE = 100;
const SOURCE_SHARD_BASE_COUNT = 16;
const MIN_SCENE_PART_CHARACTERS = 1_500;
const MAX_SCENE_PART_CHARACTERS = 3_000;
const SCENE_PART_ROLLING_WINDOW = 48;
const SCENE_PART_BOUNDARY_MASK = 0x1ff;
const MAX_SOURCE_SHARD_BYTES = 190_000;
const MAX_SCRIPT_CHARACTERS = 2_000_000;
const MAX_SCENES = 1_000;

function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableString(value)).digest('hex');
}

function text(value, maximum = 16_000) {
  return String(value == null ? '' : value).replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim().slice(0, maximum);
}

function cleanSource(value) {
  const source = String(value == null ? '' : value)
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n');
  if (source.length > MAX_SCRIPT_CHARACTERS) {
    const error = new Error('长剧本超过 2,000,000 字符，请拆成同一项目内的多个剧本卷后再导入');
    error.code = 'CREATOR_LONG_SCRIPT_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  return source;
}

function normalizedTitle(value) {
  return text(value, 240)
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizedSceneBody(value) {
  return text(value, 80_000)
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizedSceneNarrative(value) {
  const lines = String(value == null ? '' : value).replace(/\r\n?/gu, '\n').split('\n');
  if (sceneHeading(lines[0])) lines.shift();
  return normalizedSceneBody(lines.join('\n'));
}

function sceneHeading(line) {
  const value = String(line || '').trim();
  if (!value || value.length > 240) return false;
  return /^(?:第\s*[〇零一二三四五六七八九十百千万两\d]+\s*(?:场|幕)(?:\s*[：:._\-—]\s*.*)?|(?:场次|场景)\s*[〇零一二三四五六七八九十百千万两\d]+(?:\s*[：:._\-—]\s*.*)?|(?:内景|外景)\s*(?:[·.．_\-—:：]|\s)\s*\S.*|SCENE\s+[A-Z0-9._-]+\b.*|(?:INT|EXT|INT\/EXT|EXT\/INT|I\/E)\.?\s+\S.*)$/iu.test(value);
}

function lineOffsets(source) {
  const result = [];
  let start = 0;
  source.split('\n').forEach((line) => {
    result.push({ line, start, end: start + line.length });
    start += line.length + 1;
  });
  return result;
}

function splitLongScriptScenes(sourceValue) {
  const source = cleanSource(sourceValue);
  if (!source.trim()) return { source, explicitHeadings: false, preamble: '', scenes: [] };
  const lines = lineOffsets(source);
  const headings = lines.filter((item) => sceneHeading(item.line));
  if (headings.length > MAX_SCENES) {
    const error = new Error('长剧本超过 1,000 场，请拆成同一项目内的多个剧本卷后再导入');
    error.code = 'CREATOR_LONG_SCRIPT_TOO_MANY_SCENES';
    error.status = 413;
    throw error;
  }
  // One isolated heading is not enough evidence that the author intended a
  // multi-scene structure. Preserve the whole source as one scene instead of
  // inventing divisions from prose paragraphs.
  if (headings.length < 2) {
    return {
      source,
      explicitHeadings: false,
      preamble: '',
      scenes: [{
        ordinal: 1,
        title: text(headings[0]?.line, 240) || '完整剧本',
        start: 0,
        end: source.length,
        sourceText: source,
        sourceDigest: digest(source),
      }],
    };
  }
  const preamble = source.slice(0, headings[0].start).trim();
  const scenes = headings.slice(0, MAX_SCENES).map((heading, index) => {
    const end = headings[index + 1]?.start ?? source.length;
    // The first scene owns the optional preamble and every following scene
    // begins exactly where the previous one ends.  These contiguous spans
    // make the concatenated scene source byte-for-byte equal to the import;
    // blank separator lines are never trimmed away or left unowned.
    const start = index === 0 ? 0 : heading.start;
    const sourceText = source.slice(start, end);
    return {
      ordinal: index + 1,
      title: text(heading.line, 240),
      start,
      end,
      sourceText,
      sourceDigest: digest(sourceText),
    };
  });
  return { source, explicitHeadings: true, preamble, scenes };
}

function characterBigrams(value) {
  const normalized = normalizedSceneBody(value);
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

function similarity(left, right) {
  const a = characterBigrams(left);
  const b = characterBigrams(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  const union = new Set([...a, ...b]);
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function lineageSimilarity(leftValue, rightValue) {
  const left = normalizedSceneNarrative(leftValue);
  const right = normalizedSceneNarrative(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (lengthRatio < 0.82) return 0;
  return similarity(left, right) * 0.8 + lengthRatio * 0.2;
}

function bestLineageRange(targetText, items, options = {}) {
  const maximumSpan = Math.max(2, Math.min(8, Math.trunc(Number(options.maximumSpan) || 8)));
  const blocked = options.blocked instanceof Set ? options.blocked : new Set();
  const candidates = [];
  for (let start = 0; start < items.length; start += 1) {
    if (blocked.has(start)) continue;
    let combined = '';
    for (let end = start; end < items.length && end < start + maximumSpan; end += 1) {
      if (blocked.has(end)) break;
      const narrative = normalizedSceneNarrative(items[end]?.sourceText);
      if (!narrative) break;
      combined += narrative;
      if (end === start) continue;
      const score = lineageSimilarity(targetText, combined);
      if (score >= 0.9) {
        candidates.push({
          start,
          end,
          score,
          indices: Array.from({ length: end - start + 1 }, (_, offset) => start + offset),
        });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score
    || left.indices.length - right.indices.length
    || left.start - right.start);
  const best = candidates[0] || null;
  if (!best) return null;
  const second = candidates[1] || null;
  // Repeated dialogue or duplicated scene text is not enough evidence to
  // invent lineage. Leave it to an explicit user confirmation instead.
  if (second && best.score - second.score < 0.04) return null;
  return best;
}

function sceneScopeKey(sceneId) {
  const bucket = Number.parseInt(digest(sceneId).slice(0, 2), 16) % SCENE_SHARD_COUNT;
  return normalizeScopeKey(`scene-${bucket.toString(16).padStart(2, '0')}`);
}

function sceneDraftScopeKey(scenePartId) {
  return normalizeScopeKey(`scene-draft-${digest(text(scenePartId, 160)).slice(0, 32)}`);
}

function orderScopeKey(sceneId) {
  // Kept for compatibility with callers that only need a deterministic key.
  // Imports use fixed-size ordered pages below so the generic artifact array
  // ceiling can never truncate or reject a 1,000-scene script.
  const bucket = Number.parseInt(digest(sceneId).slice(0, 4), 16);
  return normalizeScopeKey(`order-${bucket.toString(16).padStart(4, '0')}`);
}

function entityScopeKey(entityId) {
  const bucket = Number.parseInt(digest(entityId).slice(0, 2), 16) % SCENE_SHARD_COUNT;
  return normalizeScopeKey(`entity-${bucket.toString(16).padStart(2, '0')}`);
}

function relationshipScopeKey(relationshipId) {
  const bucket = Number.parseInt(digest(relationshipId).slice(0, 2), 16) % SCENE_SHARD_COUNT;
  return normalizeScopeKey(`relationship-${bucket.toString(16).padStart(2, '0')}`);
}

function splitSceneSourceParts(scene, sourceValue) {
  const source = String(sourceValue == null ? '' : sourceValue).replace(/\r\n?/gu, '\n');
  const absoluteStart = Math.max(0, Math.trunc(Number(scene?.sourceRef?.span?.start) || 0));
  const rawParts = [];
  if (!source.length) rawParts.push({ start: 0, end: 0, text: '', digest: digest('') });
  let start = 0;
  let rolling = 0;
  const window = [];
  const base = 257;
  let basePower = 1;
  for (let index = 0; index < SCENE_PART_ROLLING_WINDOW; index += 1) {
    basePower = Math.imul(basePower, base) >>> 0;
  }
  for (let end = 1; end <= source.length; end += 1) {
    const code = source.charCodeAt(end - 1) + 1;
    rolling = (Math.imul(rolling, base) + code) >>> 0;
    window.push(code);
    if (window.length > SCENE_PART_ROLLING_WINDOW) {
      const removed = window.shift();
      rolling = (rolling - Math.imul(removed, basePower)) >>> 0;
    }
    const size = end - start;
    const anchored = size >= MIN_SCENE_PART_CHARACTERS
      && (rolling & SCENE_PART_BOUNDARY_MASK) === 0;
    if (!anchored && size < MAX_SCENE_PART_CHARACTERS) continue;
    let cut = end;
    const newline = source.lastIndexOf('\n', end - 1);
    if (newline >= start + MIN_SCENE_PART_CHARACTERS && end - newline <= 160) cut = newline + 1;
    const previousCode = source.charCodeAt(cut - 1);
    const nextCode = source.charCodeAt(cut);
    if (previousCode >= 0xD800 && previousCode <= 0xDBFF
      && nextCode >= 0xDC00 && nextCode <= 0xDFFF) cut -= 1;
    if (cut <= start) continue;
    const partText = source.slice(start, cut);
    rawParts.push({ start, end: cut, text: partText, digest: digest(partText) });
    start = cut;
  }
  if (start < source.length) {
    const partText = source.slice(start);
    rawParts.push({ start, end: source.length, text: partText, digest: digest(partText) });
  }
  const occurrenceByDigest = new Map();
  return rawParts.map((part, index) => {
    const occurrence = (occurrenceByDigest.get(part.digest) || 0) + 1;
    occurrenceByDigest.set(part.digest, occurrence);
    const scenePartId = `scene_part_${digest({
      schema: LONG_SCRIPT_SCENE_PART_SCHEMA,
      sceneId: text(scene?.sceneId, 160),
      digest: part.digest,
      occurrence,
    }).slice(0, 24)}`;
    return {
      schema: LONG_SCRIPT_SCENE_PART_SCHEMA,
      scenePartId,
      sceneId: text(scene?.sceneId, 160),
      index,
      total: rawParts.length,
      span: { start: absoluteStart + part.start, end: absoluteStart + part.end },
      digest: part.digest,
      // UTF-16LE preserves every JavaScript source code unit exactly, including
      // unusual unmatched surrogates.  At 3,000 code units the Base64 payload
      // is at most 8,000 characters, well under the artifact string ceiling.
      encoding: 'base64-utf16le',
      data: Buffer.from(part.text, 'utf16le').toString('base64'),
      text: part.text,
    };
  });
}

function sourceShardBaseKey(scenePartId) {
  const bucket = Number.parseInt(digest(scenePartId).slice(0, 2), 16) % SOURCE_SHARD_BASE_COUNT;
  return `source-${bucket.toString(16).padStart(2, '0')}`;
}

function packSceneSourceShards(parts = [], documentVersionId = '') {
  const byBase = new Map();
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const base = sourceShardBaseKey(part.scenePartId);
    byBase.set(base, [...(byBase.get(base) || []), part]);
  });
  const shards = new Map();
  [...byBase.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([base, values]) => {
    let chunk = [];
    let chunkIndex = 0;
    const flush = () => {
      if (!chunk.length) return;
      const scopeKey = normalizeScopeKey(`${base}-${String(chunkIndex).padStart(2, '0')}`);
      shards.set(scopeKey, chunk);
      chunk = [];
      chunkIndex += 1;
    };
    values.sort((left, right) => left.scenePartId.localeCompare(right.scenePartId)).forEach((part) => {
      const stored = {
        schema: part.schema,
        documentVersionId,
        scenePartId: part.scenePartId,
        sceneId: part.sceneId,
        index: part.index,
        total: part.total,
        span: part.span,
        digest: part.digest,
        encoding: part.encoding,
        data: part.data,
      };
      const candidate = [...chunk, stored];
      const payloadBytes = Buffer.byteLength(stableString({
        schema: LONG_SCRIPT_SOURCE_SHARD_SCHEMA,
        documentVersionId,
        parts: candidate,
      }), 'utf8');
      if (chunk.length && (candidate.length > 120 || payloadBytes > MAX_SOURCE_SHARD_BYTES)) flush();
      chunk.push(stored);
    });
    flush();
  });
  return shards;
}

function decodeSceneSourcePart(value) {
  if (!value || value.schema !== LONG_SCRIPT_SCENE_PART_SCHEMA
    || value.encoding !== 'base64-utf16le') return null;
  try {
    const raw = Buffer.from(String(value.data || ''), 'base64');
    if (raw.length % 2 !== 0) return null;
    const sourceText = raw.toString('utf16le');
    if (raw.toString('base64') !== String(value.data || '') || digest(sourceText) !== text(value.digest, 64)) {
      return null;
    }
    return {
      schema: LONG_SCRIPT_SCENE_PART_SCHEMA,
      documentVersionId: text(value.documentVersionId, 160),
      scenePartId: text(value.scenePartId, 160),
      sceneId: text(value.sceneId, 160),
      index: Math.max(0, Math.trunc(Number(value.index) || 0)),
      total: Math.max(1, Math.trunc(Number(value.total) || 1)),
      span: {
        start: Math.max(0, Math.trunc(Number(value.span?.start) || 0)),
        end: Math.max(0, Math.trunc(Number(value.span?.end) || 0)),
      },
      digest: text(value.digest, 64),
      sourceText,
    };
  } catch {
    return null;
  }
}

function sceneIdFor(scriptId, candidate, occurrence) {
  return `scene_${digest({
    schema: LONG_SCRIPT_SCENE_SCHEMA,
    scriptId,
    sourceDigest: candidate.sourceDigest,
    title: normalizedTitle(candidate.title),
    occurrence,
  }).slice(0, 24)}`;
}

function emptySceneRecord(scriptId, documentVersionId, candidate, sceneId, orderKey, derivedFromSceneIds = []) {
  return {
    schema: LONG_SCRIPT_SCENE_SCHEMA,
    sceneId,
    orderKey,
    title: candidate.title,
    sourceRef: {
      documentVersionId,
      span: { start: candidate.start, end: candidate.end },
      digest: candidate.sourceDigest,
    },
    // Used only while reconciling an edit. Import removes it from the stored
    // scene shard; the lossless source shards remain authoritative.
    sourceText: String(candidate.sourceText == null ? '' : candidate.sourceText),
    sourcePartCount: 1,
    acceptedSourcePartCount: 0,
    draftSourcePartId: null,
    status: 'draft',
    purpose: '',
    objective: '',
    obstacle: '',
    turn: '',
    valueChange: '',
    activeEntityIds: [],
    locationId: null,
    continuityResetEntityIds: [],
    entryRefs: [],
    exitState: {},
    hardConstraintIds: [],
    locks: [],
    recordRevision: 1,
    derivedFromSceneIds: [...new Set((Array.isArray(derivedFromSceneIds) ? derivedFromSceneIds : [])
      .map((item) => text(item, 160)).filter(Boolean))],
    deleted: false,
    scriptId,
  };
}

function activeScenes(value) {
  return (Array.isArray(value) ? value : [])
    .filter((scene) => scene && scene.deleted !== true)
    .sort((left, right) => String(left.orderKey).localeCompare(String(right.orderKey)));
}

function reconcileLongScriptScenes(input = {}) {
  const scriptId = text(input.scriptId, 120) || `script_${digest(text(input.sessionId, 180)).slice(0, 24)}`;
  const documentVersionId = text(input.documentVersionId, 160)
    || `source_${digest(input.source || '').slice(0, 24)}`;
  const parsed = splitLongScriptScenes(input.source);
  const allPrevious = (Array.isArray(input.previousScenes) ? input.previousScenes : [])
    .filter((scene) => scene && text(scene.sceneId, 160));
  const previous = activeScenes(allPrevious);
  const unmatched = new Map(previous.map((scene) => [scene.sceneId, scene]));
  const reservedSceneIds = new Set(allPrevious.map((scene) => text(scene.sceneId, 160)).filter(Boolean));
  const allocatedSceneIds = new Set();
  const exactByDigest = new Map();
  const sourceTextForPreviousScene = (scene) => input.previousSourceBySceneId instanceof Map
    ? input.previousSourceBySceneId.get(scene.sceneId) || scene.sourceText
    : scene.sourceText;
  previous.forEach((scene) => {
    const key = text(scene?.sourceRef?.digest, 64);
    if (!key) return;
    exactByDigest.set(key, [...(exactByDigest.get(key) || []), scene]);
  });
  const candidateIndicesByDigest = new Map();
  const candidateIndicesByTitle = new Map();
  parsed.scenes.forEach((candidate, index) => {
    candidateIndicesByDigest.set(candidate.sourceDigest, [
      ...(candidateIndicesByDigest.get(candidate.sourceDigest) || []), index,
    ]);
    const titleKey = normalizedTitle(candidate.title);
    candidateIndicesByTitle.set(titleKey, [...(candidateIndicesByTitle.get(titleKey) || []), index]);
  });
  const previousByTitle = new Map();
  previous.forEach((scene) => {
    const titleKey = normalizedTitle(scene.title);
    previousByTitle.set(titleKey, [...(previousByTitle.get(titleKey) || []), scene]);
  });
  const preMatchedByCandidateIndex = new Map();
  const preMatchedPreviousIds = new Set();
  candidateIndicesByDigest.forEach((indices, sourceDigest) => {
    const matches = exactByDigest.get(sourceDigest) || [];
    if (indices.length !== 1 || matches.length !== 1) return;
    preMatchedByCandidateIndex.set(indices[0], matches[0]);
    preMatchedPreviousIds.add(matches[0].sceneId);
  });
  candidateIndicesByTitle.forEach((indices, titleKey) => {
    const matches = previousByTitle.get(titleKey) || [];
    if (indices.length !== 1 || matches.length !== 1
      || preMatchedByCandidateIndex.has(indices[0])
      || preMatchedPreviousIds.has(matches[0].sceneId)) return;
    if (similarity(sourceTextForPreviousScene(matches[0]), parsed.scenes[indices[0]].sourceText) < 0.55) return;
    preMatchedByCandidateIndex.set(indices[0], matches[0]);
    preMatchedPreviousIds.add(matches[0].sceneId);
  });
  const lineageByCandidateIndex = new Map();
  const lineageParentIds = new Set();
  const splitCandidateIndices = new Set();

  const splitProposals = previous.filter((scene) => !preMatchedPreviousIds.has(scene.sceneId)).map((scene) => ({
    scene,
    range: bestLineageRange(sourceTextForPreviousScene(scene), parsed.scenes),
  })).filter((proposal) => proposal.range
      && !proposal.range.indices.some((index) => preMatchedByCandidateIndex.has(index)))
    .sort((left, right) => right.range.score - left.range.score
      || left.range.start - right.range.start);
  splitProposals.forEach(({ scene, range }) => {
    if (range.indices.some((index) => splitCandidateIndices.has(index))) return;
    range.indices.forEach((index) => {
      splitCandidateIndices.add(index);
      lineageByCandidateIndex.set(index, [scene.sceneId]);
    });
    lineageParentIds.add(scene.sceneId);
  });

  parsed.scenes.forEach((candidate, candidateIndex) => {
    if (lineageByCandidateIndex.has(candidateIndex)) return;
    const blockedPreviousIndices = new Set(previous.map((scene, index) => (
      lineageParentIds.has(scene.sceneId) || preMatchedPreviousIds.has(scene.sceneId) ? index : null
    )).filter((index) => index != null));
    const range = bestLineageRange(candidate.sourceText, previous, { blocked: blockedPreviousIndices });
    if (!range) return;
    const parents = range.indices.map((index) => previous[index]?.sceneId).filter(Boolean);
    if (parents.length < 2 || parents.some((sceneId) => lineageParentIds.has(sceneId))) return;
    lineageByCandidateIndex.set(candidateIndex, parents);
    parents.forEach((sceneId) => lineageParentIds.add(sceneId));
  });

  const allocateSceneId = (candidate, occurrence, derivedFromSceneIds) => {
    const base = sceneIdFor(scriptId, candidate, occurrence);
    let candidateId = base;
    let collision = 0;
    while (reservedSceneIds.has(candidateId) || allocatedSceneIds.has(candidateId)) {
      collision += 1;
      candidateId = `scene_${digest({
        schema: LONG_SCRIPT_SCENE_SCHEMA,
        base,
        documentVersionId,
        derivedFromSceneIds,
        collision,
      }).slice(0, 24)}`;
    }
    allocatedSceneIds.add(candidateId);
    return candidateId;
  };
  const occurrenceByFingerprint = new Map();
  const next = parsed.scenes.map((candidate, index) => {
    let matched = preMatchedByCandidateIndex.get(index) || null;
    const derivedFromSceneIds = lineageByCandidateIndex.get(index) || [];
    const lineageCreated = derivedFromSceneIds.length > 0;
    const exact = (exactByDigest.get(candidate.sourceDigest) || [])
      .filter((scene) => unmatched.has(scene.sceneId) && !lineageParentIds.has(scene.sceneId));
    if (exact.length === 1) matched = exact[0];
    if (!matched && !lineageCreated) {
      const sameTitle = previous.filter((scene) => (
        unmatched.has(scene.sceneId)
        && !lineageParentIds.has(scene.sceneId)
        && normalizedTitle(scene.title) === normalizedTitle(candidate.title)
      ));
      if (sameTitle.length === 1 && similarity(sourceTextForPreviousScene(sameTitle[0]), candidate.sourceText) >= 0.55) {
        matched = sameTitle[0];
      }
    }
    if (!matched && !lineageCreated) {
      const ranked = previous
        .filter((scene) => unmatched.has(scene.sceneId) && !lineageParentIds.has(scene.sceneId))
        .map((scene) => ({ scene, score: similarity(sourceTextForPreviousScene(scene), candidate.sourceText) }))
        .sort((left, right) => right.score - left.score);
      if (ranked[0]?.score >= 0.78 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.12)) {
        matched = ranked[0].scene;
      }
    }
    if (matched) unmatched.delete(matched.sceneId);
    const fingerprint = `${candidate.sourceDigest}:${normalizedTitle(candidate.title)}`;
    const occurrence = (occurrenceByFingerprint.get(fingerprint) || 0) + 1;
    occurrenceByFingerprint.set(fingerprint, occurrence);
    const sceneId = matched?.sceneId || allocateSceneId(candidate, occurrence, derivedFromSceneIds);
    if (matched) allocatedSceneIds.add(matched.sceneId);
    const orderKey = String((index + 1) * 10).padStart(8, '0');
    if (!matched) {
      return emptySceneRecord(
        scriptId,
        documentVersionId,
        candidate,
        sceneId,
        orderKey,
        derivedFromSceneIds,
      );
    }
    const sourceChanged = matched.sourceRef?.digest !== candidate.sourceDigest;
    return {
      ...matched,
      orderKey,
      title: candidate.title,
      sourceRef: {
        documentVersionId,
        span: { start: candidate.start, end: candidate.end },
        digest: candidate.sourceDigest,
      },
      sourceText: String(candidate.sourceText == null ? '' : candidate.sourceText),
      sourcePartCount: 1,
      acceptedSourcePartCount: sourceChanged ? 0 : Math.max(0, Math.trunc(Number(
        matched.acceptedSourcePartCount ?? matched.currentSourcePartIndex,
      ) || 0)),
      draftSourcePartId: sourceChanged ? null : text(matched.draftSourcePartId, 160) || null,
      status: sourceChanged && matched.status === 'confirmed' ? 'stale' : matched.status,
      recordRevision: sourceChanged ? Math.max(1, Number(matched.recordRevision) || 1) + 1 : matched.recordRevision,
      deleted: false,
    };
  });
  const tombstones = [...unmatched.values()].map((scene) => ({
    ...scene,
    status: 'stale',
    deleted: true,
    recordRevision: Math.max(1, Number(scene.recordRevision) || 1) + 1,
  }));
  return { scriptId, documentVersionId, parsed, scenes: [...next, ...tombstones] };
}

function currentVersionByScope(currentVersions) {
  return new Map((Array.isArray(currentVersions) ? currentVersions : []).map((version) => [
    `${version.kind}\u0000${normalizeScopeKey(version.scopeKey)}`,
    version,
  ]));
}

function rootVersion(currentVersions, kind) {
  return (Array.isArray(currentVersions) ? currentVersions : []).find((version) => (
    version.kind === kind && normalizeScopeKey(version.scopeKey) === 'root'
  )) || null;
}

function buildLongScriptStyleCanon(input = {}) {
  const productionBrief = rootVersion(input.currentVersions, 'ProductionBrief');
  const worldBible = rootVersion(input.currentVersions, 'WorldBible');
  const brief = input.workingBrief && typeof input.workingBrief === 'object'
    && !Array.isArray(input.workingBrief) ? input.workingBrief : {};
  const productionFields = productionBrief?.fields || {};
  const worldFields = worldBible?.fields || {};
  const canon = {
    schema: LONG_SCRIPT_STYLE_CANON_SCHEMA,
    style: text(productionFields.style || brief.style, 2_000),
    tone: text(productionFields.tone, 1_000),
    constraints: productionFields.constraints == null
      ? text(brief.constraints, 2_000)
      : typeof productionFields.constraints === 'string'
        ? text(productionFields.constraints, 4_000)
        : safeState(productionFields.constraints),
    decisions: text(productionFields.notes || brief.decisions, 2_000),
    worldRules: safeState(worldFields.rules),
    worldContinuity: safeState(worldFields.continuity),
  };
  const hasCanon = [canon.style, canon.tone, canon.decisions].some(Boolean)
    || (typeof canon.constraints === 'string' ? Boolean(canon.constraints) : Object.keys(canon.constraints).length > 0)
    || Object.keys(canon.worldRules).length > 0
    || Object.keys(canon.worldContinuity).length > 0;
  return hasCanon ? canon : null;
}

function prepareLongScriptProductionBriefMutation(input = {}) {
  const current = rootVersion(input.currentVersions, 'ProductionBrief');
  const brief = input.workingBrief && typeof input.workingBrief === 'object'
    && !Array.isArray(input.workingBrief) ? input.workingBrief : {};
  const currentFields = current?.fields && typeof current.fields === 'object'
    && !Array.isArray(current.fields) ? current.fields : {};
  const nextFields = { ...currentFields };
  const assignments = {
    outcome: text(brief.goal, 2_000),
    format: text(brief.format, 1_000),
    audience: text(brief.audience, 1_000),
    style: text(brief.style, 2_000),
    constraints: text(brief.constraints, 4_000),
    notes: text(brief.decisions, 4_000),
  };
  Object.entries(assignments).forEach(([field, value]) => {
    // Empty model fields must not erase a canon that was already accepted.
    if (value) nextFields[field] = value;
  });
  const hasMeaningfulField = ['outcome', 'format', 'audience', 'style', 'constraints', 'notes']
    .some((field) => nextFields[field] != null && text(nextFields[field], 4_000));
  if (!hasMeaningfulField || stableString(nextFields) === stableString(currentFields)) return null;
  const title = text(input.title || current?.title, 240) || '长剧本创作简报';
  return {
    kind: 'ProductionBrief',
    scopeKey: 'root',
    title,
    fields: nextFields,
    baseVersionId: current?.versionId || null,
    source: input.mutationSource,
  };
}

function readLongScriptWork(currentVersions = [], snapshot = null, options = {}) {
  const versions = Array.isArray(currentVersions) ? currentVersions : [];
  const partialSourceSceneIds = new Set((Array.isArray(options.partialSourceSceneIds)
    ? options.partialSourceSceneIds : []).map((item) => text(item, 160)).filter(Boolean));
  const partialSourceRead = partialSourceSceneIds.size > 0;
  const root = versions.find((version) => (
    version.kind === 'ScriptDoc' && normalizeScopeKey(version.scopeKey) === 'root'
  )) || null;
  const manifest = root?.fields?.manifest || null;
  const documentVersionId = text(manifest?.documentVersionId, 160);
  const allowedSceneScopes = new Set((Array.isArray(manifest?.sceneShardKeys)
    ? manifest.sceneShardKeys : []).map(normalizeScopeKey));
  const allowedSourceScopes = new Set((Array.isArray(manifest?.sourceShardKeys)
    ? manifest.sourceShardKeys : []).map(normalizeScopeKey));
  const scenes = versions
    .filter((version) => {
      const scopeKey = normalizeScopeKey(version.scopeKey);
      return version.kind === 'ScriptDoc' && scopeKey.startsWith('scene-')
        && (!allowedSceneScopes.size || allowedSceneScopes.has(scopeKey));
    })
    .flatMap((version) => Array.isArray(version.fields?.scenes) ? version.fields.scenes : []);
  const entities = versions
    .filter((version) => version.kind === 'CharacterBible' && normalizeScopeKey(version.scopeKey).startsWith('entity-'))
    .flatMap((version) => Array.isArray(version.fields?.characters) ? version.fields.characters : []);
  const relationships = versions
    .filter((version) => version.kind === 'CharacterBible'
      && normalizeScopeKey(version.scopeKey).startsWith('relationship-'))
    .flatMap((version) => Array.isArray(version.fields?.relationships) ? version.fields.relationships : [])
    .filter((relationship) => relationship?.schema === LONG_SCRIPT_RELATIONSHIP_SCHEMA
      && relationship.deleted !== true);
  const invalidSourceSceneIds = [];
  const decodedSourceParts = versions
    .filter((version) => {
      const scopeKey = normalizeScopeKey(version.scopeKey);
      return version.kind === 'ScriptDoc'
        && scopeKey.startsWith('source-')
        && (!allowedSourceScopes.size || allowedSourceScopes.has(scopeKey));
    })
    .flatMap((version) => {
      const shard = version.fields?.source;
      if (!shard || shard.schema !== LONG_SCRIPT_SOURCE_SHARD_SCHEMA
        || text(shard.documentVersionId, 160) !== documentVersionId) return [];
      return (Array.isArray(shard.parts) ? shard.parts : []).flatMap((rawPart) => {
        const decoded = decodeSceneSourcePart(rawPart);
        if (!decoded) {
          const sceneId = text(rawPart?.sceneId, 160);
          if (sceneId) invalidSourceSceneIds.push(sceneId);
          return [];
        }
        return [decoded];
      });
    });
  const draftsByScenePartId = new Map();
  versions
    .filter((version) => version.kind === 'ScriptDoc'
      && normalizeScopeKey(version.scopeKey).startsWith('scene-draft-'))
    .forEach((version) => {
      const draft = version.fields?.dialogue;
      const scenePartId = text(draft?.scenePartId, 160);
      const draftText = text(draft?.draftText, 12_000);
      if (draft?.schema !== LONG_SCRIPT_SCENE_DRAFT_SCHEMA || !scenePartId || !draftText
        || text(draft?.draftDigest, 64) !== digest(draftText)) return;
      draftsByScenePartId.set(scenePartId, {
        ...draft,
        sceneId: text(draft.sceneId, 160),
        scenePartId,
        sourceDigest: text(draft.sourceDigest, 64),
        draftText,
        draftDigest: digest(draftText),
        versionId: version.versionId || null,
        scopeKey: normalizeScopeKey(version.scopeKey),
      });
    });
  const sourcePartsBySceneId = new Map();
  decodedSourceParts.forEach((part) => {
    sourcePartsBySceneId.set(part.sceneId, [...(sourcePartsBySceneId.get(part.sceneId) || []), part]);
  });
  const sourceTextBySceneId = new Map();
  const sourceIntegrityErrors = [...invalidSourceSceneIds];
  const sceneIdCounts = new Map();
  scenes.forEach((scene) => {
    const sceneId = text(scene?.sceneId, 160);
    sceneIdCounts.set(sceneId, (sceneIdCounts.get(sceneId) || 0) + 1);
  });
  const partIdCounts = new Map();
  decodedSourceParts.forEach((part) => {
    partIdCounts.set(part.scenePartId, (partIdCounts.get(part.scenePartId) || 0) + 1);
  });
  scenes.forEach((scene) => {
    if (partialSourceRead && !partialSourceSceneIds.has(text(scene?.sceneId, 160))) return;
    const expected = Math.max(0, Math.trunc(Number(scene?.sourcePartCount) || 0));
    if (!expected) return;
    const parts = (sourcePartsBySceneId.get(scene.sceneId) || [])
      .sort((left, right) => left.index - right.index);
    const uniqueIndices = new Set(parts.map((part) => part.index));
    const acceptedCount = Math.max(0, Math.trunc(Number(
      scene.acceptedSourcePartCount ?? scene.currentSourcePartIndex,
    ) || 0));
    const currentIndex = Math.min(expected - 1, acceptedCount);
    const valid = sceneIdCounts.get(scene.sceneId) === 1
      && parts.length === expected
      && uniqueIndices.size === expected
      && acceptedCount <= expected
      && (scene.status === 'confirmed' ? acceptedCount === expected : acceptedCount < expected)
      && parts.every((part, index) => part.index === index
        && part.total === expected
        && part.documentVersionId === documentVersionId
        && part.sceneId === scene.sceneId
        && partIdCounts.get(part.scenePartId) === 1)
      && (!scene.draftSourcePartId
        || parts[currentIndex]?.scenePartId === scene.draftSourcePartId)
      && parts[0]?.span?.start === Math.max(0, Math.trunc(Number(scene.sourceRef?.span?.start) || 0))
      && parts[parts.length - 1]?.span?.end === Math.max(0, Math.trunc(Number(scene.sourceRef?.span?.end) || 0))
      && parts.every((part, index) => index === 0 || parts[index - 1].span.end === part.span.start);
    const reconstructed = valid ? parts.map((part) => part.sourceText).join('') : '';
    if (!valid || digest(reconstructed) !== text(scene.sourceRef?.digest, 64)) {
      sourceIntegrityErrors.push(scene.sceneId);
      return;
    }
    sourceTextBySceneId.set(scene.sceneId, reconstructed);
  });
  const orderedScenes = activeScenes(scenes);
  const productionBySceneId = new Map();
  orderedScenes.forEach((scene) => {
    const production = readSceneProduction(versions, scene.sceneId);
    if (production) productionBySceneId.set(scene.sceneId, production);
  });
  let sourceDocumentIntegrity = partialSourceRead ? null : true;
  if (!partialSourceRead && Math.max(0, Math.trunc(Number(manifest?.sourcePartCount) || 0)) > 0) {
    const currentDocumentScenes = orderedScenes.filter((scene) => (
      text(scene.sourceRef?.documentVersionId, 160) === documentVersionId
    ));
    const spansAreContinuous = currentDocumentScenes.length > 0
      && Math.max(0, Math.trunc(Number(currentDocumentScenes[0]?.sourceRef?.span?.start) || 0)) === 0
      && currentDocumentScenes.every((scene, index) => index === 0
        || Math.max(0, Math.trunc(Number(currentDocumentScenes[index - 1]?.sourceRef?.span?.end) || 0))
          === Math.max(0, Math.trunc(Number(scene.sourceRef?.span?.start) || 0)))
      && Math.max(0, Math.trunc(Number(currentDocumentScenes[currentDocumentScenes.length - 1]?.sourceRef?.span?.end) || 0))
        === Math.max(0, Math.trunc(Number(root?.fields?.source?.characterCount) || 0));
    const reconstructedDocument = currentDocumentScenes
      .map((scene) => sourceTextBySceneId.get(scene.sceneId) || '').join('');
    const manifestIsConsistent = Math.max(0, Math.trunc(Number(manifest?.sceneCount) || 0))
        === currentDocumentScenes.length
      && Math.max(0, Math.trunc(Number(manifest?.sourcePartCount) || 0))
        === decodedSourceParts.length
      && Math.max(0, Math.trunc(Number(manifest?.sourceShardCount) || 0))
        === allowedSourceScopes.size
      && text(root?.fields?.source?.documentVersionId, 160) === documentVersionId
      && text(root?.fields?.source?.digest, 64) === text(manifest?.sourceDigest, 64);
    sourceDocumentIntegrity = manifestIsConsistent && spansAreContinuous
      && currentDocumentScenes.every((scene) => sourceTextBySceneId.has(scene.sceneId))
      && digest(reconstructedDocument) === text(manifest?.sourceDigest, 64);
    if (!sourceDocumentIntegrity) {
      currentDocumentScenes.forEach((scene) => sourceIntegrityErrors.push(scene.sceneId));
    }
  }
  return {
    schema: LONG_SCRIPT_ROOT_SCHEMA,
    scriptId: text(root?.fields?.manifest?.scriptId, 120),
    title: text(root?.fields?.title || root?.title, 240),
    source: root?.fields?.source || null,
    manifest,
    scenes,
    activeScenes: orderedScenes,
    entities,
    relationships,
    productionBySceneId,
    sourcePartsBySceneId,
    sourceTextBySceneId,
    draftsByScenePartId,
    sourceIntegrityErrors: [...new Set(sourceIntegrityErrors)],
    sourceDocumentIntegrity,
    snapshot,
    currentSceneId: orderedScenes[0]?.sceneId || null,
  };
}

function prepareLongScriptImport(input = {}) {
  const parsed = splitLongScriptScenes(input.source);
  if (!parsed.scenes.length
    || ((!parsed.explicitHeadings || parsed.scenes.length < 2) && input.allowSingleScene !== true)) return null;
  if (input.allowSingleScene === true && parsed.scenes.length === 1
    && parsed.scenes[0].title === '完整剧本') {
    parsed.scenes[0].title = text(parsed.scenes[0].sourceText.split('\n').find((line) => line.trim()), 60)
      || '场景 1';
  }
  const previousWork = input.previousWork || readLongScriptWork(
    input.currentVersions, input.existingSnapshot,
  );
  const scriptId = previousWork.scriptId
    || `script_${digest({ sessionId: text(input.sessionId, 180), seed: parsed.scenes[0]?.sourceDigest }).slice(0, 24)}`;
  const documentVersionId = `source_${digest(parsed.source).slice(0, 24)}`;
  const reconciled = reconcileLongScriptScenes({
    sessionId: input.sessionId,
    scriptId,
    documentVersionId,
    source: parsed.source,
    previousScenes: previousWork.scenes,
    previousSourceBySceneId: previousWork.sourceTextBySceneId,
  });
  const versionByScope = currentVersionByScope(input.currentVersions);
  const sceneBuckets = new Map();
  const sourceParts = [];
  reconciled.scenes.forEach((scene) => {
    if (scene.deleted !== true && scene.sourceRef?.documentVersionId === documentVersionId) {
      const completeSource = parsed.source.slice(scene.sourceRef.span.start, scene.sourceRef.span.end);
      const parts = splitSceneSourceParts(scene, completeSource);
      const previousScene = previousWork.scenes.find((candidate) => candidate.sceneId === scene.sceneId);
      const sourceUnchanged = previousScene?.sourceRef?.digest === scene.sourceRef?.digest;
      const previousAcceptedCount = previousScene?.acceptedSourcePartCount
        ?? previousScene?.currentSourcePartIndex
        ?? (previousScene?.status === 'confirmed' ? parts.length : 0);
      const acceptedSourcePartCount = sourceUnchanged
        ? Math.min(parts.length, Math.max(0, Math.trunc(Number(previousAcceptedCount) || 0)))
        : 0;
      scene.sourcePartCount = parts.length;
      scene.acceptedSourcePartCount = acceptedSourcePartCount;
      scene.draftSourcePartId = sourceUnchanged ? text(previousScene.draftSourcePartId, 160) || null : null;
      delete scene.currentSourcePartIndex;
      delete scene.currentSourcePartId;
      sourceParts.push(...parts);
    }
    const sceneScope = sceneScopeKey(scene.sceneId);
    const persistedScene = { ...scene };
    delete persistedScene.sourceText;
    sceneBuckets.set(sceneScope, [...(sceneBuckets.get(sceneScope) || []), persistedScene]);
  });
  const active = activeScenes(reconciled.scenes);
  const orderBuckets = new Map();
  [...reconciled.scenes]
    .sort((left, right) => String(left.orderKey).localeCompare(String(right.orderKey))
      || String(left.sceneId).localeCompare(String(right.sceneId)))
    .forEach((scene, index) => {
      const page = Math.floor(index / ORDER_SHARD_SIZE);
      const scopeKey = normalizeScopeKey(`order-${String(page).padStart(4, '0')}`);
      orderBuckets.set(scopeKey, [...(orderBuckets.get(scopeKey) || []), {
        sceneId: scene.sceneId,
        orderKey: scene.orderKey,
        title: scene.title,
        status: scene.status,
        recordRevision: Math.max(1, Math.trunc(Number(scene.recordRevision) || 1)),
        sourceDigest: scene.sourceRef?.digest || null,
        deleted: scene.deleted === true,
      }]);
    });
  const sourceShards = packSceneSourceShards(sourceParts, documentVersionId);
  const sourceShardKeysBySceneId = new Map();
  sourceShards.forEach((parts, scopeKey) => {
    new Set(parts.map((part) => text(part?.sceneId, 160)).filter(Boolean)).forEach((sceneId) => {
      sourceShardKeysBySceneId.set(sceneId, [
        ...(sourceShardKeysBySceneId.get(sceneId) || []),
        scopeKey,
      ]);
    });
  });
  reconciled.scenes.forEach((scene) => {
    scene.sourceShardKeys = scene.deleted === true
      ? [] : [...new Set(sourceShardKeysBySceneId.get(scene.sceneId) || [])].sort();
  });
  sceneBuckets.forEach((scenes) => {
    scenes.forEach((scene) => {
      scene.sourceShardKeys = scene.deleted === true
        ? [] : [...new Set(sourceShardKeysBySceneId.get(scene.sceneId) || [])].sort();
    });
  });
  const sourceDigest = digest(parsed.source);
  const source = {
    documentVersionId,
    digest: sourceDigest,
    characterCount: parsed.source.length,
    preamble: text(parsed.preamble, 8_000),
    kind: text(input.sourceKind, 40) || 'message',
    assetId: text(input.sourceAssetId, 180) || null,
  };
  const manifest = {
    schema: LONG_SCRIPT_ROOT_SCHEMA,
    scriptId,
    documentVersionId,
    sceneCount: active.length,
    tombstoneCount: reconciled.scenes.length - active.length,
    sceneShardCount: SCENE_SHARD_COUNT,
    orderShardCount: orderBuckets.size,
    orderShardSize: ORDER_SHARD_SIZE,
    sceneShardKeys: [...sceneBuckets.keys()].sort(),
    orderShardKeys: [...orderBuckets.keys()].sort(),
    sourceShardCount: sourceShards.size,
    sourceShardKeys: [...sourceShards.keys()].sort(),
    sourcePartCount: sourceParts.length,
    sourceDigest,
  };
  const mutations = [{
    kind: 'ScriptDoc', scopeKey: 'root',
    title: text(input.title, 240) || previousWork.title || '长剧本',
    fields: {
      title: text(input.title, 240) || previousWork.title || '长剧本',
      synopsis: text(parsed.preamble, 8_000),
      manifest,
      source,
    },
    baseVersionId: versionByScope.get('ScriptDoc\u0000root')?.versionId || null,
    source: input.mutationSource,
  }];
  [...sceneBuckets.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([scopeKey, scenes]) => {
    mutations.push({
      kind: 'ScriptDoc', scopeKey, title: `场次分片 ${scopeKey.slice(-2)}`,
      fields: { scenes: scenes.sort((left, right) => left.sceneId.localeCompare(right.sceneId)) },
      baseVersionId: versionByScope.get(`ScriptDoc\u0000${scopeKey}`)?.versionId || null,
      source: input.mutationSource,
    });
  });
  [...orderBuckets.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([scopeKey, scenes]) => {
    mutations.push({
      kind: 'ScriptDoc', scopeKey, title: `场序分片 ${scopeKey.slice(-2)}`,
      fields: { scenes: scenes.sort((left, right) => String(left.orderKey).localeCompare(String(right.orderKey))) },
      baseVersionId: versionByScope.get(`ScriptDoc\u0000${scopeKey}`)?.versionId || null,
      source: input.mutationSource,
    });
  });
  [...sourceShards.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([scopeKey, parts]) => {
    mutations.push({
      kind: 'ScriptDoc', scopeKey, title: `原文分片 ${scopeKey.slice('source-'.length)}`,
      fields: {
        source: {
          schema: LONG_SCRIPT_SOURCE_SHARD_SCHEMA,
          documentVersionId,
          parts,
        },
      },
      baseVersionId: versionByScope.get(`ScriptDoc\u0000${scopeKey}`)?.versionId || null,
      source: input.mutationSource,
    });
  });
  const previewSourcePartsBySceneId = new Map();
  sourceParts.forEach((part) => {
    previewSourcePartsBySceneId.set(part.sceneId, [
      ...(previewSourcePartsBySceneId.get(part.sceneId) || []),
      decodeSceneSourcePart({ ...part, documentVersionId }),
    ].filter(Boolean));
  });
  const previewSourceTextBySceneId = new Map(parsed.scenes.map((scene, index) => [
    active[index]?.sceneId,
    scene.sourceText,
  ]).filter(([sceneId]) => sceneId));
  return {
    schema: LONG_SCRIPT_ROOT_SCHEMA,
    taskProfile: {
      family: 'story', intent: '逐场制作长剧本', deliveryKind: 'long-form-story',
      modalities: ['text', 'image', 'video', 'audio'], qualityMode: 'standard',
    },
    expectedWorkRevision: input.existingSnapshot?.revision || 0,
    mutations,
    previewWork: {
      schema: LONG_SCRIPT_ROOT_SCHEMA,
      scriptId,
      title: mutations[0].fields.title,
      source,
      manifest,
      scenes: reconciled.scenes,
      activeScenes: active,
      entities: previousWork.entities || [],
      relationships: previousWork.relationships || [],
      sourcePartsBySceneId: previewSourcePartsBySceneId,
      sourceTextBySceneId: previewSourceTextBySceneId,
      draftsByScenePartId: previousWork.draftsByScenePartId || new Map(),
      sourceIntegrityErrors: [],
      sourceDocumentIntegrity: true,
      snapshot: input.existingSnapshot || null,
      currentSceneId: active[0]?.sceneId || null,
    },
  };
}

function latestConfirmedExitBefore(work, scene, entityId) {
  const prior = activeScenes(work?.scenes)
    .filter((candidate) => String(candidate.orderKey) < String(scene.orderKey)
      && candidate.status === 'confirmed'
      && candidate.exitState && Object.prototype.hasOwnProperty.call(candidate.exitState, entityId))
    .sort((left, right) => String(right.orderKey).localeCompare(String(left.orderKey)))[0];
  return prior ? {
    entityId,
    fromSceneId: prior.sceneId,
    exitDigest: digest(prior.exitState[entityId]),
    state: prior.exitState[entityId],
  } : null;
}

function sceneById(work) {
  return new Map(activeScenes(work?.scenes).map((scene) => [text(scene?.sceneId, 160), scene]));
}

function effectiveRelationshipsBefore(work, scene) {
  if (!scene) return [];
  const scenes = sceneById(work);
  const latestByKey = new Map();
  (Array.isArray(work?.relationships) ? work.relationships : [])
    .filter((relationship) => relationship?.schema === LONG_SCRIPT_RELATIONSHIP_SCHEMA
      && relationship.deleted !== true)
    .forEach((relationship) => {
      const sourceScene = scenes.get(text(relationship?.sourceSceneId, 160));
      if (!sourceScene || sourceScene.status !== 'confirmed'
        || String(sourceScene.orderKey) >= String(scene.orderKey)
        || text(relationship?.effectiveFromSceneId, 160) !== sourceScene.sceneId) return;
      const key = text(relationship?.relationshipKey, 160);
      if (!key) return;
      const previous = latestByKey.get(key);
      if (!previous || String(sourceScene.orderKey) > String(scenes.get(previous.sourceSceneId)?.orderKey || '')
        || (String(sourceScene.orderKey) === String(scenes.get(previous.sourceSceneId)?.orderKey || '')
          && Math.max(1, Number(relationship.revision) || 1) > Math.max(1, Number(previous.revision) || 1))) {
        latestByKey.set(key, relationship);
      }
    });
  return [...latestByKey.values()]
    .sort((left, right) => String(left.relationshipKey).localeCompare(String(right.relationshipKey)));
}

function relationshipContinuityForEntity(work, scene, entityId) {
  const relationships = effectiveRelationshipsBefore(work, scene)
    .filter((relationship) => text(relationship?.subjectEntityId, 160) === entityId
      || text(relationship?.objectEntityId, 160) === entityId)
    .map((relationship) => ({
      relationshipId: text(relationship.relationshipId, 160),
      relationshipKey: text(relationship.relationshipKey, 160),
      subjectEntityId: text(relationship.subjectEntityId, 160),
      objectEntityId: text(relationship.objectEntityId, 160),
      type: text(relationship.type, 120),
      description: text(relationship.description, 2_000),
      state: safeState(relationship.state),
      active: relationship.active !== false,
      effectiveFromSceneId: text(relationship.effectiveFromSceneId, 160),
    }));
  return {
    relationships,
    relationshipDigest: digest(relationships),
  };
}

function currentSceneSourcePart(work, scene) {
  if (!scene) return null;
  const declaredCount = Math.max(0, Math.trunc(Number(scene.sourcePartCount) || 0));
  if (!declaredCount) {
    const sourceText = String(scene.sourceText == null ? '' : scene.sourceText);
    return {
      schema: LONG_SCRIPT_SCENE_PART_SCHEMA,
      scenePartId: null,
      sceneId: scene.sceneId,
      index: 0,
      total: 1,
      span: scene.sourceRef?.span || { start: 0, end: sourceText.length },
      digest: digest(sourceText),
      sourceText,
      legacy: true,
    };
  }
  if ((Array.isArray(work?.sourceIntegrityErrors) ? work.sourceIntegrityErrors : []).includes(scene.sceneId)) {
    return null;
  }
  const parts = work?.sourcePartsBySceneId instanceof Map
    ? work.sourcePartsBySceneId.get(scene.sceneId) || [] : [];
  if (parts.length !== declaredCount) return null;
  const acceptedCount = Math.min(declaredCount, Math.max(0, Math.trunc(Number(
    scene.acceptedSourcePartCount ?? scene.currentSourcePartIndex,
  ) || 0)));
  const index = Math.min(declaredCount - 1, acceptedCount);
  const part = parts.find((candidate) => candidate.index === index) || null;
  if (!part) return null;
  return part;
}

function explicitContinuityTerms(value) {
  const source = text(value, 8_000);
  const terms = [];
  const capture = (pattern) => {
    for (const match of source.matchAll(pattern)) {
      const term = text(match?.[1], 80)
        .replace(/(?:状态|不变)$/u, '')
        .trim();
      if (term.length >= 2) terms.push(term);
    }
  };
  capture(/(?:身穿|穿着|穿)\s*[“"']?([^、“”"'，。；;！？\n和与及并]{2,40})/gu);
  capture(/(?:缠着|缠有|绑着|绑有|戴着|戴有)\s*[“"']?([^、“”"'，。；;！？\n和与及并]{2,40})/gu);
  capture(/(?:握着|拿着|持有|带着|携带)\s*[“"']?([^、“”"'，。；;！？\n和与及并]{2,40})/gu);
  capture(/(?:wear(?:s|ing)?|dressed in)\s+["']?([^,"'.!?;\n]{2,80})/giu);
  capture(/(?:hold(?:s|ing)?|carr(?:y|ies|ying)|has)\s+["']?([^,"'.!?;\n]{2,80})/giu);
  return [...new Set(terms)].slice(0, 12);
}

function explicitContinuitySubjectNames(value) {
  const source = text(value, 8_000);
  const names = [];
  for (const match of source.matchAll(
    /(?:新增|创建|引入)\s*(?:人物|角色|地点|服装|道具)?\s*[“"']?([^、“”"'，。；;！？\n]{2,40})/gu,
  )) {
    const name = text(match?.[1], 80).trim();
    if (name) names.push(name);
  }
  return [...new Set(names)].slice(0, 12);
}

function continuityRequirements(value, entityContexts = []) {
  const source = text(value, 8_000);
  const matches = [];
  const register = (name, canonicalName = name) => {
    const needle = text(name, 160);
    if (!needle) return;
    let offset = 0;
    while (offset < source.length) {
      const index = source.indexOf(needle, offset);
      if (index < 0) break;
      matches.push({ index, length: needle.length, subjectName: text(canonicalName, 160) });
      offset = index + needle.length;
    }
  };
  (Array.isArray(entityContexts) ? entityContexts : []).forEach((item) => {
    const entity = item?.baseline;
    const canonicalName = text(entity?.name, 160);
    if (!canonicalName) return;
    register(canonicalName, canonicalName);
    (Array.isArray(entity?.aliases) ? entity.aliases : []).forEach((alias) => register(alias, canonicalName));
  });
  explicitContinuitySubjectNames(source).forEach((name) => register(name, name));
  matches.sort((left, right) => left.index - right.index || right.length - left.length);
  const uniqueMatches = matches.filter((match, index) => !matches.slice(0, index).some((prior) => (
    prior.index === match.index && prior.subjectName === match.subjectName
  )));
  const requirements = [];
  uniqueMatches.forEach((match, index) => {
    const next = uniqueMatches.slice(index + 1).find((candidate) => candidate.index > match.index);
    const sentenceEnd = source.slice(match.index + match.length).search(/[。！？.!?\n]/u);
    const sentenceBoundary = sentenceEnd < 0
      ? source.length : match.index + match.length + sentenceEnd + 1;
    const end = Math.min(next?.index ?? source.length, sentenceBoundary);
    const segment = source.slice(match.index + match.length, end);
    const terms = explicitContinuityTerms(segment);
    if (!terms.length) return;
    const existing = requirements.find((item) => normalizedTitle(item.subjectName) === normalizedTitle(match.subjectName));
    if (existing) existing.terms = [...new Set([...existing.terms, ...terms])].slice(0, 12);
    else requirements.push({ subjectName: match.subjectName, terms });
  });
  return requirements.slice(0, 12);
}

function buildSceneContextPack(input = {}) {
  const work = input.work || {};
  const scene = activeScenes(work.scenes).find((candidate) => candidate.sceneId === input.sceneId)
    || activeScenes(work.scenes)[0];
  if (!scene) return null;
  const sourcePart = currentSceneSourcePart(work, scene);
  if (!sourcePart) return null;
  const entityById = new Map((Array.isArray(work.entities) ? work.entities : [])
    .map((entity) => [text(entity?.entityId || entity?.id, 160), entity]));
  const activeEntityIds = [...new Set((Array.isArray(scene.activeEntityIds)
    ? scene.activeEntityIds : []).map((item) => text(item, 160)).filter(Boolean))];
  const continuityResetEntityIds = new Set(stringList(scene.continuityResetEntityIds, 64, 160));
  const entityContextFor = (entityId) => {
    const resetAtScene = continuityResetEntityIds.has(entityId);
    return {
      entityId,
      baseline: entityById.get(entityId) || null,
      entry: {
        ...(resetAtScene ? {
          entityId, fromSceneId: null, exitDigest: null, state: null, resetAtScene: true,
        } : (latestConfirmedExitBefore(work, scene, entityId) || {
          entityId, fromSceneId: null, exitDigest: null, state: null,
        })),
        ...(resetAtScene ? { relationships: [], relationshipDigest: digest([]) }
          : relationshipContinuityForEntity(work, scene, entityId)),
      },
    };
  };
  const entityContext = activeEntityIds.map(entityContextFor);
  const mentionHaystack = normalizedSceneBody(`${sourcePart.sourceText || ''}\n${input.userIntent || ''}`);
  const mentionedEntities = (Array.isArray(work.entities) ? work.entities : [])
    .filter((entity) => {
      const entityId = text(entity?.entityId || entity?.id, 160);
      if (!entityId || activeEntityIds.includes(entityId)) return false;
      const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
        .map((value) => normalizedTitle(value)).filter((value) => value.length >= 2);
      return names.some((name) => mentionHaystack.includes(name));
    })
    .slice(0, 24)
    .map((entity) => entityContextFor(text(entity?.entityId || entity?.id, 160)));
  const userIntent = text(input.userIntent, 8_000);
  const requiresExitState = /(?:(?:本场|当前场|这场|场景)[^。！？\n]{0,24}(?:结束|结尾|离场)|(?:离场|结束时?)状态)[^。！？\n]{0,120}(?:仍|保持|状态|穿|戴|拿|握|持有|带着|受伤|伤势|绷带|道具)/u.test(userIntent)
    || /(?:by the end of|at the end of|when leaving|exit state)[^.!?\n]{0,160}(?:still|wear|hold|carry|injur|state)/iu.test(userIntent);
  const requiredContinuityBySubject = requiresExitState
    ? continuityRequirements(userIntent, [...entityContext, ...mentionedEntities]) : [];
  const requiredContinuityTerms = [...new Set(requiredContinuityBySubject.flatMap((item) => item.terms))]
    .slice(0, 12);
  const requiredContinuitySubjectNames = requiredContinuityBySubject.map((item) => item.subjectName);
  const contextualEntityIds = new Set([...entityContext, ...mentionedEntities]
    .map((item) => text(item?.entityId, 160)).filter(Boolean));
  const effectiveRelationships = effectiveRelationshipsBefore(work, scene)
    .filter((relationship) => contextualEntityIds.has(text(relationship?.subjectEntityId, 160))
      || contextualEntityIds.has(text(relationship?.objectEntityId, 160)));
  const production = work.productionBySceneId instanceof Map
    ? work.productionBySceneId.get(scene.sceneId) || null : null;
  const pack = {
    schema: LONG_SCRIPT_CONTEXT_SCHEMA,
    mode: ['import-preview', 'scene-draft'].includes(input.mode) ? input.mode : 'scene-edit',
    scriptId: text(work.scriptId, 120),
    workId: text(input.workSnapshot?.workId || work.snapshot?.workId, 80) || null,
    baseWorkRevision: Math.max(0, Math.trunc(Number(input.workSnapshot?.revision || work.snapshot?.revision) || 0)),
    baseWorkDigest: text(input.workSnapshot?.workDigest || work.snapshot?.workDigest, 64) || null,
    sceneId: scene.sceneId,
    scenePartId: sourcePart.scenePartId,
    scenePartIndex: sourcePart.index,
    scenePartCount: sourcePart.total,
    baseSceneRevision: Math.max(1, Math.trunc(Number(scene.recordRevision) || 1)),
    sourceRef: scene.sourceRef,
    sourcePartRef: {
      scenePartId: sourcePart.scenePartId,
      index: sourcePart.index,
      total: sourcePart.total,
      span: sourcePart.span,
      digest: sourcePart.digest,
    },
    userIntent,
    allowedPaths: [
      'purpose', 'objective', 'obstacle', 'turn', 'valueChange', 'activeEntityIds',
      'locationId', 'continuityResetEntityIds', 'exitState', 'hardConstraintIds', 'locks', 'status',
      'draftText',
    ],
    requiredPaths: [
      ...(input.mode === 'scene-draft' ? ['draftText'] : []),
      ...(requiresExitState ? ['exitState'] : []),
    ],
    requiredContinuityTerms,
    requiredContinuitySubjectNames,
    requiredContinuityBySubject,
    scene: {
      title: scene.title,
      sourceText: sourcePart.sourceText,
      draftText: text(work.draftsByScenePartId?.get(sourcePart.scenePartId)?.draftText, 12_000),
      purpose: scene.purpose,
      objective: scene.objective,
      obstacle: scene.obstacle,
      turn: scene.turn,
      valueChange: scene.valueChange,
      status: scene.status,
      locationId: scene.locationId,
      continuityResetEntityIds: [...continuityResetEntityIds],
      hardConstraintIds: scene.hardConstraintIds,
      locks: scene.locks,
    },
    activeEntities: entityContext,
    // Mentioned entities are read-only candidates selected by exact existing
    // names/aliases in the current source or user intent. They are not made
    // active until a version-bound ScenePatch explicitly references them.
    mentionedEntities,
    relationships: effectiveRelationships,
    styleCanon: input.styleCanon || null,
    currentShotPlan: production ? {
      schema: production.schema,
      planDigest: production.planDigest,
      shots: production.shots.map((shot) => {
        const prompt = production.prompts.find((item) => item.shotId === shot.shotId);
        return {
          shotId: shot.shotId,
          ordinal: shot.ordinal,
          title: shot.title,
          purpose: shot.purpose,
          prompt: prompt?.prompt || '',
          parameters: prompt?.parameters || shot.parameters || {},
          inputAssetIds: prompt?.inputAssetIds || shot.inputAssetIds || [],
        };
      }),
    } : null,
    unknowns: entityContext.filter((item) => !item.baseline).map((item) => `entity:${item.entityId}:baseline`),
  };
  pack.contextDigest = digest(pack);
  return pack;
}

function normalizeScenePatch(value, contextPack) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== LONG_SCRIPT_PATCH_SCHEMA || !contextPack) return null;
  if (contextPack.mode === 'import-preview') return null;
  if (text(value.sceneId, 160) !== contextPack.sceneId
    || (contextPack.scenePartId && text(value.scenePartId, 160) !== contextPack.scenePartId)
    || Math.max(0, Math.trunc(Number(value.baseWorkRevision) || 0)) !== contextPack.baseWorkRevision
    || Math.max(1, Math.trunc(Number(value.baseSceneRevision) || 0)) !== contextPack.baseSceneRevision
    || text(value.contextDigest, 64) !== contextPack.contextDigest) return null;
  const patch = value.patch && typeof value.patch === 'object' && !Array.isArray(value.patch)
    ? value.patch : null;
  if (!patch) return null;
  const allowed = new Set(contextPack.allowedPaths);
  if (Object.keys(patch).some((key) => !allowed.has(key))) return null;
  const required = new Set(Array.isArray(contextPack.requiredPaths) ? contextPack.requiredPaths : []);
  if ([...required].some((key) => !Object.prototype.hasOwnProperty.call(patch, key))) return null;
  if (Object.prototype.hasOwnProperty.call(patch, 'draftText')) {
    patch.draftText = text(patch.draftText, 12_000);
    if (!patch.draftText) return null;
  }
  const entityProposals = (Array.isArray(value.entityProposals) ? value.entityProposals : []).slice(0, 24);
  const allowedEntityKinds = new Set(['character', 'location', 'wardrobe', 'prop']);
  if (entityProposals.some((proposal) => !allowedEntityKinds.has(text(proposal?.kind, 40).toLowerCase()))) {
    return null;
  }
  const proposalTempIds = entityProposals.map((proposal) => text(proposal?.tempId, 160));
  if (proposalTempIds.some((tempId) => !tempId)
    || new Set(proposalTempIds).size !== proposalTempIds.length) return null;
  const activeRefs = new Set(Object.prototype.hasOwnProperty.call(patch, 'activeEntityIds')
    ? stringList(patch.activeEntityIds, 64, 160)
    : (Array.isArray(contextPack.activeEntities) ? contextPack.activeEntities : [])
      .map((item) => text(item?.entityId, 160)).filter(Boolean));
  const resetRefs = stringList(patch.continuityResetEntityIds, 64, 160);
  if (resetRefs.some((entityId) => !activeRefs.has(entityId))) return null;
  const locationRef = text(patch.locationId, 160);
  if (entityProposals.some((proposal, index) => {
    const tempId = proposalTempIds[index];
    const kind = text(proposal?.kind, 40).toLowerCase();
    // A current-scene entity proposal must take part in that same scene. This
    // prevents a half-commit where the Bible gains a person/prop but the scene
    // still says nobody is present. Locations may bind through locationId;
    // every other new entity must be listed explicitly as active.
    return kind === 'location'
      ? locationRef !== tempId && !activeRefs.has(tempId)
      : !activeRefs.has(tempId);
  })) return null;
  const hasRelationshipProposals = value.relationshipProposals != null;
  const relationshipProposals = hasRelationshipProposals
    ? (Array.isArray(value.relationshipProposals) ? value.relationshipProposals : null) : null;
  if (hasRelationshipProposals && relationshipProposals == null) return null;
  const normalizedRelationshipProposals = (relationshipProposals || []).slice(0, 24).map((proposal) => ({
    tempId: text(proposal?.tempId, 160),
    subjectEntityId: text(proposal?.subjectEntityId, 160),
    objectEntityId: text(proposal?.objectEntityId, 160),
    type: text(proposal?.type, 120),
    description: text(proposal?.description, 2_000),
    state: safeState(proposal?.state),
    active: proposal?.active !== false,
    effectiveFromSceneId: text(proposal?.effectiveFromSceneId, 160) || contextPack.sceneId,
  }));
  const allowedRelationshipRefs = new Set([...activeRefs, ...proposalTempIds]);
  if (normalizedRelationshipProposals.some((proposal) => !proposal.tempId
    || !proposal.subjectEntityId || !proposal.objectEntityId || !proposal.type
    || proposal.subjectEntityId === proposal.objectEntityId
    || !allowedRelationshipRefs.has(proposal.subjectEntityId)
    || !allowedRelationshipRefs.has(proposal.objectEntityId)
    || proposal.effectiveFromSceneId !== contextPack.sceneId)) return null;
  const relationshipTempIds = normalizedRelationshipProposals.map((proposal) => proposal.tempId);
  if (new Set(relationshipTempIds).size !== relationshipTempIds.length) return null;
  const relationshipKeys = normalizedRelationshipProposals.map((proposal) => digest({
    subjectEntityId: proposal.subjectEntityId,
    objectEntityId: proposal.objectEntityId,
    type: normalizedTitle(proposal.type),
  }));
  if (new Set(relationshipKeys).size !== relationshipKeys.length) return null;
  const exitState = safeState(patch.exitState);
  const exitStateEntries = Object.entries(exitState);
  if (exitStateEntries.some(([, state]) => (
    !state || typeof state !== 'object' || Array.isArray(state)
  ))) return null;
  // The commit path discards states whose keys are not active in this scene.
  // Validate the same effective set here so required facts cannot appear only
  // under a person's display name, a stale ID, or another non-committed key.
  if (exitStateEntries.some(([entityId]) => !activeRefs.has(text(entityId, 160)))) return null;
  if (required.has('exitState') && !exitStateEntries.length) return null;
  const requiredBySubject = (Array.isArray(contextPack.requiredContinuityBySubject)
    ? contextPack.requiredContinuityBySubject : []).slice(0, 12);
  const contextEntities = [...(Array.isArray(contextPack.activeEntities) ? contextPack.activeEntities : []),
    ...(Array.isArray(contextPack.mentionedEntities) ? contextPack.mentionedEntities : [])];
  for (const requirement of requiredBySubject) {
    const requiredName = normalizedTitle(requirement?.subjectName);
    const proposalIndex = entityProposals.findIndex((proposal) => normalizedTitle(proposal?.name) === requiredName);
    const known = contextEntities.find((item) => {
      const names = [item?.baseline?.name, ...(Array.isArray(item?.baseline?.aliases) ? item.baseline.aliases : [])]
        .map(normalizedTitle).filter(Boolean);
      return names.includes(requiredName);
    });
    const subjectRef = proposalIndex >= 0 ? proposalTempIds[proposalIndex] : text(known?.entityId, 160);
    if (!subjectRef || !exitState[subjectRef]) return null;
    const stateText = normalizedSceneBody(JSON.stringify(exitState[subjectRef]));
    if (stringList(requirement?.terms, 12, 80)
      .some((term) => !stateText.includes(normalizedSceneBody(term)))) return null;
  }
  if (required.has('exitState') && !requiredBySubject.length && !exitStateEntries.length) return null;
  return {
    schema: LONG_SCRIPT_PATCH_SCHEMA,
    sceneId: contextPack.sceneId,
    scenePartId: contextPack.scenePartId || null,
    baseWorkRevision: contextPack.baseWorkRevision,
    baseSceneRevision: contextPack.baseSceneRevision,
    contextDigest: contextPack.contextDigest,
    patch,
    entityProposals,
    relationshipProposals: hasRelationshipProposals ? normalizedRelationshipProposals : null,
    conflicts: (Array.isArray(value.conflicts) ? value.conflicts : []).slice(0, 24),
  };
}

function prepareScenePartAdvanceMutation(input = {}) {
  const work = input.work || readLongScriptWork(input.currentVersions, input.existingSnapshot);
  if (!work?.snapshot || Math.max(0, Math.trunc(Number(input.expectedWorkRevision) || 0))
    !== Math.max(0, Math.trunc(Number(work.snapshot.revision) || 0))) return null;
  const scene = activeScenes(work.scenes).find((candidate) => candidate.sceneId === input.sceneId);
  const currentPart = currentSceneSourcePart(work, scene);
  if (!scene || !currentPart || currentPart.index >= currentPart.total - 1) return null;
  const nextPart = (work.sourcePartsBySceneId.get(scene.sceneId) || [])
    .find((candidate) => candidate.index === currentPart.index + 1);
  if (!nextPart) return null;
  const next = {
    ...scene,
    acceptedSourcePartCount: currentPart.index + 1,
    draftSourcePartId: null,
    status: 'draft',
    recordRevision: Math.max(1, Math.trunc(Number(scene.recordRevision) || 1)) + 1,
  };
  const versionByScope = currentVersionByScope(input.currentVersions);
  const sceneScope = sceneScopeKey(scene.sceneId);
  const sceneVersion = versionByScope.get(`ScriptDoc\u0000${sceneScope}`);
  if (!sceneVersion) return null;
  const sceneShard = Array.isArray(sceneVersion.fields?.scenes) ? sceneVersion.fields.scenes : [];
  const nextSceneShard = sceneShard.map((candidate) => candidate.sceneId === scene.sceneId ? next : candidate);
  if (!nextSceneShard.some((candidate) => candidate.sceneId === scene.sceneId)) return null;
  return {
    expectedWorkRevision: work.snapshot.revision,
    currentSceneId: scene.sceneId,
    taskProfile: work.snapshot.taskProfile,
    mutations: [{
      kind: 'ScriptDoc', scopeKey: sceneScope, title: sceneVersion.title,
      fields: { ...sceneVersion.fields, scenes: nextSceneShard },
      baseVersionId: sceneVersion.versionId,
    }],
    scene: next,
    previousScenePart: currentPart,
    currentScenePart: nextPart,
  };
}

function stringList(value, maximum = 64, itemMaximum = 180) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function safeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 24_000) return {};
    return JSON.parse(serialized);
  } catch {
    return {};
  }
}

function entityProposalRecord(proposal, sceneId, occurrence) {
  const kind = ['character', 'location', 'wardrobe', 'prop'].includes(text(proposal?.kind, 40).toLowerCase())
    ? text(proposal.kind, 40).toLowerCase() : 'character';
  const name = text(proposal?.name, 160);
  if (!name) return null;
  const entityId = `entity_${digest({
    schema: LONG_SCRIPT_ENTITY_SCHEMA, introducedSceneId: sceneId,
    kind, name: normalizedTitle(name), occurrence,
  }).slice(0, 24)}`;
  return {
    schema: LONG_SCRIPT_ENTITY_SCHEMA,
    entityId,
    kind,
    name,
    aliases: stringList(proposal?.aliases, 12, 120),
    description: text(proposal?.description, 2_000),
    baseline: safeState(proposal?.baseline),
    introducedSceneId: sceneId,
    revision: 1,
    deleted: false,
  };
}

function relationshipProposalRecord(proposal, sceneId, tempIdMap, entityById) {
  const subjectEntityId = tempIdMap.get(text(proposal?.subjectEntityId, 160))
    || text(proposal?.subjectEntityId, 160);
  const objectEntityId = tempIdMap.get(text(proposal?.objectEntityId, 160))
    || text(proposal?.objectEntityId, 160);
  if (!subjectEntityId || !objectEntityId || subjectEntityId === objectEntityId
    || text(entityById.get(subjectEntityId)?.kind, 40).toLowerCase() !== 'character'
    || text(entityById.get(objectEntityId)?.kind, 40).toLowerCase() !== 'character') return null;
  const type = text(proposal?.type, 120);
  if (!type) return null;
  const relationshipKey = digest({
    subjectEntityId,
    objectEntityId,
    type: normalizedTitle(type),
  });
  const relationshipId = `relationship_${digest({
    schema: LONG_SCRIPT_RELATIONSHIP_SCHEMA,
    relationshipKey,
    effectiveFromSceneId: sceneId,
  }).slice(0, 24)}`;
  return {
    schema: LONG_SCRIPT_RELATIONSHIP_SCHEMA,
    relationshipId,
    relationshipKey,
    subjectEntityId,
    objectEntityId,
    type,
    description: text(proposal?.description, 2_000),
    state: safeState(proposal?.state),
    active: proposal?.active !== false,
    effectiveFromSceneId: sceneId,
    sourceSceneId: sceneId,
    revision: 1,
    deleted: false,
  };
}

function prepareScenePatchMutation(input = {}) {
  const contextPack = input.contextPack;
  const normalized = normalizeScenePatch(input.scenePatch, contextPack);
  const work = input.work || readLongScriptWork(input.currentVersions, input.existingSnapshot);
  if (!normalized || !work?.snapshot
    || normalized.baseWorkRevision !== work.snapshot.revision
    || text(contextPack?.baseWorkDigest, 64) !== text(work.snapshot.workDigest, 64)) return null;
  const scene = work.activeScenes.find((candidate) => candidate.sceneId === normalized.sceneId);
  if (!scene || Math.max(1, Number(scene.recordRevision) || 1) !== normalized.baseSceneRevision) return null;
  const versionByScope = currentVersionByScope(input.currentVersions);
  const knownEntities = Array.isArray(work.entities) ? work.entities : [];
  const knownEntityIds = new Set(knownEntities
    .map((entity) => text(entity?.entityId || entity?.id, 160)).filter(Boolean));
  const entityById = new Map(knownEntities.map((entity) => [
    text(entity?.entityId || entity?.id, 160), entity,
  ]));
  const occurrenceByName = new Map();
  const tempIdMap = new Map();
  let entityIdentityAmbiguous = false;
  const entityRecords = normalized.entityProposals.map((proposal) => {
    const proposalKind = text(proposal?.kind, 40).toLowerCase();
    const proposalName = normalizedTitle(proposal?.name);
    const matching = knownEntities.filter((entity) => {
      if (text(entity?.kind, 40).toLowerCase() !== proposalKind) return false;
      const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
        .map(normalizedTitle).filter(Boolean);
      return names.includes(proposalName);
    });
    const tempId = text(proposal?.tempId, 160);
    if (matching.length === 1) {
      tempIdMap.set(tempId, text(matching[0]?.entityId || matching[0]?.id, 160));
      return null;
    }
    if (matching.length > 1) {
      entityIdentityAmbiguous = true;
      return null;
    }
    const fingerprint = `${text(proposal?.kind, 40)}:${normalizedTitle(proposal?.name)}`;
    const occurrence = (occurrenceByName.get(fingerprint) || 0) + 1;
    occurrenceByName.set(fingerprint, occurrence);
    const record = entityProposalRecord(proposal, scene.sceneId, occurrence);
    if (record && tempId) tempIdMap.set(tempId, record.entityId);
    if (record) {
      knownEntityIds.add(record.entityId);
      entityById.set(record.entityId, record);
    }
    return record;
  }).filter(Boolean);
  if (entityIdentityAmbiguous) return null;
  const relationshipRecords = normalized.relationshipProposals == null ? null
    : normalized.relationshipProposals.map((proposal) => relationshipProposalRecord(
      proposal, scene.sceneId, tempIdMap, entityById,
    ));
  if (relationshipRecords?.some((record) => record == null)) return null;
  const patch = normalized.patch;
  const next = { ...scene };
  for (const field of ['purpose', 'objective', 'obstacle', 'turn', 'valueChange']) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) next[field] = text(patch[field], 4_000);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'locationId')) {
    const candidate = tempIdMap.get(text(patch.locationId, 160)) || text(patch.locationId, 160) || null;
    if (candidate && (!knownEntityIds.has(candidate)
      || text(entityById.get(candidate)?.kind, 40).toLowerCase() !== 'location')) return null;
    next.locationId = candidate;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'activeEntityIds')) {
    const candidates = stringList(patch.activeEntityIds, 64, 160)
      .map((entityId) => tempIdMap.get(entityId) || entityId);
    next.activeEntityIds = [...new Set(candidates.filter((entityId) => knownEntityIds.has(entityId)))];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'continuityResetEntityIds')) {
    const candidates = stringList(patch.continuityResetEntityIds, 64, 160)
      .map((entityId) => tempIdMap.get(entityId) || entityId);
    next.continuityResetEntityIds = [...new Set(candidates
      .filter((entityId) => next.activeEntityIds.includes(entityId)))];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'hardConstraintIds')) {
    next.hardConstraintIds = stringList(patch.hardConstraintIds, 64, 180);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'locks')) {
    next.locks = stringList(patch.locks, 64, 180);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'exitState')) {
    const incoming = safeState(patch.exitState);
    next.exitState = Object.fromEntries(Object.entries(incoming)
      .map(([entityId, state]) => [tempIdMap.get(entityId) || entityId, safeState(state)])
      .filter(([entityId]) => next.activeEntityIds.includes(entityId)));
  }
  const requiredContinuityTerms = stringList(contextPack.requiredContinuityTerms, 12, 80);
  const requiredSubjectNames = stringList(contextPack.requiredContinuitySubjectNames, 12, 160)
    .map(normalizedTitle);
  if (requiredContinuityTerms.length) {
    const committedSubjectIds = new Set();
    normalized.entityProposals.forEach((proposal) => {
      if (!requiredSubjectNames.includes(normalizedTitle(proposal?.name))) return;
      const mapped = tempIdMap.get(text(proposal?.tempId, 160));
      if (mapped) committedSubjectIds.add(mapped);
    });
    (Array.isArray(work.entities) ? work.entities : []).forEach((entity) => {
      if (requiredSubjectNames.includes(normalizedTitle(entity?.name))) {
        committedSubjectIds.add(text(entity?.entityId || entity?.id, 160));
      }
    });
    if (requiredSubjectNames.length && !committedSubjectIds.size) return null;
    const committedExitState = committedSubjectIds.size
      ? Object.fromEntries(Object.entries(next.exitState || {})
          .filter(([entityId]) => committedSubjectIds.has(entityId)))
      : next.exitState;
    const committedText = normalizedSceneBody(JSON.stringify(committedExitState || {}));
    if (requiredContinuityTerms.some((term) => !committedText.includes(normalizedSceneBody(term)))) {
      return null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    const status = text(patch.status, 40).toLowerCase();
    next.status = status === 'stale' ? 'stale'
      : status === 'confirmed' && input.allowConfirm === true ? 'confirmed' : 'draft';
  }
  if (scene.status === 'confirmed' && input.allowConfirm !== true) {
    next.status = 'draft';
    next.acceptedSourcePartCount = Math.max(0,
      Math.max(1, Math.trunc(Number(scene.sourcePartCount) || 1)) - 1);
  }
  next.draftSourcePartId = contextPack.scenePartId || null;
  if (next.status === 'confirmed' && input.allowConfirm === true) {
    next.acceptedSourcePartCount = Math.max(1, Math.trunc(Number(scene.sourcePartCount) || 1));
  }
  const continuityResetIds = new Set(stringList(next.continuityResetEntityIds, 64, 160));
  next.entryRefs = next.activeEntityIds.map((entityId) => {
    if (continuityResetIds.has(entityId)) {
      return {
        entityId, fromSceneId: null, exitDigest: null,
        relationshipDigest: digest([]), resetAtScene: true,
      };
    }
    const entry = latestConfirmedExitBefore(work, scene, entityId);
    const relationshipEntry = relationshipContinuityForEntity(work, scene, entityId);
    return entry ? {
      entityId, fromSceneId: entry.fromSceneId, exitDigest: entry.exitDigest,
      relationshipDigest: relationshipEntry.relationshipDigest,
    } : {
      entityId, fromSceneId: null, exitDigest: null,
      relationshipDigest: relationshipEntry.relationshipDigest,
    };
  });
  next.recordRevision = Math.max(1, Number(scene.recordRevision) || 1) + 1;

  const changedExitEntityIds = new Set([
    ...Object.keys(scene.exitState || {}), ...Object.keys(next.exitState || {}),
  ].filter((entityId) => (
    digest(scene.exitState?.[entityId] ?? null) !== digest(next.exitState?.[entityId] ?? null)
  )));
  if (scene.status === 'confirmed' && next.status !== 'confirmed') {
    Object.keys(scene.exitState || {}).forEach((entityId) => changedExitEntityIds.add(entityId));
  }
  const previousSceneRelationships = (Array.isArray(work.relationships) ? work.relationships : [])
    .filter((relationship) => text(relationship?.sourceSceneId, 160) === scene.sceneId);
  const changedRelationshipEntityIds = new Set();
  if (relationshipRecords != null && digest(previousSceneRelationships.map((item) => ({
    relationshipKey: item.relationshipKey, subjectEntityId: item.subjectEntityId,
    objectEntityId: item.objectEntityId, type: item.type, description: item.description,
    state: item.state, active: item.active !== false,
  })).sort((left, right) => String(left.relationshipKey).localeCompare(String(right.relationshipKey))))
    !== digest(relationshipRecords.map((item) => ({
      relationshipKey: item.relationshipKey, subjectEntityId: item.subjectEntityId,
      objectEntityId: item.objectEntityId, type: item.type, description: item.description,
      state: item.state, active: item.active !== false,
    })).sort((left, right) => String(left.relationshipKey).localeCompare(String(right.relationshipKey))))) {
    [...previousSceneRelationships, ...relationshipRecords].forEach((relationship) => {
      changedRelationshipEntityIds.add(text(relationship?.subjectEntityId, 160));
      changedRelationshipEntityIds.add(text(relationship?.objectEntityId, 160));
    });
  }
  if (scene.status === 'confirmed' && next.status !== 'confirmed') {
    previousSceneRelationships.forEach((relationship) => {
      changedRelationshipEntityIds.add(text(relationship?.subjectEntityId, 160));
      changedRelationshipEntityIds.add(text(relationship?.objectEntityId, 160));
    });
  }
  const replacementBySceneId = new Map([[scene.sceneId, next]]);
  const affectedBySourceSceneId = new Map([[scene.sceneId, changedExitEntityIds]]);
  activeScenes(work.scenes)
    .filter((candidate) => String(candidate.orderKey) > String(scene.orderKey))
    .forEach((candidate) => {
      const impacted = new Set();
      const resetIds = new Set(stringList(candidate.continuityResetEntityIds, 64, 160));
      (Array.isArray(candidate.entryRefs) ? candidate.entryRefs : []).forEach((entry) => {
        const affected = affectedBySourceSceneId.get(text(entry?.fromSceneId, 160));
        const entityId = text(entry?.entityId, 160);
        if (resetIds.has(entityId) || entry?.resetAtScene === true) return;
        if (affected?.has(entityId)) impacted.add(entityId);
        if (changedRelationshipEntityIds.has(entityId)) impacted.add(entityId);
      });
      if (!impacted.size) return;
      const stale = {
        ...candidate,
        status: 'stale',
        acceptedSourcePartCount: 0,
        draftSourcePartId: null,
        recordRevision: Math.max(1, Number(candidate.recordRevision) || 1)
          + (candidate.status === 'stale' ? 0 : 1),
      };
      replacementBySceneId.set(candidate.sceneId, stale);
      const propagated = new Set([...impacted].filter((entityId) => (
        Object.prototype.hasOwnProperty.call(candidate.exitState || {}, entityId)
      )));
      if (propagated.size) affectedBySourceSceneId.set(candidate.sceneId, propagated);
    });

  const changedSceneScopes = new Set([...replacementBySceneId.keys()].map(sceneScopeKey));
  const mutations = [...changedSceneScopes].sort().map((sceneScope) => {
    const sceneVersion = versionByScope.get(`ScriptDoc\u0000${sceneScope}`);
    if (!sceneVersion) return null;
    const sceneShard = Array.isArray(sceneVersion.fields?.scenes) ? sceneVersion.fields.scenes : [];
    const nextSceneShard = sceneShard.map((candidate) => (
      replacementBySceneId.get(candidate.sceneId) || candidate
    ));
    if (![...replacementBySceneId.keys()].some((sceneId) => (
      sceneScopeKey(sceneId) === sceneScope
        && nextSceneShard.some((candidate) => candidate.sceneId === sceneId)
    ))) return null;
    return {
      kind: 'ScriptDoc', scopeKey: sceneScope, title: sceneVersion.title,
      fields: { ...sceneVersion.fields, scenes: nextSceneShard },
      baseVersionId: sceneVersion.versionId,
    };
  });
  if (mutations.some((mutation) => mutation == null)) return null;

  if (Object.prototype.hasOwnProperty.call(patch, 'draftText')) {
    const scopeKey = sceneDraftScopeKey(contextPack.scenePartId);
    const current = versionByScope.get(`ScriptDoc\u0000${scopeKey}`) || null;
    const draftText = text(patch.draftText, 12_000);
    mutations.push({
      kind: 'ScriptDoc',
      scopeKey,
      title: `当前场稿 · ${text(scene.title, 120) || '未命名场景'}`,
      fields: {
        dialogue: {
          schema: LONG_SCRIPT_SCENE_DRAFT_SCHEMA,
          sceneId: scene.sceneId,
          scenePartId: contextPack.scenePartId,
          sourceDigest: text(contextPack.sourcePartRef?.digest, 64),
          draftText,
          draftDigest: digest(draftText),
        },
      },
      baseVersionId: current?.versionId || null,
    });
  }

  const entityBuckets = new Map();
  entityRecords.forEach((entity) => {
    const scopeKey = entityScopeKey(entity.entityId);
    entityBuckets.set(scopeKey, [...(entityBuckets.get(scopeKey) || []), entity]);
  });
  for (const [scopeKey, added] of [...entityBuckets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const current = versionByScope.get(`CharacterBible\u0000${scopeKey}`) || null;
    const existing = Array.isArray(current?.fields?.characters) ? current.fields.characters : [];
    const byId = new Map(existing.map((entity) => [text(entity?.entityId || entity?.id, 160), entity]));
    added.forEach((entity) => byId.set(entity.entityId, entity));
    mutations.push({
      kind: 'CharacterBible', scopeKey, title: current?.title || `实体分片 ${scopeKey.slice(-2)}`,
      fields: { ...(current?.fields || {}), characters: [...byId.values()] },
      baseVersionId: current?.versionId || null,
    });
  }
  if (relationshipRecords != null) {
    const relationshipByScope = new Map();
    previousSceneRelationships.forEach((relationship) => {
      const scopeKey = relationshipScopeKey(relationship.relationshipId);
      relationshipByScope.set(scopeKey, relationshipByScope.get(scopeKey) || []);
    });
    relationshipRecords.forEach((relationship) => {
      const scopeKey = relationshipScopeKey(relationship.relationshipId);
      relationshipByScope.set(scopeKey, [...(relationshipByScope.get(scopeKey) || []), relationship]);
    });
    for (const [scopeKey, replacements] of [...relationshipByScope.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      const current = versionByScope.get(`CharacterBible\u0000${scopeKey}`) || null;
      const existing = Array.isArray(current?.fields?.relationships) ? current.fields.relationships : [];
      const byId = new Map(existing
        .filter((relationship) => text(relationship?.sourceSceneId, 160) !== scene.sceneId)
        .map((relationship) => [text(relationship?.relationshipId, 160), relationship]));
      replacements.forEach((relationship) => byId.set(relationship.relationshipId, relationship));
      mutations.push({
        kind: 'CharacterBible', scopeKey,
        title: current?.title || `关系分片 ${scopeKey.slice(-2)}`,
        fields: { ...(current?.fields || {}), relationships: [...byId.values()] },
        baseVersionId: current?.versionId || null,
      });
    }
  }
  return {
    expectedWorkRevision: work.snapshot.revision,
    currentSceneId: scene.sceneId,
    taskProfile: work.snapshot.taskProfile,
    mutations,
    scene: next,
    createdEntities: entityRecords,
    relationshipEvents: relationshipRecords || [],
  };
}

function applyScenePatchToLongScriptImport(input = {}) {
  const importPlan = input.importPlan;
  if (!importPlan?.previewWork || !Array.isArray(importPlan.mutations)) return null;
  const snapshot = input.existingSnapshot || {
    revision: importPlan.expectedWorkRevision || 0,
    workDigest: null,
    taskProfile: importPlan.taskProfile,
  };
  const importedVersions = importPlan.mutations.map((mutation) => ({
    kind: mutation.kind,
    scopeKey: mutation.scopeKey,
    title: mutation.title,
    fields: mutation.fields,
    versionId: mutation.baseVersionId || null,
  }));
  const currentVersions = [
    ...(Array.isArray(input.currentVersions) ? input.currentVersions : []),
    ...importedVersions,
  ];
  const planned = prepareScenePatchMutation({
    contextPack: input.contextPack,
    scenePatch: input.scenePatch,
    work: { ...importPlan.previewWork, snapshot },
    currentVersions,
    existingSnapshot: snapshot,
    allowConfirm: false,
  });
  if (!planned) return null;
  const merged = new Map(importPlan.mutations.map((mutation) => [
    `${mutation.kind}\u0000${normalizeScopeKey(mutation.scopeKey)}`,
    mutation,
  ]));
  planned.mutations.forEach((mutation) => {
    const key = `${mutation.kind}\u0000${normalizeScopeKey(mutation.scopeKey)}`;
    const imported = merged.get(key);
    merged.set(key, imported ? {
      ...mutation,
      baseVersionId: imported.baseVersionId || null,
      source: imported.source,
    } : mutation);
  });
  return {
    ...planned,
    expectedWorkRevision: importPlan.expectedWorkRevision,
    taskProfile: importPlan.taskProfile,
    mutations: [...merged.values()],
    importPlan: { ...importPlan, mutations: [...merged.values()] },
  };
}

module.exports = {
  LONG_SCRIPT_CONTEXT_SCHEMA,
  LONG_SCRIPT_ENTITY_SCHEMA,
  LONG_SCRIPT_RELATIONSHIP_SCHEMA,
  LONG_SCRIPT_PATCH_SCHEMA,
  LONG_SCRIPT_ROOT_SCHEMA,
  LONG_SCRIPT_SCENE_SCHEMA,
  LONG_SCRIPT_SCENE_PART_SCHEMA,
  LONG_SCRIPT_SCENE_DRAFT_SCHEMA,
  LONG_SCRIPT_SOURCE_SHARD_SCHEMA,
  LONG_SCRIPT_STYLE_CANON_SCHEMA,
  buildLongScriptStyleCanon,
  applyScenePatchToLongScriptImport,
  buildSceneContextPack,
  currentSceneSourcePart,
  decodeSceneSourcePart,
  digest,
  entityScopeKey,
  effectiveRelationshipsBefore,
  normalizeScenePatch,
  orderScopeKey,
  prepareLongScriptImport,
  prepareLongScriptProductionBriefMutation,
  prepareScenePartAdvanceMutation,
  prepareScenePatchMutation,
  relationshipScopeKey,
  readLongScriptWork,
  reconcileLongScriptScenes,
  sceneHeading,
  sceneDraftScopeKey,
  sceneScopeKey,
  splitSceneSourceParts,
  splitLongScriptScenes,
};
