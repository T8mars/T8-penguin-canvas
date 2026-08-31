'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createAgentControlAuthService } = require('../backend/src/services/agentControlAuth.js');
const { createAgentControlApprovalService } = require('../backend/src/services/agentControlApprovals.js');
const { createAgentControlAssetService, resolveAppliedAssetPlacement } = require('../backend/src/services/agentControlAssets.js');
const { canvasPatchRequestDigest, previewCanvasPatch } = require('../backend/src/services/canvasPatch.js');
const agentControlRoute = require('../backend/src/routes/agentControl.js');

function request(server, options = {}, body = null) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method: options.method || 'GET',
      path: options.path || '/',
      headers: {
        Host: '127.0.0.1:19030',
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: text ? JSON.parse(text) : null,
      }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function issueSession(auth, scopes) {
  const pairing = auth.createPairing({
    clientName: 'Codex Creator Agent',
    agentKind: 'codex',
    requestedScopes: scopes,
  });
  auth.approvePairing({
    pairingId: pairing.pairingId,
    userCode: pairing.userCode,
    approvedScopes: scopes,
  });
  return auth.pollPairing({
    pairingId: pairing.pairingId,
    pollSecret: pairing.pollSecret,
  });
}

test('asset.place previews a verified project asset and applies one deterministic reversible patch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcanvas-asset-place-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('asset-place-fixture', 'utf8'),
  ]);
  const managedPath = path.join(root, '角色参考.png');
  fs.writeFileSync(managedPath, bytes);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const canvas = {
    schemaVersion: 1,
    projectId: 'project-local',
    canvasId: 'canvas-a',
    revision: 7,
    nodes: [{
      id: 'image-target',
      type: 'image',
      position: { x: 900, y: 240 },
      data: { title: '目标图像节点' },
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    tombstones: { nodes: {}, edges: {} },
  };
  const asset = {
    id: 'asset-character',
    projectId: 'project-local',
    kind: 'image',
    filename: '角色参考.png',
    mimeType: 'image/png',
    sizeBytes: bytes.length,
    contentHash,
    contentRevision: 3,
    storageMode: 'managed',
    managedPath,
  };
  const applied = new Map();
  const applications = new Map();
  const previews = new Map();
  let currentCanvas = canvas;
  let applyCalls = 0;
  let commitCalls = 0;
  const database = {
    getCanvas: (canvasId) => canvasId === canvas.canvasId ? currentCanvas : null,
    getAsset: (assetId) => assetId === asset.id ? asset : null,
    previewCanvasPatch: (canvasId, patch, context) => {
      assert.equal(canvasId, canvas.canvasId);
      const preview = previewCanvasPatch(currentCanvas, patch, context);
      previews.set(patch.id, preview);
      return preview;
    },
    getCanvasPatchApplication: (_canvasId, patchId) => applications.get(patchId) || null,
    applyCanvasPatch: (_canvasId, patch, options = {}) => {
      applyCalls += 1;
      const existing = applied.get(patch.id);
      if (existing) return { ...existing, duplicate: true };
      commitCalls += 1;
      const preview = previews.get(patch.id);
      assert.ok(preview);
      assert.equal(options.previewDigest, preview.previewDigest);
      const addedNodes = patch.operations
        .filter((operation) => operation.type === 'node.add')
        .map((operation) => operation.payload.node);
      const addedEdges = patch.operations
        .filter((operation) => operation.type === 'edge.add')
        .map((operation) => operation.payload.edge);
      currentCanvas = {
        ...currentCanvas,
        revision: 8,
        nodes: [...currentCanvas.nodes, ...addedNodes],
        edges: [...currentCanvas.edges, ...addedEdges],
      };
      const result = {
        patchId: patch.id,
        status: 'applied',
        duplicate: false,
        baseRevision: patch.baseRevision,
        revision: 8,
        acknowledgements: patch.operations.map((_operation, index) => ({
          opId: `${patch.id}:${index}`,
          revision: 8,
          duplicate: false,
        })),
        document: currentCanvas,
      };
      applied.set(patch.id, result);
      applications.set(patch.id, {
        patchId: patch.id,
        requestDigest: canvasPatchRequestDigest(patch),
        previewDigest: preview.previewDigest,
        summary: preview.summary,
        diagnosticsResolved: preview.diagnosticsResolved,
        baseRevision: patch.baseRevision,
        appliedRevision: 8,
        actorId: 'codex-agent',
        status: 'applied',
        operationCount: patch.operations.length,
        affectedNodeIds: preview.affectedNodeIds,
        affectedEdgeIds: preview.affectedEdgeIds,
        changes: preview.changes,
      });
      return result;
    },
  };
  const auth = createAgentControlAuthService();
  const approvals = createAgentControlApprovalService();
  const assetService = createAgentControlAssetService({
    database,
    uploadManager: { ingestFile: async () => { throw new Error('unexpected import'); } },
  });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/agent-control/v1', agentControlRoute.createAgentControlRouter({
    auth,
    approvals,
    assetService,
    database,
    mirrorWriter: () => [],
    config: {
      PORT: 19030,
      APP_VERSION: '2.6.5',
      BACKEND_INSTANCE_ID: 'a'.repeat(43),
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const session = issueSession(auth, ['canvas:read', 'canvas:write', 'asset:read']);
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const input = {
    projectId: canvas.projectId,
    canvasId: canvas.canvasId,
    assetId: asset.id,
    targetNodeId: 'image-target',
    targetHandle: 'image',
    operationId: 'place-character-reference',
  };
  const created = await request(server, {
    method: 'POST',
    path: '/api/agent-control/v1/asset-place-approvals',
    headers,
  }, input);
  assert.equal(created.status, 202);
  assert.equal(created.body.data.action, 'asset.place');
  assert.equal(created.body.data.preview.riskLevel, 'L1');
  assert.equal(created.body.data.preview.providerTransfer.occursNow, false);
  assert.equal(created.body.data.preview.cost.amount, 0);
  assert.equal(created.body.data.preview.assetPlacement.asset.id, asset.id);
  assert.equal(created.body.data.preview.assetPlacement.position.x, 480);
  assert.equal(created.body.data.preview.assetPlacement.position.y, 240);
  assert.equal(created.body.data.preview.assetPlacement.targetNodeId, 'image-target');
  assert.equal(created.body.data.preview.assetPlacement.targetHandle, 'image');
  assert.equal(created.body.data.preview.assetPlacement.lineage.contentRevision, 3);
  assert.equal(created.body.data.preview.assetPlacement.asset.contentHash, contentHash);
  assert.equal(JSON.stringify(created.body).includes(root), false);
  assert.equal(applyCalls, 0);

  approvals.approve(created.body.data.approvalRequestId);
  const completed = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${created.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: created.body.data.pollSecret });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.action, 'asset.place');
  assert.equal(completed.body.data.duplicate, false);
  assert.equal(completed.body.data.revision, 8);
  assert.equal(applyCalls, 1);

  const [patchId, stored] = [...applied.entries()][0];
  assert.equal(patchId, created.body.data.patchId);
  const node = stored.document.revision === 8
    ? created.body.data.preview.assetPlacement
    : null;
  assert.equal(node.nodeId.startsWith('asset-place-'), true);
  const placePatch = created.body.data.patchId;

  const replay = await request(server, {
    method: 'POST',
    path: '/api/agent-control/v1/asset-place-approvals',
    headers,
  }, input);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.data.patchId, placePatch);
  assert.equal(replay.body.data.alreadyApplied.patchId, placePatch);
  assert.equal(replay.body.data.alreadyApplied.appliedRevision, 8);
  assert.equal(replay.body.data.preview.currentRevision, 7);
  approvals.approve(replay.body.data.approvalRequestId);
  const replayCompleted = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${replay.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: replay.body.data.pollSecret });
  assert.equal(replayCompleted.status, 200);
  assert.equal(replayCompleted.body.data.duplicate, true);
  assert.equal(replayCompleted.body.data.revision, 8);
  assert.equal(applied.size, 1);
  assert.equal(applyCalls, 2);
  assert.equal(commitCalls, 1);
});

