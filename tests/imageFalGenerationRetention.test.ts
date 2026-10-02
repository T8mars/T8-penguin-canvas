import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { collectRunOutputAssets } from '../src/utils/runProviderTrace.ts';
import { assertFreshGenerationCompleted } from '../src/utils/generationResultRetention.ts';
import { createRunNodeLifecycleController } from '../src/utils/runLifecycle.ts';
import historyInputContract from '../backend/src/shared/generationHistoryInputContract.json';
import { GPT_IMAGE_25_MAX_IMAGES, GPT_IMAGE_25_PROMPT_MAX_LENGTH, validateGptImage25Size } from '../src/providers/models';
import { historyImageBasicSettings } from '../src/utils/historyImageBasicSettings';
import { buildMjPrompt } from '../src/services/generation';
import { seedreamNzRuntimeModel, seedreamNzValidation } from '../src/utils/seedreamNzContract';

// Execute the repository's actual ImageNode callback and wrapper with controlled
// transports/lifecycle promises. Request builders for branch fixtures are not
// API-contract evidence. This is not a live Provider or persisted Run test.
const source = readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('ImageNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['nextGenerationRun', 'isCurrentGenerationRun', 'resolveGenerationInput', 'handleGenerate', 'handleStop', 'stopLocalGeneration']);
const declarations: string[] = [];
let wrapper = '';
let capture = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) declarations.push(`const ${node.getText(tree)};`);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useRunTrigger') {
    wrapper = node.arguments[1].getText(tree);
    const options = node.arguments[3];
    if (ts.isObjectLiteralExpression(options)) for (const property of options.properties) {
      if (ts.isPropertyAssignment(property) && property.name.getText(tree) === 'captureHistoryInput') capture = property.initializer.getText(tree);
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, names.size);
assert.ok(wrapper);
assert.ok(capture);
const compiled = ts.transpileModule(`${declarations.join('\n')}\nreturn { handleGenerate, handleStop, resolveGenerationInput, capture: ${capture}, wrapped: ${wrapper} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const factory = new Function('scope', `with (scope) { ${compiled} }`);

function harness(sync = true) {
  const old = ['/files/output/old-1.png', '/files/output/old-2.png'];
  const fresh = ['/files/output/new-1.png', '/files/output/new-2.png', '/files/output/new-3.png'];
  const state: any = { data: { status: 'success', imageUrl: old[0], imageUrls: [...old], lastPrompt: 'old prompt' }, calls: 0, queries: 0, notifications: 0, error: null, outputs: [] };
  const scope: any = {
    historyInputContract, seedreamNzRuntimeModel, seedreamNzValidation,
    isQwenImage21Tab: false, orderedImages: [],
    modelDef: { id: 'fixture-model' }, effectiveAspectRatio: '1:1', effectiveSizeLevel: '1K',
    isStandardGptImage2: false,
    cancelRunTrigger: () => true,
    id: 'fal-fixture', d: state.data, localPrompt: 'new prompt', promptMentions: [], mentionMaterials: [], imagePromptAdjustments: {},
    collectUpstream: () => ({ prompt: '', images: [] }),
    resolveMediaMentions: (prompt: string) => prompt,
    combinePromptWithImageAdjustments: (prompt: string) => ({ finalPrompt: prompt, inactive: [] }),
    setError: (error: unknown) => { state.error = error; }, setDownloadNotice() {},
    update: (patch: object) => Object.assign(state.data, patch),
    logBus: { info() {}, error() {}, success() {}, warn() {}, debug() {} },
    generationRunRef: { current: 0 },
    assertFreshGenerationCompleted, collectRunOutputAssets,
    taskCompletionSound: { primeAudio() {}, notifyComplete() { state.notifications++; } },
    isComfyExternal: false, isExternalSelected: false, isSeedreamLayerTab: false, isVosr2ImageTab: false,
    isZhenzhenBudgetMjSelected: false, isGptImage25: false, isZhenzhenImageG25: false,
    isZhenzhenImageG2: false, isZhenzhenImageG2I2I: false, isZhenzhenGrokImageEdit: false,
    isZhenzhenGrokImageV2: false, isZhenzhenGrokImageV2Edit: false, isQwenImageTab: false, isQwenImageI2I: false,
    isWanImageTab: false, isSeedream: false, isSeedreamNz: false, isZhenzhenBudgetPlatformSelected: false,
    isZhenzhenBudgetImageSelected: false, isMj: false, isFal: true, falDef: { id: 'fixture' },
    maxRefs: 14, apiModel: 'fixture-fal-image', falKind: 'gpt-fal', falSize: 'auto', falN: 3,
    falCustomW: 1280, falCustomH: 1280,
    falFormat: 'png', falSync: sync, falMode: 'gen', falQuality: 'low', providerParams: {},
    minPollCountForTimeout: () => 2,
    setTimeout: (callback: () => void) => { callback(); return 1; },
    submitImageFal: async () => { state.calls++; return sync ? { sync: true, urls: [...fresh] } : { sync: false, requestId: 'fixture-request', endpoint: 'fixture-endpoint' }; },
    queryImageFal: async () => { state.queries++; return { status: 'completed', urls: [...fresh] }; },
  };
  Object.defineProperty(scope, 'status', { get: () => state.data.status });
  const callbacks = factory(scope);
  const reporter: any = { providerRequest: async () => {}, providerSubmitted: async () => {}, providerResponse: async () => {}, polling: async () => {},
    output: async (payload: unknown) => { state.outputs.push(structuredClone(payload)); },
  };
  const oldIntact = () => {
    assert.equal(state.data.imageUrl, old[0]); assert.deepEqual(state.data.imageUrls, old); assert.equal(state.data.lastPrompt, 'old prompt');
  };
  return { state, scope, reporter, old, fresh, oldIntact, capture: callbacks.capture, resolveInput: callbacks.resolveGenerationInput, run: () => callbacks.handleGenerate(reporter), execute: (activeReporter = reporter) => callbacks.wrapped(activeReporter), stop: callbacks.handleStop };
}

test('actual shared image input resolver preserves upstream priority, Comfy fallback and adjustment compilation', () => {
  const h = harness(); h.scope.localPrompt = 'local';
  h.scope.collectUpstream = () => ({ prompt: 'upstream', images: ['local-first', 'upstream-second'] });
  h.scope.combinePromptWithImageAdjustments = (prompt: string, _adjustments: unknown, options: any) => ({ finalPrompt: `${prompt}:compiled:${options.hasReferenceImages}`, inactive: [] });
  assert.deepEqual(h.resolveInput().upstreamImages, ['local-first', 'upstream-second']);
  assert.equal(h.resolveInput().finalPrompt, 'upstream:compiled:true');
  const captured = h.capture();
  assert.deepEqual(captured, { schema: historyInputContract.imageSettingsContextSchema, origin: 'frontend-common-context',
    prompt: 'upstream:compiled:true', referenceImages: ['local-first', 'upstream-second'],
    basicSettings: { model: 'fixture-model', apiModel: 'fixture-fal-image', aspectRatio: '1:1', sizeLevel: '1K',
      imageBuiltinSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '',
      falN: 3, falFormat: 'png', falSync: true, falMode: 'gen', falSize: 'auto', falCustomW: 1280, falCustomH: 1280, falQuality: 'low' } });
  assert.equal(h.state.calls, 0, 'capture does not submit generation');
  h.scope.collectUpstream = () => ({ prompt: '', images: [] });
  h.scope.isComfyExternal = true; h.scope.comfyHasPromptField = true; h.scope.providerParams = { positive: 'comfy' };
  assert.equal(h.resolveInput().finalPrompt, 'comfy:compiled:false');
  h.scope.comfyHasPromptField = false;
  assert.equal(h.resolveInput().finalPrompt, 'comfy', 'no prompt field means no adjustment compilation');
});

test('stale image stop cannot invalidate a newer local run or clear its preview', () => {
  const h = harness(true);
  h.scope.cancelRunTrigger = () => false;
  const before = structuredClone(h.state.data);
  h.stop();
  assert.equal(h.scope.generationRunRef.current, 0);
  assert.deepEqual(h.state.data, before);
});

for (const sync of [true, false]) {
  test(`actual FAL ${sync ? 'sync' : 'poll'} success replaces the entire batch; Run extraction contains only new images`, async () => {
    const h = harness(sync);
    h.reporter.providerRequest = async () => h.oldIntact();
    h.reporter.polling = async () => h.oldIntact();
    await h.run();
    assert.equal(h.state.error, null);
    assert.equal(h.state.data.status, 'success'); assert.equal(h.state.data.imageUrl, h.fresh[0]);
    assert.deepEqual(h.state.data.imageUrls, h.fresh);
    assert.deepEqual(collectRunOutputAssets(h.state.data).map(item => item.sourceUrl), h.fresh);
    assert.equal(h.state.data.lastPrompt, 'new prompt'); assert.equal(h.state.calls, 1); assert.equal(h.state.queries, sync ? 0 : 1);
  });

  test(`actual FAL ${sync ? 'sync' : 'poll'} failure keeps the previous batch and prompt`, async () => {
    const h = harness(sync);
    if (sync) h.scope.submitImageFal = async () => { h.oldIntact(); throw new Error('fixture rejection'); };
    else h.scope.queryImageFal = async () => { h.oldIntact(); return { status: 'failed', error: 'fixture rejection' }; };
    await assert.rejects(h.run(), /fixture rejection/); h.oldIntact();
    assert.equal(h.state.data.status, 'error'); assert.equal(h.state.error, 'fixture rejection'); assert.equal(h.state.notifications, 0);
  });

  test(`actual FAL ${sync ? 'sync response' : 'polling'} lifecycle stop cannot apply a late batch`, async () => {
    const h = harness(sync);
    if (sync) h.reporter.providerResponse = async () => h.stop();
    else h.reporter.polling = async () => h.stop();
    await h.run(); h.oldIntact(); assert.equal(h.state.data.status, 'idle'); assert.equal(h.state.notifications, 0);
  });
}

test('actual FAL empty completed result does not erase prior images', async () => {
  const h = harness(false); h.scope.queryImageFal = async () => ({ status: 'completed', urls: [] });
  await assert.rejects(h.run(), /未返回图片/); h.oldIntact(); assert.equal(h.state.data.status, 'error'); assert.match(h.state.error, /未返回图片/);
});

test('stop during pre-submission lifecycle evidence prevents the image Provider call', async () => {
  const h = harness(); h.reporter.providerRequest = async () => h.stop();
  await h.run(); h.oldIntact(); assert.equal(h.state.calls, 0); assert.equal(h.state.data.status, 'idle');
});

test('stop during submitted evidence leaves the stopped node idle without polling', async () => {
  const h = harness(false); h.reporter.providerSubmitted = async () => h.stop();
  await h.run(); h.oldIntact(); assert.equal(h.state.data.status, 'idle');
  assert.equal(h.state.data.taskId, null); assert.equal(h.state.calls, 1); assert.equal(h.state.queries, 0);
});

test('stop during failure evidence cannot overwrite stopped state with a late error', async () => {
  const h = harness(); h.scope.submitImageFal = async () => { throw new Error('late failure'); };
  h.reporter.providerResponse = async () => h.stop();
  await h.run(); h.oldIntact(); assert.equal(h.state.data.status, 'idle'); assert.equal(h.state.error, null);
});

test('success then failed regeneration then smaller success never mixes FAL batches', async () => {
  const h = harness(); await h.run();
  const firstReceipt = collectRunOutputAssets(h.state.data);
  h.scope.localPrompt = 'second prompt'; h.scope.submitImageFal = async () => { throw new Error('second failed'); };
  await assert.rejects(h.run(), /second failed/); assert.equal(h.state.data.status, 'error');
  assert.deepEqual(h.state.data.imageUrls, h.fresh); assert.equal(h.state.data.lastPrompt, 'new prompt');
  h.scope.localPrompt = 'third prompt'; h.scope.submitImageFal = async () => ({ sync: true, urls: ['/files/output/third.png'] });
  await h.run(); assert.equal(h.state.data.status, 'success');
  assert.deepEqual(collectRunOutputAssets(h.state.data).map(item => item.sourceUrl), ['/files/output/third.png']);
  assert.equal(h.state.data.lastPrompt, 'third prompt');
  assert.deepEqual(firstReceipt.map(item => item.sourceUrl), h.fresh, 'old receipt is not mutated when the current preview changes');
});

type Path = 'fal-sync' | 'fal-poll' | 'external' | 'standard-sync' | 'standard-poll' | 'mj-legacy' | 'mj-nz-sync' | 'mj-nz-poll' | 'vosr2';
const paths: Path[] = ['fal-sync', 'fal-poll', 'external', 'standard-sync', 'standard-poll', 'mj-legacy', 'mj-nz-sync', 'mj-nz-poll', 'vosr2'];
function pathHarness(path: Path) {
  const h = harness(path !== 'fal-poll');
  const submit = (value: unknown) => async () => { h.state.calls++; return structuredClone(value); };
  const query = (value: unknown) => async () => { h.state.queries++; return structuredClone(value); };
  Object.assign(h.scope, {
    isFal: path.startsWith('fal-'),
    modelDef: { id: 'fixture-standard', paramKind: 'standard' }, isStandardGptImage2: false,
    effectiveAspectRatio: '1:1', effectiveSizeLevel: '1K',
  });
  let submitName = 'submitImageFal'; let queryName = path === 'fal-poll' ? 'queryImageFal' : null;
  if (path === 'external') {
    Object.assign(h.scope, { isExternalSelected: true, providerSelection: { provider: { id: 'fixture-provider' } }, externalProviderModel: 'fixture-image',
      aspectRatio: '1:1', sizeLevel: '1K', externalImageSizeFor: () => '1024x1024', isJimengCliImageSelected: false,
      isModelScopeExternal: false, externalImageCountLimit: 4, generateExternalImage: submit({ imageUrls: h.fresh }),
    }); submitName = 'generateExternalImage';
  }
  if (path.startsWith('standard-')) {
    Object.assign(h.scope, {
      submitImageAsync: submit(path === 'standard-sync' ? { sync: true, urls: h.fresh } : { taskId: 'fixture-task' }),
      queryImageStatus: query({ status: 'completed', urls: h.fresh }),
    }); submitName = 'submitImageAsync'; queryName = path === 'standard-poll' ? 'queryImageStatus' : null;
  }
  if (path.startsWith('mj-')) {
    Object.assign(h.scope, { isMj: true, mjVersion: 'fixture-mj', mjAr: '1:1', mjSpeed: 'fast', mjSrefImages: [], mjOrefImages: [],
      mjC: 0, mjS: 0, mjIw: 0, mjSw: 0, mjSv: 0, mjNo: '', mjSeed: 0, mjPollInt: 1, mjMaxPoll: 10,
      buildMjPrompt: ({ prompt }: any) => prompt, submitMjImagine: submit({ taskId: 'fixture-task' }),
      queryMjTask: query({ status: 'SUCCESS', imageUrl: h.fresh[0], imageUrls: h.fresh }),
    }); submitName = 'submitMjImagine'; queryName = 'queryMjTask';
    if (path.startsWith('mj-nz-')) {
      Object.assign(h.scope, { isZhenzhenBudgetMjSelected: true, isZhenzhenBudgetPlatformSelected: true,
        zhenzhenSd2ApiKey: 'fixture-not-a-real-key', mjNzOperation: 'midjourney-imagine', mjNzVideoSource: 'image',
        midjourneyNzRequiresPrompt: () => true, imageOnlyOutput: true, buildMidjourneyNzRequest: () => ({}),
        submitMidjourneyNz: submit(path === 'mj-nz-sync' ? { status: 'completed', taskId: 'fixture-task', imageUrls: h.fresh } : { status: 'pending', taskId: 'fixture-task' }),
        queryMidjourneyNz: query({ status: 'completed', taskId: 'fixture-task', imageUrls: h.fresh }),
      }); submitName = 'submitMidjourneyNz'; queryName = path === 'mj-nz-poll' ? 'queryMidjourneyNz' : null;
    }
  }
  if (path === 'vosr2') {
    Object.assign(h.scope, { isVosr2ImageTab: true, isZhenzhenBudgetPlatformSelected: true, orderedImages: ['/files/input/reference.png'],
      collectUpstream: () => ({ prompt: '', images: ['/files/input/reference.png'] }),
      zhenzhenSd2ApiKey: 'fixture-not-a-real-key', seedanceNzProviderLabel: 'fixture NZ', VOSR2_IMAGE_UPSCALE_MODEL: 'vosr2-image-upscale',
      submitSeedreamNz: submit({ taskId: 'fixture-task' }), querySeedreamNz: query({ status: 'completed', urls: h.fresh }),
    }); submitName = 'submitSeedreamNz'; queryName = 'querySeedreamNz';
  }
  return { ...h, submitName, queryName };
}

for (const path of paths) {
  test(`${path}: actual execution wrapper emits only the fresh batch, including after a prior different media family`, async () => {
    const h = pathHarness(path);
    Object.assign(h.state.data, { videoUrl: '/files/output/old.mp4', videoUrls: ['/files/output/old.mp4'], outputText: 'old description', generatedImages: ['/files/output/legacy.png'] });
    await h.execute();
    assert.equal(h.state.calls, 1); assert.equal(h.state.outputs.length, 1);
    assert.deepEqual(h.state.outputs[0].assets.map((item: any) => item.sourceUrl), h.fresh);
    assert.equal(h.state.outputs[0].outputCount, 3);
    assert.equal(h.state.data.videoUrl, null); assert.deepEqual(h.state.data.videoUrls, []); assert.equal(h.state.data.outputText, '');
  });

  test(`${path}: Provider failure rejects the wrapper and emits no old output receipt`, async () => {
    const h = pathHarness(path);
    h.scope[h.submitName] = async () => { throw new Error('fixture upstream rejected'); };
    await assert.rejects(h.execute(), /fixture upstream rejected/); h.oldIntact(); assert.deepEqual(h.state.outputs, []);
  });

  test(`${path}: success evidence failure retains old preview and cannot admit new or old output`, async () => {
    const h = pathHarness(path);
    h.reporter.providerResponse = async (payload: any) => { if (payload.status === 'succeeded') throw new Error('fixture evidence unavailable'); };
    await assert.rejects(h.execute(), /fixture evidence unavailable/); h.oldIntact();
    assert.deepEqual(h.state.outputs, []); assert.equal(h.state.notifications, 0);
  });

  test(`${path}: stop while success evidence waits prevents preview replacement and output admission`, async () => {
    const h = pathHarness(path); h.reporter.providerResponse = async () => h.stop();
    await assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact();
    assert.deepEqual(h.state.outputs, []); assert.equal(h.state.notifications, 0);
  });

  test(`${path}: an already aborted Run cannot submit a new Provider task`, async () => {
    const h = pathHarness(path); h.reporter.signal = AbortSignal.abort();
    await assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact();
    assert.equal(h.state.calls, 0); assert.deepEqual(h.state.outputs, []);
  });

  test(`${path}: Run abort while pre-submit evidence waits cannot dispatch the Provider`, async () => {
    const h = pathHarness(path); const abort = new AbortController(); h.reporter.signal = abort.signal;
    h.reporter.providerRequest = async () => abort.abort();
    await assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact();
    assert.equal(h.state.calls, 0); assert.deepEqual(h.state.outputs, []);
  });

  if (pathHarness(path).queryName) test(`${path}: stop during polling evidence retains idle state and emits nothing`, async () => {
    const h = pathHarness(path); h.reporter.polling = async () => h.stop();
    await assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact();
    assert.equal(h.state.data.status, 'idle'); assert.equal(h.state.data.progress, '已停止'); assert.deepEqual(h.state.outputs, []);
  });
}

test('validation early return and busy-node return do not rearchive retained success', async () => {
  const h = harness(); h.scope.localPrompt = '';
  await assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact(); assert.equal(h.state.calls, 0);
  h.scope.localPrompt = 'new prompt'; h.state.data.status = 'generating';
  await assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' }); h.oldIntact();
  assert.deepEqual(h.state.outputs, []); assert.equal(h.state.calls, 0);
});

for (const path of ['mj-nz-sync', 'mj-nz-poll'] as const) {
  test(`${path}: MODAL completion emits an explicit empty receipt, keeps old preview and never generates again`, async () => {
    const h = pathHarness(path); const transport = h.queryName || h.submitName;
    h.scope[transport] = async () => { if (!h.queryName) h.state.calls++; return { status: 'modal', taskId: 'modal-task', buttons: [] }; };
    await h.execute(); h.oldIntact();
    assert.equal(h.state.calls, 1); assert.equal(h.state.data.status, 'idle'); assert.equal(h.state.data.mjNzOperation, 'midjourney-modal');
    assert.deepEqual(h.state.outputs, [{ status: 'succeeded', outputCount: 0, assets: [], interactionRequired: true }]);
    assert.equal(h.state.notifications, 0);
  });
}

test('Midjourney describe and video admit their own output family without retained pictures', async () => {
  for (const result of [{ text: 'new description', resultFamily: 'text' }, { videoUrls: ['/files/output/new.mp4'], resultFamily: 'video' }]) {
    const h = pathHarness('mj-nz-sync'); h.scope.submitMidjourneyNz = async () => ({ status: 'completed', taskId: 'new-task', ...result });
    await h.execute(); assert.equal(h.state.outputs[0].assets.length, 1); assert.equal(h.state.outputs[0].assets[0].kind, result.resultFamily);
    assert.equal(h.state.data.imageUrl, null); assert.deepEqual(h.state.data.imageUrls, []);
  }
});

test('failed lifecycle persistence does not leave the image node stuck generating or erase its old preview', async () => {
  const h = harness(); h.reporter.providerResponse = async () => { throw new Error('all response writes failed'); };
  await assert.rejects(h.execute(), /all response writes failed/); h.oldIntact();
  assert.equal(h.state.data.status, 'error'); assert.deepEqual(h.state.outputs, []);
});

test('MODAL empty output traverses the real lifecycle controller and disables generic stale-node output collection', async () => {
  const h = pathHarness('mj-nz-sync'); h.scope.submitMidjourneyNz = async () => ({ status: 'modal', taskId: 'modal-task' });
  const events: any[] = [];
  const lifecycle = createRunNodeLifecycleController({ runContext: null, executionToken: 'fixture-modal',
    sink: { write: async (type, payload) => { events.push({ type, payload }); } },
  });
  await h.execute(lifecycle.reporter); await lifecycle.flush(); h.oldIntact();
  assert.equal(lifecycle.outputEmitted(), true);
  assert.deepEqual(events.filter(event => event.type === 'node.output').map(event => event.payload.assets), [[]]);
  const hook = readFileSync(new URL('../src/hooks/useRunTrigger.ts', import.meta.url), 'utf8');
  assert.match(hook, /if \(!lifecycle.outputEmitted\(\)\) \{\s*const assets = collectRunOutputAssets\(latestNodeData\)/);
  assert.match(hook, /type === 'node.output' && Array.isArray\(payload.assets\) && payload.assets.length > 0/);
});

test('actual image wrapper awaits output persistence and does not claim emitted output on failure', async () => {
  const h = harness();
  const lifecycle = createRunNodeLifecycleController({ runContext: null, executionToken: 'fixture-output-failed',
    sink: { write: async type => { if (type === 'node.output') throw new Error('output receipt rejected'); } },
  });
  await assert.rejects(h.execute(lifecycle.reporter), /output receipt rejected/);
  assert.equal(lifecycle.outputEmitted(), false); await assert.rejects(lifecycle.flush(), /output receipt rejected/);
  // The Provider did finish. Its new local preview remains available; a failed
  // history write must not be advertised as a successfully archived result.
  assert.deepEqual(h.state.data.imageUrls, h.fresh);
});

test('Run abort during a pending Provider call immediately stops the node and rejects its late output', async () => {
  const h = harness(); const abort = new AbortController(); h.reporter.signal = abort.signal;
  h.scope.cancelRunTrigger = () => false; // owning Run already removed its token before delivering abort
  let resolveSubmit: (value: any) => void;
  h.scope.submitImageFal = () => new Promise(resolve => { resolveSubmit = resolve; });
  const running = assert.rejects(h.execute(), { code: 'GENERATION_NOT_COMPLETED' });
  for (let turn = 0; turn < 10 && !resolveSubmit!; turn++) await Promise.resolve();
  assert.ok(resolveSubmit!); assert.equal(h.state.data.status, 'generating');
  abort.abort(); h.oldIntact(); assert.equal(h.state.data.status, 'idle'); assert.equal(h.state.data.progress, '已停止');
  resolveSubmit!({ sync: true, urls: h.fresh }); await running;
  h.oldIntact(); assert.deepEqual(h.state.outputs, []);
});

test('completed image execution removes its abort listener so an old Run cannot stop later work', async () => {
  const h = harness(); const abort = new AbortController(); h.reporter.signal = abort.signal;
  await h.execute(); h.state.data.status = 'generating';
  abort.abort(); assert.equal(h.state.data.status, 'generating'); assert.deepEqual(h.state.data.imageUrls, h.fresh);
});

for (const family of ['gpt2', 'gpt25', 'seedream']) test(`${family} archived model options match the actual standard submit callback`, async () => {
  const h = pathHarness('standard-sync');
  const gpt = family !== 'seedream';
  Object.assign(h.scope, { isStandardGptImage2: gpt, isGptImage25: family === 'gpt25', isSeedream: !gpt,
    GPT_IMAGE_25_MAX_IMAGES, GPT_IMAGE_25_PROMPT_MAX_LENGTH, validateGptImage25Size, orderedImages: [],
    modelDef: { id: gpt ? 'gpt-image-2' : 'seedream-v5', paramKind: gpt ? 'gpt-size' : 'seedream-v5' },
    apiModel: family === 'gpt25' ? 'gpt-image-2.5-flare' : family,
    gptImageQuality: family === 'gpt25' ? 'xhigh' : 'high', gptImageModeration: 'low',
    gptImage25Size: 'custom', gptImage25CustomWidth: 1536, gptImage25CustomHeight: 1024,
    gptImage25ResolvedSize: '1536x1024', gptImage25Count: 3, gptImage25Background: 'opaque',
    seedreamApiSource: 'zhenzhen', seedreamCustomSize: '2048x1152', seedreamResolvedSize: '2048x1152', seedreamOutputFormat: 'jpeg',
  });
  let sent: any;
  h.scope.submitImageAsync = async (payload: any) => { sent = structuredClone(payload); return { sync: true, urls: h.fresh }; };
  const captured = h.capture(); await h.execute();
  const settings = captured.basicSettings;
  assert.ok(sent); assert.equal(captured.prompt, sent.prompt);
  if (gpt) { assert.equal(settings.gptImageQuality, sent.quality); assert.equal(settings.gptImageModeration, sent.moderation); }
  if (family === 'gpt25') {
    assert.equal(`${settings.gptImage25CustomWidth}x${settings.gptImage25CustomHeight}`, sent.size);
    assert.equal(settings.gptImage25Count, sent.n); assert.equal(settings.gptImage25Background, sent.background);
  } else if (!gpt) {
    assert.equal(settings.seedreamCustomSize, sent.size); assert.equal(settings.seedreamOutputFormat, sent.output_format);
    assert.equal(settings.gptImage25Count, undefined);
  } else assert.equal(settings.gptImage25Count, undefined);
  for (const key of ['taskId', 'status', 'imageUrl', 'providerParams', 'apiKey']) assert.equal(key in settings, false);
});

for (const family of ['gpt-fal', 'nbpro-fal', 'nbpro-fal-random']) test(`${family} archived FAL options match actual submission without inventing a resolved random seed`, async () => {
  const h = harness(true), isGpt = family === 'gpt-fal';
  Object.assign(h.scope, { falKind: isGpt ? 'gpt-fal' : 'nbpro-fal', falSize: 'custom', falCustomW: 1536, falCustomH: 1024,
    falMode: 'edit', falQuality: 'high', falFormat: 'webp', falN: 2,
    nbAspect: '16:9', nbResolution: '4K', nbSafety: '5', nbImgMode: 'base64', nbWebSearch: false,
    nbSysPrompt: 'Archived instruction', nbSeed: family === 'nbpro-fal-random' ? 0 : 1234,
  });
  h.state.data.falN = 2;
  let sent: any;
  h.scope.submitImageFal = async (payload: any) => { sent = structuredClone(payload); return { sync: true, urls: h.fresh }; };
  const captured = h.capture(); await h.execute();
  const settings = historyImageBasicSettings({ historyResolvedInput: captured })!;
  assert.equal(settings.falN, sent.n); assert.equal(settings.falFormat, sent.format); assert.equal(settings.falSync, sent.sync);
  if (isGpt) {
    for (const [setting, parameter] of Object.entries({ falMode: 'mode', falSize: 'size', falCustomW: 'customW', falCustomH: 'customH', falQuality: 'quality' })) {
      assert.equal(settings[setting], sent[parameter]);
    }
    assert.equal(settings.nbSeed, undefined);
  } else {
    for (const [setting, parameter] of Object.entries({ nbAspect: 'aspect_ratio', nbResolution: 'resolution', nbSafety: 'safety_tolerance',
      nbImgMode: 'image_mode', nbWebSearch: 'enable_web_search', nbSysPrompt: 'system_prompt' })) assert.equal(settings[setting], sent[parameter]);
    assert.equal(settings.nbSeed, h.scope.nbSeed);
    assert.equal(sent.seed, h.scope.nbSeed > 0 ? h.scope.nbSeed : undefined);
    assert.equal(settings.falCustomW, undefined);
  }
  for (const key of ['requestId', 'taskId', 'falEndpoint', 'providerParams', 'apiKey']) assert.equal(key in settings, false);
});

for (const family of ['g25-official', 'g25-lowprice', 'grok-edit', 'banana', 'qwen', 'wan', 'seedream-nz', 'seedream-nz-flash-domestic', 'seedream-nz-flash-overseas', 'layer']) {
  test(`${family} archived budget image options follow the actual submit branch`, async () => {
    const h = pathHarness('vosr2');
    Object.assign(h.scope, { isVosr2ImageTab: false, isZhenzhenBudgetImageSelected: ['g25-official', 'g25-lowprice', 'grok-edit', 'banana'].includes(family),
      isZhenzhenBudgetPlatformSelected: !family.startsWith('seedream-nz'),
      isSeedreamNz: family.startsWith('seedream-nz'), isSeedream: family.startsWith('seedream-nz'), seedreamApiSource: 'seedance-nz',
      isSeedreamLayerTab: family === 'layer', isQwenImageTab: family === 'qwen', isWanImageTab: family === 'wan', isWanImageI2I: false,
      isZhenzhenImageG25: family.startsWith('g25'), isZhenzhenImageG25Official: family === 'g25-official', isZhenzhenImageG25Lowprice: family === 'g25-lowprice',
      isZhenzhenGrokImageV2Edit: family === 'grok-edit', isZhenzhenGrokImage: false, isZhenzhenNb: family === 'banana',
      isZhenzhenApimartImage: false, isZhenzhenLowpriceImage: false,
      seedreamNzModelFamily: family === 'seedream-nz-flash-domestic' ? 'domestic-flash' : family === 'seedream-nz-flash-overseas' ? 'overseas-flash' : 'overseas',
      seedreamNzResolution: 'custom', seedreamNzCustomSize: '2048x1152', seedreamNzResolvedSize: '2048x1152',
      seedreamNzUiModel: 'dola-seedream-5.0-pro-i2i',
      seedreamOutputFormat: 'jpeg', seedreamLayerResolution: '1.5k',
      zhenzhenImageG25Size: family === 'g25-official' ? 'custom' : '16:9', zhenzhenImageG25CustomWidth: 1536, zhenzhenImageG25CustomHeight: 1024,
      zhenzhenImageG25CustomSize: '1536x1024', zhenzhenImageG25Resolution: '2k', zhenzhenImageG25Count: family === 'g25-official' ? 3 : 1,
      zhenzhenImageG25Quality: 'xhigh', zhenzhenImageG25OutputFormat: 'webp', zhenzhenImageG25OutputCompression: 0,
      zhenzhenImageG25Background: 'opaque', zhenzhenImageG25Moderation: 'low', zhenzhenImageG25NsfwCheck: false,
      ZHENZHEN_IMAGE_G25_PROMPT_MAX_LENGTH: 5000, ZHENZHEN_IMAGE_G25_LOWPRICE_MAX_IMAGES: 15, ZHENZHEN_IMAGE_G25_OFFICIAL_MAX_IMAGES: 16,
      validateGptImage25Size, grokV2ImageCount: 2, grokV2EditResolution: '2k', grokV2EditNsfwCheck: false, zhenzhenNbImageCount: 3,
      qwenSizingMode: 'custom_size', qwenCustomSize: '1536*1024', qwenResolution: '2k', qwenImageCount: 2,
      qwenNegativePrompt: '  avoid blur  ', qwenPromptExtend: false, qwenSeed: -1,
      wanImageWidth: 1536, wanImageHeight: 1024, wanImageThinkingMode: false,
    });
    let sent: any;
    h.scope.submitSeedreamNz = async (payload: any) => { sent = structuredClone(payload); return { taskId: 'fixture-task' }; };
    const context = h.capture(); await h.execute();
    const settings = historyImageBasicSettings({ historyResolvedInput: context })!;
    assert.ok(sent);
    const mapping = family.startsWith('g25') ? { zhenzhenImageG25Size: 'size', zhenzhenImageG25Count: 'n' }
      : family === 'grok-edit' ? { grokV2ImageCount: 'n', grokV2EditResolution: 'resolution', grokV2EditNsfwCheck: 'nsfw_check' }
      : family === 'banana' ? { apimartImageCount: 'n' }
      : family === 'qwen' ? { qwenSizingMode: 'sizing_mode', qwenCustomSize: 'size', qwenImageCount: 'n', qwenPromptExtend: 'prompt_extend', qwenSeed: 'seed' }
      : family === 'wan' ? { wanImageWidth: 'width', wanImageHeight: 'height', wanImageThinkingMode: 'thinking_mode' }
      : family.startsWith('seedream-nz') ? { seedreamNzModelFamily: 'modelFamily', seedreamNzCustomSize: 'size', seedreamOutputFormat: 'output_format' }
      : { seedreamLayerResolution: 'resolution', seedreamOutputFormat: 'output_format' };
    for (const [setting, parameter] of Object.entries(mapping)) assert.equal(settings[setting], sent[parameter!], setting);
    if (family === 'g25-official') {
      assert.equal(`${settings.zhenzhenImageG25CustomWidth}x${settings.zhenzhenImageG25CustomHeight}`, sent.custom_size);
      for (const [setting, parameter] of Object.entries({ zhenzhenImageG25Quality: 'quality', zhenzhenImageG25OutputFormat: 'output_format',
        zhenzhenImageG25OutputCompression: 'output_compression', zhenzhenImageG25Background: 'background', zhenzhenImageG25Moderation: 'moderation' })) assert.equal(settings[setting], sent[parameter]);
    }
    if (family === 'g25-lowprice') {
      assert.equal(settings.zhenzhenImageG25Resolution, sent.resolution); assert.equal(settings.zhenzhenImageG25NsfwCheck, sent.nsfw_check);
      assert.equal(settings.zhenzhenImageG25OutputFormat, undefined);
    }
    if (family === 'qwen') assert.equal((settings.qwenNegativePrompt as string).trim(), sent.negative_prompt);
    assert.equal('taskId' in settings, false); assert.equal('apiKey' in settings, false);
  });
}

test('legacy MJ archived scalars match real prompt builder and submit while references remain outside scalar settings', async () => {
  const h = pathHarness('mj-legacy');
  Object.assign(h.scope, { mjVersion: 'v 8.1', mjAr: '16:9', mjC: 10, mjS: 150, mjIw: 2, mjSw: 120, mjSv: '2',
    mjNo: 'blur', mjSeed: 0, mjSpeed: 'relax', mjMaxPoll: 200, mjPollInt: 4,
    mjSrefImages: ['/files/input/style.png'], mjOrefImages: ['/files/input/person.png'], buildMjPrompt });
  let sent: any;
  h.scope.submitMjImagine = async (payload: any) => { sent = structuredClone(payload); return { taskId: 'fixture-task' }; };
  const context = h.capture(); await h.execute();
  const settings = historyImageBasicSettings({ historyResolvedInput: context })!;
  for (const [key, parameter] of Object.entries({ mjAr: 'ar', mjC: 'c', mjS: 's', mjIw: 'iw', mjSw: 'sw', mjSv: 'sv', mjNo: 'no', mjSpeed: 'speed' })) {
    assert.equal(settings[key], sent[parameter], key);
  }
  assert.equal(settings.mjSeed, 0); assert.equal(sent.seed, undefined);
  assert.equal(settings.mjMaxPoll, 200); assert.equal(settings.mjPollInt, 4);
  assert.equal(sent.prompt, buildMjPrompt({ prompt: context.prompt, model: settings.mjVersion as string,
    ar: settings.mjAr as string, c: settings.mjC as number, s: settings.mjS as number, iw: settings.mjIw as number,
    sw: settings.mjSw as number, sv: settings.mjSv as string, no: settings.mjNo as string,
    srefUrls: h.scope.mjSrefImages, orefUrls: h.scope.mjOrefImages }));
  for (const key of ['mjSrefImages', 'mjOrefImages', 'taskId', 'mjNzSourceTaskId', 'mjNzLastTaskId']) assert.equal(key in settings, false);
});
