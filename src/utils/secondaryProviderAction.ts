import type { RunContext, RunNodeLifecycleReporter } from '../types/project';
import {
  RH_IMAGE_CAPABILITY_PRESETS,
  RH_VIDEO_CAPABILITY_PRESETS,
  type RhImageCapabilityPresetId,
  type RhVideoCapabilityPresetId,
} from './rhToolboxCapabilities.ts';
import { createCanvasNodeRunRequestId } from './canvasRunRequest.ts';

export const SECONDARY_PROVIDER_ACTION_SCHEMA = 't8-secondary-provider-action-v1' as const;
export const SECONDARY_PROVIDER_ACTION_DATA_KEY = 'secondaryProviderAction' as const;
export const CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT = 't8:canvas-secondary-provider-action-request' as const;
export const SECONDARY_PROVIDER_ACTION_DIGEST_ALGORITHM = 'fnv1a32-stable-json-v1' as const;

export const SECONDARY_PROVIDER_ACTION_IDS = [
  'generation-target.generate',
  'image-edit.annotation',
  'rh-image.editor-cutout',
  'rh-image.capability',
  'rh-video.frames',
  'rh-video.capability',
  'video-edit.compose',
  'video-edit.platform-export',
  'panorama-3d.ai-action-plan',
] as const;

export type SecondaryProviderActionId = typeof SECONDARY_PROVIDER_ACTION_IDS[number];
export type SecondaryProviderActionNodeType =
  | 'generation-target'
  | 'output'
  | 'upload'
  | 'video-edit'
  | 'drawing-board'
  | 'panorama-3d';
export type SecondaryProviderActionTarget =
  | 'replace'
  | 'keep-version'
  | 'annotation-edit'
  | 'editor-cutout'
  | 'frames'
  | 'compose'
  | 'platform-export'
  | 'action-plan'
  | RhImageCapabilityPresetId
  | RhVideoCapabilityPresetId;

export type SecondaryProviderScalar = string | number | boolean;

export interface GenerationTargetGenerateActionParams {
  prompt: string;
  model: string;
  apiModel: string;
  aspectRatio: string;
  sizeLevel: string;
  images: string[];
  sourceNodeIds: string[];
}

export interface AnnotationEditActionParams {
  sourceImageUrl: string;
  annotatedImageUrl: string;
  instruction: string;
  annotationTextCount: number;
  annotationShapeCount: number;
  providerId: 'default-image';
  providerModel: 'gpt-image-2';
  targetNodeId?: string;
}

export interface RhImageCapabilityActionParams {
  capability: string;
  preferredToolId?: string;
  userParams?: Record<string, SecondaryProviderScalar>;
  imageUrls: string[];
  retryCount: number;
  retryDelayMs: number;
  continueOnError: boolean;
}

export interface RhImageEditorCutoutActionParams {
  capability: 'image.cutout';
  preferredToolId: 'image-cutout-v1';
  imageUrl: string;
  surface: 'drawing-board' | 'image-edit-modal';
  editorSessionId: string;
  targetId: string;
  retryCount: number;
  retryDelayMs: number;
}

export interface SecondaryVideoSourceItem {
  url: string;
  name?: string;
  size?: number;
  mime?: string;
}

export interface RhVideoFramesActionParams {
  sourceItems: SecondaryVideoSourceItem[];
}

export interface RhVideoCapabilityActionParams {
  capability: string;
  preferredToolId?: string;
  videoUrls: string[];
  retryCount: number;
  retryDelayMs: number;
  continueOnError: boolean;
}

export interface PanoramaAiActionPlanActionParams {
  prompt: string;
  plannerSystemPrompt: string;
  plannerUserPrompt: string;
  view: Record<string, unknown>;
  avatars: Record<string, unknown>[];
  activeAvatarId?: string;
}

export interface VideoEditExecutionActionParams {
  inputDigest: string;
  packageIds: string[];
  operationCount: number;
}

interface SecondaryProviderActionBase {
  schema: typeof SECONDARY_PROVIDER_ACTION_SCHEMA;
  digestAlgorithm: typeof SECONDARY_PROVIDER_ACTION_DIGEST_ALGORITHM;
  digest: string;
  requestId: string;
  issuedAt: number;
  nodeId: string;
  nodeType: SecondaryProviderActionNodeType;
}

