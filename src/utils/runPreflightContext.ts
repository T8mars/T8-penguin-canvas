import type { Edge, Node } from '@xyflow/react';
import { IMAGE_MODELS, VIDEO_MODELS, isFalModel, isFalVideoModel, ZHENZHEN_IMAGE_NB_21_MODEL, FLUX3_IMAGE_MODEL } from '../providers/models.ts';
import type { ApiSettings, AdvancedProviderConfig } from '../types/canvas.ts';
import type { AssetRef, CollaborationExecutionPolicySnapshot } from '../types/project.ts';
import { advancedProviderModelOptions, hasAdvancedProviderSecret } from './advancedProviders.ts';
import {
  secondaryProviderActionCapabilityHint,
  secondaryProviderActionFromNodeData,
} from './secondaryProviderAction.ts';
import {
  analyzeWorkflow,
  collectWorkflowAssetIds,
  type WorkflowAssetDiagnostic,
  type WorkflowIssue,
  type WorkflowProviderDiagnostic,
} from './workflowDoctor.ts';
import type {
  RunPreflightDiagnosticInput,
  RunPreflightDiagnosticsInput,
} from './runPreflight.ts';

export const RUN_PREFLIGHT_ASSET_LIMIT = 64;
export const RUN_PREFLIGHT_ASSET_CONCURRENCY = 6;

export type RunPreflightDiagnosticScopeMode = 'exact-plan' | 'selection-input-context';

export interface RunPreflightDiagnosticScope {
  mode: RunPreflightDiagnosticScopeMode;
  /** Nodes that will actually receive an execution token. */
  executionNodeIds: string[];
  /** Read-only direct input sources included only so their current outputs and ports can be inspected. */
  inputContextNodeIds: string[];
  nodes: Node[];
  edges: Edge[];
}

function uniqueIds(values: readonly string[]) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

/**
 * Builds the graph seen by preflight without changing the execution plan.
 *
 * A node run reads the current data of every directly connected upstream node
 * through ReactFlow, even when that upstream node is not part of the group being
 * executed. `selection-input-context` therefore adds exactly those one-hop input
 * sources and inbound edges. It deliberately does not recurse into an upstream
 * executable node: that node is not run and its own inputs are not read by the
 * selected node run.
 *
 * `exact-plan` trusts the caller's already materialized run/replay graph and does
 * not expand it. This keeps run-all and replay bound to their precise plan.
 */
export function buildRunPreflightDiagnosticScope(input: {
  nodes: readonly Node[];
  edges: readonly Edge[];
  executionNodeIds: readonly string[];
  mode: RunPreflightDiagnosticScopeMode;
}): RunPreflightDiagnosticScope {
  const executionNodeIds = uniqueIds(input.executionNodeIds);
  const executionIds = new Set(executionNodeIds);
  if (input.mode === 'exact-plan') {
    const graphNodeIds = new Set(input.nodes.map((node) => node.id));
    return {
      mode: input.mode,
      executionNodeIds,
      inputContextNodeIds: input.nodes
        .map((node) => node.id)
        .filter((nodeId) => graphNodeIds.has(nodeId) && !executionIds.has(nodeId)),
      nodes: [...input.nodes],
      edges: [...input.edges],
    };
  }

  // useUpstreamMaterials subscribes to target-side connections, so an inbound
  // edge is the exact boundary of data that the selected run can consume.
  const scopedEdges = input.edges.filter((edge) => executionIds.has(edge.target));
  const inputSourceIds = new Set(scopedEdges.map((edge) => edge.source));
  const graphNodeIds = new Set([...executionIds, ...inputSourceIds]);
  const scopedNodes = input.nodes.filter((node) => graphNodeIds.has(node.id));

  return {
    mode: input.mode,
    executionNodeIds,
    inputContextNodeIds: scopedNodes
      .map((node) => node.id)
      .filter((nodeId) => !executionIds.has(nodeId)),
    nodes: scopedNodes,
    edges: scopedEdges,
  };
}

