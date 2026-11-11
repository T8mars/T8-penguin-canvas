'use strict';
const fs = require('node:fs'), path = require('node:path');
const contract = require('../backend/src/shared/tripo3dContract.json');
function workflow(item) {
  const nodes = [], edges = [];
  const node = (id, type, data, x, y = 40) => nodes.push({ id, type, position: { x, y }, data });
  const edge = (source, target) => edges.push({ id: source + '-' + target, source, target });
  const data = { model: item.id, threeDTab: 'tripo-3d', reuseResult: false };
  if (item.group === 'generate' && item.mode === 'text') data.prompt = 'A simple blue toy robot on a plain background.';
  const imageCount = item.mode === 'multiview' ? 4 : item.mode === 'image' || item.group === 'splat' || item.id.endsWith('smartsegment') ? 1 : 0;
  for (let i = 0; i < imageCount; i++) { node('view-' + i, 'upload', { label: imageCount > 1 ? ['正面 / Front', '左面 / Left', '背面 / Back', '右面 / Right'][i] : '参考图 / Reference', uploadType: 'image', lockedUploadType: 'image' }, 0, 40 + 250 * i); edge('view-' + i, 'tripo'); }
  if (item.group !== 'generate' && item.group !== 'splat' && !item.id.endsWith('smartsegment')) {
    node('source-model', 'model-3d-upload', { label: '上传源模型 / Upload source model', uploadType: 'model3d', lockedUploadType: 'model3d' }, 0);
    if (item.id.endsWith('complete')) { node('segment', 'model-3d', { model: 'tripo-mesh-segment-v1', threeDTab: 'tripo-3d', reuseResult: false }, 440); edge('source-model', 'segment'); edge('segment', 'tripo'); data.tripo_completion_mode = 'quick_cap'; }
    else edge('source-model', 'tripo');
  }
  if (item.group === 'texture') data.tripo_texture_prompt_text = 'Blue glazed ceramic, clean studio finish.';
  if (item.id === 'tripo-retopology-v1') data.tripo_face_limit = 10000;
  node('tripo', 'model-3d', data, item.id.endsWith('complete') ? 880 : 440);
  node('result', 'model-3d-preview', { label: '结果 / Result' }, item.id.endsWith('complete') ? 1320 : 880); edge('tripo', 'result');
  return { schema: 't8-workflow-fragment', version: 1, title: item.id, nodes, edges, nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map(n => n.type))], savedAt: '2026-11-11T00:00:00.000Z' };
}
if (require.main === module) { const root = path.resolve(__dirname, '..'); if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw Error('Development worktree required'); for (const item of contract.models) fs.writeFileSync(path.join(root, 'docs/workflows', item.id + '.json'), JSON.stringify(workflow(item), null, 2) + '\n'); console.log('Saved 25 credential-free Tripo templates'); }
module.exports = { workflow };
