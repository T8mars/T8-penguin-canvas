'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyScenePatchToLongScriptImport,
  buildLongScriptStyleCanon,
  buildSceneContextPack,
  digest,
  normalizeScenePatch,
  prepareLongScriptImport,
  prepareLongScriptProductionBriefMutation,
  prepareScenePartAdvanceMutation,
  prepareScenePatchMutation,
  readLongScriptWork,
  reconcileLongScriptScenes,
  sceneScopeKey,
  splitSceneSourceParts,
  splitLongScriptScenes,
} = require('../backend/src/services/creatorLongScriptWork.js');

test('long-script style canon prefers persisted work and preserves accepted fields on sparse updates', () => {
  const currentVersions = [{
    kind: 'ProductionBrief', scopeKey: 'root', versionId: 'brief-v1', title: '长剧简报',
    fields: {
      outcome: '完成连续剧', style: '潮湿霓虹现实主义', tone: '克制',
      constraints: '人物衣着跨场连续', notes: '镜头不炫技',
    },
  }, {
    kind: 'WorldBible', scopeKey: 'root', versionId: 'world-v1', title: '世界设定',
    fields: { rules: { weather: '持续阴雨' }, continuity: { palette: '青绿与钨丝黄' } },
  }];
  const canon = buildLongScriptStyleCanon({
    currentVersions,
    workingBrief: { style: '不应覆盖已保存风格', constraints: '不应覆盖已保存约束' },
  });
  assert.equal(canon.style, '潮湿霓虹现实主义');
  assert.equal(canon.tone, '克制');
  assert.equal(canon.constraints, '人物衣着跨场连续');
  assert.deepEqual(canon.worldRules, { weather: '持续阴雨' });

  const mutation = prepareLongScriptProductionBriefMutation({
    currentVersions,
    workingBrief: { audience: '都市青年', style: '', constraints: '' },
  });
  assert.equal(mutation.baseVersionId, 'brief-v1');
  assert.equal(mutation.fields.audience, '都市青年');
  assert.equal(mutation.fields.style, '潮湿霓虹现实主义');
  assert.equal(mutation.fields.constraints, '人物衣着跨场连续');
});
const {
  createScopedWorkArtifactMutation,
  latestWorkArtifactVersions,
  normalizeWorkArtifactVersion,
} = require('../backend/src/services/creatorAgentWorkArtifacts.js');

function chineseScript(count) {
  return Array.from({ length: count }, (_, index) => (
    `第 ${index + 1} 场：地点 ${index + 1}\n人物在场景 ${index + 1} 完成明确动作。`
  )).join('\n\n');
}

test('long script splitter uses explicit scene headings and never guesses prose paragraphs', () => {
  const parsed = splitLongScriptScenes([
    '项目说明：这是一部长剧。',
    '',
    '第 1 场：雨夜车站',
    '林夏拖着行李进入站台。',
    '',
    '第 2 场：清晨列车',
    '林夏在车窗上写下名字。',
  ].join('\n'));
  assert.equal(parsed.explicitHeadings, true);
  assert.equal(parsed.scenes.length, 2);
  assert.equal(parsed.preamble, '项目说明：这是一部长剧。');
  assert.equal(parsed.scenes.map((scene) => scene.sourceText).join(''), parsed.source);
  assert.match(parsed.scenes[0].sourceText, /林夏拖着行李/u);
  assert.equal(parsed.scenes[0].end, parsed.scenes[1].start);

  const english = splitLongScriptScenes('INT. STATION - NIGHT\nA waits.\n\nEXT. ROAD - DAWN\nA leaves.');
  assert.equal(english.explicitHeadings, true);
  assert.deepEqual(english.scenes.map((scene) => scene.title), [
    'INT. STATION - NIGHT', 'EXT. ROAD - DAWN',
  ]);

  const prose = splitLongScriptScenes('第一段只是人物简介。\n\n第二段只是故事梗概。');
  assert.equal(prose.explicitHeadings, false);
  assert.equal(prose.scenes.length, 1);
  assert.equal(prose.scenes[0].sourceText.includes('第二段'), true);
});

test('explicit scene mode turns one short idea into an atomic recoverable draft without changing source', () => {
  const source = '一个女孩在雨夜末班车站，终于决定离开家乡。';
  const prepared = prepareLongScriptImport({
    sessionId: 'creator-short-scene-draft',
    source,
    currentVersions: [],
    existingSnapshot: null,
    allowSingleScene: true,
  });
  assert.ok(prepared);
  assert.equal(prepared.previewWork.activeScenes.length, 1);
  const scene = prepared.previewWork.activeScenes[0];
  const context = buildSceneContextPack({
    work: prepared.previewWork,
    sceneId: scene.sceneId,
    mode: 'scene-draft',
    userIntent: source,
    workSnapshot: null,
  });
  assert.deepEqual(context.requiredPaths, ['draftText']);
  const draftText = '外景·末班车站·雨夜\n\n女孩攥紧单程票，广播报出末班车进站。她回头看了一眼空荡的街口，转身踏过黄线。';
  const patched = applyScenePatchToLongScriptImport({
    importPlan: prepared,
    contextPack: context,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1',
      sceneId: context.sceneId,
      scenePartId: context.scenePartId,
      baseWorkRevision: context.baseWorkRevision,
      baseSceneRevision: context.baseSceneRevision,
      contextDigest: context.contextDigest,
      patch: { draftText, status: 'draft' },
      entityProposals: [],
      relationshipProposals: [],
      conflicts: [],
    },
    currentVersions: [],
    existingSnapshot: null,
  });
  assert.ok(patched);
  const committed = createScopedWorkArtifactMutation({
    sessionId: 'creator-short-scene-draft',
    taskProfile: patched.taskProfile,
    expectedWorkRevision: patched.expectedWorkRevision,
    mutations: patched.mutations,
  });
  assert.equal(committed.status, 'created');
  assert.equal(committed.snapshot.revision, 1);
  const restored = readLongScriptWork(latestWorkArtifactVersions(committed.versions), committed.snapshot);
  const restoredPart = restored.sourcePartsBySceneId.get(scene.sceneId)[0];
  assert.equal(restoredPart.sourceText, source);
  assert.equal(restored.draftsByScenePartId.get(restoredPart.scenePartId).draftText, draftText);
  assert.notEqual(restored.draftsByScenePartId.get(restoredPart.scenePartId).draftText, restoredPart.sourceText);
});

