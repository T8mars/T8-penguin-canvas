import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVolcengineAssetsNodeOutput,
  migrateLegacyVolcengineAssetNodes,
  normalizeVolcengineAssetImportJobs,
  normalizeVolcengineAssetItems,
  normalizeVolcengineAssetGroups,
  normalizePersistedVolcengineAssets,
} from '../src/utils/volcengineAssets.ts';
import { selectSourceHandleData } from '../src/utils/sourceHandleData.ts';

test('Volcengine asset responses normalize both Result.Items and nested Asset shapes', () => {
  assert.deepEqual(normalizeVolcengineAssetGroups({ Result: { Items: [{ Id: 'g1', Name: 'Group' }] } }), [
    { id: 'g1', name: 'Group', description: '' },
  ]);
  assert.deepEqual(normalizeVolcengineAssetItems({ Result: { Items: [
    { Id: 'a1', Name: 'Still', AssetType: 'Image', Status: 'Active', TosUrl: 'https://preview/image' },
    { Asset: { Id: 'a2', Name: 'Clip', Type: 'Video', Status: 'Processing', PreviewUrl: 'https://preview/video' } },
  ] } }), [
    { id: 'a1', name: 'Still', kind: 'image', status: 'active', assetUri: 'asset://a1', previewUrl: 'https://preview/image', tags: [] },
    { id: 'a2', name: 'Clip', kind: 'video', status: 'processing', assetUri: 'asset://a2', previewUrl: 'https://preview/video', tags: [] },
  ]);
});

test('Volcengine selection emits no temporary preview URLs, only active typed asset URIs, bounded to 15', () => {
  const assets = Array.from({ length: 18 }, (_, index) => ({
    id: `asset-${index}`,
    name: `Asset ${index}`,
    kind: index % 3 === 0 ? 'image' : index % 3 === 1 ? 'video' : 'audio',
    status: index === 2 ? 'processing' : 'active',
    assetUri: `asset://asset-${index}`,
    previewUrl: `https://signed.example/${index}?secret=yes`,
    tags: ['tag'],
  })) as any;
  const output = buildVolcengineAssetsNodeOutput(assets);
  assert.equal(output.selectedAssets.length, 15);
  assert.equal(output.selectedAssets[2].status, 'processing');
  assert.equal(JSON.stringify(output).includes('signed.example'), false);
  assert.equal(output.outputs.audio.audioUrls.includes('asset://asset-2'), false);
  assert.deepEqual(output.outputs.image.imageUrls, ['asset://asset-0', 'asset://asset-3', 'asset://asset-6', 'asset://asset-9', 'asset://asset-12']);
  assert.deepEqual(selectSourceHandleData(output, new Set(['video'])), [output.outputs.video]);
  assert.deepEqual(selectSourceHandleData(output, new Set(['audio'])), [output.outputs.audio]);
});

test('Volcengine import jobs normalize bounded safe fields and legacy PR nodes migrate to the stable core node', () => {
  const jobs = normalizeVolcengineAssetImportJobs({ jobs: [{
    id: 'volcjob-safe-1234', profileId: 'volcengine', projectName: 'demo', kind: 'Video',
    assetId: 'asset-AbC', status: 'Processing', requestId: 'request-1', sourceUrl: 'https://signed.example/secret',
  }] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'processing');
  assert.equal(JSON.stringify(jobs).includes('signed.example'), false);

  const migrated = migrateLegacyVolcengineAssetNodes([{
    id: 'legacy-volc', type: 'volc-asset', position: { x: 10, y: 20 },
    data: {
      profileId: 'volcengine-profile', projectName: 'project-a', groupId: 'group-a',
      assetId: 'asset-AbC', assetUri: 'Asset://asset-AbC', kind: 'video', tags: ['hero'],
    },
  }] as any);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.nodes[0].type, 'volcengine-assets');
  assert.equal((migrated.nodes[0].data as any).volcengineAssetsProfileId, 'volcengine-profile');
  assert.equal((migrated.nodes[0].data as any).selectedAssets[0].assetUri, 'asset://asset-AbC');
  assert.deepEqual((migrated.nodes[0].data as any).outputs.video.videoUrls, ['asset://asset-AbC']);
});

test('legacy PR asset status survives migration and persisted reloads cannot promote unfinished assets', () => {
  const migrated = migrateLegacyVolcengineAssetNodes([{
    id: 'legacy-processing', type: 'volc-asset', position: { x: 0, y: 0 },
    data: {
      projectName: 'demo',
      selectedAssets: [
        { id: 'asset-processing', assetUri: 'Asset://asset-processing', kind: 'image', status: 'Processing' },
        { id: 'asset-failed', assetUri: 'asset://asset-failed', kind: 'video', status: 'Failed' },
        { id: 'asset-active', assetUri: 'asset://asset-active', kind: 'audio', status: 'Active' },
      ],
    },
  }] as any);
  const data = migrated.nodes[0].data as any;
  assert.deepEqual(data.selectedAssets.map((item: any) => item.status), ['processing', 'failed', 'active']);
  assert.deepEqual(data.outputs.image.imageUrls, []);
  assert.deepEqual(data.outputs.video.videoUrls, []);
  assert.deepEqual(data.outputs.audio.audioUrls, ['asset://asset-active']);

  const reloaded = normalizePersistedVolcengineAssets(data.selectedAssets);
  assert.deepEqual(reloaded.map((item) => item.status), ['processing', 'failed', 'active']);
  assert.deepEqual(buildVolcengineAssetsNodeOutput(reloaded).audioUrls, ['asset://asset-active']);
});
