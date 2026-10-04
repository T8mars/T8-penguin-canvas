import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { orderMaterials } from '../src/components/nodes/useOrderedMaterials.ts';
import { filterExcludedMaterials, normalizeExcludedMaterialIds } from '../src/utils/materialExclusion.ts';
import { resolveMediaMentions } from '../src/components/nodes/mediaMentions.ts';
import { captureGenerationHistoryInput } from '../src/utils/generationHistoryCapture.ts';
import { captureHistoryExecution } from '../src/utils/historyResolvedSeedanceInput.ts';
import { supportsHistoryInputDraft } from '../src/utils/generationHistorySettings.ts';
import { historyVideoBasicSettings } from '../src/utils/historyVideoBasicSettings.ts';
import historyInputContract from '../backend/src/shared/generationHistoryInputContract.json';
import { isGrokVideo15NewModel, grokVideo15NewSizeFromRatio } from '../src/providers/models.ts';
import { VIDEO_MODELS, VIDEO_FAL_REGISTRY, ANIMATE_MOTION_TRANSFER_MODEL } from '../src/providers/models.ts';
import { readHistoryFalVideoInput } from '../src/utils/historyFalVideoInput.ts';
import { prepareHistoryInputDraft, createHistoryInputDraftPatch } from '../src/utils/generationHistoryInputDraft.ts';

// Run the actual VideoNode material declarations and capture callback, without
// mounting React, opening a database, or submitting any Provider requests.
const source = readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('VideoNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['localPrompt', 'promptMentions', 'excludedMaterialIds', 'materialOrder',
  'visibleUpstreamTexts', 'visibleUpstreamImages', 'visibleUpstreamVideos', 'visibleUpstreamAudios',
  'orderedTexts', 'orderedImages', 'orderedVideos', 'orderedAudios',
  'localRefImages', 'localRefVideos', 'localRefAudios', 'localRefMaterials', 'mentionMaterials', 'collectUpstream', 'minimaxH3VideoStartSeconds',
  'isGrok15New', 'grok15NewSize', 'isAnimate']);
