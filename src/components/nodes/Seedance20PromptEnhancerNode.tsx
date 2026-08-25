import { memo, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Film,
  Image as ImageIcon,
  Loader2,
  Play,
  WandSparkles,
} from 'lucide-react';
import { LLM_MODELS } from '../../providers/models';
import { generateExternalLlm, generateLlm, type LlmMessage } from '../../services/generation';
import { probeVideo } from '../../services/videoOps';
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
  buildSeedance20Messages,
  normalizeSeedance20Output,
  SEEDANCE20_DEFAULT_MODEL,
  SEEDANCE20_PROMPT_ENHANCER_CONTRACT,
  SEEDANCE20_TASK_LABELS,
  seedance20Temperature,
  validateSeedance20Input,
  type Seedance20ComplexityMode,
  type Seedance20Input,
  type Seedance20OutputDetail,
  type Seedance20OutputLanguage,
  type Seedance20PromptMode,
  type Seedance20ReferenceSyntax,
  type Seedance20RewriteMode,
  type Seedance20StabilityPolicy,
  type Seedance20SubtitlePolicy,
  type Seedance20TaskIntent,
} from '../../utils/seedance20PromptEnhancer';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { SEEDANCE_NZ_LLM_MODELS } from '../../config/llm';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useUpdateNodeData } from './useUpdateNodeData';
import InspirationVisible from '../../i18n/InspirationVisible';

const ZHENZHEN_LLM_MODELS = LLM_MODELS.filter((model) => !model.imageOutput);
const DEFAULT_ZHENZHEN_MODEL = ZHENZHEN_LLM_MODELS.find((model) => model.id === 'gemini-3.5-flash')?.id
  || ZHENZHEN_LLM_MODELS[0]?.id
  || '';
const SHOT_COUNT_OPTIONS = Array.from({ length: 20 }, (_, index) => index + 1);
const DURATION_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 4);

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[10px] font-semibold text-white/50">{children}</label>;
}

