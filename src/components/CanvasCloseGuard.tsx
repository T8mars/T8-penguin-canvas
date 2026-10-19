import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { waitForCanvasCloseSave } from '../utils/canvasCloseSave';

export interface CanvasCloseObserver {
  prepare: () => void;
  read: () => { dirty: boolean; queued: boolean; blocked?: 'running' | 'conflict' };
  flush: () => void;
}

/** Lives outside the keyed editor: switching to an unsaved canvas must not
 * invalidate the close receipt that is waiting for that canvas to be saved. */
export function CanvasCloseGuard({ runtime }: { runtime: { closeObserver: CanvasCloseObserver | null } }) {
  const { t } = useTranslation('canvas');
  useEffect(() => {
    const subscribe = window.t8pc?.onCanvasCloseRequest;
    if (!subscribe) return;
    let disposed = false;
    let releasePreviousHold: (() => void) | null = null;
    const unsubscribe = subscribe(async (cancelled) => {
      releasePreviousHold?.();
      const root = document.getElementById('root');
      const wasInert = root?.inert ?? false;
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (root) root.inert = true;
      const notice = document.createElement('div');
      notice.setAttribute('data-canvas-close-hold', 'true');
      notice.setAttribute('role', 'status');
      notice.textContent = t('generationHistory.savingBeforeClose');
      Object.assign(notice.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid',
        placeItems: 'center', background: 'var(--bg-primary, #fff)',
        color: 'var(--text-primary, #111827)', fontSize: '16px',
      });
      document.body.appendChild(notice);
      let released = false;
      let cancellationWatch: number | undefined;
      const restore = () => {
        if (released) return;
        released = true;
        window.clearInterval(cancellationWatch);
        if (root) root.inert = wasInert;
        notice.remove();
      };
      releasePreviousHold = restore;
      cancellationWatch = window.setInterval(() => {
        if (!disposed && !cancelled()) return;
        restore();
      }, 50);
      let accepted = false;
      try {
        runtime.closeObserver?.prepare();
        const result = await waitForCanvasCloseSave({
          cancelled: () => disposed || cancelled(),
          // During editor replacement, wait for its successor, not a false clean ACK.
          read: () => runtime.closeObserver?.read() || { dirty: true, queued: true },
          flush: () => runtime.closeObserver?.flush(),
        });
        accepted = result.ok && !disposed && !cancelled();
        return accepted ? result : { ok: false, reason: result.reason || 'save' };
      } finally {
        if (!accepted) restore();
      }
    });
    return () => { disposed = true; unsubscribe(); releasePreviousHold?.(); };
  }, [runtime, t]);
  return null;
}
