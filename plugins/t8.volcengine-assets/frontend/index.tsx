import { VolcAssetNode } from '../../../src/components/nodes/VolcAssetNode';

// Keep the plugin entry point on the same implementation as the built-in node.
// This prevents the plugin loader from replacing the folder-aware multi-select
// UI with the legacy single-select dropdown when both registrations are active.
export { VolcAssetNode };

export const nodeDefinition = {
  type: 'volc-asset',
  label: '火山素材库',
  category: 'input',
  defaultData: {
    profileId: 'volcengine',
    projectName: '',
    groupId: '',
    groupIds: [],
    assetId: '',
    assetUri: '',
    selectedAssets: [],
    materialSetKind: '',
    materialSetItems: [],
    kind: 'image',
    status: 'Processing',
    tags: [],
    error: '',
    size: { w: 680, h: 510 },
    volcAssetLayoutVersion: 3,
  },
  component: VolcAssetNode,
};

export function register(ctx: any) {
  if (typeof ctx?.nodes?.register !== 'function') throw new Error('核心未提供 nodes.register');
  ctx.nodes.register(nodeDefinition);
  return () => ctx.nodes.unregister?.('volc-asset');
}

export default { id: 't8.volcengine-assets', version: '0.3.0', register, nodeDefinition };