test('300/500-scene import stays bounded in stable scoped shards and compiles as formal work', () => {
  const prepared = prepareLongScriptImport({
    sessionId: 'creator-long-500',
    source: chineseScript(500),
    title: '五百场连续剧',
    currentVersions: [],
    existingSnapshot: null,
  });
  assert.ok(prepared);
  assert.equal(prepared.previewWork.activeScenes.length, 500);
  assert.ok(prepared.mutations.length <= 1 + 32 + 8 + 16);
  assert.equal(prepared.previewWork.sourceIntegrityErrors.length, 0);
  assert.equal(new Set(prepared.previewWork.activeScenes.map((scene) => scene.sceneId)).size, 500);
  for (const mutation of prepared.mutations) {
    const scenes = mutation.fields.scenes;
    if (scenes) assert.ok(scenes.length <= 120);
  }
  const compiled = createScopedWorkArtifactMutation({
    sessionId: 'creator-long-500',
    taskProfile: prepared.taskProfile,
    expectedWorkRevision: prepared.expectedWorkRevision,
    mutations: prepared.mutations,
  });
  assert.equal(compiled.status, 'created');
  assert.equal(compiled.snapshot.revision, 1);
  assert.equal(compiled.snapshot.artifactVersionIds.length, prepared.mutations.length);
  compiled.createdVersions.forEach((version) => {
    assert.deepEqual(normalizeWorkArtifactVersion(version), version);
  });
});

test('1,000 short scenes and 500 dense scenes fit artifact limits without dropping source', () => {
  const thousand = prepareLongScriptImport({
    sessionId: 'creator-long-1000-capacity',
    source: chineseScript(1_000),
    currentVersions: [],
    existingSnapshot: null,
  });
  assert.ok(thousand);
  assert.equal(thousand.previewWork.activeScenes.length, 1_000);
  assert.equal(thousand.previewWork.manifest.orderShardCount, 10);
  thousand.mutations.filter((mutation) => mutation.scopeKey.startsWith('order-'))
    .forEach((mutation) => assert.ok(mutation.fields.scenes.length <= 100));
  const thousandCommit = createScopedWorkArtifactMutation({
    sessionId: 'creator-long-1000-capacity', taskProfile: thousand.taskProfile,
    expectedWorkRevision: 0, mutations: thousand.mutations,
  });
  assert.equal(thousandCommit.status, 'created');

  const denseSource = Array.from({ length: 500 }, (_, index) => (
    `第 ${index + 1} 场：密集场 ${index + 1}\n${'场'.repeat(2_900)}`
  )).join('\n\n');
  const dense = prepareLongScriptImport({
    sessionId: 'creator-long-500-dense-capacity',
    source: denseSource,
    currentVersions: [],
    existingSnapshot: null,
  });
  assert.ok(dense);
  dense.mutations.filter((mutation) => mutation.scopeKey.startsWith('scene-'))
    .flatMap((mutation) => mutation.fields.scenes)
    .forEach((scene) => assert.equal(Object.hasOwn(scene, 'sourceText'), false));
  const denseCommit = createScopedWorkArtifactMutation({
    sessionId: 'creator-long-500-dense-capacity', taskProfile: dense.taskProfile,
    expectedWorkRevision: 0, mutations: dense.mutations,
  });
  assert.equal(denseCommit.status, 'created');
  const restored = readLongScriptWork(
    latestWorkArtifactVersions(denseCommit.versions), denseCommit.snapshot,
  );
  assert.equal(restored.activeScenes.length, 500);
  assert.equal(restored.sourceDocumentIntegrity, true);
  assert.equal(restored.activeScenes.map((scene) => (
    restored.sourceTextBySceneId.get(scene.sceneId) || ''
  )).join(''), denseSource);
});

test('a long scene persists every source unit and advances one stable part at a time', () => {
  const longBody = Array.from({ length: 620 }, (_, index) => (
    `动作 ${String(index + 1).padStart(3, '0')}：林溪沿着站台前进，保留这一句的精确顺序。`
  )).join('\n');
  const source = `第 1 场：漫长站台\n${longBody}\n\n第 2 场：出口\n林溪走出车站。`;
  const parsed = splitLongScriptScenes(source);
  const prepared = prepareLongScriptImport({
    sessionId: 'creator-long-scene-parts', source, currentVersions: [], existingSnapshot: null,
  });
  assert.ok(prepared);
  let committed = createScopedWorkArtifactMutation({
    sessionId: 'creator-long-scene-parts', taskProfile: prepared.taskProfile,
    expectedWorkRevision: 0, mutations: prepared.mutations,
  });
  assert.equal(committed.status, 'created');
  let currentVersions = latestWorkArtifactVersions(committed.versions);
  let work = readLongScriptWork(currentVersions, committed.snapshot);
  const sceneId = work.activeScenes[0].sceneId;
  const parts = work.sourcePartsBySceneId.get(sceneId);
  assert.ok(parts.length >= 4);
  assert.equal(work.sourceIntegrityErrors.length, 0);
  assert.equal(work.sourceDocumentIntegrity, true);
  assert.equal(parts.map((part) => part.sourceText).join(''), parsed.scenes[0].sourceText);
  assert.equal(work.sourceTextBySceneId.get(sceneId), parsed.scenes[0].sourceText);
  assert.equal(new Set(parts.map((part) => part.scenePartId)).size, parts.length);
  const corruptedVersions = structuredClone(currentVersions);
  const sourceShard = corruptedVersions.find((version) => version.scopeKey?.startsWith('source-'));
  sourceShard.fields.source.parts[0].data = `${sourceShard.fields.source.parts[0].data.slice(0, -1)}A`;
  const corruptedWork = readLongScriptWork(corruptedVersions, committed.snapshot);
  assert.equal(corruptedWork.sourceDocumentIntegrity, false);
  assert.equal(buildSceneContextPack({
    work: corruptedWork, sceneId, userIntent: '继续当前段', workSnapshot: committed.snapshot,
  }), null, 'damaged source must fail closed instead of silently skipping text');

  const seen = [];
  while (true) {
    const context = buildSceneContextPack({
      work, sceneId, userIntent: '只推进当前段', workSnapshot: committed.snapshot,
    });
    assert.ok(context);
    seen.push(context.scenePartId);
    assert.equal(context.scene.sourceText, parts[context.scenePartIndex].sourceText);
    assert.equal(normalizeScenePatch({
      schema: 't8-creator-scene-patch-v1',
      sceneId,
      scenePartId: 'scene_part_stale',
      baseWorkRevision: context.baseWorkRevision,
      baseSceneRevision: context.baseSceneRevision,
      contextDigest: context.contextDigest,
      patch: { purpose: '不应接受的旧段补丁' },
    }, context), null);
    if (context.scenePartIndex === context.scenePartCount - 1) break;
    const planned = prepareScenePartAdvanceMutation({
      work, sceneId, currentVersions, existingSnapshot: committed.snapshot,
      expectedWorkRevision: committed.snapshot.revision,
    });
    assert.ok(planned);
    committed = createScopedWorkArtifactMutation({
      sessionId: 'creator-long-scene-parts', existingVersions: committed.versions,
      existingSnapshot: committed.snapshot, ...planned,
    });
    assert.equal(committed.status, 'created');
    currentVersions = latestWorkArtifactVersions(committed.versions);
    work = readLongScriptWork(currentVersions, committed.snapshot);
  }
  assert.deepEqual(seen, parts.map((part) => part.scenePartId));
  assert.equal(new Set(seen).size, parts.length, 'no part may repeat or be skipped');
  assert.equal(work.sourceTextBySceneId.get(sceneId), parsed.scenes[0].sourceText);
});

