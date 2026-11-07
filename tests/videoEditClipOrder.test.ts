import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import {
  buildVideoEditTimelineRenderPlan,
  createVideoEditTimelineFromClips,
  normalizeVideoEditTimeline,
  reorderVideoEditTimelineWithClips,
  syncVideoEditTimelineWithClips,
} from '../src/utils/videoTimeline.ts';
import { sortVideoEditClipsByName } from '../src/utils/videoEdit.ts';

const clips = [
  { id: 'a', assetId: 'asset-a', name: '02.mp4', url: '/a.mp4', duration: 10, trimStart: 2, trimEnd: 8, hasAudio: true },
  { id: 'b', assetId: 'asset-b', name: '01.mp4', url: '/b.mp4', duration: 5, hasAudio: true },
];
const order = (timeline: ReturnType<typeof createVideoEditTimelineFromClips>) => (
  buildVideoEditTimelineRenderPlan(timeline).clips.map((clip) => clip.sourceItemId)
);

test('explicit playlist order changes the actual export plan and linked audio, unlike metadata sync', () => {
  const timeline = createVideoEditTimelineFromClips(clips);
  const before = JSON.stringify(timeline);
  const reversed = [...clips].reverse();
  assert.deepEqual(order(syncVideoEditTimelineWithClips(timeline, reversed)), ['item-a-video', 'item-b-video']);
  const result = reorderVideoEditTimelineWithClips(timeline, reversed);
  assert.deepEqual(order(result), ['item-b-video', 'item-a-video']);
  assert.equal(result.items.find((item) => item.id === 'item-a-video')?.timelineStart, 5);
  assert.equal(result.items.find((item) => item.id === 'item-a-audio')?.timelineStart, 5);
  assert.equal(result.items.find((item) => item.id === 'item-b-audio')?.timelineStart, 0);
  assert.equal(result.items.find((item) => item.id === 'item-a-video')?.sourceIn, 2);
  assert.equal(result.items.find((item) => item.id === 'item-a-video')?.sourceOut, 8);
  assert.deepEqual(result.assets, normalizeVideoEditTimeline(timeline).assets);
  assert.deepEqual(result.selectedItemIds, timeline.selectedItemIds);
  assert.equal(JSON.stringify(timeline), before);
  assert.deepEqual(order(reorderVideoEditTimelineWithClips(JSON.parse(JSON.stringify(result)), reversed)), order(result));
});

test('legacy playlist and numeric filename sorting use the same explicit order contract', () => {
  const sorted = sortVideoEditClipsByName([
    { ...clips[0], id: 'ten', name: '10.mp4' },
    { ...clips[1], id: 'two', name: '2.mp4' },
    { ...clips[0], id: 'one', name: '1.mp4' },
  ] as any);
  assert.deepEqual(order(reorderVideoEditTimelineWithClips(undefined, sorted)), ['item-one-video', 'item-two-video', 'item-ten-video']);
});

test('ordering preserves custom occurrences, gaps, audio offsets and unrelated overlay/music tracks', () => {
  const timeline = createVideoEditTimelineFromClips(clips);
  timeline.items.forEach((item) => { item.timelineStart = item.id.startsWith('item-a-') ? 2 : 14; });
  timeline.items.find((item) => item.id === 'item-b-audio')!.timelineStart = 14.25;
  timeline.tracks.push({ id: 'pip', kind: 'video', name: 'PIP', order: 2 }, { id: 'music', kind: 'audio', name: 'Music', order: 3 });
  timeline.items.push(
    { id: 'custom', assetId: 'asset-a', kind: 'video', trackId: 'track-video-main', sourceIn: 0, sourceOut: 2, timelineStart: 9 },
    { id: 'repeat', assetId: 'asset-a', kind: 'video', trackId: 'track-video-main', sourceIn: 3, sourceOut: 4, timelineStart: 20 },
    { id: 'overlay', assetId: 'asset-a', kind: 'video', trackId: 'pip', sourceIn: 1, sourceOut: 4, timelineStart: 3, scale: .4 },
    { id: 'background', assetId: 'asset-b', kind: 'audio', trackId: 'music', sourceIn: 0, sourceOut: 5, timelineStart: .5, volume: .3, audioFadeIn: .4, volumeCurve: 'duck' },
  );
  const result = reorderVideoEditTimelineWithClips(timeline, [...clips].reverse());
  const normalized = normalizeVideoEditTimeline(timeline);
  const start = (id: string) => result.items.find((item) => item.id === id)!.timelineStart;
  assert.equal(start('item-b-video'), 2);
  assert.equal(start('item-b-audio'), 2.25);
  assert.equal(start('custom'), 8);
  assert.equal(start('item-a-video'), 13);
  assert.equal(start('repeat'), 20);
  assert.deepEqual(result.items.find((item) => item.id === 'overlay'), normalized.items.find((item) => item.id === 'overlay'));
  assert.deepEqual(result.items.find((item) => item.id === 'background'), normalized.items.find((item) => item.id === 'background'));
  assert.deepEqual(result.items.map((item) => item.id), timeline.items.map((item) => item.id));
});

