import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MossImageControls from '../src/components/nodes/MossImageControls';
import i18n from '../src/i18n';
import * as models from '../src/providers/models';
import { MOSS_IMAGE_CONTRACT, buildMossImageRequest } from '../src/utils/mossImage';
const source = (name: string) => ts.createSourceFile(name, fs.readFileSync(new URL(`../src/components/nodes/${name}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(file: ts.SourceFile, find: (node: ts.Node) => ts.Expression | undefined, bindings: Record<string, unknown>) {
  const matches: ts.Expression[] = [];
  function visit(node: ts.Node) { const match = find(node); if (match) matches.push(match); ts.forEachChild(node, visit); }
  visit(file); assert.equal(matches.length, 1, 'exactly one production handler');
  return vm.runInNewContext(ts.transpileModule(`(${matches[0].getText(file)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { ...models, MOSS_IMAGE_CONTRACT, buildMossImageRequest, ...bindings });
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('production Moss tab and API handlers select exact identity and 9:16 default', () => {
  const patches: any[] = [], file = source('ImageNode');
  const closure = (name: string, aspectRatio = 'auto') => expression(file, (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name ? node.initializer : undefined,
    { aspectRatio, update: (patch: any) => patches.push(plain(patch)) });
  closure('switchModel')('moss-image'); closure('switchApiModel')('moss-image'); closure('switchApiModel', '21:9')('moss-image');
  for (const patch of patches) assert.deepEqual(patch, { model: 'moss-image', apiModel: 'moss-image', imageBuiltinSource: 'seedance-nz', aspectRatio: patch === patches[2] ? '21:9' : '9:16', sizeLevel: '' });
  const tab = (budget: boolean) => expression(file, (node) => ts.isCallExpression(node) && node.arguments[0]?.getText(file).includes('m.id !== MOSS_IMAGE_MODEL') ? node.arguments[0] : undefined,
    { isZhenzhenBudgetPlatformSelected: budget });
  assert.equal(tab(false)({ id: 'moss-image' }), false); assert.equal(tab(true)({ id: 'moss-image' }), true);
});

test('Moss real change handler captures consecutive values before event clear/replay', () => {
  const patches: any[] = [], file = source('MossImageControls');
  const handler = expression(file, (node) => ts.isJsxAttribute(node) && node.name.getText(file) === 'onChange'
    && node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined,
    { update: (patch: any) => patches.push(plain(patch)) });
  for (const value of MOSS_IMAGE_CONTRACT.ratios) {
    const event: any = { currentTarget: { value } }; handler(event); event.currentTarget = null;
  }
  assert.deepEqual(patches, MOSS_IMAGE_CONTRACT.ratios.map((aspectRatio) => ({ aspectRatio })));
  assert.deepEqual({ keep: 'new', ...patches.at(-1) }, { keep: 'new', aspectRatio: '21:9' });
});

test('production Moss collector exposes overflow before upload instead of truncating', () => {
  const file = source('ImageNode'), orderedImages = [{ url: 'same' }, { url: 'same' }];
  const collect = expression(file, (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === 'collectUpstream' ? node.initializer : undefined,
    { orderedImages, orderedTexts: [], isMossImage: true, isMaiImage: false, isFluxImage: false, isZhenzhenNb21: false, maxRefs: 1, getEdges: null, getNodes: null });
  assert.deepEqual(plain(collect()).images, ['same', 'same']);
});

test('ImageNode actual Moss submit expression uses no inherited model-specific fields', () => {
  const file = source('ImageNode');
  for (const providerRefs of [[], ['reference']]) {
    const request = expression(file, (node) => ts.isCallExpression(node) && node.expression.getText(file) === 'submitSeedreamNz'
      && node.arguments[0]?.getText(file).includes('buildMossImageRequest') ? node.arguments[0] : undefined,
      { isMaiImage: false, isMossImage: true, finalPrompt: 'Blue teapot', providerRefs, effectiveAspectRatio: '16:9' });
    assert.deepEqual(plain(request), buildMossImageRequest('Blue teapot', providerRefs, '16:9'));
  }
});

test('Moss bilingual panel has exactly eight options and only ratio, themed/narrow-safe controls', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    await i18n.changeLanguage(locale);
    const html = renderToStaticMarkup(React.createElement(MossImageControls, { ratio: '9:16', update() {} }));
    assert.equal((html.match(/<select/g) || []).length, 1); assert.equal((html.match(/<option/g) || []).length, 8);
    assert.match(html, /selected=""[^>]*>9:16/); assert.match(html, /nodrag nowheel/);
    assert.match(html, /min-w-0/); assert.match(html, /var\(--t8-bg-panel\)/);
    assert.doesNotMatch(html, /type="number"|nodes:generation\./);
    assert.notEqual(i18n.t('nodes:generation.moss.description'), 'nodes:generation.moss.description');
  }
  await i18n.changeLanguage('zh-CN');
});
