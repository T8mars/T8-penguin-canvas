import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { Film } from 'lucide-react';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import { useCanvasStore } from '../../stores/canvas';
import { useApiKeysStore } from '../../stores/apiKeys';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../../stores/runBus';
import { createCanvasNodeRunRequestId, requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { captureMotionInput, createMotionVersion, mergeMotionVersions, motionOutputPatch, motionScenes, motionVersions, readMotionPending, type MotionPending, type MotionVersion } from '../../utils/motionVideo';
import { executeMotionVideo } from '../../utils/executeMotionVideo';
import { loadMotionHistory } from '../../utils/motionVideoHistory';
import { queryMotionVideo } from '../../services/generation';
import MotionForm, { motionControl } from '../../features/motion-video/MotionForm';
import LoopingVideo from '../LoopingVideo';
import { PORT_COLOR } from '../../config/portTypes';
const Workbench = lazy(() => import('../../features/motion-video/MotionWorkbench'));

function CodeAnimationNode({ id, data, selected }: NodeProps) {
  const { t } = useTranslation('motionVideo');
  const d = data as Record<string, any>, rf = useReactFlow(), update = useUpdateNodeData(id);
  const origin = useRef({ canvasId: useCanvasStore.getState().activeId, entityUid: (rf.getNode(id) as any)?.entityUid });
  const mounted = useRef(true), currentData = useRef(d); currentData.current = d;
  const latest = () => (rf.getNode(id)?.data || currentData.current) as Record<string, any>;
  const readOnly = useCanvasStore(state => state.canvases.find(c => c.id === origin.current.canvasId)?.status === 'archived');
  const configured = useApiKeysStore(state => Boolean(state.settings.zhenzhenSd2ApiKey));
  const executionKey = createCanvasNodeExecutionKey(origin.current.canvasId, id);
  const running = useRunBusStore(state => state.runningIds.includes(executionKey));
  const [requesting, setRequesting] = useState(false), [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(''), [cursor, setCursor] = useState<string | null>(null), [clip, setClip] = useState(0);
  const [viewVersionId, setViewVersionId] = useState('');
  const [readOnlyVersions, setReadOnlyVersions] = useState<MotionVersion[]>([]);
  const requestLock = useRef(false), historyAbort = useRef<AbortController | null>(null), player = useRef<HTMLVideoElement>(null);
  const incoming = useUpstreamMaterials(id), ordered = useOrderedMaterials(incoming.texts, d.materialOrder);
  const upstreamPrompt = ordered.map(item => item.url).join('\n\n');
  const versions = readOnly ? mergeMotionVersions(motionVersions(d.motionVersions), readOnlyVersions) : motionVersions(d.motionVersions);
  const version = versions.find(item => item.id === (readOnly && viewVersionId || d.motionSelectedVersionId)) || versions.at(-1);
  const pending = d.motionPending as MotionPending | undefined;
  const busy = running || requesting;
  const writable = () => {
    const state = useCanvasStore.getState(), node = rf.getNode(id) as any;
    return mounted.current && state.activeId === origin.current.canvasId && node && node.entityUid === origin.current.entityUid
      && state.canvases.find(c => c.id === origin.current.canvasId)?.status !== 'archived';
  };
  // Results stay in the shared asset/history ledger if this entity is gone or
  // offscreen. Never patch a replacement node with the same visible id.
  const patch = (value: Record<string, unknown>) => { if (writable()) update(value); };
  const persistVersions = (incomingVersions: MotionVersion[], selectId?: string) => {
    if (!writable()) return;
    const now = latest(), merged = mergeMotionVersions(motionVersions(now.motionVersions), incomingVersions);
    const active = merged.find(item => item.id === (selectId || now.motionSelectedVersionId)) || merged.at(-1);
    patch({ motionVersions: merged, ...(active ? motionOutputPatch(active) : {}) });
  };
  const refresh = async (more = false) => {
    if (loading || historyAbort.current) return;
    const state = useCanvasStore.getState(), canvas = state.canvases.find(c => c.id === origin.current.canvasId);
    if (!canvas?.projectId || !origin.current.canvasId || !origin.current.entityUid) return;
    const controller = new AbortController(); historyAbort.current = controller; setLoading(true);
    try {
      const page = await loadMotionHistory({ projectId: canvas.projectId, canvasId: origin.current.canvasId, nodeId: id, nodeEntityUid: origin.current.entityUid }, more ? cursor || undefined : undefined, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (useCanvasStore.getState().canvases.find(c => c.id === origin.current.canvasId)?.status === 'archived') {
        setReadOnlyVersions(current => mergeMotionVersions(current, page.versions));
      }
      persistVersions(page.versions); setCursor(page.nextCursor);
      const task = latest().motionPending?.taskId;
      if (task && page.versions.some(item => item.result.taskId === task)) patch({ motionPending: null, status: 'success', error: '', motionStage: 'succeeded' });
    } catch (error) { if (mounted.current && !controller.signal.aborted) setLocalError(error instanceof Error ? error.message : String(error)); }
    finally { if (historyAbort.current === controller) historyAbort.current = null; if (mounted.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; if (pending) void refresh(); return () => { mounted.current = false; historyAbort.current?.abort(); }; }, []);
  useEffect(() => { setClip(0); }, [version?.id]);
  useEffect(() => {
    const video = player.current;
    if (!video) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) video.pause();
    });
    observer.observe(video);
    return () => { observer.disconnect(); video.pause(); };
  }, [open, version?.id, clip]);
  const capture = () => readMotionPending(d.motionPending) || captureMotionInput(d, upstreamPrompt);
  useRunTrigger(id, async reporter => {
    if (!writable()) throw Error(t('readOnly'));
    if (d.motionAcceptanceUnknown && !pending) throw Error(t('unknown'));
    const input = capture();
    patch({ status: 'running', error: '', motionStage: 'queued', motionProgress: null });
    if (mounted.current) setLocalError('');
    try {
      const output = await executeMotionVideo(input, reporter, {
        pending: value => patch({ motionPending: value, motionAcceptanceUnknown: false }),
        status: (stage, progress) => patch({ motionStage: stage, motionProgress: progress }),
      }, pending);
      const created = createMotionVersion(output.input, output.result, output.videoUrls);
      persistVersions([created], created.id);
      patch({ status: 'success', error: '', motionPending: null, motionStage: 'succeeded', motionProgress: null });
      if (mounted.current) void refresh();
    } catch (error) {
      const failure = error as Error & { motionAcceptanceUnknown?: boolean; motionTerminal?: boolean };
      patch({ status: 'error', error: reporter.signal?.aborted ? t('stopped') : failure.message,
        ...(failure.motionAcceptanceUnknown ? { motionAcceptanceUnknown: true } : {}), ...(failure.motionTerminal ? { motionPending: null } : {}) });
      throw error;
    }
  }, 'code-animation', { lifecycleAware: true, captureHistoryInput: () => capture() as unknown as Record<string, unknown> });
  const run = () => {
    if (requestLock.current || busy || !writable() || !configured || d.motionAcceptanceUnknown && !pending) return;
    try { capture(); } catch (error) { setLocalError((error as Error).message); return; }
    requestLock.current = true; setRequesting(true); setLocalError('');
    const settled = (outcome: { accepted: boolean; error?: string }) => {
      requestLock.current = false; if (!mounted.current) return; setRequesting(false);
      if (!outcome.accepted) setLocalError(outcome.error || t('requestFailed'));
    };
    if (!requestCanvasNodeRun(id, { requestId: createCanvasNodeRunRequestId(id, 'code-animation'), onSettled: settled })) settled({ accepted: false });
  };
  const stop = () => { const bus = useRunBusStore.getState(), token = bus.executionTokens[executionKey]; if (token) void bus.cancelExecution(executionKey, token); };
  const revise = (target: MotionVersion, instruction = '') => {
    if (busy || pending) return;
    patch({ motionOperation: 'revise', motionBaseVersionId: target.id, motionRevisionInstruction: instruction, model: target.request.model }); setOpen(true);
  };
  const newFrom = () => {
    if (!version || busy || pending) return;
    const r = version.request, m = r.motion || {};
    patch({ model: r.model, prompt: r.prompt, duration: r.duration, ratio: r.ratio, resolution: r.resolution,
      motionTitle: m.title || '', motionSubtitle: m.subtitle || '', motionSignature: m.signature || '', motionLanguage: m.language || '',
      motionTemplate: m.template_id || 'api_default', motionMusic: m.music || 'api_default', motionKeywords: (m.keywords || []).join('\n'),
      motionOperation: 'generate', motionBaseVersionId: '', motionRevisionInstruction: '' });
  };
  const verify = async () => {
    const base = pending || versions.find(item => item.id === d.motionBaseVersionId)?.result;
    if (!base || busy || loading || !writable()) return;
    setLoading(true); setLocalError('');
    try {
      const result = await queryMotionVideo(base.taskId, pending?.request.model || (base as any).model, base.connectionRef, { inspect: true, verifyConnection: true });
      if (pending) patch({ motionPending: { ...pending, connectionRef: result.connectionRef } });
      else persistVersions(versions.map(item => item.id === d.motionBaseVersionId ? { ...item, result: { ...item.result, connectionRef: result.connectionRef } } : item));
      if (mounted.current) setLocalError(t('verified'));
    } catch (error) { if (mounted.current) setLocalError((error as Error).message); }
    finally { if (mounted.current) setLoading(false); }
  };
  const actions = <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
    {!configured && <p>{t('settings')}</p>}{readOnly && <p>{t('readOnly')}</p>}
    {d.motionAcceptanceUnknown && <><p role="alert">{t('unknown')}</p><button style={motionControl} disabled={busy || readOnly} onClick={() => patch({ motionAcceptanceUnknown: false, error: '' })}>{t('clearUnknown')}</button></>}
    <button type="button" style={{ ...motionControl, background: 'var(--accent-primary)', padding: 10 }} disabled={busy || readOnly || !configured || Boolean(d.motionAcceptanceUnknown && !pending) || d.motionOperation === 'revise' && !pending && !versions.some(v => v.id === d.motionBaseVersionId)} onClick={run}>
      {t(requesting ? 'confirming' : running ? 'generating' : pending ? 'resume' : 'generate')}</button>
    {running && <button type="button" style={motionControl} onClick={stop}>{t('stop')}</button>}
    {(pending || d.motionOperation === 'revise') && <button type="button" style={motionControl} disabled={busy || loading || readOnly} onClick={() => void verify()}>{t('verify')}</button>}
    {d.motionStage && <div role="status">{t(`stage.${d.motionStage}`, { defaultValue: t('generating') })}{typeof d.motionProgress === 'number' ? ` · ${d.motionProgress}%` : ''}</div>}
    {(localError || d.error) && <div role="alert" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{localError || d.error}</div>}
  </div>;
  const preview = <div style={{ display: 'grid', gap: 9, marginTop: 10, fontSize: 12 }}>
    <button type="button" style={motionControl} disabled={loading} onClick={() => void refresh()}>{t('refresh')}</button>
    {cursor && <button type="button" style={motionControl} disabled={loading} onClick={() => void refresh(true)}>{t('loadMore')}</button>}
    {!version ? <p>{t('noVersion')}</p> : <>
      <select style={motionControl} aria-label={t('versions')} value={version.id} onChange={e => { const key = e.currentTarget.value, item = versions.find(v => v.id === key); setViewVersionId(key); if (item) patch(motionOutputPatch(item)); }}>
        {[...versions].reverse().map((item, i) => <option key={item.id} value={item.id}>V{versions.length - i}{item.baseVersionId ? ` ← V${versions.findIndex(v => v.id === item.baseVersionId) + 1 || '?'}` : ''} · {t(item.review === 'accepted' ? 'reviewed' : 'unreviewed')}</option>)}
      </select>
      {(busy || pending) && <small>{t('previous')}</small>}
      {version.videoUrls.length > 1 && <select style={motionControl} value={clip} onChange={e => { setClip(Number(e.currentTarget.value)); }}>{version.videoUrls.map((_, i) => <option key={i} value={i}>{i + 1} / {version.videoUrls.length}</option>)}</select>}
      <LoopingVideo key={`${version.id}:${clip}`} ref={player} src={version.videoUrls[clip] || version.videoUrls[0]} poster={/^\/files\/output\/[^/?#]+$/.test(version.result.coverUrl || '') ? version.result.coverUrl : undefined} controls autoPlay={false} preload="none" style={{ width: '100%', maxHeight: open ? 350 : 210, background: '#000', borderRadius: 8 }} />
      <a style={motionControl} href={version.videoUrls[clip] || version.videoUrls[0]} download={`animation-v${versions.indexOf(version) + 1}.mp4`}>{t('download')}</a>
      <p style={{ margin: 0 }}>{t(version.result.fallbackScenes.length ? 'fallback' : 'noFallback')}</p>
      {version.result.fallbackScenes.length > 0 && <details><summary>{t('fallback')}</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(version.result.fallbackScenes, null, 2)}</pre></details>}
      {version.ancestorQuality.length > 0 && <small>{t('ancestor')}</small>}{version.result.warnings.length > 0 && <small>{t('incompleteMetadata')}</small>}
      <button type="button" style={motionControl} disabled={readOnly || busy || Boolean(pending)} onClick={() => revise(version)}>{t('revise')}</button>
      <button type="button" style={motionControl} disabled={readOnly || busy || Boolean(pending)} onClick={newFrom}>{t('newFrom')}</button>
      <button type="button" style={motionControl} disabled={readOnly} onClick={() => patch({ motionVersions: motionVersions(latest().motionVersions).map(item => item.id === version.id ? { ...item, review: 'accepted' } : item) })}>{t('markReviewed')}</button>
      <details><summary>{t('storyboard')}</summary><div style={{ maxHeight: open ? 360 : 200, overflow: 'auto' }}>
        {!motionScenes(version.result).length && <p>{t('noStoryboard')}</p>}
        {motionScenes(version.result).map(scene => <section key={scene.index} style={{ padding: 8, borderBottom: '1px solid var(--border-primary)' }}>
          <strong>{scene.index + 1}. {scene.title}</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{scene.details}</pre>
          <button style={motionControl} disabled={scene.end <= scene.start} onClick={() => { if (player.current) player.current.currentTime = scene.start; }}>{t('jump', { time: scene.start.toFixed(1) })}</button>
          <button style={motionControl} disabled={readOnly || busy || Boolean(pending)} onClick={() => revise(version, t('sceneInstruction', { index: scene.index + 1, title: scene.title, start: scene.start.toFixed(1), end: scene.end.toFixed(1) }))}>{t('reviseScene')}</button>
        </section>)}
      </div></details>
    </>}
  </div>;
  return <div className="node-card" data-code-animation-node style={{ width: 390, border: `2px solid ${selected ? 'var(--accent-primary)' : 'var(--border-primary)'}`, borderRadius: 14, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
    <Handle id="prompt" type="target" position={Position.Left} title={t('prompt')} style={{ background: PORT_COLOR.text }} />
    <Handle id="video" type="source" position={Position.Right} title={t('download')} style={{ top: '50%', background: PORT_COLOR.video }} />
    <Handle id="storyboard" type="source" position={Position.Right} title={t('storyboard')} style={{ top: '65%', background: PORT_COLOR.text }} />
    <header style={{ padding: 12, borderBottom: '1px solid var(--border-primary)' }}><Film size={18} style={{ display: 'inline', marginRight: 8 }} /><strong>{t('title')}</strong><div style={{ fontSize: 11, marginTop: 5 }}>{t('subtitle')}<br />{t('provider')}</div></header>
    <div className="nodrag nopan nowheel" style={{ padding: 12 }} onPointerDown={e => e.stopPropagation()}>
      <button type="button" style={{ ...motionControl, width: '100%', marginBottom: 10 }} onClick={() => setOpen(true)}>{t('open')}</button>
      {!open && <><MotionForm data={d} onPatch={patch} readOnly={readOnly} upstream={Boolean(upstreamPrompt)} />{actions}{preview}</>}
      {open && <Suspense fallback={<div>{t('open')}</div>}><Workbench data={d} onPatch={patch} readOnly={readOnly} upstream={Boolean(upstreamPrompt)} onClose={() => setOpen(false)} actions={actions}>{preview}</Workbench></Suspense>}
    </div>
  </div>;
}
export default memo(CodeAnimationNode);
