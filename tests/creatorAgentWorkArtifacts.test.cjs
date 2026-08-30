'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileCreatorWorkProposal,
  createCreatorLlmTurnReceipt,
  createCreatorWorkProposal,
  creatorWorkMutationScope,
  latestWorkArtifactVersions,
  normalizeCreatorLlmTurnReceipt,
  normalizeWorkArtifactVersion,
  reviseWorkArtifact,
} = require('../backend/src/services/creatorAgentWorkArtifacts.js');

function storyModelValue(overrides = {}) {
  const artifact = (kind, title, fields, dependsOnKinds) => ({
    kind,
    title,
    fields,
    ...(dependsOnKinds ? { dependsOnKinds } : {}),
  });
  return {
    schema: 't8-creator-work-model-response-v1',
    displayMarkdown: '## 雨夜重逢\n\n两个旧友在站台重新决定是否同行。',
    taskProfile: {
      family: 'story',
      intent: '创作一支可拍摄的雨夜重逢短片',
      deliveryKind: 'vertical-short-film',
      modalities: ['text', 'video', 'audio'],
      targetPlatform: 'mobile',
      qualityMode: 'standard',
    },
    artifacts: [
      artifact('TaskProfile', '任务画像', {
        family: 'story',
        intent: '雨夜重逢',
        deliveryKind: 'vertical-short-film',
        modalities: ['text', 'video', 'audio'],
        qualityMode: 'standard',
      }),
      artifact('ProductionBrief', '创作简报', {
        title: '雨夜重逢',
        outcome: overrides.outcome || '30 秒竖屏短片',
        audience: '情感短片观众',
        format: '9:16',
        durationSeconds: 30,
        assumptions: ['人物姓名待确认'],
      }),
      artifact('ScriptDoc', '剧本', {
        title: '雨夜重逢',
        logline: overrides.logline || '两个旧友在末班车前重新选择彼此。',
        scenes: [{ id: 'scene-1', action: '两人在雨棚下对视' }],
        ending: overrides.ending || '两个人一起登上末班车。',
      }),
      artifact('CharacterBible', '人物设定', {
        characters: [{ id: 'friend-a', goal: '挽回友情' }],
        identityLocks: ['两位成年旧友'],
      }),
      artifact('AssetNeed', '素材清单', {
        items: ['雨夜站台', '两位人物参考'],
        existing: [],
        missing: ['人物参考图'],
      }),
      artifact('ShotList', '镜头表', {
        shots: [{ id: 'shot-1', durationSeconds: 5, action: '雨滴掠过站牌' }],
        totalDurationSeconds: 30,
      }),
      artifact('Storyboard', '分镜', {
        frames: [{ shotId: 'shot-1', composition: '站牌前景，两人在远处' }],
        missingFrames: [],
      }),
      artifact('AudioPlan', '声音方案', {
        dialogue: ['你还记得最后一班车吗？'],
        ambience: ['雨声', '远处列车'],
        music: '克制钢琴',
      }),
      artifact('PromptPack', '提示词包', {
        prompts: [{ shotId: 'shot-1', prompt: '雨夜站台，克制电影光线' }],
        negativePrompts: ['人物身份漂移'],
      }),
    ],
    toolProposals: [],
  };
}

function proposal(logicalRequestId = 'request-1', overrides = {}) {
  return createCreatorWorkProposal({
    modelValue: storyModelValue(overrides),
    taskFamily: 'story',
    qualityMode: 'standard',
    logicalRequestId,
  });
}

function onlineEvidence(providerCalls = 2) {
  return {
    mode: 'online-model',
    status: 'completed',
    providerCalls,
  };
}

