import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { orderMaterials } from '../src/components/nodes/useOrderedMaterials.ts';
import { filterExcludedMaterials, normalizeExcludedMaterialIds } from '../src/utils/materialExclusion.ts';
import { resolveMediaMentions } from '../src/components/nodes/mediaMentions.ts';
import { combinePromptWithImageAdjustments, normalizeImagePromptAdjustmentSelections,
  IMAGE_PROMPT_ADJUSTMENTS, createImagePromptAdjustmentSelection } from '../src/data/imagePromptAdjustments.ts';
import { captureGenerationHistoryInput } from '../src/utils/generationHistoryCapture.ts';
import { captureHistoryExecution } from '../src/utils/historyResolvedSeedanceInput.ts';
import { historyImageBasicSettings } from '../src/utils/historyImageBasicSettings.ts';
import { readHistoryStandardImageInput } from '../src/utils/historyStandardImageInput.ts';
import { readHistoryBudgetImageInput } from '../src/utils/historyBudgetImageInput.ts';
import { readHistoryFalImageInput } from '../src/utils/historyFalImageInput.ts';
import { readHistoryStandardBananaInput } from '../src/utils/historyStandardBananaInput.ts';
import * as models from '../src/providers/models.ts';
import { prepareHistoryInputDraft, createHistoryInputDraftPatch } from '../src/utils/generationHistoryInputDraft.ts';
import { prepareHistorySettingsDraft } from '../src/utils/generationHistorySettings.ts';
import historyInputContract from '../backend/src/shared/generationHistoryInputContract.json';

// Execute ImageNode's actual material pipeline, collector, resolver and capture
// callback. useMemo is evaluated once for a controlled render; ordering,
// exclusions, mentions, adjustment compilation and archival are real helpers.
// No React UI, Provider transport, filesystem media or database is simulated as
// having passed an end-to-end acceptance test here.
const source = readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('ImageNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['localPrompt', 'promptMentions', 'imagePromptAdjustments', 'refImages',
  'excludedMaterialIds', 'visibleUpstreamImages', 'visibleUpstreamTexts', 'localImageMaterials',
  'allImagesUnordered', 'materialOrder', 'orderedImages', 'orderedTexts', 'mentionMaterials',
  'collectUpstream', 'resolveGenerationInput', 'isQwenImage21Tab']);
