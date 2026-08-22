const DEFAULT_MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn/v1';
const DEFAULT_VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const { isAllowedComfyuiUrl } = require('./comfyuiAccess');

const DEFAULT_MODELSCOPE_IMAGE_MODELS = [
  'Tongyi-MAI/Z-Image-Turbo',
  'Qwen/Qwen-Image-2512',
  'Qwen/Qwen-Image-Edit-2511',
  'black-forest-labs/FLUX.2-klein-9B',
];

const DEFAULT_MODELSCOPE_LORAS_VERSION = 1;

const DEFAULT_MODELSCOPE_LORAS = [
  {
    id: 'Daniel8152/film',
    name: 'Z-Image Film',
    targetModel: 'Tongyi-MAI/Z-Image-Turbo',
    strength: 0.8,
    enabled: true,
    note: '',
  },
  {
    id: 'Daniel8152/Qwen-Image-2512-Film',
    name: 'Qwen Image 2512 Film',
    targetModel: 'Qwen/Qwen-Image-2512',
    strength: 0.8,
    enabled: true,
    note: '',
  },
  {
    id: 'Daniel8152/Klein-enhance',
    name: 'Klein enhance',
    targetModel: 'black-forest-labs/FLUX.2-klein-9B',
    strength: 0.8,
    enabled: true,
    note: '',
  },
];

const DEFAULT_MODELSCOPE_CHAT_MODELS = [
  'Qwen/Qwen3-235B-A22B',
  'Qwen/Qwen3-VL-235B-A22B-Instruct',
  'MiniMax/MiniMax-M2.7:MiniMax',
];

const DEFAULT_VOLCENGINE_IMAGE_MODELS = [
  'doubao-seedream-4-0-250828',
];

const DEFAULT_VOLCENGINE_VIDEO_MODELS = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-1-5-pro-251215',
  'doubao-seedance-1-0-pro-250528',
  'doubao-seedance-1-0-lite-t2v-250428',
  'doubao-seedance-1-0-lite-i2v-250428',
];

const DEFAULT_VOLCENGINE_CHAT_MODELS = [
  'doubao-seed-1-6-250615',
];

const DEFAULT_AGNES_IMAGE_MODELS = [
  'agnes-image-2.1-flash',
  'agnes-image-2.0-flash',
];

const DEFAULT_AGNES_VIDEO_MODELS = [
  'agnes-video-v2.0',
];

const DEFAULT_AGNES_CHAT_MODELS = [
  'agnes-2.0-flash',
];

const DEFAULT_JIMENG_IMAGE_MODELS = [
  'seedream-4.7',
  'seedream-4.6',
  'seedream-4.5',
  'seedream-5.0',
  'seedream-5.0-pro',
  'seedream-4.1',
  'seedream-4.0',
  'seedream-3.1',
  'seedream-3.0',
  'jimeng-image-2k',
  'jimeng-image-4k',
];

const DEFAULT_JIMENG_VIDEO_MODELS = [
  'seedance2.0fast_vip',
  'seedance2.5',
  'seedance2.0_vip',
  'seedance2.0mini',
  'seedance2.0fast',
  'seedance2.0',
  'seedance1.5pro',
  'seedance1.0fast',
  'jimeng-video-720p',
  'jimeng-video-1080p',
];

const SUPPORTED_PROTOCOLS = new Set([
  'openai-compatible',
  'modelscope',
  'volcengine',
  'agnes',
  'comfyui',
  'jimeng-cli',
]);

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,47}$/;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

