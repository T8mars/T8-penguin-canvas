'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentControlRunService } = require('../backend/src/services/agentControlRuns.js');
const scope = { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS', actorId: 'EXAMPLE_ACTOR', sessionId: 'EXAMPLE_SESSION' };
function fixture() {
  const clock = { value: Date.now() }, intents = new Map(); let writes = 0;
  const document = { schema: 't8-canvas-document', schemaVersion: 2, projectId: scope.projectId, canvasId: scope.canvasId, revision: 7, nodes: [{ id: 'EXAMPLE_IMAGE', type: 'image', position: { x: 0, y: 0 }, data: { model: 'gpt-image-2', selectedModel: 'gpt-image-2' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const database = { getCanvas: id => id === scope.canvasId ? structuredClone(document) : null,
    createRunIntent(input) { const key = `${input.projectId}:${input.idempotencyKey}`; if (intents.has(key)) return structuredClone(intents.get(key)); const intent = { ...structuredClone(input), id: `EXAMPLE_INTENT_${++writes}`, status: 'accepted', queueRevision: 1, dispatchAttempts: 0, createdAt: clock.value, updatedAt: clock.value }; intents.set(key, intent); return structuredClone(intent); },
    getRunIntentByKey(projectId, key) { return structuredClone(intents.get(`${projectId}:${key}`) || null); },
    getRunIntent(id) { return structuredClone([...intents.values()].find(intent => intent.id === id) || null); },
  };
  return { clock, database, intents, get writes() { return writes; }, service: createAgentControlRunService({ database, now: () => clock.value }) };
}
function prepare(f) { const plan = f.service.createPlan({ nodeIds: ['EXAMPLE_IMAGE'] }, scope); return { public: plan, internal: f.service.startPreview(plan.planId, scope).plan }; }
test('one native run plan cannot reserve two operation keys while an exact replay stays idempotent', () => {
  const f = fixture(), plan = prepare(f);
  const first = f.service.complete(plan.internal, { operationId: 'EXAMPLE_RUN_OPERATION_A', actorId: scope.actorId, sessionId: scope.sessionId });
  assert.equal(f.service.complete(plan.internal, { operationId: 'EXAMPLE_RUN_OPERATION_A', actorId: scope.actorId }).id, first.id);
  assert.throws(() => f.service.complete(plan.internal, { operationId: 'EXAMPLE_RUN_OPERATION_B', actorId: scope.actorId }), error => error.code === 'RUN_PLAN_ALREADY_SUBMITTED');
  assert.throws(() => f.service.startPreview(plan.public.planId, scope), error => error.code === 'RUN_PLAN_ALREADY_SUBMITTED'); assert.equal(f.writes, 1);
});
test('native operation lookup recovers a durable intent without its in-memory plan and enforces owner/project/canvas', () => {
  const f = fixture(), plan = prepare(f), operationId = 'EXAMPLE_DURABLE_OPERATION';
  const first = f.service.complete(plan.internal, { operationId, actorId: scope.actorId });
  const restarted = createAgentControlRunService({ database: f.database });
  assert.equal(restarted.inspectOperation(operationId, scope).id, first.id); assert.equal(restarted.inspectOperation(operationId, scope).operationId, operationId);
  for (const changed of [{ actorId: 'EXAMPLE_OTHER_ACTOR' }, { projectId: 'EXAMPLE_OTHER_PROJECT' }, { canvasId: 'EXAMPLE_OTHER_CANVAS' }]) assert.throws(() => restarted.inspectOperation(operationId, { ...scope, ...changed }), error => error.code === 'RUN_INTENT_NOT_FOUND');
  assert.equal(f.writes, 1);
});
test('expired plans and changed caller identity cannot create an intent', () => {
  const f = fixture(), plan = prepare(f);
  assert.throws(() => f.service.complete(plan.internal, { operationId: 'EXAMPLE_OPERATION', actorId: 'EXAMPLE_OTHER_ACTOR' }), error => error.code === 'RUN_PLAN_SCOPE_MISMATCH');
  f.clock.value += 31 * 60_000;
  assert.throws(() => f.service.complete(plan.internal, { operationId: 'EXAMPLE_OPERATION', actorId: scope.actorId }), error => error.code === 'RUN_PLAN_EXPIRED'); assert.equal(f.writes, 0);
});
test('a ledger key belonging to another scope is neither disclosed nor treated as this plan result', () => {
  const f = fixture(), plan = prepare(f), operationId = 'EXAMPLE_CONFLICTING_OPERATION';
  f.intents.set(`${scope.projectId}:${operationId}`, { id: 'EXAMPLE_OTHER_INTENT', projectId: scope.projectId, canvasId: 'EXAMPLE_OTHER_CANVAS', requestedBy: 'EXAMPLE_OTHER_ACTOR', nodeIds: ['EXAMPLE_OTHER_NODE'], idempotencyKey: operationId });
  assert.throws(() => f.service.complete(plan.internal, { operationId, actorId: scope.actorId }), error => error.code === 'RUN_OPERATION_CONFLICT'); assert.equal(f.writes, 0);
});
