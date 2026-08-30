'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AgentControlCreativeError,
  createAgentControlCreativeService,
} = require('../backend/src/services/agentControlCreative.js');
const { sha256: recipeDigest } = require('../tools/zcanvas-cli/src/recipeStore.cjs');

function fixture(initialNodes = [], initialAssets = []) {
  const document = {
    schema: 't8-canvas-document',
    schemaVersion: 2,
    projectId: 'project-local',
    canvasId: 'canvas-a',
    revision: 12,
    nodes: structuredClone(initialNodes),
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let writes = 0;
  let providerPosts = 0;
  const database = {
    getCanvas(canvasId) {
      return canvasId === document.canvasId ? structuredClone(document) : null;
    },
    getAsset(assetId) {
      const asset = initialAssets.find((item) => item.id === assetId);
      return asset ? structuredClone(asset) : null;
    },
  };
  function applyPatch(patch) {
    assert.equal(patch.baseRevision, document.revision);
    for (const operation of patch.operations) {
      const payload = operation.payload;
      if (operation.type === 'node.add') {
        assert.equal(document.nodes.some((node) => node.id === payload.node.id), false);
        document.nodes.push(structuredClone(payload.node));
      } else if (operation.type === 'node.patch') {
        const node = document.nodes.find((item) => item.id === payload.nodeId);
        assert.ok(node, `missing node ${payload.nodeId}`);
        node.data = { ...(node.data || {}), ...(structuredClone(payload.dataPatch) || {}) };
      } else if (operation.type === 'edge.add') {
        if (!document.edges.some((edge) => edge.id === payload.edge.id)) {
          document.edges.push(structuredClone(payload.edge));
        }
      } else {
        assert.fail(`unsupported fixture operation ${operation.type}`);
      }
    }
    document.revision += 1;
    writes += 1;
  }
  return {
    database,
    document,
    applyPatch,
    get providerPosts() { return providerPosts; },
    get writes() { return writes; },
    postProvider() { providerPosts += 1; },
  };
}

const scope = {
  projectId: 'project-local',
  canvasId: 'canvas-a',
  actorId: 'agent:codex',
  sessionId: 'session-a',
};

test('creator plan card asks only for the missing creative goal and performs zero writes/provider calls', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'plan-card',
    targetKind: 'story',
    profile: 'quality',
  }, scope);
  assert.equal(plan.ready, false);
  assert.equal(plan.questions.length, 1);
  assert.equal(plan.questions[0].id, 'goal');
  assert.equal(plan.profile, 'quality');
  assert.equal(plan.impact.writesNow, 0);
  assert.equal(plan.impact.providerCallsNow, 0);
  assert.equal('cost' in plan, false);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('story planning exposes versioned editable production documents without inventing analysis', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const first = service.createPlan({
    kind: 'story',
    prompt: '两个朋友在雨夜重逢',
    ratio: '9:16',
    duration: 30,
  }, scope);
  assert.deepEqual(
    first.productionDocuments.map((item) => item.kind),
    ['production-brief', 'script-doc', 'world-bible', 'character-bible', 'asset-needs', 'shot-list', 'audio-plan', 'storyboard', 'prompt-pack', 'candidate-review', 'edit-decision-list', 'qc-report', 'delivery-manifest'],
  );
  assert.equal(first.productionDocuments.every((item) => item.revision === 1), true);
  assert.equal(first.productionDocuments.every((item) => item.status === 'draft'), true);
  assert.equal(first.productionDocuments
    .filter((item) => !['candidate-review', 'qc-report', 'delivery-manifest'].includes(item.kind))
    .every((item) => item.editableByNaturalLanguage), true);
  assert.equal(first.productionDocuments.find((item) => item.kind === 'candidate-review').editableByNaturalLanguage, false);
  assert.equal(first.productionDocuments.find((item) => item.kind === 'qc-report').editableByNaturalLanguage, false);
  assert.equal(first.productionDocuments.find((item) => item.kind === 'delivery-manifest').editableByNaturalLanguage, false);
  const script = first.productionDocuments.find((item) => item.kind === 'script-doc');
  assert.equal(script.content.sourceText, '两个朋友在雨夜重逢');
  assert.deepEqual(script.content.scenes, []);
  const world = first.productionDocuments.find((item) => item.kind === 'world-bible');
  assert.deepEqual(world.content.characters, []);
  assert.match(world.content.editingGuidance, /未知设定保持空白/);
  const characterBible = first.productionDocuments.find((item) => item.kind === 'character-bible');
  const assetNeeds = first.productionDocuments.find((item) => item.kind === 'asset-needs');
  const shotList = first.productionDocuments.find((item) => item.kind === 'shot-list');
  const audioPlan = first.productionDocuments.find((item) => item.kind === 'audio-plan');
  const storyboard = first.productionDocuments.find((item) => item.kind === 'storyboard');
  const promptPack = first.productionDocuments.find((item) => item.kind === 'prompt-pack');
  const candidateReview = first.productionDocuments.find((item) => item.kind === 'candidate-review');
  const editDecisionList = first.productionDocuments.find((item) => item.kind === 'edit-decision-list');
  const qcReport = first.productionDocuments.find((item) => item.kind === 'qc-report');
  const deliveryManifest = first.productionDocuments.find((item) => item.kind === 'delivery-manifest');
  assert.equal(characterBible.content.status, 'needs-explicit-characters');
  assert.deepEqual(characterBible.content.characters, []);
  assert.equal(assetNeeds.content.status, 'needs-explicit-source');
  assert.deepEqual(assetNeeds.content.needs, []);
  assert.equal(shotList.content.status, 'needs-explicit-shots');
  assert.deepEqual(shotList.content.shots, []);
  assert.equal(shotList.content.generationScope, 'none');
  assert.equal(audioPlan.content.status, 'needs-explicit-audio-cues');
  assert.deepEqual(audioPlan.content.items, []);
  assert.deepEqual(audioPlan.content.counts, {
    total: 0, dialogue: 0, voiceover: 0, music: 0, ambience: 0, sfx: 0,
  });
  assert.equal(audioPlan.content.derivation.sourceDocumentId, shotList.id);
  assert.equal(storyboard.content.status, 'needs-shot-list');
  assert.deepEqual(storyboard.content.frames, []);
  assert.equal(storyboard.content.adoptionPolicy, 'explicit-only');
  assert.equal(storyboard.content.generationScope, 'none');
  assert.equal(storyboard.content.derivation.sourceDocumentId, shotList.id);
  assert.equal(promptPack.content.status, 'needs-storyboard');
  assert.deepEqual(promptPack.content.counts, { total: 0, drafts: 0, reviewed: 0 });
  assert.deepEqual(promptPack.content.prompts, []);
  assert.equal(promptPack.content.reviewPolicy, 'explicit-confirmation');
  assert.equal(promptPack.content.generationScope, 'none');
  assert.equal(promptPack.content.derivation.sourceDocumentId, storyboard.id);
  assert.equal(candidateReview.content.status, 'awaiting-real-candidates');
  assert.deepEqual(candidateReview.content.counts, {
    total: 0, withResult: 0, reviewed: 0, adopted: 0, blocked: 0,
  });
  assert.deepEqual(candidateReview.content.candidates, []);
  assert.equal(candidateReview.content.reviewPolicy, 'actual-media-required');
  assert.equal(candidateReview.content.adoptionPolicy, 'explicit-action-only');
  assert.equal(candidateReview.content.derivation.sourceDocumentId, promptPack.id);
  assert.equal(editDecisionList.content.status, 'awaiting-adopted-video');
  assert.deepEqual(editDecisionList.content.counts, {
    total: 0, ready: 0, missingDuration: 0, missingShots: 0, blocked: 0,
  });
  assert.deepEqual(editDecisionList.content.sequence, []);
  assert.equal(editDecisionList.content.timeline.schema, 't8-creator-edl-v1');
  assert.equal(editDecisionList.content.timeline.timingStatus, 'empty');
  assert.equal(editDecisionList.content.reviewPolicy, 'verified-adopted-video-only');
  assert.equal(editDecisionList.content.generationScope, 'none');
  assert.equal(editDecisionList.content.derivation.sourceDocumentId, candidateReview.id);
  assert.equal(editDecisionList.content.derivation.method, 'verified-adopted-video-sequence');
  assert.equal(qcReport.content.status, 'awaiting-edit-decision-list');
  assert.deepEqual(qcReport.content.counts, {
    total: 0, pass: 0, fail: 0, unknown: 0, checks: 0,
  });
  assert.deepEqual(qcReport.content.qcItems, []);
  assert.equal(qcReport.content.derivation.sourceDocumentId, editDecisionList.id);
  assert.equal(qcReport.content.derivation.method, 'persisted-artifact-qc-evidence');
  assert.equal(qcReport.content.verificationPolicy, 'persisted-receipts-only');
  assert.equal(deliveryManifest.content.status, 'awaiting-qc-report');
  assert.deepEqual(deliveryManifest.content.counts, {
    total: 0, included: 0, blocked: 0, awaiting: 0, packageFiles: 0,
    licenseKnown: 0, licenseUnknown: 0,
  });
  assert.deepEqual(deliveryManifest.content.deliverables, []);
  assert.equal(deliveryManifest.content.packageEvidence, null);
  assert.equal(deliveryManifest.content.derivation.sourceDocumentId, qcReport.id);
  assert.equal(deliveryManifest.content.derivation.method, 'verified-local-delivery-package-evidence');
  assert.equal(deliveryManifest.content.derivation.documentDeliveryWrites, 0);
  assert.equal(characterBible.content.derivation.providerCalls, 0);
  assert.equal(assetNeeds.content.derivation.inferredFacts, 0);

  const unchanged = service.createPlan({
    kind: 'story',
    prompt: '两个朋友在雨夜重逢',
    ratio: '9:16',
    duration: 30,
    previousProductionDocuments: first.productionDocuments,
  }, scope);
  assert.deepEqual(unchanged.productionDocuments.map((item) => item.revision), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(
    unchanged.productionDocuments.map((item) => item.versionId),
    first.productionDocuments.map((item) => item.versionId),
  );

  const revised = service.createPlan({
    kind: 'story',
    prompt: '两个朋友在雪夜重逢',
    ratio: '9:16',
    duration: 30,
    previousProductionDocuments: first.productionDocuments,
  }, scope);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'production-brief').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'script-doc').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'world-bible').revision, 1);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'character-bible').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'asset-needs').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'shot-list').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'audio-plan').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'storyboard').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'prompt-pack').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'candidate-review').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'edit-decision-list').revision, 2);
  const briefDiff = revised.productionDocuments
    .find((item) => item.kind === 'production-brief').changeSummary;
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'qc-report').revision, 2);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'delivery-manifest').revision, 2);
  const scriptDiff = revised.productionDocuments
    .find((item) => item.kind === 'script-doc').changeSummary;
  assert.equal(briefDiff.schema, 't8-creator-production-document-diff-v1');
  assert.equal(briefDiff.baseRevision, 1);
  assert.equal(briefDiff.changedFields.some((item) => item.field === 'goal'), true);
  assert.equal(scriptDiff.changedFields.some((item) => item.field === 'sourceText'), true);
  assert.match(scriptDiff.changedFields.find((item) => item.field === 'sourceText').before, /雨夜/);
  assert.match(scriptDiff.changedFields.find((item) => item.field === 'sourceText').after, /雪夜/);
  assert.equal(revised.productionDocuments.find((item) => item.kind === 'world-bible').changeSummary, undefined);
  const tampered = structuredClone(first.productionDocuments);
  tampered.find((item) => item.kind === 'script-doc').content.sourceText = '被替换但没有新摘要的内容';
  assert.throws(
    () => service.createPlan({
      kind: 'story',
      prompt: '两个朋友在雨夜重逢',
      ratio: '9:16',
      duration: 30,
      previousProductionDocuments: tampered,
    }, scope),
    (error) => {
      assert.equal(error.code, 'CREATOR_PRODUCTION_DOCUMENT_INVALID');
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('structured script headings become a source-backed analysis without model inference', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const sourceText = [
    'Scene: The Alley',
    'Characters: 萌萌，罂瑶',
    '【镜头一｜建立环境】',
    '雨夜的悉尼唐人街后巷。霓虹灯倒映在积水中。',
    '【镜头二｜建立人物】',
    '电梯门缓缓打开。萌萌独自走出。',
  ].join('\n');
  const plan = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
  }, scope);
  const script = plan.productionDocuments.find((item) => item.kind === 'script-doc');
  assert.equal(script.content.structureStatus, 'source-structured');
  assert.equal(script.content.scriptAnalysis.schema, 't8-creator-script-analysis-v1');
  assert.equal(script.content.scriptAnalysis.method, 'deterministic-source-map');
  assert.equal(script.content.scriptAnalysis.sourceBacked, true);
  assert.equal(script.content.scriptAnalysis.providerCalls, 0);
  assert.equal(script.content.scriptAnalysis.inferredFacts, 0);
  assert.deepEqual(script.content.scriptAnalysis.counts, {
    scenes: 1,
    shots: 2,
    characters: 2,
  });
  assert.deepEqual(script.content.outline, ['建立环境', '建立人物']);
  assert.deepEqual(script.content.characters.map((item) => item.name), ['萌萌', '罂瑶']);
  assert.equal(script.content.scenes[0].title, 'The Alley');
  assert.deepEqual(script.content.scenes[0].sourceRange, { lineStart: 1, lineEnd: 6 });
  assert.deepEqual(script.content.shots[0].sourceRange, { lineStart: 3, lineEnd: 4 });
  assert.deepEqual(script.content.shots[1].sourceRange, { lineStart: 5, lineEnd: 6 });
  assert.match(script.content.shots[0].sourceText, /雨夜的悉尼唐人街后巷/);
  assert.equal(script.content.shots.every((item) => item.id && item.sourceTextTruncated === false), true);
  assert.equal(script.content.scriptAnalysis.unresolved.length, 0);
  const characterBible = plan.productionDocuments.find((item) => item.kind === 'character-bible');
  assert.equal(characterBible.content.status, 'source-proposed');
  assert.deepEqual(characterBible.content.characters.map((item) => item.name), ['萌萌', '罂瑶']);
  assert.equal(characterBible.content.characters[0].sourceEvidence.lineStart, 2);
  assert.match(characterBible.content.characters[0].sourceEvidence.sourceText, /Characters: 萌萌[,，]罂瑶/);
  assert.deepEqual(characterBible.content.characters[0].unresolved, [
    '外观',
    '服装',
    '性格',
    '连续性细节',
  ]);
  assert.equal(characterBible.content.characters[0].appearance, '');
  assert.equal(characterBible.content.derivation.sourceDocumentId, script.id);
  assert.equal(characterBible.content.derivation.sourceVersionId, script.versionId);
  assert.equal(characterBible.content.derivation.sourceContentDigest, script.contentDigest);
  assert.equal(characterBible.content.derivation.providerCalls, 0);
  assert.equal(characterBible.content.derivation.inferredFacts, 0);
  const assetNeeds = plan.productionDocuments.find((item) => item.kind === 'asset-needs');
  assert.deepEqual(assetNeeds.content.counts, {
    total: 3,
    characters: 2,
    locations: 1,
  });
  assert.deepEqual(assetNeeds.content.needs.map((item) => item.kind), [
    'character',
    'character',
    'location',
  ]);
  assert.equal(assetNeeds.content.needs.every((item) => (
    item.status === 'missing' && item.acceptedAssetId === null && item.locked === false
  )), true);
  assert.equal(assetNeeds.content.generationScope, 'none');
  const shotList = plan.productionDocuments.find((item) => item.kind === 'shot-list');
  assert.equal(shotList.content.status, 'source-proposed');
  assert.deepEqual(shotList.content.counts, {
    total: 2,
    scenes: 1,
    shots: 2,
  });
  assert.deepEqual(shotList.content.shots.map((item) => item.title), ['建立环境', '建立人物']);
  assert.equal(shotList.content.shots[0].sceneTitle, 'The Alley');
  assert.equal(shotList.content.shots[0].sourceShotId, script.content.shots[0].id);
  assert.equal(shotList.content.shots[0].sourceEvidence.lineStart, 3);
  assert.match(shotList.content.shots[0].description, /雨夜的悉尼唐人街后巷/);
  assert.equal(shotList.content.shots.every((item) => (
    item.status === 'source-proposed'
      && item.durationSec === null
      && item.shotSize === ''
      && item.cameraMovement === ''
      && item.dialogue === ''
      && item.soundDesign === ''
      && item.relatedAssetNeedIds.length === 0
      && item.unresolved.length === 6
  )), true);
  assert.equal(shotList.content.derivation.sourceVersionId, script.versionId);
  assert.equal(shotList.content.derivation.inferredFacts, 0);
  assert.equal(shotList.content.generationScope, 'none');
  assert.equal(state.writes, 0);
  const storyboard = plan.productionDocuments.find((item) => item.kind === 'storyboard');
  assert.equal(storyboard.content.status, 'source-proposed');
  assert.deepEqual(storyboard.content.counts, {
    total: 2,
    ready: 0,
    missing: 2,
  });
  assert.deepEqual(storyboard.content.frames.map((item) => item.title), ['建立环境', '建立人物']);
  assert.equal(storyboard.content.frames[0].shotListItemId, shotList.content.shots[0].id);
  assert.equal(storyboard.content.frames[0].sourceShotId, script.content.shots[0].id);
  assert.equal(storyboard.content.frames[0].sourceEvidence.lineStart, 3);
  assert.equal(storyboard.content.frames[1].sourceEvidence.lineEnd, 6);
  assert.equal(storyboard.content.frames.every((item) => (
    item.frameStatus === 'missing'
      && item.candidateIds.length === 0
      && item.selectedCandidateId === null
      && item.assetId === null
      && item.acceptedAt === null
      && item.locked === false
      && item.prompt === ''
      && item.composition === ''
      && item.continuityNotes.length === 0
      && item.unresolved.length === 4
  )), true);
  assert.equal(storyboard.content.derivation.sourceDocumentId, shotList.id);
  assert.equal(storyboard.content.derivation.sourceVersionId, shotList.versionId);
  assert.equal(storyboard.content.derivation.sourceContentDigest, shotList.contentDigest);
  assert.equal(storyboard.content.adoptionPolicy, 'explicit-only');
  assert.equal(storyboard.content.generationScope, 'none');
  assert.equal(state.providerPosts, 0);
  const promptPack = plan.productionDocuments.find((item) => item.kind === 'prompt-pack');
  assert.equal(promptPack.content.status, 'source-proposed');
  assert.deepEqual(promptPack.content.counts, { total: 2, drafts: 2, reviewed: 0 });
  assert.deepEqual(promptPack.content.prompts.map((item) => item.title), ['建立环境', '建立人物']);
  assert.equal(promptPack.content.prompts[0].positivePrompt, storyboard.content.frames[0].sourceEvidence.sourceText);
  assert.equal(promptPack.content.prompts[1].positivePrompt, storyboard.content.frames[1].sourceEvidence.sourceText);
  assert.equal(promptPack.content.prompts.every((item) => (
    item.promptStatus === 'source-draft'
      && item.promptSource === 'script-evidence'
      && item.negativePrompt === ''
      && item.motionPrompt === ''
      && item.audioPrompt === ''
      && item.referenceAssetIds.length === 0
      && item.creatorReviewed === false
      && item.locked === false
      && item.unresolved.length === 5
  )), true);
  assert.equal(promptPack.content.derivation.sourceDocumentId, storyboard.id);
  assert.equal(promptPack.content.derivation.sourceVersionId, storyboard.versionId);
  assert.equal(promptPack.content.derivation.sourceContentDigest, storyboard.contentDigest);
  assert.equal(promptPack.content.reviewPolicy, 'explicit-confirmation');
  assert.equal(promptPack.content.generationScope, 'none');
});

