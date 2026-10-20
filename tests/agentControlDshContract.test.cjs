'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createAgentControlRouter } = require('../backend/src/routes/agentControl');
const { createAgentControlAuthService } = require('../backend/src/services/agentControlAuth');
const { createAgentControlApprovalService } = require('../backend/src/services/agentControlApprovals');

// Original HTTP handlers, authentication, approvals and RunIntent service; the
// in-memory ledger is deliberately not a Provider or desktop-window acceptance.
async function fixture(t, config = {}) {
  const auth = createAgentControlAuthService();
  const approvals = createAgentControlApprovalService();
  const document = {
    schema: 't8-canvas-document', schemaVersion: 2,
    projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS', revision: 7,
    nodes: [{ id: 'EXAMPLE_IMAGE', type: 'image', position: { x: 0, y: 0 },
      data: { model: 'gpt-image-2', selectedModel: 'gpt-image-2' } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  };
  const intents = new Map();
  let writes = 0, reads = 0;
  const database = {
    getCanvas(id) { reads++; return id === document.canvasId ? structuredClone(document) : null; },
    createRunIntent(input) {
      const key = `${input.projectId}:${input.idempotencyKey}`;
      if (!intents.has(key)) intents.set(key, { ...structuredClone(input),
        id: `EXAMPLE_INTENT_${++writes}`, status: 'accepted', queueRevision: 1,
        createdAt: Date.now(), updatedAt: Date.now() });
      return structuredClone(intents.get(key));
    },
    getRunIntentByKey(projectId, key) { return structuredClone(intents.get(`${projectId}:${key}`) || null); },
    getRunIntent(id) { return structuredClone([...intents.values()].find(item => item.id === id) || null); },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/agent-control/v1', createAgentControlRouter({ auth, approvals, database,
    config: { PORT: 19030, APP_VERSION: '3.3.6', BACKEND_INSTANCE_ID: 'a'.repeat(43), ...config } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  function session(scopes = ['run:read', 'run:execute']) {
    const pairing = auth.createPairing({ clientName: 'EXAMPLE_DSH', requestedScopes: scopes });
    auth.approvePairing({ pairingId: pairing.pairingId, userCode: pairing.userCode, approvedScopes: scopes });
    return auth.pollPairing({ pairingId: pairing.pairingId, pollSecret: pairing.pollSecret });
  }
  function request(path, { session: caller, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method,
        path: `/api/agent-control/v1${path}`, headers: { Host: '127.0.0.1:19030',
          ...(caller ? { Authorization: `Bearer ${caller.accessToken}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}) } }, res => {
        let bytes = '';
        res.setEncoding('utf8'); res.on('data', chunk => { bytes += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(bytes) }); }
          catch (error) { reject(error); }
        });
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  return { auth, approvals, document, intents, request, session,
    get writes() { return writes; }, get reads() { return reads; } };
}
const scope = { projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS' };
const query = '?projectId=EXAMPLE_PROJECT&canvasId=EXAMPLE_CANVAS';

test('DSH status advertises the configured native import limit without opening a database', async t => {
  const limit = 3 * 1024 ** 3;
  const f = await fixture(t, { COLLAB_MAX_UPLOAD_BYTES: limit });
  const result = await f.request('/status');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.assetControl.schema, 't8-agent-asset-control-v1');
  assert.equal(result.body.data.assetControl.maxImportBytes, limit);
  assert.equal(result.body.data.runControl.schema, 't8-agent-run-control-v1');
  assert.equal(f.reads, 0); assert.equal(f.writes, 0);
});

test('DSH run recovery uses scoped GETs and reserves only one intent after native approval', async t => {
  const f = await fixture(t), caller = f.session(), operationId = 'EXAMPLE_DSH_RUN_OPERATION';
  const plan = await f.request('/run-plans', { session: caller, method: 'POST', body: { ...scope, nodeIds: ['EXAMPLE_IMAGE'] } });
  assert.equal(plan.status, 200);
  const approval = await f.request('/run-start-approvals', { session: caller, method: 'POST', body: { ...scope, planId: plan.body.data.planId, operationId } });
  assert.equal(approval.status, 202);
  const lookup = `/run-start-approvals/by-operation/${operationId}${query}`;
  const recovered = await f.request(lookup, { session: caller });
  assert.equal(recovered.body.data.approvalRequestId, approval.body.data.approvalRequestId);
  assert.equal(recovered.body.data.pollSecret, approval.body.data.pollSecret);
  // Check isolation while the approval actually exists. A lookup after it has
  // been consumed would return 404 even if the session/target guard were broken.
  for (const [options, status] of [
    [{}, 401], [{ session: f.session(['asset:read']) }, 403], [{ session: f.session() }, 404],
  ]) {
    const refused = await f.request(lookup, options);
    assert.equal(refused.status, status);
    assert.equal(JSON.stringify(refused.body).includes(recovered.body.data.pollSecret), false);
  }
  for (const changed of ['projectId=EXAMPLE_OTHER&canvasId=EXAMPLE_CANVAS', 'projectId=EXAMPLE_PROJECT&canvasId=EXAMPLE_OTHER']) {
    assert.equal((await f.request(lookup.split('?')[0] + '?' + changed, { session: caller })).status, 404);
  }
  const complete = () => f.request(`/approvals/${recovered.body.data.approvalRequestId}/complete`, {
    session: caller, method: 'POST', body: { pollSecret: recovered.body.data.pollSecret } });
  const wrongSecret = await f.request(`/approvals/${recovered.body.data.approvalRequestId}/complete`, {
    session: caller, method: 'POST', body: { pollSecret: 'EXAMPLE_WRONG_POLL_SECRET' } });
  assert.equal(wrongSecret.status, 403);
  assert.equal(wrongSecret.body.code, 'APPROVAL_POLL_FORBIDDEN');
  const pending = await complete();
  assert.equal(pending.status, 200); assert.equal(pending.body.data.status, 'pending'); assert.equal(f.writes, 0);
  f.approvals.approve(approval.body.data.approvalRequestId);
  const committed = await complete();
  assert.equal(committed.status, 200); assert.equal(f.writes, 1);
  const intentPath = `/run-intents/by-operation/${operationId}${query}`;
  const restored = await f.request(intentPath, { session: caller });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.operationId, operationId);
  assert.equal(restored.body.data.status, 'accepted');
  assert.equal(restored.body.data.completionVerified, false);
  assert.equal((await f.request(lookup, { session: caller })).status, 404);
  const reused = await f.request('/run-start-approvals', { session: caller, method: 'POST', body: {
    ...scope, planId: plan.body.data.planId, operationId: 'EXAMPLE_OTHER_OPERATION' } });
  assert.equal(reused.status, 409); assert.equal(reused.body.code, 'RUN_PLAN_ALREADY_SUBMITTED');
  for (const path of [intentPath]) {
    assert.equal((await f.request(path)).status, 401);
    assert.equal((await f.request(path, { session: f.session(['asset:read']) })).status, 403);
    assert.equal((await f.request(path, { session: f.session() })).status, 404);
    for (const changed of ['projectId=EXAMPLE_OTHER&canvasId=EXAMPLE_CANVAS', 'projectId=EXAMPLE_PROJECT&canvasId=EXAMPLE_OTHER']) {
      assert.equal((await f.request(path.split('?')[0] + '?' + changed, { session: caller })).status, 404);
    }
  }
  f.auth.revoke(caller.accessToken);
  assert.equal((await f.request(intentPath, { session: caller })).status, 401);
  assert.equal(f.writes, 1);
});

test('invalid run operation keys are refused before entering the native approval queue', async t => {
  const f = await fixture(t), caller = f.session();
  const plan = await f.request('/run-plans', { session: caller, method: 'POST', body: {
    ...scope, nodeIds: ['EXAMPLE_IMAGE'] } });
  for (const operationId of ['short', ' '.repeat(8), 'x'.repeat(161), 'EXAMPLE/INVALID']) {
    const result = await f.request('/run-start-approvals', { session: caller, method: 'POST', body: {
      ...scope, planId: plan.body.data.planId, operationId } });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'RUN_OPERATION_ID_INVALID');
    assert.equal(f.approvals.listPending().length, 0);
  }
  assert.equal(f.writes, 0);

  const valid = await f.request('/run-start-approvals', { session: caller, method: 'POST', body: {
    ...scope, planId: plan.body.data.planId, operationId: 'EXAMPLE_FAILED_INTENT' } });
  f.approvals.approve(valid.body.data.approvalRequestId);
  const finished = await f.request(`/approvals/${valid.body.data.approvalRequestId}/complete`, {
    session: caller, method: 'POST', body: { pollSecret: valid.body.data.pollSecret } });
  assert.equal(finished.status, 200);
  const original = [...f.intents.values()][0];
  original.status = 'failed'; // Synthetic ledger failure, not a paid task.
  for (const operationId of ['short', ' '.repeat(8), 'x'.repeat(161), 'EXAMPLE/INVALID']) {
    const result = await f.request('/run-retry-approvals', { session: caller, method: 'POST', body: {
      ...scope, intentId: original.id, operationId } });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'RUN_OPERATION_ID_INVALID');
    assert.equal(f.approvals.listPending().length, 0);
  }
  assert.equal(f.writes, 1, 'invalid retry keys cannot reserve another intent');
});

test('replanning retires old operation lookup and its native approval without reserving an intent', async t => {
  const f = await fixture(t), caller = f.session();
  const input = { ...scope, nodeIds: ['EXAMPLE_IMAGE'] };
  const first = await f.request('/run-plans', { session: caller, method: 'POST', body: input });
  const operationId = 'EXAMPLE_RETIRED_OPERATION';
  const approval = await f.request('/run-start-approvals', { session: caller, method: 'POST', body: {
    ...scope, planId: first.body.data.planId, operationId } });
  assert.equal(approval.status, 202);
  assert.equal((await f.request(`/run-start-approvals/by-operation/${operationId}${query}`, { session: caller })).status, 200);
  f.document.revision++;
  const replacement = await f.request('/run-plans', { session: caller, method: 'POST', body: input });
  assert.equal(replacement.status, 200);
  assert.equal((await f.request(`/run-start-approvals/by-operation/${operationId}${query}`, { session: caller })).status, 404);
  assert.throws(() => f.approvals.approve(approval.body.data.approvalRequestId), error => error.code === 'APPROVAL_STALE');
  const refused = await f.request(`/approvals/${approval.body.data.approvalRequestId}/complete`, {
    session: caller, method: 'POST', body: { pollSecret: approval.body.data.pollSecret } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'APPROVAL_STALE');
  assert.equal(f.writes, 0);
});
