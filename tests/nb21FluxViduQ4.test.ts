import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { IMAGE_MODELS, VIDEO_MODELS, NB_FLUX_VIDU_CONTRACT as contract, ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS } from '../src/providers/models';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { workflowManifestToFragment } from '../src/utils/workflowResource';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext';
import { historyImageBasicSettings } from '../src/utils/historyImageBasicSettings';
import { historyVideoBasicSettings } from '../src/utils/historyVideoBasicSettings';
import historyContract from '../backend/src/shared/generationHistoryInputContract.json';
const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const image = 'data:image/png;base64,iVBORw0KGgo=';
const uploads: any[] = [];
const fetchImpl = async (url: string, init: any) => {
  assert.match(url, /\/v1\/files\/upload$/);
  uploads.push(init.body);
  return json({ url: `https://cdn.example.test/upload-${uploads.length}.png` });
};
const options = { fetchImpl, uploadIntervalMs: 0, uploadCacheTtlMs: 0 };

test('new tabs/options are budget-only and preserve original image/video defaults', () => {
  assert.equal(IMAGE_MODELS[0].id, 'gpt-image-2');
  assert.equal(ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS[0].value, 'zhenzhen-image-nb-2');
  assert.ok(ZHENZHEN_BUDGET_BANANA_2_MODEL_OPTIONS.some((m) => m.value === contract.banana21.model));
  assert.ok(!IMAGE_MODELS.find((m) => m.id === 'nano-banana-2')!.apiModelOptions.some((m) => m.value === contract.banana21.model));
  assert.equal(IMAGE_MODELS.find((m) => m.id === contract.flux.model)!.tabLabel, 'Flux');
  const vidu = VIDEO_MODELS.find((m) => m.kind === 'vidu')!;
  assert.equal(vidu.apiModelOptions[0].value, 'vidu-q3-turbo-t2v');
  for (const model of contract.viduQ4.models) {
    const option = vidu.apiModelOptions.find((m) => m.value === model)!;
    assert.ok(option);
    assert.deepEqual(option.durations, contract.viduQ4.durations);
    assert.equal(option.maxRefImages, model.endsWith('-r2v') ? 15 : 1);
  }
});

test('NB 2.1 exact T2I/I2I whitelist, ordered duplicate references and no format or seed', async () => {
  const base = { model: contract.banana21.model, prompt: 'A blue teapot', n: 1, size: 'auto', resolution: '2k', output_format: 'png', seed: 42 };
  const t2i = await provider.buildImagePayload(base, 'test-key', options);
  assert.deepEqual(t2i.payload, { model: base.model, prompt: base.prompt, n: 1, size: 'auto', metadata: { resolution: '2k' } });
  const i2i = await provider.buildImagePayload({ ...base, images: [image, image] }, 'test-key', options);
  assert.equal(i2i.taskType, 'i2i');
  assert.equal(i2i.payload.images.length, 2);
  assert.doesNotMatch(JSON.stringify(i2i.payload), /output_format|seed/);
});

test('NB 2.1 rejects legacy 0.5K/extreme ratios, bad count, short/long prompt and >14 images before upload', async () => {
  const base = { model: contract.banana21.model, prompt: 'A blue teapot', images: [image] };
  for (const change of [{ resolution: '0.5k' }, { size: '1:8' }, { n: 2 }, { prompt: 'blue' }, { prompt: 'x'.repeat(5001) }, { images: Array(15).fill(image) }]) {
    const before = uploads.length;
    await assert.rejects(provider.buildImagePayload({ ...base, ...change }, 'test-key', options));
    assert.equal(uploads.length, before);
  }
  const old = await provider.buildImagePayload({ model: 'zhenzhen-image-nb-2', prompt: 'blue teapot', resolution: '0.5k', size: '1:8' }, 'test-key', options);
  assert.equal(old.payload.metadata.resolution, '0.5k');
});

test('Flux exact field whitelist, all documented ratios/resolutions, boolean false and safety zero preserved', async () => {
  for (const resolution of contract.flux.resolutions) {
    for (const ratio of contract.flux.ratios) {
      const built = await provider.buildImagePayload({ model: contract.flux.model, prompt: 'blue teapot', resolution, aspect_ratio: ratio,
        grounding: false, safety_tolerance: 0, output_format: 'png', seed: 8 }, 'test-key', options);
      assert.deepEqual(built.payload, { model: contract.flux.model, prompt: 'blue teapot', n: 1, resolution, aspect_ratio: ratio, grounding: false, safety_tolerance: 0 });
    }
  }
  for (const change of [{ resolution: '0.5k' }, { aspect_ratio: '1:8' }, { n: 2 }, { safety_tolerance: 5 }, { safety_tolerance: 1.1 }, { images: Array(11).fill(image) }]) {
    const before = uploads.length;
    await assert.rejects(provider.buildImagePayload({ model: contract.flux.model, prompt: 'blue teapot', ...change }, 'test-key', options));
    assert.equal(uploads.length, before);
  }
});

