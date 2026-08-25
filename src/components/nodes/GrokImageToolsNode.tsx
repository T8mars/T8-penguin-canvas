import { memo, useMemo, useState } from 'react';
import { Handle, Position, useNodeConnections, useNodesData, type NodeProps } from '@xyflow/react';
import { Loader2, Play, ScanSearch } from 'lucide-react';
import { querySeedreamNz, submitSeedreamNz } from '../../services/generation';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { useUpdateNodeData } from './useUpdateNodeData';
import NodeVisible from '../../i18n/NodeVisible';

type ToolMode = 'segment' | 'region-edit';
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(signal.reason || new Error('已停止')); }, { once: true });
});

function parseSelection(mode: string, raw: string): number[] | number[][] | Array<Record<string, any>> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('选择区域必须是有效 JSON'); }
  if (!Array.isArray(value) || !value.length) throw new Error('选择区域必须是非空 JSON 数组');
  if (mode === 'object_indices' && value.some((item) => !Number.isInteger(item) || Number(item) < 0)) throw new Error('对象序号必须是非负整数数组');
  if (mode === 'boxes' && value.some((item) => !Array.isArray(item) || !item.length || item.some((n) => !Number.isFinite(Number(n))))) throw new Error('边界框必须是数值数组组成的数组');
  if (mode === 'selection_regions' && value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('选区必须是对象数组');
  return value as any;
}

function GrokImageToolsNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>;
  const update = useUpdateNodeData(id);
  const connections = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(() => [...new Set(connections.map((item) => item.source))], [connections]);
  const upstreamNodes = useNodesData(upstreamIds);
  const [localError, setLocalError] = useState('');
  const mode: ToolMode = d?.grokToolMode === 'region-edit' ? 'region-edit' : 'segment';
  const upstreamData = useMemo(() => (Array.isArray(upstreamNodes) ? upstreamNodes : []).map((node: any) => node?.data || {}), [upstreamNodes]);
  const sourceTaskId = String(d?.sourceTaskId || upstreamData.find((item) => item?.taskId && String(item?.apiModel || item?.model || '').includes('zhenzhen-image-gk-v2'))?.taskId || '').trim();
  const imageId = String(d?.grokImageId || upstreamData.find((item) => item?.grokImageId)?.grokImageId || '').trim();
  const objects = (Array.isArray(d?.grokObjects) ? d.grokObjects : upstreamData.find((item) => Array.isArray(item?.grokObjects))?.grokObjects) || [];
  const prompt = String(d?.prompt || '');
  const selectionMode = ['object_indices', 'boxes', 'selection_regions'].includes(d?.selectionMode) ? d.selectionMode : 'object_indices';
  const selectionJson = String(d?.selectionJson || '[0]');
  const includeMaskRle = d?.includeMaskRle === true;
  const busy = ['submitting', 'polling', 'materializing'].includes(String(d?.status || ''));

  const run = async (reporter?: RunNodeLifecycleReporter) => {
    setLocalError('');
    const model = mode === 'segment' ? 'zhenzhen-image-gk-v2-segment' : 'zhenzhen-image-gk-v2-region-edit';
    if (mode === 'segment' && !sourceTaskId) throw new Error('智能分割需要连接已完成、仅生成 1 张图的 zhenzhen-image-gk-v2 节点，或手动填写任务 ID');
    if (mode === 'region-edit' && !imageId) throw new Error('区域编辑需要连接智能分割结果，或手动填写 image_id');
    if (mode === 'region-edit' && !prompt.trim()) throw new Error('区域编辑必须填写编辑指令');
    const selection = mode === 'region-edit' ? parseSelection(selectionMode, selectionJson) : null;
    update({ status: 'submitting', error: '', progress: '0%', imageUrl: '', imageUrls: [] });
    try {
      await reporter?.providerRequest({ provider: 'seedance-nz-image', model });
      const submitted = await submitSeedreamNz({
        model,
        prompt: mode === 'region-edit' ? prompt.trim() : '',
        ...(mode === 'segment' ? { operation: 'segment', source_task_id: sourceTaskId, include_mask_rle: includeMaskRle } : { operation: 'region_edit', image_id: imageId, [selectionMode]: selection }),
      } as any, { submissionKey: reporter?.providerSubmissionKey, signal: reporter?.signal });
      const taskId = String(submitted.taskId || '').trim();
      if (!taskId) throw new Error('Grok 图像工具提交成功但未返回任务 ID');
      await reporter?.providerSubmitted({ provider: 'seedance-nz-image', model, upstreamTaskId: taskId, requestId: submitted.requestId, transportHttpStatus: submitted.transportHttpStatus, upstreamHttpStatus: submitted.upstreamHttpStatus });
      update({ status: 'polling', taskId, taskProvider: 'seedance-nz-image', progress: '0%' });
      for (let pollCount = 1; pollCount <= 600; pollCount += 1) {
        const result = await querySeedreamNz(taskId, { signal: reporter?.signal });
        await reporter?.providerPolling({ provider: 'seedance-nz-image', model, upstreamTaskId: taskId, pollCount, status: result.status });
        if (result.status === 'completed') {
          if (mode === 'segment') {
            const operation = result.operationResult || {};
            if (!operation.image_id) throw new Error('分割任务完成但未返回 image_id');
            const nextObjects = Array.isArray(operation.objects) ? operation.objects : [];
            update({ status: 'success', progress: '100%', grokImageId: operation.image_id, grokObjects: nextObjects, grokSegmentationResult: operation, outputText: JSON.stringify(operation, null, 2), error: '' });
            await reporter?.output({ outputCount: nextObjects.length, imageIdPresent: true });
          } else {
            const urls = Array.isArray(result.urls) ? result.urls.filter(Boolean) : [];
            if (!urls.length) throw new Error('区域编辑完成但本机没有保存结果图片');
            update({ status: 'success', progress: '100%', imageUrl: urls[0], imageUrls: urls, urls, lastPrompt: prompt.trim(), error: '' });
            await reporter?.output({ imageUrls: urls, outputCount: urls.length });
          }
          await reporter?.providerResponse({ provider: 'seedance-nz-image', model, upstreamTaskId: taskId, pollCount, status: 'succeeded' });
          return;
        }
        if (result.status === 'failed') throw new Error(result.error || 'Grok 图像工具任务失败');
        update({ status: result.status === 'materializing' ? 'materializing' : 'polling', progress: result.progress || '' });
        await reporter?.polling({ progress: result.progress || '', pollCount });
        await delay(Math.max(800, Number(result.retryAfterMs) || 1600), reporter?.signal);
      }
      throw new Error('Grok 图像工具查询超时，远端任务已保留');
    } catch (error: any) {
      const message = error?.message || String(error);
      setLocalError(message); update({ status: 'error', error: message }); throw error;
    }
  };

  useRunTrigger(id, run, 'grok-image-tools', { lifecycleAware: true });
  const setObjectIndex = (index: number, checked: boolean) => {
    let current: number[] = [];
    try { const parsed = JSON.parse(selectionJson); if (Array.isArray(parsed)) current = parsed.filter(Number.isInteger); } catch {}
    const next = checked ? [...new Set([...current, index])].sort((a, b) => a - b) : current.filter((item) => item !== index);
    update({ selectionJson: JSON.stringify(next) });
  };

  return <NodeVisible><div className={`w-[360px] rounded-2xl border-2 bg-zinc-950/95 text-white ${selected ? 'border-sky-400' : 'border-sky-400/35'}`}>
    <Handle type="target" position={Position.Left} className="!bg-sky-400 !border-0" />
    <Handle type="source" position={Position.Right} className="!bg-sky-400 !border-0" />
    <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5"><ScanSearch size={18} className="text-sky-300"/><div><div className="font-semibold">Grok 分割编辑</div><div className="text-[10px] text-white/45">Grok Image · 专用对象工作流</div></div></div>
    <div className="p-3 space-y-3 nodrag">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1"><button type="button" onClick={() => update({ grokToolMode: 'segment' })} className={`rounded py-1.5 text-xs ${mode === 'segment' ? 'bg-sky-500/25 text-sky-100' : 'text-white/45'}`}>智能分割</button><button type="button" onClick={() => update({ grokToolMode: 'region-edit' })} className={`rounded py-1.5 text-xs ${mode === 'region-edit' ? 'bg-sky-500/25 text-sky-100' : 'text-white/45'}`}>区域编辑</button></div>
      {mode === 'segment' ? <><label className="text-[10px] text-white/50">源任务 ID<input value={sourceTaskId} onChange={(e) => update({ sourceTaskId: e.target.value })} placeholder="优先从上游自动读取" className="mt-1 w-full rounded border border-white/10 bg-zinc-900 px-2 py-2 text-xs"/></label><label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={includeMaskRle} onChange={(e) => update({ includeMaskRle: e.target.checked })} className="accent-sky-400"/>包含 mask RLE（数据量更大）</label></> : <><label className="text-[10px] text-white/50">image_id<input value={imageId} onChange={(e) => update({ grokImageId: e.target.value })} placeholder="从分割节点自动读取" className="mt-1 w-full rounded border border-white/10 bg-zinc-900 px-2 py-2 text-xs"/></label><textarea value={prompt} onChange={(e) => update({ prompt: e.target.value })} placeholder="描述选中区域如何修改" className="h-20 w-full resize-none rounded border border-white/10 bg-white/5 p-2 text-xs"/><select value={selectionMode} onChange={(e) => update({ selectionMode: e.target.value, selectionJson: e.target.value === 'object_indices' ? '[0]' : '[]' })} className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-2 text-xs"><option value="object_indices">按分割对象序号</option><option value="boxes">按边界框 boxes</option><option value="selection_regions">按 selection_regions</option></select>{selectionMode === 'object_indices' && objects.length > 0 ? <div className="max-h-32 space-y-1 overflow-auto rounded border border-white/10 p-2">{objects.map((object: any, index: number) => { const checked = (() => { try { return JSON.parse(selectionJson).includes(index); } catch { return false; } })(); return <label key={index} className="flex items-center gap-2 text-[10px] text-white/65"><input type="checkbox" checked={checked} onChange={(e) => setObjectIndex(index, e.target.checked)} className="accent-sky-400"/>#{index} {String(object?.label || object?.name || object?.class_name || '对象')}</label>; })}</div> : <textarea value={selectionJson} onChange={(e) => update({ selectionJson: e.target.value })} className="h-20 w-full resize-none rounded border border-white/10 bg-white/5 p-2 font-mono text-[10px]"/>}</>}
      {mode === 'segment' && d?.grokImageId && <div className="rounded border border-emerald-400/20 bg-emerald-500/10 p-2 text-[10px] text-emerald-100">已识别 {Array.isArray(d?.grokObjects) ? d.grokObjects.length : 0} 个对象；image_id 已持久化，可连接区域编辑。</div>}
      {(localError || d?.error) && <div className="rounded border border-red-400/30 bg-red-500/10 p-2 text-[10px] text-red-200">{localError || d.error}</div>}
      <button type="button" disabled={busy} onClick={() => { if (!requestCanvasNodeRun(id)) setLocalError('无法发起画布运行'); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-300 to-cyan-300 py-2.5 font-semibold text-zinc-950 disabled:opacity-40">{busy ? <><Loader2 size={16} className="animate-spin"/>处理中 {d?.progress || ''}</> : <><Play size={16}/>{mode === 'segment' ? '执行智能分割' : '执行区域编辑'}</>}</button>
    </div>
  </div></NodeVisible>;
}

export default memo(GrokImageToolsNode);
