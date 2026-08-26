import {
  lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Handle, Position, useNodeConnections, useNodesData, useReactFlow, useUpdateNodeInternals, type NodeProps,
} from '@xyflow/react';
import {
  Box, Camera, CheckCircle2, ExternalLink, FileImage, Film, Github, Heart, Loader2,
} from 'lucide-react';
import { PORT_COLOR } from '../../config/portTypes';
import { useThemeStore } from '../../stores/theme';
import { copyFileToOutput, uploadFileBlob } from '../../services/imageOps';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../../stores/runBus';
import { useCanvasStore } from '../../stores/canvas';
import type { PrevisStudioEditorHandle } from '../../features/previs-studio/PrevisStudioEditor';
import ResizableCorners from './ResizableCorners';
import { useUpdateNodeData } from './useUpdateNodeData';
import SmartImage from '../SmartImage';

const LazyPrevisStudioEditor = lazy(() => import('../../features/previs-studio/PrevisStudioEditor'));

const SOURCE_URL = 'https://github.com/GuiYi-Xi/monoform-previs-studio';
const SOURCE_COMMIT = 'daa54b2f6e78cc69f07102f7d32f6fabe3ac4a54';
const handleStyle: CSSProperties = { width: 12, height: 12, border: 'none', zIndex: 20 };

type PrevisRunKind = 'image' | 'video';

function collectModelUrl(data: any): string {
  const values = [
    data?.modelUrl,
    data?.directModelUrl,
    ...(Array.isArray(data?.modelUrls) ? data.modelUrls : []),
    ...(Array.isArray(data?.directModelUrls) ? data.directModelUrls : []),
  ];
  return values.find((value) => typeof value === 'string' && /\.(glb|gltf)(?:\?|#|$)/i.test(value)) || '';
}

function normalizeProject(value: any): Record<string, any> | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.objects)) return null;
  return value;
}

async function persistPrevisOutput(blob: Blob, filename: string, archiveError: string): Promise<string> {
  const uploadedUrl = await uploadFileBlob(blob, filename);
  const archived = await copyFileToOutput(uploadedUrl, filename, 'previs');
  if (!archived.url.startsWith('/files/output/previs/')) {
    throw new Error(archiveError);
  }
  return archived.url;
}

