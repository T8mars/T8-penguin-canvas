'use strict';
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../backend/src/shared/nbLowpriceDoubaoContract.json');
const CASES = contract.banana.models.flatMap(model => [0, 1, 14].map(references => ({
  id: `${model}-${references === 0 ? 't2i' : references === 1 ? 'i2i' : 'multi-reference'}`, model, references,
}))).sort((a, b) => a.references - b.references);
const audioCases = ['doubao-voice-clone', 'doubao-seed-icl-2.0', 'doubao-training-to-synthesis'];
function envelope(title, nodes, edges) {
  return { schema: 't8-workflow-fragment', version: 1, title, nodes, edges, nodeCount: nodes.length, edgeCount: edges.length,
    nodeTypes: [...new Set(nodes.map(node => node.type))], topologyPreview: { nodes: nodes.map(node => ({
      id: node.id, type: node.type, label: node.data.label, x: node.position.x + 50, y: node.position.y + 50,
    })), edges }, savedAt: '2026-10-13T00:00:00.000Z' };
}
function imageWorkflow(item) {
  const nodes = [], edges = [];
  for (let index = 0; index < item.references; index++) {
    nodes.push({ id: `reference-${index + 1}`, type: 'upload', position: { x: 0, y: index * 280 },
      data: { label: `Reference ${index + 1}`, uploadType: 'image', lockedUploadType: 'image' } });
    edges.push({ id: `reference-edge-${index + 1}`, source: `reference-${index + 1}`, target: 'generation' });
  }
  nodes.push({ id: 'generation', type: 'image', position: { x: 440, y: 80 }, data: {
    label: item.model, model: 'nano-banana-2', apiModel: item.model, providerSource: 'zhenzhen', imageBuiltinSource: 'seedance-nz',
    aspectRatio: item.references ? 'auto' : '1:1', sizeLevel: '1K', apimartImageCount: 1, imageOnlyOutput: true, reuseResult: false,
    prompt: item.references ? 'Keep the penguin and ceramic cup from the ordered references. Arrange them in one clean pastel studio scene and make the background pink. Preserve their designs.'
      : 'A friendly penguin standing next to a yellow ceramic cup, soft pale blue studio background, clean detailed illustration, no text.',
  } });
  nodes.push({ id: 'output', type: 'output', position: { x: 870, y: 80 }, data: { label: 'Result' } });
  edges.push({ id: 'output-edge', source: 'generation', target: 'output' });
  return envelope(item.id, nodes, edges);
}
function audioWorkflow(id) {
  const clone = id !== 'doubao-seed-icl-2.0';
  const synthesis = id !== 'doubao-voice-clone';
  const nodes = [], edges = [];
  if (clone) {
    nodes.push({ id: 'sample', type: 'upload', position: { x: 0, y: 0 }, data: {
      label: 'Your authorized voice sample', uploadType: 'audio', lockedUploadType: 'audio',
    } });
    nodes.push({ id: 'clone', type: 'audio', position: { x: 430, y: 0 }, data: {
      label: contract.audio.cloneModel, audioProviderMode: 'seed-audio', seedAudioModel: contract.audio.cloneModel,
      prompt: 'Good morning.', doubaoVoiceParams: { language: '1' }, reuseResult: false,
    } });
    edges.push({ id: 'sample-edge', source: 'sample', target: 'clone' });
  }
  if (synthesis) {
    nodes.push({ id: 'synthesis', type: 'audio', position: { x: clone ? 900 : 430, y: 0 }, data: {
      label: contract.audio.iclModel, audioProviderMode: 'seed-audio', seedAudioModel: contract.audio.iclModel,
      seedAudioSpeaker: '', prompt: 'Good morning.', doubaoVoiceParams: {
        voice_model: 'seed-tts-2.0-standard', format: 'mp3', sample_rate: '24000', speech_rate: 0, loudness_rate: 0, pitch: 0,
      }, reuseResult: false,
    } });
    if (clone) edges.push({ id: 'speaker-edge', source: 'clone', sourceHandle: 'text', target: 'synthesis', targetHandle: 'speaker' });
  }
  nodes.push({ id: 'output', type: 'output', position: { x: synthesis && clone ? 1360 : 890, y: 0 }, data: { label: 'Audio result' } });
  edges.push({ id: 'output-edge', source: synthesis ? 'synthesis' : 'clone', sourceHandle: 'audio-0', target: 'output' });
  return envelope(id, nodes, edges);
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw new Error('Authorized development worktree required');
  for (const item of CASES) fs.writeFileSync(path.join(root, 'docs/workflows', `${item.id}.json`), `${JSON.stringify(imageWorkflow(item), null, 2)}\n`);
  for (const id of audioCases) fs.writeFileSync(path.join(root, 'docs/workflows', `${id}.json`), `${JSON.stringify(audioWorkflow(id), null, 2)}\n`);
}
module.exports = { CASES, imageWorkflow, audioCases, audioWorkflow };
