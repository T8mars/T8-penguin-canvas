import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import vm from 'node:vm';
import { TRIPO, buildTripoRequest } from '../src/utils/tripo3d';
import Tripo3dControls from '../src/components/nodes/Tripo3dControls';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { isConnectionValid } from '../src/config/portTypes';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { selectSingleSourceHandleData } from '../src/utils/sourceHandleData';
import { tripoForwardData } from '../src/utils/tripoProvenance';
import i18n from '../src/i18n';
const require = createRequire(import.meta.url), translate = (key: string) => key;

test('connected model and native segmentation provenance form valid requests without hidden controls', () => {
  const data = { tripo_compress: 'geometry', tripo_seg_type: 'model', tripo_transform: 'old inactive value' };
  const request = buildTripoRequest('tripo-mesh-segment-v1', [], data, { modelUrls: ['/files/output/model.glb'], tripoTaskIds: [] }, translate);
  assert.deepEqual(request.metadata, { model_url: '/files/output/model.glb' });
  const complete = buildTripoRequest('tripo-mesh-complete', [], {}, { modelUrls: ['/files/output/model.glb'], tripoTaskIds: ['native-fixture'] }, translate);
  assert.equal(complete.metadata?.tripo_segment_task_id, 'native-fixture');
  assert.throws(() => buildTripoRequest('tripo-mesh-complete', [], { taskId: 'platform-fixture' }, { modelUrls: [], tripoTaskIds: [] }, translate), /required/);
  assert.throws(() => buildTripoRequest('tripo-retopology-v2', [], {}, { modelUrls: ['first', 'second'], tripoTaskIds: [] }, translate), /ambiguousModel/);
  assert.throws(() => buildTripoRequest('tripo-retopology-v2', [], { tripo_model_url: 'https://cdn.example/other.glb' }, { modelUrls: ['/files/output/model.glb'], tripoTaskIds: [] }, translate), /ambiguousModel/);
});
test('all controls and workflow templates retain exact model IDs, port compatibility and bilingual fields', async () => {
  const { workflow } = require('../scripts/generate-tripo-workflows.cjs'), contract = require('../backend/src/shared/tripo3dContract.json');
  const schema = require('../backend/src/shared/canvasNodeSchema.json');
  for (const locale of ['zh-CN', 'en-US']) {
    await i18n.changeLanguage(locale);
    for (const item of contract.models) {
      const text = renderToStaticMarkup(React.createElement(Tripo3dControls, { model: item.id, data: {}, update() {}, imageCount: 0 }));
      assert.doesNotMatch(text, /tripo:|fields\.[a-z_]+/);
      assert.ok(schema.types.find((node: any) => node.type === 'model-3d').generation.allowedDataFields.model.enum.includes(item.id));
      const stored = JSON.parse(fs.readFileSync(new URL('../docs/workflows/' + item.id + '.json', import.meta.url), 'utf8'));
      assert.deepEqual(stored, workflow(item));
      const fragment = workflowManifestToFragment(stored, { includeApiKeys: false }); assert.ok(fragment);
      const nodes: any[] = fragment!.nodes.map(node => ({ ...node, data: { ...node.data,
        ...(node.type === 'upload' ? { imageUrl: '/files/input/front.png' } : {}),
        ...(node.type === 'model-3d-upload' ? { modelUrl: '/files/input/source.glb' } : {}),
      } }));
      for (const edge of fragment!.edges) assert.equal(isConnectionValid(nodes.find(n => n.id === edge.source), nodes.find(n => n.id === edge.target), edge), true, item.id);
      assert.doesNotMatch(JSON.stringify(stored), /sk-|apiKey|taskId|tripo_task_id|https?:\/\//);
    }
  }
  await i18n.changeLanguage('zh-CN');
});
test('actual control handlers capture event values before cleared events and state replay', () => {
  const source = ts.createSourceFile('Tripo3dControls', fs.readFileSync(new URL('../src/components/nodes/Tripo3dControls.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: ts.Expression[] = [];
  const visit = (n: ts.Node) => { if (ts.isJsxAttribute(n) && n.name.getText(source) === 'onChange' && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) handlers.push(n.initializer.expression); ts.forEachChild(n, visit); }; visit(source); assert.equal(handlers.length, 3);
  for (const expression of handlers) {
    const patches: any[] = [], handler = vm.runInNewContext(ts.transpileModule('(' + expression.getText(source) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { field: 'model_url', spec: { type: 'text' }, change: (field: string, value: any) => patches.push({ field, value }) });
    for (const value of ['first', 'second']) { const event: any = { currentTarget: { value } }; handler(event); event.currentTarget = null; }
    assert.deepEqual(patches, [{ field: 'model_url', value: 'first' }, { field: 'model_url', value: 'second' }]);
  }
});
test('all Tripo models use original-task recovery and model ports preserve native identity', () => {
  for (const model of TRIPO.models) { const recovery = inferRunRecoveryDescriptor({ provider: 'seedance-nz-3d', model, taskId: 'platform-fixture' }); assert.equal(recovery?.kind, 'model3d'); assert.equal(recovery?.taskId, 'platform-fixture'); assert.ok(recovery!.maxPolls * recovery!.pollIntervalMs >= 900000); }
  const selected = selectSingleSourceHandleData({ modelUrl: '/files/output/model.glb', tripoTaskId: 'native-fixture', tripoPartNames: ['part'], tripoFiles: [], prompt: 'not a model' }, 'model3d');
  assert.equal(selected.tripoTaskId, 'native-fixture'); assert.equal(selected.prompt, undefined);
});
test('Relay/Output forwarding clears removed models and never chooses between native tasks', () => {
  const a = { modelUrl: '/files/output/a.glb', modelUrls: ['/files/output/a.glb'], tripoTaskId: 'native-a', tripoPartNames: ['part_a'], tripoFiles: [] };
  assert.equal(tripoForwardData([a]).tripoTaskId, 'native-a');
  assert.equal(tripoForwardData([a], []).tripoTaskId, '');
  assert.equal(tripoForwardData([a, { ...a, tripoTaskId: 'native-b' }]).tripoTaskId, '');
  assert.deepEqual(tripoForwardData([a]).tripoPartNames, ['part_a']);
  assert.equal(tripoForwardData([]).modelUrl, undefined);
});
