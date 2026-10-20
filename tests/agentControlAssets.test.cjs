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
const {
  AgentControlAssetError,
  createAgentControlAssetService,
  inspectImportFile,
} = require('../backend/src/services/agentControlAssets.js');
const agentControlRoute = require('../backend/src/routes/agentControl.js');

function pngBytes(extra = '') {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(extra || 'fixture-png', 'utf8'),
  ]);
}

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
    clientName: 'Codex 创作 Agent',
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

test('asset content-hash search validates its filter and forwards the same exact scope to list/count', () => {
  const seen = [], hash = '9'.repeat(64), service = createAgentControlAssetService({ uploadManager: {}, database: {
    listAssets(filters) { seen.push(filters); return []; }, countAssets(filters) { seen.push(filters); return 0; }, getAssetCatalogRevision() { return 1; },
  } });
  assert.throws(() => service.search({ projectId: 'EXAMPLE_PROJECT', contentHash: 'EXAMPLE_INVALID' }), error => error.code === 'ASSET_HASH_INVALID'); assert.equal(seen.length, 0);
  assert.equal(service.search({ projectId: 'EXAMPLE_PROJECT', contentHash: hash }).total, 0); assert.equal(seen.length, 2); assert.ok(seen.every(filters => filters.projectId === 'EXAMPLE_PROJECT' && filters.contentHash === hash));
});

test('read-only asset search/import preview do not initialize the copying manager or create storage folders', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'EXAMPLE_asset_read_')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const image = path.join(root, 'EXAMPLE.png'); fs.writeFileSync(image, pngBytes());
  const database = { listAssets: () => [], countAssets: () => 0, getAssetCatalogRevision: () => 1 };
  const service = createAgentControlAssetService({ database, config: { ASSET_BLOB_DIR: path.join(root, 'EXAMPLE_BLOBS'), DATA_DIR: path.join(root, 'EXAMPLE_DATA') } });
  assert.equal(service.search({ projectId: 'EXAMPLE_PROJECT' }).total, 0); assert.equal((await service.inspectImport(image)).size, pngBytes().length);
  assert.equal(fs.existsSync(path.join(root, 'EXAMPLE_BLOBS')), false); assert.equal(fs.existsSync(path.join(root, 'EXAMPLE_DATA')), false);
});

