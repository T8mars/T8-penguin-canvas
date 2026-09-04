const crypto = require('node:crypto');

const CREATOR_WORK_PROPOSAL_SCHEMA = 't8-creator-work-proposal-v1';
const CREATOR_WORK_ARTIFACT_VERSION_SCHEMA = 't8-creator-work-artifact-version-v1';
const CREATOR_WORK_ARTIFACT_DIFF_SCHEMA = 't8-creator-work-artifact-diff-v1';
const CREATOR_WORK_SNAPSHOT_SCHEMA = 't8-creator-work-snapshot-v1';
const CREATOR_LLM_TURN_RECEIPT_SCHEMA = 't8-creator-llm-turn-receipt-v1';

const MAX_ARTIFACTS_PER_TURN = 16;
// Legacy Creator sessions still keep their bounded history in one session
// document.  Scoped long-form work uses the normalized V2 repository, but
// this wider read window keeps a migrated 300/500-scene project from losing
// current shard pointers while it is being normalized.
const MAX_ARTIFACT_VERSIONS = 4_096;
const MAX_TEXT = 16_000;
const MAX_JSON_BYTES = 240_000;
const MAX_SCOPED_MUTATIONS = 256;
const ROOT_SCOPE_KEY = 'root';

const COMMON_FIELDS = Object.freeze([
  'summary',
  'notes',
  'sourceFacts',
  'assumptions',
  'unknowns',
  'constraints',
]);

const ARTIFACT_FIELDS = Object.freeze({
  ProductionBrief: [
    'title', 'outcome', 'audience', 'format', 'durationSeconds', 'aspectRatio',
    'style', 'tone', 'language', 'successCriteria', ...COMMON_FIELDS,
  ],
  TaskProfile: [
    'family', 'intent', 'deliveryKind', 'modalities', 'targetPlatform',
    'qualityMode', 'scope', ...COMMON_FIELDS,
  ],
  CreativeDirectionSet: [
    'directions', 'recommendedDirectionId', 'selectionReason', 'risks', ...COMMON_FIELDS,
  ],
  ProductTruth: [
    'facts', 'claimsToAvoid', 'sourceBindings', ...COMMON_FIELDS,
  ],
  BrandKit: [
    'brandVoice', 'palette', 'typography', 'logoRules', 'mandatoryElements',
    'forbiddenElements', ...COMMON_FIELDS,
  ],
  CommerceContentPlan: [
    'channels', 'contentUnits', 'storyArc', 'assetNeeds', 'complianceNotes', ...COMMON_FIELDS,
  ],
  CopySet: [
    'headlines', 'subheads', 'body', 'cta', 'disclaimers', 'variants', ...COMMON_FIELDS,
  ],
  VisualSpec: [
    'composition', 'subject', 'environment', 'lighting', 'color', 'palette',
    'materials', 'textTreatment', 'references', 'negativeRules', ...COMMON_FIELDS,
  ],
  LayoutSpec: [
    'canvas', 'grid', 'hierarchy', 'safeAreas', 'placements', 'variants', ...COMMON_FIELDS,
  ],
  EditPlan: [
    'preserve', 'change', 'remove', 'add', 'steps', 'maskNotes', 'qualityChecks', ...COMMON_FIELDS,
  ],
  ScriptDoc: [
    'title', 'logline', 'theme', 'synopsis', 'characters', 'acts', 'scenes',
    'dialogue', 'ending', 'manifest', 'source', ...COMMON_FIELDS,
  ],
  WorldBible: [
    'premise', 'locations', 'rules', 'timeline', 'continuity', ...COMMON_FIELDS,
  ],
  CharacterBible: [
    'characters', 'identityLocks', 'relationships', 'wardrobe', 'continuity', ...COMMON_FIELDS,
  ],
  ShotList: [
    'shots', 'totalDurationSeconds', 'continuityRules', 'coverage', ...COMMON_FIELDS,
  ],
  Storyboard: [
    'frames', 'styleContinuity', 'missingFrames', ...COMMON_FIELDS,
  ],
  MotionPlan: [
    'beats', 'camera', 'motion', 'transitions', 'timing', 'continuity', ...COMMON_FIELDS,
  ],
  AudioPlan: [
    'tracks', 'cues', 'dialogue', 'voiceover', 'music', 'ambience', 'sfx',
    'mixNotes', ...COMMON_FIELDS,
  ],
  AssetNeed: [
    'items', 'existing', 'missing', 'protected', ...COMMON_FIELDS,
  ],
  PromptPack: [
    'prompts', 'negativePrompts', 'referenceBindings', 'modelHints', 'reviewNotes', ...COMMON_FIELDS,
  ],
  CandidateReview: [
    'candidates', 'criteria', 'hardGates', 'adoptions', ...COMMON_FIELDS,
  ],
  EDL: [
    'sequence', 'transitions', 'audioLayers', 'durationSeconds', ...COMMON_FIELDS,
  ],
  QCReport: [
    'checks', 'failures', 'warnings', 'verifiedArtifacts', ...COMMON_FIELDS,
  ],
  DeliveryManifest: [
    'deliverables', 'formats', 'licenses', 'verification', ...COMMON_FIELDS,
  ],
});

const REQUIRED_KINDS = Object.freeze({
  commerce: ['ProductionBrief', 'TaskProfile', 'ProductTruth', 'CommerceContentPlan', 'CopySet'],
  image: ['ProductionBrief', 'TaskProfile', 'VisualSpec', 'EditPlan', 'PromptPack'],
  video: ['ProductionBrief', 'TaskProfile', 'ShotList', 'MotionPlan', 'AudioPlan', 'PromptPack'],
  story: [
    'ProductionBrief', 'TaskProfile', 'ScriptDoc', 'CharacterBible', 'AssetNeed',
    'ShotList', 'Storyboard', 'AudioPlan', 'PromptPack',
  ],
  audio: ['ProductionBrief', 'TaskProfile', 'AudioPlan', 'PromptPack'],
  mixed: ['ProductionBrief', 'TaskProfile'],
});

const DEPENDENCY_KINDS = Object.freeze({
  TaskProfile: [],
  ProductionBrief: ['TaskProfile'],
  CreativeDirectionSet: ['ProductionBrief'],
  ProductTruth: ['ProductionBrief'],
  BrandKit: ['ProductionBrief'],
  CommerceContentPlan: ['ProductionBrief', 'ProductTruth'],
  CopySet: ['CommerceContentPlan'],
  VisualSpec: ['ProductionBrief'],
  LayoutSpec: ['VisualSpec'],
  EditPlan: ['ProductionBrief', 'VisualSpec'],
  ScriptDoc: ['ProductionBrief'],
  WorldBible: ['ScriptDoc'],
  CharacterBible: ['ScriptDoc'],
  AssetNeed: ['ScriptDoc'],
  ShotList: ['ScriptDoc'],
  Storyboard: ['ShotList', 'VisualSpec'],
  MotionPlan: ['ShotList'],
  AudioPlan: ['ScriptDoc', 'ShotList'],
  PromptPack: ['Storyboard', 'MotionPlan', 'AudioPlan', 'VisualSpec', 'EditPlan'],
  CandidateReview: ['PromptPack'],
  EDL: ['CandidateReview'],
  QCReport: ['EDL'],
  DeliveryManifest: ['QCReport'],
});

function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableString(value)).digest('hex');
}

function boundedText(value, maximum = 2_000) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maximum);
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/u.test(String(value || '').toLowerCase());
}

