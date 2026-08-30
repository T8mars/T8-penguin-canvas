const crypto = require('node:crypto');
const fs = require('node:fs');
const { generateChatWithProvider } = require('../providers/adapters');
const { normalizeAdvancedProviders } = require('../providers/registry');
const { createCreatorArtifactProposal } = require('./creatorAgentArtifacts');
const { creatorDecisionPromptContract } = require('./creatorAgentDecisions');
const {
  ARTIFACT_FIELDS,
  REQUIRED_KINDS,
  createCreatorWorkProposal,
  creatorWorkMutationScope,
  latestWorkArtifactVersions,
  normalizeQualityMode,
} = require('./creatorAgentWorkArtifacts');
const {
  normalizeCreatorAudioObservation,
} = require('./creatorAgentMediaGrounding');
const {
  publicVersionedCapabilityToolCatalog,
} = require('./agentControlCapabilityTools');

const CREATOR_RESPONSE_EVIDENCE_SCHEMA = 't8-creator-agent-response-evidence-v1';
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_TEXT = 4_000;
const MAX_PROMPT_TEXT = 20_000;
const CREATOR_STRUCTURED_RESPONSE_SCHEMA = 't8-creator-work-model-response-v1';

// Keep the model-facing catalog focused on fields that materially advance the
// work. The durable artifact schema remains intentionally broader so older
// versions and explicit user edits stay compatible.
const COMPACT_PROMPT_FIELDS = Object.freeze({
  ProductionBrief: [
    'title', 'outcome', 'audience', 'format', 'durationSeconds', 'aspectRatio',
    'style', 'tone', 'language', 'constraints', 'assumptions', 'unknowns',
  ],
  TaskProfile: [
    'family', 'intent', 'deliveryKind', 'modalities', 'targetPlatform',
    'qualityMode', 'scope',
  ],
  CreativeDirectionSet: ['directions', 'recommendedDirectionId', 'selectionReason', 'risks'],
  ProductTruth: ['facts', 'claimsToAvoid', 'sourceBindings', 'unknowns'],
  BrandKit: [
    'brandVoice', 'palette', 'typography', 'logoRules', 'mandatoryElements',
    'forbiddenElements', 'constraints',
  ],
  CommerceContentPlan: ['channels', 'contentUnits', 'storyArc', 'assetNeeds', 'complianceNotes'],
  CopySet: ['headlines', 'subheads', 'body', 'cta', 'disclaimers', 'variants'],
  VisualSpec: [
    'composition', 'subject', 'environment', 'lighting', 'color', 'palette',
    'materials', 'textTreatment', 'references', 'negativeRules', 'constraints',
  ],
  LayoutSpec: ['canvas', 'grid', 'hierarchy', 'safeAreas', 'placements', 'variants'],
  EditPlan: ['preserve', 'change', 'remove', 'add', 'steps', 'maskNotes', 'qualityChecks'],
  ScriptDoc: [
    'title', 'logline', 'theme', 'synopsis', 'characters', 'acts', 'scenes',
    'dialogue', 'ending', 'assumptions', 'unknowns', 'constraints',
  ],
  WorldBible: ['premise', 'locations', 'rules', 'timeline', 'continuity', 'assumptions', 'unknowns'],
  CharacterBible: [
    'characters', 'identityLocks', 'relationships', 'wardrobe', 'continuity',
    'assumptions', 'unknowns',
  ],
  ShotList: ['shots', 'totalDurationSeconds', 'continuityRules', 'coverage', 'constraints'],
  Storyboard: ['frames', 'styleContinuity', 'missingFrames'],
  MotionPlan: ['beats', 'camera', 'motion', 'transitions', 'timing', 'continuity'],
  AudioPlan: ['tracks', 'cues', 'dialogue', 'voiceover', 'music', 'ambience', 'sfx', 'mixNotes'],
  AssetNeed: ['items', 'existing', 'missing', 'protected', 'assumptions', 'unknowns'],
  PromptPack: ['prompts', 'negativePrompts', 'referenceBindings', 'modelHints', 'reviewNotes'],
  CandidateReview: ['candidates', 'criteria', 'hardGates', 'adoptions'],
  EDL: ['sequence', 'transitions', 'audioLayers', 'durationSeconds'],
  QCReport: ['checks', 'failures', 'warnings', 'verifiedArtifacts'],
  DeliveryManifest: ['deliverables', 'formats', 'licenses', 'verification'],
});

function boundedText(value, maximum = 2_000) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maximum);
}

function boundedResponseText(value, maximum = 80_000) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .slice(0, maximum);
}
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

