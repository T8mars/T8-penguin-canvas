import type { Node, NodeChange } from '@xyflow/react';

// UI intent only, not a substitute for archive/backend write authority.
// ReactFlow batches setNodes/addNodes after the modal callback. Match the
// exact submitted object (not merely its ID), and consume each intent once.
const dialogNodes = new WeakSet<object>();
export function approveCanvasDialogNodes<T extends Node>(nodes: T[]): T[] {
  nodes.forEach(node => dialogNodes.add(node)); return nodes;
}
export function filterInertCanvasNodeChanges<T extends Node>(changes: NodeChange<T>[], editingDialogActive = false): NodeChange<T>[] {
  // ReactFlow's getElementsDiffChanges emits add/replace only for its queued
  // setNodes/addNodes API, not native drag/select/delete. An editing dialog
  // must not suppress existing background outputs or queued secondary actions.
  // Native close-save holds keep the stricter one-use intent policy.
  return changes.filter(change => change.type === 'dimensions'
    || (change.type === 'add' || change.type === 'replace') && (dialogNodes.delete(change.item) || editingDialogActive));
}
