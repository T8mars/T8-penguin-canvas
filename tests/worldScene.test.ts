import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUpstreamWorldScenes, normalizeWorldScene, normalizeWorldCamera, worldSceneFormat } from '../src/utils/worldScene.ts';
import { prepareGaussianSceneBytes } from '../src/utils/gaussianSceneBytes.ts';
test('world scene formats are explicit and do not pretend mesh GLB is a Gaussian scene', () => {
  assert.equal(worldSceneFormat('example.SPZ?download=1'), 'spz');
  assert.equal(worldSceneFormat('cloud.ply'), 'ply');
  assert.equal(worldSceneFormat('mesh.glb'), null);
  assert.equal(worldSceneFormat('project.zip'), null);
});
test('world project restores stable sources, named camera views and local asset URLs', () => {
  const raw = { sources: [{ id: 'scene1', url: '/files/input/world.spz', name: 'World', format: 'spz' }], activeSourceId: 'scene1',
    camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 65 }, views: [{ id: 'view1', name: 'Hero', camera: { position: [4, 1, 3], target: [0, 1, 0], fov: 40 } }] };
  const first = normalizeWorldScene(raw);
  assert.deepEqual(normalizeWorldScene(JSON.parse(JSON.stringify(first))), first);
  assert.equal(first.views[0].id, 'view1'); assert.equal(first.sources[0].url, raw.sources[0].url);
});

test('world scene source pins and individual camera states survive serialization and ordered duplicates', () => {
  const source = { id: 'stable-slot', url: '/api/resources/file/res_123', name: 'Room', format: 'spz', assetId: 'asset-1', assetEntityUid: 'asset-uid', contentRevision: 3, contentHash: 'b'.repeat(64) };
  const camera = { position: [1, 2, 3], target: [0, 0, 0], fov: 40 };
  const project = normalizeWorldScene({ sources: [source, { ...source, id: 'second-slot' }], activeSourceId: 'stable-slot', camera, cameras: { old: camera } });
  assert.equal(project.sources.length, 2);
  assert.deepEqual(project.sources[0], source);
  assert.deepEqual(project.cameras['stable-slot'], camera);
  assert.deepEqual(project.cameras.old, camera);
  assert.deepEqual(normalizeWorldScene(JSON.parse(JSON.stringify(project))), project);
  const upstream = collectUpstreamWorldScenes('node-a', { worldSceneSource: source });
  assert.equal(upstream[0].id, 'upstream:node-a:stable-slot');
  assert.equal(upstream[0].assetId, source.assetId);
  assert.equal(upstream[0].contentRevision, 3);
});
test('invalid camera coordinates and source protocols are rejected without executing imported content', () => {
  assert.equal(normalizeWorldCamera({ position: [Infinity, 0, 1], target: [0, 0, 0], fov: 60 }), null);
  assert.equal(normalizeWorldCamera({ position: [0, 0, 0], target: [0, 0, 0], fov: 60 }), null);
  assert.deepEqual(normalizeWorldScene({ sources: [{ id: 'bad', url: 'javascript:alert(1)', format: 'spz' }], activeSourceId: 'bad' }).sources, []);
});
test('ASCII PLY is converted automatically with correct binary scalar values', async () => {
  const text = 'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n1.5 -2 3 255\n';
  const bytes = await prepareGaussianSceneBytes(new TextEncoder().encode(text).buffer);
  const result = new TextDecoder().decode(bytes);
  assert.match(result, /format binary_little_endian 1.0/);
  const start = result.indexOf('end_header\n') + 11;
  const data = new DataView(bytes, start);
  assert.equal(data.getFloat32(0, true), 1.5); assert.equal(data.getFloat32(4, true), -2); assert.equal(data.getUint8(12), 255);
});
test('PLY conversion rejects impossible counts, non-finite values and supports cancellation', async () => {
  const encode = (body: string) => new TextEncoder().encode(body).buffer;
  const header = 'ply\nformat ascii 1.0\nelement vertex 999999999\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
  await assert.rejects(prepareGaussianSceneBytes(encode(header + '0 0 0')), /truncated/);
  await assert.rejects(prepareGaussianSceneBytes(encode(header.replace('999999999', '1') + 'NaN 0 0')), /Invalid PLY/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareGaussianSceneBytes(encode('anything'), controller.signal));
});
test('upstream scenes preserve slot identity and opaque local resource formats without treating mesh GLB as splats', () => {
  assert.deepEqual(collectUpstreamWorldScenes('a', { modelUrl: '/mesh.glb' }), []);
  const sources = collectUpstreamWorldScenes('b', { worldSceneUrl: '/api/resources/file/res_123', worldSceneFormat: 'spz', fileName: 'Room' });
  assert.equal(sources[0].id, 'upstream:b:0'); assert.equal(sources[0].format, 'spz');
  assert.equal(normalizeWorldScene({ activeSourceId: sources[0].id }).activeSourceId, sources[0].id);
});