function readSettings(settingsFile) {
  const file = boundedText(settingsFile, 2_000);
  if (!file) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function selectedLlmDecision(modelDecisionReceipt) {
  const decisions = Array.isArray(modelDecisionReceipt?.decisions)
    ? modelDecisionReceipt.decisions : [];
  return decisions.find((decision) => decision?.kind === 'llm') || null;
}

function providerForDecision(decision, settings, config = {}) {
  const providerId = boundedText(decision?.selected?.provider, 160);
  const model = boundedText(decision?.selected?.model, 240);
  if (!providerId || !model || decision?.status !== 'ready' || decision?.selected?.executable !== true) {
    return null;
  }
  if (providerId === 'zhenzhen') {
    const apiKey = boundedText(settings.llmApiKey || settings.zhenzhenApiKey, 4_000);
    if (!apiKey) return null;
    return {
      id: providerId,
      label: '贞贞的AI工坊',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey,
      baseUrl: boundedText(
        settings.llmBaseUrl || settings.zhenzhenBaseUrl || config.ZHENZHEN_BASE_URL,
        2_000,
      ),
      chatModels: [model],
      defaults: {
        chatModel: model,
        chatEndpoint: '/v1/chat/completions',
      },
    };
  }
  if (providerId === 'seedance-nz') {
    const apiKey = boundedText(settings.zhenzhenSd2ApiKey, 4_000);
    if (!apiKey) return null;
    return {
      id: providerId,
      label: '贞贞的平价AI小屋',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey,
      baseUrl: boundedText(
        settings.zhenzhenSd2BaseUrl || config.ZHENZHEN_SD2_BASE_URL,
        2_000,
      ),
      chatModels: [model],
      defaults: {
        chatModel: model,
        chatEndpoint: '/v1/chat/completions',
      },
    };
  }
  const advanced = normalizeAdvancedProviders(settings.advancedProviders);
  const provider = advanced.find((item) => item.id === providerId && item.enabled);
  if (!provider || !boundedText(provider.apiKey, 4_000)) return null;
  return {
    ...provider,
    chatModels: [...new Set([model, ...(Array.isArray(provider.chatModels) ? provider.chatModels : [])])],
    defaults: {
      ...(provider.defaults || {}),
      chatModel: model,
    },
  };
}

function taskFamily(input = {}) {
  const kind = boundedText(input.kind, 40).toLowerCase();
  const prompt = boundedText(input.prompt, MAX_PROMPT_TEXT);
  if (/电商|商品|主图|详情页|卖点|品牌|海报|广告|tvc|投放/u.test(prompt)) return 'commerce';
  if (['story', 'script'].includes(kind)) return 'story';
  if (['edit-image', 'image'].includes(kind)) return 'image';
  if (['edit-video', 'video'].includes(kind)) return 'video';
  if (kind === 'audio') return 'audio';
  return 'mixed';
}

function requestedQualityMode(input = {}) {
  const explicit = boundedText(input.qualityMode, 32).toLowerCase();
  // Older callers keep their historical single-call behavior. The Canvas UI
  // sends `standard`, which is the product default for new work.
  return explicit ? normalizeQualityMode(explicit) : 'quick';
}

function qualityModeCallCount(value) {
  const mode = normalizeQualityMode(value);
  return mode === 'quality' ? 3 : mode === 'standard' ? 2 : 1;
}

const STORY_STAGE_WORK_KINDS = Object.freeze({
  idea: ['ProductionBrief', 'TaskProfile'],
  script: ['ScriptDoc', 'WorldBible'],
  assets: ['CharacterBible', 'AssetNeed'],
  shots: ['ShotList', 'Storyboard', 'AudioPlan', 'PromptPack'],
  candidates: ['CandidateReview'],
  delivery: ['EDL', 'QCReport', 'DeliveryManifest'],
});

function creatorStructuredRequiredKinds(input = {}) {
  const family = taskFamily(input);
  const full = REQUIRED_KINDS[family] || REQUIRED_KINDS.mixed;
  const latest = latestWorkArtifactVersions(input.session?.workArtifactVersions);
  if (!latest.length) return full;
  const mutationScope = creatorWorkMutationScope(input.prompt, latest);
  if (mutationScope.restricted && mutationScope.allowedPaths.length) {
    const kinds = [...new Set(mutationScope.allowedPaths.map((path) => (
      String(path).split('/').filter(Boolean)[0]
    )).filter((kind) => Object.prototype.hasOwnProperty.call(ARTIFACT_FIELDS, kind)))];
    if (kinds.length) return kinds;
  }
  if (family === 'story' && input.stageContinuation === true) {
    const stageKinds = STORY_STAGE_WORK_KINDS[productionPhase(input)] || [];
    const kinds = stageKinds.filter((kind) => (
      Object.prototype.hasOwnProperty.call(ARTIFACT_FIELDS, kind)
    ));
    if (kinds.length) return kinds;
  }
  return full;
}

function creatorCurrentWorkContract(input = {}) {
  const latest = latestWorkArtifactVersions(input.session?.workArtifactVersions);
  if (!latest.length) return '当前没有已建立的结构化作品版本，本轮是正式作品首版。';
  const mutationScope = creatorWorkMutationScope(input.prompt, latest);
  const requiredKinds = new Set(creatorStructuredRequiredKinds(input));
  const scopedLatest = requiredKinds.size < latest.length
    ? latest.filter((version) => requiredKinds.has(version.kind))
    : latest;
  const currentWork = scopedLatest.map((version) => ({
    artifactId: version.artifactId,
    versionId: version.versionId,
    revision: version.revision,
    kind: version.kind,
    title: version.title,
    status: version.status,
    fields: version.fields,
    fieldLocks: version.fieldLocks,
    dependencies: version.dependencies.map((dependency) => ({
      kind: dependency.kind,
      versionId: dependency.versionId,
      versionDigest: dependency.versionDigest,
    })),
  }));
  const serialized = boundedResponseText(stableString(currentWork), 64_000);
  return [
    '以下是当前权威作品版本。必须基于它修改，不得把旧聊天正文当作权威数据。',
    `当前作品：${serialized}`,
    mutationScope.restricted
      ? mutationScope.allowedPaths.length
        ? `用户明确要求局部修改；本轮只允许改变：${mutationScope.allowedPaths.join('、')}。其他字段必须逐字保持，服务端会拒绝越界变化。`
        : '用户明确要求局部修改，但系统无法安全识别允许字段；不得修改任何作品字段，应在 displayMarkdown 中明确说明无法定位字段。'
      : '本轮没有“只修改”限制；仍必须保持全部 fieldLocks，且只改变完成用户要求所必需的字段。',
  ].join('\n');
}

function creatorStructuredResponseContract(input = {}) {
  const family = taskFamily(input);
  const requiredKinds = creatorStructuredRequiredKinds(input);
  const fullKinds = REQUIRED_KINDS[family] || REQUIRED_KINDS.mixed;
  const partial = requiredKinds.length < fullKinds.length;
  const latest = latestWorkArtifactVersions(input.session?.workArtifactVersions);
  const mutationScope = creatorWorkMutationScope(input.prompt, latest);
  const allowedPathSet = new Set(mutationScope.allowedPaths);
  const allowedFields = Object.fromEntries(requiredKinds.map((kind) => [
    kind,
    mutationScope.restricted
      ? (ARTIFACT_FIELDS[kind] || []).filter((field) => (
          allowedPathSet.has(`/${kind}/fields/${field}`)
        ))
      : (COMPACT_PROMPT_FIELDS[kind] || ARTIFACT_FIELDS[kind] || []),
  ]));
  const exactTitleKinds = mutationScope.restricted
    ? requiredKinds.filter((kind) => !allowedPathSet.has(`/${kind}/title`))
    : [];
  return [
    '输出必须是一个 JSON 对象，不能使用 Markdown 代码围栏，也不能在 JSON 前后添加解释。',
    `schema 必须为“${CREATOR_STRUCTURED_RESPONSE_SCHEMA}”。`,
    '对象顶层只允许 schema、displayMarkdown、taskProfile、artifacts、toolProposals。',
    'displayMarkdown 是给创作者看的完整可编辑正文，必须有实质内容。',
    `taskProfile.family 必须为“${family}”，qualityMode 必须为“${requestedQualityMode(input)}”；intent、deliveryKind 不能为空，modalities 为字符串数组。`,
    partial
      ? `这是有界增量轮次。artifacts 只能包含且必须完整包含这些种类：${requiredKinds.join('、')}；其他作品类型由服务端逐字保留，禁止在本轮重发。`
      : `artifacts 必须至少包含并且种类唯一：${requiredKinds.join('、')}。`,
    mutationScope.restricted
      ? '这是稀疏字段补丁，不是完整文档重写。每个 artifact 的 fields 只能输出下方明确列出的字段；即使当前作品里还有其他字段，也禁止复制、总结或重发。服务端会把这些字段安全合并回当前权威版本。'
      : '每个 artifact 只允许 kind、title、fields、dependsOnKinds；fields 只能使用下方该 kind 对应的字段，不能增加其他键。',
    mutationScope.restricted && exactTitleKinds.length
      ? `这些 artifact 的 title 必须逐字复制当前权威值，不得改写：${exactTitleKinds.join('、')}。`
      : '',
    mutationScope.preserveArrayPrefixes?.length
      ? `用户只允许修改数组最后一项。下列字段在 fields 中必须各自只输出一个元素的数组，数组内唯一元素就是替换后的最后一项；禁止重发任何较早项目，服务端会把该元素安全拼接回原数组：${mutationScope.preserveArrayPrefixes.join('、')}。`
      : '',
    `${mutationScope.restricted ? '本轮唯一允许输出的字段' : '字段目录'}：${JSON.stringify(allowedFields)}`,
    '未知事实必须进入 assumptions 或 unknowns；不得为了填满字段而编造素材、商品、人物、品牌或执行结果。',
    creatorToolProposalContract(input),
  ].join('\n');
}

function creatorToolProposalContract(input = {}) {
  const kind = boundedText(input.kind, 80).toLowerCase().replace(/^edit-/u, '');
  const prompt = boundedText(input.prompt, MAX_PROMPT_TEXT);
  const wantsLocalization = /(?:本地化|多语(?:言)?|翻译(?:成|为|字幕)?|字幕翻译|配音|locali[sz](?:e|ation)|translate|dubb?ing|subtitles?)/iu.test(prompt);
  const toolByKind = Object.freeze({
    image: 'zcanvas_create_image',
    video: 'zcanvas_create_video',
    audio: 'zcanvas_create_audio',
    script: 'zcanvas_create_script',
    story: 'zcanvas_create_story',
  });
  const toolName = wantsLocalization ? 'zcanvas_localization_create' : toolByKind[kind] || '';
  const projectId = boundedText(input.projectId, 256);
  const canvasId = boundedText(input.canvasId, 256);
  if (!toolName || !projectId || !canvasId) {
    return 'toolProposals 必须返回空数组；当前没有与本轮作用域绑定的可提议高层能力。不得声称已经执行任何工具、画布写入或 Provider 生成。';
  }
  const catalog = publicVersionedCapabilityToolCatalog();
  const tool = catalog.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return 'toolProposals 必须返回空数组；当前能力版本没有匹配工具。不得声称已经执行任何工具、画布写入或 Provider 生成。';
  }
  const localizationLanguagePatterns = [
    ['ZH', /(?:中文|汉语|Chinese)/iu],
    ['EN', /(?:英文|英语|English)/iu],
    ['JA', /(?:日文|日语|Japanese)/iu],
    ['ES', /(?:西班牙文|西班牙语|Spanish)/iu],
    ['AR', /(?:阿拉伯文|阿拉伯语|Arabic)/iu],
  ];
  let targetLanguages = localizationLanguagePatterns
    .filter(([, pattern]) => pattern.test(prompt))
    .map(([language]) => language);
  if (wantsLocalization && /(?:五语|5\s*(?:种)?语言|five\s+languages)/iu.test(prompt)) {
    targetLanguages = ['ZH', 'EN', 'JA', 'ES', 'AR'];
  }
  if (wantsLocalization && targetLanguages.length === 0) targetLanguages = ['EN'];
  const localizationMode = /(?:仅|只要|只做).{0,6}字幕|subtitles?\s+only/iu.test(prompt)
    ? 'subtitle-only'
    : /(?:仅|只要|只做).{0,6}配音|dubb?ing\s+only/iu.test(prompt)
      ? 'dubbing-only'
      : 'full';
  const requestTemplate = {
    schema: 't8-versioned-creative-tool-request-v1',
    tool: tool.name,
    version: tool.version,
    operation: 'plan',
    projectId,
    canvasId,
    clientRequestId: boundedText(input.logicalRequestId, 256) || null,
    input: wantsLocalization ? {
      instruction: '用一句话概括本轮要准备的本地化目标；不得包含 API Key、URL、headers、节点数组、连线数组或 Canvas Patch。',
      targetLanguages,
      sourceLanguage: 'AUTO',
      mode: localizationMode,
    } : {
      prompt: '用一句话概括要基于本轮已完成作品准备的画布结构；不得包含 API Key、URL、headers、节点数组、连线数组或 Canvas Patch。',
    },
  };
  return [
    'toolProposals 只能表示尚未执行的高层能力提案；绝不能声称已写画布、调用 Provider 或生成素材。',
    '如果用户本轮明确要求创作、制作或生成该作品，返回且只返回 1 个提案；如果只要求解释、审阅或分析，则返回空数组。',
    '提案对象顶层只能有 schema、request；schema 必须为“t8-creator-model-tool-proposal-v1”。',
    wantsLocalization
      ? 'request 必须严格复制下面模板的 schema、tool、version、operation、projectId、canvasId、clientRequestId、input.targetLanguages、input.sourceLanguage 和 input.mode；只把 input.instruction 改写为本轮作品的一句话可见本地化目标。operation 只能是 plan，后续预览、确认、写入和运行由产品安全链处理。'
      : 'request 必须严格复制下面模板的 schema、tool、version、operation、projectId、canvasId、clientRequestId；只把 input.prompt 改写为本轮作品的一句话可见目标。operation 只能是 plan，后续预览、确认、写入和运行由产品安全链处理。',
    `唯一允许的 request 模板：${JSON.stringify(requestTemplate)}`,
  ].join('\n');
}

