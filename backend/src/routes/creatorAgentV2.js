'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const creativeModelCatalog = require('../shared/creativeModelCatalog.json');
const seedanceNz = require('../providers/seedanceNz');
const { getProjectDatabase } = require('../services/projectDatabase');
const {
  CreatorConversationError,
  CreatorConversationRepository,
  digest,
} = require('../services/creatorConversationRepository');
const {
  CreatorLlmRuntimeError,
  DEFAULT_MODELS,
  createCreatorLlmRuntimeV2,
  isDocumentedVisionModel,
} = require('../services/creatorLlmRuntimeV2');
const {
  CreatorActionExecutor,
  CreatorActionExecutorError,
} = require('../services/creatorActionExecutor');
const { groundCreatorAudioAttachments } = require('../services/creatorAgentMediaGrounding');
const {
  groundCreatorDocumentAttachments,
  readCreatorLongScriptDocument,
} = require('../services/creatorDocumentGrounding');
const {
  applyScenePatchToLongScriptImport,
  buildLongScriptStyleCanon,
  buildSceneContextPack,
  currentSceneSourcePart,
  prepareLongScriptImport,
  prepareLongScriptProductionBriefMutation,
  prepareScenePartAdvanceMutation,
  prepareScenePatchMutation,
  readLongScriptWork,
  splitLongScriptScenes,
} = require('../services/creatorLongScriptWork');
const { prepareSceneProductionMutation } = require('../services/creatorSceneProduction');
const {
  AgentControlAssetError,
  createAgentControlAssetService,
  resolveAppliedAssetPlacement,
} = require('../services/agentControlAssets');

const CREATOR_AGENT_V2_HTTP_SCHEMA = 't8-creator-agent-http-v2';
const CREATOR_AGENT_V2_REQUEST_LIMIT = 1024 * 1024;

function result(data = {}, message = '') {
  return { schema: CREATOR_AGENT_V2_HTTP_SCHEMA, ok: true, ...(message ? { message } : {}), data };
}

function bounded(value, maximum = 500) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function creatorCreationMode(value) {
  const mode = bounded(value, 24).toLowerCase();
  if (!mode) return 'auto';
  if (!['auto', 'scene'].includes(mode)) {
    throw new CreatorConversationError('CREATOR_CREATION_MODE_INVALID', '创作模式无效，请刷新后重试', 400);
  }
  return mode;
}

function readSettings(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8')) || {};
  } catch {
    return {};
  }
}

function selectedNodeContent(data = {}) {
  const fields = [
    'text', 'prompt', 'outputText', 'directOutputText', 'reply', 'response',
    'transcript', 'lyrics', 'description', 'summary', 'caption',
  ];
  const seen = new Set();
  const parts = [];
  for (const field of fields) {
    const value = bounded(data?.[field], 6_000);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    parts.push(value);
    if (parts.join('\n\n').length >= 6_000) break;
  }
  return parts.join('\n\n').slice(0, 6_000) || null;
}

function creatorTurnBody(input = {}, attachments = [], selectedNodes = []) {
  const requested = bounded(input.text, 30_000);
  if (requested) return requested;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const hasSelectedNodes = Array.isArray(selectedNodes) && selectedNodes.length > 0;
  if (!hasAttachments && !hasSelectedNodes) return '';
  const english = /^en(?:-|$)/iu.test(bounded(input.locale, 24));
  if (hasAttachments && hasSelectedNodes) {
    return english
      ? 'Please review these materials and selected canvas nodes, then suggest the strongest creative direction.'
      : '请先看看这些素材和画布节点，帮我判断最合适的创作方向。';
  }
  if (hasAttachments) {
    return english
      ? 'Please review these materials, then suggest the strongest creative direction.'
      : '请先看看这些素材，帮我判断最合适的创作方向。';
  }
  return english
    ? 'Please review the selected canvas nodes, then suggest the strongest creative direction.'
    : '请先看看我选中的画布节点，帮我判断最合适的创作方向。';
}

