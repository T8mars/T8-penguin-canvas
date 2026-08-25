import { memo, useMemo, useState } from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  FileJson2,
  Loader2,
  Music2,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { LLM_MODELS } from '../../providers/models';
import { generateExternalLlm, generateLlm, type LlmMessage } from '../../services/generation';
import { useApiKeysStore } from '../../stores/apiKeys';
import { logBus } from '../../stores/logs';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import {
  advancedProviderModelOptions,
  advancedProvidersForNode,
  resolveAdvancedProviderSelection,
} from '../../utils/advancedProviders';
import {
  MINIMAX_MUSIC3_DEFAULT_MODEL,
  MINIMAX_MUSIC3_PROMPT_ENHANCER_CONTRACT,
  applyMusic3LyricsEdit,
  buildMusic3CaptionMessages,
  buildMusic3EditPlan,
  buildMusic3LyricsMessages,
  buildMusic3Payload,
  buildMusic3Report,
  buildMusic3RouteMessages,
  buildMusic3SemanticMessages,
  effectiveMusic3LyricsMode,
  estimateMusic3ProviderRequests,
  extractSafeMusic3Tags,
  loadMusic3ReferenceIndexes,
  loadMusic3SelectedTemplates,
  localPrivateMusicProfile,
  parseMusic3GeneratedLyrics,
  parseMusic3ReferenceSelection,
  parseMusic3SemanticProfile,
  sha256Music3Text,
  validateMusic3Caption,
  validateMusic3Input,
  type Music3CaptionLanguage,
  type Music3EditScope,
  type Music3EnhancementReport,
  type Music3Input,
  type Music3Language,
  type Music3LyricsMode,
  type Music3Meter,
  type Music3QualityMode,
  type Music3Section,
  type Music3SemanticMode,
  type Music3StageName,
  type Music3StructurePreset,
} from '../../utils/minimaxMusic3PromptEnhancer';
import { createMusic3ChildAttempt } from '../../utils/music3RunAttempts';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { SEEDANCE_NZ_LLM_MODELS } from '../../config/llm';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useUpdateNodeData } from './useUpdateNodeData';
import InspirationVisible from '../../i18n/InspirationVisible';

interface StageCacheReceipt {
  schema: 't8-music3-stage-cache-receipt-v1';
  stage: Music3StageName;
  inputDigest: string;
  provider: string;
  model: string;
  status: 'succeeded';
  content: string;
  resultDigest: string;
  requestId?: string;
  usage?: Record<string, unknown>;
  completedAt: number;
}

type OutputTab = 'lyrics' | 'caption' | 'payload' | 'report';

const ZHENZHEN_LLM_MODELS = LLM_MODELS.filter((model) => !model.imageOutput);
const DEFAULT_ZHENZHEN_MODEL = ZHENZHEN_LLM_MODELS.find((model) => model.id === 'gemini-3.5-flash')?.id || ZHENZHEN_LLM_MODELS[0]?.id || '';
const contract = MINIMAX_MUSIC3_PROMPT_ENHANCER_CONTRACT;

const LYRICS_MODE_LABELS: Record<Music3LyricsMode, string> = {
  auto: '自动（有词保留，无词生成）',
  generate: '生成新歌词',
  preserve: '严格保留歌词',
  edit: '按要求润色',
  instrumental: '纯器乐',
};
const SECTION_LABELS: Record<Music3Section, string> = {
  Intro: 'Intro', Verse: 'Verse', 'Pre-Chorus': 'Pre-Chorus', Chorus: 'Chorus', 'Post-Chorus': 'Post-Chorus', Bridge: 'Bridge', Instrumental: 'Instrumental', Solo: 'Solo', Outro: 'Outro',
};

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[10px] font-semibold text-white/50">{children}</label>;
}

function PortLabel({ side, top, children }: { side: 'left' | 'right'; top: string; children: React.ReactNode }) {
  return <span className={`pointer-events-none absolute z-10 text-[9px] text-white/35 ${side === 'left' ? 'left-3' : 'right-3'}`} style={{ top, transform: 'translateY(-50%)' }}>{children}</span>;
}

