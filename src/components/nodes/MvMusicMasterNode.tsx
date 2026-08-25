import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { localizeLegacyRuntimeText } from '../../i18n/legacyRuntimeText';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Clock3,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  Maximize2,
  Music2,
  Pause,
  Play,
  Scissors,
  Sparkles,
  RefreshCw,
  X,
} from 'lucide-react';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { LLM_MODELS } from '../../providers/models';
import {
  buildGenerateExternalLlmRequestBody,
  buildGenerateLlmRequestBody,
  buildWhisperTranscribeRequestBody,
  generateExternalLlm,
  generateLlm,
  queryImageStatus,
  querySeedreamNz,
  queryHailuo,
  querySeedance,
  queryImageFal,
  submitImageAsync,
  submitImageFal,
  submitSeedreamNz,
  submitHailuo,
  submitSeedance,
  transcribeWhisper,
  buildWhisperTranscriptEvidence,
  type HailuoDuration,
  type HailuoModel,
  type LlmMessage,
} from '../../services/generation';
import {
  cancelVideoEditJob,
  composeVideoEditAsync,
  getVideoEditJob,
  materializeMvAudioSlice,
  probeVideo,
  type MvAudioSliceReceipt,
  type VideoComposeResult,
} from '../../services/videoOps';
import { buildVideoEditTimelineRenderPlan, type VideoEditTimelineV2 } from '../../utils/videoTimeline';
import type { VideoEditClip, VideoEditSettings } from '../../utils/videoEdit';
import { useApiKeysStore } from '../../stores/apiKeys';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { getProjectAsset } from '../../services/api';
import { createMvChildAttempt, type MvChildAttempt } from '../../utils/mvRunAttempts';
import { sha256Hex as sha256BytesHex } from '../../utils/incrementalSha256';
import type { AssetRef, RunNodeLifecycleReporter } from '../../types/project';
import {
  MV_DEFAULT_LLM_MODEL,
  MV_SEGMENT_MAX_MS,
  MV_SEGMENT_MIN_MS,
  alignMvLyricsToTranscriptSegments,
  analyzeMvAudioSamples,
  buildMvPromptBatches,
  buildMvPromptSegmentInputs,
  buildMvSegmentBatchMessages,
  buildMvVisualBibleMessages,
  compileMvH3ImagePrompt,
  compileMvH3Prompt,
  compileMvSeedancePrompt,
  critiqueMvPromptPacks,
  assertMvPositiveVisualTextSafe,
  mvProviderReceiptMismatches,
  mvSubmissionRequiresManualResolution,
  mvVideoSubmissionCanResume,
  mvSampleToTimeUs,
  parseMvLyrics,
  parseMvStructuredJson,
  solveMvSegmentation,
  validateMvPromptBatch,
  validateMvLyricTimingEvidence,
  validateMvSegmentationPlan,
  validateMvVisualBible,
  type MvCreativeBrief,
  type MvBpmEvidence,
  type MvLyricUnit,
  type MvPromptSegmentInput,
  type MvSegmentationPlan,
  type MvSegmentPromptPack,
  type MvVisualBible,
} from '../../utils/mvMusicMaster';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';

type MvStage =
  | 'materials'
  | 'segment-review'
  | 'brief-review'
  | 'prompt-review'
  | 'image-review'
  | 'video-review'
  | 'composing'
  | 'delivered';

interface MvAudioReceipt {
  schema: 't8-mv-audio-source-receipt-v1';
  sourceUrl: string;
  sourceLabel: string;
  assetId?: string;
  sha256: string;
  byteLength: number;
  sampleRate: number;
  channelCount: number;
  totalSamples: number;
  durationUs: number;
  waveformPeaks: number[];
  bpmEvidence?: MvBpmEvidence;
  beatTimesUs: number[];
  analysisDownmix: 'average-all-channels';
  analyzedAt: number;
}

interface MvManagedInputMaterial {
  id: string;
  sourceNodeId: string;
  label: string;
  url: string;
  assetId: string;
  contentHash: string;
  byteLength: number;
  sourceUrlDigest: string;
  kind: 'image' | 'video';
  role: 'identity' | 'style' | 'motion';
}

interface MvProjectState {
  schema: 't8-mv-music-master-project-v1';
  revision: number;
  stage: MvStage;
  audio?: MvAudioReceipt;
  lyricFormat?: 'plain' | 'lrc' | 'srt';
  lyricUnits: MvLyricUnit[];
  lyricWarnings: string[];
  segmentPlan?: MvSegmentationPlan;
  segmentConfirmation?: {
    schema: 't8-mv-segmentation-confirmation-v1';
    projectRevision: number;
    planDigest: string;
    confirmedAt: number;
  };
  bibleCandidates?: MvBibleCandidate[];
  acceptedBibleId?: string;
  promptCandidates?: Record<string, MvPromptCandidate[]>;
  acceptedPromptIds?: Record<string, string>;
  imageCandidates?: Record<string, MvImageCandidate[]>;
  acceptedImageIds?: Record<string, string>;
  audioSlices?: Record<string, MvPersistedAudioSlice>;
  videoCandidates?: Record<string, MvVideoCandidate[]>;
  acceptedVideoIds?: Record<string, string>;
  finalComposition?: MvFinalComposition;
  reviewReceipts?: Record<string, MvCandidateReviewReceipt>;
  adoptionReceipts?: Record<string, MvAdoptionReceipt>;
  approvals?: MvProjectApprovals;
  asrSubmission?: {
    schema: 't8-mv-asr-submission-v1';
    requestDigest: string;
    submissionKey: string;
    revision: number;
    status: 'submitting' | 'ambiguous' | 'succeeded' | 'failed';
    updatedAt: number;
    error?: string;
  };
  llmSubmissionGuards?: Partial<Record<'visual-bible' | 'prompt-packs', {
    schema: 't8-mv-llm-submission-guard-v1';
    operation: 'visual-bible' | 'prompt-packs';
    requestSetDigest: string;
    requestDigests: string[];
    revision: number;
    status: 'submitting' | 'ambiguous' | 'succeeded' | 'failed';
    completedVisualBibleBatches?: Array<{
      requestDigest: string;
      segmentIds: string[];
      assetId: string;
      contentHash: string;
      bible: MvVisualBible;
    }>;
    updatedAt: number;
    error?: string;
  }>>;
  inputFingerprint?: {
    audio: string;
    lyrics: string;
    identity: string;
    style: string;
    motion: string;
  };
  inputContentFingerprint?: {
    audio: string;
    identity: string;
    style: string;
    motion: string;
  };
  managedInputs?: {
    identity: MvManagedInputMaterial[];
    style: MvManagedInputMaterial[];
    motion: MvManagedInputMaterial[];
  };
}

interface MvCandidateReviewReceipt {
  schema: 't8-mv-candidate-review-v2';
  projectRevision: number;
  scope: string;
  candidateId: string;
  contentHash: string;
  assetId: string;
  evidenceDigest: string;
  medium: 'text' | 'image' | 'video';
  playbackEvidence?: MvPlaybackEvidence;
  viewedAt: number;
}

interface MvPlaybackEvidence {
  schema: 't8-mv-playback-evidence-v1';
  durationSeconds: number;
  coveredSeconds: number;
  wallClockSeconds: number;
  playedRanges: Array<[number, number]>;
  maxPlaybackRateDeviation: number;
  seekCount: number;
  visibilityViolations: number;
  completedAt: number;
}

interface MvPlaybackAuditState {
  invalid: boolean;
  startedAtZero: boolean;
  activeSince: number | null;
  wallClockMs: number;
  maxPlaybackRateDeviation: number;
  seekCount: number;
  visibilityViolations: number;
}

interface MvAdoptionReceipt {
  schema: 't8-mv-adoption-receipt-v2';
  projectRevision: number;
  scope: string;
  candidateId: string;
  contentHash: string;
  assetId: string;
  evidenceDigest: string;
  reviewReceiptDigest?: string;
  adoptedAt: number;
}

interface MvProjectApprovals {
  schema: 't8-mv-project-approvals-v1';
  musicRights: boolean;
  portraitConsent: boolean;
  styleReferenceRights: boolean;
  paidGeneration: boolean;
  maxTasksPerBatch: number;
  scopeDigest?: string;
  lastPaidReceipt?: MvPaidApprovalReceipt;
  updatedAt: number;
}

interface MvPaidApprovalTaskReceipt {
  id: string;
  provider: string;
  model: string;
  requestDigest: string;
  materialDigest: string;
}

interface MvPaidApprovalReceipt extends Record<string, unknown> {
  schema: 't8-mv-paid-approval-receipt-v1';
  operation: string;
  taskCount: number;
  taskSetDigest: string;
  scopeDigest: string;
  tasks: MvPaidApprovalTaskReceipt[];
  approvedAt: number;
}

interface MvPersistedAudioSlice extends MvAudioSliceReceipt {
  assetId: string;
}

interface MvBibleCandidate {
  schema: 't8-mv-bible-candidate-v1';
  id: string;
  revision: number;
  provider: string;
  model: string;
  createdAt: number;
  assetId?: string;
  contentHash?: string;
  bible: MvVisualBible;
}

interface MvPromptCandidate {
  schema: 't8-mv-prompt-candidate-v1';
  id: string;
  revision: number;
  provider: string;
  model: string;
  createdAt: number;
  assetId?: string;
  contentHash?: string;
  pack: MvSegmentPromptPack;
  h3Prompt: string;
  seedancePrompt: string;
}

interface MvImageCandidate {
  schema: 't8-mv-image-candidate-v1';
  id: string;
  shotId: string;
  segmentId: string;
  revision: number;
  provider: 'seedance-nz' | 'zhenzhen';
  model: string;
  status: 'submitting' | 'ambiguous' | 'submitted' | 'polling' | 'materializing' | 'recoverable' | 'interrupted' | 'succeeded' | 'failed';
  submissionKey: string;
  prompt?: string;
  promptDigest?: string;
  requestDigest?: string;
  requestSnapshot?: Record<string, unknown>;
  submissionTrace?: Record<string, unknown>;
  terminalTrace?: Record<string, unknown>;
  dispatchStartedAt?: number;
  taskId?: string;
  taskEndpoint?: string;
  outputUrl?: string;
  assetId?: string;
  contentHash?: string;
  width?: number;
  height?: number;
  viewedAt?: number;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

interface MvVideoCandidate {
  schema: 't8-mv-video-candidate-v1';
  id: string;
  segmentId: string;
  revision: number;
  provider: 'seedance-nz' | 'zhenzhen';
  family: 'seedance' | 'hailuo';
  model: string;
  status: 'submitting' | 'ambiguous' | 'blocked' | 'submitted' | 'polling' | 'materializing' | 'recoverable' | 'interrupted' | 'succeeded' | 'failed';
  submissionKey: string;
  providerPrompt?: string;
  promptDigest?: string;
  requestDigest?: string;
  requestSnapshot?: Record<string, unknown>;
  submissionTrace?: Record<string, unknown>;
  terminalTrace?: Record<string, unknown>;
  dispatchStartedAt?: number;
  taskId?: string;
  taskProvider?: 'seedance-nz' | 'zhenzhen-legacy';
  submittedModel?: string;
  submittedTaskProvider?: string;
  submittedTaskType?: string;
  modelMismatch?: boolean;
  providerContractMismatch?: boolean;
  providerContractVerifiedAt?: number;
  manualResolutionReason?: string;
  requestedDurationSeconds: number;
  targetDurationUs: number;
  outputUrl?: string;
  assetId?: string;
  contentHash?: string;
  width?: number;
  height?: number;
  actualDurationSeconds?: number;
  hasAudio?: boolean;
  viewedAt?: number;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

interface MvFinalComposition {
  schema: 't8-mv-final-composition-v1';
  status: 'composing' | 'recoverable' | 'succeeded' | 'failed';
  result?: VideoComposeResult;
  songSha256: string;
  expectedDurationUs: number;
  videoCandidateIds: string[];
  jobId?: string;
  inputDigest?: string;
  contentHash?: string;
  assetId?: string;
  promptAssetId?: string;
  promptContentHash?: string;
  manifestAssetId?: string;
  manifestContentHash?: string;
  masterAudioMode?: 'single-pass-transcode';
  subtitleCount?: number;
  durationDriftSeconds?: number;
  edlDigest?: string;
  edlAssetId?: string;
  edlText?: string;
  composeAttemptId?: string;
  validationReceipt?: {
    schema: 't8-mv-physical-validation-receipt-v1';
    edlDigest: string;
    edlAssetId: string;
    finalAssetId: string;
    finalContentHash: string;
    composeAttemptId: string;
    sourceSongSha256: string;
    masterAudioSourceSha256: string;
    masterAudioSourceDuration: number;
    audioStreamCount: 1;
    durationDriftSeconds: number;
    checkedAt: number;
  };
  qcReport?: {
    schema: 't8-mv-qc-report-v2';
    passed: true;
    projectRevision: number;
    edlDigest: string;
    edlAssetId: string;
    finalAssetId: string;
    composeAttemptId: string;
    validationDigest: string;
    finalContentHash: string;
    sourceSongSha256: string;
    masterAudioSourceSha256: string;
    masterAudioSourceDuration: number;
    audioStreamCount: 1;
    durationDriftSeconds: number;
    playbackEvidence: MvPlaybackEvidence;
    checkedAt: number;
  };
  viewedAt?: number;
  promptBundleText?: string;
  manifestText?: string;
  storyboardUrls?: string[];
  deliveryReceipt?: {
    schema: 't8-mv-delivery-receipt-v1';
    projectRevision: number;
    finalAssetId: string;
    finalContentHash: string;
    edlDigest: string;
    packageDigest: string;
    qcDigest: string;
    assetCount: number;
    totalKnownBytes: number;
    selectionDigest: string;
    licenseScopeDigest: string;
    confirmedAt: number;
  };
  createdAt: number;
  completedAt?: number;
  error?: string;
}

const WORKSHOP_IMAGE_MODELS = ['gpt-image-2-all', 'gpt-image-2', 'gpt-image-2-2K', 'gpt-image-2-4K'] as const;
const BUDGET_IMAGE_MODELS = ['zhenzhen-image-g2-i2i', 'zhenzhen-image-g-v2-lowprice'] as const;
const WORKSHOP_SEEDANCE_VIDEO_MODELS = ['doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-260128', 'doubao-seedance-2.0-mini'] as const;
const BUDGET_SEEDANCE_VIDEO_MODELS = ['standard', 'fast', 'mini', 'global-standard', 'global-fast', 'global-mini'] as const;
const HAILUO_VIDEO_MODELS: readonly HailuoModel[] = ['hailuo-h3-multi', 'hailuo-h3-i2v', 'minimax-h3-ow-r2v', 'minimax-h3-ow-i2v'];
const SEEDANCE_NZ_MV_VISION_MODELS = [MV_DEFAULT_LLM_MODEL] as const;
const VERIFIED_SEEDANCE_NZ_MV_VISION_MODELS = new Set<string>(SEEDANCE_NZ_MV_VISION_MODELS);

function canonicalMvSeedanceNzModel(alias: string): string {
  if (!BUDGET_SEEDANCE_VIDEO_MODELS.includes(alias as (typeof BUDGET_SEEDANCE_VIDEO_MODELS)[number])) {
    throw new Error(`未知的 MV Seedance 2.0 模型别名：${alias || '(空)'}`);
  }
  const global = alias.startsWith('global-');
  const tier = alias.replace(/^global-/, '');
  return `seedance-2.0-${global ? 'global-' : ''}${tier}-multi`;
}

function expectedMvVideoTaskType(family: 'seedance' | 'hailuo', model: string): 't2v' | 'i2v' | 'r2v' | 'multi' {
  if (family === 'seedance' || model === 'hailuo-h3-multi') return 'multi';
  if (model.endsWith('-r2v')) return 'r2v';
  if (model.endsWith('-i2v')) return 'i2v';
  return 't2v';
}

interface MvShotTask {
  segment: MvPromptSegmentInput;
  candidate: MvPromptCandidate;
  shot: MvSegmentPromptPack['shots'][number];
}

type MvRunAction =
  | { kind: 'analyze' }
  | { kind: 'align-lyrics'; forceNew?: boolean }
  | { kind: 'visual-bible'; forceNew?: boolean }
  | { kind: 'prompt-packs'; segmentIds?: string[]; forceNew?: boolean }
  | { kind: 'images'; shotIds?: string[]; forceNew?: boolean }
  | { kind: 'videos'; segmentIds?: string[]; forceNew?: boolean }
  | { kind: 'compose'; forceNew?: boolean }
  | { kind: 'deliver' };

const ZHENZHEN_LLM_MODELS = LLM_MODELS.filter((model) => !model.imageOutput && model.vision === true);
const DEFAULT_ZHENZHEN_MODEL = ZHENZHEN_LLM_MODELS.find((model) => model.id === 'gemini-3.5-flash')?.id
  || ZHENZHEN_LLM_MODELS[0]?.id
  || '';

const STAGES: Array<{ id: MvStage; label: string }> = [
  { id: 'materials', label: '1 素材' },
  { id: 'segment-review', label: '2 分段' },
  { id: 'brief-review', label: '3 导演设置' },
  { id: 'prompt-review', label: '4 提示词' },
  { id: 'image-review', label: '5 分镜图' },
  { id: 'video-review', label: '6 分段视频' },
  { id: 'composing', label: '7 合成 QC' },
  { id: 'delivered', label: '8 交付' },
];

const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage.id, index]));

const EMPTY_PROJECT: MvProjectState = {
  schema: 't8-mv-music-master-project-v1',
  revision: 0,
  stage: 'materials',
  lyricUnits: [],
  lyricWarnings: [],
};

const CLEARED_DELIVERY_OUTPUTS = {
  videoUrl: '',
  directVideoUrl: '',
  imageUrls: [],
  outputText: '',
  metadata: undefined,
  subflowOutputs: undefined,
  audioUrl: '',
};

function seconds(us: number | undefined): string {
  return ((Number(us) || 0) / 1_000_000).toFixed(3);
}

function durationLabel(us: number | undefined): string {
  const total = Math.max(0, Math.round((Number(us) || 0) / 1000));
  const minutes = Math.floor(total / 60_000);
  const remain = total - minutes * 60_000;
  return `${String(minutes).padStart(2, '0')}:${(remain / 1000).toFixed(3).padStart(6, '0')}`;
}

function sourceFingerprint(values: Array<{ id?: string; sourceNodeId?: string; url?: string }>): string {
  const canonical = values.map((value) => `${value.sourceNodeId || ''}|${value.id || ''}|${value.url || ''}`).sort().join('\n');
  return `sha256:${sha256BytesHex(new TextEncoder().encode(canonical))}`;
}

function textFingerprint(value: string): string {
  return sourceFingerprint([{ id: String(value || '') }]);
}

function providerTrace(value: any): Record<string, unknown> {
  return {
    ...(value?.requestId ? { requestId: String(value.requestId) } : {}),
    ...(Number.isFinite(Number(value?.transportHttpStatus)) ? { transportHttpStatus: Number(value.transportHttpStatus) } : {}),
    ...(Number.isFinite(Number(value?.upstreamHttpStatus)) ? { upstreamHttpStatus: Number(value.upstreamHttpStatus) } : {}),
    ...(value?.usage && typeof value.usage === 'object' ? { usage: value.usage as Record<string, unknown> } : {}),
  };
}

async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function readMvMaterialEvidence(
  materials: Array<{ id?: string; sourceNodeId?: string; url?: string; label?: string }>,
  signal?: AbortSignal,
): Promise<Array<{ id: string; sourceNodeId: string; sourceUrlDigest: string; contentHash: string; byteLength: number }>> {
  return Promise.all(materials.map(async (material, index) => {
    const url = String(material.url || '').trim();
    if (!url) throw new Error(`第 ${index + 1} 个 MV 参考素材缺少可读取地址。`);
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`无法读取参考素材“${material.label || index + 1}”（HTTP ${response.status}）；为避免错误计费，本次不会提交。`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error(`参考素材“${material.label || index + 1}”为空；本次不会提交。`);
    return {
      id: String(material.id || `material-${index + 1}`),
      sourceNodeId: String(material.sourceNodeId || ''),
      sourceUrlDigest: await sha256Hex(url),
      contentHash: await sha256Hex(bytes),
      byteLength: bytes.byteLength,
    };
  }));
}

