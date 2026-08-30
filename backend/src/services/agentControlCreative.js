const crypto = require('node:crypto');
const fs = require('node:fs');
const nodeSchemaManifest = require('../shared/canvasNodeSchema.json');
const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const storyCreative = require('./agentControlStoryCreative');
const {
  DEFAULT_ADVANCED_PROVIDERS,
  normalizeAdvancedProviders,
} = require('../providers/registry');
const { assertCreatorModelDecisionReceipt } = require('./creatorAgentModelDecision');

const CREATIVE_PLAN_TTL_MS = 30 * 60 * 1000;
const CREATIVE_PLAN_LIMIT = 96;
const CREATIVE_STATE_SCHEMA = 't8-creative-state-v1';
const CREATIVE_PLAN_SCHEMA = 't8-creative-plan-v1';
const CREATOR_PRODUCTION_DOCUMENT_SCHEMA = 't8-creator-production-document-v1';
const CREATOR_PRODUCTION_DOCUMENT_KINDS = Object.freeze([
  'production-brief',
  'reference-breakdown',
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
]);
const CREATIVE_PLAN_KINDS = Object.freeze([
  'plan-card',
  'image',
  'edit-image',
  'video',
  'edit-video',
  'audio',
  'script',
  'story',
]);
const CREATIVE_ITERATE_ACTIONS = Object.freeze([
  'review',
  'lock',
  'unlock',
  'branch',
  'accept',
  'rollback',
]);
const LOCALIZATION_ACTIONS = Object.freeze([
  'localization.create',
  'localization.transcribe',
  'localization.translate',
  'localization.cast-voices',
  'localization.generate-dub',
  'localization.compose',
  'localization.verify',
  'localization.package',
]);
const CREATIVE_ACTIONS = Object.freeze([
  ...CREATIVE_ITERATE_ACTIONS,
  ...LOCALIZATION_ACTIONS,
  'graph.node-add',
  'production.continue',
  'video.extract-frames',
  'image.remove-solid-background',
  'image.resample-upscale',
  'story.analyze',
  'story.import',
  'story.bind-asset',
  'story.compile',
  'story.plan-previews',
  'story.adopt-preview',
  'director.materialize',
  'video-edit.compose',
]);
const CREATIVE_READ_ACTIONS = Object.freeze(['compare', 'story.inspect', 'director.inspect', 'video-edit.deliver']);
const CREATOR_NODE_SCHEMA_BY_TYPE = new Map(
  nodeSchemaManifest.types.map((item) => [String(item.type), item]),
);
const STORY_PROJECT_SCHEMA = 't8-story-project-v1';
const CREATIVE_LOCK_KEYS = Object.freeze([
  'identity',
  'wardrobe',
  'background',
  'prompt',
  'productShape',
  'logo',
  'composition',
  'scene',
]);
const PROFILES = Object.freeze({
  economy: {
    label: '省钱预览',
    candidates: 1,
    preview: '先用最低可用规格验证构图和叙事，再升级已采用候选。',
  },
  balanced: {
    label: '平衡创作',
    candidates: 3,
    preview: '先做 3 个可比较方向，采用后只完善被选中的版本。',
  },
  quality: {
    label: '质量优先',
    candidates: 4,
    preview: '增加候选覆盖，并优先保护角色、服装、场景与镜头连续性。',
  },
  custom: {
    label: '自定义',
    candidates: 2,
    preview: '完全遵循显式候选数、模型、平台与输出设置。',
  },
});
const CREATOR_RECIPES = Object.freeze({
  'short-drama': {
    label: '竖屏短剧',
    duration: 60,
    ratio: '9:16',
    format: '可编辑的剧本、镜头、资产、关键帧、视频与成片链路',
    style: '竖屏短剧，人物关系清楚，前三秒建立冲突，每镜头有明确动作节点',
    template: 'short-drama',
  },
  tvc: {
    label: 'TVC 广告',
    duration: 20,
    ratio: '9:16',
    format: '卖点—演示—利益—品牌收束的广告制片链路',
    style: '商业广告质感，产品识别稳定，卖点可视化，结尾品牌记忆清楚',
    template: 'tvc',
    locks: ['productShape', 'logo', 'prompt'],
  },
  mv: {
    label: '音乐 MV',
    duration: 30,
    ratio: '16:9',
    format: '按音乐段落组织的镜头与节奏方案',
    style: '音乐驱动的视觉节奏，表演、情绪和转场统一',
    template: 'mv',
  },
  product: {
    label: '商品图',
    ratio: '1:1',
    format: '可比较的商品主视觉与细节方向',
    style: '商品外形和材质准确，商业棚拍光，卖点层级清楚',
    template: 'product',
    locks: ['productShape', 'composition', 'prompt'],
  },
  education: {
    label: '知识讲解',
    duration: 60,
    ratio: '16:9',
    format: '结构化讲解脚本、画面提示与旁白',
    style: '信息准确、层级清楚、每段只讲一个核心概念',
    template: 'education',
  },
  remake: {
    label: '参考改编',
    format: '保留参考结构但不覆盖已采用版本的编辑分支',
    style: '保留已锁定主体、服装、背景或节奏，仅修改创作者明确指定部分',
    template: 'remake',
  },
  'character-sheet': {
    label: '角色设定',
    ratio: '16:9',
    format: '白底脸部特写与同一角色三视图',
    style: '身份一致、无遮挡、生产参考图',
    template: 'character-sheet',
    locks: ['identity'],
  },
  storyboard: {
    label: '导演分镜',
    duration: 60,
    ratio: '16:9',
    format: '可编辑镜头表、资产计划、关键帧和视频链路',
    style: '电影分镜，动作、景别、运镜、连续性和硬约束明确',
    template: 'storyboard',
  },
  'shot-breakdown': {
    label: '参考视频拉片',
    duration: 60,
    ratio: '16:9',
    format: '带时间码的镜头、景别、运镜、声音和可编辑 Prompt 分析计划',
    style: '只分析参考视频的节奏、镜头语言、构图和声音结构，不复刻受保护内容，不自动启动生成',
    template: 'storyboard',
    locks: ['composition', 'prompt'],
  },
});

class AgentControlCreativeError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AgentControlCreativeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function storyAction(execute) {
  try {
    return execute();
  } catch (error) {
    if (error instanceof storyCreative.AgentControlStoryCreativeError) {
      throw new AgentControlCreativeError(
        error.code,
        error.message,
        error.status,
        error.details,
      );
    }
    throw error;
  }
}

function stableString(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableString(value)).digest('hex');
}

function stableId(prefix, seed) {
  const safePrefix = String(prefix || 'creative')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'creative';
  return `${safePrefix}-${digest(seed).slice(0, 18)}`;
}

function text(value, maximum = 12_000) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/\u0000/g, '')
    .trim();
  if (normalized.length > maximum) {
    throw new AgentControlCreativeError('CREATIVE_TEXT_TOO_LONG', `创作输入超过 ${maximum} 个字符`);
  }
  return normalized;
}

function excerpt(value, maximum = 500) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maximum);
}

function identifier(value, label = 'ID') {
  const normalized = text(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new AgentControlCreativeError('CREATIVE_ID_INVALID', `${label} 无效`);
  }
  return normalized;
}

function integer(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, 240))
    .filter(Boolean))];
}

function nodeData(node) {
  return record(node?.data);
}

function findNode(document, nodeId) {
  return (Array.isArray(document?.nodes) ? document.nodes : [])
    .find((node) => String(node?.id || '') === String(nodeId || '')) || null;
}

function requireNode(document, nodeId, expectedTypes = []) {
  const node = findNode(document, identifier(nodeId, '节点 ID'));
  if (!node) throw new AgentControlCreativeError('CREATIVE_NODE_NOT_FOUND', '指定节点不存在', 404);
  if (expectedTypes.length && !expectedTypes.includes(String(node.type || ''))) {
    throw new AgentControlCreativeError(
      'CREATIVE_NODE_TYPE_MISMATCH',
      `此操作需要 ${expectedTypes.join(' / ')} 节点，当前是 ${String(node.type || '未知类型')}`,
      409,
    );
  }
  return node;
}

function profileFor(value) {
  const key = String(value || 'balanced').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROFILES, key) ? key : 'balanced';
}

function creatorQuestions(kind, input) {
  const questions = [];
  const prompt = text(input.prompt || input.script || input.goal || input.query, 12_000);
  if (!prompt) {
    questions.push({
      id: 'goal',
      question: kind === 'story' || kind === 'script'
        ? '你希望这个故事讲什么？可以直接粘贴剧本或一句故事梗概。'
        : '你希望最终画面或视频表达什么？',
      reason: '没有创作目标就无法生成可编辑工作流。',
    });
  }
  if (['edit-image', 'edit-video'].includes(kind)
    && !unique(input.assetIds).length) {
    questions.push({
      id: 'reference-asset',
      question: kind === 'edit-image'
        ? '要修改当前项目里的哪一张图片？'
        : '要修改或续写当前项目里的哪一个视频？',
      reason: '必须先绑定原素材，才能保证不覆盖原作并保留未要求变化的部分。',
    });
  }
  if (kind === 'audio'
    && audioTaskFor(input) === 'transcription'
    && !unique(input.assetIds).length) {
    questions.push({
      id: 'audio-source',
      question: '要转写当前项目里的哪一段音频？',
      reason: 'STT 必须绑定一个已持久化音频素材，才能生成可恢复的转写工作流。',
    });
  }
  if (kind === 'video'
    && videoTaskFor(input) === 'lip-sync'
    && unique(input.assetIds).length < 2) {
    questions.push({
      id: 'lip-sync-sources',
      question: '请从当前项目选择一张人物图和一段音频。',
      reason: '已存在的 Creatify Aurora 对口型工作流必须同时绑定图像与音频，不能猜测素材。',
    });
  }
  if (kind === 'story'
    && String(input.recipe || input.template || '').toLowerCase() === 'mv'
    && !unique(input.assetIds).length) {
    questions.push({
      id: 'mv-audio-source',
      question: '要用当前项目里的哪一首歌或音频？',
      reason: 'MV 的节拍、镜头和段落分析必须绑定真实音频素材，不能猜测“这首歌”。',
    });
  }
  if (kind === 'story'
    && String(input.recipe || '').toLowerCase() === 'shot-breakdown'
    && !unique(input.assetIds).length) {
    questions.push({
      id: 'shot-breakdown-video',
      question: '请先上传或引用要拉片的参考视频。',
      reason: '镜头、时间码、运镜和声音分析必须绑定真实视频素材，不能靠文字猜测。',
    });
  }
  return questions.slice(0, 3);
}

function applyNaturalCreativeDefaults(input = {}) {
  const prompt = text(input.prompt || input.script || input.goal || input.query, 200_000);
  const normalized = { ...input };
  if (input.duration == null || input.duration === '') {
    const durationMatch = prompt.match(/(\d{1,5}(?:\.\d+)?)\s*(分钟|分|min(?:ute)?s?|秒|秒钟|s(?:ec(?:ond)?s?)?)\b/i)
      || prompt.match(/(\d{1,5}(?:\.\d+)?)\s*(分钟|分|秒|秒钟)/i);
    if (durationMatch) {
      const numeric = Number(durationMatch[1]);
      normalized.duration = /分钟|分|^min/i.test(durationMatch[2])
        ? Math.round(numeric * 60)
        : Math.round(numeric);
    }
  }
  if (!text(input.ratio, 20)) {
    const explicitRatio = prompt.match(/(?:^|[^\d])(\d{1,2})\s*[:：x×]\s*(\d{1,2})(?:[^\d]|$)/);
    if (explicitRatio) normalized.ratio = `${explicitRatio[1]}:${explicitRatio[2]}`;
    else if (/(?:竖屏|竖版|纵向|portrait)/i.test(prompt)) normalized.ratio = '9:16';
    else if (/(?:方形|正方形|square)/i.test(prompt)) normalized.ratio = '1:1';
    else if (/(?:横屏|横版|宽屏|landscape)/i.test(prompt)) normalized.ratio = '16:9';
  }
  return normalized;
}

function applyCreatorRecipe(input = {}) {
  const explicitRecipeId = text(input.recipe, 80).toLowerCase();
  const templateId = text(input.template, 80).toLowerCase();
  const recipeId = explicitRecipeId || (CREATOR_RECIPES[templateId] ? templateId : 'general');
  const builtIn = CREATOR_RECIPES[recipeId];
  const binding = record(input.recipeDefinition);
  let recipe = builtIn;
  let customRecipe = null;
  if (!recipe && recipeId && recipeId !== 'general') {
    const definition = record(binding.definition);
    const contentDigest = text(binding.contentDigest, 64).toLowerCase();
    if (binding.schema !== 't8-project-recipe-binding-v1'
      || definition.schema !== 't8-creator-recipe-v1'
      || text(definition.id, 80).toLowerCase() !== recipeId
      || !/^[a-f0-9]{64}$/.test(contentDigest)
      || digest(definition) !== contentDigest) {
      throw new AgentControlCreativeError(
        'CREATOR_RECIPE_NOT_FOUND',
        `当前项目没有可验证的配方 ${recipeId}；请选择内置配方或先保存并固定项目配方`,
        409,
      );
    }
    const defaults = record(definition.defaults);
    const guidance = record(definition.guidance);
    const styleGuidance = [
      text(defaults.style, 2_000),
      text(guidance.directorStyle, 4_000),
      text(guidance.characterBible, 4_000),
      text(guidance.productBible, 4_000),
      text(guidance.shotGrammar, 4_000),
      text(guidance.negativeRules, 4_000),
    ].filter(Boolean).join('\n');
    recipe = {
      duration: defaults.duration,
      ratio: text(defaults.ratio, 20),
      format: text(defaults.format, 200),
      style: styleGuidance,
      template: text(defaults.template, 80) || 'general',
      locks: unique(defaults.locks),
    };
    customRecipe = {
      schema: 't8-project-recipe-reference-v1',
      id: recipeId,
      label: text(definition.label, 120) || recipeId,
      version: integer(binding.version, 1, 1, 1_000_000),
      contentDigest,
      stages: unique(definition.stages).slice(0, 24),
      reviewDimensions: unique(definition.reviewDimensions).slice(0, 24),
      guidance: {
        directorStyle: text(guidance.directorStyle, 4_000),
        characterBible: text(guidance.characterBible, 4_000),
        productBible: text(guidance.productBible, 4_000),
        shotGrammar: text(guidance.shotGrammar, 4_000),
        negativeRules: text(guidance.negativeRules, 4_000),
      },
    };
  }
  if (!recipe) return { ...input, recipe: recipeId || 'general' };
  const defaults = record(customRecipe ? binding.definition?.defaults : {});
  return {
    ...input,
    duration: input.duration ?? recipe.duration,
    ratio: text(input.ratio, 20) || recipe.ratio,
    format: text(input.format, 200) || recipe.format,
    style: text(input.style, 500) || recipe.style,
    template: text(input.template, 80) && input.template !== 'general' ? input.template : recipe.template,
    locks: unique([...(Array.isArray(input.locks) ? input.locks : []), ...(recipe.locks || [])]),
    profile: text(input.profile, 40) && input.profile !== 'balanced'
      ? input.profile
      : text(defaults.profile, 40) || input.profile,
    llmProvider: text(input.llmProvider, 160) || text(defaults.llmProvider, 160),
    llmModel: text(input.llmModel, 240) || text(defaults.llmModel, 240),
    imageProvider: text(input.imageProvider, 160) || text(defaults.imageProvider, 160),
    imageModel: text(input.imageModel, 240) || text(defaults.imageModel, 240),
    videoProvider: text(input.videoProvider, 160) || text(defaults.videoProvider, 160),
    videoModel: text(input.videoModel, 240) || text(defaults.videoModel, 240),
    audioProvider: text(input.audioProvider, 160) || text(defaults.audioProvider, 160),
    audioModel: text(input.audioModel, 240) || text(defaults.audioModel, 240),
    recipe: recipeId,
    recipeReference: customRecipe,
  };
}

function creativeBrief(kind, input, profile) {
  const goalLimit = ['script', 'story'].includes(kind) ? 200_000 : 12_000;
  const goal = text(input.prompt || input.script || input.goal || input.query, goalLimit);
  const audioTask = audioTaskFor(input);
  const videoTask = videoTaskFor(input);
  const requestedAudioModel = text(input.audioModel, 240);
  const requestedVideoModel = text(input.videoModel, 240);
  const ratio = text(input.ratio, 20) || (['image', 'edit-image'].includes(kind) ? '1:1' : '16:9');
  const duration = integer(
    input.duration,
    kind === 'story' ? 60 : ['video', 'edit-video'].includes(kind) ? 8 : 0,
    0,
    86_400,
  );
  const language = text(input.language, 40) || '中文';
  return {
    schema: 't8-creative-brief-v1',
    kind,
    goal,
    title: text(input.title, 160) || (kind === 'story'
      ? '未命名 Story'
      : `未命名${['image', 'edit-image'].includes(kind) ? '图像' : ['video', 'edit-video'].includes(kind) ? '视频' : kind === 'audio' ? '音频' : '剧本'}`),
    audience: text(input.audience, 200) || '由创作者确认',
    format: text(input.format, 80) || (kind === 'script' || kind === 'story' ? '可继续编辑的结构化内容' : '可继续迭代的候选素材'),
    ratio,
    durationSec: duration,
    style: text(input.style, 500) || '保持主体清晰、视觉层级明确、风格一致',
    language,
    profile,
    quality: text(input.quality, 40) || 'auto',
    template: text(input.template, 80) || 'general',
    recipe: text(input.recipe, 80) || 'general',
    recipeReference: input.recipeReference ? clone(input.recipeReference) : null,
    provider: text(input.provider, 160),
    model: text(input.model, 240),
    llmProvider: text(input.llmProvider, 160),
    llmModel: text(input.llmModel, 240),
    imageProvider: text(input.imageProvider, 160),
    imageModel: text(input.imageModel, 240),
    videoProvider: text(input.videoProvider, 160) || (videoTask === 'lip-sync' ? 'fal' : ''),
    videoModel: requestedVideoModel || (videoTask === 'lip-sync' ? 'creatify-aurora-fal' : ''),
    videoTask,
    audioProvider: text(input.audioProvider, 160),
    audioModel: requestedAudioModel || (audioTask === 'transcription'
      ? 'xai-stt'
      : ['dialogue', 'voiceover'].includes(audioTask)
        ? 'xai-tts'
        : 'suno-v5.5-generate'),
    audioTask,
    voiceId: text(input.voiceId, 120) || 'eve',
    speaker: text(input.speaker, 240),
    outputFormat: text(input.outputFormat, 40) || 'auto',
    sampleRate: integer(input.sampleRate, 24_000, 8_000, 44_100),
    speechRate: integer(input.speechRate, 0, -50, 100),
    loudnessRate: integer(input.loudnessRate, 0, -50, 100),
    pitchRate: integer(input.pitchRate, 0, -12, 12),
    reuseAssetIds: unique(input.assetIds),
    locks: unique(input.locks),
  };
}

function scriptSceneHeading(value) {
  const line = String(value || '').trim();
  const plain = line.match(/^(?:scene|场景)\s*(?:[一二三四五六七八九十百0-9]+)?\s*[:：-]\s*(.+)$/i);
  if (plain?.[1]) return plain[1].trim();
  const bracketed = line.match(/^[【[]\s*(?:scene|场景)\s*(?:[一二三四五六七八九十百0-9]+)?\s*(?:[|｜:：-]\s*)?(.+?)\s*[】\]]$/i);
  return bracketed?.[1]?.trim() || '';
}

function scriptShotHeading(value) {
  const line = String(value || '').trim();
  const bracketed = line.match(/^[【[]\s*(?:shot|镜头)\s*([一二三四五六七八九十百0-9]*)\s*(?:[|｜:：-]\s*(.*?))?\s*[】\]]$/i);
  if (bracketed) {
    return {
      marker: bracketed[1]?.trim() || '',
      title: bracketed[2]?.trim() || line.replace(/^[【[]|[】\]]$/g, '').trim(),
    };
  }
  const plain = line.match(/^(?:shot|镜头)\s*([一二三四五六七八九十百0-9]+)\s*(?:[|｜:：-]\s*(.+))?$/i);
  if (!plain) return null;
  return {
    marker: plain[1]?.trim() || '',
    title: plain[2]?.trim() || line,
  };
}

function scriptExplicitCharacters(lines) {
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = String(lines[index] || '').trim().match(/^(?:characters?|人物|角色)\s*[:：]\s*(.+)$/i);
    if (!match?.[1]) continue;
    for (const raw of match[1].split(/[,，、/；;]+/)) {
      const name = text(raw, 80);
      if (!name || values.some((item) => item.name === name)) continue;
      values.push({ name, sourceLine: index + 1 });
      if (values.length >= 80) return values;
    }
  }
  return values;
}

function analyseScriptSource(sourceValue) {
  const sourceText = text(sourceValue, 200_000);
  const normalized = sourceText.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const sourceDigest = digest({ sourceText });
  const scenes = [];
  const shots = [];
  let currentScene = null;
  let currentShot = null;

  const closeShot = (lineEnd) => {
    if (!currentShot) return;
    currentShot.sourceRange.lineEnd = Math.max(currentShot.sourceRange.lineStart, lineEnd);
    const chunk = lines
      .slice(currentShot.sourceRange.lineStart - 1, currentShot.sourceRange.lineEnd)
      .join('\n')
      .trim();
    currentShot.sourceText = chunk.slice(0, 6_000);
    currentShot.sourceTextTruncated = chunk.length > 6_000;
    currentShot = null;
  };
  const closeScene = (lineEnd) => {
    if (!currentScene) return;
    currentScene.sourceRange.lineEnd = Math.max(currentScene.sourceRange.lineStart, lineEnd);
    currentScene = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const sceneTitle = scriptSceneHeading(lines[index]);
    if (sceneTitle) {
      closeShot(lineNumber - 1);
      closeScene(lineNumber - 1);
      currentScene = {
        id: stableId('creator-script-scene', `${sourceDigest}:${scenes.length + 1}:${sceneTitle}`),
        ordinal: scenes.length + 1,
        title: text(sceneTitle, 240),
        sourceRange: { lineStart: lineNumber, lineEnd: lineNumber },
        shotIds: [],
      };
      scenes.push(currentScene);
      continue;
    }
    const heading = scriptShotHeading(lines[index]);
    if (!heading) continue;
    closeShot(lineNumber - 1);
    const shot = {
      id: stableId('creator-script-shot', `${sourceDigest}:${shots.length + 1}:${heading.marker}:${heading.title}`),
      ordinal: shots.length + 1,
      marker: text(heading.marker, 40),
      title: text(heading.title, 240) || `镜头 ${shots.length + 1}`,
      sceneId: currentScene?.id || null,
      sourceRange: { lineStart: lineNumber, lineEnd: lineNumber },
      sourceText: '',
      sourceTextTruncated: false,
    };
    shots.push(shot);
    currentScene?.shotIds.push(shot.id);
    currentShot = shot;
  }
  closeShot(lines.length);
  closeScene(lines.length);

  const characters = scriptExplicitCharacters(lines);
  const unresolved = [];
  if (scenes.length === 0) unresolved.push('未识别明确场景标题');
  if (shots.length === 0) unresolved.push('未识别明确镜头标题');
  if (characters.length === 0) unresolved.push('未识别明确人物标签');
  const structured = scenes.length > 0 || shots.length > 0 || characters.length > 0;
  return {
    schema: 't8-creator-script-analysis-v1',
    status: structured ? 'source-structured' : 'needs-structure',
    method: 'deterministic-source-map',
    sourceBacked: true,
    sourceDigest,
    providerCalls: 0,
    inferredFacts: 0,
    counts: {
      scenes: scenes.length,
      shots: shots.length,
      characters: characters.length,
    },
    outline: shots.map((shot) => shot.title),
    characters,
    scenes,
    shots,
    unresolved,
  };
}

function analyseSingleOutputSource(sourceValue, kind, analysisValue = null) {
  const analysis = analysisValue || analyseScriptSource(sourceValue);
  const sourceText = text(sourceValue, 200_000);
  const normalizedKind = text(kind, 40).toLowerCase();
  const singleOutputKinds = new Set(['image', 'edit-image', 'video', 'edit-video', 'audio']);
  if (!singleOutputKinds.has(normalizedKind)
    || !sourceText
    || (Array.isArray(analysis.shots) && analysis.shots.length > 0)) {
    return analysis;
  }
  const lines = sourceText.replace(/\r\n?/g, '\n').split('\n');
  const title = ['image', 'edit-image'].includes(normalizedKind)
    ? '主画面'
    : ['video', 'edit-video'].includes(normalizedKind)
      ? '主镜头'
      : '主音频段落';
  const shot = {
    id: stableId('creator-script-shot', `${analysis.sourceDigest}:single-output:${normalizedKind}`),
    ordinal: 1,
    marker: '1',
    title,
    sceneId: null,
    sourceRange: { lineStart: 1, lineEnd: Math.max(1, lines.length) },
    sourceText: sourceText.slice(0, 6_000),
    sourceTextTruncated: sourceText.length > 6_000,
  };
  return {
    ...analysis,
    status: 'source-structured',
    method: 'deterministic-single-output-source-map',
    inferredFacts: 0,
    counts: {
      ...analysis.counts,
      shots: 1,
    },
    outline: [title],
    shots: [shot],
    unresolved: (Array.isArray(analysis.unresolved) ? analysis.unresolved : [])
      .filter((item) => item !== '未识别明确镜头标题'),
    singleOutputFallback: true,
  };
}

function productionSourceLine(scriptDocument, lineStart, lineEnd = lineStart) {
  const lines = text(scriptDocument?.content?.sourceText, 200_000)
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const start = Math.max(1, integer(lineStart, 1, 1, Math.max(1, lines.length)));
  const end = Math.max(start, integer(lineEnd, start, start, Math.max(start, lines.length)));
  const sourceText = lines.slice(start - 1, end).join('\n').trim();
  return {
    lineStart: start,
    lineEnd: end,
    sourceText: sourceText.slice(0, 1_000),
    sourceTextTruncated: sourceText.length > 1_000,
  };
}

function productionSourceDerivation(scriptDocument) {
  const analysis = record(scriptDocument?.content?.scriptAnalysis);
  const upstreamDerivation = record(scriptDocument?.content?.derivation);
  return {
    schema: 't8-creator-source-derivation-v1',
    method: text(analysis.method, 120) || 'deterministic-source-map',
    sourceBacked: true,
    sourceDocumentId: text(scriptDocument?.id, 160),
    sourceVersionId: text(scriptDocument?.versionId, 160),
    sourceContentDigest: text(scriptDocument?.contentDigest, 64),
    sourceDigest: text(analysis.sourceDigest || upstreamDerivation.sourceDigest, 64),
    providerCalls: 0,
    inferredFacts: 0,
    singleOutputFallback: analysis.singleOutputFallback === true,
  };
}

function productionCharacterBible(scriptDocument, brief) {
  const sourceDigest = text(scriptDocument?.content?.scriptAnalysis?.sourceDigest, 64);
  const characters = (Array.isArray(scriptDocument?.content?.characters)
    ? scriptDocument.content.characters
    : []).map((item, index) => {
    const name = text(item?.name, 80);
    const sourceLine = integer(item?.sourceLine, 1, 1, 200_000);
    return {
      id: stableId('creator-character', `${sourceDigest}:${index + 1}:${name}:${sourceLine}`),
      name,
      sourceEvidence: productionSourceLine(scriptDocument, sourceLine),
      appearance: '',
      wardrobe: '',
      personality: '',
      continuityNotes: [],
      unresolved: ['外观', '服装', '性格', '连续性细节'],
    };
  }).filter((item) => item.name);
  return {
    title: `${brief.title} · 角色设定`,
    language: brief.language,
    status: characters.length > 0 ? 'source-proposed' : 'needs-explicit-characters',
    derivation: productionSourceDerivation(scriptDocument),
    characters,
    missingSections: characters.length > 0
      ? ['角色外观', '服装', '性格', '连续性细节']
      : ['原文明示人物', '角色外观', '服装', '性格', '连续性细节'],
    editingGuidance: characters.length > 0
      ? '只把原文明示人物建立为待审角色卡；外观、服装、性格和连续性细节保持空白，等待创作者补充。'
      : '剧本没有明示人物标签；不会从正文名字或动作中猜测角色。可补写 Characters/人物/角色 标签。',
  };
}

function productionAssetNeeds(scriptDocument, brief) {
  const sourceDigest = text(scriptDocument?.content?.scriptAnalysis?.sourceDigest, 64);
  const characterNeeds = (Array.isArray(scriptDocument?.content?.characters)
    ? scriptDocument.content.characters
    : []).map((item, index) => {
    const label = text(item?.name, 80);
    const sourceLine = integer(item?.sourceLine, 1, 1, 200_000);
    return {
      id: stableId('creator-asset-need', `${sourceDigest}:character:${index + 1}:${label}:${sourceLine}`),
      kind: 'character',
      label,
      status: 'missing',
      sourceEvidence: productionSourceLine(scriptDocument, sourceLine),
      requirements: [],
      acceptedAssetId: null,
      locked: false,
    };
  }).filter((item) => item.label);
  const locationNeeds = (Array.isArray(scriptDocument?.content?.scenes)
    ? scriptDocument.content.scenes
    : []).map((item, index) => {
    const label = text(item?.title, 240);
    const sourceRange = record(item?.sourceRange);
    const sourceLine = integer(sourceRange.lineStart, 1, 1, 200_000);
    return {
      id: stableId('creator-asset-need', `${sourceDigest}:location:${index + 1}:${label}:${sourceLine}`),
      kind: 'location',
      label,
      status: 'missing',
      sourceEvidence: productionSourceLine(scriptDocument, sourceLine),
      requirements: [],
      acceptedAssetId: null,
      locked: false,
    };
  }).filter((item) => item.label);
  const needs = [...characterNeeds, ...locationNeeds];
  return {
    title: `${brief.title} · 资产缺口`,
    language: brief.language,
    status: needs.length > 0 ? 'source-proposed' : 'needs-explicit-source',
    derivation: productionSourceDerivation(scriptDocument),
    counts: {
      total: needs.length,
      characters: characterNeeds.length,
      locations: locationNeeds.length,
    },
    needs,
    generationScope: 'none',
    editingGuidance: needs.length > 0
      ? '只列出原文明示人物和场景标题对应的资产缺口；没有上传、生成、采用、锁定或覆盖任何素材。'
      : '剧本没有可验证的人物标签或场景标题；资产缺口保持空白，不从正文关键词猜测。',
  };
}

