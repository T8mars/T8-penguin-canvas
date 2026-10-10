import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { VIDEO_MODELS, TOPAZ_VIDEO_CONTRACT as contract, videoModelsForSource, inferVideoBuiltinSource } from '../src/providers/models';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { historyVideoBasicSettings } from '../src/utils/historyVideoBasicSettings';
import { prepareHistorySettingsDraft } from '../src/utils/generationHistorySettings';
import { submitTopazVideo, queryTopazVideo } from '../src/services/generation';
import historyContract from '../backend/src/shared/generationHistoryInputContract.json';
const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz');
const recovery = require('../backend/src/services/runRecovery');
const authority = require('../backend/src/collaboration/runIntentAuthority');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const video = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';
const sourceUrl = 'https://cdn.example.test/input.mp4';
const base = { model: contract.model, videos: [video] };
const options = { uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async () => json({ url: sourceUrl }) };

test('Topaz is a separate budget-only tab, with no legacy default or local Topaz node change', () => {
  const model = VIDEO_MODELS.find((item) => item.id === contract.model)!;
  assert.equal(model.label, 'Topaz');
  assert.equal(model.kind, 'upscaler');
  assert.deepEqual(model.resolutions, ['720p', '1080p', '2K', '4K']);
  assert.equal(model.defaultResolution, '1080p');
  assert.equal(VIDEO_MODELS[0].id, 'grok-video-3');
  assert.ok(!videoModelsForSource('zhenzhen').some((item) => item.id === contract.model));
  assert.equal(inferVideoBuiltinSource(contract.model), 'seedance-nz');
  assert.deepEqual(model.ratios, []);
  assert.deepEqual(model.durations, []);
});