function extractStructuredJson(value) {
  const text = boundedResponseText(value);
  if (!text) return null;
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && parsed.schema === CREATOR_STRUCTURED_RESPONSE_SCHEMA) return parsed;
    } catch {
      // Continue with the next bounded candidate.
    }
  }
  return null;
}

function structuredModelResult(value, input = {}) {
  const parsed = extractStructuredJson(value);
  if (!parsed) return null;
  const proposal = createCreatorWorkProposal({
    modelValue: parsed,
    taskFamily: taskFamily(input),
    qualityMode: requestedQualityMode(input),
    requiredKinds: creatorStructuredRequiredKinds(input),
    logicalRequestId: input.logicalRequestId || input.clientRequestId,
  });
  if (!proposal) return null;
  return {
    parsed,
    proposal,
    displayMarkdown: proposal.displayMarkdown,
    toolProposals: Array.isArray(parsed.toolProposals) ? parsed.toolProposals.slice(0, 12) : [],
  };
}

function refinementMessages(prepared, priorRaw, passIndex, totalCalls) {
  const role = passIndex === totalCalls - 1 ? 'final-merger' : 'critic-refiner';
  return [
    ...prepared.messages,
    {
      role: 'assistant',
      content: boundedResponseText(priorRaw),
    },
    {
      role: 'user',
      content: [
        `你现在是本轮的 ${role}。这是第 ${passIndex + 1}/${totalCalls} 次已批准模型调用。`,
        '检查作品是否真正回应用户、事实与推断是否分离、跨文档是否一致、镜头/文案是否具体、字段是否符合 Schema。',
        '直接返回修订后的完整 JSON 对象；不要解释批评过程，不要省略已有合格内容，不得改变锁定事实或虚构执行结果。',
        creatorStructuredResponseContract({
          ...prepared.input,
          qualityMode: prepared.qualityMode,
        }),
      ].join('\n'),
    },
  ];
}

function productionPhase(input = {}) {
  const value = boundedText(input.session?.production?.currentPhase, 40).toLowerCase();
  return ['idea', 'script', 'assets', 'shots', 'candidates', 'delivery'].includes(value)
    ? value
    : 'idea';
}

function stagedStoryContract(input = {}) {
  if (taskFamily(input) !== 'story') return '';
  const phase = productionPhase(input);
  if (input.requireStructuredWork === true) {
    const requiredKinds = creatorStructuredRequiredKinds(input);
    const fullKinds = REQUIRED_KINDS.story;
    const incremental = requiredKinds.length < fullKinds.length;
    const phaseFocus = {
      idea: '首轮要先形成可以真正继续制作的完整 V0；若用户已明确要求剧本、镜头数、分镜或提示词，就在本轮直接交付，不得退回成问卷。',
      script: '本轮重点完善完整剧本，并保留已经确认的简报、人物、素材、镜头和提示词字段；不得无关重写。',
      assets: '本轮重点完善角色、服装、场景、道具和声音资产需求，并保留已确认上游与后续草案；不得擅自生成素材。',
      shots: '本轮重点交付逐镜镜头表、分镜、动作、声音、连续性与提示词，并保留已确认上游；不得声称已经生成。',
      candidates: '本轮只能根据画布真实候选证据更新比较与采用建议；不存在的结果保持未知，不得冒充生成或采用。',
      delivery: '本轮只可根据真实采用和核验结果更新 EDL、QC 与交付清单；缺少物理文件证据时必须保持阻断。',
    };
    return [
      `当前生产阶段：${phase}。${phaseFocus[phase]}`,
      incremental
        ? `本轮是有界增量：只返回 ${requiredKinds.join('、')}，其他作品类型由服务端保留；不得为了“完整”而重发或改写其他类型。`
        : '结构化 artifacts 表示“当前完整作品对象”，不是已经执行的生产结果；首版必须包含全部必需作品类型。',
      '典型“人设图 + 30 秒视频 + 6 个镜头”首轮必须至少给出：素材观察、ProductionBrief、ScriptDoc、人物锚点、素材需求、恰好 6 条可编辑 ShotList、Storyboard、AudioPlan 与逐镜 PromptPack。',
      '作品对象可以先完整，但生产阶段仍只能由真实确认、画布 Patch、Run、候选采用、EDL、QC 与 DeliveryManifest 证据逐步推进。',
    ].join('\n');
  }
  const contracts = {
    idea: [
      '当前唯一阶段是“创意”。只交付可确认的创意简报，不提前写完整剧本、资产表、分镜或生成计划。',
      '必须包含：素材观察（如有）、一句话核心、受众与用途、推荐时长/画幅、主角或主体、具体事件、情绪变化、视觉方向、必须保留和禁止项。',
      '合理默认直接写成建议值；内部仍未处理的决策不得作为清单输出，本轮结尾只提出系统指定的当前唯一问题。',
    ],
    script: [
      '当前唯一阶段是“剧本”。必须以已经确认的创意简报为上游，交付完整可编辑剧本，不返回创意问卷，也不提前做资产或分镜。',
      '必须包含标题、梗概、角色、分场、可拍动作、必要对白、情绪节奏和画面化结尾；时长与风格服从已确认简报。',
      '如果用户要求修订，必须交付完整修订稿并清楚标出改动，不只给建议。',
    ],
    assets: [
      '当前唯一阶段是“资产”。只从已确认剧本提取角色、服装、场景、道具和声音资产，保护已上传、已采用和已锁定内容。',
      '每项必须写清用途、出现位置、连续性约束、已有/缺失状态和可编辑提示词；不得擅自生成资产。',
      '人物参考图、服装、场景和道具必须分开，避免把人物污染到纯服装或纯道具资产。',
    ],
    shots: [
      '当前唯一阶段是“镜头与分镜”。以已确认剧本和资产为唯一上游，交付完整可编辑镜头表。',
      '逐镜写清镜号、时长、画面动作、景别、机位、运镜、对白/声音、引用资产、必须出现、严格禁止和前后连续性。',
      '不得跳到生成结果或成片；如果修订，交付完整修订镜头表。',
    ],
    candidates: [
      '当前唯一阶段是“候选”。只有画布中真实存在的关键帧、视频或声音结果才能被比较或采用；不存在的保持未知。',
      '先给出候选生产/比较方案，写清输入资产、模型来源、规格、候选数、锁定项和验收标准；不得声称已经运行或生成。',
      '保护成功和已采用结果，只规划明确失败或不满意项。',
    ],
    delivery: [
      '当前唯一阶段是“成片交付”。只使用真实已采用并通过来源核验的媒体，整理 EDL、声音层、字幕、QC 和交付清单。',
      '没有真实文件时必须保持阻断，不能把计划或预览冒充成片。',
      '交付信息要包含格式、尺寸、时长、大小、摘要和许可状态；缺失证据明确标为未知。',
    ],
  };
  return [
    `当前生产阶段：${phase}。`,
    ...contracts[phase],
    '阶段回复与后续确认必须是同一个版本对象；创作者确认后系统才会推进下一阶段并准备画布留存预览。',
  ].join('\n');
}