function productionShotList(scriptDocument, brief) {
  const sourceDigest = text(scriptDocument?.content?.scriptAnalysis?.sourceDigest, 64);
  const sourceScenes = Array.isArray(scriptDocument?.content?.scenes)
    ? scriptDocument.content.scenes
    : [];
  const sourceShots = Array.isArray(scriptDocument?.content?.shots)
    ? scriptDocument.content.shots
    : [];
  const scenesById = new Map(sourceScenes.map((scene) => [String(scene?.id || ''), scene]));
  const shots = sourceShots.map((item, index) => {
    const sourceRange = record(item?.sourceRange);
    const lineStart = integer(sourceRange.lineStart, 1, 1, 200_000);
    const lineEnd = integer(sourceRange.lineEnd, lineStart, lineStart, 200_000);
    const sourceShotId = text(item?.id, 160);
    const scene = scenesById.get(String(item?.sceneId || '')) || null;
    return {
      id: stableId(
        'creator-shot-list-item',
        `${sourceDigest}:${index + 1}:${sourceShotId}:${lineStart}:${lineEnd}`,
      ),
      sourceShotId,
      ordinal: integer(item?.ordinal, index + 1, 1, 20_000),
      marker: text(item?.marker, 40),
      title: text(item?.title, 240) || `镜头 ${index + 1}`,
      sceneId: text(item?.sceneId, 160) || null,
      sceneTitle: text(scene?.title, 240),
      sourceEvidence: productionSourceLine(scriptDocument, lineStart, lineEnd),
      sourceRange: { lineStart, lineEnd },
      sourceText: text(item?.sourceText, 6_000),
      sourceTextTruncated: item?.sourceTextTruncated === true,
      description: text(item?.sourceText, 6_000),
      durationSec: null,
      shotSize: '',
      cameraMovement: '',
      dialogue: '',
      soundDesign: '',
      relatedAssetNeedIds: [],
      status: 'source-proposed',
      unresolved: ['时长', '景别', '运镜', '对白/旁白', '声音设计', '关联资产'],
    };
  });
  return {
    title: `${brief.title} · 镜头表`,
    language: brief.language,
    status: shots.length > 0 ? 'source-proposed' : 'needs-explicit-shots',
    derivation: productionSourceDerivation(scriptDocument),
    counts: {
      total: shots.length,
      scenes: new Set(shots.map((item) => item.sceneId).filter(Boolean)).size,
      shots: shots.length,
    },
    shots,
    generationScope: 'none',
    editingGuidance: shots.length > 0
      ? '只把原文明示镜头整理为可审阅镜头表；时长、景别、运镜、对白、声音和关联资产保持空白，等待创作者补充。'
      : '剧本没有明示镜头标题；不会从正文段落猜测镜头切分。可补写 Shot/镜头 标题。',
  };
}

const PRODUCTION_AUDIO_CUE_ROLE_BY_LABEL = Object.freeze({
  '对白': 'dialogue',
  '台词': 'dialogue',
  dialogue: 'dialogue',
  '旁白': 'voiceover',
  '解说': 'voiceover',
  voiceover: 'voiceover',
  narration: 'voiceover',
  '音乐': 'music',
  '配乐': 'music',
  bgm: 'music',
  music: 'music',
  '环境声': 'ambience',
  '氛围声': 'ambience',
  ambience: 'ambience',
  ambient: 'ambience',
  '音效': 'sfx',
  sfx: 'sfx',
  'sound effect': 'sfx',
  'sound effects': 'sfx',
});
const PRODUCTION_AUDIO_CUE_BRACKETED = /^(?:【|\[)\s*(对白|台词|dialogue|旁白|解说|voiceover|narration|音乐|配乐|bgm|music|环境声|氛围声|ambience|ambient|音效|sfx|sound\s*effects?)\s*(?:】|\])\s*(?:[:：|｜—-]\s*)?(.+)$/iu;
const PRODUCTION_AUDIO_CUE_BARE = /^(对白|台词|dialogue|旁白|解说|voiceover|narration|音乐|配乐|bgm|music|环境声|氛围声|ambience|ambient|音效|sfx|sound\s*effects?)\s*[:：|｜—-]\s*(.+)$/iu;

