/**
 * 生成服务 - 封装代理调用
 * 所有请求走 /api/proxy/* (后端会注入对应 Key 并转存结果)
 */
import type { AdvancedProviderConfig } from '../types/canvas';
import type { SunoNzOperation, SunoNzResultFamily } from '../providers/models';
import { normalizeProviderErrorMessage } from '../utils/providerErrorMessage.ts';

export interface ProviderTransportTrace {
  /** 上游或本地代理显式返回的请求 ID；绝不从通用 id 字段猜测。 */
  requestId?: string;
  /** 浏览器到本地后端这一跳的真实 HTTP 状态。 */
  transportHttpStatus?: number;
  /** 仅当后端适配器显式返回时存在，不能用本地代理状态冒充。 */
  upstreamHttpStatus?: number;
  usage?: Record<string, unknown>;
}
export interface ProviderSubmissionTransport {
  submissionKey?: string | null;
  signal?: AbortSignal;
}

export function providerSubmissionHeaders(transport: ProviderSubmissionTransport = {}): Record<string, string> {
  const key = String(transport.submissionKey || '').trim();
  return {
    'Content-Type': 'application/json',
    ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/.test(key)
      ? { 'X-T8-Provider-Submission': key }
      : {}),
  };
}


function providerTransportTrace(payload: unknown, response: Response): ProviderTransportTrace {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, any>
    : {};
  const requestId = String(
    record.requestId
    || record.request_id
    || response.headers?.get?.('x-request-id')
    || '',
  ).trim();
  const upstreamHttpStatus = Number(record.upstreamHttpStatus ?? record.upstream_http_status);
  const usage = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? record.usage as Record<string, unknown>
    : record.raw?.usage && typeof record.raw.usage === 'object' && !Array.isArray(record.raw.usage)
      ? record.raw.usage as Record<string, unknown>
      : undefined;
  return {
    ...(requestId ? { requestId } : {}),
    transportHttpStatus: response.status,
    ...(Number.isInteger(upstreamHttpStatus) && upstreamHttpStatus >= 100 && upstreamHttpStatus <= 599
      ? { upstreamHttpStatus }
      : {}),
    ...(usage ? { usage } : {}),
  };
}

function withProviderTransportTrace<T extends Record<string, any>>(
  payload: T | null | undefined,
  response: Response,
): T & ProviderTransportTrace {
  const record = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as T;
  return { ...record, ...providerTransportTrace(record, response) };
}

function providerResponseError(response: Response, data: any, fallback?: string): Error & Record<string, any> {
  const error = new Error(normalizeProviderErrorMessage(
    [data?.error, data?.message],
    fallback || `HTTP ${response.status}`,
  )) as Error & Record<string, any>;
  const trace = providerTransportTrace(data?.data ?? data, response);
  error.transportHttpStatus = trace.transportHttpStatus;
  error.status = response.status;
  const errorCode = String(data?.code || data?.data?.code || '').trim();
  if (errorCode) error.code = errorCode;
  if (trace.requestId) error.requestId = trace.requestId;
  if (trace.upstreamHttpStatus) error.upstreamHttpStatus = trace.upstreamHttpStatus;
  if (trace.usage) error.usage = trace.usage;
  return error;
}

async function safeJsonResponse(response: Response, label: string): Promise<any> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown';
    const looksLikeHtml = /^<!doctype html|^<html|cannot\s+(post|get)\s+/i.test(trimmed);
    const hint = looksLikeHtml
      ? '（本地后端可能没有命中该 API，常见原因是后端未重启或代理返回了 HTML 页面）'
      : '';
    const preview = trimmed.replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`${label} 返回了非 JSON 响应${hint}：HTTP ${response.status} ${contentType} · ${preview}`);
  }
}

export interface GenerateImageRequest {
  model: string;          // 节点 id (gpt-image-2 / nano-banana-2 / nano-banana-pro / grok-image / seedream-v5-pro)
  apiModel?: string;       // 上游真实模型名(优先使用)
  paramKind?: 'gpt-size' | 'banana-ratio' | 'grok-image' | 'seedream-v5' | 'seedream-layer' | 'qwen-image-3.0' | 'wan-image' | 'mj';
  prompt: string;
  n?: number;
  // 主参数(双协议通用):
  aspectRatio?: string;    // camelCase 兼容字段，后端仍以 aspect_ratio 为主
  aspect_ratio?: string;   // 1:1 / 16:9 / Auto …
  sizeLevel?: string;      // camelCase 兼容字段，后端仍以 image_size 为主
  image_size?: string;     // 1K / 2K / 4K (banana) 或像素串(GPT 也可透传)
  // 多张参考图(base64 dataURL 或 http(s):// URL)
  images?: string[];
  quality?: string;
  moderation?: 'auto' | 'low';
  // 兼容旧参数:若传了 size(像素串)则优先用、image 单张也会并入 images
  size?: string;
  image?: string;
  response_format?: 'url' | 'b64_json';
  output_format?: 'png' | 'jpeg';
  providerParams?: Record<string, any>;
}

export interface GenerateImageResult extends ProviderTransportTrace {
  urls: string[]; // 本地相对 URL,如 /files/output/xxx.png
  raw: any;
}

