import { fileNameFromUrl, type MediaItem } from './mediaCollection';
import type { SendableMaterial } from './sendMaterials';
import {
  buildVideoEditTimelineRenderPlan,
  normalizeVideoEditTimeline,
  resolveVideoEditTimelinePlayback,
  timelineItemDuration as getVideoEditTimelineItemDuration,
  videoEditTimelineTimeFromPlaybackSourceTime,
  type VideoEditTimelineAsset,
  type VideoEditTimelineItem,
  type VideoEditTimelinePlayback,
  type VideoEditTimelineRenderPlan,
  type VideoEditTimelineV2,
} from './videoTimeline';
import videoTransitionCatalog from '../../shared/videoTransitions.json';

export type VideoEditAspect = 'first' | 'source' | '16:9' | '9:16' | '1:1' | '3:4' | '4:3' | '21:9' | '2:1';
export type VideoEditResolution = 'first' | '720p' | '1080p' | '2k' | '4k';
export type VideoEditTransition = string;
export type VideoEditFilter = 'none' | 'bright' | 'contrast' | 'warm' | 'cool' | 'mono' | 'cinematic';
export type VideoEditAudioMode = 'keep' | 'mute' | 'first' | 'master-audio-replace';
export type VideoEditJobStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';
export type VideoEditOutputPresetId = 'custom' | 'vertical-short' | 'wide-video' | 'square-social' | 'portrait-poster' | 'classic-horizontal' | 'cinema-wide' | 'panorama-wide';
export type VideoEditCreatorTemplateId = 'manual' | 'quick-montage' | 'talking-mix' | 'product-showcase' | 'before-after' | 'batch-showcase';
export type VideoEditClipHealthLevel = 'ok' | 'warn' | 'block';
export type VideoEditImportSortMode = 'current' | 'name' | 'source' | 'duration-asc' | 'duration-desc';
export type VideoEditDefaultTrimMode = 'full' | 'first' | 'middle';
export type VideoEditAudioFilter = 'all' | 'with-audio' | 'without-audio';
export type VideoEditSafeAreaOverlayId = 'none' | 'douyin-kuaishou' | 'xiaohongshu' | 'bilibili-vertical' | 'youtube-shorts';

export interface VideoEditTransitionDefinition {
  id: string;
  label: string;
  category: string;
  quality: string;
  xfade?: string;
  hint?: string;
  legacy?: boolean;
}

export interface VideoEditTransitionGroup {
  id: string;
  label: string;
  options: VideoEditTransitionDefinition[];
}

export interface VideoEditPlatformExportPackage {
  id: string;
  label: string;
  hint: string;
  aspect: VideoEditAspect;
  resolution: VideoEditResolution;
  presetId?: VideoEditOutputPresetId;
}

export interface VideoEditSafeAreaOverlay {
  id: VideoEditSafeAreaOverlayId;
  label: string;
  hint: string;
  zones: Array<{
    label: string;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    width?: number;
    height?: number;
  }>;
}

export interface VideoEditRecipe {
  kind: 't8-video-edit-recipe';
  version: 1;
  createdAt: string;
  clips: VideoEditClip[];
  settings: VideoEditSettings;
  timelineV2?: VideoEditTimelineV2;
  renderPlan?: VideoEditTimelineRenderPlan;
  note?: string;
}

const VIDEO_TRANSITION_CATALOG = videoTransitionCatalog as {
  categories: Array<{ id: string; label: string }>;
  transitions: VideoEditTransitionDefinition[];
};

export const VIDEO_EDIT_TRANSITIONS = VIDEO_TRANSITION_CATALOG.transitions;
export const VIDEO_EDIT_TRANSITION_GROUPS: VideoEditTransitionGroup[] = VIDEO_TRANSITION_CATALOG.categories
  .map((category) => ({
    ...category,
    options: VIDEO_EDIT_TRANSITIONS.filter((item) => item.category === category.id),
  }))
  .filter((group) => group.options.length > 0);

export function videoEditPreviewFilterCss(filter: VideoEditFilter | string | undefined): string {
  switch (filter) {
    case 'bright':
      return 'brightness(1.08) saturate(1.04)';
    case 'contrast':
      return 'contrast(1.18) saturate(1.05)';
    case 'warm':
      return 'sepia(0.08) saturate(1.08) hue-rotate(-6deg) brightness(1.02)';
    case 'cool':
      return 'saturate(1.06) hue-rotate(8deg) brightness(1.01)';
    case 'mono':
      return 'grayscale(1)';
    case 'cinematic':
      return 'contrast(1.12) saturate(0.95) brightness(0.98)';
    default:
      return '';
  }
}

export interface VideoEditClip {
  id: string;
  timelineItemId?: string;
  sourceClipId?: string;
  assetId?: string;
  sourceNodeId?: string;
  sourceCanvasId?: string;
  sourceCanvasName?: string;
  sourceNodeLabel?: string;
  sourceCreatedAt?: string;
  sourceLabel: string;
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
  timelinePreviewStatus?: 'idle' | 'loading' | 'ready' | 'error';
  timelinePreviewError?: string;
  hasAudio?: boolean;
  trimStart: number;
  trimEnd?: number;
  muted?: boolean;
  storyboardNote?: string;
  storyboardTags?: string[];
  status: 'ready' | 'probing' | 'missing' | 'error';
  error?: string;
}

export interface VideoEditSettings {
  aspect: VideoEditAspect;
  resolution: VideoEditResolution;
  transition: VideoEditTransition;
  transitionDuration: number;
  filter: VideoEditFilter;
  audio: VideoEditAudioMode;
  targetDuration?: number;
  defaultClipDuration?: number;
  importSortMode?: VideoEditImportSortMode;
  defaultTrimMode?: VideoEditDefaultTrimMode;
  audioFilter?: VideoEditAudioFilter;
  safeAreaOverlay?: VideoEditSafeAreaOverlayId;
  autoCreateOutputNode: boolean;
  outputPreset?: VideoEditOutputPresetId;
  creatorTemplate?: VideoEditCreatorTemplateId;
}

export interface VideoEditOutput {
  videoUrl: string;
  directVideoUrl?: string;
  audioUrl?: string;
  directAudioUrl?: string;
  name: string;
  audioName?: string;
  createdAt?: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  audioSize?: number;
  transitionEngine?: string;
  transitionName?: string;
  transitionQuality?: string;
  transitionDuration?: number;
}

