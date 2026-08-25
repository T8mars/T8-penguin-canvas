import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVolcengineAssetsNodeOutput,
  normalizeVolcengineAssetItems,
  normalizeVolcengineAssetGroups,
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
  assert.equal(JSON.stringify(output).includes('signed.example'), false);
  assert.equal(JSON.stringify(output).includes('asset://asset-2'), false);
  assert.deepEqual(output.outputs.image.imageUrls, ['asset://asset-0', 'asset://asset-3', 'asset://asset-6', 'asset://asset-9', 'asset://asset-12', 'asset://asset-15']);
  assert.deepEqual(selectSourceHandleData(output, new Set(['video'])), [output.outputs.video]);
  assert.deepEqual(selectSourceHandleData(output, new Set(['audio'])), [output.outputs.audio]);
});