function normalizeScopeKey(value) {
  const scopeKey = boundedText(value || ROOT_SCOPE_KEY, 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(scopeKey)
    ? scopeKey
    : ROOT_SCOPE_KEY;
}

function artifactLogicalKey(kind, scopeKey = ROOT_SCOPE_KEY) {
  return `${boundedText(kind, 80)}\u0000${normalizeScopeKey(scopeKey)}`;
}

function normalizeFamily(value) {
  const family = boundedText(value, 32).toLowerCase();
  return Object.prototype.hasOwnProperty.call(REQUIRED_KINDS, family) ? family : 'mixed';
}

function normalizeQualityMode(value) {
  const mode = boundedText(value, 32).toLowerCase();
  return ['quick', 'standard', 'quality'].includes(mode) ? mode : 'standard';
}

function secretLeakReason(value) {
  const body = stableString(value);
  if (/\bsk-[A-Za-z0-9_-]{12,}\b/u.test(body)) return 'credential-token';
  if (/\b(?:authorization|api[_ -]?key)\s*[:=]\s*(?:bearer\s+)?[^\s]{12,}/iu.test(body)) {
    return 'credential-field';
  }
  if (/(?:^|[\s"'`])(?:[A-Z]:\\Users\\|\/Users\/|\/home\/)[^\s"'`]+/imu.test(body)) {
    return 'local-user-path';
  }
  return '';
}

function normalizeJsonValue(value, depth = 0) {
  if (depth > 7) throw new Error('artifact-value-too-deep');
  if (value == null) return null;
  if (typeof value === 'string') return boundedText(value, MAX_TEXT);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('artifact-number-invalid');
    return Math.max(-1_000_000_000, Math.min(1_000_000_000, value));
  }
  if (Array.isArray(value)) {
    if (value.length > 120) throw new Error('artifact-array-too-large');
    return value.map((item) => normalizeJsonValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 80) throw new Error('artifact-object-too-large');
    return Object.fromEntries(entries.map(([key, item]) => {
      const normalizedKey = boundedText(key, 120);
      if (!normalizedKey || /(?:__proto__|prototype|constructor)/u.test(normalizedKey)) {
        throw new Error('artifact-key-invalid');
      }
      return [normalizedKey, normalizeJsonValue(item, depth + 1)];
    }));
  }
  throw new Error('artifact-value-invalid');
}

function normalizeFields(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set(ARTIFACT_FIELDS[kind] || []);
  if (!allowed.size) return null;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !allowed.has(key))) return null;
  let fields;
  try {
    fields = Object.fromEntries(keys.map((key) => [key, normalizeJsonValue(value[key])]));
  } catch {
    return null;
  }
  if (Buffer.byteLength(stableString(fields), 'utf8') > MAX_JSON_BYTES) return null;
  if (secretLeakReason(fields)) return null;
  return fields;
}

function normalizeTaskProfile(value, family, qualityMode) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {
    family: normalizeFamily(value.family || family),
    intent: boundedText(value.intent, 1_000),
    deliveryKind: boundedText(value.deliveryKind, 120),
    modalities: [...new Set((Array.isArray(value.modalities) ? value.modalities : [])
      .map((item) => boundedText(item, 40).toLowerCase())
      .filter(Boolean))].slice(0, 8),
    targetPlatform: boundedText(value.targetPlatform, 160) || null,
    qualityMode: normalizeQualityMode(value.qualityMode || qualityMode),
  };
  if (normalized.family !== family || !normalized.intent || !normalized.deliveryKind) return null;
  return normalized;
}

function normalizeProposalArtifact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = boundedText(value.kind, 80);
  if (!Object.prototype.hasOwnProperty.call(ARTIFACT_FIELDS, kind)) return null;
  const title = boundedText(value.title, 200);
  const fields = normalizeFields(kind, value.fields);
  if (!title || !fields) return null;
  const requestedDependencies = [...new Set((Array.isArray(value.dependsOnKinds)
    ? value.dependsOnKinds : DEPENDENCY_KINDS[kind] || [])
    .map((item) => boundedText(item, 80))
    .filter((item) => Object.prototype.hasOwnProperty.call(ARTIFACT_FIELDS, item) && item !== kind))]
    .slice(0, 12);
  return {
    kind,
    scopeKey: normalizeScopeKey(value.scopeKey),
    title,
    operation: 'upsert',
    fields,
    dependsOnKinds: requestedDependencies,
  };
}

function proposalPayload(value) {
  return {
    schema: value.schema,
    proposalId: value.proposalId,
    taskProfile: value.taskProfile,
    requiredKinds: value.requiredKinds,
    displayMarkdown: value.displayMarkdown,
    artifacts: value.artifacts,
    modelPayloadDigest: value.modelPayloadDigest,
  };
}

function createCreatorWorkProposal(input = {}) {
  const raw = input.modelValue;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const allowedTop = new Set(['schema', 'displayMarkdown', 'taskProfile', 'artifacts', 'toolProposals']);
  if (Object.keys(raw).some((key) => !allowedTop.has(key))) return null;
  const family = normalizeFamily(input.taskFamily || raw.taskProfile?.family);
  const qualityMode = normalizeQualityMode(input.qualityMode || raw.taskProfile?.qualityMode);
  const requiredKinds = [...new Set((Array.isArray(input.requiredKinds)
    ? input.requiredKinds : REQUIRED_KINDS[family])
    .map((kind) => boundedText(kind, 80))
    .filter((kind) => Object.prototype.hasOwnProperty.call(ARTIFACT_FIELDS, kind)))];
  if (!requiredKinds.length) return null;
  const displayMarkdown = boundedText(raw.displayMarkdown, 80_000);
  const taskProfile = normalizeTaskProfile(raw.taskProfile, family, qualityMode);
  if (!displayMarkdown || !taskProfile || secretLeakReason(displayMarkdown)) return null;
  const artifacts = (Array.isArray(raw.artifacts) ? raw.artifacts : [])
    .slice(0, MAX_ARTIFACTS_PER_TURN)
    .map(normalizeProposalArtifact);
  if (!artifacts.length || artifacts.some((artifact) => artifact == null)) return null;
  const kinds = artifacts.map((artifact) => artifact.kind);
  const logicalKeys = artifacts.map((artifact) => artifactLogicalKey(artifact.kind, artifact.scopeKey));
  if (new Set(logicalKeys).size !== logicalKeys.length) return null;
  const missingKinds = requiredKinds.filter((kind) => !kinds.includes(kind));
  const unexpectedKinds = Array.isArray(input.requiredKinds)
    ? kinds.filter((kind) => !requiredKinds.includes(kind))
    : [];
  if (missingKinds.length || unexpectedKinds.length) return null;
  const modelPayloadDigest = digest({
    schema: 't8-creator-work-model-payload-v1',
    displayMarkdown,
    taskProfile,
    artifacts,
  });
  const proposalId = `cwp_${digest({
    schema: CREATOR_WORK_PROPOSAL_SCHEMA,
    family,
    qualityMode,
    logicalRequestId: boundedText(input.logicalRequestId, 160),
    modelPayloadDigest,
  }).slice(0, 32)}`;
  const proposal = {
    schema: CREATOR_WORK_PROPOSAL_SCHEMA,
    proposalId,
    taskProfile,
    requiredKinds,
    displayMarkdown,
    artifacts,
    modelPayloadDigest,
  };
  proposal.proposalDigest = digest(proposalPayload(proposal));
  return proposal;
}

function normalizeCreatorWorkProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_WORK_PROPOSAL_SCHEMA) return null;
  const normalized = createCreatorWorkProposal({
    modelValue: {
      displayMarkdown: value.displayMarkdown,
      taskProfile: value.taskProfile,
      artifacts: value.artifacts,
    },
    taskFamily: value.taskProfile?.family,
    qualityMode: value.taskProfile?.qualityMode,
    requiredKinds: value.requiredKinds,
    logicalRequestId: '',
  });
  if (!normalized) return null;
  const proposalId = boundedText(value.proposalId, 80);
  const proposalDigest = boundedText(value.proposalDigest, 64).toLowerCase();
  if (!/^cwp_[a-f0-9]{32}$/u.test(proposalId)
    || !validDigest(proposalDigest)
    || !validDigest(value.modelPayloadDigest)) return null;
  const candidate = {
    ...normalized,
    proposalId,
    requiredKinds: normalized.requiredKinds,
    modelPayloadDigest: String(value.modelPayloadDigest).toLowerCase(),
  };
  candidate.proposalDigest = digest(proposalPayload(candidate));
  if (candidate.proposalDigest !== proposalDigest) return null;
  return candidate;
}

