'use strict';
const fs = require('node:fs'), path = require('node:path'), c = require('../backend/src/shared/seedream55DraftContract.json');
const MODELS = [...c.imageModels, ...c.layerModels, ...c.draftModels];
function workflow(model) {
  const nodes = [], edges = [], draft = c.draftModels.includes(model), layer = c.layerModels.includes(model), global = draft ? model.includes('-global-') : model.startsWith('dola-');
  const node = (id, type, data, x) => nodes.push({ id, type, position: { x, y: 40 }, data });
  const edge = (source, target) => edges.push({ id: source + '-' + target, source, target });
  if (draft) {
    const prefix = global ? 'seedance-2.5-global-standard-' : 'seedance-2.5-standard-';
    const common = { mainId: 'seedance-2.5', videoBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '', seed: -1, ratio: '16:9', resolution: '480p', duration: 4, generateAudio: true, returnLastFrame: false, reuseResult: false };
    node('source', 'video', { ...common, model: prefix + 't2v', prompt: 'A red toy robot slowly waves one arm, plain cream background, fixed camera.', seedance25Draft: true }, 0);
    node('generate', 'video', { ...common, model, prompt: '', seedance25DraftTaskId: '', seedance25OutputFormat: 'mp4' }, 450); edge('source', 'generate');
  } else {
    if (layer || model.endsWith('i2i')) { node('reference', 'upload', { uploadType: 'image', lockedUploadType: 'image', label: '源图片 / Source image' }, 0); edge('reference', 'generate'); }
    node('generate', 'image', { model: layer ? 'seedream-layer-decomposition' : 'seedream-v5-pro', apiModel: model,
      imageBuiltinSource: 'seedance-nz', seedreamApiSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '',
      seedreamNzModelFamily: global ? 'overseas-55' : 'domestic-55', seedreamNzResolution: '1k', seedreamLayerResolution: 'auto', seedreamOutputFormat: 'png',
      seedream55Background: 'auto', seedream55Watermark: false, seedream55SafetyIdentifier: '', seedream55MaxImages: 3, seedream55TextRecognition: false,
      prompt: layer ? '' : 'A red toy robot and a blue ceramic teapot on a plain cream background.', imageOnlyOutput: true, reuseResult: false }, 450);
  }
  node('output', 'output', {}, 980); edge('generate', 'output');
  return { schema: 't8-workflow-fragment', version: 1, title: model, nodes, edges, nodeCount: nodes.length, edgeCount: edges.length, nodeTypes: [...new Set(nodes.map(n => n.type))], savedAt: '2026-11-11T00:00:00.000Z' };
}
if (require.main === module) { const root = path.resolve(__dirname, '..'); if (!require('./worktree-role.cjs').inspectCurrentWorktree(root, 'development').ok) throw Error('Development worktree required'); for (const model of MODELS) fs.writeFileSync(path.join(root, 'docs/workflows', model + '.json'), JSON.stringify(workflow(model), null, 2) + '\n'); console.log('Saved eight credential-free workflows'); }
module.exports = { MODELS, workflow };
