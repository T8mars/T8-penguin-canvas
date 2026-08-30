'use strict';

const crypto = require('node:crypto');

const CREATOR_AUDIO_OBSERVATION_SCHEMA = 't8-creator-audio-observation-v1';
const DIGEST_RE = /^[a-f0-9]{64}$/u;

function boundedText(value, maximum = 2_000) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

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

function normalizedContentHash(value) {
  const hash = boundedText(value, 128).toLowerCase().replace(/^sha256:/u, '');
  return DIGEST_RE.test(hash) ? hash : '';
}

function observationPayload(value) {
  return {
    schema: CREATOR_AUDIO_OBSERVATION_SCHEMA,
    assetId: value.assetId,
    contentRevision: value.contentRevision,
    contentHash: value.contentHash,
    mimeType: value.mimeType,
    duration: value.duration,
    provider: value.provider,
    model: value.model,
    requestId: value.requestId,
    responseFormat: value.responseFormat,
    transcript: value.transcript,
    segments: value.segments,
    limitation: value.limitation,
    observedAt: value.observedAt,
  };
}

function normalizeCreatorAudioObservation(value, attachment = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_AUDIO_OBSERVATION_SCHEMA) return null;
  const transcript = boundedText(value.transcript, 80_000);
  const segments = [];
  let totalText = 0;
  for (const raw of (Array.isArray(value.segments) ? value.segments : []).slice(0, 2_000)) {
    const start = Number(raw?.start);
    const end = Number(raw?.end);
    const text = boundedText(raw?.text, 1_000);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || !text) continue;
    if (totalText + text.length > 80_000) break;
    segments.push({
      start: Math.round(start * 1_000) / 1_000,
      end: Math.round(end * 1_000) / 1_000,
      text,
    });
    totalText += text.length;
  }
  const normalized = {
    schema: CREATOR_AUDIO_OBSERVATION_SCHEMA,
    assetId: boundedText(value.assetId, 160),
    contentRevision: Math.max(1, Math.trunc(Number(value.contentRevision) || 0)),
    contentHash: normalizedContentHash(value.contentHash),
    mimeType: boundedText(value.mimeType, 120).toLowerCase() || 'audio/*',
    duration: Math.max(0, Math.min(86_400, Number(value.duration) || 0)),
    provider: boundedText(value.provider, 160),
    model: boundedText(value.model, 240),
    requestId: boundedText(value.requestId, 240) || null,
    responseFormat: boundedText(value.responseFormat, 40) || 'verbose_json',
    transcript,
    segments,
    limitation: boundedText(value.limitation, 1_000),
    observedAt: boundedText(value.observedAt, 80),
  };
  const observationDigest = boundedText(value.observationDigest, 64).toLowerCase();
  if (!normalized.assetId || !normalized.contentHash || !normalized.provider || !normalized.model
    || !normalized.transcript || !normalized.limitation || !normalized.observedAt
    || !DIGEST_RE.test(observationDigest)
    || digest(observationPayload(normalized)) !== observationDigest) return null;
  if (attachment) {
    const attachmentHash = normalizedContentHash(attachment.contentHash);
    const attachmentRevision = Math.max(1, Math.trunc(Number(attachment.contentRevision) || 0));
    if (boundedText(attachment.assetId, 160) !== normalized.assetId
      || attachmentHash !== normalized.contentHash
      || attachmentRevision !== normalized.contentRevision) return null;
  }
  return { ...normalized, observationDigest };
}

function createCreatorAudioObservation(input = {}) {
  const attachment = input.attachment || {};
  const result = input.result || {};
  const value = {
    schema: CREATOR_AUDIO_OBSERVATION_SCHEMA,
    assetId: boundedText(attachment.assetId, 160),
    contentRevision: Math.max(1, Math.trunc(Number(attachment.contentRevision) || 0)),
    contentHash: normalizedContentHash(attachment.contentHash),
    mimeType: boundedText(attachment.mimeType, 120).toLowerCase() || 'audio/*',
    duration: Math.max(0, Math.min(86_400, Number(attachment.duration) || 0)),
    provider: boundedText(input.provider, 160) || 'seedance-nz',
    model: boundedText(result.model, 240) || 'whisper-1',
    requestId: boundedText(result.requestId || result.traceId, 240) || null,
    responseFormat: boundedText(result.responseFormat, 40) || 'verbose_json',
    transcript: boundedText(result.text, 80_000),
    segments: Array.isArray(result.segments) ? result.segments : [],
    limitation: '该观察只证明可听语音的转写内容和返回的时间段；不证明说话人身份、音乐风格、BPM、环境声或音效。',
    observedAt: boundedText(input.observedAt, 80) || new Date().toISOString(),
  };
  const normalizedBase = {
    ...value,
    segments: value.segments.slice(0, 2_000).map((segment) => ({
      start: Math.round(Number(segment?.start) * 1_000) / 1_000,
      end: Math.round(Number(segment?.end) * 1_000) / 1_000,
      text: boundedText(segment?.text, 1_000),
    })).filter((segment) => (
      Number.isFinite(segment.start) && Number.isFinite(segment.end)
      && segment.start >= 0 && segment.end >= segment.start && segment.text
    )),
  };
  normalizedBase.observationDigest = digest(observationPayload(normalizedBase));
  return normalizeCreatorAudioObservation(normalizedBase, attachment);
}

async function groundCreatorAudioAttachments(attachments = [], options = {}) {
  const source = Array.isArray(attachments) ? attachments : [];
  const audio = source.filter((attachment) => attachment?.kind === 'audio');
  if (audio.length === 0) return { attachments: source, observations: [], providerCalls: 0 };
  if (typeof options.transcribeAudio !== 'function') {
    const error = new Error('当前创作入口没有可用的音频转写能力');
    error.code = 'CREATOR_AUDIO_OBSERVER_UNAVAILABLE';
    throw error;
  }
  const grounded = [];
  const observations = [];
  let providerCalls = 0;
  for (const attachment of source) {
    if (attachment?.kind !== 'audio') {
      grounded.push(attachment);
      continue;
    }
    const existing = normalizeCreatorAudioObservation(attachment.audioObservation, attachment);
    if (existing) {
      observations.push(existing);
      grounded.push({
        ...attachment,
        observationDigest: existing.observationDigest,
        audioObservation: existing,
      });
      continue;
    }
    if (!attachment.assetId || !normalizedContentHash(attachment.contentHash)
      || Math.max(1, Math.trunc(Number(attachment.contentRevision) || 0)) < 1) {
      const error = new Error('音频必须绑定当前项目素材 ID、revision 与 SHA-256 后才能创作');
      error.code = 'CREATOR_AUDIO_EVIDENCE_REQUIRED';
      throw error;
    }
    providerCalls += 1;
    const result = await options.transcribeAudio(attachment);
    const observation = createCreatorAudioObservation({
      attachment,
      result,
      provider: options.provider || 'seedance-nz',
      observedAt: typeof options.now === 'function' ? options.now() : undefined,
    });
    if (!observation) {
      const error = new Error('音频转写返回缺少可核验正文，已停止基于音频创作');
      error.code = 'CREATOR_AUDIO_OBSERVATION_INVALID';
      throw error;
    }
    observations.push(observation);
    grounded.push({
      ...attachment,
      observationDigest: observation.observationDigest,
      audioObservation: observation,
    });
  }
  return { attachments: grounded, observations, providerCalls };
}

module.exports = {
  CREATOR_AUDIO_OBSERVATION_SCHEMA,
  createCreatorAudioObservation,
  groundCreatorAudioAttachments,
  normalizeCreatorAudioObservation,
};
