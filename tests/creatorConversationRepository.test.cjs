'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  CreatorConversationError,
  CreatorConversationRepository,
  digest,
} = require('../backend/src/services/creatorConversationRepository.js');
const {
  prepareLongScriptImport,
} = require('../backend/src/services/creatorLongScriptWork.js');

function fixture() {
  const repository = new CreatorConversationRepository();
  const conversation = repository.createConversation({
    id: 'creator-test-session',
    projectId: 'project-local',
    canvasId: 'canvas-local',
    title: '雨夜车站短片',
  });
  return { repository, conversation };
}

test('Creator v2 repository stores scoped conversations and paginates messages', () => {
  const { repository, conversation } = fixture();
  try {
    assert.equal(conversation.sequence, 0);
    for (let index = 0; index < 55; index += 1) {
      repository.appendUserMessage(conversation.id, {
        projectId: 'project-local',
        canvasId: 'canvas-local',
        body: `用户消息 ${index}`,
        clientRequestId: `request-${String(index).padStart(3, '0')}`,
      });
    }
    const first = repository.getConversation(conversation.id, {
      projectId: 'project-local',
      canvasId: 'canvas-local',
      limit: 24,
    });
    assert.equal(first.messages.length, 24);
    assert.ok(first.nextBeforeSequence);
    assert.deepEqual(first.messages.map((message) => message.sequence), Array.from({ length: 24 }, (_, index) => index + 32));
    const second = repository.getConversation(conversation.id, {
      projectId: 'project-local',
      canvasId: 'canvas-local',
      beforeSequence: first.nextBeforeSequence,
      limit: 24,
    });
    assert.equal(second.messages.length, 24);
    assert.equal(second.messages[0].sequence, 8);
    assert.throws(() => repository.getConversation(conversation.id, {
      projectId: 'another-project',
      canvasId: 'canvas-local',
    }), (error) => error instanceof CreatorConversationError && error.code === 'CREATOR_SESSION_SCOPE_MISMATCH');
  } finally {
    repository.close();
  }
});

test('Creator history hides only legacy untitled blank conversations without deleting them', () => {
  const repository = new CreatorConversationRepository();
  try {
    const hidden = repository.createConversation({
      id: 'creator-blank-hidden', projectId: 'project-local', canvasId: 'canvas-local',
    });
    const titled = repository.createConversation({
      id: 'creator-blank-titled', projectId: 'project-local', canvasId: 'canvas-local', title: '等待素材的广告',
    });
    const active = repository.createConversation({
      id: 'creator-blank-started', projectId: 'project-local', canvasId: 'canvas-local',
    });
    repository.appendUserMessage(active.id, {
      body: '做一支十五秒产品广告', clientRequestId: 'request-history-visible-001',
    });

    const listed = repository.listConversations({
      projectId: 'project-local', canvasId: 'canvas-local', limit: 20,
    });
    assert.equal(listed.items.some((item) => item.id === hidden.id), false);
    assert.equal(listed.items.some((item) => item.id === titled.id), true);
    assert.equal(listed.items.some((item) => item.id === active.id), true);
    assert.equal(repository.getConversation(hidden.id).conversation.id, hidden.id);
  } finally {
    repository.close();
  }
});

test('Creator message idempotency rejects a reused request identity with different content', () => {
  const { repository, conversation } = fixture();
  try {
    const first = repository.appendUserMessage(conversation.id, {
      body: '做一张电影感海报',
      clientRequestId: 'request-stable-001',
    });
    const replay = repository.appendUserMessage(conversation.id, {
      body: '做一张电影感海报',
      clientRequestId: 'request-stable-001',
    });
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.message.id, first.message.id);
    assert.throws(() => repository.appendUserMessage(conversation.id, {
      body: '换成另一个内容',
      clientRequestId: 'request-stable-001',
    }), (error) => error?.code === 'CREATOR_REQUEST_CONFLICT');
  } finally {
    repository.close();
  }
});

test('Creator user turn durably binds selected canvas content into the idempotency digest', () => {
  const { repository, conversation } = fixture();
  try {
    const selectedNodes = [{
      nodeId: 'text-node-001', type: 'text', label: '结尾备注', assetId: null,
      content: '列车驶过，但她没有上车。',
    }];
    const first = repository.appendUserMessage(conversation.id, {
      body: '只改我选中的结尾', clientRequestId: 'request-selected-001', selectedNodes,
    });
    assert.deepEqual(first.message.selectedNodes, selectedNodes);
    assert.equal(first.message.replyToMessageId, null);
    const replay = repository.findUserMessageByRequest(conversation.id, {
      body: '只改我选中的结尾', clientRequestId: 'request-selected-001', selectedNodes,
    });
    assert.equal(replay.id, first.message.id);
    const durableReplay = repository.findUserMessageByClientRequest(conversation.id, {
      body: '只改我选中的结尾', clientRequestId: 'request-selected-001',
    });
    assert.deepEqual(durableReplay.selectedNodes, selectedNodes);
    assert.throws(() => repository.findUserMessageByRequest(conversation.id, {
      body: '只改我选中的结尾', clientRequestId: 'request-selected-001',
      selectedNodes: [{ ...selectedNodes[0], content: '列车驶过，她上车离开。' }],
    }), (error) => error?.code === 'CREATOR_REQUEST_CONFLICT');
  } finally { repository.close(); }
});