test('strict story proposal compiles into dependency-bound versioned work', () => {
  const workProposal = proposal();
  assert.ok(workProposal);
  const result = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: workProposal,
    existingVersions: [],
    createdAt: '2026-08-29T00:00:00.000Z',
  });
  assert.equal(result.status, 'created');
  assert.equal(result.createdVersions.length, 9);
  assert.equal(result.snapshot.taskProfile.qualityMode, 'standard');
  assert.equal(result.snapshot.artifactVersionIds.length, 9);
  const byVersionId = new Map(result.versions.map((version) => [version.versionId, version]));
  for (const version of result.versions) {
    assert.deepEqual(normalizeWorkArtifactVersion(version), version);
    for (const dependency of version.dependencies) {
      assert.equal(byVersionId.get(dependency.versionId)?.versionDigest, dependency.versionDigest);
    }
  }
});

test('work snapshot revisions advance monotonically and exact no-op retries reuse the snapshot', () => {
  const first = compileCreatorWorkProposal({
    sessionId: 'session-work-revision',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal('request-1'),
    existingVersions: [],
    createdAt: '2026-08-29T00:00:00.000Z',
  });
  const second = compileCreatorWorkProposal({
    sessionId: 'session-work-revision',
    responseId: 'response-2',
    logicalRequestId: 'request-2',
    llmTurnReceiptDigest: 'b'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal('request-2', { ending: '两个人留在雨里，目送末班车离开。' }),
    existingVersions: first.versions,
    existingSnapshot: first.snapshot,
    createdAt: '2026-08-29T00:01:00.000Z',
  });
  assert.equal(first.snapshot.revision, 1);
  assert.equal(second.snapshot.revision, 2);
  assert.notEqual(second.snapshot.workDigest, first.snapshot.workDigest);

  const noOp = compileCreatorWorkProposal({
    sessionId: 'session-work-revision',
    responseId: 'response-3',
    logicalRequestId: 'request-3',
    llmTurnReceiptDigest: 'c'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal('request-3', { ending: '两个人留在雨里，目送末班车离开。' }),
    existingVersions: second.versions,
    existingSnapshot: second.snapshot,
    createdAt: '2026-08-29T00:02:00.000Z',
  });
  assert.equal(noOp.status, 'reused');
  assert.deepEqual(noOp.snapshot, second.snapshot);
});

test('bounded creator revision returns only affected artifact kinds and preserves every other version exactly', () => {
  const first = compileCreatorWorkProposal({
    sessionId: 'session-bounded-revision',
    responseId: 'response-bounded-1',
    logicalRequestId: 'request-bounded-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(1),
    proposal: proposal('request-bounded-1'),
    existingVersions: [],
    createdAt: '2026-08-29T00:00:00.000Z',
  });
  const affectedKinds = ['ScriptDoc', 'ShotList', 'Storyboard', 'PromptPack'];
  const partialValue = storyModelValue({ ending: '列车门关闭前，两人隔着车窗相视。' });
  partialValue.displayMarkdown = '## 局部改稿\n\n只更新结尾、最后镜头、最后分镜和最后提示词。';
  partialValue.artifacts = partialValue.artifacts
    .filter((artifact) => affectedKinds.includes(artifact.kind));
  const partialProposal = createCreatorWorkProposal({
    modelValue: partialValue,
    taskFamily: 'story',
    qualityMode: 'standard',
    requiredKinds: affectedKinds,
    logicalRequestId: 'request-bounded-2',
  });
  assert.ok(partialProposal);
  assert.deepEqual(partialProposal.requiredKinds, affectedKinds);
  assert.deepEqual(partialProposal.artifacts.map((artifact) => artifact.kind), affectedKinds);

  const second = compileCreatorWorkProposal({
    sessionId: 'session-bounded-revision',
    responseId: 'response-bounded-2',
    logicalRequestId: 'request-bounded-2',
    llmTurnReceiptDigest: 'b'.repeat(64),
    responseEvidence: onlineEvidence(1),
    proposal: partialProposal,
    existingVersions: first.versions,
    existingSnapshot: first.snapshot,
    mutationScope: creatorWorkMutationScope(
      '只修改结尾、最后一个镜头、对应最后一格分镜和最后一条提示词',
      first.versions,
    ),
    createdAt: '2026-08-29T00:01:00.000Z',
  });
  assert.equal(second.status, 'created');
  assert.equal(second.snapshot.revision, 2);
  assert.equal(latestWorkArtifactVersions(second.versions).length, 9);
  const firstByKind = new Map(latestWorkArtifactVersions(first.versions)
    .map((version) => [version.kind, version]));
  const secondByKind = new Map(latestWorkArtifactVersions(second.versions)
    .map((version) => [version.kind, version]));
  for (const [kind, before] of firstByKind) {
    const after = secondByKind.get(kind);
    assert.ok(after);
    if (!affectedKinds.includes(kind)) assert.equal(after.versionId, before.versionId);
  }
});

