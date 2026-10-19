import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge, Node } from '@xyflow/react';
import type {
  CanvasPatch,
  CanvasPatchApplyResult,
  CanvasPatchChange,
  CanvasPatchPreview,
  CanvasPatchRecord,
  CanvasPatchRevertResult,
} from '../src/types/project.ts';
import {
  CANVAS_PATCH_DRAFT_MAX_OPERATIONS,
  applyCanvasPatch,
  applyCanvasPatchDraft,
  materializeCanvasPatchDraft,
  type CanvasPatchDraft,
} from '../src/utils/workflowDoctor.ts';

const draft: CanvasPatchDraft = {
  id: 'doctor-draft-sensitive',
  title: 'repair sk-SecretValueABC123456789',
  description: 'do not copy C:\\private\\api-key.txt',
  operations: [
    { type: 'node.patch', nodeId: 'node-a', patch: { position: { x: 12, y: 34 } } },
    { type: 'edge.delete', edgeId: 'edge-b' },
    { type: 'node.delete', nodeId: 'node-c' },
  ],
  diagnosticsResolved: ['layout.invalid-position', 'topology.dangling-edge'],
};

test('doctor drafts materialize into the complete authoritative CanvasPatch protocol', () => {
  const options = {
    projectId: 'project-safe',
    canvasId: 'canvas-safe',
    baseRevision: 7,
    diagnosticsResolved: ['topology.dangling-edge', 'layout.invalid-position', 'layout.invalid-position'],
  };
  const first = materializeCanvasPatchDraft(draft, options);
  const second = materializeCanvasPatchDraft(structuredClone(draft), {
    ...options,
    diagnosticsResolved: [...options.diagnosticsResolved].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, 't8-canvas-patch-v1');
  assert.match(first.id, /^doctor-patch-[0-9a-f]{16}$/);
  assert.equal(first.id.length, 29);
  assert.equal(first.baseRevision, 7);
  assert.equal(first.summary, '工作流医生确定性修复：3 个操作，2 项诊断');
  assert.deepEqual(first.diagnosticsResolved, ['layout.invalid-position', 'topology.dangling-edge']);
  assert.equal(first.requiresConfirmation, true);
  assert.deepEqual(first.operations.map((operation) => ({
    opId: operation.opId,
    projectId: operation.projectId,
    canvasId: operation.canvasId,
    actorId: operation.actorId,
    sessionId: operation.sessionId,
    baseRevision: operation.baseRevision,
    clientSeq: operation.clientSeq,
    timestamp: operation.timestamp,
    type: operation.type,
    payload: operation.payload,
  })), [
    {
      opId: `${first.id}-op-001`, projectId: 'project-safe', canvasId: 'canvas-safe',
      actorId: '', sessionId: '', baseRevision: 7, clientSeq: 0, timestamp: 1,
      type: 'node.move', payload: { nodeId: 'node-a', position: { x: 12, y: 34 } },
    },
    {
      opId: `${first.id}-op-002`, projectId: 'project-safe', canvasId: 'canvas-safe',
      actorId: '', sessionId: '', baseRevision: 7, clientSeq: 1, timestamp: 2,
      type: 'edge.delete', payload: { edgeId: 'edge-b' },
    },
    {
      opId: `${first.id}-op-003`, projectId: 'project-safe', canvasId: 'canvas-safe',
      actorId: '', sessionId: '', baseRevision: 7, clientSeq: 2, timestamp: 3,
      type: 'node.delete', payload: { nodeId: 'node-c' },
    },
  ]);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /SecretValueABC123456789/);
  assert.doesNotMatch(serialized, /private|api-key\.txt/i);
  assert.doesNotMatch(serialized, /doctor-draft-sensitive/);
});

