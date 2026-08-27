import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('Volcengine Assets keeps selections in one in-node tray with remove and clear controls', () => {
  const node = read('src/components/nodes/VolcengineAssetsNode.tsx');
  const dataUtils = read('src/utils/volcengineAssets.ts');

  assert.match(node, /data-volcengine-selected-assets/);
  assert.match(node, /selectedAssets\.map\(\(asset\)/);
  assert.match(node, /removeSelectedAsset\(asset\.id\)/);
  assert.match(node, /onClick=\{clearSelectedAssets\}/);
  assert.match(node, /setPreviewById/);
  assert.match(dataUtils, /previewUrl: ''/m, 'persisted selections must continue stripping signed previews');
});

test('Volcengine Assets does not auto-materialize one Output node per selected asset and safely cleans stale ones', () => {
  const canvas = read('src/components/Canvas.tsx');

  assert.match(
    canvas,
    /const SKIP_TYPES = new Set\(\[[^\]]*'volcengine-assets'[^\]]*\]\);/,
  );
  assert.match(
    canvas,
    /source\?\.type === 'random-route' \|\| source\?\.type === 'story' \|\| source\?\.type === 'volcengine-assets'/,
  );
  assert.match(canvas, /target\.id\.startsWith\('output-auto-'\)/);
  assert.match(canvas, /td\.userMoved !== true/);
  assert.match(canvas, /!hasOutgoing/);
});

test('Volcengine local import uses the controlled local upload, configured relay, then CreateAsset chain', () => {
  const node = read('src/components/nodes/VolcengineAssetsNode.tsx');
  const local = node.indexOf('api.uploadResourceLocalFile(localFile');
  const relay = node.indexOf('api.uploadCloudAsset({', local);
  const volcengine = node.indexOf('api.importVolcengineAsset({', relay);

  assert.ok(local >= 0, 'missing controlled local upload');
  assert.ok(relay > local, 'relay upload must follow local upload');
  assert.ok(volcengine > relay, 'Volcengine import must use the relay result');
  assert.match(node, /url: relayed\.data\.url/);
  assert.match(node, /volcengineAssetsRelayTargetId/);
  assert.doesNotMatch(node, /secretAccessKey|accessKeySecret|secretKey/);

  const schema = JSON.parse(read('backend/src/shared/canvasNodeSchema.json'));
  const definition = schema.types.find((item: any) => item.type === 'volcengine-assets');
  assert.equal(definition.generation.allowedDataFields.volcengineAssetsRelayTargetId.type, 'string');
  assert.equal(definition.generation.defaults.volcengineAssetsRelayTargetId, '');
});