function productionAudioCue(lineValue) {
  const line = String(lineValue ?? '')
    .normalize('NFKC')
    .replace(/^[*•-]\s*/, '')
    .trim();
  if (!line) return null;
  const match = line.match(PRODUCTION_AUDIO_CUE_BRACKETED)
    || line.match(PRODUCTION_AUDIO_CUE_BARE);
  if (!match) return null;
  const label = String(match[1] || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const cueText = String(match[2] || '').trim();
  const role = PRODUCTION_AUDIO_CUE_ROLE_BY_LABEL[label];
  return role && cueText ? { role, cueText } : null;
}

function productionAudioPlan(shotListDocument, brief) {
  const sourceDigest = text(shotListDocument?.content?.derivation?.sourceDigest, 64);
  const sourceShots = Array.isArray(shotListDocument?.content?.shots)
    ? shotListDocument.content.shots
    : [];
  const items = [];
  for (const shot of sourceShots) {
    const sourceEvidence = record(shot?.sourceEvidence);
    const evidenceLineStart = integer(sourceEvidence.lineStart, 1, 1, 200_000);
    const evidenceLines = String(sourceEvidence.sourceText || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    for (let lineIndex = 0; lineIndex < evidenceLines.length; lineIndex += 1) {
      const cue = productionAudioCue(evidenceLines[lineIndex]);
      if (!cue) continue;
      const absoluteLine = evidenceLineStart + lineIndex;
      const sourceLine = String(evidenceLines[lineIndex] || '').trim();
      items.push({
        id: stableId(
          'creator-audio-plan-item',
          `${sourceDigest}:${text(shot?.id, 160)}:${absoluteLine}:${cue.role}`,
        ),
        shotListItemId: text(shot?.id, 160),
        sourceShotId: text(shot?.sourceShotId, 160),
        ordinal: items.length + 1,
        shotOrdinal: integer(shot?.ordinal, items.length + 1, 1, 20_000),
        title: text(shot?.title, 240) || `镜头 ${items.length + 1}`,
        sceneTitle: text(shot?.sceneTitle, 240),
        role: cue.role,
        cueText: text(cue.cueText, 2_000),
        sourceEvidence: {
          lineStart: absoluteLine,
          lineEnd: absoluteLine,
          sourceText: sourceLine.slice(0, 1_000),
          sourceTextTruncated: sourceLine.length > 1_000
            || (
              sourceEvidence.sourceTextTruncated === true
              && lineIndex === evidenceLines.length - 1
            ),
        },
        trackStatus: 'source-draft',
        promptSource: 'script-evidence',
        speaker: null,
        voice: null,
        timing: {
          startSec: null,
          endSec: null,
          durationSec: null,
        },
        loudness: null,
        referenceAssetIds: [],
        provider: null,
        model: null,
        generationStatus: 'not-requested',
        resultUrls: [],
        locked: false,
        unresolved: ['说话人/声源', '起止时间', '时长', '音色/演奏', '响度与混音', '参考资产与模型'],
      });
    }
  }
  const roleCounts = {
    dialogue: items.filter((item) => item.role === 'dialogue').length,
    voiceover: items.filter((item) => item.role === 'voiceover').length,
    music: items.filter((item) => item.role === 'music').length,
    ambience: items.filter((item) => item.role === 'ambience').length,
    sfx: items.filter((item) => item.role === 'sfx').length,
  };
  return {
    title: `${brief.title} · AudioPlan`,
    language: brief.language,
    status: items.length > 0 ? 'source-proposed' : 'needs-explicit-audio-cues',
    derivation: productionSourceDerivation(shotListDocument),
    counts: {
      total: items.length,
      ...roleCounts,
    },
    items,
    mix: {
      schema: 't8-creator-audio-mix-plan-v1',
      strategy: 'per-shot-layered',
      roles: Object.entries(roleCounts)
        .filter(([, count]) => count > 0)
        .map(([role]) => role),
      timingStatus: 'unassigned',
      loudnessStatus: 'unassigned',
      duckingStatus: 'unassigned',
      fadesStatus: 'unassigned',
      requiresCreatorReview: true,
    },
    generationScope: 'none',
    editingGuidance: items.length > 0
      ? '只收录原文中明确标注的对白、旁白、音乐、环境声和 SFX，并保留精确行号；没有选择 Provider/模型、生成音频、上传素材或提交任务。'
      : '镜头原文没有明确的 对白/旁白/音乐/环境声/音效 标签；不会从“雨声”等正文描述猜测声音计划。',
  };
}

function productionStoryboard(shotListDocument, brief) {
  const sourceDigest = text(shotListDocument?.content?.derivation?.sourceDigest, 64);
  const sourceShots = Array.isArray(shotListDocument?.content?.shots)
    ? shotListDocument.content.shots
    : [];
  const frames = sourceShots.map((item, index) => {
    const sourceEvidence = record(item?.sourceEvidence);
    return {
      id: stableId(
        'creator-storyboard-frame',
        `${sourceDigest}:${index + 1}:${text(item?.id, 160)}:${text(item?.sourceShotId, 160)}`,
      ),
      shotListItemId: text(item?.id, 160),
      sourceShotId: text(item?.sourceShotId, 160),
      ordinal: integer(item?.ordinal, index + 1, 1, 20_000),
      title: text(item?.title, 240) || `镜头 ${index + 1}`,
      sceneTitle: text(item?.sceneTitle, 240),
      sourceEvidence: {
        lineStart: integer(sourceEvidence.lineStart, 1, 1, 200_000),
        lineEnd: integer(
          sourceEvidence.lineEnd,
          integer(sourceEvidence.lineStart, 1, 1, 200_000),
          1,
          200_000,
        ),
        sourceText: text(sourceEvidence.sourceText, 1_000),
        sourceTextTruncated: sourceEvidence.sourceTextTruncated === true,
      },
      frameStatus: 'missing',
      candidateIds: [],
      selectedCandidateId: null,
      assetId: null,
      acceptedAt: null,
      locked: false,
      prompt: '',
      composition: '',
      continuityNotes: [],
      unresolved: ['构图', '主体状态', '参考资产', '分镜画面'],
    };
  });
  return {
    title: `${brief.title} · 分镜板`,
    language: brief.language,
    status: frames.length > 0 ? 'source-proposed' : 'needs-shot-list',
    derivation: productionSourceDerivation(shotListDocument),
    counts: {
      total: frames.length,
      ready: 0,
      missing: frames.length,
    },
    frames,
    adoptionPolicy: 'explicit-only',
    generationScope: 'none',
    editingGuidance: frames.length > 0
      ? '每个已确认镜头只有一个待补分镜格；没有候选、素材、采用或锁定，生成结果必须由创作者显式选择。'
      : '当前镜头表没有原文明示镜头；不会创建空耗费的分镜生成任务。',
  };
}

function productionPromptPack(storyboardDocument, brief) {
  const sourceDigest = text(storyboardDocument?.content?.derivation?.sourceDigest, 64);
  const sourceFrames = Array.isArray(storyboardDocument?.content?.frames)
    ? storyboardDocument.content.frames
    : [];
  const prompts = sourceFrames.map((item, index) => {
    const sourceEvidence = record(item?.sourceEvidence);
    const lineStart = integer(sourceEvidence.lineStart, 1, 1, 200_000);
    const lineEnd = integer(sourceEvidence.lineEnd, lineStart, lineStart, 200_000);
    const positivePrompt = text(sourceEvidence.sourceText, 2_000);
    return {
      id: stableId(
        'creator-prompt-pack-item',
        `${sourceDigest}:${index + 1}:${text(item?.id, 160)}:${text(item?.sourceShotId, 160)}`,
      ),
      storyboardFrameId: text(item?.id, 160),
      shotListItemId: text(item?.shotListItemId, 160),
      sourceShotId: text(item?.sourceShotId, 160),
      ordinal: integer(item?.ordinal, index + 1, 1, 20_000),
      title: text(item?.title, 240) || `镜头 ${index + 1}`,
      sceneTitle: text(item?.sceneTitle, 240),
      sourceEvidence: {
        lineStart,
        lineEnd,
        sourceText: positivePrompt,
        sourceTextTruncated: sourceEvidence.sourceTextTruncated === true,
      },
      promptStatus: 'source-draft',
      promptSource: 'script-evidence',
      positivePrompt,
      negativePrompt: '',
      motionPrompt: '',
      audioPrompt: '',
      referenceAssetIds: [],
      modelSelection: {
        image: null,
        video: null,
        audio: null,
      },
      creatorReviewed: false,
      locked: false,
      unresolved: ['负向提示词', '运镜/动作提示词', '声音提示词', '参考资产', '模型选择'],
    };
  });
  return {
    title: `${brief.title} · PromptPack`,
    language: brief.language,
    status: prompts.length > 0 ? 'source-proposed' : 'needs-storyboard',
    derivation: productionSourceDerivation(storyboardDocument),
    counts: {
      total: prompts.length,
      drafts: prompts.length,
      reviewed: 0,
    },
    prompts,
    reviewPolicy: 'explicit-confirmation',
    generationScope: 'none',
    editingGuidance: prompts.length > 0
      ? '正向提示词仅逐字复用每格原文证据作为可编辑起点；没有补写负向、动作、声音、参考资产或模型，也没有提交生成。'
      : '当前分镜板没有可验证分镜格；不会创建空 Prompt 或生成任务。',
  };
}

function normalizedProductionEvidenceText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizedProductionShotEvidence(value) {
  const lines = normalizedProductionEvidenceText(value).split('\n');
  if (/^(?:【\s*)?(?:镜头|shot)\s*[一二三四五六七八九十百千万零〇两\d]*(?:\s*[｜|:：·-]\s*[^】\n]+)?(?:\s*】)?\s*$/i
    .test(lines[0] || '')) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

function creatorProductionBinding(productionDocuments, project = null) {
  const documents = Array.isArray(productionDocuments) ? productionDocuments : [];
  const promptPack = documents.find((item) => item?.kind === 'prompt-pack');
  if (!promptPack) return null;
  const prompts = Array.isArray(promptPack.content?.prompts) ? promptPack.content.prompts : [];
  const binding = {
    schema: 't8-creator-production-binding-v1',
    promptPackDocumentId: text(promptPack.id, 160),
    promptPackVersionId: text(promptPack.versionId, 160),
    promptPackContentDigest: text(promptPack.contentDigest, 64),
    shotBindings: [],
  };
  if (!project || !Array.isArray(project.shots) || prompts.length === 0) return binding;
  const promptsByEvidenceDigest = new Map();
  for (const prompt of prompts) {
    const sourceText = normalizedProductionShotEvidence(prompt?.sourceEvidence?.sourceText);
    if (!sourceText) continue;
    const sourceTextDigest = digest(sourceText);
    const items = promptsByEvidenceDigest.get(sourceTextDigest) || [];
    items.push(prompt);
    promptsByEvidenceDigest.set(sourceTextDigest, items);
  }
  binding.shotBindings = project.shots.flatMap((shot) => {
    const sourceText = normalizedProductionShotEvidence(
      record(shot?.sourceSpan).text || shot?.sourceText);
    if (!sourceText) return [];
    const sourceTextDigest = digest(sourceText);
    const matches = promptsByEvidenceDigest.get(sourceTextDigest) || [];
    if (matches.length !== 1) return [];
    const prompt = matches[0];
    return [{
      storyShotId: text(shot?.id, 160),
      promptPackItemId: text(prompt?.id, 160),
      storyboardFrameId: text(prompt?.storyboardFrameId, 160),
      shotListItemId: text(prompt?.shotListItemId, 160),
      sourceShotId: text(prompt?.sourceShotId, 160),
      sourceTextDigest,
      matchMethod: 'exact-shot-source-evidence',
    }];
  });
  return binding;
}

function creatorProductionCandidateBinding(productionDocuments) {
  const documents = Array.isArray(productionDocuments) ? productionDocuments : [];
  const promptPack = documents.find((item) => item?.kind === 'prompt-pack');
  const prompts = Array.isArray(promptPack?.content?.prompts) ? promptPack.content.prompts : [];
  if (prompts.length !== 1) return null;
  const binding = creatorProductionBinding(documents);
  const prompt = prompts[0];
  if (!binding || !text(prompt?.id, 160)) return null;
  return {
    ...binding,
    promptPackItemId: text(prompt.id, 160),
    storyboardFrameId: text(prompt.storyboardFrameId, 160),
    shotListItemId: text(prompt.shotListItemId, 160),
    sourceShotId: text(prompt.sourceShotId, 160),
    ordinal: integer(prompt.ordinal, 1, 1, 20_000),
    matchMethod: 'single-prompt-pack-item',
  };
}

function candidateResultForProduction(node) {
  const data = nodeData(node);
  const resultKind = data.imageUrl || (Array.isArray(data.imageUrls) && data.imageUrls.length)
    ? 'image'
    : data.videoUrl || (Array.isArray(data.videoUrls) && data.videoUrls.length)
      ? 'video'
      : data.audioUrl || (Array.isArray(data.audioUrls) && data.audioUrls.length)
        ? 'audio'
        : data.outputText ? 'text' : null;
  const rawUrls = resultKind === 'image'
    ? [data.imageUrl, ...(Array.isArray(data.imageUrls) ? data.imageUrls : [])]
    : resultKind === 'video'
      ? [data.videoUrl, ...(Array.isArray(data.videoUrls) ? data.videoUrls : [])]
      : resultKind === 'audio'
        ? [data.audioUrl, ...(Array.isArray(data.audioUrls) ? data.audioUrls : [])]
        : [];
  const resultUrls = [...new Set(rawUrls.map(safeReferenceUrl).filter(Boolean))];
  const evidence = candidateEvidence(data, resultKind, resultUrls);
  const review = candidateReview(data, resultKind, resultUrls);
  return { data, resultKind, resultUrls, evidence, review };
}

function productionCandidateReview(document, promptPackDocument, brief) {
  const prompts = Array.isArray(promptPackDocument?.content?.prompts)
    ? promptPackDocument.content.prompts
    : [];
  const candidates = (Array.isArray(document?.nodes) ? document.nodes : []).flatMap((node) => {
    const binding = record(nodeData(node).creatorProductionBinding);
    if (binding.schema !== 't8-creator-production-binding-v1'
      || text(binding.promptPackDocumentId, 160) !== text(promptPackDocument?.id, 160)
      || text(binding.promptPackVersionId, 160) !== text(promptPackDocument?.versionId, 160)
      || text(binding.promptPackContentDigest, 64) !== text(promptPackDocument?.contentDigest, 64)
      || !text(binding.promptPackItemId, 160)) {
      return [];
    }
    const state = creativeStateFor(node);
    const result = candidateResultForProduction(node);
    if (!result.resultKind
      || (result.resultKind !== 'text' && result.resultUrls.length === 0)) {
      return [];
    }
    const acceptance = record(state.acceptance);
    const adoptionReceiptVerified = (
      acceptance.schema === 't8-creative-adoption-receipt-v1'
      && text(acceptance.nodeId, 160) === text(node.id, 160)
      && text(acceptance.candidateId, 160) === state.candidateId
      && text(acceptance.evidenceDigest, 64) === digest(result.evidence)
      && text(acceptance.reviewDigest, 64) === digest(result.review)
    );
    return [{
      id: stableId('creator-candidate-evidence', `${promptPackDocument.id}:${node.id}:${state.candidateId}`),
      promptPackItemId: text(binding.promptPackItemId, 160),
      storyboardFrameId: text(binding.storyboardFrameId, 160),
      shotListItemId: text(binding.shotListItemId, 160),
      sourceShotId: text(binding.sourceShotId, 160),
      nodeId: text(node.id, 160),
      nodeType: text(node.type, 80),
      groupId: state.groupId,
      candidateId: state.candidateId,
      candidateIndex: state.candidateIndex,
      candidateLabel: text(result.data.candidateLabel, 240) || `候选 ${state.candidateIndex}`,
      status: text(result.data.status, 80) || 'idle',
      provider: text(result.data.providerId || result.data.providerSource, 160),
      model: text(result.data.providerModel || result.data.apiModel || result.data.model, 240),
      resultKind: result.resultKind,
      resultUrls: result.resultUrls,
      resultEvidence: result.evidence,
      executionEvidence: {
        runId: text(result.data.runId, 160) || null,
        nodeRunId: text(result.data.nodeRunId, 160) || null,
        attemptId: text(result.data.attemptId, 160) || null,
        taskId: text(result.data.taskId || result.data.requestId, 240) || null,
      },
      review: result.review,
      adoption: {
        status: state.accepted
          ? adoptionReceiptVerified ? 'adopted' : 'unverified-legacy'
          : 'not-adopted',
        receiptVerified: adoptionReceiptVerified,
        acceptedAt: adoptionReceiptVerified ? text(acceptance.acceptedAt, 80) || null : null,
        locks: adoptionReceiptVerified ? clone(state.locks) : {},
      },
    }];
  }).sort((left, right) => (
    left.promptPackItemId.localeCompare(right.promptPackItemId)
    || left.candidateIndex - right.candidateIndex
    || left.nodeId.localeCompare(right.nodeId)
  ));
  const promptBindings = prompts.map((prompt) => {
    const matches = candidates.filter((candidate) => candidate.promptPackItemId === prompt.id);
    const adopted = matches.find((candidate) => candidate.adoption.status === 'adopted') || null;
    return {
      promptPackItemId: text(prompt?.id, 160),
      storyboardFrameId: text(prompt?.storyboardFrameId, 160),
      ordinal: integer(prompt?.ordinal, 1, 1, 20_000),
      title: text(prompt?.title, 240),
      candidateIds: matches.map((candidate) => candidate.candidateId),
      selectedCandidateId: adopted?.candidateId || null,
      reviewStatus: matches.some((candidate) => candidate.review.status === 'verified')
        ? 'reviewed'
        : matches.length > 0 ? 'pending' : 'missing',
      adoptionStatus: adopted ? 'adopted' : 'not-adopted',
    };
  });
  return {
    title: `${brief.title} · 候选审阅证据`,
    language: brief.language,
    status: candidates.length > 0 ? 'evidence-observed' : 'awaiting-real-candidates',
    derivation: {
      schema: 't8-creator-evidence-derivation-v1',
      method: 'persisted-candidate-evidence',
      sourceDocumentId: text(promptPackDocument?.id, 160),
      sourceVersionId: text(promptPackDocument?.versionId, 160),
      sourceContentDigest: text(promptPackDocument?.contentDigest, 64),
      canvasRevision: Number(document?.revision) || 0,
      evidenceDigest: digest(candidates),
      documentProviderCalls: 0,
      documentCanvasWrites: 0,
    },
    counts: {
      total: candidates.length,
      withResult: candidates.filter((candidate) => candidate.resultKind).length,
      reviewed: candidates.filter((candidate) => candidate.review.status === 'verified').length,
      adopted: candidates.filter((candidate) => candidate.adoption.status === 'adopted').length,
      blocked: candidates.filter((candidate) => (
        candidate.review.status === 'verified' && candidate.review.hardGatesPassed !== true
      )).length,
    },
    promptBindings,
    candidates,
    reviewPolicy: 'actual-media-required',
    adoptionPolicy: 'explicit-action-only',
    generationScope: 'none',
    editingGuidance: candidates.length > 0
      ? '这里只汇总画布中已持久化的真实候选、实际媒体评审和采用回执；确认此文档不会采用、锁定、运行或重新生成任何素材。'
      : '当前 PromptPack 版本还没有精确绑定的真实候选；不会把旧候选、缩略图、Prompt 或模型名当作作品证据。',
  };
}

function productionCandidateDuration(node) {
  const data = nodeData(node);
  const output = record(data.output);
  const metadata = record(data.metadata);
  const persistedRaw = output.duration ?? metadata.duration ?? data.outputDuration;
  const persistedDuration = Number(persistedRaw);
  const requestedRaw = data.duration ?? data.durationSec;
  const requestedDuration = Number(requestedRaw);
  return {
    sourceDurationSec: Number.isFinite(persistedDuration) && persistedDuration > 0
      ? Math.round(persistedDuration * 1_000) / 1_000
      : null,
    requestedDurationSec: Number.isFinite(requestedDuration) && requestedDuration > 0
      ? Math.round(requestedDuration * 1_000) / 1_000
      : null,
    evidence: Number.isFinite(persistedDuration) && persistedDuration > 0
      ? 'persisted-result-metadata'
      : 'missing',
  };
}

function productionExpectedResultKind(brief) {
  const kind = text(brief?.kind, 40).toLowerCase();
  if (kind === 'image' || kind === 'edit-image') return 'image';
  if (kind === 'audio') return 'audio';
  if (kind === 'script') return 'text';
  return 'video';
}

function productionEditDecisionList(document, candidateReviewDocument, brief) {
  const candidates = Array.isArray(candidateReviewDocument?.content?.candidates)
    ? candidateReviewDocument.content.candidates
    : [];
  const promptBindings = Array.isArray(candidateReviewDocument?.content?.promptBindings)
    ? candidateReviewDocument.content.promptBindings
    : [];
  const promptById = new Map(promptBindings.map((item) => [
    text(item?.promptPackItemId, 160),
    item,
  ]));
  const expectedResultKind = productionExpectedResultKind(brief);
  const durationRequired = ['video', 'audio'].includes(expectedResultKind);
  const mediaLabel = {
    image: '图像',
    video: '视频',
    audio: '音频',
    text: '文本',
  }[expectedResultKind] || '作品';
  const adoptedResults = candidates.filter((candidate) => (
    candidate?.resultKind === expectedResultKind
    && candidate?.adoption?.status === 'adopted'
  ));
  const eligible = adoptedResults.filter((candidate) => (
    candidate?.adoption?.receiptVerified === true
    && candidate?.review?.status === 'verified'
    && candidate?.review?.hardGatesPassed === true
    && (
      expectedResultKind === 'text'
        ? Boolean(text(candidate?.resultEvidence?.contentHash, 200))
        : Array.isArray(candidate?.resultUrls) && candidate.resultUrls.length > 0
    )
  )).map((candidate) => {
    const prompt = promptById.get(text(candidate?.promptPackItemId, 160)) || {};
    const duration = productionCandidateDuration(findNode(document, candidate?.nodeId));
    return {
      id: stableId(
        'creator-edl-item',
        `${candidateReviewDocument?.id}:${candidate?.id}:${candidate?.candidateId}`,
      ),
      candidateEvidenceId: text(candidate?.id, 160),
      promptPackItemId: text(candidate?.promptPackItemId, 160),
      storyboardFrameId: text(candidate?.storyboardFrameId, 160),
      shotListItemId: text(candidate?.shotListItemId, 160),
      sourceShotId: text(candidate?.sourceShotId, 160),
      ordinal: integer(prompt?.ordinal, 1, 1, 20_000),
      title: text(prompt?.title, 240) || text(candidate?.candidateLabel, 240) || '未命名镜头',
      candidateId: text(candidate?.candidateId, 160),
      nodeId: text(candidate?.nodeId, 160),
      resultKind: expectedResultKind,
      resultEvidence: {
        assetId: text(candidate?.resultEvidence?.assetId, 160) || null,
        contentHash: text(candidate?.resultEvidence?.contentHash, 200) || null,
        referenceAvailable: true,
      },
      sourceDurationSec: durationRequired ? duration.sourceDurationSec : null,
      requestedDurationSec: durationRequired ? duration.requestedDurationSec : null,
      durationEvidence: durationRequired ? duration.evidence : 'not-applicable',
    };
  }).sort((left, right) => (
    left.ordinal - right.ordinal
    || left.promptPackItemId.localeCompare(right.promptPackItemId)
    || left.candidateId.localeCompare(right.candidateId)
  ));

  let cursor = 0;
  let timelineReady = true;
  const sequence = eligible.map((item) => {
    const durationReady = !durationRequired
      || (Number.isFinite(item.sourceDurationSec) && item.sourceDurationSec > 0);
    const timelineStartSec = durationRequired && timelineReady && durationReady
      ? Math.round(cursor * 1_000) / 1_000
      : null;
    const timelineEndSec = timelineStartSec != null
      ? Math.round((timelineStartSec + item.sourceDurationSec) * 1_000) / 1_000
      : null;
    if (timelineEndSec != null) cursor = timelineEndSec;
    if (durationRequired && !durationReady) timelineReady = false;
    const unresolved = durationRequired
      ? [
          ...(!durationReady ? ['真实媒体时长'] : []),
          '入点/出点复核',
          '转场复核',
          expectedResultKind === 'video' ? '原声/静音/混音策略' : '响度/淡入淡出/混音策略',
          expectedResultKind === 'video' ? '字幕与节奏' : '编排与节奏',
        ]
      : expectedResultKind === 'image'
        ? ['最终构图与版式复核', '色彩/文字/品牌细节复核']
        : ['最终文本与结构复核'];
    return {
      ...item,
      sourceInSec: durationRequired && durationReady ? 0 : null,
      sourceOutSec: durationRequired && durationReady ? item.sourceDurationSec : null,
      timelineStartSec,
      timelineEndSec,
      placementPolicy: durationRequired
        ? 'source-order-full-clip-draft'
        : 'prompt-order-selected-result-draft',
      transition: expectedResultKind === 'video'
        ? {
            type: 'cut',
            durationSec: 0,
            source: 'default-draft',
          }
        : null,
      audioPolicy: null,
      editStatus: durationReady ? 'ready-for-review' : 'duration-missing',
      locked: false,
      unresolved,
    };
  });
  const promptIdsWithResult = new Set(sequence.map((item) => item.promptPackItemId));
  const missingShots = promptBindings.filter((item) => (
    !promptIdsWithResult.has(text(item?.promptPackItemId, 160))
  )).length;
  const missingDuration = durationRequired
    ? sequence.filter((item) => item.durationEvidence === 'missing').length
    : 0;
  const timingReady = sequence.length > 0 && missingDuration === 0;
  const evidenceDigest = digest(sequence);
  const isVideo = expectedResultKind === 'video';
  const isTimedMedia = durationRequired;
  return {
    title: `${brief.title} · ${
      isVideo
        ? 'EDL 剪辑计划'
        : expectedResultKind === 'audio'
          ? '音频编排清单'
          : expectedResultKind === 'image'
            ? '图像采用清单'
            : '文本定稿清单'
    }`,
    language: brief.language,
    status: sequence.length === 0
      ? `awaiting-adopted-${expectedResultKind}`
      : isTimedMedia && !timingReady ? 'needs-duration-evidence' : 'source-assembled',
    resultKind: expectedResultKind,
    derivation: {
      schema: 't8-creator-evidence-derivation-v1',
      method: isVideo
        ? 'verified-adopted-video-sequence'
        : 'verified-adopted-media-sequence',
      sourceDocumentId: text(candidateReviewDocument?.id, 160),
      sourceVersionId: text(candidateReviewDocument?.versionId, 160),
      sourceContentDigest: text(candidateReviewDocument?.contentDigest, 64),
      canvasRevision: Number(candidateReviewDocument?.content?.derivation?.canvasRevision) || 0,
      evidenceDigest,
      documentProviderCalls: 0,
      documentCanvasWrites: 0,
    },
    counts: {
      total: sequence.length,
      ready: sequence.length - missingDuration,
      missingDuration,
      missingShots,
      blocked: Math.max(0, adoptedResults.length - eligible.length),
    },
    sequence,
    timeline: {
      schema: 't8-creator-edl-v1',
      sequencePolicy: 'prompt-order',
      placementPolicy: isTimedMedia
        ? 'source-order-full-clip-draft'
        : 'prompt-order-selected-result-draft',
      timingStatus: sequence.length === 0
        ? 'empty'
        : isTimedMedia ? timingReady ? 'ready' : 'incomplete' : 'not-applicable',
      totalDurationSec: isTimedMedia && timingReady
        ? Math.round(cursor * 1_000) / 1_000
        : null,
      transitionPolicy: isVideo ? 'default-cut-draft' : 'not-applicable',
      audioPolicy: expectedResultKind === 'audio' ? 'creator-review-required' : 'unassigned',
      subtitlePolicy: isVideo ? 'unassigned' : 'not-applicable',
      requiresCreatorReview: true,
    },
    reviewPolicy: isVideo
      ? 'verified-adopted-video-only'
      : `verified-adopted-${expectedResultKind}-only`,
    generationScope: 'none',
    editingGuidance: sequence.length === 0
      ? `当前候选证据中还没有“实际${mediaLabel}已审、硬门通过且采用回执有效”的作品；不会拿其他媒体、旧采用记录、Prompt 或生成状态伪造采用清单。`
      : isVideo
        ? timingReady
          ? '已按 PromptPack 镜头顺序排出完整片段草案；时间码只来自持久结果元数据，默认硬切和完整片段仍需创作者确认，确认不会创建剪辑节点或渲染成片。'
          : `已排出 ${sequence.length} 段采用视频，但 ${missingDuration} 段缺少持久结果时长；请求参数中的时长不会冒充真实媒体时长，缺口补齐前不生成后续时间码。`
        : expectedResultKind === 'audio'
          ? timingReady
            ? '已按 PromptPack 顺序整理采用音频；时间码只来自持久结果元数据，编排、响度与混音仍需创作者确认。'
            : `已整理 ${sequence.length} 段采用音频，但 ${missingDuration} 段缺少持久结果时长；缺口补齐前不会伪造时间码。`
          : `已按 PromptPack 顺序整理 ${sequence.length} 项采用${mediaLabel}；确认只固化当前选择与审阅证据，不会生成、覆盖或写入画布。`,
  };
}

function normalizedQcHash(value) {
  return text(value, 200).toLowerCase().replace(/^sha256:/, '');
}

function qcCheck(id, label, status, detail) {
  return { id, label, status, detail };
}

function productionQualityControlReport(editDecisionListDocument, brief, verificationValue) {
  const sequence = Array.isArray(editDecisionListDocument?.content?.sequence)
    ? editDecisionListDocument.content.sequence
    : [];
  const receipts = (Array.isArray(verificationValue) ? verificationValue : [])
    .filter((item) => item?.schema === 't8-creator-artifact-verification-v1')
    .slice(-100);
  const verifiedAssets = receipts.flatMap((receipt) => {
    const nodeRuns = new Map((Array.isArray(receipt?.nodeRuns) ? receipt.nodeRuns : [])
      .map((nodeRun) => [text(nodeRun?.nodeRunId, 160), nodeRun]));
    return (Array.isArray(receipt?.assets) ? receipt.assets : []).map((asset) => ({
      receipt,
      asset,
      nodeRun: nodeRuns.get(text(asset?.nodeRunId, 160)) || null,
    }));
  });
  const items = sequence.map((item) => {
    const assetId = text(item?.resultEvidence?.assetId, 160);
    const nodeId = text(item?.nodeId, 160);
    const expectedResultKind = ['image', 'video', 'audio', 'text'].includes(
      text(item?.resultKind || editDecisionListDocument?.content?.resultKind, 40),
    )
      ? text(item?.resultKind || editDecisionListDocument?.content?.resultKind, 40)
      : productionExpectedResultKind(brief);
    const fileBacked = expectedResultKind !== 'text';
    const durationRequired = ['video', 'audio'].includes(expectedResultKind);
    const resolutionRequired = ['video', 'image'].includes(expectedResultKind);
    const mediaLabel = {
      image: '图像',
      video: '视频',
      audio: '音频',
      text: '文本',
    }[expectedResultKind] || '媒体';
    const expectedHash = normalizedQcHash(item?.resultEvidence?.contentHash);
    const matches = verifiedAssets.filter((entry) => (
      assetId && text(entry.asset?.assetId, 160) === assetId
    ));
    const exact = matches.find((entry) => (
      text(entry.asset?.expectedNodeId, 160) === nodeId
      || text(entry.nodeRun?.nodeId, 160) === nodeId
    )) || matches[0] || null;
    const asset = exact?.asset || null;
    const receipt = exact?.receipt || null;
    const nodeRun = exact?.nodeRun || null;
    const hasReceipt = Boolean(exact);
    const observedHashes = [
      normalizedQcHash(asset?.contentHash),
      normalizedQcHash(asset?.observedContentHash),
    ].filter(Boolean);
    const hashMatches = !expectedHash || observedHashes.includes(expectedHash);
    const resolutionReady = Number(asset?.width) > 0 && Number(asset?.height) > 0;
    const persistedDuration = Number(item?.sourceDurationSec);
    const indexedDuration = Number(asset?.duration);
    const durationReady = Number.isFinite(persistedDuration) && persistedDuration > 0;
    const durationIndexed = Number.isFinite(indexedDuration) && indexedDuration > 0;
    const durationMatches = durationReady && durationIndexed
      ? Math.abs(persistedDuration - indexedDuration) <= 0.25
      : null;
    const associationPassed = Boolean(
      hasReceipt
      && asset?.associationVerified === true
      && text(nodeRun?.nodeId, 160) === nodeId
      && text(nodeRun?.status, 40) === 'succeeded'
      && (Array.isArray(nodeRun?.outputAssetIds)
        ? nodeRun.outputAssetIds.map((value) => text(value, 160)).includes(assetId)
        : false),
    );
    const decodeEvidence = text(asset?.decodeEvidence, 80) || 'not-recorded';
    const checks = [
      qcCheck(
        'creative-eligibility',
        '创意审阅与采用回执',
        'pass',
        `此项来自采用清单，已满足实际${mediaLabel}已审、硬门通过和采用回执有效。`,
      ),
      qcCheck(
        'result-reference',
        '结果身份',
        item?.resultEvidence?.referenceAvailable === true
          && Boolean(fileBacked ? assetId || expectedHash : expectedHash)
          ? 'pass'
          : 'fail',
        assetId
          ? `已记录素材 ${assetId}`
          : expectedHash ? '已记录内容摘要，但缺少素材 ID。' : '缺少素材 ID 与内容摘要。',
      ),
      durationRequired ? qcCheck(
        'source-duration',
        '真实媒体时长',
        durationReady ? 'pass' : 'unknown',
        durationReady
          ? `${persistedDuration}s，来源为持久结果元数据。`
          : '未记录真实媒体时长；请求时长不会代替核验。',
      ) : null,
      fileBacked ? qcCheck(
        'managed-file',
        '文件存在与受控保存',
        !hasReceipt ? 'unknown' : asset?.stored === true && asset?.blobPresent === true ? 'pass' : 'fail',
        !hasReceipt
          ? '没有匹配的持久化文件核验回执。'
          : asset?.stored === true && asset?.blobPresent === true
            ? `${Number(asset?.byteSize) || 0} bytes，文件存在且保存受控。`
            : '回执显示文件缺失、不可读或未受控保存。',
      ) : null,
      fileBacked ? qcCheck(
        'content-hash',
        '文件摘要',
        !hasReceipt ? 'unknown' : asset?.hashVerified === true && hashMatches ? 'pass' : 'fail',
        !hasReceipt
          ? '没有匹配的摘要复算证据。'
          : asset?.hashVerified === true && hashMatches
            ? '文件 SHA-256 已复算，并与当前 EDL 身份一致。'
            : '文件摘要复算失败，或与当前 EDL 身份不一致。',
      ) : qcCheck(
        'content-hash',
        '文本内容摘要',
        expectedHash ? 'pass' : 'fail',
        expectedHash ? '已记录当前采用文本的内容摘要。' : '缺少当前采用文本的内容摘要。',
      ),
      fileBacked ? qcCheck(
        'file-magic',
        '文件魔数与 MIME',
        !hasReceipt ? 'unknown' : asset?.magicVerified === true ? 'pass' : 'fail',
        !hasReceipt
          ? '没有匹配的文件魔数证据。'
          : asset?.magicVerified === true
            ? `${text(asset?.detectedMimeType, 160) || '已识别媒体类型'}`
            : '文件魔数、声明类型或 MIME 不一致。',
      ) : null,
      fileBacked ? qcCheck(
        'media-kind',
        '媒体类型',
        !hasReceipt || !text(asset?.detectedKind, 40)
          ? 'unknown'
          : text(asset?.detectedKind, 40) === expectedResultKind ? 'pass' : 'fail',
        !hasReceipt || !text(asset?.detectedKind, 40)
          ? '没有可用的媒体类型识别证据。'
          : `预期 ${expectedResultKind}，实际识别为 ${text(asset?.detectedKind, 40)}。`,
      ) : null,
      fileBacked ? qcCheck(
        'decode-evidence',
        '媒体解码索引',
        !hasReceipt || decodeEvidence === 'not-recorded' || decodeEvidence === 'magic-only-legacy'
          ? 'unknown'
          : decodeEvidence === 'indexed-parser-verified' ? 'pass' : 'fail',
        decodeEvidence === 'indexed-parser-verified'
          ? '媒体索引字段已由持久化解析器核验。'
          : decodeEvidence === 'magic-only-legacy'
            ? '旧素材只有魔数证据，尚无完整媒体索引。'
            : '没有可验证的媒体解码索引。',
      ) : null,
      resolutionRequired ? qcCheck(
        'resolution',
        `${mediaLabel}分辨率`,
        !hasReceipt || !resolutionReady ? 'unknown' : 'pass',
        resolutionReady
          ? `${Number(asset.width)} × ${Number(asset.height)}`
          : '当前核验回执没有记录真实宽高。',
      ) : null,
      durationRequired ? qcCheck(
        'indexed-duration',
        '索引时长一致性',
        !hasReceipt || !durationReady || !durationIndexed
          ? 'unknown'
          : durationMatches ? 'pass' : 'fail',
        !hasReceipt || !durationIndexed
          ? '当前核验回执没有记录媒体索引时长。'
          : durationMatches
            ? `索引 ${indexedDuration}s，与 EDL 真实时长一致。`
            : `索引 ${indexedDuration}s，与 EDL ${persistedDuration}s 不一致。`,
      ) : null,
      fileBacked ? qcCheck(
        'run-association',
        'Run / 节点 / 素材关联',
        !hasReceipt ? 'unknown' : associationPassed ? 'pass' : 'fail',
        !hasReceipt
          ? '没有匹配的 Run 关联核验回执。'
          : associationPassed
            ? `Run ${text(receipt?.runId, 160)} 的成功节点与当前素材精确关联。`
            : 'Run、节点、输出素材或画布关联无法验证。',
      ) : null,
    ].filter(Boolean);
    const failed = checks.filter((check) => check.status === 'fail').length;
    const unknown = checks.filter((check) => check.status === 'unknown').length;
    return {
      id: stableId('creator-qc-item', `${editDecisionListDocument?.id}:${item?.id}`),
      editDecisionItemId: text(item?.id, 160),
      ordinal: integer(item?.ordinal, 1, 1, 20_000),
      title: text(item?.title, 240) || '未命名镜头',
      candidateId: text(item?.candidateId, 160),
      nodeId,
      resultKind: expectedResultKind,
      assetId: assetId || null,
      contentHash: text(item?.resultEvidence?.contentHash, 200) || null,
      status: failed > 0 ? 'fail' : unknown > 0 ? 'unknown' : 'pass',
      counts: {
        total: checks.length,
        pass: checks.filter((check) => check.status === 'pass').length,
        fail: failed,
        unknown,
      },
      verificationEvidence: hasReceipt
        ? {
            schema: text(receipt?.schema, 80),
            runId: text(receipt?.runId, 160),
            verificationDigest: text(receipt?.verificationDigest, 64),
            verifiedAt: text(receipt?.verifiedAt, 80),
            receiptVerified: receipt?.verified === true,
          }
        : null,
      checks,
    };
  });
  const failed = items.filter((item) => item.status === 'fail').length;
  const unknown = items.filter((item) => item.status === 'unknown').length;
  const passed = items.filter((item) => item.status === 'pass').length;
  const reportResultKind = ['image', 'video', 'audio', 'text'].includes(
    text(editDecisionListDocument?.content?.resultKind, 40),
  )
    ? text(editDecisionListDocument.content.resultKind, 40)
    : productionExpectedResultKind(brief);
  return {
    title: `${brief.title} · QCReport`,
    language: brief.language,
    resultKind: reportResultKind,
    status: items.length === 0
      ? 'awaiting-edit-decision-list'
      : failed > 0 ? 'failed' : unknown > 0 ? 'needs-verification-evidence' : 'passed',
    derivation: {
      schema: 't8-creator-evidence-derivation-v1',
      method: 'persisted-artifact-qc-evidence',
      sourceDocumentId: text(editDecisionListDocument?.id, 160),
      sourceVersionId: text(editDecisionListDocument?.versionId, 160),
      sourceContentDigest: text(editDecisionListDocument?.contentDigest, 64),
      canvasRevision: Number(editDecisionListDocument?.content?.derivation?.canvasRevision) || 0,
      evidenceDigest: digest(items),
      documentProviderCalls: 0,
      documentCanvasWrites: 0,
    },
    counts: {
      total: items.length,
      pass: passed,
      fail: failed,
      unknown,
      checks: items.reduce((sum, item) => sum + item.counts.total, 0),
    },
    qcItems: items,
    verificationPolicy: 'persisted-receipts-only',
    generationScope: 'none',
    editingGuidance: items.length === 0
      ? '当前采用清单没有可质检作品；不会凭生成状态或缩略图伪造通过记录。'
      : failed > 0
        ? `${failed} 项存在真实核验失败；报告不会自动修复、重新下载、重新生成或覆盖素材。`
        : unknown > 0
          ? `${unknown} 项缺少完整持久化核验回执；未知项保持未知，确认报告不会触发文件扫描或 Provider 调用。`
          : '所有当前必需检查均有持久化证据且通过；确认报告只固化此版证据，不会渲染、下载或交付。',
  };
}

function productionDeliveryManifest(qualityControlDocument, brief, deliveryValue) {
  const qcItems = (Array.isArray(qualityControlDocument?.content?.qcItems)
    ? qualityControlDocument.content.qcItems
    : []).slice(0, 500);
  const canvasRevision = Number(qualityControlDocument?.content?.derivation?.canvasRevision) || 0;
  const normalizeHash = (value) => {
    const hash = text(value, 200).toLowerCase().replace(/^sha256:/, '');
    return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
  };
  const receipts = (Array.isArray(deliveryValue) ? deliveryValue : [])
    .filter((item) => (
      item?.schema === 't8-creator-delivery-evidence-v1'
      && item?.status === 'completed'
    ))
    .map((item) => {
      const files = (Array.isArray(item.files) ? item.files : []).slice(0, 500)
        .map((file) => ({
          assetId: text(file?.assetId, 240),
          sha256: normalizeHash(file?.sha256),
          size: integer(file?.size, 0, 0, Number.MAX_SAFE_INTEGER),
        }))
        .filter((file) => file.assetId && file.sha256);
      return {
        schema: 't8-creator-delivery-evidence-v1',
        approvalRequestId: text(item.approvalRequestId, 160),
        planId: text(item.planId, 160),
        packageName: text(item.packageName, 160),
        packageDigest: normalizeHash(item.packageDigest),
        selectionDigest: normalizeHash(item.selectionDigest),
        scope: item.scope === 'project' ? 'project' : 'canvas',
        canvasRevision: Number.isSafeInteger(Number(item.canvasRevision))
          ? Number(item.canvasRevision)
          : null,
        catalogRevision: Number.isSafeInteger(Number(item.catalogRevision))
          ? Number(item.catalogRevision)
          : null,
        itemCount: integer(item.itemCount, 0, 0, 100_000),
        totalBytes: integer(item.totalBytes, 0, 0, Number.MAX_SAFE_INTEGER),
        verifiedItems: integer(item.verifiedItems, 0, 0, 100_000),
        verifiedBytes: integer(item.verifiedBytes, 0, 0, Number.MAX_SAFE_INTEGER),
        valid: item.valid === true,
        licenseSummary: {
          known: integer(item.licenseSummary?.known, 0, 0, 100_000),
          unknown: integer(item.licenseSummary?.unknown, 0, 0, 100_000),
        },
        recordedAt: text(item.recordedAt, 80),
        files,
      };
    });
  const qcReady = qcItems.length > 0 && qcItems.every((item) => (
    item?.status === 'pass'
    && text(item?.assetId, 240)
    && normalizeHash(item?.contentHash)
  ));
  const matchingReceipt = qcReady
    ? [...receipts].reverse().find((receipt) => {
        const fileKeys = new Set(receipt.files.map((file) => `${file.assetId}:${file.sha256}`));
        const fileBytes = receipt.files.reduce((total, file) => total + file.size, 0);
        return receipt.valid
          && receipt.canvasRevision === canvasRevision
          && receipt.packageDigest
          && receipt.selectionDigest
          && receipt.itemCount > 0
          && receipt.files.length === receipt.itemCount
          && fileKeys.size === receipt.files.length
          && receipt.verifiedItems === receipt.itemCount
          && receipt.verifiedBytes === receipt.totalBytes
          && fileBytes === receipt.totalBytes
          && qcItems.every((item) => fileKeys.has(
            `${text(item.assetId, 240)}:${normalizeHash(item.contentHash)}`,
          ));
      }) || null
    : null;
  const deliveredFileKeys = new Set((matchingReceipt?.files || [])
    .map((file) => `${file.assetId}:${file.sha256}`));
  const deliverables = qcItems.map((item) => {
    const assetId = text(item?.assetId, 240);
    const contentHash = normalizeHash(item?.contentHash);
    const qcStatus = ['pass', 'fail', 'unknown'].includes(item?.status)
      ? item.status
      : 'unknown';
    const included = Boolean(matchingReceipt
      && assetId
      && contentHash
      && deliveredFileKeys.has(`${assetId}:${contentHash}`));
    return {
      id: stableId('creator-delivery-item', `${qualityControlDocument?.id}:${item?.id}`),
      qcItemId: text(item?.id, 160),
      editDecisionItemId: text(item?.editDecisionItemId, 160),
      ordinal: integer(item?.ordinal, 1, 1, 20_000),
      title: text(item?.title, 240) || '未命名镜头',
      assetId: assetId || null,
      contentHash: contentHash || null,
      qcStatus,
      status: qcStatus !== 'pass'
        ? 'blocked-by-qc'
        : included ? 'included-and-verified' : 'awaiting-current-delivery',
    };
  });
  const packageEvidence = matchingReceipt
    ? {
        schema: matchingReceipt.schema,
        approvalRequestId: matchingReceipt.approvalRequestId,
        planId: matchingReceipt.planId,
        packageName: matchingReceipt.packageName,
        packageDigest: matchingReceipt.packageDigest,
        selectionDigest: matchingReceipt.selectionDigest,
        scope: matchingReceipt.scope,
        canvasRevision: matchingReceipt.canvasRevision,
        catalogRevision: matchingReceipt.catalogRevision,
        itemCount: matchingReceipt.itemCount,
        totalBytes: matchingReceipt.totalBytes,
        verifiedItems: matchingReceipt.verifiedItems,
        verifiedBytes: matchingReceipt.verifiedBytes,
        valid: true,
        licenseSummary: matchingReceipt.licenseSummary,
        recordedAt: matchingReceipt.recordedAt,
        exactQcAssetsIncluded: true,
      }
    : null;
  const blocked = deliverables.filter((item) => item.status === 'blocked-by-qc').length;
  const included = deliverables.filter((item) => item.status === 'included-and-verified').length;
  const awaiting = deliverables.filter((item) => item.status === 'awaiting-current-delivery').length;
  const status = deliverables.length === 0
    ? 'awaiting-qc-report'
    : !qcReady
      ? 'blocked-by-qc'
      : !packageEvidence
        ? 'awaiting-current-delivery'
        : packageEvidence.licenseSummary.unknown > 0
          ? 'delivered-needs-license-review'
          : 'delivered-and-verified';
  return {
    title: `${brief.title} · DeliveryManifest`,
    language: brief.language,
    status,
    derivation: {
      schema: 't8-creator-evidence-derivation-v1',
      method: 'verified-local-delivery-package-evidence',
      sourceDocumentId: text(qualityControlDocument?.id, 160),
      sourceVersionId: text(qualityControlDocument?.versionId, 160),
      sourceContentDigest: text(qualityControlDocument?.contentDigest, 64),
      canvasRevision,
      evidenceDigest: digest({ deliverables, packageEvidence }),
      documentProviderCalls: 0,
      documentCanvasWrites: 0,
      documentDeliveryWrites: 0,
    },
    counts: {
      total: deliverables.length,
      included,
      blocked,
      awaiting,
      packageFiles: packageEvidence?.itemCount || 0,
      licenseKnown: packageEvidence?.licenseSummary.known || 0,
      licenseUnknown: packageEvidence?.licenseSummary.unknown || 0,
    },
    deliverables,
    packageEvidence,
    deliveryPolicy: 'completed-verified-package-receipts-only',
    releaseReadiness: status === 'delivered-and-verified'
      ? 'ready'
      : status === 'delivered-needs-license-review' ? 'needs-license-review' : 'blocked',
    ignoredReceiptCount: Math.max(0, receipts.length - (matchingReceipt ? 1 : 0)),
    generationScope: 'none',
    editingGuidance: status === 'awaiting-qc-report'
      ? '当前 QCReport 没有可交付片段；不会创建空交付清单。'
      : status === 'blocked-by-qc'
        ? '存在失败或待核验 QC 项；先补齐或修复真实证据，再由创作者显式创建交付包。'
        : status === 'awaiting-current-delivery'
          ? '当前没有与这版 QC 资产、哈希和画布 revision 精确匹配的已复核交付包；确认清单不会自动创建文件。'
          : status === 'delivered-needs-license-review'
            ? '交付包文件与固定摘要已复核，但仍有许可状态未知的素材；公开发布前必须人工确认。'
            : '当前 QC 资产已包含在原子创建且固定摘要复核通过的交付包中；确认只固化证据。',
  };
}

function productionDocumentContent(kind, brief, sourceDocument = null) {
  if (kind === 'production-brief') {
    return {
      goal: brief.goal,
      title: brief.title,
      audience: brief.audience,
      format: brief.format,
      ratio: brief.ratio,
      durationSec: brief.durationSec,
      style: brief.style,
      language: brief.language,
      profile: brief.profile,
      quality: brief.quality,
      template: brief.template,
      recipe: brief.recipe,
      reuseAssetCount: brief.reuseAssetIds.length,
      continuityLocks: [...brief.locks],
    };
  }
  if (kind === 'script-doc') {
    const analysis = analyseSingleOutputSource(
      brief.goal,
      brief.kind,
      analyseScriptSource(brief.goal),
    );
    return {
      title: brief.title,
      sourceText: brief.goal,
      language: brief.language,
      targetDurationSec: brief.durationSec,
      structureStatus: analysis.status === 'source-structured' ? 'source-structured' : 'source-draft',
      outline: analysis.outline,
      characters: analysis.characters,
      scenes: analysis.scenes,
      shots: analysis.shots,
      scriptAnalysis: analysis,
      editingGuidance: analysis.singleOutputFallback === true
        ? '这是单一输出任务；仅把创作者整段原文确定性映射为一个作品单元，没有拆镜、补写事实或调用模型。'
        : analysis.status === 'source-structured'
        ? '仅按原文明示标题建立结构与行号映射；没有推断人物、场景事实或镜头内容。'
        : '保留创作者原文和硬约束；未识别的结构保持空白，补写前先让创作者核对。',
    };
  }
  if (kind === 'character-bible') {
    return productionCharacterBible(sourceDocument, brief);
  }
  if (kind === 'asset-needs') {
    return productionAssetNeeds(sourceDocument, brief);
  }
  if (kind === 'shot-list') {
    return productionShotList(sourceDocument, brief);
  }
  if (kind === 'audio-plan') {
    return productionAudioPlan(sourceDocument, brief);
  }
  if (kind === 'storyboard') {
    return productionStoryboard(sourceDocument, brief);
  }
  if (kind === 'prompt-pack') {
    return productionPromptPack(sourceDocument, brief);
  }
  return {
    title: `${brief.title} · 世界与连续性`,
    visualStyle: brief.style,
    language: brief.language,
    continuityLocks: [...brief.locks],
    characters: [],
    locations: [],
    worldRules: [],
    missingSections: ['角色设定', '场景规则', '连续性规则'],
    editingGuidance: '这是可编辑空骨架；未知设定保持空白，不把 Agent 猜测写成事实。',
  };
}

const PRODUCTION_DOCUMENT_FIELD_LABELS = {
  goal: '创作目标',
  audience: '目标受众',
  format: '作品形式',
  ratio: '画幅',
  durationSec: '时长',
  style: '视觉风格',
  language: '语言',
  sourceText: '剧本原文',
  outline: '结构提纲',
  characters: '角色',
  scenes: '场景',
  shots: '镜头',
  visualStyle: '世界视觉风格',
  locations: '地点',
  worldRules: '世界规则',
  continuityLocks: '连续性约束',
  derivation: '来源版本',
  requestedScopes: '拉片范围',
  needs: '资产缺口',
  missingSections: '待补内容',
  items: '声音条目',
  mix: '混音结构',
  relatedAssetNeedIds: '关联资产',
  sequence: '剪辑顺序',
  timeline: 'EDL 时间线',
};

function productionDocumentDiffValue(value) {
  if (value == null || value === '') return '未填写';
  if (Array.isArray(value)) {
    if (value.length === 0) return '空';
    return value.map((item) => (
      item && typeof item === 'object' ? stableString(item) : String(item)
    )).join('、').slice(0, 240);
  }
  if (typeof value === 'object') return stableString(value).slice(0, 240);
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function productionDocumentChangeSummary(previous, content, editableFields) {
  if (!previous) return null;
  const changedFields = editableFields
    .filter((field) => digest(previous.content?.[field]) !== digest(content?.[field]))
    .map((field) => {
      const beforeValue = previous.content?.[field];
      const afterValue = content?.[field];
      return {
        field,
        label: PRODUCTION_DOCUMENT_FIELD_LABELS[field] || field,
        change: beforeValue == null || beforeValue === ''
          ? 'added'
          : afterValue == null || afterValue === ''
            ? 'removed'
            : 'changed',
        before: productionDocumentDiffValue(beforeValue),
        after: productionDocumentDiffValue(afterValue),
      };
    });
  if (changedFields.length === 0) return null;
  return {
    schema: 't8-creator-production-document-diff-v1',
    baseRevision: previous.revision,
    baseVersionId: previous.versionId,
    changedFields,
  };
}

function previousProductionDocument(value, id, kind) {
  const items = Array.isArray(value) ? value : [];
  const found = items.find((item) => (
    item
    && typeof item === 'object'
    && !Array.isArray(item)
    && item.schema === CREATOR_PRODUCTION_DOCUMENT_SCHEMA
    && String(item.id || '') === id
    && String(item.kind || '') === kind
  ));
  if (!found) return null;
  const content = record(found.content);
  const contentDigest = text(found.contentDigest, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentDigest)
    || digest({ kind, content }) !== contentDigest) {
    throw new AgentControlCreativeError(
      'CREATOR_PRODUCTION_DOCUMENT_INVALID',
      '上一个作品文档版本无法验证，请刷新创作会话后重试',
      409,
    );
  }
  const revision = integer(found.revision, 1, 1, 1_000_000);
  const expectedVersionId = stableId(
    'creator-document-version',
    `${id}:${revision}:${contentDigest}`,
  );
  if (text(found.versionId, 160) !== expectedVersionId) {
    throw new AgentControlCreativeError(
      'CREATOR_PRODUCTION_DOCUMENT_INVALID',
      '上一个作品文档版本无法验证，请刷新创作会话后重试',
      409,
    );
  }
  return {
    revision,
    versionId: expectedVersionId,
    status: found.status === 'confirmed' ? 'confirmed' : 'draft',
    contentDigest,
    content: clone(content),
  };
}

function referenceTimecodeSeconds(value) {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(excerpt(value, 40));
  if (!match) return null;
  const seconds = (Number(match[1]) * 3600)
    + (Number(match[2]) * 60)
    + Number(match[3])
    + (Number(match[4]) / 1000);
  return Number.isFinite(seconds) ? seconds : null;
}

function referenceStringList(value, maximumItems = 20, maximumLength = 1000) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .slice(0, maximumItems)
    .map((item) => excerpt(item, maximumLength))
    .filter(Boolean);
}

function referenceBreakdownJson(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1_000_000) return null;
  const fenced = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const candidate = fenced.length > 0
    ? String(fenced.at(-1)?.[1] || '').trim()
    : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(candidate);
    return record(parsed);
  } catch {
    return null;
  }
}

