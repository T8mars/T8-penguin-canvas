'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const { generateChatWithProvider } = require('../providers/adapters');
const { normalizeAdvancedProviders } = require('../providers/registry');
const { digest } = require('./creatorConversationRepository');
const { normalizeScenePatch } = require('./creatorLongScriptWork');

const CREATOR_LLM_RESPONSE_SCHEMA = 't8-creator-llm-response-v2';
const DEFAULT_MODELS = Object.freeze({
  // Creator accepts explicit visual references, so its own default must be a
  // documented vision-capable chat model. This does not change defaults of
  // the standalone prompt-enhancer or LLM nodes.
  llm: 'zhenzhen/gk-4.6',
  image: 'zhenzhen-image-gk-v2',
  video: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
});
const SCENE_DRAFT_DEFAULT_LLM = 'qwen/qwen3.7-max';

const DOCUMENTED_VISION_MODELS = new Set([
  'seedance-nz:zhenzhen/gk-4.6',
]);

function isDocumentedVisionModel(providerId, modelId) {
  return DOCUMENTED_VISION_MODELS.has(`${bounded(providerId, 180)}:${bounded(modelId, 240)}`);
}

class CreatorLlmRuntimeError extends Error {
  constructor(code, message, status = 502, details = null) {
    super(message);
    this.name = 'CreatorLlmRuntimeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function bounded(value, maximum = 4_000) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function providerCredentialRejected(result) {
  const status = Number(result?.upstreamHttpStatus);
  if (status === 401 || status === 403) return true;
  const evidence = `${bounded(result?.code, 120)} ${bounded(result?.error, 1_000)}`;
  return /(?:unauthori[sz]ed|forbidden|invalid[\s_-]*(?:api[\s_-]*)?key|api[\s_-]*key[\s_-]*(?:invalid|expired)|credential[\s_-]*(?:invalid|expired)|鉴权失败|认证失败|密钥无效|无效(?:的)?\s*API\s*Key)/iu.test(evidence);
}

function providerTransientlyUnavailable(result) {
  const status = Number(result?.upstreamHttpStatus);
  return ['http_error', 'network_error'].includes(String(result?.code || ''))
    && (String(result?.code || '') === 'network_error' || [429, 500, 502, 503].includes(status));
}

async function waitForProviderRetry(delayMs, signal) {
  if (signal?.aborted) return;
  const duration = Number.isFinite(Number(delayMs))
    ? Math.max(0, Math.min(5_000, Number(delayMs))) : 700;
  if (!duration) return;
  await new Promise((resolve) => setTimeout(resolve, duration));
}

function readSettings(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8')) || {};
  } catch {
    return {};
  }
}

function providerFromSettings(providerId, modelId, settings = {}, config = {}) {
  if (providerId === 'seedance-nz') {
    const apiKey = bounded(settings.zhenzhenSd2ApiKey, 4_000);
    if (!apiKey) return null;
    return {
      id: providerId,
      label: '贞贞的平价AI小屋',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey,
      baseUrl: bounded(settings.zhenzhenSd2BaseUrl || config.ZHENZHEN_SD2_BASE_URL, 2_000),
      chatModels: [modelId],
      defaults: { chatModel: modelId, chatEndpoint: '/v1/chat/completions' },
    };
  }
  if (providerId === 'zhenzhen') {
    const apiKey = bounded(settings.llmApiKey || settings.zhenzhenApiKey, 4_000);
    if (!apiKey) return null;
    return {
      id: providerId,
      label: '贞贞的AI工坊',
      protocol: 'openai-compatible',
      enabled: true,
      apiKey,
      baseUrl: bounded(settings.llmBaseUrl || settings.zhenzhenBaseUrl || config.ZHENZHEN_BASE_URL, 2_000),
      chatModels: [modelId],
      defaults: { chatModel: modelId, chatEndpoint: '/v1/chat/completions' },
    };
  }
  const advanced = normalizeAdvancedProviders(settings.advancedProviders);
  const provider = advanced.find((item) => item.id === providerId && item.enabled && bounded(item.apiKey, 4_000));
  if (!provider) return null;
  return {
    ...provider,
    chatModels: [...new Set([modelId, ...(Array.isArray(provider.chatModels) ? provider.chatModels : [])])],
    defaults: { ...(provider.defaults || {}), chatModel: modelId },
  };
}

function exactChoice(preferences, kind, options = {}) {
  const explicit = preferences?.[kind];
  const providerId = bounded(explicit?.providerId || preferences?.providerId, 180);
  const modelId = bounded(explicit?.modelId, 240);
  if (providerId && providerId !== 'auto' && modelId) {
    if (kind === 'llm' && options.requiresVision && !isDocumentedVisionModel(providerId, modelId)) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_VISION_REQUIRED',
        '当前 LLM 不能读取图片或视频。请改用智能选择，或选择支持视觉的模型。',
        409,
        { providerId, modelId },
      );
    }
    return { providerId, modelId };
  }
  const available = (Array.isArray(creativeModelCatalog[kind]) ? creativeModelCatalog[kind] : [])
    .filter((item) => item?.available !== false)
    .map((item) => ({ providerId: bounded(item.provider, 180), modelId: bounded(item.model, 240) }))
    .filter((item) => item.providerId && item.modelId)
    .filter((item) => !providerId || providerId === 'auto' || item.providerId === providerId)
    .filter((item) => !options.requiresVision
      || isDocumentedVisionModel(item.providerId, item.modelId));
  const preferredModelId = bounded(options.preferredModelId, 240) || DEFAULT_MODELS[kind];
  const preferred = available.find((item) => item.modelId === preferredModelId);
  const ordered = preferred ? [preferred, ...available.filter((item) => item !== preferred)] : available;
  if (options.settings) {
    const configured = ordered.find((item) => providerFromSettings(
      item.providerId,
      item.modelId,
      options.settings,
      options.config || {},
    ));
    if (configured) return configured;
  }
  return ordered[0] || { providerId: 'seedance-nz', modelId: DEFAULT_MODELS[kind] };
}

function modelExists(kind, choice) {
  return (Array.isArray(creativeModelCatalog[kind]) ? creativeModelCatalog[kind] : []).some((item) => (
    item.provider === choice.providerId && item.model === choice.modelId && item.available !== false
  ));
}

function catalogModel(kind, snapshot) {
  return (Array.isArray(creativeModelCatalog[kind]) ? creativeModelCatalog[kind] : []).find((item) => (
    item.provider === snapshot?.providerId && item.model === snapshot?.modelId && item.available !== false
  )) || null;
}

function modelSnapshot(kind, preferences, options = {}) {
  const choice = exactChoice(preferences, kind, options);
  if (!modelExists(kind, choice)) {
    throw new CreatorLlmRuntimeError('CREATOR_MODEL_UNAVAILABLE', '这个模型暂时不可用，请重新选择', 409, { kind });
  }
  return {
    kind,
    providerId: choice.providerId,
    modelId: choice.modelId,
    catalogDigest: creativeModelCatalog.sourceDigest,
  };
}

function parseJsonEnvelope(text) {
  const source = bounded(text, 100_000);
  const candidates = [source];
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fence?.[1]) candidates.push(fence[1]);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(source.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new CreatorLlmRuntimeError('CREATOR_LLM_STRUCTURE_INVALID', '模型回复格式不完整，请重试');
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_SUGGESTIONS_INVALID', '模型没有给出三个有效建议');
  }
  const roles = ['recommended', 'alternative', 'execute'];
  const result = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const label = String(item.label == null ? '' : item.label).replace(/\r\n?/gu, '\n').trim();
    const sendText = String(item.sendText || item.label || '').replace(/\r\n?/gu, '\n').trim();
    const intentKind = bounded(item.intentKind, 80).toLowerCase();
    const role = bounded(item.role, 24).toLowerCase();
    if (!label || label.length > 32 || !sendText || sendText.length > 280 || !intentKind || role !== roles[index]) return null;
    return {
      label,
      sendText,
      intentKind,
      role,
      inputAssetIds: [...new Set((Array.isArray(item.inputAssetIds) ? item.inputAssetIds : [])
        .map((assetId) => bounded(assetId, 180)).filter(Boolean))].slice(0, 12),
    };
  }).filter(Boolean);
  if (result.length !== 3
    || new Set(result.map((item) => item.label)).size !== 3
    || new Set(result.map((item) => item.intentKind)).size !== 3
    || suggestionsOverlap(result)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_SUGGESTIONS_INVALID', '模型给出的建议重复或为空');
  }
  return result;
}

function suggestionFingerprint(value) {
  return bounded(value, 2_000)
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/^(?:我建议|建议|可以|请|我们|那就|现在|接下来|直接|立即|马上)+/u, '')
    .replace(/(?:吧|一下|试试|看看)$/u, '');
}

function suggestionsOverlap(items) {
  const fingerprints = items.map((item) => suggestionFingerprint(item.sendText));
  if (fingerprints.some((item) => !item) || new Set(fingerprints).size !== fingerprints.length) return true;
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      const shorter = fingerprints[left].length <= fingerprints[right].length ? fingerprints[left] : fingerprints[right];
      const longer = fingerprints[left].length > fingerprints[right].length ? fingerprints[left] : fingerprints[right];
      if (shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.62) return true;
    }
  }
  return false;
}

function normalizeWorkingBrief(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    goal: bounded(source.goal, 1_000),
    format: bounded(source.format, 400),
    audience: bounded(source.audience, 400),
    style: bounded(source.style, 1_000),
    story: bounded(source.story, 2_000),
    assets: bounded(source.assets, 2_000),
    constraints: bounded(source.constraints, 2_000),
    decisions: bounded(source.decisions, 2_000),
    openQuestion: bounded(source.openQuestion, 1_000),
  };
}

const WORKING_BRIEF_FIELDS = Object.freeze([
  'goal', 'format', 'audience', 'style', 'story', 'assets', 'constraints', 'decisions', 'openQuestion',
]);