async function decodeAudioReceipt(url: string, label: string, signal?: AbortSignal): Promise<MvAudioReceipt> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`读取歌曲失败（HTTP ${response.status}）。`);
  const bytes = await response.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持本地音频解码。');
  const context = new AudioContextClass();
  try {
    const [sha256, decoded] = await Promise.all([
      sha256Hex(bytes),
      context.decodeAudioData(bytes.slice(0)),
    ]);
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(decoded.length) || decoded.length <= 0) throw new Error('歌曲没有可解码的 PCM 采样。');
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const source = decoded.getChannelData(channel);
      for (let index = 0; index < decoded.length; index += 1) mono[index] += (source[index] || 0) / decoded.numberOfChannels;
    }
    const localAnalysis = analyzeMvAudioSamples(mono, decoded.sampleRate);
    return {
      schema: 't8-mv-audio-source-receipt-v1',
      sourceUrl: url,
      sourceLabel: label,
      sha256,
      byteLength: bytes.byteLength,
      sampleRate: decoded.sampleRate,
      channelCount: decoded.numberOfChannels,
      totalSamples: decoded.length,
      durationUs: mvSampleToTimeUs(decoded.length, decoded.sampleRate),
      waveformPeaks: localAnalysis.waveformPeaks,
      bpmEvidence: localAnalysis.bpmEvidence,
      beatTimesUs: localAnalysis.beatTimesUs,
      analysisDownmix: 'average-all-channels',
      analyzedAt: Date.now(),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new DOMException('运行已停止', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(done, ms);
    const onAbort = () => done(signal?.reason instanceof Error ? signal.reason : new DOMException('运行已停止', 'AbortError'));
    function done(error?: Error) {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class MvRecoverableTaskError extends Error {
  readonly interrupted: boolean;

  constructor(message: string, interrupted = false) {
    super(message);
    this.name = 'MvRecoverableTaskError';
    this.interrupted = interrupted;
  }
}

function assertMvPollingContinues(control: { interrupted: boolean; reason?: string }, signal?: AbortSignal): void {
  if (control.interrupted || signal?.aborted) {
    throw new MvRecoverableTaskError(
      control.reason || (signal?.aborted
        ? '父运行已停止；远端任务可能仍在运行，已保留原任务/提交键供稍后恢复。'
        : '本地轮询已停止；远端任务可能仍在运行，可稍后继续查询。'),
      true,
    );
  }
}

async function validateImageArtifact(url: string, signal?: AbortSignal): Promise<Pick<MvImageCandidate, 'contentHash' | 'width' | 'height'>> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`分镜图片下载失败（HTTP ${response.status}）。`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 128) throw new Error('分镜图片文件过小，无法作为有效产物。');
  const blob = new Blob([bytes], { type: response.headers.get('content-type') || 'application/octet-stream' });
  const bitmap = await createImageBitmap(blob).catch(() => null);
  signal?.throwIfAborted();
  if (!bitmap || bitmap.width < 16 || bitmap.height < 16) throw new Error('分镜图片无法解码或尺寸无效。');
  const result = { contentHash: await sha256Hex(bytes), width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return result;
}

async function validateVideoArtifact(url: string, signal?: AbortSignal): Promise<Pick<MvVideoCandidate, 'contentHash' | 'width' | 'height' | 'actualDurationSeconds' | 'hasAudio'>> {
  const probe = await probeVideo(url, { signal });
  if ((probe.size || 0) < 1024) throw new Error('分段视频文件过小，无法作为有效产物。');
  if (!probe.hasVideo || !probe.duration || !probe.width || !probe.height) throw new Error('分段视频无法被 FFprobe 解码。');
  if (!probe.contentHash) throw new Error('分段视频缺少后端流式 SHA256 回执。');
  return {
    contentHash: probe.contentHash,
    width: probe.width,
    height: probe.height,
    actualDurationSeconds: probe.duration,
    hasAudio: !!probe.hasAudio,
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium text-white/55">{children}</div>;
}

function PortLabel({ side, top, children }: { side: 'left' | 'right'; top: string; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute z-10 text-[9px] text-white/35 ${side === 'left' ? 'left-3' : 'right-3'}`}
      style={{ top, transform: 'translateY(-50%)' }}
    >
      {children}
    </span>
  );
}

function MvMusicMasterNode({ id, data, selected }: NodeProps) {
  const { t: translate, i18n } = useTranslation(['nodes', 'common']);
  const mvT = (key: string, options?: Record<string, unknown>) => translate(`nodes:mvMusicMaster.editor.${key}`, options);
  const mvRuntimeText = (value: unknown) => localizeLegacyRuntimeText('mvMusicMaster', i18n.resolvedLanguage || i18n.language, value);
  const stageDisplayLabel = (stage: MvStage) => mvT(`stages.${stage}`, { defaultValue: STAGES.find((item) => item.id === stage)?.label || stage });
  const candidateStatusLabel = (status?: string) => mvT(`statuses.${status || 'missing'}`, { defaultValue: status || mvT('missing') });
  const d = data as any;
  const update = useUpdateNodeData(id);
  const upstream = useUpstreamMaterials(id);
  const targetConnections = useNodeConnections({ id, handleType: 'target' });
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [activeStage, setActiveStage] = useState<MvStage>((d.mvProject?.stage || 'materials') as MvStage);
  const [localError, setLocalError] = useState('');
  const [running, setRunning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [manualBpm, setManualBpm] = useState('');
  const [viewingImage, setViewingImage] = useState<{ shotId: string; candidateId: string; url: string } | null>(null);
  const [previewRange, setPreviewRange] = useState<{ start: number; end: number; loop: boolean; label: string } | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const pendingActionRef = useRef<MvRunAction>({ kind: 'analyze' });
  const dispatchingRef = useRef(false);
  const pollingControlRef = useRef<{ interrupted: boolean; reason?: string }>({ interrupted: false });
  const playbackAuditRef = useRef(new WeakMap<HTMLVideoElement, MvPlaybackAuditState>());
  const activePlaybackElementsRef = useRef(new Set<HTMLVideoElement>());
  const project: MvProjectState = d.mvProject?.schema === 't8-mv-music-master-project-v1'
    ? d.mvProject
    : EMPTY_PROJECT;
  const sourceTargetHandles = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const connection of targetConnections) {
      const handles = map.get(connection.source) || new Set<string>();
      handles.add(String(connection.targetHandle || ''));
      map.set(connection.source, handles);
    }
    return map;
  }, [targetConnections]);
  const materialsForHandle = <T extends { sourceNodeId: string }>(materials: T[], handle: string) => materials.filter((material) => {
    const handles = sourceTargetHandles.get(material.sourceNodeId);
    return handles?.has(handle) || (!handles?.size && handle === 'identity-image');
  });
  const identityImages = materialsForHandle(upstream.images, 'identity-image');
  const styleImages = materialsForHandle(upstream.images, 'style-image');
  const motionReferences = materialsForHandle(upstream.videos, 'motion-reference');
  const lyricInputs = materialsForHandle(upstream.texts, 'lyrics');
  const masterAudios = materialsForHandle(upstream.audios, 'master-audio');
  const authoritativeLyricInputs = lyricInputs.length ? lyricInputs : upstream.texts;
  const hasUpstreamLyrics = authoritativeLyricInputs.length > 0;
  const lyricsFromUpstream = authoritativeLyricInputs.map((item) => item.url).join('\n');
  const lyricsText = String(hasUpstreamLyrics ? lyricsFromUpstream : d.lyricsText || '');
  const audio = (masterAudios.length ? masterAudios : upstream.audios)[0];
  const currentInputFingerprint = useMemo(() => ({
    audio: sourceFingerprint(masterAudios.length ? masterAudios : upstream.audios),
    lyrics: textFingerprint(lyricsText),
    identity: sourceFingerprint(identityImages),
    style: sourceFingerprint(styleImages),
    motion: sourceFingerprint(motionReferences),
  }), [masterAudios, upstream.audios, lyricsText, identityImages, styleImages, motionReferences]);
  const inputsStale = !!project.inputFingerprint && JSON.stringify(project.inputFingerprint) !== JSON.stringify(currentInputFingerprint);
  const managedIdentityImages = project.managedInputs?.identity || [];
  const managedStyleImages = project.managedInputs?.style || [];
  const managedMotionReferences = project.managedInputs?.motion || [];
  const segmentCount = project.segmentPlan?.segments.length || 0;
  const currentStageIndex = STAGE_INDEX.get(project.stage) || 0;
  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const llmAdvancedProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'llm'), [advancedProviders]);
  const providerSelection = useMemo(() => resolveAdvancedProviderSelection(advancedProviders, 'llm', {
    providerSource: d.providerSource,
    providerId: d.providerId,
    providerModel: d.providerModel,
  }), [advancedProviders, d.providerSource, d.providerId, d.providerModel]);
  const savedProviderSource = String(d.providerSource || '').trim();
  const savedProviderId = String(d.providerId || '').trim();
  const wantsExternal = Boolean((savedProviderSource && savedProviderSource !== 'zhenzhen') || (!savedProviderSource && savedProviderId));
  const isExternal = wantsExternal && providerSelection.available && !!providerSelection.provider;
  const rawLlmApiSource = String(d.llmApiSource || '').trim();
  const invalidLlmApiSource = !isExternal && !!rawLlmApiSource && !['seedance-nz', 'zhenzhen'].includes(rawLlmApiSource);
  const isSeedanceNz = !isExternal && rawLlmApiSource !== 'zhenzhen';
  const externalModels = providerSelection.provider ? advancedProviderModelOptions(providerSelection.provider, 'llm') : [];
  const savedProviderModel = String(d.providerModel || '').trim();
  const savedWorkshopLlmModel = String(d.model || '').trim();
  const activeProvider = isExternal && providerSelection.provider
    ? providerSelection.provider.id
    : isSeedanceNz ? 'seedance-nz' : 'zhenzhen';
  const activeModel = isExternal
    ? String(savedProviderModel || providerSelection.providerModel || externalModels[0] || '')
    : isSeedanceNz
      ? (savedProviderModel || MV_DEFAULT_LLM_MODEL)
      : String(savedWorkshopLlmModel || DEFAULT_ZHENZHEN_MODEL);
  const invalidLlmModel = isExternal
    ? !!savedProviderModel && !externalModels.includes(savedProviderModel)
    : isSeedanceNz
      ? !!savedProviderModel && !SEEDANCE_NZ_MV_VISION_MODELS.includes(savedProviderModel as (typeof SEEDANCE_NZ_MV_VISION_MODELS)[number])
      : !!savedWorkshopLlmModel && !ZHENZHEN_LLM_MODELS.some((model) => model.id === savedWorkshopLlmModel);
  const rawImageProvider = String(d.mvImageProvider || '').trim();
  const invalidImageProvider = !!rawImageProvider && !['seedance-nz', 'zhenzhen'].includes(rawImageProvider);
  const imageProvider = rawImageProvider === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
  const rawImageModel = String(d.mvImageModel || '').trim();
  const imageModel = rawImageModel || (imageProvider === 'zhenzhen' ? 'gpt-image-2' : 'zhenzhen-image-g2-i2i');
  const invalidImageModel = !!rawImageModel && !(imageProvider === 'zhenzhen' ? WORKSHOP_IMAGE_MODELS : BUDGET_IMAGE_MODELS).includes(rawImageModel as never);
  const rawVideoFamily = String(d.mvVideoFamily || '').trim();
  const invalidVideoFamily = !!rawVideoFamily && !['seedance', 'hailuo'].includes(rawVideoFamily);
  const videoFamily = rawVideoFamily === 'hailuo' ? 'hailuo' : 'seedance';
  const rawVideoProvider = String(d.mvVideoProvider || '').trim();
  const invalidVideoProvider = !!rawVideoProvider && !['seedance-nz', 'zhenzhen'].includes(rawVideoProvider);
  const videoProvider = rawVideoProvider === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
  const selectableSeedanceModels = videoProvider === 'seedance-nz' ? BUDGET_SEEDANCE_VIDEO_MODELS : WORKSHOP_SEEDANCE_VIDEO_MODELS;
  const rawVideoModel = String(d.mvVideoModel || '').trim();
  const videoModel = videoFamily === 'hailuo'
    ? (rawVideoModel || 'hailuo-h3-multi')
    : (rawVideoModel || (videoProvider === 'seedance-nz' ? 'fast' : 'doubao-seedance-2-0-fast-260128'));
  const invalidVideoModel = !!rawVideoModel && !(videoFamily === 'hailuo' ? HAILUO_VIDEO_MODELS : selectableSeedanceModels).includes(rawVideoModel as never);
  const videoResolutionOptions = videoFamily === 'hailuo'
    ? videoModel.startsWith('minimax-h3-ow-') ? ['480p', '720p'] : ['2K']
    : videoProvider === 'seedance-nz' ? ['480p', '720p', '1080p', '2k', '4k'] : ['480p', '720p', 'native1080p', 'native4K', '1080p', '2k', '4k'];
  const effectiveVideoResolution = videoResolutionOptions.includes(String(d.mvVideoResolution || ''))
    ? String(d.mvVideoResolution)
    : videoResolutionOptions[0];
  const rawVideoResolution = String(d.mvVideoResolution || '').trim();
  const invalidVideoResolution = !!rawVideoResolution && !videoResolutionOptions.includes(rawVideoResolution);
  const videoImageReferenceLimit = videoFamily === 'seedance'
    ? 9
    : videoModel === 'hailuo-h3-multi' ? 8
    : 1;
  const videoBindsSegmentAudio = videoFamily === 'seedance' || videoModel === 'hailuo-h3-multi';
  const canonicalVideoModelPreview = videoFamily === 'seedance' && videoProvider === 'seedance-nz' && !invalidVideoModel
    ? canonicalMvSeedanceNzModel(videoModel)
    : videoModel;
  const providerLabel = isExternal && providerSelection.provider
    ? providerSelection.provider.label || providerSelection.provider.id
    : isSeedanceNz ? '贞贞的平价AI小屋' : '贞贞的AI工坊';
  const configurationDriftMessage = wantsExternal && !isExternal
    ? '已保存的扩展 LLM 渠道不存在、未启用或不支持 Chat；请重新选择渠道。'
    : invalidLlmApiSource
      ? `已保存的 LLM 渠道 ${rawLlmApiSource} 无效；请重新选择。`
      : invalidLlmModel
        ? `已保存的 LLM 模型 ${activeModel || '(空)'} 不属于当前渠道；请重新选择。`
        : invalidImageProvider || invalidImageModel
          ? `已保存的图像选择无效（${rawImageProvider || '(缺省)'} / ${rawImageModel || '(缺省)'}）；请重新选择。`
          : invalidVideoFamily || invalidVideoProvider || invalidVideoModel || invalidVideoResolution
            ? `已保存的视频选择无效（${rawVideoFamily || '(缺省)'} / ${rawVideoProvider || '(缺省)'} / ${rawVideoModel || '(缺省)'} / ${rawVideoResolution || '(缺省)'}）；请重新选择。`
            : '';
  const creativeBrief = useMemo<MvCreativeBrief>(() => ({
    mvType: ['narrative', 'performance', 'dance', 'abstract', 'lyric-visual', 'hybrid'].includes(String(d.mvType)) ? d.mvType : 'hybrid',
    styleDescription: String(d.styleDescription || ''),
    creativity: ['conservative', 'balanced', 'creative', 'custom'].includes(String(d.creativity)) ? d.creativity : 'balanced',
    shotMode: ['bpm-auto', 'semantic-auto', 'fixed'].includes(String(d.shotMode)) ? d.shotMode : 'bpm-auto',
    fixedShotCount: Math.max(1, Math.min(20, Math.trunc(Number(d.fixedShotCount) || 4))),
    aspectRatio: String(d.aspectRatio || '16:9'),
    subtitles: String(d.subtitlePolicy || 'lyrics') as MvCreativeBrief['subtitles'],
    continuityLocks: Array.isArray(d.continuityLocks) ? d.continuityLocks.map(String) : ['人物身份', '发型与主服装', '主色调'],
    forbidden: Array.isArray(d.forbidden) ? d.forbidden.map(String) : ['新增或改写歌词', '人物身份漂移', '不可读或错误文字'],
  }), [d.mvType, d.styleDescription, d.creativity, d.shotMode, d.fixedShotCount, d.aspectRatio, d.subtitlePolicy, d.continuityLocks, d.forbidden]);
  const promptSegments = useMemo<MvPromptSegmentInput[]>(() => project.segmentPlan
    ? buildMvPromptSegmentInputs(project.segmentPlan, project.lyricUnits, creativeBrief, project.audio?.bpmEvidence)
    : [], [project.segmentPlan, project.lyricUnits, project.audio?.bpmEvidence, creativeBrief]);
  const acceptedBible = (project.bibleCandidates || []).find((candidate) => candidate.id === project.acceptedBibleId);
  const latestBible = (project.bibleCandidates || []).at(-1);
  const acceptedPromptCount = promptSegments.filter((segment) => (project.promptCandidates?.[segment.segmentId] || []).some((candidate) => candidate.id === project.acceptedPromptIds?.[segment.segmentId])).length;
  const shotTasks = useMemo<MvShotTask[]>(() => promptSegments.flatMap((segment) => {
    const acceptedId = project.acceptedPromptIds?.[segment.segmentId];
    const candidate = (project.promptCandidates?.[segment.segmentId] || []).find((item) => item.id === acceptedId);
    return candidate ? candidate.pack.shots.map((shot) => ({ segment, candidate, shot })) : [];
  }), [promptSegments, project.acceptedPromptIds, project.promptCandidates]);
  const acceptedImageCount = shotTasks.filter((task) => (project.imageCandidates?.[task.shot.shotId] || []).some((candidate) => candidate.id === project.acceptedImageIds?.[task.shot.shotId] && candidate.status === 'succeeded' && !!candidate.contentHash)).length;
  const storedApprovals: MvProjectApprovals = project.approvals?.schema === 't8-mv-project-approvals-v1'
    ? project.approvals
    : { schema: 't8-mv-project-approvals-v1', musicRights: false, portraitConsent: false, styleReferenceRights: false, paidGeneration: false, maxTasksPerBatch: 50, updatedAt: 0 };
  const approvalScopeDigest = textFingerprint(JSON.stringify({
    inputs: currentInputFingerprint,
    segmentPlanDigest: project.segmentConfirmation?.planDigest || '',
    creativeBrief,
    llm: { provider: activeProvider, model: activeModel },
    image: { provider: imageProvider, model: imageModel },
    video: { provider: videoProvider, family: videoFamily, model: videoModel, resolution: effectiveVideoResolution },
  }));
  const approvals: MvProjectApprovals = storedApprovals.scopeDigest === approvalScopeDigest
    ? storedApprovals
    : { ...storedApprovals, musicRights: false, portraitConsent: false, styleReferenceRights: false, paidGeneration: false, lastPaidReceipt: undefined };
  const busy = running || dispatching;
  const visualBibleSubmissionUnresolved = ['submitting', 'ambiguous'].includes(String(project.llmSubmissionGuards?.['visual-bible']?.status || ''));
  const promptSubmissionUnresolved = ['submitting', 'ambiguous'].includes(String(project.llmSubmissionGuards?.['prompt-packs']?.status || ''));

  useEffect(() => {
    if (!inputsStale) return;
    const reset: MvProjectState = { ...EMPTY_PROJECT, revision: project.revision + 1 };
    update({ ...CLEARED_DELIVERY_OUTPUTS, mvProject: reset, status: 'idle', error: '' });
    setActiveStage('materials');
  }, [inputsStale, project.revision, update]);

  const patchProject = (patch: Partial<MvProjectState>, options: { clearDeliveryOutputs?: boolean } = {}) => {
    const next: MvProjectState = {
      ...project,
      ...patch,
      revision: project.revision + 1,
    };
    update({ ...(options.clearDeliveryOutputs ? CLEARED_DELIVERY_OUTPUTS : {}), mvProject: next });
    return next;
  };

  const creativeInvalidation: Partial<MvProjectState> = {
    bibleCandidates: undefined,
    acceptedBibleId: undefined,
    promptCandidates: undefined,
    acceptedPromptIds: undefined,
    imageCandidates: undefined,
    acceptedImageIds: undefined,
    audioSlices: undefined,
    videoCandidates: undefined,
    acceptedVideoIds: undefined,
    finalComposition: undefined,
    reviewReceipts: undefined,
    adoptionReceipts: undefined,
    llmSubmissionGuards: undefined,
  };

  const invalidateFromSegmentation = (patch: Partial<MvProjectState>): MvProjectState => patchProject({
    ...patch,
    segmentConfirmation: undefined,
    ...creativeInvalidation,
  }, { clearDeliveryOutputs: true });

  const updateCreativeSetting = (dataPatch: Record<string, unknown>) => {
    const next: MvProjectState = {
      ...project,
      ...creativeInvalidation,
      stage: project.segmentConfirmation ? 'brief-review' : 'segment-review',
      revision: project.revision + 1,
    };
    update({ ...CLEARED_DELIVERY_OUTPUTS, ...dataPatch, mvProject: next });
    setActiveStage(next.stage);
  };

  const playPreviewRange = async (startUs: number, endUs: number, label: string, loop = false) => {
    const player = audioPreviewRef.current;
    if (!player || endUs <= startUs) return;
    setPreviewRange({ start: startUs / 1_000_000, end: endUs / 1_000_000, loop, label });
    player.currentTime = startUs / 1_000_000;
    await player.play().catch((error) => setLocalError(error instanceof Error ? error.message : String(error)));
  };

  const assertProjectInputsCurrent = () => {
    if (inputsStale) throw new Error('上游歌曲、歌词、人设、风格或运镜素材已变化；旧分段与生成链路已失效，请回到素材阶段重新分析。');
  };

  const materialEvidenceDigest = async (evidence: Awaited<ReturnType<typeof readMvMaterialEvidence>>) => sha256Hex(JSON.stringify(evidence.map((item) => ({
    id: item.id,
    sourceNodeId: item.sourceNodeId,
    contentHash: item.contentHash,
    byteLength: item.byteLength,
  }))));

  const assertProjectMaterialBytesCurrent = async (signal?: AbortSignal) => {
    assertProjectInputsCurrent();
    if (!project.inputContentFingerprint) throw new Error('项目缺少上游素材字节指纹，请回到素材阶段重新分析。');
    const [audioEvidence, identityEvidence, styleEvidence, motionEvidence] = await Promise.all([
      readMvMaterialEvidence(masterAudios.length ? masterAudios : upstream.audios, signal),
      readMvMaterialEvidence(identityImages, signal),
      readMvMaterialEvidence(styleImages, signal),
      readMvMaterialEvidence(motionReferences, signal),
    ]);
    const actual = {
      audio: await materialEvidenceDigest(audioEvidence),
      identity: await materialEvidenceDigest(identityEvidence),
      style: await materialEvidenceDigest(styleEvidence),
      motion: await materialEvidenceDigest(motionEvidence),
    };
    if (JSON.stringify(actual) !== JSON.stringify(project.inputContentFingerprint)) {
      const reset: MvProjectState = { ...EMPTY_PROJECT, revision: project.revision + 1 };
      update({ ...CLEARED_DELIVERY_OUTPUTS, mvProject: reset, status: 'error', error: '上游素材稳定地址对应的实际字节已变化；旧生成链、回执和交付已全部撤销，请重新分析。' });
      setActiveStage('materials');
      throw new Error('上游素材实际字节已变化；旧结果已全部撤销。');
    }
    if (!project.audio?.assetId) throw new Error('项目缺少受管主歌曲资产，请回到素材阶段重新分析。');
    const managedInputs = [...managedIdentityImages, ...managedStyleImages, ...managedMotionReferences];
    if (managedIdentityImages.length !== identityImages.length || managedStyleImages.length !== styleImages.length || managedMotionReferences.length !== motionReferences.length) {
      throw new Error('受管参考素材与当前上游数量不一致，请回到素材阶段重新分析。');
    }
    const managedAssets = [
      { scope: '主歌曲', assetId: project.audio.assetId, contentHash: project.audio.sha256, sourceUrl: project.audio.sourceUrl },
      ...managedInputs.map((item) => ({ scope: `${item.role}:${item.id}`, assetId: item.assetId, contentHash: item.contentHash, sourceUrl: item.url })),
    ];
    for (const managed of managedAssets) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('运行已停止', 'AbortError');
      const asset = await getProjectAsset(managed.assetId).catch(() => undefined);
      if (!asset || asset.availability !== 'available' || asset.contentHash !== managed.contentHash || asset.sourceUrl !== managed.sourceUrl) {
        throw new Error(`${managed.scope} 的受管项目资产已缺失、不可用或身份变化，请重新分析。`);
      }
    }
  };

  const buildPaidApprovalTask = async (
    id: string,
    provider: string,
    model: string,
    request: unknown,
    material: unknown,
  ): Promise<MvPaidApprovalTaskReceipt> => ({
    id,
    provider,
    model,
    requestDigest: await sha256Hex(JSON.stringify(request)),
    materialDigest: await sha256Hex(JSON.stringify(material)),
  });

  const assertPaidReceiptCoversTask = async (
    receipt: MvPaidApprovalReceipt,
    expected: MvPaidApprovalTaskReceipt,
  ) => {
    if (receipt.schema !== 't8-mv-paid-approval-receipt-v1' || receipt.scopeDigest !== approvalScopeDigest) {
      throw new Error('精确计费批准已失效：项目范围或批准协议不匹配。');
    }
    const recalculated = await sha256Hex(JSON.stringify({ label: receipt.operation, tasks: receipt.tasks }));
    if (receipt.taskCount !== receipt.tasks.length || receipt.taskSetDigest !== recalculated) {
      throw new Error('精确计费批准已失效：任务集合回执校验失败。');
    }
    const exact = receipt.tasks.find((task) => task.id === expected.id);
    if (!exact || JSON.stringify(exact) !== JSON.stringify(expected)) {
      throw new Error(`精确计费批准未覆盖实际请求 ${expected.id}；已在 Provider 调用前停止。`);
    }
  };

  const assertPaidOperationApproved = async (label: string, tasks: MvPaidApprovalTaskReceipt[]) => {
    const taskCount = tasks.length;
    if (!taskCount) throw new Error(`${label}没有可批准的真实请求。`);
    if (!approvals.musicRights) throw new Error(`执行${label}前，请确认你拥有歌曲/录音的使用授权。`);
    if (!approvals.portraitConsent) throw new Error(`执行${label}前，请确认人设图涉及人物已授权用于生成。`);
    if (styleImages.length > 0 && !approvals.styleReferenceRights) throw new Error(`执行${label}前，请确认风格参考图有权用于本次生成。`);
    if (!approvals.paidGeneration) throw new Error(`执行${label}前，请确认本次会调用真实 Provider 并按渠道实时计费。`);
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(approvals.maxTasksPerBatch) || 1)));
    if (taskCount > limit) throw new Error(`${label}将提交 ${taskCount} 个任务，超过已确认的单批上限 ${limit}；请提高上限或拆分执行。`);
    const taskSetDigest = await sha256Hex(JSON.stringify({ label, tasks }));
    const channels = Array.from(new Set(tasks.map((task) => `${task.provider} / ${task.model}`))).join('\n');
    const exact = window.confirm(`确认本批真实计费\n\n操作：${label}\n任务数：${taskCount}\n任务集合 SHA-256：${taskSetDigest}\n实际渠道 / 模型：\n${channels}\n\n每项请求摘要和素材摘要均已绑定；仅本次操作有效。素材、模型、渠道或任务集合变化后授权自动失效。`);
    if (!exact) throw new Error(`${label}未获得本批次精确计费确认。`);
    const receipt: MvPaidApprovalReceipt = {
      schema: 't8-mv-paid-approval-receipt-v1',
      operation: label,
      taskCount,
      taskSetDigest,
      scopeDigest: approvalScopeDigest,
      tasks,
      approvedAt: Date.now(),
    };
    patchProject({ approvals: { ...approvals, scopeDigest: approvalScopeDigest, lastPaidReceipt: receipt, updatedAt: receipt.approvedAt } });
    return receipt;
  };

  const updateApprovals = (patch: Partial<MvProjectApprovals>) => {
    const base = storedApprovals.scopeDigest === approvalScopeDigest
      ? storedApprovals
      : { ...storedApprovals, musicRights: false, portraitConsent: false, styleReferenceRights: false, paidGeneration: false, lastPaidReceipt: undefined };
    patchProject({ approvals: { ...base, ...patch, scopeDigest: approvalScopeDigest, schema: 't8-mv-project-approvals-v1', updatedAt: Date.now() } });
  };

  const commitProjectFrom = (base: MvProjectState, patch: Partial<MvProjectState>) => {
    const next: MvProjectState = { ...base, ...patch, revision: base.revision + 1 };
    update({ mvProject: next });
    return next;
  };

  const commitLlmSubmissionGuard = (
    base: MvProjectState,
    guard: NonNullable<NonNullable<MvProjectState['llmSubmissionGuards']>['visual-bible']>,
  ) => commitProjectFrom(base, {
    llmSubmissionGuards: { ...(base.llmSubmissionGuards || {}), [guard.operation]: guard },
  });

  const candidateEvidenceDigest = (scope: string, candidate: { id: string; assetId?: string; contentHash?: string; requestDigest?: string; promptDigest?: string; width?: number; height?: number; actualDurationSeconds?: number }) => sha256BytesHex(new TextEncoder().encode(JSON.stringify({
    scope,
    candidateId: candidate.id,
    assetId: candidate.assetId || '',
    contentHash: candidate.contentHash || '',
    requestDigest: candidate.requestDigest || '',
    promptDigest: candidate.promptDigest || '',
    width: candidate.width || 0,
    height: candidate.height || 0,
    actualDurationSeconds: candidate.actualDurationSeconds || 0,
  })));

  const reviewReceiptDigest = (receipt: MvCandidateReviewReceipt) => sha256BytesHex(new TextEncoder().encode(JSON.stringify(receipt)));

  const markTextCandidateReviewed = (
    scope: string,
    candidate: { id: string; assetId?: string; contentHash?: string; requestDigest?: string; promptDigest?: string },
  ) => {
    if (!candidate.assetId || !candidate.contentHash) {
      setLocalError('文本候选缺少持久资产或内容哈希，不能签发 ReviewReceipt。');
      return;
    }
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    const existing = project.reviewReceipts?.[candidate.id];
    if (existing?.schema === 't8-mv-candidate-review-v2' && existing.scope === scope && existing.assetId === candidate.assetId && existing.contentHash === candidate.contentHash && existing.evidenceDigest === evidenceDigest) return;
    const viewedAt = Date.now();
    patchProject({
      reviewReceipts: {
        ...(project.reviewReceipts || {}),
        [candidate.id]: { schema: 't8-mv-candidate-review-v2', projectRevision: project.revision + 1, scope, candidateId: candidate.id, contentHash: candidate.contentHash, assetId: candidate.assetId, evidenceDigest, medium: 'text', viewedAt },
      },
    });
  };

  const analyze = async (reporter: RunNodeLifecycleReporter) => {
    setLocalError('');
    setRunning(true);
    update({ status: 'generating', error: '' });
    try {
      if (masterAudios.length !== 1) throw new Error('请向“歌曲”端口只连接 1 条权威主歌曲音频。');
      if (!lyricsText.trim()) throw new Error('请连接或粘贴准确歌词。');
      if (identityImages.length < 1) throw new Error('请向“人设”端口至少连接 1 张身份图。');
      const [receipt, identityEvidence, styleEvidence, motionEvidence] = await Promise.all([
        decodeAudioReceipt(audio.url, audio.label || '主歌曲', reporter.signal),
        readMvMaterialEvidence(identityImages, reporter.signal),
        readMvMaterialEvidence(styleImages, reporter.signal),
        readMvMaterialEvidence(motionReferences, reporter.signal),
      ]);
      const masterChild = await createMvChildAttempt(reporter, {
        provider: 'local-host-artifact',
        model: 'audio-source',
        jobId: `master-audio-${receipt.sha256.slice(0, 16)}`,
        jobKind: 'mv-master-audio-ingest',
        submissionKey: `t8-mv-master-audio-${receipt.sha256.slice(0, 40)}`,
      });
      let managedReceipt: MvAudioReceipt;
      try {
        await masterChild.providerRequest({ provider: 'local-host-artifact', model: 'audio-source', contentHash: receipt.sha256, byteLength: receipt.byteLength });
        await masterChild.providerResponse({ provider: 'local-host-artifact', model: 'audio-source', status: 'succeeded' });
        const [masterAsset] = await masterChild.output({ assets: [{ kind: 'audio', sourceUrl: receipt.sourceUrl, filename: receipt.sourceLabel || 'mv-master-audio', metadata: { sourceSha256: receipt.sha256, byteLength: receipt.byteLength, durationUs: receipt.durationUs } }] });
        if (!masterAsset?.id || !masterAsset.sourceUrl || masterAsset.availability !== 'available' || masterAsset.contentHash !== receipt.sha256) throw new Error('权威主歌曲未能物化为受管项目资产。');
        managedReceipt = { ...receipt, assetId: masterAsset.id, sourceUrl: masterAsset.sourceUrl };
        await masterChild.succeed({ assetId: masterAsset.id, contentHash: masterAsset.contentHash, byteLength: receipt.byteLength });
      } catch (error) {
        await masterChild.fail(error).catch(() => undefined);
        throw error;
      }
      const rawManagedInputs = [
        ...identityImages.map((material, index) => ({ material, evidence: identityEvidence[index], role: 'identity' as const, kind: 'image' as const })),
        ...styleImages.map((material, index) => ({ material, evidence: styleEvidence[index], role: 'style' as const, kind: 'image' as const })),
        ...motionReferences.map((material, index) => ({ material, evidence: motionEvidence[index], role: 'motion' as const, kind: 'video' as const })),
      ];
      const managedInputList: MvManagedInputMaterial[] = [];
      if (rawManagedInputs.length) {
        const inputDigest = await sha256Hex(JSON.stringify(rawManagedInputs.map(({ evidence, role, kind }) => ({ evidence, role, kind }))));
        const inputChild = await createMvChildAttempt(reporter, {
          provider: 'local-host-artifact', model: 'managed-inputs', jobId: `managed-inputs-${inputDigest.slice(0, 16)}`,
          jobKind: 'mv-managed-input-ingest', submissionKey: `t8-mv-managed-inputs-${inputDigest.slice(0, 40)}`,
        });
        try {
          await inputChild.providerRequest({ provider: 'local-host-artifact', model: 'managed-inputs', inputDigest, count: rawManagedInputs.length });
          await inputChild.providerResponse({ provider: 'local-host-artifact', model: 'managed-inputs', status: 'succeeded' });
          const assets = await inputChild.output({ assets: rawManagedInputs.map(({ material, evidence, role, kind }, index) => ({
            kind,
            sourceUrl: material.url,
            filename: `mv-${role}-reference-${index + 1}`,
            metadata: { role, sourceNodeId: material.sourceNodeId, sourceContentHash: evidence.contentHash, byteLength: evidence.byteLength },
          })) });
          if (assets.length !== rawManagedInputs.length) throw new Error('受管参考素材数量与输入不一致。');
          for (let index = 0; index < rawManagedInputs.length; index += 1) {
            const { material, evidence, role, kind } = rawManagedInputs[index];
            const asset = assets[index];
            if (!asset?.id || !asset.sourceUrl || asset.availability !== 'available' || asset.contentHash !== evidence.contentHash) throw new Error(`第 ${index + 1} 个参考素材未能物化为内容寻址项目资产。`);
            managedInputList.push({
              id: String(material.id || `${role}-${index + 1}`), sourceNodeId: String(material.sourceNodeId || ''), label: String(material.label || `${role} ${index + 1}`),
              url: asset.sourceUrl, assetId: asset.id, contentHash: asset.contentHash, byteLength: evidence.byteLength, sourceUrlDigest: evidence.sourceUrlDigest, kind, role,
            });
          }
          await inputChild.succeed({ inputDigest, assetIds: assets.map((asset) => asset.id), count: assets.length });
        } catch (error) {
          await inputChild.fail(error).catch(() => undefined);
          throw error;
        }
      }
      const audioEvidence = [{ id: audio.id, sourceNodeId: audio.sourceNodeId, sourceUrlDigest: await sha256Hex(audio.url), contentHash: managedReceipt.sha256, byteLength: managedReceipt.byteLength }];
      const parsed = parseMvLyrics(lyricsText, { durationUs: receipt.durationUs });
      if (parsed.units.length === 0) throw new Error('歌词没有可用内容。');
      const next = patchProject({
        stage: 'segment-review',
        audio: managedReceipt,
        lyricFormat: parsed.format,
        lyricUnits: parsed.units,
        lyricWarnings: parsed.warnings,
        inputContentFingerprint: {
          audio: await materialEvidenceDigest(audioEvidence),
          identity: await materialEvidenceDigest(identityEvidence),
          style: await materialEvidenceDigest(styleEvidence),
          motion: await materialEvidenceDigest(motionEvidence),
        },
        managedInputs: {
          identity: managedInputList.filter((item) => item.role === 'identity'),
          style: managedInputList.filter((item) => item.role === 'style'),
          motion: managedInputList.filter((item) => item.role === 'motion'),
        },
        segmentPlan: undefined,
        segmentConfirmation: undefined,
        bibleCandidates: undefined,
        acceptedBibleId: undefined,
        promptCandidates: undefined,
        acceptedPromptIds: undefined,
        imageCandidates: undefined,
        acceptedImageIds: undefined,
        audioSlices: undefined,
        videoCandidates: undefined,
        acceptedVideoIds: undefined,
        finalComposition: undefined,
        reviewReceipts: undefined,
        adoptionReceipts: undefined,
        llmSubmissionGuards: undefined,
        inputFingerprint: currentInputFingerprint,
      });
      update({
        ...CLEARED_DELIVERY_OUTPUTS,
        status: 'success',
        error: '',
        lyricsText: hasUpstreamLyrics ? '' : lyricsText,
        mvProject: next,
      });
      setActiveStage('segment-review');
      setWorkbenchOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const alignLyricsWithWhisper = async (reporter: RunNodeLifecycleReporter, forceNew = false) => {
    setLocalError('');
    setRunning(true);
    let child: MvChildAttempt | undefined;
    let providerDispatchStarted = false;
    let providerResponseReceived = false;
    let activeSubmission: MvProjectState['asrSubmission'];
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      if (!project.audio) throw new Error('请先完成歌曲解码。');
      if (!project.lyricUnits.length) throw new Error('没有可对齐的权威歌词。');
      const alignmentRequest = buildWhisperTranscribeRequestBody({ audioUrl: project.audio.sourceUrl, model: 'whisper-1', responseFormat: 'verbose_json' });
      const alignmentRequestDigest = await sha256Hex(JSON.stringify(alignmentRequest));
      if (!forceNew && project.asrSubmission?.requestDigest === alignmentRequestDigest && ['submitting', 'ambiguous'].includes(project.asrSubmission.status)) {
        throw new Error('上一笔 ASR 提交结果不明确，禁止自动重复 POST。请先核对 Provider 任务/账单，再使用“已核对旧任务后新建 ASR 修订”。');
      }
      const asrRevision = forceNew ? (project.asrSubmission?.revision || 0) + 1 : project.asrSubmission?.requestDigest === alignmentRequestDigest ? project.asrSubmission.revision : 1;
      const paidTask = await buildPaidApprovalTask('lyrics-asr', 'seedance-nz', 'whisper-1', alignmentRequest, { audioSha256: project.audio.sha256, lyricsDigest: currentInputFingerprint.lyrics });
      const paidTaskDigest = await sha256Hex(JSON.stringify(paidTask));
      const submissionKey = `t8-mv-asr-${paidTaskDigest.slice(0, 40)}-r${asrRevision}`;
      const paidReceipt = await assertPaidOperationApproved('歌词 ASR 对齐', [paidTask]);
      await assertPaidReceiptCoversTask(paidReceipt, paidTask);
      child = await createMvChildAttempt(reporter, {
        provider: 'seedance-nz',
        model: 'whisper-1',
        jobId: `lyrics-align-${alignmentRequestDigest.slice(0, 12)}-r${asrRevision}`,
        jobKind: 'mv-lyrics-alignment',
        submissionKey,
        approvalReceipt: paidReceipt,
        approvalTask: paidTask,
      });
      if (child.priorSubmission) throw new Error('该 ASR 提交键已有上游任务账本，但 Whisper 同步响应无法按 taskId 恢复；禁止重复 POST，请先核对 Provider。');
      activeSubmission = { schema: 't8-mv-asr-submission-v1', requestDigest: alignmentRequestDigest, submissionKey, revision: asrRevision, status: 'submitting', updatedAt: Date.now() };
      patchProject({ asrSubmission: activeSubmission, approvals: { ...approvals, lastPaidReceipt: paidReceipt, updatedAt: paidReceipt.approvedAt } });
      await child.providerRequest({ provider: 'seedance-nz', model: 'whisper-1', audioSha256: project.audio.sha256, responseFormat: 'verbose_json' });
      providerDispatchStarted = true;
      const result = await transcribeWhisper({
        audioUrl: alignmentRequest.audioUrl,
        model: alignmentRequest.model,
        responseFormat: alignmentRequest.response_format,
      }, { submissionKey: child.submissionKey, signal: reporter.signal });
      const evidence = buildWhisperTranscriptEvidence(result);
      await child.providerResponse({ provider: 'seedance-nz', model: 'whisper-1', requestId: result.requestId, upstreamHttpStatus: result.upstreamHttpStatus, transportHttpStatus: result.transportHttpStatus, status: 'responded' });
      providerResponseReceived = true;
      if (evidence.attribution !== 'provider-segments' || !evidence.segments.length) {
        throw new Error('Whisper 只返回了无时间文本，不能作为歌词切分证据。');
      }
      const aligned = alignMvLyricsToTranscriptSegments(project.lyricUnits, evidence.segments);
      const serialized = JSON.stringify(aligned, null, 2);
      const contentHash = await sha256Hex(serialized);
      const assets = await child.output({ assets: [{ kind: 'text', text: serialized, filename: `mv-lyrics-alignment-r${project.revision + 1}.json`, mimeType: 'application/json', metadata: { contentHash, alignmentSource: aligned.source, confidence: aligned.confidence } }] });
      const asset = assets[0];
      if (!asset?.id || asset.availability !== 'available' || asset.contentHash !== contentHash) throw new Error('歌词对齐证据未能持久化。');
      const next = invalidateFromSegmentation({
        stage: 'segment-review',
        lyricUnits: aligned.units,
        lyricWarnings: [
          ...project.lyricWarnings.filter((warning) => !warning.startsWith('Whisper 对齐')),
          `Whisper 对齐置信度 ${(aligned.confidence * 100).toFixed(1)}%；时间来自 Provider 分段内插值，必须逐句 A-B 试听后确认。`,
        ],
        segmentPlan: undefined,
        asrSubmission: { ...activeSubmission, status: 'succeeded', updatedAt: Date.now() },
        approvals: { ...approvals, lastPaidReceipt: paidReceipt, updatedAt: paidReceipt.approvedAt },
      });
      await child.succeed({ alignmentSource: aligned.source, confidence: aligned.confidence, lyricUnitCount: aligned.units.length });
      update({ status: 'success', error: '', mvProject: next });
    } catch (error) {
      if (providerDispatchStarted && !providerResponseReceived && activeSubmission) {
        patchProject({ asrSubmission: { ...activeSubmission, status: 'ambiguous', updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) } });
        await child?.interrupt(error instanceof Error ? error.message : String(error), { ambiguousSubmission: true, automaticRetryForbidden: true }).catch(() => undefined);
      } else {
        await child?.fail(error).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  useRunTrigger(id, async (reporter) => {
    dispatchingRef.current = false;
    setDispatching(false);
    const action = pendingActionRef.current;
    if (action.kind === 'analyze') return analyze(reporter);
    if (action.kind === 'align-lyrics') return alignLyricsWithWhisper(reporter, !!action.forceNew);
    if (action.kind === 'visual-bible') return generateVisualBible(reporter, !!action.forceNew);
    if (action.kind === 'prompt-packs') return generatePromptPacks(action.segmentIds, reporter, !!action.forceNew);
    if (action.kind === 'images') return generateImages(action.shotIds, reporter, !!action.forceNew);
    if (action.kind === 'videos') return generateVideos(action.segmentIds, reporter, !!action.forceNew);
    if (action.kind === 'compose') return composeFinalMv(reporter, !!action.forceNew);
    if (action.kind === 'deliver') return deliverFinalMv(reporter);
  }, 'mv-music-master', { lifecycleAware: true });

  const buildManualTimingDraft = () => {
    if (!project.audio || project.lyricUnits.length === 0) return;
    const count = project.lyricUnits.length;
    const units = project.lyricUnits.map((unit, index) => ({
      ...unit,
      startUs: Math.round((project.audio!.durationUs * index) / count),
      endUs: Math.round((project.audio!.durationUs * (index + 1)) / count),
    }));
    invalidateFromSegmentation({ lyricUnits: units.map((unit) => ({ ...unit, timingSource: 'manual-draft', timingConfidence: 0, timingBoundaryConfirmations: { start: false, end: false } })), lyricWarnings: ['已建立均匀人工对齐草案；这不是 ASR 证据。每句起点和终点都必须分别试听、编辑并确认后才能求解。'], segmentPlan: undefined });
  };

  const updateLyricTime = (unitId: string, field: 'startUs' | 'endUs', value: number) => {
    const units = project.lyricUnits.map((unit) => {
      if (unit.id !== unitId) return unit;
      const prior = unit.timingBoundaryConfirmations
        || (unit.timingSource === 'manual-draft' ? { start: false, end: false } : { start: true, end: true });
      const confirmations = { ...prior, [field === 'startUs' ? 'start' : 'end']: true };
      const confirmed = confirmations.start && confirmations.end;
      return {
        ...unit,
        [field]: Math.max(0, Math.round(value * 1_000_000)),
        timingSource: confirmed ? 'manual-confirmed' as const : 'manual-draft' as const,
        timingConfidence: confirmed ? 1 : 0,
        timingBoundaryConfirmations: confirmations,
      };
    });
    invalidateFromSegmentation({ lyricUnits: units, segmentPlan: undefined });
  };

  const solveSegments = () => {
    setLocalError('');
    try {
      if (!project.audio) throw new Error('请先分析歌曲。');
      const timingErrors = validateMvLyricTimingEvidence(project.lyricUnits);
      if (timingErrors.length) throw new Error(timingErrors.join('；'));
      const plan = solveMvSegmentation({
        sampleRate: project.audio.sampleRate,
        totalSamples: project.audio.totalSamples,
        lyricUnits: project.lyricUnits,
        cutPoints: project.audio.beatTimesUs.map((timeUs) => ({ timeUs, kind: 'beat' as const, confidence: project.audio?.bpmEvidence?.confidence || 0, sourceId: `local-beat-${timeUs}` })),
        targetDurationMs: 10_000,
      });
      invalidateFromSegmentation({ stage: 'segment-review', segmentPlan: plan });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const applyManualBpm = (value: number) => {
    if (!project.audio) return;
    if (!Number.isFinite(value) || value < 30 || value > 300) {
      setLocalError('人工确认 BPM 必须在 30–300 之间。');
      return;
    }
    const periodUs = 60_000_000 / value;
    const beatTimesUs: number[] = [];
    for (let timeUs = 0; timeUs <= project.audio.durationUs; timeUs = Math.round(timeUs + periodUs)) {
      beatTimesUs.push(timeUs);
      if (beatTimesUs.length >= 20_000) break;
    }
    invalidateFromSegmentation({
      stage: 'segment-review',
      audio: { ...project.audio, bpmEvidence: { bpm: value, confidence: 1, verified: true, source: 'manual' }, beatTimesUs },
      segmentPlan: undefined,
      lyricWarnings: [...project.lyricWarnings.filter((warning) => !warning.startsWith('人工 BPM')), `人工 BPM 已确认：${value.toFixed(2)}。节拍相位从 0 秒建立，仍需用切点试听验收。`],
    });
    setManualBpm(String(value));
    setLocalError('');
  };

  const confirmSegments = async () => {
    try { assertProjectInputsCurrent(); } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); return; }
    if (!project.segmentPlan) return;
    const timingErrors = validateMvLyricTimingEvidence(project.lyricUnits);
    if (timingErrors.length) {
      setLocalError(timingErrors.join('；'));
      return;
    }
    const errors = validateMvSegmentationPlan(project.segmentPlan, project.lyricUnits);
    if (errors.length) {
      setLocalError(errors.join('；'));
      return;
    }
    const planDigest = await sha256Hex(JSON.stringify({
      sampleRate: project.segmentPlan.sampleRate,
      totalSamples: project.segmentPlan.totalSamples,
      segments: project.segmentPlan.segments.map((segment) => [segment.startSample, segment.endSample, segment.lyricUnitIds]),
      lyricTimingEvidence: project.lyricUnits.map((unit) => [unit.id, unit.startUs, unit.endUs, unit.timingSource, unit.timingConfidence, unit.timingBoundaryConfirmations]),
    }));
    patchProject({
      stage: 'brief-review',
      segmentConfirmation: {
        schema: 't8-mv-segmentation-confirmation-v1',
        projectRevision: project.revision,
        planDigest,
        confirmedAt: Date.now(),
      },
    });
    setActiveStage('brief-review');
  };

  const selectLlmProvider = (value: string) => {
    if (value === 'seedance-nz') {
      updateCreativeSetting({ llmApiSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: MV_DEFAULT_LLM_MODEL });
      return;
    }
    if (value === 'zhenzhen') {
      updateCreativeSetting({ llmApiSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', model: DEFAULT_ZHENZHEN_MODEL });
      return;
    }
    const provider = llmAdvancedProviders.find((item) => item.id === value);
    if (!provider) return;
    updateCreativeSetting({
      llmApiSource: 'zhenzhen',
      providerSource: provider.protocol,
      providerId: provider.id,
      providerModel: advancedProviderModelOptions(provider, 'llm')[0] || '',
      mvExternalVisionConfirmed: false,
    });
  };

  const buildMvLlmRequestBody = (messages: LlmMessage[], temperature: number, maxTokens: number) => (
    isExternal && providerSelection.provider
      ? buildGenerateExternalLlmRequestBody({
        providerId: providerSelection.provider.id,
        providerModel: activeModel,
        model: activeModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        requestProfile: 'mv-music-master',
      })
      : buildGenerateLlmRequestBody({
        model: activeModel,
        source: isSeedanceNz ? 'seedance-nz' : 'zhenzhen',
        messages,
        temperature,
        max_tokens: maxTokens,
        requestProfile: 'mv-music-master',
      })
  );

  const callMvLlm = async (requestBody: ReturnType<typeof buildMvLlmRequestBody>, child: MvChildAttempt, signal?: AbortSignal) => {
    if (wantsExternal && !isExternal) throw new Error('保存的扩展 LLM 渠道不存在、未启用或不支持 Chat；不会静默切换渠道。');
    if (invalidLlmApiSource) throw new Error(`已保存的 LLM 渠道 ${rawLlmApiSource} 无效；不会静默切换到默认渠道。`);
    if (invalidLlmModel) throw new Error(`已保存的 LLM 模型 ${activeModel || '(空)'} 不属于当前渠道；不会静默切换到默认模型。`);
    if (!activeModel) throw new Error('当前 LLM 渠道没有可用模型。');
    if (child.priorSubmission) throw new Error('该 LLM 提交键已有上游任务账本，但同步响应无法按 taskId 恢复；禁止重复 POST，请先核对 Provider。');
    await child.providerRequest({ provider: activeProvider, model: activeModel, requestDigest: await sha256Hex(JSON.stringify(requestBody)) });
    const result = isExternal && providerSelection.provider
      ? await generateExternalLlm(requestBody as Parameters<typeof generateExternalLlm>[0], { submissionKey: child.submissionKey, signal })
      : await generateLlm(requestBody as Parameters<typeof generateLlm>[0], { submissionKey: child.submissionKey, signal });
    if (signal?.aborted) throw new MvRecoverableTaskError('父运行已停止；LLM 响应不再写入项目。', true);
    await child.providerResponse({ provider: activeProvider, model: activeModel, requestId: result.requestId, status: 'responded', usage: result.usage });
    const finish = String(result.finishReason || '').toLowerCase();
    if (result.truncated || ['length', 'max_tokens', 'content_length'].includes(finish)) {
      throw new Error('LLM 返回被截断；当前结果不会被采用，请只续写缺失批次。');
    }
    if (!result.content.trim()) throw new Error('LLM 没有返回内容。');
    return result;
  };

  const generateVisualBible = async (reporter: RunNodeLifecycleReporter, forceNew = false) => {
    setLocalError('');
    setRunning(true);
    let activeGuard: NonNullable<NonNullable<MvProjectState['llmSubmissionGuards']>['visual-bible']> | undefined;
    let providerDispatchUnresolved = false;
    let working: MvProjectState = project;
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      if (!project.segmentConfirmation || !project.segmentPlan) throw new Error('请先确认合法分段。');
      if (managedIdentityImages.length < 1) throw new Error('请先分析并物化至少 1 张人设身份图。');
      if (managedStyleImages.length < 1 && !creativeBrief.styleDescription.trim()) throw new Error('请先分析并物化风格参考图，或填写明确的纯文字风格。');
      const visionKnown = (isSeedanceNz && VERIFIED_SEEDANCE_NZ_MV_VISION_MODELS.has(activeModel))
        || (!isExternal && !isSeedanceNz && !!LLM_MODELS.find((model) => model.id === activeModel)?.vision)
        || (isExternal && d.mvExternalVisionConfirmed === true);
      if (!visionKnown) throw new Error('当前扩展 LLM 未声明图像理解能力，无法真实读取人设/风格图；不会仅凭文件名猜测。');
      const identityContentEvidence = managedIdentityImages.map(({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }) => ({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }));
      const styleContentEvidence = managedStyleImages.map(({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }) => ({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }));
      const temperature = creativeBrief.creativity === 'conservative' ? 0.25 : creativeBrief.creativity === 'creative' ? 1.05 : 0.65;
      const bibleRevision = (project.bibleCandidates?.length || 0) + 1;
      const previousGuard = project.llmSubmissionGuards?.['visual-bible'];
      if (!forceNew && previousGuard && ['submitting', 'ambiguous'].includes(previousGuard.status)) {
        throw new Error('上一轮视觉圣经 LLM 提交存在未决响应，禁止自动重复 POST。请先核对 Provider 任务/账单，再显式新建修订。');
      }
      const guardRevision = (previousGuard?.revision || 0) + 1;
      const canReuseCompletedBatches = (forceNew || previousGuard?.status === 'failed')
        && !!previousGuard
        && ['submitting', 'ambiguous', 'failed'].includes(previousGuard.status);
      type PreparedBibleRequest = { index: number; phase: 'core' | 'arc'; segments: MvPromptSegmentInput[]; messages: LlmMessage[]; request: ReturnType<typeof buildMvLlmRequestBody>; requestDigest: string; maxTokens: number };
      const songSemanticOutline = (() => {
        const budget = 6_000;
        const perSegment = Math.max(24, Math.floor((budget - 80) / Math.max(1, promptSegments.length)));
        return promptSegments.map((segment) => {
          const lyric = segment.lyricsExact.replace(/\s+/gu, ' ').trim();
          const excerpt = lyric.length > perSegment ? `${lyric.slice(0, Math.max(1, perSegment - 1))}…` : lyric;
          return `${segment.ordinal}. ${segment.segmentId}: ${excerpt}`;
        }).join('\n').slice(0, budget);
      })();
      const prepareBibleRequest = async (phase: 'core' | 'arc', segments: MvPromptSegmentInput[], index: number, lockedGlobal?: MvVisualBible): Promise<PreparedBibleRequest> => {
        const messages = buildMvVisualBibleMessages({
          brief: creativeBrief,
          segments,
          identityReferences: managedIdentityImages.map((image, imageIndex) => `<Subject ${imageIndex + 1}> ${image.label || '人设身份图'}`),
          styleReferences: managedStyleImages.map((image, imageIndex) => `<Style ${imageIndex + 1}> ${image.label || '风格参考图'}`),
          lockedGlobal,
        }) as LlmMessage[];
        const last = messages.at(-1);
        if (!last) throw new Error('视觉圣经请求为空。');
        if (phase === 'core') last.content = [
          { type: 'text', text: `${String(last.content)}\n\n全曲有界语义提要（覆盖全歌，仅用于全局主题/母题，不要求本批输出 segmentArc）：\n${songSemanticOutline}` },
          ...managedIdentityImages.map((image) => ({ type: 'image_url' as const, image_url: { url: image.url } })),
          ...managedStyleImages.map((image) => ({ type: 'image_url' as const, image_url: { url: image.url } })),
        ];
        const maxTokens = phase === 'core' ? 12_000 : 16_000;
        const request = buildMvLlmRequestBody(messages, temperature, maxTokens);
        return { index, phase, segments, messages, request, requestDigest: await sha256Hex(JSON.stringify(request)), maxTokens };
      };
      const corePrepared = await prepareBibleRequest('core', [], 0);
      const buildBiblePaidTask = (prepared: PreparedBibleRequest) => buildPaidApprovalTask(
        prepared.phase === 'core'
          ? 'visual-bible:global-core'
          : `visual-bible:arc:${prepared.segments[0].segmentId}-${prepared.segments.at(-1)?.segmentId}`,
        activeProvider,
        activeModel,
        prepared.request,
        prepared.phase === 'core'
          ? { audioSha256: project.audio?.sha256, segmentPlanDigest: project.segmentConfirmation!.planDigest, identityContentEvidence, styleContentEvidence, brief: creativeBrief }
          : { coreDigest: corePrepared.requestDigest, audioSha256: project.audio?.sha256, segmentPlanDigest: project.segmentConfirmation!.planDigest, segmentIds: prepared.segments.map((segment) => segment.segmentId), lyricsDigest: textFingerprint(prepared.segments.map((segment) => segment.lyricsExact).join('\n')) },
      );
      const reusableCompleted = async (requestDigest: string) => {
        if (!canReuseCompletedBatches) return undefined;
        const completed = previousGuard?.completedVisualBibleBatches?.find((item) => item.requestDigest === requestDigest);
        if (!completed) return undefined;
        const asset = await getProjectAsset(completed.assetId).catch(() => undefined);
        return asset?.availability === 'available' && asset.contentHash === completed.contentHash ? completed : undefined;
      };
      const reusedCore = await reusableCompleted(corePrepared.requestDigest);
      const initialDigests = [corePrepared.requestDigest];
      activeGuard = {
        schema: 't8-mv-llm-submission-guard-v1', operation: 'visual-bible',
        requestSetDigest: await sha256Hex(JSON.stringify({ operation: 'visual-bible', requestDigests: initialDigests })),
        requestDigests: initialDigests, revision: guardRevision, status: 'submitting',
        completedVisualBibleBatches: reusedCore ? [reusedCore] : [], updatedAt: Date.now(),
      };
      working = commitProjectFrom(project, { llmSubmissionGuards: { ...(project.llmSubmissionGuards || {}), 'visual-bible': activeGuard } });
      const executeBibleRequest = async (prepared: PreparedBibleRequest, paidReceipt?: MvPaidApprovalReceipt): Promise<MvVisualBible> => {
        assertMvPollingContinues(pollingControlRef.current, reporter.signal);
        const guardBeforeRequest = activeGuard;
        if (!guardBeforeRequest) throw new Error('视觉圣经防重状态缺失。');
        const completed = guardBeforeRequest.completedVisualBibleBatches?.find((item) => item.requestDigest === prepared.requestDigest);
        if (completed) return validateMvVisualBible(completed.bible, prepared.segments.map((segment) => segment.segmentId));
        if (!paidReceipt) throw new Error('视觉圣经存在未完成请求，但本次没有有效的精确计费授权。');
        const paidTask = await buildBiblePaidTask(prepared);
        const paidTaskDigest = await sha256Hex(JSON.stringify(paidTask));
        await assertPaidReceiptCoversTask(paidReceipt, paidTask);
        const child = await createMvChildAttempt(reporter, {
          provider: activeProvider,
          model: activeModel,
          jobId: `bible-r${bibleRevision}-${prepared.phase}-${prepared.index + 1}`,
          jobKind: prepared.phase === 'core' ? 'mv-visual-bible-core' : 'mv-visual-bible-arc-batch',
          submissionKey: `t8-mv-bible-${prepared.phase}-${paidTaskDigest.slice(0, 30)}-r${bibleRevision}-s${guardRevision}`,
          approvalReceipt: paidReceipt,
          approvalTask: paidTask,
        });
        try {
          providerDispatchUnresolved = true;
          const result = await callMvLlm(prepared.request, child, reporter.signal);
          const biblePart = validateMvVisualBible(parseMvStructuredJson(result.content), prepared.segments.map((segment) => segment.segmentId));
          const partText = JSON.stringify(biblePart, null, 2);
          const partHash = await sha256Hex(partText);
          const [partAsset] = await child.output({ assets: [{ kind: 'text', text: partText, filename: `mv-bible-r${bibleRevision}-${prepared.phase}-${prepared.index + 1}.json`, mimeType: 'application/json', metadata: { contentHash: partHash, phase: prepared.phase, segmentIds: prepared.segments.map((segment) => segment.segmentId) } }] });
          if (!partAsset?.id || partAsset.availability !== 'available' || partAsset.contentHash !== partHash) throw new Error(`视觉圣经 ${prepared.phase} 第 ${prepared.index + 1} 批未能持久化。`);
          await child.succeed({ assetId: partAsset.id, contentHash: partAsset.contentHash, segmentIds: prepared.segments.map((segment) => segment.segmentId) });
          activeGuard = {
            ...guardBeforeRequest,
            completedVisualBibleBatches: [
              ...(guardBeforeRequest.completedVisualBibleBatches || []).filter((item) => item.requestDigest !== prepared.requestDigest),
              { requestDigest: prepared.requestDigest, segmentIds: prepared.segments.map((segment) => segment.segmentId), assetId: partAsset.id, contentHash: partAsset.contentHash, bible: biblePart },
            ],
            updatedAt: Date.now(),
          };
          working = commitLlmSubmissionGuard(working, activeGuard);
          providerDispatchUnresolved = false;
          return biblePart;
        } catch (error) {
          await child.fail(error).catch(() => undefined);
          throw error;
        }
      };
      const coreReceipt = reusedCore ? undefined : await assertPaidOperationApproved('视觉圣经全局核心生成', [await buildBiblePaidTask(corePrepared)]);
      const core = await executeBibleRequest(corePrepared, coreReceipt);
      const arcBatches = buildMvPromptBatches(promptSegments, { maxSegments: 6, maxLyricChars: 6000 });
      const arcPrepared = await Promise.all(arcBatches.map((segments, index) => prepareBibleRequest('arc', segments, index, core)));
      const reusableArcParts = (await Promise.all(arcPrepared.map((prepared) => reusableCompleted(prepared.requestDigest)))).filter(Boolean) as NonNullable<NonNullable<NonNullable<MvProjectState['llmSubmissionGuards']>['visual-bible']>['completedVisualBibleBatches']>;
      activeGuard = {
        ...activeGuard,
        requestDigests: [corePrepared.requestDigest, ...arcPrepared.map((item) => item.requestDigest)],
        requestSetDigest: await sha256Hex(JSON.stringify({ operation: 'visual-bible', requestDigests: [corePrepared.requestDigest, ...arcPrepared.map((item) => item.requestDigest)] })),
        completedVisualBibleBatches: [
          ...(activeGuard.completedVisualBibleBatches || []),
          ...reusableArcParts.filter((item) => !(activeGuard!.completedVisualBibleBatches || []).some((saved) => saved.requestDigest === item.requestDigest)),
        ],
        updatedAt: Date.now(),
      };
      working = commitLlmSubmissionGuard(working, activeGuard);
      const pendingArc = arcPrepared.filter((prepared) => !activeGuard!.completedVisualBibleBatches?.some((item) => item.requestDigest === prepared.requestDigest));
      const arcReceipt = pendingArc.length ? await assertPaidOperationApproved('视觉圣经分段弧线生成', await Promise.all(pendingArc.map(buildBiblePaidTask))) : undefined;
      const arcParts: MvVisualBible[] = [];
      for (const prepared of arcPrepared) {
        const part = await executeBibleRequest(prepared, arcReceipt);
        for (const key of ['title', 'visualThesis', 'identityRules', 'styleRules', 'continuityRules', 'motifs', 'forbidden'] as const) {
          if (JSON.stringify(part[key]) !== JSON.stringify(core[key])) throw new Error(`视觉圣经弧线批次 ${prepared.index + 1} 改写了锁定的全局字段 ${key}，已阻断。`);
        }
        arcParts.push(part);
      }
      const bible = validateMvVisualBible({
        ...core,
        segmentArc: arcParts.flatMap((item) => item.segmentArc),
      }, promptSegments.map((segment) => segment.segmentId));
      const serializedBible = JSON.stringify(bible, null, 2);
      const bibleHash = await sha256Hex(serializedBible);
      const id = `bible-${bibleHash.slice(0, 16)}`;
      const mergeChild = await createMvChildAttempt(reporter, {
        provider: 'local-host-artifact',
        model: 'json',
        jobId: `bible-r${bibleRevision}-merged`,
        jobKind: 'mv-visual-bible-merge',
        submissionKey: `t8-mv-bible-merge-${bibleHash.slice(0, 40)}`,
      });
      await mergeChild.providerRequest({ provider: 'local-host-artifact', model: 'json', contentHash: bibleHash, batchCount: arcParts.length + 1 });
      await mergeChild.providerResponse({ provider: 'local-host-artifact', model: 'json', status: 'succeeded' });
      const bibleAssets = await mergeChild.output({ assets: [{ kind: 'text', text: serializedBible, filename: `${id}.json`, mimeType: 'application/json', metadata: { contentHash: bibleHash, candidateId: id, batchCount: arcParts.length + 1 } }] });
      const bibleAsset = bibleAssets[0];
      if (!bibleAsset?.id || bibleAsset.availability !== 'available' || bibleAsset.contentHash !== bibleHash) throw new Error('视觉圣经未能持久化为项目资产。');
      await mergeChild.succeed({ candidateId: id, assetId: bibleAsset.id, contentHash: bibleAsset.contentHash, batchCount: arcParts.length + 1 });
      const candidates = [...(project.bibleCandidates || [])];
      if (!candidates.some((candidate) => candidate.id === id)) {
        candidates.push({
          schema: 't8-mv-bible-candidate-v1',
          id,
          revision: candidates.length + 1,
          provider: activeProvider,
          model: activeModel,
          createdAt: Date.now(),
          assetId: bibleAsset.id,
          contentHash: bibleAsset.contentHash,
          bible,
        });
      }
      const succeededGuard: NonNullable<NonNullable<MvProjectState['llmSubmissionGuards']>['visual-bible']> = { ...activeGuard!, status: 'succeeded', updatedAt: Date.now(), error: undefined };
      const next = commitProjectFrom(working, {
        stage: 'prompt-review',
        bibleCandidates: candidates,
        acceptedBibleId: project.acceptedBibleId,
        llmSubmissionGuards: { ...(working.llmSubmissionGuards || {}), 'visual-bible': succeededGuard },
        approvals: arcReceipt || coreReceipt ? { ...approvals, lastPaidReceipt: arcReceipt || coreReceipt, updatedAt: (arcReceipt || coreReceipt)!.approvedAt } : approvals,
      });
      update({ status: 'success', error: '', mvProject: next });
      setActiveStage('prompt-review');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const guardedProject = activeGuard
        ? commitLlmSubmissionGuard(working, { ...activeGuard, status: providerDispatchUnresolved ? 'ambiguous' : 'failed', updatedAt: Date.now(), error: message })
        : undefined;
      setLocalError(message);
      update({ status: 'error', error: message, ...(guardedProject ? { mvProject: guardedProject } : {}) });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const acceptBible = (candidateId: string) => {
    const candidate = (project.bibleCandidates || []).find((item) => item.id === candidateId);
    if (!candidate?.contentHash || !candidate.assetId) return;
    if (project.acceptedBibleId === candidateId) return;
    const scope = 'visual-bible';
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    const review = project.reviewReceipts?.[candidate.id];
    if (!review || review.schema !== 't8-mv-candidate-review-v2' || review.scope !== scope || review.assetId !== candidate.assetId || review.contentHash !== candidate.contentHash || review.evidenceDigest !== evidenceDigest) {
      setLocalError('请先展开并完整审阅这版视觉圣经，再点击“标记已审阅”。');
      return;
    }
    patchProject({
      stage: 'prompt-review',
      acceptedBibleId: candidateId,
      reviewReceipts: { [candidate.id]: review },
      adoptionReceipts: { bible: { schema: 't8-mv-adoption-receipt-v2', projectRevision: project.revision + 1, scope, candidateId, contentHash: candidate.contentHash, assetId: candidate.assetId, evidenceDigest, reviewReceiptDigest: reviewReceiptDigest(review), adoptedAt: Date.now() } },
      promptCandidates: undefined, acceptedPromptIds: undefined, imageCandidates: undefined, acceptedImageIds: undefined, videoCandidates: undefined, acceptedVideoIds: undefined, finalComposition: undefined,
    }, { clearDeliveryOutputs: true });
    setActiveStage('prompt-review');
  };

  const generatePromptPacks = async (onlySegmentIds: string[] | undefined, reporter: RunNodeLifecycleReporter, forceNew = false) => {
    setLocalError('');
    setRunning(true);
    let activeGuard: NonNullable<NonNullable<MvProjectState['llmSubmissionGuards']>['prompt-packs']> | undefined;
    let providerDispatchUnresolved = false;
    let working: MvProjectState = project;
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      if (!acceptedBible) throw new Error('请先检查并采用一版全片视觉圣经。');
      const targets = onlySegmentIds?.length
        ? promptSegments.filter((segment) => onlySegmentIds.includes(segment.segmentId))
        : promptSegments.filter((segment) => !(project.promptCandidates?.[segment.segmentId] || []).length);
      if (!targets.length) throw new Error('当前没有缺失或选中的 Prompt 分段。');
      const batches = buildMvPromptBatches(targets);
      const previousGuard = project.llmSubmissionGuards?.['prompt-packs'];
      if (!forceNew && previousGuard && ['submitting', 'ambiguous'].includes(previousGuard.status)) {
        throw new Error('上一轮分段 Prompt LLM 提交存在未决响应，禁止自动重复 POST。请先核对 Provider 任务/账单，再显式新建修订。');
      }
      const guardRevision = (previousGuard?.revision || 0) + 1;
      activeGuard = { schema: 't8-mv-llm-submission-guard-v1', operation: 'prompt-packs', requestSetDigest: await sha256Hex(JSON.stringify({ operation: 'prompt-packs', requestDigests: [] })), requestDigests: [], revision: guardRevision, status: 'submitting', updatedAt: Date.now() };
      working = commitProjectFrom(project, {
        llmSubmissionGuards: { ...(project.llmSubmissionGuards || {}), 'prompt-packs': activeGuard },
        promptCandidates: Object.fromEntries(Object.entries(project.promptCandidates || {}).map(([key, value]) => [key, [...value]])),
      });
      let previousGeneratedHandoff = '';
      let lastPaidReceipt: MvPaidApprovalReceipt | undefined;
      for (const batch of batches) {
        const first = promptSegments.findIndex((segment) => segment.segmentId === batch[0].segmentId);
        const previousId = first > 0 ? promptSegments[first - 1].segmentId : '';
        const previousCandidates = previousId ? working.promptCandidates?.[previousId] || [] : [];
        const previousCandidate = previousCandidates.find((candidate) => candidate.id === working.acceptedPromptIds?.[previousId]) || previousCandidates.at(-1);
        const previousHandoff = previousGeneratedHandoff || previousCandidate?.pack.shots.at(-1)?.continuityOut || '';
        const nextIntent = acceptedBible.bible.segmentArc.find((arc) => arc.segmentId === promptSegments[first + batch.length]?.segmentId)?.intent;
        const batchMessages = buildMvSegmentBatchMessages({ bible: acceptedBible.bible, brief: creativeBrief, segments: batch, previousHandoff, nextIntent }) as LlmMessage[];
        const batchRevision = Math.max(0, ...batch.map((segment) => working.promptCandidates?.[segment.segmentId]?.length || 0)) + 1;
        const temperature = creativeBrief.creativity === 'creative' ? 0.95 : creativeBrief.creativity === 'conservative' ? 0.25 : 0.6;
        const request = buildMvLlmRequestBody(batchMessages, temperature, 32_000);
        const batchRequestDigest = await sha256Hex(JSON.stringify(request));
        activeGuard = {
          ...activeGuard,
          requestDigests: [...activeGuard.requestDigests, batchRequestDigest],
          requestSetDigest: await sha256Hex(JSON.stringify({ operation: 'prompt-packs', requestDigests: [...activeGuard.requestDigests, batchRequestDigest] })),
          updatedAt: Date.now(),
        };
        working = commitLlmSubmissionGuard(working, activeGuard);
        const paidTask = await buildPaidApprovalTask(
          `prompt:${batch[0].segmentId}-${batch.at(-1)?.segmentId}`, activeProvider, activeModel, request,
          { bibleContentHash: acceptedBible.contentHash, previousHandoff, segmentPlanDigest: project.segmentConfirmation?.planDigest, segmentIds: batch.map((segment) => segment.segmentId), lyricsDigest: textFingerprint(batch.map((segment) => segment.lyricsExact).join('\n')) },
        );
        const paidTaskDigest = await sha256Hex(JSON.stringify(paidTask));
        const paidReceipt = await assertPaidOperationApproved(`分段 Prompt 生成 ${batch[0].segmentId}–${batch.at(-1)?.segmentId}`, [paidTask]);
        await assertPaidReceiptCoversTask(paidReceipt, paidTask);
        lastPaidReceipt = paidReceipt;
        working = commitProjectFrom(working, { approvals: { ...approvals, lastPaidReceipt: paidReceipt, updatedAt: paidReceipt.approvedAt } });
        const child = await createMvChildAttempt(reporter, {
          provider: activeProvider,
          model: activeModel,
          jobId: `prompt-${batch[0].segmentId}-${batch.at(-1)?.segmentId}-r${batchRevision}`,
          jobKind: 'mv-prompt-batch',
          submissionKey: `t8-mv-prompt-${paidTaskDigest.slice(0, 32)}-r${batchRevision}-s${guardRevision}`,
          approvalReceipt: paidReceipt,
          approvalTask: paidTask,
        });
        let result;
        try {
          providerDispatchUnresolved = true;
          result = await callMvLlm(request, child, reporter.signal);
        } catch (error) {
          await child.fail(error);
          throw error;
        }
        const packs = validateMvPromptBatch(parseMvStructuredJson(result.content), batch);
        if (previousHandoff && packs[0]?.shots[0]?.continuityIn.replace(/\s+/gu, ' ').trim() !== previousHandoff.replace(/\s+/gu, ' ').trim()) throw new Error(`${batch[0].segmentId} 的首镜 continuityIn 未精确继承上一批 continuityOut。`);
        critiqueMvPromptPacks(batch, packs);
        const serializedPacks = JSON.stringify({ schema: 't8-mv-segment-prompt-pack-batch-v1', segments: packs }, null, 2);
        const packsHash = await sha256Hex(serializedPacks);
        const packAssets = await child.output({ assets: [{ kind: 'text', text: serializedPacks, filename: `mv-prompt-${batch[0].segmentId}-${batch.at(-1)?.segmentId}.json`, mimeType: 'application/json', metadata: { contentHash: packsHash, segmentIds: packs.map((pack) => pack.segmentId) } }] });
        const packAsset = packAssets[0];
        if (!packAsset?.id || packAsset.availability !== 'available' || packAsset.contentHash !== packsHash) throw new Error('PromptPack 批次未能持久化为项目资产。');
        const promptCandidates = { ...(working.promptCandidates || {}) };
        for (const pack of packs) {
          const segment = promptSegments.find((item) => item.segmentId === pack.segmentId);
          if (!segment) throw new Error(`找不到 Prompt 分段 ${pack.segmentId}。`);
          const existing = [...(promptCandidates[pack.segmentId] || [])];
          const id = `prompt-${(await sha256Hex(`${pack.segmentId}\n${JSON.stringify(pack)}`)).slice(0, 16)}`;
          if (!existing.some((candidate) => candidate.id === id)) {
            existing.push({
              schema: 't8-mv-prompt-candidate-v1',
              id,
              revision: existing.length + 1,
            provider: activeProvider,
            model: activeModel,
            createdAt: Date.now(),
            assetId: packAsset.id,
            contentHash: packAsset.contentHash,
              pack,
              h3Prompt: '',
              seedancePrompt: compileMvSeedancePrompt({ segment, pack, identityDescription: '使用已连接的人设图保持同一人物身份、脸部、发型与主服装。' }),
            });
          }
          promptCandidates[pack.segmentId] = existing;
        }
        working = commitProjectFrom(working, { stage: 'prompt-review', promptCandidates });
        await child.succeed({ segmentIds: batch.map((segment) => segment.segmentId) });
        providerDispatchUnresolved = false;
        previousGeneratedHandoff = packs.at(-1)?.shots.at(-1)?.continuityOut || previousHandoff;
      }
      working = commitLlmSubmissionGuard(working, { ...activeGuard, status: 'succeeded', updatedAt: Date.now(), error: undefined });
      if (lastPaidReceipt) working = commitProjectFrom(working, { approvals: { ...approvals, lastPaidReceipt, updatedAt: lastPaidReceipt.approvedAt } });
      update({ status: 'success', error: '', mvProject: working });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (activeGuard) {
        working = commitLlmSubmissionGuard(working, { ...activeGuard, status: providerDispatchUnresolved ? 'ambiguous' : 'failed', updatedAt: Date.now(), error: message });
      }
      setLocalError(message);
      update({ status: 'error', error: message, ...(activeGuard ? { mvProject: working } : {}) });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const acceptPromptCandidate = (segmentId: string, candidateId: string) => {
    const selectedCandidate = (project.promptCandidates?.[segmentId] || []).find((candidate) => candidate.id === candidateId);
    if (!selectedCandidate?.contentHash || !selectedCandidate.assetId) return;
    if (project.acceptedPromptIds?.[segmentId] === candidateId) return;
    const segmentIndex = promptSegments.findIndex((segment) => segment.segmentId === segmentId);
    const dependentSegmentIds = new Set(promptSegments.slice(Math.max(0, segmentIndex)).map((segment) => segment.segmentId));
    const downstreamSegmentIds = new Set(promptSegments.slice(Math.max(0, segmentIndex + 1)).map((segment) => segment.segmentId));
    const acceptedPromptIds = Object.fromEntries(Object.entries(project.acceptedPromptIds || {}).filter(([id]) => !downstreamSegmentIds.has(id)));
    acceptedPromptIds[segmentId] = candidateId;
    const promptCandidates = Object.fromEntries(Object.entries(project.promptCandidates || {}).filter(([id]) => !downstreamSegmentIds.has(id)));
    const affectedShotIds = new Set(promptSegments.filter((segment) => dependentSegmentIds.has(segment.segmentId)).flatMap((segment) => segment.shots.map((shot) => shot.shotId)));
    const acceptedImageIds = Object.fromEntries(Object.entries(project.acceptedImageIds || {}).filter(([shotId]) => !affectedShotIds.has(shotId)));
    const imageCandidates = Object.fromEntries(Object.entries(project.imageCandidates || {}).filter(([shotId]) => !affectedShotIds.has(shotId)));
    const videoCandidates = Object.fromEntries(Object.entries(project.videoCandidates || {}).filter(([id]) => !dependentSegmentIds.has(id)));
    const acceptedVideoIds = Object.fromEntries(Object.entries(project.acceptedVideoIds || {}).filter(([id]) => !dependentSegmentIds.has(id)));
    const scope = `prompt:${segmentId}`;
    const evidenceDigest = candidateEvidenceDigest(scope, selectedCandidate);
    const review = project.reviewReceipts?.[selectedCandidate.id];
    if (!review || review.schema !== 't8-mv-candidate-review-v2' || review.scope !== scope || review.assetId !== selectedCandidate.assetId || review.contentHash !== selectedCandidate.contentHash || review.evidenceDigest !== evidenceDigest) {
      setLocalError('请先完整审阅这版 PromptPack，再点击“标记已审阅”。');
      return;
    }
    const adoptionReceipts = Object.fromEntries(Object.entries(project.adoptionReceipts || {}).filter(([key]) => {
      if (key === scope) return false;
      if (key.startsWith('prompt:')) return !downstreamSegmentIds.has(key.slice('prompt:'.length));
      if (key.startsWith('video:')) return !dependentSegmentIds.has(key.slice('video:'.length));
      if (key.startsWith('image:')) return !affectedShotIds.has(key.slice('image:'.length));
      return true;
    }));
    adoptionReceipts[scope] = { schema: 't8-mv-adoption-receipt-v2', projectRevision: project.revision + 1, scope, candidateId, contentHash: selectedCandidate.contentHash, assetId: selectedCandidate.assetId, evidenceDigest, reviewReceiptDigest: reviewReceiptDigest(review), adoptedAt: Date.now() };
    const reviewReceipts = Object.fromEntries(Object.entries(project.reviewReceipts || {}).filter(([key, receipt]) => {
      if (key === selectedCandidate.id) return true;
      if (receipt.scope.startsWith('prompt:')) return !downstreamSegmentIds.has(receipt.scope.slice('prompt:'.length));
      if (receipt.scope.startsWith('video:')) return !dependentSegmentIds.has(receipt.scope.slice('video:'.length));
      if (receipt.scope.startsWith('image:')) return !affectedShotIds.has(receipt.scope.slice('image:'.length));
      return true;
    }));
    patchProject({ stage: 'prompt-review', promptCandidates, acceptedPromptIds, adoptionReceipts, reviewReceipts, imageCandidates, acceptedImageIds, videoCandidates, acceptedVideoIds, finalComposition: undefined }, { clearDeliveryOutputs: true });
    setActiveStage('prompt-review');
  };

  const finishPromptReview = () => {
    if (acceptedPromptCount !== promptSegments.length || promptSegments.length === 0) {
      setLocalError('每个分段都必须采用一版 Prompt 后才能进入分镜图片阶段。');
      return;
    }
    if (invalidVideoFamily || invalidVideoProvider || invalidVideoModel || invalidVideoResolution) {
      setLocalError(`已保存的视频选择无效（family=${rawVideoFamily || '(缺省)'}，provider=${rawVideoProvider || '(缺省)'}，model=${rawVideoModel || '(缺省)'}，resolution=${rawVideoResolution || '(缺省)'}）；不会静默改用其他计费配置。`);
      return;
    }
    if (videoFamily === 'hailuo' && videoModel === 'hailuo-h3-multi' && managedIdentityImages.length !== 1) {
      setLocalError(`H3 Multi full-reference 当前要求恰好 1 张已物化人设原图，当前为 ${managedIdentityImages.length} 张；不会静默省略或猜测主身份。`);
      return;
    }
    const incompatible = promptSegments.find((segment) => segment.shotCount > videoImageReferenceLimit);
    if (incompatible) {
      setLocalError(`${videoModel} 最多绑定 ${videoImageReferenceLimit} 张分镜参考，但第 ${incompatible.ordinal} 段规划了 ${incompatible.shotCount} 个镜头。请回到导演设置减少镜头数或改用支持更多参考图的模型，禁止先付费出图。`);
      return;
    }
    try {
      critiqueMvPromptPacks(promptSegments, promptSegments.map((segment) => {
        const candidate = acceptedPromptForSegment(segment.segmentId);
        if (!candidate) throw new Error(`${segment.segmentId} 缺少已采用 PromptPack。`);
        return candidate.pack;
      }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      return;
    }
    patchProject({ stage: 'image-review' });
    setActiveStage('image-review');
  };

  const replaceImageCandidate = (base: MvProjectState, candidate: MvImageCandidate, extra: Partial<MvProjectState> = {}): MvProjectState => {
    const imageCandidates = Object.fromEntries(Object.entries(base.imageCandidates || {}).map(([key, values]) => [key, [...values]]));
    const list = [...(imageCandidates[candidate.shotId] || [])];
    const index = list.findIndex((item) => item.id === candidate.id);
    if (index >= 0) list[index] = candidate;
    else list.push(candidate);
    imageCandidates[candidate.shotId] = list;
    return commitProjectFrom(base, { stage: 'image-review', imageCandidates, ...extra });
  };

  const prepareImageRequest = async (
    task: MvShotTask,
    reporter: RunNodeLifecycleReporter,
    suppliedReferenceEvidence?: Awaited<ReturnType<typeof readMvMaterialEvidence>>,
  ) => {
    if (invalidImageProvider || invalidImageModel) throw new Error(`已保存的图像选择无效（provider=${rawImageProvider || '(缺省)'}，model=${rawImageModel || '(缺省)'}）；不会静默改用其他计费配置。`);
    const referenceMaterials = [...managedIdentityImages, ...managedStyleImages];
    const referenceLimit = imageModel === 'gpt-image-2-fal' ? 5
      : imageModel === 'zhenzhen-image-g-v2-lowprice' ? 16
        : imageModel === 'zhenzhen-image-g2-i2i' ? 10 : 9;
    if (referenceMaterials.length > referenceLimit) throw new Error(`${imageModel} 最多接收 ${referenceLimit} 张参考图，当前连接 ${referenceMaterials.length} 张；不会静默丢弃，请减少连接或换模型。`);
    const referenceEvidence = suppliedReferenceEvidence || referenceMaterials.map(({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }) => ({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }));
    const references = referenceMaterials.map((item) => item.url);
    const positiveVisualSources = [
      task.shot.imagePrompt,
      `构图：${task.shot.composition}。动作：${task.shot.action}。镜头：${task.shot.camera}。光线：${task.shot.lighting}。`,
      acceptedBible ? `全片视觉规则：${acceptedBible.bible.styleRules.join('；')}。身份规则：${acceptedBible.bible.identityRules.join('；')}。` : '',
    ].filter(Boolean);
    assertMvPositiveVisualTextSafe(positiveVisualSources.join('\n'), task.segment.lyricsExact, task.shot.shotId);
    const neutralPrompt = [
      ...positiveVisualSources,
      managedIdentityImages.length ? `参考图角色映射：图片 1–${managedIdentityImages.length} 仅用于锁定同一人物的脸、发型、体型与主服装，不复制其中的文字和剧情。` : '',
      managedStyleImages.length ? `参考图角色映射：图片 ${managedIdentityImages.length + 1}–${managedIdentityImages.length + managedStyleImages.length} 仅用于色彩、材质、光影与镜头质感，不把图中人物替换为主体。` : '',
      `画幅 ${creativeBrief.aspectRatio}。此图是 ${task.shot.shotId} 的电影分镜定稿，不要添加歌词、字幕、水印或界面。`,
    ].filter(Boolean).join('\n');
    const prompt = imageProvider === 'seedance-nz' ? `${neutralPrompt}\n避免：${task.shot.negativePrompt}` : neutralPrompt;
    const promptDigest = await sha256Hex(prompt);
    const falSize = ({
      '16:9': 'landscape_16_9',
      '9:16': 'portrait_16_9',
      '1:1': 'square_hd',
      '4:3': 'landscape_4_3',
      '3:4': 'portrait_4_3',
      '21:9': 'custom',
    } as const)[creativeBrief.aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9'];
    if (imageModel === 'gpt-image-2-fal' && !falSize) throw new Error(`gpt-image-2-fal 不支持画幅 ${creativeBrief.aspectRatio}，不会静默改成 16:9。`);
    const providerRequest = imageProvider === 'seedance-nz'
      ? {
        prompt,
        images: references,
        model: imageModel,
        resolution: imageModel === 'zhenzhen-image-g-v2-lowprice' ? '2k' : '1k',
        ratio: imageModel === 'zhenzhen-image-g-v2-lowprice' ? undefined : creativeBrief.aspectRatio,
        size: imageModel === 'zhenzhen-image-g-v2-lowprice' ? creativeBrief.aspectRatio : undefined,
        n: 1,
        negative_prompt: task.shot.negativePrompt,
      }
      : imageModel === 'gpt-image-2-fal'
        ? {
          apiModel: imageModel,
          prompt: `${prompt}\n避免：${task.shot.negativePrompt}`,
          images: references,
          n: 1,
          format: 'png',
          sync: false,
          size: falSize,
          customW: falSize === 'custom' ? 2016 : undefined,
          customH: falSize === 'custom' ? 864 : undefined,
          quality: 'high',
        }
        : {
          model: 'gpt-image-2',
          apiModel: imageModel,
          paramKind: 'gpt-size',
          prompt: `${prompt}\n避免：${task.shot.negativePrompt}`,
          aspect_ratio: creativeBrief.aspectRatio,
          image_size: imageModel === 'gpt-image-2-4K' ? '4K' : '2K',
          images: references,
          n: 1,
          quality: 'high',
          response_format: 'url',
          output_format: 'png',
        };
    const requestSnapshot: Record<string, any> = {
      schema: 't8-mv-image-request-v1', projectId: reporter.runContext?.projectId, canvasId: reporter.runContext?.canvasId, provider: imageProvider, model: imageModel,
      providerRequest,
      references: referenceMaterials.map((item, index) => ({
        ...referenceEvidence[index],
        id: item.id,
        role: index < managedIdentityImages.length ? 'identity' : 'style',
      })),
      outputCount: 1,
    };
    const requestDigest = await sha256Hex(JSON.stringify(providerRequest));
    requestSnapshot.requestBodySha256 = requestDigest;
    return { referenceMaterials, references, prompt, promptDigest, providerRequest, requestSnapshot, requestDigest };
  };

  const generateImageCandidate = async (task: MvShotTask, base: MvProjectState, reporter: RunNodeLifecycleReporter, paidReceipt: MvPaidApprovalReceipt, paidTask: MvPaidApprovalTaskReceipt, forceNew = false, prepared?: Awaited<ReturnType<typeof prepareImageRequest>>): Promise<MvProjectState> => {
    const request = prepared || await prepareImageRequest(task, reporter);
    const { references, prompt, promptDigest, providerRequest, requestSnapshot, requestDigest } = request;
    let child: MvChildAttempt | undefined;
    let candidate: MvImageCandidate | undefined;
    let working = base;
    let providerDispatchStarted = false;
    try {
      const existingCandidates = base.imageCandidates?.[task.shot.shotId] || [];
      if (!forceNew && existingCandidates.some(mvSubmissionRequiresManualResolution)) {
        throw new Error(`${task.shot.shotId} 存在无 taskId 的未决提交；为避免重复计费，必须先核对 Provider，再显式新建修订。`);
      }
      const resumable = !forceNew ? [...existingCandidates].reverse().find((item) => (
        ['submitted', 'polling', 'recoverable', 'interrupted', 'materializing'].includes(item.status)
        && !!item.taskId
        && item.provider === imageProvider
        && item.model === imageModel
        && item.requestDigest === requestDigest
      )) : undefined;
      const revision = resumable?.revision || existingCandidates.length + 1;
      const candidateId = resumable?.id || `image-${requestDigest.slice(0, 16)}-r${revision}`;
      await assertPaidReceiptCoversTask(paidReceipt, paidTask);
      const paidTaskDigest = await sha256Hex(JSON.stringify(paidTask));
      const submissionKey = resumable?.submissionKey || `t8-mv-image-${paidTaskDigest.slice(0, 40)}-r${revision}`;
      child = await createMvChildAttempt(reporter, {
        provider: imageProvider,
        model: imageModel,
        jobId: task.shot.shotId,
        jobKind: 'mv-storyboard-image',
        submissionKey,
        approvalReceipt: paidReceipt,
        approvalTask: paidTask,
      });
      const ledgerTaskId = child.priorSubmission?.upstreamTaskId || '';
      const ledgerRecovery = child.priorSubmission?.recovery || undefined;
      candidate = resumable ? {
        ...resumable,
        status: resumable.taskId ? 'polling' : 'submitting',
        completedAt: undefined,
        error: undefined,
      } : {
        schema: 't8-mv-image-candidate-v1',
        id: candidateId,
        shotId: task.shot.shotId,
        segmentId: task.segment.segmentId,
        revision,
        provider: imageProvider,
        model: imageModel,
        status: ledgerTaskId ? 'polling' : 'submitting',
        taskId: ledgerTaskId || undefined,
        taskEndpoint: typeof ledgerRecovery?.endpoint === 'string' ? ledgerRecovery.endpoint : undefined,
        submissionKey,
        createdAt: Date.now(),
      };
      candidate = { ...candidate, prompt, promptDigest, requestDigest, requestSnapshot };
      working = replaceImageCandidate(working, candidate);
      update({ mvProject: working });
      if (reporter.signal?.aborted) throw new MvRecoverableTaskError('父运行已停止；图像提交意图已保存，可用同一提交键恢复。', true);
      let submitted: { sync: boolean; taskId?: string; urls?: string[]; status?: string; progress?: string; requestId?: string; endpoint?: string };
      if (resumable?.taskId || ledgerTaskId) {
        submitted = { sync: false, taskId: resumable?.taskId || ledgerTaskId, endpoint: resumable?.taskEndpoint || (typeof ledgerRecovery?.endpoint === 'string' ? ledgerRecovery.endpoint : undefined), status: resumable?.status || 'polling' };
      } else {
        providerDispatchStarted = true;
        candidate = { ...candidate, dispatchStartedAt: Date.now() };
        working = replaceImageCandidate(working, candidate);
        update({ mvProject: working });
        await child.providerRequest({ provider: imageProvider, model: imageModel, candidateId, promptDigest, requestDigest, referenceCount: references.length });
        if (imageProvider === 'seedance-nz') {
        submitted = await submitSeedreamNz(providerRequest as any, { submissionKey: child.submissionKey, signal: reporter.signal });
        } else if (imageModel === 'gpt-image-2-fal') {
        const fal = await submitImageFal(providerRequest as any, { submissionKey: child.submissionKey, signal: reporter.signal });
        submitted = { ...fal, taskId: fal.requestId };
        } else {
        submitted = await submitImageAsync(providerRequest as any, { submissionKey: child.submissionKey, signal: reporter.signal });
        }
      }
      const submissionTrace = providerTrace(submitted);
      candidate = { ...candidate, status: 'submitted', taskId: submitted.taskId, taskEndpoint: submitted.endpoint, submissionTrace };
      working = replaceImageCandidate(working, candidate);
      await child.providerSubmitted({
        provider: imageProvider,
        model: imageModel,
        candidateId,
        requestDigest,
        upstreamTaskId: submitted.taskId,
        requestId: submitted.requestId,
        upstreamHttpStatus: (submitted as any).upstreamHttpStatus,
        transportHttpStatus: (submitted as any).transportHttpStatus,
        usage: (submitted as any).usage,
        resumed: !!resumable || !!ledgerTaskId,
        recovery: imageModel === 'gpt-image-2-fal'
          ? { version: 1, kind: 'image-fal', requestId: submitted.taskId, endpoint: submitted.endpoint, model: imageModel, pollIntervalMs: 3000, maxPolls: 1200 }
          : { version: 1, kind: imageProvider === 'seedance-nz' ? 'seedream-nz' : 'image', taskId: submitted.taskId, model: imageModel, pollIntervalMs: 3000, maxPolls: 1200 },
      });
      update({ mvProject: working });
      let urls = submitted.urls || [];
      let terminalResult: any = submitted;
      if (!submitted.sync) {
        if (!submitted.taskId) throw new Error('图像 Provider 未返回任务 ID，已阻断且不会重新提交。');
        candidate = { ...candidate, status: 'polling', taskId: submitted.taskId };
        working = replaceImageCandidate(working, candidate);
        update({ mvProject: working });
        const startedAt = Date.now();
        let pollCount = 0;
        let consecutiveQueryErrors = 0;
        while (Date.now() - startedAt < 60 * 60_000) {
          assertMvPollingContinues(pollingControlRef.current, reporter.signal);
          await sleep(3000, reporter.signal);
          assertMvPollingContinues(pollingControlRef.current, reporter.signal);
          pollCount += 1;
          let result: any;
          try {
            result = imageProvider === 'seedance-nz'
              ? await querySeedreamNz(submitted.taskId, { signal: reporter.signal })
              : imageModel === 'gpt-image-2-fal'
                ? await queryImageFal({ endpoint: submitted.endpoint, requestId: submitted.taskId }, { signal: reporter.signal })
                : await queryImageStatus(submitted.taskId, imageModel, { signal: reporter.signal });
            consecutiveQueryErrors = 0;
          } catch (error) {
            consecutiveQueryErrors += 1;
            if (consecutiveQueryErrors < 5) continue;
            throw new MvRecoverableTaskError(`图像任务 ${submitted.taskId} 连续查询失败，已保存 taskId，稍后继续查询：${error instanceof Error ? error.message : String(error)}`);
          }
          terminalResult = result;
          const status = String(result.status || '').toLowerCase();
          await child.providerPolling({ provider: imageProvider, model: imageModel, upstreamTaskId: submitted.taskId, pollCount, status, recovery: imageModel === 'gpt-image-2-fal' ? { version: 1, kind: 'image-fal', requestId: submitted.taskId, endpoint: submitted.endpoint, model: imageModel } : { version: 1, kind: imageProvider === 'seedance-nz' ? 'seedream-nz' : 'image', taskId: submitted.taskId, model: imageModel } });
          if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
            urls = result.urls || [];
            break;
          }
          if (['failed', 'failure', 'error', 'cancelled'].includes(status)) throw new Error(result.error || '分镜图片生成失败。');
        }
        if (!urls.length) throw new MvRecoverableTaskError(`图像任务 ${submitted.taskId} 在本地等待窗口内未结束，已保存 taskId；不会自动重新提交。`);
      }
      const outputUrl = String(urls[0] || '');
      if (!outputUrl) throw new Error('图像任务已结束但没有返回可用图片；不会自动重新提交。');
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      const terminalTrace = providerTrace(terminalResult);
      await child.providerResponse({ provider: imageProvider, model: imageModel, upstreamTaskId: submitted.taskId, status: String(terminalResult?.status || 'succeeded'), ...terminalTrace });
      candidate = { ...candidate, status: 'materializing' };
      working = replaceImageCandidate(working, candidate);
      update({ mvProject: working });
      const assets = await child.output({ assets: [{ kind: 'image', sourceUrl: outputUrl, filename: `${task.shot.shotId}.png`, metadata: { candidateId } }] });
      const asset = assets[0];
      if (!asset?.id || !asset.sourceUrl || asset.availability !== 'available' || !asset.contentHash) throw new Error('分镜图未能物化为可用的项目资产，禁止保存远程临时 URL。');
      const evidence = await validateImageArtifact(asset.sourceUrl, reporter.signal);
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      if (asset.contentHash !== evidence.contentHash) throw new Error('分镜图项目资产哈希与实际解码文件不一致。');
      candidate = { ...candidate, ...evidence, terminalTrace, status: 'succeeded', outputUrl: asset.sourceUrl, assetId: asset.id, contentHash: asset.contentHash, completedAt: Date.now(), error: undefined };
      const completed = replaceImageCandidate(working, candidate);
      await child.succeed({ candidateId, contentHash: evidence.contentHash });
      return completed;
    } catch (error) {
      const ambiguous = !!candidate && providerDispatchStarted && !candidate.taskId;
      const interruptedAfterTask = !!candidate?.taskId && (reporter.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError'));
      const recoverable = !!candidate && !ambiguous && (error instanceof MvRecoverableTaskError || interruptedAfterTask);
      if (candidate) {
        candidate = { ...candidate, status: ambiguous ? 'ambiguous' : recoverable ? ((error instanceof MvRecoverableTaskError && error.interrupted) || interruptedAfterTask ? 'interrupted' : 'recoverable') : 'failed', error: error instanceof Error ? error.message : String(error), completedAt: Date.now() };
        working = replaceImageCandidate(working, candidate);
        update({ mvProject: working });
      }
      if (ambiguous) await child?.interrupt(candidate?.error || '图像提交结果不明确', { candidateId: candidate?.id, ambiguousSubmission: true, automaticRetryForbidden: true });
      else if (recoverable) await child?.interrupt(candidate?.error || '图像任务可恢复', { candidateId: candidate?.id, upstreamTaskId: candidate?.taskId, mvRecovery: true });
      else await child?.fail(error, { candidateId: candidate?.id });
      throw error;
    }
  };

  const generateImages = async (onlyShotIds: string[] | undefined, reporter: RunNodeLifecycleReporter, forceNew = false) => {
    setLocalError('');
    setRunning(true);
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      if (!forceNew && !onlyShotIds?.length) {
        const ambiguousIds = shotTasks.filter((task) => (project.imageCandidates?.[task.shot.shotId] || []).some(mvSubmissionRequiresManualResolution)).map((task) => task.shot.shotId);
        if (ambiguousIds.length) throw new Error(`以下分镜提交结果不明确，批量补缺失不会自动重放：${ambiguousIds.join('、')}。请核对 Provider 后，在对应卡片明确新建修订。`);
      }
      const availableSucceededShots = new Set<string>();
      const availableAcceptedShots = new Set<string>();
      for (const task of shotTasks) {
        for (const candidate of (project.imageCandidates?.[task.shot.shotId] || []).filter((item) => item.status === 'succeeded' && item.assetId && item.contentHash)) {
          const asset = await getProjectAsset(candidate.assetId!).catch(() => undefined);
          if (asset?.availability === 'available' && asset.contentHash === candidate.contentHash) {
            availableSucceededShots.add(task.shot.shotId);
            if (project.acceptedImageIds?.[task.shot.shotId] === candidate.id) availableAcceptedShots.add(task.shot.shotId);
          }
        }
      }
      const targets = shotTasks.filter((task) => onlyShotIds?.length
        ? onlyShotIds.includes(task.shot.shotId)
        : !availableAcceptedShots.has(task.shot.shotId)
          && !availableSucceededShots.has(task.shot.shotId)
          && !(project.imageCandidates?.[task.shot.shotId] || []).some(mvSubmissionRequiresManualResolution));
      if (!targets.length) throw new Error('没有待生成的分镜镜头。');
      const referenceEvidence = [...managedIdentityImages, ...managedStyleImages].map(({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }) => ({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }));
      const preparedRequests = await Promise.all(targets.map((task) => prepareImageRequest(task, reporter, referenceEvidence)));
      const paidTasks = await Promise.all(targets.map((task, index) => buildPaidApprovalTask(
        task.shot.shotId,
        imageProvider,
        imageModel,
        preparedRequests[index].providerRequest,
        { requestDigest: preparedRequests[index].requestDigest, promptCandidateHash: task.candidate.contentHash, bibleContentHash: acceptedBible?.contentHash, references: preparedRequests[index].requestSnapshot.references },
      )));
      const paidReceipt = await assertPaidOperationApproved('分镜图片生成', paidTasks);
      let working: MvProjectState = { ...project, approvals: { ...approvals, lastPaidReceipt: paidReceipt, updatedAt: paidReceipt.approvedAt } };
      for (let index = 0; index < targets.length; index += 1) working = await generateImageCandidate(targets[index], working, reporter, paidReceipt, paidTasks[index], forceNew, preparedRequests[index]);
      update({ status: 'success', error: '', mvProject: working });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const markImageViewed = (shotId: string, candidateId: string) => {
    const candidate = (project.imageCandidates?.[shotId] || []).find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'succeeded' || !candidate.assetId || !candidate.contentHash) return;
    const scope = `image:${shotId}`;
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    const existing = project.reviewReceipts?.[candidateId];
    if (existing?.schema === 't8-mv-candidate-review-v2' && existing.scope === scope && existing.assetId === candidate.assetId && existing.contentHash === candidate.contentHash && existing.evidenceDigest === evidenceDigest) return;
    const viewedAt = Date.now();
    replaceImageCandidate(project, { ...candidate, viewedAt }, { reviewReceipts: { ...(project.reviewReceipts || {}), [candidateId]: { schema: 't8-mv-candidate-review-v2', projectRevision: project.revision + 1, scope, candidateId, contentHash: candidate.contentHash, assetId: candidate.assetId, evidenceDigest, medium: 'image', viewedAt } } });
  };

  const acceptImageCandidate = (shotId: string, candidateId: string) => {
    const candidate = (project.imageCandidates?.[shotId] || []).find((item) => item.id === candidateId);
    if (!candidate?.viewedAt || !candidate.contentHash || !candidate.outputUrl || !candidate.assetId) {
      setLocalError('必须先实际加载并查看这张图片，且通过文件解码与哈希校验后才能采用。');
      return;
    }
    const scope = `image:${shotId}`;
    const review = project.reviewReceipts?.[candidateId];
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    if (!review || review.schema !== 't8-mv-candidate-review-v2' || review.scope !== scope || review.assetId !== candidate.assetId || review.contentHash !== candidate.contentHash || review.evidenceDigest !== evidenceDigest) {
      setLocalError('当前图片缺少与本候选资产严格绑定的 ReviewReceipt，请重新打开大图查看后再采用。');
      return;
    }
    if (project.acceptedImageIds?.[shotId] === candidateId) return;
    const task = shotTasks.find((item) => item.shot.shotId === shotId);
    const segmentId = task?.segment.segmentId;
    const videoCandidates = { ...(project.videoCandidates || {}) };
    const acceptedVideoIds = { ...(project.acceptedVideoIds || {}) };
    if (segmentId) {
      delete videoCandidates[segmentId];
      delete acceptedVideoIds[segmentId];
    }
    const adoptionReceipts = { ...(project.adoptionReceipts || {}) };
    if (segmentId) delete adoptionReceipts[`video:${segmentId}`];
    adoptionReceipts[scope] = { schema: 't8-mv-adoption-receipt-v2', projectRevision: project.revision + 1, scope, candidateId, contentHash: candidate.contentHash, assetId: candidate.assetId, evidenceDigest, reviewReceiptDigest: reviewReceiptDigest(review), adoptedAt: Date.now() };
    const reviewReceipts = Object.fromEntries(Object.entries(project.reviewReceipts || {}).filter(([_key, receipt]) => !segmentId || receipt.scope !== `video:${segmentId}`));
    patchProject({ stage: 'image-review', acceptedImageIds: { ...(project.acceptedImageIds || {}), [shotId]: candidateId }, adoptionReceipts, reviewReceipts, videoCandidates, acceptedVideoIds, finalComposition: undefined }, { clearDeliveryOutputs: true });
    setActiveStage('image-review');
  };

  const finishImageReview = () => {
    if (!shotTasks.length || acceptedImageCount !== shotTasks.length) {
      setLocalError('每个镜头都必须检查并采用一张真实分镜图。');
      return;
    }
    patchProject({ stage: 'video-review' });
    setActiveStage('video-review');
  };

  const acceptedVideoCount = promptSegments.filter((segment) => (project.videoCandidates?.[segment.segmentId] || []).some((candidate) => candidate.id === project.acceptedVideoIds?.[segment.segmentId] && candidate.status === 'succeeded' && !!candidate.contentHash)).length;

  const requestedVideoDuration = (durationUs: number): number => {
    const secondsExact = durationUs / 1_000_000;
    if (videoFamily === 'hailuo' && videoModel.startsWith('minimax-h3-ow-')) {
      if (secondsExact <= 5) return 5;
      if (secondsExact <= 10) return 10;
      return 15;
    }
    return Math.max(5, Math.min(15, Math.ceil(secondsExact))) as HailuoDuration;
  };

  const acceptedImageCandidatesForSegment = (segmentId: string): MvImageCandidate[] => shotTasks
    .filter((task) => task.segment.segmentId === segmentId)
    .map((task) => {
      const acceptedId = project.acceptedImageIds?.[task.shot.shotId];
      return (project.imageCandidates?.[task.shot.shotId] || []).find((candidate) => candidate.id === acceptedId);
    })
    .filter((candidate): candidate is MvImageCandidate => !!candidate?.outputUrl && !!candidate.assetId && !!candidate.contentHash);

  const acceptedPromptForSegment = (segmentId: string): MvPromptCandidate | undefined => {
    const acceptedId = project.acceptedPromptIds?.[segmentId];
    return (project.promptCandidates?.[segmentId] || []).find((candidate) => candidate.id === acceptedId);
  };

  const replaceVideoCandidate = (base: MvProjectState, candidate: MvVideoCandidate, extra: Partial<MvProjectState> = {}): MvProjectState => {
    const videoCandidates = Object.fromEntries(Object.entries(base.videoCandidates || {}).map(([key, values]) => [key, [...values]]));
    const list = [...(videoCandidates[candidate.segmentId] || [])];
    const index = list.findIndex((item) => item.id === candidate.id);
    if (index >= 0) list[index] = candidate;
    else list.push(candidate);
    videoCandidates[candidate.segmentId] = list;
    return commitProjectFrom(base, { stage: 'video-review', videoCandidates, ...extra });
  };

  const ensureSegmentAudioSlice = async (segment: MvPromptSegmentInput, base: MvProjectState, reporter: RunNodeLifecycleReporter): Promise<{ receipt: MvPersistedAudioSlice; project: MvProjectState }> => {
    const existing = base.audioSlices?.[segment.segmentId];
    const expectedDurationUs = segment.sourceEndUs - segment.sourceStartUs;
    if (existing
      && existing.sourceStartUs === segment.sourceStartUs
      && existing.sourceEndUs === segment.sourceEndUs
      && existing.sourceSongSha256 === project.audio?.sha256
      && existing.expectedDurationUs === expectedDurationUs
      && Number.isSafeInteger(existing.actualDurationUs)
      && existing.actualDurationUs >= 5_000_000
      && existing.actualDurationUs <= 14_990_000
      && Math.abs(existing.actualDurationUs - expectedDurationUs) <= 25_000
      && existing.sha256) {
      const asset = await getProjectAsset(existing.assetId).catch(() => undefined);
      if (asset?.availability === 'available' && asset.contentHash === existing.sha256 && asset.sourceUrl) return { receipt: { ...existing, audioUrl: asset.sourceUrl }, project: base };
    }
    if (!project.audio) throw new Error('缺少权威主歌曲回执。');
    const child = await createMvChildAttempt(reporter, { provider: 'local-ffmpeg', model: 'pcm-s16le-44100-stereo', jobId: `${segment.segmentId}-audio`, jobKind: 'mv-audio-slice' });
    try {
      await child.providerRequest({ provider: 'local-ffmpeg', model: 'pcm-s16le-44100-stereo', sourceSongSha256: project.audio.sha256, startUs: segment.sourceStartUs, endUs: segment.sourceEndUs });
      const receipt = await materializeMvAudioSlice({
        audioUrl: project.audio.sourceUrl,
        segmentId: segment.segmentId,
        sourceSongSha256: project.audio.sha256,
        startUs: segment.sourceStartUs,
        endUs: segment.sourceEndUs,
      }, { signal: reporter.signal });
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      await child.providerResponse({ provider: 'local-ffmpeg', model: 'pcm-s16le-44100-stereo', status: 'succeeded' });
      const assets = await child.output({ assets: [{ kind: 'audio', sourceUrl: receipt.audioUrl, filename: `${segment.segmentId}.wav`, mimeType: 'audio/wav', metadata: { sourceSongSha256: receipt.sourceSongSha256, sourceStartUs: receipt.sourceStartUs, sourceEndUs: receipt.sourceEndUs } }] });
      const asset = assets[0];
      if (!asset?.id || !asset.sourceUrl || asset.availability !== 'available' || asset.contentHash !== receipt.sha256) throw new Error('MV 音频切片未能持久化为项目资产。');
      const persisted: MvPersistedAudioSlice = { ...receipt, audioUrl: asset.sourceUrl, assetId: asset.id, sha256: asset.contentHash };
      const next = commitProjectFrom(base, { audioSlices: { ...(base.audioSlices || {}), [segment.segmentId]: persisted } });
      await child.succeed({ assetId: asset.id, contentHash: asset.contentHash, segmentId: segment.segmentId });
      return { receipt: persisted, project: next };
    } catch (error) {
      await child.fail(error).catch(() => undefined);
      throw error;
    }
  };

  const prepareVideoRequest = async (segment: MvPromptSegmentInput, base: MvProjectState, reporter: RunNodeLifecycleReporter) => {
    if (invalidVideoFamily || invalidVideoProvider || invalidVideoModel || invalidVideoResolution) throw new Error(`已保存的视频选择无效（family=${rawVideoFamily || '(缺省)'}，provider=${rawVideoProvider || '(缺省)'}，model=${rawVideoModel || '(缺省)'}，resolution=${rawVideoResolution || '(缺省)'}）；不会静默改用其他计费配置。`);
    if (videoFamily === 'hailuo' && videoProvider !== 'seedance-nz') throw new Error('Hailuo H3 当前只注册在贞贞的平价AI小屋；不会静默切换渠道。');
    const promptCandidate = acceptedPromptForSegment(segment.segmentId);
    if (!promptCandidate) throw new Error(`${segment.segmentId} 缺少已采用 Prompt。`);
    if (!promptCandidate.assetId || !promptCandidate.contentHash) throw new Error(`${segment.segmentId} 的已采用 Prompt 缺少持久资产。`);
    const promptAsset = await getProjectAsset(promptCandidate.assetId).catch(() => undefined);
    if (promptAsset?.availability !== 'available' || promptAsset.contentHash !== promptCandidate.contentHash) throw new Error(`${segment.segmentId} 的已采用 Prompt 资产已缺失或哈希变化，禁止进入付费视频生成。`);
    const imageCandidates = acceptedImageCandidatesForSegment(segment.segmentId);
    const images: string[] = [];
    for (const candidate of imageCandidates) {
      const asset = await getProjectAsset(candidate.assetId!).catch(() => undefined);
      if (asset?.availability !== 'available' || asset.contentHash !== candidate.contentHash || !asset.sourceUrl) throw new Error(`${candidate.shotId} 的已采用分镜资产已缺失或哈希变化，禁止进入付费视频生成。`);
      images.push(asset.sourceUrl);
    }
    if (!images.length) throw new Error(`${segment.segmentId} 缺少已采用分镜图。`);
    if (images.length > videoImageReferenceLimit) throw new Error(`${segment.segmentId} 有 ${images.length} 张分镜图，${videoModel} 最多接收 ${videoImageReferenceLimit} 张；不会静默丢弃。`);
    if (managedMotionReferences.length > 3) throw new Error(`当前视频 Provider 最多接收 3 个运镜参考，已连接 ${managedMotionReferences.length} 个；不会静默丢弃。`);
    const motionReferenceEvidence = managedMotionReferences.map(({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }) => ({ id, sourceNodeId, sourceUrlDigest, contentHash, byteLength }));
    const h3IdentitySubject = videoFamily === 'hailuo' && videoModel === 'hailuo-h3-multi' ? managedIdentityImages[0] : undefined;
    if (videoFamily === 'hailuo' && videoModel === 'hailuo-h3-multi' && managedIdentityImages.length !== 1) throw new Error(`H3 Multi full-reference 要求恰好 1 张人设原图，当前为 ${managedIdentityImages.length} 张。`);
    if (videoFamily === 'hailuo' && videoModel === 'hailuo-h3-multi' && !h3IdentitySubject?.url) throw new Error('H3 Multi 缺少已物化的人设原图，禁止仅依赖二手分镜生成。');
    const providerImages = h3IdentitySubject ? [h3IdentitySubject.url, ...images] : images;
    const duration = requestedVideoDuration(segment.durationUs);
    const audioBound = videoFamily === 'seedance' || videoModel === 'hailuo-h3-multi';
    if (videoFamily === 'hailuo') {
      const model = videoModel as HailuoModel;
      const imageLimit = model === 'hailuo-h3-multi' ? 9 : model.endsWith('-t2v') ? 0 : 1;
      if (providerImages.length > imageLimit) throw new Error(`${model} 最多接收 ${imageLimit} 张图，但本段需要 ${providerImages.length} 张（人设原图 + 已采用分镜）；不会静默丢弃。请选择 hailuo-h3-multi 或减少镜头数。`);
    }
    let preparedProject = base;
    let audioSlice: MvAudioSliceReceipt | undefined;
    if (audioBound) {
      const materialized = await ensureSegmentAudioSlice(segment, preparedProject, reporter);
      preparedProject = materialized.project;
      audioSlice = materialized.receipt;
    }
    const providerPrompt = videoFamily === 'seedance'
      ? compileMvSeedancePrompt({
        segment,
        pack: promptCandidate.pack,
        identityDescription: '已采用分镜图已经由权威人设原图生成；按这些分镜保持同一人物身份、脸部、发型、体型与主服装。',
        pictureCount: images.length,
        audioReference: true,
      })
      : videoModel === 'hailuo-h3-multi' ? compileMvH3Prompt({
        segment,
        pack: promptCandidate.pack,
        identityDescription: h3IdentitySubject
          ? 'Attached image 1 is the authoritative managed portrait and identity reference. Preserve the same face, facial proportions, hair, body identity, and primary wardrobe.'
          : 'Attached image 1 is the first accepted storyboard frame derived from the authoritative portrait. Preserve its subject identity and established appearance.',
        pictureAnchors: (h3IdentitySubject ? images : images.slice(1)).map((_url, index) => `${segment.segmentId} accepted storyboard keyframe ${h3IdentitySubject ? index + 1 : index + 2}; attached image ${h3IdentitySubject ? index + 2 : index + 2}`),
        audioBinding: { enabled: videoModel === 'hailuo-h3-multi', description: 'The exact managed 5.000–14.990 second clip cut from the master song; reuse it 1:1 as the complete target audio.' },
      }) : compileMvH3ImagePrompt({
        segment,
        pack: promptCandidate.pack,
        mode: videoModel === 'minimax-h3-ow-r2v' ? 'r2v' : 'i2v',
        pictureCount: images.length,
      });
    if (providerPrompt.length > 20_000) throw new Error(`${videoModel} 的最终 Prompt 为 ${providerPrompt.length} 字符，超过本节点 20,000 字符安全上限；请减少镜头或精简 Prompt。`);
    const taskProvider = videoProvider === 'zhenzhen' ? 'zhenzhen-legacy' : 'seedance-nz';
    const dispatchProvider = videoFamily === 'seedance' ? taskProvider : 'seedance-nz';
    const canonicalUpstreamModel = videoFamily === 'seedance' && taskProvider === 'seedance-nz'
      ? canonicalMvSeedanceNzModel(videoModel)
      : videoModel;
    const providerRequest = videoFamily === 'seedance'
      ? {
        model: canonicalUpstreamModel,
        prompt: providerPrompt,
        duration,
        ratio: creativeBrief.aspectRatio,
        resolution: effectiveVideoResolution,
        generate_audio: false,
        return_last_frame: true,
        refImages: images,
        videos: managedMotionReferences.map((item) => item.url),
        audios: audioSlice ? [audioSlice.audioUrl] : [],
        taskProvider,
      }
      : {
        model: videoModel,
        prompt: providerPrompt,
        duration,
        ratio: creativeBrief.aspectRatio,
        resolution: videoModel.startsWith('minimax-h3-ow-') ? effectiveVideoResolution : '2K',
        images: providerImages,
        videos: videoModel === 'hailuo-h3-multi' ? managedMotionReferences.map((item) => item.url) : [],
        audios: audioSlice ? [audioSlice.audioUrl] : [],
      };
    const requestSnapshot: Record<string, any> = {
      schema: 't8-mv-video-request-v1', projectId: reporter.runContext?.projectId, canvasId: reporter.runContext?.canvasId,
      provider: dispatchProvider, selectedProvider: videoProvider, family: videoFamily,
      selectedModelAlias: videoModel, canonicalUpstreamModel, providerRequest,
      targetDurationUs: segment.durationUs,
      imageAssets: imageCandidates.map((item) => ({ assetId: item.assetId, contentHash: item.contentHash })),
      identitySubjectAsset: h3IdentitySubject ? { assetId: h3IdentitySubject.assetId, contentHash: h3IdentitySubject.contentHash } : null,
      motionReferences: managedMotionReferences.map((_item, index) => motionReferenceEvidence[index]),
      audioAsset: audioBound && audioSlice ? { assetId: (audioSlice as MvPersistedAudioSlice).assetId, contentHash: audioSlice.sha256, sourceStartUs: audioSlice.sourceStartUs, sourceEndUs: audioSlice.sourceEndUs } : null,
    };
    const promptDigest = await sha256Hex(providerPrompt);
    const requestDigest = await sha256Hex(JSON.stringify(providerRequest));
    requestSnapshot.requestBodySha256 = requestDigest;
    return { project: preparedProject, promptCandidate, imageCandidates, images: providerImages, duration, audioBound, audioSlice, providerPrompt, providerRequest, requestSnapshot, promptDigest, requestDigest, dispatchProvider, canonicalUpstreamModel };
  };

  const generateVideoCandidate = async (segment: MvPromptSegmentInput, base: MvProjectState, reporter: RunNodeLifecycleReporter, paidReceipt: MvPaidApprovalReceipt, paidTask: MvPaidApprovalTaskReceipt, forceNew = false, prepared?: Awaited<ReturnType<typeof prepareVideoRequest>>): Promise<MvProjectState> => {
    const request = prepared || await prepareVideoRequest(segment, base, reporter);
    const { imageCandidates, images, duration, audioBound, audioSlice, providerPrompt, providerRequest, requestSnapshot, promptDigest, requestDigest, dispatchProvider, canonicalUpstreamModel } = request;
    const expectedTaskProvider: 'seedance-nz' | 'zhenzhen-legacy' = videoFamily === 'seedance'
      ? dispatchProvider as 'seedance-nz' | 'zhenzhen-legacy'
      : 'seedance-nz';
    const expectedTaskType = expectedMvVideoTaskType(videoFamily, canonicalUpstreamModel);
    let working = base;
    const existingVideoCandidates = working.videoCandidates?.[segment.segmentId] || [];
    if (!forceNew && existingVideoCandidates.some(mvSubmissionRequiresManualResolution)) {
      throw new Error(`${segment.segmentId} 存在无 taskId 的未决提交；为避免重复计费，必须先核对 Provider，再显式新建修订。`);
    }
    const resumable = !forceNew ? [...existingVideoCandidates].reverse().find((item) => mvVideoSubmissionCanResume(item, {
      provider: videoProvider,
      family: videoFamily,
      model: canonicalUpstreamModel,
      requestDigest,
    })) : undefined;
    const revision = resumable?.revision || existingVideoCandidates.length + 1;
    const candidateId = resumable?.id || `video-${requestDigest.slice(0, 16)}-r${revision}`;
    await assertPaidReceiptCoversTask(paidReceipt, paidTask);
    const paidTaskDigest = await sha256Hex(JSON.stringify(paidTask));
    const stableSubmissionKey = resumable?.submissionKey || `t8-mv-video-${paidTaskDigest.slice(0, 40)}-r${revision}`;
    const child = await createMvChildAttempt(reporter, {
      provider: dispatchProvider,
      model: canonicalUpstreamModel,
      jobId: segment.segmentId,
      jobKind: 'mv-segment-video',
      submissionKey: stableSubmissionKey,
      approvalReceipt: paidReceipt,
      approvalTask: paidTask,
    });
    const submissionKey = child.submissionKey;
    let candidate: MvVideoCandidate = resumable ? {
      ...resumable,
      status: resumable.taskId ? 'polling' : 'submitting',
      completedAt: undefined,
      error: undefined,
    } : {
      schema: 't8-mv-video-candidate-v1',
      id: candidateId,
      segmentId: segment.segmentId,
      revision,
      provider: videoProvider,
      family: videoFamily,
      model: canonicalUpstreamModel,
      status: 'submitting',
      submissionKey,
      requestedDurationSeconds: duration,
      targetDurationUs: segment.durationUs,
      providerPrompt,
      promptDigest,
      requestDigest,
      requestSnapshot,
      createdAt: Date.now(),
    };
    candidate = { ...candidate, providerPrompt, promptDigest, requestDigest, requestSnapshot };
    working = replaceVideoCandidate(working, candidate);
    update({ mvProject: working });
    try {
      let taskId = resumable?.taskId || child.priorSubmission?.upstreamTaskId || '';
      let taskProvider: MvVideoCandidate['taskProvider'] = resumable?.taskProvider
        || (typeof child.priorSubmission?.recovery?.taskProvider === 'string' ? child.priorSubmission.recovery.taskProvider as MvVideoCandidate['taskProvider'] : undefined)
        || (videoFamily === 'seedance' ? dispatchProvider as MvVideoCandidate['taskProvider'] : 'seedance-nz');
      let submissionResult: any = resumable || child.priorSubmission ? { taskId, taskProvider, status: resumable?.status || child.priorSubmission?.state || 'polling' } : null;
      let submittedNow = false;
      if (reporter.signal?.aborted) throw new MvRecoverableTaskError('父运行已停止；视频提交意图已保存，可用同一提交键恢复。', true);
      if (!taskId) {
        candidate = { ...candidate, dispatchStartedAt: Date.now() };
        working = replaceVideoCandidate(working, candidate);
        update({ mvProject: working });
      }
      await child.providerRequest({ provider: dispatchProvider, model: canonicalUpstreamModel, selectedModelAlias: videoModel, candidateId, duration, imageCount: images.length, audioCount: audioBound ? 1 : 0, promptDigest, requestDigest, ...(taskId ? { resumed: true, upstreamTaskId: taskId } : {}) });
      if (videoFamily === 'seedance') {
        if (!taskId) {
          const submitted = await submitSeedance(providerRequest as any, { submissionKey, signal: reporter.signal });
          taskId = submitted.taskId;
          taskProvider = submitted.taskProvider === 'seedance-nz' || submitted.taskProvider === 'zhenzhen-legacy'
            ? submitted.taskProvider
            : expectedTaskProvider;
          submissionResult = submitted;
          submittedNow = true;
        }
      } else {
        if (!taskId) {
          const submitted = await submitHailuo(providerRequest as any, { submissionKey, signal: reporter.signal });
          taskId = submitted.taskId;
          taskProvider = submitted.taskProvider === 'seedance-nz' ? submitted.taskProvider : expectedTaskProvider;
          submissionResult = submitted;
          submittedNow = true;
        }
      }
      if (!taskId) throw new Error('视频 Provider 未返回任务 ID，已阻断且不会重新提交。');
      if (submittedNow) {
        const receiptMismatches = mvProviderReceiptMismatches(submissionResult, {
          taskProvider: expectedTaskProvider,
          model: canonicalUpstreamModel,
          taskType: expectedTaskType,
        });
        if (receiptMismatches.length) {
          const submittedModel = typeof submissionResult?.model === 'string' ? submissionResult.model : '';
          const manualResolutionReason = `Provider 已受理任务，但提交回执与批准快照不一致：${receiptMismatches.join('；')}。已保存 taskId，禁止自动恢复、采用或重新提交。`;
          candidate = {
            ...candidate,
            status: 'blocked',
            taskId,
            taskProvider,
            submittedModel,
            submittedTaskProvider: typeof submissionResult?.taskProvider === 'string' ? submissionResult.taskProvider : '',
            submittedTaskType: typeof submissionResult?.taskType === 'string' ? submissionResult.taskType : '',
            modelMismatch: !!submittedModel && submittedModel !== canonicalUpstreamModel,
            providerContractMismatch: true,
            manualResolutionReason,
            submissionTrace: providerTrace(submissionResult),
          };
          working = replaceVideoCandidate(working, candidate);
          update({ mvProject: working });
          throw new Error(manualResolutionReason);
        }
        candidate = {
          ...candidate,
          taskId,
          taskProvider,
          submittedModel: submissionResult.model,
          submittedTaskProvider: submissionResult.taskProvider,
          submittedTaskType: submissionResult.taskType,
          modelMismatch: false,
          providerContractMismatch: false,
          providerContractVerifiedAt: Date.now(),
          manualResolutionReason: undefined,
        };
        working = replaceVideoCandidate(working, candidate);
        update({ mvProject: working });
      }
      const submissionTrace = providerTrace(submissionResult);
      candidate = { ...candidate, status: 'submitted', taskId, taskProvider, providerPrompt, promptDigest: candidate.promptDigest || await sha256Hex(providerPrompt), submissionTrace };
      working = replaceVideoCandidate(working, candidate);
      await child.providerSubmitted({ provider: videoFamily === 'seedance' ? taskProvider : 'seedance-nz', model: canonicalUpstreamModel, selectedModelAlias: videoModel, candidateId, requestDigest: candidate.requestDigest, upstreamTaskId: taskId, ...submissionTrace, resumed: !!resumable || !!child.priorSubmission, recovery: videoFamily === 'seedance' ? { version: 1, kind: 'seedance', taskId, taskProvider, model: canonicalUpstreamModel, selectedModelAlias: videoModel, pollIntervalMs: 5000, maxPolls: 720 } : { version: 1, kind: 'hailuo', taskId, model: canonicalUpstreamModel, pollIntervalMs: 5000, maxPolls: 720 } });
      candidate = { ...candidate, status: 'polling' };
      working = replaceVideoCandidate(working, candidate);
      update({ mvProject: working });
      let outputUrl = '';
      let terminalResult: any = null;
      const startedAt = Date.now();
      let pollCount = 0;
      let consecutiveQueryErrors = 0;
      while (Date.now() - startedAt < 45 * 60_000) {
        assertMvPollingContinues(pollingControlRef.current, reporter.signal);
        await sleep(5000, reporter.signal);
        assertMvPollingContinues(pollingControlRef.current, reporter.signal);
        pollCount += 1;
        let result: any;
        try {
          result = videoFamily === 'seedance'
            ? await querySeedance(taskId, taskProvider, { signal: reporter.signal })
            : await queryHailuo(taskId, { signal: reporter.signal });
          consecutiveQueryErrors = 0;
        } catch (error) {
          consecutiveQueryErrors += 1;
          if (consecutiveQueryErrors < 5) continue;
          throw new MvRecoverableTaskError(`视频任务 ${taskId} 连续查询失败，已保存 taskId，稍后继续查询：${error instanceof Error ? error.message : String(error)}`);
        }
        terminalResult = result;
        const status = String(result.status || '').toLowerCase();
        await child.providerPolling({ provider: videoFamily === 'seedance' ? taskProvider : 'seedance-nz', model: canonicalUpstreamModel, selectedModelAlias: videoModel, upstreamTaskId: taskId, pollCount, status, recovery: videoFamily === 'seedance' ? { version: 1, kind: 'seedance', taskId, taskProvider, model: canonicalUpstreamModel, selectedModelAlias: videoModel } : { version: 1, kind: 'hailuo', taskId, model: canonicalUpstreamModel } });
        if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
          const verifiedSubmissionReceipt = candidate.providerContractVerifiedAt
            ? {
              taskProvider: candidate.submittedTaskProvider,
              model: candidate.submittedModel,
              taskType: candidate.submittedTaskType,
            }
            : undefined;
          const effectiveTerminalReceipt = {
            taskProvider: typeof result?.taskProvider === 'string' && result.taskProvider.trim() ? result.taskProvider : verifiedSubmissionReceipt?.taskProvider,
            model: typeof result?.model === 'string' && result.model.trim() ? result.model : verifiedSubmissionReceipt?.model,
            taskType: typeof result?.taskType === 'string' && result.taskType.trim() ? result.taskType : verifiedSubmissionReceipt?.taskType,
          };
          const receiptMismatches = mvProviderReceiptMismatches(effectiveTerminalReceipt, {
            taskProvider: expectedTaskProvider,
            model: canonicalUpstreamModel,
            taskType: expectedTaskType,
          });
          if (receiptMismatches.length) {
            const submittedModel = typeof result?.model === 'string' ? result.model : '';
            const manualResolutionReason = `Provider 终态回执与批准快照不一致：${receiptMismatches.join('；')}。任务已阻断，禁止物化、采用或交付。`;
            candidate = {
              ...candidate,
              status: 'blocked',
              submittedModel: submittedModel || effectiveTerminalReceipt.model,
              submittedTaskProvider: effectiveTerminalReceipt.taskProvider,
              submittedTaskType: effectiveTerminalReceipt.taskType,
              modelMismatch: !!submittedModel && submittedModel !== canonicalUpstreamModel,
              providerContractMismatch: true,
              manualResolutionReason,
              terminalTrace: providerTrace(result),
            };
            working = replaceVideoCandidate(working, candidate);
            update({ mvProject: working });
            throw new Error(manualResolutionReason);
          }
          outputUrl = String(result.videoUrl || '');
          break;
        }
        if (['failed', 'failure', 'error', 'cancelled'].includes(status)) throw new Error(result.failReason || result.error || '分段视频生成失败。');
      }
      if (!outputUrl) throw new MvRecoverableTaskError(`视频任务 ${taskId} 在本地等待窗口内未结束，已保存 taskId；不会自动重新提交。`);
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      const terminalTrace = providerTrace(terminalResult);
      await child.providerResponse({ provider: videoFamily === 'seedance' ? taskProvider : 'seedance-nz', model: canonicalUpstreamModel, selectedModelAlias: videoModel, upstreamTaskId: taskId, status: String(terminalResult?.status || 'succeeded'), ...terminalTrace });
      candidate = { ...candidate, status: 'materializing' };
      working = replaceVideoCandidate(working, candidate);
      update({ mvProject: working });
      const assets = await child.output({ assets: [{ kind: 'video', sourceUrl: outputUrl, filename: `${segment.segmentId}.mp4`, metadata: { candidateId } }] });
      const asset = assets[0];
      if (!asset?.id || !asset.sourceUrl || asset.availability !== 'available' || !asset.contentHash) throw new Error('分段视频未能物化为可用的项目资产，禁止保存远程临时 URL。');
      const evidence = await validateVideoArtifact(asset.sourceUrl, reporter.signal);
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      if (asset.contentHash !== evidence.contentHash) throw new Error('分段视频项目资产哈希与 FFprobe 回执不一致。');
      if ((evidence.actualDurationSeconds || 0) + 0.03 < segment.durationUs / 1_000_000) {
        throw new Error(`Provider 视频仅 ${(evidence.actualDurationSeconds || 0).toFixed(3)} 秒，短于目标段，禁止冻结补帧。`);
      }
      candidate = { ...candidate, ...evidence, terminalTrace, status: 'succeeded', outputUrl: asset.sourceUrl, assetId: asset.id, contentHash: asset.contentHash, completedAt: Date.now(), error: undefined };
      const completed = replaceVideoCandidate(working, candidate);
      await child.succeed({ candidateId, contentHash: evidence.contentHash });
      return completed;
    } catch (error) {
      const ambiguous = candidate.status === 'submitting' && !candidate.taskId;
      const manualResolution = mvSubmissionRequiresManualResolution(candidate);
      const interruptedAfterTask = !!candidate.taskId && (reporter.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError'));
      const recoverable = !ambiguous && !manualResolution && (error instanceof MvRecoverableTaskError || interruptedAfterTask);
      candidate = { ...candidate, status: ambiguous ? 'ambiguous' : manualResolution ? 'blocked' : recoverable ? ((error instanceof MvRecoverableTaskError && error.interrupted) || interruptedAfterTask ? 'interrupted' : 'recoverable') : 'failed', error: error instanceof Error ? error.message : String(error), completedAt: Date.now() };
      working = replaceVideoCandidate(working, candidate);
      update({ mvProject: working });
      if (ambiguous) await child.interrupt(candidate.error || '视频提交结果不明确', { candidateId, ambiguousSubmission: true, automaticRetryForbidden: true });
      else if (manualResolution) await child.interrupt(candidate.error || '视频提交需要人工处理', { candidateId, upstreamTaskId: candidate.taskId, providerContractMismatch: candidate.providerContractMismatch, modelMismatch: candidate.modelMismatch, submittedTaskProvider: candidate.submittedTaskProvider, submittedModel: candidate.submittedModel, submittedTaskType: candidate.submittedTaskType, approvedTaskProvider: expectedTaskProvider, approvedModel: candidate.model, approvedTaskType: expectedTaskType, manualResolutionRequired: true, automaticRetryForbidden: true });
      else if (recoverable) await child.interrupt(candidate.error || '视频任务可恢复', { candidateId, upstreamTaskId: candidate.taskId, mvRecovery: true });
      else await child.fail(error, { candidateId });
      throw error;
    }
  };

  const generateVideos = async (onlySegmentIds: string[] | undefined, reporter: RunNodeLifecycleReporter, forceNew = false) => {
    setLocalError('');
    setRunning(true);
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      if (!forceNew && !onlySegmentIds?.length) {
        const ambiguousIds = promptSegments.filter((segment) => (project.videoCandidates?.[segment.segmentId] || []).some(mvSubmissionRequiresManualResolution)).map((segment) => segment.segmentId);
        if (ambiguousIds.length) throw new Error(`以下视频提交结果不明确，批量补缺失不会自动重放：${ambiguousIds.join('、')}。请核对 Provider 后，在对应卡片明确新建修订。`);
      }
      const availableSucceededSegments = new Set<string>();
      const availableAcceptedSegments = new Set<string>();
      for (const segment of promptSegments) {
        for (const candidate of (project.videoCandidates?.[segment.segmentId] || []).filter((item) => item.status === 'succeeded' && item.assetId && item.contentHash)) {
          const asset = await getProjectAsset(candidate.assetId!).catch(() => undefined);
          if (asset?.availability === 'available' && asset.contentHash === candidate.contentHash) {
            availableSucceededSegments.add(segment.segmentId);
            if (project.acceptedVideoIds?.[segment.segmentId] === candidate.id) availableAcceptedSegments.add(segment.segmentId);
          }
        }
      }
      const targets = promptSegments.filter((segment) => onlySegmentIds?.length
        ? onlySegmentIds.includes(segment.segmentId)
        : !availableAcceptedSegments.has(segment.segmentId)
          && !availableSucceededSegments.has(segment.segmentId)
          && !(project.videoCandidates?.[segment.segmentId] || []).some(mvSubmissionRequiresManualResolution));
      if (!targets.length) throw new Error('没有待生成的视频分段。');
      let preparedProject = project;
      const preparedRequests: Array<Awaited<ReturnType<typeof prepareVideoRequest>>> = [];
      for (const segment of targets) {
        const prepared = await prepareVideoRequest(segment, preparedProject, reporter);
        preparedProject = prepared.project;
        preparedRequests.push(prepared);
      }
      const paidTasks = await Promise.all(targets.map((segment, index) => buildPaidApprovalTask(
        segment.segmentId,
        preparedRequests[index].dispatchProvider,
        preparedRequests[index].canonicalUpstreamModel,
        preparedRequests[index].providerRequest,
        { promptCandidateHash: preparedRequests[index].promptCandidate.contentHash, imageContentHashes: preparedRequests[index].imageCandidates.map((candidate) => candidate.contentHash), motionReferences: preparedRequests[index].requestSnapshot.motionReferences, audioContentHash: preparedRequests[index].audioSlice?.sha256 || null, sourceSongSha256: project.audio?.sha256 },
      )));
      const paidReceipt = await assertPaidOperationApproved('分段视频生成', paidTasks);
      let working: MvProjectState = { ...preparedProject, approvals: { ...approvals, lastPaidReceipt: paidReceipt, updatedAt: paidReceipt.approvedAt } };
      for (let index = 0; index < targets.length; index += 1) working = await generateVideoCandidate(targets[index], working, reporter, paidReceipt, paidTasks[index], forceNew, preparedRequests[index]);
      update({ status: 'success', error: '', mvProject: working });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const markVideoViewed = (segmentId: string, candidateId: string, playbackEvidence: MvPlaybackEvidence) => {
    const candidate = (project.videoCandidates?.[segmentId] || []).find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'succeeded' || !candidate.assetId || !candidate.contentHash) return;
    const scope = `video:${segmentId}`;
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    const existing = project.reviewReceipts?.[candidateId];
    if (existing?.schema === 't8-mv-candidate-review-v2' && existing.scope === scope && existing.assetId === candidate.assetId && existing.contentHash === candidate.contentHash && existing.evidenceDigest === evidenceDigest) return;
    const viewedAt = Date.now();
    replaceVideoCandidate(project, { ...candidate, viewedAt }, { reviewReceipts: { ...(project.reviewReceipts || {}), [candidateId]: { schema: 't8-mv-candidate-review-v2', projectRevision: project.revision + 1, scope, candidateId, contentHash: candidate.contentHash, assetId: candidate.assetId, evidenceDigest, medium: 'video', playbackEvidence, viewedAt } } });
  };

  const flushPlaybackAudit = (video: HTMLVideoElement, keepActive = !video.paused) => {
    const state = playbackAuditRef.current.get(video);
    if (!state?.activeSince) return;
    const now = performance.now();
    const deviation = Math.abs(video.playbackRate - 1);
    state.maxPlaybackRateDeviation = Math.max(state.maxPlaybackRateDeviation, deviation);
    if (document.visibilityState !== 'visible') {
      state.invalid = true;
      state.visibilityViolations += 1;
    } else if (deviation > 0.01) {
      state.invalid = true;
    } else {
      state.wallClockMs += Math.min(1_000, Math.max(0, now - state.activeSince));
    }
    state.activeSince = keepActive ? now : null;
    if (!keepActive) activePlaybackElementsRef.current.delete(video);
  };

  const beginPlaybackAudit = (video: HTMLVideoElement) => {
    let state = playbackAuditRef.current.get(video);
    if (!state || video.currentTime <= 0.02) {
      state = { invalid: false, startedAtZero: video.currentTime <= 0.1, activeSince: null, wallClockMs: 0, maxPlaybackRateDeviation: 0, seekCount: 0, visibilityViolations: 0 };
      playbackAuditRef.current.set(video, state);
    }
    state.activeSince = performance.now();
    activePlaybackElementsRef.current.add(video);
    if (Math.abs(video.playbackRate - 1) > 0.01 || document.visibilityState !== 'visible') {
      state.invalid = true;
      if (document.visibilityState !== 'visible') state.visibilityViolations += 1;
    }
  };

  const invalidatePlaybackAudit = (video: HTMLVideoElement, reason: 'rate' | 'seek' | 'visibility' | 'error') => {
    flushPlaybackAudit(video);
    const state = playbackAuditRef.current.get(video) || { invalid: false, startedAtZero: false, activeSince: null, wallClockMs: 0, maxPlaybackRateDeviation: 0, seekCount: 0, visibilityViolations: 0 };
    state.invalid = true;
    state.maxPlaybackRateDeviation = Math.max(state.maxPlaybackRateDeviation, Math.abs(video.playbackRate - 1));
    if (reason === 'seek') state.seekCount += 1;
    if (reason === 'visibility') state.visibilityViolations += 1;
    playbackAuditRef.current.set(video, state);
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') return;
      for (const video of activePlaybackElementsRef.current) {
        const state = playbackAuditRef.current.get(video);
        if (!state) continue;
        state.invalid = true;
        state.visibilityViolations += 1;
        state.activeSince = null;
      }
      activePlaybackElementsRef.current.clear();
      setLocalError('审阅期间窗口进入后台；本次播放证据已失效，请回到开头重新完整播放。');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const playbackCoverageEvidence = (video: HTMLVideoElement): MvPlaybackEvidence | null => {
    flushPlaybackAudit(video, false);
    const duration = Number(video.duration);
    const state = playbackAuditRef.current.get(video);
    if (!state || state.invalid || !state.startedAtZero || !Number.isFinite(duration) || duration <= 0 || Math.abs(video.playbackRate - 1) > 0.01) return null;
    const intervals: Array<[number, number]> = [];
    for (let index = 0; index < video.played.length; index += 1) {
      intervals.push([video.played.start(index), video.played.end(index)]);
    }
    intervals.sort((left, right) => left[0] - right[0]);
    const merged: Array<[number, number]> = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1] + 0.08) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push([...interval]);
    }
    const covered = merged.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
    const complete = !!merged.length
      && merged[0][0] <= 0.1
      && merged.at(-1)![1] >= duration - 0.1
      && covered >= duration - 0.25
      && state.wallClockMs / 1000 >= duration - Math.min(1, Math.max(0.35, duration * 0.05));
    if (!complete) return null;
    return {
      schema: 't8-mv-playback-evidence-v1',
      durationSeconds: Number(duration.toFixed(3)),
      coveredSeconds: Number(covered.toFixed(3)),
      wallClockSeconds: Number((state.wallClockMs / 1000).toFixed(3)),
      playedRanges: merged.map(([start, end]) => [Number(start.toFixed(3)), Number(end.toFixed(3))]),
      maxPlaybackRateDeviation: Number(state.maxPlaybackRateDeviation.toFixed(3)),
      seekCount: state.seekCount,
      visibilityViolations: state.visibilityViolations,
      completedAt: Date.now(),
    };
  };

  const finishVideoCandidatePlayback = (video: HTMLVideoElement, segmentId: string, candidateId: string) => {
    const playbackEvidence = playbackCoverageEvidence(video);
    if (!playbackEvidence) {
      setLocalError('必须以 1× 速度从头到尾覆盖播放该候选；拖到结尾不会签发 ReviewReceipt。');
      return;
    }
    markVideoViewed(segmentId, candidateId, playbackEvidence);
  };

  const acceptVideoCandidate = (segmentId: string, candidateId: string) => {
    const candidate = (project.videoCandidates?.[segmentId] || []).find((item) => item.id === candidateId);
    if (candidate && mvSubmissionRequiresManualResolution(candidate)) {
      setLocalError('该视频任务的 Provider 回执模型与批准模型不一致或提交状态未决，禁止采用；请人工核对后显式新建修订。');
      return;
    }
    if (!candidate?.viewedAt || !candidate.contentHash || !candidate.outputUrl || !candidate.assetId) {
      setLocalError('必须先实际加载并查看这段视频，且通过下载、FFprobe 与哈希校验后才能采用。');
      return;
    }
    if (project.acceptedVideoIds?.[segmentId] === candidateId) return;
    const scope = `video:${segmentId}`;
    const review = project.reviewReceipts?.[candidateId];
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    if (!review || review.schema !== 't8-mv-candidate-review-v2' || review.scope !== scope || review.assetId !== candidate.assetId || review.contentHash !== candidate.contentHash || review.evidenceDigest !== evidenceDigest) {
      setLocalError('当前视频缺少与本候选资产严格绑定的 ReviewReceipt，请重新播放后再采用。');
      return;
    }
    patchProject({ stage: 'video-review', acceptedVideoIds: { ...(project.acceptedVideoIds || {}), [segmentId]: candidateId }, adoptionReceipts: { ...(project.adoptionReceipts || {}), [scope]: { schema: 't8-mv-adoption-receipt-v2', projectRevision: project.revision + 1, scope, candidateId, contentHash: candidate.contentHash, assetId: candidate.assetId, evidenceDigest, reviewReceiptDigest: reviewReceiptDigest(review), adoptedAt: Date.now() } }, finalComposition: undefined }, { clearDeliveryOutputs: true });
    setActiveStage('video-review');
  };

  const finishVideoReview = () => {
    if (!promptSegments.length || acceptedVideoCount !== promptSegments.length) {
      setLocalError('每个音频段都必须检查并采用一段真实视频。');
      return;
    }
    patchProject({ stage: 'composing' });
    setActiveStage('composing');
  };

  const assertCandidateAdoption = (
    scope: string,
    candidate: { id: string; assetId?: string; contentHash?: string; requestDigest?: string; promptDigest?: string; width?: number; height?: number; actualDurationSeconds?: number },
    requiresReview: boolean,
  ) => {
    if (!candidate.assetId || !candidate.contentHash) throw new Error(`${scope} 候选缺少持久资产身份。`);
    const adoption = project.adoptionReceipts?.[scope === 'visual-bible' ? 'bible' : scope];
    const evidenceDigest = candidateEvidenceDigest(scope, candidate);
    if (!adoption || adoption.schema !== 't8-mv-adoption-receipt-v2' || adoption.scope !== scope || adoption.candidateId !== candidate.id || adoption.assetId !== candidate.assetId || adoption.contentHash !== candidate.contentHash || adoption.evidenceDigest !== evidenceDigest) {
      throw new Error(`${scope} 缺少与当前候选严格匹配的 AdoptionReceipt。`);
    }
    if (requiresReview) {
      const review = project.reviewReceipts?.[candidate.id];
      if (!review || review.schema !== 't8-mv-candidate-review-v2' || review.scope !== scope || review.assetId !== candidate.assetId || review.contentHash !== candidate.contentHash || review.evidenceDigest !== evidenceDigest || adoption.reviewReceiptDigest !== reviewReceiptDigest(review)) {
        throw new Error(`${scope} 的 AdoptionReceipt 未绑定当前 ReviewReceipt。`);
      }
    }
    return adoption;
  };

  const composeFinalMv = async (reporter: RunNodeLifecycleReporter, forceNew = false) => {
    setLocalError('');
    setRunning(true);
    let child: MvChildAttempt | undefined;
    let activeJobId = project.finalComposition?.jobId || '';
    let activeInputDigest = project.finalComposition?.inputDigest || '';
    let composeChildSucceeded = false;
    let interimComposition: MvFinalComposition | undefined;
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      if (!project.audio?.assetId || !project.segmentPlan) throw new Error('缺少受管权威歌曲资产或分段计划。');
      if (!acceptedBible) throw new Error('缺少已采用的视觉圣经。');
      const selectedReviewReceipts: Record<string, MvCandidateReviewReceipt> = {};
      const selectedAdoptionReceipts: Record<string, MvAdoptionReceipt> = {};
      selectedAdoptionReceipts.bible = assertCandidateAdoption('visual-bible', acceptedBible, true);
      selectedReviewReceipts[acceptedBible.id] = project.reviewReceipts![acceptedBible.id];
      const acceptedPrompts = promptSegments.map((segment) => {
        const candidate = acceptedPromptForSegment(segment.segmentId);
        if (!candidate?.assetId || !candidate.contentHash) throw new Error(`${segment.segmentId} 缺少已采用 PromptPack。`);
        selectedAdoptionReceipts[`prompt:${segment.segmentId}`] = assertCandidateAdoption(`prompt:${segment.segmentId}`, candidate, true);
        selectedReviewReceipts[candidate.id] = project.reviewReceipts![candidate.id];
        return { segment, candidate };
      });
      critiqueMvPromptPacks(promptSegments, acceptedPrompts.map(({ candidate }) => candidate.pack));
      const acceptedImages = shotTasks.map((task) => {
        const acceptedId = project.acceptedImageIds?.[task.shot.shotId];
        const candidate = (project.imageCandidates?.[task.shot.shotId] || []).find((item) => item.id === acceptedId);
        if (!candidate?.outputUrl || !candidate.assetId || !candidate.contentHash) throw new Error(`${task.shot.shotId} 缺少已采用分镜图。`);
        const scope = `image:${task.shot.shotId}`;
        selectedAdoptionReceipts[scope] = assertCandidateAdoption(scope, candidate, true);
        selectedReviewReceipts[candidate.id] = project.reviewReceipts![candidate.id];
        return { task, candidate };
      });
      const acceptedVideos = promptSegments.map((segment) => {
        const acceptedId = project.acceptedVideoIds?.[segment.segmentId];
        const candidate = (project.videoCandidates?.[segment.segmentId] || []).find((item) => item.id === acceptedId);
        if (!candidate?.outputUrl || !candidate.assetId || !candidate.contentHash) throw new Error(`${segment.segmentId} 缺少已采用视频。`);
        const scope = `video:${segment.segmentId}`;
        selectedAdoptionReceipts[scope] = assertCandidateAdoption(scope, candidate, true);
        selectedReviewReceipts[candidate.id] = project.reviewReceipts![candidate.id];
        return { segment, candidate };
      });
      const selectedAssets = [
        { scope: 'master-audio', assetId: project.audio.assetId, contentHash: project.audio.sha256 },
        { scope: 'visual-bible', assetId: acceptedBible.assetId!, contentHash: acceptedBible.contentHash! },
        ...acceptedPrompts.map(({ segment, candidate }) => ({ scope: `prompt:${segment.segmentId}`, assetId: candidate.assetId!, contentHash: candidate.contentHash! })),
        ...acceptedImages.map(({ task, candidate }) => ({ scope: `image:${task.shot.shotId}`, assetId: candidate.assetId!, contentHash: candidate.contentHash! })),
        ...acceptedVideos.map(({ segment, candidate }) => ({ scope: `video:${segment.segmentId}`, assetId: candidate.assetId!, contentHash: candidate.contentHash! })),
      ];
      for (const selected of selectedAssets) {
        assertMvPollingContinues(pollingControlRef.current, reporter.signal);
        const asset = await getProjectAsset(selected.assetId).catch(() => undefined);
        if (!asset || asset.availability !== 'available' || asset.contentHash !== selected.contentHash) throw new Error(`${selected.scope} 的已采用项目资产已缺失、不可用或哈希变化，禁止合成。`);
      }
      child = await createMvChildAttempt(reporter, { provider: 'local-ffmpeg', model: 'master-audio-replace', jobId: `compose-r${project.revision + 1}`, jobKind: 'mv-final-compose' });
      const clips: VideoEditClip[] = acceptedVideos.map(({ segment, candidate }) => ({
        id: `mv-clip-${segment.segmentId}`,
        assetId: `mv-video-${segment.segmentId}`,
        sourceLabel: `MV 段 ${segment.ordinal}`,
        name: `MV 段 ${segment.ordinal}`,
        url: candidate.outputUrl!,
        directUrl: candidate.outputUrl!,
        mime: 'video/mp4',
        duration: candidate.actualDurationSeconds,
        width: candidate.width,
        height: candidate.height,
        hasAudio: candidate.hasAudio,
        trimStart: 0,
        trimEnd: segment.durationUs / 1_000_000,
        muted: true,
        status: 'ready',
      }));
      const subtitleUnits = creativeBrief.subtitles === 'none' ? [] : project.lyricUnits.filter((unit) => unit.startUs !== undefined && unit.endUs !== undefined);
      if (creativeBrief.subtitles !== 'none' && subtitleUnits.length !== project.lyricUnits.length) {
        throw new Error('已选择歌词字幕，但至少一个歌词单元没有时间证据。');
      }
      const timelineV2: VideoEditTimelineV2 = {
        version: 2,
        assets: [
          ...acceptedVideos.map(({ segment, candidate }) => ({ id: `mv-video-${segment.segmentId}`, kind: 'video' as const, url: candidate.outputUrl!, directUrl: candidate.outputUrl!, name: `MV 段 ${segment.ordinal}`, duration: candidate.actualDurationSeconds, width: candidate.width, height: candidate.height, hasAudio: candidate.hasAudio })),
          { id: 'mv-master-song', kind: 'audio' as const, url: project.audio.sourceUrl, directUrl: project.audio.sourceUrl, name: project.audio.sourceLabel, duration: project.audio.durationUs / 1_000_000, hasAudio: true },
          ...subtitleUnits.map((unit) => ({ id: `mv-subtitle-${unit.id}`, kind: 'text' as const, url: '', name: `歌词 ${unit.id}`, text: unit.originalText, textPosition: creativeBrief.subtitles === 'spatial-lyrics' ? 'middle' : 'bottom', textColor: '#ffffff', textFontSize: 46, textBackground: 'rgba(0,0,0,0.45)' })),
        ],
        tracks: [
          { id: 'mv-video-track', kind: 'video', name: 'MV 画面', order: 0 },
          { id: 'mv-audio-track', kind: 'audio', name: '原曲唯一主音轨', order: 0 },
          ...(subtitleUnits.length ? [{ id: 'mv-subtitle-track', kind: 'text' as const, name: '权威歌词字幕', order: 0 }] : []),
        ],
        items: [
          ...acceptedVideos.map(({ segment }) => ({ id: `mv-video-item-${segment.segmentId}`, assetId: `mv-video-${segment.segmentId}`, trackId: 'mv-video-track', kind: 'video' as const, timelineStart: segment.sourceStartUs / 1_000_000, sourceIn: 0, sourceOut: segment.durationUs / 1_000_000, muted: true })),
          { id: 'mv-master-audio-item', assetId: 'mv-master-song', trackId: 'mv-audio-track', kind: 'audio' as const, timelineStart: 0, sourceIn: 0, sourceOut: project.audio.durationUs / 1_000_000, muted: false, volume: 1, audioFadeIn: 0, audioFadeOut: 0, volumeCurve: 'flat' as const },
          ...subtitleUnits.map((unit) => ({ id: `mv-subtitle-item-${unit.id}`, assetId: `mv-subtitle-${unit.id}`, trackId: 'mv-subtitle-track', kind: 'text' as const, timelineStart: (unit.startUs || 0) / 1_000_000, sourceIn: 0, sourceOut: ((unit.endUs || 0) - (unit.startUs || 0)) / 1_000_000 })),
        ],
        selectedItemIds: [], playhead: 0, zoom: 1, scrollLeft: 0, snapEnabled: true,
      };
      const renderPlan = buildVideoEditTimelineRenderPlan(timelineV2);
      if (renderPlan.unsupported.length) throw new Error(`最终时间线含不支持项：${renderPlan.unsupported.join('；')}`);
      if (renderPlan.clips.length !== acceptedVideos.length || renderPlan.audio.length !== 1 || renderPlan.text.length !== subtitleUnits.length) {
        throw new Error('最终时间线渲染计划与已确认素材数量不一致。');
      }
      const orderedClips = [...renderPlan.clips].sort((left, right) => left.timelineStart - right.timelineStart);
      let timelineCursor = 0;
      for (const clip of orderedClips) {
        if (Math.abs(clip.timelineStart - timelineCursor) > 0.001 || clip.timelineEnd <= clip.timelineStart) throw new Error('最终画面时间线存在空洞、重叠或无效片段。');
        timelineCursor = clip.timelineEnd;
      }
      if (Math.abs(timelineCursor - project.audio.durationUs / 1_000_000) > 0.001) throw new Error('最终画面时间线没有精确覆盖整首歌曲。');
      const decisionRevision = Math.max(0, ...Object.values(selectedAdoptionReceipts).map((receipt) => receipt.projectRevision));
      const persistedRenderPlan = JSON.parse(JSON.stringify(renderPlan, (key, value) => (
        ['url', 'directUrl', 'sourceUrl'].includes(key) ? undefined : value
      ))) as typeof renderPlan;
      const edlDocument = {
        schema: 't8-mv-edl-v1',
        projectRevision: decisionRevision,
        songSha256: project.audio.sha256,
        segmentPlanDigest: project.segmentConfirmation?.planDigest,
        renderPlan: persistedRenderPlan,
        selectedReviewReceipts,
        selectedAdoptionReceipts,
      };
      const edlText = JSON.stringify(edlDocument, null, 2);
      const edlDigest = await sha256Hex(edlText);
      let edlAsset: AssetRef | undefined;
      if (project.finalComposition?.edlDigest === edlDigest && project.finalComposition.edlAssetId) {
        const existing = await getProjectAsset(project.finalComposition.edlAssetId).catch(() => undefined);
        if (existing?.availability === 'available' && existing.contentHash === edlDigest) edlAsset = existing;
      }
      if (!edlAsset) {
        const edlChild = await createMvChildAttempt(reporter, {
          provider: 'local-host-artifact',
          model: 'json',
          jobId: `edl-${edlDigest.slice(0, 16)}`,
          jobKind: 'mv-edl',
          submissionKey: `t8-mv-edl-${edlDigest.slice(0, 40)}`,
        });
        try {
          await edlChild.providerRequest({ provider: 'local-host-artifact', model: 'json', contentHash: edlDigest });
          await edlChild.providerResponse({ provider: 'local-host-artifact', model: 'json', status: 'succeeded' });
          [edlAsset] = await edlChild.output({ assets: [{ kind: 'text', text: edlText, filename: 'mv-edl.json', mimeType: 'application/json', metadata: { contentHash: edlDigest, projectRevision: decisionRevision } }] });
          if (!edlAsset?.id || edlAsset.availability !== 'available' || edlAsset.contentHash !== edlDigest) throw new Error('MV EDL 未能持久化为可验证项目资产。');
          await edlChild.succeed({ assetId: edlAsset.id, contentHash: edlAsset.contentHash });
        } catch (error) {
          await edlChild.fail(error).catch(() => undefined);
          throw error;
        }
      }
      const settings: VideoEditSettings = {
        aspect: creativeBrief.aspectRatio as VideoEditSettings['aspect'],
        resolution: String(d.mvComposeResolution || '1080p') as VideoEditSettings['resolution'],
        transition: 'none',
        transitionDuration: 0,
        filter: 'none',
        audio: 'master-audio-replace',
        targetDuration: project.audio.durationUs / 1_000_000,
        autoCreateOutputNode: false,
      };
      const inputDigest = await sha256Hex(JSON.stringify({
        schema: 't8-mv-compose-input-v1',
        songSha256: project.audio.sha256,
        segmentPlanDigest: project.segmentConfirmation?.planDigest,
        videoCandidates: acceptedVideos.map(({ candidate }) => ({ id: candidate.id, contentHash: candidate.contentHash })),
        subtitlePolicy: creativeBrief.subtitles,
        subtitleUnits: subtitleUnits.map((unit) => ({ id: unit.id, text: unit.originalText, startUs: unit.startUs, endUs: unit.endUs })),
        settings,
        renderPlan,
        edlDigest,
        edlAssetId: edlAsset.id,
        selectedAdoptionReceipts,
      }));
      activeInputDigest = inputDigest;
      const savedComposition = project.finalComposition;
      const savedInputsMatch = !!savedComposition?.inputDigest && savedComposition.inputDigest === inputDigest;
      let jobId = !forceNew && savedInputsMatch ? savedComposition?.jobId || '' : '';
      let result: VideoComposeResult | undefined;
      if (jobId) {
        activeJobId = jobId;
        await child.providerRequest({ provider: 'local-ffmpeg', model: 'master-audio-replace', resumed: true, upstreamTaskId: jobId, inputDigest });
        let existingJob;
        try {
          existingJob = await getVideoEditJob(jobId, { signal: reporter.signal });
        } catch (error) {
          throw new MvRecoverableTaskError(`无法查询已有合成任务 ${jobId}；不会新建重复任务：${error instanceof Error ? error.message : String(error)}`);
        }
        if (existingJob.status === 'done') result = existingJob.result;
        else if (['failed', 'cancelled', 'interrupted'].includes(existingJob.status)) {
          throw new Error(`已有合成任务 ${jobId} 已明确终态 ${existingJob.status}：${existingJob.error || '无更多信息'}。如需重新提交，请点击“放弃旧任务并重新合成”。`);
        }
        await child.providerSubmitted({ provider: 'local-ffmpeg', model: 'master-audio-replace', upstreamTaskId: jobId, resumed: true });
      } else if (savedComposition?.jobId && !forceNew && !savedInputsMatch) {
        throw new Error('已有合成任务与当前歌曲、视频候选、字幕或输出设置摘要不一致；拒绝采用。请确认后点击“放弃旧任务并重新合成”。');
      }
      if (!jobId) {
        await child.providerRequest({ provider: 'local-ffmpeg', model: 'master-audio-replace', clipCount: clips.length, inputDigest, forceNew });
        const queued = await composeVideoEditAsync(clips, settings, { timelineV2, renderPlan }, { signal: reporter.signal });
        jobId = queued.id;
        activeJobId = jobId;
        if (!jobId) throw new Error('MV 合成未返回本地持久任务 ID。');
        patchProject({ stage: 'composing', finalComposition: { schema: 't8-mv-final-composition-v1', status: 'composing', songSha256: project.audio.sha256, expectedDurationUs: project.audio.durationUs, videoCandidateIds: acceptedVideos.map(({ candidate }) => candidate.id), jobId, inputDigest, edlDigest, edlAssetId: edlAsset.id, composeAttemptId: child.attemptId, createdAt: Date.now() } });
        await child.providerSubmitted({ provider: 'local-ffmpeg', model: 'master-audio-replace', upstreamTaskId: jobId });
      }
      for (let pollCount = 1; !result && pollCount <= 1800; pollCount += 1) {
        assertMvPollingContinues(pollingControlRef.current, reporter.signal);
        let job;
        try {
          job = await getVideoEditJob(jobId, { signal: reporter.signal });
        } catch (error) {
          throw new MvRecoverableTaskError(`合成任务 ${jobId} 查询中断，已保留任务 ID；不会新建重复任务：${error instanceof Error ? error.message : String(error)}`);
        }
        await child.providerPolling({ provider: 'local-ffmpeg', model: 'master-audio-replace', upstreamTaskId: jobId, pollCount, status: job.status, progress: job.progress });
        if (job.status === 'done') { result = job.result; break; }
        if (['failed', 'cancelled', 'interrupted'].includes(job.status)) throw new Error(job.error || `MV 合成任务 ${job.status}`);
        await sleep(1000, reporter.signal);
      }
      if (!result?.videoUrl) throw new MvRecoverableTaskError(`MV 合成任务 ${jobId} 在本地等待窗口内未结束，已保留任务 ID。`);
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      if (!result.masterAudioReplaced || result.timelineAudioCount !== 1 || result.audioStreamCount !== 1) throw new Error('最终成片未通过“唯一原曲音轨”合成回执。');
      if (result.masterAudioMode !== 'single-pass-transcode') throw new Error('最终成片缺少原曲单次转码策略回执。');
      if (result.masterAudioSourceSha256 !== project.audio.sha256) throw new Error('最终合成回执中的主音轨源哈希与权威原曲不一致。');
      if (Math.abs(Number(result.masterAudioSourceDuration || 0) - project.audio.durationUs / 1_000_000) > 0.001) throw new Error('最终合成回执中的主音轨源时长与权威原曲不一致。');
      if (subtitleUnits.length && (!result.subtitleBurnedIn || result.subtitleCount !== subtitleUnits.length)) throw new Error('最终成片的歌词字幕烧录数量与已确认歌词不一致。');
      if (!subtitleUnits.length && result.subtitleCount) throw new Error('选择“不烧录字幕”后，最终成片却包含字幕回执。');
      const probe = await probeVideo(result.videoUrl, { signal: reporter.signal });
      assertMvPollingContinues(pollingControlRef.current, reporter.signal);
      const drift = Math.abs(Number(probe.duration || 0) - project.audio.durationUs / 1_000_000);
      const frame = 1 / Math.max(1, Number(probe.fps || 30));
      if (!probe.hasVideo || !probe.hasAudio || probe.audioStreamCount !== 1 || !probe.contentHash) throw new Error('最终成片物理媒体校验失败。');
      if (drift > frame + 0.005) throw new Error(`最终成片与原曲时长偏差 ${drift.toFixed(3)}s，超过一帧。`);
      await child.providerResponse({ provider: 'local-ffmpeg', model: 'master-audio-replace', upstreamTaskId: jobId, status: 'succeeded' });
      let finalAsset: AssetRef | undefined;
      if (savedInputsMatch && savedComposition?.assetId && savedComposition.contentHash === probe.contentHash) {
        const existing = await getProjectAsset(savedComposition.assetId).catch(() => undefined);
        if (existing?.availability === 'available' && existing.contentHash === probe.contentHash && existing.sourceUrl) finalAsset = existing;
      }
      if (!finalAsset) {
        const finalAssets = await child.output({ assets: [{ kind: 'video', sourceUrl: result.videoUrl, filename: result.fileName || 'mv-final.mp4', metadata: { contentHash: probe.contentHash, duration: probe.duration, audioStreamCount: probe.audioStreamCount, masterAudioReplaced: true } }] });
        [finalAsset] = finalAssets;
      }
      if (!finalAsset?.id || !finalAsset.sourceUrl || finalAsset.availability !== 'available' || finalAsset.contentHash !== probe.contentHash) throw new Error('最终 MV 未能物化为可用项目资产。');
      const managedResult: VideoComposeResult = { ...result, videoUrl: finalAsset.sourceUrl, directVideoUrl: finalAsset.sourceUrl };
      await child.succeed({ contentHash: finalAsset.contentHash, assetId: finalAsset.id, jobId, inputDigest });
      composeChildSucceeded = true;
      interimComposition = {
        schema: 't8-mv-final-composition-v1', status: 'composing', result: managedResult,
        songSha256: project.audio.sha256, expectedDurationUs: project.audio.durationUs,
        videoCandidateIds: acceptedVideos.map(({ candidate }) => candidate.id), jobId, inputDigest,
        contentHash: finalAsset.contentHash, assetId: finalAsset.id,
        masterAudioMode: result.masterAudioMode, subtitleCount: result.subtitleCount || 0,
        durationDriftSeconds: drift, edlDigest, edlAssetId: edlAsset.id, edlText, composeAttemptId: child.attemptId,
        createdAt: project.finalComposition?.createdAt || Date.now(),
      };
      patchProject({ stage: 'composing', finalComposition: interimComposition });
      const storyboardUrls = shotTasks.map((task) => (project.imageCandidates?.[task.shot.shotId] || []).find((candidate) => candidate.id === project.acceptedImageIds?.[task.shot.shotId])?.outputUrl || '').filter(Boolean);
      const promptBundle = {
        schema: 't8-mv-prompt-delivery-v1',
        visualBible: acceptedBible?.bible,
        segments: promptSegments.map((segment) => {
          const promptCandidate = acceptedPromptForSegment(segment.segmentId);
          const videoCandidate = acceptedVideos.find((entry) => entry.segment.segmentId === segment.segmentId)?.candidate;
          return { segment, promptPack: promptCandidate?.pack, provider: videoCandidate?.provider, model: videoCandidate?.model, providerPrompt: videoCandidate?.providerPrompt, promptDigest: videoCandidate?.promptDigest };
        }),
      };
      const promptBundleText = JSON.stringify(promptBundle, null, 2);
      const promptContentHash = await sha256Hex(promptBundleText);
      let promptAsset: AssetRef | undefined;
      if (savedInputsMatch && savedComposition?.promptAssetId && savedComposition.promptContentHash === promptContentHash) {
        const existing = await getProjectAsset(savedComposition.promptAssetId).catch(() => undefined);
        if (existing?.availability === 'available' && existing.contentHash === promptContentHash) promptAsset = existing;
      }
      if (!promptAsset) {
        const promptChild = await createMvChildAttempt(reporter, { provider: 'local-host-artifact', model: 'json', jobId: `${jobId}-prompt-bundle`, jobKind: 'mv-delivery-prompt-bundle' });
        try {
          await promptChild.providerRequest({ provider: 'local-host-artifact', model: 'json', contentHash: promptContentHash });
          await promptChild.providerResponse({ provider: 'local-host-artifact', model: 'json', status: 'succeeded' });
          [promptAsset] = await promptChild.output({ assets: [{ kind: 'text', text: promptBundleText, filename: 'mv-prompt-bundle.json', mimeType: 'application/json' }] });
          if (!promptAsset?.id || promptAsset.availability !== 'available' || promptAsset.contentHash !== promptContentHash) throw new Error('MV Prompt 包未能持久化为可验证项目资产。');
          await promptChild.succeed({ assetId: promptAsset.id, contentHash: promptAsset.contentHash });
        } catch (error) {
          await promptChild.fail(error).catch(() => undefined);
          throw error;
        }
      }
      interimComposition = { ...interimComposition!, promptAssetId: promptAsset.id, promptContentHash: promptAsset.contentHash };
      patchProject({ stage: 'composing', finalComposition: interimComposition });
      const promptManifest = {
        schema: 't8-mv-delivery-manifest-v1', status: 'awaiting-user-qc', songSha256: project.audio.sha256, durationUs: project.audio.durationUs,
        segmentPlanDigest: project.segmentConfirmation?.planDigest, bibleCandidateId: project.acceptedBibleId,
        promptCandidateIds: project.acceptedPromptIds, imageCandidateIds: project.acceptedImageIds, videoCandidateIds: project.acceptedVideoIds,
        finalAssetId: finalAsset.id, finalContentHash: finalAsset.contentHash,
        promptBundleAssetId: promptAsset.id, promptBundleContentHash: promptAsset.contentHash,
        masterAudioMode: result.masterAudioMode, audioStreamCount: probe.audioStreamCount,
        subtitleCount: result.subtitleCount || 0, durationDriftSeconds: drift, inputDigest,
        edlDigest, edlAssetId: edlAsset.id, edlText, composeAttemptId: child.attemptId,
        reviewReceipts: selectedReviewReceipts,
        adoptionReceipts: selectedAdoptionReceipts,
        createdAt: project.finalComposition?.createdAt || interimComposition.createdAt,
      };
      const manifestText = JSON.stringify(promptManifest, null, 2);
      const manifestContentHash = await sha256Hex(manifestText);
      let manifestAsset: AssetRef | undefined;
      if (savedInputsMatch && savedComposition?.manifestAssetId && savedComposition.manifestContentHash === manifestContentHash) {
        const existing = await getProjectAsset(savedComposition.manifestAssetId).catch(() => undefined);
        if (existing?.availability === 'available' && existing.contentHash === manifestContentHash) manifestAsset = existing;
      }
      if (!manifestAsset) {
        const manifestChild = await createMvChildAttempt(reporter, { provider: 'local-host-artifact', model: 'json', jobId: `${jobId}-manifest`, jobKind: 'mv-delivery-manifest' });
        try {
          await manifestChild.providerRequest({ provider: 'local-host-artifact', model: 'json', contentHash: manifestContentHash });
          await manifestChild.providerResponse({ provider: 'local-host-artifact', model: 'json', status: 'succeeded' });
          [manifestAsset] = await manifestChild.output({ assets: [{ kind: 'text', text: manifestText, filename: 'mv-delivery-manifest.json', mimeType: 'application/json' }] });
          if (!manifestAsset?.id || manifestAsset.availability !== 'available' || manifestAsset.contentHash !== manifestContentHash) throw new Error('MV 交付清单未能持久化为可验证项目资产。');
          await manifestChild.succeed({ assetId: manifestAsset.id, contentHash: manifestAsset.contentHash });
        } catch (error) {
          await manifestChild.fail(error).catch(() => undefined);
          throw error;
        }
      }
      const validationReceipt: NonNullable<MvFinalComposition['validationReceipt']> = {
        schema: 't8-mv-physical-validation-receipt-v1',
        edlDigest,
        edlAssetId: edlAsset.id,
        finalAssetId: finalAsset.id,
        finalContentHash: finalAsset.contentHash,
        composeAttemptId: child.attemptId,
        sourceSongSha256: project.audio.sha256,
        masterAudioSourceSha256: result.masterAudioSourceSha256,
        masterAudioSourceDuration: Number(result.masterAudioSourceDuration),
        audioStreamCount: 1,
        durationDriftSeconds: drift,
        checkedAt: Date.now(),
      };
      const finalComposition: MvFinalComposition = {
        schema: 't8-mv-final-composition-v1', status: 'succeeded', result: managedResult,
        songSha256: project.audio.sha256, expectedDurationUs: project.audio.durationUs,
        videoCandidateIds: acceptedVideos.map(({ candidate }) => candidate.id), jobId, inputDigest,
        contentHash: finalAsset.contentHash, assetId: finalAsset.id,
        promptAssetId: promptAsset.id, promptContentHash: promptAsset.contentHash,
        manifestAssetId: manifestAsset.id, manifestContentHash: manifestAsset.contentHash,
        masterAudioMode: result.masterAudioMode, subtitleCount: result.subtitleCount || 0,
        durationDriftSeconds: drift,
        edlDigest, edlAssetId: edlAsset.id, edlText, composeAttemptId: child.attemptId,
        validationReceipt,
        promptBundleText, manifestText, storyboardUrls,
        createdAt: project.finalComposition?.createdAt || Date.now(), completedAt: Date.now(),
      };
      const next = patchProject({ stage: 'composing', finalComposition });
      update({ status: 'success', error: '', mvProject: next });
      setActiveStage('composing');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (reporter.signal?.aborted && activeJobId) await cancelVideoEditJob(activeJobId).catch(() => undefined);
      const recoverable = !reporter.signal?.aborted && error instanceof MvRecoverableTaskError && !!activeJobId;
      if (!composeChildSucceeded) {
        if (recoverable) await child?.interrupt(message, { jobId: activeJobId, inputDigest: activeInputDigest }).catch(() => undefined);
        else await child?.fail(error, { jobId: activeJobId || undefined, inputDigest: activeInputDigest || undefined }).catch(() => undefined);
      }
      patchProject({ stage: 'composing', finalComposition: {
        ...(interimComposition || {}),
        schema: 't8-mv-final-composition-v1', status: recoverable ? 'recoverable' : 'failed',
        songSha256: project.audio?.sha256 || '', expectedDurationUs: project.audio?.durationUs || 0,
        videoCandidateIds: Object.values(project.acceptedVideoIds || {}), jobId: activeJobId || undefined,
        inputDigest: activeInputDigest || undefined, createdAt: project.finalComposition?.createdAt || Date.now(),
        completedAt: Date.now(), error: message,
      } });
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const markFinalViewed = (video: HTMLVideoElement) => {
    const composition = project.finalComposition;
    if (!composition?.result?.videoUrl || composition.status !== 'succeeded' || composition.qcReport) return;
    const playbackEvidence = playbackCoverageEvidence(video);
    if (!playbackEvidence) {
      setLocalError('最终 MV 必须以 1× 速度从头到尾覆盖播放；拖到末尾不会签发 QCReport。');
      return;
    }
    const validation = composition.validationReceipt;
    if (!validation || !composition.assetId || !composition.contentHash || !composition.edlAssetId || !composition.edlDigest || !composition.composeAttemptId
      || validation.finalAssetId !== composition.assetId
      || validation.finalContentHash !== composition.contentHash
      || validation.edlAssetId !== composition.edlAssetId
      || validation.edlDigest !== composition.edlDigest
      || validation.composeAttemptId !== composition.composeAttemptId) {
      setLocalError('最终 MV 的物理校验回执与当前 EDL/合成产物不一致，不能签发 QC。');
      return;
    }
    const viewedAt = Date.now();
    const validationDigest = sha256BytesHex(new TextEncoder().encode(JSON.stringify(validation)));
    const qcReport: NonNullable<MvFinalComposition['qcReport']> = {
      schema: 't8-mv-qc-report-v2',
      passed: true,
      projectRevision: project.revision + 1,
      edlDigest: validation.edlDigest,
      edlAssetId: validation.edlAssetId,
      finalAssetId: validation.finalAssetId,
      composeAttemptId: validation.composeAttemptId,
      validationDigest,
      finalContentHash: validation.finalContentHash,
      sourceSongSha256: validation.sourceSongSha256,
      masterAudioSourceSha256: validation.masterAudioSourceSha256,
      masterAudioSourceDuration: validation.masterAudioSourceDuration,
      audioStreamCount: 1,
      durationDriftSeconds: validation.durationDriftSeconds,
      playbackEvidence,
      checkedAt: viewedAt,
    };
    patchProject({ finalComposition: { ...composition, viewedAt, qcReport } });
  };

  const deliverFinalMv = async (reporter: RunNodeLifecycleReporter) => {
    setLocalError('');
    setRunning(true);
    let child: MvChildAttempt | undefined;
    try {
      await assertProjectMaterialBytesCurrent(reporter.signal);
      const composition = project.finalComposition;
      if (!project.audio?.assetId || !composition?.result?.videoUrl || composition.status !== 'succeeded') throw new Error('最终 MV 尚未通过媒体 QC，或权威主歌曲尚未进入受管项目资产。');
      if (!composition.viewedAt) throw new Error('请先实际播放最终 MV，再确认交付。');
      if (!composition.qcReport?.passed || !composition.validationReceipt || !composition.edlDigest || !composition.edlAssetId || !composition.composeAttemptId || !composition.contentHash || !composition.assetId
        || !composition.promptAssetId || !composition.promptContentHash || !composition.manifestAssetId || !composition.manifestContentHash || !composition.edlText) throw new Error('最终 MV 缺少完整 EDL/QC/Prompt/Manifest 回执，禁止交付。');
      const validationDigest = await sha256Hex(JSON.stringify(composition.validationReceipt));
      if (composition.qcReport.validationDigest !== validationDigest
        || composition.qcReport.edlDigest !== composition.edlDigest
        || composition.qcReport.edlAssetId !== composition.edlAssetId
        || composition.qcReport.finalAssetId !== composition.assetId
        || composition.qcReport.finalContentHash !== composition.contentHash
        || composition.qcReport.composeAttemptId !== composition.composeAttemptId) throw new Error('最终 QC 回执未严格绑定当前 EDL、合成 Attempt 与成片资产。');
      if (await sha256Hex(composition.edlText) !== composition.edlDigest) throw new Error('内存中的 EDL 文本与持久 EDL 哈希不一致，禁止交付。');
      if (await sha256Hex(String(composition.promptBundleText || '')) !== composition.promptContentHash) throw new Error('Prompt Bundle 文本与持久资产哈希不一致，禁止交付。');
      if (await sha256Hex(String(composition.manifestText || '')) !== composition.manifestContentHash) throw new Error('待 QC Manifest 文本与持久资产哈希不一致，禁止交付。');
      const acceptedStoryboardAssets = shotTasks.map((task) => {
        const candidate = (project.imageCandidates?.[task.shot.shotId] || []).find((item) => item.id === project.acceptedImageIds?.[task.shot.shotId]);
        if (!candidate?.assetId || !candidate.contentHash) throw new Error(`${task.shot.shotId} 缺少已采用分镜资产，禁止交付。`);
        return { label: `分镜 ${task.shot.shotId}`, assetId: candidate.assetId, contentHash: candidate.contentHash };
      });
      const requiredManagedAssets = [
        { label: '权威主歌曲', assetId: project.audio.assetId, contentHash: project.audio.sha256 },
        { label: 'EDL', assetId: composition.edlAssetId, contentHash: composition.edlDigest },
        { label: '最终 MV', assetId: composition.assetId, contentHash: composition.contentHash },
        { label: 'Prompt Bundle', assetId: composition.promptAssetId, contentHash: composition.promptContentHash },
        { label: '待 QC Manifest', assetId: composition.manifestAssetId, contentHash: composition.manifestContentHash },
        ...acceptedStoryboardAssets,
      ];
      const verifiedManagedAssets: AssetRef[] = [];
      for (const selected of requiredManagedAssets) {
        const asset = await getProjectAsset(selected.assetId).catch(() => undefined);
        if (!asset || asset.availability !== 'available' || asset.contentHash !== selected.contentHash) throw new Error(`${selected.label} 资产已缺失、不可用或哈希变化，禁止交付。`);
        verifiedManagedAssets.push(asset);
      }
      const [masterAudioEvidence] = await readMvMaterialEvidence([{ id: project.audio.assetId, sourceNodeId: audio?.sourceNodeId, url: project.audio.sourceUrl, label: project.audio.sourceLabel }], reporter.signal);
      if (!masterAudioEvidence || masterAudioEvidence.contentHash !== project.audio.sha256 || masterAudioEvidence.byteLength !== project.audio.byteLength) throw new Error('交付时重新读取的主歌曲字节与分析阶段权威 SHA/大小不一致。');
      const qcDigest = await sha256Hex(JSON.stringify(composition.qcReport));
      const draftManifest = JSON.parse(String(composition.manifestText || '{}')) as Record<string, unknown>;
      if (draftManifest.schema !== 't8-mv-delivery-manifest-v1' || draftManifest.status !== 'awaiting-user-qc') throw new Error('待 QC Manifest schema/status 无效，禁止交付。');
      const promptBundle = JSON.parse(String(composition.promptBundleText || '{}')) as Record<string, unknown>;
      if (promptBundle.schema !== 't8-mv-prompt-delivery-v1') throw new Error('Prompt Bundle schema 无效，禁止交付。');
      const selection = {
        bibleCandidateId: project.acceptedBibleId,
        promptCandidateIds: project.acceptedPromptIds,
        imageCandidateIds: project.acceptedImageIds,
        videoCandidateIds: project.acceptedVideoIds,
      };
      const selectionDigest = await sha256Hex(JSON.stringify(selection));
      const licenseScope = {
        scopeDigest: approvals.scopeDigest,
        musicRights: approvals.musicRights,
        portraitConsent: approvals.portraitConsent,
        styleReferenceRights: styleImages.length ? approvals.styleReferenceRights : true,
      };
      if (!licenseScope.musicRights || !licenseScope.portraitConsent || !licenseScope.styleReferenceRights || !licenseScope.scopeDigest) throw new Error('当前输入范围缺少完整素材授权，禁止交付。');
      const licenseScopeDigest = await sha256Hex(JSON.stringify(licenseScope));
      const assetRecords = requiredManagedAssets.map((required, index) => ({
          label: required.label,
          assetId: required.assetId,
          contentHash: required.contentHash,
          byteLength: Number((verifiedManagedAssets[index]?.metadata as any)?.byteLength || (verifiedManagedAssets[index]?.metadata as any)?.size || 0),
        }));
      const totalKnownBytes = assetRecords.reduce((sum, item) => sum + Math.max(0, Number(item.byteLength) || 0), 0);
      const deliveryPackage = {
        ...draftManifest,
        schema: 't8-mv-delivery-manifest-v1',
        status: 'delivered',
        edlDigest: composition.edlDigest,
        edlAssetId: composition.edlAssetId,
        composeAttemptId: composition.composeAttemptId,
        qcReport: composition.qcReport,
        selection,
        selectionDigest,
        licenseScope,
        licenseScopeDigest,
        assets: assetRecords,
        assetCount: assetRecords.length,
        totalKnownBytes,
        manifestEnvelopePolicy: {
          finalManifestSelfExcluded: true,
          reason: '最终 Manifest 资产 ID/哈希在其内容持久化后才产生，禁止自引用；assets 列表包含作为前置证据的待 QC Manifest。',
          draftManifestAssetId: composition.manifestAssetId,
          draftManifestContentHash: composition.manifestContentHash,
        },
        reviewReceipts: draftManifest.reviewReceipts || {},
        adoptionReceipts: draftManifest.adoptionReceipts || {},
      };
      const packageDigest = await sha256Hex(JSON.stringify(deliveryPackage));
      const deliveryReceipt: NonNullable<MvFinalComposition['deliveryReceipt']> = {
        schema: 't8-mv-delivery-receipt-v1',
        projectRevision: project.revision + 1,
        finalAssetId: composition.assetId,
        finalContentHash: composition.contentHash,
        edlDigest: composition.edlDigest,
        packageDigest,
        qcDigest,
        assetCount: assetRecords.length,
        totalKnownBytes,
        selectionDigest,
        licenseScopeDigest,
        confirmedAt: Date.now(),
      };
      const deliveredManifest = {
        ...deliveryPackage,
        deliveryReceipt,
      };
      const manifestText = JSON.stringify(deliveredManifest, null, 2);
      const manifestContentHash = await sha256Hex(manifestText);
      child = await createMvChildAttempt(reporter, {
        provider: 'local-host-artifact',
        model: 'json',
        jobId: `${composition.jobId || 'mv-final'}-delivery`,
        jobKind: 'mv-delivery-confirmation',
        submissionKey: `t8-mv-delivery-${manifestContentHash.slice(0, 40)}`,
      });
      await child.providerRequest({ provider: 'local-host-artifact', model: 'json', contentHash: manifestContentHash });
      await child.providerResponse({ provider: 'local-host-artifact', model: 'json', status: 'succeeded' });
      const [manifestAsset] = await child.output({ assets: [{ kind: 'text', text: manifestText, filename: 'mv-delivery-manifest.json', mimeType: 'application/json' }] });
      if (!manifestAsset?.id || manifestAsset.availability !== 'available' || manifestAsset.contentHash !== manifestContentHash) throw new Error('最终交付清单未能持久化。');
      await child.succeed({ assetId: manifestAsset.id, contentHash: manifestAsset.contentHash, deliveryReceipt });
      const finalComposition: MvFinalComposition = {
        ...composition,
        manifestAssetId: manifestAsset.id,
        manifestContentHash: manifestAsset.contentHash,
        manifestText,
        deliveryReceipt,
      };
      const storyboardUrls = composition.storyboardUrls || [];
      const promptBundleText = String(composition.promptBundleText || '{}');
      const next = patchProject({ stage: 'delivered', finalComposition });
      update({
        status: 'success', error: '', mvProject: next,
        videoUrl: composition.result.videoUrl, directVideoUrl: composition.result.directVideoUrl || composition.result.videoUrl,
        audioUrl: project.audio.sourceUrl, imageUrls: storyboardUrls,
        outputText: manifestText, metadata: { ...deliveredManifest, manifestAssetId: manifestAsset.id, manifestContentHash: manifestAsset.contentHash },
        subflowOutputs: {
          'final-video': { videoUrl: composition.result.videoUrl, videoUrls: [composition.result.videoUrl] },
          'master-audio': { audioUrl: project.audio.sourceUrl, audioUrls: [project.audio.sourceUrl] },
          storyboards: { imageUrl: storyboardUrls[0], imageUrls: storyboardUrls },
          edl: { outputText: composition.edlText, metadata: { assetId: composition.edlAssetId, contentHash: composition.edlDigest } },
          'prompt-pack': { outputText: promptBundleText, metadata: { ...promptBundle, assetId: composition.promptAssetId, contentHash: composition.promptContentHash } },
          manifest: { outputText: manifestText, metadata: { ...deliveredManifest, assetId: manifestAsset.id, contentHash: manifestAsset.contentHash } },
        },
      });
      setActiveStage('delivered');
    } catch (error) {
      await child?.fail(error).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    } finally {
      setRunning(false);
    }
  };

  const canOpenStage = (stage: MvStage) => (STAGE_INDEX.get(stage) || 0) <= currentStageIndex;
  const requestAction = (action: MvRunAction) => {
    if (dispatchingRef.current || running) return;
    setLocalError('');
    dispatchingRef.current = true;
    setDispatching(true);
    pollingControlRef.current = { interrupted: false };
    pendingActionRef.current = action;
    if (!requestCanvasNodeRun(id)) {
      dispatchingRef.current = false;
      setDispatching(false);
      setLocalError('无法建立持久 Run/Attempt，已停止调用 Provider。');
    }
  };
  const stopLocalPolling = () => {
    pollingControlRef.current.interrupted = true;
    pollingControlRef.current.reason = '用户停止了本地轮询；远端 Provider 任务可能仍在运行或计费，可稍后用原 taskId 继续查询。';
    setLocalError(pollingControlRef.current.reason);
  };
  const requestRun = () => {
    setLocalError('');
    if (project.stage === 'materials') requestAction({ kind: 'analyze' });
    else {
      setActiveStage(project.stage);
      setWorkbenchOpen(true);
    }
  };

  const segmentRows = useMemo(() => project.segmentPlan?.segments.map((segment) => ({
    ...segment,
    lyrics: segment.lyricUnitIds.map((unitId) => project.lyricUnits.find((unit) => unit.id === unitId)?.originalText || '').filter(Boolean).join(' / '),
  })) || [], [project.segmentPlan, project.lyricUnits]);

  const workbench = workbenchOpen && typeof document !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[10020] flex bg-[#09090d] text-white" role="dialog" aria-modal="true" aria-label={mvT('workbenchAria')}>
      <aside className="flex w-[190px] shrink-0 flex-col border-r border-white/10 bg-[#101017] p-3">
        <div className="mb-4 flex items-center gap-2 px-1">
          <Clapperboard size={20} className="text-fuchsia-300" />
          <div>
            <div className="text-sm font-bold">{translate('nodes:mvMusicMaster.title')}</div>
            <div className="text-[10px] text-white/40">{mvT('directorReviewMode')}</div>
          </div>
        </div>
        <nav className="space-y-1">
          {STAGES.map((stage, index) => {
            const enabled = canOpenStage(stage.id);
            const current = activeStage === stage.id;
            const complete = index < currentStageIndex;
            return (
              <button
                key={stage.id}
                type="button"
                disabled={!enabled}
                onClick={() => setActiveStage(stage.id)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs ${current ? 'bg-fuchsia-500/20 text-fuchsia-100 ring-1 ring-fuchsia-400/30' : enabled ? 'text-white/65 hover:bg-white/5' : 'cursor-not-allowed text-white/20'}`}
              >
                <span>{stageDisplayLabel(stage.id)}</span>
                {complete ? <CheckCircle2 size={13} className="text-emerald-400" /> : <ChevronRight size={13} />}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[10px] leading-4 text-white/45">
          {mvT('paidGenerationNote')}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <div>
            <div className="text-sm font-semibold">{stageDisplayLabel(activeStage)}</div>
            <div className="text-[10px] text-white/40">{mvT('projectMeta', { revision: project.revision, model: MV_DEFAULT_LLM_MODEL })}</div>
          </div>
          <button type="button" onClick={() => setWorkbenchOpen(false)} className="rounded-lg border border-white/10 p-2 text-white/55 hover:bg-white/5 hover:text-white" aria-label={mvT('closeWorkbench')}><X size={17} /></button>
        </header>

        <section className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto mb-4 max-w-7xl rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="text-xs font-semibold text-amber-100">{mvT('approvalTitle')}</div><div className="mt-1 text-[10px] leading-4 text-white/45">{mvT('approvalNote')}</div></div>
              <label className="flex items-center gap-2 text-[10px] text-white/55">{mvT('maxTasksPerBatch')}<input type="number" min="1" max="200" value={approvals.maxTasksPerBatch} onChange={(event) => updateApprovals({ maxTasksPerBatch: Math.max(1, Math.min(200, Math.trunc(Number(event.target.value) || 1))) })} className="w-20 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white" /></label>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {([
                ['musicRights', 'approvalMusicRights'],
                ['portraitConsent', 'approvalPortraitConsent'],
                ['styleReferenceRights', 'approvalStyleRights'],
                ['paidGeneration', 'approvalPaidGeneration'],
              ] as const).map(([key, labelKey]) => <label key={key} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-white/65"><input type="checkbox" checked={approvals[key]} onChange={(event) => updateApprovals({ [key]: event.target.checked })} />{mvT(labelKey)}</label>)}
            </div>
          </div>
          {configurationDriftMessage && <div className="mx-auto mb-4 flex max-w-7xl items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-100"><AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{mvT('configurationDrift', { message: mvRuntimeText(configurationDriftMessage) })}</span></div>}
          {activeStage === 'materials' && (
            <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1.1fr_.9fr]">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <h2 className="mb-3 text-sm font-semibold">{mvT('songAndLyrics')}</h2>
                <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
                  <div className="flex items-center gap-2 text-white/70"><Music2 size={15} />{audio?.label || mvT('songNotConnected')}</div>
                  {project.audio && <div className="mt-1 text-[10px] text-white/40">{mvT('audioMeta', { duration: durationLabel(project.audio.durationUs), sampleRate: project.audio.sampleRate, channels: project.audio.channelCount, samples: project.audio.totalSamples.toLocaleString() })}</div>}
                </div>
                <FieldLabel>{mvT('authoritativeLyrics')}</FieldLabel>
                <textarea value={lyricsText} readOnly={hasUpstreamLyrics} onChange={(event) => {
                  if (hasUpstreamLyrics) return;
                  const value = event.target.value;
                  const reset: MvProjectState = { ...EMPTY_PROJECT, revision: project.revision + 1 };
                  update({ ...CLEARED_DELIVERY_OUTPUTS, lyricsText: value, mvProject: reset, status: 'idle', error: '' });
                  setActiveStage('materials');
                }} rows={16} className="w-full resize-y rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-5 text-white outline-none focus:border-fuchsia-400/50 read-only:cursor-not-allowed read-only:opacity-60" placeholder={mvT('lyricsPlaceholder')} />
                {hasUpstreamLyrics && <div className="mt-2 text-[10px] text-cyan-200/70">{mvT('upstreamLyricsNote')}</div>}
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <h2 className="mb-3 text-sm font-semibold">{mvT('visualMaterialRoles')}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {upstream.images.map((image, index) => (
                      <div key={image.id} className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
                        <img src={image.url} alt={image.label || mvT('referenceImageIndex', { index: index + 1 })} className="aspect-video w-full object-cover" />
                        <div className="p-2 text-[10px] text-white/60">{index === 0 ? mvT('identityDefault') : index === 1 ? mvT('styleDefault') : mvT('extraReferenceIndex', { index: index + 1 })}</div>
                      </div>
                    ))}
                  </div>
                  {!upstream.images.length && <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">{mvT('identityRequired')}</div>}
                </div>
                <button type="button" onClick={requestRun} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-4 py-3 text-sm font-semibold hover:bg-fuchsia-400 disabled:opacity-50">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <AudioLines size={16} />}
                  {mvT('decodeAndParse')}
                </button>
              </div>
            </div>
          )}

          {activeStage === 'segment-review' && (
            <div className="mx-auto max-w-7xl space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{mvT('waveformAndPreview')}</h2>
                    <p className="text-[10px] text-white/40">
                      {project.audio?.bpmEvidence?.verified
                        ? mvT('verifiedBpmEvidence', { bpm: project.audio.bpmEvidence.bpm, confidence: (project.audio.bpmEvidence.confidence * 100).toFixed(1) })
                        : mvT('unverifiedBpmEvidence', { candidate: project.audio?.bpmEvidence ? mvT('bpmCandidate', { bpm: project.audio.bpmEvidence.bpm, confidence: (project.audio.bpmEvidence.confidence * 100).toFixed(1) }) : '' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busy || !project.audio} onClick={() => requestAction({ kind: 'align-lyrics', forceNew: ['submitting', 'ambiguous'].includes(String(project.asrSubmission?.status || '')) })} className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-[11px] text-cyan-100 disabled:opacity-40">{['submitting', 'ambiguous'].includes(String(project.asrSubmission?.status || '')) ? mvT('newAsrRevision') : mvT('whisperAlign')}</button>
                    {previewRange && <button type="button" onClick={() => { audioPreviewRef.current?.pause(); setPreviewRange(null); }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">{mvT('stopAB')}</button>}
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                  <span className="text-[10px] text-white/45">{mvT('manualBpm')}</span>
                  <input type="number" min="30" max="300" step="0.01" value={manualBpm} onChange={(event) => setManualBpm(event.target.value)} placeholder={String(project.audio?.bpmEvidence?.bpm || 120)} className="w-24 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none" />
                  <button type="button" onClick={() => applyManualBpm(Number(manualBpm))} className="rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">{mvT('confirmManualBpm')}</button>
                  {project.audio?.bpmEvidence?.bpm && project.audio.bpmEvidence.bpm / 2 >= 30 && <button type="button" onClick={() => applyManualBpm(project.audio!.bpmEvidence!.bpm / 2)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px]">{mvT('useHalfBpm', { bpm: (project.audio.bpmEvidence.bpm / 2).toFixed(1) })}</button>}
                  {project.audio?.bpmEvidence?.bpm && project.audio.bpmEvidence.bpm * 2 <= 300 && <button type="button" onClick={() => applyManualBpm(project.audio!.bpmEvidence!.bpm * 2)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px]">{mvT('useDoubleBpm', { bpm: (project.audio.bpmEvidence.bpm * 2).toFixed(1) })}</button>}
                </div>
                <div className="mb-2 flex h-16 items-end gap-px overflow-hidden rounded-lg border border-white/10 bg-black/30 px-2 py-2" aria-label={mvT('waveformAria')}>
                  {(project.audio?.waveformPeaks || []).map((peak, index) => <span key={index} className="min-w-0 flex-1 rounded-t bg-gradient-to-t from-fuchsia-500/60 to-cyan-300/80" style={{ height: `${Math.max(4, peak * 100)}%` }} />)}
                </div>
                {project.audio && <audio
                  ref={audioPreviewRef}
                  src={project.audio.sourceUrl}
                  controls
                  preload="metadata"
                  className="h-9 w-full"
                  onTimeUpdate={(event) => {
                    if (!previewRange) return;
                    const player = event.currentTarget;
                    if (player.currentTime + 0.01 < previewRange.end) return;
                    if (previewRange.loop) { player.currentTime = previewRange.start; void player.play(); }
                    else { player.pause(); setPreviewRange(null); }
                  }}
                />}
                {previewRange && <div className="mt-2 text-[10px] text-cyan-200">{mvT('previewingRange', { label: previewRange.label, start: previewRange.start.toFixed(3), end: previewRange.end.toFixed(3), loop: previewRange.loop ? mvT('loopSuffix') : '' })}</div>}
              </div>
              <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">{mvT('lyricTimingEvidence')}</h2>
                      <p className="text-[10px] text-white/40">{mvT('lyricUnitMeta', { format: project.lyricFormat?.toUpperCase() || mvT('unparsed'), count: project.lyricUnits.length })}</p>
                    </div>
                    {project.lyricUnits.some((unit) => unit.startUs === undefined || unit.endUs === undefined) && (
                      <button type="button" onClick={buildManualTimingDraft} className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">{mvT('buildManualTimingDraft')}</button>
                    )}
                  </div>
                  <div className="max-h-[56vh] overflow-auto rounded-lg border border-white/10">
                    {project.lyricUnits.map((unit) => (
                      <div key={unit.id} className="grid grid-cols-[76px_76px_1fr_auto] items-center gap-2 border-b border-white/5 p-2 last:border-b-0">
                        <input type="number" step="0.001" min="0" value={unit.startUs === undefined ? '' : seconds(unit.startUs)} onChange={(event) => updateLyricTime(unit.id, 'startUs', Number(event.target.value))} className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] outline-none" aria-label={mvT('lyricStartAria', { id: unit.id })} />
                        <input type="number" step="0.001" min="0" value={unit.endUs === undefined ? '' : seconds(unit.endUs)} onChange={(event) => updateLyricTime(unit.id, 'endUs', Number(event.target.value))} className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] outline-none" aria-label={mvT('lyricEndAria', { id: unit.id })} />
                        <div className="min-w-0 whitespace-pre-wrap text-xs leading-5 text-white/75"><span className="mr-2 text-[9px] text-fuchsia-300">#{unit.occurrence}</span>{unit.originalText}<div className="text-[9px] text-white/30">{unit.timingSource || mvT('noTimingEvidence')}{unit.timingConfidence !== undefined ? ` · ${(unit.timingConfidence * 100).toFixed(0)}%` : ''}</div></div>
                        <button type="button" disabled={unit.startUs === undefined || unit.endUs === undefined} onClick={() => playPreviewRange(unit.startUs || 0, unit.endUs || 0, mvT('lyricPreviewLabel', { id: unit.id }), true)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] disabled:opacity-30">{mvT('loopPreview')}</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">{mvT('semanticSafeSegmentation')}</h2>
                      <p className="text-[10px] text-white/40">{mvT('segmentHardConstraint', { min: MV_SEGMENT_MIN_MS / 1000, max: MV_SEGMENT_MAX_MS / 1000 })}</p>
                    </div>
                    <button type="button" onClick={solveSegments} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-[11px] font-semibold hover:bg-sky-400"><Scissors size={14} />{mvT('solveAutomatically')}</button>
                  </div>
                  <div className="max-h-[56vh] space-y-2 overflow-auto pr-1">
                    {segmentRows.map((segment) => (
                      <div key={segment.id} className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-semibold">{mvT('segmentOrdinal', { ordinal: segment.ordinal })}</span>
                          <span className="font-mono text-emerald-200">{durationLabel(segment.durationUs)}</span>
                        </div>
                        <div className="text-[10px] text-white/40">{durationLabel(segment.startUs)} → {durationLabel(segment.endUs)} · {segment.durationSamples.toLocaleString()} samples</div>
                        <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-white/70">{segment.lyrics || mvT('instrumentalSegment')}</div>
                        <div className="mt-2 flex gap-2"><button type="button" onClick={() => playPreviewRange(segment.startUs, segment.endUs, mvT('segmentPreviewLabel', { ordinal: segment.ordinal }), true)} className="rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-100">{mvT('loopWholeSegment')}</button><button type="button" onClick={() => playPreviewRange(Math.max(0, segment.endUs - 750_000), Math.min(project.audio?.durationUs || segment.endUs, segment.endUs + 750_000), mvT('cutPreviewLabel', { ordinal: segment.ordinal }), false)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px]">{mvT('aroundCut')}</button></div>
                      </div>
                    ))}
                    {!segmentRows.length && <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-white/30">{mvT('solveAfterTiming')}</div>}
                  </div>
                </div>
              </div>
              {project.lyricWarnings.map((warning) => <div key={warning} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{warning}</div>)}
            </div>
          )}

          {activeStage === 'brief-review' && (
            <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <h2 className="mb-4 text-sm font-semibold">{mvT('creativeBrief')}</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div><FieldLabel>{mvT('mvType')}</FieldLabel><select value={String(d.mvType || 'hybrid')} onChange={(event) => updateCreativeSetting({ mvType: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="narrative">{mvT('mvTypes.narrative')}</option><option value="performance">{mvT('mvTypes.performance')}</option><option value="dance">{mvT('mvTypes.dance')}</option><option value="abstract">{mvT('mvTypes.abstract')}</option><option value="lyric-visual">{mvT('mvTypes.lyric-visual')}</option><option value="hybrid">{mvT('mvTypes.hybrid')}</option></select></div>
                  <div><FieldLabel>{mvT('creativity')}</FieldLabel><select value={String(d.creativity || 'balanced')} onChange={(event) => updateCreativeSetting({ creativity: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="conservative">{mvT('creativityOptions.conservative')}</option><option value="balanced">{mvT('creativityOptions.balanced')}</option><option value="creative">{mvT('creativityOptions.creative')}</option><option value="custom">{mvT('creativityOptions.custom')}</option></select></div>
                  <div><FieldLabel>{mvT('shotStrategy')}</FieldLabel><select value={String(d.shotMode || 'bpm-auto')} onChange={(event) => updateCreativeSetting({ shotMode: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="bpm-auto">{mvT('shotModes.bpm-auto')}</option><option value="semantic-auto">{mvT('shotModes.semantic-auto')}</option><option value="fixed">{mvT('shotModes.fixed')}</option></select></div>
                  <div><FieldLabel>{mvT('fixedShotCount')}</FieldLabel><select disabled={d.shotMode !== 'fixed'} value={Number(d.fixedShotCount || 4)} onChange={(event) => updateCreativeSetting({ fixedShotCount: Number(event.target.value) })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs disabled:opacity-40">{Array.from({ length: 20 }, (_, index) => <option key={index + 1} value={index + 1}>{mvT('shotsPerSegment', { count: index + 1 })}</option>)}</select></div>
                  <div><FieldLabel>{mvT('aspectRatio')}</FieldLabel><select value={String(d.aspectRatio || '16:9')} onChange={(event) => updateCreativeSetting({ aspectRatio: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map((value) => <option key={value}>{value}</option>)}</select></div>
                  <div><FieldLabel>{mvT('lyricSubtitles')}</FieldLabel><select value={String(d.subtitlePolicy || 'lyrics')} onChange={(event) => updateCreativeSetting({ subtitlePolicy: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="lyrics">{mvT('subtitleOptions.lyrics')}</option><option value="spatial-lyrics">{mvT('subtitleOptions.spatial-lyrics')}</option><option value="none">{mvT('subtitleOptions.none')}</option></select></div>
                  <div><FieldLabel>{mvT('llmProvider')}</FieldLabel><select value={isExternal ? providerSelection.providerId : isSeedanceNz ? 'seedance-nz' : 'zhenzhen'} onChange={(event) => selectLlmProvider(event.target.value)} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="seedance-nz">{mvT('budgetProviderDefault')}</option><option value="zhenzhen">{mvT('workshopProvider')}</option>{llmAdvancedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}</select></div>
                </div>
                <div className="mt-3"><FieldLabel>{mvT('visionLlmModel')}</FieldLabel>{isExternal ? <select value={activeModel} onChange={(event) => updateCreativeSetting({ providerModel: event.target.value, mvExternalVisionConfirmed: false })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{externalModels.map((model) => <option key={model}>{model}</option>)}</select> : isSeedanceNz ? <select value={activeModel} onChange={(event) => updateCreativeSetting({ providerModel: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{SEEDANCE_NZ_MV_VISION_MODELS.map((model) => <option key={model}>{model}</option>)}</select> : <select value={activeModel} onChange={(event) => updateCreativeSetting({ model: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{ZHENZHEN_LLM_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>}<div className="mt-1 text-[10px] text-white/35">{mvT('currentVisionModel', { provider: providerLabel, model: activeModel || mvT('modelNotSelected') })}</div>{isExternal && <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-2 text-[10px] text-amber-100"><input type="checkbox" checked={d.mvExternalVisionConfirmed === true} onChange={(event) => updateCreativeSetting({ mvExternalVisionConfirmed: event.target.checked })} className="mt-0.5" /><span>{mvT('externalVisionConfirmation')}</span></label>}</div>
                <div className="mt-3"><FieldLabel>{mvT('styleDirection')}</FieldLabel><textarea value={String(d.styleDescription || '')} onChange={(event) => updateCreativeSetting({ styleDescription: event.target.value })} rows={8} className="w-full resize-y rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-5 outline-none" placeholder={mvT('stylePlaceholder')} /></div>
                <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.03] p-3">
                  <div className="mb-2 text-xs font-semibold">{mvT('videoCapabilityPreflight')}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><FieldLabel>{mvT('family')}</FieldLabel><select value={videoFamily} onChange={(event) => updateCreativeSetting({ mvVideoFamily: event.target.value, mvVideoProvider: 'seedance-nz', mvVideoModel: event.target.value === 'hailuo' ? 'hailuo-h3-multi' : 'fast', mvVideoResolution: event.target.value === 'hailuo' ? '2K' : '720p' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="seedance">Seedance 2.0</option><option value="hailuo">MiniMax / Hailuo H3</option></select></div>
                    <div><FieldLabel>{mvT('provider')}</FieldLabel><select value={videoProvider} disabled={videoFamily === 'hailuo'} onChange={(event) => updateCreativeSetting({ mvVideoProvider: event.target.value, mvVideoModel: event.target.value === 'seedance-nz' ? 'fast' : 'doubao-seedance-2-0-fast-260128', mvVideoResolution: '720p' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs disabled:opacity-40"><option value="seedance-nz">{mvT('budgetProvider')}</option><option value="zhenzhen">{mvT('workshopShort')}</option></select></div>
                    <div><FieldLabel>{mvT('model')}</FieldLabel><select value={videoModel} onChange={(event) => updateCreativeSetting({ mvVideoModel: event.target.value, mvVideoResolution: event.target.value.startsWith('minimax-h3-ow-') ? '720p' : event.target.value.startsWith('hailuo-h3-') ? '2K' : '720p' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{(videoFamily === 'hailuo' ? HAILUO_VIDEO_MODELS : selectableSeedanceModels).map((model) => <option key={model}>{model}</option>)}</select></div>
                  </div>
                  <div className={`mt-2 text-[10px] ${videoBindsSegmentAudio ? 'text-emerald-300' : 'text-amber-200'}`}>{videoBindsSegmentAudio ? mvT('videoBindsAudio', { limit: videoImageReferenceLimit }) : mvT('videoWithoutAudio', { limit: videoImageReferenceLimit })}<br />{mvT('canonicalModelPreview', { selected: videoModel, canonical: canonicalVideoModelPreview })}</div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.05] p-4">
                  <h2 className="mb-2 text-sm font-semibold">{mvT('lockedSegments')}</h2>
                  <div className="text-3xl font-bold text-fuchsia-200">{segmentCount}</div>
                  <div className="mt-1 text-xs text-white/45">{mvT('lockedSegmentsNote')}</div>
                  {project.segmentConfirmation && <div className="mt-3 flex items-center gap-2 text-[10px] text-emerald-300"><LockKeyhole size={13} />{mvT('confirmationReceipt', { digest: project.segmentConfirmation.planDigest.slice(0, 12) })}</div>}
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-xs leading-6 text-white/60">
                  {mvT('promptBatchingNote')}
                </div>
              </div>
            </div>
          )}

          {activeStage === 'prompt-review' && (
            <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[.85fr_1.15fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div><h2 className="text-sm font-semibold">{mvT('visualBible')}</h2><div className="text-[10px] text-white/40">{mvT('visualBibleMeta', { count: (project.bibleCandidates || []).length, status: acceptedBible ? mvT('adopted') : mvT('pendingAdoption') })}</div></div>
                    <button type="button" onClick={() => requestAction({ kind: 'visual-bible', forceNew: visualBibleSubmissionUnresolved })} disabled={running} className="rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/10 px-3 py-2 text-[11px] text-fuchsia-100 disabled:opacity-50">{visualBibleSubmissionUnresolved ? mvT('resumeMissingRequests') : mvT('appendBibleVersion')}</button>
                  </div>
                  {latestBible ? (
                    <div className="max-h-[62vh] space-y-3 overflow-auto pr-1">
                      {(project.bibleCandidates || []).map((candidate) => <details key={candidate.id} open={project.acceptedBibleId === candidate.id || candidate.id === latestBible.id} className={`rounded-lg border p-3 ${project.acceptedBibleId === candidate.id ? 'border-emerald-400/50 bg-emerald-400/[0.04]' : 'border-white/10 bg-black/25'}`}>
                        <summary className="cursor-pointer text-sm font-semibold text-fuchsia-100">v{candidate.revision} · {candidate.bible.title}</summary>
                        <div className="mt-2 text-xs leading-5 text-white/65">{candidate.bible.visualThesis}</div><div className="mt-2 text-[10px] text-white/35">{candidate.provider} · {candidate.model} · SHA {candidate.contentHash?.slice(0, 12)}…</div>
                        <div className="mt-2 max-h-52 overflow-auto rounded border border-white/10 bg-black/20 p-2 text-[10px] leading-4 text-white/60"><pre className="whitespace-pre-wrap font-sans">{JSON.stringify(candidate.bible, null, 2)}</pre></div>
                        <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => markTextCandidateReviewed('visual-bible', candidate)} className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">{project.reviewReceipts?.[candidate.id] ? mvT('markedFullReview') : mvT('markFullReview')}</button><button type="button" disabled={!project.reviewReceipts?.[candidate.id]} onClick={() => acceptBible(candidate.id)} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-30 ${project.acceptedBibleId === candidate.id ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30' : 'bg-emerald-500 hover:bg-emerald-400'}`}><CheckCircle2 size={14} />{project.acceptedBibleId === candidate.id ? mvT('versionAdopted') : mvT('adoptHistoricalVersion')}</button></div>
                      </details>)}
                    </div>
                  ) : <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-white/30">{mvT('generateBibleAfterBrief')}</div>}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><h2 className="text-sm font-semibold">{mvT('segmentPromptPacks')}</h2><div className="text-[10px] text-white/40">{mvT('promptPackMeta', { accepted: acceptedPromptCount, total: promptSegments.length })}</div></div>
                  <button type="button" onClick={() => requestAction({ kind: 'prompt-packs', forceNew: promptSubmissionUnresolved })} disabled={running || !acceptedBible} className="rounded-lg bg-sky-500 px-3 py-2 text-[11px] font-semibold disabled:opacity-40">{promptSubmissionUnresolved ? mvT('resumeMissingSegments') : mvT('generateAllMissingBatches', { count: buildMvPromptBatches(promptSegments.filter((segment) => !(project.promptCandidates?.[segment.segmentId] || []).length)).length })}</button>
                </div>
                <div className="max-h-[68vh] space-y-3 overflow-auto pr-1">
                  {promptSegments.map((segment) => {
                    const candidates = project.promptCandidates?.[segment.segmentId] || [];
                    const latest = candidates.at(-1);
                    const acceptedId = project.acceptedPromptIds?.[segment.segmentId];
                    return (
                      <details key={segment.segmentId} className="rounded-lg border border-white/10 bg-black/20 p-3" open={!acceptedId}>
                        <summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold">{mvT('segmentShotCount', { ordinal: segment.ordinal, count: segment.shotCount })}</div><div className="mt-1 max-w-xl truncate text-[10px] text-white/40">{segment.lyricsExact || mvT('noLyricsSegment')}</div></div><div className={`text-[10px] ${acceptedId ? 'text-emerald-300' : latest ? 'text-amber-300' : 'text-white/30'}`}>{acceptedId ? mvT('adopted') : latest ? mvT('pendingReview') : mvT('missing')}</div></div></summary>
                        <div className="mt-3 space-y-2">
                          {latest ? <><div className="space-y-2">{candidates.map((candidate) => <details key={candidate.id} open={acceptedId === candidate.id || candidate.id === latest.id} className={`rounded border p-2 ${acceptedId === candidate.id ? 'border-emerald-400/50 bg-emerald-400/[0.04]' : 'border-white/10 bg-black/30'}`}><summary className="cursor-pointer text-[10px]">v{candidate.revision} · {candidate.provider} · {candidate.model}</summary><pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap font-sans text-[10px] leading-4 text-white/60">{JSON.stringify(candidate.pack, null, 2)}</pre><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => markTextCandidateReviewed(`prompt:${segment.segmentId}`, candidate)} className="rounded border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">{project.reviewReceipts?.[candidate.id] ? mvT('markedReview') : mvT('markReviewed')}</button><button type="button" disabled={!project.reviewReceipts?.[candidate.id]} onClick={() => acceptPromptCandidate(segment.segmentId, candidate.id)} className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-semibold disabled:opacity-30">{acceptedId === candidate.id ? mvT('versionAdopted') : mvT('adoptHistoricalVersion')}</button></div></details>)}</div><button type="button" onClick={() => requestAction({ kind: 'prompt-packs', segmentIds: [segment.segmentId], forceNew: promptSubmissionUnresolved })} disabled={running} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px]">{promptSubmissionUnresolved ? mvT('newSegmentRevision') : mvT('regenerateSegment')}</button><div className="text-[9px] text-white/30">{mvT('providerPromptCompileNote')}</div></> : <button type="button" onClick={() => requestAction({ kind: 'prompt-packs', segmentIds: [segment.segmentId], forceNew: promptSubmissionUnresolved })} disabled={running || !acceptedBible} className="w-full rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-[11px] text-sky-100 disabled:opacity-40">{promptSubmissionUnresolved ? mvT('generateSegmentRevision') : mvT('generateThisSegment')}</button>}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeStage === 'image-review' && (
            <div className="mx-auto max-w-7xl space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="grid min-w-[520px] flex-1 grid-cols-2 gap-3">
                  <div><FieldLabel>{mvT('imageProvider')}</FieldLabel><select value={imageProvider} onChange={(event) => update({ mvImageProvider: event.target.value, mvImageModel: event.target.value === 'zhenzhen' ? 'gpt-image-2' : 'zhenzhen-image-g2-i2i' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="seedance-nz">{mvT('budgetProviderDefault')}</option><option value="zhenzhen">{mvT('workshopProvider')}</option></select></div>
                  <div><FieldLabel>{mvT('actualModelId')}</FieldLabel><select value={imageModel} onChange={(event) => update({ mvImageModel: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{(imageProvider === 'seedance-nz' ? BUDGET_IMAGE_MODELS : WORKSHOP_IMAGE_MODELS).map((model) => <option key={model}>{model}</option>)}</select></div>
                </div>
                <div className="text-right"><div className="text-[10px] text-white/40">{mvT('missingImageTasks', { count: shotTasks.filter((task) => !(project.imageCandidates?.[task.shot.shotId] || []).some((candidate) => candidate.status === 'succeeded')).length })}</div><button type="button" disabled={running || !shotTasks.length} onClick={() => requestAction({ kind: 'images' })} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold disabled:opacity-40"><ImageIcon size={14} />{mvT('generateMissingStoryboards')}</button></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {shotTasks.map((task) => {
                  const candidates = project.imageCandidates?.[task.shot.shotId] || [];
                  const latest = candidates.at(-1);
                  const acceptedId = project.acceptedImageIds?.[task.shot.shotId];
                  const hasAmbiguous = candidates.some(mvSubmissionRequiresManualResolution);
                  return (
                    <div key={task.shot.shotId} className={`overflow-hidden rounded-xl border bg-white/[0.025] ${acceptedId ? 'border-emerald-400/35' : 'border-white/10'}`}>
                      <div className="flex items-center justify-between px-3 py-2"><div><div className="text-xs font-semibold">{mvT('segmentShotOrdinal', { segment: task.segment.ordinal, shot: task.shot.ordinal })}</div><div className="text-[9px] text-white/35">{mvT('candidateCount', { id: task.shot.shotId, count: candidates.length })}</div></div><span className={`text-[10px] ${acceptedId ? 'text-emerald-300' : latest?.status === 'failed' ? 'text-rose-300' : 'text-amber-200'}`}>{acceptedId ? mvT('adopted') : candidateStatusLabel(latest?.status)}</span></div>
                      <div className="space-y-2 p-3">
                        <div className="line-clamp-3 text-[10px] leading-4 text-white/55">{task.shot.imagePrompt}</div>
                        <div className="grid grid-cols-2 gap-2">
                          {candidates.map((candidate) => <div key={candidate.id} className={`overflow-hidden rounded-lg border ${acceptedId === candidate.id ? 'border-emerald-400/60' : 'border-white/10'} bg-black/30`}>
                            {candidate.outputUrl ? <button type="button" onClick={() => setViewingImage({ shotId: task.shot.shotId, candidateId: candidate.id, url: candidate.outputUrl! })} className="block aspect-video w-full bg-black"><img src={candidate.outputUrl} alt={mvT('imageCandidateAlt', { id: task.shot.shotId, revision: candidate.revision })} className="h-full w-full object-contain" /></button> : <div className="flex aspect-video items-center justify-center px-2 text-center text-[9px] text-white/30">{candidate.status === 'failed' ? candidate.error : candidateStatusLabel(candidate.status)}</div>}
                            <div className="space-y-1 p-2"><div className="text-[9px] text-white/35">v{candidate.revision} · {candidate.model}<br />{candidate.contentHash ? `SHA ${candidate.contentHash.slice(0, 10)}…` : candidateStatusLabel(candidate.status)}</div><button type="button" disabled={!candidate.viewedAt || !candidate.contentHash} onClick={() => acceptImageCandidate(task.shot.shotId, candidate.id)} className="w-full rounded bg-emerald-500 px-2 py-1 text-[9px] font-semibold disabled:opacity-30">{acceptedId === candidate.id ? mvT('adopted') : candidate.viewedAt ? mvT('adoptThisVersion') : mvT('enlargeBeforeAdopt')}</button></div>
                          </div>)}
                          {!candidates.length && <div className="col-span-2 flex aspect-video items-center justify-center rounded-lg border border-dashed border-white/10 text-[10px] text-white/25">{mvT('notGenerated')}</div>}
                        </div>
                        <button type="button" disabled={running} onClick={() => requestAction({ kind: 'images', shotIds: [task.shot.shotId], forceNew: true })} className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-[10px] disabled:opacity-40"><RefreshCw size={12} />{hasAmbiguous ? mvT('newRevisionAfterReview') : mvT('regenerateKeepHistory')}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeStage === 'video-review' && (
            <div className="mx-auto max-w-7xl space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="grid min-w-[650px] flex-1 grid-cols-4 gap-3">
                  <div><FieldLabel>{mvT('videoFamily')}</FieldLabel><select value={videoFamily} onChange={(event) => update({ mvVideoFamily: event.target.value, mvVideoProvider: 'seedance-nz', mvVideoModel: event.target.value === 'hailuo' ? 'hailuo-h3-multi' : 'fast', mvVideoResolution: event.target.value === 'hailuo' ? '2K' : '720p' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs"><option value="seedance">Seedance 2.0</option><option value="hailuo">MiniMax / Hailuo H3</option></select></div>
                  <div><FieldLabel>{mvT('provider')}</FieldLabel><select value={videoProvider} disabled={videoFamily === 'hailuo'} onChange={(event) => update({ mvVideoProvider: event.target.value, mvVideoModel: event.target.value === 'seedance-nz' ? 'fast' : 'doubao-seedance-2-0-fast-260128', mvVideoResolution: '720p' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs disabled:opacity-40"><option value="seedance-nz">{mvT('budgetProvider')}</option><option value="zhenzhen">{mvT('workshopProvider')}</option></select></div>
                  <div><FieldLabel>{mvT('modelSelection')}</FieldLabel><select value={videoModel} onChange={(event) => update({ mvVideoModel: event.target.value, mvVideoResolution: event.target.value.startsWith('minimax-h3-ow-') ? '720p' : event.target.value.startsWith('hailuo-h3-') ? '2K' : '720p' })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{(videoFamily === 'hailuo' ? HAILUO_VIDEO_MODELS : selectableSeedanceModels).map((model) => <option key={model}>{model}</option>)}</select></div>
                  <div><FieldLabel>{mvT('resolution')}</FieldLabel><select value={effectiveVideoResolution} onChange={(event) => update({ mvVideoResolution: event.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 p-2 text-xs">{videoResolutionOptions.map((value) => <option key={value}>{value}</option>)}</select></div>
                </div>
                <div className="mt-2 text-[10px] text-cyan-100/55">{mvT('canonicalModelPreview', { selected: videoModel, canonical: canonicalVideoModelPreview })}</div>
                <div className="text-right"><div className="text-[10px] text-white/40">{mvT('missingVideoTasks', { count: promptSegments.filter((segment) => !(project.videoCandidates?.[segment.segmentId] || []).some((candidate) => candidate.status === 'succeeded')).length })}</div><button type="button" disabled={running || !promptSegments.length} onClick={() => requestAction({ kind: 'videos' })} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-fuchsia-500 px-4 py-2 text-xs font-semibold disabled:opacity-40"><Clapperboard size={14} />{mvT('generateMissingVideos')}</button></div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {promptSegments.map((segment) => {
                  const candidates = project.videoCandidates?.[segment.segmentId] || [];
                  const latest = candidates.at(-1);
                  const acceptedId = project.acceptedVideoIds?.[segment.segmentId];
                  const hasAmbiguous = candidates.some(mvSubmissionRequiresManualResolution);
                  return (
                    <div key={segment.segmentId} className={`overflow-hidden rounded-xl border bg-white/[0.025] ${acceptedId ? 'border-emerald-400/35' : 'border-white/10'}`}>
                      <div className="flex items-center justify-between px-3 py-2"><div><div className="text-xs font-semibold">{mvT('segmentDuration', { ordinal: segment.ordinal, seconds: seconds(segment.durationUs) })}</div><div className="text-[9px] text-white/35">{mvT('videoCandidateMeta', { id: segment.segmentId, count: candidates.length, seconds: requestedVideoDuration(segment.durationUs) })}</div></div><span className={`text-[10px] ${acceptedId ? 'text-emerald-300' : latest?.status === 'failed' ? 'text-rose-300' : 'text-amber-200'}`}>{acceptedId ? mvT('adopted') : candidateStatusLabel(latest?.status)}</span></div>
                      <div className="space-y-3 p-3">
                        <div className="line-clamp-3 text-[10px] leading-4 text-white/55">{mvT('finalProviderPromptNote')}</div>
                        {candidates.map((candidate) => <div key={candidate.id} className={`overflow-hidden rounded-lg border ${acceptedId === candidate.id ? 'border-emerald-400/60' : 'border-white/10'} bg-black/30`}>
                          {candidate.outputUrl ? <video src={candidate.outputUrl} controls preload="metadata" className="aspect-video w-full bg-black object-contain" onPlay={(event) => beginPlaybackAudit(event.currentTarget)} onTimeUpdate={(event) => flushPlaybackAudit(event.currentTarget)} onPause={(event) => flushPlaybackAudit(event.currentTarget, false)} onSeeking={(event) => { invalidatePlaybackAudit(event.currentTarget, 'seek'); setLocalError(mvT('candidateSeekInvalid')); }} onRateChange={(event) => { if (Math.abs(event.currentTarget.playbackRate - 1) > 0.01) { invalidatePlaybackAudit(event.currentTarget, 'rate'); setLocalError(mvT('candidateRateInvalid')); } }} onError={(event) => invalidatePlaybackAudit(event.currentTarget, 'error')} onEnded={(event) => finishVideoCandidatePlayback(event.currentTarget, segment.segmentId, candidate.id)} /> : <div className="flex aspect-video w-full items-center justify-center px-6 text-center text-[10px] text-white/25">{candidate.status === 'failed' ? candidate.error : mvT('taskRecoverable', { status: candidateStatusLabel(candidate.status) })}</div>}
                          <div className="grid grid-cols-[1fr_auto] items-center gap-2 p-2"><div className="text-[9px] text-white/35">v{candidate.revision} · {candidate.model} · {candidate.actualDurationSeconds?.toFixed(3) || '-'}s<br />{candidate.contentHash ? `SHA ${candidate.contentHash.slice(0, 12)}…` : candidate.taskId || candidateStatusLabel(candidate.status)}</div><button type="button" disabled={!candidate.viewedAt || !candidate.contentHash} onClick={() => acceptVideoCandidate(segment.segmentId, candidate.id)} className="rounded bg-emerald-500 px-3 py-2 text-[9px] font-semibold disabled:opacity-30">{acceptedId === candidate.id ? mvT('adopted') : candidate.viewedAt ? mvT('adoptThisVersion') : mvT('playFullAt1x')}</button></div>
                        </div>)}
                        {!candidates.length && <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-white/10 text-[10px] text-white/25">{mvT('notGenerated')}</div>}
                        <button type="button" disabled={running} onClick={() => requestAction({ kind: 'videos', segmentIds: [segment.segmentId], forceNew: true })} className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-[10px] disabled:opacity-40"><RefreshCw size={12} />{hasAmbiguous ? mvT('newRevisionAfterReview') : mvT('regenerateSegmentKeepHistory')}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeStage === 'composing' && (
            <div className="mx-auto max-w-4xl space-y-4">
              <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.04] p-8 text-center">
                {running ? <Loader2 size={34} className="mx-auto mb-3 animate-spin text-fuchsia-300" /> : <Sparkles size={34} className="mx-auto mb-3 text-fuchsia-300" />}
                <div className="text-lg font-semibold">{mvT('masterTrackComposition')}</div>
                <div className="mx-auto mt-2 max-w-2xl text-xs leading-6 text-white/50">{mvT('masterTrackCompositionNote')}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-left text-[11px]">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-white/35">{mvT('confirmedVideos')}</div><div className="mt-1 text-base font-semibold">{acceptedVideoCount}/{promptSegments.length}</div></div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-white/35">{mvT('subtitlePolicy')}</div><div className="mt-1 text-base font-semibold">{creativeBrief.subtitles === 'none' ? mvT('subtitleOptions.noneShort') : creativeBrief.subtitles === 'spatial-lyrics' ? mvT('subtitleOptions.spatialShort') : mvT('subtitleOptions.bottomShort')}</div></div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3"><div className="text-white/35">{mvT('taskStatus')}</div><div className="mt-1 text-base font-semibold">{candidateStatusLabel(project.finalComposition?.status || 'pending')}</div></div>
                </div>
                {project.finalComposition?.jobId && <div className="mt-3 font-mono text-[10px] text-white/35">{mvT('localPersistentJob', { id: project.finalComposition.jobId })}</div>}
                {project.finalComposition?.error && <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-left text-xs text-rose-100">{project.finalComposition.error}</div>}
              </div>
              {project.finalComposition?.status === 'succeeded' && project.finalComposition.result?.videoUrl && (
                <div className="space-y-3 rounded-2xl border border-emerald-400/25 bg-black/30 p-3">
                  <video src={project.finalComposition.result.videoUrl} controls preload="metadata" onPlay={(event) => beginPlaybackAudit(event.currentTarget)} onTimeUpdate={(event) => flushPlaybackAudit(event.currentTarget)} onPause={(event) => flushPlaybackAudit(event.currentTarget, false)} onSeeking={(event) => { invalidatePlaybackAudit(event.currentTarget, 'seek'); setLocalError(mvT('finalSeekInvalid')); }} onRateChange={(event) => { if (Math.abs(event.currentTarget.playbackRate - 1) > 0.01) { invalidatePlaybackAudit(event.currentTarget, 'rate'); setLocalError(mvT('finalRateInvalid')); } }} onError={(event) => invalidatePlaybackAudit(event.currentTarget, 'error')} onEnded={(event) => markFinalViewed(event.currentTarget)} className="aspect-video w-full rounded-xl bg-black object-contain" />
                  <div className="grid gap-2 text-[10px] md:grid-cols-3">
                    <div className="rounded-lg border border-white/10 p-2">EDL <span className="font-mono text-emerald-200">{project.finalComposition.edlDigest?.slice(0, 12)}…</span></div>
                    <div className="rounded-lg border border-white/10 p-2">QC <span className={project.finalComposition.qcReport ? 'text-emerald-200' : 'text-amber-200'}>{project.finalComposition.qcReport ? mvT('playbackReceiptSigned') : mvT('physicalCheckAwaitPlayback')}</span></div>
                    <div className="rounded-lg border border-white/10 p-2">{mvT('finalReview')} <span className={project.finalComposition.viewedAt ? 'text-emerald-200' : 'text-amber-200'}>{project.finalComposition.viewedAt ? mvT('played') : mvT('playFirst')}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeStage === 'delivered' && (
            <div className="mx-auto max-w-5xl space-y-4">
              <div className="overflow-hidden rounded-2xl border border-emerald-400/25 bg-black/30">
                {project.finalComposition?.result?.videoUrl
                  ? <video src={project.finalComposition.result.videoUrl} controls preload="metadata" className="aspect-video w-full bg-black object-contain" />
                  : <div className="flex aspect-video items-center justify-center text-sm text-white/30">{mvT('deliveryUrlMissing')}</div>}
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs"><div className="text-white/35">{mvT('contentSha')}</div><div className="mt-1 break-all font-mono text-[10px] text-emerald-200">{project.finalComposition?.contentHash}</div></div>
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs"><div className="text-white/35">{mvT('audioTrackQc')}</div><div className="mt-1 font-semibold text-emerald-200">{mvT('singleOriginalTrack')}</div></div>
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs"><div className="text-white/35">{mvT('masterAudioPolicy')}</div><div className="mt-1 font-semibold text-emerald-200">{project.finalComposition?.masterAudioMode || mvT('awaitingReceipt')}</div></div>
                <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs"><div className="text-white/35">{mvT('durationDrift')}</div><div className="mt-1 font-semibold text-emerald-200">{mvT('secondsValue', { value: (project.finalComposition?.durationDriftSeconds || 0).toFixed(4) })}</div></div>
              </div>
              {project.finalComposition?.result?.videoUrl && <a href={project.finalComposition.result.videoUrl} download={project.finalComposition.result.fileName || 'mv-final.mp4'} className="flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold hover:bg-emerald-400">{mvT('downloadFinalMv')}</a>}
            </div>
          )}
        </section>

        <footer className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-[#101017] px-5 py-3">
          <div className="min-w-0 text-xs text-rose-200">{mvRuntimeText(localError || d.error || '')}</div>
          <div className="flex shrink-0 items-center gap-2">
            {running && ['images', 'videos', 'compose'].includes(pendingActionRef.current.kind) && <button type="button" onClick={stopLocalPolling} className="inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-100"><Pause size={15} />{mvT('stopLocalPolling')}</button>}
            {activeStage === 'segment-review' && project.segmentPlan && (
              <button type="button" onClick={confirmSegments} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold hover:bg-emerald-400"><CheckCircle2 size={15} />{mvT('confirmSegments')}</button>
            )}
            {activeStage === 'brief-review' && (
              <button type="button" onClick={() => requestAction({ kind: 'visual-bible', forceNew: visualBibleSubmissionUnresolved })} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-500 px-4 py-2 text-xs font-semibold hover:bg-fuchsia-400 disabled:opacity-50"><Sparkles size={15} />{visualBibleSubmissionUnresolved ? mvT('resumeMissingRequests') : mvT('confirmBrief', { count: buildMvPromptBatches(promptSegments).length })}</button>
            )}
            {activeStage === 'prompt-review' && acceptedPromptCount === promptSegments.length && promptSegments.length > 0 && (
              <button type="button" onClick={finishPromptReview} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold hover:bg-emerald-400"><CheckCircle2 size={15} />{mvT('confirmAllPrompts')}</button>
            )}
            {activeStage === 'image-review' && acceptedImageCount === shotTasks.length && shotTasks.length > 0 && (
              <button type="button" onClick={finishImageReview} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold hover:bg-emerald-400"><CheckCircle2 size={15} />{mvT('confirmAllStoryboards')}</button>
            )}
            {activeStage === 'video-review' && acceptedVideoCount === promptSegments.length && promptSegments.length > 0 && (
              <button type="button" onClick={finishVideoReview} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold hover:bg-emerald-400"><CheckCircle2 size={15} />{mvT('confirmAllVideos')}</button>
            )}
            {activeStage === 'composing' && (
              <>
                {project.finalComposition?.status === 'succeeded'
                  ? <button type="button" onClick={() => requestAction({ kind: 'deliver' })} disabled={busy || !project.finalComposition.qcReport} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-40"><CheckCircle2 size={15} />{mvT('confirmQcAndDeliver')}</button>
                  : <button type="button" onClick={() => requestAction({ kind: 'compose' })} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-500 px-4 py-2 text-xs font-semibold hover:bg-fuchsia-400 disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{project.finalComposition?.jobId ? mvT('resumeComposition') : mvT('startComposition')}</button>}
                {project.finalComposition?.jobId && ['failed', 'recoverable'].includes(project.finalComposition.status) && <button type="button" onClick={() => requestAction({ kind: 'compose', forceNew: true })} disabled={busy} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-100 disabled:opacity-40">{mvT('abandonAndRecompose')}</button>}
              </>
            )}
          </div>
        </footer>
      </main>
      {viewingImage && <div className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/90 p-8" onClick={() => setViewingImage(null)} role="dialog" aria-modal="true" aria-label={mvT('viewStoryboardCandidate')}>
        <div className="max-h-full max-w-[92vw]" onClick={(event) => event.stopPropagation()}>
          <img src={viewingImage.url} alt={mvT('storyboardCandidateImage')} onLoad={() => markImageViewed(viewingImage.shotId, viewingImage.candidateId)} className="max-h-[82vh] max-w-full rounded-xl object-contain" />
          <div className="mt-3 flex items-center justify-between gap-3"><div className="text-xs text-white/55">{mvT('imageViewReceipt', { id: viewingImage.candidateId })}</div><button type="button" onClick={() => setViewingImage(null)} className="rounded-lg bg-white/10 px-4 py-2 text-xs">{mvT('close')}</button></div>
        </div>
      </div>}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div className="relative w-[410px]">
        <Handle id="master-audio" type="target" position={Position.Left} style={{ top: '28%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-amber-400" />
        <Handle id="lyrics" type="target" position={Position.Left} style={{ top: '40%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-emerald-400" />
        <Handle id="identity-image" type="target" position={Position.Left} style={{ top: '52%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-sky-400" />
        <Handle id="style-image" type="target" position={Position.Left} style={{ top: '64%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-violet-400" />
        <Handle id="motion-reference" type="target" position={Position.Left} style={{ top: '76%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-orange-400" />
        <PortLabel side="left" top="28%">{mvT('ports.song')}</PortLabel><PortLabel side="left" top="40%">{mvT('ports.lyrics')}</PortLabel><PortLabel side="left" top="52%">{mvT('ports.identity')}</PortLabel><PortLabel side="left" top="64%">{mvT('ports.style')}</PortLabel><PortLabel side="left" top="76%">{mvT('ports.motion')}</PortLabel>

        <Handle id="final-video" type="source" position={Position.Right} style={{ top: '28%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-cyan-400" />
        <Handle id="master-audio" type="source" position={Position.Right} style={{ top: '40%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-amber-400" />
        <Handle id="storyboards" type="source" position={Position.Right} style={{ top: '52%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-sky-400" />
        <Handle id="prompt-pack" type="source" position={Position.Right} style={{ top: '64%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-emerald-400" />
        <Handle id="manifest" type="source" position={Position.Right} style={{ top: '76%' }} className="!h-3 !w-3 !border-2 !border-[#0d0d12] !bg-fuchsia-400" />
        <PortLabel side="right" top="28%">{mvT('ports.finalVideo')}</PortLabel><PortLabel side="right" top="40%">{mvT('ports.masterAudio')}</PortLabel><PortLabel side="right" top="52%">{mvT('ports.storyboards')}</PortLabel><PortLabel side="right" top="64%">Prompt</PortLabel><PortLabel side="right" top="76%">{mvT('ports.manifest')}</PortLabel>

        <div className={`overflow-hidden rounded-2xl border-2 bg-[#111117]/95 transition ${selected ? 'border-fuchsia-400 shadow-2xl shadow-fuchsia-500/20' : 'border-white/15 hover:border-white/30'}`}>
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/30"><Clapperboard size={19} /></div>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-white">{translate('nodes:mvMusicMaster.title')}</div><div className="truncate text-[10px] text-white/40">{mvT('compactSubtitle')}</div></div>
            {running ? <Loader2 size={17} className="animate-spin text-fuchsia-300" /> : d.status === 'success' ? <CheckCircle2 size={17} className="text-emerald-400" /> : null}
          </div>

          <div className="nodrag nowheel space-y-3 p-4" onMouseDown={(event) => event.stopPropagation()}>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2"><div className="text-lg font-bold text-white">{upstream.audios.length}</div><div className="text-[9px] text-white/35">{mvT('song')}</div></div>
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2"><div className="text-lg font-bold text-white">{project.lyricUnits.length || upstream.texts.length}</div><div className="text-[9px] text-white/35">{mvT('lyricUnits')}</div></div>
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2"><div className="text-lg font-bold text-white">{upstream.images.length}</div><div className="text-[9px] text-white/35">{mvT('referenceImages')}</div></div>
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2"><div className="text-lg font-bold text-fuchsia-200">{segmentCount}</div><div className="text-[9px] text-white/35">{mvT('audioSegments')}</div></div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between text-[10px]"><span className="text-white/45">{mvT('currentStage')}</span><span className="font-semibold text-fuchsia-200">{stageDisplayLabel(project.stage)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400" style={{ width: `${((currentStageIndex + 1) / STAGES.length) * 100}%` }} /></div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-white/40"><Clock3 size={12} />{project.audio ? `${durationLabel(project.audio.durationUs)} · ${project.audio.sampleRate} Hz` : mvT('waitingSongDecode')}</div>
            </div>

            {(localError || d.error) && <div className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[10px] leading-4 text-rose-100"><AlertCircle size={13} className="mt-0.5 shrink-0" />{mvRuntimeText(localError || String(d.error))}</div>}

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button type="button" onClick={requestRun} disabled={running} className="flex items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-3 py-2.5 text-xs font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50">{running ? <Loader2 size={14} className="animate-spin" /> : project.stage === 'materials' ? <Play size={14} /> : <Pause size={14} />}{project.stage === 'materials' ? mvT('startLocalAnalysis') : mvT('continueProject')}</button>
              <button type="button" onClick={() => { setActiveStage(project.stage); setWorkbenchOpen(true); }} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 text-white/60 hover:bg-white/10 hover:text-white" title={mvT('openFullscreenWorkbench')}><Maximize2 size={16} /></button>
            </div>
            <div className="text-center text-[9px] leading-4 text-white/30">{mvT('compactPaidSafetyNote')}</div>
          </div>
        </div>
      </div>
      {workbench}
    </>
  );
}

export default memo(MvMusicMasterNode);
