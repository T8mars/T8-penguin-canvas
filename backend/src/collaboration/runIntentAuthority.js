const canvasNodeSchema = require('../shared/canvasNodeSchema.json');
const seedanceNzLlmModels = require('../shared/seedanceNzLlmModels.json');

const RUN_INTENT_AUTHORITY_SCHEMA = 't8-run-intent-authority-v1';
const MAX_CANVAS_NODES = 20_000;
const MAX_CANVAS_EDGES = 20_000;
const MAX_REQUESTED_NODE_IDS = 2_000;
const SEEDANCE_NZ_LLM_MODEL_SET = new Set(seedanceNzLlmModels);
const MINMAX_H3_CONTEXT_IR_MODEL_SET = new Set([
  'minmax-h3-context-ir-text',
  'minmax-h3-context-ir-image',
  'minmax-h3-context-ir-multimodal',
]);

const EXECUTABLE_NODE_TYPES = new Set(
  (Array.isArray(canvasNodeSchema.types) ? canvasNodeSchema.types : [])
    .filter((entry) => entry && entry.executable === true)
    .map((entry) => String(entry.type || '').trim())
    .filter(Boolean),
);

const REMOTE_UNSUPPORTED_HOST_ONLY_NODE_TYPES = new Set([
  'remove-ai-watermark',
  'topaz-image-upscale',
  'topaz-video-upscale',
]);

const LOCAL_EXECUTION_NODE_TYPES = new Set([
  'upload',
  'drawing-board',
  'image-compare',
  'frame-extractor',
  'frame-pair',
  'loop',
  'random-route',
  'pick-from-set',
  'resize',
  'combine',
  'remove-bg',
  'upscale',
  'grid-crop',
  'grid-editor',
  'edit',
  'cinematic',
  'video-motion',
  'multi-angle-visual',
  'portrait-master',
  'pose-master',
  'face-expression-3d',
]);

const IMAGE_RUNTIME_MODELS = Object.freeze({
  'gpt-image-2': {
    defaultModel: 'gpt-image-2-all',
    models: [
      'gpt-image-2-all', 'gpt-image-2', 'gpt-image-2-2K', 'gpt-image-2-4K', 'gpt-image-2-fal',
      'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2k', 'gpt-image-2.5-flare-4k',
      'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2k', 'gpt-image-2.5-sunburst-4k',
      'zhenzhen-image-g2-t2i', 'zhenzhen-image-g2-i2i', 'zhenzhen-image-g-v2-lowprice',
    ],
  },
  'nano-banana-2': {
    defaultModel: 'gemini-3.1-flash-image',
    models: [
      'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-2-fal',
      'zhenzhen-image-nb-2-lite', 'zhenzhen-image-nb-2',
    ],
  },
  'nano-banana-pro': {
    defaultModel: 'nano-banana-pro',
    models: [
      'nano-banana-pro', 'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image',
      'nano-banana-pro-fal', 'zhenzhen-image-nb-pro',
    ],
  },
  'grok-image': {
    defaultModel: 'grok-4.2-image',
    models: ['grok-4.2-image', 'zhenzhen-image-gk-v15', 'zhenzhen-image-gk-v15-edit'],
  },
  'seedream-v5-pro': {
    defaultModel: 'seedream-v5-pro',
    models: ['seedream-v5-pro'],
  },
  'qwen-image-global-2.1': {
    defaultModel: 'qwen-image-global-2.1',
    models: ['qwen-image-global-2.1'],
  },
  'vosr2-image-upscale': {
    defaultModel: 'vosr2-image-upscale',
    models: ['vosr2-image-upscale'],
  },
  midjourney: {
    defaultModel: 'midjourney',
    models: ['midjourney'],
  },
});

