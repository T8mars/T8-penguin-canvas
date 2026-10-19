import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { materializeCanvasPatchDraft, type CanvasPatchDraft } from '../src/utils/workflowDoctor.ts';

// Cross the actual frontend wire boundary and the actual backend validator,
// planner, protocol implementation and inverse planner. Pure fresh documents:
// no SQLite, network, service, UI or retained data.
const require = createRequire(import.meta.url);
const { validateCanvasPatch, buildCanvasPatchPlan, CanvasPatchValidationError } = require('../backend/src/services/canvasPatch.js');
const { normalizeCanvasDocument } = require('../backend/src/collaboration/protocol.js');
const scope = { projectId: 'project-move-contract', canvasId: 'canvas-move-contract', baseRevision: 1 };
function draft(position: unknown, source: CanvasPatchDraft['source'] = 'workflow-doctor-v1'): CanvasPatchDraft {
  return { id: 'move-contract', title: 'Move only', description: '', source,
    diagnosticsResolved: ['layout.invalid-position'],
    operations: [{ type: 'node.patch', nodeId: 'text-1', patch: { position } }] } as CanvasPatchDraft;
}
function document(type = 'text', data = { text: 'Keep original text' }) {
  return normalizeCanvasDocument(scope.canvasId, {
    nodes: [{ id: 'text-1', type, position: { x: 10, y: 20 }, data }], edges: [], viewport: { x: 11, y: 22, zoom: 1.5 },
  }, { projectId: scope.projectId, revision: 1, updatedAt: 1 });
}
const context = { actorId: 'local-owner', sessionId: 'local-session', authority: { source: 'local-owner', role: 'owner' } };

test('doctor positional repair materializes into an accepted backend move and its valid inverse', () => {
  const original = document();
  const patch = materializeCanvasPatchDraft(draft({ x: 180, y: 240 }), scope);
  // The original bug fails here in production validateCanvasPatch, not merely
  // on an expected object shape in a frontend-only test.
  const validated = validateCanvasPatch(patch);
  const plan = buildCanvasPatchPlan(original, patch, context);
  assert.equal(validated.operations[0].type, 'node.move');
  assert.deepEqual(validated.operations[0].payload, { nodeId: 'text-1', position: { x: 180, y: 240 } });
  assert.deepEqual(plan.resultingDocument.nodes[0].position, { x: 180, y: 240 });
  assert.deepEqual(plan.resultingDocument.nodes[0].data, original.nodes[0].data);
  assert.deepEqual(plan.resultingDocument.viewport, original.viewport);
  assert.equal(plan.preview.changes[0].type, 'node.move');
  assert.deepEqual(plan.inverseOperations, [{ type: 'node.move', payload: { nodeId: 'text-1', position: { x: 10, y: 20 } } }]);
});

test('legacy doctor drafts without an explicit source use the same accepted move wire contract', () => {
  const input = draft({ x: 12, y: 34 }); delete input.source;
  const patch = materializeCanvasPatchDraft(input, scope);
  const plan = buildCanvasPatchPlan(document(), patch, context);
  assert.equal(plan.operations[0].type, 'node.move'); assert.deepEqual(plan.resultingDocument.nodes[0].position, { x: 12, y: 34 });
});

test('script-master controlled public data remains node.patch and passes the real backend planner', () => {
  const input: CanvasPatchDraft = { id: 'script-data', title: 'Script data', description: '', source: 'script-master-v1',
    operations: [{ type: 'node.patch', nodeId: 'text-1', nodeType: 'story', patch: { data: { title: 'Updated story' } } }] } as CanvasPatchDraft;
  const patch = materializeCanvasPatchDraft(input, scope);
  const validated = validateCanvasPatch(patch);
  assert.equal(validated.operations[0].type, 'node.patch');
  assert.deepEqual(validated.operations[0].payload, { nodeId: 'text-1', dataPatch: { title: 'Updated story' } });
  const plan = buildCanvasPatchPlan(document('story'), patch, context);
  assert.equal(plan.resultingDocument.nodes[0].data.title, 'Updated story');
  assert.deepEqual(plan.resultingDocument.nodes[0].position, { x: 10, y: 20 });
});

test('script-master may not use the doctor positional repair route', () => {
  const input = draft({ x: 180, y: 240 }, 'script-master-v1'); (input.operations[0] as any).nodeType = 'story';
  assert.throws(() => materializeCanvasPatchDraft(input, scope), /只允许更新公开 data/);
});

test('non-finite, incomplete, string and extra positional fields remain rejected before submission', () => {
  for (const position of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '180', y: 240 }, { x: 180 },
    { x: 180, y: 240, z: 0 }, null, [180, 240]]) {
    assert.throws(() => materializeCanvasPatchDraft(draft(position), scope), /有限坐标/);
  }
  const mixed = draft({ x: 180, y: 240 }); (mixed.operations[0] as any).patch.data = { text: 'Unexpected write' };
  assert.throws(() => materializeCanvasPatchDraft(mixed, scope), /有限坐标/);
});

test('backend still rejects direct node.patch attempts to change protected position', () => {
  const patch = materializeCanvasPatchDraft(draft({ x: 180, y: 240 }), scope);
  patch.operations[0].type = 'node.patch'; patch.operations[0].payload = { nodeId: 'text-1', patch: { position: { x: 180, y: 240 } } };
  assert.throws(() => validateCanvasPatch(patch), error => error instanceof Error && error instanceof CanvasPatchValidationError && /禁止修改节点身份或类型/.test(error.message));
});

test('backend coordinate magnitude gate is not relaxed by positional draft translation', () => {
  const patch = materializeCanvasPatchDraft(draft({ x: 10_000_001, y: 0 }), scope);
  assert.throws(() => validateCanvasPatch(patch), error => error instanceof CanvasPatchValidationError);
});

test('negative zero normalization and deterministic patch identity remain stable', () => {
  const negative = materializeCanvasPatchDraft(draft({ x: -0, y: 0 }), scope);
  const positive = materializeCanvasPatchDraft(draft({ x: 0, y: 0 }), scope);
  assert.deepEqual(negative, positive);
  const validated = validateCanvasPatch(negative);
  assert.equal(Object.is(validated.operations[0].payload.position.x, -0), false);
});
