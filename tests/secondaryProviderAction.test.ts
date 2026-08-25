import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Node } from '@xyflow/react';
import type { ApiSettings } from '../src/types/canvas.ts';
import type { RunContext, RunNodeLifecycleReporter } from '../src/types/project.ts';
import { buildRunPreflightDiagnostics } from '../src/utils/runPreflightContext.ts';
import {
  CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT,
  SECONDARY_PROVIDER_ACTION_SCHEMA,
  clearSecondaryProviderActionExecutorsForTests,
  createSecondaryProviderActionForNode,
  executeRegisteredSecondaryProviderAction,
  registerSecondaryProviderActionExecutor,
  requestCanvasSecondaryProviderAction,
  resolveSecondaryProviderActionForRun,
  secondaryProviderActionNodePatch,
  validateSecondaryProviderAction,
  type SecondaryProviderActionDraft,
  type SecondaryProviderActionEnvelope,
} from '../src/utils/secondaryProviderAction.ts';

function generationAction() {
  return createSecondaryProviderActionForNode('target-node', 'generation-target', {
    actionId: 'generation-target.generate',
    target: 'replace',
    params: {
      prompt: 'cinematic penguin',
      model: 'gpt-image-2',
      apiModel: 'gpt-image-2',
      aspectRatio: '1:1',
      sizeLevel: '1K',
      images: ['https://example.invalid/source.png'],
      sourceNodeIds: ['source-node'],
    },
  }, { requestId: 'secondary-target-node-0001', issuedAt: 100 });
}

function runContextFor(action: SecondaryProviderActionEnvelope): RunContext {
  return {
    contextId: 'context-secondary-0001',
    runId: 'run-secondary-0001',
    projectId: 'project-secondary',
    canvasId: 'canvas-secondary',
    canvasRevision: 7,
    mode: 'single',
    plannedNodeIds: [action.nodeId],
    authorizedNodeIds: [action.nodeId],
    parentRunId: null,
    replayMode: null,
    replaySourceRunId: null,
    replaySourceAttemptId: null,
    requestId: action.requestId,
    secondaryProviderActionSchema: action.schema,
    secondaryProviderActionId: action.actionId,
    secondaryProviderActionTarget: action.target,
    secondaryProviderActionDigest: action.digest,
    createdAt: 100,
  };
}

const reporter: RunNodeLifecycleReporter = {
  runContext: null,
  executionToken: 'token-secondary-0001',
  nodeRunId: null,
  attemptId: null,
  progress: async () => {},
  polling: async () => {},
  output: async () => {},
  providerRequest: async () => {},
  providerSubmitted: async () => {},
  providerPolling: async () => {},
  providerResponse: async () => {},
  providerUsage: async () => {},
};

