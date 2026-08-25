import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, Loader2, Music, Sparkles, Square, Upload, X } from 'lucide-react';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import {
  submitAudio,
  queryAudio,
  submitSunoNz,
  querySunoNz,
  submitFlowMusic,
  queryFlowMusic,
  submitSeedAudio,
  querySeedAudio,
  submitSeedanceNzAudio,
  querySeedanceNzAudio,
  transcribeWhisper,
  buildWhisperTranscriptEvidence,
  uploadAudioForSuno,
  uploadFile as uploadLocalFile,
  type AudioMode,
  type AudioProviderMode,
  type SunoPlatform,
  type SunoNzTaskResult,
  type FlowMusicTaskResult,
  type SeedanceNzAudioQueryResult,
  type WhisperResponseFormat,
} from '../../services/generation';
import {
  SUNO_VERSIONS,
  DEFAULT_SUNO_VERSION,
  DEFAULT_SUNO_NZ_OPERATION,
  SUNO_NZ_ACTIONS,
  getSunoNzActionDef,
  QWEN3_TTS_MODELS,
  QWEN3_TTS_FLASH_MODEL,
  QWEN3_TTS_INSTRUCT_FLASH_MODEL,
  QWEN3_TTS_LANGUAGE_TYPES,
  MINIMAX_AUDIO_MODELS,
  MINIMAX_MUSIC_MODEL,
  MINIMAX_SPEECH_HD_MODEL,
  MINIMAX_SPEECH_TURBO_MODEL,
  MINIMAX_VOICE_CLONE_MODEL,
  MINIMAX_AUDIO_FORMATS,
  MINIMAX_SAMPLE_RATES,
  MINIMAX_BITRATES,
  MINIMAX_LANGUAGE_BOOSTS,
  MUREKA_BGM_MODELS,
  FLOWMUSIC_ACTIONS,
  FLOWMUSIC_FORMATS,
  FLOWMUSIC_VIDEO_PRESETS,
  FLOWMUSIC_VERSIONS,
  getFlowMusicActionDef,
  type FlowMusicOperation,
  type SunoNzOperation,
} from '../../providers/models';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { logBus } from '../../stores/logs';
import { PORT_COLOR } from '../../config/portTypes';
import { useThemeStore } from '../../stores/theme';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import ReuseResultToggle from './ReuseResultToggle';
import MentionPromptInput from './MentionPromptInput';
import LazyAudio from '../LazyAudio';
import LazyVideo from '../LazyVideo';
import { resolveMediaMentions, type MediaMention } from './mediaMentions';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import { LocalNodeAddonSlot } from 'virtual:t8-local-extensions';

/**
 * AudioNode - Suno (generate / cover / extend) — 完全对齐 gpt-image-2-web
 * 参考: gpt-image-2-web/index.html runSuno (L3979) / runSunoCover (L4282) / runSunoExtend (L4313) / pollSuno (L4015) / _sunoUploadAudio (L4210)
 * 该节点不提供 FAL 模式。
 */

const MODES: Array<{ id: AudioMode; label: string }> = [
  { id: 'generate', label: '生成' },
  { id: 'cover', label: '翻唱(Cover)' },
  { id: 'extend', label: '续写(Extend)' },
];

const SUNO_POLL_INTERVAL_MS = 3000;
const SUNO_POLL_TIMEOUT_SECONDS = 3600;
const SUNO_MAX_POLL = Math.ceil((SUNO_POLL_TIMEOUT_SECONDS * 1000) / SUNO_POLL_INTERVAL_MS);

