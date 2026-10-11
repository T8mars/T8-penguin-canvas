'use strict';
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../backend/src/shared/maiImageContract.json');
const CASES = contract.models.flatMap((model) => [0, 1, 2].map((references) => ({
  id: `${model}-${['t2i', 'i2i', 'multi-reference'][references]}`, model, references,
}))).sort((a, b) => a.references - b.references);
function workflow(item) {
  const nodes = [], edges = [];
  for (let index = 0; index < item.references; index++) {
    nodes.push({ id: `reference-${index + 1}`, type: 'upload', position: { x: 0, y: 40 + index * 350 },
      data: { label: `参考图 ${index + 1} / Reference ${index + 1}`, uploadType: 'image', lockedUploadType: 'image' } });
    edges.push({ id: `reference-edge-${index + 1}`, source: `reference-${index + 1}`, target: 'generation' });
  }
  nodes.push({ id: 'generation', type: 'image', position: { x: 430, y: 80 }, data: {
    label: item.model, model: contract.models[0], apiModel: item.model, providerSource: 'zhenzhen',
    imageBuiltinSource: 'seedance-nz', aspectRatio: '', sizeLevel: '', maiResolution: '1k',
    maiSize: !item.references && item.model.endsWith('-flash') ? 'custom_pixels' : '1:1',
    maiCustomRatio: '16:9', maiWidth: 1536, maiHeight: 1024, maiAutoAspectRatio: false, maiWebGrounding: false,
    prompt: item.references === 2 ? 'Combine the penguin from reference 1 with the ceramic cup from reference 2 in one clean pastel studio scene. Preserve their appearance.'
      : item.references ? 'Keep the penguin and the yellow ceramic cup. Change the background to a soft pink studio, preserving the composition.'
        : 'A friendly penguin standing beside a yellow ceramic cup, pale blue studio background, clean detailed illustration, no text.',
    referenceImages: [], imageOnlyOutput: true, reuseResult: false,
  } });
  nodes.push({ id: 'output', type: 'output', position: { x: 850, y: 80 }, data: { label: '结果 / Result' } });
  edges.push({ id: 'output-edge', source: 'generation', target: 'output' });
  return { schema: 't8-workflow-fragment', version: 1, title: item.id, nodes, edges,
    nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map((node) => node.type))],
    topologyPreview: { nodes: nodes.map((node) => ({ id: node.id, type: node.type, label: node.data.label,
      x: node.position.x + 50, y: node.position.y + 50 })), edges }, savedAt: '2026-10-11T00:00:00.000Z' };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  for (const item of CASES) fs.writeFileSync(path.join(root, 'docs/workflows', `${item.id}.json`), `${JSON.stringify(workflow(item), null, 2)}\n`);
}
module.exports = { CASES, workflow };
