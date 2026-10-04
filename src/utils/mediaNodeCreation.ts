import { useApiKeysStore } from '../stores/apiKeys';
import { resolveNewMediaNodeData } from './mediaNodeDefaults';

/** Read preferences once at the user creation boundary, never on render/load or execution. */
export function createBlankNodeData(type: string, base: Record<string, unknown>, explicit: Record<string, unknown> = {}) {
  const state = useApiKeysStore.getState();
  const applicable = ['image', 'edit', 'video'].includes(type);
  const declared = ['providerSource', 'providerId', 'providerModel', 'imageBuiltinSource', 'videoBuiltinSource', 'model', 'apiModel', 'mainId']
    .some((key) => typeof explicit[key] === 'string' && explicit[key] !== '');
  if (applicable && !declared && !state.loaded) throw new Error('media_node_defaults_not_ready');
  return resolveNewMediaNodeData(type, base, explicit, state.settings.preferences?.mediaNodeDefaults);
}
