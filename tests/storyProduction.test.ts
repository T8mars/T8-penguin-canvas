import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  STORY_ANALYSIS_SCHEMA,
  applyStoryAnalysis,
  buildLocalStoryAnalysis,
  buildStoryAssetGenerationSpec,
  buildStoryCoverageReport,
  compileStoryPrompts,
  createEmptyStoryProject,
  duplicateStoryShot,
  invalidateStoryForAssetChange,
  limitStoryAssetTargets,
  limitStoryVideoTargets,
  mergeStoryShotWithNext,
  moveStoryShot,
  patchStoryShot,
  removeStoryShot,
  sanitizeStoryProject,
  selectStoryAssetTargets,
  selectStoryVideoTargets,
  splitStoryShot,
  splitStoryScriptBlocks,
  storyProviderSubmissionKey,
  storyToDirectorShots,
  storyToVideoEditClips,
  storyToVideoEditTimeline,
} from '../src/utils/storyProduction.ts';
import { ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL } from '../src/providers/models.ts';

const root = path.resolve(import.meta.dirname, '..');
const sampleScript = `《唐人街巷战》Director Script V2
Scene：The Alley
【镜头一｜建立环境】
雨夜的悉尼唐人街后巷。
没有人物。
霓虹灯倒映在积水中。
【镜头二｜建立人物】
电梯门缓缓打开。
萌萌独自走出。
镜头始终跟随萌萌向前移动。
没有其它人物。
【镜头三｜进入战斗状态】
萌萌继续向前走。
边走边自然脱下黑色西装外套。
不要加入其它动作。
【镜头四｜危险出现】
镜头切至走廊尽头的阴影。
不要出现萌萌。
黑色手枪缓缓进入画面。
【镜头五｜第一次对视】
镜头回到萌萌。
Cut。
镜头切至罂瑶双眼。
双方互相锁定。
【镜头六｜战斗仪式】
萌萌右手轻轻展开黑色战术甩棍。
罂瑶缓缓放低手枪。
左手拔出战术短刀。
双方同时向前迈出第一步。`;

test('story local fallback preserves every script block and hard constraint', () => {
  const project = createEmptyStoryProject({ storyId: 'story-test', script: sampleScript });
  const analysis = buildLocalStoryAnalysis(sampleScript, project.settings);
  const next = applyStoryAnalysis(project, analysis, 'local-fallback');
  const blocks = splitStoryScriptBlocks(sampleScript);
  assert.ok(blocks.length >= 6);
  assert.equal(next.coverage.totalBlocks, 6);
  assert.equal(next.coverage.coveredBlocks, 6);
  assert.equal(next.coverage.hardConstraintLosses.length, 0);
  assert.equal(next.analysisSource, 'local-fallback');
  assert.deepEqual(next.assets.map((asset) => asset.name).sort(), [
    '萌萌', '罂瑶', '雨夜唐人街后巷', '电梯/走廊', '黑色西装外套', '黑色手枪', '战术短刀', '战术甩棍',
  ].sort());
});

test('long scripts keep stable unique shots and full coverage without truncation', () => {
  const script = Array.from({ length: 120 }, (_, index) => `【镜头 ${index + 1}｜段落】\n角色向前移动 ${index + 1}。镜头保持稳定。`).join('\n');
  const base = createEmptyStoryProject({ storyId: 'story-long', script });
  const analyzed = applyStoryAnalysis(base, buildLocalStoryAnalysis(script, { ...base.settings, targetDurationSec: 720 }), 'local-fallback');
  assert.equal(analyzed.shots.length, 120);
  assert.equal(new Set(analyzed.shots.map((shot) => shot.id)).size, 120);
  assert.equal(analyzed.coverage.percent, 100);
  assert.equal(compileStoryPrompts(analyzed).shots.every((shot) => Boolean(shot.finalPrompt)), true);
});

test('legacy or LLM Story data repairs duplicate shot ids deterministically', () => {
  const input = {
    ...createEmptyStoryProject({ storyId: 'story-duplicate-shot-ids', script: 'a\n\nb' }),
    shots: [
      { id: 'same-shot', title: 'A', sourceSpan: { start: 0, end: 1, text: 'a' }, durationSec: 5, visualDescription: 'a' },
      { id: 'same-shot', title: 'B', sourceSpan: { start: 3, end: 4, text: 'b' }, durationSec: 5, visualDescription: 'b' },
    ],
  };
  const first = sanitizeStoryProject(input);
  const second = sanitizeStoryProject(input);
  assert.equal(new Set(first.shots.map((shot) => shot.id)).size, 2);
  assert.deepEqual(first.shots.map((shot) => shot.id), second.shots.map((shot) => shot.id));
});

test('Story derives a stable independent submission identity for each paid operation', () => {
  const base = 'run-attempt-key';
  const shotA = storyProviderSubmissionKey(base, 'shot', 'shot-a');
  const shotB = storyProviderSubmissionKey(base, 'shot', 'shot-b');
  assert.notEqual(shotA, shotB);
  assert.equal(shotA, storyProviderSubmissionKey(base, 'shot', 'shot-a'));
  assert.notEqual(shotA, storyProviderSubmissionKey(base, 'asset', 'shot-a'));
  assert.ok(shotA.length <= 160);
});

