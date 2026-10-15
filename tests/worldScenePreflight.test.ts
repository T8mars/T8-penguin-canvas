import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import type { ApiSettings } from '../src/types/canvas.ts';
import { EXECUTABLE_NODE_TYPES } from '../src/config/executableNodeTypes.ts';
import { buildRunPreflightDiagnostics, collectRunPreflightAssetIds } from '../src/utils/runPreflightContext.ts';
import { prepareRunAction } from '../src/utils/runPreflight.ts';

const world: Node = { id: 'world', type: 'world-scene', position: { x: 0, y: 0 }, data: {
  sourceAssetId: 'real-world-asset', worldSceneSource: { id: 'slot', assetId: 'real-world-asset', url: '/files/input/room.ply', format: 'ply' },
} };
function preview(availability: string) {
  return prepareRunAction({ actionKind: 'run-single', projectId: 'project', canvasId: 'canvas', currentRevision: 7, expectedRevision: 7,
    nodes: [world], edges: [], selectedNodeIds: [world.id], cost: { known: true, amount: 0, currency: 'CNY' }, hostContextDigest: 'sha256:' + 'a'.repeat(64),
    diagnostics: buildRunPreflightDiagnostics({ nodes: [world], edges: [], executionNodeIds: [world.id], projectId: 'project', settings: {} as ApiSettings,
      providersComplete: true, assets: [{ id: 'real-world-asset', kind: 'model3d', projectId: 'project', availability }], policy: null }),
  });
}
test('local world capture enters the normal executable and AssetRef preflight without a world-generation key', () => {
  assert.ok(EXECUTABLE_NODE_TYPES.has('world-scene'));
  assert.deepEqual(collectRunPreflightAssetIds([world]), ['real-world-asset']);
  const current = preview('available'); assert.equal(current.status, 'ready'); assert.deepEqual(current.blockers, []);
});
test('missing/corrupt/unverified world source bytes are rejected by ordinary preflight, not bypassed for local capture', () => {
  for (const state of ['missing', 'corrupt', 'unverified']) assert.equal(preview(state).status, 'blocked', state);
});
