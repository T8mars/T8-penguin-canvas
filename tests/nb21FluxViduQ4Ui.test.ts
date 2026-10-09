import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as models from '../src/providers/models';

function component(name: string) {
  const file = new URL(`../src/components/nodes/${name}.tsx`, import.meta.url);
  return ts.createSourceFile(file.pathname, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function execute(source: ts.SourceFile, select: (node: ts.Node) => ts.Expression | undefined, bindings: Record<string, unknown>) {
  const matches: ts.Expression[] = [];
  function visit(node: ts.Node) { const value = select(node); if (value) matches.push(value); ts.forEachChild(node, visit); }
  visit(source);
  assert.equal(matches.length, 1, 'execute exactly one real production handler');
  const javascript = ts.transpileModule(`(${matches[0].getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(javascript, { ...models, ...bindings });
}
function closure(name: string, declaration: string, bindings: Record<string, unknown>) {
  const source = component(name);
  return execute(source, (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === declaration ? node.initializer : undefined, bindings);
}
function control(name: string, attribute: string, value: string, bindings: Record<string, unknown>) {
  const source = component(name);
  return execute(source, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const properties = node.attributes.properties;
    if (!properties.some((property) => ts.isJsxAttribute(property) && property.name.getText(source) === attribute
      && property.initializer?.getText(source) === `{${value}}`)) return;
    const change = properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'onChange') as ts.JsxAttribute | undefined;
    return change?.initializer && ts.isJsxExpression(change.initializer) ? change.initializer.expression : undefined;
  }, bindings);
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('production ImageNode model switches select budget Flux/banana21, preserving old defaults and valid new enums', () => {
  const patches: any[] = [];
  const update = (patch: unknown) => patches.push(plain(patch));
  closure('ImageNode', 'switchModel', { update })('flux-3-image');
  assert.deepEqual(patches.pop(), { model: 'flux-3-image', apiModel: 'flux-3-image', imageBuiltinSource: 'seedance-nz', aspectRatio: 'auto', sizeLevel: '1k' });
  closure('ImageNode', 'switchApiModel', { update, aspectRatio: '1:8', sizeLevel: '0.5K', d: {} })('zhenzhen-image-nb-2.1');
  const banana = patches.pop();
  assert.equal(banana.model, 'nano-banana-2');
  assert.equal(banana.imageBuiltinSource, 'seedance-nz');
  assert.equal(banana.apiModel, 'zhenzhen-image-nb-2.1');
  assert.equal(banana.aspectRatio, '1:1');
  assert.equal(banana.sizeLevel, '1K');
  assert.equal(banana.apimartImageCount, 1);
  const source = component('ImageNode');
  const tabFilter = (budget: boolean) => execute(source, (node) => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'filter'
    && node.arguments[0]?.getText(source).includes('m.id !== FLUX3_IMAGE_MODEL')
    ? node.arguments[0] : undefined, { isZhenzhenBudgetPlatformSelected: budget });
  assert.equal(tabFilter(false)({ id: 'flux-3-image' }), false);
  assert.equal(tabFilter(true)({ id: 'flux-3-image' }), true);
  assert.equal(tabFilter(false)({ id: 'nano-banana-2' }), true);
});

test('production new-model material collection preserves repeated slots and exposes overflow for explicit validation', () => {
  const orderedImages = Array.from({ length: 16 }, (_, index) => ({ url: `image-${index % 3}` }));
  for (const [isFluxImage, isZhenzhenNb21, maxRefs] of [[true, false, 10], [false, true, 14]] as const) {
    const collect = closure('ImageNode', 'collectUpstream', { orderedImages, orderedTexts: [], isFluxImage, isZhenzhenNb21, maxRefs, getEdges: null, getNodes: null });
    assert.deepEqual(plain(collect()).images, orderedImages.map((item) => item.url));
  }
  const fields = { orderedTexts: [{ url: 'prompt' }], orderedImages: [{ url: 'a' }, { url: 'b' }, { url: 'a' }],
    orderedVideos: [], orderedAudios: [{ url: 'audio' }, { url: 'audio' }], localRefImages: ['c', 'a'], localRefVideos: [], localRefAudios: ['audio'] };
  const collect = closure('VideoNode', 'collectUpstream', { ...fields, isViduQ4: true });
  assert.deepEqual(plain(collect()), { prompt: 'prompt', imageUrls: ['a', 'b', 'a', 'c', 'a'], videoUrls: [], audioUrls: ['audio', 'audio', 'audio'] });
  const legacy = closure('VideoNode', 'collectUpstream', { ...fields, isViduQ4: false });
  assert.deepEqual(plain(legacy()).imageUrls, ['a', 'b', 'c']);
});

test('production Q4 selection captures each event before cleanup and resets only the selected node to official defaults', () => {
  const patches: any[] = [];
  const handler = control('VideoNode', 'value', 'apiModel', { update: (patch: unknown) => patches.push(plain(patch)) });
  for (const model of models.VIDU_Q4_MODELS) {
    const event: any = { target: { value: model }, currentTarget: { value: model } };
    handler(event);
    event.target = null; event.currentTarget = null;
  }
  assert.equal(patches.length, 4);
  patches.forEach((patch, index) => assert.deepEqual(patch, { model: models.VIDU_Q4_MODELS[index], ratio: '16:9', duration: 5,
    resolution: '720p', generateAudio: true, viduQ4IsRec: true, viduQ4Watermark: false }));
  const source = component('VideoNode');
  const ratio = (isViduQ4: boolean, viduMode: string) => execute(source, (node) => ts.isJsxAttribute(node)
    && node.name.getText(source) === 'value' && node.initializer && ts.isJsxExpression(node.initializer)
    && node.initializer.getText(source).includes("'input-image'") ? node.initializer.expression : undefined,
  { isViduQ4, viduMode, viduRatio: '16:9' });
  assert.equal(ratio(true, 'i2v'), 'input-image');
  assert.equal(ratio(true, 'r2v'), '16:9');
  assert.equal(ratio(false, 'i2v'), '16:9');
});

test('actual Flux/Q4 controls preserve false and safety zero independently of cleared events and patch replay', () => {
  for (const [componentName, field, attribute, payload, expected] of [
    ['ImageNode', 'fluxImageGrounding', 'checked', { checked: false }, false],
    ['ImageNode', 'fluxImageSafetyTolerance', 'value', { value: '0' }, 0],
    ['VideoNode', 'viduQ4IsRec', 'checked', { checked: false }, false],
    ['VideoNode', 'viduQ4Watermark', 'checked', { checked: true }, true],
  ] as const) {
    const patches: any[] = [];
    const handler = control(componentName, attribute, field, { update: (patch: unknown) => patches.push(plain(patch)) });
    const event: any = { target: { ...payload }, currentTarget: { ...payload } };
    handler(event);
    event.target = null; event.currentTarget = null;
    assert.deepEqual(patches[0], { [field]: expected });
    const newer = { unchanged: 'preserve', [field]: !expected };
    assert.deepEqual({ ...newer, ...patches[0] }, { unchanged: 'preserve', [field]: expected });
    assert.deepEqual({ ...newer, ...patches[0] }, { unchanged: 'preserve', [field]: expected });
  }
});
