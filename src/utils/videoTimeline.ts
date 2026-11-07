export type VideoEditTimelineKind = 'video' | 'audio' | 'image' | 'text';
export type VideoEditAudioVolumeCurve = 'flat' | 'linear-up' | 'linear-down' | 'duck';

export const VIDEO_EDIT_AUDIO_VOLUME_CURVES: VideoEditAudioVolumeCurve[] = ['flat', 'linear-up', 'linear-down', 'duck'];

export interface VideoEditTimelineClipLike {
  id?: string;
  assetId?: string;
  sourceNodeId?: string;
  sourceCanvasId?: string;
  sourceLabel?: string;
  name?: string;
  url?: string;
  directUrl?: string;
  mime?: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  thumbnailUrl?: string;
  filmstripUrls?: string[];
  filmstripTimes?: number[];
  waveformPeaks?: number[];
  hasAudio?: boolean;
  trimStart?: number;
  trimEnd?: number;
  muted?: boolean;
}

export interface VideoEditTimelineAsset {
  id: string;
  kind: VideoEditTimelineKind;
  url: string;
  directUrl?: string;
  name: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  thumbnailUrl?: string;
  filmstripUrls?: string[];
  filmstripTimes?: number[];
  waveformPeaks?: number[];
  hasAudio?: boolean;
  sourceNodeId?: string;
  sourceCanvasId?: string;
  sourceLabel?: string;
  text?: string;
  textPosition?: 'top' | 'middle' | 'bottom' | string;
  textColor?: string;
  textFontSize?: number;
  textBackground?: string;
}

export interface VideoEditTimelineTrack {
  id: string;
  kind: VideoEditTimelineKind;
  name: string;
  order: number;
  muted?: boolean;
  locked?: boolean;
  hidden?: boolean;
  solo?: boolean;
  collapsed?: boolean;
}

export interface VideoEditTimelineItem {
  id: string;
  assetId: string;
  trackId: string;
  kind: VideoEditTimelineKind;
  timelineStart: number;
  sourceIn: number;
  sourceOut: number;
  muted?: boolean;
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  volumeCurve?: VideoEditAudioVolumeCurve;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  transitionIn?: string;
  transitionOut?: string;
  linkedItemId?: string;
  label?: string;
}

export interface VideoEditTimelineV2 {
  version: 2;
  assets: VideoEditTimelineAsset[];
  tracks: VideoEditTimelineTrack[];
  items: VideoEditTimelineItem[];
  selectedItemIds: string[];
  playhead: number;
  zoom: number;
  scrollLeft: number;
  snapEnabled: boolean;
}

export interface VideoEditTimelineConflict {
  kind: 'invalid-duration' | 'missing-asset' | 'missing-track' | 'overlap' | 'locked-track';
  itemId: string;
  trackId?: string;
  message: string;
  withItemId?: string;
}

export interface VideoEditTimelineRenderTrack {
  id: string;
  kind: VideoEditTimelineKind;
  name: string;
  order: number;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  solo: boolean;
}

export interface VideoEditTimelineRenderSegment {
  id: string;
  sourceItemId: string;
  assetId: string;
  trackId: string;
  kind: 'video';
  trackOrder: number;
  layerIndex: number;
  timelineStart: number;
  timelineEnd: number;
  trimStart: number;
  trimEnd: number;
  muted: boolean;
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  volumeCurve?: VideoEditAudioVolumeCurve;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  hasAudio?: boolean;
  name: string;
  url: string;
  directUrl?: string;
  mime?: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  thumbnailUrl?: string;
  filmstripUrls?: string[];
  filmstripTimes?: number[];
  waveformPeaks?: number[];
  linkedAudioItemIds?: string[];
  sourceNodeId?: string;
  sourceCanvasId?: string;
  sourceLabel?: string;
}

export interface VideoEditTimelineRenderAudioSegment {
  id: string;
  sourceItemId: string;
  assetId: string;
  trackId: string;
  kind: 'audio';
  trackOrder: number;
  timelineStart: number;
  timelineEnd: number;
  trimStart: number;
  trimEnd: number;
  muted: boolean;
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  volumeCurve?: VideoEditAudioVolumeCurve;
  name: string;
  url: string;
  directUrl?: string;
  mime?: string;
  duration?: number;
  size?: number;
  waveformPeaks?: number[];
  linkedVideoItemId?: string;
  sourceNodeId?: string;
  sourceCanvasId?: string;
  sourceLabel?: string;
}

export interface VideoEditTimelineRenderTextSegment {
  id: string;
  sourceItemId: string;
  assetId: string;
  trackId: string;
  kind: 'text';
  trackOrder: number;
  timelineStart: number;
  timelineEnd: number;
  text: string;
  name: string;
  position: string;
  color: string;
  fontSize: number;
  background: string;
}

export interface VideoEditTimelineRenderCapabilities {
  timelineLayerCompose: boolean;
  timelineLayerCount: number;
  timelineGaps: boolean;
  timelineAudioMix: boolean;
  sourceAudioMix: boolean;
  subtitleBurnIn: boolean;
}

export interface VideoEditTimelineRenderPlan {
  version: 1;
  duration: number;
  tracks: VideoEditTimelineRenderTrack[];
  clips: VideoEditTimelineRenderSegment[];
  audio: VideoEditTimelineRenderAudioSegment[];
  text: VideoEditTimelineRenderTextSegment[];
  capabilities: VideoEditTimelineRenderCapabilities;
  unsupported: string[];
  warnings: string[];
}

export interface VideoEditAudioEnvelopeSegment {
  timelineStart: number;
  timelineEnd?: number;
  sourceIn?: number;
  sourceOut?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  volumeCurve?: VideoEditAudioVolumeCurve;
}

export interface VideoEditTimelineMoveOptions {
  snapThreshold?: number;
  snapPoints?: number[];
}

export type VideoEditTimelineSnapKind = 'timeline-start' | 'timeline-end' | 'playhead' | 'item-start' | 'item-end' | 'custom' | 'none';

export interface VideoEditTimelineSnapTarget {
  time: number;
  kind: Exclude<VideoEditTimelineSnapKind, 'none'>;
  label: string;
  sourceItemId?: string;
}

export interface VideoEditTimelineSnapResult {
  input: number;
  time: number;
  snapped: boolean;
  distance: number;
  threshold: number;
  kind: VideoEditTimelineSnapKind;
  label: string;
  sourceItemId?: string;
}

export interface VideoEditTimelineSnapOptions {
  threshold?: number;
  excludedItemIds?: string[];
  snapPoints?: Array<number | VideoEditTimelineSnapTarget>;
}

export interface VideoEditTimelineRangeEditOptions {
  targetTrackIds?: string[];
  includeText?: boolean;
  stamp?: string;
}

export type VideoEditTimelineControllerTool = 'select' | 'trim' | 'blade' | 'hand' | 'range';
export type VideoEditTimelineControllerSelectMode = 'replace' | 'add' | 'remove' | 'toggle' | 'clear';

export interface VideoEditTimelineControllerDragState {
  kind: 'move' | 'trim' | 'playhead' | 'marquee' | 'scroll';
  itemId?: string;
  edge?: 'start' | 'end';
  pointerId?: number;
  startedAt: number;
  currentAt?: number;
}

export interface VideoEditTimelineControllerState {
  playhead: number;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  selectedItemIds: string[];
  activeTool: VideoEditTimelineControllerTool;
  snapEnabled: boolean;
  drag: VideoEditTimelineControllerDragState | null;
}

export interface VideoEditTimelineControllerOptions {
  duration?: number;
  minZoom?: number;
  maxZoom?: number;
  maxScrollLeft?: number;
  maxScrollTop?: number;
  knownItemIds?: string[];
}

export type VideoEditTimelineControllerCommand =
  | { type: 'seek'; time: number }
  | { type: 'scroll'; left?: number; top?: number }
  | { type: 'zoom'; zoom: number }
  | { type: 'select'; itemIds?: string[]; mode?: VideoEditTimelineControllerSelectMode }
  | { type: 'tool'; tool: VideoEditTimelineControllerTool }
  | { type: 'snap'; enabled: boolean }
  | { type: 'begin-drag'; drag: VideoEditTimelineControllerDragState }
  | { type: 'update-drag'; currentAt: number }
  | { type: 'end-drag' };

export interface VideoEditTimelineCoordinateOptions {
  pixelsPerSecond?: number;
  zoom?: number;
  scrollLeft?: number;
}

export interface VideoEditTimelineKeepTimeInViewOptions extends VideoEditTimelineControllerOptions, VideoEditTimelineCoordinateOptions {
  padding?: number;
}

export interface VideoEditTimelineInteractionState {
  timeline: VideoEditTimelineV2;
  controller: VideoEditTimelineControllerState;
}

export interface VideoEditTimelineInteractionOptions extends VideoEditTimelineControllerOptions, VideoEditTimelineMoveOptions {}

export type VideoEditTimelineInteractionCommand =
  | VideoEditTimelineControllerCommand
  | { type: 'move-item'; itemId: string; timelineStart?: number; trackId?: string; snapThreshold?: number }
  | { type: 'trim-item'; itemId: string; edge: 'start' | 'end'; sourceTime: number }
  | { type: 'split-item'; itemId?: string; time?: number };

const MAIN_VIDEO_TRACK_ID = 'track-video-main';
const MAIN_AUDIO_TRACK_ID = 'track-audio-main';
const MIN_TIMELINE_ITEM_DURATION = 0.1;
const DEFAULT_TIMELINE_PIXELS_PER_SECOND = 64;
const DEFAULT_TIMELINE_CONTROLLER_MIN_ZOOM = 0.25;
const DEFAULT_TIMELINE_CONTROLLER_MAX_ZOOM = 8;
const VIDEO_EDIT_TIMELINE_CONTROLLER_TOOLS = new Set<VideoEditTimelineControllerTool>(['select', 'trim', 'blade', 'hand', 'range']);
const VIDEO_EDIT_TIMELINE_CONTROLLER_DRAG_KINDS = new Set<VideoEditTimelineControllerDragState['kind']>(['move', 'trim', 'playhead', 'marquee', 'scroll']);

function finiteNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function roundTimelineSecond(value: number): number {
  return Number(Math.max(0, value).toFixed(3));
}

export function normalizeVideoEditAudioVolumeCurve(value: unknown): VideoEditAudioVolumeCurve {
  return VIDEO_EDIT_AUDIO_VOLUME_CURVES.includes(value as VideoEditAudioVolumeCurve)
    ? value as VideoEditAudioVolumeCurve
    : 'flat';
}

export function normalizeVideoEditAudioFade(value: unknown, duration = Number.MAX_SAFE_INTEGER): number {
  const maxDuration = Math.max(0, finiteNumber(duration, Number.MAX_SAFE_INTEGER));
  const maxFade = Math.min(maxDuration, 10);
  return roundTimelineSecond(clampFiniteNumber(value, 0, maxFade, 0));
}

