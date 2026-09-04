'use strict';

const crypto = require('node:crypto');

const SCENE_SHOT_SCHEMA = 't8-creator-scene-shot-v1';
const SCENE_PRODUCTION_SCHEMA = 't8-creator-scene-production-v1';
const MAX_SCENE_SHOTS = 12;

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function text(value, maximum = 2_000) {
  return String(value == null ? '' : value).replace(/\r\n?/gu, '\n').trim().slice(0, maximum);
}

function normalizedKey(value) {
  return text(value, 240).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function stringList(value, maximum = 24, itemMaximum = 180) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function sceneProductionScopeKey(sceneId) {
  return `scene-production-${digest(text(sceneId, 180)).slice(0, 24)}`;
}

function normalizeShotParameters(value, actionType) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return actionType === 'image' ? {
    ratio: text(source.ratio, 16) || '16:9',
    count: Math.max(1, Math.min(4, Math.trunc(Number(source.count) || 1))),
  } : {
    ratio: text(source.ratio, 16) || '16:9',
    duration: Math.max(1, Math.min(30, Number(source.duration) || 6)),
    resolution: text(source.resolution, 24) || '720p',
  };
}

function normalizedShotProposal(value, index, action) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const prompt = text(source.prompt || (index === 0 ? action?.prompt : ''), 20_000);
  if (!prompt) return null;
  return {
    requestedShotId: text(source.shotId, 180) || null,
    sourceKey: text(source.sourceKey || source.key, 180) || null,
    title: text(source.title, 240) || `镜头 ${index + 1}`,
    purpose: text(source.purpose, 1_000),
    prompt,
    parameters: normalizeShotParameters(source.parameters || action?.parameters, action?.type),
    inputAssetIds: stringList(source.inputAssetIds ?? action?.inputAssetIds, 12, 180),
  };
}

function currentVersion(currentVersions, kind, scopeKey) {
  return (Array.isArray(currentVersions) ? currentVersions : []).find((version) => (
    version?.kind === kind && text(version?.scopeKey, 160) === scopeKey
  )) || null;
}

function activeShotRecords(value) {
  return (Array.isArray(value) ? value : [])
    .filter((shot) => shot?.schema === SCENE_SHOT_SCHEMA && shot.deleted !== true)
    .sort((left, right) => Number(left.ordinal || 0) - Number(right.ordinal || 0)
      || String(left.shotId || '').localeCompare(String(right.shotId || '')));
}

function readSceneProduction(currentVersions, sceneId) {
  const normalizedSceneId = text(sceneId, 180);
  if (!normalizedSceneId) return null;
  const scopeKey = sceneProductionScopeKey(normalizedSceneId);
  const shotVersion = currentVersion(currentVersions, 'ShotList', scopeKey);
  const promptVersion = currentVersion(currentVersions, 'PromptPack', scopeKey);
  if (!shotVersion && !promptVersion) return null;
  const allShots = (Array.isArray(shotVersion?.fields?.shots) ? shotVersion.fields.shots : [])
    .filter((shot) => shot?.schema === SCENE_SHOT_SCHEMA && text(shot.sceneId, 180) === normalizedSceneId);
  const shots = activeShotRecords(allShots);
  const prompts = (Array.isArray(promptVersion?.fields?.prompts) ? promptVersion.fields.prompts : [])
    .filter((prompt) => shots.some((shot) => shot.shotId === text(prompt?.shotId, 180)))
    .sort((left, right) => shots.findIndex((shot) => shot.shotId === left.shotId)
      - shots.findIndex((shot) => shot.shotId === right.shotId));
  const planDigest = text(shotVersion?.fields?.summary, 64);
  const computedDigest = digest({
    schema: SCENE_PRODUCTION_SCHEMA,
    sceneId: normalizedSceneId,
    shots: shots.map((shot) => ({
      shotId: shot.shotId,
      ordinal: shot.ordinal,
      title: shot.title,
      purpose: shot.purpose,
      promptDigest: shot.promptDigest,
      parameters: shot.parameters,
      inputAssetIds: shot.inputAssetIds,
    })),
    prompts: prompts.map((prompt) => ({
      shotId: prompt.shotId,
      prompt: prompt.prompt,
      parameters: prompt.parameters,
      inputAssetIds: prompt.inputAssetIds,
      modelSnapshotDigest: prompt.modelSnapshotDigest,
    })),
  });
  return {
    schema: SCENE_PRODUCTION_SCHEMA,
    sceneId: normalizedSceneId,
    scopeKey,
    shots,
    prompts,
    allShots,
    planDigest: /^[a-f0-9]{64}$/u.test(planDigest) && planDigest === computedDigest
      ? planDigest : null,
    shotVersion,
    promptVersion,
  };
}

