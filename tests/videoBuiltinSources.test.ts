import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inferVideoBuiltinSource,
  videoModelOptionsForSource,
  videoModelsForSource,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL,
  ZHENZHEN_VIDEO_GK_V15_MODEL,
  ZHENZHEN_VIDEO_V31_FAST_MODEL,
  ZHENZHEN_VIDEO_V31_LITE_MODEL,
  ZHENZHEN_VIDEO_V31_QUALITY_MODEL,
  VOSR2_VIDEO_UPSCALE_MODEL,
} from '../src/providers/models.ts';
import { workflowManifestToFragment } from '../src/utils/workflowResource.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const optionValues = (source: 'zhenzhen' | 'seedance-nz') => new Set(
  videoModelsForSource(source).flatMap((model) => (
    videoModelOptionsForSource(model, source).map((option) => option.value)
  )),
);

test('video built-in sources keep workshop and budget-house catalogs independent', () => {
  const workshopModels = videoModelsForSource('zhenzhen');
  const budgetModels = videoModelsForSource('seedance-nz');
  const workshopOptions = optionValues('zhenzhen');
  const budgetOptions = optionValues('seedance-nz');

  assert.deepEqual(workshopModels.map((model) => model.id), ['grok-video-3', 'veo3.1', 'sora-2']);
  assert.deepEqual(
    budgetModels.map((model) => model.id),
    [
      'grok-video-3',
      'veo3.1',
      'wan-2.7-spicy',
      'happyhorse-1.1',
      'hailuo-2.3',
      'flux-3-video',
      'vidu-q3',
      'kling-v3.0',
      'zhenzhen-upscaler',
      'fashvsr-video-upscale',
      'vosr2-video-upscale',
      'Topaz-Upscale-LowPirce',
      'animate-motion-transfer',
      'seedance-2.5',
    ],
  );

  for (const model of [
    ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL,
    ZHENZHEN_VIDEO_GK_V15_MODEL,
    ZHENZHEN_VIDEO_V31_FAST_MODEL,
    ZHENZHEN_VIDEO_V31_QUALITY_MODEL,
    ZHENZHEN_VIDEO_V31_LITE_MODEL,
    'wan-2.7-spicy-i2v',
    'happyhorse-1.1-t2v',
    'hailuo-2.3-t2v-standard',
    'hailuo-h3-t2v',
    'hailuo-h3-i2v',
    'hailuo-h3-multi',
    'hailuo-h3-global-t2v',
    'hailuo-h3-global-i2v',
    'hailuo-h3-global-multi',
    'minimax-h3-ow-i2v-fast',
    'minimax-h3-ow-r2v-fast',
    'minimax-h3-ow-ref2va-audio-drive-fast',
    'minimax-h3-ow-fl2va-audio-drive-fast',
    'minimax-h3-ow-t2v-fast',
    'flux-3-video-t2v',
    'flux-3-video-i2v',
    'flux-3-video-v2v',
    'flux-3-video-draft-enhance',
    'flux-3-video-global-t2v',
    'flux-3-video-global-i2v',
    'flux-3-video-global-v2v',
    'flux-3-video-global-draft-enhance',
    'vidu-q3-turbo-t2v',
    'kling-v3.0-std-t2v',
    'zhenzhen-upscaler',
    VOSR2_VIDEO_UPSCALE_MODEL,
  ]) {
    assert.equal(budgetOptions.has(model), true, `${model} should belong to the budget house`);
    assert.equal(workshopOptions.has(model), false, `${model} must not leak into the workshop`);
  }

  for (const model of ['grok-video-3', 'veo-omni-10s', 'veo3.1', 'sora-2']) {
    assert.equal(workshopOptions.has(model), true, `${model} should belong to the workshop`);
    assert.equal(budgetOptions.has(model), false, `${model} must not leak into the budget house`);
  }
});

test('old video canvases infer the correct built-in source from their saved model', () => {
  assert.equal(inferVideoBuiltinSource('grok-video-3'), 'zhenzhen');
  assert.equal(inferVideoBuiltinSource(ZHENZHEN_VIDEO_GK_V15_MODEL), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource(ZHENZHEN_VIDEO_V31_LITE_MODEL), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('hailuo-2.3-i2v-pro'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('hailuo-h3-t2v'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('hailuo-h3-i2v'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('hailuo-h3-multi'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('hailuo-h3-global-multi'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('minimax-h3-ow-i2v-fast'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('minimax-h3-ow-r2v-fast'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('minimax-h3-ow-ref2va-audio-drive-fast'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('minimax-h3-ow-fl2va-audio-drive-fast'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('minimax-h3-ow-t2v-fast'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('flux-3-video-global-v2v'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('hailuo-2.3'), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource(VOSR2_VIDEO_UPSCALE_MODEL), 'seedance-nz');
  assert.equal(inferVideoBuiltinSource('unknown-video-model'), null);
});

test('video node exposes both sources and filters tabs and submodels before execution', () => {
  const node = read('../src/components/nodes/VideoNode.tsx');

  assert.match(node, /videoBuiltinSource/);
  assert.match(node, /value="builtin:seedance-nz"/);
  assert.match(node, /translate\('nodes:generation\.workshopDefault'\)/);
  assert.match(node, /translate\('nodes:generation\.budgetHouse'\)/);
  assert.match(node, /\{builtinVideoModels\.map/);
  assert.match(node, /\{builtinApiModelOptions\.map/);
  assert.match(node, /taskProvider: 'seedance-nz'/);
  assert.match(node, /Veo 3\.1 Lite：纯文生视频/);
  assert.match(node, /isApimartV31Lite \? \['text'\]/);
  assert.match(node, /nextModel\.startsWith\('hailuo-h3-'\)/);
  assert.match(node, /\{ ratio: '16:9', duration: 5, resolution: '768P' \}/);
  assert.match(node, /providerSource: isExternalSelected \? providerSelection\.providerSource : \(isSeedanceNzVideo \? 'seedance-nz' : 'zhenzhen'\)/);
});

test('Hailuo H3 example workflows restore the exact budget-house model and supported defaults', () => {
  const expected = new Map([
    ['hailuo-h3-t2v.json', 'hailuo-h3-t2v'],
    ['hailuo-h3-i2v.json', 'hailuo-h3-i2v'],
    ['hailuo-h3-multi.json', 'hailuo-h3-multi'],
  ]);

  for (const [fileName, model] of expected) {
    const raw = readFileSync(new URL(`../docs/workflows/${fileName}`, import.meta.url), 'utf8');
    const fragment = workflowManifestToFragment(JSON.parse(raw));
    assert.equal(fragment?.nodes.length, 1, `${fileName} should restore one node`);
    assert.equal(fragment?.edges.length, 0, `${fileName} should restore without synthetic edges`);
    const data = fragment?.nodes[0]?.data as Record<string, unknown>;
    assert.equal(fragment?.nodes[0]?.type, 'video');
    assert.equal(data.mainId, 'hailuo-2.3');
    assert.equal(data.model, model);
    assert.equal(data.videoBuiltinSource, 'seedance-nz');
    assert.equal(data.duration, 5);
    assert.equal(data.resolution, '768P');
    assert.equal(data.reuseResult, false);
  }
});