const declarations: string[] = [];
let capture = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) declarations.push(`const ${node.getText(tree)};`);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useRunTrigger') {
    const options = node.arguments[3];
    if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties) {
      if (ts.isPropertyAssignment(property) && property.name.getText(tree) === 'captureHistoryInput') capture = property.initializer.getText(tree);
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, names.size);
assert.ok(capture);
const compiled = ts.transpileModule(`${declarations.join('\n')}\nreturn { collectUpstream, resolveGenerationInput, capture: ${capture} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const factory = new Function('scope', `with (scope) { ${compiled} }`);
const material = (id: string, url: string, kind = 'image') => ({ id, url, kind, sourceNodeId: 'upstream', origin: 'upstream' });
function render(d: Record<string, unknown>, images: ReturnType<typeof material>[] = [], texts: ReturnType<typeof material>[] = [], maxRefs = 14,
  extra: Record<string, unknown> = {}) {
  return factory({ id: 'image', d, upstream: { images, texts }, maxRefs,
    getEdges() { throw new Error('collector must not reread live edges'); },
    getNodes() { throw new Error('collector must not reread live nodes'); },
    useMemo: (read: () => unknown) => read(), useOrderedMaterials: orderMaterials,
    filterExcludedMaterials, normalizeExcludedMaterialIds, resolveMediaMentions,
    combinePromptWithImageAdjustments, normalizeImagePromptAdjustmentSelections,
    historyInputContract, isComfyExternal: false, comfyHasPromptField: false, providerParams: {},
    modelDef: { id: 'gpt-image-2' }, apiModel: 'fixture-model', effectiveAspectRatio: '1:1', effectiveSizeLevel: '1K',
    isExternalSelected: false, isZhenzhenBudgetPlatformSelected: false, isSeedream: false,
    isStandardGptImage2: false, isGptImage25: false, isSeedreamNz: false, isFal: false, isMj: false,
    isZhenzhenBudgetImageSelected: false, isQwenImageTab: false, isWanImageTab: false, isSeedreamLayerTab: false, ...extra,
  });
}

test('image context uses the actual combined local/upstream ordering, exclusions and model cap', () => {
  const a = '/files/input/a.png', b = '/files/input/b.png', c = '/files/input/c.png';
  const images = [material('up-b', b), material('excluded', '/files/input/excluded.png'), material('up-c', c)];
  const d = { referenceImages: [a], materialOrder: ['missing', 'up-c', 'excluded', `local::image:${a}`, 'up-b'], excludedMaterialIds: ['excluded'] };
  const original = structuredClone({ d, images });
  const result = render(d, images, [], 2);
  assert.deepEqual(result.collectUpstream(), { prompt: '', images: [c, a] });
  assert.deepEqual(result.capture().referenceImages, [c, a]);
  assert.deepEqual({ d, images }, original, 'collecting never mutates the graph or order');
  assert.deepEqual(render({ referenceImages: [a] }, images.slice(0, 1)).capture().referenceImages, [a, b]);
});

test('ordinary Banana final fixed-asset draft preserves actual capture and request arguments for six models', async () => {
  const submits: string[] = [];
  const visitSubmit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'submitImageAsync') submits.push(node.arguments[0].getText(tree));
    ts.forEachChild(node, visitSubmit);
  };
  visitSubmit(tree); assert.equal(submits.length, 1);
  const request = new Function('scope', `with(scope) { return (${submits[0]}); }`);
  const backend = readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');
  const sizeStart = backend.indexOf('function geminiOfficialImageSize(');
  const sizeEnd = backend.indexOf('async function buildGeminiOfficialContents(', sizeStart);
  assert.ok(sizeStart >= 0 && sizeEnd > sizeStart);
  const officialSize = new Function(`${backend.slice(sizeStart, sizeEnd)}; return geminiOfficialImageSize;`)();
  let count = 0;
  for (const modelDef of models.IMAGE_MODELS.filter(model => ['nano-banana-2', 'nano-banana-pro'].includes(model.id))) {
    for (const option of modelDef.apiModelOptions!.filter(option => !models.isFalModel(option.value))) {
      count++;
      for (const withRefs of [false, true]) {
        const flags = { modelDef, apiModel: option.value, effectiveAspectRatio: withRefs ? '16:9' : 'Auto',
          effectiveSizeLevel: '4K', isGptImage25: false, isSeedream: false, isStandardGptImage2: false };
        const images = withRefs ? [material('blue-1', '/files/input/blue.png'), material('orange', '/files/input/orange.png'),
          material('blue-2', '/files/input/blue.png'), material('four', '/files/input/four.png'),
          material('five', '/files/input/five.png'), material('over-cap', '/files/input/over.png')] : [];
        const adjustment = createImagePromptAdjustmentSelection(IMAGE_PROMPT_ADJUSTMENTS.find(item => item.applicability === 'all')!);
        const d = { prompt: withRefs ? 'Use @image2, keep literal img2' : 'Text only',
          imagePromptAdjustments: [adjustment],
          model: modelDef.id, apiModel: option.value };
        const context = render(d, images, [material('text', 'Original upstream prompt', 'text')], modelDef.maxReferenceImages, flags).capture();
        assert.ok(context.prompt.includes(adjustment.promptEn), 'actual adjustment compilation must participate');
        const prepared = readHistoryStandardBananaInput({ ...d, historyResolvedInput: context });
        const original = request({ ...flags, finalPrompt: context.prompt, allRefs: context.referenceImages, providerParams: {} });
        const restored = request({ ...flags, apiModel: prepared.settings.apiModel,
          effectiveAspectRatio: prepared.settings.aspectRatio, effectiveSizeLevel: prepared.settings.sizeLevel,
          finalPrompt: prepared.prompt, allRefs: prepared.media.map(item => item.url), providerParams: {} });
        assert.deepEqual(restored, original);
        assert.equal(restored.n, 1); assert.equal(restored.quality, undefined);
        assert.equal(restored.images.length, withRefs ? 5 : 0);
        if (withRefs) assert.equal(restored.images[0], restored.images[2]);
        assert.equal(prepared.prompt, context.prompt, 'compiled prompt must not acquire the current upstream prompt');
        if (['gemini-3.1-flash-lite-image', 'gemini-3-pro-image'].includes(option.value)) {
          assert.equal(officialSize(restored.apiModel, restored.image_size), option.value.includes('lite') ? '1K' : '4K');
        }
        const scope = { projectId: 'banana-project', canvasId: 'banana-canvas' };
        const urls = [...new Set(context.referenceImages as string[])];
        const assets = urls.map((sourceUrl, index) => ({ id: `banana-asset-${index}`, projectId: scope.projectId,
          entityUid: `a1000000-0000-4000-8000-00000000000${index}`, contentHash: String(index + 1).repeat(64),
          kind: 'image', availability: 'available', sourceUrl }));
        const group: any = { id: 'banana-group', nodeId: 'original', nodeEntityUid: 'original-uid', nodeType: 'image', snapshotAvailable: true };
        const archive: any = { status: 'available', digest: 'verified-banana-input',
          binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
          snapshot: { node: { id: group.nodeId, type: 'image', data: { ...d, historyResolvedInput: context } }, upstreamNodes: [], incomingEdges: [] },
          references: { status: 'captured', entries: context.referenceImages.map((url: string, index: number) => {
            const asset = assets.find(asset => asset.sourceUrl === url)!;
            return { status: 'bound', kind: 'image', assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash,
              path: ['node', 'data', 'historyResolvedInput', 'referenceImages', index] };
          }) } };
        let reads = 0;
        const draft = await prepareHistoryInputDraft(archive, group, scope, { assertCurrent() {}, request: async () => ({ ok: true }),
          getAsset: async id => { reads++; return assets.find(asset => asset.id === id) as any; } });
        const patch = createHistoryInputDraftPatch(draft, { ...scope, id: 'confirmed-banana', baseRevision: 1, position: { x: 0, y: 0 } });
        assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
        const node: any = patch.operations[0].payload.node;
        const finalFlags = { ...flags, apiModel: node.data.apiModel,
          effectiveAspectRatio: node.data.aspectRatio, effectiveSizeLevel: node.data.sizeLevel };
        const finalContext = render(node.data, [], [], modelDef.maxReferenceImages, finalFlags).capture();
        const finalRequest = request({ ...finalFlags, finalPrompt: finalContext.prompt, allRefs: finalContext.referenceImages, providerParams: {} });
        const { images: oldImages, ...oldValues } = original, { images: finalImages, ...finalValues } = finalRequest;
        assert.deepEqual(finalValues, oldValues); assert.equal(reads, urls.length);
        assert.equal(finalImages.length, oldImages.length); assert.equal(new Set(finalImages).size, oldImages.length);
        for (const [index, ref] of finalImages.entries()) {
          const address = new URL(ref, 'http://localhost'), asset = assets.find(asset => asset.sourceUrl === oldImages[index])!;
          assert.equal(address.pathname, `/api/project-assets/${asset.id}/media`);
          assert.equal(address.searchParams.get('projectId'), scope.projectId);
          assert.equal(address.searchParams.get('entityUid'), asset.entityUid);
          assert.equal(address.searchParams.get('contentHash'), asset.contentHash);
          assert.equal(address.searchParams.get('referenceSlot'), String(index));
        }
      }
    }
  }
  assert.equal(count, 6);
  // Final node data re-enters the real material/capture/request expressions.
  // Controlled asset/HEAD results are not physical bytes, HTTP or GUI evidence;
  // the node.add patch has not been applied to an actual canvas here.
});

test('FAL history preparation round-trips actual frontend capture and backend effective payload for all models', async () => {
  const start = source.indexOf('const falMode:'), end = source.indexOf('// ========== MJ', start);
  assert.ok(start > 0 && end > start);
  const parameterKeys = ['falMode', 'falSize', 'falCustomW', 'falCustomH', 'falQuality', 'falN', 'falFormat', 'falSync',
    'nbAspect', 'nbResolution', 'nbSafety', 'nbImgMode', 'nbWebSearch', 'nbSysPrompt', 'nbSeed'];
  const parameters = new Function('d', ts.transpileModule(`${source.slice(start, end)}\nreturn {${parameterKeys.join(',')}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText);
  const submits: string[] = [];
  const findSubmit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'submitImageFal') submits.push(node.arguments[0].getText(tree));
    ts.forEachChild(node, findSubmit);
  };
  findSubmit(tree); assert.equal(submits.length, 1);
  const request = new Function('scope', `with(scope) { return (${submits[0]}); }`);
  const backend = readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');
  const section = (from: string, to: string, offset = 0) => {
    const first = backend.indexOf(from, offset), last = backend.indexOf(to, first);
    assert.ok(first >= 0 && last > first, from); return backend.slice(first, last);
  };
  const backendCode = section('const FAL_REGISTRY = {', '\nfunction falRegistryEndpoints')
    + section('function snap16(', '\nfunction safeFalRequestId')
    + '\nconst reg = FAL_REGISTRY[apiModel];\n'
    + section('const refs = Array.isArray(images)', 'const falUrl =', backend.indexOf("router.post('/image/fal/submit',"))
    + '\nreturn {payload, endpoint}; } catch (error) { throw error; }';
  const payload = new Function('scope', `return (async () => { with(scope) { ${backendCode} } })();`);
  const io = { apiKey: 'controlled', uploadRefToZhenzhen: async (ref: string) => `uploaded:${ref}`,
    refToBananaImage: async (ref: string) => `base64:${ref}` };
  for (const apiModel of ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal']) for (const alternate of [false, true]) {
    const falDef = models.FAL_REGISTRY[apiModel], gpt = falDef.paramKind === 'gpt-fal';
    const modelDef = models.IMAGE_MODELS.find(model => model.apiModelOptions?.some(option => option.value === apiModel));
    assert.ok(modelDef);
    const data = { prompt: 'Use @image2 and keep @img1 literally.', referenceImages: ['/files/input/a.png', '/files/input/b.png', '/files/input/a.png'],
      falMode: alternate ? 'gen' : 'edit', falSize: 'custom', falCustomW: 1001, falCustomH: 769,
      falQuality: 'high', falN: 3, falFormat: 'webp', falSync: true,
      nbAspect: '16:9', nbResolution: '4K', nbSafety: '1', nbImgMode: alternate ? 'image_url' : 'base64',
      nbWebSearch: alternate, nbSysPrompt: alternate ? 'Historical system prompt' : '', nbSeed: alternate ? 77 : 0 };
    const before = parameters(data), flags = { modelDef, apiModel, isFal: true, falDef, falKind: falDef.paramKind };
    const context = render(data, [], [], falDef.maxRefs, { ...flags, ...before }).capture();
    const prepared = readHistoryFalImageInput({ ...data, providerParams: {}, historyResolvedInput: context });
    const after = parameters(prepared.settings);
    const originalRequest = request({ ...flags, ...before, d: data, finalPrompt: context.prompt, allRefs: context.referenceImages, providerParams: {} });
    const restoredRequest = request({ ...flags, ...after, d: prepared.settings, finalPrompt: prepared.prompt,
      allRefs: prepared.media.map(item => item.url), providerParams: {} });
    const { images: originalImages, ...originalFields } = originalRequest, { images: restoredImages, ...restoredFields } = restoredRequest;
    assert.deepEqual(restoredFields, originalFields);
    assert.deepEqual(restoredImages, gpt && alternate ? [] : originalImages);
    const original = await payload({ ...originalRequest, ...io }), restored = await payload({ ...restoredRequest, ...io });
    assert.deepEqual(restored, original, 'effective backend payload and endpoint, not just frontend settings');
    const scope = { projectId: 'p', canvasId: 'c' };
    const assets = ['a', 'b'].map((label, index) => ({ id: `asset-${label}`, projectId: 'p', entityUid: `a1000000-0000-4000-8000-00000000000${index}`,
      contentHash: String(index + 1).repeat(64), kind: 'image', availability: 'available' }));
    const group: any = { id: 'fal-group', nodeId: 'deleted-fal', nodeEntityUid: 'original-fal', nodeType: 'image', snapshotAvailable: true };
    const archive: any = { status: 'available', digest: 'verified-fal', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
      snapshot: { node: { id: group.nodeId, type: 'image', data: { ...data, historyResolvedInput: context } }, upstreamNodes: [], incomingEdges: [] },
      references: { status: 'captured', entries: context.referenceImages.map((url: string, index: number) => {
        const asset = assets[url.endsWith('/a.png') ? 0 : 1];
        return { status: 'bound', kind: 'image', assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash,
          path: ['node', 'data', 'historyResolvedInput', 'referenceImages', index] };
      }) } };
    let gets = 0;
    const draft = await prepareHistoryInputDraft(archive, group, scope, { assertCurrent() {}, request: async () => ({ ok: true }),
      getAsset: async id => { gets++; return assets.find(asset => asset.id === id) as any; } });
    const patch = createHistoryInputDraftPatch(draft, { ...scope, id: 'confirmed-fal', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    const node: any = patch.operations[0].payload.node;
    const finalSettings = parameters(node.data);
    const finalContext = render(node.data, [], [], falDef.maxRefs, { ...flags, ...finalSettings }).capture();
    const finalRequest = request({ ...flags, ...finalSettings, d: node.data, finalPrompt: finalContext.prompt,
      allRefs: finalContext.referenceImages, providerParams: {} });
    const final = await payload({ ...finalRequest, ...io });
    const { image_urls: _oldUrls, ...oldPayload } = original.payload, { image_urls: finalUrls, ...finalPayload } = final.payload;
    assert.deepEqual(finalPayload, oldPayload); assert.equal(final.endpoint, original.endpoint);
    assert.equal(finalContext.prompt, context.prompt);
    assert.equal(gets, gpt && alternate ? 0 : 2);
    if (gpt && alternate) { assert.deepEqual(finalRequest.images, []); assert.equal(finalUrls, undefined); }
    else {
      assert.equal(finalRequest.images.length, 3); assert.equal(new Set(finalRequest.images).size, 3);
      assert.deepEqual(finalUrls, finalRequest.images.map((url: string) => `${gpt || alternate ? 'uploaded' : 'base64'}:${url}`));
      for (const [index, url] of finalRequest.images.entries()) {
        const address = new URL(url, 'http://localhost'), asset = assets[index === 1 ? 1 : 0];
        assert.equal(address.pathname, `/api/project-assets/${asset.id}/media`);
        assert.equal(address.searchParams.get('projectId'), scope.projectId);
        assert.equal(address.searchParams.get('entityUid'), asset.entityUid);
        assert.equal(address.searchParams.get('contentHash'), asset.contentHash);
        assert.equal(address.searchParams.get('referenceSlot'), String(index));
      }
    }
    if (gpt) {
      assert.deepEqual(restored.payload.image_size, { width: 1008, height: 768 });
      assert.equal(prepared.settings.falCustomW, 1001); assert.equal(restored.payload.sync_mode, true);
      assert.equal(Object.hasOwn(restored.payload, 'image_urls'), !alternate);
    } else {
      assert.equal(Object.hasOwn(restored.payload, 'sync_mode'), false, 'Banana does not use captured falSync');
      assert.equal(Object.hasOwn(restored.payload, 'seed'), alternate);
      assert.equal(Object.hasOwn(restored.payload, 'enable_web_search'), alternate);
      assert.equal(restored.payload.image_urls.length, 3); assert.equal(restored.payload.image_urls[0], restored.payload.image_urls[2]);
    }
  }
});