test('bounded creator revision accepts sparse fields, hashes merged state, and rejects extra kinds', () => {
  const first = compileCreatorWorkProposal({
    sessionId: 'session-sparse-revision',
    responseId: 'response-sparse-1',
    logicalRequestId: 'request-sparse-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(1),
    proposal: proposal('request-sparse-1'),
    existingVersions: [],
  });
  const sparseValue = storyModelValue();
  sparseValue.displayMarkdown = '## 局部改稿\n\n只更新结尾。';
  sparseValue.artifacts = [{
    kind: 'ScriptDoc',
    title: '剧本',
    fields: { ending: '列车门关闭前，两人隔着车窗相视。' },
    dependsOnKinds: ['ProductionBrief'],
  }];
  const sparseProposal = createCreatorWorkProposal({
    modelValue: sparseValue,
    taskFamily: 'story',
    qualityMode: 'quick',
    requiredKinds: ['ScriptDoc'],
    logicalRequestId: 'request-sparse-2',
  });
  assert.ok(sparseProposal);
  const result = compileCreatorWorkProposal({
    sessionId: 'session-sparse-revision',
    responseId: 'response-sparse-2',
    logicalRequestId: 'request-sparse-2',
    llmTurnReceiptDigest: 'b'.repeat(64),
    responseEvidence: onlineEvidence(1),
    proposal: sparseProposal,
    existingVersions: first.versions,
    existingSnapshot: first.snapshot,
    mutationScope: creatorWorkMutationScope('只修改结尾', first.versions),
  });
  assert.equal(result.status, 'created');
  assert.equal(result.createdVersions.length, 1);
  assert.equal(result.createdVersions[0].fields.logline, '两个旧友在末班车前重新选择彼此。');
  assert.equal(result.createdVersions[0].fields.ending, '列车门关闭前，两人隔着车窗相视。');
  assert.deepEqual(normalizeWorkArtifactVersion(result.createdVersions[0]), result.createdVersions[0]);

  const extraKindValue = structuredClone(sparseValue);
  extraKindValue.artifacts.push({
    kind: 'ShotList', title: '镜头表', fields: { shots: [] }, dependsOnKinds: ['ScriptDoc'],
  });
  assert.equal(createCreatorWorkProposal({
    modelValue: extraKindValue,
    taskFamily: 'story',
    qualityMode: 'quick',
    requiredKinds: ['ScriptDoc'],
    logicalRequestId: 'request-sparse-extra',
  }), null);
});

