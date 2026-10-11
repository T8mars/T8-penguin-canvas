import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MaiImageControls from '../src/components/nodes/MaiImageControls';
import i18n from '../src/i18n';
import * as models from '../src/providers/models';
import { buildMaiImageRequest, maiImageSettings } from '../src/utils/maiImage';
const source = (name: string) => ts.createSourceFile(name, fs.readFileSync(new URL(`../src/components/nodes/${name}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(file: ts.SourceFile, find: (node: ts.Node) => ts.Expression | undefined, bindings: Record<string, unknown>) {
  const matches: ts.Expression[] = [];
  function visit(node: ts.Node) { const match = find(node); if (match) matches.push(match); ts.forEachChild(node, visit); }
  visit(file); assert.equal(matches.length, 1, 'exactly one production handler');
  return vm.runInNewContext(ts.transpileModule(`(${matches[0].getText(file)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { ...models, maiImageSettings, buildMaiImageRequest, ...bindings });
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('production Mai tab/model handlers preserve existing settings and choose exact budget identity', () => {
  const patches: any[] = [], file = source('ImageNode');
  const closure = (name: string) => expression(file, (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name ? node.initializer : undefined,
    { update: (patch: any) => patches.push(plain(patch)), d: { maiResolution: '2k', maiWebGrounding: true } });
  closure('switchModel')('mai-image-2-6');
  assert.equal(patches[0].model, 'mai-image-2-6'); assert.equal(patches[0].imageBuiltinSource, 'seedance-nz');
  assert.equal(patches[0].maiResolution, '2k'); assert.equal(patches[0].maiWebGrounding, true);
  closure('switchApiModel')('mai-image-2-6-flash');
  assert.deepEqual(patches[1], { model: 'mai-image-2-6', apiModel: 'mai-image-2-6-flash', imageBuiltinSource: 'seedance-nz', aspectRatio: '', sizeLevel: '' });
  const tab = (budget: boolean) => expression(file, (node) => ts.isCallExpression(node) && node.arguments[0]?.getText(file).includes('m.id !== MAI_IMAGE_TAB') ? node.arguments[0] : undefined,
    { isZhenzhenBudgetPlatformSelected: budget });
  assert.equal(tab(false)({ id: 'mai-image-2-6' }), false); assert.equal(tab(true)({ id: 'mai-image-2-6' }), true);
});

test('actual Mai controls capture events synchronously and survive cleared event/replayed patches', () => {
  const file = source('MaiImageControls');
  for (const field of ['maiSize', 'maiCustomRatio', 'maiWidth', 'maiHeight', 'maiResolution', 'maiAutoAspectRatio', 'maiWebGrounding']) {
    const patches: any[] = [];
    const handler = expression(file, (node) => ts.isJsxAttribute(node) && node.name.getText(file) === 'onChange'
      && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(file).includes(`update({ ${field}:`)
      ? node.initializer.expression : undefined, { update: (patch: any) => patches.push(plain(patch)) });
    const value = field === 'maiSize' ? 'custom_ratio' : field === 'maiCustomRatio' ? '5:3' : field === 'maiResolution' ? '2k' : '768';
    const event: any = { currentTarget: { value, checked: false } }; handler(event); event.currentTarget = null;
    const expected = ['maiWidth', 'maiHeight'].includes(field) ? 768 : ['maiAutoAspectRatio', 'maiWebGrounding'].includes(field) ? false : value;
    assert.deepEqual(patches[0], { [field]: expected });
    assert.deepEqual({ keep: 'old', ...patches[0] }, { keep: 'old', [field]: expected });
    assert.deepEqual({ keep: 'new', ...patches[0] }, { keep: 'new', [field]: expected });
  }
});

test('Mai production collector exposes overflow and repeated slots instead of silently truncating', () => {
  const file = source('ImageNode');
  const orderedImages = Array.from({ length: 6 }, (_, index) => ({ url: `image-${index % 2}` }));
  const collect = expression(file, (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === 'collectUpstream' ? node.initializer : undefined,
    { orderedImages, orderedTexts: [], isMaiImage: true, isFluxImage: false, isZhenzhenNb21: false, maxRefs: 5, getEdges: null, getNodes: null });
  assert.deepEqual(plain(collect()).images, orderedImages.map((item) => item.url));
});

test('ImageNode actual submit expression sends only the Mai contract, including reference sizing omission', () => {
  const file = source('ImageNode');
  for (const providerRefs of [[], ['reference-a', 'reference-b']]) {
    const settings = maiImageSettings({ maiSize: 'custom_pixels', maiWebGrounding: false });
    const request = expression(file, (node) => ts.isCallExpression(node) && node.expression.getText(file) === 'submitSeedreamNz'
      && node.arguments[0]?.getText(file).includes('buildMaiImageRequest') ? node.arguments[0] : undefined,
      { isMaiImage: true, apiModel: 'mai-image-2-6-flash', finalPrompt: 'Blue teapot', providerRefs, maiSettings: settings });
    assert.deepEqual(plain(request), plain(buildMaiImageRequest('mai-image-2-6-flash', 'Blue teapot', providerRefs, settings)));
    assert.doesNotMatch(JSON.stringify(request), /output_format|seed|quality|metadata/);
  }
});

test('Mai panel renders bilingual controls, hides reference sizing and respects theme tokens/narrow grids', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    await i18n.changeLanguage(locale);
    const render = (data: any, count = 0) => renderToStaticMarkup(React.createElement(MaiImageControls, { data, referenceCount: count, update() {} }));
    const normal = render({}); assert.match(normal, /mai|Mai/); assert.match(normal, /Bing/);
    assert.match(normal, /nodrag nowheel/); assert.match(normal, /var\(--t8-bg-panel\)/); assert.match(normal, /min-w-0/);
    const custom = render({ maiSize: 'custom_pixels' }); assert.match(custom, /type="number"/); assert.match(custom, /2359296|2,359,296/);
    const reference = render({ maiSize: 'custom_pixels' }, 2); assert.doesNotMatch(reference, /type="number"|<select/);
    const automatic = render({ maiSize: 'custom_pixels', maiAutoAspectRatio: true }); assert.doesNotMatch(automatic, /type="number"/);
    assert.ok(!normal.includes('nodes:generation.mai.'));
  }
  await i18n.changeLanguage('zh-CN');
});