test('legacy Story project data without recovery fields upgrades safely', () => {
  const legacy = sanitizeStoryProject({
    storyId: 'story-legacy', script: '旧镜头', title: '旧项目',
    shots: [{ id: 'old-shot', title: '旧镜头', durationSec: 5, visualDescription: '旧镜头', videoUrl: '/old.mp4' }],
    assets: [{ id: 'old-asset', kind: 'prop', name: '旧道具', url: '/old.png' }],
  });
  assert.equal(legacy.composeTaskId, '');
  assert.equal(legacy.composeTaskStatus, 'idle');
  assert.deepEqual(legacy.assets[0].taskClipIds, []);
  assert.equal(legacy.shots[0].taskProvider, '');
  assert.equal(legacy.shots[0].taskModel, '');
  assert.equal(legacy.assets[0].taskModel, '');
  assert.equal(legacy.assets[0].taskEndpoint, '');
});

test('story provider settings preserve canonical built-ins and configured external selections', () => {
  const base = createEmptyStoryProject({ storyId: 'story-provider-settings' });
  assert.equal(base.settings.imageModel, ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL);
  const configured = sanitizeStoryProject({
    ...base,
    settings: {
      ...base.settings,
      llmModel: 'gpt-5',
      llmApiSource: 'seedance-nz',
      llmNzModel: 'qwen/qwen3.7-plus',
      llmProviderSource: 'openai-compatible',
      llmProviderId: 'openai-local',
      llmProviderModel: 'gpt-5.1-custom',
      imageModel: 'gpt-image-2-fal',
      imageProviderSource: 'modelscope',
      imageProviderId: 'modelscope-main',
      imageProviderModel: 'Qwen/Qwen-Image-2512',
      videoApiSource: 'seedance-nz',
      videoModel: 'doubao-seedance-2-0-260128',
      videoNzModel: 'global-fast',
      videoProviderSource: 'volcengine',
      videoProviderId: 'volcengine-main',
      videoProviderModel: 'doubao-seedance-2-0-fast-260128',
    },
  });
  assert.equal(configured.settings.llmModel, 'gpt-5');
  assert.equal(configured.settings.llmApiSource, 'seedance-nz');
  assert.equal(configured.settings.llmNzModel, 'qwen/qwen3.7-plus');
  assert.equal(configured.settings.llmProviderId, 'openai-local');
  assert.equal(configured.settings.imageModel, 'gpt-image-2-fal');
  assert.equal(configured.settings.imageProviderModel, 'Qwen/Qwen-Image-2512');
  assert.equal(configured.settings.videoApiSource, 'seedance-nz');
  assert.equal(configured.settings.videoNzModel, 'global-fast');
  assert.equal(configured.settings.videoProviderSource, 'volcengine');

  for (const preservedImageModel of [
    'gpt-image-2-all',
    'gpt-image-2',
    'zhenzhen-image-g2-t2i',
    ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL,
  ]) {
    const preserved = sanitizeStoryProject({
      ...base,
      settings: { ...base.settings, imageModel: preservedImageModel },
    });
    assert.equal(preserved.settings.imageModel, preservedImageModel);
  }

  const invalid = sanitizeStoryProject({
    ...base,
    settings: { ...base.settings, llmModel: 'gpt-5.4', llmApiSource: 'made-up-source', llmNzModel: 'made-up-llm', imageModel: 'made-up-image', videoModel: 'made-up-video', videoNzModel: 'made-up-nz' },
  });
  assert.equal(invalid.settings.llmModel, 'gemini-3.5-flash');
  assert.equal(invalid.settings.llmApiSource, 'zhenzhen');
  assert.equal(invalid.settings.llmNzModel, 'bytedance/doubao-seed-2.0-mini');
  assert.equal(invalid.settings.imageModel, ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL);
  assert.equal(invalid.settings.videoModel, 'doubao-seedance-2-0-fast-260128');
  assert.equal(invalid.settings.videoNzModel, 'fast');
});

test('story analysis accepts exactly eight core assets for the Chinatown example', () => {
  const project = createEmptyStoryProject({ storyId: 'story-eight', script: sampleScript });
  const blocks = splitStoryScriptBlocks(sampleScript).filter((block) => /镜头/.test(block.text));
  const assets = [
    ['character', '萌萌'], ['character', '罂瑶'],
    ['scene', '雨夜唐人街后巷'], ['scene', '电梯/走廊'],
    ['costume', '黑色西装外套'], ['prop', '黑色手枪'], ['prop', '战术短刀'], ['prop', '战术甩棍'],
  ].map(([kind, name], index) => ({ id: `asset-${index}`, kind, name, description: `${name}稳定设定`, prompt: `${name}设定图` }));
  const analysis = {
    schema: STORY_ANALYSIS_SCHEMA,
    title: '唐人街巷战',
    styleBible: '电影写实',
    scenes: [{ id: 'scene-alley', title: 'The Alley', description: '雨夜后巷', sourceSpan: { start: 0, end: sampleScript.length, text: sampleScript } }],
    shots: blocks.map((block, index) => ({
      id: `shot-${index + 1}`,
      sceneId: 'scene-alley',
      title: `镜头 ${index + 1}`,
      sourceSpan: block,
      durationSec: 6,
      visualDescription: block.text,
      mustNotInclude: Array.from(block.text.matchAll(/(?:没有|不要)[^。]*/g), (match) => match[0]),
      assetIds: assets.filter((asset) => block.text.includes(asset.name)).map((asset) => asset.id),
    })),
    assets,
  };
  const next = applyStoryAnalysis(project, analysis, 'llm');
  assert.equal(next.assets.length, 8);
  assert.deepEqual(next.assets.filter((asset) => asset.kind === 'character').map((asset) => asset.name), ['萌萌', '罂瑶']);
  assert.equal(next.coverage.percent, 100);
});