function referenceBreakdownNodeBinding(node, source) {
  const data = nodeData(node);
  const binding = (Array.isArray(data.referenceBindings) ? data.referenceBindings : [])
    .map(record)
    .find((item) => String(item.assetId || '') === source.assetId);
  if (!binding) return false;
  return integer(binding.contentRevision, 0, 0, 1_000_000) === source.contentRevision
    && String(binding.contentHash || '').toLowerCase() === String(source.contentHash || '').toLowerCase();
}

function referenceBreakdownNodeText(node) {
  const data = nodeData(node);
  const historyText = [...(Array.isArray(data.history) ? data.history : [])]
    .reverse()
    .find((item) => item?.role === 'assistant' && String(item?.text || '').trim())?.text;
  return String(data.reply || data.outputText || historyText || '').trim();
}

const REFERENCE_RUN_SUCCESS_STATUSES = new Set(['success', 'succeeded', 'completed']);
const REFERENCE_RUN_FAILED_STATUSES = new Set([
  'cancelled',
  'canceled',
  'error',
  'failed',
  'interrupted',
  'stopped',
]);

function referenceRunStatus(value) {
  return excerpt(value, 80).toLowerCase();
}

function referenceBreakdownRunEvidence(database, document, node, source) {
  const waiting = {
    runBindingStatus: 'awaiting-run-evidence',
    runId: '',
    nodeRunId: '',
    attemptId: '',
    runStatus: '',
    nodeRunStatus: '',
    attemptStatus: '',
    runCanvasRevision: 0,
    runEvidenceReason: '当前拉片结果尚未关联到可验证的 Run / NodeRun / Attempt',
  };
  if (typeof database?.listRuns !== 'function'
    || typeof database?.listNodeRuns !== 'function'
    || typeof database?.listAttempts !== 'function') {
    return waiting;
  }
  const projectId = String(document?.projectId || '');
  const canvasId = String(document?.canvasId || '');
  const currentRevision = integer(document?.revision, 0, 0, 1_000_000_000);
  const currentNodeId = String(node?.id || '');
  const currentEntityUid = String(node?.entityUid || '').toLowerCase();
  const currentRequestId = excerpt(nodeData(node).requestId, 160);
  let runs;
  try {
    runs = database.listRuns({ projectId, canvasId, limit: 100 });
  } catch {
    return {
      ...waiting,
      runBindingStatus: 'invalid-run-evidence',
      runEvidenceReason: '运行证据账本暂时无法读取；拉片结果未被标记为已核验',
    };
  }
  let invalidReason = '';
  for (const run of Array.isArray(runs) ? runs : []) {
    if (String(run?.projectId || '') !== projectId || String(run?.canvasId || '') !== canvasId) continue;
    const runCanvasRevision = integer(run?.canvasRevision, 0, 0, 1_000_000_000);
    if (runCanvasRevision > currentRevision) {
      invalidReason = '候选 Run 的画布 revision 晚于当前作品，已拒绝关联';
      continue;
    }
    let nodeRuns;
    try {
      nodeRuns = database.listNodeRuns(String(run.id || ''));
    } catch {
      invalidReason = '候选 Run 的 NodeRun 证据无法读取';
      continue;
    }
    const matchingNodeRuns = (Array.isArray(nodeRuns) ? nodeRuns : [])
      .filter((nodeRun) => String(nodeRun?.originalNodeId || nodeRun?.nodeId || '') === currentNodeId)
      .reverse();
    for (const nodeRun of matchingNodeRuns) {
      if (String(nodeRun?.runId || '') !== String(run.id || '')) {
        invalidReason = 'NodeRun 不属于候选 Run，已拒绝关联';
        continue;
      }
      const nodeRunEntityUid = String(nodeRun?.nodeEntityUid || '').toLowerCase();
      if (currentEntityUid && nodeRunEntityUid && currentEntityUid !== nodeRunEntityUid) {
        invalidReason = 'NodeRun 指向了同名但不同身份的节点，已拒绝关联';
        continue;
      }
      const inputSnapshot = record(nodeRun?.inputSnapshot);
      const snapshotNode = record(inputSnapshot.node);
      const snapshotData = record(snapshotNode.data);
      const snapshotBound = inputSnapshot.replayable === true
        && String(snapshotNode.id || '') === currentNodeId
        && String(snapshotNode.type || '') === 'llm'
        && snapshotData.analysisMode === 'reference-video-shot-breakdown'
        && snapshotData.outputSchema === 't8-reference-video-breakdown-v2'
        && referenceBreakdownNodeBinding({ data: snapshotData }, source);
      if (!snapshotBound) {
        invalidReason = 'NodeRun 缺少与当前视频版本完全一致的输入快照，已拒绝关联';
        continue;
      }
      let attempts;
      try {
        attempts = database.listAttempts(String(nodeRun.id || ''));
      } catch {
        invalidReason = '候选 NodeRun 的 Attempt 证据无法读取';
        continue;
      }
      const orderedAttempts = (Array.isArray(attempts) ? attempts : [])
        .filter((attempt) => String(attempt?.nodeRunId || '') === String(nodeRun.id || ''))
        .reverse();
      const attempt = currentRequestId
        ? orderedAttempts.find((item) => excerpt(item?.requestId, 160) === currentRequestId)
        : orderedAttempts[0];
      if (currentRequestId && !attempt) {
        invalidReason = '拉片节点 requestId 与 Run Attempt 不一致，已拒绝关联';
        continue;
      }
      const runStatus = referenceRunStatus(run.status);
      const nodeRunStatus = referenceRunStatus(nodeRun.status);
      const attemptStatus = referenceRunStatus(attempt?.status);
      const failed = REFERENCE_RUN_FAILED_STATUSES.has(runStatus)
        || REFERENCE_RUN_FAILED_STATUSES.has(nodeRunStatus)
        || REFERENCE_RUN_FAILED_STATUSES.has(attemptStatus);
      const complete = Boolean(attempt)
        && REFERENCE_RUN_SUCCESS_STATUSES.has(nodeRunStatus)
        && REFERENCE_RUN_SUCCESS_STATUSES.has(attemptStatus);
      return {
        runBindingStatus: failed ? 'failed' : complete ? 'verified' : 'pending',
        runId: excerpt(run.id, 160),
        nodeRunId: excerpt(nodeRun.id, 160),
        attemptId: excerpt(attempt?.id, 160),
        runStatus,
        nodeRunStatus,
        attemptStatus,
        runCanvasRevision,
        runEvidenceReason: failed
          ? '已关联到真实运行账本，但该次节点执行失败或被停止'
          : complete
            ? 'Run / NodeRun / Attempt、节点身份、来源快照与 requestId 已核验'
            : '已找到同来源运行账本，节点执行仍在进行或终态证据尚未写齐',
      };
    }
  }
  return invalidReason
    ? {
        ...waiting,
        runBindingStatus: 'invalid-run-evidence',
        runEvidenceReason: invalidReason,
      }
    : waiting;
}

function referenceBreakdownEvidence(document, source, database) {
  const nodes = [...(Array.isArray(document?.nodes) ? document.nodes : [])].reverse();
  const node = nodes.find((item) => {
    const data = nodeData(item);
    return String(item?.type || '') === 'llm'
      && data.analysisMode === 'reference-video-shot-breakdown'
      && data.outputSchema === 't8-reference-video-breakdown-v2'
      && referenceBreakdownNodeBinding(item, source);
  });
  if (!node) return null;
  const data = nodeData(node);
  const rawText = referenceBreakdownNodeText(node);
  const runEvidence = referenceBreakdownRunEvidence(database, document, node, source);
  const evidenceBase = {
    schema: 't8-reference-video-breakdown-evidence-v1',
    sourceNodeId: String(node.id || ''),
    requestId: excerpt(data.requestId, 160),
    canvasRevision: integer(document?.revision, 0, 0, 1_000_000_000),
    ...runEvidence,
  };
  if (!rawText) {
    const nodeStatus = String(data.status || '').toLowerCase();
    return {
      status: nodeStatus === 'generating'
        ? 'analysis-running'
        : nodeStatus === 'error'
          ? 'analysis-failed'
          : 'analysis-workflow-present',
      error: nodeStatus === 'error'
        ? excerpt(data.error, 500) || '拉片节点运行失败；已有来源视频仍安全保留'
        : '',
      evidence: {
        ...evidenceBase,
        outputDigest: '',
        resultStatus: nodeStatus || 'idle',
      },
      result: null,
    };
  }
  const payload = referenceBreakdownJson(rawText);
  if (!payload) {
    return {
      status: 'analysis-output-invalid',
      error: '拉片节点已经返回文字，但没有找到可验证的 t8-reference-video-breakdown-v2 JSON；原始文字仍保留在节点中',
      evidence: {
        ...evidenceBase,
        outputDigest: digest(rawText),
        resultStatus: String(data.status || 'success'),
      },
      result: null,
    };
  }
  const sourceAsset = record(payload.sourceAsset);
  const sourceHash = String(sourceAsset.contentHash || sourceAsset.sha256 || '').toLowerCase();
  if (String(sourceAsset.assetId || '') !== source.assetId
    || integer(sourceAsset.contentRevision, 0, 0, 1_000_000) !== source.contentRevision
    || sourceHash !== String(source.contentHash || '').toLowerCase()) {
    return {
      status: 'analysis-output-invalid',
      error: '拉片结果声明的来源素材版本或 SHA-256 与当前参考视频不一致；为避免串片，结果没有写入作品文档',
      evidence: {
        ...evidenceBase,
        outputDigest: digest(rawText),
        resultStatus: String(data.status || 'success'),
      },
      result: null,
    };
  }
  const shots = [];
  const rawShots = Array.isArray(payload.shots) ? payload.shots.slice(0, 1000) : [];
  for (const [index, rawShot] of rawShots.entries()) {
    const shot = record(rawShot);
    const startTimecode = excerpt(shot.startTimecode, 40);
    const endTimecode = excerpt(shot.endTimecode, 40);
    const startSeconds = referenceTimecodeSeconds(startTimecode);
    const endSeconds = referenceTimecodeSeconds(endTimecode);
    if (startSeconds === null || endSeconds === null || endSeconds < startSeconds) continue;
    const ordinal = integer(shot.ordinal, index + 1, 1, 1_000_000);
    const shotSize = excerpt(shot.shotSize, 200) || '未知';
    const cameraMovement = excerpt(shot.cameraMovement, 500) || '未知';
    const composition = excerpt(shot.composition, 1000) || '未知';
    const action = excerpt(shot.action, 2000) || '未知';
    const dialogue = excerpt(shot.dialogue, 4000) || '未知';
    const narration = excerpt(shot.narration, 4000) || '未知';
    const music = excerpt(shot.music, 1000) || '未知';
    const ambience = excerpt(shot.ambience, 1000) || '未知';
    const sfx = excerpt(shot.sfx, 1000) || '未知';
    const evidence = referenceStringList(shot.evidence, 20, 1000);
    const unknowns = referenceStringList(shot.unknowns, 20, 1000);
    const confidenceNumber = Number(shot.confidence);
    const confidence = Number.isFinite(confidenceNumber)
      ? Math.max(0, Math.min(1, confidenceNumber))
      : excerpt(shot.confidence, 60) || 'unknown';
    shots.push({
      id: stableId('reference-shot', `${source.assetId}:${source.contentRevision}:${startTimecode}:${endTimecode}:${ordinal}`),
      ordinal,
      marker: `${startTimecode}–${endTimecode}`,
      title: excerpt(shot.title, 240) || `镜头 ${ordinal}`,
      sceneId: null,
      sourceRange: { lineStart: 0, lineEnd: 0 },
      sourceText: evidence.join(' · '),
      sourceTextTruncated: false,
      description: action,
      startTimecode,
      endTimecode,
      durationSec: Number((endSeconds - startSeconds).toFixed(3)),
      shotSize,
      cameraMovement,
      composition,
      action,
      dialogue,
      narration,
      music,
      ambience,
      sfx,
      soundDesign: [music, ambience, sfx].filter((item) => item !== '未知').join(' · ') || '未知',
      editablePrompt: excerpt(shot.editablePrompt, 6000),
      confidence,
      evidence,
      unknowns,
      unresolved: [...unknowns],
      status: 'source-proposed',
    });
  }
  if (shots.length === 0) {
    return {
      status: 'analysis-output-invalid',
      error: '拉片结果没有包含任何时间码合法的镜头；原始文字仍保留在节点中',
      evidence: {
        ...evidenceBase,
        outputDigest: digest(rawText),
        resultStatus: String(data.status || 'success'),
      },
      result: null,
    };
  }
  const summary = record(payload.summary);
  return {
    status: 'analysis-result-ready',
    error: '',
    evidence: {
      ...evidenceBase,
      outputDigest: digest(rawText),
      resultStatus: String(data.status || 'success'),
    },
    result: {
      sourceAsset: {
        assetId: source.assetId,
        contentRevision: source.contentRevision,
        contentHash: source.contentHash,
      },
      summary: {
        totalDuration: excerpt(summary.totalDuration, 100),
        shotCount: shots.length,
        averageShotDuration: excerpt(summary.averageShotDuration, 100),
        editingDensity: excerpt(summary.editingDensity, 1000),
        rhythmPattern: excerpt(summary.rhythmPattern, 2000),
        cameraLanguage: excerpt(summary.cameraLanguage, 4000),
        soundStructure: excerpt(summary.soundStructure, 4000),
        transcriptEvidence: excerpt(summary.transcriptEvidence, 200_000),
        transcriptAttribution: ['provider-segments', 'untimed'].includes(summary.transcriptAttribution)
          ? summary.transcriptAttribution
          : '',
      },
      shots,
      limitations: referenceStringList(payload.limitations, 100, 2000),
    },
  };
}

function productionReferenceBreakdown(document, brief, database) {
  const references = brief.reuseAssetIds.length > 0
    ? resolveMediaReferenceBindings(document, database, document.projectId, brief.reuseAssetIds)
    : [];
  const videoReferences = references.filter((item) => item.kind === 'video');
  if (references.length > 0 && videoReferences.length !== 1) {
    throw new AgentControlCreativeError(
      'CREATIVE_SHOT_BREAKDOWN_VIDEO_REQUIRED',
      '参考视频拉片需要且只接受一个当前项目中的视频素材；请移除图片、音频或多余视频后重试',
      409,
      { receivedKinds: references.map((item) => item.kind), videoCount: videoReferences.length },
    );
  }
  const source = videoReferences[0] || null;
  const analysis = source ? referenceBreakdownEvidence(document, source, database) : null;
  return {
    title: `${brief.title} · 参考视频拉片`,
    language: brief.language,
    status: analysis?.status || (source ? 'awaiting-analysis-run' : 'awaiting-source-video'),
    summary: analysis?.result?.summary || null,
    shots: analysis?.result?.shots || [],
    limitations: analysis?.result?.limitations || [],
    resultEvidence: analysis?.evidence || null,
    analysisError: analysis?.error || '',
    sourceBinding: source ? {
      assetId: source.assetId,
      kind: source.kind,
      contentRevision: source.contentRevision,
      contentHash: source.contentHash,
      filename: source.filename,
      mimeType: source.mimeType,
      byteSize: source.byteSize,
      mediaUrl: source.url,
    } : null,
    requestedScopes: ['rhythm', 'editing-density', 'shot-size', 'camera-movement', 'composition', 'sound', 'editable-prompt'],
    evidenceRequirements: [
      '逐镜头开始/结束/时长时间码',
      '来源 assetId、contentRevision 与 SHA-256',
      '执行后的 Run / NodeRun / Attempt 关联',
      '分析输出文本或资产哈希',
      '无法确认、采样限制与截断说明',
    ],
    generationPolicy: { providerCallsNow: 0, mediaGenerationCalls: 0, autoRun: false },
    editingGuidance: analysis?.status === 'analysis-result-ready'
      ? '已从当前画布中来源完全匹配的拉片节点回收结构化镜头结果；确认只冻结本作品文档版本，不会重复运行 Provider。'
      : analysis
        ? '当前画布已有来源匹配的拉片节点；请先在该节点处理运行中、失败或结构不合格的结果，不会重复创建第二套工作流。'
        : source
          ? '当前只绑定了经过项目资产库验证的参考视频；确认后会创建可运行拉片工作流，不会自动运行或生成图片、视频和音频。'
          : '先上传或引用一个真实视频；没有来源视频时不会猜测镜头、时间码和声音。',
  };
}

function productionDocumentsForPlan(
  document,
  planId,
  brief,
  previousValue,
  verificationValue,
  deliveryValue,
  database,
  options = {},
) {
  if (!brief.goal) return [];
  const kinds = ['production-brief'];
  const isReferenceBreakdown = brief.kind === 'story' && brief.recipe === 'shot-breakdown';
  const stagedProduction = options.stagedProduction === true && !isReferenceBreakdown;
  if (isReferenceBreakdown) {
    kinds.push('reference-breakdown');
  } else if (stagedProduction || ['script', 'story'].includes(brief.kind)) {
    kinds.push('script-doc', 'world-bible');
  }
  const labels = {
    'production-brief': '制作需求',
    'reference-breakdown': '参考视频拉片计划',
    'script-doc': '剧本文档',
    'world-bible': '世界与连续性设定',
    'character-bible': '角色设定草案',
    'asset-needs': '资产缺口草案',
    'shot-list': '镜头表草案',
    'audio-plan': '声音计划草案',
    'delivery-manifest': 'DeliveryManifest 交付清单',
    storyboard: '分镜板草案',
    'qc-report': 'QCReport 质量报告',
    'prompt-pack': 'PromptPack 草案',
    'candidate-review': '候选审阅证据',
    'edit-decision-list': 'EDL 剪辑计划',
  };
  const editableFields = {
    'production-brief': ['goal', 'audience', 'format', 'ratio', 'durationSec', 'style', 'language'],
    'reference-breakdown': ['requestedScopes'],
    'script-doc': ['sourceText', 'outline', 'characters', 'scenes', 'shots'],
    'world-bible': ['visualStyle', 'characters', 'locations', 'worldRules', 'continuityLocks'],
    'character-bible': ['derivation', 'characters', 'missingSections'],
    'asset-needs': ['derivation', 'needs'],
    'shot-list': ['derivation', 'shots'],
    'audio-plan': ['derivation', 'items', 'mix'],
    storyboard: ['derivation', 'frames', 'adoptionPolicy'],
    'prompt-pack': ['derivation', 'prompts', 'reviewPolicy'],
    'candidate-review': ['derivation', 'promptBindings', 'candidates', 'reviewPolicy', 'adoptionPolicy'],
    'edit-decision-list': ['derivation', 'sequence', 'timeline', 'reviewPolicy'],
    'qc-report': ['derivation', 'qcItems', 'verificationPolicy'],
    'delivery-manifest': ['derivation', 'deliverables', 'packageEvidence', 'deliveryPolicy'],
  };
  const buildDocument = (kind, content) => {
    const id = stableId(
      'creator-document',
      `${document.projectId}:${document.canvasId}:${kind}`,
    );
    const contentDigest = digest({ kind, content });
    const previous = previousProductionDocument(previousValue, id, kind);
    const unchanged = previous?.contentDigest === contentDigest;
    const revision = previous
      ? unchanged ? previous.revision : previous.revision + 1
      : 1;
    const changeSummary = productionDocumentChangeSummary(previous, content, editableFields[kind]);
    return {
      schema: CREATOR_PRODUCTION_DOCUMENT_SCHEMA,
      id,
      kind,
      label: labels[kind],
      revision,
      versionId: stableId('creator-document-version', `${id}:${revision}:${contentDigest}`),
      status: unchanged ? previous.status : 'draft',
      contentDigest,
      content,
      editableFields: editableFields[kind],
      editableByNaturalLanguage: !['candidate-review', 'qc-report', 'delivery-manifest'].includes(kind),
      requiresCreatorConfirmation: true,
      sourcePlanId: planId,
      ...(previous && !unchanged ? { supersedesRevision: previous.revision } : {}),
      ...(changeSummary ? { changeSummary } : {}),
    };
  };
  const documents = kinds.map((kind) => {
    const content = kind === 'reference-breakdown'
      ? productionReferenceBreakdown(document, brief, database)
      : productionDocumentContent(kind, brief);
    return buildDocument(kind, content);
  });
  if (stagedProduction || (!isReferenceBreakdown && ['script', 'story'].includes(brief.kind))) {
    const scriptDocument = documents.find((item) => item.kind === 'script-doc');
    for (const kind of ['character-bible', 'asset-needs', 'shot-list']) {
      documents.push(buildDocument(kind, productionDocumentContent(kind, brief, scriptDocument)));
    }
    const shotListDocument = documents.find((item) => item.kind === 'shot-list');
    documents.push(buildDocument(
      'audio-plan',
      productionDocumentContent('audio-plan', brief, shotListDocument),
    ));
    documents.push(buildDocument(
      'storyboard',
      productionDocumentContent('storyboard', brief, shotListDocument),
    ));
    const storyboardDocument = documents.find((item) => item.kind === 'storyboard');
    documents.push(buildDocument(
      'prompt-pack',
      productionDocumentContent('prompt-pack', brief, storyboardDocument),
    ));
    const promptPackDocument = documents.find((item) => item.kind === 'prompt-pack');
    documents.push(buildDocument(
      'candidate-review',
      productionCandidateReview(document, promptPackDocument, brief),
    ));
    const candidateReviewDocument = documents.find((item) => item.kind === 'candidate-review');
    documents.push(buildDocument(
      'edit-decision-list',
      productionEditDecisionList(document, candidateReviewDocument, brief),
    ));
    const editDecisionListDocument = documents.find((item) => item.kind === 'edit-decision-list');
    documents.push(buildDocument(
      'qc-report',
      productionQualityControlReport(
        editDecisionListDocument,
        brief,
        verificationValue,
      ),
    ));
    const qualityControlDocument = documents.find((item) => item.kind === 'qc-report');
    documents.push(buildDocument(
      'delivery-manifest',
      productionDeliveryManifest(
        qualityControlDocument,
        brief,
        deliveryValue,
      ),
    ));
  }
  return documents;
}

function audioTaskFor(input = {}) {
  const explicit = text(input.audioTask || input.audioRole, 40).toLowerCase();
  const aliases = {
    music: 'music',
    soundtrack: 'music',
    score: 'music',
    dialogue: 'dialogue',
    dialog: 'dialogue',
    voiceover: 'voiceover',
    narration: 'voiceover',
    ambience: 'ambience',
    ambient: 'ambience',
    sfx: 'sfx',
    effect: 'sfx',
    transcription: 'transcription',
    transcribe: 'transcription',
    stt: 'transcription',
    tts: 'voiceover',
  };
  if (aliases[explicit]) return aliases[explicit];
  const model = text(input.audioModel || input.model, 240).toLowerCase();
  if (model === 'xai-stt') return 'transcription';
  if (model === 'xai-tts') return /(?:对白|对话|dialog)/i.test(String(input.prompt || input.goal || ''))
    ? 'dialogue'
    : 'voiceover';
  const value = String(input.prompt || input.script || input.goal || input.query || '').toLowerCase();
  if (/(?:转写|听写|字幕|语音转文字|speech.?to.?text|\bstt\b|transcrib)/i.test(value)) return 'transcription';
  if (/(?:对白|对话|台词|dialog)/i.test(value)) return 'dialogue';
  if (/(?:旁白|解说|配音|朗读|voice.?over|narrat|\btts\b|text.?to.?speech)/i.test(value)) return 'voiceover';
  if (/(?:环境声|氛围声|底噪|雨声|风声|街道声|ambien)/i.test(value)) return 'ambience';
  if (/(?:音效|脚步声|撞击声|警笛|开门声|sfx|sound effect)/i.test(value)) return 'sfx';
  return 'music';
}

function videoTaskFor(input = {}) {
  const explicit = text(input.videoTask || input.videoRole, 40).toLowerCase();
  if (['lip-sync', 'lipsync', 'talking-head', 'audio-driven'].includes(explicit)) return 'lip-sync';
  const model = text(input.videoModel || input.model, 240).toLowerCase();
  if (model === 'creatify-aurora-fal') return 'lip-sync';
  const value = String(input.prompt || input.script || input.goal || input.query || '').toLowerCase();
  if (/(?:对口型|口型同步|音频驱动|数字人口播|让.{0,12}(?:照片|图片|人物).{0,12}说话|lip.?sync|audio.?driven|talking.?head)/i.test(value)) {
    return 'lip-sync';
  }
  return 'generate';
}

function audioLanguageCode(value) {
  const language = text(value, 40).toLowerCase();
  if (!language || /^(?:中文|简体中文|汉语|zh|zh-cn)$/.test(language)) return 'zh';
  if (/^(?:英文|英语|english|en|en-us)$/.test(language)) return 'en';
  if (/^(?:日文|日语|japanese|ja|ja-jp)$/.test(language)) return 'ja';
  return language.slice(0, 16);
}

function providerRecords(options = {}) {
  return typeof options.settingsProvider === 'function'
    ? normalizeAdvancedProviders(options.settingsProvider())
    : readSettingsProviders(options.settingsFile || '');
}

function resolveProviderChoice(rawProvider, kind, options = {}) {
  const requested = text(rawProvider, 160);
  if (!requested || requested === 'zhenzhen') {
    return { source: 'zhenzhen', id: '' };
  }
  if (requested === 'seedance-nz') {
    return { source: 'seedance-nz', id: '' };
  }
  if (kind === 'image' && requested === 'fal') {
    return { source: 'fal', id: '' };
  }
  if (kind === 'audio' && requested === 'grok-oauth') {
    return { source: 'grok-oauth', id: '' };
  }
  if (kind === 'video' && requested === 'fal') {
    return { source: 'fal', id: '' };
  }
  const provider = providerRecords(options).find((item) => item.id === requested);
  if (!provider || provider.enabled !== true) {
    throw new AgentControlCreativeError(
      'CREATIVE_PROVIDER_NOT_CONFIGURED',
      `${kind === 'llm' ? '语言' : kind === 'image' ? '图像' : kind === 'audio' ? '音频' : '视频'}平台 ${requested} 当前未配置；请先用 model list 选择可证明存在的平台`,
      409,
    );
  }
  return { source: provider.protocol, id: provider.id };
}

function resolveBriefProviders(brief, options = {}) {
  const fallbackProvider = brief.provider;
  const llm = resolveProviderChoice(
    brief.llmProvider || (['script', 'story'].includes(brief.kind) ? fallbackProvider : ''),
    'llm',
    options,
  );
  const image = resolveProviderChoice(
    brief.imageProvider || (['image', 'edit-image', 'story'].includes(brief.kind) ? fallbackProvider : ''),
    'image',
    options,
  );
  const video = resolveProviderChoice(
    brief.videoProvider || (['video', 'edit-video', 'story'].includes(brief.kind) ? fallbackProvider : ''),
    'video',
    options,
  );
  const audio = resolveProviderChoice(
    brief.audioProvider
      || (brief.kind === 'audio' && ['xai-tts', 'xai-stt'].includes(brief.audioModel || brief.model)
        ? 'grok-oauth'
        : brief.kind === 'audio' ? fallbackProvider : ''),
    'audio',
    options,
  );
  if (audio.id) {
    throw new AgentControlCreativeError(
      'CREATIVE_AUDIO_PROVIDER_UNSUPPORTED',
      '当前 Audio 节点只证明了贞贞平台路由；请先用 model list --kind audio 选择可用模型',
      409,
    );
  }
  return {
    ...brief,
    llmProviderSource: llm.source,
    llmProviderId: llm.id,
    imageProviderSource: image.source,
    imageProviderId: image.id,
    videoProviderSource: video.source,
    videoProviderId: video.id,
    audioProviderSource: audio.source,
    audioProviderId: audio.id,
  };
}

