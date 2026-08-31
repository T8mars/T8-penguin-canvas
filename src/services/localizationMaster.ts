import type { LocalizationRuntimeReceipt, LocalizationTimingMode } from '../utils/localizationMaster';

async function localizationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/localization-master/${path}`, options);
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : null; } catch { throw new Error(`本地化接口返回异常：${text.slice(0, 200)}`); }
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.error || `HTTP ${response.status}`) as Error & { code?: string; status?: number };
    error.code = String(payload?.code || 'LOCALIZATION_REQUEST_FAILED');
    error.status = response.status;
    throw error;
  }
  return payload.data as T;
}

export function inspectLocalizationRuntime(signal?: AbortSignal): Promise<LocalizationRuntimeReceipt> {
  return localizationRequest<LocalizationRuntimeReceipt>('runtime', { signal });
}

export function acceptLocalizationModelLicense(signal?: AbortSignal): Promise<{
  accepted: true;
  acceptedAt: number;
  modelRepository: string;
  modelRevision: string;
}> {
  return localizationRequest('runtime/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accepted: true }),
    signal,
  });
}

export function installLocalizationRuntime(input: {
  /** @deprecated The backend trusts only its device-local license receipt. */
  modelLicenseConfirmed?: true;
  source?: 'huggingface' | 'modelscope';
}, signal?: AbortSignal): Promise<LocalizationRuntimeReceipt['install'] & { duplicate?: boolean }> {
  return localizationRequest('runtime/install', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  });
}

export function cancelLocalizationRuntime(signal?: AbortSignal): Promise<{ cancelled: boolean }> {
  return localizationRequest('runtime/cancel', { method: 'POST', signal });
}

export interface LocalizationTtsRequest {
  language: string;
  units: Array<{ index: number; role: string; translatedText: string; pronunciation?: string; emotion?: string; startMs: number; endMs: number }>;
  roles: Array<{ role: string; referenceUrl: string; consentConfirmed: true }>;
  timelinePolicy: 'shift' | 'overlay';
  timingMode: LocalizationTimingMode;
  asrEnabled: boolean;
  asrRetryCount: number;
  asrThreshold: number;
  subtitleTimingMode: 'actual' | 'original';
  subtitleTextMode: 'asr_passed' | 'asr_all' | 'original';
  subtitleIncludeRole: boolean;
  postprocessPreset: string;
  postprocessStrength: number;
  /** @deprecated The backend trusts only its device-local license receipt. */
  modelLicenseConfirmed?: true;
  seed?: number;
  /** Stable Canvas Attempt identity. The backend hashes it and never persists the raw value. */
  jobKey?: string;
  retryFailed?: boolean;
}

export interface LocalizationTtsResult {
  schema: 't8-localization-tts-result-v2';
  engine: 'embedded-index-tts-2.5';
  requiresComfyUI: false;
  requestId?: string;
  jobId: string;
  reused: boolean;
  audioUrl: string;
  subtitleUrl: string;
  subtitleText: string;
  byteLength: number;
  sha256: string;
  generationReport: Record<string, unknown>;
  recovery: { schema: 't8-localization-tts-recovery-v1'; status: string; recoveredAt?: number };
}

export function inspectLocalizationTtsJob(jobId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return localizationRequest(`tts/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export function runLocalizationTts(input: LocalizationTtsRequest, signal?: AbortSignal): Promise<LocalizationTtsResult> {
  return localizationRequest<LocalizationTtsResult>('tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

export function retryLocalizationTtsLine(input: Omit<LocalizationTtsRequest, 'units'> & {
  baseAudioUrl: string;
  unit: LocalizationTtsRequest['units'][number];
}, signal?: AbortSignal): Promise<{
  schema: 't8-localization-tts-line-retry-result-v1';
  index: number;
  audioUrl: string;
  byteLength: number;
  sha256: string;
  lineResult: LocalizationTtsResult;
}> {
  return localizationRequest('tts/retry-line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

export function muxLocalizationVideo(input: { videoUrl: string; audioUrl: string }, signal?: AbortSignal): Promise<{
  schema: 't8-localization-video-mux-result-v1';
  videoUrl: string;
  byteLength: number;
  sha256: string;
  audioPolicy: 'replace';
}> {
  return localizationRequest('mux', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

export function saveLocalizationSubtitle(input: { text: string; format?: 'srt' | 'vtt' }, signal?: AbortSignal): Promise<{
  schema: 't8-localization-subtitle-result-v1';
  subtitleUrl: string;
  byteLength: number;
  sha256: string;
  format: 'srt' | 'vtt';
}> {
  return localizationRequest('subtitle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}