test('content-defined scene parts keep unaffected identities after local source edits', () => {
  const source = Array.from({ length: 620 }, (_, index) => (
    `动作 ${index + 1}：林溪沿着站台前进，保留这一句的精确顺序。`
  )).join('\n');
  const scene = { sceneId: 'scene-stable-parts', sourceRef: { span: { start: 0, end: source.length } } };
  const original = splitSceneSourceParts(scene, source);
  const atStart = splitSceneSourceParts(scene, `甲${source}`);
  const midpoint = Math.floor(source.length / 2);
  const inMiddle = splitSceneSourceParts(scene, `${source.slice(0, midpoint)}甲${source.slice(midpoint)}`);
  const originalIds = new Set(original.map((part) => part.scenePartId));
  const retainedAtStart = atStart.filter((part) => originalIds.has(part.scenePartId)).length;
  const retainedInMiddle = inMiddle.filter((part) => originalIds.has(part.scenePartId)).length;
  assert.ok(original.length >= 4);
  assert.ok(retainedAtStart >= original.length - 2, 'a prefix edit must resynchronize after its local window');
  assert.ok(retainedInMiddle >= original.length - 2, 'a middle edit must preserve unaffected part identities');
  assert.equal(atStart.map((part) => part.text).join(''), `甲${source}`);
  assert.equal(inMiddle.map((part) => part.text).join(''), `${source.slice(0, midpoint)}甲${source.slice(midpoint)}`);
});

test('scene reconciliation preserves IDs across insert and move, and tombstones only deletions', () => {
  const first = reconcileLongScriptScenes({
    sessionId: 'creator-reconcile',
    scriptId: 'script-stable',
    source: [
      '第 1 场：甲地\n甲事件。',
      '第 2 场：乙地\n乙事件。',
      '第 3 场：丙地\n丙事件。',
    ].join('\n\n'),
  });
  const ids = Object.fromEntries(first.scenes.map((scene) => [scene.title, scene.sceneId]));
  const second = reconcileLongScriptScenes({
    sessionId: 'creator-reconcile',
    scriptId: 'script-stable',
    previousScenes: first.scenes,
    source: [
      '第 3 场：丙地\n丙事件。',
      '第 1 场：甲地\n甲事件。',
      '第 4 场：丁地\n丁事件。',
    ].join('\n\n'),
  });
  const active = second.scenes.filter((scene) => !scene.deleted);
  assert.equal(active.find((scene) => scene.title.includes('丙地')).sceneId, ids['第 3 场：丙地']);
  assert.equal(active.find((scene) => scene.title.includes('甲地')).sceneId, ids['第 1 场：甲地']);
  const deleted = second.scenes.find((scene) => scene.sceneId === ids['第 2 场：乙地']);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.status, 'stale');
  assert.equal(new Set(active.map((scene) => scene.sceneId)).size, 3);
});

test('scene split and merge allocate fresh IDs with stable lineage and never reuse tombstones', () => {
  const originalSource = [
    '第一场：雨夜车站',
    '林溪走进站台。',
    '她握紧旧车票。',
    '第二场：清晨天台',
    '周野站在天台边缘。',
  ].join('\n');
  const original = reconcileLongScriptScenes({
    sessionId: 'session-lineage',
    scriptId: 'script-lineage',
    documentVersionId: 'source-original',
    source: originalSource,
    previousScenes: [],
  });
  const originalActive = original.scenes.filter((scene) => !scene.deleted);
  const originalFirstId = originalActive[0].sceneId;

  const splitSource = [
    '第一场：进入站台',
    '林溪走进站台。',
    '第二场：握紧车票',
    '她握紧旧车票。',
    '第三场：清晨天台',
    '周野站在天台边缘。',
  ].join('\n');
  const split = reconcileLongScriptScenes({
    sessionId: 'session-lineage',
    scriptId: 'script-lineage',
    documentVersionId: 'source-split',
    source: splitSource,
    previousScenes: original.scenes,
  });
  const splitActive = split.scenes.filter((scene) => !scene.deleted);
  const splitChildren = splitActive.filter((scene) => scene.derivedFromSceneIds.includes(originalFirstId));
  assert.equal(splitChildren.length, 2);
  assert.equal(splitChildren.some((scene) => scene.sceneId === originalFirstId), false);
  assert.equal(split.scenes.find((scene) => scene.sceneId === originalFirstId)?.deleted, true);

  const splitAgain = reconcileLongScriptScenes({
    sessionId: 'session-lineage',
    scriptId: 'script-lineage',
    documentVersionId: 'source-split',
    source: splitSource,
    previousScenes: split.scenes,
  });
  assert.deepEqual(
    splitAgain.scenes.filter((scene) => !scene.deleted).map((scene) => scene.sceneId),
    splitActive.map((scene) => scene.sceneId),
  );

  const mergedSource = [
    '第一场：车票抉择',
    '林溪走进站台。',
    '她握紧旧车票。',
    '第二场：清晨天台',
    '周野站在天台边缘。',
  ].join('\n');
  const merged = reconcileLongScriptScenes({
    sessionId: 'session-lineage',
    scriptId: 'script-lineage',
    documentVersionId: 'source-merged',
    source: mergedSource,
    previousScenes: split.scenes,
  });
  const mergedActive = merged.scenes.filter((scene) => !scene.deleted);
  const mergedFirst = mergedActive[0];
  assert.notEqual(mergedFirst.sceneId, originalFirstId);
  assert.deepEqual(new Set(mergedFirst.derivedFromSceneIds), new Set(splitChildren.map((scene) => scene.sceneId)));
  for (const child of splitChildren) {
    assert.equal(merged.scenes.find((scene) => scene.sceneId === child.sceneId)?.deleted, true);
  }

  const deletedOnce = reconcileLongScriptScenes({
    sessionId: 'session-lineage',
    scriptId: 'script-lineage',
    documentVersionId: 'source-deleted',
    source: [
      '第一场：清晨天台',
      '周野站在天台边缘。',
      '第二场：午后旧屋',
      '林溪推开旧屋的门。',
    ].join('\n'),
    previousScenes: merged.scenes,
  });
  const restored = reconcileLongScriptScenes({
    sessionId: 'session-lineage',
    scriptId: 'script-lineage',
    documentVersionId: 'source-restored',
    source: mergedSource,
    previousScenes: deletedOnce.scenes,
  });
  const restoredFirst = restored.scenes.find((scene) => !scene.deleted && /车票抉择/u.test(scene.title));
  assert.ok(restoredFirst);
  assert.notEqual(restoredFirst.sceneId, mergedFirst.sceneId);
});