function safeReferenceUrl(value) {
  const raw = text(value, 2_000);
  if (!raw) return '';
  if (/^\/(?:api|files|inputs?|outputs?)\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return '';
}

function resolveReferenceBindings(document, database, projectId, referenceIds = []) {
  return unique(referenceIds).map((referenceId) => {
    const asset = database?.getAsset?.(referenceId);
    if (asset) {
      if (String(asset.projectId || '') !== String(projectId || '')) {
        throw new AgentControlCreativeError(
          'CREATIVE_REFERENCE_SCOPE_MISMATCH',
          `参考素材 ${referenceId} 不属于当前项目，未创建工作流`,
          409,
        );
      }
      if (String(asset.kind || '') !== 'image') {
        throw new AgentControlCreativeError(
          'CREATIVE_REFERENCE_KIND_INVALID',
          `参考素材 ${referenceId} 不是图片；图像候选只能绑定图片参考`,
          409,
        );
      }
      if (['missing', 'quarantined', 'deleted'].includes(String(asset.availability || '').toLowerCase())) {
        throw new AgentControlCreativeError(
          'CREATIVE_REFERENCE_UNAVAILABLE',
          `参考素材 ${referenceId} 的原文件当前不可用，请在资产库恢复或重新选择`,
          409,
        );
      }
      return {
        id: referenceId,
        sourceType: 'asset',
        assetId: referenceId,
        contentRevision: Math.max(1, Number(asset.contentRevision || asset.revision) || 1),
        url: `/api/project-assets/${encodeURIComponent(referenceId)}/media`,
        locks: Object.fromEntries(CREATIVE_LOCK_KEYS.map((key) => [key, false])),
      };
    }

    const sourceNode = findNode(document, referenceId);
    if (!sourceNode) {
      throw new AgentControlCreativeError(
        'CREATIVE_REFERENCE_NOT_FOUND',
        `找不到参考 ${referenceId}；请使用资产库 assetId，或已采用且已有图片结果的候选节点 ID`,
        404,
      );
    }
    const sourceState = creativeStateFor(sourceNode);
    if (!sourceState.accepted) {
      throw new AgentControlCreativeError(
        'CREATIVE_REFERENCE_NOT_ACCEPTED',
        `候选节点 ${referenceId} 尚未采用；请先比较并执行 iterate accept，再作为角色参考`,
        409,
      );
    }
    const sourceData = nodeData(sourceNode);
    const url = safeReferenceUrl(
      sourceData.imageUrl
      || (Array.isArray(sourceData.imageUrls) ? sourceData.imageUrls[0] : ''),
    );
    if (!url) {
      throw new AgentControlCreativeError(
        'CREATIVE_REFERENCE_RESULT_MISSING',
        `已采用候选 ${referenceId} 尚无可复用的持久化图片，请先完成生成并确认素材可预览`,
        409,
      );
    }
    return {
      id: referenceId,
      sourceType: 'accepted-node',
      nodeId: referenceId,
      contentRevision: Math.max(1, Number(sourceData.resultRevision || sourceData.revision) || 1),
      url,
      locks: clone(sourceState.locks),
    };
  });
}

function referenceBindingPrompt(bindings) {
  if (!bindings.length) return '';
  const inherited = unique(bindings.flatMap((binding) => Object.entries(binding.locks || {})
    .filter(([, locked]) => locked === true)
    .map(([key]) => key)));
  return [
    `必须使用 ${bindings.length} 个已绑定参考素材，并保持其可辨识内容。`,
    inherited.length
      ? `继承连续性锁：${inherited.join('、')}；除非先解锁，不得改变这些部分。`
      : '参考素材用于保持角色、服装、道具或场景连续性，不要忽略。',
  ].join('\n');
}

function candidateDirection(kind, template, index) {
  const imageDirections = template === 'character-sheet'
    ? [
      '身份一致性优先：中性棚拍光，脸部与三视图结构最清楚。',
      '设定细节优先：保持同一身份，强化发型、服装材质和轮廓辨识度。',
      '成片质感优先：保持白底设定图结构，以更精致的电影级光影表现角色气质。',
      '生产可用性优先：姿态最标准、无遮挡、各视图比例统一，方便后续参考生成。',
    ]
    : template === 'costume-only'
      ? [
        '版型优先：正背面轮廓清楚，剪裁比例准确。',
        '材质优先：强化面料、纹理、缝线与配件细节。',
        '风格优先：在不加入人物和场景的前提下突出服装气质。',
        '生产可用性优先：平铺式清晰展示，避免遮挡与透视变形。',
      ]
      : [
        '构图优先：主体关系和视觉层级最清楚。',
        '情绪优先：用光线、色彩和空间营造更强氛围。',
        '镜头优先：采用更有张力但仍可读的景别与视角。',
        '细节优先：保持构图稳定，提升材质、边缘和文字可控性。',
      ];
  const videoDirections = [
    '表演与调度优先：动作起承转合清楚，镜头稳定可读。',
    '镜头表现优先：在连续性不变的前提下增强运镜和空间层次。',
    '节奏与情绪优先：强化关键动作节点、停顿和氛围变化。',
    '成片质量优先：动作、身份、服装、道具与首尾帧连续性最严格。',
  ];
  const directions = kind === 'video' ? videoDirections : imageDirections;
  return directions[index % directions.length];
}

function creatorPrompt(brief) {
  const base = brief.goal;
  if (brief.template === 'character-sheet') {
    return [
      base,
      '专业角色设定图，纯白干净背景。',
      '左侧：同一角色的清晰脸部特写；右侧：同一角色正面、侧面、背面三视图。',
      '所有视图必须是同一个人、同一脸型、发型、年龄、服装与体型；无遮挡、无场景道具、无文字水印。',
    ].filter(Boolean).join('\n');
  }
  if (brief.template === 'costume-only') {
    return [
      base,
      '只展示服装本体的专业服装设定图，纯白背景，正面与背面清楚可见。',
      '不要人物、脸、手、场景或无关道具；材质、剪裁、纹理和配件边界清晰。',
    ].filter(Boolean).join('\n');
  }
  if (brief.template === 'keyframe') {
    return [
      base,
      `电影关键帧，${brief.ratio} 构图，主体、动作、环境、光线与镜头意图明确。`,
      '保持已锁定角色身份、服装、道具和场景连续性。',
    ].filter(Boolean).join('\n');
  }
  return [
    base,
    `目标画幅 ${brief.ratio}；风格：${brief.style}。`,
    '主体明确，构图可读，避免无意义文字、水印、重复主体和身份漂移。',
  ].filter(Boolean).join('\n');
}

function defaultCreativeState(brief, groupId, candidateId, candidateIndex, candidateCount) {
  return {
    schema: CREATIVE_STATE_SCHEMA,
    groupId,
    candidateId,
    candidateIndex,
    candidateCount,
    profile: brief.profile,
    template: brief.template,
    accepted: false,
    activeBranchId: 'main',
    locks: {
      identity: brief.locks.includes('identity'),
      wardrobe: brief.locks.includes('wardrobe'),
      background: brief.locks.includes('background'),
      prompt: brief.locks.includes('prompt'),
      productShape: brief.locks.includes('productShape'),
      logo: brief.locks.includes('logo'),
      composition: brief.locks.includes('composition'),
      scene: brief.locks.includes('scene'),
    },
    versions: [],
    branches: [{ id: 'main', label: '主版本', parentId: '', createdAt: new Date().toISOString() }],
    brief,
  };
}

function originFor(document) {
  const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
  const maxX = nodes.reduce((value, node) => Math.max(value, Number(node?.position?.x) || 0), 0);
  const minY = nodes.reduce((value, node) => Math.min(value, Number(node?.position?.y) || 0), 0);
  return { x: maxX + 460, y: minY };
}

function nodeAdd(id, type, x, y, data) {
  return {
    type: 'node.add',
    payload: { node: { id, type, position: { x, y }, data } },
  };
}

function finiteCanvasCoordinate(value, fallback, label) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) {
    throw new AgentControlCreativeError('CREATIVE_NODE_POSITION_INVALID', `${label} 无效`);
  }
  return number;
}

function validateCreatorNodeDataValue(value, contract, label) {
  const type = String(contract?.type || '');
  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', `${label} 必须是文本`);
    }
    const normalized = text(value, Number(contract.maxLength) || 12_000);
    if (Array.isArray(contract.enum) && !contract.enum.includes(normalized)) {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', `${label} 不在允许选项中`);
    }
    return normalized;
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', `${label} 必须是布尔值`);
    }
    return value;
  }
  if (type === 'integer') {
    if (!Number.isSafeInteger(value) || value < Number(contract.minimum || 0)) {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', `${label} 必须是有效整数`);
    }
    return value;
  }
  if (type === 'array') {
    if (!Array.isArray(value) || value.length > Number(contract.maxItems || 0)) {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', `${label} 数组超过限制`);
    }
    return clone(value);
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length > Number(contract.maxProperties || 0)) {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', `${label} 对象超过限制`);
    }
    return clone(value);
  }
  if (type === 'subflow-definition') {
    throw new AgentControlCreativeError(
      'CREATIVE_NODE_DATA_INVALID',
      '不能直接嵌入子工作流定义；请使用已保存的 definitionId 与 definitionVersion',
    );
  }
  throw new AgentControlCreativeError('CREATIVE_NODE_SCHEMA_INVALID', `${label} 的字段契约未知`, 500);
}

function creatorNodeData(document, database, schema, input) {
  if (input.data != null && (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))) {
    throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', '节点 data 必须是对象');
  }
  const requested = input.data == null ? {} : input.data;
  const allowed = record(schema.generation?.allowedDataFields);
  const defaults = clone(record(schema.generation?.defaults));
  if (schema.generatable !== true && Object.keys(requested).length > 0) {
    throw new AgentControlCreativeError(
      'CREATIVE_NODE_DATA_FORBIDDEN',
      '这个节点可以安全加入画布，但初始参数必须在节点界面中设置',
      403,
    );
  }
  for (const key of Object.keys(requested)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)
      || !Object.prototype.hasOwnProperty.call(allowed, key)) {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_FORBIDDEN', `节点字段“${key}”不在权威 Schema 中`, 403);
    }
    defaults[key] = validateCreatorNodeDataValue(requested[key], allowed[key], `节点字段“${key}”`);
  }
  if (schema.type === 'text' && input.prompt != null) {
    if (Object.prototype.hasOwnProperty.call(requested, 'text')) {
      throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', 'prompt 与 data.text 不能同时提供');
    }
    defaults.text = text(input.prompt, 2000);
  } else if (input.prompt != null && String(input.prompt).trim()) {
    throw new AgentControlCreativeError('CREATIVE_NODE_DATA_INVALID', '只有文本节点支持 prompt 初始值');
  }
  if (schema.type === 'subflow') {
    const definitionId = identifier(defaults.definitionId, '子工作流 definitionId');
    const definitionVersion = integer(defaults.definitionVersion, 0, 1, Number.MAX_SAFE_INTEGER);
    const definition = typeof database?.getSubflowDefinition === 'function'
      ? database.getSubflowDefinition(definitionId, definitionVersion, document.projectId)
      : null;
    if (!definition || definition.id !== definitionId || Number(definition.version) !== definitionVersion) {
      throw new AgentControlCreativeError(
        'CREATIVE_SUBFLOW_NOT_FOUND',
        '指定的子工作流版本不存在或不属于当前项目',
        404,
      );
    }
    return {
      definitionId,
      definitionVersion,
      parameterOverrides: record(defaults.parameterOverrides),
    };
  }
  return defaults;
}

function graphNodeAddPatch(document, database, planId, input = {}) {
  const type = identifier(input.type, '节点类型');
  const schema = CREATOR_NODE_SCHEMA_BY_TYPE.get(type);
  if (!schema) {
    throw new AgentControlCreativeError('CREATIVE_NODE_TYPE_UNKNOWN', '节点类型不在权威 Schema 中', 404);
  }
  if (schema.hidden === true) {
    throw new AgentControlCreativeError('CREATIVE_NODE_TYPE_HIDDEN', '内部或隐藏节点不能由 Creator Agent 新增', 403);
  }
  const origin = originFor(document);
  if (input.position != null
    && (!input.position || typeof input.position !== 'object' || Array.isArray(input.position))) {
    throw new AgentControlCreativeError('CREATIVE_NODE_POSITION_INVALID', '节点 position 必须是包含 x/y 的对象');
  }
  const position = input.position == null ? {} : record(input.position);
  const x = finiteCanvasCoordinate(input.x ?? position.x, origin.x, '节点横坐标');
  const y = finiteCanvasCoordinate(input.y ?? position.y, origin.y, '节点纵坐标');
  const data = creatorNodeData(document, database, schema, input);
  const nodeId = stableId(`agent-${type}`, `${planId}:${document.canvasId}:${type}`);
  return patchEnvelope(
    document,
    stableId('creative-graph-patch', planId),
    `新增“${schema.label || type}”节点`,
    [nodeAdd(nodeId, type, x, y, data)],
  );
}

const LOCAL_UTILITY_ACTIONS = Object.freeze({
  'video.extract-frames': Object.freeze({
    nodeType: 'frame-extractor',
    inputKind: 'video',
    outputKind: 'image',
    label: '视频抽帧',
  }),
  'image.remove-solid-background': Object.freeze({
    nodeType: 'remove-bg',
    inputKind: 'image',
    outputKind: 'image',
    label: '移除边缘连通纯色背景',
  }),
  'image.resample-upscale': Object.freeze({
    nodeType: 'upscale',
    inputKind: 'image',
    outputKind: 'image',
    label: 'Lanczos 等比放大',
  }),
});

function nodeCanProvideMediaKind(node, kind) {
  const schema = CREATOR_NODE_SCHEMA_BY_TYPE.get(String(node?.type || ''));
  const outputs = Array.isArray(schema?.ports?.outputs) ? schema.ports.outputs.map(String) : [];
  if (outputs.includes(kind) || outputs.includes('any')) return true;
  const data = nodeData(node);
  const singular = kind === 'video' ? data.videoUrl : data.imageUrl;
  const plural = kind === 'video' ? data.videoUrls : data.imageUrls;
  if (safeReferenceUrl(singular)) return true;
  if (Array.isArray(plural) && plural.some((value) => safeReferenceUrl(value))) return true;
  return false;
}

function localUtilityPatch(document, planId, action, input = {}) {
  const contract = LOCAL_UTILITY_ACTIONS[action];
  if (!contract) {
    throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此本地图像或视频操作');
  }
  const sourceNodeId = input.sourceNodeId || input.source || input.nodeId;
  if (!String(sourceNodeId || '').trim()) {
    throw new AgentControlCreativeError(
      'CREATIVE_UTILITY_SOURCE_REQUIRED',
      `${contract.label}需要先指定一个上游${contract.inputKind === 'video' ? '视频' : '图片'}节点`,
      400,
    );
  }
  const source = requireNode(document, sourceNodeId);
  if (!nodeCanProvideMediaKind(source, contract.inputKind)) {
    throw new AgentControlCreativeError(
      'CREATIVE_UTILITY_SOURCE_KIND_INVALID',
      `${contract.label}需要可输出${contract.inputKind === 'video' ? '视频' : '图片'}的上游节点`,
      409,
      {
        sourceNodeId: source.id,
        sourceNodeType: source.type,
        requiredKind: contract.inputKind,
      },
    );
  }
  const sourceX = finiteCanvasCoordinate(source.position?.x, originFor(document).x, '源节点横坐标');
  const sourceY = finiteCanvasCoordinate(source.position?.y, originFor(document).y, '源节点纵坐标');
  const operationNodeId = stableId(contract.nodeType, `${planId}:${source.id}:${action}`);
  const outputNodeId = stableId('output', `${planId}:${operationNodeId}`);
  const data = {
    status: 'idle',
    agentUtilityAction: action,
    sourceNodeId: source.id,
  };
  if (action === 'video.extract-frames') {
    data.count = integer(input.count, 4, 1, 20);
  } else if (action === 'image.resample-upscale') {
    const requestedScale = Number(input.scale);
    const allowed = new Set([1.5, 2, 3, 4]);
    data.scale = allowed.has(requestedScale) ? requestedScale : 2;
  }
  return patchEnvelope(
    document,
    stableId('creative-utility-patch', `${planId}:${action}`),
    `${contract.label}：连接 ${source.id}，运行前仍需单独确认`,
    [
      nodeAdd(operationNodeId, contract.nodeType, sourceX + 430, sourceY, data),
      edgeAdd(stableId('edge', `${source.id}:${operationNodeId}`), source.id, operationNodeId),
      nodeAdd(outputNodeId, 'output', sourceX + 850, sourceY, {
        title: `${contract.label} · 输出`,
        sourceCapabilityId: action,
        sourceNodeId: operationNodeId,
      }),
      edgeAdd(stableId('edge', `${operationNodeId}:${outputNodeId}`), operationNodeId, outputNodeId),
    ],
  );
}

function nodePatch(nodeId, dataPatch) {
  return { type: 'node.patch', payload: { nodeId, dataPatch } };
}

function edgeAdd(id, source, target, sourceHandle = null, targetHandle = null) {
  return {
    type: 'edge.add',
    payload: { edge: { id, source, target, sourceHandle, targetHandle } },
  };
}

function patchEnvelope(document, id, summary, operations) {
  return {
    schema: 't8-canvas-patch-v1',
    id,
    baseRevision: Number(document.revision),
    summary,
    diagnosticsResolved: [],
    requiresConfirmation: true,
    operations,
  };
}

const LOCALIZATION_TARGET_LANGUAGES = Object.freeze([
  'ZH', 'EN', 'JA', 'ES', 'AR', 'KO', 'FR', 'DE', 'IT', 'PT', 'RU', 'TH', 'VI', 'ID', 'TR', 'HI',
]);
const LOCALIZATION_SOURCE_LANGUAGES = Object.freeze(['AUTO', ...LOCALIZATION_TARGET_LANGUAGES]);
const LOCALIZATION_MODES = Object.freeze(['subtitle-only', 'dubbing-only', 'full']);
const LOCALIZATION_ACTION_LABELS = Object.freeze({
  'localization.create': '创建多语言本地化工作台',
  'localization.transcribe': '准备源媒体转写',
  'localization.translate': '准备多语言翻译',
  'localization.cast-voices': '准备角色音色授权与分配',
  'localization.generate-dub': '准备多语言配音',
  'localization.compose': '准备字幕、配音与视频合成',
  'localization.verify': '准备本地化质量检查',
  'localization.package': '准备本地化交付包',
});

function localizationLanguage(value, fallback, allowed = LOCALIZATION_TARGET_LANGUAGES) {
  const normalized = text(value, 8).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function localizationTargetLanguages(input = {}) {
  const requested = Array.isArray(input.targetLanguages)
    ? input.targetLanguages
    : [input.targetLanguage];
  const normalized = unique(requested.map((value) => String(value || '').toUpperCase()))
    .filter((value) => LOCALIZATION_TARGET_LANGUAGES.includes(value))
    .slice(0, LOCALIZATION_TARGET_LANGUAGES.length);
  return normalized.length ? normalized : ['EN'];
}

function localizationActionPatch(document, planId, action, input = {}) {
  const label = LOCALIZATION_ACTION_LABELS[action];
  if (!label) {
    throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此本地化操作');
  }
  const targets = localizationTargetLanguages(input);
  const mode = LOCALIZATION_MODES.includes(String(input.mode || '')) ? String(input.mode) : 'full';
  const sourceLanguage = localizationLanguage(input.sourceLanguage, 'AUTO', LOCALIZATION_SOURCE_LANGUAGES);
  const sourceText = text(input.sourceText, 500_000);
  const request = {
    schema: 't8-localization-agent-request-v1',
    id: stableId('localization-request', `${planId}:${action}`),
    action,
    status: action === 'localization.create' ? 'prepared' : 'awaiting-user-run',
    targetLanguages: targets,
    mode,
    sourceLanguage,
    instruction: text(input.instruction || input.prompt, 4_000),
    createdBy: 'creator-agent',
  };
  if (action === 'localization.create') {
    const origin = originFor(document);
    const nodeId = input.nodeId
      ? identifier(input.nodeId, '本地化节点 ID')
      : stableId('localization-master', planId);
    if (findNode(document, nodeId)) {
      throw new AgentControlCreativeError('CREATIVE_NODE_ALREADY_EXISTS', '本地化节点 ID 已存在', 409);
    }
    return patchEnvelope(document, stableId('creative-patch', planId), label, [
      nodeAdd(
        nodeId,
        'localization-master',
        finiteCanvasCoordinate(input.x, origin.x, '节点 X 坐标'),
        finiteCanvasCoordinate(input.y, origin.y, '节点 Y 坐标'),
        {
          mode,
          sourceLanguage,
          targetLanguage: targets[0],
          targetLanguages: targets,
          sourceText,
          llmApiSource: 'seedance-nz',
          llmModel: 'bytedance/doubao-seed-2.1-pro',
          providerSource: 'zhenzhen',
          providerId: '',
          providerModel: 'bytedance/doubao-seed-2.1-pro',
          status: 'idle',
          localizationAgentRequest: request,
        },
      ),
    ]);
  }
  const node = requireNode(document, input.nodeId, ['localization-master']);
  const data = nodeData(node);
  const existingProject = record(data.localizationProject);
  const dataPatch = {
    mode,
    sourceLanguage,
    targetLanguage: targets.includes(String(data.targetLanguage || existingProject.targetLanguage || '').toUpperCase())
      ? String(data.targetLanguage || existingProject.targetLanguage).toUpperCase()
      : targets[0],
    targetLanguages: targets,
    localizationAgentRequest: request,
    status: 'idle',
    error: '',
  };
  if (sourceText) dataPatch.sourceText = sourceText;
  return patchEnvelope(document, stableId('creative-patch', planId), label, [nodePatch(node.id, dataPatch)]);
}

function imagePatch(document, planId, brief, candidateCount, options = {}) {
  const origin = originFor(document);
  const groupId = stableId('creative-image', planId);
  const promptId = stableId('text', `${planId}:prompt`);
  const outputId = stableId('output', `${planId}:output`);
  const referenceBindings = resolveReferenceBindings(
    document,
    options.database,
    document.projectId,
    brief.reuseAssetIds,
  );
  const inheritedLocks = unique(referenceBindings.flatMap((binding) => Object.entries(binding.locks)
    .filter(([, locked]) => locked === true)
    .map(([key]) => key)));
  const effectiveBrief = {
    ...brief,
    locks: unique([...brief.locks, ...inheritedLocks]),
    referenceBindings: referenceBindings.map(({ url, ...binding }) => binding),
  };
  const prompt = [creatorPrompt(effectiveBrief), referenceBindingPrompt(referenceBindings)]
    .filter(Boolean)
    .join('\n');
  const providerSource = brief.imageProviderSource || 'zhenzhen';
  const providerId = brief.imageProviderId || '';
  const model = brief.imageModel || brief.model || 'gpt-image-2';
  const productionBinding = creatorProductionCandidateBinding(options.productionDocuments);
  const operations = [
    nodeAdd(promptId, 'text', origin.x, origin.y, {
      text: prompt,
      title: `${brief.title} · 创作简报`,
      creativeBrief: effectiveBrief,
    }),
  ];
  const candidateNodeIds = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const candidateId = stableId('candidate', `${planId}:${index + 1}`);
    const nodeId = stableId('image', `${planId}:${index + 1}`);
    const direction = candidateDirection('image', brief.template, index);
    const candidatePrompt = `${prompt}\n候选方向：${direction}`;
    candidateNodeIds.push(nodeId);
    operations.push(nodeAdd(nodeId, 'image', origin.x + 430, origin.y + index * 560, {
      model: 'gpt-image-2',
      ...(providerSource === 'zhenzhen' ? { apiModel: model } : {}),
      aspectRatio: brief.ratio,
      // A balanced plan is still a direction-finding preview. Spend the higher
      // resolution only after the creator explicitly chooses quality-first.
      sizeLevel: brief.profile === 'quality' ? '2K' : '1K',
      gptImageQuality: brief.quality,
      gptImageModeration: 'auto',
      referenceImages: referenceBindings.map((binding) => binding.url),
      referenceAssetIds: referenceBindings
        .map((binding) => binding.assetId)
        .filter(Boolean),
      referenceBindings: referenceBindings.map(({ url, ...binding }) => binding),
      prompt: candidatePrompt,
      creativeDirection: direction,
      candidateLabel: `候选 ${index + 1} · ${direction.split('：')[0]}`,
      providerSource,
      providerId,
      providerModel: providerId ? model : '',
      imageOnlyOutput: true,
      reuseResult: false,
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState: defaultCreativeState(effectiveBrief, groupId, candidateId, index + 1, candidateCount),
    }));
    operations.push(edgeAdd(stableId('edge', `${promptId}:${nodeId}`), promptId, nodeId));
  }
  operations.push(nodeAdd(outputId, 'output', origin.x + 900, origin.y, {
    title: `${brief.title} · 候选输出`,
    creativeGroupId: groupId,
  }));
  candidateNodeIds.forEach((nodeId) => {
    operations.push(edgeAdd(stableId('edge', `${nodeId}:${outputId}`), nodeId, outputId));
  });
  return patchEnvelope(document, stableId('creative-patch', planId), `创建 ${candidateCount} 个可比较图像候选`, operations);
}

function videoPatch(document, planId, brief, candidateCount, options = {}) {
  const origin = originFor(document);
  const groupId = stableId('creative-video', planId);
  const promptId = stableId('text', `${planId}:prompt`);
  const outputId = stableId('output', `${planId}:output`);
  const prompt = [
    brief.goal,
    `目标 ${brief.durationSec || 8} 秒，${brief.ratio}，${brief.style}。`,
    '动作起点、过程和终点清楚；镜头运动可执行；保持角色身份、服装、道具和空间方向连续。',
  ].filter(Boolean).join('\n');
  const providerSource = brief.videoProviderSource || 'zhenzhen';
  const providerId = brief.videoProviderId || '';
  const model = brief.videoModel || brief.model || 'doubao-seedance-2-0-fast-260128';
  const productionBinding = creatorProductionCandidateBinding(options.productionDocuments);
  const operations = [
    nodeAdd(promptId, 'text', origin.x, origin.y, { text: prompt, creativeBrief: brief }),
  ];
  const candidateNodeIds = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const candidateId = stableId('candidate', `${planId}:${index + 1}`);
    const nodeId = stableId('video', `${planId}:${index + 1}`);
    const direction = candidateDirection('video', brief.template, index);
    const candidatePrompt = `${prompt}\n候选方向：${direction}`;
    candidateNodeIds.push(nodeId);
    operations.push(nodeAdd(nodeId, 'seedance', origin.x + 430, origin.y + index * 620, {
      seedanceApiSource: providerSource === 'zhenzhen' ? 'auto' : providerSource,
      seedanceNzModel: model,
      model,
      providerSource,
      providerId,
      providerModel: providerId ? model : '',
      duration: brief.durationSec || 8,
      ratio: brief.ratio,
      resolution: brief.profile === 'quality' ? '720p' : '480p',
      generateAudio: true,
      returnLastFrame: true,
      watermark: false,
      webSearch: false,
      seed: -1,
      frameMode: 'auto',
      prompt: candidatePrompt,
      creativeDirection: direction,
      candidateLabel: `候选 ${index + 1} · ${direction.split('：')[0]}`,
      reuseResult: false,
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState: defaultCreativeState(brief, groupId, candidateId, index + 1, candidateCount),
    }));
    operations.push(edgeAdd(stableId('edge', `${promptId}:${nodeId}`), promptId, nodeId));
  }
  operations.push(nodeAdd(outputId, 'output', origin.x + 900, origin.y, {
    title: `${brief.title} · 视频候选输出`,
    creativeGroupId: groupId,
  }));
  candidateNodeIds.forEach((nodeId) => {
    operations.push(edgeAdd(stableId('edge', `${nodeId}:${outputId}`), nodeId, outputId));
  });
  return patchEnvelope(document, stableId('creative-patch', planId), `创建 ${candidateCount} 个可比较视频候选`, operations);
}

function resolveMediaReferenceBindings(document, database, projectId, referenceIds = []) {
  return unique(referenceIds).map((assetId) => {
    const asset = database?.getAsset?.(assetId);
    if (!asset || String(asset.projectId || '') !== String(projectId || '')) {
      throw new AgentControlCreativeError('CREATIVE_REFERENCE_NOT_FOUND', `找不到当前项目素材 ${assetId}`, 404);
    }
    if (!['image', 'video', 'audio'].includes(String(asset.kind || ''))) {
      throw new AgentControlCreativeError('CREATIVE_REFERENCE_KIND_INVALID', `素材 ${assetId} 不能用于媒体编辑`, 409);
    }
    if (String(asset.availability || '') !== 'available') {
      throw new AgentControlCreativeError('CREATIVE_REFERENCE_UNAVAILABLE', `素材 ${assetId} 当前不可用`, 409);
    }
    const contentHash = text(asset.contentHash, 64).toLowerCase();
    const filename = String(asset.filename || asset.name || assetId)
      .split(/[\\/]/)
      .pop()
      .slice(0, 240);
    return {
      assetId,
      kind: String(asset.kind),
      contentRevision: Math.max(1, Number(asset.contentRevision || asset.revision) || 1),
      contentHash: /^[a-f0-9]{64}$/.test(contentHash) ? contentHash : null,
      filename,
      mimeType: text(asset.mimeType, 160) || 'application/octet-stream',
      byteSize: Math.max(0, Number(asset.byteSize || asset.size) || 0),
      url: `/api/project-assets/${encodeURIComponent(assetId)}/media`,
    };
  });
}

