import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverCanvasRevisionConflict, isRevisionOnlyCanvasConflict } from '../src/utils/canvasSaveRecovery.ts';
import type { CanvasPatchPendingEnvelope } from '../src/utils/canvasPatchMerge.ts';
import { mergeCanvasPatchGraph } from '../src/utils/canvasPatchMerge.ts';

const baseline = JSON.stringify({ nodes: [{ id: 'n1' }], edges: [] });
const pending = (): CanvasPatchPendingEnvelope => ({ snapshot: 'local', baseSnapshot: baseline, baseRevision: 1,
  conflicted: true, conflicts: [{ kind: 'same-field', path: 'revision' }] });
function fixture() {
  let current: CanvasPatchPendingEnvelope | null = pending();
  let loads = 0, commits = 0, cancelled = false;
  const attempts = new Map<string, number>();
  const options = { canvasId: 'a', attempts, cancelled: () => cancelled, readPending: () => current,
    load: async () => { loads++; return { revision: 2 }; },
    commit: (_document: unknown, base: string) => { commits++; assert.equal(base, baseline); return { conflicts: [] }; } };
  return { options, set: (value: CanvasPatchPendingEnvelope | null) => { current = value; }, cancel: () => { cancelled = true; },
    counts: () => ({ loads, commits }) };
}

test('revision-only conflict reads authority then rebases; no direct write/retry path', async () => {
  const f = fixture(); assert.equal(await recoverCanvasRevisionConflict(f.options), 'reconciled');
  assert.deepEqual(f.counts(), { loads: 1, commits: 1 });
});
test('real content conflicts never auto-select local or server values', async () => {
  const f = fixture(); f.set({ ...pending(), conflicts: [{ kind: 'same-field', path: 'nodes[n1].data.prompt' }] });
  assert.equal(await recoverCanvasRevisionConflict(f.options), 'blocked'); assert.deepEqual(f.counts(), { loads: 0, commits: 0 });
});
test('automatic reconciliation is bounded; an explicit retry grants only a fresh bounded attempt', async () => {
  const f = fixture(); await recoverCanvasRevisionConflict(f.options); await recoverCanvasRevisionConflict(f.options);
  assert.equal(await recoverCanvasRevisionConflict(f.options), 'limited'); assert.equal(f.counts().loads, 2);
  assert.equal(await recoverCanvasRevisionConflict({ ...f.options, manual: true }), 'reconciled'); assert.equal(f.counts().loads, 3);
});
test('GET failures retain conflict and baseline and do not mark any data saved', async () => {
  const f = fixture(); const error = new Error('offline');
  await assert.rejects(recoverCanvasRevisionConflict({ ...f.options, load: async () => { throw error; } }), error);
  assert.equal(f.counts().commits, 0); assert.equal(isRevisionOnlyCanvasConflict(f.options.readPending()), true);
});
for (const replacement of [null, { ...pending(), conflicted: false }, { ...pending(), baseRevision: 3 },
  { ...pending(), conflicts: [{ kind: 'delete-edit' as const, path: 'nodes[n1]' }] }]) {
  test('newer authority/pending identity during GET supersedes retired recovery: ' + JSON.stringify(replacement), async () => {
    const f = fixture(); assert.equal(await recoverCanvasRevisionConflict({ ...f.options, load: async () => { f.set(replacement); return {}; } }), 'superseded');
    assert.equal(f.counts().commits, 0);
  });
}
test('local edits during authority GET are read at commit instead of using a frozen local snapshot', async () => {
  const f = fixture(); await recoverCanvasRevisionConflict({ ...f.options, load: async () => { f.set({ ...pending(), snapshot: 'later local edit' }); return {}; },
    commit: () => { assert.equal(f.options.readPending()?.snapshot, 'later local edit'); return { conflicts: [] }; } });
});
test('cancelled/unmounted recovery never commits late authority', async () => {
  const f = fixture(); assert.equal(await recoverCanvasRevisionConflict({ ...f.options, load: async () => { f.cancel(); return {}; } }), 'superseded'); assert.equal(f.counts().commits, 0);
});
test('missing baseline fails closed before GET', async () => {
  const f = fixture(); f.set({ ...pending(), baseSnapshot: '{}' });
  await assert.rejects(recoverCanvasRevisionConflict(f.options), /baseline/); assert.deepEqual(f.counts(), { loads: 0, commits: 0 });
});
test('a merge collision is blocked, not declared reconciled', async () => {
  const f = fixture(); assert.equal(await recoverCanvasRevisionConflict({ ...f.options, commit: () => ({ conflicts: [{ kind: 'edit-delete', path: 'nodes[n1]' }] }) }), 'blocked');
});

test('recovery must not merge a local prompt into a replaced remote node with the same display ID', () => {
  const base = { id: 'n1', entityUid: 'entity-original', data: { prompt: 'base' } };
  const local = { ...base, data: { prompt: 'my unsaved edit' } };
  const remote = { ...base, entityUid: 'entity-replacement' };
  const result = mergeCanvasPatchGraph({ baseNodes: [base], localNodes: [local], authoritativeNodes: [remote], baseEdges: [], localEdges: [], authoritativeEdges: [] });
  assert.ok(result.conflicts.length > 0); assert.deepEqual(result.nodes, [local]);
});