test('asset approval recovery and minimal patch receipt routes preserve native scopes without approving or exposing private ledger fields', async t => {
  const auth = createAgentControlAuthService(), approvals = createAgentControlApprovalService(), hash = '9'.repeat(64), database = {
    getCanvas(id) { return id === 'EXAMPLE_CANVAS' ? { projectId: 'EXAMPLE_PROJECT', canvasId: id, revision: 1 } : null; },
    getCanvasPatchApplication(canvasId, patchId, options) { assert.equal(canvasId, 'EXAMPLE_CANVAS'); assert.equal(options.projectId, 'EXAMPLE_PROJECT'); assert.equal(options.includeAllActors, true); return patchId === 'EXAMPLE_PATCH' ? { patchId, status: 'applied', baseRevision: 1, appliedRevision: 2, affectedNodeIds: ['EXAMPLE_NODE'], requestDigest: 'EXAMPLE_PRIVATE_DIGEST', changes: ['EXAMPLE_PRIVATE_CHANGE'], actorId: 'EXAMPLE_PRIVATE_ACTOR' } : null; },
  };
  const app = express(); app.use(express.json()); app.use('/api/agent-control/v1', agentControlRoute.createAgentControlRouter({ auth, approvals, database, config: { PORT: 19030, APP_VERSION: '3.3.6', BACKEND_INSTANCE_ID: 'a'.repeat(43), COLLAB_MAX_UPLOAD_BYTES: 1024 * 1024 } }));
  const server = http.createServer(app); await new Promise(done => server.listen(0, '127.0.0.1', done)); t.after(() => new Promise(done => server.close(done)));
  const session = issueSession(auth, ['canvas:read', 'canvas:write', 'asset:read', 'asset:transfer']), headers = { Authorization: `Bearer ${session.accessToken}` };
  for (const action of ['import', 'place']) {
    const operationId = `EXAMPLE_ASSET_${action}`, record = approvals.create({ action: `asset.${action}`, sessionId: session.sessionId, projectId: 'EXAMPLE_PROJECT', canvasId: 'EXAMPLE_CANVAS', operationId, preview: { file: { sha256: hash } } });
    const path = `/api/agent-control/v1/asset-${action}-approvals/by-operation/${operationId}?projectId=EXAMPLE_PROJECT&canvasId=EXAMPLE_CANVAS`, read = await request(server, { path, headers }); assert.equal(read.status, 200); assert.equal(read.body.data.approvalRequestId, record.approvalRequestId); assert.equal(read.body.data.status, 'pending');
    assert.equal(crypto.createHash('sha256').update(read.body.data.pollSecret).digest('hex'), crypto.createHash('sha256').update(record.pollSecret).digest('hex'));
    assert.equal((await request(server, { path: path.replace('projectId=EXAMPLE_PROJECT', 'projectId=EXAMPLE_OTHER'), headers })).status, 404);
    const other = issueSession(auth, ['canvas:read', 'canvas:write', 'asset:read', 'asset:transfer']); assert.equal((await request(server, { path, headers: { Authorization: `Bearer ${other.accessToken}` } })).status, 404);
  }
  assert.equal(approvals.listPending().length, 2); const status = await request(server, { path: '/api/agent-control/v1/status' }); assert.equal(status.body.data.assetControl.maxImportBytes, 1024 * 1024);
  const patch = await request(server, { path: '/api/agent-control/v1/patches/EXAMPLE_PATCH?projectId=EXAMPLE_PROJECT&canvasId=EXAMPLE_CANVAS', headers }); assert.equal(patch.status, 200); assert.equal(patch.body.data.appliedRevision, 2); assert.equal(JSON.stringify(patch.body).includes('EXAMPLE_PRIVATE'), false);
  assert.equal((await request(server, { path: '/api/agent-control/v1/patches/EXAMPLE_PATCH?projectId=EXAMPLE_OTHER&canvasId=EXAMPLE_CANVAS', headers })).status, 404);
  const readOnly = issueSession(auth, ['asset:read']); assert.equal((await request(server, { path: '/api/agent-control/v1/asset-import-approvals/by-operation/EXAMPLE_ASSET_import?projectId=EXAMPLE_PROJECT&canvasId=EXAMPLE_CANVAS', headers: { Authorization: `Bearer ${readOnly.accessToken}` } })).status, 403);
});

test('asset import inspection rejects fake mime and symlinks without writing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcanvas-asset-inspect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = path.join(root, 'fake.png');
  fs.writeFileSync(fake, 'not a png', 'utf8');
  await assert.rejects(
    inspectImportFile(fake),
    (error) => error instanceof AgentControlAssetError && error.code === 'ASSET_IMPORT_MIME_MISMATCH',
  );

  const real = path.join(root, '真实 图片 & 1.png');
  fs.writeFileSync(real, pngBytes());
  const inspected = await inspectImportFile(real);
  assert.equal(inspected.kind, 'image');
  assert.equal(inspected.basename, '真实 图片 & 1.png');
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/);
});