function editVideoPatch(document, planId, brief, candidateCount, options = {}) {
  const bindings = resolveMediaReferenceBindings(
    document,
    options.database,
    document.projectId,
    brief.reuseAssetIds,
  );
  if (!bindings.length) {
    throw new AgentControlCreativeError('CREATIVE_EDIT_REFERENCE_REQUIRED', '视频编辑至少需要一个 --asset 参考素材', 409);
  }
  const patchedBrief = {
    ...brief,
    goal: [
      brief.goal,
      '编辑要求：只修改创作者明确描述的部分；保持参考素材中未要求变化的主体、身份、服装、产品外形、场景方向与时间连续性。',
    ].filter(Boolean).join('\n'),
  };
  const result = videoPatch(document, planId, patchedBrief, candidateCount, options);
  for (const operation of result.operations) {
    if (operation.type !== 'node.add' || operation.payload?.node?.type !== 'seedance') continue;
    operation.payload.node.data.localRefImages = bindings.filter((item) => item.kind === 'image').map((item) => item.url);
    operation.payload.node.data.localRefVideos = bindings.filter((item) => item.kind === 'video').map((item) => item.url);
    operation.payload.node.data.localRefAudios = bindings.filter((item) => item.kind === 'audio').map((item) => item.url);
    operation.payload.node.data.referenceAssetIds = bindings.map((item) => item.assetId);
    operation.payload.node.data.referenceBindings = bindings.map(({ url, ...item }) => item);
  }
  result.summary = `从 ${bindings.length} 个已持久化素材创建 ${candidateCount} 个视频编辑候选`;
  return result;
}

function lipSyncPatch(document, planId, brief, candidateCount, options = {}) {
  const bindings = resolveMediaReferenceBindings(
    document,
    options.database,
    document.projectId,
    brief.reuseAssetIds,
  );
  const image = bindings.find((item) => item.kind === 'image');
  const audio = bindings.find((item) => item.kind === 'audio');
  if (!image || !audio) {
    throw new AgentControlCreativeError(
      'CREATIVE_LIP_SYNC_REFERENCES_REQUIRED',
      '对口型视频需要当前项目里各一个人物图片素材和音频素材',
      409,
      {
        requiredKinds: ['image', 'audio'],
        receivedKinds: unique(bindings.map((item) => item.kind)),
      },
    );
  }

  const origin = originFor(document);
  const groupId = stableId('creative-lip-sync', planId);
  const imageNodeId = stableId('upload', `${planId}:image`);
  const audioNodeId = stableId('upload', `${planId}:audio`);
  const outputId = stableId('output', `${planId}:output`);
  const sourceBindings = [image, audio].map(({ url, ...binding }) => binding);
  const productionBinding = creatorProductionCandidateBinding(options.productionDocuments);
  const operations = [
    nodeAdd(imageNodeId, 'upload', origin.x, origin.y, {
      title: `${brief.title} · 人物图`,
      uploadType: 'image',
      imageUrl: image.url,
      imageUrls: [image.url],
      fileName: `${image.assetId}.image`,
      fileNames: [`${image.assetId}.image`],
      sourceAssetId: image.assetId,
      referenceAssetIds: [image.assetId],
      referenceBindings: sourceBindings.filter((item) => item.kind === 'image'),
    }),
    nodeAdd(audioNodeId, 'upload', origin.x, origin.y + 360, {
      title: `${brief.title} · 驱动音频`,
      uploadType: 'audio',
      audioUrl: audio.url,
      audioUrls: [audio.url],
      fileName: `${audio.assetId}.audio`,
      fileNames: [`${audio.assetId}.audio`],
      sourceAssetId: audio.assetId,
      referenceAssetIds: [audio.assetId],
      referenceBindings: sourceBindings.filter((item) => item.kind === 'audio'),
    }),
  ];
  const candidateNodeIds = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const candidateId = stableId('candidate', `${planId}:${index + 1}`);
    const nodeId = stableId('fal-toolbox', `${planId}:${index + 1}`);
    const direction = candidateDirection('video', brief.template, index);
    const prompt = [
      brief.goal,
      `候选方向：${direction}`,
      '以输入音频为时间基准，保持人物身份、服装、发型和背景稳定；嘴型、表情与停顿自然同步，不增加无关动作。',
    ].filter(Boolean).join('\n');
    candidateNodeIds.push(nodeId);
    operations.push(nodeAdd(nodeId, 'fal-toolbox', origin.x + 430, origin.y + index * 620, {
      falToolboxCategoryId: 'video-generation',
      falToolboxActiveToolId: 'creatify-aurora-fal',
      falToolboxSearchQuery: '',
      falToolboxTextInputs: { prompt },
      falToolboxUserParams: {
        guidance_scale: 1,
        audio_guidance_scale: 2,
        resolution: brief.profile === 'quality' ? '720p' : '480p',
      },
      materialOrder: [],
      excludedMaterialIds: [],
      prompt,
      providerSource: 'fal',
      providerId: '',
      providerModel: 'creatify-aurora-fal',
      videoTask: 'lip-sync',
      referenceAssetIds: [image.assetId, audio.assetId],
      referenceBindings: sourceBindings,
      status: 'idle',
      requestId: '',
      urls: [],
      videoUrl: '',
      videoUrls: [],
      creativeDirection: direction,
      candidateLabel: `候选 ${index + 1} · ${direction.split('：')[0]}`,
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState: defaultCreativeState(brief, groupId, candidateId, index + 1, candidateCount),
    }));
    operations.push(edgeAdd(stableId('edge', `${imageNodeId}:${nodeId}`), imageNodeId, nodeId));
    operations.push(edgeAdd(stableId('edge', `${audioNodeId}:${nodeId}`), audioNodeId, nodeId));
  }
  operations.push(nodeAdd(outputId, 'output', origin.x + 900, origin.y, {
    title: `${brief.title} · 对口型候选输出`,
    creativeGroupId: groupId,
  }));
  candidateNodeIds.forEach((nodeId) => {
    operations.push(edgeAdd(stableId('edge', `${nodeId}:${outputId}`), nodeId, outputId));
  });
  return patchEnvelope(
    document,
    stableId('creative-patch', planId),
    `使用已绑定人物图与音频创建 ${candidateCount} 个 Creatify Aurora 对口型候选`,
    operations,
  );
}

function audioPatch(document, planId, brief, options = {}) {
  const origin = originFor(document);
  const promptId = stableId('text', `${planId}:prompt`);
  const audioId = stableId('audio', planId);
  const outputId = stableId('output', `${planId}:output`);
  const model = brief.audioModel || brief.model || 'suno-v5.5-generate';
  const grokTts = model === 'xai-tts';
  const grokStt = model === 'xai-stt';
  const seedAudio = model === 'doubao-seed-audio-1.0';
  const mode = model.endsWith('-cover') ? 'cover' : model.endsWith('-extend') ? 'extend' : 'generate';
  const reference = resolveMediaReferenceBindings(document, options.database, document.projectId, brief.reuseAssetIds);
  if ((mode === 'cover' || mode === 'extend') && !reference.some((item) => item.kind === 'audio')) {
    throw new AgentControlCreativeError('CREATIVE_AUDIO_REFERENCE_REQUIRED', `${mode === 'cover' ? '翻唱' : '续写'}需要一个 --asset 音频素材`, 409);
  }
  if (grokStt && !reference.some((item) => item.kind === 'audio')) {
    throw new AgentControlCreativeError('CREATIVE_AUDIO_REFERENCE_REQUIRED', '音频转写需要一个 --asset 音频素材', 409);
  }
  const prompt = [
    brief.goal,
    `用途：${brief.format}；受众：${brief.audience}；语言：${brief.language}。`,
    `风格：${brief.style}。`,
  ].filter(Boolean).join('\n');
  const creativeState = defaultCreativeState(
    brief,
    stableId('creative-audio', planId),
    stableId('candidate', planId),
    1,
    1,
  );
  const productionBinding = creatorProductionCandidateBinding(options.productionDocuments);
  if (grokTts || grokStt) {
    const sourceAudio = reference.find((item) => item.kind === 'audio');
    const operations = [];
    if (!grokStt) {
      operations.push(nodeAdd(promptId, 'text', origin.x, origin.y, { text: prompt, creativeBrief: brief }));
    }
    operations.push(nodeAdd(audioId, 'grok-oauth-agent', origin.x + (grokStt ? 0 : 430), origin.y, {
      mode: grokStt ? 'stt' : 'tts',
      autoIntent: false,
      prompt: grokStt ? '' : brief.goal,
      ttsModel: grokTts ? 'xai-tts' : undefined,
      sttModel: grokStt ? 'xai-stt' : undefined,
      voiceId: brief.voiceId || 'eve',
      language: audioLanguageCode(brief.language),
      outputFormat: ['mp3', 'wav', 'opus'].includes(brief.outputFormat) ? brief.outputFormat : 'mp3',
      audioUrl: sourceAudio?.url || '',
      referenceAssetIds: reference.map((item) => item.assetId),
      grokLocalMaterials: sourceAudio ? [{
        id: `story-audio:${sourceAudio.assetId}`,
        kind: 'audio',
        url: sourceAudio.url,
        sourceNodeId: 'agent-control',
        origin: 'local',
        label: sourceAudio.assetId,
      }] : [],
      audioRole: brief.audioTask,
      audioMetadata: {
        purpose: brief.audioTask,
        language: audioLanguageCode(brief.language),
        sourceAssetIds: reference.map((item) => item.assetId),
        licenseStatus: 'unknown',
        licenseNote: '素材许可必须由创作者或来源资产记录确认，Agent 不做推断。',
      },
      reuseResult: false,
      status: 'idle',
      grokRunRequestId: '',
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState,
    }));
    operations.push(nodeAdd(outputId, 'output', origin.x + 900, origin.y, {
      title: `${brief.title} · ${grokStt ? '转写文本' : '语音输出'}`,
    }));
    if (!grokStt) operations.push(edgeAdd(stableId('edge', `${promptId}:${audioId}`), promptId, audioId));
    operations.push(edgeAdd(stableId('edge', `${audioId}:${outputId}`), audioId, outputId));
    return patchEnvelope(
      document,
      stableId('creative-patch', planId),
      grokStt ? '创建可恢复的音频转写工作流' : '创建可编辑的 TTS 工作流',
      operations,
    );
  }
  return patchEnvelope(document, stableId('creative-patch', planId), '创建可编辑音频生成工作流', [
    nodeAdd(promptId, 'text', origin.x, origin.y, { text: prompt, creativeBrief: brief }),
    nodeAdd(audioId, 'audio', origin.x + 430, origin.y, {
      audioProviderMode: seedAudio ? 'seed-audio' : 'suno',
      providerSource: brief.audioProviderSource || 'zhenzhen',
      providerId: brief.audioProviderId || '',
      providerModel: model,
      model,
      mode,
      version: 'v5.5',
      title: brief.title,
      tags: brief.style,
      prompt,
      localRefAudio: reference.find((item) => item.kind === 'audio')?.url || '',
      localRefImage: reference.find((item) => item.kind === 'image')?.url || '',
      referenceAssetIds: reference.map((item) => item.assetId),
      audioRole: brief.audioTask,
      audioMetadata: {
        purpose: brief.audioTask,
        language: audioLanguageCode(brief.language),
        sourceAssetIds: reference.map((item) => item.assetId),
        licenseStatus: 'unknown',
        licenseNote: '素材许可必须由创作者或来源资产记录确认，Agent 不做推断。',
      },
      seedAudioSpeaker: brief.speaker || '',
      seedAudioFormat: ['wav', 'mp3', 'pcm', 'ogg_opus'].includes(brief.outputFormat) ? brief.outputFormat : 'wav',
      seedAudioSampleRate: String(brief.sampleRate || 24_000),
      seedAudioSpeechRate: brief.speechRate || 0,
      seedAudioLoudnessRate: brief.loudnessRate || 0,
      seedAudioPitchRate: brief.pitchRate || 0,
      seed: 0,
      continueAt: 28,
      reuseResult: false,
      status: 'idle',
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState,
    }),
    nodeAdd(outputId, 'output', origin.x + 900, origin.y, { title: `${brief.title} · 音频输出` }),
    edgeAdd(stableId('edge', `${promptId}:${audioId}`), promptId, audioId),
    edgeAdd(stableId('edge', `${audioId}:${outputId}`), audioId, outputId),
  ]);
}

function llmNodeProviderData(brief, model) {
  const providerSource = brief.llmProviderSource || 'zhenzhen';
  const providerId = brief.llmProviderId || '';
  if (providerSource === 'seedance-nz') {
    return {
      llmApiSource: 'seedance-nz',
      providerSource: 'zhenzhen',
      providerId: '',
      providerModel: model,
    };
  }
  if (providerId) {
    return {
      llmApiSource: 'zhenzhen',
      providerSource,
      providerId,
      providerModel: model,
    };
  }
  return {
    llmApiSource: 'zhenzhen',
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: '',
  };
}

function scriptPatch(document, planId, brief, options = {}) {
  const origin = originFor(document);
  const llmId = stableId('llm', planId);
  const outputId = stableId('output', `${planId}:output`);
  const system = [
    '你是一名专业编剧与导演。先保留创作者原意、硬约束和人物动机，再改善结构。',
    '输出应可直接编辑；不要把建议伪装成事实；对缺失信息用明确占位而不是擅自补写关键设定。',
    '包括：一句话梗概、人物弧光、场次、逐镜头动作/对白/旁白/音效、连续性约束。',
  ].join('\n');
  const creativeState = defaultCreativeState(brief, stableId('creative-script', planId), stableId('candidate', planId), 1, 1);
  const model = brief.llmModel || brief.model || 'gemini-3.5-flash';
  const productionBinding = creatorProductionCandidateBinding(options.productionDocuments);
  return patchEnvelope(document, stableId('creative-patch', planId), '创建可继续编辑的编剧工作流', [
    nodeAdd(llmId, 'llm', origin.x, origin.y, {
      model,
      ...llmNodeProviderData(brief, model),
      system,
      prompt: [
        `创作目标：${brief.goal}`,
        `受众：${brief.audience}`,
        `形式：${brief.format}`,
        `语言：${brief.language}`,
        `风格：${brief.style}`,
      ].join('\n'),
      temperature: 0.7,
      maxTokens: 16384,
      stream: true,
      history: [],
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState,
    }),
    nodeAdd(outputId, 'output', origin.x + 520, origin.y, { title: `${brief.title} · 剧本输出` }),
    edgeAdd(stableId('edge', `${llmId}:${outputId}`), llmId, outputId),
  ]);
}

function emptyStage(status = 'idle') {
  return { status, completed: 0, total: 0, message: '', updatedAt: new Date().toISOString() };
}

function storyProject(planId, brief, sourceBindings = []) {
  const createdAt = new Date().toISOString();
  const storyId = stableId('story', planId);
  const stages = {
    script: emptyStage('pending'),
    shots: emptyStage(),
    assets: emptyStage(),
    prompts: emptyStage(),
    videos: emptyStage(),
    compose: emptyStage(),
  };
  const project = {
    schema: STORY_PROJECT_SCHEMA,
    storyId,
    storyRevision: 1,
    productionRevision: 0,
    title: brief.title,
    script: brief.goal,
    settings: {
      aspectRatio: brief.ratio,
      targetDurationSec: brief.durationSec || 60,
      pace: 'balanced',
      recipe: brief.recipe || brief.template || 'general',
      visualStyle: brief.style,
      llmModel: brief.llmModel || brief.model || 'gemini-3.5-flash',
      llmProviderSource: brief.llmProviderSource || 'zhenzhen',
      llmProviderId: brief.llmProviderId || '',
      llmProviderModel: brief.llmModel || brief.model || '',
      imageModel: brief.imageModel || 'zhenzhen-image-g2-t2i',
      imageProviderSource: brief.imageProviderSource || 'zhenzhen',
      imageProviderId: brief.imageProviderId || '',
      imageProviderModel: brief.imageModel || '',
      videoModel: brief.videoModel || 'doubao-seedance-2-0-fast-260128',
      videoNzModel: brief.videoModel || 'fast',
      videoApiSource: brief.videoProviderSource && brief.videoProviderSource !== 'zhenzhen'
        ? brief.videoProviderSource
        : 'auto',
      videoProviderSource: brief.videoProviderSource || 'zhenzhen',
      videoProviderId: brief.videoProviderId || '',
      videoProviderModel: brief.videoModel || '',
      audioModel: brief.audioModel || 'doubao-seed-audio-1.0',
      audioProviderSource: brief.audioProviderSource || 'zhenzhen',
      audioProviderId: brief.audioProviderId || '',
      audioProviderModel: brief.audioModel || '',
      audioOutputFormat: 'wav',
      audioSampleRate: 24_000,
      resolution: brief.profile === 'quality' ? '720p' : '480p',
      generateAudio: true,
      maxNewTasksPerRun: 0,
      maxParallelAssets: 3,
      maxParallelVideos: 3,
    },
    styleBible: brief.style,
    scenes: [],
    shots: [],
    assets: sourceBindings
      .filter((binding) => binding.kind === 'audio')
      .map((binding) => ({
        id: stableId('asset-audio', binding.assetId),
        kind: 'audio',
        name: brief.recipe === 'mv' ? 'MV 主音乐' : '参考音频',
        description: '创作者从当前项目选择的持久音频素材；用于节拍、段落、镜头和声音层规划。',
        prompt: '',
        negativePrompt: '',
        requiredByShotIds: [],
        source: 'existing',
        status: 'succeeded',
        url: binding.url,
        taskId: '',
        taskProvider: 'project-assets',
        taskModel: '',
        error: '',
        locked: true,
        revision: binding.contentRevision,
        sourceAssetId: binding.assetId,
        sourceAssetRevision: binding.contentRevision,
      })),
    audioPlan: {
      schema: 't8-story-audio-plan-v1',
      status: 'pending-analysis',
      items: [],
      mix: { strategy: 'per-shot-layered', requiresCreatorReview: true },
      lipSync: {
        supported: true,
        provider: 'fal',
        model: 'creatify-aurora-fal',
        requiredAssetKinds: ['image', 'audio'],
        requiresRunApproval: true,
        message: '可在镜头需要对白口型时，用已确认人物图与对白音频规划 Creatify Aurora；仅规划，不自动提交。',
      },
    },
    stage: 'script',
    stages,
    coverage: {
      coveredBlocks: 0,
      totalBlocks: 0,
      percent: 0,
      uncovered: [],
      hardConstraintLosses: [],
      continuityIssues: [],
      ready: false,
    },
    finalVideoUrl: '',
    composeTaskId: '',
    composeTaskStatus: 'idle',
    linkedDirectorNodeId: '',
    linkedVideoEditNodeId: '',
    analysisSource: 'none',
    lastError: '',
    createdAt,
    updatedAt: createdAt,
  };
  return storyAction(() => storyCreative.initializeStoryProject(project));
}

function shotBreakdownInstruction(brief, source, transcriptEnabled = false) {
  return [
    '任务：对绑定的参考视频执行证据约束的导演拉片。只分析节奏、剪辑密度、镜头语言、构图与声音结构；不要复刻受保护角色、品牌、台词或独特内容。',
    `来源素材：assetId=${source.assetId}，contentRevision=${source.contentRevision}，sha256=${source.contentHash || '未知'}。`,
    `创作者要求：${brief.goal}`,
    '',
    '必须按视频实际内容输出，禁止把猜测写成事实。无法辨认的台词、人物、品牌、画面或声音统一写“未知/无法确认”，并说明原因。',
    '先输出 Markdown 镜头表，每个镜头必须包含：序号、开始时间码、结束时间码、时长、景别、运镜、构图与主体动作、对白/旁白、音乐、环境声、音效、可复用且可编辑的版权安全 Prompt、置信度、证据或未知项。',
    '随后输出一个 ```json 代码块，根对象字段固定为 sourceAsset、summary、shots、limitations。',
    'sourceAsset 必须固定写为 {assetId, contentRevision, contentHash}，三个值必须与来源素材完全一致；否则结果不能进入作品文档。',
    'shots 每项字段固定为 ordinal、startTimecode、endTimecode、durationSec、shotSize、cameraMovement、composition、action、dialogue、narration、music、ambience、sfx、editablePrompt、confidence、evidence、unknowns。',
    '时间码使用 HH:MM:SS.mmm。输入中的每张采样帧会附带时间码；只能据此给出保守的镜头边界区间，并在 unknowns 标注采样误差，绝不伪造逐帧精度。',
    transcriptEnabled
      ? '除本说明外，上游会附加由 Whisper 从同一视频得到的语音转写。必须把完整转写保存在 summary.transcriptEvidence；如果内容含 [HH:MM:SS.mmm - HH:MM:SS.mmm] 分段，这些只代表 Provider 返回的语音片段时间窗，并将 summary.transcriptAttribution 写为“provider-segments”；若没有有效时间窗则写为“untimed”。'
      : '当前工作流使用带时间码的画面采样，不会把视频音轨发送给模型。对白、旁白、音乐、环境声和音效必须写“未知/无法确认（当前链路未分析音轨）”，不得根据画面猜测。',
    transcriptEnabled
      ? '只有 Provider 分段时间窗与采样帧推断的镜头区间发生重叠时，才可在对应镜头的 dialogue 或 narration 中引用该段语音并同时写明“Whisper 时间窗证据”；不得把分段当逐词时间戳、不得猜说话人、不得声称精确镜头归属。无有效时间窗时，各镜头 dialogue 与 narration 仍写“未知/无法确认（转写无时间戳，不能归属到该镜头）”。'
      : '',
    transcriptEnabled
      ? 'Whisper 只提供语音文字证据；music、ambience、sfx 必须写“未知/无法确认（当前链路未做声音分类）”。若转写为空或缺失，明确写“未检测到可用语音转写”。'
      : '',
    `summary 至少包含 totalDuration、shotCount、averageShotDuration、editingDensity、rhythmPattern、cameraLanguage、soundStructure${transcriptEnabled ? '、transcriptEvidence、transcriptAttribution' : ''}。`,
    'limitations 必须说明视频解码、采样、画面遮挡、声音缺失或文本识别的限制；若分析未覆盖完整视频，明确写出最后覆盖时间码。',
    '本任务只返回分析文字，不生成图片、视频或音频。',
  ].filter(Boolean).join('\n');
}

function shotBreakdownPatch(document, planId, brief, options = {}) {
  const bindings = resolveMediaReferenceBindings(
    document,
    options.database,
    document.projectId,
    brief.reuseAssetIds,
  );
  const videos = bindings.filter((item) => item.kind === 'video');
  if (bindings.length !== 1 || videos.length !== 1) {
    throw new AgentControlCreativeError(
      'CREATIVE_SHOT_BREAKDOWN_VIDEO_REQUIRED',
      '参考视频拉片需要且只接受一个当前项目中的视频素材；请移除图片、音频或多余视频后重试',
      409,
      { receivedKinds: bindings.map((item) => item.kind), videoCount: videos.length },
    );
  }
  const source = videos[0];
  if (!source.contentHash) {
    throw new AgentControlCreativeError(
      'CREATIVE_SHOT_BREAKDOWN_EVIDENCE_REQUIRED',
      '参考视频缺少可验证的 SHA-256，请重新导入素材后再拉片',
      409,
    );
  }
  const origin = originFor(document);
  const uploadId = stableId('upload', `${planId}:reference-video`);
  const promptId = stableId('text', `${planId}:breakdown-instruction`);
  const audioId = stableId('audio', `${planId}:breakdown-transcript`);
  const llmId = stableId('llm', `${planId}:breakdown`);
  const outputId = stableId('output', `${planId}:breakdown-output`);
  const model = brief.llmModel || brief.model || 'gemini-3.5-flash';
  const referenceBinding = {
    assetId: source.assetId,
    kind: source.kind,
    contentRevision: source.contentRevision,
    contentHash: source.contentHash,
    filename: source.filename,
    mimeType: source.mimeType,
    byteSize: source.byteSize,
  };
  const transcriptEnabled = brief.audioProviderSource === 'seedance-nz'
    && brief.audioModel === 'whisper-1';
  const instruction = shotBreakdownInstruction(brief, source, transcriptEnabled);
  const creativeState = defaultCreativeState(
    brief,
    stableId('creative-shot-breakdown', planId),
    stableId('candidate', planId),
    1,
    1,
  );
  return patchEnvelope(
    document,
    stableId('creative-patch', planId),
    '创建参考视频拉片分析工作流；不会自动运行或生成素材',
    [
      nodeAdd(uploadId, 'upload', origin.x, origin.y, {
        title: `${brief.title} · 参考视频`,
        uploadType: 'video',
        videoUrl: source.url,
        videoUrls: [source.url],
        fileName: source.filename,
        fileNames: [source.filename],
        sourceAssetId: source.assetId,
        sourceAssetRevision: source.contentRevision,
        sourceContentHash: source.contentHash,
        referenceAssetIds: [source.assetId],
        referenceBindings: [referenceBinding],
      }),
      nodeAdd(promptId, 'text', origin.x, origin.y + 430, {
        text: instruction,
        creativeBrief: brief,
        referenceBindings: [referenceBinding],
      }),
      ...(transcriptEnabled ? [nodeAdd(audioId, 'audio', origin.x + 500, origin.y + 500, {
        title: `${brief.title} · 语音转写证据`,
        audioProviderMode: 'whisper',
        model: 'whisper-1',
        apiModel: 'whisper-1',
        providerSource: 'seedance-nz',
        providerId: '',
        providerModel: 'whisper-1',
        whisperResponseFormat: 'verbose_json',
        reuseResult: false,
        referenceAssetIds: [source.assetId],
        referenceBindings: [referenceBinding],
        analysisMode: 'reference-video-segment-transcript',
        outputSchema: 't8-reference-video-transcript-v2',
      })] : []),
      nodeAdd(llmId, 'llm', origin.x + 500, origin.y + 120, {
        title: `${brief.title} · 时间码拉片`,
        model,
        ...llmNodeProviderData(brief, model),
        system: '你是严谨的导演拉片分析师。所有结论必须绑定视频证据；未知保持未知；不得生成媒体或复刻受保护内容。',
        prompt: '',
        temperature: 0.2,
        maxTokens: 32768,
        stream: false,
        llmVideoMode: 'frames',
        videoFrameCount: 48,
        videoFrameMaxSize: 720,
        history: [],
        referenceAssetIds: [source.assetId],
        referenceBindings: [referenceBinding],
        analysisMode: 'reference-video-shot-breakdown',
        audioEvidenceMode: transcriptEnabled ? 'whisper-segments-or-untimed' : 'none',
        outputSchema: 't8-reference-video-breakdown-v2',
        creativeState,
      }),
      nodeAdd(outputId, 'output', origin.x + 1030, origin.y + 120, {
        title: `${brief.title} · 拉片结果`,
        referenceAssetIds: [source.assetId],
      }),
      edgeAdd(stableId('edge', `${uploadId}:${llmId}`), uploadId, llmId),
      ...(transcriptEnabled ? [edgeAdd(stableId('edge', `${uploadId}:${audioId}`), uploadId, audioId)] : []),
      edgeAdd(stableId('edge', `${promptId}:${llmId}`), promptId, llmId),
      ...(transcriptEnabled ? [edgeAdd(stableId('edge', `${audioId}:${llmId}`), audioId, llmId, 'text')] : []),
      edgeAdd(stableId('edge', `${llmId}:${outputId}`), llmId, outputId),
    ],
  );
}

function storyPatch(document, planId, brief, options = {}) {
  const origin = originFor(document);
  const nodeId = stableId('story-node', planId);
  const sourceBindings = resolveMediaReferenceBindings(
    document,
    options.database,
    document.projectId,
    brief.reuseAssetIds,
  );
  if (brief.recipe === 'mv' && !sourceBindings.some((binding) => binding.kind === 'audio')) {
    throw new AgentControlCreativeError(
      'CREATIVE_MV_AUDIO_REQUIRED',
      'MV 自动分析必须绑定当前项目中的一首歌或音频素材',
      409,
    );
  }
  const project = storyProject(planId, brief, sourceBindings);
  const creativeState = defaultCreativeState(brief, stableId('creative-story', planId), stableId('candidate', planId), 1, 1);
  const productionBinding = creatorProductionBinding(options.productionDocuments, project);
  return patchEnvelope(document, stableId('creative-patch', planId), '创建已完成本地镜头、资产与声音分析且不会自动生成的 Story 制片项目', [
    nodeAdd(nodeId, 'story', origin.x, origin.y, {
      storyProject: project,
      storyId: project.storyId,
      storyRevision: project.storyRevision,
      productionRevision: 0,
      storyRunMode: 'all',
      storyRunTargetId: '',
      storyRunRequestId: '',
      outputText: '',
      videoUrl: '',
      videoUrls: [],
      status: 'idle',
      creativePolicy: {
        autoGenerateOnStageEnter: false,
        generateScope: 'missing-failed-unlocked',
        preserveUploads: true,
        requireRunApproval: true,
      },
      ...(productionBinding ? { creatorProductionBinding: productionBinding } : {}),
      creativeState,
    }),
  ]);
}