test('AudioPlan extracts only explicit source-labelled cues with exact shot-line evidence', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const sourceText = [
    'Scene: The Alley',
    'Characters: 萌萌，罂瑶',
    '【镜头一｜建立环境】',
    '环境声：雨打铁皮棚。',
    '音乐：低频鼓点渐入。',
    '远处传来警笛声。',
    '【镜头二｜第一次对视】',
    '对白：萌萌说“你来了。”',
    '旁白：她没有回头。',
    'SFX: 金属锁扣声。',
  ].join('\n');
  const plan = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
  }, scope);
  const shotList = plan.productionDocuments.find((item) => item.kind === 'shot-list');
  const audioPlan = plan.productionDocuments.find((item) => item.kind === 'audio-plan');
  assert.equal(audioPlan.content.status, 'source-proposed');
  assert.deepEqual(audioPlan.content.counts, {
    total: 5,
    dialogue: 1,
    voiceover: 1,
    music: 1,
    ambience: 1,
    sfx: 1,
  });
  assert.deepEqual(audioPlan.content.items.map((item) => item.role), [
    'ambience', 'music', 'dialogue', 'voiceover', 'sfx',
  ]);
  assert.deepEqual(audioPlan.content.items.map((item) => item.sourceEvidence.lineStart), [4, 5, 8, 9, 10]);
  assert.deepEqual(audioPlan.content.items.map((item) => item.cueText), [
    '雨打铁皮棚。',
    '低频鼓点渐入。',
    '萌萌说“你来了。”',
    '她没有回头。',
    '金属锁扣声。',
  ]);
  assert.equal(audioPlan.content.items.some((item) => /警笛/.test(item.cueText)), false);
  assert.equal(audioPlan.content.items.every((item) => (
    item.trackStatus === 'source-draft'
      && item.promptSource === 'script-evidence'
      && item.provider === null
      && item.model === null
      && item.generationStatus === 'not-requested'
      && item.referenceAssetIds.length === 0
      && item.resultUrls.length === 0
      && item.locked === false
  )), true);
  assert.equal(audioPlan.content.derivation.sourceDocumentId, shotList.id);
  assert.equal(audioPlan.content.derivation.sourceVersionId, shotList.versionId);
  assert.equal(audioPlan.content.derivation.sourceContentDigest, shotList.contentDigest);
  assert.equal(audioPlan.content.derivation.providerCalls, 0);
  assert.equal(audioPlan.content.derivation.inferredFacts, 0);
  assert.deepEqual(audioPlan.content.mix.roles, ['dialogue', 'voiceover', 'music', 'ambience', 'sfx']);
  assert.equal(audioPlan.content.mix.requiresCreatorReview, true);
  assert.equal(audioPlan.content.generationScope, 'none');
  assert.match(audioPlan.content.editingGuidance, /没有选择 Provider\/模型、生成音频、上传素材或提交任务/);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});


test('Story previews bind to the exact PromptPack version and expose verified adoption receipts without rerunning providers', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const sourceText = [
    'Scene: The Alley',
    'Characters: 萌萌, 罂瑶',
    '【镜头一｜建立环境】',
    '雨夜的悉尼唐人街后巷。',
    '【镜头二｜建立人物】',
    '电梯门缓缓打开，萌萌独自走出。',
  ].join('\n');
  const first = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
  }, scope);
  const promptPack = first.productionDocuments.find((item) => item.kind === 'prompt-pack');
  const initialReview = first.productionDocuments.find((item) => item.kind === 'candidate-review');
  assert.equal(initialReview.content.counts.total, 0);
  state.applyPatch(service.requirePlan(first.planId, scope).patch);
  const story = state.document.nodes.find((node) => node.type === 'story');
  assert.equal(story.data.creatorProductionBinding.promptPackDocumentId, promptPack.id);
  assert.equal(story.data.creatorProductionBinding.promptPackVersionId, promptPack.versionId);
  assert.equal(story.data.creatorProductionBinding.shotBindings.length, 2);
  assert.equal(story.data.creatorProductionBinding.shotBindings
    .every((item) => item.matchMethod === 'exact-shot-source-evidence'), true);

  const previewPlan = service.actionPlan('story.plan-previews', { storyId: story.id }, scope);
  state.applyPatch(service.requirePlan(previewPlan.planId, scope).patch);
  const preview = state.document.nodes.find((node) => (
    node.type === 'image' && node.data.creatorProductionBinding?.promptPackItemId
  ));
  assert.ok(preview);
  assert.equal(preview.data.creatorProductionBinding.promptPackDocumentId, promptPack.id);
  preview.data.imageUrl = '/files/output/story-preview-1.png';
  preview.data.imageUrls = ['/files/output/story-preview-1.png'];
  preview.data.contentHash = 'sha256:story-preview-1';
  preview.data.taskId = 'task-story-preview-1';
  preview.data.status = 'succeeded';

  const reviewPlan = service.actionPlan('review', {
    nodeId: preview.id,
    review: {
      schema: 't8-creative-review-v1',
      source: 'visual-inspection',
      reviewer: 'creator',
      evidence: { contentHash: 'sha256:story-preview-1' },
      dimensions: {
        composition: { status: 'pass', summary: '构图清晰' },
        identity: { status: 'pass', summary: '人物一致' },
        productShape: { status: 'pass', summary: '无产品硬门问题' },
        textAccuracy: { status: 'pass', summary: '无错误文字' },
      },
    },
  }, scope);
  state.applyPatch(service.requirePlan(reviewPlan.planId, scope).patch);
  const acceptPlan = service.actionPlan('accept', { nodeId: preview.id }, scope);
  state.applyPatch(service.requirePlan(acceptPlan.planId, scope).patch);
  const accepted = state.document.nodes.find((node) => node.id === preview.id);
  assert.equal(accepted.data.creativeState.accepted, true);
  assert.equal(accepted.data.creativeState.acceptance.schema, 't8-creative-adoption-receipt-v1');
  assert.match(accepted.data.creativeState.acceptance.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.match(accepted.data.creativeState.acceptance.reviewDigest, /^[a-f0-9]{64}$/);

  const refreshed = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
    previousProductionDocuments: first.productionDocuments,
  }, scope);
  const currentReview = refreshed.productionDocuments.find((item) => item.kind === 'candidate-review');
  assert.equal(currentReview.revision, 2);
  assert.equal(currentReview.content.status, 'evidence-observed');
  assert.deepEqual(currentReview.content.counts, {
    total: 1, withResult: 1, reviewed: 1, adopted: 1, blocked: 0,
  });
  assert.equal(currentReview.content.candidates[0].nodeId, preview.id);
  assert.equal(currentReview.content.candidates[0].review.status, 'verified');
  assert.equal(currentReview.content.candidates[0].adoption.status, 'adopted');
  assert.equal(currentReview.content.candidates[0].adoption.receiptVerified, true);
  assert.equal(currentReview.content.candidates[0].executionEvidence.taskId, 'task-story-preview-1');
  assert.equal(currentReview.content.promptBindings
    .find((item) => item.promptPackItemId === preview.data.creatorProductionBinding.promptPackItemId)
    .selectedCandidateId, accepted.data.creativeState.candidateId);
  assert.equal(currentReview.content.derivation.sourceVersionId, promptPack.versionId);
  assert.equal(currentReview.content.derivation.documentProviderCalls, 0);
  assert.equal(currentReview.content.derivation.documentCanvasWrites, 0);
  assert.equal(state.providerPosts, 0);
});

