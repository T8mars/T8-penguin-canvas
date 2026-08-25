import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VIDEO_MODELS,
  WAN30_I2V_MODELS,
  WAN30_R2V_MODELS,
  WAN30_THINKING_MODELS,
  WAN30_VIDEO_DURATIONS,
  WAN30_VIDEO_MODELS,
  WAN30_VIDEO_RATIOS,
  WAN30_VIDEO_RESOLUTIONS,
  videoModelOptionsForSource,
} from '../src/providers/models.ts';
import { localizeNodeDynamicText, NODE_VISIBLE_CATALOG } from '../src/i18n/nodeVisibleCatalog.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const root = join(import.meta.dirname, '..');
const source = (name: string) => readFileSync(join(root, name), 'utf8');
const workflow = (model: string) => JSON.parse(source(`docs/workflows/${model}.json`));
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20=';
const AUDIO = 'data:audio/wav;base64,UklGRgQAAABXQVZF';

const uploadFetch = async (_url: string, init?: RequestInit) => {
  const file = (init?.body as FormData).get('file') as File;
  const name = file.type.startsWith('image/') ? 'frame.png' : file.type.startsWith('audio/') ? 'sound.wav' : 'clip.mp4';
  return new Response(JSON.stringify({ url: `https://cdn.example.com/${name}` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

test('Wan tab exposes the exact eight documented Wan 3.0 models without changing the Wan 2.7 default', () => {
  assert.deepEqual(WAN30_VIDEO_MODELS, [
    'wan-3.0-global-i2v',
    'wan-3.0-global-r2v',
    'wan-3.0-i2v',
    'wan-3.0-r2v',
    'wan-3.0-prime-i2v',
    'wan-3.0-prime-r2v',
    'wan-3.0-global-prime-i2v',
    'wan-3.0-global-prime-r2v',
  ]);
  assert.deepEqual(WAN30_I2V_MODELS, [
    'wan-3.0-i2v', 'wan-3.0-global-i2v', 'wan-3.0-prime-i2v', 'wan-3.0-global-prime-i2v',
  ]);
  assert.deepEqual(WAN30_R2V_MODELS, [
    'wan-3.0-r2v', 'wan-3.0-global-r2v', 'wan-3.0-prime-r2v', 'wan-3.0-global-prime-r2v',
  ]);
  assert.deepEqual(WAN30_THINKING_MODELS, ['wan-3.0-global-i2v', 'wan-3.0-global-r2v']);
  assert.deepEqual(WAN30_VIDEO_RATIOS, ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);
  assert.deepEqual(WAN30_VIDEO_DURATIONS, [-1, ...Array.from({ length: 29 }, (_, index) => index + 2)]);
  assert.deepEqual(WAN30_VIDEO_RESOLUTIONS, ['480P', '720P', '1080P']);

  const wan = VIDEO_MODELS.find((item) => item.id === 'wan-2.7-spicy');
  assert.ok(wan);
  const options = videoModelOptionsForSource(wan, 'seedance-nz');
  assert.equal(options[0].value, 'wan-2.7-spicy-i2v');
  assert.deepEqual(options.slice(1).map((item) => item.value), WAN30_VIDEO_MODELS);
  for (const option of options.slice(1)) {
    assert.deepEqual(option.ratios, WAN30_VIDEO_RATIOS);
    assert.deepEqual(option.durations, WAN30_VIDEO_DURATIONS);
    assert.deepEqual(option.resolutions, WAN30_VIDEO_RESOLUTIONS);
  }
});

test('Wan 3.0 I2V payload keeps first/last frames at top level and gates thinking by model', async () => {
  provider.resetCachesForTests();
  const domestic = await provider.buildWan30Payload({
    model: 'wan-3.0-i2v', duration: 2, resolution: '480P', ratio: 'adaptive', images: [IMAGE, IMAGE],
    generateAudio: false, seed: 7, enableThinking: true,
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(domestic.taskType, 'i2v');
  assert.deepEqual(domestic.payload.images, ['https://cdn.example.com/frame.png', 'https://cdn.example.com/frame.png']);
  assert.deepEqual(domestic.payload.metadata, {
    resolution: '480P', ratio: 'adaptive', generate_audio: false, seed: 7,
  });

  provider.resetCachesForTests();
  const global = await provider.buildWan30Payload({
    model: 'wan-3.0-global-i2v', prompt: 'slow push in', duration: 'auto', resolution: '720P', ratio: '16:9',
    images: [IMAGE], enableThinking: true,
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(global.payload.seconds, 'auto');
  assert.equal(global.payload.metadata.enable_thinking, true);

  provider.resetCachesForTests();
  const globalPrime = await provider.buildWan30Payload({
    model: 'wan-3.0-global-prime-i2v', prompt: 'slow push in', duration: 3, resolution: '1080P', ratio: '9:16',
    images: [IMAGE], enableThinking: true,
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(globalPrime.payload.metadata.enable_thinking, undefined);
});

test('Wan 3.0 R2V payload maps image/video/audio references and optional URLs to documented fields', async () => {
  provider.resetCachesForTests();
  const built = await provider.buildWan30Payload({
    model: 'wan-3.0-r2v', prompt: 'match the reference rhythm', duration: 4, resolution: '720P', ratio: '4:3',
    images: [IMAGE], videos: [VIDEO], audios: [AUDIO], fileUrl: 'https://files.example.com/brief.pdf', seed: 9,
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(built.taskType, 'r2v');
  assert.deepEqual(built.payload.images, ['https://cdn.example.com/frame.png']);
  assert.deepEqual(built.payload.metadata.video_url, ['https://cdn.example.com/clip.mp4']);
  assert.deepEqual(built.payload.metadata.audio_url, ['https://cdn.example.com/sound.wav']);
  assert.equal(built.payload.metadata.file_url, 'https://files.example.com/brief.pdf');
  assert.equal(built.payload.metadata.enable_thinking, undefined);

  const global = await provider.buildWan30Payload({
    model: 'wan-3.0-global-r2v', prompt: 'use linked context', duration: 2, resolution: '480P', ratio: 'adaptive',
    linkUrl: 'https://example.com/context', seed: 0,
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(global.payload.metadata.link_url, 'https://example.com/context');
  assert.equal(global.payload.metadata.enable_thinking, true);

  const prime = await provider.buildWan30Payload({
    model: 'wan-3.0-global-prime-r2v', prompt: 'prime reference', duration: 2, resolution: '480P', ratio: 'adaptive',
    enableThinking: true, seed: 0,
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(prime.payload.metadata.enable_thinking, undefined);
});

test('Wan 3.0 validation fails closed before paid submission', async () => {
  await assert.rejects(() => provider.buildWan30Payload({
    model: 'wan-3.0-i2v', duration: 2, resolution: '480P', ratio: 'adaptive', images: [],
  }, 'opaque-test-key'), /1-2 张图片/);
  await assert.rejects(() => provider.buildWan30Payload({
    model: 'wan-3.0-r2v', duration: 2, resolution: '480P', ratio: 'adaptive', prompt: '',
  }, 'opaque-test-key'), /必须填写提示词/);
  await assert.rejects(() => provider.buildWan30Payload({
    model: 'wan-3.0-r2v', duration: 31, resolution: '480P', ratio: 'adaptive', prompt: 'x',
  }, 'opaque-test-key'), /2-30 秒/);
  await assert.rejects(() => provider.buildWan30Payload({
    model: 'wan-3.0-r2v', duration: 2, resolution: '480P', ratio: 'adaptive', prompt: 'x',
    fileUrl: 'https://example.com/a.pdf', linkUrl: 'https://example.com/page',
  }, 'opaque-test-key'), /不能同时填写/);
});

test('Wan 3.0 submission uses POST /v1/videos and never returns credentials', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const result = await provider.submitWanTask({
    model: 'wan-3.0-r2v', prompt: 'cinematic reference', duration: 2, resolution: '480P', ratio: 'adaptive', seed: 0,
  }, 'opaque-test-key', {
    fetchImpl: async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'task-safe' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(capturedUrl, 'https://api.seedance.nz/v1/videos');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer opaque-test-key');
  assert.equal(JSON.parse(String(capturedInit?.body)).model, 'wan-3.0-r2v');
  assert.equal(result.taskId, 'task-safe');
  assert.doesNotMatch(JSON.stringify(result), /opaque-test-key/);
});

test('all eight Wan 3.0 workflows are saved, key-free, and mode-correct', () => {
  for (const model of WAN30_VIDEO_MODELS) {
    const doc = workflow(model);
    assert.equal(doc.schema, 't8-workflow-fragment');
    assert.doesNotMatch(JSON.stringify(doc), /sk-[A-Za-z0-9]/);
    const generation = doc.nodes.find((node: any) => node.type === 'video' && node.data?.model === model);
    assert.ok(generation, model);
    assert.equal(generation.data.mainId, 'wan-2.7-spicy');
    assert.equal(generation.data.videoBuiltinSource, 'seedance-nz');
    const uploads = doc.nodes.filter((node: any) => node.type === 'upload');
    if (model.endsWith('-i2v')) {
      assert.deepEqual(uploads.map((node: any) => node.data.uploadType), ['image', 'image']);
    } else {
      assert.deepEqual(uploads.map((node: any) => node.data.uploadType), ['image', 'video', 'audio']);
    }
  }
});

test('Video UI exposes Wan 3.0 mode controls while preserving the existing Wan routes', () => {
  const ui = source('src/components/nodes/VideoNode.tsx');
  const service = source('src/services/generation.ts');
  for (const token of ['wan30Mode', 'wan30EnableThinking', 'wan30FileUrl', 'wan30LinkUrl', 'wan30Seed']) {
    assert.match(ui, new RegExp(token));
  }
  assert.match(service, /\/api\/proxy\/video\/wan\/submit/);
  assert.match(service, /\/api\/proxy\/video\/wan\/status/);
});

test('Wan 3.0 controls and model labels remain bilingual in the English node runtime', () => {
  assert.equal(
    NODE_VISIBLE_CATALOG.englishByChinese['本地 Prompt（必填）'],
    'Local prompt (required)',
  );
  assert.equal(
    NODE_VISIBLE_CATALOG.englishByChinese['启用思考（仅 Global 标准版支持）'],
    'Enable thinking (Global standard models only)',
  );
  assert.equal(
    localizeNodeDynamicText('wan-3.0-global-i2v（首尾帧图生视频）'),
    'wan-3.0-global-i2v (first/last-frame image-to-video)',
  );
  assert.equal(
    localizeNodeDynamicText('wan-3.0-global-r2v（多模态参考生视频）'),
    'wan-3.0-global-r2v (multimodal reference-to-video)',
  );
});