test('last-shot mutation keeps every earlier array item byte-stable', () => {
  const firstValue = storyModelValue();
  for (const artifact of firstValue.artifacts) {
    if (artifact.kind === 'ShotList') artifact.fields.shots.push({ id: 'shot-2', action: '旧结尾' });
    if (artifact.kind === 'Storyboard') artifact.fields.frames.push({ shotId: 'shot-2', composition: '旧结尾画面' });
    if (artifact.kind === 'PromptPack') artifact.fields.prompts.push({ shotId: 'shot-2', prompt: '旧结尾提示词' });
  }
  const first = compileCreatorWorkProposal({
    sessionId: 'session-last-shot', responseId: 'response-last-1', logicalRequestId: 'request-last-1',
    llmTurnReceiptDigest: 'a'.repeat(64), responseEvidence: onlineEvidence(1),
    proposal: createCreatorWorkProposal({ modelValue: firstValue, taskFamily: 'story', qualityMode: 'quick' }),
    existingVersions: [],
  });
  const changed = structuredClone(firstValue);
  changed.displayMarkdown = '## 最后一镜改稿\n\n只改最后一镜。';
  changed.artifacts = changed.artifacts.filter((artifact) => ['ShotList', 'Storyboard', 'PromptPack'].includes(artifact.kind));
  changed.artifacts.find((artifact) => artifact.kind === 'ShotList').fields.shots[1].action = '新结尾';
  changed.artifacts.find((artifact) => artifact.kind === 'Storyboard').fields.frames[1].composition = '新结尾画面';
  changed.artifacts.find((artifact) => artifact.kind === 'PromptPack').fields.prompts[1].prompt = '新结尾提示词';
  for (const artifact of changed.artifacts) {
    if (artifact.kind === 'ShotList') artifact.fields = { shots: [artifact.fields.shots.at(-1)] };
    if (artifact.kind === 'Storyboard') artifact.fields = { frames: [artifact.fields.frames.at(-1)] };
    if (artifact.kind === 'PromptPack') artifact.fields = { prompts: [artifact.fields.prompts.at(-1)] };
  }
  const requiredKinds = ['ShotList', 'Storyboard', 'PromptPack'];
  const proposalValue = createCreatorWorkProposal({
    modelValue: changed, taskFamily: 'story', qualityMode: 'quick', requiredKinds,
  });
  const scope = creatorWorkMutationScope('只修改最后一个镜头、最后一格分镜和最后一条提示词', first.versions);
  assert.deepEqual(scope.allowedPaths, [
    '/PromptPack/fields/prompts',
    '/ShotList/fields/shots',
    '/Storyboard/fields/frames',
  ]);
  assert.deepEqual(scope.preserveArrayPrefixes, [
    '/PromptPack/fields/prompts',
    '/ShotList/fields/shots',
    '/Storyboard/fields/frames',
  ]);
  const accepted = compileCreatorWorkProposal({
    sessionId: 'session-last-shot', responseId: 'response-last-2', logicalRequestId: 'request-last-2',
    llmTurnReceiptDigest: 'b'.repeat(64), responseEvidence: onlineEvidence(1), proposal: proposalValue,
    existingVersions: first.versions, existingSnapshot: first.snapshot, mutationScope: scope,
  });
  assert.equal(accepted.status, 'created');
  const acceptedByKind = new Map(accepted.versions.map((version) => [version.kind, version]));
  assert.deepEqual(acceptedByKind.get('ShotList').fields.shots, [
    { id: 'shot-1', durationSeconds: 5, action: '雨滴掠过站牌' },
    { id: 'shot-2', action: '新结尾' },
  ]);
  assert.deepEqual(acceptedByKind.get('Storyboard').fields.frames, [
    { shotId: 'shot-1', composition: '站牌前景，两人在远处' },
    { shotId: 'shot-2', composition: '新结尾画面' },
  ]);
  assert.deepEqual(acceptedByKind.get('PromptPack').fields.prompts, [
    { shotId: 'shot-1', prompt: '雨夜站台，克制电影光线' },
    { shotId: 'shot-2', prompt: '新结尾提示词' },
  ]);

  const corrupted = structuredClone(firstValue);
  corrupted.displayMarkdown = changed.displayMarkdown;
  corrupted.artifacts = corrupted.artifacts.filter((artifact) => ['ShotList', 'Storyboard', 'PromptPack'].includes(artifact.kind));
  corrupted.artifacts.find((artifact) => artifact.kind === 'ShotList').fields.shots[0].action = '模型越界改了第一镜';
  const blocked = compileCreatorWorkProposal({
    sessionId: 'session-last-shot', responseId: 'response-last-3', logicalRequestId: 'request-last-3',
    llmTurnReceiptDigest: 'c'.repeat(64), responseEvidence: onlineEvidence(1),
    proposal: createCreatorWorkProposal({
      modelValue: corrupted, taskFamily: 'story', qualityMode: 'quick', requiredKinds,
    }),
    existingVersions: first.versions, existingSnapshot: first.snapshot, mutationScope: scope,
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.code, 'work-array-prefix-out-of-scope');
  assert.equal(blocked.blockedPath, '/fields/shots');
});

test('offline and invalid-schema responses never create formal work', () => {
  const valid = proposal();
  const offline = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: { mode: 'offline-structure', status: 'completed', providerCalls: 0 },
    proposal: valid,
    existingVersions: [],
  });
  assert.equal(offline.status, 'blocked');
  assert.equal(offline.code, 'formal-work-requires-llm');
  const invalid = storyModelValue();
  invalid.artifacts[0].fields.unregisteredField = true;
  assert.equal(createCreatorWorkProposal({
    modelValue: invalid,
    taskFamily: 'story',
    qualityMode: 'standard',
    logicalRequestId: 'request-invalid',
  }), null);
});

