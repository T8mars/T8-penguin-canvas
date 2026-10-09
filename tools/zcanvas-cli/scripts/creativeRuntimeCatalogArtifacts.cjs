'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const {
  canonicalTextBytes,
} = require('../src/canonicalTextDigest.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MODEL_SOURCE = path.join(ROOT, 'src', 'providers', 'models.ts');
const SEEDANCE_SOURCE = path.join(ROOT, 'src', 'config', 'seedance.ts');
const MIDJOURNEY_SOURCE = path.join(ROOT, 'src', 'utils', 'midjourneyNz.ts');
const SEEDANCE_NZ_LLM_SOURCE = path.join(ROOT, 'backend', 'src', 'shared', 'seedanceNzLlmModels.json');
const SEEDANCE_NZ_PROVIDER_SOURCE = path.join(ROOT, 'backend', 'src', 'providers', 'seedanceNz.js');
const SEEDREAM_NZ_CONTRACT_SOURCE = path.join(ROOT, 'backend', 'src', 'shared', 'seedreamNzContract.json');
const BACKEND_TARGET = path.join(ROOT, 'backend', 'src', 'shared', 'creativeModelCatalog.json');
const CLI_TARGET = path.join(ROOT, 'tools', 'zcanvas-cli', 'generated', 'creative-runtime-catalog.json');

const SOURCE_PATHS = [
  MODEL_SOURCE,
  SEEDANCE_SOURCE,
  MIDJOURNEY_SOURCE,
  SEEDANCE_NZ_LLM_SOURCE,
  SEEDANCE_NZ_PROVIDER_SOURCE,
  SEEDREAM_NZ_CONTRACT_SOURCE,
  path.join(ROOT, 'backend', 'src', 'shared', 'nb21FluxViduQ4Contract.json'),
];

const PLATFORM_META = Object.freeze({
  zhenzhen: {
    label: '贞贞的AI工坊',
    description: '贞贞海外模型与内置生成能力。',
  },
  'seedance-nz': {
    label: '贞贞的平价AI小屋',
    description: 'api.seedance.nz 的国内/平价模型与创作动作。',
  },
  fal: {
    label: 'FAL',
    description: '现有 FAL 兼容模型。',
  },
  'grok-oauth': {
    label: 'Grok OAuth',
    description: '本地 Grok OAuth 工作台的语音能力。',
  },
});

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const diagnostics = compiled.diagnostics || [];
  if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
    throw new Error(`cannot transpile runtime catalog source ${path.relative(ROOT, filename)}`);
  }
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