function diffFields(previousFields, nextFields) {
  const paths = [...new Set([
    ...Object.keys(previousFields || {}),
    ...Object.keys(nextFields || {}),
  ])].sort();
  return paths.flatMap((key) => {
    const beforeExists = Object.prototype.hasOwnProperty.call(previousFields || {}, key);
    const afterExists = Object.prototype.hasOwnProperty.call(nextFields || {}, key);
    const before = beforeExists ? previousFields[key] : undefined;
    const after = afterExists ? nextFields[key] : undefined;
    if (beforeExists && afterExists && stableString(before) === stableString(after)) return [];
    return [{
      op: beforeExists ? (afterExists ? 'replace' : 'remove') : 'add',
      path: `/fields/${key}`,
      ...(beforeExists ? { beforeDigest: digest(before) } : {}),
      ...(afterExists ? { afterDigest: digest(after) } : {}),
    }];
  });
}

function versionPayload(value) {
  return {
    schema: value.schema,
    artifactId: value.artifactId,
    versionId: value.versionId,
    revision: value.revision,
    kind: value.kind,
    ...(Object.prototype.hasOwnProperty.call(value, 'scopeKey')
      ? { scopeKey: normalizeScopeKey(value.scopeKey) }
      : {}),
    title: value.title,
    status: value.status,
    fields: value.fields,
    fieldLocks: value.fieldLocks,
    dependencies: value.dependencies,
    invalidates: value.invalidates,
    source: value.source,
    diff: value.diff,
    createdAt: value.createdAt,
  };
}

function normalizeWorkArtifactVersion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_WORK_ARTIFACT_VERSION_SCHEMA) return null;
  const artifactId = boundedText(value.artifactId, 80);
  const versionId = boundedText(value.versionId, 80);
  const revision = Math.max(1, Math.trunc(Number(value.revision) || 0));
  const kind = boundedText(value.kind, 80);
  const hasScopeKey = Object.prototype.hasOwnProperty.call(value, 'scopeKey');
  const scopeKey = normalizeScopeKey(value.scopeKey);
  const title = boundedText(value.title, 200);
  const status = boundedText(value.status, 40);
  const fields = normalizeFields(kind, value.fields);
  const fieldLocks = [...new Set((Array.isArray(value.fieldLocks) ? value.fieldLocks : [])
    .map((item) => boundedText(item, 200))
    .filter((item) => /^\/fields\/[A-Za-z][A-Za-z0-9]*$/u.test(item)))]
    .sort();
  const dependencies = (Array.isArray(value.dependencies) ? value.dependencies : [])
    .slice(0, 12)
    .map((item) => ({
      artifactId: boundedText(item?.artifactId, 80),
      versionId: boundedText(item?.versionId, 80),
      versionDigest: boundedText(item?.versionDigest, 64).toLowerCase(),
      kind: boundedText(item?.kind, 80),
    }));
  const invalidates = [...new Set((Array.isArray(value.invalidates) ? value.invalidates : [])
    .map((item) => boundedText(item, 80)).filter(Boolean))].slice(0, 24);
  const diff = value.diff && typeof value.diff === 'object' && !Array.isArray(value.diff)
    ? {
        schema: CREATOR_WORK_ARTIFACT_DIFF_SCHEMA,
        baseVersionId: value.diff.baseVersionId == null
          ? null : boundedText(value.diff.baseVersionId, 80),
        operations: (Array.isArray(value.diff.operations) ? value.diff.operations : [])
          .slice(0, 80)
          .map((operation) => ({
            op: boundedText(operation?.op, 20),
            path: boundedText(operation?.path, 200),
            ...(validDigest(operation?.beforeDigest)
              ? { beforeDigest: String(operation.beforeDigest).toLowerCase() } : {}),
            ...(validDigest(operation?.afterDigest)
              ? { afterDigest: String(operation.afterDigest).toLowerCase() } : {}),
          }))
          .filter((operation) => ['add', 'replace', 'remove', 'lock', 'unlock'].includes(operation.op)
            && /^(?:\/(?:fields|fieldLocks)(?:\/|$)|\/(?:title|status)$)/u.test(operation.path)),
      }
    : null;
  const source = value.source && typeof value.source === 'object' && !Array.isArray(value.source)
    ? {
        responseId: boundedText(value.source.responseId, 160) || null,
        logicalRequestId: boundedText(value.source.logicalRequestId, 160) || null,
        llmTurnReceiptDigest: boundedText(value.source.llmTurnReceiptDigest, 64).toLowerCase() || null,
        proposalDigest: boundedText(value.source.proposalDigest, 64).toLowerCase() || null,
        editor: boundedText(value.source.editor, 40) || null,
      }
    : null;
  const createdAt = boundedText(value.createdAt, 80);
  if (!/^cwa_[a-f0-9]{32}$/u.test(artifactId)
    || !/^cwav_[a-f0-9]{32}$/u.test(versionId)
    || !ARTIFACT_FIELDS[kind] || !title || !fields || !diff || !source || !createdAt
    || !['model-draft', 'creator-edited', 'accepted', 'rejected'].includes(status)
    || dependencies.some((item) => !/^cwa_[a-f0-9]{32}$/u.test(item.artifactId)
      || !/^cwav_[a-f0-9]{32}$/u.test(item.versionId)
      || !validDigest(item.versionDigest)
      || !ARTIFACT_FIELDS[item.kind])) return null;
  const normalized = {
    schema: CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
    artifactId,
    versionId,
    revision,
    kind,
    ...(hasScopeKey ? { scopeKey } : {}),
    title,
    status,
    fields,
    fieldLocks,
    dependencies,
    invalidates,
    source,
    diff,
    createdAt,
  };
  const versionDigest = boundedText(value.versionDigest, 64).toLowerCase();
  if (!validDigest(versionDigest) || versionDigest !== digest(versionPayload(normalized))) return null;
  normalized.versionDigest = versionDigest;
  return normalized;
}

function normalizeWorkArtifactVersions(value) {
  return (Array.isArray(value) ? value : [])
    .slice(-MAX_ARTIFACT_VERSIONS)
    .map(normalizeWorkArtifactVersion)
    .filter(Boolean);
}

function latestWorkArtifactVersions(value) {
  const latest = new Map();
  for (const version of normalizeWorkArtifactVersions(value)) {
    const previous = latest.get(version.artifactId);
    if (!previous || version.revision > previous.revision) latest.set(version.artifactId, version);
  }
  return [...latest.values()].sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || normalizeScopeKey(left.scopeKey).localeCompare(normalizeScopeKey(right.scopeKey))
  ));
}

