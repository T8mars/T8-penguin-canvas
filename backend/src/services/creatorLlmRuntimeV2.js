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

function exactChoice(preferences, kind) {
  const explicit = preferences?.[kind];
  const providerId = bounded(explicit?.providerId || preferences?.providerId, 180);
  const modelId = bounded(explicit?.modelId, 240);
  if (providerId && providerId !== 'auto' && modelId) return { providerId, modelId };
  return { providerId: 'seedance-nz', modelId: DEFAULT_MODELS[kind] };
}

function modelExists(kind, choice) {
  return (Array.isArray(creativeModelCatalog[kind]) ? creativeModelCatalog[kind] : []).some((item) => (
    item.provider === choice.providerId && item.model === choice.modelId && item.available !== false
  ));
}

function modelSnapshot(kind, preferences) {
  const choice = exactChoice(preferences, kind);
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
    const label = bounded(item.label, 32);
    const sendText = bounded(item.sendText || item.label, 2_000);
    const intentKind = bounded(item.intentKind, 80).toLowerCase();
    const role = bounded(item.role, 24).toLowerCase();
    if (!label || !sendText || !intentKind || role !== roles[index]) return null;
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
  const delegated = delegationCue.test(text) && !delegationNegated.test(text);
  const endingOnly = endingOnlyCue.test(text) && !endingOnlyNegated.test(text);
  const styleOnly = styleOnlyCue.test(text) && !styleOnlyNegated.test(text);
  const hanCount = (text.match(/\p{Script=Han}/gu) || []).length;
  const latinCount = (text.match(/[A-Za-z]/gu) || []).length;
  const replyLanguage = latinCount >= 8 && latinCount > hanCount * 2 ? 'English' : '简体中文';
  const requestedActionType = generationProhibited ? null : (requestsVideo ? 'video' : requestsImage ? 'image' : null);
  return {
    delegated,
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

function keepFirstQuestions(value, maximum) {
  let kept = 0;
  const result = bounded(value, 100_000).replace(/[^。！？?!\n]*[?？]/gu, (sentence) => {
    if (kept >= maximum) return '';
    kept += 1;
    return sentence;
  }).replace(/\n{3,}/gu, '\n\n').trim();
  return result;
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

function openCreativeQuestion(replyLanguage) {
  return replyLanguage === 'English'
    ? 'What feeling and meaning must this piece leave with the audience?'
    : '这支作品最终必须让观众留下怎样的情绪和理解？';
}

function enforceQuestionContract(replyValue, briefValue, policy) {
  let replyMarkdown = bounded(replyValue, 80_000);
  const workingBrief = normalizeWorkingBrief(briefValue);
  if (policy.maxQuestions === 0) {
    replyMarkdown = keepFirstQuestions(replyMarkdown, 0);
    workingBrief.openQuestion = '';
    if (!replyMarkdown) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_QUESTION_CONTRACT_INVALID', '模型没有按本轮要求直接给出方案，请重试');
    }
    return { replyMarkdown, workingBrief };
  }
  replyMarkdown = keepFirstQuestions(replyMarkdown, 1);
  if (!replyMarkdown) throw new CreatorLlmRuntimeError('CREATOR_LLM_REPLY_EMPTY', '模型没有返回有效回复');
  if (questionCount(replyMarkdown)) {
    const question = firstQuestion(replyMarkdown);
    const normalizedQuestion = isClosedChoiceQuestion(question)
      ? openCreativeQuestion(policy.replyLanguage)
      : question;
    if (normalizedQuestion !== question) replyMarkdown = replyMarkdown.replace(question, normalizedQuestion);
    workingBrief.openQuestion = normalizedQuestion;
  } else if (workingBrief.openQuestion) {
    const openQuestion = keepFirstQuestions(
      /[?？]/u.test(workingBrief.openQuestion) ? workingBrief.openQuestion : `${workingBrief.openQuestion}？`,
      1,
    );
    const question = firstQuestion(openQuestion);
    workingBrief.openQuestion = isClosedChoiceQuestion(question)
      ? openCreativeQuestion(policy.replyLanguage)
      : question;
    if (workingBrief.openQuestion) replyMarkdown = `${replyMarkdown}\n\n${workingBrief.openQuestion}`;
  }
  return { replyMarkdown, workingBrief };
}

function validateNaturalReply(value) {
  const reply = bounded(value, 80_000);
  const robotic = /(?:我已经理解(?:你的)?需求|系统(?:已经)?检测到|当前阶段(?:为|是)|已完成\s*\d+\s*\/\s*6|请选择一个明确方向|I (?:have )?(?:understood|processed) (?:your )?(?:request|requirements)|the system (?:has )?(?:detected|processed)|current phase|本轮强制对话契约|workingBrief|phaseDecision|proposedAction|CanvasPatch|NodeRun|task[_ ]?id|assetId)/iu;
  const receiptOpening = /^\s*(?:好的|收到|明白(?:了)?|没问题|我知道了|我了解了|okay|ok|sure|got it|understood|certainly)(?:[，。,:：！!\s]|$)/iu;
  if (robotic.test(reply) || receiptOpening.test(reply)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复过于机械，请重试');
  }
  if (/^\s*\|[^\n]+\|[\s\S]*\n\s*\|\s*:?-{3,}/mu.test(reply)) {
    throw new CreatorLlmRuntimeError('CREATOR_LLM_TONE_INVALID', '模型回复排版过于复杂，请重试');
  }
  return reply;
}

function suggestsGeneration(value) {
  const text = bounded(value, 20_000)
    .replace(/(?:先)?(?:不要|别|不|不用|无需|不需要|暂不)(?:再|立即|现在)?(?:生成|出图|出视频|渲染)/giu, '')
    .replace(/(?:do not|don't|dont|no need to) (?:generate|render|create (?:an? )?(?:image|video))|without (?:generating|rendering)/giu, '');
  return /(?:生成|出图|出视频|渲染|generate|render|create (?:an? )?(?:image|video))/iu.test(text);
}

function suggestionSimilarity(left, right) {
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

function enforceSuggestionPolicy(value, policy = {}) {
  let suggestions = value.map((item) => ({ ...item, inputAssetIds: [...item.inputAssetIds] }));
  const english = policy.replyLanguage === 'English';
  const visibleText = suggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n');
  const feedbackEditCue = /(?:改|修改|调整|细化|优化|重写|生成|出图|出视频|渲染|change|edit|revise|refine|rewrite|generate|render)/iu;
  if (policy.feedbackOnly && feedbackEditCue.test(visibleText)) {
    const fallbacks = english ? [
      ['Review the main weakness', 'Only assess the single issue that most limits this version, without changing or producing anything.'],
      ['Use another review lens', 'Review this version only through character motivation and shot rhythm, without proposing edits.'],
      ['End the review here', 'Keep this review as the conclusion and stop here without changing the piece.'],
    ] : [
      ['点评核心问题', '只评价这一版最影响成片效果的问题，不修改也不制作任何内容。'],
      ['换个评价角度', '只从人物动机和镜头节奏评价这一版，不提出修改方案。'],
      ['结束本轮评价', '保留这次评价结论，到这里结束，不修改作品。'],
    ];
    suggestions = suggestions.map((item, index) => ({
      ...item,
      label: fallbacks[index][0],
      sendText: fallbacks[index][1],
      inputAssetIds: [],
    }));
  } else if (policy.generationProhibited && suggestsGeneration(visibleText)) {
    const fallbacks = english ? [
      ['Refine the written plan', 'Keep this in the written plan and tighten the motivation, rhythm, and ending without producing media.'],
      ['Try another approach', 'Explore a materially different treatment in writing while keeping the no-generation boundary.'],
      ['Lock the current plan', 'Lock the current written direction and stop before production.'],
    ] : [
      ['细化文字方案', '继续只在文字方案里细化人物动机、节奏和结尾，不进入制作。'],
      ['换个表达方向', '保持不制作的边界，换一种表现方法完善文字方案。'],
      ['锁定当前方案', '先锁定当前文字方案，保持现有边界，不进入制作。'],
    ];
    suggestions = suggestions.map((item, index) => ({
      ...item,
      label: fallbacks[index][0],
      sendText: fallbacks[index][1],
      inputAssetIds: [],
    }));
  }
  if (policy.scopedBriefFields?.length) {
    const recommended = suggestions[0];
    const asksForFullDeliverable = /完整.{0,8}(?:脚本|分镜)|(?:脚本|分镜).{0,8}完整|full.{0,12}(?:script|storyboard)|(?:script|storyboard).{0,12}full/iu.test(recommended.sendText);
    const hasScopedCraft = /镜头|景别|节奏|动作|表演|声音|音效|光线|色彩|转场|构图|留白|细化|优化|打磨|精修|小稿|草稿|试稿|尾段|结尾段落|shot|rhythm|performance|sound|light|color|transition|composition|draft|refine|polish/iu.test(recommended.sendText);
    if (asksForFullDeliverable || !hasScopedCraft) {
      const styleOnly = policy.scopedBriefFields.includes('style');
      suggestions[0] = {
        ...recommended,
        label: english ? (styleOnly ? 'Refine the style language' : 'Refine the ending beat') : (styleOnly ? '细化风格落点' : '细化结尾节奏'),
        sendText: english
          ? (styleOnly
              ? 'Only refine how the new style appears through light, color, camera, and performance, and give me a small editable draft without changing anything else.'
              : 'Keep this ending and refine only its shots, rhythm, performance, sound, and transition into a small editable draft.')
          : (styleOnly
              ? '只在新风格范围内细化光线、色彩、镜头和表演，给我一份可继续修改的小稿，其他设定不动。'
              : '沿用这个结尾，只细化尾段的镜头、节奏、表演、声音和转场，给我一份可继续修改的小稿。'),
        inputAssetIds: [],
      };
    }
  }
  const pairSimilarities = [
    suggestionSimilarity(suggestions[0].sendText, suggestions[1].sendText),
    suggestionSimilarity(suggestions[0].sendText, suggestions[2].sendText),
    suggestionSimilarity(suggestions[1].sendText, suggestions[2].sendText),
  ];
  if (!policy.feedbackOnly && Math.max(...pairSimilarities) >= 0.34) {
    const fallbacks = english ? [
      ['Refine the craft', 'Turn the current direction into a small editable draft focused on pacing, performance, sound, light, and transitions.'],
      ['Change the treatment', 'Keep every locked fact but explore a materially different camera language and storytelling method.'],
      [policy.generationProhibited ? 'Lock the written plan' : 'Move forward now', policy.generationProhibited
        ? 'Lock the current written direction and stop here before production.'
        : 'Lock the current conclusion and move to the next stage without reopening confirmed decisions.'],
    ] : [
      ['细化创作手法', '沿当前方向细化节奏、表演、声音、光线和转场，给一份可继续修改的小稿。'],
      ['换种表达手法', '保留所有已锁定事实，换一种镜头语言和叙事方法，给出实质不同的表达。'],
      [policy.generationProhibited ? '锁定文字方案' : '直接往下推进', policy.generationProhibited
        ? '锁定当前书面方案，本轮停在制作前，不再继续推进。'
        : '锁定当前结论并进入下一环节，不再打开已经确认的决定。'],
    ];
    suggestions = suggestions.map((item, index) => ({
      ...item,
      label: fallbacks[index][0],
      sendText: fallbacks[index][1],
      inputAssetIds: [],
    }));
  } else if (!policy.feedbackOnly) {
    const execute = suggestions[2];
    const actionCue = /(?:推进|进入下一|进入制作|开始执行|开始制作|直接执行|proceed|move to the next|advance|start production|execute now)/iu;
    if (policy.generationProhibited) {
      if (!/(?:停在制作前|不进入制作|stop (?:here )?before production|without production)/iu.test(execute.sendText)) {
        suggestions[2] = {
          ...execute,
          sendText: english
            ? 'Lock the current written direction and stop here before production.'
            : '锁定当前书面方案，本轮停在制作前，不再继续推进。',
          inputAssetIds: [],
        };
      }
    } else if (!actionCue.test(execute.sendText)) {
      suggestions[2] = {
        ...execute,
        sendText: `${execute.sendText.replace(/[。.!！\s]+$/u, '')}${english ? '. Move to the next stage without reopening confirmed decisions.' : '，并以这个结论进入下一环节。'}`,
      };
    }
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
    '只有真正会改变整部作品的缺口才追问。必须追问时，先给你的明确倾向和一句理由，再只问一个开放式问题，询问用户想留下的情绪、意义或创作底线；不要把用户已经说出的 A/B 重新写成“还是、或者、或是”的选择题，也不要问“是否、要不要、你希望……吗”这类只能回答是或否的问题。',
    'replyMarkdown 虽保留字段名，但正文只能是纯文本短段落；不要 Markdown 标题、项目符号、编号列表、引用、代码围栏或加粗符号。',
    '你会收到 workingBrief；请在同一次回复中返回更新后的完整 workingBrief，不确定的信息保持为空，不得猜测素材内容。',
    '你会收到实际图片或视频抽帧。回答必须引用你真实观察到的主体、构图、色彩、动作或镜头证据；音频/文件若只有元数据就明确按元数据处理。',
    'phaseDecision 只能表达对创作阶段的建议：idea/script/assets/shots/candidates/delivery；系统会用真实动作证据裁决是否推进。',
    '你会收到当前可信阶段。stay 必须保持当前阶段；advance 最多建议紧邻的下一阶段，不能跳级；revise 只用于返回更早阶段修改。信息很完整也要按相邻阶段推进。',
    '最后提供三个真正不同的下一步建议，顺序和 role 固定为 recommended、alternative、execute；intentKind 必须互不相同。',
    '三个建议都是替用户回填输入框的真实意图，必须遵守用户明确要求、选中文字、锁定事实和本轮限定修改范围。alternative 可以改变表现方法、情绪或创作手法，但不能撤销用户刚指定的事实或把限定范围外的内容改掉。',
    'recommended 给最值得先看或先补的一步，产出应当可继续修改，并且必须沿用 replyMarkdown 已经给出的明确倾向；不能重新比较用户原来的 A/B、两种方案或让用户再决定。alternative 才承载实质不同的创意方向，不能只替换一个形容词。execute 也必须沿用正文的明确倾向，表示不再讨论，直接锁定当前结论或执行已经明确的动作；不得写成“先不定、暂时留白、以后再说”或退回未决状态。',
    '当用户已经给出“只改结尾”等精确修改时，recommended 应在允许范围内优化镜头、节奏、表演、声音、光线或转场，给一份可继续修改的小稿；不能只是复述新结尾后再要求写完整脚本。execute 才负责接受并锁定这次修改。',
    'recommended 与 execute 不能要求同一种交付物、推进到同一个结果，不能只是“先做”和“直接做”的区别；如果 recommended 已经要写脚本、分镜或提示词，execute 就应锁定现有决定或执行另一项明确动作。execute 要短，强调锁定后进入下一环节，不要重复正文和 recommended 里的长串创意事实。',
    '每个建议 label 使用短口语（中文不超过 14 个汉字，英文不超过 28 个字符），sendText 是点击后能独立表达完整意图的自然句子；三条不能是同一句话加“直接、立即、试试”等前后缀。',
    '用户说“不要生成、先别生成、只评价”时，proposedAction 必须为 null，三个建议也不能偷偷改写成生成、出图或出视频。用户明确说只评价且不要改时，workingBrief 原样保留，三个建议只能给不同评价角度或结束评价，不能建议修改作品。',
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
        { label: '推荐下一步', sendText: '发送给助手的完整自然语言', intentKind: 'recommended-next-step', role: 'recommended', inputAssetIds: [] },
        { label: '换个方向', sendText: '发送给助手的完整自然语言', intentKind: 'alternative-direction', role: 'alternative', inputAssetIds: [] },
        { label: '直接执行', sendText: '发送给助手的完整自然语言', intentKind: 'execute-or-confirm', role: 'execute', inputAssetIds: [] },
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

  async function respond(input = {}, hooks = {}) {
    const prompt = bounded(input.prompt, 30_000);
    if (!prompt) throw new CreatorLlmRuntimeError('CREATOR_PROMPT_EMPTY', '请输入创作需求', 400);
    const llmSnapshot = modelSnapshot('llm', input.preferences || {});
    const settings = settingsProvider() || {};
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
          : ''), 12_000),
      })).filter((item) => item.assetId);
    if (availableAssets.some((item) => ['image', 'video'].includes(item.kind))
      && !DOCUMENTED_VISION_MODELS.has(`${llmSnapshot.providerId}:${llmSnapshot.modelId}`)) {
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
    const result = await generateChat(provider, {
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
    }, {
      signal: controller.signal,
      timeoutMs: Math.max(30_000, Math.min(10 * 60_000, Number(options.timeoutMs) || 180_000)),
      fetchImpl: options.fetchImpl,
    });
    if (!result?.ok) {
      const stopped = ['request_aborted', 'stopped'].includes(String(result?.code || ''));
      throw new CreatorLlmRuntimeError(
        stopped ? 'CREATOR_LLM_STOPPED' : 'CREATOR_LLM_FAILED',
        stopped ? '已停止这次回复。' : bounded(result?.error, 500) || '模型暂时没有回复，请重试',
        stopped ? 409 : 502,
      );
    }
    const envelope = parseJsonEnvelope(result.text);
    if (envelope.schema !== CREATOR_LLM_RESPONSE_SCHEMA) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_SCHEMA_INVALID', '模型回复版本不匹配，请重试');
    }
    const mergedBrief = mergeWorkingBrief(brief, envelope.workingBrief, policy, prompt);
    const contracted = enforceQuestionContract(envelope.replyMarkdown, mergedBrief, policy);
    const replyMarkdown = validateNaturalReply(normalizeReplyLayout(contracted.replyMarkdown));
    const normalizedSuggestions = enforceSuggestionPolicy(normalizeSuggestions(envelope.suggestions), policy);
    if (policy.generationProhibited
      && suggestsGeneration(normalizedSuggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n'))) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_ACTION_PROHIBITED', '模型建议违反了用户“不生成”的要求');
    }
    if (/(价格|费用|余额|额度|账单|单价|cost|price|billing|balance|quota)/iu.test(`${replyMarkdown}\n${normalizedSuggestions.map((item) => `${item.label}\n${item.sendText}`).join('\n')}`)) {
      throw new CreatorLlmRuntimeError('CREATOR_LLM_FORBIDDEN_COST_TEXT', '模型回复包含不应展示的费用信息，请重试');
    }
    const response = {
      schema: CREATOR_LLM_RESPONSE_SCHEMA,
      replyMarkdown,
      workingBrief: contracted.workingBrief,
      phaseDecision: normalizePhaseDecision(envelope.phaseDecision),
      suggestions: normalizedSuggestions,
      proposedAction: normalizeAction(envelope.proposedAction, input.preferences || {}, policy),
      evidence: {
        providerCalls: 1,
        providerId: llmSnapshot.providerId,
        modelId: llmSnapshot.modelId,
        catalogDigest: llmSnapshot.catalogDigest,
        responseDigest: digest({ replyMarkdown, workingBrief: contracted.workingBrief, phaseDecision: envelope.phaseDecision, suggestions: envelope.suggestions, proposedAction: envelope.proposedAction }),
      },
    };
    return response;
  }

  return { respond, modelSnapshot };
}

module.exports = {
  CREATOR_LLM_RESPONSE_SCHEMA,
  CreatorLlmRuntimeError,
  DEFAULT_MODELS,
  createCreatorLlmRuntimeV2,
  modelSnapshot,
  mergeWorkingBrief,
  parseJsonEnvelope,
  providerFromSettings,
  turnPolicy,
};
