const contract = require('../shared/mediaNodeDefaultsContract.json');
const DEFAULT_MEDIA_NODE_DEFAULTS = Object.freeze({ version: 1, imageSource: 'product-default', videoSource: 'product-default' });
function normalizeMediaNodeDefaults(raw) {
  if (raw === undefined) return { ...DEFAULT_MEDIA_NODE_DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || raw.version !== contract.version
    || Object.keys(raw).some((key) => !['version', ...Object.values(contract.preferenceFields)].includes(key))
    || !contract.sources.includes(raw.imageSource) || !contract.sources.includes(raw.videoSource)
    || [...new Set(Object.values(contract.preferenceFields))].some((field) => Object.hasOwn(raw, field) && !contract.sources.includes(raw[field]))) {
    const error = new Error('media_node_defaults_invalid');
    error.code = 'media_node_defaults_invalid';
    throw error;
  }
  return { version: 1, ...Object.fromEntries([...new Set(Object.values(contract.preferenceFields))].filter(field => Object.hasOwn(raw, field)).map(field => [field, raw[field]])) };
}
function isMediaNodeDefaultApplicable(type, explicit) {
  return contract.nodeTypes.includes(type)
    && !contract.explicitFields.some(key => typeof explicit[key] === 'string' && explicit[key] !== '');
}
function effectiveMediaNodeDefaultSource(type, rawDefaults) {
  const choice = normalizeMediaNodeDefaults(rawDefaults)[contract.preferenceFields[type]] || 'product-default';
  return choice === 'product-default' ? contract.productDefaultSource : choice;
}
function resolveNewMediaNodeData(type, base, explicit, rawDefaults, intent = 'blank') {
  const preserved = { ...base, ...explicit };
  if (intent !== 'blank' || !isMediaNodeDefaultApplicable(type, explicit)) return preserved;
  const source = effectiveMediaNodeDefaultSource(type, rawDefaults);
  return { ...base, ...contract.defaults[type][source], ...explicit };
}
function applyCreatorMediaNodeDefaults(kind, input, rawDefaults) {
  // Creator video/story patches use dedicated nodes, not the generic video node.
  if (!['image', 'edit-image'].includes(kind)
    || ['provider', 'model', 'imageProvider', 'imageModel'].some((key) => typeof input[key] === 'string' && input[key] !== '')) return input;
  const preferences = normalizeMediaNodeDefaults(rawDefaults);
  const data = resolveNewMediaNodeData(kind === 'edit-image' ? 'edit' : 'image', {}, {}, preferences);
  return { ...input, imageProvider: data.imageBuiltinSource, imageModel: data.apiModel,
    ratio: input.ratio || data.aspectRatio };
}
module.exports = { DEFAULT_MEDIA_NODE_DEFAULTS, normalizeMediaNodeDefaults, isMediaNodeDefaultApplicable, effectiveMediaNodeDefaultSource, resolveNewMediaNodeData, applyCreatorMediaNodeDefaults };
