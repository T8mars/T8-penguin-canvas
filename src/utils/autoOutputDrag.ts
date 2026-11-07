import type { Node } from '@xyflow/react';

/** Only a selected drag source carries the current multi-selection with it. */
export function markManualAutoOutputDrag(nodes: Node[], draggedId: string): Node[] {
  const withSelection = nodes.some((node) => node.id === draggedId && node.selected);
  let changed = false;
  const next = nodes.map((node) => {
    if (!node.id.startsWith('output-auto-') || (node.id !== draggedId && !(withSelection && node.selected)) || node.data?.userMoved === true) return node;
    changed = true;
    return { ...node, data: { ...node.data, userMoved: true } };
  });
  return changed ? next : nodes;
}