for (const resolution of contract.resolutions) for (const quality of contract.qualities) {
  test(`Topaz exact whitelist: ${resolution}/${quality}`, async () => {
    const built = await provider.buildTopazVideoPayload({ ...base, resolution, quality, prompt: 'ignored', seed: 3,
      duration: 5, ratio: '16:9', images: ['ignored'], metadata: { content: ['ignored'] } }, 'fixture-key', options);
    assert.deepEqual(built.payload, { model: contract.model, metadata: { video_url: [sourceUrl], resolution, quality } });
    assert.equal(built.taskType, 'upscale');
  });
}
test('Topaz defaults are Max/1080p and invalid scalars/duplicate sources fail before upload', async () => {
  const built = await provider.buildTopazVideoPayload(base, 'fixture-key', options);
  assert.equal(built.payload.metadata.quality, 'Max');
  assert.equal(built.payload.metadata.resolution, '1080p');
  let calls = 0;
  for (const change of [{ model: contract.model.toLowerCase() }, { quality: 'max' }, { resolution: '2k' },
    { resolution: '' }, { quality: '' }, { videos: [] }, { videos: [video, video] }]) {
    await assert.rejects(provider.buildTopazVideoPayload({ ...base, ...change }, 'fixture-key', {
      ...options, fetchImpl: async () => { calls++; return json({ url: sourceUrl }); },
    }));
  }
  assert.equal(calls, 0);
});
test('Topaz enforces MP4 MIME/magic and 50 MiB upload limit, without fake duration/resolution limits', async () => {
  let calls = 0;
  for (const invalid of ['data:video/webm;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=', 'data:video/mp4;base64,aW52YWxpZCB2aWRlbyBkYXRh',
    `data:video/mp4;base64,${Buffer.alloc(contract.maxUploadBytes + 1).toString('base64')}`]) {
    await assert.rejects(provider.buildTopazVideoPayload({ ...base, videos: [invalid] }, 'fixture-key', {
      ...options, fetchImpl: async () => { calls++; return json({ url: sourceUrl }); },
    }));
  }
  assert.equal(calls, 0);
});
test('Topaz direct public URL is forwarded without download/upload; malformed and literal private targets are rejected', async () => {
  let uploads = 0;
  const opts = { ...options, fetchImpl: async () => { uploads++; throw new Error('URL must not upload'); } };
  const result = await provider.buildTopazVideoPayload({ ...base, videos: [sourceUrl] }, 'fixture-key', opts);
  assert.deepEqual(result.payload.metadata.video_url, [sourceUrl]);
  for (const source of ['https://', 'https://[invalid', 'http://127.0.0.1/a.mp4', 'http://[::1]/a.mp4',
    'https://localhost/a.mp4', 'https://router.local/a.mp4', 'https://user:secret@example.com/a.mp4']) {
    await assert.rejects(provider.buildTopazVideoPayload({ ...base, videos: [source] }, 'fixture-key', opts));
  }
  assert.equal(uploads, 0);
});
test('Topaz submits once to legacy route and preserves original model/trace', async () => {
  let posts = 0;
  const result = await provider.submitTopazVideoTask(base, 'fixture-key', { ...options, fetchImpl: async (url: string, init: any) => {
    if (url.endsWith('/upload')) return json({ url: sourceUrl });
    assert.ok(url.endsWith(contract.submitPath));
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer fixture-key');
    assert.deepEqual(JSON.parse(init.body), { model: contract.model, metadata: { video_url: [sourceUrl], resolution: '1080p', quality: 'Max' } });
    posts++;
    return json({ data: { task_id: 'fixture-task' } });
  } });
  assert.equal(posts, 1);
  assert.equal(result.taskId, 'fixture-task');
  assert.equal(result.model, contract.model);
  assert.equal(result.upstreamHttpStatus, 200);
});
test('ambiguous 502 and connection reset never replay Topaz generation POST', async () => {
  for (const failure of ['502', 'reset']) {
    let posts = 0;
    await assert.rejects(provider.submitTopazVideoTask(base, 'fixture-key', { ...options, fetchImpl: async (url: string) => {
      if (url.endsWith('/upload')) return json({ url: sourceUrl });
      posts++;
      if (failure === 'reset') throw new Error('ECONNRESET');
      return json({ error: { message: 'fixture ambiguous failure' } }, 502);
    } }));
    assert.equal(posts, 1);
  }
});
test('Topaz documented envelopes, ordered duplicate full outputs and terminal states', async () => {
  const a = 'https://cdn.example.test/a.mp4';
  const b = 'https://cdn.example.test/b.mp4';
  for (const body of [{ data: { status: 'SUCCESS', result_url: a } },
    { data: { status: 'SUCCESS', result_url: b, data: { content: { video_urls: [a, a, b] } } } },
    { status: 'completed', video_url: b, metadata: { video_urls: [a, a, b] } }]) {
    const result = await provider.queryTopazVideoTask('fixture/task', 'fixture-key', { fetchImpl: async (url: string) => {
      assert.ok(url.endsWith('/v1/video/generations/fixture%2Ftask'));
      return json(body);
    } });
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.videoUrls, 'video_url' in body || (body as any).data?.data ? [a, a, b] : [a]);
    assert.equal(result.videoUrl, a);
  }
  for (const [status, normalized] of [['PROCESSING', 'running'], ['FAILURE', 'failed'], ['CANCELLED', 'failed']]) {
    const result = await provider.queryTopazVideoTask('fixture-task', 'fixture-key', { fetchImpl: async () => json({ data: { status, result_url: a } }) });
    assert.equal(result.status, normalized);
    assert.deepEqual(result.videoUrls, []);
  }
});
test('Topaz recovery is a fixed original-task GET with >=15 minutes and every video output', () => {
  const descriptor = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model: contract.model, taskId: 'fixture/task', pollLimit: 1 })!;
  assert.equal(descriptor.kind, 'topaz');
  assert.ok(descriptor.maxPolls! * descriptor.pollIntervalMs! >= 900000);
  const request = recovery.recoveryRequest('http://127.0.0.1', descriptor);
  assert.match(request.url, /\/api\/proxy\/video\/topaz\/status\/fixture%2Ftask$/);
  assert.equal(request.options.method, 'GET');
  const result = recovery.normalizeRecoveryPayload({ data: { status: 'succeeded', videoUrl: '/outputs/a.mp4', videoUrls: ['/outputs/a.mp4', '/outputs/a.mp4', '/outputs/b.mp4'] } }, descriptor);
  assert.deepEqual(result.outputs.map((item: any) => item.sourceUrl), ['/outputs/a.mp4', '/outputs/a.mp4', '/outputs/b.mp4']);
  assert.ok(result.outputs.every((item: any) => item.kind === 'video'));
});
test('both credential-free workflows import through production parser and resolve authoritative provider/preflight', () => {
  for (const mode of ['local', 'url']) {
    const text = readFileSync(new URL(`../docs/workflows/topaz-video-${mode}.json`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /sk-|apiKey|taskId|https?:|resultUrl|signed/i);
    const fragment = workflowManifestToFragment(JSON.parse(text))!;
    assert.ok(fragment);
    const node = fragment.nodes.find((item) => item.id === 'generation')!;
    assert.deepEqual(authority.providerDeclarationForNode(node), { provider: 'seedance-nz', model: contract.model });
    const check = (key: string) => buildRunPreflightDiagnostics({ nodes: [node], edges: [], executionNodeIds: [node.id],
      projectId: 'isolated', settings: { zhenzhenSd2ApiKey: key, zhenzhenApiKey: 'wrong-channel-key', advancedProviders: [] } as any,
      assets: [], providersComplete: true, policy: null });
    assert.ok(!check('fixture-key').capability.some((notice) => notice.ruleId.includes('credential-missing')));
    assert.ok(check('').capability.some((notice) => notice.ruleId === 'provider.seedance-nz-credential-missing'));
  }
});
test('Topaz history preserves explicit quality, never treats source URL as a scalar, and does not invent defaults', () => {
  const basicSettings = { mainId: contract.model, model: contract.model, videoBuiltinSource: 'seedance-nz', ratio: '', resolution: '2K',
    duration: 0, seed: 0, providerSource: 'zhenzhen', providerId: '', providerModel: '', topazQuality: 'High' };
  const input = { schema: historyContract.videoInputContextSchema, origin: 'frontend-common-context', prompt: '',
    localRefImages: [], localRefVideos: [], localRefAudios: [], basicSettings };
  assert.deepEqual(historyVideoBasicSettings({ historyResolvedInput: input }), basicSettings);
  assert.throws(() => historyVideoBasicSettings({ historyResolvedInput: { ...input, basicSettings: { ...basicSettings, topazQuality: 'high' } } }));
  assert.throws(() => historyVideoBasicSettings({ historyResolvedInput: { ...input, basicSettings: { ...basicSettings, topazVideoUrl: sourceUrl } } }));
  const legacy = { ...basicSettings } as any;
  delete legacy.topazQuality;
  assert.ok(!Object.hasOwn(historyVideoBasicSettings({ historyResolvedInput: { ...input, basicSettings: legacy } })!, 'topazQuality'));
  const target: any = { id: 'node', entityUid: 'fixture-entity', type: 'video', data: { ...basicSettings, topazQuality: 'Low', topazVideoUrl: sourceUrl } };
  const scope = { projectId: 'fixture-project', canvasId: 'fixture-canvas' };
  const draft = prepareHistorySettingsDraft({ status: 'available', binding: { ...scope, nodeId: target.id, nodeEntityUid: target.entityUid },
    snapshot: { node: { id: target.id, type: target.type, data: { historyResolvedInput: input } }, upstreamNodes: [], incomingEdges: [] } } as any,
  { snapshotAvailable: true, nodeId: target.id, nodeEntityUid: target.entityUid } as any, target, scope);
  assert.equal(draft.dataPatch.topazQuality, 'High');
  assert.equal(draft.referenceWarning, true);
  assert.ok(!Object.hasOwn(draft.dataPatch, 'topazVideoUrl'));
  assert.ok(!draft.dataUnsetKeys.includes('topazVideoUrl'));
});
test('frontend Topaz service uses fixed endpoints, shared submission identity, cancellation and safe error handling', async () => {
  const prior = globalThis.fetch;
  const controller = new AbortController();
  const calls: any[] = [];
  try {
    globalThis.fetch = (async (url: any, init: any) => { calls.push({ url, init }); return json({ success: true, data: { taskId: 'fixture-task', model: contract.model, taskType: 'upscale' } }); }) as any;
    await submitTopazVideo({ model: 'Topaz-Upscale-LowPirce', videos: ['local'], resolution: '720p', quality: 'Low' }, { submissionKey: 'fixture-submission', signal: controller.signal });
    await queryTopazVideo('fixture/task', { signal: controller.signal });
    assert.equal(calls[0].url, '/api/proxy/video/topaz/submit');
    assert.equal(calls[1].url, '/api/proxy/video/topaz/status/fixture%2Ftask');
    assert.equal(calls[0].init.signal, controller.signal);
    assert.equal(calls[1].init.signal, controller.signal);
    assert.ok(JSON.stringify(calls[0].init.headers).includes('fixture-submission'));
  } finally { globalThis.fetch = prior; }
});
test('actual production Topaz controls capture values before event cleanup and keep queued changes independent', () => {
  const ts = require('typescript');
  const text = readFileSync(new URL('../src/components/nodes/TopazVideoControls.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(text, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  runInNewContext(compiled, { exports: module.exports, module, require: (id: string) => id === 'react-i18next'
    ? { useTranslation: () => ({ t: (key: string) => key }) } : id.endsWith('providers/models') ? { TOPAZ_VIDEO_CONTRACT: contract } : require(id) });
  const pending: any[] = [];
  const tree = module.exports.default({ quality: 'Max', videoUrl: '', update: (patch: any) => pending.push(patch) });
  const controls: any[] = [];
  const visit = (element: any) => {
    if (!element || typeof element !== 'object') return;
    if (['input', 'select'].includes(element.type)) controls.push(element);
    for (const child of [element.props?.children].flat()) visit(child);
  };
  visit(tree);
  assert.equal(controls.length, 2);
  const event: any = { currentTarget: { value: 'Ultra' } };
  controls[0].props.onChange(event);
  event.currentTarget = null;
  controls[0].props.onChange({ currentTarget: { value: 'Low' } });
  controls[1].props.onChange({ currentTarget: { value: sourceUrl } });
  assert.equal(pending[0].topazQuality, 'Ultra');
  assert.equal(pending[1].topazQuality, 'Low');
  assert.equal(pending[2].topazVideoUrl, sourceUrl);
});
