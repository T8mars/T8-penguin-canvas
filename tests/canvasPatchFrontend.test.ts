import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  ApiRequestError,
  applyCanvasPatch,
  listCanvasPatches,
  previewCanvasPatch,
  revertCanvasPatch,
} from '../src/services/api.ts';
import type { CanvasPatch } from '../src/types/project.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

const patch: CanvasPatch = {
  schema: 't8-canvas-patch-v1',
  id: 'doctor-patch-r7',
  baseRevision: 7,
  summary: '移除悬空连线',
  diagnosticsResolved: ['edge.dangling'],
  requiresConfirmation: true,
  operations: [{
    opId: 'doctor-patch-r7-op-0',
    projectId: 'project-local',
    canvasId: 'canvas/one',
    actorId: 'client-placeholder',
    sessionId: 'client-placeholder',
    baseRevision: 7,
    clientSeq: 0,
    timestamp: 1,
    type: 'edge.delete',
    payload: { edgeId: 'edge-1' },
  }],
};

function response(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function canvasDocument(canvasId: string, revision: number) {
  return {
    schema: 't8-canvas-document' as const,
    schemaVersion: 2 as const,
    projectId: 'project-local',
    canvasId,
    entityUid: `entity-${canvasId}`,
    revision,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    subflowInstances: [],
    tombstones: { nodes: {}, edges: {} },
    updatedAt: 1000 + revision,
  };
}

function previewData(overrides: Record<string, unknown> = {}) {
  return {
    patchId: patch.id,
    baseRevision: patch.baseRevision,
    currentRevision: patch.baseRevision,
    previewDigest: 'a'.repeat(64),
    summary: patch.summary,
    diagnosticsResolved: patch.diagnosticsResolved,
    affectedNodeIds: ['node-1'],
    affectedEdgeIds: ['edge-1'],
    changes: [],
    warnings: [],
    ...overrides,
  };
}

function patchRecord(overrides: Record<string, unknown> = {}) {
  return {
    patchId: patch.id,
    summary: patch.summary,
    diagnosticsResolved: patch.diagnosticsResolved,
    baseRevision: patch.baseRevision,
    appliedRevision: patch.baseRevision + 1,
    revertedRevision: null,
    actorId: 'local-owner',
    status: 'applied',
    operationCount: 1,
    createdAt: 1000,
    revertedAt: null,
    canRevert: true,
    ...overrides,
  };
}

async function withResponse<T>(data: unknown, work: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response(data)) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function expectInvalidResponse(work: () => Promise<unknown>) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 502);
    assert.equal(error.data, null);
    assert.match(error.message, /CanvasPatch .*响应无效/);
    assert.doesNotMatch(error.message, /secret-marker|rawOperations|inverseOperations|sessionId/i);
    return true;
  });
}

test('CanvasPatch API uses the dedicated preview/apply/list/revert contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: any }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: String(init?.method || 'GET'), body });
    if (url.endsWith('/preview')) return response(previewData());
    if (url.includes('/revert')) return response({
      patchId: patch.id,
      status: 'reverted',
      document: canvasDocument('canvas/one', 9),
      revision: 9,
    });
    if (url.endsWith('/patches') && String(init?.method || 'GET') === 'POST') return response({
      patchId: patch.id,
      duplicate: false,
      status: 'applied',
      baseRevision: patch.baseRevision,
      document: canvasDocument('canvas/one', 8),
      revision: 8,
    });
    return response([patchRecord()]);
  }) as typeof fetch;

  try {
    const preview = await previewCanvasPatch('canvas/one', patch);
    await applyCanvasPatch('canvas/one', patch, preview.previewDigest);
    await listCanvasPatches('canvas/one', 25);
    await revertCanvasPatch('canvas/one', patch.id, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: '/api/canvas/canvas%2Fone/patches/preview',
      method: 'POST',
      body: { patch },
    },
    {
      url: '/api/canvas/canvas%2Fone/patches',
      method: 'POST',
      body: { patch, previewDigest: 'a'.repeat(64), confirmed: true },
    },
    {
      url: '/api/canvas/canvas%2Fone/patches?limit=25',
      method: 'GET',
      body: undefined,
    },
    {
      url: '/api/canvas/canvas%2Fone/patches/doctor-patch-r7/revert',
      method: 'POST',
      body: { baseRevision: 8 },
    },
  ]);
});