for (const model of contract.viduQ4.models) {
  test(`${model}: exact Q4 fields, legacy endpoints, prompt/media mode and ordered references`, async () => {
    const r2v = model.endsWith('-r2v');
    const request = { model, prompt: r2v ? 'A blue teapot rotates' : '', images: [image], duration: 3, resolution: '540p',
      ratio: '16:9', generateAudio: false, isRec: false, watermark: true, seed: 55,
      ...(r2v ? {} : { audios: ['ignored-hidden-audio'], ratio: 'adaptive' }) };
    const built = await provider.buildViduPayload(request, 'test-key', options);
    assert.deepEqual(built.payload.metadata, { resolution: '540p', generate_audio: false, is_rec: false, watermark: true, ...(r2v ? { ratio: '16:9' } : {}) });
    assert.equal(built.payload.seconds, '3');
    assert.equal('prompt' in built.payload, r2v);
    assert.doesNotMatch(JSON.stringify(built.payload), /seed|script_name|asset_list/);
    const submitted = await provider.submitViduTask(request, 'test-key', { ...options, fetchImpl: async (url: string) => {
      if (url.endsWith('/upload')) return json({ url: 'https://cdn.example.test/image.png' });
      assert.ok(url.endsWith('/v1/video/generations'));
      return json({ data: { task_id: 'fixture-task' } });
    } });
    assert.equal(submitted.taskId, 'fixture-task');
    const queried = await provider.queryViduTask('fixture-task', 'test-key', { model, fetchImpl: async (url: string) => {
      assert.ok(url.endsWith('/v1/video/generations/fixture-task'));
      return json({ data: { status: 'SUCCESS', data: { content: { video_url: 'https://cdn.example.test/video.mp4' } } } });
    } });
    assert.equal(queried.status, 'succeeded');
    assert.equal(queried.videoUrl, 'https://cdn.example.test/video.mp4');
  });
}

test('Q4 invalid references/scalars fail before uploading; R2V allows 15 slots without truncation', async () => {
  const base = { model: 'vidu-q4-preview-r2v', prompt: 'A blue teapot rotates', images: [image] };
  for (const change of [{ prompt: '' }, { images: [] }, { images: Array(16).fill(image) }, { audios: Array(4).fill('audio') }, { duration: 2 }, { duration: 3.5 }, { resolution: 'default' }, { ratio: 'adaptive' }, { videos: ['video'] }, { model: 'vidu-q4-preview-i2v', images: [image, image] }]) {
    const before = uploads.length;
    await assert.rejects(provider.buildViduPayload({ ...base, ...change }, 'test-key', options));
    assert.equal(uploads.length, before);
  }
  const built = await provider.buildViduPayload({ ...base, images: Array(15).fill(image) }, 'test-key', options);
  assert.equal(built.payload.images.length, 15);
});

test('new image/video models infer original-task recovery, never a fresh submit', () => {
  const { recoveryRequest } = require('../backend/src/services/runRecovery');
  for (const model of [contract.banana21.model, contract.flux.model, ...contract.viduQ4.models]) {
    const recovery = inferRunRecoveryDescriptor({ provider: 'seedance-nz', model, taskId: 'fixture-task' });
    assert.equal(recovery?.kind, model.startsWith('vidu') ? 'vidu' : 'seedream-nz');
    assert.equal(recovery?.model, model);
    assert.ok(recovery!.maxPolls! * recovery!.pollIntervalMs! >= 900000);
    if (model.startsWith('vidu')) {
      const request = recoveryRequest('http://127.0.0.1', recovery);
      assert.equal(new URL(request.url).searchParams.get('model'), model);
      assert.equal(request.options.method, 'GET');
    }
  }
});