const DEFAULT_ADVANCED_PROVIDERS = [
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容',
    protocol: 'openai-compatible',
    baseUrl: '',
    enabled: false,
    imageModels: [],
    videoModels: [],
    chatModels: [],
    defaults: {},
  },
  {
    id: 'modelscope',
    label: 'ModelScope',
    protocol: 'modelscope',
    baseUrl: DEFAULT_MODELSCOPE_BASE_URL,
    enabled: false,
    imageModels: DEFAULT_MODELSCOPE_IMAGE_MODELS,
    videoModels: [],
    chatModels: DEFAULT_MODELSCOPE_CHAT_MODELS,
    defaults: {
      imageModel: DEFAULT_MODELSCOPE_IMAGE_MODELS[0],
      chatModel: DEFAULT_MODELSCOPE_CHAT_MODELS[0],
    },
    modelscopeConfig: {
      defaultsVersion: DEFAULT_MODELSCOPE_LORAS_VERSION,
      loras: DEFAULT_MODELSCOPE_LORAS,
    },
  },
  {
    id: 'volcengine',
    label: '火山引擎',
    protocol: 'volcengine',
    baseUrl: DEFAULT_VOLCENGINE_BASE_URL,
    enabled: false,
    imageModels: DEFAULT_VOLCENGINE_IMAGE_MODELS,
    videoModels: DEFAULT_VOLCENGINE_VIDEO_MODELS,
    chatModels: DEFAULT_VOLCENGINE_CHAT_MODELS,
    defaults: {
      imageModel: DEFAULT_VOLCENGINE_IMAGE_MODELS[0],
      videoModel: DEFAULT_VOLCENGINE_VIDEO_MODELS[1],
      chatModel: DEFAULT_VOLCENGINE_CHAT_MODELS[0],
    },
    volcengineConfig: {
      project: 'default',
      region: 'cn-beijing',
    },
  },
  {
    id: 'agnes',
    label: 'Agnes AI',
    protocol: 'agnes',
    baseUrl: DEFAULT_AGNES_BASE_URL,
    enabled: false,
    imageModels: DEFAULT_AGNES_IMAGE_MODELS,
    videoModels: DEFAULT_AGNES_VIDEO_MODELS,
    chatModels: DEFAULT_AGNES_CHAT_MODELS,
    defaults: {
      imageModel: DEFAULT_AGNES_IMAGE_MODELS[0],
      videoModel: DEFAULT_AGNES_VIDEO_MODELS[0],
      chatModel: DEFAULT_AGNES_CHAT_MODELS[0],
      responseFormat: 'url',
    },
  },
  {
    id: 'comfyui',
    label: 'ComfyUI',
    protocol: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    enabled: false,
    imageModels: [],
    videoModels: [],
    chatModels: [],
    defaults: {},
    comfyuiConfig: {
      instances: ['http://127.0.0.1:8188'],
      workflows: [],
    },
  },
  {
    id: 'jimeng-cli',
    label: '即梦 CLI',
    protocol: 'jimeng-cli',
    baseUrl: '',
    enabled: false,
    imageModels: DEFAULT_JIMENG_IMAGE_MODELS,
    videoModels: DEFAULT_JIMENG_VIDEO_MODELS,
    chatModels: [],
    defaults: {},
    jimengConfig: {
      executablePath: '',
      useWsl: false,
      wslDistro: '',
      pollSeconds: 3600,
    },
  },
];

const DEFAULT_ADVANCED_PROVIDER_IDS = DEFAULT_ADVANCED_PROVIDERS.map((provider) => provider.id);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, maxLen) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function cleanId(value) {
  const id = String(value || '').trim().toLowerCase();
  return PROVIDER_ID_RE.test(id) ? id : '';
}

function cleanProtocol(value) {
  const protocol = String(value || '').trim().toLowerCase();
  return SUPPORTED_PROTOCOLS.has(protocol) ? protocol : '';
}

function isMaskedSecret(value) {
  return typeof value === 'string' && /^\*{2,}/.test(value.trim());
}

function cleanSecret(value, previous = '') {
  if (typeof value !== 'string') return previous || '';
  const trimmed = value.trim();
  if (!trimmed || isMaskedSecret(trimmed)) return previous || '';
  if (CONTROL_CHAR_RE.test(trimmed)) return previous || '';
  return trimmed.slice(0, 4096);
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `****${text.slice(-4)}`;
}

function normalizeModelList(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const item = String(value || '').trim();
    if (!item || item.length > 240 || CONTROL_CHAR_RE.test(item)) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function normalizeModelscopeLoraStrength(value, fallback = 0.8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(2, n));
}

