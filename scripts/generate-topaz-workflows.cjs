'use strict';
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../backend/src/shared/topazVideoContract.json');
const root = path.resolve(__dirname, '..');
if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Development worktree required');
for (const mode of ['local', 'url']) {
  const nodes = mode === 'local' ? [{ id: 'source-video', type: 'upload', position: { x: 0, y: 80 },
    data: { label: '上传 MP4 视频 / Upload MP4 video', uploadType: 'video', lockedUploadType: 'video' } }] : [];
  const edges = mode === 'local' ? [{ id: 'video-edge', source: 'source-video', target: 'generation' }] : [];
  nodes.push({ id: 'generation', type: 'video', position: { x: 430, y: 80 }, data: {
    label: mode === 'local' ? 'Topaz · 本地 MP4 / Local MP4' : 'Topaz · 填写公开 MP4 直链 / Enter public MP4 URL',
    providerSource: 'zhenzhen', videoBuiltinSource: 'seedance-nz', mainId: contract.model, model: contract.model,
    resolution: mode === 'local' ? '720p' : contract.defaultResolution,
    topazQuality: mode === 'local' ? 'Low' : contract.defaultQuality, topazVideoUrl: '',
    localRefImages: [], localRefVideos: [], localRefAudios: [], prompt: '', ratio: '', duration: 0, seed: 0, reuseResult: false,
  } });
  nodes.push({ id: 'output', type: 'output', position: { x: 850, y: 80 }, data: { label: '修复结果 / Restored video' } });
  edges.push({ id: 'output-edge', source: 'generation', target: 'output' });
  const workflow = { schema: 't8-workflow-fragment', version: 1, title: `topaz-video-${mode}`, nodes, edges,
    nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map((node) => node.type))],
    topologyPreview: { nodes: nodes.map((node) => ({ id: node.id, type: node.type, label: node.data.label,
      x: node.position.x + 50, y: node.position.y + 50 })), edges }, savedAt: '2026-10-11T00:00:00.000Z' };
  fs.writeFileSync(path.join(root, 'docs', 'workflows', `topaz-video-${mode}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
}