function createPatch(document, planId, kind, brief, candidateCount, options = {}) {
  if (kind === 'image') return imagePatch(document, planId, brief, candidateCount, options);
  if (kind === 'edit-image') {
    if (!brief.reuseAssetIds.length) {
      throw new AgentControlCreativeError('CREATIVE_EDIT_REFERENCE_REQUIRED', '图片编辑至少需要一个 --asset 参考素材', 409);
    }
    return imagePatch(document, planId, {
      ...brief,
      goal: `${brief.goal}\n编辑要求：只修改明确指定部分，参考图中未要求变化的身份、产品外形、服装和背景保持不变。`,
      template: brief.template === 'general' ? 'remake' : brief.template,
    }, candidateCount, options);
  }
  if (kind === 'video') {
    if (brief.videoTask === 'lip-sync') {
      return lipSyncPatch(document, planId, brief, candidateCount, options);
    }
    return videoPatch(document, planId, brief, candidateCount, options);
  }
  if (kind === 'edit-video') return editVideoPatch(document, planId, brief, candidateCount, options);
  if (kind === 'audio') return audioPatch(document, planId, brief, options);
  if (kind === 'script') return scriptPatch(document, planId, brief, options);
  if (kind === 'story') {
    if (brief.recipe === 'shot-breakdown') return shotBreakdownPatch(document, planId, brief, options);
    return storyPatch(document, planId, brief, options);
  }
  return null;
}

function creativeStateFor(node) {
  const current = record(nodeData(node).creativeState);
  return {
    schema: CREATIVE_STATE_SCHEMA,
    groupId: text(current.groupId, 160) || stableId('creative-group', node.id),
    candidateId: text(current.candidateId, 160) || stableId('candidate', node.id),
    candidateIndex: integer(current.candidateIndex, 1, 1, 100),
    candidateCount: integer(current.candidateCount, 1, 1, 100),
    profile: profileFor(current.profile),
    template: text(current.template, 80) || 'general',
    accepted: current.accepted === true,
    activeBranchId: text(current.activeBranchId, 160) || 'main',
    locks: {
      identity: current.locks?.identity === true,
      wardrobe: current.locks?.wardrobe === true,
      background: current.locks?.background === true,
      prompt: current.locks?.prompt === true,
      productShape: current.locks?.productShape === true,
      logo: current.locks?.logo === true,
      composition: current.locks?.composition === true,
      scene: current.locks?.scene === true,
    },
    versions: Array.isArray(current.versions) ? clone(current.versions).slice(-20) : [],
    branches: Array.isArray(current.branches) && current.branches.length
      ? clone(current.branches).slice(-20)
      : [{ id: 'main', label: '主版本', parentId: '', createdAt: new Date().toISOString() }],
    brief: record(current.brief),
    acceptance: record(current.acceptance),
  };
}

function versionSnapshot(node, state, label) {
  const data = nodeData(node);
  return {
    id: stableId('version', `${node.id}:${Date.now()}:${state.versions.length}`),
    label: text(label, 120) || `版本 ${state.versions.length + 1}`,
    createdAt: new Date().toISOString(),
    prompt: text(data.prompt, 12_000),
    model: text(data.providerModel || data.model, 240),
    provider: text(data.providerId || data.providerSource, 160),
    resultUrl: text(data.imageUrl || data.videoUrl || data.audioUrl, 2_000),
    accepted: state.accepted,
    locks: clone(state.locks),
  };
}

function acceptanceLockKeys(node, state, input = {}) {
  const explicit = unique(String(input.lock || '').split(','));
  const automatic = new Set(['prompt']);
  const brief = record(state.brief);
  const template = text(state.template || brief.template || brief.recipe, 80).toLowerCase();
  unique(brief.locks).forEach((key) => automatic.add(key));
  const creativeText = [
    template,
    text(brief.goal, 4_000),
    text(brief.style, 1_000),
    text(nodeData(node).candidateLabel, 240),
  ].join(' ');
  if (/(?:character|角色|人物|人像|short-drama|短剧|keyframe|关键帧)/i.test(creativeText)) {
    automatic.add('identity');
  }
  if (/(?:character-sheet|角色设定|服装|衣服|造型|short-drama|短剧|keyframe|关键帧)/i.test(creativeText)) {
    automatic.add('wardrobe');
  }
  if (/(?:tvc|product|产品|商品|品牌广告|商品广告)/i.test(creativeText)) automatic.add('productShape');
  if (/(?:logo|标志|商标|品牌)/i.test(creativeText)) automatic.add('logo');
  if (/(?:构图|版式|composition|layout|product|商品图)/i.test(creativeText)) automatic.add('composition');
  if (/(?:背景|场景|环境|scene|background)/i.test(creativeText)) {
    automatic.add('background');
    automatic.add('scene');
  }
  return {
    explicit: explicit.filter((key) => Object.prototype.hasOwnProperty.call(state.locks, key)),
    automatic: [...automatic].filter((key) => Object.prototype.hasOwnProperty.call(state.locks, key)),
  };
}

function normalizeCreativeReviewInput(input, node) {
  const raw = record(input.review);
  if (raw.schema && raw.schema !== 't8-creative-review-v1') {
    throw new AgentControlCreativeError('CREATIVE_REVIEW_SCHEMA_INVALID', '候选评审文件 schema 必须是 t8-creative-review-v1');
  }
  if (text(raw.source, 80) !== 'visual-inspection') {
    throw new AgentControlCreativeError(
      'CREATIVE_REVIEW_VISUAL_EVIDENCE_REQUIRED',
      '候选评审必须来自对实际媒体的视觉或听觉检查，不能只根据 Prompt 或模型名填写',
    );
  }
  const evidence = record(raw.evidence);
  const evidenceUrl = safeReferenceUrl(evidence.url);
  const evidenceAssetId = text(evidence.assetId, 160);
  const evidenceContentHash = text(evidence.contentHash, 200);
  if (!evidenceUrl && !evidenceAssetId && !evidenceContentHash) {
    throw new AgentControlCreativeError(
      'CREATIVE_REVIEW_EVIDENCE_REQUIRED',
      '候选评审必须绑定实际结果 URL、assetId 或 contentHash',
    );
  }
  const statuses = new Set(['pass', 'warn', 'fail', 'unknown']);
  const dimensions = {};
  for (const [key, value] of Object.entries(record(raw.dimensions))) {
    const item = record(value);
    const status = text(item.status, 20).toLowerCase();
    if (!statuses.has(status)) continue;
    dimensions[text(key, 80)] = {
      status,
      summary: text(item.summary, 1_000),
      evidence: text(item.evidence, 1_000),
    };
  }
  if (!Object.keys(dimensions).length) {
    throw new AgentControlCreativeError(
      'CREATIVE_REVIEW_DIMENSIONS_REQUIRED',
      '候选评审至少需要一个实际作品维度，例如构图、角色一致性、产品外形、节奏或文字正确性',
    );
  }
  return {
    schema: 't8-creative-review-v1',
    source: 'visual-inspection',
    nodeId: node.id,
    reviewedAt: text(raw.reviewedAt, 80) || new Date().toISOString(),
    reviewer: text(raw.reviewer, 120) || 'host-agent',
    evidence: {
      ...(evidenceUrl ? { url: evidenceUrl } : {}),
      ...(evidenceAssetId ? { assetId: evidenceAssetId } : {}),
      ...(evidenceContentHash ? { contentHash: evidenceContentHash } : {}),
    },
    dimensions,
    notes: text(raw.notes, 2_000),
  };
}

function iteratePatch(document, planId, action, input) {
  const node = requireNode(document, input.nodeId);
  const state = creativeStateFor(node);
  const data = nodeData(node);
  const versions = [...state.versions, versionSnapshot(node, state, input.label)].slice(-20);
  if (action === 'review') {
    const creativeReview = normalizeCreativeReviewInput(input, node);
    return patchEnvelope(document, stableId('creative-patch', planId), '保存基于实际候选媒体的创作评审', [
      nodePatch(node.id, { creativeReview }),
    ]);
  }
  if (action === 'lock' || action === 'unlock') {
    const requested = unique(String(input.lock || CREATIVE_LOCK_KEYS.join(',')).split(','));
    const locks = { ...state.locks };
    requested.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(locks, key)) locks[key] = action === 'lock';
    });
    return patchEnvelope(document, stableId('creative-patch', planId), `${action === 'lock' ? '锁定' : '解锁'}创作连续性字段`, [
      nodePatch(node.id, { creativeState: { ...state, locks, versions } }),
    ]);
  }
  if (action === 'accept') {
    const resultKind = data.imageUrl || (Array.isArray(data.imageUrls) && data.imageUrls.length)
      ? 'image'
      : data.videoUrl || (Array.isArray(data.videoUrls) && data.videoUrls.length)
        ? 'video'
        : data.audioUrl || (Array.isArray(data.audioUrls) && data.audioUrls.length)
          ? 'audio'
          : data.outputText ? 'text' : null;
    const rawUrls = resultKind === 'image'
      ? [data.imageUrl, ...(Array.isArray(data.imageUrls) ? data.imageUrls : [])]
      : resultKind === 'video'
        ? [data.videoUrl, ...(Array.isArray(data.videoUrls) ? data.videoUrls : [])]
        : resultKind === 'audio'
          ? [data.audioUrl, ...(Array.isArray(data.audioUrls) ? data.audioUrls : [])]
          : [];
    const resultUrls = [...new Set(rawUrls.map(safeReferenceUrl).filter(Boolean))];
    if (!resultKind || (resultKind !== 'text' && !resultUrls.length)) {
      throw new AgentControlCreativeError(
        'CREATIVE_CANDIDATE_RESULT_REQUIRED',
        '当前候选还没有可核对的真实作品，不能采用。请先完成生成并确认结果能正常打开。',
        409,
      );
    }
    if (['error', 'failed'].includes(text(data.status, 80).toLowerCase())) {
      throw new AgentControlCreativeError(
        'CREATIVE_CANDIDATE_RESULT_FAILED',
        '当前候选生成失败，不能采用。请先查看真实失败原因并重试。',
        409,
      );
    }
    const review = candidateReview(data, resultKind, resultUrls);
    if (review.status !== 'verified') {
      throw new AgentControlCreativeError(
        'CREATIVE_CANDIDATE_REVIEW_REQUIRED',
        '采用前必须检查当前真实作品；不能只根据 Prompt、模型名或缩略图猜质量。',
        409,
        { review },
      );
    }
    if ((review.missingDimensions || []).length || review.hardGatesPassed !== true) {
      throw new AgentControlCreativeError(
        'CREATIVE_CANDIDATE_REVIEW_FAILED',
        review.hardGateFailures?.length
          ? `当前候选有硬性问题（${review.hardGateFailures.join('、')}），不能采用。`
          : `当前候选仍缺少必要检查（${(review.missingDimensions || []).join('、')}），不能采用。`,
        409,
        { review },
      );
    }
    const requested = acceptanceLockKeys(node, state, input);
    const peers = (document.nodes || []).filter((candidate) => {
      const candidateState = record(nodeData(candidate).creativeState);
      return candidateState.groupId && candidateState.groupId === state.groupId;
    });
    const operations = peers.map((candidate) => {
      const candidateState = creativeStateFor(candidate);
      const locks = { ...candidateState.locks };
      if (candidate.id === node.id) {
        [...requested.automatic, ...requested.explicit].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(locks, key)) locks[key] = true;
        });
      }
      return nodePatch(candidate.id, {
        creativeState: {
          ...candidateState,
          accepted: candidate.id === node.id,
          locks,
          acceptance: candidate.id === node.id
            ? {
                schema: 't8-creative-adoption-receipt-v1',
                nodeId: node.id,
                candidateId: candidateState.candidateId,
                acceptedAt: new Date().toISOString(),
                evidenceDigest: digest(candidateEvidence(data, resultKind, resultUrls)),
                reviewDigest: digest(review),
                reviewedAt: review.reviewedAt || null,
                reviewer: review.reviewer || null,
                automaticLocks: requested.automatic,
                explicitLocks: requested.explicit,
              }
            : candidateState.acceptance,
          versions: candidate.id === node.id ? versions : candidateState.versions,
        },
      });
    });
    return patchEnvelope(document, stableId('creative-patch', planId), '采用当前候选并保留其他候选用于比较', operations);
  }
  if (action === 'branch') {
    const branchId = stableId('branch', `${node.id}:${Date.now()}:${input.label || ''}`);
    const branchNodeId = stableId(String(node.type || 'creative'), `${node.id}:${branchId}`);
    const branchState = {
      ...state,
      candidateId: stableId('candidate', branchNodeId),
      candidateIndex: state.candidateCount + 1,
      candidateCount: state.candidateCount + 1,
      accepted: false,
      activeBranchId: branchId,
      versions,
      branches: [...state.branches, {
        id: branchId,
        label: text(input.label, 120) || `分支 ${state.branches.length + 1}`,
        parentId: state.activeBranchId,
        createdAt: new Date().toISOString(),
      }].slice(-20),
    };
    const copyData = {
      ...clone(data),
      creativeState: branchState,
      status: 'idle',
      error: '',
      reuseResult: false,
    };
    for (const key of ['imageUrl', 'imageUrls', 'videoUrl', 'videoUrls', 'audioUrl', 'audioUrls', 'taskId']) delete copyData[key];
    return patchEnvelope(document, stableId('creative-patch', planId), '从当前候选创建独立可迭代分支', [
      nodeAdd(
        branchNodeId,
        String(node.type || 'image'),
        Number(node.position?.x || 0) + 80,
        Number(node.position?.y || 0) + 120,
        copyData,
      ),
    ]);
  }
  if (action === 'rollback') {
    const requestedVersion = text(input.version, 160);
    const snapshot = requestedVersion
      ? state.versions.find((item) => String(item?.id || '') === requestedVersion)
      : state.versions.at(-1);
    if (!snapshot) {
      throw new AgentControlCreativeError('CREATIVE_VERSION_NOT_FOUND', '没有可恢复的创作版本', 404);
    }
    return patchEnvelope(document, stableId('creative-patch', planId), `恢复创作版本：${snapshot.label || snapshot.id}`, [
      nodePatch(node.id, {
        prompt: text(snapshot.prompt, 12_000),
        providerModel: text(snapshot.model, 240),
        creativeState: {
          ...state,
          accepted: snapshot.accepted === true,
          locks: { ...state.locks, ...record(snapshot.locks) },
          versions,
        },
      }),
    ]);
  }
  throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此迭代操作');
}

function productionContinuePatch(document, planId, input) {
  const node = requireNode(document, input.nodeId);
  const incrementalPlan = record(input.incrementalPlan);
  if (incrementalPlan.schema !== 't8-creator-incremental-plan-v1') {
    throw new AgentControlCreativeError(
      'CREATIVE_INCREMENTAL_PLAN_INVALID',
      '继续制作必须提供 t8-creator-incremental-plan-v1 结构化增量计划',
    );
  }
  if (String(incrementalPlan.target?.nodeId || '') !== String(node.id)) {
    throw new AgentControlCreativeError(
      'CREATIVE_INCREMENTAL_TARGET_MISMATCH',
      '增量计划目标与当前生产节点不一致，未生成写入预览',
      409,
    );
  }
  const state = creativeStateFor(node);
  const plannedAt = new Date().toISOString();
  const dataPatch = {
    creativeState: {
      ...state,
      pendingIncrementalPlan: clone(incrementalPlan),
      pendingIncrementalPlanDigest: digest(incrementalPlan),
      pendingIncrementalPlanAt: plannedAt,
    },
  };
  if (String(node.type || '') === 'story') {
    const project = clone(record(nodeData(node).storyProject));
    dataPatch.storyProject = {
      ...project,
      pendingIncrementalPlan: clone(incrementalPlan),
      pendingIncrementalPlanDigest: digest(incrementalPlan),
      storyRevision: Math.max(1, Number(project.storyRevision) || 1) + 1,
      updatedAt: plannedAt,
    };
  }
  return patchEnvelope(
    document,
    stableId('creative-patch', planId),
    `在原生产节点保存增量计划：${text(incrementalPlan.summary, 500) || '继续制作'}`,
    [nodePatch(node.id, dataPatch)],
  );
}

function storyShots(project) {
  return (Array.isArray(project?.shots) ? project.shots : []).map((shot, index) => ({
    id: text(shot.id, 160) || stableId('shot', `${project.storyId}:${index + 1}`),
    title: text(shot.title, 160) || `S${index + 1}`,
    durationSec: integer(shot.durationSec, 6, 1, 120),
    prompt: text(shot.finalPrompt || shot.visualDescription || shot.action, 12_000),
    negativePrompt: text(shot.negativePrompt, 4_000),
    frameMode: 'auto',
    localRefImages: [],
    localRefVideos: [],
    localRefAudios: [],
    localRefOrder: [],
    seed: -1,
    modelOverride: text(shot.taskModel, 240),
    ratioOverride: text(project?.settings?.aspectRatio, 20) || '16:9',
    resolutionOverride: text(project?.settings?.resolution, 20) || '720p',
    status: shot.videoUrl ? 'done' : 'idle',
    taskId: text(shot.taskId, 240) || null,
    taskProvider: text(shot.taskProvider, 160) || null,
    videoUrl: text(shot.videoUrl, 2_000) || null,
    error: text(shot.error, 1_000) || null,
  }));
}

function directorPatch(document, planId, input) {
  const storyNode = requireNode(document, input.storyNodeId || input.story, ['story']);
  const project = record(nodeData(storyNode).storyProject);
  const shots = storyShots(project);
  if (!shots.length) {
    throw new AgentControlCreativeError(
      'CREATIVE_STORY_SHOTS_REQUIRED',
      'Story 还没有已确认镜头；请先在 Story 工作台完成“剧本与镜头”阶段',
      409,
    );
  }
  const requestedId = text(input.nodeId, 160);
  const linkedId = text(project.linkedDirectorNodeId, 160);
  const directorId = requestedId || linkedId || stableId('director', storyNode.id);
  const existing = findNode(document, directorId)
    || (document.nodes || []).find((node) => node.type === 'director-storyboard'
      && nodeData(node).sourceStoryNodeId === storyNode.id);
  const actualId = existing?.id || directorId;
  const dataPatch = {
    sourceStoryNodeId: storyNode.id,
    sourceStoryId: text(project.storyId, 160),
    sourceStoryRevision: integer(project.storyRevision, 1, 1, Number.MAX_SAFE_INTEGER),
    seedanceApiSource: project.settings?.videoApiSource || 'auto',
    seedanceNzModel: project.settings?.videoNzModel || 'fast',
    model: project.settings?.videoModel || 'doubao-seedance-2-0-fast-260128',
    providerSource: project.settings?.videoProviderSource || 'zhenzhen',
    providerId: project.settings?.videoProviderId || '',
    providerModel: project.settings?.videoProviderModel || '',
    ratio: project.settings?.aspectRatio || '16:9',
    resolution: project.settings?.resolution || '720p',
    generateAudio: project.settings?.generateAudio !== false,
    returnLastFrame: true,
    watermark: false,
    webSearch: false,
    seed: -1,
    shots,
    shotResults: Object.fromEntries(shots
      .filter((shot) => shot.videoUrl)
      .map((shot) => [`shot-${shot.id}`, {
        status: 'done',
        progress: 100,
        taskId: shot.taskId,
        videoUrl: shot.videoUrl,
      }])),
    videoUrls: shots.map((shot) => shot.videoUrl).filter(Boolean),
    outputText: `来自 Story：${project.title || storyNode.id} · ${shots.length} 镜头`,
    status: shots.every((shot) => shot.videoUrl) ? 'success' : 'idle',
  };
  const operations = existing
    ? [nodePatch(actualId, dataPatch)]
    : [nodeAdd(actualId, 'director-storyboard', Number(storyNode.position?.x || 0) + 520, Number(storyNode.position?.y || 0), dataPatch)];
  if (!(document.edges || []).some((edge) => edge.source === storyNode.id && edge.target === actualId)) {
    operations.push(edgeAdd(stableId('edge', `${storyNode.id}:${actualId}`), storyNode.id, actualId));
  }
  operations.push(nodePatch(storyNode.id, {
    storyProject: { ...project, linkedDirectorNodeId: actualId },
  }));
  return patchEnvelope(document, stableId('creative-patch', planId), `把 ${shots.length} 个 Story 镜头物化到导演分镜台`, operations);
}

function clipFromDirectorShot(shot, directorNode, index) {
  const url = text(shot.videoUrl, 2_000);
  if (!url) return null;
  const id = stableId('clip', `${directorNode.id}:${shot.id}`);
  return {
    id,
    assetId: stableId('asset', url),
    sourceNodeId: directorNode.id,
    sourceLabel: text(shot.title, 160) || `镜头 ${index + 1}`,
    name: `${text(shot.title, 120) || `镜头-${index + 1}`}.mp4`,
    url,
    duration: integer(shot.durationSec, 5, 1, 3_600),
    trimStart: 0,
    trimEnd: integer(shot.durationSec, 5, 1, 3_600),
    muted: false,
    status: 'ready',
    storyboardNote: text(shot.prompt, 2_000),
    storyboardTags: [text(shot.id, 160)].filter(Boolean),
  };
}

function timelineFromClips(clips) {
  const assets = clips.map((clip) => ({
    id: clip.assetId,
    kind: 'video',
    url: clip.url,
    name: clip.name,
    duration: clip.duration,
    sourceNodeId: clip.sourceNodeId,
    sourceLabel: clip.sourceLabel,
  }));
  let cursor = 0;
  const items = clips.map((clip) => {
    const duration = Math.max(0.1, Number(clip.trimEnd || clip.duration || 5) - Number(clip.trimStart || 0));
    const item = {
      id: stableId('timeline-item', clip.id),
      assetId: clip.assetId,
      trackId: 'video-main',
      kind: 'video',
      timelineStart: cursor,
      sourceIn: Number(clip.trimStart || 0),
      sourceOut: Number(clip.trimEnd || clip.duration || 5),
      muted: clip.muted === true,
      label: clip.sourceLabel,
    };
    cursor += duration;
    return item;
  });
  return {
    version: 2,
    assets,
    tracks: [{ id: 'video-main', kind: 'video', name: '主视频', order: 0, muted: false, locked: false, hidden: false }],
    items,
    selectedItemIds: [],
    playhead: 0,
    zoom: 1,
    scrollLeft: 0,
    snapEnabled: true,
  };
}

function videoEditPatch(document, planId, input) {
  const director = requireNode(document, input.nodeId || input.director, ['director-storyboard']);
  const shots = Array.isArray(nodeData(director).shots) ? nodeData(director).shots : [];
  const clips = shots.map((shot, index) => clipFromDirectorShot(shot, director, index)).filter(Boolean);
  if (!clips.length) {
    throw new AgentControlCreativeError(
      'CREATIVE_DIRECTOR_VIDEOS_REQUIRED',
      '导演分镜台还没有完成的视频镜头；请先生成至少一个镜头，或使用 deliver 查看缺失项',
      409,
    );
  }
  const videoEditId = text(input.to, 160) || stableId('video-edit', director.id);
  const existing = findNode(document, videoEditId)
    || (document.nodes || []).find((node) => node.type === 'video-edit'
      && nodeData(node).sourceDirectorNodeId === director.id);
  const actualId = existing?.id || videoEditId;
  const dataPatch = {
    sourceDirectorNodeId: director.id,
    sourceStoryNodeId: text(nodeData(director).sourceStoryNodeId, 160),
    sourceShotIds: shots.map((shot) => text(shot.id, 160)).filter(Boolean),
    clips,
    timelineV2: timelineFromClips(clips),
    selectedClipId: clips[0]?.id || '',
    outputVersions: [],
    settings: {
      aspect: nodeData(director).ratio || 'first',
      resolution: nodeData(director).resolution || 'first',
      transition: 'none',
      transitionDuration: 0.8,
      filter: 'none',
      audio: 'keep',
      targetDuration: clips.reduce((sum, clip) => sum + Number(clip.duration || 0), 0),
      defaultClipDuration: 5,
      importSortMode: 'current',
      defaultTrimMode: 'full',
      audioFilter: 'all',
      safeAreaOverlay: 'none',
      autoCreateOutputNode: false,
      outputPreset: 'custom',
      creatorTemplate: 'manual',
    },
    job: { status: 'idle', progress: 0 },
    videoUrl: '',
    videoUrls: [],
    status: 'idle',
    error: '',
  };
  const operations = existing
    ? [nodePatch(actualId, dataPatch)]
    : [nodeAdd(actualId, 'video-edit', Number(director.position?.x || 0) + 620, Number(director.position?.y || 0), dataPatch)];
  if (!(document.edges || []).some((edge) => edge.source === director.id && edge.target === actualId)) {
    operations.push(edgeAdd(stableId('edge', `${director.id}:${actualId}`), director.id, actualId));
  }
  if (nodeData(director).sourceStoryNodeId) {
    const story = findNode(document, nodeData(director).sourceStoryNodeId);
    const project = record(nodeData(story).storyProject);
    if (story && project.storyId) {
      operations.push(nodePatch(story.id, {
        storyProject: { ...project, linkedVideoEditNodeId: actualId },
      }));
    }
  }
  return patchEnvelope(document, stableId('creative-patch', planId), `把 ${clips.length} 个已完成镜头送入剪辑台`, operations);
}

function candidateEvidence(data, resultKind, resultUrls) {
  const outputText = resultKind === 'text'
    ? String(data.outputText ?? '').normalize('NFKC').replace(/\u0000/g, '').trim()
    : '';
  return {
    url: resultUrls[0] || null,
    assetId: text(data.outputAssetId || data.assetId, 160) || null,
    contentHash: text(data.contentHash, 200)
      || (outputText ? digest({ kind: 'text', content: outputText }) : null),
  };
}

function candidateReview(data, resultKind, resultUrls) {
  const raw = record(data.creativeReview);
  const requiredDimensions = resultKind === 'image'
    ? ['composition', 'identity', 'productShape', 'textAccuracy']
    : resultKind === 'video'
      ? ['composition', 'identity', 'continuity', 'rhythm', 'textAccuracy']
      : resultKind === 'audio'
        ? ['intelligibility', 'timing', 'noise']
        : resultKind === 'text'
          ? ['structure', 'continuity', 'textAccuracy']
          : [];
  const pending = (reason) => ({
    schema: 't8-creative-review-summary-v1',
    status: 'pending',
    source: null,
    requiredDimensions,
    reviewedDimensions: [],
    hardGateFailures: [],
    reason,
  });
  if (!resultKind) return pending('候选还没有实际作品');
  if (raw.schema !== 't8-creative-review-v1' || raw.source !== 'visual-inspection') {
    return pending('尚未检查实际候选媒体；不能只根据 Prompt、标签或模型名评价质量');
  }
  const evidence = record(raw.evidence);
  const actualEvidence = candidateEvidence(data, resultKind, resultUrls);
  const evidenceMatches = (
    (safeReferenceUrl(evidence.url) && resultUrls.includes(safeReferenceUrl(evidence.url)))
    || (text(evidence.assetId, 160) && actualEvidence.assetId && text(evidence.assetId, 160) === actualEvidence.assetId)
    || (text(evidence.contentHash, 200) && actualEvidence.contentHash && text(evidence.contentHash, 200) === actualEvidence.contentHash)
  );
  if (!evidenceMatches) return pending('评审证据与当前候选结果不匹配，需要重新检查当前版本');
  const dimensions = Object.fromEntries(Object.entries(record(raw.dimensions)).map(([key, value]) => {
    const item = record(value);
    return [key, {
      status: ['pass', 'warn', 'fail', 'unknown'].includes(text(item.status, 20).toLowerCase())
        ? text(item.status, 20).toLowerCase()
        : 'unknown',
      summary: text(item.summary, 1_000),
      evidence: text(item.evidence, 1_000),
    }];
  }));
  const hardGateKeys = new Set(['identity', 'productShape', 'continuity', 'textAccuracy']);
  const hardGateFailures = Object.entries(dimensions)
    .filter(([key, value]) => hardGateKeys.has(key) && value.status === 'fail')
    .map(([key]) => key);
  return {
    schema: 't8-creative-review-summary-v1',
    status: 'verified',
    source: 'visual-inspection',
    reviewer: text(raw.reviewer, 120) || 'host-agent',
    reviewedAt: text(raw.reviewedAt, 80) || null,
    evidence: clone(evidence),
    requiredDimensions,
    reviewedDimensions: Object.keys(dimensions),
    missingDimensions: requiredDimensions.filter((key) => !Object.hasOwn(dimensions, key)),
    dimensions,
    hardGateFailures,
    hardGatesPassed: hardGateFailures.length === 0,
    notes: text(raw.notes, 2_000),
  };
}

