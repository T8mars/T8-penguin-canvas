import { memo, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Image as ImageIcon,
  Loader2,
  Music2,
  Play,
  Sparkles,
  Video,
} from 'lucide-react';
import {
  queryMinimaxH3ContextIr,
  submitMinimaxH3ContextIr,
  type MinimaxH3ContextIrModel,
} from '../../services/generation';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { logBus } from '../../stores/logs';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useUpdateNodeData } from './useUpdateNodeData';
import InspirationVisible from '../../i18n/InspirationVisible';

const MODELS: ReadonlyArray<{ value: MinimaxH3ContextIrModel; label: string; mode: string }> = [
  { value: 'minmax-h3-context-ir-text', label: 'Text · 纯文本增强', mode: 'text' },
  { value: 'minmax-h3-context-ir-image', label: 'Image · 首尾帧增强', mode: 'image' },
  { value: 'minmax-h3-context-ir-multimodal', label: 'Multimodal · 多模态增强', mode: 'multimodal' },
];
const TEXT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
const MULTIMODAL_RATIOS = ['api_default', 'adaptive', ...TEXT_RATIOS] as const;
const PROVIDER = 'seedance-nz';
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1_000;

function abortableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('节点运行已停止'));
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(done, ms);
    const onAbort = () => done(signal?.reason || new Error('节点运行已停止'));
    function done(error?: unknown) {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[10px] font-semibold text-white/50">{children}</label>;
}