function taskResponseContract(input = {}) {
  const family = taskFamily(input);
  const contracts = {
    commerce: [
      '本轮必须直接给出可编辑的电商/品牌成稿 V0：先区分商品真值、你的建议和未知项，不得只给方法论。',
      '至少写出推荐渠道与受众、核心卖点顺序、逐屏/逐图标题与正文、每屏构图和素材需求；用户给了商品图时必须把可见外观事实带入方案。',
      '没有来源的参数、材质、功效、认证、Logo 细节和卖点必须保留为待补事实，不能编造；先完成能用的首版，再只追问会改变卖点或合规结论的问题。',
    ],
    image: [
      '本轮必须直接给出可编辑的图像 V0：明确保留区、修改区和禁止污染的内容。',
      '至少写清构图、主体/背景、光影、色彩或材质中的具体处理，以及可比较的执行步骤或方向。',
      '若有参考图，只分析实际可见或附件元数据支持的事实；不要猜人物身份、品牌或未显示细节。',
    ],
    video: [
      '本轮必须直接给出可编辑的视频 V0：写出时间结构或镜头结构，而不是只讨论风格名词。',
      '至少写清开头、中段、结尾如何推进，并包含镜头/动作/节奏/连续性/声音中的具体安排。',
      '未知时长、画幅或平台可以给推荐默认值并继续，只有会实质改变方案时才在正文后追问。',
    ],
    story: [
      '本轮必须直接交付当前生产阶段要求的可编辑正文，不得用“叙事骨架”“目标/阻力/升级/收束”等空模板代替作品内容。',
      '用户已给剧情或参考图时，必须把其中已确认事实具体带入本阶段产物；推断与可见事实必须分开。',
      '严格遵循当前生产阶段契约，不得越级输出后续阶段，也不得退回成问卷。',
    ],
    audio: [
      '本轮必须直接给出可编辑的声音 V0：至少包含声音目标、层次/轨道、时间或情绪结构和执行顺序。',
      '对话、旁白、环境、音效、音乐、混音只选择当前真正需要的部分，不套用固定完整流程。',
      '声线、速度、节拍或平台规格未知时可给推荐默认值；不要虚构已听到的附件内容。',
    ],
    mixed: [
      '本轮必须直接给出一个可编辑的完整作品 V0，并说明当前最合适的交付形态与推荐路线。',
      '至少包含目标、具体内容结构、关键约束和第一版执行顺序；不能只列可能性或让用户先选模式。',
      '如果存在多个合理方向，先推荐一个并给出有内容的备选差异，再邀请用户修改。',
    ],
  };
  return contracts[family].join('\n');
}
function attachmentMediaKind(item = {}) {
  const explicit = boundedText(item?.kind, 24).toLowerCase();
  if (['image', 'video', 'audio', 'text'].includes(explicit)) return explicit;
  const mimeType = boundedText(item?.mimeType, 120).toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/')) return 'text';
  const name = boundedText(item?.name, 240).toLowerCase();
  if (/\.(?:png|jpe?g|webp|gif|bmp|avif|heic)$/u.test(name)) return 'image';
  if (/\.(?:mp4|mov|webm|mkv|avi|m4v)$/u.test(name)) return 'video';
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)$/u.test(name)) return 'audio';
  return explicit || 'file';
}

