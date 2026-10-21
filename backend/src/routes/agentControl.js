const express = require('express');
const path = require('path');
const config = require('../config');
const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const {
  AgentControlAuthError,
  agentControlAuthService,
} = require('../services/agentControlAuth');
const { DEFAULT_PROJECT_ID } = require('../collaboration/protocol');
const { getProjectDatabase } = require('../services/projectDatabase');
const { CanvasAgentToolError, executeCanvasAgentTool } = require('../services/canvasAgentTools');
const { mapCanvasMutationError, safeCanvasPatchErrorMessage } = require('../services/canvasPatch');
const {
  AgentControlApprovalError,
  agentControlApprovalService,
  createAgentControlApprovalBinding,
} = require('../services/agentControlApprovals');
const {
  AgentControlAssetError,
  assetImportMaxBytes,
  createAgentControlAssetService,
  publicImportPreview,
  resolveAppliedAssetPlacement,
} = require('../services/agentControlAssets');
const {
  AgentControlDeliveryError,
  createAgentControlDeliveryService,
} = require('../services/agentControlDelivery');
const {
  AgentControlBrowserError,
  createBrowserHandoff,
} = require('../services/agentControlBrowser');
const {
  AgentControlRunError,
  createAgentControlRunService,
  requireRunOperationId,
} = require('../services/agentControlRuns');
const {
  AgentControlCreativeError,
  createAgentControlCreativeService,
} = require('../services/agentControlCreative');
const {
  approvalBoundaryForDecisions,
  assertCreatorModelDecisionReceipt,
  createCreatorModelDecision,
  modelPreferenceNeedsDynamicCatalog,
  modelPreferencesFromCreativeInput,
  runtimeDecisionModels,
} = require('../services/creatorAgentModelDecision');
const { compatibilitySnapshot } = require('../services/agentControlCompatibility');
const { ACTIVE_CONTEXT_SCHEMA, agentControlContextService } = require('../services/agentControlContext');
const {
  publicCreativeCapabilities,
  publicCreativeCapabilityGraph,
} = require('../services/agentControlCapabilities');
const {
  AgentControlCapabilityToolError,
  createAgentControlCapabilityToolService,
} = require('../services/agentControlCapabilityTools');
const {
  CreatorAgentSessionError,
  creatorAttachmentOnlyPrompt,
  createCreatorAgentSessionStore,
  inferCreatorKind,
  inferCreatorRecipe,
  normalizeAttachments,
  normalizeContext,
} = require('../services/creatorAgentSessions');
const {
  canonicalCreatorCanvasLifecycle,
  replayCreatorCanvasPlanStates,
} = require('../services/creatorAgentProductionEvidence');

const AGENT_CONTROL_HTTP_SCHEMA = 't8-agent-control-http-v1';
const AGENT_CONTROL_REQUEST_LIMIT = 64 * 1024;

function response(data = {}) {
  return {
    schema: AGENT_CONTROL_HTTP_SCHEMA,
    ok: true,
    ...data,
  };
}

function bearerToken(req) {
  const authorization = String(req.get('authorization') || '').trim();
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization);
  return match ? match[1] : '';
}

function creatorContextForVerifiedNodes(value, document) {
  const input = normalizeContext(value);
  const nodeById = new Map(
    (Array.isArray(document?.nodes) ? document.nodes : [])
      .map((node) => [String(node?.id || '').trim(), node])
      .filter(([id]) => Boolean(id)),
  );
  const referencedNodeIds = input.referencedNodeIds;
  const missingNodeIds = referencedNodeIds.filter((nodeId) => !nodeById.has(nodeId));
  if (missingNodeIds.length > 0) {
    throw new CreatorAgentSessionError(
      'CREATOR_REFERENCE_NODE_NOT_FOUND',
      `引用的画布节点不存在或已被删除：${missingNodeIds.join('、')}`,
      409,
    );
  }
  return normalizeContext({
    ...input,
    canvasRevision: Number(document?.revision) || 0,
    referencedNodeIds,
    referencedNodeTypes: referencedNodeIds.map((nodeId) => String(nodeById.get(nodeId)?.type || 'unknown')),
  });
}

function scopeAgentPatch(rawPatch, scope) {
  const source = rawPatch && typeof rawPatch === 'object' && !Array.isArray(rawPatch) ? rawPatch : {};
  const patch = {
    ...source,
    operations: Array.isArray(source.operations) ? source.operations.map((rawOperation) => ({
      ...(rawOperation && typeof rawOperation === 'object' && !Array.isArray(rawOperation) ? rawOperation : {}),
      projectId: scope.projectId,
      canvasId: scope.canvasId,
      actorId: scope.actorId,
      sessionId: scope.sessionId,
    })) : source.operations,
  };
  for (const key of ['projectId', 'canvasId', 'actorId', 'sessionId']) delete patch[key];
  return patch;
}

function agentPatchAuthority() {
  return { source: 'agent', role: 'agent', capabilities: [] };
}

function creativePlanApprovalBinding(plan, scope) {
  const modelDecisionReceipt = plan?.modelDecisionReceipt
    ? assertCreatorModelDecisionReceipt(plan.modelDecisionReceipt)
    : null;
  const approvalBoundary = modelDecisionReceipt?.approvalBoundary
    || approvalBoundaryForDecisions([]);
  return createAgentControlApprovalBinding({
    action: 'creative.apply',
    sessionId: scope.sessionId,
    projectId: scope.projectId,
    canvasId: scope.canvasId,
    subject: {
      kind: 'creative-plan',
      action: String(plan?.action || ''),
      creativeKind: String(plan?.kind || ''),
    },
    subjectVersionDigest: plan?.planDigest,
    planDigest: plan?.planDigest,
    modelDecisionDigest: modelDecisionReceipt?.receiptDigest,
    boundary: {
      ...approvalBoundary,
      providerTransfer: {
        status: 'approval-required',
        occursNow: false,
        scope: 'canvas-structure-only',
      },
    },
  });
}

function runPlanApprovalBinding(plan, scope, action, retryOf = '') {
  const requestedNodeIds = [...new Set((Array.isArray(plan?.requestedNodeIds) ? plan.requestedNodeIds : [])
    .map((nodeId) => String(nodeId || ''))
    .filter(Boolean))]
    .sort();
  const providerSelections = (Array.isArray(plan?.declarations) ? plan.declarations : [])
    .map((declaration) => ({
      provider: String(declaration?.provider || ''),
      model: String(declaration?.model || ''),
      nodeIds: [...new Set((Array.isArray(declaration?.nodeIds) ? declaration.nodeIds : [])
        .map((nodeId) => String(nodeId || ''))
        .filter(Boolean))]
        .sort(),
    }))
    .sort((left, right) => `${left.provider}:${left.model}:${left.nodeIds.join(',')}`
      .localeCompare(`${right.provider}:${right.model}:${right.nodeIds.join(',')}`));
  return createAgentControlApprovalBinding({
    action,
    sessionId: scope.sessionId,
    projectId: scope.projectId,
    canvasId: scope.canvasId,
    subject: {
      kind: 'run-plan',
      action,
      requestedNodeIds,
      ...(retryOf ? { retryOf: String(retryOf) } : {}),
    },
    subjectVersionDigest: plan?.planDigest,
    planDigest: plan?.planDigest,
    boundary: {
      providerSelections,
      providerTransfer: {
        status: 'approval-required',
        occursNow: false,
        scope: 'after-approval-only',
      },
    },
  });
}

function publicPatchMutationResult(result) {
  const patchId = String(result?.patchId || '');
  const revision = Number(result?.revision);
  if (!patchId || !Number.isSafeInteger(revision) || revision < 1) {
    throw new AgentControlApprovalError(
      'PATCH_COMMIT_RESULT_INVALID',
      '画布已返回无效的提交结果；请重新读取画布确认实际状态',
      500,
    );
  }
  return {
    patchId,
    status: String(result?.status || ''),
    duplicate: result?.duplicate === true,
    baseRevision: result?.baseRevision == null ? null : Number(result.baseRevision),
    revision,
    acknowledgementCount: Array.isArray(result?.acknowledgements) ? result.acknowledgements.length : 0,
  };
}

