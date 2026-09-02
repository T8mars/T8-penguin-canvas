import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HAILUO_H3_MAX_VIDEO_DURATIONS,
  HAILUO_H3_MAX_VIDEO_MODELS,
  HAILUO_H3_MAX_VIDEO_RATIOS,
  HAILUO_H3_MAX_VIDEO_RESOLUTIONS,
  VIDEO_MODELS,
  videoModelOptionsForSource,
} from '../src/providers/models.ts';
import { localizeNodeDynamicText, NODE_VISIBLE_CATALOG } from '../src/i18n/nodeVisibleCatalog.ts';

const require = createRequire(import.meta.url);
const provider = require('../backend/src/providers/seedanceNz.js');
const root = join(import.meta.dirname, '..');
const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

const uploadFetch = async () => new Response(JSON.stringify({ url: 'https://cdn.example.com/frame.png' }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('Hailuo tab exposes the exact documented H3 Max models and controls', () => {
  assert.deepEqual(HAILUO_H3_MAX_VIDEO_MODELS, ['hailuo-h3-max-t2v', 'hailuo-h3-max-i2v']);
  assert.deepEqual(HAILUO_H3_MAX_VIDEO_DURATIONS, Array.from({ length: 11 }, (_, index) => index + 5));
  assert.deepEqual(HAILUO_H3_MAX_VIDEO_RESOLUTIONS, ['480P', '768P']);
  assert.deepEqual(HAILUO_H3_MAX_VIDEO_RATIOS, ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

  const hailuo = VIDEO_MODELS.find((item) => item.id === 'hailuo-2.3');
  assert.ok(hailuo);
  const options = videoModelOptionsForSource(hailuo, 'seedance-nz');
  const t2v = options.find((item) => item.value === 'hailuo-h3-max-t2v');
  const i2v = options.find((item) => item.value === 'hailuo-h3-max-i2v');
  assert.ok(t2v);
  assert.ok(i2v);
  assert.deepEqual(t2v.ratios, HAILUO_H3_MAX_VIDEO_RATIOS);
  assert.deepEqual(i2v.ratios, []);
  assert.equal(t2v.maxRefImages, 0);
  assert.equal(i2v.maxRefImages, 2);
});

test('H3 Max T2V payload includes the required ratio and rejects undocumented values', async () => {
  const built = await provider.buildHailuoPayload({
    model: 'hailuo-h3-max-t2v',
    prompt: 'A paper airplane glides through a sunlit studio',
    duration: 5,
    resolution: '480P',
    ratio: '16:9',
  }, 'opaque-test-key');
  assert.deepEqual(built, {
    model: 'hailuo-h3-max-t2v',
    taskType: 't2v',
    payload: {
      model: 'hailuo-h3-max-t2v',
      prompt: 'A paper airplane glides through a sunlit studio',
      seconds: '5',
      metadata: { resolution: '480P', ratio: '16:9' },
    },
  });
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'hailuo-h3-max-t2v', prompt: 'x', duration: 5, resolution: '2K', ratio: 'adaptive',
  }, 'opaque-test-key'), /480P 或 768P/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'hailuo-h3-max-t2v', prompt: 'x', duration: 5, resolution: '480P', ratio: 'adaptive',
  }, 'opaque-test-key'), /不支持比例/);
});

test('H3 Max I2V requires prompt and 1-2 frames and never sends ratio', async () => {
  provider.resetCachesForTests();
  const built = await provider.buildHailuoPayload({
    model: 'hailuo-h3-max-i2v',
    prompt: 'The camera moves forward while the subject turns naturally',
    duration: 15,
    resolution: '768P',
    ratio: '9:16',
    images: [IMAGE, `${IMAGE}A`],
  }, 'opaque-test-key', { fetchImpl: uploadFetch, uploadIntervalMs: 0 });
  assert.equal(built.taskType, 'i2v');
  assert.deepEqual(built.payload.metadata, { resolution: '768P' });
  assert.equal('ratio' in built.payload.metadata, false);
  assert.equal(built.payload.images.length, 2);

  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'hailuo-h3-max-i2v', prompt: '', duration: 5, resolution: '480P', images: [IMAGE],
  }, 'opaque-test-key'), /必须填写提示词/);
  await assert.rejects(() => provider.buildHailuoPayload({
    model: 'hailuo-h3-max-i2v', prompt: 'x', duration: 5, resolution: '480P', images: [],
  }, 'opaque-test-key'), /1-2 张首尾帧/);
});

test('both H3 Max workflows are saved, key-free, and mode-correct', () => {
  for (const model of HAILUO_H3_MAX_VIDEO_MODELS) {
    const doc = JSON.parse(readFileSync(join(root, 'docs', 'workflows', `${model}.json`), 'utf8'));
    assert.equal(doc.schema, 't8-workflow-fragment');
    assert.doesNotMatch(JSON.stringify(doc), /sk-[A-Za-z0-9]/);
    const generation = doc.nodes.find((node: any) => node.type === 'video' && node.data?.model === model);
    assert.ok(generation, model);
    assert.equal(generation.data.mainId, 'hailuo-2.3');
    assert.equal(generation.data.videoBuiltinSource, 'seedance-nz');
    assert.equal(generation.data.duration, 5);
    assert.equal(generation.data.resolution, '480P');
    assert.ok(String(generation.data.localPrompt).trim());
    const uploads = doc.nodes.filter((node: any) => node.type === 'upload');
    assert.equal(uploads.length, model.endsWith('-i2v') ? 2 : 0);
  }
});

test('Video node keeps H3 Max separate from ordinary H3 UI defaults', () => {
  const ui = readFileSync(join(root, 'src', 'components', 'nodes', 'VideoNode.tsx'), 'utf8');
  assert.match(ui, /const isHailuoH3Max = isHailuo && apiModel\.startsWith\('hailuo-h3-max-'\)/);
  assert.match(ui, /isHailuoH3Max \? resolution === '768P' \? '768P' : '480P'/);
  assert.match(ui, /H3 Max 图生视频必须填写提示词/);
});

test('H3 Max labels and guidance stay English in the English canvas locale', () => {
  assert.equal(
    localizeNodeDynamicText('hailuo-h3-max-t2v（H3 Max 文生视频）'),
    'hailuo-h3-max-t2v (H3 Max text-to-video)',
  );
  assert.equal(
    NODE_VISIBLE_CATALOG.englishByChinese['H3 Max 图生视频必须填写提示词并使用第 1 张首帧图，可选第 2 张尾帧图；比例跟随输入图片且不会发送。'],
    'H3 Max image-to-video requires a prompt and first frame, with an optional second last frame; aspect ratio follows the input frames and is not submitted.',
  );
});