export async function generateImage(
  req: GenerateImageRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<GenerateImageResult> {
  const r = await fetch('/api/proxy/image', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw providerResponseError(r, data);
  }
  return data.data;
}

export interface GenerateExternalImageRequest {
  providerId: string;
  provider?: AdvancedProviderConfig;
  providerModel?: string;
  model?: string;
  prompt?: string;
  size?: string;
  width?: number;
  height?: number;
  n?: number;
  images?: string[];
  videos?: string[];
  audios?: string[];
  negativePrompt?: string;
  negative?: string;
  seed?: number;
  providerParams?: Record<string, any>;
}

export interface GenerateExternalImageResult extends ProviderTransportTrace {
  imageUrls: string[];
  remoteImageUrls?: string[];
  videoUrls?: string[];
  remoteVideoUrls?: string[];
  audioUrls?: string[];
  remoteAudioUrls?: string[];
  outputKinds?: Array<'image' | 'video' | 'audio' | 'text'>;
  primaryKind?: 'image' | 'video' | 'audio' | 'text';
  outputSaveErrors?: Array<{ kind: string; url: string; code?: string; error: string }>;
  text?: string;
  taskId?: string;
  raw?: any;
  provider?: any;
}

export async function generateExternalImage(
  req: GenerateExternalImageRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<GenerateExternalImageResult> {
  const r = await fetch('/api/proxy/external/image', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw providerResponseError(r, data);
  }
  const payload = data.data || {};
  return {
    imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : [],
    remoteImageUrls: Array.isArray(payload.remoteImageUrls) ? payload.remoteImageUrls : undefined,
    videoUrls: Array.isArray(payload.videoUrls) ? payload.videoUrls : undefined,
    remoteVideoUrls: Array.isArray(payload.remoteVideoUrls) ? payload.remoteVideoUrls : undefined,
    audioUrls: Array.isArray(payload.audioUrls) ? payload.audioUrls : undefined,
    remoteAudioUrls: Array.isArray(payload.remoteAudioUrls) ? payload.remoteAudioUrls : undefined,
    outputKinds: Array.isArray(payload.outputKinds) ? payload.outputKinds : undefined,
    primaryKind: payload.primaryKind,
    outputSaveErrors: Array.isArray(payload.outputSaveErrors) ? payload.outputSaveErrors : undefined,
    text: typeof payload.text === 'string' ? payload.text : undefined,
    taskId: payload.taskId,
    raw: payload.raw,
    provider: payload.provider,
    ...providerTransportTrace(payload, r),
  };
}

export interface GenerateExternalVideoRequest {
  providerId: string;
  providerModel?: string;
  model?: string;
  prompt: string;
  aspect_ratio?: string;
  ratio?: string;
  duration?: number | string;
  resolution?: string;
  seed?: number;
  images?: string[];
  videos?: string[];
  audios?: string[];
  providerParams?: Record<string, any>;
}

export interface GenerateExternalVideoResult extends ProviderTransportTrace {
  videoUrls: string[];
  remoteVideoUrls?: string[];
  taskId?: string;
  raw?: any;
  provider?: any;
}

export async function generateExternalVideo(
  req: GenerateExternalVideoRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<GenerateExternalVideoResult> {
  const r = await fetch('/api/proxy/external/video', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw providerResponseError(r, data);
  }
  const payload = data.data || {};
  return {
    videoUrls: Array.isArray(payload.videoUrls) ? payload.videoUrls : [],
    remoteVideoUrls: Array.isArray(payload.remoteVideoUrls) ? payload.remoteVideoUrls : undefined,
    taskId: payload.taskId,
    raw: payload.raw,
    provider: payload.provider,
    ...providerTransportTrace(payload, r),
  };
}

// ========================================================================
// 图像异步任务(对齐 gpt-image-2-web 的 submit + poll 模式)
// submitImageAsync 返 { sync, taskId?, urls?, status, progress }
//   - sync=true: 同步完成,urls 已存在
//   - sync=false: 需轮询 queryImageStatus(taskId)
// ========================================================================
export interface ImageSubmitResult extends ProviderTransportTrace {
  sync: boolean;
  taskId?: string;
  urls?: string[];
  status: string;       // pending / running / completed / failed
  progress: string;     // '0%' / '50%' / '100%'
  raw?: any;
}

export async function submitImageAsync(
  req: GenerateImageRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<ImageSubmitResult> {
  const r = await fetch('/api/proxy/image/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface ImageQueryResult extends ProviderTransportTrace {
  status: string;       // pending / running / completed / failed
  progress: string;
  urls?: string[];
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
  operationResult?: {
    image_id?: string;
    objects?: Array<Record<string, any>>;
    [key: string]: any;
  };
}

// apiModel 透传给后端，让轮询阶段复用与 submit 一致的分类 API Key
// (否则 hint 为空时会 fallback 到通用 zhenzhenApiKey，分类 key 失效)
export async function queryImageStatus(taskId: string, apiModel?: string, transport: ProviderSubmissionTransport = {}): Promise<ImageQueryResult> {
  const qs = apiModel ? `?model=${encodeURIComponent(apiModel)}` : '';
  const r = await fetch(`/api/proxy/image/status/${encodeURIComponent(taskId)}${qs}`, { signal: transport.signal });
  const data = await r.json();
  if (!r.ok) throw providerResponseError(r, data);
  // 失败状态下 success=false 但返回 body 中仍包含 status:'failed'
  return withProviderTransportTrace(
    data.data || { status: data.success ? 'pending' : 'failed', progress: '0%', error: data?.error },
    r,
  );
}

export interface SeedreamNzSubmitRequest {
  prompt: string;
  images?: string[];
  model?:
    | 'zhenzhen-image-g2-t2i'
    | 'zhenzhen-image-g2-i2i'
    | 'zhenzhen-image-g-v2-lowprice'
    | 'zhenzhen-image-gk-v2'
    | 'zhenzhen-image-gk-v2-edit'
    | 'zhenzhen-image-gk-v2-segment'
    | 'zhenzhen-image-gk-v2-region-edit'
    | 'zhenzhen-image-gk-v15'
    | 'zhenzhen-image-gk-v15-edit'
    | 'zhenzhen-image-nb-2-lite'
    | 'zhenzhen-image-nb-2'
    | 'zhenzhen-image-nb-pro'
    | 'qwen-image-3.0-t2i'
    | 'qwen-image-3.0-i2i'
    | 'qwen-image-3.0-pro-t2i'
    | 'qwen-image-3.0-pro-i2i'
    | 'qwen-image-3.0-global-t2i'
    | 'qwen-image-3.0-global-i2i'
    | 'qwen-image-3.0-global-pro-t2i'
    | 'qwen-image-3.0-global-pro-i2i'
    | 'wan-2.7-global-t2i'
    | 'wan-2.7-global-i2i'
    | 'wan-2.7-global-i2i-pro'
    | 'seedream-v5-pro-layer-decomposition'
    | 'dola-seedream-5.0-pro-layer-decomposition';
  modelFamily?: 'domestic' | 'overseas';
  resolution?: 'auto' | '0.5k' | '1k' | '1.5k' | '2k' | '4k';
  ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4';
  size?: string;
  n?: number;
  output_format?: 'png' | 'jpeg';
  negative_prompt?: string;
  prompt_extend?: boolean;
  sizing_mode?: 'auto' | 'ratio' | 'custom_size';
  seed?: number;
  width?: number;
  height?: number;
  thinking_mode?: boolean;
  aspect_ratio?: string;
  nsfw_check?: boolean;
  operation?: 'segment' | 'region_edit';
  source_task_id?: string;
  include_mask_rle?: boolean;
  image_id?: string;
  object_indices?: number[];
  boxes?: number[][];
  selection_regions?: Array<Record<string, any>>;
}

export async function submitSeedreamNz(
  req: SeedreamNzSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<ImageSubmitResult> {
  const r = await fetch('/api/proxy/image/seedance-nz/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋图像任务提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function querySeedreamNz(taskId: string, transport: ProviderSubmissionTransport = {}): Promise<ImageQueryResult> {
  const r = await fetch(`/api/proxy/image/seedance-nz/status/${encodeURIComponent(taskId)}`, { signal: transport.signal });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋图像任务查询');
  if (!r.ok) throw providerResponseError(r, data);
  return withProviderTransportTrace(
    data.data || { status: data.success ? 'pending' : 'failed', progress: '0%', error: data?.error },
    r,
  );
}

export type MidjourneyNzOperation =
  | 'midjourney-blend'
  | 'midjourney-describe'
  | 'midjourney-edits'
  | 'midjourney-high-variation'
  | 'midjourney-imagine'
  | 'midjourney-inpaint'
  | 'midjourney-low-variation'
  | 'midjourney-modal'
  | 'midjourney-pan'
  | 'midjourney-remix-strong'
  | 'midjourney-remix-subtle'
  | 'midjourney-reroll'
  | 'midjourney-upscale'
  | 'midjourney-variation'
  | 'midjourney-video'
  | 'midjourney-zoom';

export interface MidjourneyNzSubmitRequest {
  operation: MidjourneyNzOperation;
  prompt?: string;
  images?: string[];
  task_id?: string;
  index?: number;
  custom_id?: string;
  speed?: 'relax' | 'fast' | 'turbo';
  dimensions?: 'SQUARE' | 'PORTRAIT' | 'LANDSCAPE';
  size?: string;
  direction?: 'left' | 'right' | 'up' | 'down';
  zoom_ratio?: number;
  modal_mode?: 'region' | 'outpaint';
  mask_url?: string;
  video_type?:
    | 'vid_1.1_i2v_480'
    | 'vid_1.1_i2v_720'
    | 'vid_1.1_i2v_start_end_480'
    | 'vid_1.1_i2v_start_end_720';
  animate_mode?: 'manual' | 'auto';
  motion?: 'low' | 'high';
  batch_size?: 1 | 2 | 4;
  end_url?: string;
  quality?: '0.25' | '0.5' | '1' | '2';
  style?: string;
  version?: '5' | '5.1' | '5.2' | '6' | '6.1' | '7' | '8.1' | '8.2';
  seed?: number;
  negative_prompt?: string;
  stylize?: number;
  chaos?: number;
  weird?: number;
  tile?: boolean;
  niji?: boolean;
  iw?: number;
  cw?: number;
  sw?: number;
  cref?: string;
  sref?: string;
  dref?: string;
  dw?: number;
  repeat?: number;
  raw?: boolean;
  draft?: boolean;
  hd?: boolean;
  stop?: number;
  extra?: string;
  metadata?: Record<string, unknown>;
}

export interface MidjourneyNzTaskResult extends ProviderTransportTrace {
  sync?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'modal' | 'materializing' | string;
  progress?: string;
  taskId?: string;
  action?: string;
  operation?: MidjourneyNzOperation | string;
  resultFamily?: 'image' | 'video' | 'text' | 'modal' | string;
  imageUrls?: string[];
  videoUrls?: string[];
  text?: string;
  buttons?: Array<{ customId?: string; label?: string }>;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function submitMidjourneyNz(
  req: MidjourneyNzSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<MidjourneyNzTaskResult> {
  const r = await fetch('/api/proxy/image/seedance-nz/midjourney/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Midjourney 任务提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data || {}, r) as MidjourneyNzTaskResult;
}

export async function queryMidjourneyNz(taskId: string): Promise<MidjourneyNzTaskResult> {
  const r = await fetch(`/api/proxy/image/seedance-nz/midjourney/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Midjourney 任务查询');
  if (!r.ok) throw providerResponseError(r, data);
  return withProviderTransportTrace(
    data.data || { status: data.success ? 'pending' : 'failed', error: data?.error },
    r,
  ) as MidjourneyNzTaskResult;
}

// ========================================================================
// FAL 渠道(独立提交 + 轮询,对齐 gpt-image-2-web runGPTFal / runNanoFal)
//   submitImageFal 返 { sync, urls? } 或 { sync:false, requestId, endpoint }
//   queryImageFal  返 { status: 'pending'|'completed'|'failed', urls?, error? }
// ========================================================================
export interface FalSubmitRequest {
  /** 'gpt-image-2-fal' | 'nano-banana-pro-fal' */
  apiModel: string;
  prompt: string;
  /** 参考图 URL(本地 /files/* 或 base64 dataURI),后端会上传到 /v1/files 取 URL */
  images?: string[];
  /** 生成张数 1-4 */
  n?: number;
  /** 输出格式 png / jpeg / webp */
  format?: 'png' | 'jpeg' | 'webp';
  /** 同步模式(true 会在提交请求中附加 sync_mode:true,贞贞上游如果接受会同步返 images) */
  sync?: boolean;

  // === gpt-fal 专属 ===
  /** 'edit' | 'gen';不填时有参考图走 edit,无参考图走 gen */
  mode?: 'edit' | 'gen';
  /** 'auto' / 'square_hd' / 'square' / 'portrait_4_3' / 'portrait_16_9' / 'landscape_4_3' / 'landscape_16_9' / 'custom' */
  size?: string;
  /** size === 'custom' 时有效,后端会 snap 到 16 倍数 */
  customW?: number;
  customH?: number;
  /** 'low' | 'medium' | 'high' | 'auto' 主项目默认 medium */
  quality?: 'low' | 'medium' | 'high' | 'auto';

  // === nbpro-fal 专属 ===
  /** 'auto' / '21:9' / '16:9' / '3:2' / '4:3' / '5:4' / '1:1' / '4:5' / '3:4' / '2:3' / '9:16' */
  aspect_ratio?: string;
  /** '1K' / '2K' / '4K' */
  resolution?: string;
  /** '1'(严)..'6'(松) 默认 '4' */
  safety_tolerance?: string;
  /** 0 = 不传 */
  seed?: number;
  system_prompt?: string;
  enable_web_search?: boolean;
  /** 'image_url'(上传贞贞取 URL) | 'base64' 默认 'image_url' */
  image_mode?: 'image_url' | 'base64';
  providerParams?: Record<string, any>;
}

export interface FalSubmitResult extends ProviderTransportTrace {
  sync: boolean;
  urls?: string[];
  requestId?: string;
  endpoint?: string;
}

export async function submitImageFal(
  req: FalSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<FalSubmitResult> {
  const r = await fetch('/api/proxy/image/fal/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return data.data;
}

export interface FalQueryResult extends ProviderTransportTrace {
  status: 'pending' | 'completed' | 'failed' | string;
  urls?: string[];
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
  falStatus?: string;
}

export async function queryImageFal(params: { endpoint?: string; requestId?: string }, transport: ProviderSubmissionTransport = {}): Promise<FalQueryResult> {
  const r = await fetch('/api/proxy/image/fal/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: transport.signal,
  });
  const data = await r.json();
  // 后端在 FAILED 时会 success=false 但 data.status='failed',这里返回结果供上层判断
  if (!r.ok && !data.data) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data || { status: 'failed', error: data?.error || 'unknown' }, r);
}

// ========== Midjourney (严格对齐 gpt-image-2-web/index.html runMJ L4437~L4694 + uploadMJImage L4407) ==========
// 后端路由: /api/proxy/mj/imagine | /api/proxy/mj/task/:id | /api/proxy/mj/upload

export type MjSpeed = 'fast' | 'turbo' | 'relax';

export interface MjPromptParts {
  prompt: string;
  model?: string;       // 例如 'v 8.1' / 'niji 7'
  ar?: string;          // 例如 '1:1' / '16:9'
  no?: string;
  c?: number;
  s?: number;
  iw?: number;
  sw?: number;
  cw?: number;
  sv?: string;          // '1' | '2' | '3' | '4'
  srefUrls?: string[];  // --sref 风格参考图 URL
  orefUrls?: string[];  // --oref 角色参考图 URL
}

/** 拼装 MJ prompt — 与 index.html L4467~L4485 严格一致 */
export function buildMjPrompt(p: MjPromptParts): string {
  let full = p.prompt || '';
  if (p.model) full += ` --${p.model}`;
  if (p.ar) full += ` --ar ${p.ar}`;
  if (p.no) full += ` --no ${p.no}`;
  if (p.c) full += ` --c ${p.c}`;
  if (p.s) full += ` --s ${p.s}`;
  if (p.iw) full += ` --iw ${p.iw}`;
  if (p.sw) full += ` --sw ${p.sw}`;
  if (p.cw) full += ` --cw ${p.cw}`;
  if (p.sv && p.sv !== '0' && p.sv !== '1') full += ` --sv ${p.sv}`;
  for (const u of p.srefUrls || []) if (u) full += ` --sref ${u}`;
  for (const u of p.orefUrls || []) if (u) full += ` --oref ${u}`;
  return full;
}

export interface MjImagineRequest {
  prompt: string;          // 已经拼装好的完整 prompt
  speed?: MjSpeed;
  base64Array?: string[];  // 通常空数组(参考图走 sref/oref URL)
  ar?: string;
  no?: string;
  c?: number;
  s?: number;
  iw?: number;
  sw?: number;
  cw?: number;
  sv?: string;
  seed?: number;
  remix?: boolean;
}

export interface MjImagineResult extends ProviderTransportTrace {
  taskId: string;
}

export async function submitMjImagine(
  req: MjImagineRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<MjImagineResult> {
  const r = await fetch('/api/proxy/mj/imagine', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  const result = data.data || {};
  const taskId = String(result.taskId || '');
  if (!taskId) throw new Error('MJ 未返回 taskId');
  return { taskId, ...providerTransportTrace(result, r) };
}

export interface MjTaskResult extends ProviderTransportTrace {
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE' | string;
  progress?: string;
  imageUrl?: string;
  imageUrls?: string[];   // 4 张子图
  failReason?: string;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function queryMjTask(taskId: string, speed: MjSpeed = 'fast'): Promise<MjTaskResult> {
  const r = await fetch(`/api/proxy/mj/task/${encodeURIComponent(taskId)}?speed=${encodeURIComponent(speed)}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  const d = data.data || {};
  // 主项目 L4675~L4694: image_urls 可能是 JSON 字符串 / 对象数组 / 字符串数组
  // 元素可能为字符串 '...' 或对象 { url: '...' }，对齐主项目用 x.url || x 兼容
  // 另外上游字段名可能为 snake_case (image_url/image_urls) 或 camelCase (imageUrl/imageUrls)
  let imageUrls: string[] | undefined;
  const rawList = d.image_urls ?? d.imageUrls;
  if (rawList) {
    let parsed: any = rawList;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    if (Array.isArray(parsed)) {
      imageUrls = parsed
        .map((x: any) => (typeof x === 'string' ? x : (x && (x.url || x.image_url || x.imageUrl)) || ''))
        .filter((u: any): u is string => typeof u === 'string' && !!u);
    }
  }
  return {
    status: d.status || 'IN_PROGRESS',
    progress: d.progress,
    imageUrl: d.image_url || d.imageUrl,
    imageUrls,
    failReason: d.fail_reason || d.failReason,
    error: d.error,
    code: d.code,
    recoverable: d.recoverable,
    retryAfterMs: d.retryAfterMs,
    ...providerTransportTrace(d, r),
  };
}

/** 上传参考图(sref/oref)并取 URL — 对应主项目 uploadMJImage L4407 */
export async function uploadMjImage(file: File, speed: MjSpeed = 'fast'): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const r = await fetch('/api/proxy/mj/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data: dataUrl, speed }),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  const url = data.data?.url || '';
  if (!url) throw new Error('MJ upload 未返回 URL');
  return url;
}

// LLM
// content 支持多模态:字符串 或 [{type:'text',text} | {type:'image_url',image_url:{url}} | {type:'video_url',video_url:{url}}]
// (对齐 gpt-image-2-web _doSendChat 多模态格式, index.html L8106~L8123)
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } };

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export interface GenerateLlmRequest {
  model: string;
  messages: LlmMessage[];
  /** 内置 LLM 平台；缺省保持贞贞 AI 工坊独立 LLM Key。 */
  source?: 'zhenzhen' | 'seedance-nz';
  temperature?: number;
  max_tokens?: number;
  /** 视频传入方式：frames 抽关键帧；native/compressed-base64 重编码视频；raw-base64 有界保留完整原文件；url 转绝对 URL。 */
  llmVideoMode?: 'frames' | 'native-base64' | 'compressed-base64' | 'raw-base64' | 'url';
  videoMaxWidth?: number;
  videoMaxHeight?: number;
  videoMaxBase64Mb?: number;
  videoCrf?: number;
  /** 关键帧模式下抽取的帧数，后端会按视频时长均匀抽取。 */
  videoFrameCount?: number;
  /** 流式开关;默认 false(非流式) */
  stream?: boolean;
  /** 后端受控请求配置；提示词增强器使用真实媒体上传并禁止自动重放付费请求。 */
  requestProfile?: 'minimax-h3-prompt-enhancer' | 'minimax-music3-prompt-enhancer' | 'seedance20-prompt-enhancer' | 'mv-music-master' | 'localization-master';
}

export interface GenerateLlmResult {
  content: string;
  /** 仅 gpt-image-2-all 等出图模型返回 */
  imageUrls?: string[];
  finishReason?: string;
  truncated?: boolean;
  raw: any;
  model: string;
  requestId?: string;
  transportHttpStatus?: number;
  usage?: Record<string, unknown>;
}

export function buildGenerateLlmRequestBody(req: GenerateLlmRequest): GenerateLlmRequest {
  return { ...req, stream: false };
}

export async function generateLlm(
  req: GenerateLlmRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<GenerateLlmResult> {
  const r = await fetch('/api/proxy/llm', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(buildGenerateLlmRequestBody(req)),
    signal: transport.signal,
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw providerResponseError(r, data);
  }
  const payload = data.data || {};
  return {
    ...payload,
    ...providerTransportTrace(payload, r),
  };
}

export interface GenerateExternalLlmRequest extends Omit<GenerateLlmRequest, 'stream'> {
  providerId: string;
  providerModel?: string;
  providerParams?: Record<string, any>;
  /** 扩展 LLM 同步请求超时；由后端限界，Music 3 多阶段任务需显式放宽。 */
  timeoutMs?: number;
}

export function buildGenerateExternalLlmRequestBody(req: GenerateExternalLlmRequest): GenerateExternalLlmRequest {
  return { ...req };
}

export async function generateExternalLlm(
  req: GenerateExternalLlmRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<GenerateLlmResult> {
  const r = await fetch('/api/proxy/external/llm', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(buildGenerateExternalLlmRequestBody(req)),
    signal: transport.signal,
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw providerResponseError(r, data);
  }
  const payload = data.data || {};
  return {
    content: payload.text || payload.content || '',
    imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : undefined,
    finishReason: payload.finishReason || payload.finish_reason || payload.raw?.choices?.[0]?.finish_reason,
    truncated: payload.truncated === true || payload.raw?.choices?.[0]?.finish_reason === 'length',
    raw: payload.raw,
    model: req.model,
    ...providerTransportTrace(payload, r),
  };
}

/**
 * 流式 LLM 调用,后端透传上游 SSE。
 * @param req 请求(自动注入 stream:true)
 * @param opts.onDelta 每个增量片段回调(实时拼接)
 * @param opts.signal AbortSignal 支持中断
 * @returns 最终拼接后的完整 content 与上游 finish_reason
 * 对齐 gpt-image-2-web index.html L8262~L8295 流式解析逻辑。
 */
export async function generateLlmStream(
  req: GenerateLlmRequest,
  opts: { onDelta?: (chunk: string) => void; signal?: AbortSignal; submissionKey?: string | null } = {}
): Promise<{ content: string; finishReason?: string; truncated?: boolean; requestId?: string; transportHttpStatus?: number; usage?: Record<string, unknown> }> {
  const r = await fetch('/api/proxy/llm', {
    method: 'POST',
    headers: providerSubmissionHeaders(opts),
    body: JSON.stringify({ ...req, stream: true }),
    signal: opts.signal,
  });
  if (!r.ok) {
    // 后端在 stream 错路仍返 JSON
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j?.error || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  if (!r.body) throw new Error('上游未返回可读流');
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let assembled = '';
  let buffer = '';
  let finishReason = '';
  let usage: Record<string, unknown> | undefined;
  const requestId = r.headers?.get?.('x-request-id') || undefined;
  const finish = () => ({
    content: assembled,
    finishReason: finishReason || undefined,
    truncated: ['length', 'max_tokens', 'content_length'].includes(String(finishReason || '').toLowerCase()),
    requestId,
    transportHttpStatus: r.status,
    usage,
  });
  const processSseLine = (raw: string): boolean => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    try {
      const j = JSON.parse(data);
      const choice = j?.choices?.[0];
      if (j?.usage && typeof j.usage === 'object') usage = j.usage;
      const delta = choice?.delta?.content;
      if (choice?.finish_reason || choice?.finishReason) {
        finishReason = String(choice.finish_reason || choice.finishReason || '');
      }
      if (typeof delta === 'string' && delta.length) {
        assembled += delta;
        opts.onDelta?.(delta);
      }
    } catch {
      /* 心跳或不完整 JSON 忽略 */
    }
    return false;
  };
  // SSE 按行解析
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      if (processSseLine(raw)) return finish();
    }
  }
  if (buffer.trim()) processSseLine(buffer);
  return finish();
}

/** File → dataURL(对齐主项目 FileReader.readAsDataURL) */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target?.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

// 文件上传
export async function uploadFile(file: File): Promise<{ url: string; filename: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/files/upload', { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw providerResponseError(r, data);
  }
  return data.data;
}

// ========================================================================
// Video FAL 渠道(独立提交 + 轮询,对齐 gpt-image-2-web runVeo3Fal / runGrokFal / runSora2Fal)
//   submitVideoFal 返 { sync, videoUrl? } 或 { sync:false, requestId, endpoint }
//   queryVideoFal  返 { status: 'pending'|'completed'|'failed', videoUrl?, error? }
// ========================================================================
export interface VideoFalSubmitRequest {
  /** 'veo3.1-fal' | 'grok-video-fal' | 'grok-imagine-video-1.5' | 'sora-2' */
  apiModel: string;
  prompt: string;
  /** 参考图(base64 dataURI 或本地 /files/* URL) */
  images?: string[];
  /** veo-fal: '16:9' | '9:16' */
  aspect_ratio?: string;
  /** veo-fal: '8s' */
  duration?: string;
  /** veo-fal: '720p' | '1080p' | '4k';  grok-fal: '720p' | '480p' */
  resolution?: string;
  /** veo-fal: 生成音频 */
  generate_audio?: boolean;
  /** veo-fal: 1-6 (默认 4) */
  safety_tolerance?: number;
  /** 参考图上传方式: 'image_url'(上传取URL) | 'base64'；Grok 1.5 默认 base64 */
  image_mode?: 'image_url' | 'base64';
  /** grok-fal: 时长秒数 1-30 */
  gkDuration?: number;
  /** grok-fal: 比例 */
  gkRatio?: string;
  /** grok-fal: 图生视频取首图; 参考生视频取最多 7 张参考图 */
  gkMode?: 'image_to_video' | 'reference_to_video';
  /** grok-fal reference_to_video: 额外公网参考图 URL */
  gkReferenceUrls?: string[];
  /** sora-fal: auto | text_to_video | image_to_video */
  soraMode?: 'auto' | 'text_to_video' | 'image_to_video';
  /** sora-fal: '16:9' | '9:16' | 'auto' */
  soraRatio?: string;
  /** sora-fal: 时长秒数 4/8/12/16/20 */
  soraDuration?: number;
  /** sora-fal: '720p' | 'auto' */
  soraResolution?: string;
  /** sora-fal: 是否删除上游视频缓存 */
  soraDeleteVideo?: boolean;
  /** sora-fal: detect_and_block_ip */
  soraBlockIp?: boolean;
  /** sora-fal: 最多 2 个 character id，逗号分隔 */
  soraCharacterIds?: string;
  providerParams?: Record<string, any>;
}

export interface VideoFalSubmitResult extends ProviderTransportTrace {
  sync: boolean;
  videoUrl?: string;
  requestId?: string;
  endpoint?: string;
}

export async function submitVideoFal(
  req: VideoFalSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<VideoFalSubmitResult> {
  const r = await fetch('/api/proxy/video/fal/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface VideoFalQueryResult extends ProviderTransportTrace {
  status: 'pending' | 'completed' | 'failed' | string;
  videoUrl?: string;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
  falStatus?: string;
}

export async function queryVideoFal(params: { endpoint?: string; requestId?: string }): Promise<VideoFalQueryResult> {
  const r = await fetch('/api/proxy/video/fal/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await r.json();
  if (!r.ok && !data.data) throw providerResponseError(r, data);
  const payload = withProviderTransportTrace(
    data.data || { status: 'failed', error: data?.error || 'unknown' },
    r,
  );
  return {
    ...payload,
    ...(payload.error !== undefined && payload.error !== null
      ? { error: normalizeProviderErrorMessage(payload.error, 'FAL 生成失败') }
      : {}),
  };
}

// ========================================================================
// 视频生成(异步) — 完全对齐 gpt-image-2-web
//   - veo3.1   字段:  aspect_ratio + enhance_prompt + enable_upsample + seed + images(base64,≤3)
//   - veo-omni 字段:  aspect_ratio + duration=10 + images(base64,取第1张),后端转 /v1/videos multipart
//   - grok     字段:  ratio + duration(秒,数字) + resolution + seed + images(本地 URL/base64,≤7,后端转上游 URL)
//   - grok 1.5 new: model(grok-1.5-video-*s) + size + images(取第1张),后端转 /v1/videos multipart
//   - sora2    字段:  aspect_ratio + duration + private + seed + images(base64,≤1)
//   - seedance 字段:  沿用 veo 字段(零破坏)
// 后端通过 model 字段名自动选择协议,前端无需显式传 kind。
// ========================================================================
export interface VideoSubmitRequest {
  model: string;
  prompt: string;
  // Veo / Veo3.1
  aspect_ratio?: string;
  enhance_prompt?: boolean;
  enable_upsample?: boolean;
  // Grok Video
  ratio?: string;
  duration?: number;
  resolution?: string;
  size?: string;
  // 通用
  seed?: number;
  /** Sora2 Zhenzhen API: 是否私密生成(对齐 gpt-image-2-web sr_private) */
  private?: boolean;
  is_private?: boolean;
  /**
   * 参考图。
   *  - veo3.1:   base64 dataURL,最多 3 张
   *  - veo-omni: base64 dataURL,取第 1 张并转为 input_reference multipart
   *  - grok:     可传 base64 dataURL 或 /files/* 本地 URL,最多 7 张(后端会上传到上游 /v1/files 取 URL)
   *  - sora2:    base64 dataURL,最多 1 张(后端会转为上游要求的裸 base64)
   *  - seedance: base64 dataURL,最多 3 张(同 veo)
   */
  images?: string[];
  providerParams?: Record<string, any>;
}

export interface VideoSubmitResult extends ProviderTransportTrace {
  taskId: string;
}

export async function submitVideo(
  req: VideoSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<VideoSubmitResult> {
  const r = await fetch('/api/proxy/video/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface VideoQueryResult extends ProviderTransportTrace {
  status: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'RUNNING' | string;
  progress?: string;
  videoUrl?: string | null;
  failReason?: string | null;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

// model 透传给后端，让轮询阶段复用与 submit 一致的分类 API Key
export async function queryVideo(taskId: string, model?: string): Promise<VideoQueryResult> {
  const extra = model ? `&model=${encodeURIComponent(model)}` : '';
  const r = await fetch(`/api/proxy/video/query?taskId=${encodeURIComponent(taskId)}${extra}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  const payload = data.data || {};
  return {
    ...payload,
    ...(payload.failReason !== undefined && payload.failReason !== null
      ? { failReason: normalizeProviderErrorMessage(payload.failReason, '生成失败') }
      : {}),
    ...providerTransportTrace(payload, r),
  };
}

export interface HappyHorseSubmitRequest {
  model: 'happyhorse-1.1-t2v' | 'happyhorse-1.1-i2v' | 'happyhorse-1.1-r2v';
  prompt?: string;
  duration: number;
  ratio: string;
  resolution: '720p' | '1080p';
  images?: string[];
}

export async function submitHappyHorse(req: HappyHorseSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: string;
  taskType: string;
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/happyhorse/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  const payload = data.data || {};
  return withProviderTransportTrace(payload, r);
}

export interface HappyHorseQueryResult extends ProviderTransportTrace {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | string;
  progress?: string | number;
  videoUrl?: string | null;
  failReason?: string | null;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
  taskProvider?: 'seedance-nz';
  model?: string;
  taskType?: string;
}

export async function queryHappyHorse(taskId: string): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/happyhorse/status/${encodeURIComponent(taskId)}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export type HailuoModel =
  | 'hailuo-2.3-t2v-standard'
  | 'hailuo-2.3-t2v-pro'
  | 'hailuo-2.3-i2v-standard'
  | 'hailuo-2.3-i2v-pro'
  | 'hailuo-2.3-fast-i2v'
  | 'hailuo-2.3-fast-pro-i2v'
  | 'hailuo-h3-t2v'
  | 'hailuo-h3-i2v'
  | 'hailuo-h3-multi'
  | 'hailuo-h3-global-t2v'
  | 'hailuo-h3-global-i2v'
  | 'hailuo-h3-global-multi'
  | 'hailuo-h3-max-t2v'
  | 'hailuo-h3-max-i2v'
  | 'minimax-h3-ow-t2v'
  | 'minimax-h3-ow-r2v'
  | 'minimax-h3-ow-i2v'
  | 'minimax-h3-ow-i2v-fast'
  | 'minimax-h3-ow-r2v-fast'
  | 'minimax-h3-ow-ref2va-audio-drive-fast'
  | 'minimax-h3-ow-fl2va-audio-drive-fast'
  | 'minimax-h3-ow-t2v-fast';

export type Hailuo23Model = Extract<HailuoModel, `hailuo-2.3-${string}`>;
export type HailuoDuration = 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export interface HailuoSubmitRequest {
  model: HailuoModel;
  prompt?: string;
  duration: HailuoDuration;
  ratio: string;
  resolution: '480p' | '480P' | '720p' | '768p' | '768P' | '1080p' | '2K';
  images?: string[];
  videos?: string[];
  audios?: string[];
}

export async function submitHailuo(req: HailuoSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  taskProvider: 'seedance-nz';
  model: string;
  taskType: 't2v' | 'i2v' | 'r2v' | 'multi';
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/hailuo/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, 'Hailuo 提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function queryHailuo(taskId: string, transport: ProviderSubmissionTransport = {}): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/hailuo/status/${encodeURIComponent(taskId)}`, { signal: transport.signal });
  const data = await safeJsonResponse(r, 'Hailuo 查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export type KlingModel =
  | 'kling-v3.0-std-t2v'
  | 'kling-v3.0-pro-t2v'
  | 'kling-v3-turbo-std-t2v'
  | 'kling-v3-turbo-pro-t2v'
  | 'kling-v3-4k-t2v'
  | 'kling-o3-std-t2v'
  | 'kling-o3-pro-t2v'
  | 'kling-o3-4k-t2v'
  | 'kling-v3.0-std-i2v'
  | 'kling-v3.0-pro-i2v'
  | 'kling-v3-turbo-std-i2v'
  | 'kling-v3-turbo-pro-i2v'
  | 'kling-v3-4k-i2v'
  | 'kling-o3-std-i2v'
  | 'kling-o3-pro-i2v'
  | 'kling-o3-4k-i2v'
  | 'kling-o3-std-r2v'
  | 'kling-o3-pro-r2v'
  | 'kling-o3-4k-r2v'
  | 'kling-o3-std-edit'
  | 'kling-o3-pro-edit';

export interface KlingSubmitRequest {
  model: KlingModel;
  prompt?: string;
  duration: 5 | 10;
  ratio?: string;
  negativePrompt?: string;
  images?: string[];
  videos?: string[];
}

export async function submitKling(req: KlingSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: string;
  taskType: 't2v' | 'i2v' | 'r2v' | 'edit';
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/kling/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, 'Kling 提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function queryKling(taskId: string): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/kling/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, 'Kling 查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export type UpscalerResolution = '720p' | '1080p' | '2k' | '4k';

export interface UpscalerSubmitRequest {
  model: 'zhenzhen-upscaler';
  resolution: UpscalerResolution;
  videos: string[];
}

export async function submitUpscaler(req: UpscalerSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: 'zhenzhen-upscaler';
  taskType: 'upscale';
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/upscaler/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, 'Zhenzhen Upscaler 提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function queryUpscaler(taskId: string): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/upscaler/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, 'Zhenzhen Upscaler 查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface FashVsrSubmitRequest {
  model: 'FlashVSR_video_upscale' | 'FashVSR_video_upscale';
  videos: string[];
}

export async function submitFashVsr(req: FashVsrSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: 'FlashVSR_video_upscale';
  taskType: 'upscale';
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/fashvsr/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, 'FlashVSR 视频超分提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function queryFashVsr(taskId: string): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/fashvsr/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, 'FlashVSR 视频超分查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export type ViduQ3Model =
  | 'vidu-q3-pro-t2v'
  | 'vidu-q3-turbo-t2v'
  | 'vidu-q3-pro-fast-t2v'
  | 'vidu-q3-pro-i2v'
  | 'vidu-q3-turbo-i2v'
  | 'vidu-q3-pro-fast-i2v'
  | 'vidu-q3-pro-start-end'
  | 'vidu-q3-turbo-start-end'
  | 'vidu-q3-pro-fast-start-end'
  | 'vidu-q3-r2v'
  | 'vidu-q3-mix-r2v'
  | 'vidu-q3-ad-r2v'
  | 'vidu-q3-drama-r2v'
  | 'vidu-q3-drama-short-play'
  | 'vidu-q3-ad-short-play';

export interface ViduSubmitRequest {
  model: ViduQ3Model;
  prompt?: string;
  duration: number;
  ratio: string;
  resolution: 'default' | '720p' | '1080p';
  seed?: number;
  images?: string[];
  scriptName?: string;
  style?: string;
  assetType?: 'character' | 'scene' | 'prop';
  assetNamePrefix?: string;
  assetDescription?: string;
}

export async function submitVidu(req: ViduSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: string;
  taskType: 't2v' | 'i2v' | 'start-end' | 'r2v' | 'short-play';
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/vidu/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, 'Vidu Q3 提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function queryVidu(taskId: string): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/vidu/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, 'Vidu Q3 查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface WanSubmitRequest {
  model:
    | 'wan-2.7-spicy-i2v'
    | 'wan-3.0-global-i2v'
    | 'wan-3.0-global-r2v'
    | 'wan-3.0-i2v'
    | 'wan-3.0-r2v'
    | 'wan-3.0-prime-i2v'
    | 'wan-3.0-prime-r2v'
    | 'wan-3.0-global-prime-i2v'
    | 'wan-3.0-global-prime-r2v';
  prompt?: string;
  duration: number | 'auto';
  resolution: '720p' | '1080p' | '480P' | '720P' | '1080P';
  ratio?: 'adaptive' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  images: string[];
  videos?: string[];
  audios?: string[];
  generateAudio?: boolean;
  enableThinking?: boolean;
  fileUrl?: string;
  linkUrl?: string;
  negativePrompt?: string;
  audioUrl?: string;
  promptExtend?: boolean;
  seed?: number;
}

export async function submitWan(req: WanSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: string;
  taskType: string;
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/wan/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, 'Wan 视频提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function queryWan(taskId: string): Promise<HappyHorseQueryResult> {
  const r = await fetch(`/api/proxy/video/wan/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, 'Wan 视频查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

// ========================================================================
// Seedance 2.0 (异步) — 完全对齐 gpt-image-2-web runSeedance / pollSeedance
//   submit: POST /api/proxy/seedance/submit
//   query : GET  /api/proxy/seedance/query?taskId=
// ========================================================================
export type SeedanceTaskProvider = 'auto' | 'seedance-nz' | 'zhenzhen-legacy';

export interface SeedanceSubmitRequest {
  /** 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-0-fast-260128' | 'doubao-seedance-2.0-mini' */
  model: string;
  prompt: string;
  /** 时长(秒)：Seedance 2.0 为 4..15；Seedance 2.5 为 4..30 或 -1 自动时长 */
  duration?: number;
  /** 比例 16:9|9:16|1:1|4:3|3:4|21:9|9:21|adaptive */
  ratio?: string;
  /** 分辨率 480p|720p|native1080p|native4K|1080p|2k|4k */
  resolution?: string;
  /** 生成音频（默认 true） */
  generate_audio?: boolean;
  /** 返回末帧 */
  return_last_frame?: boolean;
  /** 水印 */
  watermark?: boolean;
  /** 启用 web_search 工具 */
  web_search?: boolean;
  /** 随机种子 -1=不传 */
  seed?: number;
  /** 首帧参考(base64 dataURL 或 /files/* URL)，后端会上传取 URL */
  firstFrame?: string;
  /** 末帧参考(需与 firstFrame 同时传) */
  lastFrame?: string;
  /** 参考图多张(reference_image) */
  refImages?: string[];
  /** 参考视频 URL 多个 */
  videos?: string[];
  /** 参考音频 URL 多个 */
  audios?: string[];
  /** 内置 Seedance 后端；旧画布未设置时后端继续按 zhenzhen-legacy 处理。 */
  taskProvider?: SeedanceTaskProvider;
  providerParams?: Record<string, any>;
  mode?: 'text' | 'frame' | 'reference_images' | 'reference_video';
  aspect_ratio?: string;
  nsfw_check?: boolean;
}

export interface SeedanceSubmitResult extends ProviderTransportTrace {
  taskId: string;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'>;
  model?: string;
  taskType?: 't2v' | 'i2v' | 'v2v' | 'multi';
}

export async function submitSeedance(
  req: SeedanceSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<SeedanceSubmitResult> {
  const r = await fetch('/api/proxy/seedance/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface SeedanceQueryResult extends ProviderTransportTrace {
  /** 'pending' | 'running' | 'succeeded' | 'failed' (已后端归一) */
  status: string;
  progress?: string;
  videoUrl?: string | null;
  failReason?: string | null;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'>;
  model?: string;
  taskType?: 't2v' | 'i2v' | 'v2v' | 'multi';
}

export type Hunyuan3DModel = 'hunyuan3d-v3.1-text-to-3d' | 'hunyuan3d-v3.1-image-to-3d';
export interface Hunyuan3DSubmitRequest {
  model: Hunyuan3DModel;
  prompt: string;
  face_count: number;
  enable_pbr: boolean;
  generate_type: 'Normal' | 'Geometry' | 'Sketch';
  images?: string[];
}

export interface Hunyuan3DQueryResult extends ProviderTransportTrace {
  status: string;
  progress?: string;
  modelUrl?: string;
  modelUrls?: string[];
  urls?: string[];
  error?: string;
  failReason?: string | null;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function submitHunyuan3D(req: Hunyuan3DSubmitRequest, transport: ProviderSubmissionTransport = {}) {
  const r = await fetch('/api/proxy/3d/seedance-nz/submit', {
    method: 'POST', headers: providerSubmissionHeaders(transport), body: JSON.stringify(req), signal: transport.signal,
  });
  const data = await safeJsonResponse(r, 'Hunyuan 3D 提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r) as { taskId: string; model: Hunyuan3DModel; taskProvider: 'seedance-nz-3d' } & ProviderTransportTrace;
}

export async function queryHunyuan3D(taskId: string, transport: ProviderSubmissionTransport = {}): Promise<Hunyuan3DQueryResult> {
  const r = await fetch(`/api/proxy/3d/seedance-nz/status/${encodeURIComponent(taskId)}`, { signal: transport.signal });
  const data = await safeJsonResponse(r, 'Hunyuan 3D 查询');
  if (!r.ok && !data?.data?.recoverable) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data || { status: 'failed', error: data?.error }, r);
}

export async function querySeedance(
  taskId: string,
  taskProvider?: Exclude<SeedanceTaskProvider, 'auto'>,
  transport: ProviderSubmissionTransport = {},
): Promise<SeedanceQueryResult> {
  const providerQuery = taskProvider ? `&taskProvider=${encodeURIComponent(taskProvider)}` : '';
  const r = await fetch(`/api/proxy/seedance/query?taskId=${encodeURIComponent(taskId)}${providerQuery}`, { signal: transport.signal });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return data.data;
}

export type MinimaxH3ContextIrModel =
  | 'minmax-h3-context-ir-text'
  | 'minmax-h3-context-ir-image'
  | 'minmax-h3-context-ir-multimodal';

export interface MinimaxH3ContextIrSubmitRequest {
  model: MinimaxH3ContextIrModel;
  prompt: string;
  duration: number;
  ratio?: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
}

export interface MinimaxH3ContextIrSubmitResult extends ProviderTransportTrace {
  taskId: string;
  taskProvider: 'seedance-nz';
  model: MinimaxH3ContextIrModel;
  taskType: 'text' | 'image' | 'multimodal';
}

export interface MinimaxH3ContextIrQueryResult extends ProviderTransportTrace {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  progress?: string;
  resultText?: string;
  failReason?: string;
  taskProvider?: 'seedance-nz';
  model?: MinimaxH3ContextIrModel;
  taskType?: 'text' | 'image' | 'multimodal';
}

export async function submitMinimaxH3ContextIr(
  request: MinimaxH3ContextIrSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<MinimaxH3ContextIrSubmitResult> {
  const response = await fetch('/api/proxy/minimax-h3-context-ir/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(request),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(response, 'MiniMax H3 官方提示词增强提交');
  if (!response.ok || !data.success) throw providerResponseError(response, data);
  return withProviderTransportTrace(data.data, response);
}

export async function queryMinimaxH3ContextIr(
  taskId: string,
  transport: ProviderSubmissionTransport = {},
): Promise<MinimaxH3ContextIrQueryResult> {
  const response = await fetch(
    `/api/proxy/minimax-h3-context-ir/status/${encodeURIComponent(taskId)}`,
    { signal: transport.signal },
  );
  const data = await safeJsonResponse(response, 'MiniMax H3 官方提示词增强查询');
  if (!response.ok || !data.success) throw providerResponseError(response, data);
  return withProviderTransportTrace(data.data, response);
}

// ========================================================================
// 音频 Suno(异步)
// 完全对齐主项目 gpt-image-2-web 的 runSuno / runSunoCover / runSunoExtend
// ========================================================================
export type AudioMode = 'generate' | 'cover' | 'extend';
export type AudioProviderMode = 'suno' | 'seed-audio' | 'whisper' | 'qwen3-tts' | 'minimax' | 'mureka' | 'lyria';
export type SunoPlatform = 'zhenzhen' | 'seedance-nz';
export type WhisperResponseFormat = 'json' | 'verbose_json' | 'srt' | 'text' | 'vtt';

export interface WhisperTranscribeRequest {
  audioUrl: string;
  model?: 'whisper-1';
  responseFormat?: WhisperResponseFormat;
}

export interface WhisperTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export type WhisperTranscriptAttribution = 'provider-segments' | 'untimed';

export interface WhisperTranscribeResult extends ProviderTransportTrace {
  text: string;
  model: 'whisper-1';
  responseFormat: WhisperResponseFormat;
  segments?: WhisperTranscriptSegment[];
}

export interface WhisperTranscriptEvidence {
  text: string;
  segments: WhisperTranscriptSegment[];
  attribution: WhisperTranscriptAttribution;
}

export function formatWhisperTimecode(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
    + `.${String(milliseconds).padStart(3, '0')}`;
}

export function buildWhisperTranscriptEvidence(result: WhisperTranscribeResult): WhisperTranscriptEvidence {
  const segments: WhisperTranscriptSegment[] = [];
  let totalTextLength = 0;
  for (const segment of (Array.isArray(result.segments) ? result.segments : []).slice(0, 2000)) {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    const rawText = String(segment?.text || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || !rawText) continue;
    const remaining = 1_000_000 - totalTextLength;
    if (remaining <= 0) break;
    const text = rawText.slice(0, Math.min(4000, remaining));
    segments.push({ start, end, text });
    totalTextLength += text.length;
  }
  if (!segments.length) {
    return {
      text: String(result.text || '').trim(),
      segments: [],
      attribution: 'untimed',
    };
  }
  return {
    text: [
      '以下为 Whisper 返回的语音分段时间窗（非逐词时间戳）：',
      ...segments.map((segment) => (
        `[${formatWhisperTimecode(segment.start)} - ${formatWhisperTimecode(segment.end)}] ${segment.text}`
      )),
    ].join('\n'),
    segments,
    attribution: 'provider-segments',
  };
}

export function buildWhisperTranscribeRequestBody(req: WhisperTranscribeRequest): {
  audioUrl: string;
  model: 'whisper-1';
  response_format: WhisperResponseFormat;
} {
  return {
    audioUrl: req.audioUrl,
    model: req.model || 'whisper-1',
    response_format: req.responseFormat || 'json',
  };
}

export type Flux3VideoModel =
  | 'flux-3-video-t2v'
  | 'flux-3-video-i2v'
  | 'flux-3-video-v2v'
  | 'flux-3-video-draft-enhance'
  | 'flux-3-video-global-t2v'
  | 'flux-3-video-global-i2v'
  | 'flux-3-video-global-v2v'
  | 'flux-3-video-global-draft-enhance';

export interface Flux3SubmitRequest {
  model: Flux3VideoModel;
  prompt?: string;
  duration: number;
  ratio: 'auto' | '21:9' | '2:1' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  resolution: 'hd' | 'fhd';
  images?: string[];
  videos?: string[];
  draft?: boolean;
  draftCache?: string;
  audioMode?: 'api_default' | 'enabled' | 'disabled';
  safetyTolerance?: 'api_default' | 0 | 1 | 2 | 3 | 4;
}

export async function submitFlux3(req: Flux3SubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  taskProvider: 'seedance-nz';
  model: string;
  taskType: 't2v' | 'i2v' | 'v2v' | 'draft-enhance';
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/video/flux3/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, 'FLUX 3 Video 提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface Flux3QueryResult extends HappyHorseQueryResult {
  draftCache?: string | null;
  taskType?: 't2v' | 'i2v' | 'v2v' | 'draft-enhance';
}

export async function queryFlux3(taskId: string, transport: ProviderSubmissionTransport = {}): Promise<Flux3QueryResult> {
  const r = await fetch(`/api/proxy/video/flux3/status/${encodeURIComponent(taskId)}`, { signal: transport.signal });
  const data = await safeJsonResponse(r, 'FLUX 3 Video 查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function transcribeWhisper(
  req: WhisperTranscribeRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<WhisperTranscribeResult> {
  const r = await fetch('/api/proxy/audio/whisper/transcribe', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(buildWhisperTranscribeRequestBody(req)),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Whisper 转写');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r) as WhisperTranscribeResult;
}

export interface AudioSubmitRequest {
  mode: AudioMode;
  prompt?: string;
  title?: string;
  tags?: string;
  /**
   * Suno 版本号：推荐传主项目原始值 (v3.0 / v3.5 / v4 / v4.5 / v4.5+ / v5 / v5.5)。
   * 后端 resolveSunoMv() 同时兼容带 'suno-' 前缀的旧调用方 (如 'suno-v5.5')。
   */
  version?: string;
  seed?: number;
  continue_clip_id?: string;
  continue_at?: number;
  cover_clip_id?: string;
  providerParams?: Record<string, any>;
}

export async function submitAudio(
  req: AudioSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<{ taskId: string; clipIds: string[] } & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/audio/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface AudioTrack {
  id: string;
  clipId?: string;
  audioUrl: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  duration?: number;
}
export interface AudioQueryResult extends ProviderTransportTrace {
  status: 'PENDING' | 'SUCCESS' | string;
  tracks: AudioTrack[];
  total: number;
  completed: number;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

/**
 * 轮询 Suno feed。
 * @param clipIds 任务中的 clip id 列表
 * @param saveLocal 旧版兼容参数；后端始终先将完成品安全转存到本地
 */
export async function queryAudio(clipIds: string[], saveLocal: boolean = true): Promise<AudioQueryResult> {
  const ids = clipIds.join(',');
  const params = new URLSearchParams({ clipIds: ids, saveLocal: String(saveLocal) });
  const r = await fetch(`/api/proxy/audio/query?${params.toString()}`);
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface SunoNzSubmitRequest {
  operation: SunoNzOperation;
  prompt?: string;
  version?: string;
  custom?: boolean;
  instrumental?: boolean;
  title?: string;
  style?: string;
  vocal_gender?: string;
  tags?: string;
  audioFilePath?: string;
  audio_url?: string;
  audio_urls?: string[];
  audioUrls?: string[];
  task_id?: string;
  task_id_2?: string;
  task_ids?: string[];
  audio_index?: number;
  continue_at?: number;
  start_s?: number;
  end_s?: number;
  duration_s?: number;
  speed?: number;
  name?: string;
}

export interface SunoNzArtifact {
  kind: 'audio' | 'video' | 'image' | 'file';
  url: string;
}

export interface SunoNzTaskResult extends ProviderTransportTrace {
  taskId?: string;
  operation?: SunoNzOperation;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'materializing' | string;
  progress?: string | number;
  resultFamily: SunoNzResultFamily;
  text?: string;
  tracks: AudioTrack[];
  audioUrls: string[];
  videoUrls: string[];
  imageUrls: string[];
  fileUrls: string[];
  artifacts: SunoNzArtifact[];
  partialFailures?: Array<{ code?: string; message?: string; recoverable?: boolean }>;
  failReason?: string;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function submitSunoNz(
  req: SunoNzSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<SunoNzTaskResult> {
  const r = await fetch('/api/proxy/audio/suno-nz/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Suno');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r) as SunoNzTaskResult;
}

export async function querySunoNz(taskId: string): Promise<SunoNzTaskResult> {
  const r = await fetch(`/api/proxy/audio/suno-nz/status/${encodeURIComponent(taskId)}`);
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Suno');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r) as SunoNzTaskResult;
}

export type FlowMusicOperation =
  | 'flowmusic-generation'
  | 'flowmusic-lyrics'
  | 'flowmusic-upload-audio'
  | 'flowmusic-extend'
  | 'flowmusic-replace'
  | 'flowmusic-cover'
  | 'flowmusic-stems'
  | 'flowmusic-download-audio'
  | 'flowmusic-video-clip';

export interface FlowMusicSubmitRequest {
  operation: FlowMusicOperation;
  version?: 'default' | 'lyria-3.5';
  sound_prompt?: string;
  lyrics?: string;
  prompt?: string;
  title?: string;
  bpm?: number;
  length?: number;
  seed?: number;
  audioUrl?: string;
  clip_id?: string;
  extend_from_s?: number;
  extend_s?: number;
  instruction?: string;
  start_s?: number;
  end_s?: number;
  strength?: number;
  format?: 'mp3' | 'wav';
  preset?: 'simple' | 'modern' | 'player';
}

export type FlowMusicTaskResult = Omit<SunoNzTaskResult, 'operation'> & {
  model?: 'flowmusic';
  operation?: FlowMusicOperation;
  clipId?: string;
  clipIds?: string[];
};

export async function submitFlowMusic(
  req: FlowMusicSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<FlowMusicTaskResult> {
  const r = await fetch('/api/proxy/audio/flowmusic/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Flow Music');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r) as FlowMusicTaskResult;
}

export async function queryFlowMusic(
  taskId: string,
  transport: ProviderSubmissionTransport = {},
): Promise<FlowMusicTaskResult> {
  const r = await fetch(`/api/proxy/audio/flowmusic/status/${encodeURIComponent(taskId)}`, {
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋 Flow Music');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r) as FlowMusicTaskResult;
}

export interface SeedAudioSubmitRequest {
  model: 'doubao-seed-audio-1.0';
  prompt: string;
  speaker?: string;
  outputFormat: 'wav' | 'mp3' | 'pcm' | 'ogg_opus';
  sampleRate: '8000' | '16000' | '24000' | '32000' | '44100';
  speechRate: number;
  loudnessRate: number;
  pitchRate: number;
  images?: string[];
  audioUrls?: string[];
}

export type SeedanceNzAudioModel =
  | 'doubao-seed-audio-1.0'
  | 'qwen3-tts-flash'
  | 'qwen3-tts-instruct-flash'
  | 'minimax-music-2.6'
  | 'minimax-speech-2.8-hd'
  | 'minimax-speech-2.8-turbo'
  | 'minimax-voice-clone'
  | 'mureka-v8-bgm'
  | 'mureka-v9-bgm';

export interface SeedanceNzAudioSubmitRequest {
  model: SeedanceNzAudioModel;
  prompt?: string;
  speaker?: string;
  outputFormat?: 'wav' | 'mp3' | 'pcm' | 'ogg_opus' | 'flac';
  sampleRate?: '8000' | '16000' | '24000' | '32000' | '44100';
  speechRate?: number;
  loudnessRate?: number;
  pitchRate?: number;
  images?: string[];
  audioUrls?: string[];
  voice?: string;
  languageType?: string;
  instructions?: string;
  optimizeInstructions?: boolean;
  lyrics?: string;
  isInstrumental?: boolean;
  lyricsOptimizer?: boolean;
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  languageBoost?: string;
  bitrate?: '32000' | '64000' | '128000' | '256000';
  channel?: 1 | 2;
  customVoiceId?: string;
  cloneTargetModel?: 'minimax-speech-2.8-hd' | 'minimax-speech-2.8-turbo';
  needNoiseReduction?: boolean;
  needVolumeNormalization?: boolean;
  instrumentalId?: string;
  n?: number;
}

export interface SeedanceNzAudioTrack {
  id?: string;
  clipId?: string;
  audioUrl: string;
  title?: string;
}

export interface SeedanceNzAudioQueryResult extends ProviderTransportTrace {
  status: 'pending' | 'running' | 'materializing' | 'succeeded' | 'failed' | string;
  progress?: string | number;
  audioUrl?: string | null;
  audioUrls?: string[];
  tracks?: SeedanceNzAudioTrack[];
  resultText?: string;
  model?: string;
  failReason?: string | null;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function submitSeedanceNzAudio(
  req: SeedanceNzAudioSubmitRequest,
  transport: ProviderSubmissionTransport = {},
): Promise<{ taskId: string; model: string } & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/audio/seed-audio/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
    signal: transport.signal,
  });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋音频任务提交');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function querySeedanceNzAudio(
  taskId: string,
  transport: ProviderSubmissionTransport = {},
): Promise<SeedanceNzAudioQueryResult> {
  const r = await fetch(`/api/proxy/audio/seed-audio/status/${encodeURIComponent(taskId)}`, { signal: transport.signal });
  const data = await safeJsonResponse(r, '贞贞的平价AI小屋音频任务查询');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function submitSeedAudio(req: SeedAudioSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  model: string;
} & ProviderTransportTrace> {
  return submitSeedanceNzAudio(req, transport);
}

export interface SeedAudioQueryResult extends ProviderTransportTrace {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | string;
  progress?: string | number;
  audioUrl?: string | null;
  remoteAudioUrl?: string | null;
  failReason?: string | null;
  error?: string;
  code?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function querySeedAudio(taskId: string): Promise<SeedAudioQueryResult> {
  return querySeedanceNzAudio(taskId);
}

/**
 * 将本地音频上传给 Suno 并获取 clipId（用于 cover/extend 模式）。
 * 后端代理 _sunoUploadAudio 的 5 步流程。
 */
export async function uploadAudioForSuno(
  file: File,
  providerParams?: Record<string, any>,
): Promise<{ clipId: string; uploadId: string; filename: string; size: number; mime: string }> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (providerParams && Object.keys(providerParams).length > 0) {
    fd.append('providerParams', JSON.stringify(providerParams));
  }
  const r = await fetch('/api/proxy/audio/upload', { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return data.data;
}

// ========================================================================
// RunningHub 工作流(异步)
// RH 钱包应用节点与普通 RunningHub 节点共用站点配置；国内/海外按 site 分流。
// ========================================================================
export type RhSite = 'cn' | 'intl';

export interface RhSubmitRequest {
  webappId: string;
  nodeInfoList?: Array<{ nodeId: string; fieldName: string; fieldValue: any }>;
  instanceType?: string;
  site?: RhSite;
}

export async function submitRh(req: RhSubmitRequest, transport: ProviderSubmissionTransport = {}): Promise<{
  taskId: string;
  site: RhSite;
  fallbackUsed?: boolean;
} & ProviderTransportTrace> {
  const r = await fetch('/api/proxy/runninghub/submit', {
    method: 'POST',
    headers: providerSubmissionHeaders(transport),
    body: JSON.stringify(req),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export interface RhQueryResult extends ProviderTransportTrace {
  status: 'PENDING' | 'SUCCESS' | 'RUNNING' | 'QUEUED' | 'FAILED' | string;
  urls: string[];
  texts?: string[];
  textUrls?: string[];
  failReason?: string | null;
  code?: number;
  site?: RhSite;
  fallbackUsed?: boolean;
  error?: string;
  recoverable?: boolean;
  retryAfterMs?: number;
}

export async function queryRh(taskId: string, site: RhSite = 'cn'): Promise<RhQueryResult> {
  const url = `/api/proxy/runninghub/query?taskId=${encodeURIComponent(taskId)}&site=${encodeURIComponent(site)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return withProviderTransportTrace(data.data, r);
}

export async function cancelRh(taskId: string, site: RhSite = 'cn'): Promise<{ taskId: string; site?: RhSite; raw?: any }> {
  const r = await fetch('/api/proxy/runninghub/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, site }),
  });
  const data = await safeJsonResponse(r, 'RunningHub 取消任务');
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return data.data;
}

export async function fetchRhAppInfo(webappId: string, site: RhSite = 'cn'): Promise<any> {
  const url = `/api/proxy/runninghub/app-info?webappId=${encodeURIComponent(webappId)}&site=${encodeURIComponent(site)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return data.data;
}

/**
 * 上传任意本地/远程素材到 RunningHub，拿到内部 fileName。
 * 用于 RhConfigNode / RunningHubNode 中 valueType=image|video|audio 的条目提交前的资源转换。
 */
export async function uploadRhAsset(url: string, site: RhSite = 'cn'): Promise<{ fileName: string; fileType: string; site?: RhSite }> {
  const r = await fetch('/api/proxy/runninghub/upload-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, site }),
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw providerResponseError(r, data);
  return data.data;
}

// ============================================================================
// (原崩溃前遗留的 MJ 代码块已移除; MJ 实现参见上方 buildMjPrompt / submitMjImagine / queryMjTask / uploadMjImage 及 fileToDataUrl)
// ============================================================================