function turnPolicy(prompt) {
  const text = bounded(prompt, 30_000);
  const delegationCue = /(?:你(?:来)?决定|你来定|你定(?:吧)?|你看着办|交给你|按你(?:的)?推荐|你帮我(?:选|定)|use your (?:best )?judg(?:e)?ment|you decide|up to you)/iu;
  const delegationNegated = /(?:不要|别|不能|不该|不想|无需|不用)[^。！？\n]{0,12}(?:你(?:来)?决定|你来定|你定(?:吧)?|你看着办|交给你|按你(?:的)?推荐|你帮我(?:选|定)|you decide|up to you)/iu;
  const endingOnlyCue = /(?:只|仅)(?:需要|要)?(?:改|修改|调整|重写|替换)(?:一下)?[^。！？\n]{0,24}(?:结尾|结局|收尾)|(?:结尾|结局|收尾)[^。！？\n]{0,16}(?:以外|之外)[^。！？\n]{0,12}(?:不变|别动)/u;
  const endingOnlyNegated = /(?:不要|别|不能|不该|不只|不只是|不仅|不光)(?:再|仅|只)?[^。！？\n]{0,12}(?:改|修改|调整|重写|替换)[^。！？\n]{0,24}(?:结尾|结局|收尾)/u;
  const styleOnlyCue = /(?:只|仅)(?:需要|要)?(?:改|修改|调整|替换|换)(?:一下)?[^。！？\n]{0,16}(?:风格|调性|气质|视觉)|(?:风格|调性|气质|视觉)[^。！？\n]{0,16}(?:以外|之外)[^。！？\n]{0,12}(?:不变|别动)/u;
  const styleOnlyNegated = /(?:不要|别|不能|不该|不只|不只是|不仅|不光)(?:再|仅|只)?[^。！？\n]{0,12}(?:改|修改|调整|替换|换)[^。！？\n]{0,16}(?:风格|调性|气质|视觉)/u;
  const noQuestionCue = /(?:不要|别|不用|无需|不需要)(?:再)?(?:反问|追问|提问|问我)|(?:不要|别)(?:再)?问|(?:do not|don't|dont|no need to) ask|without (?:asking|questions)|no questions/iu;
  const feedbackOnly = /(?:只|仅)(?:需要|要)?(?:评价|点评|评估|分析|给意见|提意见|说问题|找问题)[^。！？\n]{0,24}(?:不要|别|无需|不用|不需要)(?:改|修改|生成|出图|出视频|渲染)|(?:不要|别)(?:改|修改)[^。！？\n]{0,20}(?:不要|别)(?:生成|出图|出视频|渲染)|(?:feedback|review|critique|assessment) only|only (?:review|critique|evaluate)/iu.test(text);
  const generationProhibited = feedbackOnly || /(?:先)?(?:不要|别|不|不用|无需|不需要)(?:再|立即|现在)?(?:生成|出图|出视频|渲染)|(?:do not|don't|dont|no need to) (?:generate|render|create (?:an? )?(?:image|video))|without (?:generating|rendering)/iu.test(text);
  const requestsVideo = /(?:生成|做|制作|产出|渲染|创建)[^。！？\n]{0,20}(?:视频|短片|动画)|(?:generate|render|create|make|produce)[^.!?\n]{0,28}(?:video|animation|film|clip)/iu.test(text);
  const requestsImage = /(?:生成|做|制作|产出|渲染|创建)[^。！？\n]{0,20}(?:图片|图像|画面|海报|分镜图|封面)|(?:generate|render|create|make|produce)[^.!?\n]{0,28}(?:image|picture|poster|storyboard|cover)/iu.test(text);
  const unresolvedChoiceCue = /(?:还|尚|仍)?(?:没|未)(?:想好|决定|定|选好)|拿不定|纠结|犹豫|(?:have not|haven't|not|still not) decided|undecided|not sure|torn/iu.test(text);
  const explicitChoiceCue = /(?:还是|或者|或是|一边[^。！？\n]{0,48}一边|是否)|\b(?:or|whether|between)\b/iu.test(text);
  const delegated = delegationCue.test(text) && !delegationNegated.test(text);
  const endingOnly = endingOnlyCue.test(text) && !endingOnlyNegated.test(text);
  const styleOnly = styleOnlyCue.test(text) && !styleOnlyNegated.test(text);
  const hanCount = (text.match(/\p{Script=Han}/gu) || []).length;
  const latinCount = (text.match(/[A-Za-z]/gu) || []).length;
  const replyLanguage = latinCount >= 8 && latinCount > hanCount * 2 ? 'English' : '简体中文';
  const requestedActionType = generationProhibited ? null : (requestsVideo ? 'video' : requestsImage ? 'image' : null);
  return {
    delegated,
    criticalChoiceUnresolved: unresolvedChoiceCue && explicitChoiceCue,
    scopedBriefFields: endingOnly ? ['story'] : styleOnly ? ['style'] : [],
    feedbackOnly,
    preserveBrief: feedbackOnly,
    generationProhibited,
    requestedActionType,
    replyLanguage,
    maxQuestions: delegated || noQuestionCue.test(text) || feedbackOnly ? 0 : 1,
  };
}

function explicitlyRevisesConstraints(prompt) {
  const text = bounded(prompt, 30_000);
  return /(?:取消|删除|去掉|不再|解除|替换|改为|改成|换成|调整为|设为)[^。！？\n]{0,48}(?:限制|约束|比例|画幅|时长|字幕|文字|分辨率)|(?:限制|约束|比例|画幅|时长|字幕|文字|分辨率)[^。！？\n]{0,48}(?:取消|删除|去掉|不再|解除|替换|改为|改成|换成|调整为|设为)/u.test(text)
    || /(?:改为|改成|换成|调整为|设为|使用|采用)[^。！？\n]{0,16}(?:\d{1,4}\s*[x×:：]\s*\d{1,4}|\d+(?:\.\d+)?\s*(?:秒|分钟)|竖屏|横屏|方形|超宽屏|无字幕|有字幕|\d{3,4}[pP]|[48][kK])/u.test(text);
}

function explicitLongWorkStyle(prompt) {
  const source = bounded(prompt, 30_000);
  const chinese = source.match(
    /(?:全(?:剧|片|项目)|整(?:部|体)|统一)\s*(?:的)?\s*(?:视觉)?\s*(?:风格|调性|气质)\s*(?:固定|锁定|设定|调整|修改|改|替换|换)?\s*(?:为|成|采用|使用|：|:)\s*[“"']?([^”"'。！？\n]{2,160})/u,
  );
  if (chinese?.[1]) return bounded(chinese[1].trim(), 1_000);
  const english = source.match(
    /(?:overall|global|whole[- ](?:series|film|project)|series)\s+(?:visual\s+)?(?:style|tone)\s+(?:is|to|as|locked\s+to|set\s+to|changed\s+to|use|uses)\s+["']?([^"'.!?\n]{2,160})/iu,
  );
  return bounded(english?.[1], 1_000);
}

function mergeWorkingBrief(currentValue, incomingValue, policy = {}, prompt = '') {
  const current = normalizeWorkingBrief(currentValue);
  if (policy.preserveBrief) return current;
  const source = incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue)
    ? incomingValue : {};
  const incoming = normalizeWorkingBrief(source);
  const scoped = new Set(Array.isArray(policy.scopedBriefFields) ? policy.scopedBriefFields : []);
  const lockedLongWorkStyle = policy.sceneScoped ? explicitLongWorkStyle(prompt) : '';
  const result = {};
  WORKING_BRIEF_FIELDS.forEach((field) => {
    if (field === 'openQuestion') {
      result[field] = policy.delegated
        ? ''
        : (Object.prototype.hasOwnProperty.call(source, field) ? incoming[field] : current[field]);
      return;
    }
    if (scoped.size && !scoped.has(field)) {
      result[field] = current[field];
      return;
    }
    if (field === 'style' && policy.sceneScoped) {
      // A scene response may describe its own lighting or mood, but it must not
      // silently replace the accepted whole-work canon. An explicit user lock
      // wins verbatim; otherwise retain the canon, accepting the LLM value only
      // while the work has no style baseline yet.
      result[field] = lockedLongWorkStyle || current[field] || incoming[field];
      return;
    }
    result[field] = incoming[field] || current[field];
  });
  if (!scoped.size && current.constraints && incoming.constraints
    && !incoming.constraints.includes(current.constraints)
    && !explicitlyRevisesConstraints(prompt)) {
    result.constraints = current.constraints.includes(incoming.constraints)
      ? current.constraints
      : bounded(`${current.constraints}\n${incoming.constraints}`, 2_000);
  }
  return normalizeWorkingBrief(result);
}

function questionCount(value) {
  return (bounded(value, 100_000).match(/[?？]/gu) || []).length;
}

function firstQuestion(value) {
  const match = bounded(value, 100_000).match(/[^。！？?!\n]*[?？]/u);
  return bounded(match?.[0], 1_000);
}

function isClosedChoiceQuestion(value) {
  const question = bounded(value, 1_000).trim();
  return /(?:还是|或者|或是|二选一|是否|要不要|会不会|能不能|可不可以|你希望[^?？]{0,36}吗[?？])/u.test(question)
    || /^(?:do|does|did|would|should|could|can|is|are|was|were|have|has)\b[^?]{0,180}\?/iu.test(question)
    || /\b(?:which|whether)\b[^?]{0,120}\bor\b/iu.test(question);
}

function isGenericCreativeQuestion(value) {
  const question = bounded(value, 1_000).trim();
  return /(?:你|观众|人)[^。！？?]{0,24}(?:留下|记住|感到)[^。！？?]{0,16}(?:什么|怎样|哪种)(?:感觉|情绪|意义|理解)?/u.test(question)
    || /what[^?]{0,36}(?:feeling|emotion|meaning)[^?]{0,36}(?:audience|viewer|people|leave|remember|feel)/iu.test(question)
    || /what[^?]{0,24}(?:audience|viewer|people)[^?]{0,36}(?:feel|remember|take away)/iu.test(question);
}

function enforceQuestionContract(replyValue, briefValue, policy) {
  const replyMarkdown = bounded(replyValue, 80_000);
  const workingBrief = normalizeWorkingBrief(briefValue);
  if (policy.maxQuestions === 0) {
    if (questionCount(replyMarkdown) || workingBrief.openQuestion) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '模型没有遵守本轮不追问要求');
    }
    workingBrief.openQuestion = '';
    if (!replyMarkdown) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '模型没有按本轮要求直接给出方案，请重试');
    }
    return { replyMarkdown, workingBrief };
  }
  if (!replyMarkdown) throw new CreatorLlmRuntimeError('CREATOR_LLM_REPLY_EMPTY', '模型没有返回有效回复');
  const visibleQuestionCount = questionCount(replyMarkdown);
  if (visibleQuestionCount > 1) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '模型一次提出了多个问题');
  }
  if (visibleQuestionCount === 1) {
    const question = firstQuestion(replyMarkdown);
    if (isClosedChoiceQuestion(question)) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '模型提出了封闭式选择题，需要结合本轮语境改成一个开放问题');
    }
    if (policy.criticalChoiceUnresolved && isGenericCreativeQuestion(question)) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '关键歧义的问题过于通用；请引用本轮的具体人物或品牌冲突，询问最不能牺牲的决定依据');
    }
    workingBrief.openQuestion = question;
  } else if (workingBrief.openQuestion) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '模型把问题放进了隐藏简报却没有在回复中明确提出');
  }
  return { replyMarkdown, workingBrief };
}

function validateNaturalReply(value, replyLanguage = '简体中文', options = {}) {
  const reply = bounded(value, 80_000);
  const robotic = /(?:我已经理解(?:你的)?需求|系统(?:已经)?检测到|当前阶段(?:为|是)|已完成\s*\d+\s*\/\s*6|请选择一个明确方向|I (?:have )?(?:understood|processed) (?:your )?(?:request|requirements)|the system (?:has )?(?:detected|processed)|current phase|本轮强制对话契约|workingBrief|phaseDecision|proposedAction|CanvasPatch|NodeRun|task[_ ]?id|assetId)/iu;
  const receiptOpening = /^\s*(?:好的|收到|明白(?:了)?|没问题|我知道了|我了解了|okay|ok|sure|got it|understood|certainly)(?:[，。,:：！!\s]|$)/iu;
  if (robotic.test(reply) || receiptOpening.test(reply)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复过于机械，请重试');
  }
  if (/^\s*\|[^\n]+\|[\s\S]*\n\s*\|\s*:?-{3,}/mu.test(reply)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复排版过于复杂，请重试');
  }
  const maximumLength = options.sceneDraft === true
    ? 12_000 : replyLanguage === 'English' ? 3_600 : 2_400;
  const paragraphCount = reply.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean).length;
  if (reply.length > maximumLength || paragraphCount > (options.sceneDraft === true ? 60 : 6)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复过长，需要保留创作判断并压缩成简短自然段');
  }
  return reply;
}