test('creator edits and locks are deterministic while the next model cannot cross the lock', () => {
  const first = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal(),
    existingVersions: [],
    createdAt: '2026-08-29T00:00:00.000Z',
  });
  const brief = latestWorkArtifactVersions(first.versions)
    .find((version) => version.kind === 'ProductionBrief');
  const locked = reviseWorkArtifact({
    existingVersions: first.versions,
    artifactId: brief.artifactId,
    baseVersionId: brief.versionId,
    action: 'lock',
    field: 'outcome',
    createdAt: '2026-08-29T00:01:00.000Z',
  });
  assert.equal(locked.status, 'created');
  assert.deepEqual(locked.artifactVersion.fieldLocks, ['/fields/outcome']);
  const creatorEdit = reviseWorkArtifact({
    existingVersions: locked.versions,
    artifactId: brief.artifactId,
    baseVersionId: locked.artifactVersion.versionId,
    action: 'edit',
    field: 'outcome',
    value: '45 秒竖屏短片',
    createdAt: '2026-08-29T00:02:00.000Z',
  });
  assert.equal(creatorEdit.status, 'created');
  assert.equal(creatorEdit.artifactVersion.fields.outcome, '45 秒竖屏短片');
  assert.deepEqual(creatorEdit.artifactVersion.fieldLocks, ['/fields/outcome']);
  const modelOverwrite = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-2',
    logicalRequestId: 'request-2',
    llmTurnReceiptDigest: 'b'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal('request-2', { outcome: '60 秒横屏短片' }),
    existingVersions: creatorEdit.versions,
    createdAt: '2026-08-29T00:03:00.000Z',
  });
  assert.equal(modelOverwrite.status, 'blocked');
  assert.equal(modelOverwrite.code, 'work-field-locked');
  assert.equal(modelOverwrite.blockedPath, '/fields/outcome');
});

test('accept and reject create artifact-level versions without requiring a fake field', () => {
  const first = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal(),
    existingVersions: [],
  });
  const brief = latestWorkArtifactVersions(first.versions)
    .find((version) => version.kind === 'ProductionBrief');
  const accepted = reviseWorkArtifact({
    existingVersions: first.versions,
    artifactId: brief.artifactId,
    baseVersionId: brief.versionId,
    action: 'accept',
  });
  assert.equal(accepted.status, 'created');
  assert.equal(accepted.artifactVersion.status, 'accepted');
  assert.equal(accepted.artifactVersion.diff.operations[0].path, '/status');
  assert.deepEqual(normalizeWorkArtifactVersion(accepted.artifactVersion), accepted.artifactVersion);
});

