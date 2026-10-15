import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import type { RunDetail } from '../src/types/project.ts';
import { captureRunNodeInputSnapshot, buildRunOriginalReplayRuntime } from '../src/utils/runReplay.ts';
import { inferRunRecoveryDescriptor } from '../src/utils/runRecovery.ts';

test('world capture retains frozen scene identity/camera in existing replay and never invents a Provider recovery task', () => {
  const source = { id: 'scene-slot', url: '/files/input/room.spz', format: 'spz', name: 'Room', assetId: 'asset-a', assetEntityUid: 'uid-a', contentRevision: 3, contentHash: 'a'.repeat(64) };
  const project = { schema: 't8-world-scene-v1', sources: [source], activeSourceId: source.id, camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 55 }, views: [] };
  const node: Node = { id: 'world', type: 'world-scene', position: { x: 10, y: 20 }, data: { worldSceneProject: project, sourceAssetId: source.assetId, worldSceneSource: source, status: 'success', imageUrl: '/files/output/old.png' } };
  const frozenProject = structuredClone(project), snapshot = captureRunNodeInputSnapshot([node], [], node.id);
  assert.equal(snapshot.replayable, true);
  project.camera.position[0] = 999; source.contentRevision = 9;
  const run = { id: 'old-run', projectId: 'project-default', canvasId: 'canvas-a', canvasRevision: 7, status: 'failed', createdAt: 1,
    summary: { plannedNodeIds: [node.id], plannedEdges: [] }, nodeRuns: [{ id: 'old-node-run', runId: 'old-run', nodeId: node.id, subflowPath: [], status: 'failed', inputSnapshot: snapshot, outputRefs: [], createdAt: 1, updatedAt: 2 }],
  } as unknown as RunDetail;
  const runtime = buildRunOriginalReplayRuntime(run, [node.id], 'world-replay');
  assert.equal(runtime.executionNodeIds.length, 1);
  const replay = runtime.nodes.find(item => item.type === 'world-scene')!;
  assert.deepEqual(replay.data.worldSceneProject, frozenProject); assert.equal(replay.data.sourceAssetId, 'asset-a');
  assert.equal(inferRunRecoveryDescriptor({ nodeType: 'world-scene', nodeData: node.data }), null, 'Local capture cannot acquire a fabricated remote submission/recovery identity');
});