function creatorWorkMutationScope(prompt, existingVersions = []) {
  const value = boundedText(prompt, 20_000).toLowerCase();
  const restrictive = /(?:只|仅)(?:需要|要|想)?(?:修改|改写|改|调整|优化)|\bonly\b/iu.test(value);
  if (!restrictive) return { restricted: false, allowedPaths: [], preserveArrayPrefixes: [] };
  const requestedFields = new Set();
  const add = (...fields) => fields.forEach((field) => requestedFields.add(field));
  if (/结尾|结局|收尾|ending|finale/iu.test(value)) add('ending');
  if (/标题|片名|主标题|headline|title/iu.test(value)) add('title', 'headlines');
  if (/对白|台词|dialogue|line/iu.test(value)) add('dialogue');
  if (/梗概|简介|synopsis|summary/iu.test(value)) add('synopsis', 'summary');
  if (/人物|角色|character/iu.test(value)) add('characters', 'relationships', 'identityLocks');
  if (/镜头|分镜|shot|storyboard/iu.test(value)) add('shots', 'frames');
  if (/声音|音频|配乐|音乐|audio|music/iu.test(value)) {
    add('tracks', 'cues', 'dialogue', 'voiceover', 'music', 'ambience', 'sfx', 'mixNotes');
  }
  const promptBody = value
    .replace(/负面提示词|反向提示词|negative\s+prompts?/giu, '')
    .replace(/提示词检查(?:项|备注)?|提示词审核(?:项|备注)?|prompt\s+review\s+notes?/giu, '');
  if (/提示词|\bprompts?\b/iu.test(promptBody)) add('prompts');
  if (/负面提示词|反向提示词|negative\s+prompts?/iu.test(value)) add('negativePrompts');
  if (/提示词检查(?:项|备注)?|提示词审核(?:项|备注)?|prompt\s+review\s+notes?/iu.test(value)) add('reviewNotes');
  if (/文案|正文|copy|body/iu.test(value)) add('headlines', 'subheads', 'body', 'cta', 'disclaimers');
  const latest = latestWorkArtifactVersions(existingVersions);
  const allowedPaths = latest.flatMap((version) => [
    ...(requestedFields.has('title') ? [`/${version.kind}/title`] : []),
    ...(ARTIFACT_FIELDS[version.kind] || [])
      .filter((field) => requestedFields.has(field))
      .map((field) => `/${version.kind}/fields/${field}`),
  ]).sort();
  const preserveArrayPrefixes = /最后|末尾|最终|最后一(?:个|条|格|镜)?|\b(?:last|final)\b/iu.test(value)
    ? allowedPaths.filter((path) => /\/fields\/(?:shots|frames|prompts)$/u.test(path))
    : [];
  return {
    restricted: true,
    allowedPaths,
    preserveArrayPrefixes,
  };
}

function workArtifactSummaries(value) {
  return latestWorkArtifactVersions(value).map((version) => ({
    artifactId: version.artifactId,
    versionId: version.versionId,
    revision: version.revision,
    kind: version.kind,
    scopeKey: normalizeScopeKey(version.scopeKey),
    title: version.title,
    status: version.status,
    fieldCount: Object.keys(version.fields || {}).length,
    lockedFieldCount: (version.fieldLocks || []).length,
    versionDigest: version.versionDigest,
    updatedAt: version.createdAt,
  }));
}

function normalizeReceiptInputBindings(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 24)
    .map((item) => ({
      assetId: boundedText(item?.assetId, 160) || null,
      contentRevision: Math.max(0, Math.trunc(Number(item?.contentRevision) || 0)),
      contentHash: boundedText(item?.contentHash, 128).toLowerCase().replace(/^sha256:/u, '') || null,
      kind: boundedText(item?.kind, 24).toLowerCase() || 'file',
      mimeType: boundedText(item?.mimeType, 120).toLowerCase() || null,
      observationDigest: boundedText(item?.observationDigest, 64).toLowerCase() || null,
    }))
    .filter((item) => (
      (item.assetId || item.contentHash)
      && (!item.contentHash || validDigest(item.contentHash))
      && (!item.observationDigest || validDigest(item.observationDigest))
    ));
}

function normalizeReceiptArtifactBindings(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_ARTIFACTS_PER_TURN)
    .map((item) => ({
      artifactId: boundedText(item?.artifactId, 80),
      kind: boundedText(item?.kind, 80),
      baseVersionId: boundedText(item?.baseVersionId, 80) || null,
      newVersionId: boundedText(item?.newVersionId, 80),
      diffDigest: boundedText(item?.diffDigest, 64).toLowerCase(),
    }))
    .filter((item) => (
      /^cwa_[a-f0-9]{32}$/u.test(item.artifactId)
      && ARTIFACT_FIELDS[item.kind]
      && (!item.baseVersionId || /^cwav_[a-f0-9]{32}$/u.test(item.baseVersionId))
      && /^cwav_[a-f0-9]{32}$/u.test(item.newVersionId)
      && validDigest(item.diffDigest)
    ));
}

function normalizeCreatorLlmTurnReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_LLM_TURN_RECEIPT_SCHEMA) return null;
  const receiptDigest = boundedText(value.receiptDigest, 64).toLowerCase();
  if (!validDigest(receiptDigest)) return null;
  const hasExtendedBindings = [
    'phase',
    'invocationReceiptDigest',
    'inputBindings',
    'artifactBindings',
    'workSnapshotDigest',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (!hasExtendedBindings) {
    // v1 receipts written before Creator Work bindings remain readable. Keep
    // their exact digest payload instead of silently re-signing old evidence.
    const legacy = {
      schema: CREATOR_LLM_TURN_RECEIPT_SCHEMA,
      sessionId: boundedText(value.sessionId, 160),
      responseId: boundedText(value.responseId, 160),
      logicalRequestId: boundedText(value.logicalRequestId, 160),
      status: boundedText(value.status, 40),
      qualityMode: normalizeQualityMode(value.qualityMode),
      providerCalls: Math.max(0, Math.min(8, Math.trunc(Number(value.providerCalls) || 0))),
      provider: boundedText(value.provider, 160) || null,
      model: boundedText(value.model, 240) || null,
      modelDecisionDigest: boundedText(value.modelDecisionDigest, 64).toLowerCase() || null,
      promptContractDigest: boundedText(value.promptContractDigest, 64).toLowerCase() || null,
      mediaObservationDigest: boundedText(value.mediaObservationDigest, 64).toLowerCase() || null,
      calls: (Array.isArray(value.calls) ? value.calls : []).slice(0, 8).map((call, index) => ({
        index,
        role: boundedText(call?.role, 40) || (index === 0 ? 'draft' : 'refine'),
        status: boundedText(call?.status, 40) || 'completed',
        provider: boundedText(call?.provider, 160) || null,
        model: boundedText(call?.model, 240) || null,
        requestId: boundedText(call?.requestId, 240) || null,
        finishReason: boundedText(call?.finishReason, 120) || null,
      })),
      workProposalDigest: boundedText(value.workProposalDigest, 64).toLowerCase() || null,
      createdAt: boundedText(value.createdAt, 80),
    };
    if (!legacy.sessionId || !legacy.responseId || !legacy.logicalRequestId
      || !legacy.status || !legacy.createdAt
      || (legacy.modelDecisionDigest && !validDigest(legacy.modelDecisionDigest))
      || (legacy.promptContractDigest && !validDigest(legacy.promptContractDigest))
      || (legacy.mediaObservationDigest && !validDigest(legacy.mediaObservationDigest))
      || (legacy.workProposalDigest && !validDigest(legacy.workProposalDigest))
      || digest(legacy) !== receiptDigest) return null;
    return { ...legacy, receiptDigest };
  }
  const normalized = {
    schema: CREATOR_LLM_TURN_RECEIPT_SCHEMA,
    sessionId: boundedText(value.sessionId, 160),
    responseId: boundedText(value.responseId, 160),
    logicalRequestId: boundedText(value.logicalRequestId, 160),
    phase: ['invocation', 'compiled'].includes(boundedText(value.phase, 40))
      ? boundedText(value.phase, 40) : 'invocation',
    status: boundedText(value.status, 40),
    qualityMode: normalizeQualityMode(value.qualityMode),
    providerCalls: Math.max(0, Math.min(8, Math.trunc(Number(value.providerCalls) || 0))),
    provider: boundedText(value.provider, 160) || null,
    model: boundedText(value.model, 240) || null,
    modelDecisionDigest: boundedText(value.modelDecisionDigest, 64).toLowerCase() || null,
    promptContractDigest: boundedText(value.promptContractDigest, 64).toLowerCase() || null,
    mediaObservationDigest: boundedText(value.mediaObservationDigest, 64).toLowerCase() || null,
    calls: (Array.isArray(value.calls) ? value.calls : []).slice(0, 8).map((call, index) => ({
      index,
      role: boundedText(call?.role, 40) || (index === 0 ? 'draft' : 'refine'),
      status: boundedText(call?.status, 40) || 'completed',
      provider: boundedText(call?.provider, 160) || null,
      model: boundedText(call?.model, 240) || null,
      requestId: boundedText(call?.requestId, 240) || null,
      finishReason: boundedText(call?.finishReason, 120) || null,
    })),
    workProposalDigest: boundedText(value.workProposalDigest, 64).toLowerCase() || null,
    invocationReceiptDigest: boundedText(value.invocationReceiptDigest, 64).toLowerCase() || null,
    inputBindings: normalizeReceiptInputBindings(value.inputBindings),
    artifactBindings: normalizeReceiptArtifactBindings(value.artifactBindings),
    workSnapshotDigest: boundedText(value.workSnapshotDigest, 64).toLowerCase() || null,
    createdAt: boundedText(value.createdAt, 80),
  };
  if (!normalized.sessionId || !normalized.responseId || !normalized.logicalRequestId
    || !normalized.status || !normalized.createdAt
    || (normalized.modelDecisionDigest && !validDigest(normalized.modelDecisionDigest))
    || (normalized.promptContractDigest && !validDigest(normalized.promptContractDigest))
    || (normalized.mediaObservationDigest && !validDigest(normalized.mediaObservationDigest))
    || (normalized.workProposalDigest && !validDigest(normalized.workProposalDigest))
    || (normalized.invocationReceiptDigest && !validDigest(normalized.invocationReceiptDigest))
    || (normalized.workSnapshotDigest && !validDigest(normalized.workSnapshotDigest))
    || (normalized.phase === 'compiled'
      && (!normalized.invocationReceiptDigest || !normalized.workSnapshotDigest))) return null;
  if (digest(normalized) !== receiptDigest) return null;
  return { ...normalized, receiptDigest };
}

function normalizeCreatorWorkSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== CREATOR_WORK_SNAPSHOT_SCHEMA) return null;
  const normalized = {
    schema: CREATOR_WORK_SNAPSHOT_SCHEMA,
    workId: boundedText(value.workId, 80),
    revision: Math.max(1, Math.trunc(Number(value.revision) || 0)),
    taskProfile: normalizeTaskProfile(
      value.taskProfile,
      normalizeFamily(value.taskProfile?.family),
      normalizeQualityMode(value.taskProfile?.qualityMode),
    ),
    artifactVersionIds: [...new Set((Array.isArray(value.artifactVersionIds)
      ? value.artifactVersionIds : []).map((item) => boundedText(item, 80)).filter(Boolean))],
    changedArtifactIds: [...new Set((Array.isArray(value.changedArtifactIds)
      ? value.changedArtifactIds : []).map((item) => boundedText(item, 80)).filter(Boolean))],
    invalidatedKinds: [...new Set((Array.isArray(value.invalidatedKinds)
      ? value.invalidatedKinds : []).map((item) => boundedText(item, 80)).filter(Boolean))],
    updatedAt: boundedText(value.updatedAt, 80),
  };
  const workDigest = boundedText(value.workDigest, 64).toLowerCase();
  if (!/^cw_[a-f0-9]{32}$/u.test(normalized.workId)
    || !normalized.taskProfile || !normalized.updatedAt
    || normalized.artifactVersionIds.some((id) => !/^cwav_[a-f0-9]{32}$/u.test(id))
    || normalized.changedArtifactIds.some((id) => !/^cwa_[a-f0-9]{32}$/u.test(id))
    || !validDigest(workDigest) || digest(normalized) !== workDigest) return null;
  return { ...normalized, workDigest };
}

function invalidationClosure(changedKinds) {
  const invalidated = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [kind, dependencies] of Object.entries(DEPENDENCY_KINDS)) {
      if (changedKinds.has(kind) || invalidated.has(kind)) continue;
      if ((dependencies || []).some((dependency) => changedKinds.has(dependency)
        || invalidated.has(dependency))) {
        invalidated.add(kind);
        changed = true;
      }
    }
  }
  return [...invalidated].sort();
}

/**
 * Commit a bounded set of server-authoritative scoped artifacts without
 * asking the model to rewrite every sibling shard.  This is used by Creator
 * V2 long-form work after the LLM turn itself has succeeded.  The caller must
 * persist createdVersions and snapshot in one database transaction.
 */