const declarations: string[] = [];
const submitArguments: Record<string, string[]> = {};
let capture = ''; let generationPrelude = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ['submitSeedance', 'submitKling', 'submitVidu', 'submitFlux3', 'submitWan', 'submitHailuo'].includes(node.expression.getText(tree))) {
    (submitArguments[node.expression.getText(tree)] ||= []).push(node.arguments[0].getText(tree));
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (names.has(node.name.text)) declarations.push(`const ${node.getText(tree)};`);
    if (node.name.text === 'handleGenerate' && node.initializer && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body)) {
      // Exact synchronous common-input expressions used by the real submit callback.
      const statements = node.initializer.body.statements;
      generationPrelude = statements.slice(2, 5).map(statement => statement.getText(tree)).join('\n');
      assert.match(generationPrelude, /const finalPrompt/);
    }
  }
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useRunTrigger') {
    const options = node.arguments[3];
    if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties) {
      if (ts.isPropertyAssignment(property) && property.name.getText(tree) === 'captureHistoryInput') capture = property.initializer.getText(tree);
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree); assert.equal(declarations.length, names.size); assert.ok(capture); assert.ok(generationPrelude);
const payloadStart = source.indexOf('const payload: VideoSubmitRequest =');
const payloadEnd = source.indexOf('\n      logBus.info(', payloadStart);
assert.ok(payloadStart > 0 && payloadEnd > payloadStart);
const payloadCode = ts.transpileModule(`${source.slice(payloadStart, payloadEnd)}\nreturn payload;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const actualStandardPayload = new Function('scope', `with(scope) { ${payloadCode} }`);
const falStart = source.indexOf('const falReq: VideoFalSubmitRequest =');
const falEnd = source.indexOf('const falInfo =', falStart);
const splitDeclaration = tree.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'splitGrokFalRefUrls'));
assert.ok(falStart > 0 && falEnd > falStart && splitDeclaration);
const falCode = ts.transpileModule(`${splitDeclaration.getText(tree)}\n${source.slice(falStart, falEnd)}\nreturn falReq;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const actualFalPayload = new Function('scope', `with(scope) { ${falCode} }`);
const actualSubmitArguments = (name: string, index: number, scope: Record<string, unknown>) => {
  const argument = submitArguments[name]?.[index]; assert.ok(argument, `${name}:${index} exists in VideoNode`);
  const compiled = ts.transpileModule(`return (${argument});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('scope', `with(scope) { ${compiled} }`)(scope);
};
const code = ts.transpileModule(`${declarations.join('\n')}\nreturn { capture: ${capture}, inputUsedByGenerate: () => {
  ${generationPrelude}\nreturn { prompt: finalPrompt, localRefImages: imageUrls, localRefVideos: videoUrls, localRefAudios: audioUrls };
} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const factory = new Function('scope', `with(scope) { ${code} }`);
const material = (id: string, url: string, kind: string) => ({ id, url, kind, sourceNodeId: 'up', origin: 'upstream' });
function render(d: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return factory({ id: 'video', d, upstream: { texts: [], images: [], videos: [], audios: [] },
    useMemo: (read: () => unknown) => read(), useOrderedMaterials: orderMaterials,
    filterExcludedMaterials, normalizeExcludedMaterialIds, resolveMediaMentions, isGrokVideo15NewModel, grokVideo15NewSizeFromRatio, ANIMATE_MOTION_TRANSFER_MODEL,
    maxMentionRefs: 2, maxMentionVideos: 1, maxMentionAudios: 1, historyInputContract,
    modelDef: { id: 'grok', kind: 'grok' }, apiModel: 'grok-video-3', videoBuiltinSource: 'zhenzhen', isFal: false, falReg: null, isVeoOmni: false,
    isApimartBudgetVideo: false, isApimartOmniLowprice: false, isSeedance25: false, isKling: false, isVidu: false,
    isFlux3: false, isWan: false, isHailuo: false, isMinimaxH3V2: false,
    ratio: '16:9', duration: 6, resolution: '720p', seed: 0, isExternalSelected: false,
    ...extra,
  });
}
test('video common context matches actual generator ordering, exclusions, URL dedupe and upstream prompt priority', () => {
  const d = { prompt: 'local text', localRefImages: ['/files/input/b.png', '/files/input/c.png'],
    localRefVideos: ['/files/input/a.mp4'], localRefAudios: ['/files/input/a.wav'],
    materialOrder: ['b', 'a', 'text2', 'text1'], excludedMaterialIds: ['excluded'] };
  const upstream = { texts: [material('text1', 'First', 'text'), material('text2', 'Second', 'text')],
    images: [material('a', '/files/input/a.png', 'image'), material('b', '/files/input/b.png', 'image'), material('excluded', '/files/input/excluded.png', 'image')],
    videos: [material('v', '/files/input/a.mp4', 'video')], audios: [] };
  const before = structuredClone({ d, upstream }), current = render(d, { upstream });
  const context = current.capture();
  assert.deepEqual(context.localRefImages, ['/files/input/b.png', '/files/input/a.png', '/files/input/c.png']);
  assert.deepEqual(context.localRefVideos, ['/files/input/a.mp4']); assert.deepEqual(context.localRefAudios, ['/files/input/a.wav']);
  assert.equal(context.prompt, 'Second\nFirst');
  for (const [key, value] of Object.entries(current.inputUsedByGenerate())) assert.deepEqual(context[key], value);
  assert.deepEqual({ d, upstream }, before);
  assert.equal(context.localRefImages.length, 3, 'common capture is before branch cap, not falsely labeled sent references');
});
test('video capture preserves actual mention resolution and same-render execution across later renders', () => {
  const a = '/files/input/a.png', b = '/files/input/b.png';
  const d = { prompt: 'Use @image1', localRefImages: [a], promptMentions: [
    { id: 'mention', kind: 'image', materialKey: `image:${a}`, url: a, token: '@image1', start: 4, end: 11 }],
  };
  const current = render(d, { upstream: { texts: [], images: [material('b', b, 'image')], videos: [], audios: [] } });
  const execution = captureHistoryExecution(current.inputUsedByGenerate, current.capture)!;
  render({ prompt: 'new value', localRefImages: [b] });
  assert.equal(execution.resolvedInput.prompt, 'Use @image2');
  assert.equal(execution.run().prompt, execution.resolvedInput.prompt);
  assert.deepEqual(execution.resolvedInput.localRefImages, [b, a]);
});
test('video effective common settings preserve zero and resolved provider identity without keys or default inference', () => {
  const context = render({ taskId: 'old-task', apiKey: 'not-copied' }, { isExternalSelected: true,
    providerSelection: { providerSource: 'external', providerId: 'chosen' }, externalProviderModel: 'actual-model',
    ratio: 'auto', seed: 0 }).capture();
  assert.equal(context.basicSettings.providerModel, 'actual-model'); assert.equal(context.basicSettings.providerId, 'chosen');
  assert.equal(context.basicSettings.seed, 0); assert.equal(context.basicSettings.ratio, 'auto');
  for (const key of ['apiKey', 'taskId', 'providerParams']) assert.equal(Object.hasOwn(context, key), false);
  assert.equal(context.schema, historyInputContract.videoInputContextSchema);
  assert.equal(context.origin, 'frontend-common-context');
  assert.equal(supportsHistoryInputDraft('video'), true, 'node-level entry still requires the strict archived-input adapter');
});
test('video context survives real pure archival and stale derived input is replaced, with credentials omitted', () => {
  const d = { prompt: 'raw local', apiKey: 'private-value', historyResolvedInput: { prompt: 'stale' }, localRefImages: ['/files/input/a.png'] };
  const current = render(d);
  const snapshot = captureGenerationHistoryInput([{ id: 'video', type: 'video', position: { x: 0, y: 0 }, data: d }], [], 'video', current.capture());
  assert.equal(snapshot.complete, true); if (!snapshot.complete) return;
  assert.equal(snapshot.credentialsOmitted, true); assert.equal(Object.hasOwn(snapshot.node.data, 'apiKey'), false);
  assert.deepEqual(snapshot.node.data.historyResolvedInput, current.capture());
  const { archiveInput } = createRequire(import.meta.url)('../backend/src/services/generationHistoryInputs.js');
  const archive = archiveInput({ projectId: 'p', canvasId: 'c', entityUid: 'run' },
    { nodeId: 'video', nodeEntityUid: 'n', entityUid: 'nr', historyInputSnapshot: snapshot }, { entityUid: 'attempt' });
  assert.equal(archive.status, 'available'); assert.deepEqual(archive.snapshot.node.data.historyResolvedInput, current.capture());
});

test('standard Sora/Veo/Seedance capture booleans match actual payload expressions; inactive branches do not record them', () => {
  for (const kind of ['sora', 'veo', 'seedance']) {
    const options = { modelDef: { id: kind, kind }, soraPrivate: false, enhancePrompt: false, enableUpsample: true };
    const context = render({}, options).capture();
    const payload = actualStandardPayload({ ...options, apiModel: kind, finalPrompt: 'compiled', providerParams: {}, images: undefined,
      isGrok15New: false, isVeoOmni: false, ratio: '16:9', duration: 6, resolution: '720p', seed: 0 });
    if (kind === 'sora') {
      assert.equal(context.basicSettings.soraPrivate, payload.private); assert.equal(context.basicSettings.soraPrivate, false);
      assert.equal(Object.hasOwn(context.basicSettings, 'enhancePrompt'), false);
    } else {
      assert.equal(context.basicSettings.enhancePrompt, payload.enhance_prompt);
      assert.equal(context.basicSettings.enableUpsample, payload.enable_upsample);
      assert.equal(Object.hasOwn(context.basicSettings, 'soraPrivate'), false);
    }
    for (const inactive of [{ isFal: true }, { videoBuiltinSource: 'seedance-nz' },
      { isExternalSelected: true, providerSelection: { providerSource: 'external', providerId: 'p' }, externalProviderModel: 'm' }]) {
      const settings = render({}, { ...options, ...inactive }).capture().basicSettings;
      for (const key of ['soraPrivate', 'enhancePrompt', 'enableUpsample']) assert.equal(Object.hasOwn(settings, key), false);
    }
  }
  const omni = render({}, { modelDef: { id: 'veo', kind: 'veo' }, isVeoOmni: true }).capture().basicSettings;
  assert.equal(Object.hasOwn(omni, 'enhancePrompt'), false); assert.equal(Object.hasOwn(omni, 'enableUpsample'), false);
});

test('Grok New captures actual normalized size independently of ratio and round-trips the request without defaults', () => {
  for (const apiModel of ['grok-1.5-video-6s', 'grok-1.5-video-10s', 'grok-1.5-video-15s']) {
    for (const [rawSize, ratio, expected] of [
      ['720x1280', '16:9', '720x1280'], ['1280x720', '9:16', '1280x720'],
      [undefined, '9:16', '720x1280'], ['invalid', '1:1', '1280x720'],
    ]) {
      const d = { prompt: 'Grok image motion', size: rawSize, localRefImages: ['/files/input/a.png'] };
      const options = { apiModel, ratio, modelDef: { id: 'grok-video-3', kind: 'grok' } };
      const context = render(d, options).capture();
      const settings = historyVideoBasicSettings({ historyResolvedInput: context })!;
      assert.equal(settings.size, expected);
      // Re-render with an intentionally different current size. Only the
      // archived explicit value may determine the restored request size.
      const restored = render({ ...d, size: 'wrong-current', ...settings }, options).capture();
      assert.equal(restored.basicSettings.size, expected);
      const payload = actualStandardPayload({ ...options, isGrok15New: true,
        grok15NewSize: restored.basicSettings.size, finalPrompt: context.prompt, providerParams: {}, images: d.localRefImages });
      assert.equal(payload.size, expected);
      for (const key of ['ratio', 'aspect_ratio', 'duration', 'resolution', 'seed']) assert.equal(Object.hasOwn(payload, key), false);
      const snapshot = captureGenerationHistoryInput([{ id: 'video', type: 'video', position: { x: 0, y: 0 }, data: d }], [], 'video', context);
      assert.equal(snapshot.complete, true);
      if (snapshot.complete) assert.deepEqual(snapshot.node.data.historyResolvedInput, context);
    }
  }
  for (const options of [{ apiModel: 'grok-video-3' }, { apiModel: 'grok-imagine-video-1.5', isFal: true },
    { apiModel: 'grok-1.5-video-6s', isExternalSelected: true,
      providerSelection: { providerSource: 'external', providerId: 'p' }, externalProviderModel: 'm' }]) {
    assert.equal(Object.hasOwn(render({ size: '720x1280' }, options).capture().basicSettings, 'size'), false);
  }
});

test('Grok full draft with fixed assets and mentions reproduces actual request semantics after independent node creation', async () => {
  const refStart = source.indexOf('const refs = imageUrls.slice(0, (isVeoOmni || isGrok15New)');
  assert.ok(refStart > 0 && refStart < payloadStart);
  const requestCode = ts.transpileModule(`${source.slice(refStart, payloadEnd)}\nreturn payload;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const request = new Function('scope', `return (async () => { with(scope) { ${requestCode} } })();`);
  const modelDef = VIDEO_MODELS.find(model => model.id === 'grok-video-3')!;
  const upstream = { texts: [material('text', 'Use @image1 and @image2; retain @img1 @image01 @image8 @video1 literally.', 'text')],
    images: Array.from({ length: 8 }, (_, i) => material(`i${i}`, `/files/input/${i}.png`, 'image')),
    videos: [material('v', '/files/input/unused.mp4', 'video')], audios: [] };
  const d = { prompt: 'old local', size: '720x1280', materialOrder: ['i2', 'i0'],
    localRefImages: ['/files/input/0.png', '/files/input/last.png'], localRefAudios: ['/files/input/unused.wav'] };
  for (const apiModel of ['grok-video-3', 'grok-1.5-video-6s', 'grok-1.5-video-10s', 'grok-1.5-video-15s']) {
    const maxMentionRefs = isGrokVideo15NewModel(apiModel) ? 1 : 7;
    const options = { modelDef, apiModel, ratio: '9:16', duration: 10, seed: 42, resolution: '720P', upstream, maxMentionRefs };
    const captured = render(d, options).capture();
    const scope = { projectId: 'p', canvasId: 'c' };
    const group: any = { id: 'history', nodeId: 'old-video', nodeEntityUid: 'original-source', nodeType: 'video', snapshotAvailable: true, sourceNodeExists: false };
    // Two distinct historical URLs point to the same bytes and fixed identity.
    // They were separate sent slots and must not collapse after freezing URLs.
    const assets = captured.localRefImages.map((_url: string, index: number) => {
      const canonical = index === 1 ? 0 : index;
      return { id: `asset-${canonical}`, projectId: 'p', entityUid: `a1000000-0000-4000-8000-00000000000${canonical}`,
        contentHash: String(canonical + 1).repeat(64), kind: 'image', availability: 'available' };
    });
    const archive: any = { status: 'available', digest: 'verified', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
      snapshot: { node: { id: group.nodeId, type: 'video', data: { ...d, historyResolvedInput: captured } }, upstreamNodes: [], incomingEdges: [] },
      references: { status: 'captured', entries: assets.map((asset: any, index: number) => ({ status: 'bound', kind: 'image',
        path: ['node', 'data', 'historyResolvedInput', 'localRefImages', index], assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash })) } };
    const reads: string[] = [];
    const prepared = await prepareHistoryInputDraft(archive, group, scope, { assertCurrent() {},
      getAsset: async id => assets.find((asset: any) => asset.id === id),
      request: async (url, init) => { assert.equal(init.method, 'HEAD'); reads.push(url); return { ok: true }; } });
    const patch = createHistoryInputDraftPatch(prepared, { ...scope, id: 'confirmed', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    const restoredNode: any = patch.operations[0].payload.node;
    assert.notEqual(restoredNode.id, group.nodeId); assert.equal(restoredNode.type, 'video');
    const originalScope = { ...options, ...captured.basicSettings, isGrok15New: isGrokVideo15NewModel(apiModel),
      isVeoOmni: false, grok15NewSize: captured.basicSettings.size, providerParams: {},
      imageUrls: captured.localRefImages, finalPrompt: captured.prompt };
    const originalRequest = await request(originalScope);
    // Re-enter the actual collect/mention/capture path using precisely the new
    // node.add data, not a helper's unbound old URLs or reconstructed mentions.
    const restored = render(restoredNode.data, { ...restoredNode.data, modelDef, apiModel, maxMentionRefs }).capture();
    const restoredRequest = await request({ ...originalScope, ...restored.basicSettings,
      grok15NewSize: restored.basicSettings.size, imageUrls: restored.localRefImages, finalPrompt: restored.prompt });
    const { images: originalImages, ...originalParameters } = originalRequest;
    const { images: restoredImages, ...restoredParameters } = restoredRequest;
    assert.deepEqual(restoredParameters, originalParameters, 'compiled prompt including literal tokens and all active parameters remains exact');
    const expectedAssets = originalImages.map((url: string) => assets[captured.localRefImages.indexOf(url)]);
    for (const [index, url] of restoredImages.entries()) {
      const address = new URL(url, 'http://localhost'), asset = expectedAssets[index];
      assert.equal(address.pathname, `/api/project-assets/${asset.id}/media`);
      assert.equal(address.searchParams.get('entityUid'), asset.entityUid);
      assert.equal(address.searchParams.get('contentHash'), asset.contentHash);
      assert.equal(address.searchParams.get('projectId'), scope.projectId);
      assert.equal(address.searchParams.get('referenceSlot'), String(index));
    }
    assert.equal(restoredImages.length, originalImages.length);
    assert.equal(new Set(restoredImages).size, originalImages.length, 'same-byte aliases remain distinct through the actual URL deduper');
    assert.equal(reads.length, isGrokVideo15NewModel(apiModel) ? 1 : 6, 'each fixed identity checked once, without losing its slots');
    assert.deepEqual(restoredNode.data.promptMentions.map((mention: any) => mention.token),
      isGrokVideo15NewModel(apiModel) ? ['@image1'] : ['@image1', '@image2']);
    assert.equal(originalRequest.images.length, isGrokVideo15NewModel(apiModel) ? 1 : 7);
    assert.equal(originalRequest.images[0], '/files/input/2.png');
    assert.deepEqual(restored.localRefVideos, []); assert.deepEqual(restored.localRefAudios, []);
  }
  assert.equal(supportsHistoryInputDraft('video'), true, 'entry support is not full canvas acceptance');
});

test('FAL full-input preparer matches real capture and branch-capped request construction for four registered models', () => {
  const start = source.indexOf('const falMaxRefs ='); assert.ok(start > 0 && start < falStart);
  const requestCode = ts.transpileModule(`${splitDeclaration!.getText(tree)}\n${source.slice(start, falEnd)}\nreturn falReq;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const submit = new Function('scope', `with(scope) { ${requestCode} }`);
  const variants = [
    { apiModel: 'veo3.1-fal', mainId: 'veo3.1', vfRatio: '9:16', vfDuration: '8s', vfResolution: '1080p', vfAudio: false, vfSafety: 0 },
    { apiModel: 'grok-video-fal', mainId: 'grok-video-3', gkfMode: 'reference_to_video', gkfRatio: 'auto', gkfDuration: 10, gkfResolution: '720p' },
    { apiModel: 'grok-imagine-video-1.5', mainId: 'grok-video-3', gkfMode: 'image_to_video', gkfDuration: 6, gkfResolution: '480p' },
    { apiModel: 'sora-2', mainId: 'sora-2', soraMode: 'auto', soraRatio: 'auto', soraDuration: 12, soraResolution: 'auto', soraDeleteVideo: false, soraBlockIp: true },
  ];
  for (const variant of variants) {
    const options = { ...variant, modelDef: VIDEO_MODELS.find(model => model.id === variant.mainId)!,
      falReg: VIDEO_FAL_REGISTRY[variant.apiModel], isFal: true, isGrokFalV15: variant.apiModel === 'grok-imagine-video-1.5' };
    const d = { prompt: 'Historical @image2', localRefImages: Array.from({ length: 9 }, (_, i) => `/files/input/ref-${i}.png`) };
    const context = render(d, options).capture();
    const prepared = readHistoryFalVideoInput({ ...d, historyResolvedInput: context });
    const requestScope = { ...options, finalPrompt: context.prompt, imageUrls: context.localRefImages,
      providerParams: {}, gkfReferenceUrls: '', soraCharacterIds: '' };
    const original = submit(requestScope), restored = submit({ ...requestScope, ...prepared.settings,
      apiModel: prepared.settings.model, finalPrompt: prepared.prompt, imageUrls: prepared.media.map(item => item.url) });
    assert.deepEqual(restored, original);
    assert.deepEqual(restored.images, prepared.media.map(item => item.url));
    assert.equal(prepared.settings.seed, 0);
    if (variant.apiModel === 'veo3.1-fal') { assert.equal(original.safety_tolerance, 0); assert.equal(prepared.requestedSafetyTolerance, 4); }
    if (variant.apiModel === 'grok-video-fal') { assert.equal(original.gkRatio, '16:9'); assert.equal(original.images.length, 7); }
    if (options.isGrokFalV15) { assert.equal(Object.hasOwn(original, 'gkRatio'), false); assert.equal(original.images.length, 1); }
    for (const field of ['providerParams', 'gkfReferenceUrls', 'soraCharacterIds', 'taskId']) assert.equal(Object.hasOwn(prepared.settings, field), false);
  }
});

test('FAL confirmed node data re-enters actual options, mentions and request construction with fixed ordered references', async () => {
  const start = source.indexOf('const falMaxRefs ='); assert.ok(start > 0 && start < falStart);
  const optionNames = new Set(['vfRatio', 'vfDuration', 'vfResolution', 'vfAudio', 'vfSafety',
    'gkfMode', 'gkfRatio', 'gkfDuration', 'gkfResolution', 'gkfReferenceUrls',
    'soraMode', 'soraRatio', 'soraDuration', 'soraResolution', 'soraDeleteVideo', 'soraBlockIp', 'soraCharacterIds', 'maxMentionRefs']);
  const optionDeclarations: string[] = [];
  function collectOptions(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && optionNames.has(node.name.text)) {
      optionDeclarations.push(`const ${node.getText(tree)};`);
    }
    ts.forEachChild(node, collectOptions);
  }
  collectOptions(tree); assert.equal(optionDeclarations.length, optionNames.size);
  const compile = (body: string) => new Function('scope', `with(scope) { ${ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText} }`);
  const readOptions = compile(`${optionDeclarations.join('\n')}\nreturn { ${[...optionNames].join(',')} };`);
  const request = compile(`${splitDeclaration!.getText(tree)}\n${source.slice(start, falEnd)}\nreturn falReq;`);
  const variants = [
    { model: 'veo3.1-fal', mainId: 'veo3.1', vfRatio: '9:16', vfDuration: '8s', vfResolution: '4k', vfAudio: false, vfSafety: 0 },
    { model: 'grok-video-fal', mainId: 'grok-video-3', gkfMode: 'reference_to_video', gkfRatio: 'auto', gkfDuration: 30, gkfResolution: '480p' },
    { model: 'grok-video-fal', mainId: 'grok-video-3', gkfMode: 'image_to_video', gkfRatio: '9:16', gkfDuration: 1, gkfResolution: '720p' },
    { model: 'grok-imagine-video-1.5', mainId: 'grok-video-3', gkfDuration: 10, gkfResolution: '480p' },
    { model: 'sora-2', mainId: 'sora-2', soraMode: 'auto', soraRatio: 'auto', soraDuration: 20, soraResolution: 'auto', soraDeleteVideo: false, soraBlockIp: true },
    { model: 'sora-2', mainId: 'sora-2', soraMode: 'text_to_video', soraRatio: 'auto', soraDuration: 4, soraResolution: 'auto', soraDeleteVideo: true, soraBlockIp: false },
  ];
  for (const variant of variants) {
    const options = { modelDef: VIDEO_MODELS.find(model => model.id === variant.mainId)!, apiModel: variant.model,
      falReg: VIDEO_FAL_REGISTRY[variant.model], isFal: true, isGrokFalV15: variant.model === 'grok-imagine-video-1.5',
      isUpscaler: false, isWan: false, isKling: false, isVidu: false, isSeedance25: false, isFlux3: false, isHailuo: false,
      isHappyHorse: false, isApimartOmni: false, isApimartOmniLowprice: false, isApimartGrok: false, isApimartV31Fast: false,
      isApimartV31Quality: false, isApimartV31Lite: false, isVeoOmni: false, isGrok15New: false, isJimengSeedanceSelected: false };
    const d = { ...variant, prompt: 'old local', materialOrder: ['i2', 'i0'], localRefImages: ['/files/input/0.png'] };
    const originalOptions = { ...options, ...readOptions({ ...options, d }) };
    const upstream = { texts: [material('text', 'Use @image1 @image2; retain @img1 @image01 @image9 @video1 literally.', 'text')],
      images: Array.from({ length: 8 }, (_, i) => material(`i${i}`, `/files/input/${i}.png`, 'image')), videos: [], audios: [] };
    const captured = render(d, { ...originalOptions, upstream }).capture();
    const scope = { projectId: 'p', canvasId: 'c' };
    const group: any = { id: 'g', nodeId: 'deleted', nodeEntityUid: 'old-uid', nodeType: 'video', snapshotAvailable: true, sourceNodeExists: false };
    const assets = captured.localRefImages.map((_url: string, index: number) => {
      const canonical = index === 1 ? 0 : index;
      return { id: `asset-${canonical}`, projectId: 'p', entityUid: `a1000000-0000-4000-8000-00000000000${canonical}`,
        contentHash: String(canonical + 1).repeat(64), kind: 'image', availability: 'available' };
    });
    const archive: any = { status: 'available', digest: 'verified', binding: { ...scope, nodeId: group.nodeId, nodeEntityUid: group.nodeEntityUid },
      snapshot: { node: { id: group.nodeId, type: 'video', data: { ...d, historyResolvedInput: captured } }, upstreamNodes: [], incomingEdges: [] },
      references: { status: 'captured', entries: assets.map((asset: any, index: number) => ({ status: 'bound', kind: 'image',
        path: ['node', 'data', 'historyResolvedInput', 'localRefImages', index], assetId: asset.id, entityUid: asset.entityUid, contentHash: asset.contentHash })) } };
    const before = structuredClone(archive), checked: string[] = [];
    const prepared = await prepareHistoryInputDraft(archive, group, scope, { assertCurrent() {},
      getAsset: async id => assets.find((asset: any) => asset.id === id), request: async (url, init) => {
        assert.equal(init.method, 'HEAD'); checked.push(url); return { ok: true };
      } });
    const patch = createHistoryInputDraftPatch(prepared, { ...scope, id: 'confirmed', baseRevision: 1, position: { x: 0, y: 0 } });
    assert.equal(patch.operations.length, 1); assert.equal(patch.operations[0].type, 'node.add');
    const node: any = patch.operations[0].payload.node;
    // The actual data-reading declarations, not manually reconstructed active
    // fields, decide the new node's options. No old upstream node is supplied.
    const restoredOptions = { ...options, ...readOptions({ ...options, d: node.data }) };
    const restored = render(node.data, { ...node.data, ...restoredOptions }).inputUsedByGenerate();
    const originalRequest = request({ ...originalOptions, finalPrompt: captured.prompt, imageUrls: captured.localRefImages, providerParams: {} });
    const restoredRequest = request({ ...restoredOptions, finalPrompt: restored.prompt, imageUrls: restored.localRefImages, providerParams: {} });
    const { images: originalImages, ...originalParameters } = originalRequest;
    const { images: restoredImages = [], ...restoredParameters } = restoredRequest;
    assert.deepEqual(restoredParameters, originalParameters, `${variant.model}: every non-image request field including literal prompt matches`);
    // Sora's explicit text endpoint does not use the old frontend images.
    const usedOriginalImages = variant.soraMode === 'text_to_video' ? [] : originalImages;
    assert.equal(restoredImages.length, usedOriginalImages.length);
    assert.equal(new Set(restoredImages).size, usedOriginalImages.length, 'same-byte aliases survive actual URL deduplication');
    for (const [index, url] of restoredImages.entries()) {
      const address = new URL(url, 'http://localhost'), asset = assets[captured.localRefImages.indexOf(usedOriginalImages[index])];
      assert.equal(address.pathname, `/api/project-assets/${asset.id}/media`);
      for (const key of ['entityUid', 'contentHash', 'projectId']) assert.equal(address.searchParams.get(key), asset[key]);
      assert.equal(address.searchParams.get('referenceSlot'), String(index));
    }
    assert.equal(checked.length, Math.max(0, usedOriginalImages.length - (usedOriginalImages.length > 1 ? 1 : 0)));
    assert.equal(Object.hasOwn(node.data, 'requestedSafetyTolerance'), false);
    assert.deepEqual(archive, before);
  }
});

test('FAL capture and strict settings restoration round-trip actual Veo/Grok/Sora payload expressions', () => {
  const variants: Array<{ options: Record<string, unknown>; fields: string[] }> = [
    { options: { falReg: { paramKind: 'veo-fal' }, vfRatio: '9:16', vfDuration: '8s', vfResolution: '1080p', vfAudio: false, vfSafety: 0 },
      fields: ['vfRatio', 'vfDuration', 'vfResolution', 'vfAudio', 'vfSafety'] },
    { options: { falReg: { paramKind: 'grok-fal', defaultImageMode: 'base64' }, isGrokFalV15: false,
      gkfMode: 'reference_to_video', gkfRatio: 'auto', gkfDuration: 10, gkfResolution: '720p' },
      fields: ['gkfMode', 'gkfRatio', 'gkfDuration', 'gkfResolution'] },
    { options: { falReg: { paramKind: 'grok-fal', defaultImageMode: 'url' }, isGrokFalV15: true,
      gkfMode: 'image_to_video', gkfRatio: 'auto', gkfDuration: 6, gkfResolution: '720p' },
      fields: ['gkfMode', 'gkfDuration', 'gkfResolution'] },
    { options: { falReg: { paramKind: 'sora-fal' }, soraMode: 'image_to_video', soraRatio: '9:16', soraDuration: 8,
      soraResolution: '1080p', soraDeleteVideo: false, soraBlockIp: true },
      fields: ['soraMode', 'soraRatio', 'soraDuration', 'soraResolution', 'soraDeleteVideo', 'soraBlockIp'] },
  ];
  for (const { options, fields } of variants) {
    const context = render({}, { ...options, isFal: true }).capture();
    const restored = historyVideoBasicSettings({ historyResolvedInput: context })!;
    for (const key of fields) assert.deepEqual(restored[key], options[key]);
    const scope = { ...options, apiModel: 'fal-model', finalPrompt: 'same prompt', providerParams: {},
      images: ['/files/input/original.png'], gkfReferenceUrls: '/files/input/pasted.png', soraCharacterIds: 'retained-character' };
    const before = actualFalPayload(scope);
    assert.deepEqual(actualFalPayload({ ...scope, ...restored, apiModel: scope.apiModel }), before);
    if (options.isGrokFalV15 === false) assert.equal(before.gkRatio, '16:9', 'auto is normalized by the real request code');
    if (options.isGrokFalV15 === true) {
      assert.equal(Object.hasOwn(restored, 'gkfRatio'), false); assert.equal(Object.hasOwn(before, 'gkRatio'), false);
    }
    for (const key of ['soraCharacterIds', 'gkfReferenceUrls', 'providerParams', 'image_mode']) assert.equal(Object.hasOwn(restored, key), false);
    const external = render({}, { ...options, isFal: true, isExternalSelected: true,
      providerSelection: { providerSource: 'external', providerId: 'external' }, externalProviderModel: 'external-model' }).capture();
    for (const key of fields) assert.equal(Object.hasOwn(external.basicSettings, key), false);
  }
});

test('Budget Omni, Seedance25, Kling and Vidu scalar capture matches their actual submit arguments', () => {
  assert.equal(submitArguments.submitSeedance.length, 2);
  assert.equal(submitArguments.submitKling.length, 1); assert.equal(submitArguments.submitVidu.length, 1);
  const variants = [
    { call: 'submitSeedance', index: 0, options: { isApimartBudgetVideo: true, isApimartOmniLowprice: true,
      apimartOmniLowpriceMode: 'reference_video', apimartOmniLowpriceNsfwCheck: false },
      fields: ['apimartOmniLowpriceMode', 'apimartOmniLowpriceNsfwCheck'] },
    { call: 'submitSeedance', index: 1, options: { isSeedance25: true, generateAudio: false, returnLastFrame: true },
      fields: ['generateAudio', 'returnLastFrame'] },
    { call: 'submitKling', index: 0, options: { isKling: true, klingMode: 'i2v', klingNegativePrompt: '  no blur  ' },
      fields: ['klingNegativePrompt'] },
    { call: 'submitKling', index: 0, options: { isKling: true, klingMode: 'edit' }, fields: [] },
    { call: 'submitVidu', index: 0, options: { isVidu: true, viduMode: 'i2v', viduSeed: -1 }, fields: ['viduSeed'] },
    { call: 'submitVidu', index: 0, options: { isVidu: true, viduMode: 'short-play', viduSeed: 0,
      viduScriptName: ' Saved script ', viduStyle: ' realistic ', viduAssetType: 'scene',
      viduAssetNamePrefix: ' Scene ', viduAssetDescription: ' Original scene description ' },
      fields: ['viduSeed', 'viduScriptName', 'viduStyle', 'viduAssetType', 'viduAssetNamePrefix', 'viduAssetDescription'] },
  ];
  for (const { call, index, options, fields } of variants) {
    const context = render({}, { videoBuiltinSource: 'seedance-nz', ...options }).capture();
    const settings = historyVideoBasicSettings({ historyResolvedInput: context })!;
    for (const key of fields) assert.deepEqual(settings[key], (options as Record<string, unknown>)[key]);
    const scope = { ...options, apiModel: 'fixture', finalPrompt: 'same prompt', duration: 8, ratio: '9:16', resolution: '1080p', seed: 0,
      isApimartOmni: false, apimartImages: ['/files/input/a.png'], apimartVideos: ['/files/input/a.mp4'],
      seedance25Mode: 'multi', seedance25Images: ['/files/input/a.png'], seedance25Videos: ['/files/input/a.mp4'], seedance25Audios: [],
      klingDuration: 10, klingImages: ['/files/input/a.png'], klingVideos: ['/files/input/a.mp4'],
      viduDuration: 10, viduRatio: '9:16', viduResolution: '1080p', viduImages: ['/files/input/a.png'] };
    const original = actualSubmitArguments(call, index, scope);
    const restoredFields = Object.fromEntries(fields.map(key => [key, settings[key]]));
    assert.deepEqual(actualSubmitArguments(call, index, { ...scope, ...restoredFields }), original);
    if (call === 'submitSeedance' && index === 0) { assert.equal(original.mode, 'reference_video'); assert.equal(original.nsfw_check, false); }
    if (call === 'submitSeedance' && index === 1) { assert.equal(original.generate_audio, false); assert.equal(original.return_last_frame, true); }
    if (call === 'submitKling') {
      if (options.klingMode === 'edit') assert.equal(Object.hasOwn(settings, 'klingNegativePrompt'), false);
      else assert.equal(original.negativePrompt, 'no blur', 'trimming is still performed by actual submission code');
    }
    if (call === 'submitVidu' && options.viduMode === 'i2v') assert.equal(Object.hasOwn(settings, 'viduScriptName'), false);
    const external = render({}, { ...options, isExternalSelected: true,
      providerSelection: { providerSource: 'external', providerId: 'p' }, externalProviderModel: 'external' }).capture();
    for (const key of fields) assert.equal(Object.hasOwn(external.basicSettings, key), false);
  }
});

test('ordinary FLUX and Wan scalar captures round-trip their real submit arguments without claiming reference recovery', () => {
  assert.equal(submitArguments.submitFlux3.length, 1); assert.equal(submitArguments.submitWan.length, 2);
  const variants = [
    { call: 'submitFlux3', index: 0, options: { isFlux3: true, flux3Mode: 'i2v', flux3Draft: false,
      flux3AudioMode: 'disabled', flux3SafetyTolerance: 0 }, fields: ['flux3Draft', 'flux3AudioMode', 'flux3SafetyTolerance'] },
    { call: 'submitFlux3', index: 0, options: { isFlux3: true, flux3Mode: 't2v', flux3Draft: true,
      flux3AudioMode: 'api_default', flux3SafetyTolerance: 'api_default' }, fields: ['flux3Draft', 'flux3AudioMode', 'flux3SafetyTolerance'] },
    { call: 'submitWan', index: 1, options: { isWan: true, isWan30: false, wanNegativePrompt: ' No blur ', wanPromptExtend: false, wanSeed: -1 },
      fields: ['wanNegativePrompt', 'wanPromptExtend', 'wanSeed'] },
    { call: 'submitWan', index: 0, options: { isWan: true, isWan30: true, wan30Mode: 'r2v', wan30SupportsThinking: true,
      wan30EnableThinking: false, wan30Seed: 0, generateAudio: false }, fields: ['wan30Seed', 'generateAudio', 'wan30EnableThinking'] },
    { call: 'submitWan', index: 0, options: { isWan: true, isWan30: true, wan30Mode: 'i2v', wan30SupportsThinking: false,
      wan30EnableThinking: true, wan30Seed: 8, generateAudio: true }, fields: ['wan30Seed', 'generateAudio'] },
  ];
  for (const { call, index, options, fields } of variants) {
    const context = render({}, { ...options, videoBuiltinSource: 'seedance-nz' }).capture();
    const settings = historyVideoBasicSettings({ historyResolvedInput: context })!;
    for (const key of fields) assert.deepEqual(settings[key], (options as Record<string, unknown>)[key]);
    const scope = { ...options, apiModel: 'fixture', finalPrompt: 'same prompt', duration: -1, ratio: 'adaptive', resolution: '720p',
      flux3Duration: 5, flux3Resolution: 'hd', fluxImages: ['/files/input/a.png'], fluxVideos: [],
      wan30Resolution: '480P', wan30Images: ['/files/input/a.png'], wan30Videos: [], wan30Audios: [],
      wan30FileUrl: '', wan30LinkUrl: '', firstImage: '/files/input/a.png', wanAudioUrl: '' };
    const original = actualSubmitArguments(call, index, scope);
    assert.deepEqual(actualSubmitArguments(call, index, { ...scope, ...Object.fromEntries(fields.map(key => [key, settings[key]])) }), original);
    if (call === 'submitFlux3') assert.equal(original.safetyTolerance, options.flux3SafetyTolerance);
    if (call === 'submitWan' && index === 0) {
      assert.equal(original.duration, 'auto'); assert.equal(original.generateAudio, options.generateAudio);
      if (!options.wan30SupportsThinking) {
        assert.equal(Object.hasOwn(settings, 'wan30EnableThinking'), false); assert.equal(original.enableThinking, false);
      }
    }
    for (const key of ['flux3DraftCache', 'flux3DraftCacheResult', 'wan30FileUrl', 'wan30LinkUrl', 'wanAudioUrl']) assert.equal(Object.hasOwn(settings, key), false);
    const external = render({}, { ...options, isExternalSelected: true,
      providerSelection: { providerSource: 'external', providerId: 'p' }, externalProviderModel: 'external' }).capture();
    for (const key of fields) assert.equal(Object.hasOwn(external.basicSettings, key), false);
  }
  const enhancement = render({}, { isFlux3: true, flux3Mode: 'draft-enhance' }).capture().basicSettings;
  for (const key of ['flux3Draft', 'flux3AudioMode', 'flux3SafetyTolerance', 'flux3DraftCache']) assert.equal(Object.hasOwn(enhancement, key), false);
});

test('H3 captured roles follow actual frame/audio slicing and archive per-video offsets outside scalar settings', () => {
  assert.equal(submitArguments.submitHailuo.length, 2);
  const roleStart = source.indexOf('let minimaxH3ImageCursor =');
  const roleEnd = source.indexOf('    if (', roleStart);
  assert.ok(roleStart > 0 && roleEnd > roleStart);
  const roleCode = ts.transpileModule(`${source.slice(roleStart, roleEnd)}\nreturn { minimaxH3FirstFrame, minimaxH3LastFrame,
    minimaxH3ReferenceImages, minimaxH3DriveAudio, minimaxH3ReferenceAudios };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const actualRoles = new Function('scope', `with(scope) { ${roleCode} }`);
  const d = { prompt: 'Same H3 prompt', localRefImages: ['/files/input/a.png', '/files/input/b.png', '/files/input/c.png'],
    localRefAudios: ['/files/input/drive.wav', '/files/input/ref.wav'], localRefVideos: ['/files/input/clip.mp4'],
    minimaxH3VideoStartSeconds: [-5, '2.5', 99999] };
  for (const [first, last, drive] of [[true, true, true], [false, true, false], [false, false, false]]) {
    const options = { isHailuo: true, isMinimaxH3V2: true, minimaxH3FirstFrameEnabled: first,
      minimaxH3LastFrameEnabled: last, minimaxH3DriveAudioEnabled: drive, minimaxH3AudioMode: 'native',
      minimaxH3DenoiseStrength: 0, minimaxH3AddDriveAsReference: 'api_default' };
    const context = render(d, options).capture();
    const settings = historyVideoBasicSettings({ historyResolvedInput: context })!;
    const originalRoles = actualRoles({ ...options, imageUrls: d.localRefImages, audioUrls: d.localRefAudios });
    const restoredRoles = actualRoles({ ...options, ...settings, imageUrls: context.localRefImages, audioUrls: context.localRefAudios });
    assert.deepEqual(restoredRoles, originalRoles);
    assert.equal(originalRoles.minimaxH3FirstFrame, first ? d.localRefImages[0] : undefined);
    assert.equal(originalRoles.minimaxH3LastFrame, last ? d.localRefImages[first ? 1 : 0] : undefined);
    assert.deepEqual(originalRoles.minimaxH3ReferenceImages, d.localRefImages.slice(Number(first) + Number(last)));
    assert.equal(originalRoles.minimaxH3DriveAudio, drive ? d.localRefAudios[0] : undefined);
    assert.deepEqual(originalRoles.minimaxH3ReferenceAudios, d.localRefAudios.slice(drive ? 1 : 0));
    assert.deepEqual(context.referenceOptions.minimaxH3VideoStartSeconds, [0, 2.5, 3600]);
    assert.equal(Object.hasOwn(settings, 'minimaxH3VideoStartSeconds'), false);
    const scope = { ...options, ...originalRoles, MINIMAX_H3_V2_MODEL: 'minimax-h3-v2', finalPrompt: d.prompt,
      hailuoDuration: 10, ratio: '16:9', minimaxResolution: '480P',
      minimaxReferenceVideos: [{ url: d.localRefVideos[0], startTimeSeconds: context.referenceOptions.minimaxH3VideoStartSeconds[0] }] };
    assert.deepEqual(actualSubmitArguments('submitHailuo', 0, { ...scope, ...settings, ...restoredRoles }), actualSubmitArguments('submitHailuo', 0, scope));
    const snapshot = captureGenerationHistoryInput([{ id: 'video', type: 'video', position: { x: 0, y: 0 }, data: d }], [], 'video', context);
    assert.equal(snapshot.complete, true); if (snapshot.complete) assert.deepEqual(snapshot.node.data.historyResolvedInput, context);
  }
  assert.equal(Object.hasOwn(render(d, { isHailuo: true, isMinimaxH3V2: false }).capture(), 'referenceOptions'), false);
  const external = render(d, { isHailuo: true, isMinimaxH3V2: true, isExternalSelected: true,
    providerSelection: { providerSource: 'external', providerId: 'p' }, externalProviderModel: 'm' }).capture();
  assert.equal(Object.hasOwn(external, 'referenceOptions'), false);
  assert.equal(Object.hasOwn(external.basicSettings, 'minimaxH3FirstFrameEnabled'), false);
});
