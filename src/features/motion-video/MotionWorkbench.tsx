import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import MotionForm, { motionControl, type MotionFormProps } from './MotionForm';
export default function MotionWorkbench(props: MotionFormProps & { onClose: () => void; children: ReactNode; actions: ReactNode }) {
  const { t } = useTranslation('motionVideo');
  const panel = useRef<HTMLDivElement>(null), composing = useRef(false);
  const close = useRef(props.onClose); close.current = props.onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || composing.current) return;
      // Completing a run can disable the focused button, returning focus to
      // body. Escape still closes this modal, but not an unrelated nested one.
      if (event.target !== document.body && event.target !== document.documentElement && !panel.current?.contains(event.target as Node)) return;
      event.preventDefault(); event.stopPropagation(); close.current();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => { window.removeEventListener('keydown', onEscape, true); if (prior?.isConnected) prior.focus(); };
  }, []);
  return createPortal(<div className="nodrag nopan nowheel" data-motion-workbench style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#0008', display: 'grid', placeItems: 'center', padding: 12 }}
    onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('title')} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') || [])].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }} style={{ width: 'min(1120px,100%)', maxHeight: 'calc(100dvh - 24px)', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: 14 }}>
      <header style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><strong>{t('title')}</strong><button type="button" style={motionControl} onClick={props.onClose}>{t('close')}</button></header>
      <div style={{ minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', padding: 14, display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit,minmax(min(310px,100%),1fr))' }}>
        <section style={{ minWidth: 0 }}><MotionForm {...props} expanded />{props.actions}</section><section style={{ minWidth: 0 }}>{props.children}</section>
      </div>
    </div>
  </div>, document.body);
}