function createScopedWorkArtifactMutation(input = {}) {
  const sessionId = boundedText(input.sessionId, 160);
  const existing = normalizeWorkArtifactVersions(input.existingVersions);
  const existingSnapshot = normalizeCreatorWorkSnapshot(input.existingSnapshot);
  const expectedWorkRevision = input.expectedWorkRevision == null
    ? existingSnapshot?.revision || 0
    : Math.max(0, Math.trunc(Number(input.expectedWorkRevision) || 0));
  if (!sessionId || expectedWorkRevision !== (existingSnapshot?.revision || 0)) {
    return {
      status: 'blocked', code: 'work-snapshot-stale', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const taskProfile = normalizeTaskProfile(
    input.taskProfile || existingSnapshot?.taskProfile,
    normalizeFamily(input.taskProfile?.family || existingSnapshot?.taskProfile?.family),
    normalizeQualityMode(input.taskProfile?.qualityMode || existingSnapshot?.taskProfile?.qualityMode),
  );
  if (!taskProfile) {
    return {
      status: 'blocked', code: 'work-task-profile-invalid', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const requestedMutations = Array.isArray(input.mutations) ? input.mutations : [];
  if (requestedMutations.length > MAX_SCOPED_MUTATIONS) {
    return {
      status: 'blocked', code: 'work-scoped-mutation-limit', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const mutations = requestedMutations;
  if (!mutations.length) {
    return {
      status: 'reused', code: 'work-content-unchanged', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const latest = latestWorkArtifactVersions(existing);
  const latestByLogicalKey = new Map(latest.map((version) => [
    artifactLogicalKey(version.kind, version.scopeKey), version,
  ]));
  const normalizedMutations = mutations.map((mutation) => {
    const kind = boundedText(mutation?.kind, 80);
    const scopeKey = normalizeScopeKey(mutation?.scopeKey);
    const title = boundedText(mutation?.title, 200);
    const fields = normalizeFields(kind, mutation?.fields);
    const status = ['model-draft', 'creator-edited', 'accepted', 'rejected']
      .includes(boundedText(mutation?.status, 40))
      ? boundedText(mutation.status, 40)
      : 'creator-edited';
    const baseVersionId = boundedText(mutation?.baseVersionId, 80) || null;
    return kind && ARTIFACT_FIELDS[kind] && title && fields ? {
      kind, scopeKey, title, fields, status, baseVersionId,
      source: mutation?.source && typeof mutation.source === 'object' ? mutation.source : {},
    } : null;
  });
  if (normalizedMutations.some((mutation) => mutation == null)) {
    return {
      status: 'blocked', code: 'work-scoped-mutation-invalid', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const logicalKeys = normalizedMutations.map((mutation) => artifactLogicalKey(
    mutation.kind, mutation.scopeKey,
  ));
  if (new Set(logicalKeys).size !== logicalKeys.length) {
    return {
      status: 'blocked', code: 'work-scoped-mutation-duplicate', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const now = boundedText(input.createdAt, 80) || new Date().toISOString();
  const createdVersions = [];
  for (const mutation of normalizedMutations) {
    const logicalKey = artifactLogicalKey(mutation.kind, mutation.scopeKey);
    const previous = latestByLogicalKey.get(logicalKey) || null;
    if ((previous?.versionId || null) !== mutation.baseVersionId) {
      return {
        status: 'blocked', code: 'work-artifact-stale', versions: existing,
        createdVersions: [], snapshot: existingSnapshot,
        blockedScopeKey: mutation.scopeKey,
      };
    }
    const operations = diffFields(previous?.fields || {}, mutation.fields);
    if (previous && previous.title !== mutation.title) {
      operations.unshift({
        op: 'replace', path: '/title', beforeDigest: digest(previous.title),
        afterDigest: digest(mutation.title),
      });
    }
    const lockedViolation = operations.find((operation) => previous?.fieldLocks?.includes(operation.path));
    if (lockedViolation) {
      return {
        status: 'blocked', code: 'work-field-locked', versions: existing,
        createdVersions: [], snapshot: existingSnapshot,
        blockedScopeKey: mutation.scopeKey, blockedPath: lockedViolation.path,
      };
    }
    if (previous && !operations.length && previous.status === mutation.status) continue;
    const identityPayload = mutation.scopeKey === ROOT_SCOPE_KEY
      ? { schema: 't8-creator-work-artifact-id-v1', sessionId, kind: mutation.kind }
      : {
          schema: 't8-creator-work-artifact-id-v1', sessionId,
          kind: mutation.kind, scopeKey: mutation.scopeKey,
        };
    const artifactId = previous?.artifactId
      || `cwa_${digest(identityPayload).slice(0, 32)}`;
    const revision = (previous?.revision || 0) + 1;
    const source = {
      responseId: boundedText(mutation.source.responseId, 160) || null,
      logicalRequestId: boundedText(mutation.source.logicalRequestId, 160) || null,
      llmTurnReceiptDigest: validDigest(mutation.source.llmTurnReceiptDigest)
        ? String(mutation.source.llmTurnReceiptDigest).toLowerCase() : null,
      proposalDigest: validDigest(mutation.source.proposalDigest)
        ? String(mutation.source.proposalDigest).toLowerCase() : null,
      editor: boundedText(mutation.source.editor, 40) || 'creator-v2',
    };
    const versionId = `cwav_${digest({
      schema: CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
      artifactId, revision, scopeKey: mutation.scopeKey, fields: mutation.fields, source,
    }).slice(0, 32)}`;
    const next = {
      schema: CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
      artifactId,
      versionId,
      revision,
      kind: mutation.kind,
      ...(mutation.scopeKey === ROOT_SCOPE_KEY ? {} : { scopeKey: mutation.scopeKey }),
      title: mutation.title,
      status: mutation.status,
      fields: mutation.fields,
      fieldLocks: previous?.fieldLocks || [],
      dependencies: previous?.dependencies || [],
      invalidates: previous?.invalidates || [],
      source,
      diff: {
        schema: CREATOR_WORK_ARTIFACT_DIFF_SCHEMA,
        baseVersionId: previous?.versionId || null,
        operations: operations.length ? operations : [{
          op: 'replace', path: '/status',
          ...(previous ? { beforeDigest: digest(previous.status) } : {}),
          afterDigest: digest(mutation.status),
        }],
      },
      createdAt: now,
    };
    next.versionDigest = digest(versionPayload(next));
    const verified = normalizeWorkArtifactVersion(next);
    if (!verified) {
      return {
        status: 'blocked', code: 'work-scoped-version-invalid', versions: existing,
        createdVersions: [], snapshot: existingSnapshot,
      };
    }
    createdVersions.push(verified);
    latestByLogicalKey.set(logicalKey, verified);
  }
  if (!createdVersions.length) {
    return {
      status: 'reused', code: 'work-content-unchanged', versions: existing,
      createdVersions: [], snapshot: existingSnapshot,
    };
  }
  const currentVersions = [...latestByLogicalKey.values()].sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || normalizeScopeKey(left.scopeKey).localeCompare(normalizeScopeKey(right.scopeKey))
  ));
  const nextVersions = normalizeWorkArtifactVersions([...existing, ...createdVersions]);
  const snapshot = {
    schema: CREATOR_WORK_SNAPSHOT_SCHEMA,
    workId: existingSnapshot?.workId
      || `cw_${digest({ schema: CREATOR_WORK_SNAPSHOT_SCHEMA, sessionId }).slice(0, 32)}`,
    revision: (existingSnapshot?.revision || 0) + 1,
    taskProfile,
    artifactVersionIds: currentVersions.map((version) => version.versionId),
    changedArtifactIds: createdVersions.map((version) => version.artifactId),
    invalidatedKinds: [...new Set((Array.isArray(input.invalidatedKinds)
      ? input.invalidatedKinds : []).map((kind) => boundedText(kind, 80)).filter(Boolean))].sort(),
    updatedAt: now,
  };
  snapshot.workDigest = digest(snapshot);
  return {
    status: 'created', code: 'work-version-created', versions: nextVersions,
    createdVersions, snapshot,
  };
}

function compileCreatorWorkProposal(input = {}) {
  const proposal = normalizeCreatorWorkProposal(input.proposal);
  const evidence = input.responseEvidence;
  if (!proposal) return { status: 'failed', code: 'work-proposal-invalid', versions: [], snapshot: null };
  if (evidence?.mode !== 'online-model'
    || evidence?.status !== 'completed'
    || Math.max(0, Math.trunc(Number(evidence?.providerCalls) || 0)) < 1) {
    return { status: 'blocked', code: 'formal-work-requires-llm', versions: [], snapshot: null };
  }
  const sessionId = boundedText(input.sessionId, 160);
  const responseId = boundedText(input.responseId, 160);
  const logicalRequestId = boundedText(input.logicalRequestId, 160);
  const llmTurnReceiptDigest = boundedText(input.llmTurnReceiptDigest, 64).toLowerCase();
  if (!sessionId || !responseId || !logicalRequestId || !validDigest(llmTurnReceiptDigest)) {
    return { status: 'failed', code: 'work-source-binding-invalid', versions: [], snapshot: null };
  }
  const existing = normalizeWorkArtifactVersions(input.existingVersions);
  const existingSnapshot = normalizeCreatorWorkSnapshot(input.existingSnapshot);
  const mutationScope = input.mutationScope?.restricted === true
    ? {
        restricted: true,
        allowedPaths: [...new Set((Array.isArray(input.mutationScope.allowedPaths)
          ? input.mutationScope.allowedPaths : [])
          .map((item) => boundedText(item, 240))
          .filter((item) => /^\/[A-Za-z][A-Za-z0-9]*\/(?:title|fields\/[A-Za-z][A-Za-z0-9]*)$/u.test(item)))],
        preserveArrayPrefixes: [...new Set((Array.isArray(input.mutationScope.preserveArrayPrefixes)
          ? input.mutationScope.preserveArrayPrefixes : [])
          .map((item) => boundedText(item, 240))
          .filter((item) => /^\/[A-Za-z][A-Za-z0-9]*\/fields\/(?:shots|frames|prompts)$/u.test(item)))],
      }
    : { restricted: false, allowedPaths: [], preserveArrayPrefixes: [] };
  const latestVersions = latestWorkArtifactVersions(existing);
  const latestByLogicalKey = new Map(latestVersions.map((version) => [
    artifactLogicalKey(version.kind, version.scopeKey), version,
  ]));
  const latestRootByKind = new Map(latestVersions
    .filter((version) => normalizeScopeKey(version.scopeKey) === ROOT_SCOPE_KEY)
    .map((version) => [version.kind, version]));
  const now = boundedText(input.createdAt, 80) || new Date().toISOString();
  const prepared = [];
  const changedKinds = new Set();
  for (const artifact of proposal.artifacts) {
    const scopeKey = normalizeScopeKey(artifact.scopeKey);
    const identityPayload = scopeKey === ROOT_SCOPE_KEY
      ? { schema: 't8-creator-work-artifact-id-v1', sessionId, kind: artifact.kind }
      : {
          schema: 't8-creator-work-artifact-id-v1', sessionId, kind: artifact.kind, scopeKey,
        };
    const artifactId = `cwa_${digest(identityPayload).slice(0, 32)}`;
    const previous = latestByLogicalKey.get(artifactLogicalKey(artifact.kind, scopeKey)) || null;
    const familyRequiredKinds = REQUIRED_KINDS[proposal.taskProfile.family]
      || REQUIRED_KINDS.mixed;
    const incrementalProposal = Array.isArray(proposal.requiredKinds)
      && (proposal.requiredKinds.length < familyRequiredKinds.length
        || proposal.requiredKinds.some((kind) => !familyRequiredKinds.includes(kind)));
    const incomingFields = { ...artifact.fields };
    if (previous && incrementalProposal && mutationScope.restricted) {
      for (const qualifiedPath of mutationScope.preserveArrayPrefixes) {
        const [, kind, , field] = qualifiedPath.split('/');
        if (kind !== artifact.kind) continue;
        const before = previous.fields?.[field];
        const incoming = incomingFields[field];
        if (Array.isArray(before) && before.length > 0
          && Array.isArray(incoming) && incoming.length === 1) {
          incomingFields[field] = [...before.slice(0, -1), incoming[0]];
        }
      }
    }
    const nextFields = previous && incrementalProposal
      ? { ...previous.fields, ...incomingFields }
      : incomingFields;
    if (previous && mutationScope.restricted) {
      const preservedPrefixViolation = mutationScope.preserveArrayPrefixes.find((qualifiedPath) => {
        const [, kind, , field] = qualifiedPath.split('/');
        if (kind !== artifact.kind) return false;
        const before = previous.fields?.[field];
        const after = nextFields?.[field];
        if (!Array.isArray(before) || !Array.isArray(after)) return true;
        if (before.length !== after.length || before.length === 0) return true;
        return stableString(before.slice(0, -1)) !== stableString(after.slice(0, -1));
      });
      if (preservedPrefixViolation) {
        return {
          status: 'blocked',
          code: 'work-array-prefix-out-of-scope',
          blockedArtifactId: artifactId,
          blockedPath: preservedPrefixViolation.replace(`/${artifact.kind}`, ''),
          versions: existing,
          snapshot: null,
        };
      }
    }
    const operations = diffFields(previous?.fields || {}, nextFields);
    if (previous && previous.title !== artifact.title) {
      operations.unshift({
        op: 'replace',
        path: '/title',
        beforeDigest: digest(previous.title),
        afterDigest: digest(artifact.title),
      });
    }
    const lockedViolation = operations.find((operation) => previous?.fieldLocks?.includes(operation.path));
    if (lockedViolation) {
      return {
        status: 'blocked',
        code: 'work-field-locked',
        blockedArtifactId: artifactId,
        blockedPath: lockedViolation.path,
        versions: [],
        snapshot: null,
      };
    }
    if (previous && operations.length === 0) {
      prepared.push(previous);
      continue;
    }
    if (previous && mutationScope.restricted) {
      const allowed = new Set(mutationScope.allowedPaths);
      const outOfScope = operations.find((operation) => {
        const qualifiedPath = operation.path === '/title'
          ? `/${artifact.kind}/title`
          : `/${artifact.kind}${operation.path}`;
        return !allowed.has(qualifiedPath);
      });
      if (outOfScope) {
        return {
          status: 'blocked',
          code: 'work-mutation-out-of-scope',
          blockedArtifactId: artifactId,
          blockedPath: outOfScope.path,
          versions: existing,
          snapshot: null,
        };
      }
    }
    changedKinds.add(artifact.kind);
    const revision = (previous?.revision || 0) + 1;
    const versionId = `cwav_${digest({
      schema: CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
      artifactId,
      revision,
      fields: nextFields,
      proposalDigest: proposal.proposalDigest,
    }).slice(0, 32)}`;
    prepared.push({
      schema: CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
      artifactId,
      versionId,
      revision,
      kind: artifact.kind,
      ...(scopeKey === ROOT_SCOPE_KEY ? {} : { scopeKey }),
      title: artifact.title,
      status: 'model-draft',
      fields: nextFields,
      fieldLocks: previous?.fieldLocks || [],
      dependencies: [],
      invalidates: [],
      source: {
        responseId,
        logicalRequestId,
        llmTurnReceiptDigest,
        proposalDigest: proposal.proposalDigest,
        editor: 'llm',
      },
      diff: {
        schema: CREATOR_WORK_ARTIFACT_DIFF_SCHEMA,
        baseVersionId: previous?.versionId || null,
        operations: operations.length ? operations : [{
          op: 'add', path: '/fields', afterDigest: digest(artifact.fields),
        }],
      },
      createdAt: now,
    });
  }
  const currentByLogicalKey = new Map(latestByLogicalKey);
  prepared.forEach((version) => currentByLogicalKey.set(
    artifactLogicalKey(version.kind, version.scopeKey), version,
  ));
  const invalidates = invalidationClosure(changedKinds);
  const finalizedByArtifactId = new Map();
  const finalizingArtifactIds = new Set();
  const finalizeVersion = (value) => {
    if (value.versionDigest) return value;
    if (finalizedByArtifactId.has(value.artifactId)) return finalizedByArtifactId.get(value.artifactId);
    if (finalizingArtifactIds.has(value.artifactId)) {
      throw new Error(`work-dependency-cycle:${value.kind}:${normalizeScopeKey(value.scopeKey)}`);
    }
    finalizingArtifactIds.add(value.artifactId);
    const valueScopeKey = normalizeScopeKey(value.scopeKey);
    const artifact = proposal.artifacts.find((item) => (
      item.kind === value.kind && normalizeScopeKey(item.scopeKey) === valueScopeKey
    ));
    const dependencies = (artifact?.dependsOnKinds || DEPENDENCY_KINDS[value.kind] || [])
      .map((kind) => currentByLogicalKey.get(artifactLogicalKey(kind, valueScopeKey))
        || latestRootByKind.get(kind))
      .filter(Boolean)
      .map((dependency) => finalizeVersion(dependency))
      .map((dependency) => ({
        artifactId: dependency.artifactId,
        versionId: dependency.versionId,
        versionDigest: dependency.versionDigest,
        kind: dependency.kind,
      }));
    const normalized = {
      ...value,
      dependencies,
      invalidates: invalidates.filter((kind) => kind !== value.kind),
    };
    normalized.versionDigest = digest(versionPayload(normalized));
    finalizingArtifactIds.delete(value.artifactId);
    finalizedByArtifactId.set(value.artifactId, normalized);
    return normalized;
  };
  let created;
  try {
    created = prepared.map(finalizeVersion);
  } catch {
    return { status: 'failed', code: 'work-dependency-invalid', versions: existing, snapshot: null };
  }
  const createdOnly = created.filter((version) => !existing.some(
    (current) => current.versionId === version.versionId,
  ));
  const nextVersions = normalizeWorkArtifactVersions([...existing, ...createdOnly]);
  const latest = latestWorkArtifactVersions(nextVersions);
  const workId = existingSnapshot?.workId
    || `cw_${digest({ schema: CREATOR_WORK_SNAPSHOT_SCHEMA, sessionId }).slice(0, 32)}`;
  const artifactVersionIds = latest.map((version) => version.versionId);
  const unchangedSnapshot = existingSnapshot
    && createdOnly.length === 0
    && stableString(existingSnapshot.taskProfile) === stableString(proposal.taskProfile)
    && stableString(existingSnapshot.artifactVersionIds) === stableString(artifactVersionIds);
  if (unchangedSnapshot) {
    return {
      status: 'reused',
      code: 'work-content-unchanged',
      versions: nextVersions,
      createdVersions: [],
      snapshot: existingSnapshot,
    };
  }
  // Work revision is a monotonic aggregate version. It must advance whenever
  // any child artifact or the task profile changes, even if the edited child
  // revision is lower than another artifact's revision.
  const revision = existingSnapshot ? existingSnapshot.revision + 1 : 1;
  const snapshot = {
    schema: CREATOR_WORK_SNAPSHOT_SCHEMA,
    workId,
    revision,
    taskProfile: proposal.taskProfile,
    artifactVersionIds,
    changedArtifactIds: createdOnly.map((version) => version.artifactId),
    invalidatedKinds: invalidates,
    updatedAt: now,
  };
  snapshot.workDigest = digest(snapshot);
  return {
    status: createdOnly.length ? 'created' : 'reused',
    code: createdOnly.length ? 'work-version-created' : 'work-content-unchanged',
    versions: nextVersions,
    createdVersions: createdOnly,
    snapshot,
  };
}

function createCreatorLlmTurnReceipt(input = {}) {
  const evidence = input.responseEvidence || {};
  const calls = (Array.isArray(evidence.calls) ? evidence.calls : [])
    .slice(0, 8)
    .map((call, index) => ({
      index,
      role: boundedText(call?.role, 40) || (index === 0 ? 'draft' : 'refine'),
      status: boundedText(call?.status, 40) || 'completed',
      provider: boundedText(call?.provider, 160) || boundedText(evidence.provider, 160),
      model: boundedText(call?.model, 240) || boundedText(evidence.model, 240),
      requestId: boundedText(call?.requestId, 240) || null,
      finishReason: boundedText(call?.finishReason, 120) || null,
    }));
  const providerCalls = Math.max(0, Math.trunc(Number(evidence.providerCalls) || calls.length));
  const value = {
    schema: CREATOR_LLM_TURN_RECEIPT_SCHEMA,
    sessionId: boundedText(input.sessionId, 160),
    responseId: boundedText(input.responseId, 160),
    logicalRequestId: boundedText(input.logicalRequestId, 160),
    phase: input.phase === 'compiled' ? 'compiled' : 'invocation',
    status: boundedText(evidence.status, 40) || 'failed',
    qualityMode: normalizeQualityMode(input.qualityMode),
    providerCalls,
    provider: boundedText(evidence.provider, 160) || null,
    model: boundedText(evidence.model, 240) || null,
    modelDecisionDigest: boundedText(evidence.modelDecisionDigest, 64).toLowerCase() || null,
    promptContractDigest: boundedText(evidence.promptContractDigest, 64).toLowerCase() || null,
    mediaObservationDigest: boundedText(evidence.mediaGrounding?.observationDigest, 64).toLowerCase() || null,
    calls,
    workProposalDigest: boundedText(input.workProposalDigest, 64).toLowerCase() || null,
    invocationReceiptDigest: boundedText(input.invocationReceiptDigest, 64).toLowerCase() || null,
    inputBindings: normalizeReceiptInputBindings(input.inputBindings),
    artifactBindings: normalizeReceiptArtifactBindings(input.artifactBindings),
    workSnapshotDigest: boundedText(input.workSnapshotDigest, 64).toLowerCase() || null,
    createdAt: boundedText(input.createdAt, 80) || new Date().toISOString(),
  };
  value.receiptDigest = digest(value);
  return value;
}

function reviseWorkArtifact(input = {}) {
  const versions = normalizeWorkArtifactVersions(input.existingVersions);
  const latest = latestWorkArtifactVersions(versions)
    .find((version) => version.artifactId === boundedText(input.artifactId, 80));
  if (!latest || latest.versionId !== boundedText(input.baseVersionId, 80)) {
    return { status: 'blocked', code: 'work-artifact-stale', versions, artifactVersion: null };
  }
  const action = boundedText(input.action, 40);
  const field = boundedText(input.field, 120);
  const path = `/fields/${field}`;
  if (['edit', 'lock', 'unlock'].includes(action)
    && !(ARTIFACT_FIELDS[latest.kind] || []).includes(field)) {
    return { status: 'blocked', code: 'work-field-invalid', versions, artifactVersion: null };
  }
  const nextFields = { ...latest.fields };
  const nextLocks = new Set(latest.fieldLocks || []);
  const operations = [];
  if (action === 'lock' || action === 'unlock') {
    if (action === 'lock') nextLocks.add(path); else nextLocks.delete(path);
    if (nextLocks.has(path) === (latest.fieldLocks || []).includes(path)) {
      return { status: 'reused', code: 'work-field-lock-unchanged', versions, artifactVersion: latest };
    }
    operations.push({ op: action, path: `/fieldLocks/${field}` });
  } else if (action === 'edit') {
    // A creator may always correct their own field. The lock is preserved and
    // only blocks subsequent model-authored mutations.
    let normalized;
    try { normalized = normalizeJsonValue(input.value); } catch { normalized = undefined; }
    if (normalized === undefined || secretLeakReason(normalized)) {
      return { status: 'blocked', code: 'work-field-value-invalid', versions, artifactVersion: null };
    }
    const beforeExists = Object.prototype.hasOwnProperty.call(nextFields, field);
    if (beforeExists && stableString(nextFields[field]) === stableString(normalized)) {
      return { status: 'reused', code: 'work-field-unchanged', versions, artifactVersion: latest };
    }
    operations.push({
      op: beforeExists ? 'replace' : 'add',
      path,
      ...(beforeExists ? { beforeDigest: digest(nextFields[field]) } : {}),
      afterDigest: digest(normalized),
    });
    nextFields[field] = normalized;
  } else if (action === 'accept' || action === 'reject') {
    if ((action === 'accept' && latest.status === 'accepted')
      || (action === 'reject' && latest.status === 'rejected')) {
      return { status: 'reused', code: `work-${action}-unchanged`, versions, artifactVersion: latest };
    }
    operations.push({
      op: 'replace',
      path: '/status',
      beforeDigest: digest(latest.status),
      afterDigest: digest(action === 'accept' ? 'accepted' : 'rejected'),
    });
  } else {
    return { status: 'blocked', code: 'work-action-invalid', versions, artifactVersion: null };
  }
  const revision = latest.revision + 1;
  const createdAt = boundedText(input.createdAt, 80) || new Date().toISOString();
  const next = {
    ...latest,
    versionId: `cwav_${digest({
      schema: CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
      artifactId: latest.artifactId,
      revision,
      action,
      field,
      value: action === 'edit' ? nextFields[field] : null,
      locks: [...nextLocks].sort(),
    }).slice(0, 32)}`,
    revision,
    status: action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'creator-edited',
    fields: nextFields,
    fieldLocks: [...nextLocks].sort(),
    source: {
      responseId: null,
      logicalRequestId: null,
      llmTurnReceiptDigest: null,
      proposalDigest: null,
      editor: boundedText(input.actor, 40) || 'creator',
    },
    diff: {
      schema: CREATOR_WORK_ARTIFACT_DIFF_SCHEMA,
      baseVersionId: latest.versionId,
      operations,
    },
    createdAt,
  };
  next.versionDigest = digest(versionPayload(next));
  const nextVersions = normalizeWorkArtifactVersions([...versions, next]);
  return { status: 'created', code: `work-${action}-created`, versions: nextVersions, artifactVersion: next };
}

module.exports = {
  ARTIFACT_FIELDS,
  CREATOR_LLM_TURN_RECEIPT_SCHEMA,
  CREATOR_WORK_ARTIFACT_DIFF_SCHEMA,
  CREATOR_WORK_ARTIFACT_VERSION_SCHEMA,
  CREATOR_WORK_PROPOSAL_SCHEMA,
  CREATOR_WORK_SNAPSHOT_SCHEMA,
  REQUIRED_KINDS,
  compileCreatorWorkProposal,
  createScopedWorkArtifactMutation,
  creatorWorkMutationScope,
  createCreatorLlmTurnReceipt,
  createCreatorWorkProposal,
  latestWorkArtifactVersions,
  normalizeFamily,
  normalizeQualityMode,
  normalizeScopeKey,
  normalizeWorkArtifactVersion,
  normalizeWorkArtifactVersions,
  normalizeCreatorWorkProposal,
  normalizeCreatorLlmTurnReceipt,
  normalizeCreatorWorkSnapshot,
  reviseWorkArtifact,
  workArtifactSummaries,
};