function sourceDigest() {
  const digest = crypto.createHash('sha256');
  for (const filename of SOURCE_PATHS) {
    digest.update(path.relative(ROOT, filename).replace(/\\/g, '/'));
    digest.update('\0');
    digest.update(canonicalTextBytes(fs.readFileSync(filename)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === 'function') continue;
    output[key] = compact(item);
  }
  return output;
}

function platformLabel(provider) {
  return PLATFORM_META[provider]?.label || provider;
}

function optionProvider(option, fallback, budgetModels) {
  const value = String(option?.value || option?.id || '').trim();
  const label = String(option?.label || '').trim();
  if (budgetModels.has(value)) return 'seedance-nz';
  if (/-fal$/i.test(value) || /\bFAL\b/i.test(label)) return 'fal';
  return fallback;
}

function modelEntry(kind, provider, model, label, family, parameters = {}, available = true) {
  const normalizedProvider = String(provider || '').trim();
  const normalizedModel = String(model || '').trim();
  return {
    id: `${kind}:${normalizedProvider}:${normalizedModel}`,
    provider: normalizedProvider,
    platformLabel: platformLabel(normalizedProvider),
    model: normalizedModel,
    label: String(label || normalizedModel).trim(),
    family: String(family || '').trim(),
    available: available !== false,
    parameters: compact({
      label: String(label || normalizedModel).trim(),
      platformLabel: platformLabel(normalizedProvider),
      family: String(family || '').trim(),
      available: available !== false,
      ...parameters,
    }),
  };
}

function actionEntry(kind, provider, action, label, family, resultKind, parameters = {}) {
  const normalizedProvider = String(provider || '').trim();
  const normalizedAction = String(action || '').trim();
  return {
    id: `${kind}:${normalizedProvider}:${normalizedAction}`,
    kind,
    provider: normalizedProvider,
    platformLabel: platformLabel(normalizedProvider),
    action: normalizedAction,
    label: String(label || normalizedAction).trim(),
    family: String(family || '').trim(),
    resultKind: String(resultKind || '').trim(),
    parameters: compact(parameters),
  };
}

function deduplicate(items) {
  const unique = new Map();
  for (const item of items) {
    if (!item?.id || (!item.model && !item.action)) continue;
    unique.set(item.id, item);
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildRuntimeCatalog() {
  const models = loadTypeScriptModule(MODEL_SOURCE);
  const seedance = loadTypeScriptModule(SEEDANCE_SOURCE);
  const midjourney = loadTypeScriptModule(MIDJOURNEY_SOURCE);
  const seedanceNz = require(SEEDANCE_NZ_PROVIDER_SOURCE);
  const seedanceNzLlmModels = JSON.parse(fs.readFileSync(SEEDANCE_NZ_LLM_SOURCE, 'utf8'));
  const budgetImageModels = new Set([
    ...(models.ZHENZHEN_BUDGET_IMAGE_MODELS || []),
    ...(models.QWEN_IMAGE_30_MODELS || []),
    ...(models.SEEDREAM_LAYER_DECOMPOSITION_MODELS || []),
    ...(models.WAN27_GLOBAL_IMAGE_MODELS || []),
  ].map(String));
  const budgetVideoModels = new Set([
    ...(seedanceNz.ZHENZHEN_APIMART_VIDEO_MODELS || []),
  ].map(String));
  const seedanceNzVideoKinds = new Set(['wan', 'happyhorse', 'hailuo', 'vidu', 'kling', 'upscaler', 'seedance25']);

  const llm = [];
  for (const item of models.LLM_MODELS || []) {
    llm.push(modelEntry(
      'llm',
      'zhenzhen',
      item.id,
      item.label,
      'llm',
      {
        vision: item.vision === true,
        imageOutput: item.imageOutput === true,
        nonStreaming: item.nonStreaming === true,
        contextLength: item.contextLength,
        description: item.description,
      },
    ));
  }
  for (const model of seedanceNzLlmModels) {
    llm.push(modelEntry('llm', 'seedance-nz', model, model, 'llm'));
  }
  for (const model of seedanceNz.MINMAX_H3_CONTEXT_IR_MODELS || []) {
    llm.push(modelEntry(
      'llm',
      'seedance-nz',
      model,
      model,
      'minimax-h3-context-ir',
      {
        asynchronous: true,
        outputKind: 'text',
        inputKinds: model === seedanceNz.MINMAX_H3_CONTEXT_IR_TEXT_MODEL
          ? ['text']
          : model === seedanceNz.MINMAX_H3_CONTEXT_IR_IMAGE_MODEL
            ? ['text', 'image']
            : ['text', 'image', 'video', 'audio'],
      },
    ));
  }

  const image = [];
  for (const family of models.IMAGE_MODELS || []) {
    for (const option of family.apiModelOptions || [{ value: family.apiModel, label: family.label }]) {
      const provider = optionProvider(option, 'zhenzhen', budgetImageModels);
      image.push(modelEntry(
        'image',
        provider,
        option.value,
        option.label,
        family.id,
        {
          tabLabel: family.tabLabel,
          capabilities: family.capabilities,
          parameterKind: option.paramKind || family.paramKind,
          aspectRatios: family.aspectRatios,
          defaultAspectRatio: family.defaultAspectRatio,
          sizes: option.sizes || family.sizes,
          defaultSize: option.sizes?.[0] || family.defaultSize,
          supportsReference: family.supportsReference === true,
          maxReferenceImages: option.maxReferenceImages ?? family.maxReferenceImages,
          description: family.description,
        },
        option.disabled !== true,
      ));
    }
  }
  for (const rawModel of seedanceNz.IMAGE_MODELS || []) {
    const model = String(rawModel || '').trim();
    if (!model) continue;
    const family = model === seedanceNz.FLUX3_IMAGE_MODEL ? 'flux-3-image'
      : seedanceNz.QWEN_IMAGE_30_MODELS?.has(model)
      ? 'qwen-image-3.0'
      : model === seedanceNz.VOSR2_IMAGE_UPSCALE_MODEL
        ? 'vosr2-image-upscale'
      : seedanceNz.SEEDREAM_LAYER_DECOMPOSITION_MODELS?.has(model)
        ? 'seedream-layer-decomposition'
        : seedanceNz.WAN27_GLOBAL_IMAGE_MODELS?.has(model)
          ? 'wan-image'
      : seedanceNz.ZHENZHEN_IMAGE_G2_MODELS?.has(model)
      || model === seedanceNz.ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL
      || seedanceNz.ZHENZHEN_IMAGE_G25_MODELS?.has(model)
      ? 'gpt-image-2'
      : model === seedanceNz.ZHENZHEN_IMAGE_NB_PRO_MODEL
        ? 'nano-banana-pro'
        : model === seedanceNz.ZHENZHEN_IMAGE_NB_2_MODEL
          || model === seedanceNz.ZHENZHEN_IMAGE_NB_21_MODEL
          || model === seedanceNz.ZHENZHEN_IMAGE_NB_2_LITE_MODEL
          ? 'nano-banana-2'
      : model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_MODEL
        || model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL
        || model === seedanceNz.ZHENZHEN_IMAGE_GK_V15_MODEL
        || model === seedanceNz.ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL
        ? 'grok-image'
        : model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL
          || model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL
          ? 'grok-image-tools'
        : 'seedream-v5-pro';
    const maxReferenceImages = family === 'flux-3-image' ? 10 : family === 'seedream-layer-decomposition' || family === 'vosr2-image-upscale'
      ? 1
      : family === 'qwen-image-3.0'
        ? (model.endsWith('-i2i') ? 3 : 0)
        : family === 'wan-image'
          ? (model === seedanceNz.WAN27_GLOBAL_T2I_MODEL ? 0 : 9)
      : model.endsWith('-t2i')
      ? 0
      : model.endsWith('-i2i')
        ? 10
        : seedanceNz.ZHENZHEN_IMAGE_G25_MODELS?.has(model)
          ? (model === seedanceNz.ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL ? 15 : 16)
        : family === 'nano-banana-2' || family === 'nano-banana-pro'
          ? 14
            : model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_MODEL
              || model === seedanceNz.ZHENZHEN_IMAGE_GK_V15_MODEL
            ? 0
            : model === seedanceNz.ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL
              ? 1
              : model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL
                ? 3
              : undefined;
    image.push(modelEntry(
      'image',
      'seedance-nz',
      model,
      model,
      family,
      {
        tabLabel: family === 'flux-3-image' ? 'Flux' : family === 'grok-image' || family === 'grok-image-tools'
          ? 'Grok'
          : family === 'wan-image'
            ? 'Wan Image'
            : family === 'qwen-image-3.0'
              ? 'Qwen Image'
              : family === 'seedream-layer-decomposition'
                ? 'Seedream分层'
              : family === 'vosr2-image-upscale'
                ? 'Vosr2'
          : family === 'nano-banana-2'
            ? '香蕉2'
            : family === 'nano-banana-pro'
              ? '香蕉Pro'
              : family === 'seedream-v5-pro' ? 'Seedream' : 'GPT2',
        capabilities: family === 'grok-image-tools'
          ? (model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL ? ['segment', 'metadata'] : ['region-edit', 'edit'])
          : family === 'seedream-layer-decomposition'
          ? ['i2i', 'edit']
          : family === 'vosr2-image-upscale'
            ? ['i2i']
          : maxReferenceImages === 0 ? ['t2i'] : ['t2i', 'i2i', 'edit'],
        parameterKind: family === 'flux-3-image' ? 'flux-image' : family === 'grok-image-tools'
          ? (model === seedanceNz.ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL ? 'grok-segment' : 'grok-region-edit')
          : seedanceNz.ZHENZHEN_IMAGE_G25_MODELS?.has(model)
            ? (model === seedanceNz.ZHENZHEN_IMAGE_G25_LOWPRICE_MODEL
              ? 'image-g-v2.5-lowprice'
              : 'image-g-v2.5-official')
          : family === 'seedream-v5-pro'
          ? 'seedream-v5'
          : family === 'qwen-image-3.0'
            ? 'qwen-image-3.0'
            : family === 'seedream-layer-decomposition'
              ? 'seedream-layer'
              : family === 'vosr2-image-upscale'
                ? 'vosr2-upscale'
              : family === 'wan-image'
                ? 'wan-image'
                : 'seedance-nz-image',
        supportsReference: maxReferenceImages !== 0,
        maxReferenceImages,
        ...(model === seedanceNz.FLUX3_IMAGE_MODEL || model === seedanceNz.ZHENZHEN_IMAGE_NB_21_MODEL
          ? (() => {
            const contract = require(path.join(ROOT, 'backend/src/shared/nb21FluxViduQ4Contract.json'));
            const specification = model === seedanceNz.FLUX3_IMAGE_MODEL ? contract.flux : contract.banana21;
            return { sizes: specification.resolutions, aspectRatios: specification.ratios,
              defaultSize: '1k', defaultAspectRatio: model === seedanceNz.FLUX3_IMAGE_MODEL ? 'auto' : '1:1', maxOutputs: 1 };
          })() : {}),
        description: '贞贞的平价AI小屋图像模型',
      },
    ));
  }

  const video = [];
  for (const family of models.VIDEO_MODELS || []) {
    const familyBudget = seedanceNzVideoKinds.has(family.kind);
    for (const option of family.apiModelOptions || []) {
      const provider = optionProvider(
        option,
        familyBudget ? 'seedance-nz' : 'zhenzhen',
        budgetVideoModels,
      );
      video.push(modelEntry(
        'video',
        provider,
        option.value,
        option.label,
        family.id,
        {
          nodeKind: family.kind,
          ratios: option.ratios ?? family.ratios,
          defaultRatio: option.defaultRatio ?? family.defaultRatio,
          durations: option.durations ?? family.durations,
          defaultDuration: option.defaultDuration ?? family.defaultDuration,
          resolutions: option.resolutions ?? family.resolutions,
          defaultResolution: option.defaultResolution ?? family.defaultResolution,
          supportsImages: option.supportImages ?? (family.supportImages === true),
          supportsVideos: option.supportVideos ?? (family.supportVideos === true),
          supportsAudios: option.supportAudios === true,
          maxReferenceImages: option.maxRefImages ?? family.maxRefImages,
          maxReferenceVideos: option.maxRefVideos ?? (family.supportVideos === true ? 1 : 0),
          maxReferenceAudios: option.maxRefAudios ?? 0,
          description: option.description ?? family.description,
        },
        option.disabled !== true,
      ));
    }
  }
  for (const option of seedance.LEGACY_SEEDANCE_MODEL_OPTIONS || []) {
    video.push(modelEntry('video', 'zhenzhen', option.value, option.label, 'seedance-2.0', {
      apiSource: 'zhenzhen-legacy',
    }));
  }
  for (const option of seedance.SEEDANCE_NZ_MODEL_OPTIONS || []) {
    video.push(modelEntry('video', 'seedance-nz', option.value, option.label, 'seedance-2.0', {
      apiSource: 'seedance-nz',
    }));
  }

  const audio = [];
  for (const item of models.AUDIO_MODELS || []) {
    audio.push(modelEntry('audio', 'zhenzhen', item.id, item.label, 'suno', {
      mode: item.mode,
      description: item.description,
    }));
  }
  audio.push(
    modelEntry('audio', 'seedance-nz', seedanceNz.SEED_AUDIO_MODEL, seedanceNz.SEED_AUDIO_MODEL, 'seed-audio'),
    modelEntry('audio', 'seedance-nz', seedanceNz.WHISPER_MODEL, seedanceNz.WHISPER_MODEL, 'whisper'),
    modelEntry('audio', 'seedance-nz', 'suno', 'Suno 31 项动作', 'suno'),
    modelEntry('audio', 'grok-oauth', 'xai-tts', 'Grok TTS', 'grok-oauth'),
    modelEntry('audio', 'grok-oauth', 'xai-stt', 'Grok STT', 'grok-oauth'),
  );
  for (const model of seedanceNz.QWEN3_TTS_MODELS || []) {
    audio.push(modelEntry('audio', 'seedance-nz', model, model, 'qwen3-tts'));
  }
  for (const model of seedanceNz.MINIMAX_AUDIO_MODELS || []) {
    audio.push(modelEntry('audio', 'seedance-nz', model, model, 'minimax'));
  }
  for (const model of seedanceNz.MUREKA_BGM_MODELS || []) {
    audio.push(modelEntry('audio', 'seedance-nz', model, model, 'mureka', {
      orderedMultiOutput: true,
      maxOutputs: 3,
    }));
  }
  audio.push(modelEntry('audio', 'seedance-nz', seedanceNz.FLOWMUSIC_MODEL, 'Lyria / Flow Music', 'lyria', {
    description: 'Flow Music 官方九项音乐创作与处理能力；请求 model 固定为 flowmusic',
  }));

  const actions = [];
  for (const model of seedanceNz.HUNYUAN3D_MODELS || []) {
    actions.push(actionEntry('model3d', 'seedance-nz', model, model, 'hunyuan-3d', 'model3d', {
      tab: 'Hunyuan 3D',
      endpoint: '/v1/3d/generations',
      orderedImageViews: model === seedanceNz.HUNYUAN3D_IMAGE_MODEL ? 8 : 0,
      faceCount: { minimum: 10000, maximum: 1500000, default: 500000 },
      generateTypes: [...(seedanceNz.HUNYUAN3D_GENERATE_TYPES || [])],
      enablePbrDefault: false,
    }));
  }
  for (const item of models.SUNO_NZ_ACTIONS || []) {
    actions.push(actionEntry(
      'audio',
      'seedance-nz',
      item.value,
      item.label,
      'suno',
      item.resultFamily,
      {
        action: item.action,
        requiredFields: item.requiredFields,
        referenceType: item.referenceType,
        allowedVersions: item.allowedVersions,
        defaultVersion: item.defaultVersion,
      },
    ));
  }
  for (const [operation, spec] of Object.entries(seedanceNz.FLOWMUSIC_ACTION_SPECS || {})) {
    actions.push(actionEntry(
      spec.resultFamily === 'video' ? 'video' : spec.resultFamily === 'text' ? 'text' : 'audio',
      'seedance-nz',
      operation,
      operation,
      'lyria',
      spec.resultFamily,
      {
        action: spec.action,
        requiredFields: spec.requiredFields,
        allowedFields: spec.allowedFields,
        fixedModel: seedanceNz.FLOWMUSIC_MODEL,
        supportsLyria35: spec.supportsLyria35,
      },
    ));
  }
  for (const item of midjourney.MIDJOURNEY_NZ_ACTIONS || []) {
    actions.push(actionEntry(
      item.result === 'video' ? 'video' : item.result === 'text' ? 'text' : 'image',
      'seedance-nz',
      item.value,
      item.label,
      'midjourney',
      item.result,
      { summary: item.summary },
    ));
  }

  const catalog = {
    schema: 't8-creative-runtime-catalog-v1',
    sourceDigest: sourceDigest(),
    generatedFrom: SOURCE_PATHS.map((filename) => path.relative(ROOT, filename).replace(/\\/g, '/')),
    platforms: Object.entries(PLATFORM_META).map(([id, value]) => ({ id, ...value })),
    llm: deduplicate(llm),
    image: deduplicate(image),
    video: deduplicate(video),
    audio: deduplicate(audio),
    actions: deduplicate(actions),
  };
  catalog.counts = {
    llm: catalog.llm.length,
    image: catalog.image.length,
    video: catalog.video.length,
    audio: catalog.audio.length,
    actions: catalog.actions.length,
  };
  return catalog;
}

function runtimeCatalogArtifact(catalog = buildRuntimeCatalog()) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

module.exports = {
  BACKEND_TARGET,
  CLI_TARGET,
  SOURCE_PATHS,
  buildRuntimeCatalog,
  runtimeCatalogArtifact,
};