export interface VideoEditOutputVersion extends VideoEditOutput {
  id: string;
  settings: VideoEditSettings;
  label: string;
  jobId?: string;
}

export interface VideoEditJob {
  id?: string;
  status: VideoEditJobStatus;
  progress: number;
  message?: string;
}

export interface VideoEditNodeData {
  clips: VideoEditClip[];
  timelineV2?: VideoEditTimelineV2;
  selectedClipId?: string;
  output?: VideoEditOutput;
  outputVersions?: VideoEditOutputVersion[];
  settings: VideoEditSettings;
  job?: VideoEditJob;
  videoUrl?: string;
  videoUrls?: string[];
  directVideoUrl?: string;
  directVideoUrls?: string[];
  draftVideoUrls?: string[];
  directDraftVideoUrls?: string[];
  audioUrl?: string;
  audioUrls?: string[];
  directAudioUrl?: string;
  directAudioUrls?: string[];
  audioFileName?: string;
  audioFileSize?: number;
  audioMime?: string;
  coverImageUrl?: string;
  coverDirectImageUrl?: string;
  coverFrameTime?: number;
  coverFileName?: string;
  coverFileSize?: number;
  fileName?: string;
  fileSize?: number;
  mime?: string;
  status?: string;
  error?: string;
}

export const DEFAULT_VIDEO_EDIT_SETTINGS: VideoEditSettings = {
  aspect: 'first',
  resolution: 'first',
  transition: 'none',
  transitionDuration: 0.8,
  filter: 'none',
  audio: 'keep',
  targetDuration: 0,
  defaultClipDuration: 5,
  importSortMode: 'current',
  defaultTrimMode: 'full',
  audioFilter: 'all',
  safeAreaOverlay: 'none',
  autoCreateOutputNode: false,
  outputPreset: 'custom',
  creatorTemplate: 'manual',
};

export const DEFAULT_VIDEO_EDIT_DATA: VideoEditNodeData = {
  clips: [],
  timelineV2: undefined,
  selectedClipId: '',
  output: undefined,
  outputVersions: [],
  settings: DEFAULT_VIDEO_EDIT_SETTINGS,
  job: { status: 'idle', progress: 0 },
  videoUrl: '',
  videoUrls: [],
  directVideoUrl: '',
  directVideoUrls: [],
  draftVideoUrls: [],
  directDraftVideoUrls: [],
  audioUrl: '',
  audioUrls: [],
  directAudioUrl: '',
  directAudioUrls: [],
  audioFileName: '',
  audioFileSize: 0,
  audioMime: '',
  coverImageUrl: '',
  coverDirectImageUrl: '',
  coverFrameTime: 0,
  coverFileName: '',
  coverFileSize: 0,
  fileName: '',
  fileSize: 0,
  mime: 'video/mp4',
  status: 'idle',
  error: '',
};

