import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEEDANCE25_VIDEO_MODELS, VIDEO_MODELS, videoModelOptionsForSource } from '../src/providers/models.ts';
import {
  SEEDANCE25_DURATION_OPTIONS,
  SEEDANCE25_DEFAULT_DURATION,
  SEEDANCE25_DEFAULT_RESOLUTION,
  SEEDANCE25_MULTI_MAX_AUDIOS,
  SEEDANCE25_MULTI_MAX_IMAGES,
  SEEDANCE25_MULTI_MAX_TOTAL,
  SEEDANCE25_MULTI_MAX_VIDEOS,
  SEEDANCE25_MODEL_OPTIONS,
  SEEDANCE25_RESOLUTION_OPTIONS,
  seedance25TaskType,
} from '../src/config/seedance.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const root = join(import.meta.dirname, '..');
const workflow = (model: string) => JSON.parse(readFileSync(join(root, 'docs', 'workflows', `${model}.json`), 'utf8'));

const MODELS = [
  'seedance-2.5-global-standard-i2v',
  'seedance-2.5-global-standard-multi',
  'seedance-2.5-global-standard-t2v',
  'seedance-2.5-standard-i2v',
  'seedance-2.5-standard-multi',
  'seedance-2.5-standard-t2v',
] as const;
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';
const AUDIO = 'data:audio/wav;base64,UklGRgQAAABXQVZF';

const uploadFetch = async (_url: string, init?: RequestInit) => {
  const form = init?.body as FormData;
  const file = form.get('file') as File;
  const suffix = file.type.startsWith('image/') ? 'png' : file.type.startsWith('video/') ? 'mp4' : 'wav';
  return new Response(JSON.stringify({ url: `https://cdn.example.com/reference.${suffix}` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

test('Seedance 2.5 preserves six standalone models and appends two draft enhancement models to the Video tab', () => {
  assert.deepEqual(SEEDANCE25_MODEL_OPTIONS.map((item) => item.value), MODELS);
  assert.deepEqual(SEEDANCE25_VIDEO_MODELS, [...MODELS, ...require('../backend/src/shared/seedream55DraftContract.json').draftModels]);
  assert.deepEqual(SEEDANCE25_RESOLUTION_OPTIONS, ['480p', '720p', '1080p', '2k', '4k', 'native1080p']);
  assert.deepEqual(
    [SEEDANCE25_MULTI_MAX_IMAGES, SEEDANCE25_MULTI_MAX_VIDEOS, SEEDANCE25_MULTI_MAX_AUDIOS, SEEDANCE25_MULTI_MAX_TOTAL],
    [30, 10, 10, 50],
  );
  assert.deepEqual(provider.SEEDANCE25_MULTI_LIMITS, { images: 30, videos: 10, audios: 10, total: 50 });
  assert.equal(SEEDANCE25_DURATION_OPTIONS[0], -1);
  assert.equal(SEEDANCE25_DEFAULT_DURATION, 5);
  assert.equal(SEEDANCE25_DEFAULT_RESOLUTION, '720p');
  assert.deepEqual(SEEDANCE25_DURATION_OPTIONS.slice(1), Array.from({ length: 27 }, (_, index) => index + 4));

  const tab = VIDEO_MODELS.find((item) => item.id === 'seedance-2.5');
  assert.ok(tab);
  assert.equal(tab.kind, 'seedance25');
  assert.equal(tab.builtinSource, 'seedance-nz');
  assert.equal(tab.defaultRatio, 'adaptive');
  assert.equal(tab.defaultDuration, 5);
  assert.equal(tab.defaultResolution, '720p');
  assert.deepEqual(videoModelOptionsForSource(tab, 'seedance-nz').map((item) => item.value), [...MODELS, ...require('../backend/src/shared/seedream55DraftContract.json').draftModels]);
  assert.equal(videoModelOptionsForSource(tab, 'seedance-nz')[0].defaultRatio, 'adaptive');
  assert.equal(seedance25TaskType(MODELS[0]), 'i2v');
  assert.equal(seedance25TaskType(MODELS[1]), 'multi');
  assert.equal(seedance25TaskType(MODELS[2]), 't2v');
});

test('Seedance 2.5 payloads follow exact t2v, i2v and multi request shapes', async () => {
  const defaults = await provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v',
    prompt: 'Official defaults',
    ratio: '16:9',
  }, 'test-key');
  assert.equal(defaults.payload.seconds, '5');
  assert.equal(defaults.payload.metadata.resolution, '720p');

  const t2v = await provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v',
    prompt: 'A paper airplane crosses a white studio',
    duration: 30,
    ratio: '16:9',
    resolution: '4k',
    generate_audio: true,
    return_last_frame: true,
    seed: 7,
  }, 'test-key');
  assert.equal(t2v.taskType, 't2v');
  assert.equal(t2v.payload.seconds, '30');
  assert.equal('images' in t2v.payload, false);
  assert.equal('content' in t2v.payload.metadata, false);

  provider.resetCachesForTests();
  const i2v = await provider.buildSeedance25Payload({
    model: 'seedance-2.5-global-standard-i2v',
    prompt: '',
    duration: -1,
    ratio: 'adaptive',
    resolution: '480p',
    firstFrame: IMAGE,
    lastFrame: IMAGE,
  }, 'test-key', {
    fetchImpl: uploadFetch,
    uploadIntervalMs: 0,
    seedance25DurationProbe: async () => 5,
  });
  assert.equal(i2v.taskType, 'i2v');
  assert.equal('seconds' in i2v.payload, false);
  assert.equal(i2v.payload.metadata.duration, -1);
  assert.deepEqual(i2v.payload.images, [
    'https://cdn.example.com/reference.png',
    'https://cdn.example.com/reference.png',
  ]);

  provider.resetCachesForTests();
  const multi = await provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi',
    prompt: 'Use @Image 1, @Video 1 and @Audio 1',
    duration: 4,
    ratio: '21:9',
    resolution: '2k',
    refImages: [IMAGE],
    videos: [VIDEO],
    audios: [AUDIO],
  }, 'test-key', {
    fetchImpl: uploadFetch,
    uploadIntervalMs: 0,
    seedance25DurationProbe: async () => 5,
  });
  assert.equal(multi.taskType, 'multi');
  assert.deepEqual(multi.payload.metadata.content, [
    { type: 'image_url', image_url: { url: 'https://cdn.example.com/reference.png' } },
    { type: 'video_url', video_url: { url: 'https://cdn.example.com/reference.mp4' } },
    { type: 'audio_url', audio_url: { url: 'https://cdn.example.com/reference.wav' } },
  ]);
  assert.equal('images' in multi.payload, false);
});