test('all eight saved workflows import through production parser with exact authority/channel and no credentials', () => {
  const { CASES } = require('../scripts/verify-nb21-flux-viduq4-live.cjs');
  const authority = require('../backend/src/collaboration/runIntentAuthority');
  for (const item of CASES) {
    const text = fs.readFileSync(new URL(`../docs/workflows/${item.id}.json`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /sk-|apiKey|taskId|https?:|imageUrls|signed/i);
    const fragment = workflowManifestToFragment(JSON.parse(text))!;
    assert.ok(fragment);
    const generation = fragment.nodes.find((node) => node.id === 'generation')!;
    assert.deepEqual(authority.providerDeclarationForNode(generation, fragment), { provider: 'seedance-nz', model: item.model });
    assert.equal(fragment.edges.length, JSON.parse(text).edgeCount);
    assert.equal(generation.data.reuseResult, false);
    const settings: any = { zhenzhenApiKey: '', zhenzhenSd2ApiKey: 'budget-key', advancedProviders: [] };
    const check = (value: any) => buildRunPreflightDiagnostics({ nodes: [generation], edges: [],
      executionNodeIds: [generation.id], projectId: 'isolated', settings: value, assets: [], providersComplete: true, policy: null });
    assert.equal(check(settings).capability.filter((notice) => notice.ruleId.includes('credential-missing')).length, 0);
    const missing = check({ ...settings, zhenzhenApiKey: 'workshop-key', zhenzhenSd2ApiKey: '' });
    assert.ok(missing.capability.some((notice) => notice.ruleId === 'provider.seedance-nz-credential-missing'));
  }
});

test('Q4 R2V production uploader genuinely encodes WAV as MP3 and keeps ordered duplicate audio slots', async () => {
  const { resolveBundledFfmpeg } = require('../backend/src/providers/llmMedia');
  const wav = execFileSync(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-threads', '1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-f', 'wav', 'pipe:1'], { windowsHide: true, timeout: 30000 });
  const audio = `data:audio/wav;base64,${wav.toString('base64')}`;
  let audios = 0;
  const built = await provider.buildViduPayload({ model: 'vidu-q4-preview-r2v', prompt: 'Penguin waves', images: [image], audios: [audio, audio] }, 'test-key', {
    uploadIntervalMs: 0, uploadCacheTtlMs: 0, fetchImpl: async (_url: string, init: any) => {
      const file = init.body.get('file');
      if (file.type === 'audio/mpeg') {
        audios++;
        assert.match(file.name, /\.mp3$/);
        const bytes = Buffer.from(await file.arrayBuffer());
        assert.equal(bytes.subarray(0, 3).toString(), 'ID3');
        assert.notEqual(bytes.subarray(0, 4).toString(), 'RIFF');
        execFileSync(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-f', 'mp3', '-i', 'pipe:0', '-f', 'null', '-'],
          { input: bytes, windowsHide: true, timeout: 30000 });
      }
      return json({ url: `https://cdn.example.test/${file.type === 'audio/mpeg' ? `audio-${audios}.mp3` : 'image.png'}` });
    },
  });
  assert.equal(audios, 2);
  assert.deepEqual(built.payload.metadata.audio_urls, ['https://cdn.example.test/audio-1.mp3', 'https://cdn.example.test/audio-2.mp3']);
});

test('history retains explicit Flux/Q4 options without inventing absent defaults or accepting malformed values', () => {
  const imageSettings = { model: 'flux-3-image', apiModel: 'flux-3-image', aspectRatio: 'auto', sizeLevel: '768sq',
    imageBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '',
    fluxImageGrounding: false, fluxImageSafetyTolerance: 0 };
  const imageInput: any = { schema: historyContract.imageSettingsContextSchema, origin: 'frontend-common-context',
    prompt: 'Penguin', referenceImages: [], basicSettings: imageSettings };
  assert.deepEqual(historyImageBasicSettings({ historyResolvedInput: imageInput }), imageSettings);
  for (const invalid of [-1, 5, 0.5, '0', Infinity]) {
    assert.throws(() => historyImageBasicSettings({ historyResolvedInput: { ...imageInput, basicSettings: { ...imageSettings, fluxImageSafetyTolerance: invalid } } }));
  }
  const videoSettings = { mainId: 'vidu-q3', model: 'vidu-q4-preview-r2v', ratio: '1:1', duration: 3, resolution: '540p', seed: 0,
    videoBuiltinSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: '', generateAudio: false,
    viduQ4IsRec: false, viduQ4Watermark: true };
  const videoInput: any = { schema: historyContract.videoInputContextSchema, origin: 'frontend-common-context',
    prompt: 'Penguin waves', localRefImages: [], localRefVideos: [], localRefAudios: [], basicSettings: videoSettings };
  assert.deepEqual(historyVideoBasicSettings({ historyResolvedInput: videoInput }), videoSettings);
  const legacy = { ...videoSettings } as Record<string, unknown>;
  delete legacy.viduQ4IsRec; delete legacy.viduQ4Watermark;
  const restored = historyVideoBasicSettings({ historyResolvedInput: { ...videoInput, basicSettings: legacy } })!;
  assert.equal(Object.hasOwn(restored, 'viduQ4IsRec'), false);
  assert.throws(() => historyVideoBasicSettings({ historyResolvedInput: { ...videoInput, basicSettings: { ...videoSettings, viduQ4IsRec: 'false' } } }));
});
