import type { SeedanceSubmitRequest, SeedanceTaskProvider } from '../services/generation';
import type { MediaMention, MediaMentionKind } from '../components/nodes/mediaMentions';

export type DirectorStoryboardFrameMode = 'auto' | 'first' | 'firstlast' | 'multiframe';
export type DirectorStoryboardJobKind = 'shot' | 'bridge';
export type DirectorStoryboardJobStatus = 'success' | 'error' | 'cancelled';
export type DirectorStoryboardReferenceKind = 'image' | 'video' | 'audio';
export type DirectorStoryboardBridgeSourceMode = 'auto-video' | 'manual-video' | 'manual-image';
export type DirectorStoryboardBridgeStatus =
  | 'idle'
  | 'extracting'
  | 'ready'
  | 'submitting'
  | 'polling'
  | 'success'
  | 'error'
  | 'cancelled';

export interface DirectorStoryboardMentionMaterial {
  kind: MediaMentionKind;
  url: string;
  label?: string;
  mentionKey?: string;
  mentionToken?: string;
}

export interface DirectorStoryboardReferenceItem {
  kind: DirectorStoryboardReferenceKind;
  url: string;
}

export interface DirectorStoryboardShot {
  id: string;
  title: string;
  durationSec: number;
  prompt: string;
  useUpstreamPrompt?: boolean;
  automaticImageBindings?: Array<{url:string;label:string}>;
  negativePrompt?: string;
  promptMentions?: MediaMention[];
  frameMode: DirectorStoryboardFrameMode;
  localRefImages: string[];
  localRefVideos: string[];
  localRefAudios: string[];
  localRefOrder: DirectorStoryboardReferenceItem[];
  seed?: number;
  modelOverride?: string;
  ratioOverride?: string;
  resolutionOverride?: string;
  status?: string;
  taskId?: string | null;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'> | null;
  videoUrl?: string | null;
  error?: string | null;
}

export interface DirectorStoryboardInputShot {
  id?: string;
  title?: string;
  durationSec?: number;
  prompt?: string;
  useUpstreamPrompt?: boolean;
  automaticImageBindings?: Array<{url:string;label:string}>;
  negativePrompt?: string;
  promptMentions?: MediaMention[];
  frameMode?: DirectorStoryboardFrameMode;
  localRefImages?: string[];
  localRefVideos?: string[];
  localRefAudios?: string[];
  localRefOrder?: DirectorStoryboardReferenceItem[];
  seed?: number;
  modelOverride?: string;
  ratioOverride?: string;
  resolutionOverride?: string;
  status?: string;
  taskId?: string | null;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'> | null;
  videoUrl?: string | null;
  error?: string | null;
}

export type DirectorStoryboardShotInputPatch = Pick<
  DirectorStoryboardShot,
  'prompt' | 'negativePrompt' | 'promptMentions' | 'frameMode' | 'localRefImages' | 'localRefVideos' | 'localRefAudios' | 'localRefOrder' | 'useUpstreamPrompt' | 'automaticImageBindings'
>;

export interface DirectorStoryboardBridge {
  id: string;
  fromShotId: string;
  toShotId: string;
  durationSec: number;
  prompt: string;
  sourceMode: DirectorStoryboardBridgeSourceMode;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  previousVideoUrl?: string;
  nextVideoUrl?: string;
  status?: DirectorStoryboardBridgeStatus;
  taskId?: string | null;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'> | null;
  videoUrl?: string | null;
  error?: string | null;
}

export interface DirectorStoryboardInputBridge {
  id?: string;
  fromShotId?: string;
  toShotId?: string;
  durationSec?: number;
  prompt?: string;
  sourceMode?: DirectorStoryboardBridgeSourceMode;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  previousVideoUrl?: string;
  nextVideoUrl?: string;
  status?: DirectorStoryboardBridgeStatus;
  taskId?: string | null;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'> | null;
  videoUrl?: string | null;
  error?: string | null;
}

export interface DirectorStoryboardSettings {
  model: string;
  taskProvider?: SeedanceTaskProvider;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  returnLastFrame: boolean;
  watermark: boolean;
  webSearch: boolean;
  seed: number;
  bridgeEnabled?: boolean;
  bridgeDurationSec?: number;
  bridgePrompt?: string;
  providerParams?: Record<string, any>;
}

export interface BuildDirectorShotPayloadContext {
  upstreamPrompt?: string;
  mentionMaterials?: DirectorStoryboardMentionMaterial[];
  globalImages?: string[];
  globalVideos?: string[];
  globalAudios?: string[];
}

export interface DirectorStoryboardJob {
  id: string;
  shotId: string;
  order: number;
  kind: DirectorStoryboardJobKind;
  title: string;
  payload: SeedanceSubmitRequest;
}

export interface DirectorStoryboardJobResult {
  job: DirectorStoryboardJob;
  status: DirectorStoryboardJobStatus;
  videoUrl?: string;
  error?: string;
}

export interface DirectorStoryboardRunResult {
  results: DirectorStoryboardJobResult[];
  videoUrls: string[];
}

export interface DirectorStoryboardOutputResultLike {
  status?: string;
  videoUrl?: string | null;
  error?: string | null;
}

export interface DirectorStoryboardOutputItem {
  jobId: string;
  shotId: string;
  kind: DirectorStoryboardJobKind;
  order: number;
  title: string;
  prompt: string;
  durationSec: number;
  videoUrl: string;
  text: string;
}

export interface RunDirectorStoryboardJobsOptions {
  signal?: AbortSignal;
  onJobComplete?: (result: DirectorStoryboardJobResult) => void;
}

export const DIRECTOR_BRIDGE_PROMPT_PRESET_SCHEMA = 't8-director-bridge-prompt-presets';