test('Budget Image G history preparation and final fixed-asset draft round-trip actual capture and submitSeedreamNz arguments', async () => {
  const parameterStart = source.indexOf('const zhenzhenImageG25AllowedSizes =');
  const parameterEnd = source.indexOf('// FAL 参数', parameterStart);
  assert.ok(parameterStart > 0 && parameterEnd > parameterStart);
  const returnKeys = ['zhenzhenImageG25Size', 'zhenzhenImageG25Resolution', 'zhenzhenImageG25Count', 'zhenzhenImageG25NsfwCheck',
    'zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight', 'zhenzhenImageG25CustomSize', 'zhenzhenImageG25Quality',
    'zhenzhenImageG25OutputFormat', 'zhenzhenImageG25OutputCompression', 'zhenzhenImageG25Background', 'zhenzhenImageG25Moderation'];
  const parameterCode = ts.transpileModule(`${source.slice(parameterStart, parameterEnd)}\nreturn { ${returnKeys.join(',')} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const parameters = new Function('scope', `with(scope) { ${parameterCode} }`);
  const argumentsFound: string[] = [];
  const findSubmit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'submitSeedreamNz') argumentsFound.push(node.arguments[0].getText(tree));
    ts.forEachChild(node, findSubmit);
  };
  findSubmit(tree); assert.equal(argumentsFound.length, 1);
  const requestCode = ts.transpileModule(`return (${argumentsFound[0]});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const request = new Function('scope', `with(scope) { ${requestCode} }`);
  for (const apiModel of models.ZHENZHEN_IMAGE_G25_MODELS) for (const custom of [false, true]) {
    const lowprice = apiModel === models.ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL;
    const flags = { isZhenzhenBudgetPlatformSelected: true, isZhenzhenBudgetImageSelected: true, isZhenzhenImageG25: true,
      isZhenzhenImageG25Lowprice: lowprice, isZhenzhenImageG25Official: !lowprice, isZhenzhenGrokImageV2: false,
      isZhenzhenGrokImageV2Edit: false, isZhenzhenNb: false, isVosr2ImageTab: false, isSeedreamLayerTab: false,
      isWanImageTab: false, isQwenImageTab: false, isQwenImage21Tab: false, isZhenzhenImageG2: false };
    const data = { prompt: 'Original @image2', referenceImages: ['/files/input/b.png', '/files/input/a.png', '/files/input/b.png'],
      zhenzhenImageG25Size: lowprice ? '16:9' : custom ? 'custom' : 'preserve_reference',
      zhenzhenImageG25Resolution: '4k', zhenzhenImageG25Count: lowprice ? 1 : 4,
      zhenzhenImageG25NsfwCheck: false, zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024,
      zhenzhenImageG25Quality: 'max', zhenzhenImageG25OutputFormat: custom ? 'webp' : 'png', zhenzhenImageG25OutputCompression: 0,
      zhenzhenImageG25Background: 'transparent', zhenzhenImageG25Moderation: 'low' };
    const before = parameters({ ...models, ...flags, d: data });
    const context = render(data, [], [], lowprice ? 15 : 16, { ...flags, ...before, apiModel }).capture();
    const prepared = readHistoryBudgetImageInput({ ...data, historyResolvedInput: context });
    const after = parameters({ ...models, ...flags, d: prepared.settings });
    const original = request({ ...flags, ...before, apiModel, finalPrompt: context.prompt, providerRefs: context.referenceImages });
    const restored = request({ ...flags, ...after, apiModel, finalPrompt: prepared.prompt, providerRefs: prepared.media.map(item => item.url) });
    assert.deepEqual(restored, original);
    assert.equal(Object.hasOwn(restored, 'providerParams'), false, 'this branch does not forward generic overrides');
    assert.equal(restored.n, lowprice ? 1 : 4);
    if (lowprice) { assert.equal(restored.nsfw_check, false); assert.equal(restored.quality, undefined); }
    else if (custom) { assert.equal(restored.custom_size, '1536x1024'); assert.equal(restored.resolution, undefined); assert.equal(restored.output_compression, 0); }
    else { assert.equal(restored.size, 'preserve_reference'); assert.equal(restored.output_compression, undefined); }
    const scope = { projectId: 'p', canvasId: 'c' };
    const assets = ['b', 'a'].map((label, i) => ({ id: `asset-${label}`, projectId: 'p', entityUid: `a1000000-0000-4000-8000-00000000000${i}`,
      contentHash: String(i + 1).repeat(64), kind: 'image', availability: 'available' }));
    const group: any = { id: 'group', nodeId: 'deleted-source', nodeEntityUid: 'original-source', nodeType: 'image', snapshotAvailable: true };
    const archive: any = { status: 'available', digest: 'verified', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
      snapshot: { node: { id: group.nodeId, type: 'image', data: { ...data, historyResolvedInput: context } }, upstreamNodes: [], incomingEdges: [] },
      references: { status: 'captured', entries: context.referenceImages.map((url: string, index: number) => {
        const asset = assets[url.endsWith('/b.png') ? 0 : 1];
        return { status: 'bound', kind: 'image', assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash,
          path: ['node', 'data', 'historyResolvedInput', 'referenceImages', index] };
      }) } };
    const draft = await prepareHistoryInputDraft(archive, group, scope, { assertCurrent() {},
      getAsset: async id => assets.find(asset => asset.id === id) as any, request: async () => ({ ok: true }) });
    const patch = createHistoryInputDraftPatch(draft, { ...scope, id: 'confirmed', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    const node: any = patch.operations[0].payload.node;
    const finalSettings = parameters({ ...models, ...flags, d: node.data });
    const finalContext = render(node.data, [], [], lowprice ? 15 : 16, { ...flags, ...finalSettings, apiModel }).capture();
    const finalRequest = request({ ...flags, ...finalSettings, apiModel, finalPrompt: finalContext.prompt, providerRefs: finalContext.referenceImages });
    const { images: _originalImages, ...originalFields } = original, { images: finalImages, ...finalFields } = finalRequest;
    assert.deepEqual(finalFields, originalFields, 'final node data does not change the compiled prompt or effective parameters');
    assert.equal(finalImages.length, 3); assert.equal(new Set(finalImages).size, 3);
    for (const [index, url] of finalImages.entries()) {
      const address = new URL(url, 'http://localhost'), asset = assets[index === 1 ? 1 : 0];
      assert.equal(address.pathname, `/api/project-assets/${asset.id}/media`);
      assert.equal(address.searchParams.get('entityUid'), asset.entityUid);
      assert.equal(address.searchParams.get('contentHash'), asset.contentHash);
      assert.equal(address.searchParams.get('referenceSlot'), String(index));
    }
    assert.equal(finalContext.prompt, context.prompt);
  }
});

test('image context preserves equal-URL slots with distinct material IDs and truncates zero/one/fourteen refs exactly', () => {
  const same = '/files/input/shared.png';
  const images = [material('up-same', same), ...Array.from({ length: 15 }, (_, i) => material(`up-${i}`, `/files/input/${i}.png`))];
  const d = { referenceImages: [same], materialOrder: ['up-same', `local::image:${same}`] };
  assert.deepEqual(render(d, images, [], 0).capture().referenceImages, []);
  assert.deepEqual(render(d, images, [], 1).capture().referenceImages, [same]);
  assert.deepEqual(render(d, images, [], 14).capture().referenceImages,
    [same, same, ...Array.from({ length: 12 }, (_, i) => `/files/input/${i}.png`)]);
});

test('image context resolves actual mention numbering after ordering and uses ordered upstream text first', () => {
  const a = '/files/input/a.png', b = '/files/input/b.png';
  const d = { prompt: 'Use @image1', referenceImages: [a], materialOrder: ['up-b', 'second-text', 'first-text'],
    promptMentions: [{ id: 'mention', kind: 'image', materialKey: `image:${a}`, url: a, token: '@image1', start: 4, end: 11 }] };
  assert.equal(render(d, [material('up-b', b)]).capture().prompt, 'Use @image2');
  const texts = [material('first-text', 'First', 'text'), material('second-text', 'Second', 'text'), material('empty', '', 'text')];
  assert.equal(render(d, [material('up-b', b)], texts).capture().prompt, 'Second\nFirst');
  assert.equal(render({ ...d, excludedMaterialIds: ['first-text', 'second-text'] }, [], texts).capture().prompt, 'Use @image1');
});

test('image context runs actual adjustment compilation, reference gating and Comfy prompt-field behavior', () => {
  const item = IMAGE_PROMPT_ADJUSTMENTS.find(value => value.applicability === 'reference')!;
  assert.ok(item);
  const selection = createImagePromptAdjustmentSelection(item);
  const d = { prompt: 'A subject', referenceImages: ['/files/input/a.png'], imagePromptAdjustments: [selection] };
  const normal = render(d).capture();
  assert.equal(normal.prompt, `A subject\nImage adjustment requirements: ${selection.promptEn}`);
  assert.equal(render(d, [], [], 0).capture().prompt, 'A subject', 'reference-only adjustment is inactive without accepted references');
  const comfy = { isComfyExternal: true, providerParams: { positive: 'Comfy subject' } };
  assert.equal(render(d, [], [], 14, comfy).capture().prompt, 'Comfy subject');
  assert.equal(render(d, [], [], 14, { ...comfy, comfyHasPromptField: true }).capture().prompt,
    `Comfy subject\nImage adjustment requirements: ${selection.promptEn}`);
});

test('standard recovery draft round-trips the actual image pipeline with fixed duplicate slots and no doubled adjustments', async () => {
  const selection = createImagePromptAdjustmentSelection(IMAGE_PROMPT_ADJUSTMENTS.find(item => item.applicability === 'reference')!);
  const a = '/files/input/a.png', b = '/files/input/b.png';
  const raw = { prompt: 'Old local text', referenceImages: [a], materialOrder: ['up-b'], imagePromptAdjustments: [selection] };
  const branch = { apiModel: 'gpt-image-2.5-flare', isStandardGptImage2: true, isGptImage25: true,
    gptImageQuality: 'high', gptImageModeration: 'low', gptImage25Size: '1536x1024',
    gptImage25CustomWidth: 1024, gptImage25CustomHeight: 1024, gptImage25Count: 2, gptImage25Background: 'opaque' };
  const captured = render(raw, [material('up-b', b), material('up-b-copy', b)], [material('text', 'Use @image2 and @image3; keep @img2', 'text')], 14, branch).capture();
  const input = readHistoryStandardImageInput({ ...raw, historyResolvedInput: captured });
  assert.deepEqual(input.media.map(item => item.url), [b, a, b]);
  const assets = [a, b].map((url, index) => ({ id: `image-${index}`, entityUid: `a1000000-0000-4000-8000-00000000000${index}`,
    projectId: 'p', contentHash: String(index + 1).repeat(64), kind: 'image', availability: 'available', sourceUrl: url }));
  const scope = { projectId: 'p', canvasId: 'c' };
  const group: any = { id: 'group', nodeId: 'image', nodeEntityUid: 'original', nodeType: 'image', snapshotAvailable: true, sourceNodeExists: false };
  const archive: any = { status: 'available', digest: 'verified', binding: { ...scope, nodeId: 'image', nodeEntityUid: 'original' },
    snapshot: { node: { id: 'image', type: 'image', data: { ...raw, historyResolvedInput: captured } }, upstreamNodes: [], incomingEdges: [] },
    references: { status: 'captured', entries: captured.referenceImages.map((url: string, index: number) => {
      const asset = assets.find(item => item.sourceUrl === url)!;
      return { status: 'bound', path: ['node', 'data', 'historyResolvedInput', 'referenceImages', index],
        assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash, kind: 'image' };
    }) } };
  const draft = await prepareHistoryInputDraft(archive, group, scope, { assertCurrent() {},
    getAsset: async (id: string): Promise<any> => assets.find(item => item.id === id), request: async () => ({ ok: true }) });
  assert.equal(Object.hasOwn(draft.data, 'imagePromptAdjustments'), false);
  const resolved = render(draft.data).resolveGenerationInput();
  assert.equal(resolved.finalPrompt, captured.prompt);
  assert.deepEqual(resolved.upstreamImages, draft.references.map(item => item.url));
  assert.equal(resolved.upstreamImages.length, 3); assert.equal(new Set(resolved.upstreamImages).size, 3);
  assert.equal(resolved.finalPrompt.split('Image adjustment requirements:').length, 2);
  // This verifies the pure input pipeline only. No asset bytes, scope, node.add,
  // React window, Provider or database persistence is exercised here.
});

test('image capture fixes frontend basic selections including independent Seedream and external provider choices', () => {
  const builtin = render({ prompt: 'raw', model: 'stale-raw-model', aspectRatio: 'invalid' }, [], [], 14, {
    modelDef: { id: 'seedream-v5' }, apiModel: 'resolved-variant', effectiveAspectRatio: '16:9', effectiveSizeLevel: '2K',
    isSeedream: true, isSeedreamNz: true, seedreamApiSource: 'seedance-nz',
    seedreamNzModelFamily: 'overseas', seedreamNzResolution: '2k', seedreamNzCustomSize: '2048x2048', seedreamOutputFormat: 'png',
  }).capture();
  assert.deepEqual(historyImageBasicSettings({ historyResolvedInput: builtin }), {
    model: 'seedream-v5', apiModel: 'resolved-variant', aspectRatio: '16:9', sizeLevel: '2K',
    imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', seedreamApiSource: 'seedance-nz',
    seedreamNzModelFamily: 'overseas', seedreamNzResolution: '2k', seedreamNzCustomSize: '2048x2048', seedreamOutputFormat: 'png',
  });
  const external = render({ prompt: 'raw' }, [], [], 14, { isExternalSelected: true,
    aspectRatio: '4:3', sizeLevel: '4K', externalProviderModel: 'selected-external-model',
    providerSelection: { providerSource: 'comfyui', providerId: 'configured-provider' },
  }).capture();
  const settings = historyImageBasicSettings({ historyResolvedInput: external })!;
  assert.equal(settings.aspectRatio, '4:3'); assert.equal(settings.sizeLevel, '4K');
  assert.equal(settings.providerSource, 'comfyui'); assert.equal(settings.providerId, 'configured-provider');
  assert.equal(settings.providerModel, 'selected-external-model');
  const budget = render({}, [], [], 14, { isZhenzhenBudgetPlatformSelected: true }).capture();
  assert.equal(historyImageBasicSettings({ historyResolvedInput: budget })?.imageBuiltinSource, 'seedance-nz');
});

test('captured image render stays paired across initialization and enters an immutable credential-free archive', async () => {
  const require = createRequire(import.meta.url);
  const { archiveInput, readGenerationHistoryInput, resolvedHistoryPrompt } = require('../backend/src/services/generationHistoryInputs');
  const d = { prompt: 'Original', referenceImages: ['/files/input/a.png'], apiKey: 'private-fixture-value' };
  let current = render(d);
  const execution = captureHistoryExecution(current.resolveGenerationInput, current.capture)!;
  const node = { id: 'image', type: 'image', position: { x: 0, y: 0 }, data: d };
  const snapshot = captureGenerationHistoryInput([node], [], 'image', execution.resolvedInput);
  assert.equal(snapshot.complete, true);
  const archive = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'r' },
    { nodeId: 'image', nodeEntityUid: 'n', entityUid: 'nr', historyInputSnapshot: snapshot }, { entityUid: 'a' });
  assert.equal(archive.status, 'available');
  current = render({ prompt: 'Edited', referenceImages: ['/files/input/b.png'] });
  await Promise.resolve();
  assert.equal(execution.run().finalPrompt, 'Original');
  assert.deepEqual(execution.run().upstreamImages, ['/files/input/a.png']);
  assert.equal(current.capture().prompt, 'Edited');
  assert.equal(resolvedHistoryPrompt(archive.snapshot), 'Original');
  assert.equal(historyImageBasicSettings(archive.snapshot.node.data)?.model, 'gpt-image-2');
  const currentTarget = { ...node, entityUid: 'n', data: { prompt: 'Edited', model: 'later-model', sizeLevel: '4K' } };
  const draft = prepareHistorySettingsDraft(archive, {
    id: 'group', nodeId: 'image', nodeEntityUid: 'n', nodeType: 'image', snapshotAvailable: true,
  } as any, currentTarget, { projectId: 'p', canvasId: 'c' });
  assert.equal(draft.dataPatch.model, 'gpt-image-2');
  assert.equal(draft.dataPatch.sizeLevel, '1K');
  assert.equal(draft.dataPatch.prompt, 'Original');
  assert.equal(currentTarget.data.prompt, 'Edited', 'review preparation is read-only');
  assert.equal(JSON.stringify(archive).includes('private-fixture-value'), false);
  assert.equal(archive.snapshot.credentialsOmitted, true);
  const event = { project_id: 'p', canvas_id: 'c', run_entity_uid: 'r', node_run_entity_uid: 'nr', attempt_entity_uid: 'a',
    source_node_id: 'image', source_node_entity_uid: 'n', metadata_json: JSON.stringify({ generationInput: archive }) };
  assert.deepEqual(readGenerationHistoryInput({}, event), archive);
  execution.resolvedInput.prompt = 'changed capture';
  assert.equal(resolvedHistoryPrompt(archive.snapshot), 'Original');
});
