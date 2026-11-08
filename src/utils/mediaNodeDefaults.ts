import contract from '../../backend/src/shared/mediaNodeDefaultsContract.json';

export type MediaNodeDefaultSource = 'product-default' | 'zhenzhen' | 'seedance-nz';
export interface MediaNodeDefaults {
  version: 1;
  imageSource: MediaNodeDefaultSource;
  videoSource: MediaNodeDefaultSource;
  llmSource?: MediaNodeDefaultSource;
  audioSource?: MediaNodeDefaultSource;
  seedanceSource?: MediaNodeDefaultSource;
  directorSource?: MediaNodeDefaultSource;
}
export const MEDIA_NODE_DEFAULT_FIELDS = [
  ['imageSource', 'image'], ['videoSource', 'video'], ['llmSource', 'llm'],
  ['audioSource', 'audio'], ['seedanceSource', 'seedance'], ['directorSource', 'director-storyboard'],
] as const;
export const DEFAULT_MEDIA_NODE_DEFAULTS: MediaNodeDefaults = {
  version: 1, imageSource: 'product-default', videoSource: 'product-default',
};

export function normalizeMediaNodeDefaults(raw: unknown): MediaNodeDefaults {
  if (raw === undefined) return { ...DEFAULT_MEDIA_NODE_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('media_node_defaults_invalid');
  const value = raw as Record<string, unknown>;
  if (value.version !== contract.version
    || Object.keys(value).some((key) => !['version', ...Object.values(contract.preferenceFields)].includes(key))
    || typeof value.imageSource !== 'string' || !contract.sources.includes(value.imageSource)
    || typeof value.videoSource !== 'string' || !contract.sources.includes(value.videoSource)) throw new Error('media_node_defaults_invalid');
  const result: MediaNodeDefaults = { version: 1, imageSource: value.imageSource as MediaNodeDefaultSource, videoSource: value.videoSource as MediaNodeDefaultSource };
  for (const [field] of MEDIA_NODE_DEFAULT_FIELDS.slice(2)) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    if (typeof value[field] !== 'string' || !contract.sources.includes(value[field] as string)) throw new Error('media_node_defaults_invalid');
    result[field] = value[field] as MediaNodeDefaultSource;
  }
  return result;
}

export function isMediaNodeDefaultApplicable(type: string, explicit: Record<string, unknown>) {
  return contract.nodeTypes.includes(type)
    && !contract.explicitFields.some((key) => typeof explicit[key] === 'string' && explicit[key] !== '');
}

export function effectiveMediaNodeDefaultSource(type: string, rawDefaults: unknown): 'zhenzhen' | 'seedance-nz' {
  const field = contract.preferenceFields[type as keyof typeof contract.preferenceFields] as Exclude<keyof MediaNodeDefaults, 'version'>;
  const choice = normalizeMediaNodeDefaults(rawDefaults)[field] || 'product-default';
  return choice === 'product-default' ? contract.productDefaultSource as 'seedance-nz' : choice;
}

/** Only a new blank creation. Clone/import/history data must never pass through this resolver. */
export function resolveNewMediaNodeData(
  type: string,
  base: Record<string, unknown>,
  explicit: Record<string, unknown>,
  rawDefaults: unknown,
  intent: 'blank' | 'clone' | 'import' | 'history' | 'template' = 'blank',
): Record<string, unknown> {
  const preserved = { ...base, ...explicit };
  if (intent !== 'blank' || !isMediaNodeDefaultApplicable(type, explicit)) return preserved;
  const source = effectiveMediaNodeDefaultSource(type, rawDefaults);
  const defaults = contract.defaults[type as keyof typeof contract.defaults][source];
  return { ...base, ...defaults, ...explicit };
}