function hasUnsafeLegacyOutput(data: Record<string, unknown> | undefined, fields: string[]): boolean {
  const values = fields.flatMap((field) => {
    const value = data?.[field];
    return Array.isArray(value) ? value : [value];
  });
  return values.some((value) => {
    const url = typeof value === 'string' ? value.trim() : '';
    return Boolean(url && !url.startsWith('/files/output/') && !url.startsWith('/output/') && !/^https:\/\//i.test(url));
  });
}

function projectSummary(project: Record<string, any> | null) {
  const objects = Array.isArray(project?.objects) ? project!.objects : [];
  const tracks = project?.objectKeyframes && typeof project.objectKeyframes === 'object'
    ? Object.values(project.objectKeyframes).filter((value) => Array.isArray(value) && value.length).length
    : 0;
  const cameraKeys = Array.isArray(project?.keyframes) ? project!.keyframes.length : 0;
  return {
    objectCount: objects.length,
    personCount: objects.filter((item: any) => item?.type === 'person').length,
    animatedTracks: tracks,
    cameraKeys,
    aspectRatio: String(project?.camera?.aspectRatio || '16:9'),
    fps: Number(project?.settings?.fps || 24),
    durationSeconds: Number(project?.settings?.durationSeconds || 15),
    shotCount: Array.isArray(project?.shots) ? project!.shots.length : 1,
  };
}

const PrevisStudioNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const d = (data || {}) as any;
  const update = useUpdateNodeData(id);
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';
  const project = useMemo(() => normalizeProject(d.previsProject), [d.previsProject]);
  const summary = useMemo(() => projectSummary(project), [project]);
  const lastProjectSignatureRef = useRef(project ? JSON.stringify(project) : '');
  const editorRef = useRef<PrevisStudioEditorHandle | null>(null);
  const cancelledDuringRunRef = useRef(false);
  const readyWaitersRef = useRef(new Set<() => void>());
  const connections = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(() => Array.from(new Set(connections.map((item) => item.source).filter(Boolean))), [connections]);
  const upstreamNodes = useNodesData(upstreamIds);
  const upstreamModelUrl = useMemo(
    () => (Array.isArray(upstreamNodes) ? upstreamNodes.map((node: any) => collectModelUrl(node?.data)).find(Boolean) : '') || '',
    [upstreamNodes],
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [size, setSize] = useState(() => d?.size && Number(d.size.w) > 0
    ? { w: Number(d.size.w), h: Number(d.size.h) }
    : { w: 500, h: 460 });
  const originCanvasIdRef = useRef(useCanvasStore.getState().activeId);
  const executionNodeId = createCanvasNodeExecutionKey(originCanvasIdRef.current, id);
  const cancelSeq = useRunBusStore((state) => state.cancelSeq);
  const cancelTargets = useRunBusStore((state) => state.cancelTargets);

  useEffect(() => {
    lastProjectSignatureRef.current = project ? JSON.stringify(project) : '';
  }, [project]);

  useEffect(() => {
    if (!cancelTargets.includes(executionNodeId)) return;
    cancelledDuringRunRef.current = true;
    editorRef.current?.cancelExport();
    setMessage(t('previs.stopped'));
  }, [cancelSeq, cancelTargets, executionNodeId, t]);

  useEffect(() => {
    if (!upstreamModelUrl || d.previsUpstreamModelUrl === upstreamModelUrl) return;
    const base = project || {
      version: 8,
      objects: [],
      camera: { position: [7.4, 4.6, 8.2], target: [0.2, 1.2, 0], focalLength: 42, aspectRatio: '16:9' },
      keyframes: [],
      objectKeyframes: {},
    };
    const modelId = `upstream-model-${id}`;
    const objects = [
      ...base.objects.filter((item: any) => item?.id !== modelId),
      {
        id: modelId,
        name: '上游 3D 模型',
        type: 'model',
        url: upstreamModelUrl,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#ddd8cc',
      },
    ];
    update({ previsProject: { ...base, objects }, previsUpstreamModelUrl: upstreamModelUrl });
  }, [upstreamModelUrl, d.previsUpstreamModelUrl, project]);

  const onEditorReady = () => {
    for (const resolve of readyWaitersRef.current) resolve();
    readyWaitersRef.current.clear();
  };

  const ensureEditorReady = async () => {
    if (editorRef.current) return editorRef.current;
    setEditorOpen(true);
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        readyWaitersRef.current.delete(finish);
        reject(new Error(t('previs.loadTimeout')));
      }, 15_000);
      readyWaitersRef.current.add(finish);
    });
    if (!editorRef.current) throw new Error(t('previs.notReady'));
    return editorRef.current;
  };

  const writeProject = useCallback((nextProject: Record<string, unknown>) => {
    const signature = JSON.stringify(nextProject);
    if (signature === lastProjectSignatureRef.current) return;
    lastProjectSignatureRef.current = signature;
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const currentRevision = Number(liveData?.previsProjectRevision || 0);
    update({
      previsProject: nextProject,
      previsProjectRevision: currentRevision + 1,
      previsSource: { repository: SOURCE_URL, commit: SOURCE_COMMIT, author: 'GuiYi-Xi' },
      error: '',
      errorKey: '',
    });
  }, [id, rf, update]);

  const requestRun = (kind: PrevisRunKind) => {
    const requestId = createCanvasNodeRunRequestId(id, `previs-${kind}`);
    update({ previsRunKind: kind, previsRunRequestId: requestId, error: '', errorKey: '' });
    window.requestAnimationFrame(() => {
      if (requestCanvasNodeRun(id, { requestId })) return;
      const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
      if (liveData?.previsRunRequestId !== requestId) return;
      update({
        previsRunRequestId: '',
        status: 'error',
        taskStatus: 'failed',
        error: '',
        errorKey: 'previs.requestFailed',
      });
    });
  };

  useRunTrigger(id, async (reporter) => {
    const liveData = rf.getNode(id)?.data as Record<string, unknown> | undefined;
    const contextRequestId = String(reporter.runContext?.requestId || '').trim();
    const persistedRequestId = String(liveData?.previsRunRequestId || '').trim();
    const kind = String(persistedRequestId ? liveData?.previsRunKind || 'image' : 'image') as PrevisRunKind;
    if (persistedRequestId && contextRequestId !== persistedRequestId) {
      throw new Error(t('previs.staleRun'));
    }
    if (kind !== 'image' && kind !== 'video') throw new Error(t('previs.invalidRunKind'));
    setBusy(true);
    cancelledDuringRunRef.current = false;
    setMessage(kind === 'video' ? t('previs.renderingVideo') : t('previs.renderingImage'));
    update({ status: 'running', taskStatus: 'running', error: '', errorKey: '' });
    try {
      const editor = await ensureEditorReady();
      const projectSnapshot = editor.getProject();
      if (projectSnapshot) writeProject(projectSnapshot);
      const revision = Number((rf.getNode(id)?.data as any)?.previsProjectRevision || 0) + 1;
      const assertRunActive = () => {
        if (!cancelledDuringRunRef.current) return;
        const error = new Error(t('previs.stopped'));
        (error as Error & { code?: string }).code = 'PREVIS_EXPORT_CANCELLED';
        throw error;
      };
      if (kind === 'video') {
        const result = await editor.exportVideo();
        assertRunActive();
        const filename = `previs-${id}-${Date.now()}.mp4`;
        const url = await persistPrevisOutput(result.blob, filename, t('previs.archiveFailed'));
        assertRunActive();
        const outputText = `白模预演参考动画，${result.durationSeconds.toFixed(2)} 秒，${result.aspectRatio}，${result.fps} FPS。`;
        const metadata = {
          schema: 't8-previs-output-v1', kind: 'video', role: 'motion_camera_reference', url,
          width: result.width, height: result.height, fps: result.fps, frameCount: result.frameCount,
          durationSeconds: result.durationSeconds, aspectRatio: result.aspectRatio, codec: result.codec,
          pixelFormat: 'yuv420p', hasAudio: false, projectRevision: revision,
          source: { repository: SOURCE_URL, commit: SOURCE_COMMIT, author: 'GuiYi-Xi' },
        };
        const nodeBeforeWrite = rf.getNode(id)?.data as Record<string, unknown> | undefined;
        const clearLegacyImage = hasUnsafeLegacyOutput(nodeBeforeWrite, ['imageUrl', 'imageUrls', 'urls', 'directImageUrl', 'directImageUrls']);
        update({
          status: 'success', taskStatus: 'completed', error: '', errorKey: '',
          videoUrl: url, videoUrls: [url], directVideoUrl: url, directVideoUrls: [url],
          ...(clearLegacyImage ? { imageUrl: '', imageUrls: [], urls: [], directImageUrl: '', directImageUrls: [] } : {}),
          outputText,
          metadata, previsOutputMetadata: metadata,
        });
        await reporter.output({
          status: 'succeeded',
          outputCount: 2,
          assets: [
            { kind: 'video', sourceUrl: url, filename, mimeType: 'video/mp4', metadata: { ...metadata, role: 'motion_camera_reference' } },
            { kind: 'text', text: outputText, filename: `${filename}.txt`, mimeType: 'text/plain', metadata: { role: 'shot_description' } },
          ],
        });
        setMessage(t('previs.animationSaved', { width: result.width, height: result.height, count: result.frameCount }));
      } else {
        const result = await editor.exportImage();
        assertRunActive();
        const filename = `previs-${id}-frame-${result.frame}-${Date.now()}.png`;
        const url = await persistPrevisOutput(result.blob, filename, t('previs.archiveFailed'));
        assertRunActive();
        const outputText = `白模预演构图参考，第 ${result.frame} 帧，${result.aspectRatio}。`;
        const metadata = {
          schema: 't8-previs-output-v1', kind: 'image', role: 'composition_reference', url,
          width: result.width, height: result.height, frame: result.frame, fps: result.fps,
          timeSeconds: result.frame / result.fps, aspectRatio: result.aspectRatio,
          projectRevision: revision,
          source: { repository: SOURCE_URL, commit: SOURCE_COMMIT, author: 'GuiYi-Xi' },
        };
        const nodeBeforeWrite = rf.getNode(id)?.data as Record<string, unknown> | undefined;
        const clearLegacyVideo = hasUnsafeLegacyOutput(nodeBeforeWrite, ['videoUrl', 'videoUrls', 'directVideoUrl', 'directVideoUrls']);
        update({
          status: 'success', taskStatus: 'completed', error: '', errorKey: '',
          imageUrl: url, imageUrls: [url], urls: [url], directImageUrl: url, directImageUrls: [url],
          ...(clearLegacyVideo ? { videoUrl: '', videoUrls: [], directVideoUrl: '', directVideoUrls: [] } : {}),
          outputText,
          metadata, previsOutputMetadata: metadata,
        });
        await reporter.output({
          status: 'succeeded',
          outputCount: 2,
          assets: [
            { kind: 'image', sourceUrl: url, filename, mimeType: 'image/png', metadata: { ...metadata, role: 'composition_reference' } },
            { kind: 'text', text: outputText, filename: `${filename}.txt`, mimeType: 'text/plain', metadata: { role: 'shot_description' } },
          ],
        });
        setMessage(t('previs.frameSaved', { width: result.width, height: result.height }));
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : t('previs.exportFailed');
      const cancelled = cancelledDuringRunRef.current
        || (error as Error & { code?: string } | null)?.code === 'PREVIS_EXPORT_CANCELLED';
      update(cancelled
        ? { status: 'stopped', taskStatus: 'cancelled', error: '', errorKey: '' }
        : { status: 'error', taskStatus: 'failed', error: text, errorKey: '' });
      setMessage(text);
      throw error;
    } finally {
      setBusy(false);
      if (contextRequestId) {
        const latest = rf.getNode(id)?.data as Record<string, unknown> | undefined;
        if (latest?.previsRunRequestId === contextRequestId) update({ previsRunRequestId: '' });
      }
    }
  }, 'previs-studio', { lifecycleAware: true });

  const openSource = () => {
    if (window.t8pc?.openExternal) void window.t8pc.openExternal(SOURCE_URL);
    else window.open(SOURCE_URL, '_blank', 'noopener,noreferrer');
  };

  const onResize = (_event: any, params: { width: number; height: number }) => {
    const next = { w: Math.round(params.width), h: Math.round(params.height) };
    setSize(next);
    update({ size: next });
    updateNodeInternals(id);
  };

  const accent = '#d6a84f';
  const persistedError = d.errorKey ? t(String(d.errorKey)) : d.error;
  const bg = isPixel ? 'var(--px-surface)' : isDark ? '#171716' : '#f6f2e8';
  const surface = isPixel ? 'var(--px-muted)' : isDark ? '#242422' : '#ebe3d2';
  const text = isPixel ? 'var(--px-ink)' : isDark ? '#ece9e0' : '#2b2417';
  const sub = isPixel ? 'var(--px-ink-soft)' : isDark ? '#a6a49c' : '#6f685d';
  const border = isPixel ? 'var(--px-ink)' : isDark ? 'rgba(214,168,79,.32)' : 'rgba(122,83,20,.28)';

  return (
    <div className="relative flex flex-col" style={{ width: size.w, height: size.h, minWidth: 430, minHeight: 410, background: bg, color: text, border: `2px solid ${selected ? accent : border}`, borderRadius: isPixel ? 8 : 14, boxShadow: isPixel ? '4px 4px 0 var(--px-ink)' : '0 18px 44px rgba(0,0,0,.28)', overflow: 'visible' }}>
      <Handle id="model3d" type="target" position={Position.Left} style={{ ...handleStyle, top: '52%', left: -7, background: PORT_COLOR.model3d }} title={t('previs.handles.model')} />
      <Handle id="image" type="source" position={Position.Right} style={{ ...handleStyle, top: '39%', right: -7, background: PORT_COLOR.image }} title={t('previs.handles.image')} />
      <Handle id="video" type="source" position={Position.Right} style={{ ...handleStyle, top: '54%', right: -7, background: PORT_COLOR.video }} title={t('previs.handles.video')} />
      <Handle id="text" type="source" position={Position.Right} style={{ ...handleStyle, top: '69%', right: -7, background: PORT_COLOR.text }} title={t('previs.handles.text')} />
      <Handle id="metadata" type="source" position={Position.Right} style={{ ...handleStyle, top: '84%', right: -7, background: PORT_COLOR.metadata }} title={t('previs.handles.metadata')} />
      <ResizableCorners selected={selected} minWidth={430} minHeight={410} maxWidth={900} maxHeight={900} accent={accent} keepAspectRatio={false} onResize={onResize} onResizeEnd={onResize} />

      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-3" style={{ borderColor: border, background: surface }}>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: accent, color: '#2b2417' }}><Box size={21} /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-black">{t('previs.title')}</div>
          <div className="truncate text-[10px]" style={{ color: sub }}>{t('previs.subtitle')}</div>
        </div>
        {d.status === 'success' && <CheckCircle2 size={17} className="text-emerald-400" />}
      </header>

      <div className="relative min-h-[190px] flex-1 overflow-hidden" style={{ background: isDark ? '#555653' : '#c7c4bd' }}>
        {d.imageUrl ? (
          <SmartImage src={d.imageUrl} alt={t('previs.outputAlt')} thumbSize={960} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ color: isDark ? '#e7e3d9' : '#423d35' }}>
            <div className="relative flex h-24 w-36 items-center justify-center rounded-lg border" style={{ borderColor: 'rgba(255,255,255,.34)', background: 'rgba(0,0,0,.16)' }}>
              <Camera size={40} strokeWidth={1.3} />
              <span className="absolute inset-3 border border-dashed border-amber-300/50" />
            </div>
            <span className="text-[11px] font-semibold">{t('previs.emptyPreview')}</span>
          </div>
        )}
        <div className="absolute bottom-2 left-2 right-2 grid grid-cols-4 gap-1 rounded-lg border px-2 py-1.5 text-center text-[9px] backdrop-blur" style={{ borderColor: 'rgba(255,255,255,.16)', background: 'rgba(20,20,18,.72)', color: '#d8d3c8' }}>
          <span>{t('previs.objects', { count: summary.objectCount })}</span><span>{t('previs.people', { count: summary.personCount })}</span><span>{t('previs.tracks', { count: summary.animatedTracks + summary.cameraKeys })}</span><span>{summary.aspectRatio}</span>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t p-3" style={{ borderColor: border, background: bg }}>
        <div className="grid grid-cols-3 gap-2">
          <button className="nodrag inline-flex h-10 items-center justify-center gap-1 rounded-md border text-[11px] font-bold" style={{ borderColor: border, background: surface }} onClick={() => setEditorOpen(true)}><ExternalLink size={14} />{t('previs.fullWorkbench')}</button>
          <button className="nodrag inline-flex h-10 items-center justify-center gap-1 rounded-md border text-[11px] font-bold" style={{ borderColor: border, background: surface }} onClick={() => requestRun('image')} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileImage size={14} />}{t('previs.currentFrame')}</button>
          <button className="nodrag inline-flex h-10 items-center justify-center gap-1 rounded-md border text-[11px] font-bold" style={{ borderColor: border, background: surface }} onClick={() => requestRun('video')} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}{t('previs.animation')}</button>
        </div>
        <button className="nodrag flex h-8 w-full items-center justify-center gap-1 rounded-md border text-[10px]" style={{ borderColor: 'rgba(214,168,79,.3)', background: 'rgba(214,168,79,.08)', color: sub }} onClick={openSource} title={t('previs.sourceCommit', { commit: SOURCE_COMMIT })}>
          <Github size={12} /><span>{t('previs.source')}</span><Heart size={11} /><strong>{t('previs.thanks')}</strong>
        </button>
        <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: persistedError ? '#fb7185' : sub }}>
          <span className="truncate" title={persistedError || message || t('previs.openHint')}>{persistedError || message || t('previs.openHint')}</span>
          <span className="shrink-0">{t('previs.fixedDuration', { seconds: summary.durationSeconds, fps: summary.fps, shots: summary.shotCount })}</span>
        </div>
      </div>

      {editorOpen && createPortal(
        <Suspense fallback={<div className="fixed inset-0 z-[10050] flex items-center justify-center bg-[#181817] text-[#ece9e0]"><Loader2 className="mr-2 animate-spin" />{t('previs.loading')}</div>}>
          <LazyPrevisStudioEditor
            ref={editorRef}
            initialProject={project}
            storageKey={`t8-previs-studio-project:${id}`}
            projectTitle={String(d.title || t('previs.unnamedShot'))}
            onProjectChange={writeProject}
            onImportAsset={(file) => uploadFileBlob(file, `previs-model-${id}-${Date.now()}-${file.name}`)}
            onRequestRun={requestRun}
            onReady={onEditorReady}
            onClose={() => { if (!busy) setEditorOpen(false); else setMessage(t('previs.closeAfterExport')); }}
          />
        </Suspense>,
        document.body,
      )}
    </div>
  );
};

export default memo(PrevisStudioNode);