function audioUploadExtension(mime: string, preferredName: string, url: string): string {
  const normalizedMime = String(mime || '').toLowerCase().split(';')[0].trim();
  const byMime: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'application/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/x-ms-wma': 'wma',
  };
  const nameExt = String(preferredName || '').match(/\.(mp3|wav|m4a|ogg|flac|aac|wma)$/i)?.[1];
  if (nameExt) return nameExt.toLowerCase();
  if (byMime[normalizedMime]) return byMime[normalizedMime];
  const urlExt = String(url || '').split(/[?#]/)[0].match(/\.(mp3|wav|m4a|ogg|flac|aac|wma)$/i)?.[1];
  return (urlExt || 'mp3').toLowerCase();
}

const AudioNode = ({ id, data, selected }: NodeProps) => {
  const { t: translate } = useTranslation(['nodes', 'common']);
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const src = `audio:${id.slice(0, 6)}`;

  // 主题适配
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';

  const d = data as any;
  const providerParams = (d?.providerParams && typeof d.providerParams === 'object') ? d.providerParams : {};
  const audioProviderMode: AudioProviderMode = ['seed-audio', 'whisper', 'qwen3-tts', 'minimax', 'mureka', 'lyria'].includes(d?.audioProviderMode)
    ? d.audioProviderMode
    : 'suno';
  const isSeedAudio = audioProviderMode === 'seed-audio';
  const isWhisper = audioProviderMode === 'whisper';
  const isQwen3Tts = audioProviderMode === 'qwen3-tts';
  const isMinimaxAudio = audioProviderMode === 'minimax';
  const isMureka = audioProviderMode === 'mureka';
  const isLyria = audioProviderMode === 'lyria';
  const isSeedanceNzAudio = isQwen3Tts || isMinimaxAudio || isMureka;
  const isSuno = audioProviderMode === 'suno';
  const sunoPlatform: SunoPlatform = d?.sunoPlatform === 'seedance-nz' ? 'seedance-nz' : 'zhenzhen';
  const isSunoNz = isSuno && sunoPlatform === 'seedance-nz';
  const sunoNzOperation: SunoNzOperation = getSunoNzActionDef(d?.sunoNzOperation || DEFAULT_SUNO_NZ_OPERATION).value;
  const sunoNzAction = getSunoNzActionDef(sunoNzOperation);
  const mode: AudioMode = d?.mode || 'generate';
  const version: string = d?.version || DEFAULT_SUNO_VERSION;
  const sunoNzVersion = sunoNzAction.allowedVersions.includes(d?.sunoNzVersion)
    ? d.sunoNzVersion
    : sunoNzAction.defaultVersion || sunoNzAction.allowedVersions[0] || '';
  const title: string = d?.title || '';
  const tags: string = d?.tags || '';
  const sunoStyle: string = d?.sunoStyle || '';
  const sunoVocalGender: string = d?.sunoVocalGender || '';
  const sunoCustom: boolean = d?.sunoCustom === true;
  const sunoInstrumental: boolean = d?.sunoInstrumental === true;
  const sunoTaskRef: string = d?.sunoTaskRef || '';
  const sunoTaskRef2: string = d?.sunoTaskRef2 || '';
  const sunoAudioIndex: number = Number.isInteger(d?.sunoAudioIndex) && d.sunoAudioIndex > 0 ? d.sunoAudioIndex : 1;
  const sunoStartSeconds: number = Number.isFinite(d?.sunoStartSeconds) ? d.sunoStartSeconds : 0;
  const sunoEndSeconds: number = Number.isFinite(d?.sunoEndSeconds) ? d.sunoEndSeconds : 10;
  const sunoDurationSeconds: number = Number.isFinite(d?.sunoDurationSeconds) ? d.sunoDurationSeconds : 3;
  const sunoSpeed: number = Number.isFinite(d?.sunoSpeed) ? d.sunoSpeed : 1;
  const sunoPersonaName: string = d?.sunoPersonaName || '';
  const sunoResultText: string = typeof d?.sunoResultText === 'string' ? d.sunoResultText : '';
  const sunoVideoUrls: string[] = Array.isArray(d?.sunoVideoUrls) ? d.sunoVideoUrls : [];
  const sunoFileUrls: string[] = Array.isArray(d?.sunoFileUrls) ? d.sunoFileUrls : [];
  const localPrompt: string = d?.prompt || '';
  const promptMentions: MediaMention[] = Array.isArray(d?.promptMentions) ? d.promptMentions : [];
  const seed: number = typeof d?.seed === 'number' ? d.seed : 0;
  const continueAt: number = d?.continueAt ?? 28;
  const seedAudioSpeaker: string = d?.seedAudioSpeaker || '';
  const seedAudioFormat: 'wav' | 'mp3' | 'pcm' | 'ogg_opus' = ['wav', 'mp3', 'pcm', 'ogg_opus'].includes(d?.seedAudioFormat) ? d.seedAudioFormat : 'wav';
  const seedAudioSampleRate: '8000' | '16000' | '24000' | '32000' | '44100' = ['8000', '16000', '24000', '32000', '44100'].includes(String(d?.seedAudioSampleRate)) ? String(d.seedAudioSampleRate) as any : '24000';
  const seedAudioSpeechRate: number = Number.isInteger(d?.seedAudioSpeechRate) ? d.seedAudioSpeechRate : 0;
  const seedAudioLoudnessRate: number = Number.isInteger(d?.seedAudioLoudnessRate) ? d.seedAudioLoudnessRate : 0;
  const seedAudioPitchRate: number = Number.isInteger(d?.seedAudioPitchRate) ? d.seedAudioPitchRate : 0;
  const qwenTtsModel = (QWEN3_TTS_MODELS as readonly string[]).includes(d?.qwenTtsModel)
    ? d.qwenTtsModel
    : QWEN3_TTS_FLASH_MODEL;
  const qwenTtsVoice: string = String(d?.qwenTtsVoice || 'Cherry');
  const qwenTtsLanguage: string = (QWEN3_TTS_LANGUAGE_TYPES as readonly string[]).includes(d?.qwenTtsLanguage)
    ? d.qwenTtsLanguage
    : 'Chinese';
  const qwenTtsInstructions: string = String(d?.qwenTtsInstructions || '');
  const qwenTtsOptimizeInstructions: boolean = d?.qwenTtsOptimizeInstructions !== false;
  const minimaxAudioModel = (MINIMAX_AUDIO_MODELS as readonly string[]).includes(d?.minimaxAudioModel)
    ? d.minimaxAudioModel
    : MINIMAX_SPEECH_TURBO_MODEL;
  const minimaxLyrics: string = String(d?.minimaxLyrics || '');
  const minimaxInstrumental: boolean = d?.minimaxInstrumental !== false;
  const minimaxLyricsOptimizer: boolean = d?.minimaxLyricsOptimizer === true;
  const minimaxVoiceId: string = String(d?.minimaxVoiceId || 'Wise_Woman');
  const minimaxSpeed: number = Math.min(2, Math.max(0.5, Number(d?.minimaxSpeed) || 1));
  const minimaxVolume: number = Math.min(10, Math.max(0.1, Number(d?.minimaxVolume) || 1));
  const minimaxPitch: number = Math.min(12, Math.max(-12, Number.isInteger(d?.minimaxPitch) ? d.minimaxPitch : 0));
  const minimaxLanguageBoost: string = (MINIMAX_LANGUAGE_BOOSTS as readonly string[]).includes(d?.minimaxLanguageBoost)
    ? d.minimaxLanguageBoost
    : 'auto';
  const minimaxOutputFormat: 'mp3' | 'wav' | 'flac' = (MINIMAX_AUDIO_FORMATS as readonly string[]).includes(d?.minimaxOutputFormat)
    ? d.minimaxOutputFormat
    : 'mp3';
  const minimaxSampleRate: '16000' | '24000' | '32000' | '44100' = (MINIMAX_SAMPLE_RATES as readonly string[]).includes(String(d?.minimaxSampleRate))
    ? String(d.minimaxSampleRate) as any
    : '32000';
  const minimaxBitrate: '32000' | '64000' | '128000' | '256000' = (MINIMAX_BITRATES as readonly string[]).includes(String(d?.minimaxBitrate))
    ? String(d.minimaxBitrate) as any
    : '128000';
  const minimaxChannel: 1 | 2 = Number(d?.minimaxChannel) === 2 ? 2 : 1;
  const minimaxCustomVoiceId: string = String(d?.minimaxCustomVoiceId || 'SeedanceVoice01');
  const minimaxCloneTargetModel: 'minimax-speech-2.8-hd' | 'minimax-speech-2.8-turbo' = d?.minimaxCloneTargetModel === MINIMAX_SPEECH_TURBO_MODEL
    ? MINIMAX_SPEECH_TURBO_MODEL
    : MINIMAX_SPEECH_HD_MODEL;
  const minimaxNoiseReduction: boolean = d?.minimaxNoiseReduction === true;
  const minimaxVolumeNormalization: boolean = d?.minimaxVolumeNormalization === true;
  const isMinimaxMusic = minimaxAudioModel === MINIMAX_MUSIC_MODEL;
  const isMinimaxClone = minimaxAudioModel === MINIMAX_VOICE_CLONE_MODEL;
  const murekaModel = (MUREKA_BGM_MODELS as readonly string[]).includes(d?.murekaModel)
    ? d.murekaModel
    : MUREKA_BGM_MODELS[0];
  const murekaInstrumentalId: string = String(d?.murekaInstrumentalId || '');
  const murekaCount: number = Math.min(3, Math.max(1, Number(d?.murekaCount) || 1));
  const flowMusicOperation: FlowMusicOperation = getFlowMusicActionDef(d?.flowMusicOperation).value;
  const flowMusicAction = getFlowMusicActionDef(flowMusicOperation);
  const flowMusicNeedsPrompt = ['flowmusic-generation', 'flowmusic-lyrics', 'flowmusic-extend', 'flowmusic-replace', 'flowmusic-cover'].includes(flowMusicOperation);
  const flowMusicVersion: 'default' | 'lyria-3.5' = (FLOWMUSIC_VERSIONS as readonly string[]).includes(d?.flowMusicVersion)
    ? d.flowMusicVersion
    : 'lyria-3.5';
  const flowMusicLyrics: string = String(d?.flowMusicLyrics || '');
  const flowMusicTitle: string = String(d?.flowMusicTitle || '');
  const flowMusicBpm: number = Math.max(1, Math.round(Number(d?.flowMusicBpm) || 120));
  const flowMusicLength: number = Math.min(240, Math.max(1, Math.round(Number(d?.flowMusicLength) || 60)));
  const flowMusicClipId: string = String(d?.flowMusicClipId || '');
  const flowMusicExtendFrom: number = Math.max(0, Number(d?.flowMusicExtendFrom) || 0);
  const flowMusicExtendSeconds: number = Math.min(164, Math.max(1, Math.round(Number(d?.flowMusicExtendSeconds) || 30)));
  const flowMusicStartSeconds: number = Math.max(0, Number(d?.flowMusicStartSeconds) || 0);
  const flowMusicEndSeconds: number = Math.max(0, Number(d?.flowMusicEndSeconds) || 10);
  const flowMusicStrength: number = Math.min(1, Math.max(0, Number(d?.flowMusicStrength) || 0.5));
  const flowMusicFormat: 'mp3' | 'wav' = (FLOWMUSIC_FORMATS as readonly string[]).includes(d?.flowMusicFormat)
    ? d.flowMusicFormat
    : 'mp3';
  const flowMusicPreset: 'simple' | 'modern' | 'player' = (FLOWMUSIC_VIDEO_PRESETS as readonly string[]).includes(d?.flowMusicPreset)
    ? d.flowMusicPreset
    : 'modern';
  const seedanceNzAudioResultText: string = typeof d?.seedanceNzAudioResultText === 'string' ? d.seedanceNzAudioResultText : '';
  const whisperResponseFormat: WhisperResponseFormat = ['json', 'verbose_json', 'srt', 'text', 'vtt'].includes(d?.whisperResponseFormat)
    ? d.whisperResponseFormat
    : 'json';
  const transcript: string = typeof d?.transcript === 'string' ? d.transcript : '';
  // 预传 clipId(手动调起 _sunoUploadAudio 后保存)
  const uploadedClipId: string = d?.uploadedClipId || '';
  const uploadedFilename: string = d?.uploadedFilename || '';

  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d?.status || 'idle';
  const taskId: string | undefined = d?.taskId;
  const tracks: Array<{ id?: string; clipId?: string; audioUrl: string; remoteUrl?: string; imageUrl?: string; title?: string; tags?: string }>
    = d?.tracks || [];
  const pollProgress: string = d?.progress || '';

  const stopPoll = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => () => stopPoll(), []);

  // === 上游素材聚合 (跨节点统一机制) ===
  const upstream = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(
    () => normalizeExcludedMaterialIds(d?.excludedMaterialIds),
    [d?.excludedMaterialIds],
  );
  const visibleUpstreamTexts = useMemo(
    () => filterExcludedMaterials(upstream.texts, excludedMaterialIds),
    [upstream.texts, excludedMaterialIds],
  );
  const visibleUpstreamImages = useMemo(
    () => filterExcludedMaterials(upstream.images, excludedMaterialIds),
    [upstream.images, excludedMaterialIds],
  );
  const visibleUpstreamVideos = useMemo(
    () => filterExcludedMaterials(upstream.videos, excludedMaterialIds),
    [upstream.videos, excludedMaterialIds],
  );
  const visibleUpstreamAudios = useMemo(
    () => filterExcludedMaterials(upstream.audios, excludedMaterialIds),
    [upstream.audios, excludedMaterialIds],
  );
  const excludedUpstreamCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstream.texts, ...upstream.images, ...upstream.videos, ...upstream.audios]),
    [excludedMaterialIds, upstream.texts, upstream.images, upstream.videos, upstream.audios],
  );
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const orderedImages = useOrderedMaterials(visibleUpstreamImages, materialOrder);
  const orderedVideos = useOrderedMaterials(visibleUpstreamVideos, materialOrder);
  const orderedAudios = useOrderedMaterials(visibleUpstreamAudios, materialOrder);
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });

  // === 本地拖入参考音频 (跨节点 Ctrl 拖拽) ===
  const localRefAudio: string = typeof d?.localRefAudio === 'string' ? d.localRefAudio : '';
  const localRefImage: string = typeof d?.localRefImage === 'string' ? d.localRefImage : '';
  const localRefAudioMaterials: Material[] = useMemo(
    () =>
      localRefAudio
        ? [{
            id: `local::audio-ref:${localRefAudio}`,
            kind: 'audio' as const,
            url: localRefAudio,
            sourceNodeId: id,
            origin: 'local' as const,
            label: '本地参考音频',
          }]
        : [],
    [localRefAudio, id],
  );
  const mentionMaterials = useMemo(
    () => isSeedAudio
      ? [...orderedImages.slice(0, 1), ...orderedAudios.slice(0, 3), ...localRefAudioMaterials]
      : isMinimaxClone
        ? [...orderedAudios.slice(0, 1), ...localRefAudioMaterials]
      : [...orderedAudios, ...localRefAudioMaterials],
    [isSeedAudio, isMinimaxClone, orderedImages, orderedAudios, localRefAudioMaterials],
  );
  
  // 分组动态跟随模式: generate 只要文本, cover/extend 需要参考音频
  const previewGroups = useMemo<ReadonlyArray<'text' | 'image' | 'video' | 'audio'>>(
    () => isSeedAudio
      ? ['text', 'image', 'audio']
      : isMinimaxClone ? ['text', 'audio']
      : isSeedanceNzAudio ? ['text']
      : isLyria
        ? (['flowmusic-generation', 'flowmusic-lyrics'].includes(flowMusicOperation) ? ['text'] : ['text', 'audio'])
      : isWhisper ? ['video', 'audio'] : isSunoNz ? ['text', 'audio'] : (mode === 'generate' ? ['text'] : ['text', 'audio']),
    [isSeedAudio, isMinimaxClone, isSeedanceNzAudio, isLyria, flowMusicOperation, isWhisper, isSunoNz, mode],
  );
  
  // Whisper 可直接转写 MP4；其余音频能力仍只消费音频素材。
  const collectUpstream = (): { prompt: string; audioUrl: string; audioClipId: string; imageUrls: string[]; audioUrls: string[] } => {
    const prompt = orderedTexts.map((t) => t.url).filter((s) => !!s).join('\n').trim();
    const audioUrl = orderedAudios[0]?.url || (isWhisper ? orderedVideos[0]?.url : '') || localRefAudio || '';
    const audioClipId = orderedAudios.map((item) => String(item.clipId || '').trim()).find(Boolean) || '';
    const imageUrls = [...orderedImages.map((item) => item.url), localRefImage].filter(Boolean).slice(0, 1);
    const maxAudios = isMinimaxClone ? 1 : isSunoNz ? 4 : 3;
    const audioUrls = [...orderedAudios.map((item) => item.url), localRefAudio].filter((value, index, values) => !!value && values.indexOf(value) === index).slice(0, maxAudios);
    return { prompt, audioUrl, audioClipId, imageUrls, audioUrls };
  };

  // 上传本地音频 → 获取 clipId
  const uploadFile = async (file: File): Promise<string> => {
      setUploading(true);
    try {
      logBus.info(`上传音频: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, src);
      const r = await uploadAudioForSuno(file, providerParams);
      update({ uploadedClipId: r.clipId, uploadedFilename: r.filename });
      logBus.success(`上传成功, clipId=${r.clipId}`, src);
      return r.clipId;
    } finally {
      setUploading(false);
    }
  };

  // 将 URL 抓为 File 后上传(上游节点传入 audioUrl 时)
  const fetchUrlAndUpload = async (url: string, preferredName = ''): Promise<string> => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`下载上游音频失败: ${resp.status}`);
    const blob = await resp.blob();
    const ext = audioUploadExtension(blob.type, preferredName, url);
    const file = new File([blob], `upstream_audio.${ext}`, { type: blob.type || 'audio/mpeg' });
    return await uploadFile(file);
  };

  const onSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    try {
      if (isSeedAudio || isWhisper || isSunoNz || isMinimaxClone || isLyria) {
        setUploading(true);
        const uploaded = await uploadLocalFile(f);
        update({ localRefAudio: uploaded.url, uploadedClipId: '', uploadedFilename: f.name });
        const targetLabel = isWhisper
          ? 'Whisper 待转写素材'
          : isSeedAudio
            ? 'Seed Audio 参考音频'
            : isMinimaxClone
              ? 'MiniMax 声音克隆参考音频'
              : isLyria ? 'Lyria / Flow Music 参考音频' : 'Suno 参考音频';
        logBus.success(`${targetLabel}已加入: ${f.name}`, src);
      } else {
        await uploadFile(f);
      }
    } catch (err: any) {
      setError(err?.message || '上传失败');
      logBus.error(err?.message || '上传失败', src);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearUpload = () => update({ uploadedClipId: '', uploadedFilename: '' });

  // 轮询: 3000ms × 1200 次 = 3600s，避免 Suno 长任务 3 分钟提前超时。
  // v1.2.9.11: 返回 Promise，调用方 await 直到任务成功/失败/超时才 resolve/reject。
  //   原设计中 startPolling 启动 setInterval 后立即返回 → handleGenerate 提交成功后也立即返回→
  //   useRunTrigger 认为 runFn 完成 markDone(true)。 但实际任务 audioUrl 还未赋值 → LoopNode awaitNode
  //   立即继续 → extractFromNode 读不到 audioUrl → result=null → failCount++。
  //   修复后: 轮询完成才 resolve，handleGenerate await 它，什么时候 markDone 什么时候任务真正结束。
  const startPolling = (clipIds: string[], reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      const POLL_INT = SUNO_POLL_INTERVAL_MS;
      const MAX = SUNO_MAX_POLL;
      let pollInFlight = false;
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > MAX) {
          stopPoll();
          update({ status: 'error', error: '轮询超时 (60min)' });
          setError('轮询超时 (60min)');
          logBus.error('轮询超时', src);
          reject(new Error('轮询超时 (60min)'));
          return;
        }
        pollInFlight = true;
        try {
          const r = await queryAudio(clipIds, true);
          await reporter?.polling({
            provider: 'suno',
            model: version,
            taskIds: clipIds,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: MAX,
            status: r.status,
            completed: r.completed,
            total: r.total,
          });
          if (String(r.status || '').toUpperCase() === 'MATERIALIZING') {
            update({ status: 'polling', progress: '100% · 正在下载' });
            if (elapsed === 1 || elapsed % 10 === 0) {
              logBus.warn(
                r.error || '音频已经生成，正在适配 TUN/代理网络并安全下载；原任务会保留，不会重复提交',
                src,
              );
            }
          } else if (r.status === 'SUCCESS' && r.tracks.length > 0) {
            stopPoll();
            // 双输出口: audioUrl=轨1, audioUrl_1=轨2
            update({
              status: 'success',
              tracks: r.tracks,
              audioUrl: r.tracks[0]?.audioUrl || '',
              audioUrl_1: r.tracks[1]?.audioUrl || '',
              progress: `${r.completed}/${r.total}`,
              provider: 'suno',
              model: version,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
            });
            await reporter?.providerResponse({
              provider: 'suno',
              model: version,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            logBus.success(`完成 ${r.tracks.length} 轨: ${r.tracks.map((t) => t.audioUrl).join(' | ')}`, src);
            taskCompletionSound.notifyComplete(id, 'audio');
            resolve();
          } else {
            update({ status: 'polling', progress: `${r.completed}/${r.total} · #${elapsed}` });
            if (elapsed % 3 === 0) logBus.info(`轮询 #${elapsed} · ${r.completed}/${r.total}`, src);
          }
        } catch (e: any) {
          logBus.warn(`轮询出错: ${e?.message}`, src);
        } finally {
          pollInFlight = false;
        }
      }, POLL_INT);
    });
  };

  const startSeedAudioPolling = (tid: string, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      let pollInFlight = false;
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > SUNO_MAX_POLL) {
          stopPoll();
          const message = 'Seed Audio 轮询超时 (60min)';
          setError(message);
          update({ status: 'error', error: message });
          reject(new Error(message));
          return;
        }
        pollInFlight = true;
        try {
          const result = await querySeedAudio(tid);
          const normalizedStatus = String(result.status || '').trim().toLowerCase();
          const currentProgress = String(result.progress ?? '');
          await reporter?.polling({
            provider: 'seedance-nz',
            model: 'doubao-seed-audio-1.0',
            taskId: tid,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: SUNO_MAX_POLL,
            status: normalizedStatus,
            progress: currentProgress,
          });
          if (normalizedStatus === 'materializing') {
            update({ status: 'polling', progress: '100% · 正在下载' });
            if (elapsed === 1 || elapsed % 10 === 0) {
              logBus.warn(
                result.error || 'Seed Audio 已经生成，正在适配 TUN/代理网络并安全下载；原任务会保留，不会重复提交',
                src,
              );
            }
          } else if (normalizedStatus === 'succeeded' && result.audioUrl) {
            stopPoll();
            const seedTrack = {
              id: tid,
              clipId: tid,
              audioUrl: result.audioUrl,
              remoteUrl: result.remoteAudioUrl || undefined,
              title: 'Seed Audio',
            };
            update({
              status: 'success',
              tracks: [seedTrack],
              audioUrl: result.audioUrl,
              audioUrl_1: '',
              progress: '100%',
              provider: 'seedance-nz',
              model: 'doubao-seed-audio-1.0',
              taskId: tid,
              requestId: result.requestId,
              transportHttpStatus: result.transportHttpStatus,
              upstreamHttpStatus: result.upstreamHttpStatus,
              usage: result.usage,
              pollCount: elapsed,
            });
            await reporter?.providerResponse({
              provider: 'seedance-nz',
              model: 'doubao-seed-audio-1.0',
              upstreamTaskId: tid,
              requestId: result.requestId,
              transportHttpStatus: result.transportHttpStatus,
              upstreamHttpStatus: result.upstreamHttpStatus,
              usage: result.usage,
              pollCount: elapsed,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            logBus.success(`Seed Audio 完成 → ${result.audioUrl}`, src);
            taskCompletionSound.notifyComplete(id, 'audio');
            resolve();
          } else if (normalizedStatus === 'failed') {
            stopPoll();
            const message = result.failReason || 'Seed Audio 生成失败';
            await reporter?.providerResponse({
              provider: 'seedance-nz',
              model: 'doubao-seed-audio-1.0',
              upstreamTaskId: tid,
              requestId: result.requestId,
              transportHttpStatus: result.transportHttpStatus,
              upstreamHttpStatus: result.upstreamHttpStatus,
              usage: result.usage,
              pollCount: elapsed,
              status: 'failed',
              error: { message },
              httpStatusSource: 'local-backend',
            });
            setError(message);
            update({ status: 'error', error: message });
            reject(new Error(message));
          } else {
            update({ status: 'polling', progress: currentProgress || `#${elapsed}` });
          }
        } catch (pollError: any) {
          logBus.warn(`Seed Audio 轮询出错: ${pollError?.message || pollError}`, src);
        } finally {
          pollInFlight = false;
        }
      }, 4000);
    });
  };

  const finishSeedanceNzAudioResult = async (
    result: SeedanceNzAudioQueryResult,
    modelName: string,
    tid: string,
    reporter?: RunNodeLifecycleReporter,
    pollCount = 0,
  ) => {
    const resultTracks = Array.isArray(result.tracks) && result.tracks.length
      ? result.tracks
      : (Array.isArray(result.audioUrls) ? result.audioUrls : [])
        .filter(Boolean)
        .map((audioUrl, index) => ({ id: `${tid}:${index}`, clipId: tid, audioUrl, title: `${modelName} #${index + 1}` }));
    const resultText = String(result.resultText || '').trim();
    update({
      status: 'success',
      tracks: resultTracks,
      audioUrl: resultTracks[0]?.audioUrl || result.audioUrl || '',
      audioUrl_1: resultTracks[1]?.audioUrl || '',
      audioUrls: resultTracks.map((track) => track.audioUrl),
      progress: '100%',
      provider: 'seedance-nz',
      model: modelName,
      apiModel: modelName,
      taskId: tid,
      seedanceNzAudioResultText: resultText,
      text: resultText,
      texts: resultText ? [resultText] : [],
      requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus,
      upstreamHttpStatus: result.upstreamHttpStatus,
      usage: result.usage,
      pollCount,
    });
    await reporter?.providerResponse({
      provider: 'seedance-nz',
      model: modelName,
      upstreamTaskId: tid,
      requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus,
      upstreamHttpStatus: result.upstreamHttpStatus,
      usage: result.usage,
      pollCount,
      status: 'succeeded',
      httpStatusSource: 'local-backend',
    });
    logBus.success(`${modelName} 完成 · 音频${resultTracks.length}${resultText ? ' / 文本1' : ''}`, src);
    taskCompletionSound.notifyComplete(id, 'audio');
  };

  const startSeedanceNzAudioPolling = (
    tid: string,
    modelName: string,
    reporter?: RunNodeLifecycleReporter,
  ): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      let pollInFlight = false;
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > SUNO_MAX_POLL) {
          stopPoll();
          const message = `${modelName} 轮询超时 (60min)，任务 ID 已保留，可稍后继续查询`;
          setError(message);
          update({ status: 'error', error: message });
          reject(new Error(message));
          return;
        }
        pollInFlight = true;
        try {
          const result = await querySeedanceNzAudio(tid);
          const normalizedStatus = String(result.status || '').trim().toLowerCase();
          await reporter?.polling({
            provider: 'seedance-nz',
            model: modelName,
            taskId: tid,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: SUNO_MAX_POLL,
            status: normalizedStatus,
            progress: result.progress,
          });
          if (normalizedStatus === 'materializing') {
            update({ status: 'polling', progress: '100% · 正在下载全部结果' });
          } else if (normalizedStatus === 'succeeded') {
            const hasAudio = Boolean(result.audioUrl) || Boolean(result.audioUrls?.length) || Boolean(result.tracks?.length);
            const hasText = Boolean(String(result.resultText || '').trim());
            if (!hasAudio && !hasText) throw new Error(`${modelName} 任务成功但没有返回音频或文本结果`);
            stopPoll();
            await finishSeedanceNzAudioResult(result, modelName, tid, reporter, elapsed);
            resolve();
          } else if (normalizedStatus === 'failed') {
            stopPoll();
            const message = result.failReason || result.error || `${modelName} 任务失败`;
            setError(message);
            update({ status: 'error', error: message });
            reject(new Error(message));
          } else {
            update({ status: 'polling', progress: String(result.progress || `#${elapsed}`) });
          }
        } catch (pollError: any) {
          logBus.warn(`${modelName} 轮询出错: ${pollError?.message || pollError}`, src);
        } finally {
          pollInFlight = false;
        }
      }, 4000);
    });
  };

  const finishFlowMusicResult = async (
    result: FlowMusicTaskResult,
    reporter?: RunNodeLifecycleReporter,
    pollCount = 0,
  ) => {
    const resultTracks = Array.isArray(result.tracks) ? result.tracks : [];
    const resultText = String(result.text || '').trim();
    const videoUrls = Array.isArray(result.videoUrls) ? result.videoUrls : [];
    const fileUrls = Array.isArray(result.fileUrls) ? result.fileUrls : [];
    const clipIds = Array.from(new Set([
      ...(Array.isArray(result.clipIds) ? result.clipIds : []),
      result.clipId || '',
      ...resultTracks.map((track) => track.clipId || ''),
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    update({
      status: 'success',
      progress: '100%',
      taskId: result.taskId || taskId,
      tracks: resultTracks,
      audioUrl: resultTracks[0]?.audioUrl || result.audioUrls?.[0] || '',
      audioUrl_1: resultTracks[1]?.audioUrl || result.audioUrls?.[1] || '',
      audioUrls: result.audioUrls || resultTracks.map((track) => track.audioUrl),
      videoUrl: videoUrls[0] || '',
      videos: videoUrls,
      fileUrls,
      imageUrls: result.imageUrls || [],
      flowMusicClipId: clipIds[0] || flowMusicClipId,
      flowMusicClipIds: clipIds,
      seedanceNzAudioResultText: resultText,
      text: resultText,
      texts: resultText ? [resultText] : [],
      provider: 'seedance-nz',
      model: flowMusicOperation,
      apiModel: 'flowmusic',
      requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus,
      upstreamHttpStatus: result.upstreamHttpStatus,
      usage: result.usage,
      pollCount,
      partialFailures: result.partialFailures || [],
    });
    await reporter?.providerResponse({
      provider: 'seedance-nz',
      model: flowMusicOperation,
      upstreamTaskId: result.taskId || taskId,
      requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus,
      upstreamHttpStatus: result.upstreamHttpStatus,
      usage: result.usage,
      pollCount,
      status: 'succeeded',
      httpStatusSource: 'local-backend',
    });
    if (result.partialFailures?.length) {
      logBus.warn(`Lyria 已完成，但有 ${result.partialFailures.length} 个附属结果保存失败；已保留可用结果`, src);
    }
    logBus.success(
      `Lyria ${flowMusicOperation} 完成 · 音频${resultTracks.length} / 视频${videoUrls.length} / 文件${fileUrls.length}${resultText ? ' / 文本1' : ''}`,
      src,
    );
    taskCompletionSound.notifyComplete(id, 'audio');
  };

  const startFlowMusicPolling = (tid: string, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      let pollInFlight = false;
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > SUNO_MAX_POLL) {
          stopPoll();
          const message = 'Lyria 轮询超时 (60min)，任务 ID 已保留，可稍后重试';
          setError(message);
          update({ status: 'error', error: message });
          reject(new Error(message));
          return;
        }
        pollInFlight = true;
        try {
          const result = await queryFlowMusic(tid);
          const normalizedStatus = String(result.status || '').trim().toLowerCase();
          await reporter?.polling({
            provider: 'seedance-nz',
            model: flowMusicOperation,
            taskId: tid,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: SUNO_MAX_POLL,
            status: normalizedStatus,
            progress: result.progress,
          });
          if (normalizedStatus === 'materializing') {
            update({ status: 'polling', progress: '100% · 正在下载全部结果' });
          } else if (normalizedStatus === 'succeeded') {
            stopPoll();
            await finishFlowMusicResult(result, reporter, elapsed);
            resolve();
          } else if (normalizedStatus === 'failed') {
            stopPoll();
            const message = result.failReason || result.error || 'Lyria 任务失败';
            setError(message);
            update({ status: 'error', error: message });
            reject(new Error(message));
          } else {
            update({ status: 'polling', progress: String(result.progress || `#${elapsed}`) });
          }
        } catch (pollError: any) {
          logBus.warn(`Lyria 轮询出错: ${pollError?.message || pollError}`, src);
        } finally {
          pollInFlight = false;
        }
      }, 4000);
    });
  };

  const finishSunoNzResult = async (
    result: SunoNzTaskResult,
    reporter?: RunNodeLifecycleReporter,
    pollCount = 0,
  ) => {
    const resultTracks = Array.isArray(result.tracks) ? result.tracks : [];
    const resultText = String(result.text || '').trim();
    const videoUrls = Array.isArray(result.videoUrls) ? result.videoUrls : [];
    const fileUrls = Array.isArray(result.fileUrls) ? result.fileUrls : [];
    update({
      status: 'success',
      progress: '100%',
      taskId: result.taskId || taskId,
      tracks: resultTracks,
      audioUrl: resultTracks[0]?.audioUrl || result.audioUrls?.[0] || '',
      audioUrl_1: resultTracks[1]?.audioUrl || result.audioUrls?.[1] || '',
      videoUrl: videoUrls[0] || '',
      videos: videoUrls,
      fileUrls,
      sunoVideoUrls: videoUrls,
      sunoFileUrls: fileUrls,
      imageUrls: result.imageUrls || [],
      sunoResultText: resultText,
      text: resultText,
      texts: resultText ? [resultText] : [],
      provider: 'seedance-nz',
      model: sunoNzOperation,
      apiModel: sunoNzOperation,
      requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus,
      upstreamHttpStatus: result.upstreamHttpStatus,
      usage: result.usage,
      pollCount,
      partialFailures: result.partialFailures || [],
    });
    await reporter?.providerResponse({
      provider: 'seedance-nz',
      model: sunoNzOperation,
      upstreamTaskId: result.taskId || taskId,
      requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus,
      upstreamHttpStatus: result.upstreamHttpStatus,
      usage: result.usage,
      pollCount,
      status: 'succeeded',
      httpStatusSource: 'local-backend',
    });
    if (result.partialFailures?.length) {
      logBus.warn(`Suno 已完成，但有 ${result.partialFailures.length} 个附属结果保存失败；已保留可用结果`, src);
    }
    logBus.success(
      `Suno ${sunoNzOperation} 完成 · 音频${resultTracks.length} / 视频${videoUrls.length} / 文件${fileUrls.length}${resultText ? ' / 文本1' : ''}`,
      src,
    );
    taskCompletionSound.notifyComplete(id, 'audio');
  };

  const startSunoNzPolling = (tid: string, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll();
    return new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      let pollInFlight = false;
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > SUNO_MAX_POLL) {
          stopPoll();
          const message = 'Suno 轮询超时 (60min)，任务 ID 已保留，可稍后重试';
          setError(message);
          update({ status: 'error', error: message });
          reject(new Error(message));
          return;
        }
        pollInFlight = true;
        try {
          const result = await querySunoNz(tid);
          const normalizedStatus = String(result.status || '').trim().toLowerCase();
          await reporter?.polling({
            provider: 'seedance-nz',
            model: sunoNzOperation,
            taskId: tid,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: SUNO_MAX_POLL,
            status: normalizedStatus,
            progress: result.progress,
          });
          if (normalizedStatus === 'materializing') {
            update({ status: 'polling', progress: '100% · 正在下载' });
          } else if (normalizedStatus === 'succeeded') {
            stopPoll();
            await finishSunoNzResult(result, reporter, elapsed);
            resolve();
          } else if (normalizedStatus === 'failed') {
            stopPoll();
            const message = result.failReason || result.error || 'Suno 任务失败';
            setError(message);
            update({ status: 'error', error: message });
            reject(new Error(message));
          } else {
            update({ status: 'polling', progress: String(result.progress || `#${elapsed}`) });
          }
        } catch (pollError: any) {
          logBus.warn(`Suno 轮询出错: ${pollError?.message || pollError}`, src);
        } finally {
          pollInFlight = false;
        }
      }, 4000);
    });
  };

  const handleGenerate = async (reporter?: RunNodeLifecycleReporter) => {
    setError(null);
    const upstream = collectUpstream();
    const resolvedLocalPrompt = resolveMediaMentions(localPrompt, promptMentions, mentionMaterials);
    const finalPrompt = (upstream.prompt || resolvedLocalPrompt || '').trim();
    const sunoNzNeedsPrompt = sunoNzAction.requiredFields.includes('prompt');
    if (!isWhisper && !isSunoNz && !isLyria && !(isMureka && murekaInstrumentalId.trim()) && !finalPrompt) {
      setError(isSeedAudio ? '请填写音频提示词' : '请填写歌词 / 提示词');
      return;
    }
    if (isSunoNz && sunoNzNeedsPrompt && !finalPrompt) {
      setError(`${sunoNzOperation} 需要填写提示词`);
      return;
    }
    if (isLyria && flowMusicNeedsPrompt && flowMusicOperation !== 'flowmusic-generation' && !finalPrompt) {
      setError(`${flowMusicOperation} 需要填写提示词 / 指令`);
      return;
    }
    if (isLyria && flowMusicOperation === 'flowmusic-generation' && !finalPrompt && !flowMusicLyrics.trim()) {
      setError('flowmusic-generation 的曲风提示词与歌词至少填写一个');
      return;
    }
    if (isSeedAudio && (finalPrompt.length < 5 || finalPrompt.length > 2048)) {
      setError('Seed Audio 提示词长度必须为 5-2048 字符');
      return;
    }
    const latestAudioModel = isQwen3Tts
      ? qwenTtsModel
      : isMinimaxAudio
        ? minimaxAudioModel
        : isMureka ? murekaModel : '';
    const traceProvider = isSeedAudio || isWhisper || isSunoNz || isSeedanceNzAudio || isLyria ? 'seedance-nz' : 'suno';
    const traceModel = isWhisper
      ? 'whisper-1'
      : isSeedAudio
        ? 'doubao-seed-audio-1.0'
        : isLyria
          ? flowMusicOperation
        : isSeedanceNzAudio
          ? latestAudioModel
          : isSunoNz ? sunoNzOperation : version;
    await reporter?.providerRequest({ provider: traceProvider, model: traceModel });
    taskCompletionSound.primeAudio();
    update({
      status: 'submitting',
      error: null,
      tracks: [],
      audioUrl: undefined,
      audioUrl_1: undefined,
      videoUrl: undefined,
      videos: [],
      fileUrls: [],
      sunoVideoUrls: [],
      sunoFileUrls: [],
      ...(isWhisper || isSunoNz || isSeedanceNzAudio || isLyria
        ? { transcript: '', sunoResultText: '', seedanceNzAudioResultText: '', text: '', texts: [] }
        : {}),
      ...(isWhisper ? {
        transcriptEvidenceText: '',
        transcriptSegments: [],
        transcriptAttribution: 'untimed',
      } : {}),
    });
    try {
      if (isWhisper) {
        if (!upstream.audioUrl) {
          throw new Error('Whisper 必须连接、拖入或上传 1 个音频/视频素材');
        }
        logBus.info(`提交 Whisper: whisper-1 · response_format=${whisperResponseFormat}`, src);
        const result = await transcribeWhisper({
          audioUrl: upstream.audioUrl,
          model: 'whisper-1',
          responseFormat: whisperResponseFormat,
        }, { submissionKey: reporter?.providerSubmissionKey });
        await reporter?.providerResponse({
          provider: traceProvider,
          model: traceModel,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          status: 'succeeded',
          httpStatusSource: 'local-backend',
        });
        const evidence = buildWhisperTranscriptEvidence(result);
        update({
          status: 'success',
          progress: '100%',
          transcript: result.text,
          transcriptEvidenceText: evidence.text,
          transcriptSegments: evidence.segments,
          transcriptAttribution: evidence.attribution,
          text: evidence.text,
          texts: [evidence.text],
          lastPrompt: '',
          provider: traceProvider,
          apiModel: traceModel,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
        });
        logBus.success(`Whisper 转写完成 · ${result.text.length} 字符`, src);
        taskCompletionSound.notifyComplete(id, 'audio');
        return;
      }
      if (isSeedAudio) {
        const hasSpeaker = !!seedAudioSpeaker.trim();
        const hasImage = upstream.imageUrls.length > 0;
        const hasAudio = upstream.audioUrls.length > 0;
        if ([hasSpeaker, hasImage, hasAudio].filter(Boolean).length > 1) {
          throw new Error('Seed Audio 的音色 ID、参考图和参考音频只能选择一种；请移除多余素材或清空音色 ID');
        }
        logBus.info(
          `提交 Seed Audio: doubao-seed-audio-1.0 · ${seedAudioFormat}/${seedAudioSampleRate} · 图${upstream.imageUrls.length}/音${upstream.audioUrls.length}`,
          src,
        );
        const result = await submitSeedAudio({
          model: 'doubao-seed-audio-1.0',
          prompt: finalPrompt,
          speaker: seedAudioSpeaker.trim() || undefined,
          outputFormat: seedAudioFormat,
          sampleRate: seedAudioSampleRate,
          speechRate: seedAudioSpeechRate,
          loudnessRate: seedAudioLoudnessRate,
          pitchRate: seedAudioPitchRate,
          images: upstream.imageUrls.length ? upstream.imageUrls : undefined,
          audioUrls: upstream.audioUrls.length ? upstream.audioUrls : undefined,
        }, { submissionKey: reporter?.providerSubmissionKey });
        await reporter?.providerSubmitted({
          provider: traceProvider,
          model: traceModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({ status: 'polling', taskId: result.taskId, lastPrompt: finalPrompt, progress: '0%' });
        logBus.info(`Seed Audio 任务 ${result.taskId} 已提交，开始轮询`, src);
        await startSeedAudioPolling(result.taskId, reporter);
        return;
      }
      if (isLyria) {
        const sourceClipId = flowMusicClipId.trim() || upstream.audioClipId;
        if (flowMusicOperation === 'flowmusic-upload-audio' && !upstream.audioUrl) {
          throw new Error('flowmusic-upload-audio 必须连接、拖入或上传 1 个音频素材');
        }
        if (['flowmusic-extend', 'flowmusic-replace', 'flowmusic-cover', 'flowmusic-stems', 'flowmusic-download-audio', 'flowmusic-video-clip'].includes(flowMusicOperation) && !sourceClipId) {
          throw new Error(`${flowMusicOperation} 需要 clip_id；可连接上游 Lyria 节点自动读取，或手动填写`);
        }
        if (flowMusicOperation === 'flowmusic-replace' && flowMusicEndSeconds <= flowMusicStartSeconds) {
          throw new Error('flowmusic-replace 的结束秒数必须大于开始秒数');
        }
        const request = {
          operation: flowMusicOperation,
          version: flowMusicAction.supportsLyria35 ? flowMusicVersion : undefined,
          sound_prompt: flowMusicOperation === 'flowmusic-generation' ? (finalPrompt || undefined) : undefined,
          lyrics: flowMusicOperation === 'flowmusic-generation' ? (flowMusicLyrics.trim() || undefined) : undefined,
          prompt: flowMusicOperation === 'flowmusic-lyrics' ? finalPrompt : undefined,
          title: flowMusicAction.supportsLyria35 ? (flowMusicTitle.trim() || undefined) : undefined,
          bpm: flowMusicOperation === 'flowmusic-generation' ? flowMusicBpm : undefined,
          length: flowMusicOperation === 'flowmusic-generation' ? flowMusicLength : undefined,
          seed: flowMusicAction.supportsLyria35 && seed > 0 ? seed : undefined,
          audioUrl: flowMusicOperation === 'flowmusic-upload-audio' ? upstream.audioUrl : undefined,
          clip_id: sourceClipId || undefined,
          instruction: ['flowmusic-extend', 'flowmusic-replace', 'flowmusic-cover'].includes(flowMusicOperation) ? finalPrompt : undefined,
          extend_from_s: flowMusicOperation === 'flowmusic-extend' ? flowMusicExtendFrom : undefined,
          extend_s: flowMusicOperation === 'flowmusic-extend' ? flowMusicExtendSeconds : undefined,
          start_s: flowMusicOperation === 'flowmusic-replace' ? flowMusicStartSeconds : undefined,
          end_s: flowMusicOperation === 'flowmusic-replace' ? flowMusicEndSeconds : undefined,
          strength: flowMusicOperation === 'flowmusic-cover' ? flowMusicStrength : undefined,
          format: flowMusicOperation === 'flowmusic-download-audio' ? flowMusicFormat : undefined,
          preset: flowMusicOperation === 'flowmusic-video-clip' ? flowMusicPreset : undefined,
        };
        logBus.info(`提交 Lyria: ${flowMusicOperation}${flowMusicAction.supportsLyria35 ? ` · ${flowMusicVersion}` : ''}`, src);
        const result = await submitFlowMusic(request, { submissionKey: reporter?.providerSubmissionKey });
        const normalizedStatus = String(result.status || '').trim().toLowerCase();
        if (result.taskId) {
          await reporter?.providerSubmitted({
            provider: 'seedance-nz',
            model: flowMusicOperation,
            upstreamTaskId: result.taskId,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
          });
          update({
            status: normalizedStatus === 'succeeded' ? 'success' : 'polling',
            taskId: result.taskId,
            lastPrompt: finalPrompt,
            progress: String(result.progress || '0%'),
            provider: 'seedance-nz',
            model: flowMusicOperation,
            apiModel: 'flowmusic',
          });
        }
        if (normalizedStatus === 'succeeded') {
          await finishFlowMusicResult(result, reporter, 0);
          return;
        }
        if (normalizedStatus === 'failed') throw new Error(result.failReason || result.error || 'Lyria 任务失败');
        if (!result.taskId) throw new Error('Lyria 请求已接受，但既未返回结果也未返回 task_id');
        await startFlowMusicPolling(result.taskId, reporter);
        return;
      }
      if (isSeedanceNzAudio) {
        if (isQwen3Tts && !qwenTtsVoice.trim()) throw new Error('Qwen3-TTS 必须填写音色 ID');
        if (isMinimaxMusic && !minimaxInstrumental && !minimaxLyrics.trim() && !minimaxLyricsOptimizer) {
          throw new Error('MiniMax Music 非纯音乐模式必须填写歌词或启用歌词生成');
        }
        if (isMinimaxClone && upstream.audioUrls.length !== 1) {
          throw new Error('MiniMax 声音克隆必须且只能连接、拖入或导入 1 段 10 秒至 5 分钟的参考音频');
        }
        if (isMureka && Boolean(finalPrompt) === Boolean(murekaInstrumentalId.trim())) {
          throw new Error('Mureka 的 Prompt 与 instrumental_id 必须且只能填写一个');
        }
        const request = isQwen3Tts
          ? {
              model: qwenTtsModel,
              prompt: finalPrompt,
              voice: qwenTtsVoice.trim(),
              languageType: qwenTtsLanguage,
              instructions: qwenTtsModel === QWEN3_TTS_INSTRUCT_FLASH_MODEL ? qwenTtsInstructions.trim() : undefined,
              optimizeInstructions: qwenTtsOptimizeInstructions,
            }
          : isMinimaxAudio
            ? {
                model: minimaxAudioModel,
                prompt: finalPrompt,
                lyrics: isMinimaxMusic ? minimaxLyrics.trim() : undefined,
                isInstrumental: isMinimaxMusic ? minimaxInstrumental : undefined,
                lyricsOptimizer: isMinimaxMusic ? minimaxLyricsOptimizer : undefined,
                voiceId: !isMinimaxMusic && !isMinimaxClone ? minimaxVoiceId.trim() : undefined,
                speed: minimaxSpeed,
                volume: minimaxVolume,
                pitch: minimaxPitch,
                languageBoost: minimaxLanguageBoost,
                outputFormat: minimaxOutputFormat,
                sampleRate: minimaxSampleRate,
                bitrate: minimaxBitrate,
                channel: minimaxChannel,
                customVoiceId: isMinimaxClone ? minimaxCustomVoiceId.trim() : undefined,
                cloneTargetModel: isMinimaxClone ? minimaxCloneTargetModel : undefined,
                needNoiseReduction: isMinimaxClone ? minimaxNoiseReduction : undefined,
                needVolumeNormalization: isMinimaxClone ? minimaxVolumeNormalization : undefined,
                audioUrls: isMinimaxClone ? upstream.audioUrls.slice(0, 1) : undefined,
              }
            : {
                model: murekaModel,
                prompt: finalPrompt || undefined,
                instrumentalId: murekaInstrumentalId.trim() || undefined,
                n: murekaCount,
              };
        logBus.info(`提交平价AI小屋音频: ${latestAudioModel}`, src);
        const result = await submitSeedanceNzAudio(request, { submissionKey: reporter?.providerSubmissionKey });
        await reporter?.providerSubmitted({
          provider: 'seedance-nz',
          model: latestAudioModel,
          upstreamTaskId: result.taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          usage: result.usage,
          httpStatusSource: 'local-backend',
        });
        update({
          status: 'polling',
          taskId: result.taskId,
          lastPrompt: finalPrompt,
          progress: '0%',
          provider: 'seedance-nz',
          model: latestAudioModel,
          apiModel: latestAudioModel,
        });
        await startSeedanceNzAudioPolling(result.taskId, latestAudioModel, reporter);
        return;
      }
      if (isSunoNz) {
        const referenceTaskId = sunoTaskRef.trim() || String(taskId || '').trim();
        const sourceAudios = upstream.audioUrls;
        if (sunoNzAction.referenceType === 'url' && sourceAudios.length === 0) {
          throw new Error(`${sunoNzOperation} 需要连接、拖入或导入参考音频`);
        }
        if (sunoNzAction.referenceType === 'task_audio' && !referenceTaskId) {
          throw new Error(`${sunoNzOperation} 需要填写来源 task_id；可直接使用本节点上一次任务 ID`);
        }
        if (sunoNzAction.referenceType === 'mashup' && (!referenceTaskId || !sunoTaskRef2.trim())) {
          throw new Error('suno-mashup 需要填写两个来源 task_id');
        }
        if (sunoNzOperation === 'suno-upsample-tags' && !tags.trim()) {
          throw new Error('suno-upsample-tags 需要填写风格 Tags');
        }
        if (sunoNzOperation === 'suno-persona' && !sunoPersonaName.trim()) {
          throw new Error('suno-persona 需要填写 Persona 名称');
        }

        logBus.info(`提交平价AI小屋 Suno: ${sunoNzOperation}${sunoNzVersion ? ` · ${sunoNzVersion}` : ''}`, src);
        const result = await submitSunoNz({
          operation: sunoNzOperation,
          prompt: finalPrompt || undefined,
          version: sunoNzVersion || undefined,
          custom: sunoCustom,
          instrumental: sunoInstrumental,
          title: title.trim() || undefined,
          style: sunoStyle.trim() || undefined,
          vocal_gender: sunoVocalGender || undefined,
          tags: tags.trim() || undefined,
          audioFilePath: sunoNzOperation === 'suno-upload' ? upstream.audioUrl : undefined,
          audio_url: sunoNzOperation === 'suno-create-voice' ? upstream.audioUrl : undefined,
          audio_urls: sunoNzOperation === 'suno-inspo' ? sourceAudios : undefined,
          task_id: referenceTaskId || undefined,
          task_id_2: sunoTaskRef2.trim() || undefined,
          task_ids: sunoNzAction.referenceType === 'mashup'
            ? [referenceTaskId, sunoTaskRef2.trim()]
            : undefined,
          audio_index: sunoAudioIndex,
          continue_at: sunoNzOperation === 'suno-extend' ? continueAt : undefined,
          start_s: ['suno-crop', 'suno-remove-section', 'suno-replace-music', 'suno-sample'].includes(sunoNzOperation)
            ? sunoStartSeconds
            : undefined,
          end_s: ['suno-crop', 'suno-remove-section', 'suno-replace-music', 'suno-sample'].includes(sunoNzOperation)
            ? sunoEndSeconds
            : undefined,
          duration_s: ['suno-fade-in', 'suno-fade-out'].includes(sunoNzOperation)
            ? sunoDurationSeconds
            : undefined,
          speed: sunoNzOperation === 'suno-adjust-speed' ? sunoSpeed : undefined,
          name: sunoNzOperation === 'suno-persona' ? sunoPersonaName.trim() : undefined,
        }, { submissionKey: reporter?.providerSubmissionKey });
        const normalizedStatus = String(result.status || '').trim().toLowerCase();
        if (result.taskId) {
          await reporter?.providerSubmitted({
            provider: traceProvider,
            model: traceModel,
            upstreamTaskId: result.taskId,
            requestId: result.requestId,
            transportHttpStatus: result.transportHttpStatus,
            upstreamHttpStatus: result.upstreamHttpStatus,
            usage: result.usage,
            httpStatusSource: 'local-backend',
          });
          update({
            status: normalizedStatus === 'succeeded' ? 'success' : 'polling',
            taskId: result.taskId,
            sunoTaskRef: result.taskId,
            lastPrompt: finalPrompt,
            progress: String(result.progress || '0%'),
          });
        }
        if (normalizedStatus === 'succeeded') {
          await finishSunoNzResult(result, reporter, 0);
          return;
        }
        if (normalizedStatus === 'failed') throw new Error(result.failReason || result.error || 'Suno 任务失败');
        if (!result.taskId) throw new Error('Suno 请求已接受，但既未返回结果也未返回 task_id');
        await startSunoNzPolling(result.taskId, reporter);
        return;
      }
      // cover/extend: 如预传 clipId 为空但上游有 audioUrl, 则自动上传
      let clipIdForRef = uploadedClipId;
      if ((mode === 'cover' || mode === 'extend') && !clipIdForRef && upstream.audioUrl) {
        logBus.info('检测到上游音频 URL, 自动上传 Suno...', src);
        clipIdForRef = await fetchUrlAndUpload(
          upstream.audioUrl,
          upstream.audioUrl === localRefAudio ? uploadedFilename : '',
        );
      }
      if ((mode === 'cover' || mode === 'extend') && !clipIdForRef) {
        throw new Error(`${mode === 'cover' ? '翻唱' : '续写'}模式需先上传参考音频 (或连接上游音频节点)`);
      }

      logBus.info(`提交 Suno ${version} (${mode})...`, src);
      const r = await submitAudio({
        mode,
        prompt: finalPrompt,
        title: title || '',
        tags: tags || '',
        version,
        seed: seed > 0 ? seed : undefined,
        cover_clip_id: mode === 'cover' ? clipIdForRef : undefined,
        continue_clip_id: mode === 'extend' ? clipIdForRef : undefined,
        continue_at: mode === 'extend' ? continueAt : undefined,
        providerParams,
      }, { submissionKey: reporter?.providerSubmissionKey });
      await reporter?.providerSubmitted({
        provider: traceProvider,
        model: traceModel,
        upstreamTaskId: r.taskId,
        requestId: r.requestId,
        transportHttpStatus: r.transportHttpStatus,
        upstreamHttpStatus: r.upstreamHttpStatus,
        usage: r.usage,
        httpStatusSource: 'local-backend',
      });
      logBus.success(`taskId=${r.taskId} clips=${(r.clipIds || []).join(',') || '?'}`, src);
      update({ status: 'polling', taskId: r.taskId, clipIds: r.clipIds, lastPrompt: finalPrompt, progress: '0/?' });
      const idsToPoll = r.clipIds && r.clipIds.length > 0 ? r.clipIds : [r.taskId];
      // v1.2.9.11: await 轮询 —— 让 useRunTrigger 等到任务真正完成才 markDone，LoopNode awaitNode 才能拿到 audioUrl
      await startPolling(idsToPoll, reporter);
    } catch (e: any) {
      const msg = e?.message || '提交失败';
      await reporter?.providerResponse({
        provider: traceProvider,
        model: traceModel,
        requestId: e?.requestId,
        transportHttpStatus: e?.transportHttpStatus,
        upstreamHttpStatus: e?.upstreamHttpStatus,
        status: 'failed',
        error: { message: msg, code: e?.code },
        httpStatusSource: 'local-backend',
      });
      setError(msg);
      logBus.error(msg, src);
      update({ status: 'error', error: msg });
    }
  };

  const handleStop = () => {
    stopPoll();
    update({ status: 'idle' });
  };

  // 接入运行总线
  useRunTrigger(id, async (reporter) => {
    if (status === 'submitting' || status === 'polling') return;
    await handleGenerate(reporter);
  }, 'audio', {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => isWhisper
      ? nodeData?.reuseResult === true && typeof nodeData?.transcript === 'string' && nodeData.transcript.trim().length > 0
      : isLyria
        ? nodeData?.reuseResult === true && (
            hasReusableGenerationResult('audio', nodeData)
            || (typeof nodeData?.seedanceNzAudioResultText === 'string' && nodeData.seedanceNzAudioResultText.trim().length > 0)
            || (Array.isArray(nodeData?.videos) && nodeData.videos.length > 0)
            || (Array.isArray(nodeData?.fileUrls) && nodeData.fileUrls.length > 0)
          )
      : isSunoNz
        ? nodeData?.reuseResult === true && (
            hasReusableGenerationResult('audio', nodeData)
            || (typeof nodeData?.sunoResultText === 'string' && nodeData.sunoResultText.trim().length > 0)
            || (Array.isArray(nodeData?.sunoVideoUrls) && nodeData.sunoVideoUrls.length > 0)
            || (Array.isArray(nodeData?.sunoFileUrls) && nodeData.sunoFileUrls.length > 0)
          )
      : shouldReuseGenerationResult('audio', nodeData),
  });

  // === 跨节点拖拽: source (输出 tracks 可拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (Seed Audio additionally accepts one reference image) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'audio' && payload.url) {
      update({ localRefAudio: payload.url, uploadedClipId: '', uploadedFilename: payload.name || '' });
      logBus.info('已接受拖入参考音频, 生成时将自动上传', src);
    } else if (isWhisper && payload.kind === 'video' && payload.url) {
      update({ localRefAudio: payload.url, uploadedClipId: '', uploadedFilename: payload.name || '' });
      logBus.info('已接受拖入 MP4 视频，Whisper 将直接转写其中的语音', src);
    } else if (isSeedAudio && payload.kind === 'image' && payload.url) {
      update({ localRefImage: payload.url });
      logBus.info('已接受 Seed Audio 参考图', src);
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: isSeedAudio
      ? ['image', 'audio', 'text']
      : isWhisper
        ? ['video', 'audio', 'text']
        : isMinimaxClone
          ? ['audio', 'text']
        : ['audio', 'text'],
    onDrop: handleDrop,
  });

  const isBusy = status === 'submitting' || status === 'polling';
  const showRefArea = isSuno && !isSunoNz && (mode === 'cover' || mode === 'extend');
  const showSunoNzAudioImport = isSunoNz && sunoNzAction.referenceType === 'url';
  const audioColor = PORT_COLOR.audio;
  const textColor = PORT_COLOR.text;
  const videoColor = PORT_COLOR.video;

  if (canvasRenderMode === 'cold') {
    return (
      <div className="t8-node-cold-shell w-[320px]" data-t8-node-cold-shell="audio" style={{ minHeight: 112 }}>
        <Handle type="target" position={Position.Left} style={{ background: audioColor, border: 0 }} />
        {isWhisper || isMinimaxClone || (isSunoNz && sunoNzAction.resultFamily === 'text') || (isLyria && flowMusicAction.resultFamily === 'text') ? (
          <Handle type="source" id="text" position={Position.Right} style={{ background: textColor, border: 0 }} />
        ) : (isSunoNz && sunoNzAction.resultFamily === 'video') || (isLyria && flowMusicAction.resultFamily === 'video') ? (
          <Handle type="source" id="video" position={Position.Right} style={{ background: videoColor, border: 0 }} />
        ) : (
          <>
            <Handle type="source" id="audio-0" position={Position.Right} style={{ background: audioColor, border: 0, top: '48%' }} />
            <Handle type="source" id="audio-1" position={Position.Right} style={{ background: audioColor, border: 0, top: '52%' }} />
          </>
        )}
        <div className="t8-node-cold-shell__header">
          <Music size={16} className="shrink-0 text-violet-300" />
          <div className="t8-node-cold-shell__copy">
            <strong>{translate('nodes:audio.title')}</strong>
            <small>{audioProviderMode} · {translate('common:performance.offscreenPreview')}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      {...dropProps}
      className={`relative rounded-xl border-2 transition-all w-[320px] ${
        selected ? 'border-violet-400 shadow-2xl shadow-violet-500/20' : isAccepting ? 'border-emerald-400' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        boxShadow: isAccepting ? '0 0 0 2px rgba(52,211,153,.45), 0 12px 30px rgba(52,211,153,.18)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: audioColor, border: 0 }} />
      {isWhisper || isMinimaxClone || (isSunoNz && sunoNzAction.resultFamily === 'text') || (isLyria && flowMusicAction.resultFamily === 'text') ? (
        <Handle type="source" id="text" position={Position.Right} style={{ background: textColor, border: 0 }} />
      ) : (isSunoNz && sunoNzAction.resultFamily === 'video') || (isLyria && flowMusicAction.resultFamily === 'video') ? (
        <Handle type="source" id="video" position={Position.Right} style={{ background: videoColor, border: 0 }} />
      ) : (
        <>
          {/* 双输出口: 轨道 1 / 轨道 2 */}
          <Handle type="source" id="audio-0" position={Position.Right} style={{ background: audioColor, border: 0, top: '48%' }} />
          <Handle type="source" id="audio-1" position={Position.Right} style={{ background: audioColor, border: 0, top: '52%' }} />
          <div className="absolute right-[-2px] text-[8px] font-bold text-violet-300/70 pointer-events-none" style={{ top: '48%', transform: 'translateX(100%) translateY(-50%)' }}>♪1</div>
          <div className="absolute right-[-2px] text-[8px] font-bold text-violet-300/70 pointer-events-none" style={{ top: '52%', transform: 'translateX(100%) translateY(-50%)' }}>♪2</div>
        </>
      )}

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(139,92,246,.2)', color: audioColor, boxShadow: 'inset 0 0 0 1px rgba(139,92,246,.45)' }}
        >
          <Music size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">{translate('nodes:audio.titleWithProvider', { provider:
            isWhisper ? 'Whisper'
              : isSeedAudio ? 'Seed Audio'
                : isQwen3Tts ? 'Qwen3-TTS'
                  : isMinimaxAudio ? 'MiniMax'
                    : isMureka ? 'Mureka'
                      : isLyria ? 'Lyria' : 'Suno'
          })}</div>
          <div className="text-[10px] text-white/40 truncate">
            {isWhisper
              ? `whisper-1 · ${translate('nodes:generation.budgetHouse')}`
              : isSeedAudio
                ? `doubao-seed-audio-1.0 · ${translate('nodes:generation.budgetHouse')}`
                : isSeedanceNzAudio
                  ? `${isQwen3Tts ? qwenTtsModel : isMinimaxAudio ? minimaxAudioModel : murekaModel} · ${translate('nodes:generation.budgetHouse')}`
                : isLyria
                  ? `${flowMusicOperation} · flowmusic · ${translate('nodes:generation.budgetHouse')}`
                : isSunoNz
                  ? `${sunoNzOperation} · ${translate('nodes:generation.budgetHouse')}`
                  : `${version} · ${MODES.find((m) => m.id === mode)?.label}`}
          </div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-3 gap-1 rounded border border-white/10 bg-black/15 p-1">
          {([
            { value: 'suno', label: 'Suno' },
            { value: 'seed-audio', label: 'Seed Audio' },
            { value: 'whisper', label: 'Whisper' },
            { value: 'qwen3-tts', label: 'Qwen3-TTS' },
            { value: 'minimax', label: 'MiniMax' },
            { value: 'mureka', label: 'Mureka' },
            { value: 'lyria', label: 'Lyria' },
          ] as const).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => update({ audioProviderMode: item.value, status: 'idle', error: null })}
              className={`rounded px-2 py-1 text-[11px] font-semibold transition-colors ${audioProviderMode === item.value ? 'bg-violet-400/25 text-violet-100 ring-1 ring-violet-300/50' : 'text-white/45 hover:bg-white/5 hover:text-white/75'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isSuno && (
          <div className="rounded border border-violet-300/20 bg-violet-400/[0.05] p-2">
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.sunoPlatform')}</label>
            <select
              value={sunoPlatform}
              onChange={(e) => update({
                sunoPlatform: e.target.value,
                status: 'idle',
                error: null,
                taskId: undefined,
              })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-violet-300/40"
            >
              <option value="zhenzhen" className="bg-zinc-900">{translate('nodes:audio.workshopLegacy')}</option>
              <option value="seedance-nz" className="bg-zinc-900">{translate('nodes:generation.budgetHouse')}</option>
            </select>
          </div>
        )}

        {isSuno && !isSunoNz && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.mode')}</label>
            <select
              value={mode}
              onChange={(e) => update({ mode: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id} className="bg-zinc-900">
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.version')}</label>
            <select
              value={version}
              onChange={(e) => update({ version: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {SUNO_VERSIONS.map((v) => (
                <option key={v.value} value={v.value} className="bg-zinc-900">
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        )}

        {isSunoNz && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.sunoActions')}</label>
              <select
                value={sunoNzOperation}
                onChange={(e) => {
                  const next = getSunoNzActionDef(e.target.value);
                  update({
                    sunoNzOperation: next.value,
                    sunoNzVersion: next.defaultVersion || next.allowedVersions[0] || '',
                    status: 'idle',
                    error: null,
                  });
                }}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/40"
              >
                {SUNO_NZ_ACTIONS.map((item) => (
                  <option key={item.value} value={item.value} className="bg-zinc-900">
                    {item.value} · {item.label}
                  </option>
                ))}
              </select>
            </div>
            {sunoNzAction.allowedVersions.length > 0 && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.version')}</label>
                <select
                  value={sunoNzVersion}
                  onChange={(e) => update({ sunoNzVersion: e.target.value })}
                  className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none"
                >
                  {sunoNzAction.allowedVersions.map((item) => (
                    <option key={item} value={item} className="bg-zinc-900">{item}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="text-[10px] leading-relaxed text-white/45">
              官方路径：{sunoNzAction.action ? `/v1/music/generations/${sunoNzAction.action}` : '/v1/music/generations'}
              {' · '}结果：{sunoNzAction.resultFamily}
            </div>
          </div>
        )}

        {isLyria && (
          <div className="rounded border border-fuchsia-300/20 bg-fuchsia-400/[0.05] p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.flowMusicActions')}</label>
              <select
                value={flowMusicOperation}
                onChange={(e) => update({ flowMusicOperation: e.target.value, status: 'idle', error: null, taskId: undefined })}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-fuchsia-300/40"
              >
                {FLOWMUSIC_ACTIONS.map((item) => (
                  <option key={item.value} value={item.value} className="bg-zinc-900">{item.value} · {item.label}</option>
                ))}
              </select>
            </div>
            {flowMusicAction.supportsLyria35 && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.generationVersion')}</label>
                <select value={flowMusicVersion} onChange={(e) => update({ flowMusicVersion: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                  {FLOWMUSIC_VERSIONS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item === 'default' ? translate('nodes:audio.defaultVersion') : item}</option>)}
                </select>
              </div>
            )}
            {flowMusicOperation === 'flowmusic-generation' && (
              <>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.lyricsRequirement')}</label>
                  <textarea value={flowMusicLyrics} onChange={(e) => update({ flowMusicLyrics: e.target.value })} placeholder={translate('nodes:audio.fullLyricsPlaceholder')} className="h-24 w-full resize-y rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="text-[10px] text-white/50">BPM<input type="number" min={1} value={flowMusicBpm} onChange={(e) => update({ flowMusicBpm: Number(e.target.value) || 120 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                  <label className="text-[10px] text-white/50">{translate('nodes:generation.durationSeconds')}<input type="number" min={1} max={240} value={flowMusicLength} onChange={(e) => update({ flowMusicLength: Number(e.target.value) || 60 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                </div>
              </>
            )}
            {['flowmusic-extend', 'flowmusic-replace', 'flowmusic-cover', 'flowmusic-stems', 'flowmusic-download-audio', 'flowmusic-video-clip'].includes(flowMusicOperation) && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">来源 clip_id</label>
                <input value={flowMusicClipId} onChange={(e) => update({ flowMusicClipId: e.target.value })} placeholder="留空则自动读取上游 Lyria 节点" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
                <div className="mt-1 text-[10px] leading-relaxed text-amber-100/55">续写 / 替换 / 翻唱优先连接 Lyria 音乐生成节点取得原生 clip；部分导入音频 clip 只支持下载类操作。</div>
              </div>
            )}
            {flowMusicOperation === 'flowmusic-extend' && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-white/50">从第几秒续写<input type="number" min={0} step={0.1} value={flowMusicExtendFrom} onChange={(e) => update({ flowMusicExtendFrom: Number(e.target.value) || 0 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                <label className="text-[10px] text-white/50">续写时长(1–164秒)<input type="number" min={1} max={164} value={flowMusicExtendSeconds} onChange={(e) => update({ flowMusicExtendSeconds: Number(e.target.value) || 30 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
              </div>
            )}
            {flowMusicOperation === 'flowmusic-replace' && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-white/50">开始秒数<input type="number" min={0} step={0.1} value={flowMusicStartSeconds} onChange={(e) => update({ flowMusicStartSeconds: Number(e.target.value) || 0 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                <label className="text-[10px] text-white/50">结束秒数<input type="number" min={0} step={0.1} value={flowMusicEndSeconds} onChange={(e) => update({ flowMusicEndSeconds: Number(e.target.value) || 10 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
              </div>
            )}
            {flowMusicOperation === 'flowmusic-cover' && (
              <label className="text-[10px] text-white/50 block">翻唱强度 0–1<input type="number" min={0} max={1} step={0.05} value={flowMusicStrength} onChange={(e) => update({ flowMusicStrength: Number(e.target.value) })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
            )}
            {flowMusicOperation === 'flowmusic-download-audio' && (
              <label className="text-[10px] text-white/50 block">下载格式<select value={flowMusicFormat} onChange={(e) => update({ flowMusicFormat: e.target.value })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white">{FLOWMUSIC_FORMATS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}</select></label>
            )}
            {flowMusicOperation === 'flowmusic-video-clip' && (
              <label className="text-[10px] text-white/50 block">视频预设<select value={flowMusicPreset} onChange={(e) => update({ flowMusicPreset: e.target.value })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white">{FLOWMUSIC_VIDEO_PRESETS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}</select></label>
            )}
            {flowMusicAction.supportsLyria35 && (
              <label className="text-[10px] text-white/50 block">标题（可选）<input value={flowMusicTitle} onChange={(e) => update({ flowMusicTitle: e.target.value })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
            )}
            <div className="text-[10px] leading-relaxed text-white/45">
              固定请求 model=flowmusic · 官方路径 /v1/music/generations{flowMusicAction.action ? `/${flowMusicAction.action}` : ''} · 结果 {flowMusicAction.resultFamily}
            </div>
          </div>
        )}

        {isQwen3Tts && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.qwenModel')}</label>
              <select value={qwenTtsModel} onChange={(e) => update({ qwenTtsModel: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                {QWEN3_TTS_MODELS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.voiceId')}</label>
                <input value={qwenTtsVoice} onChange={(e) => update({ qwenTtsVoice: e.target.value })} placeholder="Cherry" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.language')}</label>
                <select value={qwenTtsLanguage} onChange={(e) => update({ qwenTtsLanguage: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                  {QWEN3_TTS_LANGUAGE_TYPES.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
                </select>
              </div>
            </div>
            {qwenTtsModel === QWEN3_TTS_INSTRUCT_FLASH_MODEL && (
              <div className="space-y-1">
                <label className="text-[10px] text-white/50 block">{translate('nodes:audio.expressionInstruction')}</label>
                <textarea value={qwenTtsInstructions} onChange={(e) => update({ qwenTtsInstructions: e.target.value })} placeholder={translate('nodes:audio.expressionPlaceholder')} className="h-14 w-full resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none" />
                <label className="flex items-center gap-2 text-[10px] text-white/60">
                  <input type="checkbox" checked={qwenTtsOptimizeInstructions} onChange={(e) => update({ qwenTtsOptimizeInstructions: e.target.checked })} className="accent-cyan-400" />
                  {translate('nodes:audio.optimizeInstruction')}
                </label>
              </div>
            )}
          </div>
        )}

        {isMinimaxAudio && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.minimaxModel')}</label>
              <select value={minimaxAudioModel} onChange={(e) => update({ minimaxAudioModel: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                {MINIMAX_AUDIO_MODELS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
              </select>
            </div>
            {isMinimaxMusic && (
              <>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-white/65">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={minimaxInstrumental} onChange={(e) => update({ minimaxInstrumental: e.target.checked })} className="accent-cyan-400" />{translate('nodes:audio.instrumental')}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={minimaxLyricsOptimizer} onChange={(e) => update({ minimaxLyricsOptimizer: e.target.checked })} className="accent-cyan-400" />{translate('nodes:audio.optimizeLyrics')}</label>
                </div>
                {!minimaxInstrumental && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.lyrics')}</label>
                    <textarea value={minimaxLyrics} onChange={(e) => update({ minimaxLyrics: e.target.value })} placeholder={translate('nodes:audio.fullLyricsPlaceholder')} className="h-20 w-full resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none" />
                  </div>
                )}
              </>
            )}
            {!isMinimaxMusic && !isMinimaxClone && (
              <>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.voiceId')}</label>
                  <input value={minimaxVoiceId} onChange={(e) => update({ minimaxVoiceId: e.target.value })} placeholder="Wise_Woman" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="text-[10px] text-white/50">{translate('nodes:audio.speechRate')}<input type="number" min={0.5} max={2} step={0.05} value={minimaxSpeed} onChange={(e) => update({ minimaxSpeed: Number(e.target.value) || 1 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                  <label className="text-[10px] text-white/50">{translate('nodes:audio.volume')}<input type="number" min={0.1} max={10} step={0.1} value={minimaxVolume} onChange={(e) => update({ minimaxVolume: Number(e.target.value) || 1 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                  <label className="text-[10px] text-white/50">{translate('nodes:audio.pitch')}<input type="number" min={-12} max={12} step={1} value={minimaxPitch} onChange={(e) => update({ minimaxPitch: Number(e.target.value) || 0 })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white" /></label>
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.languageBoost')}</label>
                  <select value={minimaxLanguageBoost} onChange={(e) => update({ minimaxLanguageBoost: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white">
                    {MINIMAX_LANGUAGE_BOOSTS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
                  </select>
                </div>
              </>
            )}
            {isMinimaxClone && (
              <>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">自定义音色 ID（8–256 位）</label>
                  <input value={minimaxCustomVoiceId} onChange={(e) => update({ minimaxCustomVoiceId: e.target.value })} placeholder="SeedanceVoice01" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">目标语音模型</label>
                  <select value={minimaxCloneTargetModel} onChange={(e) => update({ minimaxCloneTargetModel: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white">
                    <option value={MINIMAX_SPEECH_HD_MODEL} className="bg-zinc-900">{MINIMAX_SPEECH_HD_MODEL}</option>
                    <option value={MINIMAX_SPEECH_TURBO_MODEL} className="bg-zinc-900">{MINIMAX_SPEECH_TURBO_MODEL}</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-white/65">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={minimaxNoiseReduction} onChange={(e) => update({ minimaxNoiseReduction: e.target.checked })} className="accent-cyan-400" />参考音降噪</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={minimaxVolumeNormalization} onChange={(e) => update({ minimaxVolumeNormalization: e.target.checked })} className="accent-cyan-400" />音量归一化</label>
                </div>
                <div className="text-[10px] leading-relaxed text-white/40">必须提供 1 段 10 秒至 5 分钟参考音频；成功后输出音色 ID 文本。</div>
              </>
            )}
            {!isMinimaxClone && (
              <div className="grid grid-cols-3 gap-1.5">
                <label className="text-[10px] text-white/50">格式<select value={minimaxOutputFormat} onChange={(e) => update({ minimaxOutputFormat: e.target.value })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-1 py-1 text-[10px] text-white">{MINIMAX_AUDIO_FORMATS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}</select></label>
                <label className="text-[10px] text-white/50">采样率<select value={minimaxSampleRate} onChange={(e) => update({ minimaxSampleRate: e.target.value })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-1 py-1 text-[10px] text-white">{MINIMAX_SAMPLE_RATES.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}</select></label>
                <label className="text-[10px] text-white/50">码率<select value={minimaxBitrate} onChange={(e) => update({ minimaxBitrate: e.target.value })} className="mt-1 w-full rounded bg-white/5 border border-white/10 px-1 py-1 text-[10px] text-white">{MINIMAX_BITRATES.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}</select></label>
              </div>
            )}
          </div>
        )}

        {isMureka && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.murekaModel')}</label>
                <select value={murekaModel} onChange={(e) => update({ murekaModel: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white">
                  {MUREKA_BGM_MODELS.map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.generationCount')}</label>
                <select value={murekaCount} onChange={(e) => update({ murekaCount: Number(e.target.value) })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white">
                  {[1, 2, 3].map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">instrumental_id（与 Prompt 二选一）</label>
              <input value={murekaInstrumentalId} onChange={(e) => update({ murekaInstrumentalId: e.target.value })} placeholder="留空则使用下面的 Prompt" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
            </div>
            <div className="text-[10px] leading-relaxed text-white/40">返回 1–3 个有序 BGM 结果；画布会按上游顺序逐个保存，不截断。</div>
          </div>
        )}

        <LocalNodeAddonSlot
          nodeId={id}
          nodeType="audio"
          data={d}
          update={update}
          context={{
            providerSource: isSeedAudio || isWhisper || isSunoNz || isSeedanceNzAudio || isLyria ? 'seedance-nz' : 'zhenzhen',
            model: isWhisper ? 'whisper-1' : isSeedAudio ? 'doubao-seed-audio-1.0' : isQwen3Tts ? qwenTtsModel : isMinimaxAudio ? minimaxAudioModel : isMureka ? murekaModel : isLyria ? flowMusicOperation : isSunoNz ? sunoNzOperation : version,
            apiModel: isWhisper ? 'whisper-1' : isSeedAudio ? 'doubao-seed-audio-1.0' : isQwen3Tts ? qwenTtsModel : isMinimaxAudio ? minimaxAudioModel : isMureka ? murekaModel : isLyria ? 'flowmusic' : isSunoNz ? sunoNzOperation : `suno-${version}`,
            providerKind: isWhisper ? 'whisper' : isSeedAudio ? 'seed-audio' : isQwen3Tts ? 'qwen3-tts' : isMinimaxAudio ? 'minimax' : isMureka ? 'mureka' : isLyria ? 'lyria' : 'suno',
          }}
        />

        {isSuno && !isSunoNz && (
        <>
        <div>
          <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.songTitle')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="My Song"
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>
        <div>
          <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.styleTags')}</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => update({ tags: e.target.value })}
            placeholder="pop, electronic, female vocal"
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>
        </>
        )}
        {isSunoNz && sunoNzOperation === 'suno-generation' && (
          <div className="rounded border border-white/10 bg-black/10 p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.titleOptional')}</label>
              <input value={title} onChange={(e) => update({ title: e.target.value })} placeholder="My Song" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.styleOptional')}</label>
              <input value={sunoStyle} onChange={(e) => update({ sunoStyle: e.target.value })} placeholder="pop, cinematic, female vocal" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex items-center gap-1.5 rounded border border-white/10 px-2 py-1 text-[10px] text-white/65">
                <input type="checkbox" checked={sunoCustom} onChange={(e) => update({ sunoCustom: e.target.checked })} />
                {translate('nodes:audio.customMode')}
              </label>
              <label className="flex items-center gap-1.5 rounded border border-white/10 px-2 py-1 text-[10px] text-white/65">
                <input type="checkbox" checked={sunoInstrumental} onChange={(e) => update({ sunoInstrumental: e.target.checked })} />
                {translate('nodes:audio.instrumental')}
              </label>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.vocalGenderOptional')}</label>
              <select value={sunoVocalGender} onChange={(e) => update({ sunoVocalGender: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                <option value="" className="bg-zinc-900">{translate('nodes:generation.automatic')}</option>
                <option value="m" className="bg-zinc-900">{translate('nodes:audio.male')}</option>
                <option value="f" className="bg-zinc-900">{translate('nodes:audio.female')}</option>
              </select>
            </div>
          </div>
        )}
        {isSunoNz && sunoNzOperation === 'suno-upsample-tags' && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.styleTags')}</label>
            <input value={tags} onChange={(e) => update({ tags: e.target.value })} placeholder="pop, cinematic, energetic" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </div>
        )}
        {!isWhisper && (!isSunoNz || sunoNzAction.requiredFields.includes('prompt')) && (!isLyria || flowMusicNeedsPrompt) && (
        <div>
          <label className="text-[10px] text-white/50 block mb-1">{
            isSeedAudio ? '音频提示词'
              : isQwen3Tts ? '需要合成的文本'
                : isMinimaxMusic ? '音乐风格 / 内容描述'
                  : isMinimaxClone ? '克隆任务说明 / 试听文本'
                    : isMinimaxAudio ? '需要朗读的文本'
                      : isMureka ? 'BGM 描述（与 instrumental_id 二选一）'
                        : isLyria
                          ? flowMusicOperation === 'flowmusic-generation'
                            ? '曲风 / 编曲提示词（可选）'
                            : flowMusicOperation === 'flowmusic-lyrics'
                              ? '歌词主题 / 写作要求'
                              : '续写 / 替换 / 翻唱指令'
                        : sunoNzOperation === 'suno-lyrics' ? '歌词主题 / 要求' : '歌词 / 提示词'
          }</label>
          <MentionPromptInput
            title={translate('nodes:audio.promptTitle')}
            value={localPrompt}
            mentions={promptMentions}
            materials={mentionMaterials}
            onChange={(value, mentions) => update({ prompt: value, promptMentions: mentions })}
            placeholder={isSeedAudio
              ? '例如：雨夜城市街道，轻柔雨声与远处车流，无人声'
              : isQwen3Tts || (isMinimaxAudio && !isMinimaxMusic)
                ? '输入需要合成的语音文本'
                : isMureka
                  ? '例如：温暖、轻盈的原声吉他背景音乐'
                  : isLyria
                    ? (flowMusicOperation === 'flowmusic-lyrics' ? '例如：写一首关于雨夜重逢的中文流行歌词' : '例如：电影感电子流行，女声，120 BPM')
                    : '[Verse]...'}
            isDark={isDark}
            isPixel={isPixel}
            promptTemplateKind="video"
            className="w-full h-16 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>
        )}

        {isSunoNz && (sunoNzAction.referenceType === 'task_audio' || sunoNzAction.referenceType === 'mashup') && (
          <div className="rounded border border-violet-300/20 bg-violet-400/[0.04] p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">来源 task_id</label>
              <input
                value={sunoTaskRef}
                onChange={(e) => update({ sunoTaskRef: e.target.value })}
                placeholder={taskId ? `留空使用本节点上次任务 ${taskId.slice(0, 10)}…` : '粘贴来源 Suno task_id'}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none placeholder:text-white/25"
              />
            </div>
            {sunoNzAction.referenceType === 'mashup' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">第二个 task_id</label>
                <input value={sunoTaskRef2} onChange={(e) => update({ sunoTaskRef2: e.target.value })} placeholder="第二首歌曲 task_id" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
              </div>
            )}
            {sunoNzAction.referenceType === 'task_audio' && (
              <div>
                <label className="text-[10px] text-white/50 block mb-1">音频序号（audio_index）</label>
                <input type="number" min={1} value={sunoAudioIndex} onChange={(e) => update({ sunoAudioIndex: Math.max(1, Number(e.target.value) || 1) })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
              </div>
            )}
          </div>
        )}

        {isSunoNz && ['suno-crop', 'suno-remove-section', 'suno-replace-music', 'suno-sample'].includes(sunoNzOperation) && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">开始秒数</label>
              <input type="number" min={0} step="0.1" value={sunoStartSeconds} onChange={(e) => update({ sunoStartSeconds: Number(e.target.value) || 0 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">结束秒数</label>
              <input type="number" min={0} step="0.1" value={sunoEndSeconds} onChange={(e) => update({ sunoEndSeconds: Number(e.target.value) || 0 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
            </div>
          </div>
        )}

        {isSunoNz && sunoNzOperation === 'suno-extend' && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">续写起点（秒）</label>
            <input type="number" min={0} step="0.1" value={continueAt} onChange={(e) => update({ continueAt: Number(e.target.value) || 0 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </div>
        )}

        {isSunoNz && ['suno-fade-in', 'suno-fade-out'].includes(sunoNzOperation) && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">渐变时长（秒）</label>
            <input type="number" min={0} step="0.1" value={sunoDurationSeconds} onChange={(e) => update({ sunoDurationSeconds: Number(e.target.value) || 0 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </div>
        )}

        {isSunoNz && sunoNzOperation === 'suno-adjust-speed' && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">速度倍率</label>
            <input type="number" min={0.01} step="0.05" value={sunoSpeed} onChange={(e) => update({ sunoSpeed: Number(e.target.value) || 1 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </div>
        )}

        {isSunoNz && sunoNzOperation === 'suno-persona' && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Persona 名称</label>
            <input value={sunoPersonaName} onChange={(e) => update({ sunoPersonaName: e.target.value })} placeholder="例如：雨夜女声" className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </div>
        )}

        {isSeedAudio && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">音色 ID（可选）</label>
              <input
                value={seedAudioSpeaker}
                onChange={(e) => update({ seedAudioSpeaker: e.target.value })}
                placeholder="与参考图 / 参考音频互斥"
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/40 placeholder:text-white/25"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.format')}</label>
                <select value={seedAudioFormat} onChange={(e) => update({ seedAudioFormat: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                  {['wav', 'mp3', 'pcm', 'ogg_opus'].map((item) => <option key={item} value={item} className="bg-zinc-900">{item}</option>)}
                </select>
              </div>
              <div>
              <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:audio.sampleRate')}</label>
                <select value={seedAudioSampleRate} onChange={(e) => update({ seedAudioSampleRate: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none">
                  {['8000', '16000', '24000', '32000', '44100'].map((item) => <option key={item} value={item} className="bg-zinc-900">{item} Hz</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: '语速', field: 'seedAudioSpeechRate', value: seedAudioSpeechRate, min: -50, max: 100 },
                { label: '音量', field: 'seedAudioLoudnessRate', value: seedAudioLoudnessRate, min: -50, max: 100 },
                { label: '音高', field: 'seedAudioPitchRate', value: seedAudioPitchRate, min: -12, max: 12 },
              ].map((item) => (
                <div key={item.field}>
                  <label className="text-[10px] text-white/50 block mb-1">{item.label}</label>
                  <input type="number" min={item.min} max={item.max} value={item.value} onChange={(e) => update({ [item.field]: Number(e.target.value) || 0 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
                </div>
              ))}
            </div>
            <div className="text-[10px] leading-relaxed text-white/40">
              参考方式三选一：音色 ID、1 张参考图或最多 3 段参考音频；混用时会在提交前阻止。
            </div>
          </div>
        )}

        {isSuno && !isSunoNz && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{translate('nodes:generation.seedRandom')}</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => update({ seed: parseInt(e.target.value) || 0 })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
          {mode === 'extend' && (
            <div>
              <label className="text-[10px] text-white/50 block mb-1">续点 (s)</label>
              <input
                type="number"
                value={continueAt}
                onChange={(e) => update({ continueAt: parseInt(e.target.value) || 28 })}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              />
            </div>
          )}
        </div>
        )}

        {/* 上游素材聚合预览区 (generate=仅文本, cover/extend=文本+音频) */}
        <MaterialPreviewSection
          texts={orderedTexts}
          images={orderedImages}
          videos={orderedVideos}
          audios={orderedAudios}
          order={materialOrder}
          onReorder={setMaterialOrder}
          onExcludeUpstream={handleExcludeUpstreamMaterial}
          excludedCount={excludedUpstreamCount}
          onRestoreExcluded={handleRestoreExcludedMaterials}
          selected={!!selected}
          isDark={isDark}
          isPixel={isPixel}
          groups={previewGroups}
          title={isWhisper
            ? '待转写素材 · 音频 / MP4'
            : isSeedAudio
              ? '上游素材 · Seed Audio 参考'
              : isMinimaxClone
                ? '上游素材 · MiniMax 克隆参考音频'
                : isSeedanceNzAudio
                  ? '上游素材 · 文本提示'
                : isLyria
                  ? '上游素材 · 文本 / 音频 / clip_id'
              : isSunoNz
                ? '上游素材 · 文本 / 最多 4 段音频'
                : mode === 'generate' ? '上游素材 · 歌词提示' : '上游素材 · 参考音频'}
        />

        {(isSeedAudio || isWhisper || isMinimaxClone || isLyria || showSunoNzAudioImport) && (localRefImage || localRefAudio) && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10px] text-cyan-100/75">
              <span>本地参考素材</span>
              <button type="button" onClick={() => update({ localRefImage: '', localRefAudio: '' })} className="text-white/40 hover:text-white" title="清除本地参考素材"><X size={11} /></button>
            </div>
            {localRefImage && <div className="truncate text-[10px] text-white/50">参考图：{localRefImage.split('/').pop()}</div>}
            {localRefAudio && <div className="truncate text-[10px] text-white/50">参考音频：{localRefAudio.split('/').pop()}</div>}
          </div>
        )}

        {(isSeedAudio || isWhisper || isMinimaxClone || isLyria || showSunoNzAudioImport) && (
          <div className="flex gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept={isWhisper ? 'audio/*,video/mp4,.mp3,.wav,.flac,.m4a,.mp4,.ogg,.opus,.aac,.aiff,.aif' : 'audio/*,.mp3,.wav,.flac,.ogg'}
              className="hidden"
              onChange={onSelectFile}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex-1 flex items-center justify-center gap-1 rounded bg-white/5 py-1 text-[10px] text-cyan-100 hover:bg-white/10 disabled:opacity-50">
              {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
              {uploading
                ? '导入中…'
                : isWhisper ? '导入待转写音频 / MP4'
                  : isMinimaxClone ? '导入克隆参考音频（10 秒–5 分钟）'
                    : isLyria ? '导入 Lyria 参考音频'
                    : isSunoNz ? '导入 Suno 参考音频（至少 6 秒）' : '导入参考音频'}
            </button>
          </div>
        )}

        {isWhisper && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold text-cyan-100">Whisper 语音转文字</div>
                <div className="text-[10px] leading-relaxed text-white/40">支持 mp3、wav、flac、m4a、mp4、ogg、opus、aac、aiff；官方接口不支持 webm。</div>
              </div>
              <select
                value={whisperResponseFormat}
                onChange={(e) => update({ whisperResponseFormat: e.target.value })}
                className="rounded bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white outline-none"
                title="返回格式"
              >
                {(['json', 'verbose_json', 'srt', 'text', 'vtt'] as const).map((item) => (
                  <option key={item} value={item} className="bg-zinc-900">{item}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {showRefArea && (
          <div className="rounded border border-violet-400/30 bg-violet-500/5 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-violet-200/80">
                {mode === 'cover' ? '参考音频 (Cover)' : '参考音频 (Extend)'}
              </span>
              {(uploadedClipId || localRefAudio) && (
                <button
                  onClick={() => {
                    clearUpload();
                    if (localRefAudio) update({ localRefAudio: '' });
                  }}
                  className="text-violet-300/60 hover:text-violet-100"
                  title="清除"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {uploadedClipId ? (
              <div className="text-[10px] text-violet-100/90 truncate">
                🎵 {uploadedFilename || uploadedClipId.slice(0, 12)}
                <span className="text-white/40 ml-1">({uploadedClipId.slice(0, 8)}…)</span>
              </div>
            ) : localRefAudio ? (
              <div className="text-[10px] text-emerald-200/90 truncate">
                📥 本地拖入: {localRefAudio.split('/').pop()}
                <span className="text-white/40 ml-1">(生成时上传)</span>
              </div>
            ) : (
              <div className="text-[10px] text-white/40">未上传 · 连接上游音频节点可自动拉取</div>
            )}
            <div className="flex gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={onSelectFile}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-white/5 hover:bg-white/10 text-violet-100 text-[10px] disabled:opacity-50"
              >
                {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                {uploading ? '上传中…' : '上传本地音频'}
              </button>
            </div>
          </div>
        )}

        {(isSunoNz || isLyria) && taskId && (
          <div className="rounded border border-white/10 bg-black/10 px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between text-[10px] text-white/45">
              <span>本次 task_id（后续处理可直接使用）</span>
              <button type="button" onClick={() => navigator.clipboard?.writeText(taskId)} className="text-cyan-200 hover:text-cyan-100">复制</button>
            </div>
            <div className="select-all break-all font-mono text-[10px] text-white/70">{taskId}</div>
          </div>
        )}

        <ReuseResultToggle
          checked={d?.reuseResult === true}
          hasResult={isWhisper
            ? transcript.trim().length > 0
            : isLyria
              ? hasReusableGenerationResult('audio', d) || seedanceNzAudioResultText.trim().length > 0 || (Array.isArray(d?.videos) && d.videos.length > 0) || (Array.isArray(d?.fileUrls) && d.fileUrls.length > 0)
            : isSeedanceNzAudio
              ? hasReusableGenerationResult('audio', d) || seedanceNzAudioResultText.trim().length > 0
            : isSunoNz
              ? hasReusableGenerationResult('audio', d) || !!sunoResultText || sunoVideoUrls.length > 0 || sunoFileUrls.length > 0
              : hasReusableGenerationResult('audio', d)}
          onChange={(checked) => update({ reuseResult: checked })}
          accentColor="#a78bfa"
        />

        {!isBusy ? (
          <button
            onClick={() => requestCanvasNodeRun(id)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> {isWhisper
              ? translate('nodes:audio.startTranscription')
              : isLyria ? translate('nodes:audio.execute', { action: flowMusicAction.label })
              : isSunoNz ? translate('nodes:audio.execute', { action: sunoNzAction.label })
                : isMinimaxClone ? translate('nodes:audio.createCloneVoice')
                  : translate('nodes:audio.generateAudio')}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> {translate('nodes:generation.stop')}
          </button>
        )}

        {isBusy && (
          <div className="flex items-center gap-1 text-[10px] text-violet-200/80">
            <Loader2 size={11} className="animate-spin" />
            {isWhisper ? translate('nodes:audio.transcribing') : status === 'submitting' ? translate('nodes:audio.submitting') : pollProgress.includes('正在下载') ? pollProgress : translate('nodes:audio.polling', { progress: pollProgress })}
            {taskId && <span className="ml-auto text-white/30">{taskId.slice(0, 10)}…</span>}
          </div>
        )}

        {isWhisper && transcript && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] px-2 py-1.5">
            <div className="mb-1 text-[10px] font-semibold text-cyan-100/80">{translate('nodes:audio.transcriptResult')}</div>
            <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/75">{transcript}</div>
          </div>
        )}

        {isSunoNz && sunoResultText && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] px-2 py-1.5">
            <div className="mb-1 text-[10px] font-semibold text-cyan-100/80">{sunoNzAction.label}结果</div>
            <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/75">{sunoResultText}</div>
          </div>
        )}

        {(isSeedanceNzAudio || isLyria) && seedanceNzAudioResultText && (
          <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.05] px-2 py-1.5">
            <div className="mb-1 text-[10px] font-semibold text-cyan-100/80">{isLyria ? flowMusicAction.label : '文本'}结果</div>
            <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-white/75">{seedanceNzAudioResultText}</div>
          </div>
        )}

        {((isSunoNz && sunoVideoUrls.length > 0) || (isLyria && Array.isArray(d?.videos) && d.videos.length > 0)) && !hasAutoOutput && (
          <div className="space-y-2">
            {(isLyria ? d.videos : sunoVideoUrls).map((url: string, index: number) => (
              <LazyVideo
                key={`${url}:${index}`}
                src={url}
                controls
                className="w-full rounded border border-white/10 bg-black"
                data-drag-source
                data-drag-kind="video"
                data-drag-url={url}
                data-drag-preview={url}
                data-drag-node-id={id}
                onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url, sourceNodeId: id, previewUrl: url })}
              />
            ))}
          </div>
        )}

        {((isSunoNz && sunoFileUrls.length > 0) || (isLyria && Array.isArray(d?.fileUrls) && d.fileUrls.length > 0)) && (
          <div className="rounded border border-white/10 bg-white/[0.03] p-2 space-y-1">
            <div className="text-[10px] font-semibold text-white/60">{translate('nodes:audio.resultFiles')}</div>
            {(isLyria ? d.fileUrls : sunoFileUrls).map((url: string, index: number) => (
              <a key={`${url}:${index}`} href={url} download className="block truncate text-[10px] text-cyan-200 hover:underline">
                {translate('nodes:audio.downloadFile', { index: index + 1 })} · {url.split('/').pop()}
              </a>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

      {tracks.length > 0 && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2 space-y-2">
          {tracks.map((t, i) => (
            <div key={t.id || i} className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] text-white/60">
                <span className="text-violet-200">#{i + 1}</span>
                {t.title && <span className="truncate">🎵 {t.title}</span>}
                {t.clipId && <span className="ml-auto text-white/30">{t.clipId.slice(0, 8)}…</span>}
              </div>
              <LazyAudio
                src={t.audioUrl}
                controls
                className="w-full h-8"
                data-drag-source
                data-drag-kind="audio"
                data-drag-url={t.audioUrl}
                data-drag-preview={t.audioUrl}
                data-drag-node-id={id}
                data-resource-title={t.title || t.audioUrl.split('/').pop() || translate('nodes:audio.generateAudio')}
                data-prompt-template-kind="video"
                data-prompt-template-category="video-music-audio"
                data-prompt-template-prompt={d?.lastPrompt || localPrompt}
                onMouseDown={(e) => beginMaterialDrag(e, { kind: 'audio', url: t.audioUrl, sourceNodeId: id, previewUrl: t.audioUrl })}
                title={translate('nodes:generation.ctrlDrag')}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(AudioNode);
