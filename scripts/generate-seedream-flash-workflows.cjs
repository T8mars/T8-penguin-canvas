'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { MODELS } = require('./verify-seedream-flash-live.cjs');
for (const model of MODELS) {
  const layer = model.endsWith('-layer-decomposition');
  const reference = layer || model.endsWith('-i2i');
  const nodes = [];
  if (reference) nodes.push({ id: 'source', type: 'upload', position: { x: 0, y: 80 },
    data: { label: '上传源图 / Upload source image', uploadType: 'image', lockedUploadType: 'image' } });
  nodes.push({ id: 'generation', type: 'image', position: { x: 420, y: 80 }, data: {
    label: model, model: layer ? 'seedream-layer-decomposition' : 'seedream-v5-pro',
    apiModel: layer ? model : 'seedream-v5-pro', imageBuiltinSource: 'seedance-nz',
    ...(layer ? { seedreamLayerResolution: 'auto' } : { seedreamApiSource: 'seedance-nz',
      seedreamNzModelFamily: model.startsWith('dola-') ? 'overseas-flash' : 'domestic-flash',
      seedreamNzResolution: '1.5k', seedreamNzCustomSize: '2048x2048' }),
    seedreamOutputFormat: 'png', prompt: layer ? '' : reference
      ? 'Keep the subject and composition. Change the background to a soft blue studio.'
      : 'A friendly penguin next to a yellow teapot and a green plant on a wooden table, clean illustration.',
    referenceImages: [], imageOnlyOutput: true, reuseResult: false,
  } });
  nodes.push({ id: 'output', type: 'output', position: { x: 840, y: 80 },
    data: { label: layer ? '底图与全部图层 / Base and all layers' : '结果 / Result' } });
  const edges = [ ...(reference ? [{ id: 'source-edge', source: 'source', target: 'generation' }] : []),
    { id: 'output-edge', source: 'generation', target: 'output' } ];
  const workflow = { schema: 't8-workflow-fragment', version: 1, title: model, nodes, edges,
    nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map((node) => node.type))],
    topologyPreview: { nodes: nodes.map((node) => ({ id: node.id, type: node.type, label: node.data.label,
      x: node.position.x + 50, y: node.position.y + 50 })), edges }, savedAt: '2026-10-02T00:00:00.000Z' };
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'workflows', `${model}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
}
