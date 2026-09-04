'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  prepareSceneProductionMutation,
  readSceneProduction,
} = require('../backend/src/services/creatorSceneProduction.js');

const scene = {
  sceneId: 'scene-production-a',
  title: '雨夜站台',
  recordRevision: 2,
};

const modelSnapshot = {
  kind: 'video',
  providerId: 'seedance-nz',
  modelId: 'hailuo-2.3-t2v-standard',
  catalogDigest: 'a'.repeat(64),
};

function action(shots) {
  return {
    type: 'video',
    prompt: '雨夜站台五镜段落',
    parameters: { ratio: '16:9', duration: 6, resolution: '768p' },
    inputAssetIds: [],
    modelSnapshot,
    shots,
  };
}

function versionsFrom(plan) {
  return plan.mutations.map((mutation, index) => ({
    ...mutation,
    versionId: `version-${index + 1}`,
    artifactId: `artifact-${index + 1}`,
    revision: 1,
  }));
}

test('scene production gives five shots stable IDs and stores one digest-bound ShotList/PromptPack', () => {
  const shots = Array.from({ length: 5 }, (_, index) => ({
    sourceKey: `beat-${index + 1}`,
    title: `镜头 ${index + 1}`,
    purpose: `推进节拍 ${index + 1}`,
    prompt: `雨夜站台第 ${index + 1} 镜，人物动作连续。`,
    parameters: { ratio: '16:9', duration: 6, resolution: '768p' },
    inputAssetIds: [],
  }));
  const plan = prepareSceneProductionMutation({ scene, action: action(shots), currentVersions: [] });
  assert.equal(plan.shots.length, 5);
  assert.equal(new Set(plan.shotIds).size, 5);
  assert.ok(plan.shotIds.every((shotId) => /^shot_[a-f0-9]{24}$/.test(shotId)));
  assert.equal(plan.mutations[0].kind, 'ShotList');
  assert.equal(plan.mutations[1].kind, 'PromptPack');
  assert.equal(plan.mutations[0].fields.summary, plan.planDigest);
  assert.equal(plan.mutations[1].fields.summary, plan.planDigest);

  const restored = readSceneProduction(versionsFrom(plan), scene.sceneId);
  assert.equal(restored.planDigest, plan.planDigest);
  assert.deepEqual(restored.shots.map((shot) => shot.shotId), plan.shotIds);
  assert.equal(restored.prompts.length, 5);
});

test('scene production preserves edited shot IDs, tombstones removals, and never revives an old ID', () => {
  const first = prepareSceneProductionMutation({
    scene,
    action: action([
      { sourceKey: 'wide', title: '全景', prompt: '雨夜站台全景。' },
      { sourceKey: 'face', title: '近景', prompt: '人物近景。' },
      { sourceKey: 'train', title: '列车', prompt: '列车进站。' },
    ]),
    currentVersions: [],
  });
  const currentVersions = versionsFrom(first);
  const second = prepareSceneProductionMutation({
    scene,
    action: action([
      { shotId: first.shotIds[0], sourceKey: 'wide', title: '全景', prompt: '雨夜站台全景。' },
      { shotId: first.shotIds[1], sourceKey: 'face', title: '近景', prompt: '人物含泪抬头的近景。' },
    ]),
    currentVersions,
  });
  assert.deepEqual(second.shotIds, first.shotIds.slice(0, 2));
  const removed = second.mutations[0].fields.shots.find((shot) => shot.shotId === first.shotIds[2]);
  assert.equal(removed.deleted, true);

  const secondVersions = second.mutations.map((mutation, index) => ({
    ...mutation,
    versionId: `second-${index + 1}`,
    artifactId: currentVersions[index].artifactId,
    revision: 2,
  }));
  const third = prepareSceneProductionMutation({
    scene,
    action: action([
      { sourceKey: 'wide', title: '全景', prompt: '雨夜站台全景。' },
      { sourceKey: 'train', title: '列车', prompt: '列车再次进站。' },
    ]),
    currentVersions: secondVersions,
  });
  assert.equal(third.shotIds[0], first.shotIds[0]);
  assert.notEqual(third.shotIds[1], first.shotIds[2]);
  assert.equal(new Set(third.shotIds).size, 2);
});

test('scene production rejects a model-invented or tombstoned requested shot ID', () => {
  const initial = prepareSceneProductionMutation({
    scene,
    action: action([{ sourceKey: 'wide', title: '全景', prompt: '雨夜站台全景。' }]),
    currentVersions: [],
  });
  const rejected = prepareSceneProductionMutation({
    scene,
    action: action([{ shotId: 'shot_not_real_12345678', title: '伪造镜头', prompt: '不应保存。' }]),
    currentVersions: versionsFrom(initial),
  });
  assert.equal(rejected, null);
});