function normalizeModelscopeLoras(values) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = cleanText(raw.id || raw.loraId || '', 180);
    const targetModel = cleanText(raw.targetModel || raw.target_model || raw.model || '', 180);
    if (!id || !targetModel) continue;
    const key = `${targetModel}\n${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      name: cleanText(raw.name || id, 80) || id,
      targetModel,
      strength: normalizeModelscopeLoraStrength(raw.strength ?? raw.default_strength ?? raw.defaultStrength, 0.8),
      enabled: normalizeBoolean(raw.enabled, true),
      note: cleanText(raw.note || '', 300),
    });
  }
  return out.slice(0, 120);
}

function normalizeModelscopeConfig(value, raw = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    defaultsVersion: DEFAULT_MODELSCOPE_LORAS_VERSION,
    loras: normalizeModelscopeLoras([
      ...DEFAULT_MODELSCOPE_LORAS,
      ...(Array.isArray(config.loras) ? config.loras : []),
      ...(Array.isArray(raw.ms_loras) ? raw.ms_loras : []),
      ...(Array.isArray(raw.msLoras) ? raw.msLoras : []),
    ]),
  };
}

function mergeModelLists(defaults, values) {
  return normalizeModelList([...(Array.isArray(defaults) ? defaults : []), ...(Array.isArray(values) ? values : [])]);
}

function normalizeUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  return text;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
  }
  return fallback;
}

function normalizeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizePlainObject(value, maxEntries = 64) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, maxEntries)) {
    const cleanKey = cleanText(key, 80);
    if (!cleanKey || CONTROL_CHAR_RE.test(cleanKey)) continue;
    if (item == null) continue;
    if (['string', 'number', 'boolean'].includes(typeof item)) out[cleanKey] = item;
  }
  return out;
}

function cloneJsonValue(value, maxBytes = 2 * 1024 * 1024) {
  if (value == null) return undefined;
  try {
    const text = JSON.stringify(value);
    if (!text || text.length > maxBytes) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeComfyFields(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const nodeId = cleanText(raw.nodeId || raw.node || '', 80);
    const fieldName = cleanText(raw.fieldName || raw.input || raw.name || '', 80);
    const fixedValue = cloneJsonValue(raw.value, 64 * 1024);
    const source = cleanText(raw.source || (fixedValue !== undefined ? 'fixed' : fieldName), 80);
    if (!nodeId || !fieldName) continue;
    const field = { nodeId, fieldName, source };
    if (source === 'fixed' && fixedValue !== undefined) field.value = fixedValue;
    out.push(field);
  }
  return out.slice(0, 200);
}

function normalizeComfyExcludeRules(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;，；]+/);
  const out = [];
  for (const raw of rawItems) {
    const item = cleanText(raw, 120);
    if (!item || out.includes(item)) continue;
    out.push(item);
  }
  return out.slice(0, 200);
}

function normalizeVolcengineConfig(value, previous = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    project: cleanText(raw.project || raw.projectName || previous.project || 'default', 80) || 'default',
    region: cleanText(raw.region || previous.region || 'cn-beijing', 40) || 'cn-beijing',
    accessKeyId: cleanSecret(raw.accessKeyId || raw.accessKeyID || raw.ak, previous.accessKeyId),
    secretAccessKey: cleanSecret(raw.secretAccessKey || raw.secretKey || raw.sk, previous.secretAccessKey),
  };
}

function normalizeComfyuiConfig(value, options = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const instances = [];
  const rawInstances = Array.isArray(raw.instances) ? raw.instances : [];
  for (const item of rawInstances) {
    const url = normalizeUrl(item);
    if (url && isAllowedComfyuiUrl(url, options) && !instances.includes(url)) instances.push(url);
  }
  const workflows = Array.isArray(raw.workflows)
    ? raw.workflows
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const workflowJson = cloneJsonValue(item.workflowJson || item.workflow || item.raw);
          const workflow = {
            id: cleanText(item.id || item.name, 80),
            name: cleanText(item.name || item.id, 120),
          };
          if (workflowJson !== undefined) workflow.workflowJson = workflowJson;
          const fields = normalizeComfyFields(item.fields);
          if (fields.length) workflow.fields = fields;
          const excludeRules = normalizeComfyExcludeRules(item.excludeRules || item.exclude_rules || item.excludedFields || item.excluded_fields);
          if (excludeRules.length) workflow.excludeRules = excludeRules;
          const outputNodeIds = Array.isArray(item.outputNodeIds)
            ? [...new Set(item.outputNodeIds.map((nodeId) => cleanText(nodeId, 40)).filter(Boolean))].slice(0, 80)
            : [];
          if (outputNodeIds.length) workflow.outputNodeIds = outputNodeIds;
          return workflow;
        })
        .filter((item) => item && item.id && item.name)
        .slice(0, 80)
    : [];
  return { instances, workflows };
}

function normalizeJimengConfig(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    executablePath: cleanText(raw.executablePath || raw.binPath || '', 260),
    useWsl: normalizeBoolean(raw.useWsl, false),
    wslDistro: cleanText(raw.wslDistro || '', 80),
    pollSeconds: normalizeNumber(raw.pollSeconds, 3600, 0, 3600),
  };
}

function normalizeProvider(raw, previous = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  const protocol = cleanProtocol(raw.protocol);
  if (!protocol) return null;

  const previousConfig = previous || {};
  let baseUrl = normalizeUrl(raw.baseUrl || raw.base_url || '');
  if (!baseUrl && protocol === 'modelscope') baseUrl = DEFAULT_MODELSCOPE_BASE_URL;
  if (!baseUrl && protocol === 'volcengine') baseUrl = DEFAULT_VOLCENGINE_BASE_URL;
  if (!baseUrl && protocol === 'agnes') baseUrl = DEFAULT_AGNES_BASE_URL;
  if (protocol === 'jimeng-cli') baseUrl = '';
  if (protocol === 'comfyui') {
    const allowRemote = normalizeBoolean(raw.allowRemote, false);
    if (!baseUrl) baseUrl = 'http://127.0.0.1:8188';
    if (!isAllowedComfyuiUrl(baseUrl, { allowRemote })) return null;
  } else if (baseUrl && !normalizeUrl(baseUrl)) {
    return null;
  }

  const provider = {
    id,
    label: cleanText(raw.label || raw.name || previousConfig.label || id, 60) || id,
    protocol,
    baseUrl,
    enabled: normalizeBoolean(raw.enabled, false),
    apiKey: cleanSecret(raw.apiKey || raw.api_key, previousConfig.apiKey),
    imageModels: normalizeModelList(raw.imageModels || raw.image_models),
    videoModels: normalizeModelList(raw.videoModels || raw.video_models),
    chatModels: normalizeModelList(raw.chatModels || raw.chat_models),
    defaults: normalizePlainObject(raw.defaults),
  };

  if (protocol === 'comfyui' && normalizeBoolean(raw.allowRemote, false)) {
    provider.allowRemote = true;
  }

  if (id === 'modelscope' && protocol === 'modelscope') {
    provider.imageModels = mergeModelLists(DEFAULT_MODELSCOPE_IMAGE_MODELS, provider.imageModels);
    provider.chatModels = mergeModelLists(DEFAULT_MODELSCOPE_CHAT_MODELS, provider.chatModels);
    provider.defaults = {
      imageModel: DEFAULT_MODELSCOPE_IMAGE_MODELS[0],
      chatModel: DEFAULT_MODELSCOPE_CHAT_MODELS[0],
      ...provider.defaults,
    };
    provider.modelscopeConfig = normalizeModelscopeConfig(raw.modelscopeConfig || raw.modelscope_config, raw);
  }

  if (id === 'volcengine' && protocol === 'volcengine') {
    provider.imageModels = mergeModelLists(DEFAULT_VOLCENGINE_IMAGE_MODELS, provider.imageModels);
    provider.videoModels = mergeModelLists(DEFAULT_VOLCENGINE_VIDEO_MODELS, provider.videoModels);
    provider.chatModels = mergeModelLists(DEFAULT_VOLCENGINE_CHAT_MODELS, provider.chatModels);
    provider.defaults = {
      imageModel: DEFAULT_VOLCENGINE_IMAGE_MODELS[0],
      videoModel: DEFAULT_VOLCENGINE_VIDEO_MODELS[1],
      chatModel: DEFAULT_VOLCENGINE_CHAT_MODELS[0],
      ...provider.defaults,
    };
  }

  if (protocol === 'volcengine') {
    provider.volcengineConfig = normalizeVolcengineConfig(raw.volcengineConfig || raw.volcengine_config, previousConfig.volcengineConfig);
  }
  if (protocol === 'comfyui') {
    provider.comfyuiConfig = normalizeComfyuiConfig(raw.comfyuiConfig || raw.comfyui_config, {
      allowRemote: !!provider.allowRemote,
    });
  }
  if (protocol === 'jimeng-cli') {
    provider.imageModels = mergeModelLists(DEFAULT_JIMENG_IMAGE_MODELS, provider.imageModels);
    provider.videoModels = mergeModelLists(DEFAULT_JIMENG_VIDEO_MODELS, provider.videoModels);
    provider.jimengConfig = normalizeJimengConfig(raw.jimengConfig || raw.jimeng_config);
  }

  if (id === 'agnes' && protocol === 'agnes') {
    provider.imageModels = mergeModelLists(DEFAULT_AGNES_IMAGE_MODELS, provider.imageModels);
    provider.videoModels = mergeModelLists(DEFAULT_AGNES_VIDEO_MODELS, provider.videoModels);
    provider.chatModels = mergeModelLists(DEFAULT_AGNES_CHAT_MODELS, provider.chatModels);
    provider.defaults = {
      imageModel: DEFAULT_AGNES_IMAGE_MODELS[0],
      videoModel: DEFAULT_AGNES_VIDEO_MODELS[0],
      chatModel: DEFAULT_AGNES_CHAT_MODELS[0],
      responseFormat: 'url',
      ...provider.defaults,
    };
  }

  return provider;
}

function normalizeAdvancedProviders(rawProviders, currentProviders = []) {
  const previousById = new Map(
    (Array.isArray(currentProviders) ? currentProviders : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => [cleanId(item.id), item])
      .filter(([id]) => !!id),
  );
  const byId = new Map();

  for (const template of DEFAULT_ADVANCED_PROVIDERS) {
    const previous = previousById.get(template.id);
    const provider = normalizeProvider({ ...clone(template), ...(previous || {}) }, previous);
    if (provider) byId.set(provider.id, provider);
  }

  for (const raw of Array.isArray(rawProviders) ? rawProviders : []) {
    const id = cleanId(raw?.id);
    const previous = previousById.get(id) || byId.get(id) || null;
    const provider = normalizeProvider(raw, previous);
    if (provider) byId.set(provider.id, provider);
  }

  return [...byId.values()];
}

function maskAdvancedProviders(providers) {
  return normalizeAdvancedProviders(providers).map((provider) => {
    const masked = { ...provider };
    masked.hasApiKey = !!provider.apiKey;
    masked.apiKey = maskSecret(provider.apiKey);
    if (provider.volcengineConfig) {
      masked.volcengineConfig = {
        ...provider.volcengineConfig,
        hasAccessKeyId: !!provider.volcengineConfig.accessKeyId,
        hasSecretAccessKey: !!provider.volcengineConfig.secretAccessKey,
        accessKeyId: maskSecret(provider.volcengineConfig.accessKeyId),
        secretAccessKey: maskSecret(provider.volcengineConfig.secretAccessKey),
      };
    }
    return masked;
  });
}

function summarizeAdvancedProviders(providers) {
  const normalized = normalizeAdvancedProviders(providers);
  let configuredKeyCount = 0;
  let comfyuiConfigured = false;
  let jimengConfigured = false;
  for (const provider of normalized) {
    if (provider.apiKey) configuredKeyCount += 1;
    if (provider.volcengineConfig?.accessKeyId) configuredKeyCount += 1;
    if (provider.volcengineConfig?.secretAccessKey) configuredKeyCount += 1;
    if (provider.protocol === 'comfyui' && (provider.baseUrl || provider.comfyuiConfig?.instances?.length)) {
      comfyuiConfigured = true;
    }
    if (provider.protocol === 'jimeng-cli' && provider.jimengConfig?.executablePath) {
      jimengConfigured = true;
    }
  }
  return {
    enabledCount: normalized.filter((provider) => provider.enabled).length,
    configuredKeyCount,
    comfyuiConfigured,
    jimengConfigured,
  };
}

function getEnabledAdvancedProviders(providers) {
  return normalizeAdvancedProviders(providers).filter((provider) => provider.enabled);
}

module.exports = {
  DEFAULT_ADVANCED_PROVIDERS,
  DEFAULT_ADVANCED_PROVIDER_IDS,
  DEFAULT_MODELSCOPE_CHAT_MODELS,
  DEFAULT_MODELSCOPE_IMAGE_MODELS,
  DEFAULT_MODELSCOPE_LORAS,
  DEFAULT_MODELSCOPE_BASE_URL,
  DEFAULT_AGNES_BASE_URL,
  DEFAULT_AGNES_CHAT_MODELS,
  DEFAULT_AGNES_IMAGE_MODELS,
  DEFAULT_AGNES_VIDEO_MODELS,
  DEFAULT_VOLCENGINE_CHAT_MODELS,
  DEFAULT_VOLCENGINE_IMAGE_MODELS,
  DEFAULT_VOLCENGINE_VIDEO_MODELS,
  DEFAULT_VOLCENGINE_BASE_URL,
  DEFAULT_JIMENG_IMAGE_MODELS,
  DEFAULT_JIMENG_VIDEO_MODELS,
  SUPPORTED_PROTOCOLS,
  getEnabledAdvancedProviders,
  maskAdvancedProviders,
  normalizeAdvancedProviders,
  normalizeModelscopeLoras,
  summarizeAdvancedProviders,
};