test('analysis merges duplicate assets and rewires shot references to one stable id', () => {
  const project = createEmptyStoryProject({ storyId: 'story-dedupe', script: '【镜头一】\n萌萌走入雨巷。' });
  const next = applyStoryAnalysis(project, {
    schema: STORY_ANALYSIS_SCHEMA,
    scenes: [{ id: 'scene', title: '雨巷', description: '雨巷' }],
    assets: [
      { id: 'hero-a', kind: 'character', name: '萌萌', description: '短描述', prompt: '角色图' },
      { id: 'hero-b', kind: 'character', name: '萌萌', description: '更完整的稳定角色描述', prompt: '更完整角色设定图' },
    ],
    shots: [{ id: 'shot', sceneId: 'scene', title: '进入', sourceText: '【镜头一】\n萌萌走入雨巷。', durationSec: 5, visualDescription: '萌萌走入雨巷', assetIds: ['hero-b'] }],
  }, 'llm');
  assert.equal(next.assets.length, 1);
  assert.equal(next.assets[0].id, 'hero-a');
  assert.equal(next.assets[0].description, '更完整的稳定角色描述');
  assert.deepEqual(next.shots[0].assetIds, ['hero-a']);
});

test('compiled prompts contain style, identity, action, camera and prohibition layers', () => {
  const project = createEmptyStoryProject({ storyId: 'story-prompts', script: '【镜头一】\n萌萌向前走。不要出现其他人物。' });
  const next = applyStoryAnalysis(project, {
    schema: STORY_ANALYSIS_SCHEMA,
    styleBible: '雨夜霓虹电影写实',
    scenes: [{ id: 'scene-1', title: '后巷', description: '湿润路面' }],
    assets: [{ id: 'asset-meng', kind: 'character', name: '萌萌', description: '黑发黑衣，身份固定', prompt: '角色设定图' }],
    shots: [{ id: 'shot-1', sceneId: 'scene-1', title: '前进', sourceText: '【镜头一】\n萌萌向前走。不要出现其他人物。', durationSec: 6, visualDescription: '萌萌向前走', action: '稳定前进', camera: '中景跟拍', mustNotInclude: ['不要出现其他人物'], assetIds: ['asset-meng'] }],
  }, 'llm');
  const compiled = compileStoryPrompts(next);
  assert.match(compiled.shots[0].finalPrompt, /雨夜霓虹电影写实/);
  assert.match(compiled.shots[0].finalPrompt, /character:萌萌=黑发黑衣/);
  assert.match(compiled.shots[0].finalPrompt, /动作：稳定前进/);
  assert.match(compiled.shots[0].finalPrompt, /景别与运镜：中景跟拍/);
  assert.match(compiled.shots[0].negativePrompt, /不要出现其他人物/);
});

test('asset replacement invalidates only dependent shots', () => {
  const base = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-invalidation', script: 'a\n\nb' }),
    scenes: [{ id: 'scene', title: 'S', description: '', sourceSpan: { start: 0, end: 4, text: 'a\n\nb' } }],
    assets: [{ id: 'asset-a', kind: 'prop', name: 'A', description: '', prompt: '', url: '/a.png', status: 'succeeded' }],
    shots: [
      { id: 'shot-a', sceneId: 'scene', title: 'A', sourceSpan: { start: 0, end: 1, text: 'a' }, durationSec: 5, visualDescription: 'a', assetIds: ['asset-a'], finalPrompt: 'pa', videoUrl: '/a.mp4', status: 'succeeded' },
      { id: 'shot-b', sceneId: 'scene', title: 'B', sourceSpan: { start: 3, end: 4, text: 'b' }, durationSec: 5, visualDescription: 'b', assetIds: [], finalPrompt: 'pb', videoUrl: '/b.mp4', status: 'succeeded' },
    ],
    finalVideoUrl: '/final.mp4',
  });
  const next = invalidateStoryForAssetChange(base, 'asset-a');
  assert.equal(next.shots[0].videoUrl, '');
  assert.equal(next.shots[0].status, 'stale');
  assert.equal(next.shots[1].videoUrl, '/b.mp4');
  assert.equal(next.finalVideoUrl, '');
});

test('shot edit invalidates itself and adjacent continuity only while preserving locks', () => {
  const base = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-shot-edit', script: 'one\n\ntwo\n\nthree' }),
    shots: ['one', 'two', 'three'].map((text, index) => ({
      id: `shot-${index}`,
      title: text,
      sourceSpan: { start: index * 5, end: index * 5 + text.length, text },
      durationSec: 5,
      visualDescription: text,
      finalPrompt: text,
      videoUrl: `/${text}.mp4`,
      status: 'succeeded',
      lockedFields: index === 1 ? ['camera'] : [],
      camera: index === 1 ? '锁定运镜' : '默认',
    })),
  });
  const next = patchStoryShot(base, 'shot-1', { action: '新动作' });
  assert.deepEqual(next.shots.map((shot) => shot.videoUrl), ['', '', '']);
  assert.equal(next.shots[1].camera, '锁定运镜');
  assert.equal(next.shots[1].action, '新动作');
});