test('Seedance 2.5 rejects mismatched model/media contracts before submission', async () => {
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v', prompt: 'valid', duration: 4, ratio: '16:9', resolution: '480p', refImages: [IMAGE],
  }, 'test-key'), /t2v 不接受/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-i2v', duration: 4, ratio: '16:9', resolution: '480p', videos: [VIDEO],
  }, 'test-key'), /i2v 只支持 1-2 张/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi', prompt: 'valid', duration: 4, ratio: '16:9', resolution: '480p',
  }, 'test-key'), /至少需要 1 个参考素材/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v', prompt: 'valid', duration: 31, ratio: '16:9', resolution: '480p',
  }, 'test-key'), /4-30 秒/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v', prompt: 'valid', duration: 4, ratio: '16:9', resolution: 'native4k',
  }, 'test-key'), /不支持分辨率/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi', prompt: 'valid', duration: 4, ratio: '16:9', resolution: '480p',
    refImages: Array.from({ length: 31 }, () => IMAGE),
  }, 'test-key'), /最多支持 30 张图片/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi', prompt: 'valid', duration: 4, ratio: '16:9', resolution: '480p',
    videos: Array.from({ length: 11 }, () => VIDEO),
  }, 'test-key'), /最多支持 10 个视频/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi', prompt: 'valid', duration: 4, ratio: '16:9', resolution: '480p',
    audios: Array.from({ length: 11 }, () => AUDIO),
  }, 'test-key'), /最多支持 10 个音频/);
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v', prompt: 'x'.repeat(20481), duration: 5, ratio: '16:9', resolution: '720p',
  }, 'test-key'), /最多 20480 字符/);
});