test('scene context carries only current source and latest confirmed entity exit after 30 scenes', () => {
  const scenes = Array.from({ length: 31 }, (_, index) => ({
    schema: 't8-creator-scene-record-v1',
    sceneId: `scene-${index + 1}`,
    orderKey: String((index + 1) * 10).padStart(8, '0'),
    title: `第 ${index + 1} 场`,
    sourceRef: { documentVersionId: 'source-1', span: { start: index * 20, end: index * 20 + 10 }, digest: String(index).padStart(64, '0') },
    sourceText: index === 30 ? '第三十一场当前正文，只出现林夏。' : `不应进入上下文的第 ${index + 1} 场正文。`,
    status: index === 0 ? 'confirmed' : 'draft',
    purpose: '', objective: '', obstacle: '', turn: '', valueChange: '',
    activeEntityIds: index === 0 || index === 30 ? ['character-linxia'] : [],
    locationId: null,
    entryRefs: [],
    exitState: index === 0 ? {
      'character-linxia': { wardrobeId: 'coat-red', injury: 'left-hand-bandage', knowledge: ['train-delayed'] },
    } : {},
    hardConstraintIds: [], locks: [], recordRevision: 1, derivedFromSceneIds: [], deleted: false,
  }));
  const pack = buildSceneContextPack({
    work: {
      scriptId: 'script-context', scenes,
      entities: [{ entityId: 'character-linxia', name: '林夏', identityRevision: 3 }],
    },
    sceneId: 'scene-31',
    userIntent: '继续制作这一场',
    workSnapshot: { workId: `cw_${'a'.repeat(32)}`, revision: 7, workDigest: 'b'.repeat(64) },
  });
  assert.equal(pack.sceneId, 'scene-31');
  assert.match(pack.scene.sourceText, /第三十一场当前正文/u);
  assert.doesNotMatch(JSON.stringify(pack), /不应进入上下文/u);
  assert.equal(pack.activeEntities[0].entry.fromSceneId, 'scene-1');
  assert.equal(pack.activeEntities[0].entry.state.wardrobeId, 'coat-red');
  assert.equal(pack.baseWorkRevision, 7);
});

test('current source can select a previously known entity without duplicating its baseline', () => {
  const scenes = [{
    sceneId: 'scene-1', orderKey: '00000010', title: '初见', sourceText: '林溪离开车站。',
    sourceRef: { documentVersionId: 'source-1', span: { start: 0, end: 10 }, digest: 'a'.repeat(64) },
    status: 'confirmed', activeEntityIds: ['entity-linxi'],
    exitState: { 'entity-linxi': { wardrobe: '黑色风衣', injury: '左手缠着绷带' } },
    hardConstraintIds: [], locks: [], recordRevision: 2, deleted: false,
  }, {
    sceneId: 'scene-31', orderKey: '00000310', title: '旧屋重现', sourceText: '林溪把旧车票收进口袋。',
    sourceRef: { documentVersionId: 'source-1', span: { start: 100, end: 120 }, digest: 'b'.repeat(64) },
    status: 'draft', activeEntityIds: [], exitState: {},
    hardConstraintIds: [], locks: [], recordRevision: 1, deleted: false,
  }];
  const pack = buildSceneContextPack({
    work: {
      scriptId: 'script-mentioned', scenes,
      entities: [{
        entityId: 'entity-linxi', kind: 'character', name: '林溪', aliases: ['小溪'],
        baseline: { identity: '离家多年的女儿' },
      }],
    },
    sceneId: 'scene-31', userIntent: '延续林溪此前的状态',
    workSnapshot: { revision: 9, workDigest: 'c'.repeat(64) },
  });
  assert.equal(pack.activeEntities.length, 0);
  assert.equal(pack.mentionedEntities.length, 1);
  assert.equal(pack.mentionedEntities[0].entityId, 'entity-linxi');
  assert.equal(pack.mentionedEntities[0].baseline.baseline.identity, '离家多年的女儿');
  assert.equal(pack.mentionedEntities[0].entry.fromSceneId, 'scene-1');
  assert.equal(pack.mentionedEntities[0].entry.state.injury, '左手缠着绷带');
});