export function videoEditAudioEnvelopeMultiplier(
  segment: VideoEditAudioEnvelopeSegment,
  timelineTimeInput: number,
): number {
  const start = roundTimelineSecond(finiteNumber(segment.timelineStart, 0));
  const fallbackEnd = start + Math.max(0, finiteNumber(segment.sourceOut, 0) - finiteNumber(segment.sourceIn, 0));
  const end = roundTimelineSecond(Math.max(start, finiteNumber(segment.timelineEnd, fallbackEnd)));
  const duration = Math.max(0, end - start);
  if (duration <= 0) return 0;
  const timelineTime = roundTimelineSecond(finiteNumber(timelineTimeInput, start));
  const offset = Math.max(0, Math.min(duration, timelineTime - start));
  const fadeIn = normalizeVideoEditAudioFade(segment.audioFadeIn, duration);
  const fadeOut = normalizeVideoEditAudioFade(segment.audioFadeOut, duration);
  let multiplier = 1;
  if (fadeIn > 0 && offset < fadeIn) {
    multiplier = Math.min(multiplier, offset / fadeIn);
  }
  if (fadeOut > 0 && offset > duration - fadeOut) {
    multiplier = Math.min(multiplier, Math.max(0, (duration - offset) / fadeOut));
  }
  const curve = normalizeVideoEditAudioVolumeCurve(segment.volumeCurve);
  if (curve === 'linear-up') {
    multiplier *= duration > 0 ? offset / duration : 0;
  } else if (curve === 'linear-down') {
    multiplier *= duration > 0 ? Math.max(0, (duration - offset) / duration) : 0;
  } else if (curve === 'duck') {
    multiplier *= 0.55;
  }
  return Number(Math.max(0, Math.min(1, multiplier)).toFixed(3));
}

function roundTimelineDelta(value: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Number(next.toFixed(3)) : 0;
}

function clampFiniteNumber(value: unknown, min: number, max: number, fallback = min): number {
  const next = finiteNumber(value, fallback);
  return Math.min(Math.max(next, min), max);
}

function uniqueKnownItemIds(itemIds: unknown, knownItemIds?: string[]): string[] {
  const known = Array.isArray(knownItemIds) ? new Set(knownItemIds.map(String)) : null;
  const seen = new Set<string>();
  if (!Array.isArray(itemIds)) return [];
  return itemIds.flatMap((itemId) => {
    if (typeof itemId !== 'string') return [];
    const trimmed = itemId.trim();
    if (!trimmed || seen.has(trimmed)) return [];
    if (known && !known.has(trimmed)) return [];
    seen.add(trimmed);
    return [trimmed];
  });
}

function normalizeControllerDrag(input: unknown): VideoEditTimelineControllerDragState | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<VideoEditTimelineControllerDragState>;
  if (!raw.kind || !VIDEO_EDIT_TIMELINE_CONTROLLER_DRAG_KINDS.has(raw.kind)) return null;
  const edge = raw.edge === 'start' || raw.edge === 'end' ? raw.edge : undefined;
  return {
    kind: raw.kind,
    itemId: typeof raw.itemId === 'string' && raw.itemId.trim() ? raw.itemId.trim() : undefined,
    edge,
    pointerId: optionalFiniteNumber(raw.pointerId),
    startedAt: finiteNumber(raw.startedAt, 0),
    currentAt: optionalFiniteNumber(raw.currentAt),
  };
}

function timelineCoordinateScale(options: VideoEditTimelineCoordinateOptions = {}): number {
  const pixelsPerSecond = Math.max(1, finiteNumber(options.pixelsPerSecond, DEFAULT_TIMELINE_PIXELS_PER_SECOND));
  const zoom = Math.max(0.05, finiteNumber(options.zoom, 1));
  return pixelsPerSecond * zoom;
}

export function videoEditTimelineTimeToX(time: number, options: VideoEditTimelineCoordinateOptions = {}): number {
  const scale = timelineCoordinateScale(options);
  const scrollLeft = Math.max(0, finiteNumber(options.scrollLeft, 0));
  return roundTimelineDelta(roundTimelineSecond(finiteNumber(time, 0)) * scale - scrollLeft);
}

export function videoEditTimelineXToTime(x: number, options: VideoEditTimelineCoordinateOptions = {}): number {
  const scale = timelineCoordinateScale(options);
  const scrollLeft = Math.max(0, finiteNumber(options.scrollLeft, 0));
  return roundTimelineSecond((finiteNumber(x, 0) + scrollLeft) / scale);
}

export function normalizeVideoEditTimelineControllerState(
  input: unknown,
  options: VideoEditTimelineControllerOptions = {},
): VideoEditTimelineControllerState {
  const raw = input && typeof input === 'object'
    ? input as Partial<VideoEditTimelineControllerState>
    : {};
  const duration = Math.max(0, finiteNumber(options.duration, Number.MAX_SAFE_INTEGER));
  const minZoom = Math.max(0.05, finiteNumber(options.minZoom, DEFAULT_TIMELINE_CONTROLLER_MIN_ZOOM));
  const maxZoom = Math.max(minZoom, finiteNumber(options.maxZoom, DEFAULT_TIMELINE_CONTROLLER_MAX_ZOOM));
  const maxScrollLeft = Math.max(0, finiteNumber(options.maxScrollLeft, Number.MAX_SAFE_INTEGER));
  const maxScrollTop = Math.max(0, finiteNumber(options.maxScrollTop, Number.MAX_SAFE_INTEGER));
  const activeTool = raw.activeTool && VIDEO_EDIT_TIMELINE_CONTROLLER_TOOLS.has(raw.activeTool)
    ? raw.activeTool
    : 'select';

  return {
    playhead: roundTimelineSecond(clampFiniteNumber(raw.playhead, 0, duration, 0)),
    zoom: Number(clampFiniteNumber(raw.zoom, minZoom, maxZoom, 1).toFixed(3)),
    scrollLeft: Number(clampFiniteNumber(raw.scrollLeft, 0, maxScrollLeft, 0).toFixed(3)),
    scrollTop: Number(clampFiniteNumber(raw.scrollTop, 0, maxScrollTop, 0).toFixed(3)),
    selectedItemIds: uniqueKnownItemIds(raw.selectedItemIds, options.knownItemIds),
    activeTool,
    snapEnabled: raw.snapEnabled !== false,
    drag: normalizeControllerDrag(raw.drag),
  };
}

function controllerOptionsForTimeline(
  timeline: VideoEditTimelineV2,
  options: VideoEditTimelineControllerOptions = {},
): VideoEditTimelineControllerOptions {
  const { duration: _duration, knownItemIds: _knownItemIds, ...rest } = options;
  return {
    ...rest,
    duration: videoEditTimelineDuration(timeline),
    knownItemIds: timeline.items.map((item) => item.id),
  };
}

function sanitizeTimelineControllerForTimeline(
  timeline: VideoEditTimelineV2,
  controller: Partial<VideoEditTimelineControllerState>,
  options: VideoEditTimelineControllerOptions = {},
): VideoEditTimelineControllerState {
  const mergedOptions = controllerOptionsForTimeline(timeline, options);
  const normalized = normalizeVideoEditTimelineControllerState(controller, mergedOptions);
  const knownItemIds = new Set(timeline.items.map((item) => item.id));
  const drag = normalized.drag?.itemId && !knownItemIds.has(normalized.drag.itemId)
    ? null
    : normalized.drag;
  if (drag === normalized.drag) return normalized;
  return normalizeVideoEditTimelineControllerState({ ...normalized, drag }, mergedOptions);
}

export function createVideoEditTimelineControllerState(
  timeline: VideoEditTimelineV2,
  overrides: Partial<VideoEditTimelineControllerState> = {},
  options: VideoEditTimelineControllerOptions = {},
): VideoEditTimelineControllerState {
  return normalizeVideoEditTimelineControllerState({
    playhead: timeline.playhead,
    zoom: timeline.zoom,
    scrollLeft: timeline.scrollLeft,
    scrollTop: 0,
    selectedItemIds: timeline.selectedItemIds,
    activeTool: 'select',
    snapEnabled: timeline.snapEnabled,
    drag: null,
    ...overrides,
  }, {
    duration: videoEditTimelineDuration(timeline),
    knownItemIds: timeline.items.map((item) => item.id),
    ...options,
  });
}

export function applyVideoEditTimelineControllerCommand(
  state: VideoEditTimelineControllerState,
  command: VideoEditTimelineControllerCommand,
  options: VideoEditTimelineControllerOptions = {},
): VideoEditTimelineControllerState {
  const current = normalizeVideoEditTimelineControllerState(state, options);
  if (command.type === 'seek') {
    return normalizeVideoEditTimelineControllerState({ ...current, playhead: command.time }, options);
  }
  if (command.type === 'scroll') {
    return normalizeVideoEditTimelineControllerState({
      ...current,
      scrollLeft: command.left === undefined ? current.scrollLeft : command.left,
      scrollTop: command.top === undefined ? current.scrollTop : command.top,
    }, options);
  }
  if (command.type === 'zoom') {
    return normalizeVideoEditTimelineControllerState({ ...current, zoom: command.zoom }, options);
  }
  if (command.type === 'tool') {
    return normalizeVideoEditTimelineControllerState({ ...current, activeTool: command.tool }, options);
  }
  if (command.type === 'snap') {
    return normalizeVideoEditTimelineControllerState({ ...current, snapEnabled: command.enabled }, options);
  }
  if (command.type === 'begin-drag') {
    return normalizeVideoEditTimelineControllerState({ ...current, drag: command.drag }, options);
  }
  if (command.type === 'update-drag') {
    return normalizeVideoEditTimelineControllerState({
      ...current,
      drag: current.drag ? { ...current.drag, currentAt: command.currentAt } : null,
    }, options);
  }
  if (command.type === 'end-drag') {
    return normalizeVideoEditTimelineControllerState({ ...current, drag: null }, options);
  }

  const mode = command.mode || 'replace';
  const incoming = uniqueKnownItemIds(command.itemIds, options.knownItemIds);
  if (mode === 'clear') {
    return normalizeVideoEditTimelineControllerState({ ...current, selectedItemIds: [] }, options);
  }
  if (mode === 'replace') {
    return normalizeVideoEditTimelineControllerState({ ...current, selectedItemIds: incoming }, options);
  }
  const selected = new Set(current.selectedItemIds);
  incoming.forEach((itemId) => {
    if (mode === 'add') selected.add(itemId);
    if (mode === 'remove') selected.delete(itemId);
    if (mode === 'toggle') {
      if (selected.has(itemId)) selected.delete(itemId);
      else selected.add(itemId);
    }
  });
  return normalizeVideoEditTimelineControllerState({ ...current, selectedItemIds: [...selected] }, options);
}

export function applyVideoEditTimelineControllerToTimeline(
  timeline: VideoEditTimelineV2,
  controller: VideoEditTimelineControllerState,
): VideoEditTimelineV2 {
  const normalized = normalizeVideoEditTimelineControllerState(controller, {
    duration: videoEditTimelineDuration(timeline),
    knownItemIds: timeline.items.map((item) => item.id),
  });
  return {
    ...cloneTimeline(timeline),
    playhead: normalized.playhead,
    zoom: normalized.zoom,
    scrollLeft: normalized.scrollLeft,
    selectedItemIds: normalized.selectedItemIds,
    snapEnabled: normalized.snapEnabled,
  };
}

