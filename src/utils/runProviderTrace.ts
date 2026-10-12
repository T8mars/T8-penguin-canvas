import nbDoubao from '../../backend/src/shared/nbLowpriceDoubaoContract.json';

export interface RunProviderTrace {
  provider?: string;
  model?: string;
  upstreamTaskId?: string;
  requestId?: string;
  httpStatus?: number;
  pollCount?: number;
  usage?: Record<string, unknown>;
}

export interface RunOutputAssetCandidate {
  kind: 'image' | 'video' | 'audio' | 'model3d' | 'text' | 'other';
  sourceUrl?: string;
  text?: string;
  filename: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /(?:^|[-_])(?:api[-_]?key|authorization|cookie|token|secret|password|credential|access[-_]?(?:key|token)|refresh[-_]?token|auth[-_]?token)(?:$|[-_])/i;
const TOKEN_USAGE_KEY_PATTERN = /^(?:total|prompt|completion|input|output|cached|reasoning)[-_]?tokens?(?:[-_]?count)?$/i;
const MAX_TRACE_STRING = 4000;

function boundedString(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, max);
}

function firstString(record: Record<string, unknown>, keys: string[], max = 240): string | undefined {
  for (const key of keys) {
    const value = boundedString(record[key], max);
    if (value) return value;
  }
  return undefined;
}

function sanitizeTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max depth]';
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    return value.length > MAX_TRACE_STRING ? `${value.slice(0, MAX_TRACE_STRING)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeTraceValue(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, MAX_TRACE_STRING);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const isSecret = !TOKEN_USAGE_KEY_PATTERN.test(normalizedKey) && SECRET_KEY_PATTERN.test(normalizedKey);
    output[key] = isSecret ? '[redacted]' : sanitizeTraceValue(item, depth + 1);
  }
  return output;
}

function explicitHttpStatus(record: Record<string, unknown>): number | undefined {
  for (const key of ['upstreamHttpStatus', 'httpStatus', 'transportHttpStatus', 'statusCode']) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

export function extractRunProviderTrace(value: unknown): RunProviderTrace {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const provider = firstString(record, ['providerId', 'taskProvider', 'provider', 'providerSource', 'platform', 'providerKind']);
  const model = firstString(record, ['resolvedModel', 'providerModel', 'apiModel', 'model', 'modelName']);
  const upstreamTaskId = firstString(record, ['upstreamTaskId', 'taskId', 'task_id'], 500);
  const requestId = firstString(record, ['requestId', 'request_id'], 500);
  const httpStatus = explicitHttpStatus(record);
  const rawPollCount = record.pollCount ?? record.poll_count;
  const pollCount = rawPollCount === undefined
    ? undefined
    : Math.max(0, Math.min(1_000_000, Math.trunc(Number(rawPollCount) || 0)));
  const usageValue = record.usage ?? record.tokenUsage ?? record.usageDetails;
  const usage = usageValue && typeof usageValue === 'object' && !Array.isArray(usageValue)
    ? sanitizeTraceValue(usageValue) as Record<string, unknown>
    : undefined;
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(upstreamTaskId ? { upstreamTaskId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(pollCount !== undefined ? { pollCount } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function providerTraceAttemptPatch(trace: RunProviderTrace): RunProviderTrace {
  return {
    ...(trace.provider ? { provider: trace.provider } : {}),
    ...(trace.model ? { model: trace.model } : {}),
    ...(trace.upstreamTaskId ? { upstreamTaskId: trace.upstreamTaskId } : {}),
    ...(trace.requestId ? { requestId: trace.requestId } : {}),
    ...(trace.httpStatus ? { httpStatus: trace.httpStatus } : {}),
    ...(trace.pollCount !== undefined ? { pollCount: trace.pollCount } : {}),
    ...(trace.usage ? { usage: trace.usage } : {}),
  };
}

function sourceUrl(value: unknown): string | undefined {
  const text = boundedString(value, 16_384);
  if (!text || /^data:/i.test(text) || /^blob:/i.test(text)) return undefined;
  if (/^https?:\/\//i.test(text) || text.startsWith('/files/') || text.startsWith('/input/') || text.startsWith('/output/')) return text;
  return undefined;
}

function filenameFor(url: string, kind: RunOutputAssetCandidate['kind'], index: number): string {
  try {
    const pathname = /^https?:\/\//i.test(url) ? new URL(url).pathname : url.split(/[?#]/, 1)[0];
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 240);
    if (name) return name;
  } catch {
    // Use the deterministic fallback below.
  }
  const extensions: Record<string, string> = { image: '.png', video: '.mp4', audio: '.mp3', model3d: '.glb' };
  return `run-output-${index + 1}${extensions[kind] || ''}`;
}

function urlFromItem(value: unknown): string | undefined {
  if (typeof value === 'string') return sourceUrl(value);
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return sourceUrl(record.url ?? record.sourceUrl ?? record.imageUrl ?? record.videoUrl ?? record.audioUrl ?? record.modelUrl ?? record.dataUrl);
}

export function collectRunOutputAssets(value: unknown): RunOutputAssetCandidate[] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: RunOutputAssetCandidate[] = [];
  const seen = new Set<string>();
  const addMedia = (kind: RunOutputAssetCandidate['kind'], candidate: unknown, field: string, preserveSlot = false) => {
    const url = urlFromItem(candidate);
    if (!url) return;
    const key = `${kind}:${url}`;
    if ((!preserveSlot && seen.has(key)) || result.length >= 100) return;
    seen.add(key);
    result.push({ kind, sourceUrl: url, filename: filenameFor(url, kind, result.length), metadata: { field } });
  };
  const addFields = (kind: RunOutputAssetCandidate['kind'], singular: string[], plural: string[]) => {
    for (const field of singular) addMedia(kind, record[field], field);
    for (const field of plural) {
      const values = record[field];
      if (Array.isArray(values)) values.forEach((item) => addMedia(kind, item, field));
    }
  };

  addFields('image', ['imageUrl'], ['imageUrls', 'generatedImages', 'outputImages']);
  addFields('video', ['videoUrl'], ['videoUrls', 'outputVideos']);
  if ([record.apiModel, record.model].includes(nbDoubao.audio.cloneModel)) {
    const previews = Array.isArray(record.audioUrls) && record.audioUrls.length ? record.audioUrls
      : Array.isArray(record.tracks) && record.tracks.length ? record.tracks : [record.audioUrl];
    if (previews.length >= 100) throw new Error('Doubao preview list exceeds the shared Run artifact capacity; outputs were not truncated');
    previews.forEach(item => addMedia('audio', item, 'audioUrls', true));
  } else addFields('audio', ['audioUrl'], ['audioUrls', 'tracks', 'outputAudios']);
  addFields('model3d', ['modelUrl', 'glbUrl'], ['modelUrls', 'outputModels']);

  for (const field of ['outputText', 'reply']) {
    const text = boundedString(record[field], 32_000);
    if (!text || result.length >= 100) continue;
    const key = `text:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      kind: 'text',
      text,
      filename: `run-output-${result.length + 1}.txt`,
      mimeType: 'text/plain',
      metadata: { field },
    });
  }
  return result;
}
