'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'workflows');
const savedAt = '2026-09-01T00:00:00.000Z';

function writeWorkflow(model, title, nodes, edges) {
  const doc = {
    schema: 't8-workflow-fragment',
    version: 1,
    title,
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypes: nodes.map((node) => node.type),
    topologyPreview: {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.data.label,
        x: node.position.x + 50,
        y: node.position.y + 50,
      })),
      edges,
    },
    savedAt,
  };
  fs.writeFileSync(path.join(outputDir, `${model}.json`), `${JSON.stringify(doc, null, 2)}\n`);
}

function videoNode(model, label, prompt, position = { x: 0, y: 0 }) {
  return {
    id: model,
    type: 'video',
    position,
    data: {
      label,
      mainId: 'hailuo-2.3',
      model,
      videoBuiltinSource: 'seedance-nz',
      ratio: '16:9',
      duration: 5,
      resolution: '480P',
      localPrompt: prompt,
      reuseResult: false,
    },
  };
}

writeWorkflow(
  'hailuo-h3-max-t2v',
  'MiniMax H3 Max 文生视频（贞贞的平价AI小屋 · 480P）',
  [videoNode(
    'hailuo-h3-max-t2v',
    'MiniMax H3 Max 文生视频',
    '纸飞机穿过洒满晨光的安静工作室，镜头平滑跟随，材质与光影保持稳定',
  )],
  [],
);

const firstFrame = {
  id: 'hailuo-h3-max-i2v-first-frame',
  type: 'upload',
  position: { x: 0, y: 0 },
  data: { label: '上传首帧图（必填）', uploadType: 'image', lockedUploadType: 'image' },
};
const lastFrame = {
  id: 'hailuo-h3-max-i2v-last-frame',
  type: 'upload',
  position: { x: 0, y: 220 },
  data: { label: '上传尾帧图（可选）', uploadType: 'image', lockedUploadType: 'image' },
};
const i2v = videoNode(
  'hailuo-h3-max-i2v',
  'MiniMax H3 Max 首尾帧图生视频',
  '镜头缓慢推进，主体自然转身，保持身份、构图与材质稳定',
  { x: 440, y: 40 },
);
writeWorkflow(
  'hailuo-h3-max-i2v',
  'MiniMax H3 Max 首尾帧图生视频（贞贞的平价AI小屋 · 480P）',
  [firstFrame, lastFrame, i2v],
  [
    { id: 'hailuo-h3-max-i2v-first-edge', source: firstFrame.id, target: i2v.id },
    { id: 'hailuo-h3-max-i2v-last-edge', source: lastFrame.id, target: i2v.id },
  ],
);

console.log('generated 2 Hailuo H3 Max workflows');
