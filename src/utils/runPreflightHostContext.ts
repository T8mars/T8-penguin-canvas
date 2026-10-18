import type { ApiSettings, AdvancedProviderConfig } from '../types/canvas.ts';
import type {
  AssetRef,
  CollaborationExecutionPolicySnapshot,
  RunIntent,
} from '../types/project.ts';
import { sha256Hex } from './incrementalSha256.ts';

export const RUN_PREFLIGHT_HOST_CONTEXT_DIGEST_ALGORITHM = 'sha256' as const;

export interface RunPreflightHostContextInput {
  settings: ApiSettings;
  assetIds: readonly string[];
  assetRecords: ReadonlyMap<string, AssetRef | 'missing'>;
  policy: CollaborationExecutionPolicySnapshot | null;
  runIntent?: Pick<
    RunIntent,
    'id' | 'projectId' | 'canvasId' | 'canvasRevision' | 'nodeIds' | 'provider'
      | 'model' | 'estimatedCost' | 'estimatedCostKnown' | 'executionAuthority'
      | 'status' | 'runId' | 'createdAt' | 'updatedAt'
  > | null;
}

const BUILT_IN_KEY_FIELDS = [
  'zhenzhenApiKey',
  'zhenzhenSd2ApiKey',
  'rhApiKey',
  'rhIntlApiKey',
  'llmApiKey',
  'gptImageApiKey',
  'nanoBananaApiKey',
  'mjApiKey',
  'veoApiKey',
  'soraApiKey',
  'grokApiKey',
  'seedanceApiKey',
  'sunoApiKey',
] as const;

const BUILT_IN_ENDPOINT_FIELDS = [
  'zhenzhenBaseUrl',
  'zhenzhenSd2BaseUrl',
  'rhBaseUrl',
  'rhIntlBaseUrl',
  'llmBaseUrl',
] as const;

const SENSITIVE_KEY = /(?:api[-_ ]?key|access[-_ ]?key|secret|token|credential|password|passwd|authorization|cookie|signature|private[-_ ]?key|client[-_ ]?secret)/i;
const LOCATION_KEY = /(?:url|endpoint|path|directory|folder|instance|executable|distro)/i;
const MAX_DEPTH = 10;
const MAX_FIELDS = 20_000;
const MAX_KEYS = 512;
const MAX_ARRAY_ITEMS = 2_048;

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function digestText(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}

function configured(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : value === true;
}

function sortedStrings(values: unknown) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort()
    : [];
}

interface ProjectionBudget {
  remaining: number;
  active: WeakSet<object>;
}

/**
 * Produces a bounded, non-reversible projection for provider defaults and
 * workflow configuration. Secret fields expose configured-state only; host
 * locations/endpoints are represented by a one-way fingerprint and never
 * enter the preview as plaintext.
 */
function safeConfigProjection(
  value: unknown,
  budget: ProjectionBudget,
  key = '',
  depth = 0,
): unknown {
  if (budget.remaining <= 0) throw new Error('运行体检主机上下文超过字段上限');
  budget.remaining -= 1;
  if (SENSITIVE_KEY.test(key)) return { configured: configured(value) };
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    const normalized = value.trim();
    return LOCATION_KEY.test(key)
      ? { configured: normalized.length > 0, fingerprint: normalized ? digestText(normalized) : null }
      : normalized;
  }
  if (typeof value !== 'object') return { kind: typeof value };
  if (depth >= MAX_DEPTH) throw new Error('运行体检主机上下文超过嵌套上限');
  if (budget.active.has(value)) return { kind: 'cycle' };
  budget.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new Error('运行体检主机上下文数组超过上限');
      return value.map((item) => safeConfigProjection(item, budget, key, depth + 1));
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    if (keys.length > MAX_KEYS) throw new Error('运行体检主机上下文字段过多');
    return Object.fromEntries(keys.map((childKey) => {
      const descriptor = descriptors[childKey];
      return [
        childKey,
        descriptor && 'value' in descriptor
          ? safeConfigProjection(descriptor.value, budget, childKey, depth + 1)
          : { kind: 'accessor' },
      ];
    }));
  } finally {
    budget.active.delete(value);
  }
}

function providerProjection(provider: AdvancedProviderConfig) {
  const budget: ProjectionBudget = { remaining: MAX_FIELDS, active: new WeakSet<object>() };
  return {
    id: String(provider.id || ''),
    protocol: provider.protocol,
    profile: provider.profile || '',
    authMode: provider.authMode || '',
    enabled: provider.enabled === true,
    allowRemote: provider.allowRemote === true,
    credentialConfigured: provider.hasApiKey === true || configured(provider.apiKey),
    endpoint: safeConfigProjection(provider.baseUrl || '', budget, 'baseUrl'),
    models: {
      image: sortedStrings(provider.imageModels),
      video: sortedStrings(provider.videoModels),
      chat: sortedStrings(provider.chatModels),
    },
    defaults: safeConfigProjection(provider.defaults || {}, budget, 'defaults'),
    modelscope: safeConfigProjection(provider.modelscopeConfig || {}, budget, 'modelscopeConfig'),
    volcengine: {
      project: String(provider.volcengineConfig?.project || ''),
      region: String(provider.volcengineConfig?.region || ''),
      accessKeyConfigured: provider.volcengineConfig?.hasAccessKeyId === true
        || configured(provider.volcengineConfig?.accessKeyId),
      secretConfigured: provider.volcengineConfig?.hasSecretAccessKey === true
        || configured(provider.volcengineConfig?.secretAccessKey),
    },
    comfyui: safeConfigProjection(provider.comfyuiConfig || {}, budget, 'comfyuiConfig'),
    jimeng: safeConfigProjection(provider.jimengConfig || {}, budget, 'jimengConfig'),
  };
}