function prepareSceneProductionMutation(input = {}) {
  const scene = input.scene;
  const action = input.action;
  const sceneId = text(scene?.sceneId, 180);
  if (!sceneId || !action || !['image', 'video'].includes(action.type)) return null;
  const requested = (Array.isArray(action.shots) && action.shots.length ? action.shots : [{}])
    .slice(0, MAX_SCENE_SHOTS)
    .map((shot, index) => normalizedShotProposal(shot, index, action));
  if (!requested.length || requested.some((shot) => !shot)) return null;

  const scopeKey = sceneProductionScopeKey(sceneId);
  const previous = readSceneProduction(input.currentVersions, sceneId);
  const previousAll = previous?.allShots || [];
  const previousActive = activeShotRecords(previousAll);
  const previousById = new Map(previousActive.map((shot) => [shot.shotId, shot]));
  const matchedIds = new Set();
  const reservedIds = new Set(previousAll.map((shot) => text(shot?.shotId, 180)).filter(Boolean));
  const sourceKeyCandidates = new Map();
  const titleCandidates = new Map();
  previousActive.forEach((shot) => {
    const sourceKey = normalizedKey(shot.sourceKey);
    const title = normalizedKey(shot.title);
    if (sourceKey) sourceKeyCandidates.set(sourceKey, [...(sourceKeyCandidates.get(sourceKey) || []), shot]);
    if (title) titleCandidates.set(title, [...(titleCandidates.get(title) || []), shot]);
  });
  const allocationOccurrences = new Map();
  const allocateId = (proposal) => {
    const fingerprint = normalizedKey(proposal.sourceKey || proposal.title) || digest(proposal.prompt).slice(0, 16);
    let occurrence = (allocationOccurrences.get(fingerprint) || 0) + 1;
    let candidate;
    do {
      allocationOccurrences.set(fingerprint, occurrence);
      candidate = `shot_${digest({ schema: SCENE_SHOT_SCHEMA, sceneId, fingerprint, occurrence }).slice(0, 24)}`;
      occurrence += 1;
    } while (reservedIds.has(candidate));
    reservedIds.add(candidate);
    return candidate;
  };
  const selectUnique = (items) => {
    const available = (items || []).filter((shot) => !matchedIds.has(shot.shotId));
    return available.length === 1 ? available[0] : null;
  };
  const shots = requested.map((proposal, index) => {
    const requestedExisting = proposal.requestedShotId
      ? previousById.get(proposal.requestedShotId) : null;
    if (proposal.requestedShotId && !requestedExisting) return null;
    const matched = requestedExisting
      || selectUnique(sourceKeyCandidates.get(normalizedKey(proposal.sourceKey)))
      || selectUnique(titleCandidates.get(normalizedKey(proposal.title)));
    if (matched) matchedIds.add(matched.shotId);
    const shotId = matched?.shotId || allocateId(proposal);
    const comparable = {
      sourceKey: proposal.sourceKey,
      title: proposal.title,
      purpose: proposal.purpose,
      promptDigest: digest(proposal.prompt),
      parameters: proposal.parameters,
      inputAssetIds: proposal.inputAssetIds,
    };
    const priorComparable = matched ? {
      sourceKey: matched.sourceKey || null,
      title: matched.title,
      purpose: matched.purpose || '',
      promptDigest: matched.promptDigest,
      parameters: matched.parameters,
      inputAssetIds: matched.inputAssetIds,
    } : null;
    return {
      schema: SCENE_SHOT_SCHEMA,
      shotId,
      sceneId,
      ordinal: index + 1,
      ...comparable,
      recordRevision: matched
        ? Math.max(1, Math.trunc(Number(matched.recordRevision) || 1))
          + (digest(comparable) === digest(priorComparable) ? 0 : 1)
        : 1,
      deleted: false,
    };
  });
  if (shots.some((shot) => !shot) || new Set(shots.map((shot) => shot.shotId)).size !== shots.length) return null;
  const tombstones = previousAll.map((shot) => {
    if (matchedIds.has(shot.shotId) || shot.deleted === true) return shot;
    return {
      ...shot,
      deleted: true,
      recordRevision: Math.max(1, Math.trunc(Number(shot.recordRevision) || 1)) + 1,
    };
  }).filter((shot) => shot.deleted === true);
  const modelSnapshotDigest = digest(action.modelSnapshot || null);
  const prompts = shots.map((shot, index) => ({
    shotId: shot.shotId,
    prompt: requested[index].prompt,
    parameters: requested[index].parameters,
    inputAssetIds: requested[index].inputAssetIds,
    modelSnapshotDigest,
  }));
  const planDigest = digest({
    schema: SCENE_PRODUCTION_SCHEMA,
    sceneId,
    shots: shots.map((shot) => ({
      shotId: shot.shotId,
      ordinal: shot.ordinal,
      title: shot.title,
      purpose: shot.purpose,
      promptDigest: shot.promptDigest,
      parameters: shot.parameters,
      inputAssetIds: shot.inputAssetIds,
    })),
    prompts,
  });
  const actionShots = shots.map((shot, index) => ({
    shotId: shot.shotId,
    ordinal: shot.ordinal,
    title: shot.title,
    prompt: prompts[index].prompt,
    parameters: prompts[index].parameters,
    inputAssetIds: prompts[index].inputAssetIds,
    status: 'pending',
    resultAssets: [],
    runId: null,
    nodeRunId: null,
    attemptId: null,
    errorCode: null,
    errorMessage: null,
  }));
  return {
    schema: SCENE_PRODUCTION_SCHEMA,
    sceneId,
    scopeKey,
    planDigest,
    shotIds: shots.map((shot) => shot.shotId),
    shots: actionShots,
    mutations: [{
      kind: 'ShotList', scopeKey, title: `${text(scene.title, 200) || '当前场'} · 镜头`,
      fields: {
        shots: [...shots, ...tombstones],
        coverage: { schema: SCENE_PRODUCTION_SCHEMA, sceneId, activeShotCount: shots.length },
        summary: planDigest,
      },
      baseVersionId: previous?.shotVersion?.versionId || null,
    }, {
      kind: 'PromptPack', scopeKey, title: `${text(scene.title, 200) || '当前场'} · 生成提示词`,
      fields: {
        prompts,
        referenceBindings: prompts.map((prompt) => ({
          shotId: prompt.shotId,
          inputAssetIds: prompt.inputAssetIds,
        })),
        modelHints: { type: action.type, modelSnapshot: action.modelSnapshot },
        summary: planDigest,
      },
      baseVersionId: previous?.promptVersion?.versionId || null,
    }],
  };
}

module.exports = {
  MAX_SCENE_SHOTS,
  SCENE_PRODUCTION_SCHEMA,
  SCENE_SHOT_SCHEMA,
  activeShotRecords,
  digest,
  prepareSceneProductionMutation,
  readSceneProduction,
  sceneProductionScopeKey,
};