test('fixed whitelist accepts each supported secondary Provider action shape', () => {
  const drafts: Array<[
    string,
    'generation-target' | 'output' | 'upload' | 'video-edit' | 'drawing-board' | 'panorama-3d',
    SecondaryProviderActionDraft,
  ]> = [
    ['target-node', 'generation-target', {
      actionId: 'generation-target.generate',
      target: 'keep-version',
      params: {
        prompt: 'penguin', model: 'gpt-image-2', apiModel: 'gpt-image-2', aspectRatio: '16:9', sizeLevel: '2K',
        images: ['https://example.invalid/a.png'], sourceNodeIds: ['source-a'],
      },
    }],
    ['output-node', 'output', {
      actionId: 'image-edit.annotation',
      target: 'annotation-edit',
      params: {
        sourceImageUrl: 'https://example.invalid/clean.png',
        annotatedImageUrl: 'https://example.invalid/annotated.png',
        instruction: 'remove the marked object',
        annotationTextCount: 1,
        annotationShapeCount: 2,
        providerId: 'default-image',
        providerModel: 'gpt-image-2',
        targetNodeId: 'target-node',
      },
    }],
    ['upload-node', 'upload', {
      actionId: 'rh-image.capability',
      target: 'cutout',
      params: {
        capability: 'image.cutout', preferredToolId: 'image-cutout-v1', imageUrls: ['https://example.invalid/a.png'],
        retryCount: 1, retryDelayMs: 500, continueOnError: false,
      },
    }],
    ['drawing-board-node', 'drawing-board', {
      actionId: 'rh-image.editor-cutout',
      target: 'editor-cutout',
      params: {
        capability: 'image.cutout',
        preferredToolId: 'image-cutout-v1',
        imageUrl: 'https://example.invalid/board-source.png',
        surface: 'drawing-board',
        editorSessionId: 'drawing-board-session',
        targetId: 'board-image-element',
        retryCount: 2,
        retryDelayMs: 1200,
      },
    }],
    ['video-edit-node', 'video-edit', {
      actionId: 'rh-image.editor-cutout',
      target: 'editor-cutout',
      params: {
        capability: 'image.cutout',
        preferredToolId: 'image-cutout-v1',
        imageUrl: 'https://example.invalid/snapshot.png',
        surface: 'image-edit-modal',
        editorSessionId: 'image-edit-session',
        targetId: 'working-image',
        retryCount: 2,
        retryDelayMs: 1200,
      },
    }],
    ['output-node', 'output', {
      actionId: 'rh-video.frames',
      target: 'frames',
      params: { sourceItems: [{ url: 'https://example.invalid/a.mp4', name: 'a.mp4', mime: 'video/mp4' }] },
    }],
    ['output-node', 'output', {
      actionId: 'rh-video.capability',
      target: 'fastUpscale',
      params: {
        capability: 'video.upscale', preferredToolId: 'video-nividia-upscale', videoUrls: ['https://example.invalid/a.mp4'],
        retryCount: 1, retryDelayMs: 500, continueOnError: false,
      },
    }],
    ['video-edit-node', 'video-edit', {
      actionId: 'video-edit.compose',
      target: 'compose',
      params: { inputDigest: `sha256:${'a'.repeat(64)}`, packageIds: [], operationCount: 1 },
    }],
    ['video-edit-node', 'video-edit', {
      actionId: 'video-edit.platform-export',
      target: 'platform-export',
      params: {
        inputDigest: `sha256:${'b'.repeat(64)}`,
        packageIds: ['douyin-kuaishou', 'bilibili-youtube'],
        operationCount: 2,
      },
    }],
    ['panorama-node', 'panorama-3d', {
      actionId: 'panorama-3d.ai-action-plan',
      target: 'action-plan',
      params: {
        prompt: 'character A turns around',
        plannerSystemPrompt: 'Return JSON only.',
        plannerUserPrompt: 'Plan this action.',
        view: { yaw: 0, pitch: 0, fov: 75 },
        avatars: [{ id: 'avatar-a', name: 'A', yaw: 0 }],
        activeAvatarId: 'avatar-a',
      },
    }],
  ];

  for (const [nodeId, nodeType, draft] of drafts) {
    const action = createSecondaryProviderActionForNode(nodeId, nodeType, draft, {
      requestId: `secondary-${nodeId}-0001`,
      issuedAt: 100,
    });
    assert.equal(action.schema, SECONDARY_PROVIDER_ACTION_SCHEMA);
    assert.equal(action.nodeId, nodeId);
    assert.equal(validateSecondaryProviderAction(action)?.digest, action.digest);
  }
});