export type SecondaryProviderActionEnvelope = SecondaryProviderActionBase & (
  | { actionId: 'generation-target.generate'; target: 'replace' | 'keep-version'; params: GenerationTargetGenerateActionParams }
  | { actionId: 'image-edit.annotation'; target: 'annotation-edit'; params: AnnotationEditActionParams }
  | { actionId: 'rh-image.editor-cutout'; target: 'editor-cutout'; params: RhImageEditorCutoutActionParams }
  | { actionId: 'rh-image.capability'; target: RhImageCapabilityPresetId; params: RhImageCapabilityActionParams }
  | { actionId: 'rh-video.frames'; target: 'frames'; params: RhVideoFramesActionParams }
  | { actionId: 'rh-video.capability'; target: RhVideoCapabilityPresetId; params: RhVideoCapabilityActionParams }
  | { actionId: 'video-edit.compose'; target: 'compose'; params: VideoEditExecutionActionParams }
  | { actionId: 'video-edit.platform-export'; target: 'platform-export'; params: VideoEditExecutionActionParams }
  | { actionId: 'panorama-3d.ai-action-plan'; target: 'action-plan'; params: PanoramaAiActionPlanActionParams }
);

export type SecondaryProviderActionDraft =
  | { actionId: 'generation-target.generate'; target: 'replace' | 'keep-version'; params: GenerationTargetGenerateActionParams }
  | { actionId: 'image-edit.annotation'; target: 'annotation-edit'; params: AnnotationEditActionParams }
  | { actionId: 'rh-image.editor-cutout'; target: 'editor-cutout'; params: RhImageEditorCutoutActionParams }
  | { actionId: 'rh-image.capability'; target: RhImageCapabilityPresetId; params: RhImageCapabilityActionParams }
  | { actionId: 'rh-video.frames'; target: 'frames'; params: RhVideoFramesActionParams }
  | { actionId: 'rh-video.capability'; target: RhVideoCapabilityPresetId; params: RhVideoCapabilityActionParams }
  | { actionId: 'video-edit.compose'; target: 'compose'; params: VideoEditExecutionActionParams }
  | { actionId: 'video-edit.platform-export'; target: 'platform-export'; params: VideoEditExecutionActionParams }
  | { actionId: 'panorama-3d.ai-action-plan'; target: 'action-plan'; params: PanoramaAiActionPlanActionParams };

export type SecondaryProviderActionRequest =
  | ({ nodeId: string; nodeType: 'generation-target' } & Extract<SecondaryProviderActionDraft, { actionId: 'generation-target.generate' }>)
  | ({ nodeId: string; nodeType: 'output' | 'upload' } & Extract<SecondaryProviderActionDraft, { actionId: 'image-edit.annotation' }>)
  | ({ nodeId: string; nodeType: 'output' | 'upload' | 'video-edit' | 'drawing-board' } & Extract<SecondaryProviderActionDraft, { actionId: 'rh-image.editor-cutout' }>)
  | ({ nodeId: string; nodeType: 'output' | 'upload' } & Extract<SecondaryProviderActionDraft, { actionId: 'rh-image.capability' }>)
  | ({ nodeId: string; nodeType: 'output' | 'upload' } & Extract<SecondaryProviderActionDraft, { actionId: 'rh-video.frames' }>)
  | ({ nodeId: string; nodeType: 'output' | 'upload' } & Extract<SecondaryProviderActionDraft, { actionId: 'rh-video.capability' }>)
  | ({ nodeId: string; nodeType: 'video-edit' } & Extract<SecondaryProviderActionDraft, { actionId: 'video-edit.compose' | 'video-edit.platform-export' }>)
  | ({ nodeId: string; nodeType: 'panorama-3d' } & Extract<SecondaryProviderActionDraft, { actionId: 'panorama-3d.ai-action-plan' }>);

export type QueueSecondaryProviderAction = (draft: SecondaryProviderActionDraft) => SecondaryProviderActionEnvelope;

export interface CanvasSecondaryProviderActionRequestDetail {
  action: SecondaryProviderActionEnvelope;
}