function Seedance20PromptEnhancerNode({ id, data, selected }: NodeProps) {
  const update = useUpdateNodeData(id);
  const d = (data || {}) as any;
  const upstream = useUpstreamMaterials(id);
  const [localError, setLocalError] = useState('');
  const contract = SEEDANCE20_PROMPT_ENHANCER_CONTRACT;

  const taskIntent = enumValue<Seedance20TaskIntent>(d.taskIntent, contract.taskIntents, contract.defaults.taskIntent);
  const complexityMode = enumValue<Seedance20ComplexityMode>(d.complexityMode, contract.complexityModes, contract.defaults.complexityMode);
  const rewriteMode = enumValue<Seedance20RewriteMode>(d.rewriteMode, Object.keys(contract.rewriteModes) as Seedance20RewriteMode[], contract.defaults.rewriteMode);
  const outputDetail = enumValue<Seedance20OutputDetail>(d.outputDetail, contract.outputDetails, contract.defaults.outputDetail);
  const outputLanguage = enumValue<Seedance20OutputLanguage>(d.outputLanguage, contract.outputLanguages, contract.defaults.outputLanguage);
  const promptMode = enumValue<Seedance20PromptMode>(d.promptMode, contract.promptModes, contract.defaults.promptMode);
  const referenceSyntax = enumValue<Seedance20ReferenceSyntax>(d.referenceSyntax, contract.referenceSyntaxes, contract.defaults.referenceSyntax);
  const subtitlePolicy = enumValue<Seedance20SubtitlePolicy>(d.subtitlePolicy, contract.subtitlePolicies, contract.defaults.subtitlePolicy);
  const stabilityConstraints = enumValue<Seedance20StabilityPolicy>(d.stabilityConstraints, contract.stabilityPolicies, contract.defaults.stabilityConstraints);
  const durationSeconds = d.durationSeconds === undefined || d.durationSeconds === null || d.durationSeconds === ''
    ? contract.defaults.durationSeconds
    : Number.isInteger(Number(d.durationSeconds)) ? Number(d.durationSeconds) : -1;
  const shotCount = d.shotCount === undefined || d.shotCount === null || d.shotCount === ''
    ? contract.defaults.shotCount
    : Number.isInteger(Number(d.shotCount)) ? Number(d.shotCount) : -1;
  const customLengthTarget = Math.max(0, Math.min(4000, Math.trunc(Number(d.customLengthTarget) || 0)));
  const seed = Math.trunc(Number(d.seed) || 0);
  const status = String(d.status || 'idle');
  const running = status === 'generating' || status === 'running';
  const output = String(d.enhancedPrompt || d.prompt || '');

  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const llmAdvancedProviders = useMemo(() => advancedProvidersForNode(advancedProviders, 'llm'), [advancedProviders]);
  const providerSelection = useMemo(
    () => resolveAdvancedProviderSelection(advancedProviders, 'llm', {
      providerSource: d.providerSource,
      providerId: d.providerId,
      providerModel: d.providerModel,
    }),
    [advancedProviders, d.providerSource, d.providerId, d.providerModel],
  );
  const savedProviderSource = String(d.providerSource || '').trim();
  const savedProviderId = String(d.providerId || '').trim();
  const wantsExternal = Boolean((savedProviderSource && savedProviderSource !== 'zhenzhen') || (!savedProviderSource && savedProviderId));
  const savedExternalMissing = wantsExternal && !providerSelection.available;
  const isExternal = wantsExternal && providerSelection.available && !!providerSelection.provider;
  const llmApiSource = d.llmApiSource === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
  const isSeedanceNz = !isExternal && llmApiSource === 'seedance-nz';
  const savedSeedanceModel = String(d.providerModel || '').trim();
  const savedSeedanceModelMissing = isSeedanceNz && !!savedSeedanceModel && !SEEDANCE_NZ_LLM_MODELS.includes(savedSeedanceModel);
  const seedanceModel = SEEDANCE_NZ_LLM_MODELS.includes(savedSeedanceModel) ? savedSeedanceModel : SEEDANCE20_DEFAULT_MODEL;
  const zhenzhenModel = String(d.model || DEFAULT_ZHENZHEN_MODEL);
  const externalModels = providerSelection.provider ? advancedProviderModelOptions(providerSelection.provider, 'llm') : [];
  const savedExternalModel = String(d.providerModel || '').trim();
  const savedExternalModelMissing = isExternal && !!savedExternalModel && !externalModels.includes(savedExternalModel);
  const externalModel = savedExternalModelMissing ? savedExternalModel : providerSelection.providerModel || externalModels[0] || '';
  const activeProvider = isExternal && providerSelection.provider
    ? providerSelection.provider.id
    : isSeedanceNz ? 'seedance-nz' : 'zhenzhen';
  const activeModel = isExternal ? externalModel : isSeedanceNz ? seedanceModel : zhenzhenModel;
  const providerLabel = isExternal && providerSelection.provider
    ? providerSelection.provider.label || providerSelection.provider.id
    : isSeedanceNz ? '贞贞的平价AI小屋' : '贞贞的AI工坊';

  const upstreamPrompt = useMemo(() => upstream.texts.map((item) => item.url).filter(Boolean).join('\n\n').trim(), [upstream.texts]);
  const effectivePrompt = [upstreamPrompt, String(d.userPrompt || '').trim()].filter(Boolean).join('\n\n');
  const imageUrls = useMemo(() => upstream.images.map((item) => item.url).filter(Boolean), [upstream.images]);
  const videoUrls = useMemo(() => upstream.videos.map((item) => item.url).filter(Boolean), [upstream.videos]);

  const runEnhancer = async (reporter?: RunNodeLifecycleReporter) => {
    setLocalError('');
    if (savedExternalMissing) throw new Error('当前画布保存的扩展 LLM 平台不存在或未启用，请重新选择平台。');
    if (savedExternalModelMissing) throw new Error(`当前扩展 LLM 平台已不再提供保存的模型“${savedExternalModel}”，请明确重新选择模型。`);
    if (savedSeedanceModelMissing) throw new Error(`贞贞的平价AI小屋已不再提供保存的模型“${savedSeedanceModel}”，请明确重新选择模型。`);
    if (!activeModel) throw new Error('当前平台没有可用的 LLM 模型。');

    update({ status: 'generating', error: '' });
    taskCompletionSound.primeAudio();
    try {
      const videoEvidence = await Promise.all(videoUrls.map(async (url) => ({ url, ...await probeVideo(url) })));
      const input: Seedance20Input = {
        prompt: effectivePrompt,
        taskIntent,
        complexityMode,
        durationSeconds,
        shotCount,
        rewriteMode,
        outputDetail,
        outputLanguage,
        promptMode,
        referenceSyntax,
        subtitlePolicy,
        stabilityConstraints,
        customLengthTarget,
        referenceTemplate: String(d.referenceTemplate || ''),
        referenceRoles: String(d.referenceRoles || ''),
        referenceContext: String(d.referenceContext || ''),
        constraints: String(d.constraints || ''),
        images: imageUrls,
        videos: videoEvidence,
        seed,
      };
      const mediaPlan = validateSeedance20Input(input);
      const messages = buildSeedance20Messages(input, mediaPlan) as LlmMessage[];
      await reporter?.providerRequest({ provider: activeProvider, model: activeModel });
      logBus.info(
        `Seedance 2.0 增强 · ${providerLabel} · ${activeModel} · ${taskIntent} · 镜头 ${shotCount || '自动'} · 图片 ${imageUrls.length} · 视频 ${videoUrls.length}`,
        `SD2·#${id.slice(-4)}`,
      );
      const request = {
        model: activeModel,
        messages,
        temperature: seedance20Temperature(rewriteMode),
        max_tokens: 16384,
        llmVideoMode: 'raw-base64' as const,
        videoMaxBase64Mb: 50,
        stream: false,
        requestProfile: 'seedance20-prompt-enhancer' as const,
      };
      const result = isExternal && providerSelection.provider
        ? await generateExternalLlm({
            ...request,
            providerId: providerSelection.provider.id,
            providerModel: externalModel,
            providerParams: d.providerParams || {},
          }, { submissionKey: reporter?.providerSubmissionKey })
        : await generateLlm({
            ...request,
            source: isSeedanceNz ? 'seedance-nz' : 'zhenzhen',
          }, { submissionKey: reporter?.providerSubmissionKey });
      const enhancedPrompt = normalizeSeedance20Output(result.content);
      if (!enhancedPrompt) throw new Error('LLM 没有返回增强后的提示词。');
      if (result.usage) await reporter?.providerUsage({ provider: activeProvider, model: activeModel, requestId: result.requestId, usage: result.usage });
      await reporter?.providerResponse({
        provider: activeProvider,
        model: activeModel,
        requestId: result.requestId,
        transportHttpStatus: result.transportHttpStatus,
        httpStatusSource: 'local-backend',
        finishReason: result.finishReason,
        status: 'succeeded',
      });
      update({
        status: 'success',
        error: '',
        enhancedPrompt,
        prompt: enhancedPrompt,
        reply: enhancedPrompt,
        consumedTexts: upstream.texts.map((item) => item.url).filter(Boolean),
        requestId: result.requestId,
        usage: result.usage,
        lastRun: {
          taskIntent,
          durationSeconds,
          shotCount,
          provider: activeProvider,
          model: activeModel,
          imageCount: imageUrls.length,
          videoCount: videoUrls.length,
        },
      });
      taskCompletionSound.notifyComplete(id, 'seedance20-prompt-enhancer');
      logBus.success(`Seedance 2.0 提示词增强完成 · ${enhancedPrompt.length} 字`, `SD2·#${id.slice(-4)}`);
    } catch (error: any) {
      const message = error?.message || 'Seedance 2.0 提示词增强失败';
      setLocalError(message);
      update({ status: 'error', error: message });
      logBus.error(message, `SD2·#${id.slice(-4)}`);
      throw error;
    }
  };

  useRunTrigger(id, runEnhancer, 'seedance20-prompt-enhancer', { lifecycleAware: true });

  const requestRun = () => {
    setLocalError('');
    if (!requestCanvasNodeRun(id)) setLocalError('无法发起画布运行，请刷新后重试。');
  };

  const selectProvider = (value: string) => {
    if (value === 'seedance-nz') {
      update({ llmApiSource: 'seedance-nz', providerSource: 'zhenzhen', providerId: '', providerModel: SEEDANCE20_DEFAULT_MODEL });
      return;
    }
    if (value === 'zhenzhen') {
      update({ llmApiSource: 'zhenzhen', providerSource: 'zhenzhen', providerId: '', providerModel: '', model: zhenzhenModel || DEFAULT_ZHENZHEN_MODEL });
      return;
    }
    const provider = llmAdvancedProviders.find((item) => item.id === value);
    if (!provider) return;
    update({
      llmApiSource: 'zhenzhen',
      providerSource: provider.protocol,
      providerId: provider.id,
      providerModel: advancedProviderModelOptions(provider, 'llm')[0] || '',
    });
  };

  return (
    <InspirationVisible>
      <div className="t8-inspiration-node-shell relative w-[420px]" data-inspiration-node="seedance20-prompt-enhancer">
      <Handle type="target" position={Position.Left} className="!border-0 !bg-cyan-300 !z-10" />
      <Handle type="source" position={Position.Right} className="!border-0 !bg-cyan-300 !z-10" />
      <div
        className={`t8-node t8-inspiration-node overflow-hidden rounded-2xl border-2 transition-all ${selected ? 'border-cyan-400 shadow-2xl shadow-cyan-500/20' : 'border-white/15 hover:border-white/30'}`}
      >
        <div className="t8-node-header t8-inspiration-node__header flex items-center gap-2.5 border-b border-white/10 px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/30"><WandSparkles size={17} /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">Seedance 2.0 提示词增强器</div>
            <div className="truncate text-[10px] text-white/45">{providerLabel} · {activeModel || '未选模型'}</div>
          </div>
          {running ? <Loader2 size={17} className="animate-spin text-cyan-300" /> : status === 'success' ? <CheckCircle2 size={17} className="text-emerald-400" /> : null}
        </div>

        <div className="nodrag nowheel space-y-2.5 p-3" onMouseDown={(event) => event.stopPropagation()}>
          <textarea
            value={String(d.userPrompt || '')}
            onChange={(event) => update({ userPrompt: event.target.value })}
            rows={4}
            maxLength={20000}
            placeholder={upstreamPrompt ? '已连接上游文本；这里可继续补充创意' : '输入视频创意 / 提示词（必填）'}
            className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-cyan-400/60"
          />
          {upstreamPrompt && <div className="rounded-md border border-sky-400/20 bg-sky-400/5 px-2 py-1 text-[10px] text-sky-100/70">已接收 {upstream.texts.length} 条上游文本，并与本地补充合并。</div>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>任务意图</FieldLabel>
              <select value={taskIntent} onChange={(event) => update({ taskIntent: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                {contract.taskIntents.map((value) => <option key={value} value={value}>{SEEDANCE20_TASK_LABELS[value]}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>目标时长</FieldLabel>
              <select value={durationSeconds} onChange={(event) => update({ durationSeconds: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                <option value={0}>自动判断（默认）</option>
                {DURATION_OPTIONS.map((value) => <option key={value} value={value}>{value} 秒</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>镜头数量</FieldLabel>
              <select value={shotCount} onChange={(event) => update({ shotCount: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                <option value={0}>自动判断（默认）</option>
                {SHOT_COUNT_OPTIONS.map((value) => <option key={value} value={value}>{value} 个镜头</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>改写模式</FieldLabel>
              <select value={rewriteMode} onChange={(event) => update({ rewriteMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                <option value="strict">严格 · 0.2</option><option value="balanced">均衡 · 0.7</option><option value="creative">创意 · 1.2</option>
              </select>
            </div>
            <div>
              <FieldLabel>输出详略</FieldLabel>
              <select value={outputDetail} onChange={(event) => update({ outputDetail: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                <option value="auto">自动判断</option><option value="concise">精简</option><option value="standard">标准</option><option value="detailed">详细</option>
              </select>
            </div>
            <div>
              <FieldLabel>输出语言</FieldLabel>
              <select value={outputLanguage} onChange={(event) => update({ outputLanguage: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                {contract.outputLanguages.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2">
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-white/55"><span>连接素材</span><span>{imageUrls.length} 图 · {videoUrls.length} 视频</span></div>
            <div className="flex flex-wrap gap-1.5">
              {imageUrls.slice(0, 9).map((url, index) => <span key={`image-${url}`} title={url} className="inline-flex items-center gap-1 rounded border border-sky-400/20 bg-sky-400/10 px-1.5 py-1 text-[10px] text-sky-100"><ImageIcon size={10} />图 {index + 1}</span>)}
              {videoUrls.slice(0, 3).map((url, index) => <span key={`video-${url}`} title={url} className="inline-flex items-center gap-1 rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-1 text-[10px] text-amber-100"><Film size={10} />视频 {index + 1}</span>)}
              {!imageUrls.length && !videoUrls.length && <span className="text-[10px] text-white/30">T2V 可无素材；其他任务从左侧连接图片/视频。</span>}
            </div>
            <div className="mt-1.5 text-[9px] leading-4 text-white/35">FL-I2V 按连接顺序取首帧、尾帧；最多 9 图、3 视频、合计 12 项，视频总时长不超过 15 秒。不接收音频。</div>
          </div>

          <button type="button" onClick={() => update({ advancedOpen: !d.advancedOpen })} className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/[0.025] px-2 py-1.5 text-[10px] font-semibold text-white/65 hover:text-white">
            <span>增强设置与 API 渠道</span>{d.advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {d.advancedOpen && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>渠道</FieldLabel>
                  <select value={isExternal ? providerSelection.providerId : isSeedanceNz ? 'seedance-nz' : 'zhenzhen'} onChange={(event) => selectProvider(event.target.value)} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    <option value="seedance-nz">贞贞的平价AI小屋（默认）</option>
                    <option value="zhenzhen">贞贞的AI工坊 · 独立 LLM Key</option>
                    {llmAdvancedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>模型</FieldLabel>
                  {isExternal ? (
                    <select value={externalModel} onChange={(event) => update({ providerModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">{externalModels.map((model) => <option key={model}>{model}</option>)}</select>
                  ) : isSeedanceNz ? (
                    <select value={seedanceModel} onChange={(event) => update({ providerModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">{SEEDANCE_NZ_LLM_MODELS.map((model) => <option key={model}>{model}</option>)}</select>
                  ) : (
                    <select value={zhenzhenModel} onChange={(event) => update({ model: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">{ZHENZHEN_LLM_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
                  )}
                </div>
                <div>
                  <FieldLabel>复杂度</FieldLabel>
                  <select value={complexityMode} onChange={(event) => update({ complexityMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    <option value="auto">自动判断</option><option value="simple">简单一段式</option><option value="complex">复杂分镜式</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>提示词模式</FieldLabel>
                  <select value={promptMode} onChange={(event) => update({ promptMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">{contract.promptModes.map((value) => <option key={value}>{value}</option>)}</select>
                </div>
                <div>
                  <FieldLabel>引用语法</FieldLabel>
                  <select value={referenceSyntax} onChange={(event) => update({ referenceSyntax: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    <option value="official-cn">火山官方 · @图片N/@视频N</option><option value="seedance-nz-en">Seedance.nz · @Image N/@Video N</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>字幕策略</FieldLabel>
                  <select value={subtitlePolicy} onChange={(event) => update({ subtitlePolicy: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    <option value="auto">自动</option><option value="none">不要字幕</option><option value="required">需要字幕</option><option value="preserve">保留原要求</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>稳定性约束</FieldLabel>
                  <select value={stabilityConstraints} onChange={(event) => update({ stabilityConstraints: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    <option value="auto">自动</option><option value="minimal">精简</option><option value="strong">强约束</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>目标长度 · 0=自动</FieldLabel>
                  <input type="number" min={0} max={4000} step={20} value={customLengthTarget} onChange={(event) => update({ customLengthTarget: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none" />
                </div>
              </div>
              {promptMode === '参考模板融合' && <textarea value={String(d.referenceTemplate || '')} onChange={(event) => update({ referenceTemplate: event.target.value })} rows={3} placeholder="参考模板（必填；只借鉴结构、节奏、镜头、转场和声音模式）" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />}
              <textarea value={String(d.referenceRoles || '')} onChange={(event) => update({ referenceRoles: event.target.value })} rows={2} placeholder="素材角色（每项素材要借鉴什么；可选）" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />
              <textarea value={String(d.referenceContext || '')} onChange={(event) => update({ referenceContext: event.target.value })} rows={2} placeholder="参考背景（身份、关系、品牌、故事事实；可选）" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />
              <textarea value={String(d.constraints || '')} onChange={(event) => update({ constraints: event.target.value })} rows={2} placeholder="硬性要求（必须保留 / 禁止改变）" className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />
              <div><FieldLabel>Variation Seed</FieldLabel><input type="number" value={seed} onChange={(event) => update({ seed: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none" /></div>
              {savedExternalMissing && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的扩展平台不存在或未启用；运行会失败关闭，不会静默切换渠道。</div>}
              {savedExternalModelMissing && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的扩展模型已不可用；请明确重新选择，运行不会静默切换模型。</div>}
              {savedSeedanceModelMissing && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的小屋模型已不可用；请明确重新选择，运行不会静默回退模型。</div>}
            </div>
          )}

          {(localError || d.error) && <div className="flex items-start gap-1.5 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2 py-1.5 text-[10px] leading-4 text-rose-100"><AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{localError || String(d.error)}</span></div>}
          <button type="button" onClick={requestRun} disabled={running} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{running ? '正在增强…' : '增强为 Seedance 2.0 提示词'}
          </button>
          {output && (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-2">
              <div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-semibold text-emerald-100/75">增强结果 · 输出到右侧文本端口</span><button type="button" onClick={() => navigator.clipboard?.writeText(output)} className="inline-flex items-center gap-1 text-[10px] text-white/45 hover:text-white"><Clipboard size={11} />复制</button></div>
              <textarea readOnly value={output} rows={8} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] leading-5 text-white/80 outline-none" />
            </div>
          )}
        </div>
      </div>
      </div>
    </InspirationVisible>
  );
}

export default memo(Seedance20PromptEnhancerNode);