test('tampering, secret-like params, embedded data, and wrong preset bindings are rejected', () => {
  const action = generationAction();
  const tampered = structuredClone(action) as any;
  tampered.params.prompt = 'changed after confirmation';
  assert.equal(validateSecondaryProviderAction(tampered), null);

  const videoAction = createSecondaryProviderActionForNode('video-edit-node', 'video-edit', {
    actionId: 'video-edit.compose',
    target: 'compose',
    params: { inputDigest: `sha256:${'c'.repeat(64)}`, packageIds: [], operationCount: 1 },
  });
  const tamperedVideoAction = structuredClone(videoAction) as any;
  tamperedVideoAction.params.inputDigest = `sha256:${'d'.repeat(64)}`;
  assert.equal(validateSecondaryProviderAction(tamperedVideoAction), null);

  assert.throws(() => createSecondaryProviderActionForNode('upload-node', 'upload', {
    actionId: 'rh-image.capability',
    target: 'cutout',
    params: {
      capability: 'image.cutout',
      preferredToolId: 'image-cutout-v1',
      userParams: { apiKey: 'must-not-be-bound' },
      imageUrls: ['https://example.invalid/a.png'],
      retryCount: 0,
      retryDelayMs: 0,
      continueOnError: false,
    },
  }));
  assert.throws(() => createSecondaryProviderActionForNode('upload-node', 'upload', {
    actionId: 'rh-video.frames',
    target: 'frames',
    params: { sourceItems: [{ url: 'data:video/mp4;base64,AAAA' }] },
  }));
  assert.throws(() => createSecondaryProviderActionForNode('upload-node', 'upload', {
    actionId: 'rh-image.capability',
    target: 'cutout',
    params: {
      capability: 'image.upscale',
      preferredToolId: 'image-upscale-4k',
      imageUrls: ['https://example.invalid/a.png'],
      retryCount: 0,
      retryDelayMs: 0,
      continueOnError: false,
    },
  }));
  assert.throws(() => createSecondaryProviderActionForNode('drawing-board-node', 'drawing-board', {
    actionId: 'rh-image.editor-cutout',
    target: 'editor-cutout',
    params: {
      capability: 'image.cutout',
      preferredToolId: 'image-cutout-v1',
      imageUrl: 'https://example.invalid/a.png',
      surface: 'image-edit-modal',
      editorSessionId: 'drawing-board-session',
      targetId: 'image-a',
      retryCount: 0,
      retryDelayMs: 0,
    },
  }));
  assert.throws(() => createSecondaryProviderActionForNode('video-edit-node', 'video-edit', {
    actionId: 'rh-image.editor-cutout',
    target: 'editor-cutout',
    params: {
      capability: 'image.cutout',
      preferredToolId: 'image-upscale-4k' as any,
      imageUrl: 'https://example.invalid/a.png',
      surface: 'image-edit-modal',
      editorSessionId: 'image-edit-session',
      targetId: 'working-image',
      retryCount: 0,
      retryDelayMs: 0,
    },
  }));
  assert.throws(() => createSecondaryProviderActionForNode('output-node', 'output', {
    actionId: 'rh-image.editor-cutout',
    target: 'editor-cutout',
    params: {
      capability: 'image.cutout',
      preferredToolId: 'image-cutout-v1',
      imageUrl: 'data:image/png;base64,AAAA',
      surface: 'image-edit-modal',
      editorSessionId: 'image-edit-session',
      targetId: 'working-image',
      retryCount: 0,
      retryDelayMs: 0,
    },
  }));
});

test('node execution resolves only the exact single-node RunContext nonce and digest', () => {
  const action = generationAction();
  const base = runContextFor(action);
  const nodeData = secondaryProviderActionNodePatch(action);
  assert.equal(resolveSecondaryProviderActionForRun({
    nodeId: action.nodeId,
    nodeType: 'generation-target',
    nodeData,
    runContext: base,
  })?.requestId, action.requestId);

  const rejected: RunContext[] = [
    { ...base, requestId: 'secondary-target-node-stale' },
    { ...base, secondaryProviderActionDigest: 'fnv1a32:00000000' },
    { ...base, secondaryProviderActionTarget: 'keep-version' },
    { ...base, secondaryProviderActionId: null },
    { ...base, plannedNodeIds: [action.nodeId, 'another-node'] },
    { ...base, plannedNodeIds: ['another-node'] },
    { ...base, authorizedNodeIds: undefined },
    { ...base, authorizedNodeIds: [action.nodeId, 'another-node'] },
    { ...base, authorizedNodeIds: ['another-node'] },
  ];
  for (const runContext of rejected) {
    assert.equal(resolveSecondaryProviderActionForRun({
      nodeId: action.nodeId,
      nodeType: 'generation-target',
      nodeData,
      runContext,
    }), null);
  }
  assert.equal(resolveSecondaryProviderActionForRun({
    nodeId: action.nodeId,
    nodeType: 'output',
    nodeData,
    runContext: base,
  }), null);
});

test('executor registry is exact by node, action id, and target and survives concurrent React mounts', async () => {
  clearSecondaryProviderActionExecutorsForTests();
  const action = generationAction();
  const calls: string[] = [];
  const unregisterPrevious = registerSecondaryProviderActionExecutor(
    action.nodeId,
    action.actionId,
    action.target,
    async ({ action: executed }) => {
      calls.push('previous');
      assert.equal(executed.digest, action.digest);
    },
  );
  await executeRegisteredSecondaryProviderAction(action, reporter);
  assert.deepEqual(calls, ['previous']);
  const unregisterLatest = registerSecondaryProviderActionExecutor(
    action.nodeId,
    action.actionId,
    action.target,
    async () => { calls.push('latest'); },
  );
  await executeRegisteredSecondaryProviderAction(action, reporter);
  assert.deepEqual(calls, ['previous', 'latest']);
  unregisterLatest();
  await executeRegisteredSecondaryProviderAction(action, reporter);
  assert.deepEqual(calls, ['previous', 'latest', 'previous']);
  unregisterPrevious();
  await assert.rejects(() => executeRegisteredSecondaryProviderAction(action, reporter), /executor 不可用/);
  clearSecondaryProviderActionExecutorsForTests();
});