test('scene patches are bound to exact work, scene revision, digest and allowed fields', () => {
  const work = {
    scriptId: 'script-patch',
    scenes: [{
      sceneId: 'scene-current', orderKey: '00000010', title: '当前场',
      sourceRef: { documentVersionId: 'source-1', span: { start: 0, end: 10 }, digest: 'a'.repeat(64) },
      sourceText: '当前场正文', status: 'draft', activeEntityIds: [], exitState: {},
      hardConstraintIds: [], locks: [], recordRevision: 4, deleted: false,
    }],
    entities: [],
  };
  const context = buildSceneContextPack({
    work, sceneId: 'scene-current', userIntent: '加强冲突',
    workSnapshot: { revision: 9, workDigest: 'b'.repeat(64) },
  });
  const valid = normalizeScenePatch({
    schema: 't8-creator-scene-patch-v1',
    sceneId: 'scene-current',
    baseWorkRevision: 9,
    baseSceneRevision: 4,
    contextDigest: context.contextDigest,
    patch: { objective: '赶上末班车', obstacle: '检票口提前关闭' },
  }, context);
  assert.ok(valid);
  assert.equal(valid.patch.obstacle, '检票口提前关闭');
  assert.equal(normalizeScenePatch({ ...valid, baseSceneRevision: 3 }, context), null);
  assert.equal(normalizeScenePatch({ ...valid, patch: { sourceText: '越权改原文' } }, context), null);

  const orphanProposal = normalizeScenePatch({
    ...valid,
    patch: { objective: '等到末班车' },
    entityProposals: [{
      tempId: 'new-linxi', kind: 'character', name: '林溪',
      baseline: { identity: '离家多年的女儿' },
    }],
  }, context);
  assert.equal(orphanProposal, null, '未加入当前场的新实体不得形成半完成补丁');

  const activeProposal = normalizeScenePatch({
    ...valid,
    patch: { objective: '等到末班车', activeEntityIds: ['new-linxi'] },
    entityProposals: [{
      tempId: 'new-linxi', kind: 'character', name: '林溪',
      baseline: { identity: '离家多年的女儿' },
    }],
  }, context);
  assert.ok(activeProposal);
  assert.equal(normalizeScenePatch({
    ...valid,
    patch: { activeEntityIds: ['new-coat'] },
    entityProposals: [{ tempId: 'new-coat', kind: 'costume', name: '黑色风衣' }],
  }, context), null, '非法实体 kind 不得静默降级为 character');

  const exitContext = buildSceneContextPack({
    work,
    sceneId: 'scene-current',
    userIntent: '新增人物林溪，本场结束时她仍穿黑色风衣、左手缠着绷带并握着旧车票。',
    workSnapshot: { revision: 9, workDigest: 'b'.repeat(64) },
  });
  assert.deepEqual(exitContext.requiredPaths, ['exitState']);
  assert.deepEqual(exitContext.requiredContinuityTerms, ['黑色风衣', '绷带', '旧车票']);
  assert.deepEqual(exitContext.requiredContinuitySubjectNames, ['林溪']);
  assert.equal(normalizeScenePatch({ ...valid, contextDigest: exitContext.contextDigest }, exitContext), null,
    '明确要求的本场结束状态不得被静默遗漏');
  assert.equal(normalizeScenePatch({
    ...valid,
    contextDigest: exitContext.contextDigest,
    patch: {
      activeEntityIds: ['new-linxi'],
      exitState: { 'new-linxi': '仍穿黑色风衣，左手缠着绷带并握着旧车票' },
    },
    entityProposals: [{ tempId: 'new-linxi', kind: 'character', name: '林溪', baseline: {} }],
  }, exitContext), null, '结构化离场状态不得以字符串冒充对象');
  assert.equal(normalizeScenePatch({
    ...valid,
    contextDigest: exitContext.contextDigest,
    patch: {
      activeEntityIds: ['new-linxi'],
      exitState: { 林溪: { wardrobe: '黑色风衣', injury: '左手缠着绷带', prop: '旧车票' } },
    },
    entityProposals: [{ tempId: 'new-linxi', kind: 'character', name: '林溪', baseline: {} }],
  }, exitContext), null, '连续性事实不得挂在会被提交阶段过滤的人物姓名键下');
  assert.ok(normalizeScenePatch({
    ...valid,
    contextDigest: exitContext.contextDigest,
    patch: {
      objective: '赶上末班车',
      activeEntityIds: ['new-linxi'],
      exitState: { 'new-linxi': { wardrobe: '黑色风衣', injury: '左手缠着绷带', prop: '旧车票' } },
    },
    entityProposals: [{ tempId: 'new-linxi', kind: 'character', name: '林溪', baseline: {} }],
  }, exitContext));
});

test('a current-scene patch updates one shard, allocates new entity IDs, and preserves sibling scenes', () => {
  const imported = prepareLongScriptImport({
    sessionId: 'creator-scene-mutation',
    source: '第 1 场：雨夜车站\n林溪等待列车。\n\n第 2 场：清晨天台\n林溪准备告别。',
  });
  const first = createScopedWorkArtifactMutation({
    sessionId: 'creator-scene-mutation', expectedWorkRevision: 0,
    taskProfile: imported.taskProfile, mutations: imported.mutations,
  });
  assert.equal(first.status, 'created');
  const work = readLongScriptWork(first.createdVersions, first.snapshot);
  const currentScene = work.activeScenes[1];
  const context = buildSceneContextPack({
    work, sceneId: currentScene.sceneId, userIntent: '加入新人并只改当前场',
    workSnapshot: first.snapshot,
  });
  const patch = {
    schema: 't8-creator-scene-patch-v1',
    sceneId: currentScene.sceneId,
    scenePartId: context.scenePartId,
    baseWorkRevision: context.baseWorkRevision,
    baseSceneRevision: context.baseSceneRevision,
    contextDigest: context.contextDigest,
    patch: {
      purpose: '完成告别',
      activeEntityIds: ['new-zhouye'],
      exitState: { 'new-zhouye': { wardrobe: '灰色夹克', knowledge: '知道林溪要离开' } },
      status: 'confirmed',
    },
    entityProposals: [{
      tempId: 'new-zhouye', kind: 'character', name: '周野',
      baseline: { identity: '林溪的旧友' },
    }],
    conflicts: [],
  };
  const planned = prepareScenePatchMutation({
    contextPack: context, scenePatch: patch, work,
    currentVersions: first.createdVersions, existingSnapshot: first.snapshot,
    allowConfirm: false,
  });
  assert.ok(planned);
  assert.equal(planned.mutations.filter((item) => item.kind === 'ScriptDoc').length, 1);
  assert.equal(planned.mutations.filter((item) => item.kind === 'CharacterBible').length, 1);
  assert.equal(planned.scene.status, 'draft');
  assert.equal(planned.scene.activeEntityIds.length, 1);
  assert.match(planned.scene.activeEntityIds[0], /^entity_[a-f0-9]{24}$/u);
  assert.deepEqual(Object.keys(planned.scene.exitState), planned.scene.activeEntityIds);
  const second = createScopedWorkArtifactMutation({
    sessionId: 'creator-scene-mutation',
    existingSnapshot: first.snapshot,
    existingVersions: first.createdVersions,
    ...planned,
  });
  assert.equal(second.status, 'created');
  assert.equal(second.snapshot.revision, 2);
  const restored = readLongScriptWork(latestWorkArtifactVersions(second.versions), second.snapshot);
  assert.equal(restored.sourceTextBySceneId.get(restored.activeScenes[0].sceneId),
    work.sourceTextBySceneId.get(work.activeScenes[0].sceneId));
  assert.equal(restored.activeScenes[0].recordRevision, work.activeScenes[0].recordRevision);
  assert.equal(restored.activeScenes[1].purpose, '完成告别');
  assert.equal(restored.entities[0].name, '周野');

  const knownEntityId = restored.entities[0].entityId;
  const reuseContext = buildSceneContextPack({
    work: restored, sceneId: restored.activeScenes[1].sceneId, userIntent: '让周野继续留在当前场',
    workSnapshot: second.snapshot,
  });
  const reusePlan = prepareScenePatchMutation({
    contextPack: reuseContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: reuseContext.sceneId,
      scenePartId: reuseContext.scenePartId, baseWorkRevision: reuseContext.baseWorkRevision,
      baseSceneRevision: reuseContext.baseSceneRevision, contextDigest: reuseContext.contextDigest,
      patch: { activeEntityIds: ['same-zhouye'] },
      entityProposals: [{ tempId: 'same-zhouye', kind: 'character', name: '周野', baseline: { identity: '错误覆盖' } }],
      conflicts: [],
    },
    work: restored, currentVersions: latestWorkArtifactVersions(second.versions),
    existingSnapshot: second.snapshot, allowConfirm: false,
  });
  assert.ok(reusePlan);
  assert.equal(reusePlan.createdEntities.length, 0, 'an existing same-kind identity must be reused');
  assert.deepEqual(reusePlan.scene.activeEntityIds, [knownEntityId]);
  const invalidLocation = prepareScenePatchMutation({
    contextPack: reuseContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: reuseContext.sceneId,
      scenePartId: reuseContext.scenePartId, baseWorkRevision: reuseContext.baseWorkRevision,
      baseSceneRevision: reuseContext.baseSceneRevision, contextDigest: reuseContext.contextDigest,
      patch: { locationId: knownEntityId }, entityProposals: [], conflicts: [],
    },
    work: restored, currentVersions: latestWorkArtifactVersions(second.versions),
    existingSnapshot: second.snapshot, allowConfirm: false,
  });
  assert.equal(invalidLocation, null, 'locationId must reference a location entity');
});