const INPUT_CONTEXT_DIAGNOSTIC_RULES = new Set([
  // An ambiguous/unknown source cannot be trusted for port or material reads.
  'identity.duplicate-node-id',
  'registry.unknown-node-type',
  // These describe the material actually consumed by the selected node, rather
  // than whether the input-context node itself could be executed again.
  'asset.invalid',
  'content.empty-text',
  'payload.large-base64',
]);

/**
 * Removes node-local findings belonging only to read-only input context.
 * Edge findings remain in scope because an inbound edge (including its source
 * handle/type/capacity) directly controls what the selected node will read.
 */
export function scopeRunPreflightIssues(
  issues: readonly WorkflowIssue[],
  scope: RunPreflightDiagnosticScope,
): WorkflowIssue[] {
  const executionIds = new Set(scope.executionNodeIds);
  const graphNodeIds = new Set(scope.nodes.map((node) => node.id));
  const graphEdgeIds = new Set(scope.edges.map((edge) => edge.id));
  return issues.filter((issue) => {
    const nodeIds = issue.targetNodeIds || issue.nodeIds;
    const edgeIds = issue.targetEdgeIds || issue.edgeIds;
    if (nodeIds.some((nodeId) => executionIds.has(nodeId))) return true;
    if (edgeIds.some((edgeId) => graphEdgeIds.has(edgeId))) return true;

    // Exact persisted Run evidence and host policy apply to the requested action,
    // even when their diagnostic is canvas-scoped and has no node location.
    if (issue.ruleId.startsWith('run.') || issue.ruleId.startsWith('limits.')) return true;

    if (INPUT_CONTEXT_DIAGNOSTIC_RULES.has(issue.ruleId)
      && nodeIds.some((nodeId) => graphNodeIds.has(nodeId))) return true;

    // Scale notices describe the exact run/replay graph supplied by the caller;
    // a one-node selection must not inherit scale notices from the whole canvas.
    return scope.mode === 'exact-plan' && issue.ruleId.startsWith('scale.');
  });
}

const ADVANCED_KEY_PROTOCOLS = new Set(['openai-compatible', 'modelscope', 'volcengine', 'agnes']);