function exactLyricLeak(caption: string, lyrics: string): boolean {
  const normalizedCaption = caption.toLowerCase();
  return lyrics.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 6 && !/^\[[^\]]+\]$/.test(line)).some((line) => normalizedCaption.includes(line.toLowerCase()));
}

function MiniMaxMusic3PromptEnhancerNode({ id, data, selected }: NodeProps) {
  const update = useUpdateNodeData(id);
  const d = (data || {}) as any;
  const upstream = useUpstreamMaterials(id);
  const targetConnections = useNodeConnections({ id, handleType: 'target' });
  const [localError, setLocalError] = useState('');
  const [outputTab, setOutputTab] = useState<OutputTab>('caption');

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
    return handles?.has(handle) || (!handles?.size && handle === 'music-idea');
  });
  const ideaMaterials = materialsForHandle(upstream.texts, 'music-idea');
  const lyricMaterials = materialsForHandle(upstream.texts, 'lyrics');
  const upstreamIdea = ideaMaterials.map((item) => item.url).filter(Boolean).join('\n\n').trim();
  const upstreamLyrics = lyricMaterials.map((item) => item.url).filter(Boolean).join('\n').trim();
  const musicIdea = [upstreamIdea, String(d.musicIdea || '').trim()].filter(Boolean).join('\n\n');
  const lyrics = upstreamLyrics || String(d.lyrics || '');

  const lyricsMode = enumValue<Music3LyricsMode>(d.lyricsMode, contract.lyricsModes, contract.defaults.lyricsMode as Music3LyricsMode);
  const qualityMode = enumValue<Music3QualityMode>(d.qualityMode, contract.qualityModes, contract.defaults.qualityMode as Music3QualityMode);
  const semanticMode = enumValue<Music3SemanticMode>(d.semanticMode, contract.semanticModes, contract.defaults.semanticMode as Music3SemanticMode);
  const editScope = enumValue<Music3EditScope>(d.editScope, contract.editScopes, contract.defaults.editScope as Music3EditScope);
  const editSection = enumValue<Music3Section>(d.editSection, contract.sections, contract.defaults.editSection as Music3Section);
  const structurePreset = enumValue<Music3StructurePreset>(d.structurePreset, contract.structurePresets, contract.defaults.structurePreset as Music3StructurePreset);
  const language = enumValue<Music3Language>(d.language, contract.languages, contract.defaults.language as Music3Language);
  const captionLanguage = enumValue<Music3CaptionLanguage>(d.captionLanguage, contract.captionLanguages, contract.defaults.captionLanguage as Music3CaptionLanguage);
  const meter = enumValue<Music3Meter>(d.meter, contract.meters, contract.defaults.meter as Music3Meter);
  const durationSeconds = Math.max(0, Math.min(300, Math.trunc(Number(d.durationSeconds) || 0)));
  const bpm = Math.max(0, Math.min(300, Math.trunc(Number(d.bpm) || 0)));
  const captionWords = Math.max(0, Math.min(1000, Math.trunc(Number(d.captionWords) || 0)));
  const editSectionOccurrence = Math.max(1, Math.min(99, Math.trunc(Number(d.editSectionOccurrence) || 1)));
  const seed = Math.trunc(Number(d.seed) || 0);
  const status = String(d.status || 'idle');
  const running = status === 'generating' || status === 'running';

  const input: Music3Input = {
    musicIdea,
    lyrics,
    lyricsMode,
    qualityMode,
    semanticMode,
    manualSemanticProfile: String(d.manualSemanticProfile || ''),
    editRequest: String(d.editRequest || ''),
    editScope,
    editSection,
    editSectionOccurrence,
    structurePreset,
    customStructure: String(d.customStructure || ''),
    language,
    customLanguage: String(d.customLanguage || ''),
    captionLanguage,
    meter,
    customMeter: String(d.customMeter || ''),
    durationSeconds,
    bpm,
    keyScale: String(d.keyScale || ''),
    captionWords,
    constraints: String(d.constraints || ''),
    seed,
  };
  const requestEstimate = estimateMusic3ProviderRequests(input);

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
  const savedExternalMissing = wantsExternal && !providerSelection.available;
  const isExternal = wantsExternal && providerSelection.available && !!providerSelection.provider;
  const llmApiSource = d.llmApiSource === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
  const isSeedanceNz = !isExternal && llmApiSource === 'seedance-nz';
  const savedSeedanceModel = String(d.providerModel || '').trim();
  const savedSeedanceModelMissing = isSeedanceNz && !!savedSeedanceModel && !SEEDANCE_NZ_LLM_MODELS.includes(savedSeedanceModel);
  const seedanceModel = SEEDANCE_NZ_LLM_MODELS.includes(savedSeedanceModel) ? savedSeedanceModel : MINIMAX_MUSIC3_DEFAULT_MODEL;
  const zhenzhenModel = String(d.model || DEFAULT_ZHENZHEN_MODEL);
  const externalModels = providerSelection.provider ? advancedProviderModelOptions(providerSelection.provider, 'llm') : [];
  const savedExternalModel = String(d.providerModel || '').trim();
  const savedExternalModelMissing = isExternal && !!savedExternalModel && !externalModels.includes(savedExternalModel);
  const externalModel = savedExternalModelMissing ? savedExternalModel : providerSelection.providerModel || externalModels[0] || '';
  const activeProvider = isExternal && providerSelection.provider ? providerSelection.provider.id : isSeedanceNz ? 'seedance-nz' : 'zhenzhen';
  const activeModel = isExternal ? externalModel : isSeedanceNz ? seedanceModel : zhenzhenModel;
  const providerLabel = isExternal && providerSelection.provider ? providerSelection.provider.label || providerSelection.provider.id : isSeedanceNz ? '贞贞的平价AI小屋' : '贞贞的AI工坊';

  const runEnhancer = async (reporter?: RunNodeLifecycleReporter) => {
    setLocalError('');
    if (!reporter?.runContext?.runId || !reporter.nodeRunId) throw new Error('无法建立持久 Run/Attempt，已停止调用 LLM。');
    if (savedExternalMissing) throw new Error('当前画布保存的扩展 LLM 平台不存在或未启用，请重新选择平台。');
    if (savedExternalModelMissing) throw new Error(`当前扩展 LLM 平台已不再提供保存的模型“${savedExternalModel}”，请明确重新选择模型。`);
    if (savedSeedanceModelMissing) throw new Error(`贞贞的平价AI小屋已不再提供保存的模型“${savedSeedanceModel}”，请明确重新选择模型。`);
    if (!activeModel) throw new Error('当前平台没有可用的 LLM 模型。');
    const validation = validateMusic3Input(input);
    update({ status: 'generating', error: '' });
    taskCompletionSound.primeAudio();
    let cache = { ...(d.music3StageCache || {}) } as Record<string, StageCacheReceipt>;
    let providerRequestCount = 0;
    let cacheHits = 0;
    const stageReports: Music3EnhancementReport['stages'] = [];

    const runStage = async (stage: Music3StageName, messages: LlmMessage[], temperature: number, maxTokens: number) => {
      const stageDigest = await sha256Music3Text(JSON.stringify({
        stage,
        provider: activeProvider,
        model: activeModel,
        messages,
        temperature,
        maxTokens,
        seed,
        officialSkillTreeSha256: contract.officialSkill.normalizedTreeSha256,
      }));
      const cached = cache[stage];
      if (cached?.status === 'succeeded' && cached.inputDigest === stageDigest && cached.provider === activeProvider && cached.model === activeModel && cached.content) {
        cacheHits += 1;
        stageReports.push({ name: stage, status: 'cached', resultDigest: cached.resultDigest });
        await reporter.progress({ stage, cached: true });
        return cached.content;
      }
      const child = await createMusic3ChildAttempt(reporter, { provider: activeProvider, model: activeModel, stage, inputDigest: stageDigest });
      try {
        await child.providerRequest({ provider: activeProvider, model: activeModel, requestProfile: contract.requestProfile });
        await reporter.progress({ stage, cached: false });
        providerRequestCount += 1;
        const request = { model: activeModel, messages, temperature, max_tokens: maxTokens, stream: false };
        const result = isExternal && providerSelection.provider
          ? await generateExternalLlm({ ...request, providerId: providerSelection.provider.id, providerModel: externalModel, providerParams: d.providerParams || {}, timeoutMs: 5 * 60_000 }, { submissionKey: child.submissionKey })
          : await generateLlm({ ...request, source: isSeedanceNz ? 'seedance-nz' : 'zhenzhen', requestProfile: 'minimax-music3-prompt-enhancer' }, { submissionKey: child.submissionKey });
        const content = String(result.content || '').trim();
        if (!content) throw new Error(`Music 3 阶段“${stage}”没有返回内容。`);
        await child.providerResponse({ provider: activeProvider, model: activeModel, requestId: result.requestId, transportHttpStatus: result.transportHttpStatus, finishReason: result.finishReason, usage: result.usage, status: 'succeeded' });
        if (result.usage) await child.providerUsage({ provider: activeProvider, model: activeModel, requestId: result.requestId, usage: result.usage });
        const resultDigest = await sha256Music3Text(content);
        const receipt: StageCacheReceipt = { schema: 't8-music3-stage-cache-receipt-v1', stage, inputDigest: stageDigest, provider: activeProvider, model: activeModel, status: 'succeeded', content, resultDigest, requestId: result.requestId, usage: result.usage, completedAt: Date.now() };
        cache = { ...cache, [stage]: receipt };
        update({ music3StageCache: cache });
        await child.succeed({ resultDigest });
        stageReports.push({ name: stage, status: 'succeeded', resultDigest });
        return content;
      } catch (error) {
        await child.fail(error).catch(() => undefined);
        throw error;
      }
    };

    try {
      const effectiveMode = validation.effectiveLyricsMode;
      let finalLyrics = lyrics;
      if (effectiveMode === 'instrumental') {
        finalLyrics = '';
        stageReports.push({ name: 'lyrics', status: 'local' });
      } else if (effectiveMode === 'preserve') {
        finalLyrics = lyrics;
        stageReports.push({ name: 'lyrics', status: 'local' });
      } else if (effectiveMode === 'generate') {
        const response = await runStage('lyrics', buildMusic3LyricsMessages(input, 'generate') as LlmMessage[], 0.8, 8192);
        finalLyrics = parseMusic3GeneratedLyrics(response);
      } else {
        const editPlan = buildMusic3EditPlan(input);
        const response = await runStage('lyrics', buildMusic3LyricsMessages(input, 'edit', editPlan) as LlmMessage[], 0.5, 8192);
        finalLyrics = applyMusic3LyricsEdit(lyrics, editPlan, response);
      }

      let semanticProfile = '';
      if (semanticMode === 'private') {
        semanticProfile = localPrivateMusicProfile({ ...input, lyrics: finalLyrics });
        stageReports.push({ name: 'semantic-profile', status: 'local' });
      } else if (semanticMode === 'manual-profile') {
        semanticProfile = input.manualSemanticProfile.trim();
        stageReports.push({ name: 'semantic-profile', status: 'local' });
      } else {
        const response = await runStage('semantic-profile', buildMusic3SemanticMessages(input, finalLyrics) as LlmMessage[], 0.2, 1024);
        semanticProfile = parseMusic3SemanticProfile(response, finalLyrics);
      }

      let templates: string[] = [];
      let routedFamilyCount = 0;
      let selectedReferenceCount = 0;
      if (qualityMode === 'official-full') {
        const referenceContext = await loadMusic3ReferenceIndexes(input.musicIdea, semanticProfile);
        const routeResponse = await runStage('route', buildMusic3RouteMessages(input, referenceContext, semanticProfile) as LlmMessage[], 0.1, 1024);
        const selection = parseMusic3ReferenceSelection(routeResponse, referenceContext);
        templates = await loadMusic3SelectedTemplates(selection);
        routedFamilyCount = selection.families.length;
        selectedReferenceCount = templates.length;
      } else {
        stageReports.push({ name: 'route', status: 'local' });
      }

      const captionResponse = await runStage('caption', buildMusic3CaptionMessages(input, finalLyrics, semanticProfile, templates) as LlmMessage[], 0.55, 8192);
      const captionValidation = validateMusic3Caption(captionResponse);
      if (exactLyricLeak(captionValidation.caption, finalLyrics)) throw new Error('Caption 包含歌词原句，为保护歌词隐私已拒绝采用。');
      const payload = buildMusic3Payload(finalLyrics, captionValidation.caption);
      const safeTags = extractSafeMusic3Tags(finalLyrics);
      const report = buildMusic3Report({
        effectiveLyricsMode: effectiveMode,
        qualityMode,
        semanticMode,
        providerRequestCount,
        cacheHits,
        stages: stageReports,
        routedFamilyCount,
        selectedReferenceCount,
        safeTagCount: safeTags.tags.length,
        caption: captionValidation.caption,
        warnings: [...validation.warnings, ...safeTags.warnings, ...captionValidation.warnings],
      });
      const reportText = JSON.stringify(report, null, 2);
      update({
        status: 'success', error: '',
        lyricsResult: finalLyrics,
        musicCaption: captionValidation.caption,
        music3PayloadJson: payload,
        enhancementReportJson: reportText,
        outputText: captionValidation.caption,
        reply: captionValidation.caption,
        metadata: report,
        consumedTexts: [...ideaMaterials, ...lyricMaterials].map((item) => item.url).filter(Boolean),
        subflowOutputs: {
          lyrics: { outputText: finalLyrics },
          'music-caption': { outputText: captionValidation.caption },
          payload: { outputText: payload, metadata: { schema: contract.payloadSchema } },
          report: { outputText: reportText, metadata: report },
        },
        lastRun: { provider: activeProvider, model: activeModel, effectiveLyricsMode: effectiveMode, qualityMode, semanticMode, providerRequestCount, cacheHits },
      });
      await reporter.output({ outputHandles: ['lyrics', 'music-caption', 'payload', 'report'], providerRequestCount, cacheHits });
      taskCompletionSound.notifyComplete(id, 'minimax-music3-prompt-enhancer');
      logBus.success(`MiniMax Music 3 提示词增强完成 · ${providerRequestCount} 次请求 · ${cacheHits} 个缓存`, `Music3·#${id.slice(-4)}`);
    } catch (error: any) {
      const message = error?.message || 'MiniMax Music 3 提示词增强失败';
      setLocalError(message);
      update({ status: 'error', error: message, music3StageCache: cache });
      logBus.error(message, `Music3·#${id.slice(-4)}`);
      throw error;
    }
  };

  useRunTrigger(id, runEnhancer, 'minimax-music3-prompt-enhancer', { lifecycleAware: true });

  const requestRun = () => {
    setLocalError('');
    if (!requestCanvasNodeRun(id)) setLocalError('无法建立持久 Run/Attempt，已停止调用 LLM。');
  };

  const selectProvider = (value: string) => {
    if (value === 'seedance-nz') {
      update({ llmApiSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: MINIMAX_MUSIC3_DEFAULT_MODEL });
      return;
    }
    if (value === 'zhenzhen') {
      update({ llmApiSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', model: zhenzhenModel || DEFAULT_ZHENZHEN_MODEL });
      return;
    }
    const provider = llmAdvancedProviders.find((item) => item.id === value);
    if (!provider) return;
    update({ llmApiSource: 'zhenzhen', providerSource: provider.protocol, providerId: provider.id, providerModel: advancedProviderModelOptions(provider, 'llm')[0] || '' });
  };

  const outputValues: Record<OutputTab, string> = {
    lyrics: String(d.lyricsResult || ''),
    caption: String(d.musicCaption || ''),
    payload: String(d.music3PayloadJson || ''),
    report: String(d.enhancementReportJson || ''),
  };
  const output = outputValues[outputTab];
  const semanticPrivacyWarning = semanticMode === 'llm-profile';

  return (
    <InspirationVisible>
      <div className="t8-inspiration-node-shell relative w-[440px]" data-inspiration-node="minimax-music3-prompt-enhancer">
      <Handle id="music-idea" type="target" position={Position.Left} style={{ top: '34%' }} className="!h-3 !w-3 !border-2 !border-[#111117] !bg-fuchsia-300" />
      <Handle id="lyrics" type="target" position={Position.Left} style={{ top: '48%' }} className="!h-3 !w-3 !border-2 !border-[#111117] !bg-amber-300" />
      <PortLabel side="left" top="34%">创作意图</PortLabel><PortLabel side="left" top="48%">歌词</PortLabel>
      <Handle id="lyrics" type="source" position={Position.Right} style={{ top: '30%' }} className="!h-3 !w-3 !border-2 !border-[#111117] !bg-amber-300" />
      <Handle id="music-caption" type="source" position={Position.Right} style={{ top: '43%' }} className="!h-3 !w-3 !border-2 !border-[#111117] !bg-fuchsia-300" />
      <Handle id="payload" type="source" position={Position.Right} style={{ top: '56%' }} className="!h-3 !w-3 !border-2 !border-[#111117] !bg-sky-300" />
      <Handle id="report" type="source" position={Position.Right} style={{ top: '69%' }} className="!h-3 !w-3 !border-2 !border-[#111117] !bg-emerald-300" />
      <PortLabel side="right" top="30%">歌词</PortLabel><PortLabel side="right" top="43%">Caption</PortLabel><PortLabel side="right" top="56%">Payload</PortLabel><PortLabel side="right" top="69%">报告</PortLabel>
      <div className={`t8-node t8-inspiration-node overflow-hidden rounded-2xl border-2 transition ${selected ? 'border-fuchsia-400 shadow-2xl shadow-fuchsia-500/20' : 'border-white/15 hover:border-white/30'}`}>
        <div className="t8-node-header t8-inspiration-node__header flex items-center gap-2.5 border-b border-white/10 px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/30"><Music2 size={18} /></div>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-white">MiniMax Music 提示词增强器</div><div className="truncate text-[10px] text-white/40">Music 3 纯文本歌曲策划 · {providerLabel}</div></div>
          {running ? <Loader2 size={17} className="animate-spin text-fuchsia-300" /> : status === 'success' ? <CheckCircle2 size={17} className="text-emerald-400" /> : null}
        </div>
        <div className="nodrag nowheel space-y-2.5 p-3" onMouseDown={(event) => event.stopPropagation()}>
          <textarea value={String(d.musicIdea || '')} onChange={(event) => update({ musicIdea: event.target.value })} rows={3} maxLength={20000} placeholder={upstreamIdea ? '已连接创作意图；这里可补充曲风、情绪、乐器、演唱和制作要求' : '歌曲主题 / 曲风 / 情绪弧 / 乐器 / 人声 / 制作质感（必填）'} className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-fuchsia-400/60" />
          {upstreamIdea && <div className="rounded border border-fuchsia-400/20 bg-fuchsia-400/5 px-2 py-1 text-[10px] text-fuchsia-100/70">已从“创作意图”端口接收 {ideaMaterials.length} 条文本。</div>}
          <textarea value={upstreamLyrics || String(d.lyrics || '')} readOnly={!!upstreamLyrics} onChange={(event) => update({ lyrics: event.target.value })} rows={5} maxLength={50000} placeholder="可选：输入带 [Verse] / [Chorus] 标签的歌词；无歌词时默认生成" className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-amber-400/60 read-only:text-white/55" />
          {upstreamLyrics && <div className="rounded border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-[10px] text-amber-100/70">歌词由“歌词”端口提供，本地输入已锁定；严格保留模式逐字透传。</div>}
          <div className="grid grid-cols-2 gap-2">
            <div><FieldLabel>歌词模式</FieldLabel><select value={lyricsMode} onChange={(event) => update({ lyricsMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">{contract.lyricsModes.map((value) => <option key={value} value={value}>{LYRICS_MODE_LABELS[value]}</option>)}</select></div>
            <div><FieldLabel>质量模式</FieldLabel><select value={qualityMode} onChange={(event) => update({ qualityMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none"><option value="fast">快速核心（不读模板）</option><option value="official-full">官方完整（渐进披露）</option></select></div>
          </div>
          {effectiveMusic3LyricsMode(input) === 'edit' && (
            <div className="space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-2">
              <textarea value={String(d.editRequest || '')} onChange={(event) => update({ editRequest: event.target.value })} rows={2} placeholder="歌词修改要求（必填）" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none" />
              <div className="grid grid-cols-3 gap-2"><select value={editScope} onChange={(event) => update({ editScope: event.target.value })} className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-[10px] text-white"><option value="auto">自动定域</option><option value="all">全文</option><option value="section-all">全部同名段</option><option value="section-nth">指定第 N 段</option></select><select value={editSection} onChange={(event) => update({ editSection: event.target.value })} className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-[10px] text-white">{contract.sections.map((value) => <option key={value}>{SECTION_LABELS[value]}</option>)}</select><input type="number" min={1} max={99} value={editSectionOccurrence} onChange={(event) => update({ editSectionOccurrence: Number(event.target.value) })} title="第 N 个同名段落" className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /></div>
            </div>
          )}
          <button type="button" onClick={() => update({ advancedOpen: !d.advancedOpen })} className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/[0.025] px-2 py-1.5 text-[10px] font-semibold text-white/65 hover:text-white"><span>创作细节、隐私与 API 渠道</span>{d.advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
          {d.advancedOpen && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="grid grid-cols-2 gap-2"><div><FieldLabel>歌词语义策略</FieldLabel><select value={semanticMode} onChange={(event) => update({ semanticMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white"><option value="private">隐私隔离（默认）</option><option value="manual-profile">手动宽泛画像</option><option value="llm-profile">LLM 宽泛分析</option></select></div><div><FieldLabel>Caption 语言</FieldLabel><select value={captionLanguage} onChange={(event) => update({ captionLanguage: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white">{contract.captionLanguages.map((value) => <option key={value}>{value}</option>)}</select></div></div>
              {semanticMode === 'manual-profile' && <textarea value={String(d.manualSemanticProfile || '')} onChange={(event) => update({ manualSemanticProfile: event.target.value })} rows={2} maxLength={500} placeholder="只写宽泛情绪、能量弧、人声强度和粗粒度文化/曲风画像；不要引用歌词" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" />}
              <div className={`rounded border px-2 py-1.5 text-[10px] leading-4 ${semanticPrivacyWarning ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100/80'}`}><ShieldCheck size={11} className="mr-1 inline" />{semanticPrivacyWarning ? '已明确启用 LLM 歌词语义分析：该独立阶段会向当前渠道发送歌词；Caption 阶段仍只接收宽泛画像和安全标签。' : '默认隐私隔离：Caption 与模板选择阶段不发送歌词正文；仅发送创作意图、宽泛画像和安全段落标签。'}</div>
              <div className="grid grid-cols-2 gap-2"><div><FieldLabel>歌曲结构</FieldLabel><select value={structurePreset} onChange={(event) => update({ structurePreset: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white"><option value="auto">自动</option><option value="verse-chorus">Verse → Chorus</option><option value="pop-full">Verse → Pre → Chorus → Bridge</option><option value="custom">自定义</option></select></div><div><FieldLabel>歌词语言</FieldLabel><select value={language} onChange={(event) => update({ language: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white">{contract.languages.map((value) => <option key={value}>{value}</option>)}</select></div></div>
              {structurePreset === 'custom' && <input value={String(d.customStructure || '')} onChange={(event) => update({ customStructure: event.target.value })} placeholder="Intro → Verse → Chorus → Outro" className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" />}
              {language === 'custom' && <input value={String(d.customLanguage || '')} onChange={(event) => update({ customLanguage: event.target.value })} placeholder="自定义歌词语言" className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" />}
              <div className="grid grid-cols-4 gap-2"><div><FieldLabel>时长</FieldLabel><input type="number" min={0} max={300} value={durationSeconds} onChange={(event) => update({ durationSeconds: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /></div><div><FieldLabel>BPM</FieldLabel><input type="number" min={0} max={300} value={bpm} onChange={(event) => update({ bpm: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /></div><div><FieldLabel>拍号</FieldLabel><select value={meter} onChange={(event) => update({ meter: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-1 py-1.5 text-xs text-white">{contract.meters.map((value) => <option key={value}>{value}</option>)}</select></div><div><FieldLabel>Caption 词数</FieldLabel><input type="number" min={0} max={1000} step={50} value={captionWords} onChange={(event) => update({ captionWords: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /></div></div>
              {meter === 'custom' && <input value={String(d.customMeter || '')} onChange={(event) => update({ customMeter: event.target.value })} placeholder="自定义拍号" className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" />}
              <div className="grid grid-cols-2 gap-2"><input value={String(d.keyScale || '')} onChange={(event) => update({ keyScale: event.target.value })} placeholder="调性 / 音阶（可空）" className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /><input type="number" value={seed} onChange={(event) => update({ seed: Number(event.target.value) })} placeholder="Seed" className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /></div>
              <textarea value={String(d.constraints || '')} onChange={(event) => update({ constraints: event.target.value })} rows={2} placeholder="必须保留 / 禁止元素 / 制作限制" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
              <div><FieldLabel>渠道</FieldLabel><select value={isExternal ? providerSelection.providerId : isSeedanceNz ? 'seedance-nz' : 'zhenzhen'} onChange={(event) => selectProvider(event.target.value)} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white"><option value="seedance-nz">贞贞的平价AI小屋（默认）</option><option value="zhenzhen">贞贞的AI工坊 · 独立 LLM Key</option>{llmAdvancedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}</select></div>
              <div><FieldLabel>模型</FieldLabel>{isExternal ? <select value={externalModel} onChange={(event) => update({ providerModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white">{externalModels.map((model) => <option key={model}>{model}</option>)}</select> : isSeedanceNz ? <select value={seedanceModel} onChange={(event) => update({ providerModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white">{SEEDANCE_NZ_LLM_MODELS.map((model) => <option key={model}>{model}</option>)}</select> : <select value={zhenzhenModel} onChange={(event) => update({ model: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white">{ZHENZHEN_LLM_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>}</div>
              {(savedExternalMissing || savedExternalModelMissing || savedSeedanceModelMissing) && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的平台或模型已不可用；运行会失败关闭，不会静默切换。</div>}
            </div>
          )}
          <div className="rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-2 text-[10px] leading-4 text-white/45"><div className="flex items-center justify-between"><span>本次预计</span><span className="font-semibold text-fuchsia-200">{requestEstimate.label}</span></div><div>每次调用都是独立持久 Attempt；成功阶段可恢复复用，模糊提交不会自动重放。</div></div>
          {(localError || d.error) && <div className="flex items-start gap-1.5 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2 py-1.5 text-[10px] leading-4 text-rose-100"><AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{localError || String(d.error)}</span></div>}
          <button type="button" onClick={requestRun} disabled={running} className="flex w-full items-center justify-center gap-2 rounded-lg bg-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50">{running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{running ? '正在分阶段增强…' : '增强歌词与 Music 3 Caption'}</button>
          {Object.values(outputValues).some(Boolean) && (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-2">
              <div className="mb-1.5 flex items-center gap-1">{(['lyrics', 'caption', 'payload', 'report'] as OutputTab[]).map((tab) => <button key={tab} type="button" onClick={() => setOutputTab(tab)} className={`rounded px-2 py-1 text-[9px] ${outputTab === tab ? 'bg-emerald-400/20 text-emerald-100' : 'text-white/40 hover:text-white'}`}>{tab === 'lyrics' ? '歌词' : tab === 'caption' ? 'Caption' : tab === 'payload' ? 'Payload' : '报告'}</button>)}<button type="button" onClick={() => navigator.clipboard?.writeText(output)} className="ml-auto inline-flex items-center gap-1 text-[10px] text-white/45 hover:text-white">{outputTab === 'payload' || outputTab === 'report' ? <FileJson2 size={11} /> : <Clipboard size={11} />}复制</button></div>
              <textarea readOnly value={output} rows={8} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] leading-5 text-white/80 outline-none" />
            </div>
          )}
        </div>
      </div>
      </div>
    </InspirationVisible>
  );
}

export default memo(MiniMaxMusic3PromptEnhancerNode);
