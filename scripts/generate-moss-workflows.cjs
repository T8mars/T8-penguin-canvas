'use strict';
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../backend/src/shared/mossImageContract.json');
const CASES = [
  { id: 'moss-image-t2i', model: contract.model, references: 0, ratio: contract.defaultRatio },
  { id: 'moss-image-square-t2i', model: contract.model, references: 0, ratio: '1:1' },
  { id: 'moss-image-i2i', model: contract.model, references: 1, ratio: contract.defaultRatio },
];
function workflow(item) {
  const nodes = [], edges = [];
  if (item.references) {
    nodes.push({ id: 'reference', type: 'upload', position: { x: 0, y: 80 },
      data: { label: '参考图 / Reference', uploadType: 'image', lockedUploadType: 'image' } });
    edges.push({ id: 'reference-edge', source: 'reference', target: 'generation' });
  }
  nodes.push({ id: 'generation', type: 'image', position: { x: 430, y: 80 }, data: {
    label: 'Moss Image', model: contract.model, apiModel: contract.model, providerSource: 'zhenzhen',
    imageBuiltinSource: 'seedance-nz', aspectRatio: item.ratio, sizeLevel: '',
    prompt: item.references
      ? 'Keep the penguin and the yellow ceramic cup. Change the background to a soft pink studio, preserving the composition.'
      : 'A friendly penguin standing beside a yellow ceramic cup, pale blue studio background, clean detailed illustration, no text.',
    referenceImages: [], imageOnlyOutput: true, reuseResult: false,
  } });
  nodes.push({ id: 'output', type: 'output', position: { x: 850, y: 80 }, data: { label: '结果 / Result' } });
  edges.push({ id: 'output-edge', source: 'generation', target: 'output' });
  return { schema: 't8-workflow-fragment', version: 1, title: item.id, nodes, edges,
    nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map((node) => node.type))],
    topologyPreview: { nodes: nodes.map((node) => ({ id: node.id, type: node.type, label: node.data.label,
      x: node.position.x + 50, y: node.position.y + 50 })), edges }, savedAt: '2026-10-23T00:00:00.000Z' };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  for (const item of CASES) fs.writeFileSync(path.join(root, 'docs/workflows', `${item.id}.json`), `${JSON.stringify(workflow(item), null, 2)}\n`);
}
module.exports = { CASES, workflow };