export function createVideoEditAssetId(url?: string, name?: string): string {
  const source = `${url || ''}|${name || ''}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return `asset-${Math.abs(hash).toString(36) || '0'}`;
}

export const VIDEO_EDIT_OUTPUT_PRESETS: Array<{
  id: VideoEditOutputPresetId;
  label: string;
  hint: string;
  aspect: VideoEditAspect;
  resolution: VideoEditResolution;
}> = [
  { id: 'custom', label: '自定义', hint: '保留当前设置', aspect: 'first', resolution: 'first' },
  { id: 'vertical-short', label: '抖音/快手', hint: '竖屏短视频', aspect: '9:16', resolution: '1080p' },
  { id: 'wide-video', label: 'B站/YouTube', hint: '横屏成片', aspect: '16:9', resolution: '1080p' },
  { id: 'square-social', label: '方形社媒', hint: '封面和动态', aspect: '1:1', resolution: '1080p' },
  { id: 'portrait-poster', label: '竖版海报', hint: '3:4 人像展示', aspect: '3:4', resolution: '1080p' },
  { id: 'classic-horizontal', label: '横版展示', hint: '4:3 经典比例', aspect: '4:3', resolution: '1080p' },
  { id: 'cinema-wide', label: '电影宽屏', hint: '21:9 氛围短片', aspect: '21:9', resolution: '1080p' },
  { id: 'panorama-wide', label: '宽幅/全景', hint: '2:1 展示流', aspect: '2:1', resolution: '1080p' },
];

export const VIDEO_EDIT_CREATOR_TEMPLATES: Array<{
  id: VideoEditCreatorTemplateId;
  label: string;
  hint: string;
  changes: string[];
  patch: Partial<VideoEditSettings>;
}> = [
  { id: 'manual', label: '手动剪辑', hint: '不改当前参数', changes: ['保留当前设置'], patch: { creatorTemplate: 'manual' } },
  { id: 'quick-montage', label: '快速混剪', hint: '轻转场 + 电影感', changes: ['转场:淡入淡出', '滤镜:电影感', '音频:保留原声'], patch: { transition: 'fade', transitionDuration: 0.5, filter: 'cinematic', audio: 'keep', creatorTemplate: 'quick-montage' } },
  { id: 'talking-mix', label: '口播混剪', hint: '竖屏 + 保留第一段声音', changes: ['比例:9:16', '分辨率:1080p', '音频:第一段'], patch: { aspect: '9:16', resolution: '1080p', transition: 'fade', transitionDuration: 0.4, filter: 'bright', audio: 'first', creatorTemplate: 'talking-mix', outputPreset: 'vertical-short' } },
  { id: 'product-showcase', label: '产品展示', hint: '横屏 + 对比增强', changes: ['比例:16:9', '转场:交叉淡化', '滤镜:对比增强'], patch: { aspect: '16:9', resolution: '1080p', transition: 'crossfade', transitionDuration: 0.6, filter: 'contrast', audio: 'keep', creatorTemplate: 'product-showcase', outputPreset: 'wide-video' } },
  { id: 'before-after', label: '前后对比', hint: '黑场分隔重点镜头', changes: ['转场:黑场', '滤镜:无', '音频:静音'], patch: { transition: 'black', transitionDuration: 0.4, filter: 'none', audio: 'mute', creatorTemplate: 'before-after' } },
  { id: 'batch-showcase', label: '批量合集', hint: '滑入过渡 + 方形发布', changes: ['比例:1:1', '转场:滑入', '滤镜:暖色'], patch: { aspect: '1:1', resolution: '1080p', transition: 'slide', transitionDuration: 0.5, filter: 'warm', audio: 'mute', creatorTemplate: 'batch-showcase', outputPreset: 'square-social' } },
];

export const VIDEO_EDIT_PLATFORM_EXPORT_PACKAGES: VideoEditPlatformExportPackage[] = [
  { id: 'douyin-kuaishou', label: '抖音/快手', hint: '9:16 1080p 竖屏短视频', aspect: '9:16', resolution: '1080p', presetId: 'vertical-short' },
  { id: 'bilibili-youtube', label: 'B站/YouTube', hint: '16:9 1080p 横屏成片', aspect: '16:9', resolution: '1080p', presetId: 'wide-video' },
  { id: 'xiaohongshu-square', label: '小红书方图', hint: '1:1 1080p 方形动态', aspect: '1:1', resolution: '1080p', presetId: 'square-social' },
  { id: 'vertical-poster', label: '竖版海报视频', hint: '9:16 1080p 适合封面与海报流', aspect: '9:16', resolution: '1080p', presetId: 'vertical-short' },
  { id: 'wide-display', label: '横版展示', hint: '16:9 1080p 保留完整横向画面', aspect: '16:9', resolution: '1080p', presetId: 'wide-video' },
  { id: 'draft-preview', label: '草稿小样', hint: '16:9 720p 快速预览导出', aspect: '16:9', resolution: '720p', presetId: 'wide-video' },
];

export const VIDEO_EDIT_SAFE_AREA_OVERLAYS: VideoEditSafeAreaOverlay[] = [
  { id: 'none', label: '关闭', hint: '不显示遮挡参考', zones: [] },
  {
    id: 'douyin-kuaishou',
    label: '抖音/快手',
    hint: '右侧互动按钮、底部标题字幕和顶部账号区域参考',
    zones: [
      { label: '顶部账号', top: 0, left: 0, width: 100, height: 10 },
      { label: '右侧按钮', top: 22, right: 0, width: 16, height: 50 },
      { label: '底部文案', bottom: 0, left: 0, width: 100, height: 22 },
    ],
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    hint: '顶部返回/搜索、底部操作栏和右侧收藏区域参考',
    zones: [
      { label: '顶部栏', top: 0, left: 0, width: 100, height: 12 },
      { label: '右侧操作', top: 32, right: 0, width: 14, height: 38 },
      { label: '底部互动', bottom: 0, left: 0, width: 100, height: 16 },
    ],
  },
  {
    id: 'bilibili-vertical',
    label: 'B站竖屏',
    hint: '竖屏播放页顶部信息、右侧操作和底部弹幕/标题参考',
    zones: [
      { label: '顶部信息', top: 0, left: 0, width: 100, height: 11 },
      { label: '右侧浮层', top: 28, right: 0, width: 15, height: 44 },
      { label: '底部弹幕', bottom: 0, left: 0, width: 100, height: 18 },
    ],
  },
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    hint: 'Shorts 右侧按钮、底部标题和顶部状态区域参考',
    zones: [
      { label: '顶部状态', top: 0, left: 0, width: 100, height: 9 },
      { label: '右侧按钮', top: 24, right: 0, width: 17, height: 52 },
      { label: '底部标题', bottom: 0, left: 0, width: 100, height: 20 },
    ],
  },
];

const ASPECTS: VideoEditAspect[] = ['first', 'source', '16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '2:1'];
const RESOLUTIONS: VideoEditResolution[] = ['first', '720p', '1080p', '2k', '4k'];
const TRANSITIONS: VideoEditTransition[] = VIDEO_EDIT_TRANSITIONS.map((item) => item.id);
const FILTERS: VideoEditFilter[] = ['none', 'bright', 'contrast', 'warm', 'cool', 'mono', 'cinematic'];
const AUDIO_MODES: VideoEditAudioMode[] = ['keep', 'mute', 'first', 'master-audio-replace'];
const IMPORT_SORT_MODES: VideoEditImportSortMode[] = ['current', 'name', 'source', 'duration-asc', 'duration-desc'];
const DEFAULT_TRIM_MODES: VideoEditDefaultTrimMode[] = ['full', 'first', 'middle'];
const AUDIO_FILTERS: VideoEditAudioFilter[] = ['all', 'with-audio', 'without-audio'];
const SAFE_AREA_OVERLAYS = VIDEO_EDIT_SAFE_AREA_OVERLAYS.map((item) => item.id);
const OUTPUT_PRESET_IDS = VIDEO_EDIT_OUTPUT_PRESETS.map((item) => item.id);
const CREATOR_TEMPLATE_IDS = VIDEO_EDIT_CREATOR_TEMPLATES.map((item) => item.id);

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeVideoEditSettings(input: unknown): VideoEditSettings {
  const raw = input && typeof input === 'object' ? input as Partial<VideoEditSettings> : {};
  return {
    aspect: pick(raw.aspect, ASPECTS, DEFAULT_VIDEO_EDIT_SETTINGS.aspect),
    resolution: pick(raw.resolution, RESOLUTIONS, DEFAULT_VIDEO_EDIT_SETTINGS.resolution),
    transition: pick(raw.transition, TRANSITIONS, DEFAULT_VIDEO_EDIT_SETTINGS.transition),
    transitionDuration: clampNumber(raw.transitionDuration, 0.1, 2, DEFAULT_VIDEO_EDIT_SETTINGS.transitionDuration),
    filter: pick(raw.filter, FILTERS, DEFAULT_VIDEO_EDIT_SETTINGS.filter),
    audio: pick(raw.audio, AUDIO_MODES, DEFAULT_VIDEO_EDIT_SETTINGS.audio),
    targetDuration: clampNumber(raw.targetDuration, 0, 60 * 60, DEFAULT_VIDEO_EDIT_SETTINGS.targetDuration || 0),
    defaultClipDuration: clampNumber(raw.defaultClipDuration, 0, 60 * 60, DEFAULT_VIDEO_EDIT_SETTINGS.defaultClipDuration || 5),
    importSortMode: pick(raw.importSortMode, IMPORT_SORT_MODES, DEFAULT_VIDEO_EDIT_SETTINGS.importSortMode || 'current'),
    defaultTrimMode: pick(raw.defaultTrimMode, DEFAULT_TRIM_MODES, DEFAULT_VIDEO_EDIT_SETTINGS.defaultTrimMode || 'full'),
    audioFilter: pick(raw.audioFilter, AUDIO_FILTERS, DEFAULT_VIDEO_EDIT_SETTINGS.audioFilter || 'all'),
    safeAreaOverlay: pick(raw.safeAreaOverlay, SAFE_AREA_OVERLAYS, DEFAULT_VIDEO_EDIT_SETTINGS.safeAreaOverlay || 'none'),
    autoCreateOutputNode: raw.autoCreateOutputNode === true,
    outputPreset: pick(raw.outputPreset, OUTPUT_PRESET_IDS, DEFAULT_VIDEO_EDIT_SETTINGS.outputPreset || 'custom'),
    creatorTemplate: pick(raw.creatorTemplate, CREATOR_TEMPLATE_IDS, DEFAULT_VIDEO_EDIT_SETTINGS.creatorTemplate || 'manual'),
  };
}

export function applyVideoEditOutputPreset(settings: VideoEditSettings, presetId: VideoEditOutputPresetId): VideoEditSettings {
  const preset = VIDEO_EDIT_OUTPUT_PRESETS.find((item) => item.id === presetId);
  if (!preset || preset.id === 'custom') {
    return { ...settings, outputPreset: 'custom' };
  }
  return {
    ...settings,
    aspect: preset.aspect,
    resolution: preset.resolution,
    outputPreset: preset.id,
  };
}

export function applyVideoEditCreatorTemplate(settings: VideoEditSettings, templateId: VideoEditCreatorTemplateId): VideoEditSettings {
  const template = VIDEO_EDIT_CREATOR_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return settings;
  return normalizeVideoEditSettings({
    ...settings,
    ...template.patch,
    creatorTemplate: template.id,
  });
}

export function normalizeVideoEditClips(input: unknown): VideoEditClip[] {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set<string>();
  const out: VideoEditClip[] = [];
  input.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const raw = item as Partial<VideoEditClip>;
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) return;
    const baseId = typeof raw.id === 'string' && raw.id ? raw.id : `clip-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    let id = baseId;
    if (seenIds.has(id)) {
      id = `${baseId}-${index}-${Math.random().toString(36).slice(2, 6)}`;
    }
    seenIds.add(id);
    const duration = Number(raw.duration);
    const trimStart = clampNumber(raw.trimStart, 0, Math.max(0, Number.isFinite(duration) ? duration : 60 * 60), 0);
    const trimEnd = raw.trimEnd === undefined ? undefined : clampNumber(raw.trimEnd, trimStart + 0.1, 24 * 60 * 60, Number.isFinite(duration) ? duration : trimStart + 1);
    out.push({
      id,
      assetId: typeof raw.assetId === 'string' && raw.assetId ? raw.assetId : createVideoEditAssetId(url, raw.name),
      sourceNodeId: typeof raw.sourceNodeId === 'string' ? raw.sourceNodeId : undefined,
      sourceCanvasId: typeof raw.sourceCanvasId === 'string' ? raw.sourceCanvasId : undefined,
      sourceCanvasName: typeof raw.sourceCanvasName === 'string' ? raw.sourceCanvasName : undefined,
      sourceNodeLabel: typeof raw.sourceNodeLabel === 'string' ? raw.sourceNodeLabel : undefined,
      sourceCreatedAt: typeof raw.sourceCreatedAt === 'string' ? raw.sourceCreatedAt : undefined,
      sourceLabel: typeof raw.sourceLabel === 'string' && raw.sourceLabel ? raw.sourceLabel : '视频素材',
      name: typeof raw.name === 'string' && raw.name ? raw.name : fileNameFromUrl(url),
      url,
      directUrl: typeof raw.directUrl === 'string' ? raw.directUrl : undefined,
      mime: typeof raw.mime === 'string' ? raw.mime : undefined,
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : undefined,
      height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : undefined,
      size: Number.isFinite(Number(raw.size)) ? Number(raw.size) : undefined,
      thumbnailUrl: typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl : undefined,
      filmstripUrls: Array.isArray(raw.filmstripUrls)
        ? raw.filmstripUrls.filter((url): url is string => typeof url === 'string' && Boolean(url)).slice(0, 16)
        : [],
      filmstripTimes: Array.isArray(raw.filmstripTimes)
        ? raw.filmstripTimes.map((time) => Number(time)).filter((time) => Number.isFinite(time) && time >= 0).slice(0, 16)
        : [],
      waveformPeaks: Array.isArray(raw.waveformPeaks)
        ? raw.waveformPeaks
            .map((peak) => clampNumber(peak, 0, 1, 0))
            .slice(0, 200)
        : [],
      timelinePreviewStatus: raw.timelinePreviewStatus === 'loading' || raw.timelinePreviewStatus === 'ready' || raw.timelinePreviewStatus === 'error'
        ? raw.timelinePreviewStatus
        : 'idle',
      timelinePreviewError: typeof raw.timelinePreviewError === 'string' ? raw.timelinePreviewError : undefined,
      hasAudio: typeof raw.hasAudio === 'boolean' ? raw.hasAudio : undefined,
      trimStart,
      trimEnd,
      muted: raw.muted === true,
      storyboardNote: typeof raw.storyboardNote === 'string' ? raw.storyboardNote : undefined,
      storyboardTags: Array.isArray(raw.storyboardTags)
        ? raw.storyboardTags
            .map((tag) => typeof tag === 'string' ? tag.trim() : '')
            .filter(Boolean)
            .slice(0, 12)
        : [],
      status: raw.status === 'probing' || raw.status === 'missing' || raw.status === 'error' ? raw.status : 'ready',
      error: typeof raw.error === 'string' ? raw.error : undefined,
    });
  });
  return out;
}