export function keepVideoEditTimelineTimeInView(
  controller: VideoEditTimelineControllerState,
  time: number,
  viewportWidth: number,
  options: VideoEditTimelineKeepTimeInViewOptions = {},
): VideoEditTimelineControllerState {
  const normalized = normalizeVideoEditTimelineControllerState(controller, options);
  const padding = Math.max(0, finiteNumber(options.padding, 20));
  const width = Math.max(1, finiteNumber(viewportWidth, 1));
  const duration = Math.max(0, finiteNumber(options.duration, Number.MAX_SAFE_INTEGER));
  const playhead = roundTimelineSecond(clampFiniteNumber(time, 0, duration, 0));
  const x = videoEditTimelineTimeToX(playhead, {
    ...options,
    zoom: normalized.zoom,
    scrollLeft: normalized.scrollLeft,
  });
  let scrollLeft = normalized.scrollLeft;
  if (x < padding) {
    scrollLeft += x - padding;
  } else if (x > width - padding) {
    scrollLeft += x - (width - padding);
  }
  return normalizeVideoEditTimelineControllerState({
    ...normalized,
    playhead,
    scrollLeft,
  }, options);
}

function isControllerInteractionCommand(command: VideoEditTimelineInteractionCommand): command is VideoEditTimelineControllerCommand {
  return command.type === 'seek'
    || command.type === 'scroll'
    || command.type === 'zoom'
    || command.type === 'select'
    || command.type === 'tool'
    || command.type === 'snap'
    || command.type === 'begin-drag'
    || command.type === 'update-drag'
    || command.type === 'end-drag';
}

function targetItemTrackIsLocked(timeline: VideoEditTimelineV2, itemId: string, nextTrackId?: string): boolean {
  const target = timeline.items.find((item) => item.id === itemId);
  if (!target) return false;
  if (!linkedTimelineItemGroupIsEditable(timeline, itemId)) return true;
  if (!nextTrackId) return false;
  const nextTrack = timeline.tracks.find((track) => track.id === nextTrackId);
  return !nextTrack || nextTrack.kind !== target.kind || !!nextTrack.locked;
}

export function applyVideoEditTimelineInteractionCommand(
  timeline: VideoEditTimelineV2,
  controller: VideoEditTimelineControllerState,
  command: VideoEditTimelineInteractionCommand,
  options: VideoEditTimelineInteractionOptions = {},
): VideoEditTimelineInteractionState {
  let nextTimeline = cloneTimeline(timeline);
  let nextController = sanitizeTimelineControllerForTimeline(nextTimeline, controller, options);

  if (isControllerInteractionCommand(command)) {
    nextController = applyVideoEditTimelineControllerCommand(nextController, command, controllerOptionsForTimeline(nextTimeline, options));
    nextTimeline = applyVideoEditTimelineControllerToTimeline(nextTimeline, nextController);
    nextController = sanitizeTimelineControllerForTimeline(nextTimeline, nextController, options);
    return { timeline: nextTimeline, controller: nextController };
  }

  if (command.type === 'move-item') {
    if (!targetItemTrackIsLocked(nextTimeline, command.itemId, command.trackId)) {
      nextTimeline = moveVideoEditTimelineItem(nextTimeline, command.itemId, {
        timelineStart: command.timelineStart,
        trackId: command.trackId,
      }, {
        ...options,
        snapThreshold: command.snapThreshold ?? options.snapThreshold,
      });
    }
    nextController = sanitizeTimelineControllerForTimeline(nextTimeline, { ...nextController, drag: null }, options);
    nextTimeline = applyVideoEditTimelineControllerToTimeline(nextTimeline, nextController);
    return { timeline: nextTimeline, controller: nextController };
  }

  if (command.type === 'trim-item') {
    if (!targetItemTrackIsLocked(nextTimeline, command.itemId)) {
      nextTimeline = resizeVideoEditTimelineItem(nextTimeline, command.itemId, command.edge, command.sourceTime);
    }
    nextController = sanitizeTimelineControllerForTimeline(nextTimeline, { ...nextController, drag: null }, options);
    nextTimeline = applyVideoEditTimelineControllerToTimeline(nextTimeline, nextController);
    return { timeline: nextTimeline, controller: nextController };
  }

  const itemId = command.itemId || nextController.selectedItemIds
    .map((selectedId) => nextTimeline.items.find((item) => item.id === selectedId))
    .find((item) => item?.kind === 'video')?.id;
  if (itemId && !targetItemTrackIsLocked(nextTimeline, itemId)) {
    nextTimeline = splitVideoEditTimelineItem(nextTimeline, itemId, command.time ?? nextController.playhead);
  }
  nextController = sanitizeTimelineControllerForTimeline(nextTimeline, {
    ...nextController,
    drag: null,
    selectedItemIds: nextTimeline.selectedItemIds,
  }, options);
  nextTimeline = applyVideoEditTimelineControllerToTimeline(nextTimeline, nextController);
  return { timeline: nextTimeline, controller: nextController };
}

function makeAssetId(clip: VideoEditTimelineClipLike, index: number): string {
  if (clip.assetId) return String(clip.assetId);
  if (clip.id) return `asset-${clip.id}`;
  const source = `${clip.url || ''}|${clip.name || ''}|${index}`;
  let hash = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(offset)) | 0;
  }
  return `asset-${Math.abs(hash).toString(36)}`;
}

function clipSourceRange(clip: VideoEditTimelineClipLike): { sourceIn: number; sourceOut: number; duration: number } {
  const duration = Math.max(0, finiteNumber(clip.duration, 0));
  const sourceIn = Math.max(0, finiteNumber(clip.trimStart, 0));
  const sourceOutCandidate = clip.trimEnd === undefined ? duration : finiteNumber(clip.trimEnd, duration);
  const sourceOut = Math.max(sourceIn + MIN_TIMELINE_ITEM_DURATION, duration ? Math.min(duration, sourceOutCandidate) : sourceOutCandidate);
  return {
    sourceIn: roundTimelineSecond(sourceIn),
    sourceOut: roundTimelineSecond(sourceOut),
    duration: roundTimelineSecond(Math.max(MIN_TIMELINE_ITEM_DURATION, sourceOut - sourceIn)),
  };
}

function cloneTimeline(timeline: VideoEditTimelineV2): VideoEditTimelineV2 {
  return {
    ...timeline,
    assets: timeline.assets.map((asset) => ({ ...asset })),
    tracks: timeline.tracks.map((track) => ({ ...track })),
    items: timeline.items.map((item) => ({ ...item })),
    selectedItemIds: [...timeline.selectedItemIds],
  };
}

function linkedItemIds(timeline: VideoEditTimelineV2, itemId: string): string[] {
  const target = timeline.items.find((item) => item.id === itemId);
  if (!target) return [itemId];
  const ids = new Set([itemId]);
  if (target.linkedItemId) ids.add(target.linkedItemId);
  timeline.items.forEach((item) => {
    if (item.linkedItemId === itemId) ids.add(item.id);
  });
  return [...ids];
}

function timelineTrackForItem(timeline: VideoEditTimelineV2, item: VideoEditTimelineItem): VideoEditTimelineTrack | undefined {
  return timeline.tracks.find((track) => track.id === item.trackId);
}

function timelineItemTrackIsEditable(timeline: VideoEditTimelineV2, item: VideoEditTimelineItem): boolean {
  const track = timelineTrackForItem(timeline, item);
  return !!track && track.kind === item.kind && !track.locked;
}

function linkedTimelineItems(timeline: VideoEditTimelineV2, itemId: string): VideoEditTimelineItem[] {
  const ids = new Set(linkedItemIds(timeline, itemId));
  return timeline.items.filter((item) => ids.has(item.id));
}

function linkedTimelineItemGroupIsEditable(timeline: VideoEditTimelineV2, itemId: string): boolean {
  const items = linkedTimelineItems(timeline, itemId);
  return items.length > 0 && items.every((item) => timelineItemTrackIsEditable(timeline, item));
}

function timelineItemEnd(item: VideoEditTimelineItem): number {
  return roundTimelineSecond(item.timelineStart + timelineItemDuration(item));
}

export function timelineItemDuration(item: VideoEditTimelineItem): number {
  return roundTimelineSecond(Math.max(0, finiteNumber(item.sourceOut) - finiteNumber(item.sourceIn)));
}

export function videoEditTimelineDuration(timeline: VideoEditTimelineV2): number {
  return roundTimelineSecond(timeline.items.reduce((max, item) => Math.max(max, timelineItemEnd(item)), 0));
}

function hasPrimaryVideoTimelineGaps(clips: VideoEditTimelineRenderSegment[], duration: number): boolean {
  if (clips.length === 0) return false;
  const layerIndexes = clips.map((clip) => clip.layerIndex);
  const primaryLayerIndex = Math.min(...layerIndexes);
  const primaryClips = clips
    .filter((clip) => clip.layerIndex === primaryLayerIndex)
    .slice()
    .sort((a, b) => a.timelineStart - b.timelineStart || a.timelineEnd - b.timelineEnd || a.sourceItemId.localeCompare(b.sourceItemId));
  if (primaryClips.length === 0) return false;
  let cursor = 0;
  for (const clip of primaryClips) {
    if (clip.timelineStart - cursor > 0.05) return true;
    cursor = Math.max(cursor, clip.timelineEnd);
  }
  return duration - cursor > 0.05;
}

function renderPlanTimelineDuration(
  clips: VideoEditTimelineRenderSegment[],
  audio: VideoEditTimelineRenderAudioSegment[],
  text: VideoEditTimelineRenderTextSegment[],
): number {
  const videoDuration = clips.reduce((max, clip) => Math.max(max, clip.timelineEnd), 0);
  if (videoDuration > 0) return roundTimelineSecond(videoDuration);

  return roundTimelineSecond([...audio, ...text].reduce((max, item) => Math.max(max, item.timelineEnd), 0));
}

export interface VideoEditTimelinePlayback {
  item: VideoEditTimelineItem | null;
  asset: VideoEditTimelineAsset | null;
  timelineTime: number;
  sourceTime: number;
  trimStart: number;
  trimEnd: number;
}

function timelinePlaybackVideoItems(timeline: VideoEditTimelineV2): VideoEditTimelineItem[] {
  const tracks = new Map(timeline.tracks.map((track) => [track.id, track]));
  const soloVideoTrackIds = new Set(
    timeline.tracks
      .filter((track) => track.kind === 'video' && !track.hidden && track.solo)
      .map((track) => track.id),
  );
  return timeline.items
    .filter((item) => {
      const track = tracks.get(item.trackId);
      return item.kind === 'video'
        && track?.kind === 'video'
        && !track.hidden
        && (soloVideoTrackIds.size === 0 || soloVideoTrackIds.has(track.id))
        && timelineItemDuration(item) > 0;
    })
    .sort((a, b) => {
      const trackA = tracks.get(a.trackId);
      const trackB = tracks.get(b.trackId);
      return a.timelineStart - b.timelineStart
        || (trackA?.order ?? 0) - (trackB?.order ?? 0)
        || a.id.localeCompare(b.id);
    });
}

