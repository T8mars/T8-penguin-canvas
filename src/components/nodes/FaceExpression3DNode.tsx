import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Handle, Position, useNodeConnections, useNodesData, useReactFlow, useUpdateNodeInternals, type NodeProps,
} from '@xyflow/react';
import {
  Camera, CheckCircle2, ExternalLink, ImagePlus, Layers3, Loader2, ScanFace, Sparkles, X,
} from 'lucide-react';
import { PORT_COLOR } from '../../config/portTypes';
import { useThemeStore } from '../../stores/theme';
import { uploadDataUrl, uploadFileBlob } from '../../services/imageOps';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import {
  applyFaceCameraPreset,
  applyFacePreset,
  applyPhotoCalibration,
  buildFaceBatchPlan,
  defaultFaceExpressionState,
  faceExpressionMetadata,
  normalizeFaceExpressionState,
  type FaceExpression3DState,
} from '../../utils/faceExpression3D';
import { analyzeFacePhoto } from '../../utils/facePhotoAnalysis';
import FaceExpressionViewport, { type FaceExpressionViewportHandle } from '../face-expression-3d/FaceExpressionViewport';
import FaceExpression3DEditor from '../face-expression-3d/FaceExpression3DEditor';
import ResizableCorners from './ResizableCorners';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';