export interface DirectorBridgePromptPreset {
  id: string;
  name: string;
  text: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DirectorBridgePromptPresetExport {
  schema: typeof DIRECTOR_BRIDGE_PROMPT_PRESET_SCHEMA;
  version: 1;
  exportedAt: string;
  presets: DirectorBridgePromptPreset[];
}

export const DIRECTOR_STORYBOARD_DEFAULT_DURATION_SEC = 5;
export const DIRECTOR_STORYBOARD_MIN_DURATION_SEC = 4;
export const DIRECTOR_STORYBOARD_MAX_DURATION_SEC = 15;
export const DIRECTOR_STORYBOARD_DEFAULT_BRIDGE_DURATION_SEC = 4;
export const DIRECTOR_BRIDGE_PROMPT_PRESETS: DirectorBridgePromptPreset[] = [
  { id: 'bridge-smooth-continuity', category: '基础连续', name: '平滑连续', text: '镜头平滑衔接前后画面，主体动作自然延续，光线、色彩和构图从前一帧自然过渡到后一帧。' },
  { id: 'bridge-stable-camera', category: '基础连续', name: '稳定镜头', text: '稳定摄影机保持主体身份和场景风格一致，画面细节缓慢变化，形成干净自然的首尾帧桥接。' },
  { id: 'bridge-subtle-motion', category: '基础连续', name: '轻微动态', text: '主体只做轻微自然动作，背景细节柔和流动，整体节奏克制，让前后画面无缝连接。' },
  { id: 'bridge-natural-action', category: '基础连续', name: '动作延续', text: '延续前一帧中的动作方向和姿态，逐步过渡到后一帧状态，人物比例、服装和表情保持稳定。' },
  { id: 'bridge-soft-morph', category: '基础连续', name: '柔和演变', text: '场景元素柔和演变为后一帧内容，主体轮廓稳定，转场像一次自然的镜头内变化。' },
  { id: 'bridge-hold-identity', category: '基础连续', name: '身份锁定', text: '保持主体身份、脸部结构、服装和主要道具稳定，只让动作、环境和镜头位置逐渐过渡。' },
  { id: 'bridge-gentle-breathing', category: '基础连续', name: '呼吸感', text: '画面带轻微呼吸感和微小景深变化，主体动作自然，前后帧之间的空间关系保持清晰。' },
  { id: 'bridge-clean-match-cut', category: '基础连续', name: '匹配剪辑', text: '利用相似构图和主体位置做匹配转场，画面中心稳定，动作节拍自然落到后一帧。' },
  { id: 'bridge-slow-dolly-in', category: '镜头运动', name: '慢推近', text: '摄影机缓慢向前推进，主体保持稳定清晰，背景透视轻微变化，最终自然靠近后一帧构图。' },
  { id: 'bridge-slow-dolly-out', category: '镜头运动', name: '慢拉远', text: '摄影机平稳向后拉开，逐渐展示更多环境信息，主体姿态自然过渡到后一帧。' },
  { id: 'bridge-pan-left', category: '镜头运动', name: '左摇镜', text: '摄影机平滑向左摇动，跟随画面重心转移，前一帧内容自然让位给后一帧内容。' },
  { id: 'bridge-pan-right', category: '镜头运动', name: '右摇镜', text: '摄影机平滑向右摇动，主体和背景保持连贯，画面重心自然落到后一帧。' },
  { id: 'bridge-tilt-up', category: '镜头运动', name: '上仰揭示', text: '摄影机缓慢上仰，逐步揭示更高处或更远处的画面信息，最终与后一帧构图对齐。' },
  { id: 'bridge-tilt-down', category: '镜头运动', name: '下俯揭示', text: '摄影机缓慢下俯，视线从前一帧的高处细节自然落到后一帧的主体或场景重点。' },
  { id: 'bridge-tracking-side', category: '镜头运动', name: '侧向跟拍', text: '摄影机侧向平稳跟随主体移动，运动方向明确，背景产生自然视差并过渡到后一帧。' },
  { id: 'bridge-orbit-small', category: '镜头运动', name: '轻环绕', text: '摄影机围绕主体做小幅度环绕运动，主体身份稳定，视角逐渐转向后一帧的角度。' },
  { id: 'bridge-handheld-soft', category: '镜头运动', name: '柔和手持', text: '轻微手持感但运动稳定，画面有真实呼吸和微小抖动，前后帧保持自然连续。' },
  { id: 'bridge-crane-rise', category: '镜头运动', name: '升格抬升', text: '摄影机缓慢上升并略微后移，场景层次被打开，最终自然抵达后一帧的空间关系。' },
  { id: 'bridge-push-through', category: '镜头运动', name: '穿越前景', text: '摄影机穿过前景遮挡物，前景形成柔和擦过效果，遮挡后自然显露后一帧画面。' },
  { id: 'bridge-focus-rack', category: '镜头运动', name: '焦点转移', text: '焦点从前一帧重点平滑转移到后一帧重点，景深变化自然，主体和背景不突兀变形。' },
  { id: 'bridge-motion-blur-wipe', category: '转场方式', name: '动势擦拭', text: '利用主体或镜头运动形成柔和动势模糊，画面顺着运动方向擦拭到后一帧。' },
  { id: 'bridge-light-leak', category: '转场方式', name: '光晕过渡', text: '自然光晕短暂扫过画面，亮部柔和扩散后收回，前一帧平滑显现为后一帧。' },
  { id: 'bridge-shadow-wipe', category: '转场方式', name: '阴影掠过', text: '一片自然阴影或遮挡缓慢掠过画面，遮挡消退后画面已经过渡到后一帧。' },
  { id: 'bridge-reflection-shift', category: '转场方式', name: '反射切换', text: '通过玻璃、水面或镜面反射完成过渡，反射内容逐渐变成后一帧，主体保持稳定。' },
  { id: 'bridge-depth-fade', category: '转场方式', name: '景深融化', text: '画面短暂进入柔和浅景深，背景和前景轻轻融化重组，清晰时抵达后一帧。' },
  { id: 'bridge-foreground-wipe', category: '转场方式', name: '前景遮挡', text: '让人物、物体或环境前景自然经过镜头，遮挡作为过渡，结束时露出后一帧构图。' },
  { id: 'bridge-speed-ramp-soft', category: '转场方式', name: '柔和变速', text: '动作节奏轻微加速后再放慢，动势自然承接前后帧，画面保持稳定和电影感。' },
  { id: 'bridge-match-motion', category: '转场方式', name: '动作匹配', text: '用前一帧主体动作的方向匹配后一帧的动作方向，形成连贯的动作桥接。' },
  { id: 'bridge-wind-flow', category: '氛围运动', name: '风动转场', text: '风吹动衣物、头发、树叶或轻薄物体，环境动势连接前后帧，气氛自然统一。' },
  { id: 'bridge-rain-atmosphere', category: '氛围运动', name: '雨雾衔接', text: '细雨、雾气或空气颗粒在画面中流动，作为柔和层次连接前一帧和后一帧。' },
  { id: 'bridge-dust-particles', category: '氛围运动', name: '尘粒过渡', text: '空气中的尘粒、花瓣或细小颗粒轻轻飘动，画面在粒子层次中自然过渡。' },
  { id: 'bridge-smoke-drift', category: '氛围运动', name: '烟雾漂移', text: '柔和烟雾或蒸汽缓慢漂移，短暂覆盖画面局部，散开后自然连接到后一帧。' },
  { id: 'bridge-water-ripple', category: '氛围运动', name: '水波过渡', text: '水波或透明涟漪轻轻扩散，画面像被水面折射一样平滑过渡到后一帧。' },
  { id: 'bridge-golden-hour', category: '氛围运动', name: '暖光延续', text: '暖色光线缓慢变化，主体边缘光和环境亮度自然衔接，保持统一的电影色调。' },
  { id: 'bridge-night-neon', category: '氛围运动', name: '霓虹流光', text: '霓虹或城市光线轻轻流动，色彩从前一帧逐步过渡到后一帧，整体保持稳定。' },
  { id: 'bridge-soft-clouds', category: '氛围运动', name: '云影流动', text: '云影、天光或环境阴影缓慢移动，带出自然时间流逝感并过渡到后一帧。' },
  { id: 'bridge-character-turn', category: '人物动作', name: '人物转身', text: '主体缓慢转身或转头，动作连贯自然，视线和身体方向逐渐落到后一帧状态。' },
  { id: 'bridge-character-step', category: '人物动作', name: '自然迈步', text: '人物自然迈出一步或调整站姿，镜头稳定跟随，动作结束时匹配后一帧构图。' },
  { id: 'bridge-character-gesture', category: '人物动作', name: '手势承接', text: '人物用一个清晰但克制的手势承接前后画面，手部动作自然，脸部和身体比例保持稳定。' },
  { id: 'bridge-eye-line', category: '人物动作', name: '视线转移', text: '主体视线从前一帧方向平滑转向后一帧重点，表情自然微变，画面情绪连贯。' },
  { id: 'bridge-costume-motion', category: '人物动作', name: '衣摆衔接', text: '衣摆、发丝或配饰随动作自然摆动，运动方向引导观众视线过渡到后一帧。' },
  { id: 'bridge-group-blocking', category: '人物动作', name: '多人走位', text: '多个人物保持相对位置稳定，只做小幅走位或姿态调整，画面自然抵达后一帧。' },
  { id: 'bridge-product-rotate', category: '物体产品', name: '产品旋转', text: '物体或产品做缓慢干净的旋转展示，光泽和边缘高光稳定，最后匹配后一帧角度。' },
  { id: 'bridge-object-transform', category: '物体产品', name: '物体演变', text: '主要物体在保持轮廓逻辑的基础上逐渐演变，材质和光线自然过渡到后一帧。' },
  { id: 'bridge-tabletop-slide', category: '物体产品', name: '桌面滑移', text: '物体在桌面或平面上轻轻滑动，摄影机稳定跟随，运动终点自然对齐后一帧。' },
  { id: 'bridge-packshot-clean', category: '物体产品', name: '干净产品转场', text: '干净商业摄影风格，主体产品位置稳定，背景和光线逐渐变化，形成高质感首尾帧桥接。' },
  { id: 'bridge-scene-day-night', category: '场景变化', name: '昼夜变化', text: '同一场景的光线从白天、黄昏或夜晚之间平滑变化，空间结构保持一致并抵达后一帧。' },
  { id: 'bridge-location-shift', category: '场景变化', name: '地点渐变', text: '背景环境逐步从前一帧地点演变为后一帧地点，主体稳定清晰，转场自然可信。' },
  { id: 'bridge-time-lapse-soft', category: '场景变化', name: '轻延时', text: '用轻微延时感表现环境变化，云、光线或人群缓慢流动，最后稳定在后一帧。' },
  { id: 'bridge-cinematic-finale', category: '电影质感', name: '电影收束', text: '镜头运动克制而有电影感，色彩和光线统一，动作自然完成，最后精准停在后一帧构图。' },
];

export interface DirectorTimelineDragDurationInput {
  startDurationSec: number;
  startClientX: number;
  currentClientX: number;
  timelineWidthPx: number;
  totalDurationSec: number;
}
const TOKEN_PREFIX: Record<MediaMentionKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'text',
};
type DirectorStoryboardMediaRefKind = DirectorStoryboardReferenceKind;