test('Seedance 2.5 enforces updated media formats and physical duration limits before task submission', async () => {
  provider.resetCachesForTests();
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-i2v',
    firstFrame: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
    duration: 5,
    ratio: 'adaptive',
    resolution: '720p',
  }, 'test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 }), /不支持该image格式/);

  provider.resetCachesForTests();
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi',
    prompt: 'invalid video format',
    videos: ['data:video/quicktime;base64,AAAA'],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
  }, 'test-key', {
    fetchImpl: uploadFetch,
    uploadIntervalMs: 0,
    seedance25DurationProbe: async () => 5,
  }), /不支持该video格式/);

  provider.resetCachesForTests();
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi',
    prompt: 'too short',
    videos: [VIDEO],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
  }, 'test-key', {
    fetchImpl: uploadFetch,
    uploadIntervalMs: 0,
    seedance25DurationProbe: async () => 1.99,
  }), /2-30 秒/);

  provider.resetCachesForTests();
  const durations = [20, 11];
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-multi',
    prompt: 'aggregate too long',
    videos: [VIDEO],
    audios: [AUDIO],
    duration: 5,
    ratio: '16:9',
    resolution: '720p',
  }, 'test-key', {
    fetchImpl: uploadFetch,
    uploadIntervalMs: 0,
    seedance25DurationProbe: async () => durations.shift(),
  }), /总时长不得超过 30 秒/);
});

test('all six Seedance 2.5 Standard models accept native1080p and reject native4k', async () => {
  for (const model of MODELS) {
    provider.resetCachesForTests();
    const mode = seedance25TaskType(model);
    const request: Record<string, unknown> = {
      model,
      prompt: mode === 'i2v' ? '' : 'native resolution contract',
      duration: 4,
      ratio: 'adaptive',
      resolution: 'native1080p',
    };
    if (mode === 'i2v') request.firstFrame = IMAGE;
    if (mode === 'multi') request.refImages = [IMAGE];
    const built = await provider.buildSeedance25Payload(request, 'test-key', {
      fetchImpl: uploadFetch,
      uploadIntervalMs: 0,
    });
    assert.equal(built.payload.metadata.resolution, 'native1080p', model);
  }
  await assert.rejects(provider.buildSeedance25Payload({
    model: 'seedance-2.5-standard-t2v',
    prompt: 'invalid native resolution',
    duration: 4,
    ratio: 'adaptive',
    resolution: 'native4k',
  }, 'test-key'), /不支持分辨率 native4k/);
});

test('all six Seedance 2.5 workflows are saved, key-free and model-correct', () => {
  for (const model of MODELS) {
    const doc = workflow(model);
    assert.equal(doc.schema, 't8-workflow-fragment');
    assert.equal(JSON.stringify(doc).includes('sk-'), false);
    const generation = doc.nodes.find((node: any) => node.type === 'seedance25' && node.data?.model === model);
    assert.ok(generation, `${model} must contain the standalone SD2.5 node`);
    assert.equal(generation.data.duration, 5);
    assert.equal(generation.data.resolution, '720p');
    if (model.endsWith('-i2v')) assert.equal(generation.data.ratio, 'adaptive');
    const uploads = doc.nodes.filter((node: any) => node.type === 'upload').map((node: any) => node.data?.uploadType).sort();
    assert.deepEqual(
      uploads,
      model.endsWith('-i2v') ? ['image', 'image'] : model.endsWith('-multi') ? ['audio', 'image', 'video'] : [],
      `${model} upload topology`,
    );
  }
});

test('Seedance 2.5 standalone and Video UI share submit/query plumbing', () => {
  const standalone = readFileSync(join(root, 'src', 'components', 'nodes', 'SeedanceNode.tsx'), 'utf8');
  const wrapper = readFileSync(join(root, 'src', 'components', 'nodes', 'Seedance25Node.tsx'), 'utf8');
  const video = readFileSync(join(root, 'src', 'components', 'nodes', 'VideoNode.tsx'), 'utf8');
  assert.match(wrapper, /seedance25Variant: true/);
  assert.match(standalone, /SEEDANCE25_MODEL_OPTIONS/);
  assert.match(standalone, /submitSeedance\(payload/);
  assert.match(video, /const isSeedance25/);
  assert.match(video, /if \(isSeedance25\)/);
  assert.match(video, /querySeedance\(tid, 'seedance-nz'\)/);
  assert.match(video, /const maxMentionAudios = [^;]*isSeedance25 && seedance25Mode === 'multi'\s*\? SEEDANCE25_MULTI_MAX_AUDIOS/);
});