function attachmentSummary(attachments = []) {
  const counts = new Map();
  for (const item of Array.isArray(attachments) ? attachments : []) {
    const kind = attachmentMediaKind(item);
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  const labels = {
    image: '张图片',
    video: '个视频',
    audio: '段音频',
    text: '份文本',
    file: '个文件',
  };
  return [...counts.entries()]
    .map(([kind, count]) => `${count}${labels[kind] || '个附件'}`)
    .join('、');
}

function mediaGroundingRequirement(input = {}) {
  const attachments = (Array.isArray(input.attachments) ? input.attachments : [])
    .map((item, index) => ({
      index: index + 1,
      kind: attachmentMediaKind(item),
      name: boundedText(item?.name, 240),
      observation: attachmentMediaKind(item) === 'audio'
        ? normalizeCreatorAudioObservation(item?.audioObservation, item)
        : null,
    }))
    .filter((item) => ['image', 'video', 'audio'].includes(item.kind));
  const visual = attachments.filter((item) => ['image', 'video'].includes(item.kind));
  const audio = attachments.filter((item) => item.kind === 'audio');
  const observedAudio = audio.filter((item) => item.observation);
  return {
    required: visual.length > 0 || audio.length > 0,
    visualRequired: visual.length > 0,
    audioRequired: audio.length > 0,
    audioObserved: audio.length > 0 && observedAudio.length === audio.length,
    unsupportedAudio: audio.length > 0 && observedAudio.length !== audio.length,
    attachmentCount: attachments.length,
    kinds: [...new Set(attachments.map((item) => item.kind))].sort(),
    visual,
    audio,
  };
}

function mediaGroundingContract(input = {}) {
  const requirement = mediaGroundingRequirement(input);
  if (!requirement.required) return '';
  const visualLines = requirement.visualRequired
    ? [
      '回复第一节必须使用标题“## 素材观察”，并按“素材 1 / 素材 2”对应附件顺序描述。',
      '素材观察至少写出两条从画面中真正可见、足以影响创作的具体事实，例如主体、动作、颜色、构图、环境、光线、材质或可辨文字；文件名、尺寸、数量不算画面事实。',
      '把“实际看见的事实”“合理但未确认的推断”分开；后续故事、广告、图像或视频方案必须明确使用这些可见事实，不能只说“已参考图片”。',
    ] : [];
  const audioLines = requirement.unsupportedAudio
    ? [
      '本轮含音频附件。只有在输入链路提供了可核验转写或音频分析证据时才能描述其内容；否则必须明确说明无法读取音频内容，禁止猜测。',
    ] : requirement.audioObserved
      ? [
        '本轮音频内容来自与素材 ID、revision 和 SHA-256 绑定的 Whisper 转写观察。只能把转写文字和返回的时间段当作事实。',
        'Whisper 转写不证明说话人身份、音乐风格、BPM、环境声或音效；这些内容除非另有真实证据，否则必须列为未知，禁止推断成已听见事实。',
      ] : [];
  return [...visualLines, ...audioLines].join('\n');
}

function mediaUnavailableText(input = {}, reason = 'media-grounding-unavailable') {
  const requirement = mediaGroundingRequirement(input);
  const summary = attachmentSummary(input.attachments) || '参考素材';
  const audioOnly = requirement.unsupportedAudio && !requirement.visualRequired;
  const title = audioOnly ? '## 暂时无法读取音频内容' : '## 暂时无法核验参考素材';
  const reasonText = reason === 'media-input-unsupported'
    ? '当前创作对话入口还没有取得这段音频的可核验转写或分析结果。'
    : reason === 'media-model-incompatible'
      ? '当前选择的语言模型没有经过视觉输入兼容验证，不能可靠读取这些图片或视频画面。'
      : reason === 'media-observation-missing' || reason === 'media-observation-generic'
        ? '模型本轮没有返回足够具体、可核验的素材观察。'
        : '当前模型或凭据暂时不能可靠读取这些参考素材。';
  return [
    title,
    '',
    `你上传的${summary}仍然保留。${reasonText}`,
    '',
    '为了避免把文件名、尺寸或通用模板误当成素材内容，我不会假装看过素材，也不会据此编造故事、商品卖点或镜头。',
    '',
    '可以在保持附件不变的情况下，切换到明确支持视觉输入的语言模型后重试；如果只想先按文字要求创作，也可以明确选择忽略附件。',
  ].join('\n');
}

function offlineV0(input = {}) {
  const prompt = boundedText(input.prompt, MAX_PROMPT_TEXT);
  const goal = prompt.replace(/\s+/g, ' ').slice(0, 240) || '完成一份可以继续修改的创作方案';
  const assets = attachmentSummary(input.attachments);
  const source = assets ? `已带入：${assets}。` : '当前没有主动带入的附件；以下未知项先采用可修改的建议值。';
  const family = taskFamily(input);
  const stage = productionPhase(input);
  const headers = [
    '## 离线结构 V0',
    '',
    '> 本轮没有调用在线模型，也没有修改画布或启动生成任务。下面先给出可以直接编辑的工作底稿。',
    '',
    '### 我理解的目标',
    `${goal}。${source}`,
    '',
  ];
  const bodies = {
    commerce: [
      '### 可编辑 V0：商品内容结构',
      '- **核心承诺**：先用一句可验证的商品利益点占据首屏；没有真实参数时保留占位符，不编造功效、材质或认证。',
      '- **套图顺序**：封面主图 → 核心卖点 → 使用场景 → 细节/材质 → 尺寸或参数 → 对比/信任 → 行动页。',
      '- **画面统一**：固定产品外观、品牌色和主光方向；每张图只承担一个信息任务，移动端先保证主体与大字可读。',
      '- **文案层级**：主标题 8–14 字；副标题解释“适合谁/解决什么”；参数和免责声明放在次级层。',
      '',
      '### 第一版执行顺序',
      '1. 锁定商品不可改变的事实与已有素材。',
      '2. 先做封面、卖点、场景三张方向稿，再扩展详情图。',
      '3. 对照平台尺寸与合规要求检查文字安全区、真实性和一致性。',
    ],
    image: [
      '### 可编辑 V0：图像方案',
      '- **保留区**：主体身份、关键轮廓、品牌/文字和用户明确满意的部分。',
      '- **修改区**：把构图、背景、光影、色彩、材质和清晰度拆开处理，避免一次改动污染全部特征。',
      '- **构图建议**：主体先占据明确视觉中心，背景只服务信息层级；按最终用途预留标题和裁切安全区。',
      '- **质感建议**：统一主光方向与色温，控制高光不过曝、暗部有层次，纹理清晰但不产生过度锐化边。',
      '',
      '### 第一版执行顺序',
      '1. 标出必须保持和允许变化的区域。',
      '2. 形成“稳妥 / 风格化 / 强视觉”三个可比较方向。',
      '3. 只采用一个方向后再做尺寸变体与局部精修。',
    ],
    video: [
      '### 可编辑 V0：视频结构',
      '- **开头**：前 1–3 秒直接给冲突、结果或核心视觉，不用空镜拖延。',
      '- **中段**：每个镜头只推进一个信息；人物、场景、光向、服装和道具连续。',
      '- **结尾**：回收核心目标，并按用途给行动句、品牌落版或情绪余韵。',
      '- **声音**：对白优先可懂度，环境声建立空间，音乐在转折处服务节奏而不是全程压满。',
      '',
      '### 第一版镜头节奏',
      '1. 建立目标与空间。',
      '2. 展示关键动作或卖点变化。',
      '3. 用近景/细节强化证据。',
      '4. 收束结果并留出可剪辑尾帧。',
    ],
    story: stage === 'idea' ? [
      '### 可编辑 V0：创意简报',
      `- **一句话核心**：${goal}`,
      '- **推荐用途**：先按 30–60 秒短视频方向组织；若目标是图文、电商或长内容，可直接改写。',
      '- **核心事件**：围绕用户明确给出的主体发生一次可见、可拍、能改变情绪或关系的事件，不额外编造素材事实。',
      '- **情绪路径**：建立日常与亲近感 → 出现一个小变化 → 主体主动回应 → 用具体动作形成温暖或有记忆点的收束。',
      '- **视觉方向**：清晰主体、真实空间、统一光向和克制色彩；参考素材内容尚未核验时不得写入外貌、身份或场景细节。',
      '- **必须保留**：用户原始目标、已确认素材和明确风格；后续不得无确认改变。',
    ] : stage === 'script' ? [
      '### 当前阶段：完整剧本',
      `- **已确认创意目标**：${goal}`,
      '- 在线语言模型目前未就绪，因此本轮只保留已确认目标，不用空模板冒充完整剧本。',
      '- 恢复可用语言模型后，将按已确认时长交付标题、梗概、角色、分场、可拍动作、必要对白和画面化结尾。',
    ] : [
      `### 当前阶段：${stage}`,
      `- **已确认上游目标**：${goal}`,
      '- 在线语言模型目前未就绪，因此不会用通用模板冒充本阶段完整产物。',
      '- 已确认内容和附件会保留；恢复可用模型后从当前阶段继续，不退回开头。',
    ],
    audio: [
      '### 可编辑 V0：声音方案',
      '- **对白/旁白**：先确定说话人、情绪曲线、语速和停连；重要信息避免被音乐覆盖。',
      '- **环境与音效**：用近、中、远三层建立空间，只保留能说明动作或情绪的声音。',
      '- **音乐**：先确定节拍、调性和进入/退出点，再决定乐器；转折处留出动态变化。',
      '- **混音**：对白居中清晰，低频不过载，响度按最终平台统一。',
      '',
      '### 第一版执行顺序',
      '1. 整理台词或声音目标。',
      '2. 做干声/主旋律版本。',
      '3. 加环境与关键音效。',
      '4. 完成响度、首尾和多格式导出检查。',
    ],
    mixed: [
      '### 可编辑 V0：创作方向',
      '- **目标版本**：先明确最终要交付的是单张、套图、脚本、短视频还是声音作品。',
      '- **内容版本**：把主题、受众、核心信息和情绪基调写成一页可修改说明。',
      '- **生产版本**：先做低成本结构稿，再生成候选；采用后才进入一致性、精修和交付。',
      '- **验证版本**：每一步都保留来源、版本和采用理由，避免重复生成覆盖已确认内容。',
    ],
  };
  const currentDecision = input.decisionTurn?.currentDecision || null;
  const nextDecisionSection = currentDecision ? [
    '',
    '### 下一步只确认一件事',
    `**${currentDecision.topic}**`,
    currentDecision.question,
    '也可以不选按钮，直接写你的答案或补充要求。',
  ] : [];
  return [
    ...headers,
    ...(bodies[family] || bodies.mixed),
    ...nextDecisionSection,
  ].join('\n');
}

function distinctMatches(value, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function mediaObservationQuality(text, input = {}) {
  const requirement = mediaGroundingRequirement(input);
  if (!requirement.visualRequired) {
    const audioDigests = requirement.audio
      .map((item) => item.observation?.observationDigest)
      .filter(Boolean);
    return {
      ok: !requirement.unsupportedAudio,
      code: requirement.unsupportedAudio ? 'media-input-unsupported' : 'not-required',
      required: requirement.required,
      status: requirement.unsupportedAudio
        ? 'unsupported'
        : requirement.audioObserved ? 'confirmed' : 'not-required',
      ...(requirement.audioObserved ? {
        code: 'media-grounded',
        observationDigest: digest({
          schema: 't8-creator-agent-audio-observation-set-v1',
          observationDigests: audioDigests,
        }),
      } : {}),
    };
  }
  const value = boundedText(text, 80_000);
  const heading = value.match(
    /^\s*#{1,4}\s*(?:参考)?素材观察(?:\s*[:：].*)?\s*$/imu,
  );
  if (!heading) {
    return {
      ok: false,
      code: 'media-observation-missing',
      required: true,
      status: 'unconfirmed',
    };
  }
  const sectionStart = (heading.index || 0) + heading[0].length;
  const remainder = value.slice(sectionStart);
  const nextHeading = remainder.search(/^\s*#{1,4}\s+\S+/mu);
  const section = boundedText(
    nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder,
    8_000,
  );
  const lines = section
    .split('\n')
    .map((line) => line
      .replace(/^\s*(?:[-*+]|\d+[.)、]|素材\s*\d+\s*[:：-]?)\s*/u, '')
      .trim())
    .filter((line) => line.length >= 10)
    .filter((line) => !/^(?:文件名|尺寸|分辨率|时长|附件|已上传|已带入|共计|数量)\b/iu.test(line));
  const visibleSignalCount = distinctMatches(section, [
    /主体|人物|角色|动物|商品|物体|建筑|场景|背景/u,
    /颜色|色调|明暗|光线|阴影|高光/u,
    /构图|位置|左侧|右侧|中央|前景|中景|远景/u,
    /动作|姿态|表情|视线|朝向|移动/u,
    /形状|轮廓|纹理|材质|服装|道具/u,
    /文字|标识|图案|标签/u,
  ]);
  const referenceSignal = /素材\s*\d+|图(?:片)?\s*\d+|视频\s*\d+|画面中|可见/u.test(section);
  const genericOnly = distinctMatches(section, [
    /已参考/u,
    /已带入/u,
    /上传(?:了|的)?\s*\d*\s*(?:张图片|个视频)/u,
    /根据(?:图片|素材|附件)/u,
  ]) > 0 && visibleSignalCount < 2;
  if (section.replace(/\s+/g, '').length < 48
    || lines.length < 2
    || visibleSignalCount < 2
    || !referenceSignal
    || genericOnly) {
    return {
      ok: false,
      code: 'media-observation-generic',
      required: true,
      status: 'unconfirmed',
    };
  }
  return {
    ok: true,
    code: 'media-grounded',
    required: true,
    status: 'confirmed',
    observationDigest: digest({
      schema: 't8-creator-agent-media-observation-v1',
      section,
    }),
    visibleSignalCount,
    observationLineCount: lines.length,
  };
}

function responseQuality(text, prompt = '', input = {}) {
  const value = boundedText(text, 80_000);
  const compact = value.replace(/\s+/g, '');
  const original = boundedText(prompt, MAX_PROMPT_TEXT).replace(/\s+/g, '');
  const family = taskFamily({ ...input, prompt: input.prompt || prompt });
  const questionCount = (value.match(/[？?]/g) || []).length;
  const sentences = value
    .split(/(?<=[。！？!?])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const declarative = sentences.filter((part) => !/[？?]\s*$/u.test(part));
  const declarativeChars = declarative.join('').replace(/\s+/g, '').length;
  const structureCount = distinctMatches(value, [
    /^#{1,4}\s+\S+/mu,
    /^\s*[-*]\s+\S+/mu,
    /^\s*\d+[.)、]\s*\S+/mu,
    /[①②③④⑤⑥⑦⑧⑨]/u,
  ]);
  const actionabilityCount = distinctMatches(value, [
    /先|然后|接着|最后|第一版|下一步/u,
    /保留|锁定|保护|不改变|不得|避免/u,
    /修改|调整|替换|增加|减少|拆分|合并/u,
    /检查|确认|比较|采用|交付|执行/u,
  ]);
  const familyPatterns = {
    commerce: [/商品|产品/u, /主图|详情页|套图|SKU/u, /卖点|文案|标题|CTA/u, /品牌|Logo|包装/u, /平台|尺寸|安全区/u],
    image: [/保留区|保留|保护/u, /修改区|局部|蒙版/u, /构图|主体|背景|层级/u, /光影|色温|色彩/u, /材质|纹理|清晰|锐度/u],
    video: [/镜头|景别|运镜/u, /时长|时间|秒/u, /动作|表演|运动/u, /节奏|转场|剪辑/u, /连续性|服装|道具|轴线/u, /声音|对白|音乐|音效/u],
    story: [
      /logline|故事|剧本|命题/u,
      /人物|角色|主角|主人公|关系/u,
      /目标|动机|欲望|想要|希望|想在/u,
      /冲突|阻力|代价|误会|困难|失败|一度/u,
      /场景|行动|动作|对白|说[：“"]|看见|走向|跑向/u,
      /转折|高潮|结局|收束|最后|最终|结尾/u,
    ],
    audio: [/对白|旁白|配音/u, /环境声|音效|拟音/u, /音乐|配乐|节拍|旋律/u, /声线|语速|情绪/u, /混音|响度|淡入|淡出/u, /轨道|层次|时间/u],
    mixed: [/目标|交付|用途/u, /结构|版本|方案/u, /画面|图像|视频|声音|文字/u, /步骤|执行|制作/u, /约束|保护|风险/u],
  };
  const familySignalCount = distinctMatches(value, familyPatterns[family] || familyPatterns.mixed);
  const minimumLength = ['commerce', 'video', 'story'].includes(family) ? 130 : 120;
  const normalizedLine = value.replace(/\s+/g, ' ');
  const mediaGrounding = mediaObservationQuality(value, input);
  if (!mediaGrounding.ok && mediaGrounding.required) {
    return {
      ok: false,
      code: mediaGrounding.code,
      family,
      mediaGrounding,
    };
  }

  if (compact.length < minimumLength) return { ok: false, code: 'response-too-short' };
  if (original && compact === original) return { ok: false, code: 'response-repeats-request' };
  if (original && compact.includes(original) && compact.length - original.length < 100) {
    return { ok: false, code: 'response-mostly-repeats-request' };
  }
  if (questionCount >= 2 && declarativeChars < 160) {
    return { ok: false, code: 'response-only-questions' };
  }
  if (questionCount >= Math.max(2, declarative.length + 1)) {
    return { ok: false, code: 'response-questionnaire' };
  }
  if (familySignalCount < 2) return { ok: false, code: 'response-task-generic' };
  if (structureCount === 0 && (declarative.length < 3 || actionabilityCount < 2)) {
    return { ok: false, code: 'response-not-actionable' };
  }
  if (/^(?:已整理|已形成|我可以帮你|请先选择|你想先|请告诉我|需要你先).{0,160}$/u.test(normalizedLine)) {
    return { ok: false, code: 'response-boilerplate' };
  }
  if (distinctMatches(value, [
    /请(?:先)?提供/u,
    /请(?:先)?告诉我/u,
    /你(?:更)?想要/u,
    /你(?:可以)?选择/u,
    /需要你(?:先)?确认/u,
  ]) >= 3 && actionabilityCount < 3) {
    return { ok: false, code: 'response-defers-work' };
  }
  return {
    ok: true,
    code: 'accepted',
    family,
    familySignalCount,
    structureCount,
    actionabilityCount,
    mediaGrounding,
  };
}
function attachmentParts(attachments = []) {
  const parts = [];
  for (const item of Array.isArray(attachments) ? attachments : []) {
    const ref = boundedText(item?.ref, 2_000);
    if (!ref) continue;
    const kind = attachmentMediaKind(item);
    if (kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: ref } });
    } else if (kind === 'video') {
      parts.push({ type: 'video_url', video_url: { url: ref } });
    }
  }
  return parts;
}