const IMAGE_REF_RE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(?:[?#].*)?$/i;
const VIDEO_REF_RE = /\.(mp4|webm|mov|m4v|mkv|avi)(?:[?#].*)?$/i;
const AUDIO_REF_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(?:[?#].*)?$/i;

function makeShotId(index: number): string {
  return `shot-${Date.now().toString(36)}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeDurationSec(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DIRECTOR_STORYBOARD_DEFAULT_DURATION_SEC;
  return Math.max(DIRECTOR_STORYBOARD_MIN_DURATION_SEC, Math.min(DIRECTOR_STORYBOARD_MAX_DURATION_SEC, Math.round(raw)));
}

function sanitizeBridgeStatus(value: unknown): DirectorStoryboardBridgeStatus {
  return value === 'extracting'
    || value === 'ready'
    || value === 'submitting'
    || value === 'polling'
    || value === 'success'
    || value === 'error'
    || value === 'cancelled'
    ? value
    : 'idle';
}

function sanitizeBridgeSourceMode(value: unknown): DirectorStoryboardBridgeSourceMode {
  return value === 'manual-video' || value === 'manual-image' ? value : 'auto-video';
}

function bridgePairId(fromShotId: string, toShotId: string): string {
  return `bridge-${fromShotId}-${toShotId}`;
}

export function calculateDirectorTimelineDragDuration(input: DirectorTimelineDragDurationInput): number {
  const totalDurationSec = Math.max(
    DIRECTOR_STORYBOARD_MIN_DURATION_SEC,
    Number.isFinite(input.totalDurationSec) ? input.totalDurationSec : DIRECTOR_STORYBOARD_DEFAULT_DURATION_SEC,
  );
  const timelineWidthPx = Math.max(1, Number.isFinite(input.timelineWidthPx) ? input.timelineWidthPx : 1);
  const pxPerSecond = Math.max(2, timelineWidthPx / totalDurationSec);
  const delta = Math.round((input.currentClientX - input.startClientX) / pxPerSecond);
  return sanitizeDurationSec(input.startDurationSec + delta);
}

function sanitizeFrameMode(value: unknown): DirectorStoryboardFrameMode {
  return value === 'first' || value === 'firstlast' || value === 'multiframe' ? value : 'auto';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()));
}

function referenceKey(item: DirectorStoryboardReferenceItem): string {
  return `${item.kind}:${item.url}`;
}

function sanitizeReferenceOrderInput(value: unknown): DirectorStoryboardReferenceItem[] {
  if (!Array.isArray(value)) return [];
  const refs: DirectorStoryboardReferenceItem[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const kind = (item as any).kind;
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return;
    const url = normalizeString((item as any).url);
    if (!url) return;
    refs.push({ kind, url });
  });
  return refs;
}

function classifyDirectorStoryboardMediaRef(
  url: string,
  fallback: DirectorStoryboardMediaRefKind,
): DirectorStoryboardMediaRefKind {
  const clean = String(url || '').trim();
  if (/^data:image\//i.test(clean) || IMAGE_REF_RE.test(clean)) return 'image';
  if (/^data:video\//i.test(clean) || VIDEO_REF_RE.test(clean)) return 'video';
  if (/^data:audio\//i.test(clean) || AUDIO_REF_RE.test(clean)) return 'audio';
  return fallback;
}

function normalizeDirectorStoryboardMediaRefs(shot: DirectorStoryboardInputShot): {
  images: string[];
  videos: string[];
  audios: string[];
  order: DirectorStoryboardReferenceItem[];
} {
  const buckets: Record<DirectorStoryboardMediaRefKind, string[]> = {
    image: [],
    video: [],
    audio: [],
  };
  const collectedOrder: DirectorStoryboardReferenceItem[] = [];
  const push = (value: string, fallback: DirectorStoryboardMediaRefKind) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const kind = classifyDirectorStoryboardMediaRef(clean, fallback);
    buckets[kind].push(clean);
    collectedOrder.push({ kind, url: clean });
  };

  sanitizeStringArray(shot.localRefImages).forEach((value) => push(value, 'image'));
  sanitizeStringArray(shot.localRefVideos).forEach((value) => push(value, 'video'));
  sanitizeStringArray(shot.localRefAudios).forEach((value) => push(value, 'audio'));

  const images = dedupeStrings(buckets.image);
  const videos = dedupeStrings(buckets.video);
  const audios = dedupeStrings(buckets.audio);
  const fallbackOrder = dedupeReferenceOrder(collectedOrder).filter((item) => (
    item.kind === 'image' ? images.includes(item.url) : item.kind === 'video' ? videos.includes(item.url) : audios.includes(item.url)
  ));
  const order = mergeReferenceOrder(sanitizeReferenceOrderInput(shot.localRefOrder), fallbackOrder, { images, videos, audios });

  return { images, videos, audios, order };
}

function dedupeReferenceOrder(items: DirectorStoryboardReferenceItem[]): DirectorStoryboardReferenceItem[] {
  const seen = new Set<string>();
  const result: DirectorStoryboardReferenceItem[] = [];
  items.forEach((item) => {
    const key = referenceKey(item);
    if (!item.url || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function mergeReferenceOrder(
  preferred: DirectorStoryboardReferenceItem[],
  fallback: DirectorStoryboardReferenceItem[],
  refs: { images: string[]; videos: string[]; audios: string[] },
): DirectorStoryboardReferenceItem[] {
  const valid = new Set<string>([
    ...refs.images.map((url) => `image:${url}`),
    ...refs.videos.map((url) => `video:${url}`),
    ...refs.audios.map((url) => `audio:${url}`),
  ]);
  const merged = dedupeReferenceOrder([...preferred, ...fallback]).filter((item) => valid.has(referenceKey(item)));
  const seen = new Set(merged.map(referenceKey));
  [
    ...refs.images.map((url) => ({ kind: 'image' as const, url })),
    ...refs.videos.map((url) => ({ kind: 'video' as const, url })),
    ...refs.audios.map((url) => ({ kind: 'audio' as const, url })),
  ].forEach((item) => {
    const key = referenceKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  });
  return merged;
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function cleanBridgePresetString(value: unknown, max = 600): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, max)
    : '';
}

function cleanBridgePresetId(value: unknown, fallback: string): string {
  const raw = cleanBridgePresetString(value, 80) || fallback;
  return raw.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

function uniqueBridgePresetId(baseId: string, seen: Set<string>): string {
  let id = baseId;
  let index = 2;
  while (seen.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  seen.add(id);
  return id;
}

export function sanitizeDirectorBridgePromptPresets(value: unknown): DirectorBridgePromptPreset[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as any).presets)
      ? (value as any).presets
      : [];
  const seen = new Set<string>();
  const presets: DirectorBridgePromptPreset[] = [];
  raw.slice(0, 120).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const text = cleanBridgePresetString((item as any).text, 600);
    if (!text) return;
    const fallbackId = `director-bridge-preset-${index + 1}`;
    const id = uniqueBridgePresetId(cleanBridgePresetId((item as any).id, fallbackId), seen);
    const name =
      cleanBridgePresetString((item as any).name, 48) ||
      text.replace(/\s+/g, ' ').slice(0, 18) ||
      `桥接预设 ${presets.length + 1}`;
    const category = cleanBridgePresetString((item as any).category, 24);
    const createdAt = cleanBridgePresetString((item as any).createdAt, 40);
    const updatedAt = cleanBridgePresetString((item as any).updatedAt, 40);
    presets.push({
      id,
      name,
      text,
      ...(category ? { category } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    });
  });
  return presets;
}

export function createDirectorBridgePromptPresetExport(presets: unknown): DirectorBridgePromptPresetExport {
  return {
    schema: DIRECTOR_BRIDGE_PROMPT_PRESET_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    presets: sanitizeDirectorBridgePromptPresets(presets),
  };
}

export function parseDirectorBridgePromptPresetImport(payload: string): DirectorBridgePromptPreset[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('不是有效的桥接提示词预设文件');
  }
  const presets = sanitizeDirectorBridgePromptPresets(parsed);
  if (!presets.length) throw new Error('没有识别到可导入的桥接提示词预设');
  return presets;
}

export function sanitizeDirectorStoryboardShots(input: DirectorStoryboardInputShot[]): DirectorStoryboardShot[] {
  const raw = Array.isArray(input) ? input : [];
  const source = raw.length > 0 ? raw : [{ title: 'S1', durationSec: DIRECTOR_STORYBOARD_DEFAULT_DURATION_SEC }];
  return source.map((shot, index) => {
    const title = normalizeString(shot.title) || `S${index + 1}`;
    const refs = normalizeDirectorStoryboardMediaRefs(shot);
    return {
      id: normalizeString(shot.id) || makeShotId(index),
      title,
      durationSec: sanitizeDurationSec(shot.durationSec),
      prompt: normalizeString(shot.prompt),
      ...(shot.useUpstreamPrompt === false ? {useUpstreamPrompt:false} : {}),
      ...(Array.isArray(shot.automaticImageBindings) && shot.automaticImageBindings.length ? {automaticImageBindings:shot.automaticImageBindings.filter(binding=>binding&&typeof binding.url==='string'&&refs.images.includes(binding.url)&&typeof binding.label==='string'&&binding.label.trim()).map(binding=>({url:binding.url,label:binding.label.trim().slice(0,80)}))} : {}),
      negativePrompt: normalizeString(shot.negativePrompt),
      promptMentions: Array.isArray(shot.promptMentions) ? shot.promptMentions : [],
      frameMode: sanitizeFrameMode(shot.frameMode),
      localRefImages: refs.images,
      localRefVideos: refs.videos,
      localRefAudios: refs.audios,
      localRefOrder: refs.order,
      seed: typeof shot.seed === 'number' && Number.isFinite(shot.seed) ? Math.trunc(shot.seed) : undefined,
      modelOverride: normalizeString(shot.modelOverride) || undefined,
      ratioOverride: normalizeString(shot.ratioOverride) || undefined,
      resolutionOverride: normalizeString(shot.resolutionOverride) || undefined,
      status: normalizeString(shot.status) || undefined,
      taskId: shot.taskId || null,
      taskProvider: shot.taskProvider === 'seedance-nz' || shot.taskProvider === 'zhenzhen-legacy'
        ? shot.taskProvider
        : null,
      videoUrl: shot.videoUrl || null,
      error: shot.error || null,
    };
  });
}

export function buildDirectorStoryboardReferenceOrder(shot: Pick<DirectorStoryboardShot, 'localRefImages' | 'localRefVideos' | 'localRefAudios'> & {
  localRefOrder?: DirectorStoryboardReferenceItem[];
}): DirectorStoryboardReferenceItem[] {
  const images = sanitizeStringArray(shot.localRefImages);
  const videos = sanitizeStringArray(shot.localRefVideos);
  const audios = sanitizeStringArray(shot.localRefAudios);
  return mergeReferenceOrder(
    sanitizeReferenceOrderInput(shot.localRefOrder),
    [
      ...images.map((url) => ({ kind: 'image' as const, url })),
      ...videos.map((url) => ({ kind: 'video' as const, url })),
      ...audios.map((url) => ({ kind: 'audio' as const, url })),
    ],
    { images, videos, audios },
  );
}

export function buildDirectorStoryboardShotInputPatch(source: DirectorStoryboardShot): DirectorStoryboardShotInputPatch {
  return {
    prompt: normalizeString(source.prompt),
    ...(source.useUpstreamPrompt === false ? {useUpstreamPrompt:false} : {}),
    ...(source.automaticImageBindings?.length ? {automaticImageBindings:source.automaticImageBindings.map(binding=>({...binding}))} : {}),
    negativePrompt: normalizeString(source.negativePrompt),
    promptMentions: Array.isArray(source.promptMentions)
      ? source.promptMentions.map((mention) => ({ ...mention }))
      : [],
    frameMode: sanitizeFrameMode(source.frameMode),
    localRefImages: sanitizeStringArray(source.localRefImages),
    localRefVideos: sanitizeStringArray(source.localRefVideos),
    localRefAudios: sanitizeStringArray(source.localRefAudios),
    localRefOrder: buildDirectorStoryboardReferenceOrder(source).map((item) => ({ ...item })),
  };
}

export function reorderDirectorStoryboardReference(
  shot: DirectorStoryboardShot,
  fromIndex: number,
  toIndex: number,
): DirectorStoryboardShot {
  const order = buildDirectorStoryboardReferenceOrder(shot);
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= order.length || toIndex >= order.length) {
    return { ...shot, localRefOrder: order };
  }
  const next = order.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return {
    ...shot,
    localRefImages: next.filter((item) => item.kind === 'image').map((item) => item.url),
    localRefVideos: next.filter((item) => item.kind === 'video').map((item) => item.url),
    localRefAudios: next.filter((item) => item.kind === 'audio').map((item) => item.url),
    localRefOrder: next,
  };
}

export function sanitizeDirectorStoryboardBridges(
  input: DirectorStoryboardInputBridge[],
  shots: DirectorStoryboardShot[],
): DirectorStoryboardBridge[] {
  const shotIds = new Set(shots.map((shot) => shot.id));
  const adjacentPairs = shots.slice(0, -1).map((shot, index) => ({
    fromShotId: shot.id,
    toShotId: shots[index + 1].id,
  }));
  const adjacentKeys = new Set(adjacentPairs.map((pair) => `${pair.fromShotId}:${pair.toShotId}`));
  const byPair = new Map<string, DirectorStoryboardInputBridge>();
  if (Array.isArray(input)) {
    for (const bridge of input) {
      const fromShotId = normalizeString(bridge.fromShotId);
      const toShotId = normalizeString(bridge.toShotId);
      const key = `${fromShotId}:${toShotId}`;
      if (!fromShotId || !toShotId || !shotIds.has(fromShotId) || !shotIds.has(toShotId) || !adjacentKeys.has(key)) continue;
      if (!byPair.has(key)) byPair.set(key, bridge);
    }
  }

  return adjacentPairs.map((pair) => {
    const saved = byPair.get(`${pair.fromShotId}:${pair.toShotId}`) || {};
    return {
      id: normalizeString(saved.id) || bridgePairId(pair.fromShotId, pair.toShotId),
      fromShotId: pair.fromShotId,
      toShotId: pair.toShotId,
      durationSec: sanitizeDurationSec(saved.durationSec || DIRECTOR_STORYBOARD_DEFAULT_BRIDGE_DURATION_SEC),
      prompt: normalizeString(saved.prompt),
      sourceMode: sanitizeBridgeSourceMode(saved.sourceMode),
      firstFrameUrl: normalizeString(saved.firstFrameUrl) || undefined,
      lastFrameUrl: normalizeString(saved.lastFrameUrl) || undefined,
      previousVideoUrl: normalizeString(saved.previousVideoUrl) || undefined,
      nextVideoUrl: normalizeString(saved.nextVideoUrl) || undefined,
      status: sanitizeBridgeStatus(saved.status),
      taskId: saved.taskId || null,
      taskProvider: saved.taskProvider === 'seedance-nz' || saved.taskProvider === 'zhenzhen-legacy'
        ? saved.taskProvider
        : null,
      videoUrl: saved.videoUrl || null,
      error: saved.error || null,
    };
  });
}

function materialKey(material: DirectorStoryboardMentionMaterial): string {
  const custom = normalizeString(material.mentionKey);
  return custom || `${material.kind}:${material.url}`;
}

function tokenForMaterial(material: DirectorStoryboardMentionMaterial, materials: DirectorStoryboardMentionMaterial[]): string {
  const custom = normalizeString(material.mentionToken);
  if (custom) return custom;
  let index = 0;
  for (const candidate of materials) {
    if (candidate.kind !== material.kind) continue;
    index += 1;
    if (materialKey(candidate) === materialKey(material)) return `@${TOKEN_PREFIX[material.kind]}${index}`;
  }
  return `@${TOKEN_PREFIX[material.kind]}?`;
}

function mentionTokenMatchesKind(mention: Pick<MediaMention, 'kind' | 'token'>): boolean {
  if (mention.kind === 'image' && /^@img\d+\b/.test(mention.token)) return true;
  if (mention.kind === 'video' && /^@vid\d+\b/.test(mention.token)) return true;
  if (mention.kind === 'audio' && /^@aud\d+\b/.test(mention.token)) return true;
  if (mention.kind === 'text' && /^@txt\d+\b/.test(mention.token)) return true;
  return new RegExp(`^@${TOKEN_PREFIX[mention.kind]}\\d+\\b`).test(mention.token);
}

function resolveShotPrompt(
  prompt: string,
  mentions: MediaMention[] | undefined,
  materials: DirectorStoryboardMentionMaterial[],
): string {
  if (!mentions?.length) return prompt;
  const byKey = new Map(materials.map((material) => [materialKey(material), material]));
  let next = prompt;
  const valid = mentions
    .filter((mention) => mentionTokenMatchesKind(mention) && prompt.slice(mention.start, mention.end) === mention.token)
    .sort((a, b) => b.start - a.start);

  for (const mention of valid) {
    const material = byKey.get(mention.materialKey);
    if (!material) continue;
    const replacement = mention.kind === 'text' ? material.url : tokenForMaterial(material, materials);
    next = `${next.slice(0, mention.start)}${replacement}${next.slice(mention.end)}`;
  }
  return next;
}

function collectMentionedMedia(
  prompt: string,
  mentions: MediaMention[] | undefined,
  materials: DirectorStoryboardMentionMaterial[],
) {
  const images: string[] = [];
  const videos: string[] = [];
  const audios: string[] = [];
  if (!mentions?.length) return { images, videos, audios };
  const byKey = new Map(materials.map((material) => [materialKey(material), material]));

  for (const mention of mentions) {
    if (!mentionTokenMatchesKind(mention)) continue;
    if (prompt.slice(mention.start, mention.end) !== mention.token) continue;
    const material = byKey.get(mention.materialKey);
    if (!material) continue;
    if (material.kind === 'image') images.push(material.url);
    if (material.kind === 'video') videos.push(material.url);
    if (material.kind === 'audio') audios.push(material.url);
  }

  return {
    images: dedupeStrings(images),
    videos: dedupeStrings(videos),
    audios: dedupeStrings(audios),
  };
}

function normalizeProviderParams(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, any>).filter(([, entryValue]) => {
    if (entryValue == null) return false;
    if (typeof entryValue === 'string') return entryValue.trim().length > 0;
    return true;
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function applyProviderParams(payload: SeedanceSubmitRequest, settings: DirectorStoryboardSettings) {
  const providerParams = normalizeProviderParams(settings.providerParams);
  if (providerParams) payload.providerParams = providerParams;
}

function collectDirectorShotSeedanceMedia(
  shot: DirectorStoryboardShot,
  context: BuildDirectorShotPayloadContext = {},
  options: { includeGlobal?: boolean } = {},
) {
  const mentionMaterials = context.mentionMaterials || [];
  const mentioned = collectMentionedMedia(shot.prompt, shot.promptMentions, mentionMaterials);
  const includeGlobal = options.includeGlobal !== false;
  return {
    images: dedupeStrings([
      ...(includeGlobal ? (context.globalImages || []) : []),
      ...mentioned.images,
      ...(shot.localRefImages || []),
    ]),
    videos: dedupeStrings([
      ...(includeGlobal ? (context.globalVideos || []) : []),
      ...mentioned.videos,
      ...(shot.localRefVideos || []),
    ]),
    audios: dedupeStrings([
      ...(includeGlobal ? (context.globalAudios || []) : []),
      ...mentioned.audios,
      ...(shot.localRefAudios || []),
    ]),
  };
}

export function buildDirectorShotSeedancePayload(
  shot: DirectorStoryboardShot,
  settings: DirectorStoryboardSettings,
  context: BuildDirectorShotPayloadContext = {},
): SeedanceSubmitRequest {
  const mentionMaterials = context.mentionMaterials || [];
  const { images, videos, audios } = collectDirectorShotSeedanceMedia(shot, context);

  const payloadMentionMaterials = mentionMaterials.map(material => {
    const urls = material.kind === 'image' ? images : material.kind === 'video' ? videos : material.kind === 'audio' ? audios : [];
    const index = urls.indexOf(material.url);
    return index >= 0 ? {...material,mentionToken:`@${TOKEN_PREFIX[material.kind]}${index+1}`} : material;
  });
  const localPrompt = resolveShotPrompt(shot.prompt, shot.promptMentions, payloadMentionMaterials).trim();
  const bindingNote = (shot.automaticImageBindings || []).flatMap(binding=>{
    const index=images.indexOf(binding.url);return index>=0?[`${binding.label}=@image${index+1}`]:[];
  }).join('；');
  const prompt = [shot.useUpstreamPrompt === false ? '' : context.upstreamPrompt, localPrompt, bindingNote ? `参考素材：${bindingNote}` : ''].map((item) => normalizeString(item)).filter(Boolean).join('\n\n');
  const payload: SeedanceSubmitRequest = {
    model: shot.modelOverride || settings.model,
    taskProvider: settings.taskProvider,
    prompt,
    duration: sanitizeDurationSec(shot.durationSec),
    ratio: shot.ratioOverride || settings.ratio,
    resolution: shot.resolutionOverride || settings.resolution,
    generate_audio: settings.generateAudio,
    return_last_frame: settings.returnLastFrame,
    watermark: settings.watermark,
    web_search: settings.webSearch,
  };
  applyProviderParams(payload, settings);

  const seed = typeof shot.seed === 'number' ? shot.seed : settings.seed;
  if (typeof seed === 'number' && seed !== -1) payload.seed = seed;

  if (shot.frameMode === 'first' && images.length >= 1) {
    payload.firstFrame = images[0];
    const refImages = images.slice(1);
    if (refImages.length) payload.refImages = refImages;
  } else if (shot.frameMode === 'firstlast' && images.length >= 1) {
    payload.firstFrame = images[0];
    if (images[1]) payload.lastFrame = images[1];
    const refImages = images.slice(2);
    if (refImages.length) payload.refImages = refImages;
  } else if (images.length) {
    payload.refImages = images;
  }

  if (videos.length) payload.videos = videos;
  if (audios.length) payload.audios = audios;
  return payload;
}

function bridgeFallbackPrompt(previous: DirectorStoryboardShot, next: DirectorStoryboardShot): string {
  return `Smooth transition from ${previous.title} to ${next.title}`;
}

export function buildDirectorStoryboardBridgeRunPlan(
  bridges: DirectorStoryboardBridge[],
  shots: DirectorStoryboardShot[],
  settings: DirectorStoryboardSettings,
): DirectorStoryboardJob[] {
  const shotById = new Map(shots.map((shot, index) => [shot.id, { shot, index }]));
  const jobs: DirectorStoryboardJob[] = [];

  for (const bridge of bridges) {
    const previousEntry = shotById.get(bridge.fromShotId);
    const nextEntry = shotById.get(bridge.toShotId);
    if (!previousEntry || !nextEntry || nextEntry.index !== previousEntry.index + 1) continue;
    const firstFrame = normalizeString(bridge.firstFrameUrl);
    const lastFrame = normalizeString(bridge.lastFrameUrl);
    if (!firstFrame || !lastFrame) continue;

    const payload: SeedanceSubmitRequest = {
      model: settings.model,
      taskProvider: settings.taskProvider,
      prompt: normalizeString(bridge.prompt) || bridgeFallbackPrompt(previousEntry.shot, nextEntry.shot),
      duration: sanitizeDurationSec(bridge.durationSec || DIRECTOR_STORYBOARD_DEFAULT_BRIDGE_DURATION_SEC),
      ratio: settings.ratio,
      resolution: settings.resolution,
      generate_audio: settings.generateAudio,
      return_last_frame: settings.returnLastFrame,
      watermark: settings.watermark,
      web_search: settings.webSearch,
      firstFrame,
      lastFrame,
    };
    applyProviderParams(payload, settings);
    if (typeof settings.seed === 'number' && settings.seed !== -1) payload.seed = settings.seed;

    jobs.push({
      id: `bridge-${bridge.id}`,
      shotId: `${bridge.fromShotId}:${bridge.toShotId}`,
      order: previousEntry.index + 0.5,
      kind: 'bridge',
      title: `${previousEntry.shot.title} → ${nextEntry.shot.title}`,
      payload,
    });
  }

  return jobs.sort((a, b) => a.order - b.order);
}

function lastImage(shot: DirectorStoryboardShot, context: BuildDirectorShotPayloadContext): string {
  const images = collectDirectorShotSeedanceMedia(shot, context, { includeGlobal: false }).images;
  return images[images.length - 1] || '';
}

function firstImage(shot: DirectorStoryboardShot, context: BuildDirectorShotPayloadContext): string {
  return collectDirectorShotSeedanceMedia(shot, context, { includeGlobal: false }).images[0] || '';
}

function buildBridgeJob(
  previous: DirectorStoryboardShot,
  next: DirectorStoryboardShot,
  settings: DirectorStoryboardSettings,
  order: number,
  context: BuildDirectorShotPayloadContext = {},
): DirectorStoryboardJob | null {
  const firstFrame = lastImage(previous, context);
  const lastFrame = firstImage(next, context);
  if (!firstFrame || !lastFrame) return null;
  const payload: SeedanceSubmitRequest = {
    model: settings.model,
    taskProvider: settings.taskProvider,
    prompt: normalizeString(settings.bridgePrompt) || `Smooth transition from ${previous.title} to ${next.title}`,
    duration: sanitizeDurationSec(settings.bridgeDurationSec || 4),
    ratio: settings.ratio,
    resolution: settings.resolution,
    generate_audio: settings.generateAudio,
    return_last_frame: settings.returnLastFrame,
    watermark: settings.watermark,
    web_search: settings.webSearch,
    firstFrame,
    lastFrame,
  };
  applyProviderParams(payload, settings);
  return {
    id: `bridge-${previous.id}-${next.id}`,
    shotId: `${previous.id}:${next.id}`,
    order,
    kind: 'bridge',
    title: `${previous.title} → ${next.title}`,
    payload,
  };
}

export function buildDirectorStoryboardRunPlan(
  shots: DirectorStoryboardShot[],
  settings: DirectorStoryboardSettings,
  context: BuildDirectorShotPayloadContext = {},
): DirectorStoryboardJob[] {
  return shots.map((shot, index) => ({
      id: `shot-${shot.id}`,
      shotId: shot.id,
      order: index,
      kind: 'shot',
      title: shot.title,
      payload: buildDirectorShotSeedancePayload(shot, settings, context),
  }));
}

export function buildDirectorStoryboardOutputItems(
  jobs: DirectorStoryboardJob[],
  results: Record<string, DirectorStoryboardOutputResultLike | undefined>,
): DirectorStoryboardOutputItem[] {
  const orderedJobs = [...jobs].sort((a, b) => a.order - b.order);
  const shotOrdinalByJobId = new Map<string, number>();
  let shotOrdinal = 0;
  for (const job of orderedJobs) {
    if (job.kind !== 'shot') continue;
    shotOrdinal += 1;
    shotOrdinalByJobId.set(job.id, shotOrdinal);
  }

  return orderedJobs.flatMap((job) => {
    const result = results[job.id];
    const videoUrl = typeof result?.videoUrl === 'string' ? result.videoUrl.trim() : '';
    if (result?.status !== 'success' || !videoUrl) return [];
    const prompt = normalizeString(job.payload.prompt) || '未填写提示词';
    const durationSec = sanitizeDurationSec((job.payload as any).duration);
    const title = job.kind === 'bridge'
      ? `首尾帧桥接 · ${job.title}`
      : `分镜 ${shotOrdinalByJobId.get(job.id) || job.order + 1} · ${job.title}`;
    const text = `${title} · ${durationSec}s\n${prompt}`;
    return [{
      jobId: job.id,
      shotId: job.shotId,
      kind: job.kind,
      order: job.order,
      title,
      prompt,
      durationSec,
      videoUrl,
      text,
    }];
  });
}

export function buildDirectorStoryboardOutputSummary(items: DirectorStoryboardOutputItem[]): string {
  if (items.length === 0) return '';
  const lines = ['导演分镜台输出'];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title} · ${item.durationSec}s · ${item.prompt} -> ${item.videoUrl}`);
  });
  return lines.join('\n');
}

export function getDirectorStoryboardOutputItemBindingKey(item: DirectorStoryboardOutputItem): string {
  return normalizeString(item.jobId) || `${item.kind}:${normalizeString(item.shotId)}:${normalizeString(item.videoUrl)}`;
}

export function findDirectorStoryboardOutputItemForNodeData(
  items: DirectorStoryboardOutputItem[],
  nodeData: Record<string, any> | null | undefined,
  fallbackIndex?: number,
): DirectorStoryboardOutputItem | undefined {
  const data = nodeData && typeof nodeData === 'object' ? nodeData : {};
  const snapshot = data.directorStoryboardOutputSnapshot && typeof data.directorStoryboardOutputSnapshot === 'object'
    ? data.directorStoryboardOutputSnapshot
    : {};
  const jobId = normalizeString(snapshot.jobId);
  if (jobId) {
    const byJobId = items.find((item) => item.jobId === jobId);
    if (byJobId) return byJobId;
  }

  const snapshotKind = normalizeString(snapshot.kind);
  const snapshotShotId = normalizeString(snapshot.shotId);
  if (snapshotKind && snapshotShotId) {
    const bySnapshot = items.find((item) => item.kind === snapshotKind && item.shotId === snapshotShotId);
    if (bySnapshot) return bySnapshot;
  }

  const directVideoUrl = normalizeString(data.directVideoUrl) || normalizeString(data.videoUrl);
  if (directVideoUrl) {
    const byVideoUrl = items.filter((item) => item.videoUrl === directVideoUrl);
    if (byVideoUrl.length === 1) return byVideoUrl[0];
  }

  const numericFallbackIndex = typeof fallbackIndex === 'number' && Number.isInteger(fallbackIndex)
    ? fallbackIndex
    : typeof data.pickIndex === 'number' && Number.isInteger(data.pickIndex)
      ? data.pickIndex
      : -1;
  return numericFallbackIndex >= 0 ? items[numericFallbackIndex] : undefined;
}

export function buildDirectorStoryboardOutputNodeData(item: DirectorStoryboardOutputItem): Record<string, any> {
  const videoUrl = normalizeString(item.videoUrl);
  if (!videoUrl) return {};
  const text = normalizeString(item.text);
  return {
    directOutputSingleSnapshot: true,
    directorStoryboardOutputSnapshot: {
      jobId: item.jobId,
      shotId: item.shotId,
      kind: item.kind,
      order: item.order,
      title: item.title,
      durationSec: item.durationSec,
    },
    videoUrl,
    videoUrls: [videoUrl],
    directVideoUrl: videoUrl,
    directVideoUrls: [videoUrl],
    prompt: text,
    text,
    reply: text,
    outputText: '',
    directOutputText: text,
    directTextSegments: text ? [text] : [],
    textSegments: text ? [text] : [],
    segments: text ? [text] : [],
  };
}

export async function runDirectorStoryboardJobs(
  jobs: DirectorStoryboardJob[],
  runJob: (job: DirectorStoryboardJob, signal?: AbortSignal) => Promise<string>,
  options: RunDirectorStoryboardJobsOptions = {},
): Promise<DirectorStoryboardRunResult> {
  const orderedJobs = [...jobs].sort((a, b) => a.order - b.order);
  const settled = await Promise.all(
    orderedJobs.map(async (job): Promise<DirectorStoryboardJobResult> => {
      if (options.signal?.aborted) {
        const cancelled: DirectorStoryboardJobResult = { job, status: 'cancelled', error: '用户已停止' };
        options.onJobComplete?.(cancelled);
        return cancelled;
      }
      try {
        const videoUrl = await runJob(job, options.signal);
        const result: DirectorStoryboardJobResult = { job, status: 'success', videoUrl };
        options.onJobComplete?.(result);
        return result;
      } catch (error: any) {
        const status: DirectorStoryboardJobStatus = options.signal?.aborted ? 'cancelled' : 'error';
        const result: DirectorStoryboardJobResult = {
          job,
          status,
          error: error?.message || (status === 'cancelled' ? '用户已停止' : '生成失败'),
        };
        options.onJobComplete?.(result);
        return result;
      }
    }),
  );

  const byOrder = [...settled].sort((a, b) => a.job.order - b.job.order);
  return {
    results: byOrder,
    videoUrls: byOrder.flatMap((item) => item.status === 'success' && item.videoUrl ? [item.videoUrl] : []),
  };
}