test('agent asset route previews exact file, imports once after approval and detects TOCTOU', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcanvas-asset-route-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, '角色 & 参考.png');
  fs.writeFileSync(filename, pngBytes('version-a'));
  const managedFilename = path.join(root, 'managed-source.png');
  const managedBytes = pngBytes('managed-download');
  fs.writeFileSync(managedFilename, managedBytes);
  const managedHash = crypto.createHash('sha256').update(managedBytes).digest('hex');

  const auth = createAgentControlAuthService();
  const approvals = createAgentControlApprovalService();
  let ingestCalls = 0;
  const database = {
    getCanvas: (canvasId) => canvasId === 'canvas-a'
      ? { projectId: 'project-local', canvasId, revision: 7 }
      : null,
    listAssets: () => [{
      id: 'asset-existing',
      projectId: 'project-local',
      kind: 'image',
      filename: '已有角色.png',
      mimeType: 'image/png',
      sizeBytes: managedBytes.length,
      contentHash: managedHash,
      storageMode: 'managed',
      managedPath: managedFilename,
    }],
    countAssets: () => 1,
    getAssetCatalogRevision: () => 4,
    getAsset: (assetId) => assetId === 'asset-existing'
      ? {
          id: assetId,
          projectId: 'project-local',
          kind: 'image',
          filename: '已有角色.png',
          mimeType: 'image/png',
          sizeBytes: managedBytes.length,
          contentHash: managedHash,
          storageMode: 'managed',
          managedPath: managedFilename,
        }
      : null,
    listAssetLineage: () => ({
      items: [{ id: 'lineage-a', childAssetId: 'asset-existing', sourceType: 'upload' }],
      total: 1,
      nextCursor: null,
      hasMore: false,
      lineageRevision: 1,
    }),
  };
  const assetService = createAgentControlAssetService({
    config: { COLLAB_MAX_UPLOAD_BYTES: 1024 * 1024 },
    database,
    uploadManager: {
      ingestFile: async (_source, input, context) => {
        ingestCalls += 1;
        assert.equal(input.removeSource, false);
        assert.equal(context.sourceKind, 'agent-control');
        return {
          asset: {
            id: 'asset-imported',
            projectId: 'project-local',
            kind: 'image',
            filename: input.filename,
            contentHash: input.sha256,
            managedPath: 'C:\\secret\\asset-imported.png',
          },
          deduplicated: false,
          idempotentReplay: false,
        };
      },
    },
  });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/agent-control/v1', agentControlRoute.createAgentControlRouter({
    auth,
    approvals,
    assetService,
    config: {
      PORT: 19030,
      APP_VERSION: '2.6.4',
      BACKEND_INSTANCE_ID: 'a'.repeat(43),
    },
    database,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const session = issueSession(auth, ['asset:read', 'asset:transfer']);
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const searched = await request(server, {
    path: '/api/agent-control/v1/assets?projectId=project-local&canvasId=canvas-a',
    headers,
  });
  assert.equal(searched.status, 200);
  assert.equal(searched.body.data.items[0].id, 'asset-existing');
  assert.equal(JSON.stringify(searched.body).includes(root), false);

  const created = await request(server, {
    method: 'POST',
    path: '/api/agent-control/v1/asset-import-approvals',
    headers,
  }, {
    projectId: 'project-local',
    canvasId: 'canvas-a',
    filePath: filename,
    operationId: 'import-operation-a',
  });
  assert.equal(created.status, 202);
  assert.equal(created.body.data.preview.file.name, '角色 & 参考.png');
  assert.equal(created.body.data.preview.providerTransfer.occursNow, false);
  assert.equal(JSON.stringify(created.body).includes(root), false);

  const pending = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${created.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: created.body.data.pollSecret });
  assert.equal(pending.body.data.status, 'pending');
  assert.equal(ingestCalls, 0);

  approvals.approve(created.body.data.approvalRequestId);
  const completed = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${created.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: created.body.data.pollSecret });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.asset.id, 'asset-imported');
  assert.equal(ingestCalls, 1);
  assert.equal(JSON.stringify(completed.body).includes('C:\\secret'), false);

  const duplicate = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${created.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: created.body.data.pollSecret });
  assert.equal(duplicate.status, 404);
  assert.equal(ingestCalls, 1);

  const changed = await request(server, {
    method: 'POST',
    path: '/api/agent-control/v1/asset-import-approvals',
    headers,
  }, {
    projectId: 'project-local',
    canvasId: 'canvas-a',
    filePath: filename,
    operationId: 'import-operation-b',
  });
  approvals.approve(changed.body.data.approvalRequestId);
  fs.writeFileSync(filename, pngBytes('version-b'));
  const rejected = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${changed.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: changed.body.data.pollSecret });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'ASSET_IMPORT_FILE_CHANGED');
  assert.equal(ingestCalls, 1);

  const target = path.join(root, '导出 & 角色.png');
  const download = await request(server, {
    method: 'POST',
    path: '/api/agent-control/v1/asset-download-approvals',
    headers,
  }, {
    projectId: 'project-local',
    canvasId: 'canvas-a',
    assetId: 'asset-existing',
    targetPath: target,
    operationId: 'download-operation-a',
  });
  assert.equal(download.status, 202);
  assert.equal(download.body.data.preview.file.name, '导出 & 角色.png');
  assert.equal(download.body.data.preview.file.sha256, managedHash);
  assert.equal(JSON.stringify(download.body).includes(root), false);
  assert.equal(fs.existsSync(target), false);

  approvals.approve(download.body.data.approvalRequestId);
  const downloaded = await request(server, {
    method: 'POST',
    path: `/api/agent-control/v1/approvals/${download.body.data.approvalRequestId}/complete`,
    headers,
  }, { pollSecret: download.body.data.pollSecret });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.body.data.assetId, 'asset-existing');
  assert.equal(downloaded.body.data.sha256, managedHash);
  assert.deepEqual(fs.readFileSync(target), managedBytes);
});