function suggestsGeneration(value) {
  const text = bounded(value, 20_000)
    .replace(/(?:先)?(?:不要|别|不|不用|无需|不需要|暂不)(?:再|立即|现在)?(?:生成|出图|出视频|渲染)/giu, '')
    .replace(/(?:do not|don't|dont|no need to) (?:generate|render|create (?:an? )?(?:image|video))|without (?:generating|rendering)/giu, '');
  return /(?:生成|出图|出视频|渲染|generate|render|create (?:an? )?(?:image|video))/iu.test(text);
}

function suggestsEditing(value) {
  const text = bounded(value, 20_000)
    .replace(/(?:不|不要|别|无需|不用|不需要)(?:再|立即|现在)?(?:改|修改|调整|细化|优化|重写|生成|出图|出视频|渲染)/giu, '')
    .replace(/(?:不|不要|别|无需|不用|不需要)(?:提出|给出)?(?:任何)?修改(?:方案|建议)?/giu, '')
    .replace(/(?:do not|don't|dont|no need to|without) (?:change|edit|revise|refine|rewrite|generate|render)/giu, '');
  return /(?:改|修改|调整|细化|优化|重写|生成|出图|出视频|渲染|change|edit|revise|refine|rewrite|generate|render)/iu.test(text);
}

function suggestionSimilarity(left, right) {
  const leftFingerprint = suggestionFingerprint(left);
  const rightFingerprint = suggestionFingerprint(right);
  if (leftFingerprint.length < 2 || rightFingerprint.length < 2) {
    return leftFingerprint === rightFingerprint ? 1 : 0;
  }
  const containsHan = /\p{Script=Han}/u.test(`${left}${right}`);
  if (!containsHan) {
    const stopWords = new Set([
      'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or',
      'that', 'the', 'this', 'to', 'with', 'without', 'we', 'you', 'your',
    ]);
    const tokens = (value) => new Set((bounded(value, 2_000).toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/gu) || [])
      .filter((token) => token.length > 1 && !stopWords.has(token)));
    const a = tokens(left);
    const b = tokens(right);
    const union = new Set([...a, ...b]);
    if (!union.size) return leftFingerprint === rightFingerprint ? 1 : 0;
    return [...a].filter((item) => b.has(item)).length / union.size;
  }
  const bigrams = (value) => {
    const text = suggestionFingerprint(value);
    const result = new Set();
    for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
    return result;
  };
  const a = bigrams(left);
  const b = bigrams(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function suggestionRolesAreMeaningfullyDistinct(suggestions) {
  const recommended = `${suggestions[0].label}\n${suggestions[0].sendText}`;
  const alternative = `${suggestions[1].label}\n${suggestions[1].sendText}`;
  const execute = `${suggestions[2].label}\n${suggestions[2].sendText}`;
  const alternativeChangesCreativeAxis = /(?:改|换|转为|转成|另一|反过来|换个|从[^。！？\n]{0,18}视角|change|shift|switch|drop|reframe|reverse|instead|different|alternative|from [^.!?\n]{0,36} perspective|make [^.!?\n]{0,28} (?:lead|the subject)|stay tight|move (?:closer|wider)|follow [^.!?\n]{0,24} close)/iu.test(alternative);
  const closureCue = /(?:锁定|就定|定下|确认采用|采用这版|保持当前|进入下一|不再讨论|结束评价|评价结束|lock|commit|confirm|approve|keep (?:this|the|it)|move to the next|advance to the next|proceed to the next|end (?:the )?(?:review|discussion)|finish (?:the )?(?:review|discussion))/iu;
  return alternativeChangesCreativeAxis
    && closureCue.test(execute)
    && !closureCue.test(recommended)
    && !closureCue.test(alternative);
}

function suggestionPolicyViolation(value, policy = {}) {
  const suggestions = value.map((item) => ({ ...item, inputAssetIds: [...item.inputAssetIds] }));
  const english = policy.replyLanguage === 'English';
  const maximumLabelLength = english ? 28 : 14;
  if (suggestions.some((item) => item.label.length > maximumLabelLength || item.sendText.length > 280)) {
    return english ? 'A suggestion is too long for the compact choice UI.' : '建议文字过长，不适合简洁选择按钮。';
  }
  const genericLabel = english
    ? /^(?:next step|continue|keep going|recommended next step|try another direction|another direction|alternative|change direction|lock (?:this|the) (?:approach|plan|direction|idea|version)|keep (?:this|the) (?:approach|plan|direction|idea|version)|proceed|move forward)$/iu
    : /^(?:下一步|继续|继续推进|推荐下一步|换个方向|另一个方向|备选方向|锁定当前方向|锁定这个方向|锁定当前方案|直接执行)$/u;
  if (suggestions.some((item) => genericLabel.test(item.label.trim()))) {
    return english
      ? 'Every compact suggestion label must name the concrete creative choice, not a generic workflow action.'
      : '每个简短建议标题都要说清具体创作选择，不能只写通用流程动作。';
  }
  const visibleText = suggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n');
  if (policy.feedbackOnly && suggestsEditing(visibleText)) {
    return english ? 'Feedback-only suggestions proposed editing or generation.' : '只评价模式下的建议包含修改或生成。';
  }
  if (policy.feedbackOnly) {
    const recommended = `${suggestions[0].label}\n${suggestions[0].sendText}`;
    const alternative = `${suggestions[1].label}\n${suggestions[1].sendText}`;
    const execute = `${suggestions[2].label}\n${suggestions[2].sendText}`;
    const hasDecisionValue = /(?:给出|得出|明确)(?:结论|判断)|(?:判断|确认)[^。！？\n]{0,20}(?:能否|是否值得)|(?:值得|不值得|足够|不足以|还不够|可以|不可以|不该|不能|尚不能|还不能|适合|不适合|应该|已能)[^。！？\n]{0,24}(?:继续|进入|往下|推进|停在|保持)|(?:继续|先|应该|需要)[^。！？\n]{0,16}停在|(?:最大|最关键|最高)(?:风险|问题|优先级)|(?:go\s*\/?\s*no[- ]?go|clear verdict|readiness|ready to proceed|not ready to proceed|ready to (?:advance|move on)|not ready to (?:advance|move on)|should (?:advance|hold|stay)|can (?:advance|move on)|cannot (?:advance|move on)|biggest risk|highest priority)/iu.test(recommended);
    const hasIndependentLens = /(?:观众|受众|品牌|叙事|剪辑|镜头|节奏|视觉|表演|声音|导演|市场|audience|viewer|brand|narrative|editing|shot|rhythm|visual|performance|sound|director|market)/iu.test(alternative);
    const clearlyEndsReview = /(?:评价|点评|分析)(?:就)?(?:到此为止|结束)|结束(?:评价|点评|分析)|保持现状|维持现有|不再继续|(?:end|stop) (?:the )?(?:review|critique)|(?:review|critique) (?:ends|stops) here|keep (?:it|this) as is/iu.test(execute);
    if (!hasDecisionValue || !hasIndependentLens || !clearlyEndsReview) {
      return english
        ? 'Feedback-only choices need three distinct jobs: a clear proceed-or-hold verdict, a different audience/brand/craft lens, and an explicit end-review choice.'
        : '只评价模式的三个选择必须分工明确：是否值得继续的结论、另一个受众/品牌/创作视角，以及结束评价。';
    }
  }
  if (policy.generationProhibited && suggestsGeneration(visibleText)) {
    return english ? 'Suggestions violated the no-generation boundary.' : '建议违反了用户不生成的边界。';
  }
  if (policy.scopedBriefFields?.length) {
    const recommended = suggestions[0];
    const asksForFullDeliverable = /完整.{0,8}(?:脚本|分镜)|(?:脚本|分镜).{0,8}完整|full.{0,12}(?:script|storyboard)|(?:script|storyboard).{0,12}full/iu.test(recommended.sendText);
    const hasScopedCraft = /镜头|景别|节奏|动作|表演|声音|音效|光线|色彩|转场|构图|留白|细化|优化|打磨|精修|小稿|草稿|试稿|尾段|结尾段落|shot|rhythm|performance|sound|light|color|transition|composition|draft|refine|polish/iu.test(recommended.sendText);
    if (asksForFullDeliverable || !hasScopedCraft) {
      return english ? 'The recommended suggestion escaped the user-scoped edit.' : '推荐建议超出了用户限定的修改范围。';
    }
  }
  if (policy.criticalChoiceUnresolved) {
    const recommended = `${suggestions[0].label}\n${suggestions[0].sendText}`;
    const execute = `${suggestions[2].label}\n${suggestions[2].sendText}`;
    const validatesOneSmallPiece = /(?:验证|检验|测试|试一个|试一幕|试[^。！？\n]{0,12}(?:一场|那场|这一场|一幕|片段|样段|小段)|先(?:只|就)?(?:写|做|看)[^。！？\n]{0,48}(?:那场|这一场|一场|一幕|片段|样段|小段)|关键(?:一幕|场景|戏)|单个片段|最小样段|validate|test|probe|sample (?:scene|moment|beat)|(?:draft|write|try) (?:only )?(?:one|a single) (?:scene|moment|beat))/iu.test(recommended);
    const positiveRecommended = recommended
      .replace(/(?:先)?(?:不要|别|不|无需|不用|不需要)(?:再|先)?(?:写|做|产出)?(?:一份)?(?:(?:完整|全片|整支|整部)(?:短片|影片|视频|作品|故事)?(?:的)?(?:大纲|脚本|分镜|成片)?|(?:短片|影片|视频|作品|故事)?(?:大纲|脚本|分镜))(?:\s*(?:或|和|、|\/)\s*(?:(?:完整|全片|整支|整部)(?:短片|影片|视频|作品|故事)?(?:的)?(?:大纲|脚本|分镜|成片)?|(?:短片|影片|视频|作品|故事)?(?:大纲|脚本|分镜)))*/giu, '')
      .replace(/(?:do not|don't|dont|no need to|without)(?:\s+(?:write|create|make|produce))?\s+(?:a\s+)?(?:(?:full|complete)\s+)?(?:(?:film|video|project|story)\s+)?(?:outline|script|storyboard|finished film)(?:\s*(?:or|and|\/)\s*(?:a\s+)?(?:(?:full|complete)\s+)?(?:(?:film|video|project|story)\s+)?(?:outline|script|storyboard|finished film))*/giu, '');
    const advancesFullDeliverable = /(?:完整|全片|整支|整部|大纲|脚本|分镜|full (?:outline|script|storyboard)|complete (?:outline|script|storyboard))/iu.test(positiveRecommended);
    const explicitlyLocksChoice = /(?:锁定|就定|定下|不再讨论|进入下一|进入(?:脚本|素材|分镜)|lock|commit|settle|move to the next|advance to the next)/iu.test(execute);
    if (!validatesOneSmallPiece || advancesFullDeliverable || !explicitlyLocksChoice) {
      return english
        ? 'For an unresolved high-impact choice, recommended must test one small scene or beat; execute alone may lock the direction and advance.'
        : '重大选择尚未锁定时，推荐选项只能用一个小场景或片段验证正文倾向；只有执行选项可以锁定方向并推进。';
    }
  }
  const pairSimilarities = [
    suggestionSimilarity(suggestions[0].sendText, suggestions[1].sendText),
    suggestionSimilarity(suggestions[0].sendText, suggestions[2].sendText),
    suggestionSimilarity(suggestions[1].sendText, suggestions[2].sendText),
  ];
  const maximumSimilarity = Math.max(...pairSimilarities);
  const sharedBriefFactsOnly = maximumSimilarity < 0.72 && suggestionRolesAreMeaningfullyDistinct(suggestions);
  if (!policy.feedbackOnly && maximumSimilarity >= 0.34 && !sharedBriefFactsOnly) {
    return english ? 'The three suggestions are too similar.' : '三个建议的实际意图过于相似。';
  }
  return '';
}

function enforceSuggestionPolicy(value, policy = {}) {
  const suggestions = value.map((item) => ({ ...item, inputAssetIds: [...item.inputAssetIds] }));
  const violation = suggestionPolicyViolation(suggestions, policy);
  if (violation) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_SUGGESTIONS_POLICY_INVALID', violation);
  }
  return suggestions;
}

function normalizeReplyLayout(value) {
  return bounded(value, 80_000)
    .split('\n')
    .filter((line) => !/^\s*```/u.test(line))
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+/u, '')
      .replace(/^\s*(?:[-*+]|\d{1,2}[.)])\s+/u, '')
      .replace(/^\s*>\s?/u, ''))
    .join('\n')
    .replace(/\*\*([^*\n]+)\*\*/gu, '$1')
    .replace(/__([^_\n]+)__/gu, '$1')
    .replace(/`([^`\n]+)`/gu, '$1')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizePhaseDecision(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const phase = bounded(source.phase, 24).toLowerCase();
  const transition = bounded(source.transition, 24).toLowerCase();
  if (!['idea', 'script', 'assets', 'shots', 'candidates', 'delivery'].includes(phase)
    || !['advance', 'stay', 'revise'].includes(transition)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_PHASE_INVALID', '模型没有给出有效的创作阶段判断');
  }
  return { phase, transition, reason: bounded(source.reason, 600) };
}

function exactCatalogParameter(rawValue, choices, fallback, label) {
  const available = Array.isArray(choices) ? choices : [];
  const raw = String(rawValue == null ? '' : rawValue).trim();
  if (!available.length) return raw || fallback;
  if (!raw) return fallback || available[0];
  const match = available.find((item) => String(item).toLowerCase() === raw.toLowerCase());
  if (match !== undefined) return match;
  throw new CreatorLlmRuntimeError(
    'CREATOR_LLM_ACTION_MODEL_MISMATCH',
    `所选模型不支持${label} ${raw}；可用值为 ${available.join('、')}，请据此修正生成动作`,
  );
}

function validateActionAssetCompatibility(modelEntry, inputAssetIds, attachments) {
  const parameters = modelEntry?.parameters && typeof modelEntry.parameters === 'object'
    ? modelEntry.parameters : {};
  const byId = new Map((Array.isArray(attachments) ? attachments : [])
    .map((item) => [bounded(item?.assetId, 180), bounded(item?.kind, 16).toLowerCase()])
    .filter(([assetId]) => assetId));
  const counts = { image: 0, video: 0, audio: 0 };
  for (const assetId of inputAssetIds) {
    const kind = byId.get(assetId);
    if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
  }
  const specs = [
    ['image', 'supportsImages', 'maxReferenceImages', '图片'],
    ['video', 'supportsVideos', 'maxReferenceVideos', '视频'],
    ['audio', 'supportsAudios', 'maxReferenceAudios', '音频'],
  ];
  for (const [kind, supportField, maximumField, label] of specs) {
    if (!counts[kind]) continue;
    if (Object.prototype.hasOwnProperty.call(parameters, supportField) && parameters[supportField] !== true) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_ACTION_MODEL_MISMATCH',
        `所选模型不支持参考${label}，不能静默丢掉素材；请换用兼容模型或取消这次生成动作`,
      );
    }
    const maximum = Number(parameters[maximumField]);
    if (Number.isFinite(maximum) && maximum >= 0 && counts[kind] > maximum) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_ACTION_MODEL_MISMATCH',
        `所选模型最多支持 ${maximum} 个参考${label}，当前动作绑定了 ${counts[kind]} 个`,
      );
    }
  }
}

function normalizeActionParameters(type, rawParameters, modelParameters) {
  const source = rawParameters && typeof rawParameters === 'object' && !Array.isArray(rawParameters)
    ? rawParameters : {};
  return type === 'image'
    ? {
        ratio: bounded(source.ratio, 16) || '16:9',
        count: Math.max(1, Math.min(4, Math.trunc(Number(source.count) || 1))),
      }
    : {
        ratio: exactCatalogParameter(
          bounded(source.ratio, 16),
          modelParameters.ratios,
          bounded(modelParameters.defaultRatio, 16) || '16:9',
          '比例',
        ),
        duration: Number(exactCatalogParameter(
          source.duration,
          modelParameters.durations,
          Number.isFinite(Number(modelParameters.defaultDuration)) ? Number(modelParameters.defaultDuration) : 6,
          '时长',
        )),
        resolution: exactCatalogParameter(
          bounded(source.resolution, 24),
          modelParameters.resolutions,
          bounded(modelParameters.defaultResolution, 24) || '720p',
          '分辨率',
        ),
      };
}

function assertActionPromptDoesNotLeak(prompt) {
  if (/(?:\bscene_[a-f0-9_-]{8,}\b|\bshot_[a-f0-9_-]{8,}\b|baseWorkRevision|baseSceneRevision|contextDigest|workDigest|entryRefs|exitState|continuityResetEntityIds|shotPlanDigest)/iu.test(prompt)) {
    throw new CreatorLlmRuntimeError(
      'CREATOR_LLM_ACTION_CONTEXT_LEAK',
      '生成提示词混入了内部场次或镜头信息，请重试',
    );
  }
}

function normalizeAction(value, preferences, policy = {}, attachments = [], sceneContext = null) {
  if (policy.generationProhibited) return null;
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', '模型给出的生成动作无效');
  }
  const type = bounded(value.type, 16).toLowerCase();
  if (!['image', 'video'].includes(type)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', '只支持图片或视频生成动作');
  }
  if (policy.requestedActionType && type !== policy.requestedActionType) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_TYPE_MISMATCH', '模型给出的生成类型与用户要求不一致');
  }
  const prompt = bounded(value.prompt, 20_000);
  if (!prompt) throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', '生成动作缺少提示词');
  assertActionPromptDoesNotLeak(prompt);
  const snapshot = modelSnapshot(type, preferences);
  const modelEntry = catalogModel(type, snapshot);
  const modelParameters = modelEntry?.parameters && typeof modelEntry.parameters === 'object'
    ? modelEntry.parameters : {};
  const parameters = normalizeActionParameters(type, value.parameters, modelParameters);
  const inputAssetIds = [...new Set((Array.isArray(value.inputAssetIds) ? value.inputAssetIds : [])
    .map((item) => bounded(item, 180)).filter(Boolean))].slice(0, 12);
  validateActionAssetCompatibility(modelEntry, inputAssetIds, attachments);
  const knownShotIds = new Set((Array.isArray(sceneContext?.currentShotPlan?.shots)
    ? sceneContext.currentShotPlan.shots : []).map((shot) => bounded(shot?.shotId, 180)).filter(Boolean));
  const shots = sceneContext && Array.isArray(value.shots) ? value.shots.slice(0, 12).map((shot, index) => {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', '镜头计划格式无效');
    }
    const shotPrompt = bounded(shot.prompt, 20_000);
    if (!shotPrompt) throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', `第 ${index + 1} 个镜头缺少提示词`);
    assertActionPromptDoesNotLeak(shotPrompt);
    const requestedShotId = bounded(shot.shotId, 180) || null;
    if (requestedShotId && !knownShotIds.has(requestedShotId)) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', '模型发明了不存在的镜头 ID，请重试');
    }
    const shotInputAssetIds = [...new Set((Array.isArray(shot.inputAssetIds)
      ? shot.inputAssetIds : inputAssetIds).map((item) => bounded(item, 180)).filter(Boolean))].slice(0, 12);
    validateActionAssetCompatibility(modelEntry, shotInputAssetIds, attachments);
    return {
      shotId: requestedShotId,
      sourceKey: bounded(shot.sourceKey || shot.key, 180) || null,
      title: bounded(shot.title, 240) || `镜头 ${index + 1}`,
      purpose: bounded(shot.purpose, 1_000),
      prompt: shotPrompt,
      parameters: normalizeActionParameters(type, shot.parameters || parameters, modelParameters),
      inputAssetIds: shotInputAssetIds,
    };
  }) : [];
  if (sceneContext && Array.isArray(value.shots) && !shots.length) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_INVALID', '镜头计划不能为空');
  }
  return {
    id: `action-${crypto.randomUUID()}`,
    type,
    prompt,
    parameters,
    inputAssetIds,
    modelSnapshot: snapshot,
    ...(shots.length ? { shots } : {}),
  };
}

