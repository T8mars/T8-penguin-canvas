'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const { generateChatWithProvider } = require('../providers/adapters');
const { normalizeAdvancedProviders } = require('../providers/registry');
const { digest } = require('./creatorConversationRepository');

const CREATOR_LLM_RESPONSE_SCHEMA = 't8-creator-llm-response-v2';
const DEFAULT_MODELS = Object.freeze({
  // Creator accepts explicit visual references, so its own default must be a
  // documented vision-capable chat model. This does not change defaults of
  // the standalone prompt-enhancer or LLM nodes.
  llm: 'zhenzhen/gk-4.6',
  image: 'zhenzhen-image-gk-v2',
  video: 'zhenzhen-video-g-omni-1.1-flash-lowprice',
});

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
  const preferred = available.find((item) => item.modelId === DEFAULT_MODELS[kind]);
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

function mergeWorkingBrief(currentValue, incomingValue, policy = {}, prompt = '') {
  const current = normalizeWorkingBrief(currentValue);
  if (policy.preserveBrief) return current;
  const source = incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue)
    ? incomingValue : {};
  const incoming = normalizeWorkingBrief(source);
  const scoped = new Set(Array.isArray(policy.scopedBriefFields) ? policy.scopedBriefFields : []);
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

function validateNaturalReply(value, replyLanguage = '简体中文') {
  const reply = bounded(value, 80_000);
  const robotic = /(?:我已经理解(?:你的)?需求|系统(?:已经)?检测到|当前阶段(?:为|是)|已完成\s*\d+\s*\/\s*6|请选择一个明确方向|I (?:have )?(?:understood|processed) (?:your )?(?:request|requirements)|the system (?:has )?(?:detected|processed)|current phase|本轮强制对话契约|workingBrief|phaseDecision|proposedAction|CanvasPatch|NodeRun|task[_ ]?id|assetId)/iu;
  const receiptOpening = /^\s*(?:好的|收到|明白(?:了)?|没问题|我知道了|我了解了|okay|ok|sure|got it|understood|certainly)(?:[，。,:：！!\s]|$)/iu;
  if (robotic.test(reply) || receiptOpening.test(reply)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复过于机械，请重试');
  }
  if (/^\s*\|[^\n]+\|[\s\S]*\n\s*\|\s*:?-{3,}/mu.test(reply)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复排版过于复杂，请重试');
  }
  const maximumLength = replyLanguage === 'English' ? 3_600 : 2_400;
  const paragraphCount = reply.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean).length;
  if (reply.length > maximumLength || paragraphCount > 6) {
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

function normalizeAction(value, preferences, policy = {}) {
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
  const rawParameters = value.parameters && typeof value.parameters === 'object' && !Array.isArray(value.parameters)
    ? value.parameters : {};
  const parameters = type === 'image'
    ? {
        ratio: bounded(rawParameters.ratio, 16) || '16:9',
        count: Math.max(1, Math.min(4, Math.trunc(Number(rawParameters.count) || 1))),
      }
    : {
        ratio: bounded(rawParameters.ratio, 16) || '16:9',
        duration: Math.max(4, Math.min(15, Math.trunc(Number(rawParameters.duration) || 6))),
        resolution: bounded(rawParameters.resolution, 24) || '720p',
      };
  return {
    id: `action-${crypto.randomUUID()}`,
    type,
    prompt,
    parameters,
    inputAssetIds: [...new Set((Array.isArray(value.inputAssetIds) ? value.inputAssetIds : [])
      .map((item) => bounded(item, 180)).filter(Boolean))].slice(0, 12),
    modelSnapshot: modelSnapshot(type, preferences),
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
  'CREATOR_LLM_FORBIDDEN_COST_TEXT',
]);

function normalizeResponseEnvelope(envelope, input = {}) {
  if (envelope?.schema !== CREATOR_LLM_RESPONSE_SCHEMA) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_SCHEMA_INVALID', '模型回复版本不匹配，请重试');
  }
  const mergedBrief = mergeWorkingBrief(input.brief, envelope.workingBrief, input.policy, input.prompt);
  const contracted = enforceQuestionContract(envelope.replyMarkdown, mergedBrief, input.policy);
  const replyMarkdown = validateNaturalReply(
    normalizeReplyLayout(contracted.replyMarkdown),
    input.policy.replyLanguage,
  );
  const suggestions = enforceSuggestionPolicy(normalizeSuggestions(envelope.suggestions), input.policy);
  if (input.policy.generationProhibited
    && suggestsGeneration(suggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n'))) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_PROHIBITED', '模型建议违反了用户“不生成”的要求');
  }
  const phaseDecision = normalizePhaseDecision(envelope.phaseDecision);
  const proposedAction = normalizeAction(envelope.proposedAction, input.preferences || {}, input.policy);
  const visibleOutput = `${replyMarkdown}\n${suggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n')}\n${proposedAction?.prompt || ''}`;
  if (/(价格|费用|余额|额度|账单|单价|消耗估算|cost|price|billing|balance|quota)/iu.test(visibleOutput)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_FORBIDDEN_COST_TEXT', '模型回复包含不应展示的费用信息，请重试');
  }
  return {
    replyMarkdown,
    workingBrief: contracted.workingBrief,
    phaseDecision,
    suggestions,
    proposedAction,
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
    const primaryRequest = {
      model: llmSnapshot.modelId,
      messages: [
        { role: 'system', content: systemPrompt() },
        ...historyMessages(input.history),
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.55,
      max_tokens: 5_000,
      // Keep the upstream connection active while collecting the single
      // structured response. This avoids gateway 524s on slower creative
      // turns without exposing partial JSON or adding another model call.
      stream: true,
    };
    const providerOptions = {
      signal: controller.signal,
      timeoutMs: Math.max(30_000, Math.min(10 * 60_000, Number(options.timeoutMs) || 180_000)),
      fetchImpl: options.fetchImpl,
    };
    let providerCalls = 1;
    let result = await generateChat(provider, primaryRequest, providerOptions);
    if (!result?.ok && String(result?.code || '') === 'empty_text' && !controller.signal.aborted) {
      result = await generateChat(provider, primaryRequest, providerOptions);
      providerCalls += 1;
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
      });
    } catch (responseError) {
      if (!RECOVERABLE_RESPONSE_CODES.has(String(responseError?.code || ''))) {
        throw responseError;
      }
      if (providerCalls >= 2) throw responseError;
      const repair = await generateChat(provider, {
        model: llmSnapshot.modelId,
        messages: [
          { role: 'system', content: systemPrompt() },
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
        max_tokens: 5_000,
        stream: true,
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
