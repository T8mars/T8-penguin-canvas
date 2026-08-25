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
  Sparkles,
} from 'lucide-react';
import { LLM_MODELS } from '../../providers/models';
import {
  generateExternalLlm,
  generateLlm,
  type LlmMessage,
} from '../../services/generation';
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
  buildMiniMaxH3Messages,
  MINIMAX_H3_DEFAULT_MODEL,
  MINIMAX_H3_PROMPT_ENHANCER_CONTRACT,
  MINIMAX_H3_TASK_LABELS,
  miniMaxH3Temperature,
  reorderMiniMaxH3OutputFields,
  validateMiniMaxH3Input,
  type MiniMaxH3Input,
  type MiniMaxH3OutputLanguage,
  type MiniMaxH3PromptMode,
  type MiniMaxH3OfficialSkillProfile,
  type MiniMaxH3CreativePreset,
  type MiniMaxH3RewriteMode,
  type MiniMaxH3TaskType,
} from '../../utils/minimaxH3PromptEnhancer';
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
const MV_CREATIVE_PRESET = 'MV / 歌词贴字';
const MV_PROMPT_PLACEHOLDER = [
  'MV类型 / 视觉风格：',
  '数字人身份、外观与表演（可空）：',
  '歌词原文（逐字保留，可空）：',
  '演唱者或离屏人声：',
  '源歌曲区间（可空，如 01:04.000-01:19.000）：',
  '当前选段是否作为完整最终音轨：',
  '已知 BPM、时间点或节拍事件（可空）：',
  '承接开场状态与末帧交接（可空）：',
  '字体包装与禁止项：',
].join('\n');
const MV_REFERENCE_PLACEHOLDER = '<Picture 1>=数字人身份与外观；<Picture 2>=场景与灯光；<Picture 3>=字体包装，只参考字体、版式和动效。';
const MV_CONSTRAINTS_PLACEHOLDER = '例如：不新增或改写歌词；不遮挡眼睛和关键口型；固定保留服装；源歌曲区间只用于选段，镜头时间从 00:00.000 开始。';
const MV_TEMPLATE_PLACEHOLDER = '参考模板（只迁移镜头组织、运镜、转场与视觉语法；不复制人物、歌词、BPM、源歌曲区间、剧情或镜头数）';

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[10px] font-semibold text-white/50">{children}</label>;
}