const handleStyle: CSSProperties = { width: 12, height: 12, border: 'none', zIndex: 20 };
const MODEL_RE = /\.(glb|gltf)(?:\?|#|$)/i;
type FaceExpressionRunMode = 'single' | 'batch';
type FaceExpressionRunTarget = 'node' | 'editor';

function collectModelUrl(data: any): string {
  const values = [data?.modelUrl, data?.directModelUrl, ...(Array.isArray(data?.modelUrls) ? data.modelUrls : []), ...(Array.isArray(data?.directModelUrls) ? data.directModelUrls : [])];
  return values.find((value) => typeof value === 'string' && (MODEL_RE.test(value) || /^data:model\/gltf/i.test(value))) || '';
}

function collectFaceMetadata(data: any): any {
  const candidates = [data?.faceExpressionMetadata, data?.metadata, data?.portraitMetadata, data?.outputMetadata];
  return candidates.find((item) => item && typeof item === 'object' && (item.schema === 't8-face-expression-state' || item.expression || item.model)) || null;
}

function outputPrefix(state: FaceExpression3DState, suffix = '') {
  const preset = state.expression.presetId || 'custom';
  return `face-expression-${preset}${suffix ? `-${suffix}` : ''}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 72);
}

const FaceExpression3DNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const d = (data || {}) as any;
  const update = useUpdateNodeData(id);
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';
  const state = useMemo(() => normalizeFaceExpressionState(d.faceExpression3DState || defaultFaceExpressionState()), [d.faceExpression3DState]);
  const stateRef = useRef(state);
  const viewportRef = useRef<FaceExpressionViewportHandle | null>(null);
  const pendingEditorViewportRef = useRef<{
    requestId: string;
    viewport: FaceExpressionViewportHandle;
  } | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef(0);
  const upstream = useUpstreamMaterials(id);
  const connections = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(() => Array.from(new Set(connections.map((item) => item.source).filter(Boolean))), [connections]);
  const upstreamNodes = useNodesData(upstreamIds);
  const upstreamModelUrl = useMemo(() => (Array.isArray(upstreamNodes) ? upstreamNodes.map((node: any) => collectModelUrl(node?.data)).find(Boolean) : '') || '', [upstreamNodes]);
  const upstreamMetadata = useMemo(() => (Array.isArray(upstreamNodes) ? upstreamNodes.map((node: any) => collectFaceMetadata(node?.data)).find(Boolean) : null), [upstreamNodes]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [size, setSize] = useState(() => d?.size && Number(d.size.w) > 0 ? { w: Number(d.size.w), h: Number(d.size.h) } : { w: 520, h: 520 });

  stateRef.current = state;

  useEffect(() => {
    if (!upstreamModelUrl || state.model.sourceUrl === upstreamModelUrl) return;
    const next = normalizeFaceExpressionState({ ...state, model: { ...state.model, source: 'upstream', sourceUrl: upstreamModelUrl, adapterId: 'semantic-morph-v1' } });
    update({ faceExpression3DState: next });
  }, [upstreamModelUrl]);

  const changeState = (next: FaceExpression3DState) => {
    stateRef.current = next;
    update({ faceExpression3DState: next, error: '' });
  };

  const writeOutputs = (urls: string[], outputState: FaceExpression3DState, extra: Record<string, any> = {}) => {
    const last = urls[urls.length - 1] || '';
    update({
      status: 'success', taskStatus: 'completed', error: '', imageUrl: last, directImageUrl: last,
      imageUrls: urls, directImageUrls: urls, urls,
      metadata: faceExpressionMetadata(outputState, last),
      faceExpressionMetadata: faceExpressionMetadata(outputState, last),
      outputText: '',
      ...extra,
    });
  };

  const runSingle = async (viewport = viewportRef.current) => {
    if (!viewport) throw new Error(t('faceExpression3d.previewNotReady'));
    if (busy) throw new Error(t('faceExpression3d.busy'));
    const token = ++cancelRef.current;
    setBusy(true);
    setMessage(t('faceExpression3d.rendering'));
    update({ status: 'running', taskStatus: 'running', error: '' });
    try {
      await viewport.setState(stateRef.current);
      const dataUrl = await viewport.exportImage(stateRef.current.output);
      if (token !== cancelRef.current) throw Object.assign(new Error(t('faceExpression3d.stopped')), { code: 'FACE_EXPRESSION_CANCELLED' });
      const url = await uploadDataUrl(dataUrl, outputPrefix(stateRef.current));
      if (token !== cancelRef.current) throw Object.assign(new Error(t('faceExpression3d.stopped')), { code: 'FACE_EXPRESSION_CANCELLED' });
      writeOutputs([url], stateRef.current);
      setMessage(t('faceExpression3d.generated', { width: stateRef.current.output.width, height: stateRef.current.output.height }));
    } catch (error) {
      const text = error instanceof Error ? error.message : t('faceExpression3d.generationFailed');
      if ((error as Error & { code?: string } | null)?.code !== 'FACE_EXPRESSION_CANCELLED') update({ status: 'error', taskStatus: 'failed', error: text });
      setMessage(text);
      throw error;
    } finally {
      if (token === cancelRef.current) setBusy(false);
    }
  };

  const runBatch = async (viewport = viewportRef.current) => {
    if (!viewport) throw new Error(t('faceExpression3d.previewNotReady'));
    if (busy) throw new Error(t('faceExpression3d.busy'));
    const baseState = stateRef.current;
    const plan = buildFaceBatchPlan(baseState);
    if (!plan.length) throw new Error(t('faceExpression3d.emptyBatch'));
    const token = ++cancelRef.current;
    const urls: string[] = [];
    setBusy(true);
    setBatchProgress({ completed: 0, total: plan.length });
    setMessage(t('faceExpression3d.batchRendering', { completed: 0, total: plan.length }));
    update({ status: 'running', taskStatus: 'running', error: '' });
    try {
      for (const item of plan) {
        if (token !== cancelRef.current) throw Object.assign(new Error(t('faceExpression3d.stopped')), { code: 'FACE_EXPRESSION_CANCELLED' });
        const itemState = applyFaceCameraPreset(applyFacePreset(baseState, item.expressionPresetId, 'replace'), item.cameraPresetId);
        await viewport.setState(itemState);
        const dataUrl = await viewport.exportImage(itemState.output);
        if (token !== cancelRef.current) throw Object.assign(new Error(t('faceExpression3d.stopped')), { code: 'FACE_EXPRESSION_CANCELLED' });
        urls.push(await uploadDataUrl(dataUrl, outputPrefix(itemState, item.fileLabel)));
        setBatchProgress({ completed: urls.length, total: plan.length });
        setMessage(t('faceExpression3d.batchRendering', { completed: urls.length, total: plan.length }));
      }
      await viewport.setState(baseState);
      writeOutputs(urls, baseState, { faceExpressionBatch: plan });
      setMessage(t('faceExpression3d.batchDone', { count: urls.length }));
    } catch (error) {
      await viewport.setState(baseState).catch(() => undefined);
      const text = error instanceof Error ? error.message : t('faceExpression3d.batchFailed');
      if (urls.length) writeOutputs(urls, baseState, { warning: t('faceExpression3d.retained', { message: text, count: urls.length }) });
      else if ((error as Error & { code?: string } | null)?.code !== 'FACE_EXPRESSION_CANCELLED') update({ status: 'error', taskStatus: 'failed', error: text });
      setMessage(text);
      throw error;
    } finally {
      if (token === cancelRef.current) setBusy(false);
      setBatchProgress(null);
    }
  };

  const stop = () => {
    cancelRef.current += 1;
    setBusy(false);
    setBatchProgress(null);
    setMessage(t('faceExpression3d.stoppedFresh'));
    update({ status: 'idle', taskStatus: 'cancelled', error: '' });
  };

  const analyzeFile = async (file: File) => {
    setPhotoBusy(true);
    setPhotoMessage(t('faceExpression3d.analyzingFace'));
    try {
      const url = await uploadFileBlob(file, `face-reference-${Date.now()}-${file.name}`);
      const result = await analyzeFacePhoto(url);
      const next = applyPhotoCalibration(stateRef.current, result.calibration, result.blendshapes);
      changeState(next);
      setPhotoMessage(t('faceExpression3d.calibrated', { count: result.landmarkCount, warnings: result.warnings.join('; ') || t('faceExpression3d.fineTune') }));
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : t('faceExpression3d.faceAnalysisFailed'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const analyzeUpstream = async () => {
    const image = upstream.images[0]?.url;
    if (!image) {
      photoInputRef.current?.click();
      return;
    }
    setPhotoBusy(true);
    setPhotoMessage(t('faceExpression3d.analyzingUpstream'));
    try {
      const result = await analyzeFacePhoto(image);
      changeState(applyPhotoCalibration(stateRef.current, result.calibration, result.blendshapes));
      setPhotoMessage(t('faceExpression3d.upstreamCalibrated', { count: result.landmarkCount }));
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : t('faceExpression3d.upstreamAnalysisFailed'));
    } finally { setPhotoBusy(false); }
  };

  const applyUpstreamMetadata = () => {
    if (!upstreamMetadata) return;
    const next = normalizeFaceExpressionState({ ...stateRef.current, ...upstreamMetadata, model: { ...stateRef.current.model, ...(upstreamMetadata.model || {}) } });
    changeState(next);
    setMessage(t('faceExpression3d.metadataApplied'));
  };

  const requestFaceExpressionRun = (
    mode: FaceExpressionRunMode,
    target: FaceExpressionRunTarget = 'node',
    viewport?: FaceExpressionViewportHandle,
  ) => {
    const requestId = createCanvasNodeRunRequestId(id, `face-expression-${mode}-${target}`);
    pendingEditorViewportRef.current = target === 'editor' && viewport
      ? { requestId, viewport }
      : null;
    update({
      faceExpressionRunMode: mode,
      faceExpressionRunTarget: target,
      faceExpressionRunRequestId: requestId,
    });
    window.requestAnimationFrame(() => {
      if (requestCanvasNodeRun(id, { requestId })) return;
      const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
      if (liveData?.faceExpressionRunRequestId !== requestId) return;
      if (pendingEditorViewportRef.current?.requestId === requestId) pendingEditorViewportRef.current = null;
      update({
        faceExpressionRunMode: 'single',
        faceExpressionRunTarget: 'node',
        faceExpressionRunRequestId: '',
        status: 'error',
        taskStatus: 'failed',
        error: t('faceExpression3d.requestFailed'),
      });
    });
  };

  useRunTrigger(id, async (reporter) => {
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const contextRequestId = String(reporter.runContext?.requestId || '').trim();
    const persistedRequestId = String(liveData?.faceExpressionRunRequestId || '').trim();
    const requestedMode = String(persistedRequestId ? liveData?.faceExpressionRunMode || 'single' : 'single') as FaceExpressionRunMode;
    const requestedTarget = String(persistedRequestId ? liveData?.faceExpressionRunTarget || 'node' : 'node') as FaceExpressionRunTarget;
    try {
      if (persistedRequestId && contextRequestId !== persistedRequestId) {
        throw new Error(t('faceExpression3d.staleRun'));
      }
      if (requestedMode !== 'single' && requestedMode !== 'batch') {
        throw new Error(t('faceExpression3d.invalidMode'));
      }
      if (requestedTarget !== 'node' && requestedTarget !== 'editor') {
        throw new Error(t('faceExpression3d.invalidTarget'));
      }
      let targetViewport = viewportRef.current;
      if (persistedRequestId && requestedTarget === 'editor') {
        const pending = pendingEditorViewportRef.current;
        if (!pending || pending.requestId !== contextRequestId) {
          throw new Error(t('faceExpression3d.editorExpired'));
        }
        targetViewport = pending.viewport;
      }
      if (!targetViewport) throw new Error(t('faceExpression3d.previewNotReady'));
      if (requestedMode === 'batch') await runBatch(targetViewport);
      else await runSingle(targetViewport);
    } finally {
      if (contextRequestId) {
        const latestData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
        if (latestData?.faceExpressionRunRequestId === contextRequestId) {
          update({
            faceExpressionRunMode: 'single',
            faceExpressionRunTarget: 'node',
            faceExpressionRunRequestId: '',
          });
        }
        if (pendingEditorViewportRef.current?.requestId === contextRequestId) pendingEditorViewportRef.current = null;
      }
    }
  }, 'face-expression-3d', { lifecycleAware: true });

  const accent = '#22d3ee';
  const bg = isPixel ? 'var(--px-surface)' : isDark ? '#0c121a' : '#f8fbfd';
  const surface = isPixel ? 'var(--px-muted)' : isDark ? '#151f2b' : '#e8f4f7';
  const text = isPixel ? 'var(--px-ink)' : isDark ? '#f1f5f9' : '#10212b';
  const sub = isPixel ? 'var(--px-ink-soft)' : isDark ? '#94a3b8' : '#536872';
  const border = isPixel ? 'var(--px-ink)' : isDark ? 'rgba(103,232,249,.25)' : 'rgba(8,145,178,.26)';

  const onResize = (_event: any, params: { width: number; height: number }) => {
    const next = { w: Math.round(params.width), h: Math.round(params.height) };
    setSize(next); update({ size: next }); updateNodeInternals(id);
  };

  return (
    <div className="relative flex flex-col" style={{ width: size.w, height: size.h, minWidth: 420, minHeight: 430, background: bg, color: text, border: `2px solid ${selected ? accent : border}`, borderRadius: isPixel ? 8 : 10, boxShadow: isPixel ? '4px 4px 0 var(--px-ink)' : '0 14px 34px rgba(0,0,0,.22)', overflow: 'visible' }}>
      <Handle id="model3d" type="target" position={Position.Left} style={{ ...handleStyle, top: '35%', left: -7, background: PORT_COLOR.model3d }} title={t('faceExpression3d.modelInput')} />
      <Handle id="image" type="target" position={Position.Left} style={{ ...handleStyle, top: '52%', left: -7, background: PORT_COLOR.image }} title={t('faceExpression3d.faceImageInput')} />
      <Handle id="metadata" type="target" position={Position.Left} style={{ ...handleStyle, top: '69%', left: -7, background: PORT_COLOR.metadata }} title={t('faceExpression3d.metadata')} />
      <Handle id="image" type="source" position={Position.Right} style={{ ...handleStyle, top: '45%', right: -7, background: PORT_COLOR.image }} title={t('faceExpression3d.imageOutput')} />
      <Handle id="metadata" type="source" position={Position.Right} style={{ ...handleStyle, top: '62%', right: -7, background: PORT_COLOR.metadata }} title={t('faceExpression3d.metadata')} />
      <ResizableCorners selected={selected} minWidth={420} minHeight={430} maxWidth={900} maxHeight={900} accent={accent} keepAspectRatio={false} onResize={onResize} onResizeEnd={onResize} />

      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: border, background: surface }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-400 text-[#071018]"><ScanFace size={19} /></div>
        <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-black">{t('faceExpression3d.title')}</div><div className="truncate text-[10px]" style={{ color: sub }}>{state.model.source === 'upstream' ? t('faceExpression3d.upstreamModel') : t('faceExpression3d.builtinModel')}</div></div>
        {d.status === 'success' && <CheckCircle2 size={16} className="text-emerald-400" />}
      </header>

      <div className="nodrag nowheel relative min-h-[230px] flex-1 overflow-hidden" onMouseDown={(event) => event.stopPropagation()}>
        <FaceExpressionViewport ref={viewportRef} state={state} className="h-full w-full" onStateChange={changeState} onError={setMessage} />
      </div>

      <div className="shrink-0 space-y-2 border-t p-3" style={{ borderColor: border, background: bg }}>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <button className="nodrag inline-flex h-9 items-center justify-center gap-1 rounded-md border font-bold" style={{ borderColor: border, background: surface }} onClick={() => setEditorOpen(true)}><ExternalLink size={13} />{t('faceExpression3d.fullEdit')}</button>
          <button className="nodrag inline-flex h-9 items-center justify-center gap-1 rounded-md border font-bold" style={{ borderColor: border, background: surface }} onClick={() => void analyzeUpstream()} disabled={photoBusy}>{photoBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}{t('faceExpression3d.calibrateFace')}</button>
          <button className="nodrag inline-flex h-9 items-center justify-center gap-1 rounded-md border font-bold disabled:opacity-40" style={{ borderColor: border, background: surface }} onClick={applyUpstreamMetadata} disabled={!upstreamMetadata}><Sparkles size={13} />{t('faceExpression3d.applyParameters')}</button>
        </div>
        <div className="flex items-center gap-2">
          <button className="nodrag inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border-2 border-cyan-400 bg-cyan-400/15 text-[12px] font-black" onClick={() => requestFaceExpressionRun('single')} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}{t('faceExpression3d.generateImage')}</button>
          <button className="nodrag inline-flex h-10 w-24 items-center justify-center gap-1 rounded-md border text-[11px] font-bold" style={{ borderColor: border, background: surface }} onClick={() => requestFaceExpressionRun('batch')} disabled={busy}><Layers3 size={14} />{t('faceExpression3d.batch')}</button>
          {busy && <button className="nodrag inline-flex h-10 w-10 items-center justify-center rounded-md border border-rose-400/60 text-rose-400" onClick={stop} title={t('faceExpression3d.stop')}><X size={15} /></button>}
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: d.error ? '#fb7185' : sub }}><span className="truncate" title={d.error || photoMessage || message || t('faceExpression3d.hint')}>{d.error || photoMessage || message || t('faceExpression3d.hint')}</span><strong className="shrink-0" style={{ color: text }}>{state.output.width}×{state.output.height}</strong></div>
      </div>

      <input ref={photoInputRef} className="hidden" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void analyzeFile(file); }} />
      {editorOpen && <FaceExpression3DEditor state={state} busy={busy} batchProgress={batchProgress} photoBusy={photoBusy} photoMessage={photoMessage} onChange={changeState} onAnalyzePhoto={analyzeFile} onExport={(viewport) => requestFaceExpressionRun('single', 'editor', viewport)} onBatchExport={(viewport) => requestFaceExpressionRun('batch', 'editor', viewport)} onStop={stop} onClose={() => setEditorOpen(false)} />}
    </div>
  );
};

export default memo(FaceExpression3DNode);