export interface SecondaryProviderActionCapabilityHint {
  provider: 'zhenzhen-image' | 'zhenzhen-llm' | 'runninghub-cn' | 'local';
  model: string | null;
  credential: 'gpt-image' | 'llm' | 'runninghub-cn' | null;
}

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/;
const DIGEST_PATTERN = /^fnv1a32:[a-f0-9]{8}$/;
const SAFE_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/;
const FORBIDDEN_KEY_PATTERN = /(?:api.?key|secret|token|password|authorization|cookie|credential)/i;
const MAX_ACTION_JSON_BYTES = 64 * 1024;
const MAX_MEDIA_URLS = 64;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_KEYS = 256;

function ownRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  const set = new Set(allowed);
  return Object.keys(record).every((key) => set.has(key));
}

function boundedString(value: unknown, maxLength: number, required = true): string | null {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength || /[\u0000\u0008\u000b\u000c]/.test(normalized)) return null;
  return normalized;
}

function boundedId(value: unknown, required = true): string | null {
  const normalized = boundedString(value, 256, required);
  return normalized && SAFE_ID_PATTERN.test(normalized) ? normalized : required ? null : '';
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function safeMediaUrl(value: unknown): string | null {
  const normalized = boundedString(value, 8192);
  if (!normalized || /^(?:data|blob|file|javascript):/i.test(normalized)) return null;
  if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\')) return null;
  return normalized;
}

function cleanStringArray(
  value: unknown,
  options: { maxItems: number; maxLength: number; ids?: boolean; urls?: boolean },
): string[] | null {
  if (!Array.isArray(value) || value.length > options.maxItems) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = options.urls
      ? safeMediaUrl(item)
      : options.ids
        ? boundedId(item)
        : boundedString(item, options.maxLength);
    if (!normalized) return null;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function cleanScalarRecord(value: unknown): Record<string, SecondaryProviderScalar> | undefined | null {
  if (value === undefined) return undefined;
  if (!ownRecord(value) || Object.keys(value).length > 64) return null;
  const out: Record<string, SecondaryProviderScalar> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key) || FORBIDDEN_KEY_PATTERN.test(key)) return null;
    if (typeof raw === 'string') {
      const text = boundedString(raw, 1024, false);
      if (text === null) return null;
      out[key] = text;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = raw;
    } else if (typeof raw === 'boolean') {
      out[key] = raw;
    } else {
      return null;
    }
  }
  return out;
}

function cleanBoundedJson(value: unknown, depth = 0, keyCounter = { value: 0 }): unknown | null {
  if (depth > MAX_JSON_DEPTH) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return boundedString(value, 16_384, false);
  if (Array.isArray(value)) {
    if (value.length > 128) return null;
    const out: unknown[] = [];
    for (const item of value) {
      const clean = cleanBoundedJson(item, depth + 1, keyCounter);
      if (clean === null && item !== null) return null;
      out.push(clean);
    }
    return out;
  }
  if (!ownRecord(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    keyCounter.value += 1;
    if (keyCounter.value > MAX_JSON_KEYS || key.length > 96 || FORBIDDEN_KEY_PATTERN.test(key)) return null;
    const clean = cleanBoundedJson(item, depth + 1, keyCounter);
    if (clean === null && item !== null) return null;
    out[key] = clean;
  }
  return out;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function fnv1a32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function digestPayload(action: Omit<SecondaryProviderActionEnvelope, 'digest'>) {
  return fnv1a32(stableJson(action));
}

function normalizeGenerationTargetParams(value: unknown): GenerationTargetGenerateActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, ['prompt', 'model', 'apiModel', 'aspectRatio', 'sizeLevel', 'images', 'sourceNodeIds'])) return null;
  const prompt = boundedString(value.prompt, 20_000);
  const model = boundedString(value.model, 160);
  const apiModel = boundedString(value.apiModel, 160);
  const aspectRatio = boundedString(value.aspectRatio, 32);
  const sizeLevel = boundedString(value.sizeLevel, 32);
  const images = cleanStringArray(value.images, { maxItems: 8, maxLength: 8192, urls: true });
  const sourceNodeIds = cleanStringArray(value.sourceNodeIds, { maxItems: 64, maxLength: 256, ids: true });
  if (!prompt || !model || !apiModel || !aspectRatio || !sizeLevel || !images || !sourceNodeIds) return null;
  return { prompt, model, apiModel, aspectRatio, sizeLevel, images, sourceNodeIds };
}