export function resolveVideoEditTimelinePlayback(
  timeline: VideoEditTimelineV2,
  preferredItemId?: string,
): VideoEditTimelinePlayback {
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const videoItems = timelinePlaybackVideoItems(timeline);
  const duration = videoEditTimelineDuration(timeline);
  const timelineTime = roundTimelineSecond(Math.max(0, Math.min(duration, finiteNumber(timeline.playhead))));
  const selectedIds = Array.isArray(timeline.selectedItemIds) ? timeline.selectedItemIds : [];
  const containsTimelineTime = (item: VideoEditTimelineItem) => {
    const start = finiteNumber(item.timelineStart);
    const end = timelineItemEnd(item);
    return timelineTime >= start && (timelineTime < end || (timelineTime === duration && timelineTime === end));
  };
  const preferred = preferredItemId ? videoItems.find((item) => item.id === preferredItemId) : undefined;
  const tracks = new Map(timeline.tracks.map((track) => [track.id, track]));
  const trackOrder = (item: VideoEditTimelineItem) => tracks.get(item.trackId)?.order ?? 0;
  const containingItems = videoItems
    .filter(containsTimelineTime)
    .sort((a, b) => trackOrder(a) - trackOrder(b) || a.timelineStart - b.timelineStart || a.id.localeCompare(b.id));
  const primaryContaining = containingItems[0];
  const preferredAtPlayhead = preferred && containsTimelineTime(preferred) && (
    !primaryContaining || trackOrder(preferred) <= trackOrder(primaryContaining)
  ) ? preferred : undefined;
  const containing = preferredAtPlayhead || primaryContaining;
  const item = preferredAtPlayhead || containing || null;

  if (!item) {
    return {
      item: null,
      asset: null,
      timelineTime,
      sourceTime: 0,
      trimStart: 0,
      trimEnd: 0,
    };
  }

  const trimStart = roundTimelineSecond(finiteNumber(item.sourceIn));
  const trimEnd = roundTimelineSecond(Math.max(trimStart, finiteNumber(item.sourceOut, trimStart)));
  const itemStart = finiteNumber(item.timelineStart);
  const itemDuration = timelineItemDuration(item);
  const offset = containsTimelineTime(item)
    ? Math.max(0, Math.min(itemDuration, timelineTime - itemStart))
    : 0;

  return {
    item,
    asset: assets.get(item.assetId) || null,
    timelineTime,
    sourceTime: roundTimelineSecond(Math.max(trimStart, Math.min(trimEnd, trimStart + offset))),
    trimStart,
    trimEnd,
  };
}

export function videoEditTimelineTimeFromPlaybackSourceTime(
  playback: VideoEditTimelinePlayback,
  sourceTime: number,
): number {
  const item = playback.item;
  if (!item) return roundTimelineSecond(finiteNumber(playback.timelineTime));
  const trimStart = roundTimelineSecond(finiteNumber(playback.trimStart));
  const trimEnd = roundTimelineSecond(Math.max(trimStart, finiteNumber(playback.trimEnd, trimStart)));
  const source = roundTimelineSecond(Math.max(trimStart, Math.min(trimEnd, finiteNumber(sourceTime, playback.sourceTime))));
  const itemDuration = timelineItemDuration(item);
  const offset = Math.max(0, Math.min(itemDuration, source - trimStart));
  return roundTimelineSecond(finiteNumber(item.timelineStart) + offset);
}

export function createVideoEditTimelineFromClips(input: VideoEditTimelineClipLike[]): VideoEditTimelineV2 {
  const assets = new Map<string, VideoEditTimelineAsset>();
  const tracks: VideoEditTimelineTrack[] = [
    { id: MAIN_VIDEO_TRACK_ID, kind: 'video', name: '视频轨', order: 0 },
    { id: MAIN_AUDIO_TRACK_ID, kind: 'audio', name: '音频轨', order: 1 },
  ];
  const items: VideoEditTimelineItem[] = [];
  let cursor = 0;

  input.forEach((clip, index) => {
    const url = typeof clip.url === 'string' ? clip.url : '';
    if (!url) return;
    const clipId = clip.id || `clip-${index + 1}`;
    const assetId = makeAssetId(clip, index);
    const range = clipSourceRange(clip);
    if (!assets.has(assetId)) {
      assets.set(assetId, {
        id: assetId,
        kind: 'video',
        url,
        directUrl: clip.directUrl || url,
        name: clip.name || `片段 ${index + 1}`,
        duration: optionalFiniteNumber(clip.duration),
        width: optionalFiniteNumber(clip.width),
        height: optionalFiniteNumber(clip.height),
        size: optionalFiniteNumber(clip.size),
        mime: clip.mime,
        thumbnailUrl: clip.thumbnailUrl,
        filmstripUrls: Array.isArray(clip.filmstripUrls) ? [...clip.filmstripUrls] : undefined,
        filmstripTimes: Array.isArray(clip.filmstripTimes) ? [...clip.filmstripTimes] : undefined,
        waveformPeaks: Array.isArray(clip.waveformPeaks) ? [...clip.waveformPeaks] : undefined,
        hasAudio: clip.hasAudio,
        sourceNodeId: clip.sourceNodeId,
        sourceCanvasId: clip.sourceCanvasId,
        sourceLabel: clip.sourceLabel,
      });
    }

    const videoItemId = `item-${clipId}-video`;
    const audioItemId = `item-${clipId}-audio`;
    const videoItem: VideoEditTimelineItem = {
      id: videoItemId,
      assetId,
      trackId: MAIN_VIDEO_TRACK_ID,
      kind: 'video',
      timelineStart: roundTimelineSecond(cursor),
      sourceIn: range.sourceIn,
      sourceOut: range.sourceOut,
      muted: !!clip.muted,
      label: clip.name || `片段 ${index + 1}`,
      linkedItemId: clip.hasAudio === false ? undefined : audioItemId,
    };
    items.push(videoItem);

    if (clip.hasAudio !== false) {
      items.push({
        id: audioItemId,
        assetId,
        trackId: MAIN_AUDIO_TRACK_ID,
        kind: 'audio',
        timelineStart: videoItem.timelineStart,
        sourceIn: range.sourceIn,
        sourceOut: range.sourceOut,
        muted: !!clip.muted,
        volume: clip.muted ? 0 : 1,
        label: clip.name || `音频 ${index + 1}`,
        linkedItemId: videoItemId,
      });
    }
    cursor = roundTimelineSecond(cursor + range.duration);
  });

  return {
    version: 2,
    assets: [...assets.values()],
    tracks,
    items,
    selectedItemIds: items[0] ? [items[0].id] : [],
    playhead: 0,
    zoom: 1,
    scrollLeft: 0,
    snapEnabled: true,
  };
}

export function normalizeVideoEditTimeline(input: unknown, clips: VideoEditTimelineClipLike[] = []): VideoEditTimelineV2 {
  if (!input || typeof input !== 'object' || (input as Partial<VideoEditTimelineV2>).version !== 2) {
    return createVideoEditTimelineFromClips(clips);
  }
  const raw = input as Partial<VideoEditTimelineV2>;
  const timeline: VideoEditTimelineV2 = {
    version: 2,
    assets: Array.isArray(raw.assets) ? raw.assets.flatMap((asset): VideoEditTimelineAsset[] => {
      if (!asset || typeof asset !== 'object') return [];
      const next = asset as Partial<VideoEditTimelineAsset>;
      if (!next.id || (next.kind !== 'text' && !next.url)) return [];
      return [{
        id: String(next.id),
        kind: next.kind || 'video',
        url: typeof next.url === 'string' ? next.url : '',
        directUrl: typeof next.directUrl === 'string' ? next.directUrl : (typeof next.url === 'string' ? next.url : ''),
        name: typeof next.name === 'string' && next.name ? next.name : String(next.id),
        duration: Number.isFinite(Number(next.duration)) ? Number(next.duration) : undefined,
        width: Number.isFinite(Number(next.width)) ? Number(next.width) : undefined,
        height: Number.isFinite(Number(next.height)) ? Number(next.height) : undefined,
        size: Number.isFinite(Number(next.size)) ? Number(next.size) : undefined,
        mime: typeof next.mime === 'string' ? next.mime : undefined,
        thumbnailUrl: typeof next.thumbnailUrl === 'string' ? next.thumbnailUrl : undefined,
        filmstripUrls: Array.isArray(next.filmstripUrls) ? next.filmstripUrls.filter((item) => typeof item === 'string') : undefined,
        filmstripTimes: Array.isArray(next.filmstripTimes) ? next.filmstripTimes.map(Number).filter(Number.isFinite) : undefined,
        waveformPeaks: Array.isArray(next.waveformPeaks) ? next.waveformPeaks.map(Number).filter(Number.isFinite) : undefined,
        hasAudio: typeof next.hasAudio === 'boolean' ? next.hasAudio : undefined,
        sourceNodeId: typeof next.sourceNodeId === 'string' ? next.sourceNodeId : undefined,
        sourceCanvasId: typeof next.sourceCanvasId === 'string' ? next.sourceCanvasId : undefined,
        sourceLabel: typeof next.sourceLabel === 'string' ? next.sourceLabel : undefined,
        text: typeof next.text === 'string' ? next.text : undefined,
        textPosition: typeof next.textPosition === 'string' ? next.textPosition : undefined,
        textColor: typeof next.textColor === 'string' ? next.textColor : undefined,
        textFontSize: Number.isFinite(Number(next.textFontSize)) ? Number(next.textFontSize) : undefined,
        textBackground: typeof next.textBackground === 'string' ? next.textBackground : undefined,
      }];
    }) : [],
    tracks: Array.isArray(raw.tracks) ? raw.tracks.flatMap((track, index): VideoEditTimelineTrack[] => {
      if (!track || typeof track !== 'object') return [];
      const next = track as Partial<VideoEditTimelineTrack>;
      if (!next.id) return [];
      return [{
        id: String(next.id),
        kind: next.kind || 'video',
        name: typeof next.name === 'string' && next.name ? next.name : `轨道 ${index + 1}`,
        order: Number.isFinite(Number(next.order)) ? Number(next.order) : index,
        muted: !!next.muted,
        locked: !!next.locked,
        hidden: !!next.hidden,
        solo: !!next.solo,
        collapsed: !!next.collapsed,
      }];
    }) : [],
    items: Array.isArray(raw.items) ? raw.items.flatMap((item): VideoEditTimelineItem[] => {
      if (!item || typeof item !== 'object') return [];
      const next = item as Partial<VideoEditTimelineItem>;
      if (!next.id || !next.assetId || !next.trackId) return [];
      const sourceIn = Math.max(0, finiteNumber(next.sourceIn, 0));
      const sourceOut = Math.max(sourceIn + MIN_TIMELINE_ITEM_DURATION, finiteNumber(next.sourceOut, sourceIn + 1));
      const itemDuration = Math.max(MIN_TIMELINE_ITEM_DURATION, sourceOut - sourceIn);
      return [{
        id: String(next.id),
        assetId: String(next.assetId),
        trackId: String(next.trackId),
        kind: next.kind || 'video',
        timelineStart: roundTimelineSecond(finiteNumber(next.timelineStart, 0)),
        sourceIn: roundTimelineSecond(sourceIn),
        sourceOut: roundTimelineSecond(sourceOut),
        muted: !!next.muted,
        volume: Number.isFinite(Number(next.volume)) ? Number(next.volume) : undefined,
        audioFadeIn: normalizeVideoEditAudioFade(next.audioFadeIn, itemDuration),
        audioFadeOut: normalizeVideoEditAudioFade(next.audioFadeOut, itemDuration),
        volumeCurve: normalizeVideoEditAudioVolumeCurve(next.volumeCurve),
        x: Number.isFinite(Number(next.x)) ? clampFiniteNumber(next.x, 0, 100, 0) : undefined,
        y: Number.isFinite(Number(next.y)) ? clampFiniteNumber(next.y, 0, 100, 0) : undefined,
        scale: Number.isFinite(Number(next.scale)) ? clampFiniteNumber(next.scale, 0.1, 2, 1) : undefined,
        opacity: Number.isFinite(Number(next.opacity)) ? clampFiniteNumber(next.opacity, 0, 1, 1) : undefined,
        transitionIn: typeof next.transitionIn === 'string' ? next.transitionIn : undefined,
        transitionOut: typeof next.transitionOut === 'string' ? next.transitionOut : undefined,
        linkedItemId: typeof next.linkedItemId === 'string' ? next.linkedItemId : undefined,
        label: typeof next.label === 'string' ? next.label : undefined,
      }];
    }) : [],
    selectedItemIds: Array.isArray(raw.selectedItemIds) ? raw.selectedItemIds.filter((item): item is string => typeof item === 'string') : [],
    playhead: roundTimelineSecond(finiteNumber(raw.playhead, 0)),
    zoom: Math.max(0.1, finiteNumber(raw.zoom, 1)),
    scrollLeft: Math.max(0, finiteNumber(raw.scrollLeft, 0)),
    snapEnabled: raw.snapEnabled !== false,
  };
  if (!timeline.tracks.length) {
    timeline.tracks = [
      { id: MAIN_VIDEO_TRACK_ID, kind: 'video', name: '视频轨', order: 0 },
      { id: MAIN_AUDIO_TRACK_ID, kind: 'audio', name: '音频轨', order: 1 },
    ];
  }
  return timeline;
}

