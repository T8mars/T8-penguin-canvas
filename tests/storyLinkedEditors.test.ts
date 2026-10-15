import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import { applyStoryLinkedDrafts, planStoryLinkedEditors } from '../src/utils/storyLinkedEditors.ts';

const owner: Node = { id: 'story-owner', type: 'story', position: { x: 0, y: 0 }, data: {} };
const input = { ownerId: owner.id, storyId: 'production', directorData: { shots: [{ id: 'shot-stable', videoUrl: '/new.mp4' }] }, videoEditData: { clips: [{ id: 'shot-stable', url: '/new.mp4' }], timelineV2: { clips: [] } } };
test('opening existing linked drafts never rewrites manual clips, trims, settings, shot IDs or positions', () => {
  const director: Node = { id: 'story-director-production', type: 'director-storyboard', position: { x: 99, y: 88 }, data: { shots: [{ id: 'manual-shot', prompt: 'Keep my work' }] } };
  const video: Node = { id: 'story-video-edit-production', type: 'video-edit', position: { x: 123, y: 456 }, data: { clips: [{ id: 'manual-clip', trimStart: 3 }], settings: { audio: 'Keep' }, timelineV2: { clips: [{ id: 'manual' }] } } };
  const nodes = [owner, director, video], before = JSON.stringify(nodes);
  const plan = planStoryLinkedEditors(nodes, input);
  assert.deepEqual(plan.additions, []); assert.equal(applyStoryLinkedDrafts(nodes, plan), nodes);
  assert.equal(JSON.stringify(nodes), before); assert.equal(plan.directorId, director.id); assert.equal(plan.videoEditId, video.id);
});
test('explicit new drafts keep old editors and retain source shot identities and current result URLs', () => {
  const first = planStoryLinkedEditors([owner], input), previous = applyStoryLinkedDrafts([owner], first), snapshot = JSON.stringify(previous);
  assert.ok(first.additions[1].position.x - first.additions[0].position.x >= 460 + 80, 'new drafts respect the actual Director width');
  const next = planStoryLinkedEditors(previous, { ...input, linkedDirectorNodeId: first.directorId, linkedVideoEditNodeId: first.videoEditId, newDraft: true });
  const result = applyStoryLinkedDrafts(previous, next);
  assert.equal(result.length, 5); assert.equal(JSON.stringify(previous), snapshot);
  assert.notEqual(first.videoEditId, next.videoEditId); assert.notEqual(first.directorId, next.directorId);
  assert.deepEqual(result.find(node => node.id === next.videoEditId)?.data.clips, input.videoEditData.clips);
  assert.equal(result.find(node => node.id === next.directorId)?.data.storySourceNodeId, owner.id);
  assert.equal(applyStoryLinkedDrafts(result, next), result, 'replayed state updater must not duplicate drafts');
});
test('a stale or imported linked ID cannot overwrite an unrelated node type', () => {
  const occupied: Node = { id: 'story-director-production', type: 'image', position: { x: 2, y: 4 }, data: { imageUrl: '/keep.png' } };
  const plan = planStoryLinkedEditors([owner, occupied], input), next = applyStoryLinkedDrafts([owner, occupied], plan);
  assert.notEqual(plan.directorId, occupied.id); assert.equal(next[1], occupied); assert.equal(next.length, 4);
});