function normalizeAnnotationParams(value: unknown): AnnotationEditActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, [
    'sourceImageUrl', 'annotatedImageUrl', 'instruction', 'annotationTextCount', 'annotationShapeCount',
    'providerId', 'providerModel', 'targetNodeId',
  ])) return null;
  const sourceImageUrl = safeMediaUrl(value.sourceImageUrl);
  const annotatedImageUrl = safeMediaUrl(value.annotatedImageUrl);
  const instruction = boundedString(value.instruction, 8_000, false);
  const annotationTextCount = boundedInteger(value.annotationTextCount, 0, 10_000);
  const annotationShapeCount = boundedInteger(value.annotationShapeCount, 0, 10_000);
  const targetNodeId = value.targetNodeId === undefined ? undefined : boundedId(value.targetNodeId) || null;
  if (!sourceImageUrl || !annotatedImageUrl || instruction === null || annotationTextCount === null || annotationShapeCount === null
    || value.providerId !== 'default-image' || value.providerModel !== 'gpt-image-2' || targetNodeId === null) return null;
  return {
    sourceImageUrl,
    annotatedImageUrl,
    instruction,
    annotationTextCount,
    annotationShapeCount,
    providerId: 'default-image',
    providerModel: 'gpt-image-2',
    ...(targetNodeId ? { targetNodeId } : {}),
  };
}

function normalizeRhImageParams(value: unknown, target: RhImageCapabilityPresetId): RhImageCapabilityActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, [
    'capability', 'preferredToolId', 'userParams', 'imageUrls', 'retryCount', 'retryDelayMs', 'continueOnError',
  ])) return null;
  const preset = RH_IMAGE_CAPABILITY_PRESETS[target];
  if (!preset) return null;
  const capability = boundedString(value.capability, 160);
  const preferredToolId = value.preferredToolId === undefined ? undefined : boundedString(value.preferredToolId, 160) || null;
  const expectedToolId = 'preferredToolId' in preset ? preset.preferredToolId || undefined : undefined;
  const userParams = cleanScalarRecord(value.userParams);
  const imageUrls = cleanStringArray(value.imageUrls, { maxItems: MAX_MEDIA_URLS, maxLength: 8192, urls: true });
  const retryCount = boundedInteger(value.retryCount, 0, 8);
  const retryDelayMs = boundedInteger(value.retryDelayMs, 0, 60_000);
  if (capability !== preset.capability || preferredToolId === null || preferredToolId !== expectedToolId || userParams === null
    || !imageUrls || imageUrls.length === 0 || retryCount === null || retryDelayMs === null || typeof value.continueOnError !== 'boolean') return null;
  return {
    capability,
    ...(preferredToolId ? { preferredToolId } : {}),
    ...(userParams && Object.keys(userParams).length > 0 ? { userParams } : {}),
    imageUrls,
    retryCount,
    retryDelayMs,
    continueOnError: value.continueOnError,
  };
}

function normalizeRhImageEditorCutoutParams(
  value: unknown,
  nodeType: unknown,
): RhImageEditorCutoutActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, [
    'capability', 'preferredToolId', 'imageUrl', 'surface', 'editorSessionId', 'targetId', 'retryCount', 'retryDelayMs',
  ])) return null;
  const imageUrl = safeMediaUrl(value.imageUrl);
  const editorSessionId = boundedId(value.editorSessionId);
  const targetId = boundedId(value.targetId);
  const retryCount = boundedInteger(value.retryCount, 0, 8);
  const retryDelayMs = boundedInteger(value.retryDelayMs, 0, 60_000);
  const surface = value.surface === 'drawing-board'
    ? 'drawing-board'
    : value.surface === 'image-edit-modal'
      ? 'image-edit-modal'
      : null;
  const expectedSurface = nodeType === 'drawing-board' ? 'drawing-board' : 'image-edit-modal';
  if (
    value.capability !== 'image.cutout'
    || value.preferredToolId !== 'image-cutout-v1'
    || !imageUrl
    || !editorSessionId
    || !targetId
    || retryCount === null
    || retryDelayMs === null
    || surface !== expectedSurface
  ) return null;
  return {
    capability: 'image.cutout',
    preferredToolId: 'image-cutout-v1',
    imageUrl,
    surface,
    editorSessionId,
    targetId,
    retryCount,
    retryDelayMs,
  };
}