const VIDEO_RUNTIME_MODELS = Object.freeze({
  'grok-video-3': [
    'grok-video-3',
    'grok-1.5-video-6s',
    'grok-1.5-video-10s',
    'grok-1.5-video-15s',
    'grok-imagine-video-1.5',
    'grok-video-fal',
    'zhenzhen-video-gk-v15',
  ],
  'veo3.1': [
    'veo-omni-10s',
    'zhenzhen-video-g-omni-flash',
    'zhenzhen-video-v31-fast',
    'zhenzhen-video-v31-quality',
    'zhenzhen-video-v31-lite',
    'veo3',
    'veo3-fast',
    'veo3-pro',
    'veo3-fast-frames',
    'veo3-pro-frames',
    'veo3.1',
    'veo3.1-fast',
    'veo3.1-pro',
    'veo3.1-components',
    'veo3.1-4k',
    'veo3.1-pro-4k',
    'veo3.1-components-4k',
    'veo3.1-lite',
    'veo3.1-fal',
  ],
  'sora-2': ['sora-2', 'sora-2-zhenzhen'],
  'wan-2.7-spicy': ['wan-2.7-spicy-i2v'],
  'happyhorse-1.1': ['happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v'],
  'seedance-2.0': ['seedance-2.0'],
  'vosr2-video-upscale': ['vosr2-video-upscale'],
  'animate-motion-transfer': ['animate-motion-transfer'],
});

const SEEDANCE_NZ_IMAGE_RUNTIME_MODELS = new Set([
  'zhenzhen-image-g2-t2i',
  'zhenzhen-image-g2-i2i',
  'zhenzhen-image-g-v2-lowprice',
  'zhenzhen-image-gk-v15',
  'zhenzhen-image-gk-v15-edit',
  'zhenzhen-image-nb-2-lite',
  'zhenzhen-image-nb-2',
  'zhenzhen-image-nb-pro',
  'vosr2-image-upscale',
  'qwen-image-global-2.1',
]);
const SEEDANCE_NZ_VIDEO_RUNTIME_MODELS = new Set([
  'zhenzhen-video-g-omni-flash',
  'zhenzhen-video-gk-v15',
  'zhenzhen-video-v31-fast',
  'zhenzhen-video-v31-quality',
  'zhenzhen-video-v31-lite',
  'vosr2-video-upscale',
  'animate-motion-transfer',
]);

const VIDEO_FAL_MODELS = new Set([
  'veo3.1-fal',
  'grok-video-fal',
  'grok-imagine-video-1.5',
  'sora-2',
]);
const DEFAULT_MIDJOURNEY_VERSION = 'v 8.1';
const DEFAULT_SUNO_VERSION = 'v5.5';
const DEFAULT_LLM_MODEL = 'gemini-3.5-flash';
const DEFAULT_BATCH_TAGGER_MODEL = 'gpt-4o-mini';
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i;

