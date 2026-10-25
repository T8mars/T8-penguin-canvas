import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { captureMotionInput, createMotionVersion, mergeMotionVersions, motionDefaults, motionOutputPatch, motionScenes, motionAssetRefs, motionSlotVideos, readMotionPending, type MotionResult } from '../src/utils/motionVideo.ts';
import { shouldCollectNodeTextOutput } from '../src/utils/imageNodeOutputMode.ts';
import { captureGenerationHistoryInput } from '../src/utils/generationHistoryCapture.ts';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery.ts';
import { selectSingleSourceHandleData } from '../src/utils/sourceHandleData.ts';
import { executeMotionVideo } from '../src/utils/executeMotionVideo.ts';
import { workflowManifestToFragment } from '../src/utils/workflowResource.ts';
import { collectRunPreflightCapabilityDiagnostics } from '../src/utils/runPreflightContext.ts';
import { collectUpstreamMaterials } from '../src/components/nodes/useUpstreamMaterials.ts';
import { isConnectionValid } from '../src/config/portTypes.ts';
const require = createRequire(import.meta.url);
const { normalizeRunRecoveryDescriptor, recoveryRequest } = require('../backend/src/services/runRecovery.js');
const { completeSnapshot, resolvedHistoryPrompt } = require('../backend/src/services/generationHistoryInputs.js');
const { providerDeclarationForNode } = require('../backend/src/collaboration/runIntentAuthority.js');
const connectionRef = `seedance-nz:${'a'.repeat(64)}`;
const result: MotionResult = { schema: 't8-motion-video-result-v1', taskId: 'own-task', connectionRef, model: motionDefaults.model,
  storyboard: { scenes: [{ title: 'A', duration: 4 }, { title: 'B', duration: 11 }] }, fallbackScenes: ['scene-A'], warnings: [] };