test('materialization bounds metadata and rejects unsafe or non-deterministic doctor operations', () => {
  const common = {
    projectId: 'project-safe',
    canvasId: 'canvas-safe',
    baseRevision: 1,
    diagnosticsResolved: ['sk-SecretDiagnosticABC123456789'],
  };
  const safe = materializeCanvasPatchDraft({
    id: 'safe', title: 'safe', description: '', operations: [{ type: 'edge.delete', edgeId: 'edge-safe' }],
    diagnosticsResolved: ['topology.dangling-edge'],
  }, {
    projectId: common.projectId,
    canvasId: common.canvasId,
    baseRevision: common.baseRevision,
  });
  assert.equal(safe.diagnosticsResolved.length, 1);
  assert.deepEqual(safe.diagnosticsResolved, ['topology.dangling-edge']);

  const redactedDiagnostic = materializeCanvasPatchDraft({
    id: 'safe', title: 'safe', description: '', operations: [{ type: 'edge.delete', edgeId: 'edge-safe' }],
  }, common);
  assert.doesNotMatch(JSON.stringify(redactedDiagnostic), /SecretDiagnosticABC123456789/);

  assert.throws(() => materializeCanvasPatchDraft({
    id: 'bad-id', title: 'bad', description: '',
    operations: [{ type: 'edge.delete', edgeId: 'sk-SecretTargetABC123456789' }],
  }, common), /不安全的连线 ID/);
  assert.throws(() => materializeCanvasPatchDraft({
    id: 'bad-patch', title: 'bad', description: '',
    operations: [{ type: 'node.patch', nodeId: 'node-a', patch: { data: { apiKey: 'secret' } } }],
  }, common), /只允许修改有限坐标/);
  assert.throws(() => materializeCanvasPatchDraft({
    id: 'nan', title: 'bad', description: '',
    operations: [{ type: 'node.patch', nodeId: 'node-a', patch: { position: { x: Number.NaN, y: 0 } } }],
  }, common), /有限坐标/);
  assert.throws(() => materializeCanvasPatchDraft(draft, { ...common, baseRevision: 1.5 }), /baseRevision/);
  assert.throws(() => materializeCanvasPatchDraft(draft, { ...common, baseRevision: 0 }), /baseRevision/);
  const maximumOperations = materializeCanvasPatchDraft({
    id: 'maximum', title: 'good', description: '',
    operations: Array.from(
      { length: CANVAS_PATCH_DRAFT_MAX_OPERATIONS },
      (_, index) => ({ type: 'edge.delete' as const, edgeId: `edge-${index}` }),
    ),
  }, common);
  assert.equal(CANVAS_PATCH_DRAFT_MAX_OPERATIONS, 100);
  assert.equal(maximumOperations.operations.length, 100);
  assert.throws(() => materializeCanvasPatchDraft({
    id: 'too-many', title: 'bad', description: '',
    operations: Array.from(
      { length: CANVAS_PATCH_DRAFT_MAX_OPERATIONS + 1 },
      (_, index) => ({ type: 'edge.delete' as const, edgeId: `edge-${index}` }),
    ),
  }, common), /不能超过 100/);
});

test('legacy in-memory draft apply keeps its explicit name and compatibility alias', () => {
  const nodes: Node[] = [
    { id: 'node-a', type: 'text', position: { x: 0, y: 0 }, data: { text: 'hello' } },
    { id: 'node-b', type: 'text', position: { x: 10, y: 10 }, data: { text: 'world' } },
  ];
  const edges: Edge[] = [{ id: 'edge-a', source: 'node-a', target: 'node-b' }];
  const localDraft: CanvasPatchDraft = {
    id: 'local', title: 'local', description: '',
    operations: [{ type: 'node.patch', nodeId: 'node-a', patch: { position: { x: 20, y: 30 } } }],
    diagnosticsResolved: ['layout.invalid-position'],
  };

  assert.deepEqual(
    applyCanvasPatchDraft(nodes, edges, localDraft),
    applyCanvasPatch(nodes, edges, localDraft),
  );
});

test('authoritative patch preview, record, apply, and revert types stay structurally aligned', () => {
  const patch = materializeCanvasPatchDraft(draft, {
    projectId: 'project-safe', canvasId: 'canvas-safe', baseRevision: 7,
    diagnosticsResolved: ['layout.invalid-position'],
  });
  const change: CanvasPatchChange = {
    operationIndex: 0,
    type: 'node.move',
    targetType: 'node',
    targetId: 'node-a',
    fields: ['position.x', 'position.y'],
    before: { position: { x: 0, y: 0 } },
    after: { position: { x: 12, y: 34 } },
  };
  const preview: CanvasPatchPreview = {
    patchId: patch.id,
    baseRevision: 7,
    currentRevision: 7,
    previewDigest: 'a'.repeat(64),
    summary: patch.summary,
    diagnosticsResolved: patch.diagnosticsResolved,
    affectedNodeIds: ['node-a'],
    affectedEdgeIds: [],
    changes: [change],
  };
  const record: CanvasPatchRecord = {
    patchId: patch.id,
    summary: patch.summary,
    diagnosticsResolved: patch.diagnosticsResolved,
    baseRevision: 7,
    appliedRevision: 10,
    actorId: 'actor-a',
    status: 'applied',
    operationCount: patch.operations.length,
    createdAt: 10,
    canRevert: true,
  };
  const document = {
    schema: 't8-canvas-document' as const, schemaVersion: 2 as const,
    projectId: 'project-safe', canvasId: 'canvas-safe', entityUid: 'canvas-uid', revision: 10,
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    subflowInstances: [], tombstones: { nodes: {}, edges: {} }, updatedAt: 10,
  };
  const applied: CanvasPatchApplyResult = {
    patchId: patch.id, status: 'applied', duplicate: false, baseRevision: 7, revision: 10,
    document, acknowledgements: [],
  };
  const reverted: CanvasPatchRevertResult = {
    patchId: patch.id, status: 'reverted', revision: 11,
    document: { ...document, revision: 11 },
  };

  assert.equal((patch satisfies CanvasPatch).schema, 't8-canvas-patch-v1');
  assert.equal(record.appliedRevision, preview.currentRevision + patch.operations.length);
  assert.equal(applied.baseRevision, preview.baseRevision);
  assert.equal(reverted.status, 'reverted');
});