test('EDL uses only verified adopted videos and never treats requested duration as media evidence', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const sourceText = [
    'Scene: The Alley',
    'Characters: 萌萌, 罂瑶',
    '【镜头一｜建立环境】',
    '雨夜的悉尼唐人街后巷。',
    '【镜头二｜建立人物】',
    '电梯门缓缓打开，萌萌独自走出。',
  ].join('\n');
  const first = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
  }, scope);
  state.applyPatch(service.requirePlan(first.planId, scope).patch);
  const story = state.document.nodes.find((node) => node.type === 'story');
  const previewPlan = service.actionPlan('story.plan-previews', { storyId: story.id }, scope);
  state.applyPatch(service.requirePlan(previewPlan.planId, scope).patch);
  const previews = state.document.nodes
    .filter((node) => node.data.creatorProductionBinding?.promptPackItemId)
    .sort((left, right) => (
      left.data.creatorProductionBinding.ordinal - right.data.creatorProductionBinding.ordinal
    ));
  assert.equal(previews.length, 2);

  previews.forEach((preview, index) => {
    delete preview.data.imageUrl;
    preview.data.imageUrls = [];
    preview.data.videoUrl = `/files/output/story-video-${index + 1}.mp4`;
    preview.data.videoUrls = [preview.data.videoUrl];
    preview.data.contentHash = `sha256:${String(index + 1).repeat(64)}`;
    preview.data.outputAssetId = `asset-story-video-${index + 1}`;
    preview.data.taskId = `task-story-video-${index + 1}`;
    preview.data.status = 'succeeded';
    preview.data.duration = index === 0 ? 8 : 9;
    if (index === 0) preview.data.output = { duration: 6 };
    const reviewPlan = service.actionPlan('review', {
      nodeId: preview.id,
      review: {
        schema: 't8-creative-review-v1',
        source: 'visual-inspection',
        reviewer: 'creator',
        evidence: { contentHash: preview.data.contentHash },
        dimensions: {
          composition: { status: 'pass', summary: '构图清晰' },
          identity: { status: 'pass', summary: '人物一致' },
          continuity: { status: 'pass', summary: '动作连续' },
          rhythm: { status: 'pass', summary: '节奏可用' },
          textAccuracy: { status: 'pass', summary: '无错误文字' },
        },
      },
    }, scope);
    state.applyPatch(service.requirePlan(reviewPlan.planId, scope).patch);
    const acceptPlan = service.actionPlan('accept', { nodeId: preview.id }, scope);
    state.applyPatch(service.requirePlan(acceptPlan.planId, scope).patch);
  });

  const writesBeforeRefresh = state.writes;
  const refreshed = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
    previousProductionDocuments: first.productionDocuments,
  }, scope);
  const review = refreshed.productionDocuments.find((item) => item.kind === 'candidate-review');
  const edl = refreshed.productionDocuments.find((item) => item.kind === 'edit-decision-list');
  assert.deepEqual(review.content.counts, {
    total: 2, withResult: 2, reviewed: 2, adopted: 2, blocked: 0,
  });
  assert.equal(edl.content.status, 'needs-duration-evidence');
  assert.deepEqual(edl.content.counts, {
    total: 2, ready: 1, missingDuration: 1, missingShots: 0, blocked: 0,
  });
  assert.deepEqual(edl.content.sequence.map((item) => item.ordinal), [1, 2]);
  assert.equal(edl.content.sequence[0].sourceDurationSec, 6);
  assert.equal(edl.content.sequence[0].requestedDurationSec, 8);
  assert.equal(edl.content.sequence[0].timelineStartSec, 0);
  assert.equal(edl.content.sequence[0].timelineEndSec, 6);
  assert.equal(edl.content.sequence[1].sourceDurationSec, null);
  assert.equal(edl.content.sequence[1].requestedDurationSec, 9);
  assert.equal(edl.content.sequence[1].timelineStartSec, null);
  assert.equal(edl.content.sequence[1].timelineEndSec, null);
  assert.equal(edl.content.sequence.every((item) => item.resultEvidence.referenceAvailable === true), true);
  assert.equal(edl.content.sequence.some((item) => Object.hasOwn(item.resultEvidence, 'url')), false);
  assert.equal(edl.content.timeline.timingStatus, 'incomplete');
  assert.equal(edl.content.timeline.totalDurationSec, null);
  assert.equal(edl.content.derivation.sourceDocumentId, review.id);
  assert.match(edl.content.derivation.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(edl.content.derivation.documentProviderCalls, 0);
  assert.equal(edl.content.derivation.documentCanvasWrites, 0);
  const emptyQc = refreshed.productionDocuments.find((item) => item.kind === 'qc-report');
  assert.equal(emptyQc.content.status, 'needs-verification-evidence');
  const emptyManifest = refreshed.productionDocuments.find((item) => item.kind === 'delivery-manifest');
  assert.equal(emptyManifest.content.status, 'blocked-by-qc');
  assert.deepEqual(emptyManifest.content.counts, {
    total: 2, included: 0, blocked: 2, awaiting: 0, packageFiles: 0, licenseKnown: 0, licenseUnknown: 0,
  });
  assert.deepEqual(emptyQc.content.counts, {
    total: 2, pass: 0, fail: 0, unknown: 2, checks: 22,
  });
  assert.equal(emptyQc.content.qcItems.every((item) => item.status === 'unknown'), true);
  assert.equal(emptyQc.content.qcItems.every((item) => item.verificationEvidence === null), true);

  const artifactVerifications = edl.content.sequence.map((item, index) => {
    const nodeRunId = `node-run-${index + 1}`;
    const runId = `run-${index + 1}`;
    const observedContentHash = String(item.resultEvidence.contentHash || '').replace(/^sha256:/, '');
    return {
      schema: 't8-creator-artifact-verification-v1',
      runId,
      verified: true,
      reasons: [],
      run: {
        runId,
        status: 'succeeded',
        canvasRevision: state.document.revision,
        createdAt: 1,
        finishedAt: 2,
      },
      nodeRuns: [{
        nodeRunId,
        nodeId: item.nodeId,
        status: 'succeeded',
        latestAttemptId: `attempt-${index + 1}`,
        latestAttemptStatus: 'succeeded',
        outputAssetIds: [item.resultEvidence.assetId],
      }],
      assets: [{
        assetId: item.resultEvidence.assetId,
        nodeRunId,
        kind: 'video',
        mimeType: 'video/mp4',
        contentHash: item.resultEvidence.contentHash,
        availability: 'available',
        stored: true,
        blobPresent: true,
        hashVerified: true,
        magicVerified: true,
        detectedKind: 'video',
        detectedMimeType: 'video/mp4',
        observedContentHash,
        byteSize: 1024 + index,
        width: 1920,
        height: 1080,
        duration: index === 0 ? 6 : 9,
        decodeEvidence: 'indexed-parser-verified',
        associationVerified: true,
        expectedNodeId: item.nodeId,
        expectedShotIds: [item.sourceShotId],
        observedShotIds: [item.sourceShotId],
        expectedCanvasRevision: state.document.revision,
      }],
      verifiedAt: `2026-07-27T00:00:0${index}Z`,
      verificationDigest: String(index + 1).repeat(64),
    };
  });
  const verifiedPlan = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
    previousProductionDocuments: refreshed.productionDocuments,
    artifactVerifications,
  }, scope);
  const verifiedQc = verifiedPlan.productionDocuments.find((item) => item.kind === 'qc-report');
  assert.equal(verifiedQc.content.status, 'needs-verification-evidence');
  assert.deepEqual(verifiedQc.content.counts, {
    total: 2, pass: 1, fail: 0, unknown: 1, checks: 22,
  });
  assert.equal(verifiedQc.content.qcItems[0].status, 'pass');
  assert.equal(verifiedQc.content.qcItems[1].status, 'unknown');
  assert.equal(verifiedQc.content.qcItems[0].verificationEvidence.runId, 'run-1');
  assert.doesNotMatch(JSON.stringify(verifiedQc.content), /\/files\/|https?:\/\//);

  const failedReceipt = JSON.parse(JSON.stringify(artifactVerifications[0]));
  const blockedManifest = verifiedPlan.productionDocuments.find((item) => item.kind === 'delivery-manifest');
  assert.equal(blockedManifest.content.status, 'blocked-by-qc');
  assert.equal(blockedManifest.content.deliverables[0].status, 'awaiting-current-delivery');
  assert.equal(blockedManifest.content.deliverables[1].status, 'blocked-by-qc');

  previews[1].data.output = { duration: 9 };
  const fullyVerifiedPlan = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
    previousProductionDocuments: verifiedPlan.productionDocuments,
    artifactVerifications,
  }, scope);
  const fullQc = fullyVerifiedPlan.productionDocuments.find((item) => item.kind === 'qc-report');
  const awaitingManifest = fullyVerifiedPlan.productionDocuments.find((item) => item.kind === 'delivery-manifest');
  assert.equal(fullQc.content.status, 'passed');
  assert.equal(fullQc.content.qcItems.every((item) => item.status === 'pass'), true);
  assert.equal(awaitingManifest.content.status, 'awaiting-current-delivery');
  assert.equal(awaitingManifest.content.deliverables.every((item) => item.status === 'awaiting-current-delivery'), true);

  const deliveryEvidence = [{
    schema: 't8-creator-delivery-evidence-v1',
    approvalRequestId: 'approval-delivery-1',
    planId: 'delivery-plan-1',
    packageName: 'the-alley-delivery',
    packageDigest: 'a'.repeat(64),
    selectionDigest: 'b'.repeat(64),
    scope: 'canvas',
    canvasRevision: state.document.revision,
    catalogRevision: 1,
    itemCount: 2,
    totalBytes: 2049,
    verifiedItems: 2,
    verifiedBytes: 2049,
    valid: true,
    licenseSummary: { known: 1, unknown: 1 },
    status: 'completed',
    recordedAt: '2026-07-27T01:00:00.000Z',
    files: fullQc.content.qcItems.map((item, index) => ({
      assetId: item.assetId,
      sha256: item.contentHash.replace(/^sha256:/, ''),
      size: 1024 + index,
    })),
  }];
  const deliveredPlan = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
    previousProductionDocuments: fullyVerifiedPlan.productionDocuments,
    artifactVerifications,
    deliveryEvidence,
  }, scope);
  const deliveredManifest = deliveredPlan.productionDocuments.find((item) => item.kind === 'delivery-manifest');
  assert.equal(deliveredManifest.content.status, 'delivered-needs-license-review');
  assert.equal(deliveredManifest.content.releaseReadiness, 'needs-license-review');
  assert.equal(deliveredManifest.content.counts.included, 2);
  assert.equal(deliveredManifest.content.packageEvidence.valid, true);
  assert.equal(deliveredManifest.content.packageEvidence.exactQcAssetsIncluded, true);
  assert.doesNotMatch(JSON.stringify(deliveredManifest.content), /\/files\/|https?:\/\/|[A-Z]:\\/i);

  const tamperedEvidence = structuredClone(deliveryEvidence);
  tamperedEvidence[0].files[0].sha256 = 'c'.repeat(64);
  const tamperedDeliveryPlan = service.createPlan({
    kind: 'story', prompt: sourceText, ratio: '16:9', duration: 20,
    previousProductionDocuments: deliveredPlan.productionDocuments,
    artifactVerifications, deliveryEvidence: tamperedEvidence,
  }, scope);
  assert.equal(tamperedDeliveryPlan.productionDocuments
    .find((item) => item.kind === 'delivery-manifest').content.status, 'awaiting-current-delivery');

  const releaseEvidence = structuredClone(deliveryEvidence);
  releaseEvidence[0].licenseSummary = { known: 2, unknown: 0 };
  const releasePlan = service.createPlan({
    kind: 'story', prompt: sourceText, ratio: '16:9', duration: 20,
    previousProductionDocuments: deliveredPlan.productionDocuments,
    artifactVerifications, deliveryEvidence: releaseEvidence,
  }, scope);
  const releaseManifest = releasePlan.productionDocuments.find((item) => item.kind === 'delivery-manifest');
  assert.equal(releaseManifest.content.status, 'delivered-and-verified');
  assert.equal(releaseManifest.content.releaseReadiness, 'ready');
  failedReceipt.verified = false;
  failedReceipt.verificationDigest = 'f'.repeat(64);
  failedReceipt.assets[0].magicVerified = false;
  const failedPlan = service.createPlan({
    kind: 'story',
    prompt: sourceText,
    ratio: '16:9',
    duration: 20,
    previousProductionDocuments: verifiedPlan.productionDocuments,
    artifactVerifications: [failedReceipt, artifactVerifications[1]],
  }, scope);
  const failedQc = failedPlan.productionDocuments.find((item) => item.kind === 'qc-report');
  assert.equal(failedQc.content.status, 'failed');
  assert.equal(failedQc.content.counts.fail, 1);
  assert.equal(failedQc.content.qcItems[0].status, 'fail');
  assert.equal(state.writes, writesBeforeRefresh);
  assert.equal(state.providerPosts, 0);
});

test('staged production keeps the full document chain and the correct expected result kind for every creative family', () => {
  const sourceText = [
    '【镜头一｜主画面】',
    '一只黄色小鸭站在暖色窗边，画面安静温馨。',
  ].join('\n');
  const expectedKinds = [
    'production-brief',
    'script-doc',
    'world-bible',
    'character-bible',
    'asset-needs',
    'shot-list',
    'audio-plan',
    'storyboard',
    'prompt-pack',
    'candidate-review',
    'edit-decision-list',
    'qc-report',
    'delivery-manifest',
  ];
  for (const [kind, resultKind] of [
    ['image', 'image'],
    ['video', 'video'],
    ['audio', 'audio'],
    ['script', 'text'],
  ]) {
    const state = fixture();
    const service = createAgentControlCreativeService({ database: state.database });
    const plan = service.createPlan({
      kind,
      prompt: sourceText,
      stagedProduction: true,
      candidates: 1,
    }, scope);
    assert.deepEqual(plan.productionDocuments.map((item) => item.kind), expectedKinds);
    const editDecisionList = plan.productionDocuments
      .find((item) => item.kind === 'edit-decision-list');
    const qcReport = plan.productionDocuments.find((item) => item.kind === 'qc-report');
    assert.equal(editDecisionList.content.resultKind, resultKind);
    assert.equal(editDecisionList.content.status, `awaiting-adopted-${resultKind}`);
    assert.equal(
      editDecisionList.content.derivation.method,
      resultKind === 'video'
        ? 'verified-adopted-video-sequence'
        : 'verified-adopted-media-sequence',
    );
    assert.equal(
      editDecisionList.content.reviewPolicy,
      resultKind === 'video'
        ? 'verified-adopted-video-only'
        : `verified-adopted-${resultKind}-only`,
    );
    assert.equal(qcReport.content.resultKind, resultKind);
    assert.equal(qcReport.content.status, 'awaiting-edit-decision-list');
    assert.equal(state.writes, 0);
    assert.equal(state.providerPosts, 0);
  }
});

test('staged image production binds, reviews, adopts and verifies one real image without video-only gates', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const sourceText = [
    '【镜头一｜主画面】',
    '一只黄色小鸭站在暖色窗边，画面安静温馨。',
  ].join('\n');
  const first = service.createPlan({
    kind: 'image',
    prompt: sourceText,
    ratio: '1:1',
    candidates: 1,
    stagedProduction: true,
  }, scope);
  const promptPack = first.productionDocuments.find((item) => item.kind === 'prompt-pack');
  assert.equal(promptPack.content.prompts.length, 1);
  state.applyPatch(service.requirePlan(first.planId, scope).patch);
  const candidate = state.document.nodes.find((node) => node.type === 'image');
  assert.ok(candidate);
  assert.equal(
    candidate.data.creatorProductionBinding.promptPackDocumentId,
    promptPack.id,
  );
  assert.equal(
    candidate.data.creatorProductionBinding.promptPackItemId,
    promptPack.content.prompts[0].id,
  );
  assert.equal(candidate.data.creatorProductionBinding.matchMethod, 'single-prompt-pack-item');

  const contentHash = `sha256:${'a'.repeat(64)}`;
  candidate.data.imageUrl = '/files/output/duck.png';
  candidate.data.imageUrls = [candidate.data.imageUrl];
  candidate.data.contentHash = contentHash;
  candidate.data.outputAssetId = 'asset-duck-image';
  candidate.data.taskId = 'task-duck-image';
  candidate.data.status = 'succeeded';
  const reviewPlan = service.actionPlan('review', {
    nodeId: candidate.id,
    review: {
      schema: 't8-creative-review-v1',
      source: 'visual-inspection',
      reviewer: 'creator',
      evidence: { contentHash },
      dimensions: {
        composition: { status: 'pass', summary: '主体与留白清晰' },
        identity: { status: 'pass', summary: '小鸭主体一致' },
        productShape: { status: 'pass', summary: '轮廓稳定' },
        textAccuracy: { status: 'pass', summary: '无错误文字' },
      },
    },
  }, scope);
  state.applyPatch(service.requirePlan(reviewPlan.planId, scope).patch);
  const acceptPlan = service.actionPlan('accept', { nodeId: candidate.id }, scope);
  state.applyPatch(service.requirePlan(acceptPlan.planId, scope).patch);

  const refreshed = service.createPlan({
    kind: 'image',
    prompt: sourceText,
    ratio: '1:1',
    candidates: 1,
    stagedProduction: true,
    previousProductionDocuments: first.productionDocuments,
  }, scope);
  const candidateReview = refreshed.productionDocuments
    .find((item) => item.kind === 'candidate-review');
  const adoptedImages = refreshed.productionDocuments
    .find((item) => item.kind === 'edit-decision-list');
  assert.deepEqual(candidateReview.content.counts, {
    total: 1,
    withResult: 1,
    reviewed: 1,
    adopted: 1,
    blocked: 0,
  });
  assert.equal(adoptedImages.content.resultKind, 'image');
  assert.equal(adoptedImages.content.status, 'source-assembled');
  assert.equal(adoptedImages.content.derivation.method, 'verified-adopted-media-sequence');
  assert.equal(adoptedImages.content.reviewPolicy, 'verified-adopted-image-only');
  assert.deepEqual(adoptedImages.content.counts, {
    total: 1,
    ready: 1,
    missingDuration: 0,
    missingShots: 0,
    blocked: 0,
  });
  assert.equal(adoptedImages.content.sequence[0].resultKind, 'image');
  assert.equal(adoptedImages.content.sequence[0].durationEvidence, 'not-applicable');
  assert.equal(adoptedImages.content.timeline.timingStatus, 'not-applicable');
  assert.equal(adoptedImages.content.timeline.totalDurationSec, null);

  const verification = {
    schema: 't8-creator-artifact-verification-v1',
    runId: 'run-duck-image',
    verified: true,
    reasons: [],
    run: {
      runId: 'run-duck-image',
      status: 'succeeded',
      canvasRevision: state.document.revision,
      createdAt: 1,
      finishedAt: 2,
    },
    nodeRuns: [{
      nodeRunId: 'node-run-duck-image',
      nodeId: candidate.id,
      status: 'succeeded',
      latestAttemptId: 'attempt-duck-image',
      latestAttemptStatus: 'succeeded',
      outputAssetIds: ['asset-duck-image'],
    }],
    assets: [{
      assetId: 'asset-duck-image',
      nodeRunId: 'node-run-duck-image',
      kind: 'image',
      mimeType: 'image/png',
      contentHash,
      availability: 'available',
      stored: true,
      blobPresent: true,
      hashVerified: true,
      magicVerified: true,
      detectedKind: 'image',
      detectedMimeType: 'image/png',
      observedContentHash: 'a'.repeat(64),
      byteSize: 2048,
      width: 1024,
      height: 1024,
      decodeEvidence: 'indexed-parser-verified',
      associationVerified: true,
      expectedNodeId: candidate.id,
      expectedShotIds: [adoptedImages.content.sequence[0].sourceShotId],
      observedShotIds: [adoptedImages.content.sequence[0].sourceShotId],
      expectedCanvasRevision: state.document.revision,
    }],
    verifiedAt: '2026-07-30T00:00:00.000Z',
    verificationDigest: 'b'.repeat(64),
  };
  const verified = service.createPlan({
    kind: 'image',
    prompt: sourceText,
    ratio: '1:1',
    candidates: 1,
    stagedProduction: true,
    previousProductionDocuments: refreshed.productionDocuments,
    artifactVerifications: [verification],
  }, scope);
  const qualityControl = verified.productionDocuments.find((item) => item.kind === 'qc-report');
  assert.equal(qualityControl.content.resultKind, 'image');
  assert.equal(qualityControl.content.status, 'passed');
  assert.deepEqual(qualityControl.content.counts, {
    total: 1,
    pass: 1,
    fail: 0,
    unknown: 0,
    checks: 9,
  });
  assert.equal(qualityControl.content.qcItems[0].resultKind, 'image');
  assert.equal(
    qualityControl.content.qcItems[0].checks.some((item) => item.id === 'source-duration'),
    false,
  );
  assert.equal(
    qualityControl.content.qcItems[0].checks.some((item) => item.id === 'resolution'),
    true,
  );
  assert.equal(state.providerPosts, 0);
});

test('natural single-output prompts form one source-backed production unit without inventing shots', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const sourceText = '电影感雨夜车站主视觉：空站台、湿地反光、远处暖色列车灯。';
  const plan = service.createPlan({
    kind: 'image',
    prompt: sourceText,
    ratio: '16:9',
    candidates: 3,
    stagedProduction: true,
  }, scope);
  const script = plan.productionDocuments.find((item) => item.kind === 'script-doc');
  const shotList = plan.productionDocuments.find((item) => item.kind === 'shot-list');
  const promptPack = plan.productionDocuments.find((item) => item.kind === 'prompt-pack');
  assert.equal(script.content.scriptAnalysis.method, 'deterministic-single-output-source-map');
  assert.equal(script.content.scriptAnalysis.singleOutputFallback, true);
  assert.equal(script.content.scriptAnalysis.inferredFacts, 0);
  assert.equal(script.content.shots.length, 1);
  assert.equal(script.content.shots[0].sourceText, sourceText.normalize('NFKC'));
  assert.equal(shotList.content.shots.length, 1);
  assert.equal(shotList.content.derivation.singleOutputFallback, true);
  assert.equal(promptPack.content.prompts.length, 1);
  assert.equal(promptPack.content.prompts[0].positivePrompt, sourceText.normalize('NFKC'));
  state.applyPatch(service.requirePlan(plan.planId, scope).patch);
  const candidates = state.document.nodes.filter((node) => node.type === 'image');
  assert.equal(candidates.length, 3);
  assert.equal(candidates.every((node) => (
    node.data.creatorProductionBinding?.promptPackItemId === promptPack.content.prompts[0].id
    && node.data.creatorProductionBinding?.matchMethod === 'single-prompt-pack-item'
  )), true);
  assert.equal(state.providerPosts, 0);
});