test('repeated asset slots are identified by clip/item ID and are never collapsed', () => {
  const repeated = [clips[0], { ...clips[0], id: 'a-repeat', trimStart: 0, trimEnd: 3 }];
  const result = reorderVideoEditTimelineWithClips(createVideoEditTimelineFromClips(repeated), [...repeated].reverse());
  assert.deepEqual(order(result), ['item-a-repeat-video', 'item-a-video']);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.find((item) => item.id === 'item-a-audio')?.timelineStart, 3);
});

function productionHandlers({ locked = false, running = false } = {}) {
  const source = readFileSync(new URL('../src/components/nodes/VideoEditNode.tsx', import.meta.url), 'utf8');
  const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = section('  const commitClipOrder =', '  const isClipOnLockedTimelineTrack =')
    + section('  const handleTimelineDrop =', '  const compressToTargetDuration =')
    + section('  const sortClipsByName =', '  const trimClipsToDefaultDuration =');
  let state = { clips: structuredClone(clips), timelineV2: createVideoEditTimelineFromClips(clips), selectedClipId: 'a' };
  let commits = 0, undo = 0;
  const guards: string[][] = [];
  const deps = {
    running, busy: '', clips,
    dragClipId: 'b', setDragClipId: () => {},
    reorder: (items: any[], from: number, to: number) => { const next = [...items]; next.splice(to, 0, ...next.splice(from, 1)); return next; },
    reorderVideoEditTimelineWithClips, sortVideoEditClipsByName,
    getWorkbenchSnapshot: () => structuredClone(state),
    guardLockedTimelineItems: (_timeline: unknown, ids: string[]) => { guards.push(ids); return locked; },
    rememberWorkbenchChange: () => { undo++; },
    setLocalError: () => {},
    commitClips: (next: any, extra: any) => { state = { ...state, clips: next, ...extra }; commits++; },
  };
  const js = transformSync(code + '\nreturn { moveStoryboardClip, handleTimelineDrop, sortClipsByName };', { loader: 'ts' }).code;
  const handlers = new Function(...Object.keys(deps), js)(...Object.values(deps));
  return { handlers, getState: () => state, stats: () => ({ commits, undo, guards }) };
}

test('actual production move handler reads the live snapshot and updates export order on consecutive clicks', () => {
  const p = productionHandlers();
  p.handlers.moveStoryboardClip('b', -1);
  assert.deepEqual(order(p.getState().timelineV2), ['item-b-video', 'item-a-video']);
  p.handlers.moveStoryboardClip('b', 1);
  assert.deepEqual(order(p.getState().timelineV2), ['item-a-video', 'item-b-video']);
  assert.equal(p.getState().selectedClipId, 'b');
  assert.equal(p.stats().commits, 2);
  assert.equal(p.stats().undo, 2);
});

test('actual production filename-sort and drop handlers update the timeline as well as the playlist', () => {
  for (const action of ['sort', 'drop']) {
    const p = productionHandlers();
    if (action === 'sort') p.handlers.sortClipsByName();
    else p.handlers.handleTimelineDrop({ preventDefault() {} }, 'a');
    assert.deepEqual(p.getState().clips.map((clip) => clip.id), ['b', 'a']);
    assert.deepEqual(order(p.getState().timelineV2), ['item-b-video', 'item-a-video']);
  }
});

test('production ordering uses lock guards, blocks busy runs and ignores boundary moves without undo entries', () => {
  const locked = productionHandlers({ locked: true });
  locked.handlers.moveStoryboardClip('b', -1);
  assert.equal(locked.stats().commits, 0);
  assert.ok(locked.stats().guards[0].includes('item-b-audio'));
  const busy = productionHandlers({ running: true });
  busy.handlers.moveStoryboardClip('b', -1);
  assert.equal(busy.stats().commits, 0);
  const noOp = productionHandlers();
  noOp.handlers.moveStoryboardClip('a', -1);
  assert.equal(noOp.stats().undo, 0);
});