test('editing a confirmed exit state marks only its explicit downstream dependency chain stale', () => {
  const entityId = 'entity-linxi';
  const otherId = 'entity-zhouye';
  const firstExit = { wardrobe: '黑色风衣', relationship: { with: otherId, status: '盟友' } };
  const firstDigest = digest(firstExit);
  const secondExit = { wardrobe: '黑色风衣', relationship: { with: otherId, status: '盟友' }, location: '天台' };
  const secondDigest = digest(secondExit);
  const scenes = [{
    sceneId: 'scene-one', orderKey: '00000010', title: '第一场', sourceText: '林溪离开车站。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 0, end: 8 }, digest: 'a'.repeat(64) },
    status: 'confirmed', activeEntityIds: [entityId], entryRefs: [], exitState: { [entityId]: firstExit },
    recordRevision: 2, deleted: false,
  }, {
    sceneId: 'scene-two', orderKey: '00000020', title: '第二场', sourceText: '林溪登上天台。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 8, end: 16 }, digest: 'b'.repeat(64) },
    status: 'confirmed', activeEntityIds: [entityId],
    entryRefs: [{ entityId, fromSceneId: 'scene-one', exitDigest: firstDigest }],
    exitState: { [entityId]: secondExit }, recordRevision: 3, deleted: false,
  }, {
    sceneId: 'scene-three', orderKey: '00000030', title: '第三场', sourceText: '林溪回到旧屋。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 16, end: 24 }, digest: 'c'.repeat(64) },
    status: 'confirmed', activeEntityIds: [entityId],
    entryRefs: [{ entityId, fromSceneId: 'scene-two', exitDigest: secondDigest }],
    exitState: { [entityId]: secondExit }, recordRevision: 4, deleted: false,
  }, {
    sceneId: 'scene-independent', orderKey: '00000040', title: '独立场', sourceText: '周野独自打电话。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 24, end: 32 }, digest: 'd'.repeat(64) },
    status: 'confirmed', activeEntityIds: [otherId], entryRefs: [],
    exitState: { [otherId]: { knowledge: '接到电话' } }, recordRevision: 5, deleted: false,
  }];
  const snapshot = { revision: 7, workDigest: 'e'.repeat(64), taskProfile: {
    family: 'story', intent: '逐场推进', deliveryKind: 'long-form-story', modalities: ['text'], qualityMode: 'standard',
  } };
  const work = {
    scriptId: 'script-dependency', scenes, activeScenes: scenes,
    entities: [
      { entityId, kind: 'character', name: '林溪', baseline: {} },
      { entityId: otherId, kind: 'character', name: '周野', baseline: {} },
    ], snapshot,
  };
  const scopeBuckets = new Map();
  scenes.forEach((scene) => {
    const scopeKey = sceneScopeKey(scene.sceneId);
    scopeBuckets.set(scopeKey, [...(scopeBuckets.get(scopeKey) || []), scene]);
  });
  const currentVersions = [...scopeBuckets.entries()].map(([scopeKey, values], index) => ({
    kind: 'ScriptDoc', scopeKey, versionId: `scene-version-${index}`, title: scopeKey,
    fields: { scenes: values },
  }));
  const context = buildSceneContextPack({
    work, sceneId: 'scene-one', userIntent: '把林溪离场服装改成白色大衣。', workSnapshot: snapshot,
  });
  const planned = prepareScenePatchMutation({
    contextPack: context,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: context.sceneId,
      scenePartId: context.scenePartId, baseWorkRevision: context.baseWorkRevision,
      baseSceneRevision: context.baseSceneRevision, contextDigest: context.contextDigest,
      patch: { activeEntityIds: [entityId], exitState: { [entityId]: {
        wardrobe: '白色大衣', relationship: { with: otherId, status: '盟友' },
      } } },
      entityProposals: [], conflicts: [],
    },
    work, currentVersions, existingSnapshot: snapshot, allowConfirm: false,
  });
  assert.ok(planned);
  const changed = planned.mutations.filter((mutation) => mutation.kind === 'ScriptDoc')
    .flatMap((mutation) => mutation.fields.scenes);
  const byId = new Map(changed.map((scene) => [scene.sceneId, scene]));
  assert.equal(byId.get('scene-one').status, 'draft');
  assert.equal(byId.get('scene-two').status, 'stale');
  assert.equal(byId.get('scene-three').status, 'stale');
  assert.equal((byId.get('scene-independent') || scenes[3]).status, 'confirmed');
});

