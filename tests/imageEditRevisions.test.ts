import test from 'node:test';
import assert from 'node:assert/strict';
import { collectImageEditRevisions, createImageEditLineage } from '../src/utils/imageEditRevisions.ts';
test('existing output nodes form recoverable edit versions without replacing originals', () => {
  const first = createImageEditLineage('/original.png', '/original.png', 'crop');
  const second = createImageEditLineage('/original.png', '/crop.png', 'brush');
  const nodes = [{ data: { imageUrl: '/crop.png', imageEditLineage: first } }, { data: { directImageUrl: '/brush.png', imageEditLineage: second } }];
  const before = JSON.stringify(nodes);
  const revisions = collectImageEditRevisions(nodes, '/brush.png');
  assert.deepEqual(revisions.map((r) => r.url), ['/original.png', '/crop.png', '/brush.png']);
  assert.equal(revisions[2].lineage?.parentUrl, '/crop.png');
  assert.equal(JSON.stringify(nodes), before);
  assert.deepEqual(collectImageEditRevisions(JSON.parse(before), '/brush.png'), revisions);
  assert.deepEqual(collectImageEditRevisions([...nodes].reverse(), '/brush.png').map((r) => r.url), revisions.map((r) => r.url));
});
test('unrelated images do not enter another image revision list and copied revision IDs stay idempotent', () => {
  const lineage = createImageEditLineage('/a.png', '/a.png', 'crop');
  const node = { data: { imageUrl: '/a-crop.png', imageEditLineage: lineage } };
  assert.equal(collectImageEditRevisions([node, node], '/a-crop.png').length, 2);
  assert.deepEqual(collectImageEditRevisions([node], '/other.png').map((r) => r.url), ['/other.png']);
});
