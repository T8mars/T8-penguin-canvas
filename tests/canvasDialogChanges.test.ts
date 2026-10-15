import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node, NodeChange } from '@xyflow/react';
import { approveCanvasDialogNodes, filterInertCanvasNodeChanges } from '../src/utils/canvasDialogChanges.ts';
const node = (): Node => ({ id: 'same-visible-id', position: { x: 0, y: 0 }, data: {} });
test('inert Canvas accepts only the exact explicitly submitted dialog node object, once', () => {
  const submitted = approveCanvasDialogNodes([node()])[0];
  const change: NodeChange = { type: 'replace', id: submitted.id, item: submitted };
  assert.deepEqual(filterInertCanvasNodeChanges([{ type: 'replace', id: submitted.id, item: { ...submitted } }]), []);
  assert.deepEqual(filterInertCanvasNodeChanges([change]), [change]);
  assert.deepEqual(filterInertCanvasNodeChanges([change]), []);
  const added = approveCanvasDialogNodes([node()])[0], add: NodeChange = { type: 'add', item: added };
  assert.deepEqual(filterInertCanvasNodeChanges([add]), [add]);
});
test('dialog intent never permits remove, selection, drag or unrelated additions under an inert root', () => {
  const submitted = approveCanvasDialogNodes([node()])[0];
  const dimensions: NodeChange = { type: 'dimensions', id: submitted.id, dimensions: { width: 100, height: 100 } };
  assert.deepEqual(filterInertCanvasNodeChanges([
    { type: 'remove', id: submitted.id }, { type: 'select', id: submitted.id, selected: true },
    { type: 'position', id: submitted.id, position: { x: 10, y: 10 } }, { type: 'add', item: node() }, dimensions,
  ]), [dimensions]);
});

test('editing dialogs preserve existing queued API outputs/actions while background native graph edits stay blocked', () => {
  const added = node(), patched = { ...node(), data: { status: 'success', secondaryProviderAction: { requestId: 'existing-authorized-action' } } };
  const add: NodeChange = { type: 'add', item: added }, replace: NodeChange = { type: 'replace', id: patched.id, item: patched };
  const changes: NodeChange[] = [add, replace, { type: 'remove', id: added.id }, { type: 'select', id: added.id, selected: true }, { type: 'position', id: added.id, dragging: true }];
  assert.deepEqual(filterInertCanvasNodeChanges(changes, true), [add, replace]);
  assert.deepEqual(filterInertCanvasNodeChanges(changes, false), [], 'Close-save/other held roots do not acquire the editing-dialog exception');
});