class RunIntentAuthorityError extends Error {
  constructor(code, message, details = {}, httpStatus = 400) {
    super(message);
    this.name = 'RunIntentAuthorityError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, maximum = 200) {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return normalized && normalized.length <= maximum ? normalized : '';
}

function uniqueSortedStrings(values) {
  return [...new Set(values.map((value) => boundedString(value, 240)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeRequestedRunNodeIds(nodeIds) {
  return uniqueSortedStrings(Array.isArray(nodeIds) ? nodeIds : []);
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function authorityError(code, message, nodeIds = [], httpStatus = 400) {
  return new RunIntentAuthorityError(code, message, {
    nodeIds: uniqueSortedStrings(nodeIds).slice(0, 50),
  }, httpStatus);
}

function explicitProviderFields(type, data) {
  if (type === 'batch-tagger') {
    return {
      source: boundedString(data.batchTagProviderSource || data.providerSource),
      providerId: boundedString(data.batchTagProviderId || data.providerId),
      model: boundedString(data.batchTagProviderModel || data.providerModel || data.apiModel || data.model),
    };
  }
  return {
    source: boundedString(data.providerSource),
    providerId: boundedString(data.providerId),
    model: boundedString(data.providerModel || data.apiModel || data.model),
  };
}

function resolvedImageRuntimeModel(data) {
  const familyId = boundedString(data.model) || 'gpt-image-2';
  const family = IMAGE_RUNTIME_MODELS[familyId] || IMAGE_RUNTIME_MODELS['gpt-image-2'];
  const savedApiModel = boundedString(data.apiModel);
  return {
    familyId: IMAGE_RUNTIME_MODELS[familyId] ? familyId : 'gpt-image-2',
    model: family.models.includes(savedApiModel) ? savedApiModel : family.defaultModel,
  };
}

function resolvedVideoRuntimeModel(data) {
  const rawModel = boundedString(data.model);
  const legacySora = /^sora-2(?:-\d{4}-\d{2}-\d{2})?$/.test(rawModel);
  const inferredFamily = Object.entries(VIDEO_RUNTIME_MODELS)
    .find(([familyId, models]) => familyId === rawModel || models.includes(rawModel))?.[0];
  const requestedFamily = boundedString(data.mainId)
    || (legacySora ? 'sora-2' : inferredFamily)
    || 'grok-video-3';
  const familyId = VIDEO_RUNTIME_MODELS[requestedFamily] ? requestedFamily : 'grok-video-3';
  const models = VIDEO_RUNTIME_MODELS[familyId];
  return {
    familyId,
    model: models.includes(rawModel) ? rawModel : models[0],
  };
}

function imageLikeValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return !/^data:video\//i.test(normalized)
    && !/^data:audio\//i.test(normalized)
    && !VIDEO_EXTENSIONS.test(normalized)
    && !AUDIO_EXTENSIONS.test(normalized);
}

function nodeHasPersistedImageMaterial(node) {
  const data = isRecord(node?.data) ? node.data : {};
  for (const field of ['imageUrl', 'resultUrl', 'firstFrameUrl', 'lastFrameUrl']) {
    if (imageLikeValue(data[field])) return true;
  }
  for (const field of ['imageUrls', 'urls', 'generatedImages', 'resultUrls']) {
    if (Array.isArray(data[field]) && data[field].some(imageLikeValue)) return true;
  }
  if (Array.isArray(data.materialSetItems)) {
    return data.materialSetItems.some((item) => {
      if (!isRecord(item)) return false;
      const kind = boundedString(item.kind || item.type, 40);
      return kind === 'image' && imageLikeValue(item.url || item.value);
    });
  }
  return false;
}

function hasAuthoritativeImageReference(node, context) {
  const data = isRecord(node?.data) ? node.data : {};
  if (Array.isArray(data.referenceImages) && data.referenceImages.length > 0) return true;
  const incoming = Array.isArray(context?.incoming?.get(node.id)) ? context.incoming.get(node.id) : [];
  if (incoming.length === 0) return false;
  if (Array.isArray(data.excludedMaterialIds) && data.excludedMaterialIds.length > 0) {
    throw authorityError(
      'intent_execution_model_unresolved',
      '图像节点排除了部分上游素材，服务端无法证明 Seedream 的文生图/图生图模式',
      [node.id],
    );
  }
  let hasImage = false;
  for (const edge of incoming) {
    if (edge.sourceHandle != null && String(edge.sourceHandle).trim()) {
      throw authorityError(
        'intent_execution_model_unresolved',
        '图像节点使用具名上游端口，服务端无法证明 Seedream 的精确输入模式',
        [node.id, edge.source],
      );
    }
    const source = context?.nodesById?.get(edge.source);
    if (!source) {
      throw authorityError('intent_canvas_snapshot_invalid', 'Seedream 上游节点不存在', [node.id, edge.source], 409);
    }
    if (context?.authorizedNodeIds?.has(edge.source)) {
      throw authorityError(
        'intent_execution_model_unresolved',
        'Seedream 上游图像会在本次运行中变化，无法在授权边界证明 t2i/i2i 模式',
        [node.id, edge.source],
      );
    }
    if (nodeHasPersistedImageMaterial(source)) hasImage = true;
  }
  return hasImage;
}

function providerDeclarationForNode(node, context = {}) {
  const type = boundedString(node?.type, 120);
  const data = isRecord(node?.data) ? node.data : {};

  if (REMOTE_UNSUPPORTED_HOST_ONLY_NODE_TYPES.has(type)) {
    throw authorityError(
      'intent_host_only_remote_unsupported',
      'Host-only 节点不支持远程协作 RunIntent（remote unsupported）',
      [node.id],
      403,
    );
  }

  const explicit = explicitProviderFields(type, data);

  if (explicit.source && explicit.source !== 'zhenzhen') {
    throw authorityError(
      'intent_external_provider_authority_unavailable',
      '扩展 Provider 的运行时模型会受当前主机配置回退影响，当前边界无法证明精确模型',
      [node.id],
    );
  }

  if (type === 'image') {
    const resolved = resolvedImageRuntimeModel(data);
    const seedreamNz = resolved.familyId === 'seedream-v5-pro' && data.seedreamApiSource === 'seedance-nz';
    if (seedreamNz) {
      const hasReference = hasAuthoritativeImageReference(node, context);
      const overseas = data.seedreamNzModelFamily === 'overseas';
      return {
        provider: 'seedance-nz',
        model: overseas
          ? (hasReference ? 'dola-seedream-5.0-pro-i2i' : 'dola-seedream-5.0-pro-t2i')
          : (hasReference ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro-t2i'),
      };
    }
    if (resolved.familyId === 'midjourney') {
      return {
        provider: 'zhenzhen-mj',
        model: boundedString(data.mjVersion) || DEFAULT_MIDJOURNEY_VERSION,
      };
    }
    return {
      provider: boundedString(data.imageBuiltinSource) === 'seedance-nz'
        || SEEDANCE_NZ_IMAGE_RUNTIME_MODELS.has(resolved.model)
        ? 'seedance-nz'
        : resolved.model.endsWith('-fal') ? 'fal' : 'zhenzhen',
      model: resolved.model,
    };
  }

  if (type === 'video') {
    const resolved = resolvedVideoRuntimeModel(data);
    return {
      provider: VIDEO_FAL_MODELS.has(resolved.model)
        ? 'fal'
        : boundedString(data.videoBuiltinSource) === 'seedance-nz'
          || SEEDANCE_NZ_VIDEO_RUNTIME_MODELS.has(resolved.model)
          ? 'seedance-nz'
        : (resolved.familyId === 'wan-2.7-spicy' || resolved.familyId === 'happyhorse-1.1')
          ? 'seedance-nz'
          : 'zhenzhen',
      model: resolved.model,
    };
  }

  if (type === 'seedance' || type === 'director-storyboard') {
    const source = boundedString(data.seedanceApiSource) || 'zhenzhen-legacy';
    if (source === 'auto') {
      throw authorityError(
        'intent_execution_model_unresolved',
        'Seedance 自动来源取决于当前主机密钥，无法从画布快照证明精确 Provider',
        [node.id],
      );
    }
    if (source === 'seedance-nz') {
      const model = boundedString(data.seedanceNzModel) || 'fast';
      if (type === 'director-storyboard') {
        const models = uniqueSortedStrings([
          model,
          ...(Array.isArray(data.shots)
            ? data.shots.map((shot) => boundedString(shot?.modelOverride)).filter(Boolean)
            : []),
        ]);
        return models.map((entry) => ({ provider: source, model: entry }));
      }
      return { provider: source, model };
    }
    const model = boundedString(data.model) || 'doubao-seedance-2-0-fast-260128';
    if (type === 'director-storyboard') {
      const models = uniqueSortedStrings([
        model,
        ...(Array.isArray(data.shots)
          ? data.shots.map((shot) => boundedString(shot?.modelOverride)).filter(Boolean)
          : []),
      ]);
      return models.map((entry) => ({ provider: 'zhenzhen-legacy', model: entry }));
    }
    return { provider: 'zhenzhen-legacy', model };
  }

  if (type === 'audio') {
    const mode = boundedString(data.audioProviderMode, 40) || 'suno';
    const seedanceNzModels = {
      'seed-audio': 'doubao-seed-audio-1.0',
      whisper: 'whisper-1',
      'qwen3-tts': boundedString(data.qwenTtsModel) || 'qwen3-tts-flash',
      minimax: boundedString(data.minimaxAudioModel) || 'minimax-speech-2.8-turbo',
      mureka: boundedString(data.murekaModel) || 'mureka-v8-bgm',
    };
    if (seedanceNzModels[mode]) return { provider: 'seedance-nz', model: seedanceNzModels[mode] };
    return {
      provider: data.sunoPlatform === 'seedance-nz' ? 'seedance-nz' : 'suno',
      model: data.sunoPlatform === 'seedance-nz'
        ? boundedString(data.sunoNzOperation) || 'suno-generation'
        : boundedString(data.version) || DEFAULT_SUNO_VERSION,
    };
  }

  if (type === 'grok-oauth-agent') {
    const mode = boundedString(data.mode, 40) || 'chat';
    const models = {
      chat: boundedString(data.chatModel) || 'grok-4.3',
      image: boundedString(data.imageModel) || 'grok-imagine-image',
      video: boundedString(data.videoModel) || 'grok-imagine-video',
      tts: boundedString(data.ttsModel) || 'xai-tts',
      stt: boundedString(data.sttModel) || 'xai-stt',
    };
    const model = models[mode];
    if (!model) {
      throw authorityError('intent_execution_model_unresolved', 'Grok OAuth Agent 模式无效，无法证明实际模型', [node.id]);
    }
    return { provider: 'grok-oauth', model };
  }

  if (type === 'minimax-h3-official-prompt-enhancer') {
    const model = boundedString(data.model) || 'minmax-h3-context-ir-text';
    if (!MINMAX_H3_CONTEXT_IR_MODEL_SET.has(model)) {
      throw authorityError(
        'intent_execution_model_unresolved',
        'MiniMax H3 官方提示词增强器模型不在官方 Context IR 列表中',
        [node.id],
      );
    }
    return { provider: 'seedance-nz', model };
  }

  if (type === 'minimax-h3-prompt-enhancer' || type === 'minimax-music3-prompt-enhancer' || type === 'seedance20-prompt-enhancer') {
    const enhancerLabel = type === 'seedance20-prompt-enhancer'
      ? 'Seedance 2.0'
      : type === 'minimax-music3-prompt-enhancer' ? 'MiniMax Music 3' : 'MiniMax H3';
    if (data.llmApiSource !== 'zhenzhen') {
      const model = boundedString(data.providerModel) || 'bytedance/doubao-seed-2.1-pro';
      if (!SEEDANCE_NZ_LLM_MODEL_SET.has(model)) {
        throw authorityError(
          'intent_execution_model_unresolved',
          `${enhancerLabel} 的贞贞平价小屋模型不在已验证模型列表中`,
          [node.id],
        );
      }
      return { provider: 'seedance-nz', model };
    }
    return {
      provider: 'zhenzhen',
      model: boundedString(data.model) || DEFAULT_LLM_MODEL,
    };
  }

  if (type === 'llm') {
    if (data.llmApiSource === 'seedance-nz') {
      const model = boundedString(data.providerModel) || 'bytedance/doubao-seed-2.0-mini';
      if (!SEEDANCE_NZ_LLM_MODEL_SET.has(model)) {
        throw authorityError(
          'intent_execution_model_unresolved',
          '贞贞的平价AI小屋模型不在已验证模型列表中',
          [node.id],
        );
      }
      return {
        provider: 'seedance-nz',
        model,
      };
    }
    return {
      provider: 'zhenzhen',
      model: boundedString(data.model) || DEFAULT_LLM_MODEL,
    };
  }

  if (type === 'batch-tagger') {
    return {
      provider: 'zhenzhen',
      model: boundedString(data.batchTagProviderModel) || DEFAULT_BATCH_TAGGER_MODEL,
    };
  }

  if (type === 'runninghub') {
    const model = boundedString(data.webappId);
    if (!model) throw authorityError('intent_execution_model_unresolved', 'RunningHub 节点缺少 webappId', [node.id]);
    return { provider: 'runninghub', model };
  }

  if (type === 'rh-tools') {
    throw authorityError(
      'intent_execution_authority_unresolved',
      'RunningHub 应用启动器依赖当前主机工具清单，无法只从画布证明活动 webappId',
      [node.id],
    );
  }

  if (type === 'rh-toolbox') {
    const model = boundedString(data.rhToolboxActiveToolId);
    if (!model) throw authorityError('intent_execution_model_unresolved', 'RunningHub 工具箱未固定具体工具', [node.id]);
    return { provider: 'runninghub', model };
  }

  if (type === 'fal-toolbox') {
    const model = boundedString(data.falToolboxActiveToolId);
    if (!model) throw authorityError('intent_execution_model_unresolved', 'FAL 工具箱未固定具体工具', [node.id]);
    return { provider: 'fal', model };
  }

  if (type === 'comfyui-store') {
    throw authorityError(
      'intent_external_provider_authority_unavailable',
      'ComfyUI 应用节点会按当前主机 Provider 清单回退，无法只从画布证明实际 Provider',
      [node.id],
    );
  }

  if (type === 'feishu-bitable-input' || type === 'feishu-bitable-output') {
    return { provider: 'feishu', model: type };
  }

  if (type === 'aggregate-parser') {
    return { provider: 'parsehub', model: 'aggregate-parser' };
  }

  if (LOCAL_EXECUTION_NODE_TYPES.has(type)) return null;
  throw authorityError(
    'intent_execution_authority_unresolved',
    '画布包含尚未建立服务端运行时映射的可执行节点，无法证明 Provider/模型边界',
    [node.id],
  );
}

function normalizeCanvas(document) {
  if (!document || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new RunIntentAuthorityError(
      'intent_canvas_snapshot_invalid',
      '运行意图对应的画布快照无效',
      {},
      409,
    );
  }
  if (document.nodes.length > MAX_CANVAS_NODES || document.edges.length > MAX_CANVAS_EDGES) {
    throw new RunIntentAuthorityError(
      'intent_execution_scope_too_large',
      '运行意图执行范围超过服务端有界上限',
      { maxNodes: MAX_CANVAS_NODES, maxEdges: MAX_CANVAS_EDGES },
      400,
    );
  }

  const nodesById = new Map();
  for (const node of document.nodes) {
    const id = boundedString(node?.id, 240);
    const type = boundedString(node?.type, 120);
    if (!id || !type || nodesById.has(id)) {
      throw authorityError(
        'intent_canvas_snapshot_invalid',
        '运行意图对应的画布包含无效或重复节点身份',
        id ? [id] : [],
        409,
      );
    }
    nodesById.set(id, node);
  }

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of document.edges) {
    const source = boundedString(edge?.source, 240);
    const target = boundedString(edge?.target, 240);
    if (!source || !target || !nodesById.has(source) || !nodesById.has(target)) {
      throw authorityError(
        'intent_canvas_snapshot_invalid',
        '运行意图对应的画布包含缺失端点的连线',
        [source, target],
        409,
      );
    }
    const outgoingList = outgoing.get(source) || [];
    outgoingList.push(target);
    outgoing.set(source, outgoingList);
    const incomingList = incoming.get(target) || [];
    incomingList.push({
      source,
      target,
      sourceHandle: edge?.sourceHandle ?? null,
      targetHandle: edge?.targetHandle ?? null,
    });
    incoming.set(target, incomingList);
  }
  for (const list of outgoing.values()) list.sort((left, right) => left.localeCompare(right));
  for (const list of incoming.values()) {
    list.sort((left, right) => left.source.localeCompare(right.source)
      || String(left.sourceHandle || '').localeCompare(String(right.sourceHandle || '')));
  }
  return { nodesById, outgoing, incoming };
}

function deriveAuthorizedNodeIds(document, nodeIds) {
  const { nodesById, outgoing, incoming } = normalizeCanvas(document);
  const requestedNodeIds = normalizeRequestedRunNodeIds(nodeIds);
  if (requestedNodeIds.length > MAX_REQUESTED_NODE_IDS) {
    throw new RunIntentAuthorityError(
      'intent_requested_scope_too_large',
      '远程运行请求的节点数量超过上限',
      { limit: MAX_REQUESTED_NODE_IDS },
      400,
    );
  }

  const roots = requestedNodeIds.length > 0
    ? requestedNodeIds
    : [...nodesById.values()]
        .filter((node) => EXECUTABLE_NODE_TYPES.has(String(node.type || '')))
        .map((node) => node.id)
        .sort((left, right) => left.localeCompare(right));
  if (roots.length === 0) {
    throw new RunIntentAuthorityError(
      'intent_execution_scope_empty',
      '远程运行请求没有可执行节点',
      {},
      400,
    );
  }

  const authorized = new Set();
  const schedulerQueue = [];
  const queuedSchedulers = new Set();
  for (const nodeId of roots) {
    const node = nodesById.get(nodeId);
    if (!node) throw authorityError('intent_requested_node_missing', '远程运行请求引用了不存在的节点', [nodeId]);
    if (!EXECUTABLE_NODE_TYPES.has(String(node.type || ''))) {
      throw authorityError('intent_requested_node_not_executable', '远程运行请求引用了不可执行节点', [nodeId]);
    }
    authorized.add(nodeId);
    if (node.type === 'loop' || node.type === 'random-route') {
      schedulerQueue.push(nodeId);
      queuedSchedulers.add(nodeId);
    }
  }

  while (schedulerQueue.length > 0) {
    const schedulerId = schedulerQueue.shift();
    const visited = new Set([schedulerId]);
    const queue = [schedulerId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const targetId of outgoing.get(current) || []) {
        if (visited.has(targetId)) continue;
        visited.add(targetId);
        queue.push(targetId);
        const target = nodesById.get(targetId);
        if (!target || !EXECUTABLE_NODE_TYPES.has(String(target.type || ''))) continue;
        authorized.add(targetId);
        if ((target.type === 'loop' || target.type === 'random-route') && !queuedSchedulers.has(targetId)) {
          queuedSchedulers.add(targetId);
          schedulerQueue.push(targetId);
        }
      }
    }
  }

  const authorizedNodeIds = [...authorized].sort((left, right) => left.localeCompare(right));
  for (const nodeId of authorizedNodeIds) {
    if (nodesById.get(nodeId)?.type === 'subflow') {
      throw authorityError(
        'intent_subflow_authority_unavailable',
        '远程运行包含子工作流，但服务端无法在此边界证明全部固定依赖',
        [nodeId],
      );
    }
  }
  return { requestedNodeIds, authorizedNodeIds, nodesById, incoming };
}

function deriveRunIntentAuthority(document, nodeIds) {
  const scope = deriveAuthorizedNodeIds(document, nodeIds);
  const declarationsByKey = new Map();
  const authorizedNodeIdSet = new Set(scope.authorizedNodeIds);
  for (const nodeId of scope.authorizedNodeIds) {
    const declaration = providerDeclarationForNode(scope.nodesById.get(nodeId), {
      nodesById: scope.nodesById,
      incoming: scope.incoming,
      authorizedNodeIds: authorizedNodeIdSet,
    });
    if (!declaration) continue;
    const nodeDeclarations = Array.isArray(declaration) ? declaration : [declaration];
    for (const entry of nodeDeclarations) {
      const provider = boundedString(entry?.provider, 160);
      const model = boundedString(entry?.model, 200);
      if (!provider || !model) {
        throw authorityError(
          'intent_execution_authority_unresolved',
          '服务端无法证明执行节点的 Provider/模型',
          [nodeId],
        );
      }
      const key = `${provider}\u0000${model}`;
      const current = declarationsByKey.get(key) || { provider, model, nodeIds: [] };
      current.nodeIds.push(nodeId);
      declarationsByKey.set(key, current);
    }
  }

  const declarations = [...declarationsByKey.values()]
    .map((entry) => ({ ...entry, nodeIds: uniqueSortedStrings(entry.nodeIds) }))
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model));
  return {
    schema: RUN_INTENT_AUTHORITY_SCHEMA,
    requestedNodeIds: scope.requestedNodeIds,
    authorizedNodeIds: scope.authorizedNodeIds,
    declarations,
    cost: {
      known: false,
      currency: null,
      amount: null,
      reasonCode: 'pricing_registry_unavailable',
    },
  };
}

function summarizeRunIntentAuthority(authority) {
  const declarations = Array.isArray(authority?.declarations) ? authority.declarations : [];
  return {
    provider: declarations.length === 1 ? declarations[0].provider : null,
    model: declarations.length === 1 ? declarations[0].model : null,
    estimatedCost: authority?.cost?.known === true ? Math.max(0, Number(authority.cost.amount) || 0) : null,
    estimatedCostKnown: authority?.cost?.known === true,
  };
}

function assertRunIntentAuthorityMatches(persisted, current) {
  if (!persisted || persisted.schema !== RUN_INTENT_AUTHORITY_SCHEMA) {
    throw new RunIntentAuthorityError(
      'intent_execution_authority_missing',
      '运行意图缺少服务端权威执行范围，请重新发起',
      {},
      409,
    );
  }
  if (stableJson(persisted) !== stableJson(current)) {
    throw new RunIntentAuthorityError(
      'intent_execution_authority_stale',
      '运行意图的服务端权威执行范围已变化，请重新发起',
      {},
      409,
    );
  }
  return current;
}

module.exports = {
  EXECUTABLE_NODE_TYPES,
  RUN_INTENT_AUTHORITY_SCHEMA,
  RunIntentAuthorityError,
  assertRunIntentAuthorityMatches,
  deriveAuthorizedNodeIds,
  deriveRunIntentAuthority,
  normalizeRequestedRunNodeIds,
  providerDeclarationForNode,
  stableJson,
  summarizeRunIntentAuthority,
};
