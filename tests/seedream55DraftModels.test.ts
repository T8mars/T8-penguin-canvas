import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import vm from 'node:vm';
import { buildSeedream55Request, resolveSeedance25Draft, SEEDREAM55_DRAFT_MODELS as c } from '../src/utils/seedream55Draft';
import Seedream55Controls from '../src/components/nodes/Seedream55Controls';
import Seedance25DraftControls from '../src/components/nodes/Seedance25DraftControls';
import { forwardSeedance25Draft } from '../src/utils/seedance25DraftProvenance';
import { seedreamNzRuntimeModel } from '../src/utils/seedreamNzContract';
import { VIDEO_MODELS, SEEDREAM_LAYER_DECOMPOSITION_MODEL } from '../src/providers/models';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { isConnectionValid } from '../src/config/portTypes';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import i18n from '../src/i18n';
const require = createRequire(import.meta.url);
test('5.5 selection is appended, normal connected-image switching and old defaults remain', () => {
  assert.equal(seedreamNzRuntimeModel('domestic', 0), 'seedream-v5-pro-t2i');
  assert.equal(SEEDREAM_LAYER_DECOMPOSITION_MODEL, 'seedream-v5-pro-layer-decomposition');
  for (const family of ['domestic-55','overseas-55'] as const) for (const count of [0,1,10]) assert.match(seedreamNzRuntimeModel(family, count), count ? /-i2i$/ : /-t2i$/);
  const video = VIDEO_MODELS.find(model => model.id === 'seedance-2.5')!;
  for (const id of c.draftModels) { const option = video.apiModelOptions.find(option => option.value === id)!; assert.ok(option); assert.equal(option.supportImages, false); assert.deepEqual(option.resolutions, []); }
  const request = buildSeedream55Request(c.imageModels[0], 'A robot', [], { seedreamNzResolution: 'custom', seedreamNzCustomSize: '11520x720', seedream55Background: 'transparent' }, false);
  assert.equal(request.size, '11520x720'); assert.equal(request.resolution, undefined); assert.equal(request.background, 'transparent');
});
test('draft IDs route by explicit identity and region, with no URL or ambiguous-source fallback', () => {
  assert.equal(resolveSeedance25Draft(c.draftModels[0], {}, [{ id: 'draft-fixture', model: 'seedance-2.5-standard-t2v' }]), 'draft-fixture');
  assert.throws(() => resolveSeedance25Draft(c.draftModels[1], {}, [{ id: 'draft-fixture', model: 'seedance-2.5-standard-t2v' }]), { code: 'draftRegion' });
  assert.throws(() => resolveSeedance25Draft(c.draftModels[0], { seedance25DraftTaskId: 'other' }, [{ id: 'draft-fixture', model: 'seedance-2.5-standard-t2v' }]), { code: 'ambiguousDraft' });
  assert.throws(() => resolveSeedance25Draft(c.draftModels[0], { seedance25DraftTaskId: 'https://cdn.example/video.mp4' }, []), { code: 'draftId' });
  assert.throws(() => resolveSeedance25Draft(c.draftModels[0], { taskId: 'unverified-480p-video' }, []), { code: 'draftId' });
  const source = { videoUrl: '/files/output/draft.mp4', seedance25DraftTaskIdResult: 'draft-fixture', seedance25DraftSourceModel: 'seedance-2.5-standard-t2v' };
  assert.equal(forwardSeedance25Draft([source]).seedance25DraftTaskIdResult, 'draft-fixture');
  assert.equal(forwardSeedance25Draft([source], []).seedance25DraftTaskIdResult, '');
  assert.equal(forwardSeedance25Draft([source, { ...source, seedance25DraftTaskIdResult: 'other' }]).seedance25DraftTaskIdResult, '');
});
test('actual new control handlers capture values synchronously and bilingual controls resolve', async () => {
  for (const file of ['Seedream55Controls','Seedance25DraftControls']) {
    const source = ts.createSourceFile(file, fs.readFileSync(new URL('../src/components/nodes/' + file + '.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), handlers: ts.Expression[] = [];
    const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onChange' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) handlers.push(node.initializer.expression); ts.forEachChild(node, visit); }; visit(source); assert.ok(handlers.length >= 4);
    for (const expression of handlers) { const patches: any[] = []; const handler = vm.runInNewContext(ts.transpileModule('(' + expression.getText(source) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { update: (patch: any) => patches.push(JSON.parse(JSON.stringify(patch))) }); for (const value of ['2','3']) { const event: any = { currentTarget: { value, checked: value === '2' } }; handler(event); event.currentTarget = null; } assert.equal(patches.length, 2); assert.notDeepEqual(patches[0], patches[1]); }
  }
  for (const locale of ['zh-CN','en-US']) { await i18n.changeLanguage(locale); for (const layer of [true,false]) assert.doesNotMatch(renderToStaticMarkup(React.createElement(Seedream55Controls, { data: {}, layer, update() {} })), /seedream55:/); for (const enhance of [true,false]) assert.doesNotMatch(renderToStaticMarkup(React.createElement(Seedance25DraftControls, { data: {}, enhance, upstreamId: '', update() {} })), /seedream55:/); }
  await i18n.changeLanguage('zh-CN');
});
test('eight saved workflows import, have compatible completed-source connections and no credentials or task identities', () => {
  const { MODELS, workflow } = require('../scripts/generate-seedream55-draft-workflows.cjs'); assert.equal(MODELS.length, 8);
  for (const model of MODELS) { const stored = JSON.parse(fs.readFileSync(new URL('../docs/workflows/' + model + '.json', import.meta.url), 'utf8')); assert.deepEqual(stored, workflow(model)); const fragment = workflowManifestToFragment(stored, { includeApiKeys: false })!; assert.ok(fragment); const nodes: any[] = fragment.nodes.map(node => ({ ...node, data: { ...node.data, ...(node.type === 'upload' ? { imageUrl: '/files/input/source.png' } : {}) } })); for (const edge of fragment.edges) assert.ok(isConnectionValid(nodes.find(node => node.id === edge.source), nodes.find(node => node.id === edge.target), edge), model); assert.doesNotMatch(JSON.stringify(stored), /sk-|task_[A-Za-z0-9]+|apiKey|https?:\/\//); }
});
test('all eight new model recipes query original tasks with media timeout floor', () => {
  for (const model of [...c.imageModels,...c.layerModels,...c.draftModels]) { const recovery = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model, taskId: 'fixture' }); assert.ok(recovery, model); assert.equal(recovery.taskId, 'fixture'); assert.ok(recovery.maxPolls * recovery.pollIntervalMs >= 900000); }
});