function normalizeVideoSourceItems(value: unknown): SecondaryVideoSourceItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MEDIA_URLS) return null;
  const out: SecondaryVideoSourceItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!ownRecord(item) || !hasOnlyKeys(item, ['url', 'name', 'size', 'mime'])) return null;
    const url = safeMediaUrl(item.url);
    const name = item.name === undefined ? undefined : boundedString(item.name, 512, false);
    const mime = item.mime === undefined ? undefined : boundedString(item.mime, 160, false);
    const size = item.size === undefined ? undefined : boundedInteger(item.size, 0, Number.MAX_SAFE_INTEGER);
    if (!url || name === null || mime === null || size === null) return null;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, ...(name ? { name } : {}), ...(mime ? { mime } : {}), ...(size !== undefined ? { size } : {}) });
  }
  return out.length > 0 ? out : null;
}

function normalizeRhVideoParams(value: unknown, target: RhVideoCapabilityPresetId): RhVideoCapabilityActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, [
    'capability', 'preferredToolId', 'videoUrls', 'retryCount', 'retryDelayMs', 'continueOnError',
  ])) return null;
  const preset = RH_VIDEO_CAPABILITY_PRESETS[target];
  if (!preset) return null;
  const capability = boundedString(value.capability, 160);
  const preferredToolId = value.preferredToolId === undefined ? undefined : boundedString(value.preferredToolId, 160) || null;
  const videoUrls = cleanStringArray(value.videoUrls, { maxItems: MAX_MEDIA_URLS, maxLength: 8192, urls: true });
  const retryCount = boundedInteger(value.retryCount, 0, 8);
  const retryDelayMs = boundedInteger(value.retryDelayMs, 0, 60_000);
  if (capability !== preset.capability || preferredToolId === null || preferredToolId !== preset.preferredToolId
    || !videoUrls || videoUrls.length === 0 || retryCount === null || retryDelayMs === null || typeof value.continueOnError !== 'boolean') return null;
  return {
    capability,
    ...(preferredToolId ? { preferredToolId } : {}),
    videoUrls,
    retryCount,
    retryDelayMs,
    continueOnError: value.continueOnError,
  };
}

function normalizePanoramaParams(value: unknown): PanoramaAiActionPlanActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, [
    'prompt', 'plannerSystemPrompt', 'plannerUserPrompt', 'view', 'avatars', 'activeAvatarId',
  ])) return null;
  const prompt = boundedString(value.prompt, 20_000);
  const plannerSystemPrompt = boundedString(value.plannerSystemPrompt, 24_000);
  const plannerUserPrompt = boundedString(value.plannerUserPrompt, 24_000);
  const view = cleanBoundedJson(value.view);
  const avatars = cleanBoundedJson(value.avatars);
  const activeAvatarId = value.activeAvatarId === undefined ? undefined : boundedId(value.activeAvatarId) || null;
  if (!prompt || !plannerSystemPrompt || !plannerUserPrompt || !ownRecord(view) || !Array.isArray(avatars)
    || !avatars.every(ownRecord) || activeAvatarId === null) return null;
  return {
    prompt,
    plannerSystemPrompt,
    plannerUserPrompt,
    view,
    avatars,
    ...(activeAvatarId ? { activeAvatarId } : {}),
  };
}

const VIDEO_EDIT_PLATFORM_PACKAGE_IDS = new Set([
  'douyin-kuaishou',
  'bilibili-youtube',
  'xiaohongshu-square',
  'vertical-poster',
  'wide-display',
  'draft-preview',
]);

