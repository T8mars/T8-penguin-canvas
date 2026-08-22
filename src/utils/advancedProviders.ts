import type { AdvancedProviderConfig, AdvancedProviderSummary, CanvasProviderSource } from '../types/canvas';

const MASKED_RE = /^\*{2,}/;

export interface ModelscopeLoraOption {
  id: string;
  name: string;
  targetModel: string;
  strength: number;
  enabled: boolean;
  note?: string;
}

export const MAX_MODELSCOPE_NODE_LORAS = 5;
export const MODELSCOPE_LORA_TOTAL_WEIGHT = 1;
const MODELSCOPE_LORA_WEIGHT_DECIMALS = 4;

export interface ModelscopeSelectedLora {
  id: string;
  strength: number;
}

function roundModelscopeLoraWeight(value: number): number {
  return Number(value.toFixed(MODELSCOPE_LORA_WEIGHT_DECIMALS));
}

export function parseAdvancedProviderModelText(value: string): string[] {
  const out: string[] = [];
  for (const raw of String(value || '').split(/[\n,]/)) {
    const item = raw.trim();
    if (!item || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

export function stringifyAdvancedProviderModels(values?: string[]): string {
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function normalizeModelscopeLoraStrength(value: unknown, fallback = 0.8): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MODELSCOPE_LORA_TOTAL_WEIGHT, n));
}

export function modelscopeLoraWeightTotal(values: ModelscopeSelectedLora[] = []): number {
  return roundModelscopeLoraWeight(values.reduce((sum, item) => (
    sum + normalizeModelscopeLoraStrength(item?.strength, 0)
  ), 0));
}

export function normalizeModelscopeLoraWeightsTotal(
  values: ModelscopeSelectedLora[] = [],
): ModelscopeSelectedLora[] {
  const normalized = values.map((item) => ({
    ...item,
    strength: normalizeModelscopeLoraStrength(item?.strength, 0),
  }));
  const total = modelscopeLoraWeightTotal(normalized);
  if (total <= MODELSCOPE_LORA_TOTAL_WEIGHT || total <= 0) return normalized;

  const positiveCount = normalized.filter((item) => item.strength > 0).length;
  let positiveIndex = 0;
  let used = 0;
  return normalized.map((item) => {
    if (item.strength <= 0) return item;
    positiveIndex += 1;
    const strength = positiveIndex === positiveCount
      ? Math.max(0, roundModelscopeLoraWeight(MODELSCOPE_LORA_TOTAL_WEIGHT - used))
      : roundModelscopeLoraWeight(item.strength / total);
    used = roundModelscopeLoraWeight(used + strength);
    return { ...item, strength };
  });
}

export function distributeModelscopeLoraWeights(
  values: ModelscopeSelectedLora[] = [],
): ModelscopeSelectedLora[] {
  const count = values.length;
  if (!count) return [];
  const base = roundModelscopeLoraWeight(MODELSCOPE_LORA_TOTAL_WEIGHT / count);
  let used = 0;
  return values.map((item, index) => {
    const strength = index === count - 1
      ? Math.max(0, roundModelscopeLoraWeight(MODELSCOPE_LORA_TOTAL_WEIGHT - used))
      : base;
    used = roundModelscopeLoraWeight(used + strength);
    return { ...item, strength };
  });
}

export function normalizeModelscopeLoras(values?: unknown[]): ModelscopeLoraOption[] {
  const out: ModelscopeLoraOption[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? values : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, any>;
    const id = String(item.id || item.loraId || '').trim();
    const targetModel = String(item.targetModel || item.target_model || item.model || '').trim();
    if (!id || !targetModel) continue;
    const key = `${targetModel}\n${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: id.slice(0, 180),
      name: String(item.name || id).trim().replace(/\s+/g, ' ').slice(0, 80) || id,
      targetModel: targetModel.slice(0, 180),
      strength: normalizeModelscopeLoraStrength(item.strength ?? item.default_strength ?? item.defaultStrength, 0.8),
      enabled: item.enabled !== false,
      note: String(item.note || '').trim().slice(0, 300),
    });
  }
  return out;
}

export function modelscopeLorasForModel(
  provider: AdvancedProviderConfig | null | undefined,
  modelId?: string,
): ModelscopeLoraOption[] {
  const target = String(modelId || '').trim();
  if (!provider || provider.protocol !== 'modelscope' || !target) return [];
  const raw = [
    ...(Array.isArray(provider.modelscopeConfig?.loras) ? provider.modelscopeConfig.loras : []),
    ...(Array.isArray((provider as any).ms_loras) ? (provider as any).ms_loras : []),
  ];
  return normalizeModelscopeLoras(raw).filter((lora) => (
    lora.enabled !== false &&
    lora.id &&
    lora.targetModel === target
  ));
}

export function normalizeModelscopeSelectedLoras(
  value: unknown,
  availableOptions: ModelscopeLoraOption[] = [],
  legacy?: { enabled?: unknown; id?: unknown; strength?: unknown },
): ModelscopeSelectedLora[] {
  const out: ModelscopeSelectedLora[] = [];
  const seen = new Set<string>();
  const availableById = new Map(availableOptions.map((option) => [option.id, option]));
  const allowAny = availableOptions.length === 0;
  const add = (rawId: unknown, rawStrength: unknown) => {
    if (out.length >= MAX_MODELSCOPE_NODE_LORAS) return;
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) return;
    const option = availableById.get(id);
    if (!allowAny && !option) return;
    seen.add(id);
    out.push({
      id,
      strength: normalizeModelscopeLoraStrength(rawStrength, option?.strength ?? 0.8),
    });
  };

  if (Array.isArray(value)) {
    for (const raw of value) {
      if (out.length >= MAX_MODELSCOPE_NODE_LORAS) break;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, any>;
      if (item.enabled === false) continue;
      add(
        item.id || item.loraId,
        item.strength ?? item.loraStrength ?? item.default_strength ?? item.defaultStrength ?? item.weight ?? item.scale,
      );
    }
  } else if (value && typeof value === 'object') {
    for (const [id, strength] of Object.entries(value as Record<string, any>)) {
      if (out.length >= MAX_MODELSCOPE_NODE_LORAS) break;
      add(id, strength);
    }
  }

  if (!out.length && legacy?.enabled === true) {
    add(legacy.id, legacy.strength);
  }
  return normalizeModelscopeLoraWeightsTotal(out);
}

export function hasAdvancedProviderSecret(value?: string): boolean {
  const text = String(value || '').trim();
  return !!text && (MASKED_RE.test(text) || text.length > 0);
}

export function advancedProviderSummary(providers?: AdvancedProviderConfig[]): AdvancedProviderSummary {
  const list = Array.isArray(providers) ? providers : [];
  return list.reduce<AdvancedProviderSummary>((summary, provider) => {
    if (provider?.enabled) summary.enabledCount += 1;
    if (hasAdvancedProviderSecret(provider?.apiKey)) summary.configuredKeyCount += 1;
    if (hasAdvancedProviderSecret(provider?.volcengineConfig?.accessKeyId)) summary.configuredKeyCount += 1;
    if (hasAdvancedProviderSecret(provider?.volcengineConfig?.secretAccessKey)) summary.configuredKeyCount += 1;
    if (provider?.protocol === 'comfyui' && (provider.baseUrl || provider.comfyuiConfig?.instances?.length)) {
      summary.comfyuiConfigured = true;
    }
    if (provider?.protocol === 'jimeng-cli' && provider.jimengConfig?.executablePath) {
      summary.jimengConfigured = true;
    }
    return summary;
  }, {
    enabledCount: 0,
    configuredKeyCount: 0,
    comfyuiConfigured: false,
    jimengConfigured: false,
  });
}

export type AdvancedProviderNodeKind = 'image' | 'video' | 'llm';

export interface AdvancedProviderSelection {
  providerSource: CanvasProviderSource;
  providerId: string;
  providerModel: string;
  provider: AdvancedProviderConfig | null;
  available: boolean;
}

const IMAGE_PROTOCOLS = new Set(['openai-compatible', 'modelscope', 'volcengine', 'agnes', 'comfyui', 'jimeng-cli']);
const VIDEO_PROTOCOLS = new Set(['openai-compatible', 'volcengine', 'agnes', 'jimeng-cli']);
const LLM_PROTOCOLS = new Set(['openai-compatible', 'modelscope', 'volcengine', 'agnes']);

const FALLBACK_MODELS: Record<AdvancedProviderNodeKind, Partial<Record<string, string[]>>> = {
  image: {
    'openai-compatible': ['gpt-image-1'],
    modelscope: [
      'Tongyi-MAI/Z-Image-Turbo',
      'Qwen/Qwen-Image-2512',
      'Qwen/Qwen-Image-Edit-2511',
      'black-forest-labs/FLUX.2-klein-9B',
    ],
    volcengine: ['doubao-seedream-4-0-250828'],
    agnes: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'],
    'jimeng-cli': [
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
    ],
  },
  video: {
    'openai-compatible': [],
    agnes: ['agnes-video-v2.0'],
    volcengine: [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-1-5-pro-251215',
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-lite-t2v-250428',
      'doubao-seedance-1-0-lite-i2v-250428',
    ],
    'jimeng-cli': [
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
    ],
  },
  llm: {
    'openai-compatible': ['gpt-4o-mini'],
    modelscope: [
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen3-VL-235B-A22B-Instruct',
      'MiniMax/MiniMax-M2.7:MiniMax',
    ],
    volcengine: ['doubao-seed-1-6-250615'],
    agnes: ['agnes-2.0-flash'],
  },
};

function uniqueCompact(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const item = String(value || '').trim();
    if (!item || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

function listForKind(provider: AdvancedProviderConfig, kind: AdvancedProviderNodeKind): string[] {
  if (kind === 'image') return Array.isArray(provider.imageModels) ? provider.imageModels : [];
  if (kind === 'video') return Array.isArray(provider.videoModels) ? provider.videoModels : [];
  return Array.isArray(provider.chatModels) ? provider.chatModels : [];
}

function defaultModelForKind(provider: AdvancedProviderConfig, kind: AdvancedProviderNodeKind): string {
  const defaults = provider.defaults || {};
  const key = kind === 'llm' ? 'chatModel' : `${kind}Model`;
  return String(defaults[key] || defaults.model || '').trim();
}

function supportsNodeKind(provider: AdvancedProviderConfig, kind: AdvancedProviderNodeKind): boolean {
  if (!provider?.enabled) return false;
  const protocol = String(provider.protocol || '');
  if (kind === 'image' && !IMAGE_PROTOCOLS.has(protocol)) return false;
  if (kind === 'video' && !VIDEO_PROTOCOLS.has(protocol)) return false;
  if (kind === 'llm' && !LLM_PROTOCOLS.has(protocol)) return false;
  if (protocol === 'comfyui') {
    return kind === 'image' && !!provider.comfyuiConfig?.workflows?.length;
  }
  return advancedProviderModelOptions(provider, kind).length > 0;
}

export function advancedProviderModelOptions(
  provider: AdvancedProviderConfig,
  kind: AdvancedProviderNodeKind,
): string[] {
  if (!provider) return [];
  if (provider.protocol === 'comfyui' && kind === 'image') {
    return uniqueCompact((provider.comfyuiConfig?.workflows || []).map((workflow) => workflow.id || workflow.name));
  }
  const explicit = uniqueCompact(listForKind(provider, kind));
  if (explicit.length) {
    const defaultModel = defaultModelForKind(provider, kind);
    return defaultModel && explicit.includes(defaultModel)
      ? uniqueCompact([defaultModel, ...explicit])
      : explicit;
  }
  return uniqueCompact([
    defaultModelForKind(provider, kind),
    ...(FALLBACK_MODELS[kind][provider.protocol] || []),
  ]);
}

export function advancedProvidersForNode(
  providers: AdvancedProviderConfig[] | undefined,
  kind: AdvancedProviderNodeKind,
): AdvancedProviderConfig[] {
  return (Array.isArray(providers) ? providers : []).filter((provider) => supportsNodeKind(provider, kind));
}

export function resolveAdvancedProviderSelection(
  providers: AdvancedProviderConfig[] | undefined,
  kind: AdvancedProviderNodeKind,
  current?: {
    providerSource?: CanvasProviderSource;
    providerId?: string;
    providerModel?: string;
  },
): AdvancedProviderSelection {
  const available = advancedProvidersForNode(providers, kind);
  const currentSource = current?.providerSource || 'zhenzhen';
  const currentId = String(current?.providerId || '').trim();
  if (currentSource !== 'zhenzhen' && currentId) {
    const provider = available.find((item) => item.id === currentId && item.protocol === currentSource);
    if (provider) {
      const models = advancedProviderModelOptions(provider, kind);
      const requested = String(current?.providerModel || '').trim();
      return {
        providerSource: provider.protocol,
        providerId: provider.id,
        providerModel: requested && models.includes(requested) ? requested : (models[0] || ''),
        provider,
        available: true,
      };
    }
  }
  return {
    providerSource: 'zhenzhen',
    providerId: '',
    providerModel: '',
    provider: null,
    available: false,
  };
}

const EXTERNAL_SIZE_BASE: Record<string, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
};

const EXTERNAL_RATIO_DIMS: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '4:3': [1152, 864],
  '3:4': [864, 1152],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '3:2': [1216, 832],
  '2:3': [832, 1216],
  '21:9': [1536, 640],
};

export function externalImageSizeFor(aspectRatio?: string, sizeLevel?: string): string {
  const ratio = String(aspectRatio || '').trim();
  const dims = EXTERNAL_RATIO_DIMS[ratio] || EXTERNAL_RATIO_DIMS['1:1'];
  const base = EXTERNAL_SIZE_BASE[String(sizeLevel || '').trim()] || 1024;
  const scale = base / 1024;
  const w = Math.max(256, Math.round((dims[0] * scale) / 64) * 64);
  const h = Math.max(256, Math.round((dims[1] * scale) / 64) * 64);
  return `${w}x${h}`;
}
