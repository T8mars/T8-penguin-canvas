import type { Node } from '@xyflow/react';
import { defaultSizeOf, placeBatchNodes } from './nodePlacement';

export interface StoryLinkedDraftPlan { directorId: string; videoEditId: string; additions: Node[] }
/** Linked editors are editable snapshots, not live mirrors of Story output. */
export function planStoryLinkedEditors(nodes: Node[], input: {
  ownerId: string; storyId: string; linkedDirectorNodeId?: string; linkedVideoEditNodeId?: string; newDraft?: boolean;
  directorData: Record<string, unknown>; videoEditData: Record<string, unknown>;
}): StoryLinkedDraftPlan {
  const owner = nodes.find(node => node.id === input.ownerId);
  const chooseId = (previous: string | undefined, type: string) => {
    const candidate = previous || `story-${type === 'director-storyboard' ? 'director' : type}-${input.storyId}`;
    const existing = nodes.find(node => node.id === candidate);
    return input.newDraft || existing && existing.type !== type ? `story-${type}-${crypto.randomUUID()}` : candidate;
  };
  const directorId = chooseId(input.linkedDirectorNodeId, 'director-storyboard'), videoEditId = chooseId(input.linkedVideoEditNodeId, 'video-edit');
  const wanted = [
    { id: directorId, type: 'director-storyboard', data: input.directorData },
    { id: videoEditId, type: 'video-edit', data: input.videoEditData },
  ].filter(item => !nodes.some(node => node.id === item.id));
  const x = (owner?.position.x || 0) + (owner?.measured?.width || defaultSizeOf(owner?.type || 'story').w) + 80, y = owner?.position.y || 0;
  let cursor = x;
  const desired = wanted.map(item => { const size = defaultSizeOf(item.type); const box = { x: cursor, y, ...size }; cursor += size.w + 80; return box; });
  const offset = wanted.length ? placeBatchNodes(desired, nodes, { source: `placement:story-linked:${input.ownerId}` }) : { dx: 0, dy: 0 };
  const additions: Node[] = wanted.map((item, index) => ({ id: item.id, type: item.type, position: { x: desired[index].x + offset.dx, y: desired[index].y + offset.dy },
    data: { ...item.data, storySourceNodeId: input.ownerId } }));
  return { directorId, videoEditId, additions };
}
export function applyStoryLinkedDrafts(previous: Node[], plan: StoryLinkedDraftPlan): Node[] {
  const ids = new Set(previous.map(node => node.id));
  const additions = plan.additions.filter(node => !ids.has(node.id));
  return additions.length ? [...previous, ...additions] : previous;
}