test('an explicit per-character continuity reset stops stale propagation without affecting other scenes', () => {
  const entityId = 'entity-linxi-reset';
  const firstExit = { wardrobe: '黑色风衣' };
  const resetExit = { wardrobe: '白色大衣' };
  const scenes = [{
    sceneId: 'scene-reset-source', orderKey: '00000010', title: '旧段落', sourceText: '林溪穿黑色风衣离开。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 0, end: 10 }, digest: '1'.repeat(64) },
    status: 'confirmed', activeEntityIds: [entityId], entryRefs: [],
    continuityResetEntityIds: [], exitState: { [entityId]: firstExit }, recordRevision: 2, deleted: false,
  }, {
    sceneId: 'scene-reset-boundary', orderKey: '00000020', title: '独立段落', sourceText: '从这里开始独立连续性。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 10, end: 22 }, digest: '2'.repeat(64) },
    status: 'confirmed', activeEntityIds: [entityId], continuityResetEntityIds: [entityId],
    entryRefs: [{ entityId, fromSceneId: null, exitDigest: null, resetAtScene: true }],
    exitState: { [entityId]: resetExit }, recordRevision: 3, deleted: false,
  }, {
    sceneId: 'scene-after-reset', orderKey: '00000030', title: '新段落后续', sourceText: '林溪继续穿白色大衣。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 22, end: 34 }, digest: '3'.repeat(64) },
    status: 'confirmed', activeEntityIds: [entityId], continuityResetEntityIds: [],
    entryRefs: [{ entityId, fromSceneId: 'scene-reset-boundary', exitDigest: digest(resetExit) }],
    exitState: { [entityId]: resetExit }, recordRevision: 4, deleted: false,
  }];
  const snapshot = { revision: 4, workDigest: '4'.repeat(64), taskProfile: {
    family: 'story', intent: '逐场推进', deliveryKind: 'long-form-story', modalities: ['text'], qualityMode: 'standard',
  } };
  const work = {
    scriptId: 'script-reset-boundary', scenes, activeScenes: scenes,
    entities: [{ entityId, kind: 'character', name: '林溪', baseline: { wardrobe: '默认服装' } }],
    relationships: [], snapshot,
  };
  const scopeBuckets = new Map();
  scenes.forEach((scene) => {
    const scopeKey = sceneScopeKey(scene.sceneId);
    scopeBuckets.set(scopeKey, [...(scopeBuckets.get(scopeKey) || []), scene]);
  });
  const currentVersions = [...scopeBuckets.entries()].map(([scopeKey, values], index) => ({
    kind: 'ScriptDoc', scopeKey, versionId: `reset-scene-version-${index}`, title: scopeKey,
    fields: { scenes: values },
  }));
  const resetContext = buildSceneContextPack({
    work, sceneId: 'scene-reset-boundary', userIntent: '查看独立段落', workSnapshot: snapshot,
  });
  assert.equal(resetContext.activeEntities[0].entry.resetAtScene, true);
  assert.equal(resetContext.activeEntities[0].entry.state, null);
  assert.deepEqual(resetContext.relationships, []);
  assert.equal(normalizeScenePatch({
    schema: 't8-creator-scene-patch-v1', sceneId: resetContext.sceneId,
    scenePartId: resetContext.scenePartId, baseWorkRevision: resetContext.baseWorkRevision,
    baseSceneRevision: resetContext.baseSceneRevision, contextDigest: resetContext.contextDigest,
    patch: { activeEntityIds: [entityId], continuityResetEntityIds: ['entity-not-active'] },
    entityProposals: [], conflicts: [],
  }, resetContext), null, 'a reset boundary may only reference an active character');

  const sourceContext = buildSceneContextPack({
    work, sceneId: 'scene-reset-source', userIntent: '把离场服装改成红色大衣。', workSnapshot: snapshot,
  });
  const planned = prepareScenePatchMutation({
    contextPack: sourceContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: sourceContext.sceneId,
      scenePartId: sourceContext.scenePartId, baseWorkRevision: sourceContext.baseWorkRevision,
      baseSceneRevision: sourceContext.baseSceneRevision, contextDigest: sourceContext.contextDigest,
      patch: { activeEntityIds: [entityId], exitState: { [entityId]: { wardrobe: '红色大衣' } } },
      entityProposals: [], conflicts: [],
    },
    work, currentVersions, existingSnapshot: snapshot, allowConfirm: false,
  });
  assert.ok(planned);
  const changed = planned.mutations.filter((mutation) => mutation.kind === 'ScriptDoc')
    .flatMap((mutation) => mutation.fields.scenes || []);
  const changedById = new Map(changed.map((scene) => [scene.sceneId, scene]));
  assert.equal(changedById.get('scene-reset-source').status, 'draft');
  assert.equal((changedById.get('scene-reset-boundary') || scenes[1]).status, 'confirmed');
  assert.equal((changedById.get('scene-after-reset') || scenes[2]).status, 'confirmed');
});

test('multi-subject exit continuity keeps each requested fact on the correct person', () => {
  const scene = {
    sceneId: 'scene-two-people', orderKey: '00000010', title: '离场', sourceText: '林溪和周野离开车站。',
    sourceRef: { documentVersionId: 'legacy', span: { start: 0, end: 12 }, digest: 'a'.repeat(64) },
    status: 'draft', activeEntityIds: ['entity-linxi', 'entity-zhouye'], entryRefs: [], exitState: {},
    hardConstraintIds: [], locks: [], recordRevision: 1, deleted: false,
  };
  const work = {
    scriptId: 'script-two-people', scenes: [scene], activeScenes: [scene],
    entities: [
      { entityId: 'entity-linxi', kind: 'character', name: '林溪', aliases: [], baseline: {} },
      { entityId: 'entity-zhouye', kind: 'character', name: '周野', aliases: [], baseline: {} },
    ],
  };
  const context = buildSceneContextPack({
    work, sceneId: scene.sceneId,
    userIntent: '本场结束时林溪仍穿黑色风衣，周野仍拿着旧车票。',
    workSnapshot: { revision: 4, workDigest: 'b'.repeat(64) },
  });
  assert.deepEqual(context.requiredContinuityBySubject, [
    { subjectName: '林溪', terms: ['黑色风衣'] },
    { subjectName: '周野', terms: ['旧车票'] },
  ]);
  const base = {
    schema: 't8-creator-scene-patch-v1', sceneId: context.sceneId,
    scenePartId: context.scenePartId, baseWorkRevision: context.baseWorkRevision,
    baseSceneRevision: context.baseSceneRevision, contextDigest: context.contextDigest,
    entityProposals: [], conflicts: [],
  };
  assert.equal(normalizeScenePatch({
    ...base,
    patch: {
      activeEntityIds: ['entity-linxi', 'entity-zhouye'],
      exitState: {
        'entity-linxi': { prop: '旧车票' },
        'entity-zhouye': { wardrobe: '黑色风衣' },
      },
    },
  }, context), null, 'facts may not be swapped between subjects');
  assert.ok(normalizeScenePatch({
    ...base,
    patch: {
      activeEntityIds: ['entity-linxi', 'entity-zhouye'],
      exitState: {
        'entity-linxi': { wardrobe: '黑色风衣' },
        'entity-zhouye': { prop: '旧车票' },
      },
    },
  }, context));
});