function MinimaxH3OfficialPromptEnhancerNode({ id, data, selected }: NodeProps) {
  const d = (data || {}) as any;
  const update = useUpdateNodeData(id);
  const upstream = useUpstreamMaterials(id);
  const [localError, setLocalError] = useState('');
  const model = MODELS.some((item) => item.value === d.model)
    ? d.model as MinimaxH3ContextIrModel
    : 'minmax-h3-context-ir-text';
  const mode = MODELS.find((item) => item.value === model)?.mode || 'text';
  const duration = Math.max(4, Math.min(15, Math.trunc(Number(d.duration) || 4)));
  const savedRatio = String(d.ratio || (mode === 'multimodal' ? 'adaptive' : '16:9'));
  const ratioOptions = mode === 'multimodal' ? MULTIMODAL_RATIOS : TEXT_RATIOS;
  const ratio = ratioOptions.includes(savedRatio as any)
    ? savedRatio
    : mode === 'multimodal' ? 'adaptive' : '16:9';
  const status = String(d.status || 'idle');
  const running = status === 'submitting' || status === 'polling' || status === 'running';
  const resultText = String(d.resultText || d.enhancedPrompt || '');
  const upstreamPrompt = useMemo(
    () => upstream.texts.map((item) => item.url).filter(Boolean).join('\n\n').trim(),
    [upstream.texts],
  );
  const effectivePrompt = [upstreamPrompt, String(d.userPrompt || '').trim()].filter(Boolean).join('\n\n');
  const images = useMemo(() => upstream.images.map((item) => item.url).filter(Boolean), [upstream.images]);
  const videos = useMemo(() => upstream.videos.map((item) => item.url).filter(Boolean), [upstream.videos]);
  const audios = useMemo(() => upstream.audios.map((item) => item.url).filter(Boolean), [upstream.audios]);

  const validate = () => {
    if (!effectivePrompt) throw new Error('请填写待增强的视频提示词，或连接上游文本。');
    if (effectivePrompt.length > 7000) throw new Error(`提示词不能超过 7000 字符（当前 ${effectivePrompt.length}）。`);
    if (mode === 'image') {
      if (images.length < 1 || images.length > 2) throw new Error('Image 模式必须连接 1-2 张首帧/尾帧图片。');
      if (videos.length || audios.length) throw new Error('Image 模式不接受视频或音频素材。');
    }
    if (mode === 'multimodal') {
      if (!images.length && !videos.length && !audios.length) throw new Error('Multimodal 模式至少连接 1 个图片、视频或音频素材。');
      if (images.length > 9) throw new Error('Multimodal 模式最多支持 9 张图片。');
      if (videos.length > 3) throw new Error('Multimodal 模式最多支持 3 个视频。');
      if (audios.length > 3) throw new Error('Multimodal 模式最多支持 3 个音频。');
    }
  };

  const pollTask = async (
    taskId: string,
    reporter: RunNodeLifecycleReporter | undefined,
    startedAt: number,
  ) => {
    let pollCount = 0;
    let consecutiveFailures = 0;
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await abortableDelay(POLL_INTERVAL_MS, reporter?.signal);
      let result;
      try {
        result = await queryMinimaxH3ContextIr(taskId, { signal: reporter?.signal });
        consecutiveFailures = 0;
      } catch (error) {
        if (reporter?.signal?.aborted) throw error;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 5) throw error;
        continue;
      }
      pollCount += 1;
      const progress = String(result.progress || '');
      update({ status: 'polling', progress });
      await reporter?.polling({
        provider: PROVIDER,
        model,
        upstreamTaskId: taskId,
        pollCount,
        progress,
      });
      if (result.status === 'succeeded') {
        const enhancedPrompt = String(result.resultText || '').trim();
        if (!enhancedPrompt) throw new Error('任务已完成，但 Provider 未返回 result_text。');
        if (result.usage) {
          await reporter?.providerUsage({ provider: PROVIDER, model, usage: result.usage });
        }
        await reporter?.providerResponse({
          provider: PROVIDER,
          model,
          upstreamTaskId: taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          pollCount,
          status: 'succeeded',
        });
        return enhancedPrompt;
      }
      if (result.status === 'failed') {
        update({ taskId: '', progress: '', status: 'error' });
        await reporter?.providerResponse({
          provider: PROVIDER,
          model,
          upstreamTaskId: taskId,
          requestId: result.requestId,
          transportHttpStatus: result.transportHttpStatus,
          upstreamHttpStatus: result.upstreamHttpStatus,
          pollCount,
          status: 'failed',
        });
        throw new Error(result.failReason || 'MiniMax H3 官方提示词增强失败。');
      }
    }
    throw new Error('MiniMax H3 官方提示词增强轮询超过 30 分钟，请稍后按原任务继续查询。');
  };

  const runEnhancer = async (reporter?: RunNodeLifecycleReporter) => {
    setLocalError('');
    validate();
    taskCompletionSound.primeAudio();
    const startedAt = Date.now();
    // Any accepted task is resumed by taskId, including after STOP, query timeouts,
    // renderer reloads, or lifecycle-reporting failures. A paid submission is never
    // replayed merely because the local status changed to error/idle.
    let taskId = String(d.taskId || '').trim();
    try {
      if (!taskId) {
        update({ status: 'submitting', error: '', progress: '', resultText: '' });
        await reporter?.providerRequest({ provider: PROVIDER, model });
        const submitted = await submitMinimaxH3ContextIr({
          model,
          prompt: effectivePrompt,
          duration,
          ...(mode === 'text' || mode === 'multimodal' ? { ratio } : {}),
          ...(mode === 'image' || mode === 'multimodal' ? { images } : {}),
          ...(mode === 'multimodal' ? { videos, audios } : {}),
        }, {
          submissionKey: reporter?.providerSubmissionKey,
          signal: reporter?.signal,
        });
        taskId = submitted.taskId;
        update({ status: 'polling', taskId, taskProvider: PROVIDER, model, progress: '' });
        await reporter?.providerSubmitted({
          provider: PROVIDER,
          model,
          upstreamTaskId: taskId,
          requestId: submitted.requestId,
          transportHttpStatus: submitted.transportHttpStatus,
          upstreamHttpStatus: submitted.upstreamHttpStatus,
          status: 'submitted',
        });
      }
      const enhancedPrompt = await pollTask(taskId, reporter, startedAt);
      update({
        status: 'success',
        taskId: '',
        error: '',
        progress: '100%',
        resultText: enhancedPrompt,
        enhancedPrompt,
        prompt: enhancedPrompt,
        reply: enhancedPrompt,
        consumedTexts: upstream.texts.map((item) => item.url).filter(Boolean),
        consumedImages: mode === 'text' ? [] : images,
        consumedVideos: mode === 'multimodal' ? videos : [],
        consumedAudios: mode === 'multimodal' ? audios : [],
        lastRun: { provider: PROVIDER, model, duration, ratio: mode === 'image' ? null : ratio },
      });
      taskCompletionSound.notifyComplete(id, 'minimax-h3-official-prompt-enhancer');
      logBus.success(`MiniMax H3 官方提示词增强完成 · ${enhancedPrompt.length} 字`, `H3IR·#${id.slice(-4)}`);
    } catch (error: any) {
      const stopped = reporter?.signal?.aborted;
      const message = stopped ? '节点运行已停止。' : error?.message || 'MiniMax H3 官方提示词增强失败。';
      setLocalError(message);
      update({ status: stopped ? 'idle' : 'error', error: message });
      if (!stopped) logBus.error(message, `H3IR·#${id.slice(-4)}`);
      throw error;
    }
  };

  useRunTrigger(id, runEnhancer, 'minimax-h3-official-prompt-enhancer', { lifecycleAware: true });

  return (
    <InspirationVisible>
      <div className="t8-inspiration-node-shell relative w-[390px]" data-inspiration-node="minimax-h3-official-prompt-enhancer">
      <Handle type="target" position={Position.Left} className="!z-10 !border-0 !bg-emerald-300" />
      <Handle type="source" position={Position.Right} className="!z-10 !border-0 !bg-emerald-300" />
      <div
        className={`t8-node t8-inspiration-node overflow-hidden rounded-2xl border-2 transition-all ${selected ? 'border-emerald-400 shadow-2xl shadow-emerald-500/20' : 'border-white/15 hover:border-white/30'}`}
      >
        <div className="t8-node-header t8-inspiration-node__header flex items-center gap-2.5 border-b border-white/10 px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">MiniMax H3 官方提示词增强器</div>
            <div className="truncate text-[10px] text-white/45">贞贞的平价AI小屋 · {model}</div>
          </div>
          {running ? <Loader2 size={17} className="animate-spin text-emerald-300" /> : status === 'success' ? <CheckCircle2 size={17} className="text-emerald-400" /> : null}
        </div>

        <div className="nodrag nowheel space-y-2.5 p-3" onMouseDown={(event) => event.stopPropagation()}>
          <textarea
            disabled={running}
            value={String(d.userPrompt || '')}
            onChange={(event) => update({ userPrompt: event.target.value })}
            rows={4}
            maxLength={7000}
            placeholder={upstreamPrompt ? '已连接上游文本；这里可继续补充' : '输入待增强的视频提示词（1-7000 字符）'}
            className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-emerald-400/60"
          />
          {upstreamPrompt && <div className="rounded-md border border-sky-400/20 bg-sky-400/5 px-2 py-1 text-[10px] text-sky-100/70">已合并 {upstream.texts.length} 条上游文本。</div>}

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <FieldLabel>官方模型</FieldLabel>
              <select
                disabled={running}
                value={model}
                onChange={(event) => {
                  const next = event.target.value as MinimaxH3ContextIrModel;
                  update({
                    model: next,
                    ratio: next === 'minmax-h3-context-ir-multimodal' ? 'adaptive' : '16:9',
                    taskId: '',
                    status: 'idle',
                    progress: '',
                    resultText: '',
                    enhancedPrompt: '',
                    prompt: '',
                    reply: '',
                  });
                }}
                className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none"
              >
                {MODELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>目标时长</FieldLabel>
              <select disabled={running} value={duration} onChange={(event) => update({ duration: Number(event.target.value) })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none disabled:opacity-50">
                {Array.from({ length: 12 }, (_, index) => index + 4).map((value) => <option key={value} value={value}>{value} 秒</option>)}
              </select>
            </div>
            {mode !== 'image' && (
              <div>
                <FieldLabel>画面比例</FieldLabel>
                <select disabled={running} value={ratio} onChange={(event) => update({ ratio: event.target.value })} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none disabled:opacity-50">
                  {ratioOptions.map((value) => <option key={value} value={value}>{value === 'api_default' ? '接口默认（不发送）' : value}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2 text-[10px] leading-4 text-white/55">
            {mode === 'text' && 'Text：只使用文本；比例必填，参考素材不会发送。'}
            {mode === 'image' && 'Image：必须连接 1-2 张图片，按首帧、尾帧顺序提交；不发送比例。'}
            {mode === 'multimodal' && 'Multimodal：至少 1 个素材，最多 9 图 / 3 视频 / 3 音频；比例可用 adaptive 或接口默认。'}
            <div className="mt-1 flex flex-wrap gap-2 text-white/40">
              <span className="inline-flex items-center gap-1"><ImageIcon size={11} />{images.length} 图</span>
              <span className="inline-flex items-center gap-1"><Video size={11} />{videos.length} 视频</span>
              <span className="inline-flex items-center gap-1"><Music2 size={11} />{audios.length} 音频</span>
            </div>
          </div>

          <button
            type="button"
            disabled={running}
            onClick={() => {
              setLocalError('');
              if (!requestCanvasNodeRun(id)) setLocalError('无法发起画布运行，请刷新后重试。');
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-lime-400 to-emerald-400 px-3 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? `增强中${d.progress ? ` · ${d.progress}` : ''}` : '增强为 MiniMax H3 官方提示词'}
          </button>

          {(localError || d.error) && (
            <div className="flex gap-2 rounded-lg border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-[10px] leading-4 text-red-100">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{localError || d.error}</span>
            </div>
          )}

          {resultText && (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-emerald-100/80">
                <span>增强后的提示词</span>
                <button type="button" onClick={() => navigator.clipboard?.writeText(resultText)} className="rounded p-1 text-emerald-100/60 hover:bg-white/10 hover:text-emerald-100" title="复制结果"><Clipboard size={13} /></button>
              </div>
              <textarea readOnly value={resultText} rows={6} className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] leading-5 text-white/85 outline-none" />
            </div>
          )}
        </div>
      </div>
      </div>
    </InspirationVisible>
  );
}

export { MODELS as MINIMAX_H3_CONTEXT_IR_MODEL_OPTIONS };
export default memo(MinimaxH3OfficialPromptEnhancerNode);