test('manual prompt editing remains visible and lock-only edits do not discard generated media', () => {
  const base = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-manual-prompt', script: 'one\n\ntwo' }),
    shots: ['one', 'two'].map((text, index) => ({
      id: `shot-${index}`, title: text, sourceSpan: { start: index * 5, end: index * 5 + text.length, text },
      durationSec: 5, visualDescription: text, finalPrompt: `compiled-${text}`, videoUrl: `/${text}.mp4`, status: 'succeeded',
    })),
  });
  const promptEdited = patchStoryShot(base, 'shot-1', { finalPrompt: '用户手动精修提示词' });
  assert.equal(promptEdited.shots[1].finalPrompt, '用户手动精修提示词');
  assert.equal(promptEdited.shots[1].videoUrl, '');
  assert.equal(promptEdited.shots[0].videoUrl, '/one.mp4');
  const lockEdited = patchStoryShot(base, 'shot-1', { lockedFields: ['finalPrompt'] });
  assert.equal(lockEdited.productionRevision, base.productionRevision);
  assert.equal(lockEdited.shots[1].finalPrompt, 'compiled-two');
  assert.equal(lockEdited.shots[1].videoUrl, '/two.mp4');
});

test('compose task metadata survives reload and is cleared by a newer production revision', () => {
  const running = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-compose-resume', script: 'one' }),
    composeTaskId: 'video-job-1',
    composeTaskStatus: 'polling',
    stage: 'compose',
    shots: [{ id: 'shot-1', title: 'One', sourceSpan: { start: 0, end: 3, text: 'one' }, durationSec: 5, visualDescription: 'one', finalPrompt: 'one', videoUrl: '/one.mp4', status: 'succeeded' }],
  });
  assert.equal(running.composeTaskId, 'video-job-1');
  assert.equal(running.composeTaskStatus, 'polling');
  assert.equal(running.stages.compose.message, '正在合成，可恢复');
  const changed = patchStoryShot(running, 'shot-1', { action: '新的动作' });
  assert.equal(changed.composeTaskId, '');
  assert.equal(changed.composeTaskStatus, 'idle');
});

test('duplicate, remove and reorder reconcile asset requirements and invalidate changed continuity', () => {
  const base = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-structural-edit', script: 'a\n\nb\n\nc' }),
    assets: [{ id: 'hero', kind: 'character', name: 'Hero', url: '/hero.png', status: 'succeeded', requiredByShotIds: ['a', 'b', 'c'] }],
    shots: ['a', 'b', 'c'].map((id, index) => ({
      id, title: id.toUpperCase(), sourceSpan: { start: index * 3, end: index * 3 + 1, text: id }, durationSec: 5,
      visualDescription: id, assetIds: ['hero'], finalPrompt: `prompt-${id}`, videoUrl: `/${id}.mp4`, status: 'succeeded',
    })),
  });
  const duplicated = duplicateStoryShot(base, 'b', 'b-copy');
  assert.deepEqual(duplicated.shots.map((shot) => shot.id), ['a', 'b', 'b-copy', 'c']);
  assert.deepEqual(duplicated.assets[0].requiredByShotIds, ['a', 'b', 'b-copy', 'c']);
  assert.equal(duplicated.shots.find((shot) => shot.id === 'b')?.videoUrl, '');
  assert.equal(duplicated.shots.find((shot) => shot.id === 'c')?.videoUrl, '');
  const removed = removeStoryShot(duplicated, 'b-copy');
  assert.deepEqual(removed.assets[0].requiredByShotIds, ['a', 'b', 'c']);
  const moved = moveStoryShot(base, 'c', -2);
  assert.deepEqual(moved.shots.map((shot) => shot.id), ['c', 'a', 'b']);
  assert.equal(moved.shots.every((shot) => !shot.videoUrl), true);
});

test('shot split and merge preserve ordering, constraints and asset dependencies', () => {
  const base = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-split-merge', script: '萌萌进入后巷。\n她拔出短刀。不要出现路人。' }),
    assets: [{ id: 'hero', kind: 'character', name: '萌萌', description: '固定角色', prompt: '角色图' }],
    shots: [{
      id: 'shot-one', title: '进入与拔刀', sceneId: 'scene-one',
      sourceSpan: { start: 0, end: 22, text: '萌萌进入后巷。\n她拔出短刀。不要出现路人。' },
      durationSec: 8, visualDescription: '萌萌进入后巷。她拔出短刀。', action: '进入。拔刀。',
      mustNotInclude: ['不要出现路人'], assetIds: ['hero'], status: 'succeeded', videoUrl: '/old.mp4',
    }],
  });
  const split = splitStoryShot(base, 'shot-one');
  assert.equal(split.shots.length, 2);
  assert.deepEqual(split.shots.map((shot) => shot.durationSec), [4, 4]);
  assert.equal(split.shots.every((shot) => shot.mustNotInclude.includes('不要出现路人')), true);
  assert.deepEqual(split.assets[0].requiredByShotIds, split.shots.map((shot) => shot.id));
  const merged = mergeStoryShotWithNext(split, 'shot-one');
  assert.equal(merged.shots.length, 1);
  assert.equal(merged.shots[0].title, '进入与拔刀');
  assert.equal(merged.shots[0].durationSec, 8);
  assert.match(merged.shots[0].visualDescription, /萌萌进入后巷/);
  assert.match(merged.shots[0].visualDescription, /拔出短刀/);
  assert.deepEqual(merged.assets[0].requiredByShotIds, ['shot-one']);
  const tooShort = sanitizeStoryProject({ ...base, shots: [{ ...base.shots[0], durationSec: 6 }] });
  assert.throws(() => splitStoryShot(tooShort, 'shot-one'), /至少需要 8 秒/);
});