test('Creator permits only one durable streaming response per conversation', () => {
  const { repository, conversation } = fixture();
  try {
    const user = repository.appendUserMessage(conversation.id, {
      body: '先给我一个方向', clientRequestId: 'request-response-lock-001',
    });
    const first = repository.startAssistantResponse(conversation.id, {
      responseId: 'response-lock-001', replyToMessageId: user.message.id,
    });
    assert.equal(first.replyToMessageId, user.message.id);
    assert.equal(first.startedNew, true);
    assert.equal(repository.startAssistantResponse(conversation.id, {
      responseId: 'response-lock-001', replyToMessageId: user.message.id,
    }).startedNew, false);
    assert.throws(() => repository.startAssistantResponse(conversation.id, {
      responseId: 'response-lock-002', replyToMessageId: user.message.id,
    }), (error) => error?.code === 'CREATOR_RESPONSE_PENDING' && error?.status === 409);
    repository.failAssistantResponse(conversation.id, first.responseId, { stopped: true });
    const second = repository.startAssistantResponse(conversation.id, {
      responseId: 'response-lock-002', replyToMessageId: user.message.id,
    });
    assert.equal(second.status, 'streaming');
  } finally { repository.close(); }
});

test('Creator commits assistant reply, proposed action, working brief, and phase in one transaction', () => {
  const { repository, conversation } = fixture();
  try {
    const user = repository.appendUserMessage(conversation.id, {
      body: '做一支雨夜车站短片', clientRequestId: 'request-atomic-turn-001',
    });
    const response = repository.startAssistantResponse(conversation.id, {
      responseId: 'response-atomic-turn-001', replyToMessageId: user.message.id,
    });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '把雨声留到最后，列车灯只出现一次。',
      suggestions: ['写成分镜', '改成清晨', '锁定方案'],
      conversationContext: {
        workingBrief: { goal: '完成一支雨夜车站短片', constraints: '列车灯只出现一次' },
        phaseDecision: { phase: 'script', transition: 'advance', reason: '方向已经明确' },
      },
    });
    const snapshot = repository.getConversation(conversation.id);
    assert.equal(snapshot.conversation.phase, 'script');
    assert.equal(snapshot.conversation.workingBrief.goal, '完成一支雨夜车站短片');
    assert.equal(snapshot.conversation.workingBrief.constraints, '列车灯只出现一次');
    assert.equal(snapshot.messages.at(-1).status, 'completed');
    assert.deepEqual(repository.listChanges(conversation.id, { after: 2 }).map((item) => item.kind), ['message', 'conversation']);
  } finally { repository.close(); }
});

test('Creator completes the LLM reply and scoped long-script import in one transaction', () => {
  const { repository, conversation } = fixture();
  const taskProfile = {
    family: 'story', intent: '逐场制作长剧本', deliveryKind: 'long-form-story',
    modalities: ['text', 'image', 'video'], qualityMode: 'standard',
  };
  try {
    const user = repository.appendUserMessage(conversation.id, {
      body: '导入两场长剧本', clientRequestId: 'request-work-atomic-001',
    });
    const response = repository.startAssistantResponse(conversation.id, {
      responseId: 'response-work-atomic-001', replyToMessageId: user.message.id,
    });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '剧本已经按场整理好，我们先推进第一场。',
      suggestions: ['细化第一场', '换个开场视角', '锁定第一场'],
      workMutation: {
        expectedWorkRevision: 0,
        taskProfile,
        mutations: [{
          kind: 'ScriptDoc', scopeKey: 'root', title: '长剧本',
          fields: { title: '长剧本', manifest: { sceneCount: 2 } }, baseVersionId: null,
        }],
      },
    });
    const snapshot = repository.getConversation(conversation.id);
    assert.equal(snapshot.messages.at(-1).status, 'completed');
    assert.equal(snapshot.work.snapshot.revision, 1);
    assert.equal(snapshot.work.artifacts.length, 1);
    assert.deepEqual(repository.listChanges(conversation.id, { after: 2 }).map((item) => item.kind), [
      'message', 'work',
    ]);

    const secondUser = repository.appendUserMessage(conversation.id, {
      body: '导入一个损坏的场次', clientRequestId: 'request-work-atomic-002',
    });
    const second = repository.startAssistantResponse(conversation.id, {
      responseId: 'response-work-atomic-002', replyToMessageId: secondUser.message.id,
    });
    assert.throws(() => repository.completeAssistantResponse(conversation.id, second.responseId, {
      body: '这条回复不得半写入。',
      suggestions: ['继续当前场', '换个视角', '锁定当前场'],
      workMutation: {
        expectedWorkRevision: 0,
        taskProfile,
        mutations: [{
          kind: 'ScriptDoc', scopeKey: 'root', title: '损坏更新',
          fields: { title: '损坏更新' }, baseVersionId: null,
        }],
      },
    }), (error) => error?.code === 'CREATOR_WORK_COMMIT_BLOCKED');
    const afterFailure = repository.getConversation(conversation.id);
    assert.equal(afterFailure.messages.at(-1).status, 'streaming');
    assert.equal(afterFailure.work.snapshot.revision, 1);
  } finally { repository.close(); }
});

