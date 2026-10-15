import { Component, lazy, Suspense, useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { collectImageEditRevisions } from '../../utils/imageEditRevisions';

// Upload/output nodes are common on the first canvas. Keep the editor and its
// tool manifests outside their initial dependency graph until it is opened.
const Editor = lazy(() => import('./ImageEditModal'));
export type { ImageEditProduceMeta } from './ImageEditModal';
class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function EditorNotice({ onClose, failed = false }: { onClose: () => void; failed?: boolean }) {
  const { t } = useTranslation('creativeUx'), cancel = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null, root = document.getElementById('root'), inert = root?.inert || false;
    if (root) root.inert = true;
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (event.key === 'Escape') close.current(); else cancel.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); if (root) root.inert = inert; if (active?.isConnected) active.focus(); };
  }, []);
  return createPortal(<div className="nodrag nopan nowheel" data-editor-notice={failed ? 'error' : 'loading'} data-canvas-editing-dialog role="dialog" aria-modal="true"
    aria-label={t(failed ? 'editor.loadFailed' : 'editor.loading')} style={{ position: 'fixed', inset: 0, zIndex: 10003, background: '#0008', display: 'grid', placeItems: 'center' }}>
    <div style={{ background: 'var(--bg-primary, #17202e)', color: 'var(--text-primary, #f1f5f9)', padding: 24, borderRadius: 12 }}>
      <p role={failed ? 'alert' : 'status'}>{t(failed ? 'editor.loadFailed' : 'editor.loading')}</p>
      <button ref={cancel} type="button" onClick={onClose}>{t('moodboard.cancel')}</button>
    </div>
  </div>, document.body);
}
export default function LazyImageEditModal(props: ComponentProps<typeof Editor>) {
  const { getNodes } = useReactFlow();
  const revisions = useMemo(() => collectImageEditRevisions(getNodes(), props.srcUrl), [getNodes, props.srcUrl]);
  return <EditorBoundary key={props.srcUrl} fallback={<EditorNotice failed onClose={props.onClose} />}>
    <Suspense fallback={<EditorNotice onClose={props.onClose} />}><Editor {...props} revisionCandidates={props.revisionCandidates || revisions} /></Suspense>
  </EditorBoundary>;
}