test('relationship events become visible only after their scene and stale only later dependent people', () => {
  const imported = prepareLongScriptImport({
    sessionId: 'creator-relationships',
    source: [
      '第 1 场：初见\n林溪与周野在车站碰面。',
      '第 2 场：结盟\n两人决定合作。',
      '第 3 场：重逢\n两人在天台重逢。',
      '第 4 场：独处\n陈叔独自在店里盘点。',
    ].join('\n\n'),
  });
  let committed = createScopedWorkArtifactMutation({
    sessionId: 'creator-relationships', expectedWorkRevision: 0,
    taskProfile: imported.taskProfile, mutations: imported.mutations,
  });
  let versions = latestWorkArtifactVersions(committed.versions);
  let work = readLongScriptWork(versions, committed.snapshot);
  const [sceneOne, sceneTwo, sceneThree, sceneFour] = work.activeScenes;
  const firstContext = buildSceneContextPack({
    work, sceneId: sceneOne.sceneId, userIntent: '建立三个人物', workSnapshot: committed.snapshot,
  });
  const firstPlan = prepareScenePatchMutation({
    contextPack: firstContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: firstContext.sceneId,
      scenePartId: firstContext.scenePartId, baseWorkRevision: firstContext.baseWorkRevision,
      baseSceneRevision: firstContext.baseSceneRevision, contextDigest: firstContext.contextDigest,
      patch: {
        activeEntityIds: ['new-linxi', 'new-zhouye'],
        exitState: { 'new-linxi': { place: '车站' }, 'new-zhouye': { place: '车站' } },
        status: 'confirmed',
      },
      entityProposals: [
        { tempId: 'new-linxi', kind: 'character', name: '林溪', baseline: {} },
        { tempId: 'new-zhouye', kind: 'character', name: '周野', baseline: {} },
      ],
      conflicts: [],
    },
    work, currentVersions: versions, existingSnapshot: committed.snapshot, allowConfirm: true,
  });
  assert.ok(firstPlan);
  committed = createScopedWorkArtifactMutation({
    sessionId: 'creator-relationships', existingVersions: committed.versions,
    existingSnapshot: committed.snapshot, ...firstPlan,
  });
  versions = latestWorkArtifactVersions(committed.versions);
  work = readLongScriptWork(versions, committed.snapshot);
  const linxiId = work.entities.find((entity) => entity.name === '林溪').entityId;
  const zhouyeId = work.entities.find((entity) => entity.name === '周野').entityId;

  const relationContext = buildSceneContextPack({
    work, sceneId: sceneTwo.sceneId, userIntent: '这一场两人成为盟友', workSnapshot: committed.snapshot,
  });
  const backdated = normalizeScenePatch({
    schema: 't8-creator-scene-patch-v1', sceneId: relationContext.sceneId,
    scenePartId: relationContext.scenePartId, baseWorkRevision: relationContext.baseWorkRevision,
    baseSceneRevision: relationContext.baseSceneRevision, contextDigest: relationContext.contextDigest,
    patch: { activeEntityIds: [linxiId, zhouyeId] }, entityProposals: [],
    relationshipProposals: [{
      tempId: 'rel-allies', subjectEntityId: linxiId, objectEntityId: zhouyeId,
      type: '盟友', state: { trust: '建立' }, effectiveFromSceneId: sceneOne.sceneId,
    }], conflicts: [],
  }, relationContext);
  assert.equal(backdated, null, 'a relation cannot be backdated into an earlier scene');
  const relationPlan = prepareScenePatchMutation({
    contextPack: relationContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: relationContext.sceneId,
      scenePartId: relationContext.scenePartId, baseWorkRevision: relationContext.baseWorkRevision,
      baseSceneRevision: relationContext.baseSceneRevision, contextDigest: relationContext.contextDigest,
      patch: {
        activeEntityIds: [linxiId, zhouyeId],
        exitState: { [linxiId]: { place: '车站' }, [zhouyeId]: { place: '车站' } },
        status: 'confirmed',
      },
      entityProposals: [],
      relationshipProposals: [{
        tempId: 'rel-allies', subjectEntityId: linxiId, objectEntityId: zhouyeId,
        type: '盟友', description: '两人开始互相信任', state: { trust: '建立' },
        effectiveFromSceneId: relationContext.sceneId,
      }],
      conflicts: [],
    },
    work, currentVersions: versions, existingSnapshot: committed.snapshot, allowConfirm: true,
  });
  assert.ok(relationPlan);
  committed = createScopedWorkArtifactMutation({
    sessionId: 'creator-relationships', existingVersions: committed.versions,
    existingSnapshot: committed.snapshot, ...relationPlan,
  });
  versions = latestWorkArtifactVersions(committed.versions);
  work = readLongScriptWork(versions, committed.snapshot);
  assert.equal(buildSceneContextPack({
    work, sceneId: sceneOne.sceneId, userIntent: '查看第一场', workSnapshot: committed.snapshot,
  }).relationships.length, 0, 'future relationships must never leak backward');
  const thirdContext = buildSceneContextPack({
    work, sceneId: sceneThree.sceneId, userIntent: '延续林溪与周野的关系', workSnapshot: committed.snapshot,
  });
  assert.equal(thirdContext.relationships.length, 1);
  assert.equal(thirdContext.relationships[0].effectiveFromSceneId, sceneTwo.sceneId);

  const thirdPlan = prepareScenePatchMutation({
    contextPack: thirdContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: thirdContext.sceneId,
      scenePartId: thirdContext.scenePartId, baseWorkRevision: thirdContext.baseWorkRevision,
      baseSceneRevision: thirdContext.baseSceneRevision, contextDigest: thirdContext.contextDigest,
      patch: {
        activeEntityIds: [linxiId, zhouyeId],
        exitState: { [linxiId]: { place: '天台' }, [zhouyeId]: { place: '天台' } },
        status: 'confirmed',
      }, entityProposals: [], conflicts: [],
    },
    work, currentVersions: versions, existingSnapshot: committed.snapshot, allowConfirm: true,
  });
  committed = createScopedWorkArtifactMutation({
    sessionId: 'creator-relationships', existingVersions: committed.versions,
    existingSnapshot: committed.snapshot, ...thirdPlan,
  });
  versions = latestWorkArtifactVersions(committed.versions);
  work = readLongScriptWork(versions, committed.snapshot);

  const editContext = buildSceneContextPack({
    work, sceneId: sceneTwo.sceneId, userIntent: '把盟友关系改成互相怀疑', workSnapshot: committed.snapshot,
  });
  const editPlan = prepareScenePatchMutation({
    contextPack: editContext,
    scenePatch: {
      schema: 't8-creator-scene-patch-v1', sceneId: editContext.sceneId,
      scenePartId: editContext.scenePartId, baseWorkRevision: editContext.baseWorkRevision,
      baseSceneRevision: editContext.baseSceneRevision, contextDigest: editContext.contextDigest,
      patch: { activeEntityIds: [linxiId, zhouyeId] }, entityProposals: [],
      relationshipProposals: [{
        tempId: 'rel-allies', subjectEntityId: linxiId, objectEntityId: zhouyeId,
        type: '盟友', state: { trust: '动摇' }, effectiveFromSceneId: editContext.sceneId,
      }], conflicts: [],
    },
    work, currentVersions: versions, existingSnapshot: committed.snapshot, allowConfirm: false,
  });
  assert.ok(editPlan);
  const changedScenes = editPlan.mutations.filter((mutation) => mutation.kind === 'ScriptDoc')
    .flatMap((mutation) => mutation.fields.scenes || []);
  const changedById = new Map(changedScenes.map((scene) => [scene.sceneId, scene]));
  assert.equal(changedById.get(sceneTwo.sceneId).status, 'draft');
  assert.equal(changedById.get(sceneThree.sceneId).status, 'stale');
  assert.equal((changedById.get(sceneFour.sceneId) || sceneFour).status, 'draft');
});
