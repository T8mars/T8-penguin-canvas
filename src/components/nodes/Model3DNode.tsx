import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Download, Loader2, Play, Square } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { queryHunyuan3D, submitHunyuan3D, type Hunyuan3DModel } from '../../services/generation';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';

export const MODEL_3D_TABS = [{ id: 'hunyuan-3d', label: 'Hunyuan 3D' }] as const;
const MODELS: Array<{ value: Hunyuan3DModel; labelKey: string }> = [
  { value: 'hunyuan3d-v3.1-text-to-3d', labelKey: 'model3d.textModel' },
  { value: 'hunyuan3d-v3.1-image-to-3d', labelKey: 'model3d.imageModel' },
];
const VIEW_KEYS = ['front', 'left', 'right', 'back', 'top', 'bottom', 'frontLeft', 'frontRight'];
const delay = (ms: number, signal?: AbortSignal, stoppedMessage = 'Stopped') => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(signal.reason || new Error(stoppedMessage)); }, { once: true });
});

function Model3DNode({ id, data, selected }: NodeProps) {
  const { t } = useTranslation('nodes');
  const d = data as Record<string, any>;
  const update = useUpdateNodeData(id);
  const upstream = useUpstreamMaterials(id);
  const orderedImages = useOrderedMaterials(upstream.images, Array.isArray(d?.materialOrder) ? d.materialOrder : []);
  const [localError, setLocalError] = useState('');
  const activeTab = d?.threeDTab === 'hunyuan-3d' ? d.threeDTab : 'hunyuan-3d';
  const model: Hunyuan3DModel = d?.model === 'hunyuan3d-v3.1-image-to-3d' ? d.model : 'hunyuan3d-v3.1-text-to-3d';
  const prompt = String(d?.prompt || '');
  const faceCount = Math.max(10000, Math.min(1500000, Number(d?.faceCount) || 500000));
  const enablePbr = d?.enablePbr === true;
  const generateType: 'Normal' | 'Geometry' | 'Sketch' = ['Normal', 'Geometry', 'Sketch'].includes(d?.generateType) ? d.generateType : 'Normal';
  const images = useMemo(() => orderedImages.slice(0, 8).map((item) => item.url).filter(Boolean), [orderedImages]);
  const busy = ['submitting', 'polling', 'running', 'materializing'].includes(String(d?.status || ''));

  const run = async (reporter?: RunNodeLifecycleReporter) => {
    setLocalError('');
    if (!prompt.trim()) throw new Error(t('model3d.promptRequired'));
    if (model.endsWith('text-to-3d') && images.length) throw new Error(t('model3d.textRejectsImages'));
    if (model.endsWith('image-to-3d') && (images.length < 1 || images.length > 8)) throw new Error(t('model3d.imageCount'));
    update({ status: 'submitting', error: '', progress: '0%', modelUrl: '', modelUrls: [] });
    try {
      await reporter?.providerRequest({ provider: 'seedance-nz-3d', model });
      const submitted = await submitHunyuan3D({ model, prompt: prompt.trim(), face_count: faceCount, enable_pbr: enablePbr, generate_type: generateType, images: images.length ? images : undefined }, { submissionKey: reporter?.providerSubmissionKey, signal: reporter?.signal });
      await reporter?.providerSubmitted({ provider: 'seedance-nz-3d', model, upstreamTaskId: submitted.taskId, requestId: submitted.requestId, transportHttpStatus: submitted.transportHttpStatus, upstreamHttpStatus: submitted.upstreamHttpStatus });
      update({ status: 'polling', taskId: submitted.taskId, taskProvider: 'seedance-nz-3d', progress: '0%' });
      for (let pollCount = 1; pollCount <= 900; pollCount += 1) {
        const result = await queryHunyuan3D(submitted.taskId, { signal: reporter?.signal });
        await reporter?.providerPolling({ provider: 'seedance-nz-3d', model, upstreamTaskId: submitted.taskId, pollCount, status: result.status });
        update({ status: result.status === 'materializing' ? 'materializing' : 'polling', progress: result.progress || '' });
        if (result.status === 'completed') {
          const modelUrls = (result.modelUrls || result.urls || [result.modelUrl]).filter(Boolean) as string[];
          if (!modelUrls.length) throw new Error(t('model3d.missingOutput'));
          update({ status: 'success', progress: '100%', modelUrl: modelUrls[0], modelUrls, urls: modelUrls, lastPrompt: prompt.trim(), error: '' });
          await reporter?.providerResponse({ provider: 'seedance-nz-3d', model, upstreamTaskId: submitted.taskId, pollCount, status: 'succeeded' });
          await reporter?.output({ modelUrls, outputCount: modelUrls.length });
          return;
        }
        if (result.status === 'failed') throw new Error(result.error || result.failReason || t('model3d.taskFailed'));
        await reporter?.polling({ progress: result.progress || '', pollCount });
        await delay(Math.max(800, Number(result.retryAfterMs) || 2000), reporter?.signal, t('model3d.stopped'));
      }
      throw new Error(t('model3d.timedOut'));
    } catch (error: any) {
      const message = error?.message || String(error);
      setLocalError(message);
      update({ status: 'error', error: message });
      throw error;
    }
  };

  useRunTrigger(id, run, 'model-3d', { lifecycleAware: true });

  return <div className={`w-[360px] rounded-2xl border-2 bg-zinc-950/95 text-white shadow-xl ${selected ? 'border-violet-400' : 'border-violet-400/35'}`}>
    <Handle type="target" position={Position.Left} className="!bg-violet-400 !border-0" />
    <Handle type="source" position={Position.Right} className="!bg-violet-400 !border-0" />
    <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5"><Box size={18} className="text-violet-300" /><div className="flex-1"><div className="font-semibold">3D</div><div className="text-[10px] text-white/45">{t('model3d.subtitle')}</div></div></div>
    <div className="p-3 space-y-3 nodrag">
      <div className="flex gap-1 rounded-lg bg-white/5 p-1">{MODEL_3D_TABS.map((tab) => <button key={tab.id} type="button" onClick={() => update({ threeDTab: tab.id })} className={`flex-1 rounded px-2 py-1.5 text-xs ${activeTab === tab.id ? 'bg-violet-500/25 text-violet-100' : 'text-white/45'}`}>{tab.label}</button>)}</div>
      <select value={model} onChange={(e) => update({ model: e.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-xs">{MODELS.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}</select>
      <textarea value={prompt} onChange={(e) => update({ prompt: e.target.value })} placeholder={t('model3d.promptPlaceholder')} className="h-24 w-full resize-none rounded-lg border border-white/10 bg-white/5 p-2 text-xs outline-none focus:border-violet-300/60" />
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-white/50">{t('model3d.faceCount')}<input type="number" min={10000} max={1500000} step={10000} value={faceCount} onChange={(e) => update({ faceCount: Number(e.target.value) })} className="mt-1 w-full rounded border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white" /></label><label className="text-[10px] text-white/50">{t('model3d.generationType')}<select value={generateType} onChange={(e) => update({ generateType: e.target.value })} className="mt-1 w-full rounded border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white">{['Normal','Geometry','Sketch'].map((v) => <option key={v}>{v}</option>)}</select></label></div>
      <label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={enablePbr} onChange={(e) => update({ enablePbr: e.target.checked })} className="accent-violet-400" />{t('model3d.pbr')}</label>
      {model.endsWith('image-to-3d') && <div className="rounded-lg border border-violet-300/20 bg-violet-500/5 p-2 text-[10px] text-white/55"><div>{t('model3d.connectedImages', { count: images.length })}</div><div className="mt-1 text-white/35">{t('model3d.viewOrder', { views: VIEW_KEYS.map((key) => t(`model3d.views.${key}`)).join(' → ') })}</div></div>}
      {(localError || d?.error) && <div className="rounded border border-red-400/30 bg-red-500/10 p-2 text-[10px] text-red-200">{localError || d.error}</div>}
      {d?.modelUrl && <a href={d.modelUrl} download className="flex items-center justify-center gap-1 rounded border border-white/10 px-2 py-1.5 text-xs text-white/70"><Download size={13}/>{t('model3d.download')}</a>}
      <button type="button" disabled={busy} onClick={() => { if (!requestCanvasNodeRun(id)) setLocalError(t('model3d.runFailed')); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-300 py-2.5 font-semibold text-zinc-950 disabled:opacity-40">{busy ? <><Loader2 size={16} className="animate-spin"/>{t('model3d.generating', { progress: d?.progress || '' })}</> : <><Play size={16}/>{t('model3d.generate')}</>}</button>
      {busy && <div className="flex items-center gap-1 text-[10px] text-white/35"><Square size={10}/>{t('model3d.successGate')}</div>}
    </div>
  </div>;
}

export default memo(Model3DNode);