function MiniMaxH3PromptEnhancerNode({ id, data, selected }: NodeProps) {
  const update = useUpdateNodeData(id);
  const d = (data || {}) as any;
  const upstream = useUpstreamMaterials(id);
  const [localError, setLocalError] = useState('');

  const contract = MINIMAX_H3_PROMPT_ENHANCER_CONTRACT;
  const taskType = enumValue<MiniMaxH3TaskType>(d.taskType, contract.taskTypes, contract.defaults.taskType);
  const rewriteMode = enumValue<MiniMaxH3RewriteMode>(
    d.rewriteMode,
    Object.keys(contract.rewriteModes) as MiniMaxH3RewriteMode[],
    contract.defaults.rewriteMode,
  );
  const outputLanguage = enumValue<MiniMaxH3OutputLanguage>(
    d.outputLanguage,
    contract.outputLanguages,
    contract.defaults.outputLanguage,
  );
  const promptMode = enumValue<MiniMaxH3PromptMode>(d.promptMode, contract.promptModes, contract.defaults.promptMode);
  const officialSkillProfile = enumValue<MiniMaxH3OfficialSkillProfile>(
    d.officialSkillProfile,
    contract.officialSkillProfiles,
    contract.defaults.officialSkillProfile,
  );
  const creativePreset = enumValue<MiniMaxH3CreativePreset>(
    d.creativePreset,
    contract.creativePresets,
    contract.defaults.creativePreset,
  );
  const isMvPreset = creativePreset === MV_CREATIVE_PRESET;
  const durationSeconds = Math.max(4, Math.min(15, Math.trunc(Number(d.durationSeconds) || 5)));
  const shotCount = d.shotCount === undefined || d.shotCount === null || d.shotCount === ''
    ? contract.defaults.shotCount
    : Number.isInteger(Number(d.shotCount)) ? Number(d.shotCount) : -1;
  const descriptionTarget = Math.max(0, Math.min(1000, Math.trunc(Number(d.descriptionTarget) || 0)));
  const seed = Math.trunc(Number(d.seed) || 0);
  const status = String(d.status || 'idle');
  const running = status === 'generating' || status === 'running';
  const output = String(d.enhancedPrompt || d.prompt || '');

  const advancedProviders = useApiKeysStore((state) => state.settings.advancedProviders);
  const llmAdvancedProviders = useMemo(
    () => advancedProvidersForNode(advancedProviders, 'llm'),
    [advancedProviders],
  );
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
  const wantsExternal = Boolean(
    (savedProviderSource && savedProviderSource !== 'zhenzhen')
    || (!savedProviderSource && savedProviderId),
  );
  const savedExternalMissing = wantsExternal && !providerSelection.available;
  const isExternal = wantsExternal && providerSelection.available && !!providerSelection.provider;
  const llmApiSource = d.llmApiSource === 'zhenzhen' ? 'zhenzhen' : 'seedance-nz';
  const isSeedanceNz = !isExternal && llmApiSource === 'seedance-nz';
  const savedSeedanceModel = String(d.providerModel || '').trim();
  const savedSeedanceModelMissing = isSeedanceNz
    && !!savedSeedanceModel
    && !SEEDANCE_NZ_LLM_MODELS.includes(savedSeedanceModel);
  const seedanceModel = SEEDANCE_NZ_LLM_MODELS.includes(savedSeedanceModel)
    ? savedSeedanceModel
    : MINIMAX_H3_DEFAULT_MODEL;
  const zhenzhenModel = String(d.model || DEFAULT_ZHENZHEN_MODEL);
  const externalModels = providerSelection.provider
    ? advancedProviderModelOptions(providerSelection.provider, 'llm')
    : [];
  const savedExternalModel = String(d.providerModel || '').trim();
  const savedExternalModelMissing = isExternal
    && !!savedExternalModel
    && !externalModels.includes(savedExternalModel);
  const externalModel = savedExternalModelMissing
    ? savedExternalModel
    : providerSelection.providerModel || externalModels[0] || '';
  const activeProvider = isExternal && providerSelection.provider
    ? providerSelection.provider.id
    : isSeedanceNz ? 'seedance-nz' : 'zhenzhen';
  const activeModel = isExternal ? externalModel : isSeedanceNz ? seedanceModel : zhenzhenModel;
  const providerLabel = isExternal && providerSelection.provider
    ? providerSelection.provider.label || providerSelection.provider.id
    : isSeedanceNz ? '贞贞的平价AI小屋' : '贞贞的AI工坊';

  const upstreamPrompt = useMemo(
    () => upstream.texts.map((item) => item.url).filter(Boolean).join('\n\n').trim(),
    [upstream.texts],
  );
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
      const videoEvidence = taskType === 'Ref2VA'
        ? await Promise.all(videoUrls.map(async (url) => ({ url, ...await probeVideo(url) })))
        : videoUrls.map((url) => ({ url }));
      const input: MiniMaxH3Input = {
        prompt: effectivePrompt,
        taskType,
        durationSeconds,
        shotCount,
        rewriteMode,
        descriptionTarget,
        outputLanguage,
        promptMode,
        officialSkillProfile,
        creativePreset,
        referenceTemplate: String(d.referenceTemplate || ''),
        referenceContext: String(d.referenceContext || ''),
        constraints: String(d.constraints || ''),
        images: imageUrls,
        videos: videoEvidence,
        seed,
      };
      const mediaPlan = validateMiniMaxH3Input(input);
      const messages = buildMiniMaxH3Messages(input, mediaPlan) as LlmMessage[];
      await reporter?.providerRequest({ provider: activeProvider, model: activeModel });
      logBus.info(
        `MiniMax H3 增强 · ${providerLabel} · ${activeModel} · ${taskType} · 镜头 ${shotCount || '自动'} · 图片 ${imageUrls.length} · 视频 ${videoUrls.length}`,
        `H3·#${id.slice(-4)}`,
      );

      const request = {
        model: activeModel,
        messages,
        temperature: miniMaxH3Temperature(rewriteMode),
        max_tokens: 16384,
        llmVideoMode: 'raw-base64' as const,
        videoMaxBase64Mb: 50,
        stream: false,
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
            requestProfile: 'minimax-h3-prompt-enhancer',
          }, { submissionKey: reporter?.providerSubmissionKey });
      const enhancedPrompt = reorderMiniMaxH3OutputFields(result.content, taskType);
      if (!enhancedPrompt) throw new Error('LLM 没有返回增强后的提示词。');
      if (result.usage) {
        await reporter?.providerUsage({
          provider: activeProvider,
          model: activeModel,
          requestId: result.requestId,
          usage: result.usage,
        });
      }
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
          taskType,
          shotCount,
          officialSkillProfile,
          creativePreset,
          provider: activeProvider,
          model: activeModel,
          imageCount: imageUrls.length,
          videoCount: videoUrls.length,
        },
      });
      taskCompletionSound.notifyComplete(id, 'minimax-h3-prompt-enhancer');
      logBus.success(`MiniMax H3 提示词增强完成 · ${enhancedPrompt.length} 字`, `H3·#${id.slice(-4)}`);
    } catch (error: any) {
      const message = error?.message || 'MiniMax H3 提示词增强失败';
      setLocalError(message);
      update({ status: 'error', error: message });
      logBus.error(message, `H3·#${id.slice(-4)}`);
      throw error;
    }
  };

  useRunTrigger(id, runEnhancer, 'minimax-h3-prompt-enhancer', { lifecycleAware: true });

  const requestRun = () => {
    setLocalError('');
    if (!requestCanvasNodeRun(id)) setLocalError('无法发起画布运行，请刷新后重试。');
  };

  const selectProvider = (value: string) => {
    if (value === 'seedance-nz') {
      update({
        llmApiSource: 'seedance-nz',
        providerSource: 'zhenzhen',
        providerId: '',
        providerModel: MINIMAX_H3_DEFAULT_MODEL,
      });
      return;
    }
    if (value === 'zhenzhen') {
      update({
        llmApiSource: 'zhenzhen',
        providerSource: 'zhenzhen',
        providerId: '',
        providerModel: '',
        model: zhenzhenModel || DEFAULT_ZHENZHEN_MODEL,
      });
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
      <div className="t8-inspiration-node-shell relative w-[390px]" data-inspiration-node="minimax-h3-prompt-enhancer">
      <Handle type="target" position={Position.Left} className="!border-0 !bg-violet-300 !z-10" />
      <Handle type="source" position={Position.Right} className="!border-0 !bg-violet-300 !z-10" />
      <div
        className={`t8-node t8-inspiration-node overflow-hidden rounded-2xl border-2 transition-all ${selected ? 'border-violet-400 shadow-2xl shadow-violet-500/20' : 'border-white/15 hover:border-white/30'}`}
      >
        <div className="t8-node-header t8-inspiration-node__header flex items-center gap-2.5 border-b border-white/10 px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">MiniMax H3 提示词增强器</div>
            <div className="truncate text-[10px] text-white/45">{providerLabel} · {activeModel || '未选模型'}</div>
          </div>
          {running ? <Loader2 size={17} className="animate-spin text-violet-300" /> : status === 'success' ? <CheckCircle2 size={17} className="text-emerald-400" /> : null}
        </div>

        <div className="nodrag nowheel space-y-2.5 p-3" onMouseDown={(event) => event.stopPropagation()}>
          <textarea
            value={String(d.userPrompt || '')}
            onChange={(event) => update({ userPrompt: event.target.value })}
            rows={4}
            maxLength={20000}
            placeholder={upstreamPrompt ? '已连接上游文本；这里可继续补充创意' : isMvPreset ? MV_PROMPT_PLACEHOLDER : '输入视频创意 / 提示词（必填）'}
            title={isMvPreset ? '数字人 MV 模式：歌词、源歌曲区间、BPM 和音轨复用结论只采信用户文本；节点不会声称分析音频。' : undefined}
            className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-violet-400/60"
          />
          {upstreamPrompt && <div className="rounded-md border border-sky-400/20 bg-sky-400/5 px-2 py-1 text-[10px] text-sky-100/70">已接收 {upstream.texts.length} 条上游文本，并与本地补充合并。</div>}
          {isMvPreset && (
            <div className="rounded-md border border-fuchsia-400/25 bg-fuchsia-400/[0.08] px-2 py-1.5 text-[10px] leading-4 text-fuchsia-100/80">
              数字人 MV：Ref2VA 肖像默认作为身份主体，不会误当首帧；源歌曲区间只用于分段规划，H3 镜头时间始终从 00:00.000 开始。当前节点只写提示词，不读取、转录或裁切音频。
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>生成类型</FieldLabel>
              <select value={taskType} onChange={(event) => update({ taskType: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                {contract.taskTypes.map((value) => <option key={value} value={value}>{MINIMAX_H3_TASK_LABELS[value]}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>目标时长</FieldLabel>
              <div className="flex items-center gap-1.5">
                <input type="number" min={4} max={15} value={durationSeconds} onChange={(event) => update({ durationSeconds: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none" />
                <span className="text-[10px] text-white/40">秒</span>
              </div>
            </div>
            <div>
              <FieldLabel>镜头数量</FieldLabel>
              <select
                value={shotCount}
                onChange={(event) => update({ shotCount: Number(event.target.value) })}
                aria-label="镜头数量"
                title="自动由模型结合内容、素材、时长与节奏判断；固定值要求输出对应数量的连续镜头。"
                className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none"
              >
                <option value={contract.limits.shotCount.automatic}>自动判断（默认）</option>
                {SHOT_COUNT_OPTIONS.map((value) => <option key={value} value={value}>{value} 个镜头</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>改写模式</FieldLabel>
              <select value={rewriteMode} onChange={(event) => update({ rewriteMode: event.target.value })} title="只控制扩写幅度：严格最保守、均衡补全细节、创意扩展风格；它不控制官方协议语言。" className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                <option value="strict">严格 · 0.2</option>
                <option value="balanced">均衡 · 0.7</option>
                <option value="creative">创意 · 1.2</option>
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
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-white/55">
              <span>连接素材</span>
              <span>{imageUrls.length} 图 · {videoUrls.length} 视频</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {imageUrls.slice(0, 9).map((url, index) => (
                <span key={`image-${url}`} title={url} className="inline-flex items-center gap-1 rounded border border-sky-400/20 bg-sky-400/10 px-1.5 py-1 text-[10px] text-sky-100"><ImageIcon size={10} />图 {index + 1}</span>
              ))}
              {videoUrls.slice(0, 3).map((url, index) => (
                <span key={`video-${url}`} title={url} className="inline-flex items-center gap-1 rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-1 text-[10px] text-amber-100"><Film size={10} />视频 {index + 1}</span>
              ))}
              {!imageUrls.length && !videoUrls.length && <span className="text-[10px] text-white/30">T2VA 可无素材；其他模式从左侧端口连接图片/视频。</span>}
            </div>
            <div className="mt-1.5 text-[9px] leading-4 text-white/35">
              I2VA/L2VA 取 1 图；FL2VA 按连接顺序取首帧、尾帧；Ref2VA 最多 9 图、3 视频，视频总时长不超过 15 秒。
            </div>
          </div>

          <button type="button" onClick={() => update({ advancedOpen: !d.advancedOpen })} className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/[0.025] px-2 py-1.5 text-[10px] font-semibold text-white/65 hover:text-white">
            <span>增强设置与 API 渠道</span>
            {d.advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {d.advancedOpen && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
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
                  <select value={externalModel} onChange={(event) => update({ providerModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    {externalModels.map((model) => <option key={model}>{model}</option>)}
                  </select>
                ) : isSeedanceNz ? (
                  <select value={seedanceModel} onChange={(event) => update({ providerModel: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    {SEEDANCE_NZ_LLM_MODELS.map((model) => <option key={model}>{model}</option>)}
                  </select>
                ) : (
                  <select value={zhenzhenModel} onChange={(event) => update({ model: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    {ZHENZHEN_LLM_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>提示词模式</FieldLabel>
                  <select value={promptMode} onChange={(event) => update({ promptMode: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    {contract.promptModes.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>目标长度 · 0=自动</FieldLabel>
                  <input type="number" min={0} max={1000} step={10} value={descriptionTarget} onChange={(event) => update({ descriptionTarget: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>官方 Skill 协议</FieldLabel>
                  <select value={officialSkillProfile} onChange={(event) => update({ officialSkillProfile: event.target.value })} title="默认兼容旧画布；严格协议按 MiniMax 官方 Skill 强制英文说明正文。" className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    {contract.officialSkillProfiles.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>官方创意预设</FieldLabel>
                  <select value={creativePreset} onChange={(event) => update({ creativePreset: event.target.value })} title="无、自动判断或 8 个场景写作预设；MV 预设包含数字人身份、歌词、分段本地时间与连续性规则，但不执行音频分析或制作工作流。" className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none">
                    {contract.creativePresets.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
              </div>
              {officialSkillProfile === '官方 Skill 严格（全英文协议）' && (
                <div className="rounded border border-violet-400/25 bg-violet-400/10 px-2 py-1.5 text-[10px] leading-4 text-violet-100">严格协议优先于“输出语言”，说明字段与描述正文强制英文；原始对白、歌词、品牌/UI 文案和画面文字保留原语言。</div>
              )}
              {promptMode === '参考模板融合' && <textarea value={String(d.referenceTemplate || '')} onChange={(event) => update({ referenceTemplate: event.target.value })} rows={3} placeholder={isMvPreset ? MV_TEMPLATE_PLACEHOLDER : '参考模板（必填，只借鉴结构、节奏、镜头和声音设计）'} title={isMvPreset ? MV_TEMPLATE_PLACEHOLDER : undefined} className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />}
              <textarea value={String(d.referenceContext || '')} onChange={(event) => update({ referenceContext: event.target.value })} rows={2} placeholder={isMvPreset ? MV_REFERENCE_PLACEHOLDER : '参考素材补充（身份、关系等媒体无法确认的信息）'} title={isMvPreset ? 'MV 参考素材需要窄角色映射，人物、场景和字体参考互不串用。' : undefined} className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />
              <textarea value={String(d.constraints || '')} onChange={(event) => update({ constraints: event.target.value })} rows={2} placeholder={isMvPreset ? MV_CONSTRAINTS_PLACEHOLDER : '硬性要求（必须保留 / 禁止新增或改变）'} title={isMvPreset ? MV_CONSTRAINTS_PLACEHOLDER : undefined} className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25" />
              <div>
                <FieldLabel>Variation Seed</FieldLabel>
                <input type="number" value={seed} onChange={(event) => update({ seed: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none" />
              </div>
              {savedExternalMissing && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的扩展平台不存在或未启用；运行会失败关闭，不会静默切换渠道。</div>}
              {savedExternalModelMissing && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的扩展模型已不可用；请明确重新选择，运行不会静默切换模型。</div>}
              {savedSeedanceModelMissing && <div className="rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">保存的小屋模型已不可用；请明确重新选择，运行不会静默回退模型。</div>}
            </div>
          )}

          {(localError || d.error) && <div className="flex items-start gap-1.5 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2 py-1.5 text-[10px] leading-4 text-rose-100"><AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{localError || String(d.error)}</span></div>}

          <button type="button" onClick={requestRun} disabled={running} className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? '正在增强…' : '增强为 MiniMax H3 提示词'}
          </button>

          {output && (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-emerald-100/75">增强结果 · 输出到右侧文本端口</span>
                <button type="button" onClick={() => navigator.clipboard?.writeText(output)} className="inline-flex items-center gap-1 text-[10px] text-white/45 hover:text-white"><Clipboard size={11} />复制</button>
              </div>
              <textarea readOnly value={output} rows={8} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] leading-5 text-white/80 outline-none" />
            </div>
          )}
        </div>
      </div>
      </div>
    </InspirationVisible>
  );
}

export default memo(MiniMaxH3PromptEnhancerNode);
