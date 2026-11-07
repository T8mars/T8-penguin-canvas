import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialSetBackup, materialSetItemFromMedia, normalizeMaterialSetItems, parseMaterialSetBackup, type MaterialSetItem } from '../src/utils/materialSet.ts';
import { materialSetUpstreamKey, syncMaterialSetUpstream } from '../src/utils/materialSetUpstream.ts';

const source = (id: string, url = `/${id}.png`) => ({ id, sourceNodeId: 'group', kind: 'image' as const, url, label: id });
test('group removal removes collected upstream items while preserving local files and stable item IDs', () => {
  const local = materialSetItemFromMedia('image', { url: '/manual.png' });
  const collected = syncMaterialSetUpstream([local], [source('a'), source('b')]);
  const aId = collected[1].id;
  const next = syncMaterialSetUpstream(collected, [source('a')]);
  assert.deepEqual(next.map((item) => item.url), ['/manual.png', '/a.png']);
  assert.equal(next[1].id, aId);
  assert.deepEqual(syncMaterialSetUpstream(next, []), [local]);
});
test('same-URL ordered occurrences stay independent and removal is by source occurrence identity', () => {
  const collected = syncMaterialSetUpstream([], [source('slot-a', '/same.png'), source('slot-b', '/same.png')]);
  assert.equal(collected.length, 2);
  const next = syncMaterialSetUpstream(collected, [source('slot-b', '/same.png')]);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, collected[1].id);
});
test('manual ordering and metadata survive source refresh and save/reopen/backup', () => {
  const collected = syncMaterialSetUpstream([], [source('a'), source('b')]);
  collected.reverse(); collected[0].name = 'My label';
  const stored = normalizeMaterialSetItems(JSON.parse(JSON.stringify(collected)), 'image');
  const backup = parseMaterialSetBackup(createMaterialSetBackup('image', stored))!;
  const next = syncMaterialSetUpstream(backup.materialSetItems, [source('a'), source('b', '/b-new.png')]);
  assert.deepEqual(next.map((item) => item.id), collected.map((item) => item.id));
  assert.equal(next[0].url, '/b-new.png'); assert.equal(next[0].name, 'My label');
});
test('legacy adoption is explicit, never treats a manual same-URL upload as upstream, and preserves unknown history', () => {
  const legacy: MaterialSetItem = {id:'legacy',kind:'image',url:'/a.png'};
  const unknown: MaterialSetItem = {id:'unknown',kind:'image',url:'/old.png'};
  const local = materialSetItemFromMedia('image', {url:'/a.png'});
  const adopted = syncMaterialSetUpstream([legacy,unknown,local], [source('a')], {adoptLegacy:true});
  assert.equal(adopted.length, 3);assert.equal(adopted[0].id,'legacy');assert.ok(adopted[0].upstreamSource);
  assert.deepEqual(syncMaterialSetUpstream(adopted, []), [unknown,local]);
  assert.equal(syncMaterialSetUpstream([legacy], [source('a')]).length, 2);
});
test('manual removal suppression prevents automatic resurrection; explicit recollection can restore it', () => {
  const collected = syncMaterialSetUpstream([], [source('a')]);
  const excluded = [materialSetUpstreamKey(collected[0].upstreamSource!)];
  assert.deepEqual(syncMaterialSetUpstream([], [source('a')], {excluded}), []);
  assert.equal(syncMaterialSetUpstream([], [source('a')]).length, 1);
});
test('text/video/audio material collections use the same reconciliation contract', () => {
  for(const kind of ['text','video','audio'] as const){
    const input=[{...source('a'),kind},{...source('b'),kind}];
    const next=syncMaterialSetUpstream(syncMaterialSetUpstream([],input),input.slice(1));
    assert.equal(next.length,1);assert.equal(next[0].kind,kind);
    assert.equal(kind==='text'?next[0].text:next[0].url,'/b.png');
  }
});