const input = captureMotionInput({ ...motionDefaults, prompt: 'original', motionKeywords: 'one,two\none,two\n三' });
const base = createMotionVersion(input, result, ['/files/output/first.mp4']);
test('capture freezes upstream text and ordered keywords; generating strips stale revision', () => {
  const data = { ...motionDefaults, prompt: 'local', motionKeywords: 'one,two\none,two\n三', motionBaseVersionId: 'stale', motionRevisionInstruction: 'stale' };
  const value = captureMotionInput(data, 'upstream');
  data.prompt = 'later'; assert.equal(value.prompt, 'upstream');
  assert.deepEqual(value.request.motion?.keywords, ['one,two', 'one,two', '三']);
  assert.equal(value.request.motion?.revise_from, undefined);
  assert.throws(() => captureMotionInput({ ...motionDefaults, prompt: '' }));
});
test('revision uses selected completed version specs, base identity and distinct instruction', () => {
  const value = captureMotionInput({ ...motionDefaults, motionVersions: [base], motionBaseVersionId: base.id, motionOperation: 'revise', motionRevisionInstruction: 'B becomes C', duration: 60, prompt: 'draft' }, 'upstream');
  assert.equal(value.request.prompt, 'original'); assert.equal(value.request.duration, 15);
  assert.equal(value.request.motion?.revise_from, result.taskId); assert.equal(value.request.motion?.revision_instruction, 'B becomes C');
  assert.equal(value.request.connectionRef, connectionRef); assert.deepEqual(value.ancestorQuality, [base.id]);
  assert.throws(() => captureMotionInput({ ...motionDefaults, motionOperation: 'revise', motionRevisionInstruction: 'x' }));
});
test('new quality report remains separate from ancestor warnings and previous review', () => {
  const revision = captureMotionInput({ motionVersions: [base], motionBaseVersionId: base.id, motionOperation: 'revise', motionRevisionInstruction: 'change' });
  const next = createMotionVersion(revision, { ...result, taskId: 'revision-task', fallbackScenes: [] }, ['/files/output/second.mp4']);
  assert.deepEqual(next.result.fallbackScenes, []); assert.deepEqual(next.ancestorQuality, [base.id]);
  const versions = mergeMotionVersions([{ ...base, review: 'accepted' }], [base, next]);
  assert.equal(versions.length, 2); assert.equal(versions[0].review, 'accepted');
});
test('named outputs route video and storyboard separately; duplicate video slots survive', () => {
  const output = motionOutputPatch({ ...base, videoUrls: ['/files/output/a.mp4', '/files/output/a.mp4'], assetIds: ['asset-a', 'asset-a'] });
  const video = selectSingleSourceHandleData(output, 'video', 'video') as any;
  assert.deepEqual(video.videoUrls, ['/files/output/a.mp4', '/files/output/a.mp4']);
  assert.deepEqual(video.sourceAssetIds, ['asset-a', 'asset-a']); assert.deepEqual(video.metadata.motionResult, result);
  assert.deepEqual(motionSlotVideos(['/files/output/a.mp4'], motionAssetRefs(video)), ['/files/output/a.mp4', '/files/output/a.mp4']);
  assert.equal(shouldCollectNodeTextOutput('code-animation', { prompt: 'private draft' }), false);
  const text = selectSingleSourceHandleData(output, 'storyboard', 'text') as any;
  assert.match(text.outputText, /scenes/); assert.equal(text.videoUrl, undefined);
  assert.equal(shouldCollectNodeTextOutput('code-animation', text), true);
  assert.deepEqual(motionScenes(result).map(s => [s.start, s.end]), [[0, 4], [4, 15]]);
});
test('history stores exact input without nesting old output histories', () => {
  const node = { id: 'motion', type: 'code-animation', position: { x: 0, y: 0 }, data: { ...motionDefaults, prompt: 'draft', motionVersions: Array(120).fill(base), motionPending: { deeply: { nested: base } } } };
  const capture = captureGenerationHistoryInput([node], [], node.id, input as unknown as Record<string, unknown>);
  assert.equal(capture.complete, true); assert.equal(completeSnapshot(capture, node.id), true);
  if (!capture.complete) throw Error('capture unavailable');
  assert.equal(capture.node.data.motionVersions, undefined); assert.equal(capture.node.data.motionPending, undefined);
  assert.deepEqual(capture.node.data.historyResolvedInput, input); assert.equal(resolvedHistoryPrompt(capture), 'original');
  const upstream = { ...node, data: { ...node.data, ...motionOutputPatch(base) } };
  const target = { id: 'edit', type: 'video-edit', position: { x: 100, y: 0 }, data: {} };
  const downstream = captureGenerationHistoryInput([upstream, target], [{ id: 'video-edge', source: node.id, sourceHandle: 'video', target: target.id }], target.id);
  assert.equal(downstream.complete, true); if (!downstream.complete) throw Error('input incomplete');
  assert.equal(downstream.upstreamNodes[0].data.videoUrl, base.videoUrls[0]);
  assert.equal(downstream.upstreamNodes[0].data.motionVersions, undefined);
});
test('recovery requires exact model and nonsecret connection, and only queries original task', () => {
  const recipe = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: result.model, taskId: 'original-task', connectionRef });
  assert.equal(recipe?.kind, 'motion');
  const stored = normalizeRunRecoveryDescriptor(recipe); assert.equal(stored.connectionRef, connectionRef);
  const request = recoveryRequest('http://127.0.0.1:9999', stored);
  assert.equal(request.options.method, 'GET'); assert.match(request.url, /motion\/status\/original-task\?/);
  assert.equal(new URL(request.url).searchParams.get('model'), result.model);
  assert.equal(normalizeRunRecoveryDescriptor({ ...stored, connectionRef: '' }), null);
  assert.equal(normalizeRunRecoveryDescriptor({ ...stored, model: 'other' }), null);
});
test('production execution submits once and records identity before final asset commit', async () => {
  const originalFetch = globalThis.fetch, calls: string[] = [], events: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method || 'GET'} ${url}`);
    const data = String(url).endsWith('/connection') ? { configured: true, connectionRef }
      : options?.method === 'POST' ? { taskId: result.taskId, model: result.model, connectionRef }
      : { status: 'succeeded', progress: null, model: result.model, connectionRef, motionResult: result, videoUrls: ['/files/output/result.mp4'] };
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const reporter: any = { signal: new AbortController().signal, runContext: { runId: 'run' }, nodeRunId: 'node-run', providerSubmissionKey: 'test-key',
    providerRequest: async () => events.push('request'), providerSubmitted: async () => events.push('submitted'), polling: async () => {}, providerResponse: async () => {}, output: async () => events.push('output') };
  try {
    const output = await executeMotionVideo(input, reporter, { pending: () => events.push('pending'), status: () => {} });
    assert.deepEqual(events, ['request', 'pending', 'submitted', 'output']); assert.equal(calls.filter(c => c.startsWith('POST')).length, 1);
    calls.length = 0; await executeMotionVideo({ ...input, request: { ...input.request, model: 'zhenzhen/motion-video-pro' } }, reporter, { pending: () => {}, status: () => {} }, output.input);
    assert.equal(calls.length, 1); assert.ok(calls[0].startsWith('GET')); assert.match(calls[0], /own-task/);
    assert.equal(new URL(calls[0].slice(4), 'http://localhost').searchParams.get('model'), input.request.model);
  } finally { globalThis.fetch = originalFetch; }
});
test('resuming freezes authority to accepted model and invalid identity never becomes a new generation', () => {
  const pending = { ...input, taskId: result.taskId, connectionRef };
  const node = { id: 'motion', type: 'code-animation', data: { model: 'zhenzhen/motion-video-pro', motionOperation: 'revise', motionPending: pending } };
  assert.equal(providerDeclarationForNode(node).model, input.request.model);
  assert.equal(readMotionPending(pending)?.request.model, input.request.model);
  assert.throws(() => readMotionPending({ ...pending, connectionRef: '' }));
  assert.throws(() => providerDeclarationForNode({ ...node, data: { ...node.data, motionPending: { ...pending, taskId: '' } } }));
});
test('missing key and ambiguous acceptance never cause a second submit', async () => {
  const originalFetch = globalThis.fetch; let posts = 0, configured = false;
  globalThis.fetch = async (_url, options) => {
    if (options?.method === 'POST') { posts++; throw new TypeError('network reset'); }
    return new Response(JSON.stringify({ success: true, data: { configured, connectionRef } }), { headers: { 'content-type': 'application/json' } });
  };
  const reporter: any = { providerRequest: async () => {} };
  try {
    await assert.rejects(executeMotionVideo(input, reporter, { pending: () => {}, status: () => {} }), /API/); assert.equal(posts, 0);
    configured = true;
    await assert.rejects(executeMotionVideo(input, reporter, { pending: () => {}, status: () => {} }), (error: any) => error.motionAcceptanceUnknown === true);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test('all four shipped workflows import as drafts; missing key/base fail before submission', () => {
  const { CASES, workflow } = require('../scripts/generate-motion-video-workflows.cjs');
  const fs = require('node:fs');
  for (const item of CASES) {
    const saved = JSON.parse(fs.readFileSync(new URL(`../docs/workflows/${item.id}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(saved, workflow(item));
    const imported = workflowManifestToFragment(saved)!;
    assert.equal(imported.nodes.length, 3); assert.equal(imported.edges.length, 2);
    const animation = imported.nodes.find(node => node.type === 'code-animation')!;
    for (const edge of imported.edges) assert.equal(isConnectionValid(imported.nodes.find(node => node.id === edge.source), imported.nodes.find(node => node.id === edge.target), edge), true);
    assert.equal(animation.data.model, item.model); assert.equal(animation.data.motionOperation, item.operation);
    assert.doesNotMatch(JSON.stringify(saved), /(?:apiKey|connectionRef|taskId|motionPending|motionVersions|https?:\/\/)/i);
    const diagnostics = collectRunPreflightCapabilityDiagnostics([animation], { advancedProviders: [], zhenzhenSd2ApiKey: '' } as any);
    assert.ok(diagnostics.length > 0);
    if (item.operation === 'revise') assert.throws(() => captureMotionInput(animation.data), /completed animation/);
    else assert.equal(captureMotionInput(animation.data, 'upstream').request.model, item.model);
  }
});
test('real upstream collector keeps storyboard port, ordered duplicate slots and stable asset identity', () => {
  const output = motionOutputPatch({ ...base, videoUrls: ['/files/output/a.mp4', '/files/output/a.mp4'], assetIds: ['asset-a', 'asset-a'] });
  const nodes = [{ id: 'animation', type: 'code-animation', data: { ...output, prompt: 'draft must stay private' } }];
  const collect = (handle: string) => collectUpstreamMaterials(nodes, new Map([['animation', new Set([handle])]]), new Map(), []);
  assert.deepEqual(collect('video').videos.map(item => item.assetId), ['asset-a', 'asset-a']);
  assert.equal(new Set(collect('video').videos.map(item => item.id)).size, 2);
  assert.deepEqual(collect('video').texts, []);
  assert.match(collect('storyboard').texts[0].url, /scenes/); assert.deepEqual(collect('storyboard').videos, []);
  assert.equal(shouldCollectNodeTextOutput('image', { imageOnlyOutput: false }, { imageUrl: 'image' }), true);
});
test('saved-video recovery retries GET after download failure without paid resubmission', async () => {
  const originalFetch = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method || 'GET'} ${url}`);
    return calls.length === 1 ? new Response(JSON.stringify({ success: false, error: 'save temporarily unavailable' }), { status: 502 })
      : new Response(JSON.stringify({ success: true, data: { status: 'succeeded', motionResult: result, videoUrls: ['/files/output/recovered.mp4'] } }));
  };
  const reporter: any = { providerSubmitted: async () => {}, polling: async () => {}, providerResponse: async () => {}, output: async () => {} };
  try {
    const resumed = await executeMotionVideo(input, reporter, { pending: () => assert.fail('Must not submit'), status: () => {} }, { ...input, taskId: result.taskId, connectionRef });
    assert.equal(resumed.result.taskId, result.taskId); assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.startsWith('GET') && call.includes('own-task')));
  } finally { globalThis.fetch = originalFetch; }
});