test('an explicit only-change request is enforced as a server-side field allowlist', () => {
  const first = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    llmTurnReceiptDigest: 'a'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal(),
    existingVersions: [],
  });
  const scope = creatorWorkMutationScope('只修改结尾，让两个人错过末班车', first.versions);
  assert.equal(scope.restricted, true);
  assert.deepEqual(scope.allowedPaths, ['/ScriptDoc/fields/ending']);
  const accepted = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-2',
    logicalRequestId: 'request-2',
    llmTurnReceiptDigest: 'b'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal('request-2', { ending: '两个人留在雨里，目送末班车离开。' }),
    existingVersions: first.versions,
    mutationScope: scope,
  });
  assert.equal(accepted.status, 'created');
  assert.deepEqual(accepted.createdVersions.map((item) => item.kind), ['ScriptDoc']);
  const blocked = compileCreatorWorkProposal({
    sessionId: 'session-1',
    responseId: 'response-3',
    logicalRequestId: 'request-3',
    llmTurnReceiptDigest: 'c'.repeat(64),
    responseEvidence: onlineEvidence(),
    proposal: proposal('request-3', {
      ending: '两个人留在雨里，目送末班车离开。',
      logline: '模型顺手重写了不被允许修改的梗概。',
    }),
    existingVersions: first.versions,
    mutationScope: scope,
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.code, 'work-mutation-out-of-scope');
  assert.equal(blocked.blockedPath, '/fields/logline');
});

test('LLM turn receipt is content-addressed and rejects tampering', () => {
  const receipt = createCreatorLlmTurnReceipt({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    qualityMode: 'standard',
    responseEvidence: {
      status: 'completed',
      providerCalls: 2,
      provider: 'seedance-nz',
      model: 'bytedance/doubao-seed-2.1-pro',
      modelDecisionDigest: 'a'.repeat(64),
      promptContractDigest: 'b'.repeat(64),
      calls: [
        { role: 'draft', requestId: 'provider-1', finishReason: 'stop' },
        { role: 'final-merger', requestId: 'provider-2', finishReason: 'stop' },
      ],
    },
    workProposalDigest: 'c'.repeat(64),
    createdAt: '2026-08-29T00:00:00.000Z',
  });
  assert.deepEqual(normalizeCreatorLlmTurnReceipt(receipt), receipt);
  assert.equal(normalizeCreatorLlmTurnReceipt({ ...receipt, providerCalls: 1 }), null);

  const compiled = createCreatorLlmTurnReceipt({
    sessionId: 'session-1',
    responseId: 'response-1',
    logicalRequestId: 'request-1',
    phase: 'compiled',
    qualityMode: 'standard',
    responseEvidence: {
      status: 'completed',
      providerCalls: 2,
      provider: 'seedance-nz',
      model: 'bytedance/doubao-seed-2.1-pro',
    },
    workProposalDigest: 'c'.repeat(64),
    invocationReceiptDigest: receipt.receiptDigest,
    inputBindings: [{
      assetId: 'asset-1',
      contentRevision: 3,
      contentHash: 'd'.repeat(64),
      kind: 'image',
      mimeType: 'image/png',
      observationDigest: 'e'.repeat(64),
    }],
    artifactBindings: [{
      artifactId: `cwa_${'1'.repeat(32)}`,
      kind: 'ScriptDoc',
      baseVersionId: `cwav_${'2'.repeat(32)}`,
      newVersionId: `cwav_${'3'.repeat(32)}`,
      diffDigest: 'f'.repeat(64),
    }],
    workSnapshotDigest: '9'.repeat(64),
    createdAt: '2026-08-29T00:00:00.000Z',
  });
  assert.deepEqual(normalizeCreatorLlmTurnReceipt(compiled), compiled);
  assert.equal(compiled.phase, 'compiled');
  assert.equal(compiled.artifactBindings[0].newVersionId, `cwav_${'3'.repeat(32)}`);
  assert.equal(normalizeCreatorLlmTurnReceipt({
    ...compiled,
    workSnapshotDigest: '8'.repeat(64),
  }), null);
});