test('Canvas request event carries only the validated immutable action envelope', () => {
  const originalWindow = (globalThis as any).window;
  const originalCustomEvent = (globalThis as any).CustomEvent;
  class TestCustomEvent<T> extends Event {
    detail: T;
    constructor(type: string, init: { detail: T }) {
      super(type);
      this.detail = init.detail;
    }
  }
  const target = new EventTarget();
  let received: SecondaryProviderActionEnvelope | null = null;
  target.addEventListener(CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT, (event: Event) => {
    received = (event as TestCustomEvent<{ action: SecondaryProviderActionEnvelope }>).detail.action;
  });
  (globalThis as any).window = target;
  (globalThis as any).CustomEvent = TestCustomEvent;
  try {
    const action = generationAction();
    assert.equal(requestCanvasSecondaryProviderAction(action), true);
    assert.equal(received?.digest, action.digest);
    const broken = { ...action, digest: 'fnv1a32:00000000' } as SecondaryProviderActionEnvelope;
    assert.equal(requestCanvasSecondaryProviderAction(broken), false);
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
  }
});

const emptySettings: ApiSettings = {
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: 'https://ai.t8star.org',
  zhenzhenSd2ApiKey: '',
  zhenzhenSd2BaseUrl: 'https://api.seedance.nz',
  rhApiKey: '',
  rhBaseUrl: 'https://www.runninghub.cn',
  rhIntlApiKey: '',
  rhIntlBaseUrl: 'https://www.runninghub.ai',
  llmApiKey: '',
  llmBaseUrl: 'https://ai.t8star.org',
  advancedProviders: [],
};

function diagnosticsFor(node: Node, settings: ApiSettings) {
  return buildRunPreflightDiagnostics({
    nodes: [node],
    edges: [],
    executionNodeIds: [node.id],
    scopeMode: 'selection-input-context',
    projectId: 'project-secondary',
    settings,
    providersComplete: true,
    assets: [],
    policy: null,
  });
}