test('asset.place without an explicit position reuses its original stable placement after canvas growth', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcanvas-asset-place-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('replay')]);
  const managedPath = path.join(root, 'result.png');
  fs.writeFileSync(managedPath, bytes);
  const asset = {
    id: 'asset-replay', projectId: 'project-local', kind: 'image', filename: 'result.png',
    mimeType: 'image/png', sizeBytes: bytes.length, contentHash: crypto.createHash('sha256').update(bytes).digest('hex'),
    contentRevision: 1, storageMode: 'managed', managedPath,
  };
  let document = {
    schemaVersion: 1, projectId: 'project-local', canvasId: 'canvas-replay', revision: 1,
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, tombstones: { nodes: {}, edges: {} },
  };
  const applications = new Map();
  const database = {
    getCanvas: () => document,
    getAsset: () => asset,
    getCanvasPatchApplication: (_canvasId, patchId) => applications.get(patchId) || null,
  };
  const service = createAgentControlAssetService({
    database,
    uploadManager: { ingestFile: async () => { throw new Error('unexpected import'); } },
  });
  const first = await service.inspectPlace(asset.id, document, { projectId: 'project-local' });
  const node = first.patch.operations[0].payload.node;
  document = { ...document, revision: 2, nodes: [node] };
  applications.set(first.patch.id, {
    patchId: first.patch.id,
    requestDigest: canvasPatchRequestDigest(first.patch),
    baseRevision: 1,
    appliedRevision: 2,
    status: 'applied',
  });
  const replay = await service.inspectPlace(asset.id, document, { projectId: 'project-local' });
  assert.equal(replay.patch.id, first.patch.id);
  assert.deepEqual(replay.placement.position, first.placement.position);
  assert.equal(resolveAppliedAssetPlacement(database, document.canvasId, replay).status, 'applied');
});

test('asset.place rejects assets outside the current project before creating an approval', async (t) => {
  const database = {
    getCanvas: () => ({
      schemaVersion: 1,
      projectId: 'project-local',
      canvasId: 'canvas-a',
      revision: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    getAsset: () => ({
      id: 'asset-other',
      projectId: 'project-other',
      kind: 'image',
    }),
  };
  const auth = createAgentControlAuthService();
  const approvals = createAgentControlApprovalService();
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/agent-control/v1', agentControlRoute.createAgentControlRouter({
    auth,
    approvals,
    database,
    assetService: createAgentControlAssetService({
      database,
      uploadManager: { ingestFile: async () => { throw new Error('unexpected import'); } },
    }),
    config: {
      PORT: 19030,
      APP_VERSION: '2.6.5',
      BACKEND_INSTANCE_ID: 'b'.repeat(43),
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const session = issueSession(auth, ['canvas:read', 'canvas:write', 'asset:read']);
  const response = await request(server, {
    method: 'POST',
    path: '/api/agent-control/v1/asset-place-approvals',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  }, {
    projectId: 'project-local',
    canvasId: 'canvas-a',
    assetId: 'asset-other',
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'ASSET_NOT_FOUND');
  assert.equal(approvals.listPending().length, 0);
});