export function syncVideoEditTimelineWithClips(
  input: unknown,
  clips: VideoEditTimelineClipLike[] = [],
): VideoEditTimelineV2 {
  const next = normalizeVideoEditTimeline(input, clips);
  if (!clips.length) {
    return {
      ...next,
      assets: next.assets.filter((asset) => next.items.some((item) => item.assetId === asset.id && item.trackId !== MAIN_VIDEO_TRACK_ID && item.trackId !== MAIN_AUDIO_TRACK_ID)),
      items: next.items.filter((item) => item.trackId !== MAIN_VIDEO_TRACK_ID && item.trackId !== MAIN_AUDIO_TRACK_ID),
      selectedItemIds: next.selectedItemIds.filter((id) => next.items.some((item) => item.id === id && item.trackId !== MAIN_VIDEO_TRACK_ID && item.trackId !== MAIN_AUDIO_TRACK_ID)),
    };
  }

  if (!next.tracks.some((track) => track.id === MAIN_VIDEO_TRACK_ID)) {
    next.tracks.push({ id: MAIN_VIDEO_TRACK_ID, kind: 'video', name: '视频轨', order: 0 });
  }
  if (!next.tracks.some((track) => track.id === MAIN_AUDIO_TRACK_ID)) {
    const maxOrder = next.tracks.reduce((value, track) => Math.max(value, track.order), 0);
    next.tracks.push({ id: MAIN_AUDIO_TRACK_ID, kind: 'audio', name: '音频轨', order: maxOrder + 1 });
  }

  const clipEntries = clips.flatMap((clip, index) => {
    const url = typeof clip.url === 'string' ? clip.url : '';
    if (!url) return [];
    const clipId = clip.id || `clip-${index + 1}`;
    return [{
      clip,
      index,
      clipId,
      assetId: makeAssetId(clip, index),
      videoItemId: `item-${clipId}-video`,
      audioItemId: `item-${clipId}-audio`,
      range: clipSourceRange(clip),
    }];
  });
  const clipAssetIds = new Set(clipEntries.map((entry) => entry.assetId));
  const legacyVideoItemIds = new Set(clipEntries.map((entry) => entry.videoItemId));
  const legacyAudioItemIds = new Set(clipEntries.map((entry) => entry.audioItemId));

  next.assets = next.assets.map((asset) => {
    const entry = clipEntries.find((item) => item.assetId === asset.id);
    if (!entry) return asset;
    const clip = entry.clip;
    return {
      ...asset,
      kind: 'video',
      url: typeof clip.url === 'string' && clip.url ? clip.url : asset.url,
      directUrl: typeof clip.directUrl === 'string' && clip.directUrl ? clip.directUrl : asset.directUrl,
      name: typeof clip.name === 'string' && clip.name ? clip.name : asset.name,
      duration: optionalFiniteNumber(clip.duration) ?? asset.duration,
      width: optionalFiniteNumber(clip.width) ?? asset.width,
      height: optionalFiniteNumber(clip.height) ?? asset.height,
      size: optionalFiniteNumber(clip.size) ?? asset.size,
      mime: typeof clip.mime === 'string' ? clip.mime : asset.mime,
      thumbnailUrl: typeof clip.thumbnailUrl === 'string' ? clip.thumbnailUrl : asset.thumbnailUrl,
      filmstripUrls: Array.isArray(clip.filmstripUrls) ? [...clip.filmstripUrls] : asset.filmstripUrls,
      filmstripTimes: Array.isArray(clip.filmstripTimes) ? [...clip.filmstripTimes] : asset.filmstripTimes,
      waveformPeaks: Array.isArray(clip.waveformPeaks) ? [...clip.waveformPeaks] : asset.waveformPeaks,
      hasAudio: typeof clip.hasAudio === 'boolean' ? clip.hasAudio : asset.hasAudio,
      sourceNodeId: typeof clip.sourceNodeId === 'string' ? clip.sourceNodeId : asset.sourceNodeId,
      sourceCanvasId: typeof clip.sourceCanvasId === 'string' ? clip.sourceCanvasId : asset.sourceCanvasId,
      sourceLabel: typeof clip.sourceLabel === 'string' ? clip.sourceLabel : asset.sourceLabel,
    };
  });

  const existingAssetIds = new Set(next.assets.map((asset) => asset.id));
  clipEntries.forEach((entry) => {
    if (existingAssetIds.has(entry.assetId)) return;
    const clip = entry.clip;
    next.assets.push({
      id: entry.assetId,
      kind: 'video',
      url: String(clip.url),
      directUrl: clip.directUrl || clip.url,
      name: clip.name || `片段 ${entry.index + 1}`,
      duration: optionalFiniteNumber(clip.duration),
      width: optionalFiniteNumber(clip.width),
      height: optionalFiniteNumber(clip.height),
      size: optionalFiniteNumber(clip.size),
      mime: clip.mime,
      thumbnailUrl: clip.thumbnailUrl,
      filmstripUrls: Array.isArray(clip.filmstripUrls) ? [...clip.filmstripUrls] : undefined,
      filmstripTimes: Array.isArray(clip.filmstripTimes) ? [...clip.filmstripTimes] : undefined,
      waveformPeaks: Array.isArray(clip.waveformPeaks) ? [...clip.waveformPeaks] : undefined,
      hasAudio: clip.hasAudio,
      sourceNodeId: clip.sourceNodeId,
      sourceCanvasId: clip.sourceCanvasId,
      sourceLabel: clip.sourceLabel,
    });
    existingAssetIds.add(entry.assetId);
  });

  const removedLegacyIds = new Set<string>();
  next.items.forEach((item) => {
    if (item.trackId === MAIN_VIDEO_TRACK_ID && item.id.endsWith('-video') && !legacyVideoItemIds.has(item.id) && !clipAssetIds.has(item.assetId)) {
      removedLegacyIds.add(item.id);
    }
    if (item.trackId === MAIN_AUDIO_TRACK_ID && item.id.endsWith('-audio') && !legacyAudioItemIds.has(item.id) && !clipAssetIds.has(item.assetId)) {
      removedLegacyIds.add(item.id);
    }
  });
  next.items = next.items.filter((item) => !removedLegacyIds.has(item.id));

  clipEntries.forEach((entry) => {
    const videoItemIndex = next.items.findIndex((item) => item.id === entry.videoItemId);
    if (videoItemIndex >= 0) {
      const before = next.items[videoItemIndex];
      const beforeDuration = timelineItemDuration(before);
      const beforeEnd = timelineItemEnd(before);
      const durationDelta = roundTimelineDelta(entry.range.duration - beforeDuration);
      next.items[videoItemIndex] = {
        ...before,
        assetId: entry.assetId,
        kind: 'video',
        trackId: before.trackId || MAIN_VIDEO_TRACK_ID,
        sourceIn: entry.range.sourceIn,
        sourceOut: entry.range.sourceOut,
        muted: !!entry.clip.muted,
        label: entry.clip.name || before.label,
      };
      if (Math.abs(durationDelta) > 0.0001) {
        next.items = next.items.map((item) => {
          if (item.id === before.id || item.trackId !== before.trackId || item.timelineStart < beforeEnd - 0.0001) return item;
          return { ...item, timelineStart: roundTimelineSecond(item.timelineStart + durationDelta) };
        });
      }
    }

    const audioItemIndex = next.items.findIndex((item) => item.id === entry.audioItemId);
    if (entry.clip.hasAudio === false) {
      if (audioItemIndex >= 0) {
        next.items.splice(audioItemIndex, 1);
      }
    } else if (audioItemIndex >= 0) {
      const before = next.items[audioItemIndex];
      next.items[audioItemIndex] = {
        ...before,
        assetId: entry.assetId,
        kind: 'audio',
        trackId: before.trackId || MAIN_AUDIO_TRACK_ID,
        sourceIn: entry.range.sourceIn,
        sourceOut: entry.range.sourceOut,
        muted: !!entry.clip.muted,
        volume: entry.clip.muted ? 0 : before.volume ?? 1,
        label: entry.clip.name || before.label,
        linkedItemId: entry.videoItemId,
      };
    }
  });

  let cursor = roundTimelineSecond(
    next.items
      .filter((item) => item.trackId === MAIN_VIDEO_TRACK_ID)
      .reduce((max, item) => Math.max(max, timelineItemEnd(item)), 0),
  );
  clipEntries.forEach((entry) => {
    if (next.items.some((item) => item.id === entry.videoItemId)) return;
    next.items.push({
      id: entry.videoItemId,
      assetId: entry.assetId,
      trackId: MAIN_VIDEO_TRACK_ID,
      kind: 'video',
      timelineStart: cursor,
      sourceIn: entry.range.sourceIn,
      sourceOut: entry.range.sourceOut,
      muted: !!entry.clip.muted,
      label: entry.clip.name || `片段 ${entry.index + 1}`,
      linkedItemId: entry.clip.hasAudio === false ? undefined : entry.audioItemId,
    });
    if (entry.clip.hasAudio !== false) {
      next.items.push({
        id: entry.audioItemId,
        assetId: entry.assetId,
        trackId: MAIN_AUDIO_TRACK_ID,
        kind: 'audio',
        timelineStart: cursor,
        sourceIn: entry.range.sourceIn,
        sourceOut: entry.range.sourceOut,
        muted: !!entry.clip.muted,
        volume: entry.clip.muted ? 0 : 1,
        label: entry.clip.name || `音频 ${entry.index + 1}`,
        linkedItemId: entry.videoItemId,
      });
    }
    cursor = roundTimelineSecond(cursor + entry.range.duration);
  });

  const referencedAssetIds = new Set(next.items.map((item) => item.assetId));
  next.assets = next.assets.filter((asset) => referencedAssetIds.has(asset.id));
  next.selectedItemIds = next.selectedItemIds.filter((itemId) => next.items.some((item) => item.id === itemId));
  if (!next.selectedItemIds.length && next.items[0]) {
    next.selectedItemIds = [next.items[0].id];
  }
  return next;
}

