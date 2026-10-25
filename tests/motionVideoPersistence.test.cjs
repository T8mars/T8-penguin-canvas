'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { ProjectDatabase } = require('../backend/src/services/projectDatabase');
const { AssetIndexer } = require('../backend/src/services/assetIndexer');
const { AssetBlobStore } = require('../backend/src/services/assetBlobStore');
const { listGenerationHistory } = require('../backend/src/services/generationHistory');
const { commitMaterializedOutputBuffer } = require('../backend/src/services/materializedOutputStore');
const { writeMotionVideoMetadata, readMotionVideoMetadata } = require('../backend/src/services/motionVideoMetadata');
const { RunRecoveryManager } = require('../backend/src/services/runRecovery');
const { resolveBundledFfmpeg } = require('../backend/src/providers/llmMedia');
const connectionRef = `seedance-nz:${'a'.repeat(64)}`, model = 'zhenzhen/motion-video';
test('real temporary video, auxiliary receipt, recovery and history survive close/reopen without generation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-motion-persistence-'));
  let db;
  t.after(async () => { await db?.close(); const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(directory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(directory, { recursive: true, force: true }); });
  const config = { INPUT_DIR: path.join(directory, 'input'), OUTPUT_DIR: path.join(directory, 'output'), ASSET_BLOB_DIR: path.join(directory, 'cas'), ASSET_INDEX_STABILITY_ATTEMPTS: 1 };
  fs.mkdirSync(config.INPUT_DIR); fs.mkdirSync(config.OUTPUT_DIR);
  const fixture = path.join(directory, 'fixture.mp4');
  execFileSync(resolveBundledFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:r=12:d=0.5', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', fixture], { windowsHide: true });
  const media = commitMaterializedOutputBuffer({ outputDir: config.OUTPUT_DIR, buffer: fs.readFileSync(fixture), prefix: 'motion', extension: 'mp4', materializationKey: 'test-original' });
  const result = { schema: 't8-motion-video-result-v1', model, taskId: 'original-task', connectionRef,
    storyboard: { scenes: [{ id: 's1', duration: 15, title: 'hello' }] }, fallbackScenes: ['s1'], warnings: [] };
  const sourceUrl = `/files/output/${media.filename}`;
  assert.equal(writeMotionVideoMetadata(config.OUTPUT_DIR, sourceUrl, result), true);
  const recovery = { kind: 'motion', model, taskId: result.taskId, connectionRef, pollIntervalMs: 3000, maxPolls: 400 };
  assert.deepEqual(JSON.parse(JSON.stringify(readMotionVideoMetadata(config.OUTPUT_DIR, media.filePath, media.sha256, recovery))), result);
  for (const changed of [{ taskId: 'other' }, { model: 'other' }, { connectionRef: `seedance-nz:${'b'.repeat(64)}` }]) {
    assert.equal(readMotionVideoMetadata(config.OUTPUT_DIR, media.filePath, media.sha256, { ...recovery, ...changed }), null);
  }
  assert.equal(readMotionVideoMetadata(config.OUTPUT_DIR, media.filePath, 'b'.repeat(64), recovery), null);
  assert.equal(writeMotionVideoMetadata(config.OUTPUT_DIR, sourceUrl, { ...result, storyboard: { scenes: Array.from({ length: 100 }, () => ({ text: 'x'.repeat(16000) })) } }), true);
  const oversized = readMotionVideoMetadata(config.OUTPUT_DIR, media.filePath, media.sha256, recovery);
  assert.equal(oversized.schema, result.schema); assert.equal(oversized.storyboard, null);
  assert.ok(oversized.warnings.includes('metadata_truncated')); assert.deepEqual(oversized.fallbackScenes, []);
  assert.equal(writeMotionVideoMetadata(config.OUTPUT_DIR, sourceUrl, result), true);
  const filename = path.join(directory, 'project.sqlite3'); db = new ProjectDatabase(filename);
  const scope = { projectId: 'motion-project', canvasId: 'motion-canvas' }, nodeId = 'animation';
  const node = { id: nodeId, entityUid: randomUUID(), type: 'code-animation', position: { x: 0, y: 0 }, data: { model, prompt: 'next draft' } };
  const canvas = db.ensureCanvas(scope.canvasId, { nodes: [node], edges: [] }, scope.projectId);
  const run = db.createRun({ ...scope, canvasRevision: canvas.revision, status: 'running' });
  const input = { schema: 't8-motion-video-input-v1', prompt: 'original prompt', request: { model, operation: 'generate', prompt: 'original prompt', duration: 15, ratio: '16:9', resolution: '720p' }, baseVersionId: null, ancestorQuality: [] };
  const capturedNode = { id: nodeId, type: node.type, position: node.position, data: { prompt: 'local draft', historyResolvedInput: input } };
  const nodeRun = db.createNodeRun({ runId: run.id, nodeId, status: 'polling', inputSnapshot: { node: capturedNode },
    historyInputSnapshot: { schema: 't8-generation-settings-input-v1', purpose: 'prefill-only', complete: true, credentialsOmitted: false,
      node: capturedNode, upstreamNodes: [], incomingEdges: [] } });
  const attempt = db.createAttempt({ nodeRunId: nodeRun.id, provider: 'seedance-nz', model, upstreamTaskId: result.taskId, status: 'polling', metadata: { recovery } });
  await db.close(); db = new ProjectDatabase(filename);
  assert.deepEqual(db.getAttempt(attempt.id).metadata.recovery, recovery);
  const indexer = new AssetIndexer(config, db, { blobStore: new AssetBlobStore(config.ASSET_BLOB_DIR) });
  let queries = 0;
  const manager = new RunRecoveryManager({ database: db, baseUrl: 'http://127.0.0.1:1', wait: async () => {},
    queryRecovery: async ticket => { queries++; return { state: 'succeeded', outputs: [0, 1].map(outputOrdinal => ({ kind: 'video', sourceUrl, outputOrdinal })), usage: null, error: null, providerStatus: 'succeeded' }; },
    commitRunOutputArtifacts: request => {
      assert.equal(db.getAttempt(attempt.id).metadata.recovery.connectionRef, connectionRef);
      assert.ok(readMotionVideoMetadata(config.OUTPUT_DIR, media.filePath, media.sha256, db.getAttempt(attempt.id).metadata.recovery));
      return indexer.commitHostRunOutputAssets(request);
    } });
  const report = await manager.recoverPendingRuns(); assert.equal(report.recovered, 1); assert.equal(queries, 1);
  const completed = db.getNodeRun(nodeRun.id); assert.equal(completed.outputRefs.length, 2);
  const summary = listGenerationHistory(db, { ...scope, nodeId });
  const history = listGenerationHistory(db, { ...scope, nodeId, groupId: summary.groups[0].id, includeInput: true });
  assert.equal(history.groups.length, 1); assert.equal(history.groups[0].outputs.length, 2);
  assert.deepEqual(history.groups[0].inputArchive.snapshot.node.data.historyResolvedInput, input);
  const savedAsset = db.getAsset(history.groups[0].outputs[0].assetId);
  assert.deepEqual(savedAsset.metadata.motionResult, result);
  assert.equal(db.getAttempt(attempt.id).upstreamTaskId, result.taskId);
  await db.close(); db = new ProjectDatabase(filename);
  assert.deepEqual(db.getAsset(savedAsset.id).metadata.motionResult, result);
  assert.equal(listGenerationHistory(db, scope).groups.length, 1);
});