test('missing/retry selectors skip completed work and task cap always allows resumable jobs', () => {
  const project = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-targets', script: 'x' }),
    assets: Array.from({ length: 8 }, (_, index) => ({
      id: `asset-${index}`, kind: 'prop', name: `资产${index}`, description: '', prompt: '',
      url: index < 3 ? `/asset-${index}.png` : '', status: index === 3 ? 'failed' : index === 4 ? 'polling' : 'pending',
      taskId: index === 4 ? 'resume-asset' : '', taskProvider: index === 4 ? 'seedance-nz' : '',
    })),
    shots: Array.from({ length: 4 }, (_, index) => ({
      id: `shot-${index}`, title: `镜头${index}`, sourceSpan: { start: 0, end: 1, text: 'x' }, durationSec: 5,
      visualDescription: 'x', videoUrl: index === 0 ? '/done.mp4' : '',
      status: index === 1 ? 'failed' : index === 2 ? 'polling' : index === 0 ? 'succeeded' : 'pending',
      taskId: index === 2 ? 'resume-video' : '', taskProvider: index === 2 ? 'seedance-nz' : '',
    })),
  });
  const missingAssets = selectStoryAssetTargets(project);
  assert.equal(missingAssets.length, 5, 'three ready assets means only five remain');
  assert.deepEqual(selectStoryAssetTargets(project, null, true).map((asset) => asset.id), ['asset-3']);
  const limitedAssets = limitStoryAssetTargets(missingAssets, 1);
  assert.deepEqual(limitedAssets.selected.map((asset) => asset.id), ['asset-3', 'asset-4']);
  assert.equal(limitedAssets.resumedCount, 1);
  assert.equal(limitedAssets.newTaskCount, 1);
  assert.equal(limitedAssets.deferred.length, 3);
  assert.deepEqual(selectStoryVideoTargets(project, true).map((shot) => shot.id), ['shot-1']);
  const limitedVideos = limitStoryVideoTargets(selectStoryVideoTargets(project), 1, 1);
  assert.deepEqual(limitedVideos.selected.map((shot) => shot.id), ['shot-2']);
  assert.equal(limitedVideos.newTaskCount, 0);
});

test('missing asset generation never targets uploaded, bound, or completed AI assets', () => {
  const project = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-preserve-assets', script: 'x' }),
    assets: [
      { id: 'uploaded', kind: 'character', name: '电脑上传', source: 'upload', url: '/upload.png', status: 'succeeded' },
      { id: 'upstream', kind: 'scene', name: '上游绑定', source: 'existing', url: '/upstream.png', status: 'succeeded' },
      { id: 'library', kind: 'prop', name: '资产库', source: 'existing', url: '/library.png', status: 'succeeded' },
      { id: 'generated', kind: 'costume', name: '已有 AI', source: 'ai', url: '/generated.png', status: 'succeeded' },
      { id: 'missing-image', kind: 'prop', name: '缺失图片', source: 'missing', url: '', status: 'pending' },
    ],
  });

  assert.deepEqual(selectStoryAssetTargets(project).map((asset) => asset.id), ['missing-image']);
  assert.deepEqual(
    selectStoryAssetTargets(project, ['uploaded'], false, true).map((asset) => asset.id),
    ['uploaded'],
    'an explicit single-asset regeneration may include an existing image',
  );
  assert.deepEqual(
    selectStoryAssetTargets(project, null, false, true).map((asset) => asset.id),
    ['missing-image'],
    'batch generation must never use includeExistingTargets without exact target ids',
  );
});