// Explicit playlist ordering must move timeline items; ordinary metadata sync
// deliberately preserves their positions. Keep custom items in their existing
// slots, preserve gaps, and move linked audio by the same delta as its video.
export function reorderVideoEditTimelineWithClips(
  input: unknown,
  clips: VideoEditTimelineClipLike[],
): VideoEditTimelineV2 {
  const timeline = normalizeVideoEditTimeline(input, clips);
  const mainItems = timeline.items
    .filter((item) => item.kind === 'video' && item.trackId === MAIN_VIDEO_TRACK_ID)
    .sort((a, b) => a.timelineStart - b.timelineStart);
  const byId = new Map(mainItems.map((item) => [item.id, item]));
  const ordered = clips.flatMap((clip) => {
    const item = clip.id ? byId.get(`item-${clip.id}-video`) : undefined;
    return item ? [item] : [];
  });
  const managedIds = new Set(ordered.map((item) => item.id));
  let orderIndex = 0;
  let cursor = 0;
  const starts = new Map<string, number>();
  mainItems.forEach((slot, index) => {
    const previousEnd = index ? timelineItemEnd(mainItems[index - 1]) : 0;
    const gap = Math.max(0, slot.timelineStart - previousEnd);
    const item = managedIds.has(slot.id) ? ordered[orderIndex++] : slot;
    cursor = roundTimelineSecond(cursor + gap);
    starts.set(item.id, cursor);
    cursor = roundTimelineSecond(cursor + timelineItemDuration(item));
  });
  const deltas = new Map(mainItems.map((item) => [item.id, (starts.get(item.id) ?? item.timelineStart) - item.timelineStart]));
  timeline.items = timeline.items.map((item) => {
    const start = starts.get(item.id);
    if (start !== undefined) return { ...item, timelineStart: start };
    if (item.kind !== 'audio') return item;
    const linkedVideo = item.linkedItemId && byId.get(item.linkedItemId)
      || mainItems.find((video) => video.linkedItemId === item.id);
    const delta = linkedVideo ? deltas.get(linkedVideo.id) ?? 0 : 0;
    return delta ? { ...item, timelineStart: roundTimelineSecond(item.timelineStart + delta) } : item;
  });
  return timeline;
}

export function snapVideoEditTimelineTime(time: number, snapPoints: number[], threshold = 0.08): number {
  const current = finiteNumber(time, 0);
  const safeThreshold = Math.max(0, finiteNumber(threshold, 0));
  let best = current;
  let bestDistance = Number.POSITIVE_INFINITY;
  snapPoints.forEach((point) => {
    const candidate = finiteNumber(point, Number.NaN);
    if (!Number.isFinite(candidate)) return;
    const distance = Math.abs(candidate - current);
    if (distance <= safeThreshold && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });
  return roundTimelineSecond(best);
}

function timelineSnapItemLabel(item: VideoEditTimelineItem): string {
  return item.label || item.id;
}

function collectSnapTargets(timeline: VideoEditTimelineV2, excludedIds: Set<string>): VideoEditTimelineSnapTarget[] {
  const points: VideoEditTimelineSnapTarget[] = [
    { time: 0, kind: 'timeline-start', label: '时间线起点' },
    { time: timeline.playhead, kind: 'playhead', label: '播放头' },
    { time: videoEditTimelineDuration(timeline), kind: 'timeline-end', label: '时间线终点' },
  ];
  timeline.items.forEach((item) => {
    if (excludedIds.has(item.id)) return;
    const itemLabel = timelineSnapItemLabel(item);
    points.push(
      { time: item.timelineStart, kind: 'item-start', label: `片段起点 · ${itemLabel}`, sourceItemId: item.id },
      { time: timelineItemEnd(item), kind: 'item-end', label: `片段终点 · ${itemLabel}`, sourceItemId: item.id },
    );
  });
  return points;
}

function collectSnapPoints(timeline: VideoEditTimelineV2, excludedIds: Set<string>): number[] {
  return collectSnapTargets(timeline, excludedIds).map((point) => point.time);
}

function normalizeVideoEditTimelineSnapTargets(snapPoints: Array<number | VideoEditTimelineSnapTarget>): VideoEditTimelineSnapTarget[] {
  const targets: VideoEditTimelineSnapTarget[] = [];
  snapPoints.forEach((point) => {
    if (typeof point === 'number') {
      if (Number.isFinite(point)) {
        targets.push({ time: point, kind: 'custom', label: '吸附点' });
      }
      return;
    }
    const time = finiteNumber(point.time, Number.NaN);
    if (!Number.isFinite(time)) return;
    targets.push({
      time,
      kind: point.kind,
      label: point.label || '吸附点',
      sourceItemId: point.sourceItemId,
    });
  });
  return targets;
}

export function resolveVideoEditTimelineSnap(
  timeline: VideoEditTimelineV2,
  time: number,
  options: VideoEditTimelineSnapOptions = {},
): VideoEditTimelineSnapResult {
  const input = roundTimelineSecond(finiteNumber(time, 0));
  const threshold = Math.max(0, finiteNumber(options.threshold, 0));
  const excludedIds = new Set((options.excludedItemIds || []).map(String));
  const targets = options.snapPoints
    ? normalizeVideoEditTimelineSnapTargets(options.snapPoints)
    : collectSnapTargets(timeline, excludedIds);
  let best: VideoEditTimelineSnapTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const targetTime = finiteNumber(target.time, Number.NaN);
    if (!Number.isFinite(targetTime)) continue;
    const distance = Math.abs(targetTime - input);
    if (distance <= threshold && distance < bestDistance) {
      best = { ...target, time: roundTimelineSecond(targetTime) };
      bestDistance = distance;
    }
  }
  if (!best) {
    return {
      input,
      time: input,
      snapped: false,
      distance: 0,
      threshold,
      kind: 'none',
      label: '未吸附',
    };
  }
  return {
    input,
    time: best.time,
    snapped: true,
    distance: roundTimelineDelta(bestDistance),
    threshold,
    kind: best.kind,
    label: best.label,
    sourceItemId: best.sourceItemId,
  };
}

export function moveVideoEditTimelineItem(
  timeline: VideoEditTimelineV2,
  itemId: string,
  patch: { timelineStart?: number; trackId?: string },
  options: VideoEditTimelineMoveOptions = {},
): VideoEditTimelineV2 {
  const next = cloneTimeline(timeline);
  const target = next.items.find((item) => item.id === itemId);
  if (!target) return next;
  if (!linkedTimelineItemGroupIsEditable(next, itemId)) return next;
  const targetTrack = patch.trackId ? next.tracks.find((track) => track.id === patch.trackId) : undefined;
  if (patch.trackId && (!targetTrack || targetTrack.kind !== target.kind || targetTrack.locked)) return next;

  const ids = new Set(linkedItemIds(next, itemId));
  const snappedStart = patch.timelineStart === undefined
    ? target.timelineStart
    : snapVideoEditTimelineTime(
      patch.timelineStart,
      options.snapPoints || collectSnapPoints(next, ids),
      options.snapThreshold ?? 0,
    );
  const delta = roundTimelineDelta(snappedStart - target.timelineStart);

  next.items = next.items.map((item) => {
    if (!ids.has(item.id)) return item;
    return {
      ...item,
      trackId: item.id === itemId && patch.trackId ? patch.trackId : item.trackId,
      timelineStart: roundTimelineSecond(item.timelineStart + delta),
    };
  });
  return next;
}

export function resizeVideoEditTimelineItem(
  timeline: VideoEditTimelineV2,
  itemId: string,
  edge: 'start' | 'end',
  nextSourceTime: number,
): VideoEditTimelineV2 {
  const next = cloneTimeline(timeline);
  const target = next.items.find((item) => item.id === itemId);
  if (!target) return next;
  if (!linkedTimelineItemGroupIsEditable(next, itemId)) return next;
  const ids = new Set(linkedItemIds(next, itemId));
  const beforeSourceIn = target.sourceIn;
  const beforeSourceOut = target.sourceOut;
  const beforeDuration = timelineItemDuration(target);
  let sourceIn = beforeSourceIn;
  let sourceOut = beforeSourceOut;
  if (edge === 'start') {
    sourceIn = roundTimelineSecond(Math.min(beforeSourceOut - MIN_TIMELINE_ITEM_DURATION, Math.max(0, nextSourceTime)));
  } else {
    sourceOut = roundTimelineSecond(Math.max(beforeSourceIn + MIN_TIMELINE_ITEM_DURATION, nextSourceTime));
  }
  const deltaStart = sourceIn - beforeSourceIn;
  const afterDuration = Math.max(MIN_TIMELINE_ITEM_DURATION, sourceOut - sourceIn);

  next.items = next.items.map((item) => {
    if (!ids.has(item.id)) return item;
    return {
      ...item,
      sourceIn,
      sourceOut,
      timelineStart: edge === 'start'
        ? roundTimelineSecond(item.timelineStart + deltaStart)
        : item.timelineStart,
    };
  });

  const durationDelta = roundTimelineDelta(afterDuration - beforeDuration);
  if (edge === 'end' && Math.abs(durationDelta) > 0.0001) {
    const targetEndBefore = roundTimelineSecond(target.timelineStart + beforeDuration);
    const affectedTrackIds = new Set(
      next.items
        .filter((item) => ids.has(item.id))
        .map((item) => item.trackId),
    );
    next.items = next.items.map((item) => {
      if (ids.has(item.id) || !affectedTrackIds.has(item.trackId) || item.timelineStart < targetEndBefore - 0.0001) return item;
      return { ...item, timelineStart: roundTimelineSecond(item.timelineStart + durationDelta) };
    });
  }
  return next;
}

