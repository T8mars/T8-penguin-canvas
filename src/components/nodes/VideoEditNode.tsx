import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import {
  CheckCircle2,
  Clock3,
  Copy,
  Camera,
  Download,
  Eye,
  EyeOff,
  Film,
  ImagePlus,
  Keyboard,
  Loader2,
  Lock,
  MapPin,
  Music2,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  Sparkles,
  StepBack,
  StepForward,
  Trash2,
  Unlock,
  UploadCloud,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { uploadFileBlob } from '../../services/imageOps';
import { cancelVideoEditJob, composeVideoEditAsync, getVideoEditJob, loadVideoTimelinePreviewAsync, probeVideo, separateVideoAudioAsync, snapshotVideoFrameAsync, type VideoComposeResult, type VideoOperationExecutionEvidence, type VideoSnapshotResult } from '../../services/videoOps';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import ImageEditModal, { type ImageEditProduceMeta } from './ImageEditModal';
import LocalizedVisibleTree from '../../i18n/LocalizedVisibleTree';
import { VIDEO_EDIT_VISIBLE_CATALOG } from '../../i18n/workbenchVisibleCatalog';
import {
  appendVideoEditClips,
  applyVideoEditImportCleanup,
  applyVideoEditCreatorTemplate,
  applyVideoEditOutputPreset,
  buildVideoEditTimelineRenderPlan,
  buildVideoEditRecipe,
  buildVideoEditTimelinePreviewClip,
  compressVideoEditClipsToTargetDuration,
  createVideoEditClipFromMediaItem,
  distributeVideoEditClipsToTargetDuration,
  findVideoEditRecipeMissingAssets,
  detectVideoEditTimelineConflicts,
  insertVideoEditTimelineRange,
  normalizeVideoEditRecipe,
  normalizeVideoEditClips,
  normalizeVideoEditSettings,
  normalizeVideoEditTimeline,
  normalizeVideoEditOutputVersions,
  overwriteVideoEditTimelineRange,
  pushVideoEditOutputVersion,
  replaceVideoEditClipAsset,
  resolveVideoEditTimelineSnap,
  resolveVideoEditTimelinePlayback,
  moveVideoEditTimelineItem,
  resizeVideoEditTimelineItem,
  splitVideoEditTimelineItem,
  sortVideoEditClipsByName,
  syncVideoEditClipsFromTimelineItem,
  syncVideoEditTimelineWithClips,
  timelineItemDuration,
  totalVideoEditDuration,
  trimVideoEditClipsToFirstSeconds,
  videoEditClipDuration,
  videoEditAudioEnvelopeMultiplier,
  videoEditClipHealth,
  videoEditDurationBudget,
  videoEditTimelineHealthSummary,
  videoEditTimelineWidth,
  videoEditClipsFromTimelineRenderPlan,
  videoEditTimelineDuration,
  videoEditTimelineTimeFromPlaybackSourceTime,
  videoEditTimelineTimeToX,
  videoEditTimelineXToTime,
  videoEditPreviewFilterCss,
  VIDEO_EDIT_CREATOR_TEMPLATES,
  VIDEO_EDIT_OUTPUT_PRESETS,
  VIDEO_EDIT_PLATFORM_EXPORT_PACKAGES,
  VIDEO_EDIT_TRANSITION_GROUPS,
  type VideoEditClip,
  type VideoEditOutputVersion,
  type VideoEditSettings,
  type VideoEditTimelineControllerSelectMode,
  type VideoEditTimelineAsset,
  type VideoEditAudioVolumeCurve,
  type VideoEditTimelineItem,
  type VideoEditTimelineSnapResult,
  type VideoEditTimelineTrack,
  type VideoEditTimelineV2,
} from '../../utils/videoEdit';
import { fileNameFromUrl, formatMediaSize, getMediaItemsFromData, type MediaItem } from '../../utils/mediaCollection';
import { CREATIVE_TARGET_NODE_TYPE, buildCreativeTargetResult } from '../../utils/canvasCreativeWorkflow';
import { placeSingleNode } from '../../utils/nodePlacement';
import {
  createSecondaryProviderActionForNode,
  executeRegisteredSecondaryProviderAction,
  requestCanvasSecondaryProviderAction,
  registerSecondaryProviderActionExecutor,
  resolveSecondaryProviderActionForRun,
  secondaryProviderActionFromNodeData,
  secondaryProviderActionNodePatch,
  type QueueSecondaryProviderAction,
  type SecondaryProviderActionExecution,
} from '../../utils/secondaryProviderAction';
import {
  createVideoEditExecutionInputSnapshot,
  videoEditExecutionInputDigest,
  videoEditExecutionInputMatchesDigest,
  type VideoEditExecutionInputSnapshot,
} from '../../utils/videoEditExecution';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { isRunExecutionCancelled } from '../../stores/runBus';
import { useThemeStore } from '../../stores/theme';

const ASPECT_OPTIONS: Array<{ value: VideoEditSettings['aspect']; label: string }> = [
  { value: 'first', label: '跟随第一段' },
  { value: 'source', label: '原比例' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '21:9', label: '21:9' },
  { value: '2:1', label: '2:1' },
];

const RESOLUTION_OPTIONS: Array<{ value: VideoEditSettings['resolution']; label: string }> = [
  { value: 'first', label: '跟随第一段' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

const COMPACT_ASPECT_OPTIONS = ASPECT_OPTIONS.map((item) => {
  if (item.value === 'first') return { ...item, label: '首段' };
  if (item.value === 'source') return { ...item, label: '原比' };
  return item;
});

const COMPACT_RESOLUTION_OPTIONS = RESOLUTION_OPTIONS.map((item) => {
  if (item.value === 'first') return { ...item, label: '首段' };
  return item;
});

const VIDEO_EDIT_AUDIO_VOLUME_CURVE_OPTIONS: Array<{ value: VideoEditAudioVolumeCurve; label: string; hint: string }> = [
  { value: 'flat', label: '平直', hint: '保持当前音量' },
  { value: 'linear-up', label: '渐强', hint: '从低到高推进' },
  { value: 'linear-down', label: '渐弱', hint: '从高到低收束' },
  { value: 'duck', label: '压低', hint: 'BGM 自动让位' },
];

const FILTER_OPTIONS: Array<{ value: VideoEditSettings['filter']; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'bright', label: '提亮' },
  { value: 'contrast', label: '对比增强' },
  { value: 'warm', label: '暖色' },
  { value: 'cool', label: '冷色' },
  { value: 'mono', label: '黑白' },
  { value: 'cinematic', label: '电影感轻调色' },
];

const AUDIO_OPTIONS: Array<{ value: VideoEditSettings['audio']; label: string }> = [
  { value: 'keep', label: '保留原声' },
  { value: 'mute', label: '静音全部' },
  { value: 'first', label: '只保留第一段' },
];

const TRANSITION_DURATION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.4, label: '快 0.4s' },
  { value: 0.8, label: '默认 0.8s' },
  { value: 1.2, label: '慢 1.2s' },
  { value: 1.6, label: '长 1.6s' },
  { value: 2, label: '最长 2.0s' },
];

const VIDEO_EDIT_COMPACT_TIMELINE_LIMIT = 8;
const VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED = false;
const VIDEO_EDIT_WORKBENCH_WINDOW_SIZE = 24;
const VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND = 100;
const VIDEO_EDIT_WORKBENCH_SHORTCUTS = [
  { id: 'play-toggle', group: '播放', label: '播放 / 暂停', keys: ['Space'] },
  { id: 'trim-in', group: '裁剪', label: '设置入点', keys: ['I'] },
  { id: 'trim-out', group: '裁剪', label: '设置出点', keys: ['O'] },
  { id: 'split-playhead', group: '编辑', label: '播放头拆分', keys: ['S'] },
  { id: 'duplicate-selected', group: '编辑', label: '复制所选', keys: ['Ctrl', 'D'] },
  { id: 'delete-selected', group: '编辑', label: '删除所选', keys: ['Delete'] },
  { id: 'undo', group: '历史', label: '撤销', keys: ['Ctrl', 'Z'] },
  { id: 'redo', group: '历史', label: '恢复', keys: ['Ctrl', 'Y'] },
  { id: 'shortcut-help', group: '系统', label: '快捷键面板', keys: ['?'] },
] as const;

type VideoEditWorkbenchSnapshot = {
  clips: VideoEditClip[];
  timelineV2: VideoEditTimelineV2;
};

type VideoEditWorkbenchClipSourceFilter = 'all' | 'local' | 'upstream' | 'generated';

const VIDEO_EDIT_WORKBENCH_CLIP_SOURCE_FILTERS: Array<{ value: VideoEditWorkbenchClipSourceFilter; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'local', label: '本地上传' },
  { value: 'upstream', label: '上游导入' },
  { value: 'generated', label: '生成结果' },
];

const VIDEO_EDIT_DARK_TEMPLATE_IDS = new Set([
  'tech-default',
  'rh-style',
  'naruto-style',
  'eva-style',
  'yyh-style',
  'dragon-ball-style',
  'saint-seiya-style',
  'tetris-style',
]);

type VideoEditSolidPalette = {
  surface: string;
  panel: string;
  muted: string;
  card: string;
  actionBg: string;
  actionHoverBg: string;
  actionBorder: string;
  actionText: string;
  actionShadow: string;
  actionDisabledBg: string;
  actionDisabledText: string;
};

function resolveVideoEditSolidPalette(templateId?: string, theme?: string, style?: string): VideoEditSolidPalette {
  const id = String(templateId || '');
  const shouldUseDarkSurface = theme === 'dark' || (theme !== 'light' && (style === 'tech' || VIDEO_EDIT_DARK_TEMPLATE_IDS.has(id)));
  if (id === 'farm-story-style') {
    return {
      surface: '#fbfff4',
      panel: '#f7fdf0',
      muted: '#edf7e5',
      card: '#ffffff',
      actionBg: '#dff3cd',
      actionHoverBg: '#c9e9b9',
      actionBorder: '#5f7d47',
      actionText: '#172a17',
      actionShadow: 'inset 0 -1px 0 rgba(60, 90, 40, 0.18), 0 1px 0 rgba(255, 255, 255, 0.9)',
      actionDisabledBg: '#eef3e8',
      actionDisabledText: '#7f8a74',
    };
  }
  if (id === 'pixel-candy') {
    return {
      surface: '#fffaf1',
      panel: '#fffdf7',
      muted: '#f5ead6',
      card: '#ffffff',
      actionBg: '#ffe8b6',
      actionHoverBg: '#ffd982',
      actionBorder: '#3d2b1f',
      actionText: '#1f1a12',
      actionShadow: '2px 2px 0 rgba(61, 43, 31, 0.82)',
      actionDisabledBg: '#f0eadf',
      actionDisabledText: '#8f8675',
    };
  }
  if (shouldUseDarkSurface) {
    return {
      surface: '#071107',
      panel: '#0f1b10',
      muted: '#162815',
      card: '#101f11',
      actionBg: '#254217',
      actionHoverBg: '#315622',
      actionBorder: '#78a35a',
      actionText: '#f3ffe7',
      actionShadow: 'inset 0 -1px 0 rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(185, 255, 138, 0.08)',
      actionDisabledBg: '#1a2715',
      actionDisabledText: '#7f9275',
    };
  }
  return {
    surface: '#f8fbf4',
    panel: '#ffffff',
    muted: '#edf5e8',
    card: '#ffffff',
    actionBg: '#f1eadc',
    actionHoverBg: '#e6dbc4',
    actionBorder: '#7b6a50',
    actionText: '#1c1812',
    actionShadow: 'inset 0 -1px 0 rgba(91, 70, 45, 0.16), 0 1px 0 rgba(255, 255, 255, 0.85)',
    actionDisabledBg: '#f3f0e9',
    actionDisabledText: '#8b8274',
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-semibold" style={{ color: 'var(--t8-text-muted)' }}>{children}</label>;
}

function VideoEditVisible({ children }: { children: React.ReactNode }) {
  return (
    <LocalizedVisibleTree area="videoEdit" catalog={VIDEO_EDIT_VISIBLE_CATALOG}>
      {children}
    </LocalizedVisibleTree>
  );
}

const VIDEO_EDIT_PIP_PRESETS = [
  { id: 'fullscreen', label: '全屏', x: 0, y: 0, scale: 1, opacity: 1 },
  { id: 'top-left', label: '左上小窗', x: 4, y: 6, scale: 0.34, opacity: 1 },
  { id: 'top-right', label: '右上小窗', x: 96, y: 6, scale: 0.34, opacity: 1 },
  { id: 'bottom-left', label: '左下小窗', x: 4, y: 92, scale: 0.34, opacity: 1 },
  { id: 'bottom-right', label: '右下小窗', x: 96, y: 92, scale: 0.34, opacity: 1 },
  { id: 'center-small', label: '居中小窗', x: 50, y: 50, scale: 0.48, opacity: 1 },
] as const;

const clampVideoEditPipPercent = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.min(100, next)) : 0;
};

const clampVideoEditPipScale = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0.1, Math.min(2, next)) : 1;
};

const clampVideoEditPipOpacity = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
};

type VideoEditPreviewTransitionState = {
  edge: 'enter' | 'exit';
  duration: number;
  progress: number;
  transition: string;
  label: string;
};

function VideoEditPreviewTransitionBadge({ transition }: { transition: VideoEditPreviewTransitionState | null }) {
  if (!transition) return null;
  const progress = Math.max(0, Math.min(100, Math.round(transition.progress * 100)));
  return (
    <VideoEditVisible>
    <div
      data-video-edit-preview-transition="true"
      data-video-edit-preview-transition-edge={transition.edge}
      data-video-edit-preview-transition-id={transition.transition}
      data-video-edit-preview-transition-duration={transition.duration}
      className="pointer-events-none absolute right-3 top-3 z-20 w-[min(260px,calc(100%-24px))] rounded-xl border border-cyan-300/70 bg-black/70 px-3 py-2 text-xs text-white shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{transition.edge === 'enter' ? '进入转场' : '离开转场'}</span>
        <span className="text-white/70">{transition.duration.toFixed(1)}s</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-cyan-100">{transition.label}</div>
      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }}>
        <span className="block h-full rounded-full bg-cyan-300" style={{ width: `${progress}%` }} />
      </div>
    </div>
    </VideoEditVisible>
  );
}

function FilmstripPreview({ clip, onSeek }: { clip: VideoEditClip; onSeek: (seconds: number) => void }) {
  const urls = Array.isArray(clip.filmstripUrls) ? clip.filmstripUrls : [];
  const times = Array.isArray(clip.filmstripTimes) ? clip.filmstripTimes : [];
  if (!urls.length) {
    return (
      <VideoEditVisible>
      <div className="grid h-14 place-items-center rounded-lg border border-dashed text-[11px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
        暂无帧条，加载后可按画面定位入点 / 出点
      </div>
      </VideoEditVisible>
    );
  }
  return (
    <VideoEditVisible>
    <div className="flex gap-1 overflow-x-auto rounded-lg border p-1" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-muted, var(--t8-surface-muted))' }}>
      {urls.map((url, index) => (
        <button
          key={`${url}-${index}`}
          type="button"
          className="nodrag group relative h-14 min-w-[78px] overflow-hidden rounded-md bg-black/15"
          title={`跳到 ${formatSeconds(times[index])}`}
          onClick={() => onSeek(times[index] || 0)}
        >
          <img
            src={url}
            alt={`帧条 ${index + 1}`}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            draggable={false}
            onDragStart={preventNativeMediaDrag}
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[9px] font-semibold text-white">
            {formatSeconds(times[index])}
          </span>
        </button>
      ))}
    </div>
    </VideoEditVisible>
  );
}

function WaveformPreview({ peaks }: { peaks?: number[] }) {
  const data = Array.isArray(peaks) ? peaks.slice(0, 120) : [];
  if (!data.length) {
    return (
      <VideoEditVisible>
      <div className="grid h-12 place-items-center rounded-lg border border-dashed text-[11px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
        暂无音频波形，无声片段会保持空白
      </div>
      </VideoEditVisible>
    );
  }
  return (
    <VideoEditVisible>
    <div className="flex h-12 items-center gap-[2px] rounded-lg border px-2 py-1" style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-muted, var(--t8-surface-muted))' }}>
      {data.map((peak, index) => (
        <span
          key={`${index}-${peak}`}
          className="flex-1 rounded-full"
          style={{
            height: `${Math.max(8, Math.round((Number(peak) || 0) * 42))}px`,
            background: 'linear-gradient(180deg, rgba(45,212,191,.92), rgba(14,116,144,.72))',
          }}
        />
      ))}
    </div>
    </VideoEditVisible>
  );
}

function formatSeconds(value?: number) {
  if (!Number.isFinite(value || 0) || !value) return '--:--';
  const total = Math.max(0, Math.round(value));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const preventNativeMediaDrag = (event: DragEvent<HTMLElement>) => {
  try {
    event.dataTransfer.effectAllowed = 'none';
  } catch (_) {
    // Some embedded browsers expose a partial DataTransfer during dragstart.
  }
  event.preventDefault();
  event.stopPropagation();
};

const stopInteractivePointer = (event: PointerEvent<HTMLElement>) => {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
};

const stopInteractiveMouse = (event: MouseEvent<HTMLElement>) => {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
};

const stopTimelineMoveStartPointer = (event: PointerEvent<HTMLElement>) => {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
};

const stopTimelineMoveStartMouse = (event: MouseEvent<HTMLElement>) => {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
};

function isWorkbenchEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName);
}

function isTimelineItemMoveBlockedTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return true;
  return Boolean(element.closest([
    'button',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[data-video-edit-trim-track="true"]',
    '[data-video-edit-trim-handle]',
    '[data-video-edit-track-item-trim-handle]',
    '[data-video-edit-workbench-playhead-handle="true"]',
  ].join(',')));
}

function healthDotClass(level: 'ok' | 'warn' | 'block') {
  if (level === 'block') return 'bg-red-500';
  if (level === 'warn') return 'bg-amber-400';
  return 'bg-emerald-500';
}

type VideoImportCandidate = MediaItem & {
  kind: 'video';
  directUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  filmstripUrls?: string[];
  filmstripTimes?: number[];
  waveformPeaks?: number[];
  hasAudio?: boolean;
  sourceNodeId?: string;
  sourceLabel?: string;
  sourceCanvasId?: string;
  sourceNodeLabel?: string;
  sourceCanvasName?: string;
};

const VIDEO_IMPORT_META_ARRAY_FIELDS = {
  duration: ['durations', 'videoDurations', 'fileDurations'],
  width: ['widths', 'videoWidths'],
  height: ['heights', 'videoHeights'],
  thumbnailUrl: ['thumbnailUrls', 'videoThumbnailUrls', 'videoThumbnails'],
  filmstripUrls: ['filmstripUrlsList', 'videoFilmstripUrls', 'filmstripUrlGroups'],
  filmstripTimes: ['filmstripTimesList', 'videoFilmstripTimes', 'filmstripTimeGroups'],
  waveformPeaks: ['waveformPeaksList', 'videoWaveformPeaks', 'waveformPeakGroups'],
  hasAudio: ['hasAudios', 'videoHasAudios'],
} as const;

function finiteOptionalNumber(value: any): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : undefined;
}

function arrayValueAt(data: any, fields: readonly string[], index: number): any {
  if (index < 0) return undefined;
  for (const field of fields) {
    const value = data?.[field];
    if (Array.isArray(value) && value[index] !== undefined) return value[index];
  }
  return undefined;
}

function stringArrayValue(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  return clean.length ? clean : undefined;
}

function numberArrayValue(value: any): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0);
  return clean.length ? clean : undefined;
}

function videoImportMetadataFromNodeData(data: any, url: string, index = -1): Partial<VideoImportCandidate> {
  const videoUrls = Array.isArray(data?.videoUrls) ? data.videoUrls : [];
  const directVideoUrls = Array.isArray(data?.directVideoUrls) ? data.directVideoUrls : [];
  const videoIndex = videoUrls.findIndex((item: any) => item === url);
  const directIndex = directVideoUrls.findIndex((item: any) => item === url);
  let resolvedIndex = -1;
  if (videoIndex >= 0) {
    resolvedIndex = videoIndex;
  } else if (directIndex >= 0) {
    resolvedIndex = directIndex;
  } else if (index >= 0) {
    resolvedIndex = index;
  }
  const directUrl = typeof data?.directVideoUrl === 'string' && data.directVideoUrl
    ? data.directVideoUrl
    : (directIndex >= 0 && typeof directVideoUrls[directIndex] === 'string'
      ? directVideoUrls[directIndex]
      : (resolvedIndex >= 0 && typeof directVideoUrls[resolvedIndex] === 'string' ? directVideoUrls[resolvedIndex] : undefined));
  const duration = finiteOptionalNumber(arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.duration, resolvedIndex))
    ?? finiteOptionalNumber(data?.duration)
    ?? finiteOptionalNumber(data?.videoDuration);
  const width = finiteOptionalNumber(arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.width, resolvedIndex))
    ?? finiteOptionalNumber(data?.width)
    ?? finiteOptionalNumber(data?.videoWidth);
  const height = finiteOptionalNumber(arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.height, resolvedIndex))
    ?? finiteOptionalNumber(data?.height)
    ?? finiteOptionalNumber(data?.videoHeight);
  const thumbnailUrlValue = arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.thumbnailUrl, resolvedIndex)
    ?? data?.thumbnailUrl
    ?? data?.videoThumbnailUrl;
  const filmstripUrls = stringArrayValue(arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.filmstripUrls, resolvedIndex))
    ?? stringArrayValue(data?.filmstripUrls);
  const filmstripTimes = numberArrayValue(arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.filmstripTimes, resolvedIndex))
    ?? numberArrayValue(data?.filmstripTimes);
  const waveformPeaks = numberArrayValue(arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.waveformPeaks, resolvedIndex))
    ?? numberArrayValue(data?.waveformPeaks);
  const hasAudioValue = arrayValueAt(data, VIDEO_IMPORT_META_ARRAY_FIELDS.hasAudio, resolvedIndex);
  return {
    directUrl,
    duration,
    width,
    height,
    thumbnailUrl: typeof thumbnailUrlValue === 'string' && thumbnailUrlValue ? thumbnailUrlValue : undefined,
    filmstripUrls,
    filmstripTimes,
    waveformPeaks,
    hasAudio: typeof hasAudioValue === 'boolean'
      ? hasAudioValue
      : (typeof data?.hasAudio === 'boolean' ? data.hasAudio : undefined),
  };
}

type VideoEditTimelineTrimDrag = {
  clipId: string;
  timelineItemId?: string;
  edge: 'start' | 'end';
  duration: number;
  dragMinSecond: number;
  dragMaxSecond: number;
  trackLeft: number;
  trackWidth: number;
  target: HTMLElement;
};

type VideoEditTimelineMoveDrag = {
  itemId: string;
  target: HTMLElement;
  startClientX: number;
  startTimelineStart: number;
  moved: boolean;
  selectionMode: VideoEditTimelineControllerSelectMode;
  changeRemembered: boolean;
};

type VideoEditTimelineMarqueeSelection = {
  left: number;
  top: number;
  width: number;
  height: number;
  itemIds: string[];
} | null;

type VideoEditTimelineMarqueeDrag = {
  target: HTMLElement;
  container: HTMLElement;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  moved: boolean;
  mode: VideoEditTimelineControllerSelectMode;
  baseSelectedItemIds: string[];
  pointerId?: number;
};

type VideoEditTimelineItemTrimDrag = {
  itemId: string;
  edge: 'start' | 'end';
  target: HTMLElement;
  startClientX: number;
  startSourceIn: number;
  startSourceOut: number;
  moved: boolean;
};

type VideoEditPipDrag = {
  itemId: string;
  target: HTMLElement;
  offsetX: number;
  offsetY: number;
  overlayWidth: number;
  overlayHeight: number;
  stageLeft: number;
  stageTop: number;
  stageWidth: number;
  stageHeight: number;
};

type VideoEditTimelineMovePreview = {
  itemId: string;
  leftPct: number;
  label: string;
  snapActive: boolean;
  snapKind: VideoEditTimelineSnapResult['kind'];
  snapDelta: number;
  snapTargetLabel: string;
} | null;

type VideoEditTimelineContextMenuState = {
  itemId: string;
  x: number;
  y: number;
} | null;

type VideoEditWorkbenchInsertMode = 'append' | 'insert' | 'overwrite' | 'overlay';

type VideoEditTrimInteractionMode = 'source' | 'trimmed-window';

function videoEditClipSourceBucket(clip: VideoEditClip): Exclude<VideoEditWorkbenchClipSourceFilter, 'all'> {
  const label = [
    clip.sourceLabel,
    clip.sourceNodeLabel,
    clip.sourceCanvasName,
    clip.sourceNodeId,
    clip.name,
    clip.url,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (label.includes('上游') || label.includes('upstream') || label.includes('source node')) return 'upstream';
  if (label.includes('输出') || label.includes('生成') || label.includes('vibex') || label.includes('runninghub') || label.includes('output')) return 'generated';
  return 'local';
}

type VideoEditTrimVisual = {
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  trimStartPct: number;
  trimEndPct: number;
  trimmedWindowStartPct: number;
  trimmedWindowEndPct: number;
  rangeStyle: CSSProperties;
  thumbnailWindowStyle: CSSProperties;
  trimmedWindowRangeStyle: CSSProperties;
  trimmedWindowThumbnailStyle: CSSProperties;
  trimmedWindowStartHandleStyle: CSSProperties;
  trimmedWindowEndHandleStyle: CSSProperties;
  activeThumbnailStyle: CSSProperties;
  trackStyle: CSSProperties;
  trackElement: HTMLElement | null;
};

function buildVideoEditTrimVisual(clip: VideoEditClip): VideoEditTrimVisual {
  const duration = videoEditClipDuration(clip);
  const sourceDuration = Math.max(0.1, Number(clip.duration || clip.trimEnd || duration || 1));
  const trimStart = Math.max(0, Math.min(sourceDuration, Number(clip.trimStart) || 0));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(sourceDuration, Number(clip.trimEnd || sourceDuration)));
  const trimStartPct = (trimStart / sourceDuration) * 100;
  const trimEndPct = (trimEnd / sourceDuration) * 100;
  const activeWidthPct = Math.max(1, trimEndPct - trimStartPct);
  return {
    sourceDuration,
    trimStart,
    trimEnd,
    trimStartPct,
    trimEndPct,
    trimmedWindowStartPct: 0,
    trimmedWindowEndPct: 100,
    rangeStyle: { left: `${trimStartPct}%`, right: `${100 - trimEndPct}%` },
    thumbnailWindowStyle: { left: `${trimStartPct}%`, right: `${100 - trimEndPct}%` },
    trimmedWindowRangeStyle: { left: '0%', right: '0%' },
    trimmedWindowThumbnailStyle: { left: '0%', right: '0%' },
    trimmedWindowStartHandleStyle: { left: '0%' },
    trimmedWindowEndHandleStyle: { left: '100%' },
    activeThumbnailStyle: {
      left: `${-(trimStartPct / activeWidthPct) * 100}%`,
      width: `${10000 / activeWidthPct}%`,
    },
    trackStyle: { borderColor: 'var(--t8-border)', touchAction: 'none', userSelect: 'none' },
    trackElement: null,
  };
}

function buildVideoEditTrimmedCardVisual(clip: VideoEditClip): VideoEditTrimVisual {
  const visual = buildVideoEditTrimVisual(clip);
  return {
    ...visual,
    trimmedWindowStartPct: 0,
    trimmedWindowEndPct: 100,
    trimmedWindowRangeStyle: { left: '0%', right: '0%' },
    trimmedWindowThumbnailStyle: { left: '0%', right: '0%' },
    trimmedWindowStartHandleStyle: { left: '0%' },
    trimmedWindowEndHandleStyle: { left: '100%' },
    activeThumbnailStyle: visual.activeThumbnailStyle,
  };
}

function videoEditClipFromTimelineItem(item: VideoEditTimelineItem, source: VideoEditClip): VideoEditClip {
  return {
    ...source,
    timelineItemId: item.id,
    sourceClipId: source.id,
    trimStart: item.sourceIn,
    trimEnd: item.sourceOut,
    muted: item.muted ?? source.muted,
    name: item.label || source.name,
  };
}

function formatDateTime(value?: string) {
  if (!value) return '';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '';
  return time.toLocaleString();
}

function nodeLabelFromData(data: any, fallback: string) {
  const candidates = [data?.title, data?.label, data?.name, data?.fileName, data?.sourceLabel];
  const found = candidates.find((item) => typeof item === 'string' && item.trim());
  return found ? String(found).trim() : fallback;
}

function VideoEditNode({ id, data, selected }: NodeProps) {
  const update = useUpdateNodeData(id);
  const rf = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioTrackInputRef = useRef<HTMLInputElement>(null);
  const subtitleToolbarInputRef = useRef<HTMLInputElement>(null);
  const subtitleTrackInputRef = useRef<HTMLInputElement>(null);
  const recipeInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const replacementClipIdRef = useRef('');
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewOverlayVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const previewAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const pendingPreviewSeekRef = useRef<{ clipKey: string; seconds: number } | null>(null);
  const previewSeekGuardRef = useRef<{ clipKey: string; seconds: number; expiresAt: number } | null>(null);
  const pendingPreviewAutoplayRef = useRef(false);
  const lastPreviewPlayheadCommitRef = useRef<number>(-1);
  const workbenchShellRef = useRef<HTMLElement>(null);
  const workbenchUndoStackRef = useRef<VideoEditWorkbenchSnapshot[]>([]);
  const workbenchRedoStackRef = useRef<VideoEditWorkbenchSnapshot[]>([]);
  const workbenchTimelineViewportRef = useRef<HTMLDivElement>(null);
  const workbenchOverlayTimelineViewportRef = useRef<HTMLDivElement>(null);
  const workbenchAudioTimelineViewportRef = useRef<HTMLDivElement>(null);
  const workbenchTextTimelineViewportRef = useRef<HTMLDivElement>(null);
  const workbenchPlayheadDragCleanupRef = useRef<(() => void) | null>(null);
  const timelineTrimDragRef = useRef<VideoEditTimelineTrimDrag | null>(null);
  const timelineTrimDocumentCleanupRef = useRef<(() => void) | null>(null);
  const timelineMoveDragRef = useRef<VideoEditTimelineMoveDrag | null>(null);
  const timelineMoveDocumentCleanupRef = useRef<(() => void) | null>(null);
  const timelineMoveClickSuppressUntilRef = useRef(0);
  const timelineMarqueeDragRef = useRef<VideoEditTimelineMarqueeDrag | null>(null);
  const timelineMarqueeDocumentCleanupRef = useRef<(() => void) | null>(null);
  const timelineItemTrimDragRef = useRef<VideoEditTimelineItemTrimDrag | null>(null);
  const timelineItemTrimDocumentCleanupRef = useRef<(() => void) | null>(null);
  const previewPipDragRef = useRef<VideoEditPipDrag | null>(null);
  const previewPipDragDocumentCleanupRef = useRef<(() => void) | null>(null);
  const pollTokenRef = useRef(0);
  const pendingVideoExecutionInputsRef = useRef(new Map<string, VideoEditExecutionInputSnapshot>());
  const executeAuthorizedVideoEditActionRef = useRef<(execution: SecondaryProviderActionExecution) => Promise<void>>(
    async () => { throw new Error('视频编辑执行器尚未就绪'); },
  );
  const importCleanupUndoRef = useRef<VideoEditClip[] | null>(null);
  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');
  const [dragClipId, setDragClipId] = useState<string | null>(null);
  const [timelineMovePreview, setTimelineMovePreview] = useState<VideoEditTimelineMovePreview>(null);
  const [timelineMarqueeSelection, setTimelineMarqueeSelection] = useState<VideoEditTimelineMarqueeSelection>(null);
  const [timelineContextMenu, setTimelineContextMenu] = useState<VideoEditTimelineContextMenuState>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchView, setWorkbenchView] = useState<'timeline' | 'storyboard'>('timeline');
  const [workbenchShortcutsOpen, setWorkbenchShortcutsOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [workbenchClipWindowStart, setWorkbenchClipWindowStart] = useState(0);
  const [workbenchTimelineWindowStart, setWorkbenchTimelineWindowStart] = useState(0);
  const [workbenchClipSearch, setWorkbenchClipSearch] = useState('');
  const [workbenchClipSourceFilter, setWorkbenchClipSourceFilter] = useState<VideoEditWorkbenchClipSourceFilter>('all');
  const [previewTime, setPreviewTime] = useState(0);
  const [previewOverride, setPreviewOverride] = useState<{
    clip: VideoEditClip;
    clipKey: string;
    sourceTime: number;
    timelineItemId?: string;
  } | null>(null);
  const [subtitleDraft, setSubtitleDraft] = useState('');
  const [imageEditSnapshotUrl, setImageEditSnapshotUrl] = useState('');
  const [snapshotNotice, setSnapshotNotice] = useState('');
  const [importCleanupPreview, setImportCleanupPreview] = useState<{ before: number; after: number; duration: number } | null>(null);
  const [selectedPlatformPackageIds, setSelectedPlatformPackageIds] = useState<string[]>(['douyin-kuaishou', 'bilibili-youtube']);
  const [platformExportStatus, setPlatformExportStatus] = useState('');
  const videoEditTemplateId = useThemeStore((state) => state.templateId);
  const videoEditTheme = useThemeStore((state) => state.theme);
  const videoEditThemeStyle = useThemeStore((state) => state.style);
  const d = (data as any) || {};
  const queueSecondaryAction = useCallback<QueueSecondaryProviderAction>((draft) => {
    const action = createSecondaryProviderActionForNode(id, 'video-edit', draft);
    update(secondaryProviderActionNodePatch(action));
    queueMicrotask(() => {
      if (!requestCanvasSecondaryProviderAction(action)) {
        pendingVideoExecutionInputsRef.current.delete(action.requestId);
        const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
        if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
        setLocalError('无法请求视频编辑器运行体检');
      }
    });
    return action;
  }, [id, rf, update]);

  const runSecondaryAction = useCallback(async (reporter: RunNodeLifecycleReporter) => {
    const action = resolveSecondaryProviderActionForRun({
      nodeId: id,
      nodeType: 'video-edit',
      nodeData: rf.getNode(id)?.data,
      runContext: reporter.runContext,
    });
    if (!action) {
      throw new Error('视频编辑节点缺少已确认的次级 Provider action，已停止调用 Provider');
    }
    try {
      await executeRegisteredSecondaryProviderAction(action, reporter);
    } finally {
      pendingVideoExecutionInputsRef.current.delete(action.requestId);
      const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
      if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
    }
  }, [id, rf, update]);

  // VideoEdit 仍不参与普通运行；该唯一监听器只承接显式 Secondary Provider action。
  useRunTrigger(id, runSecondaryAction, undefined, { lifecycleAware: true });

  const videoEditSolidPalette = useMemo(
    () => resolveVideoEditSolidPalette(videoEditTemplateId, videoEditTheme, videoEditThemeStyle),
    [videoEditTemplateId, videoEditTheme, videoEditThemeStyle],
  );
  const videoEditSolidStyle = useMemo(
    () => ({
      '--t8-video-edit-surface': videoEditSolidPalette.surface,
      '--t8-video-edit-panel': videoEditSolidPalette.panel,
      '--t8-video-edit-muted': videoEditSolidPalette.muted,
      '--t8-video-edit-card': videoEditSolidPalette.card,
      '--t8-video-edit-action-bg': videoEditSolidPalette.actionBg,
      '--t8-video-edit-action-hover-bg': videoEditSolidPalette.actionHoverBg,
      '--t8-video-edit-action-border': videoEditSolidPalette.actionBorder,
      '--t8-video-edit-action-text': videoEditSolidPalette.actionText,
      '--t8-video-edit-action-shadow': videoEditSolidPalette.actionShadow,
      '--t8-video-edit-action-disabled-bg': videoEditSolidPalette.actionDisabledBg,
      '--t8-video-edit-action-disabled-text': videoEditSolidPalette.actionDisabledText,
      background: 'var(--t8-video-edit-surface)',
      borderColor: 'var(--t8-border)',
    } as CSSProperties),
    [videoEditSolidPalette],
  );
  const videoEditPanelStyle = useMemo(
    () => ({ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-panel)' } as CSSProperties),
    [],
  );
  const videoEditMutedStyle = useMemo(
    () => ({ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-muted)' } as CSSProperties),
    [],
  );
  const videoEditCardStyle = useMemo(
    () => ({ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-card)' } as CSSProperties),
    [],
  );
  const clips = useMemo(() => normalizeVideoEditClips(d.clips), [d.clips]);
  const timelineV2 = useMemo(
    () => normalizeVideoEditTimeline(d.timelineV2 as VideoEditTimelineV2 | undefined, clips),
    [d.timelineV2, clips],
  );
  const timelineV2Duration = useMemo(() => videoEditTimelineDuration(timelineV2), [timelineV2]);
  const timelineV2Conflicts = useMemo(() => detectVideoEditTimelineConflicts(timelineV2), [timelineV2]);
  const timelineRenderPlan = useMemo(() => buildVideoEditTimelineRenderPlan(timelineV2), [timelineV2]);
  const timelineComposeClips = useMemo(() => videoEditClipsFromTimelineRenderPlan(timelineRenderPlan), [timelineRenderPlan]);
  const settings = useMemo(() => normalizeVideoEditSettings(d.settings), [d.settings]);
  const outputVersions = useMemo(() => normalizeVideoEditOutputVersions(d.outputVersions), [d.outputVersions]);
  const selectedCreatorTemplate = useMemo(
    () => VIDEO_EDIT_CREATOR_TEMPLATES.find((item) => item.id === settings.creatorTemplate) || VIDEO_EDIT_CREATOR_TEMPLATES[0],
    [settings.creatorTemplate],
  );
  const selectedFilterOption = useMemo(
    () => FILTER_OPTIONS.find((item) => item.value === settings.filter) || FILTER_OPTIONS[0],
    [settings.filter],
  );
  const upstream = useUpstreamMaterials(id);
  const selectedLegacyClip = clips.find((clip) => clip.id === d.selectedClipId) || clips[0] || null;
  const resolveClipForTimelineItem = (
    item?: VideoEditTimelineItem,
    sourceClips: VideoEditClip[] = clips,
  ) => {
    if (!item) return undefined;
    return sourceClips.find((clip) => (
      clip.id === item.id
      || clip.id === item.assetId
      || (clip.assetId && clip.assetId === item.assetId)
      || `asset-${clip.id}` === item.assetId
    ));
  };
  const resolveClipIdForTimelineItemId = (
    itemId?: string,
    sourceTimeline: VideoEditTimelineV2 = timelineV2,
    sourceClips: VideoEditClip[] = clips,
  ) => {
    if (!itemId) return '';
    const item = sourceTimeline.items.find((entry) => entry.id === itemId);
    if (!item) return '';
    const linkedVideoItem = item.kind === 'video'
      ? item
      : (
        item.linkedItemId
          ? sourceTimeline.items.find((entry) => entry.id === item.linkedItemId && entry.kind === 'video')
          : sourceTimeline.items.find((entry) => entry.kind === 'video' && entry.linkedItemId === item.id)
      );
    return resolveClipForTimelineItem(linkedVideoItem || item, sourceClips)?.id || '';
  };
  const selectedTimelineItemId = useMemo(() => {
    const rawSelectedId = typeof d.selectedClipId === 'string' ? d.selectedClipId : '';
    const exactTimelineItem = timelineV2.items.find((item) => item.kind === 'video' && item.id === rawSelectedId);
    if (exactTimelineItem) return exactTimelineItem.id;
    const selectedTimelineV2Item = timelineV2.selectedItemIds
      .map((itemId) => timelineV2.items.find((item) => item.kind === 'video' && item.id === itemId))
      .find((item): item is VideoEditTimelineItem => Boolean(item));
    if (selectedTimelineV2Item) return selectedTimelineV2Item.id;
    if (!selectedLegacyClip) return undefined;
    const sourceItemId = `item-${selectedLegacyClip.id}-video`;
    return timelineV2.items.find((item) => item.kind === 'video' && item.id === sourceItemId)?.id
      || timelineV2.items.find((item) => item.kind === 'video' && item.assetId === selectedLegacyClip.assetId)?.id;
  }, [d.selectedClipId, selectedLegacyClip?.assetId, selectedLegacyClip?.id, timelineV2.items, timelineV2.selectedItemIds]);
  const timelinePlayback = useMemo(() => resolveVideoEditTimelinePlayback(timelineV2, selectedTimelineItemId), [selectedTimelineItemId, timelineV2]);
  const timelinePreviewClip = useMemo(() => buildVideoEditTimelinePreviewClip(timelinePlayback, clips), [clips, timelinePlayback]);
  const timelineHasVideoItems = useMemo(() => timelineV2.items.some((item) => item.kind === 'video'), [timelineV2.items]);
  const makePreviewClipKey = (clip?: VideoEditClip | null) => (
    clip ? `${clip.timelineItemId || clip.id}:${clip.url || ''}` : ''
  );
  const timelinePreviewIsEmptyGap = timelineHasVideoItems && !timelinePlayback.item;
  const baseSelectedClip = timelinePreviewClip || (timelineHasVideoItems && !timelinePlayback.item ? null : selectedLegacyClip);
  const basePreviewClipKey = makePreviewClipKey(baseSelectedClip);
  const previewOverrideMatchesTimeline = !timelinePreviewIsEmptyGap && !!previewOverride && (
    previewOverride.clipKey === basePreviewClipKey
    || !selectedTimelineItemId
    || previewOverride.timelineItemId === selectedTimelineItemId
  );
  const selectedClip = timelinePreviewIsEmptyGap ? null : (previewOverrideMatchesTimeline ? previewOverride.clip : baseSelectedClip);
  const activeTimelineItemId = previewOverrideMatchesTimeline
    ? previewOverride.timelineItemId
    : selectedTimelineItemId;
  const previewClipKey = makePreviewClipKey(selectedClip);
  const compactTimelineClips = useMemo(() => {
    if (clips.length <= VIDEO_EDIT_COMPACT_TIMELINE_LIMIT) return clips;
    const first = clips.slice(0, VIDEO_EDIT_COMPACT_TIMELINE_LIMIT);
    if (!selectedClip || first.some((clip) => clip.id === selectedClip.id)) return first;
    return [...clips.slice(0, VIDEO_EDIT_COMPACT_TIMELINE_LIMIT - 1), selectedClip];
  }, [clips, selectedClip?.id]);
  const workbenchFilteredClips = useMemo(() => {
    const query = workbenchClipSearch.trim().toLowerCase();
    return clips.filter((clip) => {
      if (workbenchClipSourceFilter !== 'all' && videoEditClipSourceBucket(clip) !== workbenchClipSourceFilter) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        clip.name,
        clip.sourceLabel,
        clip.sourceNodeLabel,
        clip.sourceCanvasName,
        clip.sourceNodeId,
        clip.url,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [clips, workbenchClipSearch, workbenchClipSourceFilter]);
  const workbenchUsedClipIds = useMemo(() => {
    const ids = new Set<string>();
    timelineV2.items.forEach((item) => {
      const sourceClip = resolveClipForTimelineItem(item);
      if (sourceClip?.id) ids.add(sourceClip.id);
    });
    return ids;
  }, [resolveClipForTimelineItem, timelineV2.items]);
  const workbenchClipWindowEnd = Math.min(workbenchFilteredClips.length, workbenchClipWindowStart + VIDEO_EDIT_WORKBENCH_WINDOW_SIZE);
  const workbenchVisibleClips = useMemo(
    () => workbenchFilteredClips.slice(workbenchClipWindowStart, workbenchClipWindowEnd),
    [workbenchClipWindowEnd, workbenchClipWindowStart, workbenchFilteredClips],
  );
  const workbenchVideoTrackById = useMemo(
    () => new Map(timelineV2.tracks
      .filter((track) => track.kind === 'video')
      .map((track) => [track.id, track])),
    [timelineV2.tracks],
  );
  const workbenchMainVideoTrack = useMemo(
    () => timelineV2.tracks.find((track) => track.id === 'track-video-main' && track.kind === 'video')
      || timelineV2.tracks
        .filter((track) => track.kind === 'video')
        .slice()
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0],
    [timelineV2.tracks],
  );
  const isWorkbenchOverlayTimelineItem = (item: VideoEditTimelineItem) => {
    if (item.kind !== 'video') return false;
    const track = workbenchVideoTrackById.get(item.trackId);
    if (!track || track.kind !== 'video') return false;
    if (track.id === 'track-video-overlay' || track.name.includes('叠加')) return true;
    if (!workbenchMainVideoTrack) return false;
    return track.id !== workbenchMainVideoTrack.id && track.order > workbenchMainVideoTrack.order;
  };
  const workbenchMainTimelineItems = useMemo(
    () => timelineV2.items
      .filter((item) => item.kind === 'video')
      .filter((item) => !isWorkbenchOverlayTimelineItem(item))
      .slice()
      .sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id)),
    [timelineV2.items, workbenchVideoTrackById, workbenchMainVideoTrack],
  );
  const workbenchOverlayTimelineItems = useMemo(
    () => timelineV2.items
      .filter((item) => item.kind === 'video')
      .filter((item) => isWorkbenchOverlayTimelineItem(item))
      .slice()
      .sort((a, b) => {
        const trackA = workbenchVideoTrackById.get(a.trackId);
        const trackB = workbenchVideoTrackById.get(b.trackId);
        return a.timelineStart - b.timelineStart
          || (trackA?.order ?? 0) - (trackB?.order ?? 0)
          || a.id.localeCompare(b.id);
      }),
    [timelineV2.items, workbenchVideoTrackById, workbenchMainVideoTrack],
  );
  const workbenchAllTimelineItems = useMemo(
    () => [...workbenchMainTimelineItems, ...workbenchOverlayTimelineItems]
      .sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id)),
    [workbenchMainTimelineItems, workbenchOverlayTimelineItems],
  );
  const workbenchTimelineWindowEnd = Math.min(
    workbenchMainTimelineItems.length,
    workbenchTimelineWindowStart + VIDEO_EDIT_WORKBENCH_WINDOW_SIZE,
  );
  const workbenchTimelineItems = useMemo(
    () => workbenchMainTimelineItems.slice(workbenchTimelineWindowStart, workbenchTimelineWindowEnd),
    [workbenchMainTimelineItems, workbenchTimelineWindowStart, workbenchTimelineWindowEnd],
  );
  const workbenchTimelineHasItems = workbenchMainTimelineItems.length > 0 || workbenchOverlayTimelineItems.length > 0;
  const clipByTimelineAssetId = useMemo(() => {
    const map = new Map<string, VideoEditClip>();
    clips.forEach((clip) => {
      if (clip.assetId) map.set(clip.assetId, clip);
      map.set(`asset-${clip.id}`, clip);
    });
    return map;
  }, [clips]);
  const workbenchTimelineWindowLabel = workbenchMainTimelineItems.length
    ? `主轨 ${workbenchTimelineWindowStart + 1}-${workbenchTimelineWindowEnd}/${workbenchMainTimelineItems.length}`
    : workbenchAllTimelineItems.length
      ? `主轨暂无 / 全轨 ${workbenchAllTimelineItems.length}`
    : '暂无轨道片段';
  const workbenchWindowLabel = clips.length
    ? (workbenchFilteredClips.length
      ? `显示 ${workbenchClipWindowStart + 1}-${workbenchClipWindowEnd}/${workbenchFilteredClips.length}`
      : `无匹配 / 共 ${clips.length} 段`)
    : '暂无片段';
  const totalDuration = totalVideoEditDuration(clips);
  const outputUrl = String(d.videoUrl || d.output?.videoUrl || '');
  const audioUrl = String(d.audioUrl || '');
  const status = String(d.status || d.job?.status || (clips.length > 0 ? 'ready' : 'idle'));
  const running = status === 'running' || d.job?.status === 'running' || busy === 'compose' || busy === 'separate-audio';
  const timelineHealth = videoEditTimelineHealthSummary(timelineComposeClips, settings);
  const durationBudget = videoEditDurationBudget(timelineComposeClips, settings);
  const renderPlanUnsupported = useMemo(() => {
    const unsupported = [...(timelineRenderPlan.unsupported || [])];
    return Array.from(new Set(unsupported));
  }, [timelineRenderPlan.unsupported]);
  const timelineCapabilities = timelineRenderPlan.capabilities;
  const renderPlanCapabilityBadges = useMemo(() => [
    {
      key: 'timeline',
      label: timelineCapabilities.timelineLayerCompose
        ? `多轨 ${timelineCapabilities.timelineLayerCount}轨`
        : '顺序拼接',
      detail: timelineCapabilities.timelineGaps ? '含空隙' : '视频',
      active: timelineComposeClips.length > 0,
    },
    {
      key: 'audio',
      label: timelineCapabilities.timelineAudioMix
        ? '音频混合'
        : (timelineCapabilities.sourceAudioMix ? '保留原声' : '无音频'),
      detail: timelineCapabilities.timelineAudioMix ? '多轨' : '声道',
      active: timelineCapabilities.timelineAudioMix || timelineCapabilities.sourceAudioMix,
    },
    {
      key: 'pip',
      label: timelineCapabilities.timelineLayerCount > 1 ? `PIP ${Math.max(0, timelineCapabilities.timelineLayerCount - 1)}轨` : '无PIP',
      detail: timelineCapabilities.timelineLayerCompose ? '叠加导出' : '未启用',
      active: timelineCapabilities.timelineLayerCompose && timelineCapabilities.timelineLayerCount > 1,
    },
    {
      key: 'subtitle',
      label: timelineCapabilities.subtitleBurnIn ? '字幕烧录' : '无字幕',
      detail: timelineCapabilities.subtitleBurnIn ? '文本轨' : '未启用',
      active: timelineCapabilities.subtitleBurnIn,
    },
  ], [
    timelineCapabilities.sourceAudioMix,
    timelineCapabilities.subtitleBurnIn,
    timelineCapabilities.timelineAudioMix,
    timelineCapabilities.timelineGaps,
    timelineCapabilities.timelineLayerCompose,
    timelineCapabilities.timelineLayerCount,
    timelineComposeClips.length,
  ]);
  const previewContractItems = useMemo(() => [
    {
      key: 'preview',
      label: '当前预览：时间线播放头',
      detail: selectedClip ? '主轨随播放头切换' : '等待选择片段',
    },
    {
      key: 'timeline',
      label: timelineCapabilities.timelineLayerCompose ? '最终导出：多轨合成' : '最终导出：顺序拼接',
      detail: timelineCapabilities.timelineGaps ? '含空隙/覆盖' : '按时间线',
    },
    {
      key: 'subtitle',
      label: timelineCapabilities.subtitleBurnIn ? '字幕会烧录' : '字幕未启用',
      detail: timelineCapabilities.timelineAudioMix ? '音频按轨混合' : '音频按设置',
    },
  ], [
    selectedClip,
    timelineCapabilities.subtitleBurnIn,
    timelineCapabilities.timelineAudioMix,
    timelineCapabilities.timelineGaps,
    timelineCapabilities.timelineLayerCompose,
  ]);
  const previewTimelineSecond = Number.isFinite(Number(timelineV2.playhead)) ? Math.max(0, Number(timelineV2.playhead)) : 0;
  const previewFilterCss = useMemo(() => videoEditPreviewFilterCss(settings.filter), [settings.filter]);
  const previewVideoStyle = useMemo<CSSProperties>(() => (
    previewFilterCss ? { filter: previewFilterCss } : {}
  ), [previewFilterCss]);
  const previewTransitionDefinition = useMemo(() => (
    VIDEO_EDIT_TRANSITION_GROUPS.flatMap((group) => group.options).find((item) => item.id === settings.transition) || null
  ), [settings.transition]);
  const workbenchTransitionCutItems = useMemo(() => {
    const duration = Math.max(0.1, Math.min(2, Number(settings.transitionDuration) || 0.8));
    const label = settings.transition === 'none'
      ? '无转场'
      : (previewTransitionDefinition?.label || settings.transition);
    return workbenchTimelineItems.slice(1).map((item, offset) => {
      const left = videoEditTimelineTimeToX(item.timelineStart, {
        pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
        zoom: timelineZoom,
        scrollLeft: 0,
      });
      return {
        id: item.id,
        index: workbenchTimelineWindowStart + offset + 1,
        left,
        label,
        durationLabel: `${duration.toFixed(1)}s`,
      };
    });
  }, [
    previewTransitionDefinition?.label,
    settings.transition,
    settings.transitionDuration,
    timelineZoom,
    workbenchTimelineItems,
    workbenchTimelineWindowStart,
  ]);
  const activePreviewTransition = useMemo<VideoEditPreviewTransitionState | null>(() => {
    if (!selectedClip || !timelinePlayback.item || settings.transition === 'none') return null;
    const duration = Math.max(0.1, Math.min(2, Number(settings.transitionDuration) || 0.8));
    const primaryClips = timelineRenderPlan.clips
      .filter((item) => item.layerIndex === 0)
      .slice()
      .sort((a, b) => a.timelineStart - b.timelineStart || a.sourceItemId.localeCompare(b.sourceItemId));
    const activeIndex = primaryClips.findIndex((item) => item.sourceItemId === timelinePlayback.item?.id);
    if (activeIndex < 0) return null;
    const active = primaryClips[activeIndex];
    const enterEnd = active.timelineStart + duration;
    const exitStart = active.timelineEnd - duration;
    const nearEnter = activeIndex > 0
      && previewTimelineSecond >= active.timelineStart
      && previewTimelineSecond <= enterEnd;
    const nearExit = activeIndex < primaryClips.length - 1
      && previewTimelineSecond >= exitStart
      && previewTimelineSecond <= active.timelineEnd;
    if (!nearEnter && !nearExit) return null;
    const rawProgress = nearEnter
      ? (previewTimelineSecond - active.timelineStart) / duration
      : (active.timelineEnd - previewTimelineSecond) / duration;
    return {
      edge: nearEnter ? 'enter' : 'exit',
      duration,
      progress: Math.max(0, Math.min(1, rawProgress)),
      transition: settings.transition,
      label: previewTransitionDefinition?.label || settings.transition,
    };
  }, [
    previewTimelineSecond,
    previewTransitionDefinition?.label,
    selectedClip,
    settings.transition,
    settings.transitionDuration,
    timelinePlayback.item,
    timelineRenderPlan.clips,
  ]);
  const activePreviewPipSegments = useMemo(() => timelineRenderPlan.clips.filter((item) => (
    item.layerIndex > 0
    && previewTimelineSecond >= item.timelineStart
    && previewTimelineSecond <= item.timelineEnd
  )), [previewTimelineSecond, timelineRenderPlan.clips]);
  const activePreviewTextSegments = useMemo(() => timelineRenderPlan.text.filter((item) => (
    previewTimelineSecond >= item.timelineStart
    && previewTimelineSecond <= item.timelineEnd
  )), [previewTimelineSecond, timelineRenderPlan.text]);
  const previewEnabledAudioSegments = useMemo(() => timelineRenderPlan.audio
    .filter((item) => !item.muted)
    .slice()
    .sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id)), [timelineRenderPlan.audio]);
  const activePreviewAudioSegments = useMemo(() => timelineRenderPlan.audio.filter((item) => (
    settings.audio !== 'mute'
    && !item.linkedVideoItemId
    && !item.muted
    && previewTimelineSecond >= item.timelineStart
    && previewTimelineSecond <= item.timelineEnd
    && (
      settings.audio !== 'first'
      || previewEnabledAudioSegments[0]?.sourceItemId === item.sourceItemId
    )
  )), [previewEnabledAudioSegments, previewTimelineSecond, settings.audio, timelineRenderPlan.audio]);
  const sourcePreviewAudioSegments = useMemo(() => timelineRenderPlan.audio.filter((item) => !!item.linkedVideoItemId), [timelineRenderPlan.audio]);
  const activePreviewSourceAudioSegment = useMemo(() => {
    if (settings.audio === 'mute') return null;
    const activeSourceSegments = sourcePreviewAudioSegments.filter((item) => (
      !item.muted
      && previewTimelineSecond >= item.timelineStart
      && previewTimelineSecond <= item.timelineEnd
    ));
    if (settings.audio === 'first') {
      const firstEnabledAudio = previewEnabledAudioSegments[0];
      if (!firstEnabledAudio?.linkedVideoItemId) return null;
      return activeSourceSegments.find((item) => item.sourceItemId === firstEnabledAudio.sourceItemId) || null;
    }
    const activePlaybackItemId = timelinePlayback.item?.id || '';
    return activeSourceSegments.find((item) => item.linkedVideoItemId === activePlaybackItemId) || null;
  }, [
    previewEnabledAudioSegments,
    previewTimelineSecond,
    settings.audio,
    sourcePreviewAudioSegments,
    timelinePlayback.item?.id,
  ]);
  const activePreviewLinkedSourceAudioSegments = useMemo(() => {
    if (settings.audio === 'mute') return [];
    const activePlaybackItemId = timelinePlayback.item?.id || '';
    return sourcePreviewAudioSegments.filter((item) => (
      !item.muted
      && item.linkedVideoItemId !== activePlaybackItemId
      && previewTimelineSecond >= item.timelineStart
      && previewTimelineSecond <= item.timelineEnd
      && (
        settings.audio !== 'first'
        || previewEnabledAudioSegments[0]?.sourceItemId === item.sourceItemId
      )
    ));
  }, [
    previewEnabledAudioSegments,
    previewTimelineSecond,
    settings.audio,
    sourcePreviewAudioSegments,
    timelinePlayback.item?.id,
  ]);
  const activePreviewAudioPlaybackSegments = useMemo(
    () => [...activePreviewAudioSegments, ...activePreviewLinkedSourceAudioSegments],
    [activePreviewAudioSegments, activePreviewLinkedSourceAudioSegments],
  );
  const activePreviewSourceAudioVolume = useMemo(() => {
    const rawVolume = Number(activePreviewSourceAudioSegment?.volume);
    const baseVolume = Number.isFinite(rawVolume) ? Math.max(0, Math.min(1, rawVolume)) : 1;
    const envelope = activePreviewSourceAudioSegment
      ? videoEditAudioEnvelopeMultiplier(activePreviewSourceAudioSegment, previewTimelineSecond)
      : 0;
    return Number(Math.max(0, Math.min(1, baseVolume * envelope)).toFixed(3));
  }, [activePreviewSourceAudioSegment, previewTimelineSecond]);
  const previewMainVideoMuted = !activePreviewSourceAudioSegment || activePreviewSourceAudioVolume <= 0;
  const previewOverlaySegmentSourceTime = (segment: {
    timelineStart: number;
    trimStart: number;
    trimEnd: number;
  }) => {
    const trimStart = Math.max(0, Number(segment.trimStart) || 0);
    const trimEnd = Math.max(trimStart, Number(segment.trimEnd) || trimStart);
    const offset = Math.max(0, previewTimelineSecond - (Number(segment.timelineStart) || 0));
    return Math.max(trimStart, Math.min(trimEnd, trimStart + offset));
  };
  const previewAudioSegmentSourceTime = previewOverlaySegmentSourceTime;
  const syncActivePreviewOverlayVideos = (mode?: 'play' | 'pause') => {
    const mainVideo = previewVideoRef.current;
    const activeIds = new Set(activePreviewPipSegments.map((segment) => segment.sourceItemId));
    Object.entries(previewOverlayVideoRefs.current).forEach(([segmentId, overlayVideo]) => {
      if (!overlayVideo || activeIds.has(segmentId)) return;
      overlayVideo.pause();
    });
    activePreviewPipSegments.forEach((segment) => {
      const overlayVideo = previewOverlayVideoRefs.current[segment.sourceItemId];
      if (!overlayVideo) return;
      const sourceTime = previewOverlaySegmentSourceTime(segment);
      overlayVideo.muted = true;
      overlayVideo.playsInline = true;
      try {
        if (Number.isFinite(sourceTime) && Math.abs((overlayVideo.currentTime || 0) - sourceTime) > 0.18) {
          overlayVideo.currentTime = sourceTime;
        }
      } catch (_) {
        // Metadata may still be loading; the loadedmetadata handler will retry.
      }
      const shouldPlay = mode === 'play' || (mode !== 'pause' && !!mainVideo && !mainVideo.paused && !mainVideo.ended);
      if (shouldPlay) {
        void overlayVideo.play().catch(() => {});
      } else {
        overlayVideo.pause();
      }
    });
  };
  const syncActivePreviewAudioTracks = (mode?: 'play' | 'pause') => {
    const mainVideo = previewVideoRef.current;
    const activeIds = new Set(activePreviewAudioPlaybackSegments.map((segment) => segment.sourceItemId));
    Object.entries(previewAudioRefs.current).forEach(([segmentId, previewAudio]) => {
      if (!previewAudio || activeIds.has(segmentId)) return;
      previewAudio.pause();
    });
    activePreviewAudioPlaybackSegments.forEach((segment) => {
      const previewAudio = previewAudioRefs.current[segment.sourceItemId];
      if (!previewAudio) return;
      const sourceTime = previewAudioSegmentSourceTime(segment);
      const rawVolume = Number(segment.volume);
      const baseVolume = Number.isFinite(rawVolume) ? Math.max(0, Math.min(1, rawVolume)) : 1;
      const volume = Number(Math.max(0, Math.min(1, baseVolume * videoEditAudioEnvelopeMultiplier(segment, previewTimelineSecond))).toFixed(3));
      previewAudio.volume = volume;
      previewAudio.muted = volume <= 0;
      try {
        if (Number.isFinite(sourceTime) && Math.abs((previewAudio.currentTime || 0) - sourceTime) > 0.18) {
          previewAudio.currentTime = sourceTime;
        }
      } catch (_) {
        // Metadata may still be loading; the loadedmetadata handler will retry.
      }
      const shouldPlay = mode === 'play' || (mode !== 'pause' && !!mainVideo && !mainVideo.paused && !mainVideo.ended);
      if (shouldPlay && !previewAudio.muted) {
        void previewAudio.play().catch(() => {});
      } else {
        previewAudio.pause();
      }
    });
  };
  const syncActivePreviewMedia = (mode?: 'play' | 'pause') => {
    syncActivePreviewOverlayVideos(mode);
    syncActivePreviewAudioTracks(mode);
  };
  useEffect(() => {
    syncActivePreviewMedia();
  }, [activePreviewAudioPlaybackSegments, activePreviewPipSegments, previewTimelineSecond, previewTime, selectedClip?.url]);
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    const inWorkbench = !!video.closest('[data-video-edit-workbench="true"]');
    video.muted = inWorkbench ? previewMainVideoMuted : true;
    video.volume = inWorkbench && !previewMainVideoMuted ? activePreviewSourceAudioVolume : 0;
  }, [activePreviewSourceAudioVolume, previewMainVideoMuted, selectedClip?.url, workbenchOpen]);
  const hasTimelineV2Conflicts = timelineV2Conflicts.length > 0;
  const canCompose = timelineComposeClips.length > 0 && timelineHealth.blocks === 0 && !hasTimelineV2Conflicts && renderPlanUnsupported.length === 0 && !running && !busy;
  const composeBlockedReason = renderPlanUnsupported.length
    ? '需处理'
    : hasTimelineV2Conflicts ? '先处理冲突' : timelineHealth.blocks > 0
      ? '体检异常'
      : '待素材';
  const composeBlockedMessage = useMemo(() => {
    if (renderPlanUnsupported.length) return `当前剪辑台暂不支持导出：${renderPlanUnsupported.join('、')}`;
    if (hasTimelineV2Conflicts) return '请先处理时间线重叠冲突，再导出成片';
    if (timelineHealth.blocks > 0) return `请先修复体检异常：${timelineHealth.label}`;
    if (!timelineComposeClips.length) return '请先导入或添加至少一段视频素材';
    if (running || busy === 'compose' || busy === 'separate-audio' || busy === 'platform-export') return '已有视频处理任务正在进行，请完成或取消后再导出';
    if (busy === 'upload') return '素材仍在上传或探测，请稍后再导出';
    if (busy) return '当前剪辑台正在处理操作，请稍后再导出';
    return '';
  }, [
    busy,
    hasTimelineV2Conflicts,
    renderPlanUnsupported,
    running,
    timelineComposeClips.length,
    timelineHealth.blocks,
    timelineHealth.label,
  ]);
  const workbenchJobNotice = useMemo(() => {
    const workbenchJobStatus = String(d.job?.status || status || '');
    const message = localError || String(d.error || '') || String(d.job?.message || '');
    if (workbenchJobStatus === 'failed' || status === 'error') {
      return {
        status: workbenchJobStatus === 'failed' ? 'failed' : 'error',
        tone: 'error',
        message: message || '视频合成失败',
      };
    }
    if (workbenchJobStatus === 'cancelled' || status === 'cancelled') {
      return {
        status: 'cancelled',
        tone: 'warning',
        message: message || '视频合成已取消',
      };
    }
    return null;
  }, [d.error, d.job?.message, d.job?.status, localError, status]);
  const composeStatusLabel = canCompose ? '可合成' : composeBlockedReason;
  const subtitleSegmentCount = timelineRenderPlan.text.length;
  const independentAudioCount = timelineRenderPlan.audio.filter((item) => !item.linkedVideoItemId).length;
  const sourceAudioCount = timelineRenderPlan.audio.filter((item) => !!item.linkedVideoItemId).length;
  const overlayVideoCount = timelineRenderPlan.clips.filter((item) => item.layerIndex > 0).length;
  const mainVideoCount = Math.max(0, timelineRenderPlan.clips.length - overlayVideoCount);
  const previewLimitSummary = useMemo(() => {
    const pipVisible = activePreviewPipSegments.length;
    const subtitleVisible = activePreviewTextSegments.length;
    const pipText = overlayVideoCount > 0
      ? `PIP 当前 ${pipVisible}/${overlayVideoCount}`
      : '无 PIP';
    const subtitleText = subtitleSegmentCount > 0
      ? `字幕当前 ${subtitleVisible}/${subtitleSegmentCount}`
      : '无字幕';
    const sourceAudioText = sourceAudioCount > 0
      ? (settings.audio === 'mute'
        ? `原声静音 0/${sourceAudioCount}`
        : `原声当前 ${(activePreviewSourceAudioSegment ? 1 : 0) + activePreviewLinkedSourceAudioSegments.length}/${sourceAudioCount}`)
      : '无原声';
    const audioText = independentAudioCount > 0
      ? `音频当前 ${activePreviewAudioSegments.length}/${independentAudioCount} · ${sourceAudioText}`
      : (sourceAudioCount > 0 ? sourceAudioText : '无音频轨');
    return `${pipText} · ${subtitleText} · ${audioText}`;
  }, [
    activePreviewAudioSegments.length,
    activePreviewLinkedSourceAudioSegments.length,
    activePreviewPipSegments.length,
    activePreviewSourceAudioSegment,
    activePreviewTextSegments.length,
    independentAudioCount,
    overlayVideoCount,
    settings.audio,
    sourceAudioCount,
    subtitleSegmentCount,
  ]);
  const workbenchTrackOverview = useMemo(() => [
    {
      key: 'video',
      label: '视频轨',
      status: mainVideoCount > 0 ? `${mainVideoCount} 段` : '待导入',
      detail: timelineCapabilities.timelineLayerCompose ? `${timelineCapabilities.timelineLayerCount} 轨合成` : '顺序拼接',
      active: mainVideoCount > 0,
      actionLabel: '看时间线',
    },
    {
      key: 'overlay',
      label: '叠加轨',
      status: overlayVideoCount > 0 ? `${overlayVideoCount} 层` : '可添加',
      detail: '片段库点叠加',
      active: overlayVideoCount > 0,
      actionLabel: '去片段库',
    },
    {
      key: 'audio',
      label: '音频轨',
      status: independentAudioCount > 0 ? `${independentAudioCount} 条` : (sourceAudioCount > 0 ? '原声' : '无音频'),
      detail: timelineCapabilities.timelineAudioMix ? '混合导出' : '按设置',
      active: independentAudioCount > 0 || sourceAudioCount > 0,
      actionLabel: '加音频',
    },
    {
      key: 'subtitle',
      label: '字幕轨',
      status: subtitleSegmentCount > 0 ? `${subtitleSegmentCount} 条` : '未添加',
      detail: timelineCapabilities.subtitleBurnIn ? '烧录导出' : '回车添加',
      active: subtitleSegmentCount > 0,
      actionLabel: '加字幕',
    },
  ], [
    independentAudioCount,
    mainVideoCount,
    overlayVideoCount,
    sourceAudioCount,
    subtitleSegmentCount,
    timelineCapabilities.subtitleBurnIn,
    timelineCapabilities.timelineAudioMix,
    timelineCapabilities.timelineLayerCompose,
    timelineCapabilities.timelineLayerCount,
  ]);
  const workbenchExportContractItems = useMemo(() => [
    {
      key: 'pip',
      label: 'PIP',
      status: overlayVideoCount > 0 ? `${overlayVideoCount} 层导出` : '未使用',
    },
    {
      key: 'subtitle',
      label: '字幕',
      status: subtitleSegmentCount > 0 ? `${subtitleSegmentCount} 条烧录` : '未使用',
    },
    {
      key: 'audio',
      label: '音频',
      status: independentAudioCount > 0
        ? `${independentAudioCount} 条混合`
        : (sourceAudioCount > 0 ? '保留原声' : '无音频'),
    },
    {
      key: 'preview',
      label: '预览',
      status: previewLimitSummary,
    },
  ], [
    independentAudioCount,
    overlayVideoCount,
    previewLimitSummary,
    sourceAudioCount,
    subtitleSegmentCount,
  ]);
  const workbenchCreatorChecklist = useMemo(() => [
    {
      key: 'subtitle',
      label: '字幕轨',
      status: subtitleSegmentCount > 0 ? `${subtitleSegmentCount} 条` : '未添加',
      detail: subtitleSegmentCount > 0 ? '最终导出会烧录' : '输入字幕后添加到播放头',
      actionLabel: '添加字幕',
      active: subtitleSegmentCount > 0,
      disabled: running || busy === 'compose',
    },
    {
      key: 'audio',
      label: '独立音频',
      status: independentAudioCount > 0 ? `${independentAudioCount} 条` : (sourceAudioCount > 0 ? '保留原声' : '无音频'),
      detail: independentAudioCount > 0 ? '会与视频混合' : '可导入旁白 / BGM',
      actionLabel: '导入音频',
      active: independentAudioCount > 0 || sourceAudioCount > 0,
      disabled: running || !!busy,
    },
    {
      key: 'export',
      label: '最终导出',
      status: composeStatusLabel,
      detail: renderPlanUnsupported.length ? '先修复不支持项' : hasTimelineV2Conflicts ? '先调整重叠片段' : '按完整时间线输出',
      actionLabel: '合成视频',
      active: canCompose,
      disabled: !canCompose || !!busy,
    },
  ], [
    busy,
    canCompose,
    independentAudioCount,
    composeStatusLabel,
    hasTimelineV2Conflicts,
    renderPlanUnsupported.length,
    running,
    sourceAudioCount,
    subtitleSegmentCount,
  ]);
  const workbenchCreatorCommandItems = useMemo(() => [
    {
      key: 'timeline',
      label: '多轨时间线',
      status: workbenchTimelineItems.length > 0 ? `${workbenchTimelineItems.length} 项` : '待整理',
      detail: '拖拽排序 / 裁剪 / 吸附',
      actionLabel: '看轨道',
      active: workbenchTimelineItems.length > 0,
      disabled: false,
    },
    {
      key: 'subtitle',
      label: '字幕轨',
      status: subtitleSegmentCount > 0 ? `${subtitleSegmentCount} 条` : '可添加',
      detail: '输入文字后烧录到成片',
      actionLabel: '加字幕',
      active: subtitleSegmentCount > 0,
      disabled: running || busy === 'compose',
    },
    {
      key: 'audio',
      label: '音频轨',
      status: independentAudioCount > 0 ? `${independentAudioCount} 条` : (sourceAudioCount > 0 ? '原声' : '可导入'),
      detail: 'BGM / 旁白 / 分离音频',
      actionLabel: '导入音频',
      active: independentAudioCount > 0 || sourceAudioCount > 0,
      disabled: running || !!busy,
    },
    {
      key: 'overlay',
      label: '叠加 / PIP',
      status: overlayVideoCount > 0 ? `${overlayVideoCount} 层` : '可叠加',
      detail: '画中画、上层视频轨',
      actionLabel: '去片段库',
      active: overlayVideoCount > 0,
      disabled: false,
    },
    {
      key: 'cover',
      label: '封面帧',
      status: d.coverImageUrl ? '已设置' : '未设置',
      detail: '截取当前预览帧',
      actionLabel: '设封面',
      active: !!d.coverImageUrl,
      disabled: !selectedClip || running || !!busy,
    },
    {
      key: 'transition',
      label: '转场',
      status: settings.transition === 'none' ? '无' : (previewTransitionDefinition?.label || settings.transition),
      detail: `过渡时长 ${Number(settings.transitionDuration || 0.8).toFixed(1)}s`,
      actionLabel: '调过渡',
      active: settings.transition !== 'none',
      disabled: false,
    },
    {
      key: 'filter',
      label: '滤镜',
      status: selectedFilterOption?.label || '无',
      detail: settings.filter === 'none' ? '保持原片色彩' : '预览与导出同步',
      actionLabel: '调色',
      active: settings.filter !== 'none',
      disabled: false,
    },
    {
      key: 'export',
      label: '输出与分离',
      status: composeStatusLabel,
      detail: '合成 / 无声 / 提取音频',
      actionLabel: canCompose ? '合成' : '看设置',
      active: canCompose,
      disabled: !!busy,
    },
  ], [
    busy,
    canCompose,
    d.coverImageUrl,
    independentAudioCount,
    overlayVideoCount,
    composeStatusLabel,
    renderPlanUnsupported.length,
    running,
    selectedClip,
    selectedFilterOption?.label,
    sourceAudioCount,
    previewTransitionDefinition?.label,
    settings.filter,
    settings.transition,
    settings.transitionDuration,
    subtitleSegmentCount,
    workbenchTimelineItems.length,
  ]);
  const workbenchTopStatusItems = useMemo(
    () => workbenchCreatorCommandItems.filter((item) => ['timeline', 'subtitle', 'audio', 'export'].includes(item.key)),
    [workbenchCreatorCommandItems],
  );
  const workbenchInspectorActionItems = useMemo(
    () => workbenchCreatorCommandItems.filter((item) => ['subtitle', 'audio', 'overlay', 'cover'].includes(item.key)),
    [workbenchCreatorCommandItems],
  );
  const hasPotentialAudio = timelineComposeClips.some((clip) => clip.hasAudio !== false)
    || timelineRenderPlan.audio.some((item) => !item.muted);
  const workbenchFeatureAuditItems = useMemo(() => [
    {
      key: 'subtitle-style',
      label: '字幕样式',
      status: subtitleSegmentCount > 0 ? `${subtitleSegmentCount} 条` : '待添加',
      detail: '位置/字号/颜色/底色',
      active: subtitleSegmentCount > 0,
      actionLabel: subtitleSegmentCount > 0 ? '选中可调' : '输入字幕',
    },
    {
      key: 'audio-flow',
      label: '音频分离',
      status: independentAudioCount > 0 ? `${independentAudioCount} 条` : (sourceAudioCount > 0 ? '有原声' : '待音频'),
      detail: '导入/预听/无声/提取',
      active: independentAudioCount > 0 || sourceAudioCount > 0,
      actionLabel: hasPotentialAudio ? '可导出' : '加音频',
    },
    {
      key: 'pip-flow',
      label: 'PIP 位置',
      status: overlayVideoCount > 0 ? `${overlayVideoCount} 层` : '待叠加',
      detail: '位置/缩放/透明度',
      active: overlayVideoCount > 0,
      actionLabel: overlayVideoCount > 0 ? '选中可调' : '去片段库',
    },
    {
      key: 'export-flow',
      label: '输出模式',
      status: composeStatusLabel,
      detail: '合成/无声/提取音频',
      active: canCompose,
      actionLabel: '看输出',
    },
  ], [
    canCompose,
    hasPotentialAudio,
    independentAudioCount,
    overlayVideoCount,
    composeStatusLabel,
    renderPlanUnsupported.length,
    sourceAudioCount,
    subtitleSegmentCount,
  ]);
  const workbenchTimelineDuration = Math.max(1, timelineV2Duration || totalDuration || clips.length * 5 || 1);
  const workbenchTimelineVirtualWidth = useMemo(
    () => Math.max(720, Math.ceil(workbenchTimelineDuration * VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND * timelineZoom)),
    [timelineZoom, workbenchTimelineDuration],
  );
  const workbenchTimelineTrackItemStyle = (timelineStart: number, timelineEnd: number, minWidth = 84): CSSProperties => {
    const left = videoEditTimelineTimeToX(timelineStart, {
      pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
      zoom: timelineZoom,
      scrollLeft: 0,
    });
    const width = Math.max(
      minWidth,
      Math.round(Math.max(0.1, timelineEnd - timelineStart) * VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND * timelineZoom),
    );
    return { left, width, minWidth: width };
  };
  const workbenchPlayheadGeometry = useMemo(() => {
    const virtualWidth = Math.max(1, workbenchTimelineVirtualWidth || videoEditTimelineTimeToX(workbenchTimelineDuration, {
      pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
      zoom: timelineZoom,
      scrollLeft: 0,
    }));
    const playheadX = Math.max(0, Math.min(virtualWidth, videoEditTimelineTimeToX(timelineV2.playhead, {
      pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
      zoom: timelineZoom,
      scrollLeft: 0,
    })));
    return { x: playheadX, ratio: playheadX / virtualWidth };
  }, [timelineV2.playhead, timelineZoom, workbenchTimelineDuration, workbenchTimelineVirtualWidth]);
  const workbenchPlayheadStyle = useMemo(
    () => ({ left: `${workbenchPlayheadGeometry.x}px` }) as CSSProperties,
    [workbenchPlayheadGeometry.x],
  );
  const workbenchRulerPlayheadStyle = useMemo(
    () => ({ left: `${workbenchPlayheadGeometry.ratio * 100}%` }) as CSSProperties,
    [workbenchPlayheadGeometry.ratio],
  );
  const timelineRulerTicks = useMemo(() => {
    const span = workbenchTimelineDuration;
    return Array.from({ length: 7 }, (_, index) => {
      const ratio = index / 6;
      return {
        ratio,
        label: formatSeconds(span * ratio),
      };
    });
  }, [workbenchTimelineDuration]);
  const allTrackAudioMuted = clips.length > 0 && clips.every((clip) => clip.muted || clip.hasAudio === false);
  const selectedTimelineItemIds = useMemo(() => new Set(timelineV2.selectedItemIds), [timelineV2.selectedItemIds]);
  const selectedTimelineItems = useMemo(() => {
    const selectedIds = new Set(selectedTimelineItemIds);
    if (!selectedIds.size && activeTimelineItemId) selectedIds.add(activeTimelineItemId);
    return timelineV2.items.filter((item) => selectedIds.has(item.id));
  }, [activeTimelineItemId, selectedTimelineItemIds, timelineV2.items]);
  const selectedTimelineItemCount = selectedTimelineItems.length;
  const selectedTimelineBatchPropertyCounts = useMemo(() => {
    const media = selectedTimelineItems.filter((item) => item.kind !== 'text').length;
    const text = selectedTimelineItems.filter((item) => item.kind === 'text').length;
    const pip = selectedTimelineItems.filter((item) => isWorkbenchOverlayTimelineItem(item)).length;
    return { media, text, pip };
  }, [selectedTimelineItems, workbenchMainVideoTrack, workbenchVideoTrackById]);
  const selectedTimelineBatchSubtitleStyle = useMemo(() => {
    const textItems = selectedTimelineItems.filter((item) => item.kind === 'text');
    const textAssets = textItems
      .map((item) => timelineV2.assets.find((asset) => asset.id === item.assetId))
      .filter((asset): asset is VideoEditTimelineAsset => !!asset);
    const commonString = (values: string[], fallback: string) => {
      if (!values.length) {
        return { current: 'none', value: fallback, mixed: false };
      }
      const first = values[0] || fallback;
      const mixed = values.some((value) => value !== first);
      return { current: mixed ? 'mixed' : first, value: mixed ? fallback : first, mixed };
    };
    const positions = textAssets.map((asset) => {
      const value = String(asset.textPosition || 'bottom');
      return ['top', 'middle', 'bottom'].includes(value) ? value : 'bottom';
    });
    const colors = textAssets.map((asset) => {
      const value = String(asset.textColor || '');
      return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
    });
    const backgrounds = textAssets.map((asset) => (
      typeof asset.textBackground === 'string' ? asset.textBackground : 'rgba(0,0,0,0.45)'
    ));
    const fontSizes = textAssets.map((asset) => {
      const value = Number(asset.textFontSize);
      return Number.isFinite(value) ? Math.max(18, Math.min(96, Math.round(value))) : 42;
    });
    const position = commonString(positions, 'bottom');
    const color = commonString(colors, '#ffffff');
    const background = commonString(backgrounds, 'rgba(0,0,0,0.45)');
    const firstFontSize = fontSizes[0] || 42;
    const fontSizeMixed = fontSizes.some((value) => value !== firstFontSize);
    const fontSize = fontSizeMixed && fontSizes.length
      ? Math.round(fontSizes.reduce((sum, value) => sum + value, 0) / fontSizes.length)
      : firstFontSize;
    return {
      position: position.current,
      positionValue: position.value,
      positionMixed: position.mixed,
      fontSize,
      fontSizeMixed,
      color: color.current,
      colorValue: color.value,
      colorMixed: color.mixed,
      background: background.current,
      backgroundValue: background.value,
      backgroundMixed: background.mixed,
    };
  }, [selectedTimelineItems, timelineV2.assets]);
  const selectedTimelineItemLabel = selectedTimelineItemCount
    ? selectedTimelineItemCount > 1
      ? `多选 ${selectedTimelineItemCount} 项`
      : `${selectedTimelineItemCount} 项`
    : '未选择';
  const selectedTimelineItemDetail = useMemo(() => {
    const item = selectedTimelineItems[0];
    if (!item) return null;
    const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
    const asset = timelineV2.assets.find((entry) => entry.id === item.assetId);
    const linkedVideoItem = item.kind === 'video'
      ? item
      : (
        item.linkedItemId
          ? timelineV2.items.find((entry) => entry.id === item.linkedItemId && entry.kind === 'video')
          : timelineV2.items.find((entry) => entry.kind === 'video' && entry.linkedItemId === item.id)
      );
    const linkedClip = resolveClipForTimelineItem(linkedVideoItem || item);
    const duration = Math.max(0.1, item.sourceOut - item.sourceIn);
    const kindLabel = item.kind === 'video'
      ? '视频片段'
      : item.kind === 'audio'
        ? (linkedVideoItem ? '原声音频' : '独立音频')
        : '字幕文本';
    const audioFadeLimit = Math.min(duration, 10);
    const audioFadeIn = Number.isFinite(Number(item.audioFadeIn))
      ? Math.max(0, Math.min(audioFadeLimit, Number(item.audioFadeIn)))
      : 0;
    const audioFadeOut = Number.isFinite(Number(item.audioFadeOut))
      ? Math.max(0, Math.min(audioFadeLimit, Number(item.audioFadeOut)))
      : 0;
    const volumeCurve = VIDEO_EDIT_AUDIO_VOLUME_CURVE_OPTIONS.some((option) => option.value === item.volumeCurve)
      ? item.volumeCurve as VideoEditAudioVolumeCurve
      : 'flat';
    return {
      item,
      asset,
      kind: item.kind,
      kindLabel,
      title: asset?.text || item.label || linkedClip?.name || asset?.name || item.id,
      trackName: track?.name || '未命名轨道',
      duration,
      timelineStart: item.timelineStart,
      timelineEnd: item.timelineStart + duration,
      sourceIn: item.sourceIn,
      sourceOut: item.sourceOut,
      muted: !!item.muted || !!track?.muted,
      volume: Number.isFinite(Number(item.volume)) ? Math.max(0, Math.min(2, Number(item.volume))) : 1,
      audioFadeIn,
      audioFadeOut,
      volumeCurve,
      canMute: item.kind !== 'text',
      locked: !!track?.locked,
    };
  }, [resolveClipForTimelineItem, selectedTimelineItems, timelineV2.assets, timelineV2.items, timelineV2.tracks]);
  const selectedTimelineItemsLocked = selectedTimelineItems.some((item) => {
    const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
    return !!track?.locked;
  });
  const selectedClipTimelineItem = selectedClip
    ? timelineV2.items.find((item) => {
      if (item.kind !== 'video') return false;
      const assetIds = new Set<string>([selectedClip.id, `asset-${selectedClip.id}`]);
      if (selectedClip.assetId) assetIds.add(selectedClip.assetId);
      return item.id === selectedClip.id
        || item.id === `item-${selectedClip.id}-video`
        || assetIds.has(item.assetId);
    })
    : undefined;
  const selectedClipTimelineLocked = selectedClipTimelineItem
    ? !!timelineV2.tracks.find((track) => track.id === selectedClipTimelineItem.trackId)?.locked
    : false;
  const selectedTimelineDeleteLocked = selectedTimelineItemCount
    ? selectedTimelineItemsLocked
    : selectedClipTimelineLocked;
  const timelineSnapEnabled = timelineV2.snapEnabled !== false;
  const timelineContextMenuItem = timelineContextMenu ? timelineV2.items.find((item) => item.id === timelineContextMenu.itemId) : undefined;
  const timelineContextMenuTrack = timelineContextMenuItem ? timelineV2.tracks.find((track) => track.id === timelineContextMenuItem.trackId) : undefined;
  const timelineContextMenuItemLocked = timelineContextMenuItem
    ? !!timelineContextMenuTrack?.locked
    : false;
  const timelineContextKindLabel = timelineContextMenuItem?.kind === 'audio'
    ? '音频'
    : timelineContextMenuItem?.kind === 'text'
      ? '字幕'
      : '片段';

  useEffect(() => {
    if (!previewOverride) return;
    if (!previewOverrideMatchesTimeline) {
      setPreviewOverride(null);
      return;
    }
    if (basePreviewClipKey !== previewOverride.clipKey) return;
    const baseSourceTime = Math.max(0, Number(timelinePlayback.sourceTime) || 0);
    if (Math.abs(baseSourceTime - previewOverride.sourceTime) > 0.08) return;
    setPreviewOverride(null);
  }, [basePreviewClipKey, previewOverride, previewOverrideMatchesTimeline, timelinePlayback.sourceTime]);

  useEffect(() => () => {
    pollTokenRef.current += 1;
  }, []);

  useEffect(() => () => {
    workbenchPlayheadDragCleanupRef.current?.();
    workbenchPlayheadDragCleanupRef.current = null;
  }, []);

  useEffect(() => () => {
    timelineMoveDocumentCleanupRef.current?.();
    timelineMoveDocumentCleanupRef.current = null;
  }, []);

  useEffect(() => () => {
    timelineMarqueeDocumentCleanupRef.current?.();
    timelineMarqueeDocumentCleanupRef.current = null;
  }, []);

  useEffect(() => {
    if (!workbenchOpen) return undefined;
    const timer = window.setTimeout(() => workbenchShellRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [workbenchOpen]);

  useEffect(() => {
    if (!workbenchOpen) setWorkbenchShortcutsOpen(false);
  }, [workbenchOpen]);

  useEffect(() => {
    setWorkbenchClipWindowStart(0);
  }, [workbenchClipSearch, workbenchClipSourceFilter]);

  useEffect(() => {
    const maxStart = Math.max(0, workbenchFilteredClips.length - VIDEO_EDIT_WORKBENCH_WINDOW_SIZE);
    if (workbenchClipWindowStart > maxStart) {
      setWorkbenchClipWindowStart(maxStart);
    }
  }, [workbenchClipWindowStart, workbenchFilteredClips.length]);

  useEffect(() => {
    const maxStart = Math.max(0, workbenchMainTimelineItems.length - VIDEO_EDIT_WORKBENCH_WINDOW_SIZE);
    if (workbenchTimelineWindowStart > maxStart) {
      setWorkbenchTimelineWindowStart(maxStart);
    }
  }, [workbenchMainTimelineItems.length, workbenchTimelineWindowStart]);

  useEffect(() => {
    if (!workbenchOpen || !selectedClip) return;
    const selectedIndex = workbenchFilteredClips.findIndex((clip) => clip.id === selectedClip.id);
    if (selectedIndex < 0) return;
    const insideWindow = selectedIndex >= workbenchClipWindowStart && selectedIndex < workbenchClipWindowEnd;
    if (insideWindow) return;
    const nextStart = Math.floor(selectedIndex / VIDEO_EDIT_WORKBENCH_WINDOW_SIZE) * VIDEO_EDIT_WORKBENCH_WINDOW_SIZE;
    setWorkbenchClipWindowStart(nextStart);
  }, [selectedClip?.id, workbenchClipWindowEnd, workbenchClipWindowStart, workbenchFilteredClips, workbenchOpen]);

  useEffect(() => {
    if (!workbenchOpen || !activeTimelineItemId) return;
    const selectedIndex = workbenchMainTimelineItems.findIndex((item) => item.id === activeTimelineItemId);
    if (selectedIndex < 0) return;
    const insideWindow = selectedIndex >= workbenchTimelineWindowStart && selectedIndex < workbenchTimelineWindowEnd;
    if (insideWindow) return;
    const nextStart = Math.floor(selectedIndex / VIDEO_EDIT_WORKBENCH_WINDOW_SIZE) * VIDEO_EDIT_WORKBENCH_WINDOW_SIZE;
    setWorkbenchTimelineWindowStart(nextStart);
  }, [activeTimelineItemId, workbenchMainTimelineItems, workbenchOpen, workbenchTimelineWindowEnd, workbenchTimelineWindowStart]);

  const moveWorkbenchWindow = (direction: -1 | 1) => {
    const maxStart = Math.max(0, workbenchFilteredClips.length - VIDEO_EDIT_WORKBENCH_WINDOW_SIZE);
    const nextStart = Math.max(
      0,
      Math.min(maxStart, workbenchClipWindowStart + direction * VIDEO_EDIT_WORKBENCH_WINDOW_SIZE),
    );
    setWorkbenchClipWindowStart(nextStart);
  };

  const moveWorkbenchTimelineWindow = (direction: -1 | 1) => {
    const maxStart = Math.max(0, workbenchMainTimelineItems.length - VIDEO_EDIT_WORKBENCH_WINDOW_SIZE);
    const nextStart = Math.max(
      0,
      Math.min(maxStart, workbenchTimelineWindowStart + direction * VIDEO_EDIT_WORKBENCH_WINDOW_SIZE),
    );
    setWorkbenchTimelineWindowStart(nextStart);
  };

  const focusWorkbenchZone = (zone: 'media-bin-left' | 'inspector-right') => {
    workbenchShellRef.current
      ?.querySelector<HTMLElement>(`[data-video-edit-workbench-zone="${zone}"]`)
      ?.focus();
  };

  const focusWorkbenchControl = (selector: string) => {
    const target = workbenchShellRef.current?.querySelector<HTMLElement>(selector);
    if (!target) {
      focusWorkbenchZone('inspector-right');
      return;
    }
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.focus();
  };

  const focusWorkbenchMediaBin = () => {
    setWorkbenchClipSourceFilter('all');
    focusWorkbenchZone('media-bin-left');
  };

  const runWorkbenchCreatorCommand = (key: string) => {
    if (key === 'timeline') workbenchTimelineViewportRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    if (key === 'subtitle') focusWorkbenchControl('[data-video-edit-toolbar-subtitle-input="true"]');
    if (key === 'audio') openAudioTrackFilePicker();
    if (key === 'overlay') focusWorkbenchMediaBin();
    if (key === 'cover') void handleSnapshotFrame('cover');
    if (key === 'transition') focusWorkbenchControl('[data-video-edit-workbench-transition-select="true"]');
    if (key === 'filter') focusWorkbenchControl('[data-video-edit-workbench-filter-select="true"]');
    if (key === 'export') focusWorkbenchZone('inspector-right');
  };

  const focusWorkbenchFeature = (key: string) => {
    runWorkbenchCreatorCommand(key);
  };

  const toggleWorkbenchShortcuts = () => {
    setWorkbenchShortcutsOpen((open) => !open);
    window.setTimeout(() => workbenchShellRef.current?.focus(), 0);
  };

  const stopNodePointer = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
  };

  const stopNodeMouse = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const openVideoFilePicker = (event?: MouseEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (busy) return;
    fileInputRef.current?.click();
  };

  const openAudioTrackFilePicker = (event?: MouseEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (busy) return;
    audioTrackInputRef.current?.click();
  };

  const openReplacementPicker = (clipId: string, event?: MouseEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (busy) return;
    replacementClipIdRef.current = clipId;
    replacementInputRef.current?.click();
  };

  const normalizePreviewSeekSecond = (video: HTMLVideoElement | null, seconds: number) => {
    if (!Number.isFinite(seconds)) return 0;
    const duration = video && Number.isFinite(video.duration) ? video.duration : seconds;
    return Math.max(0, Math.min(seconds, Math.max(0, duration)));
  };

  const applyPreviewSeek = (video: HTMLVideoElement | null, seconds: number) => {
    if (!video || !Number.isFinite(seconds)) return;
    const next = normalizePreviewSeekSecond(video, seconds);
    setPreviewTime(next);
    try {
      video.currentTime = next;
    } catch (_) {
      window.setTimeout(() => {
        try { video.currentTime = next; } catch (_) {}
      }, 0);
    }
  };

  const seekPreviewTo = (seconds: number, clipKey?: string) => {
    const video = previewVideoRef.current;
    const targetClipKey = clipKey || previewClipKey;
    const sameRenderedClip = targetClipKey === previewClipKey;
    const next = sameRenderedClip
      ? normalizePreviewSeekSecond(video, seconds)
      : Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    pendingPreviewSeekRef.current = { clipKey: targetClipKey, seconds: next };
    previewSeekGuardRef.current = { clipKey: targetClipKey, seconds: next, expiresAt: Date.now() + 1200 };
    if (sameRenderedClip) {
      applyPreviewSeek(video, next);
    } else {
      setPreviewTime(next);
    }
  };

  const flushPendingPreviewSeek = () => {
    const pending = pendingPreviewSeekRef.current;
    if (pending && pending.clipKey !== previewClipKey) return;
    const fallback = Math.max(0, Number(timelinePlayback.sourceTime) || Number(selectedClip?.trimStart) || 0);
    const next = pending ? pending.seconds : fallback;
    pendingPreviewSeekRef.current = null;
    applyPreviewSeek(previewVideoRef.current, next);
    if (pendingPreviewAutoplayRef.current) {
      pendingPreviewAutoplayRef.current = false;
      window.setTimeout(() => {
        void previewVideoRef.current?.play().catch(() => {});
        syncActivePreviewMedia('play');
      }, 0);
    }
  };

  useEffect(() => {
    const pending = pendingPreviewSeekRef.current;
    if (!pending || pending.clipKey !== previewClipKey) return undefined;
    const timer = window.setTimeout(flushPendingPreviewSeek, 0);
    return () => window.clearTimeout(timer);
  }, [previewClipKey, selectedClip?.url]);

  const commitTimelinePlayhead = (timelineTime: number, selectedItemId?: string, selectedItemIdsOverride?: string[]) => {
    rf.setNodes((nodes) => nodes.map((node) => {
      if (node.id !== id) return node;
      const liveData = (node.data || {}) as any;
      const liveClips = normalizeVideoEditClips(liveData.clips || clips);
      const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
      const duration = Math.max(0, videoEditTimelineDuration(liveTimeline));
      const playhead = Math.max(0, Math.min(duration, Number.isFinite(timelineTime) ? timelineTime : 0));
      const selectedItemIds = selectedItemIdsOverride || (selectedItemId ? [selectedItemId] : liveTimeline.selectedItemIds);
      const selectedClipId = resolveClipIdForTimelineItemId(selectedItemId, liveTimeline, liveClips);
      return {
        ...node,
        data: {
          ...liveData,
          timelineV2: { ...liveTimeline, playhead, selectedItemIds },
          ...(selectedClipId ? { selectedClipId } : {}),
        },
      };
    }));
  };

  const resolveWorkbenchTimelineSelectionMode = (event?: Pick<MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>): VideoEditTimelineControllerSelectMode => {
    if (!event) return 'replace';
    if (event.ctrlKey || event.metaKey) return 'toggle';
    if (event.shiftKey) return 'add';
    return 'replace';
  };

  const sortWorkbenchTimelineItemsForRangeSelection = () => {
    const trackOrderById = new Map(timelineV2.tracks.map((track) => [track.id, track.order]));
    return [...timelineV2.items].sort((a, b) => (
      (trackOrderById.get(a.trackId) ?? 999) - (trackOrderById.get(b.trackId) ?? 999)
      || a.timelineStart - b.timelineStart
      || a.id.localeCompare(b.id)
    ));
  };

  const buildWorkbenchTimelineRangeSelection = (itemId: string) => {
    const orderedItems = sortWorkbenchTimelineItemsForRangeSelection();
    const targetIndex = orderedItems.findIndex((item) => item.id === itemId);
    if (targetIndex < 0) return [itemId];
    const rangeAnchorIds = timelineV2.selectedItemIds.length ? timelineV2.selectedItemIds : activeTimelineItemId ? [activeTimelineItemId] : [];
    const anchorId = [...rangeAnchorIds].reverse().find((selectedItemId) => orderedItems.some((item) => item.id === selectedItemId));
    if (!anchorId) return [itemId];
    const anchorIndex = orderedItems.findIndex((item) => item.id === anchorId);
    if (anchorIndex < 0) return [itemId];
    const from = Math.min(anchorIndex, targetIndex);
    const to = Math.max(anchorIndex, targetIndex);
    return orderedItems.slice(from, to + 1).map((item) => item.id);
  };

  const buildWorkbenchTimelineSelection = (itemId: string, mode: VideoEditTimelineControllerSelectMode) => {
    if (!itemId) return timelineV2.selectedItemIds;
    if (mode === 'replace') return [itemId];
    if (mode === 'add') return buildWorkbenchTimelineRangeSelection(itemId);
    const selected = new Set(timelineV2.selectedItemIds);
    if (mode === 'toggle') {
      if (selected.has(itemId) && selected.size > 1) selected.delete(itemId);
      else selected.add(itemId);
      return [...selected];
    }
    return [itemId];
  };

  const shouldSuppressTimelineItemClick = (event: MouseEvent<HTMLElement>) => {
    if (timelineMoveClickSuppressUntilRef.current <= Date.now()) return false;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    return true;
  };

  const isWorkbenchTimelineMarqueeBlockedTarget = (target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return true;
    return Boolean(element.closest([
      'button',
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[data-video-edit-timeline-ruler="true"]',
      '[data-video-edit-transition-cut-chip="true"]',
      '[data-video-edit-timeline-item-move-source="pointer"]',
      '[data-video-edit-track-item-trim-handle]',
      '[data-video-edit-workbench-playhead-handle="true"]',
    ].join(',')));
  };

  const readWorkbenchTimelineMarqueeItemId = (element: HTMLElement) => (
    element.dataset.videoEditTimelineItemId
    || element.dataset.videoEditTimelineAudioItemId
    || element.dataset.videoEditTimelineTextItemId
    || ''
  );

  const resolveWorkbenchTimelineMarqueeItemIds = (rect: DOMRect, container: HTMLElement, timeline: VideoEditTimelineV2) => {
    const knownIds = new Set(timeline.items.map((item) => item.id));
    const ids = new Set<string>();
    container
      .querySelectorAll<HTMLElement>('[data-video-edit-timeline-item-move-source="pointer"]')
      .forEach((element) => {
        const itemId = readWorkbenchTimelineMarqueeItemId(element);
        if (!itemId || !knownIds.has(itemId)) return;
        const itemRect = element.getBoundingClientRect();
        const overlapX = Math.min(rect.right, itemRect.right) - Math.max(rect.left, itemRect.left);
        const overlapY = Math.min(rect.bottom, itemRect.bottom) - Math.max(rect.top, itemRect.top);
        if (overlapX > 0 && overlapY > 0) ids.add(itemId);
      });
    return [...ids];
  };

  const buildWorkbenchTimelineMarqueeRect = (drag: VideoEditTimelineMarqueeDrag) => {
    const left = Math.min(drag.startClientX, drag.currentClientX);
    const top = Math.min(drag.startClientY, drag.currentClientY);
    const width = Math.abs(drag.currentClientX - drag.startClientX);
    const height = Math.abs(drag.currentClientY - drag.startClientY);
    return new DOMRect(left, top, width, height);
  };

  const resolveWorkbenchTimelineMarqueeSelectionIds = (
    baseSelectedItemIds: string[],
    marqueeItemIds: string[],
    mode: VideoEditTimelineControllerSelectMode,
  ) => {
    const selected = new Set(baseSelectedItemIds);
    if (mode === 'add') {
      marqueeItemIds.forEach((itemId) => selected.add(itemId));
      return [...selected];
    }
    if (mode === 'toggle') {
      marqueeItemIds.forEach((itemId) => {
        if (selected.has(itemId)) selected.delete(itemId);
        else selected.add(itemId);
      });
      return [...selected];
    }
    if (mode === 'remove') {
      marqueeItemIds.forEach((itemId) => selected.delete(itemId));
      return [...selected];
    }
    if (mode === 'clear') return [];
    return marqueeItemIds;
  };

  const clearWorkbenchTimelineMarqueeSelection = () => {
    timelineMarqueeDocumentCleanupRef.current?.();
    timelineMarqueeDocumentCleanupRef.current = null;
    timelineMarqueeDragRef.current = null;
    setTimelineMarqueeSelection(null);
  };

  const applyWorkbenchTimelineMarqueeClientPoint = (clientX: number, clientY: number) => {
    const drag = timelineMarqueeDragRef.current;
    if (!drag) return;
    drag.currentClientX = clientX;
    drag.currentClientY = clientY;
    const distance = Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY);
    if (distance < 6 && !drag.moved) return;
    drag.moved = true;
    const rect = buildWorkbenchTimelineMarqueeRect(drag);
    const liveData = (rf.getNode(id)?.data as any) || {};
    const liveClips = normalizeVideoEditClips(liveData.clips || clips);
    const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
    const itemIds = resolveWorkbenchTimelineMarqueeItemIds(rect, drag.container, liveTimeline);
    setTimelineMarqueeSelection({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      itemIds,
    });
  };

  const finishWorkbenchTimelineMarqueeSelection = (
    event?: PointerEvent<HTMLElement> | globalThis.PointerEvent,
  ) => {
    const drag = timelineMarqueeDragRef.current;
    if (!drag) return;
    if (drag.moved) {
      event?.preventDefault();
      event?.stopPropagation();
      if (event && 'stopImmediatePropagation' in event) {
        event.stopImmediatePropagation();
      }
      const rect = buildWorkbenchTimelineMarqueeRect(drag);
      const liveData = (rf.getNode(id)?.data as any) || {};
      const liveClips = normalizeVideoEditClips(liveData.clips || clips);
      const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
      const selectedItemIds = resolveWorkbenchTimelineMarqueeItemIds(rect, drag.container, liveTimeline);
      const nextSelectedItemIds = resolveWorkbenchTimelineMarqueeSelectionIds(
        drag.baseSelectedItemIds,
        selectedItemIds,
        drag.mode,
      ).filter((itemId) => liveTimeline.items.some((item) => item.id === itemId));
      rf.setNodes((nodes) => nodes.map((node) => {
        if (node.id !== id) return node;
        return {
          ...node,
          data: {
            ...(node.data || {}),
            timelineV2: {
              ...liveTimeline,
              selectedItemIds: nextSelectedItemIds,
            },
          },
        };
      }));
    }
    if (Number.isFinite(drag.pointerId)) {
      try {
        drag.target.releasePointerCapture(drag.pointerId as number);
      } catch {
        // Document listeners handle pointer release in embedded browser shells.
      }
    }
    clearWorkbenchTimelineMarqueeSelection();
  };

  const handleWorkbenchTimelineMarqueeWindowPointerMove = (event: globalThis.PointerEvent) => {
    if (!timelineMarqueeDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyWorkbenchTimelineMarqueeClientPoint(event.clientX, event.clientY);
  };

  const handleWorkbenchTimelineMarqueeWindowPointerUp = (event: globalThis.PointerEvent) => {
    if (!timelineMarqueeDragRef.current) return;
    finishWorkbenchTimelineMarqueeSelection(event);
  };

  const attachWorkbenchTimelineMarqueeDocumentListeners = () => {
    timelineMarqueeDocumentCleanupRef.current?.();
    document.addEventListener('pointermove', handleWorkbenchTimelineMarqueeWindowPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', handleWorkbenchTimelineMarqueeWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('pointercancel', handleWorkbenchTimelineMarqueeWindowPointerUp, { capture: true, passive: false });
    timelineMarqueeDocumentCleanupRef.current = () => {
      document.removeEventListener('pointermove', handleWorkbenchTimelineMarqueeWindowPointerMove, true);
      document.removeEventListener('pointerup', handleWorkbenchTimelineMarqueeWindowPointerUp, true);
      document.removeEventListener('pointercancel', handleWorkbenchTimelineMarqueeWindowPointerUp, true);
    };
  };

  const beginWorkbenchTimelineMarqueeSelection = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (running || busy) return;
    if (timelineMoveDragRef.current || timelineItemTrimDragRef.current || timelineTrimDragRef.current) return;
    if (isWorkbenchTimelineMarqueeBlockedTarget(event.target)) return;
    const target = event.currentTarget as HTMLElement;
    const container = target.closest('[data-video-edit-workbench-timeline-panel="true"]') as HTMLElement | null;
    if (!container) return;
    stopInteractivePointer(event);
    setTimelineContextMenu(null);
    timelineMarqueeDragRef.current = {
      target,
      container,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      moved: false,
      mode: resolveWorkbenchTimelineSelectionMode(event),
      baseSelectedItemIds: timelineV2.selectedItemIds,
      pointerId: event.pointerId,
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Document listeners keep marquee selection alive if pointer capture is unavailable.
    }
    attachWorkbenchTimelineMarqueeDocumentListeners();
  };

  const shouldMoveWorkbenchTimelineSelection = (timeline: VideoEditTimelineV2, itemId: string) => {
    const selected = new Set(timeline.selectedItemIds);
    return selected.size > 1 && selected.has(itemId);
  };

  const resolveWorkbenchTimelineLinkedMoveGroupIds = (timeline: VideoEditTimelineV2, itemId: string) => {
    const item = timeline.items.find((entry) => entry.id === itemId);
    if (!item) return [];
    const ids = new Set<string>([item.id]);
    if (item.linkedItemId) ids.add(item.linkedItemId);
    timeline.items.forEach((entry) => {
      if (entry.linkedItemId === item.id) ids.add(entry.id);
      if (item.linkedItemId && entry.id === item.linkedItemId) ids.add(entry.id);
    });
    return [...ids].filter((id) => timeline.items.some((entry) => entry.id === id));
  };

  const resolveWorkbenchTimelineBatchMoveItemIds = (timeline: VideoEditTimelineV2, targetItemId: string, selectedItemIds: string[]) => {
    const knownIds = new Set(timeline.items.map((item) => item.id));
    const selectedIds = selectedItemIds.filter((itemId) => knownIds.has(itemId));
    const candidates = shouldMoveWorkbenchTimelineSelection(timeline, targetItemId)
      ? [targetItemId, ...selectedIds.filter((itemId) => itemId !== targetItemId)]
      : [targetItemId];
    const consumedGroupIds = new Set<string>();
    const moveItemIds: string[] = [];
    candidates.forEach((itemId) => {
      if (!knownIds.has(itemId) || consumedGroupIds.has(itemId)) return;
      const groupIds = resolveWorkbenchTimelineLinkedMoveGroupIds(timeline, itemId);
      if (groupIds.some((groupId) => consumedGroupIds.has(groupId))) return;
      groupIds.forEach((groupId) => consumedGroupIds.add(groupId));
      moveItemIds.push(itemId);
    });
    return moveItemIds.length ? moveItemIds : [targetItemId];
  };

  const buildWorkbenchTimelineMoveExcludedIds = (timeline: VideoEditTimelineV2, itemIds: string[]) => {
    const excludedIds = new Set<string>();
    itemIds.forEach((itemId) => {
      resolveWorkbenchTimelineLinkedMoveGroupIds(timeline, itemId).forEach((groupId) => excludedIds.add(groupId));
    });
    return [...excludedIds];
  };

  const resolveWorkbenchTimelineMoveSelectedItemIds = (timeline: VideoEditTimelineV2, itemId: string, mode: VideoEditTimelineControllerSelectMode) => {
    const knownIds = new Set(timeline.items.map((entry) => entry.id));
    const liveSelectedItemIds = timeline.selectedItemIds.filter((selectedItemId) => knownIds.has(selectedItemId));
    if (liveSelectedItemIds.length > 1 && liveSelectedItemIds.includes(itemId)) return liveSelectedItemIds;
    const nextSelectedItemIds = mode === 'replace' ? [itemId] : buildWorkbenchTimelineSelection(itemId, mode);
    return nextSelectedItemIds.filter((selectedItemId) => knownIds.has(selectedItemId));
  };

  const moveWorkbenchTimelineSelectedItems = (
    timeline: VideoEditTimelineV2,
    targetItemId: string,
    targetTimelineStart: number,
    moveItemIds: string[],
    options: { snapThreshold: number },
  ) => {
    const beforeTarget = timeline.items.find((item) => item.id === targetItemId);
    if (!beforeTarget) return timeline;
    const nextTimeline = moveVideoEditTimelineItem(
      timeline,
      targetItemId,
      { timelineStart: targetTimelineStart },
      options,
    );
    const movedTarget = nextTimeline.items.find((item) => item.id === targetItemId);
    const deltaSeconds = Number(((movedTarget?.timelineStart ?? targetTimelineStart) - beforeTarget.timelineStart).toFixed(3));
    return moveItemIds.slice(1).reduce((nextTimeline, itemId) => {
      const item = timeline.items.find((entry) => entry.id === itemId);
      if (!item) return nextTimeline;
      return moveVideoEditTimelineItem(nextTimeline, itemId, { timelineStart: Math.max(0, item.timelineStart + deltaSeconds) }, { snapThreshold: 0 });
    }, nextTimeline);
  };

  const selectTimelineVideoItem = (item: VideoEditTimelineItem, mode: VideoEditTimelineControllerSelectMode = 'replace') => {
    if (item.kind !== 'video') return;
    const selectedItemIds = buildWorkbenchTimelineSelection(item.id, mode);
    const playback = resolveVideoEditTimelinePlayback(
      {
        ...timelineV2,
        playhead: item.timelineStart,
        selectedItemIds,
      },
      item.id,
    );
    const nextPreviewClip = buildVideoEditTimelinePreviewClip(playback, clips);
    if (nextPreviewClip) {
      setPreviewOverride({
        clip: nextPreviewClip,
        clipKey: makePreviewClipKey(nextPreviewClip),
        sourceTime: playback.sourceTime,
        timelineItemId: item.id,
      });
    }
    lastPreviewPlayheadCommitRef.current = playback.timelineTime;
    commitTimelinePlayhead(playback.timelineTime, item.id, selectedItemIds);
    seekPreviewTo(playback.sourceTime, makePreviewClipKey(nextPreviewClip));
  };

  const findTimelineVideoItemForClip = (clip: VideoEditClip) => {
    return timelineV2.items.find((item) => {
      if (item.kind !== 'video') return false;
      const linkedClip = resolveClipForTimelineItem(item);
      return linkedClip?.id === clip.id
        || item.id === clip.id
        || item.id === `item-${clip.id}-video`
        || (clip.assetId ? item.assetId === clip.assetId : false)
        || item.assetId === `asset-${clip.id}`;
    });
  };

  const buildNodeTimelinePresentationClip = (
    clip: VideoEditClip,
    timelineItem?: VideoEditTimelineItem,
  ): VideoEditClip => {
    if (!timelineItem) return clip;
    const asset = timelineV2.assets.find((entry) => entry.id === timelineItem.assetId) as VideoEditTimelineAsset | undefined;
    const sourceDuration = Math.max(
      0.1,
      Number(timelineItem.sourceOut) || 0,
      Number(asset?.duration) || 0,
      Number(clip.duration) || 0,
      Number(clip.trimEnd) || 0,
    );
    return {
      ...clip,
      timelineItemId: timelineItem.id,
      assetId: clip.assetId || timelineItem.assetId,
      directUrl: clip.directUrl || asset?.directUrl,
      duration: clip.duration || asset?.duration || sourceDuration,
      width: clip.width || asset?.width,
      height: clip.height || asset?.height,
      size: clip.size || asset?.size,
      mime: clip.mime || asset?.mime,
      thumbnailUrl: clip.thumbnailUrl || asset?.thumbnailUrl,
      filmstripUrls: clip.filmstripUrls?.length ? clip.filmstripUrls : asset?.filmstripUrls || [],
      filmstripTimes: clip.filmstripTimes?.length ? clip.filmstripTimes : asset?.filmstripTimes || [],
      waveformPeaks: clip.waveformPeaks?.length ? clip.waveformPeaks : asset?.waveformPeaks || [],
      hasAudio: typeof clip.hasAudio === 'boolean' ? clip.hasAudio : asset?.hasAudio,
      trimStart: Math.max(0, Number(timelineItem.sourceIn) || 0),
      trimEnd: Math.max(Number(timelineItem.sourceOut) || sourceDuration, 0.1),
    };
  };

  const selectNodeTimelineClip = (clip: VideoEditClip) => {
    const timelineItem = findTimelineVideoItemForClip(clip);
    if (timelineItem) {
      selectTimelineVideoItem(timelineItem);
      return;
    }
    update({ selectedClipId: clip.id });
  };

  const selectTimelineItemForWorkbench = (item: VideoEditTimelineItem, mode: VideoEditTimelineControllerSelectMode = 'replace') => {
    if (item.kind === 'video') {
      selectTimelineVideoItem(item, mode);
      return;
    }
    const selectedItemIds = buildWorkbenchTimelineSelection(item.id, mode);
    const playhead = Math.max(0, Number.isFinite(item.timelineStart) ? item.timelineStart : timelineV2.playhead);
    update({
      timelineV2: {
        ...timelineV2,
        playhead,
        selectedItemIds,
      },
    });
    lastPreviewPlayheadCommitRef.current = playhead;
  };

  const revealWorkbenchSelectedQuickPanel = () => {
    window.setTimeout(() => {
      const target = workbenchShellRef.current?.querySelector<HTMLElement>('[data-video-edit-selected-quick-panel="true"]');
      if (!target) {
        focusWorkbenchZone('inspector-right');
        return;
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      target.focus();
    }, 0);
  };

  const selectFirstWorkbenchTimelineItem = (
    predicate: (item: VideoEditTimelineItem) => boolean,
    fallback: () => void,
  ) => {
    const item = timelineV2.items
      .slice()
      .sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id))
      .find(predicate);
    if (!item) {
      fallback();
      return false;
    }
    selectTimelineItemForWorkbench(item);
    revealWorkbenchSelectedQuickPanel();
    return true;
  };

  const focusWorkbenchSubtitleStyle = () => selectFirstWorkbenchTimelineItem(
    (item) => item.kind === 'text',
    () => focusWorkbenchControl('[data-video-edit-toolbar-subtitle-input="true"]'),
  );

  const focusWorkbenchAudioControls = () => selectFirstWorkbenchTimelineItem(
    (item) => item.kind === 'audio'
      || (item.kind === 'video'
        && clips.find((clip) => clip.timelineItemId === item.id || clip.assetId === item.assetId)?.hasAudio !== false),
    () => openAudioTrackFilePicker(),
  );

  const focusWorkbenchPipControls = () => selectFirstWorkbenchTimelineItem(
    (item) => isWorkbenchOverlayTimelineItem(item),
    () => focusWorkbenchMediaBin(),
  );

  const handleWorkbenchFeatureAuditClick = (key: string) => {
    if (key === 'subtitle-style') {
      focusWorkbenchSubtitleStyle();
      return;
    }
    if (key === 'audio-flow') {
      focusWorkbenchAudioControls();
      return;
    }
    if (key === 'pip-flow') {
      focusWorkbenchPipControls();
      return;
    }
    if (key === 'export-flow') {
      focusWorkbenchZone('inspector-right');
    }
  };

  const findWorkbenchTimelineItemAt = (timelineTime: number) => {
    const itemEnd = (item: VideoEditTimelineItem) => item.timelineStart + timelineItemDuration(item);
    const duration = Math.max(0, timelineV2Duration || videoEditTimelineDuration(timelineV2));
    const soloVideoTrackIds = new Set(timelineV2.tracks
      .filter((track) => track.kind === 'video' && !track.hidden && track.solo)
      .map((track) => track.id));
    const videoItems = timelineV2.items
      .filter((item) => {
        if (item.kind !== 'video') return false;
        const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
        if (!track || track.hidden) return false;
        return soloVideoTrackIds.size === 0 || soloVideoTrackIds.has(track.id);
      })
      .slice()
      .sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id));
    return videoItems.find((item) => {
      const end = itemEnd(item);
      return timelineTime >= item.timelineStart && (timelineTime < end || (timelineTime === duration && timelineTime === end));
    })
      || videoItems.find((item) => timelineTime < item.timelineStart)
      || videoItems[videoItems.length - 1];
  };

  const findNextWorkbenchTimelineVideoItemAfter = (timelineTime: number, currentItemId?: string) => {
    const soloVideoTrackIds = new Set(timelineV2.tracks
      .filter((track) => track.kind === 'video' && !track.hidden && track.solo)
      .map((track) => track.id));
    return timelineV2.items
      .filter((item) => {
        if (item.kind !== 'video') return false;
        if (currentItemId && item.id === currentItemId) return false;
        const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
        if (!track || track.hidden) return false;
        if (soloVideoTrackIds.size > 0 && !soloVideoTrackIds.has(track.id)) return false;
        return item.timelineStart >= timelineTime - 0.02;
      })
      .sort((a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id))[0];
  };

  const workbenchTimelineTimeFromClientX = (clientX: number, element?: HTMLElement | null) => {
    const viewport = element || workbenchTimelineViewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    if (!viewport || !rect) return timelineV2.playhead;
    const isTimelineViewport = [
      workbenchTimelineViewportRef.current,
      workbenchOverlayTimelineViewportRef.current,
      workbenchAudioTimelineViewportRef.current,
      workbenchTextTimelineViewportRef.current,
    ].includes(viewport as HTMLDivElement);
    const width = Math.max(1, isTimelineViewport ? (viewport.scrollWidth || rect.width) : rect.width);
    const scrollLeft = isTimelineViewport ? viewport.scrollLeft : 0;
    const localX = Math.max(0, Math.min(width, clientX - rect.left + scrollLeft));
    const pixelsPerSecond = Math.max(1, width / workbenchTimelineDuration);
    return Math.max(0, Math.min(workbenchTimelineDuration, videoEditTimelineXToTime(localX, {
      pixelsPerSecond,
      zoom: 1,
      scrollLeft: 0,
    })));
  };

  const syncWorkbenchTimelineScroll = (source?: HTMLDivElement | null) => {
    const scrollLeft = source?.scrollLeft ?? workbenchTimelineViewportRef.current?.scrollLeft ?? 0;
    [
      workbenchTimelineViewportRef.current,
      workbenchOverlayTimelineViewportRef.current,
      workbenchAudioTimelineViewportRef.current,
      workbenchTextTimelineViewportRef.current,
    ].forEach((viewport) => {
      if (!viewport || viewport === source) return;
      if (Math.abs(viewport.scrollLeft - scrollLeft) < 1) return;
      viewport.scrollLeft = scrollLeft;
    });
  };

  const scrollWorkbenchTimelineToTime = (timelineTime: number) => {
    const viewport = workbenchTimelineViewportRef.current;
    if (!viewport) return;
    const targetX = videoEditTimelineTimeToX(timelineTime, {
      pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
      zoom: timelineZoom,
      scrollLeft: 0,
    });
    const visibleStart = viewport.scrollLeft;
    const visibleEnd = visibleStart + viewport.clientWidth;
    const padding = Math.min(220, Math.max(80, viewport.clientWidth * 0.18));
    if (targetX >= visibleStart + padding && targetX <= visibleEnd - padding) {
      syncWorkbenchTimelineScroll(viewport);
      return;
    }
    viewport.scrollLeft = Math.max(0, targetX - viewport.clientWidth / 2);
    syncWorkbenchTimelineScroll(viewport);
  };

  const seekWorkbenchTimelineTo = (timelineTime: number) => {
    const duration = Math.max(0, timelineV2Duration || videoEditTimelineDuration(timelineV2));
    const nextTime = Math.max(0, Math.min(duration || workbenchTimelineDuration, Number.isFinite(timelineTime) ? timelineTime : 0));
    const nextItem = findWorkbenchTimelineItemAt(nextTime);
    const playback = resolveVideoEditTimelinePlayback(
      {
        ...timelineV2,
        playhead: nextTime,
        selectedItemIds: nextItem?.id ? [nextItem.id] : timelineV2.selectedItemIds,
      },
      nextItem?.id,
    );
    const nextPreviewClip = buildVideoEditTimelinePreviewClip(playback, clips);
    if (nextPreviewClip) {
      setPreviewOverride({
        clip: nextPreviewClip,
        clipKey: makePreviewClipKey(nextPreviewClip),
        sourceTime: playback.sourceTime,
        timelineItemId: playback.item?.id,
      });
    }
    lastPreviewPlayheadCommitRef.current = nextTime;
    commitTimelinePlayhead(nextTime, playback.item?.id);
    scrollWorkbenchTimelineToTime(nextTime);
    seekPreviewTo(playback.sourceTime, makePreviewClipKey(nextPreviewClip));
  };

  const handleWorkbenchTimelineSeek = (event: PointerEvent<HTMLElement>) => {
    stopNodePointer(event);
    event.preventDefault();
    seekWorkbenchTimelineTo(workbenchTimelineTimeFromClientX(event.clientX, event.currentTarget as HTMLElement));
  };

  const clearWorkbenchPlayheadDrag = () => {
    workbenchPlayheadDragCleanupRef.current?.();
    workbenchPlayheadDragCleanupRef.current = null;
  };

  const beginWorkbenchPlayheadDrag = (event: PointerEvent<HTMLElement>) => {
    stopNodePointer(event);
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const dragSurface = target.closest('[data-video-edit-timeline-ruler="true"]') as HTMLElement | null;
    const coordinateElement = dragSurface || workbenchTimelineViewportRef.current;
    clearWorkbenchPlayheadDrag();
    try {
      target.setPointerCapture(event.pointerId);
    } catch (_) {}
    seekWorkbenchTimelineTo(workbenchTimelineTimeFromClientX(event.clientX, coordinateElement));

    const handleMove = (nativeEvent: globalThis.PointerEvent) => {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      seekWorkbenchTimelineTo(workbenchTimelineTimeFromClientX(nativeEvent.clientX, coordinateElement));
    };
    const handleEnd = (nativeEvent: globalThis.PointerEvent) => {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      clearWorkbenchPlayheadDrag();
      try {
        target.releasePointerCapture(event.pointerId);
      } catch (_) {}
    };
    workbenchPlayheadDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleMove, true);
      window.removeEventListener('pointerup', handleEnd, true);
      window.removeEventListener('pointercancel', handleEnd, true);
    };
    window.addEventListener('pointermove', handleMove, true);
    window.addEventListener('pointerup', handleEnd, true);
    window.addEventListener('pointercancel', handleEnd, true);
  };

  const beginWorkbenchPlayheadMouseDrag = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const dragSurface = target.closest('[data-video-edit-timeline-ruler="true"]') as HTMLElement | null;
    const coordinateElement = dragSurface || workbenchTimelineViewportRef.current;
    clearWorkbenchPlayheadDrag();
    seekWorkbenchTimelineTo(workbenchTimelineTimeFromClientX(event.clientX, coordinateElement));

    const handleMove = (nativeEvent: globalThis.MouseEvent) => {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      seekWorkbenchTimelineTo(workbenchTimelineTimeFromClientX(nativeEvent.clientX, coordinateElement));
    };
    const handleEnd = (nativeEvent: globalThis.MouseEvent) => {
      nativeEvent.preventDefault();
      nativeEvent.stopPropagation();
      clearWorkbenchPlayheadDrag();
    };
    workbenchPlayheadDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove, true);
      window.removeEventListener('mouseup', handleEnd, true);
      window.removeEventListener('mouseleave', handleEnd, true);
    };
    window.addEventListener('mousemove', handleMove, true);
    window.addEventListener('mouseup', handleEnd, true);
    window.addEventListener('mouseleave', handleEnd, true);
  };

  const playSelectedClipPreview = () => {
    const video = previewVideoRef.current;
    if (!video || !selectedClip) return;
    const start = Math.max(0, Number(selectedClip.trimStart) || 0);
    const end = Number(selectedClip.trimEnd || selectedClip.duration || 0);
    if (video.currentTime < start || (end && video.currentTime >= end)) {
      seekPreviewTo(start);
    }
    void video.play().catch(() => {});
    window.setTimeout(() => syncActivePreviewMedia('play'), 0);
  };

  const handlePreviewTimeUpdate = () => {
    const video = previewVideoRef.current;
    if (!video || !selectedClip) return;
    const seekGuard = previewSeekGuardRef.current;
    if (seekGuard) {
      const guardMatches = seekGuard.clipKey === previewClipKey;
      const expired = Date.now() > seekGuard.expiresAt;
      if (!expired && guardMatches && Math.abs(video.currentTime - seekGuard.seconds) > 0.25) {
        applyPreviewSeek(video, seekGuard.seconds);
        return;
      }
      if (expired || guardMatches) {
        previewSeekGuardRef.current = null;
      }
    }
    setPreviewTime(video.currentTime);
    if (workbenchOpen && timelinePlayback.item) {
      const nextPlayhead = videoEditTimelineTimeFromPlaybackSourceTime(timelinePlayback, video.currentTime);
      if (Math.abs(nextPlayhead - lastPreviewPlayheadCommitRef.current) >= 0.18) {
        lastPreviewPlayheadCommitRef.current = nextPlayhead;
        const preserveNonVideoSelection = timelineV2.selectedItemIds.some((itemId) => {
          const item = timelineV2.items.find((entry) => entry.id === itemId);
          return item && item.kind !== 'video';
        });
        commitTimelinePlayhead(nextPlayhead, preserveNonVideoSelection ? undefined : timelinePlayback.item.id);
      }
    }
    const end = Number(selectedClip.trimEnd || selectedClip.duration || 0);
    if (end > 0 && video.currentTime >= end) {
      if (workbenchOpen && timelinePlayback.item && !video.paused) {
        const currentEnd = timelinePlayback.item.timelineStart + timelineItemDuration(timelinePlayback.item);
        const nextItem = findNextWorkbenchTimelineVideoItemAfter(currentEnd, timelinePlayback.item.id);
        if (nextItem) {
          pendingPreviewAutoplayRef.current = true;
          seekWorkbenchTimelineTo(nextItem.timelineStart);
          return;
        }
      }
      video.pause();
      video.currentTime = Math.max(0, end);
      setPreviewTime(end);
      syncActivePreviewMedia('pause');
    }
  };

  useEffect(() => {
    if (!selectedClip?.url) return;
    const start = Math.max(0, Number(timelinePlayback.sourceTime) || Number(selectedClip.trimStart) || 0);
    window.setTimeout(() => seekPreviewTo(start), 0);
  }, [selectedClip?.id, selectedClip?.url, timelinePlayback.sourceTime]);

  const commitClips = (next: VideoEditClip[], extra: Record<string, any> = {}) => {
    const selectedClipId = typeof extra.selectedClipId === 'string'
      ? extra.selectedClipId
      : next.some((clip) => clip.id === d.selectedClipId) ? d.selectedClipId : next[0]?.id || '';
    const nextTimelineV2 = Object.prototype.hasOwnProperty.call(extra, 'timelineV2')
      ? extra.timelineV2
      : syncVideoEditTimelineWithClips(d.timelineV2, next);
    update({
      clips: next,
      timelineV2: nextTimelineV2,
      selectedClipId,
      ...extra,
    });
  };

  const patchClipVideoElementMetadata = (clipId: string, video: HTMLVideoElement) => {
    if (!clipId) return;
    const duration = finiteOptionalNumber(video.duration);
    const width = finiteOptionalNumber(video.videoWidth);
    const height = finiteOptionalNumber(video.videoHeight);
    if (!duration && !width && !height) return;
    const liveClips = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    const current = liveClips.length ? liveClips : clips;
    const target = current.find((clip) => clip.id === clipId);
    if (!target) return;
    const patch: Partial<VideoEditClip> = {};
    if (duration && (!target.duration || Math.abs(target.duration - duration) > 0.05)) {
      patch.duration = duration;
      if (!target.trimEnd || target.trimEnd <= target.trimStart + 0.1) {
        patch.trimEnd = duration;
      }
    }
    if (width && !target.width) patch.width = width;
    if (height && !target.height) patch.height = height;
    if (!Object.keys(patch).length) return;
    commitClips(current.map((clip) => (
      clip.id === clipId
        ? { ...clip, ...patch, status: clip.status === 'probing' ? 'ready' : clip.status, error: clip.status === 'probing' ? '' : clip.error }
        : clip
    )), { selectedClipId: clipId, status: 'ready', error: '' });
  };

  const handlePreviewLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    flushPendingPreviewSeek();
    if (selectedClip?.id) {
      patchClipVideoElementMetadata(selectedClip.id, event.currentTarget);
    }
  };

  const patchSettings = (patch: Partial<VideoEditSettings>) => {
    update({ settings: { ...settings, ...patch } });
  };

  const appendClips = async (incoming: VideoEditClip[]) => {
    const prepared = incoming.map((clip) => (
      !clip.duration ? { ...clip, status: 'probing' as const, error: '' } : clip
    ));
    const liveClips = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    const merged = appendVideoEditClips(liveClips.length ? liveClips : clips, prepared);
    commitClips(merged, { status: merged.length ? 'ready' : 'idle', error: '' });
    const unprobed = prepared.filter((clip) => !clip.duration);
    for (const clip of unprobed) {
      void probeAndPatchClip(clip.id, clip.url, merged);
    }
  };

  const clipsForProbePatch = (clipId: string, fallback: VideoEditClip[]) => {
    const live = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    if (live.some((clip) => clip.id === clipId)) return live;
    return normalizeVideoEditClips(fallback).some((clip) => clip.id === clipId)
      ? normalizeVideoEditClips(fallback)
      : [];
  };

  const probeAndPatchClip = async (clipId: string, url: string, fallback: VideoEditClip[]) => {
    try {
      const result = await probeVideo(url);
      const current = clipsForProbePatch(clipId, fallback);
      if (!current.length) return;
      commitClips(current.map((clip) => clip.id === clipId ? {
        ...clip,
        duration: result.duration || clip.duration,
        width: result.width || clip.width,
        height: result.height || clip.height,
        size: result.size || clip.size,
        mime: result.mime || clip.mime,
        hasAudio: typeof result.hasAudio === 'boolean' ? result.hasAudio : clip.hasAudio,
        thumbnailUrl: result.thumbnailUrl || clip.thumbnailUrl,
        trimEnd: clip.trimEnd || result.duration || clip.trimEnd,
        status: 'ready',
        error: '',
      } : clip));
    } catch (error: any) {
      const current = clipsForProbePatch(clipId, fallback);
      if (!current.length) return;
      commitClips(current.map((clip) => clip.id === clipId ? {
        ...clip,
        status: 'error',
        error: error?.message || '读取视频信息失败',
      } : clip));
    }
  };

  const collectConnectedUpstreamVideos = (): VideoImportCandidate[] => {
    const out: VideoImportCandidate[] = [];
    const seen = new Set<string>();
    const push = (item: Partial<VideoImportCandidate>) => {
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      out.push({
        kind: 'video',
        url,
        directUrl: item.directUrl,
        name: item.name || fileNameFromUrl(url),
        size: item.size,
        mime: item.mime,
        duration: item.duration,
        width: item.width,
        height: item.height,
        thumbnailUrl: item.thumbnailUrl,
        filmstripUrls: item.filmstripUrls,
        filmstripTimes: item.filmstripTimes,
        waveformPeaks: item.waveformPeaks,
        hasAudio: item.hasAudio,
        sourceNodeId: item.sourceNodeId,
        sourceLabel: item.sourceLabel || '上游视频',
        sourceCanvasId: item.sourceCanvasId,
        sourceNodeLabel: item.sourceNodeLabel,
        sourceCanvasName: item.sourceCanvasName,
      });
    };

    upstream.videos.forEach((item) => {
      const sourceNode = item.sourceNodeId ? rf.getNode(item.sourceNodeId) : null;
      push({
        kind: 'video',
        url: item.url,
        name: item.label || fileNameFromUrl(item.url),
        sourceNodeId: item.sourceNodeId,
        sourceLabel: '上游视频',
        sourceNodeLabel: sourceNode ? nodeLabelFromData(sourceNode.data, `节点 ${sourceNode.id}`) : undefined,
        ...videoImportMetadataFromNodeData(sourceNode?.data, item.url),
      });
    });

    const nodesById = new Map(rf.getNodes().map((node) => [node.id, node]));
    const connectedEdges = rf.getEdges().filter((edge) => edge.target === id);
    connectedEdges.forEach((edge) => {
      const sourceNode = nodesById.get(edge.source);
      const nodeData = sourceNode?.data;
      getMediaItemsFromData(nodeData, 'video').forEach((item, itemIndex) => {
        push({
          ...item,
          kind: 'video',
          ...videoImportMetadataFromNodeData(nodeData, item.url, itemIndex),
          sourceNodeId: edge.source,
          sourceLabel: '上游视频',
          sourceNodeLabel: sourceNode ? nodeLabelFromData(sourceNode.data, `节点 ${sourceNode.id}`) : undefined,
        });
      });
    });

    return out;
  };

  const importUpstream = async () => {
    const incoming = collectConnectedUpstreamVideos().map((item) =>
      createVideoEditClipFromMediaItem(
        { kind: 'video', url: item.url, name: item.name || fileNameFromUrl(item.url), size: item.size, mime: item.mime },
        {
          directUrl: item.directUrl,
          duration: item.duration,
          width: item.width,
          height: item.height,
          thumbnailUrl: item.thumbnailUrl,
          filmstripUrls: item.filmstripUrls,
          filmstripTimes: item.filmstripTimes,
          waveformPeaks: item.waveformPeaks,
          hasAudio: item.hasAudio,
          sourceNodeId: item.sourceNodeId,
          sourceLabel: item.sourceLabel || '上游视频',
          sourceCanvasId: item.sourceCanvasId,
          sourceNodeLabel: item.sourceNodeLabel,
          sourceCanvasName: item.sourceCanvasName,
          sourceCreatedAt: new Date().toISOString(),
        },
      ),
    );
    if (incoming.length === 0) {
      setLocalError('没有检测到上游视频素材');
      return;
    }
    setLocalError('');
    await appendClips(incoming);
  };

  const handleEmptyPreviewActivate = (event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (busy) return;
    const hasUpstreamVideo = upstream.videos.length > 0 || collectConnectedUpstreamVideos().length > 0;
    if (hasUpstreamVideo) {
      void importUpstream();
      return;
    }
    fileInputRef.current?.click();
  };

  const uploadFiles = async (files: File[]) => {
    const videos = files.filter((file) => file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name));
    if (videos.length === 0) {
      setLocalError('请选择视频文件');
      return;
    }
    setBusy('upload');
    setLocalError('');
    try {
      const incoming: VideoEditClip[] = [];
      for (const file of videos) {
        const url = await uploadFileBlob(file, file.name);
        incoming.push(createVideoEditClipFromMediaItem(
          { kind: 'video', url, name: file.name, size: file.size, mime: file.type },
          { sourceLabel: '本地上传', sourceNodeLabel: '本地文件', sourceCreatedAt: new Date().toISOString() },
        ));
      }
      await appendClips(incoming);
    } catch (error: any) {
      setLocalError(error?.message || '上传视频失败');
    } finally {
      setBusy('');
    }
  };

  const replaceClipAsset = async (file: File) => {
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name)) {
      setLocalError('请选择视频文件');
      return;
    }
    const clipId = replacementClipIdRef.current || selectedClip?.id || '';
    const liveClips = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    const current = liveClips.length ? liveClips : clips;
    const target = current.find((clip) => clip.id === clipId) || selectedClip;
    if (!target) {
      setLocalError('请先选择要替换的片段');
      return;
    }
    setBusy('replace');
    setLocalError('');
    try {
      const url = await uploadFileBlob(file, file.name);
      const nextClip = replaceVideoEditClipAsset(
        target,
        { kind: 'video', url, name: file.name, size: file.size, mime: file.type },
        {
          sourceLabel: '替换素材',
          sourceNodeLabel: '本地文件',
          sourceCreatedAt: new Date().toISOString(),
        },
      );
      const nextClips = current.map((clip) => clip.id === target.id ? nextClip : clip);
      commitClips(nextClips, { selectedClipId: nextClip.id, status: 'ready', error: '' });
      void probeAndPatchClip(nextClip.id, nextClip.url, nextClips);
    } catch (error: any) {
      setLocalError(error?.message || '替换素材失败');
    } finally {
      setBusy('');
      replacementClipIdRef.current = '';
    }
  };

  const removeClip = (clipId: string) => {
    commitClips(clips.filter((clip) => clip.id !== clipId));
  };

  const patchClip = (clipId: string, patch: Partial<VideoEditClip>, extra: Record<string, any> = {}) => {
    const liveClips = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    const current = liveClips.some((clip) => clip.id === clipId) ? liveClips : clips;
    commitClips(current.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip), extra);
  };

  const toggleClipMuted = (clipId: string) => {
    const target = clips.find((clip) => clip.id === clipId);
    if (!target) return;
    rememberWorkbenchChange();
    patchClip(clipId, { muted: !target.muted });
  };

  const toggleAllClipMuted = () => {
    if (!clips.length) return;
    rememberWorkbenchChange();
    commitClips(clips.map((clip) => ({ ...clip, muted: !allTrackAudioMuted })));
  };

  const isAudioTrackFile = (file: File) => {
    const name = file.name.toLowerCase();
    return file.type.startsWith('audio/')
      || /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(name);
  };

  const addAudioFileToTimeline = async (
    file: File,
    baseTimeline: VideoEditTimelineV2,
    liveClips: VideoEditClip[],
    timelineStart: number,
  ): Promise<{ timeline: VideoEditTimelineV2; duration: number }> => {
    const url = await uploadFileBlob(file, file.name);
    let duration = 0;
    let mime = file.type;
    let size = file.size;
    try {
      const result = await probeVideo(url);
      duration = Number(result.duration) || 0;
      mime = result.mime || mime;
      size = result.size || size;
    } catch {
      // Audio probing is best-effort. The file is still usable by ffmpeg during export.
    }
    const trackId = 'track-audio-independent';
    const trackExists = baseTimeline.tracks.some((track) => track.id === trackId);
    const maxOrder = baseTimeline.tracks.reduce((value, track) => Math.max(value, Number(track.order) || 0), 0);
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const assetId = `asset-audio-${stamp}`;
    const itemId = `item-audio-${stamp}`;
    const sourceOut = Math.max(0.25, duration || videoEditTimelineDuration(baseTimeline) || 5);
    const nextAsset: VideoEditTimelineAsset = {
      id: assetId,
      kind: 'audio',
      url,
      directUrl: url,
      name: file.name,
      duration: sourceOut,
      size,
      mime,
      sourceLabel: '本地音频',
    };
    const nextTrack: VideoEditTimelineTrack = { id: trackId, kind: 'audio', name: '独立音频轨', order: maxOrder + 1 };
    const nextItem: VideoEditTimelineItem = {
      id: itemId,
      assetId,
      trackId,
      kind: 'audio',
      timelineStart: Math.max(0, timelineStart),
      sourceIn: 0,
      sourceOut,
      muted: false,
      volume: 1,
      label: file.name,
    };
    const nextTimeline = normalizeVideoEditTimeline({
      ...baseTimeline,
      tracks: trackExists ? baseTimeline.tracks : [...baseTimeline.tracks, nextTrack],
      assets: [...baseTimeline.assets, nextAsset],
      items: [...baseTimeline.items, nextItem],
      selectedItemIds: [itemId],
      playhead: Math.max(0, timelineStart),
    }, liveClips);
    return { timeline: nextTimeline, duration: sourceOut };
  };

  const handleAudioTrackUpload = async (files: File[]) => {
    const audioFiles = files.filter(isAudioTrackFile);
    if (!audioFiles.length) {
      setLocalError('请选择 MP3、WAV、M4A、AAC、OGG、FLAC 或 WebM 音频文件。');
      return;
    }
    rememberWorkbenchChange();
    setBusy('upload');
    setLocalError('');
    try {
      const liveData = ((rf.getNode(id)?.data || {}) as any);
      const liveClips = normalizeVideoEditClips(liveData.clips || clips);
      let nextTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
      let cursor = Math.max(0, Number.isFinite(nextTimeline.playhead) ? Number(nextTimeline.playhead) : 0);
      for (const file of audioFiles) {
        const result = await addAudioFileToTimeline(file, nextTimeline, liveClips, cursor);
        nextTimeline = result.timeline;
        cursor += result.duration;
      }
      update({ timelineV2: nextTimeline, status: 'ready', error: '' });
    } catch (error: any) {
      setLocalError(error?.message || '导入音频轨失败');
    } finally {
      setBusy('');
    }
  };

  const addSubtitleToTimeline = () => {
    const text = subtitleDraft.trim();
    if (!text) {
      setLocalError('先输入字幕内容，再添加到字幕轨。');
      window.setTimeout(() => {
        (subtitleTrackInputRef.current || subtitleToolbarInputRef.current)?.focus();
      }, 0);
      return;
    }
    const liveData = (rf.getNode(id)?.data || {}) as any;
    const liveClips = normalizeVideoEditClips(liveData.clips || clips);
    const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
    const trackId = 'track-text-subtitle';
    const trackExists = liveTimeline.tracks.some((track) => track.id === trackId);
    const maxOrder = liveTimeline.tracks.reduce((value, track) => Math.max(value, Number(track.order) || 0), 0);
    const stamp = Date.now().toString(36);
    const assetId = `asset-subtitle-${stamp}`;
    const itemId = `item-subtitle-${stamp}`;
    const timelineStart = Math.max(0, Number.isFinite(liveTimeline.playhead) ? Number(liveTimeline.playhead) : 0);
    const sourceOut = Math.min(Math.max(2, videoEditTimelineDuration(liveTimeline) || 3), 5);
    const nextTimeline = normalizeVideoEditTimeline({
      ...liveTimeline,
      tracks: trackExists
        ? liveTimeline.tracks
        : [...liveTimeline.tracks, { id: trackId, kind: 'text', name: '字幕轨', order: maxOrder + 1 }],
      assets: [
        ...liveTimeline.assets,
        {
          id: assetId,
          kind: 'text',
          name: text.length > 16 ? `${text.slice(0, 16)}...` : text,
          url: '',
          text,
          textPosition: 'bottom',
          textColor: '#ffffff',
          textFontSize: 42,
          textBackground: 'rgba(0,0,0,0.45)',
        },
      ],
      items: [
        ...liveTimeline.items,
        {
          id: itemId,
          assetId,
          trackId,
          kind: 'text',
          timelineStart,
          sourceIn: 0,
          sourceOut,
          label: text,
        },
      ],
      selectedItemIds: [itemId],
    }, liveClips);
    rememberWorkbenchChange();
    setSubtitleDraft('');
    setLocalError('');
    update({ timelineV2: nextTimeline, status: 'ready', error: '' });
  };

  const loadClipTimelinePreview = async (clipId = selectedClip?.id || '') => {
    const liveClips = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    const current = liveClips.length ? liveClips : clips;
    const target = current.find((clip) => clip.id === clipId);
    if (!target) {
      setLocalError('请先选择一个视频片段');
      return;
    }
    if (target.timelinePreviewStatus === 'loading') return;
    setLocalError('');
    commitClips(current.map((clip) => clip.id === target.id ? {
      ...clip,
      timelinePreviewStatus: 'loading',
      timelinePreviewError: '',
    } : clip), { selectedClipId: target.id });
    try {
      const result = await loadVideoTimelinePreviewAsync(target, { frameCount: 8, peakCount: 72 });
      const latest = clipsForProbePatch(target.id, current);
      if (!latest.length) return;
      commitClips(latest.map((clip) => clip.id === target.id ? {
        ...clip,
        duration: result.duration || clip.duration,
        width: result.width || clip.width,
        height: result.height || clip.height,
        hasAudio: typeof result.hasAudio === 'boolean' ? result.hasAudio : clip.hasAudio,
        filmstripUrls: result.filmstripUrls || [],
        filmstripTimes: result.filmstripTimes || [],
        waveformPeaks: result.waveformPeaks || [],
        timelinePreviewStatus: 'ready',
        timelinePreviewError: '',
      } : clip), { selectedClipId: target.id });
    } catch (error: any) {
      const latest = clipsForProbePatch(target.id, current);
      if (!latest.length) return;
      const message = error?.message || '生成帧条 / 音频波形失败';
      commitClips(latest.map((clip) => clip.id === target.id ? {
        ...clip,
        timelinePreviewStatus: 'error',
        timelinePreviewError: message,
      } : clip), { selectedClipId: target.id });
      setLocalError(message);
    }
  };

  const cloneWorkbenchClips = (items: VideoEditClip[]) => items.map((clip) => ({
    ...clip,
    storyboardTags: clip.storyboardTags ? [...clip.storyboardTags] : [],
  }));

  const getWorkbenchClipsSnapshot = () => {
    const live = normalizeVideoEditClips((rf.getNode(id)?.data as any)?.clips);
    return cloneWorkbenchClips(live.length ? live : clips);
  };

  const getWorkbenchSnapshot = (): VideoEditWorkbenchSnapshot => {
    const liveData = (rf.getNode(id)?.data || {}) as any;
    const liveClips = normalizeVideoEditClips(liveData.clips || clips);
    const snapshotClips = cloneWorkbenchClips(liveClips.length ? liveClips : clips);
    return {
      clips: snapshotClips,
      timelineV2: normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, snapshotClips),
    };
  };

  const rememberWorkbenchChange = () => {
    const snapshot = getWorkbenchSnapshot();
    if (!snapshot.clips.length && !snapshot.timelineV2.items.length) return;
    workbenchUndoStackRef.current = [...workbenchUndoStackRef.current.slice(-24), snapshot];
    workbenchRedoStackRef.current = [];
  };

  const restoreWorkbenchSnapshot = (snapshot: VideoEditWorkbenchSnapshot) => {
    const next = cloneWorkbenchClips(snapshot.clips);
    const selectedClipId = next.some((clip) => clip.id === d.selectedClipId) ? d.selectedClipId : next[0]?.id || '';
    update({
      clips: next,
      timelineV2: normalizeVideoEditTimeline(snapshot.timelineV2, next),
      selectedClipId,
      status: next.length ? 'ready' : 'idle',
      error: '',
    });
  };

  const undoWorkbenchChange = () => {
    const previous = workbenchUndoStackRef.current.pop();
    if (!previous) return;
    workbenchRedoStackRef.current = [...workbenchRedoStackRef.current.slice(-24), getWorkbenchSnapshot()];
    restoreWorkbenchSnapshot(previous);
  };

  const redoWorkbenchChange = () => {
    const next = workbenchRedoStackRef.current.pop();
    if (!next) return;
    workbenchUndoStackRef.current = [...workbenchUndoStackRef.current.slice(-24), getWorkbenchSnapshot()];
    restoreWorkbenchSnapshot(next);
  };

  const getVideoEditTimelineTrackByKind = (kind: VideoEditTimelineTrack['kind']) => {
    const preferredId = kind === 'video'
      ? 'track-video-main'
      : kind === 'audio'
        ? 'track-audio-main'
        : 'track-text-subtitle';
    return timelineV2.tracks.find((track) => track.id === preferredId)
      || timelineV2.tracks.find((track) => track.kind === kind)
      || {
        id: preferredId,
        kind,
        name: kind === 'video' ? '视频轨' : kind === 'audio' ? '音频轨' : '字幕轨',
        order: kind === 'video' ? 1 : kind === 'audio' ? 2 : 3,
      };
  };

  const getVideoEditTimelineTracksByKind = (kind: VideoEditTimelineTrack['kind']) => {
    const fallback = getVideoEditTimelineTrackByKind(kind);
    const tracks = timelineV2.tracks
      .filter((track) => track.kind === kind)
      .slice()
      .sort((left, right) => (left.order || 0) - (right.order || 0) || left.id.localeCompare(right.id));
    return tracks.some((track) => track.id === fallback.id) ? tracks : [fallback, ...tracks];
  };

  const getVideoEditOverlayTimelineTrack = (): VideoEditTimelineTrack => (
    timelineV2.tracks.find((track) => track.id === 'track-video-overlay' && track.kind === 'video')
    || timelineV2.tracks.find((track) => track.kind === 'video' && track.name.includes('叠加'))
    || {
      id: 'track-video-overlay',
      kind: 'video',
      name: '叠加轨',
      order: (getVideoEditTimelineTrackByKind('video').order || 1) + 1,
    }
  );

  const toggleVideoEditTimelineTrackFlag = (
    trackId: string,
    flag: 'locked' | 'hidden' | 'muted' | 'solo',
  ) => {
    const liveData = (rf.getNode(id)?.data || {}) as any;
    const liveClips = normalizeVideoEditClips(liveData.clips || clips);
    const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
    const fallbackKind = trackId.includes('audio') ? 'audio' : trackId.includes('text') ? 'text' : 'video';
    const existingTarget = liveTimeline.tracks.find((track) => track.id === trackId);
    const target = existingTarget || getVideoEditTimelineTrackByKind(fallbackKind);
    const toggleTrack = (track: VideoEditTimelineTrack) => {
      if (flag === 'solo' && track.kind === target.kind) {
        if (track.id === target.id) return { ...track, solo: !track.solo };
        return track.solo ? { ...track, solo: false } : track;
      }
      if (track.id !== target.id) return track;
      if (flag === 'locked') return { ...track, locked: !track.locked };
      if (flag === 'hidden') return { ...track, hidden: !track.hidden };
      if (flag === 'muted') return { ...track, muted: !track.muted };
      return track;
    };
    const nextTracks = existingTarget
      ? liveTimeline.tracks.map(toggleTrack)
      : [...liveTimeline.tracks.map((track) => (
        flag === 'solo' && track.kind === target.kind && track.solo ? { ...track, solo: false } : track
      )), toggleTrack(target)];
    rememberWorkbenchChange();
    update({
      timelineV2: normalizeVideoEditTimeline({ ...liveTimeline, tracks: nextTracks }, liveClips),
      status: 'ready',
      error: '',
    });
  };

  const expandVideoEditTimelineItemIds = (timeline: VideoEditTimelineV2, itemIds: string[]) => {
    const expanded = new Set(itemIds.filter(Boolean));
    let changed = true;
    while (changed) {
      changed = false;
      timeline.items.forEach((item) => {
        const linkedId = item.linkedItemId;
        if (expanded.has(item.id) && linkedId && !expanded.has(linkedId)) {
          expanded.add(linkedId);
          changed = true;
        }
        if (linkedId && expanded.has(linkedId) && !expanded.has(item.id)) {
          expanded.add(item.id);
          changed = true;
        }
      });
    }
    return expanded;
  };

  const getVideoEditTrackClearItemIds = (sourceTimeline: VideoEditTimelineV2, track: VideoEditTimelineTrack) => {
    let targetIds = sourceTimeline.items
      .filter((item) => item.trackId === track.id)
      .map((item) => item.id);
    if (track.id === 'track-video-main') {
      targetIds = sourceTimeline.items
        .filter((item) => isMainTimelineVideoItem(sourceTimeline, item))
        .map((item) => item.id);
    }
    if (track.id === 'track-video-overlay') {
      targetIds = sourceTimeline.items
        .filter((item) => isOverlayTimelineVideoItem(sourceTimeline, item))
        .map((item) => item.id);
    }
    const validIds = targetIds.filter(Boolean);
    return track.kind === 'video'
      ? expandVideoEditTimelineItemIds(sourceTimeline, validIds)
      : new Set(validIds);
  };

  const isTimelineItemEditable = (
    timeline: VideoEditTimelineV2,
    itemOrId: VideoEditTimelineItem | string | undefined,
  ) => {
    const item = typeof itemOrId === 'string'
      ? timeline.items.find((entry) => entry.id === itemOrId)
      : itemOrId;
    if (!item) return false;
    const track = timeline.tracks.find((entry) => entry.id === item.trackId);
    return !track?.locked;
  };

  const isTimelineItemLocked = (item?: VideoEditTimelineItem) => (
    item ? !isTimelineItemEditable(timelineV2, item) : false
  );

  const timelineAudioItems = timelineV2.items.filter((item) => item.kind === 'audio');
  const editableTimelineAudioItems = timelineAudioItems.filter((item) => isTimelineItemEditable(timelineV2, item));
  const allTimelineAudioItemsMuted = editableTimelineAudioItems.length > 0
    && editableTimelineAudioItems.every((item) => item.muted);

  const getLiveTimelineGuardSnapshot = () => {
    const liveData = (rf.getNode(id)?.data as any) || {};
    const liveClips = normalizeVideoEditClips(liveData.clips || clips);
    return normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
  };

  const guardLockedTimelineItems = (
    timeline: VideoEditTimelineV2,
    itemIds: string[],
    actionLabel: string,
  ) => {
    const expandedIds = expandVideoEditTimelineItemIds(timeline, itemIds);
    const hasLockedItem = timeline.items.some((item) => expandedIds.has(item.id) && !isTimelineItemEditable(timeline, item));
    if (!hasLockedItem) return false;
    setLocalError(`锁定轨道内的条目不能${actionLabel}，先解锁对应轨道。`);
    return true;
  };

  const patchVideoEditTimeline = (
    mutate: (timeline: VideoEditTimelineV2, liveClips: VideoEditClip[]) => VideoEditTimelineV2,
    extra: Record<string, any> = {},
  ) => {
    rf.setNodes((nodes) => nodes.map((node) => {
      if (node.id !== id) return node;
      const liveData = (node.data || {}) as any;
      const liveClips = normalizeVideoEditClips(liveData.clips || clips);
      const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
      const nextTimeline = normalizeVideoEditTimeline(mutate(liveTimeline, liveClips), liveClips);
      return {
        ...node,
        data: {
          ...liveData,
          timelineV2: nextTimeline,
          status: liveClips.length ? 'ready' : 'idle',
          error: '',
          ...extra,
        },
      };
    }));
  };

  const removeTimelineItems = (itemIds: string[]) => {
    if (!itemIds.length) {
      setLocalError('先在时间线上选择要删除的片段、音频或字幕。');
      return;
    }
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), itemIds, '删除')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline, liveClips) => {
      const ids = expandVideoEditTimelineItemIds(timeline, itemIds);
      const nextItems = timeline.items.filter((item) => !ids.has(item.id));
      const nextTimeline = normalizeVideoEditTimeline({
        ...timeline,
        items: nextItems,
        selectedItemIds: [],
      }, liveClips);
      return {
        ...nextTimeline,
        playhead: Math.min(nextTimeline.playhead, videoEditTimelineDuration(nextTimeline)),
      };
    }, { selectedClipId: clips[0]?.id || '' });
    setLocalError('');
  };

  const clearVideoEditTimelineTrack = (track: VideoEditTimelineTrack) => {
    if (running || !!busy) return;
    const guardTimeline = getLiveTimelineGuardSnapshot();
    const liveTrack = guardTimeline.tracks.find((entry) => entry.id === track.id) || track;
    if (liveTrack.locked) {
      setLocalError('轨道已锁定，先解锁后再清空。');
      return;
    }
    const guardIds = Array.from(getVideoEditTrackClearItemIds(guardTimeline, liveTrack));
    if (!guardIds.length) {
      setLocalError(`${liveTrack.name || '轨道'}暂无可清空内容。`);
      return;
    }
    if (guardLockedTimelineItems(guardTimeline, guardIds, '清空轨道')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline, liveClips) => {
      const timelineTrack = timeline.tracks.find((entry) => entry.id === liveTrack.id) || liveTrack;
      const ids = getVideoEditTrackClearItemIds(timeline, timelineTrack);
      const nextTimeline = normalizeVideoEditTimeline({
        ...timeline,
        items: timeline.items.filter((item) => !ids.has(item.id)),
        selectedItemIds: timeline.selectedItemIds.filter((itemId) => !ids.has(itemId)),
      }, liveClips);
      return {
        ...nextTimeline,
        playhead: Math.min(nextTimeline.playhead, videoEditTimelineDuration(nextTimeline)),
      };
    });
    setLocalError('');
  };

  const removeSelectedTimelineItems = () => {
    const ids = selectedTimelineItems.map((item) => item.id);
    if (!ids.length && selectedClip?.id) {
      rememberWorkbenchChange();
      removeClip(selectedClip.id);
      return;
    }
    removeTimelineItems(ids);
  };

  const duplicateTimelineItems = (baseIds: string[]) => {
    if (!baseIds.length) {
      setLocalError('先在时间线上选择一个片段、音频或字幕，再复制。');
      return;
    }
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), baseIds, '复制')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => {
      const expandedIds = expandVideoEditTimelineItemIds(timeline, baseIds);
      const sourceItems = timeline.items.filter((item) => expandedIds.has(item.id));
      if (!sourceItems.length) {
        return timeline;
      }
      const minStart = Math.min(...sourceItems.map((item) => item.timelineStart));
      const maxEnd = Math.max(...sourceItems.map((item) => item.timelineStart + Math.max(0.1, item.sourceOut - item.sourceIn)));
      const offset = Math.max(0.4, maxEnd - minStart + 0.2);
      const stamp = Date.now().toString(36);
      const idMap = new Map(sourceItems.map((item, index) => [item.id, `${item.id}-copy-${stamp}-${index}`]));
      const copiedItems = sourceItems.map((item) => ({
        ...item,
        id: idMap.get(item.id) || `${item.id}-copy-${stamp}`,
        timelineStart: Number((item.timelineStart + offset).toFixed(3)),
        linkedItemId: item.linkedItemId ? idMap.get(item.linkedItemId) : undefined,
        label: item.label ? `${item.label} 副本` : item.label,
      }));
      return {
        ...timeline,
        items: [...timeline.items, ...copiedItems],
        selectedItemIds: copiedItems.map((item) => item.id),
        playhead: Number((minStart + offset).toFixed(3)),
      };
    });
    setLocalError('');
  };

  const duplicateSelectedTimelineItems = () => {
    duplicateTimelineItems(selectedTimelineItems.map((item) => item.id));
  };

  const toggleTimelineSnap = () => {
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => ({
      ...timeline,
      snapEnabled: timeline.snapEnabled === false,
    }));
  };

  const toggleTimelineItemMuted = (itemId: string) => {
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), [itemId], '静音/取消静音')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => ({
      ...timeline,
      items: timeline.items.map((item) => (
        item.id === itemId ? { ...item, muted: !item.muted } : item
      )),
      selectedItemIds: [itemId],
    }));
  };

  const toggleTimelineAudioLaneMuted = () => {
    const liveTimeline = getLiveTimelineGuardSnapshot();
    const audioItems = liveTimeline.items.filter((item) => item.kind === 'audio');
    if (!audioItems.length) {
      setLocalError('时间线上还没有可静音的音频。');
      return;
    }
    const editableIds = new Set(audioItems
      .filter((item) => isTimelineItemEditable(liveTimeline, item))
      .map((item) => item.id));
    if (!editableIds.size) {
      setLocalError('音频轨已锁定，先解锁对应轨道。');
      return;
    }
    const shouldMute = audioItems.some((item) => editableIds.has(item.id) && !item.muted);
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => {
      const nextEditableIds = new Set(timeline.items
        .filter((item) => item.kind === 'audio' && isTimelineItemEditable(timeline, item))
        .map((item) => item.id));
      return {
        ...timeline,
        items: timeline.items.map((item) => (
          nextEditableIds.has(item.id) ? { ...item, muted: shouldMute } : item
        )),
        selectedItemIds: Array.from(nextEditableIds),
      };
    });
    setLocalError('');
  };

  const isOverlayTimelineVideoItem = (timeline: VideoEditTimelineV2, item: VideoEditTimelineItem) => {
    if (item.kind !== 'video') return false;
    const track = timeline.tracks.find((entry) => entry.id === item.trackId);
    if (!track || track.kind !== 'video') return false;
    const trackName = String(track.name || '').toLowerCase();
    return track.id !== 'track-video-main'
      && (
        track.id.includes('overlay')
        || trackName.includes('叠加')
        || trackName.includes('覆盖')
        || trackName.includes('画中画')
        || trackName.includes('pip')
        || track.order > 0
      );
  };

  const isMainTimelineVideoItem = (timeline: VideoEditTimelineV2, item: VideoEditTimelineItem) => (
    item.kind === 'video' && !isOverlayTimelineVideoItem(timeline, item)
  );

  const applyVideoEditTimelineBatchAction = (
    action:
      | 'mute-main'
      | 'restore-main'
      | 'mute-independent-audio'
      | 'restore-independent-audio'
      | 'clear-independent-audio'
      | 'clear-subtitles'
      | 'clear-overlays',
  ) => {
    if (running || !!busy) return;
    const guardTimeline = getLiveTimelineGuardSnapshot();
    const mainVideoItemIds = new Set(
      guardTimeline.items
        .filter((item) => isMainTimelineVideoItem(guardTimeline, item))
        .map((item) => item.id),
    );
    const mainSourceAudioItemIds = guardTimeline.items
      .filter((item) => item.kind === 'audio' && !!item.linkedItemId && mainVideoItemIds.has(item.linkedItemId))
      .map((item) => item.id);
    const batchTargetIds = action === 'mute-main' || action === 'restore-main'
      ? [...mainVideoItemIds, ...mainSourceAudioItemIds]
      : action === 'mute-independent-audio' || action === 'restore-independent-audio' || action === 'clear-independent-audio'
        ? guardTimeline.items.filter((item) => item.kind === 'audio' && !item.linkedItemId).map((item) => item.id)
        : action === 'clear-subtitles'
          ? guardTimeline.items.filter((item) => item.kind === 'text').map((item) => item.id)
          : guardTimeline.items.filter((item) => isOverlayTimelineVideoItem(guardTimeline, item)).map((item) => item.id);
    if (batchTargetIds.length && guardLockedTimelineItems(guardTimeline, batchTargetIds, '批量处理')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline, liveClips) => {
      const mainVideoItemIds = new Set(
        timeline.items
          .filter((item) => isMainTimelineVideoItem(timeline, item))
          .map((item) => item.id),
      );
      const mainSourceAudioItemIds = new Set(
        timeline.items
          .filter((item) => item.kind === 'audio' && !!item.linkedItemId && mainVideoItemIds.has(item.linkedItemId))
          .map((item) => item.id),
      );
      let nextItems = timeline.items;

      if (action === 'mute-main' || action === 'restore-main') {
        const muted = action === 'mute-main';
        nextItems = timeline.items.map((item) => {
          if (mainVideoItemIds.has(item.id)) return { ...item, muted };
          if (mainSourceAudioItemIds.has(item.id)) return { ...item, muted, volume: muted ? 0 : 1 };
          return item;
        });
      }

      if (action === 'mute-independent-audio' || action === 'restore-independent-audio') {
        const muted = action === 'mute-independent-audio';
        nextItems = timeline.items.map((item) => (
          item.kind === 'audio' && !item.linkedItemId
            ? { ...item, muted, volume: muted ? 0 : 1 }
            : item
        ));
      }

      if (action === 'clear-independent-audio') {
        nextItems = timeline.items.filter((item) => !(item.kind === 'audio' && !item.linkedItemId));
      }

      if (action === 'clear-subtitles') {
        nextItems = timeline.items.filter((item) => item.kind !== 'text');
      }

      if (action === 'clear-overlays') {
        const overlayIds = expandVideoEditTimelineItemIds(
          timeline,
          timeline.items
            .filter((item) => isOverlayTimelineVideoItem(timeline, item))
            .map((item) => item.id),
        );
        nextItems = timeline.items.filter((item) => !overlayIds.has(item.id));
      }

      const nextItemIds = new Set(nextItems.map((item) => item.id));
      const nextTimeline = normalizeVideoEditTimeline({
        ...timeline,
        items: nextItems,
        selectedItemIds: timeline.selectedItemIds.filter((itemId) => nextItemIds.has(itemId)),
      }, liveClips);
      return {
        ...nextTimeline,
        playhead: Math.min(nextTimeline.playhead, videoEditTimelineDuration(nextTimeline)),
      };
    });
    setLocalError('');
  };

  const patchTimelineItemFields = (itemId: string, patch: Partial<VideoEditTimelineItem>) => {
    if (!itemId) return;
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), [itemId], '调整')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => ({
      ...timeline,
      items: timeline.items.map((item) => (
        item.id === itemId ? { ...item, ...patch } : item
      )),
      selectedItemIds: [itemId],
    }));
  };

  const patchTimelineItemVolume = (itemId: string, volume: number) => {
    const nextVolume = Math.max(0, Math.min(2, Number.isFinite(volume) ? volume : 1));
    patchTimelineItemFields(itemId, {
      volume: nextVolume,
      muted: nextVolume <= 0,
    });
  };

  const patchTimelineItemAudioEnvelope = (itemId: string, patch: Partial<VideoEditTimelineItem>) => {
    patchTimelineItemFields(itemId, patch);
  };

  const patchTimelineAssetFields = (
    itemId: string,
    assetId: string,
    patch: Partial<VideoEditTimelineAsset>,
    itemPatch: Partial<VideoEditTimelineItem> = {},
  ) => {
    if (!itemId || !assetId) return;
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), [itemId], '编辑')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => ({
      ...timeline,
      assets: timeline.assets.map((asset) => (
        asset.id === assetId ? { ...asset, ...patch } : asset
      )),
      items: timeline.items.map((item) => (
        item.id === itemId ? { ...item, ...itemPatch } : item
      )),
      selectedItemIds: [itemId],
    }));
  };

  const patchSelectedTimelineItemFields = (
    patch: Partial<VideoEditTimelineItem> | ((item: VideoEditTimelineItem) => Partial<VideoEditTimelineItem>),
    predicate: (timeline: VideoEditTimelineV2, item: VideoEditTimelineItem) => boolean,
    emptyMessage: string,
  ) => {
    const guardTimeline = getLiveTimelineGuardSnapshot();
    const selectedIds = new Set(guardTimeline.selectedItemIds);
    const targetIds = guardTimeline.items
      .filter((item) => selectedIds.has(item.id) && predicate(guardTimeline, item))
      .map((item) => item.id);
    if (!targetIds.length) {
      setLocalError(emptyMessage);
      return;
    }
    if (guardLockedTimelineItems(guardTimeline, targetIds, '批量属性')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => {
      const liveSelectedIds = new Set(timeline.selectedItemIds);
      const liveTargetIds = new Set(timeline.items
        .filter((item) => liveSelectedIds.has(item.id) && predicate(timeline, item))
        .map((item) => item.id));
      return {
        ...timeline,
        items: timeline.items.map((item) => {
          if (!liveTargetIds.has(item.id)) return item;
          const nextPatch = typeof patch === 'function' ? patch(item) : patch;
          return { ...item, ...nextPatch };
        }),
      };
    });
    setLocalError('');
  };

  const patchSelectedTimelineItemVolume = (volume: number) => {
    const nextVolume = Math.max(0, Math.min(2, Number.isFinite(volume) ? volume : 1));
    patchSelectedTimelineItemFields(
      { volume: nextVolume, muted: nextVolume <= 0 },
      (_timeline, item) => item.kind !== 'text',
      '多选中没有可调音量的音视频项。',
    );
  };

  const patchSelectedTimelineItemMuted = (muted: boolean) => {
    patchSelectedTimelineItemFields(
      (item) => {
        const currentVolume = Number.isFinite(Number(item.volume)) ? Number(item.volume) : 1;
        return {
          muted,
          volume: muted ? 0 : Math.max(currentVolume, 1),
        };
      },
      (_timeline, item) => item.kind !== 'text',
      '多选中没有可静音的音视频项。',
    );
  };

  const patchSelectedTimelineTextAssets = (
    patch: Partial<VideoEditTimelineAsset>,
    itemPatch: Partial<VideoEditTimelineItem> = {},
  ) => {
    const guardTimeline = getLiveTimelineGuardSnapshot();
    const selectedIds = new Set(guardTimeline.selectedItemIds);
    const targetIds = guardTimeline.items
      .filter((item) => selectedIds.has(item.id) && item.kind === 'text')
      .map((item) => item.id);
    if (!targetIds.length) {
      setLocalError('多选中没有字幕项可批量编辑。');
      return;
    }
    if (guardLockedTimelineItems(guardTimeline, targetIds, '批量属性')) return;
    rememberWorkbenchChange();
    patchVideoEditTimeline((timeline) => {
      const liveSelectedIds = new Set(timeline.selectedItemIds);
      const textItems = timeline.items.filter((item) => liveSelectedIds.has(item.id) && item.kind === 'text');
      const assetIds = new Set(textItems.map((item) => item.assetId));
      const textItemIds = new Set(textItems.map((item) => item.id));
      return {
        ...timeline,
        assets: timeline.assets.map((asset) => (
          assetIds.has(asset.id) ? { ...asset, ...patch } : asset
        )),
        items: timeline.items.map((item) => (
          textItemIds.has(item.id) ? { ...item, ...itemPatch } : item
        )),
      };
    });
    setLocalError('');
  };

  const patchSelectedTimelinePipFields = (patch: Partial<VideoEditTimelineItem>) => {
    patchSelectedTimelineItemFields(
      patch,
      (timeline, item) => isOverlayTimelineVideoItem(timeline, item),
      '多选中没有 PIP / 叠加视频项。',
    );
  };

  const patchPreviewPipDragPosition = (itemId: string, x: number, y: number) => {
    if (!itemId) return;
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), [itemId], '移动画中画')) return;
    patchVideoEditTimeline((timeline) => ({
      ...timeline,
      items: timeline.items.map((item) => (
        item.id === itemId ? { ...item, x, y } : item
      )),
      selectedItemIds: [itemId],
    }));
  };

  const applyPreviewPipDragClientPosition = (clientX: number, clientY: number) => {
    const drag = previewPipDragRef.current;
    if (!drag) return;
    const maxLeft = Math.max(1, drag.stageWidth - drag.overlayWidth);
    const maxTop = Math.max(1, drag.stageHeight - drag.overlayHeight);
    const left = Math.max(0, Math.min(maxLeft, clientX - drag.stageLeft - drag.offsetX));
    const top = Math.max(0, Math.min(maxTop, clientY - drag.stageTop - drag.offsetY));
    patchPreviewPipDragPosition(
      drag.itemId,
      Number(((left / maxLeft) * 100).toFixed(2)),
      Number(((top / maxTop) * 100).toFixed(2)),
    );
  };

  const finishPreviewPipDrag = (
    event?: PointerEvent<HTMLElement> | globalThis.PointerEvent | MouseEvent<HTMLElement> | globalThis.MouseEvent,
  ) => {
    const drag = previewPipDragRef.current;
    if (!drag) return;
    event?.preventDefault();
    event?.stopPropagation();
    if (event && 'stopImmediatePropagation' in event) {
      event.stopImmediatePropagation();
    }
    if (event && 'pointerId' in event) {
      try {
        drag.target.releasePointerCapture(event.pointerId);
      } catch {
        // Document listeners keep the drag alive when embedded browser shells release capture early.
      }
    }
    previewPipDragDocumentCleanupRef.current?.();
    previewPipDragDocumentCleanupRef.current = null;
    previewPipDragRef.current = null;
  };

  const handlePreviewPipDragWindowPointerMove = (event: globalThis.PointerEvent) => {
    if (!previewPipDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyPreviewPipDragClientPosition(event.clientX, event.clientY);
  };

  const handlePreviewPipDragWindowPointerUp = (event: globalThis.PointerEvent) => {
    if (!previewPipDragRef.current) return;
    finishPreviewPipDrag(event);
  };

  const handlePreviewPipDragWindowMouseMove = (event: globalThis.MouseEvent) => {
    if (!previewPipDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyPreviewPipDragClientPosition(event.clientX, event.clientY);
  };

  const handlePreviewPipDragWindowMouseUp = (event: globalThis.MouseEvent) => {
    if (!previewPipDragRef.current) return;
    finishPreviewPipDrag(event);
  };

  const attachPreviewPipDragDocumentListeners = () => {
    previewPipDragDocumentCleanupRef.current?.();
    document.addEventListener('pointermove', handlePreviewPipDragWindowPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', handlePreviewPipDragWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('pointercancel', handlePreviewPipDragWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('mousemove', handlePreviewPipDragWindowMouseMove, { capture: true, passive: false });
    document.addEventListener('mouseup', handlePreviewPipDragWindowMouseUp, { capture: true, passive: false });
    previewPipDragDocumentCleanupRef.current = () => {
      document.removeEventListener('pointermove', handlePreviewPipDragWindowPointerMove, true);
      document.removeEventListener('pointerup', handlePreviewPipDragWindowPointerUp, true);
      document.removeEventListener('pointercancel', handlePreviewPipDragWindowPointerUp, true);
      document.removeEventListener('mousemove', handlePreviewPipDragWindowMouseMove, true);
      document.removeEventListener('mouseup', handlePreviewPipDragWindowMouseUp, true);
    };
  };

  const startPreviewPipDrag = (
    clientX: number,
    clientY: number,
    target: HTMLElement,
    itemId: string,
    pointerId?: number,
  ) => {
    if (!itemId || running || busy || previewPipDragRef.current) return;
    if (guardLockedTimelineItems(getLiveTimelineGuardSnapshot(), [itemId], '拖动画中画')) return;
    const stage = target.closest('[data-video-edit-preview-stage="true"]') as HTMLElement | null;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const overlayRect = target.getBoundingClientRect();
    if (stageRect.width <= 1 || stageRect.height <= 1 || overlayRect.width <= 1 || overlayRect.height <= 1) return;
    rememberWorkbenchChange();
    previewPipDragRef.current = {
      itemId,
      target,
      offsetX: clientX - overlayRect.left,
      offsetY: clientY - overlayRect.top,
      overlayWidth: Math.min(overlayRect.width, stageRect.width),
      overlayHeight: Math.min(overlayRect.height, stageRect.height),
      stageLeft: stageRect.left,
      stageTop: stageRect.top,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
    };
    setTimelineContextMenu(null);
    if (Number.isFinite(pointerId)) {
      try {
        target.setPointerCapture(pointerId as number);
      } catch {
        // Document listeners keep dragging reliable inside Electron/WebView shells.
      }
    }
    attachPreviewPipDragDocumentListeners();
    applyPreviewPipDragClientPosition(clientX, clientY);
  };

  const beginPreviewPipDrag = (event: PointerEvent<HTMLElement>, itemId: string) => {
    if (event.button !== 0) return;
    stopInteractivePointer(event);
    startPreviewPipDrag(event.clientX, event.clientY, event.currentTarget, itemId, event.pointerId);
  };

  const beginPreviewPipMouseDrag = (event: MouseEvent<HTMLElement>, itemId: string) => {
    if (event.button !== 0) return;
    stopInteractiveMouse(event);
    startPreviewPipDrag(event.clientX, event.clientY, event.currentTarget, itemId);
  };

  const renderVideoEditTrackControls = (track?: VideoEditTimelineTrack) => {
    if (!track) return null;
    const locked = track.locked;
    const hidden = track.hidden;
    const solo = track.solo;
    const clearItemCount = getVideoEditTrackClearItemIds(timelineV2, track).size;
    return (
      <>
        <button
          type="button"
          data-video-edit-track-action="lock"
          className={`t8-mini-icon-button nodrag h-6 w-6 ${locked ? 'is-active' : ''}`}
          title={locked ? '解除锁定轨道' : '锁定轨道'}
          onClick={(event) => {
            event.stopPropagation();
            toggleVideoEditTimelineTrackFlag(track.id, 'locked');
          }}
          disabled={running || !!busy}
        >
          {locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button
          type="button"
          data-video-edit-track-action="hide"
          className={`t8-mini-icon-button nodrag h-6 w-6 ${hidden ? 'is-active' : ''}`}
          title={hidden ? '显示轨道' : '隐藏轨道'}
          onClick={(event) => {
            event.stopPropagation();
            toggleVideoEditTimelineTrackFlag(track.id, 'hidden');
          }}
          disabled={running || !!busy}
        >
          {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <button
          type="button"
          data-video-edit-track-action="solo"
          className={`t8-mini-icon-button nodrag h-6 w-6 ${solo ? 'is-active' : ''}`}
          title={solo ? '取消独奏轨道' : '仅预览/导出此类轨道'}
          onClick={(event) => {
            event.stopPropagation();
            toggleVideoEditTimelineTrackFlag(track.id, 'solo');
          }}
          disabled={running || !!busy}
        >
          <Sparkles size={12} />
        </button>
        <button
          type="button"
          data-video-edit-track-action="delete"
          className="t8-mini-icon-button nodrag h-6 w-6"
          title={clearItemCount ? `清空轨道 ${clearItemCount} 项` : '轨道暂无可清空内容'}
          aria-label="清空轨道"
          onClick={(event) => {
            event.stopPropagation();
            clearVideoEditTimelineTrack(track);
          }}
          disabled={running || !!busy || locked || clearItemCount === 0}
        >
          <Trash2 size={12} />
        </button>
      </>
    );
  };

  const buildWorkbenchTimelineMoveSnapPreview = (
    timeline: VideoEditTimelineV2,
    itemId: string,
    snap?: VideoEditTimelineSnapResult,
  ) => {
    const movedItem = timeline.items.find((item) => item.id === itemId);
    if (!movedItem) return null;
    const snapDetail = snap || {
      input: movedItem.timelineStart,
      time: movedItem.timelineStart,
      snapped: false,
      distance: 0,
      threshold: 0,
      kind: 'none' as const,
      label: '未吸附',
    };
    const virtualWidth = Math.max(1, videoEditTimelineTimeToX(Math.max(1, videoEditTimelineDuration(timeline)), {
      pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
      zoom: timelineZoom,
      scrollLeft: 0,
    }));
    const left = videoEditTimelineTimeToX(movedItem.timelineStart, {
      pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
      zoom: timelineZoom,
      scrollLeft: 0,
    });
    return {
      movedItem,
      snapDetail,
      leftPct: Math.max(0, Math.min(100, (left / virtualWidth) * 100)),
    };
  };

  const updateTimelineMovePreview = (timeline: VideoEditTimelineV2, itemId: string, snap?: VideoEditTimelineSnapResult) => {
    const preview = buildWorkbenchTimelineMoveSnapPreview(timeline, itemId, snap);
    if (!preview) {
      setTimelineMovePreview(null);
      return;
    }
    const { movedItem, snapDetail, leftPct } = preview;
    setTimelineMovePreview({
      itemId,
      leftPct,
      label: formatSeconds(movedItem.timelineStart),
      snapActive: snapDetail.snapped,
      snapKind: snapDetail.kind,
      snapDelta: snapDetail.distance,
      snapTargetLabel: snapDetail.label,
    });
  };

  const findClipForTimelineItem = (items: VideoEditClip[], item?: VideoEditTimelineItem) => {
    if (!item) return undefined;
    return items.find((clip) => (
      (clip.assetId && clip.assetId === item.assetId)
      || `asset-${clip.id}` === item.assetId
      || clip.id === item.id
    ));
  };

  const findLinkedVideoTimelineItem = (timeline: VideoEditTimelineV2, item?: VideoEditTimelineItem) => {
    if (!item) return undefined;
    if (item.kind === 'video') return item;
    if (item.linkedItemId) {
      const linked = timeline.items.find((entry) => entry.id === item.linkedItemId && entry.kind === 'video');
      if (linked) return linked;
    }
    return timeline.items.find((entry) => entry.kind === 'video' && entry.linkedItemId === item.id);
  };

  const sourceDurationForTimelineItem = (timeline: VideoEditTimelineV2, item: VideoEditTimelineItem) => {
    const asset = timeline.assets.find((entry) => entry.id === item.assetId);
    return Math.max(item.sourceOut, Number(asset?.duration) || 0, 0.1);
  };

  const applyTimelineItemTrimClientX = (clientX: number) => {
    const drag = timelineItemTrimDragRef.current;
    if (!drag) return;
    const liveData = (rf.getNode(id)?.data as any) || {};
    const live = normalizeVideoEditClips(liveData?.clips);
    const current = live.length ? live : clips;
    const liveTimeline = normalizeVideoEditTimeline(liveData?.timelineV2 as VideoEditTimelineV2 | undefined, current);
    const target = liveTimeline.items.find((item) => item.id === drag.itemId);
    if (!target) return;
    const track = liveTimeline.tracks.find((entry) => entry.id === target.trackId);
    if (track?.locked) return;
    const deltaSeconds = (clientX - drag.startClientX) / Math.max(1, VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND * timelineZoom);
    const maxSource = sourceDurationForTimelineItem(liveTimeline, target);
    let nextSourceTime = drag.edge === 'start'
      ? drag.startSourceIn + deltaSeconds
      : drag.startSourceOut + deltaSeconds;
    if (drag.edge === 'start') {
      nextSourceTime = Math.max(0, Math.min(target.sourceOut - 0.1, nextSourceTime));
    } else {
      nextSourceTime = Math.min(maxSource, Math.max(target.sourceIn + 0.1, nextSourceTime));
    }
    nextSourceTime = Number(nextSourceTime.toFixed(3));
    if (Math.abs(nextSourceTime - (drag.edge === 'start' ? target.sourceIn : target.sourceOut)) < 0.01 && !drag.moved) return;
    drag.moved = true;
    const nextTimelineBase = resizeVideoEditTimelineItem(liveTimeline, drag.itemId, drag.edge, nextSourceTime);
    const nextTarget = nextTimelineBase.items.find((item) => item.id === drag.itemId);
    const linkedVideoItem = findLinkedVideoTimelineItem(nextTimelineBase, nextTarget);
    const linkedClip = findClipForTimelineItem(current, linkedVideoItem);
    const nextClips = linkedVideoItem && linkedClip
      ? syncVideoEditClipsFromTimelineItem(current, nextTimelineBase, linkedVideoItem.id, linkedClip.id)
      : current;
    const playhead = nextTarget
      ? Math.max(nextTarget.timelineStart, Math.min(nextTarget.timelineStart + Math.max(0.1, nextTarget.sourceOut - nextTarget.sourceIn), nextTimelineBase.playhead))
      : nextTimelineBase.playhead;
    update({
      clips: nextClips,
      timelineV2: normalizeVideoEditTimeline({
        ...nextTimelineBase,
        selectedItemIds: [drag.itemId],
        playhead,
      }, nextClips),
      selectedClipId: linkedClip?.id || liveData.selectedClipId || selectedClip?.id || '',
      status: nextClips.length ? 'ready' : 'idle',
      error: '',
    });
    setLocalError('');
  };

  const finishTimelineItemTrimMove = (
    event?: PointerEvent<HTMLElement> | globalThis.PointerEvent | MouseEvent<HTMLElement> | globalThis.MouseEvent,
  ) => {
    const drag = timelineItemTrimDragRef.current;
    if (!drag) return;
    event?.preventDefault();
    event?.stopPropagation();
    if (event && 'stopImmediatePropagation' in event) {
      event.stopImmediatePropagation();
    }
    if (event && 'pointerId' in event) {
      try {
        drag.target.releasePointerCapture(event.pointerId);
      } catch {
        // Document listeners keep trimming alive even after pointer capture is released.
      }
    }
    timelineItemTrimDocumentCleanupRef.current?.();
    timelineItemTrimDocumentCleanupRef.current = null;
    timelineItemTrimDragRef.current = null;
  };

  const handleTimelineItemTrimWindowPointerMove = (event: globalThis.PointerEvent) => {
    if (!timelineItemTrimDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyTimelineItemTrimClientX(event.clientX);
  };

  const handleTimelineItemTrimWindowPointerUp = (event: globalThis.PointerEvent) => {
    if (!timelineItemTrimDragRef.current) return;
    finishTimelineItemTrimMove(event);
  };

  const handleTimelineItemTrimWindowMouseMove = (event: globalThis.MouseEvent) => {
    if (!timelineItemTrimDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyTimelineItemTrimClientX(event.clientX);
  };

  const handleTimelineItemTrimWindowMouseUp = (event: globalThis.MouseEvent) => {
    if (!timelineItemTrimDragRef.current) return;
    finishTimelineItemTrimMove(event);
  };

  const attachTimelineItemTrimDocumentListeners = () => {
    timelineItemTrimDocumentCleanupRef.current?.();
    document.addEventListener('pointermove', handleTimelineItemTrimWindowPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', handleTimelineItemTrimWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('pointercancel', handleTimelineItemTrimWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('mousemove', handleTimelineItemTrimWindowMouseMove, { capture: true, passive: false });
    document.addEventListener('mouseup', handleTimelineItemTrimWindowMouseUp, { capture: true, passive: false });
    timelineItemTrimDocumentCleanupRef.current = () => {
      document.removeEventListener('pointermove', handleTimelineItemTrimWindowPointerMove, true);
      document.removeEventListener('pointerup', handleTimelineItemTrimWindowPointerUp, true);
      document.removeEventListener('pointercancel', handleTimelineItemTrimWindowPointerUp, true);
      document.removeEventListener('mousemove', handleTimelineItemTrimWindowMouseMove, true);
      document.removeEventListener('mouseup', handleTimelineItemTrimWindowMouseUp, true);
    };
  };

  const startTimelineItemTrimMove = (
    clientX: number,
    target: HTMLElement,
    item: VideoEditTimelineItem,
    edge: 'start' | 'end',
    pointerId?: number,
  ) => {
    if (timelineItemTrimDragRef.current || timelineMoveDragRef.current) return;
    if (running || busy) return;
    const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
    if (track?.locked) {
      setLocalError('该轨道已锁定，先解锁后再裁剪片段。');
      return;
    }
    selectTimelineItemForWorkbench(item);
    rememberWorkbenchChange();
    timelineItemTrimDragRef.current = {
      itemId: item.id,
      edge,
      target,
      startClientX: clientX,
      startSourceIn: item.sourceIn,
      startSourceOut: item.sourceOut,
      moved: false,
    };
    setTimelineContextMenu(null);
    if (Number.isFinite(pointerId)) {
      try {
        target.setPointerCapture(pointerId as number);
      } catch {
        // Embedded browser shells may not keep capture; document listeners cover it.
      }
    }
    attachTimelineItemTrimDocumentListeners();
  };

  const beginTimelineItemTrimMove = (event: PointerEvent<HTMLElement>, item: VideoEditTimelineItem, edge: 'start' | 'end') => {
    if (event.button !== 0) return;
    stopInteractivePointer(event);
    startTimelineItemTrimMove(event.clientX, event.currentTarget, item, edge, event.pointerId);
  };

  const beginTimelineItemTrimMouseMove = (event: MouseEvent<HTMLElement>, item: VideoEditTimelineItem, edge: 'start' | 'end') => {
    if (event.button !== 0) return;
    stopInteractiveMouse(event);
    startTimelineItemTrimMove(event.clientX, event.currentTarget, item, edge);
  };

  const applyTimelineItemMoveClientX = (clientX: number) => {
    const drag = timelineMoveDragRef.current;
    if (!drag) return;
    const liveData = (rf.getNode(id)?.data as any) || {};
    const liveClips = normalizeVideoEditClips(liveData.clips || clips);
    const liveTimeline = normalizeVideoEditTimeline(liveData.timelineV2 as VideoEditTimelineV2 | undefined, liveClips);
    const target = liveTimeline.items.find((item) => item.id === drag.itemId);
    if (!target) return;
    const deltaSeconds = (clientX - drag.startClientX) / Math.max(1, VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND * timelineZoom);
    const nextStart = Number(Math.max(0, drag.startTimelineStart + deltaSeconds).toFixed(3));
    if (Math.abs(nextStart - target.timelineStart) < 0.01 && !drag.moved) return;
    if (!drag.changeRemembered) {
      rememberWorkbenchChange();
      drag.changeRemembered = true;
    }
    drag.moved = true;
    const selectedItemIds = resolveWorkbenchTimelineMoveSelectedItemIds(liveTimeline, drag.itemId, drag.selectionMode);
    const moveItemIds = resolveWorkbenchTimelineBatchMoveItemIds(liveTimeline, drag.itemId, selectedItemIds);
    const snapThreshold = timelineSnapEnabled ? 0.18 : 0;
    const snapDetail = snapThreshold > 0
      ? resolveVideoEditTimelineSnap(liveTimeline, nextStart, {
        threshold: snapThreshold,
        excludedItemIds: buildWorkbenchTimelineMoveExcludedIds(liveTimeline, moveItemIds),
      })
      : undefined;
    const nextTimeline = moveWorkbenchTimelineSelectedItems(
      liveTimeline,
      drag.itemId,
      snapDetail?.snapped ? snapDetail.time : nextStart,
      moveItemIds,
      { snapThreshold: 0 },
    );
    const movedItem = nextTimeline.items.find((item) => item.id === drag.itemId);
    const selectedClipId = resolveClipIdForTimelineItemId(drag.itemId, nextTimeline, liveClips);
    update({
      timelineV2: {
        ...nextTimeline,
        selectedItemIds,
        playhead: movedItem ? movedItem.timelineStart : nextTimeline.playhead,
      },
      ...(selectedClipId ? { selectedClipId } : {}),
      status: liveClips.length ? 'ready' : 'idle',
      error: '',
    });
    updateTimelineMovePreview(nextTimeline, drag.itemId, snapDetail);
  };

  const finishTimelineItemMove = (
    event?: PointerEvent<HTMLElement> | globalThis.PointerEvent | MouseEvent<HTMLElement> | globalThis.MouseEvent,
  ) => {
    const drag = timelineMoveDragRef.current;
    if (!drag) return;
    if (drag.moved) {
      timelineMoveClickSuppressUntilRef.current = Date.now() + 350;
      event?.preventDefault();
      event?.stopPropagation();
      if (event && 'stopImmediatePropagation' in event) {
        event.stopImmediatePropagation();
      }
    }
    if (event && 'pointerId' in event) {
      try {
        drag.target.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer can already be released when leaving the card.
      }
    }
    timelineMoveDocumentCleanupRef.current?.();
    timelineMoveDocumentCleanupRef.current = null;
    timelineMoveDragRef.current = null;
    setTimelineMovePreview(null);
  };

  const handleTimelineItemMoveWindowPointerMove = (event: globalThis.PointerEvent) => {
    if (!timelineMoveDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyTimelineItemMoveClientX(event.clientX);
  };

  const handleTimelineItemMoveWindowPointerUp = (event: globalThis.PointerEvent) => {
    if (!timelineMoveDragRef.current) return;
    finishTimelineItemMove(event);
  };

  const handleTimelineItemMoveWindowMouseMove = (event: globalThis.MouseEvent) => {
    if (!timelineMoveDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyTimelineItemMoveClientX(event.clientX);
  };

  const handleTimelineItemMoveWindowMouseUp = (event: globalThis.MouseEvent) => {
    if (!timelineMoveDragRef.current) return;
    finishTimelineItemMove(event);
  };

  const attachTimelineMoveDocumentListeners = () => {
    timelineMoveDocumentCleanupRef.current?.();
    document.addEventListener('pointermove', handleTimelineItemMoveWindowPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', handleTimelineItemMoveWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('pointercancel', handleTimelineItemMoveWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('mousemove', handleTimelineItemMoveWindowMouseMove, { capture: true, passive: false });
    document.addEventListener('mouseup', handleTimelineItemMoveWindowMouseUp, { capture: true, passive: false });
    timelineMoveDocumentCleanupRef.current = () => {
      document.removeEventListener('pointermove', handleTimelineItemMoveWindowPointerMove, true);
      document.removeEventListener('pointerup', handleTimelineItemMoveWindowPointerUp, true);
      document.removeEventListener('pointercancel', handleTimelineItemMoveWindowPointerUp, true);
      document.removeEventListener('mousemove', handleTimelineItemMoveWindowMouseMove, true);
      document.removeEventListener('mouseup', handleTimelineItemMoveWindowMouseUp, true);
    };
  };

  const startTimelineItemMove = (
    clientX: number,
    target: HTMLElement,
    originalTarget: EventTarget | null,
    item: VideoEditTimelineItem,
    selectionMode: VideoEditTimelineControllerSelectMode = 'replace',
    pointerId?: number,
  ) => {
    if (timelineMoveDragRef.current) return;
    if (running || busy) return;
    if (isTimelineItemMoveBlockedTarget(originalTarget)) return;
    const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
    if (track?.locked) {
      setLocalError('该轨道已锁定，先解锁后再移动片段。');
      return;
    }
    timelineMoveDragRef.current = {
      itemId: item.id,
      target,
      startClientX: clientX,
      startTimelineStart: item.timelineStart,
      moved: false,
      selectionMode,
      changeRemembered: false,
    };
    setTimelineContextMenu(null);
    updateTimelineMovePreview(timelineV2, item.id);
    if (Number.isFinite(pointerId)) {
      try {
        target.setPointerCapture(pointerId as number);
      } catch {
        // Document listeners keep the drag alive in embedded browser shells.
      }
    }
    attachTimelineMoveDocumentListeners();
  };

  const beginTimelineItemMove = (event: PointerEvent<HTMLElement>, item: VideoEditTimelineItem) => {
    if (event.button !== 0) return;
    if (isTimelineItemMoveBlockedTarget(event.target)) return;
    stopTimelineMoveStartPointer(event);
    startTimelineItemMove(event.clientX, event.currentTarget, event.target, item, resolveWorkbenchTimelineSelectionMode(event), event.pointerId);
  };

  const beginTimelineItemMouseMove = (event: MouseEvent<HTMLElement>, item: VideoEditTimelineItem) => {
    if (event.button !== 0) return;
    if (isTimelineItemMoveBlockedTarget(event.target)) return;
    stopTimelineMoveStartMouse(event);
    startTimelineItemMove(event.clientX, event.currentTarget, event.target, item, resolveWorkbenchTimelineSelectionMode(event));
  };

  const focusTimelineItemForWorkbench = (event: MouseEvent<HTMLElement>, item: VideoEditTimelineItem) => {
    event.preventDefault();
    event.stopPropagation();
    selectTimelineItemForWorkbench(item);
  };

  const openTimelineContextMenu = (event: MouseEvent<HTMLElement>, item: VideoEditTimelineItem) => {
    event.preventDefault();
    event.stopPropagation();
    setTimelineContextMenu({
      itemId: item.id,
      x: Math.min(window.innerWidth - 190, Math.max(12, event.clientX)),
      y: Math.min(window.innerHeight - 210, Math.max(12, event.clientY)),
    });
  };

  const closeTimelineContextMenu = () => setTimelineContextMenu(null);

  const splitTimelineItemAtPlayhead = (itemId: string) => {
    const liveData = (rf.getNode(id)?.data as any) || {};
    const live = normalizeVideoEditClips(liveData?.clips);
    const current = live.length ? live : clips;
    const liveTimeline = normalizeVideoEditTimeline(liveData?.timelineV2 as VideoEditTimelineV2 | undefined, current);
    const item = liveTimeline.items.find((entry) => entry.id === itemId);
    if (!item) {
      setLocalError('没有找到要拆分的时间线条目。');
      return;
    }
    if (guardLockedTimelineItems(liveTimeline, [itemId], '拆分')) return;
    const duration = Math.max(0.1, item.sourceOut - item.sourceIn);
    if (duration <= 0.2) {
      setLocalError('当前条目太短，无法继续拆分。');
      return;
    }
    const itemStart = item.timelineStart;
    const itemEnd = item.timelineStart + duration;
    const rawPlayhead = Number(liveTimeline.playhead);
    const fallbackSplit = itemStart + duration / 2;
    const splitAt = Number(Math.max(
      itemStart + 0.1,
      Math.min(itemEnd - 0.1, Number.isFinite(rawPlayhead) ? rawPlayhead : fallbackSplit),
    ).toFixed(3));
    if (splitAt <= itemStart + 0.05 || splitAt >= itemEnd - 0.05) {
      setLocalError('播放头需要在当前条目内部才能拆分。');
      return;
    }
    rememberWorkbenchChange();
    const nextTimelineBase = splitVideoEditTimelineItem(liveTimeline, itemId, splitAt);
    if (nextTimelineBase.items.length === liveTimeline.items.length) {
      setLocalError('当前播放头位置无法拆分这个条目。');
      return;
    }
    const linkedVideoItem = findLinkedVideoTimelineItem(nextTimelineBase, item);
    const linkedClip = findClipForTimelineItem(current, linkedVideoItem);
    update({
      clips: current,
      timelineV2: normalizeVideoEditTimeline({
        ...nextTimelineBase,
        playhead: splitAt,
      }, current),
      selectedClipId: linkedClip?.id || liveData.selectedClipId || selectedClip?.id || '',
      status: current.length ? 'ready' : 'idle',
      error: '',
    });
    setLocalError('');
  };

  const addClipToWorkbenchTimeline = (clipId: string, mode: VideoEditWorkbenchInsertMode) => {
    const sourceClip = clips.find((clip) => clip.id === clipId);
    if (!sourceClip || running || busy) return;
    rememberWorkbenchChange();
    const duration = Math.max(0.1, videoEditClipDuration(sourceClip));
    const sourceIn = Math.max(0, Number(sourceClip.trimStart) || 0);
    const sourceOut = Math.max(sourceIn + 0.1, Number(sourceClip.trimEnd || sourceClip.duration || sourceIn + duration));
    patchVideoEditTimeline((timeline, liveClips) => {
      const liveClip = liveClips.find((clip) => clip.id === clipId) || sourceClip;
      const mainVideoTrack = timeline.tracks.find((track) => track.id === 'track-video-main' && track.kind === 'video')
        || timeline.tracks.find((track) => track.kind === 'video')
        || { id: 'track-video-main', kind: 'video' as const, name: '视频轨', order: 0 };
      const overlayVideoTrack = timeline.tracks.find((track) => track.id === 'track-video-overlay' && track.kind === 'video')
        || { id: 'track-video-overlay', kind: 'video' as const, name: '叠加视频轨', order: Math.max(1, mainVideoTrack.order + 1) };
      const videoTrack = mode === 'overlay' ? overlayVideoTrack : mainVideoTrack;
      const audioTrack = timeline.tracks.find((track) => track.kind === 'audio') || { id: 'track-audio-main', kind: 'audio' as const, name: '音频轨', order: Math.max(2, videoTrack.order + 1) };
      const ensureTrack = (sourceTracks: VideoEditTimelineTrack[], track: VideoEditTimelineTrack) => (
        sourceTracks.some((entry) => entry.id === track.id) ? sourceTracks : [...sourceTracks, track]
      );
      const tracks = ensureTrack(timeline.tracks, videoTrack);
      const tracksWithAudio = liveClip.hasAudio === false ? tracks : ensureTrack(tracks, audioTrack);
      const assetId = liveClip.assetId || `asset-${liveClip.id}`;
      const existingAsset = timeline.assets.find((asset) => asset.id === assetId);
      const assets = existingAsset ? timeline.assets : [
        ...timeline.assets,
        {
          id: assetId,
          kind: 'video' as const,
          name: liveClip.name,
          url: liveClip.url,
          directUrl: liveClip.directUrl,
          mime: liveClip.mime,
          duration: liveClip.duration,
          width: liveClip.width,
          height: liveClip.height,
          size: liveClip.size,
          thumbnailUrl: liveClip.thumbnailUrl,
          filmstripUrls: liveClip.filmstripUrls,
          filmstripTimes: liveClip.filmstripTimes,
          waveformPeaks: liveClip.waveformPeaks,
          hasAudio: liveClip.hasAudio,
          sourceNodeId: liveClip.sourceNodeId,
          sourceCanvasId: liveClip.sourceCanvasId,
          sourceLabel: liveClip.sourceLabel,
        },
      ];
      const liveSourceIn = Math.max(0, Number(liveClip.trimStart) || sourceIn);
      const liveSourceOut = Math.max(
        liveSourceIn + 0.1,
        Number(liveClip.trimEnd || liveClip.duration || liveSourceIn + duration),
      );
      const editDuration = Math.max(0.1, Number((liveSourceOut - liveSourceIn).toFixed(3)));
      const appendStart = timeline.items
        .filter((item) => item.kind === 'video' && item.trackId === videoTrack.id)
        .reduce((max, item) => Math.max(max, item.timelineStart + Math.max(0.1, item.sourceOut - item.sourceIn)), 0);
      const insertStart = mode === 'append' ? appendStart : Math.max(0, Number(timeline.playhead) || 0);
      const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const videoItemId = `item-${liveClip.id}-${stamp}-video`;
      const audioItemId = `item-${liveClip.id}-${stamp}-audio`;
      let editedTimeline: VideoEditTimelineV2 = {
        ...timeline,
        tracks: tracksWithAudio,
        assets,
      };
      const itemEnd = (item: VideoEditTimelineItem) => item.timelineStart + timelineItemDuration(item);
      const trackById = new Map(editedTimeline.tracks.map((track) => [track.id, track]));
      const overwriteTargetTrackIds = new Set([videoTrack.id, audioTrack.id]);
      const touchesLockedItem = editedTimeline.items.some((item) => {
        const track = trackById.get(item.trackId);
        if (!track?.locked) return false;
        if (mode === 'insert') return itemEnd(item) > insertStart + 0.0001;
        if (mode !== 'overwrite') return false;
        return overwriteTargetTrackIds.has(item.trackId)
          && item.timelineStart < insertStart + editDuration - 0.0001
          && itemEnd(item) > insertStart + 0.0001;
      });
      if (touchesLockedItem) {
        setLocalError('锁定轨道内的条目不能插入或覆盖，先解锁对应轨道。');
        return timeline;
      }
      if (mode === 'insert') {
        editedTimeline = insertVideoEditTimelineRange(editedTimeline, insertStart, editDuration, {
          stamp: `insert-${stamp}`,
          includeText: true,
        });
      }
      if (mode === 'overwrite') {
        editedTimeline = overwriteVideoEditTimelineRange(editedTimeline, insertStart, editDuration, {
          stamp: `overwrite-${stamp}`,
          includeText: false,
          targetTrackIds: [...overwriteTargetTrackIds],
        });
      }
      const insertedItems: VideoEditTimelineItem[] = [
        {
          id: videoItemId,
          assetId,
          trackId: videoTrack.id,
          kind: 'video',
          timelineStart: Number(insertStart.toFixed(3)),
          sourceIn: liveSourceIn,
          sourceOut: liveSourceOut,
          muted: liveClip.muted,
          label: liveClip.name,
          x: mode === 'overlay' ? 96 : 0,
          y: mode === 'overlay' ? 92 : 0,
          scale: mode === 'overlay' ? 0.34 : 1,
          opacity: 1,
        },
      ];
      if (liveClip.hasAudio !== false) {
        insertedItems.push({
          id: audioItemId,
          assetId,
          trackId: audioTrack.id,
          kind: 'audio',
          timelineStart: Number(insertStart.toFixed(3)),
          sourceIn: liveSourceIn,
          sourceOut: liveSourceOut,
          muted: liveClip.muted,
          linkedItemId: videoItemId,
          label: `${liveClip.name} 原声`,
        });
      }
      return {
        ...editedTimeline,
        items: [...editedTimeline.items, ...insertedItems],
        selectedItemIds: [videoItemId],
        playhead: Number(insertStart.toFixed(3)),
      };
    }, { selectedClipId: sourceClip.id });
    setLocalError('');
  };

  const addClipsToWorkbenchTimeline = (clipIds: string[], mode: VideoEditWorkbenchInsertMode) => {
    const uniqueClipIds = Array.from(new Set(clipIds.filter(Boolean)));
    if (!uniqueClipIds.length || running || busy) return;
    uniqueClipIds.forEach((clipId, index) => {
      const batchMode = mode === 'overlay'
        ? 'overlay'
        : (index === 0 ? mode : 'append');
      addClipToWorkbenchTimeline(clipId, batchMode);
    });
  };

  const handleTimelineContextAction = (action: 'seek' | 'split' | 'duplicate' | 'mute' | 'delete') => {
    const itemId = timelineContextMenu?.itemId;
    if (!itemId) return;
    closeTimelineContextMenu();
    if (action === 'seek') {
      const item = timelineV2.items.find((entry) => entry.id === itemId);
      if (item) selectTimelineItemForWorkbench(item);
      return;
    }
    if (action === 'split') {
      splitTimelineItemAtPlayhead(itemId);
      return;
    }
    if (action === 'duplicate') {
      duplicateTimelineItems([itemId]);
      return;
    }
    if (action === 'mute') {
      toggleTimelineItemMuted(itemId);
      return;
    }
    removeTimelineItems([itemId]);
  };

  const stopTimelineContextActionPointer = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
  };

  const handleTimelineContextActionClick = (
    event: MouseEvent<HTMLButtonElement>,
    action: 'seek' | 'split' | 'duplicate' | 'mute' | 'delete',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    handleTimelineContextAction(action);
  };

  const handleTimelineContextActionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    action: 'seek' | 'split' | 'duplicate' | 'mute' | 'delete',
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    handleTimelineContextAction(action);
  };

  const toggleWorkbenchPlayback = () => {
    const video = previewVideoRef.current;
    if (!video || !selectedClip) return;
    if (video.paused) {
      playSelectedClipPreview();
      return;
    }
    video.pause();
  };

  const handleStoryboardNoteChange = (clipId: string, value: string) => {
    patchClip(clipId, { storyboardNote: value });
  };

  const handleStoryboardTagsChange = (clipId: string, value: string) => {
    const storyboardTags = value
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
    patchClip(clipId, { storyboardTags });
  };

  const moveStoryboardClip = (clipId: string, direction: -1 | 1) => {
    const index = clips.findIndex((clip) => clip.id === clipId);
    if (index < 0) return;
    const nextIndex = Math.max(0, Math.min(clips.length - 1, index + direction));
    if (nextIndex === index) return;
    commitClips(reorder(clips, index, nextIndex), { selectedClipId: clipId });
  };

  const isClipOnLockedTimelineTrack = (clipId: string) => {
    const clip = clips.find((entry) => entry.id === clipId);
    const assetIds = new Set<string>([clipId, `asset-${clipId}`]);
    if (clip?.assetId) assetIds.add(clip.assetId);
    const item = timelineV2.items.find((entry) => (
      entry.kind === 'video'
      && (
        entry.id === clipId
        || entry.id === `item-${clipId}-video`
        || assetIds.has(entry.assetId)
      )
    ));
    if (!item) return false;
    const track = timelineV2.tracks.find((entry) => entry.id === item.trackId);
    return !!track?.locked;
  };

  const handleTrimStartChange = (clipId: string, value: number) => {
    if (isClipOnLockedTimelineTrack(clipId)) {
      setLocalError('该轨道已锁定，先解锁后再调整片段。');
      return;
    }
    patchClip(clipId, { trimStart: value }, { selectedClipId: clipId });
    seekPreviewTo(value);
  };

  const seekPreviewNearTrimEnd = (clipId: string, value: number) => {
    const target = clips.find((clip) => clip.id === clipId);
    const start = Math.max(0, Number(target?.trimStart) || 0);
    const nextEnd = Math.max(start + 0.1, Number(value) || start + 0.1);
    seekPreviewTo(Math.max(start, nextEnd - 0.05));
  };

  const handleTrimEndChange = (clipId: string, value: number) => {
    if (isClipOnLockedTimelineTrack(clipId)) {
      setLocalError('该轨道已锁定，先解锁后再调整片段。');
      return;
    }
    patchClip(clipId, { trimEnd: value }, { selectedClipId: clipId });
    seekPreviewNearTrimEnd(clipId, value);
  };

  const startTimelineTrimDrag = (
    clientX: number,
    target: HTMLElement,
    clip: VideoEditClip,
    edge: VideoEditTimelineTrimDrag['edge'],
    trackElement?: HTMLElement | null,
    pointerId?: number,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    if (running || busy) return;
    if (timelineItemId) {
      const item = timelineV2.items.find((entry) => entry.id === timelineItemId);
      const track = item ? timelineV2.tracks.find((entry) => entry.id === item.trackId) : undefined;
      if (track?.locked) {
        setLocalError('该轨道已锁定，先解锁后再调整片段。');
        return;
      }
    }
    const track = trackElement || target.closest('[data-video-edit-trim-track="true"]') as HTMLElement | null;
    const rect = track?.getBoundingClientRect();
    const duration = Math.max(0.1, Number(clip.duration || clip.trimEnd || videoEditClipDuration(clip) || 1));
    const trimStart = Math.max(0, Math.min(duration, Number(clip.trimStart) || 0));
    const trimEnd = Math.max(trimStart + 0.1, Math.min(duration, Number(clip.trimEnd || duration)));
    const dragMinSecond = mode === 'trimmed-window' ? trimStart : 0;
    const dragMaxSecond = mode === 'trimmed-window' ? trimEnd : duration;
    timelineTrimDragRef.current = {
      clipId: clip.id,
      timelineItemId,
      edge,
      duration,
      dragMinSecond,
      dragMaxSecond,
      trackLeft: rect?.left || clientX,
      trackWidth: Math.max(1, rect?.width || 1),
      target,
    };
    rememberWorkbenchChange();
    if (Number.isFinite(pointerId)) {
      try {
        target.setPointerCapture(pointerId as number);
      } catch {
        // Pointer capture is best-effort; document listeners keep dragging alive.
      }
    }
    attachTimelineTrimDocumentListeners();
    applyTimelineTrimClientX(clientX);
  };

  const beginTimelineTrimDrag = (
    event: PointerEvent<HTMLElement>,
    clip: VideoEditClip,
    edge: VideoEditTimelineTrimDrag['edge'],
    trackElement?: HTMLElement | null,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    stopInteractivePointer(event);
    startTimelineTrimDrag(event.clientX, event.currentTarget, clip, edge, trackElement, event.pointerId, mode, timelineItemId);
  };

  const beginTimelineTrimMouseDrag = (
    event: MouseEvent<HTMLElement>,
    clip: VideoEditClip,
    edge: VideoEditTimelineTrimDrag['edge'],
    trackElement?: HTMLElement | null,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    stopInteractiveMouse(event);
    startTimelineTrimDrag(event.clientX, event.currentTarget, clip, edge, trackElement, undefined, mode, timelineItemId);
  };

  const beginTimelineTrimTrackDrag = (
    event: PointerEvent<HTMLElement>,
    clip: VideoEditClip,
    trimVisual: VideoEditTrimVisual,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    stopInteractivePointer(event);
    if (running || busy) return;
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100));
    const startPct = mode === 'trimmed-window' ? trimVisual.trimmedWindowStartPct : trimVisual.trimStartPct;
    const endPct = mode === 'trimmed-window' ? trimVisual.trimmedWindowEndPct : trimVisual.trimEndPct;
    const edge: VideoEditTimelineTrimDrag['edge'] = Math.abs(pct - startPct) <= Math.abs(pct - endPct) ? 'start' : 'end';
    beginTimelineTrimDrag(event, clip, edge, track, mode, timelineItemId);
  };

  const beginTimelineTrimTrackMouseDrag = (
    event: MouseEvent<HTMLElement>,
    clip: VideoEditClip,
    trimVisual: VideoEditTrimVisual,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    stopInteractiveMouse(event);
    if (running || busy) return;
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100));
    const startPct = mode === 'trimmed-window' ? trimVisual.trimmedWindowStartPct : trimVisual.trimStartPct;
    const endPct = mode === 'trimmed-window' ? trimVisual.trimmedWindowEndPct : trimVisual.trimEndPct;
    const edge: VideoEditTimelineTrimDrag['edge'] = Math.abs(pct - startPct) <= Math.abs(pct - endPct) ? 'start' : 'end';
    startTimelineTrimDrag(event.clientX, event.currentTarget, clip, edge, track, undefined, mode, timelineItemId);
  };

  const continueOrStartTimelineTrimTrackDrag = (
    event: PointerEvent<HTMLElement>,
    clip: VideoEditClip,
    trimVisual: VideoEditTrimVisual,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    if (timelineTrimDragRef.current) {
      handleTimelineTrimPointerMove(event);
      return;
    }
    if (running || busy || event.buttons !== 1) return;
    beginTimelineTrimTrackDrag(event, clip, trimVisual, mode, timelineItemId);
  };

  const continueOrStartTimelineTrimTrackMouseDrag = (
    event: MouseEvent<HTMLElement>,
    clip: VideoEditClip,
    trimVisual: VideoEditTrimVisual,
    mode: VideoEditTrimInteractionMode = 'source',
    timelineItemId?: string,
  ) => {
    if (timelineTrimDragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      applyTimelineTrimClientX(event.clientX);
      return;
    }
    if (running || busy || event.buttons !== 1) return;
    beginTimelineTrimTrackMouseDrag(event, clip, trimVisual, mode, timelineItemId);
  };

  const applyTimelineTrimClientX = (clientX: number) => {
    const drag = timelineTrimDragRef.current;
    if (!drag) return;
    const liveData = (rf.getNode(id)?.data as any) || {};
    const live = normalizeVideoEditClips(liveData?.clips);
    const current = live.length ? live : clips;
    const clip = current.find((item) => item.id === drag.clipId);
    if (!clip) return;
    const liveTimeline = normalizeVideoEditTimeline(liveData?.timelineV2 as VideoEditTimelineV2 | undefined, current);
    const timelineItem = drag.timelineItemId ? liveTimeline.items.find((item) => item.id === drag.timelineItemId) : undefined;
    const start = timelineItem ? timelineItem.sourceIn : Math.max(0, Number(clip.trimStart) || 0);
    const end = timelineItem ? timelineItem.sourceOut : Math.max(start + 0.1, Number(clip.trimEnd || clip.duration || drag.duration));
    const ratio = Math.max(0, Math.min(1, (clientX - drag.trackLeft) / drag.trackWidth));
    const dragSpan = Math.max(0.1, drag.dragMaxSecond - drag.dragMinSecond);
    let nextSecond = Number((drag.dragMinSecond + ratio * dragSpan).toFixed(2));
    const clipId = drag.clipId;
    if (drag.edge === 'start') {
      nextSecond = Number(Math.max(0, Math.min(nextSecond, end - 0.1)).toFixed(2));
      if (drag.timelineItemId) {
        const nextTimeline = resizeVideoEditTimelineItem(liveTimeline, drag.timelineItemId, drag.edge, nextSecond);
        const nextClips = syncVideoEditClipsFromTimelineItem(current, nextTimeline, drag.timelineItemId, clipId);
        update({ clips: nextClips, timelineV2: nextTimeline, selectedClipId: clipId });
        seekPreviewTo(nextSecond);
        return;
      }
      handleTrimStartChange(clipId, nextSecond);
      return;
    }
    nextSecond = Number(Math.min(drag.duration, Math.max(start + 0.1, nextSecond)).toFixed(2));
    if (drag.timelineItemId) {
      const nextTimeline = resizeVideoEditTimelineItem(liveTimeline, drag.timelineItemId, drag.edge, nextSecond);
      const nextClips = syncVideoEditClipsFromTimelineItem(current, nextTimeline, drag.timelineItemId, clipId);
      update({ clips: nextClips, timelineV2: nextTimeline, selectedClipId: clipId });
      seekPreviewTo(Math.max(start, nextSecond - 0.05));
      return;
    }
    handleTrimEndChange(clipId, nextSecond);
  };

  const handleTimelineTrimPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!timelineTrimDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    applyTimelineTrimClientX(event.clientX);
  };

  const handleTimelineTrimWindowPointerMove = (event: globalThis.PointerEvent) => {
    if (!timelineTrimDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyTimelineTrimClientX(event.clientX);
  };

  const finishTimelineTrimDrag = (event?: PointerEvent<HTMLElement> | globalThis.PointerEvent | MouseEvent<HTMLElement> | globalThis.MouseEvent) => {
    const drag = timelineTrimDragRef.current;
    if (!drag) return;
    event?.preventDefault();
    event?.stopPropagation();
    if (event && 'stopImmediatePropagation' in event) {
      event.stopImmediatePropagation();
    }
    if (event && 'pointerId' in event) {
      try {
        drag.target.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release errors when the browser already released capture.
      }
    }
    timelineTrimDocumentCleanupRef.current?.();
    timelineTrimDocumentCleanupRef.current = null;
    timelineTrimDragRef.current = null;
  };

  const handleTimelineTrimWindowPointerUp = (event: globalThis.PointerEvent) => {
    if (!timelineTrimDragRef.current) return;
    finishTimelineTrimDrag(event);
  };

  const handleTimelineTrimWindowMouseMove = (event: globalThis.MouseEvent) => {
    if (!timelineTrimDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyTimelineTrimClientX(event.clientX);
  };

  const handleTimelineTrimWindowMouseUp = (event: globalThis.MouseEvent) => {
    if (!timelineTrimDragRef.current) return;
    finishTimelineTrimDrag(event);
  };

  const attachTimelineTrimDocumentListeners = () => {
    timelineTrimDocumentCleanupRef.current?.();
    document.addEventListener('pointermove', handleTimelineTrimWindowPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', handleTimelineTrimWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('pointercancel', handleTimelineTrimWindowPointerUp, { capture: true, passive: false });
    document.addEventListener('mousemove', handleTimelineTrimWindowMouseMove, { capture: true, passive: false });
    document.addEventListener('mouseup', handleTimelineTrimWindowMouseUp, { capture: true, passive: false });
    timelineTrimDocumentCleanupRef.current = () => {
      document.removeEventListener('pointermove', handleTimelineTrimWindowPointerMove, true);
      document.removeEventListener('pointerup', handleTimelineTrimWindowPointerUp, true);
      document.removeEventListener('pointercancel', handleTimelineTrimWindowPointerUp, true);
      document.removeEventListener('mousemove', handleTimelineTrimWindowMouseMove, true);
      document.removeEventListener('mouseup', handleTimelineTrimWindowMouseUp, true);
    };
  };

  useEffect(() => {
    return () => {
      timelineTrimDocumentCleanupRef.current?.();
      timelineTrimDocumentCleanupRef.current = null;
      timelineItemTrimDocumentCleanupRef.current?.();
      timelineItemTrimDocumentCleanupRef.current = null;
      previewPipDragDocumentCleanupRef.current?.();
      previewPipDragDocumentCleanupRef.current = null;
    };
  }, []);

  const splitClipAt = (clipToSplit: VideoEditClip, splitAt: number) => {
    const start = Math.max(0, Number(clipToSplit.trimStart) || 0);
    const end = Number(clipToSplit.trimEnd || clipToSplit.duration || 0);
    if (!Number.isFinite(end) || end <= start + 0.2) {
      setLocalError('需要先读取片段时长，且可用时长要大于 0.2 秒');
      return;
    }
    const middle = Number(Math.max(start + 0.1, Math.min(end - 0.1, splitAt)).toFixed(2));
    const leftId = `clip-${Date.now()}-left-${Math.random().toString(36).slice(2, 6)}`;
    const rightId = `clip-${Date.now()}-right-${Math.random().toString(36).slice(2, 6)}`;
    const next = clips.flatMap((clip) => {
      if (clip.id !== clipToSplit.id) return [clip];
      return [
        { ...clip, id: leftId, name: `${clip.name} A`, trimStart: start, trimEnd: middle },
        { ...clip, id: rightId, name: `${clip.name} B`, trimStart: middle, trimEnd: end },
      ];
    });
    setLocalError('');
    commitClips(next, { selectedClipId: rightId });
  };

  const splitSelectedClip = () => {
    if (!selectedClip) return;
    const start = Math.max(0, Number(selectedClip.trimStart) || 0);
    const end = Number(selectedClip.trimEnd || selectedClip.duration || 0);
    splitClipAt(selectedClip, start + (end - start) / 2);
  };

  const splitSelectedClipAtPlayhead = () => {
    if (!selectedClip || selectedClipTimelineLocked) return;
    const current = previewVideoRef.current?.currentTime;
    splitClipAt(selectedClip, Number.isFinite(current || 0) ? Number(current) : previewTime);
  };

  const setWorkbenchTrimFromPlayhead = (edge: 'start' | 'end') => {
    if (!selectedClip || selectedClipTimelineLocked) return;
    const current = previewVideoRef.current?.currentTime;
    const playhead = Number.isFinite(Number(current)) ? Number(current) : previewTime;
    if (!Number.isFinite(playhead)) return;
    rememberWorkbenchChange();
    if (edge === 'start') {
      const end = Number(selectedClip.trimEnd || selectedClip.duration || playhead + 0.1);
      handleTrimStartChange(selectedClip.id, Number(Math.max(0, Math.min(playhead, Math.max(0, end - 0.1))).toFixed(2)));
      return;
    }
    const start = Math.max(0, Number(selectedClip.trimStart || 0));
    const sourceEnd = Number(selectedClip.duration || Math.max(playhead, start + 0.1));
    handleTrimEndChange(selectedClip.id, Number(Math.min(sourceEnd, Math.max(start + 0.1, playhead)).toFixed(2)));
  };

  const handleWorkbenchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isWorkbenchEditableTarget(event.target)) return;
    const claimWorkbenchShortcut = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const workbenchEditingShortcutBlocked = running || !!busy || workbenchShortcutsOpen;
    const claimBlockedWorkbenchEditingShortcut = () => {
      claimWorkbenchShortcut();
      if (workbenchShortcutsOpen) return true;
      if (running || busy) {
        setLocalError('当前正在处理，请稍后再使用剪辑台快捷键。');
        return true;
      }
      return false;
    };
    if (event.key === 'Escape' && workbenchShortcutsOpen) {
      claimWorkbenchShortcut();
      setWorkbenchShortcutsOpen(false);
      return;
    }
    if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      claimWorkbenchShortcut();
      toggleWorkbenchShortcuts();
      return;
    }
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z') {
        if (workbenchEditingShortcutBlocked) {
          claimBlockedWorkbenchEditingShortcut();
          return;
        }
        claimWorkbenchShortcut();
        if (event.shiftKey) redoWorkbenchChange();
        else undoWorkbenchChange();
      } else if (key === 'y') {
        if (workbenchEditingShortcutBlocked) {
          claimBlockedWorkbenchEditingShortcut();
          return;
        }
        claimWorkbenchShortcut();
        redoWorkbenchChange();
      } else if (key === 'd') {
        if (workbenchEditingShortcutBlocked) {
          claimBlockedWorkbenchEditingShortcut();
          return;
        }
        claimWorkbenchShortcut();
        duplicateSelectedTimelineItems();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (workbenchEditingShortcutBlocked) {
        claimBlockedWorkbenchEditingShortcut();
        return;
      }
      claimWorkbenchShortcut();
      removeSelectedTimelineItems();
      return;
    }
    if (event.key === ' ') {
      if (workbenchShortcutsOpen) {
        claimBlockedWorkbenchEditingShortcut();
        return;
      }
      claimWorkbenchShortcut();
      toggleWorkbenchPlayback();
      return;
    }
    switch (key) {
      case 'i':
        if (workbenchEditingShortcutBlocked) {
          claimBlockedWorkbenchEditingShortcut();
          break;
        }
        claimWorkbenchShortcut();
        setWorkbenchTrimFromPlayhead('start');
        break;
      case 'o':
        if (workbenchEditingShortcutBlocked) {
          claimBlockedWorkbenchEditingShortcut();
          break;
        }
        claimWorkbenchShortcut();
        setWorkbenchTrimFromPlayhead('end');
        break;
      case 's':
        if (workbenchEditingShortcutBlocked) {
          claimBlockedWorkbenchEditingShortcut();
          break;
        }
        claimWorkbenchShortcut();
        rememberWorkbenchChange();
        splitSelectedClipAtPlayhead();
        break;
      default:
        break;
    }
  };

  const handleWorkbenchClipCardKeyDown = (event: KeyboardEvent<HTMLElement>, clipId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    update({ selectedClipId: clipId });
  };

  const handleTimelineDrop = (event: DragEvent<HTMLElement>, overId: string) => {
    event.preventDefault();
    if (!dragClipId || dragClipId === overId) return;
    const from = clips.findIndex((clip) => clip.id === dragClipId);
    const to = clips.findIndex((clip) => clip.id === overId);
    if (from < 0 || to < 0) return;
    commitClips(reorder(clips, from, to));
    setDragClipId(null);
  };

  const compressToTargetDuration = () => {
    if (!settings.targetDuration) {
      setLocalError('请先设置目标时长');
      return;
    }
    const next = compressVideoEditClipsToTargetDuration(clips, settings.targetDuration);
    setLocalError('');
    commitClips(next);
  };

  const distributeToTargetDuration = () => {
    if (!settings.targetDuration) {
      setLocalError('请先设置目标时长');
      return;
    }
    const next = distributeVideoEditClipsToTargetDuration(clips, settings.targetDuration);
    setLocalError('');
    commitClips(next);
  };

  const sortClipsByName = () => {
    if (!clips.length) return;
    setLocalError('');
    commitClips(sortVideoEditClipsByName(clips));
  };

  const trimClipsToDefaultDuration = () => {
    if (!settings.defaultClipDuration) {
      setLocalError('请先设置每段默认秒数');
      return;
    }
    const next = trimVideoEditClipsToFirstSeconds(clips, settings.defaultClipDuration);
    setLocalError('');
    commitClips(next);
  };

  const buildImportCleanupOptions = () => ({
    sortMode: settings.importSortMode || 'current',
    trimMode: settings.defaultTrimMode || 'full',
    seconds: settings.defaultClipDuration,
    audioFilter: settings.audioFilter || 'all',
  });

  const previewImportCleanup = () => {
    if (!clips.length) return;
    const next = applyVideoEditImportCleanup(clips, buildImportCleanupOptions());
    setImportCleanupPreview({
      before: clips.length,
      after: next.length,
      duration: totalVideoEditDuration(next),
    });
    setLocalError('');
  };

  const applyImportCleanup = () => {
    if (!clips.length) return;
    const next = applyVideoEditImportCleanup(clips, buildImportCleanupOptions());
    importCleanupUndoRef.current = clips;
    setImportCleanupPreview(null);
    setLocalError('');
    commitClips(next, { selectedClipId: next[0]?.id || '' });
  };

  const undoImportCleanup = () => {
    const previous = importCleanupUndoRef.current;
    if (!previous?.length) {
      setLocalError('没有可撤销的整理记录');
      return;
    }
    importCleanupUndoRef.current = null;
    setImportCleanupPreview(null);
    setLocalError('');
    commitClips(previous, { selectedClipId: previous[0]?.id || '' });
  };

  const locateSourceClip = (clip: VideoEditClip) => {
    if (!clip.sourceNodeId) {
      setLocalError('该片段没有记录来源节点');
      return;
    }
    const source = rf.getNode(clip.sourceNodeId);
    if (!source) {
      setLocalError('来源节点不在当前画布，可能来自其他画布或已删除');
      return;
    }
    rf.setCenter(source.position.x + 160, source.position.y + 120, { zoom: 1, duration: 360 });
    setLocalError('');
  };

  const copySourceInfo = async (clip: VideoEditClip) => {
    const lines = [
      `素材：${clip.name}`,
      `来源：${clip.sourceNodeLabel || clip.sourceLabel || '未知来源'}`,
      clip.sourceNodeId ? `来源节点：${clip.sourceNodeId}` : '',
      clip.sourceCanvasName || clip.sourceCanvasId ? `来源画布：${clip.sourceCanvasName || clip.sourceCanvasId}` : '',
      clip.sourceCreatedAt ? `加入时间：${formatDateTime(clip.sourceCreatedAt) || clip.sourceCreatedAt}` : '',
      `地址：${clip.directUrl || clip.url}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard?.writeText(lines.join('\n'));
      setLocalError('');
    } catch (_) {
      setLocalError('复制来源信息失败，请检查浏览器剪贴板权限');
    }
  };

  const resolveVideoEditOutputNodePosition = () => {
    const self = rf.getNode(id);
    const sourceWidth = Number((self as any)?.measured?.width || (self as any)?.width || 1120);
    const baseX = (self?.position?.x || 0) + sourceWidth + 80;
    const baseY = (self?.position?.y || 0) + 80;
    return placeSingleNode(baseX, baseY, 'output', rf.getNodes(), { source: `placement:video-edit-output:${id}` });
  };

  const addOutputNodeFromVersion = (version: VideoEditOutputVersion, mediaKind: 'video' | 'audio' = 'video') => {
    const includeVideo = mediaKind !== 'audio' && !!version.videoUrl;
    const includeAudio = mediaKind !== 'video' && !!version.audioUrl;
    if (!includeVideo && !includeAudio) return;
    rf.addNodes([{
      id: `output-video-edit-version-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'output',
      position: resolveVideoEditOutputNodePosition(),
      data: {
        videoUrl: includeVideo ? version.videoUrl : '',
        videoUrls: includeVideo ? [version.videoUrl] : [],
        directVideoUrl: includeVideo ? (version.directVideoUrl || version.videoUrl || '') : '',
        directVideoUrls: includeVideo ? [version.directVideoUrl || version.videoUrl] : [],
        fileName: includeVideo ? (version.name || '') : '',
        fileSize: includeVideo ? (version.size || 0) : 0,
        mime: includeVideo ? 'video/mp4' : '',
        audioUrl: includeAudio ? version.audioUrl : '',
        audioUrls: includeAudio ? [version.audioUrl] : [],
        directAudioUrl: includeAudio ? (version.directAudioUrl || version.audioUrl || '') : '',
        directAudioUrls: includeAudio ? [version.directAudioUrl || version.audioUrl] : [],
        audioFileName: includeAudio ? (version.audioName || version.name || '') : '',
        audioFileSize: includeAudio ? (version.audioSize || 0) : 0,
        audioMime: includeAudio ? 'audio/mpeg' : '',
      },
    }]);
  };

  const snapshotOutputData = (snapshot: VideoSnapshotResult, extra: Record<string, any> = {}) => ({
    imageUrl: snapshot.imageUrl,
    imageUrls: snapshot.imageUrl ? [snapshot.imageUrl] : [],
    directImageUrl: snapshot.directImageUrl || snapshot.imageUrl,
    directImageUrls: snapshot.imageUrl ? [snapshot.directImageUrl || snapshot.imageUrl] : [],
    fileName: snapshot.fileName || fileNameFromUrl(snapshot.imageUrl),
    fileSize: snapshot.size || 0,
    mime: snapshot.mime || 'image/png',
    outputText: `视频剪辑截图 · ${formatSeconds(snapshot.time)}`,
    directOutputText: `视频剪辑截图 · ${formatSeconds(snapshot.time)}`,
    sourceNodeId: id,
    sourceLabel: snapshot.sourceLabel || '视频剪辑截图',
    videoSnapshot: {
      sourceNodeId: id,
      sourceClipId: selectedClip?.id || '',
      sourceClipName: selectedClip?.name || snapshot.sourceName || '',
      frameTime: snapshot.time,
      sourceUrl: snapshot.sourceUrl || selectedClip?.url || '',
    },
    ...extra,
  });

  const addOutputNodeFromSnapshot = (snapshot: VideoSnapshotResult, extra: Record<string, any> = {}) => {
    const self = rf.getNode(id);
    rf.addNodes([{
      id: `output-video-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'output',
      position: {
        x: (self?.position.x || 0) + 820,
        y: (self?.position.y || 0) + 80,
      },
      selected: true,
      data: snapshotOutputData(snapshot, extra),
    }]);
  };

  const sendSnapshotToGenerationTarget = (snapshot: VideoSnapshotResult) => {
    const selectedTarget = rf.getNodes().find((node) => node.selected && node.type === CREATIVE_TARGET_NODE_TYPE);
    if (selectedTarget) {
      const built = buildCreativeTargetResult(selectedTarget, [snapshot.imageUrl], {
        mode: 'replace',
        sourceNodeIds: [id],
        prompt: `视频剪辑当前帧截图 ${formatSeconds(snapshot.time)}`,
      });
      rf.setNodes((prev) => prev.map((node) =>
        node.id === selectedTarget.id
          ? { ...node, data: { ...(node.data as any), ...built.targetPatch }, selected: true }
          : { ...node, selected: false },
      ));
      return;
    }

    const self = rf.getNode(id);
    rf.addNodes([{
      id: `generation-target-video-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'generation-target',
      position: {
        x: (self?.position.x || 0) + 820,
        y: (self?.position.y || 0) + 360,
      },
      selected: true,
      data: {
        targetType: 'image',
        title: `视频截图 ${formatSeconds(snapshot.time)}`,
        prompt: '',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        sizeLevel: '1K',
        status: 'success',
        error: '',
        resultUrl: snapshot.imageUrl,
        resultUrls: snapshot.imageUrl ? [snapshot.imageUrl] : [],
        resultVersions: [{
          url: snapshot.imageUrl,
          createdAt: Date.now(),
          sourceNodeIds: [id],
          prompt: `视频剪辑当前帧截图 ${formatSeconds(snapshot.time)}`,
        }],
        ...snapshotOutputData(snapshot),
      },
    }]);
  };

  const handleImageEditSnapshotProduce = async (urls: string[], meta: ImageEditProduceMeta) => {
    const cleanUrls = urls.filter(Boolean);
    if (!cleanUrls.length) return;
    const self = rf.getNode(id);
    rf.addNodes(cleanUrls.map((url, index) => ({
      id: `output-video-snapshot-edit-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'output',
      position: {
        x: (self?.position.x || 0) + 820,
        y: (self?.position.y || 0) + 80 + index * 80,
      },
      selected: index === 0,
      data: {
        imageUrl: url,
        imageUrls: [url],
        directImageUrl: url,
        directImageUrls: [url],
        fileName: fileNameFromUrl(url),
        mime: 'image/png',
        sourceNodeId: id,
        sourceLabel: '视频截图图像编辑',
        imageEditMeta: meta,
      },
    })));
    setImageEditSnapshotUrl('');
  };

  const restoreOutputVersion = (version: VideoEditOutputVersion) => {
    update({
      settings: version.settings,
      status: 'success',
      error: '',
      output: version,
      videoUrl: version.videoUrl || '',
      videoUrls: version.videoUrl ? [version.videoUrl] : [],
      directVideoUrl: version.directVideoUrl || version.videoUrl || '',
      directVideoUrls: version.videoUrl ? [version.directVideoUrl || version.videoUrl] : [],
      audioUrl: version.audioUrl || '',
      audioUrls: version.audioUrl ? [version.audioUrl] : [],
      directAudioUrl: version.directAudioUrl || version.audioUrl || '',
      directAudioUrls: version.audioUrl ? [version.directAudioUrl || version.audioUrl] : [],
      fileName: version.name || '',
      fileSize: version.size || 0,
      audioFileName: version.audioName || '',
      audioFileSize: version.audioSize || 0,
    });
  };

  const currentSnapshotTime = () => {
    const current = previewVideoRef.current?.currentTime;
    if (Number.isFinite(current || 0)) return Math.max(0, Number(current));
    if (Number.isFinite(previewTime || 0)) return Math.max(0, Number(previewTime));
    return Math.max(0, Number(selectedClip?.trimStart || 0));
  };

  const handleSnapshotFrame = async (mode: 'cover' | 'output' | 'target' | 'image-edit') => {
    if (!selectedClip || busy) {
      setLocalError(selectedClip ? '当前正在处理，请稍后再截图' : '请先选择一个视频片段');
      return;
    }
    setBusy('snapshot');
    setLocalError('');
    setSnapshotNotice('');
    try {
      const snapshot = await snapshotVideoFrameAsync(selectedClip, currentSnapshotTime(), {
        format: 'png',
        sourceLabel: selectedClip.name || selectedClip.sourceLabel || '视频剪辑截图',
      });
      if (mode === 'cover') {
        update({
          coverImageUrl: snapshot.imageUrl,
          coverDirectImageUrl: snapshot.directImageUrl || snapshot.imageUrl,
          coverFrameTime: snapshot.time,
          coverFileName: snapshot.fileName,
          coverFileSize: snapshot.size || 0,
          error: '',
        });
        setSnapshotNotice('封面帧已设置');
      } else if (mode === 'output') {
        addOutputNodeFromSnapshot(snapshot);
        setSnapshotNotice('截图已发送到输出素材');
      } else if (mode === 'target') {
        sendSnapshotToGenerationTarget(snapshot);
        setSnapshotNotice('截图已发送到生成目标框');
      } else {
        setImageEditSnapshotUrl(snapshot.imageUrl);
        setSnapshotNotice('截图已送入图像编辑');
      }
    } catch (error: any) {
      const message = error?.message || '当前帧截图失败';
      setLocalError(message);
      update({ error: message });
    } finally {
      setBusy('');
    }
  };

  const applyComposeResult = (result: VideoComposeResult, outputSettings: VideoEditSettings = settings) => {
    const output = {
      videoUrl: result.videoUrl,
      directVideoUrl: result.directVideoUrl || result.videoUrl,
      name: result.fileName,
      duration: result.duration,
      width: result.width,
      height: result.height,
      size: result.size,
      transitionEngine: result.transitionEngine,
      transitionName: result.transitionName,
      transitionQuality: result.transitionQuality,
      transitionDuration: result.transitionDuration,
    };
    const nextVersions = pushVideoEditOutputVersion(
      (rf.getNode(id)?.data as any)?.outputVersions || d.outputVersions,
      { ...output, label: `成片 ${formatSeconds(result.duration || totalDuration)}`, jobId: result.jobId },
      outputSettings,
    );
    const patch = {
      status: 'success',
      error: '',
      videoUrl: result.videoUrl,
      videoUrls: [result.videoUrl],
      directVideoUrl: result.directVideoUrl || result.videoUrl,
      directVideoUrls: [result.directVideoUrl || result.videoUrl],
      fileName: result.fileName,
      fileSize: result.size || 0,
      mime: result.mime || 'video/mp4',
      output,
      outputVersions: nextVersions,
      job: { id: result.jobId, status: 'done', progress: 100, message: '合成完成' },
    };
    update(patch);
    if (settings.autoCreateOutputNode) {
      addOutputNodeFromVersion(nextVersions[0], 'video');
    }
  };

  const isSeparateAudioResult = (result: VideoComposeResult) => result.mode === 'audio-only' || result.mode === 'mute-video' || result.mode === 'both';

  const applySeparateResult = (result: VideoComposeResult) => {
    const patch: Record<string, any> = {
      status: 'success',
      error: '',
      job: { id: result.jobId, status: 'done', progress: 100, message: '音频处理完成' },
    };
    if (result.videoUrl) {
      patch.videoUrl = result.videoUrl;
      patch.videoUrls = [result.videoUrl];
      patch.directVideoUrl = result.directVideoUrl || result.videoUrl;
      patch.directVideoUrls = [result.directVideoUrl || result.videoUrl];
      patch.fileName = result.fileName;
      patch.fileSize = result.size || 0;
      patch.mime = result.mime || 'video/mp4';
      patch.output = {
        videoUrl: result.videoUrl,
        directVideoUrl: result.directVideoUrl || result.videoUrl,
        name: result.fileName,
        duration: result.duration,
        width: result.width,
        height: result.height,
        size: result.size,
      };
    }
    if (result.audioUrl) {
      patch.audioUrl = result.audioUrl;
      patch.audioUrls = [result.audioUrl];
      patch.directAudioUrl = result.directAudioUrl || result.audioUrl;
      patch.directAudioUrls = [result.directAudioUrl || result.audioUrl];
      patch.audioFileName = result.audioFileName || fileNameFromUrl(result.audioUrl);
      patch.audioFileSize = result.audioSize || 0;
      patch.audioMime = result.audioMime || 'audio/mpeg';
    }
    if (result.videoUrl || result.audioUrl) {
      patch.outputVersions = pushVideoEditOutputVersion(
        (rf.getNode(id)?.data as any)?.outputVersions || d.outputVersions,
        {
          videoUrl: result.videoUrl || '',
          directVideoUrl: result.directVideoUrl || result.videoUrl || '',
          audioUrl: result.audioUrl || '',
          directAudioUrl: result.directAudioUrl || result.audioUrl || '',
          name: result.fileName || fileNameFromUrl(result.videoUrl || result.audioUrl || ''),
          audioName: result.audioFileName || '',
          duration: result.duration,
          width: result.width,
          height: result.height,
          size: result.size,
          audioSize: result.audioSize,
          label: result.videoUrl && result.audioUrl ? '无声+音频' : result.audioUrl ? '提取音频' : '无声视频',
          jobId: result.jobId,
        },
        settings,
      );
    }
    update(patch);
    if (settings.autoCreateOutputNode && (result.videoUrl || result.audioUrl)) {
      const nextVersions = normalizeVideoEditOutputVersions(patch.outputVersions);
      if (nextVersions[0]) {
        if (result.videoUrl) addOutputNodeFromVersion(nextVersions[0], 'video');
        if (result.audioUrl) addOutputNodeFromVersion(nextVersions[0], 'audio');
      }
    }
  };

  const pollComposeJob = async (jobId: string, token: number) => {
    try {
      for (;;) {
        await wait(900);
        if (pollTokenRef.current !== token) return;
        const job = await getVideoEditJob(jobId);
        if (pollTokenRef.current !== token) return;
        update({
          status: job.status === 'done' ? 'success' : job.status,
          error: job.error || '',
          job: {
            id: job.id,
            status: job.status,
            progress: job.progress,
            message: job.message,
          },
        });
        if (job.status === 'done') {
          if (job.result) {
            if (isSeparateAudioResult(job.result)) applySeparateResult(job.result);
            else applyComposeResult(job.result);
          }
          setBusy('');
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
          const message = job.error || job.message || (job.status === 'cancelled' ? '视频合成已取消' : '视频合成失败');
          setLocalError(message);
          setBusy('');
          return;
        }
      }
    } catch (error: any) {
      const message = error?.message || '读取合成进度失败';
      setLocalError(message);
      update({ status: 'error', error: message, job: { id: jobId, status: 'failed', progress: 0, message } });
      setBusy('');
    }
  };

  const buildVideoOperationEvidence = (
    execution: SecondaryProviderActionExecution,
    inputDigest: string,
    operationIndex: number,
  ): VideoOperationExecutionEvidence => {
    const { reporter, action } = execution;
    const context = reporter.runContext;
    if (!context || !reporter.nodeRunId || !reporter.attemptId) {
      throw new Error('视频任务缺少持久 Run/NodeRun/Attempt identity，已停止本地合成');
    }
    if (action.actionId !== 'video-edit.compose' && action.actionId !== 'video-edit.platform-export') {
      throw new Error('视频任务 action 不在执行白名单内');
    }
    return {
      schema: 't8-video-operation-execution-v1',
      projectId: context.projectId,
      canvasId: context.canvasId,
      runId: context.runId,
      nodeRunId: reporter.nodeRunId,
      attemptId: reporter.attemptId,
      nodeId: id,
      requestId: action.requestId,
      actionId: action.actionId,
      actionTarget: action.target,
      actionDigest: action.digest,
      inputDigest,
      operationIndex,
    };
  };

  const awaitVideoOperationTerminal = async (input: {
    jobId: string;
    label: string;
    operationIndex: number;
    operationCount: number;
    token: number;
    reporter: RunNodeLifecycleReporter;
  }): Promise<VideoComposeResult> => {
    for (;;) {
      await wait(900);
      if (pollTokenRef.current !== input.token || isRunExecutionCancelled(input.reporter.executionToken)) {
        await cancelVideoEditJob(input.jobId).catch(() => undefined);
        throw new Error('视频任务已取消');
      }
      const status = await getVideoEditJob(input.jobId);
      const overallProgress = Math.min(99, Math.round(
        (input.operationIndex / input.operationCount) * 100 + (status.progress || 0) / input.operationCount,
      ));
      const trace = {
        provider: 'local-video-ops',
        model: 'ffmpeg-compose',
        upstreamTaskId: input.jobId,
        requestId: input.reporter.runContext?.requestId || undefined,
        operationIndex: input.operationIndex,
        operationCount: input.operationCount,
        progress: status.progress,
        status: status.status,
        message: status.message,
      };
      await input.reporter.providerPolling(trace);
      await input.reporter.progress({ phase: 'video-ops-polling', ...trace, progress: overallProgress });
      update({
        status: 'running',
        error: '',
        job: {
          id: status.id,
          status: status.status,
          progress: overallProgress,
          message: `${input.label} · ${status.message || status.status}`,
        },
      });
      if (status.status === 'done') {
        if (!status.result?.videoUrl) throw new Error(`${input.label} 没有返回视频结果`);
        await input.reporter.providerResponse({ ...trace, status: 'succeeded' });
        return status.result;
      }
      if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'interrupted') {
        const message = status.error || status.message || `${input.label} 失败`;
        await input.reporter.providerResponse({ ...trace, status: status.status, error: { message } });
        throw new Error(message);
      }
    }
  };

  const executeAuthorizedVideoEditAction = async (execution: SecondaryProviderActionExecution) => {
    const { action, reporter } = execution;
    if (action.actionId !== 'video-edit.compose' && action.actionId !== 'video-edit.platform-export') {
      throw new Error('视频编辑器收到不支持的 action');
    }
    const snapshot = pendingVideoExecutionInputsRef.current.get(action.requestId);
    if (!snapshot || !videoEditExecutionInputMatchesDigest(snapshot, action.params.inputDigest)) {
      throw new Error('视频任务输入快照缺失或摘要不匹配，已停止本地合成');
    }
    const expectedMode = action.actionId === 'video-edit.compose' ? 'compose' : 'platform-export';
    if (snapshot.mode !== expectedMode
      || JSON.stringify(snapshot.packageIds) !== JSON.stringify(action.params.packageIds)) {
      throw new Error('视频任务 action 与不可篡改输入快照不一致');
    }

    const token = pollTokenRef.current + 1;
    pollTokenRef.current = token;
    const packages = VIDEO_EDIT_PLATFORM_EXPORT_PACKAGES.filter((pkg) => snapshot.packageIds.includes(pkg.id));
    const operationCount = expectedMode === 'compose' ? 1 : packages.length;
    if (operationCount !== action.params.operationCount) throw new Error('视频任务 operation 数量已变化');
    setBusy(expectedMode);
    setLocalError('');
    setPlatformExportStatus(expectedMode === 'platform-export' ? `套餐队列 0/${operationCount}` : '');
    update({ status: 'running', error: '', job: { status: 'running', progress: 1, message: '等待持久执行证据' } });

    let activeJobId = '';
    const submit = async (operationIndex: number, label: string, operationSettings: VideoEditSettings) => {
      const evidence = buildVideoOperationEvidence(execution, action.params.inputDigest, operationIndex);
      await reporter.providerRequest({
        provider: 'local-video-ops',
        model: 'ffmpeg-compose',
        requestId: action.requestId,
        actionId: action.actionId,
        actionDigest: action.digest,
        inputDigest: action.params.inputDigest,
        operationIndex,
        operationCount,
      });
      const job = await composeVideoEditAsync(snapshot.clips, operationSettings, {
        timelineV2: snapshot.timelineV2,
        renderPlan: snapshot.renderPlan,
        executionEvidence: evidence,
        executionInput: snapshot,
      });
      activeJobId = job.id;
      try {
        await reporter.providerSubmitted({
          provider: 'local-video-ops',
          model: 'ffmpeg-compose',
          upstreamTaskId: job.id,
          requestId: action.requestId,
          actionDigest: action.digest,
          inputDigest: action.params.inputDigest,
          operationIndex,
          operationCount,
          status: job.status,
        });
      } catch (error) {
        await cancelVideoEditJob(job.id).catch(() => undefined);
        throw error;
      }
      update({ status: 'running', error: '', job: { id: job.id, status: job.status, progress: job.progress || 2, message: job.message || label } });
      return awaitVideoOperationTerminal({ jobId: job.id, label, operationIndex, operationCount, token, reporter });
    };

    try {
      if (expectedMode === 'compose') {
        const result = await submit(0, '视频合成', snapshot.settings);
        await reporter.output({
          status: 'succeeded',
          outputCount: 1,
          inputDigest: action.params.inputDigest,
          assets: [{
            kind: 'video',
            sourceUrl: result.videoUrl,
            filename: result.fileName,
            mimeType: result.mime || 'video/mp4',
            metadata: { jobId: result.jobId, actionDigest: action.digest, inputDigest: action.params.inputDigest },
          }],
        });
        applyComposeResult(result, snapshot.settings);
        return;
      }

      let versions = normalizeVideoEditOutputVersions((rf.getNode(id)?.data as any)?.outputVersions || d.outputVersions);
      const platformResults: Array<{ result: VideoComposeResult; label: string; packageId: string; settings: VideoEditSettings }> = [];
      const failures: string[] = [];
      for (const [index, pkg] of packages.entries()) {
        if (pollTokenRef.current !== token || isRunExecutionCancelled(reporter.executionToken)) throw new Error('视频任务已取消');
        const packageSettings = snapshot.operationSettings[index];
        if (!packageSettings) throw new Error(`${pkg.label} 缺少已确认的规格设置`);
        setPlatformExportStatus(`套餐队列 ${index + 1}/${packages.length} · ${pkg.label}`);
        try {
          const result = await submit(index, `多规格导出 · ${pkg.label}`, packageSettings);
          platformResults.push({ result, label: pkg.label, packageId: pkg.id, settings: packageSettings });
          versions = pushVideoEditOutputVersion(versions, {
            videoUrl: result.videoUrl,
            directVideoUrl: result.directVideoUrl || result.videoUrl,
            name: result.fileName,
            duration: result.duration,
            width: result.width,
            height: result.height,
            size: result.size,
            label: `套餐 ${pkg.label}`,
            jobId: result.jobId,
          }, packageSettings);
        } catch (error: any) {
          if (isRunExecutionCancelled(reporter.executionToken) || pollTokenRef.current !== token) throw error;
          failures.push(`${pkg.label}: ${error?.message || '导出失败'}`);
        }
      }
      if (!platformResults.length) throw new Error(failures.length ? `套餐导出失败：${failures.join('；')}` : '没有生成任何套餐结果');

      await reporter.output({
        status: 'succeeded',
        outputCount: platformResults.length,
        inputDigest: action.params.inputDigest,
        assets: platformResults.map(({ result, label, packageId }) => ({
          kind: 'video',
          sourceUrl: result.videoUrl,
          filename: result.fileName,
          mimeType: result.mime || 'video/mp4',
          metadata: { jobId: result.jobId, packageId, label, actionDigest: action.digest, inputDigest: action.params.inputDigest },
        })),
      });
      const finalResults = platformResults.filter((item) => item.packageId !== 'draft-preview');
      const downstream = finalResults.length ? finalResults : platformResults;
      const latest = downstream[downstream.length - 1].result;
      const warning = failures.length ? `部分套餐失败：${failures.join('；')}` : '';
      update({
        status: 'success',
        error: warning,
        videoUrl: latest.videoUrl,
        videoUrls: downstream.map((item) => item.result.videoUrl),
        directVideoUrl: latest.directVideoUrl || latest.videoUrl,
        directVideoUrls: downstream.map((item) => item.result.directVideoUrl || item.result.videoUrl),
        draftVideoUrls: platformResults.filter((item) => item.packageId === 'draft-preview').map((item) => item.result.videoUrl),
        directDraftVideoUrls: platformResults.filter((item) => item.packageId === 'draft-preview').map((item) => item.result.directVideoUrl || item.result.videoUrl),
        fileName: latest.fileName,
        fileSize: latest.size || 0,
        mime: latest.mime || 'video/mp4',
        output: { videoUrl: latest.videoUrl, directVideoUrl: latest.directVideoUrl || latest.videoUrl, name: latest.fileName, duration: latest.duration, width: latest.width, height: latest.height, size: latest.size },
        outputVersions: versions,
        job: { id: activeJobId, status: 'done', progress: 100, message: warning || `多规格导出完成：${platformResults.length}/${packages.length}` },
      });
      if (snapshot.settings.autoCreateOutputNode) {
        const createdVersions = normalizeVideoEditOutputVersions(versions);
        for (let index = 0; index < Math.min(platformResults.length, createdVersions.length); index += 1) {
          addOutputNodeFromVersion(createdVersions[index], 'video');
        }
      }
      setLocalError(warning);
    } catch (error: any) {
      const message = error?.message || '视频任务执行失败';
      setLocalError(message);
      update({ status: 'error', error: message, job: { id: activeJobId || undefined, status: 'failed', progress: 0, message } });
      throw error;
    } finally {
      setBusy('');
      setPlatformExportStatus('');
    }
  };

  executeAuthorizedVideoEditActionRef.current = executeAuthorizedVideoEditAction;

  useEffect(() => {
    const unregister = [
      registerSecondaryProviderActionExecutor(id, 'video-edit.compose', 'compose', (execution) => executeAuthorizedVideoEditActionRef.current(execution)),
      registerSecondaryProviderActionExecutor(id, 'video-edit.platform-export', 'platform-export', (execution) => executeAuthorizedVideoEditActionRef.current(execution)),
    ];
    return () => {
      unregister.reverse().forEach((dispose) => dispose());
      pendingVideoExecutionInputsRef.current.clear();
    };
  }, [id]);

  const handleCompose = async () => {
    if (composeBlockedMessage) {
      setLocalError(composeBlockedMessage);
      return;
    }
    try {
      const snapshot = createVideoEditExecutionInputSnapshot({
        mode: 'compose',
        clips: timelineComposeClips,
        settings,
        timelineV2,
        renderPlan: timelineRenderPlan,
        operationSettings: [settings],
      });
      const inputDigest = videoEditExecutionInputDigest(snapshot);
      const action = queueSecondaryAction({
        actionId: 'video-edit.compose',
        target: 'compose',
        params: { inputDigest, packageIds: [], operationCount: 1 },
      });
      pendingVideoExecutionInputsRef.current.set(action.requestId, snapshot);
      setLocalError('');
    } catch (error: any) {
      const message = error?.message || '无法创建视频合成执行请求';
      setLocalError(message);
    }
  };

  const togglePlatformPackage = (packageId: string) => {
    setSelectedPlatformPackageIds((current) => (
      current.includes(packageId)
        ? current.filter((item) => item !== packageId)
        : [...current, packageId]
    ));
  };

  const handleBatchPlatformExport = async () => {
    if (composeBlockedMessage) {
      setLocalError(composeBlockedMessage);
      return;
    }
    const packages = VIDEO_EDIT_PLATFORM_EXPORT_PACKAGES.filter((pkg) => selectedPlatformPackageIds.includes(pkg.id));
    if (!packages.length) {
      setLocalError('请至少选择一个导出套餐');
      return;
    }
    try {
      const packageIds = packages.map((pkg) => pkg.id);
      const operationSettings = packages.map((pkg) => normalizeVideoEditSettings(applyVideoEditOutputPreset({
        ...settings,
        aspect: pkg.aspect,
        resolution: pkg.resolution,
      }, pkg.presetId || 'custom')));
      const snapshot = createVideoEditExecutionInputSnapshot({
        mode: 'platform-export',
        clips: timelineComposeClips,
        settings,
        timelineV2,
        renderPlan: timelineRenderPlan,
        packageIds,
        operationSettings,
      });
      const inputDigest = videoEditExecutionInputDigest(snapshot);
      const action = queueSecondaryAction({
        actionId: 'video-edit.platform-export',
        target: 'platform-export',
        params: { inputDigest, packageIds, operationCount: packageIds.length },
      });
      pendingVideoExecutionInputsRef.current.set(action.requestId, snapshot);
      setLocalError('');
    } catch (error: any) {
      setLocalError(error?.message || '无法创建多规格导出执行请求');
    }
  };

  const exportVideoEditRecipe = () => {
    if (!clips.length) {
      setLocalError('没有可导出的剪辑片段');
      return;
    }
    const recipe = buildVideoEditRecipe({ clips, settings, timelineV2, renderPlan: timelineRenderPlan });
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `video-edit-${Date.now()}.t8-video-edit.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setLocalError('');
  };

  const importVideoEditRecipe = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const recipe = normalizeVideoEditRecipe(parsed);
      if (!recipe) {
        setLocalError('不是有效的视频剪辑配方卡');
        return;
      }
      if (!recipe.clips.length) {
        setLocalError('配方卡里没有剪辑片段');
        return;
      }
      const missing = findVideoEditRecipeMissingAssets(recipe);
      const message = missing.length
        ? `已导入配方卡，缺素材 ${missing.length} 个，请重新绑定后再合成`
        : '';
      setLocalError(message);
      const recipeTimelinePatch = recipe.timelineV2 ? { timelineV2: recipe.timelineV2 } : {};
      commitClips(recipe.clips, {
        selectedClipId: recipe.clips[0]?.id || '',
        settings: recipe.settings,
        status: recipe.clips.length ? 'ready' : 'idle',
        error: message,
        ...recipeTimelinePatch,
      });
    } catch (error: any) {
      setLocalError(error?.message || '导入配方卡失败');
    }
  };

  const handleCancelCompose = async () => {
    const jobId = String(d.job?.id || '');
    pollTokenRef.current += 1;
    setBusy('');
    if (!jobId) {
      update({ status: 'cancelled', job: { status: 'cancelled', progress: Number(d.job?.progress || 0), message: '已取消' } });
      return;
    }
    try {
      const job = await cancelVideoEditJob(jobId);
      update({ status: 'cancelled', error: '', job: { id: job.id, status: 'cancelled', progress: job.progress || Number(d.job?.progress || 0), message: job.message || '已取消' } });
      setLocalError('视频合成已取消');
    } catch (error: any) {
      const message = error?.message || '取消合成失败';
      setLocalError(message);
    }
  };

  const handleSeparateAudio = async (mode: 'audio-only' | 'mute-video' | 'both') => {
    if (!timelineComposeClips.length || running || busy === 'upload') return;
    if ((mode === 'audio-only' || mode === 'both') && !hasPotentialAudio) {
      setLocalError('当前片段没有可提取的音频');
      return;
    }
    setBusy('separate-audio');
    setLocalError('');
    update({ status: 'running', error: '', job: { status: 'running', progress: 3, message: mode === 'mute-video' ? '准备导出无声视频' : '准备处理音频' } });
    try {
      const job = await separateVideoAudioAsync(timelineComposeClips, settings, mode, { timelineV2, renderPlan: timelineRenderPlan });
      const token = pollTokenRef.current + 1;
      pollTokenRef.current = token;
      update({ status: 'running', error: '', job: { id: job.id, status: job.status, progress: job.progress || 5, message: job.message || '音频处理中' } });
      void pollComposeJob(job.id, token);
    } catch (error: any) {
      const message = error?.message || '音频处理失败';
      setLocalError(message);
      update({ status: 'error', error: message, job: { status: 'failed', progress: 0, message } });
      setBusy('');
    }
  };

  const renderTimelineItemTrimHandles = (item?: VideoEditTimelineItem) => {
    if (!item) return null;
    const disabled = running || !!busy || isTimelineItemLocked(item);
    return (
      <>
        <span
          data-video-edit-track-item-trim-handle="start"
          data-video-edit-track-item-trim-locked={isTimelineItemLocked(item) ? 'true' : undefined}
          role="slider"
          tabIndex={0}
          aria-label="拖动裁剪条目入点"
          aria-disabled={disabled}
          className={`nodrag nopan nowheel absolute bottom-1 left-0 top-1 z-20 w-3 cursor-ew-resize select-none rounded-l-lg border-l-2 border-cyan-200 bg-cyan-300/20 ${disabled ? 'pointer-events-none opacity-50' : 'hover:bg-cyan-300/45'}`}
          title={isTimelineItemLocked(item) ? '轨道已锁定，先解锁后再裁剪' : '拖动裁剪入点'}
          onMouseDownCapture={(event) => beginTimelineItemTrimMouseMove(event, item, 'start')}
          onPointerDownCapture={(event) => beginTimelineItemTrimMove(event, item, 'start')}
        />
        <span
          data-video-edit-track-item-trim-handle="end"
          data-video-edit-track-item-trim-locked={isTimelineItemLocked(item) ? 'true' : undefined}
          role="slider"
          tabIndex={0}
          aria-label="拖动裁剪条目出点"
          aria-disabled={disabled}
          className={`nodrag nopan nowheel absolute bottom-1 right-0 top-1 z-20 w-3 cursor-ew-resize select-none rounded-r-lg border-r-2 border-cyan-200 bg-cyan-300/20 ${disabled ? 'pointer-events-none opacity-50' : 'hover:bg-cyan-300/45'}`}
          title={isTimelineItemLocked(item) ? '轨道已锁定，先解锁后再裁剪' : '拖动裁剪出点'}
          onMouseDownCapture={(event) => beginTimelineItemTrimMouseMove(event, item, 'end')}
          onPointerDownCapture={(event) => beginTimelineItemTrimMove(event, item, 'end')}
        />
      </>
    );
  };

  return (
    <VideoEditVisible>
    <>
    <div
      data-video-edit-node-theme-surface="solid"
      data-video-edit-node-fit="single-screen"
      data-video-edit-node-handle-clearance="inset-visible"
      className={`t8-node relative h-[744px] min-w-[1120px] max-w-[1120px] overflow-visible rounded-xl ${selected ? 'ring-2 ring-cyan-300' : ''}`}
      style={videoEditSolidStyle}
    >
      <Handle type="target" position={Position.Left} className="!left-3 !z-40 !h-4 !w-4" />
      <Handle type="source" position={Position.Right} className="!right-3 !z-40 !h-4 !w-4" />

      <header className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3" style={videoEditMutedStyle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cyan-100 text-cyan-700">
            <Film size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-bold">
              <span>视频剪辑</span>
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold">{status === 'success' ? '已生成' : clips.length ? '可合成' : '待导入'}</span>
            </div>
            <div className="text-xs" style={{ color: 'var(--t8-text-muted)' }}>
              {clips.length} 段 · 总时长 {formatSeconds(totalDuration)} · 体检 {timelineHealth.label} · 轻量拼接 / 裁短 / 转场 / 滤镜
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            title="上传视频"
            type="button"
            className="t8-mini-icon-button nodrag nopan"
            onPointerDown={stopNodePointer}
            onMouseDown={stopNodeMouse}
            onClick={openVideoFilePicker}
            disabled={!!busy}
          >
            <UploadCloud size={16} />
          </button>
          <button
            title="导入上游视频"
            type="button"
            className="t8-mini-icon-button nodrag nopan"
            onPointerDown={stopNodePointer}
            onMouseDown={stopNodeMouse}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void importUpstream();
            }}
            disabled={!!busy}
          >
            <Plus size={16} />
          </button>
          <button
            title="清空片段"
            type="button"
            className="t8-mini-icon-button nodrag nopan"
            onPointerDown={stopNodePointer}
            onMouseDown={stopNodeMouse}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              commitClips([], { status: 'idle', output: undefined, videoUrl: '', videoUrls: [] });
            }}
            disabled={!!busy || clips.length === 0}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="hidden nodrag nopan"
          type="file"
          accept="video/*,.mp4,.webm,.mov,.m4v,.mkv"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            void uploadFiles(files);
          }}
        />
        <input
          ref={audioTrackInputRef}
          data-video-edit-audio-track-input="true"
          className="hidden nodrag nopan"
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            void handleAudioTrackUpload(files);
          }}
        />
        <input
          ref={recipeInputRef}
          className="hidden nodrag nopan"
          type="file"
          accept=".json,.t8-video-edit.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importVideoEditRecipe(file);
          }}
        />
        <input
          ref={replacementInputRef}
          className="hidden nodrag nopan"
          type="file"
          accept="video/*,.mp4,.webm,.mov,.m4v,.mkv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void replaceClipAsset(file);
          }}
        />
      </header>

      <div
        data-video-edit-node-layout="wide-console"
        data-video-edit-node-stack="screen-first"
        className="grid h-[652px] grid-rows-[minmax(260px,1fr)_38px_144px_158px] gap-2 overflow-hidden p-3"
      >
        <section
          data-video-edit-preview-screen="true"
          className="nodrag min-h-0 rounded-lg border border-dashed border-cyan-300 bg-black/85 p-2"
          onDragStartCapture={preventNativeMediaDrag}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void uploadFiles(Array.from(event.dataTransfer.files || []));
          }}
        >
          <div data-video-edit-preview-body="fit-row" className="relative h-full min-h-0 overflow-hidden rounded-md bg-black">
            {selectedClip?.url ? (
              <video
                ref={previewVideoRef}
                data-video-edit-preview-mode="timeline-playhead"
                data-video-edit-preview-source-item-id={timelinePlayback.item?.id || ''}
                data-video-edit-preview-source-clip-id={selectedClip.sourceClipId || selectedClip.id || ''}
                data-video-edit-preview-source-time={timelinePlayback.sourceTime}
                data-video-edit-preview-timeline-time={timelinePlayback.timelineTime}
                data-video-edit-preview-source-audio-active={activePreviewSourceAudioSegment ? 'true' : 'false'}
                data-video-edit-preview-main-muted="true"
                data-video-edit-preview-main-volume="0"
                data-video-edit-preview-filter={settings.filter}
                data-video-edit-preview-filter-active={previewFilterCss ? 'true' : 'false'}
                className="h-full w-full object-contain"
                style={previewVideoStyle}
                src={selectedClip.url}
                controls
                muted
                draggable={false}
                preload="metadata"
                onPointerDown={stopNodePointer}
                onDragStart={preventNativeMediaDrag}
                onLoadedMetadata={handlePreviewLoadedMetadata}
                onPlay={playSelectedClipPreview}
                onPause={() => syncActivePreviewMedia('pause')}
                onSeeked={() => syncActivePreviewMedia()}
                onTimeUpdate={handlePreviewTimeUpdate}
              />
            ) : outputUrl ? (
              <video className="h-full w-full object-contain" src={outputUrl} controls draggable={false} preload="metadata" onPointerDown={stopNodePointer} onDragStart={preventNativeMediaDrag} />
            ) : (
              <div
                role="button"
                tabIndex={0}
                className="grid h-full cursor-pointer place-items-center text-sm text-white/70"
                onClick={handleEmptyPreviewActivate}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') handleEmptyPreviewActivate(event);
                }}
              >
                上传或导入视频
              </div>
            )}
            <VideoEditPreviewTransitionBadge transition={activePreviewTransition} />
            {(snapshotNotice || d.coverImageUrl) && (
              <div
                data-video-edit-cover-preview="true"
                data-video-edit-cover-preview-layout="preview-overlay"
                className="pointer-events-none absolute left-2 top-2 z-10 flex h-8 max-w-[320px] items-center gap-2 rounded-lg border px-2 py-1 text-[11px] shadow"
                style={videoEditMutedStyle}
              >
                {d.coverImageUrl ? (
                  <img src={String(d.coverImageUrl)} alt="视频封面帧" className="h-6 w-10 rounded object-cover" draggable={false} onDragStart={preventNativeMediaDrag} />
                ) : (
                  <Camera size={13} />
                )}
                <span className="min-w-0 flex-1 truncate font-semibold">{snapshotNotice || '封面帧已设置'}</span>
                {d.coverFrameTime ? <span className="shrink-0" style={{ color: 'var(--t8-text-muted)' }}>{formatSeconds(Number(d.coverFrameTime))}</span> : null}
              </div>
            )}
          </div>
        </section>

        <section
          data-video-edit-quick-actions="true"
          data-video-edit-action-row="centered"
          data-video-edit-workbench-entry-enabled={VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED ? 'true' : 'false'}
          className={`grid gap-2 rounded-lg border px-2 py-1 text-xs ${VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}
          style={videoEditPanelStyle}
        >
          <button className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none" onClick={openVideoFilePicker} disabled={!!busy}>
            <UploadCloud size={14} />
            上传视频
          </button>
          <button className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none" onClick={() => void importUpstream()} disabled={!!busy}>
            <Plus size={14} />
            导入上游
          </button>
          {VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED && (
            <button
              data-video-edit-open-workbench="true"
              className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none"
              onClick={() => setWorkbenchOpen(true)}
              disabled={!!busy && busy !== 'compose' && busy !== 'separate-audio'}
            >
              <Film size={14} />
              打开剪辑台
            </button>
          )}
          <button className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none" onClick={handleCompose} disabled={!canCompose || !!busy}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            {running ? '合成中' : '合成视频'}
          </button>
          {outputUrl ? (
            <a className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none" href={outputUrl} download={String(d.fileName || 'video-edit.mp4')}>
              <Download size={14} />
              下载成片
            </a>
          ) : (
            <button className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none" onClick={() => void handleSnapshotFrame('cover')} disabled={!selectedClip || !!busy}>
              <Camera size={14} />
              封面帧
            </button>
          )}
          <button className="t8-secondary-button nodrag inline-flex h-8 items-center justify-center gap-1.5 leading-none" onClick={handleCancelCompose} disabled={!running}>
            <X size={14} />
            取消
          </button>
        </section>

        <section
          data-video-edit-node-timeline="duration-track"
          data-video-edit-timeline-placement="between-actions-and-settings"
          data-video-edit-timeline-adaptive="duration-flex"
          data-video-edit-timeline-track="full-height"
          className="min-h-0 overflow-hidden rounded-lg border px-2 py-2"
          style={videoEditMutedStyle}
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold">
            <span>Playlist 时间线</span>
            <div className="flex items-center gap-1">
              <span>{clips.length > compactTimelineClips.length ? `显示 ${compactTimelineClips.length}/${clips.length}` : clips.length ? `${clips.length} 段` : '暂无片段'}</span>
              {[1, 2, 4].map((zoom) => (
                <button
                  key={zoom}
                  className={`t8-mini-button nodrag h-5 px-1.5 py-0 text-[10px] leading-none ${timelineZoom === zoom ? 'is-active' : ''}`}
                  onClick={() => setTimelineZoom(zoom)}
                >
                  {zoom}x
                </button>
              ))}
            </div>
          </div>
          <div className="relative h-[96px] overflow-x-auto rounded-md border bg-black/15 p-1" style={{ borderColor: 'var(--t8-border)' }}>
            {compactTimelineClips.length ? (
              <div className="flex h-full min-w-full items-stretch gap-1">
                {compactTimelineClips.map((clip, index) => {
                  const realIndex = clips.findIndex((item) => item.id === clip.id);
                  const active = selectedClip?.id === clip.id;
                  const timelineItem = findTimelineVideoItemForClip(clip);
                  const clipForTimeline = buildNodeTimelinePresentationClip(clip, timelineItem);
                  const health = videoEditClipHealth(clipForTimeline, settings);
                  const duration = videoEditClipDuration(clipForTimeline);
                  const measuredDuration = duration > 0.25 ? duration : Number(clip.duration || clip.trimEnd || 0);
                  const layoutDuration = Math.max(1, measuredDuration > 0.25 ? measuredDuration : 5);
                  const basis = Math.max(96, Math.min(320, Math.round((layoutDuration / Math.max(1, totalDuration)) * 940 * timelineZoom)));
                  const trimVisual = buildVideoEditTrimmedCardVisual(clipForTimeline);
                  const { sourceDuration, trimStart, trimEnd } = trimVisual;
                  return (
                    <div
                      key={clip.id}
                      data-video-edit-node-timeline-card="true"
                      role="button"
                      tabIndex={0}
                      title={`${health.reason} · ${formatSeconds(duration)}`}
                      style={{
                        flexGrow: layoutDuration,
                        flexBasis: `${basis}px`,
                        background: 'var(--t8-video-edit-card)',
                      }}
                      draggable={false}
                      onDragStart={preventNativeMediaDrag}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleTimelineDrop(event, clip.id)}
                      onClick={() => selectNodeTimelineClip(clip)}
                      onKeyDown={(event) => handleWorkbenchClipCardKeyDown(event, clip.id)}
                      onPointerMove={handleTimelineTrimPointerMove}
                      onPointerUp={finishTimelineTrimDrag}
                      onPointerCancel={finishTimelineTrimDrag}
                      className={`nodrag nopan nowheel group relative flex h-full min-w-[96px] select-none flex-col overflow-hidden rounded-md border text-left text-[10px] ${active ? 'border-cyan-400 ring-1 ring-cyan-300' : ''}`}
                    >
                      <span className="relative block min-h-0 flex-1 overflow-hidden">
                        {clipForTimeline.thumbnailUrl ? (
                          <>
                            <img data-video-edit-trim-thumbnail-mask="true" data-video-edit-trim-thumbnail-mask-mode="hidden-outside-trim" className="absolute inset-0 h-full w-full object-cover opacity-0" src={clipForTimeline.thumbnailUrl} alt="" aria-hidden="true" draggable={false} onDragStart={preventNativeMediaDrag} />
                            <span
                              data-video-edit-trim-thumbnail-window="true"
                              data-video-edit-trim-thumbnail-window-mode="trim-range-sync"
                              data-video-edit-trim-window-space="trimmed-card"
                              className="absolute inset-y-0 overflow-hidden rounded-sm ring-1 ring-cyan-300/70"
                              style={trimVisual.trimmedWindowThumbnailStyle}
                            >
                              <img
                                data-video-edit-trim-thumbnail-active="true"
                                className="absolute inset-y-0 h-full object-cover opacity-85"
                                style={trimVisual.activeThumbnailStyle}
                                src={clipForTimeline.thumbnailUrl}
                                alt={clipForTimeline.name}
                                draggable={false}
                                onDragStart={preventNativeMediaDrag}
                              />
                            </span>
                          </>
                        ) : clipForTimeline.url ? (
                          <video
                            className="absolute inset-0 h-full w-full object-cover opacity-80"
                            src={clipForTimeline.url}
                            muted
                            playsInline
                            preload="metadata"
                            draggable={false}
                            onDragStart={preventNativeMediaDrag}
                            onLoadedMetadata={(event) => patchClipVideoElementMetadata(clip.id, event.currentTarget)}
                          />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center bg-black/20 opacity-60"><Film size={16} /></span>
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-semibold text-white">#{realIndex >= 0 ? realIndex + 1 : index + 1}</span>
                        <span data-video-edit-clip-actions-placement="top-right" className="absolute right-1 top-1 flex items-center gap-1 opacity-95">
                          <button
                            type="button"
                            data-video-edit-clip-action="mute"
                            className={`nodrag grid h-5 w-5 place-items-center rounded-full border text-white shadow ${clip.muted ? 'bg-amber-500/90' : 'bg-black/65'}`}
                            title={clip.muted ? '取消此片段静音' : '静音此片段'}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); toggleClipMuted(clip.id); }}
                          >
                            {clip.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                          </button>
                          <button
                            type="button"
                            data-video-edit-clip-action="delete"
                            className="nodrag grid h-5 w-5 place-items-center rounded-full border bg-black/65 text-white shadow hover:bg-red-600"
                            title="删除此片段"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); removeClip(clip.id); }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                        <span className={`absolute left-1 bottom-1 h-2 w-2 rounded-full ${healthDotClass(health.level)}`} />
                        <span data-video-edit-clip-duration-placement="bottom-right" className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-semibold text-white">{formatSeconds(duration)}</span>
                      </span>
                      <span
                        data-video-edit-trim-track="true"
                        data-video-edit-node-trim-track="compact"
                        data-video-edit-node-trim-placement="below-preview"
                        className="nodrag nopan nowheel relative mx-2 mb-1 mt-1 h-3 shrink-0 cursor-ew-resize select-none rounded-full bg-black/55 ring-1 ring-white/20"
                        style={trimVisual.trackStyle}
                        onDragStartCapture={preventNativeMediaDrag}
                        onMouseDownCapture={(event) => { selectNodeTimelineClip(clip); beginTimelineTrimTrackMouseDrag(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem?.id); }}
                        onMouseMoveCapture={(event) => continueOrStartTimelineTrimTrackMouseDrag(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem?.id)}
                        onPointerDownCapture={(event) => { selectNodeTimelineClip(clip); beginTimelineTrimTrackDrag(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem?.id); }}
                        onPointerMoveCapture={(event) => continueOrStartTimelineTrimTrackDrag(event, clipForTimeline, trimVisual, 'trimmed-window', timelineItem?.id)}
                      >
                        <span
                          data-video-edit-node-trim-range="true"
                          className="absolute inset-y-0 rounded-full bg-cyan-300/45 ring-1 ring-cyan-200/70"
                          style={trimVisual.trimmedWindowRangeStyle}
                        />
                        <span
                          data-video-edit-trim-handle="start"
                          data-video-edit-node-trim-handle="start"
                          role="slider"
                          tabIndex={0}
                          aria-label={`拖动调整片段 ${realIndex >= 0 ? realIndex + 1 : index + 1} 入点`}
                          aria-valuemin={0}
                          aria-valuemax={Number(trimEnd.toFixed(2))}
                          aria-valuenow={Number(trimStart.toFixed(2))}
                          className="nodrag nopan nowheel absolute top-1/2 z-20 h-5 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize select-none rounded-full border border-cyan-100 bg-cyan-400 shadow"
                          style={trimVisual.trimmedWindowStartHandleStyle}
                          onMouseDownCapture={(event) => { selectNodeTimelineClip(clip); beginTimelineTrimMouseDrag(event, clipForTimeline, 'start', trimVisual.trackElement, 'trimmed-window', timelineItem?.id); }}
                          onPointerDownCapture={(event) => { selectNodeTimelineClip(clip); beginTimelineTrimDrag(event, clipForTimeline, 'start', trimVisual.trackElement, 'trimmed-window', timelineItem?.id); }}
                          title="拖动调整入点并预览"
                        />
                        <span
                          data-video-edit-trim-handle="end"
                          data-video-edit-node-trim-handle="end"
                          role="slider"
                          tabIndex={0}
                          aria-label={`拖动调整片段 ${realIndex >= 0 ? realIndex + 1 : index + 1} 出点`}
                          aria-valuemin={Number(trimStart.toFixed(2))}
                          aria-valuemax={Number(sourceDuration.toFixed(2))}
                          aria-valuenow={Number(trimEnd.toFixed(2))}
                          className="nodrag nopan nowheel absolute top-1/2 z-20 h-5 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize select-none rounded-full border border-cyan-100 bg-cyan-400 shadow"
                          style={trimVisual.trimmedWindowEndHandleStyle}
                          onMouseDownCapture={(event) => { selectNodeTimelineClip(clip); beginTimelineTrimMouseDrag(event, clipForTimeline, 'end', trimVisual.trackElement, 'trimmed-window', timelineItem?.id); }}
                          onPointerDownCapture={(event) => { selectNodeTimelineClip(clip); beginTimelineTrimDrag(event, clipForTimeline, 'end', trimVisual.trackElement, 'trimmed-window', timelineItem?.id); }}
                          title="拖动调整出点并预览"
                        />
                      </span>
                    </div>
                  );
                })}
                {VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED && clips.length > compactTimelineClips.length && (
                  <button className="t8-secondary-button nodrag h-14 min-w-[116px] justify-center text-[11px]" onClick={() => setWorkbenchOpen(true)}>
                    查看全部 {clips.length} 段
                  </button>
                )}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-[11px]" style={{ color: 'var(--t8-text-muted)' }}>上传后会在这里生成清晰片段轨道</div>
            )}
          </div>
        </section>

        <section
          data-video-edit-node-bottom-deck="true"
          data-video-edit-compact-lists="true"
          data-video-edit-compact-list-mode="selects"
          className="grid min-h-0 grid-cols-[220px_230px_minmax(280px,1fr)_270px] gap-2 overflow-hidden"
        >
          <div data-video-edit-current-clip-summary="true" className="min-h-0 overflow-hidden rounded-lg border px-2 py-1.5 text-[11px]" style={videoEditPanelStyle}>
            <div className="mb-1 flex items-center justify-between gap-2 font-semibold">
              <span>当前片段</span>
              <span style={{ color: 'var(--t8-text-muted)' }}>{selectedClip ? formatSeconds(videoEditClipDuration(selectedClip)) : '待选择'}</span>
            </div>
            {selectedClip ? (
              <>
                <div className="truncate font-semibold">{selectedClip.name}</div>
                <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                  <span>{selectedClip.width && selectedClip.height ? `${selectedClip.width}x${selectedClip.height}` : '待探测'}</span>
                  <span>{selectedClip.hasAudio === false ? '无声' : selectedClip.hasAudio === true ? '有声' : '音轨探测中'}</span>
                </div>
                <div className="mt-1 grid gap-1">
                  <label>
                    <FieldLabel>入点 {formatSeconds(selectedClip.trimStart)}</FieldLabel>
                    <input
                      className="nodrag nowheel h-3 w-full"
                      type="range"
                      min={0}
                      max={Math.max(1, selectedClip.duration || selectedClip.trimEnd || 1)}
                      step={0.1}
                      value={selectedClip.trimStart || 0}
                      onPointerDown={stopNodePointer}
                      onChange={(event) => handleTrimStartChange(selectedClip.id, Number(event.target.value))}
                      disabled={running || !!busy || selectedClipTimelineLocked}
                    />
                  </label>
                  <label>
                    <FieldLabel>出点 {formatSeconds(selectedClip.trimEnd || selectedClip.duration)}</FieldLabel>
                    <input
                      className="nodrag nowheel h-3 w-full"
                      type="range"
                      min={Math.min(selectedClip.trimStart + 0.1, selectedClip.duration || 1)}
                      max={Math.max(1, selectedClip.duration || selectedClip.trimEnd || 1)}
                      step={0.1}
                      value={selectedClip.trimEnd || selectedClip.duration || 1}
                      onPointerDown={stopNodePointer}
                      onChange={(event) => handleTrimEndChange(selectedClip.id, Number(event.target.value))}
                      disabled={running || !!busy || selectedClipTimelineLocked}
                    />
                  </label>
                </div>
              </>
            ) : (
              <div className="grid h-[72px] place-items-center rounded-md border border-dashed px-2 text-center" style={{ color: 'var(--t8-text-muted)' }}>点时间线片段后快速裁剪</div>
            )}
          </div>

          <div data-video-edit-option-list="presets" className="min-h-0 overflow-hidden rounded-lg border px-2 py-1.5 text-[11px]" style={videoEditPanelStyle}>
            <div className="mb-1 flex items-center justify-between gap-2 font-semibold">
              <span>输出</span>
              <span className={durationBudget.status === 'over' ? 'text-amber-700' : durationBudget.status === 'fit' ? 'text-emerald-700' : ''}>{durationBudget.label}</span>
            </div>
            <select
              className="t8-select nodrag h-7 w-full px-2 py-0 text-[11px]"
              value={settings.outputPreset || 'custom'}
              onChange={(event) => update({ settings: applyVideoEditOutputPreset(settings, event.target.value as any) })}
              disabled={running}
            >
              {VIDEO_EDIT_OUTPUT_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <select
                className="t8-select nodrag h-7 min-w-0 px-1 py-0 pr-7 text-[10px]"
                title={ASPECT_OPTIONS.find((item) => item.value === settings.aspect)?.label || '比例'}
                value={settings.aspect}
                onChange={(event) => patchSettings({ aspect: event.target.value as any })}
              >
                {COMPACT_ASPECT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select
                className="t8-select nodrag h-7 min-w-0 px-1 py-0 pr-7 text-[10px]"
                title={RESOLUTION_OPTIONS.find((item) => item.value === settings.resolution)?.label || '分辨率'}
                value={settings.resolution}
                onChange={(event) => patchSettings({ resolution: event.target.value as any })}
              >
                {COMPACT_RESOLUTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <input
                className="t8-input nodrag h-7 min-w-0 px-1 py-0 text-[10px]"
                type="number"
                min={0}
                max={3600}
                step={1}
                placeholder="时长"
                value={settings.targetDuration || ''}
                onChange={(event) => patchSettings({ targetDuration: Number(event.target.value) || 0 })}
              />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-2 py-0 text-[10px] leading-none" onClick={distributeToTargetDuration} disabled={!clips.length || !settings.targetDuration || running}>均分</button>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-2 py-0 text-[10px] leading-none" onClick={compressToTargetDuration} disabled={!clips.length || !settings.targetDuration || running}>压缩</button>
            </div>
          </div>

          <div data-video-edit-option-list="schemes" className="min-h-0 overflow-hidden rounded-lg border px-2 py-1.5 text-[11px]" style={videoEditPanelStyle}>
            <div className="mb-1 flex items-center justify-between gap-2 font-semibold">
              <span>方案</span>
              <span style={{ color: 'var(--t8-text-muted)' }}>{selectedPlatformPackageIds.length}/{VIDEO_EDIT_PLATFORM_EXPORT_PACKAGES.length}</span>
            </div>
            <div data-video-edit-scheme-list="true" className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1">
              <select
                className="t8-select nodrag h-7 min-w-0 px-2 py-0 text-[11px]"
                value={settings.creatorTemplate || 'manual'}
                onChange={(event) => update({ settings: applyVideoEditCreatorTemplate(settings, event.target.value as any) })}
                disabled={running}
              >
                {VIDEO_EDIT_CREATOR_TEMPLATES.map((item) => <option key={item.id} value={item.id} title={item.changes.join(' / ')}>{item.label}</option>)}
              </select>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-7 justify-center px-2 py-0 text-[10px]" onClick={sortClipsByName} disabled={!clips.length || running}>排序</button>
              {VIDEO_EDIT_WORKBENCH_ENTRY_ENABLED && (
                <button data-video-edit-compact-action-button="true" data-video-edit-node-detail-gate="true" className="t8-mini-button nodrag h-7 justify-center px-2 py-0 text-[10px]" onClick={() => setWorkbenchOpen(true)}>剪辑台细调</button>
              )}
            </div>
            <div className="mt-1 flex h-6 flex-wrap gap-1 overflow-hidden">
              {(selectedCreatorTemplate?.changes || ['保留当前设置']).slice(0, 3).map((change) => (
                <span key={`node-scheme-${change}`} data-video-edit-scheme-change="true" className="rounded-full border px-1 py-0.5 text-[9px]" style={videoEditMutedStyle}>
                  {change}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-2 py-0 text-[10px]" onClick={() => recipeInputRef.current?.click()} disabled={running}>导入配方</button>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-2 py-0 text-[10px]" onClick={exportVideoEditRecipe} disabled={!clips.length || running}>导出配方</button>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-2 py-0 text-[10px]" onClick={() => void handleBatchPlatformExport()} disabled={!canCompose || !!busy || !selectedPlatformPackageIds.length}>套餐</button>
            </div>
          </div>

          <div data-video-edit-option-list="settings" className="min-h-0 overflow-hidden rounded-lg border px-2 py-1.5 text-[11px]" style={videoEditPanelStyle}>
            <div className="mb-1 flex items-center justify-between gap-2 font-semibold">
              <span>处理</span>
              <span>体检：{timelineHealth.label}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <select className="t8-select nodrag h-7 min-w-0 px-1 py-0 text-[10px]" value={settings.transition} onChange={(event) => patchSettings({ transition: event.target.value as any })}>
                {VIDEO_EDIT_TRANSITION_GROUPS.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <select className="t8-select nodrag h-7 min-w-0 px-1 py-0 text-[10px]" aria-label="转场时长" value={String(settings.transitionDuration)} onChange={(event) => patchSettings({ transitionDuration: Number(event.target.value) })}>
                {TRANSITION_DURATION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select className="t8-select nodrag h-7 min-w-0 px-1 py-0 text-[10px]" value={settings.filter} onChange={(event) => patchSettings({ filter: event.target.value as any })}>
                {FILTER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select className="t8-select nodrag h-7 min-w-0 px-1 py-0 text-[10px]" value={settings.audio} onChange={(event) => patchSettings({ audio: event.target.value as any })}>
                {AUDIO_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1">
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-1 py-0 text-[10px]" onClick={() => void handleSeparateAudio('mute-video')} disabled={!clips.length || !!busy}>无声</button>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-1 py-0 text-[10px]" onClick={() => void handleSeparateAudio('audio-only')} disabled={!clips.length || !!busy || !hasPotentialAudio}>音频</button>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-1 py-0 text-[10px]" onClick={() => { if (selectedClip) locateSourceClip(selectedClip); }} disabled={!selectedClip}>源节点</button>
              <button data-video-edit-compact-action-button="true" className="t8-mini-button nodrag h-6 justify-center px-1 py-0 text-[10px]" onClick={() => addOutputNodeFromVersion(outputVersions[0], 'video')} disabled={!outputVersions[0]}>输出</button>
            </div>
          </div>
        </section>
        {running && (
          <div className="absolute bottom-3 left-3 right-3 rounded-lg border p-2 text-[11px]" style={videoEditPanelStyle}>
            <div className="mb-1 flex items-center justify-between font-semibold">
              <span>{String(d.job?.message || '合成中')}</span>
              <span>{Math.round(Number(d.job?.progress || 0))}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${Math.max(3, Math.min(100, Number(d.job?.progress || 0)))}%` }} />
            </div>
          </div>
        )}
        {(localError || d.error) && <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{localError || String(d.error)}</div>}
      </div>
    </div>
    {workbenchOpen && createPortal(
      <VideoEditVisible>
      <div className="fixed inset-0 z-[2147483000] overflow-hidden bg-black/80 p-1.5" onMouseDown={(event) => event.stopPropagation()}>
        <section
          ref={workbenchShellRef}
          role="dialog"
          aria-modal="true"
          aria-label="视频剪辑台"
          tabIndex={0}
          onKeyDown={handleWorkbenchKeyDown}
          data-video-edit-workbench="true"
          data-video-edit-workbench-theme-surface="solid"
          data-video-edit-workbench-viewport-fill="true"
          data-video-edit-workbench-responsive-safe="true"
          className="nodrag relative mx-auto flex h-[calc(100vh-0.75rem)] max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-none min-w-0 resize overflow-hidden rounded-2xl border shadow-2xl"
          style={videoEditSolidStyle}
        >
          {timelineMarqueeSelection && (
            <div
              data-video-edit-timeline-marquee="true"
              data-video-edit-timeline-marquee-count={timelineMarqueeSelection.itemIds.length}
              className="pointer-events-none fixed z-[2147483500] rounded-md border border-cyan-300 bg-cyan-300/20 shadow-[0_0_0_1px_rgba(103,232,249,0.45),0_0_18px_rgba(34,211,238,0.25)]"
              style={{
                left: timelineMarqueeSelection.left,
                top: timelineMarqueeSelection.top,
                width: timelineMarqueeSelection.width,
                height: timelineMarqueeSelection.height,
              }}
              aria-hidden="true"
            >
              <span className="absolute -top-6 left-0 rounded-full bg-cyan-300 px-2 py-0.5 text-[10px] font-bold text-cyan-950 shadow">
                {timelineMarqueeSelection.itemIds.length ? `${timelineMarqueeSelection.itemIds.length} 项` : '框选'}
              </span>
            </div>
          )}
          {workbenchShortcutsOpen && (
            <aside
              data-video-edit-shortcuts-panel="true"
              className="absolute right-3 top-[6.4rem] z-50 w-[min(390px,calc(100vw-2rem))] max-w-[calc(100%-1.5rem)] rounded-lg border p-3 shadow-2xl"
              style={videoEditPanelStyle}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">快捷键</div>
                  <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>剪辑台焦点内生效</div>
                </div>
                <button
                  type="button"
                  data-video-edit-shortcuts-close="true"
                  className="t8-mini-icon-button nodrag shrink-0"
                  onClick={() => setWorkbenchShortcutsOpen(false)}
                  title="关闭快捷键面板"
                  aria-label="关闭快捷键面板"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid max-h-[min(58vh,390px)] gap-1 overflow-y-auto pr-1">
                {VIDEO_EDIT_WORKBENCH_SHORTCUTS.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    data-video-edit-shortcut-row={shortcut.id}
                    className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-[11px]"
                    style={videoEditMutedStyle}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{shortcut.label}</div>
                      <div className="truncate text-[9px]" style={{ color: 'var(--t8-text-muted)' }}>{shortcut.group}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={`${shortcut.id}-${key}`}
                          data-video-edit-shortcut-key={key}
                          className="min-w-6 rounded border px-1.5 py-0.5 text-center text-[10px] font-bold"
                          style={{ borderColor: 'var(--t8-border)' }}
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            <header data-video-edit-workbench-toolbar="true" className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 border-b px-4 py-1.5" style={videoEditMutedStyle}>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="text-base font-bold">视频剪辑台</div>
                  <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: 'var(--t8-border)' }}>
                    选中 {selectedTimelineItemLabel}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${timelineSnapEnabled ? 'is-active' : ''}`} style={{ borderColor: 'var(--t8-border)' }}>
                    吸附 {timelineSnapEnabled ? '开' : '关'}
                  </span>
                </div>
                <div className="truncate text-[11px]" style={{ color: 'var(--t8-text-muted)' }}>{clips.length} 段 · 总时长 {formatSeconds(totalDuration)} · 体检 {timelineHealth.label} · Space / I/O / S / Delete / Ctrl+D / Ctrl+Z/Ctrl+Y</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="t8-secondary-button nodrag" onClick={openVideoFilePicker} disabled={!!busy}><UploadCloud size={14} />上传视频</button>
                <button className="t8-secondary-button nodrag" onClick={() => void importUpstream()} disabled={!!busy}><Plus size={14} />导入上游</button>
                <button className="t8-mini-icon-button nodrag" title="关闭剪辑台" onClick={() => setWorkbenchOpen(false)}><X size={16} /></button>
              </div>
              <div
                data-video-edit-workbench-edit-toolbar="true"
                className="col-span-2 flex h-9 min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden rounded-xl border px-2 py-1"
                style={videoEditPanelStyle}
              >
                <button
                  type="button"
                  data-video-edit-workbench-action="undo"
                  className="t8-mini-button nodrag justify-center px-2 py-1 text-[11px]"
                  onClick={undoWorkbenchChange}
                  title="撤销 Ctrl+Z"
                  disabled={!workbenchUndoStackRef.current.length}
                >
                  <RotateCcw size={12} />撤销
                </button>
                <button
                  type="button"
                  data-video-edit-workbench-action="redo"
                  className="t8-mini-button nodrag justify-center px-2 py-1 text-[11px]"
                  onClick={redoWorkbenchChange}
                  title="恢复 Ctrl+Y"
                  disabled={!workbenchRedoStackRef.current.length}
                >
                  <RotateCw size={12} />恢复
                </button>
                <button
                  type="button"
                  data-video-edit-workbench-action="split-at-playhead"
                  className="t8-mini-button nodrag justify-center px-2 py-1 text-[11px]"
                  onClick={splitSelectedClipAtPlayhead}
                  disabled={!selectedClip || selectedClipTimelineLocked || running || !!busy}
                  title="在播放头拆分 S"
                >
                  <Scissors size={12} />拆分
                </button>
                <button
                  type="button"
                  data-video-edit-workbench-action="duplicate-selected"
                  className="t8-mini-button nodrag justify-center px-2 py-1 text-[11px]"
                  onClick={duplicateSelectedTimelineItems}
                  disabled={!selectedTimelineItemCount || selectedTimelineItemsLocked || running || !!busy}
                  title="复制所选 Ctrl+D"
                >
                  <Copy size={12} />复制
                </button>
                <button
                  type="button"
                  data-video-edit-workbench-action="delete-selected"
                  className="t8-mini-button nodrag justify-center px-2 py-1 text-[11px]"
                  onClick={removeSelectedTimelineItems}
                  disabled={(!selectedTimelineItemCount && !selectedClip) || selectedTimelineDeleteLocked || running || !!busy}
                  title="删除所选 Delete"
                >
                  <Trash2 size={12} />删除
                </button>
                <button
                  type="button"
                  data-video-edit-workbench-action="toggle-snap"
                  className={`t8-mini-button nodrag justify-center px-2 py-1 text-[11px] ${timelineSnapEnabled ? 'is-active' : ''}`}
                  onClick={toggleTimelineSnap}
                  title={timelineSnapEnabled ? '关闭时间线吸附' : '开启时间线吸附'}
                >
                  <MapPin size={12} />吸附
                </button>
                <button
                  type="button"
                  data-video-edit-workbench-action="show-shortcuts"
                  data-video-edit-shortcuts-toggle="true"
                  className={`t8-mini-button nodrag justify-center px-2 py-1 text-[11px] ${workbenchShortcutsOpen ? 'is-active' : ''}`}
                  onClick={toggleWorkbenchShortcuts}
                  aria-expanded={workbenchShortcutsOpen}
                  title="快捷键 ?"
                >
                  <Keyboard size={12} />快捷键
                </button>
                <div
                  data-video-edit-workbench-feature-strip="true"
                  className="flex min-w-0 max-w-[38vw] items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg border px-1.5 py-1"
                  style={videoEditMutedStyle}
                >
                  {workbenchTopStatusItems.map((item) => {
                    const featureKey = item.key === 'export' ? 'output' : item.key;
                    return (
                      <button
                        key={`top-feature-${item.key}`}
                        type="button"
                        data-video-edit-workbench-feature={featureKey}
                        data-video-edit-workbench-feature-status={item.status}
                        data-enabled={item.active ? 'true' : 'false'}
                        className="nodrag flex h-7 min-w-[106px] max-w-[154px] shrink-0 items-center justify-between gap-1.5 rounded-lg border px-2 text-left text-[10px] leading-none transition disabled:cursor-not-allowed disabled:opacity-45"
                        style={{
                          borderColor: item.active ? '#67e8f9' : 'var(--t8-border)',
                          background: item.active ? 'rgba(25, 92, 86, 0.68)' : 'var(--t8-video-edit-card)',
                          color: 'var(--t8-text)',
                        }}
                        title={`${item.label} · ${item.status} · ${item.detail}`}
                        disabled={item.disabled}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          runWorkbenchCreatorCommand(item.key);
                        }}
                      >
                        <span className="min-w-0 truncate font-bold">{item.label}</span>
                        <span className="shrink-0 rounded-full border px-1 py-0.5 text-[9px] opacity-85" style={{ borderColor: 'var(--t8-border)' }}>
                          {item.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="ml-auto flex min-w-[260px] flex-1 items-center gap-1.5">
                  <input
                    ref={subtitleToolbarInputRef}
                    data-video-edit-toolbar-subtitle-input="true"
                    className="nodrag min-w-0 flex-1 rounded-lg border px-2.5 py-1 text-xs outline-none"
                    style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-panel)', color: 'var(--t8-text)' }}
                    value={subtitleDraft}
                    onChange={(event) => setSubtitleDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addSubtitleToTimeline();
                      }
                    }}
                    placeholder="字幕文本，回车添加到播放头"
                  />
                  <button
                    type="button"
                    data-video-edit-workbench-action="add-subtitle"
                    className="t8-mini-button nodrag justify-center px-2 py-1 text-[11px]"
                    onClick={addSubtitleToTimeline}
                    disabled={running || busy === 'compose'}
                  >
                    字幕
                  </button>
                </div>
              </div>
            </header>
            <div
              data-video-edit-workbench-command-rail="true"
              className="mx-3 mt-1 flex h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-xl border px-2 py-1"
              style={videoEditMutedStyle}
            >
              <div className="flex shrink-0 items-center gap-1.5 pr-1 text-[11px] font-bold" style={{ color: 'var(--t8-text)' }}>
                <Sparkles size={13} />
                创作入口
              </div>
              <div
                data-video-edit-workbench-capability-dock="true"
                data-video-edit-workbench-capability-dock-placement="toolbar"
                className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
              >
                {workbenchCreatorCommandItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    data-video-edit-workbench-capability-dock-item={item.key}
                    data-enabled={item.active ? 'true' : 'false'}
                    className="nodrag flex h-7 min-w-[118px] max-w-[160px] flex-1 items-center justify-between gap-2 rounded-lg border px-2 text-left text-[10px] leading-none transition disabled:cursor-not-allowed disabled:opacity-45"
                    style={{
                      borderColor: item.active ? '#67e8f9' : 'var(--t8-border)',
                      background: item.active ? 'rgba(25, 92, 86, 0.7)' : 'var(--t8-video-edit-card)',
                      color: 'var(--t8-text)',
                    }}
                    title={`${item.label} · ${item.status} · ${item.detail}`}
                    disabled={item.disabled}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      runWorkbenchCreatorCommand(item.key);
                    }}
                  >
                    <span className="min-w-0 truncate font-bold">{item.label}</span>
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] opacity-85" style={{ borderColor: 'var(--t8-border)' }}>{item.status}</span>
                  </button>
                ))}
              </div>
              <div
                data-video-edit-workbench-feature-audit="true"
                className="flex min-w-[240px] max-w-[380px] shrink-0 items-center gap-1 overflow-x-auto"
              >
                {workbenchFeatureAuditItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    data-video-edit-workbench-feature-audit-item={item.key}
                    data-video-edit-workbench-feature-audit-action={item.key}
                    data-enabled={item.active ? 'true' : 'false'}
                    className="nodrag flex h-7 min-w-[92px] items-center justify-between gap-1 rounded-lg border px-2 text-left text-[10px] leading-none transition"
                    style={{
                      borderColor: item.active ? '#67e8f9' : 'var(--t8-border)',
                      background: item.active ? 'rgba(25, 92, 86, 0.62)' : 'var(--t8-video-edit-card)',
                      color: 'var(--t8-text)',
                    }}
                    title={`${item.label} · ${item.status} · ${item.detail}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleWorkbenchFeatureAuditClick(item.key);
                    }}
                  >
                    <span className="min-w-0 truncate font-bold">{item.label}</span>
                    <span className="shrink-0 rounded-full border px-1 py-0.5 text-[9px]" style={{ borderColor: 'var(--t8-border)' }}>{item.status}</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              data-video-edit-workbench-layout="studio-timeline"
              data-video-edit-workbench-layout-version="capcut-workbench-v7"
              data-video-edit-workbench-bottom-timeline="dominant"
              data-video-edit-workbench-timeline-min-height="responsive-290-520"
              data-video-edit-workbench-control-deck="true"
              data-video-edit-workbench-stack="preview-with-bottom-timeline"
              data-video-edit-workbench-main-grid="full-viewport-library-preview-inspector-bottom-multitrack"
              data-video-edit-workbench-panel-widths="left-300-center-fluid-right-380"
              data-video-edit-timeline-source="timeline-v2-items"
              data-video-edit-timeline-v2-duration={timelineV2Duration}
              data-video-edit-timeline-v2-conflicts={timelineV2Conflicts.length}
              className="grid min-h-0 flex-1 gap-1 overflow-hidden px-2 pb-0.5 pt-0.5"
              style={{
                ...videoEditPanelStyle,
                gridTemplateColumns: 'minmax(240px, 300px) minmax(520px, 1fr) minmax(280px, 380px)',
                gridTemplateRows: 'minmax(220px, 0.38fr) minmax(344px, 0.62fr)',
              }}
            >
              <div data-video-edit-workbench-zone="preview-stage-center" data-video-edit-workbench-screen="true" data-video-edit-workbench-top-screen="true" data-video-edit-workbench-preview-clean="content-only" className="relative col-start-2 row-start-1 min-h-0 overflow-hidden rounded-xl bg-black" onDragStartCapture={preventNativeMediaDrag}>
                <div data-video-edit-preview-stage="true" className="relative h-full min-h-0 overflow-hidden rounded-xl bg-black">
                  {selectedClip?.url ? (
                    <video
                      ref={previewVideoRef}
                      data-video-edit-preview-mode="timeline-playhead"
                      data-video-edit-preview-source-item-id={timelinePlayback.item?.id || ''}
                      data-video-edit-preview-source-clip-id={selectedClip.sourceClipId || selectedClip.id || ''}
                      data-video-edit-preview-source-time={timelinePlayback.sourceTime}
                      data-video-edit-preview-timeline-time={timelinePlayback.timelineTime}
                      data-video-edit-preview-source-audio-active={activePreviewSourceAudioSegment ? 'true' : 'false'}
                      data-video-edit-preview-main-muted={previewMainVideoMuted ? 'true' : 'false'}
                      data-video-edit-preview-main-volume={activePreviewSourceAudioVolume}
                      data-video-edit-preview-filter={settings.filter}
                      data-video-edit-preview-filter-active={previewFilterCss ? 'true' : 'false'}
                      className="h-full w-full object-contain"
                      style={previewVideoStyle}
                      src={selectedClip.url}
                      controls
                      muted={previewMainVideoMuted}
                      draggable={false}
                      preload="metadata"
                      onPointerDown={stopNodePointer}
                      onDragStart={preventNativeMediaDrag}
                      onLoadedMetadata={handlePreviewLoadedMetadata}
                      onPlay={playSelectedClipPreview}
                      onPause={() => syncActivePreviewMedia('pause')}
                      onSeeked={() => syncActivePreviewMedia()}
                      onTimeUpdate={handlePreviewTimeUpdate}
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-white/60">选择片段后预览</div>
                  )}
                  {activePreviewPipSegments.map((segment) => {
                    const scale = clampVideoEditPipScale(segment.scale);
                    const x = clampVideoEditPipPercent(segment.x);
                    const y = clampVideoEditPipPercent(segment.y);
                    const opacity = clampVideoEditPipOpacity(segment.opacity);
                    const widthPct = Math.max(10, Math.min(100, scale * 100));
                    const aspectValue = Number(segment.width) > 0 && Number(segment.height) > 0
                      ? Number(segment.width) / Number(segment.height)
                      : 16 / 9;
                    const aspectRatio = Number.isFinite(aspectValue) && aspectValue > 0
                      ? `${Number(segment.width) || 16} / ${Number(segment.height) || 9}`
                      : '16 / 9';
                    const previewStyle: CSSProperties = {
                      left: `${x}%`,
                      top: `${y}%`,
                      transform: `translate(-${x}%, -${y}%)`,
                      opacity,
                      aspectRatio,
                      maxWidth: '92%',
                      maxHeight: '92%',
                      ...(aspectValue >= 1 ? { width: `${widthPct}%` } : { height: `${widthPct}%` }),
                    };
                    return (
                      <div
                        key={`preview-pip-${segment.id}`}
                        data-video-edit-preview-pip-overlay="true"
                        data-video-edit-pip-drag-handle="true"
                        data-video-edit-pip-item-id={segment.sourceItemId}
                        data-video-edit-preview-pip-x={x}
                        data-video-edit-preview-pip-y={y}
                        data-video-edit-preview-pip-scale={scale}
                        data-video-edit-preview-pip-opacity={opacity}
                        className="nodrag pointer-events-auto absolute cursor-move touch-none select-none overflow-hidden rounded-xl border border-cyan-300/70 bg-black/45 shadow-2xl"
                        style={previewStyle}
                        title="拖动调整叠加画面位置"
                        onPointerDown={(event) => beginPreviewPipDrag(event, segment.sourceItemId)}
                        onMouseDown={(event) => beginPreviewPipMouseDrag(event, segment.sourceItemId)}
                        onDragStart={preventNativeMediaDrag}
                      >
                        {segment.url ? (
                          <video
                            ref={(element) => {
                              previewOverlayVideoRefs.current[segment.sourceItemId] = element;
                            }}
                            data-video-edit-preview-pip-video="true"
                            data-video-edit-preview-pip-source-item-id={segment.sourceItemId}
                            data-video-edit-preview-pip-source-time={previewOverlaySegmentSourceTime(segment)}
                            src={segment.url}
                            className="pointer-events-none h-full w-full object-contain"
                            muted
                            playsInline
                            preload="metadata"
                            draggable={false}
                            onLoadedMetadata={() => syncActivePreviewOverlayVideos()}
                            onDragStart={preventNativeMediaDrag}
                          />
                        ) : segment.thumbnailUrl ? (
                          <img src={segment.thumbnailUrl} alt="" className="h-full w-full object-contain" draggable={false} onDragStart={preventNativeMediaDrag} />
                        ) : (
                          <div className="grid aspect-video place-items-center px-3 py-2 text-xs font-semibold text-white/80">
                            {segment.name || '叠加视频'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {activePreviewAudioPlaybackSegments.map((segment) => (
                    <audio
                      key={`preview-audio-${segment.id}`}
                      ref={(element) => {
                        previewAudioRefs.current[segment.sourceItemId] = element;
                      }}
                      data-video-edit-preview-audio-track="true"
                      data-video-edit-preview-audio-source-item-id={segment.sourceItemId}
                      data-video-edit-preview-audio-source-time={previewAudioSegmentSourceTime(segment)}
                      src={segment.url}
                      preload="metadata"
                      style={{ display: 'none' }}
                      onLoadedMetadata={() => syncActivePreviewAudioTracks()}
                    />
                  ))}
                  {activePreviewTextSegments.map((segment, index) => {
                    const position = segment.position || 'bottom';
                    const placementClass = position === 'top'
                      ? 'top-6'
                      : position === 'middle'
                        ? 'top-1/2 -translate-y-1/2'
                        : 'bottom-16';
                    const subtitleFontSize = Math.max(12, Math.min(72, Math.round(Number(segment.fontSize) || 42)));
                    return (
                      <div
                        key={`preview-text-${segment.id}-${index}`}
                        data-video-edit-preview-subtitle="true"
                        data-video-edit-preview-subtitle-position={position}
                        data-video-edit-preview-subtitle-font-size={subtitleFontSize}
                        data-video-edit-preview-subtitle-color={segment.color || '#ffffff'}
                        data-video-edit-preview-subtitle-background={segment.background || 'rgba(0,0,0,0.55)'}
                        className={`pointer-events-none absolute left-1/2 max-w-[82%] -translate-x-1/2 rounded-lg px-3 py-1.5 text-center text-sm font-bold text-white shadow ${placementClass}`}
                        style={{
                          background: segment.background || 'rgba(0,0,0,0.55)',
                          color: segment.color || '#fff',
                          fontSize: `${subtitleFontSize}px`,
                          lineHeight: 1.18,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {segment.text}
                      </div>
                    );
                  })}
                  <VideoEditPreviewTransitionBadge transition={activePreviewTransition} />
                </div>
                {false && (
                  <div aria-hidden="true" data-video-edit-legacy-stacked-timeline="detached-from-workbench-selectors" className="hidden" style={videoEditMutedStyle}>
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                    <span>{workbenchView === 'storyboard' ? '故事板视图 · 大卡片排序' : '时间线'}</span>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span style={{ color: 'var(--t8-text-muted)' }}>{workbenchWindowLabel}</span>
                      <button
                        className="t8-mini-button nodrag px-1.5 py-0.5 text-[10px]"
                        onClick={() => moveWorkbenchWindow(-1)}
                        disabled={workbenchClipWindowStart <= 0}
                      >
                        上一组
                      </button>
                      <button
                        className="t8-mini-button nodrag px-1.5 py-0.5 text-[10px]"
                        onClick={() => moveWorkbenchWindow(1)}
                        disabled={workbenchClipWindowEnd >= workbenchFilteredClips.length}
                      >
                        下一组
                      </button>
                      <button
                        className={`t8-mini-button nodrag px-1.5 py-0.5 text-[10px] ${workbenchView === 'timeline' ? 'is-active' : ''}`}
                        onClick={() => setWorkbenchView('timeline')}
                      >
                        时间线视图
                      </button>
                      <button
                        className={`t8-mini-button nodrag px-1.5 py-0.5 text-[10px] ${workbenchView === 'storyboard' ? 'is-active' : ''}`}
                        onClick={() => setWorkbenchView('storyboard')}
                      >
                        故事板视图
                      </button>
                      {workbenchView === 'timeline' && (
                        <>
                          <span>同一素材可重复使用</span>
                          {[1, 2, 4].map((zoom) => (
                            <button
                              key={zoom}
                              className={`t8-mini-button nodrag px-1.5 py-0.5 text-[10px] ${timelineZoom === zoom ? 'is-active' : ''}`}
                              onClick={() => setTimelineZoom(zoom)}
                            >
                              {zoom}x
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  {workbenchView === 'storyboard' ? (
                    <div className="grid max-h-[170px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                      {workbenchVisibleClips.map((clip, visibleIndex) => {
                        const index = workbenchClipWindowStart + visibleIndex;
                        const health = videoEditClipHealth(clip, settings);
                        return (
                          <article
                            key={clip.id}
                            tabIndex={0}
                            aria-label={`选择片段 ${index + 1} ${clip.name}`}
                            aria-selected={selectedClip?.id === clip.id}
                            className={`nodrag rounded-xl border bg-[var(--t8-surface)] p-2 text-xs shadow-sm ${selectedClip?.id === clip.id ? 'border-cyan-500 ring-1 ring-cyan-400' : ''}`}
                            onClick={() => update({ selectedClipId: clip.id })}
                            onKeyDown={(event) => handleWorkbenchClipCardKeyDown(event, clip.id)}
                          >
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1 font-bold">
                                  <span className={`h-2 w-2 rounded-full ${healthDotClass(health.level)}`} />
                                  <span>#{index + 1}</span>
                                  <span className="truncate">{clip.name}</span>
                                </div>
                                <div className="mt-0.5 truncate text-[10px] opacity-70">
                                  {health.label} · {formatSeconds(videoEditClipDuration(clip))} · {clip.sourceLabel}
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-1">
                                <button
                                  className="t8-mini-button nodrag px-1.5 py-0.5 text-[10px]"
                                  title="向前移动镜头"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    moveStoryboardClip(clip.id, -1);
                                  }}
                                  disabled={index === 0}
                                >
                                  ↑
                                </button>
                                <button
                                  className="t8-mini-button nodrag px-1.5 py-0.5 text-[10px]"
                                  title="向后移动镜头"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    moveStoryboardClip(clip.id, 1);
                                  }}
                                  disabled={index === clips.length - 1}
                                >
                                  ↓
                                </button>
                              </div>
                            </div>
                            <div className="h-20 overflow-hidden rounded-lg bg-black/10">
                              {clip.thumbnailUrl ? (
                                <img
                                  src={clip.thumbnailUrl}
                                  alt={clip.name}
                                  className="h-full w-full object-cover"
                                  draggable={false}
                                  onDragStart={preventNativeMediaDrag}
                                />
                              ) : (
                                <div className="grid h-full place-items-center opacity-60"><Film size={18} /></div>
                              )}
                            </div>
                            <div className="mt-2 grid gap-2">
                              <label className="block">
                                <FieldLabel>分镜备注</FieldLabel>
                                <textarea
                                  className="nodrag nowheel min-h-[58px] w-full rounded-lg border px-2 py-1 text-[11px]"
                                  style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-surface)' }}
                                  value={clip.storyboardNote || ''}
                                  placeholder="写镜头目的、情绪、保留点..."
                                  onMouseDown={stopNodeMouse}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => handleStoryboardNoteChange(clip.id, event.target.value)}
                                />
                              </label>
                              <label className="block">
                                <FieldLabel>镜头标签</FieldLabel>
                                <input
                                  className="nodrag nowheel w-full rounded-lg border px-2 py-1 text-[11px]"
                                  style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-surface)' }}
                                  value={(clip.storyboardTags || []).join(', ')}
                                  placeholder="开场, 特写, 高潮"
                                  onMouseDown={stopNodeMouse}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => handleStoryboardTagsChange(clip.id, event.target.value)}
                                />
                              </label>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {workbenchVisibleClips.map((clip, visibleIndex) => {
                        const index = workbenchClipWindowStart + visibleIndex;
                        const health = videoEditClipHealth(clip, settings);
                        const trimVisual = buildVideoEditTrimmedCardVisual(clip);
                        const { sourceDuration, trimStart, trimEnd } = trimVisual;
                        return (
                          <div
                            key={clip.id}
                            data-video-edit-timeline-card="true"
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            title={health.reason}
                            style={{ width: videoEditTimelineWidth(clip, timelineZoom), minWidth: videoEditTimelineWidth(clip, timelineZoom) }}
                            className={`nodrag nopan nowheel cursor-pointer select-none rounded-lg border bg-[var(--t8-surface)] p-2 text-left text-xs ${selectedClip?.id === clip.id ? 'border-cyan-500 ring-1 ring-cyan-400' : ''}`}
                            onClick={() => update({ selectedClipId: clip.id })}
                            onKeyDown={(event) => handleWorkbenchClipCardKeyDown(event, clip.id)}
                            onDragStart={preventNativeMediaDrag}
                            onPointerMove={handleTimelineTrimPointerMove}
                            onPointerUp={finishTimelineTrimDrag}
                            onPointerCancel={finishTimelineTrimDrag}
                            aria-label={`选择片段 ${index + 1} ${clip.name}`}
                            aria-selected={selectedClip?.id === clip.id}
                          >
                            <div className="mb-1 flex items-center justify-between font-bold">
                              <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${healthDotClass(health.level)}`} />#{index + 1}</span>
                              <span>{formatSeconds(videoEditClipDuration(clip))}</span>
                            </div>
                            <div className="truncate font-semibold">{clip.name}</div>
                            <div className="mt-1 text-[10px] opacity-70">{health.label} · {clip.sourceLabel} · {clip.hasAudio === false ? '无声' : clip.hasAudio === true ? '有声' : '探测中'}</div>
                            <div className="mt-2 h-20 overflow-hidden rounded bg-black/10">
                              {clip.thumbnailUrl ? (
                                <span className="relative block h-full w-full overflow-hidden">
                                  <img
                                    data-video-edit-trim-thumbnail-mask="true"
                                    data-video-edit-trim-thumbnail-mask-mode="hidden-outside-trim"
                                    src={clip.thumbnailUrl}
                                    alt=""
                                    aria-hidden="true"
                                    className="absolute inset-0 h-full w-full object-cover opacity-0"
                                    draggable={false}
                                    onDragStart={preventNativeMediaDrag}
                                  />
                                  <span data-video-edit-trim-thumbnail-window="true" data-video-edit-trim-thumbnail-window-mode="trim-range-sync" data-video-edit-trim-window-space="trimmed-card" className="absolute inset-y-0 overflow-hidden rounded-sm ring-1 ring-cyan-300/70" style={trimVisual.trimmedWindowThumbnailStyle}>
                                    <img
                                      data-video-edit-trim-thumbnail-active="true"
                                      src={clip.thumbnailUrl}
                                      alt={clip.name}
                                      className="absolute inset-y-0 h-full object-cover opacity-90"
                                      style={trimVisual.activeThumbnailStyle}
                                      draggable={false}
                                      onDragStart={preventNativeMediaDrag}
                                    />
                                  </span>
                                </span>
                              ) : (
                                <div className="grid h-full place-items-center opacity-60"><Film size={18} /></div>
                              )}
                            </div>
                            <div
                              data-video-edit-trim-track="true"
                              className="nodrag nopan nowheel relative mt-2 h-8 cursor-ew-resize select-none rounded-full border bg-black/10"
                              style={trimVisual.trackStyle}
                              onDragStartCapture={preventNativeMediaDrag}
                              onMouseDownCapture={(event) => beginTimelineTrimTrackMouseDrag(event, clip, trimVisual, 'trimmed-window')}
                              onMouseMoveCapture={(event) => continueOrStartTimelineTrimTrackMouseDrag(event, clip, trimVisual, 'trimmed-window')}
                              onPointerDownCapture={(event) => beginTimelineTrimTrackDrag(event, clip, trimVisual, 'trimmed-window')}
                              onPointerMoveCapture={(event) => continueOrStartTimelineTrimTrackDrag(event, clip, trimVisual, 'trimmed-window')}
                            >
                              <span className="absolute left-2 top-1 text-[9px] opacity-65">{formatSeconds(trimStart)}</span>
                              <span className="absolute right-2 top-1 text-[9px] opacity-65">{formatSeconds(trimEnd)}</span>
                              <span
                                className="absolute bottom-1 top-4 rounded-full bg-cyan-300/35 ring-1 ring-cyan-300/60"
                                style={trimVisual.trimmedWindowRangeStyle}
                              />
                              <span
                                data-video-edit-trim-handle="start"
                                role="slider"
                                tabIndex={0}
                                aria-label={`拖动调整片段 ${index + 1} 入点`}
                                aria-valuemin={0}
                                aria-valuemax={Number(trimEnd.toFixed(2))}
                                aria-valuenow={Number(trimStart.toFixed(2))}
                                className="nodrag nopan nowheel absolute bottom-0 top-3 z-10 w-3 -translate-x-1/2 cursor-ew-resize select-none rounded-full border border-cyan-200 bg-cyan-500 shadow"
                                style={trimVisual.trimmedWindowStartHandleStyle}
                                onMouseDownCapture={(event) => beginTimelineTrimMouseDrag(event, clip, 'start', trimVisual.trackElement, 'trimmed-window')}
                                onPointerDownCapture={(event) => beginTimelineTrimDrag(event, clip, 'start', trimVisual.trackElement, 'trimmed-window')}
                                title="拖动调整入点"
                              />
                              <span
                                data-video-edit-trim-handle="end"
                                role="slider"
                                tabIndex={0}
                                aria-label={`拖动调整片段 ${index + 1} 出点`}
                                aria-valuemin={Number(trimStart.toFixed(2))}
                                aria-valuemax={Number(sourceDuration.toFixed(2))}
                                aria-valuenow={Number(trimEnd.toFixed(2))}
                                className="nodrag nopan nowheel absolute bottom-0 top-3 z-10 w-3 -translate-x-1/2 cursor-ew-resize select-none rounded-full border border-cyan-200 bg-cyan-500 shadow"
                                style={trimVisual.trimmedWindowEndHandleStyle}
                                onMouseDownCapture={(event) => beginTimelineTrimMouseDrag(event, clip, 'end', trimVisual.trackElement, 'trimmed-window')}
                                onPointerDownCapture={(event) => beginTimelineTrimDrag(event, clip, 'end', trimVisual.trackElement, 'trimmed-window')}
                                title="拖动调整出点"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>
                )}
              </div>
              <section
                data-video-edit-workbench-track-editor="true"
                data-video-edit-workbench-timeline-panel="true"
                data-video-edit-workbench-zone="timeline-bottom"
                data-video-edit-timeline-strip="true"
                data-video-edit-workbench-list-row="timeline"
                className="col-span-3 row-start-2 grid min-h-[344px] grid-rows-[24px_18px_minmax(220px,1fr)_72px] overflow-hidden rounded-xl border p-1"
                style={videoEditMutedStyle}
              >
                <div data-video-edit-track-toolbar="true" className="flex min-h-0 items-center justify-between gap-3 overflow-hidden text-xs font-semibold">
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                    <Film size={14} />
                    <span className="shrink-0">Playlist 时间线</span>
                    <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                      v2 {formatSeconds(timelineV2Duration)}
                    </span>
                    {timelineV2Conflicts.length > 0 && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                        冲突 {timelineV2Conflicts.length}
                      </span>
                    )}
                    <span
                      data-video-edit-workbench-timeline-window-label="true"
                      className="max-w-[180px] truncate rounded-full border px-2 py-0.5 text-[10px]"
                      style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}
                    >
                      {workbenchTimelineWindowLabel}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 overflow-hidden">
                    <button className="t8-mini-button nodrag px-2 py-0.5 text-[10px]" onClick={() => moveWorkbenchTimelineWindow(-1)} disabled={workbenchTimelineWindowStart <= 0}>上一组</button>
                    <button className="t8-mini-button nodrag px-2 py-0.5 text-[10px]" onClick={() => moveWorkbenchTimelineWindow(1)} disabled={workbenchTimelineWindowEnd >= workbenchMainTimelineItems.length}>下一组</button>
                    {[1, 2, 4].map((zoom) => (
                      <button key={`studio-zoom-${zoom}`} className={`t8-mini-button nodrag px-2 py-0.5 text-[10px] ${timelineZoom === zoom ? 'is-active' : ''}`} onClick={() => setTimelineZoom(zoom)}>
                        {zoom}x
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  data-video-edit-timeline-ruler="true"
                  data-video-edit-workbench-ruler-click="true"
                  className="nodrag nopan nowheel relative grid cursor-pointer select-none grid-cols-7 rounded-md border px-2 py-1 text-[10px]"
                  style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}
                  onPointerDownCapture={(event) => handleWorkbenchTimelineSeek(event)}
                >
                  <span
                    data-video-edit-workbench-playhead-handle="true"
                    className="absolute -top-1 z-20 h-4 w-4 -translate-x-1/2 cursor-ew-resize rounded-full border border-cyan-200 bg-cyan-500 shadow"
                    style={workbenchRulerPlayheadStyle}
                    onPointerDownCapture={(event) => beginWorkbenchPlayheadDrag(event)}
                    onMouseDownCapture={(event) => beginWorkbenchPlayheadMouseDrag(event)}
                    title="拖动播放头"
                  />
                  {timelineRulerTicks.map((tick) => (
                    <span key={`workbench-ruler-${tick.ratio}`} className="border-l pl-1 first:border-l-0" style={{ borderColor: 'var(--t8-border)' }}>
                      {tick.label}
                    </span>
                  ))}
                </div>
                <div data-video-edit-workbench-zone="multitrack-timeline" data-video-edit-track-lanes="true" className="grid min-h-0 grid-rows-[minmax(76px,1fr)_minmax(42px,0.38fr)_minmax(42px,0.38fr)_minmax(42px,0.38fr)] gap-1 overflow-hidden">
                  <div data-video-edit-track-kind="video" data-video-edit-track-lane="video" className="grid min-h-0 grid-cols-[128px_minmax(0,1fr)] gap-2 overflow-hidden">
                    <div className="flex flex-col justify-center rounded-lg border px-3 text-xs font-bold" style={videoEditPanelStyle}>
                      <div className="flex items-center justify-between gap-1">
                        <span>视频轨</span>
                        <span data-video-edit-track-controls="video" className="flex shrink-0 items-center gap-1">
                          {renderVideoEditTrackControls(getVideoEditTimelineTrackByKind('video'))}
                        </span>
                      </div>
                      <span className="mt-1 text-[10px] font-normal" style={{ color: 'var(--t8-text-muted)' }}>{clips.length} 段</span>
                    </div>
                    <div
                      ref={workbenchTimelineViewportRef}
                      data-video-edit-workbench-primary-scroll="true"
                      className="relative min-w-0 overflow-x-auto overflow-y-hidden pb-1"
                      onScroll={() => syncWorkbenchTimelineScroll(workbenchTimelineViewportRef.current)}
                      onPointerDownCapture={(event) => beginWorkbenchTimelineMarqueeSelection(event)}
                    >
                      <div
                        className="relative h-full"
                        style={{ width: workbenchTimelineVirtualWidth, minWidth: '100%' }}
                      >
                      {workbenchTimelineHasItems && (
                        <span
                          data-video-edit-workbench-playhead="true"
                          className="pointer-events-none absolute inset-y-0 z-20"
                          style={workbenchPlayheadStyle}
                          aria-hidden="true"
                        >
                          <span
                            data-video-edit-workbench-playhead-line="true"
                            className="absolute bottom-0 top-0 w-px -translate-x-1/2 bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.75)]"
                          />
                          <span
                            data-video-edit-workbench-playhead-handle="true"
                            className="pointer-events-auto absolute top-1 h-4 w-4 -translate-x-1/2 cursor-ew-resize rounded-full border border-cyan-100 bg-cyan-500 shadow"
                            onPointerDownCapture={(event) => beginWorkbenchPlayheadDrag(event)}
                            onMouseDownCapture={(event) => beginWorkbenchPlayheadMouseDrag(event)}
                            title="拖动播放头"
                          />
                        </span>
                      )}
                      {timelineMovePreview && (
                        <span
                          data-video-edit-timeline-item-drag-preview="true"
                          data-video-edit-timeline-snap-active={timelineMovePreview.snapActive ? 'true' : 'false'}
                          data-video-edit-timeline-snap-kind={timelineMovePreview.snapKind}
                          data-video-edit-timeline-snap-delta={timelineMovePreview.snapDelta}
                          data-video-edit-timeline-snap-target={timelineMovePreview.snapTargetLabel}
                          className={`pointer-events-none absolute bottom-2 top-2 z-50 w-px -translate-x-1/2 shadow-[0_0_10px_rgba(190,242,100,0.9)] ${timelineMovePreview.snapActive ? 'bg-amber-300' : 'bg-lime-300'}`}
                          style={{ left: `${timelineMovePreview.leftPct}%` }}
                          aria-hidden="true"
                        >
                          {timelineMovePreview.snapActive && (
                            <span
                              data-video-edit-timeline-snap-guide="true"
                              className="absolute bottom-0 top-0 w-px -translate-x-1/2 bg-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.95)]"
                            />
                          )}
                          <span className={`absolute left-2 top-3 z-50 inline-flex min-w-max items-center whitespace-nowrap rounded-full border border-black/20 px-2 py-0.5 text-[10px] font-bold text-black shadow ${timelineMovePreview.snapActive ? 'bg-amber-300' : 'bg-lime-300'}`}>
                            {timelineMovePreview.snapActive
                              ? `${timelineMovePreview.label} · ${timelineMovePreview.snapTargetLabel} · 偏移 ${timelineMovePreview.snapDelta.toFixed(2)}s`
                              : timelineMovePreview.label}
                          </span>
                        </span>
                      )}
                      {workbenchTransitionCutItems.map((cut) => (
                        <button
                          key={`studio-transition-cut-${cut.id}`}
                          type="button"
                          data-video-edit-transition-cut-chip="true"
                          data-video-edit-transition-cut-index={cut.index}
                          data-video-edit-transition-cut-transition={settings.transition}
                          data-video-edit-transition-cut-duration={cut.durationLabel}
                          data-video-edit-transition-cut-left={cut.left}
                          className="nodrag nopan nowheel absolute top-8 z-30 flex max-w-[150px] -translate-x-1/2 items-center gap-1 rounded-full border border-cyan-200/80 bg-black/75 px-2 py-0.5 text-[10px] font-bold text-cyan-50 shadow-[0_0_10px_rgba(34,211,238,0.35)] hover:bg-cyan-950 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                          style={{ left: cut.left }}
                          title={`转场切点 ${cut.index}：${cut.label} · ${cut.durationLabel}`}
                          aria-label={`转场切点 ${cut.index}：${cut.label}，${cut.durationLabel}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            focusWorkbenchFeature('transition');
                          }}
                        >
                          <Sparkles size={10} />
                          <span className="max-w-[78px] truncate">{cut.label}</span>
                          <span className="shrink-0 rounded-full bg-cyan-300/20 px-1 text-cyan-100">{cut.durationLabel}</span>
                        </button>
                      ))}
                      {workbenchTimelineItems.length ? workbenchTimelineItems.map((item, visibleIndex) => {
                        const sourceClip = clipByTimelineAssetId.get(item.assetId);
                        if (!sourceClip) return null;
                        const clip = videoEditClipFromTimelineItem(item, sourceClip);
                        const index = workbenchTimelineWindowStart + visibleIndex;
                        const health = videoEditClipHealth(clip, settings);
                        const trimVisual = buildVideoEditTrimmedCardVisual(clip);
                        const { sourceDuration, trimStart, trimEnd } = trimVisual;
                        const itemLeft = videoEditTimelineTimeToX(item.timelineStart, {
                          pixelsPerSecond: VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND,
                          zoom: timelineZoom,
                          scrollLeft: 0,
                        });
                        const itemWidth = Math.max(
                          96,
                          Math.round(Math.max(0.1, item.sourceOut - item.sourceIn) * VIDEO_EDIT_WORKBENCH_TIMELINE_PX_PER_SECOND * timelineZoom),
                        );
                        const timelineItemActive = activeTimelineItemId === item.id;
                        const mainItemLocked = isTimelineItemLocked(item);
                        return (
                          <div
                            key={`studio-video-${item.id}`}
                            data-video-edit-timeline-card="true"
                            data-video-edit-timeline-item-id={item.id}
                            data-video-edit-timeline-item-locked={mainItemLocked ? 'true' : undefined}
                            data-video-edit-timeline-item-move-source="pointer"
                            data-video-edit-timeline-item-selected={timelineItemActive ? 'true' : undefined}
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            title={health.reason}
                            style={{
                              left: itemLeft,
                              width: itemWidth,
                              minWidth: itemWidth,
                              background: 'var(--t8-video-edit-card)',
                            }}
                            className={`nodrag nopan nowheel absolute bottom-0 top-0 cursor-grab select-none overflow-hidden rounded-lg border text-left text-xs active:cursor-grabbing ${timelineItemActive ? 'border-cyan-400 ring-1 ring-cyan-300' : ''} ${mainItemLocked ? 'opacity-70' : ''}`}
                            onClick={(event) => { if (shouldSuppressTimelineItemClick(event)) return; selectTimelineVideoItem(item, resolveWorkbenchTimelineSelectionMode(event)); }}
                            onDoubleClick={(event) => focusTimelineItemForWorkbench(event, item)}
                            onContextMenu={(event) => openTimelineContextMenu(event, item)}
                            onKeyDown={(event) => handleWorkbenchClipCardKeyDown(event, item.id)}
                            onDragStart={preventNativeMediaDrag}
                            onMouseDownCapture={(event) => beginTimelineItemMouseMove(event, item)}
                            onPointerDownCapture={(event) => beginTimelineItemMove(event, item)}
                            onPointerMove={handleTimelineTrimPointerMove}
                            onPointerUp={(event) => { finishTimelineTrimDrag(event); finishTimelineItemMove(event); }}
                            onPointerCancel={(event) => { finishTimelineTrimDrag(event); finishTimelineItemMove(event); }}
                            aria-label={`选择片段 ${index + 1} ${clip.name}`}
                            aria-selected={timelineItemActive}
                          >
                            {clip.thumbnailUrl ? (
                              <>
                                <img
                                  data-video-edit-trim-thumbnail-mask="true"
                                  data-video-edit-trim-thumbnail-mask-mode="hidden-outside-trim"
                                  src={clip.thumbnailUrl}
                                  alt=""
                                  aria-hidden="true"
                                  className="absolute inset-0 h-full w-full object-cover opacity-0"
                                  draggable={false}
                                  onDragStart={preventNativeMediaDrag}
                                />
                                <span
                                  data-video-edit-trim-thumbnail-window="true"
                                  data-video-edit-trim-thumbnail-window-mode="trim-range-sync"
                                  data-video-edit-trim-window-space="trimmed-card"
                                  className="absolute inset-y-0 overflow-hidden rounded-sm"
                                  style={trimVisual.trimmedWindowThumbnailStyle}
                                >
                                  <img
                                    data-video-edit-trim-thumbnail-active="true"
                                    src={clip.thumbnailUrl}
                                    alt={clip.name}
                                    className="absolute inset-y-0 h-full object-cover opacity-80"
                                    style={trimVisual.activeThumbnailStyle}
                                    draggable={false}
                                    onDragStart={preventNativeMediaDrag}
                                  />
                                </span>
                              </>
                            ) : (
                              <div className="absolute inset-0 grid place-items-center bg-black/25 opacity-70"><Film size={18} /></div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/10 to-black/55" />
                            <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-bold text-white">
                              <span className={`h-2 w-2 rounded-full ${healthDotClass(health.level)}`} />
                              #{index + 1}
                            </div>
                            <div className="absolute right-2 top-2 flex items-center gap-1">
                              <button
                                type="button"
                                data-video-edit-clip-action="mute"
                                data-video-edit-timeline-item-action="mute"
                                className={`t8-mini-icon-button nodrag h-6 w-6 bg-black/65 text-white ${clip.muted ? 'is-active' : ''}`}
                                title={mainItemLocked ? '轨道已锁定，先解锁后再操作' : clip.muted ? '取消此片段静音' : '静音此片段'}
                                disabled={running || !!busy || mainItemLocked}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (running || busy || mainItemLocked) return;
                                  toggleTimelineItemMuted(item.id);
                                }}
                              >
                                {clip.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                              </button>
                              <button
                                type="button"
                                data-video-edit-clip-action="delete"
                                data-video-edit-timeline-item-action="delete"
                                className="t8-mini-icon-button nodrag h-6 w-6 bg-black/65 text-white"
                                title={mainItemLocked ? '轨道已锁定，先解锁后再操作' : '删除此片段'}
                                disabled={running || !!busy || mainItemLocked}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (running || busy || mainItemLocked) return;
                                  removeTimelineItems([item.id]);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <div className="absolute bottom-9 left-2 right-2 flex items-center justify-between gap-2 text-white">
                              <span className="truncate rounded bg-black/65 px-1.5 py-0.5 font-semibold">{clip.name}</span>
                              <span className="rounded bg-black/75 px-1.5 py-0.5 font-bold">{formatSeconds(videoEditClipDuration(clip))}</span>
                            </div>
                            <div
                              data-video-edit-trim-track="true"
                              className="nodrag nopan nowheel absolute bottom-2 left-2 right-2 h-7 cursor-ew-resize select-none rounded-full border bg-black/35"
                              style={trimVisual.trackStyle}
                              onDragStartCapture={preventNativeMediaDrag}
                              onMouseDownCapture={(event) => beginTimelineTrimTrackMouseDrag(event, clip, trimVisual, 'trimmed-window', item.id)}
                              onMouseMoveCapture={(event) => continueOrStartTimelineTrimTrackMouseDrag(event, clip, trimVisual, 'trimmed-window', item.id)}
                              onPointerDownCapture={(event) => beginTimelineTrimTrackDrag(event, clip, trimVisual, 'trimmed-window', item.id)}
                              onPointerMoveCapture={(event) => continueOrStartTimelineTrimTrackDrag(event, clip, trimVisual, 'trimmed-window', item.id)}
                            >
                              <span className="absolute bottom-1 top-4 rounded-full bg-cyan-300/35 ring-1 ring-cyan-300/60" style={trimVisual.trimmedWindowRangeStyle} />
                              <span
                                data-video-edit-trim-handle="start"
                                role="slider"
                                tabIndex={0}
                                aria-label={`拖动调整片段 ${index + 1} 入点`}
                                aria-valuemin={0}
                                aria-valuemax={Number(trimEnd.toFixed(2))}
                                aria-valuenow={Number(trimStart.toFixed(2))}
                                className="nodrag nopan nowheel absolute bottom-0 top-2 z-10 w-3 -translate-x-1/2 cursor-ew-resize select-none rounded-full border border-cyan-200 bg-cyan-500 shadow"
                                style={trimVisual.trimmedWindowStartHandleStyle}
                                onMouseDownCapture={(event) => beginTimelineTrimMouseDrag(event, clip, 'start', trimVisual.trackElement, 'trimmed-window', item.id)}
                                onPointerDownCapture={(event) => beginTimelineTrimDrag(event, clip, 'start', trimVisual.trackElement, 'trimmed-window', item.id)}
                                title="拖动调整入点"
                              />
                              <span
                                data-video-edit-trim-handle="end"
                                role="slider"
                                tabIndex={0}
                                aria-label={`拖动调整片段 ${index + 1} 出点`}
                                aria-valuemin={Number(trimStart.toFixed(2))}
                                aria-valuemax={Number(sourceDuration.toFixed(2))}
                                aria-valuenow={Number(trimEnd.toFixed(2))}
                                className="nodrag nopan nowheel absolute bottom-0 top-2 z-10 w-3 -translate-x-1/2 cursor-ew-resize select-none rounded-full border border-cyan-200 bg-cyan-500 shadow"
                                style={trimVisual.trimmedWindowEndHandleStyle}
                                onMouseDownCapture={(event) => beginTimelineTrimMouseDrag(event, clip, 'end', trimVisual.trackElement, 'trimmed-window', item.id)}
                                onPointerDownCapture={(event) => beginTimelineTrimDrag(event, clip, 'end', trimVisual.trackElement, 'trimmed-window', item.id)}
                                title="拖动调整出点"
                              />
                            </div>
                          </div>
                        );
                      }) : (
                        <button
                          type="button"
                          className="nodrag grid h-full w-full place-items-center rounded-lg border border-dashed text-sm"
                          style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}
                          onClick={openVideoFilePicker}
                        >
                          上传或导入视频后开始剪辑
                        </button>
                      )}
                      </div>
                    </div>
                  </div>
                  <div data-video-edit-track-kind="overlay" data-video-edit-track-lane="overlay" className="grid min-h-0 grid-cols-[128px_minmax(0,1fr)] gap-2 overflow-hidden">
                    <div className="flex flex-col justify-center rounded-lg border px-3 text-xs font-bold" style={videoEditPanelStyle}>
                      <div className="flex items-center justify-between gap-1">
                        <span>叠加轨</span>
                        <span data-video-edit-track-controls="overlay" className="flex shrink-0 items-center gap-1">
                          {renderVideoEditTrackControls(getVideoEditOverlayTimelineTrack())}
                        </span>
                      </div>
                      <span className="mt-1 text-[10px] font-normal" style={{ color: 'var(--t8-text-muted)' }}>
                        {workbenchOverlayTimelineItems.length ? `${workbenchOverlayTimelineItems.length} 层画中画` : '可添加画中画'}
                      </span>
                    </div>
                    <div
                        ref={workbenchOverlayTimelineViewportRef}
                        data-video-edit-workbench-synced-scroll="overlay"
                        className="relative min-w-0 overflow-x-auto overflow-y-hidden"
                        onScroll={() => syncWorkbenchTimelineScroll(workbenchOverlayTimelineViewportRef.current)}
                        onPointerDownCapture={(event) => beginWorkbenchTimelineMarqueeSelection(event)}
                      >
                      <div className="relative h-full" style={{ width: workbenchTimelineVirtualWidth, minWidth: '100%' }}>
                      {workbenchOverlayTimelineItems.length ? workbenchOverlayTimelineItems.map((item, overlayIndex) => {
                        const sourceClip = clipByTimelineAssetId.get(item.assetId);
                        if (!sourceClip) return null;
                        const overlayClip = videoEditClipFromTimelineItem(item, sourceClip);
                        const overlayActive = activeTimelineItemId === item.id;
                        const itemEnd = item.timelineStart + Math.max(0.1, item.sourceOut - item.sourceIn);
                        const overlayItemLocked = isTimelineItemLocked(item);
                        return (
                          <div
                            key={`studio-overlay-${item.id}`}
                            data-video-edit-timeline-overlay-item-id={item.id}
                            data-video-edit-timeline-item-locked={overlayItemLocked ? 'true' : undefined}
                            data-video-edit-track-item-left={item.timelineStart}
                            data-video-edit-track-item-width={itemEnd - item.timelineStart}
                            data-video-edit-timeline-item-selected={overlayActive ? 'true' : undefined}
                            data-video-edit-timeline-item-move-source="pointer"
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            className={`nodrag nopan nowheel absolute bottom-1 top-1 cursor-grab select-none overflow-hidden rounded-lg border text-left text-[11px] active:cursor-grabbing ${overlayActive ? 'border-cyan-400 ring-1 ring-cyan-300' : ''} ${item.muted ? 'opacity-60' : ''} ${overlayItemLocked ? 'opacity-70' : ''}`}
                            style={{
                              ...workbenchTimelineTrackItemStyle(item.timelineStart, itemEnd, 112),
                              background: 'var(--t8-video-edit-card)',
                              borderColor: overlayActive ? undefined : 'var(--t8-border)',
                            }}
                            title={`叠加轨 ${overlayIndex + 1} · ${overlayClip.name}`}
                            onClick={(event) => { if (shouldSuppressTimelineItemClick(event)) return; selectTimelineVideoItem(item, resolveWorkbenchTimelineSelectionMode(event)); }}
                            onDoubleClick={(event) => focusTimelineItemForWorkbench(event, item)}
                            onContextMenu={(event) => openTimelineContextMenu(event, item)}
                            onDragStart={preventNativeMediaDrag}
                            onMouseDownCapture={(event) => beginTimelineItemMouseMove(event, item)}
                            onPointerDownCapture={(event) => beginTimelineItemMove(event, item)}
                            onPointerUp={(event) => finishTimelineItemMove(event)}
                            onPointerCancel={(event) => finishTimelineItemMove(event)}
                            aria-label={`叠加轨 ${overlayIndex + 1} ${overlayClip.name}`}
                            aria-selected={overlayActive}
                          >
                            {renderTimelineItemTrimHandles(item)}
                            {overlayClip.thumbnailUrl ? (
                              <img
                                src={overlayClip.thumbnailUrl}
                                alt=""
                                aria-hidden="true"
                                draggable={false}
                                onDragStart={preventNativeMediaDrag}
                                className="absolute inset-0 h-full w-full object-cover opacity-70"
                              />
                            ) : (
                              <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-70"><Film size={16} /></div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/20 to-black/65" />
                            <div className="absolute left-2 top-1 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-bold text-white">
                              <span className="h-2 w-2 rounded-full bg-cyan-300" />
                              PIP {overlayIndex + 1}
                            </div>
                            <div className="absolute right-2 top-1 flex items-center gap-1">
                              <button
                                type="button"
                                data-video-edit-timeline-item-action="mute"
                                className={`t8-mini-icon-button nodrag h-6 w-6 bg-black/65 text-white ${item.muted ? 'is-active' : ''}`}
                                title={overlayItemLocked ? '轨道已锁定，先解锁后再操作' : item.muted ? '取消此叠加视频静音' : '静音此叠加视频'}
                                disabled={running || !!busy || overlayItemLocked}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (running || busy || overlayItemLocked) return;
                                  toggleTimelineItemMuted(item.id);
                                }}
                              >
                                {item.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                              </button>
                              <button
                                type="button"
                                data-video-edit-timeline-item-action="delete"
                                className="t8-mini-icon-button nodrag h-6 w-6 bg-black/65 text-white"
                                title={overlayItemLocked ? '轨道已锁定，先解锁后再操作' : '删除此叠加视频'}
                                disabled={running || !!busy || overlayItemLocked}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (running || busy || overlayItemLocked) return;
                                  removeTimelineItems([item.id]);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between gap-2 text-white">
                              <span className="truncate rounded bg-black/65 px-1.5 py-0.5 font-semibold">{overlayClip.name}</span>
                              <span className="shrink-0 rounded bg-black/75 px-1.5 py-0.5 font-bold">{formatSeconds(videoEditClipDuration(overlayClip))}</span>
                            </div>
                          </div>
                        );
                      }) : (
                        <button
                          type="button"
                          data-video-edit-overlay-empty-action="true"
                          className="nodrag grid h-full w-full place-items-center rounded-lg border border-dashed text-[11px]"
                          style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}
                          onClick={() => focusWorkbenchZone('media-bin-left')}
                        >
                          从片段库点击“叠加”添加画中画
                        </button>
                      )}
                      </div>
                    </div>
                  </div>
                  <div data-video-edit-track-kind="audio" data-video-edit-track-lane="audio" className="grid min-h-0 grid-cols-[128px_minmax(0,1fr)] gap-2 overflow-hidden">
                    <div className="flex items-center justify-between rounded-lg border px-3 text-xs font-bold" style={videoEditPanelStyle}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span>音频轨</span>
                        <span data-video-edit-track-controls="audio" className="flex shrink-0 flex-wrap items-center gap-1">
                          {getVideoEditTimelineTracksByKind('audio').map((track) => (
                            <span key={`audio-track-controls-${track.id}`} className="inline-flex items-center gap-1" title={track.name}>
                              {renderVideoEditTrackControls(track)}
                            </span>
                          ))}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          data-video-edit-track-lane-action="mute"
                          className={`t8-mini-icon-button nodrag h-6 w-6 ${allTimelineAudioItemsMuted ? 'is-active' : ''}`}
                          title={allTimelineAudioItemsMuted ? '取消音频轨静音' : '静音音频轨'}
                          onClick={toggleTimelineAudioLaneMuted}
                          disabled={!timelineAudioItems.length || running || !!busy}
                        >
                          {allTimelineAudioItemsMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                        <button
                          type="button"
                          data-video-edit-track-lane-action="add-audio"
                          className="t8-mini-icon-button nodrag h-6 w-6"
                          title="添加独立音频轨"
                          onClick={openAudioTrackFilePicker}
                          disabled={running || !!busy}
                        >
                          <Music2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div
                      ref={workbenchAudioTimelineViewportRef}
                      data-video-edit-workbench-synced-scroll="audio"
                      className="relative min-w-0 overflow-x-auto overflow-y-hidden"
                      onScroll={() => syncWorkbenchTimelineScroll(workbenchAudioTimelineViewportRef.current)}
                      onPointerDownCapture={(event) => beginWorkbenchTimelineMarqueeSelection(event)}
                    >
                      <div className="relative h-full" style={{ width: workbenchTimelineVirtualWidth, minWidth: '100%' }}>
                      {timelineRenderPlan.audio.length ? timelineRenderPlan.audio.map((item) => {
                        const sourceItem = timelineV2.items.find((entry) => entry.id === item.sourceItemId);
                        const sourceClip = item.linkedVideoItemId
                          ? clipByTimelineAssetId.get(timelineV2.items.find((entry) => entry.id === item.linkedVideoItemId)?.assetId || '')
                          : undefined;
                        const label = item.linkedVideoItemId
                          ? (item.muted ? '已静音' : sourceClip?.hasAudio === false ? '无音频' : '原声')
                          : '配乐';
                        const audioItemActive = sourceItem ? selectedTimelineItemIds.has(sourceItem.id) : false;
                        const audioItemLocked = sourceItem ? isTimelineItemLocked(sourceItem) : true;
                        return (
                        <div
                          key={`studio-audio-${item.id}`}
                          data-video-edit-timeline-audio-item-id={item.sourceItemId}
                          data-video-edit-timeline-item-locked={audioItemLocked ? 'true' : undefined}
                          data-video-edit-independent-audio-item-id={item.linkedVideoItemId ? undefined : item.sourceItemId}
                          data-video-edit-track-item-left={item.timelineStart}
                          data-video-edit-track-item-width={item.timelineEnd - item.timelineStart}
                          data-video-edit-timeline-item-selected={audioItemActive ? 'true' : undefined}
                          data-video-edit-timeline-item-move-source="pointer"
                          role="button"
                          tabIndex={0}
                          draggable={false}
                          className={`nodrag nopan nowheel absolute bottom-1 top-1 flex cursor-grab select-none items-center gap-2 overflow-hidden rounded-lg border px-3 text-[11px] active:cursor-grabbing ${item.muted ? 'opacity-55' : ''} ${audioItemActive ? 'border-cyan-400 ring-1 ring-cyan-300' : ''} ${audioItemLocked ? 'opacity-70' : ''}`}
                          style={{
                            ...workbenchTimelineTrackItemStyle(item.timelineStart, item.timelineEnd, 112),
                            background: 'var(--t8-video-edit-card)',
                            borderColor: audioItemActive ? undefined : 'var(--t8-border)',
                          }}
                          title={`${label} · ${item.name}`}
                          onClick={(event) => { if (shouldSuppressTimelineItemClick(event)) return; if (sourceItem) selectTimelineItemForWorkbench(sourceItem, resolveWorkbenchTimelineSelectionMode(event)); }}
                          onDoubleClick={(event) => { if (sourceItem) focusTimelineItemForWorkbench(event, sourceItem); }}
                          onContextMenu={(event) => { if (sourceItem) openTimelineContextMenu(event, sourceItem); }}
                          onDragStart={preventNativeMediaDrag}
                          onMouseDownCapture={(event) => { if (sourceItem) beginTimelineItemMouseMove(event, sourceItem); }}
                          onPointerDownCapture={(event) => { if (sourceItem) beginTimelineItemMove(event, sourceItem); }}
                          onPointerUp={(event) => finishTimelineItemMove(event)}
                          onPointerCancel={(event) => finishTimelineItemMove(event)}
                          aria-label={`${label} ${item.name}`}
                          aria-selected={audioItemActive}
                        >
                          {renderTimelineItemTrimHandles(sourceItem)}
                          {item.muted || sourceClip?.hasAudio === false ? <VolumeX size={13} /> : <Volume2 size={13} />}
                          <span className="truncate">{label}</span>
                          <span className="truncate opacity-70">{item.name}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              data-video-edit-timeline-item-action="mute"
                              className={`t8-mini-icon-button nodrag h-6 w-6 ${item.muted ? 'is-active' : ''}`}
                              title={audioItemLocked ? '轨道已锁定，先解锁后再操作' : item.muted ? '取消此音频静音' : '静音此音频'}
                              disabled={!sourceItem || running || !!busy || audioItemLocked}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (running || busy || audioItemLocked) return;
                                if (sourceItem?.id) toggleTimelineItemMuted(sourceItem.id);
                              }}
                            >
                              {item.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                            </button>
                            <button
                              type="button"
                              data-video-edit-timeline-item-action="delete"
                              className="t8-mini-icon-button nodrag h-6 w-6"
                              title={audioItemLocked ? '轨道已锁定，先解锁后再操作' : '删除此音频条目'}
                              disabled={!sourceItem || running || !!busy || audioItemLocked}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (running || busy || audioItemLocked) return;
                                if (sourceItem?.id) removeTimelineItems([sourceItem.id]);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </span>
                        </div>
                      ); }) : (
                        <div className="absolute inset-0 grid place-items-center rounded-lg border border-dashed text-[11px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                          导入视频或点击音符添加配乐
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                  <div data-video-edit-track-kind="text" data-video-edit-track-lane="text" className="grid min-h-0 grid-cols-[128px_minmax(0,1fr)] gap-2 overflow-hidden">
                    <div className="flex items-center justify-between rounded-lg border px-3 text-xs font-bold" style={videoEditPanelStyle}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span>字幕轨</span>
                        <span data-video-edit-track-controls="text" className="flex shrink-0 items-center gap-1">
                          {renderVideoEditTrackControls(getVideoEditTimelineTrackByKind('text'))}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-video-edit-track-lane-action="add-subtitle"
                        className="t8-mini-button nodrag px-2 py-1 text-[10px]"
                        onClick={addSubtitleToTimeline}
                        disabled={running || busy === 'compose'}
                      >
                        添加
                      </button>
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(180px,0.42fr)] gap-2 overflow-hidden">
                      <div
                        ref={workbenchTextTimelineViewportRef}
                        data-video-edit-workbench-synced-scroll="text"
                        className="relative min-w-0 overflow-x-auto overflow-y-hidden"
                        onScroll={() => syncWorkbenchTimelineScroll(workbenchTextTimelineViewportRef.current)}
                        onPointerDownCapture={(event) => beginWorkbenchTimelineMarqueeSelection(event)}
                      >
                        <div className="relative h-full" style={{ width: workbenchTimelineVirtualWidth, minWidth: '100%' }}>
                        {timelineRenderPlan.text.length ? timelineRenderPlan.text.map((item) => {
                          const sourceItem = timelineV2.items.find((entry) => entry.id === item.sourceItemId);
                          const textItemActive = sourceItem ? selectedTimelineItemIds.has(sourceItem.id) : false;
                          const textItemLocked = sourceItem ? isTimelineItemLocked(sourceItem) : true;
                          return (
                          <div
                            key={`studio-text-${item.id}`}
                            data-video-edit-timeline-text-item-id={item.sourceItemId}
                            data-video-edit-timeline-item-locked={textItemLocked ? 'true' : undefined}
                            data-video-edit-track-item-left={item.timelineStart}
                            data-video-edit-track-item-width={item.timelineEnd - item.timelineStart}
                            data-video-edit-timeline-item-selected={textItemActive ? 'true' : undefined}
                            data-video-edit-timeline-item-move-source="pointer"
                            role="button"
                            tabIndex={0}
                            draggable={false}
                            className={`nodrag nopan nowheel absolute bottom-1 top-1 flex cursor-grab select-none items-center gap-2 overflow-hidden rounded-lg border px-3 text-[11px] active:cursor-grabbing ${textItemActive ? 'border-cyan-400 ring-1 ring-cyan-300' : ''} ${textItemLocked ? 'opacity-70' : ''}`}
                            style={{
                              ...workbenchTimelineTrackItemStyle(item.timelineStart, item.timelineEnd, 120),
                              background: 'var(--t8-video-edit-card)',
                              borderColor: textItemActive ? undefined : 'var(--t8-border)',
                            }}
                            title={`${formatSeconds(item.timelineStart)} - ${formatSeconds(item.timelineEnd)} ${item.text}`}
                            onClick={(event) => { if (shouldSuppressTimelineItemClick(event)) return; if (sourceItem) selectTimelineItemForWorkbench(sourceItem, resolveWorkbenchTimelineSelectionMode(event)); }}
                            onDoubleClick={(event) => { if (sourceItem) focusTimelineItemForWorkbench(event, sourceItem); }}
                            onContextMenu={(event) => { if (sourceItem) openTimelineContextMenu(event, sourceItem); }}
                            onDragStart={preventNativeMediaDrag}
                            onMouseDownCapture={(event) => { if (sourceItem) beginTimelineItemMouseMove(event, sourceItem); }}
                            onPointerDownCapture={(event) => { if (sourceItem) beginTimelineItemMove(event, sourceItem); }}
                            onPointerUp={(event) => finishTimelineItemMove(event)}
                            onPointerCancel={(event) => finishTimelineItemMove(event)}
                            aria-label={`字幕 ${item.text}`}
                            aria-selected={textItemActive}
                          >
                            {renderTimelineItemTrimHandles(sourceItem)}
                            <span className="rounded bg-black/55 px-1.5 py-0.5 text-white">字幕</span>
                            <span className="truncate">{item.text}</span>
                            <button
                              type="button"
                              data-video-edit-timeline-item-action="delete"
                              className="t8-mini-icon-button nodrag ml-auto h-6 w-6 shrink-0"
                              title={textItemLocked ? '轨道已锁定，先解锁后再操作' : '删除此字幕'}
                              disabled={running || !!busy || textItemLocked}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (running || busy || textItemLocked) return;
                                removeTimelineItems([item.sourceItemId]);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ); }) : (
                          <div className="absolute inset-0 grid place-items-center rounded-lg border border-dashed text-[11px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                            暂无字幕
                          </div>
                        )}
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          ref={subtitleTrackInputRef}
                          data-video-edit-subtitle-input="true"
                          className="nodrag min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none"
                          style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-video-edit-panel)', color: 'var(--t8-text)' }}
                          value={subtitleDraft}
                          onChange={(event) => setSubtitleDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addSubtitleToTimeline();
                            }
                          }}
                          placeholder="输入字幕，回车添加"
                        />
                        <button
                          type="button"
                          data-video-edit-subtitle-inline-add="true"
                          className="t8-mini-button nodrag shrink-0 justify-center px-3 py-2 text-[11px]"
                          onClick={addSubtitleToTimeline}
                          disabled={running || busy === 'compose'}
                          title="把输入的字幕添加到当前播放头"
                        >
                          添加字幕
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  data-video-edit-workbench-selected-detail-row="true"
                  data-video-edit-workbench-status-strip="true"
                  data-video-edit-workbench-property-inspector="true"
                  data-video-edit-workbench-property-inspector-placement="timeline-detail"
                  className="grid h-[72px] min-h-[72px] grid-cols-[minmax(0,0.9fr)_minmax(0,0.78fr)_minmax(0,1.35fr)_minmax(0,0.95fr)] gap-1 overflow-hidden rounded-lg border p-1"
                  style={videoEditPanelStyle}
                >
                  <div
                    data-video-edit-selected-item-summary="true"
                    data-video-edit-selected-item-kind={selectedTimelineItemDetail?.kind || 'none'}
                    className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg border px-2 py-1"
                    style={selectedTimelineItemDetail ? videoEditMutedStyle : videoEditPanelStyle}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold" title={selectedTimelineItemDetail?.title || undefined}>
                        {selectedTimelineItemDetail?.title || '选择时间线素材'}
                      </div>
                      <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                        {selectedTimelineItemDetail
                          ? `${selectedTimelineItemDetail.kindLabel} · ${formatSeconds(selectedTimelineItemDetail.duration)} · ${selectedTimelineItemDetail.trackName}`
                          : '选中后可定位、拆分、静音、复制或删除'}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {selectedTimelineItemDetail ? (
                        <>
                          <button
                            type="button"
                            data-video-edit-selected-summary-action="seek"
                            className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                            onClick={() => selectTimelineItemForWorkbench(selectedTimelineItemDetail.item)}
                          >
                            定位
                          </button>
                          <button
                            type="button"
                            data-video-edit-selected-summary-action="split"
                            className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                            onClick={() => splitTimelineItemAtPlayhead(selectedTimelineItemDetail.item.id)}
                            disabled={running || !!busy || selectedTimelineItemDetail.kind === 'text' || selectedTimelineItemDetail.locked}
                          >
                            拆分
                          </button>
                          <button
                            type="button"
                            data-video-edit-selected-summary-action="mute"
                            className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                            onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                            disabled={running || !!busy || !selectedTimelineItemDetail.canMute || selectedTimelineItemDetail.locked}
                          >
                            {selectedTimelineItemDetail.muted ? '取消静音' : '静音'}
                          </button>
                          <button
                            type="button"
                            data-video-edit-selected-summary-action="delete"
                            className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px] text-red-300"
                            onClick={() => removeTimelineItems([selectedTimelineItemDetail.item.id])}
                            disabled={running || !!busy || selectedTimelineItemDetail.locked}
                          >
                            删除
                          </button>
                        </>
                      ) : (
                        <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                          未选中
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    data-video-edit-workbench-cover-status="true"
                    data-video-edit-workbench-cover-set={d.coverImageUrl ? 'true' : 'false'}
                    data-video-edit-workbench-cover-time={Number(d.coverFrameTime || 0)}
                    className="grid min-h-[58px] grid-cols-[44px_minmax(0,1fr)] items-center gap-1 rounded-lg border px-2 py-1"
                    style={d.coverImageUrl ? videoEditMutedStyle : videoEditPanelStyle}
                  >
                    <div className="grid h-10 w-11 place-items-center overflow-hidden rounded-md border bg-black/30" style={{ borderColor: 'var(--t8-border)' }}>
                      {d.coverImageUrl ? (
                        <img
                          data-video-edit-workbench-cover-thumb="true"
                          src={String(d.coverImageUrl)}
                          alt="封面帧"
                          className="h-full w-full object-cover"
                          draggable={false}
                          onDragStart={preventNativeMediaDrag}
                        />
                      ) : (
                        <Camera size={15} />
                      )}
                    </div>
                    <div className="grid min-w-0 gap-1">
                      <div className="truncate text-[11px] font-bold">封面帧</div>
                      <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                        {d.coverImageUrl ? `已设置 ${formatSeconds(Number(d.coverFrameTime || 0))}` : '取当前预览帧'}
                      </div>
                      <button
                        type="button"
                        data-video-edit-workbench-cover-action="capture"
                        className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                        onClick={() => void handleSnapshotFrame('cover')}
                        disabled={!selectedClip || !!busy}
                      >
                        当前帧
                      </button>
                    </div>
                  </div>
                  <div
                    data-video-edit-workbench-visible-feature-hub="true"
                    data-video-edit-workbench-feature-hub-placement="timeline-detail"
                    className="grid min-h-[60px] content-start gap-0.5 overflow-hidden rounded-lg border p-1"
                    style={videoEditPanelStyle}
                  >
                    <div className="grid grid-cols-4 gap-0.5">
                      {workbenchInspectorActionItems.map((item) => (
                        <button
                          key={`timeline-detail-feature-${item.key}`}
                          type="button"
                          data-video-edit-workbench-visible-feature-item={item.key}
                          data-enabled={item.active ? 'true' : 'false'}
                          className="nodrag grid min-h-[20px] grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border px-1 py-0.5 text-left text-[8px] leading-tight transition disabled:cursor-not-allowed disabled:opacity-45"
                          style={{
                            borderColor: item.active ? '#67e8f9' : 'var(--t8-border)',
                            background: item.active ? 'rgba(25, 92, 86, 0.62)' : 'var(--t8-video-edit-card)',
                            color: 'var(--t8-text)',
                          }}
                          title={`${item.label} · ${item.status} · ${item.detail}`}
                          disabled={item.disabled}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            runWorkbenchCreatorCommand(item.key);
                          }}
                        >
                          <span className="truncate font-bold">{item.label}</span>
                          <span className="rounded-full border px-1 text-[8px]" style={{ borderColor: 'var(--t8-border)' }}>{item.status}</span>
                        </button>
                      ))}
                    </div>
                    <div data-video-edit-workbench-visible-feature-audit="true" className="grid grid-cols-4 gap-0.5">
                      {workbenchFeatureAuditItems.map((item) => (
                        <button
                          key={`timeline-detail-audit-${item.key}`}
                          type="button"
                          data-video-edit-workbench-visible-feature-audit-item={item.key}
                          data-enabled={item.active ? 'true' : 'false'}
                          className="nodrag min-h-[18px] rounded-md border px-1 py-0.5 text-left text-[8px] leading-tight transition"
                          style={item.active ? videoEditMutedStyle : videoEditPanelStyle}
                          title={`${item.label} · ${item.status} · ${item.detail}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleWorkbenchFeatureAuditClick(item.key);
                          }}
                        >
                          <span className="block truncate font-bold">{item.label}</span>
                          <span className="block truncate opacity-70">{item.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    data-video-edit-selected-quick-panel="true"
                    data-video-edit-selected-quick-kind={selectedTimelineItemDetail?.kind || 'none'}
                    tabIndex={-1}
                    className="grid max-h-[132px] min-h-[64px] gap-1 overflow-y-auto rounded-lg border p-2 pr-1"
                    style={selectedTimelineItemDetail ? videoEditMutedStyle : videoEditPanelStyle}
                  >
                    {selectedTimelineItemDetail ? (
                      <>
                        {selectedTimelineItemCount > 1 && (
                          <div
                            data-video-edit-batch-property-panel="true"
                            data-video-edit-batch-property-selected-count={selectedTimelineItemCount}
                            data-video-edit-batch-property-media-count={selectedTimelineBatchPropertyCounts.media}
                            data-video-edit-batch-property-text-count={selectedTimelineBatchPropertyCounts.text}
                            data-video-edit-batch-property-pip-count={selectedTimelineBatchPropertyCounts.pip}
                            className="grid gap-1 rounded-md border p-1"
                            style={videoEditPanelStyle}
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] font-bold">
                              <span className="truncate">批量属性 · {selectedTimelineItemLabel}</span>
                              <span className="shrink-0 opacity-70">
                                音 {selectedTimelineBatchPropertyCounts.media} / 字 {selectedTimelineBatchPropertyCounts.text} / PIP {selectedTimelineBatchPropertyCounts.pip}
                              </span>
                            </div>
                            <div className="grid grid-cols-5 gap-1">
                              <button
                                type="button"
                                data-video-edit-batch-property-action="volume-50"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineItemVolume(0.5)}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.media}
                              >
                                50%
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="volume-100"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineItemVolume(1)}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.media}
                              >
                                100%
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="mute-selected"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineItemMuted(true)}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.media}
                              >
                                静音
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="unmute-selected"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineItemMuted(false)}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.media}
                              >
                                开声
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="subtitle-top"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineTextAssets({ textPosition: 'top' })}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.text}
                              >
                                字顶
                              </button>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                              <button
                                type="button"
                                data-video-edit-batch-property-action="subtitle-yellow"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineTextAssets({ textColor: '#ffeb3b' })}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.text}
                              >
                                黄字
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="subtitle-bg-light"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelineTextAssets({ textBackground: 'rgba(255,255,255,0.72)' })}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.text}
                              >
                                亮底
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="pip-opacity-50"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelinePipFields({ opacity: 0.5 })}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.pip}
                              >
                                PIP 50
                              </button>
                              <button
                                type="button"
                                data-video-edit-batch-property-action="pip-scale-60"
                                className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                onClick={() => patchSelectedTimelinePipFields({ scale: 0.6 })}
                                disabled={running || !!busy || selectedTimelineItemsLocked || !selectedTimelineBatchPropertyCounts.pip}
                              >
                                PIP 60
                              </button>
                            </div>
                            {selectedTimelineBatchPropertyCounts.text > 0 && (
                              <div
                                data-video-edit-batch-subtitle-detail="true"
                                data-video-edit-batch-subtitle-count={selectedTimelineBatchPropertyCounts.text}
                                data-video-edit-batch-subtitle-position-current={selectedTimelineBatchSubtitleStyle.position}
                                data-video-edit-batch-subtitle-font-size-current={selectedTimelineBatchSubtitleStyle.fontSize}
                                data-video-edit-batch-subtitle-color-current={selectedTimelineBatchSubtitleStyle.color}
                                data-video-edit-batch-subtitle-background-current={selectedTimelineBatchSubtitleStyle.background}
                                className="grid gap-1 rounded-md border border-dashed p-1"
                                style={{ borderColor: 'var(--t8-border)' }}
                              >
                                <div className="flex items-center justify-between gap-1 text-[9px] font-semibold">
                                  <span className="truncate">字幕批量细调</span>
                                  <span className="shrink-0 opacity-70">
                                    {selectedTimelineBatchSubtitleStyle.positionMixed
                                      || selectedTimelineBatchSubtitleStyle.fontSizeMixed
                                      || selectedTimelineBatchSubtitleStyle.colorMixed
                                      || selectedTimelineBatchSubtitleStyle.backgroundMixed
                                      ? '混合样式'
                                      : `${selectedTimelineBatchPropertyCounts.text} 条同步`}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  {[
                                    { value: 'top', label: '顶部' },
                                    { value: 'middle', label: '居中' },
                                    { value: 'bottom', label: '底部' },
                                  ].map((option) => (
                                    <button
                                      key={`batch-subtitle-position-${option.value}`}
                                      type="button"
                                      data-video-edit-batch-subtitle-position={option.value}
                                      className={`t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px] ${selectedTimelineBatchSubtitleStyle.position === option.value ? 'is-active' : ''}`}
                                      onClick={() => patchSelectedTimelineTextAssets({ textPosition: option.value })}
                                      disabled={running || !!busy || selectedTimelineItemsLocked}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_34px_minmax(68px,0.7fr)] items-end gap-1">
                                  <label className="block min-w-0">
                                    <FieldLabel>字号 {selectedTimelineBatchSubtitleStyle.fontSize}</FieldLabel>
                                    <input
                                      data-video-edit-batch-subtitle-font-size="true"
                                      className="nodrag nowheel w-full"
                                      type="range"
                                      min={18}
                                      max={96}
                                      step={1}
                                      value={selectedTimelineBatchSubtitleStyle.fontSize}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSelectedTimelineTextAssets({ textFontSize: Number(event.target.value) })}
                                      disabled={running || !!busy || selectedTimelineItemsLocked}
                                    />
                                  </label>
                                  <label className="block">
                                    <FieldLabel>颜色</FieldLabel>
                                    <input
                                      data-video-edit-batch-subtitle-color="true"
                                      className="nodrag h-6 w-8 rounded border p-0"
                                      style={{ borderColor: 'var(--t8-border)' }}
                                      type="color"
                                      value={selectedTimelineBatchSubtitleStyle.colorValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSelectedTimelineTextAssets({ textColor: event.target.value })}
                                      disabled={running || !!busy || selectedTimelineItemsLocked}
                                    />
                                  </label>
                                  <label className="block min-w-0">
                                    <FieldLabel>底色</FieldLabel>
                                    <select
                                      data-video-edit-batch-subtitle-background="true"
                                      className="t8-select nodrag w-full px-1 py-0.5 text-[9px]"
                                      value={selectedTimelineBatchSubtitleStyle.backgroundValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSelectedTimelineTextAssets({ textBackground: event.target.value })}
                                      disabled={running || !!busy || selectedTimelineItemsLocked}
                                    >
                                      <option value="rgba(0,0,0,0.45)">半透明黑</option>
                                      <option value="rgba(15,23,42,0.72)">深色胶囊</option>
                                      <option value="rgba(255,255,255,0.72)">浅色胶囊</option>
                                      <option value="rgba(0,0,0,0)">无底色</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                          <span className="truncate">快控 · {selectedTimelineItemCount > 1 ? selectedTimelineItemLabel : selectedTimelineItemDetail.kindLabel}</span>
                          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                            {selectedTimelineItemDetail.muted ? '静音' : `${Math.round(selectedTimelineItemDetail.volume * 100)}%`}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          <button
                            type="button"
                            data-video-edit-selected-item-action="duplicate"
                            className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                            onClick={() => duplicateTimelineItems([selectedTimelineItemDetail.item.id])}
                            disabled={running || !!busy || selectedTimelineItemDetail.locked}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            data-video-edit-selected-item-action="split"
                            className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                            onClick={() => splitTimelineItemAtPlayhead(selectedTimelineItemDetail.item.id)}
                            disabled={running || !!busy || selectedTimelineItemDetail.kind === 'text' || selectedTimelineItemDetail.locked}
                          >
                            拆分
                          </button>
                          <button
                            type="button"
                            data-video-edit-selected-item-action="mute"
                            className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                            onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                            disabled={running || !!busy || !selectedTimelineItemDetail.canMute || selectedTimelineItemDetail.locked}
                          >
                            {selectedTimelineItemDetail.muted ? '开声' : '静音'}
                          </button>
                          <button
                            type="button"
                            data-video-edit-selected-item-action="delete"
                            className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px] text-red-300"
                            onClick={() => removeTimelineItems([selectedTimelineItemDetail.item.id])}
                            disabled={running || !!busy || selectedTimelineItemDetail.locked}
                          >
                            删除
                          </button>
                        </div>
                        {selectedTimelineItemDetail.canMute && (
                          <input
                            data-video-edit-selected-volume="true"
                            className="nodrag nowheel w-full"
                            type="range"
                            min={0}
                            max={2}
                            step={0.01}
                            value={selectedTimelineItemDetail.muted ? 0 : selectedTimelineItemDetail.volume}
                            onPointerDown={stopNodePointer}
                            onChange={(event) => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, Number(event.target.value))}
                            disabled={running || !!busy || selectedTimelineItemDetail.locked}
                          />
                        )}
                        {selectedTimelineItemDetail.kind === 'text' && selectedTimelineItemDetail.asset ? (
                          (() => {
                            const item = selectedTimelineItemDetail.item;
                            const asset = selectedTimelineItemDetail.asset as VideoEditTimelineAsset;
                            const textValue = typeof asset.text === 'string' ? asset.text : (item.label || '');
                            const positionValue = asset.textPosition || 'bottom';
                            const fontSizeValue = Number.isFinite(Number(asset.textFontSize)) ? Number(asset.textFontSize) : 42;
                            const colorValue = /^#[0-9a-f]{6}$/i.test(String(asset.textColor || '')) ? String(asset.textColor) : '#ffffff';
                            const backgroundValue = typeof asset.textBackground === 'string' ? asset.textBackground : 'rgba(0,0,0,0.45)';
                            const patchSubtitleAsset = (
                              patch: Partial<VideoEditTimelineAsset>,
                              itemPatch: Partial<VideoEditTimelineItem> = {},
                            ) => patchTimelineAssetFields(item.id, item.assetId, patch, itemPatch);
                            return (
                              <div
                                data-video-edit-subtitle-quick-controls="true"
                                data-video-edit-subtitle-quick-current-position={positionValue}
                                data-video-edit-subtitle-quick-current-font-size={Math.round(fontSizeValue)}
                                data-video-edit-subtitle-quick-current-color={colorValue}
                                data-video-edit-subtitle-quick-current-background={backgroundValue}
                                className="grid gap-1 rounded-md border p-1"
                                style={videoEditPanelStyle}
                              >
                                <div className="truncate text-[10px] font-semibold" title={textValue}>{textValue || '空字幕'}</div>
                                <div className="grid grid-cols-3 gap-1">
                                  {[
                                    { value: 'top', label: '顶部' },
                                    { value: 'middle', label: '居中' },
                                    { value: 'bottom', label: '底部' },
                                  ].map((option) => (
                                    <button
                                      key={`timeline-detail-subtitle-${option.value}`}
                                      type="button"
                                      data-video-edit-subtitle-quick-position={option.value}
                                      className={`t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px] ${positionValue === option.value ? 'is-active' : ''}`}
                                      onClick={() => patchSubtitleAsset({ textPosition: option.value })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_38px_minmax(70px,0.75fr)] items-end gap-1">
                                  <label className="block min-w-0">
                                    <FieldLabel>字号 {Math.round(fontSizeValue)}</FieldLabel>
                                    <input
                                      data-video-edit-subtitle-quick-font-size="true"
                                      className="nodrag nowheel w-full"
                                      type="range"
                                      min={18}
                                      max={96}
                                      step={1}
                                      value={fontSizeValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSubtitleAsset({ textFontSize: Number(event.target.value) })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    />
                                  </label>
                                  <label className="block">
                                    <FieldLabel>颜色</FieldLabel>
                                    <input
                                      data-video-edit-subtitle-quick-color="true"
                                      className="nodrag h-6 w-8 rounded border p-0"
                                      style={{ borderColor: 'var(--t8-border)' }}
                                      type="color"
                                      value={colorValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSubtitleAsset({ textColor: event.target.value })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    />
                                  </label>
                                  <label className="block min-w-0">
                                    <FieldLabel>底色</FieldLabel>
                                    <select
                                      data-video-edit-subtitle-quick-background="true"
                                      className="t8-select nodrag w-full px-1 py-0.5 text-[9px]"
                                      value={backgroundValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSubtitleAsset({ textBackground: event.target.value })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    >
                                      <option value="rgba(0,0,0,0.45)">半透明黑</option>
                                      <option value="rgba(15,23,42,0.72)">深色胶囊</option>
                                      <option value="rgba(255,255,255,0.72)">浅色胶囊</option>
                                      <option value="rgba(0,0,0,0)">无底色</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            );
                          })()
                        ) : selectedTimelineItemDetail.kind === 'audio' ? (
                          <div
                            data-video-edit-audio-quick-controls="true"
                            data-video-edit-audio-quick-current-volume={selectedTimelineItemDetail.volume}
                            data-video-edit-audio-quick-muted={selectedTimelineItemDetail.muted ? 'true' : 'false'}
                            className="grid gap-1 rounded-md border p-1"
                            style={videoEditPanelStyle}
                          >
                            <div className="grid grid-cols-4 gap-1">
                              {[0, 0.5, 1, 1.5].map((value) => (
                                <button
                                  key={`timeline-detail-audio-${value}`}
                                  type="button"
                                  data-video-edit-audio-quick-volume={value}
                                  className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                  onClick={() => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, value)}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  {value === 0 ? '静音' : `${Math.round(value * 100)}%`}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 text-[10px]">
                              <button
                                type="button"
                                data-video-edit-audio-quick-toggle-muted="true"
                                className={`t8-mini-button nodrag justify-center px-1.5 py-0.5 text-[9px] ${selectedTimelineItemDetail.muted ? 'is-active' : ''}`}
                                onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              >
                                {selectedTimelineItemDetail.muted ? '开声' : '静音'}
                              </button>
                              <input
                                data-video-edit-audio-quick-volume-slider="true"
                                className="nodrag nowheel w-full"
                                type="range"
                                min={0}
                                max={2}
                                step={0.01}
                                value={selectedTimelineItemDetail.volume}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, Number(event.target.value))}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              />
                              <span>{Math.round(selectedTimelineItemDetail.volume * 100)}%</span>
                            </div>
                            <div
                              data-video-edit-audio-envelope-controls="true"
                              data-video-edit-audio-fade-in-current={selectedTimelineItemDetail.audioFadeIn}
                              data-video-edit-audio-fade-out-current={selectedTimelineItemDetail.audioFadeOut}
                              data-video-edit-audio-volume-curve-current={selectedTimelineItemDetail.volumeCurve}
                              className="grid gap-1 border-t pt-1"
                              style={{ borderColor: 'var(--t8-border)' }}
                            >
                              <div className="flex items-center justify-between gap-2 text-[9px]" style={{ color: 'var(--t8-text-muted)' }}>
                                <span>淡化 / 曲线</span>
                                <span>{selectedTimelineItemDetail.audioFadeIn}s / {selectedTimelineItemDetail.audioFadeOut}s</span>
                              </div>
                              <div className="grid grid-cols-4 gap-1">
                                <button
                                  type="button"
                                  data-video-edit-audio-envelope-action="fade-in-1"
                                  className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                  onClick={() => patchTimelineItemAudioEnvelope(selectedTimelineItemDetail.item.id, {
                                    audioFadeIn: 1,
                                    audioFadeOut: selectedTimelineItemDetail.audioFadeOut,
                                    volumeCurve: selectedTimelineItemDetail.volumeCurve,
                                  })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  淡入
                                </button>
                                <button
                                  type="button"
                                  data-video-edit-audio-envelope-action="fade-out-1"
                                  className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                  onClick={() => patchTimelineItemAudioEnvelope(selectedTimelineItemDetail.item.id, {
                                    audioFadeIn: selectedTimelineItemDetail.audioFadeIn,
                                    audioFadeOut: 1,
                                    volumeCurve: selectedTimelineItemDetail.volumeCurve,
                                  })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  淡出
                                </button>
                                <button
                                  type="button"
                                  data-video-edit-audio-envelope-action="fade-both-1"
                                  className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                  onClick={() => patchTimelineItemAudioEnvelope(selectedTimelineItemDetail.item.id, {
                                    audioFadeIn: 1,
                                    audioFadeOut: 1,
                                    volumeCurve: selectedTimelineItemDetail.volumeCurve,
                                  })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  双淡
                                </button>
                                <button
                                  type="button"
                                  data-video-edit-audio-envelope-action="clear"
                                  className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                  onClick={() => patchTimelineItemAudioEnvelope(selectedTimelineItemDetail.item.id, {
                                    audioFadeIn: 0,
                                    audioFadeOut: 0,
                                    volumeCurve: 'flat',
                                  })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  清除
                                </button>
                              </div>
                              <div className="grid grid-cols-4 gap-1">
                                {VIDEO_EDIT_AUDIO_VOLUME_CURVE_OPTIONS.map((option) => (
                                  <button
                                    key={`timeline-detail-audio-curve-${option.value}`}
                                    type="button"
                                    data-video-edit-audio-volume-curve={option.value}
                                    className={`t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px] ${selectedTimelineItemDetail.volumeCurve === option.value ? 'is-active' : ''}`}
                                    title={option.hint}
                                    onClick={() => patchTimelineItemAudioEnvelope(selectedTimelineItemDetail.item.id, {
                                      audioFadeIn: selectedTimelineItemDetail.audioFadeIn,
                                      audioFadeOut: selectedTimelineItemDetail.audioFadeOut,
                                      volumeCurve: option.value,
                                    })}
                                    disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : selectedTimelineItemDetail.kind === 'video' && isWorkbenchOverlayTimelineItem(selectedTimelineItemDetail.item) ? (
                          <div
                            data-video-edit-pip-quick-controls="true"
                            data-video-edit-pip-quick-current-x={clampVideoEditPipPercent(selectedTimelineItemDetail.item.x)}
                            data-video-edit-pip-quick-current-y={clampVideoEditPipPercent(selectedTimelineItemDetail.item.y)}
                            data-video-edit-pip-quick-current-scale={clampVideoEditPipScale(selectedTimelineItemDetail.item.scale)}
                            data-video-edit-pip-quick-current-opacity={clampVideoEditPipOpacity(selectedTimelineItemDetail.item.opacity)}
                            className="grid gap-1 rounded-md border p-1"
                            style={videoEditPanelStyle}
                          >
                            <div className="grid grid-cols-3 gap-1">
                              {VIDEO_EDIT_PIP_PRESETS.slice(0, 6).map((preset) => (
                                <button
                                  key={`timeline-detail-pip-${preset.id}`}
                                  type="button"
                                  data-video-edit-pip-quick-preset={preset.id}
                                  className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                                  onClick={() => patchTimelineItemFields(selectedTimelineItemDetail.item.id, {
                                    x: preset.x,
                                    y: preset.y,
                                    scale: preset.scale,
                                    opacity: preset.opacity,
                                  })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  {preset.label.replace('小窗', '')}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              <label className="block min-w-0">
                                <FieldLabel>X {Math.round(clampVideoEditPipPercent(selectedTimelineItemDetail.item.x))}</FieldLabel>
                                <input
                                  data-video-edit-pip-quick-x="true"
                                  className="nodrag nowheel w-full"
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={clampVideoEditPipPercent(selectedTimelineItemDetail.item.x)}
                                  onPointerDown={stopNodePointer}
                                  onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { x: Number(event.target.value) })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                />
                              </label>
                              <label className="block min-w-0">
                                <FieldLabel>Y {Math.round(clampVideoEditPipPercent(selectedTimelineItemDetail.item.y))}</FieldLabel>
                                <input
                                  data-video-edit-pip-quick-y="true"
                                  className="nodrag nowheel w-full"
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={clampVideoEditPipPercent(selectedTimelineItemDetail.item.y)}
                                  onPointerDown={stopNodePointer}
                                  onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { y: Number(event.target.value) })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                />
                              </label>
                              <label className="block min-w-0">
                                <FieldLabel>大小 {Math.round(clampVideoEditPipScale(selectedTimelineItemDetail.item.scale) * 100)}%</FieldLabel>
                                <input
                                  data-video-edit-pip-quick-scale="true"
                                  className="nodrag nowheel w-full"
                                  type="range"
                                  min={0.15}
                                  max={1.5}
                                  step={0.01}
                                  value={clampVideoEditPipScale(selectedTimelineItemDetail.item.scale)}
                                  onPointerDown={stopNodePointer}
                                  onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { scale: Number(event.target.value) })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 text-[10px]">
                              <span>透明</span>
                              <input
                                data-video-edit-pip-quick-opacity="true"
                                className="nodrag nowheel w-full"
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={clampVideoEditPipOpacity(selectedTimelineItemDetail.item.opacity)}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { opacity: Number(event.target.value) })}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              />
                              <span>{Math.round(clampVideoEditPipOpacity(selectedTimelineItemDetail.item.opacity) * 100)}%</span>
                            </div>
                          </div>
                        ) : (
                          <div data-video-edit-video-quick-controls="true" className="grid grid-cols-3 gap-1">
                            <button
                              type="button"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                              onClick={() => splitTimelineItemAtPlayhead(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              播放头拆分
                            </button>
                            <button
                              type="button"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                              onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || !selectedTimelineItemDetail.canMute || selectedTimelineItemDetail.locked}
                            >
                              {selectedTimelineItemDetail.muted ? '取消静音' : '静音'}
                            </button>
                            <button
                              type="button"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[9px]"
                              onClick={() => duplicateTimelineItems([selectedTimelineItemDetail.item.id])}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              复制片段
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="grid h-full place-items-center text-center text-[11px]" style={{ color: 'var(--t8-text-muted)' }}>
                        点击轨道里的素材可编辑细节
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <div data-video-edit-workbench-bottom-deck="true" data-video-edit-workbench-tools-row="true" className="contents">
                <aside
                  data-video-edit-material-basket="true"
                  data-video-edit-workbench-zone="media-bin-left"
                  data-video-edit-workbench-media-bin="true"
                  data-video-edit-workbench-list-row="materials"
                  tabIndex={-1}
                  className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden rounded-xl border p-3"
                  style={videoEditMutedStyle}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold">片段库</div>
                      <div className="text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>当前窗口 · {workbenchWindowLabel}</div>
                    </div>
                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: 'var(--t8-border)' }}>
                      {clips.length} 段
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <button className="t8-mini-button nodrag justify-center" onClick={openVideoFilePicker} disabled={!!busy}>
                      <UploadCloud size={12} />上传
                    </button>
                    <button className="t8-mini-button nodrag justify-center" onClick={() => void importUpstream()} disabled={!!busy}>
                      <Plus size={12} />上游
                    </button>
                  </div>
                  <div className="mb-2 grid gap-2">
                    <input
                      data-video-edit-media-search="true"
                      className="nodrag nowheel h-8 w-full rounded-lg border px-2 text-xs outline-none"
                      style={{ borderColor: 'var(--t8-border)', background: 'var(--t8-surface)', color: 'var(--t8-text)' }}
                      value={workbenchClipSearch}
                      placeholder="搜索片段 / 来源"
                      onPointerDown={stopNodePointer}
                      onMouseDown={stopNodeMouse}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setWorkbenchClipSearch(event.target.value)}
                    />
                    <select
                      data-video-edit-media-source-filter="true"
                      className="t8-select nodrag w-full px-2 py-1 text-xs"
                      value={workbenchClipSourceFilter}
                      onPointerDown={stopNodePointer}
                      onMouseDown={stopNodeMouse}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setWorkbenchClipSourceFilter(event.target.value as VideoEditWorkbenchClipSourceFilter)}
                    >
                      {VIDEO_EDIT_WORKBENCH_CLIP_SOURCE_FILTERS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                      <span>匹配 {workbenchFilteredClips.length}/{clips.length}</span>
                      <span>已用 {workbenchUsedClipIds.size}</span>
                    </div>
                  </div>
                  <div
                    data-video-edit-media-batch-actions="true"
                    className="mb-2 grid grid-cols-3 gap-1 rounded-lg border p-1"
                    style={videoEditPanelStyle}
                  >
                    <button
                      type="button"
                      data-video-edit-media-batch-action="append-visible"
                      className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                      onClick={() => addClipsToWorkbenchTimeline(workbenchVisibleClips.map((clip) => clip.id), 'append')}
                      disabled={!workbenchVisibleClips.length || running || !!busy}
                      title="把当前片段库窗口里的素材按顺序追加到时间线"
                    >
                      追加本页
                    </button>
                    <button
                      type="button"
                      data-video-edit-media-batch-action="append-unused"
                      className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                      onClick={() => addClipsToWorkbenchTimeline(
                        workbenchFilteredClips
                          .filter((clip) => !workbenchUsedClipIds.has(clip.id))
                          .map((clip) => clip.id),
                        'append',
                      )}
                      disabled={!workbenchFilteredClips.some((clip) => !workbenchUsedClipIds.has(clip.id)) || running || !!busy}
                      title="只把筛选结果里还没有进入时间线的片段追加进去"
                    >
                      追加未用
                    </button>
                    <button
                      type="button"
                      data-video-edit-media-batch-action="overlay-selected"
                      className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                      onClick={() => addClipsToWorkbenchTimeline(selectedClip?.id ? [selectedClip.id] : [], 'overlay')}
                      disabled={!selectedClip || running || !!busy}
                      title="把当前选中的素材作为画中画 / 上层视频轨叠加到播放头"
                    >
                      叠加选中
                    </button>
                  </div>
                  <div className="hidden rounded-lg border border-dashed px-2 py-1.5 text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                    选择片段后可在中间细剪，也可以直接在时间线上拖裁剪点。
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {workbenchVisibleClips.length ? workbenchVisibleClips.map((clip, visibleIndex) => {
                      const index = workbenchClipWindowStart + visibleIndex;
                      const health = videoEditClipHealth(clip, settings);
                      return (
                        <div
                          key={`basket-${clip.id}`}
                          role="button"
                          tabIndex={0}
                          title={health.reason}
                          className={`nodrag w-full rounded-lg border bg-[var(--t8-surface)] p-2 text-left text-[11px] transition ${selectedClip?.id === clip.id ? 'border-cyan-500 ring-1 ring-cyan-400' : ''}`}
                          style={{ background: 'var(--t8-video-edit-card)' }}
                          onClick={() => update({ selectedClipId: clip.id })}
                          onKeyDown={(event) => handleWorkbenchClipCardKeyDown(event, clip.id)}
                        >
                          <div className="mb-1 flex items-center justify-between gap-1 font-bold">
                            <span className="flex min-w-0 items-center gap-1">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${healthDotClass(health.level)}`} />
                              <span>#{index + 1}</span>
                              <span className="truncate">{clip.name}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {workbenchUsedClipIds.has(clip.id) && (
                                <span data-video-edit-media-used-badge="true" className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                                  已用
                                </span>
                              )}
                              <span>{formatSeconds(videoEditClipDuration(clip))}</span>
                            </span>
                          </div>
                          <div className="truncate opacity-70">{clip.sourceLabel || '本地上传'} · {clip.hasAudio === false ? '无声' : clip.hasAudio === true ? '有声' : '探测中'}</div>
                          <div className="mt-2 grid grid-cols-4 gap-1">
                            <button
                              type="button"
                              data-video-edit-media-action="append"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[10px]"
                              title="追加到时间线末尾"
                              onClick={(event) => { event.stopPropagation(); addClipToWorkbenchTimeline(clip.id, 'append'); }}
                              disabled={running || !!busy}
                            >
                              追加
                            </button>
                            <button
                              type="button"
                              data-video-edit-media-action="insert"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[10px]"
                              title="插入到播放头位置，并推开后续片段"
                              onClick={(event) => { event.stopPropagation(); addClipToWorkbenchTimeline(clip.id, 'insert'); }}
                              disabled={running || !!busy}
                            >
                              插入
                            </button>
                            <button
                              type="button"
                              data-video-edit-media-action="overwrite"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[10px]"
                              title="覆盖播放头位置的同轨片段"
                              onClick={(event) => { event.stopPropagation(); addClipToWorkbenchTimeline(clip.id, 'overwrite'); }}
                              disabled={running || !!busy}
                            >
                              覆盖
                            </button>
                            <button
                              type="button"
                              data-video-edit-media-action="overlay"
                              className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[10px]"
                              title="叠加到播放头位置，作为画中画 / 上层视频轨"
                              onClick={(event) => { event.stopPropagation(); addClipToWorkbenchTimeline(clip.id, 'overlay'); }}
                              disabled={running || !!busy}
                            >
                              叠加
                            </button>
                          </div>
                        </div>
                      );
                    }) : (
                      <div className="grid min-h-[120px] place-items-center rounded-lg border border-dashed px-3 text-center text-xs" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                        暂无素材，上传或从上游导入视频
                      </div>
                    )}
                  </div>
                </aside>

                <aside
                  data-video-edit-inspector="true"
                  data-video-edit-workbench-zone="inspector-right"
                data-video-edit-workbench-output-panel="true"
                data-video-edit-workbench-export-panel="true"
                data-video-edit-workbench-list-row="settings"
                  tabIndex={-1}
                className="col-start-3 row-start-1 grid min-h-0 grid-rows-[auto_auto_auto] gap-1 overflow-hidden rounded-xl border p-1.5"
                style={videoEditMutedStyle}
              >
                  <div className="flex h-5 items-center justify-between gap-1">
                    <div>
                      <div className="text-[10px] font-bold leading-none">输出设置</div>
                      <div className="hidden text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>发布规格、处理方式和导出</div>
                    </div>
                    <span className="rounded-full border px-1 py-0 text-[8px] font-semibold leading-tight" style={{ borderColor: 'var(--t8-border)' }}>
                      {timelineHealth.label}
                    </span>
                  </div>
                  <div
                    data-video-edit-workbench-output-specs="true"
                    data-video-edit-workbench-list-row="publish-specs"
                    className="grid gap-0.5 rounded-lg border p-1"
                    style={{ ...videoEditPanelStyle, order: 1 }}
                  >
                    <div className="flex h-3.5 items-center justify-between gap-2 text-[9px] font-bold leading-none">
                      <span>发布规格</span>
                      <span className="truncate text-[8px] font-semibold opacity-70">
                        {settings.aspect} · {settings.resolution}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-0.5">
                      <label className="grid min-w-0">
                        <span className="sr-only">预设</span>
                        <select
                          data-video-edit-workbench-output-preset="true"
                          aria-label="输出预设"
                          title="输出预设"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.outputPreset || 'custom'}
                          onChange={(event) => update({ settings: applyVideoEditOutputPreset(settings, event.target.value as any) })}
                        >
                          {VIDEO_EDIT_OUTPUT_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">比例</span>
                        <select
                          data-video-edit-workbench-output-aspect="true"
                          aria-label="输出比例"
                          title="输出比例"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.aspect}
                          onChange={(event) => patchSettings({ aspect: event.target.value as any })}
                        >
                          {ASPECT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">分辨率</span>
                        <select
                          data-video-edit-workbench-output-resolution="true"
                          aria-label="输出分辨率"
                          title="输出分辨率"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.resolution}
                          onChange={(event) => patchSettings({ resolution: event.target.value as any })}
                        >
                          {RESOLUTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">目标时长</span>
                        <input
                          data-video-edit-workbench-output-duration="true"
                          aria-label="目标时长"
                          title="目标时长"
                          className="nodrag nowheel h-6 w-full rounded-lg border px-1 py-0 text-[9px]"
                          style={videoEditPanelStyle}
                          value={settings.targetDuration || ''}
                          placeholder="不限"
                          onPointerDown={stopNodePointer}
                          onChange={(event) => patchSettings({ targetDuration: Number(event.target.value) || undefined })}
                        />
                      </label>
                    </div>
                  </div>
                  <div
                    data-video-edit-workbench-process-card="true"
                    data-video-edit-workbench-list-row="process-settings"
                    className="grid gap-0.5 rounded-lg border p-1"
                    style={{ ...videoEditPanelStyle, order: 3 }}
                  >
                    <div className="flex h-3.5 items-center justify-between gap-2 text-[9px] font-bold leading-none">
                      <span>处理</span>
                      <span className="truncate text-[8px] font-semibold opacity-70">{selectedCreatorTemplate?.label || '手动剪辑'}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-0.5">
                      <label className="grid min-w-0">
                        <span className="sr-only">方案</span>
                        <select
                          data-video-edit-workbench-template-select="true"
                          aria-label="剪辑方案"
                          title="剪辑方案"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.creatorTemplate || 'manual'}
                          onChange={(event) => update({ settings: applyVideoEditCreatorTemplate(settings, event.target.value as any) })}
                        >
                          {VIDEO_EDIT_CREATOR_TEMPLATES.map((item) => <option key={item.id} value={item.id} title={item.changes.join(' / ')}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">转场</span>
                        <select
                          data-video-edit-workbench-transition-select="true"
                          aria-label="转场"
                          title="转场"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.transition}
                          onChange={(event) => patchSettings({ transition: event.target.value as any })}
                        >
                          {VIDEO_EDIT_TRANSITION_GROUPS.map((group) => <optgroup key={group.id} label={group.label}>{group.options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">转场时长</span>
                        <select
                          data-video-edit-workbench-transition-duration-select="true"
                          aria-label="转场时长"
                          title="转场时长"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={String(settings.transitionDuration)}
                          onChange={(event) => patchSettings({ transitionDuration: Number(event.target.value) })}
                        >
                          {TRANSITION_DURATION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">滤镜</span>
                        <select
                          data-video-edit-workbench-filter-select="true"
                          aria-label="滤镜"
                          title="滤镜"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.filter}
                          onChange={(event) => patchSettings({ filter: event.target.value as any })}
                        >
                          {FILTER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                      <label className="grid min-w-0">
                        <span className="sr-only">音频</span>
                        <select
                          data-video-edit-workbench-audio-select="true"
                          aria-label="音频"
                          title="音频"
                          className="t8-select nodrag h-6 w-full px-1 py-0 text-[9px]"
                          value={settings.audio}
                          onChange={(event) => patchSettings({ audio: event.target.value as any })}
                        >
                          {AUDIO_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div
                    data-video-edit-workbench-sticky-actions="true"
                    className="grid grid-cols-[1.35fr_repeat(3,0.82fr)] gap-0.5 rounded-lg border p-0.5"
                    style={{ ...videoEditPanelStyle, order: 0 }}
                  >
                    <button className="t8-primary-button nodrag h-7 w-full justify-center px-1 py-0 text-[10px]" onClick={handleCompose} disabled={!canCompose || !!busy}>
                      {running ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                      {running ? '处理中...' : '合成视频'}
                    </button>
                    <div data-video-edit-workbench-list-row="exports" className="contents">
                      <button className="t8-secondary-button nodrag h-6 justify-center px-1 py-0 text-[9px]" onClick={() => void handleSeparateAudio('mute-video')} disabled={!clips.length || !!busy}><VolumeX size={12} />无声</button>
                      <button className="t8-secondary-button nodrag h-6 justify-center px-1 py-0 text-[9px]" onClick={() => void handleSeparateAudio('audio-only')} disabled={!clips.length || !!busy || !hasPotentialAudio}><Music2 size={12} />音频</button>
                      <button className="t8-secondary-button nodrag h-6 justify-center px-1 py-0 text-[9px]" onClick={() => void handleSeparateAudio('both')} disabled={!clips.length || !!busy || !hasPotentialAudio}><Scissors size={12} />都导出</button>
                    </div>
                    {!canCompose && composeBlockedMessage && (
                      <div
                        data-video-edit-workbench-compose-blocked="true"
                        data-video-edit-workbench-compose-blocked-message={composeBlockedMessage}
                        className="col-span-4 min-h-[14px] truncate rounded-md border px-1 py-0 text-[8px] leading-[14px]"
                        style={{ borderColor: 'rgba(245, 158, 11, 0.38)', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--t8-text)' }}
                        title={composeBlockedMessage}
                      >
                        {composeBlockedMessage}
                      </div>
                    )}
                    {workbenchJobNotice && (
                      <div
                        role="status"
                        aria-live="polite"
                        data-video-edit-workbench-job-notice="true"
                        data-video-edit-workbench-job-notice-status={workbenchJobNotice.status}
                        data-video-edit-workbench-job-notice-tone={workbenchJobNotice.tone}
                        data-video-edit-workbench-job-notice-message={workbenchJobNotice.message}
                        className="col-span-4 min-h-[15px] truncate rounded-md border px-1 py-0 text-[8px] leading-[15px]"
                        style={{
                          borderColor: workbenchJobNotice.tone === 'error' ? 'rgba(248, 113, 113, 0.48)' : 'rgba(245, 158, 11, 0.42)',
                          background: workbenchJobNotice.tone === 'error' ? 'rgba(248, 113, 113, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          color: 'var(--t8-text)',
                        }}
                        title={workbenchJobNotice.message}
                      >
                        {workbenchJobNotice.message}
                      </div>
                    )}
                  </div>
                  <div
                    data-video-edit-workbench-visible-feature-hub-legacy="true"
                    data-video-edit-workbench-feature-hub-placement="legacy-inspector"
                    className="hidden"
                    style={{ ...videoEditPanelStyle, order: 2 }}
                  >
                    <div className="flex h-4 items-center justify-between gap-2 text-[9px] font-bold leading-none">
                      <span>常用入口</span>
                      <span className="truncate text-[8px] font-semibold opacity-70">字幕 / 音频 / PIP / 封面</span>
                    </div>
                    <div className="grid grid-cols-4 gap-0.5">
                      {workbenchInspectorActionItems.map((item) => (
                        <button
                          key={`visible-feature-${item.key}`}
                          type="button"
                          data-video-edit-workbench-visible-feature-item-legacy={item.key}
                          data-enabled={item.active ? 'true' : 'false'}
                          className="nodrag grid min-h-[18px] grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-md border px-1 py-0 text-left text-[8px] leading-tight transition disabled:cursor-not-allowed disabled:opacity-45"
                          style={{
                            borderColor: item.active ? '#67e8f9' : 'var(--t8-border)',
                            background: item.active ? 'rgba(25, 92, 86, 0.62)' : 'var(--t8-video-edit-card)',
                            color: 'var(--t8-text)',
                          }}
                          title={`${item.label} · ${item.status} · ${item.detail}`}
                          disabled={item.disabled}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            runWorkbenchCreatorCommand(item.key);
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold">
                              {item.label}
                              <span className="ml-1 text-[7px] font-medium opacity-70">{item.actionLabel}</span>
                            </span>
                          </span>
                          <span className="justify-self-end rounded-full border px-1 py-0 text-[7px] font-semibold" style={{ borderColor: 'var(--t8-border)' }}>
                            {item.status}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div
                      data-video-edit-workbench-visible-feature-audit-legacy="true"
                      className="grid grid-cols-4 gap-0.5"
                    >
                      {workbenchFeatureAuditItems.map((item) => (
                        <button
                          key={`visible-audit-${item.key}`}
                          type="button"
                          data-video-edit-workbench-visible-feature-audit-item-legacy={item.key}
                          data-enabled={item.active ? 'true' : 'false'}
                          className="nodrag min-h-[16px] rounded-md border px-1 py-0 text-left text-[7px] leading-tight transition"
                          style={item.active ? videoEditMutedStyle : videoEditPanelStyle}
                          title={`${item.label} · ${item.status} · ${item.detail}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleWorkbenchFeatureAuditClick(item.key);
                          }}
                        >
                          <span className="block truncate font-bold">{item.label}</span>
                          <span className="block truncate text-[8px] opacity-70">{item.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    data-video-edit-workbench-status-strip-legacy="true"
                    data-video-edit-workbench-property-inspector-legacy="true"
                    className="hidden"
                    style={{ ...videoEditPanelStyle, order: 5 }}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                      <span>属性检查器</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                        {selectedTimelineItemLabel}
                      </span>
                    </div>
                    <div
                      data-video-edit-selected-item-summary-legacy="true"
                      data-video-edit-selected-item-kind={selectedTimelineItemDetail?.kind || 'none'}
                      className="grid min-h-[34px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1"
                      style={selectedTimelineItemDetail ? videoEditMutedStyle : videoEditPanelStyle}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold" title={selectedTimelineItemDetail?.title || undefined}>
                          {selectedTimelineItemDetail?.title || '点击时间线素材后可直接编辑'}
                        </div>
                        <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                          {selectedTimelineItemDetail
                            ? `${selectedTimelineItemDetail.kindLabel} · ${selectedTimelineItemDetail.trackName}`
                            : '支持视频、音频、字幕和叠加素材'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {selectedTimelineItemDetail ? (
                          <>
                            <button
                              type="button"
                              data-video-edit-selected-summary-action="seek"
                              className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                              onClick={() => selectTimelineItemForWorkbench(selectedTimelineItemDetail.item)}
                            >
                              定位
                            </button>
                            <button
                              type="button"
                              data-video-edit-selected-summary-action="mute"
                              className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                              onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || !selectedTimelineItemDetail.canMute || selectedTimelineItemDetail.locked}
                            >
                              {selectedTimelineItemDetail.muted ? '取消静音' : '静音'}
                            </button>
                            <button
                              type="button"
                              data-video-edit-selected-summary-action="delete"
                              className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px] text-red-300"
                              onClick={() => removeTimelineItems([selectedTimelineItemDetail.item.id])}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              删除
                            </button>
                          </>
                        ) : (
                          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                            未选中
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      data-video-edit-workbench-cover-status-legacy="true"
                      data-video-edit-workbench-cover-set={d.coverImageUrl ? 'true' : 'false'}
                      data-video-edit-workbench-cover-time={Number(d.coverFrameTime || 0)}
                      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px]"
                      style={d.coverImageUrl ? videoEditMutedStyle : videoEditPanelStyle}
                    >
                      <div
                        className="grid h-9 w-11 place-items-center overflow-hidden rounded-md border bg-black/30"
                        style={{ borderColor: 'var(--t8-border)' }}
                      >
                        {d.coverImageUrl ? (
                          <img
                            data-video-edit-workbench-cover-thumb="true"
                            src={String(d.coverImageUrl)}
                            alt="封面帧"
                            className="h-full w-full object-cover"
                            draggable={false}
                            onDragStart={preventNativeMediaDrag}
                          />
                        ) : (
                          <Camera size={14} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-bold">封面帧</div>
                        <div className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                          {d.coverImageUrl ? `已设置 ${formatSeconds(Number(d.coverFrameTime || 0))}` : '未设置，可取当前预览帧'}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-video-edit-workbench-cover-action="capture"
                        className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                        onClick={() => void handleSnapshotFrame('cover')}
                        disabled={!selectedClip || !!busy}
                        title="把当前预览帧设为封面"
                      >
                        当前帧
                      </button>
                    </div>
                    {selectedTimelineItemDetail && (
                      <div
                        data-video-edit-selected-quick-panel-legacy="true"
                        data-video-edit-selected-quick-kind-legacy={selectedTimelineItemDetail.kind}
                        tabIndex={-1}
                        className="relative z-20 grid gap-2 rounded-lg border p-2"
                        style={videoEditMutedStyle}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                          <span className="truncate">选中项快控</span>
                          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                            {selectedTimelineItemDetail.kindLabel}
                          </span>
                        </div>
                        {selectedTimelineItemDetail.kind === 'text' && selectedTimelineItemDetail.asset ? (
                          (() => {
                            const item = selectedTimelineItemDetail.item;
                            const asset = selectedTimelineItemDetail.asset as VideoEditTimelineAsset;
                            const textValue = typeof asset.text === 'string' ? asset.text : (item.label || '');
                            const positionValue = asset.textPosition || 'bottom';
                            const fontSizeValue = Number.isFinite(Number(asset.textFontSize)) ? Number(asset.textFontSize) : 42;
                            const colorValue = /^#[0-9a-f]{6}$/i.test(String(asset.textColor || '')) ? String(asset.textColor) : '#ffffff';
                            const backgroundValue = typeof asset.textBackground === 'string' ? asset.textBackground : 'rgba(0,0,0,0.45)';
                            const patchSubtitleAsset = (
                              patch: Partial<VideoEditTimelineAsset>,
                              itemPatch: Partial<VideoEditTimelineItem> = {},
                            ) => patchTimelineAssetFields(item.id, item.assetId, patch, itemPatch);
                            return (
                              <div
                                data-video-edit-subtitle-quick-controls="true"
                                data-video-edit-subtitle-quick-current-position={positionValue}
                                data-video-edit-subtitle-quick-current-font-size={Math.round(fontSizeValue)}
                                data-video-edit-subtitle-quick-current-color={colorValue}
                                data-video-edit-subtitle-quick-current-background={backgroundValue}
                                className="grid gap-2"
                              >
                                <div className="truncate rounded-md border px-2 py-1 text-[11px]" style={videoEditPanelStyle} title={textValue}>
                                  {textValue || '空字幕'}
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  {[
                                    { value: 'top', label: '顶部' },
                                    { value: 'middle', label: '居中' },
                                    { value: 'bottom', label: '底部' },
                                  ].map((option) => (
                                    <button
                                      key={`quick-subtitle-${option.value}`}
                                      type="button"
                                      data-video-edit-subtitle-quick-position={option.value}
                                      className={`t8-mini-button nodrag justify-center px-2 py-1 text-[10px] ${positionValue === option.value ? 'is-active' : ''}`}
                                      onClick={() => patchSubtitleAsset({ textPosition: option.value })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-[minmax(0,1fr)_46px_minmax(92px,0.8fr)] items-end gap-1">
                                  <label className="block min-w-0">
                                    <FieldLabel>字号 {Math.round(fontSizeValue)}</FieldLabel>
                                    <input
                                      data-video-edit-subtitle-quick-font-size="true"
                                      className="nodrag nowheel w-full"
                                      type="range"
                                      min={18}
                                      max={96}
                                      step={1}
                                      value={fontSizeValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSubtitleAsset({ textFontSize: Number(event.target.value) })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    />
                                  </label>
                                  <label className="block">
                                    <FieldLabel>颜色</FieldLabel>
                                    <input
                                      data-video-edit-subtitle-quick-color="true"
                                      className="nodrag h-7 w-10 rounded border p-0"
                                      style={{ borderColor: 'var(--t8-border)' }}
                                      type="color"
                                      value={colorValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSubtitleAsset({ textColor: event.target.value })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    />
                                  </label>
                                  <label className="block min-w-0">
                                    <FieldLabel>底色</FieldLabel>
                                    <select
                                      data-video-edit-subtitle-quick-background="true"
                                      className="t8-select nodrag w-full px-1 py-1 text-[10px]"
                                      value={backgroundValue}
                                      onPointerDown={stopNodePointer}
                                      onChange={(event) => patchSubtitleAsset({ textBackground: event.target.value })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    >
                                      <option value="rgba(0,0,0,0.45)">半透明黑</option>
                                      <option value="rgba(15,23,42,0.72)">深色胶囊</option>
                                      <option value="rgba(255,255,255,0.72)">浅色胶囊</option>
                                      <option value="rgba(0,0,0,0)">无底色</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            );
                          })()
                        ) : selectedTimelineItemDetail.kind === 'audio' ? (
                          <div
                            data-video-edit-audio-quick-controls="true"
                            data-video-edit-audio-quick-current-volume={selectedTimelineItemDetail.volume}
                            data-video-edit-audio-quick-muted={selectedTimelineItemDetail.muted ? 'true' : 'false'}
                            className="grid gap-2"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                              <span>音量</span>
                              <span>{selectedTimelineItemDetail.muted ? '静音' : `${Math.round(selectedTimelineItemDetail.volume * 100)}%`}</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                              {[0, 0.5, 1, 1.5].map((value) => (
                                <button
                                  key={`quick-audio-${value}`}
                                  type="button"
                                  data-video-edit-audio-quick-volume={value}
                                  className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                                  onClick={() => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, value)}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  {value === 0 ? '静音' : `${Math.round(value * 100)}%`}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[10px]">
                              <button
                                type="button"
                                data-video-edit-audio-quick-toggle-muted="true"
                                className={`t8-mini-button nodrag justify-center px-2 py-1 text-[10px] ${selectedTimelineItemDetail.muted ? 'is-active' : ''}`}
                                onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              >
                                {selectedTimelineItemDetail.muted ? '取消静音' : '静音'}
                              </button>
                              <input
                                data-video-edit-audio-quick-volume-slider="true"
                                className="nodrag nowheel w-full"
                                type="range"
                                min={0}
                                max={2}
                                step={0.01}
                                value={selectedTimelineItemDetail.volume}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, Number(event.target.value))}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              />
                              <span>{Math.round(selectedTimelineItemDetail.volume * 100)}%</span>
                            </div>
                          </div>
                        ) : selectedTimelineItemDetail.kind === 'video' && isWorkbenchOverlayTimelineItem(selectedTimelineItemDetail.item) ? (
                          <div
                            data-video-edit-pip-quick-controls="true"
                            data-video-edit-pip-quick-current-x={clampVideoEditPipPercent(selectedTimelineItemDetail.item.x)}
                            data-video-edit-pip-quick-current-y={clampVideoEditPipPercent(selectedTimelineItemDetail.item.y)}
                            data-video-edit-pip-quick-current-scale={clampVideoEditPipScale(selectedTimelineItemDetail.item.scale)}
                            data-video-edit-pip-quick-current-opacity={clampVideoEditPipOpacity(selectedTimelineItemDetail.item.opacity)}
                            className="grid gap-2"
                          >
                            <div className="grid grid-cols-3 gap-1">
                              {VIDEO_EDIT_PIP_PRESETS.slice(0, 6).map((preset) => (
                                <button
                                  key={`quick-pip-${preset.id}`}
                                  type="button"
                                  data-video-edit-pip-quick-preset={preset.id}
                                  className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                                  onClick={() => patchTimelineItemFields(selectedTimelineItemDetail.item.id, {
                                    x: preset.x,
                                    y: preset.y,
                                    scale: preset.scale,
                                    opacity: preset.opacity,
                                  })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                >
                                  {preset.label.replace('小窗', '')}
                                </button>
                              ))}
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              <label className="block min-w-0">
                                <FieldLabel>X {Math.round(clampVideoEditPipPercent(selectedTimelineItemDetail.item.x))}</FieldLabel>
                                <input
                                  data-video-edit-pip-quick-x="true"
                                  className="nodrag nowheel w-full"
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={clampVideoEditPipPercent(selectedTimelineItemDetail.item.x)}
                                  onPointerDown={stopNodePointer}
                                  onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { x: Number(event.target.value) })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                />
                              </label>
                              <label className="block min-w-0">
                                <FieldLabel>Y {Math.round(clampVideoEditPipPercent(selectedTimelineItemDetail.item.y))}</FieldLabel>
                                <input
                                  data-video-edit-pip-quick-y="true"
                                  className="nodrag nowheel w-full"
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={clampVideoEditPipPercent(selectedTimelineItemDetail.item.y)}
                                  onPointerDown={stopNodePointer}
                                  onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { y: Number(event.target.value) })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                />
                              </label>
                              <label className="block min-w-0">
                                <FieldLabel>大小 {Math.round(clampVideoEditPipScale(selectedTimelineItemDetail.item.scale) * 100)}%</FieldLabel>
                                <input
                                  data-video-edit-pip-quick-scale="true"
                                  className="nodrag nowheel w-full"
                                  type="range"
                                  min={0.15}
                                  max={1.5}
                                  step={0.01}
                                  value={clampVideoEditPipScale(selectedTimelineItemDetail.item.scale)}
                                  onPointerDown={stopNodePointer}
                                  onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { scale: Number(event.target.value) })}
                                  disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[10px]">
                              <span>透明</span>
                              <input
                                data-video-edit-pip-quick-opacity="true"
                                className="nodrag nowheel w-full"
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={clampVideoEditPipOpacity(selectedTimelineItemDetail.item.opacity)}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => patchTimelineItemFields(selectedTimelineItemDetail.item.id, { opacity: Number(event.target.value) })}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              />
                              <span>{Math.round(clampVideoEditPipOpacity(selectedTimelineItemDetail.item.opacity) * 100)}%</span>
                            </div>
                          </div>
                        ) : (
                          <div data-video-edit-video-quick-controls="true" className="grid grid-cols-3 gap-1">
                            <button
                              type="button"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              onClick={() => splitTimelineItemAtPlayhead(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              拆分
                            </button>
                            <button
                              type="button"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || !selectedTimelineItemDetail.canMute || selectedTimelineItemDetail.locked}
                            >
                              {selectedTimelineItemDetail.muted ? '取消静音' : '静音'}
                            </button>
                            <button
                              type="button"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              onClick={() => duplicateTimelineItems([selectedTimelineItemDetail.item.id])}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              复制
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div data-video-edit-workbench-capability-list="true" className="flex flex-wrap gap-1 text-[10px]">
                      {renderPlanCapabilityBadges.map((badge) => (
                        <span
                          key={badge.key}
                          data-video-edit-workbench-capability={badge.key}
                          data-enabled={badge.active ? 'true' : 'false'}
                          className="min-w-0 rounded-full border px-2 py-0.5 font-semibold"
                          style={badge.active ? videoEditMutedStyle : videoEditPanelStyle}
                          title={`${badge.label} · ${badge.detail}`}
                        >
                          <span className="truncate">{badge.label}</span>
                          <span className="ml-1 opacity-65">{badge.detail}</span>
                        </span>
                      ))}
                    </div>
                    <div
                      data-video-edit-workbench-preview-contract="right-panel"
                      data-video-edit-workbench-preview-contract-location="inspector"
                      className="grid gap-1 rounded-lg border p-1.5 text-[10px]"
                      style={videoEditPanelStyle}
                    >
                      <div className="flex items-center justify-between gap-2 font-bold">
                        <span>预览 / 导出</span>
                        <span
                          data-video-edit-workbench-preview-limit-summary="true"
                          data-preview-pip-visible={activePreviewPipSegments.length}
                          data-preview-pip-total={overlayVideoCount}
                          data-preview-subtitle-visible={activePreviewTextSegments.length}
                          data-preview-subtitle-total={subtitleSegmentCount}
                          data-preview-audio-visible={activePreviewAudioSegments.length}
                          data-preview-audio-total={independentAudioCount}
                          data-preview-source-audio-active={(activePreviewSourceAudioSegment ? 1 : 0) + activePreviewLinkedSourceAudioSegments.length}
                          data-preview-source-audio-total={sourceAudioCount}
                          className="truncate opacity-65"
                        >
                          {previewLimitSummary}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {previewContractItems.map((item) => (
                          <span
                            key={item.key}
                            data-video-edit-workbench-preview-contract-item={item.key}
                            className="min-w-0 rounded-md border px-1.5 py-1"
                            style={videoEditMutedStyle}
                            title={`${item.label} · ${item.detail}`}
                          >
                            <span className="block truncate font-semibold">{item.label}</span>
                            <span className="block truncate opacity-70">{item.detail}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      data-video-edit-workbench-export-contract="true"
                      className="grid grid-cols-2 gap-1 rounded-lg border p-1.5 text-[10px]"
                      style={videoEditPanelStyle}
                    >
                      {workbenchExportContractItems.map((item) => (
                        <div
                          key={item.key}
                          data-video-edit-workbench-export-contract-item={item.key}
                          className="min-w-0 rounded-md border px-1.5 py-1"
                          style={videoEditMutedStyle}
                          title={`${item.label} · ${item.status}`}
                        >
                          <span className="block truncate font-bold">{item.label}</span>
                          <span className="block truncate opacity-70">{item.status}</span>
                        </div>
                      ))}
                    </div>
                    <div data-video-edit-workbench-track-overview="true" className="grid grid-cols-2 gap-1">
                      {workbenchTrackOverview.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          data-video-edit-workbench-track-overview-item={item.key}
                          data-enabled={item.active ? 'true' : 'false'}
                          className="nodrag grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1 text-left text-[11px] leading-tight"
                          style={item.active ? videoEditMutedStyle : videoEditPanelStyle}
                          title={`${item.label} · ${item.status} · ${item.detail}`}
                          onClick={() => {
                            if (item.key === 'video') workbenchTimelineViewportRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
                            if (item.key === 'overlay') focusWorkbenchMediaBin();
                            if (item.key === 'audio') openAudioTrackFilePicker();
                            if (item.key === 'subtitle') addSubtitleToTimeline();
                          }}
                          disabled={(item.key === 'audio' && (running || !!busy)) || (item.key === 'subtitle' && (running || busy === 'compose'))}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{item.label}</span>
                            <span className="block truncate text-[10px] opacity-70">{item.detail}</span>
                          </span>
                          <span className="grid shrink-0 gap-0.5 text-right">
                            <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold" style={{ borderColor: 'var(--t8-border)' }}>
                              {item.status}
                            </span>
                            <span
                              data-video-edit-workbench-track-overview-action={item.key}
                              className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                              style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text)' }}
                            >
                              {item.actionLabel}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div data-video-edit-workbench-creator-checklist="true" className="grid grid-cols-3 gap-1">
                      {workbenchCreatorChecklist.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          data-video-edit-workbench-creator-checklist-item={item.key}
                          data-enabled={item.active ? 'true' : 'false'}
                          className="nodrag min-h-[32px] rounded-lg border px-2 py-1 text-center text-[10px] font-semibold leading-tight"
                          style={item.active ? videoEditMutedStyle : videoEditPanelStyle}
                          disabled={item.disabled}
                          title={`${item.label} · ${item.status} · ${item.detail}`}
                          onClick={() => {
                            if (item.key === 'subtitle') addSubtitleToTimeline();
                            if (item.key === 'audio') openAudioTrackFilePicker();
                            if (item.key === 'export') void handleCompose();
                          }}
                        >
                          <span className="block truncate">{item.actionLabel}</span>
                          <span className="block truncate text-[9px] font-medium opacity-70">{item.status}</span>
                        </button>
                      ))}
                    </div>
                    <div
                      data-video-edit-workbench-batch-actions="true"
                      className="grid grid-cols-3 gap-1"
                    >
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="mute-main"
                        className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('mute-main')}
                        disabled={running || !!busy || mainVideoCount <= 0}
                        title="静音主视频轨及其绑定原声"
                      >
                        主轨静音
                      </button>
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="restore-main"
                        className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('restore-main')}
                        disabled={running || !!busy || mainVideoCount <= 0}
                        title="恢复主视频轨原声"
                      >
                        恢复原声
                      </button>
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="mute-independent-audio"
                        className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('mute-independent-audio')}
                        disabled={running || !!busy || independentAudioCount <= 0}
                        title="静音所有独立音频轨"
                      >
                        音频静音
                      </button>
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="restore-independent-audio"
                        className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('restore-independent-audio')}
                        disabled={running || !!busy || independentAudioCount <= 0}
                        title="恢复所有独立音频轨音量"
                      >
                        恢复音频
                      </button>
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="clear-independent-audio"
                        className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('clear-independent-audio')}
                        disabled={running || !!busy || independentAudioCount <= 0}
                        title="删除独立音频轨，不影响视频原声"
                      >
                        清音频
                      </button>
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="clear-subtitles"
                        className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('clear-subtitles')}
                        disabled={running || !!busy || subtitleSegmentCount <= 0}
                        title="删除所有字幕轨"
                      >
                        清字幕
                      </button>
                      <button
                        type="button"
                        data-video-edit-workbench-batch-action="clear-overlays"
                        className="t8-mini-button nodrag col-span-3 justify-center px-1 py-1 text-[10px]"
                        onClick={() => applyVideoEditTimelineBatchAction('clear-overlays')}
                        disabled={running || !!busy || overlayVideoCount <= 0}
                        title="删除所有 PIP / 叠加视频轨"
                      >
                        清空 PIP / 叠加轨
                      </button>
                    </div>
                  </div>
                  {renderPlanUnsupported.length > 0 && (
                    <div
                      data-video-edit-workbench-unsupported-list="true"
                      className="rounded-lg border px-2 py-1.5 text-[11px] font-semibold"
                      style={{ borderColor: '#f97316', background: 'rgba(251,146,60,.14)', color: '#fdba74' }}
                    >
                      当前剪辑台暂不支持导出：{renderPlanUnsupported.join('、')}
                    </div>
                  )}
                  <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                    <details
                      data-video-edit-selected-item-inspector="true"
                      data-video-edit-selected-item-kind={selectedTimelineItemDetail?.kind || 'none'}
                      className="relative rounded-lg border p-2"
                      style={videoEditPanelStyle}
                    >
                      <summary className="nodrag flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-bold">
                        <span className="truncate">选中素材详情</span>
                        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                          {selectedTimelineItemDetail?.kindLabel || '未选择'}
                        </span>
                      </summary>
                      <div className="mt-2">
                        {selectedTimelineItemDetail ? (
                          <div className="grid gap-2 text-[11px]">
                          <div className="min-w-0 truncate font-semibold" title={selectedTimelineItemDetail.title}>
                            {selectedTimelineItemDetail.title}
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>
                            <span className="truncate">轨道：{selectedTimelineItemDetail.trackName}</span>
                            <span>时长：{formatSeconds(selectedTimelineItemDetail.duration)}</span>
                            <span>时间线：{formatSeconds(selectedTimelineItemDetail.timelineStart)} - {formatSeconds(selectedTimelineItemDetail.timelineEnd)}</span>
                            <span>素材：{formatSeconds(selectedTimelineItemDetail.sourceIn)} - {formatSeconds(selectedTimelineItemDetail.sourceOut)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 text-[10px]">
                            <span
                              data-video-edit-selected-kind-chip="true"
                              className="rounded-full border px-1.5 py-0.5"
                              style={videoEditMutedStyle}
                            >
                              {selectedTimelineItemDetail.kindLabel}
                            </span>
                            {selectedTimelineItemDetail.muted && (
                              <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: '#f59e0b', color: '#fbbf24' }}>已静音</span>
                            )}
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            <button
                              type="button"
                              data-video-edit-selected-item-action="seek"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              title="定位到这个素材"
                              onClick={() => selectTimelineItemForWorkbench(selectedTimelineItemDetail.item)}
                            >
                              <MapPin size={11} />定位
                            </button>
                            <button
                              type="button"
                              data-video-edit-selected-item-action="split"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              title="在播放头拆分"
                              onClick={() => splitTimelineItemAtPlayhead(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || selectedTimelineItemDetail.kind === 'text' || selectedTimelineItemDetail.locked}
                            >
                              <Scissors size={11} />拆分
                            </button>
                            <button
                              type="button"
                              data-video-edit-selected-item-action="duplicate"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              title="复制到后方"
                              onClick={() => duplicateTimelineItems([selectedTimelineItemDetail.item.id])}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              <Copy size={11} />复制
                            </button>
                            <button
                              type="button"
                              data-video-edit-selected-item-action="mute"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px]"
                              title="静音或取消静音"
                              onClick={() => toggleTimelineItemMuted(selectedTimelineItemDetail.item.id)}
                              disabled={running || !!busy || !selectedTimelineItemDetail.canMute || selectedTimelineItemDetail.locked}
                            >
                              <VolumeX size={11} />静音
                            </button>
                            <button
                              type="button"
                              data-video-edit-selected-item-action="delete"
                              className="t8-mini-button nodrag justify-center px-1 py-1 text-[10px] text-red-300"
                              title="删除选中素材"
                              onClick={() => removeTimelineItems([selectedTimelineItemDetail.item.id])}
                              disabled={running || !!busy || selectedTimelineItemDetail.locked}
                            >
                              <Trash2 size={11} />删除
                            </button>
                          </div>
                          {selectedTimelineItemDetail.canMute && (
                            <div
                              data-video-edit-selected-audio-controls="true"
                              className="rounded-lg border p-2"
                              style={videoEditMutedStyle}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold">声音</span>
                                <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                                  {selectedTimelineItemDetail.muted ? '静音' : `${Math.round(selectedTimelineItemDetail.volume * 100)}%`}
                                </span>
                              </div>
                              <input
                                data-video-edit-selected-volume="true"
                                className="nodrag nowheel w-full"
                                type="range"
                                min={0}
                                max={2}
                                step={0.01}
                                value={selectedTimelineItemDetail.muted ? 0 : selectedTimelineItemDetail.volume}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, Number(event.target.value))}
                                disabled={running || !!busy || selectedTimelineItemDetail.locked}
                              />
                              <div className="mt-1 grid grid-cols-4 gap-1">
                                {[0, 0.5, 1, 1.5].map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    data-video-edit-selected-volume-preset={value}
                                    className="t8-mini-button nodrag justify-center px-1 py-0.5 text-[10px]"
                                    onClick={() => patchTimelineItemVolume(selectedTimelineItemDetail.item.id, value)}
                                    disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                  >
                                    {value === 0 ? '静音' : `${Math.round(value * 100)}%`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {selectedTimelineItemDetail.kind === 'text' && selectedTimelineItemDetail.asset && (
                            <div
                              data-video-edit-subtitle-style-controls="true"
                              className="rounded-lg border p-2"
                              style={videoEditMutedStyle}
                            >
                              {(() => {
                                const item = selectedTimelineItemDetail.item;
                                const asset = selectedTimelineItemDetail.asset as VideoEditTimelineAsset;
                                const textValue = typeof asset.text === 'string' ? asset.text : (item.label || '');
                                const positionValue = asset.textPosition || 'bottom';
                                const fontSizeValue = Number.isFinite(Number(asset.textFontSize)) ? Number(asset.textFontSize) : 42;
                                const colorValue = typeof asset.textColor === 'string' ? asset.textColor : '#ffffff';
                                const backgroundValue = typeof asset.textBackground === 'string' ? asset.textBackground : 'rgba(0,0,0,0.45)';
                                const patchSubtitleAsset = (
                                  patch: Partial<VideoEditTimelineAsset>,
                                  itemPatch: Partial<VideoEditTimelineItem> = {},
                                ) => patchTimelineAssetFields(item.id, item.assetId, patch, itemPatch);
                                return (
                                  <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] font-bold">字幕样式</span>
                                      <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                                        会烧录到成片
                                      </span>
                                    </div>
                                    <label className="block">
                                      <FieldLabel>字幕内容</FieldLabel>
                                      <textarea
                                        data-video-edit-subtitle-text="true"
                                        className="nodrag nowheel min-h-[52px] w-full resize-y rounded-lg border px-2 py-1 text-xs"
                                        style={videoEditPanelStyle}
                                        value={textValue}
                                        onPointerDown={stopNodePointer}
                                        disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                        onChange={(event) => {
                                          const nextText = event.target.value;
                                          patchSubtitleAsset({
                                            text: nextText,
                                            name: nextText.trim().length > 16 ? `${nextText.trim().slice(0, 16)}...` : (nextText.trim() || '字幕'),
                                          }, { label: nextText });
                                        }}
                                      />
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                      <label className="block">
                                        <FieldLabel>位置</FieldLabel>
                                        <select
                                          data-video-edit-subtitle-position="true"
                                          className="t8-select nodrag w-full px-2 py-1 text-xs"
                                          value={positionValue}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchSubtitleAsset({ textPosition: event.target.value })}
                                        >
                                          <option value="top">顶部</option>
                                          <option value="middle">居中</option>
                                          <option value="bottom">底部</option>
                                        </select>
                                      </label>
                                      <label className="block">
                                        <FieldLabel>底色</FieldLabel>
                                        <select
                                          data-video-edit-subtitle-background="true"
                                          className="t8-select nodrag w-full px-2 py-1 text-xs"
                                          value={backgroundValue}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchSubtitleAsset({ textBackground: event.target.value })}
                                        >
                                          <option value="rgba(0,0,0,0.45)">半透明黑</option>
                                          <option value="rgba(15,23,42,0.72)">深色胶囊</option>
                                          <option value="rgba(255,255,255,0.72)">浅色胶囊</option>
                                          <option value="rgba(0,0,0,0)">无底色</option>
                                        </select>
                                      </label>
                                      <label className="block">
                                        <FieldLabel>字号 {Math.round(fontSizeValue)}</FieldLabel>
                                        <input
                                          data-video-edit-subtitle-font-size="true"
                                          className="nodrag nowheel w-full"
                                          type="range"
                                          min={18}
                                          max={96}
                                          step={1}
                                          value={fontSizeValue}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchSubtitleAsset({ textFontSize: Number(event.target.value) })}
                                        />
                                      </label>
                                      <label className="block">
                                        <FieldLabel>颜色</FieldLabel>
                                        <div className="flex items-center gap-2">
                                          <input
                                            data-video-edit-subtitle-color="true"
                                            className="nodrag h-8 w-10 rounded border p-0"
                                            style={{ borderColor: 'var(--t8-border)' }}
                                            type="color"
                                            value={/^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue : '#ffffff'}
                                            onPointerDown={stopNodePointer}
                                            disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                            onChange={(event) => patchSubtitleAsset({ textColor: event.target.value })}
                                          />
                                          <span className="truncate text-[10px]" style={{ color: 'var(--t8-text-muted)' }}>{colorValue}</span>
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                          {selectedTimelineItemDetail.kind === 'video' && (
                            <div
                              data-video-edit-pip-controls="true"
                              className="rounded-lg border p-2"
                              style={videoEditMutedStyle}
                            >
                              {(() => {
                                const item = selectedTimelineItemDetail.item;
                                const itemX = clampVideoEditPipPercent(item.x);
                                const itemY = clampVideoEditPipPercent(item.y);
                                const itemScale = clampVideoEditPipScale(item.scale);
                                const itemOpacity = clampVideoEditPipOpacity(item.opacity);
                                const presetValue = VIDEO_EDIT_PIP_PRESETS.find((preset) => (
                                  Math.abs(preset.x - itemX) < 0.5
                                  && Math.abs(preset.y - itemY) < 0.5
                                  && Math.abs(preset.scale - itemScale) < 0.01
                                  && Math.abs(preset.opacity - itemOpacity) < 0.01
                                ))?.id || 'custom';
                                return (
                                  <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] font-bold">画面层</span>
                                      <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--t8-border)' }}>
                                        {itemScale >= 0.99 && itemX < 1 && itemY < 1 ? '全屏' : '画中画'}
                                      </span>
                                    </div>
                                    <label className="block">
                                      <FieldLabel>位置预设</FieldLabel>
                                      <select
                                        data-video-edit-pip-preset="true"
                                        className="t8-select nodrag w-full px-2 py-1 text-xs"
                                        value={presetValue}
                                        onPointerDown={stopNodePointer}
                                        disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                        onChange={(event) => {
                                          const preset = VIDEO_EDIT_PIP_PRESETS.find((entry) => entry.id === event.target.value);
                                          if (!preset) return;
                                          patchTimelineItemFields(item.id, {
                                            x: preset.x,
                                            y: preset.y,
                                            scale: preset.scale,
                                            opacity: preset.opacity,
                                          });
                                        }}
                                      >
                                        <option value="custom">自定义</option>
                                        {VIDEO_EDIT_PIP_PRESETS.map((preset) => (
                                          <option key={preset.id} value={preset.id}>{preset.label}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                      <label className="block">
                                        <FieldLabel>X {Math.round(itemX)}%</FieldLabel>
                                        <input
                                          data-video-edit-pip-x="true"
                                          className="nodrag nowheel w-full"
                                          type="range"
                                          min={0}
                                          max={100}
                                          step={1}
                                          value={itemX}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchTimelineItemFields(item.id, { x: Number(event.target.value) })}
                                        />
                                      </label>
                                      <label className="block">
                                        <FieldLabel>Y {Math.round(itemY)}%</FieldLabel>
                                        <input
                                          data-video-edit-pip-y="true"
                                          className="nodrag nowheel w-full"
                                          type="range"
                                          min={0}
                                          max={100}
                                          step={1}
                                          value={itemY}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchTimelineItemFields(item.id, { y: Number(event.target.value) })}
                                        />
                                      </label>
                                      <label className="block">
                                        <FieldLabel>缩放 {Math.round(itemScale * 100)}%</FieldLabel>
                                        <input
                                          data-video-edit-pip-scale="true"
                                          className="nodrag nowheel w-full"
                                          type="range"
                                          min={0.1}
                                          max={2}
                                          step={0.01}
                                          value={itemScale}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchTimelineItemFields(item.id, { scale: Number(event.target.value) })}
                                        />
                                      </label>
                                      <label className="block">
                                        <FieldLabel>透明 {Math.round(itemOpacity * 100)}%</FieldLabel>
                                        <input
                                          data-video-edit-pip-opacity="true"
                                          className="nodrag nowheel w-full"
                                          type="range"
                                          min={0}
                                          max={1}
                                          step={0.01}
                                          value={itemOpacity}
                                          onPointerDown={stopNodePointer}
                                          disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                          onChange={(event) => patchTimelineItemFields(item.id, { opacity: Number(event.target.value) })}
                                        />
                                      </label>
                                    </div>
                                    <button
                                      type="button"
                                      data-video-edit-pip-reset="true"
                                      className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]"
                                      onClick={() => patchTimelineItemFields(item.id, { x: 0, y: 0, scale: 1, opacity: 1 })}
                                      disabled={running || !!busy || selectedTimelineItemDetail.locked}
                                    >
                                      重置为全屏
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                          </div>
                        ) : (
                          <div className="grid min-h-[70px] place-items-center rounded-lg border border-dashed px-3 text-center text-xs" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                            选择时间线上的视频片段、独立音频或字幕文本后，可在这里快速定位、拆分、复制、静音或删除。
                          </div>
                        )}
                      </div>
                    </details>
                    <div
                      data-video-edit-workbench-clip-inspector="true"
                      data-video-edit-workbench-list-row="clip-controls"
                      className="rounded-lg border p-2"
                      style={videoEditPanelStyle}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold">
                        <span className="truncate">片段细剪</span>
                        <span className="shrink-0" style={{ color: 'var(--t8-text-muted)' }}>
                          {selectedClip ? formatSeconds(videoEditClipDuration(selectedClip)) : '待选择'}
                        </span>
                      </div>
                      {selectedClip ? (
                        <div className="grid gap-2">
                          <div className="truncate text-[11px] font-semibold">{selectedClip.name}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <FieldLabel>入点 {formatSeconds(selectedClip.trimStart)}</FieldLabel>
                              <input
                                className="nodrag nowheel w-full"
                                type="range"
                                min={0}
                                max={Math.max(1, selectedClip.duration || selectedClip.trimEnd || 1)}
                                step={0.1}
                                value={selectedClip.trimStart || 0}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => handleTrimStartChange(selectedClip.id, Number(event.target.value))}
                                disabled={running || !!busy || selectedClipTimelineLocked}
                              />
                            </label>
                            <label className="block">
                              <FieldLabel>出点 {formatSeconds(selectedClip.trimEnd || selectedClip.duration)}</FieldLabel>
                              <input
                                className="nodrag nowheel w-full"
                                type="range"
                                min={Math.min(selectedClip.trimStart + 0.1, selectedClip.duration || 1)}
                                max={Math.max(1, selectedClip.duration || selectedClip.trimEnd || 1)}
                                step={0.1}
                                value={selectedClip.trimEnd || selectedClip.duration || 1}
                                onPointerDown={stopNodePointer}
                                onChange={(event) => handleTrimEndChange(selectedClip.id, Number(event.target.value))}
                                disabled={running || !!busy || selectedClipTimelineLocked}
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" title="跳入点" onClick={() => seekPreviewTo(selectedClip.trimStart || 0)}><StepBack size={11} />入点</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" title="跳出点" onClick={() => seekPreviewTo(selectedClip.trimEnd || selectedClip.duration || 0)}><StepForward size={11} />出点</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" onClick={splitSelectedClipAtPlayhead} disabled={running || !!busy || selectedClipTimelineLocked} title="拆分片段：在播放头拆分当前片段" aria-label="播放头拆分 拆分片段"><Scissors size={11} />拆分</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" onClick={() => void loadClipTimelinePreview(selectedClip.id)} disabled={selectedClip.timelinePreviewStatus === 'loading'}>
                              {selectedClip.timelinePreviewStatus === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <Volume2 size={11} />}
                              帧条
                            </button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" title="设为封面帧" onClick={() => void handleSnapshotFrame('cover')} disabled={!!busy}><Camera size={11} />封面</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" onClick={() => void handleSnapshotFrame('output')} disabled={!!busy} title="截图到输出素材" aria-label="截图到输出素材"><ImagePlus size={11} />输出</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" onClick={() => void handleSnapshotFrame('target')} disabled={!!busy} title="截图到生成目标框" aria-label="截图到生成目标框"><ImagePlus size={11} />目标框</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" onClick={() => void handleSnapshotFrame('image-edit')} disabled={!!busy} title="截图到图像编辑" aria-label="截图到图像编辑"><ImagePlus size={11} />图像编辑</button>
                            <button className="t8-mini-button nodrag justify-center px-1.5 py-1 text-[10px]" title="替换素材并保留剪辑点" onClick={(event) => openReplacementPicker(selectedClip.id, event)} disabled={running || !!busy || selectedClipTimelineLocked}><UploadCloud size={11} />替换</button>
                          </div>
                          <div className="grid gap-2">
                            <textarea
                              className="nodrag nowheel min-h-[46px] w-full rounded-lg border px-2 py-1 text-[11px]"
                              style={videoEditPanelStyle}
                              value={selectedClip.storyboardNote || ''}
                              placeholder="分镜备注"
                              onMouseDown={stopNodeMouse}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => handleStoryboardNoteChange(selectedClip.id, event.target.value)}
                            />
                            <input
                              className="nodrag nowheel h-8 w-full rounded-lg border px-2 py-1 text-[11px]"
                              style={videoEditPanelStyle}
                              value={(selectedClip.storyboardTags || []).join(', ')}
                              placeholder="镜头标签"
                              onMouseDown={stopNodeMouse}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => handleStoryboardTagsChange(selectedClip.id, event.target.value)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid min-h-[72px] place-items-center rounded-lg border border-dashed px-3 text-center text-xs" style={{ borderColor: 'var(--t8-border)', color: 'var(--t8-text-muted)' }}>
                          先在片段库或时间线上选择一个片段
                        </div>
                      )}
                    </div>
                    <div data-video-edit-workbench-list-row="schemes" className="rounded-lg border p-2" style={videoEditPanelStyle}>
                      <div className="mb-2 flex items-center justify-between text-[11px] font-bold">
                        <span>剪辑方案</span>
                        <span style={{ color: 'var(--t8-text-muted)' }}>{selectedCreatorTemplate?.label || '手动剪辑'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                            <label className="block"><FieldLabel>方案</FieldLabel><select className="t8-select nodrag w-full px-2 py-1 text-xs" value={settings.creatorTemplate || 'manual'} onChange={(event) => update({ settings: applyVideoEditCreatorTemplate(settings, event.target.value as any) })}>{VIDEO_EDIT_CREATOR_TEMPLATES.map((item) => <option key={item.id} value={item.id} title={item.changes.join(' / ')}>{item.label}</option>)}</select></label>
                        <label className="block"><FieldLabel>转场</FieldLabel><select data-video-edit-workbench-transition-select="true" className="t8-select nodrag w-full px-2 py-1 text-xs" value={settings.transition} onChange={(event) => patchSettings({ transition: event.target.value as any })}>{VIDEO_EDIT_TRANSITION_GROUPS.map((group) => <optgroup key={group.id} label={group.label}>{group.options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
                        <label className="block"><FieldLabel>时长</FieldLabel><select className="t8-select nodrag w-full px-2 py-1 text-xs" value={String(settings.transitionDuration)} onChange={(event) => patchSettings({ transitionDuration: Number(event.target.value) })}>{TRANSITION_DURATION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                        <label className="block"><FieldLabel>滤镜</FieldLabel><select data-video-edit-workbench-filter-select="true" className="t8-select nodrag w-full px-2 py-1 text-xs" value={settings.filter} onChange={(event) => patchSettings({ filter: event.target.value as any })}>{FILTER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                        <label className="block"><FieldLabel>音频</FieldLabel><select className="t8-select nodrag w-full px-2 py-1 text-xs" value={settings.audio} onChange={(event) => patchSettings({ audio: event.target.value as any })}>{AUDIO_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 opacity-80">
                        <span className="rounded-full border px-1 py-0.5 text-[9px]" style={videoEditMutedStyle}>方案会修改</span>
                        {(selectedCreatorTemplate?.changes || []).map((change) => (
                          <span key={`workbench-selected-${change}`} data-video-edit-scheme-change="true" className="rounded-full border px-1 py-0.5 text-[9px]" style={videoEditMutedStyle}>
                            {change}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        <button className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]" onClick={sortClipsByName} disabled={!clips.length || running}>排序</button>
                        <button className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]" onClick={distributeToTargetDuration} disabled={!clips.length || running}>均分</button>
                        <button className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]" onClick={compressToTargetDuration} disabled={!clips.length || running}>压缩</button>
                        <button className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]" onClick={exportVideoEditRecipe} disabled={!clips.length}>导出配方</button>
                        <button className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]" onClick={() => recipeInputRef.current?.click()}>导入配方</button>
                        <button className="t8-mini-button nodrag justify-center px-2 py-1 text-[10px]" onClick={trimClipsToDefaultDuration} disabled={!clips.length || running}>套餐</button>
                      </div>
                    </div>
                    {(localError || d.error) && <div className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{localError || String(d.error)}</div>}
                  </div>
                </aside>
              </div>
            </div>
          </main>
        </section>
        {timelineContextMenu && (
          <div
            data-video-edit-timeline-context-menu="true"
            data-locked={timelineContextMenuItemLocked ? 'true' : 'false'}
            className="fixed z-[10060] min-w-[170px] rounded-xl border p-1.5 text-xs shadow-2xl"
            style={{
              left: `clamp(8px, ${timelineContextMenu.x}px, calc(100vw - 190px))`,
              top: `clamp(8px, ${timelineContextMenu.y}px, calc(100vh - 220px))`,
              borderColor: 'var(--t8-border)',
              background: 'var(--t8-video-edit-panel, var(--t8-surface))',
              color: 'var(--t8-text)',
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              data-video-edit-timeline-context-action="seek"
              className="t8-mini-button nodrag w-full justify-start px-2 py-1.5"
              onPointerDown={stopTimelineContextActionPointer}
              onClick={(event) => handleTimelineContextActionClick(event, 'seek')}
              onKeyDown={(event) => handleTimelineContextActionKeyDown(event, 'seek')}
            >
              <MapPin size={12} />定位播放头
            </button>
            <button
              type="button"
              data-video-edit-timeline-context-action="split"
              className="t8-mini-button nodrag w-full justify-start px-2 py-1.5"
              onPointerDown={stopTimelineContextActionPointer}
              onClick={(event) => handleTimelineContextActionClick(event, 'split')}
              onKeyDown={(event) => handleTimelineContextActionKeyDown(event, 'split')}
              disabled={running || !!busy || timelineContextMenuItemLocked}
            >
              <Scissors size={12} />拆分{timelineContextKindLabel}
            </button>
            <button
              type="button"
              data-video-edit-timeline-context-action="duplicate"
              className="t8-mini-button nodrag w-full justify-start px-2 py-1.5"
              onPointerDown={stopTimelineContextActionPointer}
              onClick={(event) => handleTimelineContextActionClick(event, 'duplicate')}
              onKeyDown={(event) => handleTimelineContextActionKeyDown(event, 'duplicate')}
              disabled={running || !!busy || timelineContextMenuItemLocked}
            >
              <Copy size={12} />复制{timelineContextKindLabel}
            </button>
            <button
              type="button"
              data-video-edit-timeline-context-action="mute"
              className="t8-mini-button nodrag w-full justify-start px-2 py-1.5"
              onPointerDown={stopTimelineContextActionPointer}
              onClick={(event) => handleTimelineContextActionClick(event, 'mute')}
              onKeyDown={(event) => handleTimelineContextActionKeyDown(event, 'mute')}
              disabled={running || !!busy || timelineContextMenuItemLocked || timelineContextMenuItem?.kind === 'text'}
            >
              <VolumeX size={12} />静音/取消
            </button>
            <button
              type="button"
              data-video-edit-timeline-context-action="delete"
              className="t8-mini-button nodrag w-full justify-start px-2 py-1.5 text-red-300"
              onPointerDown={stopTimelineContextActionPointer}
              onClick={(event) => handleTimelineContextActionClick(event, 'delete')}
              onKeyDown={(event) => handleTimelineContextActionKeyDown(event, 'delete')}
              disabled={running || !!busy || timelineContextMenuItemLocked}
            >
              <Trash2 size={12} />删除{timelineContextKindLabel}
            </button>
            <button type="button" data-video-edit-timeline-context-action="close" className="t8-secondary-button nodrag mt-1 w-full justify-center px-2 py-1.5" onClick={closeTimelineContextMenu}>
              关闭
            </button>
          </div>
        )}
      </div>
      </VideoEditVisible>,
      document.body,
    )}
    {imageEditSnapshotUrl && (
      <ImageEditModal
        srcUrl={imageEditSnapshotUrl}
        secondaryActionNodeId={id}
        secondaryActionNodeType="video-edit"
        queueSecondaryAction={queueSecondaryAction}
        onClose={() => setImageEditSnapshotUrl('')}
        onProduce={handleImageEditSnapshotProduce}
      />
    )}
    </>
    </VideoEditVisible>
  );
}

export default memo(VideoEditNode);
