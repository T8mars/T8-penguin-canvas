'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CASES } = require('./verify-nb21-flux-viduq4-live.cjs');
const role = require('./worktree-role.cjs').inspectCurrentWorktree(path.resolve(__dirname, '..'), 'development');
if (!role.ok) throw new Error('Workflow generation requires an authorized development worktree');

for (const item of CASES) {
  const nodes = [];
  const edges = [];
  if (item.reference) {
    nodes.push({ id: 'source-image', type: 'upload', position: { x: 0, y: 40 }, data: {
      label: '上传参考图 / Upload reference image', uploadType: 'image', lockedUploadType: 'image',
    } });
    edges.push({ id: 'image-edge', source: 'source-image', target: 'generation' });
  }
  if (item.audio) {
    nodes.push({ id: 'source-audio', type: 'upload', position: { x: 0, y: 440 }, data: {
      label: '可选参考音频 / Optional reference audio (converted to MP3)', uploadType: 'audio', lockedUploadType: 'audio',
    } });
    edges.push({ id: 'audio-edge', source: 'source-audio', target: 'generation' });
  }
  const flux = item.model === 'flux-3-image';
  nodes.push({ id: 'generation', type: item.kind, position: { x: 430, y: 80 }, data: {
    label: item.model, providerSource: 'zhenzhen',
    ...(item.kind === 'image' ? { model: flux ? 'flux-3-image' : 'nano-banana-2', apiModel: item.model,
      imageBuiltinSource: 'seedance-nz', aspectRatio: '1:1', sizeLevel: flux ? '768sq' : '1K',
      apimartImageCount: 1, imageOnlyOutput: true,
      ...(flux ? { fluxImageGrounding: true, fluxImageSafetyTolerance: 2 } : {}) }
      : { mainId: 'vidu-q3', model: item.model, videoBuiltinSource: 'seedance-nz',
        ratio: '1:1', duration: 3, resolution: '540p', generateAudio: true, viduQ4IsRec: true, viduQ4Watermark: false,
        localRefImages: [], localRefVideos: [], localRefAudios: [] }),
    prompt: item.kind === 'video' ? 'The penguin gently waves beside the yellow cup. Locked camera, preserve the scene.'
      : item.reference ? 'Keep the penguin and the yellow cup. Change the background to a soft pink studio, preserving the composition.'
        : 'A friendly penguin standing next to a yellow ceramic cup, soft pale blue background, clean detailed illustration, no text.',
    referenceImages: [], reuseResult: false,
  } });
  nodes.push({ id: 'output', type: 'output', position: { x: 850, y: 80 }, data: { label: '结果 / Result' } });
  edges.push({ id: 'output-edge', source: 'generation', target: 'output' });
  const workflow = { schema: 't8-workflow-fragment', version: 1, title: item.id, nodes, edges,
    nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map((node) => node.type))],
    topologyPreview: { nodes: nodes.map((node) => ({ id: node.id, type: node.type, label: node.data.label,
      x: node.position.x + 50, y: node.position.y + 50 })), edges }, savedAt: '2026-10-10T00:00:00.000Z' };
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'workflows', `${item.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
}