export function splitVideoEditTimelineItem(timeline: VideoEditTimelineV2, itemId: string, timelineTime: number): VideoEditTimelineV2 {
  const next = cloneTimeline(timeline);
  const target = next.items.find((item) => item.id === itemId);
  if (!target) return next;
  if (!linkedTimelineItemGroupIsEditable(next, itemId)) return next;
  const splitAt = roundTimelineSecond(finiteNumber(timelineTime, target.timelineStart));
  const offset = splitAt - target.timelineStart;
  const duration = timelineItemDuration(target);
  if (offset <= MIN_TIMELINE_ITEM_DURATION || offset >= duration - MIN_TIMELINE_ITEM_DURATION) return next;

  const groupIds = linkedItemIds(next, itemId);
  const groupItems = groupIds
    .map((id) => next.items.find((item) => item.id === id))
    .filter((item): item is VideoEditTimelineItem => !!item);
  const splitIdByOriginal = new Map(groupItems.map((item) => [item.id, `${item.id}-split`]));
  const replacements = new Map<string, [VideoEditTimelineItem, VideoEditTimelineItem]>();

  for (const item of groupItems) {
    const itemOffset = splitAt - item.timelineStart;
    const itemDuration = timelineItemDuration(item);
    if (itemOffset <= MIN_TIMELINE_ITEM_DURATION || itemOffset >= itemDuration - MIN_TIMELINE_ITEM_DURATION) return next;

    const sourceSplit = roundTimelineSecond(item.sourceIn + itemOffset);
    const left: VideoEditTimelineItem = { ...item, sourceOut: sourceSplit };
    const right: VideoEditTimelineItem = {
      ...item,
      id: splitIdByOriginal.get(item.id) || `${item.id}-split`,
      timelineStart: splitAt,
      sourceIn: sourceSplit,
      linkedItemId: item.linkedItemId ? splitIdByOriginal.get(item.linkedItemId) : undefined,
    };
    replacements.set(item.id, [left, right]);
  }

  next.items = next.items.flatMap((item) => replacements.get(item.id) || [item]);
  next.selectedItemIds = groupItems
    .map((item) => splitIdByOriginal.get(item.id))
    .filter((id): id is string => !!id);
  return next;
}

type VideoEditTimelineRangePiece = {
  sourceId: string;
  sourceLinkedItemId?: string;
  partKey: 'whole' | 'left' | 'right';
  item: VideoEditTimelineItem;
};

function makeTimelineRangePieceId(item: VideoEditTimelineItem, partKey: VideoEditTimelineRangePiece['partKey'], stamp: string): string {
  if (partKey === 'whole' || partKey === 'left') return item.id;
  return `${item.id}-${stamp}`;
}

function makeTimelineRangePiece(
  item: VideoEditTimelineItem,
  timelineStart: number,
  timelineEnd: number,
  partKey: VideoEditTimelineRangePiece['partKey'],
  stamp: string,
): VideoEditTimelineRangePiece | null {
  const start = roundTimelineSecond(Math.max(item.timelineStart, timelineStart));
  const end = roundTimelineSecond(Math.min(timelineItemEnd(item), timelineEnd));
  if (end - start < MIN_TIMELINE_ITEM_DURATION) return null;
  const offset = roundTimelineDelta(start - item.timelineStart);
  return {
    sourceId: item.id,
    sourceLinkedItemId: item.linkedItemId,
    partKey,
    item: {
      ...item,
      id: makeTimelineRangePieceId(item, partKey, stamp),
      timelineStart: start,
      sourceIn: roundTimelineSecond(item.sourceIn + offset),
      sourceOut: roundTimelineSecond(item.sourceIn + offset + (end - start)),
    },
  };
}

function relinkTimelineRangePieces(pieces: VideoEditTimelineRangePiece[]): VideoEditTimelineItem[] {
  const idBySourceAndPart = new Map(
    pieces.map((piece) => [`${piece.sourceId}:${piece.partKey}`, piece.item.id]),
  );
  return pieces.map((piece) => ({
    ...piece.item,
    linkedItemId: piece.sourceLinkedItemId
      ? idBySourceAndPart.get(`${piece.sourceLinkedItemId}:${piece.partKey}`)
      : undefined,
  }));
}

function timelineRangeEditShouldTouchItem(
  item: VideoEditTimelineItem,
  trackIds: Set<string> | null,
  includeText: boolean,
): boolean {
  if (trackIds && !trackIds.has(item.trackId)) return false;
  if (!includeText && item.kind === 'text') return false;
  return true;
}

export function insertVideoEditTimelineRange(
  timeline: VideoEditTimelineV2,
  insertStartInput: number,
  insertDurationInput: number,
  options: VideoEditTimelineRangeEditOptions = {},
): VideoEditTimelineV2 {
  const next = cloneTimeline(timeline);
  const insertStart = roundTimelineSecond(finiteNumber(insertStartInput, next.playhead));
  const insertDuration = roundTimelineSecond(Math.max(MIN_TIMELINE_ITEM_DURATION, finiteNumber(insertDurationInput, 0)));
  const targetTrackIds = options.targetTrackIds?.length ? new Set(options.targetTrackIds) : null;
  const includeText = options.includeText !== false;
  const stamp = options.stamp || `insert-${Date.now().toString(36)}`;

  const touchesLocked = next.items.some((item) => {
    if (!timelineRangeEditShouldTouchItem(item, targetTrackIds, includeText)) return false;
    if (timelineItemEnd(item) <= insertStart + 0.0001) return false;
    return !timelineItemTrackIsEditable(next, item);
  });
  if (touchesLocked) return cloneTimeline(timeline);

  const pieces: VideoEditTimelineRangePiece[] = [];
  next.items.forEach((item) => {
    if (!timelineRangeEditShouldTouchItem(item, targetTrackIds, includeText)) {
      pieces.push({ sourceId: item.id, sourceLinkedItemId: item.linkedItemId, partKey: 'whole', item });
      return;
    }
    const itemStart = roundTimelineSecond(item.timelineStart);
    const itemEnd = timelineItemEnd(item);
    if (itemEnd <= insertStart + 0.0001) {
      pieces.push({ sourceId: item.id, sourceLinkedItemId: item.linkedItemId, partKey: 'whole', item });
      return;
    }
    if (itemStart >= insertStart - 0.0001) {
      pieces.push({
        sourceId: item.id,
        sourceLinkedItemId: item.linkedItemId,
        partKey: 'whole',
        item: { ...item, timelineStart: roundTimelineSecond(item.timelineStart + insertDuration) },
      });
      return;
    }
    const left = makeTimelineRangePiece(item, itemStart, insertStart, 'left', stamp);
    const right = makeTimelineRangePiece(item, insertStart, itemEnd, 'right', stamp);
    if (left) pieces.push(left);
    if (right) {
      pieces.push({
        ...right,
        item: { ...right.item, timelineStart: roundTimelineSecond(right.item.timelineStart + insertDuration) },
      });
    }
  });

  next.items = relinkTimelineRangePieces(pieces);
  next.playhead = insertStart;
  next.selectedItemIds = next.selectedItemIds.filter((itemId) => next.items.some((item) => item.id === itemId));
  return next;
}

export function overwriteVideoEditTimelineRange(
  timeline: VideoEditTimelineV2,
  overwriteStartInput: number,
  overwriteDurationInput: number,
  options: VideoEditTimelineRangeEditOptions = {},
): VideoEditTimelineV2 {
  const next = cloneTimeline(timeline);
  const overwriteStart = roundTimelineSecond(finiteNumber(overwriteStartInput, next.playhead));
  const overwriteDuration = roundTimelineSecond(Math.max(MIN_TIMELINE_ITEM_DURATION, finiteNumber(overwriteDurationInput, 0)));
  const overwriteEnd = roundTimelineSecond(overwriteStart + overwriteDuration);
  const targetTrackIds = options.targetTrackIds?.length ? new Set(options.targetTrackIds) : null;
  const includeText = options.includeText === true;
  const stamp = options.stamp || `overwrite-${Date.now().toString(36)}`;

  const touchesLocked = next.items.some((item) => {
    if (!timelineRangeEditShouldTouchItem(item, targetTrackIds, includeText)) return false;
    return item.timelineStart < overwriteEnd - 0.0001
      && timelineItemEnd(item) > overwriteStart + 0.0001
      && !timelineItemTrackIsEditable(next, item);
  });
  if (touchesLocked) return cloneTimeline(timeline);

  const pieces: VideoEditTimelineRangePiece[] = [];
  next.items.forEach((item) => {
    if (!timelineRangeEditShouldTouchItem(item, targetTrackIds, includeText)) {
      pieces.push({ sourceId: item.id, sourceLinkedItemId: item.linkedItemId, partKey: 'whole', item });
      return;
    }
    const itemStart = roundTimelineSecond(item.timelineStart);
    const itemEnd = timelineItemEnd(item);
    const overlaps = itemStart < overwriteEnd - 0.0001 && itemEnd > overwriteStart + 0.0001;
    if (!overlaps) {
      pieces.push({ sourceId: item.id, sourceLinkedItemId: item.linkedItemId, partKey: 'whole', item });
      return;
    }

    const left = makeTimelineRangePiece(item, itemStart, Math.min(itemEnd, overwriteStart), 'left', stamp);
    const right = makeTimelineRangePiece(item, Math.max(itemStart, overwriteEnd), itemEnd, left ? 'right' : 'whole', stamp);
    if (left) pieces.push(left);
    if (right) pieces.push(right);
  });

  const itemIds = new Set(pieces.map((piece) => piece.item.id));
  next.items = relinkTimelineRangePieces(pieces);
  next.selectedItemIds = next.selectedItemIds.filter((itemId) => itemIds.has(itemId));
  next.playhead = overwriteStart;
  return next;
}

export function detectVideoEditTimelineConflicts(timeline: VideoEditTimelineV2): VideoEditTimelineConflict[] {
  const conflicts: VideoEditTimelineConflict[] = [];
  const assetIds = new Set(timeline.assets.map((asset) => asset.id));
  const trackIds = new Set(timeline.tracks.map((track) => track.id));

  timeline.items.forEach((item) => {
    if (!assetIds.has(item.assetId)) {
      conflicts.push({ kind: 'missing-asset', itemId: item.id, trackId: item.trackId, message: '片段缺少素材引用' });
    }
    if (!trackIds.has(item.trackId)) {
      conflicts.push({ kind: 'missing-track', itemId: item.id, trackId: item.trackId, message: '片段缺少轨道引用' });
    }
    if (timelineItemDuration(item) < MIN_TIMELINE_ITEM_DURATION) {
      conflicts.push({ kind: 'invalid-duration', itemId: item.id, trackId: item.trackId, message: '片段时长过短' });
    }
  });

  timeline.tracks.forEach((track) => {
    const trackItems = timeline.items
      .filter((item) => item.trackId === track.id && item.kind === track.kind)
      .sort((a, b) => a.timelineStart - b.timelineStart);
    for (let index = 1; index < trackItems.length; index += 1) {
      const previous = trackItems[index - 1];
      const current = trackItems[index];
      if (current.timelineStart < timelineItemEnd(previous) - 0.001) {
        conflicts.push({
          kind: 'overlap',
          itemId: current.id,
          withItemId: previous.id,
          trackId: track.id,
          message: '同一轨道存在重叠片段',
        });
      }
    }
  });

  return conflicts;
}