export function totalVideoEditDuration(clips: VideoEditClip[]): number {
  return clips.reduce((sum, clip) => sum + videoEditClipDuration(clip), 0);
}

export function videoEditClipDuration(clip: VideoEditClip): number {
  const end = Number.isFinite(clip.trimEnd || 0) && clip.trimEnd ? clip.trimEnd : clip.duration;
  if (!Number.isFinite(end || 0)) return 0;
  return Math.max(0, Number(end) - Math.max(0, clip.trimStart || 0));
}

export function videoEditClipHealth(clip: VideoEditClip, settings: VideoEditSettings): {
  level: VideoEditClipHealthLevel;
  label: string;
  reason: string;
} {
  if (!clip.url) return { level: 'block', label: '缺失', reason: '片段没有视频地址' };
  if (clip.status === 'error' || clip.status === 'missing') return { level: 'block', label: '异常', reason: clip.error || '视频素材不可用' };
  if (clip.status === 'probing' || !clip.duration) return { level: 'warn', label: '探测', reason: '正在读取时长、缩略图和音轨信息' };
  const duration = videoEditClipDuration(clip);
  if (duration <= 0.1) return { level: 'block', label: '过短', reason: '裁剪后片段时长太短，无法合成' };
  const transition = settings.transition === 'none' ? 0 : settings.transitionDuration;
  if (transition > 0 && duration <= transition + 0.05) {
    return { level: 'warn', label: '短片', reason: '片段短于当前转场时长，建议缩短转场或放大片段' };
  }
  if (settings.audio !== 'mute' && clip.hasAudio === false) {
    return { level: 'warn', label: '无声', reason: '该片段没有音轨，合成时会自动补静音' };
  }
  return { level: 'ok', label: '正常', reason: '片段可用于合成' };
}

