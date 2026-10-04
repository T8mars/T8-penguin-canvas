const contract = require('../shared/mediaNodeDefaultsContract.json');
const DEFAULT_MEDIA_NODE_DEFAULTS = Object.freeze({ version: 1, imageSource: 'product-default', videoSource: 'product-default' });
function normalizeMediaNodeDefaults(raw) {
  if (raw === undefined) return { ...DEFAULT_MEDIA_NODE_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || raw.version !== contract.version
    || Object.keys(raw).some((key) => !['version', 'imageSource', 'videoSource'].includes(key))
    || !contract.sources.includes(raw.imageSource) || !contract.sources.includes(raw.videoSource)) {
    const error = new Error('media_node_defaults_invalid');
    error.code = 'media_node_defaults_invalid';
    throw error;
  }
  return { version: 1, imageSource: raw.imageSource, videoSource: raw.videoSource };
}
function resolveNewMediaNodeData(type, base, explicit, rawDefaults, intent = 'blank') {
  const preserved = { ...base, ...explicit };
  if (intent !== 'blank' || !contract.nodeTypes.includes(type)
    || contract.explicitFields.some((key) => typeof explicit[key] === 'string' && explicit[key] !== '')) return preserved;
  const preferences = normalizeMediaNodeDefaults(rawDefaults);
  const choice = type === 'video' ? preferences.videoSource : preferences.imageSource;
  const source = choice === 'product-default' ? 'zhenzhen' : choice;
  return { ...base, ...contract.defaults[type][source], ...explicit };
}
function applyCreatorMediaNodeDefaults(kind, input, rawDefaults) {
  // Creator video/story patches use dedicated nodes, not the generic video node.
  if (!['image', 'edit-image'].includes(kind)
    || ['provider', 'model', 'imageProvider', 'imageModel'].some((key) => typeof input[key] === 'string' && input[key] !== '')) return input;
  const preferences = normalizeMediaNodeDefaults(rawDefaults);
  if (preferences.imageSource === 'product-default') return input;
  const data = resolveNewMediaNodeData(kind === 'edit-image' ? 'edit' : 'image', {}, {}, preferences);
  return { ...input, imageProvider: data.imageBuiltinSource, imageModel: data.apiModel,
    ratio: input.ratio || data.aspectRatio };
}
module.exports = { DEFAULT_MEDIA_NODE_DEFAULTS, normalizeMediaNodeDefaults, resolveNewMediaNodeData, applyCreatorMediaNodeDefaults };