test('character and costume generation specs use clean identity sheets and related references', () => {
  const project = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-asset-sheets', script: 'x' }),
    settings: { aspectRatio: '9:16' },
    shots: [
      { id: 'shot-a', title: 'A', sourceSpan: { start: 0, end: 1, text: 'x' }, assetIds: ['hero', 'costume'] },
    ],
    assets: [
      {
        id: 'hero',
        kind: 'character',
        name: '萌萌',
        description: '黑色长发，身份稳定',
        prompt: '电影写实角色',
        url: '/hero.png',
        status: 'succeeded',
        requiredByShotIds: ['shot-a'],
      },
      {
        id: 'other-hero',
        kind: 'character',
        name: '罂瑶',
        description: '另一个角色',
        prompt: '另一个角色',
        url: '/other.png',
        status: 'succeeded',
        requiredByShotIds: ['shot-b'],
      },
      {
        id: 'costume',
        kind: 'costume',
        name: '黑色西装外套',
        description: '修身黑色西装',
        prompt: '电影级面料',
        requiredByShotIds: ['shot-a'],
      },
    ],
  });
  const characterSpec = buildStoryAssetGenerationSpec(project, project.assets[0]);
  const costumeSpec = buildStoryAssetGenerationSpec(project, project.assets[2]);

  assert.equal(characterSpec.aspectRatio, '16:9');
  assert.match(characterSpec.prompt, /LEFT, one large unobstructed face close-up/);
  assert.match(characterSpec.prompt, /RIGHT, the exact same character in three full-body orthographic views: front, side profile, and back/);
  assert.match(characterSpec.prompt, /single pure white landscape canvas/);
  assert.match(characterSpec.negativePrompt, /different identities/);
  assert.deepEqual(characterSpec.referenceImages, []);

  assert.equal(costumeSpec.aspectRatio, '16:9');
  assert.deepEqual(costumeSpec.referenceImages, ['/hero.png']);
  assert.deepEqual(costumeSpec.referenceAssetIds, ['hero']);
  assert.match(costumeSpec.prompt, /clothing-only costume design sheet/);
  assert.match(costumeSpec.prompt, /Do NOT render a person/);
  assert.match(costumeSpec.prompt, /exact same character identity/);
  assert.match(costumeSpec.negativePrompt, /fashion model/);
});

test('story maps exact shot order, prompts and references into Director and VideoEdit', () => {
  let project = sanitizeStoryProject({
    ...createEmptyStoryProject({ storyId: 'story-map', script: 'a\n\nb' }),
    assets: [
      { id: 'hero', kind: 'character', name: 'Hero', description: 'same hero', prompt: 'hero', url: '/hero.png', status: 'succeeded' },
      { id: 'rain', kind: 'audio', name: 'Rain', description: 'rain ambience', prompt: 'rain', url: '/rain.mp3', status: 'succeeded', requiredByShotIds: ['shot-0'] },
    ],
    shots: ['a', 'b'].map((text, index) => ({ id: `shot-${index}`, title: text, sourceSpan: { start: index * 3, end: index * 3 + 1, text }, durationSec: index + 5, visualDescription: text, assetIds: index === 0 ? ['hero', 'rain'] : ['hero'], videoUrl: `/${text}.mp4`, status: 'succeeded' })),
  });
  project = compileStoryPrompts(project);
  project.shots = project.shots.map((shot, index) => ({ ...shot, videoUrl: `/${index}.mp4`, status: 'succeeded' }));
  const director = storyToDirectorShots(project);
  const clips = storyToVideoEditClips(project);
  const timeline = storyToVideoEditTimeline(project);
  assert.deepEqual(director.map((shot) => shot.id), ['shot-0', 'shot-1']);
  assert.deepEqual(director.map((shot) => shot.durationSec), [5, 6]);
  assert.deepEqual(director[0].localRefImages, ['/hero.png']);
  assert.deepEqual(director[0].localRefAudios, ['/rain.mp3']);
  assert.equal(storyToDirectorShots(project, { videoModel: 'global-fast' })[0].modelOverride, 'global-fast');
  assert.deepEqual(clips.map((clip) => clip.url), ['/0.mp4', '/1.mp4']);
  assert.equal(timeline.timelineV2.assets.some((asset) => asset.kind === 'audio' && asset.url === '/rain.mp3'), true);
  assert.equal(timeline.renderPlan.audio.some((segment) => segment.url === '/rain.mp3'), true);
});