test('Creator recovers a staged LLM result after every atomic commit crash boundary', () => {
  const faultPoints = [
    'response-draft-staged',
    'assistant-response-updated',
    'work-version-inserted',
    'work-before-current-pointer-update',
    'work-current-pointer-updated',
    'work-before-snapshot-update',
    'work-snapshot-updated',
    'assistant-before-commit',
  ];
  faultPoints.forEach((faultPoint, faultIndex) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `t8-creator-crash-${faultIndex}-`));
    const filename = path.join(directory, 'creator-v2.sqlite');
    let repository = null;
    let reopened = null;
    try {
      let injected = false;
      repository = new CreatorConversationRepository({
        filename,
        faultInjector(point) {
          if (!injected && point === faultPoint) {
            injected = true;
            throw new Error(`simulated-crash:${point}`);
          }
        },
      });
      const sessionId = `creator-crash-session-${faultIndex}`;
      repository.createConversation({
        id: sessionId, projectId: 'project-local', canvasId: 'canvas-local',
      });
      const user = repository.appendUserMessage(sessionId, {
        body: '继续第一场', clientRequestId: `request-crash-${faultIndex}`,
      });
      const response = repository.startAssistantResponse(sessionId, {
        responseId: `response-crash-${faultIndex}`,
        replyToMessageId: user.message.id,
      });
      const completion = {
        body: '第一场已经整理好，可以继续。',
        suggestions: ['确认这一场', '调整节奏', '继续下一场'],
        conversationContext: {
          workingBrief: { goal: '完成长剧本' },
          phaseDecision: { phase: 'script', transition: 'advance', reason: '用户正在推进剧本' },
        },
        workMutation: {
          expectedWorkRevision: 0,
          taskProfile: {
            family: 'story', intent: '逐场制作长剧本', deliveryKind: 'long-form-story',
            modalities: ['text', 'image', 'video'], qualityMode: 'standard',
          },
          mutations: [{
            kind: 'ScriptDoc', scopeKey: 'root', title: '崩溃恢复剧本',
            fields: { title: '崩溃恢复剧本', manifest: { sceneCount: 1 } },
            baseVersionId: null,
          }],
        },
      };
      assert.throws(() => {
        repository.stageAssistantResult(sessionId, response.responseId, completion);
        repository.completeAssistantResponse(sessionId, response.responseId, completion);
      }, new RegExp(`simulated-crash:${faultPoint}`));
      assert.equal(injected, true);
      const beforeRestart = repository.getConversation(sessionId);
      assert.equal(beforeRestart.messages.at(-1).status, 'streaming');
      assert.equal(beforeRestart.work.snapshot, null);
      assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM creator_response_drafts').get().count, 1);
      repository.close();
      repository = null;

      reopened = new CreatorConversationRepository({ filename });
      const recovered = reopened.getConversation(sessionId);
      assert.equal(recovered.messages.at(-1).status, 'completed', faultPoint);
      assert.equal(recovered.messages.at(-1).body, completion.body, faultPoint);
      assert.equal(recovered.conversation.phase, 'script', faultPoint);
      assert.equal(recovered.work.snapshot.revision, 1, faultPoint);
      assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM creator_response_drafts').get().count, 0);
    } finally {
      repository?.close();
      reopened?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

test('Creator long-script context loads only the selected scene source shards', () => {
  const { repository, conversation } = fixture();
  const scope = { projectId: 'project-local', canvasId: 'canvas-local' };
  try {
    const source = Array.from({ length: 120 }, (_, index) => (
      `第${index + 1}场：场景${index + 1}\n人物在第${index + 1}场完成一个独立动作。\n`
    )).join('\n');
    const prepared = prepareLongScriptImport({
      sessionId: conversation.id,
      source,
      sourceKind: 'message',
      currentVersions: [],
      existingSnapshot: null,
    });
    assert.ok(prepared);
    repository.commitWorkMutation(conversation.id, {
      expectedWorkRevision: 0,
      taskProfile: prepared.taskProfile,
      currentSceneId: prepared.previewWork.activeScenes[0].sceneId,
      mutations: prepared.mutations,
    }, scope);
    const target = prepared.previewWork.activeScenes[73];
    repository.setCurrentScene(conversation.id, target.sceneId, scope);
    const state = repository.getLongScriptContextState(conversation.id, {
      ...scope, sceneId: target.sceneId,
    });
    const loadedSourceScopes = state.currentVersions
      .filter((version) => version.kind === 'ScriptDoc' && String(version.scopeKey || '').startsWith('source-'))
      .map((version) => version.scopeKey).sort();
    assert.deepEqual(loadedSourceScopes, [...target.sourceShardKeys].sort());
    assert.ok(loadedSourceScopes.length < prepared.previewWork.manifest.sourceShardKeys.length);
    assert.equal(state.work.sourceTextBySceneId.get(target.sceneId).includes('第74场'), true);
    assert.equal(state.work.sourceTextBySceneId.size, 1);
    assert.equal(state.work.sourceDocumentIntegrity, null);
  } finally {
    repository.close();
  }
});

test('Creator assistant response has exactly three suggestions and one pending action', () => {
  const { repository, conversation } = fixture();
  try {
    const response = repository.startAssistantResponse(conversation.id, {
      responseId: 'response-001',
      modelSnapshotDigest: digest({ providerId: 'seedance-nz', modelId: 'bytedance/doubao-seed-2.1-pro' }),
    });
    const completed = repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '我会把它做成一张冷蓝雨夜、暖灯列车入站的电影海报。',
      suggestions: ['直接生成', '再暗一点', '改成清晨'],
      action: {
        id: 'action-image-001',
        type: 'image',
        prompt: '电影感雨夜车站，冷蓝环境，暖色列车灯，16:9',
        parameters: { ratio: '16:9', count: 1 },
        modelSnapshot: {
          providerId: 'seedance-nz',
          modelId: 'zhenzhen-image-gk-v2',
          catalogDigest: digest({ catalog: 'test' }),
          kind: 'image',
        },
        workBinding: {
          schema: 't8-creator-scene-action-binding-v1',
          workId: 'work-test-001',
          workRevision: 3,
          workDigest: 'a'.repeat(64),
          sceneId: 'scene-test-001',
          scenePartId: 'part-test-001',
          sceneRevision: 2,
          contextDigest: 'b'.repeat(64),
        },
      },
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.suggestions.length, 3);
    const current = repository.getConversation(conversation.id);
    assert.equal(current.pendingAction.id, 'action-image-001');
    assert.equal(current.pendingAction.status, 'pending');
    assert.equal(current.pendingAction.workBinding.sceneId, 'scene-test-001');
    assert.equal(current.pendingAction.workBinding.sceneRevision, 2);
    assert.equal(current.pendingAction.workBinding.contextDigest, 'b'.repeat(64));
    assert.throws(() => repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '重放不应改变结果',
      suggestions: ['一', '二'],
    }), (error) => error?.code === 'CREATOR_SUGGESTIONS_INVALID');
  } finally {
    repository.close();
  }
});