function createCreatorAgentV2Router(options = {}) {
  const router = express.Router();
  const runtimeConfig = options.config || config;
  const database = () => options.database || getProjectDatabase(runtimeConfig);
  const settingsProvider = typeof options.settingsProvider === 'function'
    ? options.settingsProvider : () => readSettings(runtimeConfig.SETTINGS_FILE);
  const repository = options.repository || new CreatorConversationRepository({
    filename: path.join(runtimeConfig.DATA_DIR, 'creator-agent', 'conversations-v2.sqlite3'),
  });
  const llm = options.llmRuntime || createCreatorLlmRuntimeV2({
    config: runtimeConfig,
    settingsFile: runtimeConfig.SETTINGS_FILE,
    settingsProvider,
    generateChat: options.generateChat,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.llmTimeoutMs,
  });
  const executor = options.actionExecutor || new CreatorActionExecutor({
    config: runtimeConfig,
    database: database(),
    repository,
    settingsProvider,
    provider: options.seedanceProvider,
    assetIndexer: options.assetIndexer,
    pollIntervalMs: options.pollIntervalMs,
    timeoutMs: options.actionTimeoutMs,
  });
  const assetService = options.assetService || createAgentControlAssetService({ config: runtimeConfig, database: database() });
  const activeResponses = options.activeResponses || new Map();
  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null;

  const requireScope = (input = {}) => {
    const projectId = bounded(input.projectId, 180);
    const canvasId = bounded(input.canvasId, 180);
    const document = database().getCanvas(canvasId);
    if (!projectId || !canvasId || !document || String(document.projectId || '') !== projectId) {
      throw new CreatorConversationError('CREATOR_SCOPE_NOT_FOUND', '当前项目或画布不存在', 404);
    }
    return { projectId, canvasId, document };
  };

  const scopeForSession = (sessionId, input = {}) => {
    const scope = requireScope(input);
    repository.getConversation(sessionId, scope);
    return scope;
  };

  const conversationSnapshot = (sessionId, scope, input = {}) => {
    let snapshot = repository.getConversation(sessionId, { ...scope, ...input });
    if (snapshot.pendingAction && ['running', 'ambiguous'].includes(snapshot.pendingAction.status)) {
      const reconciled = executor.reconcileAction(sessionId, snapshot.pendingAction.id, scope);
      if (['running', 'ambiguous'].includes(reconciled.status)) executor.start(sessionId, reconciled.id, scope);
      snapshot = repository.getConversation(sessionId, { ...scope, ...input });
    }
    return snapshot;
  };

  const assetRef = (asset) => ({
    assetId: String(asset.id),
    kind: ['image', 'video', 'audio'].includes(String(asset.kind)) ? String(asset.kind) : 'file',
    contentHash: bounded(asset.contentHash, 128) || null,
    contentRevision: Math.max(1, Math.trunc(Number(asset.contentRevision) || 1)),
    mimeType: bounded(asset.mimeType, 120) || null,
    duration: Math.max(0, Number(asset.duration || asset.metadata?.duration || 0) || 0),
    previewUrl: `/api/project-assets/${encodeURIComponent(asset.id)}/media`,
    ref: `/api/project-assets/${encodeURIComponent(asset.id)}/media`,
    title: bounded(asset.filename || asset.title || asset.id, 240),
  });

  const hydrateLlmAssetRefs = (refs) => (Array.isArray(refs) ? refs : []).map((ref) => {
    const asset = database().getAsset(ref.assetId);
    let mediaUrl = ref.ref || ref.previewUrl || '';
    try {
      const filename = path.resolve(String(asset?.managedPath || ''));
      const stat = fs.lstatSync(filename);
      if (!stat.isSymbolicLink() && stat.isFile()) mediaUrl = fs.realpathSync.native(filename);
    } catch (_) {
      // The provider media resolver can still use the authenticated project
      // asset route when the managed file is temporarily unavailable.
    }
    return { ...ref, mediaUrl };
  });

  const resolveTurnContext = (scope, input = {}) => {
    const ids = [];
    const explicit = Array.isArray(input.attachments) ? input.attachments : [];
    explicit.forEach((item) => ids.push(bounded(item?.assetId, 180)));
    const selectedNodeIds = [...new Set((Array.isArray(input.selectedNodeIds) ? input.selectedNodeIds : [])
      .map((id) => bounded(id, 180)).filter(Boolean))].slice(0, 24);
    const selected = [];
    const nodeMap = new Map((Array.isArray(scope.document?.nodes) ? scope.document.nodes : [])
      .map((node) => [String(node?.id || ''), node]));
    selectedNodeIds.forEach((nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      const data = node.data && typeof node.data === 'object' ? node.data : {};
      const sourceAssetId = bounded(data.sourceAssetId || data.assetId, 180);
      if (sourceAssetId) ids.push(sourceAssetId);
      selected.push({
        nodeId,
        type: bounded(node.type, 120),
        label: bounded(data.label || data.title || node.type, 240),
        assetId: sourceAssetId || null,
        content: selectedNodeContent(data),
      });
    });
    if (selected.length !== selectedNodeIds.length) {
      throw new CreatorConversationError(
        'CREATOR_SELECTED_NODE_STALE',
        '引用的画布节点已经不存在，请重新选择',
        409,
      );
    }
    const attachments = [...new Set(ids.filter(Boolean))].slice(0, 12).map((assetId) => {
      const asset = database().getAsset(assetId);
      if (!asset || String(asset.projectId || '') !== scope.projectId) {
        throw new CreatorConversationError('CREATOR_INPUT_ASSET_NOT_FOUND', '引用的素材不存在或不属于当前项目', 409);
      }
      return assetRef(asset);
    });
    return { attachments, selected };
  };

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return next();
  });

  router.get('/sessions', (req, res, next) => {
    try {
      const scope = requireScope(req.query || {});
      return res.json(result(repository.listConversations({ ...scope, before: req.query.before, limit: req.query.limit })));
    } catch (error) { return next(error); }
  });

  router.post('/sessions', (req, res, next) => {
    try {
      const scope = requireScope(req.body || {});
      const conversation = repository.createConversation({
        id: req.body?.sessionId,
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        title: req.body?.title,
      });
      return res.status(201).json(result({ conversation }, '已开始新创作'));
    } catch (error) { return next(error); }
  });

  router.get('/sessions/:sessionId', (req, res, next) => {
    try {
      const scope = requireScope(req.query || {});
      return res.json(result(conversationSnapshot(req.params.sessionId, scope, {
        beforeSequence: req.query.beforeMessageId || req.query.beforeSequence,
        limit: req.query.limit,
      })));
    } catch (error) { return next(error); }
  });

  router.get('/sessions/:sessionId/scenes', (req, res, next) => {
    try {
      const scope = requireScope(req.query || {});
      return res.json(result(repository.getLongScriptState(req.params.sessionId, scope)));
    } catch (error) { return next(error); }
  });

  router.put('/sessions/:sessionId/current-scene', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const navigation = repository.setCurrentScene(req.params.sessionId, req.body?.sceneId, scope);
      return res.json(result({ navigation }, '已切换到这个场次'));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/current-scene/confirm', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const navigation = repository.getLongScriptState(req.params.sessionId, scope);
      const sceneId = bounded(req.body?.sceneId || navigation.currentSceneId, 180);
      const sceneIndex = navigation.scenes.findIndex((scene) => scene.sceneId === sceneId);
      if (sceneIndex < 0) {
        throw new CreatorConversationError('CREATOR_SCENE_NOT_FOUND', '这个场次不存在或已经被移除', 404);
      }
      const workState = repository.getLongScriptContextState(req.params.sessionId, {
        ...scope, sceneId,
      });
      const work = workState.work;
      const currentScene = work.activeScenes.find((scene) => scene.sceneId === sceneId);
      const nextSceneId = navigation.scenes[sceneIndex + 1]?.sceneId || sceneId;
      if (currentScene?.status === 'confirmed') {
        if (nextSceneId !== navigation.currentSceneId) {
          repository.setCurrentScene(req.params.sessionId, nextSceneId, scope);
        }
        return res.json(result({
          navigation: repository.getLongScriptState(req.params.sessionId, scope),
        }, nextSceneId === sceneId ? '这一场已经定稿' : '继续下一场'));
      }
      const currentPart = currentSceneSourcePart(work, currentScene);
      if (!currentPart) {
        throw new CreatorConversationError(
          'CREATOR_SCENE_SOURCE_INCOMPLETE',
          '本场原文还没有完整恢复，请重新载入后再继续',
          409,
        );
      }
      const requestedPartId = bounded(req.body?.scenePartId, 180) || null;
      if (currentPart.scenePartId && !requestedPartId) {
        throw new CreatorConversationError(
          'CREATOR_SCENE_PART_REQUIRED',
          '当前段还没有恢复完成，请稍后重试',
          409,
        );
      }
      if (currentPart.scenePartId && requestedPartId !== currentPart.scenePartId) {
        return res.json(result({
          navigation: repository.getLongScriptState(req.params.sessionId, scope),
        }, '这一段已经处理，继续当前段'));
      }
      if (currentPart.index < currentPart.total - 1) {
        const planned = prepareScenePartAdvanceMutation({
          work,
          sceneId,
          currentVersions: workState.currentVersions,
          existingSnapshot: workState.snapshot,
          expectedWorkRevision: workState.snapshot?.revision || 0,
        });
        if (!planned) {
          throw new CreatorConversationError('CREATOR_SCENE_PART_STALE', '当前段已经变化，请恢复最新内容后重试', 409);
        }
        const committed = repository.commitWorkMutation(req.params.sessionId, {
          ...planned,
          currentSceneId: sceneId,
          mutations: planned.mutations.map((mutation) => ({
            ...mutation,
            source: {
              logicalRequestId: bounded(req.body?.clientRequestId, 180) || null,
              proposalDigest: digest({
                sceneId,
                scenePartId: currentPart.scenePartId,
                baseSceneRevision: currentScene.recordRevision,
                action: 'advance-part',
              }),
              editor: 'creator-v2-scene-part-confirm',
            },
          })),
        }, scope);
        if (committed.status !== 'created') {
          throw new CreatorConversationError('CREATOR_SCENE_PART_CONFIRM_FAILED', '这一段没有确认成功，请重试', 409);
        }
        return res.json(result({
          navigation: repository.getLongScriptState(req.params.sessionId, scope),
        }, `这一段已定，继续本场第 ${currentPart.index + 2}/${currentPart.total} 段`));
      }
      const contextPack = buildSceneContextPack({
        work, sceneId, userIntent: '用户确认当前场', workSnapshot: workState.snapshot,
      });
      const scenePatch = {
        schema: 't8-creator-scene-patch-v1',
        sceneId,
        scenePartId: contextPack.scenePartId,
        baseWorkRevision: contextPack.baseWorkRevision,
        baseSceneRevision: contextPack.baseSceneRevision,
        contextDigest: contextPack.contextDigest,
        patch: { status: 'confirmed' },
        entityProposals: [],
        conflicts: [],
      };
      const planned = prepareScenePatchMutation({
        contextPack, scenePatch, work,
        currentVersions: workState.currentVersions,
        existingSnapshot: workState.snapshot,
        allowConfirm: true,
      });
      if (!planned) {
        throw new CreatorConversationError('CREATOR_SCENE_PATCH_STALE', '当前场已经变化，请恢复最新内容后重试', 409);
      }
      const committed = repository.commitWorkMutation(req.params.sessionId, {
        ...planned,
        currentSceneId: nextSceneId,
        mutations: planned.mutations.map((mutation) => ({
          ...mutation,
          source: {
            logicalRequestId: bounded(req.body?.clientRequestId, 180) || null,
            proposalDigest: digest({ sceneId, baseSceneRevision: contextPack.baseSceneRevision, action: 'confirm' }),
            editor: 'creator-v2-scene-confirm',
          },
        })),
      }, scope);
      if (committed.status !== 'created') {
        throw new CreatorConversationError('CREATOR_SCENE_CONFIRM_FAILED', '这场没有确认成功，请重试', 409);
      }
      return res.json(result({
        navigation: repository.getLongScriptState(req.params.sessionId, scope),
      }, nextSceneId === sceneId ? '这一场已经定稿' : '这一场已定稿，继续下一场'));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/messages', async (req, res, next) => {
    let responseId = '';
    let responseControl = null;
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const creationMode = creatorCreationMode(req.body?.creationMode);
      const priorRequest = repository.findUserMessageByClientRequest(req.params.sessionId, {
        ...scope,
        body: req.body?.text,
        clientRequestId: req.body?.clientRequestId,
        creationMode,
      });
      if (priorRequest) {
        const priorAssistant = repository.findAssistantResponseForUserMessage(
          req.params.sessionId, priorRequest.id, scope,
        );
        if (priorAssistant) {
          return res.json(result(conversationSnapshot(req.params.sessionId, scope, { limit: 24 }), '已恢复这次创作'));
        }
      }
      const turnContext = priorRequest
        ? { attachments: priorRequest.media, selected: priorRequest.selectedNodes }
        : resolveTurnContext(scope, req.body || {});
      let turnAttachments = priorRequest
        ? hydrateLlmAssetRefs(priorRequest.media)
        : hydrateLlmAssetRefs(turnContext.attachments);
      const longScriptDocumentSources = [];
      const turnSelectedNodes = priorRequest?.selectedNodes || turnContext.selected;
      const turnBody = priorRequest?.body || creatorTurnBody(req.body || {}, turnAttachments, turnSelectedNodes);
      if (turnAttachments.some((item) => item.kind === 'file')) {
        try {
          const grounding = await groundCreatorDocumentAttachments(turnAttachments);
          turnAttachments = grounding.attachments;
          for (const item of turnAttachments) {
            if (item.kind !== 'file' || !item.documentObservation?.text) continue;
            if (!item.documentObservation.truncated) {
              longScriptDocumentSources.push({
                source: item.documentObservation.text,
                sourceKind: 'asset', sourceAssetId: item.assetId, title: item.title,
              });
              continue;
            }
            // The 30k observation is deliberately bounded for ordinary LLM
            // context. Long-script persistence must read the verified managed
            // document itself or fail clearly; it must never import only the
            // visible prefix while claiming the whole script was accepted.
            const full = await readCreatorLongScriptDocument(item);
            if (full?.source) longScriptDocumentSources.push({
              source: full.source,
              sourceKind: 'asset', sourceAssetId: item.assetId, title: item.title,
            });
          }
        } catch (documentError) {
          throw new CreatorConversationError(
            bounded(documentError?.code, 120) || 'CREATOR_DOCUMENT_READ_FAILED',
            bounded(documentError?.message, 500) || '文档正文没有读取成功，请重新选择文件',
            Math.max(400, Math.min(499, Math.trunc(Number(documentError?.status) || 422))),
          );
        }
      }
      if (!priorRequest && turnAttachments.some((item) => item.kind === 'audio')) {
        const settings = settingsProvider() || {};
        const apiKey = bounded(settings.zhenzhenSd2ApiKey, 4_000);
        if (!apiKey) throw new CreatorConversationError('CREATOR_AUDIO_TRANSCRIBER_CREDENTIAL_REQUIRED', '需要先配置贞贞的平价AI小屋，才能读取音频内容', 409);
        const grounding = await groundCreatorAudioAttachments(turnAttachments, {
          provider: 'seedance-nz',
          transcribeAudio: options.creatorAudioTranscriber || ((attachment) => seedanceNz.transcribeAudio({
            audioUrl: attachment.mediaUrl || attachment.ref,
            model: 'whisper-1',
            response_format: 'verbose_json',
          }, apiKey, { baseUrl: bounded(settings.zhenzhenSd2BaseUrl, 2_000) || undefined })),
        });
        turnAttachments = grounding.attachments;
      }
      const preferences = repository.getPreferences(scope);
      const llmSnapshot = llm.modelSnapshot('llm', preferences, {
        requiresVision: turnAttachments.some((item) => ['image', 'video'].includes(item.kind)),
        preferredModelId: creationMode === 'scene'
          && !turnAttachments.some((item) => ['image', 'video'].includes(item.kind))
          ? 'qwen/qwen3.7-max' : null,
      });
      const appended = priorRequest ? { duplicate: true, message: priorRequest }
        : repository.appendUserMessage(req.params.sessionId, {
          ...scope,
          body: turnBody,
          attachments: turnAttachments,
          selectedNodes: turnSelectedNodes,
          clientRequestId: req.body?.clientRequestId,
          creationMode,
        });
      if (appended.duplicate) {
        const priorAssistant = repository.findAssistantResponseForUserMessage(
          req.params.sessionId, appended.message.id, scope,
        );
        if (priorAssistant) {
          if (priorAssistant.status === 'streaming') {
            repository.recoverStagedAssistantResponse(
              req.params.sessionId, priorAssistant.responseId, scope,
            );
          }
          const snapshot = conversationSnapshot(req.params.sessionId, scope, { limit: 24 });
          return res.json(result(snapshot, '已恢复这次创作'));
        }
      }
      responseId = `response-${req.body.clientRequestId}`;
      const startedResponse = repository.startAssistantResponse(req.params.sessionId, {
        ...scope,
        responseId,
        replyToMessageId: appended.message.id,
        modelSnapshotDigest: digest(llmSnapshot),
      });
      if (!startedResponse.startedNew) {
        return res.json(result(
          conversationSnapshot(req.params.sessionId, scope, { limit: 24 }),
          '这次创作正在处理中',
        ));
      }
      responseControl = {
        sessionId: req.params.sessionId,
        projectId: scope.projectId,
        canvasId: scope.canvasId,
        abort: null,
        stopRequested: false,
      };
      const responseKey = `${scope.projectId}\u0000${scope.canvasId}\u0000${req.params.sessionId}\u0000${responseId}`;
      activeResponses.set(responseKey, responseControl);
      const conversationBefore = repository.getConversation(req.params.sessionId, { ...scope, limit: 18 });
      const before = conversationBefore.messages
        .filter((message) => message.responseId !== responseId && message.id !== appended.message.id);
      const sourceCandidates = [
        {
          source: priorRequest ? appended.message.body : String(req.body?.text == null ? '' : req.body.text),
          sourceKind: 'message', sourceAssetId: null, title: null,
        },
        ...longScriptDocumentSources,
      ];
      const requestedSceneId = bounded(
        req.body?.currentSceneId || conversationBefore.conversation.currentSceneId,
        180,
      );
      const explicitImportCandidate = sourceCandidates.find((sourceCandidate) => {
        const parsed = splitLongScriptScenes(sourceCandidate.source);
        return parsed.explicitHeadings && parsed.scenes.length >= 2;
      }) || null;
      const forcedSingleSceneCandidate = creationMode === 'scene' && !requestedSceneId
        ? ([...longScriptDocumentSources, sourceCandidates[0]]
          .find((sourceCandidate) => String(sourceCandidate?.source || '').trim()) || null)
        : null;
      const importCandidate = explicitImportCandidate || forcedSingleSceneCandidate;
      const singleSceneDraftImport = Boolean(importCandidate && !explicitImportCandidate);
      const workStateBefore = importCandidate
        ? repository.getWorkState(req.params.sessionId, {
            ...scope,
            includeCurrentVersions: true,
          })
        : repository.getLongScriptContextState(req.params.sessionId, {
            ...scope,
            sceneId: requestedSceneId,
          });
      const longScriptImport = importCandidate
        ? prepareLongScriptImport({
          sessionId: req.params.sessionId,
          ...importCandidate,
          currentVersions: workStateBefore.currentVersions,
          existingSnapshot: workStateBefore.snapshot,
          allowSingleScene: singleSceneDraftImport,
        }) : null;
      const longScriptWork = longScriptImport?.previewWork || workStateBefore.work || readLongScriptWork(
        workStateBefore.currentVersions,
        workStateBefore.snapshot,
      );
      const sceneContext = longScriptWork.activeScenes?.length
        ? buildSceneContextPack({
              work: longScriptWork,
              sceneId: requestedSceneId || longScriptWork.currentSceneId,
              mode: longScriptImport
                ? singleSceneDraftImport ? 'scene-draft' : 'import-preview'
                : creationMode === 'scene' ? 'scene-draft' : 'scene-edit',
              userIntent: appended.message.body,
            workSnapshot: workStateBefore.snapshot,
            styleCanon: buildLongScriptStyleCanon({
              currentVersions: workStateBefore.currentVersions,
              workingBrief: conversationBefore.conversation.workingBrief,
            }),
          })
        : null;
      const generated = await llm.respond({
        prompt: appended.message.body,
        history: before,
        preferences,
        attachments: hydrateLlmAssetRefs(appended.message.media),
        selectedNodes: turnSelectedNodes,
        workingBrief: conversationBefore.conversation.workingBrief,
        currentPhase: conversationBefore.conversation.phase,
        sceneContext,
      }, {
        registerAbort: (handler) => {
          responseControl.abort = handler;
          // A stop can arrive after the durable assistant row is created but
          // before the provider installs its AbortController. Keep that stop
          // sticky so the earliest possible click cannot be lost.
          if (responseControl.stopRequested) handler();
        },
      });
      if (responseControl.stopRequested) {
        throw new CreatorLlmRuntimeError('CREATOR_LLM_STOPPED', '已停止这次回复。', 409);
      }
      const allowedAssetIds = new Set(appended.message.media.map((item) => item.assetId));
      const proposedAction = generated.proposedAction ? {
        ...generated.proposedAction,
        inputAssetIds: generated.proposedAction.inputAssetIds.filter((assetId) => allowedAssetIds.has(assetId)),
        ...(Array.isArray(generated.proposedAction.shots) ? {
          shots: generated.proposedAction.shots.map((shot) => ({
            ...shot,
            inputAssetIds: (Array.isArray(shot.inputAssetIds) ? shot.inputAssetIds : [])
              .filter((assetId) => allowedAssetIds.has(assetId)),
          })),
        } : {}),
      } : null;
      const scenePatchMutation = generated.scenePatch && sceneContext
        ? longScriptImport && sceneContext.mode === 'scene-draft'
          ? applyScenePatchToLongScriptImport({
              importPlan: longScriptImport,
              contextPack: sceneContext,
              scenePatch: generated.scenePatch,
              currentVersions: workStateBefore.currentVersions,
              existingSnapshot: workStateBefore.snapshot,
            })
          : !longScriptImport ? prepareScenePatchMutation({
            contextPack: sceneContext,
            scenePatch: generated.scenePatch,
            work: longScriptWork,
            currentVersions: workStateBefore.currentVersions,
            existingSnapshot: workStateBefore.snapshot,
            allowConfirm: false,
          }) : null
        : null;
      if (sceneContext?.mode !== 'import-preview' && generated.scenePatch && !scenePatchMutation) {
        throw new CreatorConversationError(
          'CREATOR_SCENE_PATCH_STALE',
          '当前场已经变化，请恢复最新内容后重试',
          409,
        );
      }
      const productionBriefMutation = longScriptWork.activeScenes?.length
        ? prepareLongScriptProductionBriefMutation({
            currentVersions: workStateBefore.currentVersions,
            workingBrief: generated.workingBrief,
            title: longScriptWork.title,
          })
        : null;
      const actionScene = proposedAction?.workBinding
        ? scenePatchMutation?.scene
          || longScriptWork.activeScenes.find((scene) => scene.sceneId === proposedAction.workBinding.sceneId)
          || null
        : null;
      const sceneProductionPlan = actionScene ? prepareSceneProductionMutation({
        scene: actionScene,
        action: proposedAction,
        currentVersions: workStateBefore.currentVersions,
      }) : null;
      if (proposedAction?.workBinding && !sceneProductionPlan) {
        throw new CreatorConversationError(
          'CREATOR_SCENE_PRODUCTION_INVALID',
          '当前场镜头计划没有完整保存，请重试',
          422,
        );
      }
      const workMutationPlan = longScriptImport ? {
        expectedWorkRevision: longScriptImport.expectedWorkRevision,
        currentSceneId: scenePatchMutation?.currentSceneId || longScriptImport.previewWork.currentSceneId,
        taskProfile: longScriptImport.taskProfile,
        mutations: [
          ...(scenePatchMutation?.importPlan?.mutations || longScriptImport.mutations),
          ...(productionBriefMutation ? [productionBriefMutation] : []),
        ],
      } : scenePatchMutation || productionBriefMutation || sceneProductionPlan ? {
        expectedWorkRevision: workStateBefore.snapshot?.revision || 0,
        currentSceneId: scenePatchMutation?.currentSceneId || requestedSceneId || longScriptWork.currentSceneId,
        taskProfile: scenePatchMutation?.taskProfile || workStateBefore.snapshot?.taskProfile,
        mutations: [
          ...(scenePatchMutation?.mutations || []),
          ...(productionBriefMutation ? [productionBriefMutation] : []),
          ...(sceneProductionPlan?.mutations || []),
        ],
      } : null;
      const completionAction = proposedAction?.workBinding ? {
        ...proposedAction,
        shots: sceneProductionPlan.shots,
        workBinding: {
          ...proposedAction.workBinding,
          sceneRevision: Math.max(1, Math.trunc(Number(
            scenePatchMutation?.scene?.recordRevision
              || proposedAction.workBinding.sceneRevision,
          ) || 1)),
          shotIds: sceneProductionPlan.shotIds,
          shotPlanDigest: sceneProductionPlan.planDigest,
        },
      } : proposedAction;
      const assistantCompletion = {
        ...scope,
        body: generated.replyMarkdown,
        suggestions: generated.suggestions,
        action: completionAction,
        conversationContext: {
          workingBrief: generated.workingBrief,
          phaseDecision: generated.phaseDecision,
          source: 'llm-turn',
        },
        ...(workMutationPlan ? {
          workMutation: {
            expectedWorkRevision: workMutationPlan.expectedWorkRevision,
            currentSceneId: workMutationPlan.currentSceneId,
            taskProfile: workMutationPlan.taskProfile,
            mutations: workMutationPlan.mutations.map((mutation) => ({
              ...mutation,
              source: {
                responseId,
                logicalRequestId: req.body?.clientRequestId,
                proposalDigest: generated.evidence?.responseDigest,
                editor: 'creator-v2-long-script-import',
              },
            })),
          },
        } : {}),
      };
      repository.stageAssistantResult(req.params.sessionId, responseId, assistantCompletion, scope);
      const assistant = repository.completeAssistantResponse(
        req.params.sessionId, responseId, assistantCompletion,
      );
      const snapshot = conversationSnapshot(req.params.sessionId, scope, { limit: 24 });
      return res.status(201).json(result({ ...snapshot, assistant, evidence: generated.evidence }, '回复已完成'));
    } catch (error) {
      if (responseId) {
        try {
          repository.discardAssistantDraft(req.params.sessionId, responseId, {
            projectId: req.body?.projectId,
            canvasId: req.body?.canvasId,
          });
          repository.failAssistantResponse(req.params.sessionId, responseId, {
            projectId: req.body?.projectId,
            canvasId: req.body?.canvasId,
            stopped: error?.code === 'CREATOR_LLM_STOPPED',
            errorCode: error?.code,
            body: error?.code === 'CREATOR_LLM_STOPPED' ? '已停止。' : '这次没有生成成功，请重试。',
          });
        } catch (_) {}
      }
      return next(error);
    } finally {
      if (responseId) {
        const responseKey = `${bounded(req.body?.projectId, 180)}\u0000${bounded(req.body?.canvasId, 180)}\u0000${req.params.sessionId}\u0000${responseId}`;
        if (activeResponses.get(responseKey) === responseControl) activeResponses.delete(responseKey);
      }
    }
  });

  router.post('/sessions/:sessionId/responses/:responseId/stop', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const responseKey = `${scope.projectId}\u0000${scope.canvasId}\u0000${req.params.sessionId}\u0000${req.params.responseId}`;
      const control = activeResponses.get(responseKey);
      const matches = control
        && control.sessionId === req.params.sessionId
        && control.projectId === scope.projectId
        && control.canvasId === scope.canvasId;
      if (matches) {
        control.stopRequested = true;
        control.abort?.();
      }
      return res.json(result({ stopped: Boolean(matches) }, matches ? '正在停止回复' : '回复已经结束'));
    } catch (error) { return next(error); }
  });

  router.get('/sessions/:sessionId/events', (req, res, next) => {
    let scope;
    try { scope = scopeForSession(req.params.sessionId, req.query || {}); } catch (error) { return next(error); }
    // Native EventSource keeps the original query string when it reconnects
    // and sends its latest cursor in Last-Event-ID. Prefer that newer header;
    // otherwise every reconnect would replay from the launcher's stale query.
    const lastEventId = bounded(req.get('Last-Event-ID'), 80);
    const cursorSource = lastEventId || req.query?.after;
    const after = Math.max(0, Math.trunc(Number(cursorSource) || 0));
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    // Change sequences are monotonic. Keep one high-water mark instead of an
    // ever-growing Set so a long-lived Creator panel has constant SSE memory.
    let lastSentSequence = after;
    const send = (event) => {
      if (res.writableEnded) return;
      const sequence = Math.max(0, Math.trunc(Number(event.sequence ?? event.data?.sequence) || 0));
      if (!sequence || sequence <= lastSentSequence) return;
      lastSentSequence = sequence;
      res.write(`id: ${sequence}\n`);
      res.write(`event: ${event.kind}\n`);
      res.write(`data: ${JSON.stringify({ ...event, sequence })}\n\n`);
    };
    const pending = [];
    let replaying = true;
    const unsubscribe = repository.subscribe(req.params.sessionId, (event) => {
      if (replaying) pending.push(event);
      else send(event);
    });
    let replayAfter = after;
    while (true) {
      const page = repository.listChanges(req.params.sessionId, { ...scope, after: replayAfter, limit: 200 });
      page.forEach(send);
      if (page.length < 200) break;
      replayAfter = Number(page.at(-1)?.sequence) || replayAfter;
    }
    replaying = false;
    pending.sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)).forEach(send);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15_000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.once('close', close);
    res.once('close', close);
    return undefined;
  });

  router.get('/settings', (req, res, next) => {
    try {
      const scope = requireScope(req.query || {});
      return res.json(result({ preferences: repository.getPreferences(scope) }));
    } catch (error) { return next(error); }
  });

  router.put('/settings', (req, res, next) => {
    try {
      const scope = requireScope(req.body || {});
      return res.json(result({ preferences: repository.putPreferences({ ...scope, preferences: req.body?.preferences }) }, '生成设置已保存'));
    } catch (error) { return next(error); }
  });

  router.get('/settings/catalog', (req, res, next) => {
    try {
      requireScope(req.query || {});
      const settings = settingsProvider() || {};
      const providerReady = {
        'seedance-nz': Boolean(bounded(settings.zhenzhenSd2ApiKey, 4_000)),
        zhenzhen: Boolean(bounded(settings.llmApiKey || settings.zhenzhenApiKey, 4_000)),
      };
      for (const provider of Array.isArray(settings.advancedProviders) ? settings.advancedProviders : []) {
        providerReady[bounded(provider?.id, 180)] = provider?.enabled === true && Boolean(bounded(provider?.apiKey, 4_000));
      }
      const projection = (kind) => (Array.isArray(creativeModelCatalog[kind]) ? creativeModelCatalog[kind] : [])
        // Creator's compact production bridge currently executes media through
        // the verified Seedance NZ adapter.  Do not advertise image/video
        // providers that this route cannot actually run; all configured LLM
        // providers remain selectable from the LLM dropdown.
        .filter((item) => item.available !== false && (kind === 'llm' || item.provider === 'seedance-nz'))
        .map((item) => ({
          providerId: item.provider,
          modelId: item.model,
          label: item.label || item.model,
          providerLabel: item.platformLabel || item.provider,
          family: item.family || 'other',
          configured: providerReady[item.provider] === true,
          recommended: item.provider === 'seedance-nz' && item.model === DEFAULT_MODELS[kind],
          visionCapable: kind !== 'llm' || isDocumentedVisionModel(item.provider, item.model),
        }));
      const providers = [...new Map(['image', 'video'].flatMap((kind) => projection(kind))
        .map((item) => [item.providerId, { id: item.providerId, label: item.providerLabel, configured: item.configured }])).values()];
      return res.json(result({
        catalogDigest: creativeModelCatalog.sourceDigest,
        providers,
        llm: projection('llm'),
        image: projection('image'),
        video: projection('video'),
      }));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/actions/:actionId/confirm', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const action = executor.start(req.params.sessionId, req.params.actionId, scope);
      repository.updateConversationPhase(req.params.sessionId, 'shots', scope);
      return res.status(202).json(result({ action }, '已开始生成'));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/actions/:actionId/cancel', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const action = repository.cancelPendingAction(req.params.actionId, req.params.sessionId, scope);
      return res.json(result({ action }, '已返回修改'));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/actions/:actionId/retry', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const clientRequestId = bounded(req.body?.clientRequestId, 180)
        || `action-retry-${digest({ actionId: req.params.actionId }).slice(0, 32)}`;
      const action = repository.retryFailedAction(
        req.params.actionId, req.params.sessionId, { clientRequestId }, scope,
      );
      const started = executor.start(req.params.sessionId, action.id, scope);
      return res.status(202).json(result({ action: started }, '正在重新生成这一条'));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/media/:assetId/reviewed', (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const actionId = bounded(req.body?.actionId, 180);
      const assetId = bounded(req.params.assetId, 180);
      const clientRequestId = bounded(req.body?.clientRequestId, 180)
        || `media-review-${digest({ actionId, assetId }).slice(0, 32)}`;
      const action = repository.recordMediaReviewed(actionId, req.params.sessionId, assetId, {
        clientRequestId,
        evidenceKind: req.body?.evidenceKind,
      }, scope);
      return res.json(result({ action }, '结果已显示'));
    } catch (error) { return next(error); }
  });

  router.post('/sessions/:sessionId/media/:assetId/send-to-canvas', async (req, res, next) => {
    try {
      const scope = scopeForSession(req.params.sessionId, req.body || {});
      const actionId = bounded(req.body?.actionId, 180);
      const action = repository.getAction(actionId, req.params.sessionId, scope);
      const assetId = bounded(req.params.assetId, 180);
      if (!action.resultAssets.some((item) => item.assetId === assetId)) {
        throw new CreatorConversationError('CREATOR_ACTION_ASSET_MISMATCH', '这个素材不属于当前生成结果', 409);
      }
      const operationId = bounded(req.body?.clientRequestId, 180)
        || `media-send-${digest({
          actionId, assetId, targetNodeId: bounded(req.body?.targetNodeId, 180) || null,
          position: req.body?.position || null,
        }).slice(0, 32)}`;
      repository.adoptMediaCandidate(actionId, req.params.sessionId, assetId, {
        clientRequestId: `${operationId}:adopt`,
      }, scope);
      const placement = repository.beginMediaPlacement(actionId, req.params.sessionId, assetId, {
        clientRequestId: `${operationId}:place`,
        targetNodeId: req.body?.targetNodeId,
        position: req.body?.position,
      }, scope);
      const persistedAsset = placement.action.resultAssets.find((item) => item.assetId === assetId);
      if (placement.status === 'completed' && persistedAsset?.canvasNodeId) {
        return res.json(result({
          nodeId: persistedAsset.canvasNodeId,
          duplicate: true,
          canvasRevision: persistedAsset.canvasRevision,
        }, '已在画布中'));
      }
      const document = database().getCanvas(scope.canvasId);
      const snapshot = await assetService.inspectPlace(assetId, document, {
        projectId: scope.projectId,
        targetNodeId: req.body?.targetNodeId,
        position: req.body?.position,
      });
      const resolved = resolveAppliedAssetPlacement(database(), scope.canvasId, snapshot);
      if (resolved.status === 'applied') {
        repository.completeMediaPlacement(actionId, req.params.sessionId, assetId, {
          clientRequestId: `${operationId}:place`,
          nodeId: snapshot.placement.nodeId,
          patchId: snapshot.patch.id,
          patchRequestDigest: resolved.application.requestDigest,
          canvasRevision: resolved.application.appliedRevision,
        }, scope);
        return res.json(result({
          nodeId: snapshot.placement.nodeId,
          duplicate: true,
          canvasRevision: resolved.application.appliedRevision,
        }, '已在画布中'));
      }
      const preview = database().previewCanvasPatch(scope.canvasId, snapshot.patch, {
        projectId: scope.projectId,
        actorId: 'local-owner',
        sessionId: `creator-agent:${req.params.sessionId}`,
      });
      const applied = database().applyCanvasPatch(scope.canvasId, snapshot.patch, {
        projectId: scope.projectId,
        actorId: 'local-owner',
        sessionId: `creator-agent:${req.params.sessionId}`,
        confirmed: true,
        previewDigest: preview.previewDigest,
      });
      if (faultInjector) faultInjector('canvas-patch-applied', {
        sessionId: req.params.sessionId,
        actionId,
        assetId,
        patchId: snapshot.patch.id,
        canvasRevision: applied.revision,
      });
      const recorded = resolveAppliedAssetPlacement(database(), scope.canvasId, snapshot);
      repository.completeMediaPlacement(actionId, req.params.sessionId, assetId, {
        clientRequestId: `${operationId}:place`,
        nodeId: snapshot.placement.nodeId,
        patchId: snapshot.patch.id,
        patchRequestDigest: recorded.application.requestDigest,
        canvasRevision: recorded.application.appliedRevision,
      }, scope);
      return res.json(result({ nodeId: snapshot.placement.nodeId, duplicate: false, canvasRevision: applied.revision }, '已发送到画布'));
    } catch (error) { return next(error); }
  });

  router.use((error, _req, res, _next) => {
    const known = error instanceof CreatorConversationError
      || error instanceof CreatorLlmRuntimeError
      || error instanceof CreatorActionExecutorError
      || error instanceof AgentControlAssetError;
    const status = known ? Math.max(400, Math.min(599, Number(error.status) || 400)) : 500;
    return res.status(status).json({
      schema: CREATOR_AGENT_V2_HTTP_SCHEMA,
      ok: false,
      code: known ? error.code : 'CREATOR_AGENT_V2_FAILED',
      message: known ? error.message : '创作 Agent 暂时无法完成这个操作，请重试',
    });
  });

  router.creatorRepository = repository;
  router.creatorExecutor = executor;
  return router;
}

module.exports = {
  CREATOR_AGENT_V2_HTTP_SCHEMA,
  CREATOR_AGENT_V2_REQUEST_LIMIT,
  createCreatorAgentV2Router,
};