test('CanvasPatch preview accepts every authoritative operation change and binds it to the requested operation', async () => {
  const cases: Array<{ type: CanvasPatch['operations'][number]['type']; targetType: 'node' | 'edge' | 'canvas' }> = [
    { type: 'node.add', targetType: 'node' },
    { type: 'node.patch', targetType: 'node' },
    { type: 'node.move', targetType: 'node' },
    { type: 'node.delete', targetType: 'node' },
    { type: 'node.restore', targetType: 'node' },
    { type: 'edge.add', targetType: 'edge' },
    { type: 'edge.delete', targetType: 'edge' },
    { type: 'edge.restore', targetType: 'edge' },
    { type: 'viewport.set', targetType: 'canvas' },
  ];
  for (const item of cases) {
    const expectedPatch: CanvasPatch = {
      ...patch,
      operations: [{ ...patch.operations[0], type: item.type }],
    };
    const change = {
      operationIndex: 0,
      type: item.type,
      targetType: item.targetType,
      targetId: item.targetType === 'canvas' ? 'canvas-one' : `${item.targetType}-1`,
      fields: ['exists'],
      before: { exists: false },
      after: { exists: true },
    };
    const preview = await withResponse(
      previewData({ changes: [change] }),
      () => previewCanvasPatch('canvas/one', expectedPatch),
    );
    assert.equal(preview.changes[0].type, item.type);
    assert.equal(preview.changes[0].targetType, item.targetType);
  }

  const nodeAddPatch: CanvasPatch = {
    ...patch,
    operations: [{ ...patch.operations[0], type: 'node.add' }],
  };
  await expectInvalidResponse(() => withResponse(previewData({
    changes: [{
      operationIndex: 0,
      type: 'edge.add',
      targetType: 'edge',
      targetId: 'edge-1',
      fields: ['exists'],
      before: { exists: false },
      after: { exists: true },
    }],
  }), () => previewCanvasPatch('canvas/one', nodeAddPatch)));
});

test('CanvasPatch preview rejects identity, digest, revision, and bounded-structure violations', async () => {
  const invalidResponses = [
    previewData({ patchId: 'another-patch' }),
    previewData({ baseRevision: patch.baseRevision + 1 }),
    previewData({ currentRevision: 0 }),
    previewData({ currentRevision: patch.baseRevision + 1 }),
    previewData({ previewDigest: 'g'.repeat(64) }),
    previewData({ affectedNodeIds: Array.from({ length: 1001 }, (_, index) => `node-${index}`) }),
    previewData({ affectedEdgeIds: 'edge-1' }),
    previewData({ warnings: Array.from({ length: 101 }, () => 'warning') }),
    previewData({
      changes: Array.from({ length: 101 }, (_, operationIndex) => ({
        operationIndex,
        type: 'edge.delete',
        targetType: 'edge',
        targetId: `edge-${operationIndex}`,
        fields: ['exists'],
        before: { exists: true },
        after: { exists: false },
      })),
    }),
    previewData({
      changes: [{
        operationIndex: 0,
        type: 'edge.delete',
        targetType: 'edge',
        targetId: 'edge-1',
        fields: 'exists',
        before: { token: 'secret-marker' },
        after: null,
      }],
    }),
  ];

  for (const data of invalidResponses) {
    await expectInvalidResponse(() => withResponse(data, () => previewCanvasPatch('canvas/one', patch)));
  }
});

test('CanvasPatch apply and revert reject response identity and revision mismatches', async () => {
  const validApply = {
    patchId: patch.id,
    status: 'applied',
    duplicate: false,
    baseRevision: patch.baseRevision,
    revision: patch.baseRevision + 1,
    document: canvasDocument('canvas/one', patch.baseRevision + 1),
  };
  const invalidApplyResponses = [
    { ...validApply, patchId: 'another-patch' },
    { ...validApply, baseRevision: patch.baseRevision + 1 },
    { ...validApply, revision: patch.baseRevision - 1, document: canvasDocument('canvas/one', patch.baseRevision - 1) },
    { ...validApply, revision: patch.baseRevision + 2 },
    { ...validApply, document: canvasDocument('canvas/two', patch.baseRevision + 1) },
  ];
  for (const data of invalidApplyResponses) {
    await expectInvalidResponse(() => withResponse(data, () => applyCanvasPatch('canvas/one', patch, 'a'.repeat(64))));
  }

  const validRevert = {
    patchId: patch.id,
    status: 'reverted',
    duplicate: false,
    revision: patch.baseRevision + 2,
    document: canvasDocument('canvas/one', patch.baseRevision + 2),
  };
  const invalidRevertResponses = [
    { ...validRevert, patchId: 'another-patch' },
    { ...validRevert, revision: 0, document: canvasDocument('canvas/one', 0) },
    { ...validRevert, revision: patch.baseRevision + 3 },
    { ...validRevert, document: canvasDocument('canvas/two', patch.baseRevision + 2) },
  ];
  for (const data of invalidRevertResponses) {
    await expectInvalidResponse(() => withResponse(data, () => revertCanvasPatch('canvas/one', patch.id, patch.baseRevision + 1)));
  }
});

