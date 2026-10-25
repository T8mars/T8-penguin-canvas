'use strict';
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../backend/src/shared/motionVideoContract.json');
const CASES = contract.models.flatMap((model, i) => ['generate', 'revise'].map(operation => ({
  id: `motion-video-${i ? 'pro' : 'standard'}-${operation}`, model, operation,
})));
function workflow(item) {
  const nodes = [
    { id: 'description', type: 'text', position: { x: 0, y: 80 }, data: { label: '动画描述 / Description', text: 'Create a clean title animation: HELLO, CREATE, YOUR STORY. Large readable typography, geometric shapes and smooth transitions.' } },
    { id: 'animation', type: 'code-animation', position: { x: 430, y: 80 }, data: {
      label: item.operation === 'revise' ? '先选择自己的成功版本 / Select your completed version first' : '代码动画 / Code Animation',
      model: item.model, prompt: '', duration: 15, ratio: '16:9', resolution: '720p', motionOperation: item.operation,
      motionTemplate: 'api_default', motionMusic: 'api_default', motionRevisionInstruction: item.operation === 'revise' ? 'Change CREATE to MAKE; keep the rest as similar as possible.' : '',
    } },
    { id: 'output', type: 'output', position: { x: 900, y: 80 }, data: { label: '视频结果 / Video result' } },
  ];
  const edges = [{ id: 'description-edge', source: 'description', target: 'animation', targetHandle: 'prompt' },
    { id: 'output-edge', source: 'animation', sourceHandle: 'video', target: 'output' }];
  return { schema: 't8-workflow-fragment', version: 1, title: item.id, nodes, edges,
    nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: nodes.map(n => n.type),
    topologyPreview: { nodes: nodes.map(n => ({ id: n.id, type: n.type, label: n.data.label, x: n.position.x, y: n.position.y })), edges },
    savedAt: '2026-10-26T00:00:00.000Z' };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw Error('Development worktree required');
  for (const item of CASES) fs.writeFileSync(path.join(root, 'docs/workflows', `${item.id}.json`), `${JSON.stringify(workflow(item), null, 2)}\n`);
}
module.exports = { CASES, workflow };