function agentPatchMirrorWarnings(canvasId, result, database, options = {}) {
  const fallback = [{
    code: 'legacy_canvas_mirror_failed',
    message: 'Patch 已由 SQLite 成功提交，但兼容画布镜像暂未同步；重新读取画布时会重试修复。',
  }];
  try {
    const writer = options.mirrorWriter
      || require('./canvas').writeAuthoritativeCanvasCompatibilityMirrors;
    if (typeof writer !== 'function') return fallback;
    const warnings = writer(
      canvasId,
      result?.document,
      database,
      {
        messages: require('./canvas').PATCH_MIRROR_WARNING_MESSAGES,
        logLabel: 'agent-control-patch',
      },
    );
    return Array.isArray(warnings) ? warnings : [];
  } catch (_) {
    return fallback;
  }
}
function runtimeReadinessFallback(item) {
  const configured = item?.configured === true;
  return {
    known: true,
    installed: true,
    credentialReady: configured,
    regionReady: null,
    executable: false,
    available: configured,
    requiresRuntimeCheck: true,
    blockers: [
      ...(!configured ? [{ code: 'runtime_credential_missing', message: '当前自定义平台尚未启用或未完成凭据配置' }] : []),
      { code: 'runtime_region_unknown', message: '尚未通过当前桌面会话确认自定义平台的线路与模型可执行' },
    ],
  };
}

function modelCatalogWithReadiness(catalog, capabilityGraph) {
  const runtimeById = new Map(
    (capabilityGraph?.runtime?.entries || []).map((entry) => [String(entry?.id || ''), entry]),
  );
  const decorate = (item) => {
    const runtime = runtimeById.get(String(item?.id || ''));
    const readiness = runtime?.readiness || runtimeReadinessFallback(item);
    return {
      ...item,
      configured: readiness.credentialReady === true,
      available: readiness.available === true,
      readiness,
    };
  };
  const items = (catalog?.items || []).map(decorate);
  const actions = (catalog?.actions || []).map(decorate);
  const summarize = (entries) => ({
    known: entries.length,
    executable: entries.filter((entry) => entry.readiness.executable === true).length,
    blocked: entries.filter((entry) => entry.readiness.executable !== true).length,
  });
  return {
    ...catalog,
    items,
    actions,
    readinessSummary: {
      models: summarize(items),
      actions: summarize(actions),
      runtime: capabilityGraph?.readinessSummary || null,
    },
    warning: `${String(catalog?.warning || '').trim()} 已知模型不等于当前可执行；请选择 executable=true 且无阻断项的模型。`.trim(),
  };
}

