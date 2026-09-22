import { minimumProviderMediaPollCount } from './providerTimeoutPolicy';

export type RunRecoveryKind =
  | 'runninghub'
  | 'seedance'
  | 'seedream-nz'
  | 'wan'
  | 'happyhorse'
  | 'hailuo'
  | 'flux3'
  | 'kling'
  | 'upscaler'
  | 'fashvsr'
  | 'vosr2'
  | 'animate'
  | 'vidu'
  | 'seed-audio'
  | 'suno'
  | 'image'
  | 'mj'
  | 'video'
  | 'image-fal'
  | 'video-fal';

export interface RunRecoveryDescriptor {
  version: 1;
  kind: RunRecoveryKind;
  taskId?: string;
  taskIds?: string[];
  requestId?: string;
  endpoint?: string;
  model?: string;
  site?: 'cn' | 'intl';
  taskProvider?: 'seedance-nz' | 'zhenzhen-legacy';
  speed?: 'relax' | 'fast' | 'turbo';
  pollIntervalMs?: number;
  maxPolls?: number;
}
const RECOVERY_KINDS = new Set<RunRecoveryKind>([
  'runninghub', 'seedance', 'seedream-nz', 'wan', 'happyhorse', 'hailuo', 'flux3', 'kling', 'upscaler', 'fashvsr', 'vosr2', 'animate', 'vidu', 'seed-audio', 'suno',
  'image', 'mj', 'video', 'image-fal', 'video-fal',
]);

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeExplicitRecovery(value: unknown): RunRecoveryDescriptor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = text(raw.kind, 80).toLowerCase() as RunRecoveryKind;
  if (!RECOVERY_KINDS.has(kind)) return null;
  const taskIds = Array.isArray(raw.taskIds)
    ? [...new Set(raw.taskIds.map((item) => text(item, 512)).filter(Boolean))].slice(0, 20)
    : [];
  const pollIntervalMs = Math.max(250, Math.min(30000, Math.trunc(Number(raw.pollIntervalMs) || 3000)));
  const descriptor: RunRecoveryDescriptor = {
    version: 1,
    kind,
    taskId: text(raw.taskId, 512) || undefined,
    taskIds: taskIds.length ? taskIds : undefined,
    requestId: text(raw.requestId, 512) || undefined,
    endpoint: text(raw.endpoint, 1024) || undefined,
    model: text(raw.model, 240) || undefined,
    site: ['cn', 'intl'].includes(text(raw.site, 20).toLowerCase()) ? text(raw.site, 20).toLowerCase() as 'cn' | 'intl' : undefined,
    taskProvider: ['seedance-nz', 'zhenzhen-legacy'].includes(text(raw.taskProvider, 80)) ? text(raw.taskProvider, 80) as 'seedance-nz' | 'zhenzhen-legacy' : undefined,
    speed: ['relax', 'fast', 'turbo'].includes(text(raw.speed, 20).toLowerCase()) ? text(raw.speed, 20).toLowerCase() as 'relax' | 'fast' | 'turbo' : undefined,
    pollIntervalMs,
    maxPolls: Math.min(7200, minimumProviderMediaPollCount(pollIntervalMs, Number(raw.maxPolls) || 1200)),
  };
  if (kind === 'suno') return descriptor.taskIds?.length ? descriptor : null;
  if (kind === 'image-fal' || kind === 'video-fal') {
    return descriptor.requestId && descriptor.endpoint ? descriptor : null;
  }
  return descriptor.taskId ? descriptor : null;
}

/**
 * Stores only an allowlisted, credential-free polling recipe. The backend maps
 * `kind` to a fixed loopback route after restart; arbitrary URLs are never
 * executed as recovery endpoints.
 */
export function inferRunRecoveryDescriptor(payload: Record<string, unknown>): RunRecoveryDescriptor | null {
  const explicit = normalizeExplicitRecovery(payload.recovery);
  if (explicit) return explicit;
  const provider = text(payload.provider, 120).toLowerCase();
  const model = text(payload.model, 240);
  const taskId = text(payload.taskId ?? payload.upstreamTaskId, 512);
  const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.map((item) => text(item, 512)).filter(Boolean) : [];
  const pollIntervalMs = Math.max(250, Math.min(30000, Math.trunc(Number(payload.pollIntervalMs) || 3000)));
  const maxPolls = Math.min(7200, minimumProviderMediaPollCount(pollIntervalMs, Number(payload.pollLimit) || 1200));
  if (provider === 'suno' && taskIds.length) return { version: 1, kind: 'suno', taskIds, model, pollIntervalMs, maxPolls };
  if (!taskId) return null;
  if (provider === 'runninghub') {
    const site = text(payload.site, 20).toLowerCase() === 'intl' ? 'intl' : 'cn';
    return { version: 1, kind: 'runninghub', taskId, model, site, pollIntervalMs, maxPolls };
  }
  if (provider === 'seedance-nz') {
    const lowerModel = model.toLowerCase();
    if (lowerModel.includes('seed-audio')) return { version: 1, kind: 'seed-audio', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.includes('seedream') || lowerModel === 'vosr2-image-upscale') {
      return { version: 1, kind: 'seedream-nz', taskId, model, pollIntervalMs, maxPolls };
    }
    if (lowerModel.startsWith('wan-')) return { version: 1, kind: 'wan', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.startsWith('happyhorse-')) return { version: 1, kind: 'happyhorse', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.startsWith('hailuo-')) return { version: 1, kind: 'hailuo', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.startsWith('flux-3-video-')) return { version: 1, kind: 'flux3', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.startsWith('kling-')) return { version: 1, kind: 'kling', taskId, model, pollIntervalMs, maxPolls };
    if (model === 'FlashVSR_video_upscale' || model === 'FashVSR_video_upscale') {
      return { version: 1, kind: 'fashvsr', taskId, model, pollIntervalMs, maxPolls };
    }
    if (lowerModel === 'vosr2-video-upscale') {
      return { version: 1, kind: 'vosr2', taskId, model, pollIntervalMs, maxPolls };
    }
    if (lowerModel === 'animate-motion-transfer') {
      return { version: 1, kind: 'animate', taskId, model, pollIntervalMs, maxPolls };
    }
    if (lowerModel === 'zhenzhen-upscaler') return { version: 1, kind: 'upscaler', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.startsWith('vidu-')) return { version: 1, kind: 'vidu', taskId, model, pollIntervalMs, maxPolls };
    if (lowerModel.includes('seedance')) return { version: 1, kind: 'seedance', taskId, model, taskProvider: 'seedance-nz', pollIntervalMs, maxPolls };
  }
  if (provider === 'zhenzhen-legacy' && model.toLowerCase().includes('seedance')) {
    return { version: 1, kind: 'seedance', taskId, model, taskProvider: 'zhenzhen-legacy', pollIntervalMs, maxPolls };
  }
  return null;
}