export function videoEditTimelineWidth(clip: VideoEditClip, zoom = 1): number {
  const duration = videoEditClipDuration(clip);
  const safeZoom = Math.max(0.6, Math.min(4, Number(zoom) || 1));
  return Math.round(Math.max(140, Math.min(520, (duration || 3) * 26 * safeZoom)));
}

export function videoEditTimelineItemWidth(item: VideoEditTimelineItem, zoom = 1): number {
  const duration = getVideoEditTimelineItemDuration(item);
  const safeZoom = Math.max(0.6, Math.min(4, Number(zoom) || 1));
  return Math.round(Math.max(140, Math.min(760, (duration || 3) * 32 * safeZoom)));
}

export function videoEditClipsFromTimelineRenderPlan(plan: VideoEditTimelineRenderPlan): VideoEditClip[] {
  return plan.clips.map((segment) => ({
    id: `timeline-${segment.sourceItemId}`,
    assetId: segment.assetId,
    sourceNodeId: segment.sourceNodeId,
    sourceCanvasId: segment.sourceCanvasId,
    sourceLabel: segment.sourceLabel || '时间线片段',
    name: segment.name,
    url: segment.url,
    directUrl: segment.directUrl || segment.url,
    mime: segment.mime,
    duration: segment.duration,
    width: segment.width,
    height: segment.height,
    size: segment.size,
    thumbnailUrl: segment.thumbnailUrl,
    filmstripUrls: segment.filmstripUrls,
    filmstripTimes: segment.filmstripTimes,
    waveformPeaks: segment.waveformPeaks,
    timelinePreviewStatus: 'ready',
    hasAudio: segment.hasAudio,
    trimStart: segment.trimStart,
    trimEnd: segment.trimEnd,
    muted: segment.muted,
    status: 'ready',
  }));
}

function findSourceClipForTimelineAsset(clips: VideoEditClip[], asset?: VideoEditTimelineAsset | null, item?: VideoEditTimelineItem | null): VideoEditClip | undefined {
  if (!asset && !item) return undefined;
  return clips.find((clip) => (
    (!!item?.assetId && (clip.assetId === item.assetId || `asset-${clip.id}` === item.assetId))
    || (!!asset?.url && clip.url === asset.url)
  ));
}

export function buildVideoEditTimelinePreviewClip(
  playback: VideoEditTimelinePlayback,
  inputClips: VideoEditClip[],
): VideoEditClip | null {
  const item = playback.item;
  const asset = playback.asset;
  if (!item || !asset?.url) return null;
  const clips = normalizeVideoEditClips(inputClips);
  const source = findSourceClipForTimelineAsset(clips, asset, item);
  const fallbackName = item.label || asset.name || source?.name || item.id;
  return {
    id: source?.id || `timeline-${item.id}`,
    timelineItemId: item.id,
    sourceClipId: source?.id,
    assetId: item.assetId,
    sourceNodeId: source?.sourceNodeId || asset.sourceNodeId,
    sourceCanvasId: source?.sourceCanvasId || asset.sourceCanvasId,
    sourceCanvasName: source?.sourceCanvasName,
    sourceNodeLabel: source?.sourceNodeLabel,
    sourceCreatedAt: source?.sourceCreatedAt,
    sourceLabel: source?.sourceLabel || asset.sourceLabel || '时间线片段',
    name: fallbackName,
    url: asset.url,
    directUrl: asset.directUrl || source?.directUrl || asset.url,
    mime: asset.mime || source?.mime,
    duration: asset.duration || source?.duration || playback.trimEnd,
    width: asset.width || source?.width,
    height: asset.height || source?.height,
    size: asset.size || source?.size,
    thumbnailUrl: asset.thumbnailUrl || source?.thumbnailUrl,
    filmstripUrls: asset.filmstripUrls ? [...asset.filmstripUrls] : source?.filmstripUrls,
    filmstripTimes: asset.filmstripTimes ? [...asset.filmstripTimes] : source?.filmstripTimes,
    waveformPeaks: asset.waveformPeaks ? [...asset.waveformPeaks] : source?.waveformPeaks,
    timelinePreviewStatus: source?.timelinePreviewStatus || 'ready',
    timelinePreviewError: source?.timelinePreviewError,
    hasAudio: asset.hasAudio ?? source?.hasAudio,
    trimStart: playback.trimStart,
    trimEnd: playback.trimEnd,
    muted: item.muted ?? source?.muted,
    storyboardNote: source?.storyboardNote,
    storyboardTags: source?.storyboardTags,
    status: source?.status || 'ready',
    error: source?.error,
  };
}

export function syncVideoEditClipsFromTimelineItem(
  clips: VideoEditClip[],
  timeline: VideoEditTimelineV2,
  timelineItemId: string,
  clipId: string,
): VideoEditClip[] {
  const item = timeline.items.find((entry) => entry.id === timelineItemId);
  if (!item) return clips;
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    return {
      ...clip,
      trimStart: item.sourceIn,
      trimEnd: item.sourceOut,
      muted: item.muted ?? clip.muted,
    };
  });
}