function normalizeVideoEditExecutionParams(
  value: unknown,
  target: 'compose' | 'platform-export',
): VideoEditExecutionActionParams | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, ['inputDigest', 'packageIds', 'operationCount'])) return null;
  const inputDigest = boundedString(value.inputDigest, 72);
  const packageIds = cleanStringArray(value.packageIds, { maxItems: VIDEO_EDIT_PLATFORM_PACKAGE_IDS.size, maxLength: 64 });
  const operationCount = boundedInteger(value.operationCount, 1, VIDEO_EDIT_PLATFORM_PACKAGE_IDS.size);
  if (!inputDigest || !/^sha256:[a-f0-9]{64}$/.test(inputDigest) || !packageIds || operationCount === null) return null;
  if (target === 'compose' && (packageIds.length !== 0 || operationCount !== 1)) return null;
  if (target === 'platform-export'
    && (packageIds.length === 0 || operationCount !== packageIds.length || packageIds.some((id) => !VIDEO_EDIT_PLATFORM_PACKAGE_IDS.has(id)))) return null;
  return { inputDigest, packageIds, operationCount };
}

function normalizeActionVariant(
  actionId: unknown,
  nodeType: unknown,
  target: unknown,
  params: unknown,
): Pick<SecondaryProviderActionEnvelope, 'actionId' | 'nodeType' | 'target' | 'params'> | null {
  if (actionId === 'generation-target.generate' && nodeType === 'generation-target' && (target === 'replace' || target === 'keep-version')) {
    const normalized = normalizeGenerationTargetParams(params);
    return normalized ? { actionId, nodeType, target, params: normalized } : null;
  }
  if (actionId === 'image-edit.annotation' && (nodeType === 'output' || nodeType === 'upload') && target === 'annotation-edit') {
    const normalized = normalizeAnnotationParams(params);
    return normalized ? { actionId, nodeType, target, params: normalized } : null;
  }
  if (actionId === 'rh-image.editor-cutout'
    && (nodeType === 'output' || nodeType === 'upload' || nodeType === 'video-edit' || nodeType === 'drawing-board')
    && target === 'editor-cutout') {
    const normalized = normalizeRhImageEditorCutoutParams(params, nodeType);
    return normalized ? { actionId, nodeType, target, params: normalized } : null;
  }
  if (actionId === 'rh-image.capability' && (nodeType === 'output' || nodeType === 'upload')
    && typeof target === 'string' && target in RH_IMAGE_CAPABILITY_PRESETS) {
    const presetId = target as RhImageCapabilityPresetId;
    const normalized = normalizeRhImageParams(params, presetId);
    return normalized ? { actionId, nodeType, target: presetId, params: normalized } : null;
  }
  if (actionId === 'rh-video.frames' && (nodeType === 'output' || nodeType === 'upload') && target === 'frames') {
    if (!ownRecord(params) || !hasOnlyKeys(params, ['sourceItems'])) return null;
    const sourceItems = normalizeVideoSourceItems(params.sourceItems);
    return sourceItems ? { actionId, nodeType, target, params: { sourceItems } } : null;
  }
  if (actionId === 'rh-video.capability' && (nodeType === 'output' || nodeType === 'upload')
    && typeof target === 'string' && target in RH_VIDEO_CAPABILITY_PRESETS) {
    const presetId = target as RhVideoCapabilityPresetId;
    const normalized = normalizeRhVideoParams(params, presetId);
    return normalized ? { actionId, nodeType, target: presetId, params: normalized } : null;
  }
  if (actionId === 'video-edit.compose' && nodeType === 'video-edit' && target === 'compose') {
    const normalized = normalizeVideoEditExecutionParams(params, target);
    return normalized ? { actionId, nodeType, target, params: normalized } : null;
  }
  if (actionId === 'video-edit.platform-export' && nodeType === 'video-edit' && target === 'platform-export') {
    const normalized = normalizeVideoEditExecutionParams(params, target);
    return normalized ? { actionId, nodeType, target, params: normalized } : null;
  }
  if (actionId === 'panorama-3d.ai-action-plan' && nodeType === 'panorama-3d' && target === 'action-plan') {
    const normalized = normalizePanoramaParams(params);
    return normalized ? { actionId, nodeType, target, params: normalized } : null;
  }
  return null;
}

