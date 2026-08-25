'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'workflows');
const savedAt = '2026-08-25T00:00:00.000Z';
const models = [
  'wan-3.0-global-i2v',
  'wan-3.0-global-r2v',
  'wan-3.0-i2v',
  'wan-3.0-r2v',
  'wan-3.0-prime-i2v',
  'wan-3.0-prime-r2v',
  'wan-3.0-global-prime-i2v',
  'wan-3.0-global-prime-r2v',
];

function uploadNode(id, label, uploadType, y) {
  return {
    id,
    type: 'upload',
    position: { x: 0, y },
    data: { label, uploadType, lockedUploadType: uploadType },
  };
}

function workflowFor(model) {
  const mode = model.endsWith('-r2v') ? 'r2v' : 'i2v';
  const scope = model.includes('-global-') ? '海外' : '国内';
  const tier = model.includes('-prime-') ? ' Prime' : '';
  const title = `Wan 3.0 ${scope}${tier} ${mode.toUpperCase()}（贞贞的平价AI小屋）`;
  const generation = {
    id: model,
    type: 'video',
    position: { x: 460, y: 40 },
    data: {
      label: title,
      mainId: 'wan-2.7-spicy',
      model,
      videoBuiltinSource: 'seedance-nz',
      ratio: 'adaptive',
      duration: 2,
      resolution: '480P',
      generateAudio: true,
      wan30EnableThinking: false,
      wan30FileUrl: '',
      wan30LinkUrl: '',
      wan30Seed: 0,
      prompt: mode === 'i2v'
        ? '从首帧自然运动到尾帧，主体身份、构图与材质保持稳定'
        : '综合参考图片、视频与音频的主体、动作和节奏，生成连贯电影感镜头',
      reuseResult: false,
    },
  };
  const uploads = mode === 'i2v'
    ? [
      uploadNode(`${model}-first-frame`, '上传首帧图（必填）', 'image', 0),
      uploadNode(`${model}-last-frame`, '上传尾帧图（可选）', 'image', 220),
    ]
    : [
      uploadNode(`${model}-images`, '上传参考图片（最多 10 张）', 'image', 0),
      uploadNode(`${model}-videos`, '上传参考视频（最多 5 个）', 'video', 220),
      uploadNode(`${model}-audios`, '上传参考音频（最多 5 个）', 'audio', 440),
    ];
  const nodes = [...uploads, generation];
  const edges = uploads.map((node) => ({
    id: `${node.id}-edge`,
    source: node.id,
    target: model,
  }));
  return {
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
}

fs.mkdirSync(outputDir, { recursive: true });
for (const model of models) {
  fs.writeFileSync(path.join(outputDir, `${model}.json`), `${JSON.stringify(workflowFor(model), null, 2)}\n`);
}
console.log(`generated ${models.length} Wan 3.0 workflows`);