function systemPrompt() {
  return [
    '你是 Creator Agent，一位说人话、懂真实创作流程的导演和创作搭档。',
    '根据用户真正意图直接推进作品；信息足够就给具体方案。任何一轮最多只能问一个会显著改变结果的问题。',
    '用户说“你决定”“你来定”“你看着办”时必须自行采用最合理默认值并直接推进，不能追问。',
    '用户说“只改结尾”等限定修改时，只更新限定部分，workingBrief 的其他事实、决定和约束必须原样保留。',
    '不要解释内部节点、工作流、Provider、Run、任务 ID、版本、收据或技术参数。',
    '不得出现价格、费用、余额、额度、账单、币种、单价或消耗估算。',
    '回复简洁自然，像可靠的创作搭档，通常 2 到 5 个短段落。不要复述需求，不要输出机械状态播报或表格式检查单。',
    '开头直接进入作品内容或你的创作判断，不要用“好的、收到、明白、没问题、已按要求、接下来”作为流程回执。',
    'replyMarkdown、三个建议的 label 和 sendText 必须跟随用户本轮原话的主语言；英文用户就全部用自然英文，中文用户就全部用自然中文。JSON 字段名保持不变，用户给出的专名不要翻译。',
    '只有真正会改变整部作品的缺口才追问。必须追问时，先给你的明确倾向和一句理由，再只问一个开放式问题。问题必须引用本轮的具体人物、品牌或故事冲突，询问这个决定最不能牺牲的依据；不得固定使用“想留下什么感觉/情绪/意义”这类通用句式。不要把用户已经说出的 A/B 重新写成“还是、或者、或是”的选择题，也不要问“是否、要不要、你希望……吗”这类只能回答是或否的问题。',
    'replyMarkdown 虽保留字段名，但正文只能是纯文本短段落；不要 Markdown 标题、项目符号、编号列表、引用、代码围栏或加粗符号。',
    '你会收到 workingBrief；请在同一次回复中返回更新后的完整 workingBrief，不确定的信息保持为空，不得猜测素材内容。',
    '如果收到“当前长剧本场次上下文”，只讨论并推进这一场。人物、关系与地点只采用其中的 baseline、relationships、最近确认状态和当前场原文；不得凭聊天记忆改写其他场，不得把未出场人物、上一场摘要、未来剧情、sceneId、revision、digest、entryRefs 或 exitState 写进最终图像/视频提示词。',
    '收到当前长剧本场次上下文时，scenePatch 可为 null；如果本轮补全或修改本场事实，必须返回 t8-creator-scene-patch-v1，并逐字复制上下文中的 sceneId、scenePartId、baseWorkRevision、baseSceneRevision、contextDigest，只改 allowedPaths。长场只处理当前 scenePartId，不提前声称整场完成。新人物、地点、服装或道具放进 entityProposals，并使用本响应内唯一 tempId；不要自行发明永久 ID。',
    '你会收到实际图片或视频抽帧。回答必须引用你真实观察到的主体、构图、色彩、动作或镜头证据；音频/文件若只有元数据就明确按元数据处理。',
    'phaseDecision 只能表达对创作阶段的建议：idea/script/assets/shots/candidates/delivery；系统会用真实动作证据裁决是否推进。',
    '你会收到当前可信阶段。stay 必须保持当前阶段；advance 最多建议紧邻的下一阶段，不能跳级；revise 只用于返回更早阶段修改。信息很完整也要按相邻阶段推进。',
    '最后提供三个真正不同的下一步建议，顺序和 role 固定为 recommended、alternative、execute；intentKind 必须互不相同。',
    '三个建议都是替用户回填输入框的真实意图，必须遵守用户明确要求、选中文字、锁定事实和本轮限定修改范围。alternative 必须用“改成/换成/换个视角”或自然英文中的 change/shift/drop/reframe 等明确改变一个表现轴，不能只改写 recommended；但不能撤销用户刚指定的事实或把限定范围外的内容改掉。',
    'recommended 给最值得先看或先补的一步，产出应当可继续修改，并且必须沿用 replyMarkdown 已经给出的明确倾向；不能重新比较用户原来的 A/B、两种方案或让用户再决定。alternative 才承载实质不同的创意方向，不能只替换一个形容词。execute 也必须沿用正文的明确倾向，表示不再讨论，直接锁定当前结论或执行已经明确的动作；不得写成“先不定、暂时留白、以后再说”或退回未决状态。',
    '当用户已经给出“只改结尾”等精确修改时，recommended 应在允许范围内优化镜头、节奏、表演、声音、光线或转场，给一份可继续修改的小稿；不能只是复述新结尾后再要求写完整脚本。execute 才负责接受并锁定这次修改。',
    'recommended 与 execute 不能要求同一种交付物、推进到同一个结果，不能只是“先做”和“直接做”的区别；如果 recommended 已经要写脚本、分镜或提示词，execute 就应锁定现有决定或执行另一项明确动作。execute 要短，使用“锁定/采用并进入下一步”或自然英文中的 lock/commit/move to the next stage 表明结束讨论，不要重复正文和 recommended 里的长串创意事实。英文建议允许重复必要的作品事实，但三个动作职责必须分别是可修改推进、实质换轴、锁定推进。',
    '如果用户正在一个会改变整部作品的选择之间犹豫，recommended 只用一个关键场景、一幕或最小样段验证 replyMarkdown 的倾向，不得先写完整大纲、脚本或分镜；execute 才负责锁定这个方向并进入下一环节。',
    '每个建议 label 使用短口语（中文不超过 14 个汉字，英文不超过 28 个字符），sendText 不超过 280 个字符，是点击后能独立表达完整意图且不扩大 label 含义的自然句子；三条不能是同一句话加“直接、立即、试试”等前后缀。',
    '用户说“不要生成、先别生成、只评价”时，proposedAction 必须为 null，三个建议也不能偷偷改写成生成、出图或出视频。用户明确说只评价且不要改时，workingBrief 原样保留，三个选择必须分工：recommended 给“是否值得继续/能否进入下一阶段”的明确评价结论，alternative 改用一个具体的受众、品牌或创作视角评价，execute 结束评价并保持现状；不能建议修改作品。',
    '当用户明确要求生成图片或视频且信息已经够用时，给 proposedAction；否则为 null。',
    '如果用户要求把本轮提供的图片做成视频，proposedAction.type 必须为 video，并把实际使用的图片 assetId 放入 inputAssetIds。',
    'proposedAction.type 只能是 image 或 video。图像 parameters 只用 ratio/count；视频只用 ratio/duration/resolution。',
    '输出严格 JSON，不要 Markdown 代码围栏：',
    JSON.stringify({
      schema: CREATOR_LLM_RESPONSE_SCHEMA,
      replyMarkdown: '自然语言回复',
      workingBrief: {
        goal: '', format: '', audience: '', style: '', story: '', assets: '', constraints: '', decisions: '', openQuestion: '',
      },
      phaseDecision: { phase: 'idea', transition: 'stay', reason: '判断依据' },
      scenePatch: null,
      suggestions: [
        { label: '细化雨夜镜头', sendText: '发送给助手的完整自然语言', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
        { label: '改用单人视角', sendText: '发送给助手的完整自然语言', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
        { label: '锁定分开结尾', sendText: '发送给助手的完整自然语言', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
      ],
      proposedAction: {
        type: 'image',
        prompt: '可直接生成的专业提示词',
        parameters: { ratio: '16:9', count: 1 },
        inputAssetIds: [],
      },
    }),
  ].join('\n');
}

function longSceneSystemPrompt(mode = 'scene-edit') {
  const sceneDraft = mode === 'scene-draft';
  return [
    '你是 Creator Agent 的逐场创作搭档。当前长剧本场次上下文是本轮唯一权威来源；只推进当前场，不复述整部长剧本，也不凭聊天记忆补写其他场。',
    ...(sceneDraft ? [
      '这一轮的第一优先级是直接交付一场好戏，不是解释想法。用户原话中明确的人物关系、事件、结果方向、数量、时长、先后关系和否定约束都是硬条件：只能补全未说明处，不能为了制造反转而改成相反结果，也不能额外增加同类人物或物品改变明确计数；“只用一杯/一个/一件”表示整场只能有一个对应实物，换成盒、瓶等近义量词也不等于可以再拿第二个，人物只能传递、共享或继续使用同一个。用户明确某人最终做成一件事时，结尾必须用可见动作证明它确实发生；用户要求关系向前一步时，结尾必须让双方共同接受一个很小但清楚的下一步，不能只靠对视、碰手、收藏纪念物、影子或各自离开暗示。动笔前在心里逐项对齐原话，再检查：每一段都能画成分镜，人物的目标被一个具体事物阻挡，决定是被动作做出而不是被旁白宣布，结尾有一个可见变化。再全文搜索“第二、另一、又一、再拿、各自、每人”等增量词，凡与用户明确单数约束冲突就删掉或改为同一实物的交接。再把对白念出声：台词不能重复道具已经表达的信息，不能直说主题或决定，每句至少让对方的下一个动作发生变化。只补推动核心关系、阻力或转折的细节，通常不再增加第二个象征道具；优先使用人在当下情境中会自然做出的普通动作和可在现场取得的常见机位；不要堆叠象征道具、刻意摆拍、依赖观众看不见的信息或用高难度机位替代戏剧动作。关键道具的来源、位置和去向必须连贯；影响转折的信息必须让观众看懂，结尾意象必须在前文出现过；辅助人物若不推动阻力或转折就删掉。任一项不成立就先重写，再输出 JSON。',
    ] : []),
    '先理解用户这轮真正想改什么。信息够就直接给具体创作判断；只有一个会显著改变当前场结果的缺口时才问一个开放式问题。用户说“你决定/你来定/你看着办”时直接采用合理选择，不追问。',
    sceneDraft
      ? '场稿不追问，不写“好的、收到、明白、没问题、接下来”等流程回执，不复述需求，不写分析、检查单或机械状态。'
      : '回复像真人创作搭档，简洁、自然、具体，通常 2 到 4 个短段落。开头直接说这场怎么处理，不用流程回执，不复述需求，不写机械状态、表格或检查单。',
    'replyMarkdown 只用纯文本短段落，不要标题、项目符号、编号、引用、代码围栏或加粗。replyMarkdown 和全部建议跟随用户本轮主语言，专名保持原文。',
    '不得提及节点、工作流、Provider、Run、任务 ID、版本、收据、内部字段或费用；不得出现价格、余额、额度、账单、币种、单价、cost、price、billing、balance、quota。',
    '人物、地点、服装、道具、人物关系和风格只采用当前上下文中的 scene.sourceText、activeEntities、mentionedEntities、relationships、styleCanon、最近确认状态和用户本轮原话。activeEntities 是当前已出场实体；mentionedEntities 只是当前原文/意图精确提到的已有候选，只有确实需要出场时才把其 entityId 加入 patch.activeEntityIds。baseline 是长期设定，最近确认状态和 relationships 是本场之前已经生效的入场事实；未知处保持未知，不得借未来场次或未出场人物补全。',
    'workingBrief 必须返回完整对象。只合并用户本轮明确的新事实；用户明确写出“全剧/整体风格固定为……”时，style 必须逐字保存该风格；既有人设、风格、约束和已确认决定不得被稀疏回复清空，也不得用本场光线或情绪替换全剧风格。',
    '上下文 mode 为 scene-draft 时，用户已主动选择高质量逐场创作。无论想法多短，都要代用户做合理导演选择，直接写出可修改、可拍摄的当前场正文，不能只给分析、确认或摘要。镜头只能看到和听到：“他终于决定辞职”是坏稿；“他把门禁卡放在老板的冷咖啡旁，手机上三次挂断妻子来电，最后只拿走女儿画的纸飞机”才是可见、可演的动作链。不得照搬这个例子，必须为用户的具体场景另找动作和道具。禁止用内心、回忆概括、主题总结或作者评语代替戏；禁用“深吸一口气、攥紧拳头、泪水混着雨水、脚步越来越坚定、背影消失在夜色”等套动作。对白要有潜台词，不能让人物直说“我要走了/我不再回来”。用户未指定时长时，写约 45–90 秒，用 6–10 个易读短段建立空间与人物、给出可见目标或阻力、通过动作/对白升级、发生明确转折，最后停在有余味且可继续下一场的具体画面上；中文通常 350–900 字，英文通常 180–450 词。replyMarkdown 从场景立即开始，只写场景、可见动作、必要对白或声音，每段都必须发生新动作或反应，段落间留空行，前后不加解释。scenePatch 必须存在，patch.draftText 必须与 replyMarkdown 完全相同并保存完整场稿。已有 scene.draftText 时，按本轮意图给出完整修订稿，不能只返回修改说明。',
    '上下文 mode 为 import-preview 时，这是首次导入预览：scenePatch 必须为 null，只整理完整 workingBrief、自然回复和三个下一步建议，不要提前创建人物或修改场次。mode 为 scene-edit 时，若本轮修改了当前场事实，必须返回 t8-creator-scene-patch-v1：sceneId、scenePartId、baseWorkRevision、baseSceneRevision、contextDigest 必须逐字复制当前上下文；patch 只能使用 allowedPaths，不能改其他场或本场其他段。scenePartCount 大于 1 时只处理当前 scenePartId 对应、由 scenePartIndex 指向的原文；不能假装已经看过未提供的后续段，也不能提前宣称整场完成。上下文 requiredPaths 中列出的字段必须出现在 patch；requiredPaths 含 exitState 时，必须按当前出场实体或本响应 tempId 保存用户明确要求的本场结束状态，不能留空。exitState 的每个值必须是 JSON 对象而不是一句字符串，例如 {"wardrobe":"黑色风衣","injury":"左手缠着绷带","props":["旧车票"]}。requiredContinuityBySubject 会逐人列出必须保留的原文事实：每个人对应的同一个 exitState 对象只能满足自己的 terms，不能把甲的服装、乙的伤势或道具混到另一个实体键。',
    '新人物、新地点、新服装或新道具放入 scenePatch.entityProposals，它与 scenePatch.patch 并列，绝不能放进 patch 里；每项使用本响应内唯一 tempId，并给出 kind、name、description、baseline。kind 只能逐字使用 character、location、wardrobe、prop 四者之一，服装必须用 wardrobe，不能用 costume。新地点的 tempId 必须同时写入 patch.locationId 或 patch.activeEntityIds；其他新实体的 tempId 必须同时写入 patch.activeEntityIds，本场结束状态使用同一 tempId 作为 patch.exitState 的键。不要自行生成永久 ID，也不要把新设定倒灌到之前场次。',
    '本场新建或改变人物关系时才返回 relationshipProposals；每项给出唯一 tempId、subjectEntityId、objectEntityId、type、description、state、active，并让两端人物都在 patch.activeEntityIds 中。subject/object 使用现有 entityId 或本响应人物 tempId；effectiveFromSceneId 必须逐字复制当前 sceneId。关系只从当前场生效，不能倒灌到之前场次；本轮不改关系时不要返回该字段。',
    '只有用户明确说某个人物从本场起独立、重置连续性或不继承此前状态时，才把该人物的 entityId/tempId 写入 patch.continuityResetEntityIds；它必须同时在 patch.activeEntityIds 中。不要把普通换装、换地点或新关系擅自当作连续性断点。',
    'phaseDecision 只能在 idea/script/assets/shots/candidates/delivery 中选择；stay 保持当前阶段，advance 最多前进一个相邻阶段，revise 只返回更早阶段。',
    '最后必须给恰好三个不同建议，顺序和职责固定：recommended/recommended-next-step 给最值得继续细化的当前场小步；alternative/alternative-direction 用“改成/换成/换个视角”或 change/shift/drop/reframe 明确改变一个表现轴；execute/execute-or-confirm 用“锁定/采用并进入下一步”或 lock/commit/move to the next scene 确认当前结论。',
    '三条 label 要短口语（中文不超过 14 字，英文不超过 28 字符）；sendText 不超过 280 字符，点击后能独立表达完整意图。recommended 与 execute 不能只是同一句话加“先/直接”，alternative 不能撤销用户刚锁定的事实。',
    '用户说不要生成、先别生成或只评价时，proposedAction 必须为 null，建议也不能偷渡生成。只有用户明确要求生成图片或视频且当前场信息足够时才给 proposedAction。',
    'proposedAction.type 只能是 image 或 video。图片 parameters 只含 ratio/count；视频只含 ratio/duration/resolution。用户要求生成当前场多个镜头时，proposedAction.shots 必须按实际镜头逐项给出 1 到 12 项，每项只含 shotId、sourceKey、title、purpose、prompt、parameters、inputAssetIds；已有 currentShotPlan 时，编辑原镜头必须逐字复用对应 shotId，新镜头的 shotId 必须为 null，绝不能发明 ID。parameters.count 是单个镜头候选数，不是镜头总数。',
    '顶层 prompt 是整组镜头的简短生成摘要；每个 shots[].prompt 才是独立提交的一镜提示词。所有提示词只能写可见画面、动作、镜头、声音和风格，不得包含 sceneId、shotId、revision、digest、entryRefs、exitState、其他场摘要、未来剧情或未出场人物。若只生成一个镜头，可以省略 shots，由系统建立单镜计划。',
    '只输出一个严格 JSON 对象，不要代码围栏：',
    JSON.stringify({
      schema: CREATOR_LLM_RESPONSE_SCHEMA,
      replyMarkdown: '针对当前场的自然语言回复',
      workingBrief: {
        goal: '', format: '', audience: '', style: '', story: '', assets: '', constraints: '', decisions: '', openQuestion: '',
      },
      phaseDecision: { phase: 'script', transition: 'stay', reason: '当前场判断依据' },
      scenePatch: {
        schema: 't8-creator-scene-patch-v1',
        sceneId: '逐字复制上下文 sceneId',
        scenePartId: '逐字复制上下文 scenePartId；旧上下文没有时为 null',
        baseWorkRevision: 1,
        baseSceneRevision: 1,
        contextDigest: '逐字复制上下文 contextDigest',
        patch: {},
        entityProposals: [],
        relationshipProposals: [],
        conflicts: [],
      },
      suggestions: [
        { label: '细化等车动作', sendText: '继续细化当前场里人物等待列车时的动作和节奏。', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
        { label: '换成车内视角', sendText: '把当前场改成从列车内部观察站台人物的视角。', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
        { label: '锁定这场继续', sendText: '锁定当前场的处理并进入下一场。', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
      ],
      proposedAction: {
        type: 'video',
        prompt: '当前场五镜连续段落',
        parameters: { ratio: '16:9', duration: 6, resolution: '720p' },
        inputAssetIds: [],
        shots: [
          { shotId: null, sourceKey: 'opening-wide', title: '站台全景', purpose: '建立空间', prompt: '可独立生成的一镜提示词', parameters: { ratio: '16:9', duration: 6, resolution: '720p' }, inputAssetIds: [] },
        ],
      },
    }),
  ].join('\n');
}

function responseRepairSystemPrompt() {
  return [
    '上一版 Creator Agent JSON 没有通过产品契约。请基于完整上下文修复整份回复，不要道歉或解释错误。',
    '保留已经正确的具体创作判断，只修复 rejectionReason 指出的结构、语气、问题数量、建议、动作、排版或禁用内容。',
    '如果 rejectionReason 指出三个建议重复或相似，必须重写全部三条，而不是给原句换词：recommended 用可继续修改的 draft/test/refine 类动作；alternative 用 change/shift/drop/reframe（中文用改成/换成/换个视角）明确改变一个创作轴；execute 只用 lock/commit/move to the next stage（中文用锁定/采用并进入下一步）结束讨论。三条不能要求同一种交付物。',
    '如果 rejectionReason 指出重大选择尚未锁定，recommended 必须明确“验证/试一幕/先只写一场关键戏”且禁止完整大纲、完整脚本或完整分镜；execute 才能锁定选择并进入下一步。',
    '如果 rejectionReason 指出只评价模式分工不清，recommended 必须明确说这版值得或不值得继续/进入下一阶段；alternative 只从一个具体受众、品牌或创作视角评价；execute 明确结束评价并保持现状。三条都不能修改或生成。',
    '如果 rejectionReason 指出建议标题太通用，重写所有 label，让每个标题直接点名创作对象或决定，例如“锁定分开结尾”或“Lock the empty-platform ending”，不要写“锁定当前方向”或“Lock this approach”。',
    '不得改写用户锁定事实，不得越过限定修改范围，不得加入费用信息，不得使用固定模板或通用占位话术。',
    '输出必须重新满足上一条 system 消息规定的完整 schema；只输出一个 JSON 对象，不要代码围栏。',
  ].join('\n');
}

const SINGLE_ITEM_MEASURE_GROUPS = [
  ['杯', '盒', '瓶', '罐', '碗', '壶', '盏'],
  ['张'], ['支', '枝'], ['颗', '粒', '枚'], ['件', '套'], ['辆', '台'],
  ['本', '册'], ['把'], ['束'], ['份'], ['袋'], ['块'], ['盘'], ['双', '对'],
];

function explicitSingleItemConstraintViolation(prompt, draftText) {
  const request = String(prompt || '').replace(/\s+/gu, '');
  const draft = String(draftText || '').replace(/\s+/gu, '');
  if (!request || !draft) return '';
  for (const measures of SINGLE_ITEM_MEASURE_GROUPS) {
    const units = measures.join('|');
    const explicitlySingle = new RegExp(`(?:只|仅)[^。！？!?\\n]{0,18}?一(?:${units})([^，,。！？!?；;\\n]{0,24})`, 'u').exec(request);
    if (!explicitlySingle) continue;
    const rawObject = String(explicitlySingle[1] || '')
      .split(/(?:把|被|将|让|使|来|去|给|与|和|在|向|从|往|为|拿|取|买|点|递|放|添|开|喝|吃|用|推|送)/u)[0]
      .replace(/^(?:最后|唯一|仅有|热|冷|旧|新|小|大)+/u, '')
      .slice(-6);
    if (!rawObject) continue;
    const expandedPattern = new RegExp(
      `(?:第[二两](?:${units})|另(?:一)?(?:${units})|又一(?:${units})|两(?:${units})|再(?:拿|取|买|点|要|递|放|添|开)[^。！？!?\\n]{0,10}一(?:${units})|(?:各自|每人)[^。！？!?\\n]{0,8}一(?:${units}))`,
      'gu',
    );
    for (const expanded of draft.matchAll(expandedPattern)) {
      const index = Number(expanded.index) || 0;
      const after = draft.slice(index + expanded[0].length).match(/^([^，,。！？!?；;\\n]{0,16})/u)?.[1] || '';
      const before = draft.slice(Math.max(0, index - 180), index);
      const explicitSameObject = after.includes(rawObject);
      const omittedObject = !after || /^(?:放|拿|取|买|点|要|递|添|开|给|被|让|使|又|再|并|却|还|仍|已|就|也)/u.test(after);
      if (explicitSameObject || (omittedObject && before.includes(rawObject))) return expanded[0];
    }
  }
  return '';
}

function canonicalizeScenePatchEnvelope(value, contextPack = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !value.patch || typeof value.patch !== 'object' || Array.isArray(value.patch)) return value;
  const patch = { ...value.patch };
  const normalized = { ...value, patch };
  ['entityProposals', 'relationshipProposals', 'conflicts'].forEach((key) => {
    if (Array.isArray(patch[key])
      && (!Array.isArray(normalized[key]) || normalized[key].length === 0)) {
      normalized[key] = patch[key];
    }
    delete patch[key];
  });
  if (contextPack) {
    normalized.sceneId = contextPack.sceneId;
    normalized.scenePartId = contextPack.scenePartId || null;
    normalized.baseWorkRevision = contextPack.baseWorkRevision;
    normalized.baseSceneRevision = contextPack.baseSceneRevision;
    normalized.contextDigest = contextPack.contextDigest;
  }
  return normalized;
}

const RECOVERABLE_RESPONSE_CODES = new Set([
  'CREATOR_LLM_STRUCTURE_INVALID',
  'CREATOR_LLM_SCHEMA_INVALID',
  'CREATOR_LLM_REPLY_EMPTY',
  'CREATOR_LLM_QUESTION_CONTRACT_INVALID',
  'CREATOR_LLM_TONE_INVALID',
  'CREATOR_LLM_SUGGESTIONS_INVALID',
  'CREATOR_LLM_SUGGESTIONS_POLICY_INVALID',
  'CREATOR_LLM_PHASE_INVALID',
  'CREATOR_LLM_ACTION_INVALID',
  'CREATOR_LLM_ACTION_PROHIBITED',
  'CREATOR_LLM_ACTION_TYPE_MISMATCH',
  'CREATOR_LLM_ACTION_CONTEXT_LEAK',
  'CREATOR_LLM_ACTION_MODEL_MISMATCH',
  'CREATOR_LLM_SCENE_PATCH_INVALID',
  'CREATOR_LLM_FORBIDDEN_COST_TEXT',
]);

function normalizeResponseEnvelope(envelope, input = {}) {
  if (envelope?.schema !== CREATOR_LLM_RESPONSE_SCHEMA) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_SCHEMA_INVALID', '模型回复版本不匹配，请重试');
  }
  const mergedBrief = mergeWorkingBrief(input.brief, envelope.workingBrief, {
    ...input.policy,
    sceneScoped: Boolean(input.sceneContext),
  }, input.prompt);
  const sceneDraft = input.sceneContext?.mode === 'scene-draft';
  const contracted = sceneDraft ? {
    replyMarkdown: bounded(envelope.replyMarkdown, 80_000),
    workingBrief: { ...mergedBrief, openQuestion: '' },
  } : enforceQuestionContract(envelope.replyMarkdown, mergedBrief, input.policy);
  const replyMarkdown = validateNaturalReply(
    normalizeReplyLayout(contracted.replyMarkdown),
    input.policy.replyLanguage,
    { sceneDraft },
  );
  const suggestions = enforceSuggestionPolicy(normalizeSuggestions(envelope.suggestions), input.policy);
  if (input.policy.generationProhibited
    && suggestsGeneration(suggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n'))) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_PROHIBITED', '模型建议违反了用户“不生成”的要求');
  }
  const phaseDecision = normalizePhaseDecision(envelope.phaseDecision);
  const normalizedAction = normalizeAction(
    envelope.proposedAction,
    input.preferences || {},
    input.policy,
    input.attachments || [],
    input.sceneContext || null,
  );
  const proposedAction = normalizedAction && input.sceneContext ? {
    ...normalizedAction,
    workBinding: {
      schema: 't8-creator-scene-action-binding-v1',
      workId: bounded(input.sceneContext.workId, 180) || null,
      workRevision: Math.max(0, Math.trunc(Number(input.sceneContext.baseWorkRevision) || 0)),
      workDigest: bounded(input.sceneContext.baseWorkDigest, 64) || null,
      sceneId: bounded(input.sceneContext.sceneId, 180),
      scenePartId: bounded(input.sceneContext.scenePartId, 180) || null,
      sceneRevision: Math.max(1, Math.trunc(Number(input.sceneContext.baseSceneRevision) || 1)),
      contextDigest: bounded(input.sceneContext.contextDigest, 64),
    },
  } : normalizedAction;
  const canonicalScenePatchEnvelope = canonicalizeScenePatchEnvelope(
    envelope.scenePatch,
    input.sceneContext,
  );
  const scenePatch = input.sceneContext
    ? normalizeScenePatch(canonicalScenePatchEnvelope, input.sceneContext)
    : null;
  const requiredPaths = Array.isArray(input.sceneContext?.requiredPaths)
    ? input.sceneContext.requiredPaths : [];
  if (input.sceneContext && !scenePatch
    && (envelope.scenePatch != null || requiredPaths.length)) {
    const missingDraftText = requiredPaths.includes('draftText')
      && !bounded(envelope.scenePatch?.patch?.draftText, 12_000);
    const missingExitState = requiredPaths.includes('exitState')
      && (!envelope.scenePatch?.patch?.exitState
        || !Object.keys(envelope.scenePatch.patch.exitState).length);
    const importPreviewPatch = input.sceneContext.mode === 'import-preview'
      && envelope.scenePatch != null;
    const invalidProposalKinds = (Array.isArray(envelope.scenePatch?.entityProposals)
      ? envelope.scenePatch.entityProposals : [])
      .map((proposal) => String(proposal?.kind || '').trim().toLowerCase())
      .filter((kind) => !['character', 'location', 'wardrobe', 'prop'].includes(kind));
    const exitStateText = JSON.stringify(envelope.scenePatch?.patch?.exitState || {})
      .toLowerCase().replace(/\s+/gu, '');
    const activeSceneRefs = new Set(Array.isArray(envelope.scenePatch?.patch?.activeEntityIds)
      ? envelope.scenePatch.patch.activeEntityIds.map((item) => String(item || '')).filter(Boolean)
      : (Array.isArray(input.sceneContext.activeEntities) ? input.sceneContext.activeEntities : [])
        .map((item) => String(item?.entityId || '')).filter(Boolean));
    const invalidExitKeys = Object.keys(envelope.scenePatch?.patch?.exitState || {})
      .filter((entityId) => !activeSceneRefs.has(entityId));
    const invalidExitValueKeys = Object.entries(envelope.scenePatch?.patch?.exitState || {})
      .filter(([, state]) => !state || typeof state !== 'object' || Array.isArray(state))
      .map(([entityId]) => entityId);
    const requiredContinuityTerms = Array.isArray(input.sceneContext.requiredContinuityTerms)
      ? input.sceneContext.requiredContinuityTerms : [];
    const missingContinuityTerms = requiredContinuityTerms
      .filter((term) => !exitStateText.includes(String(term || '').toLowerCase().replace(/\s+/gu, '')))
      .slice(0, 12);
    const requiredSubjectNames = (Array.isArray(input.sceneContext.requiredContinuitySubjectNames)
      ? input.sceneContext.requiredContinuitySubjectNames : [])
      .map((name) => String(name || '').trim().toLowerCase()).filter(Boolean);
    const subjectRefs = new Set();
    (Array.isArray(envelope.scenePatch?.entityProposals) ? envelope.scenePatch.entityProposals : [])
      .forEach((proposal) => {
        if (requiredSubjectNames.includes(String(proposal?.name || '').trim().toLowerCase())) {
          subjectRefs.add(String(proposal?.tempId || ''));
        }
      });
    [...(Array.isArray(input.sceneContext.activeEntities) ? input.sceneContext.activeEntities : []),
      ...(Array.isArray(input.sceneContext.mentionedEntities) ? input.sceneContext.mentionedEntities : [])]
      .forEach((item) => {
        if (requiredSubjectNames.includes(String(item?.baseline?.name || '').trim().toLowerCase())) {
          subjectRefs.add(String(item?.entityId || ''));
        }
      });
    const subjectExitStateText = JSON.stringify(Object.fromEntries(
      Object.entries(envelope.scenePatch?.patch?.exitState || {})
        .filter(([entityId]) => subjectRefs.has(entityId)),
    )).toLowerCase().replace(/\s+/gu, '');
    const missingSubjectTerms = subjectRefs.size
      ? requiredContinuityTerms.filter((term) => !subjectExitStateText.includes(
          String(term || '').toLowerCase().replace(/\s+/gu, ''),
        )).slice(0, 12)
      : requiredSubjectNames.length ? requiredContinuityTerms.slice(0, 12) : [];
    const missingBySubject = (Array.isArray(input.sceneContext.requiredContinuityBySubject)
      ? input.sceneContext.requiredContinuityBySubject : []).flatMap((requirement) => {
      const name = String(requirement?.subjectName || '').trim().toLowerCase();
      const proposal = (Array.isArray(envelope.scenePatch?.entityProposals)
        ? envelope.scenePatch.entityProposals : []).find((item) => (
        String(item?.name || '').trim().toLowerCase() === name
      ));
      const known = [...(Array.isArray(input.sceneContext.activeEntities) ? input.sceneContext.activeEntities : []),
        ...(Array.isArray(input.sceneContext.mentionedEntities) ? input.sceneContext.mentionedEntities : [])]
        .find((item) => String(item?.baseline?.name || '').trim().toLowerCase() === name);
      const ref = String(proposal?.tempId || known?.entityId || '');
      const stateText = JSON.stringify(envelope.scenePatch?.patch?.exitState?.[ref] || {})
        .toLowerCase().replace(/\s+/gu, '');
      const missing = (Array.isArray(requirement?.terms) ? requirement.terms : [])
        .filter((term) => !stateText.includes(String(term || '').toLowerCase().replace(/\s+/gu, '')));
      return missing.length ? [`${requirement.subjectName}：${missing.join('、')}`] : [];
    }).slice(0, 12);
    throw new CreatorLlmRuntimeError(
      'CREATOR_LLM_SCENE_PATCH_INVALID',
      importPreviewPatch
        ? '当前是长剧本首次导入预览，scenePatch 必须为 null；不要提前创建实体或修改场次'
        : missingDraftText
          ? '逐场创作必须直接返回完整场稿，并把与 replyMarkdown 完全相同的正文写入 patch.draftText'
        : invalidProposalKinds.length
          ? `entityProposals.kind 仅允许 character、location、wardrobe、prop；请替换非法类型 ${[...new Set(invalidProposalKinds)].join('、')}`
        : missingExitState
        ? '当前场补丁漏掉了用户明确要求的本场结束状态；请在 patch.exitState 中完整保存后重试'
        : invalidExitKeys.length
          ? 'patch.exitState 的键必须逐字使用 patch.activeEntityIds 中的现有 entityId 或本响应 entityProposals 的 tempId；不要使用人物姓名或其他键，请修正后重试'
        : invalidExitValueKeys.length
          ? 'patch.exitState 的每个实体值必须是 JSON 对象，不能是一句字符串或数组；请用 wardrobe、injury、props 等清楚字段保存状态后重试'
        : missingBySubject.length
          ? `请逐人修正本场结束状态，不能把不同人物的事实混在一起：${missingBySubject.join('；')}`
        : missingSubjectTerms.length
          ? `请把 ${missingSubjectTerms.join('、')} 全部保存在 ${requiredSubjectNames.join('、')} 对应的同一个 patch.exitState 值中，不要拆到服装或道具等其他实体键`
        : missingContinuityTerms.length
          ? `当前场结束状态遗漏了这些用户原文事实：${missingContinuityTerms.join('、')}；请逐项补入 patch.exitState 后重试`
        : '模型返回的当前场修改已经过期、越界或留下了未绑定当前场的新实体，请重试',
    );
  }
  if (sceneDraft) {
    const draftText = normalizeReplyLayout(scenePatch?.patch?.draftText);
    if (!scenePatch || !draftText || draftText !== replyMarkdown) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_SCENE_PATCH_INVALID',
        '逐场创作的 replyMarkdown 与 patch.draftText 必须是完全相同的完整场稿；不要加入分析或省略正文',
      );
    }
    const explicitlyBrief = /(?:\b(?:5|10|15|20|30)\s*(?:s|sec|secs|second|seconds)\b|(?:5|10|15|20|30)\s*秒|一句话|一两句|极短|one[- ]?(?:line|liner)|very short)/iu.test(input.prompt);
    const containsHan = /\p{Script=Han}/u.test(draftText);
    const substantialLength = containsHan
      ? draftText.length >= (explicitlyBrief ? 80 : 260)
      : draftText.split(/\s+/u).filter(Boolean).length >= (explicitlyBrief ? 45 : 120);
    if (!substantialLength) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_SCENE_PATCH_INVALID',
        explicitlyBrief
          ? '这仍是一句梗概，不是用户要求的可拍短场稿；请增加可见动作、阻力、转折与收束画面'
          : '这仍是一段扩写梗概，不是完整场稿；请重写为至少 350 个中文字或 180 个英文词的 45–90 秒场景，补足建立、阻力、升级、转折和收束画面，且不要加解释',
      );
    }
    const singleItemViolation = explicitSingleItemConstraintViolation(input.prompt, draftText);
    if (singleItemViolation) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_SCENE_PATCH_INVALID',
        `用户明确限定整场只使用一个实物，但场稿又出现“${singleItemViolation}”。请删除新增实例，让人物传递、共享或继续使用原来的同一个实物，并重写完整场稿`,
      );
    }
    const beatCount = draftText.split(/\n+/u).map((line) => line.trim()).filter(Boolean).length;
    const narrationWasRequested = /(?:内心独白|旁白|回忆蒙太奇|voice[ -]?over|inner monologue|memory montage)/iu.test(input.prompt);
    const unfilmableNarration = /(?:脑海中?(?:涌现|浮现)|内心(?:感到|意识到)|(?:回想|想)起[^\n。！？]{0,30}(?:点点滴滴|回忆|笑脸|往事)|(?:终于)?(?:下定|做出)(?:了)?决心|终于决定|决定不再留恋|这一刻[^\n。！？]{0,24}(?:终于|成为|不再)|为(?:故事|后续|下一[\u573a\u5e55])(?:埋下|留下)(?:伏笔|铺垫)|一切的一切|每一寸土地都承载|眼中闪过一丝(?:释然|坚定)|深吸一口气|攥紧(?:了)?拳头|泪水混着雨水|脚步越来越坚定|背影在夜色中消失|(?:she|he)\s+(?:thought|remembered|realized|decided)\b|this\s+(?:moment|scene)\s+(?:marks|symbolizes)\b|\bforeshadow(?:s|ed|ing)?\b)/iu;
    if (beatCount < (explicitlyBrief ? 3 : 5)
      || (!narrationWasRequested && unfilmableNarration.test(draftText))) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_SCENE_PATCH_INVALID',
        '这仍是单段概念旁白，不是可拍可演的场稿；请删掉内心、主题总结和作者评语，用 6–10 个短段的道具选择、动作反应、环境打断和有潜台词的对白表现目标、阻力、升级、转折与收束画面',
      );
    }
    scenePatch.patch.draftText = replyMarkdown;
  }
  const visibleOutput = `${replyMarkdown}\n${suggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n')}\n${proposedAction?.prompt || ''}\n${(proposedAction?.shots || []).map((shot) => shot.prompt).join('\n')}`;
  if (/(价格|费用|余额|额度|账单|单价|消耗估算|cost|price|billing|balance|quota)/iu.test(visibleOutput)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_FORBIDDEN_COST_TEXT', '模型回复包含不允许展示的信息，请重试');
  }
  return {
    replyMarkdown,
    workingBrief: contracted.workingBrief,
    phaseDecision,
    suggestions,
    proposedAction,
    scenePatch,
  };
}