export function buildVideoEditTimelineRenderPlan(timeline: VideoEditTimelineV2): VideoEditTimelineRenderPlan {
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const tracks = new Map(timeline.tracks.map((track) => [track.id, track]));
  const warnings: string[] = [];
  const unsupportedSet = new Set<string>();
  const hasNonDefaultTimelineNumber = (value: unknown, fallback: number) => (
    Number.isFinite(Number(value)) && Math.abs(Number(value) - fallback) > 0.0001
  );
  const normalizeTimelinePercent = (value: unknown, fallback = 0) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(0, Math.min(100, next));
  };
  const normalizeTimelineScale = (value: unknown) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return 1;
    return Math.max(0.1, Math.min(2, next));
  };
  const normalizeTimelineOpacity = (value: unknown) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return 1;
    return Math.max(0, Math.min(1, next));
  };
  const recordUnsupportedTimelineFields = (item: VideoEditTimelineItem) => {
    const extra = item as VideoEditTimelineItem & Record<string, unknown>;
    if (
      extra.transform
      || hasNonDefaultTimelineNumber(extra.scaleX, 1)
      || hasNonDefaultTimelineNumber(extra.scaleY, 1)
      || hasNonDefaultTimelineNumber(extra.rotation, 0)
    ) {
      unsupportedSet.add('视频位移/缩放/透明度');
    }
    if (hasNonDefaultTimelineNumber(extra.speed, 1)) {
      unsupportedSet.add('变速');
    }
    if (Array.isArray(extra.keyframes) && extra.keyframes.length > 0) {
      unsupportedSet.add('关键帧动画');
    }
  };
  timeline.items.forEach(recordUnsupportedTimelineFields);
  const renderTracks = timeline.tracks
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((track): VideoEditTimelineRenderTrack => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      order: track.order,
      muted: !!track.muted,
      hidden: !!track.hidden,
      locked: !!track.locked,
      solo: !!track.solo,
    }));

  const soloTrackIdsByKind = new Map<VideoEditTimelineKind, Set<string>>();
  renderTracks.forEach((track) => {
    if (!track.hidden && track.solo) {
      const existing = soloTrackIdsByKind.get(track.kind) || new Set<string>();
      existing.add(track.id);
      soloTrackIdsByKind.set(track.kind, existing);
    }
  });
  const isSoloRenderableTrack = (track: Pick<VideoEditTimelineTrack, 'id' | 'kind'>) => {
    const soloTrackIds = soloTrackIdsByKind.get(track.kind);
    return !soloTrackIds || soloTrackIds.size === 0 || soloTrackIds.has(track.id);
  };
  const visibleVideoTracks = renderTracks.filter((track) => (
    track.kind === 'video' && !track.hidden && isSoloRenderableTrack(track)
  ));
  const videoLayerByTrackId = new Map(visibleVideoTracks.map((track, index) => [track.id, index]));

  const clips = timeline.items
    .slice()
    .sort((a, b) => {
      const trackA = tracks.get(a.trackId);
      const trackB = tracks.get(b.trackId);
      return a.timelineStart - b.timelineStart
        || (trackA?.order ?? 0) - (trackB?.order ?? 0)
        || a.id.localeCompare(b.id);
    })
    .flatMap((item): VideoEditTimelineRenderSegment[] => {
      if (item.kind !== 'video') return [];
      const asset = assets.get(item.assetId);
      const track = tracks.get(item.trackId);
      if (!track || track.kind !== 'video') {
        warnings.push(`时间线片段 ${item.id} 缺少素材或轨道`);
        return [];
      }
      if (track.hidden || !isSoloRenderableTrack(track)) return [];
      if (!asset?.url) {
        warnings.push(`时间线片段 ${item.id} 缺少素材或轨道`);
        return [];
      }
      const linkedAudioItems = linkedItemIds(timeline, item.id)
        .filter((id) => id !== item.id)
        .map((id) => timeline.items.find((entry) => entry.id === id))
        .filter((entry): entry is VideoEditTimelineItem => !!entry && entry.kind === 'audio');
      const linkedAudioMuted = linkedAudioItems.some((entry) => entry.muted || !!tracks.get(entry.trackId)?.muted);
      const muted = !!item.muted || !!track.muted || linkedAudioMuted;
      const timelineStart = roundTimelineSecond(item.timelineStart);
      const segmentDuration = timelineItemDuration(item);
      return [{
        id: `render-${item.id}`,
        sourceItemId: item.id,
        assetId: item.assetId,
        trackId: item.trackId,
        kind: 'video',
        trackOrder: track.order,
        layerIndex: videoLayerByTrackId.get(item.trackId) ?? 0,
        timelineStart,
        timelineEnd: roundTimelineSecond(timelineStart + segmentDuration),
        trimStart: roundTimelineSecond(item.sourceIn),
        trimEnd: roundTimelineSecond(item.sourceOut),
        muted,
        volume: item.volume,
        audioFadeIn: normalizeVideoEditAudioFade(item.audioFadeIn, segmentDuration),
        audioFadeOut: normalizeVideoEditAudioFade(item.audioFadeOut, segmentDuration),
        volumeCurve: normalizeVideoEditAudioVolumeCurve(item.volumeCurve),
        x: normalizeTimelinePercent(item.x, 0),
        y: normalizeTimelinePercent(item.y, 0),
        scale: normalizeTimelineScale(item.scale),
        opacity: normalizeTimelineOpacity(item.opacity),
        hasAudio: asset.hasAudio,
        name: item.label || asset.name || item.id,
        url: asset.url,
        directUrl: asset.directUrl || asset.url,
        mime: asset.mime,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        size: asset.size,
        thumbnailUrl: asset.thumbnailUrl,
        filmstripUrls: asset.filmstripUrls ? [...asset.filmstripUrls] : undefined,
        filmstripTimes: asset.filmstripTimes ? [...asset.filmstripTimes] : undefined,
        waveformPeaks: asset.waveformPeaks ? [...asset.waveformPeaks] : undefined,
        linkedAudioItemIds: linkedAudioItems.map((entry) => entry.id),
        sourceNodeId: asset.sourceNodeId,
        sourceCanvasId: asset.sourceCanvasId,
        sourceLabel: asset.sourceLabel,
      }];
    });

  const audio = timeline.items
    .slice()
    .sort((a, b) => {
      const trackA = tracks.get(a.trackId);
      const trackB = tracks.get(b.trackId);
      return a.timelineStart - b.timelineStart
        || (trackA?.order ?? 0) - (trackB?.order ?? 0)
        || a.id.localeCompare(b.id);
    })
    .flatMap((item): VideoEditTimelineRenderAudioSegment[] => {
      if (item.kind !== 'audio') return [];
      const asset = assets.get(item.assetId);
      const track = tracks.get(item.trackId);
      if (!track || track.kind !== 'audio') {
        warnings.push(`音频片段 ${item.id} 缺少素材或轨道`);
        return [];
      }
      if (track.hidden || !isSoloRenderableTrack(track)) return [];
      if (!asset?.url) {
        warnings.push(`音频片段 ${item.id} 缺少素材或轨道`);
        return [];
      }
      const timelineStart = roundTimelineSecond(item.timelineStart);
      const segmentDuration = timelineItemDuration(item);
      const linkedVideoItem = item.linkedItemId
        ? timeline.items.find((entry) => entry.id === item.linkedItemId && entry.kind === 'video')
        : timeline.items.find((entry) => entry.kind === 'video' && entry.linkedItemId === item.id);
      return [{
        id: `render-${item.id}`,
        sourceItemId: item.id,
        assetId: item.assetId,
        trackId: item.trackId,
        kind: 'audio',
        trackOrder: track.order,
        timelineStart,
        timelineEnd: roundTimelineSecond(timelineStart + segmentDuration),
        trimStart: roundTimelineSecond(item.sourceIn),
        trimEnd: roundTimelineSecond(item.sourceOut),
        muted: !!item.muted || !!track.muted,
        volume: item.volume,
        audioFadeIn: normalizeVideoEditAudioFade(item.audioFadeIn, segmentDuration),
        audioFadeOut: normalizeVideoEditAudioFade(item.audioFadeOut, segmentDuration),
        volumeCurve: normalizeVideoEditAudioVolumeCurve(item.volumeCurve),
        name: item.label || asset.name || item.id,
        url: asset.url,
        directUrl: asset.directUrl || asset.url,
        mime: asset.mime,
        duration: asset.duration,
        size: asset.size,
        waveformPeaks: asset.waveformPeaks ? [...asset.waveformPeaks] : undefined,
        linkedVideoItemId: linkedVideoItem?.id,
        sourceNodeId: asset.sourceNodeId,
        sourceCanvasId: asset.sourceCanvasId,
        sourceLabel: asset.sourceLabel,
      }];
    });

  const text = timeline.items
    .slice()
    .sort((a, b) => {
      const trackA = tracks.get(a.trackId);
      const trackB = tracks.get(b.trackId);
      return a.timelineStart - b.timelineStart
        || (trackA?.order ?? 0) - (trackB?.order ?? 0)
        || a.id.localeCompare(b.id);
    })
    .flatMap((item): VideoEditTimelineRenderTextSegment[] => {
      if (item.kind !== 'text') return [];
      const asset = assets.get(item.assetId);
      const track = tracks.get(item.trackId);
      if (!track || track.kind !== 'text') {
        warnings.push(`字幕片段 ${item.id} 缺少素材或轨道`);
        return [];
      }
      if (track.hidden || !isSoloRenderableTrack(track)) return [];
      const rawText = typeof asset?.text === 'string' && asset.text.trim()
        ? asset.text.trim()
        : (typeof item.label === 'string' ? item.label.trim() : '');
      if (!rawText) {
        warnings.push(`字幕片段 ${item.id} 缺少文本内容`);
        return [];
      }
      const timelineStart = roundTimelineSecond(item.timelineStart);
      const segmentDuration = timelineItemDuration(item);
      const fontSize = Number.isFinite(Number(asset?.textFontSize)) && Number(asset?.textFontSize) > 0
        ? Number(asset?.textFontSize)
        : 42;
      return [{
        id: `render-${item.id}`,
        sourceItemId: item.id,
        assetId: item.assetId,
        trackId: item.trackId,
        kind: 'text',
        trackOrder: track.order,
        timelineStart,
        timelineEnd: roundTimelineSecond(timelineStart + segmentDuration),
        text: rawText,
        name: item.label || asset?.name || rawText || item.id,
        position: asset?.textPosition || 'bottom',
        color: asset?.textColor || '#ffffff',
        fontSize,
        background: asset?.textBackground || 'rgba(0,0,0,0.45)',
      }];
    });

  const duration = renderPlanTimelineDuration(clips, audio, text);
  const videoLayerIndexes = new Set(clips.map((clip) => clip.layerIndex));
  const timelineGaps = hasPrimaryVideoTimelineGaps(clips, duration);
  const timelineVisualTransforms = clips.some((clip) => (
    Math.abs((clip.scale ?? 1) - 1) > 0.0001
    || Math.abs(clip.x ?? 0) > 0.0001
    || Math.abs(clip.y ?? 0) > 0.0001
    || Math.abs((clip.opacity ?? 1) - 1) > 0.0001
  ));
  const capabilities: VideoEditTimelineRenderCapabilities = {
    timelineLayerCompose: videoLayerIndexes.size > 1 || timelineGaps || timelineVisualTransforms,
    timelineLayerCount: Math.max(visibleVideoTracks.length, videoLayerIndexes.size),
    timelineGaps,
    timelineAudioMix: audio.length > 0,
    sourceAudioMix: clips.some((clip) => clip.hasAudio && !clip.muted),
    subtitleBurnIn: text.length > 0,
  };
  const unsupported = Array.from(unsupportedSet);

  return {
    version: 1,
    duration,
    tracks: renderTracks,
    clips,
    audio,
    text,
    capabilities,
    unsupported,
    warnings,
  };
}