test('story node is wired into shared schema, Canvas and roadmap', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'backend/src/shared/canvasNodeSchema.json'), 'utf8'));
  const canvas = fs.readFileSync(path.join(root, 'src/components/Canvas.tsx'), 'utf8');
  const types = fs.readFileSync(path.join(root, 'src/types/canvas.ts'), 'utf8');
  const roadmap = fs.readFileSync(path.join(root, 'roadmap.md'), 'utf8');
  const storyNode = fs.readFileSync(path.join(root, 'src/components/nodes/StoryNode.tsx'), 'utf8');
  const i18nResources = fs.readFileSync(path.join(root, 'src/i18n/resources.ts'), 'utf8');
  const directorNode = fs.readFileSync(path.join(root, 'src/components/nodes/DirectorStoryboardNode.tsx'), 'utf8');
  const entry = schema.types.find((item: any) => item.type === 'story');
  assert.ok(entry, 'story must be in shared node schema');
  assert.equal(entry.executable, true);
  assert.match(types, /\| 'story'/);
  assert.match(canvas, /StoryNode/);
  assert.match(canvas, /story:\s*StoryNode/);
  assert.match(roadmap, /Story 全自动制片节点/);
  assert.match(storyNode, /getVideoEditJob\(existingTaskId\)/);
  assert.match(storyNode, /productionRevision !== capturedRevision/);
  assert.match(storyNode, /LLM_MODELS/);
  assert.match(storyNode, /SEEDANCE_NZ_LLM_MODELS/);
  assert.match(storyNode, /storyT\('providers\.workshopLlm'\)[\s\S]*storyT\('providers\.budgetHouse'\)/);
  assert.match(i18nResources, /workshopLlm: '贞贞AI工坊内置LLM'[\s\S]*budgetHouse: '贞贞的平价AI小屋'/);
  assert.match(i18nResources, /workshopLlm: 'Zhenzhen AI Workshop built-in LLM'[\s\S]*budgetHouse: 'Zhenzhen Budget AI House'/);
  assert.match(storyNode, /generateLlm\(\{ source: builtinSource, model,/);
  assert.match(storyNode, /IMAGE_MODELS\.find\(\(item\) => item\.id === 'gpt-image-2'\)/);
  assert.match(storyNode, /ZHENZHEN_BUDGET_GPT2_MODEL_OPTIONS/);
  assert.match(storyNode, /STORY_LEGACY_IMAGE_OPTIONS[\s\S]*item\.value === 'gpt-image-2'/);
  assert.match(storyNode, /STORY_BUDGET_IMAGE_OPTIONS[\s\S]*ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL/);
  assert.match(storyNode, /STORY_BUDGET_IMAGE_MODELS\.has\(model[\s\S]*submitSeedreamNz/);
  assert.match(storyNode, /resolution: isLowpriceModel \? '2k' : '1k'/);
  assert.match(storyNode, /size: isLowpriceModel \? imageAspectRatio : undefined/);
  assert.match(storyNode, /<option value="seedance-nz">\{storyT\('providers\.budgetHouse'\)\}<\/option>/);
  assert.doesNotMatch(storyNode, /贞贞平价 AI 工坊（国内）/);
  assert.match(storyNode, /LEGACY_SEEDANCE_MODEL_OPTIONS/);
  assert.match(storyNode, /SEEDANCE_NZ_MODEL_OPTIONS/);
  assert.match(storyNode, /generateExternalLlm/);
  assert.match(storyNode, /generateExternalImage/);
  assert.match(storyNode, /generateExternalVideo/);
  assert.match(storyNode, /providerSource: videoSelection\.available \? videoSelection\.providerSource : 'zhenzhen'/);
  assert.match(storyNode, /api\.getResourceItems\(\{ kind: 'image', q: resourceQuery\.trim\(\) \}\)/);
  assert.match(storyNode, /updateAsset\(asset\.id, \{[\s\S]*?source: 'existing'[\s\S]*?url: item\.fileUrl[\s\S]*?\}, true\)/);
  assert.match(storyNode, /api\.updateResourceItem\(item\.id, \{ touch: true \}\)/);
  assert.match(storyNode, /storyT\('chooseLibraryImage'\)/);
  assert.match(directorNode, /resolveAdvancedProviderSelection\(advancedProviders, 'video'/);
  assert.match(directorNode, /generateExternalVideo/);
});

test('story orchestration progress never auto-creates output material nodes', () => {
  const canvas = fs.readFileSync(path.join(root, 'src/components/Canvas.tsx'), 'utf8');

  assert.match(
    canvas,
    /const SKIP_TYPES = new Set\(\[[^\]]*'story'[^\]]*\]\);/,
    'story progress snapshots must be skipped by generic auto-output materialization',
  );
  assert.match(canvas, /source\?\.type === 'random-route' \|\| source\?\.type === 'story'/);
  assert.match(canvas, /target\?\.type === 'output'/);
  assert.match(canvas, /target\.id\.startsWith\('output-auto-'\)/);
  assert.match(canvas, /td\.userMoved !== true/);
});

