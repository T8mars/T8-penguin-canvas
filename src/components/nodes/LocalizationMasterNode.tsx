import { memo, useMemo, useRef, useState } from 'react';
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
  cancelLocalizationRuntime,
  inspectLocalizationRuntime,
  installLocalizationRuntime,
  muxLocalizationVideo,
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
  applyLocalizationTranslationResponse,
  buildLocalizationQc,
  buildLocalizationTranslationMessages,
  createLocalizationProject,
  localizationRoles,
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

type LocalizationAction = 'parse' | 'transcribe' | 'translate' | 'translate-all' | 'install' | 'dub' | 'verify' | 'deliver';
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
  const [runtimeLocal, setRuntimeLocal] = useState<LocalizationRuntimeReceipt | undefined>(project.runtimeReceipt);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const actionRef = useRef<LocalizationAction>('parse');

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
  const sourceMaterials = useMemo(
    () => [...upstream.videos, ...upstream.audios],
    [upstream.audios, upstream.videos],
  );
  const upstreamText = useMemo(
    () => upstream.texts.map((item) => item.url).filter(Boolean).join('\n\n').trim(),
    [upstream.texts],
  );
  const effectiveSourceMedia = project.sourceMediaUrl || sourceMaterials[0]?.url || '';
  const effectiveSourceText = project.sourceText.trim() || upstreamText;
  const voiceMaterials = useMemo(
    () => sourceMaterials.filter((item) => item.url !== effectiveSourceMedia),
    [effectiveSourceMedia, sourceMaterials],
  );
  const runtime = runtimeLocal || project.runtimeReceipt;
  const roles = localizationRoles(project.units);
  const running = ['running', 'generating', 'installing', 'transcribing', 'translating', 'dubbing', 'delivering'].includes(String(d.status || ''));
  const isEnglish = i18n.language.toLowerCase().startsWith('en');

  const surface = isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-300 bg-white text-slate-900';
  const header = isDark ? 'border-slate-700 bg-slate-900/90' : 'border-slate-200 bg-slate-50';
  const panel = isDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-50';
  const field = isDark
    ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-600'
    : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';

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
      commitProject(readProject(), { runtimeReceipt: receipt });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const runParse = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    const sourceText = base.sourceText.trim() || upstreamText;
    if (!sourceText) throw new Error(t('nodes.localization.errors.sourceText'));
    const units = parseLocalizationText(sourceText);
    if (!units.length) throw new Error(t('nodes.localization.errors.parse'));
    const selectedMedia = sourceMaterials.find((item) => item.url === (base.sourceMediaUrl || effectiveSourceMedia));
    const next = commitProject(base, resetLocalizationBranches({
      ...base,
      sourceText,
      sourceMediaUrl: selectedMedia?.url || base.sourceMediaUrl,
      sourceMediaKind: mediaKind(selectedMedia),
    }, units), { status: 'success', error: '', outputText: serializeLocalizationSrt(units) });
    await reporter.output({ status: 'succeeded', outputCount: 1, assets: [{ kind: 'text', text: next.sourceText, mimeType: 'text/plain' }] });
  };

  const runTranscribe = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    const sourceUrl = base.sourceMediaUrl || effectiveSourceMedia;
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
    commitProject(base, resetLocalizationBranches({
      ...base,
      sourceMediaUrl: sourceUrl,
      sourceMediaKind: mediaKind(source),
      sourceText,
      warnings: evidence.attribution === 'untimed' ? [t('nodes.localization.warnings.untimed')] : [],
    }, units), { status: 'success', error: '', outputText: serializeLocalizationSrt(units) });
    await reporter.output({ status: 'succeeded', outputCount: 1, assets: [{ kind: 'text', text: sourceText, mimeType: 'text/plain' }] });
  };

  const translateBranch = async (
    inputProject: LocalizationProject,
    reporter: RunNodeLifecycleReporter,
    progress: { branch: number; totalBranches: number },
  ): Promise<LocalizationProject> => {
    let base = inputProject;
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
    update({ status: 'translating', error: '' });
    const translated: LocalizationTranslationUnit[] = [];
    const requestDigests: string[] = [];
    const requestIds: string[] = [];
    const batches = Math.ceil(base.units.length / TRANSLATION_BATCH_SIZE);
    for (let index = 0; index < batches; index += 1) {
      if (reporter.signal?.aborted) throw reporter.signal.reason || new Error('aborted');
      const units = base.units.slice(index * TRANSLATION_BATCH_SIZE, (index + 1) * TRANSLATION_BATCH_SIZE);
      const batchProject = { ...base, units };
      const messages = buildLocalizationTranslationMessages(batchProject);
      const digest = await sha256Text(JSON.stringify({ provider, model, messages }));
      requestDigests.push(digest);
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
      translated.push(...applyLocalizationTranslationResponse(batchProject, result.content));
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
    if (!base.modelLicenseConfirmed) throw new Error(t('nodes.localization.errors.license'));
    update({ status: 'installing', error: '' });
    try {
      await installLocalizationRuntime({ modelLicenseConfirmed: true, source: 'huggingface' }, reporter.signal);
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
          base = commitProject(base, { runtimeReceipt: receipt, stage: base.stage === 'review' ? 'voices' : base.stage }, { status: 'success', error: '' });
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
    const errors = validateLocalizationForDubbing(base);
    if (errors.length) throw new Error(errors.join('\n'));
    update({ status: 'dubbing', error: '' });
    await reporter.providerRequest({
      provider: 'embedded-index-tts-2.5', model: base.runtimeReceipt?.modelRevision || 'IndexTTS-2.5',
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
      modelLicenseConfirmed: true,
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
      provider: 'embedded-index-tts-2.5', model: base.runtimeReceipt?.modelRevision || 'IndexTTS-2.5',
      requestId: result.requestId, status: 'succeeded', requiresComfyUI: false,
    });
    commitProject(base, {
      units,
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
        subtitles: { outputText: result.subtitleText, text: result.subtitleText },
      },
    });
    await reporter.output({
      status: 'succeeded', outputCount: 2,
      assets: [
        { kind: 'audio', sourceUrl: result.audioUrl, mimeType: 'audio/wav' },
        { kind: 'text', text: result.subtitleText, mimeType: 'application/x-subrip' },
      ],
    });
  };

  const runDeliver = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    if (!base.units.length || base.units.some((unit) => !unit.translatedText.trim())) throw new Error(t('nodes.localization.errors.translationMissing'));
    if (base.units.some((unit) => !unit.approved)) throw new Error(t('nodes.localization.errors.approval'));
    if (base.mode !== 'subtitle-only' && !base.ttsReceipt?.audioUrl) throw new Error(t('nodes.localization.errors.dubFirst'));
    update({ status: 'delivering', error: '' });
    const subtitleText = base.ttsReceipt?.rewrittenSrt
      || serializeLocalizationSrt(base.units, { translated: true, includeRole: base.subtitleIncludeRole });
    const subtitle = base.ttsReceipt?.subtitleUrl
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
      subtitleUrl: subtitle.subtitleUrl,
      subtitleText,
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
        subtitles: { outputText: subtitleText, text: subtitleText },
        manifest: { metadata: manifest, outputText: manifestText },
      },
    });
    const assets: Array<Record<string, unknown>> = [
      { kind: 'text', text: subtitleText, sourceUrl: subtitle.subtitleUrl, filename: `localization-${base.targetLanguage}.srt`, mimeType: 'application/x-subrip' },
      { kind: 'text', text: manifestText, filename: `localization-${base.targetLanguage}-manifest.json`, mimeType: 'application/json' },
    ];
    if (manifest.dubbedAudioUrl) assets.push({ kind: 'audio', sourceUrl: manifest.dubbedAudioUrl, mimeType: 'audio/wav' });
    if (manifest.localizedVideoUrl) assets.push({ kind: 'video', sourceUrl: manifest.localizedVideoUrl, mimeType: 'video/mp4' });
    await reporter.output({ status: 'succeeded', outputCount: assets.length, assets });
  };

  const runVerify = async (reporter: RunNodeLifecycleReporter) => {
    const base = readProject();
    if (!base.units.length || base.units.some((unit) => !unit.translatedText.trim())) throw new Error(t('nodes.localization.errors.translationMissing'));
    if (base.units.some((unit) => !unit.approved)) throw new Error(t('nodes.localization.errors.approval'));
    if (base.mode !== 'subtitle-only' && !base.ttsReceipt?.audioUrl) throw new Error(t('nodes.localization.errors.dubFirst'));
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
    setLocalError('');
    update({ status: 'running', error: '' });
    try {
      switch (actionRef.current) {
        case 'parse': await runParse(reporter); break;
        case 'transcribe': await runTranscribe(reporter); break;
        case 'translate': await runTranslate(reporter); break;
        case 'translate-all': await runTranslateAll(reporter); break;
        case 'install': await runInstall(reporter); break;
        case 'dub': await runDub(reporter); break;
        case 'verify': await runVerify(reporter); break;
        case 'deliver': await runDeliver(reporter); break;
      }
      markAgentRequest('completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      markAgentRequest('failed', message);
      throw error;
    }
  }, 'localization-master', { lifecycleAware: true });

  const requestAction = (action: LocalizationAction) => {
    actionRef.current = action;
    setLocalError('');
    if (!requestCanvasNodeRun(id)) setLocalError(t('nodes.localization.errors.runRequest'));
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
    requestAction(action);
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
    changeProject({
      units: project.units.map((unit) => unit.id === unitId ? { ...unit, ...patch, approved: patch.approved ?? false } : unit),
      stage: 'review',
      ttsReceipt: undefined,
      delivery: undefined,
    });
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
    changeProject({
      units: project.units.map((unit) => ({ ...unit, approved: true })),
      voiceProfiles,
      stage: project.mode === 'subtitle-only' ? 'delivery' : 'voices',
      delivery: undefined,
    });
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
  const runtimeState = runtimeTone(runtime);
  const runtimeMessage = !runtime
    ? t('nodes.localization.runtime.notChecked')
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

          <div className={`rounded-xl border p-3 ${panel}`}>
            <div className={`mb-2 text-[10px] font-semibold ${muted}`}>{t('nodes.localization.targetBranches')}</div>
            <div className="flex flex-wrap gap-1.5">
              {LOCALIZATION_TARGET_LANGUAGES.map((language) => {
                const enabled = project.targetLanguages.includes(language);
                const branch = project.branches.find((item) => item.language === language);
                const completed = branch?.delivery != null;
                return (
                  <button
                    key={language}
                    type="button"
                    onClick={() => toggleTargetBranch(language)}
                    aria-pressed={enabled}
                    title={enabled && project.targetLanguages.length === 1 ? t('nodes.localization.keepOneTarget') : undefined}
                    className={`rounded-full border px-2 py-1 text-[9px] font-semibold transition ${enabled
                      ? completed
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600'
                        : 'border-cyan-500 bg-cyan-500/15 text-cyan-600'
                      : isDark ? 'border-slate-700 text-slate-500' : 'border-slate-300 text-slate-500'}`}
                  >
                    {language}{branch ? ` · ${branch.stage}` : ''}
                  </button>
                );
              })}
            </div>
            <div className={`mt-2 text-[9px] leading-4 ${muted}`}>{t('nodes.localization.branchHint')}</div>
          </div>

          <div className={`rounded-xl border p-3 ${panel}`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold"><FileText size={14} className="text-teal-500" />{t('nodes.localization.source')}</div>
            <select value={effectiveSourceMedia} onChange={(event) => {
              const material = sourceMaterials.find((item) => item.url === event.target.value);
              changeProject({ sourceMediaUrl: event.target.value, sourceMediaKind: mediaKind(material), ttsReceipt: undefined, delivery: undefined });
            }} className={`mb-2 w-full rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
              <option value="">{t('nodes.localization.noSourceMedia')}</option>
              {sourceMaterials.map((item) => <option key={item.id} value={item.url}>{item.kind.toUpperCase()} · {item.label || item.url.slice(0, 60)}</option>)}
            </select>
            <textarea
              value={project.sourceText}
              onChange={(event) => changeProject({ sourceText: event.target.value, translationReceipt: undefined, ttsReceipt: undefined, delivery: undefined })}
              rows={4}
              maxLength={500000}
              placeholder={upstreamText ? t('nodes.localization.upstreamText', { count: upstream.texts.length }) : t('nodes.localization.sourcePlaceholder')}
              className={`w-full resize-y rounded-lg border px-2.5 py-2 text-xs leading-5 outline-none ${field}`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" disabled={running || !effectiveSourceText} onClick={() => requestAction('parse')} className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40"><FileText size={13} />{t('nodes.localization.parse')}</button>
              <button type="button" disabled={running || !effectiveSourceMedia} onClick={() => requestAction('transcribe')} className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold disabled:opacity-40 ${field}`}><Mic2 size={13} />{t('nodes.localization.transcribe')}</button>
            </div>
          </div>

          <div className={`rounded-xl border p-3 ${panel}`}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold"><Languages size={14} className="text-cyan-500" />{t('nodes.localization.translation')}</div>
              <span className={`text-[10px] ${muted}`}>{project.units.length} {t('nodes.localization.units')} · {approvedCount}/{project.units.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={selectedProvider} onChange={(event) => setProvider(event.target.value)} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                <option value="seedance-nz">{t('nodes.localization.providers.budget')}</option>
                <option value="zhenzhen">{t('nodes.localization.providers.workshop')}</option>
                {llmAdvancedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}
              </select>
              {isExternal ? (
                <select value={externalModel} onChange={(event) => changeProject({ providerModel: event.target.value })} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                  {externalModels.map((model) => <option key={model}>{model}</option>)}
                </select>
              ) : project.llmApiSource === 'seedance-nz' ? (
                <select value={seedanceModel} onChange={(event) => changeProject({ providerModel: event.target.value })} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
                  {SEEDANCE_NZ_LLM_MODELS.map((model) => <option key={model}>{model}</option>)}
                </select>
              ) : (
                <select value={zhenzhenModel} onChange={(event) => changeProject({ llmModel: event.target.value })} className={`rounded-lg border px-2 py-2 text-xs outline-none ${field}`}>
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
              <button type="button" disabled={running || !project.units.length} onClick={() => requestAction('translate')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Languages size={14} />{t('nodes.localization.translateCurrent')}</button>
              <button type="button" disabled={running || !project.units.length || project.targetLanguages.length < 2} onClick={() => requestAction('translate-all')} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40 ${field}`}><Languages size={14} />{t('nodes.localization.translateAll', { count: project.targetLanguages.length })}</button>
            </div>
            <div className={`mt-1 text-[9px] ${muted}`}>{t('nodes.localization.translateWith', { model: activeModel })}</div>

            {!!project.units.length && (
              <div className={`mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border p-2 ${isDark ? 'border-slate-700 bg-slate-950/60' : 'border-slate-200 bg-white'}`}>
                {project.units.map((unit) => (
                  <div key={unit.id} className={`rounded-lg border p-2 ${unit.approved ? 'border-emerald-500/35' : isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className={`mb-1 flex items-center justify-between text-[9px] ${muted}`}><span>#{unit.index} · {unit.role} · {(unit.startMs / 1000).toFixed(2)}–{(unit.endMs / 1000).toFixed(2)}s</span><span>{unit.approved ? t('nodes.localization.approved') : t('nodes.localization.review')}</span></div>
                    <div className={`mb-1 text-[10px] leading-4 ${muted}`}>{unit.sourceText}</div>
                    <textarea value={unit.translatedText} onChange={(event) => updateUnit(unit.id, { translatedText: event.target.value })} rows={2} placeholder={t('nodes.localization.translationPlaceholder')} className={`w-full resize-y rounded border px-2 py-1 text-[11px] leading-4 outline-none ${field}`} />
                    <div className="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1">
                      <input value={unit.pronunciation || ''} onChange={(event) => updateUnit(unit.id, { pronunciation: event.target.value })} placeholder={t('nodes.localization.pronunciation')} className={`rounded border px-1.5 py-1 text-[10px] outline-none ${field}`} />
                      <input value={unit.emotion || ''} onChange={(event) => updateUnit(unit.id, { emotion: event.target.value })} placeholder={t('nodes.localization.emotion')} className={`rounded border px-1.5 py-1 text-[10px] outline-none ${field}`} />
                      <button type="button" onClick={() => updateUnit(unit.id, { approved: !unit.approved })} className={`rounded px-2 text-[10px] font-semibold ${unit.approved ? 'bg-emerald-500 text-white' : isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}><Check size={12} /></button>
                    </div>
                    {typeof unit.asrPassed === 'boolean' && <div className={`mt-1 text-[9px] ${unit.asrPassed ? 'text-emerald-500' : 'text-rose-500'}`}>ASR {(Number(unit.asrSimilarity || 0) * 100).toFixed(1)}% · {unit.asrText}</div>}
                  </div>
                ))}
              </div>
            )}
            {!!project.units.length && <button type="button" onClick={approveAll} className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold ${field}`}><ShieldCheck size={14} />{t('nodes.localization.approveAll')}</button>}
          </div>

          {project.mode !== 'subtitle-only' && (
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
                    <input type="checkbox" checked={project.modelLicenseConfirmed} onChange={(event) => changeProject({ modelLicenseConfirmed: event.target.checked })} className="mt-0.5" />
                    <span>{t('nodes.localization.runtime.licenseConfirm')} <a href={runtime?.modelLicenseUrl || 'https://github.com/index-tts/index-tts/blob/main/LICENSE_ZH.txt'} target="_blank" rel="noreferrer" className="font-semibold text-teal-500 underline">{t('nodes.localization.runtime.readLicense')}</a></span>
                  </label>
                  <button type="button" disabled={running || !project.modelLicenseConfirmed} onClick={() => requestAction('install')} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><PackageCheck size={14} />{t('nodes.localization.runtime.install')}</button>
                  <div className={`mt-1 text-[9px] leading-4 ${muted}`}>{t('nodes.localization.runtime.installHint')}</div>
                </>
              )}

              {!!roles.length && (
                <div className="mt-3 space-y-2">
                  <div className={`text-[10px] font-semibold ${muted}`}>{t('nodes.localization.voices', { count: roles.length })}</div>
                  {roles.map((role) => {
                    const profile = project.voiceProfiles.find((item) => item.role === role);
                    return (
                      <div key={role} className="grid grid-cols-[88px_1fr_auto] items-center gap-2">
                        <span className="truncate text-[10px] font-semibold" title={role}>{role}</span>
                        <select value={profile?.referenceUrl || ''} onChange={(event) => updateVoice(role, { referenceUrl: event.target.value, consentConfirmed: false })} className={`min-w-0 rounded-lg border px-2 py-1.5 text-[10px] outline-none ${field}`}>
                          <option value="">{t('nodes.localization.voiceReference')}</option>
                          {voiceMaterials.map((item) => <option key={item.id} value={item.url}>{item.kind.toUpperCase()} · {item.label || item.url.slice(0, 45)}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-[9px]"><input type="checkbox" checked={profile?.consentConfirmed === true} disabled={!profile?.referenceUrl} onChange={(event) => updateVoice(role, { consentConfirmed: event.target.checked })} />{t('nodes.localization.consent')}</label>
                      </div>
                    );
                  })}
                </div>
              )}

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
              <button type="button" disabled={running || !runtime?.ready || !supportsLocalizationDubbing(project.targetLanguage) || approvedCount !== project.units.length || !project.units.length} onClick={() => requestAction('dub')} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Volume2 size={14} />{t('nodes.localization.generateDub')}</button>
            </div>
          )}

          <div className={`rounded-xl border p-3 ${panel}`}>
            <div className="mb-2 flex items-center justify-between text-xs font-bold"><span className="flex items-center gap-2"><PackageCheck size={14} className="text-emerald-500" />{t('nodes.localization.delivery')}</span><span className={`text-[10px] ${muted}`}>{project.stage}</span></div>
            <button type="button" disabled={running || !project.units.length || approvedCount !== project.units.length || (project.mode !== 'subtitle-only' && !project.ttsReceipt?.audioUrl)} onClick={() => requestAction('deliver')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><PackageCheck size={14} />{t('nodes.localization.createDelivery')}</button>
            {project.delivery && <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-[10px] text-emerald-600"><CheckCircle2 size={14} />{t('nodes.localization.delivered', { language: project.targetLanguage, warnings: project.delivery.qc.warnings.length })}</div>}
          </div>

          {(localError || d.error) && <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] leading-4 text-rose-500"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span className="whitespace-pre-wrap">{localError || String(d.error)}</span></div>}
          {running && <div className="flex items-center justify-center gap-2 py-1 text-[10px] text-teal-500"><Loader2 size={13} className="animate-spin" />{t('nodes.localization.running')}</div>}
        </div>
      </div>
    </div>
  );
}

export default memo(LocalizationMasterNode);
