import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { assertFreshGenerationCompleted, beginVideoRegeneration, completeVideoRegeneration } from '../src/utils/generationResultRetention.ts';
import { collectRunOutputAssets } from '../src/utils/runProviderTrace.ts';
import { createRunNodeLifecycleController } from '../src/utils/runLifecycle.ts';

const source = readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('VideoNode.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['stopPoll', 'nextGenerationRun', 'isCurrentGenerationRun', 'rejectStoppedGeneration', 'cancelActivePoll', 'startPolling', 'startFalPolling', 'handleGenerate', 'handleStop', 'stopLocalGeneration']);
const declarations: string[] = []; let wrapper = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(tree))) declarations.push(`const ${node.getText(tree)};`);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useRunTrigger') wrapper = node.arguments[1].getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree); assert.equal(declarations.length, names.size); assert.ok(wrapper);
const code = ts.transpileModule(`${declarations.join('\n')}\nreturn {handleGenerate,handleStop,wrapped:${wrapper}};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const factory = new Function('scope', `with(scope) {${code}}`);

// Execute the complete real callback + Run wrapper + polling helpers. Provider
// responses and branch settings are controlled, not live API-contract evidence.
function fixture(branch: 'standard' | 'external' | 'fal-sync' | 'fal-poll') {
  let interval: (() => Promise<void>) | null = null;
  const state: any = { data: { status: 'success', videoUrl: '/old.mp4', videoUrls: ['/old.mp4', '/old2.mp4'], lastPrompt: 'old prompt' }, outputs: [], submissions: 0 };
  const scope: any = Object.fromEntries([...new Set(source.match(/\bis[A-Z]\w+/g))].map(name => [name, false]));
  Object.assign(scope, {
    cancelRunTrigger: () => true,
    savedExternalMissing: false,
    animateImageUrl: '', animateVideoUrl: '',
    id: 'fixture', d: state.data, src: 'fixture', localPrompt: 'new prompt', promptMentions: [], mentionMaterials: [],
    assertFreshGenerationCompleted, beginVideoRegeneration, completeVideoRegeneration, collectRunOutputAssets,
    collectUpstream: () => ({ prompt: '', imageUrls: [], videoUrls: [], audioUrls: [] }), resolveMediaMentions: (prompt: string) => prompt,
    setError() {}, update: (patch: object) => Object.assign(state.data, patch),
    logBus: { debug() {}, warn() {}, error() {}, info() {}, success() {} }, console: { warn() {} },
    taskCompletionSound: { primeAudio() {}, notifyComplete() {} },
    generationRunRef: { current: 0 }, pollTimer: { current: null }, pollRejectRef: { current: null }, falPollRef: { current: null },
    window: { setInterval(fn: () => Promise<void>) { interval = fn; return 1; }, clearInterval() { interval = null; } },
    VIDEO_POLL_INTERVAL_MS: 3000, VIDEO_MAX_POLL: 2, VIDEO_FAL_POLL_INTERVAL_MS: 3000, VIDEO_FAL_MAX_POLL: 2,
    normalizeProviderErrorMessage: (value: any, fallback: string) => value?.message || value || fallback,
    modelDef: { kind: 'grok', maxRefImages: 4, supportImages: false }, apiModel: 'fixture-model', providerParams: {}, ratio: '16:9', duration: 5, resolution: '720p', seed: -1,
    providerSelection: { provider: null }, externalProviderModel: 'fixture-external', maxMentionRefs: 4, maxMentionVideos: 1, maxMentionAudios: 1,
    falReg: { paramKind: 'veo-fal', maxRefImages: 4 }, vfRatio: '16:9', vfDuration: 5, vfResolution: '720p', vfAudio: false, vfSafety: 2,
    submitVideo: async () => { state.submissions++; return { taskId: 'fixture-task' }; },
    generateExternalVideo: async () => { state.submissions++; return { videoUrls: ['/files/output/new.mp4', '/files/output/new2.mp4'] }; },
    submitVideoFal: async () => { state.submissions++; return branch === 'fal-sync' ? { sync: true, videoUrl: '/files/output/new.mp4' } : { requestId: 'fixture-task', endpoint: 'fixture' }; },
    queryVideo: async () => ({ status: 'succeeded', videoUrl: '/files/output/new.mp4' }),
    queryVideoFal: async () => ({ status: 'completed', videoUrl: '/files/output/new.mp4' }),
  });
  if (branch === 'external') Object.assign(scope, { isExternalSelected: true, providerSelection: { provider: { id: 'fixture-provider' } } });
  if (branch.startsWith('fal')) scope.isFal = true;
  Object.defineProperty(scope, 'status', { get: () => state.data.status });
  const callbacks = factory(scope);
  const reporter: any = { providerRequest: async () => {}, providerSubmitted: async () => {}, providerResponse: async () => {}, polling: async () => {},
    output: async (payload: any) => { state.outputs.push(payload); } };
  const start = () => { const promise = callbacks.wrapped(reporter); void promise.catch(() => {}); return promise; };
  const untilPolling = async () => { for (let i = 0; i < 100 && !interval; i++) await Promise.resolve(); assert.ok(interval, 'real callback must reach polling'); };
  const tick = async () => { assert.ok(interval); await interval(); };
  const oldIntact = () => { assert.equal(state.data.videoUrl, '/old.mp4'); assert.deepEqual(state.data.videoUrls, ['/old.mp4', '/old2.mp4']); assert.equal(state.data.lastPrompt, 'old prompt'); };
  return { state, scope, reporter, start, untilPolling, tick, oldIntact, stop: callbacks.handleStop };
}

test('stale video stop cannot invalidate a newer local run or clear its polling context', () => {
  const h = fixture('standard');
  h.scope.cancelRunTrigger = () => false;
  h.scope.falPollRef.current = { requestId: 'newer' };
  const before = structuredClone(h.state.data);
  h.stop();
  assert.equal(h.scope.generationRunRef.current, 0);
  assert.deepEqual(h.scope.falPollRef.current, { requestId: 'newer' });
  assert.deepEqual(h.state.data, before);
});

for (const branch of ['standard', 'external', 'fal-sync', 'fal-poll'] as const) {
  test(`${branch} returns only a fresh completed batch and retains the old preview while pending`, async t => {
    const h = fixture(branch); t.after(h.stop);
    h.reporter.providerRequest = async () => h.oldIntact();
    h.reporter.providerSubmitted = async () => h.oldIntact();
    h.reporter.providerResponse = async () => h.oldIntact();
    const pending = h.start();
    if (branch === 'standard' || branch === 'fal-poll') { await h.untilPolling(); h.oldIntact(); await h.tick(); }
    await pending;
    const urls = branch === 'external' ? ['/files/output/new.mp4', '/files/output/new2.mp4'] : ['/files/output/new.mp4'];
    assert.deepEqual(h.state.data.videoUrls, urls); assert.equal(h.state.data.lastPrompt, 'new prompt');
    assert.equal(h.state.outputs.length, 1); assert.deepEqual(h.state.outputs[0].assets.map((asset: any) => asset.sourceUrl), urls);
  });
  test(`${branch} validation and busy attempts cannot archive old output as success`, async t => {
    const h = fixture(branch); t.after(h.stop); h.scope.localPrompt = '';
    await assert.rejects(h.start()); h.oldIntact(); assert.equal(h.state.outputs.length, 0);
    h.scope.localPrompt = 'new prompt'; h.state.data.status = 'polling';
    await assert.rejects(h.start()); assert.equal(h.state.submissions, 0);
  });
  test(`${branch} stopped during the initial receipt never submits a remote task`, async t => {
    const h = fixture(branch); t.after(h.stop); h.reporter.providerRequest = async () => h.stop();
    await assert.rejects(h.start()); assert.equal(h.state.submissions, 0); h.oldIntact();
  });
  test(`${branch} submission failure rejects and preserves the prior batch`, async t => {
    const h = fixture(branch); t.after(h.stop);
    for (const name of ['submitVideo', 'submitVideoFal', 'generateExternalVideo']) h.scope[name] = async () => { throw new Error('fixture submission failed'); };
    await assert.rejects(h.start(), /fixture submission failed/); h.oldIntact(); assert.equal(h.state.outputs.length, 0);
  });
  test(`${branch} stop during final receipt never replaces the old batch`, async t => {
    const h = fixture(branch); t.after(h.stop); h.reporter.providerResponse = async () => h.stop();
    const pending = h.start();
    if (branch === 'standard' || branch === 'fal-poll') { await h.untilPolling(); await h.tick(); }
    await assert.rejects(pending); h.oldIntact(); assert.equal(h.state.outputs.length, 0);
  });
  test(`${branch} owning Run abort before submission stays idle and preserves old results`, async t => {
    const h = fixture(branch); t.after(h.stop); const controller = new AbortController(); h.reporter.signal = controller.signal;
    h.scope.cancelRunTrigger = () => false; // global cancellation has already retired the UI token
    h.reporter.providerRequest = async () => controller.abort();
    await assert.rejects(h.start()); h.oldIntact(); assert.equal(h.state.submissions, 0); assert.equal(h.state.data.status, 'idle');
  });
  test(`${branch} durable output rejection fails execution without claiming the new preview was archived`, async t => {
    const h = fixture(branch); t.after(h.stop);
    const lifecycle = createRunNodeLifecycleController({ runContext: null, executionToken: 'video-receipt-test',
      sink: { async write(type) { if (type === 'node.output') throw new Error('fixture output rejected'); } } });
    Object.assign(h.reporter, lifecycle.reporter);
    const pending = h.start();
    if (branch === 'standard' || branch === 'fal-poll') { await h.untilPolling(); await h.tick(); }
    await assert.rejects(pending, /fixture output rejected/); await assert.rejects(lifecycle.flush(), /fixture output rejected/);
    assert.equal(lifecycle.outputEmitted(), false); assert.equal(h.state.data.videoUrl, '/files/output/new.mp4');
  });
  test(`${branch} completed Run abort listener cannot stop later node work`, async t => {
    const h = fixture(branch); t.after(h.stop); const controller = new AbortController(); h.reporter.signal = controller.signal;
    const pending = h.start();
    if (branch === 'standard' || branch === 'fal-poll') { await h.untilPolling(); await h.tick(); }
    await pending; h.state.data.status = 'polling'; controller.abort();
    assert.equal(h.state.data.status, 'polling');
  });
}

const routed = [
  { name: 'apimart', submit: 'submitSeedance', query: 'querySeedance', values: { isApimartBudgetVideo: true } },
  { name: 'seedance25', submit: 'submitSeedance', query: 'querySeedance', values: { isSeedance25: true, seedance25Mode: 't2v', generateAudio: false, returnLastFrame: false } },
  { name: 'flux3', submit: 'submitFlux3', query: 'queryFlux3', values: { isFlux3: true, flux3Mode: 't2v', flux3Duration: 5, flux3Resolution: 'hd', flux3Draft: false, flux3AudioMode: 'api_default', flux3SafetyTolerance: 'api_default' } },
  { name: 'wan27', submit: 'submitWan', query: 'queryWan', images: true, values: { isWan: true, wanPromptExtend: false, wanNegativePrompt: '', wanAudioUrl: '', wanSeed: -1 } },
  { name: 'wan30', submit: 'submitWan', query: 'queryWan', values: { isWan: true, isWan30: true, wan30Mode: 'r2v', wan30FileUrl: '', wan30LinkUrl: '', wan30SupportsThinking: false, generateAudio: false, wan30Seed: -1 } },
  { name: 'hailuo', submit: 'submitHailuo', query: 'queryHailuo', values: { isHailuo: true, hailuoMode: 't2v', hailuoDuration: 5 } },
  { name: 'minimax-v2', submit: 'submitHailuo', query: 'queryHailuo', values: { isHailuo: true, isMinimaxH3V2: true, hailuoMode: 't2v', hailuoDuration: 5, minimaxH3FirstFrameEnabled: false, minimaxH3LastFrameEnabled: false, minimaxH3DriveAudioEnabled: false, minimaxH3AudioMode: 'api_default', minimaxH3AddDriveAsReference: 'api_default', minimaxH3DenoiseStrength: 0, minimaxH3VideoStartSeconds: [], MINIMAX_H3_V2_MODEL: 'MiniMax-H3' } },
  { name: 'kling', submit: 'submitKling', query: 'queryKling', values: { isKling: true, klingMode: 't2v', klingDuration: 5, klingNegativePrompt: '' } },
  { name: 'vosr2', submit: 'submitVosr2Video', query: 'queryVosr2Video', video: true, values: { isUpscaler: true, isVosr2: true, VOSR2_VIDEO_UPSCALE_MODEL: 'vosr2-video-upscale' } },
  { name: 'flashvsr', submit: 'submitFashVsr', query: 'queryFashVsr', video: true, values: { isUpscaler: true, isFashVsr: true, FASHVSR_VIDEO_UPSCALE_MODEL: 'fixture-flashvsr' } },
  { name: 'upscaler', submit: 'submitUpscaler', query: 'queryUpscaler', video: true, values: { isUpscaler: true } },
  { name: 'vidu', submit: 'submitVidu', query: 'queryVidu', values: { isVidu: true, viduMode: 't2v', viduDuration: 5, viduResolution: '720p', viduRatio: '16:9', viduSeed: -1 } },
  { name: 'happyhorse', submit: 'submitHappyHorse', query: 'queryHappyHorse', values: { isHappyHorse: true, happyHorseMode: 't2v' } },
];
for (const route of routed) {
  for (const mode of ['success', 'stopped', 'failed'] as const) {
    test(`${route.name} actual submission-to-polling ${mode} preserves prompt and batch boundaries`, async t => {
      const h = fixture('standard'); t.after(h.stop); Object.assign(h.scope, route.values);
      h.scope.collectUpstream = () => ({ prompt: '', imageUrls: route.images ? ['/files/output/ref.png'] : [], videoUrls: route.video ? ['/files/output/ref.mp4'] : [], audioUrls: [] });
      h.scope[route.submit] = async () => { h.state.submissions++; return { taskId: 'fixture-routed' }; };
      h.scope[route.query] = async () => mode === 'failed' ? { status: 'failed', failReason: 'fixture failed' } : { status: 'succeeded', videoUrl: '/files/output/routed.mp4' };
      h.reporter.providerSubmitted = async () => { h.oldIntact(); if (mode === 'stopped') h.stop(); };
      const pending = h.start();
      if (mode !== 'stopped') { await h.untilPolling(); h.oldIntact(); await h.tick(); }
      if (mode === 'success') {
        await pending; assert.equal(h.state.outputs.length, 1);
        assert.deepEqual(h.state.outputs[0].assets.map((asset: any) => asset.sourceUrl), ['/files/output/routed.mp4']);
        assert.equal(h.state.data.lastPrompt, route.video ? '' : 'new prompt');
      } else { await assert.rejects(pending); h.oldIntact(); assert.equal(h.state.outputs.length, 0); }
      assert.equal(h.state.submissions, 1);
    });
  }
}