export function validateSecondaryProviderAction(value: unknown): SecondaryProviderActionEnvelope | null {
  if (!ownRecord(value) || !hasOnlyKeys(value, [
    'schema', 'digestAlgorithm', 'digest', 'requestId', 'issuedAt', 'nodeId', 'nodeType', 'actionId', 'target', 'params',
  ])) return null;
  if (value.schema !== SECONDARY_PROVIDER_ACTION_SCHEMA || value.digestAlgorithm !== SECONDARY_PROVIDER_ACTION_DIGEST_ALGORITHM) return null;
  const digest = boundedString(value.digest, 64);
  const requestId = boundedString(value.requestId, 160);
  const issuedAt = boundedInteger(value.issuedAt, 0, Number.MAX_SAFE_INTEGER);
  const nodeId = boundedId(value.nodeId);
  const variant = normalizeActionVariant(value.actionId, value.nodeType, value.target, value.params);
  if (!digest || !DIGEST_PATTERN.test(digest) || !requestId || !REQUEST_ID_PATTERN.test(requestId) || issuedAt === null || !nodeId || !variant) return null;
  const withoutDigest = {
    schema: SECONDARY_PROVIDER_ACTION_SCHEMA,
    digestAlgorithm: SECONDARY_PROVIDER_ACTION_DIGEST_ALGORITHM,
    requestId,
    issuedAt,
    nodeId,
    ...variant,
  } as Omit<SecondaryProviderActionEnvelope, 'digest'>;
  if (digestPayload(withoutDigest) !== digest) return null;
  const normalized = { ...withoutDigest, digest } as SecondaryProviderActionEnvelope;
  if (new TextEncoder().encode(stableJson(normalized)).byteLength > MAX_ACTION_JSON_BYTES) return null;
  return normalized;
}

export function createSecondaryProviderAction(
  request: SecondaryProviderActionRequest,
  options: { requestId?: string; issuedAt?: number } = {},
): SecondaryProviderActionEnvelope {
  const requestId = options.requestId || createCanvasNodeRunRequestId(request.nodeId, request.actionId);
  const issuedAt = options.issuedAt ?? Date.now();
  const variant = normalizeActionVariant(request.actionId, request.nodeType, request.target, request.params);
  const nodeId = boundedId(request.nodeId);
  if (!variant || !nodeId || !REQUEST_ID_PATTERN.test(requestId) || !Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error('次级 Provider action 参数不在固定白名单内');
  }
  const withoutDigest = {
    schema: SECONDARY_PROVIDER_ACTION_SCHEMA,
    digestAlgorithm: SECONDARY_PROVIDER_ACTION_DIGEST_ALGORITHM,
    requestId,
    issuedAt,
    nodeId,
    ...variant,
  } as Omit<SecondaryProviderActionEnvelope, 'digest'>;
  const action = { ...withoutDigest, digest: digestPayload(withoutDigest) } as SecondaryProviderActionEnvelope;
  const validated = validateSecondaryProviderAction(action);
  if (!validated) throw new Error('次级 Provider action 超出安全边界');
  return validated;
}

export function createSecondaryProviderActionForNode(
  nodeId: string,
  nodeType: SecondaryProviderActionNodeType,
  draft: SecondaryProviderActionDraft,
  options: { requestId?: string; issuedAt?: number } = {},
) {
  return createSecondaryProviderAction({ nodeId, nodeType, ...draft } as SecondaryProviderActionRequest, options);
}

export function secondaryProviderActionNodePatch(action: SecondaryProviderActionEnvelope | null) {
  return { [SECONDARY_PROVIDER_ACTION_DATA_KEY]: action };
}

export function secondaryProviderActionFromNodeData(data: unknown): SecondaryProviderActionEnvelope | null {
  if (!ownRecord(data)) return null;
  return validateSecondaryProviderAction(data[SECONDARY_PROVIDER_ACTION_DATA_KEY]);
}

export function requestCanvasSecondaryProviderAction(action: SecondaryProviderActionEnvelope): boolean {
  const validated = validateSecondaryProviderAction(action);
  if (!validated || typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent<CanvasSecondaryProviderActionRequestDetail>(CANVAS_SECONDARY_PROVIDER_ACTION_REQUEST_EVENT, {
    detail: { action: validated },
  }));
  return true;
}

