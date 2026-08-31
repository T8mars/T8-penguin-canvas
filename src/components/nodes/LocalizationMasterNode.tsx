import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Languages,
  Loader2,
  Mic2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { SEEDANCE_NZ_LLM_MODELS } from '../../config/llm';
import { LLM_MODELS } from '../../providers/models';
import {
  buildWhisperTranscriptEvidence,
  generateExternalLlm,
  generateLlm,
  transcribeWhisper,
} from '../../services/generation';
import {
  acceptLocalizationModelLicense,
  cancelLocalizationRuntime,
  inspectLocalizationRuntime,
  installLocalizationRuntime,
  muxLocalizationVideo,
  retryLocalizationTtsLine,
  runLocalizationTts,
  saveLocalizationSubtitle,
} from '../../services/localizationMaster';
import { useApiKeysStore } from '../../stores/apiKeys';
import { useThemeStore } from '../../stores/theme';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import {
  LOCALIZATION_LANGUAGE_LABELS,
  LOCALIZATION_TARGET_LANGUAGES,
  MAX_LOCALIZATION_ROLES,
  applyLocalizationTranslationResponse,
  buildLocalizationQc,
  buildLocalizationTranslationMessages,
  createLocalizationProject,
  localizationRoles,
  inspectLocalizationSourceText,
  parseLocalizationText,
  resetLocalizationBranches,
  setLocalizationTargetLanguages,
  serializeLocalizationSrt,
  supportsLocalizationDubbing,
  switchLocalizationBranch,
  syncActiveLocalizationBranch,
  unitsFromWhisperSegments,
  validateLocalizationForDubbing,
  type LocalizationDeliveryManifest,
  type LocalizationProject,
  type LocalizationRuntimeReceipt,
  type LocalizationTargetLanguage,
  type LocalizationTranslationUnit,
  type LocalizationVoiceProfile,
} from '../../utils/localizationMaster';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';

type LocalizationAction = 'parse' | 'transcribe' | 'translate' | 'translate-all' | 'install' | 'dub' | 'dub-line' | 'verify' | 'deliver' | 'deliver-all';
type LocalizationWorkbenchStep = 'source' | 'translate' | 'voice' | 'deliver';
type LocalizationAgentAction = 'localization.create' | 'localization.transcribe' | 'localization.translate'
  | 'localization.cast-voices' | 'localization.generate-dub' | 'localization.compose'
  | 'localization.verify' | 'localization.package';

interface LocalizationAgentRequest {
  schema: 't8-localization-agent-request-v1';
  id: string;
  action: LocalizationAgentAction;
  status: 'prepared' | 'awaiting-user-run' | 'running' | 'completed' | 'failed';
  targetLanguages: LocalizationTargetLanguage[];
  mode: LocalizationProject['mode'];
  sourceLanguage: LocalizationProject['sourceLanguage'];
  instruction: string;
  createdBy: 'creator-agent';
  error?: string;
}

const ZHENZHEN_LLM_MODELS = LLM_MODELS.filter((model) => !model.imageOutput);
const DEFAULT_ZHENZHEN_MODEL = ZHENZHEN_LLM_MODELS.find((model) => model.id === 'gemini-3.5-flash')?.id
  || ZHENZHEN_LLM_MODELS[0]?.id
  || '';
const TRANSLATION_BATCH_SIZE = 80;

