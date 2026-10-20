'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentControlApprovalService } = require('../backend/src/services/agentControlApprovals.js');
test('approval operation lookup is read-only and restricted to original action/session/project/canvas', () => {
  const service = createAgentControlApprovalService();
  const input = { action: 'run.start', operationId: 'EXAMPLE_RUN_OPERATION', sessionId: 'EXAMPLE_SESSION', actorId: 'agent:EXAMPLE_SESSION', projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS', preview: { run: { planId: 'EXAMPLE_PLAN' } } };
  const created = service.create(input), read = service.inspectOperation(input); assert.equal(read.approvalRequestId, created.approvalRequestId); assert.equal(read.pollSecret, created.pollSecret); assert.equal(read.status, 'pending'); assert.equal(service.listPending().length, 1);
  for (const changed of [{ action: 'patch.apply' }, { operationId: 'EXAMPLE_OTHER' }, { sessionId: 'EXAMPLE_OTHER' }, { projectId: 'EXAMPLE_OTHER' }, { canvasId: 'EXAMPLE_OTHER' }]) assert.throws(() => service.inspectOperation({ ...input, ...changed }), error => error.code === 'APPROVAL_NOT_FOUND');
  service.approve(created.approvalRequestId); assert.equal(service.inspectOperation(input).status, 'approved'); assert.equal(service.beginCompletion({ approvalRequestId: created.approvalRequestId, pollSecret: created.pollSecret, sessionId: input.sessionId }).status, 'approved');
});
test('expired native approval lookup cannot resurrect or approve the operation', () => {
  let clock = Date.now(); const service = createAgentControlApprovalService({ now: () => clock }); const input = { action: 'run.start', operationId: 'EXAMPLE_RUN_EXPIRES', sessionId: 'EXAMPLE_SESSION', projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS', preview: {} };
  service.create(input); clock += 11 * 60_000; assert.throws(() => service.inspectOperation(input), error => error.code === 'APPROVAL_NOT_FOUND'); assert.equal(service.listPending().length, 0);
});