test('generic node creation uses the authoritative schema, stays preview-first, and rejects hidden or invented fields', () => {

  const state = fixture([{
    id: 'existing-node',
    type: 'text',
    position: { x: 100, y: 40 },
    data: { text: 'existing' },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.actionPlan('graph.node-add', {
    type: 'image',
    x: 720,
    y: 180,
    data: { gptImageQuality: 'high' },
  }, scope);
  assert.equal(plan.ready, true);
  assert.equal(plan.action, 'graph.node-add');
  assert.equal(plan.kind, 'graph');
  assert.equal(plan.impact.writesNow, 0);
  assert.equal(plan.impact.providerCallsNow, 0);
  assert.deepEqual(plan.targets.proposedNodes.map((item) => item.type), ['image']);
  const node = service.requirePlan(plan.planId, scope).patch.operations[0].payload.node;
  assert.equal(node.type, 'image');
  assert.deepEqual(node.position, { x: 720, y: 180 });
  assert.equal(node.data.gptImageQuality, 'high');
  assert.equal(node.data.model, 'gpt-image-2');
  assert.equal(node.data.imageOnlyOutput, true);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);

  const textPlan = service.actionPlan('graph.node-add', {
    type: 'text',
    prompt: '建立角色一致性参考',
  }, scope);
  const textNode = service.requirePlan(textPlan.planId, scope).patch.operations[0].payload.node;
  assert.equal(textNode.data.text, '建立角色一致性参考');
  assert.deepEqual(textNode.position, { x: 560, y: 0 });

  const loopPlan = service.actionPlan('graph.node-add', { type: 'loop' }, scope);
  const loopNode = service.requirePlan(loopPlan.planId, scope).patch.operations[0].payload.node;
  assert.equal(loopNode.type, 'loop');
  assert.deepEqual(loopNode.data, {});

  assert.throws(
    () => service.actionPlan('graph.node-add', { type: 'remove-bg' }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_NODE_TYPE_HIDDEN',
  );
  assert.throws(
    () => service.actionPlan('graph.node-add', {
      type: 'image',
      data: { inventedSecretField: 'nope' },
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_NODE_DATA_FORBIDDEN',
  );
  assert.throws(
    () => service.actionPlan('graph.node-add', {
      type: 'loop',
      data: { mode: 'parallel' },
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_NODE_DATA_FORBIDDEN',
  );
  assert.throws(
    () => service.actionPlan('graph.node-add', {
      type: 'text',
      position: ['not', 'coordinates'],
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_NODE_POSITION_INVALID',
  );
});

test('dedicated local utility actions build truthful editable workflows without exposing hidden nodes generically', () => {
  const state = fixture([
    {
      id: 'video-source',
      type: 'seedance',
      position: { x: 120, y: 80 },
      data: { videoUrl: '/files/output/source-video.mp4' },
    },
    {
      id: 'image-source',
      type: 'image',
      position: { x: 120, y: 720 },
      data: { imageUrl: '/files/output/source-image.png' },
    },
  ]);
  const service = createAgentControlCreativeService({ database: state.database });

  const framePlan = service.actionPlan('video.extract-frames', {
    sourceNodeId: 'video-source',
    count: 99,
  }, scope);
  assert.equal(framePlan.action, 'video.extract-frames');
  assert.equal(framePlan.kind, 'video');
  assert.equal(framePlan.impact.writesNow, 0);
  assert.equal(framePlan.impact.providerCallsNow, 0);
  assert.equal(framePlan.targets.proposedNodes.length, 2);
  const framePatch = service.requirePlan(framePlan.planId, scope).patch;
  assert.deepEqual(
    framePatch.operations.map((operation) => operation.type),
    ['node.add', 'edge.add', 'node.add', 'edge.add'],
  );
  const frameNode = framePatch.operations[0].payload.node;
  const frameOutput = framePatch.operations[2].payload.node;
  assert.equal(frameNode.type, 'frame-extractor');
  assert.equal(frameNode.data.count, 20);
  assert.equal(frameNode.data.sourceNodeId, 'video-source');
  assert.equal(frameNode.data.agentUtilityAction, 'video.extract-frames');
  assert.equal(frameOutput.type, 'output');
  assert.equal(frameOutput.data.sourceNodeId, frameNode.id);
  assert.equal(framePlan.targets.primaryNodeId, frameNode.id);
  assert.deepEqual(
    framePatch.operations.filter((operation) => operation.type === 'edge.add')
      .map((operation) => [
        operation.payload.edge.source,
        operation.payload.edge.target,
      ]),
    [
      ['video-source', frameNode.id],
      [frameNode.id, frameOutput.id],
    ],
  );
  assert.match(framePatch.summary, /运行前仍需单独确认/);

  const removePlan = service.actionPlan('image.remove-solid-background', {
    sourceNodeId: 'image-source',
  }, scope);
  const removePatch = service.requirePlan(removePlan.planId, scope).patch;
  const removeNode = removePatch.operations[0].payload.node;
  assert.equal(removeNode.type, 'remove-bg');
  assert.equal(removeNode.data.sourceNodeId, 'image-source');
  assert.equal(removePlan.targets.primaryNodeId, removeNode.id);

  const upscalePlan = service.actionPlan('image.resample-upscale', {
    sourceNodeId: 'image-source',
    scale: 3,
  }, scope);
  const upscalePatch = service.requirePlan(upscalePlan.planId, scope).patch;
  const upscaleNode = upscalePatch.operations[0].payload.node;
  assert.equal(upscaleNode.type, 'upscale');
  assert.equal(upscaleNode.data.scale, 3);
  assert.equal(upscalePlan.targets.primaryNodeId, upscaleNode.id);

  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
  assert.throws(
    () => service.actionPlan('video.extract-frames', { sourceNodeId: 'image-source' }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_UTILITY_SOURCE_KIND_INVALID',
  );
  assert.throws(
    () => service.actionPlan('image.resample-upscale', {}, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_UTILITY_SOURCE_REQUIRED',
  );
  assert.throws(
    () => service.actionPlan('graph.node-add', { type: 'upscale' }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_NODE_TYPE_HIDDEN',
  );
});

test('one-sentence video and Story requests use visible defaults instead of blocking on setup questions', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const video = service.createPlan({
    kind: 'video',
    prompt: '一只小鸭在雨后的街道开心跳舞',
  }, scope);
  assert.equal(video.ready, true);
  assert.equal(video.brief.durationSec, 8);
  assert.equal(video.brief.ratio, '16:9');
  assert.equal(video.questions.length, 0);

  const story = service.createPlan({
    kind: 'story',
    prompt: '把这段剧本做成 30 秒竖屏短片：两个朋友在雨夜重逢，最后一起走向清晨。',
  }, scope);
  assert.equal(story.ready, true);
  assert.equal(story.brief.durationSec, 30);
  assert.equal(story.brief.ratio, '9:16');
  assert.equal(story.questions.length, 0);
  assert.equal(story.visibleAssumptions.durationSec, 30);
  assert.equal(story.visibleAssumptions.ratio, '9:16');
  assert.equal(story.visibleAssumptions.editableByNaturalLanguage, true);
  assert.match(story.targets.storyNodeId, /^story-node-/);
  assert.equal(story.targets.primaryNodeId, story.targets.storyNodeId);
  assert.deepEqual(story.targets.proposedNodes.map((node) => node.type), ['story']);
  assert.equal(story.analysis.source, 'local-fallback');
  assert.ok(story.analysis.shotCount >= 1);
  assert.ok(story.analysis.assetCount >= 1);
  assert.equal(story.analysis.stage, 'shots');
  assert.equal(story.analysis.generationStarted, false);
  const storyNode = service.requirePlan(story.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'story')
    .payload.node;
  assert.equal(storyNode.data.storyProject.analysisSource, 'local-fallback');
  assert.equal(storyNode.data.storyProject.stage, 'shots');
  assert.ok(storyNode.data.storyProject.shots.length >= 1);
  assert.ok(storyNode.data.storyProject.assets.length >= 1);
  assert.equal(storyNode.data.storyProject.audioPlan.schema, 't8-story-audio-plan-v1');
  assert.equal(storyNode.data.storyProject.productionRevision, 0);

  const tvc = service.createPlan({
    kind: 'story',
    prompt: '为透明折叠伞做 20 秒雨季广告',
    recipe: 'tvc',
  }, scope);
  assert.equal(tvc.brief.durationSec, 20);
  assert.equal(tvc.brief.ratio, '9:16');
  const tvcNode = service.requirePlan(tvc.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'story')
    .payload.node;
  const productAsset = tvcNode.data.storyProject.assets
    .find((asset) => asset.name === '透明折叠伞');
  assert.ok(productAsset);
  assert.equal(productAsset.kind, 'prop');
  assert.match(productAsset.prompt, /商业产品设定图/);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);

  const shotBreakdown = service.createPlan({
    kind: 'story',
    prompt: '帮我拉片，只学习镜头语言和节奏',
    recipe: 'shot-breakdown',
  }, scope);
  assert.equal(shotBreakdown.ready, false);
  assert.equal(shotBreakdown.brief.recipe, 'shot-breakdown');
  assert.equal(shotBreakdown.questions[0].id, 'shot-breakdown-video');
  assert.match(shotBreakdown.questions[0].reason, /必须绑定真实视频素材/);
  assert.equal(shotBreakdown.impact.providerCallsNow, 0);
});

test('reference video breakdown creates an evidence-bound multimodal analysis workflow without media generation', () => {
  const videoAsset = {
    id: 'asset-reference-video',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 7,
    contentHash: 'a'.repeat(64),
    filename: 'reference-rhythm.mp4',
    mimeType: 'video/mp4',
    byteSize: 12_345_678,
    managedPath: 'E:\\private\\must-not-leak\\reference-rhythm.mp4',
  };
  const state = fixture([], [videoAsset]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '帮我拉片，提取逐镜头时间码、景别、运镜、声音和可编辑提示词',
    recipe: 'shot-breakdown',
    assetIds: [videoAsset.id],
    llmProvider: 'zhenzhen',
    llmModel: 'gemini-3.5-flash',
  }, scope);

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.productionDocuments.map((item) => item.kind), [
    'production-brief',
    'reference-breakdown',
  ]);
  const breakdown = plan.productionDocuments.find((item) => item.kind === 'reference-breakdown');
  assert.equal(breakdown.content.status, 'awaiting-analysis-run');
  assert.deepEqual(breakdown.content.shots, []);
  assert.deepEqual(breakdown.content.sourceBinding, {
    assetId: videoAsset.id,
    kind: 'video',
    contentRevision: 7,
    contentHash: 'a'.repeat(64),
    filename: videoAsset.filename,
    mimeType: videoAsset.mimeType,
    byteSize: videoAsset.byteSize,
    mediaUrl: `/api/project-assets/${videoAsset.id}/media`,
  });
  assert.doesNotMatch(JSON.stringify(breakdown), /must-not-leak|managedPath/);
  assert.equal(breakdown.content.generationPolicy.mediaGenerationCalls, 0);
  assert.equal(breakdown.content.generationPolicy.autoRun, false);

  const patch = service.requirePlan(plan.planId, scope).patch;
  const nodes = patch.operations
    .filter((operation) => operation.type === 'node.add')
    .map((operation) => operation.payload.node);
  assert.deepEqual(nodes.map((node) => node.type), ['upload', 'text', 'llm', 'output']);
  assert.equal(nodes.some((node) => ['story', 'image', 'seedance', 'audio'].includes(node.type)), false);
  const upload = nodes.find((node) => node.type === 'upload');
  const instruction = nodes.find((node) => node.type === 'text');
  const llm = nodes.find((node) => node.type === 'llm');
  assert.equal(upload.data.sourceAssetId, videoAsset.id);
  assert.equal(upload.data.sourceContentHash, 'a'.repeat(64));
  assert.match(instruction.data.text, /HH:MM:SS\.mmm/);
  assert.match(instruction.data.text, /景别、运镜、构图/);
  assert.match(instruction.data.text, /未知\/无法确认/);
  assert.match(instruction.data.text, /不生成图片、视频或音频/);
  assert.equal(llm.data.stream, false);
  assert.equal(llm.data.llmApiSource, 'zhenzhen');
  assert.equal(llm.data.providerSource, 'zhenzhen');
  assert.equal(llm.data.providerId, '');
  assert.equal(llm.data.providerModel, '');
  assert.equal(llm.data.llmVideoMode, 'frames');
  assert.equal(llm.data.videoFrameCount, 48);
  assert.equal(llm.data.videoFrameMaxSize, 720);
  assert.equal(llm.data.analysisMode, 'reference-video-shot-breakdown');
  assert.equal(llm.data.outputSchema, 't8-reference-video-breakdown-v2');
  assert.equal(patch.operations.filter((operation) => operation.type === 'edge.add').length, 3);
  assert.equal(plan.analysis.source, 'reference-video');
  assert.equal(plan.analysis.stage, 'shots');
  assert.equal(plan.analysis.generationStarted, false);
  assert.equal(plan.impact.providerCallsNow, 0);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('reference video breakdown safely ingests a source-bound structured result without creating a duplicate workflow', () => {
  const videoAsset = {
    id: 'asset-reference-video-result',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 9,
    contentHash: 'd'.repeat(64),
    filename: 'result-reference.mp4',
    mimeType: 'video/mp4',
    byteSize: 7_654_321,
  };
  const result = {
    sourceAsset: {
      assetId: videoAsset.id,
      contentRevision: videoAsset.contentRevision,
      contentHash: videoAsset.contentHash,
    },
    summary: {
      totalDuration: '00:00:08.000',
      shotCount: 99,
      averageShotDuration: '8 秒',
      editingDensity: '低',
      rhythmPattern: '缓慢建立环境',
      cameraLanguage: '固定机位后缓推',
      soundStructure: '当前链路未做声音分类',
      transcriptEvidence: '[00:00:01.000 - 00:00:02.000] 开门',
      transcriptAttribution: 'provider-segments',
      providerSecret: 'must-not-survive',
    },
    shots: [{
      ordinal: 1,
      startTimecode: '00:00:00.000',
      endTimecode: '00:00:08.000',
      durationSec: 999,
      title: '建立环境',
      shotSize: '全景',
      cameraMovement: '缓慢推进',
      composition: '巷道消失点位于画面中央',
      action: '雨夜巷道中霓虹倒映，镜头缓慢前进',
      dialogue: '未知',
      narration: '未知',
      music: '未知',
      ambience: '未知',
      sfx: '未知',
      editablePrompt: '雨夜后巷，缓慢推进，电影写实',
      confidence: 0.82,
      evidence: ['采样帧 1-4'],
      unknowns: ['边界为采样近似'],
      providerPayload: { secret: true },
    }],
    limitations: ['每 2 秒采样，镜头边界为保守区间'],
    unknownProviderField: 'must-not-survive',
  };
  const initialNodes = [{
    id: 'llm-breakdown-result',
    type: 'llm',
    data: {
      analysisMode: 'reference-video-shot-breakdown',
      outputSchema: 't8-reference-video-breakdown-v2',
      status: 'success',
      requestId: 'request-safe-1',
      referenceBindings: [{
        assetId: videoAsset.id,
        kind: 'video',
        contentRevision: videoAsset.contentRevision,
        contentHash: videoAsset.contentHash,
      }],
      reply: `拉片完成。\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``,
    },
  }];
  const state = fixture(initialNodes, [videoAsset]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '继续核对这个参考视频的拉片结果',
    recipe: 'shot-breakdown',
    assetIds: [videoAsset.id],
    llmProvider: 'zhenzhen',
    llmModel: 'gemini-3.5-flash',
  }, scope);

  assert.equal(plan.action, 'review.reference-breakdown');
  assert.equal(plan.patchId, null);
  assert.equal(plan.targets.primaryNodeId, 'llm-breakdown-result');
  assert.deepEqual(plan.targets.affectedNodeIds, ['llm-breakdown-result']);
  assert.equal(plan.analysis.status, 'analysis-result-ready');
  assert.equal(plan.analysis.shotCount, 1);
  assert.equal(plan.analysis.analysisRunStarted, true);
  assert.equal(plan.analysis.evidenceNodeId, 'llm-breakdown-result');
  assert.match(plan.analysis.evidenceDigest, /^[a-f0-9]{64}$/);
  const breakdown = plan.productionDocuments.find((item) => item.kind === 'reference-breakdown');
  assert.equal(breakdown.content.status, 'analysis-result-ready');
  assert.equal(breakdown.content.summary.shotCount, 1);
  assert.equal(breakdown.content.summary.transcriptAttribution, 'provider-segments');
  assert.equal('providerSecret' in breakdown.content.summary, false);
  assert.equal(breakdown.content.shots.length, 1);
  assert.equal(breakdown.content.shots[0].durationSec, 8);
  assert.equal(breakdown.content.shots[0].startTimecode, '00:00:00.000');
  assert.equal(breakdown.content.shots[0].endTimecode, '00:00:08.000');
  assert.equal(breakdown.content.shots[0].status, 'source-proposed');
  assert.deepEqual(breakdown.content.shots[0].unknowns, ['边界为采样近似']);
  assert.equal('providerPayload' in breakdown.content.shots[0], false);
  assert.deepEqual(breakdown.content.limitations, ['每 2 秒采样,镜头边界为保守区间']);
  assert.equal(breakdown.content.resultEvidence.sourceNodeId, 'llm-breakdown-result');
  assert.equal(breakdown.content.resultEvidence.requestId, 'request-safe-1');
  assert.equal(breakdown.content.resultEvidence.runBindingStatus, 'awaiting-run-evidence');
  assert.doesNotMatch(JSON.stringify(breakdown), /providerSecret|unknownProviderField|must-not-survive/);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

function referenceRunEvidenceFixture(suffix, options = {}) {
  const asset = {
    id: `asset-reference-run-${suffix}`,
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 3,
    contentHash: 'a'.repeat(64),
    filename: `reference-run-${suffix}.mp4`,
    mimeType: 'video/mp4',
    byteSize: 1_234_567,
  };
  const requestId = `request-reference-run-${suffix}`;
  const binding = {
    assetId: asset.id,
    kind: 'video',
    contentRevision: asset.contentRevision,
    contentHash: asset.contentHash,
  };
  const result = {
    sourceAsset: {
      assetId: asset.id,
      contentRevision: asset.contentRevision,
      contentHash: asset.contentHash,
    },
    summary: { totalDuration: '00:00:02.000', shotCount: 1 },
    shots: [{
      ordinal: 1,
      startTimecode: '00:00:00.000',
      endTimecode: '00:00:02.000',
      action: '人物从门后进入画面',
      evidence: ['采样帧 1-2'],
    }],
    limitations: ['镜头边界为采样近似'],
  };
  const node = {
    id: `llm-reference-run-${suffix}`,
    type: 'llm',
    data: {
      analysisMode: 'reference-video-shot-breakdown',
      outputSchema: 't8-reference-video-breakdown-v2',
      status: 'success',
      requestId,
      referenceBindings: [binding],
      reply: JSON.stringify(result),
    },
  };
  const state = fixture([node], [asset]);
  const run = {
    id: `run-reference-${suffix}`,
    projectId: 'project-local',
    canvasId: 'canvas-a',
    canvasRevision: 12,
    status: options.runStatus || 'running',
  };
  const nodeRun = {
    id: `node-run-reference-${suffix}`,
    runId: run.id,
    nodeId: node.id,
    originalNodeId: node.id,
    status: options.nodeRunStatus || 'succeeded',
    inputSnapshot: {
      replayable: true,
      node: {
        id: node.id,
        type: 'llm',
        data: {
          analysisMode: 'reference-video-shot-breakdown',
          outputSchema: 't8-reference-video-breakdown-v2',
          referenceBindings: [binding],
        },
      },
    },
  };
  const attempt = {
    id: `attempt-reference-${suffix}`,
    nodeRunId: nodeRun.id,
    requestId: options.attemptRequestId === undefined ? requestId : options.attemptRequestId,
    status: options.attemptStatus || 'succeeded',
  };
  Object.assign(state.database, {
    listRuns() {
      return [structuredClone(run)];
    },
    listNodeRuns(runId) {
      return runId === run.id ? [structuredClone(nodeRun)] : [];
    },
    listAttempts(nodeRunId) {
      return nodeRunId === nodeRun.id ? [structuredClone(attempt)] : [];
    },
  });
  return { asset, node, state, run, nodeRun, attempt };
}

test('reference video breakdown verifies exact Run NodeRun Attempt execution evidence without requiring the whole Run to finish', () => {
  const { asset, state, run, nodeRun, attempt } = referenceRunEvidenceFixture('verified');
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '核对真实运行证据',
    recipe: 'shot-breakdown',
    assetIds: [asset.id],
  }, scope);

  const breakdown = plan.productionDocuments.find((item) => item.kind === 'reference-breakdown');
  assert.equal(plan.action, 'review.reference-breakdown');
  assert.equal(breakdown.content.status, 'analysis-result-ready');
  assert.equal(breakdown.content.resultEvidence.runBindingStatus, 'verified');
  assert.equal(breakdown.content.resultEvidence.runId, run.id);
  assert.equal(breakdown.content.resultEvidence.nodeRunId, nodeRun.id);
  assert.equal(breakdown.content.resultEvidence.attemptId, attempt.id);
  assert.equal(breakdown.content.resultEvidence.runStatus, 'running');
  assert.equal(breakdown.content.resultEvidence.nodeRunStatus, 'succeeded');
  assert.equal(breakdown.content.resultEvidence.attemptStatus, 'succeeded');
  assert.match(breakdown.content.resultEvidence.runEvidenceReason, /已核验/);
  assert.equal(plan.analysis.runBindingStatus, 'verified');
  assert.equal(plan.analysis.runId, run.id);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('reference video breakdown exposes a pending ledger while the exact node attempt is still running', () => {
  const { asset, state } = referenceRunEvidenceFixture('pending', {
    nodeRunStatus: 'running',
    attemptStatus: 'running',
  });
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '检查运行中的拉片证据',
    recipe: 'shot-breakdown',
    assetIds: [asset.id],
  }, scope);

  const breakdown = plan.productionDocuments.find((item) => item.kind === 'reference-breakdown');
  assert.equal(breakdown.content.resultEvidence.runBindingStatus, 'pending');
  assert.match(breakdown.content.resultEvidence.runEvidenceReason, /仍在进行|尚未写齐/);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('reference video breakdown rejects a ledger attempt whose requestId belongs to another execution', () => {
  const { asset, state } = referenceRunEvidenceFixture('request-mismatch', {
    attemptRequestId: 'request-from-another-execution',
  });
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '拒绝串用其他执行证据',
    recipe: 'shot-breakdown',
    assetIds: [asset.id],
  }, scope);

  const breakdown = plan.productionDocuments.find((item) => item.kind === 'reference-breakdown');
  assert.equal(breakdown.content.status, 'analysis-result-ready');
  assert.equal(breakdown.content.resultEvidence.runBindingStatus, 'invalid-run-evidence');
  assert.equal(breakdown.content.resultEvidence.runId, '');
  assert.match(breakdown.content.resultEvidence.runEvidenceReason, /requestId.*不一致/);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('reference video breakdown rejects a result whose declared source version does not match the bound video', () => {
  const videoAsset = {
    id: 'asset-reference-video-invalid-result',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 4,
    contentHash: 'e'.repeat(64),
    filename: 'invalid-result-reference.mp4',
    mimeType: 'video/mp4',
    byteSize: 6_543_210,
  };
  const initialNodes = [{
    id: 'llm-breakdown-invalid-result',
    type: 'llm',
    data: {
      analysisMode: 'reference-video-shot-breakdown',
      outputSchema: 't8-reference-video-breakdown-v2',
      status: 'success',
      referenceBindings: [{
        assetId: videoAsset.id,
        kind: 'video',
        contentRevision: videoAsset.contentRevision,
        contentHash: videoAsset.contentHash,
      }],
      reply: JSON.stringify({
        sourceAsset: {
          assetId: videoAsset.id,
          contentRevision: videoAsset.contentRevision + 1,
          contentHash: videoAsset.contentHash,
        },
        summary: { shotCount: 1 },
        shots: [{
          ordinal: 1,
          startTimecode: '00:00:00.000',
          endTimecode: '00:00:02.000',
          action: '不应进入文档',
        }],
        limitations: [],
      }),
    },
  }];
  const state = fixture(initialNodes, [videoAsset]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '继续检查拉片结果',
    recipe: 'shot-breakdown',
    assetIds: [videoAsset.id],
  }, scope);

  assert.equal(plan.action, 'recover.reference-breakdown');
  assert.equal(plan.patchId, null);
  assert.equal(plan.analysis.status, 'analysis-output-invalid');
  assert.equal(plan.analysis.shotCount, 0);
  assert.match(plan.analysis.error, /素材版本或 SHA-256.*不一致/);
  const breakdown = plan.productionDocuments.find((item) => item.kind === 'reference-breakdown');
  assert.deepEqual(breakdown.content.shots, []);
  assert.equal(breakdown.content.resultEvidence.sourceNodeId, 'llm-breakdown-invalid-result');
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('reference video breakdown ignores an unrelated result and still creates the first source-bound workflow', () => {
  const videoAsset = {
    id: 'asset-reference-video-current',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 2,
    contentHash: 'f'.repeat(64),
    filename: 'current-reference.mp4',
    mimeType: 'video/mp4',
    byteSize: 5_432_100,
  };
  const state = fixture([{
    id: 'llm-breakdown-for-another-video',
    type: 'llm',
    data: {
      analysisMode: 'reference-video-shot-breakdown',
      outputSchema: 't8-reference-video-breakdown-v2',
      status: 'success',
      referenceBindings: [{
        assetId: 'asset-other-video',
        kind: 'video',
        contentRevision: 1,
        contentHash: '1'.repeat(64),
      }],
      reply: '{}',
    },
  }], [videoAsset]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '为当前素材创建拉片工作流',
    recipe: 'shot-breakdown',
    assetIds: [videoAsset.id],
  }, scope);

  assert.equal(plan.action, 'create.story');
  assert.match(plan.patchId, /^creative-patch-/);
  assert.ok(service.requirePlan(plan.planId, scope).patch);
  assert.equal(plan.analysis.status, 'awaiting-analysis-run');
  assert.equal(plan.analysis.analysisRunStarted, false);
  assert.notEqual(plan.targets.primaryNodeId, 'llm-breakdown-for-another-video');
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('reference video breakdown requests Whisper segments and preserves an untimed fallback', () => {
  const videoAsset = {
    id: 'asset-reference-video-with-speech',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 3,
    contentHash: 'c'.repeat(64),
    filename: 'reference-dialogue.mp4',
    mimeType: 'video/mp4',
    byteSize: 9_876_543,
  };
  const state = fixture([], [videoAsset]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '拉片并保留可以证明的语音转写',
    recipe: 'shot-breakdown',
    assetIds: [videoAsset.id],
    llmProvider: 'zhenzhen',
    llmModel: 'gemini-3.5-flash',
    audioProvider: 'seedance-nz',
    audioModel: 'whisper-1',
  }, scope);

  assert.equal(plan.ready, true);
  const patch = service.requirePlan(plan.planId, scope).patch;
  const nodes = patch.operations
    .filter((operation) => operation.type === 'node.add')
    .map((operation) => operation.payload.node);
  assert.deepEqual(nodes.map((node) => node.type), ['upload', 'text', 'audio', 'llm', 'output']);
  const upload = nodes.find((node) => node.type === 'upload');
  const instruction = nodes.find((node) => node.type === 'text');
  const audio = nodes.find((node) => node.type === 'audio');
  const llm = nodes.find((node) => node.type === 'llm');
  assert.equal(audio.data.audioProviderMode, 'whisper');
  assert.equal(audio.data.providerSource, 'seedance-nz');
  assert.equal(audio.data.providerModel, 'whisper-1');
  assert.equal(audio.data.whisperResponseFormat, 'verbose_json');
  assert.equal(audio.data.analysisMode, 'reference-video-segment-transcript');
  assert.equal(audio.data.outputSchema, 't8-reference-video-transcript-v2');
  assert.equal(llm.data.audioEvidenceMode, 'whisper-segments-or-untimed');
  assert.equal(llm.data.outputSchema, 't8-reference-video-breakdown-v2');
  assert.match(instruction.data.text, /summary\.transcriptEvidence/);
  assert.match(instruction.data.text, /provider-segments/);
  assert.match(instruction.data.text, /若没有有效时间窗则写为“untimed”/);
  assert.match(instruction.data.text, /不得把分段当逐词时间戳/);
  assert.match(instruction.data.text, /music、ambience、sfx 必须写“未知\/无法确认/);
  const edges = patch.operations
    .filter((operation) => operation.type === 'edge.add')
    .map((operation) => operation.payload.edge);
  assert.equal(edges.length, 5);
  assert.ok(edges.some((edge) => edge.source === upload.id && edge.target === audio.id));
  assert.ok(edges.some((edge) => edge.source === audio.id
    && edge.target === llm.id
    && edge.sourceHandle === 'text'));
  assert.equal(plan.impact.providerCallsNow, 0);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('creator LLM patches map the budget platform to the exact LLM node runtime fields', () => {
  const videoAsset = {
    id: 'asset-reference-video-budget',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 2,
    contentHash: 'b'.repeat(64),
    filename: 'budget-reference.mp4',
    mimeType: 'video/mp4',
    byteSize: 8_000_000,
  };
  const state = fixture([], [videoAsset]);
  const service = createAgentControlCreativeService({ database: state.database });
  const scriptPlan = service.createPlan({
    kind: 'script',
    prompt: '把这个故事整理成三幕剧本',
    llmProvider: 'seedance-nz',
    llmModel: 'glm-5v-turbo',
  }, scope);
  const scriptLlm = service.requirePlan(scriptPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'llm')
    .payload.node;
  assert.equal(scriptLlm.data.model, 'glm-5v-turbo');
  assert.equal(scriptLlm.data.llmApiSource, 'seedance-nz');
  assert.equal(scriptLlm.data.providerSource, 'zhenzhen');
  assert.equal(scriptLlm.data.providerId, '');
  assert.equal(scriptLlm.data.providerModel, 'glm-5v-turbo');

  const breakdownPlan = service.createPlan({
    kind: 'story',
    prompt: '帮我拉片并形成可编辑镜头表',
    recipe: 'shot-breakdown',
    assetIds: [videoAsset.id],
    llmProvider: 'seedance-nz',
    llmModel: 'glm-5v-turbo',
  }, scope);
  const breakdownLlm = service.requirePlan(breakdownPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'llm')
    .payload.node;
  assert.equal(breakdownLlm.data.llmApiSource, 'seedance-nz');
  assert.equal(breakdownLlm.data.providerSource, 'zhenzhen');
  assert.equal(breakdownLlm.data.providerId, '');
  assert.equal(breakdownLlm.data.providerModel, 'glm-5v-turbo');
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('a verified project recipe drives one-sentence planning and unknown recipes fail closed', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const definition = {
    schema: 't8-creator-recipe-v1',
    id: 'rain-director',
    label: '雨夜导演配方',
    kind: 'story',
    defaults: {
      duration: 30,
      ratio: '9:16',
      profile: 'quality',
      template: 'storyboard',
      locks: ['identity', 'wardrobe', 'scene'],
      llmModel: 'gemini-3.5-flash',
      imageModel: 'zhenzhen-image-g2-t2i',
      videoModel: 'doubao-seedance-2-0-fast-260128',
    },
    guidance: {
      directorStyle: '冷峻雨夜，高反差霓虹，动作连续',
      characterBible: '女主身份、发型与服装始终一致',
      productBible: '',
      shotGrammar: '先建立环境，再推进人物动作',
      negativeRules: '禁止无关人物和跳轴',
    },
    stages: ['剧本分析', '确认镜头', '准备资产', '生成视频', '成片导出'],
    reviewDimensions: ['人物一致性', '动作连续性'],
    compatibility: {
      minimumDesktopVersion: '2.6.4',
      maximumDesktopVersion: '',
    },
  };
  const plan = service.createPlan({
    kind: 'story',
    prompt: '把这段巷战剧本直接做成可编辑短片',
    recipe: 'rain-director',
    recipeDefinition: {
      schema: 't8-project-recipe-binding-v1',
      name: 'rain-director',
      version: 2,
      contentDigest: recipeDigest(definition),
      definition,
    },
  }, scope);
  assert.equal(plan.ready, true);
  assert.equal(plan.profile, 'quality');
  assert.equal(plan.brief.durationSec, 30);
  assert.equal(plan.brief.ratio, '9:16');
  assert.equal(plan.brief.recipeReference.version, 2);
  assert.deepEqual(plan.brief.recipeReference.reviewDimensions, ['人物一致性', '动作连续性']);
  assert.match(plan.brief.style, /冷峻雨夜/);
  assert.match(plan.brief.style, /女主身份/);
  assert.throws(
    () => service.createPlan({
      kind: 'story',
      prompt: '做成短片',
      recipe: 'missing-project-recipe',
    }, scope),
    (error) => error instanceof AgentControlCreativeError && error.code === 'CREATOR_RECIPE_NOT_FOUND',
  );
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('one-sentence MV planning requires and consumes the selected project audio in Story analysis', () => {
  const state = fixture([], [{
    id: 'song-a',
    projectId: 'project-local',
    kind: 'audio',
    availability: 'available',
    contentRevision: 7,
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const missing = service.createPlan({
    kind: 'story',
    recipe: 'mv',
    prompt: '用这首歌做 30 秒竖屏 MV，先给节奏、镜头和素材计划。',
  }, scope);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.questions.map((item) => item.id), ['mv-audio-source']);

  const plan = service.createPlan({
    kind: 'story',
    recipe: 'mv',
    prompt: '用这首歌做 30 秒竖屏 MV，先给节奏、镜头和素材计划。',
    assetIds: ['song-a'],
  }, scope);
  assert.equal(plan.ready, true);
  const storyNode = service.requirePlan(plan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'story')
    .payload.node;
  const project = storyNode.data.storyProject;
  const musicAsset = project.assets.find((asset) => asset.kind === 'audio');
  assert.equal(musicAsset.sourceAssetId, 'song-a');
  assert.equal(musicAsset.locked, true);
  assert.equal(project.shots.every((shot) => shot.assetIds.includes(musicAsset.id)), true);
  assert.equal(project.audioPlan.items[0].role, 'music');
  assert.equal(project.audioPlan.items[0].sourceAssetId, 'song-a');
  assert.equal(project.productionRevision, 0);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('natural-language editing asks only for the missing source asset', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'edit-image',
    prompt: '把纸船换成白色爱心，人物和构图保持不变。',
  }, scope);
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.questions.map((item) => item.id), ['reference-asset']);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('image planning creates comparable candidates and professional character/costume prompts without running them', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const character = service.createPlan({
    kind: 'image',
    prompt: '都市女侦探萌萌',
    ratio: '16:9',
    profile: 'balanced',
    candidates: 3,
    template: 'character-sheet',
  }, scope);
  assert.equal(character.ready, true);
  assert.equal(character.candidateCount, 3);
  const internal = service.requirePlan(character.planId, scope);
  const imageNodes = internal.patch.operations
    .filter((operation) => operation.type === 'node.add' && operation.payload.node.type === 'image')
    .map((operation) => operation.payload.node);
  assert.equal(imageNodes.length, 3);
  assert.equal(character.targets.primaryNodeId, imageNodes[0].id);
  assert.match(imageNodes[0].data.prompt, /左侧.*脸部特写/);
  assert.match(imageNodes[0].data.prompt, /右侧.*正面、侧面、背面三视图/);
  assert.match(imageNodes[0].data.prompt, /纯白/);
  assert.equal(new Set(imageNodes.map((node) => node.data.creativeState.groupId)).size, 1);
  assert.deepEqual(imageNodes.map((node) => node.data.creativeState.candidateIndex), [1, 2, 3]);
  assert.equal(new Set(imageNodes.map((node) => node.data.prompt)).size, 3);
  assert.deepEqual(imageNodes.map((node) => node.data.sizeLevel), ['1K', '1K', '1K']);
  assert.deepEqual(
    imageNodes.map((node) => node.data.candidateLabel),
    ['候选 1 · 身份一致性优先', '候选 2 · 设定细节优先', '候选 3 · 成片质感优先'],
  );
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);

  const costume = service.createPlan({
    kind: 'image',
    prompt: '黑色西装外套与内搭',
    ratio: '1:1',
    profile: 'economy',
    template: 'costume-only',
  }, scope);
  const costumeNode = service.requirePlan(costume.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'image')
    .payload.node;
  assert.match(costumeNode.data.prompt, /只展示服装本体/);
  assert.match(costumeNode.data.prompt, /不要人物、脸、手/);
});

test('Story plan never auto-generates assets and preserves creator uploads by policy', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '雨夜唐人街，萌萌与罂瑶在巷道对峙。',
    title: 'The Alley',
    duration: 45,
    ratio: '16:9',
    audience: '悬疑动作短片观众',
    profile: 'balanced',
  }, scope);
  const patch = service.requirePlan(plan.planId, scope).patch;
  const story = patch.operations.find((operation) => operation.type === 'node.add').payload.node;
  assert.equal(story.type, 'story');
  assert.equal(story.data.storyRunRequestId, '');
  assert.equal(story.data.storyProject.stage, 'shots');
  assert.equal(story.data.storyProject.analysisSource, 'local-fallback');
  assert.ok(story.data.storyProject.shots.length >= 1);
  assert.ok(story.data.storyProject.assets.length >= 1);
  assert.equal(story.data.storyProject.audioPlan.schema, 't8-story-audio-plan-v1');
  assert.equal(story.data.storyProject.productionRevision, 0);
  assert.equal(story.data.creativePolicy.autoGenerateOnStageEnter, false);
  assert.equal(story.data.creativePolicy.generateScope, 'missing-failed-unlocked');
  assert.equal(story.data.creativePolicy.preserveUploads, true);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('balanced image/video/Story plans use preview specs until quality is explicitly selected', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const videoPlan = service.createPlan({
    kind: 'video',
    prompt: '雨夜巷道里两名角色缓慢接近',
    duration: 8,
    ratio: '16:9',
    profile: 'balanced',
    candidates: 3,
  }, scope);
  const videoNodes = service.requirePlan(videoPlan.planId, scope).patch.operations
    .filter((operation) => operation.type === 'node.add' && operation.payload.node.type === 'seedance')
    .map((operation) => operation.payload.node);
  assert.equal(videoNodes.length, 3);
  assert.equal(new Set(videoNodes.map((node) => node.data.prompt)).size, 3);
  assert.deepEqual(videoNodes.map((node) => node.data.resolution), ['480p', '480p', '480p']);

  const qualityImagePlan = service.createPlan({
    kind: 'image',
    prompt: '电影感角色海报',
    ratio: '2:3',
    profile: 'quality',
    candidates: 1,
  }, scope);
  const qualityImage = service.requirePlan(qualityImagePlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'image')
    .payload.node;
  assert.equal(qualityImage.data.sizeLevel, '2K');

  const storyPlan = service.createPlan({
    kind: 'story',
    prompt: '两位女主角在雨夜唐人街对峙。',
    title: '雨夜对峙',
    duration: 30,
    ratio: '16:9',
    audience: '悬疑动作短片观众',
    profile: 'balanced',
  }, scope);
  const story = service.requirePlan(storyPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'story')
    .payload.node;
  assert.equal(story.data.storyProject.settings.resolution, '480p');
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('Story keeps separate evidence-backed language, image and video provider/model selections', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({
    database: state.database,
    settingsProvider: () => [{
      id: 'studio-provider',
      label: 'Studio Provider',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey: 'must-not-leak',
      chatModels: ['studio-llm'],
      imageModels: ['studio-image'],
      videoModels: ['studio-video'],
      defaults: {},
    }],
  });
  const plan = service.createPlan({
    kind: 'story',
    prompt: '同一角色从室内追到雨夜街道。',
    title: 'Continuity',
    duration: 30,
    ratio: '9:16',
    audience: '短视频观众',
    llmProvider: 'studio-provider',
    llmModel: 'studio-llm',
    imageProvider: 'zhenzhen',
    imageModel: 'zhenzhen-image-g2-t2i',
    videoProvider: 'studio-provider',
    videoModel: 'studio-video',
  }, scope);
  const story = service.requirePlan(plan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add').payload.node;
  assert.deepEqual({
    llmProviderSource: story.data.storyProject.settings.llmProviderSource,
    llmProviderId: story.data.storyProject.settings.llmProviderId,
    llmProviderModel: story.data.storyProject.settings.llmProviderModel,
    imageProviderSource: story.data.storyProject.settings.imageProviderSource,
    imageProviderId: story.data.storyProject.settings.imageProviderId,
    imageProviderModel: story.data.storyProject.settings.imageProviderModel,
    videoProviderSource: story.data.storyProject.settings.videoProviderSource,
    videoProviderId: story.data.storyProject.settings.videoProviderId,
    videoProviderModel: story.data.storyProject.settings.videoProviderModel,
  }, {
    llmProviderSource: 'openai-compatible',
    llmProviderId: 'studio-provider',
    llmProviderModel: 'studio-llm',
    imageProviderSource: 'zhenzhen',
    imageProviderId: '',
    imageProviderModel: 'zhenzhen-image-g2-t2i',
    videoProviderSource: 'openai-compatible',
    videoProviderId: 'studio-provider',
    videoProviderModel: 'studio-video',
  });
  assert.equal(JSON.stringify(plan).includes('must-not-leak'), false);
  assert.equal(state.providerPosts, 0);
});

test('creative planning rejects an unconfigured provider instead of guessing a route', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({
    database: state.database,
    settingsProvider: () => [],
  });
  assert.throws(
    () => service.createPlan({
      kind: 'image',
      prompt: '产品图',
      ratio: '1:1',
      imageProvider: 'missing-provider',
      imageModel: 'unknown-image',
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_PROVIDER_NOT_CONFIGURED',
  );
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('creator recipes, audio workflows and media edits stay editable and never auto-run', () => {
  const state = fixture([], [{
    id: 'asset-video-a',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 2,
  }, {
    id: 'asset-audio-a',
    projectId: 'project-local',
    kind: 'audio',
    availability: 'available',
    contentRevision: 1,
  }]);
  const service = createAgentControlCreativeService({ database: state.database });

  const recipePlan = service.createPlan({
    kind: 'story',
    prompt: '一名女孩在雨中找回丢失的伞',
    audience: '短视频观众',
    recipe: 'short-drama',
  }, scope);
  assert.equal(recipePlan.brief.ratio, '9:16');
  assert.equal(recipePlan.brief.durationSec, 60);
  assert.equal(recipePlan.brief.recipe, 'short-drama');

  const audioPlan = service.createPlan({
    kind: 'audio',
    prompt: '雨夜悬疑氛围配乐',
    audioModel: 'suno-v5.5-cover',
    assetIds: ['asset-audio-a'],
  }, scope);
  const audioNode = service.requirePlan(audioPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'audio')
    .payload.node;
  assert.equal(audioNode.data.mode, 'cover');
  assert.equal(audioNode.data.localRefAudio, '/api/project-assets/asset-audio-a/media');
  assert.equal(audioNode.data.status, 'idle');
  assert.equal(audioNode.data.audioRole, 'music');
  assert.equal(audioNode.data.audioMetadata.licenseStatus, 'unknown');

  const ttsPlan = service.createPlan({
    kind: 'audio',
    prompt: '用温和女声朗读产品旁白',
    voiceId: 'eve',
    outputFormat: 'opus',
  }, scope);
  const ttsNode = service.requirePlan(ttsPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'grok-oauth-agent')
    .payload.node;
  assert.equal(ttsNode.data.mode, 'tts');
  assert.equal(ttsNode.data.ttsModel, 'xai-tts');
  assert.equal(ttsNode.data.voiceId, 'eve');
  assert.equal(ttsNode.data.outputFormat, 'opus');
  assert.equal(ttsNode.data.audioRole, 'voiceover');

  const sttPlan = service.createPlan({
    kind: 'audio',
    prompt: '把采访音频转写成中文文字',
    audioModel: 'xai-stt',
    assetIds: ['asset-audio-a'],
  }, scope);
  const sttNode = service.requirePlan(sttPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'grok-oauth-agent')
    .payload.node;
  assert.equal(sttNode.data.mode, 'stt');
  assert.equal(sttNode.data.sttModel, 'xai-stt');
  assert.equal(sttNode.data.audioUrl, '/api/project-assets/asset-audio-a/media');
  assert.equal(sttNode.data.audioRole, 'transcription');

  const missingSttSource = service.createPlan({
    kind: 'audio',
    prompt: '把这段录音转写为字幕',
    audioModel: 'xai-stt',
  }, scope);
  assert.equal(missingSttSource.ready, false);
  assert.deepEqual(missingSttSource.questions.map((item) => item.id), ['audio-source']);

  const editPlan = service.createPlan({
    kind: 'edit-video',
    prompt: '只把环境调整成雨夜，人物动作不变',
    ratio: '16:9',
    duration: 8,
    assetIds: ['asset-video-a'],
  }, scope);
  const editNode = service.requirePlan(editPlan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'seedance')
    .payload.node;
  assert.deepEqual(editNode.data.referenceAssetIds, ['asset-video-a']);
  assert.deepEqual(editNode.data.localRefVideos, ['/api/project-assets/asset-video-a/media']);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('one-sentence lip-sync planning binds one image and one audio to the proven Creatify Aurora workflow', () => {
  const state = fixture([], [{
    id: 'asset-character-image',
    projectId: 'project-local',
    kind: 'image',
    availability: 'available',
    contentRevision: 3,
  }, {
    id: 'asset-dialogue-audio',
    projectId: 'project-local',
    kind: 'audio',
    availability: 'available',
    contentRevision: 2,
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'video',
    prompt: '让这张人物照片跟着旁白音频自然对口型',
    assetIds: ['asset-character-image', 'asset-dialogue-audio'],
    candidates: 2,
  }, scope);
  assert.equal(plan.ready, true);
  assert.equal(plan.brief.videoTask, 'lip-sync');
  assert.equal(plan.brief.videoProvider, 'fal');
  assert.equal(plan.brief.videoModel, 'creatify-aurora-fal');
  const patch = service.requirePlan(plan.planId, scope).patch;
  const uploads = patch.operations
    .filter((operation) => operation.type === 'node.add' && operation.payload.node.type === 'upload')
    .map((operation) => operation.payload.node);
  const lipSyncNodes = patch.operations
    .filter((operation) => operation.type === 'node.add' && operation.payload.node.type === 'fal-toolbox')
    .map((operation) => operation.payload.node);
  assert.deepEqual(uploads.map((node) => node.data.uploadType), ['image', 'audio']);
  assert.equal(lipSyncNodes.length, 2);
  assert.equal(lipSyncNodes.every((node) =>
    node.data.falToolboxActiveToolId === 'creatify-aurora-fal'
      && node.data.providerSource === 'fal'
      && node.data.status === 'idle'), true);
  assert.deepEqual(lipSyncNodes[0].data.referenceAssetIds, [
    'asset-character-image',
    'asset-dialogue-audio',
  ]);
  assert.equal(patch.operations.filter((operation) => operation.type === 'edge.add').length, 6);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('one-sentence lip-sync planning asks for sources and rejects wrong media kinds', () => {
  const state = fixture([], [{
    id: 'asset-video-only',
    projectId: 'project-local',
    kind: 'video',
    availability: 'available',
    contentRevision: 1,
  }, {
    id: 'asset-audio-only',
    projectId: 'project-local',
    kind: 'audio',
    availability: 'available',
    contentRevision: 1,
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const missing = service.createPlan({
    kind: 'video',
    prompt: '让人物图片跟着音频说话',
  }, scope);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.questions.map((item) => item.id), ['lip-sync-sources']);
  assert.throws(
    () => service.createPlan({
      kind: 'video',
      prompt: '让人物图片跟着音频说话',
      assetIds: ['asset-video-only', 'asset-audio-only'],
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_LIP_SYNC_REFERENCES_REQUIRED'
      && error.details.requiredKinds.join(',') === 'image,audio',
  );
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('audio catalog is anchored to actual Audio and Grok OAuth runtime contracts', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(
    process.cwd(),
    'backend/src/shared/creativeModelCatalog.json',
  ), 'utf8'));
  const audioNode = fs.readFileSync(path.join(process.cwd(), 'src/components/nodes/AudioNode.tsx'), 'utf8');
  const grokNode = fs.readFileSync(path.join(process.cwd(), 'src/components/nodes/GrokOAuthAgentNode.tsx'), 'utf8');
  const grokService = fs.readFileSync(path.join(process.cwd(), 'src/services/grokOAuth.ts'), 'utf8');
  const models = new Set(catalog.audio.map((item) => item.model));
  for (const model of ['suno-v5.5-generate', 'suno-v5.5-cover', 'suno-v5.5-extend', 'doubao-seed-audio-1.0']) {
    assert.equal(models.has(model), true);
  }
  assert.match(audioNode, /doubao-seed-audio-1\.0/);
  assert.match(audioNode, /seedAudioSampleRate/);
  assert.equal(models.has('xai-tts'), true);
  assert.equal(models.has('xai-stt'), true);
  assert.match(grokNode, /d\.ttsModel \|\| 'xai-tts'/);
  assert.match(grokNode, /d\.sttModel \|\| 'xai-stt'/);
  assert.match(grokService, /generateGrokOAuthTts/);
  assert.match(grokService, /transcribeGrokOAuthAudio/);
});

test('candidate comparison returns a visual contact sheet with safe media and QA evidence', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'image',
    prompt: '雨夜唐人街侦探',
    ratio: '16:9',
    candidates: 2,
  }, scope);
  state.applyPatch(service.requirePlan(plan.planId, scope).patch);
  const images = state.document.nodes.filter((node) => node.type === 'image');
  images[0].data.imageUrl = '/outputs/candidate-a.png';
  images[0].data.status = 'succeeded';
  images[0].data.width = 1024;
  images[0].data.height = 576;
  images[0].data.contentHash = 'sha256:candidate-a';
  images[1].data.imageUrl = 'file:///private/unsafe.png';
  images[1].data.status = 'succeeded';

  const comparison = service.readAction('compare', { nodeId: images[0].id }, scope);
  assert.equal(comparison.schema, 't8-creative-comparison-v2');
  assert.equal(comparison.contactSheet.items.length, 2);
  assert.deepEqual(comparison.candidates[0].resultUrls, ['/outputs/candidate-a.png']);
  assert.equal(comparison.candidates[0].qa.ready, true);
  assert.equal(comparison.candidates[0].qa.creativeReady, false);
  assert.equal(comparison.candidates[0].review.status, 'pending');
  assert.equal(comparison.requiresVisualReview, true);
  assert.deepEqual(comparison.candidates[1].resultUrls, []);
  assert.equal(comparison.candidates[1].qa.ready, false);
  assert.match(comparison.candidates[1].qa.warnings.join(' '), /安全引用/);
  assert.throws(
    () => service.actionPlan('accept', { nodeId: images[0].id }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_CANDIDATE_REVIEW_REQUIRED'
      && /真实作品/.test(error.message),
  );

  const reviewPlan = service.actionPlan('review', {
    nodeId: images[0].id,
    review: {
      schema: 't8-creative-review-v1',
      source: 'visual-inspection',
      reviewer: 'codex-vision',
      evidence: { contentHash: 'sha256:candidate-a' },
      dimensions: {
        composition: { status: 'pass', summary: '主体清楚，层次完整', evidence: '人物位于视觉中心' },
        identity: { status: 'pass', summary: '角色面部和发型一致' },
        productShape: { status: 'unknown', summary: '本候选没有产品主体' },
        textAccuracy: { status: 'pass', summary: '画面无错误文字' },
      },
    },
  }, scope);
  state.applyPatch(service.requirePlan(reviewPlan.planId, scope).patch);
  const reviewed = service.readAction('compare', { nodeId: images[0].id }, scope);
  assert.equal(reviewed.candidates[0].review.status, 'verified');
  assert.equal(reviewed.candidates[0].review.dimensions.composition.status, 'pass');
  assert.equal(reviewed.candidates[0].review.hardGatesPassed, true);
  assert.equal(reviewed.candidates[0].qa.creativeReady, true);
  assert.equal(reviewed.reviewCoverage.verified, 1);
  assert.equal(state.providerPosts, 0);
  assert.throws(
    () => service.actionPlan('review', {
      nodeId: images[1].id,
      review: {
        schema: 't8-creative-review-v1',
        source: 'prompt-summary',
        evidence: { url: '/outputs/candidate-b.png' },
        dimensions: { composition: { status: 'pass', summary: '根据 Prompt 猜测' } },
      },
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_REVIEW_VISUAL_EVIDENCE_REQUIRED',
  );
});

test('text candidates expose the actual result and a stable review hash before acceptance', () => {
  const state = fixture([{
    id: 'text-candidate-a',
    type: 'text',
    position: { x: 0, y: 0 },
    data: {
      outputText: '镜头一：雨夜后巷。萌萌走出电梯，镜头稳定跟随。',
      status: 'succeeded',
      creativeState: {
        schema: 't8-creative-state-v1',
        groupId: 'text-candidate-group',
        candidateId: 'text-candidate-a',
        candidateIndex: 1,
        candidateCount: 1,
        profile: 'balanced',
        template: 'storyboard',
        accepted: false,
        activeBranchId: 'main',
        locks: {
          identity: false,
          wardrobe: false,
          productShape: false,
          logo: false,
          composition: false,
          background: false,
          scene: false,
          prompt: false,
          parameters: false,
        },
        versions: [],
        branches: [{
          id: 'main',
          label: '主版本',
          parentId: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
        brief: { goal: '雨夜短剧分镜' },
      },
    },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const comparison = service.readAction('compare', { nodeId: 'text-candidate-a' }, scope);
  const candidate = comparison.candidates[0];
  assert.equal(candidate.resultKind, 'text');
  assert.match(candidate.resultText, /萌萌走出电梯/);
  assert.match(candidate.reviewEvidence.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(candidate.qa.ready, true);
  assert.equal(candidate.qa.creativeReady, false);

  const reviewPlan = service.actionPlan('review', {
    nodeId: 'text-candidate-a',
    review: {
      schema: 't8-creative-review-v1',
      source: 'visual-inspection',
      reviewer: 'creator',
      evidence: { contentHash: candidate.reviewEvidence.contentHash },
      dimensions: {
        structure: { status: 'pass', summary: '镜头结构清楚' },
        continuity: { status: 'pass', summary: '动作连续' },
        textAccuracy: { status: 'pass', summary: '人物和场景描述正确' },
      },
    },
  }, scope);
  state.applyPatch(service.requirePlan(reviewPlan.planId, scope).patch);
  const reviewed = service.readAction('compare', { nodeId: 'text-candidate-a' }, scope);
  assert.equal(reviewed.candidates[0].qa.creativeReady, true);
  const acceptPlan = service.actionPlan('accept', { nodeId: 'text-candidate-a' }, scope);
  state.applyPatch(service.requirePlan(acceptPlan.planId, scope).patch);
  assert.equal(state.document.nodes[0].data.creativeState.accepted, true);
  assert.equal(state.providerPosts, 0);
});

test('accepted character or project assets become real reference images and carry continuity locks', () => {
  const acceptedState = {
    schema: 't8-creative-state-v1',
    groupId: 'character-group',
    candidateId: 'character-candidate',
    candidateIndex: 1,
    candidateCount: 1,
    profile: 'economy',
    template: 'character-sheet',
    accepted: true,
    activeBranchId: 'main',
    locks: { identity: true, wardrobe: true, background: false, prompt: false },
    versions: [],
    branches: [{ id: 'main', label: '主版本', parentId: '', createdAt: '2026-01-01T00:00:00.000Z' }],
    brief: { goal: '女主角角色设定' },
  };
  const state = fixture([{
    id: 'accepted-character',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      imageUrl: '/files/output/accepted-character.png',
      creativeState: acceptedState,
    },
  }], [{
    id: 'asset-rainy-alley',
    projectId: 'project-local',
    kind: 'image',
    availability: 'available',
    contentRevision: 4,
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'image',
    prompt: '女主角在雨夜唐人街回头看向镜头',
    ratio: '16:9',
    profile: 'balanced',
    candidates: 1,
    template: 'keyframe',
    assetIds: ['accepted-character', 'asset-rainy-alley'],
  }, scope);
  const image = service.requirePlan(plan.planId, scope).patch.operations
    .find((operation) => operation.type === 'node.add' && operation.payload.node.type === 'image')
    .payload.node;
  assert.deepEqual(image.data.referenceImages, [
    '/files/output/accepted-character.png',
    '/api/project-assets/asset-rainy-alley/media',
  ]);
  assert.deepEqual(image.data.referenceBindings.map((item) => item.sourceType), ['accepted-node', 'asset']);
  assert.equal(image.data.creativeState.locks.identity, true);
  assert.equal(image.data.creativeState.locks.wardrobe, true);
  assert.match(image.data.prompt, /继承连续性锁：identity、wardrobe/);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('an unaccepted candidate cannot silently become a character reference', () => {
  const state = fixture([{
    id: 'draft-character',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      imageUrl: '/files/output/draft.png',
      creativeState: {
        accepted: false,
        locks: { identity: true },
      },
    },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  assert.throws(
    () => service.createPlan({
      kind: 'image',
      prompt: '后续镜头',
      ratio: '16:9',
      assetIds: ['draft-character'],
    }, scope),
    (error) => error instanceof AgentControlCreativeError
      && error.code === 'CREATIVE_REFERENCE_NOT_ACCEPTED',
  );
});

test('candidate accept, locks, branch and rollback preserve versions and do not replace unrelated node data', () => {
  const baseState = {
    schema: 't8-creative-state-v1',
    groupId: 'creative-group-a',
    candidateId: 'candidate-a',
    candidateIndex: 1,
    candidateCount: 2,
    profile: 'balanced',
    template: 'general',
    accepted: false,
    activeBranchId: 'main',
    locks: { identity: false, wardrobe: false, background: false, prompt: false },
    versions: [],
    branches: [{ id: 'main', label: '主版本', parentId: '', createdAt: '2026-01-01T00:00:00.000Z' }],
    brief: { goal: '雨夜角色' },
  };
  const state = fixture([
    {
      id: 'image-a',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { prompt: '版本 A', imageUrl: '/a.png', unrelated: 'keep-me', creativeState: baseState },
    },
    {
      id: 'image-b',
      type: 'image',
      position: { x: 400, y: 0 },
      data: {
        prompt: '版本 B',
        imageUrl: '/outputs/b.png',
        status: 'succeeded',
        unrelated: 'keep-too',
        creativeReview: {
          schema: 't8-creative-review-v1',
          source: 'visual-inspection',
          reviewer: 'creator',
          evidence: { url: '/outputs/b.png' },
          dimensions: {
            composition: { status: 'pass', summary: '构图完整' },
            identity: { status: 'pass', summary: '角色一致' },
            productShape: { status: 'pass', summary: '无产品变形' },
            textAccuracy: { status: 'pass', summary: '文字正确' },
          },
        },
        creativeState: { ...baseState, candidateId: 'candidate-b', candidateIndex: 2 },
      },
    },
  ]);
  const service = createAgentControlCreativeService({ database: state.database });

  const acceptPlan = service.actionPlan('accept', { nodeId: 'image-b', lock: 'identity' }, scope);
  state.applyPatch(service.requirePlan(acceptPlan.planId, scope).patch);
  assert.equal(state.document.nodes[0].data.creativeState.accepted, false);
  assert.equal(state.document.nodes[1].data.creativeState.accepted, true);
  assert.equal(state.document.nodes[1].data.creativeState.locks.identity, true);
  assert.equal(state.document.nodes[1].data.creativeState.locks.prompt, true);
  assert.equal(
    state.document.nodes[1].data.creativeState.acceptance.automaticLocks.includes('prompt'),
    true,
  );
  assert.equal(state.document.nodes[1].data.unrelated, 'keep-too');

  const lockPlan = service.actionPlan('lock', { nodeId: 'image-b', lock: 'wardrobe' }, scope);
  state.applyPatch(service.requirePlan(lockPlan.planId, scope).patch);
  assert.equal(state.document.nodes[1].data.creativeState.locks.identity, true);
  assert.equal(state.document.nodes[1].data.creativeState.locks.wardrobe, true);
  assert.ok(state.document.nodes[1].data.creativeState.versions.length >= 1);

  const branchPlan = service.actionPlan('branch', { nodeId: 'image-b', label: '冷色探索' }, scope);
  const branchPatch = service.requirePlan(branchPlan.planId, scope).patch;
  const branchNode = branchPatch.operations[0].payload.node;
  assert.equal(branchNode.data.imageUrl, undefined);
  assert.equal(branchNode.data.status, 'idle');
  assert.equal(branchNode.data.creativeState.accepted, false);
  assert.equal(branchNode.data.creativeState.locks.identity, true);
  state.applyPatch(branchPatch);

  const original = state.document.nodes.find((node) => node.id === 'image-b');
  original.data.prompt = '被误改的新提示词';
  const rollbackPlan = service.actionPlan('rollback', { nodeId: 'image-b' }, scope);
  state.applyPatch(service.requirePlan(rollbackPlan.planId, scope).patch);
  assert.equal(state.document.nodes.find((node) => node.id === 'image-b').data.prompt, '版本 B');
  assert.equal(state.providerPosts, 0);
});

test('accepting a product direction applies product, logo and composition locks without pretending it is a character identity lock', () => {
  const state = fixture([{
    id: 'product-candidate',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      prompt: '透明折叠伞品牌广告主视觉，保持当前构图和 logo',
      imageUrl: '/outputs/product.png',
      status: 'succeeded',
      creativeReview: {
        schema: 't8-creative-review-v1',
        source: 'visual-inspection',
        reviewer: 'creator',
        evidence: { url: '/outputs/product.png' },
        dimensions: {
          composition: { status: 'pass', summary: '构图清楚' },
          identity: { status: 'pass', summary: '无角色身份问题' },
          productShape: { status: 'pass', summary: '伞的结构和轮廓正确' },
          textAccuracy: { status: 'pass', summary: 'logo 与文字正确' },
        },
      },
      creativeState: {
        schema: 't8-creative-state-v1',
        groupId: 'product-group',
        candidateId: 'product-a',
        candidateIndex: 1,
        candidateCount: 1,
        profile: 'balanced',
        template: 'tvc',
        accepted: false,
        activeBranchId: 'main',
        locks: {},
        versions: [],
        branches: [{ id: 'main', label: '主版本', parentId: '', createdAt: '2026-01-01T00:00:00.000Z' }],
        brief: {
          recipe: 'tvc',
          template: 'tvc',
          goal: '透明折叠伞品牌广告，产品外形、logo 和构图必须保持',
        },
      },
    },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const acceptPlan = service.actionPlan('accept', { nodeId: 'product-candidate' }, scope);
  state.applyPatch(service.requirePlan(acceptPlan.planId, scope).patch);
  const locks = state.document.nodes[0].data.creativeState.locks;
  assert.equal(locks.productShape, true);
  assert.equal(locks.logo, true);
  assert.equal(locks.composition, true);
  assert.equal(locks.identity, false);
  assert.equal(state.providerPosts, 0);
});

test('continuing an applied production creates one authoritative patch on the original node', () => {
  const state = fixture([{
    id: 'story-original',
    type: 'story',
    position: { x: 0, y: 0 },
    data: {
      creativeState: {
        schema: 't8-creative-state-v1',
        groupId: 'story-group',
        candidateId: 'story-candidate',
        candidateIndex: 1,
        candidateCount: 1,
        profile: 'balanced',
        template: 'short-drama',
        accepted: true,
        activeBranchId: 'main',
        locks: { identity: true, wardrobe: true },
        versions: [],
        branches: [{ id: 'main', label: '主版本', parentId: '', createdAt: '2026-01-01T00:00:00.000Z' }],
      },
      storyProject: {
        storyId: 'story-original',
        storyRevision: 4,
        productionRevision: 2,
        title: '雨夜追逐',
        shots: [],
        assets: [],
      },
    },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const incrementalPlan = {
    schema: 't8-creator-incremental-plan-v1',
    direction: '只把第 2 镜头背景换成清晨，人物和构图别变',
    target: { nodeId: 'story-original', storyId: 'story-original', sameProduction: true },
    operation: 'story.revise',
    scope: 'shots',
    shotIndexes: [2],
    changeDimensions: ['background'],
    preserve: ['identity', 'composition'],
    requiresPreview: true,
    requiresApproval: true,
    writesNow: 0,
    providerCallsNow: 0,
    duplicateSourceWorkflow: false,
    summary: '在原生产上只修改：background',
  };
  const plan = service.actionPlan('production.continue', {
    nodeId: 'story-original',
    incrementalPlan,
  }, scope);
  const patch = service.requirePlan(plan.planId, scope).patch;
  assert.deepEqual(patch.operations.map((operation) => operation.type), ['node.patch']);
  assert.equal(patch.operations[0].payload.nodeId, 'story-original');
  assert.equal(patch.operations[0].payload.dataPatch.storyProject.storyRevision, 5);
  assert.equal(
    patch.operations[0].payload.dataPatch.storyProject.pendingIncrementalPlan.direction,
    incrementalPlan.direction,
  );
  assert.equal(plan.impact.writesNow, 0);
  assert.equal(plan.impact.providerCallsNow, 0);
  assert.equal(state.document.nodes.length, 1);
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});

test('Story -> Director -> VideoEdit uses stable IDs and only materializes completed shots', () => {
  const storyProject = {
    schema: 't8-story-project-v1',
    storyId: 'story-the-alley',
    storyRevision: 7,
    productionRevision: 2,
    title: 'The Alley',
    settings: {
      aspectRatio: '16:9',
      resolution: '720p',
      videoApiSource: 'auto',
      videoNzModel: 'fast',
      videoModel: 'doubao-seedance-2-0-fast-260128',
      videoProviderSource: 'zhenzhen',
      videoProviderId: '',
      videoProviderModel: '',
      generateAudio: true,
    },
    linkedDirectorNodeId: '',
    linkedVideoEditNodeId: '',
    shots: [
      {
        id: 'shot-establish',
        title: '建立环境',
        durationSec: 6,
        visualDescription: '雨夜巷道，镜头缓慢推进',
        finalPrompt: '雨夜唐人街后巷，缓慢推进',
        videoUrl: '/outputs/shot-1.mp4',
        status: 'succeeded',
      },
      {
        id: 'shot-hero',
        title: '建立人物',
        durationSec: 5,
        visualDescription: '萌萌走出电梯',
        finalPrompt: '萌萌稳定向前',
        videoUrl: '/outputs/shot-2.mp4',
        status: 'succeeded',
      },
    ],
  };
  const state = fixture([{
    id: 'story-a',
    type: 'story',
    position: { x: 0, y: 0 },
    data: { storyProject },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });

  const directorPlan = service.actionPlan('director.materialize', { storyNodeId: 'story-a' }, scope);
  const directorPatch = service.requirePlan(directorPlan.planId, scope).patch;
  const directorAdd = directorPatch.operations.find((operation) =>
    operation.type === 'node.add' && operation.payload.node.type === 'director-storyboard');
  assert.ok(directorAdd);
  assert.deepEqual(directorAdd.payload.node.data.shots.map((shot) => shot.id), ['shot-establish', 'shot-hero']);
  state.applyPatch(directorPatch);
  const directorId = directorAdd.payload.node.id;

  const repeated = service.actionPlan('director.materialize', { storyNodeId: 'story-a' }, scope);
  const repeatedPatch = service.requirePlan(repeated.planId, scope).patch;
  assert.equal(repeatedPatch.operations.some((operation) =>
    operation.type === 'node.add' && operation.payload.node.type === 'director-storyboard'), false);
  assert.equal(repeatedPatch.operations.some((operation) =>
    operation.type === 'node.patch' && operation.payload.nodeId === directorId), true);

  const editPlan = service.actionPlan('video-edit.compose', { nodeId: directorId }, scope);
  const editPatch = service.requirePlan(editPlan.planId, scope).patch;
  const editAdd = editPatch.operations.find((operation) =>
    operation.type === 'node.add' && operation.payload.node.type === 'video-edit');
  assert.ok(editAdd);
  assert.deepEqual(editAdd.payload.node.data.sourceShotIds, ['shot-establish', 'shot-hero']);
  assert.equal(editAdd.payload.node.data.clips.length, 2);
  assert.equal(editAdd.payload.node.data.timelineV2.items.length, 2);
  state.applyPatch(editPatch);

  const editNode = state.document.nodes.find((node) => node.id === editAdd.payload.node.id);
  editNode.data.output = {
    videoUrl: '/outputs/the-alley-final.mp4',
    name: 'The-Alley.mp4',
    duration: 11,
    width: 1280,
    height: 720,
    assetId: 'asset-final-video',
    contentHash: 'sha256:final-video',
  };
  editNode.data.videoUrl = '/outputs/the-alley-final.mp4';
  editNode.data.job = { status: 'done', progress: 100 };
  editNode.data.playbackVerified = true;
  const delivery = service.readAction('video-edit.deliver', { nodeId: editNode.id }, scope);
  assert.equal(delivery.ready, true);
  assert.equal(delivery.output.videoUrl, '/outputs/the-alley-final.mp4');
  assert.equal(delivery.output.assetId, 'asset-final-video');
  assert.equal(delivery.verification.persisted, true);
  assert.deepEqual(delivery.missingClipIds, []);
  assert.equal(state.providerPosts, 0);
});

test('Agent can continue a Story through shots, bound assets, prompts and adopted keyframe previews without provider calls', () => {
  const script = '雨夜唐人街后巷。萌萌走出电梯。罂瑶在阴影中举起手枪。';
  const storyProject = {
    schema: 't8-story-project-v1',
    storyId: 'story-agent',
    storyRevision: 1,
    productionRevision: 0,
    title: '雨夜对峙',
    script,
    settings: {
      aspectRatio: '16:9',
      targetDurationSec: 18,
      visualStyle: '克制的雨夜霓虹电影感',
      imageModel: 'zhenzhen-image-g2-t2i',
      imageProviderSource: 'zhenzhen',
      imageProviderId: '',
      imageProviderModel: '',
      videoModel: 'doubao-seedance-2-0-fast-260128',
      videoProviderSource: 'zhenzhen',
    },
    styleBible: '克制的雨夜霓虹电影感',
    scenes: [],
    shots: [],
    assets: [],
    stage: 'script',
    stages: {},
    coverage: {},
    finalVideoUrl: '',
    composeTaskId: '',
    composeTaskStatus: 'idle',
  };
  const state = fixture([{
    id: 'story-node',
    type: 'story',
    position: { x: 0, y: 0 },
    data: { storyProject },
  }], [{
    id: 'project-hero',
    projectId: 'project-local',
    kind: 'image',
    availability: 'available',
    contentRevision: 2,
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  const blocks = [
    '雨夜唐人街后巷。',
    '萌萌走出电梯。',
    '罂瑶在阴影中举起手枪。',
  ];
  const imported = service.actionPlan('story.import', {
    storyId: 'story-node',
    payload: {
      title: '雨夜对峙',
      styleBible: '克制的雨夜霓虹电影感',
      shots: blocks.map((sourceText, index) => ({
        id: `shot-${index + 1}`,
        title: ['建立环境', '建立人物', '危险出现'][index],
        sourceText,
        visualDescription: sourceText,
        durationSec: 6,
        assetIds: index ? ['hero-mengmeng'] : [],
      })),
      assets: [{
        id: 'hero-mengmeng',
        kind: 'character',
        name: '萌萌',
        description: '黑色长发、黑色西装的年轻女主角',
        requiredByShotIds: ['shot-2'],
      }],
    },
  }, scope);
  state.applyPatch(service.requirePlan(imported.planId, scope).patch);
  let inspection = service.readAction('story.inspect', { storyId: 'story-node' }, scope);
  assert.equal(inspection.shots.length, 3);
  assert.equal(inspection.assets.length, 1);
  assert.equal(inspection.coverage.percent, 100);

  const bound = service.actionPlan('story.bind-asset', {
    storyId: 'story-node',
    assetId: 'project-hero',
    to: 'hero-mengmeng',
  }, scope);
  state.applyPatch(service.requirePlan(bound.planId, scope).patch);
  inspection = service.readAction('story.inspect', { storyId: 'story-node' }, scope);
  assert.equal(inspection.assets[0].ready, true);
  assert.equal(inspection.assets[0].locked, true);

  const compiled = service.actionPlan('story.compile', { storyId: 'story-node' }, scope);
  state.applyPatch(service.requirePlan(compiled.planId, scope).patch);
  inspection = service.readAction('story.inspect', { storyId: 'story-node' }, scope);
  assert.equal(inspection.shots.every((shot) => shot.promptReady), true);

  const previewPlan = service.actionPlan('story.plan-previews', { storyId: 'story-node' }, scope);
  const previewPatch = service.requirePlan(previewPlan.planId, scope).patch;
  const previews = previewPatch.operations
    .filter((operation) => operation.type === 'node.add' && operation.payload.node.type === 'image')
    .map((operation) => operation.payload.node);
  assert.equal(previews.length, 3);
  assert.equal(new Set(previews.map((node) => node.data.storyShotId)).size, 3);
  assert.equal(previews.every((node) => node.data.sizeLevel === '1K'), true);
  assert.deepEqual(previews[1].data.referenceImages, ['/api/project-assets/project-hero/media']);
  state.applyPatch(previewPatch);

  const acceptedPreview = state.document.nodes.find((node) => node.id === previews[1].id);
  acceptedPreview.data.imageUrl = '/files/output/shot-2-preview.png';
  acceptedPreview.data.status = 'succeeded';
  acceptedPreview.data.creativeState.accepted = true;
  assert.throws(
    () => service.actionPlan('story.adopt-preview', {
      storyId: 'story-node',
      shotId: 'shot-2',
      candidateId: acceptedPreview.id,
    }, scope),
    (error) => error.code === 'STORY_PREVIEW_ADOPTION_RECEIPT_REQUIRED',
  );
  const review = service.actionPlan('review', {
    nodeId: acceptedPreview.id,
    review: {
      schema: 't8-creative-review-v1',
      source: 'visual-inspection',
      reviewer: 'creator',
      evidence: { url: '/files/output/shot-2-preview.png' },
      dimensions: {
        composition: { status: 'pass', summary: '构图完整' },
        identity: { status: 'pass', summary: '人物身份一致' },
        productShape: { status: 'pass', summary: '没有产品形变' },
        textAccuracy: { status: 'pass', summary: '没有错误文字' },
      },
    },
  }, scope);
  state.applyPatch(service.requirePlan(review.planId, scope).patch);
  const accept = service.actionPlan('accept', {
    nodeId: acceptedPreview.id,
  }, scope);
  state.applyPatch(service.requirePlan(accept.planId, scope).patch);
  assert.equal(
    acceptedPreview.data.creativeState.acceptance.schema,
    't8-creative-adoption-receipt-v1',
  );
  const adopted = service.actionPlan('story.adopt-preview', {
    storyId: 'story-node',
    shotId: 'shot-2',
    candidateId: acceptedPreview.id,
  }, scope);
  state.applyPatch(service.requirePlan(adopted.planId, scope).patch);
  const finalProject = state.document.nodes.find((node) => node.id === 'story-node').data.storyProject;
  const adoptedAsset = finalProject.assets.find((asset) => asset.sourceNodeId === acceptedPreview.id);
  assert.ok(adoptedAsset);
  assert.equal(adoptedAsset.locked, true);
  assert.ok(finalProject.shots.find((shot) => shot.id === 'shot-2').assetIds.includes(adoptedAsset.id));
  assert.equal(state.providerPosts, 0);
});

test('model catalog only returns evidence-backed models and never exposes configured keys', () => {
  const state = fixture([{
    id: 'image-a',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      providerSource: 'volcengine',
      providerId: 'volcengine',
      providerModel: 'doubao-seedream-4-0-250828',
    },
  }]);
  const service = createAgentControlCreativeService({
    database: state.database,
    settingsProvider: () => [{
      id: 'private-provider',
      label: 'Private',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey: 'sk-never-return-this',
      imageModels: ['private-image-v1'],
      videoModels: [],
      chatModels: ['private-llm-v1'],
      defaults: {},
    }],
  });
  const catalog = service.models({ kind: 'image' }, scope);
  assert.ok(catalog.items.some((item) => item.model === 'gpt-image-2'));
  assert.ok(catalog.items.some((item) => item.model === 'zhenzhen-image-g2-t2i'));
  assert.ok(catalog.items.some((item) => item.model === 'doubao-seedream-4-0-250828'));
  assert.ok(catalog.items.some((item) => item.model === 'private-image-v1'));
  assert.equal(JSON.stringify(catalog).includes('sk-never-return-this'), false);
  assert.match(catalog.warning, /不会猜测/);
});

test('built-in creator catalog stays anchored to current LLM, image, video and audio registries', () => {
  const root = path.resolve(__dirname, '..');
  const catalog = require('../backend/src/shared/creativeModelCatalog.json');
  const llmSource = fs.readFileSync(path.join(root, 'src', 'providers', 'models.ts'), 'utf8');
  const seedanceNzLlmModels = new Set(JSON.parse(fs.readFileSync(path.join(
    root,
    'backend/src/shared/seedanceNzLlmModels.json',
  ), 'utf8')));
  const imageSource = llmSource;
  const seedanceNzSource = fs.readFileSync(path.join(root, 'backend/src/providers/seedanceNz.js'), 'utf8');
  const videoSource = [
    llmSource,
    fs.readFileSync(path.join(root, 'src', 'config', 'seedance.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'data', 'falToolboxManifest.ts'), 'utf8'),
    seedanceNzSource,
  ].join('\n');
  const audioSource = [
    llmSource,
    fs.readFileSync(path.join(root, 'src', 'services', 'generation.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'components', 'nodes', 'GrokOAuthAgentNode.tsx'), 'utf8'),
    fs.readFileSync(path.join(root, 'src', 'services', 'grokOAuth.ts'), 'utf8'),
    seedanceNzSource,
  ].join('\n');
  catalog.llm.forEach((item) => assert.ok(
    llmSource.includes(`'${item.model}'`)
      || seedanceNzLlmModels.has(item.model)
      || seedanceNzSource.includes(`'${item.model}'`),
    item.model,
  ));
  catalog.image.forEach((item) => assert.ok(
    imageSource.includes(`'${item.model}'`) || seedanceNzSource.includes(`'${item.model}'`),
    item.model,
  ));
  catalog.video.forEach((item) => assert.ok(videoSource.includes(`'${item.model}'`), item.model));
  catalog.audio.forEach((item) => assert.ok(
    audioSource.includes(`'${item.model}'`) || ['xai-tts', 'xai-stt', 'suno'].includes(item.model),
    item.model,
  ));
});

test('creative plans fail closed after revision changes', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const plan = service.createPlan({
    kind: 'image',
    prompt: '极简产品图',
    ratio: '1:1',
  }, scope);
  state.document.revision += 1;
  assert.throws(
    () => service.requirePlan(plan.planId, scope),
    (error) => error instanceof AgentControlCreativeError && error.code === 'CREATIVE_CANVAS_STALE',
  );
});

test('Creator localization capabilities prepare an auditable node and stage requests without running providers', () => {
  const state = fixture();
  const service = createAgentControlCreativeService({ database: state.database });
  const created = service.actionPlan('localization.create', {
    sourceLanguage: 'ZH',
    targetLanguages: ['EN', 'JA', 'ES', 'AR', 'EN', 'INVALID'],
    mode: 'full',
    sourceText: '[Narrator] T8 opens a new world.',
    instruction: 'Create independently reviewable language branches.',
    apiKey: 'sk-must-never-be-persisted',
  }, scope);
  assert.equal(created.impact.providerCallsNow, 0);
  assert.equal(created.impact.fileWritesNow, 0);
  const createPatch = service.requirePlan(created.planId, scope).patch;
  assert.equal(createPatch.operations.length, 1);
  const added = createPatch.operations[0].payload.node;
  assert.equal(added.type, 'localization-master');
  assert.deepEqual(added.data.targetLanguages, ['EN', 'JA', 'ES', 'AR']);
  assert.equal(added.data.providerModel, 'bytedance/doubao-seed-2.1-pro');
  assert.equal(added.data.localizationAgentRequest.status, 'prepared');
  assert.equal(JSON.stringify(createPatch).includes('sk-must-never-be-persisted'), false);
  state.applyPatch(createPatch);

  const translated = service.actionPlan('localization.translate', {
    nodeId: added.id,
    targetLanguages: ['EN', 'JA', 'ES', 'AR'],
    instruction: 'Preserve T8, 2026, and {count}.',
  }, scope);
  assert.equal(translated.impact.providerCallsNow, 0);
  const translatePatch = service.requirePlan(translated.planId, scope).patch;
  assert.equal(translatePatch.operations.length, 1);
  assert.equal(translatePatch.operations[0].type, 'node.patch');
  assert.equal(translatePatch.operations[0].payload.nodeId, added.id);
  assert.equal(
    translatePatch.operations[0].payload.dataPatch.localizationAgentRequest.action,
    'localization.translate',
  );
  assert.equal(
    translatePatch.operations[0].payload.dataPatch.localizationAgentRequest.status,
    'awaiting-user-run',
  );
  assert.equal(state.providerPosts, 0);
});

test('Creator localization stage requests fail closed for missing or wrong node types', () => {
  const state = fixture([{
    id: 'plain-text',
    type: 'text',
    position: { x: 0, y: 0 },
    data: { text: 'not a localization workbench' },
  }]);
  const service = createAgentControlCreativeService({ database: state.database });
  assert.throws(
    () => service.actionPlan('localization.generate-dub', { nodeId: 'plain-text' }, scope),
    (error) => error instanceof AgentControlCreativeError && error.code === 'CREATIVE_NODE_TYPE_MISMATCH',
  );
  assert.throws(
    () => service.actionPlan('localization.package', { nodeId: 'missing-node' }, scope),
    (error) => error instanceof AgentControlCreativeError && error.code === 'CREATIVE_NODE_NOT_FOUND',
  );
  assert.equal(state.writes, 0);
  assert.equal(state.providerPosts, 0);
});