function compareCandidates(document, input) {
  const requestedNode = text(input.nodeId, 160);
  const requestedGroup = text(input.groupId, 160);
  let groupId = requestedGroup;
  if (!groupId && requestedNode) groupId = text(record(nodeData(requireNode(document, requestedNode)).creativeState).groupId, 160);
  if (!groupId) {
    throw new AgentControlCreativeError('CREATIVE_GROUP_REQUIRED', 'compare 需要 --node 或 --scope <creativeGroupId>');
  }
  const candidates = (document.nodes || [])
    .filter((node) => record(nodeData(node).creativeState).groupId === groupId)
    .map((node) => {
      const state = creativeStateFor(node);
      const data = nodeData(node);
      const resultKind = data.imageUrl || (Array.isArray(data.imageUrls) && data.imageUrls.length)
        ? 'image'
        : data.videoUrl || (Array.isArray(data.videoUrls) && data.videoUrls.length)
          ? 'video'
          : data.audioUrl || (Array.isArray(data.audioUrls) && data.audioUrls.length)
            ? 'audio'
            : data.outputText ? 'text' : null;
      const rawUrls = resultKind === 'image'
        ? [data.imageUrl, ...(Array.isArray(data.imageUrls) ? data.imageUrls : [])]
        : resultKind === 'video'
          ? [data.videoUrl, ...(Array.isArray(data.videoUrls) ? data.videoUrls : [])]
          : resultKind === 'audio'
            ? [data.audioUrl, ...(Array.isArray(data.audioUrls) ? data.audioUrls : [])]
            : [];
      const resultUrls = [...new Set(rawUrls.map(safeReferenceUrl).filter(Boolean))];
      const reviewEvidence = candidateEvidence(data, resultKind, resultUrls);
      const status = text(data.status, 80) || 'idle';
      const review = candidateReview(data, resultKind, resultUrls);
      const qaWarnings = [
        ...(!resultKind ? ['尚无可比较结果'] : []),
        ...(resultKind && resultKind !== 'text' && !resultUrls.length ? ['结果地址未通过安全引用校验'] : []),
        ...(['error', 'failed'].includes(status.toLowerCase())
          ? [excerpt(data.error || data.errorMessage, 1_000) || '候选生成失败'] : []),
      ];
      return {
        nodeId: node.id,
        nodeType: node.type,
        candidateId: state.candidateId,
        candidateIndex: state.candidateIndex,
        accepted: state.accepted,
        locks: state.locks,
        model: text(data.providerModel || data.model, 240),
        provider: text(data.providerId || data.providerSource, 160),
        candidateLabel: text(data.candidateLabel, 240) || `候选 ${state.candidateIndex}`,
        creativeDirection: excerpt(data.creativeDirection, 1_000),
        promptSummary: excerpt(data.prompt || data.outputText, 2_000),
        status,
        hasResult: Boolean(resultKind),
        resultKind,
        resultText: resultKind === 'text' ? excerpt(data.outputText, 12_000) : '',
        resultUrls,
        reviewEvidence,
        media: resultKind && resultKind !== 'text' ? {
          kind: resultKind,
          urls: resultUrls,
          assetId: text(data.outputAssetId || data.assetId, 160) || null,
          contentHash: text(data.contentHash, 200) || null,
          width: Number(data.width || data.outputWidth || 0) || null,
          height: Number(data.height || data.outputHeight || 0) || null,
          duration: Number(data.duration || data.durationSec || 0) || null,
          mime: text(data.mime || data.mimeType, 120) || null,
          ratio: text(data.aspectRatio || data.ratio, 20) || null,
          resolution: text(data.sizeLevel || data.resolution, 40) || null,
          quality: text(data.gptImageQuality || data.quality, 40) || null,
        } : null,
        qa: {
          ready: Boolean(resultKind) && (resultKind === 'text' || resultUrls.length > 0) && qaWarnings.length === 0,
          creativeReady: review.status === 'verified' && review.hardGatesPassed === true,
          warnings: qaWarnings,
          accepted: state.accepted,
          continuityLocked: Object.values(state.locks).some(Boolean),
        },
        review,
        versionCount: state.versions.length,
        activeBranchId: state.activeBranchId,
      };
    })
    .sort((left, right) => left.candidateIndex - right.candidateIndex);
  return {
    schema: 't8-creative-comparison-v2',
    groupId,
    canvasRevision: Number(document.revision),
    candidates,
    contactSheet: {
      schema: 't8-creative-contact-sheet-v1',
      items: candidates.map((candidate) => ({
        nodeId: candidate.nodeId,
        label: candidate.candidateLabel,
        direction: candidate.creativeDirection,
        media: candidate.media,
        qa: candidate.qa,
        review: candidate.review,
      })),
    },
    acceptedNodeId: candidates.find((candidate) => candidate.accepted)?.nodeId || null,
    reviewCoverage: {
      verified: candidates.filter((candidate) => candidate.review.status === 'verified').length,
      totalWithResult: candidates.filter((candidate) => candidate.hasResult).length,
      hardGateFailures: candidates.flatMap((candidate) => candidate.review.hardGateFailures || []),
    },
    requiresVisualReview: candidates.some((candidate) => candidate.hasResult && candidate.review.status !== 'verified'),
    guidance: candidates.length < 2
      ? ['当前只有一个候选；可用 iterate branch 创建保留原版的探索分支。']
      : [
          '先检查实际媒体，再比较构图/叙事/节奏和细节；不能只根据 Prompt 或模型名猜质量。',
          '身份、产品外形、镜头连续性和文字正确性是硬门；任一失败时不应用审美总分掩盖。',
          '采用后自动形成相应连续性锁，只重试未锁定、缺失或失败项。',
        ],
  };
}

function inspectDirector(document, input) {
  const node = requireNode(document, input.nodeId || input.storyNodeId || input.story, ['director-storyboard', 'story']);
  if (node.type === 'story') {
    const project = record(nodeData(node).storyProject);
    return {
      kind: 'story',
      nodeId: node.id,
      storyId: text(project.storyId, 160),
      storyRevision: integer(project.storyRevision, 1, 1, Number.MAX_SAFE_INTEGER),
      shots: storyShots(project),
      linkedDirectorNodeId: text(project.linkedDirectorNodeId, 160) || null,
    };
  }
  const shots = Array.isArray(nodeData(node).shots) ? nodeData(node).shots : [];
  return {
    kind: 'director',
    nodeId: node.id,
    sourceStoryNodeId: text(nodeData(node).sourceStoryNodeId, 160) || null,
    shots: shots.map((shot, index) => ({
      id: text(shot.id, 160) || `shot-${index + 1}`,
      title: text(shot.title, 160),
      durationSec: integer(shot.durationSec, 5, 1, 120),
      status: text(shot.status, 80) || (shot.videoUrl ? 'done' : 'idle'),
      hasVideo: Boolean(shot.videoUrl),
      error: text(shot.error, 1_000),
    })),
  };
}

function deliveryManifest(document, input) {
  const node = requireNode(document, input.nodeId || input.to, ['video-edit']);
  const data = nodeData(node);
  const clips = Array.isArray(data.clips) ? data.clips : [];
  const output = record(data.output);
  const rawVideoUrl = text(output.videoUrl || data.videoUrl, 2_000);
  const videoUrl = safeReferenceUrl(rawVideoUrl);
  const missing = clips.filter((clip) => !safeReferenceUrl(clip.url) || ['missing', 'error', 'failed'].includes(String(clip.status || '').toLowerCase()));
  const job = clone(record(data.job));
  const jobStatus = String(job.status || '').toLowerCase();
  const jobSucceeded = ['completed', 'succeeded', 'success', 'done'].includes(jobStatus);
  const outputVersions = Array.isArray(data.outputVersions) ? clone(data.outputVersions).slice(-20) : [];
  const contentHash = text(output.contentHash || data.contentHash, 200);
  const assetId = text(output.assetId || data.assetId, 160);
  const persisted = Boolean(assetId && contentHash);
  const blockers = [
    ...(!clips.length ? ['剪辑台没有镜头素材'] : []),
    ...(!rawVideoUrl ? ['尚未生成成片'] : []),
    ...(rawVideoUrl && !videoUrl ? ['成片地址未通过安全引用校验'] : []),
    ...(missing.length ? [`${missing.length} 个镜头素材缺失、损坏或地址不安全`] : []),
    ...(!jobSucceeded ? [jobStatus
      ? `成片任务尚未成功结束（当前：${jobStatus}）`
      : '缺少成片任务成功证据'] : []),
    ...(!persisted ? ['缺少成片 assetId/contentHash，不能证明已持久化'] : []),
    ...(['failed', 'error'].includes(jobStatus)
      ? [excerpt(job.message || data.error, 1_000) || '成片任务失败'] : []),
  ];
  return {
    schema: 't8-creative-delivery-manifest-v2',
    nodeId: node.id,
    ready: Boolean(videoUrl) && missing.length === 0 && jobSucceeded && persisted,
    output: videoUrl ? {
      videoUrl,
      name: text(output.name || data.fileName, 240),
      duration: Number(output.duration || 0) || null,
      width: Number(output.width || 0) || null,
      height: Number(output.height || 0) || null,
      mime: text(data.mime, 120) || 'video/mp4',
      assetId,
      contentHash,
    } : null,
    sourceClipCount: clips.length,
    missingClipIds: missing.map((clip) => text(clip.id, 160)).filter(Boolean),
    sourceEvidence: clips.map((clip) => ({
      clipId: text(clip.id, 160),
      shotId: text(clip.shotId, 160) || null,
      status: text(clip.status, 80) || 'unknown',
      url: safeReferenceUrl(clip.url) || null,
      assetId: text(clip.assetId, 160) || null,
      contentHash: text(clip.contentHash, 200) || null,
    })),
    job,
    outputVersions,
    verification: {
      safeOutputReference: Boolean(videoUrl),
      sourceClipsAvailable: clips.length > 0 && missing.length === 0,
      jobSucceeded,
      persisted,
      browserDecodable: data.playbackVerified === true,
    },
    blockers,
    nextActions: videoUrl
      ? ['在输出节点或剪辑台预览并下载；如需新版本，先保留当前 outputVersions 再重新合成。']
      : ['打开剪辑台检查缺失镜头、时长、画幅和音频；确认后由用户手动启动合成。'],
  };
}

function readSettingsProviders(settingsFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return normalizeAdvancedProviders(parsed?.advancedProviders);
  } catch (_) {
    return normalizeAdvancedProviders(DEFAULT_ADVANCED_PROVIDERS);
  }
}

function modelCatalog(document, input = {}, options = {}) {
  const kind = text(input.kind, 40).toLowerCase();
  const query = text(input.query, 240).toLowerCase();
  const items = new Map();
  const add = (rawKind, model, provider, source, configured = false, parameters = {}) => {
    const normalizedModel = text(model, 240);
    const normalizedKind = text(rawKind, 40).toLowerCase();
    if (!normalizedModel || !['llm', 'image', 'video', 'audio'].includes(normalizedKind)) return;
    const id = `${normalizedKind}:${text(provider, 120) || 'builtin'}:${normalizedModel}`;
    items.set(id, {
      id,
      kind: normalizedKind,
      model: normalizedModel,
      provider: text(provider, 120) || 'builtin',
      source,
      configured,
      parameters,
    });
  };
  const schemaTypes = new Map(nodeSchemaManifest.types.map((item) => [item.type, item]));
  const imageDefaults = record(schemaTypes.get('image')?.generation?.defaults);
  for (const supportedKind of ['llm', 'image', 'video', 'audio']) {
    for (const item of creativeModelCatalog[supportedKind] || []) {
      add(
        supportedKind,
        item.model,
        item.provider,
        'desktop-creative-catalog',
        true,
        record(item.parameters),
      );
    }
  }
  add('image', imageDefaults.model, 'zhenzhen', 'desktop-node-schema', true, {
    aspectRatio: imageDefaults.aspectRatio,
    sizeLevel: imageDefaults.sizeLevel,
    quality: imageDefaults.gptImageQuality,
    moderation: imageDefaults.gptImageModeration,
  });
  for (const node of document.nodes || []) {
    const data = nodeData(node);
    const inferredKind = node.type === 'llm' ? 'llm'
      : ['image', 'edit'].includes(node.type) ? 'image'
        : ['video', 'seedance', 'director-storyboard'].includes(node.type) ? 'video'
          : node.type === 'audio' ? 'audio' : '';
    if (!inferredKind) continue;
    add(
      inferredKind,
      data.providerModel || data.selectedModel || data.seedanceNzModel || data.model,
      data.providerId || data.providerSource || 'builtin',
      'current-canvas',
      true,
    );
  }
  const providers = providerRecords(options);
  providers.forEach((provider) => {
    (provider.chatModels || []).forEach((model) => add('llm', model, provider.id, 'configured-provider', provider.enabled === true));
    (provider.imageModels || []).forEach((model) => add('image', model, provider.id, 'configured-provider', provider.enabled === true));
    (provider.videoModels || []).forEach((model) => add('video', model, provider.id, 'configured-provider', provider.enabled === true));
  });
  const filtered = [...items.values()]
    .filter((item) => !kind || item.kind === kind)
    .filter((item) => !query || `${item.model} ${item.provider} ${item.kind}`.toLowerCase().includes(query))
    .sort((left, right) => Number(right.configured) - Number(left.configured)
      || left.kind.localeCompare(right.kind)
      || left.provider.localeCompare(right.provider)
      || left.model.localeCompare(right.model));
  return {
    schema: 't8-agent-model-catalog-v1',
    basis: ['desktop-creative-catalog', 'desktop-node-schema', 'current-canvas', 'configured-provider'],
    sourceDigest: creativeModelCatalog.sourceDigest || '',
    platforms: creativeModelCatalog.platforms || [],
    actions: (creativeModelCatalog.actions || [])
      .filter((item) => !kind || item.kind === kind)
      .filter((item) => !query || `${item.action} ${item.label} ${item.family} ${item.provider}`.toLowerCase().includes(query)),
    items: filtered.slice(0, 500),
    total: filtered.length,
    warning: '这里只列出当前桌面 Schema、画布或已配置 Provider 能证明存在的模型；不会猜测未配置模型。',
  };
}

function createAgentControlCreativeService(options = {}) {
  const database = options.database;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const plans = new Map();

  function cleanup() {
    const current = now();
    for (const [id, plan] of plans) if (plan.expiresAt <= current) plans.delete(id);
  }

  function documentFor(scope) {
    const document = database?.getCanvas?.(String(scope.canvasId || ''));
    if (!document || String(document.projectId || '') !== String(scope.projectId || '')) {
      throw new AgentControlCreativeError('CREATIVE_SCOPE_NOT_FOUND', '创作目标不存在或不属于当前项目', 404);
    }
    return document;
  }

  function publicPlan(plan) {
    const referenceBreakdownDocument = (plan.productionDocuments || [])
      .find((item) => item?.kind === 'reference-breakdown');
    const referenceBreakdownContent = record(referenceBreakdownDocument?.content);
    const referenceBreakdownEvidenceRecord = record(referenceBreakdownContent.resultEvidence);
    const referenceBreakdownNodeId = text(referenceBreakdownEvidenceRecord.sourceNodeId, 160);
    const referenceBreakdownShots = Array.isArray(referenceBreakdownContent.shots)
      ? referenceBreakdownContent.shots
      : [];
    const proposedNodes = (plan.patch?.operations || [])
      .filter((operation) => operation?.type === 'node.add' && operation.payload?.node?.id)
      .map((operation) => ({
        id: String(operation.payload.node.id),
        type: String(operation.payload.node.type || ''),
      }));
    const affectedNodeIds = unique((plan.patch?.operations || []).flatMap((operation) => {
      const payload = record(operation?.payload);
      return [
        payload.nodeId,
        payload.node?.id,
        payload.source,
        payload.target,
        payload.edge?.source,
        payload.edge?.target,
      ];
    }));
    const proposedStory = proposedNodes.find((node) => node.type === 'story');
    const preferredPrimaryTypes = {
      image: ['image'],
      'edit-image': ['image'],
      video: ['seedance', 'fal-toolbox'],
      'edit-video': ['seedance', 'fal-toolbox'],
      audio: ['audio', 'grok-oauth-agent'],
      script: ['llm'],
      story: ['story'],
    };
    const proposedPrimary = (preferredPrimaryTypes[plan.kind] || [])
      .map((type) => proposedNodes.find((node) => node.type === type))
      .find(Boolean)
      || proposedNodes.find((node) => !['text', 'output', 'upload'].includes(node.type))
      || proposedNodes[0];
    const proposedStoryProject = proposedStory
      ? plan.patch.operations.find((operation) => operation?.type === 'node.add'
          && operation.payload?.node?.id === proposedStory.id)?.payload?.node?.data?.storyProject
      : null;
    return {
      schema: CREATIVE_PLAN_SCHEMA,
      planId: plan.id,
      planDigest: plan.planDigest,
      projectId: plan.projectId,
      canvasId: plan.canvasId,
      canvasRevision: plan.canvasRevision,
      action: plan.action,
      kind: plan.kind,
      profile: plan.profile,
      profileLabel: PROFILES[plan.profile].label,
      brief: clone(plan.brief),
      productionDocuments: clone(plan.productionDocuments || []),
      questions: clone(plan.questions),
      ready: plan.ready,
      candidateCount: plan.candidateCount,
      strategy: clone(plan.strategy),
      impact: clone(plan.impact),
      visibleAssumptions: {
        durationSec: plan.brief?.durationSec || 0,
        ratio: plan.brief?.ratio || '',
        audience: plan.brief?.audience || '',
        style: plan.brief?.style || '',
        language: plan.brief?.language || '',
        models: {
          llm: {
            provider: plan.brief?.llmProvider || plan.brief?.llmProviderSource || plan.brief?.provider || '',
            model: plan.brief?.llmModel || '',
          },
          image: {
            provider: plan.brief?.imageProvider || plan.brief?.imageProviderSource || plan.brief?.provider || '',
            model: plan.brief?.imageModel || '',
          },
          video: {
            provider: plan.brief?.videoProvider || plan.brief?.videoProviderSource || plan.brief?.provider || '',
            model: plan.brief?.videoModel || '',
          },
          audio: {
            provider: plan.brief?.audioProvider || plan.brief?.audioProviderSource || plan.brief?.provider || '',
            model: plan.brief?.audioModel || '',
          },
        },
        editableByNaturalLanguage: true,
        message: '这是系统根据原话、配方和当前配置形成的可见假设；创作者可用一句自然语言修改。',
      },
      modelDecisionReceipt: plan.modelDecisionReceipt ? clone(plan.modelDecisionReceipt) : null,
      patchId: plan.patch?.id || null,
      targets: {
        primaryNodeId: referenceBreakdownNodeId || proposedStory?.id || proposedPrimary?.id || '',
        storyNodeId: proposedStory?.id || '',
        affectedNodeIds: unique([...affectedNodeIds, referenceBreakdownNodeId]),
        proposedNodes,
      },
      analysis: plan.brief?.recipe === 'shot-breakdown' ? {
        source: 'reference-video',
        sourceAssetCount: plan.brief?.reuseAssetIds?.length || 0,
        sceneCount: 0,
        shotCount: referenceBreakdownShots.length,
        assetCount: plan.brief?.reuseAssetIds?.length || 0,
        audioItemCount: 0,
        stage: 'shots',
        generationStarted: false,
        analysisRunStarted: Boolean(referenceBreakdownNodeId),
        status: referenceBreakdownContent.status || 'workflow-ready',
        evidenceNodeId: referenceBreakdownNodeId,
        evidenceDigest: text(referenceBreakdownEvidenceRecord.outputDigest, 160),
        runBindingStatus: text(referenceBreakdownEvidenceRecord.runBindingStatus, 80),
        runId: text(referenceBreakdownEvidenceRecord.runId, 160),
        nodeRunId: text(referenceBreakdownEvidenceRecord.nodeRunId, 160),
        attemptId: text(referenceBreakdownEvidenceRecord.attemptId, 160),
        runStatus: text(referenceBreakdownEvidenceRecord.runStatus, 80),
        nodeRunStatus: text(referenceBreakdownEvidenceRecord.nodeRunStatus, 80),
        attemptStatus: text(referenceBreakdownEvidenceRecord.attemptStatus, 80),
        runEvidenceReason: text(referenceBreakdownEvidenceRecord.runEvidenceReason, 1000),
        error: text(referenceBreakdownContent.analysisError, 1000),
      } : proposedStoryProject ? {
        source: proposedStoryProject.analysisSource || 'none',
        sceneCount: proposedStoryProject.scenes?.length || 0,
        shotCount: proposedStoryProject.shots?.length || 0,
        assetCount: proposedStoryProject.assets?.length || 0,
        audioItemCount: proposedStoryProject.audioPlan?.items?.length || 0,
        coverage: clone(proposedStoryProject.coverage),
        stage: proposedStoryProject.stage || 'script',
        generationStarted: false,
      } : null,
      createdAt: new Date(plan.createdAt).toISOString(),
      expiresAt: new Date(plan.expiresAt).toISOString(),
    };
  }

  function savePlan(raw) {
    cleanup();
    if (plans.size >= CREATIVE_PLAN_LIMIT) {
      throw new AgentControlCreativeError('CREATIVE_PLAN_LIMIT_REACHED', '待处理创作计划过多，请先完成已有计划', 429);
    }
    raw.planDigest = digest({
      action: raw.action,
      kind: raw.kind,
      projectId: raw.projectId,
      canvasId: raw.canvasId,
      canvasRevision: raw.canvasRevision,
      brief: raw.brief,
      productionDocuments: raw.productionDocuments || [],
      modelDecisionReceipt: raw.modelDecisionReceipt || null,
      patch: raw.patch,
    });
    plans.set(raw.id, raw);
    return publicPlan(raw);
  }

  function createPlan(input = {}, scope = {}) {
    const document = documentFor(scope);
    const action = text(input.action, 80) || 'create';
    const kind = text(input.kind, 40).toLowerCase();
    if (!CREATIVE_PLAN_KINDS.includes(kind)) {
      throw new AgentControlCreativeError('CREATIVE_KIND_UNSUPPORTED', `创作类型无效：${kind || '未提供'}`);
    }
    const normalizedInput = applyCreatorRecipe(applyNaturalCreativeDefaults(input));
    const profile = profileFor(normalizedInput.profile);
    const brief = resolveBriefProviders(
      creativeBrief(kind === 'plan-card' ? text(normalizedInput.targetKind, 40) || 'image' : kind, normalizedInput, profile),
      options,
    );
    const questions = creatorQuestions(brief.kind, normalizedInput);
    const ready = questions.length === 0;
    const candidateCount = integer(normalizedInput.candidates, PROFILES[profile].candidates, 1, 8);
    let modelDecisionReceipt = null;
    if (normalizedInput.modelDecisionReceipt != null) {
      try {
        modelDecisionReceipt = clone(assertCreatorModelDecisionReceipt(normalizedInput.modelDecisionReceipt));
      } catch (error) {
        throw new AgentControlCreativeError(
          'CREATOR_MODEL_DECISION_RECEIPT_INVALID',
          `模型选择回执无效：${text(error?.message, 500) || '请重新生成计划'}`,
          409,
        );
      }
    }
    const createdAt = now();
    const id = crypto.randomUUID();
    const productionDocuments = productionDocumentsForPlan(
      document,
      id,
      brief,
      normalizedInput.previousProductionDocuments,
      normalizedInput.artifactVerifications,
      normalizedInput.deliveryEvidence,
      database,
      { stagedProduction: normalizedInput.stagedProduction === true },
    );
    const referenceBreakdownDocument = productionDocuments
      .find((item) => item?.kind === 'reference-breakdown');
    const referenceBreakdownStatus = String(referenceBreakdownDocument?.content?.status || '');
    const existingReferenceWorkflow = kind === 'story'
      && brief.recipe === 'shot-breakdown'
      && !['', 'awaiting-source-video', 'awaiting-analysis-run'].includes(referenceBreakdownStatus);
    const patch = ready && kind !== 'plan-card' && !existingReferenceWorkflow
      ? createPatch(document, id, kind, brief, candidateCount, { ...options, database, productionDocuments })
      : null;
    const planAction = existingReferenceWorkflow
      ? referenceBreakdownStatus === 'analysis-result-ready'
        ? 'review.reference-breakdown'
        : 'recover.reference-breakdown'
      : kind === 'plan-card'
        ? 'plan-card'
        : `create.${kind}`;
    return savePlan({
      id,
      action: planAction,
      kind,
      profile,
      brief,
      productionDocuments,
      modelDecisionReceipt,
      questions,
      ready,
      candidateCount,
      patch,
      projectId: String(scope.projectId || ''),
      canvasId: String(scope.canvasId || ''),
      canvasRevision: Number(document.revision),
      actorId: String(scope.actorId || ''),
      sessionId: String(scope.sessionId || ''),
      strategy: {
        previewFirst: true,
        previewGuidance: PROFILES[profile].preview,
        compareBeforeAccept: candidateCount > 1,
        preserveAcceptedVersions: true,
        generateScope: 'missing-failed-unlocked',
        autoRunGeneration: false,
        continuityLocks: [...CREATIVE_LOCK_KEYS],
      },
      impact: {
        writesNow: 0,
        providerCallsNow: 0,
        fileWritesNow: 0,
        patchOperationCount: patch?.operations?.length || 0,
      },
      createdAt,
      expiresAt: createdAt + CREATIVE_PLAN_TTL_MS,
    });
  }

  function actionPlan(action, input = {}, scope = {}) {
    if (!CREATIVE_ACTIONS.includes(action)) {
      throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此创作操作');
    }
    const document = documentFor(scope);
    const createdAt = now();
    const id = crypto.randomUUID();
    let patch;
    let summary;
    if (CREATIVE_ITERATE_ACTIONS.includes(action)) {
      patch = iteratePatch(document, id, action, input);
      summary = patch.summary;
    } else if (action === 'graph.node-add') {
      patch = graphNodeAddPatch(document, database, id, input);
      summary = patch.summary;
    } else if (action === 'production.continue') {
      patch = productionContinuePatch(document, id, input);
      summary = patch.summary;
    } else if (LOCALIZATION_ACTIONS.includes(action)) {
      patch = localizationActionPatch(document, id, action, input);
      summary = patch.summary;
    } else if (Object.prototype.hasOwnProperty.call(LOCAL_UTILITY_ACTIONS, action)) {
      patch = localUtilityPatch(document, id, action, input);
      summary = patch.summary;
    } else if (action === 'story.analyze') {
      patch = storyAction(() => storyCreative.analyzePatch(document, id, input));
      summary = patch.summary;
    } else if (action === 'story.import') {
      patch = storyAction(() => storyCreative.importPatch(document, id, input));
      summary = patch.summary;
    } else if (action === 'story.bind-asset') {
      patch = storyAction(() => storyCreative.bindAssetPatch(document, database, id, input));
      summary = patch.summary;
    } else if (action === 'story.compile') {
      patch = storyAction(() => storyCreative.compilePatch(document, id, input));
      summary = patch.summary;
    } else if (action === 'story.plan-previews') {
      patch = storyAction(() => storyCreative.previewPatch(document, id, input));
      summary = patch.summary;
    } else if (action === 'story.adopt-preview') {
      patch = storyAction(() => storyCreative.adoptPreviewPatch(document, id, input));
      summary = patch.summary;
    } else if (action === 'director.materialize') {
      patch = directorPatch(document, id, input);
      summary = patch.summary;
    } else if (action === 'video-edit.compose') {
      patch = videoEditPatch(document, id, input);
      summary = patch.summary;
    } else {
      throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此创作操作');
    }
    return savePlan({
      id,
      action,
      kind: action.split('.')[0],
      profile: 'custom',
      brief: { goal: summary, summary },
      questions: [],
      ready: true,
      candidateCount: 1,
      patch,
      projectId: String(scope.projectId || ''),
      canvasId: String(scope.canvasId || ''),
      canvasRevision: Number(document.revision),
      actorId: String(scope.actorId || ''),
      sessionId: String(scope.sessionId || ''),
      strategy: {
        previewFirst: true,
        preserveAcceptedVersions: true,
        autoRunGeneration: false,
      },
      impact: {
        writesNow: 0,
        providerCallsNow: 0,
        fileWritesNow: 0,
        patchOperationCount: patch.operations.length,
      },
      createdAt,
      expiresAt: createdAt + CREATIVE_PLAN_TTL_MS,
    });
  }

  function requirePlan(planId, scope = {}) {
    cleanup();
    const plan = plans.get(String(planId || ''));
    if (!plan) throw new AgentControlCreativeError('CREATIVE_PLAN_NOT_FOUND', '创作计划不存在或已过期，请重新规划', 404);
    if (plan.projectId !== String(scope.projectId || '')
      || plan.canvasId !== String(scope.canvasId || '')
      || plan.actorId !== String(scope.actorId || '')
      || plan.sessionId !== String(scope.sessionId || '')) {
      throw new AgentControlCreativeError('CREATIVE_PLAN_SCOPE_MISMATCH', '创作计划不属于当前 Agent 会话或画布', 403);
    }
    if (!plan.ready || !plan.patch) {
      throw new AgentControlCreativeError(
        'CREATIVE_PLAN_NEEDS_INPUT',
        '创作计划还有关键问题未确认，不会创建空白或含糊工作流',
        409,
        { questions: clone(plan.questions) },
      );
    }
    const document = documentFor(scope);
    if (Number(document.revision) !== Number(plan.canvasRevision)) {
      throw new AgentControlCreativeError(
        'CREATIVE_CANVAS_STALE',
        '画布已变化，请重新规划，避免覆盖创作者刚刚的修改',
        409,
        { currentRevision: Number(document.revision) },
      );
    }
    return plan;
  }

  function readAction(action, input = {}, scope = {}) {
    if (!CREATIVE_READ_ACTIONS.includes(action)) {
      throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此只读创作操作');
    }
    const document = documentFor(scope);
    if (action === 'compare') return compareCandidates(document, input);
    if (action === 'story.inspect') return storyAction(() => storyCreative.inspect(document, input));
    if (action === 'director.inspect') return inspectDirector(document, input);
    if (action === 'video-edit.deliver') return deliveryManifest(document, input);
    throw new AgentControlCreativeError('CREATIVE_ACTION_UNSUPPORTED', '不支持此只读创作操作');
  }

  function models(input = {}, scope = {}) {
    return modelCatalog(documentFor(scope), input, {
      settingsFile: options.settingsFile,
      settingsProvider: options.settingsProvider,
    });
  }

  return {
    actionPlan,
    cleanup,
    createPlan,
    models,
    publicPlan,
    readAction,
    requirePlan,
  };
}

module.exports = {
  AgentControlCreativeError,
  CREATIVE_ACTIONS,
  CREATIVE_ITERATE_ACTIONS,
  CREATIVE_PLAN_KINDS,
  CREATIVE_PLAN_SCHEMA,
  CREATIVE_READ_ACTIONS,
  CREATIVE_STATE_SCHEMA,
  PROFILES,
  createAgentControlCreativeService,
  modelCatalog,
};