function historyMessages(session = {}) {
  const events = Array.isArray(session.events) ? session.events : [];
  return events
    .filter((event) => ['user.message', 'user.suggestion', 'assistant.response.completed']
      .includes(event?.type))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((event) => ({
      role: event.type.startsWith('user.') ? 'user' : 'assistant',
      content: boundedText(event.payload?.text, MAX_HISTORY_TEXT),
    }))
    .filter((message) => message.content);
}

function systemPrompt(input = {}) {
  return [
    '你是贞贞无限画布的创作 Agent。你的职责是直接帮助创作者产出可编辑内容，不是把工作退回给用户。',
    '当前任务可能是电商、品牌、海报、修图、角色、故事、分镜、视频、音频或混合创作；必须根据用户真实需求选择最短路径，不得一律套用故事板。',
    '同一轮先交付有实质内容的可编辑版本，再只提出系统指定的当前一个决策。其余待处理内容保存在内部版本文档中，不得在回复里倾倒问题清单。',
    '明确区分用户事实、你的建议和未知项。不得编造商品参数、人物身份、品牌规则、素材内容、模型调用结果或已经发生的画布修改。',
    '本轮只生成创作正文与结构化作品对象；不要声称已经运行节点、生成素材、覆盖内容或写入画布。工具和画布动作由后续受控计划单独处理。',
    '不要在 displayMarkdown 末尾生成产品 UI 的“三个下一步按钮”，SuggestionSet 会由系统根据本轮作品版本另行形成。',
    '使用清楚、可扫读的中文。避免“已为你整理计划”之类空话，也不要只连续提问。',
    '正文应使用短标题、段落、列表或编号形成可直接编辑的结构；至少包含三段陈述性内容，问题只能放在实质 V0 之后。',
    mediaGroundingContract(input),
    stagedStoryContract(input),
    taskResponseContract(input),
    creatorDecisionPromptContract(input.decisionTurn),
    creatorCurrentWorkContract(input),
    `任务类型：${taskFamily(input)}；计划种类：${boundedText(input.kind, 40) || 'mixed'}；recipe：${boundedText(input.recipe, 80) || 'general'}。`,
    creatorStructuredResponseContract(input),
  ].join('\n');
}

function userMessage(input = {}) {
  const prompt = boundedText(input.prompt, MAX_PROMPT_TEXT);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const metadata = attachments.map((item, index) => {
    const audioObservation = attachmentMediaKind(item) === 'audio'
      ? normalizeCreatorAudioObservation(item?.audioObservation, item)
      : null;
    return {
      index: index + 1,
      assetId: boundedText(item.assetId, 160) || null,
      contentRevision: Math.max(0, Math.trunc(Number(item.contentRevision) || 0)),
      contentHash: boundedText(item.contentHash, 128).toLowerCase().replace(/^sha256:/u, '') || null,
      kind: attachmentMediaKind(item),
      name: boundedText(item.name, 240),
      mimeType: boundedText(item.mimeType, 120),
      width: Number(item.width) || null,
      height: Number(item.height) || null,
      duration: Number(item.duration) || null,
      ...(audioObservation ? {
        audioObservation: {
          observationDigest: audioObservation.observationDigest,
          model: audioObservation.model,
          transcript: audioObservation.transcript,
          segments: audioObservation.segments,
          limitation: audioObservation.limitation,
        },
      } : {}),
    };
  });
  const text = [
    `用户要求：${prompt}`,
    `当前生产阶段：${productionPhase(input)}`,
    metadata.length ? `附件元数据：${JSON.stringify(metadata)}` : '附件元数据：无',
    '请直接给出本轮可编辑内容。不要只复述要求或只给问题；结尾只能提出当前唯一决策。',
  ].join('\n');
  const media = attachmentParts(attachments);
  return media.length
    ? { role: 'user', content: [{ type: 'text', text }, ...media] }
    : { role: 'user', content: text };
}

function evidence(input = {}) {
  const value = {
    schema: CREATOR_RESPONSE_EVIDENCE_SCHEMA,
    mode: input.mode,
    status: input.status,
    providerCalls: Math.max(0, Math.trunc(Number(input.providerCalls) || 0)),
    provider: boundedText(input.provider, 160) || null,
    model: boundedText(input.model, 240) || null,
    finishReason: boundedText(input.finishReason, 120) || null,
    requestId: boundedText(input.requestId, 240) || null,
    errorCode: boundedText(input.errorCode, 120) || null,
    qualityCode: boundedText(input.qualityCode, 120) || null,
    modelDecisionDigest: boundedText(input.modelDecisionDigest, 64).toLowerCase() || null,
    qualityMode: normalizeQualityMode(input.qualityMode),
    promptContractDigest: boundedText(input.promptContractDigest, 64).toLowerCase() || null,
    calls: (Array.isArray(input.calls) ? input.calls : []).slice(0, 8).map((call, index) => ({
      index,
      role: boundedText(call?.role, 40) || (index === 0 ? 'draft' : 'refine'),
      status: boundedText(call?.status, 40) || 'completed',
      provider: boundedText(call?.provider, 160) || null,
      model: boundedText(call?.model, 240) || null,
      requestId: boundedText(call?.requestId, 240) || null,
      finishReason: boundedText(call?.finishReason, 120) || null,
      errorCode: boundedText(call?.errorCode, 120) || null,
    })),
  };
  if (input.mediaGrounding && typeof input.mediaGrounding === 'object') {
    value.mediaGrounding = {
      required: input.mediaGrounding.required === true,
      status: boundedText(input.mediaGrounding.status, 40) || null,
      attachmentCount: Math.max(
        0,
        Math.min(24, Math.trunc(Number(input.mediaGrounding.attachmentCount) || 0)),
      ),
      kinds: [...new Set(
        (Array.isArray(input.mediaGrounding.kinds) ? input.mediaGrounding.kinds : [])
          .map((kind) => boundedText(kind, 24).toLowerCase())
          .filter(Boolean),
      )].sort(),
      observationDigest: boundedText(
        input.mediaGrounding.observationDigest,
        64,
      ).toLowerCase() || null,
    };
  }
  value.evidenceDigest = digest(value);
  return value;
}