function settingsProjection(settings: ApiSettings) {
  const record = settings as unknown as Record<string, unknown>;
  return {
    builtInCredentials: Object.fromEntries(BUILT_IN_KEY_FIELDS.map((field) => [field, configured(record[field])])),
    builtInEndpoints: Object.fromEntries(BUILT_IN_ENDPOINT_FIELDS.map((field) => {
      const value = String(record[field] || '').trim();
      return [field, { configured: Boolean(value), fingerprint: value ? digestText(value) : null }];
    })),
    providers: [...(settings.advancedProviders || [])]
      .map(providerProjection)
      .sort((left, right) => left.id.localeCompare(right.id) || left.protocol.localeCompare(right.protocol)),
  };
}

function assetsProjection(input: RunPreflightHostContextInput) {
  return [...new Set(input.assetIds.map(String).filter(Boolean))].sort().map((assetId) => {
    const asset = input.assetRecords.get(assetId);
    if (!asset) return { id: assetId, readState: 'unavailable' };
    if (asset === 'missing') return { id: assetId, readState: 'missing' };
    return {
      id: asset.id,
      entityUid: asset.entityUid,
      projectId: asset.projectId,
      kind: asset.kind,
      contentHash: asset.contentHash || null,
      storageMode: asset.storageMode,
      availability: asset.availability,
      organizationRevision: asset.organizationRevision || null,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt || null,
    };
  });
}

function policyProjection(snapshot: CollaborationExecutionPolicySnapshot | null) {
  if (!snapshot) return null;
  return {
    policy: {
      projectId: snapshot.policy.projectId,
      allowedModels: sortedStrings(snapshot.policy.allowedModels),
      dailyCostLimit: Number(snapshot.policy.dailyCostLimit) || 0,
      perRunCostLimit: Number(snapshot.policy.perRunCostLimit) || 0,
      concurrencyLimit: Number(snapshot.policy.concurrencyLimit) || 0,
      updatedAt: snapshot.policy.updatedAt || null,
    },
    usage: {
      activeCount: Number(snapshot.usage.activeCount) || 0,
      dailyCost: Number(snapshot.usage.dailyCost) || 0,
      unknownCostCount: Number(snapshot.usage.unknownCostCount) || 0,
      dayStart: Number(snapshot.usage.dayStart) || 0,
    },
  };
}

function runIntentProjection(intent: RunPreflightHostContextInput['runIntent']) {
  if (!intent) return null;
  return {
    id: intent.id,
    projectId: intent.projectId,
    canvasId: intent.canvasId,
    canvasRevision: intent.canvasRevision,
    nodeIds: [...new Set(intent.nodeIds.map(String).filter(Boolean))].sort(),
    provider: intent.provider || null,
    model: intent.model || null,
    estimatedCostKnown: intent.estimatedCostKnown === true,
    estimatedCost: intent.estimatedCostKnown === true
      ? Math.max(0, Number(intent.estimatedCost) || 0)
      : null,
    executionAuthority: intent.executionAuthority ? {
      schema: intent.executionAuthority.schema,
      requestedNodeIds: sortedStrings(intent.executionAuthority.requestedNodeIds),
      authorizedNodeIds: sortedStrings(intent.executionAuthority.authorizedNodeIds),
      declarations: [...intent.executionAuthority.declarations]
        .map((entry) => ({
          provider: String(entry.provider || ''),
          model: String(entry.model || ''),
          nodeIds: sortedStrings(entry.nodeIds),
        }))
        .sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)),
      cost: {
        known: intent.executionAuthority.cost?.known === true,
        currency: intent.executionAuthority.cost?.currency || null,
        amount: intent.executionAuthority.cost?.known === true
          ? Math.max(0, Number(intent.executionAuthority.cost.amount) || 0)
          : null,
        reasonCode: intent.executionAuthority.cost?.reasonCode || null,
      },
    } : null,
    status: intent.status,
    runId: intent.runId || null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

export function createRunPreflightHostContextDigest(input: RunPreflightHostContextInput) {
  const projection = {
    schema: 't8-run-preflight-host-context-v1',
    settings: settingsProjection(input.settings),
    assets: assetsProjection(input),
    policy: policyProjection(input.policy),
    runIntent: runIntentProjection(input.runIntent),
  };
  return `${RUN_PREFLIGHT_HOST_CONTEXT_DIGEST_ALGORITHM}:${digestText(stableJson(projection))}`;
}