export function resolveSecondaryProviderActionForRun(input: {
  nodeId: string;
  nodeType: SecondaryProviderActionNodeType;
  nodeData: unknown;
  runContext: RunContext | null;
}): SecondaryProviderActionEnvelope | null {
  const action = secondaryProviderActionFromNodeData(input.nodeData);
  const context = input.runContext;
  if (!action || !context) return null;
  if (action.nodeId !== input.nodeId || action.nodeType !== input.nodeType) return null;
  if (context.requestId !== action.requestId
    || context.secondaryProviderActionSchema !== action.schema
    || context.secondaryProviderActionId !== action.actionId
    || context.secondaryProviderActionTarget !== action.target
    || context.secondaryProviderActionDigest !== action.digest) return null;
  if (context.plannedNodeIds.length !== 1 || context.plannedNodeIds[0] !== input.nodeId) return null;
  if (context.authorizedNodeIds?.length !== 1 || context.authorizedNodeIds[0] !== input.nodeId) return null;
  return action;
}

export function secondaryProviderActionCapabilityHint(action: SecondaryProviderActionEnvelope): SecondaryProviderActionCapabilityHint {
  if (action.actionId === 'generation-target.generate') {
    return { provider: 'zhenzhen-image', model: action.params.apiModel, credential: 'gpt-image' };
  }
  if (action.actionId === 'image-edit.annotation') {
    return { provider: 'zhenzhen-image', model: action.params.providerModel, credential: 'gpt-image' };
  }
  if (action.actionId === 'panorama-3d.ai-action-plan') {
    return { provider: 'zhenzhen-llm', model: 'gpt-4o-mini', credential: 'llm' };
  }
  if (action.actionId === 'rh-image.editor-cutout' || action.actionId === 'rh-image.capability' || action.actionId === 'rh-video.capability') {
    return { provider: 'runninghub-cn', model: action.params.preferredToolId || action.params.capability, credential: 'runninghub-cn' };
  }
  return { provider: 'local', model: null, credential: null };
}

export interface SecondaryProviderActionExecution {
  action: SecondaryProviderActionEnvelope;
  reporter: RunNodeLifecycleReporter;
}

export type SecondaryProviderActionExecutor = (execution: SecondaryProviderActionExecution) => Promise<void> | void;

interface ExecutorRegistration {
  token: symbol;
  executor: SecondaryProviderActionExecutor;
}

// React may briefly keep the previous instance alive while a replacement for
// the same logical node is mounted (StrictMode, Suspense, or HMR). Treat that
// overlap as a scoped registration stack: the newest live instance owns
// execution, and removing it restores the previous live instance. Keys still
// include node id + action id + target, so executors can never cross nodes.
const executorRegistry = new Map<string, ExecutorRegistration[]>();

function executorKey(nodeId: string, actionId: SecondaryProviderActionId, target: SecondaryProviderActionTarget) {
  return `${nodeId}\u0000${actionId}\u0000${target}`;
}

export function registerSecondaryProviderActionExecutor(
  nodeId: string,
  actionId: SecondaryProviderActionId,
  target: SecondaryProviderActionTarget,
  executor: SecondaryProviderActionExecutor,
) {
  const key = executorKey(nodeId, actionId, target);
  const entry = { token: Symbol(key), executor };
  executorRegistry.set(key, [...(executorRegistry.get(key) || []), entry]);
  return () => {
    const registrations = executorRegistry.get(key);
    if (!registrations) return;
    const next = registrations.filter((registration) => registration.token !== entry.token);
    if (next.length > 0) executorRegistry.set(key, next);
    else executorRegistry.delete(key);
  };
}

export async function executeRegisteredSecondaryProviderAction(
  action: SecondaryProviderActionEnvelope,
  reporter: RunNodeLifecycleReporter,
) {
  const validated = validateSecondaryProviderAction(action);
  if (!validated) throw new Error('次级 Provider action 已损坏，已停止调用 Provider');
  const registrations = executorRegistry.get(executorKey(validated.nodeId, validated.actionId, validated.target));
  const entry = registrations?.[registrations.length - 1];
  if (!entry) throw new Error(`次级 Provider action executor 不可用：${validated.actionId}/${validated.target}`);
  await entry.executor({ action: validated, reporter });
}

export function clearSecondaryProviderActionExecutorsForTests() {
  executorRegistry.clear();
}
