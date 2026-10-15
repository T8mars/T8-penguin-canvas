import { Component, lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { Camera, FolderOpen, Globe2, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { copyFileToOutput, uploadFileBlob, uploadFileBlobReceipt } from '../../services/imageOps';
import { getProjectAsset } from '../../services/api';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { collectUpstreamWorldScenes, normalizeWorldScene, worldSceneFormat, type WorldCamera, type WorldSceneProject, type WorldSceneSource } from '../../utils/worldScene';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useCanvasStore } from '../../stores/canvas';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../../stores/runBus';
import { selectSingleSourceHandleData } from '../../utils/sourceHandleData';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';
import { PORT_COLOR } from '../../config/portTypes';
import type { WorldSceneViewerHandle } from '../../features/world-scene/WorldSceneViewer';

const Viewer = lazy(() => import('../../features/world-scene/WorldSceneViewer'));
class ViewerBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const button = { padding: '7px 10px', border: '1px solid var(--t8-border, #536272)', borderRadius: 7, background: 'var(--bg-secondary, #243042)', color: 'inherit', fontSize: 12 };
function WorldSceneNode({ id, data, selected }: NodeProps) {
  const { t } = useTranslation('creativeUx');
  const rf = useReactFlow(), update = useUpdateNodeData(id);
  const d = data as Record<string, any>;
  const project = useMemo(() => normalizeWorldScene(d.worldSceneProject), [d.worldSceneProject]);
  const connections = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(() => Array.from(new Set(connections.map((edge) => edge.source))), [connections]);
  const upstreamNodes = useNodesData(upstreamIds);
  const incoming = useMemo(() => {
    const nodes = new Map((Array.isArray(upstreamNodes) ? upstreamNodes : []).map((node) => [node.id, node]));
    const seen = new Set<string>();
    return connections.flatMap((edge) => {
      const sourceNode = nodes.get(edge.source); if (!sourceNode) return [];
      const selectedData = selectSingleSourceHandleData(sourceNode.data, edge.sourceHandle, 'model3d');
      return collectUpstreamWorldScenes(sourceNode.id, selectedData).filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
    });
  }, [upstreamNodes, connections]);
  const incomingRef = useRef(incoming); incomingRef.current = incoming;
  const sources = useMemo(() => [...project.sources, ...incoming], [project.sources, incoming]);
  const source = sources.find((item) => item.id === project.activeSourceId) || (!project.activeSourceId ? sources[0] : undefined);
  const viewer = useRef<WorldSceneViewerHandle>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false), [uploading, setUploading] = useState(false), [requestPending, setRequestPending] = useState(false);
  const [renderForRun, setRenderForRun] = useState(false);
  const readyRef = useRef(false);
  const viewerWaiter = useRef<{ resolve: (handle: WorldSceneViewerHandle) => void; reject: (error: Error) => void } | null>(null);
  const [viewName, setViewName] = useState(''), [localError, setLocalError] = useState('');
  const mounted = useRef(true);
  const originCanvasId = useRef(useCanvasStore.getState().activeId);
  const importAbort = useRef<AbortController | null>(null);
  const runBusy = useRunBusStore((state) => state.runningIds.includes(createCanvasNodeExecutionKey(originCanvasId.current, id)));
  const renderMode = useCanvasNodeRenderMode();
  const readOnly = useCanvasStore((state) => state.canvases.find((canvas) => canvas.id === state.activeId)?.status === 'archived');
  const busy = uploading || runBusy || requestPending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; importAbort.current?.abort(); viewerWaiter.current?.reject(new DOMException('Cancelled', 'AbortError')); }; }, []);
  useEffect(() => { readyRef.current = false; viewerWaiter.current?.reject(Error(t('world.notReady'))); }, [source?.id, source?.url]);
  const viewerReady = (value: boolean) => { readyRef.current = value; setReady(value); if (value && viewer.current) viewerWaiter.current?.resolve(viewer.current); };
  const viewerFailed = (error: Error) => { viewerWaiter.current?.reject(error); };
  const loadViewerForRun = (signal?: AbortSignal): Promise<WorldSceneViewerHandle> => {
    signal?.throwIfAborted(); setRenderForRun(true);
    if (readyRef.current && viewer.current) return Promise.resolve(viewer.current);
    // Loading is owned by this Run. Do not require an extra manual open or
    // keep offscreen GPU resources alive once a closed/cold capture finishes.
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', aborted); viewerWaiter.current = null; };
      const aborted = () => { cleanup(); reject(signal?.reason || new DOMException('Cancelled', 'AbortError')); };
      viewerWaiter.current = { resolve: (handle) => { cleanup(); resolve(handle); }, reject: (error) => { cleanup(); reject(error); } };
      signal?.addEventListener('abort', aborted, { once: true }); if (signal?.aborted) aborted();
    });
  };
  const getProject = (): WorldSceneProject => normalizeWorldScene((rf.getNode(id)?.data as Record<string, any> | undefined)?.worldSceneProject);
  const writable = () => {
    const state = useCanvasStore.getState();
    return mounted.current && state.activeId === originCanvasId.current && Boolean(rf.getNode(id))
      && state.canvases.find((canvas) => canvas.id === originCanvasId.current)?.status !== 'archived';
  };
  const writeProject = (transform: (current: WorldSceneProject) => WorldSceneProject) => {
    if (!writable()) return;
    // Resolve against the latest node inside the state updater, not a render's
    // stale getNode snapshot after several asynchronous imports or clicks.
    rf.setNodes((nodes) => nodes.map((node) => {
      if (node.id !== id || !writable()) return node;
      const next = normalizeWorldScene(transform(normalizeWorldScene(node.data.worldSceneProject)));
      const active = [...next.sources, ...incomingRef.current].find((item) => item.id === next.activeSourceId);
      const patch = { worldSceneProject: next, worldSceneSource: active || null, worldSceneUrl: active?.url || '', worldSceneFormat: active?.format || '', modelUrl: active?.url || '', modelUrls: active ? [active.url] : [],
        // Existing Canvas preflight and host asset lookup consume this explicit
        // project AssetRef, not arbitrary nested/timeline assetId fields.
        sourceAssetId: active?.assetId || '' };
      if (Object.entries(patch).every(([key, value]) => JSON.stringify(node.data[key]) === JSON.stringify(value))) return node;
      return { ...node, data: { ...node.data, ...patch } };
    }));
  };
  useEffect(() => {
    if (!writable()) return;
    if (source && (project.activeSourceId !== source.id || d.worldSceneUrl !== source.url || !d.worldSceneSource || (d.sourceAssetId || '') !== (source.assetId || ''))) {
      writeProject((current) => ({ ...current, activeSourceId: source.id, ...(current.activeSourceId !== source.id ? { camera: current.cameras[source.id] || null } : {}) }));
    } else if (!source && (d.worldSceneUrl || d.sourceAssetId)) {
      // Keep the missing source/view IDs for reconnection, but never expose a
      // disconnected scene as though it were still the current output.
      writeProject((current) => current);
    }
  }, [source?.id, source?.url, source?.assetId, project.activeSourceId, d.worldSceneUrl, d.sourceAssetId, readOnly]);
  const persistCamera = (camera: WorldCamera) => {
    if (!writable() || getProject().activeSourceId !== source?.id) return;
    writeProject((current) => current.activeSourceId === source.id ? { ...current, camera, cameras: { ...current.cameras, [source.id]: camera } } : current);
  };
  const importFiles = async (files: File[]) => {
    if (!files.length || busy || !writable()) return;
    if (files.some((file) => !worldSceneFormat(file.name))) { setLocalError(t('world.formatError')); return; }
    setUploading(true); setLocalError('');
    const controller = new AbortController(); importAbort.current = controller;
    try {
      // A failed later upload keeps earlier successfully imported references.
      for (const file of files) {
        const receipt = await uploadFileBlobReceipt(file, file.name, { signal: controller.signal, canvasId: originCanvasId.current || undefined, sourceNodeId: id, sourceNodeType: 'world-scene' });
        const asset = receipt.assetId ? await getProjectAsset(receipt.assetId, { signal: controller.signal }) : null;
        if (!writable()) return;
        const next: WorldSceneSource = { id: crypto.randomUUID(), url: receipt.url, name: file.name, format: worldSceneFormat(file.name)!,
          ...(asset ? { assetId: asset.id, assetEntityUid: asset.entityUid, contentRevision: asset.contentRevision, contentHash: asset.contentHash } : {}) };
        writeProject((current) => ({ ...current, sources: [...current.sources, next], activeSourceId: next.id, camera: null }));
      }
      if (mounted.current) setOpen(true);
    } catch (e) { if (mounted.current) setLocalError(controller.signal.aborted ? t('world.cancelled') : e instanceof Error ? e.message : String(e)); }
    finally { if (importAbort.current === controller) importAbort.current = null; if (mounted.current) setUploading(false); }
  };
  const addView = () => {
    const camera = viewer.current?.getCamera(); if (!camera || !writable()) return;
    const viewId = crypto.randomUUID(), name = viewName.trim(), sourceId = source?.id;
    writeProject((current) => ({ ...current, camera, views: [...current.views, { id: viewId, name: name || t('world.defaultView', { count: current.views.length + 1 }), sourceId, camera }] }));
    setViewName('');
  };
  useRunTrigger(id, async (reporter) => {
    try {
      setLocalError('');
      if (!writable()) throw Error(t('world.readOnly'));
      if (!source) throw Error(t('world.notReady'));
      const capturedSource = { ...source };
      update({ status: 'running', taskStatus: 'running', error: '' });
      const loadedViewer = await loadViewerForRun(reporter.signal);
      if (!writable()) throw Error(t('world.readOnly'));
      const { blob, camera } = await loadedViewer.captureFrame(reporter.signal);
      reporter.signal?.throwIfAborted();
      await reporter.progress({ phase: 'captured-composition', worldSceneSnapshot: { source: capturedSource, camera } });
      const filename = `world-${id}-${Date.now()}.png`;
      const uploaded = await uploadFileBlob(blob, filename, { signal: reporter.signal });
      reporter.signal?.throwIfAborted();
      const archived = await copyFileToOutput(uploaded, filename, 'world-scenes', { signal: reporter.signal });
      reporter.signal?.throwIfAborted();
      const metadata = { schema: 't8-world-scene-output-v1', role: 'composition_reference', sourceId: capturedSource.id, source: capturedSource, camera };
      await reporter.output({ status: 'succeeded', outputCount: 1, assets: [
        { kind: 'image', sourceUrl: archived.url, filename, mimeType: 'image/png', metadata },
      ] });
      reporter.signal?.throwIfAborted();
      update({ status: 'success', taskStatus: 'completed', imageUrl: archived.url, imageUrls: [archived.url], urls: [archived.url], worldSceneOutputMetadata: metadata, metadata, error: '' });
    } catch (error) {
      update({ status: 'error', taskStatus: 'failed', error: reporter.signal?.aborted ? t('world.cancelled') : error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      if (mounted.current) setRenderForRun(false);
    }
  }, 'world-scene', { lifecycleAware: true });
  const capture = () => {
    if (!ready || busy || !writable()) return;
    setRequestPending(true); setLocalError('');
    const requestId = createCanvasNodeRunRequestId(id, 'world-snapshot');
    if (!requestCanvasNodeRun(id, { requestId, onSettled: (outcome) => { if (!mounted.current) return; setRequestPending(false); if (!outcome.accepted) setLocalError(outcome.error || t('world.requestFailed')); } })) {
      setRequestPending(false); setLocalError(t('world.requestFailed'));
    }
  };

  return <div className="node-card" data-world-scene-node style={{ width: 500, borderRadius: 14, overflow: 'visible',
    border: `2px solid ${selected ? 'var(--t8-accent, #2dd4bf)' : 'var(--t8-border, #546373)'}`, background: 'var(--bg-primary, #152033)', color: 'var(--text-primary, #e2e8f0)' }}>
    <Handle id="input" type="target" position={Position.Left} style={{ background: PORT_COLOR.model3d }} />
    <Handle id="image" type="source" position={Position.Right} style={{ background: PORT_COLOR.image, top: '40%' }} title={t('world.imageOutput')} />
    <Handle id="scene" type="source" position={Position.Right} style={{ background: PORT_COLOR.model3d, top: '65%' }} title={t('world.sceneOutput')} />
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderBottom: '1px solid var(--t8-border, #546373)' }}>
      <Globe2 size={20} /><strong>{t('world.title')}</strong><span style={{ fontSize: 11, opacity: .65 }}>Gaussian / SPZ / PLY</span>
    </header>
    <div className="nodrag nopan nowheel" style={{ padding: 12, display: 'grid', gap: 10 }} onPointerDown={(e) => e.stopPropagation()}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const files = Array.from(e.dataTransfer.files); void importFiles(files); }}>
      <input ref={input} type="file" hidden multiple accept=".spz,.ply,.splat,.ksplat" onChange={(e) => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; void importFiles(files); }} />
      <button type="button" style={button} disabled={busy || readOnly} onClick={() => input.current?.click()}><FolderOpen size={13} /> {uploading ? t('world.importing') : t('world.import')}</button>
      {uploading && <button type="button" style={button} onClick={() => importAbort.current?.abort()}>{t('world.cancelImport')}</button>}
      {sources.length > 0 && <select style={button} value={project.activeSourceId || source?.id || ''} aria-label={t('world.selectScene')} disabled={busy || readOnly}
        onChange={(e) => { const activeSourceId = e.currentTarget.value; writeProject((current) => ({ ...current, activeSourceId, camera: current.cameras[activeSourceId] || null })); }}>
        {!sources.some((item) => item.id === project.activeSourceId) && project.activeSourceId && <option value={project.activeSourceId}>{t('world.missingScene')}</option>}
        {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
      {!source && project.activeSourceId && <p role="status">{t('world.missingScene')}</p>}
      {source && <button type="button" style={button} disabled={busy} onClick={() => { if (open) { const c = viewer.current?.getCamera(); if (c) persistCamera(c); } setOpen(!open); }}>
        {open ? <X size={13} /> : <Globe2 size={13} />} {open ? t('world.closeViewer') : t('world.openViewer')}
      </button>}
      {source && (renderForRun || open && renderMode !== 'cold') && <div style={{ height: 320, border: '1px solid var(--t8-border, #546373)', borderRadius: 8, overflow: 'hidden' }}>
        <ViewerBoundary key={source.id} onError={viewerFailed} fallback={<p role="alert">{t('world.viewerLoadFailed')}</p>}>
          <Suspense fallback={<div role="status">{t('world.loading')}</div>}><Viewer key={source.id} ref={viewer} source={source} camera={project.camera} onCameraChange={persistCamera} onReady={viewerReady} onError={viewerFailed} /></Suspense>
        </ViewerBoundary>
      </div>}
      <p style={{ margin: 0, fontSize: 11, opacity: .7 }}>{t('world.navigate')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={button} disabled={!ready || busy} onClick={() => viewer.current?.reset()}><RotateCcw size={13} /> {t('world.resetCamera')}</button>
        <button type="button" style={button} disabled={!ready || busy || readOnly} onClick={capture}><Camera size={13} /> {t(requestPending ? 'world.confirming' : runBusy ? 'world.capturing' : 'world.capture')}</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={viewName} onChange={(e) => setViewName(e.currentTarget.value)} aria-label={t('world.viewName')} placeholder={t('world.viewName')} maxLength={80} style={{ ...button, minWidth: 0, flex: 1 }} />
        <button type="button" style={button} disabled={!ready || busy || readOnly} onClick={addView}><Save size={13} /> {t('world.saveView')}</button>
      </div>
      <div style={{ maxHeight: 160, overflowY: 'auto', display: 'grid', gap: 5 }}>
        {project.views.filter((view) => !view.sourceId || view.sourceId === project.activeSourceId).map((view) => <div key={view.id} style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={{ ...button, flex: 1, textAlign: 'left' }} disabled={!ready || busy} onClick={() => { viewer.current?.setCamera(view.camera); persistCamera(view.camera); }}>{view.name}</button>
          <button type="button" style={button} title={t('world.removeView')} disabled={busy || readOnly} onClick={() => writeProject((current) => ({ ...current, views: current.views.filter((v) => v.id !== view.id) }))}><Trash2 size={13} /></button>
        </div>)}
      </div>
      {(localError || d.error) && <div role="alert" style={{ color: 'var(--danger, #f87171)', fontSize: 12 }}>{localError || d.error}</div>}
    </div>
  </div>;
}
export default memo(WorldSceneNode);