test('Creator pending action can be declined without blocking the next creative turn', () => {
  const { repository, conversation } = fixture();
  try {
    const first = repository.startAssistantResponse(conversation.id, { responseId: 'response-cancel-001' });
    repository.completeAssistantResponse(conversation.id, first.responseId, {
      body: '这个方案可以直接生成。',
      suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-cancel-001',
        type: 'image',
        prompt: '雨夜车站，电影感',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    const cancelled = repository.cancelPendingAction('action-cancel-001', conversation.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(repository.getConversation(conversation.id).pendingAction, null);

    const second = repository.startAssistantResponse(conversation.id, { responseId: 'response-cancel-002' });
    repository.completeAssistantResponse(conversation.id, second.responseId, {
      body: '已经按你的修改换了构图。',
      suggestions: ['直接生成', '再亮一点', '改成清晨'],
      action: {
        id: 'action-cancel-002',
        type: 'image',
        prompt: '清晨车站，电影感',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    assert.equal(repository.getConversation(conversation.id).pendingAction.id, 'action-cancel-002');
  } finally {
    repository.close();
  }
});

test('Creator completed media action is recovered only while it belongs to the latest assistant turn', () => {
  const { repository, conversation } = fixture();
  try {
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-recovery-001' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '图片已经生成好了。',
      suggestions: ['做成视频', '换个构图', '发送到画布'],
      action: {
        id: 'action-recovery-001',
        type: 'image',
        prompt: '雨夜车站，电影感',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    repository.updateAction('action-recovery-001', conversation.id, {
      status: 'running',
      runIntentId: 'intent-recovery-001',
      runId: 'run-recovery-001',
    });
    repository.updateAction('action-recovery-001', conversation.id, {
      status: 'completed',
      resultAssets: [{ assetId: 'asset-recovery-001', contentHash: 'a'.repeat(64), kind: 'image' }],
    });
    const recovered = repository.getConversation(conversation.id).pendingAction;
    assert.equal(recovered.id, 'action-recovery-001');
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.resultAssets[0].assetId, 'asset-recovery-001');
    assert.equal(repository.getConversation(conversation.id).messages.at(-1).media[0].assetId, 'asset-recovery-001');

    const textOnly = repository.startAssistantResponse(conversation.id, { responseId: 'response-recovery-002' });
    repository.completeAssistantResponse(conversation.id, textOnly.responseId, {
      body: '我会保留这张图，接下来可以继续聊。',
      suggestions: ['继续细化', '写视频方案', '换个方向'],
    });
    assert.equal(repository.getConversation(conversation.id).pendingAction, null);
  } finally {
    repository.close();
  }
});

test('Creator retries only the failed generation item and preserves completed media', () => {
  const { repository, conversation } = fixture();
  try {
    const first = repository.startAssistantResponse(conversation.id, { responseId: 'response-retry-first' });
    repository.completeAssistantResponse(conversation.id, first.responseId, {
      body: '第一张已准备。', suggestions: ['生成第一张', '换个构图', '继续'],
      action: {
        id: 'action-retry-completed', type: 'image', prompt: '第一张，雨夜车站',
        parameters: { ratio: '16:9', count: 1 },
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    repository.updateAction('action-retry-completed', conversation.id, { status: 'running' });
    repository.updateAction('action-retry-completed', conversation.id, {
      status: 'completed',
      resultAssets: [{ assetId: 'asset-retry-kept', kind: 'image', contentHash: 'c'.repeat(64) }],
    });

    const second = repository.startAssistantResponse(conversation.id, { responseId: 'response-retry-failed' });
    repository.completeAssistantResponse(conversation.id, second.responseId, {
      body: '第二张准备生成。', suggestions: ['生成第二张', '降低动作', '继续'],
      action: {
        id: 'action-retry-failed', type: 'image', prompt: '第二张，清晨站台',
        parameters: { ratio: '4:3', count: 1 },
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
      },
    });
    repository.updateAction('action-retry-failed', conversation.id, { status: 'running' });
    repository.updateAction('action-retry-failed', conversation.id, {
      status: 'failed', errorCode: 'UPSTREAM_FAILED', errorMessage: '第二张失败',
    });

    const retried = repository.retryFailedAction('action-retry-failed', conversation.id, {
      clientRequestId: 'retry-only-failed-item',
    });
    const replay = repository.retryFailedAction('action-retry-failed', conversation.id, {
      clientRequestId: 'retry-only-failed-item',
    });
    assert.equal(retried.id, replay.id);
    assert.equal(retried.status, 'pending');
    assert.equal(retried.prompt, '第二张，清晨站台');
    assert.equal(retried.parameters.ratio, '4:3');
    const preserved = repository.getAction('action-retry-completed', conversation.id);
    assert.equal(preserved.status, 'completed');
    assert.equal(preserved.resultAssets[0].assetId, 'asset-retry-kept');
    const messages = repository.getConversation(conversation.id, { limit: 20 }).messages;
    assert.equal(messages.find((message) => message.responseId === first.responseId).actionId, 'action-retry-completed');
    assert.equal(messages.find((message) => message.responseId === second.responseId).actionId, retried.id);
    assert.equal(repository.db.prepare(`SELECT COUNT(*) AS count FROM creator_actions
      WHERE session_id = ?`).get(conversation.id).count, 3);
  } finally {
    repository.close();
  }
});

test('Creator shot batch retry keeps four completed shots and resets only the failed fifth shot', () => {
  const { repository, conversation } = fixture();
  try {
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-shot-batch-retry' });
    const shots = Array.from({ length: 5 }, (_, index) => ({
      shotId: `shot_batch_${index + 1}`,
      ordinal: index + 1,
      title: `镜头 ${index + 1}`,
      prompt: `雨夜站台第 ${index + 1} 镜。`,
      parameters: { ratio: '16:9', duration: 6, resolution: '768p' },
      inputAssetIds: [],
      status: 'pending',
      resultAssets: [],
    }));
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '这场按五个镜头生成。', suggestions: ['生成五镜', '换成车内', '锁定继续'],
      action: {
        id: 'action-shot-batch-retry', type: 'video', prompt: '雨夜站台五镜段落',
        parameters: { ratio: '16:9', duration: 6, resolution: '768p' },
        modelSnapshot: {
          kind: 'video', providerId: 'seedance-nz', modelId: 'hailuo-2.3-t2v-standard',
          catalogDigest: digest({ catalog: 'shot-batch' }),
        },
        shots,
      },
    });
    const settledShots = shots.map((shot, index) => index === 2 ? {
      ...shot, status: 'failed', errorCode: 'UPSTREAM_FAILED', errorMessage: '第三镜失败',
    } : {
      ...shot,
      status: 'completed',
      resultAssets: [{
        assetId: `asset-shot-${index + 1}`, kind: 'video', contentHash: String(index + 1).repeat(64),
        shotId: shot.shotId, shotOrdinal: shot.ordinal,
      }],
    });
    repository.updateAction('action-shot-batch-retry', conversation.id, {
      status: 'failed',
      shots: settledShots,
      resultAssets: settledShots.flatMap((shot) => shot.resultAssets),
      errorCode: 'CREATOR_SHOT_BATCH_PARTIAL_FAILURE',
      errorMessage: '五镜中一镜失败',
    });

    const retried = repository.retryFailedAction('action-shot-batch-retry', conversation.id, {
      clientRequestId: 'retry-shot-three-only',
    });
    assert.equal(retried.status, 'pending');
    assert.deepEqual(retried.shots.map((shot) => shot.shotId), shots.map((shot) => shot.shotId));
    assert.deepEqual(retried.shots.map((shot) => shot.status), [
      'completed', 'completed', 'pending', 'completed', 'completed',
    ]);
    assert.equal(retried.resultAssets.length, 4);
    assert.equal(retried.shots[2].resultAssets.length, 0);
    assert.equal(repository.getConversation(conversation.id).messages.at(-1).media.length, 4);
  } finally {
    repository.close();
  }
});

test('Creator never retries a stale scene action with its obsolete prompt', () => {
  const { repository, conversation } = fixture();
  try {
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-stale-action' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '准备生成当前场。', suggestions: ['直接生成', '换个视角', '继续'],
      action: {
        id: 'action-stale-scene-retry', type: 'image', prompt: '旧版雨夜车站',
        parameters: { ratio: '16:9', count: 1 },
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: digest({ catalog: 1 }) },
        workBinding: {
          schema: 't8-creator-scene-action-binding-v1', workId: 'work-stale-scene',
          workRevision: 2, workDigest: 'a'.repeat(64), sceneId: 'scene-stale-retry',
          scenePartId: null, sceneRevision: 1, contextDigest: 'b'.repeat(64),
        },
      },
    });
    repository.updateAction('action-stale-scene-retry', conversation.id, {
      status: 'failed', errorCode: 'CREATOR_ACTION_SCENE_STALE', errorMessage: '场次已更新',
    });
    assert.throws(() => repository.retryFailedAction(
      'action-stale-scene-retry', conversation.id, { clientRequestId: 'retry-stale-scene' },
    ), (error) => error?.code === 'CREATOR_ACTION_SCENE_STALE' && error?.status === 409);
    assert.equal(repository.db.prepare('SELECT COUNT(*) AS count FROM creator_actions WHERE session_id = ?')
      .get(conversation.id).count, 1);
  } finally {
    repository.close();
  }
});

test('Creator preferences persist only the four product choices and reject secrets or cost fields', () => {
  const { repository } = fixture();
  try {
    const catalogDigest = digest({ catalog: 2 });
    const stored = repository.putPreferences({
      projectId: 'project-local',
      canvasId: 'canvas-local',
      preferences: {
        providerId: 'seedance-nz',
        llm: { providerId: 'seedance-nz', modelId: 'bytedance/doubao-seed-2.1-pro' },
        image: { providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2' },
        video: { providerId: 'seedance-nz', modelId: 'zhenzhen-video-g-omni-1.1-flash-lowprice' },
        catalogDigest,
      },
    });
    assert.equal(stored.providerId, 'seedance-nz');
    assert.equal(stored.catalogDigest, catalogDigest);
    assert.equal(JSON.stringify(stored).includes('apiKey'), false);
    assert.throws(() => repository.putPreferences({
      projectId: 'project-local',
      canvasId: 'canvas-local',
      preferences: { providerId: 'seedance-nz', apiKey: 'must-not-be-stored' },
    }), (error) => error?.code === 'CREATOR_PREFERENCES_FORBIDDEN');
    assert.throws(() => repository.putPreferences({
      projectId: 'project-local',
      canvasId: 'canvas-local',
      preferences: { providerId: 'seedance-nz', estimatedCost: 1 },
    }), (error) => error?.code === 'CREATOR_PREFERENCES_FORBIDDEN');
  } finally {
    repository.close();
  }
});

test('Creator change feed is monotonic and 500 conversations remain index-paginated', () => {
  const { repository, conversation } = fixture();
  try {
    for (let index = 0; index < 500; index += 1) {
      repository.createConversation({
        id: `creator-history-${String(index).padStart(3, '0')}`,
        projectId: 'project-local',
        canvasId: 'canvas-local',
        title: `历史创作 ${index}`,
      });
    }
    let before = null;
    const historyIds = [];
    for (let pageIndex = 0; pageIndex < 30; pageIndex += 1) {
      const page = repository.listConversations({
        projectId: 'project-local', canvasId: 'canvas-local', limit: 20,
        ...(before ? { before } : {}),
      });
      historyIds.push(...page.items.map((item) => item.id));
      before = page.nextBefore;
      if (!before) break;
    }
    assert.equal(historyIds.length, 501);
    assert.equal(new Set(historyIds).size, 501);

    repository.appendUserMessage(conversation.id, { body: '开始创作', clientRequestId: 'request-feed-001' });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-feed-001' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '我先把故事整理成一句能直接拍的创意。',
      suggestions: ['继续写剧本', '先定人物', '换一个方向'],
    });
    const changes = repository.listChanges(conversation.id, { after: 0 });
    assert.deepEqual(changes.map((item) => item.sequence), [1, 2, 3]);
    assert.equal(changes.at(-1).data.status, 'completed');
    assert.deepEqual(repository.stats(), {
      conversations: 501,
      messages: 2,
      actions: 0,
      preferences: 0,
      workSnapshots: 0,
      workArtifactVersions: 0,
    });
  } finally {
    repository.close();
  }
});

test('Creator V2 persists scoped work atomically, restores current pointers, and rejects stale retries', () => {
  const { repository, conversation } = fixture();
  const scope = { projectId: 'project-local', canvasId: 'canvas-local' };
  const taskProfile = {
    family: 'story',
    intent: '逐场制作长剧本',
    deliveryKind: 'long-form-story',
    modalities: ['text', 'image', 'video'],
    qualityMode: 'standard',
  };
  try {
    assert.equal(repository.getConversation(conversation.id, scope).work.snapshot, null);
    const first = repository.commitWorkMutation(conversation.id, {
      expectedWorkRevision: 0,
      taskProfile,
      mutations: [
        {
          kind: 'ScriptDoc', scopeKey: 'root', title: '长剧本',
          fields: { title: '长剧本', manifest: { sceneCount: 2, shardCount: 32 } },
          baseVersionId: null,
        },
        {
          kind: 'ScriptDoc', scopeKey: 'scene-0a', title: '场次分片 0a',
          fields: { scenes: [{ sceneId: 'scene-a', title: '雨夜车站' }] },
          baseVersionId: null,
        },
      ],
    }, scope);
    assert.equal(first.status, 'created');
    assert.equal(first.snapshot.revision, 1);

    const restored = repository.getWorkState(conversation.id, {
      ...scope, includeCurrentVersions: true,
    });
    assert.equal(restored.snapshot.workDigest, first.snapshot.workDigest);
    assert.equal(restored.currentVersions.length, 2);
    assert.deepEqual(restored.artifacts.map((item) => item.scopeKey).sort(), ['root', 'scene-0a']);
    const sceneShard = restored.currentVersions.find((item) => item.scopeKey === 'scene-0a');

    const stale = repository.commitWorkMutation(conversation.id, {
      expectedWorkRevision: 0,
      taskProfile,
      mutations: [{
        kind: 'ScriptDoc', scopeKey: 'scene-0a', title: '场次分片 0a',
        fields: { scenes: [{ sceneId: 'scene-a', status: 'confirmed' }] },
        baseVersionId: sceneShard.versionId,
      }],
    }, scope);
    assert.equal(stale.code, 'work-snapshot-stale');
    assert.equal(repository.getWorkState(conversation.id, scope).snapshot.revision, 1);
    assert.equal(repository.stats().workArtifactVersions, 2);

    const second = repository.commitWorkMutation(conversation.id, {
      expectedWorkRevision: 1,
      taskProfile,
      mutations: [{
        kind: 'ScriptDoc', scopeKey: 'scene-0a', title: '场次分片 0a',
        fields: { scenes: [{ sceneId: 'scene-a', status: 'confirmed' }] },
        baseVersionId: sceneShard.versionId,
      }],
    }, scope);
    assert.equal(second.snapshot.revision, 2);
    assert.equal(repository.getConversation(conversation.id, scope).work.snapshot.revision, 2);
    assert.equal(repository.stats().workArtifactVersions, 3);
    assert.equal(repository.listChanges(conversation.id, { ...scope, after: 0 })
      .filter((item) => item.kind === 'work').length, 2);
  } finally {
    repository.close();
  }
});

test('Creator restart terminalizes an interrupted reply and preserves its exact user-turn link', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-v2-restart-'));
  const filename = path.join(directory, 'creator-v2.sqlite');
  let first = null;
  let reopened = null;
  try {
    first = new CreatorConversationRepository({ filename });
    const conversation = first.createConversation({
      id: 'creator-restart-session', projectId: 'project-local', canvasId: 'canvas-local',
    });
    const user = first.appendUserMessage(conversation.id, {
      body: '继续完成这个方案', clientRequestId: 'request-restart-001',
    });
    first.startAssistantResponse(conversation.id, {
      responseId: 'response-restart-001', replyToMessageId: user.message.id,
    });
    first.close();
    first = null;

    reopened = new CreatorConversationRepository({ filename });
    const snapshot = reopened.getConversation(conversation.id);
    const assistant = snapshot.messages.find((message) => message.role === 'assistant');
    assert.equal(assistant.status, 'failed');
    assert.equal(assistant.errorCode, 'CREATOR_LLM_INTERRUPTED');
    assert.match(assistant.body, /应用关闭中断/u);
    assert.equal(reopened.findAssistantResponseForUserMessage(conversation.id, user.message.id)?.id, assistant.id);
    assert.deepEqual(reopened.listChanges(conversation.id, { after: 2 }).map((item) => ({
      kind: item.kind, status: item.data.status, errorCode: item.data.errorCode,
    })), [{ kind: 'message', status: 'failed', errorCode: 'CREATOR_LLM_INTERRUPTED' }]);
  } finally {
    try { first?.close(); } catch {}
    try { reopened?.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Creator opens a pre-link V2 database, migrates it in place, and recovers the interrupted legacy turn', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-creator-v2-legacy-'));
  const filename = path.join(directory, 'creator-v2.sqlite');
  let legacy = null;
  let repository = null;
  try {
    legacy = new Database(filename);
    legacy.exec(`
      CREATE TABLE creator_conversations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, canvas_id TEXT NOT NULL,
        title TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0, working_brief_json TEXT NOT NULL DEFAULT '{}',
        phase_evidence_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE creator_messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES creator_conversations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
        suggestions_json TEXT NOT NULL DEFAULT '[]', action_id TEXT, media_json TEXT NOT NULL DEFAULT '[]',
        client_request_id TEXT, request_digest TEXT, response_id TEXT, model_snapshot_digest TEXT,
        error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(session_id, sequence)
      );
      INSERT INTO creator_conversations VALUES (
        'creator-legacy-session', 'project-local', 'canvas-local', '旧会话', 'idea', 'active', 2, '{}', '{}', 1, 1
      );
      INSERT INTO creator_messages VALUES (
        'legacy-user', 'creator-legacy-session', 1, 'user', '继续完成', 'completed', '[]', NULL, '[]',
        'legacy-request', 'legacy-digest', NULL, NULL, NULL, 1, 1
      );
      INSERT INTO creator_messages VALUES (
        'legacy-assistant', 'creator-legacy-session', 2, 'assistant', '', 'streaming', '[]', NULL, '[]',
        NULL, NULL, 'legacy-response', NULL, NULL, 1, 1
      );
    `);
    legacy.close();
    legacy = null;

    repository = new CreatorConversationRepository({ filename });
    const columns = repository.db.prepare('PRAGMA table_info(creator_messages)').all().map((column) => column.name);
    assert.equal(columns.includes('reply_to_message_id'), true);
    assert.equal(columns.includes('selected_nodes_json'), true);
    const assistant = repository.findAssistantResponseForUserMessage(
      'creator-legacy-session', 'legacy-user', { projectId: 'project-local', canvasId: 'canvas-local' },
    );
    assert.equal(assistant.id, 'legacy-assistant');
    assert.equal(assistant.status, 'failed');
    assert.equal(assistant.errorCode, 'CREATOR_LLM_INTERRUPTED');
  } finally {
    try { legacy?.close(); } catch {}
    try { repository?.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Creator working brief persists while production phases require durable evidence', () => {
  const { repository, conversation } = fixture();
  try {
    const early = repository.updateConversationContext(conversation.id, {
      workingBrief: { goal: '做一支雨夜车站短片', style: '冷蓝电影感' },
      phaseDecision: { phase: 'script', transition: 'advance', reason: '目标已明确' },
    });
    assert.equal(early.phase, 'script');
    assert.equal(early.workingBrief.goal, '做一支雨夜车站短片');
    const stayed = repository.updateConversationContext(conversation.id, {
      phaseDecision: { phase: 'assets', transition: 'stay', reason: '还需要确认方案' },
    });
    assert.equal(stayed.phase, 'script');
    assert.equal(stayed.phaseEvidence.transition, 'stay');
    const backwardAdvance = repository.updateConversationContext(conversation.id, {
      phaseDecision: { phase: 'idea', transition: 'advance', reason: '错误的向后推进' },
    });
    assert.equal(backwardAdvance.phase, 'script');
    const untrustedJump = repository.updateConversationContext(conversation.id, {
      workingBrief: { decisions: '保留暖色列车灯' },
      phaseDecision: { phase: 'delivery', transition: 'advance', reason: '模型自行判断完成' },
    });
    assert.equal(untrustedJump.phase, 'script');
    assert.equal(untrustedJump.workingBrief.style, '冷蓝电影感');
    assert.equal(untrustedJump.workingBrief.decisions, '保留暖色列车灯');
    repository.updateConversationPhase(conversation.id, 'candidates');
    const revised = repository.updateConversationContext(conversation.id, {
      phaseDecision: { phase: 'assets', transition: 'revise', reason: '用户要求更换参考素材' },
    });
    assert.equal(revised.phase, 'assets');
    assert.equal(revised.phaseEvidence.transition, 'revise');
  } finally { repository.close(); }
});

test('Creator working brief keeps established constraints across 30 partial turns', () => {
  const { repository, conversation } = fixture();
  try {
    const established = repository.updateConversationContext(conversation.id, {
      workingBrief: {
        goal: '完成一支 30 秒品牌短片',
        format: '16:9',
        audience: '年轻通勤者',
        style: '冷蓝电影感',
        constraints: '不要字幕；人物造型一致；总长 30 秒',
        decisions: '暖色列车灯是唯一高光',
      },
    });
    assert.match(established.workingBrief.constraints, /人物造型一致/u);
    for (let turn = 1; turn <= 30; turn += 1) {
      const updated = repository.updateConversationContext(conversation.id, {
        workingBrief: {
          story: `第 ${turn} 轮只补充镜头叙事`,
          constraints: '',
          decisions: '',
        },
      });
      assert.equal(updated.workingBrief.goal, established.workingBrief.goal);
      assert.equal(updated.workingBrief.format, established.workingBrief.format);
      assert.equal(updated.workingBrief.style, established.workingBrief.style);
      assert.equal(updated.workingBrief.constraints, established.workingBrief.constraints);
      assert.equal(updated.workingBrief.decisions, established.workingBrief.decisions);
    }
    assert.equal(repository.getConversation(conversation.id).conversation.workingBrief.story, '第 30 轮只补充镜头叙事');
  } finally { repository.close(); }
});

test('Creator durable change cursor replays completion and ambiguous status updates exactly after the cursor', () => {
  const { repository, conversation } = fixture();
  try {
    repository.appendUserMessage(conversation.id, { body: '生成一张图', clientRequestId: 'request-cursor-1' });
    const response = repository.startAssistantResponse(conversation.id, { responseId: 'response-cursor-1' });
    repository.completeAssistantResponse(conversation.id, response.responseId, {
      body: '准备生成。',
      suggestions: ['直接生成', '换个构图', '先看脚本'],
      action: {
        id: 'action-cursor-1', type: 'image', prompt: '雨夜车站',
        modelSnapshot: { kind: 'image', providerId: 'seedance-nz', modelId: 'zhenzhen-image-gk-v2', catalogDigest: 'a'.repeat(64) },
      },
    });
    const pending = repository.getAction('action-cursor-1', conversation.id);
    repository.updateAction(pending.id, conversation.id, { status: 'running', runId: 'run-cursor-1' });
    const runningCursor = repository.getConversation(conversation.id).conversation.sequence;
    repository.updateAction(pending.id, conversation.id, { status: 'ambiguous', errorCode: 'CREATOR_PROVIDER_TIMEOUT' });
    const replay = repository.listChanges(conversation.id, { after: runningCursor });
    assert.equal(replay.length, 1);
    assert.equal(replay[0].sequence, runningCursor + 1);
    assert.equal(replay[0].kind, 'action');
    assert.equal(replay[0].data.status, 'ambiguous');
  } finally { repository.close(); }
});
