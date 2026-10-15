import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeMoodboard, moveMoodboardCards, normalizeMoodboard, updateMoodboardCards, moodboardVisibleIds } from '../src/utils/materialMoodboard.ts';
import { createMaterialSetBackup, parseMaterialSetBackup } from '../src/utils/materialSet.ts';

const items = [
  { id: 'slot-a', kind: 'image', url: '/same.png', name: 'A' },
  { id: 'slot-b', kind: 'image', url: '/same.png', name: 'B' },
];
test('moodboard stores layout only and preserves ordered duplicate source slots', () => {
  const original = JSON.stringify(items);
  const layout = normalizeMoodboard(null, items);
  assert.deepEqual(Object.keys(layout.cards), ['slot-a', 'slot-b']);
  assert.ok(!JSON.stringify(layout).includes('/same.png'));
  assert.equal(JSON.stringify(items), original);
  const changed = moveMoodboardCards(layout, ['slot-b'], 300, 50);
  assert.deepEqual(Object.keys(changed.cards), ['slot-a', 'slot-b']);
  assert.deepEqual(changed.cards['slot-a'], layout.cards['slot-a']);
});
test('layout preview preserves rotations and locked cards and does not mutate the draft', () => {
  let layout = normalizeMoodboard(null, items);
  layout = updateMoodboardCards(layout, ['slot-a'], { rotation: 45, w: 360, group: 'look' });
  layout = updateMoodboardCards(layout, ['slot-b'], { locked: true });
  const original = JSON.stringify(layout);
  const preview = arrangeMoodboard(layout, ['slot-a', 'slot-b']);
  assert.equal(JSON.stringify(layout), original);
  assert.deepEqual(preview.cards['slot-b'], layout.cards['slot-b']);
  assert.equal(preview.cards['slot-a'].rotation, 45);
  assert.equal(preview.cards['slot-a'].w, 360);
  assert.equal(preview.cards['slot-a'].group, 'look');
});
test('missing references keep their layout after reopen and new cards do not overlap existing rows', () => {
  const first = normalizeMoodboard(null, items);
  const restored = normalizeMoodboard(JSON.parse(JSON.stringify(first)), [items[1], { id: 'new' }]);
  assert.deepEqual(restored.cards['slot-a'], first.cards['slot-a']);
  assert.ok(restored.cards.new.y > first.cards['slot-b'].y + first.cards['slot-b'].h);
});
test('hiding a projection never removes its card or changes input assets', () => {
  const first = normalizeMoodboard(null, items);
  const hidden = updateMoodboardCards(first, ['slot-a'], { hidden: true });
  assert.deepEqual(moodboardVisibleIds(hidden), ['slot-b']);
  assert.ok(hidden.cards['slot-a']);
  assert.equal(items.length, 2);
  const restored = updateMoodboardCards(hidden, ['slot-a'], { hidden: false });
  assert.deepEqual(moodboardVisibleIds(restored), ['slot-a', 'slot-b']);
});
test('invalid values, prototype-shaped IDs and malformed persistence cannot inject a prototype', () => {
  const raw = JSON.parse('{"schema":"t8-material-moodboard-v1","cards":{"__proto__":{"x":null,"w":-1,"group":123},"old":{"x":1e200,"y":-3,"rotation":"45"}}}');
  const normalized = normalizeMoodboard(raw, []);
  assert.ok(Object.hasOwn(normalized.cards, '__proto__'));
  assert.equal(normalized.cards.__proto__.x, 24);
  assert.equal(normalized.cards.__proto__.w, 100);
  assert.equal(normalized.cards.old.x, 100000);
  assert.equal(normalized.cards.old.y, 0);
  assert.equal(normalized.cards.old.rotation, 0);
  assert.equal(({} as any).x, undefined);
});

test('restore all recovers hidden locked cards without allowing a transform', () => {
  const hidden = updateMoodboardCards(normalizeMoodboard(null, items), ['slot-a'], { hidden: true, locked: true });
  const restored = updateMoodboardCards(hidden, ['slot-a'], { hidden: false, x: 800, rotation: 90 });
  assert.equal(restored.cards['slot-a'].hidden, false);
  assert.equal(restored.cards['slot-a'].locked, true);
  assert.equal(restored.cards['slot-a'].x, hidden.cards['slot-a'].x);
  assert.equal(restored.cards['slot-a'].rotation, hidden.cards['slot-a'].rotation);
});
test('moving selection against an edge preserves relative positions and ignores locked items', () => {
  const first = normalizeMoodboard(null, items);
  const moved = moveMoodboardCards(first, ['slot-a', 'slot-b'], -1000, -1000);
  assert.equal(moved.cards['slot-a'].x, 0);
  assert.equal(moved.cards['slot-b'].x - moved.cards['slot-a'].x, 244);
  const locked = updateMoodboardCards(first, ['slot-a'], { locked: true });
  assert.deepEqual(moveMoodboardCards(locked, ['slot-a'], 100, 100).cards['slot-a'], locked.cards['slot-a']);
});
test('viewport culling limits mounted media without dropping stored layout', () => {
  const layout = normalizeMoodboard(null, Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })));
  assert.ok(moodboardVisibleIds(layout, { x: 0, y: 0, w: 600, h: 400 }).length < 30);
  assert.equal(Object.keys(layout.cards).length, 1000);
});
test('material-set export/import keeps layout without changing legacy v1 backups', () => {
  const before = JSON.stringify(items);
  const layout = updateMoodboardCards(normalizeMoodboard(null, items), ['slot-a'], { x: 520, rotation: 30, group: 'scene' });
  const saved = createMaterialSetBackup('image', items as any, 'Board', layout);
  const restored = parseMaterialSetBackup(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored?.materialMoodboard, layout);
  assert.equal(JSON.stringify(items), before);
  assert.equal(parseMaterialSetBackup(createMaterialSetBackup('image', items as any))?.materialMoodboard, undefined);
});