function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('aborted'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(done, delayMs);
    const abort = () => done(signal?.reason || new Error('aborted'));
    function done(error?: unknown) {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function mediaKind(material: Material | undefined): 'video' | 'audio' | 'none' {
  return material?.kind === 'video' ? 'video' : material?.kind === 'audio' ? 'audio' : 'none';
}

function materialsForTargetHandle(materials: Material[], handle: string): Material[] {
  const routed = materials.filter((material) => material.targetHandles?.includes(handle));
  if (routed.length) return routed;
  const hasExplicitRoutes = materials.some((material) => (material.targetHandles?.length || 0) > 0);
  return hasExplicitRoutes
    ? materials.filter((material) => !material.targetHandles?.length)
    : materials;
}

function localizationErrorText(error: unknown, isEnglish: boolean): string {
  const code = String((error as any)?.code || '');
  const messages: Record<string, [string, string]> = {
    INDEXTTS25_LICENSE_NOT_CONFIRMED: ['请先在本机阅读并接受 IndexTTS 2.5 模型许可。', 'Read and accept the IndexTTS 2.5 model license on this device first.'],
    INDEXTTS25_RUNTIME_NOT_READY: ['本机 IndexTTS 2.5 运行时尚未就绪，请先检查或安装。', 'The IndexTTS 2.5 runtime is not ready on this device. Check or install it first.'],
    LOCALIZATION_ROLE_LIMIT_EXCEEDED: [`角色数量超过 ${MAX_LOCALIZATION_ROLES} 个，请合并角色后重试。`, `More than ${MAX_LOCALIZATION_ROLES} roles were found. Merge roles and retry.`],
    LOCALIZATION_TTS_RECOVERY_CONFIRMATION_REQUIRED: ['上次配音未留下完整结果。请明确重试，不会自动重复推理。', 'The prior dubbing run has no complete result. Retry explicitly; inference will not replay automatically.'],
  };
  if (messages[code]) return messages[code][isEnglish ? 1 : 0];
  return error instanceof Error ? error.message : String(error);
}

function normalizeProject(data: any): LocalizationProject {
  const saved = data?.localizationProject && typeof data.localizationProject === 'object'
    ? data.localizationProject
    : {};
  return createLocalizationProject({
    ...saved,
    ...(typeof data?.mode === 'string' ? { mode: data.mode } : {}),
    ...(typeof data?.sourceLanguage === 'string' ? { sourceLanguage: data.sourceLanguage } : {}),
    ...(typeof data?.targetLanguage === 'string' ? { targetLanguage: data.targetLanguage } : {}),
    ...(Array.isArray(data?.targetLanguages) ? { targetLanguages: data.targetLanguages } : {}),
    ...(typeof data?.sourceText === 'string' && !saved.sourceText ? { sourceText: data.sourceText } : {}),
  });
}

function runtimeTone(receipt: LocalizationRuntimeReceipt | undefined) {
  if (receipt?.ready) return 'success';
  if (receipt?.install?.running) return 'working';
  if (receipt?.install?.error) return 'error';
  return 'idle';
}

function workbenchStepForProject(project: LocalizationProject): LocalizationWorkbenchStep {
  if (project.stage === 'materials' || project.stage === 'transcript') return 'source';
  if (project.stage === 'translation' || project.stage === 'review') return 'translate';
  if (project.stage === 'voices' || project.stage === 'dubbing') {
    return project.mode === 'subtitle-only' ? 'deliver' : 'voice';
  }
  return 'deliver';
}

function LocalizationMasterNode({ id, data, selected }: NodeProps) {
  const { t: translate, i18n } = useTranslation('nodes');
  const t = (key: string, options?: Record<string, unknown>) => translate(key.replace(/^nodes\./, ''), options);
  const update = useUpdateNodeData(id);
  const { getNode } = useReactFlow();
  const upstream = useUpstreamMaterials(id);
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const d = (data || {}) as any;
  const project = useMemo(() => normalizeProject(d), [d]);
  const agentRequest = d.localizationAgentRequest?.schema === 't8-localization-agent-request-v1'
    ? d.localizationAgentRequest as LocalizationAgentRequest
    : undefined;
  const [localError, setLocalError] = useState('');
  const [runtimeLocal, setRuntimeLocal] = useState<LocalizationRuntimeReceipt | undefined>();
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [sourceTextDraft, setSourceTextDraft] = useState(project.sourceText);
  const [sourceMediaDraft, setSourceMediaDraft] = useState(project.sourceMediaUrl);
  const persistedSourceRef = useRef({ text: project.sourceText, media: project.sourceMediaUrl });
  const actionRef = useRef<LocalizationAction>('parse');
  const pendingActionRef = useRef<LocalizationAction | null>(null);
  const retryUnitIdRef = useRef('');
  const [pendingAction, setPendingAction] = useState<LocalizationAction | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'attention' | 'all' | 'approved'>('attention');
  const [reviewPage, setReviewPage] = useState(0);
  const [activeWorkbenchStep, setActiveWorkbenchStep] = useState<LocalizationWorkbenchStep>(() => workbenchStepForProject(project));
  const automaticStepKeyRef = useRef(`${project.mode}:${project.stage}`);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState('');
  const dubbingPreviewRef = useRef<HTMLAudioElement>(null);
  const previewStopTimerRef = useRef<number | null>(null);

  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const llmAdvancedProviders = useMemo(
    () => advancedProvidersForNode(advancedProviders, 'llm'),
    [advancedProviders],
  );
  const providerSelection = useMemo(() => resolveAdvancedProviderSelection(advancedProviders, 'llm', {
    providerSource: project.providerSource as any,
    providerId: project.providerId,
    providerModel: project.providerModel,
  }), [advancedProviders, project.providerId, project.providerModel, project.providerSource]);
  const wantsExternal = Boolean(
    (project.providerSource && project.providerSource !== 'zhenzhen')
    || (!project.providerSource && project.providerId),
  );
  const savedExternalMissing = wantsExternal && !providerSelection.available;
  const isExternal = wantsExternal && providerSelection.available && !!providerSelection.provider;
  const externalModels = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'llm')
    : [];
  const seedanceModel = SEEDANCE_NZ_LLM_MODELS.includes(project.providerModel)
    ? project.providerModel
    : 'bytedance/doubao-seed-2.1-pro';
  const zhenzhenModel = ZHENZHEN_LLM_MODELS.some((model) => model.id === project.llmModel)
    ? project.llmModel
    : DEFAULT_ZHENZHEN_MODEL;
  const externalModel = externalModels.includes(project.providerModel)
    ? project.providerModel
    : externalModels[0] || project.providerModel;
  const allSourceMaterials = useMemo(
    () => [...upstream.videos, ...upstream.audios],
    [upstream.audios, upstream.videos],
  );
  const sourceMaterials = useMemo(
    () => materialsForTargetHandle(allSourceMaterials, 'source-media'),
    [allSourceMaterials],
  );
  const voiceRoutedMaterials = useMemo(
    () => materialsForTargetHandle(allSourceMaterials, 'voice-references'),
    [allSourceMaterials],
  );
  const upstreamText = useMemo(
    () => materialsForTargetHandle(upstream.texts, 'source-text').map((item) => item.url).filter(Boolean).join('\n\n').trim(),
    [upstream.texts],
  );
  const effectiveSourceMedia = sourceMediaDraft || sourceMaterials[0]?.url || '';
  const effectiveSourceText = sourceTextDraft.trim() || upstreamText;
  const voiceMaterials = useMemo(
    () => voiceRoutedMaterials.filter((item) => item.url !== effectiveSourceMedia),
    [effectiveSourceMedia, voiceRoutedMaterials],
  );
  const runtime = runtimeLocal;
  const roles = localizationRoles(project.units);
  const sourceDirty = sourceTextDraft !== project.sourceText || sourceMediaDraft !== project.sourceMediaUrl;
  const running = pendingAction != null || ['running', 'generating', 'installing', 'transcribing', 'translating', 'dubbing', 'delivering'].includes(String(d.status || ''));
  const isEnglish = i18n.language.toLowerCase().startsWith('en');
  const filteredReviewUnits = project.units.filter((unit) => reviewFilter === 'all'
    || (reviewFilter === 'approved' ? unit.approved : !unit.approved || (unit.warnings?.length || 0) > 0 || (unit.confidence ?? 1) < 0.75));
  const reviewPageCount = Math.max(1, Math.ceil(filteredReviewUnits.length / 50));
  const visibleReviewUnits = filteredReviewUnits.slice(reviewPage * 50, reviewPage * 50 + 50);

  useEffect(() => {
    const key = `${project.mode}:${project.stage}`;
    if (automaticStepKeyRef.current === key) return;
    automaticStepKeyRef.current = key;
    setActiveWorkbenchStep(workbenchStepForProject(project));
  }, [project.mode, project.stage]);

  const surface = isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-300 bg-white text-slate-900';
  const header = isDark ? 'border-slate-700 bg-slate-900/90' : 'border-slate-200 bg-slate-50';
  const panel = isDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-50';
  const field = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-600'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

  useEffect(() => {
    const previous = persistedSourceRef.current;
    setSourceTextDraft((current) => current === previous.text ? project.sourceText : current);
    setSourceMediaDraft((current) => current === previous.media ? project.sourceMediaUrl : current);
    persistedSourceRef.current = { text: project.sourceText, media: project.sourceMediaUrl };
  }, [project.sourceMediaUrl, project.sourceText]);

  useEffect(() => {
    let cancelled = false;
    void inspectLocalizationRuntime()
      .then((receipt) => {
        if (!cancelled) setRuntimeLocal(receipt);
      })
      .catch(() => {
        if (!cancelled) setRuntimeLocal(undefined);
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    setReviewPage((current) => Math.min(current, reviewPageCount - 1));
  }, [reviewPageCount]);

  useEffect(() => () => {
    if (previewStopTimerRef.current) window.clearTimeout(previewStopTimerRef.current);
  }, []);

  const readProject = () => normalizeProject((getNode(id)?.data || d) as any);
  const commitProject = (base: LocalizationProject, patch: Partial<LocalizationProject>, nodePatch: Record<string, unknown> = {}) => {
    const next = syncActiveLocalizationBranch({
      ...base,
      ...patch,
      revision: base.revision + 1,
      updatedAt: Date.now(),
    });
    update({
      localizationProject: next,
      mode: next.mode,
      sourceLanguage: next.sourceLanguage,
      targetLanguage: next.targetLanguage,
      sourceText: next.sourceText,
      llmApiSource: next.llmApiSource,
      llmModel: next.llmModel,
      providerSource: next.providerSource,
      providerId: next.providerId,
      providerModel: next.providerModel,
      providerParams: next.providerParams,
      ...nodePatch,
    });
    return next;
  };

  const changeProject = (patch: Partial<LocalizationProject>) => {
    setLocalError('');
    commitProject(project, patch);
  };

  const refreshRuntime = async () => {
    setRuntimeBusy(true);
    setLocalError('');
    try {
      const receipt = await inspectLocalizationRuntime();
      setRuntimeLocal(receipt);
    } catch (error) {
      setLocalError(localizationErrorText(error, isEnglish));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const acceptModelLicense = async () => {
    setLicenseBusy(true);
    setLocalError('');
    try {
      await acceptLocalizationModelLicense();
      setRuntimeLocal(await inspectLocalizationRuntime());
    } catch (error) {
      setLocalError(localizationErrorText(error, isEnglish));
    } finally {
      setLicenseBusy(false);
    }
  };

  const runParse = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    const sourceText = sourceTextDraft.trim() || upstreamText;
    if (!sourceText) throw new Error(t('nodes.localization.errors.sourceText'));
    const sourceInspection = inspectLocalizationSourceText(sourceText);
    if (sourceInspection.blocked) throw new Error(sourceInspection.warnings.join('\n'));
    const units = parseLocalizationText(sourceText);
    if (!units.length) throw new Error(t('nodes.localization.errors.parse'));
    const selectedMedia = sourceMaterials.find((item) => item.url === effectiveSourceMedia);
    const next = commitProject(base, resetLocalizationBranches({
      ...base,
      sourceText,
      sourceMediaUrl: selectedMedia?.url || effectiveSourceMedia,
      sourceMediaKind: mediaKind(selectedMedia),
      warnings: sourceInspection.warnings,
    }, units), { status: 'success', error: '', outputText: serializeLocalizationSrt(units) });
    setSourceTextDraft(next.sourceText);
    setSourceMediaDraft(next.sourceMediaUrl);
    await reporter.output({ status: 'succeeded', outputCount: 1, assets: [{ kind: 'text', text: next.sourceText, mimeType: 'text/plain' }] });
  };

  const runTranscribe = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    const sourceUrl = effectiveSourceMedia;
    const source = sourceMaterials.find((item) => item.url === sourceUrl);
    if (!sourceUrl || !source) throw new Error(t('nodes.localization.errors.sourceMedia'));
    update({ status: 'transcribing', error: '' });
    await reporter.providerRequest({ provider: 'seedance-nz', model: 'whisper-1', responseFormat: 'verbose_json' });
    const result = await transcribeWhisper({ audioUrl: sourceUrl, model: 'whisper-1', responseFormat: 'verbose_json' }, {
      submissionKey: reporter.providerSubmissionKey,
      signal: reporter.signal,
    });
    await reporter.providerResponse({
      provider: 'seedance-nz', model: 'whisper-1', requestId: result.requestId,
      transportHttpStatus: result.transportHttpStatus, upstreamHttpStatus: result.upstreamHttpStatus,
      status: 'succeeded', httpStatusSource: 'local-backend', usage: result.usage,
    });
    const evidence = buildWhisperTranscriptEvidence(result);
    const units = evidence.segments.length
      ? unitsFromWhisperSegments(evidence.segments)
      : parseLocalizationText(evidence.text);
    if (!units.length) throw new Error(t('nodes.localization.errors.transcriptEmpty'));
    const sourceText = units.map((unit) => `[${unit.role}] ${unit.sourceText}`).join('\n');
    const next = commitProject(base, resetLocalizationBranches({
      ...base,
      sourceMediaUrl: sourceUrl,
      sourceMediaKind: mediaKind(source),
      sourceText,
      warnings: evidence.attribution === 'untimed' ? [t('nodes.localization.warnings.untimed')] : [],
    }, units), { status: 'success', error: '', outputText: serializeLocalizationSrt(units) });
    setSourceTextDraft(next.sourceText);
    setSourceMediaDraft(next.sourceMediaUrl);
    await reporter.output({ status: 'succeeded', outputCount: 1, assets: [{ kind: 'text', text: sourceText, mimeType: 'text/plain' }] });
  };

  const translateBranch = async (
    inputProject: LocalizationProject,
    reporter: RunNodeLifecycleReporter,
    progress: { branch: number; totalBranches: number },
  ): Promise<LocalizationProject> => {
    let base = inputProject;
    if (sourceDirty) throw new Error(isEnglish
      ? 'The source draft changed. Parse or transcribe it before translating so earlier branches are not reused.'
      : '源素材或源文本已修改，请先重新解析或转写，避免复用旧译文。');
    if (!base.units.length) {
      const sourceText = base.sourceText.trim() || upstreamText;
      const parsed = parseLocalizationText(sourceText);
      if (!parsed.length) throw new Error(t('nodes.localization.errors.parseFirst'));
      base = resetLocalizationBranches({ ...base, sourceText }, parsed);
    }
    if (base.sourceLanguage === base.targetLanguage) {
      const units = base.units.map((unit) => ({
        ...unit,
        translatedText: unit.sourceText,
        backTranslation: unit.sourceText,
        confidence: 1,
        warnings: [],
        approved: false,
      }));
      return syncActiveLocalizationBranch({
        ...base,
        units,
        stage: 'review',
        translationReceipt: {
          schema: 't8-localization-translation-receipt-v1',
          requestDigest: await sha256Text(JSON.stringify({ sourceIdentity: true, language: base.targetLanguage, units: units.map((unit) => [unit.id, unit.sourceText]) })),
          provider: 'deterministic-source-identity',
          model: 'none',
          createdAt: Date.now(),
        },
        translationCheckpoint: undefined,
        ttsReceipt: undefined,
        delivery: undefined,
        updatedAt: Date.now(),
      });
    }
    const currentSelection = resolveAdvancedProviderSelection(advancedProviders, 'llm', {
      providerSource: base.providerSource as any,
      providerId: base.providerId,
      providerModel: base.providerModel,
    });
    const externalWanted = Boolean((base.providerSource && base.providerSource !== 'zhenzhen') || (!base.providerSource && base.providerId));
    if (externalWanted && (!currentSelection.available || !currentSelection.provider)) {
      throw new Error(t('nodes.localization.errors.providerMissing'));
    }
    const external = externalWanted && !!currentSelection.provider;
    const source = external ? 'external' : base.llmApiSource;
    const builtInSource: 'seedance-nz' | 'zhenzhen' = base.llmApiSource === 'seedance-nz' ? 'seedance-nz' : 'zhenzhen';
    const model = external
      ? (currentSelection.providerModel || advancedProviderModelOptions(currentSelection.provider!, 'llm')[0] || '')
      : source === 'seedance-nz'
        ? (SEEDANCE_NZ_LLM_MODELS.includes(base.providerModel) ? base.providerModel : 'bytedance/doubao-seed-2.1-pro')
        : (base.llmModel || DEFAULT_ZHENZHEN_MODEL);
    if (!model) throw new Error(t('nodes.localization.errors.modelMissing'));
    const provider = external ? currentSelection.provider!.id : source;
    const bindingDigest = await sha256Text(JSON.stringify({
      provider,
      model,
      sourceLanguage: base.sourceLanguage,
      targetLanguage: base.targetLanguage,
      glossaryText: base.glossaryText,
      protectedTermsText: base.protectedTermsText,
      units: base.units.map((unit) => [unit.id, unit.startMs, unit.endMs, unit.role, unit.sourceText]),
    }));
    const resumableCheckpoint = base.translationCheckpoint?.schema === 't8-localization-translation-checkpoint-v1'
      && base.translationCheckpoint.bindingDigest === bindingDigest
      && base.translationCheckpoint.provider === provider
      && base.translationCheckpoint.model === model
      ? base.translationCheckpoint
      : undefined;
    update({ status: 'translating', error: '' });
    const translated: LocalizationTranslationUnit[] = [];
    const requestDigests: string[] = [];
    const requestIds: string[] = [...(resumableCheckpoint?.requestIds || [])];
    const completedBatchDigests = new Set(resumableCheckpoint?.completedBatchDigests || []);
    const batches = Math.ceil(base.units.length / TRANSLATION_BATCH_SIZE);
    for (let index = 0; index < batches; index += 1) {
      if (reporter.signal?.aborted) throw reporter.signal.reason || new Error('aborted');
      const units = base.units.slice(index * TRANSLATION_BATCH_SIZE, (index + 1) * TRANSLATION_BATCH_SIZE);
      const batchProject = { ...base, units };
      const messages = buildLocalizationTranslationMessages(batchProject);
      const digest = await sha256Text(JSON.stringify({ provider, model, messages }));
      requestDigests.push(digest);
      if (completedBatchDigests.has(digest) && units.every((unit) => unit.translatedText.trim())) {
        translated.push(...units);
        await reporter.progress({
          current: (progress.branch - 1) * batches + index + 1,
          total: progress.totalBranches * batches,
          stage: `translation:${base.targetLanguage}:resumed`,
        });
        continue;
      }
      await reporter.providerRequest({
        provider, model, targetLanguage: base.targetLanguage,
        branch: progress.branch, totalBranches: progress.totalBranches,
        batch: index + 1, batches, unitCount: units.length, requestDigest: digest,
      });
      const request = { model, messages, temperature: 0.25, max_tokens: 16000, stream: false as const };
      const submissionKey = reporter.providerSubmissionKey
        ? `${reporter.providerSubmissionKey}-${base.targetLanguage.toLowerCase()}-b${index + 1}`
        : undefined;
      const result = external
        ? await generateExternalLlm({
            ...request,
            providerId: currentSelection.provider!.id,
            providerModel: model,
            providerParams: base.providerParams || {},
          }, { submissionKey, signal: reporter.signal })
        : await generateLlm({ ...request, source: builtInSource, requestProfile: 'localization-master' }, { submissionKey, signal: reporter.signal });
      const batchTranslated = applyLocalizationTranslationResponse(batchProject, result.content);
      translated.push(...batchTranslated);
      if (result.requestId) requestIds.push(result.requestId);
      if (result.usage) await reporter.providerUsage({ provider, model, requestId: result.requestId, usage: result.usage, targetLanguage: base.targetLanguage, batch: index + 1 });
      await reporter.providerResponse({
        provider, model, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus,
        status: 'succeeded', httpStatusSource: 'local-backend', finishReason: result.finishReason,
        targetLanguage: base.targetLanguage, batch: index + 1,
      });
      await reporter.progress({
        current: (progress.branch - 1) * batches + index + 1,
        total: progress.totalBranches * batches,
        stage: `translation:${base.targetLanguage}`,
      });
      completedBatchDigests.add(digest);
      const translatedById = new Map(batchTranslated.map((unit) => [unit.id, unit]));
      base = syncActiveLocalizationBranch({
        ...base,
        units: base.units.map((unit) => translatedById.get(unit.id) || unit),
        stage: 'translation',
        translationReceipt: undefined,
        translationCheckpoint: {
          schema: 't8-localization-translation-checkpoint-v1',
          bindingDigest,
          provider,
          model,
          completedBatchDigests: [...completedBatchDigests],
          requestIds: [...new Set(requestIds)],
          updatedAt: Date.now(),
        },
        ttsReceipt: undefined,
        delivery: undefined,
        updatedAt: Date.now(),
      });
      commitProject(readProject(), base, { status: 'translating', error: '' });
    }
    const requestDigest = await sha256Text(requestDigests.join('\n'));
    return syncActiveLocalizationBranch({
      ...base,
      units: translated,
      stage: 'review',
      translationReceipt: {
        schema: 't8-localization-translation-receipt-v1', requestDigest,
        requestId: requestIds.join(','), provider, model, createdAt: Date.now(),
      },
      translationCheckpoint: undefined,
      ttsReceipt: undefined,
      delivery: undefined,
      updatedAt: Date.now(),
    });
  };

  const runTranslate = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    const translatedProject = await translateBranch(base, reporter, { branch: 1, totalBranches: 1 });
    const subtitleText = serializeLocalizationSrt(translatedProject.units, { translated: true, includeRole: translatedProject.subtitleIncludeRole });
    commitProject(base, translatedProject, { status: 'success', error: '', outputText: subtitleText, reply: subtitleText });
    await reporter.output({ status: 'succeeded', outputCount: 1, assets: [{ kind: 'text', text: subtitleText, filename: `localization-${base.targetLanguage}.srt`, mimeType: 'application/x-subrip' }] });
  };

  const runTranslateAll = async (reporter: RunNodeLifecycleReporter) => {
    let current = readProject();
    const targets = [...current.targetLanguages];
    const outputs: Array<{ language: LocalizationTargetLanguage; text: string }> = [];
    let paidBranch = 0;
    const pending = targets.filter((language) => {
      const branch = current.branches.find((item) => item.language === language);
      return !branch?.translationReceipt || branch.units.some((unit) => !unit.translatedText.trim());
    });
    for (const language of targets) {
      let branchProject = switchLocalizationBranch(current, language);
      const alreadyComplete = Boolean(branchProject.translationReceipt)
        && branchProject.units.length > 0
        && branchProject.units.every((unit) => unit.translatedText.trim());
      if (!alreadyComplete) {
        paidBranch += 1;
        branchProject = await translateBranch(branchProject, reporter, {
          branch: paidBranch,
          totalBranches: Math.max(1, pending.length),
        });
        current = commitProject(current, branchProject, { status: 'translating', error: '' });
      } else {
        current = branchProject;
      }
      outputs.push({
        language,
        text: serializeLocalizationSrt(branchProject.units, { translated: true, includeRole: branchProject.subtitleIncludeRole }),
      });
    }
    current = switchLocalizationBranch(current, targets[0]);
    commitProject(readProject(), current, {
      status: 'success', error: '', outputText: outputs.map((item) => `# ${item.language}\n${item.text}`).join('\n\n'),
    });
    await reporter.output({
      status: 'succeeded',
      outputCount: outputs.length,
      assets: outputs.map((item) => ({
        kind: 'text', text: item.text, filename: `localization-${item.language}.srt`, mimeType: 'application/x-subrip',
      })),
    });
  };

  const runInstall = async (reporter: RunNodeLifecycleReporter) => {
    let base = readProject();
    const preflight = await inspectLocalizationRuntime(reporter.signal);
    setRuntimeLocal(preflight);
    if (!preflight.licenseAccepted) throw Object.assign(new Error(t('nodes.localization.errors.license')), { code: 'INDEXTTS25_LICENSE_NOT_CONFIRMED' });
    update({ status: 'installing', error: '' });
    try {
      await installLocalizationRuntime({ source: 'huggingface' }, reporter.signal);
      while (true) {
        await sleepWithSignal(1800, reporter.signal);
        const receipt = await inspectLocalizationRuntime(reporter.signal);
        setRuntimeLocal(receipt);
        await reporter.progress({
          stage: receipt.install.stage,
          progress: receipt.install.progress,
          message: t('nodes.localization.runtime.installing', {
            stage: receipt.install.stage || 'runtime',
            progress: Math.round(receipt.install.progress || 0),
          }),
        });
        if (receipt.ready) {
          base = commitProject(base, { runtimeReceipt: undefined, stage: base.stage === 'review' ? 'voices' : base.stage }, { status: 'success', error: '' });
          return;
        }
        if (!receipt.install.running) throw new Error(receipt.install.error || receipt.message);
      }
    } catch (error) {
      if (reporter.signal?.aborted) await cancelLocalizationRuntime().catch(() => undefined);
      throw error;
    }
  };

  const runDub = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    if (sourceDirty) throw new Error(isEnglish ? 'Parse the changed source before dubbing.' : '源内容已修改，请先重新解析后再配音。');
    const liveRuntime = await inspectLocalizationRuntime(reporter.signal);
    setRuntimeLocal(liveRuntime);
    const runtimeProject = { ...base, runtimeReceipt: liveRuntime };
    const errors = validateLocalizationForDubbing(runtimeProject);
    if (errors.length) throw new Error(errors.join('\n'));
    update({ status: 'dubbing', error: '' });
    await reporter.providerRequest({
      provider: 'embedded-index-tts-2.5', model: liveRuntime.modelRevision || 'IndexTTS-2.5',
      unitCount: base.units.length, roleCount: base.voiceProfiles.length, requiresComfyUI: false,
    });
    const result = await runLocalizationTts({
      language: base.targetLanguage,
      units: base.units.map((unit) => ({
        index: unit.index, role: unit.role, translatedText: unit.translatedText,
        pronunciation: unit.pronunciation, emotion: unit.emotion,
        startMs: unit.startMs, endMs: unit.endMs,
      })),
      roles: base.voiceProfiles.map((profile) => ({
        role: profile.role, referenceUrl: profile.referenceUrl, consentConfirmed: true as const,
      })),
      timelinePolicy: base.timelinePolicy,
      timingMode: base.timingMode,
      asrEnabled: base.asrEnabled,
      asrRetryCount: base.asrRetryCount,
      asrThreshold: base.asrThreshold,
      subtitleTimingMode: base.subtitleTimingMode,
      subtitleTextMode: base.subtitleTextMode,
      subtitleIncludeRole: base.subtitleIncludeRole,
      postprocessPreset: base.postprocessPreset,
      postprocessStrength: base.postprocessStrength,
      jobKey: reporter.providerSubmissionKey
        || (reporter.nodeRunId && reporter.attemptId ? `${reporter.nodeRunId}:${reporter.attemptId}:${base.targetLanguage}` : undefined),
    }, reporter.signal);
    const reportLines = Array.isArray((result.generationReport as any)?.lines)
      ? (result.generationReport as any).lines
      : [];
    const reportByIndex = new Map<number, any>(reportLines.map((line: any) => [Number(line?.index), line]));
    const units = base.units.map((unit) => {
      const line = reportByIndex.get(unit.index);
      const asr = line?.asr;
      return asr ? {
        ...unit,
        asrText: String(asr.recognizedText || ''),
        asrPassed: asr.passed === true,
        asrSimilarity: Number(asr.similarity) || 0,
      } : unit;
    });
    await reporter.providerResponse({
      provider: 'embedded-index-tts-2.5', model: liveRuntime.modelRevision || 'IndexTTS-2.5',
      requestId: result.requestId, status: 'succeeded', requiresComfyUI: false,
    });
    commitProject(base, {
      units,
      ttsStaleUnitIds: [],
      stage: 'delivery',
      ttsReceipt: {
        schema: 't8-localization-tts-receipt-v2', requestId: result.requestId,
        jobId: result.jobId, reused: result.reused, recovery: result.recovery,
        engine: 'embedded-index-tts-2.5', audioUrl: result.audioUrl,
        subtitleUrl: result.subtitleUrl, rewrittenSrt: result.subtitleText,
        generationReport: result.generationReport, createdAt: Date.now(),
      },
      delivery: undefined,
    }, {
      status: 'success', error: '', audioUrl: result.audioUrl, outputText: result.subtitleText,
      outputs: {
        'dubbed-audio': { audioUrl: result.audioUrl, audioUrls: [result.audioUrl] },
        subtitles: base.mode === 'dubbing-only' ? {} : { outputText: result.subtitleText, text: result.subtitleText },
      },
    });
    await reporter.output({
      status: 'succeeded', outputCount: base.mode === 'dubbing-only' ? 1 : 2,
      assets: base.mode === 'dubbing-only'
        ? [{ kind: 'audio', sourceUrl: result.audioUrl, mimeType: 'audio/wav' }]
        : [
            { kind: 'audio', sourceUrl: result.audioUrl, mimeType: 'audio/wav' },
            { kind: 'text', text: result.subtitleText, mimeType: 'application/x-subrip' },
          ],
    });
  };

  const runDubLine = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    const unit = base.units.find((item) => item.id === retryUnitIdRef.current);
    if (!unit || !base.ttsReceipt?.audioUrl) throw new Error(isEnglish ? 'Generate a full dub before retrying one line.' : '请先生成一次完整配音，再逐句重配。');
    const liveRuntime = await inspectLocalizationRuntime(reporter.signal);
    setRuntimeLocal(liveRuntime);
    const errors = validateLocalizationForDubbing({ ...base, runtimeReceipt: liveRuntime });
    if (errors.length) throw new Error(errors.join('\n'));
    const profile = base.voiceProfiles.find((item) => item.role === unit.role);
    if (!profile?.referenceUrl || !profile.consentConfirmed) throw new Error(isEnglish ? `Reference voice or consent is missing for ${unit.role}.` : `${unit.role} 缺少参考音色或授权确认。`);
    const previousReport = base.ttsReceipt.generationReport as any;
    const retryCount = Math.max(0, Number(previousReport?.lineRetryCount) || 0) + 1;
    update({ status: 'dubbing', error: '' });
    await reporter.providerRequest({ provider: 'embedded-index-tts-2.5', model: liveRuntime.modelRevision, unitIndex: unit.index, retryCount });
    const result = await retryLocalizationTtsLine({
      baseAudioUrl: base.ttsReceipt.audioUrl,
      language: base.targetLanguage,
      unit: {
        index: unit.index, role: unit.role, translatedText: unit.translatedText,
        pronunciation: unit.pronunciation, emotion: unit.emotion,
        startMs: unit.startMs, endMs: unit.endMs,
      },
      roles: [{ role: profile.role, referenceUrl: profile.referenceUrl, consentConfirmed: true }],
      timelinePolicy: base.timelinePolicy,
      timingMode: base.timingMode,
      asrEnabled: base.asrEnabled,
      asrRetryCount: base.asrRetryCount,
      asrThreshold: base.asrThreshold,
      subtitleTimingMode: base.subtitleTimingMode,
      subtitleTextMode: base.subtitleTextMode,
      subtitleIncludeRole: false,
      postprocessPreset: base.postprocessPreset,
      postprocessStrength: base.postprocessStrength,
      seed: 20260828 + retryCount,
      jobKey: `${reporter.providerSubmissionKey || `${reporter.nodeRunId}:${reporter.attemptId}`}:${base.targetLanguage}:line:${unit.index}:retry:${retryCount}`,
    }, reporter.signal);
    const lineReport = Array.isArray((result.lineResult.generationReport as any)?.lines)
      ? (result.lineResult.generationReport as any).lines[0]
      : undefined;
    const priorLines = Array.isArray(previousReport?.lines) ? previousReport.lines : [];
    const nextLines = [...priorLines.filter((line: any) => Number(line?.index) !== unit.index), ...(lineReport ? [{ ...lineReport, sourceStartMs: unit.startMs, sourceEndMs: unit.endMs }] : [])]
      .sort((left: any, right: any) => Number(left?.index) - Number(right?.index));
    const asr = lineReport?.asr;
    const units = base.units.map((item) => item.id === unit.id && asr ? {
      ...item,
      asrText: String(asr.recognizedText || ''),
      asrPassed: asr.passed === true,
      asrSimilarity: Number(asr.similarity) || 0,
    } : item);
    const remainingStale = base.ttsStaleUnitIds.filter((unitId) => unitId !== unit.id);
    const rewrittenSrt = serializeLocalizationSrt(units, { translated: true, includeRole: base.subtitleIncludeRole });
    commitProject(base, {
      units,
      ttsStaleUnitIds: remainingStale,
      stage: remainingStale.length ? 'review' : 'delivery',
      ttsReceipt: {
        ...base.ttsReceipt,
        audioUrl: result.audioUrl,
        rewrittenSrt,
        generationReport: { ...previousReport, lines: nextLines, lineRetryCount: retryCount, lastRetriedUnitIndex: unit.index },
        createdAt: Date.now(),
      },
      delivery: undefined,
    }, { status: 'success', error: '', audioUrl: result.audioUrl, outputText: base.mode === 'dubbing-only' ? '' : rewrittenSrt });
    await reporter.providerResponse({ provider: 'embedded-index-tts-2.5', model: liveRuntime.modelRevision, requestId: result.lineResult.requestId, status: 'succeeded', unitIndex: unit.index });
    await reporter.output({ status: 'succeeded', outputCount: 1, assets: [{ kind: 'audio', sourceUrl: result.audioUrl, mimeType: 'audio/wav' }] });
  };

  const runDeliver = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    if (sourceDirty) throw new Error(isEnglish ? 'Parse the changed source before delivery.' : '源内容已修改，请先重新解析后再交付。');
    if (!base.units.length || base.units.some((unit) => !unit.translatedText.trim())) throw new Error(t('nodes.localization.errors.translationMissing'));
    if (base.units.some((unit) => !unit.approved)) throw new Error(t('nodes.localization.errors.approval'));
    if (base.mode !== 'subtitle-only' && !base.ttsReceipt?.audioUrl) throw new Error(t('nodes.localization.errors.dubFirst'));
    if (base.mode !== 'subtitle-only' && base.ttsStaleUnitIds.length) throw new Error(isEnglish ? 'Re-dub the changed lines before delivery.' : '部分台词在上次配音后有修改，请先逐句重配或重新生成配音。');
    update({ status: 'delivering', error: '' });
    const shouldDeliverSubtitle = base.mode !== 'dubbing-only';
    const subtitleText = shouldDeliverSubtitle
      ? (base.ttsReceipt?.rewrittenSrt
        || serializeLocalizationSrt(base.units, { translated: true, includeRole: base.subtitleIncludeRole }))
      : '';
    const subtitle = !shouldDeliverSubtitle
      ? undefined
      : base.ttsReceipt?.subtitleUrl
        ? { subtitleUrl: base.ttsReceipt.subtitleUrl }
        : await saveLocalizationSubtitle({ text: subtitleText, format: 'srt' }, reporter.signal);
    let localizedVideoUrl = '';
    if (base.mode === 'full' && base.sourceMediaKind === 'video' && base.sourceMediaUrl && base.ttsReceipt?.audioUrl) {
      const mux = await muxLocalizationVideo({ videoUrl: base.sourceMediaUrl, audioUrl: base.ttsReceipt.audioUrl }, reporter.signal);
      localizedVideoUrl = mux.videoUrl;
    }
    const manifest: LocalizationDeliveryManifest = {
      schema: 't8-localization-delivery-manifest-v1',
      createdAt: Date.now(),
      targetLanguage: base.targetLanguage,
      mode: base.mode,
      sourceMediaUrl: base.sourceMediaUrl,
      ...(subtitle ? { subtitleUrl: subtitle.subtitleUrl, subtitleText } : {}),
      dubbedAudioUrl: base.ttsReceipt?.audioUrl,
      localizedVideoUrl: localizedVideoUrl || undefined,
      generationReport: base.ttsReceipt?.generationReport,
      qc: buildLocalizationQc(base),
    };
    const manifestText = JSON.stringify(manifest, null, 2);
    commitProject(base, { stage: 'delivery', delivery: manifest }, {
      status: 'success', error: '', outputText: subtitleText,
      audioUrl: manifest.dubbedAudioUrl || '', videoUrl: manifest.localizedVideoUrl || '',
      metadata: manifest,
      outputs: {
        'localized-video': manifest.localizedVideoUrl ? { videoUrl: manifest.localizedVideoUrl, videoUrls: [manifest.localizedVideoUrl] } : {},
        'dubbed-audio': manifest.dubbedAudioUrl ? { audioUrl: manifest.dubbedAudioUrl, audioUrls: [manifest.dubbedAudioUrl] } : {},
        subtitles: shouldDeliverSubtitle ? { outputText: subtitleText, text: subtitleText } : {},
        manifest: { metadata: manifest, outputText: manifestText },
      },
    });
    const assets: Array<Record<string, unknown>> = [
      { kind: 'text', text: manifestText, filename: `localization-${base.targetLanguage}-manifest.json`, mimeType: 'application/json' },
    ];
    if (subtitle) assets.unshift({ kind: 'text', text: subtitleText, sourceUrl: subtitle.subtitleUrl, filename: `localization-${base.targetLanguage}.srt`, mimeType: 'application/x-subrip' });
    if (manifest.dubbedAudioUrl) assets.push({ kind: 'audio', sourceUrl: manifest.dubbedAudioUrl, mimeType: 'audio/wav' });
    if (manifest.localizedVideoUrl) assets.push({ kind: 'video', sourceUrl: manifest.localizedVideoUrl, mimeType: 'video/mp4' });
    await reporter.output({ status: 'succeeded', outputCount: assets.length, assets });
  };

  const runDeliverAll = async (reporter: RunNodeLifecycleReporter) => {
    if (sourceDirty) throw new Error(isEnglish ? 'Parse the changed source before delivery.' : '源内容已修改，请先重新解析后再交付。');
    let current = readProject();
    const targets = [...current.targetLanguages];
    const assets: Array<Record<string, unknown>> = [];
    const manifests: LocalizationDeliveryManifest[] = [];
    for (const language of targets) {
      let branch = switchLocalizationBranch(current, language);
      if (!branch.units.length || branch.units.some((unit) => !unit.translatedText.trim() || !unit.approved)) {
        throw new Error(isEnglish ? `${language} still has untranslated or unapproved lines.` : `${language} 仍有未翻译或未确认台词。`);
      }
      if (branch.mode !== 'subtitle-only' && !branch.ttsReceipt?.audioUrl) {
        throw new Error(isEnglish ? `${language} has no approved dubbed audio.` : `${language} 尚无已确认配音。`);
      }
      if (branch.mode !== 'subtitle-only' && branch.ttsStaleUnitIds.length) {
        throw new Error(isEnglish ? `${language} has changed lines that need re-dubbing.` : `${language} 有已修改台词需要重新配音。`);
      }
      const shouldDeliverSubtitle = branch.mode !== 'dubbing-only';
      const subtitleText = shouldDeliverSubtitle
        ? (branch.ttsReceipt?.rewrittenSrt || serializeLocalizationSrt(branch.units, { translated: true, includeRole: branch.subtitleIncludeRole }))
        : '';
      const subtitle = !shouldDeliverSubtitle
        ? undefined
        : branch.ttsReceipt?.subtitleUrl
          ? { subtitleUrl: branch.ttsReceipt.subtitleUrl }
          : await saveLocalizationSubtitle({ text: subtitleText, format: 'srt' }, reporter.signal);
      let localizedVideoUrl = '';
      if (branch.mode === 'full' && branch.sourceMediaKind === 'video' && branch.sourceMediaUrl && branch.ttsReceipt?.audioUrl) {
        const mux = await muxLocalizationVideo({ videoUrl: branch.sourceMediaUrl, audioUrl: branch.ttsReceipt.audioUrl }, reporter.signal);
        localizedVideoUrl = mux.videoUrl;
      }
      const manifest: LocalizationDeliveryManifest = {
        schema: 't8-localization-delivery-manifest-v1',
        createdAt: Date.now(),
        targetLanguage: language,
        mode: branch.mode,
        sourceMediaUrl: branch.sourceMediaUrl,
        ...(subtitle ? { subtitleUrl: subtitle.subtitleUrl, subtitleText } : {}),
        dubbedAudioUrl: branch.ttsReceipt?.audioUrl,
        localizedVideoUrl: localizedVideoUrl || undefined,
        generationReport: branch.ttsReceipt?.generationReport,
        qc: buildLocalizationQc(branch),
      };
      manifests.push(manifest);
      const manifestText = JSON.stringify(manifest, null, 2);
      if (subtitle) assets.push({ kind: 'text', text: subtitleText, sourceUrl: subtitle.subtitleUrl, filename: `localization-${language}.srt`, mimeType: 'application/x-subrip' });
      assets.push({ kind: 'text', text: manifestText, filename: `localization-${language}-manifest.json`, mimeType: 'application/json' });
      if (manifest.dubbedAudioUrl) assets.push({ kind: 'audio', sourceUrl: manifest.dubbedAudioUrl, filename: `localization-${language}.wav`, mimeType: 'audio/wav' });
      if (manifest.localizedVideoUrl) assets.push({ kind: 'video', sourceUrl: manifest.localizedVideoUrl, filename: `localization-${language}.mp4`, mimeType: 'video/mp4' });
      branch = syncActiveLocalizationBranch({ ...branch, stage: 'delivery', delivery: manifest, updatedAt: Date.now() });
      current = commitProject(current, branch, { status: 'delivering', error: '' });
      await reporter.progress({ current: manifests.length, total: targets.length, stage: `delivery:${language}` });
    }
    current = switchLocalizationBranch(current, targets[0]);
    commitProject(readProject(), current, { status: 'success', error: '', metadata: { schema: 't8-localization-multilingual-delivery-v1', manifests } });
    await reporter.output({ status: 'succeeded', outputCount: assets.length, assets });
  };

  const runVerify = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    if (sourceDirty) throw new Error(isEnglish ? 'Parse the changed source before verification.' : '源内容已修改，请先重新解析后再校验。');
    if (!base.units.length || base.units.some((unit) => !unit.translatedText.trim())) throw new Error(t('nodes.localization.errors.translationMissing'));
    if (base.units.some((unit) => !unit.approved)) throw new Error(t('nodes.localization.errors.approval'));
    if (base.mode !== 'subtitle-only' && !base.ttsReceipt?.audioUrl) throw new Error(t('nodes.localization.errors.dubFirst'));
    if (base.mode !== 'subtitle-only' && base.ttsStaleUnitIds.length) throw new Error(isEnglish ? 'Changed lines must be re-dubbed before verification.' : '已修改台词必须先重新配音再校验。');
    const qc = buildLocalizationQc(base);
    const report = {
      schema: 't8-localization-qc-report-v1',
      createdAt: Date.now(),
      targetLanguage: base.targetLanguage,
      mode: base.mode,
      status: qc.warnings.length ? 'warning' : 'passed',
      ...qc,
    };
    update({ status: 'success', error: '', metadata: report });
    await reporter.output({
      status: 'succeeded',
      outputCount: 1,
      assets: [{ kind: 'metadata', metadata: report, mimeType: 'application/json' }],
    });
  };

  const markAgentRequest = (status: LocalizationAgentRequest['status'], error = '') => {
    const current = (getNode(id)?.data as any)?.localizationAgentRequest;
    if (current?.schema !== 't8-localization-agent-request-v1') return;
    update({ localizationAgentRequest: { ...current, status, ...(error ? { error } : { error: '' }) } });
  };

  useRunTrigger(id, async (reporter) => {
    const requestedAction = pendingActionRef.current || actionRef.current;
    setLocalError('');
    update({ status: 'running', error: '' });
    try {
      switch (requestedAction) {
        case 'parse': await runParse(reporter); break;
        case 'transcribe': await runTranscribe(reporter); break;
        case 'translate': await runTranslate(reporter); break;
        case 'translate-all': await runTranslateAll(reporter); break;
        case 'install': await runInstall(reporter); break;
        case 'dub': await runDub(reporter); break;
        case 'dub-line': await runDubLine(reporter); break;
        case 'verify': await runVerify(reporter); break;
        case 'deliver': await runDeliver(reporter); break;
        case 'deliver-all': await runDeliverAll(reporter); break;
      }
      markAgentRequest('completed');
    } catch (error) {
      const message = localizationErrorText(error, isEnglish);
      setLocalError(message);
      update({ status: 'error', error: message });
      markAgentRequest('failed', message);
      throw error;
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }, 'localization-master', { lifecycleAware: true });

  const requestAction = (action: LocalizationAction) => {
    if (pendingActionRef.current || running) {
      setLocalError(isEnglish ? 'Another localization stage is already starting or running.' : '已有本地化阶段正在启动或运行，请等待完成。');
      return false;
    }
    actionRef.current = action;
    pendingActionRef.current = action;
    setPendingAction(action);
    setLocalError('');
    if (!requestCanvasNodeRun(id)) {
      pendingActionRef.current = null;
      setPendingAction(null);
      setLocalError(t('nodes.localization.errors.runRequest'));
      return false;
    }
    return true;
  };

  const runAgentRequest = () => {
    if (!agentRequest) return;
    const actionByRequest: Partial<Record<LocalizationAgentAction, LocalizationAction>> = {
      'localization.transcribe': 'transcribe',
      'localization.translate': project.targetLanguages.length > 1 ? 'translate-all' : 'translate',
      'localization.generate-dub': 'dub',
      'localization.compose': 'deliver',
      'localization.verify': 'verify',
      'localization.package': 'deliver',
    };
    const action = actionByRequest[agentRequest.action];
    if (!action) return;
    markAgentRequest('running');
    if (!requestAction(action)) markAgentRequest('failed', t('nodes.localization.errors.runRequest'));
  };

  const agentRequestRunnable = Boolean(agentRequest && !['localization.create', 'localization.cast-voices'].includes(agentRequest.action));

  const setProvider = (value: string) => {
    if (value === 'seedance-nz') {
      changeProject({ llmApiSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: 'bytedance/doubao-seed-2.1-pro' });
      return;
    }
    if (value === 'zhenzhen') {
      changeProject({ llmApiSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', llmModel: zhenzhenModel || DEFAULT_ZHENZHEN_MODEL });
      return;
    }
    const provider = llmAdvancedProviders.find((item) => item.id === value);
    if (!provider) return;
    changeProject({
      providerSource: provider.protocol,
      providerId: provider.id,
      providerModel: advancedProviderModelOptions(provider, 'llm')[0] || '',
    });
  };

  const switchTargetBranch = (language: LocalizationTargetLanguage) => {
    setLocalError('');
    const next = switchLocalizationBranch(project, language);
    update({
      localizationProject: { ...next, revision: project.revision + 1, updatedAt: Date.now() },
      targetLanguage: language,
      status: 'idle',
      error: '',
      outputText: next.delivery?.subtitleText || serializeLocalizationSrt(next.units, { translated: true, includeRole: next.subtitleIncludeRole }),
      audioUrl: next.ttsReceipt?.audioUrl || '',
      videoUrl: next.delivery?.localizedVideoUrl || '',
    });
  };

  const toggleTargetBranch = (language: LocalizationTargetLanguage) => {
    const selected = project.targetLanguages.includes(language);
    if (selected && project.targetLanguages.length === 1) return;
    const languages = selected
      ? project.targetLanguages.filter((item) => item !== language)
      : [...project.targetLanguages, language];
    const next = setLocalizationTargetLanguages(project, languages);
    update({
      localizationProject: { ...next, revision: project.revision + 1, updatedAt: Date.now() },
      targetLanguage: next.targetLanguage,
      status: 'idle',
      error: '',
      outputText: next.delivery?.subtitleText || '',
      audioUrl: next.ttsReceipt?.audioUrl || '',
      videoUrl: next.delivery?.localizedVideoUrl || '',
    });
  };

  const updateUnit = (unitId: string, patch: Partial<LocalizationTranslationUnit>) => {
    const invalidatesAudio = ['translatedText', 'pronunciation', 'emotion', 'startMs', 'endMs', 'role']
      .some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    changeProject({
      units: project.units.map((unit) => unit.id === unitId ? { ...unit, ...patch, approved: patch.approved ?? false } : unit),
      ttsStaleUnitIds: invalidatesAudio
        ? [...new Set([...project.ttsStaleUnitIds, unitId])]
        : project.ttsStaleUnitIds,
      stage: 'review',
      delivery: undefined,
    });
  };

  const previewUnitAudio = async (unit: LocalizationTranslationUnit) => {
    const audio = dubbingPreviewRef.current;
    if (!audio || !project.ttsReceipt?.audioUrl) return;
    if (previewStopTimerRef.current) window.clearTimeout(previewStopTimerRef.current);
    audio.currentTime = Math.max(0, unit.startMs / 1000);
    await audio.play();
    previewStopTimerRef.current = window.setTimeout(() => audio.pause(), Math.max(250, unit.endMs - unit.startMs));
  };

  const approveAll = () => {
    if (project.units.some((unit) => !unit.translatedText.trim())) {
      setLocalError(t('nodes.localization.errors.translationMissing'));
      return;
    }
    const language = supportsLocalizationDubbing(project.targetLanguage) ? project.targetLanguage : 'EN';
    const previous = new Map(project.voiceProfiles.map((profile) => [profile.role, profile]));
    const voiceProfiles: LocalizationVoiceProfile[] = localizationRoles(project.units).map((role, index) => previous.get(role) || {
      id: `voice-${index + 1}-${role}`,
      role,
      language,
      referenceUrl: '',
      consentConfirmed: false,
    });
    const cleanUnitIds = new Set(project.units.filter((unit) => !(unit.warnings?.length)
      && (unit.confidence ?? 1) >= 0.75).map((unit) => unit.id));
    const nextUnits = project.units.map((unit) => ({ ...unit, approved: cleanUnitIds.has(unit.id) ? true : unit.approved }));
    changeProject({
      units: nextUnits,
      voiceProfiles,
      stage: nextUnits.every((unit) => unit.approved)
        ? (project.mode === 'subtitle-only' ? 'delivery' : 'voices')
        : 'review',
      delivery: undefined,
    });
    if (cleanUnitIds.size < project.units.length) {
      setLocalError(isEnglish
        ? `${project.units.length - cleanUnitIds.size} warning or low-confidence line(s) still need explicit review.`
        : `仍有 ${project.units.length - cleanUnitIds.size} 条警告或低置信度译文需要逐条确认。`);
    }
  };

  const updateVoice = (role: string, patch: Partial<LocalizationVoiceProfile>) => {
    const language = supportsLocalizationDubbing(project.targetLanguage) ? project.targetLanguage : 'EN';
    const current = project.voiceProfiles.find((profile) => profile.role === role) || {
      id: `voice-${project.voiceProfiles.length + 1}-${role}`,
      role,
      language,
      referenceUrl: '',
      consentConfirmed: false,
    };
    const next = { ...current, ...patch, role, language };
    changeProject({
      voiceProfiles: [...project.voiceProfiles.filter((profile) => profile.role !== role), next],
      ttsReceipt: undefined,
      delivery: undefined,
    });
  };

  const selectedProvider = isExternal ? providerSelection.providerId : project.llmApiSource;
  const activeModel = isExternal ? externalModel : project.llmApiSource === 'seedance-nz' ? seedanceModel : zhenzhenModel;
  const approvedCount = project.units.filter((unit) => unit.approved).length;
  const allBranchesDeliverable = project.targetLanguages.every((language) => {
    const branch = project.branches.find((item) => item.language === language);
    return Boolean(branch?.units.length)
      && branch!.units.every((unit) => unit.translatedText.trim() && unit.approved)
      && !(branch?.ttsStaleUnitIds?.length)
      && (project.mode === 'subtitle-only' || Boolean(branch?.ttsReceipt?.audioUrl));
  });
  const runtimeState = runtimeTone(runtime);
  const runtimeMessage = !runtime
    ? t('nodes.localization.runtime.notChecked')
    : !runtime.licenseAccepted
      ? (isEnglish ? 'Accept the model license on this device before install or inference.' : '请先在本机接受模型许可，再安装或推理；许可不会写入画布。')
    : runtime.ready
      ? t('nodes.localization.runtime.ready')
      : runtime.install.running
        ? t('nodes.localization.runtime.installing', {
            stage: runtime.install.stage || 'runtime',
            progress: Math.round(runtime.install.progress || 0),
          })
        : runtime.install.error
          ? t('nodes.localization.runtime.installFailed')
          : !runtime.engineReady
            ? t('nodes.localization.runtime.missingEngine')
            : !runtime.dependenciesReady
              ? t('nodes.localization.runtime.missingDependencies')
              : !runtime.modelReady
                ? t('nodes.localization.runtime.missingModel')
                : t('nodes.localization.runtime.unavailable');

  return (
    <div className="relative w-[560px]" data-node-kind="localization-master">
      <Handle id="source-media" type="target" position={Position.Left} style={{ top: '22%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-cyan-300" />
      <Handle id="source-text" type="target" position={Position.Left} style={{ top: '38%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-emerald-300" />
      <Handle id="voice-references" type="target" position={Position.Left} style={{ top: '67%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-amber-300" />
      <Handle id="localized-video" type="source" position={Position.Right} style={{ top: '28%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-pink-300" />
      <Handle id="dubbed-audio" type="source" position={Position.Right} style={{ top: '48%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-violet-300" />
      <Handle id="subtitles" type="source" position={Position.Right} style={{ top: '68%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-emerald-300" />
      <Handle id="manifest" type="source" position={Position.Right} style={{ top: '84%' }} className="!h-3 !w-3 !border-2 !border-teal-950 !bg-slate-300" />

      <div className={`overflow-hidden rounded-2xl border-2 shadow-xl transition ${surface} ${selected ? 'border-teal-400 ring-2 ring-teal-400/20' : ''}`}>
        <div className={`flex items-center gap-3 border-b px-4 py-3 ${header}`}>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-500 ring-1 ring-teal-500/30"><Languages size={21} /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold">{t('nodes.localization.title')}</div>
            <div className={`truncate text-[11px] ${muted}`}>{t('nodes.localization.subtitle')}</div>
          </div>
          <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${runtimeState === 'success' ? 'bg-emerald-500/15 text-emerald-500' : runtimeState === 'error' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500'}`}>
            {runtimeState === 'success' ? t('nodes.localization.runtime.ready') : t('nodes.localization.runtime.direct')}
          </div>
        </div>

        <div className="nodrag nowheel max-h-[780px] space-y-3 overflow-y-auto p-3" onMouseDown={(event) => event.stopPropagation()}>
          {agentRequest && (
            <div className={`rounded-xl border px-3 py-2.5 ${agentRequest.status === 'failed'
              ? 'border-rose-500/40 bg-rose-500/10'
              : agentRequest.status === 'completed'
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-cyan-500/40 bg-cyan-500/10'}`} data-localization-agent-request={agentRequest.action}>
              <div className="flex items-start gap-2">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-cyan-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold">{t(`nodes.localization.agent.actions.${agentRequest.action.replace('localization.', '')}`)}</div>
                  <div className={`mt-1 text-[9px] leading-4 ${muted}`}>{agentRequest.instruction || t('nodes.localization.agent.safeHint')}</div>
                  <div className={`mt-1 text-[9px] ${muted}`}>{agentRequest.targetLanguages.join(' · ')} · {t(`nodes.localization.agent.status.${agentRequest.status}`)}</div>
                </div>
                {agentRequestRunnable && agentRequest.status !== 'completed' && (
                  <button type="button" disabled={running || agentRequest.status === 'running'} onClick={runAgentRequest} className="shrink-0 rounded-lg bg-cyan-500 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-40">
                    {agentRequest.status === 'failed' ? t('nodes.localization.agent.retry') : t('nodes.localization.agent.run')}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <label className={`text-[10px] font-semibold ${muted}`}>
              {t('nodes.localization.mode')}
              <select value={project.mode} onChange={(event) => changeProject({ mode: event.target.value as LocalizationProject['mode'], delivery: undefined })} className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                <option value="full">{t('nodes.localization.modes.full')}</option>
                <option value="subtitle-only">{t('nodes.localization.modes.subtitle')}</option>
                <option value="dubbing-only">{t('nodes.localization.modes.dubbing')}</option>
              </select>
            </label>
            <label className={`text-[10px] font-semibold ${muted}`}>
              {t('nodes.localization.sourceLanguage')}
              <select value={project.sourceLanguage} onChange={(event) => changeProject({ sourceLanguage: event.target.value as LocalizationProject['sourceLanguage'], translationReceipt: undefined, ttsReceipt: undefined, delivery: undefined })} className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                {(['AUTO', ...LOCALIZATION_TARGET_LANGUAGES] as const).map((language) => <option key={language} value={language}>{isEnglish ? LOCALIZATION_LANGUAGE_LABELS[language].en : LOCALIZATION_LANGUAGE_LABELS[language].zh}</option>)}
              </select>
            </label>
            <label className={`text-[10px] font-semibold ${muted}`}>
              {t('nodes.localization.targetLanguage')}
              <select value={project.targetLanguage} onChange={(event) => switchTargetBranch(event.target.value as LocalizationTargetLanguage)} className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                {project.targetLanguages.map((language) => <option key={language} value={language}>{isEnglish ? LOCALIZATION_LANGUAGE_LABELS[language].en : LOCALIZATION_LANGUAGE_LABELS[language].zh}</option>)}
              </select>
            </label>
          </div>
          {project.sourceLanguage === 'AUTO' && <div className={`-mt-1 text-[9px] leading-4 ${muted}`}>{isEnglish ? 'AUTO delegates source-language detection to the selected translation provider. Verify it here before approving translations.' : '“自动识别”由当前翻译渠道判断源语言；确认译文前请在此核对，必要时手动选择。'}</div>}

          <div className={`rounded-xl border p-3 ${panel}`}>
            <div className={`mb-2 text-[10px] font-semibold ${muted}`}>{t('nodes.localization.targetBranches')}</div>
            <div className="flex flex-wrap gap-1.5">
              {LOCALIZATION_TARGET_LANGUAGES.map((language) => {
                const enabled = project.targetLanguages.includes(language);
                const branch = project.branches.find((item) => item.language === language);
                const completed = branch?.delivery != null;
                return (
                  <span key={language} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => enabled ? switchTargetBranch(language) : toggleTargetBranch(language)}
                      aria-pressed={enabled}
                      className={`rounded-full border px-2 py-1 text-[9px] font-semibold transition ${enabled
                        ? completed
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600'
                          : 'border-cyan-500 bg-cyan-500/15 text-cyan-600'
                        : isDark ? 'border-slate-700 text-slate-500' : 'border-slate-300 text-slate-500'}`}
                    >
                      {language}{branch ? ` · ${isEnglish ? ({ materials: 'Source', transcript: 'Transcript', translation: 'Translate', review: 'Review', voices: 'Voices', dubbing: 'Dubbing', delivery: 'Delivery' } as const)[branch.stage] : ({ materials: '素材', transcript: '转写', translation: '翻译', review: '审校', voices: '音色', dubbing: '配音', delivery: '交付' } as const)[branch.stage]}` : ''}
                    </button>
                    {enabled && project.targetLanguages.length > 1 && (
                      <button type="button" aria-label={`${isEnglish ? 'Archive target language' : '移出目标语言'} ${language}`} title={isEnglish ? 'Archive this language; progress is preserved' : '移出目标语言；进度会保留'} onClick={() => toggleTargetBranch(language)} className={`rounded-full border px-1.5 py-1 text-[9px] ${field}`}>×</button>
                    )}
                  </span>
                );
              })}
            </div>
            <div className={`mt-2 text-[9px] leading-4 ${muted}`}>{t('nodes.localization.branchHint')}</div>
          </div>

          <div className={`grid gap-1.5 ${project.mode === 'subtitle-only' ? 'grid-cols-3' : 'grid-cols-4'}`} role="tablist" aria-label={isEnglish ? 'Localization workflow steps' : '本地化工作步骤'}>
            {([
              { id: 'source', label: isEnglish ? '1 Source' : '1 素材', complete: project.units.length > 0 },
              { id: 'translate', label: isEnglish ? '2 Translate' : '2 翻译', complete: project.units.length > 0 && approvedCount === project.units.length },
              ...(project.mode === 'subtitle-only' ? [] : [{ id: 'voice', label: isEnglish ? '3 Voice' : '3 配音', complete: Boolean(project.ttsReceipt?.audioUrl) && project.ttsStaleUnitIds.length === 0 }]),
              { id: 'deliver', label: project.mode === 'subtitle-only' ? (isEnglish ? '3 Deliver' : '3 交付') : (isEnglish ? '4 Deliver' : '4 交付'), complete: Boolean(project.delivery) },
            ] as Array<{ id: LocalizationWorkbenchStep; label: string; complete: boolean }>).map((step) => (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={activeWorkbenchStep === step.id}
                onClick={() => setActiveWorkbenchStep(step.id)}
                className={`rounded-lg border px-2 py-2 text-[10px] font-bold transition ${activeWorkbenchStep === step.id
                  ? 'border-teal-500 bg-teal-500 text-white'
                  : step.complete
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                    : field}`}
              >
                {step.complete ? '✓ ' : ''}{step.label}
              </button>
            ))}
          </div>

          {activeWorkbenchStep === 'source' && <div className={`rounded-xl border p-3 ${panel}`} role="tabpanel">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold"><FileText size={14} className="text-teal-500" />{t('nodes.localization.source')}</div>
            <select aria-label={isEnglish ? 'Source audio or video' : '源音频或视频'} value={effectiveSourceMedia} onChange={(event) => setSourceMediaDraft(event.target.value)} className={`mb-2 w-full rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
              <option value="">{t('nodes.localization.noSourceMedia')}</option>
              {sourceMaterials.map((item) => <option key={item.id} value={item.url}>{item.kind.toUpperCase()} · {item.label || item.url.slice(0, 60)}</option>)}
            </select>
            <textarea
              aria-label={isEnglish ? 'Source script or subtitles' : '源剧本或字幕'}
              value={sourceTextDraft}
              onChange={(event) => setSourceTextDraft(event.target.value)}
              rows={4}
              maxLength={500000}
              placeholder={upstreamText ? t('nodes.localization.upstreamText', { count: upstream.texts.length }) : t('nodes.localization.sourcePlaceholder')}
              className={`w-full resize-y rounded-lg border px-2.5 py-2 text-xs leading-5 outline-none ${field}`}
            />
            {sourceDirty && <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600">{isEnglish ? 'Source draft changed. Parse or transcribe to apply it; existing translations stay intact until then.' : '源草稿已修改。请解析或转写后再继续；在应用前，现有译文不会被静默覆盖。'}</div>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" disabled={running || !effectiveSourceText} onClick={() => requestAction('parse')} className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40"><FileText size={13} />{t('nodes.localization.parse')}</button>
              <button type="button" disabled={running || !effectiveSourceMedia} onClick={() => requestAction('transcribe')} className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold disabled:opacity-40 ${field}`}><Mic2 size={13} />{t('nodes.localization.transcribe')}</button>
            </div>
          </div>}

          {activeWorkbenchStep === 'translate' && <div className={`rounded-xl border p-3 ${panel}`} role="tabpanel">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold"><Languages size={14} className="text-cyan-500" />{t('nodes.localization.translation')}</div>
              <span className={`text-[10px] ${muted}`}>{project.units.length} {t('nodes.localization.units')} · {approvedCount}/{project.units.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label={isEnglish ? 'Translation provider' : '翻译渠道'} value={selectedProvider} onChange={(event) => setProvider(event.target.value)} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                <option value="seedance-nz">{t('nodes.localization.providers.budget')}</option>
                <option value="zhenzhen">{t('nodes.localization.providers.workshop')}</option>
                {llmAdvancedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}
              </select>
              {isExternal ? (
                <select aria-label={isEnglish ? 'Translation model' : '翻译模型'} value={externalModel} onChange={(event) => changeProject({ providerModel: event.target.value })} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                  {externalModels.map((model) => <option key={model}>{model}</option>)}
                </select>
              ) : project.llmApiSource === 'seedance-nz' ? (
                <select aria-label={isEnglish ? 'Translation model' : '翻译模型'} value={seedanceModel} onChange={(event) => changeProject({ providerModel: event.target.value })} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                  {SEEDANCE_NZ_LLM_MODELS.map((model) => <option key={model}>{model}</option>)}
                </select>
              ) : (
                <select aria-label={isEnglish ? 'Translation model' : '翻译模型'} value={zhenzhenModel} onChange={(event) => changeProject({ llmModel: event.target.value })} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                  {ZHENZHEN_LLM_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <textarea value={project.glossaryText} onChange={(event) => changeProject({ glossaryText: event.target.value, translationReceipt: undefined, ttsReceipt: undefined, delivery: undefined })} rows={2} placeholder={t('nodes.localization.glossary')} className={`resize-y rounded-lg border px-2 py-1.5 text-[11px] outline-none ${field}`} />
              <textarea value={project.protectedTermsText} onChange={(event) => changeProject({ protectedTermsText: event.target.value, translationReceipt: undefined, ttsReceipt: undefined, delivery: undefined })} rows={2} placeholder={t('nodes.localization.protectedTerms')} className={`resize-y rounded-lg border px-2 py-1.5 text-[11px] outline-none ${field}`} />
            </div>
            {savedExternalMissing && <div className="mt-2 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-600">{t('nodes.localization.errors.providerMissing')}</div>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" disabled={running || sourceDirty || !project.units.length} onClick={() => requestAction('translate')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Languages size={14} />{t('nodes.localization.translateCurrent')}</button>
              <button type="button" disabled={running || sourceDirty || !project.units.length || project.targetLanguages.length < 2} onClick={() => requestAction('translate-all')} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40 ${field}`}><Languages size={14} />{t('nodes.localization.translateAll', { count: project.targetLanguages.length })}</button>
            </div>
            <div className={`mt-1 text-[9px] ${muted}`}>{t('nodes.localization.translateWith', { model: activeModel })} · {isEnglish ? `up to ${Math.ceil(project.units.length / TRANSLATION_BATCH_SIZE) * project.targetLanguages.length} provider call(s); fees follow the provider bill` : `最多 ${Math.ceil(project.units.length / TRANSLATION_BATCH_SIZE) * project.targetLanguages.length} 次渠道调用；费用以渠道账单为准`}</div>

            {!!project.units.length && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <select aria-label={isEnglish ? 'Translation review filter' : '译文审校筛选'} value={reviewFilter} onChange={(event) => { setReviewFilter(event.target.value as typeof reviewFilter); setReviewPage(0); }} className={`rounded border px-2 py-1 text-[10px] ${field}`}>
                    <option value="attention">{isEnglish ? 'Needs attention' : '待处理优先'}</option>
                    <option value="all">{isEnglish ? 'All lines' : '全部台词'}</option>
                    <option value="approved">{isEnglish ? 'Approved' : '已确认'}</option>
                  </select>
                  <span className={`text-[9px] ${muted}`}>{filteredReviewUnits.length} · {reviewPage + 1}/{reviewPageCount}</span>
                </div>
              <div className={`max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2 ${isDark ? 'border-slate-700 bg-slate-950/60' : 'border-slate-200 bg-white'}`}>
                {visibleReviewUnits.map((unit) => {
                  const voiceProfile = project.voiceProfiles.find((profile) => profile.role === unit.role);
                  const isTtsStale = project.ttsStaleUnitIds.includes(unit.id);
                  return (
                  <div key={unit.id} className={`rounded-lg border p-2 ${isTtsStale ? 'border-amber-500/60 bg-amber-500/5' : unit.approved ? 'border-emerald-500/35' : isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className={`mb-1 flex items-center justify-between text-[9px] ${muted}`}><span>#{unit.index} · {unit.role} · {(unit.startMs / 1000).toFixed(2)}–{(unit.endMs / 1000).toFixed(2)}s</span><span>{unit.approved ? t('nodes.localization.approved') : t('nodes.localization.review')}</span></div>
                    <div className={`mb-1 text-[10px] leading-4 ${muted}`}>{unit.sourceText}</div>
                    <div className="mb-1 grid grid-cols-2 gap-1">
                      <label className={`text-[9px] ${muted}`}>{isEnglish ? 'Start (s)' : '开始（秒）'}<input aria-label={`${isEnglish ? 'Start time' : '开始时间'} #${unit.index}`} type="number" min={0} step={0.01} value={(unit.startMs / 1000).toFixed(2)} onChange={(event) => { const startMs = Math.max(0, Math.round(Number(event.target.value) * 1000)); updateUnit(unit.id, { startMs: Math.min(startMs, unit.endMs - 1) }); }} className={`mt-0.5 w-full rounded border px-1.5 py-1 text-[10px] ${field}`} /></label>
                      <label className={`text-[9px] ${muted}`}>{isEnglish ? 'End (s)' : '结束（秒）'}<input aria-label={`${isEnglish ? 'End time' : '结束时间'} #${unit.index}`} type="number" min={(unit.startMs + 1) / 1000} step={0.01} value={(unit.endMs / 1000).toFixed(2)} onChange={(event) => updateUnit(unit.id, { endMs: Math.max(unit.startMs + 1, Math.round(Number(event.target.value) * 1000)) })} className={`mt-0.5 w-full rounded border px-1.5 py-1 text-[10px] ${field}`} /></label>
                    </div>
                    <textarea aria-label={`${isEnglish ? 'Translation' : '译文'} #${unit.index}`} value={unit.translatedText} onChange={(event) => updateUnit(unit.id, { translatedText: event.target.value })} rows={2} placeholder={t('nodes.localization.translationPlaceholder')} className={`w-full resize-y rounded border px-2 py-1 text-[11px] leading-4 outline-none ${field}`} />
                    {unit.backTranslation && <div className={`mt-1 rounded border px-2 py-1 text-[9px] leading-4 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${muted}`}><strong>{isEnglish ? 'Back translation' : '回译'}：</strong>{unit.backTranslation}</div>}
                    <div className="mt-1 grid grid-cols-[1fr_1fr_auto_auto] gap-1">
                      <input aria-label={`${isEnglish ? 'Spoken script' : '发音稿'} #${unit.index}`} value={unit.pronunciation || ''} onChange={(event) => updateUnit(unit.id, { pronunciation: event.target.value })} placeholder={t('nodes.localization.pronunciation')} className={`rounded border px-1.5 py-1 text-[10px] outline-none ${field}`} />
                      <input aria-label={`${isEnglish ? 'Emotion' : '情绪'} #${unit.index}`} value={unit.emotion || ''} onChange={(event) => updateUnit(unit.id, { emotion: event.target.value })} placeholder={t('nodes.localization.emotion')} className={`rounded border px-1.5 py-1 text-[10px] outline-none ${field}`} />
                      <button type="button" aria-label={`${isEnglish ? 'Listen to dubbed line' : '试听配音'} #${unit.index}`} title={isEnglish ? 'Listen to this line from the latest dub' : '试听最新配音中的本句'} disabled={!project.ttsReceipt?.audioUrl} onClick={() => void previewUnitAudio(unit)} className={`rounded px-2 text-[10px] ${field}`}><Volume2 size={12} /></button>
                      <button type="button" aria-label={`${unit.approved ? (isEnglish ? 'Unapprove' : '取消确认') : (isEnglish ? 'Approve' : '确认')} #${unit.index}`} title={unit.approved ? t('nodes.localization.approved') : t('nodes.localization.review')} onClick={() => updateUnit(unit.id, { approved: !unit.approved })} className={`rounded px-2 text-[10px] font-semibold ${unit.approved ? 'bg-emerald-500 text-white' : isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}><Check size={12} /></button>
                    </div>
                    {(typeof unit.confidence === 'number' || (unit.warnings?.length || 0) > 0) && <div className={`mt-1 text-[9px] ${(unit.warnings?.length || 0) > 0 || (unit.confidence ?? 1) < 0.75 ? 'text-amber-600' : muted}`}>{typeof unit.confidence === 'number' ? `${isEnglish ? 'Confidence' : '置信度'} ${Math.round(unit.confidence * 100)}%` : ''}{unit.warnings?.length ? ` · ${unit.warnings.join('；')}` : ''}</div>}
                    {typeof unit.asrPassed === 'boolean' && <div className={`mt-1 text-[9px] ${unit.asrPassed ? 'text-emerald-500' : 'text-rose-500'}`}>ASR {(Number(unit.asrSimilarity || 0) * 100).toFixed(1)}% · {unit.asrText}</div>}
                    {project.ttsReceipt?.audioUrl && (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className={`text-[9px] ${isTtsStale ? 'font-semibold text-amber-600' : muted}`}>
                          {isTtsStale
                            ? (isEnglish ? 'Changed after dubbing; re-dub this line.' : '配音后已修改，请重配本句。')
                            : (isEnglish ? 'Current dub is reusable.' : '当前配音可继续复用。')}
                        </span>
                        <button
                          type="button"
                          disabled={running || !runtime?.ready || !unit.approved || !voiceProfile?.referenceUrl || !voiceProfile.consentConfirmed}
                          onClick={() => {
                            retryUnitIdRef.current = unit.id;
                            requestAction('dub-line');
                          }}
                          aria-label={`${isEnglish ? 'Re-dub line' : '重配本句'} #${unit.index}`}
                          title={isEnglish ? 'Generate and replace only this line; other dubbed lines are reused' : '仅生成并替换本句，其余已配音台词继续复用'}
                          className={`shrink-0 rounded border px-2 py-1 text-[9px] font-semibold disabled:opacity-40 ${isTtsStale ? 'border-amber-500 bg-amber-500/15 text-amber-600' : field}`}
                        >
                          {isEnglish ? 'Re-dub line' : '重配本句'}
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
                {reviewPageCount > 1 && <div className="mt-1 grid grid-cols-2 gap-2"><button type="button" disabled={reviewPage === 0} onClick={() => setReviewPage((page) => Math.max(0, page - 1))} className={`rounded border px-2 py-1 text-[10px] disabled:opacity-40 ${field}`}>{isEnglish ? 'Previous 50' : '前 50 条'}</button><button type="button" disabled={reviewPage >= reviewPageCount - 1} onClick={() => setReviewPage((page) => Math.min(reviewPageCount - 1, page + 1))} className={`rounded border px-2 py-1 text-[10px] disabled:opacity-40 ${field}`}>{isEnglish ? 'Next 50' : '后 50 条'}</button></div>}
              </div>
            )}
            {!!project.units.length && <button type="button" onClick={approveAll} className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold ${field}`}><ShieldCheck size={14} />{isEnglish ? 'Approve clean lines; review warnings manually' : '确认无警告译文；警告项逐条审校'}</button>}
          </div>}

          {activeWorkbenchStep === 'voice' && project.mode !== 'subtitle-only' && (
            <div className={`rounded-xl border p-3 ${panel}`}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold"><Volume2 size={14} className="text-violet-500" />IndexTTS 2.5</div>
                <button type="button" onClick={refreshRuntime} disabled={runtimeBusy || running} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${field}`}><RefreshCw size={11} className={runtimeBusy ? 'animate-spin' : ''} />{t('nodes.localization.runtime.check')}</button>
              </div>
              <div className={`rounded-lg border px-2 py-2 text-[10px] leading-4 ${runtime?.ready ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/30 bg-amber-500/10 text-amber-600'}`}>
                {runtimeMessage}<br />
                <span className="font-semibold">{t('nodes.localization.runtime.noComfy')}</span>
                {runtime?.install?.running && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10"><div className="h-full bg-teal-500" style={{ width: `${Math.max(2, runtime.install.progress)}%` }} /></div>}
              </div>
              {!runtime?.ready && (
                <>
                  <label className="mt-2 flex items-start gap-2 text-[10px] leading-4">
                    <input type="checkbox" checked={runtime?.licenseAccepted === true} disabled={licenseBusy || runtime?.licenseAccepted === true} onChange={(event) => { if (event.target.checked) void acceptModelLicense(); }} className="mt-0.5" />
                    <span>{t('nodes.localization.runtime.licenseConfirm')} <a href={runtime?.modelLicenseUrl || 'https://github.com/index-tts/index-tts/blob/main/LICENSE_ZH.txt'} target="_blank" rel="noreferrer" className="font-semibold text-teal-500 underline">{t('nodes.localization.runtime.readLicense')}</a></span>
                  </label>
                  <button type="button" disabled={running || !runtime?.licenseAccepted} onClick={() => requestAction('install')} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><PackageCheck size={14} />{t('nodes.localization.runtime.install')}</button>
                  {runtime?.install?.running && <button type="button" onClick={() => void cancelLocalizationRuntime().then(refreshRuntime)} className={`mt-1 w-full rounded-lg border px-3 py-1.5 text-[10px] font-semibold ${field}`}>{isEnglish ? 'Cancel installation' : '取消安装'}</button>}
                  <div className={`mt-1 text-[9px] leading-4 ${muted}`}>{t('nodes.localization.runtime.installHint')}</div>
                </>
              )}

              {!!roles.length && (
                <div className="mt-3 space-y-2">
                  <div className={`text-[10px] font-semibold ${muted}`}>{t('nodes.localization.voices', { count: roles.length })}</div>
                  {roles.length > MAX_LOCALIZATION_ROLES && <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-500">{isEnglish ? `At most ${MAX_LOCALIZATION_ROLES} roles are supported. Merge roles before dubbing.` : `最多支持 ${MAX_LOCALIZATION_ROLES} 个角色，请先合并角色再配音。`}</div>}
                  {roles.map((role) => {
                    const profile = project.voiceProfiles.find((item) => item.role === role);
                    return (
                      <div key={role} className="grid grid-cols-[88px_1fr_auto_auto] items-center gap-2">
                        <span className="truncate text-[10px] font-semibold" title={role}>{role}</span>
                        <select aria-label={`${isEnglish ? 'Reference voice' : '参考音色'} ${role}`} value={profile?.referenceUrl || ''} onChange={(event) => updateVoice(role, { referenceUrl: event.target.value, consentConfirmed: false })} className={`min-w-0 rounded-lg border px-2 py-1.5 text-[10px] outline-none ${field}`}>
                          <option value="">{t('nodes.localization.voiceReference')}</option>
                          {voiceMaterials.map((item) => <option key={item.id} value={item.url}>{item.kind.toUpperCase()} · {item.label || item.url.slice(0, 45)}</option>)}
                        </select>
                        <button type="button" disabled={!profile?.referenceUrl} onClick={() => setVoicePreviewUrl(profile?.referenceUrl || '')} aria-label={`${isEnglish ? 'Audition voice' : '试听音色'} ${role}`} className={`rounded border px-2 py-1.5 text-[9px] disabled:opacity-40 ${field}`}>{isEnglish ? 'Listen' : '试听'}</button>
                        <label className="flex items-center gap-1 text-[9px]"><input type="checkbox" checked={profile?.consentConfirmed === true} disabled={!profile?.referenceUrl} onChange={(event) => updateVoice(role, { consentConfirmed: event.target.checked })} />{t('nodes.localization.consent')}</label>
                      </div>
                    );
                  })}
                </div>
              )}
              {voicePreviewUrl && <audio controls autoPlay preload="metadata" src={voicePreviewUrl} className="mt-2 w-full" aria-label={isEnglish ? 'Reference voice preview' : '参考音色试听'} />}

              <button type="button" onClick={() => changeProject({ advancedOpen: !project.advancedOpen })} className={`mt-3 flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${field}`}><span>{t('nodes.localization.advanced')}</span>{project.advancedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
              {project.advancedOpen && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className={`text-[9px] ${muted}`}>{t('nodes.localization.timingMode')}<select value={project.timingMode} onChange={(event) => changeProject({ timingMode: event.target.value as LocalizationProject['timingMode'], ttsReceipt: undefined, delivery: undefined })} className={`mt-1 w-full rounded border px-2 py-1.5 text-[10px] ${field}`}><option value="pad">pad</option><option value="native">native</option><option value="natural">natural</option><option value="exact">exact</option></select></label>
                  <label className={`text-[9px] ${muted}`}>{t('nodes.localization.timeline')}<select value={project.timelinePolicy} onChange={(event) => changeProject({ timelinePolicy: event.target.value as LocalizationProject['timelinePolicy'], ttsReceipt: undefined, delivery: undefined })} className={`mt-1 w-full rounded border px-2 py-1.5 text-[10px] ${field}`}><option value="shift">shift</option><option value="overlay">overlay</option></select></label>
                  <label className={`flex items-center gap-2 text-[10px] ${muted}`}><input type="checkbox" checked={project.asrEnabled} onChange={(event) => changeProject({ asrEnabled: event.target.checked, ttsReceipt: undefined, delivery: undefined })} />{t('nodes.localization.asrReview')}</label>
                  <label className={`text-[9px] ${muted}`}>{t('nodes.localization.asrThreshold')}<input type="number" min={0} max={1} step={0.01} value={project.asrThreshold} onChange={(event) => changeProject({ asrThreshold: Number(event.target.value), ttsReceipt: undefined, delivery: undefined })} className={`mt-1 w-full rounded border px-2 py-1.5 text-[10px] ${field}`} /></label>
                </div>
              )}
              {!supportsLocalizationDubbing(project.targetLanguage) && <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600">{t('nodes.localization.unsupportedDubbing')}</div>}
              {project.ttsReceipt?.audioUrl && <audio ref={dubbingPreviewRef} controls preload="metadata" src={project.ttsReceipt.audioUrl} className="mt-2 w-full" aria-label={isEnglish ? 'Latest dubbed audio' : '最新配音音频'} />}
              <button type="button" disabled={running || sourceDirty || roles.length > MAX_LOCALIZATION_ROLES || !runtime?.ready || !supportsLocalizationDubbing(project.targetLanguage) || approvedCount !== project.units.length || !project.units.length} onClick={() => requestAction('dub')} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Volume2 size={14} />{t('nodes.localization.generateDub')}</button>
            </div>
          )}

          {activeWorkbenchStep === 'deliver' && <div className={`rounded-xl border p-3 ${panel}`} role="tabpanel">
            <div className="mb-2 flex items-center justify-between text-xs font-bold"><span className="flex items-center gap-2"><PackageCheck size={14} className="text-emerald-500" />{t('nodes.localization.delivery')}</span><span className={`text-[10px] ${muted}`}>{isEnglish ? ({ materials: 'Source', transcript: 'Transcript', translation: 'Translate', review: 'Review', voices: 'Voices', dubbing: 'Dubbing', delivery: 'Delivery' } as const)[project.stage] : ({ materials: '素材', transcript: '转写', translation: '翻译', review: '审校', voices: '音色', dubbing: '配音', delivery: '交付' } as const)[project.stage]}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={running || sourceDirty || !project.units.length || approvedCount !== project.units.length || (project.mode !== 'subtitle-only' && (!project.ttsReceipt?.audioUrl || project.ttsStaleUnitIds.length > 0))} onClick={() => requestAction('deliver')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><PackageCheck size={14} />{t('nodes.localization.createDelivery')}</button>
              <button type="button" disabled={running || sourceDirty || project.targetLanguages.length < 2 || !allBranchesDeliverable} onClick={() => requestAction('deliver-all')} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40 ${field}`}><PackageCheck size={14} />{isEnglish ? 'Deliver all languages' : '交付全部语言'}</button>
            </div>
            {project.delivery && <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-[10px] text-emerald-600"><CheckCircle2 size={14} />{t('nodes.localization.delivered', { language: project.targetLanguage, warnings: project.delivery.qc.warnings.length })}</div>}
          </div>}

          {(localError || d.error) && <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] leading-4 text-rose-500"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span className="whitespace-pre-wrap">{localError || String(d.error)}</span></div>}
          {running && <div className="flex items-center justify-center gap-2 py-1 text-[10px] text-teal-500"><Loader2 size={13} className="animate-spin" />{t('nodes.localization.running')}</div>}
        </div>
      </div>
    </div>
  );
}

export default memo(LocalizationMasterNode);