test('preflight classifies secondary image, LLM, and RunningHub credentials before execution', () => {
  const imageAction = generationAction();
  const imageNode: Node = {
    id: imageAction.nodeId,
    type: 'generation-target',
    position: { x: 0, y: 0 },
    data: secondaryProviderActionNodePatch(imageAction),
  };
  assert.ok(diagnosticsFor(imageNode, emptySettings).capability.some((item) => item.ruleId === 'provider.secondary-gpt-image-credential-missing'));
  assert.equal(diagnosticsFor(imageNode, { ...emptySettings, zhenzhenApiKey: 'configured' }).capability
    .some((item) => item.ruleId === 'provider.secondary-gpt-image-credential-missing'), false);

  const panoramaAction = createSecondaryProviderActionForNode('panorama-node', 'panorama-3d', {
    actionId: 'panorama-3d.ai-action-plan',
    target: 'action-plan',
    params: {
      prompt: 'turn', plannerSystemPrompt: 'json', plannerUserPrompt: 'turn',
      view: { yaw: 0, pitch: 0, fov: 75 }, avatars: [{ id: 'a' }],
    },
  });
  const panoramaNode: Node = {
    id: panoramaAction.nodeId,
    type: 'panorama-3d',
    position: { x: 0, y: 0 },
    data: secondaryProviderActionNodePatch(panoramaAction),
  };
  assert.ok(diagnosticsFor(panoramaNode, emptySettings).capability.some((item) => item.ruleId === 'provider.secondary-llm-credential-missing'));

  const rhAction = createSecondaryProviderActionForNode('output-node', 'output', {
    actionId: 'rh-video.capability',
    target: 'qualityUpscale',
    params: {
      capability: 'video.upscale', preferredToolId: 'video-flashvsr', videoUrls: ['https://example.invalid/a.mp4'],
      retryCount: 0, retryDelayMs: 0, continueOnError: false,
    },
  });
  const outputNode: Node = {
    id: rhAction.nodeId,
    type: 'output',
    position: { x: 0, y: 0 },
    data: secondaryProviderActionNodePatch(rhAction),
  };
  assert.ok(diagnosticsFor(outputNode, emptySettings).capability.some((item) => item.ruleId === 'provider.secondary-runninghub-credential-missing'));
});

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('secondary Provider surfaces expose one run listener and queue before Provider execution', () => {
  const generationTarget = read('src/components/nodes/GenerationTargetNode.tsx');
  const output = read('src/components/nodes/OutputNode.tsx');
  const upload = read('src/components/nodes/UploadNode.tsx');
  const panorama = read('src/components/nodes/Panorama3DNode.tsx');
  const drawingBoard = read('src/components/nodes/DrawingBoardNode.tsx');
  const imageEditModal = read('src/components/nodes/ImageEditModal.tsx');
  const videoEdit = read('src/components/nodes/VideoEditNode.tsx');
  const editorCutout = read('src/utils/rhImageEditorCutout.ts');
  const rhImage = read('src/components/RhImageCapabilityButton.tsx');
  const rhVideo = read('src/components/RhVideoCapabilityRail.tsx');

  for (const source of [generationTarget, output, upload, panorama, drawingBoard, videoEdit]) {
    assert.equal(source.match(/useRunTrigger\(/g)?.length, 1);
    assert.match(source, /resolveSecondaryProviderActionForRun/);
    assert.match(source, /lifecycleAware:\s*true/);
  }
  assert.match(generationTarget, /requestCanvasSecondaryProviderAction/);
  assert.match(generationTarget, /requestGenerateAction/);
  assert.doesNotMatch(generationTarget, /onClick=\{\(\) => void executeGenerateAction/);

  assert.match(output, /queueAnnotationEditProduce/);
  assert.match(upload, /queueAnnotationEditProduce/);
  assert.match(output, /return queueAnnotationEditProduce\(cleanUrls, _meta\)/);
  assert.match(upload, /return queueAnnotationEditProduce\(cleanUrls, _meta\)/);
  assert.ok(output.indexOf('已绑定的生成目标框已删除或变化') < output.indexOf('await reporter.providerRequest'));
  assert.ok(upload.indexOf('已绑定的生成目标框已删除或变化') < upload.indexOf('await reporter.providerRequest'));
  assert.match(upload, /if \(reporter\.runContext\?\.secondaryProviderActionId\)/);
  assert.match(output, /display: showRhCapabilityRail \? 'flex' : 'none'/);
  assert.match(upload, /display: showRhCapabilityRail \? 'flex' : 'none'/);

  assert.match(panorama, /queueAiActionPlan/);
  assert.match(panorama, /onClick=\{requestAiActionPlan\}/);
  assert.doesNotMatch(panorama, /createAiActionPlan/);

  assert.match(rhImage, /registerSecondaryProviderActionExecutor/);
  assert.match(rhImage, /queueSecondaryAction\(\{/);
  assert.match(rhVideo, /registerSecondaryProviderActionExecutor/);
  assert.match(rhVideo, /queueSecondaryAction\(\{/);

  assert.doesNotMatch(drawingBoard, /runRhImageCutout/);
  assert.doesNotMatch(imageEditModal, /runRhImageCutout/);
  assert.match(drawingBoard, /actionId:\s*'rh-image\.editor-cutout'/);
  assert.match(drawingBoard, /executeRegisteredSecondaryProviderAction/);
  assert.match(drawingBoard, /requestCanvasSecondaryProviderAction/);
  assert.match(drawingBoard, /普通导出和次级 Provider action 共用唯一运行监听器/);

  assert.match(imageEditModal, /secondaryActionNodeId\?: string/);
  assert.match(imageEditModal, /secondaryActionNodeType\?: ImageEditSecondaryActionNodeType/);
  assert.match(imageEditModal, /registerSecondaryProviderActionExecutor/);
  assert.match(imageEditModal, /等待运行体检确认/);
  assert.match(imageEditModal, /RH抠图需要所属持久画布节点，已停止调用 Provider/);
  assert.match(imageEditModal, /assertTargetCurrent:\s*resolveBoundTarget/);

  assert.match(output, /secondaryActionNodeType="output"/);
  assert.match(upload, /secondaryActionNodeType="upload"/);
  assert.match(videoEdit, /secondaryActionNodeType="video-edit"/);
  assert.match(videoEdit, /缺少已确认的次级 Provider action，已停止调用 Provider/);
  assert.match(videoEdit, /executeRegisteredSecondaryProviderAction/);

  assert.match(editorCutout, /runRhImageCapabilityBatch/);
  assert.doesNotMatch(editorCutout, /runRhImageCutout/);
  assert.ok(
    editorCutout.indexOf('await options.assertTargetCurrent();')
      < editorCutout.indexOf('await reporter.providerRequest'),
  );
});