export function videoEditTimelineHealthSummary(clips: VideoEditClip[], settings: VideoEditSettings): {
  ok: number;
  warnings: number;
  blocks: number;
  label: string;
} {
  const counts = clips.reduce((acc, clip) => {
    const health = videoEditClipHealth(clip, settings);
    if (health.level === 'block') acc.blocks += 1;
    else if (health.level === 'warn') acc.warnings += 1;
    else acc.ok += 1;
    return acc;
  }, { ok: 0, warnings: 0, blocks: 0 });
  const label = counts.blocks
    ? `${counts.blocks} 个阻塞`
    : counts.warnings
      ? `${counts.warnings} 个提醒`
      : clips.length
        ? '全部正常'
        : '暂无片段';
  return { ...counts, label };
}

export function videoEditDurationBudget(clips: VideoEditClip[], settings: VideoEditSettings): {
  total: number;
  target: number;
  remaining: number;
  ratio: number;
  status: 'none' | 'under' | 'fit' | 'over';
  label: string;
} {
  const total = totalVideoEditDuration(clips);
  const target = Math.max(0, Number(settings.targetDuration || 0));
  if (!target) return { total, target: 0, remaining: 0, ratio: 0, status: 'none', label: '未设置目标时长' };
  const remaining = Number((target - total).toFixed(2));
  const ratio = total > 0 ? total / target : 0;
  const tolerance = Math.max(0.5, target * 0.03);
  const status = Math.abs(remaining) <= tolerance ? 'fit' : remaining > 0 ? 'under' : 'over';
  const label = status === 'fit'
    ? '接近目标'
    : status === 'under'
      ? `还差 ${Math.abs(remaining).toFixed(1)}s`
      : `超出 ${Math.abs(remaining).toFixed(1)}s`;
  return { total, target, remaining, ratio, status, label };
}

export function compressVideoEditClipsToTargetDuration(clips: VideoEditClip[], targetDuration: number): VideoEditClip[] {
  const target = Math.max(0, Number(targetDuration || 0));
  const total = totalVideoEditDuration(clips);
  if (!target || !total || total <= target) return clips;
  const ratio = target / total;
  return clips.map((clip) => {
    const start = Math.max(0, Number(clip.trimStart || 0));
    const currentDuration = videoEditClipDuration(clip);
    const nextDuration = Math.max(0.1, currentDuration * ratio);
    const maxEnd = Number.isFinite(Number(clip.duration)) && clip.duration ? Number(clip.duration) : start + nextDuration;
    return {
      ...clip,
      trimStart: start,
      trimEnd: Number(Math.min(maxEnd, start + nextDuration).toFixed(2)),
    };
  });
}

export function distributeVideoEditClipsToTargetDuration(clips: VideoEditClip[], targetDuration: number): VideoEditClip[] {
  if (!clips.length || !Number.isFinite(Number(targetDuration)) || targetDuration <= 0) return clips;
  const evenDuration = Math.max(0.1, targetDuration / clips.length);
  return clips.map((clip) => {
    const start = Math.max(0, Number(clip.trimStart || 0));
    const sourceEnd = Number.isFinite(Number(clip.duration)) && clip.duration ? Number(clip.duration) : start + evenDuration;
    return {
      ...clip,
      trimStart: start,
      trimEnd: Number(Math.min(sourceEnd, start + evenDuration).toFixed(2)),
    };
  });
}