function configuredSecret(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function advancedProviderKeyConfigured(provider: AdvancedProviderConfig) {
  return provider.hasApiKey === true || hasAdvancedProviderSecret(provider.apiKey);
}

export function workflowProvidersFromSettings(settings: ApiSettings): WorkflowProviderDiagnostic[] {
  return (settings.advancedProviders || []).map((provider) => ({
    id: provider.id,
    source: provider.protocol,
    label: provider.label,
    enabled: provider.enabled === true,
    models: {
      image: advancedProviderModelOptions(provider, 'image'),
      video: advancedProviderModelOptions(provider, 'video'),
      llm: advancedProviderModelOptions(provider, 'llm'),
    },
    ...(provider.protocol === 'volcengine' ? {
      configuredRegion: String(provider.volcengineConfig?.region || '').trim(),
      // Generation uses the Ark bearer key. AK/SK do not replace it.
      regionCredentialConfigured: advancedProviderKeyConfigured(provider),
    } : {}),
  }));
}

function capabilityNotice(
  node: Node,
  code: string,
  title: string,
  severity: 'error' | 'warning' = 'error',
): RunPreflightDiagnosticInput {
  return {
    id: `${code}-${node.id}`,
    ruleId: code,
    severity,
    title,
    nodeIds: [node.id],
  };
}

function selectedProviderFields(node: Node) {
  const data = (node.data || {}) as Record<string, unknown>;
  const batchTagger = node.type === 'batch-tagger';
  return {
    source: String((batchTagger ? data.batchTagProviderSource : undefined) || data.providerSource || '').trim(),
    providerId: String((batchTagger ? data.batchTagProviderId : undefined) || data.providerId || '').trim(),
  };
}

function advancedProviderConfigurationNotice(node: Node, settings: ApiSettings) {
  const { source, providerId } = selectedProviderFields(node);
  if (!source || source === 'zhenzhen' || !providerId) return null;
  const provider = (settings.advancedProviders || []).find((item) => item.id === providerId && item.protocol === source);
  // Missing, disabled, and unsupported providers are diagnosed by analyzeWorkflow.
  if (!provider || provider.enabled !== true) return null;
  if (ADVANCED_KEY_PROTOCOLS.has(provider.protocol) && !advancedProviderKeyConfigured(provider)) {
    return capabilityNotice(
      node,
      'provider.credential-not-configured',
      `未检测到“${provider.label || provider.id}”的 API Key。请点击右上角齿轮打开“API 设置”，在扩展平台中填写并保存，然后重新运行。`,
    );
  }
  if (provider.protocol === 'comfyui') {
    const endpointConfigured = Boolean(String(provider.baseUrl || '').trim())
      || Boolean(provider.comfyuiConfig?.instances?.some((item) => String(item || '').trim()));
    if (!endpointConfigured) {
      return capabilityNotice(node, 'provider.endpoint-not-configured', `“${provider.label || provider.id}”没有可用的服务地址。请点击右上角齿轮打开“API 设置”，在扩展平台中填写服务地址并保存，然后重新运行。`);
    }
  }
  if (provider.protocol === 'jimeng-cli' && !String(provider.jimengConfig?.executablePath || '').trim()) {
    return capabilityNotice(node, 'provider.runtime-not-configured', `“${provider.label || provider.id}”没有配置本地运行程序。请点击右上角齿轮打开“API 设置”，填写程序路径并保存，然后重新运行。`);
  }
  return null;
}

type ClassifiedKeyField =
  | 'gptImageApiKey'
  | 'nanoBananaApiKey'
  | 'mjApiKey'
  | 'veoApiKey'
  | 'soraApiKey'
  | 'grokApiKey'
  | 'seedanceApiKey'
  | 'sunoApiKey';

const CLASSIFIED_KEY_LABELS: Record<ClassifiedKeyField, string> = {
  gptImageApiKey: 'gpt-image 系列',
  nanoBananaApiKey: 'nano-banana 系列',
  mjApiKey: 'Midjourney 系列',
  veoApiKey: 'Veo 系列',
  soraApiKey: 'Sora 系列',
  grokApiKey: 'Grok 系列',
  seedanceApiKey: 'Seedance 系列',
  sunoApiKey: 'Suno 系列',
};

function classifiedKeyField(hint: unknown): ClassifiedKeyField | null {
  const model = String(hint || '').toLowerCase();
  if (!model) return null;
  if (model.includes('gpt-image') || model.includes('gpt2') || model.includes('gpt_image') || model.includes('gptimage')) return 'gptImageApiKey';
  if (model.includes('nano-banana') || model.includes('nano_banana') || model.includes('nanobanana')
    || model.includes('flash-image') || model.includes('flash-lite-image') || model.includes('gemini-3-pro-image')) return 'nanoBananaApiKey';
  if (model.includes('midjourney') || /\bmj[-_/]/.test(model) || model.startsWith('mj') || model === 'mj') return 'mjApiKey';
  if (model.includes('veo')) return 'veoApiKey';
  if (model.includes('sora')) return 'soraApiKey';
  if (model.includes('grok')) return 'grokApiKey';
  if (model.includes('seedance')) return 'seedanceApiKey';
  if (model.includes('suno') || model.includes('chirp')) return 'sunoApiKey';
  return null;
}

function classifiedKeyConfigured(settings: ApiSettings, hint: unknown) {
  const field = classifiedKeyField(hint);
  return configuredSecret(settings.zhenzhenApiKey) || (field ? configuredSecret(settings[field]) : false);
}

function missingOverseasCredentialMessage(kind: string, hint: unknown) {
  const field = classifiedKeyField(hint);
  const target = field
    ? `“${CLASSIFIED_KEY_LABELS[field]}”分类 API Key；也可以填写“贞贞的AI工坊（海外） API Key”作为通用后备`
    : '“贞贞的AI工坊（海外） API Key”';
  return `未检测到当前${kind}所需的 API Key。请点击右上角齿轮打开“API 设置”，填写${target}，保存后重新运行。`;
}

function missingDomesticCredentialMessage() {
  return '未检测到“贞贞的平价AI小屋 API Key”。请点击右上角齿轮打开“API 设置”，填写并保存该 Key，然后重新运行。';
}

function selectedRuntimeCredentialGroup(data: Record<string, unknown>) {
  const providerParams = data.providerParams && typeof data.providerParams === 'object' && !Array.isArray(data.providerParams)
    ? data.providerParams as Record<string, unknown>
    : {};
  return String(providerParams.zhenzhenGroup || providerParams.t8Group || providerParams.group || '').trim();
}

function imageModelSelection(data: Record<string, unknown>) {
  const modelId = String(data.model || IMAGE_MODELS[0]?.id || '');
  const definition = IMAGE_MODELS.find((item) => item.id === modelId) || IMAGE_MODELS[0];
  const savedApiModel = String(data.apiModel || '');
  const apiModel = definition?.apiModelOptions.some((item) => item.value === savedApiModel)
    ? savedApiModel
    : String(definition?.apiModel || '');
  return { definition, apiModel };
}

function videoModelSelection(data: Record<string, unknown>) {
  const rawModel = String(data.model || '');
  const legacySora = /^sora-2(?:-\d{4}-\d{2}-\d{2})?$/.test(rawModel);
  const mainId = String(data.mainId || (legacySora
    ? 'sora-2'
    : VIDEO_MODELS.find((item) => item.id === rawModel || item.apiModelOptions.some((option) => option.value === rawModel))?.id)
    || VIDEO_MODELS[0]?.id
    || '');
  const definition = VIDEO_MODELS.find((item) => item.id === mainId) || VIDEO_MODELS[0];
  const apiModel = rawModel && definition?.apiModelOptions.some((option) => option.value === rawModel)
    ? rawModel
    : String(definition?.apiModelOptions[0]?.value || '');
  return { definition, apiModel };
}

function builtInCredentialNotice(node: Node, settings: ApiSettings): RunPreflightDiagnosticInput | null {
  const data = (node.data || {}) as Record<string, unknown>;
  const secondaryAction = secondaryProviderActionFromNodeData(data);
  if (secondaryAction) {
    const hint = secondaryProviderActionCapabilityHint(secondaryAction);
    if (hint.credential === 'gpt-image') {
      return classifiedKeyConfigured(settings, hint.model || 'gpt-image')
        ? null
        : capabilityNotice(node, 'provider.secondary-gpt-image-credential-missing', missingOverseasCredentialMessage('次级图像动作', hint.model || 'gpt-image'));
    }
    if (hint.credential === 'llm') {
      return configuredSecret(settings.llmApiKey)
        ? null
        : capabilityNotice(node, 'provider.secondary-llm-credential-missing', '未检测到次级 LLM 动作所需的“LLM 独立 API Key”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。');
    }
    if (hint.credential === 'runninghub-cn') {
      return configuredSecret(settings.rhApiKey)
        ? null
        : capabilityNotice(node, 'provider.secondary-runninghub-credential-missing', '未检测到次级 RunningHub 动作所需的“RH APIKEY国内”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。');
    }
  }
  const { source } = selectedProviderFields(node);

  if (node.type === 'story') {
    const mode = String(data.storyRunMode || 'all');
    const project = data.storyProject && typeof data.storyProject === 'object'
      ? data.storyProject as Record<string, unknown>
      : {};
    const shots = Array.isArray(project.shots) ? project.shots : [];
    const usesLlm = mode === 'analyze' || (mode === 'all' && shots.length === 0);
    if (!usesLlm) return null;
    if (source === 'seedance-nz' || data.llmApiSource === 'seedance-nz') {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(
            node,
            'provider.seedance-nz-credential-missing',
            '未检测到 Story 所选“贞贞的平价AI小屋”所需的 API Key。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。',
          );
    }
    if (source && source !== 'zhenzhen') return null;
    return configuredSecret(settings.llmApiKey)
      ? null
      : capabilityNotice(
          node,
          'provider.llm-credential-missing',
          '未检测到 Story 所选“贞贞AI工坊内置LLM”所需的独立 LLM API Key。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。',
        );
  }

  if (source && source !== 'zhenzhen') return null;

  if (node.type === 'image') {
    const { definition, apiModel } = imageModelSelection(data);
    if (definition?.id === FLUX3_IMAGE_MODEL || data.apiModel === ZHENZHEN_IMAGE_NB_21_MODEL) {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(node, 'provider.seedance-nz-credential-missing', missingDomesticCredentialMessage());
    }
    if (definition?.paramKind === 'seedream-v5' && data.seedreamApiSource === 'seedance-nz') {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(node, 'provider.seedance-nz-credential-missing', missingDomesticCredentialMessage());
    }
    if (isFalModel(apiModel)) {
      return configuredSecret(settings.zhenzhenApiKey)
        ? null
        : capabilityNotice(node, 'provider.zhenzhen-credential-missing', missingOverseasCredentialMessage('图像 FAL 模型', ''));
    }
    if (classifiedKeyConfigured(settings, apiModel)) return null;
    if (selectedRuntimeCredentialGroup(data)) {
      return capabilityNotice(node, 'provider.runtime-group-unverified', '所选运行分组的凭据只在主机执行时解析，体检不会猜测其可用性。', 'warning');
    }
    return capabilityNotice(node, 'provider.zhenzhen-credential-missing', missingOverseasCredentialMessage('图像模型', apiModel));
  }

  if (node.type === 'video') {
    const { definition, apiModel } = videoModelSelection(data);
    if (definition?.kind === 'happyhorse' || definition?.kind === 'hailuo' || definition?.kind === 'kling' || definition?.kind === 'upscaler' || definition?.kind === 'vidu' || definition?.kind === 'wan') {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(node, 'provider.seedance-nz-credential-missing', missingDomesticCredentialMessage());
    }
    if (isFalVideoModel(apiModel)) {
      return configuredSecret(settings.zhenzhenApiKey)
        ? null
        : capabilityNotice(node, 'provider.zhenzhen-credential-missing', missingOverseasCredentialMessage('视频 FAL 模型', ''));
    }
    if (classifiedKeyConfigured(settings, apiModel)) return null;
    if (selectedRuntimeCredentialGroup(data)) {
      return capabilityNotice(node, 'provider.runtime-group-unverified', '所选运行分组的凭据只在主机执行时解析，体检不会猜测其可用性。', 'warning');
    }
    return capabilityNotice(node, 'provider.zhenzhen-credential-missing', missingOverseasCredentialMessage('视频模型', apiModel));
  }

  if (node.type === 'seedance') {
    const selected = String(data.seedanceApiSource || 'zhenzhen-legacy');
    if (selected === 'seedance-nz' || (selected === 'auto' && configuredSecret(settings.zhenzhenSd2ApiKey))) {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(node, 'provider.seedance-nz-credential-missing', missingDomesticCredentialMessage());
    }
    if (classifiedKeyConfigured(settings, String(data.model || 'seedance'))) return null;
    if (selectedRuntimeCredentialGroup(data)) {
      return capabilityNotice(node, 'provider.runtime-group-unverified', '所选运行分组的凭据只在主机执行时解析，体检不会猜测其可用性。', 'warning');
    }
    return capabilityNotice(node, 'provider.seedance-credential-missing', missingOverseasCredentialMessage('Seedance 模型', String(data.model || 'seedance')));
  }

  if (node.type === 'audio') {
    if (
      ['seed-audio', 'whisper', 'qwen3-tts', 'minimax', 'mureka'].includes(String(data.audioProviderMode || ''))
      || (data.audioProviderMode === 'suno' && data.sunoPlatform === 'seedance-nz')
    ) {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(node, 'provider.seedance-nz-credential-missing', missingDomesticCredentialMessage());
    }
    return classifiedKeyConfigured(settings, 'suno')
      ? null
      : capabilityNotice(node, 'provider.suno-credential-missing', missingOverseasCredentialMessage('Suno 音频模型', 'suno'));
  }

  if (node.type === 'minimax-h3-official-prompt-enhancer') {
    return configuredSecret(settings.zhenzhenSd2ApiKey)
      ? null
      : capabilityNotice(
          node,
          'provider.seedance-nz-credential-missing',
          '未检测到 MiniMax H3 官方提示词增强器所需的“贞贞的平价AI小屋 API Key”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。',
        );
  }

  if (node.type === 'minimax-h3-prompt-enhancer' || node.type === 'minimax-music3-prompt-enhancer' || node.type === 'seedance20-prompt-enhancer') {
    const enhancerLabel = node.type === 'seedance20-prompt-enhancer'
      ? 'Seedance 2.0'
      : node.type === 'minimax-music3-prompt-enhancer' ? 'MiniMax Music 3' : 'MiniMax H3';
    if (data.llmApiSource !== 'zhenzhen') {
      return configuredSecret(settings.zhenzhenSd2ApiKey)
        ? null
        : capabilityNotice(
            node,
            'provider.seedance-nz-credential-missing',
            `未检测到 ${enhancerLabel} 默认渠道所需的“贞贞的平价AI小屋 API Key”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。`,
          );
    }
    return configuredSecret(settings.llmApiKey)
      ? null
      : capabilityNotice(node, 'provider.llm-credential-missing', `未检测到 ${enhancerLabel} 当前渠道所需的“贞贞的AI工坊-独立 LLM API Key”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。`);
  }

  if (node.type === 'llm' && data.llmApiSource === 'seedance-nz') {
    return configuredSecret(settings.zhenzhenSd2ApiKey)
      ? null
      : capabilityNotice(
          node,
          'provider.seedance-nz-credential-missing',
          '未检测到“贞贞的平价AI小屋 API Key”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。',
        );
  }

  if (node.type === 'llm' || node.type === 'batch-tagger') {
    return configuredSecret(settings.llmApiKey)
      ? null
      : capabilityNotice(node, 'provider.llm-credential-missing', '未检测到当前语言模型所需的“贞贞的AI工坊-独立 LLM API Key”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。');
  }

  if (['runninghub', 'runninghub-wallet', 'rh-tools', 'rh-toolbox'].includes(String(node.type || ''))) {
    const international = String(data.rhSite || '').toLowerCase() === 'intl';
    return configuredSecret(international ? settings.rhIntlApiKey : settings.rhApiKey)
      ? null
      : capabilityNotice(node, 'provider.runninghub-credential-missing', `未检测到 RunningHub ${international ? '海外站' : '国内站'}所需的“${international ? 'RH APIKEY海外' : 'RH APIKEY国内'}”。请点击右上角齿轮打开“API 设置”，填写并保存，然后重新运行。`);
  }

  if (node.type === 'fal-toolbox') {
    return configuredSecret(settings.zhenzhenApiKey)
      ? null
      : capabilityNotice(node, 'provider.zhenzhen-credential-missing', missingOverseasCredentialMessage('FAL 工具箱', ''));
  }
  return null;
}

/**
 * Returns only configured-state diagnostics. Secret values, masked suffixes,
 * local executable paths, and provider endpoints never enter the result.
 */
export function collectRunPreflightCapabilityDiagnostics(nodes: readonly Node[], settings: ApiSettings) {
  const diagnostics: RunPreflightDiagnosticInput[] = [];
  for (const node of nodes) {
    const advanced = advancedProviderConfigurationNotice(node, settings);
    if (advanced) diagnostics.push(advanced);
    const builtin = builtInCredentialNotice(node, settings);
    if (builtin) diagnostics.push(builtin);
  }
  return diagnostics;
}

export function workflowAssetsFromRecords(
  assetIds: readonly string[],
  records: ReadonlyMap<string, AssetRef | 'missing'>,
): WorkflowAssetDiagnostic[] {
  return [...new Set(assetIds.map(String).filter(Boolean))].sort().map((assetId) => {
    const record = records.get(assetId);
    if (!record || record === 'missing') return { id: assetId, availability: 'missing' };
    return {
      id: record.id,
      projectId: record.projectId,
      kind: record.kind,
      availability: record.availability,
    };
  });
}

function diagnosticFromIssue(issue: WorkflowIssue): RunPreflightDiagnosticInput {
  return {
    id: issue.id,
    ruleId: issue.ruleId,
    severity: issue.severity,
    title: issue.title,
    detail: issue.detail,
    nodeIds: issue.nodeIds,
  };
}

function issueDomain(issue: WorkflowIssue): keyof RunPreflightDiagnosticsInput {
  if (issue.ruleId.startsWith('asset.')) return 'asset';
  if (issue.ruleId.startsWith('limits.')) return 'policy';
  if (issue.ruleId === 'model.capability-mismatch' && issue.evidence.facts.variant === 'host-policy') return 'policy';
  if (issue.ruleId.startsWith('provider.') || issue.ruleId.startsWith('model.')) return 'capability';
  return 'structure';
}

export function splitRunPreflightDiagnostics(issues: readonly WorkflowIssue[]): RunPreflightDiagnosticsInput {
  const output: Record<keyof RunPreflightDiagnosticsInput, RunPreflightDiagnosticInput[]> = {
    structure: [],
    capability: [],
    asset: [],
    policy: [],
  };
  for (const issue of issues) {
    const domain = issueDomain(issue);
    const diagnostic = diagnosticFromIssue(issue);
    // A known host execution-policy violation is not advisory at dispatch
    // time. The server will reject it as well, so preflight must block instead
    // of offering an override confirmation.
    output[domain].push(domain === 'policy' ? { ...diagnostic, severity: 'error' } : diagnostic);
  }
  return output;
}

export function buildRunPreflightDiagnostics(input: {
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** Exact nodes that will receive execution tokens. Defaults to every input node for compatibility. */
  executionNodeIds?: readonly string[];
  /** Group/single runs use input context; run-all/replay pass an already exact plan graph. */
  scopeMode?: RunPreflightDiagnosticScopeMode;
  projectId: string;
  settings: ApiSettings;
  providersComplete: boolean;
  assets: WorkflowAssetDiagnostic[];
  policy: CollaborationExecutionPolicySnapshot | null;
  estimatedCost?: number;
}): RunPreflightDiagnosticsInput {
  const scope = buildRunPreflightDiagnosticScope({
    nodes: input.nodes,
    edges: input.edges,
    executionNodeIds: input.executionNodeIds || input.nodes.map((node) => node.id),
    mode: input.scopeMode || 'exact-plan',
  });
  const policy = input.policy?.policy;
  const usage = input.policy?.usage;
  const issues = analyzeWorkflow(scope.nodes, scope.edges, {
    projectId: input.projectId,
    providers: workflowProvidersFromSettings(input.settings),
    providersComplete: input.providersComplete,
    assets: input.assets,
    limits: policy ? {
      estimatedCost: Number.isFinite(input.estimatedCost) ? input.estimatedCost : undefined,
      costBudget: policy.perRunCostLimit > 0 ? policy.perRunCostLimit : undefined,
      dailyCost: usage?.dailyCost,
      dailyCostLimit: policy.dailyCostLimit,
      activeCount: usage?.activeCount,
      concurrencyLimit: policy.concurrencyLimit,
      allowedModels: policy.allowedModels,
    } : undefined,
  });
  const diagnostics = splitRunPreflightDiagnostics(scopeRunPreflightIssues(issues, scope));
  const executionIds = new Set(scope.executionNodeIds);
  diagnostics.capability = [
    ...diagnostics.capability,
    ...collectRunPreflightCapabilityDiagnostics(
      scope.nodes.filter((node) => executionIds.has(node.id)),
      input.settings,
    ),
  ];
  return diagnostics;
}

export function collectRunPreflightAssetIds(nodes: readonly Node[]) {
  return collectWorkflowAssetIds([...nodes]);
}