function createAgentControlRouter(options = {}) {
  const router = express.Router();
  const auth = options.auth || agentControlAuthService;
  const approvals = options.approvals || agentControlApprovalService;
  const runtimeConfig = options.config || config;
  const database = () => options.database || getProjectDatabase(runtimeConfig);
  let lazyAssetService = options.assetService || null;
  const assets = () => {
    if (!lazyAssetService) {
      lazyAssetService = createAgentControlAssetService({
        config: runtimeConfig,
        database: database(),
      });
    }
    return lazyAssetService;
  };
  let lazyDeliveryService = options.deliveryService || null;
  const delivery = () => {
    if (!lazyDeliveryService) {
      lazyDeliveryService = createAgentControlDeliveryService({
        database: database(),
      });
    }
    return lazyDeliveryService;
  };
  let lazyRunService = options.runService || null;
  const runs = () => {
    if (!lazyRunService) {
      lazyRunService = createAgentControlRunService({
        database: database(),
      });
    }
    return lazyRunService;
  };
  let lazyCreativeService = options.creativeService || null;
  const creative = () => {
    if (!lazyCreativeService) {
      lazyCreativeService = createAgentControlCreativeService({
        database: database(),
        settingsFile: runtimeConfig.SETTINGS_FILE,
        settingsProvider: options.settingsProvider,
      });
    }
    return lazyCreativeService;
  };
  const assertCreativeApprovalStillCurrent = (record) => {
    if (record?.action !== 'creative.apply') return;
    const scope = {
      projectId: String(record.projectId || ''),
      canvasId: String(record.canvasId || ''),
      actorId: String(record.actorId || ''),
      sessionId: String(record.sessionId || ''),
    };
    const plan = creative().requirePlan(record.payload?.planId, scope);
    const expectedPlanDigest = String(record.payload?.planDigest || '').toLowerCase();
    const currentBinding = creativePlanApprovalBinding(plan, scope);
    if (!expectedPlanDigest
      || expectedPlanDigest !== String(plan.planDigest || '').toLowerCase()
      || !record.approvalBinding
      || currentBinding.bindingDigest !== record.approvalBinding.bindingDigest) {
      throw new AgentControlApprovalError(
        'APPROVAL_STALE',
        '这个确认对应的创作计划、模型或执行边界已经变化；未写入画布，请重新生成计划并确认',
        409,
      );
    }
    if (!plan.modelDecisionReceipt) return;
    const receipt = assertCreatorModelDecisionReceipt(plan.modelDecisionReceipt);
    if (String(receipt.catalogDigest || '') !== String(creativeModelCatalog.sourceDigest || '')) {
      throw new AgentControlApprovalError(
        'APPROVAL_STALE',
        '模型目录已更新；旧确认不会继续执行，请核对新的模型回执后重新确认',
        409,
      );
    }
    const capabilityGraph = publicCreativeCapabilityGraph({
      settingsFile: runtimeConfig.SETTINGS_FILE,
      credentialSettingsProvider: options.credentialSettingsProvider,
      runtimeStatusProvider: options.runtimeStatusProvider,
    });
    const runtimeById = new Map(
      (capabilityGraph?.runtime?.entries || []).map((entry) => [String(entry?.id || ''), entry]),
    );
    const staleDecision = (receipt.decisions || [])
      .filter((decision) => decision?.required === true && decision?.selected)
      .find((decision) => runtimeById.get(String(decision.selected.id || ''))?.readiness?.executable !== true);
    if (staleDecision) {
      throw new AgentControlApprovalError(
        'APPROVAL_STALE',
        `${String(staleDecision.kindLabel || staleDecision.kind || '所选')}模型的凭据、组件或线路状态已变化；未写入画布，请重新规划并确认`,
        409,
      );
    }
  };
  const creativeInputWithVerifiedReferences = (value, scope) => {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const document = database().getCanvas(scope.canvasId);
    if (!document || String(document.projectId || '') !== String(scope.projectId || '')) {
      throw new CreatorAgentSessionError(
        'CREATOR_SCOPE_NOT_FOUND',
        '当前项目或画布不存在，无法验证节点引用',
        404,
      );
    }
    const referenceContext = creatorContextForVerifiedNodes({
      referencedNodeIds: input.referencedNodeIds,
    }, document);
    return {
      ...input,
      referencedNodeIds: referenceContext.referencedNodeIds,
      referencedNodeTypes: referenceContext.referencedNodeTypes,
    };
  };
  const creativeInputWithAttachments = (value, scope) => {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const assetIds = [...new Set([
      ...(Array.isArray(input.assetIds) ? input.assetIds : []),
      ...(Array.isArray(input.attachments)
        ? input.attachments.map((attachment) => attachment?.assetId)
        : []),
    ].map((assetId) => String(assetId || '').trim()).filter(Boolean))];
    const directAttachments = Array.isArray(input.attachments) ? input.attachments : [];
    const transientAttachments = directAttachments
      .filter((attachment) => !String(attachment?.assetId || '').trim());
    const resolvedAttachments = assetIds
      .slice(0, 16)
      .map((assetId) => {
        const asset = assets().inspect(assetId, scope.projectId);
        const kind = ['image', 'video', 'audio', 'text'].includes(String(asset?.kind || '').toLowerCase())
          ? String(asset.kind).toLowerCase()
          : 'file';
        const metadata = asset?.metadata && typeof asset.metadata === 'object'
          && !Array.isArray(asset.metadata) ? asset.metadata : {};
        return {
          id: `asset:${assetId}`,
          assetId,
          kind,
          name: String(asset?.filename || assetId),
          ref: `/api/project-assets/${encodeURIComponent(assetId)}/media`,
          mimeType: String(asset?.mimeType || ''),
          size: Math.max(0, Number(asset?.sizeBytes ?? asset?.size) || 0),
          contentHash: String(asset?.contentHash || '').toLowerCase().replace(/^sha256:/, ''),
          contentRevision: Math.max(1, Number(asset?.contentRevision || asset?.revision) || 1),
          width: Math.max(0, Number(asset?.width ?? metadata.width) || 0),
          height: Math.max(0, Number(asset?.height ?? metadata.height) || 0),
          duration: Math.max(
            0,
            Number(asset?.duration ?? asset?.durationSec ?? metadata.duration ?? metadata.durationSec) || 0,
          ),
        };
      });
    // Persisted Asset metadata is authoritative. Client-supplied metadata for the
    // same assetId must not downgrade a video/audio/file into a cheaper input kind.
    const attachments = normalizeAttachments([...transientAttachments, ...resolvedAttachments]);
    const requestedText = String(
      input.prompt || input.script || input.goal || input.query || '',
    ).trim();
    const prompt = requestedText || creatorAttachmentOnlyPrompt(attachments);
    const kind = String(input.kind || '').trim().toLowerCase()
      || inferCreatorKind(prompt, attachments);
    const recipe = Object.prototype.hasOwnProperty.call(input, 'recipe')
      ? String(input.recipe || 'general').trim().toLowerCase()
      : inferCreatorRecipe(prompt, kind, attachments);
    return creativeInputWithVerifiedReferences({
      ...input,
      assetIds,
      attachments,
      ...(requestedText ? {} : { prompt }),
      kind,
      recipe,
    }, scope);
  };
  const creativeInputWithModelDecision = (value, scope) => {
    const input = creativeInputWithAttachments(value, scope);
    const preferences = modelPreferencesFromCreativeInput(input);
    const capabilityGraph = publicCreativeCapabilityGraph({
      settingsFile: runtimeConfig.SETTINGS_FILE,
      credentialSettingsProvider: options.credentialSettingsProvider,
      runtimeStatusProvider: options.runtimeStatusProvider,
    });
    const dynamicItems = modelPreferenceNeedsDynamicCatalog(creativeModelCatalog, preferences)
      ? creative().models({}, scope).items || []
      : [];
    const modelDecision = createCreatorModelDecision({
      kind: input.kind,
      attachments: Array.isArray(input.attachments) ? input.attachments : [],
      preferences,
      models: runtimeDecisionModels({
        catalog: creativeModelCatalog,
        capabilityGraph,
        dynamicItems,
      }),
      catalogDigest: creativeModelCatalog.sourceDigest,
      ratio: input.ratio,
      duration: input.duration ?? input.durationSec,
      profile: input.profile || 'balanced',
    });
    if (modelDecision.errors.length > 0) {
      const first = modelDecision.errors[0];
      throw new AgentControlCreativeError(first.code, first.message, 409, {
        modelKind: first.kind,
        silentFallback: false,
      });
    }
    return {
      ...input,
      modelDecisionReceipt: modelDecision.receipt,
      ...modelDecision.modelFields,
    };
  };
  const documentForCapabilityTool = (scope) => {
    const document = database().getCanvas(scope.canvasId);
    if (!document || String(document.projectId || '') !== String(scope.projectId || '')) {
      throw new AgentControlCapabilityToolError(
        'CAPABILITY_TOOL_SCOPE_NOT_FOUND',
        '高层能力目标不存在或不属于当前项目',
        404,
      );
    }
    return document;
  };
  const dispatchCapabilityTool = async ({
    requestAction,
    operation,
    input,
    scope,
    binding,
  }) => {
    if (binding.service === 'agentControlCreative' && binding.method === 'createPlan') {
      const kind = String(binding.operation || requestAction.replace(/^create\./, '')).trim();
      const plan = creative().createPlan(
        creativeInputWithModelDecision({ ...input, kind: input.kind || kind }, scope),
        scope,
      );
      const approvalBinding = creativePlanApprovalBinding(plan, scope);
      return { ...plan, approvalBinding };
    }
    if (binding.service === 'agentControlCreative' && binding.method === 'actionPlan') {
      const plan = creative().actionPlan(
        String(binding.operation || requestAction),
        creativeInputWithVerifiedReferences(input, scope),
        scope,
      );
      const approvalBinding = creativePlanApprovalBinding(plan, scope);
      return { ...plan, approvalBinding };
    }
    if (binding.service === 'agentControlCreative' && binding.method === 'readAction') {
      return creative().readAction(String(binding.operation || requestAction), input, scope);
    }
    if (binding.service === 'agentControlRuns' && binding.method === 'startPreview') {
      return runs().startPreview(input.planId, scope);
    }
    if (binding.service === 'agentControlAssets' && binding.method === 'inspectPlace') {
      const document = documentForCapabilityTool(scope);
      const snapshot = await assets().inspectPlace(input.assetId, document, {
        projectId: scope.projectId,
        position: input.position,
        targetNodeId: input.targetNodeId,
        sourceHandle: input.sourceHandle,
        targetHandle: input.targetHandle,
      });
      const patch = scopeAgentPatch(snapshot.patch, scope);
      // The read-only capability must recover the same immutable placement as
      // the approval route, rather than simulate adding its existing node again.
      const recovery = resolveAppliedAssetPlacement(database(), scope.canvasId, { ...snapshot, patch });
      const patchPreview = recovery.status === 'applied'
        ? {
            patchId: recovery.patch.id,
            baseRevision: recovery.application.baseRevision,
            currentRevision: recovery.application.baseRevision,
            previewDigest: recovery.application.previewDigest,
            summary: recovery.application.summary,
            diagnosticsResolved: recovery.application.diagnosticsResolved || [],
            affectedNodeIds: recovery.application.affectedNodeIds || [],
            affectedEdgeIds: recovery.application.affectedEdgeIds || [],
            changes: recovery.application.changes || [],
            warnings: [],
          }
        : database().previewCanvasPatch(scope.canvasId, patch, {
            actorId: scope.actorId,
            sessionId: scope.sessionId,
            projectId: scope.projectId,
            authority: agentPatchAuthority(),
          });
      return {
        preview: {
          ...patchPreview,
          riskLevel: 'L1',
          providerTransfer: {
            occursNow: false,
            scope: 'none',
            message: '本次只预览把已持久素材放入画布，不读取外部文件，也不会调用 AI Provider。',
          },
        },
        asset: snapshot.asset,
        placement: snapshot.placement,
      };
    }
    if (binding.service === 'agentControlAssets' && binding.method === 'inspectImport') {
      const document = documentForCapabilityTool(scope);
      const snapshot = await assets().inspectImport(input.filePath);
      return publicImportPreview(snapshot, {
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        canvasRevision: document.revision,
      });
    }
    if (binding.service === 'agentControlDelivery' && binding.method === 'inspectPackage') {
      const document = documentForCapabilityTool(scope);
      const snapshot = await delivery().inspectPackage(document, {
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        scope: input.scope,
        assetIds: input.assetIds,
        targetPath: input.targetPath,
      });
      return snapshot.preview;
    }
    if (binding.service === 'agentControlBrowser' && binding.method === 'createBrowserHandoff') {
      documentForCapabilityTool(scope);
      return createBrowserHandoff({
        ...input,
        action: input.action || 'open',
        projectId: scope.projectId,
        canvasId: scope.canvasId,
      }, runtimeConfig);
    }
    throw new AgentControlCapabilityToolError(
      'CAPABILITY_TOOL_HANDLER_UNAVAILABLE',
      `高层能力已登记，但当前桌面版没有可用的安全处理器：${requestAction}.${operation}`,
      503,
    );
  };
  let lazyCapabilityToolService = options.capabilityToolService || null;
  const capabilityTools = () => {
    if (!lazyCapabilityToolService) {
      lazyCapabilityToolService = createAgentControlCapabilityToolService({
        dispatch: dispatchCapabilityTool,
      });
    }
    return lazyCapabilityToolService;
  };
  let lazyCreatorSessionStore = options.creatorSessions || null;
  const creatorSessions = () => {
    if (!lazyCreatorSessionStore) {
      lazyCreatorSessionStore = createCreatorAgentSessionStore({
        rootDir: path.join(runtimeConfig.DATA_DIR || process.cwd(), 'creator-agent'),
      });
    }
    return lazyCreatorSessionStore;
  };
  const allowedHosts = new Set([
    `127.0.0.1:${runtimeConfig.PORT}`,
    `localhost:${runtimeConfig.PORT}`,
    `[::1]:${runtimeConfig.PORT}`,
  ]);

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const host = String(req.get('host') || '').trim().toLowerCase();
    const origin = String(req.get('origin') || '').trim();
    const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase();
    if (!allowedHosts.has(host) || origin || fetchSite === 'cross-site') {
      return res.status(403).json({
        schema: AGENT_CONTROL_HTTP_SCHEMA,
        ok: false,
        code: 'AGENT_CONTROL_ORIGIN_FORBIDDEN',
        message: 'Agent Control 只接受本机 CLI 请求',
      });
    }
    return next();
  });

  router.get('/status', (_req, res) => {
    const compatibility = compatibilitySnapshot();
    res.json(response({
      data: {
        service: 't8-agent-control',
        appVersion: runtimeConfig.APP_VERSION,
        instanceId: runtimeConfig.BACKEND_INSTANCE_ID,
        ...compatibility,
        pairingRequired: true,
        activeContext: { schema: ACTIVE_CONTEXT_SCHEMA, scope: 'canvas:read', readOnly: true },
        runControl: {
          schema: 't8-agent-run-control-v1',
          singleUsePlan: true,
          operationLookup: true,
          approvalLookup: true,
        },
        assetControl: {
          schema: 't8-agent-asset-control-v1',
          approvalLookup: true,
          hashLookup: true,
          patchLookup: true,
          maxImportBytes: assetImportMaxBytes(runtimeConfig),
        },
      },
    }));
  });

  router.post('/pairings', (req, res, next) => {
    try {
      const pairing = auth.createPairing(req.body || {});
      return res.status(202).json(response({
        message: '请在贞贞无限画布中核对验证码并批准此 Agent',
        data: pairing,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/pairings/:pairingId/poll', (req, res, next) => {
    try {
      const result = auth.pollPairing({
        pairingId: req.params.pairingId,
        pollSecret: req.body?.pollSecret,
      });
      return res.json(response({ data: result }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/session', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), []);
      return res.json(response({ data: session }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/capabilities', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['canvas:read']);
      return res.json(response({
        message: '已返回画布 Agent、zcanvas 与 Codex Skill 共用的创作能力清单',
        data: publicCreativeCapabilities({
          category: req.query?.category,
          query: req.query?.query,
          settingsFile: runtimeConfig.SETTINGS_FILE,
          credentialSettingsProvider: options.credentialSettingsProvider,
          runtimeStatusProvider: options.runtimeStatusProvider,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/capability-graph', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['canvas:read']);
      return res.json(response({
        message: '已返回真实节点、handler 与运行时目录的统一能力图谱',
        data: publicCreativeCapabilityGraph({
          category: req.query?.category,
          settingsFile: runtimeConfig.SETTINGS_FILE,
          credentialSettingsProvider: options.credentialSettingsProvider,
          runtimeStatusProvider: options.runtimeStatusProvider,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/capability-tools', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['canvas:read']);
      return res.json(response({
        message: '已返回外部 Agent 可调用的版本化高层能力；内部 handler、数据库和 Provider 请求不会暴露',
        data: capabilityTools().catalog(),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/capability-tools/invoke', async (req, res, next) => {
    try {
      const token = bearerToken(req);
      auth.authenticate(token, []);
      const prepared = capabilityTools().prepare(req.body || {});
      const session = auth.authenticate(token, [...prepared.requiredScopes]);
      const result = await capabilityTools().invokePrepared(prepared, {
        actorId: session.actorId,
        sessionId: session.sessionId,
      });
      return res.json(response({
        message: '版本化高层能力已执行；本次只运行 L0 只读处理，没有写画布、调用 Provider 或写文件',
        data: result,
      }));
    } catch (error) {
      return next(error);
    }
  });


  router.delete('/session', (req, res, next) => {
    try {
      const token = bearerToken(req);
      auth.authenticate(token, []);
      return res.json(response({ data: auth.revoke(token) }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/active-context', async (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['canvas:read']);
      const data = await (options.contextService || agentControlContextService).snapshot(runtimeConfig.BACKEND_INSTANCE_ID);
      return res.json(response({ data }));
    } catch (error) { return next(error); }
  });

  router.get('/workspaces', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']);
      const canvases = database().listCanvases(DEFAULT_PROJECT_ID).slice(0, 500).map((canvas) => ({
        id: String(canvas.id || ''),
        projectId: String(canvas.projectId || DEFAULT_PROJECT_ID),
        revision: Math.max(1, Math.trunc(Number(canvas.revision) || 1)),
        name: String(canvas.name || canvas.id || '').slice(0, 240),
        nodeCount: Math.max(0, Math.trunc(Number(canvas.nodeCount) || 0)),
        createdAt: Math.max(0, Math.trunc(Number(canvas.createdAt) || 0)),
        updatedAt: Math.max(0, Math.trunc(Number(canvas.updatedAt) || 0)),
      }));
      return res.json(response({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          canvases,
          total: canvases.length,
          truncated: canvases.length >= 500,
          actorId: session.actorId,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tools', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']);
      const result = executeCanvasAgentTool(database(), req.body, {
        actorId: session.actorId,
        role: 'agent',
        capabilities: session.scopes.includes('canvas:write') ? ['editGraph'] : [],
        sessionId: session.sessionId,
      });
      return res.json(response({ data: result }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/browser-handoffs', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['browser:handoff']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '浏览器交接目标不存在或不属于当前项目', 404);
      }
      return res.json(response({
        message: '已创建当前画布的可见 Chrome 交接；服务端没有读取浏览器数据',
        data: createBrowserHandoff({
          ...(req.body || {}),
          action: req.body?.action,
          projectId,
          canvasId,
          nodeId: req.body?.nodeId,
          userInitiated: req.body?.userInitiated === true,
        }, runtimeConfig),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/run-plans', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:read']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const plan = runs().createPlan({
        canvasRevision: req.body?.canvasRevision,
        nodeIds: req.body?.nodeIds,
        mode: req.body?.mode,
      }, {
        projectId,
        canvasId,
        actorId: session.actorId,
        sessionId: session.sessionId,
      });
      const approvalBinding = runPlanApprovalBinding(plan, {
        projectId,
        canvasId,
        sessionId: session.sessionId,
      }, 'run.start');
      approvals.invalidateBinding?.(approvalBinding);
      return res.json(response({
        message: '运行计划已生成；请核对节点范围、Provider 和模型后请求启动',
        data: { ...plan, approvalBinding },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/run-start-approvals', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:execute']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const prepared = runs().startPreview(req.body?.planId, {
        projectId,
        canvasId,
        actorId: session.actorId,
        sessionId: session.sessionId,
      });
      const operationId = requireRunOperationId(req.body?.operationId || `run-start-${prepared.plan.planDigest.slice(0, 32)}`);
      const approval = approvals.create({
        action: 'run.start',
        operationId,
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        payload: { plan: prepared.plan },
        preview: prepared.preview,
        approvalBinding: runPlanApprovalBinding(prepared.plan, {
          projectId,
          canvasId,
          sessionId: session.sessionId,
        }, 'run.start'),
      });
      return res.status(202).json(response({
        message: '运行范围、Provider 和模型已预览，等待画布用户批准',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/run-start-approvals/by-operation/:operationId', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:execute']);
      return res.json(response({ data: approvals.inspectOperation({ action: 'run.start', operationId: req.params.operationId, sessionId: session.sessionId, projectId: String(req.query?.projectId || ''), canvasId: String(req.query?.canvasId || '') }) }));
    } catch (error) { return next(error); }
  });

  router.post('/run-retry-approvals', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:execute']);
      const scope = {
        projectId: String(req.body?.projectId || ''),
        canvasId: String(req.body?.canvasId || ''),
        actorId: session.actorId,
        sessionId: session.sessionId,
      };
      const publicPlan = runs().retryPlan(req.body?.intentId, scope);
      const prepared = runs().startPreview(publicPlan.planId, scope);
      const operationId = requireRunOperationId(req.body?.operationId || `run-retry-${prepared.plan.planDigest.slice(0, 32)}`);
      const approval = approvals.create({
        action: 'run.retry',
        operationId,
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        payload: { plan: prepared.plan, retryOf: String(req.body?.intentId || '') },
        preview: {
          ...prepared.preview,
          summary: `只重试失败范围：${prepared.plan.authorizedNodeIds.length} 个生成节点`,
        },
        approvalBinding: runPlanApprovalBinding(
          prepared.plan,
          {
            projectId: scope.projectId,
            canvasId: scope.canvasId,
            sessionId: session.sessionId,
          },
          'run.retry',
          req.body?.intentId,
        ),
      });
      return res.status(202).json(response({
        message: '失败范围、Provider 和模型已预览，等待画布用户批准重试',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/run-intents', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:read']);
      const scope = {
        projectId: String(req.query?.projectId || ''),
        canvasId: String(req.query?.canvasId || ''),
        actorId: session.actorId,
        sessionId: session.sessionId,
      };
      return res.json(response({
        data: {
          items: runs().list(scope, { status: req.query?.status }),
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/run-intents/by-operation/:operationId', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:read']);
      return res.json(response({ data: runs().inspectOperation(req.params.operationId, {
        projectId: String(req.query?.projectId || ''), canvasId: String(req.query?.canvasId || ''), actorId: session.actorId, sessionId: session.sessionId,
      }) }));
    } catch (error) { return next(error); }
  });

  router.get('/run-intents/:intentId', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:read']);
      return res.json(response({
        data: runs().inspect(req.params.intentId, {
          projectId: String(req.query?.projectId || ''),
          canvasId: String(req.query?.canvasId || ''),
          actorId: session.actorId,
          sessionId: session.sessionId,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/run-intents/:intentId/cancel', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['run:execute']);
      return res.json(response({
        message: '运行取消请求已持久化；若任务已在 Provider 运行，画布会在安全点停止后续处理',
        data: runs().cancel(req.params.intentId, req.body?.expectedQueueRevision, {
          projectId: String(req.body?.projectId || ''),
          canvasId: String(req.body?.canvasId || ''),
          actorId: session.actorId,
          sessionId: session.sessionId,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/creative-plans', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']);
      const scope = {
        projectId: String(req.body?.projectId || ''),
        canvasId: String(req.body?.canvasId || ''),
        actorId: session.actorId,
        sessionId: session.sessionId,
      };
      const plan = req.body?.action
        ? creative().actionPlan(
            String(req.body.action),
            creativeInputWithVerifiedReferences(req.body?.input || {}, scope),
            scope,
          )
        : creative().createPlan(creativeInputWithModelDecision(req.body?.input || {}, scope), scope);
      const approvalBinding = creativePlanApprovalBinding(plan, scope);
      approvals.invalidateBinding?.(approvalBinding);
      return res.json(response({
        message: plan.ready
          ? '创作计划已生成；当前没有修改画布，也没有调用 Provider'
          : '创作计划还需要少量关键信息；当前没有修改画布，也没有调用 Provider',
        data: { ...plan, approvalBinding },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/creator-sessions', (req, res, next) => {
    try {
      const agentSession = auth.authenticate(bearerToken(req), ['canvas:read']);
      const projectId = String(req.body?.projectId || '').trim();
      const canvasId = String(req.body?.canvasId || '').trim();
      const document = database().getCanvas(canvasId);
      if (!projectId || !canvasId || !document || String(document.projectId || '') !== projectId) {
        throw new CreatorAgentSessionError(
          'CREATOR_SCOPE_NOT_FOUND',
          '当前项目或画布不存在，无法同步创作会话',
          404,
        );
      }
      const synchronizedContext = creatorContextForVerifiedNodes(req.body?.context, document);
      const scope = {
        projectId,
        canvasId,
        actorId: agentSession.actorId,
        sessionId: agentSession.sessionId,
      };
      const requestedPlanId = String(req.body?.planId || req.body?.plan?.planId || '').trim();
      let internalPlan = null;
      let publicPlan = null;
      if (requestedPlanId) {
        internalPlan = creative().requirePlan(requestedPlanId, scope);
        publicPlan = creative().publicPlan(internalPlan);
        const requestedPlan = req.body?.plan;
        const requestedDigest = String(req.body?.planDigest || requestedPlan?.planDigest || '').trim();
        if ((requestedDigest && requestedDigest !== internalPlan.planDigest)
          || (requestedPlan && (requestedPlan.planId !== internalPlan.id
            || requestedPlan.projectId !== projectId
            || requestedPlan.canvasId !== canvasId
            || requestedPlan.planDigest !== internalPlan.planDigest))) {
          throw new CreatorAgentSessionError(
            'CREATOR_PLAN_MISMATCH',
            '创作会话与受控计划不一致，已停止同步',
            409,
          );
        }
      }
      const creatorSession = creatorSessions().create({
        sessionId: req.body?.sessionId,
        projectId,
        canvasId,
        title: req.body?.title,
        context: synchronizedContext,
        source: 'zcanvas',
      });
      let result = { session: creatorSession, userEvent: null, assistantEvent: null };
      const synchronizedInput = creativeInputWithAttachments({
        assetIds: req.body?.assetIds,
        attachments: req.body?.attachments,
      }, scope);
      if (requestedPlanId && creatorSession.latestPlan?.planId !== requestedPlanId) {
        result = creatorSessions().appendTurn(creatorSession.id, {
          text: req.body?.prompt,
          attachments: synchronizedInput.attachments,
          context: synchronizedContext,
          plan: publicPlan,
          patch: internalPlan?.patch,
          source: 'zcanvas',
        });
      }
      return res.status(201).json(response({
        message: requestedPlanId
          ? 'zcanvas 创作计划已同步到画布内 Agent；当前仍未写入画布'
          : 'zcanvas 创作会话已同步到画布内 Agent',
        data: result,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/creator-sessions/:sessionId', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['canvas:read']);
      const creatorSession = creatorSessions().read(req.params.sessionId);
      if (creatorSession.projectId !== String(req.query?.projectId || '')
        || creatorSession.canvasId !== String(req.query?.canvasId || '')) {
        throw new CreatorAgentSessionError(
          'CREATOR_SESSION_SCOPE_MISMATCH',
          '这个创作会话不属于当前项目或画布',
          409,
        );
      }
      return res.json(response({ data: creatorSession }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/creator-sessions/:sessionId/events', (req, res, next) => {
    try {
      const controlSession = auth.authenticate(bearerToken(req), ['canvas:read']);
      const creatorSession = creatorSessions().read(req.params.sessionId);
      if (creatorSession.projectId !== String(req.body?.projectId || '')
        || creatorSession.canvasId !== String(req.body?.canvasId || '')) {
        throw new CreatorAgentSessionError(
          'CREATOR_SESSION_SCOPE_MISMATCH',
          '这个创作会话不属于当前项目或画布',
          409,
        );
      }
      const type = String(req.body?.type || '');
      let payload = req.body?.payload && typeof req.body.payload === 'object'
        ? req.body.payload
        : {};
      if (type === 'plan.applied' || type === 'plan.reverted') {
        if (type === 'plan.reverted') {
          const planId = String(payload?.planId || '').trim();
          const state = replayCreatorCanvasPlanStates(creatorSession).get(planId);
          const samePatch = String(state?.payload?.patchId || '') === String(payload?.patchId || '');
          const alreadyRecorded = state?.status === 'reverted' && samePatch;
          if (!alreadyRecorded && (!state || state.status !== 'applied' || !samePatch)) {
            throw new CreatorAgentSessionError(
              'CREATOR_PLAN_NOT_APPLIED',
              '这条计划当前没有可撤回的画布变更',
              409,
            );
          }
        }
        payload = canonicalCreatorCanvasLifecycle(database(), creatorSession, {
          projectId: creatorSession.projectId,
          canvasId: creatorSession.canvasId,
          actorId: controlSession.actorId,
          sessionId: controlSession.sessionId,
        }, type, payload);
      }
      const updated = creatorSessions().appendLifecycle(
        creatorSession.id,
        type,
        payload,
      );
      return res.status(201).json(response({
        message: '创作进度已同步到画布内 Agent',
        data: updated,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/creative-read', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']);
      return res.json(response({
        data: creative().readAction(String(req.body?.action || ''), req.body?.input || {}, {
          projectId: String(req.body?.projectId || ''),
          canvasId: String(req.body?.canvasId || ''),
          actorId: session.actorId,
          sessionId: session.sessionId,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/models', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']);
      const catalog = creative().models({
        kind: req.query?.kind,
        query: req.query?.query,
      }, {
        projectId: String(req.query?.projectId || ''),
        canvasId: String(req.query?.canvasId || ''),
        actorId: session.actorId,
        sessionId: session.sessionId,
      });
      const capabilityGraph = publicCreativeCapabilityGraph({
        settingsFile: runtimeConfig.SETTINGS_FILE,
        credentialSettingsProvider: options.credentialSettingsProvider,
        runtimeStatusProvider: options.runtimeStatusProvider,
      });
      return res.json(response({
        data: modelCatalogWithReadiness(catalog, capabilityGraph),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/creative-approvals', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:write']);
      const scope = {
        projectId: String(req.body?.projectId || ''),
        canvasId: String(req.body?.canvasId || ''),
        actorId: session.actorId,
        sessionId: session.sessionId,
      };
      const plan = creative().requirePlan(req.body?.planId, scope);
      const patch = scopeAgentPatch(plan.patch, scope);
      const patchPreview = database().previewCanvasPatch(scope.canvasId, patch, {
        actorId: session.actorId,
        sessionId: session.sessionId,
        projectId: scope.projectId,
        authority: agentPatchAuthority(),
      });
      const preview = {
        ...patchPreview,
        summary: plan.patch.summary,
        creator: {
          action: plan.action,
          profile: plan.profile,
          profileLabel: plan.profile === 'economy'
            ? '省钱预览'
            : plan.profile === 'quality'
              ? '质量优先'
              : plan.profile === 'custom'
                ? '自定义'
                : '平衡创作',
          candidateCount: plan.candidateCount,
          goal: plan.brief?.goal || plan.brief?.summary || '',
          ratio: plan.brief?.ratio || '',
          durationSec: plan.brief?.durationSec || 0,
          generateScope: plan.strategy?.generateScope || 'missing-failed-unlocked',
          analysis: plan.analysis || null,
          models: {
            llm: {
              provider: plan.brief?.llmProvider || plan.brief?.provider || '',
              model: plan.brief?.llmModel || (plan.kind === 'script' ? plan.brief?.model : '') || '',
            },
            image: {
              provider: plan.brief?.imageProvider || (plan.kind === 'image' ? plan.brief?.provider : '') || '',
              model: plan.brief?.imageModel || (plan.kind === 'image' ? plan.brief?.model : '') || '',
            },
            video: {
              provider: plan.brief?.videoProvider || (plan.kind === 'video' ? plan.brief?.provider : '') || '',
              model: plan.brief?.videoModel || (plan.kind === 'video' ? plan.brief?.model : '') || '',
            },
          },
        },
        riskLevel: 'L1',
        providerTransfer: {
          occursNow: false,
          scope: 'canvas-structure-only',
          message: '本次只创建或调整可编辑工作流；不会调用 AI Provider。',
        },
        warnings: [
          ...(Array.isArray(patchPreview.warnings) ? patchPreview.warnings : []),
          '生成任务仍需单独运行；Story 进入资产阶段不会自动生成或覆盖已上传素材。',
          '已采用版本与连续性锁会保留，默认只处理缺失、失败或未锁定项。',
        ],
      };
      const approval = approvals.create({
        action: 'creative.apply',
        operationId: String(req.body?.operationId || `creative-${plan.planDigest.slice(0, 32)}`),
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        patch,
        patchId: patch.id,
        payload: { planId: plan.id, planDigest: plan.planDigest, action: plan.action },
        preview,
        approvalBinding: creativePlanApprovalBinding(plan, scope),
      });
      return res.status(202).json(response({
        message: '创作工作流变更已预览，等待画布用户核对并批准',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/assets', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['asset:read']);
      const projectId = String(req.query?.projectId || '');
      const canvasId = String(req.query?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '素材查询目标不存在或不属于当前项目', 404);
      }
      return res.json(response({
        data: { projectId, canvasId, canvasRevision: Number(document.revision), ...assets().search({
          projectId,
          kind: req.query?.kind,
          contentHash: req.query?.contentHash,
          query: req.query?.query,
          limit: req.query?.limit,
          offset: req.query?.offset,
        }) },
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/assets/:assetId', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['asset:read']);
      const projectId = String(req.query?.projectId || '');
      return res.json(response({ data: assets().inspect(req.params.assetId, projectId) }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/assets/:assetId/lineage', (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['asset:read']);
      const projectId = String(req.query?.projectId || '');
      return res.json(response({
        data: assets().lineage(req.params.assetId, projectId, {
          limit: req.query?.limit,
          cursor: req.query?.cursor,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/delivery/collect', async (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['asset:read']);
      const projectId = String(req.query?.projectId || '');
      const canvasId = String(req.query?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '交付范围不存在或不属于当前项目', 404);
      }
      const requested = Array.isArray(req.query?.assetId)
        ? req.query.assetId
        : String(req.query?.assetId || '').split(',');
      const collection = await delivery().collect(document, {
        projectId,
        canvasId,
        scope: req.query?.scope,
        assetIds: requested,
      });
      return res.json(response({
        message: collection.ready
          ? `已收集并校验 ${collection.items.length} 个交付素材`
          : '交付素材尚未齐全；已返回缺失或校验失败原因',
        data: collection,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/delivery-package-approvals', async (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['asset:transfer']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '交付范围不存在或不属于当前项目', 404);
      }
      const snapshot = await delivery().inspectPackage(document, {
        projectId,
        canvasId,
        scope: req.body?.scope,
        assetIds: req.body?.assetIds,
        targetPath: req.body?.targetPath,
      });
      const operationId = String(
        req.body?.operationId
          || `delivery-package-${snapshot.collection.selectionDigest.slice(0, 24)}`,
      );
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(operationId)) {
        throw new AgentControlDeliveryError('DELIVERY_OPERATION_ID_INVALID', '交付 operationId 无效');
      }
      const approval = approvals.create({
        action: 'delivery.package',
        operationId,
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        payload: snapshot,
        preview: snapshot.preview,
      });
      return res.status(202).json(response({
        message: '交付包已预览，等待画布用户核对素材集合、许可状态和目标目录',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/delivery/verify', async (req, res, next) => {
    try {
      auth.authenticate(bearerToken(req), ['asset:read']);
      return res.json(response({
        message: '交付包校验完成',
        data: await delivery().verifyPackage(req.body?.packagePath, {
          expectedPackageDigest: req.body?.expectedPackageDigest,
        }),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/asset-place-approvals', async (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:write', 'asset:read']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '素材放置目标不存在或不属于当前项目', 404);
      }
      const inspected = await assets().inspectPlace(req.body?.assetId, document, {
        projectId,
        position: req.body?.position,
        targetNodeId: req.body?.targetNodeId,
        sourceHandle: req.body?.sourceHandle,
        targetHandle: req.body?.targetHandle,
      });
      const scopedPatch = scopeAgentPatch(inspected.patch, {
        projectId,
        canvasId,
        actorId: session.actorId,
        sessionId: session.sessionId,
      });
      const recovery = resolveAppliedAssetPlacement(database(), canvasId, {
        ...inspected,
        patch: scopedPatch,
      });
      const snapshot = { ...inspected, patch: recovery.patch };
      const patch = snapshot.patch;
      const patchPreview = recovery.status === 'applied'
        ? {
            patchId: patch.id,
            baseRevision: recovery.application.baseRevision,
            currentRevision: recovery.application.baseRevision,
            previewDigest: recovery.application.previewDigest,
            summary: recovery.application.summary,
            diagnosticsResolved: recovery.application.diagnosticsResolved || [],
            affectedNodeIds: recovery.application.affectedNodeIds || [],
            affectedEdgeIds: recovery.application.affectedEdgeIds || [],
            changes: recovery.application.changes || [],
            warnings: [],
          }
        : database().previewCanvasPatch(canvasId, patch, {
            actorId: session.actorId,
            sessionId: session.sessionId,
            projectId,
            authority: agentPatchAuthority(),
          });
      const preview = {
        ...patchPreview,
        riskLevel: 'L1',
        assetId: snapshot.asset.id,
        destination: '当前画布',
        assetPlacement: {
          ...snapshot.placement,
          asset: snapshot.asset,
        },
        providerTransfer: {
          occursNow: false,
          scope: 'none',
          message: '本次只把当前项目中已校验的素材放入画布，不读取外部文件，也不会调用 AI Provider。',
        },
        cost: { known: true, amount: 0, currency: 'CNY' },
      };
      const operationId = String(req.body?.operationId || patch.id);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(operationId)) {
        throw new AgentControlAssetError('ASSET_OPERATION_ID_INVALID', '素材放置 operationId 无效');
      }
      const approval = approvals.create({
        action: 'asset.place',
        operationId,
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        patch,
        patchId: patch.id,
        payload: { asset: snapshot.asset, placement: snapshot.placement },
        preview,
        approvalBinding: createAgentControlApprovalBinding({
          action: 'asset.place',
          sessionId: session.sessionId,
          projectId,
          canvasId,
          subject: {
            kind: 'persisted-asset-placement',
            assetId: snapshot.asset.id,
            nodeId: snapshot.placement.nodeId,
            targetNodeId: snapshot.placement.targetNodeId,
          },
          subjectVersionDigest: snapshot.asset.contentHash,
          planDigest: snapshot.asset.contentHash,
          boundary: {
            providerTransfer: {
              status: 'not-applicable',
              occursNow: false,
              scope: 'project-local-to-canvas',
            },
          },
        }),
      });
      return res.status(202).json(response({
        message: recovery.status === 'applied'
          ? '同一素材、版本、位置和连线已经写入画布；确认后只恢复完成回执，不会重复添加节点'
          : '素材放置已预览，等待画布用户核对节点、位置、连线和来源',
        data: {
          ...approval,
          alreadyApplied: recovery.status === 'applied'
            ? {
                patchId: recovery.application.patchId,
                baseRevision: recovery.application.baseRevision,
                appliedRevision: recovery.application.appliedRevision,
              }
            : null,
        },
      }));
    } catch (error) {
      return next(error);
    }
  });

  for (const [path, action, scopes] of [
    ['/asset-import-approvals/by-operation/:operationId', 'asset.import', ['asset:transfer']],
    ['/asset-place-approvals/by-operation/:operationId', 'asset.place', ['asset:read', 'canvas:write']],
  ]) router.get(path, (req, res, next) => {
    try { const session = auth.authenticate(bearerToken(req), scopes); return res.json(response({ data: approvals.inspectOperation({ action, operationId: req.params.operationId, sessionId: session.sessionId, projectId: String(req.query?.projectId || ''), canvasId: String(req.query?.canvasId || '') }) })); } catch (error) { return next(error); }
  });

  router.post('/asset-import-approvals', async (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['asset:transfer']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '素材导入目标不存在或不属于当前项目', 404);
      }
      const snapshot = await assets().inspectImport(req.body?.filePath);
      const operationId = String(req.body?.operationId || `asset-import-${snapshot.sha256}`);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(operationId)) {
        throw new AgentControlAssetError('ASSET_OPERATION_ID_INVALID', '素材导入 operationId 无效');
      }
      const approval = approvals.create({
        action: 'asset.import',
        operationId,
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        payload: { snapshot },
        preview: publicImportPreview(snapshot, {
          projectId,
          canvasId,
          canvasRevision: document.revision,
        }),
      });
      return res.status(202).json(response({
        message: '素材导入已预览，等待画布用户核对文件和范围',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/asset-download-approvals', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['asset:transfer']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', '素材导出目标不存在或不属于当前项目', 404);
      }
      const snapshot = assets().inspectDownload(req.body?.assetId, req.body?.targetPath, projectId);
      snapshot.preview.currentRevision = document.revision;
      snapshot.preview.canvasId = canvasId;
      const operationId = String(req.body?.operationId || `asset-download-${snapshot.asset.id}-${snapshot.asset.contentHash.slice(0, 16)}`);
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(operationId)) {
        throw new AgentControlAssetError('ASSET_OPERATION_ID_INVALID', '素材导出 operationId 无效');
      }
      const approval = approvals.create({
        action: 'asset.download',
        operationId,
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        payload: snapshot,
        preview: snapshot.preview,
      });
      return res.status(202).json(response({
        message: '素材导出已预览，等待画布用户核对原件、目标和范围',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/patch-approvals', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:write']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', 'Agent 工具目标不存在或不属于当前项目', 404);
      }
      const patch = scopeAgentPatch(req.body?.patch, {
        projectId,
        canvasId,
        actorId: session.actorId,
        sessionId: session.sessionId,
      });
      const preview = database().previewCanvasPatch(canvasId, patch, {
        actorId: session.actorId,
        sessionId: session.sessionId,
        projectId,
        authority: agentPatchAuthority(),
      });
      const approval = approvals.create({
        action: 'patch.apply',
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        patch,
        patchId: patch.id,
        preview,
      });
      return res.status(202).json(response({
        message: 'Patch 已预览，等待画布用户核对差异并批准',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/patches/:patchId', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']), projectId = String(req.query?.projectId || ''), canvasId = String(req.query?.canvasId || ''), document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) throw new CanvasAgentToolError('agent_scope_not_found', 'Patch 查询目标不存在或不属于当前项目', 404);
      // Public receipt fields only: reading a canvas already exposes its graph.
      // Exact duplicate asset placements may legitimately predate this actor.
      const application = database().getCanvasPatchApplication(canvasId, req.params.patchId, { actorId: session.actorId, projectId, includeAllActors: true });
      if (!application) throw new CanvasAgentToolError('PATCH_APPLICATION_NOT_FOUND', '没有这次 Patch 的应用记录', 404);
      return res.json(response({ data: { projectId, canvasId, patchId: application.patchId, status: application.status, baseRevision: application.baseRevision, appliedRevision: application.appliedRevision, affectedNodeIds: application.affectedNodeIds || [] } }));
    } catch (error) { return next(error); }
  });

  router.get('/patches', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:read']);
      const projectId = String(req.query?.projectId || '');
      const canvasId = String(req.query?.canvasId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', 'Agent 工具目标不存在或不属于当前项目', 404);
      }
      const patches = database().listCanvasPatches(canvasId, {
        actorId: session.actorId,
        projectId,
        limit: Math.min(100, Math.max(1, Math.trunc(Number(req.query?.limit) || 50))),
      });
      return res.json(response({ data: { projectId, canvasId, patches } }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/patch-revert-approvals', (req, res, next) => {
    try {
      const session = auth.authenticate(bearerToken(req), ['canvas:write']);
      const projectId = String(req.body?.projectId || '');
      const canvasId = String(req.body?.canvasId || '');
      const patchId = String(req.body?.patchId || '');
      const document = database().getCanvas(canvasId);
      if (!document || document.projectId !== projectId) {
        throw new CanvasAgentToolError('agent_scope_not_found', 'Agent 工具目标不存在或不属于当前项目', 404);
      }
      const record = database().listCanvasPatches(canvasId, {
        projectId,
        limit: 100,
        includeAllActors: true,
      }).find((item) => item.patchId === patchId);
      if (!record || !record.canRevert) {
        throw new AgentControlApprovalError('PATCH_NOT_REVERTIBLE', '指定 Patch 不存在或当前不可撤销', 409);
      }
      const approval = approvals.create({
        action: 'patch.revert',
        sessionId: session.sessionId,
        actorId: session.actorId,
        clientName: session.clientName,
        projectId,
        canvasId,
        patchId,
        sourceActorId: record.actorId,
        expectedRevision: document.revision,
        preview: {
          patchId,
          summary: `撤销：${record.summary}`,
          currentRevision: document.revision,
          appliedRevision: record.appliedRevision,
          operationCount: record.operationCount,
          changes: [],
          warnings: ['撤销会创建新的 revision，不会删除历史记录。'],
        },
      });
      return res.status(202).json(response({
        message: '撤销已进入用户确认队列',
        data: approval,
      }));
    } catch (error) {
      return next(error);
    }
  });

  const completeApproval = async (req, res, next) => {
    let completion = null;
    try {
      const session = auth.authenticate(bearerToken(req), []);
      completion = approvals.beginCompletion({
        approvalRequestId: req.params.approvalRequestId,
        pollSecret: req.body?.pollSecret,
        sessionId: session.sessionId,
      });
      if (completion.status !== 'approved') {
        return res.json(response({
          data: { approvalRequestId: req.params.approvalRequestId, status: completion.status },
        }));
      }
      const record = completion.record;
      assertCreativeApprovalStillCurrent(record);
      let result;
      if (record.action === 'patch.apply' || record.action === 'creative.apply' || record.action === 'asset.place') {
        auth.authenticate(bearerToken(req), ['canvas:write']);
        result = database().applyCanvasPatch(record.canvasId, record.patch, {
          previewDigest: record.preview.previewDigest,
          confirmed: true,
          actorId: session.actorId,
          sessionId: session.sessionId,
          projectId: record.projectId,
          authority: agentPatchAuthority(),
          allowExactDuplicateAcrossActors: record.action === 'creative.apply' || record.action === 'asset.place',
        });
      } else if (record.action === 'patch.revert') {
        auth.authenticate(bearerToken(req), ['canvas:write']);
        result = database().revertCanvasPatch(record.canvasId, record.patchId, {
          expectedRevision: record.expectedRevision,
          actorId: session.actorId,
          patchOwnerActorId: record.sourceActorId,
          sessionId: session.sessionId,
          projectId: record.projectId,
          authority: agentPatchAuthority(),
        });
      } else if (record.action === 'asset.import') {
        auth.authenticate(bearerToken(req), ['asset:transfer']);
        result = await assets().importFile(record.payload.snapshot, {
          operationId: record.operationId,
          projectId: record.projectId,
          canvasId: record.canvasId,
          actorId: session.actorId,
          sessionId: session.sessionId,
        });
      } else if (record.action === 'asset.download') {
        auth.authenticate(bearerToken(req), ['asset:transfer']);
        result = await assets().download(record.payload.asset.id, record.payload, {
          operationId: record.operationId,
          projectId: record.projectId,
          canvasId: record.canvasId,
          actorId: session.actorId,
          sessionId: session.sessionId,
        });
      } else if (record.action === 'delivery.package') {
        auth.authenticate(bearerToken(req), ['asset:transfer']);
        const document = database().getCanvas(record.canvasId);
        if (!document || document.projectId !== record.projectId) {
          throw new CanvasAgentToolError('agent_scope_not_found', '交付范围不存在或不属于当前项目', 404);
        }
        result = await delivery().packageDelivery(document, record.payload);
      } else if (record.action === 'run.start' || record.action === 'run.retry') {
        auth.authenticate(bearerToken(req), ['run:execute']);
        result = runs().complete(record.payload.plan, {
          operationId: record.operationId,
          actorId: session.actorId,
          sessionId: session.sessionId,
        });
      } else {
        throw new AgentControlApprovalError('APPROVAL_ACTION_UNSUPPORTED', '当前桌面版不支持此确认操作', 409);
      }
      const patchMutation = record.action === 'patch.apply'
        || record.action === 'patch.revert'
        || record.action === 'creative.apply'
        || record.action === 'asset.place';
      const publicResult = patchMutation ? publicPatchMutationResult(result) : result;
      const warnings = patchMutation
        ? agentPatchMirrorWarnings(record.canvasId, result, database(), options)
        : [];
      approvals.finishCompletion(record, true);
      if (patchMutation) try {
        approvals.publishMutation?.({
          approvalRequestId: record.id,
          action: record.action,
          projectId: record.projectId,
          canvasId: record.canvasId,
          patchId: publicResult.patchId,
          revision: publicResult.revision,
          warningCodes: warnings.map((warning) => warning?.code),
        });
      } catch (_) {
        // The authoritative transaction is already committed. Notification
        // failures are recovered by the next canvas read and must not invite a
        // duplicate CLI retry.
      }
      return res.json(response({
        message: record.action === 'creative.apply'
          ? '创作工作流已写入画布；没有自动启动生成'
          : record.action === 'asset.place'
            ? '项目素材已放入画布；没有调用模型'
          : record.action === 'patch.apply'
          ? 'Patch 已应用'
          : record.action === 'patch.revert'
            ? 'Patch 已撤销'
            : record.action === 'asset.download'
              ? '素材已导出到你选择的本机目录'
              : record.action === 'delivery.package'
                ? '交付包已创建并写入素材哈希与许可清单'
              : record.action === 'run.start' || record.action === 'run.retry'
                ? '运行请求已持久化，画布将按 exactly-once 队列执行'
                : '素材已导入当前项目',
        data: {
          approvalRequestId: record.id,
          action: record.action,
          operationId: record.operationId,
          ...publicResult,
        },
        ...(warnings.length ? { warnings } : {}),
      }));
    } catch (error) {
      if (completion?.record) approvals.finishCompletion(completion.record, false);
      return next(error);
    }
  };

  router.post('/approvals/:approvalRequestId/complete', completeApproval);
  router.post('/patch-approvals/:approvalRequestId/complete', completeApproval);

  router.use((error, _req, res, _next) => {
    const authError = error instanceof AgentControlAuthError;
    const toolError = error instanceof CanvasAgentToolError;
    const approvalError = error instanceof AgentControlApprovalError;
    const assetError = error instanceof AgentControlAssetError;
    const deliveryError = error instanceof AgentControlDeliveryError;
    const browserError = error instanceof AgentControlBrowserError;
    const runError = error instanceof AgentControlRunError;
    const creativeError = error instanceof AgentControlCreativeError;
    const creatorSessionError = error instanceof CreatorAgentSessionError;
    const capabilityToolError = error instanceof AgentControlCapabilityToolError;
    const mapped = authError || toolError || approvalError || assetError || deliveryError || browserError
      || runError || creativeError || creatorSessionError || capabilityToolError
      ? null
      : mapCanvasMutationError(error, {
        fallbackCode: 'AGENT_CONTROL_REQUEST_INVALID',
        fallbackMessage: 'Agent Control 请求无效',
      });
    return res.status(mapped ? mapped.status : (Number(error.status) || 500)).json({
      schema: AGENT_CONTROL_HTTP_SCHEMA,
      ok: false,
      code: mapped ? mapped.body.code : error.code,
      message: authError
        ? error.message
        : mapped?.body?.error || safeCanvasPatchErrorMessage(
          toolError || approvalError || assetError || deliveryError || browserError || runError
            || creativeError || creatorSessionError || error?.message ? error.message : '',
          toolError ? 'Agent 只读工具执行失败' : 'Agent Control 请求无效',
        ),
      ...(mapped?.body?.currentRevision == null ? {} : { currentRevision: mapped.body.currentRevision }),
      ...(mapped?.body?.reason ? { reason: mapped.body.reason } : {}),
      ...(mapped?.body?.retryable == null ? {} : { retryable: mapped.body.retryable }),
      ...(runError && error?.details ? { details: error.details } : {}),
      ...(creativeError && error?.details ? { details: error.details } : {}),
      ...(deliveryError && error?.details ? { details: error.details } : {}),
      ...(capabilityToolError && error?.details ? { details: error.details } : {}),
    });
  });

  return router;
}

const router = createAgentControlRouter();
router.createAgentControlRouter = createAgentControlRouter;
router.AGENT_CONTROL_HTTP_SCHEMA = AGENT_CONTROL_HTTP_SCHEMA;
router.AGENT_CONTROL_REQUEST_LIMIT = AGENT_CONTROL_REQUEST_LIMIT;
router.creatorContextForVerifiedNodes = creatorContextForVerifiedNodes;

module.exports = router;