export function sortVideoEditClipsByName(clips: VideoEditClip[]): VideoEditClip[] {
  return clips.slice().sort((a, b) => {
    const byName = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    if (byName !== 0) return byName;
    return String(a.id || '').localeCompare(String(b.id || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

export function trimVideoEditClipsToFirstSeconds(clips: VideoEditClip[], seconds?: number): VideoEditClip[] {
  const target = Number(seconds);
  if (!clips.length || !Number.isFinite(target) || target <= 0) return clips;
  const clipDuration = Math.max(0.1, target);
  return clips.map((clip) => {
    const sourceDuration = Number(clip.duration);
    const maxEnd = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : clipDuration;
    return {
      ...clip,
      trimStart: 0,
      trimEnd: Number(Math.min(maxEnd, clipDuration).toFixed(2)),
    };
  });
}

export function trimVideoEditClipsToMiddleSeconds(clips: VideoEditClip[], seconds?: number): VideoEditClip[] {
  const target = Number(seconds);
  if (!clips.length || !Number.isFinite(target) || target <= 0) return clips;
  const clipDuration = Math.max(0.1, target);
  return clips.map((clip) => {
    const sourceDuration = Number(clip.duration);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
      return { ...clip, trimStart: 0, trimEnd: Number(clipDuration.toFixed(2)) };
    }
    const useDuration = Math.min(sourceDuration, clipDuration);
    const start = Math.max(0, (sourceDuration - useDuration) / 2);
    return {
      ...clip,
      trimStart: Number(start.toFixed(2)),
      trimEnd: Number((start + useDuration).toFixed(2)),
    };
  });
}

function trimVideoEditClipsToFullDuration(clips: VideoEditClip[]): VideoEditClip[] {
  return clips.map((clip) => ({
    ...clip,
    trimStart: 0,
    trimEnd: Number.isFinite(Number(clip.duration)) && Number(clip.duration) > 0 ? Number(clip.duration) : undefined,
  }));
}

function sortVideoEditClipsBySource(clips: VideoEditClip[]): VideoEditClip[] {
  return clips.slice().sort((a, b) => {
    const sourceA = [a.sourceCanvasName, a.sourceNodeLabel, a.sourceLabel, a.sourceNodeId, a.name, a.id].filter(Boolean).join(' / ');
    const sourceB = [b.sourceCanvasName, b.sourceNodeLabel, b.sourceLabel, b.sourceNodeId, b.name, b.id].filter(Boolean).join(' / ');
    return sourceA.localeCompare(sourceB, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

function sortVideoEditClipsByDuration(clips: VideoEditClip[], direction: 'asc' | 'desc'): VideoEditClip[] {
  return clips.slice().sort((a, b) => {
    const durationA = videoEditClipDuration(a) || Number(a.duration || 0);
    const durationB = videoEditClipDuration(b) || Number(b.duration || 0);
    const byDuration = durationA - durationB;
    if (byDuration !== 0) return direction === 'asc' ? byDuration : -byDuration;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

export function applyVideoEditImportCleanup(
  clips: VideoEditClip[],
  options: {
    sortMode?: VideoEditImportSortMode;
    trimMode?: VideoEditDefaultTrimMode;
    seconds?: number;
    audioFilter?: VideoEditAudioFilter;
  } = {},
): VideoEditClip[] {
  let next = normalizeVideoEditClips(clips);
  const audioFilter = options.audioFilter || 'all';
  if (audioFilter === 'with-audio') {
    next = next.filter((clip) => clip.hasAudio === true);
  } else if (audioFilter === 'without-audio') {
    next = next.filter((clip) => clip.hasAudio === false);
  }

  switch (options.sortMode || 'current') {
    case 'name':
      next = sortVideoEditClipsByName(next);
      break;
    case 'source':
      next = sortVideoEditClipsBySource(next);
      break;
    case 'duration-asc':
      next = sortVideoEditClipsByDuration(next, 'asc');
      break;
    case 'duration-desc':
      next = sortVideoEditClipsByDuration(next, 'desc');
      break;
    case 'current':
    default:
      next = next.slice();
      break;
  }

  switch (options.trimMode || 'full') {
    case 'first':
      return trimVideoEditClipsToFirstSeconds(next, options.seconds);
    case 'middle':
      return trimVideoEditClipsToMiddleSeconds(next, options.seconds);
    case 'full':
    default:
      return trimVideoEditClipsToFullDuration(next);
  }
}

function stripInlinePreview(clip: VideoEditClip): VideoEditClip {
  return {
    ...clip,
    thumbnailUrl: typeof clip.thumbnailUrl === 'string' && clip.thumbnailUrl.startsWith('data:')
      ? undefined
      : clip.thumbnailUrl,
  };
}

export function buildVideoEditRecipe(input: {
  clips: VideoEditClip[];
  settings: VideoEditSettings;
  timelineV2?: VideoEditTimelineV2;
  renderPlan?: VideoEditTimelineRenderPlan;
  note?: string;
}): VideoEditRecipe {
  return {
    kind: 't8-video-edit-recipe',
    version: 1,
    createdAt: new Date().toISOString(),
    clips: normalizeVideoEditClips(input.clips).map(stripInlinePreview),
    settings: normalizeVideoEditSettings(input.settings),
    timelineV2: input.timelineV2,
    renderPlan: input.renderPlan,
    note: typeof input.note === 'string' ? input.note : undefined,
  };
}

export function normalizeVideoEditRecipe(input: unknown): VideoEditRecipe | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<VideoEditRecipe>;
  if (raw.kind !== 't8-video-edit-recipe') return null;
  const clips = normalizeVideoEditClips(raw.clips).map(stripInlinePreview);
  const timelineV2 = raw.timelineV2 ? normalizeVideoEditTimeline(raw.timelineV2, clips) : undefined;
  const renderPlan = raw.renderPlan && typeof raw.renderPlan === 'object'
    ? raw.renderPlan as VideoEditTimelineRenderPlan
    : undefined;
  return {
    kind: 't8-video-edit-recipe',
    version: 1,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
    clips,
    settings: normalizeVideoEditSettings(raw.settings),
    timelineV2,
    renderPlan,
    note: typeof raw.note === 'string' ? raw.note : undefined,
  };
}

export function findVideoEditRecipeMissingAssets(recipe: VideoEditRecipe): VideoEditClip[] {
  return recipe.clips.filter((clip) => !clip.url || clip.status === 'missing' || clip.status === 'error');
}

export function normalizeVideoEditOutputVersions(input: unknown): VideoEditOutputVersion[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Partial<VideoEditOutputVersion>;
    const videoUrl = typeof raw.videoUrl === 'string' ? raw.videoUrl : '';
    const audioUrl = typeof raw.audioUrl === 'string' ? raw.audioUrl : '';
    if (!videoUrl && !audioUrl) return [];
    return [{
      id: typeof raw.id === 'string' && raw.id ? raw.id : `video-edit-version-${index}`,
      label: typeof raw.label === 'string' && raw.label ? raw.label : `版本 ${index + 1}`,
      videoUrl,
      directVideoUrl: typeof raw.directVideoUrl === 'string' ? raw.directVideoUrl : videoUrl,
      audioUrl,
      directAudioUrl: typeof raw.directAudioUrl === 'string' ? raw.directAudioUrl : audioUrl,
      name: typeof raw.name === 'string' && raw.name ? raw.name : fileNameFromUrl(videoUrl || audioUrl),
      audioName: typeof raw.audioName === 'string' ? raw.audioName : undefined,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
      duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : undefined,
      width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : undefined,
      height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : undefined,
      size: Number.isFinite(Number(raw.size)) ? Number(raw.size) : undefined,
      audioSize: Number.isFinite(Number(raw.audioSize)) ? Number(raw.audioSize) : undefined,
      transitionEngine: typeof raw.transitionEngine === 'string' ? raw.transitionEngine : undefined,
      transitionName: typeof raw.transitionName === 'string' ? raw.transitionName : undefined,
      transitionQuality: typeof raw.transitionQuality === 'string' ? raw.transitionQuality : undefined,
      transitionDuration: Number.isFinite(Number(raw.transitionDuration)) ? Number(raw.transitionDuration) : undefined,
      jobId: typeof raw.jobId === 'string' ? raw.jobId : undefined,
      settings: normalizeVideoEditSettings(raw.settings),
    }];
  });
}

export function pushVideoEditOutputVersion(
  existing: unknown,
  output: Partial<VideoEditOutputVersion>,
  settings: VideoEditSettings,
  maxVersions = 8,
): VideoEditOutputVersion[] {
  const versions = normalizeVideoEditOutputVersions(existing);
  const videoUrl = typeof output.videoUrl === 'string' ? output.videoUrl : '';
  const audioUrl = typeof output.audioUrl === 'string' ? output.audioUrl : '';
  if (!videoUrl && !audioUrl) return versions.slice(0, maxVersions);
  const now = new Date().toISOString();
  const version: VideoEditOutputVersion = {
    id: output.id || `video-edit-version-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: output.label || `成片 ${versions.length + 1}`,
    videoUrl,
    directVideoUrl: output.directVideoUrl || videoUrl,
    audioUrl,
    directAudioUrl: output.directAudioUrl || audioUrl,
    name: output.name || fileNameFromUrl(videoUrl || audioUrl),
    audioName: output.audioName,
    createdAt: output.createdAt || now,
    duration: output.duration,
    width: output.width,
    height: output.height,
    size: output.size,
    audioSize: output.audioSize,
    transitionEngine: output.transitionEngine,
    transitionName: output.transitionName,
    transitionQuality: output.transitionQuality,
    transitionDuration: output.transitionDuration,
    jobId: output.jobId,
    settings: normalizeVideoEditSettings(settings),
  };
  return [version, ...versions.filter((item) => item.videoUrl !== version.videoUrl || item.audioUrl !== version.audioUrl)].slice(0, Math.max(1, maxVersions));
}

export function createVideoEditClipFromMediaItem(item: MediaItem, extra: Partial<VideoEditClip> = {}): VideoEditClip {
  return {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceLabel: extra.sourceLabel || '视频素材',
    name: item.name || fileNameFromUrl(item.url),
    url: item.url,
    directUrl: extra.directUrl || item.url,
    mime: item.mime,
    size: item.size,
    trimStart: 0,
    status: 'ready',
    ...extra,
    assetId: extra.assetId || createVideoEditAssetId(item.url, item.name),
  };
}

export function replaceVideoEditClipAsset(
  clip: VideoEditClip,
  item: MediaItem,
  extra: Partial<VideoEditClip> = {},
): VideoEditClip {
  const previousTrimStart = Math.max(0, Number(clip.trimStart || 0));
  const previousTrimEnd = Number.isFinite(Number(clip.trimEnd)) && Number(clip.trimEnd) > previousTrimStart
    ? Number(clip.trimEnd)
    : undefined;
  const replacementSourceLabel = extra.sourceLabel || clip.sourceLabel || '替换素材';

  return {
    ...clip,
    ...extra,
    id: clip.id,
    assetId: extra.assetId || createVideoEditAssetId(item.url, item.name),
    sourceLabel: replacementSourceLabel,
    sourceCreatedAt: extra.sourceCreatedAt || new Date().toISOString(),
    name: item.name || fileNameFromUrl(item.url),
    url: item.url,
    directUrl: extra.directUrl || item.url,
    mime: item.mime,
    duration: extra.duration,
    width: extra.width,
    height: extra.height,
    size: item.size,
    thumbnailUrl: extra.thumbnailUrl,
    filmstripUrls: [],
    filmstripTimes: [],
    waveformPeaks: [],
    timelinePreviewStatus: 'idle',
    timelinePreviewError: '',
    hasAudio: extra.hasAudio,
    trimStart: previousTrimStart,
    trimEnd: previousTrimEnd,
    status: 'probing',
    error: '',
  };
}

export function createVideoEditClipFromSendable(item: SendableMaterial): VideoEditClip | null {
  if (item.kind !== 'video' || !item.url) return null;
  return createVideoEditClipFromMediaItem(
    {
      kind: 'video',
      url: item.url,
      name: item.name || fileNameFromUrl(item.url),
      size: item.size,
      mime: item.mime,
    },
        {
          sourceNodeId: item.sourceNodeId,
          sourceCanvasId: item.sourceCanvasId,
          sourceLabel: item.sourceType || '发送素材',
          sourceCreatedAt: new Date().toISOString(),
        },
      );
}

export function appendVideoEditClips(existing: unknown, incoming: VideoEditClip[]): VideoEditClip[] {
  const base = normalizeVideoEditClips(existing);
  const seenIds = new Set(base.map((clip) => clip.id));
  const next = [...base];
  incoming.forEach((clip, index) => {
    if (!clip.url) return;
    let id = clip.id || `clip-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    if (seenIds.has(id)) {
      id = `${id}-${index}-${Math.random().toString(36).slice(2, 6)}`;
    }
    seenIds.add(id);
    next.push({ ...clip, id });
  });
  return next;
}

export {
  applyVideoEditTimelineControllerCommand,
  applyVideoEditTimelineControllerToTimeline,
  applyVideoEditTimelineInteractionCommand,
  buildVideoEditTimelineRenderPlan,
  createVideoEditTimelineControllerState,
  createVideoEditTimelineFromClips,
  detectVideoEditTimelineConflicts,
  insertVideoEditTimelineRange,
  keepVideoEditTimelineTimeInView,
  moveVideoEditTimelineItem,
  normalizeVideoEditAudioFade,
  normalizeVideoEditAudioVolumeCurve,
  normalizeVideoEditTimeline,
      normalizeVideoEditTimelineControllerState,
  overwriteVideoEditTimelineRange,
  reorderVideoEditTimelineWithClips,
  resolveVideoEditTimelineSnap,
      resolveVideoEditTimelinePlayback,
      resizeVideoEditTimelineItem,
  snapVideoEditTimelineTime,
  splitVideoEditTimelineItem,
  syncVideoEditTimelineWithClips,
      timelineItemDuration,
  videoEditAudioEnvelopeMultiplier,
  videoEditTimelineTimeFromPlaybackSourceTime,
  videoEditTimelineTimeToX,
  videoEditTimelineXToTime,
  videoEditTimelineDuration,
  VIDEO_EDIT_AUDIO_VOLUME_CURVES,
} from './videoTimeline';
export type {
  VideoEditAudioEnvelopeSegment,
  VideoEditAudioVolumeCurve,
  VideoEditTimelineAsset,
  VideoEditTimelineConflict,
  VideoEditTimelineControllerCommand,
  VideoEditTimelineControllerDragState,
  VideoEditTimelineCoordinateOptions,
  VideoEditTimelineInteractionCommand,
  VideoEditTimelineInteractionOptions,
  VideoEditTimelineInteractionState,
  VideoEditTimelineKeepTimeInViewOptions,
  VideoEditTimelineControllerOptions,
  VideoEditTimelineControllerSelectMode,
  VideoEditTimelineControllerState,
  VideoEditTimelineControllerTool,
  VideoEditTimelineItem,
  VideoEditTimelineKind,
  VideoEditTimelineRenderAudioSegment,
  VideoEditTimelineRenderPlan,
  VideoEditTimelineRenderSegment,
  VideoEditTimelineRenderTrack,
  VideoEditTimelineSnapKind,
  VideoEditTimelineSnapOptions,
  VideoEditTimelineSnapResult,
  VideoEditTimelineSnapTarget,
  VideoEditTimelineTrack,
  VideoEditTimelineV2,
} from './videoTimeline';