function historyMessages(value) {
  return (Array.isArray(value) ? value : [])
    .filter((message) => message?.role === 'user' || message?.status === 'completed')
    .slice(-14).map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: bounded(message?.body, 12_000),
  })).filter((message) => message.content);
}

function createCreatorLlmRuntimeV2(options = {}) {
  const generateChat = typeof options.generateChat === 'function' ? options.generateChat : generateChatWithProvider;
  const settingsProvider = typeof options.settingsProvider === 'function'
    ? options.settingsProvider : () => readSettings(options.settingsFile);
  const runtimeConfig = options.config || {};

  function resolvedModelSnapshot(kind, preferences, context = {}) {
    return modelSnapshot(kind, preferences, {
      settings: settingsProvider() || {},
      config: runtimeConfig,
      requiresVision: context.requiresVision === true,
      preferredModelId: context.preferredModelId,
    });
  }

  async function respond(input = {}, hooks = {}) {
    const prompt = bounded(input.prompt, 30_000);
    if (!prompt) throw new CreatorLlmRuntimeError('CREATOR_PROMPT_EMPTY', '请输入创作需求', 400);
    const settings = settingsProvider() || {};
    const requiresVision = (Array.isArray(input.attachments) ? input.attachments : [])
      .some((item) => ['image', 'video'].includes(String(item?.kind || '').toLowerCase()));
    const llmSnapshot = modelSnapshot('llm', input.preferences || {}, {
      settings,
      config: runtimeConfig,
      requiresVision,
      preferredModelId: !requiresVision && input.sceneContext?.mode === 'scene-draft'
        ? SCENE_DRAFT_DEFAULT_LLM : null,
    });
    const provider = providerFromSettings(llmSnapshot.providerId, llmSnapshot.modelId, settings, runtimeConfig);
    if (!provider) throw new CreatorLlmRuntimeError('CREATOR_LLM_CREDENTIAL_REQUIRED', '请先在 API 设置中配置所选渠道', 409);
    const controller = new AbortController();
    if (typeof hooks.registerAbort === 'function') hooks.registerAbort(() => controller.abort());
    const availableAssets = (Array.isArray(input.attachments) ? input.attachments : []).slice(0, 12)
      .map((item) => ({
        assetId: bounded(item?.assetId, 180),
        kind: bounded(item?.kind, 16),
        title: bounded(item?.title, 240),
        contentHash: bounded(item?.contentHash, 128),
        mediaUrl: bounded(item?.mediaUrl || item?.previewUrl, 4_000),
        observation: bounded(item?.observation || (item?.audioObservation
          ? `音频转写：${item.audioObservation.transcript || ''}\n时间段：${JSON.stringify(item.audioObservation.segments || [])}\n限制：${item.audioObservation.limitation || ''}`
          : item?.documentObservation
            ? `文档正文：\n${item.documentObservation.text || ''}\n限制：${item.documentObservation.limitation || ''}`
            : ''), 32_000),
      })).filter((item) => item.assetId);
    if (availableAssets.some((item) => ['image', 'video'].includes(item.kind))
      && !isDocumentedVisionModel(llmSnapshot.providerId, llmSnapshot.modelId)) {
      throw new CreatorLlmRuntimeError(
        'CREATOR_LLM_VISION_REQUIRED',
        '当前 LLM 不能读取图片或视频。请在右上角设置中选择支持视觉的模型（推荐 zhenzhen/gk-4.6）。',
        409,
      );
    }
    const brief = normalizeWorkingBrief(input.workingBrief || {});
    const sceneContext = input.sceneContext && typeof input.sceneContext === 'object'
      && !Array.isArray(input.sceneContext)
      ? input.sceneContext : null;
    const policy = turnPolicy(prompt);
    const currentPhase = ['idea', 'script', 'assets', 'shots', 'candidates', 'delivery']
      .includes(bounded(input.currentPhase, 24).toLowerCase())
      ? bounded(input.currentPhase, 24).toLowerCase()
      : 'idea';
    const selectedNodes = (Array.isArray(input.selectedNodes) ? input.selectedNodes : []).slice(0, 24).map((node) => ({
      nodeId: bounded(node?.nodeId, 180),
      type: bounded(node?.type, 120),
      label: bounded(node?.label, 240),
      assetId: bounded(node?.assetId, 180) || null,
      content: bounded(node?.content, 6_000) || null,
    })).filter((node) => node.nodeId);
    const assetManifest = availableAssets.map(({ mediaUrl, ...asset }) => asset);
    const userText = [
      `当前 workingBrief：${JSON.stringify(brief)}`,
      `当前可信阶段：${currentPhase}`,
      `用户本轮原话：${prompt}`,
      `本轮强制对话契约：${JSON.stringify(policy)}`,
      sceneContext
        ? `当前长剧本场次上下文（这是本轮唯一可修改场次，不得扩写其他场）：${JSON.stringify(sceneContext)}`
        : '',
      availableAssets.length
        ? `本轮明确绑定的素材（生成动作需要使用时，把对应 assetId 放入 inputAssetIds）：${JSON.stringify(assetManifest)}`
        : '本轮没有明确绑定素材。不要自动沿用上一轮结果。',
      selectedNodes.length ? `本轮明确绑定的画布节点：${JSON.stringify(selectedNodes)}` : '',
    ].filter(Boolean).join('\n\n');
    const userContent = [{ type: 'text', text: userText }];
    availableAssets.forEach((asset, index) => {
      if (!asset.mediaUrl) return;
      userContent.push({ type: 'text', text: `素材 ${index + 1} · ${asset.assetId} · ${asset.kind} · ${asset.title || '未命名'}` });
      if (asset.kind === 'image') userContent.push({ type: 'image_url', image_url: { url: asset.mediaUrl } });
      if (asset.kind === 'video') userContent.push({ type: 'video_url', video_url: { url: asset.mediaUrl } });
    });
    const activeSystemPrompt = sceneContext ? longSceneSystemPrompt(sceneContext.mode) : systemPrompt();
    const responseMaxTokens = sceneContext?.mode === 'scene-draft' ? 4_000 : sceneContext ? 2_200 : 5_000;
    const responseTemperature = sceneContext?.mode === 'scene-draft' ? 0.45 : sceneContext ? 0.35 : 0.55;
    // Long structured scene responses can outlive an upstream proxy's ordinary
    // request window. Streaming keeps that connection active even though this
    // route only publishes the envelope after validation. Diagnostics can still
    // opt out explicitly when comparing provider transports.
    const responseStream = options.stream !== false;
    const primaryRequest = {
      model: llmSnapshot.modelId,
      messages: [
        { role: 'system', content: activeSystemPrompt },
        // Long-form continuity comes from the authoritative scene ContextPack.
        // Replaying chat here can reintroduce deleted ideas or unrelated scenes.
        ...(sceneContext ? [] : historyMessages(input.history)),
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: responseTemperature,
      max_tokens: responseMaxTokens,
      // The official endpoint supports both synchronous and streamed chat.
      // Keep this injectable so the exact production payload can be verified
      // against a channel whose streaming bridge is temporarily unstable,
      // without changing the one-call or strict-JSON contract.
      stream: responseStream,
    };
    const providerOptions = {
      signal: controller.signal,
      timeoutMs: Math.max(30_000, Math.min(10 * 60_000, Number(options.timeoutMs) || 180_000)),
      fetchImpl: options.fetchImpl,
    };
    let providerCalls = 1;
    let result = await generateChat(provider, primaryRequest, providerOptions);
    if (!result?.ok && !controller.signal.aborted
      && (String(result?.code || '') === 'empty_text' || providerTransientlyUnavailable(result))) {
      if (providerTransientlyUnavailable(result)) {
        await waitForProviderRetry(options.retryDelayMs, controller.signal);
      }
      if (!controller.signal.aborted) {
        result = await generateChat(provider, primaryRequest, providerOptions);
        providerCalls += 1;
      }
    }
    if (!result?.ok) {
      const stopped = ['request_aborted', 'stopped'].includes(String(result?.code || ''));
      const credentialRejected = providerCredentialRejected(result);
      throw new CreatorLlmRuntimeError(
        stopped ? 'CREATOR_LLM_STOPPED' : credentialRejected ? 'CREATOR_LLM_CREDENTIAL_INVALID' : 'CREATOR_LLM_FAILED',
        stopped ? '已停止这次回复。' : credentialRejected ? 'API Key 无法通过服务验证，请检查后重试。' : bounded(result?.error, 500) || '模型暂时没有回复，请重试',
        stopped ? 409 : credentialRejected ? 401 : 502,
      );
    }
    let normalized;
    try {
      normalized = normalizeResponseEnvelope(parseJsonEnvelope(result.text), {
        brief,
        policy,
        prompt,
        preferences: input.preferences || {},
        sceneContext,
        attachments: availableAssets,
      });
    } catch (responseError) {
      if (!RECOVERABLE_RESPONSE_CODES.has(String(responseError?.code || ''))) {
        throw responseError;
      }
      if (providerCalls >= 2) throw responseError;
      const repair = await generateChat(provider, {
        model: llmSnapshot.modelId,
        messages: [
          { role: 'system', content: activeSystemPrompt },
          { role: 'system', content: responseRepairSystemPrompt() },
          {
            role: 'user',
            content: JSON.stringify({
              userRequest: prompt,
              originalContext: userText,
              workingBrief: brief,
              currentPhase,
              policy,
              rejectedOutput: bounded(result.text, 80_000),
              rejectionCode: responseError.code,
              rejectionReason: responseError.message,
            }),
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.35,
        max_tokens: responseMaxTokens,
        stream: responseStream,
      }, {
        signal: controller.signal,
        timeoutMs: Math.max(30_000, Math.min(10 * 60_000, Number(options.timeoutMs) || 180_000)),
        fetchImpl: options.fetchImpl,
      });
      providerCalls += 1;
      if (!repair?.ok) {
        const stopped = ['request_aborted', 'stopped'].includes(String(repair?.code || ''));
        const credentialRejected = providerCredentialRejected(repair);
        throw new CreatorLlmRuntimeError(
          stopped ? 'CREATOR_LLM_STOPPED' : credentialRejected ? 'CREATOR_LLM_CREDENTIAL_INVALID' : 'CREATOR_LLM_FAILED',
          stopped ? '已停止这次回复。' : credentialRejected ? 'API Key 无法通过服务验证，请检查后重试。' : bounded(repair?.error, 500) || '模型没有完成回复修复，请重试',
          stopped ? 409 : credentialRejected ? 401 : 502,
        );
      }
      normalized = normalizeResponseEnvelope(parseJsonEnvelope(repair.text), {
        brief,
        policy,
        prompt,
        preferences: input.preferences || {},
        sceneContext,
        attachments: availableAssets,
      });
    }
    const response = {
      schema: CREATOR_LLM_RESPONSE_SCHEMA,
      ...normalized,
      evidence: {
        providerCalls,
        providerId: llmSnapshot.providerId,
        modelId: llmSnapshot.modelId,
        catalogDigest: llmSnapshot.catalogDigest,
        responseDigest: digest(normalized),
        sceneContextDigest: bounded(sceneContext?.contextDigest, 64) || null,
      },
    };
    return response;
  }

  return { respond, modelSnapshot: resolvedModelSnapshot };
}

module.exports = {
  CREATOR_LLM_RESPONSE_SCHEMA,
  CreatorLlmRuntimeError,
  DEFAULT_MODELS,
  createCreatorLlmRuntimeV2,
  isDocumentedVisionModel,
  modelSnapshot,
  mergeWorkingBrief,
  parseJsonEnvelope,
  providerFromSettings,
  turnPolicy,
};