function withArtifactProposal(input, result) {
  if (!result?.text || result.stopped || !result.evidence) return result;
  if (result.evidence.mode !== 'online-model'
    || result.evidence.status !== 'completed'
    || Number(result.evidence.providerCalls || 0) < 1) return result;
  return {
    ...result,
    artifactProposal: createCreatorArtifactProposal({
      taskFamily: taskFamily(input),
      prompt: input.prompt,
      responseText: result.text,
      mode: result.evidence.mode,
      responseEvidence: result.evidence,
    }),
  };
}

function createCreatorAgentLlmRuntime(options = {}) {
  const generateChat = typeof options.generateChat === 'function'
    ? options.generateChat : generateChatWithProvider;
  const settingsProvider = typeof options.settingsProvider === 'function'
    ? options.settingsProvider : () => readSettings(options.settingsFile);
  const runtimeConfig = options.config || {};

  function prepareResponse(input = {}) {
    const prompt = boundedText(input.prompt, MAX_PROMPT_TEXT);
    const decision = selectedLlmDecision(input.modelDecisionReceipt);
    const modelDecisionDigest = boundedText(input.modelDecisionReceipt?.receiptDigest, 64);
    const mediaRequirement = mediaGroundingRequirement(input);
    const qualityMode = requestedQualityMode(input);
    const promptContract = systemPrompt(input);
    const promptContractDigest = digest({
      schema: 't8-creator-llm-prompt-contract-v1',
      systemPrompt: promptContract,
    });
    let settings = {};
    try {
      settings = settingsProvider() || {};
    } catch {
      settings = {};
    }
    const decisionCompatibility = boundedText(
      decision?.inputCompatibility?.status,
      40,
    ).toLowerCase();
    const mediaErrorCode = mediaRequirement.unsupportedAudio
      ? 'media-input-unsupported'
      : mediaRequirement.visualRequired && decisionCompatibility !== 'compatible'
        ? 'media-model-incompatible'
        : '';
    const provider = mediaErrorCode
      ? null
      : providerForDecision(decision, settings, runtimeConfig);
    if (!provider) {
      const errorCode = mediaErrorCode || (decision?.status === 'ready'
        ? 'credential-unavailable' : 'model-not-ready');
      const mediaGrounding = mediaRequirement.required ? {
        ...mediaRequirement,
        status: mediaRequirement.unsupportedAudio ? 'unsupported' : 'unavailable',
      } : null;
      return {
        schema: 't8-creator-agent-prepared-response-v1',
        mode: mediaRequirement.required ? 'media-unavailable' : 'offline-structure',
        prompt,
        decision,
        modelDecisionDigest,
        provider: null,
        messages: [],
        input,
        qualityMode,
        promptContractDigest,
        offlineText: mediaRequirement.required
          ? mediaUnavailableText(input, errorCode)
          : offlineV0(input),
        mediaRequirement,
        startedEvidence: evidence({
          mode: mediaRequirement.required ? 'media-unavailable' : 'offline-structure',
          status: 'streaming',
          providerCalls: 0,
          provider: decision?.selected?.provider,
          model: decision?.selected?.model,
          errorCode,
          modelDecisionDigest,
          qualityMode,
          promptContractDigest,
          mediaGrounding,
        }),
      };
    }
    return {
      schema: 't8-creator-agent-prepared-response-v1',
      mode: 'online-model',
      prompt,
      decision,
      modelDecisionDigest,
      provider,
      input,
      qualityMode,
      promptContractDigest,
      mediaRequirement,
      messages: [
        { role: 'system', content: promptContract },
        ...(latestWorkArtifactVersions(input.session?.workArtifactVersions).length
          ? []
          : historyMessages(input.session)),
        userMessage(input),
      ],
      offlineText: '',
      startedEvidence: evidence({
        mode: 'online-model',
        status: 'streaming',
        providerCalls: 1,
        provider: provider.id,
        model: decision.selected.model,
        modelDecisionDigest,
        qualityMode,
        promptContractDigest,
        mediaGrounding: mediaRequirement.required ? {
          ...mediaRequirement,
          status: 'pending',
        } : null,
      }),
    };
  }

  async function createResponse(input = {}, hooks = {}) {
    const prepared = hooks.prepared?.schema === 't8-creator-agent-prepared-response-v1'
      ? hooks.prepared : prepareResponse(input);
    const onDelta = typeof hooks.onDelta === 'function' ? hooks.onDelta : null;
    const shouldStop = typeof hooks.shouldStop === 'function' ? hooks.shouldStop : null;
    let streamedText = '';
    let streamedDeltaCount = 0;
    let streamOverflow = false;
    let bufferedProviderText = '';
    const mediaRequirement = prepared.mediaRequirement
      || mediaGroundingRequirement(input);
    // The upstream response now carries a validated JSON work envelope. Keep
    // raw deltas out of the creator-facing transcript and publish only the
    // validated displayMarkdown after the response passes the schema gate.
    const bufferUntilGrounded = true;

    const emitDelta = async (value, meta = {}) => {
      if (!onDelta) return '';
      const remaining = Math.max(0, 80_000 - streamedText.length);
      const delta = boundedResponseText(value, remaining);
      if (!delta) {
        if (String(value || '')) streamOverflow = true;
        return '';
      }
      if (delta.length < String(value || '').length) streamOverflow = true;
      streamedText += delta;
      streamedDeltaCount += 1;
      await onDelta(delta, {
        ...meta,
        index: streamedDeltaCount - 1,
      });
      return delta;
    };

    if (!prepared.provider) {
      const text = boundedResponseText(prepared.offlineText || offlineV0(input));
      if (onDelta) await emitDelta(text, { mode: prepared.mode || 'offline-structure' });
      const response = {
        text,
        streamed: Boolean(onDelta),
        evidence: evidence({
          mode: prepared.mode || 'offline-structure',
          status: 'completed',
          providerCalls: 0,
          provider: prepared.decision?.selected?.provider,
          model: prepared.decision?.selected?.model,
          errorCode: mediaRequirement.required
            ? (boundedText(prepared.startedEvidence?.errorCode, 120)
              || (mediaRequirement.unsupportedAudio
                ? 'media-input-unsupported'
                : 'media-grounding-unavailable'))
            : prepared.decision?.status === 'ready'
              ? 'credential-unavailable' : 'model-not-ready',
          qualityCode: mediaRequirement.required
            ? 'media-grounding-unavailable'
            : responseQuality(text, prepared.prompt, input).code,
          modelDecisionDigest: prepared.modelDecisionDigest,
          mediaGrounding: mediaRequirement.required ? {
            ...mediaRequirement,
            status: mediaRequirement.unsupportedAudio ? 'unsupported' : 'unavailable',
          } : null,
        }),
      };
      return response;
    }

    const provider = prepared.provider;
    const decision = prepared.decision;
    const totalCalls = qualityModeCallCount(prepared.qualityMode);
    const calls = [];
    const runCall = async (messages, index, stream) => {
      const verifiedSeed21StructuredControls = prepared.input?.requireStructuredWork === true
        && provider.id === 'seedance-nz'
        && decision.selected.model === 'bytedance/doubao-seed-2.1-pro';
      let callResult;
      try {
        callResult = await generateChat(provider, {
          model: decision.selected.model,
          messages,
          temperature: index === 0 ? 0.72 : index === totalCalls - 1 ? 0.32 : 0.45,
          // The default Seed 2.1 endpoint has been live-verified with both
          // json_object and low reasoning. Without these controls it can spend
          // the whole 8K completion budget on hidden reasoning and truncate
          // the Creator Work JSON. Keep other providers on the compatibility
          // path until the same parameters have been verified for them.
          maxTokens: prepared.input?.requireStructuredWork === true
            ? (verifiedSeed21StructuredControls ? 8_192 : 16_384)
            : 8_192,
          ...(verifiedSeed21StructuredControls ? {
            responseFormat: { type: 'json_object' },
            reasoningEffort: 'low',
          } : {}),
          stream,
        }, {
          baseUrl: input.requestBaseUrl,
          timeoutMs: Number(options.timeoutMs) || 120_000,
          fetchImpl: options.fetchImpl,
          ffmpegPath: options.ffmpegPath,
          ...(stream && onDelta ? {
            onDelta: async (delta) => {
              const remaining = Math.max(0, 160_000 - bufferedProviderText.length);
              const boundedDelta = boundedResponseText(delta, remaining);
              if (boundedDelta.length < String(delta || '').length) streamOverflow = true;
              bufferedProviderText += boundedDelta;
              return boundedDelta;
            },
          } : {}),
          ...(shouldStop ? { shouldStop } : {}),
        });
      } catch (error) {
        callResult = {
          ok: false,
          code: boundedText(error?.code || error?.name, 120) || 'runtime-error',
          error: boundedText(error?.message, 500) || '模型调用失败',
        };
      }
      calls.push({
        role: index === 0 ? 'draft' : index === totalCalls - 1 ? 'final-merger' : 'critic-refiner',
        status: callResult?.ok ? 'completed' : callResult?.code === 'stopped' ? 'stopped' : 'failed',
        provider: provider.id,
        model: callResult?.model || decision.selected.model,
        requestId: callResult?.requestId || null,
        finishReason: callResult?.finishReason || null,
        errorCode: callResult?.ok ? null : boundedText(callResult?.code, 120) || 'provider-failed',
      });
      return callResult;
    };

    let result = await runCall(prepared.messages, 0, Boolean(onDelta));

    if (result?.code === 'stopped' || (shouldStop && await shouldStop())) {
      return {
        // Structured Provider output is not creator-facing until the full JSON
        // envelope and quality gates pass. A stopped first pass therefore has
        // no safe partial text to persist; exposing result.text here would leak
        // raw or truncated JSON into the transcript.
        text: streamedText,
        stopped: true,
        streamed: streamedDeltaCount > 0,
        evidence: evidence({
          mode: 'online-model',
          status: 'stopped',
          providerCalls: 1,
          provider: provider.id,
          model: result?.model || decision.selected.model,
          finishReason: result?.finishReason,
          requestId: result?.requestId,
          errorCode: 'stopped',
          modelDecisionDigest: prepared.modelDecisionDigest,
          qualityMode: prepared.qualityMode,
          promptContractDigest: prepared.promptContractDigest,
          calls,
        }),
      };
    }

    let providerRaw = boundedResponseText(result?.text || bufferedProviderText);
    let structured = result?.ok ? structuredModelResult(providerRaw, {
      ...input,
      qualityMode: prepared.qualityMode,
    }) : null;
    let refinementFailureCode = '';
    if (result?.ok && structured && totalCalls > 1) {
      for (let passIndex = 1; passIndex < totalCalls; passIndex += 1) {
        if (shouldStop && await shouldStop()) break;
        const refined = await runCall(
          refinementMessages(prepared, providerRaw, passIndex, totalCalls),
          passIndex,
          false,
        );
        if (refined?.code === 'stopped' || (shouldStop && await shouldStop())) {
          result = refined;
          break;
        }
        if (!refined?.ok) {
          result = refined;
          refinementFailureCode = boundedText(refined?.code, 120) || 'quality-pass-failed';
          break;
        }
        const refinedRaw = boundedResponseText(refined.text);
        const refinedStructured = structuredModelResult(refinedRaw, {
          ...input,
          qualityMode: prepared.qualityMode,
        });
        if (!refinedStructured) {
          result = refined;
          refinementFailureCode = 'work-schema-invalid';
          break;
        }
        result = refined;
        providerRaw = refinedRaw;
        structured = refinedStructured;
      }
    }
    if (result?.code === 'stopped' || (shouldStop && await shouldStop())) {
      const partialText = structured?.displayMarkdown || '';
      if (partialText && onDelta) await emitDelta(partialText, {
        mode: 'online-model',
        grounded: true,
        synthesizedFromCompletedResponse: true,
      });
      return {
        text: partialText,
        stopped: true,
        streamed: streamedDeltaCount > 0,
        evidence: evidence({
          mode: 'online-model',
          status: 'stopped',
          providerCalls: calls.length,
          provider: provider.id,
          model: result?.model || decision.selected.model,
          finishReason: result?.finishReason,
          requestId: result?.requestId,
          errorCode: 'stopped',
          modelDecisionDigest: prepared.modelDecisionDigest,
          qualityMode: prepared.qualityMode,
          promptContractDigest: prepared.promptContractDigest,
          calls,
        }),
      };
    }

    const providerText = boundedResponseText(structured?.displayMarkdown || providerRaw);
    let quality = result?.ok ? responseQuality(providerText, prepared.prompt, input) : {
      ok: false,
      code: boundedText(result?.code, 120) || 'provider-failed',
    };
    if (result?.ok && input.requireStructuredWork === true && !structured) {
      quality = { ok: false, code: refinementFailureCode || 'work-schema-invalid' };
    } else if (result?.ok && refinementFailureCode) {
      quality = { ok: false, code: refinementFailureCode };
    }
    if (result?.ok && quality.ok && streamOverflow) {
      quality = { ok: false, code: 'response-too-large' };
    }
    if (result?.ok && quality.ok && onDelta && bufferUntilGrounded) {
      const acceptedText = providerText;
      const chunks = acceptedText.match(/[\s\S]{1,800}(?:\n\n|$)/g) || [acceptedText];
      for (const chunk of chunks) {
        await emitDelta(chunk, {
          mode: 'online-model',
          grounded: true,
          synthesizedFromCompletedResponse: true,
        });
      }
    } else if (result?.ok && quality.ok && onDelta && streamedText !== providerText) {
      if (!streamedText || providerText.startsWith(streamedText)) {
        await emitDelta(providerText.slice(streamedText.length), {
          mode: 'online-model',
          synthesizedFromCompletedResponse: true,
        });
      } else {
        quality = { ok: false, code: 'stream-text-mismatch' };
      }
    }
    if (result?.ok && quality.ok) {
      const text = onDelta ? streamedText : providerText;
      const responseEvidence = evidence({
        mode: 'online-model',
        status: 'completed',
        providerCalls: calls.length,
        provider: provider.id,
        model: result.model || decision.selected.model,
        finishReason: result.finishReason,
        requestId: result.requestId,
        qualityCode: structured ? 'structured-work-accepted' : quality.code,
        modelDecisionDigest: prepared.modelDecisionDigest,
        qualityMode: prepared.qualityMode,
        promptContractDigest: prepared.promptContractDigest,
        calls,
        mediaGrounding: quality.mediaGrounding?.required ? {
          ...mediaRequirement,
          status: quality.mediaGrounding.status,
          observationDigest: quality.mediaGrounding.observationDigest,
        } : null,
      });
      const accepted = withArtifactProposal(input, {
        text,
        streamed: streamedDeltaCount > 0,
        toolProposals: structured?.toolProposals
          || (Array.isArray(result.toolProposals) ? result.toolProposals.slice(0, 12) : []),
        evidence: responseEvidence,
      });
      return structured ? { ...accepted, workProposal: structured.proposal } : accepted;
    }

    const mediaFailure = mediaRequirement.required;
    const fallbackCode = boundedText(result?.code, 120) || quality.code;
    const fallback = boundedResponseText(mediaFailure
      ? mediaUnavailableText(input, fallbackCode)
      : offlineV0(input));
    const reason = result?.ok
      ? '在线模型回复未达到可用质量'
      : '在线模型调用中断';
    const continuationText = fallback;
    if (onDelta) await emitDelta(continuationText, {
      mode: mediaFailure ? 'media-unavailable' : 'offline-fallback',
      fallback: true,
    });
    const response = {
      text: onDelta ? streamedText : fallback,
      continuationText: onDelta ? continuationText : '',
      streamed: streamedDeltaCount > 0,
      evidence: evidence({
        mode: mediaFailure ? 'media-unavailable' : 'offline-fallback',
        status: 'completed-with-fallback',
        providerCalls: calls.length || 1,
        provider: provider.id,
        model: result?.model || decision.selected.model,
        finishReason: result?.finishReason,
        requestId: result?.requestId,
        errorCode: fallbackCode,
        qualityCode: quality.code,
        modelDecisionDigest: prepared.modelDecisionDigest,
        qualityMode: prepared.qualityMode,
        promptContractDigest: prepared.promptContractDigest,
        calls,
        mediaGrounding: mediaFailure ? {
          ...mediaRequirement,
          status: mediaRequirement.unsupportedAudio ? 'unsupported' : 'unavailable',
        } : null,
      }),
    };
    return response;
  }

  return { createResponse, prepareResponse };
}
module.exports = {
  CREATOR_RESPONSE_EVIDENCE_SCHEMA,
  createCreatorAgentLlmRuntime,
  offlineV0,
  mediaGroundingRequirement,
  mediaObservationQuality,
  mediaUnavailableText,
  providerForDecision,
  responseQuality,
  selectedLlmDecision,
  taskFamily,
  taskResponseContract,
  creatorToolProposalContract,
};
