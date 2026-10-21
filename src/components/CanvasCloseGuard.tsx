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
    const unsubscribe = subscribe(async (cancelled, phase) => {
      releasePreviousHold?.();
      const root = document.getElementById('root');
      const wasInert = root?.inert ?? false;
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (root) root.inert = true;
      const notice = document.createElement('div');
      notice.setAttribute('data-canvas-close-hold', 'true');
      notice.setAttribute('data-canvas-close-phase', 'saving');
      notice.setAttribute('role', 'status');
      const message = document.createElement('div');
      message.textContent = t('generationHistory.savingBeforeClose');
      const actions = document.createElement('div');
      actions.hidden = true;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = t('generationHistory.retryCloseUpdate');
      retry.onclick = async () => {
        if (!window.t8pc?.updater || retry.disabled) return;
        retry.disabled = true;
        try { await window.t8pc.updater.install(); }
        catch { message.textContent = t('generationHistory.closeUpdateFailed'); }
        finally { retry.disabled = false; }
      };
      const saveLog = document.createElement('button');
      saveLog.type = 'button';
      saveLog.textContent = t('generationHistory.saveCloseLog');
      saveLog.onclick = () => { void window.t8pc?.startupDiagnostics?.save().catch(() => {}); };
      for (const button of [retry, saveLog]) Object.assign(button.style, {
        margin: '12px 8px', padding: '10px 16px', cursor: 'pointer',
        background: 'var(--bg-primary, #fff)', color: 'inherit',
        border: '1px solid currentColor', borderRadius: '8px',
      });
      actions.appendChild(retry); actions.appendChild(saveLog);
      notice.appendChild(message); notice.appendChild(actions);
      Object.assign(notice.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid',
        placeContent: 'center', textAlign: 'center', padding: '32px', background: 'var(--bg-primary, #fff)',
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
        if (disposed || cancelled()) { restore(); return; }
        const current = phase?.() || 'saving';
        // A retained successful receipt is already closing even before the
        // first main-process phase event arrives (ordinary quit has none).
        notice.setAttribute('data-canvas-close-phase', current === 'saving' && accepted ? 'closing' : current);
        const keys = {
          closing: 'generationHistory.savedBeforeClose',
          waiting: 'generationHistory.waitingBeforeClose',
          installing: 'generationHistory.installingAfterClose',
          'update-error': 'generationHistory.closeUpdateFailed',
        } as const;
        if (current !== 'saving') message.textContent = t(keys[current]);
        actions.hidden = current !== 'update-error';
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
        if (accepted) {
          notice.setAttribute('data-canvas-close-phase', 'closing');
          message.textContent = t('generationHistory.savedBeforeClose');
        }
        return accepted ? result : { ok: false, reason: result.reason || 'save' };
      } finally {
        if (!accepted) restore();
      }
    });
    return () => { disposed = true; unsubscribe(); releasePreviousHold?.(); };
  }, [runtime, t]);
  return null;
}
