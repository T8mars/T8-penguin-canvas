import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CanvasListItem } from '../types/canvas';
import * as api from '../services/api';
import { useCanvasStore } from '../stores/canvas';

export default function CanvasRestoreDialog({ item, onClose }: { item: CanvasListItem; onClose: () => void }) {
  const { t } = useTranslation('shell');
  const cancel = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null);
  const operationId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    previous?.blur();
    const root = document.getElementById('root'), prior = root?.inert || false;
    if (root) root.inert = true;
    cancel.current?.focus();
    return () => { if (root) root.inert = prior; if (previous?.isConnected) previous.focus(); };
  }, []);
  const restore = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      // Keep the exact confirmed metadata and operation ID on retry. A lost
      // response recovers the same receipt instead of creating another action.
      const result = await api.transitionCanvasArchive(item, 'restore', operationId.current);
      useCanvasStore.setState((state) => ({ canvases: [...state.canvases.filter((canvas) => canvas.id !== item.id), result.item] }));
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const button = 'rounded-md border border-[var(--t8-border)] px-4 py-2 text-sm hover:bg-[var(--bg-secondary)] disabled:opacity-40';
  return createPortal(<div className="fixed inset-0 z-[1001] grid place-items-center bg-black/50 p-4" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="canvas-restore-message" data-canvas-restore="true" className="w-full max-w-lg rounded-lg border border-[var(--t8-border)] bg-[var(--bg-primary)] p-5 text-[var(--text-primary)] shadow-xl"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); onClose(); }
        if (event.key !== 'Tab') return;
        const controls = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <p id="canvas-restore-message" className="break-words text-sm leading-6">{t('archive.confirmRestore', { name: item.name })}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <button ref={cancel} className={button} disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</button>
        <button className={button} disabled={busy} onClick={() => void restore()}>{t('archive.restore')}</button>
      </div>
    </div>
  </div>, document.body);
}