test('CanvasPatch list rejects unbounded records and raw, inverse, or session fields', async () => {
  const invalidLists = [
    Array.from({ length: 26 }, () => patchRecord()),
    [patchRecord({ summary: 'x'.repeat(501) })],
    [patchRecord({ diagnosticsResolved: Array.from({ length: 101 }, (_, index) => `rule.${index}`) })],
    [patchRecord({ baseRevision: 0 })],
    [patchRecord({ operationCount: 101 })],
    [patchRecord({ rawOperations: [{ secret: 'secret-marker' }] })],
    [patchRecord({ inverseOperations: [{ secret: 'secret-marker' }] })],
    [patchRecord({ sessionId: 'secret-marker' })],
  ];
  for (const data of invalidLists) {
    await expectInvalidResponse(() => withResponse(data, () => listCanvasPatches('canvas/one', 25)));
  }
});

test('Workbench requires authoritative structured preview and keeps a failed confirmation recoverable', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/components/ProjectWorkbench.tsx'), 'utf8');
  assert.match(source, /onPreviewPatch:\s*\([^)]*CanvasPatchDraft[^)]*\)\s*=>\s*Promise/);
  assert.match(source, /CanvasPatchPreview/);
  assert.match(source, /affectedNodeIds/);
  assert.match(source, /affectedEdgeIds/);
  assert.match(source, /change\.before/);
  assert.match(source, /change\.after/);
  assert.match(source, /baseRevision/);
  assert.match(source, /previewDigest/);
  assert.match(source, /requiresConfirmation/);
  assert.match(source, /patchApplyBusy/);
  assert.match(source, /disabled=\{patchApplyBusy/);
  assert.match(source, /catch[\s\S]{0,500}setPatchApplyError/);
  assert.doesNotMatch(source, /onApplyPatch\(patchPreview\);\s*setPatchPreview\(null\)/);
});

test('Canvas serializes writes, invalidates stale previews, and uses an audited Patch history barrier', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/components/Canvas.tsx'), 'utf8');
  assert.match(source, /canvasMutationQueuesRef/);
  assert.match(source, /enqueueCanvasMutation/);
  assert.match(source, /ensureCanvasPatchBaseline/);
  assert.match(source, /materializeCanvasPatchDraft/);
  assert.match(source, /api\.previewCanvasPatch/);
  assert.match(source, /api\.applyCanvasPatch/);
  assert.match(source, /api\.revertCanvasPatch/);
  assert.match(source, /patchPreviewBaselinesRef/);
  assert.match(source, /PATCH_PREVIEW_STALE/);
  assert.match(source, /canvasPatchHistoryBarrier\(next, options\.patchId\)/);
  assert.match(source, /recoveryCommit\(canvasId, authoritativeDocument, baseline\.snapshot, undefined, patch\.id\)/);
  assert.match(source, /commitAuthoritativeCanvasPatchDocument\(canvasId, document, \{ expectedLocalSnapshot: baseline, historyMode, patchId \}\)/);
  assert.match(source, /onResolvePatchConflict=\{handleResolveCanvasPatchConflict\}/);
  assert.match(source, /pendingSaveByCanvasRef\.current\.get\(canvasId\).*conflicted/s);
  assert.match(source, /const reconciliation = reconcileCanvasPatchAutosavePending\(/);
  assert.match(source, /const response = reconcileCanvasPatchAutosaveResponse\(/);
  assert.match(source, /autosaveGenerationByCanvasRef\.current\.get\(canvasIdForSave\) !== token\.generation/);
  assert.match(source, /pendingSaveByCanvasRef\.current\.get\(canvasIdForSave\) !== token\.pendingIdentity/);
  assert.doesNotMatch(source, /if \(snapshot === previousSnapshot\) return/);
  const workbench = fs.readFileSync(path.join(ROOT, 'src/components/ProjectWorkbench.tsx'), 'utf8');
  assert.match(workbench, /保留本地并合并保存/);
  assert.match(workbench, /采用服务端版本/);
  assert.match(workbench, /不使用本地 Ctrl\+Z 撤销/);
  assert.match(source, /setActiveCanvasRevision/);
  assert.doesNotMatch(source, /const handleApplyCanvasPatch[\s\S]{0,500}applyCanvasPatch\(current\.nodes/);
});
