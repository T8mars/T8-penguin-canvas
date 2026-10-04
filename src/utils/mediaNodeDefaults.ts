import contract from '../../backend/src/shared/mediaNodeDefaultsContract.json';

export type MediaNodeDefaultSource = 'product-default' | 'zhenzhen' | 'seedance-nz';
export interface MediaNodeDefaults {
  version: 1;
  imageSource: MediaNodeDefaultSource;
  videoSource: MediaNodeDefaultSource;
}
export const DEFAULT_MEDIA_NODE_DEFAULTS: MediaNodeDefaults = {
  version: 1, imageSource: 'product-default', videoSource: 'product-default',
};

export function normalizeMediaNodeDefaults(raw: unknown): MediaNodeDefaults {
  if (raw === undefined) return { ...DEFAULT_MEDIA_NODE_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('media_node_defaults_invalid');
  const value = raw as Record<string, unknown>;
  if (value.version !== contract.version
    || Object.keys(value).some((key) => !['version', 'imageSource', 'videoSource'].includes(key))
    || typeof value.imageSource !== 'string' || !contract.sources.includes(value.imageSource)
    || typeof value.videoSource !== 'string' || !contract.sources.includes(value.videoSource)) throw new Error('media_node_defaults_invalid');
  return { version: 1, imageSource: value.imageSource as MediaNodeDefaultSource, videoSource: value.videoSource as MediaNodeDefaultSource };
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
  if (intent !== 'blank' || !contract.nodeTypes.includes(type)
    || contract.explicitFields.some((key) => typeof explicit[key] === 'string' && explicit[key] !== '')) return preserved;
  const preferences = normalizeMediaNodeDefaults(rawDefaults);
  const choice = type === 'video' ? preferences.videoSource : preferences.imageSource;
  const source = choice === 'product-default' ? 'zhenzhen' : choice;
  const defaults = contract.defaults[type as keyof typeof contract.defaults][source];
  return { ...base, ...defaults, ...explicit };
}
