export type SourceHandleData = Record<string, unknown>;

const OUTPUT_KIND_FIELDS: Record<string, string[]> = {
  text: ['outputText', 'reply', 'promptResolved', 'prompt', 'text', 'textSegments', 'segments', 'texts'],
  image: ['imageUrl', 'imageUrls', 'generatedImages', 'resultUrl', 'resultUrls', 'firstFrameUrl', 'lastFrameUrl'],
  video: ['videoUrl', 'videoUrls'],
  audio: ['audioUrl', 'audioUrl_1', 'audioUrls'],
  model3d: ['modelUrl', 'modelUrls', 'directModelUrl', 'directModelUrls'],
  metadata: [
    'metadata',
    'outputMetadata',
    'portraitMetadata',
    'faceExpressionMetadata',
    'batchTagResults',
    'records',
    'recordIds',
    'feishuRecords',
    'feishuOutput',
  ],
};

const HANDLE_KIND_ALIASES: Record<string, string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  model: 'model3d',
  model3d: 'model3d',
  metadata: 'metadata',
};

function copyFields(source: SourceHandleData, fields: string[]) {
  const selected: SourceHandleData = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) selected[field] = source[field];
  }
  for (const field of ['mimeType', 'filename', 'width', 'height', 'duration', 'provenance']) {
    if (Object.prototype.hasOwnProperty.call(source, field)) selected[field] = source[field];
  }
  return selected;
}

export function selectSourceHandleData(
  data: SourceHandleData | null | undefined,
  handles: ReadonlySet<string | null | undefined>,
): SourceHandleData[] {
  const source = data && typeof data === 'object' ? data : {};
  const outputs = source.subflowOutputs && typeof source.subflowOutputs === 'object' && !Array.isArray(source.subflowOutputs)
    ? source.subflowOutputs
    : source.outputs;
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return [source];

  const requested = [...handles].filter((handle): handle is string => typeof handle === 'string' && Boolean(handle));
  if (!requested.length) return [source];
  const routed = requested
    .map((handle) => (outputs as Record<string, unknown>)[handle])
    .filter((value): value is SourceHandleData => Boolean(value) && typeof value === 'object' && !Array.isArray(value));
  return routed.length ? routed : [source];
}

/**
 * Resolve one concrete source handle to the payload exposed by that handle.
 * Unknown legacy handles deliberately fall back to the aggregate node data.
 */
export function selectSingleSourceHandleData(
  data: SourceHandleData | null | undefined,
  handle?: string | null,
  fallbackKind?: string | null,
): SourceHandleData {
  const source = data && typeof data === 'object' ? data : {};
  const normalizedHandle = typeof handle === 'string' ? handle.trim() : '';

  if (normalizedHandle) {
    const routed = selectSourceHandleData(source, new Set([normalizedHandle]));
    if (routed.length === 1 && routed[0] !== source) return routed[0];

    const explicitOutputs = source.outputs;
    if (explicitOutputs && typeof explicitOutputs === 'object' && !Array.isArray(explicitOutputs)) {
      const value = (explicitOutputs as Record<string, unknown>)[normalizedHandle];
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as SourceHandleData;
      if (value !== undefined) return { [normalizedHandle]: value };
    }

    if (normalizedHandle === 'first') {
      const value = source.firstFrameUrl;
      return value == null ? source : { imageUrl: value, imageUrls: [value], firstFrameUrl: value };
    }
    if (normalizedHandle === 'last') {
      const value = source.lastFrameUrl;
      return value == null ? source : { imageUrl: value, imageUrls: [value], lastFrameUrl: value };
    }
    if (normalizedHandle === 'audio-0') {
      const value = source.audioUrl;
      return value == null ? source : { audioUrl: value, audioUrls: [value] };
    }
    if (normalizedHandle === 'audio-1') {
      const value = source.audioUrl_1;
      return value == null ? source : { audioUrl: value, audioUrls: [value] };
    }
  }

  const kind = HANDLE_KIND_ALIASES[normalizedHandle] || String(fallbackKind || '').toLowerCase();
  const fields = OUTPUT_KIND_FIELDS[kind];
  if (!fields) return source;
  const selected = copyFields(source, fields);
  return Object.keys(selected).length ? selected : source;
}