test('story production actions switch the visible workbench stage', () => {
  const storyNode = fs.readFileSync(path.join(root, 'src/components/nodes/StoryNode.tsx'), 'utf8');
  const i18nResources = fs.readFileSync(path.join(root, 'src/i18n/resources.ts'), 'utf8');
  const requestAction = storyNode.slice(storyNode.indexOf('const requestRun = useCallback'), storyNode.indexOf('const stopRun = useCallback'));
  const reviewAction = storyNode.slice(storyNode.indexOf('const enterAssetReview = useCallback'), storyNode.indexOf('const stopRun = useCallback'));
  const assetsAction = storyNode.slice(storyNode.indexOf('const generateAssets = useCallback'), storyNode.indexOf('const compile = useCallback'));
  const videosAction = storyNode.slice(storyNode.indexOf('const generateVideos = useCallback'), storyNode.indexOf('const compose = useCallback'));
  const composeAction = storyNode.slice(storyNode.indexOf('const compose = useCallback'), storyNode.indexOf('const materializeLinkedNodes = useCallback'));

  assert.match(reviewAction, /setActiveStage\('assets'\)/);
  assert.match(reviewAction, /stage: 'assets'/);
  assert.match(reviewAction, /可先电脑上传、绑定上游或资产库/);
  assert.doesNotMatch(reviewAction, /requestCanvasNodeRun|requestRun\(/);
  assert.match(storyNode, /storyT\('confirmShots'\)[\s\S]*?mode: 'review-assets'/);
  assert.match(storyNode, /mainAction\.mode === 'review-assets' \? enterAssetReview\(\) : requestRun\(mainAction\.mode\)/);
  assert.match(requestAction, /mode === 'compile'[\s\S]*?setActiveStage\('prompts'\)/);
  assert.match(requestAction, /setLocalMessage\(`\$\{STORY_RUN_LABEL\[mode\]\}请求正在提交…`\)/);
  assert.match(requestAction, /onSettled: \(outcome\)[\s\S]*?rejectRequest\(outcome\.error\)/);
  assert.match(storyNode, /后台在上次异常退出后尚未完成画布数据恢复确认/);
  assert.match(assetsAction, /setActiveStage\('assets'\)/);
  assert.match(assetsAction, /storyAssetsReady\(projectRef\.current\)[\s\S]*?setActiveStage\('prompts'\)/);
  assert.match(assetsAction, /stage: 'prompts'/);
  assert.match(storyNode, /const assetChangedDuringGeneration[\s\S]*?const preserveChangedAsset[\s\S]*?AI 返回结果未覆盖当前.*素材/);
  assert.match(storyNode, /latestAfterOutput[\s\S]*?assetChangedDuringGeneration\(latestAfterOutput\)[\s\S]*?preserveChangedAsset\(latestAfterOutput\)[\s\S]*?return/);
  assert.match(storyNode, /buildStoryAssetGenerationSpec\(projectRef\.current, asset\)/);
  assert.equal((storyNode.match(/images: referenceImages/g) || []).length, 4);
  assert.match(storyNode, /const characterTargets = targets\.filter\(\(asset\) => asset\.kind === 'character'\)/);
  assert.match(storyNode, /mode === 'asset-one'[\s\S]*?return runAssetRegenerationSession\(targetId, reporter, signal, budget\)/);
  assert.match(storyNode, /const runAssetRegenerationSession = useCallback[\s\S]*?active\.size < concurrency[\s\S]*?assetRunSessionRef\.current = \{ enqueue \}/);
  assert.match(storyNode, /if \(activeSession\)[\s\S]*?activeSession\.enqueue\(assetId\)/);
  assert.match(storyNode, /const assetActionsBlocked = busy && !assetRunActive/);
  assert.match(storyNode, /generating \? <Loader2 size=\{11\} className="animate-spin" \/>/);
  assert.match(storyNode, /storyT\('retainOldAsset'\)/);
  assert.match(storyNode, /revisionGuard\.finalizeTail[\s\S]*?revisionGuard\.expected = committed\.productionRevision/);
  assert.match(storyNode, /if \(replaceExisting\)[\s\S]*?setActiveStage\('assets'\)[\s\S]*?原素材仅在新结果成功后才被替换/);
  assert.match(storyNode, /generating \? storyT\('generating'\) : asset\.url && kind !== 'audio' \? storyT\('regenerateShort'\) : 'AI'/);
  assert.match(storyNode, /confirmRemoveAsset\(selectedKindAsset\)/);
  assert.match(storyNode, /confirmRemoveAsset\(asset\)/);
  assert.match(storyNode, /确认删除资产「\$\{asset\.name\}」/);
  assert.match(storyNode, /function hasClearableAssetMedia\(asset: StoryAsset\)/);
  assert.match(storyNode, /const confirmClearAssetMedia = useCallback/);
  assert.match(storyNode, /确认清空资产「\$\{asset\.name\}」的当前\$\{materialKind\}？资产设定、提示词和镜头关联都会保留/);
  assert.match(storyNode, /source: 'missing', status: 'pending', url: '', taskId: '', taskProvider: '', taskModel: '', taskEndpoint: '', taskClipIds: \[\], error: '', generatedAt: ''/);
  assert.match(storyNode, /confirmClearAssetMedia\(asset\)[\s\S]*?<Eraser size=\{11\} \/>\{storyT\('clear'\)\}/);
  assert.match(storyNode, /confirmClearAssetMedia\(selectedAsset\)[\s\S]*?storyT\('clearAsset'\)/);
  assert.match(i18nResources, /左侧脸部特写，右侧同一人物正面／侧面／背面三视图/);
  assert.match(i18nResources, /show only the garment by default/);
  assert.match(videosAction, /setActiveStage\('videos'\)/);
  assert.match(composeAction, /setActiveStage\('compose'\)/);
  assert.match(storyNode, /data-story-compose-state=\{project\.composeTaskStatus\}/);
  assert.match(storyNode, /storyT\('composingPleaseWait'\)/);
  assert.match(storyNode, /data-story-compose-error="true"/);
  assert.match(storyNode, /project\.finalVideoUrl \|\| project\.composeTaskStatus === 'failed' \? storyT\('recompose'\)/);
  assert.match(storyNode, /const existingTaskId = ACTIVE_TASK_STATUSES\.has\(current\.composeTaskStatus\)[\s\S]*?\? current\.composeTaskId[\s\S]*?: ''/);
  assert.match(storyNode, /const composeAlreadySucceeded = current\.stage === 'compose'[\s\S]*?current\.composeTaskStatus === 'succeeded'[\s\S]*?Boolean\(current\.finalVideoUrl\)/);
  assert.match(storyNode, /成片已生成，但保存运行记录失败/);
});

test('coverage report rejects missing blocks and lost hard constraints', () => {
  const report = buildStoryCoverageReport({
    script: '第一段。\n\n第二段。不要出现路人。',
    shots: [{
      id: 's1', sceneId: '', title: '1', sourceSpan: { start: 0, end: 4, text: '第一段。' }, durationSec: 5,
      visualDescription: '第一段', action: '', dialogue: '', voiceover: '', sfx: '', camera: '', lighting: '', mustInclude: [], mustNotInclude: [], entityRefs: [], assetIds: [], finalPrompt: '', negativePrompt: '', status: 'pending', videoUrl: '', taskId: '', taskProvider: '', error: '', lockedFields: [], revision: 1,
    }],
    assets: [],
  });
  assert.equal(report.ready, false);
  assert.equal(report.uncovered.length, 1);
  assert.equal(report.hardConstraintLosses.length, 1);
});
